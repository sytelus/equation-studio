import { $, esc, state, on, setView, setEnabled, enableAll, onlyStructure, restoreEnabled, bypassDescription, viewedNode } from './editor.js';
import { catalog, typeLabels } from './catalog.js';
import { evaluationOrder, consumers, topologicalOrder } from './graph.js';
import { paintPreviews } from './ui-previews.js';
/** Pipeline panel: every component in evaluation order with a live thumbnail of
 * its output, a checkbox to include or bypass it, and what it feeds. Clicking a
 * card shows that stage on the canvas, so the image can be read step by step.
 */
function roleLine(node) {
    const users = consumers(state.project, node.id);
    if (state.project.output === node.id) {
        return 'the scene’s final output';
    }
    if (!users.length) {
        return 'not used by anything';
    }
    return `feeds ${users.map(u => `${esc(u.node.label)}${Object.keys(catalog[u.node.type].inputs).length > 1 ? ` · ${esc(u.socket)}` : ''}`).join(', ')}`;
}
export function renderPipeline() {
    const project = state.project, order = evaluationOrder(project), reachable = new Set(topologicalOrder(project).map(n => n.id));
    const viewed = state.viewMode === 'stage' ? viewedNode().id : null, previews = state.prefs.previews;
    const cards = order.map((n, i) => {
        const def = catalog[n.type], isOutput = project.output === n.id;
        const classes = ['stage-card', def.output, state.selected === n.id ? 'selected' : '', viewed === n.id ? 'viewed' : '', n.enabled ? '' : 'disabled', reachable.has(n.id) ? '' : 'unused'].filter(Boolean).join(' ');
        const checkTip = `${n.enabled ? 'Included' : 'Bypassed'}: ${esc(n.label)}|Untick to bypass it: it then ${esc(bypassDescription(n))}. Tick to include it again (anything it needs is included too).`;
        const thumb = previews ? `<canvas class="stage-thumb" width="160" height="96" data-preview="${n.id}" aria-hidden="true"></canvas>` : `<div class="stage-thumb placeholder"><span class="type-dot ${def.output}"></span></div>`;
        return `${i ? '<span class="stage-arrow" aria-hidden="true">→</span>' : ''}<div class="${classes}" data-stage="${n.id}" role="button" tabindex="0" aria-label="Show the output of ${esc(n.label)}" data-tip="Step ${i + 1}: ${esc(n.label)}|${esc(def.description)}\nClick to show this stage’s output on the canvas.">
<label class="stage-check" data-tip="${checkTip}"><input type="checkbox" data-enable="${n.id}" ${n.enabled ? 'checked' : ''} aria-label="Include ${esc(n.label)}"><span class="stage-step">${i + 1}</span><b>${esc(n.label)}</b></label>
${thumb}${isOutput ? '<span class="stage-badge">FINAL</span>' : ''}${reachable.has(n.id) ? '' : '<span class="stage-badge muted">UNUSED</span>'}
<small><span class="type-chip ${def.output}">${esc(typeLabels[def.output])}</span> ${roleLine(n)}</small></div>`;
    }).join('');
    $('pipelineCards').innerHTML = cards;
    const enabled = project.nodes.filter(n => n.enabled).length;
    $('pipelineCount').textContent = `${enabled} of ${project.nodes.length} included`;
    paintPreviews($('pipelineCards'));
}
$('pipelineCards').addEventListener('click', e => {
    if (e.target.closest('.stage-check')) {
        return; // the checkbox handles itself
    }
    const card = e.target.closest('[data-stage]');
    if (card) {
        const id = card.dataset.stage;
        setView(id === state.project.output ? 'final' : 'stage', { node: id, lock: false });
    }
});
$('pipelineCards').addEventListener('change', e => {
    const box = e.target.closest('[data-enable]');
    if (box) {
        setEnabled([box.dataset.enable], box.checked);
    }
});
$('pipelineCards').addEventListener('keydown', e => {
    const card = e.target.closest?.('[data-stage]');
    if (!card) {
        return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
    }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? card.nextElementSibling?.nextElementSibling : card.previousElementSibling?.previousElementSibling;
        if (next?.dataset.stage) {
            next.focus();
            next.click();
        }
    }
});
$('pipelineAll').onclick = enableAll;
$('pipelineNone').onclick = onlyStructure;
$('pipelineOriginal').onclick = restoreEnabled;
/** Keep the viewed or selected card in sight. */
function revealSelection() {
    const card = document.querySelector(`#pipelineCards [data-stage="${state.selected}"]`);
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
on('refresh', renderPipeline);
on('selection', () => {
    renderPipeline();
    revealSelection();
});
on('view', renderPipeline);
on('prefs', renderPipeline);
