import { EquationError, parseParamLine } from './expression.js';
/** Shader code: the language of the `code` component.
 *
 * Many famous one-line animations are written for twigl.app in its "geekest"
 * mode: the body of a GLSL ES 3.00 fragment shader that reads the pixel
 * position FC, the resolution r and the time t, and adds light to the output o.
 * This module reads that code so the studio can explain and explore it:
 *
 *   parse     tokens → a syntax tree of statements and expressions
 *   check     names, scopes and GLSL types, with errors in words and a line
 *   analyze   the loops (and how many steps each runs), the variables, the
 *             numbers, the helper functions used
 *   print     GLSL for the studio's program: every variable renamed and
 *             declared at the top (so any of them can be shown on the canvas),
 *             each loop counted (so it can be stopped after N steps), a safety
 *             budget on the total number of loop steps, and every number read
 *             from a uniform (so dragging a number never recompiles)
 *   format    the same code laid out one statement per line, for reading
 *
 * Like the equation language (expression.js), code is data: it is parsed,
 * checked and re-printed, never pasted into the shader. Pure: no DOM, no WebGL.
 *
 * The language is GLSL ES 3.00 statements and expressions (declarations, for,
 * while, do, if, break, continue, return, the comma and ?: operators, ++/--,
 * swizzles, constructors, the built-in functions) over float, int, bool,
 * vectors and square matrices, plus twigl's inputs and helpers:
 *
 *   FC  vec4  pixel position (gl_FragCoord): FC.xy in pixels, FC.z = 0.5, FC.w = 1
 *   r   vec2  resolution in pixels          t   float  time in seconds
 *   o   vec4  the output color, starting at 0
 *   m   vec2  mouse (fixed at the center)   f   float  frame number (60 per second)
 *   s   float sound level (always 0)        PI, PI2 constants
 *   hsv, rotate2D, rotate3D, snoise2D/3D/4D, fsnoise, … (twigl-glsl.js)
 *
 * Lines starting with `param` declare named sliders exactly as in equations.
 * Not supported, each with an explanation: function and struct definitions,
 * arrays, uint, textures and the previous frame b, the preprocessor, discard.
 */
export const CODE_LIMITS = { length: 12000, loops: 8, variables: 64, numbers: 160, params: 8, budget: 30000 };
/** Input names of twigl's geekest mode → {type, meaning, writable}. */
export const CODE_INPUTS = {
    FC: { type: 'vec4', meaning: 'pixel position: FC.xy in pixels from the bottom-left corner, FC.z = 0.5, FC.w = 1' },
    r: { type: 'vec2', meaning: 'resolution: the width and height of the image in pixels' },
    t: { type: 'float', meaning: 'time in seconds' },
    o: { type: 'vec4', meaning: 'the output color, 0 at the start; the code adds light to it', writable: true },
    m: { type: 'vec2', meaning: 'mouse position, 0 to 1 (fixed at the center here)' },
    f: { type: 'float', meaning: 'frame number, 60 frames per second' },
    s: { type: 'float', meaning: 'sound level (always 0 here)' },
    PI: { type: 'float', meaning: 'π = 3.14159…' },
    PI2: { type: 'float', meaning: '2π = 6.28318…' }
};
/** twigl helpers callable from code, with their signatures (see twigl-glsl.js). */
export const CODE_HELPERS = {
    hsv: [['vec3', 'float', 'float', 'float']],
    rotate2D: [['mat2', 'float']],
    rotate3D: [['mat3', 'float', 'vec3']],
    snoise2D: [['float', 'vec2']],
    snoise3D: [['float', 'vec3']],
    snoise4D: [['float', 'vec4']],
    fsnoise: [['float', 'vec2']],
    fsnoiseDigits: [['float', 'vec2']],
    mod289: [['float', 'float'], ['vec2', 'vec2'], ['vec3', 'vec3'], ['vec4', 'vec4']],
    permute: [['float', 'float'], ['vec3', 'vec3'], ['vec4', 'vec4']],
    taylorInvSqrt: [['float', 'float'], ['vec4', 'vec4']],
    grad4: [['vec4', 'float', 'vec4']]
};
/** What each helper does, in words (tooltips and the explanation). */
export const HELPER_HELP = {
    hsv: 'hsv(h, s, v): a color from hue h (0–1 around the color wheel), saturation s and brightness v',
    rotate2D: 'rotate2D(a): the 2×2 matrix of a rotation by a radians; v *= rotate2D(a) turns v by −a',
    rotate3D: 'rotate3D(a, axis): the 3×3 matrix of a rotation by a radians about the axis',
    snoise2D: 'snoise2D(p): smooth simplex noise in 2D, about −1 to 1',
    snoise3D: 'snoise3D(p): smooth simplex noise in 3D, about −1 to 1',
    snoise4D: 'snoise4D(p): smooth simplex noise in 4D, about −1 to 1',
    fsnoise: 'fsnoise(c): a pseudo-random number from 0 to 1 for the point c (a hash, not smooth)',
    fsnoiseDigits: 'fsnoiseDigits(c): like fsnoise with larger cells',
    mod289: 'mod289(x): x modulo 289, a step of the simplex noise',
    permute: 'permute(x): a pseudo-random permutation, a step of the simplex noise',
    taylorInvSqrt: 'taylorInvSqrt(r): a fast approximation of 1/√r, a step of the simplex noise',
    grad4: 'grad4(j, ip): a 4D gradient, a step of the simplex noise'
};
// ---- Types --------------------------------------------------------------------
const VECTOR = { vec2: ['float', 2], vec3: ['float', 3], vec4: ['float', 4], ivec2: ['int', 2], ivec3: ['int', 3], ivec4: ['int', 4], bvec2: ['bool', 2], bvec3: ['bool', 3], bvec4: ['bool', 4] };
const MATRIX = { mat2: 2, mat3: 3, mat4: 4 };
const TYPES = new Set(['float', 'int', 'bool', ...Object.keys(VECTOR), ...Object.keys(MATRIX)]);
const UNSUPPORTED_TYPES = new Set(['uint', 'uvec2', 'uvec3', 'uvec4', 'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4', 'void', 'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DShadow', 'isampler2D', 'usampler2D']);
const baseOf = t => VECTOR[t]?.[0] ?? (MATRIX[t] ? 'float' : t);
/** Number of components: 1 for scalars, n for vectors, n² for matrices. */
const componentsOf = t => VECTOR[t]?.[1] ?? (MATRIX[t] ? MATRIX[t] ** 2 : 1);
const isMatrix = t => Object.hasOwn(MATRIX, t);
const isVector = t => Object.hasOwn(VECTOR, t);
const isScalar = t => t === 'float' || t === 'int' || t === 'bool';
const vectorOf = (base, n) => n === 1 ? base : `${{ float: '', int: 'i', bool: 'b' }[base]}vec${n}`;
/** GLSL for the zero of a type, the value of a declared but unassigned variable. */
export function zeroOf(type) {
    if (type === 'float') {
        return '0.0';
    }
    if (type === 'int') {
        return '0';
    }
    if (type === 'bool') {
        return 'false';
    }
    return `${type}(${baseOf(type) === 'bool' ? 'false' : '0'})`;
}
const KEYWORDS = new Set(('attribute const uniform varying layout centroid flat smooth break continue do for while switch case default if else in out inout true false '
    + 'invariant discard return lowp mediump highp precision struct asm class union enum typedef template this goto inline noinline volatile public static extern external '
    + 'interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sampler3DRect filter image1D sizeof cast namespace using '
    + 'resource patch sample subroutine common partition active').split(' '));
// ---- Built-in functions ----------------------------------------------------------
const GEN_F = ['float', 'vec2', 'vec3', 'vec4'], GEN_I = ['int', 'ivec2', 'ivec3', 'ivec4'], GEN_B = ['bool', 'bvec2', 'bvec3', 'bvec4'];
/** Expand generic signatures: T float genType, I int genType, B bool genType,
 * V float vector (2–4), W int vector, X bool vector of the same size, M matrix.
 */
