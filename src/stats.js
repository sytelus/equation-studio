/** Statistics of rendered values, for the Stats tab (ui-stats.js). Pure: arrays
 * in, numbers out, so every measure is unit-tested.
 *
 * Values come from raw renders: a Float32Array of RGBA per pixel. What the four
 * channels mean depends on the type (compiler.js, rawVec4): a scalar is (v, 0, 0,
 * 1), coordinates (x, y, 0, 1), geometry (S, A, coverage, 1), a layer is radiance
 * RGB and coverage alpha.
 */
export const CHANNELS = { scalar: ['value'], coord: ['x', 'y'], geometry: ['S', 'A', 'coverage'], layer: ['R', 'G', 'B', 'alpha'] };
/** Luminance weights of sRGB primaries (Rec. 709). */
const LUMA = [0.2126, 0.7152, 0.0722];
/** Per-channel statistics of raw values of `type`: [{name, min, max, mean, std}],
 * plus the fraction of nonfinite pixels, and for layers the clipped (a channel
 * above 1) and black (every channel below 1/255) fractions and the coverage.
 */
export function channelStats(values, type) {
    const names = CHANNELS[type] || CHANNELS.layer, pixels = values.length / 4;
    const acc = names.map(() => ({ min: Infinity, max: -Infinity, sum: 0, sq: 0, n: 0 }));
    let nonfinite = 0, clipped = 0, black = 0;
    for (let i = 0; i < values.length; i += 4) {
        let bad = false;
        for (let c = 0; c < names.length; c++) {
            if (!Number.isFinite(values[i + c])) {
                bad = true;
            }
        }
        if (bad) {
            nonfinite++;
            continue;
        }
        for (let c = 0; c < names.length; c++) {
            const v = values[i + c], a = acc[c];
            a.min = Math.min(a.min, v);
            a.max = Math.max(a.max, v);
            a.sum += v;
            a.sq += v * v;
            a.n++;
        }
        if (type === 'layer') {
            if (values[i] > 1 || values[i + 1] > 1 || values[i + 2] > 1) {
                clipped++;
            }
            if (values[i] < 1 / 255 && values[i + 1] < 1 / 255 && values[i + 2] < 1 / 255) {
                black++;
            }
        }
    }
    const channels = names.map((name, c) => {
        const a = acc[c], mean = a.n ? a.sum / a.n : NaN;
        return { name, min: a.n ? a.min : NaN, max: a.n ? a.max : NaN, mean, std: a.n ? Math.sqrt(Math.max(0, a.sq / a.n - mean * mean)) : NaN };
    });
    return { channels, pixels, nonfinite: nonfinite / pixels, clipped: clipped / pixels, black: black / pixels };
}
/** The single number per pixel a histogram and a time curve use: luminance of a
 * layer (clamped to what the display shows), the value of a scalar, the length
 * of coordinates, the channel A of geometry.
 */
export function pixelValue(values, i, type) {
    if (type === 'layer') {
        return LUMA[0] * Math.min(Math.max(values[i], 0), 1) + LUMA[1] * Math.min(Math.max(values[i + 1], 0), 1) + LUMA[2] * Math.min(Math.max(values[i + 2], 0), 1);
    }
    if (type === 'coord') {
        return Math.hypot(values[i], values[i + 1]);
    }
    return type === 'geometry' ? values[i + 1] : values[i];
}
/** A histogram of pixelValue over `bins` bins from lo to hi: {lo, hi, counts}. */
export function histogram(values, type, bins = 32) {
    const v = [];
    for (let i = 0; i < values.length; i += 4) {
        const x = pixelValue(values, i, type);
        if (Number.isFinite(x)) {
            v.push(x);
        }
    }
    if (!v.length) {
        return { lo: 0, hi: 1, counts: new Array(bins).fill(0) };
    }
    v.sort((a, b) => a - b);
    // Clip the range to the 0.5 % and 99.5 % quantiles so a few outliers do not flatten it.
    let lo = type === 'layer' ? 0 : v[Math.floor(v.length * 0.005)], hi = type === 'layer' ? 1 : v[Math.min(v.length - 1, Math.floor(v.length * 0.995))];
    if (!(hi > lo)) {
        hi = lo + 1;
    }
    const counts = new Array(bins).fill(0);
    for (const x of v) {
        counts[Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / (hi - lo) * bins)))]++;
    }
    return { lo, hi, counts };
}
/** Mean of pixelValue over an image. */
export function meanValue(values, type) {
    let sum = 0, n = 0;
    for (let i = 0; i < values.length; i += 4) {
        const x = pixelValue(values, i, type);
        if (Number.isFinite(x)) {
            sum += x;
            n++;
        }
    }
    return n ? sum / n : NaN;
}
/** Mean absolute difference of pixelValue between two images of the same size. */
export function meanDifference(a, b, type) {
    let sum = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
        const d = pixelValue(a, i, type) - pixelValue(b, i, type);
        if (Number.isFinite(d)) {
            sum += Math.abs(d);
            n++;
        }
    }
    return n ? sum / n : NaN;
}
/** How an animation loops, from frames at times 0, T/N, …, T (N + 1 images):
 * {means: mean value per frame, steps: difference between neighbours, typical:
 * the median step, seam: the difference between the last and the first frame,
 * seamless: seam at most 1.5 × typical (or both tiny)}.
 */
export function loopReport(frames, type) {
    const means = frames.map(f => meanValue(f, type));
    const steps = frames.slice(1).map((f, k) => meanDifference(f, frames[k], type));
    const sorted = [...steps.slice(0, -1)].sort((a, b) => a - b), typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : steps[0];
    const seam = meanDifference(frames.at(-1), frames[0], type);
    const still = typical < 1e-4 && seam < 1e-4;
    return { means, steps, typical, seam, still, seamless: still || seam <= 1.5 * typical + 1e-4 };
}
/** Per-component GPU cost from the draw times of each component's view (which
 * include everything upstream): own = its time minus the slowest of its inputs.
 */
export function ownCosts(times, inputsOf) {
    return Object.fromEntries(Object.entries(times).map(([id, ms]) => {
        const before = Math.max(0, ...inputsOf(id).map(i => times[i] ?? 0));
        return [id, Math.max(0, ms - before)];
    }));
}
