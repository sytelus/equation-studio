import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeRenderer, probeSoftwareFallback } from '../src/gpu-info.js';

describe('describeRenderer', () => {
    const cases = [
        ['ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'hardware', 'NVIDIA GeForce RTX 5070', 'Direct3D 11'],
        ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'hardware', 'Intel(R) UHD Graphics 620', 'Direct3D 11'],
        ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'hardware', 'Apple M2 Pro', 'Metal'],
        ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software', 'SwiftShader (software)', 'Vulkan'],
        ['Apple GPU', 'hardware', 'Apple GPU', null],
        ['NVIDIA GeForce GTX 980, or similar', 'hardware', 'NVIDIA GeForce GTX 980', null],
        ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software', 'llvmpipe (LLVM 15.0.7, 256 bits)', null],
        ['Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'hardware', 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)', null],
        ['Microsoft Basic Render Driver', 'software', 'Microsoft Basic Render Driver', null]
    ];
    for (const [raw, kind, name, api] of cases) {
        it(raw, () => {
            const d = describeRenderer(raw);
            assert.equal(d.kind, kind);
            assert.equal(d.name, name);
            assert.equal(d.api, api);
            assert.equal(d.raw, raw);
        });
    }
    it('reports an empty string as unknown', () => {
        assert.deepEqual(describeRenderer('', 'Vendor'), { kind: 'unknown', name: 'Vendor', api: null, raw: '' });
    });
});

describe('probeSoftwareFallback', () => {
    const canvas = contexts => () => ({ getContext: (type, options = {}) => contexts(options) });
    const context = () => ({ getExtension: () => ({ loseContext() {} }) });
    it('is false when a context is available without a performance caveat', () => {
        assert.equal(probeSoftwareFallback(canvas(() => context())), false);
    });
    it('is true when only a caveated context is available', () => {
        assert.equal(probeSoftwareFallback(canvas(o => o.failIfMajorPerformanceCaveat ? null : context())), true);
    });
    it('is null without WebGL 2', () => {
        assert.equal(probeSoftwareFallback(canvas(() => null)), null);
    });
});
