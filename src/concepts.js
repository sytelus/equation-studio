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
    },
    // ---- Animation: shader code and point clouds -----------------------------------
    'shader-code': {
        title: 'A program for one pixel',
        tex: 'o = \\operatorname{code}(\\mathrm{FC}, r, t)',
        text: 'Shader code is the recipe for the color of a single pixel. It gets the pixel position FC (in pixels, from the bottom-left corner), the resolution r and the time t, and adds light to the output o, which starts black. The GPU runs the same code for every pixel at once; the pictures differ only because FC differs. On twigl.app this whole program often fits in one tweet.'
    },
    'per-pixel': {
        title: 'Every pixel on its own',
        text: 'A pixel never sees its neighbors or the previous frame: the code recomputes everything from FC and t, every frame. That is why the animations can be scrubbed to any time, zoomed and paused, and why a frame is exactly reproducible. It also means that everything you see, even a whole 3D scene, is rediscovered from scratch by every pixel.'
    },
    raymarching: {
        title: 'Raymarching',
        tex: 'p = \\mathbf{c} + g\\,\\mathbf{d}, \\quad g \\leftarrow g + e(p)',
        text: 'A 3D scene with no triangles. Each pixel shoots a ray from the camera c in its own direction d and walks along it: at the current point p it asks the distance estimate e(p) how far the nearest surface can be, and steps that far. Near a surface the steps become tiny and the ray stops advancing; g is the distance travelled, the depth. Most codes here march a fixed number of steps (the outer loop) and never stop early.',
        knob: { label: 'surface slant (°)', min: 0, max: 85, step: 5, value: 60 },
        plot: a => {
            const c = Math.cos(a * Math.PI / 180);
            return { series: [{ f: k => 1 - (1 - c) ** Math.floor(k), label: 'depth g after k steps' }], domain: [0, 20], range: [0, 1.05], xLabel: 'step k', yLabel: 'g (surface at 1)', samples: 200 };
        }
    },
    'distance-estimate': {
        title: 'Distance estimates',
        tex: 'e(p) \\le \\text{distance from } p \\text{ to the surface}',
        text: 'The function a raymarcher steps by: zero on the surface, positive outside, and never larger than the true distance, so a step of e cannot jump through anything. Simple shapes have exact ones (a sphere: |p| − R; a cylinder around y: |p.xz| − R); min(a, b) joins two shapes, max(a, −b) cuts one from another. Fractals divide by the total scale of their folds to stay safe.'
    },
    glow: {
        title: 'Glow by accumulation',
        tex: 'o = \\sum_{i} \\frac{c}{\\exp(k\\, e_i)}',
        text: 'Instead of shading the surface where a ray stops, many of these codes add a little light at every step: a lot when the step’s distance e is tiny (the ray grazes a surface), almost nothing when it is large. The sum over all steps gives soft glowing edges and a volumetric look for free. A larger k keeps the glow closer to the surfaces.',
        knob: { label: 'sharpness k', min: 10, max: 2000, step: 10, value: 300 },
        plot: k => ({ series: [{ f: e => Math.exp(-k * e) }], domain: [0, 0.02], range: [0, 1.05], xLabel: 'distance e at a step', yLabel: 'light added (× c)' })
    },
    'domain-repetition': {
        title: 'Repetition: p − round(p)',
        tex: 'p \\leftarrow p - \\operatorname{round}(p)',
        text: 'Subtracting the nearest whole number sends every point into the unit cell around the origin (−½ to ½ on each axis). Whatever is drawn in that one cell appears in every cell: one object becomes an endless lattice at the cost of one line. fract(p) − 0.5 does the same.',
        plot: () => ({ series: [{ f: x => x - Math.round(x) }], domain: [-3, 3], range: [-0.6, 0.6], xLabel: 'x', yLabel: 'x − round(x)', samples: 600 })
    },
    'kaleidoscopic-fold': {
        title: 'Folding fractals',
        tex: 'p \\leftarrow |p| - c, \\quad p \\leftarrow s\\,p',
        text: 'abs(p) mirrors space into one octant; subtracting c shifts the mirror; scaling by s zooms. Repeating the three a dozen times folds space into a crystal of copies of copies: every fold doubles the number of reflected pieces, so detail grows exponentially with the loop count. The scale gained along the way (often called s or S) divides the final distance so the raymarcher can still trust it.'
    },
    'sphere-inversion': {
        title: 'Sphere inversion',
        tex: 'p \\leftarrow \\frac{p}{|p|^2}',
        text: 'Turns space inside out through the unit sphere: points near the center fly far away and far points come close, while spheres stay spheres. Alternated with folds (p /= dot(p, p)) it produces the endlessly nested bubbles of Kleinian and Apollonian fractals. The factor dot(p, p) of each inversion is how much that piece was shrunk.',
        plot: () => ({ series: [{ f: r => 1 / r }], domain: [0.1, 3], range: [0, 10], xLabel: '|p| before', yLabel: '|p| after' })
    },
    'log-polar': {
        title: 'An endless zoom: log R − t',
        tex: '(u, v) = (\\log R - t,\\ \\theta)',
        text: 'In logarithmic polar coordinates, zooming into the center is a shift of log R, so subtracting t makes the picture zoom forever without ever running out of detail: each doubling of distance is one more unit of u. Yohei Nishitsuji’s tunnels use this with the angle θ (atan) and a height, so the camera flies through a pattern that repeats at every scale.',
        plot: () => ({ series: [{ f: r => Math.log(r) }], domain: [0.05, 4], range: [-3, 1.5], xLabel: 'distance R', yLabel: 'log R' })
    },
    'octave-doubling': {
        title: 'Octaves by doubling: s += s',
        tex: 'e \\leftarrow e + \\sum_{s = 1, 2, 4, \\ldots} \\frac{w(s\\,p)}{s}',
        text: 'A loop that doubles s each time adds the same wave pattern w at frequencies 1, 2, 4, 8, … with amplitudes 1, ½, ¼, …: large shapes carrying ever finer detail, exactly like fractal noise. The loop ends when s passes a limit, so the limit sets the finest detail (log₂ of it is the number of octaves).',
        knob: { label: 'octaves', min: 1, max: 9, step: 1, value: 5 },
        plot: n => ({ series: [{ f: x => { let e = 0; for (let k = 0, s = 1; k < n; k++, s += s) { e += Math.sin(x * s + k) / s; } return e; } }], domain: [0, 6.3], range: [-2, 2], xLabel: 'x', yLabel: 'Σ sin(s x)/s', samples: 500 })
    },
    'hsv-color': {
        title: 'Hue, saturation, value',
        tex: '\\operatorname{hsv}(h, s, v)',
        text: 'A color from three numbers: the hue h goes around the color wheel (0 red, ⅓ green, ⅔ blue, 1 red again, so it repeats), s is how colorful it is (0 gray) and v how bright. Codes often compute h from a depth or a distance, so the color labels how far a surface is; v may exceed 1 for light that the display clips to white.',
        knob: { label: 'saturation s', min: 0, max: 1, step: 0.05, value: 1 },
        plot: s => {
            const channel = (h, k) => { const p = Math.abs(((h + k) % 1) * 6 - 3); return 1 + s * (Math.min(Math.max(p - 1, 0), 1) - 1); };
            return { series: [{ f: h => channel(h, 1), label: 'red' }, { f: h => channel(h, 2 / 3), label: 'green' }, { f: h => channel(h, 1 / 3), label: 'blue' }], domain: [0, 1], range: [0, 1.05], xLabel: 'hue h', yLabel: 'channel (v = 1)' };
        }
    },
    'rotation-matrix': {
        title: 'Turning with a matrix',
        tex: 'v\\, R(a), \\quad R(a) = \\operatorname{rotate2D}(a)',
        text: 'rotate2D(a) is the 2×2 matrix of a rotation, so p.xz *= rotate2D(a) turns the x–z coordinates of p (a turn about the y axis) and p.xy *= rotate2D(a) a turn about z. Rotating p before measuring a shape turns the shape the other way; with a = t it spins, with a depending on p it twists.'
    },
    'soft-clip': {
        title: 'Soft clipping with tanh',
        tex: '\\tanh(x)',
        text: 'Squeezes any brightness into the range −1 to 1: small values pass almost unchanged, large ones approach 1 smoothly instead of being cut off. As the last line of a code (o = tanh(o)) it acts as a gentle tone mapping, so bright cores keep their color instead of burning out to white.',
        knob: { label: 'input gain', min: 0.2, max: 5, step: 0.1, value: 1 },
        plot: k => ({ series: [{ f: x => Math.tanh(k * x), label: 'tanh' }, { f: x => Math.min(Math.max(k * x, -1), 1), label: 'hard clip' }], domain: [-3, 3], range: [-1.1, 1.1], xLabel: 'x', yLabel: 'output' })
    },
    'point-cloud': {
        title: 'One formula, thousands of points',
        tex: '\\mathbf{x}_i = f(i, t), \\quad i = 0, \\ldots, n - 1',
        text: 'A point cloud evaluates the same formula for every index i and draws a dot there. Structure appears because i is secretly a coordinate: consecutive i trace a curve, and expressions like i/7 and i/99 (or cos(i/49)) split the index into several slow and fast parameters, so the dots sweep out a surface. The time t moves every dot a little each frame.'
    },
    density: {
        title: 'Density becomes brightness',
        tex: 'L = 1 - (1 - \\alpha)^m',
        text: 'Each dot is faint (opacity α), so a single one barely shows; where m dots overlap, the light builds up as 1 − (1 − α)^m. Dense places glow and sparse places fade, which gives point clouds their soft, volumetric shading without any lighting calculation.',
        knob: { label: 'opacity α', min: 0.02, max: 1, step: 0.02, value: 0.26 },
        plot: a => ({ series: [{ f: m => 1 - (1 - a) ** m }], domain: [0, 20], range: [0, 1.05], xLabel: 'dots overlapping m', yLabel: 'brightness' })
    },
    'seamless-loop': {
        title: 'Seamless loops',
        tex: 'f(t + T) = f(t)',
        text: 'An animation loops without a jump when everything that depends on the time repeats with the same period T. sin(t) and rotate2D(t) repeat every 2π ≈ 6.283 seconds, which is why many of these clips last exactly 6.283 s, 12.566 s or 25.13 s; a term like t/8 needs 8 × 2π. The Stats tab measures how different the last frame is from the first.'
    },
    volumetric: {
        title: 'Volumes without surfaces',
        tex: 'L = \\sum_{k} \\rho(p_k)\\, c(p_k)\\, \\Delta',
        text: 'Soft things such as smoke, fur or glowing gas have no surface to hit. A volumetric raymarcher walks through them in small steps and adds the light emitted at each point, weighted by the density ρ there. Thin bright fibers appear where the density is high in a narrow region.'
    }
};
/** The concept with this id, or throw (catalog typos fail the unit tests). */
export function concept(id) {
    if (!Object.hasOwn(concepts, id)) {
        throw new Error(`Unknown concept ${id}`);
    }
    return concepts[id];
}
