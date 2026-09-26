import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreset } from '../src/presets.js';
import { catalog } from '../src/catalog.js';
import { validateProject } from '../src/graph.js';
import { snapToStep, sweepValues, seededRandom, makeVariations, originalValue, isModified, isParamModified } from '../src/explore.js';

describe('parameter sweeps', () => {
    it('snaps to the step and clamps to the range', () => {
        const spec = { kind: 'number', min: 0.05, max: 0.8, step: 0.005 };
        assert.equal(snapToStep(spec, 0.3021), 0.3);
        assert.equal(snapToStep(spec, 5), 0.8);
        assert.equal(snapToStep(spec, -5), 0.05);
    });
    it('spans the whole range, including both ends', () => {
        const spec = catalog.nebulaGeometry.params.pinch, values = sweepValues(spec, 7);
        assert.equal(values.length, 7);
        assert.equal(values[0], spec.min);
        assert.equal(values.at(-1), spec.max);
        assert(values.every((v, i) => i === 0 || v > values[i - 1]));
    });
    it('drops duplicates for coarse integer parameters', () => {
        const values = sweepValues({ kind: 'number', min: 1, max: 4, step: 1 }, 7);
        assert.deepEqual(values, [1, 2, 3, 4]);
    });
    it('rejects non-numeric parameters', () => {
        assert.throws(() => sweepValues({ kind: 'color' }));
    });
});

describe('variations', () => {
    it('is deterministic for a seed and different across seeds', () => {
        const p = getPreset('water');
        const a = makeVariations(p, { nodeId: 'planet', seed: 7 }), b = makeVariations(p, { nodeId: 'planet', seed: 7 }), c = makeVariations(p, { nodeId: 'planet', seed: 8 });
        assert.deepEqual(a.map(v => v.project.nodes.find(n => n.id === 'planet').params), b.map(v => v.project.nodes.find(n => n.id === 'planet').params));
        assert.notDeepEqual(a.map(v => v.changes), c.map(v => v.changes));
    });
    it('produces valid projects that only change the chosen component', () => {
        const p = getPreset('water'), results = makeVariations(p, { nodeId: 'planet', count: 5, amount: 0.5, seed: 3 });
        assert.equal(results.length, 5);
        for (const { project, changes } of results) {
            validateProject(project);
            assert(changes.every(ch => ch.node === 'planet'));
            for (const n of project.nodes.filter(n => n.id !== 'planet')) {
                assert.deepEqual(n.params, p.nodes.find(o => o.id === n.id).params);
            }
        }
    });
    it('skips animated parameters and can vary the whole scene', () => {
        const p = getPreset('lensing'), results = makeVariations(p, { seed: 11, count: 4 });
        for (const { changes } of results) {
            assert(!changes.some(ch => ch.node === 'lens' && ch.param === 'strength'), 'keyed parameter untouched');
        }
        assert(results.some(r => new Set(r.changes.map(c => c.node)).size > 1), 'scene variations touch several components');
    });
    it('rejects unknown components', () => {
        assert.throws(() => makeVariations(getPreset('fire'), { nodeId: 'missing' }));
    });
    it('seeded random numbers are in [0, 1)', () => {
        const random = seededRandom(42), values = Array.from({ length: 1000 }, random);
        assert(values.every(v => v >= 0 && v < 1));
        assert(new Set(values).size > 990);
    });
});

describe('original values', () => {
    it('come from the baseline, falling back to the catalog default', () => {
        const baseline = getPreset('water'), stars = baseline.nodes.find(n => n.id === 'stars');
        assert.equal(originalValue(baseline, stars, 'gain'), 0.36, 'preset override, not the catalog default 0.7');
        const added = { id: 'extra', type: 'scatterStars', params: { gain: 2 } };
        assert.equal(originalValue(baseline, added, 'gain'), catalog.scatterStars.params.gain.value);
    });
    it('a node replaced by another type resets to the new type’s defaults', () => {
        const baseline = getPreset('bipolar'), replaced = { id: 'shell', type: 'ringGeometry', params: {} };
        assert.equal(originalValue(baseline, replaced, 'radius'), catalog.ringGeometry.params.radius.value);
    });
    it('detects modified components', () => {
        const baseline = getPreset('bipolar'), project = getPreset('bipolar'), shell = project.nodes.find(n => n.id === 'shell');
        assert.equal(isModified(baseline, project, shell), false);
        shell.params.pinch = 0.5;
        assert.equal(isModified(baseline, project, shell), true);
        assert.equal(isParamModified(baseline, project, shell, 'shear'), false);
    });
    it('counts added or removed animation as a modification', () => {
        const baseline = getPreset('lensing'), project = getPreset('lensing'), lens = project.nodes.find(n => n.id === 'lens');
        assert.equal(isParamModified(baseline, project, lens, 'strength'), false, 'animated in both');
        project.tracks = [];
        assert.equal(isParamModified(baseline, project, lens, 'strength'), true, 'the animation was removed');
    });
});
