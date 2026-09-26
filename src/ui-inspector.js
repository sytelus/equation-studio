import { $, on } from './editor.js';
import { ComponentView, renderViews } from './ui-component-view.js';
/** The component panel on the right: the selected component, explained and
 * edited, in a ComponentView (see ui-component-view.js). The same view class
 * renders the pop-out window; ui-playground.js sets the panel's width.
 */
export const inspector = new ComponentView($('inspectorContent'), { layout: 'panel' });
export function renderInspector() {
    renderViews();
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
