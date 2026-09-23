/** Dependency-free, uncompressed ZIP writer. PNG is already compressed.
 * ZIP32 only; bounded export size is enforced by both this writer and the UI.
 * Files are data. Names cannot escape the archive root or collide.
 */
const table = Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});
export function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) {
        c = table[(c ^ b) & 255] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}
function header(size) {
    const a = new Uint8Array(size);
    return [a, new DataView(a.buffer)];
}
export function makeZip(files) {
    if (!Array.isArray(files) || files.length > 1000) {
        throw new Error('Archive must contain at most 1000 files.');
    }
    const chunks = [], central = [], used = new Set();
    let offset = 0;
    for (const f of files) {
        if (!f || typeof f.name !== 'string' || !f.name || f.name.length > 250 || f.name.startsWith('/') || f.name.includes('\\') || f.name.split('/').includes('..') || used.has(f.name)) {
            throw new Error('Invalid or duplicate archive filename.');
        }
        used.add(f.name);
        const name = new TextEncoder().encode(f.name), data = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data;
        if (!(data instanceof Uint8Array)) {
            throw new Error('Archive data must be text or Uint8Array.');
        }
        if (offset + data.length > 160 * 1024 * 1024) {
            throw new Error('Export exceeds the 160 MB archive limit. Reduce frames or resolution.');
        }
        const crc = crc32(data), [h, v] = header(30);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 0x0800, true);
        v.setUint16(12, 33, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, data.length, true);
        v.setUint32(22, data.length, true);
        v.setUint16(26, name.length, true);
        chunks.push(h, name, data);
        const [c, cv] = header(46);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(14, 33, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        central.push(c, name);
        offset += h.length + name.length + data.length;
    }
    const centralSize = central.reduce((s, x) => s + x.length, 0), [end, ev] = header(22);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
export function fileStem(title) {
    return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'equation-studio';
}
export function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function frameTimes(duration, fps) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120 || !Number.isInteger(fps) || fps < 1 || fps > 60) {
        throw new Error('Use duration 0–120 seconds and integer FPS 1–60.');
    }
    const count = Math.ceil(duration * fps);
    if (count > 240) {
        throw new Error('Frame sequences are limited to 240 frames. Reduce duration or FPS.');
    }
    // The end point is exclusive: including it duplicates the first frame in a loop.
    return Array.from({ length: count }, (_, i) => i / fps);
}
/** Insert UTF-8 iTXt metadata before IEND without decoding/recompressing pixels.
 * Most image viewers ignore this chunk; Pillow and tools/read_png_project.py read it.
 */
export async function embedPNGMetadata(blob, metadata) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 20 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) || String.fromCharCode(...bytes.slice(-8, -4)) !== 'IEND') {
        throw new Error('Expected an ordinary PNG with an IEND chunk.');
    }
    const content = new TextEncoder().encode('equation-studio\0\0\0\0\0' + JSON.stringify(metadata));
    if (content.length > 1500000) {
        throw new Error('PNG metadata is too large.');
    }
    const type = new TextEncoder().encode('iTXt'), chunk = new Uint8Array(content.length + 12), view = new DataView(chunk.buffer);
    view.setUint32(0, content.length);
    chunk.set(type, 4);
    chunk.set(content, 8);
    view.setUint32(content.length + 8, crc32(chunk.subarray(4, content.length + 8)));
    return new Blob([bytes.subarray(0, bytes.length - 12), chunk, bytes.subarray(bytes.length - 12)], { type: 'image/png' });
}
