import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram, checkProgram, compileEquation, equationParams, programGLSL, LIBRARY, functionNames, EquationError, LIMITS } from '../src/expression.js';
import { presets } from '../src/presets.js';
import { catalog, paramSpecs } from '../src/catalog.js';
import { makeNode, validateProject } from '../src/graph.js';
import { compileProgram } from '../src/compiler.js';
import { getPreset } from '../src/presets.js';

const glsl = (source, kind = 'expression', params = {}) => programGLSL(checkProgram(source, kind), 'f', params).code;

describe('parsing programs', () => {
    it('reads parameters, definitions with captions and the result', () => {
        const p = parseProgram('param radius = 1 [0.1, 3]  // how far\nparam tint = #FFD080\nd = length(p) - radius // distance\nexp(-(d/0.1)^2) // bump');
        assert.deepEqual(p.params.map(x => [x.name, x.kind, x.value]), [['radius', 'number', 1], ['tint', 'color', '#ffd080']]);
        assert.equal(p.params[0].min, 0.1);
        assert.equal(p.params[0].max, 3);
        assert.equal(p.params[0].help, 'how far');
        assert.equal(p.definitions[0].name, 'd');
        assert.equal(p.definitions[0].comment, 'distance');
        assert.equal(p.result.comment, 'bump');
    });
    it('accepts semicolons and blank lines, and a step for parameters', () => {
        const p = parseProgram('param k = -2 [-5, 5] step 0.5\n\nu = x*k; v = y*k\nu + v');
        assert.equal(p.params[0].step, 0.5);
        assert.equal(p.params[0].value, -2);
        assert.deepEqual(p.definitions.map(d => d.name), ['u', 'v']);
    });
    it('chooses a default range when none is given', () => {
        const p = parseProgram('param k = 3\nk*x');
        assert.equal(p.params[0].min, 0);
        assert.equal(p.params[0].max, 6);
        assert(p.params[0].step > 0);
    });
    it('reports mistakes with their line', () => {
        const cases = [
            ['d = x', /last line must be the result/],
            ['x\ny', /Only the last line may be a bare expression/],
            ['param k = 5 [0, 1]\nk', /outside its range/],
            ['param k = 1 [2, 1]\nk', /min < max/],
            ['param k\nk', /starting value/],
            ['param tint = #zzzzzz\ntint', /Unexpected character|Expected a number/],
            ['x +', /Unexpected end/],
            ['sin(x', /Expected “\)”/],
            ['x $ y', /Unexpected character/],
            ['#ffffff', /only allowed in param lines/],
            ['', /1–3000 characters/]
        ];
        for (const [source, pattern] of cases) {
            assert.throws(() => parseProgram(source), pattern, source);
        }
        try {
            parseProgram('a = 1\nb = (2\nb');
        }
        catch (e) {
            assert(e instanceof EquationError);
            assert.equal(e.line, 2);
            assert(e.message.startsWith('Line 2:'));
        }
    });
    it('rejects anything that is not an expression', () => {
        for (const s of ['return 1.0;', 'for(;;){}', 'x++', 'x/*hide*/', 'window.alert(1);', 'vec3[2](1)', '#define x y', 'x = 2.0']) {
            assert.throws(() => checkProgram(s, 'expression'), s);
        }
    });
});

