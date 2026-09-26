import { $, state, on, setView, setSelected, nodeById, setPref, savePrefs, toast } from './editor.js';
import { inspector } from './ui-inspector.js';
import { popOut } from './ui-popout.js';
import { setScopeVisible, scopeVisible } from './ui-scope.js';
import { setStudyHandler } from './ui-study-link.js';
import { prefersInlineStudy, phoneLayout, showMobilePanel } from './ui-mobile.js';
/** The component panel's width, and the Equation Playground.
 *
 * The panel on the right can be resized by dragging its left edge. The
 * Playground is the same panel made wide (half the window by default), so the
 * component's equation and its controls sit side by side, with the profile of
 * its values under the canvas; the pipeline becomes a compact strip of step
 * names so the canvas keeps its height. Nothing else moves, and choosing ⤢ again
 * (or E) returns to the normal width. While an equation is being edited the
 * panel is wide too, so the text has room. Both widths are remembered.
 */
const MIN_WIDTH = 300, MIN_WORK = 420;
let scopeBefore = null;
export function playgroundOpen() {
    return !!state.prefs.playground;
}
/** Wide: the Playground, or an equation of the selected component being edited. */
function wide() {
    return playgroundOpen() || (state.drafts.has(state.selected) && !phoneLayout());
}
/** The panel width in pixels for the current mode, within what the window allows. */
function panelWidth() {
    const available = $('layout').clientWidth || innerWidth, max = Math.max(MIN_WIDTH, available - MIN_WORK);
    const wanted = wide() ? (state.prefs.wideWidth || Math.round(available * 0.5)) : (state.prefs.panelWidth || Math.min(480, Math.round(available * 0.27)));
    return Math.round(Math.min(max, Math.max(MIN_WIDTH, wanted)));
}
export function applyPanelWidth() {
    $('app').style.setProperty('--panel-width', `${panelWidth()}px`);
    $('app').classList.toggle('playground', playgroundOpen());
    $('app').classList.toggle('wide-panel', wide());
}
/** Open the Playground on a component (default: the selection): the panel widens,
 * the canvas shows the component's own output, and the profile opens.
 */
export function openPlayground(nodeId = state.selected) {
    const id = nodeById(nodeId) ? nodeId : state.selected;
    if (id !== state.selected) {
        setSelected(id);
    }
    if (state.viewMode === 'final' && id !== state.project.output) {
        setView('stage', { node: id, lock: false });
    }
    if (phoneLayout()) { // one column: show the component under the canvas
        showMobilePanel('inspector');
        window.scrollTo({ top: 0 });
        return;
    }
    if (!playgroundOpen()) {
        scopeBefore = scopeVisible();
        state.prefs.playground = true;
        savePrefs();
        setScopeVisible(true, { remember: false });
        applyPanelWidth();
        inspector.render();
    }
}
export function closePlayground() {
    if (!playgroundOpen()) {
        return;
    }
    state.prefs.playground = false;
    savePrefs();
    if (scopeBefore !== null) {
        setScopeVisible(scopeBefore, { remember: false });
        scopeBefore = null;
    }
    applyPanelWidth();
    inspector.render();
}
export function togglePlayground() {
    if (playgroundOpen()) {
        closePlayground();
    }
    else {
        openPlayground();
    }
}
// ---- Resizing: drag the panel's left edge -------------------------------------
const splitter = $('panelSplitter');
splitter.addEventListener('pointerdown', e => {
    if (e.button !== 0) {
        return;
    }
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('active');
    const right = $('layout').getBoundingClientRect().right;
    const move = ev => {
        const width = Math.round(right - ev.clientX);
        state.prefs[wide() ? 'wideWidth' : 'panelWidth'] = Math.max(MIN_WIDTH, width);
        applyPanelWidth();
    };
    const up = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
        splitter.removeEventListener('pointercancel', up);
        splitter.classList.remove('active');
        setPref(wide() ? 'wideWidth' : 'panelWidth', state.prefs[wide() ? 'wideWidth' : 'panelWidth']);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
});
splitter.addEventListener('dblclick', () => {
    setPref(wide() ? 'wideWidth' : 'panelWidth', 0);
    applyPanelWidth();
});
new ResizeObserver(() => applyPanelWidth()).observe($('layout'));
setStudyHandler(id => openPlayground(id));
inspector.onPlayground = () => togglePlayground();
inspector.onPopout = id => {
    if (prefersInlineStudy()) { // a phone or tablet has no room for a second window
        openPlayground(id);
        return;
    }
    if (!popOut(id)) {
        toast('The browser blocked the pop-out window; opening the Playground instead. Allow pop-ups for this page to use a separate window.');
        openPlayground(id);
    }
};
on('prefs', applyPanelWidth);
on('draft', applyPanelWidth);
on('selection', applyPanelWidth);
on('refresh', applyPanelWidth);
applyPanelWidth();
