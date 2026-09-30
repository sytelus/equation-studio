import { esc, clamp, state, on, toast, showError, transact, seek, pause, nodeById, currentNode, setOutput, setSelected, selectStep, selectionPosition, toggleEnabled, duplicateNode, deleteNode, connect, resetParam, resetNode, insertComponent, replaceComponent, bypassDescription, liveParam, endLiveEdit, applyEquation, setDraft, startEdit, discardDraft, draftChanged, showScene, KIND_LABELS, KIND_NAMES } from './editor.js';
import { catalog, insertableTypes, replacementTypes, emitPreview, paramSpecs } from './catalog.js';
import { topologicalOrder, consumers, evaluationOrder } from './graph.js';
import { animatedParameters, insertKey } from './timeline.js';
import { texToMathML, texToMathMLSegments, programToMathML, symbolKey, nameMathML, numberMathML } from './math-render.js';
import { concept } from './concepts.js';
import { plotSVG } from './plot.js';
import { originalValue, isParamModified, isModified } from './explore.js';
import { forkBlocker } from './fork.js';
import { compileEquation, programGLSL, LIBRARY } from './expression.js';
import { mathGLSL } from './math-glsl.js';
import { nebulaGLSL } from './nebula-glsl.js';
import { motifsGLSL } from './motifs-glsl.js';
import { previewTile } from './ui-previews.js';
import { openSweep, openVariations } from './ui-explore.js';
import { codeTab, insideTab, originalSection, tourBanner, tourLines, workOf, codeAction, codeClick, startNumberDrag, numberKey, codeDraftStatus, readPointValues } from './ui-code-view.js';
import { statsTab, statsAction } from './ui-stats.js';
/** One component, explained and editable. The same view renders in the
 * component panel (normal or wide: the Equation Playground) and in a pop-out
 * window, so it never looks elements up through `document`: everything is scoped
 * to its root and events are delegated to the root once.
 *
 * The UI calls components "parts" and parameters "settings". Layout: a header
 * that stays in view leads back to the whole scene (‹ scene title), says which
 * part this is (Part 3 of 4, ◀ ▶), holds its on/off switch, and offers tabs:
 *
 *   Math      what it computes: its settings (sliders) first, then its equation
 *             as numbered steps with captions (symbols colored by role: blue comes
 *             in, orange is a setting you can drag, pink is time, green is what it
 *             makes), ✎ Edit and the key function
 *   Code      (shader code) the code, highlighted and explained (drag its orange
 *             numbers), its loops, time and settings (ui-code-view.js)
 *   Look inside (shader code) every value the code computes, viewable on the canvas
 *   Big ideas the recurring mathematical ideas behind it, and its other symbols
 *   Connections where each input comes from, and where the output goes
 *   Measure   measurements of its output: values, histogram, motion over the
 *             loop, GPU time (ui-stats.js)
 *   More      its shader code, keyframes, replace / duplicate / delete
 *
 * The last three are for going deeper and are shown in a quieter style.
 *
 * Editing. ✎ Edit replaces the steps by an editor holding the equation (for a
 * built-in component, the equivalent equation from fork.js). The text is a draft
 * (state.drafts) shared by every view; the canvas previews it until Apply or
 * Cancel. Width decides the layout: two columns when the view is wide enough.
 */
const views = new Set();
const TAB_LABELS = { equation: 'Math', code: 'Code', inside: 'Look inside', flow: 'Connections', ideas: 'Big ideas', stats: 'Measure', more: 'More' };
/** Tabs for going deeper, shown in a quieter style after the others. */
const DEEPER_TABS = new Set(['flow', 'stats', 'more']);
/** The tabs of a component's view. */
function tabsFor(n) {
    return catalog[n.type].code ? ['code', 'inside', 'ideas', 'flow', 'stats', 'more'] : ['equation', 'ideas', 'flow', 'stats', 'more'];
}
/** The ideas behind a component, and behind the work it belongs to. */
function conceptsOf(n) {
    return [...new Set([...catalog[n.type].concepts, ...(workOf(n)?.concepts || [])])];
}
const LIBRARY_SOURCE = `${mathGLSL}\n${nebulaGLSL}\n${motifsGLSL}`;
const CUSTOM_LHS = { expression: '<mi>f</mi>', vectorExpression: '<mi>q</mi>', colorExpression: '<mi mathvariant="normal">RGB</mi>' };
const formatNumber = value => String(Number(Number(value).toFixed(5)));
const HELPERS = [
    ['param k = 1 [0, 2]', 'a setting with a slider'], ['param tint = #ffd080', 'a color setting'], ['d = length(p) - 1', 'a definition'],
    ['rotate2(p, angle)', 'rotate a coordinate'], ['angleOf(p)', 'atan2 of a coordinate'], ['noise2(p)', 'smooth value noise 0–1'], ['fbm(p, octaves)', 'fractal noise 0–1'],
    ['gaussian(d, width)', 'exp(−(d/width)²)'], ['cutoff(x)', 'exp(−exp(x)) source gate'], ['softInside(d, edge)', 'soft inside mask 0–1'], ['sat(x)', 'clamp to 0–1'],
    ['segmentDistance(p, a, b)', 'distance to a segment'], ['spectrum(x, shift)', 'vec3 rainbow palette'], ['vortex(p, strength, radius, phase)', 'local twist map'],
    ['domainWarp(p, amplitude, frequency, time)', 'noise displacement map'], ['angularMirror(p, sectors, phase)', 'kaleidoscopic fold'], ['hash21(p)', 'deterministic pseudo-random 0–1']
];
const RESULTS = { expression: 'a number', vectorExpression: 'a point vec2(x, y)', colorExpression: 'a color vec3(r, g, b), or vec4 with coverage' };
/** Typeset TeX, falling back to the source text so a typo never hides content. */
function math(tex, options = {}) {
    try {
        return texToMathML(tex, { display: false, ...options });
    }
    catch (e) {
        return `<code>${esc(tex)}</code>`;
    }
}
function segments(tex, options = {}) {
    try {
        return texToMathMLSegments(tex, options).map(m => `<span class="eq-seg">${m}</span>`).join('');
    }
    catch (e) {
        return `<code>${esc(tex)}</code>`;
    }
}
/** Caption text with TeX-style sub- and superscripts set as such: a one-letter
 * symbol with a short index (L_s, α_F, |U|^η, 1.25^s), not snake_case names.
 */
