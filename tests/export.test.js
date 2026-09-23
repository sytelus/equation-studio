import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, makeZip, frameTimes, fileStem, embedPNGMetadata } from '../src/export.js';

describe('ZIP writer', () => {
    it('CRC32 standard check value', () => {
        assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    });
    it('writes the local header, CRC, central directory and end record', async () => {
        const bytes = new Uint8Array(await makeZip([{ name: 'a.txt', data: 'hello' }]).arrayBuffer()), v = new DataView(bytes.buffer);
        assert.equal(v.getUint32(0, true), 0x04034b50);
        assert.equal(v.getUint32(14, true), 0x3610a686);
        assert.equal(v.getUint32(bytes.length - 22, true), 0x06054b50);
        assert.equal(v.getUint16(bytes.length - 12, true), 1);
    });
    it('rejects traversal and duplicate names', () => {
        for (const name of ['../evil', '/absolute', 'x\\y']) {
            assert.throws(() => makeZip([{ name, data: 'x' }]));
        }
        assert.throws(() => makeZip([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]));
    });
});

describe('frame sequences and names', () => {
    it('uses exact timestamps and excludes the end point', () => {
        assert.deepEqual(frameTimes(1, 4), [0, .25, .5, .75]);
        assert.equal(frameTimes(8, 24).length, 192);
        assert.throws(() => frameTimes(11, 24), /240/);
        assert.throws(() => frameTimes(1, NaN));
    });
    it('filename sanitization has a safe fallback', () => {
        assert.equal(fileStem('My / test…'), 'my-test');
        assert.equal(fileStem('::::'), 'equation-studio');
    });
});

describe('PNG metadata', () => {
    const minimal = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
    it('inserts an iTXt chunk before IEND and keeps UTF-8 data', async () => {
        const bytes = new Uint8Array(await (await embedPNGMetadata(new Blob([minimal]), { title: 'λ studio' })).arrayBuffer());
        assert.equal(new TextDecoder().decode(bytes.slice(12, 16)), 'iTXt');
        assert(new TextDecoder().decode(bytes).includes('λ studio'));
        assert.deepEqual([...bytes.slice(-12)], [...minimal.slice(-12)]);
    });
    it('rejects other formats', async () => {
        await assert.rejects(() => embedPNGMetadata(new Blob(['jpeg']), {}));
    });
});
