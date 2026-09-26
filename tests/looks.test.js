import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COLORMAPS, sampleColormap, colormapGLSL, colormapCSS, niceStep, fieldStats, scalarRange, gridStep, layerGain, displayChannel, paintTile, lookForStats, lookUniforms, hexToRGB, presentGLSL, lookPassSource } from '../src/looks.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('colormaps', () => {
    it('interpolate between their stops and clamp outside 0–1', () => {
        for (const stops of Object.values(COLORMAPS)) {
            assert.deepEqual(sampleColormap(stops, 0), hexToRGB(stops[0][1]));
            assert.deepEqual(sampleColormap(stops, 1), hexToRGB(stops.at(-1)[1]));
            assert.deepEqual(sampleColormap(stops, -3), sampleColormap(stops, 0));
            assert.deepEqual(sampleColormap(stops, 7), sampleColormap(stops, 1));
            const [a, ca] = stops[1], [b, cb] = stops[2], mid = sampleColormap(stops, (a + b) / 2);
            const expected = hexToRGB(ca).map((v, k) => (v + hexToRGB(cb)[k]) / 2);
            mid.forEach((v, k) => assert(close(v, expected[k], 1e-12)));
        }
    });
    it('the diverging map is darkest at zero (t = ½)', () => {
        const lum = c => c[0] + c[1] + c[2];
        const zero = lum(sampleColormap(COLORMAPS.diverging, 0.5));
        for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
            assert(lum(sampleColormap(COLORMAPS.diverging, t)) > zero, t);
        }
    });
    it('generates GLSL and CSS from the same stops', () => {
        const glsl = colormapGLSL('m', COLORMAPS.sequential);
        assert(glsl.startsWith('vec3 m(float t) {'));
        assert.equal(glsl.match(/if\(t<=/g).length, COLORMAPS.sequential.length - 1);
        assert(!/NaN|undefined/.test(glsl));
        assert(colormapCSS(COLORMAPS.diverging).startsWith('linear-gradient(90deg, #c4ecff 0.0%'));
        assert(presentGLSL.includes('vec3 present(vec4 f)') && !presentGLSL.includes('fwidth('), 'the graph program keeps only the classic conversion');
        assert(lookPassSource.startsWith('#version 300 es') && lookPassSource.includes('fwidth(') && lookPassSource.includes('texelFetch(u_field'));
    });
});

describe('statistics and ranges', () => {
    it('niceStep picks 1–2–5 steps', () => {
        assert.equal(niceStep(0.37), 0.5);
        assert.equal(niceStep(1), 1);
        assert(close(niceStep(0.12), 0.2));
        assert.equal(niceStep(7), 10);
        assert(close(niceStep(0.001), 0.001));
        assert.equal(niceStep(0), 1);
        assert.equal(niceStep(NaN), 1);
    });
    it('fieldStats summarizes one channel and skips nonfinite values', () => {
        const data = new Float32Array(4 * 1001);
        for (let i = 0; i <= 1000; i++) {
            data[i * 4] = i / 1000; // 0 … 1 in channel 0
            data[i * 4 + 1] = 5;
        }
        data[8] = NaN;
        const s = fieldStats(data);
        assert.equal(s.count, 1000);
        assert.equal(s.nonfinite, 1);
        assert.equal(s.min, 0);
        assert.equal(s.max, 1);
        assert(close(s.median, 0.5, 0.003));
        assert(close(s.lo, 0.005, 0.003) && close(s.hi, 0.995, 0.003));
        assert.equal(s.histogram.reduce((a, b) => a + b, 0), 1000);
        assert.equal(fieldStats(data, { channel: 1 }).min, 5);
        assert.equal(fieldStats(new Float32Array([NaN, 0, 0, 0]), { stride: 4 }).count, 0);
    });
    it('scalarRange is symmetric for signed fields and flags constants', () => {
        const signed = scalarRange({ count: 10, lo: -0.5, hi: 2 });
        assert.deepEqual([signed.lo, signed.hi, signed.signed], [-2, 2, true]);
        assert(signed.contour > 0);
        const positive = scalarRange({ count: 10, lo: 0.2, hi: 0.9 });
        assert.equal(positive.signed, false);
        assert.equal(positive.lo, 0.2);
        const barely = scalarRange({ count: 10, lo: -0.001, hi: 1 });
        assert.equal(barely.signed, false, 'a negligible negative tail is not a sign change');
        const constant = scalarRange({ count: 10, lo: 3, hi: 3 });
        assert(constant.constant && constant.lo < 3 && constant.hi > 3 && constant.contour === 0);
        assert.equal(scalarRange(null).signed, true);
    });
    it('gridStep gives about eight cells across the view', () => {
        assert.equal(gridStep({ count: 1, lo: -2.38, hi: 2.38 }, { count: 1, lo: -1.4, hi: 1.4 }), 1);
        assert.equal(gridStep(null, null), 0.5);
    });
    it('layerGain keeps readable layers natural and rescues clipped or black ones', () => {
        assert.equal(layerGain({ count: 10, hi: 0.9, median: 0.3 }), 1);
        assert(layerGain({ count: 10, hi: 90, median: 40 }) < 0.02);
        assert(layerGain({ count: 10, hi: 0.001, median: 0.0005 }) > 100);
        assert.equal(layerGain(null), 1);
    });
});

