import { state, on, emit, showError } from './editor.js';
import { PREVIEW_WIDTH, PREVIEW_HEIGHT } from './graph-layout.js';
import { lookForStats, paintTile } from './looks.js';
import { lookOptions } from './ui-look.js';
/** Live thumbnails of every component's output, shared by the Pipeline panel and
 * the graph cards. The graph's one program renders all tiles into one offscreen
 * atlas; the atlas is read back without blocking (pixel-pack buffer + fence).
 *
 * With float framebuffers (EXT_color_buffer_float) the tiles are read as raw
 * values and colored here with the same looks as the canvas (looks.js), each over
 * its own range, so an intermediate field is legible at a glance. A layer shown
 * with adjusted exposure is labelled with the factor. Without float support the
 * shader's classic diagnostic colors are used.
 */
let tiles = new Map(), failed = false, inFlight = false, frame = 0;
const fmtGain = g => `×${Number(g.toPrecision(2))}`;
/** Paint every preview canvas currently in `root`. */
export function paintPreviews(root = document) {
    root.querySelectorAll('canvas[data-preview]').forEach(canvas => {
        const tile = tiles.get(canvas.dataset.preview);
        if (!tile) {
            return;
        }
        if (canvas.width !== tile.width || canvas.height !== tile.height) {
            canvas.width = tile.width;
            canvas.height = tile.height;
        }
        const ctx = canvas.getContext('2d');
        ctx.putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
        if (tile.note) {
            ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
            const w = ctx.measureText(tile.note).width + 8;
            ctx.fillStyle = 'rgba(8,12,14,0.78)';
            ctx.fillRect(tile.width - w - 3, tile.height - 16, w, 13);
            ctx.fillStyle = '#ffd9b0';
            ctx.fillText(tile.note, tile.width - w + 1, tile.height - 6);
        }
        canvas.classList.add('painted');
        canvas.dataset.note = tile.note || '';
    });
}
export function previewsFailed() {
    return failed;
}
/** Color raw float tiles with the canvas looks. */
function colorTiles(result, project) {
    const out = new Map();
    for (const [id, tile] of result) {
        const look = lookForStats(tile.data, tile.type, lookOptions(tile.type, { natural: id === project.output }));
        const data = paintTile(tile.data, tile.width, tile.height, { type: tile.type, ...look, exposure: project.exposure, tone: project.tone });
        const adjusted = tile.type === 'layer' && look.mode === 'auto' && Math.abs((look.gain ?? 1) - 1) > 1e-6;
        out.set(id, { width: tile.width, height: tile.height, data, note: adjusted ? fmtGain(look.gain) : '' });
    }
    return out;
}
/** Called by the frame loop: re-render tiles when the model or time changed. One
 * atlas is in flight at a time; while a slow gesture is under way (the canvas is
 * rendering at reduced resolution) thumbnails wait until it ends.
 */
export function updatePreviews() {
    const renderer = state.renderer;
    if (!state.prefs.previews || !renderer || state.busy || failed || !state.previewsDirty || inFlight) {
        return;
    }
    if (!document.querySelector('canvas[data-preview]')) {
        return; // nothing on screen wants a thumbnail
    }
    if (state.playing && (frame++ % 3)) {
        return; // one third of the frame rate during playback
    }
    if (state.interacting && state.adaptiveScale < 1) {
        return;
    }
    const project = state.project;
    if (renderer.programFor(project).status !== 'ready') {
        return; // the canvas shows that the shared program is compiling
    }
    state.previewsDirty = false;
    const raw = renderer.info.rawFields, ids = project.nodes.map(n => n.id);
    inFlight = true;
    let request;
    try {
        request = renderer.previewAtlas(project, state.time, ids, PREVIEW_WIDTH, PREVIEW_HEIGHT, { raw, async: true });
    }
    catch (e) {
        inFlight = false;
        failed = true;
        showError(`Live previews stopped: ${e.message}`);
        return;
    }
    request.then(result => {
        inFlight = false;
        tiles = raw ? colorTiles(result, project) : new Map([...result].map(([id, t]) => [id, { width: t.width, height: t.height, data: t.data, note: '' }]));
        paintPreviews();
        emit('previews');
    }, e => {
        inFlight = false;
        if (!renderer.lost) {
            failed = true;
            showError(`Live previews stopped: ${e.message}`);
        }
        else {
            state.previewsDirty = true;
        }
    });
}
/** Forget the cached tiles (e.g. after previews are switched back on). */
export function resetPreviews() {
    tiles = new Map();
    failed = false;
    state.previewsDirty = true;
}
/** The painted thumbnail of a node, {width, height, data}, or undefined. */
export function previewTile(id) {
    return tiles.get(id);
}
on('refresh', () => state.previewsDirty = true);
on('prefs', () => state.previewsDirty = true);
