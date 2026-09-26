import { mathGLSL } from './math-glsl.js';
import { nebulaGLSL } from './nebula-glsl.js';
import { motifsGLSL } from './motifs-glsl.js';
/** The custom equation language: GLSL-style expressions, written like math.
 *
 * A custom equation is a small program, one statement per line (or separated
 * by `;`), with an optional `// caption` on each line:
 *
 *   param radius = 1 [0.1, 3]   // a named slider: default and range
 *   param tint = #62edc3        // a color parameter
 *   d = length(p) - radius      // a definition, usable on later lines
 *   exp(-(d / 0.1)^2)           // the last line is the result
 *
 * Names available: p = (x, y), r and theta (polar coordinates of p), the inputs
 * a and b, the time t, PI and TAU, the parameters and earlier definitions, the
 * GLSL built-in functions and every function of the shader libraries (fbm,
 * rotate2, gaussian, waterPlanet, …). Whole numbers may be written without a
 * decimal point; `^` is a power (x^2 = x·x, safe for negative x); `%` is mod.
 *
 * The program is parsed, type-checked (float, vec2, vec3, vec4, bool) with
 * readable error messages, and printed back as GLSL by this module, so no user
 * text is ever pasted into the shader. Pure: no DOM, no WebGL.
 */
export const LIMITS = { length: 3000, params: 8, definitions: 24, name: 24 };
export const RESULT_TYPES = { expression: ['float'], vectorExpression: ['vec2'], colorExpression: ['vec3', 'vec4'] };
/** A language error with the 1-based line (and character) where it was found. */
export class EquationError extends Error {
    constructor(message, line = null, column = null) {
        super(line ? `Line ${line}: ${message}` : message);
        this.name = 'EquationError';
        this.line = line;
        this.column = column;
        this.plain = message;
    }
}
// ---- Names --------------------------------------------------------------------
const LOCALS = { p: 'vec2', x: 'float', y: 'float', r: 'float', theta: 'float', a: 'float', b: 'float', t: 'float' };
const CONSTANTS = { PI: 'float', TAU: 'float' };
const RESERVED = new Set(('attribute const uniform varying layout centroid flat smooth break continue do for while switch case default if else in out inout float int void bool true false '
    + 'invariant discard return mat2 mat3 mat4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube struct '
    + 'param Geometry u_time main shade evaluate present outputColor').split(/\s+/));
const GEN = ['float', 'vec2', 'vec3', 'vec4'];
const SIZE = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
const vecOf = n => ['float', 'float', 'vec2', 'vec3', 'vec4'][n];
/** Built-in GLSL functions: name → checker(argument types) → result type or throws. */
const same = (args, n) => {
    if (args.length !== n || !GEN.includes(args[0]) || args.some(t => t !== args[0])) {
        return null;
    }
    return args[0];
};
const gen1 = args => same(args, 1);
const BUILTINS = {
    abs: gen1, sign: gen1, floor: gen1, ceil: gen1, fract: gen1, round: gen1, trunc: gen1, sqrt: gen1, inversesqrt: gen1, exp: gen1, log: gen1, exp2: gen1, log2: gen1,
    sin: gen1, cos: gen1, tan: gen1, asin: gen1, acos: gen1, sinh: gen1, cosh: gen1, tanh: gen1, asinh: gen1, acosh: gen1, atanh: gen1, radians: gen1, degrees: gen1, normalize: gen1,
    atan: args => args.length === 1 ? gen1(args) : same(args, 2),
    pow: args => same(args, 2),
    mod: args => same(args, 2) || (args.length === 2 && GEN.includes(args[0]) && args[1] === 'float' ? args[0] : null),
    min: args => same(args, 2) || (args.length === 2 && GEN.includes(args[0]) && args[1] === 'float' ? args[0] : null),
    max: args => same(args, 2) || (args.length === 2 && GEN.includes(args[0]) && args[1] === 'float' ? args[0] : null),
    clamp: args => same(args, 3) || (args.length === 3 && GEN.includes(args[0]) && args[1] === 'float' && args[2] === 'float' ? args[0] : null),
    mix: args => same(args, 3) || (args.length === 3 && GEN.includes(args[0]) && args[1] === args[0] && args[2] === 'float' ? args[0] : null),
    step: args => same(args, 2) || (args.length === 2 && args[0] === 'float' && GEN.includes(args[1]) ? args[1] : null),
    smoothstep: args => same(args, 3) || (args.length === 3 && args[0] === 'float' && args[1] === 'float' && GEN.includes(args[2]) ? args[2] : null),
    length: args => args.length === 1 && GEN.includes(args[0]) ? 'float' : null,
    distance: args => same(args, 2) ? 'float' : null,
    dot: args => same(args, 2) ? 'float' : null,
    reflect: args => same(args, 2),
    cross: args => args.length === 2 && args[0] === 'vec3' && args[1] === 'vec3' ? 'vec3' : null
};
const BUILTIN_HINTS = {
    atan: 'atan(y, x) or atan(v)', pow: 'pow(x, y) with the same types', mod: 'mod(x, y)', min: 'min(x, y)', max: 'max(x, y)', clamp: 'clamp(x, low, high)',
    mix: 'mix(a, b, t)', step: 'step(edge, x)', smoothstep: 'smoothstep(edge0, edge1, x)', length: 'length(v)', distance: 'distance(a, b)', dot: 'dot(a, b)', reflect: 'reflect(v, n)', cross: 'cross(a, b) of two vec3'
};
/** Library functions (the shader's own helpers and kernels), read from the GLSL
 * sources: name → {params: [types], returns}. Functions that take or return
 * types the language does not have (Geometry, int) are left out.
 */
