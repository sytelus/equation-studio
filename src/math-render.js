/** Typeset equations as native MathML, with no fonts, scripts or network access.
 *
 * texToMathML() converts the small TeX subset used by the component catalog:
 * letters, numbers, operators, groups, ^ and _, \frac, \sqrt, \text, \mathrm,
 * \operatorname, \mathbf, accents, \left/\right, big operators (\sum, \prod),
 * Greek letters, common functions, relations and spacing commands. Unknown
 * commands throw, so the unit tests catch catalog typos.
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
const LARGE = { sum: '∑', prod: '∏' };
const SPACES = { quad: '1em', qquad: '2em', ',': '0.167em', ';': '0.278em', ':': '0.222em', ' ': '0.25em', '!': '0em' };
const ACCENTS = { hat: '^', bar: '¯', tilde: '~', vec: '→', dot: '˙' };
const IGNORED = new Set(['left', 'right', 'big', 'bigl', 'bigr', 'Big', 'Bigl', 'Bigr', 'displaystyle']);
const OPERATOR_CHARS = { '-': '−', '*': '∗', "'": '′' };
class TexParser {
    constructor(source) {
        this.s = source;
        this.i = 0;
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
    list() {
        const items = [];
        while (this.peek() !== undefined && this.peek() !== '}') {
            items.push(this.scripted());
        }
        return items.join('');
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
    scripted() {
        const base = this.atom();
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
        if (sub === null && sup === null) {
            return base.xml;
        }
        const [both, under, over] = base.large ? ['munderover', 'munder', 'mover'] : ['msubsup', 'msub', 'msup'];
        if (sub !== null && sup !== null) {
            return `<${both}>${base.xml}${sub}${sup}</${both}>`;
        }
        return sub !== null ? `<${under}>${base.xml}${sub}</${under}>` : `<${over}>${base.xml}${sup}</${over}>`;
    }
    atom() {
        const c = this.peek();
        if (c === undefined) {
            throw this.error('Unexpected end');
        }
        if (c === '{') {
            return { xml: this.group() };
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
            return { xml: `<mn>${number[0]}</mn>` };
        }
        this.i++;
        if (/[A-Za-z]/.test(c)) {
            return { xml: `<mi>${c}</mi>` };
        }
        return { xml: `<mo>${escapeXML(OPERATOR_CHARS[c] || c)}</mo>` };
    }
    commandAtom(name) {
        if (IGNORED.has(name)) {
            return this.peek() === '.' ? (this.i++, { xml: '' }) : this.atom();
        }
        if (name === 'frac' || name === 'tfrac' || name === 'dfrac') {
            const top = this.argument(), bottom = this.argument();
            return { xml: `<mfrac>${top}${bottom}</mfrac>` };
        }
        if (name === 'sqrt') {
            return { xml: `<msqrt>${this.argument()}</msqrt>` };
        }
        if (name === 'text') {
            return { xml: `<mtext>${escapeXML(this.rawGroup())}</mtext>` };
        }
        if (name === 'mathrm' || name === 'operatorname') {
            return { xml: `<mi mathvariant="normal">${escapeXML(this.rawGroup())}</mi>` };
        }
        if (name === 'mathbf' || name === 'boldsymbol') {
            return { xml: `<mrow class="bold">${this.argument()}</mrow>` };
        }
        if (Object.hasOwn(ACCENTS, name)) {
            return { xml: `<mover accent="true">${this.argument()}<mo>${ACCENTS[name]}</mo></mover>` };
        }
        if (Object.hasOwn(GREEK, name)) {
            return { xml: `<mi>${GREEK[name]}</mi>` };
        }
        if (FUNCTIONS.has(name)) {
            return { xml: `<mi mathvariant="normal">${name}</mi>` };
        }
        if (Object.hasOwn(LARGE, name)) {
            return { xml: `<mo largeop="true" movablelimits="false">${LARGE[name]}</mo>`, large: true };
        }
        if (Object.hasOwn(OPERATORS, name)) {
            return { xml: `<mo>${escapeXML(OPERATORS[name])}</mo>` };
        }
        if (Object.hasOwn(SPACES, name)) {
            return { xml: `<mspace width="${SPACES[name]}"></mspace>` };
        }
        throw this.error(`Unsupported TeX command \\${name}`);
    }
}
/** Convert one line of TeX to a MathML string. Throws on unsupported input. */
export function texToMathML(tex, { display = true } = {}) {
    const parser = new TexParser(String(tex));
    const body = parser.list();
    if (parser.peek() !== undefined) {
        throw parser.error('Unbalanced }');
    }
    return `<math${display ? ' display="block"' : ''}>${body}</math>`;
}
// ---- GLSL expressions -----------------------------------------------------------
const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_]\w*)|(<=|>=|==|!=|&&|\|\||[-+*/%(),?:.<>!]))/y;
function tokenize(source) {
    const tokens = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < source.length) {
        if (/^\s*$/.test(source.slice(TOKEN.lastIndex))) {
            break;
        }
        const at = TOKEN.lastIndex, m = TOKEN.exec(source);
        if (!m) {
            throw new Error(`Unexpected character “${source[at]}” at position ${at}`);
        }
        tokens.push(m[1] !== undefined ? { kind: 'num', value: m[1] } : m[2] !== undefined ? { kind: 'id', value: m[2] } : { kind: 'op', value: m[3] });
    }
    return tokens;
}
const BINARY = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
/** Parse a custom expression into a small AST. Throws on syntax errors. */
export function parseExpression(source) {
    const tokens = tokenize(String(source));
    let k = 0;
    const peek = () => tokens[k], take = () => tokens[k++];
    const expect = value => {
        const t = take();
        if (!t || t.value !== value) {
            throw new Error(`Expected “${value}”${t ? ` but found “${t.value}”` : ' at the end'}`);
        }
    };
    function primary() {
        const t = take();
        if (!t) {
            throw new Error('Unexpected end of expression');
        }
        let node;
        if (t.kind === 'num') {
            node = { type: 'num', value: t.value };
        }
        else if (t.kind === 'id') {
            if (peek()?.value === '(') {
                take();
                const args = [];
                if (peek()?.value !== ')') {
                    do {
                        args.push(ternary());
                    } while (peek()?.value === ',' && take());
                }
                expect(')');
                node = { type: 'call', name: t.value, args };
            }
            else {
                node = { type: 'id', name: t.value };
            }
        }
        else if (t.value === '(') {
            node = { type: 'group', body: ternary() };
            expect(')');
        }
        else if (t.value === '-' || t.value === '+' || t.value === '!') {
            return { type: 'unary', op: t.value, arg: unaryOperand() };
        }
        else {
            throw new Error(`Unexpected “${t.value}”`);
        }
        while (peek()?.value === '.') {
            take();
            const field = take();
            if (!field || field.kind !== 'id') {
                throw new Error('Expected a component name after “.”');
            }
            node = { type: 'member', object: node, field: field.value };
        }
        return node;
    }
    function unaryOperand() {
        return primary();
    }
    function binary(level) {
        let left = primary();
        for (;;) {
            const t = peek();
            if (!t || t.kind !== 'op' || !Object.hasOwn(BINARY, t.value) || BINARY[t.value] < level) {
                return left;
            }
            take();
            left = { type: 'binary', op: t.value, left, right: binary(BINARY[t.value] + 1) };
        }
    }
    function ternary() {
        const cond = binary(1);
        if (peek()?.value !== '?') {
            return cond;
        }
        take();
        const a = ternary();
        expect(':');
        return { type: 'ternary', cond, a, b: ternary() };
    }
    const tree = ternary();
    if (k < tokens.length) {
        throw new Error(`Unexpected “${tokens[k].value}”`);
    }
    return tree;
}
const IDENTIFIERS = { theta: 'θ', PI: 'π', TAU: 'τ' };
const PREFIX_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'tanh', 'log', 'atan', 'asin', 'acos']);
const mo = s => `<mo>${escapeXML(s)}</mo>`;
const fenced = (open, body, close) => `<mrow>${mo(open)}${body}${mo(close)}</mrow>`;
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
function renderNode(node) {
    switch (node.type) {
        case 'num': {
            const n = Number(node.value);
            return `<mn>${Number.isFinite(n) && Math.abs(n) < 1e7 && !/[eE]/.test(node.value) ? String(n) : escapeXML(node.value)}</mn>`;
        }
        case 'id':
            return Object.hasOwn(IDENTIFIERS, node.name) ? `<mi>${IDENTIFIERS[node.name]}</mi>` : node.name.length === 1 ? `<mi>${node.name}</mi>` : `<mi mathvariant="normal">${escapeXML(node.name)}</mi>`;
        case 'group':
            return renderNode(node.body);
        case 'member':
            return `<msub>${wrap(node.object, 9)}<mi>${escapeXML(node.field)}</mi></msub>`;
        case 'unary':
            return `<mrow>${mo(node.op === '-' ? '−' : node.op === '!' ? '¬' : '+')}${wrap(node.arg, 7)}</mrow>`;
        case 'ternary':
            return `<mrow>${mo('{')}<mtable><mtr><mtd>${renderNode(node.a)}</mtd><mtd><mtext>if </mtext>${renderNode(node.cond)}</mtd></mtr><mtr><mtd>${renderNode(node.b)}</mtd><mtd><mtext>otherwise</mtext></mtd></mtr></mtable></mrow>`;
        case 'binary':
            return renderBinary(node);
        case 'call':
            return renderCall(node);
    }
    throw new Error(`Cannot render ${node.type}`);
}
/** Render a child, adding parentheses when it binds more loosely than its context. */
function wrap(node, level, strict = false) {
    const p = precedence(node), xml = renderNode(node);
    return p < level || (strict && p === level) ? fenced('(', xml, ')') : xml;
}
function renderBinary(node) {
    const level = BINARY[node.op];
    if (node.op === '/') {
        return `<mfrac>${renderNode(node.left)}${renderNode(node.right)}</mfrac>`;
    }
    const symbols = { '*': '·', '-': '−', '==': '=', '!=': '≠', '<=': '≤', '>=': '≥', '&&': '∧', '||': '∨', '%': 'mod' };
    const left = wrap(node.left, level), right = wrap(node.right, level, node.op === '-' || node.op === '%');
    if (node.op === '*' && node.left.type === 'num' && node.right.type !== 'num') {
        return `<mrow>${left}<mo>&#x2062;</mo>${right}</mrow>`; // 3θ, not 3·θ
    }
    return `<mrow>${left}${mo(symbols[node.op] || node.op)}${right}</mrow>`;
}
function renderCall(node) {
    const args = node.args.map(renderNode), list = args.join(mo(','));
    switch (node.name) {
        case 'pow':
            if (args.length === 2) {
                return `<msup>${wrap(node.args[0], 9)}${args[1]}</msup>`;
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
                return `<mrow>${wrap(node.args[0], 6)}${mo('mod')}${wrap(node.args[1], 6, true)}</mrow>`;
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
/** Render a custom GLSL expression as MathML, optionally with a left-hand side. */
export function expressionToMathML(source, lhs = '') {
    const body = renderNode(parseExpression(source));
    return `<math display="block">${lhs ? `<mrow>${lhs}<mo>=</mo>${body}</mrow>` : body}</math>`;
}
