import { parseExpression, parseProgram, PRECEDENCE } from './expression.js';
/** Typeset equations as native MathML, with no fonts, scripts or network access.
 *
 * texToMathML() converts the small TeX subset used by the component catalog:
 * letters, numbers, operators, groups, ^ and _, \frac, \sqrt, \text, \mathrm,
 * \operatorname, \mathbf, accents, \left/\right, big operators (\sum, \prod),
 * Greek letters, common functions, relations and spacing commands. Unknown
 * commands throw, so the unit tests catch catalog typos. Operator names get the
 * thin spaces TeX would give them ("arccos cos x", not "arccoscosx").
 *
 * Symbols can be annotated: `symbols` maps a symbol's TeX (whitespace and braces
 * ignored, e.g. 'c_x' or '\\kappa') to {role, type, param, socket, value, title}.
 * A matching symbol is wrapped in <mrow class="sym sym-ROLE TYPE" data-…> so the
 * page can color inputs, parameters, outputs and time, and link a parameter's
 * symbol to its control. With `values: true` a parameter symbol that has a
 * `value` is replaced by that number. texSegments() splits a long line at its
 * top-level \quad separators so the pieces can wrap on narrow screens.
 *
 * expressionToMathML() parses a custom GLSL expression (the same grammar the
 * editor accepts) and renders it as mathematics: a/b becomes a fraction,
 * pow(a,b) a power, sqrt a radical, abs and length bars, vecN a tuple, theta θ.
 */
