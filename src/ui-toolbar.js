import { $, esc, state, on, toast, showError, transact, loadProject, undo, redo, revertScene, seek, setView, viewedNode, stepStage, setPref, duplicateNode, deleteNode, history } from './editor.js';
import { parseProject } from './graph.js';
import { getPreset } from './presets.js';
import { sources, methodNotes } from './research.js';
import { download, fileStem } from './export.js';
import { takeSnapshot } from './ui-library.js';
import { togglePlay, stepFrames } from './ui-timeline.js';
import { setPreviews, renderGraph } from './ui-graph.js';
import { hasPin, clearPin, setCompareOriginal } from './ui-canvas.js';
import { exploreOpen, closeExplore } from './ui-explore.js';
/** Top bar, dialogs and global keyboard shortcuts. */
$('projectTitle').onchange = e => transact(p => p.title = e.target.value);
$('undo').onclick = () => {
    if (!state.busy) {
        undo();
    }
};
$('redo').onclick = () => {
    if (!state.busy) {
        redo();
    }
};
$('revertScene').onclick = () => {
    if (!state.busy) {
        revertScene();
    }
};
$('saveProject').onclick = () => {
    try {
        download(new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' }), fileStem(state.project.title) + '.json');
        toast('Project JSON exported.');
    }
    catch (e) {
        showError(e);
    }
};
$('openProject').onclick = () => $('projectFile').click();
$('projectFile').onchange = async () => {
    const f = $('projectFile').files[0];
    if (!f) {
        return;
    }
    try {
        if (f.size > 1000000) {
            throw new Error('Project files are limited to 1 MB.');
        }
        loadProject(parseProject(await f.text()));
        toast('Project opened.');
    }
    catch (e) {
        showError(e);
    }
    finally {
        $('projectFile').value = '';
    }
};
$('researchContent').innerHTML = '<p class="research-intro">Prepared 22 September 2026. The original nebula equations were supplied in this conversation and have a retained Python reference. The other requested subjects have executable, editable studies, but their exact equation sheets were not recovered. No original image is used as a render texture.</p>'
    + methodNotes.map(([h, p]) => `<section class="research-method"><h3>${esc(h)}</h3><p>${esc(p)}</p></section>`).join('')
    + '<h3>Source-by-source evidence ledger</h3>'
    + sources.map(s => `<article class="source-entry"><a href="${s.url}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a><small>${esc(s.status)}</small><p>${esc(s.note)}</p>${s.scene ? `<button data-study="${s.scene}">Open the interpretive study →</button>` : ''}</article>`).join('');
$('researchContent').onclick = e => {
    const el = e.target.closest('[data-study]');
    if (el) {
        $('researchDialog').close();
        loadProject(getPreset(el.dataset.study));
    }
};
$('helpButton').onclick = () => $('helpDialog').showModal();
$('researchButton').onclick = () => $('researchDialog').showModal();
document.querySelectorAll('[data-close]').forEach(b => {
    if (b.dataset.close !== 'exportDialog') {
        b.onclick = () => $(b.dataset.close).close();
    }
});
on('history', () => {
    $('undo').disabled = !history.past.length;
    $('redo').disabled = !history.future.length;
});
on('refresh', () => {
    $('projectTitle').value = state.project.title;
    $('counts').textContent = `${state.project.nodes.length} components · ${state.project.tracks.length} tracks`;
});
/** Show the selected component's stage or effect, or return to the final image. */
function toggleView(mode) {
    const same = state.viewMode === mode && viewedNode().id === state.selected;
    setView(same ? 'final' : mode, { node: state.selected, lock: false });
}
/** Single-key shortcuts apply only outside text fields and dialogs. */
export const shortcuts = {
    ' ': togglePlay,
    'Home': () => seek(0),
    'End': () => seek(state.project.duration),
    ',': () => stepFrames(-1),
    '.': () => stepFrames(1),
    'r': () => setPref('rulers', !state.prefs.rulers),
    'g': () => setPref('grid', !state.prefs.grid),
    'p': () => setPreviews(!state.prefs.previews),
    'i': () => toggleView('stage'),
    'c': () => toggleView('effect'),
    '[': () => stepStage(-1),
    ']': () => stepStage(1),
    'f': () => $('resetView').click(),
    's': () => takeSnapshot(),
    'l': () => $('graphFit').click()
};
document.addEventListener('keydown', e => {
    const editing = e.target.matches('input,textarea,select,[contenteditable]'), modal = document.querySelector('dialog[open]'), meta = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
        if (state.connection) {
            state.connection = null;
            renderGraph();
        }
        else if (!modal && exploreOpen()) {
            closeExplore();
        }
        else if (!modal && hasPin()) {
            clearPin();
        }
        else if (!modal && state.viewMode !== 'final') {
            setView('final');
        }
        return;
    }
    if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        $('saveProject').click();
        return;
    }
    if (editing || modal || state.busy) {
        return;
    }
    if (e.key.toLowerCase() === 'o' && !meta && !e.altKey) { // hold O: compare with the original
        if (!e.repeat) {
            setCompareOriginal(true);
        }
        return;
    }
    if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? redo : undo)();
    }
    else if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateNode(state.selected);
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.closest('#graphViewport')) {
        e.preventDefault();
        deleteNode(state.selected);
    }
    else if (!meta && !e.altKey && Object.hasOwn(shortcuts, e.key.length === 1 ? e.key.toLowerCase() : e.key)) {
        e.preventDefault();
        shortcuts[e.key.length === 1 ? e.key.toLowerCase() : e.key]();
    }
});
document.addEventListener('keyup', e => {
    if (e.key.toLowerCase() === 'o') {
        setCompareOriginal(false);
    }
});
addEventListener('blur', () => setCompareOriginal(false));
