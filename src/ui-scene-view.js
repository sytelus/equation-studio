import { esc, state, on, setSelected, firstSentence, sceneOrigin } from './editor.js';
import { catalog } from './catalog.js';
import { evaluationOrder, topologicalOrder } from './graph.js';
import { concept } from './concepts.js';
import { creditLine, linesOf } from './works.js';
import { analyzeCode } from './glsl.js';
import { sceneGuide, applyTry, tryAvailable, wasTried } from './ui-try.js';
import { applyTour, highlightCode } from './ui-code-view.js';
import { togglePlay } from './ui-timeline.js';
import { previewTile } from './ui-previews.js';
import { openLibrary } from './ui-library.js';
import { showViewTab } from './ui-component-view.js';
/** The whole scene in the side panel: what it is, who made it, how it works, what to
 * try and which parts it is built from. It is what the panel shows when a scene is
 * opened; choosing a part shows that part (ui-component-view.js), whose header leads
 * back here.
 *
 * Sections, in the order a newcomer needs them:
 *   What you are seeing   the scene's story in plain words, and Play
 *   Try this              challenges that change one thing each (ui-try.js)
 *   How it works          a work's walk-through: each step highlights its lines of
 *                         code (shown here) and may stop a loop or show a value
 *   How it is built       the parts, in order, each with one line on what it does
 *   Big ideas             the math ideas it uses (they open in the part's Big ideas tab)
 *   Where it comes from   the credit, and the code exactly as the artist posted it
 */
