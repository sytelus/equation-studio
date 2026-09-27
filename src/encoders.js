import { crc32 } from './export.js';
/** Animation encoders for export, dependency-free and pure (bytes in, bytes out),
 * so each is unit-tested without a browser:
 *
 *   GIF   palette from median cut over all frames, ordered dithering, LZW,
 *         looping forever (Netscape extension). 256 colors: small, universal
 *   APNG  animated PNG assembled from ordinary PNG frames (the browser's own PNG
 *         encoder compresses them; this only re-chunks): full color, lossless
 *   MP4   the ISO BMFF container around H.264 samples from WebCodecs
 *         (ui-export.js encodes; this writes ftyp/moov/mdat): exact frame times
 *   sheet the layout of a sprite sheet: frames in a grid, with their times
 */
// ---- GIF ----------------------------------------------------------------------------
/** A palette of at most `size` colors for RGBA `frames` (Uint8ClampedArray), by
 * median cut over a sample of their pixels: [[r, g, b], …].
 */
export function medianCutPalette(frames, size = 256, maxSamples = 120000) {
    const total = frames.reduce((n, f) => n + f.length / 4, 0), stride = Math.max(1, Math.floor(total / maxSamples));
    const samples = [];
    let k = 0;
    for (const f of frames) {
        for (let i = 0; i < f.length; i += 4, k++) {
            if (k % stride === 0) {
                samples.push([f[i], f[i + 1], f[i + 2]]);
            }
        }
    }
    let boxes = [samples];
    while (boxes.length < size) {
        // Split the box with the widest channel range at its median.
        let best = -1, bestRange = -1, bestChannel = 0;
        boxes.forEach((box, b) => {
            if (box.length < 2) {
                return;
            }
            for (let c = 0; c < 3; c++) {
                let lo = 255, hi = 0;
                for (const p of box) {
                    lo = Math.min(lo, p[c]);
                    hi = Math.max(hi, p[c]);
                }
                if (hi - lo > bestRange) {
                    bestRange = hi - lo;
                    best = b;
                    bestChannel = c;
                }
            }
        });
        if (best < 0 || bestRange <= 0) {
            break;
        }
        const box = boxes[best].sort((a, b) => a[bestChannel] - b[bestChannel]), mid = box.length >> 1;
        boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
    }
    const palette = boxes.filter(b => b.length).map(box => [0, 1, 2].map(c => Math.round(box.reduce((s, p) => s + p[c], 0) / box.length)));
    return palette.length ? palette : [[0, 0, 0]];
}
/** Nearest palette entry for every 5-bit-per-channel color (a 32768-entry table). */
function paletteLookup(palette) {
    const lut = new Uint8Array(32768);
    for (let r = 0; r < 32; r++) {
        for (let g = 0; g < 32; g++) {
            for (let b = 0; b < 32; b++) {
                const R = r * 8 + 4, G = g * 8 + 4, B = b * 8 + 4;
                let best = 0, dist = Infinity;
                palette.forEach(([pr, pg, pb], k) => {
                    const d = 2 * (R - pr) ** 2 + 4 * (G - pg) ** 2 + 3 * (B - pb) ** 2;
                    if (d < dist) {
                        dist = d;
                        best = k;
                    }
                });
                lut[(r << 10) | (g << 5) | b] = best;
            }
        }
    }
    return lut;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Palette indices of an RGBA frame, with 4 × 4 ordered dithering of `amount` (0 to 1). */
export function indexFrame(rgba, width, lut, amount = 1) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
        const x = p % width, y = (p / width) | 0, d = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 8 * amount;
        const r = Math.min(255, Math.max(0, rgba[i] + d)) >> 3, g = Math.min(255, Math.max(0, rgba[i + 1] + d)) >> 3, b = Math.min(255, Math.max(0, rgba[i + 2] + d)) >> 3;
        out[p] = lut[(r << 10) | (g << 5) | b];
    }
    return out;
}
/** GIF's variable-length LZW of palette indices, as data sub-blocks. */
export function lzw(indices, minCodeSize = 8) {
    const clear = 1 << minCodeSize, end = clear + 1, out = [];
    let codeSize = minCodeSize + 1, next = end + 1, bits = 0, acc = 0;
    let dict = new Map();
    const emit = code => {
        acc |= code << bits;
        bits += codeSize;
        while (bits >= 8) {
            out.push(acc & 255);
            acc >>>= 8;
            bits -= 8;
        }
    };
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const k = indices[i], key = prefix * 4096 + k;
        if (dict.has(key)) {
            prefix = dict.get(key);
            continue;
        }
        emit(prefix);
        if (next < 4096) {
            dict.set(key, next++);
            if (next > (1 << codeSize) && codeSize < 12) {
                codeSize++;
            }
        }
        else {
            emit(clear);
            dict = new Map();
            codeSize = minCodeSize + 1;
            next = end + 1;
        }
        prefix = k;
    }
    emit(prefix);
    emit(end);
    if (bits > 0) {
        out.push(acc & 255);
    }
    const blocks = [];
    for (let i = 0; i < out.length; i += 255) {
        const chunk = out.slice(i, i + 255);
        blocks.push(chunk.length, ...chunk);
    }
    blocks.push(0);
    return blocks;
}
/** An animated GIF of RGBA `frames` (width × height), shown `delay` hundredths of
 * a second each, looping forever. Returns a Uint8Array.
 */
