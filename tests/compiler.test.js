import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { presets, getPreset } from '../src/presets.js';
import { makeNode } from '../src/graph.js';
import { compileGraph, compileProgram, programKey, viewState, nodeMask, subgraph, withBypassed, comparePassSource, CONTRIBUTION_STYLES, MODES } from '../src/compiler.js';
import { catalog } from '../src/catalog.js';

/** Shader text without GLSL line comments. */
const codeOnly = fragment => fragment.replace(/\/\/.*$/gm, '');
const bit = (mask, k) => ((mask[k >> 5] >>> (k & 31)) & 1) === 1;

describe('program generation', () => {
    for (const p of presets) {
        it(`compiles the preset: ${p.id}`, () => {
            const c = compileGraph(p);
            assert(c.fragment.startsWith('#version 300 es'));
            assert.equal(c.target, p.output);
            assert(!codeOnly(c.fragment).includes('undefined'));
            assert(c.order.length > 0);
            assert.equal(c.order.at(-1), p.output, 'the target is evaluated last');
            assert.equal(c.type, catalog[p.nodes.find(n => n.id === p.output).type].output);
            const whole = compileProgram(p);
            assert.equal(whole.order.length, p.nodes.length, 'the whole-graph program holds every component');
        });
    }
    it('evaluates each shared component once', () => {
        const c = compileGraph(getPreset('bipolar'));
        assert.equal(c.order.filter(x => x === 'turbulence').length, 1);
        assert.equal(codeOnly(c.fragment).match(/nebulaTurbulence\(/g).length, 2, 'one call plus the library definition');
    });
    it('a view program contains only the target’s subgraph', () => {
        const p = getPreset('bipolar');
        p.nodes.push(makeNode('solid', 'unused'));
        assert(!compileGraph(p).order.includes('unused'));
        assert(compileProgram(p).order.includes('unused'));
        assert.deepEqual(subgraph(p, 'shell').sort(), ['shell', 'space']);
    });
    it('an unconnected coordinate socket is zero, not implicit world space', () => {
        const p = getPreset('bipolar');
        delete p.nodes[1].inputs.p;
        assert(compileGraph(p).fragment.includes('nebulaGeometry(vec2(0),'));
    });
    it('reports each target’s type; looks color non-layer types', () => {
        const p = getPreset('bipolar');
        assert.equal(compileGraph(p, 'shell').type, 'geometry');
        assert.equal(compileGraph(p, 'turbulence').type, 'scalar');
        assert.equal(compileGraph(p, 'space').type, 'coord');
        const source = compileGraph(p, 'turbulence').fragment;
        assert(source.includes('tanh(') && source.includes('vec3 present(vec4 f)'));
    });
    it('names parameters with readable aliases packed into u_params', () => {
        const c = compileProgram(getPreset('bipolar')), shell = c.index.shell;
        assert(c.fragment.includes(`#define n${shell}_pinch u_params[`));
        assert(c.fragment.includes(`nebulaGeometry(n${c.index.space},n${shell}_pinch,n${shell}_shear,n${shell}_shells)`));
        for (const slot of c.params) {
            assert(c.order.includes(slot.node));
            assert(slot.vector < c.vectors && slot.component < 4);
            const alias = `n${c.index[slot.node]}_${slot.param}`;
            assert.equal(codeOnly(c.fragment).split(`#define ${alias} `).length, 2, alias);
        }
        const used = new Set(c.params.map(s => `${s.vector}.${s.component}`));
        assert.equal(used.size, c.params.length, 'no two parameters share a slot');
        assert(c.fragment.includes(`uniform vec4 u_params[${c.vectors}];`));
    });
    it('packs numbers four to a vector and gives each color its own vector', () => {
        const p = getPreset('marble'), c = compileProgram(p);
        const colors = c.params.filter(s => s.kind === 'color'), numbers = c.params.filter(s => s.kind === 'number');
        assert.equal(colors.length, 2);
        assert(colors.every(s => s.component === 0 && !numbers.some(n => n.vector === s.vector)));
        assert.equal(c.vectors, colors.length + Math.ceil(numbers.length / 4));
    });
    it('the source ignores values, enabled flags and the output choice', () => {
        const p = getPreset('bipolar'), a = compileProgram(p).fragment;
        p.nodes[1].params.pinch = .6;
        p.nodes.find(n => n.id === 'stars').enabled = false;
        p.output = 'gas';
        assert.equal(a, compileProgram(p).fragment);
        assert.equal(programKey(getPreset('bipolar')), programKey(p));
    });
    it('wiring and custom expression edits change the source', () => {
        const p = getPreset('kaleidoscope'), a = compileProgram(p).fragment, key = programKey(p);
        p.nodes.find(n => n.id === 'petals').params = { expression: '0.1' }; // no parameters declared any more
        assert.notEqual(a, compileProgram(p).fragment);
        assert.notEqual(key, programKey(p));
        const q = getPreset('marble');
        const before = programKey(q);
        q.nodes.find(n => n.id === 'veins').inputs.p = 'space';
        assert.notEqual(before, programKey(q));
    });
    it('every component can be bypassed at run time', () => {
        const p = getPreset('lensing'), c = compileProgram(p), lens = c.index.lens, space = c.index.space;
        assert(c.fragment.includes(`if(evaluated(${lens})){ if(included(${lens})) n${lens}=clusterLens(`));
        assert(c.fragment.includes(`else n${lens}=n${space}; }`), 'a bypassed lens passes its coordinates through');
        const q = getPreset('bipolar'), d = compileProgram(q), stars = d.index.stars;
        assert(d.fragment.includes(`else n${stars}=vec4(0); }`), 'content without a bypass becomes zero');
    });
    it('the angular mirror uses the shared helper', () => {
        assert(compileProgram(getPreset('kaleidoscope')).fragment.includes('angularMirror('));
    });
    it('rejects unknown targets and styles', () => {
        const p = getPreset('fire');
        assert.throws(() => compileGraph(p, 'nope'), /Unknown component/);
        assert.throws(() => compileGraph(p, p.output, { contribution: 'flame', contributionStyle: 'rainbow' }), /style/);
        assert.throws(() => compileGraph(p, p.output, { contribution: 'nope' }), /Unknown contribution/);
        assert.deepEqual(CONTRIBUTION_STYLES, ['highlight', 'signed']);
        assert.deepEqual(MODES, { display: 0, raw: 1 });
    });
});

describe('view state', () => {
    it('evaluates only what the target needs', () => {
        const p = getPreset('bipolar'), c = compileProgram(p), s = viewState(c, p, 'turbulence');
        assert.deepEqual(s.order, ['space', 'shell', 'turbulence']);
        for (const id of c.order) {
            assert.equal(bit(s.active, c.index[id]), s.order.includes(id), id);
        }
    });
    it('a disabled component pulls in only its bypass input', () => {
        const p = getPreset('lensing');
        p.nodes.find(n => n.id === 'final').enabled = false; // Add light passes `a` (backdrop)
        const c = compileProgram(p), s = viewState(c, p, 'final');
        assert(!s.order.includes('cluster'));
        assert(s.order.includes('backdrop'));
        assert(!bit(s.enabled, c.index.final) && bit(s.enabled, c.index.backdrop));
    });
    it('the second image of what a component changes bypasses it', () => {
        const p = getPreset('bipolar'), q = withBypassed(p, 'stars');
        assert.equal(q.nodes.find(n => n.id === 'stars').enabled, false);
        assert.equal(p.nodes.find(n => n.id === 'stars').enabled, true, 'the original is untouched');
        const c = compileProgram(p);
        assert.equal(bit(viewState(c, q, 'final').enabled, c.index.stars), false);
    });
    it('reports whether a contribution can change the target', () => {
        const p = getPreset('bipolar');
        p.nodes.push(makeNode('solid', 'unused'));
        const c = compileProgram(p);
        assert.equal(viewState(c, p, 'final', 'stars').reachable, true);
        assert.equal(viewState(c, p, 'final', 'unused').reachable, false);
        assert.throws(() => viewState(compileGraph(p, 'shell'), p, 'final'), /does not contain/);
    });
    it('masks set one bit per contained node', () => {
        const c = { index: Object.fromEntries(Array.from({ length: 70 }, (_, k) => [`n${k}`, k])) };
        const mask = nodeMask(c, ['n0', 'n31', 'n32', 'n69', 'missing']);
        assert.equal(mask[0], (1 | 2 ** 31) >>> 0);
        assert.equal(mask[1], 1);
        assert.equal(mask[2], 1 << 5);
        assert.equal(mask[3], 0);
    });
});

describe('compileGraph descriptions', () => {
    it('describes raw and contribution views without changing the source', () => {
        const p = getPreset('bipolar');
        const plain = compileGraph(p), raw = compileGraph(p, 'turbulence', { raw: true }), effect = compileGraph(p, p.output, { contribution: 'stars' });
        assert.equal(raw.raw, true);
        assert.equal(effect.contribution, 'stars');
        assert.equal(effect.contributionStyle, 'highlight');
        assert.equal(effect.reachable, true);
        assert.equal(plain.fragment, effect.fragment);
        assert(plain.fragment.includes('if(u_mode==1){outputColor=field;return;}'));
        assert(!plain.fragment.includes('fieldColors') && !plain.fragment.includes('u_without'), 'looks and comparisons are separate passes, not part of the graph program');
        assert(comparePassSource.includes('uniform highp sampler2D u_without;') && comparePassSource.includes('u_style==1'));
    });
    it('lists the nodes a view evaluates with the current enabled flags', () => {
        const p = getPreset('bipolar');
        p.nodes.find(n => n.id === 'stars').enabled = false;
        const c = compileGraph(p);
        assert(c.order.includes('stars'), 'the program still contains the bypassed node');
        assert(c.evaluated.includes('stars'), 'a bypassed content node is still visited (it yields zero)');
        p.nodes.find(n => n.id === 'final').enabled = false;
        assert(!compileGraph(p).evaluated.includes('stars'), 'a bypassed combiner visits only its main input');
    });
});
