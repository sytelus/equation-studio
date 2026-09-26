import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compositionTeX, formulaSheet, shortLabel } from '../src/formula.js';
import { getPreset, presets } from '../src/presets.js';
import { texToMathML } from '../src/math-render.js';
import { makeNode } from '../src/graph.js';

describe('formula sheet', () => {
    it('writes the nebula as gas plus core plus stars', () => {
        assert.equal(compositionTeX(getPreset('bipolar')), '\\text{image} = \\text{Gas emission} + \\text{Central glow} + \\text{Folded star lattices}');
    });
    it('writes stacking with over and keeps gains', () => {
        const water = compositionTeX(getPreset('water'));
        assert.equal(water, '\\text{image} = \\left(\\text{Cyclonic water planet}\\ \\text{over}\\ \\text{Seeded star field}\\right) + \\text{Atmospheric rim}');
        const p = getPreset('water');
        p.nodes.find(n => n.id === 'final').params.gain = 0.5;
        assert(compositionTeX(p).includes('+ 0.5\\,\\text{Atmospheric rim}'));
    });
    it('follows bypassed components the way the renderer does', () => {
        const p = getPreset('bipolar');
        p.nodes.find(n => n.id === 'final').enabled = false; // Add light passes a (gas + core)
        assert.equal(compositionTeX(p), '\\text{image} = \\text{Gas emission} + \\text{Central glow}');
        p.nodes.find(n => n.id === 'gas').enabled = false; // content bypassed: zero
        assert.equal(compositionTeX(p), '\\text{image} = 0 + \\text{Central glow}');
    });
    it('parenthesizes an over inside a sum', () => {
        const p = getPreset('water');
        p.nodes.push(makeNode('add', 'twice', { a: 'final', b: 'planetOverStars' }));
        p.output = 'twice';
        assert(compositionTeX(p).includes('\\left(\\text{Cyclonic water planet}\\ \\text{over}\\ \\text{Seeded star field}\\right)'), compositionTeX(p));
    });
    it('typesets for every preset', () => {
        for (const preset of presets) {
            texToMathML(compositionTeX(preset));
        }
    });
    it('lists inputs and uses in evaluation order', () => {
        const sheet = formulaSheet(getPreset('bipolar'));
        assert.deepEqual(sheet.map(e => e.node.id), ['space', 'shell', 'turbulence', 'cloud', 'gas', 'core', 'stars', 'gascore', 'final']);
        const gas = sheet.find(e => e.node.id === 'gas');
        assert.deepEqual(gas.inputs.map(i => [i.socket, i.symbol, i.source.id]), [['p', 'p', 'space'], ['geometry', 'A', 'shell'], ['turbulence', 'E', 'turbulence'], ['cloud', 'K', 'cloud']]);
        assert.deepEqual(gas.uses.map(u => [u.node.id, u.socket, u.symbol]), [['gascore', 'a', 'A']]);
        assert.equal(sheet.at(-1).isOutput, true);
        assert.equal(shortLabel({ label: 'Gas emission · Hgas', id: 'gas' }), 'Gas emission');
    });
});