const LEVELS = {
    easy: ['Easy', 'A few lines of math. A good place to start.'],
    medium: ['Medium', 'More steps to follow, but every one is explained.'],
    expert: ['Expert', 'Many parts working together. Try the easy scenes first.']
};
export function levelBadge(level) {
    const [label, tip] = LEVELS[level] || [];
    return label ? `<span class="level-badge ${level}" data-tip="${label}|${tip}">${label}</span>` : '';
}
function verifiedBadge(work) {
    if (!work) {
        return '';
    }
    return work.platform === 'twigl'
        ? '<span class="work-badge ok" data-tip="Checked|The picture here is the same, pixel for pixel, as the artist’s own code produces (tools/works_check.py compares them).">✓ Made from the artist’s own code</span>'
        : work.platform === 'p5'
            ? '<span class="work-badge ok" data-tip="Checked|The dots here land where the artist’s p5.js sketch puts them (tools/works_check.py compares the two pictures).">✓ Made from the artist’s own sketch</span>'
            : '<span class="work-badge study" data-tip="Our own study|The artist did not publish their code. This is our own attempt at the look, not their method.">Our own study of the look</span>';
}
export class SceneView {
    constructor(root) {
        this.root = root;
        this.root.addEventListener('click', e => this.onClick(e));
    }
    render() {
        const project = state.project, guide = sceneGuide(project), work = guide?.work;
        const order = evaluationOrder(project), reachable = new Set(topologicalOrder(project).map(n => n.id));
        const credit = work
            ? `<div class="sv-credit">${work.platform === 'study' ? 'After' : 'By'} ${esc(creditLine(work))} · <a href="${esc(work.url)}" target="_blank" rel="noopener noreferrer" data-tip="The artist’s post|${esc(work.url)} (opens in a new tab)">the original post ↗</a></div>`
            : `<div class="sv-credit">${esc(sceneOrigin(project))}</div>`;
        const welcome = state.prefs.welcomed ? '' : `<div class="sv-welcome"><b>Welcome!</b> Every picture here is computed from math, pixel by pixel, while you watch. Press <b>▶ Play</b>, try the challenges below, and change anything you like: nothing can break, and Undo (Ctrl+Z) always takes you back. <button class="link" data-sv="gallery">Pick another scene ›</button></div>`;
        const about = guide?.about || project.description || '';
        const play = project.duration > 0 ? `<button class="sv-play" data-sv="play" aria-pressed="${state.playing}">${state.playing ? '❚❚ Pause' : '▶ Play the animation'}</button>` : '';
        const main = guide?.node && project.nodes.some(n => n.id === guide.node) ? `<button class="sv-open" data-sv-part="${esc(guide.node)}" data-tip="Open the ${catalog[project.nodes.find(n => n.id === guide.node).type].code ? 'code' : 'formula'}|See it line by line, drag its numbers and watch the picture change.">Open its ${catalog[project.nodes.find(n => n.id === guide.node).type].code ? 'code' : 'formula'} ›</button>` : '';
        let html = `<header class="sv-head"><div class="sv-kicker">ABOUT THIS SCENE</div><h2 class="sv-title">${esc(project.title)}</h2>${credit}<div class="sv-badges">${levelBadge(guide?.level)}${verifiedBadge(work)}</div></header>${welcome}`;
        html += this.section('WHAT YOU ARE SEEING', `<p class="sv-about">${esc(about)}</p><div class="sv-actions">${play}${main}</div>`);
        if (guide?.try.length) {
            const items = guide.try.map((entry, k) => {
                const available = tryAvailable(entry, guide), done = wasTried(k);
                return `<li class="try-card ${done ? 'tried' : ''} ${available ? '' : 'unavailable'}"><span class="try-num" aria-hidden="true">${done ? '✓' : k + 1}</span><p>${esc(entry.text)}</p><button class="try-button" data-try="${k}" ${available ? '' : 'disabled'} data-tip="${done ? 'Try it again|Undo (Ctrl+Z) takes back the last change.' : 'Try it|Makes this one change. Undo (Ctrl+Z) takes it back.'}">${done ? 'Again' : 'Try it'}</button></li>`;
            }).join('');
            html += this.section('TRY THIS', `<ol class="try-list">${items}</ol><p class="sv-note">You cannot break anything. Undo (Ctrl+Z, or ↶ at the top) takes back each change, and Start over brings back the whole scene as it was.</p>`);
        }
        if (guide?.tour.length) {
            html += this.section('HOW IT WORKS', this.tour(guide), { tip: 'How it works|A walk through the code, one idea at a time. Each step shows the lines it is about, and some steps change what the picture shows.' });
        }
        const parts = order.map((n, i) => {
            const def = catalog[n.type], used = reachable.has(n.id);
            return `<li><button class="sv-part ${n.enabled ? '' : 'off'}" data-sv-part="${esc(n.id)}" data-tip="${esc(n.label)}|${esc(def.description)}\nClick to open this part."><canvas class="sv-thumb" data-thumb="${esc(n.id)}" width="96" height="58" aria-hidden="true"></canvas><span class="sv-part-text"><b>${i + 1}. ${esc(n.label)}</b><small>${esc(firstSentence(def.description))}${n.enabled ? '' : ' (switched off)'}${used ? '' : ' (not used)'}</small></span><span class="sv-go" aria-hidden="true">›</span></button></li>`;
        }).join('');
        html += this.section('HOW IT IS BUILT', `<p class="sv-note">This scene is built from ${order.length} parts. Each one works on the result of the parts before it, for every pixel. The same parts are shown as small pictures under the canvas. Click one to see how it works.</p><ol class="sv-parts">${parts}</ol>`);
        const ideas = [...new Set([...(work?.concepts || []), ...project.nodes.flatMap(n => catalog[n.type].concepts)])].filter(id => concept(id));
        if (ideas.length) {
            html += this.section('BIG IDEAS', `<p class="sv-note">The math ideas this scene uses. Click one to read about it and play with its graph.</p><div class="sv-ideas">${ideas.map(id => `<button class="idea-chip" data-sv-idea="${esc(id)}">${esc(concept(id).title)}</button>`).join('')}</div>`);
        }
        if (work?.original) {
            html += this.section('WHERE IT COMES FROM', `<p class="sv-note">${work.platform === 'study' ? `This is our own study of a clip by ${esc(work.author)}. They did not publish their code, so everything here is our own way of getting a similar look.` : `${esc(work.author)} posted this ${work.platform === 'p5' ? 'p5.js sketch' : 'shader'} complete, in the text of the post. The scene runs the same math, written out with names and explanations; here it is exactly as posted:`}</p><pre class="original-code">${esc(work.original)}</pre>`);
        }
        this.root.innerHTML = `<div class="scene-view">${html}</div>`;
        this.paintThumbs();
    }
    section(title, body, { tip = '' } = {}) {
        return `<section class="sv-section"><h3 class="sv-h" ${tip ? `data-tip="${esc(tip)}"` : ''}>${title}</h3>${body}</section>`;
    }
    /** The walk-through: numbered steps; the active one shows its text and its lines of code. */
    tour(guide) {
        const work = guide.work, node = state.project.nodes.find(n => n.id === guide.node), active = state.tour?.node === guide.node ? state.tour.index : null;
        const items = work.tour.map((step, k) => {
            const open = active === k;
            const effects = [step.show ? `the picture shows the value <code>${esc(step.show)}</code>` : '', step.steps ? Object.entries(step.steps).map(([loop, count]) => `loop ${loop} stops after ${count} step${count === 1 ? '' : 's'}`).join(', ') : ''].filter(Boolean).join(' and ');
            const body = open ? `<div class="sv-step-body"><p>${esc(step.text)}</p>${effects ? `<p class="sv-effect">While this step is open, ${effects}.</p>` : ''}${this.excerpt(node, step.at)}<button class="link" data-sv-code="${esc(guide.node)}">See it in the whole ${catalog[node?.type]?.code ? 'code' : 'formula'} ›</button></div>` : '';
            return `<li class="sv-step ${open ? 'open' : ''}"><button class="sv-step-head" data-sv-tour="${k}" aria-expanded="${open}"><span class="tour-number">${k + 1}</span><b>${esc(step.title)}</b></button>${body}</li>`;
        }).join('');
        const end = active !== null ? '<button class="link" data-sv-tour-end>✕ Close the step</button>' : '';
        return `<p class="sv-note">Click a step to open it. The picture changes to show what the step is about.</p><ol class="sv-tour">${items}</ol>${end}`;
    }
    /** The lines of a part's code or formula that contain any of `snippets`. */
    excerpt(node, snippets = []) {
        if (!node || !snippets.length) {
            return '';
        }
        const source = catalog[node.type].code ? node.params.code : node.params.expression || '';
        const lines = linesOf(source, snippets);
        if (!lines.length) {
            return '';
        }
        if (catalog[node.type].code) {
            try {
                return `<pre class="code-view excerpt">${highlightCode(analyzeCode(source), { only: lines })}</pre>`;
            }
            catch (e) { /* edited code with an error: show it plain */
            }
        }
        const rows = source.split('\n');
        return `<pre class="code-view excerpt">${lines.map(k => {
            const [code, ...comment] = rows[k - 1].split('//');
            return `<span class="c-line"><span class="c-ln">${k}</span><span class="c-text">${esc(code.trimEnd())}${comment.length ? `  <span class="c-com">//${esc(comment.join('//'))}</span>` : ''}</span></span>`;
        }).join('')}</pre>`;
    }
    paintThumbs() {
        for (const canvas of this.root.querySelectorAll('canvas[data-thumb]')) {
            const tile = previewTile(canvas.dataset.thumb);
            if (tile) {
                canvas.width = tile.width;
                canvas.height = tile.height;
                canvas.getContext('2d').putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
                canvas.classList.add('painted');
            }
        }
    }
    onClick(e) {
        const t = e.target, guide = sceneGuide();
        const tryButton = t.closest('[data-try]');
        if (tryButton) {
            applyTry(Number(tryButton.dataset.try));
            this.render();
            return;
        }
        const part = t.closest('[data-sv-part]');
        if (part) {
            setSelected(part.dataset.svPart);
            return;
        }
        const code = t.closest('[data-sv-code]');
        if (code) {
            setSelected(code.dataset.svCode);
            return;
        }
        const step = t.closest('[data-sv-tour]');
        if (step && guide?.node) {
            const k = Number(step.dataset.svTour);
            applyTour(guide.node, state.tour?.node === guide.node && state.tour.index === k ? null : k);
            return;
        }
        if (t.closest('[data-sv-tour-end]') && guide?.node) {
            applyTour(guide.node, null);
            return;
        }
        const idea = t.closest('[data-sv-idea]');
        if (idea) {
            const owner = state.project.nodes.find(n => n.id === guide?.node) || state.project.nodes.find(n => catalog[n.type].concepts.includes(idea.dataset.svIdea)) || state.project.nodes[0];
            setSelected(owner.id);
            showViewTab('ideas');
            requestAnimationFrame(() => document.querySelector(`[data-concept-card="${CSS.escape(idea.dataset.svIdea)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
            return;
        }
        const action = t.closest('[data-sv]')?.dataset.sv;
        if (action === 'play') {
            togglePlay();
            this.render();
        }
        else if (action === 'gallery') {
            openLibrary('scenes');
        }
    }
}
on('playing', () => {
    for (const button of document.querySelectorAll('.sv-play')) {
        button.textContent = state.playing ? '❚❚ Pause' : '▶ Play the animation';
        button.setAttribute('aria-pressed', String(state.playing));
    }
});
