import { VIEW_LIMITS } from './graph.js';
/** Pure camera and ruler arithmetic shared by the canvas, probes and tests.
 *
 * The shader maps framebuffer pixel centers to world coordinates as
 *   p = (pixel - resolution/2) * WORLD_WIDTH / resolution.x / zoom + pan + HALF_PIXEL
 * with the y axis pointing up. At the native 2000 × 1200 grid this reproduces the
 * supplied source mapping x = (m − 1000)/420, y = (601 − n)/420.
 */
export const WORLD_WIDTH = 2000 / 420;
export const HALF_PIXEL = 0.5 / 420;
const clamp = (x, [lo, hi]) => Math.max(lo, Math.min(hi, x));
/** World units per framebuffer pixel at the given canvas width and zoom. */
export function unitsPerPixel(width, zoom) {
    return WORLD_WIDTH / (width * zoom);
}
/** World coordinate of framebuffer position (px, py); y grows upward. Pass pixel
 * centers (integer + 0.5) to match what the shader evaluated.
 */
export function pixelToWorld(px, py, width, height, view) {
    const u = unitsPerPixel(width, view.zoom);
    return { x: (px - width / 2) * u + view.x + HALF_PIXEL, y: (py - height / 2) * u + view.y + HALF_PIXEL };
}
/** Inverse of pixelToWorld: framebuffer position of a world coordinate. */
export function worldToPixel(x, y, width, height, view) {
    const u = unitsPerPixel(width, view.zoom);
    return { px: (x - view.x - HALF_PIXEL) / u + width / 2, py: (y - view.y - HALF_PIXEL) / u + height / 2 };
}
/** Framebuffer position of a pointer event relative to the canvas's CSS box. */
export function clientToPixel(clientX, clientY, rect, width, height) {
    return { px: (clientX - rect.left) / rect.width * width, py: (rect.bottom - clientY) / rect.height * height };
}
/** A new view whose zoom is `zoom` while world point (x, y) stays under the same pixel. */
export function zoomAbout(view, zoom, x, y) {
    const next = clamp(zoom, VIEW_LIMITS.zoom), k = view.zoom / next;
    return {
        zoom: next,
        x: clamp(x - HALF_PIXEL - (x - HALF_PIXEL - view.x) * k, VIEW_LIMITS.pan),
        y: clamp(y - HALF_PIXEL - (y - HALF_PIXEL - view.y) * k, VIEW_LIMITS.pan)
    };
}
/** A view panned by a pixel delta (dx right, dy up in framebuffer pixels). */
export function panBy(view, dx, dy, width) {
    const u = unitsPerPixel(width, view.zoom);
    return { zoom: view.zoom, x: clamp(view.x - dx * u, VIEW_LIMITS.pan), y: clamp(view.y - dy * u, VIEW_LIMITS.pan) };
}
/** A 1–2–5 ruler step in world units that is at least `minPixels` apart on screen. */
export function tickSpacing(unitsPerPx, minPixels = 64) {
    const raw = unitsPerPx * minPixels, magnitude = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 5, 10]) {
        if (m * magnitude >= raw) {
            return m * magnitude;
        }
    }
    return 10 * magnitude;
}
/** Label for a tick value without floating-point noise ("0.2", not "0.20000000001"). */
export function formatTick(value, step) {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    const text = value.toFixed(decimals);
    return text === '-0' || /^-0\.0+$/.test(text) ? text.slice(1) : text;
}
