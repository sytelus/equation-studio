import { $, esc, state, on, toast, showError, transact, history, changed, markDirty, pause, currentNode, viewedNode, viewOptions, setView, setContributionStyle, setPref, clamp } from './editor.js';
import { catalog } from './catalog.js';
import { clone } from './graph.js';
import { pixelToWorld, worldToPixel, clientToPixel, zoomAbout, panBy, unitsPerPixel, tickSpacing, formatTick } from './view-math.js';
import { refreshTip } from './ui-tooltip.js';
/** Center panel: the live canvas and its view switch, camera gestures, rulers and
 * readouts, the diagnostic legend, reference comparison and the canvas toolbar.
 */
const app = $('app'), canvas = $('artCanvas'), overlay = $('overlay'), probeNames = { scalar: ['value'], coord: ['x', 'y'], geometry: ['S / warp', 'A / rim', 'coverage'], layer: ['R', 'G', 'B', 'alpha'] };
let lastProgram = null, rawProbeArmed = false, referenceURL = null, hover = null, pinReadout = null, hoverStamp = 0;
let gesture = null, pinch = null, wheelBefore = null, wheelTimer;
/** What the last frame drew: needed so readouts query the same project. */
let drawn = { project: null, target: null };
const pointers = new Map();
export function armProbe() {
    rawProbeArmed = true;
    toast('Click a point on the artwork to read the shown component’s raw field value. Alt-click also probes; Rulers show it continuously.');
}
/** Legend explaining the false colors of a non-layer stage, or the effect view. */
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
    const type = catalog[viewedNode().type].output;
    if (type === 'scalar') {
        return '<span class="ramp gray"></span><span>−2</span><span>0</span><span>+2</span> gray = ½ + ½·tanh(value) · Rulers show exact values';
    }
    if (type === 'coord') {
        return '<span class="swatch red"></span>red = ½+½ sin x <span class="swatch green"></span>green = ½+½ sin y · repeats every 2π';
    }
    if (type === 'geometry') {
        return '<span class="swatch red"></span>red = 4 × rim A <span class="swatch green"></span>green = coverage <span class="swatch blue"></span>blue = warp S';
    }
    return '';
}
export function refreshView() {
    const project = state.project, node = viewedNode(), mode = state.viewMode;
    document.querySelectorAll('[data-view]').forEach(b => {
        const active = b.dataset.view === mode;
        b.classList.toggle('active', active);
        b.setAttribute('aria-checked', String(active));
    });
    $('viewSubject').hidden = mode === 'final';
    $('viewSubject').innerHTML = mode === 'final' ? '' : `<span class="type-dot ${catalog[node.type].output}"></span>${esc(node.label)}`;
    $('viewLock').hidden = mode === 'final';
    $('viewLock').classList.toggle('active', !!state.viewLock);
    $('viewLock').setAttribute('aria-pressed', String(!!state.viewLock));
    $('viewLock').textContent = state.viewLock ? '🔒' : '🔓';
    $('effectStyle').hidden = mode !== 'effect';
    $('effectStyle').value = state.contributionStyle;
    $('sceneStatus').textContent = project.status || 'Custom construction';
    $('sceneStatus').classList.toggle('study', project.status === 'Interpretive study');
    const legend = legendHTML();
    $('legend').innerHTML = legend;
    $('legend').hidden = !legend;
    $('holdOriginal').classList.toggle('active', state.compareOriginal);
    $('clearPin').hidden = !state.probePin;
    for (const [id, key] of [['rulersButton', 'rulers'], ['gridButton', 'grid']]) {
        $(id).classList.toggle('active', state.prefs[key]);
        $(id).setAttribute('aria-pressed', String(state.prefs[key]));
    }
    refreshTip();
}
export function resizeImage() {
    const stage = $('stage'), pad = innerWidth < 650 ? 24 : innerWidth < 1200 ? 36 : 56;
    const width = Math.max(10, Math.min(stage.clientWidth - pad, (stage.clientHeight - 42) * 5 / 3));
    $('imageWrap').style.width = `${width}px`;
    state.overlayDirty = true;
}
/** Project and renderer options for the next frame: the held original, an
 * exploration candidate under the pointer, or the real project in the chosen view.
 */
