import { $, esc, state, on, setPref, viewedNode, currentNode } from './editor.js';
import { catalog } from './catalog.js';
import { pixelToWorld } from './view-math.js';
import { plotSVG } from './plot.js';
import { fieldStats } from './looks.js';
/** The profile under the canvas: the actual values of the component shown, along
 * the horizontal (or vertical) line through the cursor, the pinned reading, or
 * the center of the view. Seeing f(x) as a curve explains a field far better
 * than its colors: a Gaussian's bump, a threshold's step, a fold's zigzag.
 *
 * Values come from the renderer's line probe (raw floats, read back without
 * blocking) and are resampled only when the frame or the line changed.
 */
const SAMPLES = 256;
const CHANNELS = {
    scalar: [['value', '#e6b37f']],
    coord: [['q_x', '#f07f76'], ['q_y', '#74dc8f']],
    geometry: [['S (warp)', '#c6a0e7'], ['A (rim)', '#e6b37f'], ['coverage', '#91bce3']],
    layer: [['R', '#ff7070'], ['G', '#6bdc8a'], ['B', '#6ba8ff'], ['alpha', '#b9c2c7']]
};
let point = null, pending = false, lastKey = '', result = null;
export function scopeVisible() {
    return !$('scope').hidden;
}
export function setScopeVisible(visible, { remember = true } = {}) {
    $('scope').hidden = !visible;
    $('scopeButton').classList.toggle('active', visible);
    $('scopeButton').setAttribute('aria-pressed', String(visible));
    lastKey = '';
    if (remember) {
        setPref('scope', visible);
    }
    state.overlayDirty = true;
}
/** Move the profile line through a world point (from the cursor or a pin). */
export function setScopePoint(world) {
    point = world ? { x: world.x, y: world.y } : null;
    state.overlayDirty = true;
}
/** The component the profile samples: the stage shown, else the selection. */
function scopeNode() {
    return state.viewMode === 'stage' ? viewedNode() : currentNode();
}
/** The sampled segment in world coordinates: {a: [x, y], b: [x, y], axis, cross}. */
export function scopeLine() {
    if (!scopeVisible()) {
        return null;
    }
    const canvas = $('artCanvas'), view = state.project.view, w = canvas.width, h = canvas.height;
    const low = pixelToWorld(0, 0, w, h, view), high = pixelToWorld(w, h, w, h, view);
    const center = { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2 }, at = (state.probePin && pixelToWorld(state.probePin.px, state.probePin.py, w, h, view)) || point || center;
    const axis = $('scopeAxis').value;
    return axis === 'v'
        ? { a: [at.x, low.y], b: [at.x, high.y], axis, cross: at.y, fixed: at.x }
        : { a: [low.x, at.y], b: [high.x, at.y], axis, cross: at.x, fixed: at.y };
}
const fmt = v => {
    const a = Math.abs(v);
    return !Number.isFinite(v) ? String(v) : a !== 0 && (a < 1e-3 || a >= 1e5) ? v.toExponential(2) : String(Number(v.toPrecision(4)));
};
function draw() {
    if (!result) {
        return;
    }
    const { values, line, node, type } = result, channels = CHANNELS[type];
    const along = i => line.axis === 'h' ? line.a[0] + (line.b[0] - line.a[0]) * (i + 0.5) / SAMPLES : line.a[1] + (line.b[1] - line.a[1]) * (i + 0.5) / SAMPLES;
    const domain = [along(0), along(SAMPLES - 1)];
    const plotted = channels.map(([label, color], c) => {
        const points = [];
        for (let i = 0; i < SAMPLES; i++) {
            const v = values[i * 4 + c];
            if (Number.isFinite(v)) {
                points.push([along(i), v]);
            }
        }
        return { label, color, points };
    });
    const marks = [{ x: line.cross, label: line.axis === 'h' ? `x = ${fmt(line.cross)}` : `y = ${fmt(line.cross)}` }];
    const width = Math.max(320, Math.round($('scopePlot').clientWidth || 640));
    $('scopePlot').innerHTML = plotSVG({ series: plotted, domain, xLabel: line.axis === 'h' ? `x (along y = ${fmt(line.fixed)})` : `y (along x = ${fmt(line.fixed)})`, yLabel: type === 'layer' ? 'radiance' : 'value', marks, width, height: 150, samples: SAMPLES });
    $('scopeTitle').innerHTML = `${esc(node.label)} <span class="muted">· ${esc(type === 'layer' ? 'radiance before exposure and tone mapping' : type === 'coord' ? 'output coordinates' : type === 'geometry' ? 'the three geometry fields' : 'raw values')}</span>`;
    $('scopeStats').innerHTML = channels.map(([label, color], c) => {
        const s = fieldStats(values, { channel: c });
        return s.count ? `<span><i style="background:${color}"></i>${esc(label)} ${fmt(s.min)} … ${fmt(s.max)} <span class="muted">mean ${fmt(s.mean)}</span></span>` : `<span><i style="background:${color}"></i>${esc(label)} not finite</span>`;
    }).join('');
}
/** Called by the frame loop: resample when the frame or the line changed. */
export function updateScope() {
    const renderer = state.renderer;
    if (!scopeVisible() || !renderer || pending || state.busy) {
        return;
    }
    if (!renderer.info.rawFields) {
        $('scopePlot').innerHTML = '<p class="muted">Profiles need float framebuffers (EXT_color_buffer_float), which this browser or GPU does not offer.</p>';
        return;
    }
    const node = scopeNode(), line = scopeLine(), project = state.preview || state.project;
    if (!node || !line || !project.nodes.some(n => n.id === node.id) || renderer.programFor(project).status !== 'ready') {
        return;
    }
    const key = `${node.id}|${state.time}|${JSON.stringify(line)}|${JSON.stringify(project.nodes)}|${JSON.stringify(project.tracks)}`;
    if (key === lastKey) {
        return;
    }
    lastKey = key;
    pending = true;
    const type = catalog[node.type].output;
    try {
        renderer.sampleLine(project, state.time, node.id, line.a, line.b, SAMPLES, { async: true }).then(values => {
            pending = false;
            result = { values, line, node, type };
            draw();
        }, () => {
            pending = false;
        });
    }
    catch (e) {
        pending = false;
        $('scopePlot').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
}
$('scopeButton').onclick = () => setScopeVisible(!scopeVisible());
$('scopeClose').onclick = () => setScopeVisible(false);
$('scopeAxis').onchange = () => {
    lastKey = '';
    state.overlayDirty = true;
};
setScopeVisible(!!state.prefs.scope, { remember: false });
new ResizeObserver(() => draw()).observe($('scopePlot'));
on('refresh', () => lastKey = '');
