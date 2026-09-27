import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { encodeGIF, medianCutPalette, lzw, indexFrame, assembleAPNG, pngChunks, muxMP4, sheetLayout } from '../src/encoders.js';
import { crc32 } from '../src/export.js';
import { standalonePage, codeFile } from '../src/standalone.js';
import { getPreset } from '../src/presets.js';
import { channelStats, histogram, loopReport, ownCosts, meanDifference } from '../src/stats.js';

/** Decode GIF LZW data sub-blocks back to indices (the reference algorithm). */
function unlzw(blocks, minCodeSize) {
    const bytes = [];
    for (let i = 0; blocks[i]; i += blocks[i] + 1) {
        bytes.push(...blocks.slice(i + 1, i + 1 + blocks[i]));
    }
    const clear = 1 << minCodeSize, end = clear + 1, out = [];
    let size = minCodeSize + 1, dict = [], prev = null, bit = 0;
    const reset = () => {
        dict = Array.from({ length: clear }, (_, k) => [k]);
        dict.push(null, null);
        size = minCodeSize + 1;
        prev = null;
    };
    reset();
    for (;;) {
        let code = 0;
        for (let k = 0; k < size; k++, bit++) {
            code |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << k;
        }
        if (code === clear) {
            reset();
            continue;
        }
        if (code === end) {
            return out;
        }
        const entry = code < dict.length ? dict[code] : [...dict[prev], dict[prev][0]];
        out.push(...entry);
        if (prev !== null && dict.length < 4096) {
            dict.push([...dict[prev], entry[0]]);
        }
        if (dict.length === (1 << size) && size < 12) {
            size++;
        }
        prev = code;
    }
}
function frame(width, height, f) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = f(x, y), i = (y * width + x) * 4;
            data.set([r, g, b, 255], i);
        }
    }
    return data;
}
/** A minimal PNG of solid gray (8-bit RGBA, filter 0), for APNG tests. */
function png(width, height, gray) {
    const raw = new Uint8Array(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        raw.fill(gray, y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4));
    }
    const chunk = (type, data) => {
        const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
        v.setUint32(0, data.length);
        out.set([...type].map(c => c.charCodeAt(0)), 4);
        out.set(data, 8);
        v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
        return out;
    };
    const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
    v.setUint32(0, width);
    v.setUint32(4, height);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
/** The boxes of an MP4 at one level: [{type, start, size}]. */
function boxes(bytes, start = 0, end = bytes.length) {
    const v = new DataView(bytes.buffer, bytes.byteOffset), out = [];
    for (let at = start; at < end;) {
        const size = v.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        out.push({ type, start: at, size });
        at += size;
    }
    return out;
}

describe('GIF', () => {
    it('compresses indices losslessly with GIF’s LZW', () => {
        const indices = Uint8Array.from({ length: 5000 }, (_, k) => (k * 7 + (k >> 5)) % 256);
        assert.deepEqual(unlzw(lzw(indices, 8), 8), [...indices]);
        const flat = new Uint8Array(20000).fill(3);
        assert.deepEqual(unlzw(lzw(flat, 8), 8), [...flat], 'long runs reset the dictionary');
    });
    it('finds a palette that covers the colors used', () => {
        const f = frame(16, 16, x => x < 8 ? [255, 0, 0] : [0, 0, 255]);
        const palette = medianCutPalette([f], 256);
        assert(palette.some(c => c[0] > 240 && c[2] < 15));
        assert(palette.some(c => c[2] > 240 && c[0] < 15));
    });
    it('writes a looping animated GIF', () => {
        const frames = [0, 1, 2].map(k => frame(20, 10, (x, y) => [x * 12, y * 25, k * 100]));
        const gif = encodeGIF(frames, 20, 10, 4);
        assert.equal(String.fromCharCode(...gif.subarray(0, 6)), 'GIF89a');
        assert.equal(gif[6] | (gif[7] << 8), 20);
        assert.equal(gif[8] | (gif[9] << 8), 10);
        assert(String.fromCharCode(...gif).includes('NETSCAPE2.0'), 'loops forever');
        assert.equal(gif.at(-1), 0x3b, 'ends with the trailer');
        assert.equal([...gif].filter((b, i) => b === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4).length, 3, 'one graphic control block per frame');
    });
    it('maps a flat color frame to one index', () => {
        const f = frame(8, 8, () => [30, 60, 90]), palette = [[0, 0, 0], [30, 60, 90], [255, 255, 255]];
        const lut = new Uint8Array(32768).fill(1);
        assert(indexFrame(f, 8, lut, 0).every(i => i === 1));
        void palette;
    });
});

describe('Animated PNG', () => {
    it('re-chunks PNG frames into acTL, fcTL, IDAT and fdAT with a sequence', () => {
        const apng = assembleAPNG([png(4, 3, 10), png(4, 3, 200), png(4, 3, 90)], 12);
        const chunks = pngChunks(apng);
        assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'fcTL', 'fdAT', 'IEND']);
        const actl = new DataView(chunks[1].data.buffer, chunks[1].data.byteOffset);
        assert.equal(actl.getUint32(0), 3, 'three frames');
        assert.equal(actl.getUint32(4), 0, 'loops forever');
        const sequences = chunks.filter(c => c.type === 'fcTL' || c.type === 'fdAT').map(c => new DataView(c.data.buffer, c.data.byteOffset).getUint32(0));
        assert.deepEqual(sequences, [0, 1, 2, 3, 4], 'one sequence across fcTL and fdAT');
        // Every chunk's CRC checks.
        const v = new DataView(apng.buffer);
        for (let at = 8; at < apng.length;) {
            const length = v.getUint32(at);
            assert.equal(v.getUint32(at + 8 + length), crc32(apng.subarray(at + 4, at + 8 + length)));
            at += 12 + length;
        }
        assert.throws(() => assembleAPNG([png(4, 3, 1), png(5, 3, 1)], 12), /same size/);
    });
});

