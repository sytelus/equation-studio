import { esc } from './editor.js';
/** Hover tips for every control. Mark an element with:
 *
 *   data-tip="Heading|Body text"   heading and explanation ("|" separates them)
 *   data-key="R"                    keyboard shortcut shown as a key cap
 *   data-toggle                     states that the control switches on and off
 *
 * or register a provider for richer content (see registerTipProvider). Tips
 * appear after a short delay, instantly when moving between controls, and hide on
 * any press, key or scroll. aria-label attributes stay as the accessible names.
 */
const providers = [];
let timer = null, current = null, lastHidden = 0;
const tip = document.createElement('div');
tip.id = 'tooltip';
tip.setAttribute('role', 'tooltip');
tip.hidden = true;
document.body.append(tip);
/** `provider(element)` returns HTML for elements matching `selector`, or null. */
export function registerTipProvider(selector, provider) {
    providers.push({ selector, provider });
}
function contentFor(el) {
    for (const { selector, provider } of providers) {
        const match = el.closest(selector);
        if (match === el) {
            const html = provider(el);
            if (html) {
                return html;
            }
        }
    }
    const text = el.dataset.tip;
    if (!text) {
        return null;
    }
    const [heading, ...rest] = text.split('|');
    const body = rest.join('|');
    const state = el.hasAttribute('data-toggle') ? `<span class="tip-state">${el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active') ? 'On · click to turn off' : 'Off · click to turn on'}</span>` : '';
    const key = el.dataset.key ? `<kbd>${esc(el.dataset.key)}</kbd>` : '';
    return `<b>${esc(heading)}</b>${key}${state}${body ? `<p>${esc(body).replace(/\n/g, '<br>')}</p>` : ''}`;
}
function place(el) {
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), margin = 8;
    let top = r.bottom + margin;
    if (top + t.height > innerHeight - 4) {
        top = Math.max(4, r.top - t.height - margin);
    }
    const left = Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 4);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}
function show(el) {
    const html = contentFor(el);
    if (!html) {
        return;
    }
    current = el;
    tip.innerHTML = html;
    tip.hidden = false;
    place(el);
}
export function hideTip() {
    clearTimeout(timer);
    if (!tip.hidden) {
        lastHidden = performance.now();
    }
    tip.hidden = true;
    current = null;
}
function target(el) {
    return el?.closest?.('[data-tip], [data-rich-tip]');
}
document.addEventListener('pointerover', e => {
    const el = target(e.target);
    if (el === current) {
        return;
    }
    clearTimeout(timer);
    if (!el) {
        hideTip();
        return;
    }
    const quick = !tip.hidden || performance.now() - lastHidden < 400;
    if (!tip.hidden) {
        tip.hidden = true;
    }
    timer = setTimeout(() => show(el), quick ? 60 : 420);
});
document.addEventListener('pointerout', e => {
    if (current && !current.contains(e.relatedTarget)) {
        hideTip();
    }
});
for (const type of ['pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(type, hideTip, { capture: true, passive: true });
}
document.addEventListener('scroll', hideTip, { capture: true, passive: true });
/** Refresh the visible tip, e.g. after a toggle changed state. */
export function refreshTip() {
    if (current && !tip.hidden) {
        show(current);
    }
}
