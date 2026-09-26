import { esc, state, on, undo, redo, nodeById, currentNode } from './editor.js';
import { ComponentView } from './ui-component-view.js';
import { attachTooltips } from './ui-tooltip.js';
/** Pop out: the component explanation in a separate browser window, e.g. on a
 * second screen next to a full-size canvas.
 *
 * The window is an about:blank page of this origin, so this module writes its
 * markup, copies the page's styles into it and runs a ComponentView there: its
 * controls change the scene in this window directly. It follows the selection
 * unless pinned, and closes with this page.
 */
let win = null, view = null;
export function popoutOpen() {
    return !!win && !win.closed;
}
/** Open (or focus) the pop-out on `nodeId`. Returns false when the browser
 * blocked the window.
 */
export function popOut(nodeId = state.selected) {
    if (popoutOpen()) {
        view.pinned = view.pinned ? nodeId : null;
        view.render();
        win.focus();
        return true;
    }
    let opened;
    try {
        opened = window.open('', 'equation-studio-equation', 'popup=yes,width=640,height=900');
    }
    catch (e) {
        opened = null;
    }
    if (!opened) {
        return false;
    }
    let doc;
    try {
        doc = opened.document;
        doc.open();
        doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Equation · Equation Studio</title></head><body class="popout"><header class="popout-bar"><span class="brand-symbol">∿</span><b id="popoutTitle"></b><span class="spacer"></span><label class="legend-check" data-tip="Pin|Keep showing this component while you select others in the main window."><input type="checkbox" id="popoutPin"> Pin</label><button id="popoutBack" data-tip="Main window|Bring the Equation Studio window to the front.">Main window ↙</button></header><main id="popoutContent" class="popout-content"></main></body></html>`);
        doc.close();
    }
    catch (e) { // e.g. a browser that isolates about:blank from file:// pages
        opened.close();
        return false;
    }
    for (const sheet of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        const copy = doc.importNode(sheet, true);
        if (copy.tagName === 'LINK') {
            copy.href = sheet.href; // absolute, since about:blank has no base
        }
        doc.head.append(copy);
    }
    win = opened;
    view = new ComponentView(doc.getElementById('popoutContent'), { layout: 'popout' });
    view.onPlayground = null;
    view.onPopout = null;
    attachTooltips(doc);
    const title = () => {
        const n = view.node();
        doc.getElementById('popoutTitle').textContent = n ? n.label : '';
        doc.title = `${n ? n.label : 'Equation'} · Equation Studio`;
    };
    const render = () => {
        view.render();
        title();
    };
    view.pinned = null;
    doc.getElementById('popoutPin').onchange = e => {
        view.pinned = e.target.checked ? view.node().id : null;
        render();
    };
    doc.getElementById('popoutBack').onclick = () => window.focus();
    doc.addEventListener('keydown', e => {
        const meta = e.ctrlKey || e.metaKey;
        if (meta && e.key.toLowerCase() === 'z' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            (e.shiftKey ? redo : undo)();
        }
    });
    win.addEventListener('pagehide', () => {
        view?.dispose();
        view = null;
        win = null;
    });
    if (nodeId && nodeById(nodeId) && nodeId !== currentNode()?.id) {
        view.pinned = nodeId;
        doc.getElementById('popoutPin').checked = true;
    }
    render();
    updateTitle = title;
    return true;
}
let updateTitle = null;
// The view itself re-renders with every other ComponentView (renderViews); keep the title in step.
for (const event of ['refresh', 'selection', 'view']) {
    on(event, () => {
        if (popoutOpen()) {
            updateTitle?.();
        }
    });
}
addEventListener('pagehide', () => {
    if (popoutOpen()) {
        win.close();
    }
});
/** Title of the pop-out for tests and tooltips. */
export function popoutTitle() {
    return popoutOpen() ? esc(win.document.title) : '';
}
