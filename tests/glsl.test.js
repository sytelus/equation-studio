import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCode, codeGLSL, codeStructure, codeParams, formatCode, withNumber, numberText, showable, showType, zeroOf, CODE_LIMITS } from '../src/glsl.js';
import { works } from '../src/works.js';
import { linkLibraries, topLevelItems } from '../src/shader-link.js';
import { compileProgram, programKey, sourceLine, explainCompileLog, shownType, LIBRARIES } from '../src/compiler.js';
import { getPreset } from '../src/presets.js';
import { makeNode, validateProject } from '../src/graph.js';
import { paramSpecs } from '../src/catalog.js';

const twigl = works.filter(w => w.platform === 'twigl');
const errorOf = source => {
    try {
        analyzeCode(source);
    }
    catch (e) {
        return e;
    }
    return null;
};

describe('shader code: parsing and checking', () => {
    it('reads every original and readable version of the works', () => {
        for (const w of works.filter(w => w.platform !== 'p5')) {
            const readable = analyzeCode(w.readable);
            if (w.original) {
                const original = analyzeCode(w.original);
                assert.deepEqual(readable.loops.map(l => l.steps), original.loops.map(l => l.steps), `${w.id}: same loop lengths`);
            }
            assert(readable.variables.length > 2, w.id);
        }
    });
    it('measures how many steps each loop takes, in float32 like the GPU', () => {
        const steps = id => analyzeCode(works.find(w => w.id === id).original).loops.map(l => l.steps);
        assert.deepEqual(steps('jellyfish-lattice'), [200, 6], 'i++ < 2e2 and s = 9, 18, … < 400');
        assert.deepEqual(steps('stormy-sea'), [100, 26], 'a = .8^k > .003');
        assert.deepEqual(steps('vortex'), [16], 'i = .2 + .05k < 1 with float32 sums');
        assert.deepEqual(steps('blossom-tree'), [130, 14]);
        assert.deepEqual(steps('lace-garden'), [100, 9], 'a condition with side effects');
        assert.deepEqual(steps('cloud-mountains'), [97, 8], 's = 5, 10, … < 1000, set before the loop in the body');
        assert.deepEqual(steps('rainbow-trefoil'), [600]);
        assert.equal(analyzeCode('float i;do{i++;}while(i<5.);').loops[0].steps, 5);
        assert.equal(analyzeCode('for(float i;i<1.;i+=FC.x){}').loops[0].steps, null, 'depends on the pixel');
        assert.equal(analyzeCode('for(;;){break;}').loops[0].exits, true);
    });
    it('lists variables, loops, numbers, helpers and inputs', () => {
        const a = analyzeCode(works.find(w => w.id === 'stone-kaleidoscope').original);
        assert.deepEqual(a.variables.map(v => `${v.name}:${v.type}`), ['e:float', 'i:float', 's:float', 'x:float', 'p:vec3', 'q:vec3', 'd:vec3', 'i:int'], 'the inner int i shadows the float i');
        assert.deepEqual(a.helpers, ['rotate2D']);
        assert(a.inputs.includes('FC') && a.inputs.includes('PI'));
        assert.equal(a.numbers[0].text, '.5');
        assert(a.numbers.every((n, k) => k === 0 || n.start > a.numbers[k - 1].start), 'numbers in reading order');
        const v = analyzeCode('o = vec4(0, 1, 2, 3)*.5;');
        assert.deepEqual(v.numbers.map(n => n.text), ['0', '1', '2', '3', '.5'], 'whole numbers inside a float constructor can be dragged');
        assert.equal(analyzeCode('for(int j=0;j<3;j++){}').numbers.length, 0, 'loop counters stay integers');
    });
    it('explains mistakes in words, with the line', () => {
        const cases = [
            ['o = vec4(1);\nvec3 p = vec3(1)*2;', /Line 2:.*Cannot multiply a vec3 and a int\. GLSL does not turn whole numbers into floats: write 2\. or 2\.0/],
            ['float dist = 1.;\no.r = dsit;', /Unknown name “dsit”\. Did you mean “dist”\?/],
            ['o += texture(FC.xy, FC.xy/r);', /Textures are not available/],
            ['o += texture(b, FC.xy/r);', /b \(the previous frame/],
            ['o = b;', /b \(the previous frame/],
            ['float f(float x){return x;}', /Function definitions are not supported/],
            ['#define A 1.\no = vec4(A);', /Preprocessor lines/],
            ['vec2 p = FC.xyz;', /Cannot set the vec2 p to a vec3/],
            ['float x = FC.xy.z;', /\.z is not a component of a vec2, which has 2 components/],
            ['float x = FC.xg;', /not a valid swizzle/],
            ['t = 1.;', /t is an input.*cannot be changed/],
            ['o.xx = vec2(1);', /a component appears twice/],
            ['return 1.;', /Write return; without a value/],
            ['o = sin(1);', /sin\(int\) is not valid.*Write whole numbers with a decimal point/],
            ['if (1.) o = vec4(1);', /must be true or false/],
            ['break;', /only be used inside a loop/],
            ['float a; float a;', /declared twice/],
            ['o = vec4(1., 2.);', /vec4 needs 4 components but gets 2/],
            ['o = vec4(1', /Unexpected end of the code/],
            ['uint u = 1u;', /Unsigned integers/],
            ['float x[3];', /Arrays are not supported/],
            ['o = hsv(1., 2.);', /hsv\(float, float\) is not valid/],
            ['o += 1. % 2.;', /% works on integers only: for a float use mod/],
            ['/* never closed', /never closed/],
            ['', /1–12000 characters/]
        ];
        for (const [source, pattern] of cases) {
            const e = errorOf(source);
            assert(e, `accepted: ${source}`);
            assert.match(e.message, pattern, source);
        }
        assert.equal(errorOf('o = vec4(1)').line, 1);
        assert.equal(errorOf('o += 1.;\n\nx = 1.;').line, 3);
        assert.equal(errorOf('o += 1.;\n\nx = 1.;').column, 1);
    });
    it('accepts GLSL ES 3.00 forms the one-liners use', () => {
        for (const source of [
            'vec3 p;p--;p.xy*=mat2(1,0,0,1);o.rgb=p*mat3(1.);',
            'float a=1.,b=a++*--a;o=vec4(a>b?a:b);',
            'int i=5;i<<=1;i%=3;o=vec4(float(i&1|2^3));',
            'bvec2 m=lessThan(FC.xy,r*.5);o=vec4(any(m)?1.:0.);',
            'for(int i;i++<3;)for(int j=0;j<2;j++){if(j==1)continue;o+=.1;}',
            'vec2 q=vec2(1);q[0]=2.;mat2 M=mat2(1.);M[1]=q;o.xy=M[1];',
            'o=vec4(PI2,PI,s,f);o.w=m.x;',
            'o=vec4(snoise2D(FC.xy),snoise4D(FC),fsnoiseDigits(FC.xy),mod289(1.));',
            'const float k=2.;o=vec4(k);'
        ]) {
            analyzeCode(source);
        }
    });
    it('reads param lines as sliders', () => {
        const source = 'param zoom = 2 [0.5, 8] // how far\nparam tint = #ff8000\no.rgb = tint*length(FC.xy/r*zoom);';
        const specs = codeParams(source);
        assert.deepEqual(Object.keys(specs), ['zoom', 'tint']);
        assert.equal(specs.zoom.help, 'how far');
        assert.equal(specs.tint.kind, 'color');
        assert.match(errorOf('param t = 1\no = vec4(t);').message, /already taken/);
        assert.match(errorOf('param k = 1\nk = 2.;').message, /k is a parameter/);
    });
});

describe('shader code: printing', () => {
    it('renames, hoists and counts every loop', () => {
        const a = analyzeCode(works.find(w => w.id === 'stone-kaleidoscope').original);
        const { code } = codeGLSL(a, 'code_n1', { numbers: k => `K${k}`, caps: loop => `cap${loop}` });
        assert(code.startsWith('vec4 code_n1(vec2 p,float time,int show){'));
        assert(code.includes('float v_i=0.0;') && code.includes('int v_i_2=0;'), 'shadowed names get their own variable');
        assert(code.includes('int c_1=0;int c_2=0;int c_budget=30000;'));
        assert(code.includes('c_1++<cap0&&--c_budget>=0'), 'loop 1 stops after cap0 steps and counts the budget');
        assert(code.includes('v_i_2=0;for(;v_i_2++<9&&c_2++<cap1'), 'an inner loop declaration starts at zero every run');
        assert(code.includes('v_x=K0;') && code.includes('v_d=v_x-i_FC.rgb/i_r.y;'), 'numbers read their uniforms');
        assert(code.endsWith('return codeColor(i_o);\n}'));
        const show = showable(a);
        assert.equal(show.at(-1).name, 'steps of loop 2');
        assert(code.includes(`if(show==${show.findIndex(s => s.name === 'd') + 1})return vec4(v_d,1);`));
        assert.equal(showType(a, 0), 'layer');
        assert.equal(showType(a, 1), 'scalar');
    });
    it('keeps the meaning when the code is reformatted', () => {
        for (const w of twigl) {
            const formatted = formatCode(w.original);
            assert.equal(codeStructure(formatted, true), codeStructure(w.original, true), `${w.id}: formatting changes nothing`);
            assert(formatted.split('\n').length > 3, w.id);
        }
    });
    it('shares one program between codes that differ only in numbers or comments', () => {
        const a = 'vec2 p = FC.xy/r; // position\no.rg = p*.5;';
        assert.equal(codeStructure(a), codeStructure('vec2 p=FC.xy/r;o.rg=p*.75;'));
        assert.notEqual(codeStructure(a, true), codeStructure('vec2 p=FC.xy/r;o.rg=p*.75;', true), 'inline numbers are part of the program');
        assert.notEqual(codeStructure(a), codeStructure('vec2 p = FC.xy/r;\no.gr = p*.5;'));
    });
    it('changes one number and formats dragged values like the original', () => {
        const source = 'param k = 1 [0, 2]\no.r = .5 + 2.*k;';
        assert.equal(withNumber(source, 1, '3.'), 'param k = 1 [0, 2]\no.r = .5 + 3.*k;');
        assert.equal(numberText(0.25, 0.01, '.5'), '.25');
        assert.equal(numberText(3, 0.1, '2.'), '3.');
        assert.equal(numberText(1.2346, 0.001, '1.0'), '1.235');
        assert.equal(numberText(4.2, 1, '3'), '4');
        assert.equal(zeroOf('bvec2'), 'bvec2(false)');
    });
});

describe('shader code in a project', () => {
    it('declares parameters, loop steps and numbers', () => {
        const p = getPreset('jellyfish-lattice'), node = p.nodes.find(n => n.type === 'code');
        const specs = paramSpecs(node);
        assert.deepEqual(Object.keys(specs), ['code', 'speed', 'phase', 'steps1', 'steps2']);
        assert.equal(specs.steps1.max, 200);
        assert.equal(node.params.steps2, 6);
        const c = compileProgram(p), k = c.index.shader;
        assert(c.fragment.includes(`vec4 code_n${k}(vec2 p,float time,int show)`));
        assert(c.fragment.includes(`code_n${k}(n${c.index.space},u_time*n${k}_speed+n${k}_phase,u_target==${k}?u_show:0)`));
        assert.equal(c.params.filter(s => s.kind === 'literal').length, analyzeCode(node.params.code).numbers.length);
        assert(!c.fragment.includes('nebulaGeometry'), 'unused library functions are left out');
        assert(c.fragment.includes('vec3 hsv('), 'used helpers are linked');
        const lines = c.fragment.split('\n'), map = c.code.shader;
        assert(lines[map.start].startsWith(`vec4 code_n${k}(`), 'the map points at the code function');
        assert.equal(lines[map.start + map.lines.length - 1], '}', 'and covers it to its end');
    });
    it('points GPU compiler messages at code lines', () => {
        const p = getPreset('vortex'), c = compileProgram(p), map = c.code.shader;
        const k = map.lines.findIndex(line => line === 4);
        assert(k > 0);
        assert.deepEqual(sourceLine(c, map.start + k + 1), { node: 'shader', line: 4 });
        assert.equal(sourceLine(c, 1), null);
        assert.match(explainCompileLog(c, p, `ERROR: 0:${map.start + k + 1}: 'x' : syntax error`), /^Vortex, code line 4: 'x'/);
    });
    it('compiles numbers as constants on request, with their own program key', () => {
        const p = getPreset('vortex');
        const exact = compileProgram(p, { inlineNumbers: true });
        assert.equal(exact.params.filter(s => s.kind === 'literal').length, 0);
        assert(exact.fragment.includes('cos(v_i*5.+vec4(0,1,2,3))'));
        assert.notEqual(programKey(p, null, true), programKey(p));
    });
    it('reports the type of a shown variable', () => {
        const p = getPreset('vortex');
        const list = showable(analyzeCode(p.nodes.find(n => n.id === 'shader').params.code));
        assert.equal(shownType(p, 'shader', 0), 'layer');
        assert.equal(shownType(p, 'shader', list.findIndex(v => v.name === 'v') + 1), 'coord');
        assert.equal(shownType(p, 'shader', list.findIndex(v => v.name === 'angle') + 1), 'scalar');
    });
    it('rejects invalid code with the component name', () => {
        const p = getPreset('vortex');
        p.nodes.find(n => n.id === 'shader').params.code = 'o = vec4(1';
        assert.throws(() => validateProject(p), /Vortex: Line 1: Unexpected end/);
    });
});

describe('point clouds', () => {
    it('compile to a point pass and a texture lookup', () => {
        const p = getPreset('point-jellyfish'), c = compileProgram(p);
        assert.equal(c.points.length, 1);
        const pass = c.points[0];
        assert.equal(pass.node, 'cloud');
        assert(pass.vertex.includes(`vec2 points_n${c.index.cloud}(float i,float n,float t)`));
        assert(pass.vertex.includes('gl_PointSize=v_size;'));
        assert(pass.fragment.includes('outputColor=vec4('));
        assert(c.fragment.includes('uniform highp sampler2D u_points0;'));
        assert(c.fragment.includes(`pointsLayer(u_points0,n${c.index.space})`));
    });
    it('allow at most four clouds', () => {
        const p = getPreset('point-jellyfish');
        for (let k = 0; k < 4; k++) {
            p.nodes.push(makeNode('points', `extra${k}`, { p: 'space' }));
        }
        assert.throws(() => validateProject(p), /at most 4 point clouds/);
    });
});

describe('library linking', () => {
    it('splits the libraries into their top-level items', () => {
        for (const library of LIBRARIES) {
            const items = topLevelItems(library);
            assert(items.length > 3);
            assert(items.every(item => item.names.length >= 1), 'every item defines a name');
        }
    });
    it('keeps only what a program reaches', () => {
        const code = linkLibraries('void main(){ vec3 c = hsv(0.1, 0.2, 0.3) * PI2; }', LIBRARIES);
        assert(code.includes('vec3 hsv(') && code.includes('const float PI2') && code.includes('const float PI ='));
        assert(!code.includes('snoise3D') && !code.includes('fbm('));
        const noise = linkLibraries('float x = snoise3D(p);', LIBRARIES);
        assert(noise.includes('vec4  permute(vec4 x)') && noise.includes('vec4  mod289(vec4 x)'), 'overloads come along');
        assert(!noise.includes('snoise2D'));
    });
    it('every preset links a complete program', () => {
        for (const id of ['bipolar', 'water', 'kaleidoscope', 'jellyfish-lattice', 'point-twins']) {
            const c = compileProgram(getPreset(id));
            assert(c.fragment.length < 60000, `${id}: ${c.fragment.length} characters`);
        }
    });
});

describe('limits', () => {
    it('bounds loops, variables and the budget', () => {
        assert.equal(CODE_LIMITS.budget, 30000);
        const loops = Array.from({ length: CODE_LIMITS.loops + 1 }, () => 'for(int i;i<1;i++){}').join('');
        assert.match(errorOf(loops).message, /At most 8 loops/);
    });
});