describe('display conversion twin', () => {
    it('matches the source mapping F', () => {
        assert.equal(displayChannel(0, 'source'), 0);
        assert.equal(displayChannel(-1, 'source'), 0);
        assert.equal(displayChannel(0.5, 'source'), 127 / 255);
        assert.equal(displayChannel(2, 'source'), 1);
    });
    it('matches filmic and linear', () => {
        assert.equal(displayChannel(0, 'filmic'), 0);
        assert(close(displayChannel(1, 'filmic'), Math.pow(1 - Math.exp(-1), 1 / 2.2)));
        assert.equal(displayChannel(-1, 'filmic'), 0);
        assert.equal(displayChannel(3, 'linear'), 1);
        assert.equal(displayChannel(0.25, 'linear'), 0.25);
    });
});

describe('painting tiles', () => {
    const tile = values => new Float32Array(values);
    it('colors a signed scalar with the diverging map', () => {
        const values = tile([-1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1]);
        const look = lookForStats(values, 'scalar');
        assert.equal(look.range.signed, true);
        const bytes = paintTile(values, 3, 1, { type: 'scalar', ...look });
        const zero = sampleColormap(COLORMAPS.diverging, 0.5).map(v => Math.round(v * 255));
        assert.deepEqual([...bytes.slice(4, 7)], zero);
        assert.equal(bytes[3], 255);
    });
    it('paints nonfinite values magenta', () => {
        const bytes = paintTile(tile([NaN, 0, 0, 1]), 1, 1, { type: 'scalar', mode: 'classic' });
        assert.deepEqual([...bytes], [255, 0, 255, 255]);
    });
    it('keeps the classic diagnostics', () => {
        const bytes = paintTile(tile([0, 0, 0, 1]), 1, 1, { type: 'coord', mode: 'classic' });
        assert.deepEqual([...bytes.slice(0, 3)], [128, 128, 128]);
        const geometry = paintTile(tile([0, 0.25, 1, 1]), 1, 1, { type: 'geometry', mode: 'classic' });
        assert.deepEqual([...geometry.slice(0, 3)], [255, 255, 128]);
    });
    it('auto-exposes an over-bright layer but keeps the final output natural', () => {
        const values = new Float32Array(400);
        for (let i = 0; i < 100; i++) {
            values.set([40 + i, 30, 20, 1], i * 4);
        }
        const auto = lookForStats(values, 'layer', { exposure: 1 });
        assert(auto.gain < 0.05);
        assert.equal(lookForStats(values, 'layer', { natural: true }).gain, 1);
        const bytes = paintTile(values, 10, 10, { type: 'layer', ...auto, tone: 'linear' });
        assert(bytes[0] < 255, 'no longer clipped');
    });
    it('draws grid lines and axes for coordinates', () => {
        const width = 21, values = new Float32Array(width * 4);
        for (let x = 0; x < width; x++) {
            values.set([(x - 10) * 0.1, 0.33, 0, 1], x * 4);
        }
        const bytes = paintTile(values, width, 1, { type: 'coord', mode: 'auto', step: 0.5 });
        assert.deepEqual([...bytes.slice(40, 43)], [242, 115, 102], 'q_x = 0 is the red axis');
    });
});

describe('look uniforms', () => {
    it('map a look to shader codes', () => {
        assert.deepEqual(lookUniforms('scalar', {}), { type: 1, look: 0, channel: 0, range: [-1, 1, 1, 0], gain: 1, grid: 0.5 });
        const u = lookUniforms('geometry', { mode: 'auto', channel: 1, range: { lo: 0, hi: 2, signed: false, contour: 0.2 } });
        assert.deepEqual([u.type, u.look, u.channel, u.range], [2, 1, 1, [0, 2, 0, 0.2]]);
        assert.equal(lookUniforms('layer', { mode: 'alpha' }).look, 2);
    });
});
