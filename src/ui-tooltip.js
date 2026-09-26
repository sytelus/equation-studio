import { esc } from './editor.js';
/** Hover tips for every control. Mark an element with:
 *
 *   data-tip="Heading|Body text"   heading and explanation ("|" separates them)
 *   data-key="R"                    keyboard shortcut shown as a key cap
 *   data-toggle                     states that the control switches on and off
 *
 * or register a provider for richer content (see registerTipProvider). Tips
 * appear after a short delay, instantly when moving between controls, and hide on
 * any press, key or scroll. On touch screens a long press shows the tip (and the
 * press does not also activate the control). Symbols in equations with a
 * data-sym-title explain themselves the same way. aria-label attributes stay the
 * accessible names.
 *
 * attachTooltips(document) is called for this page; the pop-out window calls it
 * for its own document.
 */
const providers = [];
const instances = [];
const LONG_PRESS_MS = 480;
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
    if (el.dataset.symTitle) {
        return `<b>${esc(el.textContent.trim())}</b><p>${esc(el.dataset.symTitle)}</p>`;
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
function target(el) {
    return el?.closest?.('[data-tip], [data-rich-tip], [data-sym-title]');
}
/** Install tooltips in `doc`. Returns {hide, refresh}. */
export function attachTooltips(doc) {
    const view = doc.defaultView;
    const tip = doc.createElement('div');
    tip.id = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    doc.body.append(tip);
    /** `current` shows its tip; `pending` waits for its delay to show one. */
    let timer = null, current = null, pending = null, lastHidden = 0, press = null, suppressClick = false;
    const place = el => {
        const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), margin = 8;
        let top = r.bottom + margin;
        if (top + t.height > view.innerHeight - 4) {
            top = Math.max(4, r.top - t.height - margin);
        }
        const left = Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), view.innerWidth - t.width - 4);
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    };
    const show = el => {
        const html = el.isConnected ? contentFor(el) : null; // a re-render may have replaced the target
        if (!html) {
            return;
        }
        current = el;
        tip.innerHTML = html;
        tip.hidden = false;
        place(el);
    };
    const hide = () => {
        clearTimeout(timer);
        pending = null;
        if (!tip.hidden) {
            lastHidden = performance.now();
        }
        tip.hidden = true;
        current = null;
    };
    doc.addEventListener('pointerover', e => {
        if (e.pointerType === 'touch') {
            return; // touch shows tips on a long press instead
        }
        const el = target(e.target);
        if (el && (el === current || el === pending)) {
            return; // still over the same control
        }
        // Moving between controls while a tip is (or was just) visible is quick.
        const quick = !tip.hidden || performance.now() - lastHidden < 400;
        hide(); // also cancels a tip still waiting for its delay
        if (!el) {
            return;
        }
        pending = el;
        timer = setTimeout(() => {
            pending = null;
            show(el);
        }, quick ? 60 : 420);
    });
    doc.addEventListener('pointerout', e => {
        const el = current || pending;
        if (el && !el.contains(e.relatedTarget) && e.pointerType !== 'touch') {
            hide();
        }
    });
    doc.addEventListener('pointerdown', e => {
        hide();
        clearTimeout(press?.timer);
        press = null;
        const el = e.pointerType === 'touch' ? target(e.target) : null;
        if (el) {
            press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
                show(el);
                suppressClick = true;
            }, LONG_PRESS_MS) };
        }
    }, { capture: true, passive: true });
    doc.addEventListener('pointermove', e => {
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
            clearTimeout(press.timer);
            press = null;
        }
    }, { capture: true, passive: true });
    for (const type of ['pointerup', 'pointercancel']) {
        doc.addEventListener(type, () => {
            clearTimeout(press?.timer);
            press = null;
            if (suppressClick) { // only the click that ends this press is swallowed
                setTimeout(() => suppressClick = false, 400);
            }
        }, { capture: true, passive: true });
    }
    // A long press shows the tip; the click it would end in is swallowed.
    doc.addEventListener('click', e => {
        if (suppressClick) {
            suppressClick = false;
            e.preventDefault();
            e.stopPropagation();
        }
    }, { capture: true });
    for (const type of ['keydown', 'wheel']) {
        doc.addEventListener(type, hide, { capture: true, passive: true });
    }
    doc.addEventListener('scroll', hide, { capture: true, passive: true });
    const instance = { hide, refresh: () => current && !tip.hidden && show(current), doc };
    instances.push(instance);
    view.addEventListener('pagehide', () => instances.splice(instances.indexOf(instance), 1));
    return instance;
}
/** Refresh visible tips, e.g. after a toggle changed state. */
export function refreshTip() {
    instances.forEach(i => i.refresh());
}
attachTooltips(document);