describe('type checking', () => {
    it('infers the types of definitions and the result', () => {
        const p = checkProgram('q = rotate2(p, 0.3)\nc = spectrum(r, 0.0)\nd = q.x\nvec4(c*d, 1)', 'colorExpression');
        assert.deepEqual(p.definitions.map(d => d.valueType), ['vec2', 'vec3', 'float']);
        assert.equal(p.resultType, 'vec4');
        assert.equal(checkProgram('p*2', 'vectorExpression').resultType, 'vec2');
    });
    it('accepts the scalar–vector arithmetic GLSL allows', () => {
        for (const s of ['2*p', 'p/2', 'p + p', '-p', 'p.yx', 'mix(p, p*2, 0.5)', 'clamp(p, 0, 1)', 'min(p, 1)', 'mod(p, 2)', 'step(0.5, p)', 'smoothstep(0, 1, p)', 'pow(p, p)', 'p^2', 'p % 1.5', 'x > 0 ? p : -p', 'normalize(p)']) {
            assert.equal(checkProgram(s, null).resultType, 'vec2', s);
        }
        assert.equal(checkProgram('length(p) < 1 && x > 0 ? 1 : 0', 'expression').resultType, 'float');
    });
    it('explains type errors in words', () => {
        const cases = [
            ['p + vec3(1)', /Cannot add a vec2 and a vec3/],
            ['p < 1', /compares two numbers/],
            ['p.z', /\.z is not a component of a vec2/],
            ['fbm(x, 2)', /fbm expects \(vec2 p, float octaves\), got fbm\(float, float\)/],
            ['vec2(1, 2, 3)', /vec2 needs 2 components/],
            ['clamp(p)', /clamp\(vec2\) is not valid; use clamp\(x, low, high\)/],
            ['raduis', /Unknown name “raduis”/],
            ['fmb(p, 2)', /Did you mean “fbm”/],
            ['x ? 1 : 0', /condition before “\?”/],
            ['x > 0 ? 1 : p', /same type/],
            ['sin', /is a function/],
            ['!x', /needs a condition/]
        ];
        for (const [source, pattern] of cases) {
            assert.throws(() => checkProgram(source, null), pattern, source);
        }
    });
    it('checks the result type of each custom component', () => {
        assert.throws(() => checkProgram('p', 'expression'), /must be a number \(float\), but it is a vec2/);
        assert.throws(() => checkProgram('x', 'colorExpression'), /For gray, write vec3\(v\)/);
        assert.throws(() => checkProgram('x', 'vectorExpression'), /vec2\(x, y\)/);
        assert.equal(checkProgram('vec3(x)', 'colorExpression').resultType, 'vec3');
    });
    it('keeps names unambiguous', () => {
        assert.throws(() => checkProgram('param sin = 1\nsin', null), /already taken/);
        assert.throws(() => checkProgram('r = 2\nr', null), /already taken/);
        assert.throws(() => checkProgram('d = 1\nd = 2\nd', null), /defined twice/);
        assert.throws(() => checkProgram('a__b = 1\na__b', null), /not a valid name/);
        assert.throws(() => checkProgram('gl_x = 1\ngl_x', null), /not a valid name/);
        assert.throws(() => checkProgram('d = x < 1\nd', null), /condition/);
        assert.throws(() => checkProgram('e = d\nd = 1\ne', null), /Unknown name “d”/, 'definitions are used after they are made');
    });
    it('limits the size of programs', () => {
        const many = Array.from({ length: LIMITS.params + 1 }, (_, i) => `param k${i} = 1`).join('\n') + '\nx';
        assert.throws(() => parseProgram(many), /At most/);
        assert.throws(() => parseProgram('x'.repeat(LIMITS.length + 1)), /characters/);
    });
});