export function encodeGIF(frames, width, height, delay, { dither = 1 } = {}) {
    if (!frames.length || width < 1 || height < 1 || width > 65535 || height > 65535) {
        throw new Error('A GIF needs at least one frame of 1 to 65535 pixels per side.');
    }
    const palette = medianCutPalette(frames), lut = paletteLookup(palette);
    const table = new Uint8Array(256 * 3);
    palette.forEach((c, k) => table.set(c, k * 3));
    const bytes = [];
    const u16 = v => bytes.push(v & 255, (v >> 8) & 255);
    bytes.push(...[...'GIF89a'].map(c => c.charCodeAt(0)));
    u16(width);
    u16(height);
    bytes.push(0xf7, 0, 0); // global color table of 256 entries
    bytes.push(...table);
    bytes.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0); // loop forever
    const parts = [new Uint8Array(bytes)];
    for (const frame of frames) {
        const head = [0x21, 0xf9, 4, 0, delay & 255, (delay >> 8) & 255, 0, 0, 0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0, 8];
        parts.push(new Uint8Array(head), new Uint8Array(lzw(indexFrame(frame, width, lut, dither))));
    }
    parts.push(new Uint8Array([0x3b]));
    const size = parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
// ---- PNG chunks and APNG ---------------------------------------------------------------------
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** The chunks of a PNG file: [{type, data}]. Throws on a malformed file. */
export function pngChunks(bytes) {
    if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
        throw new Error('Not a PNG file.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = [];
    for (let at = 8; at + 12 <= bytes.length;) {
        const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
        at += 12 + length;
        if (type === 'IEND') {
            break;
        }
    }
    return chunks;
}
function chunk(type, data) {
    const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set([...type].map(c => c.charCodeAt(0)), 4);
    out.set(data, 8);
    view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
    return out;
}
const be32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const be16 = v => [(v >>> 8) & 255, v & 255];
/** An animated PNG from same-size PNG files (Uint8Arrays), each shown 1/fps
 * seconds, looping forever. Returns a Uint8Array.
 */
export function assembleAPNG(pngs, fps) {
    if (!pngs.length) {
        throw new Error('An animated PNG needs at least one frame.');
    }
    const first = pngChunks(pngs[0]), ihdr = first.find(c => c.type === 'IHDR');
    const width = new DataView(ihdr.data.buffer, ihdr.data.byteOffset).getUint32(0), height = new DataView(ihdr.data.buffer, ihdr.data.byteOffset).getUint32(4);
    const parts = [new Uint8Array(PNG_SIGNATURE), chunk('IHDR', ihdr.data), chunk('acTL', new Uint8Array([...be32(pngs.length), ...be32(0)]))];
    let sequence = 0;
    pngs.forEach((png, k) => {
        const chunks = k ? pngChunks(png) : first, header = chunks.find(c => c.type === 'IHDR'), dims = new DataView(header.data.buffer, header.data.byteOffset);
        if (dims.getUint32(0) !== width || dims.getUint32(4) !== height) {
            throw new Error('Every frame of an animated PNG must have the same size.');
        }
        parts.push(chunk('fcTL', new Uint8Array([...be32(sequence++), ...be32(width), ...be32(height), ...be32(0), ...be32(0), ...be16(1), ...be16(fps), 0, 0])));
        for (const c of chunks.filter(c => c.type === 'IDAT')) {
            parts.push(k === 0 ? chunk('IDAT', c.data) : chunk('fdAT', new Uint8Array([...be32(sequence++), ...c.data])));
        }
    });
    parts.push(chunk('IEND', new Uint8Array(0)));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
// ---- MP4 (ISO base media file format) ---------------------------------------------------------
function box(type, ...payload) {
    const parts = payload.map(p => p instanceof Uint8Array ? p : new Uint8Array(p)), size = 8 + parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    out.set(be32(size), 0);
    out.set([...type].map(c => c.charCodeAt(0)), 4);
    let at = 8;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
const full = (type, version, flags, ...payload) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...payload);
/** Identity transformation matrix of mvhd/tkhd (16.16 and 2.30 fixed point). */
const matrix = () => [...be32(0x00010000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x00010000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x40000000)];
/** An MP4 file around H.264 samples: `samples` = [{data: Uint8Array (AVCC),
 * key: bool, timestamp: µs}] in decode order, `description` = the avcC record
 * from the encoder (decoderConfig.description). Returns a Uint8Array.
 */
export function muxMP4(samples, { width, height, fps, description }) {
    if (!samples.length) {
        throw new Error('A video needs at least one frame.');
    }
    const timescale = fps * 1000, delta = 1000, count = samples.length, duration = count * delta;
    const ftyp = box('ftyp', [...'isom'].map(c => c.charCodeAt(0)), be32(512), [...'isomiso2avc1mp41'].map(c => c.charCodeAt(0)));
    const mdatSize = 8 + samples.reduce((n, s) => n + s.data.length, 0);
    // Presentation time − decode time for each sample, in timescale units (non-zero with B-frames).
    const offsets = samples.map((s, i) => Math.round(s.timestamp * timescale / 1e6) - i * delta);
    const ctts = offsets.some(o => o !== 0) ? full('ctts', 0, 0, be32(count), ...offsets.map(o => [...be32(1), ...be32(Math.max(0, o))])) : null;
    const avc1 = box('avc1', new Uint8Array(6), be16(1), new Uint8Array(16), be16(width), be16(height), be32(0x00480000), be32(0x00480000), be32(0), be16(1), new Uint8Array(32), be16(0x18), be16(0xffff), box('avcC', new Uint8Array(description)));
    const build = mdatOffset => {
        const stbl = box('stbl', full('stsd', 0, 0, be32(1), avc1), full('stts', 0, 0, be32(1), be32(count), be32(delta)), ...(ctts ? [ctts] : []),
            full('stss', 0, 0, be32(samples.filter(s => s.key).length), ...samples.map((s, i) => s.key ? be32(i + 1) : []).filter(a => a.length)),
            full('stsc', 0, 0, be32(1), be32(1), be32(count), be32(1)), full('stsz', 0, 0, be32(0), be32(count), ...samples.map(s => be32(s.data.length))), full('stco', 0, 0, be32(1), be32(mdatOffset + 8)));
        const minf = box('minf', full('vmhd', 0, 1, new Uint8Array(8)), box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1))), stbl);
        const mdia = box('mdia', full('mdhd', 0, 0, be32(0), be32(0), be32(timescale), be32(duration), be16(0x55c4), be16(0)), full('hdlr', 0, 0, be32(0), [...'vide'].map(c => c.charCodeAt(0)), new Uint8Array(12), [...'Equation Studio\0'].map(c => c.charCodeAt(0))), minf);
        const tkhd = full('tkhd', 0, 3, be32(0), be32(0), be32(1), be32(0), be32(duration), new Uint8Array(8), be16(0), be16(0), be16(0), be16(0), matrix(), be32(width << 16), be32(height << 16));
        const mvhd = full('mvhd', 0, 0, be32(0), be32(0), be32(timescale), be32(duration), be32(0x00010000), be16(0x0100), new Uint8Array(10), matrix(), new Uint8Array(24), be32(2));
        return box('moov', mvhd, box('trak', tkhd, mdia));
    };
    // moov goes before mdat so players can start at once; its size does not depend on the offset.
    const moov = build(ftyp.length + build(0).length);
    const out = new Uint8Array(ftyp.length + moov.length + mdatSize);
    out.set(ftyp, 0);
    out.set(moov, ftyp.length);
    let at = ftyp.length + moov.length;
    out.set(be32(mdatSize), at);
    out.set([...'mdat'].map(c => c.charCodeAt(0)), at + 4);
    at += 8;
    for (const s of samples) {
        out.set(s.data, at);
        at += s.data.length;
    }
    return out;
}
// ---- Sprite sheets -------------------------------------------------------------------------
/** Grid layout of `count` frames of width × height in a sheet at most `maxSize`
 * pixels wide: {columns, rows, width, height, cells: [{x, y}]}.
 */
export function sheetLayout(count, width, height, maxSize = 4096) {
    let columns = Math.max(1, Math.min(count, Math.floor(maxSize / width), Math.ceil(Math.sqrt(count * height / width))));
    const rows = Math.ceil(count / columns);
    if (rows * height > maxSize) {
        throw new Error(`${count} frames of ${width} × ${height} do not fit in a ${maxSize}-pixel sheet: use fewer or smaller frames.`);
    }
    return { columns, rows, width: columns * width, height: rows * height, cells: Array.from({ length: count }, (_, k) => ({ x: (k % columns) * width, y: Math.floor(k / columns) * height })) };
}
