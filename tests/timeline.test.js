import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreset } from '../src/presets.js';
import { validateProject } from '../src/graph.js';
import { interpolateTrack, insertKey, moveKey, loopTime, animatedParameters } from '../src/timeline.js';

const track = { node: 'x', param: 'p', interpolation: 'linear', keys: [{ time: 0, value: 0 }, { time: 2, value: 10 }, { time: 4, value: 0 }] };

describe('interpolation', () => {
    it('linear keyframes and held endpoints', () => {
        assert.equal(interpolateTrack(track, -1, 99), 0);
        assert.equal(interpolateTrack(track, 1, 99), 5);
        assert.equal(interpolateTrack(track, 2, 99), 10);
        assert.equal(interpolateTrack(track, 5, 99), 0);
    });
    it('smooth and hold interpolation', () => {
        assert.equal(interpolateTrack({ ...track, interpolation: 'smooth' }, .5, 0), 1.5625);
        assert.equal(interpolateTrack({ ...track, interpolation: 'hold' }, 1, 0), 0);
    });
    it('empty keyframe track falls back to base', () => {
        assert.equal(interpolateTrack({ ...track, keys: [] }, 2, 123), 123);
    });
    it('sampling does not mutate base params', () => {
        const p = getPreset('lensing'), n = p.nodes.find(n => n.id === 'lens');
        assert.equal(animatedParameters(p, n, 4).strength, .05);
        assert.equal(n.params.strength, 1.45);
    });
    it('loop time wraps negative and positive values', () => {
        assert.equal(loopTime(9, 8), 1);
        assert.equal(loopTime(-1, 8), 7);
    });
});

describe('key editing', () => {
    it('inserting a key replaces the same timestamp and keeps sort order', () => {
        const p = getPreset('bipolar');
        insertKey(p, 'shell', 'pinch', 2, .6);
        insertKey(p, 'shell', 'pinch', 0, .3);
        insertKey(p, 'shell', 'pinch', 2, .4);
        assert.deepEqual(p.tracks[0].keys, [{ time: 0, value: .3 }, { time: 2, value: .4 }]);
        validateProject(p);
    });
    it('moving a key retimes it and replaces any key at the destination', () => {
        const p = getPreset('lensing');
        moveKey(p, 'lens', 'strength', 4, 6.0004);
        assert.deepEqual(p.tracks[0].keys.map(k => k.time), [0, 6, 8]);
        assert.equal(p.tracks[0].keys[1].value, .05);
        moveKey(p, 'lens', 'strength', 6, 8);
        assert.deepEqual(p.tracks[0].keys.map(k => [k.time, k.value]), [[0, 1.45], [8, .05]]);
        assert.throws(() => moveKey(p, 'lens', 'strength', 3, 1), /No key/);
    });
    it('order, duplicate and domain violations are rejected', () => {
        for (const keys of [[{ time: 2, value: .3 }, { time: 1, value: .3 }], [{ time: 1, value: .3 }, { time: 1, value: .4 }], [{ time: 9, value: .4 }], [{ time: 0, value: 8 }]]) {
            const p = getPreset('bipolar');
            p.tracks = [{ node: 'shell', param: 'pinch', interpolation: 'smooth', keys }];
            assert.throws(() => validateProject(p));
        }
    });
    it('a duration decrease cannot silently delete animation keys', () => {
        const p = getPreset('lensing');
        p.duration = 4;
        assert.throws(() => validateProject(p));
    });
});
