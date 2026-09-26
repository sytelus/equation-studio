import { $, esc, state, on, setSelected } from './editor.js';
import { texToMathML, texToMathMLSegments, programToMathML } from './math-render.js';
import { compositionTeX, formulaSheet, shortLabel } from './formula.js';
import { typeLabels } from './catalog.js';
/** The Formulas tab: the construction written out as a formula sheet, in the
 * spirit of the artist's own sheets: how the image is composed, then every
 * component's equation with its inputs bound to the components that feed them.
 * Click a block to select that component; hover a line for its explanation.
 */
const CUSTOM_LHS = { expression: '<mi>f</mi>', vectorExpression: '<mi>q</mi>', colorExpression: '<mi mathvariant="normal">RGB</mi>' };
function safe(render, fallback) {
    try {
        return render();
    }
    catch (e) {
        return `<code>${esc(fallback)}</code>`;
    }
}
function block(entry) {
    const { node, index, def, inputs, uses, isOutput } = entry;
    const outSymbols = Object.fromEntries(def.outputSymbols.map(s => [s, { role: 'output', type: def.output }]));
    const inSymbols = Object.fromEntries(inputs.flatMap(i => i.symbol.split(',').map(s => [s.trim(), { role: 'input', type: i.kind, socket: i.socket }])));
    const symbols = { ...inSymbols, ...outSymbols };
    const lines = def.custom
        ? safe(() => programToMathML(node.params.expression, CUSTOM_LHS[node.type], { symbols: { p: { role: 'input', type: 'coord' }, a: { role: 'input', type: 'scalar' }, b: { role: 'input', type: 'scalar' } } }).map(l => `<div class="formula-line" data-tip="${esc(l.text || 'Custom equation line')}">${l.mathml}</div>`).join(''), node.params.expression)
        : def.steps.map(s => `<div class="formula-line" data-tip="${esc(s.text)}">${safe(() => texToMathMLSegments(s.tex, { symbols }).map(m => `<span class="eq-seg">${m}</span>`).join(''), s.tex)}</div>`).join('');
    const from = inputs.length ? `<p class="formula-bind">${inputs.map(i => `${safe(() => texToMathML(i.symbol, { display: false, symbols: inSymbols }), i.symbol)} ← ${i.source ? `<b>${esc(shortLabel(i.source))}</b>` : '<span class="muted">zero (unconnected)</span>'}`).join(' · ')}</p>` : '';
    const to = uses.length ? `<p class="formula-bind">→ ${uses.map(u => `<b>${esc(shortLabel(u.node))}</b> as ${safe(() => texToMathML(u.symbol, { display: false }), u.symbol)}`).join(' · ')}</p>` : isOutput ? '<p class="formula-bind final">→ the final image</p>' : '<p class="formula-bind muted">→ unused</p>';
    return `<article class="formula-block ${def.output} ${node.enabled ? '' : 'disabled'} ${node.id === state.selected ? 'selected' : ''}" data-formula="${node.id}" tabindex="0" role="button" aria-label="Open ${esc(node.label)}"><header><span class="formula-index">${index + 1}</span><b>${esc(node.label)}</b><span class="type-chip ${def.output}">${esc(typeLabels[def.output])}</span>${node.enabled ? '' : '<span class="muted">bypassed</span>'}</header>${from}<div class="formula-lines">${lines}</div>${to}</article>`;
}
export function renderFormulas() {
    if ($('formulaView').hidden) {
        return;
    }
    const project = state.project;
    const summary = safe(() => texToMathMLSegments(compositionTeX(project)).map(m => `<span class="eq-seg">${m}</span>`).join(''), compositionTeX(project));
    $('formulaView').innerHTML = `<section class="formula-summary"><small>THE IMAGE, COMPOSED</small><div class="formula-line">${summary}</div><p class="muted">Light is added (+), opaque layers are stacked (over); everything else is one component, defined below in evaluation order. Colored symbols: <span class="sym-in coord">inputs</span> · <span class="sym-out">outputs</span>. Hover a line for what it does; click a block to select it.</p></section><div class="formula-grid">${formulaSheet(project).map(block).join('')}</div>`;
}
$('formulaView').addEventListener('click', e => {
    const card = e.target.closest('[data-formula]');
    if (card) {
        setSelected(card.dataset.formula);
    }
});
$('formulaView').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-formula]')) {
        e.preventDefault();
        e.target.click();
    }
});
for (const event of ['refresh', 'selection']) {
    on(event, renderFormulas);
}
