/** Looks: how a field that has no color of its own is shown on screen.
 *
 * A scalar, a coordinate pair or a geometry bundle is a number (or several) at
 * every pixel, not a color. To see one we must choose an encoding, a "look". The
 * same tables drive the shader (GLSL is generated from them below) and the
 * thumbnails painted on the CPU, so a stage looks identical on the canvas and in
 * the Pipeline.
 *
 *   scalar    auto     colormap over the field's actual range, with contour lines:
 *                      a diverging map (cool < 0 < warm, dark at zero) when the
 *                      field takes both signs, a sequential map otherwise
 *             classic  gray = ½ + ½·tanh(value), the 1.x diagnostic
 *   coord     auto     the image of a regular grid: where each grid cell of the
 *                      output coordinates lands, with the q_x = 0 and q_y = 0 axes
 *             classic  red = ½ + ½ sin x, green = ½ + ½ sin y
 *   geometry  auto     one channel (S, A or coverage) as a scalar
 *             classic  red = 4·rim, green = coverage, blue = ½ + ½·tanh(warp)
 *   layer     auto     natural display, or an exposure-adjusted one when the
 *                      layer is almost entirely clipped or black (see layerGain)
 *             classic  natural display at the scene exposure
 *             alpha    coverage as gray
 *
 * Everything here is pure: no DOM and no WebGL, so it is unit tested in Node.
 */
