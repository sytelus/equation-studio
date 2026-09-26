import { catalog } from './catalog.js';
import { parseExpression, formatExpression, checkProgram, equationParams, LIBRARY } from './expression.js';
/** Components as equations you can edit.
 *
 * Every component whose inputs a custom equation can read (coordinates p and up to
 * two scalar fields a and b) can be written as an equation of the language in
 * expression.js. `forkProgram()` writes it: its parameters become `param` lines
 * named after their symbols in the typeset math (κ → kappa, c_x → c_x) with their
 * current values, ranges and help, and the computation comes from the catalog's
 * `source` (the steps as equation lines) or, for kernels with loops, is a call of
 * the component's shader function. The equation renders exactly the same image.
 *
 * `withEquation()` is the one operation behind the editor's Edit/Apply and its
 * live draft preview: the project with one component running a given equation.
 * Pure: no DOM, no WebGL, no editor state.
 */
const CUSTOM_FOR = { scalar: 'expression', coord: 'vectorExpression', layer: 'colorExpression' };
const TAKEN = new Set(['p', 'x', 'y', 'r', 'theta', 'a', 'b', 't', 'PI', 'TAU', 'param', 'expression', 'step', ...Object.keys(LIBRARY)]);
const MAX_LABEL = 160;
/** Why a component cannot be written as an equation, or null when it can. */
export function forkBlocker(type) {
    const d = catalog[type];
    if (!d) {
        return 'Unknown component.';
    }
    if (d.custom) {
        return null;
    }
    if (d.role === 'source') {
        return 'It produces the pixel coordinates themselves; every equation starts from them as p.';
    }
    const kinds = Object.values(d.inputs);
    if (!CUSTOM_FOR[d.output] || kinds.some(k => k !== 'coord' && k !== 'scalar')) {
        return `It ${d.output === 'geometry' ? 'produces a geometry bundle' : 'reads a color layer or a geometry bundle'}, and equations work with numbers, coordinates and colors only. Change its parameters, or replace it (More ▸ Replace with…).`;
    }
    if (kinds.filter(k => k === 'coord').length > 1 || kinds.filter(k => k === 'scalar').length > 2) {
        return 'It has more inputs than an equation can read (coordinates p and two fields a and b).';
    }
    return null;
}
/** Whether a built-in component can become an equation. */
export function forkable(type) {
    return !catalog[type]?.custom && forkBlocker(type) === null;
}
/** A usable name from a TeX symbol: '\\kappa' → 'kappa', 'k_\\theta' → 'k_theta'. */
const GREEK = /\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega|ell)(?![A-Za-z])/g;
export function symbolName(tex) {
    const text = String(tex || '').replace(GREEK, '$1');
    if (text.includes('\\')) {
        return null; // \text, \mathrm and the like do not make names
    }
    const name = text.replace(/[{}\s]/g, '');
    return /^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)?$/.test(name) ? name : null;
}
const fmt = v => String(Number(Number(v).toPrecision(6)));
const firstSentence = text => text.match(/^.*?\.(?=\s|$)/)?.[0] ?? text;
/** Names a catalog source defines (`name = …` lines). */
const definedNames = lines => lines.map(l => /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(l)?.[1]).filter(Boolean);
/** The custom equation equivalent to `node`. Returns {type, expression, params,
 * inputs, renames} where `renames` maps old parameter keys to their new names
 * (for animation tracks). Throws when the component cannot be forked.
 */
