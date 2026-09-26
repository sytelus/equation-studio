import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { presets, getPreset } from '../src/presets.js';
import { makeNode } from '../src/graph.js';
import { compileGraph, CONTRIBUTION_STYLES } from '../src/compiler.js';
import { catalog } from '../src/catalog.js';

/** Count occurrences of a substring outside GLSL line comments. */
const codeOnly = fragment => fragment.replace(/\/\/.*$/gm, '');

describe('shader generation', () => {
    for (const p of presets) {
        it(`compiles the preset: ${p.id}`, () => {
            const c = compileGraph(p);
            assert(c.fragment.startsWith('#version 300 es'));
            assert.equal(c.target, p.output);
            assert(!codeOnly(c.fragment).includes('undefined'));
            assert(c.order.length > 0);
            assert.equal(c.order.at(-1), p.output);
            assert.equal(c.type, catalog[p.nodes.find(n => n.id === p.output).type].output);
        });
    }
    it('reachable shared expressions compile only once', () => {
        const c = compileGraph(getPreset('bipolar'));
        assert.equal(c.order.filter(x => x === 'turbulence').length, 1);
    });
    it('unreachable nodes do not generate shader code', () => {
        const p = getPreset('bipolar');
        p.nodes.push(makeNode('solid', 'unused'));
        assert(!compileGraph(p).order.includes('unused'));
    });
    it('unconnected coordinate socket is zero, not implicit world space', () => {
        const p = getPreset('bipolar');
        delete p.nodes[1].inputs.p;
        assert(compileGraph(p).fragment.includes('nebulaGeometry(vec2(0),'));
    });
    it('isolated scalar, coordinate and geometry use diagnostic conversions', () => {
        const p = getPreset('bipolar');
        assert.equal(compileGraph(p, 'shell').type, 'geometry');
        assert.equal(compileGraph(p, 'turbulence').type, 'scalar');
        assert.equal(compileGraph(p, 'space').type, 'coord');
        assert(compileGraph(p, 'turbulence').fragment.includes('tanh('));
    });
    it('a disabled node is bypassed in the shader', () => {
        const p = getPreset('lensing');
        p.nodes.find(n => n.id === 'lens').enabled = false;
        const c = compileGraph(p), index = c.order.indexOf('lens');
        assert(c.fragment.includes(`vec2 n${index} = n${c.order.indexOf('space')};`));
        const q = getPreset('bipolar');
        q.nodes.find(n => n.id === 'stars').enabled = false;
        const d = compileGraph(q);
        assert(d.fragment.includes(`vec4 n${d.order.indexOf('stars')} = vec4(0);`), 'content without a bypass becomes zero');
    });
    it('raw mode skips display conversion', () => {
        const p = getPreset('bipolar'), raw = compileGraph(p, 'turbulence', { raw: true });
        assert.equal(raw.raw, true);
        assert(raw.fragment.includes('outputColor=field;return;'));
        assert(!raw.fragment.includes('tanh('));
    });
    it('changing numbers preserves shader source', () => {
        const p = getPreset('bipolar'), a = compileGraph(p).fragment;
        p.nodes[1].params.pinch = .6;
        assert.equal(a, compileGraph(p).fragment);
    });
    it('custom expression edits change shader source', () => {
        const p = getPreset('kaleidoscope'), a = compileGraph(p).fragment;
        p.nodes.find(n => n.id === 'petals').params.expression = '0.1';
        assert.notEqual(a, compileGraph(p).fragment);
    });
    it('the angular mirror uses the shared helper', () => {
        assert(compileGraph(getPreset('kaleidoscope')).fragment.includes('angularMirror('));
    });
    it('every uniform is declared exactly once and belongs to a reachable node', () => {
        const p = getPreset('lensing'), c = compileGraph(p);
        for (const u of c.uniforms) {
            assert(c.order.includes(u.node));
            assert.equal(codeOnly(c.fragment).split(`uniform ${u.type} ${u.name};`).length, 2);
        }
    });
});

describe('contribution mode', () => {
    it('evaluates the output with and without the node', () => {
        const p = getPreset('bipolar'), c = compileGraph(p, p.output, { contribution: 'stars' });
        assert.equal(c.contribution, 'stars');
        assert.equal(c.contributionStyle, 'highlight');
        assert.equal(c.reachable, true);
        assert(c.fragment.includes('vec4 shadeWithout(vec2 p)'));
        // The node's own statement is zeroed only in the "without" variant.
        const [withNode, without] = c.fragment.split('vec4 shadeWithout');
        assert(withNode.includes('nebulaStars('));
        assert(without.includes('vec4 n') && without.includes('= vec4(0);'));
    });
    it('removes a modifier by bypassing it, not by zeroing it', () => {
        const p = getPreset('lensing'), c = compileGraph(p, p.output, { contribution: 'lens' });
        const without = c.fragment.split('vec4 shadeWithout')[1], index = c.order.indexOf('lens'), source = c.order.indexOf('space');
        assert(without.includes(`vec2 n${index} = n${source};`), 'the lens passes the coordinates through');
    });
    it('reports unreachable nodes and still compiles', () => {
        const p = getPreset('bipolar');
        p.nodes.push(makeNode('solid', 'unused'));
        const c = compileGraph(p, p.output, { contribution: 'unused' });
        assert.equal(c.reachable, false);
        assert(c.fragment.includes('shadeWithout'));
    });
    it('supports every documented style and rejects others', () => {
        const p = getPreset('fire');
        const sources = CONTRIBUTION_STYLES.map(style => compileGraph(p, p.output, { contribution: 'flame', contributionStyle: style }).fragment);
        assert.equal(new Set(sources).size, CONTRIBUTION_STYLES.length);
        assert.throws(() => compileGraph(p, p.output, { contribution: 'flame', contributionStyle: 'rainbow' }), /style/);
        assert.throws(() => compileGraph(p, p.output, { contribution: 'nope' }), /Unknown contribution/);
    });
});

describe('preview mode', () => {
    it('computes every node once and selects by index', () => {
        const p = getPreset('bipolar');
        p.nodes.push(makeNode('solid', 'unused'));
        const c = compileGraph(p, p.output, { preview: true });
        assert.equal(c.preview, true);
        assert.equal(c.target, null);
        assert.equal(Object.keys(c.previewIndex).length, p.nodes.length);
        assert(c.fragment.includes('vec4 shade(vec2 p,int index)'));
        assert(c.fragment.includes('shade(p,u_previewIndex)'));
        for (const [id, k] of Object.entries(c.previewIndex)) {
            assert(c.fragment.includes(`if(index==${k}) return`), id);
        }
    });
    it('layers are display-converted inside the preview shader', () => {
        const c = compileGraph(getPreset('fire'), null, { preview: true });
        assert(c.fragment.includes('displayColor(n1.rgb,u_exposure,u_tone)'));
    });
});
