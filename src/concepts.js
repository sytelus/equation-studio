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
        title: 'From pixels to points on a plane',
        tex: 'p = \\frac{W}{w\\, z}\\left(\\mathbf{x} - \\frac{\\mathbf{s}}{2}\\right) + \\mathbf{o}',
        text: 'The picture is a window onto an endless flat plane, like a camera looking down at a huge sheet of paper. Before any equation runs, each pixel is turned into a point p of that plane. Here x is the pixel’s position and s is the image size, both in pixels, so x − s/2 measures from the center of the image. Multiplying by W/(w z) turns pixels into plane units: W is how wide the view is at zoom 1 (2000/420, about 4.76 units), w is the image width in pixels and z is the zoom. Adding o, the pan, slides the window around the plane. Because every equation works with p and never with pixels, a bigger image shows the same picture with finer detail.'
    },
    'backward-map': {
        title: 'Backward mapping: each pixel looks elsewhere',
        tex: 'I_{\\text{moved}}(p) = I\\left(M^{-1}(p)\\right)',
        text: 'To move, turn or bend a picture, the studio never moves the picture itself: it changes where each pixel looks. Here I is the original picture, the left side is the moved picture, M is the move you want (say, 1 unit to the right) and M⁻¹, “M inverse”, is that move undone (1 unit to the left). A pixel at p shows what I has at M⁻¹(p), the spot it would have come from. Think of every pixel copying the color of the spot just to its left: the whole picture appears shifted to the right, though nothing traveled. That is why moves are written with minus signs: to slide a shape right, each pixel looks at x − 1. Everything that later reads these moved coordinates moves the same way.'
    },
    rotation: {
        title: 'Rotation: turning points around the center',
        tex: 'R(\\theta)\\,(x, y) = (x\\cos\\theta - y\\sin\\theta,\\ x\\sin\\theta + y\\cos\\theta)',
        text: 'R(θ), “rotate by θ (theta)”, turns a point (x, y) counter-clockwise around the center (0, 0), like a clock hand running backward. The point keeps its distance from the center; only its direction changes. Angles are measured in radians: 2π, about 6.28, is a full turn, so 1.57 is a quarter turn. The sine and cosine of θ (sin θ and cos θ) are the numbers that do the turning: θ = 0 leaves (x, y) unchanged, and a quarter turn moves (1, 0) to (0, 1). If the angle changes with the distance from the center, rings at different distances turn by different amounts and the picture twists like a whirlpool.'
    },
    gaussian: {
        title: 'The Gaussian bump: a soft hill',
        tex: 'e^{-(d/w)^2}',
        text: 'The plot shows a soft hill: exactly 1 in the middle, fading smoothly to 0 on both sides. The formula divides a distance d by a width w, squares it, and raises e (a special number, about 2.718) to minus that amount, so the bigger d gets, the smaller the result. At d = 0 the value is 1, at d = w it has dropped to about 0.37, and beyond 3w it is practically 0. If d is the distance to a point you get a soft dot, if it is the distance to a curve you get a glowing line, and if it is the distance to a ring you get a glowing rim. Drag the width w to make the hill narrower or wider.',
        knob: { label: 'width w', min: 0.1, max: 2, step: 0.05, value: 0.5 },
        plot: w => ({ series: [{ f: d => Math.exp(-((d / w) ** 2)) }], domain: [-2.5, 2.5], range: [0, 1.05], xLabel: 'd', yLabel: 'e^−(d/w)²', marks: [{ x: w, label: 'w' }, { x: -w }] })
    },
    gate: {
        title: 'The double-exponential gate: a soft switch',
        tex: 'e^{-e^{k(x - \\ell)}}',
        text: 'This is a soft on/off switch, a smooth way of saying “if x is below ℓ”. It is about 1 (on) when x is well below the level ℓ and about 0 (off) when x is well above it, and right at x = ℓ it equals about 0.37. It uses e (a special number, about 2.718) twice: e raised to k(x − ℓ) grows very fast, and e raised to minus that squashes the result back between 0 and 1. The number k sets how quickly it switches, over a stretch of roughly 1/k, and a negative k flips the switch (the second curve in the plot). The original nebula uses gates everywhere, and multiplying two gates gives a soft “this AND that” with no jagged edges. Drag the steepness k to go from a gentle slope to an almost vertical cliff.',
        knob: { label: 'steepness k', min: 0.5, max: 30, step: 0.5, value: 4 },
        plot: k => ({ series: [{ f: x => gate(k * x), label: 'e^−e^(kx)' }, { f: x => gate(-k * x), label: 'e^−e^(−kx)' }], domain: [-2, 2], range: [0, 1.05], xLabel: 'x − ℓ', yLabel: 'gate', marks: [{ x: 0, label: 'ℓ' }] })
    },
    smoothstep: {
        title: 'Smoothstep: a soft edge',
        tex: '\\operatorname{smoothstep}(a, b, x) = 3u^2 - 2u^3, \\quad u = \\operatorname{clamp}\\left(\\frac{x - a}{b - a}, 0, 1\\right)',
        text: 'Smoothstep makes a soft edge: it is 0 when x is below a, 1 when x is above b, and climbs along a gentle S-shaped curve in between. First u measures how far x has come from a toward b, as a fraction, and clamp(…, 0, 1) keeps that fraction between 0 and 1, like a ruler that stops at both ends. Then 3u² − 2u³ bends the straight ramp into an S that starts and ends flat, so the edge has no visible corners. The soft edge is b − a wide. For a shape with signed distance d (negative inside, positive outside), 1 − smoothstep(−ε, ε, d) fills the inside with an edge 2ε wide. Drag ε, half the edge width, to make the edge in the plot blurrier or crisper.',
        knob: { label: 'ε, half the edge width', min: 0.05, max: 2, step: 0.05, value: 0.5 },
        plot: e => ({ series: [{ f: x => smooth(-e, e, x) }], domain: [-2, 2], range: [0, 1.05], xLabel: 'x', yLabel: 'smoothstep(−ε, ε, x)', marks: [{ x: -e, label: '−ε' }, { x: e, label: 'ε' }] })
    },
    sdf: {
        title: 'Signed distance: how far from the edge',
        tex: 'd(p) = |p| - r',
        text: 'A shape can be described by telling every point how far it is from the edge. The trick is the sign: d is negative inside the shape, zero on the edge and positive outside, like height above sea level, which is negative under water. For a circle of radius r around the center, |p| is the distance of the point p from the center, so d = |p| − r is how far p is outside the circle. Feed d to a smoothstep for a filled shape, to a Gaussian bump for a glowing outline, or to a gate for a sharp one. Distances also combine: min, the smaller of two distances, draws both shapes at once, and max, the larger, keeps only the part where they overlap.'
    },
    'implicit-curve': {
        title: 'Curves where a formula is zero',
        tex: 'L(p) = 0',
        text: 'A curve can be drawn as all the points where some formula equals zero. Here L(p) is a number computed for each point p: it is exactly 0 on the curve, and its sign tells which side of the curve p is on, like land and sea on either side of a coastline. The size of L also tells roughly how far away the curve is. The nebula’s shell formula L_s works this way. It is not an exact distance, but it is zero on the shell, and its sign tells inside from outside.'
    },
    polar: {
        title: 'Polar coordinates: angle and distance',
        tex: 'r = |p|, \\quad \\theta = \\operatorname{atan2}(p_y, p_x)',
        text: 'Polar coordinates describe a point by how far it is from the center and in which direction, like giving directions as “walk this far, that way” instead of “go this far across, then this far up”. Here r = |p| is the distance from the center, and θ (theta) is the angle, which atan2 works out from the point’s y and x coordinates, p_y and p_x. The angle runs from −π to π (about −3.14 to 3.14), which is one full turn. A pattern that depends on θ repeats around the circle like slices of a pizza, one that depends on r makes rings, and one that mixes both can make spirals. The angle jumps from π to −π on the left of the center (the negative x axis), but patterns that repeat a whole number of times per turn hide that seam.'
    },
    fold: {
        title: 'Folding with arccos(cos t)',
        tex: 'O(t) = \\arccos(\\cos t)',
        text: 'The plot shows a zigzag: it climbs from 0 to π (about 3.14), walks back down to 0, and repeats forever. cos t swings up and down, and arccos undoes it but only answers with angles between 0 and π, so the result O(t) keeps bouncing back like a ball between two walls. Folding both coordinates this way turns the whole plane into a grid of mirrored copies of one cell, like a paper snowflake folded many times. So one star drawn at the origin shows up at every point of a grid: that is how the folded star lattices get a whole lattice from one star. The kaleidoscope folds its angle the same way, with mod (a remainder that repeats) and abs (which drops the minus sign). Drag the frequency f to make the zigzag tighter or wider.',
        knob: { label: 'frequency f', min: 0.5, max: 4, step: 0.1, value: 1 },
        plot: f => ({ series: [{ f: t => Math.acos(Math.cos(f * t)) }], domain: [-10, 10], range: [0, 3.3], xLabel: 't', yLabel: 'arccos(cos ft)' })
    },
    'value-noise': {
        title: 'Value noise: smooth randomness',
        text: 'Value noise is smooth randomness: it wanders up and down like a range of hills, but it never jumps. It puts a random number from 0 to 1 at every whole-number position (the corners of a grid, in 2D) and blends smoothly in between, so the bumps are about one unit apart. The numbers are not truly random: a hash, a scrambling formula, makes them from the corner’s coordinates. So the same place always gets the same number, and the noise needs no stored picture. Drag the frequency f to squeeze more bumps into the plot, or fewer.',
        knob: { label: 'frequency f', min: 0.5, max: 8, step: 0.5, value: 2 },
        plot: f => ({ series: [{ f: x => valueNoise1(x * f) }], domain: [0, 5], range: [0, 1], xLabel: 'x', yLabel: 'n(fx)', samples: 240 })
    },
    fbm: {
        title: 'Fractal noise: bumps on bumps',
        tex: 'f = \\frac{1}{Z}\\sum_{k} 2^{-k}\\, n(2^k p)',
        text: 'Fractal noise stacks several layers of value noise, like mountains with hills on them and rocks on the hills. Each layer, called an octave, is twice as fine and half as strong as the one before: layer k reads the noise n at the point 2^k p (p times 2 multiplied by itself k times) and is weighted by 1/2^k. The Σ sign means “add up all the layers”, and dividing by Z, the total of the weights, keeps the result f between 0 and 1. The first few layers decide the big shapes and the later ones add fine detail, which is why clouds, terrain and smoke look like this. Drag the octaves slider from 1 to 8 and watch the smooth curve grow rougher.',
        knob: { label: 'octaves (layers)', min: 1, max: 8, step: 1, value: 4 },
        plot: n => ({ series: [{ f: x => fbm1(x * 2, n) }], domain: [0, 5], range: [0, 1], xLabel: 'x', yLabel: 'fbm', samples: 320 })
    },
    'domain-warp': {
        title: 'Domain warping: bending space before drawing',
        tex: 'f(p + A\\,\\mathbf{d}(p))',
        text: 'Domain warping bends the paper before the pattern is drawn on it. Each point p is pushed a little by a smooth push field d(p) before the pattern f reads it, and A sets how strong the push is. The pattern itself does not change, only where each pixel looks it up, like stripes seen through wavy bathroom glass. That is how straight stripes become marble, a teardrop becomes a flame, and the surface of a planet gets swirling storms. With A = 0 nothing moves at all.'
    },
    'phase-modulation': {
        title: 'Phase modulation: a wave inside a wave',
        tex: '\\cos\\left(\\nu x + \\beta \\sin(\\mu y)\\right)',
        text: 'Putting one wave inside another makes stripes that wander. On its own, cos(ν x) makes straight, evenly spaced stripes, and ν (nu) sets how close together they are. Adding β sin(μ y) inside shifts each stripe back and forth as y changes: μ (mu) sets how often it wiggles and β (beta) how far. With β = 0 the stripes stay straight, and the bigger β, the more they snake around, like a river that meanders more and more. It is the simplest way to get detailed yet smooth patterns, and the original nebula nests cosines like this in every turbulence band. In the plot, drag the bend β and watch the wave squeeze and stretch.',
        knob: { label: 'bend β', min: 0, max: 8, step: 0.25, value: 2 },
        plot: b => ({ series: [{ f: x => Math.cos(6 * x + b * Math.sin(2 * x)) }], domain: [0, 4], range: [-1.1, 1.1], xLabel: 'x', yLabel: 'cos(6x + β sin 2x)', samples: 320 })
    },
    'sum-of-bands': {
        title: 'Sums of bands: turbulence from many waves',
        tex: '\\sum_{s=1}^{N} 0.95^{s} \\cos(1.25^{s} x + \\phi_s)',
        text: 'This adds up (Σ) N cosine waves, called bands, each a little finer and a little weaker than the one before. Band number s wiggles 1.25^s times as fast as a plain cos x, so each band is 1.25 times finer than the last, and its strength is 0.95^s, only 5% weaker than the last. The shift φ_s (phi) moves each band sideways so they do not all line up. Because the strength shrinks so slowly, even the finest bands still count, which gives a rough, turbulent texture, like choppy water, instead of a smooth one. Drag the number of bands N from 1 to 20: with few bands the curve is blobby, and with many it turns rough.',
        knob: { label: 'bands N', min: 1, max: 20, step: 1, value: 8 },
        plot: n => ({ series: [{ f: x => { let s = 0; for (let k = 1; k <= n; k++) { s += 0.95 ** k * Math.cos(1.25 ** k * x + 2 * Math.cos(17 * k)); } return s; } }], domain: [0, 6], xLabel: 'x', yLabel: 'sum', samples: 400 })
    },
    'first-hit': {
        title: 'Front to back: the first sheet wins',
        tex: 'w_s = J_s \\prod_{u < s} (1 - J_u)',
        text: 'Imagine a stack of tinted glass sheets: each sheet only gets the light that the sheets in front of it let through. J_s, from 0 to 1, says how much sheet s is there at a point. The ∏ sign means “multiply together”, so multiplying (1 − J_u) for every sheet u in front of s gives the share still left over for sheet s, and its weight w_s is that share times J_s. When every J is nearly 0 or 1, each point belongs to the first sheet that contains it, so overlapping nebula shells are never counted twice. All the weights together add up to at most 1.'
    },
    mix: {
        title: 'Mix: blending two values',
        tex: '\\operatorname{mix}(a, b, t) = a + (b - a)\\, t',
        text: 'mix blends between two values, like a slider between two paint colors. With t = 0 you get a, with t = 1 you get b, and t = 0.5 lands exactly halfway. The formula starts at a and adds the fraction t of the gap b − a. With two colors it makes a gradient, and when t comes from a pattern, the pattern gets painted in those two colors. The plot shows t raised to a power γ (gamma) first: γ = 1 is an even blend, a bigger γ stays near a for longer, and a smaller γ rushes toward b. Drag the power γ to bend the blend.',
        knob: { label: 'power γ', min: 0.2, max: 4, step: 0.1, value: 1 },
        plot: g => ({ series: [{ f: t => t ** g }], domain: [0, 1], range: [0, 1], xLabel: 't', yLabel: 'tᵞ (how far toward b)' })
    },
    over: {
        title: 'Over: the front covers the back',
        tex: '\\alpha = \\alpha_F + \\alpha_B (1 - \\alpha_F)',
        text: 'Over stacks one layer in front of another, like paper cutouts on a table. Each layer has a coverage α (alpha), how much of the pixel it covers, from 0 (none) to 1 (all): α_F for the front layer and α_B for the back one. The front covers its share α_F, and the back can only show through the part that is left, 1 − α_F. Together they cover α = α_F + α_B(1 − α_F). Use Over whenever something should hide what is behind it.'
    },
    'additive-light': {
        title: 'Adding light',
        tex: 'L = L_1 + L_2',
        text: 'Light from separate sources simply adds up: two flashlights on the same spot make it twice as bright. So stars, gas and glows are added together: the total L is just the first light L_1 plus the second light L_2, instead of one being painted over the other. Nothing gets hidden, so a star behind a glowing cloud still shines through it. The total L may go above 1, brighter than the screen can show, and that is fine, because light only becomes a screen color at the very end, so nothing is cut off along the way.'
    },
    radiance: {
        title: 'Radiance: light, not screen colors',
        text: 'Inside the studio, every layer holds an amount of light (radiance), not a finished screen color. That amount can be far above 1, while a screen pixel stops at full brightness. Only at the very end, after all layers are combined, does the output conversion turn light into screen colors. You choose it in the timeline bar: Source F (the artist’s original mapping), Filmic (bright parts roll off softly) or Linear (anything too bright is simply cut off). Because nothing is squeezed along the way, adding or multiplying light never loses detail in the bright parts.'
    },
    alpha: {
        title: 'Coverage (alpha)',
        text: 'Alpha (α) is coverage: how much of a pixel a layer covers, from 0 (not at all) to 1 (completely). It is stored next to the layer’s color, so 0.5 means the layer covers half the pixel and half of what is behind still shows. Think of a sticker on a window: alpha says how much of the glass it hides. Coverage only matters where layers are stacked with Over. When light is added, alpha is ignored, because added light never hides anything.'
    },
    masking: {
        title: 'Masking by multiplying',
        tex: 'L \\cdot m, \\quad m \\in [0, 1]',
        text: 'Multiplying light L by a mask m keeps the light where m is 1 and removes it where m is 0, like a stencil held over a spray can. m ∈ [0, 1] means m is always a number from 0 to 1, and in-between values let part of the light through. For example, the nebula multiplies its gas by 1 − W, where W is the central glow. Where W is 1, 1 − W is 0, so the gas is removed at the center and the core glow takes over.'
    },
    'log-spiral': {
        title: 'Logarithmic spirals: arms that wind outward',
        tex: '\\theta - k \\log r = \\text{const}',
        text: 'Logarithmic spirals wind outward and keep the same shape at every size, as in galaxies, hurricanes and snail shells. Here r is the distance from the center, θ (theta) is the angle, and log r, the natural logarithm, grows by the same step (about 0.69) every time r doubles. Along one arm, θ − k log r stays the same number (that is what “= const” means), so every doubling of the distance turns the arm by the same extra angle. A pattern built from m θ − k log r has m arms, and k sets how tightly they wind. The plot shows the arm’s angle against the distance; drag the winding k to make the spiral tighter or looser.',
        knob: { label: 'winding k', min: 0.5, max: 12, step: 0.5, value: 4 },
        plot: k => ({ series: [{ f: r => k * Math.log(r) }], domain: [0.05, 2], xLabel: 'r', yLabel: 'arm angle θ = k log r' })
    },
    hash: {
        title: 'Randomness you can repeat',
        text: 'A hash is a scrambling formula: it turns the coordinates of a grid cell, plus a seed number, into a number from 0 to 1 that looks random. It is like a deck of cards that is always shuffled in exactly the same way: the same inputs always give the same number. So random-looking stars and quills come out identical every time, and a different seed deals a brand-new arrangement. Because nothing depends on earlier frames, you can jump to any moment of an animation and still see the same stars.'
    },
    lensing: {
        title: 'Gravitational lensing, illustrated',
        tex: 'q = p - \\sum_i m_i \\frac{p - c_i}{|p - c_i|^2 + \\epsilon^2}',
        text: 'Heavy things like star clusters bend light, so galaxies seen behind them look pushed aside and stretched into arcs. The studio imitates this by backward mapping: the pixel at p shows the background at a point q that is shifted toward the masses. Mass number i sits at c_i with strength m_i, and Σ adds up the pulls of all the masses; each pull points from p toward c_i and weakens with distance. Without ε (epsilon) the pull would become infinite right on top of a mass, so ε² is added underneath the fraction to soften it. The plot shows how strong the pull is at each distance: it peaks at a distance of ε and fades farther out. Drag the softening ε to make the peak lower and wider, or taller and sharper.',
        knob: { label: 'softening ε', min: 0.01, max: 0.5, step: 0.01, value: 0.1 },
        plot: e => ({ series: [{ f: d => d / (d * d + e * e) }], domain: [0, 2], xLabel: 'distance |p − c|', yLabel: 'deflection / m', marks: [{ x: e, label: 'ε' }] })
    },
    shear: {
        title: 'Shear: slanting the plane',
        tex: '(x + a y,\\ y - b x)',
        text: 'Shear slants the plane, like pushing the top of a deck of cards sideways so the stack leans. The formula replaces x by x + a y, so the higher a point is, the farther it slides sideways, with a setting how far. It also replaces y by y − b x, so points farther right move down (for a positive b). Straight lines stay straight, but they lean. Giving each nebula shell its own a and b makes the shells lean different ways instead of lining up.'
    },
    'sphere-normal': {
        title: 'A ball from a flat disc',
        tex: '\\mathbf{n} = \\left(x,\\ y,\\ \\sqrt{1 - x^2 - y^2}\\right)',
        text: 'A flat disc can be turned into a ball with one square root. For each point (x, y) inside a circle of radius 1, z = √(1 − x² − y²) is how far the ball’s surface bulges toward you there: 1 in the middle and 0 at the rim. Then (x, y, z) lies on the front half of a ball of radius 1, because x² + y² + z² = 1. The same three numbers, called n, also say which way the surface faces at that point, like an arrow sticking straight out of the ball (its normal). Lighting uses this arrow to decide how bright each point is.'
    },
    lambert: {
        title: 'Diffuse lighting: facing the light',
        tex: '\\max(\\mathbf{n} \\cdot \\mathbf{l},\\ 0)',
        text: 'A matte surface, like chalk or paper, is brightest where it faces the light and gets darker as it turns away. Here n is an arrow of length 1 pointing straight out of the surface, and l is an arrow of length 1 pointing toward the light. Their dot product n · l (multiply matching parts and add them up) is the cosine of the angle between them: 1 when the surface faces the light head-on and 0 when the light just grazes it. Facing away would give a negative number, so max(…, 0), the larger of it and 0, turns that into 0, which is dark. The plot shows the brightness for every angle to the light.',
        plot: () => ({ series: [{ f: a => Math.max(Math.cos(a), 0) }], domain: [-Math.PI, Math.PI], range: [0, 1.05], xLabel: 'angle to the light (rad)', yLabel: 'brightness' })
    },
    stamp: {
        title: 'Stamps: draw once, place many copies',
        text: 'To draw many copies of an object, draw it once and move the coordinates instead of the drawing. The object lives in its own little coordinate system, for example a feather that runs from 0 at its base to 1 at its tip. To place a copy, turn, scale and shift the point p before looking up the feather, just as in backward mapping. Each copy is like a rubber stamp pressed down in a different spot and direction. Stack the copies with Over, and one feather becomes a whole fan.'
    },
    union: {
        title: 'Combining shapes: join, overlap, flip',
        tex: '\\max(a, b), \\quad \\min(a, b), \\quad 1 - a',
        text: 'A mask says how much each point belongs to a shape, from 0 (outside) to 1 (inside); here a and b are two such masks. max(a, b), the larger of the two, is 1 wherever either shape is, so it joins them into one (the union). min(a, b), the smaller of the two, is 1 only where both shapes are, so it keeps just their overlap (the intersection). 1 − a flips a mask, turning inside into outside. The peacock’s body and crest are built from simple pieces this way.'
    },
    // ---- Animation: shader code and point clouds -----------------------------------
    'shader-code': {
        title: 'Shader code: a recipe for one pixel',
        tex: 'o = \\operatorname{code}(\\mathrm{FC}, r, t)',
        text: 'Shader code is a recipe for the color of one pixel: the formula says the output color o comes from running the code on three inputs. FC is the pixel’s position, in pixels from the bottom-left corner, r is the size of the picture in pixels, and t is the time in seconds. The output o starts out black, and the code adds light to it. The graphics chip (GPU) runs the same recipe for every pixel at once, and the pictures differ only because FC is different for each pixel. On twigl.app, where many of these animations come from, a whole program often fits in a single tweet.'
    },
    'per-pixel': {
        title: 'Every pixel works alone',
        text: 'Each pixel works alone: it cannot see its neighbors or what the previous frame looked like. So the code works everything out again from FC, the pixel’s position, and t, the time, in every single frame. That is why you can jump to any moment, pause and zoom, and the same frame always comes out exactly the same. It also means that even a whole 3D scene is rediscovered from scratch by every pixel, like thousands of painters each painting one dot without looking at the others.'
    },
    raymarching: {
        title: 'Raymarching: walking into a 3D scene',
        tex: 'p = \\mathbf{c} + g\\,\\mathbf{d}, \\quad g \\leftarrow g + e(p)',
        text: 'Raymarching draws a 3D scene without any triangles. For each pixel a ray starts at the camera c and heads out in that pixel’s direction d, and p = c + g d is the point a distance g along the ray. At each step the ray asks the distance estimate e(p) how far away the nearest surface could be and moves forward exactly that far (g ← g + e(p) means “add e(p) to g”). Near a surface the steps get tiny, so the ray creeps up to it and g ends up as the depth of that pixel; most codes here simply take a fixed number of steps (the outer loop) instead of stopping early. In the plot the surface is at depth 1. Drag the surface slant: a surface that faces the ray is reached in one step, while one seen at a steep slant takes many small steps.',
        knob: { label: 'surface slant (degrees)', min: 0, max: 85, step: 5, value: 60 },
        plot: a => {
            const c = Math.cos(a * Math.PI / 180);
            return { series: [{ f: k => 1 - (1 - c) ** Math.floor(k), label: 'depth g after k steps' }], domain: [0, 20], range: [0, 1.05], xLabel: 'step k', yLabel: 'g (surface at 1)', samples: 200 };
        }
    },
    'distance-estimate': {
        title: 'Distance estimates: safe step sizes',
        tex: 'e(p) \\le \\text{distance from } p \\text{ to the surface}',
        text: 'A distance estimate e(p) tells a raymarcher (a ray that walks into a 3D scene step by step) how far it can safely step from the point p. It is zero on a surface, positive outside, and never bigger than the real distance to the surface (that is what ≤ means), so a step of size e can never jump through anything. It is like walking in the dark with a stick that tells you the nearest wall is at least this far away. Simple shapes have exact ones: a ball of radius R is |p| − R, and a tube around the y axis is |p.xz| − R, which uses only the x and z coordinates. min(a, b) joins two shapes, max(a, −b) cuts shape b out of shape a, and fractals divide by how much their folds have scaled space so the estimate stays safe.'
    },
    glow: {
        title: 'Glow by adding up light',
        tex: 'o = \\sum_{i} \\frac{c}{\\exp(k\\, e_i)}',
        text: 'Instead of coloring the surface where a ray stops, many of these codes add a little light at every step along the ray. At step i the distance to the nearest surface is e_i, and the light added is the color c divided by exp(k e_i), which is e (about 2.718) raised to k × e_i. That is a lot of light when e_i is tiny (the ray brushes past a surface) and almost none when it is large. Adding up all the steps (Σ) into the output o gives soft glowing edges and a misty look for free, like fog around neon signs. Drag the sharpness k: a larger k keeps the glow closer to the surfaces.',
        knob: { label: 'sharpness k', min: 10, max: 2000, step: 10, value: 300 },
        plot: k => ({ series: [{ f: e => Math.exp(-k * e) }], domain: [0, 0.02], range: [0, 1.05], xLabel: 'distance e at a step', yLabel: 'light added (× c)' })
    },
    'domain-repetition': {
        title: 'Repetition with p − round(p)',
        tex: 'p \\leftarrow p - \\operatorname{round}(p)',
        text: 'This one line repeats a shape forever. round(p) is the nearest whole number, so p − round(p) is how far p is from it, always between −½ and ½, and the arrow ← means “replace p with this”. Every point of space lands in the same small box around the center, so whatever is drawn in that one box appears in every box, like tiles on a floor. The plot shows the result as a sawtooth: it rises from −½ to ½ and jumps back halfway between whole numbers. fract(p) − 0.5, where fract keeps only the part after the decimal point, does the same job with the boxes shifted by half a box.',
        plot: () => ({ series: [{ f: x => x - Math.round(x) }], domain: [-3, 3], range: [-0.6, 0.6], xLabel: 'x', yLabel: 'x − round(x)', samples: 600 })
    },
    'kaleidoscopic-fold': {
        title: 'Folding fractals: mirrors in mirrors',
        tex: 'p \\leftarrow |p| - c, \\quad p \\leftarrow s\\,p',
        text: 'These fractals come from folding space again and again, like folding paper to cut a snowflake. |p| (abs) drops the minus signs of the coordinates, which mirrors all of space into one corner; subtracting c moves where the mirrors sit, and multiplying by s zooms (the arrow ← means “replace p with this”). Repeating these steps a dozen times folds space into copies of copies: every fold doubles the number of mirrored pieces, so the detail grows very fast with the number of loops. The total zoom collected along the way (often called s or S) divides the final distance at the end, so the ray that walks through the scene can still trust it as a safe step.'
    },
    'sphere-inversion': {
        title: 'Sphere inversion: space turned inside out',
        tex: 'p \\leftarrow \\frac{p}{|p|^2}',
        text: 'Sphere inversion turns space inside out through a ball of radius 1. Dividing p by |p|², its distance from the center squared, keeps its direction but changes its distance from |p| to 1/|p|: points near the center fly far away, far points come close, and points on the ball stay put. The plot shows exactly that, so a distance of 0.5 becomes 2 and 2 becomes 0.5. Surprisingly, spheres stay spheres (or become flat planes if they pass through the center). In code this is p /= dot(p, p), where dot(p, p) is |p|²; alternated with folds, it makes the endlessly nested bubbles of Kleinian and Apollonian fractals, and dot(p, p) also says how much that piece was shrunk.',
        plot: () => ({ series: [{ f: r => 1 / r }], domain: [0.1, 3], range: [0, 10], xLabel: '|p| before', yLabel: '|p| after' })
    },
    'log-polar': {
        title: 'An endless zoom: log R − t',
        tex: '(u, v) = (\\log R - t,\\ \\theta)',
        text: 'In log-polar coordinates a point is described by u, the logarithm of its distance R from the center, and v, its angle θ. The logarithm log R goes up by the same step (about 0.69) every time R doubles, so zooming in toward the center simply slides u along. Subtracting the time t therefore makes the picture zoom in forever without running out of detail, like a tunnel that never ends. Yohei Nishitsuji’s tunnels use this together with the angle (from atan) and a height, so the camera seems to fly through a pattern that repeats at every size. The plot shows log R: it climbs steeply near the center and slowly far away.',
        plot: () => ({ series: [{ f: r => Math.log(r) }], domain: [0.05, 4], range: [-3, 1.5], xLabel: 'distance R', yLabel: 'log R' })
    },
    'octave-doubling': {
        title: 'Octaves by doubling: s += s',
        tex: 'e \\leftarrow e + \\sum_{s = 1, 2, 4, \\ldots} \\frac{w(s\\,p)}{s}',
        text: 'Many of these codes build detail with a tiny loop that doubles a number s each time (s += s adds s to itself). Each pass adds the same wave pattern w, read at s p and divided by s, to the running total e (the arrow ← means “replace e with this”). With s = 1, 2, 4, 8, … the waves get twice as fine and half as tall each time, so big shapes carry smaller and smaller detail, like a coastline with bays inside bays, just as in fractal noise. The loop stops when s passes a limit, so the limit sets the finest detail: log₂ of the limit, the number of times you can double 1 before reaching it, is the number of octaves (layers). Drag the octaves slider to add finer and finer ripples to the curve.',
        knob: { label: 'octaves (layers)', min: 1, max: 9, step: 1, value: 5 },
        plot: n => ({ series: [{ f: x => { let e = 0; for (let k = 0, s = 1; k < n; k++, s += s) { e += Math.sin(x * s + k) / s; } return e; } }], domain: [0, 6.3], range: [-2, 2], xLabel: 'x', yLabel: 'Σ sin(s x)/s', samples: 500 })
    },
    'hsv-color': {
        title: 'Hue, saturation, value: colors from a wheel',
        tex: '\\operatorname{hsv}(h, s, v)',
        text: 'hsv(h, s, v) makes a color from three numbers, like picking a color from a color wheel. The hue h goes around the wheel: 0 is red, ⅓ green, ⅔ blue and 1 red again, so it repeats. The saturation s is how colorful it is (0 means no color at all: gray, or white at full brightness), and the value v is how bright. Codes often compute h from a depth or a distance, so the color tells how far away a surface is, and v may go above 1 for extra-bright light. The plot shows how much red, green and blue each hue contains; drag the saturation s toward 0 and all three lines flatten out at the same level, which is white.',
        knob: { label: 'saturation s', min: 0, max: 1, step: 0.05, value: 1 },
        plot: s => {
            const channel = (h, k) => { const p = Math.abs(((h + k) % 1) * 6 - 3); return 1 + s * (Math.min(Math.max(p - 1, 0), 1) - 1); };
            return { series: [{ f: h => channel(h, 1), label: 'red' }, { f: h => channel(h, 2 / 3), label: 'green' }, { f: h => channel(h, 1 / 3), label: 'blue' }], domain: [0, 1], range: [0, 1.05], xLabel: 'hue h', yLabel: 'channel (v = 1)' };
        }
    },
    'rotation-matrix': {
        title: 'Turning with rotate2D',
        tex: 'v\\, R(a), \\quad R(a) = \\operatorname{rotate2D}(a)',
        text: 'rotate2D(a) gives R(a), a matrix: a little 2×2 table of four numbers that turns a pair of numbers by the angle a (in radians, where 6.28 is a full turn). In code, v *= rotate2D(a), written v R(a) above, turns the pair v clockwise by a. So p.xz *= rotate2D(a) turns the x and z coordinates of p, which is a turn around the y axis like a spinning top, and p.xy *= rotate2D(a) is a turn around the z axis. Turning p before measuring a shape turns the shape the other way, just as turning your head left makes the room seem to turn right. With a = t the shape spins as time passes, and if a depends on p the shape twists.'
    },
    'soft-clip': {
        title: 'Soft clipping with tanh',
        tex: '\\tanh(x)',
        text: 'tanh(x), the hyperbolic tangent, squeezes any number x into the range −1 to 1. Small values pass through almost unchanged, and big ones bend smoothly toward 1 instead of being chopped off, like a sponge that soaks up less and less as it fills. Many codes end with o = tanh(o), a gentle way to fit very bright light onto the screen, so bright centers keep some of their color instead of burning out to plain white. The plot compares tanh with a hard clip, which cuts everything off at 1 with a sharp corner. Drag the boost k, which multiplies x first, and watch tanh bend smoothly while the hard clip goes flat.',
        knob: { label: 'boost k', min: 0.2, max: 5, step: 0.1, value: 1 },
        plot: k => ({ series: [{ f: x => Math.tanh(k * x), label: 'tanh' }, { f: x => Math.min(Math.max(k * x, -1), 1), label: 'hard clip' }], domain: [-3, 3], range: [-1.1, 1.1], xLabel: 'x', yLabel: 'output' })
    },
    'point-cloud': {
        title: 'One formula, thousands of points',
        tex: '\\mathbf{x}_i = f(i, t), \\quad i = 0, \\ldots, n - 1',
        text: 'A point cloud runs the same formula f for every number i from 0 to n − 1, where n is the number of dots, and draws a dot at the result x_i. Shapes appear because i secretly works as a coordinate: consecutive values of i usually land close together, so they trace a curve. Expressions like i/7 and i/99, or cos(i/49), split i into a fast count and a slow count, like the seconds and minutes of a clock, so the dots sweep out a whole surface. The time t moves every dot a little each frame.'
    },
    density: {
        title: 'Many faint dots make brightness',
        tex: 'L = 1 - (1 - \\alpha)^m',
        text: 'Each dot is faint, with an opacity α (alpha) that says how much light it adds, so a single dot barely shows. Every dot covers the fraction α of whatever darkness is still left, so where m dots overlap, the darkness left is (1 − α)^m and the brightness is L = 1 − (1 − α)^m. Crowded places glow and sparse places fade, which gives point clouds their soft, cloudy shading without any lighting math. It works like spray paint: one quick puff barely shows, but many puffs on the same spot build up to solid color. Drag the opacity α to see how many overlapping dots it takes to reach full brightness.',
        knob: { label: 'opacity α', min: 0.02, max: 1, step: 0.02, value: 0.26 },
        plot: a => ({ series: [{ f: m => 1 - (1 - a) ** m }], domain: [0, 20], range: [0, 1.05], xLabel: 'dots overlapping m', yLabel: 'brightness' })
    },
    'seamless-loop': {
        title: 'Seamless loops',
        tex: 'f(t + T) = f(t)',
        text: 'An animation loops without a jump when everything that depends on time comes back to where it started. The formula says that f, anything computed from the time t, has the same value again T seconds later; T is called the period. sin(t) and rotate2D(t) repeat every 2π ≈ 6.283 seconds, which is why many of these clips last exactly 6.283, 12.566 or 25.13 seconds. A slower term like t/8 needs 8 × 2π, about 50.27 seconds, to come back around. The Stats tab measures how different the last frame is from the first, so you can check that a loop is seamless.'
    },
    volumetric: {
        title: 'Volumes without surfaces',
        tex: 'L = \\sum_{k} \\rho(p_k)\\, c(p_k)\\, \\Delta',
        text: 'Soft things such as smoke, fur or glowing gas have no surface for a ray to hit. A volumetric raymarcher walks through them in small steps of length Δ (delta), and at each point p_k along the ray it adds the light glowing there. That light is the color c(p_k) times the density ρ(p_k) (rho), which says how thick the material is at that point, like how dense a fog is. Σ adds up all the steps into the total light L. Thin, bright fibers appear where the density is high in a narrow region.'
    }
};
/** The concept with this id, or throw (catalog typos fail the unit tests). */
export function concept(id) {
    if (!Object.hasOwn(concepts, id)) {
        throw new Error(`Unknown concept ${id}`);
    }
    return concepts[id];
}
