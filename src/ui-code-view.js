import { esc, state, toast, showError, transact, liveParam, endLiveEdit, liveNumber, setShow, setView, freezeTime, applyEquation, draftChanged, nodeById } from './editor.js';
import { catalog, paramSpecs } from './catalog.js';
import { analyzeCode, formatCode, showable, numberText, CODE_INPUTS, HELPER_HELP, CODE_LIMITS } from './glsl.js';
import { getWork, linesOf, creditLine } from './works.js';
import { pixelToWorld } from './view-math.js';
/** The Code view of a Shader code component, its "Look inside" tab, and the
 * credit and guided tour of a work (works.js), shared by Point clouds.
 *
 * Code is shown highlighted, one line per row. Every part of it explains itself
 * on hover: inputs (FC, r, t, o, …), helpers (hsv, rotate2D, …), GLSL built-ins
 * and each variable (with the caption of the line that declares it). Numbers can
 * be dragged: the code text changes but its structure does not, so the frame is
 * redrawn without recompiling (numbers are uniforms, see compiler.js). Clicking a
 * variable shows it on the canvas. ✎ Edit opens the code as text with the same
 * draft / Apply flow as equations.
 *
 * Loops get a slider each ("stop after N steps") and a ▶ that sweeps it from 0
 * to the full count, so you watch the picture build up. "Look inside" lists
 * every value the code computes (the color o, each variable, the step count of
 * each loop), shows any of them on the canvas with a colormap, and reads all of
 * them at the pinned point.
 */