function frameSource() {
    if (state.compareOriginal) {
        return { project: state.baseline, options: { target: state.baseline.output } };
    }
    return { project: state.preview || state.project, options: viewOptions() };
}
/** Draw the current view to the canvas; called by the frame loop when dirty. */
export function renderFrame() {
    const renderer = state.renderer;
    if (!renderer) {
        return;
    }
    const width = state.prefs.quality, height = Math.round(width * .6);
    try {
        const start = performance.now(), { project, options } = frameSource();
        state.compiled = renderer.draw(project, state.time, width, height, options);
        drawn = { project, target: options.contribution ? null : options.target };
        if (renderer.current !== lastProgram) {
            lastProgram = renderer.current;
            $('shaderView').textContent = state.compiled.fragment;
        }
        const ms = performance.now() - start;
        state.frameCount++;
        $('renderStats').textContent = `${width} × ${height}${state.playing ? ` · ${state.fps.toFixed(0)} fps` : ''}`;
        $('liveStats').textContent = `${width}×${height} · ${ms < 1 ? '<1' : ms.toFixed(0)} ms · frame ${state.frameCount}`;
        $('liveBadge').classList.remove('pulse');
        void $('liveBadge').offsetWidth; // restart the pulse animation
        $('liveBadge').classList.add('pulse');
        if (state.probePin) {
            pinReadout = readout(state.probePin.px, state.probePin.py, true);
        }
    }
    catch (e) {
        pause();
        showError(e);
        $('renderStats').textContent = 'Render error · last good image retained';
    }
}
// ---- Readouts ----------------------------------------------------------------
/** Component whose raw values the readouts report: the shown stage, else the selection. */
function readoutNode() {
    const node = state.viewMode === 'stage' ? viewedNode() : currentNode();
    return drawn.project?.nodes.some(n => n.id === node.id) ? node : null;
}
/** Everything known about one framebuffer pixel: world position, displayed color
 * and (optionally) the raw field of the shown or selected component.
 */
