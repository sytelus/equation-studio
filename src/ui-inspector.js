import { $, state, on } from './editor.js';
import { ComponentView, renderViews } from './ui-component-view.js';
import { SceneView } from './ui-scene-view.js';
/** The side panel on the right. It shows the whole scene (a SceneView: what it is,
 * how it works, what to try, its parts) or one part of it (a ComponentView: the
 * selected component, explained and edited), as state.panel says. The same
 * ComponentView class renders the pop-out window; ui-playground.js sets the
 * panel's width.
 */
$('inspectorContent').innerHTML = '<div id="sceneView" class="scene-root"></div><div id="partView" class="part-root"></div>';
export const inspector = new ComponentView($('partView'), { layout: 'panel' });
const sceneView = new SceneView($('sceneView'));
let shown = null;
export function renderInspector() {
    const scene = state.panel === 'scene';
    $('sceneView').hidden = !scene;
    $('partView').hidden = scene;
    if (scene) {
        sceneView.render();
    }
    renderViews(); // the panel's part view skips itself while the scene is shown
    if (shown !== state.panel) {
        shown = state.panel;
        $('inspectorContent').scrollTop = 0; // a different view starts at its top
    }
    $('inspector').dataset.panel = state.panel;
}
/** Update visible values for the playhead without rebuilding any view, so
 * scrubbing and playback never steal focus or discard an unapplied equation.
 */
export function syncInspectorValues() {
    inspector.sync();
}
on('refresh', renderInspector);
on('selection', renderInspector);
on('view', renderInspector);
on('tour', renderInspector);
on('previews', () => sceneView.paintThumbs());