export function forkProgram(node) {
    const d = catalog[node.type];
    if (!forkable(node.type)) {
        throw new Error(`${d?.name || node.type} cannot become an equation: ${forkBlocker(node.type) || 'it already is one.'}`);
    }
    const taken = new Set([...TAKEN, ...definedNames(d.source || [])]), renames = {};
    for (const [key, spec] of Object.entries(d.params)) {
        const name = [symbolName(spec.symbol), key, `${key}1`].find(c => c && !taken.has(c) && c.length <= 24);
        renames[key] = name;
        taken.add(name);
    }
    const scalars = ['a', 'b'], sockets = {}, inputs = {};
    for (const [socket, kind] of Object.entries(d.inputs)) {
        sockets[socket] = kind === 'coord' ? 'p' : scalars.shift();
        if (node.inputs[socket]) {
            inputs[sockets[socket]] = node.inputs[socket];
        }
    }
    const lines = [`// ${d.name}, written as an equation you can change`];
    for (const [key, spec] of Object.entries(d.params)) {
        const help = `${spec.label}: ${firstSentence(spec.help)}`.replace(/\s+/g, ' ');
        lines.push(spec.kind === 'color'
            ? `param ${renames[key]} = ${node.params[key]}  // ${help}`
            : `param ${renames[key]} = ${fmt(node.params[key])} [${fmt(spec.min)}, ${fmt(spec.max)}] step ${fmt(spec.step)}  // ${help}`);
    }
    if (d.source) {
        lines.push(...d.source.map(line => line.replace(/\$(\w+)/g, (_, key) => {
            if (!renames[key]) {
                throw new Error(`${node.type}: the source uses $${key}, which is not a parameter.`);
            }
            return renames[key];
        })));
    }
    else {
        const call = formatExpression(parseExpression(d.emit(sockets, renames).replaceAll('u_time', 't')));
        const kernel = /^(\w+)\(/.exec(call)?.[1];
        if (kernel && LIBRARY[kernel]) {
            lines.push(`// ${kernel}() is a function of the shader library (its code: More ▸ Code). Change what goes in, or what comes out.`);
        }
        lines.push(`${call}  // ${firstSentence(d.description)}`);
    }
    const expression = lines.join('\n'), type = CUSTOM_FOR[d.output];
    checkProgram(expression, type); // the generated equation must be valid
    const params = { expression };
    for (const key of Object.keys(d.params)) {
        params[renames[key]] = node.params[key];
    }
    return { type, expression, params, inputs, renames };
}
/** The text to start editing `node` from: its equation, or the equivalent one. */
export function equationSource(node) {
    return catalog[node.type].custom ? node.params.expression : forkProgram(node).expression;
}
/** Parameters for a new version of an equation. A parameter keeps its current
 * value when its `param` line still exists with the same default (clamped to a
 * changed range); a new parameter, or one whose default was edited, takes the
 * declared default. Returns {params, keep(name)}: `keep` tells whether a track of
 * that parameter survives (numbers only).
 */
function syncedParams(kind, previousSource, previousParams, source) {
    let before = {};
    try {
        before = equationParams(previousSource, kind);
    }
    catch (e) { /* an invalid previous text keeps nothing */
    }
    const specs = equationParams(source, kind), params = { expression: source };
    for (const [name, spec] of Object.entries(specs)) {
        const old = previousParams[name], sameDefault = before[name] && before[name].kind === spec.kind && before[name].value === spec.value;
        if (spec.kind === 'number') {
            params[name] = sameDefault && typeof old === 'number' ? Math.min(spec.max, Math.max(spec.min, old)) : spec.value;
        }
        else {
            params[name] = sameDefault && typeof old === 'string' && /^#[0-9a-f]{6}$/i.test(old) ? old : spec.value;
        }
    }
    return { params, specs };
}
/** The project with component `nodeId` running equation `source` (see the module
 * comment). A built-in component first becomes its equivalent equation: same id
 * and wiring, label "… · equation", parameter values and animation kept under
 * their new names. Tracks of removed parameters are dropped and keys are clamped
 * to changed ranges. Throws an EquationError when `source` does not check.
 */
export function withEquation(project, nodeId, source) {
    const next = JSON.parse(JSON.stringify(project)), node = next.nodes.find(n => n.id === nodeId);
    if (!node) {
        throw new Error(`Unknown component ${nodeId}.`);
    }
    if (!catalog[node.type].custom) {
        const fork = forkProgram(node);
        for (const t of next.tracks.filter(t => t.node === nodeId)) {
            t.param = fork.renames[t.param];
        }
        Object.assign(node, { type: fork.type, inputs: fork.inputs, params: fork.params, label: `${node.label} · equation`.slice(0, MAX_LABEL) });
    }
    checkProgram(source, node.type);
    const { params, specs } = syncedParams(node.type, node.params.expression, node.params, source);
    node.params = params;
    next.tracks = next.tracks.filter(t => t.node !== nodeId || specs[t.param]?.kind === 'number');
    for (const t of next.tracks.filter(t => t.node === nodeId)) {
        const s = specs[t.param];
        t.keys = t.keys.map(k => ({ ...k, value: Math.min(s.max, Math.max(s.min, k.value)) }));
    }
    return next;
}
