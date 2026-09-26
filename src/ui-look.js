import { $, esc, state, on, setPref, viewedNode } from './editor.js';
import { catalog } from './catalog.js';
import { lookForStats, colormapCSS, COLORMAPS, GEOMETRY_CHANNELS } from './looks.js';
import { refreshTip } from './ui-tooltip.js';
/** How the canvas colors the stage it shows, and the legend that explains it.
 *
 * A stage without colors of its own (scalar, coordinates, geometry), or a layer
 * that is clipped at the scene exposure, is shown with an automatic look whose
 * range comes from the values actually in view: a small raw render (STATS size)
 * read back as floats. The first frame of a new stage computes it synchronously
 * so it never flashes in the wrong colors; later updates (parameters, time,
 * camera) arrive asynchronously, at most a few times per second. The legend's
 * lock pins the current range, e.g. to compare two parameter values fairly.
 */
const STATS_WIDTH = 120, STATS_HEIGHT = 72, REFRESH_MS = 220;
const CHANNEL_INDEX = Object.fromEntries(GEOMETRY_CHANNELS.map((name, i) => [name, i])); // S 0, A 1, coverage 2
/** The look in use: {target, type, optionsKey, sourceKey, look}. */
let current = null, inFlight = false, lastRequest = 0, retry = null;
/** Look preferences for a component of `type`; `natural` for the scene's output. */
export function lookOptions(type, { natural = false } = {}) {
    const p = state.prefs, classic = p.stageColors === 'classic';
    let mode = 'auto';
    if (type === 'layer') {
        mode = p.layerView === 'alpha' ? 'alpha' : (classic || !p.autoExposure) ? 'classic' : 'auto';
    }
    else if (classic || (type === 'geometry' && p.geometryChannel === 'all')) {
        mode = 'classic';
    }
    return { mode, channel: CHANNEL_INDEX[p.geometryChannel] ?? 0, exposure: state.project.exposure, natural, contours: p.contours };
}
function needsStats(options, type) {
    return options.mode === 'auto' && !(type === 'layer' && options.natural);
}
/** Signature of everything a stage's value range depends on. */
function sourceKey(project, target) {
    return `${target}|${state.time.toFixed(4)}|${JSON.stringify(project.view)}|${JSON.stringify(project.nodes)}|${JSON.stringify(project.tracks)}|${project.exposure}`;
}
function build(values, type, options) {
    const look = lookForStats(values, type, options);
    if (look.range && !options.contours) {
        look.range = { ...look.range, contour: 0 };
    }
    return look;
}
/** The look to draw `target` of `project` with in the current view, computing it
 * synchronously when none is known for this target yet. Returns {mode: 'classic'}
 * for the final image and "what it changes" views.
 */
export function frameLook(project, target) {
    if (state.viewMode !== 'stage' || state.compareOriginal) {
        return { mode: 'classic' };
    }
    const node = project.nodes.find(n => n.id === target);
    if (!node) {
        return { mode: 'classic' };
    }
    const type = catalog[node.type].output, options = lookOptions(type, { natural: target === project.output });
    const optionsKey = JSON.stringify(options);
    if (!needsStats(options, type)) {
        current = { target, type, optionsKey, sourceKey: null, look: { mode: options.mode, channel: options.channel, gain: 1 } };
        return current.look;
    }
    if (state.lookLock?.target === target && state.lookLock.optionsKey === optionsKey) {
        return state.lookLock.look;
    }
    if (current?.target === target && current.optionsKey === optionsKey && current.look) {
        return current.look;
    }
    const renderer = state.renderer;
    if (!renderer?.info.rawFields) {
        return { mode: 'classic' };
    }
    try {
        const values = renderer.rawImage(project, state.time, target, STATS_WIDTH, STATS_HEIGHT);
        current = { target, type, optionsKey, sourceKey: sourceKey(project, target), look: build(values, type, options) };
        refreshLegend();
        return current.look;
    }
    catch (e) {
        return { mode: 'classic' };
    }
}
function changedEnough(a, b) {
    if (!a || !b || a.mode !== b.mode) {
        return true;
    }
    if (a.range && b.range) {
        const span = Math.max(a.range.hi - a.range.lo, 1e-30);
        return a.range.signed !== b.range.signed || Math.abs(a.range.lo - b.range.lo) > 0.03 * span || Math.abs(a.range.hi - b.range.hi) > 0.03 * span || a.range.contour !== b.range.contour;
    }
    if (a.gain !== undefined && b.gain !== undefined && Math.abs(Math.log((a.gain || 1) / (b.gain || 1))) > 0.1) {
        return true;
    }
    return a.step !== b.step;
}
/** After a stage frame: refresh the range in the background when what is shown
 * changed. Redraws only when the new range differs noticeably.
 */