export const LIBRARY = (() => {
    const table = {};
    const pattern = /^(float|vec2|vec3|vec4)\s+([A-Za-z]\w*)\s*\(([^)]*)\)/gm;
    for (const source of [mathGLSL, nebulaGLSL, motifsGLSL]) {
        for (const [, returns, name, list] of source.matchAll(pattern)) {
            const params = list.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ type: s.split(/\s+/)[0], name: s.split(/\s+/)[1] }));
            if (params.every(p => GEN.includes(p.type)) && name !== 'displayColor') {
                table[name] = { params, returns };
            }
        }
    }
    return table;
})();
/** Every function a program may call, for the editor's helper menu and errors. */
export function functionNames() {
    return [...Object.keys(BUILTINS), ...Object.keys(LIBRARY)];
}
/** Edit distance with adjacent transpositions (optimal string alignment). */
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
function suggestion(name, candidates) {
    let best = null, score = Infinity;
    for (const c of candidates) {
        const s = editDistance(name.toLowerCase(), c.toLowerCase());
        if (s < score) {
            best = c;
            score = s;
        }
    }
    return best && score <= Math.max(1, Math.floor(name.length / 3)) ? ` Did you mean “${best}”?` : '';
}
// ---- Tokens and parsing ---------------------------------------------------------
const TOKEN = /\s*(?:(#[0-9a-fA-F]{6}\b)|(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_]\w*)|(<=|>=|==|!=|&&|\|\||[-+*/%^(),?:.<>!=\[\]]))/y;
function tokenize(text, line) {
    const tokens = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < text.length) {
        if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) {
            break;
        }
        const at = TOKEN.lastIndex, m = TOKEN.exec(text);
        if (!m) {
            const column = at + text.slice(at).search(/\S/);
            throw new EquationError(`Unexpected character “${text[column]}”.`, line, column + 1);
        }
        const column = m.index + m[0].search(/\S/) + 1;
        tokens.push(m[1] !== undefined ? { kind: 'color', value: m[1].toLowerCase(), column } : m[2] !== undefined ? { kind: 'num', value: m[2], column } : m[3] !== undefined ? { kind: 'id', value: m[3], column } : { kind: 'op', value: m[4], column });
    }
    return tokens;
}
/** Binding strength of binary operators (higher binds tighter). */
export const PRECEDENCE = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
/** Parse one expression from tokens. Grammar (lowest to highest precedence):
 * ternary ?:, ||, &&, == !=, < > <= >=, + -, * / %, unary - + !, power ^ (right
 * associative, so -x^2 = -(x^2)), member access .xy, calls and parentheses.
 */
