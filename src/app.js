import { Renderer } from './renderer.js';
import { $, state, refreshUI, changed, pause, toast, showError, loadProject, seek, setIsolated, setContribution, readStorage, STORAGE, markDirty } from './editor.js';
import { parseProject, clone } from './graph.js';
import { catalog } from './catalog.js';
import { loopTime } from './timeline.js';
import { renderFrame, drawOverlay } from './ui-canvas.js';
import { updatePreviews, setPreviews, applyGraphHeight } from './ui-graph.js';
import { updateClock } from './ui-timeline.js';
import { syncInspectorValues } from './ui-inspector.js';
import { takeSnapshot, getSnapshots } from './ui-library.js';
import { exportDialogOpen } from './ui-export.js';
import { shortcuts } from './ui-toolbar.js';
import { sources } from './research.js';
/** Application entry: restore the last session, create the renderer, run the
 * frame loop and expose the documented integration hooks. Panel behavior lives in
 * the ui-*.js modules; model operations live in editor.js.
 */
const saved = readStorage(STORAGE.project);
if (saved) {
    try {
        state.project = parseProject(saved);
        state.selected = state.project.nodes.find(n => n.id !== 'space')?.id || state.project.nodes[0].id;
    }
    catch (e) { /* An incompatible autosave falls back to the default scene. */
    }
}
try {
    const renderer = new Renderer($('artCanvas'));
    renderer.onLost = () => {
        pause();
        showError('GPU context lost. The browser may restore it; save your project before reloading.');
    };
    renderer.onRestored = () => {
        markDirty();
        toast('GPU context restored.');
    };
    state.renderer = renderer;
    $('gpuLabel').textContent = `WEBGL 2 · highp: ${renderer.info.precisionBits} precision bits · ${renderer.info.renderer}`;
    $('gpuLabel').title = JSON.stringify(renderer.info, null, 2);
}
catch (e) {
    $('gpuFailure').hidden = false;
    $('gpuFailure').textContent = e.message;
    $('gpuLabel').textContent = 'WEBGL 2 UNAVAILABLE';
}
let frames = 0, fpsStamp = performance.now(), syncStamp = 0;
state.frameStamp = performance.now();
function tick(now) {
    if (state.playing && !state.busy) {
        state.time += Math.min((now - state.frameStamp) / 1000, .25);
        if (state.time >= state.project.duration) {
            if ($('loop').checked) {
                state.time = loopTime(state.time, state.project.duration);
            }
            else {
                state.time = state.project.duration;
                pause();
            }
        }
        markDirty();
        updateClock();
        if (now - syncStamp > 100) {
            syncStamp = now;
            syncInspectorValues();
        }
    }
    if (state.dirty && !state.busy) {
        state.dirty = false;
        renderFrame();
        frames++;
    }
    if (!state.busy) {
        updatePreviews();
    }
    if (state.overlayDirty) {
        state.overlayDirty = false;
        drawOverlay();
    }
    if (now - fpsStamp > 1000) {
        state.fps = frames * 1000 / (now - fpsStamp);
        frames = 0;
        fpsStamp = now;
    }
    state.frameStamp = now;
    requestAnimationFrame(tick);
}
// Documented integration hooks. Consumers receive cloned JSON, not mutable UI state.
window.equationStudio = {
    getProject: () => clone(state.project),
    loadProject: p => loadProject(p),
    getTime: () => state.time,
    seek: t => seek(t),
    getRenderer: () => state.renderer,
    getCatalog: () => catalog,
    getSources: () => sources,
    getShortcuts: () => Object.keys(shortcuts),
    getView: () => ({ isolated: state.isolated, contribution: state.contribution, contributionStyle: state.contributionStyle, prefs: { ...state.prefs }, selected: state.selected }),
    isolate: id => {
        if (id && !state.project.nodes.some(n => n.id === id)) {
            throw new Error('Unknown node.');
        }
        setIsolated(id);
    },
    contribution: (id, style) => {
        if (id && !state.project.nodes.some(n => n.id === id)) {
            throw new Error('Unknown node.');
        }
        setContribution(id, style);
    },
    setPreviews: enabled => setPreviews(enabled),
    snapshot: title => takeSnapshot(title),
    getSnapshots: () => clone(getSnapshots()),
    isExporting: () => state.busy || exportDialogOpen(),
    renderNow: () => {
        state.dirty = false;
        renderFrame();
    },
    exportPNG: async () => {
        if (!state.renderer) {
            throw new Error('GPU unavailable.');
        }
        state.dirty = false;
        renderFrame();
        return state.renderer.png();
    }
};
applyGraphHeight(state.prefs.graphHeight);
refreshUI();
changed();
requestAnimationFrame(tick);
