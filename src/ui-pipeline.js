import { $, esc, state, on, setSelected, setEnabled, enableAll, onlyStructure, restoreEnabled, bypassDescription, viewedNode, firstSentence } from './editor.js';
import { catalog } from './catalog.js';
import { evaluationOrder, consumers, topologicalOrder } from './graph.js';
import { paintPreviews } from './ui-previews.js';
import { studyComponent, isDoubleClick } from './ui-study-link.js';
/** Pipeline panel: every component in evaluation order with a live thumbnail of
 * its output, a checkbox to include or bypass it, and what it feeds. It is the
 * map of the construction: click a card to select it (the component panel
 * explains it; the canvas keeps the view you chose, and in the step views follows
 * the selection), double-click to study it in the Playground. Badges mark the
 * final output, the step on the canvas and components with an unapplied edit.
 */
function roleLine(node) {
    const users = consumers(state.project, node.id);
    if (state.project.output === node.id) {
        return 'It makes the final picture.';
    }
    if (!users.length) {
        return 'Nothing uses it yet.';
    }
    return `Used by ${users.map(u => esc(u.node.label)).join(', ')}.`;
}
export function renderPipeline() {
    const project = state.project, order = evaluationOrder(project), reachable = new Set(topologicalOrder(project).map(n => n.id));
    const viewed = state.viewMode !== 'final' ? viewedNode().id : null, previews = state.prefs.previews;
    const cards = order.map((n, i) => {
        const def = catalog[n.type], isOutput = project.output === n.id;
        const classes = ['stage-card', def.output, state.selected === n.id ? 'selected' : '', viewed === n.id ? 'viewed' : '', n.enabled ? '' : 'disabled', reachable.has(n.id) ? '' : 'unused'].filter(Boolean).join(' ');
        const checkTip = `${n.enabled ? 'On' : 'Off'}: ${esc(n.label)}|Untick to switch this part off and see the picture without it (it then ${esc(bypassDescription(n))}). Tick to switch it on again.`;
        const thumb = previews ? `<canvas class="stage-thumb" width="160" height="96" data-preview="${n.id}" aria-hidden="true"></canvas>` : `<div class="stage-thumb placeholder"><span class="type-dot ${def.output}"></span></div>`;
        const marks = `${viewed === n.id ? `<span class="stage-mark on-canvas" data-tip="On the picture|The canvas shows ${state.viewMode === 'effect' ? 'what this part adds' : 'just this part'}.">👁</span>` : ''}${state.drafts.has(n.id) ? '<span class="stage-mark draft" data-tip="Edit not applied yet|Its math has an edit that is not applied yet.">✎</span>' : ''}`;
        return `${i ? '<span class="stage-arrow" aria-hidden="true">→</span>' : ''}<div class="${classes}" data-stage="${n.id}" role="button" tabindex="0" aria-pressed="${state.selected === n.id}" aria-label="Open part ${i + 1}: ${esc(n.label)}" data-tip="Part ${i + 1}: ${esc(n.label)}|${esc(def.description)} ${roleLine(n)}\nClick to open it in the panel; double-click for the wide panel.">
<div class="stage-check"><input type="checkbox" data-enable="${n.id}" ${n.enabled ? 'checked' : ''} aria-label="Include ${esc(n.label)}" data-tip="${checkTip}"><span class="stage-step">${i + 1}</span><b>${esc(n.label)}</b></div>
${marks}${thumb}${isOutput ? '<span class="stage-badge" data-tip="The final picture|This part makes the picture you see.">FINAL</span>' : ''}${reachable.has(n.id) ? '' : '<span class="stage-badge muted">NOT USED</span>'}
<small>${esc(firstSentence(def.description))}</small></div>`;
    }).join('');
    $('pipelineCards').innerHTML = cards;
    const enabled = project.nodes.filter(n => n.enabled).length;
    $('pipelineCount').textContent = `${enabled} of ${project.nodes.length} parts on`;
    paintPreviews($('pipelineCards'));
}
$('pipelineCards').addEventListener('click', e => {
    if (e.target.closest('[data-enable]')) {
        return; // the checkbox handles itself; the rest of the card selects
    }
    const card = e.target.closest('[data-stage]');
    if (card) {
        const id = card.dataset.stage;
        if (isDoubleClick(id)) {
            studyComponent(id);
            return;
        }
        setSelected(id);
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
on('draft', renderPipeline);