function parseTokens(tokens, line) {
    let k = 0;
    const peek = () => tokens[k], take = () => tokens[k++];
    const fail = (message, token = peek()) => new EquationError(message, line, token?.column ?? null);
    const expect = value => {
        const t = take();
        if (!t || t.value !== value) {
            throw fail(`Expected “${value}”${t ? ` but found “${t.value}”` : ' at the end'}.`, t);
        }
    };
    function primary() {
        const t = take();
        if (!t) {
            throw fail('Unexpected end: the expression stops too early.');
        }
        let node;
        if (t.kind === 'num') {
            node = { type: 'num', value: t.value, column: t.column };
        }
        else if (t.kind === 'color') {
            throw fail('Colors like #rrggbb are only allowed in param lines.', t);
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
                node = { type: 'call', name: t.value, args, column: t.column };
            }
            else {
                node = { type: 'id', name: t.value, column: t.column };
            }
        }
        else if (t.value === '(') {
            node = { type: 'group', body: ternary(), column: t.column };
            expect(')');
        }
        else {
            throw fail(`Unexpected “${t.value}”.`, t);
        }
        while (peek()?.value === '.') {
            take();
            const field = take();
            if (!field || field.kind !== 'id') {
                throw fail('Expected a component name such as x or rgb after “.”.', field);
            }
            node = { type: 'member', object: node, field: field.value, column: field.column };
        }
        return node;
    }
    function power() {
        const base = primary();
        if (peek()?.value === '^') {
            const t = take();
            return { type: 'binary', op: '^', left: base, right: unary(), column: t.column };
        }
        return base;
    }
    function unary() {
        const t = peek();
        if (t && t.kind === 'op' && (t.value === '-' || t.value === '+' || t.value === '!')) {
            take();
            return { type: 'unary', op: t.value, arg: unary(), column: t.column };
        }
        return power();
    }
    function binary(level) {
        let left = unary();
        for (;;) {
            const t = peek();
            if (!t || t.kind !== 'op' || !Object.hasOwn(PRECEDENCE, t.value) || PRECEDENCE[t.value] < level) {
                return left;
            }
            take();
            left = { type: 'binary', op: t.value, left, right: binary(PRECEDENCE[t.value] + 1), column: t.column };
        }
    }
    function ternary() {
        const cond = binary(1);
        if (peek()?.value !== '?') {
            return cond;
        }
        const t = take();
        const a = ternary();
        expect(':');
        return { type: 'ternary', cond, a, b: ternary(), column: t.column };
    }
    const tree = ternary();
    if (k < tokens.length) {
        throw fail(`Unexpected “${tokens[k].value}”.`, tokens[k]);
    }
    return tree;
}
/** Parse a single expression (no definitions) into an AST. */
export function parseExpression(source) {
    return parseTokens(tokenize(String(source), null), null);
}
/** Split source into statements: {text, comment, line}. */
function statements(source) {
    const out = [];
    String(source).split(/\r?\n/).forEach((raw, index) => {
        const cut = raw.indexOf('//'), code = cut >= 0 ? raw.slice(0, cut) : raw, comment = cut >= 0 ? raw.slice(cut + 2).trim() : '';
        const parts = code.split(';').map(s => s.trim()).filter(Boolean);
        parts.forEach((text, i) => out.push({ text, comment: i === parts.length - 1 ? comment : '', line: index + 1 }));
    });
    return out;
}
function parseNumber(tokens, k, line) {
    let sign = 1;
    if (tokens[k]?.value === '-') {
        sign = -1;
        k++;
    }
    const t = tokens[k];
    if (!t || t.kind !== 'num') {
        throw new EquationError('Expected a number.', line, t?.column ?? null);
    }
    return [sign * Number(t.value), k + 1];
}
/** `param name = value [min, max] step s` (range and step optional) → spec. */
function parseParam(tokens, line, comment) {
    const name = tokens[1];
    if (!name || name.kind !== 'id') {
        throw new EquationError('Write a parameter as: param name = value [min, max].', line);
    }
    if (tokens[2]?.value !== '=') {
        throw new EquationError(`Give ${name.value} a starting value: param ${name.value} = 1 [0, 2].`, line);
    }
    if (tokens[3]?.kind === 'color') {
        if (tokens.length > 4) {
            throw new EquationError('A color parameter takes only its value, e.g. param tint = #ffd080.', line);
        }
        return { name: name.value, kind: 'color', value: tokens[3].value, label: comment || name.value, help: comment, line };
    }
    let [value, k] = parseNumber(tokens, 3, line), min, max, step = null;
    if (tokens[k]?.value === '[') {
        [min, k] = parseNumber(tokens, k + 1, line);
        if (tokens[k]?.value !== ',') {
            throw new EquationError('Write the range as [min, max].', line);
        }
        [max, k] = parseNumber(tokens, k + 1, line);
        if (tokens[k]?.value !== ']') {
            throw new EquationError('Close the range with ].', line);
        }
        k++;
    }
    else {
        const span = Math.max(Math.abs(value), 1);
        min = value >= 0 ? 0 : -2 * span;
        max = 2 * span;
    }
    if (tokens[k]?.kind === 'id' && tokens[k].value === 'step') {
        [step, k] = parseNumber(tokens, k + 1, line);
    }
    if (k < tokens.length) {
        throw new EquationError(`Unexpected “${tokens[k].value}” after the parameter.`, line, tokens[k].column);
    }
    if (!(min < max) || !Number.isFinite(min) || !Number.isFinite(max)) {
        throw new EquationError(`The range of ${name.value} must have min < max.`, line);
    }
    if (!(value >= min && value <= max)) {
        throw new EquationError(`The value of ${name.value} (${value}) is outside its range [${min}, ${max}].`, line);
    }
    step = step && step > 0 ? step : Number(((max - min) / 200).toPrecision(1));
    return { name: name.value, kind: 'number', value, min, max, step, label: name.value, help: comment, line };
}
/** Parse a program into {params, definitions, result}. Throws EquationError. */
export function parseProgram(source) {
    const text = String(source ?? '');
    if (!text.trim() || text.length > LIMITS.length) {
        throw new EquationError(`An equation must contain 1–${LIMITS.length} characters.`);
    }
    const program = { params: [], definitions: [], result: null };
    const list = statements(text);
    if (!list.length) {
        throw new EquationError('The equation is empty: write an expression such as 0.5 + 0.5*cos(10*r).');
    }
    list.forEach((s, index) => {
        const tokens = tokenize(s.text, s.line), last = index === list.length - 1;
        if (tokens[0]?.kind === 'id' && tokens[0].value === 'param') {
            if (last) {
                throw new EquationError('The last line must be the result, not a parameter.', s.line);
            }
            program.params.push(parseParam(tokens, s.line, s.comment));
        }
        else if (tokens[0]?.kind === 'id' && tokens[1]?.value === '=') {
            if (last) {
                throw new EquationError(`The last line must be the result expression, not a definition of ${tokens[0].value}. Add a line with just ${tokens[0].value}.`, s.line);
            }
            program.definitions.push({ name: tokens[0].value, expr: parseTokens(tokens.slice(2), s.line), comment: s.comment, line: s.line });
        }
        else if (last) {
            program.result = { expr: parseTokens(tokens, s.line), comment: s.comment, line: s.line };
        }
        else {
            throw new EquationError('Only the last line may be a bare expression. Name it (d = …) or make it the last line.', s.line);
        }
    });
    if (program.params.length > LIMITS.params) {
        throw new EquationError(`At most ${LIMITS.params} parameters.`);
    }
    if (program.definitions.length > LIMITS.definitions) {
        throw new EquationError(`At most ${LIMITS.definitions} definitions.`);
    }
    return program;
}
// ---- Types --------------------------------------------------------------------
function checkName(name, line, taken) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || name.length > LIMITS.name || name.includes('__') || /^gl_/i.test(name)) {
        throw new EquationError(`“${name}” is not a valid name: use letters, digits and single underscores, up to ${LIMITS.name} characters.`, line);
    }
    if (RESERVED.has(name) || Object.hasOwn(LOCALS, name) || Object.hasOwn(CONSTANTS, name) || Object.hasOwn(BUILTINS, name) || Object.hasOwn(LIBRARY, name) || name === 'expression') {
        throw new EquationError(`“${name}” is already taken by the language; choose another name.`, line);
    }
    if (taken.has(name)) {
        throw new EquationError(`${name} is defined twice.`, line);
    }
}
function typeError(message, node, line) {
    return new EquationError(message, line, node?.column ?? null);
}
/** The type of an expression in `scope` (name → type). Annotates node.valueType. */
function typeOf(node, scope, line) {
    const set = type => {
        node.valueType = type;
        return type;
    };
    switch (node.type) {
        case 'num':
            return set('float');
        case 'group':
            return set(typeOf(node.body, scope, line));
        case 'id': {
            if (scope.has(node.name)) {
                return set(scope.get(node.name));
            }
            if (Object.hasOwn(BUILTINS, node.name) || Object.hasOwn(LIBRARY, node.name) || /^vec[234]$/.test(node.name)) {
                throw typeError(`${node.name} is a function: call it as ${node.name}(…).`, node, line);
            }
            throw typeError(`Unknown name “${node.name}”.${suggestion(node.name, [...scope.keys()])}`, node, line);
        }
        case 'member': {
            const t = typeOf(node.object, scope, line);
            const valid = /^[xyzw]{1,4}$/.test(node.field) || /^[rgba]{1,4}$/.test(node.field);
            const index = c => 'xyzwrgba'.indexOf(c) % 4;
            if (!valid || t === 'float' || t === 'bool' || [...node.field].some(c => index(c) >= SIZE[t])) {
                throw typeError(`.${node.field} is not a component of a ${t}.`, node, line);
            }
            return set(vecOf(node.field.length));
        }
        case 'unary': {
            const t = typeOf(node.arg, scope, line);
            if (node.op === '!') {
                if (t !== 'bool') {
                    throw typeError('“!” needs a condition (true/false), such as x > 0.', node, line);
                }
                return set('bool');
            }
            if (!GEN.includes(t)) {
                throw typeError(`Cannot negate a ${t}.`, node, line);
            }
            return set(t);
        }
        case 'ternary': {
            if (typeOf(node.cond, scope, line) !== 'bool') {
                throw typeError('The condition before “?” must be a comparison, such as r < 1.', node, line);
            }
            const a = typeOf(node.a, scope, line), b = typeOf(node.b, scope, line);
            if (a !== b) {
                throw typeError(`Both choices of “? :” must have the same type (${a} and ${b}).`, node, line);
            }
            return set(a);
        }
        case 'binary': {
            const a = typeOf(node.left, scope, line), b = typeOf(node.right, scope, line), op = node.op;
            if (op === '&&' || op === '||') {
                if (a !== 'bool' || b !== 'bool') {
                    throw typeError(`“${op}” combines conditions (true/false).`, node, line);
                }
                return set('bool');
            }
            if (op === '<' || op === '>' || op === '<=' || op === '>=') {
                if (a !== 'float' || b !== 'float') {
                    throw typeError(`“${op}” compares two numbers; use length(v) or v.x for vectors.`, node, line);
                }
                return set('bool');
            }
            if (op === '==' || op === '!=') {
                if (a !== b || a === 'bool') {
                    throw typeError(`“${op}” compares two values of the same type.`, node, line);
                }
                return set('bool');
            }
            if (!GEN.includes(a) || !GEN.includes(b)) {
                throw typeError(`“${op}” needs numbers or vectors, not ${a === 'bool' ? a : b}.`, node, line);
            }
            if (op === '^') {
                if (b !== 'float' && b !== a) {
                    throw typeError('The exponent of “^” must be a number or the same type as the base.', node, line);
                }
                return set(a);
            }
            if (op === '%' && b !== 'float' && b !== a) {
                throw typeError('“%” (mod) needs a number or the same type on the right.', node, line);
            }
            if (a === b || a === 'float' || b === 'float') {
                return set(a === 'float' ? b : a);
            }
            throw typeError(`Cannot ${{ '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '%': 'take mod of' }[op]} a ${a} and a ${b}.`, node, line);
        }
        case 'call': {
            const args = node.args.map(arg => typeOf(arg, scope, line)), name = node.name;
            const shown = `${name}(${args.join(', ')})`;
            if (/^vec[234]$/.test(name)) {
                const n = Number(name[3]), total = args.reduce((s, t) => s + (SIZE[t] || 99), 0);
                const ok = args.length && args.every(t => GEN.includes(t)) && (total === n || (args.length === 1 && (args[0] === 'float' || SIZE[args[0]] >= n)));
                if (!ok) {
                    throw typeError(`${name} needs ${n} components in total, got ${shown}.`, node, line);
                }
                return set(name);
            }
            if (Object.hasOwn(BUILTINS, name)) {
                const result = BUILTINS[name](args);
                if (!result) {
                    throw typeError(`${shown} is not valid${BUILTIN_HINTS[name] ? `; use ${BUILTIN_HINTS[name]}` : ''}.`, node, line);
                }
                return set(result);
            }
            if (Object.hasOwn(LIBRARY, name)) {
                const f = LIBRARY[name];
                if (args.length !== f.params.length || args.some((t, i) => t !== f.params[i].type)) {
                    throw typeError(`${name} expects (${f.params.map(p => `${p.type} ${p.name}`).join(', ')}), got ${shown}.`, node, line);
                }
                return set(f.returns);
            }
            throw typeError(`Unknown function “${name}”.${suggestion(name, functionNames())}`, node, line);
        }
    }
    throw typeError(`Cannot use ${node.type} here.`, node, line);
}
/** Parse and type-check a custom equation of the given component type
 * ('expression', 'vectorExpression' or 'colorExpression'). Returns the program
 * with {resultType, types: name → type}. Throws EquationError.
 */