export const LOOK_CODES = { classic: 0, auto: 1, alpha: 2 };
export const TYPE_CODES = { coord: 0, scalar: 1, geometry: 2, layer: 3 };
export const GEOMETRY_CHANNELS = ['S', 'A', 'coverage'];
/** Colormap stops [position 0–1, '#rrggbb'], interpolated linearly in display RGB. */
export const COLORMAPS = {
    // Dark to bright for fields that do not change sign (inferno-like; matplotlib's maps are CC0).
    sequential: [[0, '#000004'], [0.13, '#1b0c41'], [0.25, '#4a0c6b'], [0.38, '#781c6d'], [0.5, '#a52c60'], [0.63, '#cf4446'], [0.75, '#ed6925'], [0.88, '#fb9b06'], [1, '#fcffa4']],
    // Signed fields: cool below zero, near-black at zero, warm above zero. The same
    // warm/cool convention as the "signed difference" view of what a component changes.
    diverging: [[0, '#c4ecff'], [0.18, '#4a9df0'], [0.36, '#1f4f8f'], [0.5, '#0c1015'], [0.64, '#7a3314'], [0.82, '#ea6d2c'], [1, '#ffecb0']]
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function hexToRGB(hex) {
    return [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) / 255);
}
/** Color of a colormap at t (clamped to 0–1), as [r, g, b] in 0–1. */
export function sampleColormap(stops, t) {
    const x = clamp(Number.isFinite(t) ? t : 0, 0, 1);
    for (let i = 1; i < stops.length; i++) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        if (x <= b) {
            const u = (x - a) / (b - a), p = hexToRGB(ca), q = hexToRGB(cb);
            return [0, 1, 2].map(k => p[k] + (q[k] - p[k]) * u);
        }
    }
    return hexToRGB(stops.at(-1)[1]);
}
/** A CSS linear-gradient of a colormap, for legends. */
export function colormapCSS(stops, direction = '90deg') {
    return `linear-gradient(${direction}, ${stops.map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`).join(', ')})`;
}
/** Smallest 1–2–5 × 10ⁿ step that is at least `x`. */
export function niceStep(x) {
    if (!(x > 0) || !Number.isFinite(x)) {
        return 1;
    }
    const magnitude = 10 ** Math.floor(Math.log10(x));
    for (const m of [1, 2, 5, 10]) {
        if (m * magnitude >= x * (1 - 1e-9)) {
            return m * magnitude;
        }
    }
    return 10 * magnitude;
}
/** Robust summary of one channel of interleaved float data (RGBA by default).
 * `lo`/`hi` are the 0.5th and 99.5th percentiles, so a few extreme pixels do not
 * wash out the colormap. Percentiles come from a 1024-bin histogram (linear time).
 */
export function fieldStats(data, { channel = 0, stride = 4, low = 0.005, high = 0.995, bins = 48 } = {}) {
    let min = Infinity, max = -Infinity, sum = 0, count = 0, nonfinite = 0;
    for (let i = channel; i < data.length; i += stride) {
        const v = data[i];
        if (!Number.isFinite(v)) {
            nonfinite++;
            continue;
        }
        if (v < min) {
            min = v;
        }
        if (v > max) {
            max = v;
        }
        sum += v;
        count++;
    }
    if (!count) {
        return { count: 0, nonfinite, min: 0, max: 0, mean: 0, median: 0, lo: 0, hi: 0, histogram: new Array(bins).fill(0) };
    }
    const span = max - min, fine = new Uint32Array(1024), histogram = new Array(bins).fill(0);
    if (span > 0) {
        for (let i = channel; i < data.length; i += stride) {
            const v = data[i];
            if (Number.isFinite(v)) {
                const u = (v - min) / span;
                fine[Math.min(1023, Math.floor(u * 1024))]++;
                histogram[Math.min(bins - 1, Math.floor(u * bins))]++;
            }
        }
    }
    else {
        histogram[0] = count;
    }
    const percentile = q => {
        if (span <= 0) {
            return min;
        }
        const target = q * count;
        let seen = 0;
        for (let b = 0; b < 1024; b++) {
            seen += fine[b];
            if (seen >= target) {
                return min + span * (b + (q < 0.5 ? 0 : 1)) / 1024;
            }
        }
        return max;
    };
    return { count, nonfinite, min, max, mean: sum / count, median: percentile(0.5), lo: Math.max(min, percentile(low)), hi: Math.min(max, percentile(high)), histogram };
}
/** Colormap range for a scalar field from its statistics.
 * Returns {lo, hi, signed, constant, contour}: a field is shown as signed
 * (diverging, symmetric about zero) when both signs carry at least 2% of its
 * magnitude; `contour` is a round contour-line spacing (about ten lines).
 */
export function scalarRange(stats, { contours = true } = {}) {
    if (!stats || !stats.count) {
        return { lo: -1, hi: 1, signed: true, constant: false, contour: contours ? 0.2 : 0 };
    }
    let { lo, hi } = stats;
    const magnitude = Math.max(Math.abs(lo), Math.abs(hi), 1e-30);
    if (hi - lo <= 1e-7 * magnitude) {
        const pad = Math.max(Math.abs(lo) * 0.5, 0.5);
        return { lo: lo - pad, hi: hi + pad, signed: false, constant: true, value: lo, contour: 0 };
    }
    const signed = lo < 0 && hi > 0 && Math.min(-lo, hi) >= 0.02 * magnitude;
    if (signed) {
        const m = Math.max(-lo, hi);
        lo = -m;
        hi = m;
    }
    return { lo, hi, signed, constant: false, contour: contours ? niceStep((hi - lo) / 10) : 0 };
}
/** Grid spacing for the coordinate look: about eight cells across the larger
 * extent of the output coordinates in view (x in channel 0, y in channel 1).
 */
export function gridStep(statsX, statsY) {
    const extent = Math.max(statsX?.count ? statsX.hi - statsX.lo : 0, statsY?.count ? statsY.hi - statsY.lo : 0);
    return extent > 0 ? niceStep(extent / 8) : 0.5;
}
/** Exposure multiplier for the automatic layer look. A layer that is readable at
 * the scene exposure keeps gain 1 (natural). One that is almost entirely clipped
 * (median of its brightest channel above 1.5) or almost black (99.5th percentile
 * below 0.02) is scaled so its 99.5th percentile maps to 0.9.
 * `stats` describes max(R, G, B) × scene exposure.
 */
export function layerGain(stats) {
    if (!stats || !stats.count || !(stats.hi > 0)) {
        return 1;
    }
    if (stats.hi < 0.02 || stats.median > 1.5) {
        return clamp(0.9 / stats.hi, 1e-6, 1e6);
    }
    return 1;
}
// ---- Display conversion (the JavaScript twin of displayColor in math-glsl.js) ----
const cutoff = x => Math.exp(-Math.exp(clamp(x, -80, 6)));
/** One displayed channel, 0–1, from radiance × exposure `h`, as in the shader. */
export function displayChannel(h, tone) {
    if (tone === 'source') {
        const f = 255 * cutoff(-1000 * h) * Math.pow(Math.max(Math.abs(h), 1e-30), cutoff(1000 * (h - 1)));
        return clamp(Math.floor(f), 0, 255) / 255;
    }
    if (tone === 'filmic') {
        return Math.pow(1 - Math.exp(-Math.max(h, 0)), 1 / 2.2);
    }
    return clamp(h, 0, 1);
}
// ---- CPU painting of raw float tiles (thumbnails) ------------------------------
const hsvToRGB = (h, s, v) => {
    const f = n => {
        const k = (n + h * 6) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
};
/** Base color of one grid cell in the coordinate look: a slowly varying pastel hue
 * so cells can be followed through strong warps, alternating in brightness.
 */
const cellColors = new Map();
export function gridCellColor(cx, cy) {
    const key = `${cx},${cy}`;
    let color = cellColors.get(key);
    if (!color) {
        const hue = ((cx * 0.13 + cy * 0.29) % 1 + 1) % 1, checker = ((cx + cy) % 2 + 2) % 2;
        color = hsvToRGB(hue, 0.35, checker ? 0.33 : 0.22);
        if (cellColors.size > 4096) {
            cellColors.clear();
        }
        cellColors.set(key, color);
    }
    return color;
}
/** A colormap sampled into a 1024-entry byte table (r, g, b per entry) for fast
 * painting; within 1/255 of sampleColormap and of the shader.
 */
const LUT_SIZE = 1024, luts = new Map();
export function colormapTable(stops) {
    if (!luts.has(stops)) {
        const table = new Uint8ClampedArray(LUT_SIZE * 3);
        for (let i = 0; i < LUT_SIZE; i++) {
            const c = sampleColormap(stops, i / (LUT_SIZE - 1));
            table.set(c.map(v => Math.round(v * 255)), i * 3);
        }
        luts.set(stops, table);
    }
    return luts.get(stops);
}
/** Display byte (0–255) of radiance × exposure `h`; displayChannel() × 255 with a
 * fast exact path for the common middle range of the source mapping.
 */
function displayByte(h, tone) {
    if (tone === 'source') { // exact shortcuts where the nested gates are exactly 0 or 1 in double precision
        if (h >= 0.08 && h <= 0.9) {
            return Math.floor(255 * h);
        }
        if (h >= 1.1) {
            return 255;
        }
        if (h <= 0) {
            return 0;
        }
        if (h < 0.08) {
            return Math.floor(255 * Math.exp(-Math.exp(-1000 * h)) * h); // the outer exponent is exactly 1 here
        }
    }
    return Math.round(displayChannel(h, tone) * 255);
}
const GRID_LINE = [158, 173, 184], AXIS_X = [242, 115, 102], AXIS_Y = [115, 230, 140];
/** Paint a raw float tile (RGBA, top row first) as display bytes using a look.
 * `look` = {type, mode: 'auto'|'classic'|'alpha', channel, range, gain, step,
 * exposure, tone}; see lookForStats() for how the automatic parameters are chosen.
 */
export function paintTile(values, width, height, look) {
    const out = new Uint8ClampedArray(width * height * 4);
    const { type, mode = 'auto', exposure = 1, tone = 'filmic' } = look, range = look.range;
    const classic = mode === 'classic' || (type !== 'layer' && type !== 'coord' && !range);
    const signed = !!range?.signed, table = colormapTable(signed ? COLORMAPS.diverging : COLORMAPS.sequential);
    const lo = range?.lo ?? 0, span = Math.max((range?.hi ?? 1) - lo, 1e-30), half = Math.max(Math.abs(range?.lo ?? 1), Math.abs(range?.hi ?? 1), 1e-30);
    const channel = type === 'geometry' ? (look.channel ?? 0) : 0, gain = (look.gain ?? 1) * exposure, step = look.step || 0.5;
    const setRGB = (i, r, g, b) => {
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
    };
    const setUnit = (i, r, g, b) => setRGB(i, Math.round(clamp(r, 0, 1) * 255), Math.round(clamp(g, 0, 1) * 255), Math.round(clamp(b, 0, 1) * 255));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4, a = values[i], b = values[i + 1], c = values[i + 2], d = values[i + 3];
            if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) {
                setRGB(i, 255, 0, 255); // nonfinite values are magenta, as in the shader
                continue;
            }
            if (type === 'layer') {
                if (mode === 'alpha') {
                    setUnit(i, d, d, d);
                }
                else {
                    setRGB(i, displayByte(a * gain, tone), displayByte(b * gain, tone), displayByte(c * gain, tone));
                }
            }
            else if (type === 'coord') {
                if (mode === 'classic') {
                    setUnit(i, 0.5 + 0.5 * Math.sin(a), 0.5 + 0.5 * Math.sin(b), 0.5);
                    continue;
                }
                // Screen-space derivative from the neighbors gives a one-pixel line width.
                const nx = x + 1 < width ? i + 4 : x > 0 ? i - 4 : i, ny = y + 1 < height ? i + width * 4 : y > 0 ? i - width * 4 : i;
                const wx = Math.abs(values[nx] - a) + Math.abs(values[ny] - a), wy = Math.abs(values[nx + 1] - b) + Math.abs(values[ny + 1] - b);
                if (Math.abs(b) < wy * 1.5) {
                    setRGB(i, ...AXIS_Y);
                }
                else if (Math.abs(a) < wx * 1.5) {
                    setRGB(i, ...AXIS_X);
                }
                else {
                    const dx = Math.abs(((a / step + 0.5) % 1 + 1) % 1 - 0.5) * step, dy = Math.abs(((b / step + 0.5) % 1 + 1) % 1 - 0.5) * step;
                    if (dx < wx || dy < wy) {
                        setRGB(i, ...GRID_LINE);
                    }
                    else {
                        const cell = gridCellColor(Math.floor(a / step), Math.floor(b / step));
                        setUnit(i, cell[0], cell[1], cell[2]);
                    }
                }
            }
            else if (type === 'geometry' && mode === 'classic') {
                setUnit(i, b * 4, c, 0.5 + 0.5 * Math.tanh(a));
            }
            else {
                const v = channel === 0 ? a : channel === 1 ? b : c;
                if (classic) {
                    const g = Math.round((0.5 + 0.5 * Math.tanh(v)) * 255);
                    setRGB(i, g, g, g);
                    continue;
                }
                const t = signed ? 0.5 + 0.5 * v / half : (v - lo) / span, k = Math.round(clamp(t, 0, 1) * (LUT_SIZE - 1)) * 3;
                setRGB(i, table[k], table[k + 1], table[k + 2]);
            }
        }
    }
    return out;
}
/** Automatic look parameters for a raw float tile of the given type.
 * Returns {mode, channel, range, gain, step, stats} ready for paintTile() and for
 * the shader's look uniforms. `options` = {mode, channel, exposure, natural}:
 * `natural` keeps a layer at gain 1 (the scene's final output).
 */
export function lookForStats(values, type, options = {}) {
    const { mode = 'auto', channel = 0, exposure = 1, natural = false } = options;
    if (type === 'layer') {
        if (mode !== 'auto' || natural) {
            return { mode: mode === 'alpha' ? 'alpha' : 'classic', gain: 1 };
        }
        const bright = new Float32Array(values.length / 4);
        for (let i = 0, j = 0; i < values.length; i += 4, j++) {
            bright[j] = Math.max(values[i], values[i + 1], values[i + 2]) * exposure;
        }
        const stats = fieldStats(bright, { stride: 1 });
        return { mode: 'auto', gain: layerGain(stats), stats };
    }
    if (mode === 'classic') {
        return { mode: 'classic' };
    }
    if (type === 'coord') {
        const x = fieldStats(values, { channel: 0 }), y = fieldStats(values, { channel: 1 });
        return { mode: 'auto', step: gridStep(x, y), stats: [x, y] };
    }
    const stats = fieldStats(values, { channel: type === 'geometry' ? channel : 0 });
    return { mode: 'auto', channel, range: scalarRange(stats), stats };
}
// ---- GLSL -------------------------------------------------------------------
const glslFloat = x => {
    const s = String(Number(x.toFixed(6)));
    return /[.e]/.test(s) ? s : `${s}.0`;
};
const glslColor = hex => `vec3(${hexToRGB(hex).map(glslFloat).join(',')})`;
/** A GLSL function `vec3 name(float t)` evaluating a colormap exactly like sampleColormap. */
export function colormapGLSL(name, stops) {
    const lines = [`vec3 ${name}(float t) {`, ' t=clamp(t,0.0,1.0);'];
    for (let i = 1; i < stops.length; i++) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        lines.push(` if(t<=${glslFloat(b)}) return mix(${glslColor(ca)},${glslColor(cb)},(t-${glslFloat(a)})/${glslFloat(b - a)});`);
    }
    lines.push(` return ${glslColor(stops.at(-1)[1])};`, '}');
    return lines.join('\n');
}
/** The display conversion inside every graph program: layers through the output
 * conversion (times an exposure gain, or their coverage as gray), other types
 * through the classic diagnostic. Deliberately small: the automatic looks run in
 * a separate pass (lookPassSource) so they never slow down compiling a graph.
 */
export const presentGLSL = `
uniform int u_type;     // coord 0, scalar 1, geometry 2, layer 3
uniform int u_look;     // classic 0, auto 1, alpha 2
uniform float u_gain;   // layer exposure multiplier of the auto look
vec3 present(vec4 f){
 if(u_type==3) return u_look==2?vec3(clamp(f.a,0.0,1.0)):displayColor(f.rgb*u_gain,u_exposure,u_tone);
 if(u_type==1) return vec3(0.5+0.5*tanh(f.x));
 if(u_type==0) return vec3(0.5+0.5*sin(f.x),0.5+0.5*sin(f.y),0.5);
 return vec3(f.y*4.0,f.z,0.5+0.5*tanh(f.x));
}
`;
/** The automatic look as a post pass: raw values of a scalar, coordinate or
 * geometry stage (a float texture written by the graph program in raw mode)
 * become colors. Compiled once, whatever the graph.
 */
export const lookPassSource = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_field; // raw values, one texel per output pixel
uniform vec2 u_origin;           // framebuffer position of texel (0, 0)
uniform int u_type;              // coord 0, scalar 1, geometry 2
uniform int u_channel;           // geometry channel: S 0, A 1, coverage 2
uniform vec4 u_range;            // colormap low, high, signed (0/1), contour spacing (0 = none)
uniform float u_grid;            // grid spacing of the coordinate look
out vec4 outputColor;
${colormapGLSL('sequentialMap', COLORMAPS.sequential)}
${colormapGLSL('divergingMap', COLORMAPS.diverging)}
vec3 hsv2rgb(vec3 c){vec3 k=clamp(abs(mod(c.x*6.0+vec3(0,4,2),6.0)-3.0)-1.0,0.0,1.0);return c.z*mix(vec3(1),k,c.y);}
float channelOf(vec4 f){return u_type==1?f.x:(u_channel==0?f.x:(u_channel==1?f.y:f.z));}
float valueAt(ivec2 at){return channelOf(texelFetch(u_field,clamp(at,ivec2(0),textureSize(u_field,0)-1),0));}
// A contour line is drawn where a level (a multiple of the spacing) lies between
// this pixel's value v and a neighbor's value n, on the pixel nearer the crossing.
// No crossing, no line: a field that only approaches a level (a decaying tail, a
// flat region) is never outlined, however small its values.
float crossing(float v,float n,float spacing){
 float a=floor(v/spacing), b=floor(n/spacing);
 if(a==b) return 0.0;
 float level=max(a,b)*spacing;
 return 1.0-smoothstep(0.3,0.7,(v-level)/(v-n)); // (v-level)/(v-n): 0 here, 1 at the neighbor
}
vec3 fieldColors(ivec2 at,float v){
 float lo=u_range.x, hi=u_range.y;
 vec3 c=u_range.z>0.5?divergingMap(0.5+0.5*v/max(max(abs(lo),abs(hi)),1e-30)):sequentialMap((v-lo)/max(hi-lo,1e-30));
 if(u_range.w>0.0){
  float line=0.0, zero=0.0;
  for(int k=0;k<4;k++){
   ivec2 o=k==0?ivec2(1,0):k==1?ivec2(-1,0):k==2?ivec2(0,1):ivec2(0,-1);
   float n=valueAt(at+o);
   if(isnan(n)||isinf(n)) continue;
   line=max(line,crossing(v,n,u_range.w));
   if(u_range.z>0.5&&(v<0.0)!=(n<0.0)) zero=max(zero,1.0-smoothstep(0.3,0.7,v/(v-n))); // the zero line of a signed field
  }
  c=mix(c,vec3(1),0.42*line);
  c=mix(c,vec3(1),0.55*zero);
 }
 return c;
}
vec3 gridColors(vec2 q){
 float s=max(u_grid,1e-6); vec2 cell=floor(q/s);
 float hue=fract(cell.x*0.13+cell.y*0.29), checker=mod(cell.x+cell.y,2.0);
 vec3 c=hsv2rgb(vec3(hue,0.35,checker>0.5?0.33:0.22));
 vec2 w=max(fwidth(q),vec2(1e-30)), d=abs(fract(q/s+0.5)-0.5)*s, line=1.0-smoothstep(0.5*w,1.5*w,d);
 c=mix(c,vec3(0.62,0.68,0.72),max(line.x,line.y)*0.85);
 vec2 axis=1.0-smoothstep(w,2.5*w,abs(q));
 c=mix(c,vec3(0.95,0.45,0.4),axis.x);
 c=mix(c,vec3(0.45,0.9,0.55),axis.y);
 return c;
}
void main(){
 ivec2 at=ivec2(gl_FragCoord.xy-u_origin);
 vec4 f=texelFetch(u_field,at,0);
 if(any(isnan(f))||any(isinf(f))){outputColor=vec4(1,0,1,1);return;}
 vec3 c=u_type==0?gridColors(f.xy):fieldColors(at,channelOf(f));
 outputColor=vec4(c,1);
}
`;
/** Look uniform values for renderer.execute(). `look` as returned by lookForStats
 * (or {mode: 'classic'}); missing fields fall back to the classic diagnostic.
 */
export function lookUniforms(type, look = {}) {
    const mode = look.mode || 'classic', range = look.range;
    return {
        type: TYPE_CODES[type] ?? 3,
        look: LOOK_CODES[mode] ?? 0,
        channel: look.channel ?? 0,
        range: range ? [range.lo, range.hi, range.signed ? 1 : 0, range.contour || 0] : [-1, 1, 1, 0],
        gain: look.gain ?? 1,
        grid: look.step ?? 0.5
    };
}