const escapeXML = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
    iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
    phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', ell: 'ℓ'
};
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'exp', 'log', 'ln', 'max', 'min', 'arccos', 'arcsin', 'arctan', 'tanh', 'sinh', 'cosh', 'det']);
const OPERATORS = {
    cdot: '·', times: '×', odot: '⊙', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', propto: '∝',
    to: '→', mapsto: '↦', rightarrow: '→', leftarrow: '←', pm: '±', in: '∈', infty: '∞', partial: '∂', nabla: '∇', circ: '∘',
    ldots: '…', cdots: '⋯', lvert: '|', rvert: '|', vert: '|', lVert: '‖', rVert: '‖', Vert: '‖', langle: '⟨', rangle: '⟩',
    star: '⋆', prime: '′', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', bmod: 'mod', '{': '{', '}': '}', '|': '‖'
};
/** Spacing class of operator commands that are not binary operators. */
const OPERATOR_KINDS = { ldots: 'ord', cdots: 'ord', infty: 'ord', partial: 'ord', nabla: 'ord', prime: 'ord', star: 'ord', lfloor: 'open', lceil: 'open', langle: 'open', lvert: 'open', lVert: 'open', rfloor: 'close', rceil: 'close', rangle: 'close', rvert: 'close', rVert: 'close', '{': 'open', '}': 'close' };
const LARGE = { sum: '∑', prod: '∏' };
const SPACES = { quad: '1em', qquad: '2em', ',': '0.167em', ';': '0.278em', ':': '0.222em', ' ': '0.25em', '!': '0em' };
const ACCENTS = { hat: '^', bar: '¯', tilde: '~', vec: '→', dot: '˙' };
const IGNORED = new Set(['left', 'right', 'big', 'bigl', 'bigr', 'Big', 'Bigl', 'Bigr', 'displaystyle']);
const OPERATOR_CHARS = { '-': '−', '*': '∗', "'": '′' };
const THIN = '<mspace width="0.167em"></mspace>';
/** How a symbol's TeX is compared: without whitespace and braces. */
export const symbolKey = tex => String(tex).replace(/[\s{}]/g, '');
/** A number as MathML, parenthesized when negative so it can replace a symbol anywhere. */
export function numberMathML(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return `<mi>${escapeXML(value)}</mi>`;
    }
    const text = String(Number(n.toPrecision(4)));
    return n < 0 ? `<mrow><mo>(</mo><mo>−</mo><mn>${text.slice(1)}</mn><mo>)</mo></mrow>` : `<mn>${text}</mn>`;
}
class TexParser {
    constructor(source, { symbols = null, values = false } = {}) {
        this.s = source;
        this.i = 0;
        this.symbols = symbols ? new Map(Object.entries(symbols).map(([k, v]) => [symbolKey(k), v])) : null;
        this.values = values;
    }
    error(message) {
        return new Error(`${message} at position ${this.i} in “${this.s}”`);
    }
    skipSpace() {
        while (this.i < this.s.length && /\s/.test(this.s[this.i])) {
            this.i++;
        }
    }
    peek() {
        this.skipSpace();
        return this.s[this.i];
    }
    /** Read a command name after a backslash: letters, or one symbol character. */
    command() {
        this.i++;
        const letters = /^[A-Za-z]+/.exec(this.s.slice(this.i));
        if (letters) {
            this.i += letters[0].length;
            return letters[0];
        }
        if (this.i >= this.s.length) {
            throw this.error('Dangling backslash');
        }
        return this.s[this.i++];
    }
    /** Raw text of a braced argument, for \text and \mathrm. */
    rawGroup() {
        if (this.peek() !== '{') {
            throw this.error('Expected {');
        }
        let depth = 0, start = ++this.i;
        for (; this.i < this.s.length; this.i++) {
            if (this.s[this.i] === '{') {
                depth++;
            }
            else if (this.s[this.i] === '}') {
                if (depth === 0) {
                    return this.s.slice(start, this.i++);
                }
                depth--;
            }
        }
        throw this.error('Unclosed {');
    }
    /** A sequence of scripted atoms, with TeX's thin spaces around operator names. */
    list() {
        const items = [];
        while (this.peek() !== undefined && this.peek() !== '}') {
            items.push(this.scripted());
        }
        let xml = '';
        items.forEach((item, k) => {
            const previous = items[k - 1]?.kind;
            if (k && ((item.kind === 'func' && (previous === 'ord' || previous === 'close')) || (previous === 'func' && (item.kind === 'ord' || item.kind === 'func' || item.kind === 'large')))) {
                xml += THIN;
            }
            xml += item.xml;
        });
        return xml;
    }
    group() {
        this.i++; // {
        const body = this.list();
        if (this.peek() !== '}') {
            throw this.error('Unclosed {');
        }
        this.i++;
        return `<mrow>${body}</mrow>`;
    }
    argument() {
        const c = this.peek();
        if (c === undefined) {
            throw this.error('Missing argument');
        }
        return c === '{' ? this.group() : this.atom().xml;
    }
    /** The annotation for the source text between two positions, if any. */
    lookup(from, to) {
        return this.symbols?.get(symbolKey(this.s.slice(from, to))) || null;
    }
    /** Wrap `xml` for an annotated symbol, or replace it by its value. */
    annotate(xml, sym) {
        const classes = ['sym', `sym-${sym.role}`, sym.type].filter(Boolean).join(' ');
        const data = [sym.param && `data-param="${escapeXML(sym.param)}"`, sym.socket && `data-socket="${escapeXML(sym.socket)}"`, sym.title && `data-sym-title="${escapeXML(sym.title)}"`].filter(Boolean).join(' ');
        const body = this.values && sym.value !== undefined && sym.value !== null ? numberMathML(sym.value) : xml;
        return `<mrow class="${classes}"${data ? ` ${data}` : ''}>${body}</mrow>`;
    }
    scripted() {
        this.skipSpace();
        const start = this.i, base = this.atom(), baseEnd = this.i;
        let sub = null, sup = null;
        for (;;) {
            const c = this.peek();
            if (c === '^' && sup === null) {
                this.i++;
                sup = this.argument();
            }
            else if (c === '_' && sub === null) {
                this.i++;
                sub = this.argument();
            }
            else {
                break;
            }
        }
        const whole = sub !== null || sup !== null ? this.lookup(start, this.i) : null;
        const baseSymbol = whole ? null : this.lookup(start, baseEnd);
        const baseXML = baseSymbol ? this.annotate(base.xml, baseSymbol) : base.xml;
        let xml = baseXML;
        if (sub !== null || sup !== null) {
            const [both, under, over] = base.large ? ['munderover', 'munder', 'mover'] : ['msubsup', 'msub', 'msup'];
            xml = sub !== null && sup !== null ? `<${both}>${baseXML}${sub}${sup}</${both}>` : sub !== null ? `<${under}>${baseXML}${sub}</${under}>` : `<${over}>${baseXML}${sup}</${over}>`;
        }
        if (whole) {
            xml = this.annotate(xml, whole);
        }
        return { xml, kind: base.kind === 'large' ? 'large' : base.kind };
    }
    atom() {
        const c = this.peek();
        if (c === undefined) {
            throw this.error('Unexpected end');
        }
        if (c === '{') {
            return { xml: this.group(), kind: 'ord' };
        }
        if (c === '\\') {
            return this.commandAtom(this.command());
        }
        if (c === '^' || c === '_' || c === '}') {
            throw this.error(`Unexpected ${c}`);
        }
        const number = /^(\d+(\.\d+)?|\.\d+)/.exec(this.s.slice(this.i));
        if (number) {
            this.i += number[0].length;
            return { xml: `<mn>${number[0]}</mn>`, kind: 'ord' };
        }
        this.i++;
        if (/[A-Za-z]/.test(c)) {
            return { xml: `<mi>${c}</mi>`, kind: 'ord' };
        }
        const kind = '(['.includes(c) ? 'open' : ')]'.includes(c) ? 'close' : c === '|' ? 'ord' : 'op';
        return { xml: `<mo>${escapeXML(OPERATOR_CHARS[c] || c)}</mo>`, kind };
    }
    commandAtom(name) {
        if (IGNORED.has(name)) {
            return this.peek() === '.' ? (this.i++, { xml: '', kind: 'space' }) : this.atom();
        }
        if (name === 'frac' || name === 'tfrac' || name === 'dfrac') {
            const top = this.argument(), bottom = this.argument();
            return { xml: `<mfrac>${top}${bottom}</mfrac>`, kind: 'ord' };
        }
        if (name === 'sqrt') {
            return { xml: `<msqrt>${this.argument()}</msqrt>`, kind: 'ord' };
        }
        if (name === 'text') {
            // Token elements trim their ends: keep deliberate spaces as no-break spaces.
            const text = this.rawGroup().replace(/^ +| +$/g, m => '\u00a0'.repeat(m.length));
            return { xml: `<mtext>${escapeXML(text)}</mtext>`, kind: 'ord' };
        }
        if (name === 'mathrm' || name === 'operatorname') {
            return { xml: `<mi mathvariant="normal">${escapeXML(this.rawGroup())}</mi>`, kind: name === 'operatorname' ? 'func' : 'ord' };
        }
        if (name === 'mathbf' || name === 'boldsymbol') {
            return { xml: `<mrow class="bold">${this.argument()}</mrow>`, kind: 'ord' };
        }
        if (Object.hasOwn(ACCENTS, name)) {
            return { xml: `<mover accent="true">${this.argument()}<mo>${ACCENTS[name]}</mo></mover>`, kind: 'ord' };
        }
        if (Object.hasOwn(GREEK, name)) {
            return { xml: `<mi>${GREEK[name]}</mi>`, kind: 'ord' };
        }
        if (FUNCTIONS.has(name)) {
            return { xml: `<mi mathvariant="normal">${name}</mi>`, kind: 'func' };
        }
        if (Object.hasOwn(LARGE, name)) {
            return { xml: `<mo largeop="true" movablelimits="false">${LARGE[name]}</mo>`, large: true, kind: 'large' };
        }
        if (Object.hasOwn(OPERATORS, name)) {
            return { xml: `<mo>${escapeXML(OPERATORS[name])}</mo>`, kind: OPERATOR_KINDS[name] || 'op' };
        }
        if (Object.hasOwn(SPACES, name)) {
            return { xml: `<mspace width="${SPACES[name]}"></mspace>`, kind: 'space' };
        }
        throw this.error(`Unsupported TeX command \\${name}`);
    }
}
/** Convert one line of TeX to a MathML string. Throws on unsupported input.
 * Options: display (block layout), symbols and values (see the module comment).
 */