export function checkProgram(source, kind) {
    const program = parseProgram(source), scope = new Map(Object.entries({ ...LOCALS, ...CONSTANTS })), taken = new Set();
    for (const param of program.params) {
        checkName(param.name, param.line, taken);
        taken.add(param.name);
        scope.set(param.name, param.kind === 'color' ? 'vec3' : 'float');
    }
    for (const d of program.definitions) {
        checkName(d.name, d.line, taken);
        const type = typeOf(d.expr, scope, d.line);
        if (type === 'bool') {
            throw new EquationError(`${d.name} is a condition (true/false); use it inside “? :” instead.`, d.line);
        }
        taken.add(d.name);
        scope.set(d.name, type);
        d.valueType = type;
    }
    const resultType = typeOf(program.result.expr, scope, program.result.line), allowed = RESULT_TYPES[kind];
    if (allowed && !allowed.includes(resultType)) {
        const want = { expression: 'a number (float)', vectorExpression: 'a coordinate pair (vec2)', colorExpression: 'a color (vec3, or vec4 with coverage)' }[kind];
        const hint = kind === 'colorExpression' && resultType === 'float' ? ' For gray, write vec3(v).' : kind === 'vectorExpression' && resultType === 'float' ? ' Build a pair with vec2(x, y).' : '';
        throw new EquationError(`The result must be ${want}, but it is a ${resultType}.${hint}`, program.result.line);
    }
    program.resultType = resultType;
    program.types = Object.fromEntries(scope);
    return program;
}
const cache = new Map();
/** checkProgram() with a small cache, since validation runs on every edit and draw. */
export function compileEquation(source, kind) {
    const key = `${kind}\u0000${source}`;
    if (cache.has(key)) {
        const hit = cache.get(key);
        if (hit instanceof Error) {
            throw hit;
        }
        return hit;
    }
    let result;
    try {
        result = checkProgram(source, kind);
    }
    catch (e) {
        result = e;
    }
    if (cache.size > 200) {
        cache.clear();
    }
    cache.set(key, result);
    if (result instanceof Error) {
        throw result;
    }
    return result;
}
/** Parameter specs declared by a custom equation, keyed by name, in the shape of
 * catalog parameters: {kind, label, value, min, max, step, symbol, help}.
 */