function richText(text) {
    return esc(text)
        .replace(/(^|[^\p{L}\p{N}_])([\p{L}|)])_([\p{L}\p{N}]{1,3})(?![\p{L}\p{N}_])/gu, '$1$2<sub>$3</sub>') // no lookbehind: Safari < 16.4
        .replace(/\^([\p{L}\p{N}]{1,3})(?![\p{L}\p{N}_])/gu, '<sup>$1</sup>');
}
/** GLSL source of a library function, for "how does the kernel work". */
function kernelSource(name) {
    const at = LIBRARY_SOURCE.search(new RegExp(`^(?:float|vec2|vec3|vec4|Geometry)\\s+${name}\\s*\\(`, 'm'));
    if (at < 0) {
        return '';
    }
    let depth = 0, end = LIBRARY_SOURCE.indexOf('{', at);
    for (; end < LIBRARY_SOURCE.length; end++) {
        if (LIBRARY_SOURCE[end] === '{') {
            depth++;
        }
        else if (LIBRARY_SOURCE[end] === '}' && --depth === 0) {
            break;
        }
    }
    const comment = LIBRARY_SOURCE.slice(Math.max(0, LIBRARY_SOURCE.lastIndexOf('\n', LIBRARY_SOURCE.lastIndexOf('\n', at - 1) - 1)), at).split('\n').filter(l => l.startsWith('//')).join('\n');
    return `${comment ? `${comment}\n` : ''}${LIBRARY_SOURCE.slice(at, end + 1)}`;
}
function reachesOutput(node) {
    return topologicalOrder(state.project).some(n => n.id === node.id);
}
/** Symbol annotations for a node's equations (see math-render.js). */
function symbolTable(n, def, evaluated) {
    const symbols = {};
    for (const [key, spec] of Object.entries(paramSpecs(n))) {
        if (spec.kind !== 'expression') {
            symbols[spec.custom ? key : spec.symbol] = { role: 'param', param: key, value: spec.kind === 'number' ? evaluated[key] : undefined, title: `${spec.label} · drag to change` };
        }
    }
    for (const [socket, kind] of Object.entries(def.inputs)) {
        const source = nodeById(n.inputs[socket]);
        for (const s of (def.inputSymbols[socket] || socket).split(',').map(x => x.trim())) {
            symbols[s] ??= { role: 'input', type: kind, socket, title: source ? `from ${source.label}` : 'unconnected: zero' };
        }
    }
    if (def.custom) {
        for (const local of ['x', 'y', 'r', 'theta']) {
            symbols[local] ??= { role: 'input', type: 'coord', socket: 'p', title: 'from the coordinates p' };
        }
    }
    for (const s of def.outputSymbols) {
        symbols[s] = { role: 'output', type: def.output, title: 'what this part makes' };
    }
    symbols.t ??= { role: 'time', title: 'time in seconds' };
    return symbols;
}
/** The first equation step of `def` that uses one of `symbols` (TeX), or null. */
function stepUsing(def, symbols) {
    const keys = symbols.map(symbolKey);
    return def.steps.find(s => keys.some(k => symbolKey(s.tex).includes(k)))?.tex ?? def.steps.at(-1)?.tex ?? null;
}
/** A custom equation as typeset step items {math, text, result}. */
function programItems(source, type, symbols, values) {
    return programToMathML(source, CUSTOM_LHS[type], { symbols, values }).map(line => ({ math: `<span class="eq-seg">${line.mathml}</span>`, text: line.text || (line.kind === 'result' ? 'The result. Add “// …” after any line to explain it here.' : ''), result: line.kind === 'result', name: line.name }));
}
/** Names of the definitions of `source` (and '' for its result line) that the
 * active walk-through step of part `n` explains. */