export function texToMathML(tex, { display = true, symbols = null, values = false } = {}) {
    const parser = new TexParser(String(tex), { symbols, values });
    const body = parser.list();
    if (parser.peek() !== undefined) {
        throw parser.error('Unbalanced }');
    }
    return `<math${display ? ' display="block"' : ''}>${body}</math>`;
}
/** Split a TeX line at top-level \quad / \qquad separators (outside braces and
 * \left…\right pairs), so the pieces can wrap as separate equations.
 */
export function texSegments(tex) {
    const s = String(tex), parts = [];
    let depth = 0, delimiters = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '{') {
            depth++;
        }
        else if (c === '}') {
            depth--;
        }
        else if (c === '\\') {
            const name = /^[A-Za-z]+/.exec(s.slice(i + 1))?.[0];
            if (name === 'left') {
                delimiters++;
            }
            else if (name === 'right') {
                delimiters--;
            }
            else if ((name === 'quad' || name === 'qquad') && depth === 0 && delimiters === 0) {
                parts.push(s.slice(start, i));
                start = i + 1 + name.length;
            }
            i += name ? name.length : 1;
        }
    }
    parts.push(s.slice(start));
    return parts.map(p => p.trim().replace(/^,\s*|,\s*$/g, '').trim()).filter(Boolean);
}
/** One MathML element per segment of a TeX line, laid out in display style. */
export function texToMathMLSegments(tex, options = {}) {
    return texSegments(tex).map(segment => texToMathML(segment, { ...options, display: false }).replace('<math>', '<math displaystyle="true">'));
}
// ---- Custom equations ------------------------------------------------------------
const BINARY = { ...PRECEDENCE, '^': 8 };
const IDENTIFIERS = { theta: 'θ', PI: 'π', TAU: 'τ' };
const PREFIX_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'tanh', 'log', 'atan', 'asin', 'acos']);
const mo = s => `<mo>${escapeXML(s)}</mo>`;
const fenced = (open, body, close) => `<mrow>${mo(open)}${body}${mo(close)}</mrow>`;
/** A user name typeset like a symbol: Greek names become letters, `w_0` a
 * subscript, longer names upright text.
 */