function expand(...signatures) {
    const out = [];
    for (const s of signatures) {
        const generic = s.find(p => /^[TIBVWXM]$/.test(p));
        if (!generic) {
            out.push(s);
            continue;
        }
        const sizes = generic === 'M' ? [2, 3, 4] : /[VWX]/.test(s.join('')) ? [2, 3, 4] : [1, 2, 3, 4];
        for (const n of sizes) {
            const map = { T: vectorOf('float', n), I: vectorOf('int', n), B: vectorOf('bool', n), V: vectorOf('float', n), W: vectorOf('int', n), X: vectorOf('bool', n), M: `mat${n}` };
            out.push(s.map(p => map[p] || p));
        }
    }
    return out;
}
const T1 = expand(['T', 'T']);
const BUILTINS = {
    radians: T1, degrees: T1, sin: T1, cos: T1, tan: T1, asin: T1, acos: T1, sinh: T1, cosh: T1, tanh: T1, asinh: T1, acosh: T1, atanh: T1,
    atan: expand(['T', 'T'], ['T', 'T', 'T']),
    pow: expand(['T', 'T', 'T']), exp: T1, log: T1, exp2: T1, log2: T1, sqrt: T1, inversesqrt: T1,
    abs: expand(['T', 'T'], ['I', 'I']), sign: expand(['T', 'T'], ['I', 'I']), floor: T1, trunc: T1, round: T1, roundEven: T1, ceil: T1, fract: T1,
    mod: expand(['T', 'T', 'T'], ['V', 'V', 'float']),
    min: expand(['T', 'T', 'T'], ['V', 'V', 'float'], ['I', 'I', 'I'], ['W', 'W', 'int']),
    max: expand(['T', 'T', 'T'], ['V', 'V', 'float'], ['I', 'I', 'I'], ['W', 'W', 'int']),
    clamp: expand(['T', 'T', 'T', 'T'], ['V', 'V', 'float', 'float'], ['I', 'I', 'I', 'I'], ['W', 'W', 'int', 'int']),
    mix: expand(['T', 'T', 'T', 'T'], ['V', 'V', 'V', 'float'], ['T', 'T', 'T', 'B']),
    step: expand(['T', 'T', 'T'], ['V', 'float', 'V']),
    smoothstep: expand(['T', 'T', 'T', 'T'], ['V', 'float', 'float', 'V']),
    isnan: expand(['B', 'T']), isinf: expand(['B', 'T']),
    length: expand(['float', 'T']), distance: expand(['float', 'T', 'T']), dot: expand(['float', 'T', 'T']), cross: [['vec3', 'vec3', 'vec3']],
    normalize: T1, faceforward: expand(['T', 'T', 'T', 'T']), reflect: expand(['T', 'T', 'T']), refract: expand(['T', 'T', 'T', 'float']),
    matrixCompMult: expand(['M', 'M', 'M']), transpose: expand(['M', 'M']), determinant: expand(['float', 'M']), inverse: expand(['M', 'M']),
    outerProduct: [['mat2', 'vec2', 'vec2'], ['mat3', 'vec3', 'vec3'], ['mat4', 'vec4', 'vec4']],
    lessThan: expand(['X', 'V', 'V'], ['X', 'W', 'W']), lessThanEqual: expand(['X', 'V', 'V'], ['X', 'W', 'W']),
    greaterThan: expand(['X', 'V', 'V'], ['X', 'W', 'W']), greaterThanEqual: expand(['X', 'V', 'V'], ['X', 'W', 'W']),
    equal: expand(['X', 'V', 'V'], ['X', 'W', 'W'], ['X', 'X', 'X']), notEqual: expand(['X', 'V', 'V'], ['X', 'W', 'W'], ['X', 'X', 'X']),
    any: expand(['bool', 'X']), all: expand(['bool', 'X']), not: expand(['X', 'X']),
    dFdx: T1, dFdy: T1, fwidth: T1,
    floatBitsToInt: expand(['I', 'T']), intBitsToFloat: expand(['T', 'I'])
};
const TEXTURE_FUNCTIONS = new Set(['texture', 'texture2D', 'textureLod', 'texelFetch', 'textureSize', 'textureGrad', 'textureProj', 'textureOffset']);
const FUNCTIONS = { ...BUILTINS, ...Object.fromEntries(Object.entries(CODE_HELPERS).map(([k, v]) => [k, v])) };
/** Every function code may call, for completion and hints. */
export function codeFunctionNames() {
    return Object.keys(FUNCTIONS);
}
// ---- Errors and positions -------------------------------------------------------
function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            starts.push(i + 1);
        }
    }
    return starts;
}
function positionOf(starts, offset) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) {
            lo = mid;
        }
        else {
            hi = mid - 1;
        }
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
}
// ---- Tokens ------------------------------------------------------------------------
const TOKEN = /(\s+)|(\/\/[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|((?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?[fF]?|\d+[eE][-+]?\d+[fF]?)|(0[xX][0-9a-fA-F]+[uU]?|\d+[uU]?)|([A-Za-z_]\w*)|(<<=|>>=|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|==|!=|<=|>=|&&|\|\||\^\^|<<|>>|[-+*/%<>=!~&|^?:;,.()[\]{}])/y;
/** Split code into tokens {kind: 'float'|'int'|'id'|'op', text, start, end}.
 * Comments are kept separately as {text, start, end} (they caption loops).
 */
function tokenize(text, starts) {
    const tokens = [], comments = [];
    const fail = (message, offset) => {
        const { line, column } = positionOf(starts, offset);
        throw new EquationError(message, line, column);
    };
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < text.length) {
        const at = TOKEN.lastIndex, m = TOKEN.exec(text);
        if (!m) {
            const c = text[at];
            if (c === '#') {
                fail('Preprocessor lines such as #define are not supported: write the value or expression directly.', at);
            }
            fail(`Unexpected character “${c}”.`, at);
        }
        if (m[1] !== undefined) {
            continue;
        }
        if (m[2] !== undefined || m[3] !== undefined) {
            if (m[3] !== undefined && !m[3].endsWith('*/')) {
                fail('This /* comment is never closed with */.', at);
            }
            comments.push({ text: (m[2] ?? m[3]).replace(/^\/\/|^\/\*|\*\/$/g, '').trim(), start: at, end: TOKEN.lastIndex });
            continue;
        }
        const kind = m[4] !== undefined ? 'float' : m[5] !== undefined ? 'int' : m[6] !== undefined ? 'id' : 'op';
        if (kind === 'int' && /[uU]$/.test(m[5])) {
            fail('Unsigned integers (1u) are not supported: use int or float.', at);
        }
        tokens.push({ kind, text: m[0], start: at, end: TOKEN.lastIndex });
    }
    tokens.push({ kind: 'end', text: '', start: text.length, end: text.length });
    return { tokens, comments };
}
// ---- Parser ------------------------------------------------------------------------
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
/** Binding strength of binary operators (GLSL order; higher binds tighter). */
const BINARY = { '||': 1, '^^': 2, '&&': 3, '|': 4, '^': 5, '&': 6, '==': 7, '!=': 7, '<': 8, '>': 8, '<=': 8, '>=': 8, '<<': 9, '>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11 };
const PRECISION = new Set(['lowp', 'mediump', 'highp']);
class Parser {
    constructor(tokens, starts) {
        this.tokens = tokens;
        this.starts = starts;
        this.k = 0;
    }
    peek(offset = 0) {
        return this.tokens[Math.min(this.k + offset, this.tokens.length - 1)];
    }
    next() {
        return this.tokens[Math.min(this.k++, this.tokens.length - 1)];
    }
    at(text) {
        const t = this.peek();
        return t.kind !== 'end' && t.text === text && (t.kind === 'op' || t.kind === 'id');
    }
    eat(text) {
        if (this.at(text)) {
            return this.next();
        }
        return null;
    }
    fail(message, token = this.peek()) {
        const { line, column } = positionOf(this.starts, token.start);
        throw new EquationError(message, line, column);
    }
    expect(text, why = '') {
        const t = this.peek();
        if (!this.at(text)) {
            this.fail(t.kind === 'end' ? `Unexpected end of the code: expected “${text}”${why}.` : `Expected “${text}”${why}, found “${t.text}”.`);
        }
        return this.next();
    }
    node(kind, token, fields) {
        return { kind, start: token.start, ...fields };
    }
    // Statements
    program() {
        const body = [];
        while (this.peek().kind !== 'end') {
            body.push(this.statement());
        }
        return body;
    }
    statement() {
        const t = this.peek();
        if (this.at('{')) {
            return this.block();
        }
        if (this.at(';')) {
            this.next();
            return this.node('empty', t);
        }
        if (t.kind === 'id') {
            switch (t.text) {
                case 'for': return this.forStatement();
                case 'while': {
                    this.next();
                    this.expect('(', ' after while');
                    const test = this.expression();
                    this.expect(')', ' to close the condition');
                    return this.node('while', t, { test, body: this.statement() });
                }
                case 'do': {
                    this.next();
                    const body = this.statement();
                    if (!this.eat('while')) {
                        this.fail('A do loop ends with while(condition);');
                    }
                    this.expect('(');
                    const test = this.expression();
                    this.expect(')');
                    this.expect(';');
                    return this.node('do', t, { test, body });
                }
                case 'if': {
                    this.next();
                    this.expect('(', ' after if');
                    const test = this.expression();
                    this.expect(')', ' to close the condition');
                    const then = this.statement(), otherwise = this.eat('else') ? this.statement() : null;
                    return this.node('if', t, { test, then, otherwise });
                }
                case 'break':
                case 'continue':
                    this.next();
                    this.expect(';');
                    return this.node(t.text, t);
                case 'return':
                    this.next();
                    if (!this.at(';')) {
                        this.fail('Write return; without a value: the color is whatever o holds.');
                    }
                    this.next();
                    return this.node('return', t);
                case 'discard': this.fail('discard is not supported: leave o unchanged (black) instead.');
                case 'switch': this.fail('switch is not supported: use if … else.');
                case 'struct': this.fail('struct definitions are not supported: use vectors.');
                default:
            }
        }
        if (this.declarationAhead()) {
            const d = this.declaration();
            this.expect(';', ' after the declaration');
            return d;
        }
        const expr = this.expression();
        if (this.at('(') || this.at('{')) {
            this.fail('Function definitions are not supported: write the code inline, or use a helper function.');
        }
        this.expect(';', ' at the end of the statement');
        return this.node('expr', t, { expr });
    }
    block() {
        const t = this.expect('{'), body = [];
        while (!this.at('}')) {
            if (this.peek().kind === 'end') {
                this.fail('Unexpected end of the code: a { is never closed with }.', t);
            }
            body.push(this.statement());
        }
        this.next();
        return this.node('block', t, { body });
    }
    declarationAhead() {
        const t = this.peek(), n = this.peek(1);
        if (t.kind !== 'id') {
            return false;
        }
        if (t.text === 'const' || PRECISION.has(t.text)) {
            return true;
        }
        if ((TYPES.has(t.text) || UNSUPPORTED_TYPES.has(t.text)) && (n.kind === 'id' || n.text === '[')) {
            return true;
        }
        return false;
    }
    declaration() {
        const t = this.peek(), constant = !!this.eat('const');
        if (PRECISION.has(this.peek().text)) {
            this.next();
        }
        const typeToken = this.next(), type = typeToken.text;
        if (UNSUPPORTED_TYPES.has(type)) {
            this.fail(type === 'void' ? 'Function definitions are not supported: write the code inline.' : `${type} is not supported: use float, int, bool, vectors or mat2–mat4.`, typeToken);
        }
        if (!TYPES.has(type)) {
            this.fail(`Expected a type such as float or vec3, found “${type}”.`, typeToken);
        }
        if (this.at('[')) {
            this.fail('Arrays are not supported: use vectors or separate variables.');
        }
        const vars = [];
        do {
            const name = this.next();
            if (name.kind !== 'id') {
                this.fail(`Expected a variable name after ${type}.`, name);
            }
            if (this.at('(')) {
                this.fail('Function definitions are not supported: write the code inline, or use a helper function.', name);
            }
            if (this.at('[')) {
                this.fail('Arrays are not supported: use vectors or separate variables.');
            }
            const init = this.eat('=') ? this.assignment() : null;
            vars.push({ name: name.text, start: name.start, init });
        } while (this.eat(','));
        return this.node('decl', t, { type, constant, vars });
    }
    forStatement() {
        const t = this.next();
        this.expect('(', ' after for');
        let init = null;
        if (!this.at(';')) {
            init = this.declarationAhead() ? this.declaration() : this.node('expr', this.peek(), { expr: this.expression() });
        }
        this.expect(';', ' after the start of the for loop');
        const test = this.at(';') ? null : this.expression();
        this.expect(';', ' after the condition of the for loop');
        const update = this.at(')') ? null : this.expression();
        this.expect(')', ' to close the for loop');
        return this.node('for', t, { init, test, update, body: this.statement() });
    }
    // Expressions, lowest precedence first
    expression() {
        const t = this.peek(), first = this.assignment();
        if (!this.at(',')) {
            return first;
        }
        const items = [first];
        while (this.eat(',')) {
            items.push(this.assignment());
        }
        return this.node('sequence', t, { items });
    }
    assignment() {
        const t = this.peek(), target = this.conditional();
        if (this.peek().kind === 'op' && ASSIGN.has(this.peek().text)) {
            const op = this.next().text;
            return this.node('assign', t, { op, target, value: this.assignment() });
        }
        return target;
    }
    conditional() {
        const t = this.peek(), test = this.binary(1);
        if (!this.eat('?')) {
            return test;
        }
        const then = this.expression();
        this.expect(':', ' in the ? : operator');
        return this.node('ternary', t, { test, then, otherwise: this.assignment() });
    }
    binary(level) {
        const t = this.peek();
        let left = this.unary();
        for (;;) {
            const op = this.peek();
            const strength = op.kind === 'op' ? BINARY[op.text] : undefined;
            if (!strength || strength < level) {
                return left;
            }
            this.next();
            left = this.node('binary', t, { op: op.text, left, right: this.binary(strength + 1) });
        }
    }
    unary() {
        const t = this.peek();
        if (t.kind === 'op' && ['+', '-', '!', '~'].includes(t.text)) {
            this.next();
            return this.node('unary', t, { op: t.text, arg: this.unary() });
        }
        if (t.kind === 'op' && (t.text === '++' || t.text === '--')) {
            this.next();
            return this.node('update', t, { op: t.text, prefix: true, arg: this.unary() });
        }
        return this.postfix();
    }
    postfix() {
        const t = this.peek();
        let e = this.primary();
        for (;;) {
            if (this.eat('.')) {
                const field = this.next();
                if (field.kind !== 'id') {
                    this.fail('Expected components after the dot, such as .x, .xy or .rgb.', field);
                }
                e = this.node('field', t, { object: e, field: field.text, fieldStart: field.start });
            }
            else if (this.eat('[')) {
                const index = this.expression();
                this.expect(']');
                e = this.node('index', t, { object: e, index });
            }
            else if (this.at('++') || this.at('--')) {
                e = this.node('update', t, { op: this.next().text, prefix: false, arg: e });
            }
            else {
                return e;
            }
        }
    }
    primary() {
        const t = this.next();
        if (t.kind === 'float') {
            return this.node('number', t, { text: t.text, value: Number(t.text.replace(/[fF]$/, '')), float: true, end: t.end });
        }
        if (t.kind === 'int') {
            return this.node('number', t, { text: t.text, value: Number(t.text), float: false, end: t.end });
        }
        if (t.kind === 'id') {
            if (t.text === 'true' || t.text === 'false') {
                return this.node('bool', t, { value: t.text === 'true' });
            }
            if (this.at('(')) {
                this.next();
                const args = [];
                if (!this.at(')')) {
                    do {
                        args.push(this.assignment());
                    } while (this.eat(','));
                }
                this.expect(')', ` to close the call of ${t.text}`);
                return this.node('call', t, { name: t.text, args, end: this.tokens[this.k - 1].end });
            }
            if (TYPES.has(t.text)) {
                this.fail(`${t.text} is a type: make a value with ${t.text}(…).`, t);
            }
            if (KEYWORDS.has(t.text) || UNSUPPORTED_TYPES.has(t.text)) {
                this.fail(`“${t.text}” cannot be used here.`, t);
            }
            return this.node('name', t, { name: t.text, end: t.end });
        }
        if (t.kind === 'op' && t.text === '(') {
            const e = this.expression();
            this.expect(')', ' to close the parenthesis');
            return e;
        }
        if (t.kind === 'end') {
            this.fail('Unexpected end of the code: an expression is missing.', t);
        }
        this.fail(`Unexpected “${t.text}”.`, t);
    }
}
// ---- Checking: names, scopes and types -------------------------------------------------
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Scope of names: a Map of name → binding and the enclosing scope. */
class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.names = new Map();
    }
    lookup(name) {
        for (let s = this; s; s = s.parent) {
            if (s.names.has(name)) {
                return s.names.get(name);
            }
        }
        return null;
    }
    visible() {
        const out = [];
        for (let s = this; s; s = s.parent) {
            out.push(...s.names.keys());
        }
        return out;
    }
}
function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) {
        d[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // a swapped pair of letters is one typo
            }
        }
    }
    return d[a.length][b.length];
}
function didYouMean(name, candidates) {
    let best = null, score = Infinity;
    for (const c of candidates) {
        const s = editDistance(name, c);
        if (s < score) {
            best = c;
            score = s;
        }
    }
    return best && score <= Math.max(1, Math.floor(name.length / 3)) ? ` Did you mean “${best}”?` : '';
}
const SWIZZLE_SETS = ['xyzw', 'rgba', 'stpq'];
class Checker {
    constructor(starts, params) {
        this.starts = starts;
        this.bindings = [];
        this.loops = [];
        this.numbers = [];
        this.helpers = new Set();
        this.inputsUsed = new Set();
        /** Where each name is used or declared: {start, end, binding} (for highlighting). */
        this.refs = [];
        this.loopStack = [];
        this.global = new Scope();
        for (const [name, spec] of Object.entries(CODE_INPUTS)) {
            this.global.names.set(name, { kind: 'input', name, type: spec.type, writable: !!spec.writable });
        }
        this.global.names.set('gl_FragCoord', this.global.names.get('FC'));
        this.params = new Scope(this.global);
        for (const p of params) {
            if (this.params.lookup(p.name) || KEYWORDS.has(p.name) || TYPES.has(p.name) || Object.hasOwn(FUNCTIONS, p.name) || p.name.startsWith('gl_') || p.name.includes('__')) {
                throw new EquationError(`The name ${p.name} is already taken: choose another parameter name.`, p.line);
            }
            this.params.names.set(p.name, { kind: 'param', name: p.name, type: p.kind === 'color' ? 'vec3' : 'float', writable: false, param: p });
        }
    }
    fail(message, node) {
        const { line, column } = positionOf(this.starts, node.start);
        throw new EquationError(message, line, column);
    }
    // Statements
    run(body) {
        const scope = new Scope(this.params);
        for (const s of body) {
            this.statement(s, scope);
        }
    }
    declare(scope, v, type, node, constant) {
        if (KEYWORDS.has(v.name) || TYPES.has(v.name) || UNSUPPORTED_TYPES.has(v.name)) {
            this.fail(`“${v.name}” is a reserved word of GLSL: choose another name.`, v);
        }
        if (v.name.startsWith('gl_') || v.name.includes('__')) {
            this.fail(`“${v.name}” is not a valid name: names may not start with gl_ or contain __.`, v);
        }
        if (v.name === 'FC') {
            this.fail('FC is the pixel position and cannot be declared again.', v);
        }
        if (scope.names.has(v.name)) {
            this.fail(`${v.name} is declared twice in the same block.`, v);
        }
        if (this.bindings.length >= CODE_LIMITS.variables) {
            this.fail(`At most ${CODE_LIMITS.variables} variables.`, v);
        }
        const loop = this.loopStack.at(-1) ?? null;
        const binding = { kind: 'variable', name: v.name, type, writable: !constant, id: this.bindings.length, start: v.start, loop: loop?.index ?? null, depth: this.loopStack.length };
        this.bindings.push(binding);
        this.refs.push({ start: v.start, end: v.start + v.name.length, binding, declaration: true });
        scope.names.set(v.name, binding);
        v.binding = binding;
        return binding;
    }
    statement(s, scope) {
        switch (s.kind) {
            case 'block': {
                const inner = new Scope(scope);
                for (const x of s.body) {
                    this.statement(x, inner);
                }
                return;
            }
            case 'decl':
                s.depth = this.loopStack.length;
                for (const v of s.vars) {
                    if (v.init) {
                        const type = this.expr(v.init, scope);
                        if (type !== s.type) {
                            this.fail(`Cannot set the ${s.type} ${v.name} to a ${type}.${this.conversionHint(s.type, type, v.init)}`, v.init);
                        }
                    }
                    else if (s.constant) {
                        this.fail(`The constant ${v.name} needs a value: const ${s.type} ${v.name} = …;`, v);
                    }
                    this.declare(scope, v, s.type, s, s.constant);
                }
                return;
            case 'expr':
                this.expr(s.expr, scope);
                return;
            case 'if':
                this.condition(s.test, scope, 'if');
                this.statement(s.then, new Scope(scope));
                if (s.otherwise) {
                    this.statement(s.otherwise, new Scope(scope));
                }
                return;
            case 'for':
            case 'while':
            case 'do': {
                if (this.loops.length >= CODE_LIMITS.loops) {
                    this.fail(`At most ${CODE_LIMITS.loops} loops.`, s);
                }
                const loop = { index: this.loops.length, node: s, kind: s.kind, depth: this.loopStack.length, parent: this.loopStack.at(-1)?.index ?? null, start: s.start };
                this.loops.push(loop);
                s.loop = loop;
                s.depth = this.loopStack.length;
                // GLSL ES 3.00: the loop body shares the scope of a for loop's declaration.
                const inner = new Scope(scope);
                if (s.kind === 'for' && s.init) {
                    this.statement(s.init, inner);
                }
                this.loopStack.push(loop);
                if (s.test) {
                    this.condition(s.test, inner, s.kind === 'for' ? 'for' : 'while');
                }
                else if (s.kind !== 'for') {
                    this.fail('A while loop needs a condition.', s);
                }
                if (s.update) {
                    this.expr(s.update, inner);
                }
                if (s.body.kind === 'block') {
                    for (const x of s.body.body) {
                        this.statement(x, inner);
                    }
                }
                else {
                    this.statement(s.body, inner);
                }
                this.loopStack.pop();
                return;
            }
            case 'break':
            case 'continue':
                if (!this.loopStack.length) {
                    this.fail(`${s.kind} can only be used inside a loop.`, s);
                }
                return;
            default:
        }
    }
    condition(e, scope, what) {
        const type = this.expr(e, scope);
        if (type !== 'bool') {
            this.fail(`The condition of ${what} must be true or false (a bool), but it is a ${type}. Compare it, for example ${what === 'if' ? 'x > 0.' : 'i++ < 100.'}`, e);
        }
    }
    conversionHint(want, got, e) {
        if (baseOf(want) === 'float' && baseOf(got) === 'int') {
            return e?.kind === 'number' ? ` GLSL does not turn whole numbers into floats: write ${e.text}. or ${e.text}.0.` : ' GLSL does not turn int into float by itself: write float(…).';
        }
        if (baseOf(want) === 'int' && baseOf(got) === 'float') {
            return ' Convert it with int(…).';
        }
        return '';
    }
    // Expressions: every node gets its type.
    expr(e, scope) {
        e.type = this.typeOf(e, scope);
        return e.type;
    }
    typeOf(e, scope) {
        switch (e.kind) {
            case 'number':
                if (e.float) {
                    if (this.numbers.length >= CODE_LIMITS.numbers) {
                        this.fail(`At most ${CODE_LIMITS.numbers} decimal numbers.`, e);
                    }
                    e.tweak = this.numbers.length;
                    this.numbers.push(e);
                }
                return e.float ? 'float' : 'int';
            case 'bool':
                return 'bool';
            case 'name': {
                const b = scope.lookup(e.name);
                if (!b) {
                    if (e.name === 'b') {
                        this.fail('b (the previous frame, twigl’s backbuffer) is not supported: each frame here is computed from the time alone.', e);
                    }
                    if (Object.hasOwn(FUNCTIONS, e.name) || TEXTURE_FUNCTIONS.has(e.name)) {
                        this.fail(`${e.name} is a function: call it, for example ${e.name}(x).`, e);
                    }
                    this.fail(`Unknown name “${e.name}”.${didYouMean(e.name, scope.visible())} Declare it first, for example float ${e.name};`, e);
                }
                e.binding = b;
                this.refs.push({ start: e.start, end: e.end, binding: b });
                if (b.kind === 'input') {
                    this.inputsUsed.add(b.name === 'gl_FragCoord' ? 'FC' : b.name);
                }
                return b.type;
            }
            case 'unary': {
                const t = this.expr(e.arg, scope);
                if (e.op === '!') {
                    if (t !== 'bool') {
                        this.fail(`! needs a condition (a bool), not a ${t}.`, e);
                    }
                    return t;
                }
                if (e.op === '~') {
                    if (baseOf(t) !== 'int') {
                        this.fail(`~ works on integers, not on a ${t}.`, e);
                    }
                    return t;
                }
                if (baseOf(t) === 'bool') {
                    this.fail(`${e.op} needs a number, not a ${t}.`, e);
                }
                return t;
            }
            case 'update': {
                const t = this.expr(e.arg, scope);
                this.lvalue(e.arg, `${e.op}`);
                if (baseOf(t) === 'bool') {
                    this.fail(`${e.op} needs a number, not a ${t}.`, e);
                }
                return t;
            }
            case 'binary':
                return this.binaryType(e.op, this.expr(e.left, scope), this.expr(e.right, scope), e);
            case 'assign': {
                const target = this.expr(e.target, scope), value = this.expr(e.value, scope);
                this.lvalue(e.target, e.op);
                if (e.op === '=') {
                    if (target !== value) {
                        this.fail(`Cannot assign a ${value} to a ${target}.${this.conversionHint(target, value, e.value)}`, e);
                    }
                    return target;
                }
                const result = this.binaryType(e.op.slice(0, -1), target, value, e);
                if (result !== target) {
                    this.fail(`${e.op} would turn the ${target} into a ${result}: the result must keep the type of the left side.`, e);
                }
                return target;
            }
            case 'ternary': {
                const test = this.expr(e.test, scope);
                if (test !== 'bool') {
                    this.fail(`The condition before “?” must be true or false (a bool), not a ${test}.`, e.test);
                }
                const a = this.expr(e.then, scope), b = this.expr(e.otherwise, scope);
                if (a !== b) {
                    this.fail(`Both results of ? : must have the same type, but they are a ${a} and a ${b}.`, e);
                }
                return a;
            }
            case 'sequence':
                return e.items.map(x => this.expr(x, scope)).at(-1);
            case 'field':
                return this.swizzle(e, this.expr(e.object, scope));
            case 'index': {
                const t = this.expr(e.object, scope), i = this.expr(e.index, scope);
                if (i !== 'int') {
                    this.fail(`An index must be an int, not a ${i}.`, e.index);
                }
                const size = isVector(t) ? VECTOR[t][1] : isMatrix(t) ? MATRIX[t] : 0;
                if (!size) {
                    this.fail(`Only vectors and matrices can be indexed with [ ], not a ${t}.`, e);
                }
                if (e.index.kind === 'number' && (e.index.value < 0 || e.index.value >= size)) {
                    this.fail(`Index ${e.index.value} is outside the ${t} (0 to ${size - 1}).`, e.index);
                }
                return isMatrix(t) ? vectorOf('float', size) : baseOf(t);
            }
            case 'call':
                return this.callType(e, scope);
            default:
                this.fail('Unsupported expression.', e);
        }
    }
    binaryType(op, a, b, e) {
        const describe = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' };
        if (['&&', '||', '^^'].includes(op)) {
            if (a !== 'bool' || b !== 'bool') {
                this.fail(`${op} joins two conditions (bool), not a ${a} and a ${b}.`, e);
            }
            return 'bool';
        }
        if (['<', '>', '<=', '>='].includes(op)) {
            if (a !== b || !(a === 'float' || a === 'int')) {
                this.fail(`${op} compares two numbers of the same type, not a ${a} and a ${b}.${a !== b ? this.conversionHint(a, b, e.right) : ' For vectors use lessThan(…) and friends.'}`, e);
            }
            return 'bool';
        }
        if (op === '==' || op === '!=') {
            if (a !== b) {
                this.fail(`${op} compares two values of the same type, not a ${a} and a ${b}.${this.conversionHint(a, b, e.right)}`, e);
            }
            return 'bool';
        }
        if (op === '%' || op === '<<' || op === '>>' || op === '&' || op === '|' || op === '^') {
            if (baseOf(a) !== 'int' || baseOf(b) !== 'int') {
                this.fail(op === '%' ? `% works on integers only: for a ${a} use mod(x, y).` : `${op} works on integers only, not a ${a} and a ${b}.`, e);
            }
            if (a !== b && !isScalar(a) && !isScalar(b)) {
                this.fail(`Cannot combine a ${a} and a ${b} with ${op}.`, e);
            }
            return isScalar(a) ? b : a;
        }
        // + - * /
        const verb = describe[op] || 'combine';
        if (baseOf(a) === 'bool' || baseOf(b) === 'bool') {
            this.fail(`Cannot ${verb} a ${a} and a ${b}: arithmetic needs numbers.`, e);
        }
        if (baseOf(a) !== baseOf(b)) {
            const side = baseOf(a) === 'int' ? e.left ?? e.target : e.right ?? e.value;
            this.fail(`Cannot ${verb} a ${a} and a ${b}.${side?.kind === 'number' ? ` GLSL does not turn whole numbers into floats: write ${side.text}. or ${side.text}.0.` : ' GLSL does not mix int and float: convert one with float(…) or int(…).'}`, e);
        }
        if (a === b) {
            return a;
        }
        if (isScalar(a)) {
            return b;
        }
        if (isScalar(b)) {
            return a;
        }
        if (op === '*') {
            if (isVector(a) && isMatrix(b) && VECTOR[a][1] === MATRIX[b]) {
                return a;
            }
            if (isMatrix(a) && isVector(b) && VECTOR[b][1] === MATRIX[a]) {
                return b;
            }
        }
        this.fail(`Cannot ${verb} a ${a} and a ${b}.`, e);
    }
    swizzle(e, t) {
        if (!isVector(t)) {
            this.fail(isScalar(t) ? `A ${t} has no components: .${e.field} works on vectors only.` : `.${e.field} is not a component of a ${t}.`, e);
        }
        const size = VECTOR[t][1], set = SWIZZLE_SETS.find(s => s.includes(e.field[0]));
        if (!set || e.field.length > 4 || [...e.field].some(c => !set.includes(c))) {
            this.fail(`.${e.field} is not a valid swizzle: use up to four of x y z w (or r g b a, or s t p q), from one set.`, e);
        }
        const beyond = [...e.field].find(c => set.indexOf(c) >= size);
        if (beyond) {
            this.fail(`.${beyond} is not a component of a ${t}, which has ${plural(size, 'component')}.`, e);
        }
        return vectorOf(baseOf(t), e.field.length);
    }
    lvalue(e, op) {
        if (e.kind === 'name') {
            if (!e.binding.writable) {
                const b = e.binding;
                this.fail(b.kind === 'input' ? `${b.name} is an input (${CODE_INPUTS[b.name === 'gl_FragCoord' ? 'FC' : b.name].meaning}) and cannot be changed. Copy it first: vec2 q = ${b.name === 'gl_FragCoord' ? 'FC.xy' : b.name};`
                    : b.kind === 'param' ? `${b.name} is a parameter (a slider) and cannot be changed. Copy it first: float x = ${b.name};` : `${b.name} is a constant and cannot be changed.`, e);
            }
            return;
        }
        if (e.kind === 'field') {
            if (new Set(e.field).size !== e.field.length) {
                this.fail(`Cannot assign to .${e.field}: a component appears twice.`, e);
            }
            return this.lvalue(e.object, op);
        }
        if (e.kind === 'index') {
            return this.lvalue(e.object, op);
        }
        this.fail(`${op} needs a variable (or its components) on the left, not a calculation.`, e);
    }
    callType(e, scope) {
        const args = e.args.map(a => this.expr(a, scope)), name = e.name;
        const shadow = scope.lookup(name);
        if (shadow) {
            this.fail(`${name} is a ${shadow.kind === 'variable' ? 'variable' : 'input'} here, not a function.`, e);
        }
        if (TYPES.has(name)) {
            return this.constructorType(e, name, args);
        }
        if (TEXTURE_FUNCTIONS.has(name)) {
            this.fail('Textures are not available: code computes each pixel from its position and the time.', e);
        }
        const signatures = FUNCTIONS[name];
        if (!signatures) {
            this.fail(`Unknown function “${name}”.${didYouMean(name, Object.keys(FUNCTIONS))}`, e);
        }
        const match = signatures.find(s => s.length - 1 === args.length && s.slice(1).every((p, i) => p === args[i]));
        if (!match) {
            const forms = [...new Set(signatures.map(s => `${name}(${s.slice(1).join(', ')})`))];
            const hint = e.args.some((a, i) => a.kind === 'number' && !a.float && signatures.some(s => s[i + 1] && baseOf(s[i + 1]) === 'float')) ? ' Write whole numbers with a decimal point (2. instead of 2).' : '';
            this.fail(`${name}(${args.join(', ')}) is not valid. It accepts ${forms.length > 6 ? `${forms.slice(0, 6).join(', ')}, …` : forms.join(', ')}.${hint}`, e);
        }
        if (Object.hasOwn(CODE_HELPERS, name)) {
            this.helpers.add(name);
        }
        return match[0];
    }
    constructorType(e, type, args) {
        if (!args.length) {
            this.fail(`${type}() needs values, for example ${type}(0).`, e);
        }
        if (args.some(a => isMatrix(a)) && !isMatrix(type)) {
            this.fail(`A ${type} cannot be made from a matrix.`, e);
        }
        if (isScalar(type)) {
            if (args.length !== 1) {
                this.fail(`${type}(…) takes one value.`, e);
            }
            return type;
        }
        if (isMatrix(type) && args.length === 1 && (isScalar(args[0]) || isMatrix(args[0]))) {
            return type;
        }
        if (!isMatrix(type) && args.length === 1 && isScalar(args[0])) {
            return type;
        }
        const need = componentsOf(type), have = args.reduce((n, a) => n + componentsOf(a), 0);
        const beforeLast = have - componentsOf(args.at(-1));
        if (have < need) {
            this.fail(`${type} needs ${need} components but gets ${have}.`, e);
        }
        if (beforeLast >= need || (isMatrix(type) && have !== need)) {
            this.fail(`${type} needs ${need} components but gets ${have}: too many values.`, e);
        }
        // Whole numbers inside a float constructor are converted by it: they can be tweaked like decimals.
        if (baseOf(type) === 'float') {
            for (const a of e.args) {
                if (a.kind === 'number' && !a.float && this.numbers.length < CODE_LIMITS.numbers) {
                    a.tweak = this.numbers.length;
                    this.numbers.push(a);
                }
            }
        }
        return type;
    }
}
// ---- Constant evaluation: how many steps each loop runs ------------------------------------
/** Scalar math the loop simulation understands (float32, like the GPU). */
const f32 = Math.fround;
const MATH = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, exp2: x => 2 ** x, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, fract: x => x - Math.floor(x), sign: Math.sign,
    min: Math.min, max: Math.max, pow: Math.pow, mod: (x, y) => x - y * Math.floor(x / y), clamp: (x, a, b) => Math.min(Math.max(x, a), b)
};
const rootBinding = e => e.kind === 'name' ? e.binding : e.kind === 'field' || e.kind === 'index' ? rootBinding(e.object) : null;
/** Bindings assigned anywhere inside a statement or expression. */
function assignedIn(node, out = new Set()) {
    if (!node || typeof node !== 'object') {
        return out;
    }
    if (Array.isArray(node)) {
        node.forEach(n => assignedIn(n, out));
        return out;
    }
    if (node.kind === 'assign' || node.kind === 'update') {
        const b = rootBinding(node.target ?? node.arg);
        if (b) {
            out.add(b);
        }
    }
    if (node.kind === 'decl') {
        node.vars.forEach(v => v.binding && out.add(v.binding));
    }
    for (const key of ['init', 'test', 'update', 'body', 'then', 'otherwise', 'expr', 'items', 'left', 'right', 'arg', 'target', 'value', 'object', 'index', 'args', 'vars']) {
        if (node[key]) {
            assignedIn(node[key], out);
        }
    }
    return out;
}
class Simulator {
    /** Evaluate a scalar expression in `env` (binding → number), applying its
     * assignments. Returns a number, or undefined when it cannot be known.
     */
    value(e, env) {
        const round = (type, x) => type === 'int' ? Math.trunc(x) : type === 'float' ? f32(x) : x;
        switch (e.kind) {
            case 'number': return e.float ? f32(e.value) : e.value;
            case 'bool': return e.value ? 1 : 0;
            case 'name': return e.binding.kind === 'param' ? undefined : e.binding.kind === 'input' ? (e.binding.name === 's' ? 0 : e.binding.name === 'PI' ? f32(Math.PI) : e.binding.name === 'PI2' ? f32(2 * Math.PI) : undefined) : env.get(e.binding);
            case 'unary': {
                const v = this.value(e.arg, env);
                return v === undefined ? undefined : e.op === '-' ? -v : e.op === '!' ? (v ? 0 : 1) : e.op === '+' ? v : undefined;
            }
            case 'update': {
                const b = e.arg.kind === 'name' ? e.arg.binding : null;
                if (!b || !isScalar(b.type) || env.get(b) === undefined) {
                    this.forget(e.arg, env);
                    return undefined;
                }
                const old = env.get(b), now = round(b.type, old + (e.op === '++' ? 1 : -1));
                env.set(b, now);
                return e.prefix ? now : old;
            }
            case 'binary': {
                if (e.op === '&&' || e.op === '||') {
                    const a = this.value(e.left, env);
                    if (a === undefined) {
                        this.forgetAll(e.right, env);
                        return undefined;
                    }
                    if (e.op === '&&' ? !a : a) {
                        return e.op === '&&' ? 0 : 1;
                    }
                    const b = this.value(e.right, env);
                    return b === undefined ? undefined : (b ? 1 : 0);
                }
                const a = this.value(e.left, env), b = this.value(e.right, env);
                if (a === undefined || b === undefined || !isScalar(e.left.type) || !isScalar(e.right.type)) {
                    return undefined;
                }
                const ops = { '+': a + b, '-': a - b, '*': a * b, '/': e.type === 'int' ? Math.trunc(a / b) : a / b, '<': +(a < b), '>': +(a > b), '<=': +(a <= b), '>=': +(a >= b), '==': +(a === b), '!=': +(a !== b), '%': a % b };
                return Object.hasOwn(ops, e.op) ? round(e.type, ops[e.op]) : undefined;
            }
            case 'assign': {
                const v = this.value(e.value, env);
                const b = e.target.kind === 'name' ? e.target.binding : null;
                if (!b || !isScalar(b.type)) {
                    this.forget(e.target, env);
                    return undefined;
                }
                if (v === undefined) {
                    env.set(b, undefined);
                    return undefined;
                }
                const old = env.get(b), op = e.op.slice(0, -1);
                if (e.op !== '=' && old === undefined) {
                    return undefined;
                }
                const now = round(b.type, e.op === '=' ? v : { '+': old + v, '-': old - v, '*': old * v, '/': b.type === 'int' ? Math.trunc(old / v) : old / v }[op]);
                env.set(b, now);
                return now;
            }
            case 'ternary': {
                const test = this.value(e.test, env);
                if (test === undefined) {
                    this.forgetAll(e.then, env);
                    this.forgetAll(e.otherwise, env);
                    return undefined;
                }
                return this.value(test ? e.then : e.otherwise, env);
            }
            case 'sequence': {
                let last;
                for (const x of e.items) {
                    last = this.value(x, env);
                }
                return last;
            }
            case 'call': {
                const args = e.args.map(a => this.value(a, env));
                if (args.some(a => a === undefined) || e.args.some(a => !isScalar(a.type))) {
                    return undefined;
                }
                if (e.name === 'float' || e.name === 'int') {
                    return round(e.name, args[0]);
                }
                return MATH[e.name] ? round(e.type, MATH[e.name](...args)) : undefined;
            }
            default:
                this.forgetAll(e, env);
                return undefined;
        }
    }
    forget(target, env) {
        const b = rootBinding(target);
        if (b) {
            env.set(b, undefined);
        }
    }
    forgetAll(node, env) {
        for (const b of assignedIn(node)) {
            env.set(b, undefined);
        }
    }
    /** Run statements in order, recording how many steps each loop takes. */
    run(statements, env) {
        for (const s of statements) {
            this.statement(s, env);
        }
    }
    statement(s, env) {
        switch (s.kind) {
            case 'expr':
                this.value(s.expr, env);
                return;
            case 'decl':
                for (const v of s.vars) {
                    env.set(v.binding, v.init ? this.value(v.init, env) : 0);
                }
                return;
            case 'block':
                this.run(s.body, env);
                return;
            case 'if': {
                const test = this.value(s.test, env);
                if (test === undefined) {
                    // Loops inside are still measured, with what is known before the if.
                    this.statement(s.then, new Map(env));
                    if (s.otherwise) {
                        this.statement(s.otherwise, new Map(env));
                    }
                    this.forgetAll([s.then, s.otherwise], env);
                }
                else if (test) {
                    this.statement(s.then, env);
                }
                else if (s.otherwise) {
                    this.statement(s.otherwise, env);
                }
                return;
            }
            case 'for':
            case 'while':
            case 'do':
                this.loop(s, env);
                return;
            default:
        }
    }
    loop(s, env) {
        const loop = s.loop, changing = assignedIn([s.test, s.update, s.body]);
        const entry = new Map(env);
        if (s.kind === 'for' && s.init) {
            this.statement(s.init, entry);
        }
        if (loop.steps === undefined) {
            loop.steps = this.count(s, new Map(entry));
            loop.exits = hasExit(s.body);
        }
        // Inner loops are measured with what every pass of this one starts from.
        const body = new Map(entry);
        for (const b of changing) {
            body.set(b, undefined);
        }
        if (s.test && s.kind !== 'do') {
            this.value(s.test, body);
        }
        this.statement(s.body, body);
        if (s.kind === 'for' && s.init) {
            this.forgetAll(s.init, env);
        }
        for (const b of changing) {
            env.set(b, undefined);
        }
    }
    /** Steps of one run of a loop, or null when unknown or beyond the budget. */
    count(s, env) {
        for (let n = 0; n <= CODE_LIMITS.budget; n++) {
            // A do loop runs its body once before the first test.
            if (s.kind !== 'do' || n > 0) {
                const go = s.test ? this.value(s.test, env) : undefined;
                if (go === undefined || Number.isNaN(go)) {
                    return null;
                }
                if (!go) {
                    return n;
                }
            }
            this.passBody(s.body, env);
            if (s.update) {
                this.value(s.update, env);
            }
        }
        return null;
    }
    /** The effect of one pass of a loop body on scalar variables. */
    passBody(s, env) {
        if (s.kind === 'expr') {
            this.value(s.expr, env);
        }
        else if (s.kind === 'decl') {
            this.statement(s, env);
        }
        else if (s.kind === 'block') {
            s.body.forEach(x => this.passBody(x, env));
        }
        else {
            this.forgetAll(s, env);
        }
    }
}
function hasExit(node) {
    if (!node || typeof node !== 'object') {
        return false;
    }
    if (node.kind === 'break' || node.kind === 'return') {
        return true;
    }
    if (node.kind === 'for' || node.kind === 'while' || node.kind === 'do') {
        return hasReturn(node.body);
    }
    return ['body', 'then', 'otherwise'].some(k => Array.isArray(node[k]) ? node[k].some(hasExit) : hasExit(node[k]));
}
function hasReturn(node) {
    if (!node || typeof node !== 'object') {
        return false;
    }
    if (node.kind === 'return') {
        return true;
    }
    return ['body', 'then', 'otherwise'].some(k => Array.isArray(node[k]) ? node[k].some(hasReturn) : hasReturn(node[k]));
}
// ---- Analysis: the public description of a piece of code ----------------------------------
/** Separate `param` lines (sliders, as in equations) from the GLSL. The lines keep
 * their place (blanked) so positions in errors stay right.
 */