export function afterStageFrame(project, target) {
    if (!current || current.target !== target || !current.sourceKey || state.lookLock?.target === target || inFlight) {
        return;
    }
    const renderer = state.renderer, key = sourceKey(project, target);
    if (key === current.sourceKey) {
        return;
    }
    const wait = REFRESH_MS - (performance.now() - lastRequest);
    if (wait > 0) {
        // Too soon after the last refresh: redraw once the interval has passed.
        retry ??= setTimeout(() => {
            retry = null;
            state.dirty = true;
        }, wait);
        return;
    }
    const type = current.type, options = JSON.parse(current.optionsKey), snapshot = JSON.parse(JSON.stringify(project)), time = state.time;
    inFlight = true;
    lastRequest = performance.now();
    renderer.rawImage(snapshot, time, target, STATS_WIDTH, STATS_HEIGHT, { async: true }).then(values => {
        inFlight = false;
        if (current?.target !== target) {
            return;
        }
        const look = build(values, type, options);
        const redraw = changedEnough(current.look, look);
        current = { ...current, sourceKey: key, look: redraw ? look : { ...current.look, stats: look.stats } };
        refreshLegend();
        if (redraw) {
            state.dirty = true;
        }
    }, () => {
        inFlight = false;
    });
}
/** Forget the computed look (e.g. after the stage or the preferences changed). */
export function resetLook() {
    current = null;
}
// ---- Legend -------------------------------------------------------------------
const fmt = v => {
    if (!Number.isFinite(v)) {
        return String(v);
    }
    const a = Math.abs(v);
    return a !== 0 && (a < 1e-3 || a >= 1e5) ? v.toExponential(2) : String(Number(v.toPrecision(3)));
};
/** A range end: values negligible next to the range's span read as 0, not 6.39e-29. */
const fmtEnd = (v, span) => Math.abs(v) < span * 1e-6 ? '0' : fmt(v);
function histogramSVG(histogram) {
    const max = Math.max(...histogram, 1), n = histogram.length;
    const path = histogram.map((h, i) => `${i ? 'L' : 'M'}${(i / (n - 1) * 100).toFixed(1)},${(22 - 20 * Math.sqrt(h / max)).toFixed(1)}`).join(' ');
    return `<svg class="legend-hist" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true"><path d="${path} L100,22 L0,22 Z"/></svg>`;
}
function select(id, value, options, tip) {
    return `<select id="${id}" data-tip="${esc(tip)}">${options.map(([v, label]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
}
function lockButton(target) {
    const locked = state.lookLock?.target === target;
    return `<button id="lookLock" class="icon-toggle ${locked ? 'active' : ''}" aria-pressed="${locked}" data-toggle data-tip="Lock the color range|Keep the current range while you change parameters, so colors compare fairly. Unlock to follow the values again.">${locked ? '🔒' : '🔓'}</button>`;
}
function colorbar(look, stats) {
    const r = look.range;
    const stops = r.signed ? COLORMAPS.diverging : COLORMAPS.sequential;
    const span = Math.abs(r.hi - r.lo), labels = r.signed ? `<span>${fmtEnd(r.lo, span)}</span><span>0</span><span>${fmtEnd(r.hi, span)}</span>` : `<span>${fmtEnd(r.lo, span)}</span><span>${fmtEnd(r.hi, span)}</span>`;
    // Where the histogram's bins sit on the colorbar: stats span min…max, the bar lo…hi.
    const hist = stats?.count && stats.max > stats.min ? histogramSVG(stats.histogram) : '';
    const left = stats?.count ? ((stats.min - r.lo) / (r.hi - r.lo) * 100) : 0, width = stats?.count ? ((stats.max - stats.min) / (r.hi - r.lo) * 100) : 100;
    return `<div class="legend-bar" style="background:${colormapCSS(stops)}" data-tip="Colormap|${r.signed ? 'The field takes both signs: cool colors are negative, near-black is zero, warm colors positive. The range is symmetric about zero.' : 'Dark is low, bright is high, over the values in view.'} The white curve is the histogram of values in view${look.range.contour ? `; contour lines every ${fmt(look.range.contour)}` : ''}.">${hist ? `<div class="legend-hist-wrap" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%">${hist}</div>` : ''}</div><div class="legend-labels ${r.signed ? 'three' : ''}">${labels}</div>`;
}
/** Info (what the colors mean) and controls (how to show it) share the legend;
 * on a narrow image the controls fold behind a ⚙ button.
 */
const withControls = (info, controls) => `${info}<span class="legend-controls">${controls}</span><button class="legend-more" data-legend-more aria-label="Stage color options" data-tip="Options|How this stage is colored: colormap, channel, contours, exposure.">⚙</button>`;
const CHANNEL_OPTIONS = [['S', 'S · warp'], ['A', 'A · rim'], ['coverage', 'Coverage'], ['all', 'All three (classic)']];
const CHANNEL_TIP = 'Geometry channel|Which of the three geometry fields to show: the shell-following texture coordinate S, the emission rim A, or the coverage. All three uses the classic red/green/blue diagnostic.';
function stageLegend(node) {
    const type = catalog[node.type].output, look = current?.target === node.id ? current.look : null, locked = state.lookLock?.target === node.id;
    const shown = locked ? state.lookLock.look : look, stats = shown?.stats;
    const colors = select('lookColors', state.prefs.stageColors, [['auto', 'Auto colors'], ['classic', 'Classic']], 'Stage colors|Auto colors use the values in view: a colormap with contour lines for numbers, a warped grid for coordinates, adjusted exposure for clipped layers. Classic is the fixed 1.x diagnostic.');
    const channel = type === 'geometry' ? select('lookChannel', state.prefs.geometryChannel, CHANNEL_OPTIONS, CHANNEL_TIP) : '';
    if (type === 'layer') {
        const gain = shown?.gain ?? 1, adjusted = shown?.mode === 'auto' && Math.abs(gain - 1) > 1e-6;
        const view = select('lookLayer', state.prefs.layerView, [['color', 'Color'], ['alpha', 'Coverage (alpha)']], 'Layer view|Its color as displayed, or its coverage (alpha) as gray: white is opaque, black transparent.');
        const auto = node.id === state.project.output ? '' : `<label class="legend-check" data-tip="Auto exposure|A layer stage that is almost entirely clipped or black at the scene exposure is shown brighter or darker so its structure is visible. The number is the extra exposure applied. Final image and exports are never adjusted."><input type="checkbox" id="lookExposure" ${state.prefs.autoExposure ? 'checked' : ''}> Auto exposure</label>`;
        const note = adjusted ? `<b class="legend-note">×${fmt(gain)} exposure</b><span class="muted">so it is not ${gain < 1 ? 'clipped white' : 'black'}</span>` : '<span class="muted">color layer · as displayed</span>';
        return withControls(note, `${auto}${view}`);
    }
    if (shown?.mode !== 'auto') {
        const classic = type === 'scalar' ? '<span class="ramp gray"></span><span class="mono">−2 0 +2</span><span class="muted">gray = ½ + ½·tanh(value)</span>'
            : type === 'coord' ? '<span class="swatch red"></span>½+½ sin x <span class="swatch green"></span>½+½ sin y <span class="muted">repeats every 2π</span>'
                : '<span class="swatch red"></span>4 × rim A <span class="swatch green"></span>coverage <span class="swatch blue"></span>warp S';
        return withControls(classic, `${channel}${colors}`);
    }
    if (type === 'coord') {
        return withControls(`<span class="legend-grid"></span><span>grid of the output coordinates, cell ${fmt(shown.step)}</span><span class="swatch red"></span><span>q<sub>x</sub> = 0</span><span class="swatch green"></span><span>q<sub>y</sub> = 0</span>`, colors);
    }
    if (shown.range?.constant) {
        return withControls(`<span>constant value <b class="mono">${fmt(shown.range.value)}</b></span>`, `${channel}${colors}`);
    }
    const contours = `<label class="legend-check" data-tip="Contour lines|Lines of equal value at round intervals${shown.range?.contour ? ` (every ${fmt(shown.range.contour)})` : ''}; the zero line of a signed field is brighter."><input type="checkbox" id="lookContours" ${state.prefs.contours ? 'checked' : ''}> Contours</label>`;
    return withControls(colorbar(shown, stats), `${channel}${contours}${lockButton(node.id)}${colors}`);
}
/** Legend HTML for the current canvas view, or '' when there is nothing to explain. */
function legendHTML() {
    if (state.compareOriginal) {
        return '<b>ORIGINAL</b> the scene as it was opened · release to return';
    }
    if (state.viewMode === 'effect') {
        return state.contributionStyle === 'signed'
            ? '<span class="swatch warm"></span>brighter with it <span class="swatch cool"></span>darker with it <span class="swatch black"></span>no change'
            : '<b>In color:</b> pixels this component changes · <b>gray:</b> unchanged';
    }
    if (state.viewMode !== 'stage') {
        return '';
    }
    return stageLegend(viewedNode());
}
export function refreshLegend() {
    const legend = $('legend'), html = legendHTML();
    legend.innerHTML = html;
    legend.hidden = !html;
    legend.classList.toggle('interactive', state.viewMode === 'stage' && !state.compareOriginal);
    refreshTip();
}
$('legend').addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'lookColors') {
        setPref('stageColors', e.target.value);
    }
    else if (id === 'lookChannel') {
        setPref('geometryChannel', e.target.value);
    }
    else if (id === 'lookLayer') {
        setPref('layerView', e.target.value);
    }
    else if (id === 'lookExposure') {
        setPref('autoExposure', e.target.checked);
    }
    else if (id === 'lookContours') {
        setPref('contours', e.target.checked);
    }
    else {
        return;
    }
    state.lookLock = null;
    resetLook();
});
$('legend').addEventListener('click', e => {
    if (e.target.closest('[data-legend-more]')) {
        $('legend').classList.toggle('expanded');
        return;
    }
    if (!e.target.closest('#lookLock')) {
        return;
    }
    const node = viewedNode();
    if (state.lookLock?.target === node.id) {
        state.lookLock = null;
    }
    else if (current?.target === node.id && current.look) {
        state.lookLock = { target: node.id, optionsKey: current.optionsKey, look: current.look };
    }
    state.dirty = true;
    refreshLegend();
});
on('view', () => {
    if (state.lookLock && (state.viewMode !== 'stage' || state.lookLock.target !== viewedNode().id)) {
        state.lookLock = null;
    }
    refreshLegend();
});
on('selection', refreshLegend);
on('prefs', refreshLegend);
on('refresh', refreshLegend);
