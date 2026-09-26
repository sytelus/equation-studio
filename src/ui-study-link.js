/** Lets panels open the Equation Playground without importing it (which would
 * create an import cycle: the playground imports the inspector, which imports
 * the panels' shared modules). ui-playground.js registers the handler.
 */
let handler = null;
export function setStudyHandler(fn) {
    handler = fn;
}
/** Study a component in the playground. */
export function studyComponent(id) {
    handler?.(id);
}
let last = { id: null, time: 0 };
/** True when this click on component `id` is the second of a double click. Panels
 * re-render after the first click, so the browser's dblclick (which needs both
 * clicks on one element) is unreliable; this compares component ids instead.
 */
export function isDoubleClick(id) {
    const now = performance.now(), double = last.id === id && now - last.time < 450;
    last = double ? { id: null, time: 0 } : { id, time: now };
    return double;
}
