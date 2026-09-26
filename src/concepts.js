/** Why the equations look the way they do: the recurring ideas behind the
 * components, each with a formula, a plain explanation and (often) a small plot
 * with one knob to play with. Components list the ideas they use in their
 * catalog `concepts`; the inspector and the playground show them as cards.
 *
 * A concept: {title, tex?, text, knob?: {label, min, max, step, value},
 * plot?: k => plotSVG options (k is the knob value)}. Pure data and math.
 */
const hash1 = i => {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
};
/** Smooth 1-D value noise in 0–1, the one-dimensional twin of noise2 in the shader. */
export function valueNoise1(x) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
/** 1-D fractal noise with `octaves` layers, normalized to 0–1. */
export function fbm1(x, octaves) {
    let sum = 0, amplitude = 0.5, norm = 0, p = x;
    for (let k = 0; k < octaves; k++) {
        sum += amplitude * valueNoise1(p);
        norm += amplitude;
        p = p * 2.03 + 11.3;
        amplitude *= 0.5;
    }
    return sum / norm;
}
const gate = x => Math.exp(-Math.exp(Math.max(-80, Math.min(6, x))));
const smooth = (a, b, x) => {
    const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
};
export const concepts = {
    'pixel-to-world': {
        title: 'Pixels become points of a plane',
        tex: 'p = \\frac{W}{w\\, z}\\left(\\mathbf{x} - \\frac{\\mathbf{s}}{2}\\right) + \\mathbf{o}',
        text: 'The canvas is a window onto an endless plane. Each pixel is turned into a point p of that plane, in world units, before any equation runs, so the picture does not depend on the resolution: more pixels sample the same functions more densely.'
    },
    'backward-map': {
        title: 'Backward mapping',
        tex: 'I_{\\text{moved}}(p) = I\\left(M^{-1}(p)\\right)',
        text: 'To move, turn or bend a picture, change where each pixel looks instead of moving the picture. A pixel at p asks for the pattern at q = M⁻¹(p). This is why transforms contain inverses and minus signs: to move a shape right, subtract from x. Any pattern downstream of the map is moved the same way.'
    },
    rotation: {
        title: 'Rotation',
        tex: 'R(\\theta)\\,(x, y) = (x\\cos\\theta - y\\sin\\theta,\\ x\\sin\\theta + y\\cos\\theta)',
        text: 'Turns a point counter-clockwise by θ radians about the origin and keeps its distance. 2π (about 6.28) is a full turn. Rotating by an angle that depends on the distance from the center gives a twist.'
    },
    gaussian: {
        title: 'Gaussian bump',
        tex: 'e^{-(d/w)^2}',
        text: 'Exactly 1 at d = 0, 0.37 at d = ±w and practically 0 beyond 3w. With d the distance to a point it draws a soft dot, with the distance to a curve a glowing line, with the distance to a shell a rim.',
        knob: { label: 'width w', min: 0.1, max: 2, step: 0.05, value: 0.5 },
        plot: w => ({ series: [{ f: d => Math.exp(-((d / w) ** 2)) }], domain: [-2.5, 2.5], range: [0, 1.05], xLabel: 'd', yLabel: 'e^−(d/w)²', marks: [{ x: w, label: 'w' }, { x: -w }] })
    },
    gate: {
        title: 'The double-exponential gate',
        tex: 'e^{-e^{k(x - \\ell)}}',
        text: 'About 1 when x is well below ℓ and about 0 well above it, switching over roughly 1/k around x = ℓ (where it equals 1/e ≈ 0.37). It is a soft “if x < ℓ”: a larger k makes the switch sharper, a negative k flips it. The source nebula uses it everywhere, and a product of gates is a soft AND. Unlike a hard step it has no jagged edges.',
        knob: { label: 'steepness k', min: 0.5, max: 30, step: 0.5, value: 4 },
        plot: k => ({ series: [{ f: x => gate(k * x), label: 'e^−e^(kx)' }, { f: x => gate(-k * x), label: 'e^−e^(−kx)' }], domain: [-2, 2], range: [0, 1.05], xLabel: 'x − ℓ', yLabel: 'gate', marks: [{ x: 0, label: 'ℓ' }] })
    },
    smoothstep: {
        title: 'Smoothstep',
        tex: '\\operatorname{smoothstep}(a, b, x) = 3u^2 - 2u^3, \\quad u = \\operatorname{clamp}\\left(\\frac{x - a}{b - a}, 0, 1\\right)',
        text: '0 below a, 1 above b and an S-shaped ramp in between: a soft edge whose width is b − a. 1 − smoothstep(−ε, ε, d) of a signed distance d is a filled shape with an edge 2ε wide.',
        knob: { label: 'edge width', min: 0.05, max: 2, step: 0.05, value: 0.5 },
        plot: e => ({ series: [{ f: x => smooth(-e, e, x) }], domain: [-2, 2], range: [0, 1.05], xLabel: 'x', yLabel: 'smoothstep(−ε, ε, x)', marks: [{ x: -e, label: '−ε' }, { x: e, label: 'ε' }] })
    },
    sdf: {
        title: 'Signed distance',
        tex: 'd(p) = |p| - r',
        text: 'A shape can be described by how far a point is from its edge: negative inside, zero on the edge, positive outside (here a circle of radius r). Feed d to a smoothstep for a filled shape, to a Gaussian for a glowing outline, or to a gate for a sharp one. Distances also combine: min/max give unions and intersections.'
    },
    'implicit-curve': {
        title: 'Curves as zero sets',
        tex: 'L(p) = 0',
        text: 'A curve can be given as the points where a function is zero. The sign of L tells which side a point is on and its size roughly how far it is. The nebula’s shell residual L_s is such a function; it is not an exact distance, but its zero set is the shell and its sign is inside/outside.'
    },
    polar: {
        title: 'Polar coordinates',
        tex: 'r = |p|, \\quad \\theta = \\operatorname{atan2}(p_y, p_x)',
        text: 'The distance from the origin and the angle around it (−π to π). A pattern that depends on θ repeats around the circle; one that depends on r makes rings; one that depends on θ − k log r makes spirals. The angle jumps from π to −π on the negative x axis, which whole-number repetitions hide.'
    },
    fold: {
        title: 'Folding with arccos(cos t)',
        tex: 'O(t) = \\arccos(\\cos t)',
        text: 'A triangle wave between 0 and π: it rises, then mirrors back down, forever. Folding both coordinates this way turns the whole plane into identical mirrored cells, so one shape drawn at the origin appears at every cell center. The folded star lattices draw one star this way and get a whole lattice of them; mod and abs fold the angle of the kaleidoscope the same way.',
        knob: { label: 'frequency', min: 0.5, max: 4, step: 0.1, value: 1 },
        plot: f => ({ series: [{ f: t => Math.acos(Math.cos(f * t)) }], domain: [-10, 10], range: [0, 3.3], xLabel: 't', yLabel: 'arccos(cos ft)' })
    },
    'value-noise': {
        title: 'Value noise',
        text: 'Pseudo-random values at the corners of a unit grid, blended smoothly in between: a bumpy field in 0–1 with features about one unit wide. The random values come from a hash of the corner coordinates, so the noise is the same every time and needs no stored texture.',
        knob: { label: 'frequency', min: 0.5, max: 8, step: 0.5, value: 2 },
        plot: f => ({ series: [{ f: x => valueNoise1(x * f) }], domain: [0, 5], range: [0, 1], xLabel: 'x', yLabel: 'n(fx)', samples: 240 })
    },
    fbm: {
        title: 'Fractal noise (fBm)',
        tex: 'f = \\frac{1}{Z}\\sum_{k} 2^{-k}\\, n(2^k p)',
        text: 'Layers (octaves) of noise, each twice as fine and half as strong: large shapes with ever smaller detail on top, like clouds, terrain or smoke. More octaves add finer detail; the first few decide the overall shapes.',
        knob: { label: 'octaves', min: 1, max: 8, step: 1, value: 4 },
        plot: n => ({ series: [{ f: x => fbm1(x * 2, n) }], domain: [0, 5], range: [0, 1], xLabel: 'x', yLabel: 'fbm', samples: 320 })
    },
    'domain-warp': {
        title: 'Domain warping',
        tex: 'f(p + A\\,\\mathbf{d}(p))',
        text: 'Push the coordinates around with a smooth field before a pattern reads them. The pattern itself is unchanged; only where it is sampled moves. Straight stripes become marble, a teardrop becomes a flame, a sphere’s surface coordinates become swirling storms.'
    },
    'phase-modulation': {
        title: 'Phase modulation',
        tex: '\\cos\\left(\\nu x + \\beta \\sin(\\mu y)\\right)',
        text: 'A wave inside another wave’s phase bends its stripes: with β = 0 the bands are straight; the larger β, the more they meander. A cosine inside a cosine is the simplest way to get complex yet smooth structure, and the source nebula nests them in every turbulence band.',
        knob: { label: 'bend β', min: 0, max: 8, step: 0.25, value: 2 },
        plot: b => ({ series: [{ f: x => Math.cos(6 * x + b * Math.sin(2 * x)) }], domain: [0, 4], range: [-1.1, 1.1], xLabel: 'x', yLabel: 'cos(6x + β sin 2x)', samples: 320 })
    },
    'sum-of-bands': {
        title: 'Sums of bands',
        tex: '\\sum_{s=1}^{N} 0.95^{s} \\cos(1.25^{s} x + \\phi_s)',
        text: 'Many waves, each finer (frequency × 1.25) and a little weaker (× 0.95) than the last. Because the weights shrink slowly, fine bands still matter, which gives a rough, turbulent texture rather than a smooth one. Fewer bands give blobbier results.',
        knob: { label: 'bands N', min: 1, max: 20, step: 1, value: 8 },
        plot: n => ({ series: [{ f: x => { let s = 0; for (let k = 1; k <= n; k++) { s += 0.95 ** k * Math.cos(1.25 ** k * x + 2 * Math.cos(17 * k)); } return s; } }], domain: [0, 6], xLabel: 'x', yLabel: 'sum', samples: 400 })
    },
    'first-hit': {
        title: 'Front-to-back selection',
        tex: 'w_s = J_s \\prod_{u < s} (1 - J_u)',
        text: 'Imagine stacked translucent sheets: sheet s receives whatever the sheets before it let through. With gates J that are nearly 0 or 1, each point is claimed by the first shell that contains it, and overlapping shells do not add up twice. The weights always sum to at most 1.'
    },
    mix: {
        title: 'Linear interpolation (mix)',
        tex: '\\operatorname{mix}(a, b, t) = a + (b - a)\\, t',
        text: 't = 0 gives a, t = 1 gives b and values between blend them. With two colors it is a gradient; with t taken from a field it paints the field.',
        knob: { label: 'power γ', min: 0.2, max: 4, step: 0.1, value: 1 },
        plot: g => ({ series: [{ f: t => t ** g }], domain: [0, 1], range: [0, 1], xLabel: 't', yLabel: 'tᵞ (how far toward b)' })
    },
    over: {
        title: 'Front over back',
        tex: '\\alpha = \\alpha_F + \\alpha_B (1 - \\alpha_F)',
        text: 'Straight-alpha compositing, like paper cutouts: the front covers a fraction α_F of the pixel and the back shows through the rest. Use it whenever something must hide what is behind it.'
    },
    'additive-light': {
        title: 'Adding light',
        tex: 'L = L_1 + L_2',
        text: 'Light from independent sources adds up, so stars, gas and glows are summed, not painted over each other. Sums can exceed 1; only the final output conversion maps light to screen colors, so nothing clips in between.'
    },
    radiance: {
        title: 'Radiance, not pixels',
        text: 'Layers carry unbounded floating-point light. Only the output conversion (Source F, Filmic or Linear, in the timeline bar) turns it into screen colors, after all composition. Multiplying or adding light therefore never loses highlight detail on the way.'
    },
    alpha: {
        title: 'Coverage (alpha)',
        text: 'How much of the pixel a layer covers, from 0 to 1, stored next to its color. Coverage matters only where layers are stacked with Over; adding light ignores it.'
    },
    masking: {
        title: 'Masking by multiplication',
        tex: 'L \\cdot m, \\quad m \\in [0, 1]',
        text: 'Multiplying light by a 0–1 mask keeps it where the mask is 1 and removes it where the mask is 0. (1 − W) removes the gas where the core glow W is on.'
    },
    'log-spiral': {
        title: 'Logarithmic spirals',
        tex: '\\theta - k \\log r = \\text{const}',
        text: 'Curves that wind outward at a constant angle, as in galaxies, hurricanes and shells. A pattern of the phase m θ − k log r has m arms; k sets how tightly they wind.',
        knob: { label: 'winding k', min: 0.5, max: 12, step: 0.5, value: 4 },
        plot: k => ({ series: [{ f: r => k * Math.log(r) }], domain: [0.05, 2], xLabel: 'r', yLabel: 'arm angle θ = k log r' })
    },
    hash: {
        title: 'Deterministic randomness',
        text: 'A hash turns cell coordinates (plus a seed) into pseudo-random numbers in 0–1. The same inputs always give the same numbers, so random-looking stars and quills are exactly reproducible, a different seed gives a new arrangement, and animation never depends on earlier frames.'
    },
    lensing: {
        title: 'Lensing, illustrated',
        tex: 'q = p - \\sum_i m_i \\frac{p - c_i}{|p - c_i|^2 + \\epsilon^2}',
        text: 'Mass bends light, so a background source seen near a mass appears pushed away from it and stretched into arcs. As a backward map: each pixel samples the background at a point displaced toward the masses. ε softens the singularity at each mass.',
        knob: { label: 'softening ε', min: 0.01, max: 0.5, step: 0.01, value: 0.1 },
        plot: e => ({ series: [{ f: d => d / (d * d + e * e) }], domain: [0, 2], xLabel: 'distance |p − c|', yLabel: 'deflection / m', marks: [{ x: e, label: 'ε' }] })
    },
    shear: {
        title: 'Shear',
        tex: '(x + a y,\\ y - b x)',
        text: 'Slants the plane: lines through the origin tilt while their spacing changes little. Giving each nebula shell its own shear makes the shells lean different ways instead of lining up.'
    },
    'sphere-normal': {
        title: 'A sphere from a disc',
        tex: '\\mathbf{n} = \\left(x,\\ y,\\ \\sqrt{1 - x^2 - y^2}\\right)',
        text: 'Inside the unit disc, adding z = √(1 − x² − y²) gives the point on the visible half of a unit sphere, which is also its surface normal. Lighting then depends on the angle between the normal and the light.'
    },
    lambert: {
        title: 'Diffuse lighting',
        tex: '\\max(\\mathbf{n} \\cdot \\mathbf{l},\\ 0)',
        text: 'A matte surface is brightest where it faces the light and dark where it faces away; the dot product of the normal n and the light direction l measures exactly that (the cosine of the angle between them).',
        plot: () => ({ series: [{ f: a => Math.max(Math.cos(a), 0) }], domain: [-Math.PI, Math.PI], range: [0, 1.05], xLabel: 'angle to the light (rad)', yLabel: 'brightness' })
    },
    stamp: {
        title: 'Stamps and instancing',
        text: 'Draw one object once, in its own local coordinates (a feather from base 0 to tip 1). To place copies, transform the coordinates before sampling it: rotate, scale and translate p, then combine the copies with Over. The same kernel yields a whole fan.'
    },
    union: {
        title: 'Combining shapes',
        tex: '\\max(a, b), \\quad \\min(a, b), \\quad 1 - a',
        text: 'For 0–1 coverage masks, max is the union, min the intersection and 1 − a the complement. Silhouettes are built from simple pieces this way.'
    }
};
/** The concept with this id, or throw (catalog typos fail the unit tests). */
export function concept(id) {
    if (!Object.hasOwn(concepts, id)) {
        throw new Error(`Unknown concept ${id}`);
    }
    return concepts[id];
}
