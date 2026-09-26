import { $, state, on } from './editor.js';
import { showBottomTab } from './ui-graph.js';
/** Phones: one panel at a time under a sticky canvas, chosen with the tab bar
 * (Pipeline, Inspect, Formulas, Graph). The CSS shows the panel named by
 * #app[data-mobile-panel]; on wider screens the tab bar is hidden and every
 * panel is visible, so this module changes nothing there.
 */
export function showMobilePanel(panel) {
    const known = ['pipeline', 'inspector', 'formulas', 'graph'], active = known.includes(panel) ? panel : 'pipeline';
    $('app').dataset.mobilePanel = active;
    document.querySelectorAll('[data-mobile]').forEach(b => {
        b.classList.toggle('active', b.dataset.mobile === active);
        b.setAttribute('aria-pressed', String(b.dataset.mobile === active));
    });
    if (active !== 'inspector') {
        showBottomTab(active);
    }
}
$('mobileTabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-mobile]');
    if (tab) {
        showMobilePanel(tab.dataset.mobile);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
});
/** Phones and tablets open no second windows (a pop-out would be a hidden tab), so
 * they study components in the playground instead; style.css hides the pop-out
 * buttons there.
 */
export const prefersInlineStudy = () => matchMedia('(pointer: coarse)').matches;
/** The one-column phone layout of style.css is active: the page itself scrolls. */
export const phoneLayout = () => matchMedia('(max-width: 700px)').matches;
showMobilePanel(['pipeline', 'graph', 'formulas'].includes(state.prefs.bottomTab) ? state.prefs.bottomTab : 'pipeline');
on('prefs', () => {
    const tab = state.prefs.bottomTab;
    if ($('app').dataset.mobilePanel !== 'inspector' && tab !== $('app').dataset.mobilePanel && ['pipeline', 'graph', 'formulas'].includes(tab)) {
        showMobilePanel(tab);
    }
});