function splitParams(source) {
    const params = [];
    const lines = source.split('\n').map((line, i) => {
        if (/^\s*param\s/.test(line)) {
            params.push(parseParamLine(line, i + 1));
            return ' '.repeat(line.length);
        }
        return line;
    });
    if (params.length > CODE_LIMITS.params) {
        throw new EquationError(`At most ${CODE_LIMITS.params} parameters.`);
    }
    return { params, code: lines.join('\n') };
}
/** A caption for a loop: a comment on its first line, or on the line just above it. */
function loopCaption(loop, comments, starts, source) {
    const { line } = positionOf(starts, loop.start);
    const onLine = comments.find(c => positionOf(starts, c.start).line === line && c.start > loop.start);
    if (onLine) {
        return onLine.text;
    }
    const above = comments.find(c => positionOf(starts, c.end - 1).line === line - 1);
    const lineText = source.split('\n')[line - 2] ?? '';
    return above && lineText.trim().startsWith('//') ? above.text : '';
}
/** What a loop is, in words, when it has no caption. */
function loopName(loop, loops) {
    const nested = loops.filter(l => l.parent === loop.index).length;
    if (loop.parent === null) {
        return nested ? 'outer loop' : 'loop';
    }
    return `inner loop (inside loop ${loop.parent + 1})`;
}
const analyses = new Map();
/** Parse, check and analyze code (cached). Throws EquationError with a line.
 * Returns {source, params, body, loops, variables, numbers, helpers, inputs}:
 *   params     [{name, kind, value, min, max, step, help}] from `param` lines
 *   loops      [{index, kind, depth, parent, line, steps, exits, caption, name}]
 *              steps: how many times the loop runs (null when it depends on
 *              the pixel or is beyond the budget); exits: it may stop early
 *   variables  [{id, name, type, line, loop}]: everything declared, in order
 *   numbers    [{index, text, value, start, end, line, column}]: the numbers
 *              that can be dragged (decimals, and whole numbers inside a float
 *              constructor such as vec4(0,1,2,3))
 *   helpers    twigl helper functions used
 *   inputs     inputs used (FC, r, t, o, …)
 */