describe('MP4', () => {
    it('writes ftyp, moov and mdat with sample tables pointing into mdat', () => {
        const samples = [0, 1, 2, 3].map(k => ({ data: new Uint8Array([0, 0, 0, 2, 0x65 + k, k]), key: k === 0, timestamp: k * 40000 }));
        const mp4 = muxMP4(samples, { width: 64, height: 48, fps: 25, description: new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 0]) });
        const top = boxes(mp4);
        assert.deepEqual(top.map(b => b.type), ['ftyp', 'moov', 'mdat']);
        const mdat = top[2];
        assert.equal(mdat.size, 8 + 4 * 6);
        const text = String.fromCharCode(...mp4);
        for (const type of ['mvhd', 'trak', 'tkhd', 'mdia', 'mdhd', 'hdlr', 'minf', 'vmhd', 'stbl', 'stsd', 'avc1', 'avcC', 'stts', 'stss', 'stsc', 'stsz', 'stco']) {
            assert(text.includes(type), type);
        }
        assert(!text.includes('ctts'), 'no composition offsets without reordering');
        const stco = text.indexOf('stco'), offset = new DataView(mp4.buffer).getUint32(stco + 12);
        assert.equal(offset, mdat.start + 8, 'the chunk offset is the start of the samples');
        assert.equal(mp4[offset + 4], 0x65, 'first sample data');
    });
});

describe('sprite sheets and statistics', () => {
    it('lays frames out in a near-square grid', () => {
        const layout = sheetLayout(16, 100, 60);
        assert.equal(layout.cells.length, 16);
        assert(layout.columns * layout.rows >= 16);
        assert.deepEqual(layout.cells[1], { x: 100, y: 0 });
        assert.throws(() => sheetLayout(400, 1000, 1000), /do not fit/);
    });
    it('measures channels, clipping, histograms and loops', () => {
        const values = new Float32Array([0, 0, 0, 1, 2, 0.5, 0.25, 1, NaN, 0, 0, 1, 0.5, 0.5, 0.5, 1]);
        const s = channelStats(values, 'layer');
        assert.equal(s.nonfinite, 0.25);
        assert.equal(s.clipped, 0.25);
        assert.equal(s.black, 0.25);
        assert.equal(s.channels[0].max, 2);
        const h = histogram(values, 'layer', 4);
        assert.equal(h.counts.reduce((a, b) => a + b, 0), 3);
        const f = k => new Float32Array([k, 0, 0, 1, k * 2, 0, 0, 1]);
        const smooth = loopReport([f(0), f(0.1), f(0.2), f(0.1), f(0)], 'scalar');
        assert(smooth.seamless, 'returns to the start');
        const jump = loopReport([f(0), f(0.1), f(0.2), f(0.3), f(0.4)], 'scalar');
        assert(!jump.seamless, 'ends far from the start');
        assert.equal(meanDifference(f(0), f(0.5), 'scalar'), 0.75);
        assert.deepEqual(ownCosts({ a: 1, b: 3, c: 5 }, id => ({ a: [], b: ['a'], c: ['b', 'a'] }[id])), { a: 1, b: 2, c: 2 });
    });
});

describe('web page and code export', () => {
    it('writes a self-contained page with the compiled shaders and the credit', () => {
        const html = standalonePage(getPreset('vortex'));
        assert(html.startsWith('<!doctype html>'));
        assert(html.includes('Vortex by Xor (@XorDev)'));
        const json = html.slice(html.indexOf('const S=') + 8, html.indexOf(';\nconst canvas'));
        const scene = JSON.parse(json);
        assert(scene.fragment.includes('vec4 code_n1(vec2 p,float time,int show)'));
        assert.equal(scene.frames, 1, 'no keyframes: one set of parameters');
        assert(!html.includes('<script src'), 'nothing is fetched');
        const points = JSON.parse((h => h.slice(h.indexOf('const S=') + 8, h.indexOf(';\nconst canvas')))(standalonePage(getPreset('point-jellyfish'))));
        assert.equal(points.clouds.length, 1);
        assert.equal(points.clouds[0].count, 20000);
    });
    it('exports code with parameters written as declarations', () => {
        const node = { type: 'code', params: { code: 'param zoom = 2 [0, 4]\nparam tint = #ff0000\no.rgb = tint*zoom;', zoom: 3, tint: '#00ff00' } };
        const text = codeFile(node);
        assert(text.includes('float zoom = 3.;'));
        assert(text.includes('vec3 tint = vec3(0, 1, 0);'));
        assert(!text.includes('param '));
        const work = getPreset('vortex').nodes.find(n => n.work);
        assert(codeFile(work).startsWith('// Vortex: Xor (@XorDev), 19 Nov 2023 · https://x.com/XorDev/status/1726103550986469869'));
    });
});