/** One-line meanings of the GLSL built-ins, for tooltips in code. */
const BUILTIN_HELP = {
    abs: 'abs(x): the size of x, without its sign', sign: 'sign(x): −1, 0 or 1', floor: 'floor(x): the whole number at or below x', ceil: 'ceil(x): the whole number at or above x',
    fract: 'fract(x): the part after the decimal point, x − floor(x)', round: 'round(x): the nearest whole number', mod: 'mod(x, y): x − y·floor(x/y), a repeating ramp',
    min: 'min(a, b): the smaller one', max: 'max(a, b): the larger one', clamp: 'clamp(x, lo, hi): x kept between lo and hi', mix: 'mix(a, b, t): a + (b − a)·t, blending from a (t = 0) to b (t = 1)',
    step: 'step(edge, x): 0 below the edge, 1 above it', smoothstep: 'smoothstep(a, b, x): a smooth 0-to-1 ramp between a and b', length: 'length(v): the length of a vector, √(v·v)',
    distance: 'distance(a, b): length(a − b)', dot: 'dot(a, b): the sum of the products of components; for unit vectors the cosine of the angle', cross: 'cross(a, b): a vector perpendicular to a and b',
    normalize: 'normalize(v): v scaled to length 1', reflect: 'reflect(v, n): v mirrored in the plane with normal n', sin: 'sin(x): the sine, a wave between −1 and 1 repeating every 2π',
    cos: 'cos(x): the cosine, a sine shifted by a quarter turn', tan: 'tan(x): the tangent, sin/cos', atan: 'atan(y, x): the angle of the point (x, y), −π to π; atan(v): arctangent',
    exp: 'exp(x): e to the power x; exp(−x) decays toward 0', log: 'log(x): the natural logarithm', exp2: 'exp2(x): 2 to the power x', log2: 'log2(x): the base-2 logarithm',
    pow: 'pow(x, y): x to the power y (x must not be negative)', sqrt: 'sqrt(x): the square root', inversesqrt: 'inversesqrt(x): 1/√x', tanh: 'tanh(x): squeezes any number into −1 … 1',
    sinh: 'sinh(x): the hyperbolic sine', cosh: 'cosh(x): the hyperbolic cosine', trunc: 'trunc(x): x without its fractional part', fwidth: 'fwidth(x): how much x changes to the next pixel',
    any: 'any(b): true if any component is true', all: 'all(b): true if every component is true', lessThan: 'lessThan(a, b): component-wise a < b'
};
const KEYWORDS = new Set(['for', 'while', 'do', 'if', 'else', 'break', 'continue', 'return', 'const', 'true', 'false', 'highp', 'mediump', 'lowp']);
const TYPES = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4']);
const LEXEME = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|((?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?[fF]?|\d+[eE][-+]?\d+[fF]?|0[xX][0-9a-fA-F]+|\d+)|([A-Za-z_]\w*)|(\s+)|([\s\S])/g;
/** The work a component belongs to (its `work` field), or null. */
export function workOf(node) {
    return node?.work ? getWork(node.work) : null;
}
/** The caption of a line of code: its trailing comment, or '' . */
function captionOf(analysis, line) {
    return analysis.comments.find(c => c.line === line && !analysis.source.split('\n')[line - 1].trim().startsWith('//'))?.text || '';
}
/** What a variable is, for its tooltip: type, where it is declared and why. */
function variableHelp(analysis, id) {
    const v = analysis.variables[id], caption = captionOf(analysis, v.line), loop = v.loop !== null ? ` inside loop ${v.loop + 1}` : '';
    return `${v.name} · ${v.type}|Declared on line ${v.line}${loop}${caption ? `: ${caption}` : '.'} Click to see its value on the canvas.`;
}
/** Highlighted code as rows of spans. `options.lines`: line numbers to mark
 * (the tour), `options.error`: a line with an error.
 */
export function highlightCode(analysis, { lines = [], error = null } = {}) {
    const source = analysis.source, numbers = new Map(analysis.numbers.map(n => [n.start, n])), refs = new Map(analysis.refs.map(r => [r.start, r]));
    const loopLines = new Map(analysis.loops.map(l => [l.line, l]));
    const paramLine = new Set(analysis.params.map(p => p.line));
    const out = [];
    // A row is a list of HTML pieces; spaces are kept apart ({space}) until we know
    // whether a comment follows them on the same line (a caption, which narrow
    // panels move under the code).
    let row = [], line = 1;
    const html = piece => typeof piece === 'string' ? piece : esc(piece.space);
    const endRow = () => {
        const loop = loopLines.get(line), cls = `c-line${lines.includes(line) ? ' hl' : ''}${error === line ? ' err' : ''}`;
        const gutter = loop ? `<span class="c-loop" data-tip="Loop ${loop.index + 1}|${esc(loop.caption || loop.name)}: ${loop.steps === null ? 'runs until its condition fails' : `${loop.steps} steps${loop.depth ? ' each time' : ''}`}. Its slider in Loops stops it early.">⟳${loop.index + 1}</span>` : '<span class="c-loop"></span>';
        out.push(`<span class="${cls}" data-line="${line}"><span class="c-ln" aria-hidden="true">${line}</span>${gutter}<span class="c-text">${row.map(html).join('') || ' '}</span></span>`);
        row = [];
        line++;
    };
    LEXEME.lastIndex = 0;
    let m;
    while ((m = LEXEME.exec(source))) {
        const text = m[0], start = m.index;
        if (m[4] !== undefined) { // whitespace, possibly spanning lines
            const parts = text.split('\n');
            parts.forEach((part, k) => {
                if (k) {
                    endRow();
                }
                if (part) {
                    row.push({ space: part });
                }
            });
            continue;
        }
        if (paramLine.has(line) && m[1] === undefined) {
            row.push(`<span class="c-parline">${esc(text)}</span>`);
            continue;
        }
        if (m[1] !== undefined) {
            const trailing = row.some(piece => typeof piece === 'string');
            if (trailing && typeof row.at(-1) === 'object') {
                row.push(`<span class="c-gap">${esc(row.pop().space)}</span>`);
            }
            const parts = text.split('\n');
            parts.forEach((part, k) => {
                if (k) {
                    endRow();
                }
                row.push(`<span class="c-com${trailing && !k ? ' trail' : ''}">${esc(part)}</span>`);
            });
            continue;
        }
        if (m[2] !== undefined) {
            const n = numbers.get(start);
            row.push(n ? `<span class="c-num" data-num="${n.index}" tabindex="0" role="slider" aria-label="Number ${esc(text)} on line ${n.line}; drag or use the arrow keys to change it" aria-valuenow="${n.value}" data-tip="${esc(text)}|Drag sideways to change this number (Shift: finer; arrow keys work too). The picture updates at once: numbers are live, nothing recompiles.">${esc(text)}</span>` : `<span class="c-lit">${esc(text)}</span>`);
            continue;
        }
        if (m[3] !== undefined) {
            const ref = refs.get(start);
            if (ref?.kind === 'variable') {
                row.push(`<span class="c-var${ref.declaration ? ' decl' : ''}" data-var="${ref.id}" data-tip="${esc(variableHelp(analysis, ref.id))}">${esc(text)}</span>`);
            }
            else if (ref?.kind === 'input') {
                const input = CODE_INPUTS[ref.name];
                row.push(`<span class="c-in" data-input="${ref.name}" data-tip="${esc(`${text} · ${input.type}|${input.meaning[0].toUpperCase()}${input.meaning.slice(1)}.`)}">${esc(text)}</span>`);
            }
            else if (ref?.kind === 'param') {
                row.push(`<span class="c-par" data-param-ref="${esc(ref.name)}" data-tip="${esc(`${text}|A parameter: its slider is in Parameters.`)}">${esc(text)}</span>`);
            }
            else if (HELPER_HELP[text]) {
                row.push(`<span class="c-fn" data-tip="${esc(`${text}()|${HELPER_HELP[text]}. A twigl helper function.`)}">${esc(text)}</span>`);
            }
            else if (BUILTIN_HELP[text]) {
                row.push(`<span class="c-bi" data-tip="${esc(`${text}()|${BUILTIN_HELP[text]}.`)}">${esc(text)}</span>`);
            }
            else if (TYPES.has(text)) {
                row.push(`<span class="c-ty">${esc(text)}</span>`);
            }
            else if (KEYWORDS.has(text)) {
                row.push(`<span class="c-kw">${esc(text)}</span>`);
            }
            else {
                row.push(esc(text));
            }
            continue;
        }
        row.push(esc(text));
    }
    endRow();
    return out.join('');
}
// ---- Work: credit, summary, tour, original ----------------------------------------
/** The work's credit and summary. */
export function workSection(v, n) {
    const w = workOf(n);
    if (!w) {
        return '';
    }
    const study = w.platform === 'study';
    const badge = w.platform === 'twigl'
        ? '<span class="work-badge ok" data-tip="Verified|The readable version and the original render the same image as the code in a twigl-style shader: checked pixel for pixel on the GPU (tools/works_check.py).">✓ same image as the original</span>'
        : w.platform === 'p5'
            ? '<span class="work-badge ok" data-tip="Verified|The point formula is the sketch’s, drawn by a Point cloud; compared with the original p5.js sketch rendered at pixel density 2 (tools/works_check.py).">✓ matches the p5.js sketch</span>'
            : '<span class="work-badge study" data-tip="Interpretive study|The post did not publish its code. This is our own construction of the look, not a reproduction.">our own study · no code was published</span>';
    const body = `<div class="work-credit"><div><b>${esc(w.title)}</b>${w.titled ? '' : '<span class="muted"> (our title)</span>'}</div><div class="muted">${study ? 'After ' : 'By '}${esc(creditLine(w))} · <a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer" data-tip="Open the post|${esc(w.url)} (opens in a new tab)">the post ↗</a></div>${badge}</div><p class="work-summary">${esc(w.summary)}</p>`;
    return v.section('work', study ? 'STUDY' : 'THE WORK', body, { tip: 'The work|Who made it, where it was posted, and what it does. The explanation below walks through it step by step.' });
}
/** The guided explanation: numbered steps, each highlighting lines of the code
 * and optionally showing a variable or stopping loops early. */
export function tourSection(v, n) {
    const w = workOf(n);
    if (!w?.tour?.length) {
        return '';
    }
    const active = v.ui.tour ?? null;
    const items = w.tour.map((step, k) => {
        const effects = [step.show ? `shows <code>${esc(step.show)}</code>` : '', step.steps ? Object.entries(step.steps).map(([loop, count]) => `loop ${loop} at ${count}`).join(', ') : ''].filter(Boolean).join(' · ');
        return `<li class="tour-step ${active === k ? 'active' : ''}"><button class="tour-button" data-action="tour" data-tour="${k}" aria-pressed="${active === k}" data-tip="${esc(step.title)}|Highlights the lines it explains${effects ? ` and ${effects}` : ''}. Click again to return to the full picture."><span class="tour-number">${k + 1}</span><span><b>${esc(step.title)}</b>${effects ? `<small class="tour-effect">${effects}</small>` : ''}</span></button>${active === k ? `<p class="tour-text">${esc(step.text)}</p>` : ''}</li>`;
    }).join('');
    const tools = active !== null ? '<button class="link" data-action="tour-end" data-tip="End the tour|Back to the full picture: every loop runs in full and the canvas shows the final image.">✕ End</button>' : '';
    return v.section('tour', 'HOW IT WORKS', `<ol class="tour">${items}</ol>`, { tools, tip: 'How it works|A guided walk through the code. Each step highlights the lines it explains, and may show a variable on the canvas or stop a loop early so you can see what that part does.' });
}
/** The code exactly as posted, with copy. */
export function originalSection(v, n) {
    const w = workOf(n);
    if (!w?.original) {
        return '';
    }
    const tools = '<button class="link" data-action="copy-original" data-tip="Copy|Copy the original code to the clipboard.">⧉ Copy</button>';
    const note = w.platform === 'p5'
        ? 'The p5.js sketch as posted. Its point formula is the equation of this Point cloud; the drawing loop (20000 points, stroke opacity, background) is the component’s parameters and the background layer.'
        : 'The code as posted, for twigl.app’s “geekest (300 es)” mode. The component runs the readable version; both render the same image.';
    return v.section('original', 'AS POSTED', `<pre class="original-code">${esc(w.original)}</pre><p class="node-caption">${esc(note)}</p>`, { tools, tip: 'As posted|The original code, unchanged, with its author’s credit above.' });
}
// ---- Code tab ------------------------------------------------------------------
function analysisOf(n) {
    try {
        return analyzeCode(n.params.code);
    }
    catch (e) {
        return null;
    }
}
/** Which version of a work's code the component runs. */
function versionOf(n) {
    const w = workOf(n);
    if (!w || w.platform !== 'twigl') {
        return null;
    }
    return n.params.code === w.readable ? 'readable' : n.params.code === w.original ? 'original' : 'edited';
}
export function codeTab(v, n, evaluated) {
    const def = catalog[n.type], warnings = v.warnings(n);
    const intro = `<p class="node-caption">${esc(def.description)}</p>${warnings}`;
    if (v.editing(n)) {
        return `${intro}<div class="cv-cols editing"><div class="cv-col">${codeEditor(v, n)}</div><div class="cv-col">${codeSyntaxHelp(v)}</div></div>`;
    }
    const analysis = analysisOf(n);
    return `${intro}<div class="cv-cols"><div class="cv-col">${workSection(v, n)}${codeSection(v, n, analysis)}${originalSection(v, n)}</div><div class="cv-col">${tourSection(v, n)}${loopsSection(v, n, analysis, evaluated)}${timeSection(v, n, evaluated)}${codeParameters(v, n, evaluated)}</div></div>`;
}
function codeSection(v, n, analysis) {
    const w = workOf(n), version = versionOf(n);
    const lines = w && v.ui.tour !== null && v.ui.tour !== undefined ? linesOf(n.params.code, w.tour[v.ui.tour]?.at || []) : [];
    const body = analysis
        ? `<pre class="code-view" id="codeView" data-node="${esc(n.id)}">${highlightCode(analysis, { lines })}</pre>`
        : `<pre class="code-view">${esc(n.params.code)}</pre>`;
    const switcher = version ? `<span class="seg" role="group" aria-label="Which code"><button class="${version === 'readable' ? 'active' : ''}" data-action="use-readable" aria-pressed="${version === 'readable'}" data-tip="Readable version|The same computation with named variables and a caption on every line. It renders the same image as the original.">Readable</button><button class="${version === 'original' ? 'active' : ''}" data-action="use-original" aria-pressed="${version === 'original'}" data-tip="As posted|Run the code exactly as posted. Its variables have the original one-letter names.">As posted</button></span>` : '';
    const tools = `${switcher}<button class="link" data-action="format-code" data-tip="Lay out|Rewrite the code one statement per line with indentation (comments are dropped; the image is unchanged). Undo restores it.">⇥ Lay out</button><button class="link" data-action="copy-code" data-tip="Copy|Copy this code to the clipboard (it runs on twigl.app in geekest 300 es mode).">⧉ Copy</button><button class="edit-button" id="editCode" data-action="edit" data-tip="Edit the code|Change it as text. The canvas previews your edit until you Apply it; errors point at their line.">✎ Edit</button>`;
    const hint = '<p class="code-hint">Drag a <span class="c-num">number</span> to change it · click a <span class="c-var">variable</span> to see it on the canvas · hover anything for what it is</p>';
    return v.section('code', 'THE CODE', `${body}${hint}`, { tools, tip: 'The code|The whole program for one pixel, run by the GPU for every pixel. Inputs are underlined, helpers and built-ins explain themselves on hover, loops are marked ⟳ in the margin.' });
}
function codeEditor(v, n) {
    const source = state.drafts.get(n.id) ?? '', status = codeDraftStatus(n);
    const tools = '<button data-action="cancel-edit" id="cancelEquation" data-tip="Cancel|Discard this edit; the component stays as it is.">Cancel</button><button id="applyEquation" class="primary" data-action="apply-equation" data-key="Ctrl/⌘ Enter" data-tip="Apply|Puts the code into the scene (one undo step). Code with an error is not applied.">Apply</button>';
    const body = `<p class="edit-note">Change anything. The canvas previews your edit; <b>Apply</b> puts it into the scene. The code runs once per pixel, starting with <code>o = vec4(0)</code>.</p><textarea id="equationEditor" class="expression-input code-input" spellcheck="false" aria-label="Shader code" rows="${Math.min(24, Math.max(6, source.split('\n').length + 1))}">${esc(source)}</textarea><p id="equationError" class="code-error ${status.ok ? '' : 'error'}" aria-live="polite">${esc(status.text)}</p>`;
    return v.section('editor', '✎ EDITING THE CODE', body, { tools, cls: 'editing', tip: 'Editing|Your text is a draft until you apply it. Ctrl/⌘ Enter applies; Cancel discards it.' });
}
/** The code draft's check result: {ok, text, line}. */
export function codeDraftStatus(n) {
    const source = state.drafts.get(n.id);
    try {
        const a = analyzeCode(source);
        if (!draftChanged(n.id)) {
            return { ok: true, text: 'No changes yet. Edit the text; the canvas previews your edit.' };
        }
        const loops = a.loops.length ? ` · ${a.loops.length} loop${a.loops.length > 1 ? 's' : ''}` : '';
        return { ok: true, text: `✓ The code checks (${a.variables.length} variables${loops}). ${n.id === state.selected ? 'The canvas shows your edit, not applied yet.' : 'Select this component in the main window to preview it.'}` };
    }
    catch (e) {
        return { ok: false, text: e.message, line: e.line ?? null };
    }
}
function codeSyntaxHelp(v) {
    const body = `<ul class="syntax-list">
<li>The code is the body of a GLSL ES 3.00 fragment shader, as in twigl.app’s <b>geekest</b> mode. It runs once per pixel.</li>
<li>Inputs: <code>FC</code> pixel position (FC.xy in pixels), <code>r</code> resolution, <code>t</code> time in seconds, <code>o</code> the output color (starts at 0), <code>PI</code>, <code>PI2</code>; also <code>m</code> (mouse, fixed at the center), <code>f</code> (frame), <code>s</code> (sound, 0).</li>
<li>Helpers: <code>hsv(h, s, v)</code>, <code>rotate2D(a)</code>, <code>rotate3D(a, axis)</code>, <code>snoise2D/3D/4D</code>, <code>fsnoise</code>, and every GLSL built-in.</li>
<li><code>param k = 1 [0, 2]</code> on its own line makes a slider named k.</li>
<li>Write floats with a point (<code>2.</code>, <code>.5</code>): GLSL does not turn <code>2</code> into a float by itself.</li>
<li>Not available: function definitions, arrays, textures and the previous frame <code>b</code>, #define. Loops stop after ${CODE_LIMITS.budget.toLocaleString('en')} steps per pixel in total, so a mistake cannot freeze the GPU.</li></ul>`;
    return v.section('syntax', 'HOW TO WRITE CODE', body);
}
function loopsSection(v, n, analysis, evaluated) {
    if (!analysis?.loops.length) {
        return '';
    }
    const specs = paramSpecs(n);
    const rows = analysis.loops.map(l => {
        const key = `steps${l.index + 1}`, spec = specs[key], value = evaluated[key], full = value >= spec.max;
        const what = l.steps === null ? 'runs until its condition fails' : `${l.steps} steps${l.depth ? ' each time it runs' : ''}`;
        return `<div class="loop-row ${full ? '' : 'limited'}" data-param-row="${key}"><div class="loop-head"><span class="loop-name">⟳${l.index + 1} <b>${esc(l.caption || l.name)}</b></span><span class="muted">line ${l.line} · ${what}</span></div>
<div class="loop-controls"><input type="range" id="param-${key}" data-param="${key}" min="0" max="${spec.max}" step="1" value="${value}" data-shown="${value}" aria-label="Steps of loop ${l.index + 1}"><output class="mono">${full && l.steps === null ? 'all' : value}</output><button class="icon-button" data-action="build-up" data-loop="${l.index}" aria-label="Build up loop ${l.index + 1}" data-tip="Build up|Sweep this loop from 0 steps to all of them in a few seconds and watch the picture form. Press again (or Esc) to stop.">▶</button><button class="icon-button" data-action="full-loop" data-loop="${l.index}" ${full ? 'disabled' : ''} aria-label="Run loop ${l.index + 1} in full" data-tip="Run in full|Back to all ${l.steps ?? ''} steps.">↺</button></div></div>`;
    }).join('');
    const total = analysis.loops.reduce((p, l) => l.parent === null ? p + (l.steps ?? NaN) * analysis.loops.filter(c => c.parent === l.index).reduce((q, c) => q * (c.steps ?? NaN), 1) : p, 0);
    const note = Number.isFinite(total) ? `<p class="node-caption">In all, up to ${Math.round(total).toLocaleString('en')} inner steps per pixel${total > 0 ? ` (the safety limit is ${CODE_LIMITS.budget.toLocaleString('en')})` : ''}.</p>` : '';
    return v.section('loops', 'LOOPS', rows + note, { tip: 'Loops|Every loop of the code. Stop one after fewer steps to see how the picture builds up: the outer loop of a raymarcher is the number of steps along each ray; an inner loop is usually the detail of a fractal.' });
}
function timeSection(v, n, evaluated) {
    const specs = paramSpecs(n), frozen = evaluated.speed === 0;
    const rows = ['speed', 'phase'].map(key => v.parameter(n, key, specs[key], evaluated[key])).join('');
    const tools = `<button class="link" data-action="freeze" ${frozen ? 'disabled' : ''} data-tip="Freeze here|Keep showing this moment: speed 0 and the time offset of the playhead. Use the component as a still in another scene. Undo restores the motion.">❄ Freeze here</button>`;
    const note = `<p class="node-caption">The code’s t = ${evaluated.speed} × studio time + ${evaluated.phase}${frozen ? ' — frozen: it shows one moment' : ''}.</p>`;
    return v.section('time', 'TIME', rows + note, { tools, tip: 'Time|How the studio’s clock drives this component: speed 1 is real time, 0 freezes it, negative runs backwards; the offset shifts which moment it shows.' });
}
function codeParameters(v, n, evaluated) {
    const params = Object.entries(paramSpecs(n)).filter(([key, s]) => s.custom && s.loop === undefined);
    if (!params.length) {
        return '';
    }
    return v.section('params', 'PARAMETERS', params.map(([key, s]) => v.parameter(n, key, s, evaluated[key])).join(''), { tip: 'Parameters|Sliders declared by the code’s param lines.' });
}
// ---- Look inside tab ------------------------------------------------------------------
export function insideTab(v, n) {
    const analysis = analysisOf(n);
    if (!analysis) {
        return '<p class="muted small-note">The code has an error; fix it in the Code tab first.</p>';
    }
    const list = showable(analysis), current = state.show?.node === n.id ? state.show.index : 0, onCanvas = state.viewMode === 'stage' && state.selected === n.id;
    const values = v.ui.pointValues?.node === n.id ? v.ui.pointValues.values : null;
    const row = (index, name, type, where, caption) => {
        const active = current === index && (index === 0 || onCanvas);
        const value = values ? formatValue(values[index]) : '';
        return `<button class="inside-row ${active ? 'active' : ''}" data-action="show-value" data-show="${index}" aria-pressed="${active}" data-tip="${esc(name)}|${esc(caption || where)} Click to show it on the canvas${index ? ' with a colormap and legend' : ''}."><span class="inside-name mono">${esc(name)}</span><span class="type-chip ${type === 'layer' ? 'layer' : type === 'vec2' ? 'coord' : 'scalar'}">${esc(type)}</span><span class="inside-where muted">${esc(where)}</span><span class="inside-value mono">${esc(value)}</span></button>`;
    };
    const rows = [row(0, 'o', 'vec4', 'the color: the normal output', 'The output color, what the scene shows.')];
    list.forEach((item, k) => {
        if (item.kind === 'steps') {
            rows.push(row(k + 1, item.name, 'int', `loop ${item.loop + 1}, line ${item.line}`, 'How many steps this loop took at each pixel (in its last run).'));
        }
        else {
            const caption = captionOf(analysis, item.line);
            rows.push(row(k + 1, item.name, item.type, `line ${item.line}${item.loop !== null ? ` · loop ${item.loop + 1}` : ''}${caption ? ` · ${caption}` : ''}`, caption ? `${caption}.` : `Declared on line ${item.line}.`));
        }
    });
    const pin = state.probePin ? (values ? 'Values at the pinned point, after the loops (as far as their sliders let them run).' : 'Reading the values at the pinned point…') : 'Click the canvas to pin a point: the value of every variable there appears here.';
    const body = `<p class="node-caption">Every value the code computes can be put on the canvas instead of its color, with its own colormap. Values are shown after the code has run, with loops stopped where their sliders say, so combine this with Loops to look at a value part-way.</p><div class="inside-list" role="group" aria-label="Values of the code">${rows.join('')}</div><p class="node-caption">${esc(pin)}</p>`;
    const tools = current ? '<button class="link" data-action="show-value" data-show="0" data-tip="Back to the color|Show the component’s color again.">◉ Color</button>' : '';
    return v.section('inside', 'LOOK INSIDE', body, { tools, tip: 'Look inside|The variables of the code, each viewable on the canvas. A depth or distance shows the 3D structure a raymarcher found; a scale shows how deep a fractal goes; a loop’s steps show where it worked hardest.' });
}
function formatValue(v) {
    if (!v) {
        return '';
    }
    const f = x => {
        if (!Number.isFinite(x)) {
            return String(x);
        }
        const a = Math.abs(x);
        return a !== 0 && (a < 1e-3 || a >= 1e5) ? x.toExponential(2) : String(Number(x.toPrecision(4)));
    };
    return v.length === 1 ? f(v[0]) : `(${v.map(f).join(', ')})`;
}
/** Read every value of the code at the pinned point (asynchronously). */
export function readPointValues(v, n) {
    const renderer = state.renderer, pin = state.probePin, analysis = analysisOf(n);
    if (!renderer?.info.rawFields || !pin || !analysis) {
        return;
    }
    const canvas = renderer.canvas, world = pixelToWorld(pin.px + 0.5, pin.py + 0.5, canvas.width, canvas.height, state.project.view);
    const list = showable(analysis), project = JSON.parse(JSON.stringify(state.project)), time = state.time, token = {};
    v.ui.pointToken = token;
    const sizes = list.map(item => item.kind === 'steps' ? 1 : { float: 1, int: 1, bool: 1, vec2: 2, ivec2: 2, bvec2: 2, vec3: 3, ivec3: 3, bvec3: 3 }[item.type] ?? 4);
    const reads = [0, ...list.map((_, k) => k + 1)].map(show => renderer.sampleLine(project, time, n.id, [world.x, world.y], [world.x, world.y], 1, { async: true, show }).catch(() => null));
    Promise.all(reads).then(results => {
        if (v.ui.pointToken !== token) {
            return;
        }
        const values = results.map((r, k) => r ? [...r].slice(0, k ? sizes[k - 1] : 4) : null);
        v.ui.pointValues = { node: n.id, values };
        if (v.ui.tab === 'inside') {
            v.render();
        }
    });
}
// ---- Actions --------------------------------------------------------------------
let building = null;
/** Sweep loop `index` of the component from 0 to all steps (▶ Build up). */
function buildUp(n, index) {
    if (building) {
        cancelAnimationFrame(building.frame);
        building = null;
        endLiveEdit();
        return;
    }
    const key = `steps${index + 1}`, spec = paramSpecs(n)[key], start = performance.now(), seconds = 4;
    building = { frame: 0 };
    const step = () => {
        const k = Math.min(1, (performance.now() - start) / 1000 / seconds);
        liveParam(n.id, key, Math.round(spec.max * k * k)); // slow at first, where most of the change happens
        if (k < 1 && building) {
            building.frame = requestAnimationFrame(step);
        }
        else {
            building = null;
            endLiveEdit();
        }
    };
    building.frame = requestAnimationFrame(step);
}
export function stopBuildUp() {
    if (building) {
        cancelAnimationFrame(building.frame);
        building = null;
        endLiveEdit();
        return true;
    }
    return false;
}
/** Apply tour step `k` of the work (or end the tour with k = null). */
function tour(v, n, k) {
    const w = workOf(n), step = k === null ? null : w?.tour[k];
    v.ui.tour = step ? k : null;
    const specs = paramSpecs(n);
    // Every loop runs in full unless the step stops it early.
    transact(p => {
        const node = p.nodes.find(x => x.id === n.id);
        for (const [key, spec] of Object.entries(specs)) {
            if (spec.loop !== undefined) {
                node.params[key] = step?.steps?.[spec.loop + 1] ?? spec.max;
            }
        }
    }, { refresh: false });
    if (step?.show && catalog[n.type].code) {
        const index = showable(analyzeCode(nodeById(n.id).params.code)).findIndex(item => item.name === step.show) + 1;
        setShow(n.id, index);
    }
    else {
        state.show = null;
        setView('final');
    }
    v.render();
    requestAnimationFrame(() => v.q('.code-view .c-line.hl')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}
async function copyText(text, what) {
    try {
        await navigator.clipboard.writeText(text);
        toast(`${what} copied to the clipboard.`);
    }
    catch (e) {
        showError('The clipboard is not available here. Select the text and copy it.');
    }
}
/** Handle a Code-view action; returns true when it was one. */
export function codeAction(v, n, action, target) {
    const w = workOf(n);
    switch (action) {
        case 'tour': {
            const k = Number(target.closest('[data-tour]').dataset.tour);
            tour(v, n, v.ui.tour === k ? null : k);
            return true;
        }
        case 'tour-end':
            tour(v, n, null);
            return true;
        case 'use-readable':
        case 'use-original':
            if (w && applyEquation(n.id, action === 'use-original' ? w.original : w.readable)) {
                toast(action === 'use-original' ? 'Running the code as posted. Readable switches back.' : 'Running the readable version. Same image, named variables.');
            }
            return true;
        case 'format-code':
            try {
                if (applyEquation(n.id, formatCode(n.params.code))) {
                    toast('Laid out one statement per line. Undo restores the original layout.');
                }
            }
            catch (e) {
                showError(e);
            }
            return true;
        case 'copy-code':
            copyText(n.params.code, 'The code');
            return true;
        case 'copy-original':
            copyText(w?.original || '', 'The original code');
            return true;
        case 'build-up':
            buildUp(n, Number(target.closest('[data-loop]').dataset.loop));
            return true;
        case 'full-loop': {
            const key = `steps${Number(target.closest('[data-loop]').dataset.loop) + 1}`;
            transact(p => p.nodes.find(x => x.id === n.id).params[key] = paramSpecs(n)[key].max);
            return true;
        }
        case 'freeze':
            if (freezeTime(n.id)) {
                toast('Frozen at this moment: speed 0. Use it as a still, or set the speed again to animate it. Undo restores the motion.');
            }
            return true;
        case 'show-value': {
            const index = Number(target.closest('[data-show]').dataset.show);
            setShow(n.id, index);
            if (!index) {
                setView('final');
            }
            v.render();
            return true;
        }
        default:
            return false;
    }
}
/** Clicking a variable in the code shows it on the canvas. */
export function codeClick(v, n, target) {
    const variable = target.closest('.code-view .c-var[data-var]');
    if (!variable || !catalog[n.type].code) {
        return false;
    }
    const analysis = analysisOf(n), id = Number(variable.dataset.var);
    const index = showable(analysis).findIndex(item => item.kind === 'variable' && item.id === id) + 1;
    if (index) {
        setShow(n.id, index);
        toast(`The canvas shows ${analysis.variables[id].name}. Choose Look inside ▸ o (or press Esc) for the color again.`);
    }
    else {
        toast('A matrix cannot be shown as a picture.');
    }
    return true;
}
// ---- Dragging numbers --------------------------------------------------------------
/** How much one pixel of dragging changes a number of this size. */
function dragStep(value) {
    const a = Math.abs(value);
    return (a > 0 ? 10 ** Math.floor(Math.log10(a)) : 0.1) / 50;
}
/** Start dragging a number of the code (pointer down on it). */
export function startNumberDrag(v, e) {
    const span = e.target.closest('.code-view .c-num[data-num]');
    const n = v.node();
    if (!span || e.button !== 0 || !catalog[n?.type]?.code) {
        return false;
    }
    e.preventDefault();
    const analysis = analysisOf(n), index = Number(span.dataset.num), number = analysis.numbers[index];
    const original = number.text, start = number.value, x0 = e.clientX, unit = dragStep(start);
    let moved = false;
    span.setPointerCapture(e.pointerId);
    span.classList.add('scrubbing');
    const move = ev => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 3) {
            return;
        }
        moved = true;
        const step = unit * (ev.shiftKey ? 0.1 : 1), value = start + dx * step;
        const text = numberText(value, step, number.float ? original : `${original}.`);
        if (text !== span.textContent) {
            span.textContent = text;
            liveNumber(n.id, index, text);
        }
    };
    const up = () => {
        span.removeEventListener('pointermove', move);
        span.removeEventListener('pointerup', up);
        span.removeEventListener('pointercancel', up);
        span.classList.remove('scrubbing');
        if (moved) {
            endLiveEdit();
        }
    };
    span.addEventListener('pointermove', move);
    span.addEventListener('pointerup', up);
    span.addEventListener('pointercancel', up);
    return true;
}
/** Arrow keys on a focused number change it by one drag step (×10 with Shift). */
export function numberKey(v, e) {
    const span = e.target.closest?.('.code-view .c-num[data-num]');
    if (!span || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return false;
    }
    e.preventDefault();
    const n = v.node(), analysis = analysisOf(n), number = analysis.numbers[Number(span.dataset.num)];
    const direction = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1, step = dragStep(number.value) * 10 * (e.shiftKey ? 10 : 1);
    const text = numberText(number.value + direction * step, step, number.float ? number.text : `${number.text}.`);
    liveNumber(n.id, number.index, text);
    endLiveEdit();
    requestAnimationFrame(() => v.q(`.code-view .c-num[data-num="${number.index}"]`)?.focus());
    return true;
}
