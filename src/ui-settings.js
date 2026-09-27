import { $, state, on, setPref, markDirty, toast } from './editor.js';
/** Viewing settings that are preferences, not part of a scene:
 *
 *   High contrast   'auto' follows the system setting (prefers-contrast: more),
 *                   'more' and 'off' force it; the footer button cycles them. The
 *                   stylesheet does the rest ([data-contrast="more"])
 *   Playback speed  how fast the playhead runs: ¼× to 2× (exports are unaffected)
 *   Exact numbers   compile the numbers of shader code as constants, as twigl
 *                   does, instead of uniforms: bit-identical to the original on a
 *                   given GPU, but dragging a number then recompiles
 */
const CONTRAST_ORDER = ['auto', 'more', 'off'];
const system = matchMedia('(prefers-contrast: more)');
/** Whether high contrast is in effect. */
export function highContrast() {
    return state.prefs.contrast === 'more' || (state.prefs.contrast === 'auto' && system.matches);
}
function applyContrast() {
    document.documentElement.dataset.contrast = highContrast() ? 'more' : 'normal';
    const pref = state.prefs.contrast, button = $('contrastButton');
    button.textContent = `◐ Contrast: ${pref === 'auto' ? `auto (${highContrast() ? 'high' : 'normal'})` : pref === 'more' ? 'high' : 'normal'}`;
    button.setAttribute('aria-pressed', String(highContrast()));
}
export function cycleContrast() {
    const next = CONTRAST_ORDER[(CONTRAST_ORDER.indexOf(state.prefs.contrast) + 1) % CONTRAST_ORDER.length];
    setPref('contrast', next);
    applyContrast();
    toast(next === 'auto' ? 'Contrast follows your system setting.' : next === 'more' ? 'High contrast: stronger text, borders and focus rings.' : 'Normal contrast.');
}
export function setPlaybackRate(rate) {
    setPref('playbackRate', rate);
    $('playbackRate').value = String(rate);
}
/** Compile shader-code numbers as constants (exact) or uniforms (live). */
export function setExactNumbers(exact) {
    setPref('exactNumbers', exact);
    if (state.renderer) {
        state.renderer.inlineNumbers = exact;
        markDirty();
        state.previewsDirty = true;
    }
}
$('contrastButton').onclick = cycleContrast;
$('playbackRate').onchange = e => setPlaybackRate(Number(e.target.value));
system.addEventListener?.('change', applyContrast);
on('prefs', applyContrast);
$('playbackRate').value = String(state.prefs.playbackRate);
if (state.renderer) {
    state.renderer.inlineNumbers = state.prefs.exactNumbers;
}
applyContrast();
