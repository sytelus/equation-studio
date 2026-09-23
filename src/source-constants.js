/**
 * Constant folding for the published nebula, evaluated once in JavaScript float64.
 *
 * These are NOT sampled textures, fitted coefficients, or pre-rendered pixels.
 * Each entry is the named expression at the integer band index s. The GPU still
 * evaluates every position-dependent expression at every pixel. Computing large
 * fixed angles such as cos(28*s*s) in float32 noticeably moves fine structures;
 * doing the invariant work here is both faster and closer to the CPU reference.
 * GLSL ultimately rounds each literal to its highp float representation.
 */
const cos = Math.cos, sin = Math.sin;
function literal(value) {
    if (!Number.isFinite(value)) {
        throw new Error('Non-finite source constant');
    }
    return value.toExponential(16);
}
function array(name, type, count, valueAt) {
    const values = Array.from({ length: count }, (_, s) => {
        const values = valueAt(s);
        return type === 'float' ? literal(values) : `${type}(${values.map(literal).join(',')})`;
    });
    return `const ${type} ${name}[${count}] = ${type}[${count}](\n ${values.join(',\n ')}\n);\n`;
}
export const sourceConstantsGLSL = array('sourceShell', 'vec3', 28, s => [.1 * s + .06 * cos(5 * s * s), .2 * cos(3 * s * s), .2 * cos(4 * s * s)]) +
    array('sourceRotation15', 'vec2', 51, s => [cos(15 * s * s), sin(15 * s * s)]) +
    array('sourcePhase27_28', 'vec2', 51, s => [2 * cos(27 * s * s), 2 * cos(28 * s * s)]) +
    array('sourceFrequencies', 'vec3', 51, s => [1.25 ** s, .2 * 1.15 ** s, .95 ** s]) +
    array('sourceDirection7', 'vec2', 51, s => [cos(7 * s), sin(7 * s)]) +
    array('sourceDirection4', 'vec2', 51, s => [cos(4 * s), sin(4 * s)]) +
    array('sourceDirection8', 'vec2', 51, s => [cos(8 * s), sin(8 * s)]) +
    array('sourceTurbulencePhase', 'vec4', 51, s => [2 * cos(17 * s), 2 * cos(15 * s), 2 * cos(5 * s), 2 * cos(7 * s)]) +
    array('sourceCloudColor', 'vec3', 51, s => [0, 1, 2].map(v => (12 - 4 * v + v * v + (v - 1) * cos(2 * s * s) + 8 * cos((7 + v) * s * s)) / 50)) +
    array('sourceStarLattice', 'vec3', 31, s => [2 * 1.2 ** s, cos(19 * s * s), sin(19 * s * s)]);