export function equationParams(source, kind) {
    const program = compileEquation(source, kind);
    return Object.fromEntries(program.params.map(p => [p.name, p.kind === 'color'
        ? { kind: 'color', label: p.name, value: p.value, symbol: p.name, help: p.help || `Color parameter ${p.name} of this equation.`, custom: true }
        : { kind: 'number', label: p.name, value: p.value, min: p.min, max: p.max, step: p.step, symbol: p.name, help: p.help || `Parameter ${p.name} of this equation, from ${p.min} to ${p.max}.`, custom: true }]));
}
// ---- Formatting ------------------------------------------------------------------
const TIGHT = new Set(['*', '/', '^', '%']);
function formatPrecedence(node) {
    if (node.type === 'group') {
        return formatPrecedence(node.body);
    }
    return node.type === 'binary' ? (node.op === '^' ? 8 : PRECEDENCE[node.op]) : node.type === 'ternary' ? 0 : node.type === 'unary' ? 7 : 9;
}
/** An expression as readable text with only the parentheses its meaning needs:
 * spaces around + − and comparisons, none around * / ^ %.
 */
export function formatExpression(node) {
    const wrap = (child, level, strict = false) => {
        const p = formatPrecedence(child), text = formatExpression(child);
        return p < level || (strict && p === level) ? `(${text})` : text;
    };
    switch (node.type) {
        case 'num':
            return node.value;
        case 'id':
            return node.name;
        case 'group':
            return formatExpression(node.body);
        case 'member':
            return `${wrap(node.object, 9)}.${node.field}`;
        case 'unary':
            return `${node.op}${wrap(node.arg, 7)}`;
        case 'ternary':
            return `${wrap(node.cond, 1)} ? ${formatExpression(node.a)} : ${formatExpression(node.b)}`;
        case 'call':
            return `${node.name}(${node.args.map(formatExpression).join(', ')})`;
        case 'binary': {
            if (node.op === '^') {
                return `${wrap(node.left, 9)}^${wrap(node.right, 7)}`;
            }
            const level = PRECEDENCE[node.op], right = wrap(node.right, level, node.op === '-' || node.op === '/' || node.op === '%');
            return TIGHT.has(node.op) ? `${wrap(node.left, level)}${node.op}${right}` : `${wrap(node.left, level)} ${node.op} ${right}`;
        }
    }
    throw new Error(`Cannot format ${node.type}`);
}
// ---- GLSL -----------------------------------------------------------------------
const glslNumber = text => /^\d+$/.test(text) ? `${text}.0` : /^\d+\.$/.test(text) ? `${text}0` : text;
/** Print an expression as fully parenthesized GLSL. `names` maps a user name to its GLSL name. */
function toGLSL(node, names) {
    const go = n => toGLSL(n, names);
    switch (node.type) {
        case 'num':
            return glslNumber(node.value);
        case 'id':
            return names.get(node.name) ?? node.name;
        case 'group':
            return `(${go(node.body)})`;
        case 'member':
            return `${go(node.object)}.${node.field}`;
        case 'unary':
            return `(${node.op}${go(node.arg)})`;
        case 'ternary':
            return `(${go(node.cond)}?${go(node.a)}:${go(node.b)})`;
        case 'call':
            return `${node.name}(${node.args.map(go).join(',')})`;
        case 'binary': {
            const a = go(node.left), b = go(node.right);
            if (node.op === '%') {
                return `mod(${a},${b})`;
            }
            if (node.op === '^') {
                const k = node.right.type === 'num' ? Number(node.right.value) : NaN;
                if (k === 2 || k === 3 || k === 4) { // exact and safe for negative bases, unlike pow()
                    return `(${new Array(k).fill(`(${a})`).join('*')})`;
                }
                if (k === 1) {
                    return `(${a})`;
                }
                return node.left.valueType !== 'float' && node.right.valueType === 'float' ? `pow(${a},${node.left.valueType}(${b}))` : `pow(${a},${b})`;
            }
            return `(${a}${node.op}${b})`;
        }
    }
    throw new Error(`Cannot print ${node.type}`);
}
/** A GLSL function for a checked program. `params` maps a parameter name to the
 * GLSL expression holding its value (a uniform alias). Returns {code, returns}.
 */
export function programGLSL(program, functionName, params = {}) {
    const names = new Map();
    const lines = [];
    for (const p of program.params) {
        names.set(p.name, `k_${p.name}`);
        lines.push(`${p.kind === 'color' ? 'vec3' : 'float'} k_${p.name}=${params[p.name] ?? (p.kind === 'color' ? 'vec3(0)' : glslNumber(String(p.value)))};`);
    }
    for (const d of program.definitions) {
        names.set(d.name, `d_${d.name}`);
        lines.push(`${d.valueType} d_${d.name}=${toGLSL(d.expr, names)};`);
    }
    const returns = program.resultType;
    const code = `${returns} ${functionName}(vec2 p,float a,float b,float t){float x=p.x,y=p.y,r=length(p),theta=angleOf(p);${lines.join('')}return ${toGLSL(program.result.expr, names)};}`;
    return { code, returns };
}