function tourNames(n, source) {
    const lines = source.split('\n'), names = new Set();
    for (const k of tourLines(n, source)) {
        const m = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(lines[k - 1]);
        names.add(m ? m[1] : '');
    }
    return names;
}
function stepList(items, id = '') {
    return `<ol class="steps"${id ? ` id="${id}"` : ''}>${items.map((item, i) => `<li class="step ${item.result ? 'result' : ''} ${item.invalid ? 'invalid' : ''} ${item.hl ? 'hl' : ''}"><span class="step-number" aria-hidden="true">${item.result ? '⇒' : i + 1}</span><div class="step-body"><div class="step-math">${item.math}</div>${item.text ? `<p class="step-text">${richText(item.text)}</p>` : ''}</div></li>`).join('')}</ol>`;
}
/** The nearest scrolling ancestor of `el` (the panel, or the pop-out's page). */
function scroller(el) {
    for (let e = el; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (/(auto|scroll)/.test(style.overflowY) && e.scrollHeight > e.clientHeight) {
            return e;
        }
    }
    return el.ownerDocument.scrollingElement;
}
export class ComponentView {
    /** `layout`: 'panel' (the component panel) or 'popout'.
     * `pinned`: a node id to show instead of following the selection.
     */
    constructor(root, { layout = 'panel', pinned = null } = {}) {
        this.root = root;
        this.layout = layout;
        this.pinned = pinned;
        this.ui = { values: false, tab: 'equation', knobs: {}, collapsed: new Set(), blockedNote: false };
        this.curveFrame = 0;
        views.add(this);
        this.bindEvents();
    }
    q(selector) {
        return this.root.querySelector(selector);
    }
    qa(selector) {
        return [...this.root.querySelectorAll(selector)];
    }
    node() {
        return (this.pinned && nodeById(this.pinned)) || currentNode();
    }
    dispose() {
        views.delete(this);
        this.root.innerHTML = '';
    }
    editing(n = this.node()) {
        return !!n && state.drafts.has(n.id);
    }
    // ---- Rendering -----------------------------------------------------------
    render() {
        if (this.layout === 'panel' && state.panel === 'scene') {
            this.root.dataset.node = ''; // hidden while the panel shows the whole scene; rebuilt when shown
            return;
        }
        const n = this.node();
        if (!n) {
            this.root.innerHTML = '';
            return;
        }
        const def = catalog[n.type], evaluated = animatedParameters(state.project, n, state.time), fresh = this.root.dataset.node !== n.id;
        if (fresh) {
            this.ui.blockedNote = false;
            this.ui.tour = null;
            this.ui.pointValues = null;
        }
        const tabs = tabsFor(n);
        if (!tabs.includes(this.ui.tab)) {
            this.ui.tab = this.ui.tab === 'equation' || this.ui.tab === 'code' ? tabs[0] : this.ui.tab === 'inside' ? 'code' : tabs[0];
        }
        const focus = this.captureFocus();
        const bodies = { equation: () => this.equationTab(n, def, evaluated), code: () => codeTab(this, n, evaluated), inside: () => insideTab(this, n), flow: () => this.flowTab(n, def), ideas: () => this.ideasTab(n, def), stats: () => statsTab(this, n), more: () => this.moreTab(n, def) };
        this.root.innerHTML = `<div class="cview">${this.head(n, def)}<div class="cv-body" role="tabpanel" aria-label="${esc(TAB_LABELS[this.ui.tab])}">${bodies[this.ui.tab]()}</div></div>`;
        if (this.ui.tab === 'inside') {
            const key = JSON.stringify([state.probePin, state.time, n.params.code, state.project.view]);
            if (key !== this.ui.pointKey) {
                this.ui.pointKey = key;
                readPointValues(this, n);
            }
        }
        this.root.dataset.node = n.id;
        this.paintThumbs();
        if (fresh) {
            const box = scroller(this.root);
            if (box && box.scrollTop > 0 && box !== this.root.ownerDocument.scrollingElement) {
                box.scrollTop = 0; // a new component starts at its top
            }
        }
        this.restoreFocus(focus);
    }
    captureFocus() {
        const el = this.root.ownerDocument.activeElement;
        if (!el || !this.root.contains(el) || !el.id) {
            return null;
        }
        return { id: el.id, start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop };
    }
    restoreFocus(focus) {
        const el = focus && this.q(`#${CSS.escape(focus.id)}`);
        if (!el) {
            return;
        }
        el.focus({ preventScroll: true });
        if (typeof focus.start === 'number' && el.setSelectionRange) {
            try {
                el.setSelectionRange(focus.start, focus.end);
            }
            catch (e) { /* not a text control */
            }
        }
        el.scrollTop = focus.scroll || 0;
    }
    section(id, title, body, { tools = '', tip = '', cls = '' } = {}) {
        const collapsed = this.ui.collapsed.has(id);
        return `<section class="cv-section ${cls} ${collapsed ? 'collapsed' : ''}" data-section="${id}"><header class="inspector-section"><button class="cv-fold" data-fold="${id}" aria-expanded="${!collapsed}" ${tip ? `data-tip="${esc(tip)}"` : ''}>${title}</button><span class="cv-tools">${tools}</span></header><div class="cv-section-body">${body}</div></section>`;
    }
    /** The header that stays in view: position in the construction, the include
     * switch and title, and the tabs.
     */
    head(n, def) {
        const bypass = bypassDescription(n), { index, count } = selectionPosition(), pinnedHere = this.pinned && this.pinned !== state.selected;
        const order = evaluationOrder(state.project), position = order.findIndex(v => v.id === n.id);
        const tools = this.layout === 'panel'
            ? `<button class="cv-tool ${state.prefs.playground ? 'active' : ''}" data-action="playground" aria-pressed="${!!state.prefs.playground}" data-toggle data-key="E" data-tip="Wide panel|Makes this panel wide: the math and the settings side by side, with a graph of the numbers under the picture. Choose again for the normal width.">⤢ Wide</button><button class="cv-tool" data-action="popout" aria-label="Pop out" data-tip="Its own window|Opens this panel in a separate window, for example on a second screen. It follows what you open, and its controls change the scene.">↗</button>`
            : '';
        const crumb = this.layout === 'panel' ? `<button class="cv-crumb" data-action="scene" data-tip="Back to the whole scene|${esc(state.project.title)}: what it is, how it works and what to try.">‹ Whole scene</button>` : '';
        const nav = pinnedHere
            ? `<span class="cv-pos">Pinned: part ${position + 1} of ${order.length}</span>`
            : `${crumb}<span class="cv-pos" data-tip="Where you are|This scene is built from ${count} parts, each working on the result of the ones before it, in the order of the Parts strip under the picture. This is part ${index + 1}.">Part ${index + 1} of ${count}</span><button class="cv-step" data-action="prev" ${index <= 0 ? 'disabled' : ''} aria-label="Previous part" data-key="[" data-tip="Previous part|The part before this one. The picture keeps its view.">◀</button><button class="cv-step" data-action="next" ${index >= count - 1 ? 'disabled' : ''} aria-label="Next part" data-key="]" data-tip="Next part|The part after this one. The picture keeps its view.">▶</button>`;
        const draft = this.editing(n) ? '<span class="cv-draft" data-tip="Edit not applied yet|This part’s math has an edit that is not applied yet. Apply or Cancel it in the Math tab.">✎ editing</span>' : '';
        const concepts = conceptsOf(n).length;
        const tabs = tabsFor(n).map(id => {
            const extra = id === 'ideas' && concepts ? ` <span class="cv-count">${concepts}</span>` : id === 'more' && state.project.tracks.some(t => t.node === n.id && t.keys.length) ? ' <span class="cv-count">◆</span>' : (id === 'equation' || id === 'code') && this.editing(n) ? ' <span class="cv-count">✎</span>' : id === 'inside' && state.show?.node === n.id ? ' <span class="cv-count">◉</span>' : '';
            return `<button role="tab" class="cv-tab ${this.ui.tab === id ? 'active' : ''} ${DEEPER_TABS.has(id) ? 'deeper' : ''}" data-tab="${id}" aria-selected="${this.ui.tab === id}">${TAB_LABELS[id]}${extra}</button>`;
        }).join('');
        return `<header class="cv-head"><div class="cv-nav">${nav}${draft}<span class="spacer"></span>${tools}</div>
<div class="inspector-head"><label class="switch" data-tip="${n.enabled ? 'This part is on' : 'This part is off'}|Switch it off to see what the picture looks like without it: it then ${esc(bypass)}. Switch it on again to bring it back." data-toggle aria-pressed="${n.enabled}"><input type="checkbox" id="nodeEnabled" ${n.enabled ? 'checked' : ''} aria-label="This part is on"><span></span></label><input class="node-title" id="nodeLabel" value="${esc(n.label)}" aria-label="Name of this part" maxlength="160" data-tip="Rename|Give this part your own name. It is only a label; nothing else changes."><span class="type-chip ${def.output}" data-tip="What it makes|${esc(KIND_NAMES[def.output])}">makes ${esc(KIND_LABELS[def.output])}</span></div>
<nav class="cv-tabs" role="tablist" aria-label="About this part">${tabs}</nav></header>`;
    }
    warnings(n) {
        if (!n.enabled) {
            return `<div class="selection-note warning">This part is switched off, so it ${esc(bypassDescription(n))}. Use the switch next to its name to turn it on again.</div>`;
        }
        if (!reachesOutput(n)) {
            return '<div class="selection-note warning">Nothing uses this part, so it does not change the picture. Choose <b>Just this part</b> above the picture to see what it makes, or connect it to another part (Connections tab).</div>';
        }
        return '';
    }
    // ---- Equation tab ---------------------------------------------------------
    equationTab(n, def, evaluated) {
        const w = workOf(n);
        const about = w && def.points ? `This part draws <b>${esc(w.title)}</b>. The formula below runs once for every dot number i, from 0 up to the number of dots, and works out where that dot goes. Change a setting, or ✎ Edit the formula itself, and watch the dots move.` : esc(def.description);
        const intro = `<p class="node-caption">${about}</p>${this.warnings(n)}`;
        if (this.editing(n)) {
            return `${intro}<div class="cv-cols editing"><div class="cv-col">${this.editor(n, def)}</div><div class="cv-col">${this.draftMath(n, def)}${this.syntaxHelp(n)}</div></div>`;
        }
        return `${intro}<div class="cv-cols"><div class="cv-col">${this.parameters(n, def, evaluated)}${this.curve(def, evaluated)}</div><div class="cv-col">${tourBanner(n)}${this.steps(n, def, evaluated)}${workOf(n) ? originalSection(this, n) : ''}</div></div>`;
    }
    editButton(n) {
        const blocker = forkBlocker(n.type);
        if (blocker) {
            return `<button class="edit-button" id="editEquation" aria-disabled="true" data-action="edit-blocked" data-tip="This equation cannot be edited as text|${esc(blocker)}">✎ Edit</button>`;
        }
        const tip = catalog[n.type].custom
            ? 'Edit the equation|Change its text line by line. The canvas previews your edit until you Apply it.'
            : 'Edit the math|Opens this part written out as math of its own, line by line, with its settings as sliders. Change anything: the picture shows your edit, and Apply puts it into the scene (Undo brings back the original).';
        return `<button class="edit-button" id="editEquation" data-action="edit" data-tip="${esc(tip)}">✎ Edit</button>`;
    }
    steps(n, def, evaluated) {
        const symbols = symbolTable(n, def, evaluated), values = this.ui.values;
        let items;
        if (def.custom) {
            try {
                items = programItems(n.params.expression, n.type, symbols, values);
                const marked = tourNames(n, n.params.expression);
                items.forEach(item => item.hl = marked.has(item.result ? '' : item.name));
            }
            catch (e) {
                items = [{ math: `<code>${esc(n.params.expression)}</code>`, text: e.message, result: true, invalid: true }];
            }
        }
        else {
            items = def.steps.map((s, i) => ({ math: segments(s.tex, { symbols, values }), text: s.text, result: i === def.steps.length - 1 }));
        }
        const legend = `<p class="sym-legend"><b>Reading the colors:</b> <span class="sym-in">blue</span> letters come in from earlier parts (like where the pixel is), <span class="sym-par">orange</span> ones are settings you can drag left or right, <span class="sym-tm">pink t</span> is the time in seconds, and <span class="sym-out">green</span> is what this part makes. The last line (⇒) is the result.</p>`;
        const blocked = this.ui.blockedNote ? `<div class="selection-note">${esc(forkBlocker(n.type))}</div>` : '';
        const tools = `<button class="link ${values ? 'active' : ''}" data-action="values" aria-pressed="${values}" data-tip="${values ? 'Show letters|Show the settings as their letters again.' : 'Show numbers|Put each setting’s current number in place of its letter, updated as you change it.'}">${values ? 'Show letters' : 'Show numbers'}</button>${this.editButton(n)}`;
        return this.section('equation', 'THE MATH, STEP BY STEP', `${legend}${blocked}${stepList(items, 'expressionPreview')}`, { tools, tip: 'The math|What this part computes for every pixel, one step per line, each with an explanation. The ⇒ line is its result. Hover a symbol to see it everywhere; drag an orange setting to change it; ✎ Edit to change the math itself.' });
    }
    editor(n, def) {
        const source = state.drafts.get(n.id) ?? '', custom = def.custom;
        const note = custom
            ? 'Change any line. The canvas previews your edit; <b>Apply</b> puts it into the scene.'
            : `This is <b>${esc(def.name)}</b> written out as math of its own, line by line. Change anything: the picture shows your edit, and <b>Apply</b> makes this part run your math (it keeps its wiring, values and animation; Undo restores it).`;
        const options = HELPERS.map(([code, hint]) => `<option value="${esc(code)}">${esc(code)} — ${esc(hint)}</option>`).join('');
        const kernels = Object.entries(LIBRARY).filter(([name]) => !HELPERS.some(([code]) => code.startsWith(`${name}(`))).map(([name, f]) => `<option value="${esc(`${name}(${f.params.map(p => p.name).join(', ')})`)}">${esc(name)}(${esc(f.params.map(p => p.name).join(', '))}) → ${f.returns}</option>`).join('');
        const tools = `<button data-action="cancel-edit" id="cancelEquation" data-tip="Cancel|Throw this edit away; the part stays as it was.">Cancel</button><button id="applyEquation" class="primary" data-action="apply-equation" data-key="Ctrl/⌘ Enter" data-tip="Apply|Puts the equation into the scene (one undo step). An equation with an error is not applied.">Apply</button>`;
        const body = `<p class="edit-note">${note}</p><textarea id="equationEditor" class="expression-input" spellcheck="false" aria-label="Equation text" rows="${Math.min(16, Math.max(5, source.split('\n').length + 1))}">${esc(source)}</textarea>
<div class="expression-tools"><select id="insertHelper" aria-label="Insert a line or a function" data-tip="Insert|Adds a setting line, a definition or a function where the cursor is."><option value="">Insert…</option><optgroup label="Lines and helpers">${options}</optgroup><optgroup label="Scene kernels">${kernels}</optgroup></select></div>
<p id="equationError" class="code-error" aria-live="polite">${esc(this.draftStatus(n).text)}</p>`;
        return this.section('editor', '✎ EDITING THE EQUATION', body, { tools, cls: 'editing', tip: 'Editing|Your text is a draft until you apply it. Ctrl/⌘ Enter applies; Cancel discards it.' });
    }
    /** The draft's check result: {ok, text}. */
    draftStatus(n) {
        if (catalog[n.type].code) {
            return codeDraftStatus(n);
        }
        const source = state.drafts.get(n.id);
        try {
            compileEquation(source, catalog[n.type].custom ? n.type : { scalar: 'expression', coord: 'vectorExpression', layer: 'colorExpression' }[catalog[n.type].output]);
            if (!draftChanged(n.id)) {
                return { ok: true, text: 'No changes yet. Edit the text; the canvas previews your edit.' };
            }
            return { ok: true, text: n.id === state.selected ? '✓ The equation checks. The canvas shows your edit, not applied yet.' : '✓ The math checks. Open this part in the main window to see it on the picture.' };
        }
        catch (e) {
            return { ok: false, text: e.message };
        }
    }
    /** The draft typeset line by line, as it will read in the steps. */
    draftMath(n, def) {
        const kind = def.custom ? n.type : { scalar: 'expression', coord: 'vectorExpression', layer: 'colorExpression' }[def.output];
        let list;
        try {
            list = stepList(programItems(state.drafts.get(n.id), kind, symbolTable(n, def, {}), false));
        }
        catch (e) {
            list = `<p class="muted small-note">The typeset form appears when the text checks.</p>`;
        }
        return this.section('draftmath', 'AS MATH', `<div class="draft-math">${list}</div>`, { tip: 'As math|Your text typeset line by line with its captions, exactly as the steps will read after Apply.' });
    }
    syntaxHelp(n) {
        const kind = catalog[n.type].custom ? n.type : { scalar: 'expression', coord: 'vectorExpression', layer: 'colorExpression' }[catalog[n.type].output];
        const body = `<ul class="syntax-list">
<li><code>param width = 0.1 [0.01, 1]</code> a parameter: a slider with this default and range (add <code>step 0.01</code>); <code>param tint = #ffd080</code> a color</li>
<li><code>d = length(p) - 1</code> a definition, usable on the lines below</li>
<li><code>… // why</code> a caption, shown next to the typeset line</li>
<li>The <b>last line is the result</b>: ${esc(RESULTS[kind])}.</li>
<li>Names: <code>p</code> = (<code>x</code>, <code>y</code>), <code>r</code> and <code>theta</code> (polar), inputs <code>a</code> and <code>b</code>, time <code>t</code>, <code>PI</code>, <code>TAU</code>.</li>
<li><code>x^2</code> is a power, <code>%</code> is mod; whole numbers need no decimal point; <code>cond ? a : b</code> chooses.</li>
<li>Functions: the GLSL ones (<code>sin</code>, <code>mix</code>, <code>smoothstep</code>, <code>length</code>, …) and the shader library’s (<code>fbm</code>, <code>rotate2</code>, <code>gaussian</code>, <code>spectrum</code>, whole scenes such as <code>waterPlanet</code>): see Insert….</li></ul>`;
        return this.section('syntax', 'HOW TO WRITE EQUATIONS', body);
    }
    parameter(n, key, s, value) {
        const modified = isParamModified(state.baseline, state.project, n, key), label = s.custom ? `<math>${nameMathML(key)}</math>` : math(s.symbol);
        const symbol = `<span class="sym" data-param-symbol="${key}">${label}</span>`;
        if (s.kind === 'color') {
            const original = originalValue(state.baseline, n, key);
            return `<div class="param ${modified ? 'modified' : ''}" data-param-row="${key}"><div class="param-head"><label data-reset-label="${key}" data-tip="${esc(s.label)}|${esc(s.help)}">${esc(s.custom ? '' : s.label)} ${symbol}</label><input type="color" value="${value}" data-param="${key}" aria-label="${esc(s.label)}"><span class="muted mono" data-color-text="${key}">${esc(value)}</span><button class="reset" data-reset="${key}" ${modified ? '' : 'disabled'} aria-label="Reset ${esc(s.label)}" data-tip="Put back to ${esc(original)}|Returns this color to where it started.">↺</button></div><small>${esc(s.help)}</small></div>`;
        }
        const original = originalValue(state.baseline, n, key), track = state.project.tracks.find(t => t.node === n.id && t.param === key);
        const pct = clamp((original - s.min) / (s.max - s.min), 0, 1);
        return `<div class="param ${modified ? 'modified' : ''}" data-param-row="${key}"><div class="param-head"><label for="param-${key}" data-reset-label="${key}" data-tip="${esc(s.label)}|${esc(s.help)}\nDouble-click to reset.">${esc(s.custom ? '' : s.label)} ${symbol}</label><input type="number" data-param="${key}" id="number-${key}" value="${formatNumber(value)}" data-shown="${formatNumber(value)}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${esc(s.label)} numerical value"><button class="key ${track?.keys.length ? 'keyed' : ''}" data-keyframe="${key}" aria-label="Keyframe ${esc(s.label)}" data-tip="Remember this value at ${state.time.toFixed(1)} s|Adds a keyframe: at this moment the setting has this value. Move to another time, change the setting, and it will glide between the two while the animation plays.">◆</button><button class="reset" data-reset="${key}" ${modified ? '' : 'disabled'} aria-label="Reset ${esc(s.label)}" data-tip="Put back to ${formatNumber(original)}|Returns this setting to where it started${track ? ' and removes its keyframes' : ''}.">↺</button><button class="sweep" data-sweep="${key}" aria-label="Explore ${esc(s.label)}" data-tip="See many values at once|Shows small pictures for values across the whole range. Hover one to see it large, click it to use that value.">▦</button></div><div class="slider-wrap"><input type="range" id="param-${key}" data-param="${key}" value="${value}" data-shown="${value}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${esc(s.label)}"><span class="default-mark" style="left:calc(${(pct * 100).toFixed(2)}% + ${((0.5 - pct) * 14).toFixed(1)}px)" data-tip="Started at ${formatNumber(original)}|Where this setting started when the scene was opened. ↺ puts it back here."></span></div><small>${esc(s.help)} <span class="range">From ${s.min} to ${s.max}${formatNumber(original) !== formatNumber(value) ? ` · started at ${formatNumber(original)}` : ''}</span></small></div>`;
    }
    parameters(n, def, evaluated) {
        const params = Object.entries(paramSpecs(n)).filter(([, s]) => s.kind !== 'expression');
        if (!params.length) {
            return this.section('params', 'SETTINGS', `<p class="muted small-note">${def.custom ? 'No settings yet. Choose ✎ Edit and add a line such as <code>param k = 1 [0, 2]</code> to get a slider.' : 'This part has no settings to change.'}</p>`);
        }
        const numeric = params.some(([, s]) => s.kind === 'number');
        let html = '<p class="settings-hint">Drag a slider or type a number, and watch the picture. The small mark under a slider is where it started. <span class="key-glyph">↺</span> puts it back, <span class="key-glyph">▦</span> shows the picture for many values at once, and <span class="key-glyph">◆</span> remembers the value at this moment of the animation.</p>';
        if (state.project.tracks.some(t => t.node === n.id && t.keys.length)) {
            html += '<div class="selection-note">Settings with a lit ◆ change during the animation: they show their value at the current time. Changing one updates it at this moment; More ▸ Animation lists the moments.</div>';
        }
        html += params.map(([key, s]) => this.parameter(n, key, s, evaluated[key])).join('');
        const tools = `${numeric ? '<button id="variations" class="link surprise" data-action="variations" data-tip="Surprise me|Shows eight pictures with these settings changed at random. Hover one to see it large, click it to keep it; Undo takes it back.">🎲 Surprise me</button>' : ''}<button id="resetNode" class="link" data-action="reset-node" ${isModified(state.baseline, state.project, n) ? '' : 'disabled'} data-tip="Put all back|Returns every setting of this part to where it started (Undo brings your changes back).">↺ Put all back</button>`;
        return this.section('params', 'SETTINGS', html, { tools });
    }
    curveSVG(def, evaluated) {
        const c = def.curve, P = evaluated;
        const series = c.bars ? [{ bars: c.bars(P) }] : c.series.map(s => ({ ...s, f: x => s.f(x, P) }));
        const gradient = c.gradient ? `<div class="curve-gradient" style="background:linear-gradient(90deg, ${c.gradient(P).map(esc).join(', ')})" aria-hidden="true"></div>` : '';
        return plotSVG({ series, domain: c.domain(P), range: c.range?.(P) || null, xLabel: c.x, yLabel: c.y, marks: c.marks?.(P) || [] }) + gradient;
    }
    curve(def, evaluated) {
        if (!def.curve) {
            return '';
        }
        return this.section('curve', 'THE KEY CURVE', `<div class="curve" data-curve>${this.curveSVG(def, evaluated)}</div><p class="curve-title">${esc(def.curve.title)}, drawn with the settings as they are now.</p>`, { tip: 'The key curve|The one curve at the heart of this part, drawn with the current settings. Move a setting and watch the curve change with the picture.' });
    }
    // ---- In & out tab ----------------------------------------------------------
    flowTab(n, def) {
        const inputs = Object.entries(def.inputs);
        let html = '';
        if (inputs.length) {
            html += '<div class="flow-heading">What comes in</div>';
            for (const [socket, kind] of inputs) {
                const source = nodeById(n.inputs[socket]), symbol = def.inputSymbols[socket] || socket;
                const options = state.project.nodes.filter(other => other.id !== n.id && catalog[other.type].output === kind).map(other => `<option value="${other.id}" ${n.inputs[socket] === other.id ? 'selected' : ''}>${esc(other.label)}</option>`).join('');
                const inserts = !n.inputs[socket] ? '' : insertableTypes(kind).map(type => `<option value="${type}">${esc(catalog[type].name)}</option>`).join('');
                html += `<div class="input-row" data-input-row="${socket}"><label for="in-${socket}" class="flow-socket" data-tip="${esc(socket)}: ${esc(KIND_LABELS[kind])}|Choose which part this input comes from. An input with nothing connected is zero everywhere."><span class="type-dot ${kind}"></span><span class="flow-sym">${math(symbol, { symbols: Object.fromEntries(symbol.split(',').map(s => [s.trim(), { role: 'input', type: kind, socket }])) })}</span></label><select id="in-${socket}" data-input="${socket}" aria-label="${esc(socket)} input"><option value="">Nothing (zero)</option>${options}</select>${inserts ? `<select class="insert" data-insert="${socket}" aria-label="Put a part in before ${esc(socket)}" data-tip="Put a part in between|Insert a new part between this input and where it comes from, for example a warp before a pattern or a tint before a picture."><option value="">＋</option>${inserts}</select>` : ''}${source ? `<button class="flow-thumb-button" data-go="${source.id}" data-tip="${esc(source.label)}|Open the part that ${esc(socket)} comes from."><canvas class="flow-thumb" data-thumb="${source.id}" width="160" height="96"></canvas></button>` : ''}</div>`;
            }
        }
        else {
            html += '<p class="muted small-note">Nothing comes in: it works only from its settings (and from the pixel’s position or the time, where its math uses them).</p>';
        }
        const users = consumers(state.project, n.id), output = def.outputSymbols.length ? math(def.outputSymbols.join(',\\ '), { symbols: Object.fromEntries(def.outputSymbols.map(s => [s, { role: 'output', type: def.output }])) }) : '';
        html += `<div class="flow-heading">Where what it makes (${output}) goes</div>`;
        if (state.project.output === n.id) {
            html += '<div class="flow-final">★ It is the final picture of the scene: what the canvas shows, what Save keeps and what Export writes.</div>';
        }
        if (!users.length && state.project.output !== n.id) {
            html += '<p class="muted small-note">No part uses it yet. Connect it to another part’s input (drag between the dots in the Wiring view under the picture), or make it the final picture.</p>';
        }
        for (const u of users) {
            const ud = catalog[u.node.type], symbolTex = ud.inputSymbols[u.socket] || u.socket, symbols = symbolTex.split(',').map(s => s.trim());
            let used = '';
            if (ud.custom) {
                try {
                    used = programToMathML(u.node.params.expression, CUSTOM_LHS[u.node.type], { symbols: { [u.socket]: { role: 'input', type: def.output, socket: u.socket } } }).at(-1).mathml;
                }
                catch (e) { /* an invalid equation shows no formula */
                }
            }
            else {
                const tex = stepUsing(ud, symbols);
                used = tex ? segments(tex, { symbols: Object.fromEntries(symbols.map(s => [s, { role: 'input', type: def.output, socket: u.socket }])) }) : '';
            }
            html += `<button class="flow-out" data-go="${u.node.id}" data-tip="${esc(u.node.label)}|Open the part that uses it, as its input ${esc(u.socket)}."><span class="flow-line"><span class="flow-arrow">→</span><b>${esc(u.node.label)}</b><span class="muted">uses it as</span>${math(symbolTex, { symbols: Object.fromEntries(symbols.map(s => [s, { role: 'input', type: def.output }])) })}<canvas class="flow-thumb" data-thumb="${u.node.id}" width="160" height="96"></canvas></span>${used ? `<span class="flow-math">${used}</span>` : ''}</button>`;
        }
        if (state.project.output !== n.id) {
            html += '<div class="node-bottom"><button id="makeOutput" data-action="output" data-tip="Make it the final picture|Use what this part makes as the scene’s final picture (for the canvas, Save and Export). To only look at it, choose Just this part above the picture.">☆ Make it the final picture</button></div>';
        }
        return this.section('flow', 'CONNECTIONS', html, { tip: 'Connections|Which parts this one gets its inputs from, and which parts use what it makes. Click one to open it.' });
    }
    // ---- Ideas tab -------------------------------------------------------------
    ideasTab(n, def) {
        const concepts = conceptsOf(n);
        const cards = concepts.length ? concepts.map(id => this.conceptCard(id)).join('') : '<p class="muted small-note">No big ideas are listed for this part; its math steps explain it.</p>';
        const rows = def.notes.map(([symbol, meaning]) => `<div class="sym-row sym-note"><span class="sym">${math(symbol)}</span><span class="wide">${richText(meaning)}</span></div>`).join('');
        return this.section('why', 'THE BIG IDEAS BEHIND IT', `<div class="concept-grid">${cards}</div>`, { tip: 'Big ideas|The math ideas this part uses, the ones that come up again and again in pictures like this. Each has a small graph with a slider to play with.' })
            + (rows ? this.section('symbols', 'OTHER LETTERS IN THE MATH', `<div class="sym-list">${rows}</div>`) : '');
    }
    conceptCard(id) {
        const c = concept(id), k = this.ui.knobs[id] ?? c.knob?.value;
        const plot = c.plot ? `<div class="concept-plot" data-concept-plot="${id}">${plotSVG(c.plot(k))}</div>` : '';
        const knob = c.knob ? `<label class="knob">${esc(c.knob.label)} <input type="range" data-knob="${id}" min="${c.knob.min}" max="${c.knob.max}" step="${c.knob.step}" value="${k}"><output data-knob-value="${id}">${formatNumber(k)}</output></label>` : '';
        return `<article class="concept-card" data-concept-card="${id}"><b>${esc(c.title)}</b>${c.tex ? `<div class="concept-math">${math(c.tex, { display: true })}</div>` : ''}<p>${richText(c.text)}</p>${plot}${knob}</article>`;
    }
    // ---- More tab --------------------------------------------------------------
    moreTab(n, def) {
        return this.code(n, def) + this.tracks(n) + this.actions(n);
    }
    code(n, def) {
        let body;
        if (def.code) {
            body = '<p class="node-caption">The code itself is in the Code tab. Under the picture, the Shader code view shows the complete program the graphics chip runs, with this code inside it.</p>';
            return this.section('code', 'SHADER CODE', body);
        }
        if (def.custom) {
            try {
                const program = compileEquation(n.params.expression, n.type);
                body = `<pre id="nodeCode" class="node-code">${esc(programGLSL(program, 'equation', Object.fromEntries(program.params.map(p => [p.name, p.name]))).code.replace(/;/g, ';\n  ').replace('{', '{\n  '))}</pre>`;
            }
            catch (e) {
                body = `<pre id="nodeCode" class="node-code">${esc(e.message)}</pre>`;
            }
        }
        else {
            const call = emitPreview(n.type, n.params), kernel = /^(\w+)\(/.exec(call)?.[1], source = kernel ? kernelSource(kernel) : '';
            body = `<pre id="nodeCode" class="node-code">${esc(call)}</pre>${source ? `<details class="kernel"><summary>Kernel source: ${esc(kernel)}()</summary><pre class="node-code">${esc(source)}</pre></details>` : ''}`;
        }
        return this.section('code', 'SHADER CODE', `${body}<p class="node-caption">The shader code (GLSL, the language of graphics chips) that this part adds to the scene’s program. Setting names stand for their current values. The whole scene becomes one program, shown under the picture in the Shader code view.</p>`);
    }
    tracks(n) {
        const tracks = state.project.tracks.filter(t => t.node === n.id), specs = paramSpecs(n);
        if (!tracks.length) {
            const moves = catalog[n.type].code || catalog[n.type].points || /\bt\b/.test(catalog[n.type].steps.map(x => x.tex).join(' ') + (n.params.expression || ''));
            return this.section('tracks', 'KEYFRAMES', `<p class="muted small-note">None of its settings has keyframes.${moves ? ' It still moves, because its math uses the time t.' : ''} To make a setting change over time, click ◆ next to it (${TAB_LABELS[tabsFor(n)[0]]} tab), move to another time, and change it.</p>`);
        }
        return this.section('tracks', 'KEYFRAMES', tracks.map(t => `<div class="track-edit"><header><b>${esc(specs[t.param]?.label || t.param)}</b><select data-interpolation="${t.param}" aria-label="Interpolation for ${t.param}" data-tip="How it moves between keyframes|smooth speeds up and slows down gently, linear moves at a steady speed, hold jumps from one value to the next.">${['smooth', 'linear', 'hold'].map(v => `<option ${v === t.interpolation ? 'selected' : ''}>${v}</option>`).join('')}</select><button data-remove-track="${t.param}" aria-label="Remove ${t.param} animation track" data-tip="Remove the keyframes|The setting stops changing over time and keeps its current value.">×</button></header><div class="key-list">${t.keys.map(k => `<button class="key-chip" data-seek="${k.time}" data-tip="Keyframe at ${k.time} s|Click to go to this moment.">${k.time}s: ${Number(k.value.toFixed(3))}<span data-remove-key="${t.param}" data-time="${k.time}" data-tip="Delete this keyframe">×</span></button>`).join('')}</div></div>`).join(''));
    }
    actions(n) {
        const replacements = replacementTypes(n.type).map(type => `<option value="${type}">${esc(catalog[type].name)}</option>`).join('');
        const body = `<div class="node-bottom"><select id="replaceWith" aria-label="Replace with another part" data-tip="Swap for…|Swap this part for another that makes the same kind of thing, keeping its connections where they fit. The Filament ring scene is the Bipolar nebula with its shape part swapped this way."><option value="">Swap for…</option>${replacements}</select><button id="duplicateNode" data-action="duplicate" data-key="Ctrl/⌘ D" data-tip="Duplicate|Adds a copy of this part with the same settings and inputs.">Duplicate</button><button id="deleteNode" class="danger" data-action="delete" data-key="Delete" data-tip="Delete this part|Removes it from the scene and disconnects what it fed. Undo brings it back.">Delete</button></div><p class="node-caption">Kind of part: ${esc(catalog[n.type].name)} (<code>${n.type}</code>) · id <code>${esc(n.id)}</code> · makes ${esc(KIND_LABELS[catalog[n.type].output])}.</p>`;
        return this.section('actions', 'THIS PART', body);
    }
    /** Thumbnails of connected components, from the shared live previews. */
    paintThumbs() {
        for (const canvas of this.qa('canvas[data-thumb]')) {
            const tile = previewTile(canvas.dataset.thumb);
            if (tile) {
                canvas.width = tile.width;
                canvas.height = tile.height;
                canvas.getContext('2d').putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
                canvas.classList.add('painted');
            }
        }
    }
    // ---- Live updates ----------------------------------------------------------
    /** Refresh numbers after a live parameter change or a playhead move, without
     * rebuilding: inputs (unless being typed in), values in the math, the curve.
     */
    sync(changedKey = null) {
        const n = this.node();
        if (!n || this.root.dataset.node !== n.id) {
            return;
        }
        const def = catalog[n.type], evaluated = animatedParameters(state.project, n, state.time), active = this.root.ownerDocument.activeElement;
        for (const input of this.qa('[data-param]')) {
            const key = input.dataset.param, value = evaluated[key];
            // A focused control keeps what the user is typing or dragging (its text differs from what was last shown).
            const editing = input === active && input.value !== (input.dataset.shown ?? input.value);
            if (editing || value === undefined || (changedKey && key !== changedKey && !state.project.tracks.some(t => t.node === n.id && t.param === key))) {
                continue;
            }
            input.value = input.type === 'number' ? formatNumber(value) : value;
            input.dataset.shown = input.value;
            const text = this.q(`[data-color-text="${key}"]`);
            if (text) {
                text.textContent = value;
            }
        }
        if (changedKey) {
            this.q(`[data-param-row="${changedKey}"]`)?.classList.toggle('modified', isParamModified(state.baseline, state.project, n, changedKey));
            const reset = this.q(`[data-reset="${changedKey}"]`);
            if (reset) {
                reset.disabled = !isParamModified(state.baseline, state.project, n, changedKey);
            }
        }
        cancelAnimationFrame(this.curveFrame);
        this.curveFrame = requestAnimationFrame(() => {
            const curve = this.q('[data-curve]');
            if (curve && def.curve) {
                curve.innerHTML = this.curveSVG(def, evaluated);
            }
            for (const row of this.qa('.loop-row')) { // loop sliders show their step count next to them
                const input = row.querySelector('input[data-param]'), out = row.querySelector('output');
                if (input && out && input !== this.root.ownerDocument.activeElement) {
                    out.textContent = input.value;
                }
            }
            if (this.ui.values) { // update the numbers in place: a symbol being dragged must survive
                for (const sym of this.qa('.steps .sym-param[data-param]')) {
                    const value = evaluated[sym.dataset.param];
                    if (typeof value === 'number') {
                        sym.innerHTML = numberMathML(value);
                    }
                }
            }
        });
    }
    /** The draft of this view's component changed (here or in another view). */
    onDraft(nodeId) {
        const n = this.node();
        if (!n || n.id !== nodeId) {
            return;
        }
        const editor = this.q('#equationEditor');
        if (this.editing(n) !== !!editor || (this.ui.tab !== 'equation' && this.ui.tab !== 'code')) {
            this.render(); // edit mode started or ended
            return;
        }
        if (!editor) {
            return;
        }
        const source = state.drafts.get(n.id);
        if (editor.value !== source && editor !== this.root.ownerDocument.activeElement) {
            editor.value = source;
        }
        this.refreshDraft(n);
    }
    /** Retypeset the draft and show whether it checks. */
    refreshDraft(n) {
        const status = this.draftStatus(n), el = this.q('#equationError');
        if (el) {
            el.textContent = status.text;
            el.classList.toggle('error', !status.ok);
        }
        const holder = this.q('.draft-math');
        if (holder && status.ok) {
            const def = catalog[n.type], kind = def.custom ? n.type : { scalar: 'expression', coord: 'vectorExpression', layer: 'colorExpression' }[def.output];
            holder.innerHTML = stepList(programItems(state.drafts.get(n.id), kind, symbolTable(n, def, {}), false));
        }
        holder?.classList.toggle('stale', !status.ok);
    }
    // ---- Events ----------------------------------------------------------------
    bindEvents() {
        const root = this.root;
        root.addEventListener('click', e => this.onClick(e));
        root.addEventListener('input', e => this.onInput(e));
        root.addEventListener('change', e => this.onChange(e));
        root.addEventListener('dblclick', e => {
            const label = e.target.closest('[data-reset-label]');
            if (label) {
                resetParam(this.node().id, label.dataset.resetLabel);
                return;
            }
            const n = this.node();
            if (e.target.closest('#expressionPreview .step') && !e.target.closest('.sym-param') && !forkBlocker(n.type)) {
                this.beginEdit(n); // double-click the equation to edit it
            }
        });
        root.addEventListener('keydown', e => {
            if (e.target.id === 'equationEditor' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.applyDraft();
            }
            numberKey(this, e);
        });
        root.addEventListener('pointerover', e => this.highlight(e.target.closest('[data-param], [data-socket], [data-param-symbol], [data-input-row]'), true));
        root.addEventListener('pointerout', e => this.highlight(e.target.closest('[data-param], [data-socket], [data-param-symbol], [data-input-row]'), false));
        root.addEventListener('pointerdown', e => startNumberDrag(this, e) || this.startScrub(e));
    }
    /** Light up every occurrence of the same parameter or input in this view. */
    highlight(el, on) {
        if (!el) {
            return;
        }
        const param = el.dataset.param || el.dataset.paramSymbol, socket = el.dataset.socket || el.dataset.inputRow;
        const selector = param ? `[data-param="${CSS.escape(param)}"], [data-param-symbol="${CSS.escape(param)}"], [data-param-row="${CSS.escape(param)}"]` : socket ? `[data-socket="${CSS.escape(socket)}"], [data-input-row="${CSS.escape(socket)}"]` : null;
        if (selector) {
            this.qa(selector).forEach(x => x.classList.toggle('hot', on));
        }
    }
    /** Drag a parameter symbol in an equation to change its value. */
    startScrub(e) {
        const sym = e.target.closest('.steps .sym-param[data-param], .sym[data-param-symbol]');
        if (!sym || e.button !== 0 || sym.closest('.draft-math')) {
            return;
        }
        const n = this.node(), key = sym.dataset.param || sym.dataset.paramSymbol, spec = paramSpecs(n)[key];
        if (!spec || spec.kind !== 'number') {
            return;
        }
        e.preventDefault();
        const start = animatedParameters(state.project, n, state.time)[key], x0 = e.clientX, range = spec.max - spec.min;
        let moved = false;
        sym.setPointerCapture(e.pointerId);
        sym.classList.add('scrubbing');
        const move = ev => {
            const dx = ev.clientX - x0;
            if (!moved && Math.abs(dx) < 3) {
                return;
            }
            moved = true;
            const fine = ev.shiftKey ? 0.1 : 1, raw = start + dx / 240 * range * fine, snapped = Math.round(raw / spec.step) * spec.step;
            liveParam(n.id, key, Number(snapped.toFixed(6)));
        };
        const up = () => {
            sym.removeEventListener('pointermove', move);
            sym.removeEventListener('pointerup', up);
            sym.removeEventListener('pointercancel', up);
            sym.classList.remove('scrubbing');
            if (moved) {
                endLiveEdit();
            }
            else {
                this.focusParam(key);
            }
        };
        sym.addEventListener('pointermove', move);
        sym.addEventListener('pointerup', up);
        sym.addEventListener('pointercancel', up);
    }
    focusParam(key) {
        const block = this.q(`[data-param-row="${CSS.escape(key)}"]`);
        block?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        block?.classList.add('flash');
        setTimeout(() => block?.classList.remove('flash'), 900);
        (this.q(`#number-${CSS.escape(key)}`) || this.q(`[data-param="${CSS.escape(key)}"]`))?.focus({ preventScroll: true });
    }
    showTab(tab) {
        const n = this.node(), tabs = n ? tabsFor(n) : Object.keys(TAB_LABELS);
        tab = tab === 'equation' && !tabs.includes(tab) ? tabs[0] : tab;
        if (tabs.includes(tab) && tab !== this.ui.tab) {
            this.ui.tab = tab;
            this.render();
        }
    }
    beginEdit(n) {
        this.ui.tab = tabsFor(n)[0];
        startEdit(n.id); // emits `draft`, which renders every view of it in edit mode
        this.render();
        const editor = this.q('#equationEditor');
        editor?.focus({ preventScroll: true });
        editor?.scrollIntoView({ block: 'nearest' });
    }
    onClick(e) {
        const n = this.node(), t = e.target;
        const fold = t.closest('[data-fold]');
        if (fold) {
            const id = fold.dataset.fold;
            this.ui.collapsed.has(id) ? this.ui.collapsed.delete(id) : this.ui.collapsed.add(id);
            fold.closest('.cv-section').classList.toggle('collapsed');
            fold.setAttribute('aria-expanded', String(!this.ui.collapsed.has(id)));
            return;
        }
        const tab = t.closest('[data-tab]');
        if (tab) {
            this.showTab(tab.dataset.tab);
            return;
        }
        const go = t.closest('[data-go]');
        if (go && !t.closest('select')) {
            this.navigate(go.dataset.go);
            return;
        }
        const action = t.closest('[data-action]')?.dataset.action;
        if (action && (codeAction(this, n, action, t) || statsAction(this, n, action, t))) {
            return;
        }
        if (!action && codeClick(this, n, t)) {
            return;
        }
        const actions = {
            scene: () => showScene(),
            prev: () => selectStep(-1),
            next: () => selectStep(1),
            output: () => setOutput(n.id),
            values: () => {
                this.ui.values = !this.ui.values;
                this.render();
            },
            edit: () => this.beginEdit(n),
            'edit-blocked': () => {
                this.ui.blockedNote = !this.ui.blockedNote;
                this.render();
            },
            'cancel-edit': () => discardDraft(n.id),
            'apply-equation': () => this.applyDraft(),
            'reset-node': () => resetNode(n.id),
            variations: () => openVariations(n.id),
            duplicate: () => duplicateNode(n.id),
            delete: () => deleteNode(n.id),
            playground: () => this.onPlayground?.(n.id),
            popout: () => this.onPopout?.(n.id)
        };
        if (action && actions[action]) {
            actions[action]();
            return;
        }
        const keyframe = t.closest('[data-keyframe]');
        if (keyframe) {
            pause();
            const key = keyframe.dataset.keyframe;
            transact(p => {
                const value = animatedParameters(p, p.nodes.find(v => v.id === n.id), state.time)[key];
                insertKey(p, n.id, key, state.time, value);
            });
            toast(`Keyframe added at ${state.time.toFixed(2)} s. Move to another time and change the setting: it will glide between the two while the animation plays.`);
            return;
        }
        const reset = t.closest('[data-reset]');
        if (reset) {
            resetParam(n.id, reset.dataset.reset);
            return;
        }
        const sweep = t.closest('[data-sweep]');
        if (sweep) {
            openSweep(n.id, sweep.dataset.sweep);
            return;
        }
        const removeTrack = t.closest('[data-remove-track]');
        if (removeTrack) {
            transact(p => p.tracks = p.tracks.filter(tr => !(tr.node === n.id && tr.param === removeTrack.dataset.removeTrack)));
            return;
        }
        const removeKey = t.closest('[data-remove-key]');
        if (removeKey) {
            e.stopPropagation();
            transact(p => {
                const tr = p.tracks.find(x => x.node === n.id && x.param === removeKey.dataset.removeKey);
                tr.keys = tr.keys.filter(k => k.time !== Number(removeKey.dataset.time));
            });
            return;
        }
        const seekTo = t.closest('[data-seek]');
        if (seekTo) {
            seek(Number(seekTo.dataset.seek));
            return;
        }
        const symbol = t.closest('#expressionPreview .sym-input[data-socket]');
        if (symbol) {
            const source = n.inputs[symbol.dataset.socket];
            if (source) {
                this.navigate(source);
            }
        }
    }
    navigate(id) {
        if (this.pinned) {
            this.pinned = id;
            this.render();
        }
        else {
            setSelected(id);
        }
    }
    onInput(e) {
        const t = e.target, n = this.node();
        if (t.id === 'equationEditor') {
            setDraft(n.id, t.value);
            return;
        }
        if (t.dataset.knob) {
            const id = t.dataset.knob, c = concept(id), k = Number(t.value);
            this.ui.knobs[id] = k;
            const plot = this.q(`[data-concept-plot="${CSS.escape(id)}"]`), out = this.q(`[data-knob-value="${CSS.escape(id)}"]`);
            if (plot) {
                plot.innerHTML = plotSVG(c.plot(k));
            }
            if (out) {
                out.textContent = formatNumber(k);
            }
            return;
        }
        const key = t.dataset.param;
        if (key) {
            const spec = paramSpecs(n)[key];
            if (!spec || (spec.kind === 'number' && (t.value === '' || !Number.isFinite(Number(t.value))))) {
                return;
            }
            const value = liveParam(n.id, key, spec.kind === 'number' ? Number(t.value) : t.value);
            for (const other of this.qa(`[data-param="${CSS.escape(key)}"]`)) {
                if (other !== t && value !== null) {
                    other.value = other.type === 'number' ? formatNumber(value) : value;
                    other.dataset.shown = other.value;
                }
            }
        }
    }
    onChange(e) {
        const t = e.target, n = this.node();
        if (t.id === 'nodeEnabled') {
            toggleEnabled(n.id);
        }
        else if (t.id === 'nodeLabel') {
            transact(p => p.nodes.find(v => v.id === n.id).label = t.value);
        }
        else if (t.id === 'replaceWith') {
            if (t.value) {
                replaceComponent(n.id, t.value);
            }
        }
        else if (t.id === 'insertHelper') {
            const text = t.value, editor = this.q('#equationEditor');
            t.value = '';
            if (text && editor) {
                const lineStart = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
                const insert = /^(param|\w+ = )/.test(text) && editor.selectionStart !== lineStart ? `\n${text}` : text;
                editor.setRangeText(/^(param|\w+ = )/.test(text) ? `${insert}\n` : insert, editor.selectionStart, editor.selectionEnd, 'end');
                editor.focus();
                setDraft(n.id, editor.value);
            }
        }
        else if (t.dataset.input !== undefined && t.matches('select[data-input]')) {
            connect(t.value, n.id, t.dataset.input);
        }
        else if (t.dataset.insert !== undefined && t.matches('select[data-insert]')) {
            if (t.value) {
                try {
                    insertComponent(t.value, n.id, t.dataset.insert);
                }
                catch (err) {
                    showError(err);
                }
            }
        }
        else if (t.dataset.interpolation) {
            transact(p => p.tracks.find(tr => tr.node === n.id && tr.param === t.dataset.interpolation).interpolation = t.value);
        }
        else if (t.dataset.param) {
            endLiveEdit();
        }
    }
    applyDraft() {
        const n = this.node(), source = state.drafts.get(n.id);
        if (source === undefined) {
            return;
        }
        const builtIn = !catalog[n.type].custom && !catalog[n.type].code;
        try {
            if (applyEquation(n.id, source)) {
                toast(catalog[n.type].code ? 'Code applied. Undo brings back the previous version.' : builtIn ? 'Applied: this part now runs your math. Undo brings back the original.' : 'Math applied. Undo brings back the previous version.');
            }
        }
        catch (e) {
            const el = this.q('#equationError');
            if (el) {
                el.textContent = e.message;
                el.classList.add('error');
            }
            showError('Not applied: there is a mistake in the text (explained under the editor). The scene has not changed.');
        }
    }
}
/** Rebuild every view (after the project, selection or view changed). */
export function renderViews() {
    for (const v of views) {
        v.render();
    }
}
/** Show one tab of every view ('equation', 'code', 'inside', 'flow', 'ideas', 'stats', 'more'). */
export function showViewTab(tab) {
    for (const v of views) {
        v.showTab(tab);
    }
}
on('values', (nodeId, key) => {
    for (const v of views) {
        if (v.node()?.id === nodeId) {
            v.sync(key);
        }
    }
});
on('time', () => {
    for (const v of views) {
        const n = v.node();
        if (n && state.project.tracks.some(t => t.node === n.id && t.keys.length)) {
            v.sync();
        }
    }
});
on('draft', nodeId => {
    for (const v of views) {
        v.onDraft(nodeId);
    }
});
/** A pinned point changed: Look inside reads its values there. */
on('pin', () => {
    for (const v of views) {
        if (v.ui.tab === 'inside') {
            v.render();
        }
    }
});
on('previews', () => {
    for (const v of views) {
        v.paintThumbs();
    }
});
