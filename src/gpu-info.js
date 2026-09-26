/** What is actually rendering: a hardware GPU or a software rasterizer.
 *
 * Browsers report the WebGL renderer as a free-form string, often wrapped by
 * ANGLE, e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11
 * vs_5_0 ps_5_0, D3D11)" or "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro,
 * Unspecified Version)". describeRenderer() turns it into a short name, the
 * graphics API underneath and whether it is a software fallback. Pure; the one
 * browser probe (probeSoftwareFallback) is kept separate.
 */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe|mesa offscreen|microsoft basic/i;
const APIS = [
    [/direct3d ?11|d3d11/i, 'Direct3D 11'], [/direct3d ?12|d3d12/i, 'Direct3D 12'], [/direct3d ?9|d3d9/i, 'Direct3D 9'],
    [/metal/i, 'Metal'], [/vulkan/i, 'Vulkan'], [/opengl es/i, 'OpenGL ES'], [/opengl/i, 'OpenGL']
];
/** {kind: 'hardware'|'software'|'unknown', name, api, raw} for a renderer string. */
export function describeRenderer(renderer = '', vendor = '') {
    const raw = String(renderer || '').trim();
    const kind = !raw ? 'unknown' : SOFTWARE.test(raw) ? 'software' : 'hardware';
    const api = APIS.find(([pattern]) => pattern.test(raw))?.[1] || null;
    let name = raw;
    const angle = /^ANGLE \((.*)\)$/s.exec(raw);
    if (angle) {
        // ANGLE (vendor, device [details], backend): keep the device.
        const parts = angle[1].split(/,\s*/);
        name = parts.length >= 2 ? parts[1] : parts[0];
        name = name.replace(/^ANGLE Metal Renderer:\s*/i, '');
    }
    name = name
        .replace(/\s*\(0x[0-9a-f]+\)/ig, '')
        .replace(/\s+Direct3D\d+.*$/i, '')
        .replace(/\s+vs_\d_\d.*$/i, '')
        .replace(/\/PCIe\/SSE2/i, '')
        .replace(/,?\s*or similar$/i, '')
        .replace(/\s*\(Subzero\)/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!name) {
        name = vendor || 'Unknown GPU';
    }
    if (kind === 'software' && /swiftshader/i.test(raw)) {
        name = 'SwiftShader (software)';
    }
    return { kind, name, api, raw };
}
/** True when the browser would give this page only a slow (software) WebGL 2
 * context, as reported by `failIfMajorPerformanceCaveat`. Creates and releases one
 * throwaway context; returns null when WebGL 2 is unavailable altogether.
 */
export function probeSoftwareFallback(createCanvas = () => document.createElement('canvas')) {
    const strict = createCanvas().getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (strict) {
        strict.getExtension('WEBGL_lose_context')?.loseContext();
        return false;
    }
    const relaxed = createCanvas().getContext('webgl2');
    if (!relaxed) {
        return null;
    }
    relaxed.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
}
/** Advice shown when rendering falls back to software. */
export const SOFTWARE_ADVICE = 'The browser is drawing with a software rasterizer, so every frame is computed on the CPU. Turn on hardware acceleration (Chrome/Edge: Settings → System → “Use graphics acceleration when available”; Firefox: Settings → Performance), update the graphics driver, or try another browser.';