function readout(px, py, raw) {
    const { renderer } = state, project = drawn.project || state.project, view = project.view;
    const col = Math.floor(px), row = Math.floor(py), world = pixelToWorld(col + .5, row + .5, canvas.width, canvas.height, view);
    const result = { px, py, x: world.x, y: world.y, col, rowFromTop: canvas.height - 1 - row, rgb: null, raw: null, rawError: null };
    if (!renderer || !renderer.current) {
        return result;
    }
    try {
        result.rgb = renderer.probe(px, py).slice(0, 3);
    }
    catch (e) { /* Context loss is reported by the renderer's event handler. */
    }
    const node = readoutNode();
    if (raw && node && renderer.info.rawFields && Math.abs(world.x) <= 19 && Math.abs(world.y) <= 19) {
        try {
            const values = renderer.samplePoint(project, state.time, node.id, world.x, world.y), names = probeNames[catalog[node.type].output];
            result.raw = { label: node.label, entries: names.map((name, i) => [name, values[i]]) };
        }
        catch (e) {
            result.rawError = e.message;
        }
    }
    return result;
}
function readoutLines(r) {
    const lines = [`x ${r.x.toFixed(4)}   y ${r.y.toFixed(4)}`, `pixel ${r.col}, ${r.rowFromTop}`];
    if (r.rgb) {
        lines.push(`rgb ${r.rgb.join(' ')}   #${r.rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`);
    }
    if (r.raw) {
        lines.push(`${r.raw.label}: ${r.raw.entries.map(([name, value]) => `${name} ${Number(value.toPrecision(5))}`).join(' · ')}`);
    }
    return lines;
}
function updateProbeText(r) {
    $('probe').textContent = r ? `p(${r.x.toFixed(3)}, ${r.y.toFixed(3)}) · px ${r.col},${r.rowFromTop}${r.rgb ? ` · RGB ${r.rgb.join(' ')}` : ''}${r.raw ? ` · ${r.raw.entries.map(([name, value]) => `${name} ${Number(value.toPrecision(4))}`).join(' ')}` : ''}` : 'Drag to pan · scroll to zoom';
}
// ---- Overlay: rulers, grid, crosshair and labels --------------------------------
function drawLabel(ctx, lines, x, y, width, height) {
    ctx.font = '10px SFMono-Regular, Consolas, "Liberation Mono", monospace';
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14, h = lines.length * 14 + 8;
    let left = x + 14, top = y + 14;
    if (left + w > width - 4) {
        left = x - w - 10;
    }
    if (top + h > height - 4) {
        top = y - h - 10;
    }
    left = clamp(left, 2, Math.max(2, width - w - 2));
    top = clamp(top, 2, Math.max(2, height - h - 2));
    ctx.fillStyle = 'rgba(12,18,20,0.86)';
    ctx.strokeStyle = 'rgba(165,242,207,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(left, top, w, h, 4);
    }
    else {
        ctx.rect(left, top, w, h);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e6eae9';
    lines.forEach((line, i) => ctx.fillText(line, left + 7, top + 14 + i * 14));
}
export function drawOverlay() {
    const rect = canvas.getBoundingClientRect(), W = Math.round(rect.width), H = Math.round(rect.height);
    if (!W || !H) {
        return;
    }
    const dpr = Math.min(devicePixelRatio || 1, 3);
    if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(H * dpr)) {
        overlay.width = Math.round(W * dpr);
        overlay.height = Math.round(H * dpr);
    }
    const ctx = overlay.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { rulers, grid } = state.prefs, view = state.project.view, scale = canvas.width / W;
    const toCss = (x, y) => {
        const { px, py } = worldToPixel(x, y, canvas.width, canvas.height, view);
        return [px / scale, H - py / scale];
    };
    if (grid || rulers) {
        const unit = unitsPerPixel(canvas.width, view.zoom) * scale, step = tickSpacing(unit, 72), minor = step / 5;
        const low = pixelToWorld(0, 0, canvas.width, canvas.height, view), high = pixelToWorld(canvas.width, canvas.height, canvas.width, canvas.height, view);
        const ticks = (from, to) => {
            const list = [];
            for (let v = Math.ceil(from / minor - 1e-9) * minor; v <= to + 1e-9; v += minor) {
                const value = Math.abs(v) < minor / 2 ? 0 : v;
                list.push({ value, major: Math.abs(value / step - Math.round(value / step)) < 1e-6 });
            }
            return list;
        };
        if (grid) {
            for (const t of ticks(low.x, high.x)) {
                const [cx] = toCss(t.value, 0);
                ctx.strokeStyle = t.value === 0 ? 'rgba(165,242,207,0.55)' : t.major ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
                ctx.beginPath();
                ctx.moveTo(Math.round(cx) + .5, 0);
                ctx.lineTo(Math.round(cx) + .5, H);
                ctx.stroke();
            }
            for (const t of ticks(low.y, high.y)) {
                const [, cy] = toCss(0, t.value);
                ctx.strokeStyle = t.value === 0 ? 'rgba(165,242,207,0.55)' : t.major ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
                ctx.beginPath();
                ctx.moveTo(0, Math.round(cy) + .5);
                ctx.lineTo(W, Math.round(cy) + .5);
                ctx.stroke();
            }
        }
        if (rulers) {
            ctx.fillStyle = 'rgba(10,14,16,0.72)';
            ctx.fillRect(0, 0, W, 16);
            ctx.fillRect(0, 0, 16, H);
            ctx.font = '9px SFMono-Regular, Consolas, "Liberation Mono", monospace';
            ctx.fillStyle = '#cfe6da';
            ctx.strokeStyle = 'rgba(207,230,218,0.9)';
            ctx.textBaseline = 'top';
            for (const t of ticks(low.x, high.x)) {
                const [cx] = toCss(t.value, 0), x = Math.round(cx) + .5;
                ctx.beginPath();
                ctx.moveTo(x, t.major ? 8 : 12);
                ctx.lineTo(x, 16);
                ctx.stroke();
                if (t.major && cx > 18) {
                    ctx.fillText(formatTick(t.value, step), cx + 3, 2);
                }
            }
            for (const t of ticks(low.y, high.y)) {
                const [, cy] = toCss(0, t.value), y = Math.round(cy) + .5;
                ctx.beginPath();
                ctx.moveTo(t.major ? 8 : 12, y);
                ctx.lineTo(16, y);
                ctx.stroke();
                if (t.major && cy > 18) {
                    ctx.save();
                    ctx.translate(2, cy - 3);
                    ctx.rotate(-Math.PI / 2);
                    ctx.fillText(formatTick(t.value, step), 0, 0);
                    ctx.restore();
                }
            }
            const scale = `${formatTick(step, step)} / major tick`; // top-right, clear of the live badge
            ctx.fillStyle = 'rgba(10,14,16,0.9)';
            ctx.fillRect(W - ctx.measureText(scale).width - 12, 0, ctx.measureText(scale).width + 12, 16);
            ctx.fillStyle = '#9fb3aa';
            ctx.fillText(scale, W - ctx.measureText(scale).width - 6, 3);
            ctx.textBaseline = 'alphabetic';
        }
    }
    if (state.probePin && pinReadout) {
        const [cx, cy] = toCss(pinReadout.x, pinReadout.y);
        ctx.strokeStyle = '#ddad87';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.moveTo(cx - 10, cy);
        ctx.lineTo(cx + 10, cy);
        ctx.moveTo(cx, cy - 10);
        ctx.lineTo(cx, cy + 10);
        ctx.stroke();
        drawLabel(ctx, ['PINNED', ...readoutLines(pinReadout)], cx, cy, W, H);
    }
    if (hover && rulers) {
        const [cx, cy] = toCss(hover.x, hover.y);
        ctx.strokeStyle = 'rgba(165,242,207,0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + .5, 0);
        ctx.lineTo(Math.round(cx) + .5, H);
        ctx.moveTo(0, Math.round(cy) + .5);
        ctx.lineTo(W, Math.round(cy) + .5);
        ctx.stroke();
        ctx.setLineDash([]);
        drawLabel(ctx, readoutLines(hover), cx, cy, W, H);
    }
}
export function clearPin() {
    state.probePin = null;
    pinReadout = null;
    $('clearPin').hidden = true;
    state.overlayDirty = true;
}
export function hasPin() {
    return !!state.probePin;
}
// ---- Pointer gestures: pan, pinch, probe, hover --------------------------------
function framebufferPoint(e) {
    return clientToPixel(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
}
function commitView(before) {
    history.push(before);
    changed();
}
canvas.addEventListener('pointerdown', e => {
    if (state.busy || e.button !== 0) {
        return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) { // second finger: switch from panning to pinching
        const [a, b] = [...pointers.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, fb = clientToPixel(mid.x, mid.y, canvas.getBoundingClientRect(), canvas.width, canvas.height);
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), mid, world: pixelToWorld(fb.px, fb.py, canvas.width, canvas.height, state.project.view), view: { ...state.project.view }, before: gesture?.before || clone(state.project) };
        gesture = null;
        return;
    }
    if (rawProbeArmed || e.altKey) {
        rawProbeArmed = false;
        const { px, py } = framebufferPoint(e), r = readout(px, py, true);
        if (r.rawError) {
            showError(r.rawError);
        }
        else if (r.raw) {
            toast(`Raw ${r.raw.label} at (${r.x.toFixed(5)}, ${r.y.toFixed(5)})\n${r.raw.entries.map(([name, value]) => `${name}: ${value.toPrecision(7)}`).join(' · ')}`);
        }
        else {
            showError('Raw probes need the GPU and EXT_color_buffer_float.');
        }
        pointers.delete(e.pointerId);
        return;
    }
    gesture = { x: e.clientX, y: e.clientY, view: { ...state.project.view }, before: clone(state.project), moved: false };
});
canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        let view = zoomAbout(pinch.view, pinch.view.zoom * distance / Math.max(pinch.distance, 1), pinch.world.x, pinch.world.y);
        const scale = canvas.width / rect.width;
        view = panBy(view, (mid.x - pinch.mid.x) * scale, -(mid.y - pinch.mid.y) * scale, canvas.width);
        state.project.view = view;
        markDirty();
        return;
    }
    if (gesture) {
        const scale = canvas.width / rect.width;
        if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 3) {
            gesture.moved = true;
        }
        state.project.view = panBy(gesture.view, (e.clientX - gesture.x) * scale, -(e.clientY - gesture.y) * scale, canvas.width);
        markDirty();
        return;
    }
    if (!state.renderer?.current || performance.now() - hoverStamp < (state.prefs.rulers ? 50 : 120)) {
        return;
    }
    hoverStamp = performance.now();
    const { px, py } = framebufferPoint(e);
    hover = readout(px, py, state.prefs.rulers);
    updateProbeText(hover);
    state.overlayDirty = true;
});
function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
        if (pointers.size < 2) {
            commitView(pinch.before);
            pinch = null;
        }
        return;
    }
    if (!gesture) {
        return;
    }
    const g = gesture;
    gesture = null;
    if (g.moved) {
        commitView(g.before);
    }
    else if (state.prefs.rulers && e.type === 'pointerup') { // a click pins the readout
        const { px, py } = framebufferPoint(e);
        state.probePin = { px, py };
        pinReadout = readout(px, py, true);
        $('clearPin').hidden = false;
        state.overlayDirty = true;
    }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
    hover = null;
    updateProbeText(null);
    state.overlayDirty = true;
});
canvas.addEventListener('wheel', e => {
    if (state.busy) {
        return;
    }
    e.preventDefault();
    if (!wheelBefore) {
        wheelBefore = clone(state.project);
    }
    const { px, py } = framebufferPoint(e), world = pixelToWorld(px, py, canvas.width, canvas.height, state.project.view);
    state.project.view = zoomAbout(state.project.view, state.project.view.zoom * Math.exp(-e.deltaY * .001), world.x, world.y);
    markDirty();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
        if (wheelBefore) {
            commitView(wheelBefore);
            wheelBefore = null;
        }
    }, 250);
}, { passive: false });
// ---- Canvas toolbar ------------------------------------------------------------
$('resetView').onclick = () => transact(p => p.view = { x: 0, y: 0, zoom: 1 });
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$('viewLock').onclick = () => setView(state.viewMode, { lock: !state.viewLock });
$('effectStyle').onchange = e => setContributionStyle(e.target.value);
/** While held, the canvas shows the scene exactly as it was opened. */
export function setCompareOriginal(on) {
    if (state.compareOriginal === on) {
        return;
    }
    state.compareOriginal = on;
    markDirty();
    refreshView();
}
const hold = $('holdOriginal');
hold.addEventListener('pointerdown', e => {
    hold.setPointerCapture(e.pointerId);
    setCompareOriginal(true);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    hold.addEventListener(type, () => setCompareOriginal(false));
}
hold.addEventListener('keydown', e => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        setCompareOriginal(true);
    }
});
hold.addEventListener('keyup', () => setCompareOriginal(false));
$('clearPin').onclick = clearPin;
$('rulersButton').onclick = () => setPref('rulers', !state.prefs.rulers);
$('gridButton').onclick = () => setPref('grid', !state.prefs.grid);
$('quality').value = String(state.prefs.quality);
if ($('quality').value !== String(state.prefs.quality)) { // unknown stored value
    state.prefs.quality = Number($('quality').value);
}
$('quality').onchange = () => setPref('quality', Number($('quality').value));
$('focusButton').onclick = () => {
    app.classList.toggle('focus-canvas');
    $('focusButton').setAttribute('aria-pressed', String(app.classList.contains('focus-canvas')));
    resizeImage();
};
// "⋯" menu for less frequent canvas actions; any choice or outside click closes it.
$('moreButton').onclick = e => {
    e.stopPropagation();
    $('moreMenu').hidden = !$('moreMenu').hidden;
    $('moreButton').setAttribute('aria-expanded', String(!$('moreMenu').hidden));
};
document.addEventListener('click', e => {
    if (!$('moreMenu').hidden && (!$('moreMenu').contains(e.target) || e.target.closest('button'))) {
        $('moreMenu').hidden = true;
        $('moreButton').setAttribute('aria-expanded', 'false');
    }
});
$('copyImage').onclick = async () => {
    if (!state.renderer) {
        showError('A working WebGL 2 context is required.');
        return;
    }
    try {
        if (state.dirty) {
            state.dirty = false;
            renderFrame();
        }
        const blob = await state.renderer.png();
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
            throw new Error('This browser cannot copy images to the clipboard. Use Export instead.');
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast(`Copied the ${canvas.width} × ${canvas.height} preview as PNG.`);
    }
    catch (e) {
        showError(e);
    }
};
new ResizeObserver(resizeImage).observe($('stage'));
// ---- Local reference overlay ---------------------------------------------------
$('compareButton').onclick = () => $('referenceFile').click();
$('referenceFile').onchange = () => {
    const f = $('referenceFile').files[0];
    if (!f) {
        return;
    }
    try {
        if (f.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
            throw new Error('Use a PNG, JPEG or WebP no larger than 20 MB.');
        }
        if (referenceURL) {
            URL.revokeObjectURL(referenceURL);
        }
        referenceURL = URL.createObjectURL(f);
        $('referenceImage').src = referenceURL;
        $('referenceImage').hidden = false;
        $('compareControls').hidden = false;
        resizeImage();
        toast('Reference stays on your device. Overlay stretches to the canvas; crop and align the source first.');
    }
    catch (e) {
        showError(e);
    }
    finally {
        $('referenceFile').value = '';
    }
};
$('referenceImage').onerror = () => {
    showError('The reference image could not be decoded.');
    $('removeReference').click();
};
$('compareOpacity').oninput = e => $('referenceImage').style.opacity = e.target.value;
$('compareMode').onchange = e => $('referenceImage').style.mixBlendMode = e.target.value;
$('removeReference').onclick = () => {
    if (referenceURL) {
        URL.revokeObjectURL(referenceURL);
    }
    referenceURL = null;
    $('referenceImage').hidden = true;
    $('referenceImage').removeAttribute('src');
    $('compareControls').hidden = true;
    resizeImage();
};
on('refresh', () => {
    refreshView();
    resizeImage();
});
on('view', refreshView);
on('selection', refreshView);
on('prefs', () => {
    refreshView();
    state.overlayDirty = true;
});