export function analyzeCode(source) {
    const text = String(source ?? '');
    if (analyses.has(text)) {
        const hit = analyses.get(text);
        if (hit instanceof Error) {
            throw hit;
        }
        return hit;
    }
    let result;
    try {
        result = analyze(text);
    }
    catch (e) {
        result = e;
    }
    if (analyses.size > 100) {
        analyses.clear();
    }
    analyses.set(text, result);
    if (result instanceof Error) {
        throw result;
    }
    return result;
}
function analyze(original) {
    const text = original.replace(/\r\n?/g, '\n');
    if (!text.trim() || text.length > CODE_LIMITS.length) {
        throw new EquationError(`Code must contain 1–${CODE_LIMITS.length} characters.`);
    }
    const { params, code } = splitParams(text);
    const starts = lineStarts(code);
    const { tokens, comments } = tokenize(code, starts);
    const body = new Parser(tokens, starts).program();
    if (!body.length) {
        throw new EquationError('The code is empty: add light to the output, for example o += vec4(FC.xy/r, 0, 1);');
    }
    const checker = new Checker(starts, params);
    checker.run(body);
    // Number the draggable numbers in reading order.
    checker.numbers.sort((a, b) => a.start - b.start).forEach((n, k) => n.tweak = k);
    const simulator = new Simulator();
    simulator.run(body, new Map());
    const at = offset => positionOf(starts, offset);
    const loops = checker.loops.map(l => {
        const caption = loopCaption(l, comments, starts, code);
        return { index: l.index, kind: l.kind, depth: l.depth, parent: l.parent, line: at(l.start).line, steps: l.steps ?? null, exits: !!l.exits, caption, name: loopName(l, checker.loops) };
    });
    const variables = checker.bindings.map(b => ({ id: b.id, name: b.name, type: b.type, line: at(b.start).line, loop: b.loop }));
    const numbers = checker.numbers.map((n, index) => ({ index, text: n.text, value: n.value, float: n.float, start: n.start, end: n.end, ...at(n.start) }));
    // What each name refers to, for highlighting: a variable (its id), an input or a parameter.
    const refs = checker.refs.map(r => ({ start: r.start, end: r.end, kind: r.binding.kind, name: r.binding.kind === 'input' && r.binding.name === 'gl_FragCoord' ? 'FC' : r.binding.name, id: r.binding.id ?? null, declaration: !!r.declaration })).sort((a, b) => a.start - b.start);
    // Keep the checked tree private to the printer.
    return Object.freeze({ source: text, code, params, loops, variables, numbers, refs, comments: comments.map(c => ({ ...c, line: at(c.start).line })), helpers: [...checker.helpers], inputs: [...checker.inputsUsed], tree: body, bindings: checker.bindings, numberNodes: checker.numbers });
}
/** Parameter specs declared by `param` lines, like equationParams() of expression.js. */
export function codeParams(source) {
    return Object.fromEntries(analyzeCode(source).params.map(p => [p.name, p.kind === 'color'
        ? { kind: 'color', label: p.name, value: p.value, symbol: p.name, help: p.help || `Color parameter ${p.name} of this code.`, custom: true }
        : { kind: 'number', label: p.name, value: p.value, min: p.min, max: p.max, step: p.step, symbol: p.name, help: p.help || `Parameter ${p.name} of this code, from ${p.min} to ${p.max}.`, custom: true }]));
}
const structures = new WeakMap();
/** What decides the compiled program of some code: the code printed without its
 * comments, spacing and number values (numbers are uniforms), plus the names of
 * its parameters. Two sources with the same structure share one program, so
 * dragging a number or editing a comment never recompiles. With `inline` the
 * numbers are part of the program (compiled as constants), so they count too.
 */