describe('GLSL output', () => {
    it('prints whole numbers as floats and ^ as products', () => {
        assert.equal(glsl('2*x'), 'float f(vec2 p,float a,float b,float t){float x=p.x,y=p.y,r=length(p),theta=angleOf(p);return (2.0*x);}');
        assert(glsl('x^2').includes('((x)*(x))'), 'x^2 is exact for negative x');
        assert(glsl('x^0.5').includes('pow(x,0.5)'));
        assert(glsl('p^0.5', 'vectorExpression').includes('pow(p,vec2(0.5))'));
        assert(glsl('x % 2').includes('mod(x,2.0)'));
        assert(glsl('-x^2').includes('(-((x)*(x)))'), 'unary minus binds looser than ^');
    });
    it('declares parameters and definitions with their types', () => {
        const code = glsl('param k = 2 [0, 4]\nparam c = #ff0000\nq = p*k\nc*length(q)', 'colorExpression', { k: 'n3_k', c: 'n3_c' });
        assert(code.includes('float k_k=n3_k;vec3 k_c=n3_c;vec2 d_q=(p*k_k);'));
        assert(code.startsWith('vec3 f('));
        assert(code.endsWith('return (k_c*length(d_q));}'));
    });
    it('library kernels are callable with their real signatures', () => {
        assert.deepEqual(LIBRARY.fbm.params.map(p => p.type), ['vec2', 'float']);
        assert.equal(LIBRARY.waterPlanet.returns, 'vec4');
        assert(!LIBRARY.displayColor && !LIBRARY.nebulaGeometry && !LIBRARY.lensCenter, 'int and Geometry signatures are excluded');
        assert(functionNames().includes('smoothstep') && functionNames().includes('spiralGalaxy'));
        assert.equal(checkProgram('waterPlanet(p, 1, 0.6, 5, 2, t)', 'colorExpression').resultType, 'vec4');
    });
    it('every preset equation compiles and keeps its meaning', () => {
        for (const preset of presets) {
            for (const n of preset.nodes.filter(n => catalog[n.type].custom)) {
                const program = compileEquation(n.params.expression, n.type);
                assert(program.resultType, `${preset.id}.${n.id}`);
            }
        }
        for (const type of ['expression', 'vectorExpression', 'colorExpression']) {
            compileEquation(catalog[type].params.expression.value, type);
        }
    });
});

describe('equation parameters in projects', () => {
    const custom = (expression, params = {}) => {
        const p = getPreset('marble');
        p.nodes.push(makeNode('expression', 'eq', { p: 'space' }, { expression, ...params }));
        p.output = 'eq';
        return p;
    };
    it('declared parameters become specs, uniforms and validated values', () => {
        const source = 'param width = 0.1 [0.01, 1] // thickness\nparam tone = #102030\nexp(-(length(p)/width)^2)*tone.r';
        const specs = equationParams(source, 'expression');
        assert.deepEqual(Object.keys(specs), ['width', 'tone']);
        assert.equal(specs.width.help, 'thickness');
        assert.equal(specs.tone.kind, 'color');
        const p = custom(source, { width: 0.2, tone: '#102030' });
        validateProject(p);
        const node = p.nodes.find(n => n.id === 'eq');
        assert.deepEqual(Object.keys(paramSpecs(node)), ['expression', 'width', 'tone']);
        const c = compileProgram(p);
        assert(c.params.some(s => s.node === 'eq' && s.param === 'width'));
        assert(c.fragment.includes(`#define n${c.index.eq}_width`));
        assert(c.fragment.includes(`float k_width=n${c.index.eq}_width;`));
    });
    it('rejects values outside the declared range and undeclared parameters', () => {
        assert.throws(() => validateProject(custom('param w = 0.1 [0.01, 1]\nw', { w: 5 })), /eq\.w must be a finite number/);
        assert.throws(() => validateProject(custom('x', { w: 0.5 })), /Unknown parameter eq\.w/);
        const missing = custom('param w = 0.1 [0.01, 1]\nw');
        delete missing.nodes.find(n => n.id === 'eq').params.w;
        assert.throws(() => validateProject(missing), /eq\.w must be a finite number/, 'a declared parameter needs a value');
    });
    it('new nodes start with the declared values of their equation parameters', () => {
        const node = makeNode('expression', 'eq', {}, { expression: 'param w = 0.3 [0.01, 1]\nparam tint = #ffd080\nw' });
        assert.equal(node.params.w, 0.3);
        assert.equal(node.params.tint, '#ffd080');
        assert.equal(makeNode('expression', 'eq', {}, { expression: 'param w = 0.3 [0.01, 1]\nw', w: 0.5 }).params.w, 0.5, 'given values win');
    });
    it('reports equation errors with the component label', () => {
        assert.throws(() => validateProject(custom('p')), /Custom scalar equation: Line 1: The result must be a number/);
    });
    it('tracks may animate equation parameters', () => {
        const p = custom('param w = 0.1 [0.01, 1]\nw', { w: 0.1 });
        p.tracks.push({ node: 'eq', param: 'w', interpolation: 'linear', keys: [{ time: 0, value: 0.1 }, { time: 1, value: 0.9 }] });
        validateProject(p);
    });
});
