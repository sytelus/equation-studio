import { esc, state, showError, nodeById } from './editor.js';
import { catalog } from './catalog.js';
import { evaluationOrder, aspectOf } from './graph.js';
import { shownType } from './compiler.js';
import { analyzeCode, showable } from './glsl.js';
import { channelStats, histogram, loopReport, ownCosts } from './stats.js';
import { plotSVG } from './plot.js';
/** The Stats tab: measurements that explain a component's output.
 *
 *   Values       per-channel minimum, mean and maximum, the share of clipped,
 *                black and nonfinite pixels, and a histogram (measured at once,
 *                on a small raw render of what the canvas shows)
 *   Over the loop  mean brightness through the timeline, how much each frame
 *                differs from the next (motion), and whether the last frame leads
 *                smoothly into the first (a seamless loop)
 *   GPU time     how long each component's view takes to draw at the canvas
 *                size, and its own share (without its inputs)
 *   Inside the code  (shader code) the range of every variable, and how many
 *                steps each loop really takes per pixel
 *   Points       (point clouds) how much of the image the points cover and how
 *                dense they get
 *
 * The heavier measurements run when asked (a button), never behind the user's back.
 */
const SIZE = 160, LOOP_SIZE = 64, LOOP_FRAMES = 24;
const fmt = x => {
    if (!Number.isFinite(x)) {
        return Number.isNaN(x) ? '—' : String(x);
    }
    const a = Math.abs(x);
    return a !== 0 && (a < 1e-3 || a >= 1e5) ? x.toExponential(2) : String(Number(x.toPrecision(4)));
};
const pct = x => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`;
/** The value of `n` the canvas shows: 0 for its output, k for variable k of shader code. */
function shownIndex(n) {
    return state.show?.node === n.id && state.viewMode === 'stage' ? state.show.index : 0;
}
function sizeFor(width) {
    return [width, Math.max(1, Math.round(width / aspectOf(state.project)))];
}
function measureImage(v, n) {
    const renderer = state.renderer, show = shownIndex(n), key = JSON.stringify([n.id, show, state.time, state.project.nodes, state.project.view, state.project.tracks]);
    if (!renderer?.info.rawFields || v.ui.stats?.imageKey === key) {
        return;
    }
    v.ui.stats = { ...v.ui.stats, imageKey: key, image: null };
    const [w, h] = sizeFor(SIZE), type = shownType(state.project, n.id, show);
    renderer.rawImage(JSON.parse(JSON.stringify(state.project)), state.time, n.id, w, h, { async: true, show }).then(values => {
        if (v.ui.stats?.imageKey !== key) {
            return;
        }
        v.ui.stats.image = { type, stats: channelStats(values, type), histogram: histogram(values, type), size: [w, h], time: state.time };
        if (v.ui.tab === 'stats') {
            v.render();
        }
    }, e => showError(e));
}
export function statsTab(v, n) {
    v.ui.stats ??= {};
    measureImage(v, n);
    return imageSection(v, n) + (catalog[n.type].points ? pointsSection(v, n) : '') + loopSection(v, n) + (catalog[n.type].code ? codeSection(v, n) : '') + costSection(v, n);
}
function imageSection(v, n) {
    const s = v.ui.stats?.image, show = shownIndex(n);
    let what = 'its output';
    if (show) {
        try {
            what = `the variable ${showable(analyzeCode(n.params.code))[show - 1].name}`;
        }
        catch (e) { /* the code changed */
        }
    }
    if (!state.renderer?.info.rawFields) {
        return v.section('values', 'VALUES', '<p class="muted small-note">Measuring values needs floating-point render targets (EXT_color_buffer_float), which this browser or GPU does not offer.</p>');
    }
    if (!s) {
        return v.section('values', 'VALUES', '<p class="muted small-note">Measuring…</p>');
    }
    const rows = s.stats.channels.map(c => `<tr><th>${esc(c.name)}</th><td>${fmt(c.min)}</td><td>${fmt(c.mean)}</td><td>${fmt(c.max)}</td><td>${fmt(c.std)}</td></tr>`).join('');
    const notes = [];
    if (s.type === 'layer') {
        notes.push(`<span data-tip="Clipped|Pixels where a color channel is above 1: the display shows them as full brightness, so detail there is lost unless you lower the exposure.">${pct(s.stats.clipped)} clipped</span>`, `<span data-tip="Black|Pixels darker than one display step in every channel.">${pct(s.stats.black)} black</span>`);
    }
    if (s.stats.nonfinite) {
        notes.push(`<span class="warn" data-tip="Not a number|Pixels where the value is NaN or infinite (a division by zero, a log of a negative number…). The canvas shows them magenta.">${pct(s.stats.nonfinite)} not finite</span>`);
    }
    const h = s.histogram, bins = h.counts.length, label = s.type === 'layer' ? 'brightness' : s.type === 'coord' ? 'length |q|' : s.type === 'geometry' ? 'rim A' : 'value';
    const plot = plotSVG({ series: [{ bars: h.counts.map((c, k) => [h.lo + (k + 0.5) * (h.hi - h.lo) / bins, c / (s.size[0] * s.size[1])]) }], domain: [h.lo, h.hi], xLabel: label, yLabel: 'share of pixels', height: 120 });
    const body = `<p class="node-caption">Measured on ${s.size[0]} × ${s.size[1]} samples of ${esc(what)} at t = ${s.time.toFixed(2)} s, before display conversion.</p><table class="stats-table"><thead><tr><th></th><th>min</th><th>mean</th><th>max</th><th>spread</th></tr></thead><tbody>${rows}</tbody></table>${notes.length ? `<p class="stats-notes">${notes.join(' · ')}</p>` : ''}<div class="stats-plot">${plot}</div>`;
    const tools = '<button class="link" data-action="measure-image" data-tip="Measure again|Measure at the current playhead and settings.">↻</button>';
    return v.section('values', 'VALUES', body, { tools, tip: 'Values|What the numbers are, not just their colors: the range and average of each channel, and how they are distributed (the histogram). “Spread” is the standard deviation.' });
}
function pointsSection(v, n) {
    const s = v.ui.stats?.image;
    if (!s || s.type !== 'layer') {
        return '';
    }
    const alpha = s.stats.channels[3];
    const count = Math.round(n.params.count);
    const body = `<p class="node-caption">${count.toLocaleString('en')} points per frame, each ${fmt(n.params.alpha)} opaque. Where points overlap, the coverage adds up toward 1.</p><table class="stats-table"><tbody><tr><th>mean coverage</th><td>${fmt(alpha.mean)}</td></tr><tr><th>densest pixel</th><td>${fmt(alpha.max)}</td></tr></tbody></table>`;
    return v.section('points', 'POINTS', body, { tip: 'Points|How the dots fill the image: the coverage (alpha) of the layer is the opacity built up by overlapping points.' });
}
function loopSection(v, n) {
    const r = v.ui.stats?.loop;
    let body;
    if (!r) {
        body = `<p class="node-caption">Render ${LOOP_FRAMES + 1} frames across the ${state.project.duration} s timeline and measure how the image changes: its brightness through time, the motion between frames, and whether the end joins the beginning without a jump.</p>`;
    }
    else if (r.running) {
        body = `<p class="node-caption">Rendering frame ${r.done} of ${LOOP_FRAMES + 1}…</p>`;
    }
    else {
        const T = r.duration, times = r.report.means.map((_, k) => T * k / LOOP_FRAMES);
        const mean = plotSVG({ series: [{ points: times.map((t, k) => [t, r.report.means[k]]), label: 'mean' }], domain: [0, T], xLabel: 'time (s)', yLabel: r.type === 'layer' ? 'mean brightness' : 'mean value', height: 110, marks: [{ x: state.time, label: 'now' }] });
        const motion = plotSVG({ series: [{ bars: r.report.steps.map((d, k) => [T * (k + 0.5) / LOOP_FRAMES, d]) }], domain: [0, T], xLabel: 'time (s)', yLabel: 'change per frame', height: 110 });
        const verdict = r.report.still
            ? '<p class="stats-verdict">Nothing moves: every frame is the same.</p>'
            : r.report.seamless
                ? `<p class="stats-verdict ok" data-tip="Seamless|The difference between the last and the first frame (${fmt(r.report.seam)}) is no larger than between neighbouring frames (${fmt(r.report.typical)}): played in a loop, there is no jump.">✓ Seamless loop: the end leads into the beginning like any other frame.</p>`
                : `<p class="stats-verdict warn" data-tip="A jump|The last frame differs from the first ${fmt(r.report.seam / Math.max(r.report.typical, 1e-9))} times as much as neighbouring frames do. Make the duration a whole number of the motion's periods (often 2π s).">⚠ The loop jumps: the end differs from the beginning ${fmt(r.report.seam / Math.max(r.report.typical, 1e-9))}× more than neighbouring frames.</p>`;
        body = `${verdict}<div class="stats-plot">${mean}</div><div class="stats-plot">${motion}</div><p class="node-caption">${LOOP_FRAMES + 1} frames of ${r.size[0]} × ${r.size[1]} samples. Peaks in the change show when things move fastest.</p>`;
    }
    const tools = `<button class="link" data-action="measure-loop" ${r?.running ? 'disabled' : ''} data-tip="Measure the loop|Renders the component at ${LOOP_FRAMES + 1} moments of the timeline (small, a few seconds at most).">▶ Measure</button>`;
    return v.section('loopstats', 'OVER THE LOOP', body, { tools, tip: 'Over the loop|How the output evolves through the timeline, and whether the animation loops without a visible jump.' });
}
async function measureLoop(v, n) {
    const renderer = state.renderer, show = shownIndex(n), project = JSON.parse(JSON.stringify(state.project)), [w, h] = sizeFor(LOOP_SIZE), type = shownType(project, n.id, show);
    v.ui.stats.loop = { running: true, done: 0 };
    v.render();
    const frames = [];
    try {
        for (let k = 0; k <= LOOP_FRAMES; k++) {
            frames.push(await renderer.rawImage(project, project.duration * k / LOOP_FRAMES, n.id, w, h, { async: true, show }));
            v.ui.stats.loop.done = k + 1;
            if (k % 4 === 0 && v.ui.tab === 'stats') {
                v.render();
            }
        }
        v.ui.stats.loop = { running: false, report: loopReport(frames, type), duration: project.duration, size: [w, h], type };
    }
    catch (e) {
        v.ui.stats.loop = null;
        showError(e);
    }
    if (v.ui.tab === 'stats') {
        v.render();
    }
}
function codeSection(v, n) {
    const r = v.ui.stats?.vars;
    let analysis;
    try {
        analysis = analyzeCode(n.params.code);
    }
    catch (e) {
        return '';
    }
    let body;
    if (!r) {
        body = '<p class="node-caption">Measure the range of every variable of the code over the image, and how many steps each loop really takes per pixel (loops that can stop early may take far fewer than their limit).</p>';
    }
    else if (r.running) {
        body = '<p class="node-caption">Measuring…</p>';
    }
    else {
        const rows = r.rows.map(row => `<tr><th class="mono" data-tip="${esc(row.name)}|${esc(row.where)}">${esc(row.name)}</th>${row.channels.map(c => `<td>${fmt(c.min)} … ${fmt(c.max)}</td>`).join('')}${'<td></td>'.repeat(Math.max(0, 2 - row.channels.length))}<td>${fmt(row.channels[0].mean)}</td></tr>`).join('');
        body = `<table class="stats-table vars"><thead><tr><th>value</th><th>range (x)</th><th>(y …)</th><th>mean</th></tr></thead><tbody>${rows}</tbody></table><p class="node-caption">Over ${r.size[0]} × ${r.size[1]} samples at t = ${r.time.toFixed(2)} s, after the loops (as far as their sliders let them run). For a vector the columns are its first components.</p>`;
    }
    const tools = `<button class="link" data-action="measure-vars" ${r?.running ? 'disabled' : ''} data-tip="Measure the variables|One small render per variable (${showable(analysis).length} in all).">▶ Measure</button>`;
    return v.section('varstats', 'INSIDE THE CODE', body, { tools, tip: 'Inside the code|The values the code computes along the way: the depth a raymarcher reached, the distance it ended at, the scale of a fractal, how many steps each loop took.' });
}
async function measureVars(v, n) {
    const renderer = state.renderer, project = JSON.parse(JSON.stringify(state.project)), [w, h] = sizeFor(96), time = state.time;
    const analysis = analyzeCode(n.params.code), list = showable(analysis);
    v.ui.stats.vars = { running: true };
    v.render();
    try {
        const rows = [];
        for (let k = 0; k < list.length; k++) {
            const item = list[k], values = await renderer.rawImage(project, time, n.id, w, h, { async: true, show: k + 1 });
            const type = item.type === 'vec2' ? 'coord' : ['vec3', 'vec4'].includes(item.type) ? 'layer' : 'scalar';
            const stats = channelStats(values, type);
            rows.push({ name: item.name, where: item.kind === 'steps' ? `Steps loop ${item.loop + 1} took per pixel.` : `${item.type}, declared on line ${item.line}.`, channels: stats.channels.slice(0, Math.min(stats.channels.length, { vec3: 3, vec4: 4, vec2: 2 }[item.type] || 1)).slice(0, 2) });
        }
        v.ui.stats.vars = { running: false, rows, size: [w, h], time };
    }
    catch (e) {
        v.ui.stats.vars = null;
        showError(e);
    }
    if (v.ui.tab === 'stats') {
        v.render();
    }
}
function costSection(v, n) {
    const r = v.ui.stats?.cost;
    let body;
    if (!r) {
        body = '<p class="node-caption">Time how long the GPU takes to draw each component’s view at the canvas size. The page pauses for a moment while it measures.</p>';
    }
    else {
        const max = Math.max(...Object.values(r.times), 1e-6);
        const rows = r.order.map(id => {
            const node = nodeById(id);
            if (!node) {
                return '';
            }
            return `<tr class="${id === n.id ? 'self' : ''}"><th>${esc(node.label)}</th><td>${r.times[id].toFixed(2)} ms</td><td>${r.own[id].toFixed(2)} ms</td><td class="bar-cell"><span class="cost-bar" style="width:${(r.own[id] / max * 100).toFixed(1)}%"></span></td></tr>`;
        }).join('');
        body = `<table class="stats-table cost"><thead><tr><th>component</th><th data-tip="With its inputs|Drawing this component’s view, which also computes everything it reads.">view</th><th data-tip="Own|The view’s time minus the slowest of its inputs: roughly what this component itself costs.">own</th><th></th></tr></thead><tbody>${rows}</tbody></table><p class="node-caption">At ${r.size[0]} × ${r.size[1]} pixels on ${esc(state.renderer.info.gpu?.name || state.renderer.info.renderer)}. ${r.frameRate}</p>`;
    }
    const tools = '<button class="link" data-action="measure-cost" data-tip="Measure GPU time|Draws each component’s view a few times and times it. Blocks the page for a moment.">⏱ Measure</button>';
    return v.section('cost', 'GPU TIME', body, { tools, tip: 'GPU time|Where the time of a frame goes. The final image costs what all its components cost; a slow component can be sped up by its parameters (fewer loop steps, fewer octaves) or a lower preview resolution.' });
}
function measureCost(v, n) {
    const renderer = state.renderer, project = state.project, canvas = renderer.canvas, size = [canvas.width, canvas.height];
    try {
        const order = evaluationOrder(project).map(x => x.id), times = {};
        for (const id of order) {
            times[id] = renderer.measure(project, state.time, size[0], size[1], { target: id, subgraph: true });
        }
        const own = ownCosts(times, id => Object.values(nodeById(id).inputs).filter(Boolean));
        const total = times[project.output];
        const frameRate = total > 0 ? `The final image takes ${total.toFixed(1)} ms: at most ${Math.floor(1000 / total)} frames per second at this size.` : '';
        v.ui.stats.cost = { order, times, own, size, frameRate };
    }
    catch (e) {
        showError(e);
    }
    v.render();
}
/** Handle a Stats action; returns true when it was one. */
export function statsAction(v, n, action) {
    switch (action) {
        case 'measure-image':
            v.ui.stats = { ...v.ui.stats, imageKey: null };
            v.render();
            return true;
        case 'measure-loop':
            measureLoop(v, n);
            return true;
        case 'measure-vars':
            measureVars(v, n);
            return true;
        case 'measure-cost':
            measureCost(v, n);
            return true;
        default:
            return false;
    }
}