export function codeStructure(source, inline = false) {
    const a = analyzeCode(source);
    if (!structures.has(a)) {
        structures.set(a, {});
    }
    const cache = structures.get(a), key = inline ? 'inline' : 'uniform';
    if (!cache[key]) {
        cache[key] = codeGLSL(a, 'f', { numbers: inline ? null : () => '#' }).code + '\n' + a.params.map(p => `${p.name}:${p.kind}`).join(',');
    }
    return cache[key];
}
/** The code with number `index` replaced by the text `text`. */
export function withNumber(source, index, text) {
    const a = analyzeCode(source), n = a.numbers[index];
    if (!n) {
        throw new Error(`The code has no number ${index}.`);
    }
    // Positions refer to the code with param lines blanked, which has the same length.
    return a.source.slice(0, n.start) + text + a.source.slice(n.end);
}
/** Text for a dragged number: as few digits as the step needs, a valid GLSL
 * float when the original was a decimal, and twigl's short style (.5 for 0.5)
 * when the original used it.
 */
export function numberText(value, step, original = '1.') {
    if (!/[.eE]/.test(original)) {
        return String(Math.round(value));
    }
    const digits = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step || 1e-3))));
    let s = value.toFixed(digits).replace(/(\.\d*?)0+$/, '$1');
    if (!s.includes('.')) {
        s += '.';
    }
    return /^-?\./.test(original) ? s.replace(/^(-?)0\./, '$1.') : s;
}
// ---- Printing ------------------------------------------------------------------------------
/** Precedence levels for printing with only the parentheses the meaning needs. */
const LEVEL = { sequence: 0, assign: 1, ternary: 2, unary: 16, update: 16, postfix: 17, primary: 18 };
const levelOf = e => {
    switch (e.kind) {
        case 'sequence': return LEVEL.sequence;
        case 'assign': return LEVEL.assign;
        case 'ternary': return LEVEL.ternary;
        case 'binary': return BINARY[e.op] + 2;
        case 'unary': return LEVEL.unary;
        case 'update': return e.prefix ? LEVEL.unary : LEVEL.postfix;
        case 'field': case 'index': case 'call': return LEVEL.postfix;
        default: return LEVEL.primary;
    }
};
/** Print an expression. `o.name(binding, e)` spells names, `o.number(e)` numbers,
 * `o.spaced` puts spaces around binary operators.
 */