export function nameMathML(name) {
    const piece = text => {
        if (Object.hasOwn(IDENTIFIERS, text)) {
            return `<mi>${IDENTIFIERS[text]}</mi>`;
        }
        if (Object.hasOwn(GREEK, text)) {
            return `<mi>${GREEK[text]}</mi>`;
        }
        if (/^\d+$/.test(text)) {
            return `<mn>${text}</mn>`;
        }
        return text.length === 1 ? `<mi>${escapeXML(text)}</mi>` : `<mi mathvariant="normal">${escapeXML(text)}</mi>`;
    };
    const cut = name.indexOf('_');
    if (cut > 0 && cut < name.length - 1) {
        return `<msub>${piece(name.slice(0, cut))}${piece(name.slice(cut + 1))}</msub>`;
    }
    return piece(name);
}
/** Precedence of a rendered node, used to decide where parentheses are needed. */
function precedence(node) {
    if (node.type === 'group') { // parentheses are re-added only where the context needs them
        return precedence(node.body);
    }
    if (node.type === 'binary') {
        return BINARY[node.op];
    }
    if (node.type === 'ternary') {
        return 0;
    }
    if (node.type === 'unary') {
        return 7;
    }
    return 9;
}
function renderNode(node, ctx) {
    switch (node.type) {
        case 'num': {
            const n = Number(node.value);
            return `<mn>${Number.isFinite(n) && Math.abs(n) < 1e7 && !/[eE]/.test(node.value) ? String(n) : escapeXML(node.value)}</mn>`;
        }
        case 'id': {
            const sym = ctx.symbols?.get(node.name), xml = nameMathML(node.name);
            if (!sym) {
                return xml;
            }
            const classes = ['sym', `sym-${sym.role}`, sym.type].filter(Boolean).join(' ');
            const data = [sym.param && `data-param="${escapeXML(sym.param)}"`, sym.socket && `data-socket="${escapeXML(sym.socket)}"`, sym.title && `data-sym-title="${escapeXML(sym.title)}"`].filter(Boolean).join(' ');
            const body = ctx.values && sym.value !== undefined && sym.value !== null ? numberMathML(sym.value) : xml;
            return `<mrow class="${classes}"${data ? ` ${data}` : ''}>${body}</mrow>`;
        }
        case 'group':
            return renderNode(node.body, ctx);
        case 'member':
            return `<msub>${wrap(node.object, 9, ctx)}<mi>${escapeXML(node.field)}</mi></msub>`;
        case 'unary':
            return `<mrow>${mo(node.op === '-' ? '−' : node.op === '!' ? '¬' : '+')}${wrap(node.arg, 7, ctx)}</mrow>`;
        case 'ternary':
            return `<mrow>${mo('{')}<mtable><mtr><mtd>${renderNode(node.a, ctx)}</mtd><mtd><mtext>if </mtext>${renderNode(node.cond, ctx)}</mtd></mtr><mtr><mtd>${renderNode(node.b, ctx)}</mtd><mtd><mtext>otherwise</mtext></mtd></mtr></mtable></mrow>`;
        case 'binary':
            return renderBinary(node, ctx);
        case 'call':
            return renderCall(node, ctx);
    }
    throw new Error(`Cannot render ${node.type}`);
}
/** Render a child, adding parentheses when it binds more loosely than its context. */
function wrap(node, level, ctx, strict = false) {
    const p = precedence(node), xml = renderNode(node, ctx);
    return p < level || (strict && p === level) ? fenced('(', xml, ')') : xml;
}
function renderBinary(node, ctx) {
    const level = BINARY[node.op];
    if (node.op === '/') {
        return `<mfrac>${renderNode(node.left, ctx)}${renderNode(node.right, ctx)}</mfrac>`;
    }
    if (node.op === '^') {
        return `<msup>${wrap(node.left, 9, ctx)}${renderNode(node.right, ctx)}</msup>`;
    }
    const symbols = { '*': '·', '-': '−', '==': '=', '!=': '≠', '<=': '≤', '>=': '≥', '&&': '∧', '||': '∨', '%': 'mod' };
    const left = wrap(node.left, level, ctx), right = wrap(node.right, level, ctx, node.op === '-' || node.op === '%');
    if (node.op === '*' && node.left.type === 'num' && node.right.type !== 'num') {
        return `<mrow>${left}<mo>&#x2062;</mo>${right}</mrow>`; // 3θ, not 3·θ
    }
    return `<mrow>${left}${mo(symbols[node.op] || node.op)}${right}</mrow>`;
}
function renderCall(node, ctx) {
    const args = node.args.map(a => renderNode(a, ctx)), list = args.join(mo(','));
    switch (node.name) {
        case 'pow':
            if (args.length === 2) {
                return `<msup>${wrap(node.args[0], 9, ctx)}${args[1]}</msup>`;
            }
            break;
        case 'exp':
            if (args.length === 1) {
                return `<msup><mi mathvariant="normal">e</mi>${args[0]}</msup>`;
            }
            break;
        case 'sqrt':
            if (args.length === 1) {
                return `<msqrt>${args[0]}</msqrt>`;
            }
            break;
        case 'abs':
        case 'length':
            if (args.length === 1) {
                return fenced('|', args[0], '|');
            }
            break;
        case 'floor':
            if (args.length === 1) {
                return fenced('⌊', args[0], '⌋');
            }
            break;
        case 'mod':
            if (args.length === 2) {
                return `<mrow>${wrap(node.args[0], 6, ctx)}${mo('mod')}${wrap(node.args[1], 6, ctx, true)}</mrow>`;
            }
            break;
        case 'vec2':
        case 'vec3':
        case 'vec4':
            return fenced('(', list, ')');
    }
    const name = `<mi mathvariant="normal">${escapeXML(node.name)}</mi>`;
    if (PREFIX_FUNCTIONS.has(node.name) && node.args.length === 1 && precedence(node.args[0]) >= 9) {
        return `<mrow>${name}<mo>&#x2061;</mo>${args[0]}</mrow>`; // sin θ
    }
    return `<mrow>${name}<mo>&#x2061;</mo>${fenced('(', list, ')')}</mrow>`;
}
const context = ({ symbols = null, values = false } = {}) => ({ symbols: symbols ? new Map(Object.entries(symbols)) : null, values });
/** Render a custom GLSL expression as MathML, optionally with a left-hand side.
 * A multi-line equation renders its result line; see programToMathML.
 */
export function expressionToMathML(source, lhs = '', options = {}) {
    const text = String(source);
    const tree = /[\n;]|^\s*param\b/.test(text) ? parseProgram(text).result.expr : parseExpression(text);
    const body = renderNode(tree, context(options));
    return `<math display="block">${lhs ? `<mrow>${lhs}<mo>=</mo>${body}</mrow>` : body}</math>`;
}
/** Every line of a custom equation as typeset steps: definitions as `name = …`
 * and the result as `lhs = …`, each with its `//` caption. Parameters are listed
 * by the editor instead. Returns [{kind: 'define'|'result', name, mathml, text}].
 * Options: symbols (annotations by name) and values, as for texToMathML.
 */
export function programToMathML(source, lhs = '<mi>f</mi>', options = {}) {
    const program = parseProgram(source), ctx = context(options);
    const line = (left, expr) => `<math displaystyle="true"><mrow>${left}<mo>=</mo>${renderNode(expr, ctx)}</mrow></math>`;
    return [
        ...program.definitions.map(d => ({ kind: 'define', name: d.name, mathml: line(nameMathML(d.name), d.expr), text: d.comment })),
        { kind: 'result', name: null, mathml: line(lhs, program.result.expr), text: program.result.comment }
    ];
}
