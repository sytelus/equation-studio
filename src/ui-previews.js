import { state, on, showError } from './editor.js';
import { PREVIEW_WIDTH, PREVIEW_HEIGHT } from './graph-layout.js';
/** Live thumbnails of every component's output, shared by the Pipeline panel and
 * the graph cards. One preview program renders all tiles into one offscreen atlas
 * with a single readback; any <canvas data-preview="id"> is painted from it.
 */
let tiles = new Map(), failed = false, frame = 0;
/** Paint every preview canvas currently in the document. */
export function paintPreviews(root = document) {
    root.querySelectorAll('canvas[data-preview]').forEach(canvas => {
        const tile = tiles.get(canvas.dataset.preview);
        if (tile) {
            if (canvas.width !== tile.width || canvas.height !== tile.height) {
                canvas.width = tile.width;
                canvas.height = tile.height;
            }
            canvas.getContext('2d').putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
            canvas.classList.add('painted');
        }
    });
}
export function previewsFailed() {
    return failed;
}
/** Called by the frame loop: re-render tiles when the model or time changed. */
export function updatePreviews() {
    if (!state.prefs.previews || !state.renderer || state.busy || failed || !state.previewsDirty) {
        return;
    }
    if (!document.querySelector('canvas[data-preview]')) {
        return; // nothing on screen wants a thumbnail
    }
    if (state.playing && (frame++ % 3)) {
        return; // one third of the frame rate during playback
    }
    try {
        tiles = state.renderer.previewAtlas(state.project, state.time, state.project.nodes.map(n => n.id), PREVIEW_WIDTH, PREVIEW_HEIGHT);
        state.previewsDirty = false;
        paintPreviews();
    }
    catch (e) {
        failed = true;
        showError(`Live previews stopped: ${e.message}`);
    }
}
/** Forget the cached tiles (e.g. after previews are switched back on). */
export function resetPreviews() {
    tiles = new Map();
    failed = false;
    state.previewsDirty = true;
}
on('refresh', () => state.previewsDirty = true);