function printExpr(e, o, min = 0) {
    const sub = (x, level) => printExpr(x, o, level);
    let s;
    switch (e.kind) {
        case 'number': s = o.number(e); break;
        case 'bool': s = String(e.value); break;
        case 'name': s = o.name(e.binding, e); break;
        case 'unary': {
            const arg = sub(e.arg, LEVEL.unary);
            s = e.op + ((e.op === '-' || e.op === '+') && /^[-+]/.test(arg) ? `(${arg})` : arg);
            break;
        }
        case 'update': s = e.prefix ? e.op + sub(e.arg, LEVEL.unary) : sub(e.arg, LEVEL.postfix) + e.op; break;
        case 'binary': {
            const p = BINARY[e.op] + 2, left = sub(e.left, p), right = sub(e.right, p + 1);
            const glue = o.spaced && !['*', '/', '%'].includes(e.op) ? ` ${e.op} ` : e.op;
            s = left + glue + (/[-+]$/.test(glue) && /^[-+]/.test(right) ? ' ' : '') + right;
            break;
        }
        case 'assign': s = `${sub(e.target, LEVEL.unary)}${o.spaced ? ` ${e.op} ` : e.op}${sub(e.value, LEVEL.assign)}`; break;
        case 'ternary': s = `${sub(e.test, LEVEL.ternary + 1)}${o.spaced ? ' ? ' : '?'}${sub(e.then, 0)}${o.spaced ? ' : ' : ':'}${sub(e.otherwise, LEVEL.assign)}`; break;
        case 'sequence': s = e.items.map(x => sub(x, LEVEL.assign)).join(o.spaced ? ', ' : ','); break;
        case 'field': s = `${sub(e.object, LEVEL.postfix)}.${e.field}`; break;
        case 'index': s = `${sub(e.object, LEVEL.postfix)}[${sub(e.index, 0)}]`; break;
        case 'call': s = `${o.call ? o.call(e) : e.name}(${e.args.map(a => sub(a, LEVEL.assign)).join(o.spaced ? ', ' : ',')})`; break;
        default: throw new Error(`Cannot print ${e.kind}.`);
    }
    return levelOf(e) < min ? `(${s})` : s;
}
/** Code laid out one statement per line with indentation, for reading. Comments
 * are not kept, so this is offered for code without them.
 */
export function formatCode(source, { indent = '  ' } = {}) {
    const a = analyzeCode(source), lines = [];
    const o = { spaced: true, number: e => e.text, name: b => b.name };
    const params = a.source.split('\n').filter(l => /^\s*param\s/.test(l));
    const decl = (s, withType = true) => `${withType ? `${s.constant ? 'const ' : ''}${s.type} ` : ''}${s.vars.map(v => v.name + (v.init ? ` = ${printExpr(v.init, o, LEVEL.assign)}` : '')).join(', ')}`;
    const head = s => s.kind === 'decl' ? decl(s) : printExpr(s.expr, o);
    const emit = (s, depth) => {
        const pad = indent.repeat(depth);
        const body = (b) => {
            if (b.kind === 'block') {
                b.body.forEach(x => emit(x, depth + 1));
            }
            else {
                emit(b, depth + 1);
            }
        };
        switch (s.kind) {
            case 'block':
                lines.push(`${pad}{`);
                s.body.forEach(x => emit(x, depth + 1));
                lines.push(`${pad}}`);
                return;
            case 'decl': lines.push(`${pad}${decl(s)};`); return;
            case 'expr': lines.push(`${pad}${printExpr(s.expr, o)};`); return;
            case 'empty': return;
            case 'for':
                lines.push(`${pad}for (${s.init ? head(s.init) : ''}; ${s.test ? printExpr(s.test, o) : ''}; ${s.update ? printExpr(s.update, o) : ''}) {`);
                body(s.body);
                lines.push(`${pad}}`);
                return;
            case 'while':
                lines.push(`${pad}while (${printExpr(s.test, o)}) {`);
                body(s.body);
                lines.push(`${pad}}`);
                return;
            case 'do':
                lines.push(`${pad}do {`);
                body(s.body);
                lines.push(`${pad}} while (${printExpr(s.test, o)});`);
                return;
            case 'if':
                lines.push(`${pad}if (${printExpr(s.test, o)}) {`);
                body(s.then);
                if (s.otherwise) {
                    lines.push(`${pad}} else {`);
                    body(s.otherwise);
                }
                lines.push(`${pad}}`);
                return;
            default: lines.push(`${pad}${s.kind};`);
        }
    };
    a.tree.forEach(s => emit(s, 0));
    return [...params.map(p => p.trim()), ...lines].join('\n');
}
/** Names in the generated GLSL: inputs i_FC…, variables v_name (numbered when a
 * name is declared twice), loop counters c_1…, parameters through their uniforms.
 */
function glslNames(a) {
    const taken = new Map(), names = new Map();
    for (const b of a.bindings) {
        const n = taken.get(b.name) || 0;
        taken.set(b.name, n + 1);
        names.set(b, n ? `v_${b.name}_${n + 1}` : `v_${b.name}`);
    }
    return binding => {
        if (binding.kind === 'input') {
            return binding.name === 'PI' || binding.name === 'PI2' ? binding.name : `i_${binding.name === 'gl_FragCoord' ? 'FC' : binding.name}`;
        }
        if (binding.kind === 'param') {
            return `k_${binding.name}`;
        }
        return names.get(binding);
    };
}
/** Which variables (and loop counters) `show` can put on the canvas, in the
 * order of the show index (1-based; 0 is the color o).
 */
export function showable(analysis) {
    const list = analysis.variables.filter(v => !isMatrix(v.type)).map(v => ({ kind: 'variable', id: v.id, name: v.name, type: v.type, line: v.line, loop: v.loop }));
    for (const l of analysis.loops) {
        list.push({ kind: 'steps', loop: l.index, name: `steps of loop ${l.index + 1}`, type: 'int', line: l.line });
    }
    return list;
}
/** The value type the canvas shows for a show index: the studio's socket type. */
export function showType(analysis, show) {
    if (!show) {
        return 'layer';
    }
    const item = showable(analysis)[show - 1];
    if (!item) {
        return 'layer';
    }
    return item.type === 'vec2' ? 'coord' : ['vec3', 'vec4', 'bvec3', 'bvec4', 'ivec3', 'ivec4'].includes(item.type) ? 'layer' : 'scalar';
}
function showValue(type, name) {
    if (isScalar(type)) {
        return `vec4(float(${name}),0,0,1)`;
    }
    const n = VECTOR[type][1], asFloat = baseOf(type) === 'float' ? name : `vec${n}(${name})`;
    return n === 2 ? `vec4(${asFloat},0,1)` : n === 3 ? `vec4(${asFloat},1)` : asFloat;
}
/** The code as a GLSL function of the studio's program:
 *
 *   vec4 name(vec2 p, float time, int show)
 *
 * p is the point in world coordinates (FC comes from it through codeFragCoord),
 * time the component's time, show which value to return (0: the color o;
 * k: the k-th entry of showable()). Options:
 *   numbers(index) → GLSL for tweakable number `index` (default: the literal)
 *   params(name)   → GLSL for parameter `name` (its uniform alias)
 *   caps(loop)     → GLSL int expression limiting the steps of a loop, or null
 *   budget         total loop steps per pixel before every loop stops
 * Returns {code, lines}: `lines[k]` is the source line of generated line k
 * (null for lines of the frame), to point GPU compiler errors at the code.
 */
export function codeGLSL(analysis, functionName, options = {}) {
    const { numbers = null, params = name => name, caps = () => null, budget = CODE_LIMITS.budget } = options;
    const starts = lineStarts(analysis.code), lineOf = node => positionOf(starts, node.start).line;
    const nameOf = glslNames(analysis);
    const o = {
        spaced: false,
        number: e => numbers && e.tweak !== undefined ? numbers(e.tweak) : glslLiteral(e),
        name: b => nameOf(b)
    };
    const out = [], lines = [];
    const push = (text, line = null) => {
        out.push(text);
        lines.push(line);
    };
    const show = showable(analysis);
    const finish = [...show.map((item, k) => `if(show==${k + 1})return ${showValue(item.type, item.kind === 'steps' ? `c_${item.loop + 1}` : nameOf(analysis.bindings[item.id]))};`), 'return codeColor(i_o);'].join('');
    const assignments = (s, fresh) => s.vars.filter(v => v.init || fresh).map(v => `${nameOf(v.binding)}=${v.init ? printExpr(v.init, o, LEVEL.assign) : zeroOf(s.type)};`).join('');
    const guard = (s, test) => {
        const cap = caps(s.loop.index), parts = [];
        if (test) {
            parts.push(printExpr(test, o, BINARY['&&'] + 3));
        }
        if (cap) {
            parts.push(`c_${s.loop.index + 1}++<${cap}`);
        }
        else {
            parts.push(`c_${s.loop.index + 1}++>=0`);
        }
        parts.push('--c_budget>=0');
        return parts.join('&&');
    };
    const emit = (s, depth) => {
        const pad = ' '.repeat(depth + 1), line = lineOf(s);
        const inner = b => b.kind === 'block' ? b.body.forEach(x => emit(x, depth + 1)) : emit(b, depth + 1);
        switch (s.kind) {
            case 'block':
                push(`${pad}{`, line);
                s.body.forEach(x => emit(x, depth + 1));
                push(`${pad}}`, line);
                return;
            case 'decl': {
                // Declarations are hoisted to the top; here they become assignments.
                // Inside a loop, a declaration without a value starts again at zero.
                const text = assignments(s, s.depth > 0);
                if (text) {
                    push(pad + text, line);
                }
                return;
            }
            case 'expr':
                push(`${pad}${printExpr(s.expr, o)};`, line);
                return;
            case 'empty':
                return;
            case 'for': {
                const init = !s.init ? '' : s.init.kind === 'decl' ? assignments(s.init, s.depth > 0) : `${printExpr(s.init.expr, o)};`;
                push(`${pad}{c_${s.loop.index + 1}=0;${init}for(;${guard(s, s.test)};${s.update ? printExpr(s.update, o) : ''}){`, line);
                inner(s.body);
                push(`${pad}}}`, line);
                return;
            }
            case 'while':
                push(`${pad}{c_${s.loop.index + 1}=0;while(${guard(s, s.test)}){`, line);
                inner(s.body);
                push(`${pad}}}`, line);
                return;
            case 'do':
                push(`${pad}{c_${s.loop.index + 1}=0;do{`, line);
                inner(s.body);
                push(`${pad}}while(${guard(s, s.test)});}`, line);
                return;
            case 'if':
                push(`${pad}if(${printExpr(s.test, o)}){`, line);
                inner(s.then);
                if (s.otherwise) {
                    push(`${pad}}else{`, line);
                    inner(s.otherwise);
                }
                push(`${pad}}`, line);
                return;
            case 'break':
            case 'continue':
                push(`${pad}${s.kind};`, line);
                return;
            case 'return':
                push(`${pad}{${finish}}`, line);
                return;
            default:
                throw new Error(`Cannot print ${s.kind}.`);
        }
    };
    const inputs = new Set(analysis.inputs);
    const prologue = [];
    if (inputs.has('FC')) {
        prologue.push('vec4 i_FC=vec4(codeFragCoord(p),0.5,1.0);');
    }
    if (inputs.has('r')) {
        prologue.push('vec2 i_r=u_frame;');
    }
    if (inputs.has('t')) {
        prologue.push('float i_t=time;');
    }
    prologue.push('vec4 i_o=vec4(0);');
    if (inputs.has('m')) {
        prologue.push('vec2 i_m=vec2(0.5);');
    }
    if (inputs.has('f')) {
        prologue.push('float i_f=floor(time*60.0);');
    }
    if (inputs.has('s')) {
        prologue.push('float i_s=0.0;');
    }
    for (const p of analysis.params) {
        prologue.push(`${p.kind === 'color' ? 'vec3' : 'float'} k_${p.name}=${params(p.name)};`);
    }
    for (const b of analysis.bindings) {
        prologue.push(`${b.type} ${nameOf(b)}=${zeroOf(b.type)};`);
    }
    prologue.push(analysis.loops.map(l => `int c_${l.index + 1}=0;`).join('') + `int c_budget=${Math.max(1, Math.round(budget))};`);
    push(`vec4 ${functionName}(vec2 p,float time,int show){`);
    push(` ${prologue.join('')}`);
    analysis.tree.forEach(s => emit(s, 0));
    push(` ${finish}`);
    push('}');
    return { code: out.join('\n'), lines };
}
/** A number as GLSL: whole numbers keep their type, decimals are valid floats. */
function glslLiteral(e) {
    return e.text.replace(/[fF]$/, '');
}
