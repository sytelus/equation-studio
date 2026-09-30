/** Single source of truth for the node palette, type system, UI and shader compiler.
 *
 * Each component declares:
 *   name, category, output      display name, palette group, output type
 *   inputs                      socket name → type ('coord' | 'scalar' | 'geometry' | 'layer')
 *   inputSymbols                optional socket name → TeX symbol(s) used for it in the steps
 *   params                      parameter schema; every number/color has a TeX `symbol`
 *                               that appears in the steps, and a plain-language `help`
 *   steps                       the equation, one step per line: {tex, text}, where
 *                               `text` says what the line computes and why
 *   outputSymbols               TeX symbols that are the component's result in the steps
 *   notes                       [TeX symbol, meaning] for symbols that are not parameters
 *   concepts                    ids of the ideas behind the equation (concepts.js)
 *   curve                       optional plot of the key function with live parameters:
 *                               {title, x, y, domain(P), series: [{label, f(x, P)}], marks(P)}
 *   source                      optional: the same computation in the equation language
 *                               (expression.js), one line per step with a caption; `$key`
 *                               stands for parameter `key`, inputs are p, a and b. "Edit"
 *                               starts from it (fork.js), so a user edits the math shown
 *                               in the steps rather than a call of the shader kernel. It
 *                               must compute exactly what `emit` computes (GPU-validated).
 *   equation                    one-line plain-text summary (search, docs)
 *   description                 what the component is for
 *   role                        'source' | 'modifier' | 'combine' | 'content'
 *   bypass                      socket passed through unchanged when the node is
 *                               disabled; null means a disabled node outputs typed zero
 *   emit(inputs, uniforms)      GLSL expression; receives GLSL expression strings,
 *                               not JS values. Numerical parameters are uniforms.
 *
 * `tex` (the list of step equations) is derived for compatibility.
 */
import { equationParams } from './expression.js';
import { analyzeCode, codeParams, CODE_LIMITS } from './glsl.js';
const num = (label, value, min, max, step, symbol, help) => ({ kind: 'number', label, value, min, max, step, symbol, help });
const rgb = (label, value, symbol, help) => ({ kind: 'color', label, value, symbol, help: `${help} Think of it as colored light: it becomes a screen color only at the very end.` });
const expr = value => ({ kind: 'expression', label: 'Equation', value, help: 'Write your formula one line at a time, using the point p = (x, y), its distance r and angle theta, the time t and the inputs a and b. A line “param name = value [min, max]” makes a slider, a line “name = …” names a value for later lines, and the last line is the result (loops and JavaScript are not allowed).' });
const step = (tex, text) => ({ tex, text });
const component = def => {
    const full = { inputs: {}, inputSymbols: {}, params: {}, notes: [], role: 'content', bypass: null, outputSymbols: [], concepts: [], curve: null, ...def };
    full.tex = full.steps.map(s => s.tex);
    return full;
};
const gate = x => Math.exp(-Math.exp(Math.max(-80, Math.min(6, x))));
const smooth = (a, b, x) => {
    const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
};
/** The code a new Shader code component starts with: short, commented, twigl style. */
const STARTER_CODE = [
    '// Colored rings that ripple outward. Drag any number to see what it does.',
    'vec2 p = (FC.xy - .5*r)/r.y;   // where this pixel is: (0, 0) at the center, and the picture is 1 unit tall',
    'float d = length(p);           // how far this pixel is from the center',
    'for (float i = 0.; i < 3.; i++)   // three sets of rings, each shifted a little farther out',
    '  o.rgb += hsv(d - t*.1 + i*.2, .6, .02/abs(sin(d*12. - t - i) + .001))*.1;   // add colored light, brightest where the sine wave crosses zero: the thin rings'
].join('\n');
/** The equation a new Point cloud starts with: a closed curve that wobbles in petals. */
const STARTER_POINTS = [
    'param petals = 5 [1, 12] step 1   // How many petals (bumps) the curve has.',
    'k = i/n*TAU                        // Where point i sits along the curve, as an angle from 0 to 2π (one full turn).',
    'd = 120 + 50*sin(petals*k + t)     // Its distance from the center: 120 pixels, plus or minus 50, which makes the petals.',
    'vec2(200 + d*cos(k), 200 + d*sin(k))   // The point itself, placed around the center (200, 200) of a 400-pixel sketch.'
].join('\n');
const customNotes = [['p = (x, y)', 'the point being drawn, with its x and y coordinates'], ['r, \\theta', 'the distance of p from the center, and its angle around the center (like the hand of a clock)'], ['a, b', 'two optional input numbers from other parts (0 when nothing is connected)'], ['t', 'the time in seconds']];
export const catalog = {
    coordinates: component({
        name: 'Image coordinates', category: 'Coordinates', output: 'coord', role: 'source',
        equation: 'p = (pixel − center) × worldUnitsPerPixel / zoom + pan',
        steps: [step('p = \\frac{W}{w\\, z}\\left(\\mathbf{x} - \\frac{\\mathbf{s}}{2}\\right) + \\mathbf{o}', 'Each pixel position x is measured from the center of the image and scaled so that the whole picture is W = 4.76 units wide when the zoom z is 1. Zooming in (a larger z) makes the same pixels cover a smaller piece of the plane, and the pan o slides the window around. A tiny extra shift of 1/840 of a unit puts the pixels exactly where the original nebula picture had them. From here on, every part works with points like p, never with pixels.')],
        outputSymbols: ['p'],
        notes: [['\\mathbf{x}', 'where the pixel is on the screen, counted in pixels'], ['\\mathbf{s}, w', 'the size of the image in pixels, and its width w'], ['W', 'the width of the picture in units: 2000/420, about 4.76'], ['z, \\mathbf{o}', 'the camera zoom, and the pan: the point of the plane shown at the center of the picture']],
        concepts: ['pixel-to-world'],
        description: 'Tells every pixel where it is on the picture. Each pixel becomes a point p = (x, y), with (0, 0) at the center, x growing to the right and y growing upward. The picture is about 4.76 units wide, so x runs from about −2.4 on the left edge to +2.4 on the right. Almost every scene starts with this part and feeds p to all the others.',
        emit: () => 'p'
    }),
    transform: component({
        name: 'Translate · rotate · scale', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            x: num('Center X', 0, -5, 5, 0.01, 'c_x', 'Where the shape’s own center lands, left to right. Slide right to move the shape right; slide left to move it left.'),
            y: num('Center Y', 0, -5, 5, 0.01, 'c_y', 'Where the shape’s own center lands, up and down. Slide right to move the shape up; slide left to move it down.'),
            angle: num('Rotation', 0, -6.28, 6.28, 0.01, '\\theta', 'How far the shape is turned, in radians (6.28 is one full turn). Positive values turn it counter-clockwise; negative values turn it clockwise.'),
            scale: num('Scale', 1, 0.05, 5, 0.01, 's', 'How big the shape is drawn. Slide above 1 to enlarge it; slide below 1 to shrink it.'),
            stretch: num('Vertical stretch', 1, 0.1, 4, 0.01, 'k', 'Extra stretching up and down, on top of Scale. Above 1 makes the shape taller; below 1 makes it flatter.')
        },
        equation: 'q = R(−angle) (p − center) / scale',
        steps: [
            step('c = (c_x, c_y)', 'This is the spot where the shape’s own center should land. A shape that is normally centered at (0, 0) will be drawn centered at c.'),
            step('q = \\operatorname{diag}(s,\\ s k)^{-1}\\, R(-\\theta)\\,(p - c)', 'This line works backward: instead of moving the shape, each pixel asks “where would I have been before the move?” It subtracts c, turns back by θ, and divides by the size s (and by s·k up and down). So anything drawn with q shows up moved to c, turned by θ and scaled by s.')
        ],
        outputSymbols: ['q'],
        notes: [['R(\\theta)', 'a rotation: it turns a point around the center (0, 0) by the angle θ']],
        concepts: ['backward-map', 'rotation'],
        source: [
            'c = vec2($x, $y)   // The spot where the shape’s own center should land.',
            'rotate2(p - c, -$angle)/vec2($scale, $scale*$stretch)   // Work backward: subtract c, turn back by the angle, then divide by the size.'
        ],
        description: 'Moves, turns and resizes any shape drawn through it. Instead of moving a finished picture, it changes where each pixel looks, so shapes stay perfectly sharp at any size. Put it between Image coordinates and a shape to place that shape anywhere, at any angle and size.',
        emit: (i, u) => `rotate2(${i.p}-vec2(${u.x},${u.y}),-${u.angle})/vec2(${u.scale},${u.scale}*${u.stretch})`
    }),
    vortex: component({
        name: 'Localized vortex', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            strength: num('Twist', 4, -16, 16, 0.1, '\\kappa', 'Rotation at the center in radians; 6.28 radians is one full turn. Slide right for a stronger swirl; negative values twist the other way.'),
            radius: num('Influence radius', 1, 0.02, 4, 0.02, '\\rho', 'How far out the swirl reaches: the twist fades away over about this distance. Slide right to swirl a wider area; slide left to keep it small.'),
            speed: num('Rotation speed', 0, -2, 2, 0.01, '\\omega', 'Makes the whole picture turn steadily over time, in radians per second. Zero keeps the swirl still; negative values turn it the other way.')
        },
        equation: 'q = R(strength · exp(−r²/radius²) + speed · t) p',
        steps: [
            step('\\alpha = \\kappa\\, e^{-|p|^2/\\rho^2} + \\omega t', 'This is the angle each point will be turned by. At the center it is κ, and farther out it fades smoothly toward zero, like a bell curve of width ρ. The steady spin ωt is added everywhere, so with a speed the whole picture also turns over time.'),
            step('q = R(\\alpha)\\, p', 'Now every point is turned around the center by its own angle α. Points near the middle turn a lot and points far away hardly move, so anything drawn with q gets a swirl.')
        ],
        outputSymbols: ['q'],
        notes: [['R(\\cdot)', 'turns a point around the center by the given angle'], ['\\alpha', 'how far this point is turned (its twist angle)'], ['t', 'the time in seconds']],
        concepts: ['rotation', 'gaussian', 'backward-map'],
        curve: { title: 'How far each point turns, by its distance from the center', x: 'distance |p|', y: 'angle α (rad)', domain: P => [0, 3 * P.radius], series: [{ f: (r, P) => P.strength * Math.exp(-(r * r) / (P.radius * P.radius)) }], marks: P => [{ x: P.radius, label: 'ρ' }] },
        source: [
            'alpha = $strength*exp(-(r/$radius)^2) + $speed*t   // The twist angle: κ at the center, fading away with distance, plus a steady spin over time.',
            'rotate2(p, alpha)   // Turn each point around the center by its own angle: a strong swirl in the middle, almost nothing far away.'
        ],
        description: 'Twists the space around the center into a swirl. Points near the center are turned by a large angle and points far away hardly at all, so straight lines bend into a whirlpool. Feed it into any pattern, star field or shape to stir it; the rotation speed makes the whole picture turn as well.',
        emit: (i, u) => `vortex(${i.p},${u.strength},${u.radius},${u.speed}*u_time)`
    }),
    domainwarp: component({
        name: 'Turbulent coordinate warp', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            amplitude: num('Displacement', 0.4, 0, 2, 0.01, 'A', 'How far each point is pushed. Slide right for bigger wobbles; zero switches the warp off.'),
            frequency: num('Frequency', 2, 0.1, 12, 0.1, 'f', 'How big the wobbles are. Slide right for smaller, busier wobbles; slide left for big, lazy ones.'),
            speed: num('Flow speed', 0.1, -2, 2, 0.01, '\\omega', 'How fast the wobble pattern drifts over time. Zero freezes it; negative values drift the other way.')
        },
        equation: 'q = p + amplitude · (noise₁(p,t), noise₂(p,t))',
        steps: [
            step('\\mathbf{d} = \\left(n_1(f p + \\omega t),\\ n_2(f p - \\omega t)\\right) - \\frac{1}{2}', 'Two separate noise patterns (smooth, random-looking hills of numbers between 0 and 1) give each point a push in x and a push in y. Subtracting 1/2 lets the pushes go both ways: left or right, and up or down. The frequency f sets how big the wobbles are, and ω makes them drift.'),
            step('q = p + A\\,\\mathbf{d}', 'Every point is moved by A times its push. Nearby points get similar pushes, so lines bend smoothly instead of breaking, and shapes drawn with q get wavy, marbled edges.')
        ],
        outputSymbols: ['q'],
        notes: [['n_1, n_2', 'two different noise patterns, each made of five layers of smooth noise, with values from 0 to 1'], ['\\mathbf{d}', 'the push given to this point'], ['t', 'the time in seconds']],
        concepts: ['domain-warp', 'fbm', 'backward-map'],
        source: [
            'd = vec2(fbm(p*$frequency + vec2($speed*t, 0), 5), fbm(p*$frequency + vec2(9.2, -($speed*t)), 5)) - 0.5   // Two different noise patterns, shifted so they push both ways: a push for each point.',
            'p + $amplitude*d   // Move every point by its push, so straight lines become wavy.'
        ],
        description: 'Pushes every point a little in a smooth, random-looking direction. Straight stripes turn wavy and round shapes get soft, marbled edges, like ink stirred in water. Feed it into a pattern to make it look natural; with a flow speed the wobble slowly drifts.',
        emit: (i, u) => `domainWarp(${i.p},${u.amplitude},${u.frequency},u_time*${u.speed})`
    }),
    polar: component({
        name: 'Polar coordinates', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            angleScale: num('Angle scale', 1, 0.1, 12, 0.1, 'k_\\theta', 'Multiplies the angle before it becomes x. Slide right to fit more copies of the pattern around the circle; whole numbers can hide the seam on the left.'),
            radiusScale: num('Radius scale', 1, 0.1, 12, 0.1, 'k_r', 'Multiplies the distance from the center before it becomes y. Slide right to pack the rings closer together; slide left to spread them out.')
        },
        equation: 'q = (atan2(y,x), length(p))',
        steps: [
            step('\\theta = \\operatorname{atan2}(p_y, p_x), \\quad r = |p|', 'For each point, atan2 gives its angle θ around the center, like the hand of a clock: 0 points to the right, and the angle runs from −π to π (half a turn each way). The number r is the point’s distance from the center.'),
            step('q = (k_\\theta\\, \\theta,\\ k_r\\, r)', 'The angle becomes the new x and the distance becomes the new y. Circles around the center turn into horizontal lines and rays from the center turn into vertical lines, so any stripes drawn afterward wrap into rings or spokes.')
        ],
        outputSymbols: ['q'],
        concepts: ['polar'],
        source: [
            'vec2($angleScale*theta, $radiusScale*r)   // The angle θ around the center becomes x and the distance r becomes y, so circles turn into straight lines.'
        ],
        description: 'Bends straight stripes into rings and spokes around the center. It replaces each point with two numbers: its angle around the center (like the hand of a clock) and its distance from the center. A pattern drawn after it wraps around the center, so horizontal stripes become rings and vertical stripes become spokes. There is a seam to the left of the center, where the angle jumps from +π back to −π; whole-number angle scales can hide it.',
        emit: (i, u) => `vec2(angleOf(${i.p})*${u.angleScale},length(${i.p})*${u.radiusScale})`
    }),
    kaleidoscope: component({
        name: 'Angular mirror', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            sectors: num('Sectors', 6, 2, 24, 1, 'n', 'How many mirrored wedges go around the center. Slide right for more, thinner wedges.'),
            spin: num('Rotation speed', 0.1, -1, 1, 0.01, '\\omega', 'How fast the mirror pattern turns, in radians per second. Zero holds it still; negative values turn it the other way.')
        },
        equation: 'a = |mod(theta + π/n, 2π/n) − π/n|',
        steps: [
            step('\\varphi = \\left|\\left(\\theta + \\omega t + \\frac{\\pi}{n}\\right) \\bmod \\frac{2\\pi}{n} - \\frac{\\pi}{n}\\right|', 'Start with the angle θ of the point around the center. The mod step (the remainder after dividing, like a clock that starts again after 12) folds every angle into one wedge 2π/n wide, and the absolute value |…| mirrors it about the wedge’s middle line. So all n wedges, and both halves of each, land on the same thin slice.'),
            step('q = |p|\\,(\\cos\\varphi,\\ \\sin\\varphi)', 'Build a new point at the same distance from the center, but at the folded angle φ. Anything drawn with q then repeats n times around the center with mirror symmetry, like the view in a kaleidoscope.')
        ],
        outputSymbols: ['q'],
        notes: [['\\theta', 'the angle of p around the center'], ['t', 'the time in seconds']],
        concepts: ['polar', 'fold'],
        source: [
            'w = TAU/$sectors   // The width of one wedge: a full turn (2π) divided by the number of wedges.',
            'phi = abs(mod(theta + $spin*t + 0.5*w, w) - 0.5*w)   // Fold the angle into one wedge, then mirror it about the wedge’s middle line.',
            'r*vec2(cos(phi), sin(phi))   // A point at the same distance with the folded angle, which makes n mirrored copies.'
        ],
        description: 'Copies one wedge of the picture around the center, like a kaleidoscope. Every point is folded into a single thin slice of the circle and mirrored, so whatever is drawn after it repeats n times around the center with mirror symmetry. It works with any pattern, and the rotation speed makes the whole flower slowly turn.',
        emit: (i, u) => `angularMirror(${i.p},${u.sectors},u_time*${u.spin})`
    }),
    noise: component({
        name: 'Fractal value noise', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
        params: {
            frequency: num('Frequency', 3, 0.1, 30, 0.1, '\\nu', 'How big the blobs are. Slide right for smaller, finer blobs; slide left for big ones.'),
            octaves: num('Octaves', 6, 1, 8, 1, 'N', 'How many layers of noise are stacked, each about twice as fine and half as strong as the last. Slide right to add fine detail; 1 gives plain smooth blobs.'),
            speed: num('Flow speed', 0.1, -2, 2, 0.01, '\\omega', 'How fast the pattern drifts over time: positive values slide it down, negative values slide it up. Zero freezes it.'),
            seed: num('Seed offset', 0, 0, 100, 1, '\\sigma', 'Picks a different pattern that looks just as random. Slide it until you find one you like.')
        },
        equation: 'f(p) = Σ 2⁻ᵏ noise(2ᵏ Rp + offset)',
        steps: [
            step('q = \\nu p + (\\sigma,\\ \\omega t)', 'First the plane is scaled by the frequency ν, so a larger ν packs more blobs into the picture. The seed σ shifts it sideways to a different part of the pattern, and ωt slides it a little farther every second.'),
            step('f = \\frac{1}{Z}\\sum_{k=0}^{N-1} 2^{-k}\\, n\\left(2.03^{k} M^{k} q\\right)', 'Now N layers of smooth noise n are added up. Each layer is about twice as fine as the one before (×2.03) and half as strong, and it is turned slightly by M so the layers never line up. Dividing by Z keeps the total between 0 and 1.')
        ],
        outputSymbols: ['f'],
        notes: [['n', 'smooth value noise: random-looking numbers from 0 to 1, blended smoothly between the corners of a grid'], ['M', 'a small fixed turn between one layer and the next'], ['Z', 'a divisor that keeps f between 0 and 1']],
        concepts: ['value-noise', 'fbm'],
        curve: { title: 'How strong each layer of noise is', x: 'octave k', y: 'weight 2⁻ᵏ / Z', domain: P => [-0.5, Math.max(P.octaves, 1) - 0.5], bars: P => { const n = Math.round(P.octaves), z = (1 - 0.5 ** n) * 2; return Array.from({ length: n }, (_, k) => [k, 0.5 ** k / z]); } },
        source: [
            'q = p*$frequency + vec2($seed, $speed*t)   // Scale the plane by the frequency, shift it by the seed, and slide it over time.',
            'fbm(q, $octaves)   // Add up layers of smooth noise, each twice as fine and half as strong (the loop is inside fbm, whose code is under More).'
        ],
        description: 'Makes a soft, cloudy pattern of numbers between 0 and 1. It stacks several layers of smooth noise, each finer and fainter than the one before, which gives it detail at many sizes, like clouds or rock. The same settings always give the same pattern. It is not used in the original nebula, but it is handy for new natural-looking textures; send it through Two-color emission to see it in color.',
        emit: (i, u) => `fbm(${i.p}*${u.frequency}+vec2(${u.seed},u_time*${u.speed}),${u.octaves})`
    }),
    waves: component({
        name: 'Nested cosine bands', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
        params: {
            frequency: num('Frequency', 9, 0.1, 80, 0.1, '\\nu', 'How tightly the stripes are packed. Slide right for thinner, denser stripes; slide left for wider ones.'),
            bend: num('Phase bending', 4, 0, 20, 0.1, '\\beta', 'How strongly the second wave bends the stripes. Zero gives straight stripes; slide right for deeper wiggles.'),
            speed: num('Phase speed', 0.5, -4, 4, 0.01, '\\omega', 'How fast the bends travel up the stripes over time. Zero holds them still; negative values send them down.')
        },
        equation: 'f = ½ + ½ cos(kx + b sin(ky − t))',
        steps: [
            step('\\phi = \\nu x + \\beta \\sin(0.65\\, \\nu y - \\omega t)', 'The phase φ is a number that grows steadily from left to right, which will make up-and-down stripes. A slower sine wave running along y adds or subtracts up to β, pushing each stripe left or right. That inner wave is what bends the stripes, and ωt makes the bends travel.'),
            step('f = \\frac{1}{2} + \\frac{1}{2}\\cos\\phi', 'The cosine turns the phase into a wave between −1 and 1, and halving it and adding 1/2 moves it to between 0 and 1. So f is 1 in the middle of each bright band and 0 in the middle of each dark one.')
        ],
        outputSymbols: ['f'],
        notes: [['p = (x, y)', 'the input point and its x and y coordinates'], ['\\phi', 'the phase: where the point is within the stripe pattern']],
        concepts: ['phase-modulation'],
        curve: { title: 'The pattern along one row (y = 0.3)', x: 'x', y: 'f', domain: P => [0, Math.min(3, 12 / Math.max(P.frequency, 0.1))], series: [{ f: (x, P) => 0.5 + 0.5 * Math.cos(P.frequency * x + P.bend * Math.sin(0.65 * P.frequency * 0.3)) }, { label: 'y = 0.6', f: (x, P) => 0.5 + 0.5 * Math.cos(P.frequency * x + P.bend * Math.sin(0.65 * P.frequency * 0.6)) }], range: () => [0, 1] },
        source: [
            'phase = x*$frequency + $bend*sin(y*$frequency*0.65 - $speed*t)   // Up-and-down stripes, pushed sideways by a slower wave that runs along y.',
            '0.5 + 0.5*cos(phase)   // Turn the phase into bands between 0 and 1.'
        ],
        description: 'Draws wavy stripes by letting one wave bend another. Straight stripes run up and down the picture, and a slower wave pushes them sideways, so they snake back and forth. The result is a number from 0 to 1 at every point. Send the coordinates through a warp first and the stripes turn into marble veins, as in the Living mineral scene.',
        emit: (i, u) => `(0.5+0.5*cos(${i.p}.x*${u.frequency}+${u.bend}*sin(${i.p}.y*${u.frequency}*0.65-u_time*${u.speed})))`
    }),
    disc: component({
        name: 'Soft disc / sphere mask', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1, 0.02, 3, 0.01, 'r', 'How big the disc is, measured from its center. Slide right for a bigger disc.'),
            edge: num('Edge softness', 0.02, 0.001, 0.6, 0.001, '\\epsilon', 'How blurry the rim is. Slide left for a crisp edge; slide right for a soft, fuzzy one.')
        },
        equation: 'mask = 1 − smoothstep(−edge, edge, |p| − radius)',
        steps: [
            step('d = |p| - r', 'First measure how far the point is from the rim of the circle. This signed distance d is negative inside, zero exactly on the rim, and positive outside.'),
            step('m = 1 - \\operatorname{smoothstep}\\left(-\\epsilon,\\ \\epsilon,\\ d\\right)', 'The smoothstep function is a smooth ramp: 0 before −ε, 1 after ε, and a gentle S-curve in between. Subtracting it from 1 flips it, so m is 1 inside the circle, 0 outside, and fades across a band 2ε wide at the rim.')
        ],
        outputSymbols: ['m'],
        notes: [['d', 'the signed distance to the rim: negative inside, positive outside']],
        concepts: ['sdf', 'smoothstep'],
        curve: { title: 'The mask across the rim', x: 'distance |p|', y: 'm', domain: P => [0, 2 * P.radius + 3 * P.edge], series: [{ f: (d, P) => 1 - smooth(-P.edge, P.edge, d - P.radius) }], marks: P => [{ x: P.radius, label: 'r' }], range: () => [0, 1.05] },
        source: [
            'd = length(p) - $radius   // Signed distance to the circle: negative inside, positive outside.',
            '1 - smoothstep(-$edge, $edge, d)   // 1 inside, 0 outside, with a soft edge 2ε wide.'
        ],
        description: 'Draws a filled circle: 1 inside, 0 outside, with a soft edge. It is a number at every point, not a color, so it is used to cut things out: connect it to Mask layer to show a layer only inside the circle, or multiply another pattern by it. The edge softness blurs the rim so it never looks jagged.',
        emit: (i, u) => `softInside(length(${i.p})-${u.radius},${u.edge})`
    }),
    ring: component({
        name: 'Gaussian ring', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1, 0, 3, 0.01, 'r', 'How far the bright ring is from the center. Slide right for a bigger ring.'),
            width: num('Width', 0.1, 0.005, 1, 0.005, 'w', 'How thick the ring is. Slide right for a wide, soft ring; slide left for a thin, sharp one.')
        },
        equation: 'f = exp(−((|p| − radius)/width)²)',
        steps: [
            step('d = |p| - r', 'Measure how far the point is from the circle of radius r. This signed distance d is negative inside the circle and positive outside.'),
            step('f = \\exp\\left(-\\left(\\frac{d}{w}\\right)^2\\right)', 'This bell-shaped curve (a Gaussian) is 1 when d is 0, so the circle itself is brightest. At a distance w from the circle it has dropped to 0.37, and a little farther out it is almost 0, which leaves the middle dark.')
        ],
        outputSymbols: ['f'],
        notes: [['d', 'the signed distance to the circle']],
        concepts: ['sdf', 'gaussian'],
        curve: { title: 'Brightness across the ring', x: 'distance |p|', y: 'f', domain: P => [0, P.radius + 4 * P.width + 0.2], series: [{ f: (x, P) => Math.exp(-(((x - P.radius) / P.width) ** 2)) }], marks: P => [{ x: P.radius, label: 'r' }], range: () => [0, 1.05] },
        source: [
            'd = length(p) - $radius   // Signed distance from the circle.',
            'exp(-(d/$width)^2)   // A bell-shaped bump: 1 on the circle, 0.37 at distance w from it.'
        ],
        description: 'Draws a glowing ring with a dark middle. The value is 1 right on a circle and fades smoothly to 0 on both sides, like a soft halo. It is a number at every point, so give it a color with Two-color emission or use it to shape another part.',
        emit: (i, u) => `gaussian(length(${i.p})-${u.radius},${u.width})`
    }),
    threshold: component({
        name: 'Soft threshold', category: 'Scalar fields', output: 'scalar', inputs: { field: 'scalar' }, inputSymbols: { field: 'g' }, role: 'modifier', bypass: 'field',
        params: {
            level: num('Threshold', 0.5, -2, 2, 0.01, '\\ell', 'The input value where the output switches from dark to bright (right there it is about 0.37). Slide right to keep only the highest parts of the pattern.'),
            sharpness: num('Sharpness', 8, 0.1, 60, 0.1, 's', 'How sudden the switch is. Slide right for hard-edged islands; slide left for a gentle ramp.')
        },
        equation: 'f = exp(−exp(−sharpness · (field − level)))',
        steps: [step('f = \\exp\\left(-e^{-s\\,(g - \\ell)}\\right)', 'This double exponential is a soft on/off switch: nearly 0 where the input g is well below the level ℓ, and nearly 1 where it is well above. It changes over a range of about 1/s, so a large s makes a sharp switch, and exactly at g = ℓ it equals 1/e, about 0.37. Used on a smooth pattern, it carves out islands, wisps or thin threads.')],
        outputSymbols: ['f'],
        concepts: ['gate'],
        curve: { title: 'The output for each input value', x: 'input g', y: 'f', domain: P => [P.level - Math.max(4 / P.sharpness, 0.2), P.level + Math.max(4 / P.sharpness, 0.2)], series: [{ f: (g, P) => gate(-P.sharpness * (g - P.level)) }], marks: P => [{ x: P.level, label: 'ℓ' }], range: () => [0, 1.05] },
        source: [
            'exp(-exp(-$sharpness*(a - $level)))   // The soft switch: nearly 0 below the level, nearly 1 above it.'
        ],
        description: 'Keeps only the high parts of a pattern and darkens the rest. Where the input is well below the level it gives almost 0, where it is well above it gives almost 1, and in between it rises smoothly. Used on soft noise, this turns gentle hills into islands, wisps or thin threads. The original nebula equations use this same kind of switch everywhere.',
        emit: (i, u) => `cutoff(-${u.sharpness}*(${i.field}-${u.level}))`
    }),
    fieldmath: component({
        name: 'Combine scalar fields', category: 'Scalar fields', output: 'scalar', inputs: { a: 'scalar', b: 'scalar' }, role: 'combine', bypass: 'a',
        params: {
            weightA: num('A weight', 1, -5, 5, 0.01, 'w_a', 'How much of input a goes into the result. Slide right for more; negative values subtract it.'),
            weightB: num('B weight', 1, -5, 5, 0.01, 'w_b', 'How much of input b goes into the result. Use a negative value to subtract b from a.'),
            product: num('Product weight', 0, -5, 5, 0.01, 'w_p', 'How much of a × b is added. Use it to let one pattern turn the other up and down; zero leaves it out.'),
            bias: num('Bias', 0, -4, 4, 0.01, 'c', 'A constant added to the result. Slide right to raise everything; slide left to lower it.')
        },
        equation: 'f = wa·a + wb·b + wp·a·b + bias',
        steps: [step('f = w_a\\, a + w_b\\, b + w_p\\, a b + c', 'The result is a weighted sum: w_a times a, plus w_b times b, plus w_p times a × b, plus the constant c. A negative weight subtracts, the product lets one pattern switch the other on and off, and c shifts the whole result up or down, for example just before a threshold.')],
        outputSymbols: ['f'],
        source: [
            '$weightA*a + $weightB*b + $product*a*b + $bias   // A weighted sum of the two inputs, plus their product and a constant.'
        ],
        description: 'Mixes two number patterns by adding, subtracting or multiplying them. Each input gets its own weight, the product lets one pattern turn the other up or down, and a constant shifts everything. Use it to blend two patterns, to cut one out of another, or to nudge a pattern up or down before a Soft threshold.',
        emit: (i, u) => `(${u.weightA}*${i.a}+${u.weightB}*${i.b}+${u.product}*${i.a}*${i.b}+${u.bias})`
    }),
    expression: component({
        name: 'Custom scalar equation', category: 'Authoring', output: 'scalar', inputs: { p: 'coord', a: 'scalar', b: 'scalar' }, custom: true,
        params: { expression: expr([
            'param rings = 8 [0, 30] step 0.1   // How many rings fit in one unit of distance from the center.',
            'param arms = 3 [-12, 12] step 1    // How many spiral arms there are; whole numbers join up without a seam.',
            '0.5 + 0.5*cos(rings*r - arms*theta - t)   // A wave between 0 and 1 that spirals outward as time goes on.'
        ].join('\n')) },
        equation: 'float f(p,a,b,t) = your expression',
        steps: [step('f(p, a, b, t) = \\text{your expression}', 'Your formula can use the point p = (x, y), its distance r and angle θ, the two optional inputs a and b, and the time t. Whatever the last line gives is the number for that point.')],
        outputSymbols: ['f'],
        notes: customNotes,
        description: 'Your own formula that gives a number for every point. Write it one line at a time: a param line makes a slider, a line like d = r − 1 names a value for later lines, and the last line is the result. You can use the point p = (x, y), its distance r and angle θ, the time t, two input patterns a and b, and built-in functions such as sin, smoothstep and fbm.',
        emit: () => ''
    }),
    vectorExpression: component({
        name: 'Custom coordinate equation', category: 'Authoring', output: 'coord', inputs: { p: 'coord', a: 'scalar', b: 'scalar' }, role: 'modifier', bypass: 'p', custom: true,
        params: { expression: expr([
            'param amount = 0.5 [-3, 3] step 0.01   // The largest turn, in radians (6.28 is one full turn).',
            'param ripple = 3 [0, 20] step 0.1      // How often the turning changes direction as you move out from the center.',
            'angle = amount*sin(ripple*r - t)       // Each circle of radius r is turned by its own angle.',
            'rotate2(p, angle)                      // The point turned around the center, which makes a rippling swirl.'
        ].join('\n')) },
        equation: 'vec2 q(p,a,b,t) = your expression',
        steps: [step('q(p, a, b, t) = \\text{your expression}', 'Your formula gives a new point q for every input point p. Any part that reads q draws its pattern at the new points, so your formula bends, moves or folds that pattern.')],
        outputSymbols: ['q'],
        notes: customNotes,
        concepts: ['backward-map'],
        description: 'Your own formula that moves every point somewhere new. The last line gives a new point vec2(…) for each input point p, and every part that reads it is drawn through that map, like looking through wavy glass. It is written like the other custom formulas; switched off, it passes p through unchanged.',
        emit: () => ''
    }),
    colorExpression: component({
        name: 'Custom color equation', category: 'Authoring', output: 'layer', inputs: { p: 'coord', a: 'scalar', b: 'scalar' }, custom: true,
        params: { expression: expr([
            'param petals = 6 [1, 24] step 1      // How many bright petals go around the center.',
            'param flow = 0.1 [-1, 1] step 0.01   // How fast the rainbow moves outward.',
            'hue = spectrum(r - flow*t, 0)        // A rainbow color for each distance r from the center.',
            'hue * (0.5 + 0.5*cos(petals*theta))  // The rainbow, bright in petals around the center and dark between them.'
        ].join('\n')) },
        equation: 'vec3 color(p,a,b,t) = your expression',
        steps: [step('\\mathrm{RGB}(p, a, b, t) = \\text{your expression}', 'Your formula gives a color, an amount of red, green and blue light, for every point. If the last line is a vec4, its fourth number is the coverage (how solid the color is); otherwise the color is solid everywhere.')],
        outputSymbols: ['\\mathrm{RGB}'],
        notes: customNotes,
        concepts: ['radiance'],
        description: 'Your own formula that gives a color for every point. The last line is either a color vec3(red, green, blue), which is solid everywhere, or a vec4(red, green, blue, coverage), whose fourth number says how solid the color is (1 solid, 0 see-through). It is written like the other custom formulas; put it over another layer with Front over back to use its see-through parts.',
        emit: () => ''
    }),
    code: component({
        name: 'Shader code', category: 'Code & points', output: 'layer', inputs: { p: 'coord' }, inputSymbols: { p: 'p' }, code: true,
        params: {
            code: { kind: 'code', label: 'Code', value: STARTER_CODE, help: 'Shader code in GLSL, the language graphics cards run, written as on twigl.app in its “geekest” mode: it reads the pixel position FC, the canvas size r and the time t, and adds light to the color o. You can drag any number in it, and the Code tab explains its loops, variables and helper functions.' },
            speed: num('Time speed', 1, -4, 4, 0.01, '\\sigma', 'How fast the code’s clock t runs: 1 is normal speed, 0 freezes the picture, and negative values play it backward.'),
            phase: num('Time offset', 0, -60, 60, 0.01, '\\tau_0', 'Added to the code’s clock, so it picks which moment of the animation you see at time 0. With the speed at 0, slide it to choose a still frame.')
        },
        equation: 'o = code(FC, r, t)',
        steps: [
            step('\\mathrm{FC} = \\text{pixel of } p, \\quad t = \\sigma\\,\\tau + \\tau_0', 'Each point p of the plane is turned into a pixel position FC on the code’s own canvas, which is r pixels wide. The studio clock τ becomes the code’s clock t: it runs σ times as fast and starts τ_0 seconds ahead.'),
            step('o = \\operatorname{code}(\\mathrm{FC}, r, t)', 'The code runs once for every pixel, all on its own, without looking at its neighbors. It starts with the color o = 0 (black) and adds light to it, and whatever o holds at the end is the color of this layer.')
        ],
        outputSymbols: ['o'],
        notes: [['\\mathrm{FC}', 'the pixel position of the point, as on twigl'], ['r', 'the width and height of the code’s canvas, in pixels'], ['\\tau', 'the studio time in seconds'], ['o', 'the color the code outputs']],
        concepts: ['shader-code', 'per-pixel'],
        description: 'Runs a tiny program once for every pixel to color it. This kind of program is called a shader, and it is written in GLSL, the language graphics cards understand. It works as on the website twigl.app: paste a twigl “geekest” one-liner and it runs unchanged. Then drag its numbers, stop its loops early, look at any of its values on the canvas, or warp and zoom it through its input p like any other layer.',
        emit: () => ''
    }),
    points: component({
        name: 'Point cloud', category: 'Code & points', output: 'layer', inputs: { p: 'coord' }, inputSymbols: { p: 'p' }, custom: true, points: true,
        params: {
            expression: { kind: 'expression', label: 'Equation', value: STARTER_POINTS, help: 'A formula for where dot number i (out of n) goes at time t, written as vec2(x, y) in sketch pixels, with x to the right and y down. A line “param name = value [min, max]” makes a slider, a line “name = …” names a value for later lines, and the last line is the position.' },
            count: num('Points', 20000, 1, 200000, 1, 'n', 'How many dots are drawn; i runs from 0 to n − 1. Slide right for more dots and a denser picture.'),
            size: num('Point size', 1, 0.1, 24, 0.05, 'w', 'How wide each dot is, in sketch pixels (like strokeWeight in p5.js). Slide right for bigger dots.'),
            color: rgb('Color', '#ffffff', 'C', 'The color of the dots.'),
            alpha: num('Opacity', 0.26, 0, 1, 0.005, '\\alpha', 'How solid one dot is. Slide left for fainter dots, so only crowded places glow (p5.js stroke alpha 66 is 66/255, about 0.26).'),
            canvas: num('Sketch size', 400, 50, 4000, 1, 'S', 'How many pixels wide the sketch is, like createCanvas in p5.js. The sketch always fills the width of the picture, and its center is at (S/2, S/2).'),
            speed: num('Time speed', 1, -8, 8, 0.001, '\\sigma', 'How fast the sketch’s clock runs: t = σ τ + τ₀. If a p5.js sketch adds Δ to t every frame at 60 frames per second, use σ = 60 Δ.'),
            phase: num('Time offset', 0, -200, 200, 0.01, '\\tau_0', 'Added to the sketch’s clock. With the speed at 0, slide it to choose a still frame.')
        },
        equation: 'point i at position(i, n, t), drawn with opacity α',
        steps: [
            step('t = \\sigma\\,\\tau + \\tau_0', 'The studio time τ, in seconds, becomes the sketch’s own clock t. It runs σ times as fast and starts τ_0 ahead.'),
            step('\\mathbf{x}_i = \\operatorname{position}(i, n, t), \\quad i = 0, 1, \\ldots, n - 1', 'Your formula gives the position x_i of each dot. It is the same formula every time, run n times with a different number i. Shapes appear because the formula changes smoothly from one i to the next, so dots with neighboring numbers often land near each other.'),
            step('\\mathbf{x}_i \\in [0, S] \\times [0, S] \\to \\text{the image}', 'Positions are measured in sketch pixels, just as in p5.js: x goes to the right, y goes down, and (S/2, S/2) is the center. The sketch, S pixels wide, is stretched to fill the width of the picture.'),
            step('L \\leftarrow \\operatorname{over}\\left(\\alpha\\, C\\, \\text{disc}(\\mathbf{x}_i, w),\\ L\\right)', 'Every dot is a small round spot of diameter w and color C, with opacity α, drawn on top of the dots before it. Where many dots overlap, their light piles up, so the crowded places look brightest.')
        ],
        outputSymbols: ['L'],
        notes: [['i, n', 'the number of this dot, and how many dots there are'], ['S', 'the width of the sketch in its own pixels'], ['\\tau', 'the studio time in seconds']],
        concepts: ['point-cloud', 'density'],
        description: 'Draws thousands of dots, each placed by a formula. The same formula runs once for every dot number i, from 0 up to n − 1, and for the time t, like a p5.js sketch that calls point() in a loop. Where many dots pile up, their light adds up, so crowded places glow. The dots become a layer: put it over a background, tint it, mask it, or warp it through its input p.',
        emit: () => ''
    }),
    palette: component({
        name: 'Two-color emission', category: 'Color & composition', output: 'layer', inputs: { field: 'scalar' }, inputSymbols: { field: 'f' },
        params: {
            low: rgb('Low color', '#09212e', 'C_0', 'The color where the input is 0 or below.'),
            high: rgb('High color', '#62edc3', 'C_1', 'The color where the input is 1 or above.'),
            gain: num('Emission', 1, 0, 5, 0.01, 'g', 'How brightly the colors glow overall. Slide right to brighten them; 0 turns the layer black.'),
            power: num('Contrast power', 1, 0.1, 8, 0.05, '\\gamma', 'Shapes the blend between the two colors. Slide right to keep more of the low color; slide left to push toward the high color.')
        },
        equation: 'RGB = gain · mix(low, high, clamp(field)^power)',
        steps: [
            step('u = \\operatorname{clamp}(f, 0, 1)^{\\gamma}', 'First the input f is clamped, which means it is cut off below 0 and above 1. Then it is raised to the power γ: a γ above 1 pushes middle values down toward the low color, and a γ below 1 lifts them toward the high color.'),
            step('\\mathrm{RGB} = g\\cdot \\operatorname{mix}\\left(C_0,\\ C_1,\\ u\\right), \\quad \\alpha = 1', 'The mix function blends from the low color C_0 (when u = 0) to the high color C_1 (when u = 1), and the Emission setting g makes the result brighter or darker. The coverage α is 1, so the layer is solid everywhere.')
        ],
        outputSymbols: ['\\mathrm{RGB}'],
        notes: [['u', 'how far this point is along the blend from the low color to the high color']],
        concepts: ['mix', 'radiance'],
        curve: { title: 'Where each input value falls between the two colors', x: 'field f', y: 'u', domain: () => [-0.2, 1.2], series: [{ f: (x, P) => Math.max(0, Math.min(1, x)) ** P.power }], range: () => [0, 1.05], gradient: P => [P.low, P.high] },
        source: [
            'u = clamp(a, 0, 1)^$power   // The input, cut off to 0–1 and bent by the contrast power.',
            'vec4(mix($low, $high, u)*$gain, 1)   // Blend from the low color to the high color, then brighten or dim the result; the layer is solid.'
        ],
        description: 'Colors a number pattern with a blend of two colors. Where the input is 0 or less you get the low color, where it is 1 or more you get the high color, and in between the two colors mix. The layer is solid everywhere; add a Mask layer if parts of it should be see-through.',
        emit: (i, u) => `vec4(mix(${u.low},${u.high},pow(clamp(${i.field},0.0,1.0),${u.power}))*${u.gain},1)`
    }),
    solid: component({
        name: 'Solid color', category: 'Color & composition', output: 'layer',
        params: {
            color: rgb('Color', '#030712', 'C', 'The color used everywhere.'),
            gain: num('Gain', 1, 0, 4, 0.01, 'g', 'How bright the color is. Slide right to brighten it; 0 makes it black.')
        },
        equation: 'RGB = color × gain',
        steps: [step('\\mathrm{RGB} = g\\, C, \\quad \\alpha = 1', 'Every point gets the same color C, multiplied by the gain g. Its coverage α is 1, so it is solid everywhere, which makes a good background or an even glow.')],
        outputSymbols: ['\\mathrm{RGB}'],
        source: [
            'vec4($color*$gain, 1)   // The same color, times the gain, at every point; the layer is solid.'
        ],
        description: 'Fills the whole picture with one color. Use it as a background behind other layers, or add it to a scene as an even glow. The gain makes it brighter or darker without changing its hue.',
        emit: (i, u) => `vec4(${u.color}*${u.gain},1)`
    }),
    tint: component({
        name: 'Tint & gain', category: 'Color & composition', output: 'layer', inputs: { layer: 'layer' }, inputSymbols: { layer: 'L' }, role: 'modifier', bypass: 'layer',
        params: {
            color: rgb('RGB multiplier', '#ffffff', 'C', 'Works like colored glass: each of its red, green and blue parts scales the same part of the layer, and white leaves the layer unchanged.'),
            gain: num('Gain', 1, 0, 5, 0.01, 'g', 'How bright the layer is overall. Slide right to brighten it; slide left to dim it.')
        },
        equation: 'RGB = incoming RGB × tint × gain',
        steps: [step('\\mathrm{RGB} = g\\, C \\odot L_{\\mathrm{rgb}}, \\quad \\alpha = L_{\\alpha}', 'Each color channel of the incoming layer L (red, green and blue) is multiplied by the matching channel of C, which is what ⊙ means, and then by g. The coverage α passes through unchanged, so see-through parts stay see-through.')],
        outputSymbols: ['\\mathrm{RGB}'],
        concepts: ['radiance'],
        description: 'Changes the color and brightness of a layer. It multiplies the red, green and blue light of the incoming layer by the matching parts of a color, and then by the gain. White leaves the layer as it is, and a colored tint works like colored glass. Very bright spots keep their detail, because nothing is cut off until the very end.',
        emit: (i, u) => `vec4(${i.layer}.rgb*${u.color}*${u.gain},${i.layer}.a)`
    }),
    mask: component({
        name: 'Mask layer', category: 'Color & composition', output: 'layer', inputs: { layer: 'layer', mask: 'scalar' }, inputSymbols: { layer: 'L', mask: 'm' }, role: 'modifier', bypass: 'layer',
        params: { strength: num('Strength', 1, 0, 1, 0.01, 's', 'How much the mask counts. At 1 it applies fully; at 0 it is ignored and the layer stays as it was.') },
        equation: 'alpha = alpha × mix(1, clamp(mask), strength)',
        steps: [step('\\alpha = L_{\\alpha} \\cdot \\operatorname{mix}\\left(1,\\ \\operatorname{clamp}(m, 0, 1),\\ s\\right), \\quad \\mathrm{RGB} = L_{\\mathrm{rgb}}', 'The layer’s coverage α (how solid it is) is multiplied by the mask m, after m is cut off to between 0 and 1. The strength s fades the effect in: at 0 nothing changes, and at 1 the mask applies fully. The colors stay the same, so the mask only hides things where this layer is later put over another with Front over back.')],
        outputSymbols: ['\\alpha'],
        concepts: ['alpha', 'mix'],
        curve: { title: 'How much coverage is kept for each mask value', x: 'mask m', y: 'coverage × …', domain: () => [-0.2, 1.2], series: [{ f: (m, P) => 1 + (Math.max(0, Math.min(1, m)) - 1) * P.strength }], range: () => [0, 1.05] },
        description: 'Makes parts of a layer see-through, using a number pattern. Where the mask is 1 the layer stays as it is, and where it is 0 the layer becomes see-through. The colors themselves do not change: the mask only matters when this layer is put over another with Front over back, because Add light ignores see-through parts.',
        emit: (i, u) => `vec4(${i.layer}.rgb,${i.layer}.a*mix(1.0,clamp(${i.mask},0.0,1.0),${u.strength}))`
    }),
    add: component({
        name: 'Add light', category: 'Color & composition', output: 'layer', inputs: { a: 'layer', b: 'layer' }, inputSymbols: { a: 'A', b: 'B' }, role: 'combine', bypass: 'a',
        params: { gain: num('B gain', 1, 0, 5, 0.01, 'g', 'How bright layer B is before it is added to A. Zero removes B, and 2 doubles it.') },
        equation: 'RGB = A.rgb + gain · B.rgb',
        steps: [step('\\mathrm{RGB} = A_{\\mathrm{rgb}} + g\\, B_{\\mathrm{rgb}}, \\quad \\alpha = \\max(A_{\\alpha}, B_{\\alpha})', 'Light adds up: the result is the light of A plus g times the light of B. Coverage hides nothing here, and the new coverage α is simply the larger of the two. For solid objects that should block what is behind them, use Front over back.')],
        outputSymbols: ['\\mathrm{RGB}'],
        concepts: ['additive-light'],
        description: 'Adds the light of two layers together. Like two flashlights shining on the same wall, the colors add up and the result gets brighter, and nothing is hidden. Use it for things that give off light, such as glows, stars and gas; to put a solid object in front of something, use Front over back instead.',
        emit: (i, u) => `addLight(${i.a},${i.b},${u.gain})`
    }),
    over: component({
        name: 'Front over back', category: 'Color & composition', output: 'layer', inputs: { front: 'layer', back: 'layer' }, inputSymbols: { front: 'F', back: 'B' }, role: 'combine', bypass: 'back',
        equation: 'alpha = af + ab(1−af); RGB = (af Cf + (1−af)ab Cb)/alpha',
        steps: [
            step('\\alpha = \\alpha_F + \\alpha_B(1 - \\alpha_F)', 'The front layer covers a fraction α_F of the pixel: 0.7, for example, means it covers 70%. The back layer can only fill part of what is left over, 1 − α_F, and together they make the total coverage α.'),
            step('C = \\frac{\\alpha_F C_F + (1 - \\alpha_F)\\,\\alpha_B C_B}{\\alpha}', 'The color is a blend of the front and back colors, each weighted by how much of the pixel it covers. Dividing by the total coverage α keeps C a plain color that is not already dimmed by its coverage.')
        ],
        outputSymbols: ['C', '\\alpha'],
        notes: [['C_F, \\alpha_F', 'the color of the front layer, and how much of the pixel it covers'], ['C_B, \\alpha_B', 'the color of the back layer, and how much of the pixel it covers']],
        concepts: ['over', 'alpha'],
        description: 'Puts one picture on top of another. Where the front layer is solid it hides the back layer, where it is see-through the back shows through, and partly see-through edges blend the two. Use it to hide background stars behind a planet, or to lay feathers and silhouettes over a background.',
        emit: i => `overLayer(${i.front},${i.back})`
    }),
    nebulaGeometry: component({
        name: 'Pinched shell family · S,A', category: 'Source nebula', output: 'geometry', inputs: { p: 'coord' },
        params: {
            pinch: num('Neck pinch', 0.3, 0.05, 0.8, 0.005, '\\eta', 'How hard the shells are squeezed toward the up-and-down line through the center, which makes the narrow waist between the two lobes. The original uses 0.3; slide right to pinch harder.'),
            shear: num('Shell shear', 0.15, -0.5, 0.6, 0.005, '\\sigma', 'A tilt shared by all the shells. The original uses 0.15; changing it leans and skews the lobes.'),
            shells: num('Shell count', 27, 1, 27, 1, 'N', 'How many of the 27 original shells are used, starting from the smallest. Slide left for fewer, simpler outlines.')
        },
        equation: 'Lₛ = sqrt(Uₛ² + (2Rₛ^0.3 |Uₛ|^−0.3 Vₛ)²) − Rₛ',
        steps: [
            step('U_s = x + (\\sigma + c_s)\\, y, \\quad V_s = y - (\\sigma + d_s)\\, x', 'For each shell s, from 1 up to N, the plane is sheared: slid sideways by an amount that grows with height, and up or down by an amount that grows with x. The shear σ is the same for every shell, while c_s and d_s are fixed for each shell, so every shell leans its own way.'),
            step('L_s = \\sqrt{U_s^2 + \\left(\\frac{2 R_s^{\\eta}\\, V_s}{|U_s|^{\\eta}}\\right)^2} - R_s, \\quad s = 1 \\ldots N', 'L_s tells which side of shell s the point is on: negative inside, zero on the shell, and positive outside, while R_s is the size of the shell. Dividing V_s by |U_s|^η makes the value huge near the line U_s = 0, so the shell is squeezed into a narrow waist there, like an hourglass. The pinch η sets how hard it is squeezed.'),
            step('w_s = J_s \\prod_{u<s}(1 - J_u), \\quad J_s = e^{-e^{25 - 50 s}}\\, e^{-e^{10 L_s}}', 'J_s is a soft on/off switch: about 1 inside shell s and about 0 outside it (its first factor is practically 1 for every shell). The product of (1 − J_u) over all the earlier shells is 1 only if none of them contains the point. So w_s gives each point to the first shell that contains it, like looking down through a stack of tracing paper and seeing the top sheet.'),
            step('S = \\sum_s 2 w_s L_s, \\quad A = \\sum_s \\frac{w_s}{4}\\, e^{-e^{0.15(s - 23)}}\\, e^{-e^{-3 L_s}}', 'These are the results. S is twice the L of the chosen shell, so it follows the shell outlines, and later parts use it to lay the gas threads along them. A is brightest just inside each shell’s rim, where the gas glows, and the largest shells glow more faintly. The coverage, the sum of all the w_s, is a third result that shows where any shell is.')
        ],
        outputSymbols: ['S', 'A'],
        notes: [['R_s, c_s, d_s', 'the fixed size and lean of shell s, from the original formula'], ['L_s', 'which side of shell s the point is on: negative inside, positive outside'], ['J_s', 'a soft switch: about 1 inside shell s and about 0 outside'], ['w_s', 'how much of the point belongs to shell s (the first shell that contains it wins)']],
        concepts: ['shear', 'implicit-curve', 'gate', 'first-hit'],
        curve: { title: 'The on/off switch of one shell, and its glowing rim', x: 'shell residual L', y: 'J', domain: () => [-0.6, 0.6], series: [{ label: 'J = e^−e^(10L)', f: L => gate(10 * L) }, { label: 'rim e^−e^(−3L)', f: L => gate(-3 * L) }], range: () => [0, 1.05], marks: () => [{ x: 0, label: 'shell' }] },
        description: 'Builds the nebula’s shape from 27 nested shells, pinched like hourglasses. The shells are closed outlines, each a little bigger than the last like the layers of an onion, and each is squeezed in the middle, which gives the nebula its two lobes. For every point, the part finds the first shell that contains it and reports where the point lies relative to that shell (S), how brightly the shell’s rim glows there (A), and how much of the point any shell covers. With the settings it starts with, this is the original nebula formula, split into steps.',
        emit: (i, u) => `nebulaGeometry(${i.p},${u.pinch},${u.shear},${u.shells})`
    }),
    ringGeometry: component({
        name: 'Replacement ring geometry', category: 'Source nebula', output: 'geometry', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1.1, 0.1, 2, 0.01, 'r', 'How big the ring is. Slide right for a bigger ring.'),
            width: num('Rim width', 0.16, 0.01, 0.7, 0.01, 'w', 'How thick the glowing rim is. Slide right for a wider rim.'),
            flatten: num('Vertical compression', 1.5, 0.2, 3, 0.01, 'k', 'Squashes the ring up and down: 1 is a circle, and larger values make a flatter oval.')
        },
        equation: 'S=2d; A=0.22 exp(−(d/width)²); d=|scaled p|−radius',
        steps: [
            step('d = \\sqrt{x^2 + (k y)^2} - r', 'This measures roughly how far the point is from an oval: a circle of radius r squashed up and down by k. It is negative inside the oval and positive outside.'),
            step('S = 2 d, \\quad A = 0.22\\, e^{-(d/w)^2}, \\quad \\text{coverage} = e^{-(d/w)^2}', 'These are the same three results the pinched shells give, so this ring can take their place. S follows the ring, A glows on the ring with a width of about w, and the coverage is 1 on the ring and fades to 0 away from it.')
        ],
        outputSymbols: ['S', 'A'],
        concepts: ['sdf', 'gaussian'],
        description: 'A simple ring shape that can replace the nebula’s shells. It gives the same three results as Pinched shell family (S, A and coverage), so you can swap it in and all the other nebula parts keep working unchanged. The Filament ring scene does exactly that: the same gas threads, glow and stars, wrapped around an oval ring.',
        emit: (i, u) => `ringGeometry(${i.p},${u.radius},${u.width},${u.flatten})`
    }),
    geometryField: component({
        name: 'Inspect geometry channel', category: 'Source nebula', output: 'scalar', inputs: { geometry: 'geometry' },
        params: {
            channel: num('0=warp · 1=rim · 2=coverage', 1, 0, 2, 1, 'c', 'Which result to pass on: 0 is S, the position that follows the shells, 1 is the glowing rim A, and 2 is the coverage.'),
            gain: num('Display gain', 4, 0.1, 10, 0.1, 'g', 'Multiplies the chosen result. Slide right to make faint values easier to see.')
        },
        equation: 'f = geometry.warp / rim / coverage',
        steps: [step('f = g \\cdot G_c, \\quad G_0 = S,\\ G_1 = A,\\ G_2 = \\text{coverage}', 'Pick one of the shape’s three results, S, A or the coverage, and multiply it by g. What comes out is a plain number at every point, which masks, thresholds and colors can use.')],
        outputSymbols: ['f'],
        description: 'Turns one result of a shell shape into an ordinary number pattern. A shape part such as Pinched shell family gives three results at once: S, which follows the shells, A, the glowing rim, and the coverage. This part lets you look at one of them on its own, or use it as a mask, a threshold input or a color. The rim and the coverage mean different things, so pick the one you need.',
        emit: (i, u) => `((${u.channel}<0.5)?${i.geometry}.warp:((${u.channel}<1.5)?${i.geometry}.rim:${i.geometry}.coverage))*${u.gain}`
    }),
    nebulaTurbulence: component({
        name: 'Nested-cosine turbulence · E', category: 'Source nebula', output: 'scalar', inputs: { p: 'coord', geometry: 'geometry' }, inputSymbols: { geometry: 'S' },
        params: {
            bands: num('Bands', 50, 1, 50, 1, 'N', 'How many of the 50 original wave layers are added, starting with the biggest. Slide left for smoother, blobbier turbulence.'),
            speed: num('Phase speed', 0, -1, 1, 0.01, '\\omega', 'An extra you can add: it makes the waves shift over time. The original is still, which is 0.')
        },
        equation: 'E = Σ (19/20)ˢ Dₛ(S,Qₛ)',
        steps: [
            step('Q_s = p \\cdot (\\cos 15 s^2,\\ \\sin 15 s^2)', 'For layer s, Q_s measures how far the point is along a fixed direction that belongs to that layer. Every layer uses a different direction, so the waves run every which way.'),
            step('a_s, b_s, c_s, d_s = 1.25^{s} \\times \\text{fixed rotations of } (S, Q_s)', 'Four fixed mixtures of S and Q_s are made, then multiplied by 1.25^s, so each layer’s waves are 25% tighter than the last. Because S follows the shells, the waves follow the shells too.'),
            step('E = \\sum_{s=1}^{N} 0.95^{s} \\cos\\left(a_s + 4\\cos b_s + \\phi_s + \\omega t\\right)\\cos\\left(c_s + 4\\cos d_s + \\psi_s - \\omega t\\right)', 'Now N layers of nested cosines are added up; a cosine inside a cosine bends the waves into curls. Each layer is finer and 5% weaker than the last, and the sum E is a rough, swirly pattern that can be positive or negative. Later parts use it to roughen the gas threads and the edge of the central glow.')
        ],
        outputSymbols: ['E'],
        notes: [['S', 'the position that follows the shells, from the shape part'], ['Q_s', 'the point’s position along the direction of layer s'], ['\\phi_s, \\psi_s', 'fixed shifts of the waves, from the original formula']],
        concepts: ['sum-of-bands', 'phase-modulation'],
        curve: { title: 'How strong each wave layer is', x: 'band s', y: 'weight 0.95ˢ', domain: P => [0.5, P.bands + 0.5], bars: P => Array.from({ length: Math.round(P.bands) }, (_, k) => [k + 1, 0.95 ** (k + 1)]) },
        description: 'Makes a rough, swirling pattern that roughens the nebula’s gas. It adds up 50 layers of curly waves, each finer and a little weaker than the one before, and because the waves are laid along the shells, the roughness follows the nebula’s shape. The result E is a number that can be positive or negative, and it ruffles the edges of the gas threads and of the central glow. This is the original formula, which does not move; the phase speed is an extra you can add.',
        emit: (i, u) => `nebulaTurbulence(${i.p},${i.geometry},${u.bands},u_time*${u.speed})`
    }),
    nebulaCloud: component({
        name: 'Filaments & haze · K', category: 'Source nebula', output: 'layer', inputs: { p: 'coord', geometry: 'geometry', turbulence: 'scalar' }, inputSymbols: { geometry: 'S, A', turbulence: 'E' },
        params: {
            bands: num('Bands', 50, 1, 50, 1, 'N', 'How many of the 50 original layers are added, from coarse to fine. Slide left to remove the finest threads.'),
            detail: num('Sharp filament gain', 1, 0, 3, 0.01, '\\delta', 'How strong the sharp threads are (1 here means the original weight of 45). Zero leaves only the soft haze.')
        },
        equation: 'Iₛ=45 C₁,ₛ+6 C₀,ₛ; Kᵥ=Σ Iₛ (19/20)ˢ κᵥ,ₛ',
        steps: [
            step('Z_s = C_s - 1.25 + 2A + \\frac{E}{7}', 'For layer s, C_s is a wave pattern laid along the shells, because it is built from S. It is lifted where the rim A is bright, lowered overall by 1.25, and roughened by the turbulence E.'),
            step('I_s = 45\\,\\delta\\, e^{-e^{-4 Z_s}} + 6\\, e^{-e^{-Z_s/4}}', 'Two soft switches turn Z_s into light. The steep one, with weight 45δ, lights up only the tops of the pattern, which become thin bright threads. The gentle one, with weight 6, adds a soft haze.'),
            step('K = \\sum_{s=1}^{N} 0.95^{s}\\, I_s\\, \\kappa_s', 'Each layer gets its own color κ_s, and N layers are added from coarse to fine, each 5% weaker than the last. K is still very bright everywhere at this point; the gas part multiplies it by the rim A to keep only the shells.')
        ],
        outputSymbols: ['K'],
        notes: [['C_s', 'the wave pattern of layer s: two cosines multiplied, built from S and a turned position, getting finer with each layer (0.2·1.15^s)'], ['\\kappa_s', 'the fixed color of layer s (some of its numbers are negative, which takes away a little of that color)']],
        concepts: ['gate', 'sum-of-bands', 'radiance'],
        curve: { title: 'The switches for the threads and the haze', x: 'Z', y: 'I', domain: () => [-3, 3], series: [{ label: 'filaments', f: (z, P) => 45 * P.detail * gate(-4 * z) }, { label: 'haze', f: z => 6 * gate(-z / 4) }] },
        description: 'Paints the nebula’s glowing threads and soft haze in color. It adds up 50 layers of wave patterns laid along the shells and keeps mostly their peaks, which become thin bright threads (filaments), plus a softer haze; each layer has its own color. On its own it looks far too bright and fills the whole picture, because the next part, Gas emission, keeps it only along the shell rims and removes it at the center. This is the original formula, split into steps.',
        emit: (i, u) => `nebulaCloud(${i.p},${i.geometry},${i.turbulence},${u.bands},${u.detail})`
    }),
    nebulaGas: component({
        name: 'Gas emission · Hgas', category: 'Source nebula', output: 'layer', inputs: { p: 'coord', geometry: 'geometry', turbulence: 'scalar', cloud: 'layer' }, inputSymbols: { geometry: 'A', turbulence: 'E', cloud: 'K' },
        params: { gain: num('Gas gain', 1, 0, 3, 0.01, 'g', 'How bright the glowing gas is. Slide right to brighten it; 0 hides it.') },
        equation: 'Hgas = 1.1 (1−W) K A',
        steps: [
            step('W = e^{-e^{10|p| - 1 + E/4}}', 'W marks the central glow. Without turbulence it is about 0.7 right at the center, 0.37 at a distance of 0.1, and almost 0 beyond 0.25. The turbulence E makes its edge ragged.'),
            step('H_{\\text{gas}} = 1.1\\, g\\, (1 - W)\\, K A', 'The gas light is the colored threads K, kept only along the shell rims (times A) and removed near the center (times 1 − W), where the core glow takes over. The gain g sets the overall brightness.')
        ],
        outputSymbols: ['H_{\\text{gas}}'],
        notes: [['W', 'the central glow mask: largest at the center, 0 farther out']],
        concepts: ['gate', 'masking'],
        description: 'Lights up the nebula’s gas along the shell rims. It takes the colored threads and haze from Filaments & haze and multiplies them by the rim glow A, so only the edges of the shells shine. It also clears a small area at the center, where Central glow takes over. This is the original gas formula.',
        emit: (i, u) => `nebulaGas(${i.p},${i.geometry},${i.turbulence},${i.cloud},${u.gain})`
    }),
    nebulaCore: component({
        name: 'Central glow · W', category: 'Source nebula', output: 'layer', inputs: { p: 'coord', turbulence: 'scalar' }, inputSymbols: { turbulence: 'E' },
        params: { gain: num('Core gain', 1, 0, 3, 0.01, 'g', 'How bright the central glow is. Slide right to brighten it; 0 turns it off.') },
        equation: 'W=exp(−exp(10|p|−1+E/4)); Hcore=W(2,2,3)',
        steps: [
            step('W = e^{-e^{10|p| - 1 + E/4}}', 'This is the same central mask as in Gas emission. It is largest at the center (about 0.7) and fades to almost 0 by a distance of about 0.25, with a ragged edge from the turbulence E.'),
            step('H_{\\text{core}} = g\\, W\\, (2, 2, 3)', 'Where W is on, the part gives off bluish-white light, with more blue (3) than red and green (2). These numbers are bigger than 1, so the very center comes out pure white on the screen.')
        ],
        outputSymbols: ['H_{\\text{core}}'],
        notes: [['W', 'the central glow mask']],
        concepts: ['gate'],
        curve: { title: 'The glow mask by distance from the center (with E = 0)', x: 'distance |p|', y: 'W', domain: () => [0, 0.5], series: [{ f: r => gate(10 * r - 1) }], range: () => [0, 1.05] },
        description: 'Makes the bright bluish-white glow at the nebula’s center. It is a soft spot of light about 0.2 units across, with an edge roughened by the turbulence E, and its middle is so bright that it turns white on the screen. This is the original formula; in it, |p| is just the distance from the center, and the −1 and E/4 are added after that distance is found.',
        emit: (i, u) => `nebulaCore(${i.p},${i.turbulence},${u.gain})`
    }),
    nebulaStars: component({
        name: 'Folded star lattices · T', category: 'Source nebula', output: 'layer', inputs: { p: 'coord' },
        params: {
            bands: num('Lattices', 30, 1, 30, 1, 'L', 'How many of the 30 original star grids are added. Slide left for fewer, sparser stars.'),
            gain: num('Starlight', 1, 0, 3, 0.01, 'g', 'How bright all the stars are. Slide right to brighten them; 0 hides them.')
        },
        equation: 'M,N=acos(cos(rotated coordinates)); T=Σ colored(center+halo)',
        steps: [
            step('M_s, N_s = \\arccos\\cos(\\text{rotated, scaled } p)', 'For grid s, the plane is turned and scaled, and then each coordinate is folded with arccos(cos ·). This makes a zigzag (a triangle wave) that climbs from 0 to π and back down again, over and over. The plane becomes a grid of identical mirrored cells, and the folded point (M, N) = (0, 0) appears again and again, like the same tile repeated across a floor.'),
            step('\\rho_s^2 = M_s^2 + N_s^2', 'Adding the squares of M_s and N_s gives the squared distance to the nearest grid point. It is small only right next to a grid point, which is where a star will be.'),
            step('T = g \\sum_{s=1}^{L} \\left(4\\, e^{-e^{200(\\rho_s^2 - 0.00125 - B_s/200)}} + e^{-e^{20 \\rho_s^2 - 0.14}}\\right) \\chi_s', 'Each grid puts a star on every grid point: a sharp core, whose size wobbles with the angle (B_s) to make the pointed tips, plus a soft halo. Each grid has a warm or cool color χ_s, and the grids get denser as s grows, so the stars come in many sizes and spacings.')
        ],
        outputSymbols: ['T'],
        notes: [['\\rho_s', 'the distance to the nearest grid point'], ['B_s', 'a wobble with the angle that gives the stars their pointed tips'], ['\\chi_s', 'the star color, switching between warm and cool from one grid to the next']],
        concepts: ['fold', 'gate', 'additive-light'],
        curve: { title: 'The brightness of one star, from its center outward (without B)', x: 'distance ρ to the lattice point', y: 'brightness', domain: () => [0, 0.35], series: [{ label: 'core', f: r => 4 * gate(200 * (r * r - 0.00125)) }, { label: 'halo', f: r => gate(20 * r * r - 0.14) }] },
        description: 'Scatters pointed stars over the picture using 30 folded grids. Each grid puts a star, with a sharp pointed core and a soft halo, on regularly spaced points, and the 30 grids are turned and sized differently, so together the stars look scattered rather than lined up. There is no randomness at all: the same formula always gives the same stars. This is the original star formula from the nebula.',
        emit: (i, u) => `nebulaStars(${i.p},${u.bands},${u.gain})`
    }),
    scatterStars: component({
        name: 'Seeded star field', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            density: num('Density scale', 22, 3, 60, 1, '\\rho', 'How many grid cells, and so how many stars, fit in one unit. Slide right for more stars packed closer together.'),
            gain: num('Starlight', 0.7, 0, 3, 0.01, 'g', 'How bright all the stars are. Slide right to brighten them; 0 hides them.'),
            seed: num('Seed', 17, 0, 100, 1, '\\sigma', 'Picks a different random arrangement of stars.'),
            speed: num('Twinkle speed', 0.1, 0, 2, 0.01, '\\omega', 'How fast the stars twinkle, each one gently dimming and brightening by about 12%. Zero stops the twinkling.')
        },
        equation: 'star = Gaussian core + halo + cross rays',
        steps: [
            step('q_\\ell = \\rho\\,(1 + 0.71\\,\\ell)\\, p, \\quad \\ell = 0, 1, 2, \\quad \\text{cells hashed with seed } \\sigma', 'Three grids of cells are laid over the plane, each finer than the last. For every cell, a hash (a formula that scrambles the cell’s number into a random-looking but repeatable value) decides whether it holds a star. The same hash, mixed with the seed σ, also gives the star its position, size, brightness and color.'),
            step('I = g \\sum_{\\ell} \\sum_{\\text{cells}} \\left(e^{-(d/r)^2} + 0.018\\, e^{-(d/6r)^2}\\right) b\\, \\left(0.88 + 0.12 \\sin(\\omega t + 2\\pi h)\\right)', 'Each star is a bright bell-shaped core plus a faint glow six times wider, and it twinkles by about 12% as the sine rises and falls. The biggest stars also get faint cross-shaped rays. Each pixel only checks its own cell and the 8 cells around it, which is why thousands of stars cost very little.')
        ],
        outputSymbols: ['I'],
        notes: [['d', 'the distance to the star in this cell (its position comes from the hash and the seed σ)'], ['r, b, h', 'the star’s size, brightness and twinkle timing, all from the hash']],
        concepts: ['hash', 'gaussian', 'additive-light'],
        description: 'Scatters random-looking stars of many sizes and colors. The picture is split into invisible grid cells, and a scrambling formula (a hash) decides for each cell whether it holds a star, where exactly, and how big, bright, and warm or cool it is. Three grids of different sizes are laid on top of each other, and the stars twinkle gently. It is a newer, simpler method than the nebula’s folded grids, and the seed picks a different sky.',
        emit: (i, u) => `scatterStars(${i.p},${u.density},${u.gain},${u.seed},u_time*${u.speed})`
    }),
    planet: component({
        name: 'Cyclonic water planet', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1.08, 0.1, 2, 0.01, 'R', 'How big the planet is. Slide right for a bigger planet.'),
            cloud: num('Cloud cover', 0.65, 0, 2, 0.01, 'c', 'How much of the planet is covered by white cloud. Slide left to see mostly ocean; slide right for thick cloud.'),
            twist: num('Cyclone twist', 5, 0, 14, 0.1, '\\tau', 'How strongly the seven storms swirl the clouds. Zero turns the storms off.'),
            light: num('Light angle', 2.25, 0, 6.28, 0.01, '\\lambda', 'Which way the sunlight comes from, as an angle in radians. At 0 it lights the planet from the right, at 1.57 from straight in front, and at 3.14 from the left.'),
            speed: num('Cloud drift', 0.5, -2, 2, 0.01, '\\omega', 'How fast the clouds drift sideways around the planet. Zero stops them; negative values reverse the drift.')
        },
        equation: 'visible sphere → spherical coordinates → cyclone maps → clouds → lighting',
        steps: [
            step('d = p / R, \\quad \\mathbf{n} = \\left(d_x,\\ d_y,\\ \\sqrt{1 - |d|^2}\\right)', 'Inside the disc |d| < 1, the picture is treated as the front half of a ball of radius R. The third number, the square root, says how far the surface bulges toward you. So n is both the point on the surface and the direction the surface faces there (its normal).'),
            step('u = \\operatorname{cyclones}_{\\tau}(\\text{lon}, \\text{lat}) + (0.025\\, \\omega t,\\ 0), \\quad m = \\operatorname{smoothstep}(0.62 - 0.3 c,\\ 0.79 - 0.28 c,\\ n(u))', 'The surface point is turned into longitude and latitude, like on a globe, then swirled by seven small whirlpools of strength τ and slid sideways over time. A noise pattern n read at those swirled positions becomes clouds m wherever it rises above a level set by the cloud cover c.'),
            step('C = \\operatorname{mix}(C_{\\text{ocean}},\\ C_{\\text{cloud}},\\ m)\\,\\left(0.06 + \\max(\\mathbf{n} \\cdot \\mathbf{l},\\ 0)\\right), \\quad \\mathbf{l} \\propto (\\cos\\lambda,\\ 0.35,\\ \\sin\\lambda)', 'Ocean and cloud colors are mixed by m, then lit by how directly the surface faces the sun l, plus a little light everywhere (0.06) so the night side is not pure black. The code also adds a sun glint on the ocean and a thin blue edge on the sunlit side.')
        ],
        outputSymbols: ['C'],
        notes: [['\\mathbf{n}', 'the direction the surface faces at this point (used for lighting)'], ['n(u)', 'the cloud noise, read at the storm-swirled surface position'], ['m', 'how much cloud there is at this point']],
        concepts: ['sphere-normal', 'domain-warp', 'fbm', 'lambert'],
        description: 'Paints a blue ocean planet with swirling storm clouds. The disc is treated as the front half of a ball, so every point knows which way its surface faces and can be lit by a distant sun. Seven storms swirl the clouds, which drift slowly around the planet, and the ocean shows a bright sun glint and a blue edge. This is our own study of the subject, not the artist’s formula, which we could not find.',
        emit: (i, u) => `waterPlanet(${i.p},${u.radius},${u.cloud},${u.twist},${u.light},u_time*${u.speed})`
    }),
    atmosphere: component({
        name: 'Atmospheric rim', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1.08, 0.1, 2, 0.01, 'R', 'How big the glowing ring is. Set it to the planet’s radius so the glow sits right on its edge.'),
            gain: num('Glow', 0.7, 0, 3, 0.01, 'g', 'How bright the glow is. Slide right to brighten it; 0 hides it.')
        },
        equation: 'glow = Gaussian(|p|−radius)',
        steps: [
            step('\\Delta = |p| - R', 'Measure how far the point is from the planet’s edge: negative inside the planet, positive outside.'),
            step('I = g\\left(e^{-(\\Delta/0.025)^2} + 0.18\\, e^{-(\\Delta/0.07)^2}\\right)(0.08, 0.25, 0.55)', 'The glow is a thin, bright bell-shaped ring (width 0.025) plus a wider, fainter one (width 0.07, at 18% of the strength). Both are colored blue, so together they look like the air around a planet seen edge-on.')
        ],
        outputSymbols: ['I'],
        concepts: ['gaussian', 'additive-light'],
        curve: { title: 'Brightness across the planet’s edge', x: 'distance |p|', y: 'brightness', domain: P => [P.radius - 0.25, P.radius + 0.25], series: [{ f: (x, P) => P.gain * (Math.exp(-(((x - P.radius) / 0.025) ** 2)) + 0.18 * Math.exp(-(((x - P.radius) / 0.07) ** 2))) }], marks: P => [{ x: P.radius, label: 'R' }] },
        source: [
            'd = length(p) - $radius   // How far the point is from the planet’s edge.',
            'glow = exp(-(d/0.025)^2) + 0.18*exp(-(d/0.07)^2)   // A thin bright ring plus a wider, fainter one.',
            'vec4(vec3(0.08, 0.25, 0.55)*glow*$gain, clamp(glow, 0, 1))   // Blue light, and the layer is only as solid as the glow is bright.'
        ],
        description: 'Adds a thin blue glow around the edge of a planet. It is a bright, thin ring of light plus a wider, fainter one, like the air of a planet seen edge-on against space. It is separate from the planet, so set its radius to match the planet’s when you use them together, as in the Stormy water planet scene.',
        emit: (i, u) => `atmosphere(${i.p},${u.radius},${u.gain})`
    }),
    lens: component({
        name: 'Star-cluster lens map', category: 'Astronomical studies', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            strength: num('Deflection strength', 1, 0, 3, 0.01, 'k', 'How strongly the stars bend the light. At 0 nothing is bent; slide right to bend the background into bigger arcs.'),
            count: num('Lenses', 7, 1, 12, 1, 'n', 'How many cluster stars bend the light; the first is the heavy one in the middle.'),
            softening: num('Softening', 0.015, 0.001, 0.2, 0.001, '\\epsilon', 'Keeps the bending from blowing up right on top of each star. Slide right for softer, gentler bending close to the stars.')
        },
        equation: 'β = θ − Σ mᵢ(θ−θᵢ)/(|θ−θᵢ|²+ε²)',
        steps: [
            step('m_0 = 0.18\\, k,\\ m_{i>0} = 0.024\\, k', 'These are the masses of the stars: one heavy star in the middle and n − 1 lighter ones around it, all scaled by the strength k.'),
            step('q = p - \\sum_{i=0}^{n-1} m_i\\, \\frac{p - c_i}{|p - c_i|^2 + \\epsilon^2}', 'Each pixel looks a little toward every star, by an amount that grows with the star’s mass m_i and shrinks with distance. So a background drawn with q appears pushed away from the stars and stretched into arcs around them, as in real gravitational lensing. The softening ε keeps the amount from becoming infinite right on top of a star.')
        ],
        outputSymbols: ['q'],
        notes: [['c_i', 'the fixed star positions, laid out like the seeds of a sunflower using the golden angle (the same as in Foreground cluster stars)']],
        concepts: ['lensing', 'backward-map'],
        curve: { title: 'How far the heavy middle star shifts the view, by distance', x: 'distance |p − c₀|', y: 'shift', domain: () => [0, 1], series: [{ f: (d, P) => 0.18 * P.strength * d / (d * d + P.softening * P.softening) }], marks: P => [{ x: P.softening, label: 'ε' }] },
        description: 'Bends the picture behind it, the way gravity bends light. Heavy stars bend passing light, so a galaxy far behind a star cluster looks stretched into arcs. This part does that to whatever is drawn through it: it changes where each pixel looks, so the background seems pushed away from the stars and smeared around them. Draw the cluster’s own stars without the lens, with Foreground cluster stars, as in the Galaxy behind a star cluster scene.',
        emit: (i, u) => `clusterLens(${i.p},${u.strength},${u.count},${u.softening})`
    }),
    clusterLights: component({
        name: 'Foreground cluster stars', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            gain: num('Brightness', 1, 0, 3, 0.01, 'g', 'How bright the cluster stars are. Slide right to brighten them; 0 hides them.'),
            count: num('Stars', 7, 1, 12, 1, 'n', 'How many cluster stars are drawn. Keep it the same as the lens count, so every star that bends light is shown.')
        },
        equation: 'centers share the lens map’s deterministic positions',
        steps: [step('I = g \\sum_{i=0}^{n-1} \\left(1.8\\, e^{-(|p - c_i|/0.014)^2} + 0.14\\, e^{-(|p - c_i|/0.055)^2} + \\text{rays}\\right) \\chi_i', 'Each star i gets a tiny, bright core (width 0.014), a softer glow around it (width 0.055) and thin cross-shaped rays, all in its own color χ_i. The stars sit at the lens positions c_i, so the drawn cluster lines up exactly with where the lens bends light.')],
        outputSymbols: ['I'],
        notes: [['c_i', 'the star positions, the same as in Star-cluster lens map'], ['\\chi_i', 'the color of star i, somewhere between bluish white and warm yellow']],
        concepts: ['gaussian', 'additive-light'],
        description: 'Draws the bright stars of the cluster that bends the light. Each star has a bright core, a soft glow and thin cross-shaped rays, and it sits exactly where Star-cluster lens map puts its masses. Draw this part without the lens, on top of the bent background, because these stars are in front of the galaxy and are not bent themselves.',
        emit: (i, u) => `clusterLights(${i.p},${u.gain},${u.count})`
    }),
    galaxy: component({
        name: 'Logarithmic spiral galaxy', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            arms: num('Spiral arms', 3, 1, 8, 1, 'm', 'How many spiral arms the galaxy has.'),
            pitch: num('Winding', 7, 0.5, 15, 0.1, 'k', 'How tightly the arms wind. Slide right to wrap them around the center more times.'),
            radius: num('Scale', 0.75, 0.1, 2, 0.01, 's', 'How big the galaxy is. Slide right for a bigger galaxy.'),
            dust: num('Dust lanes', 0.6, 0, 1, 0.01, '\\delta', 'How dark the dust lanes across the disk are. Zero removes them.'),
            speed: num('Phase speed', 0.2, -2, 2, 0.01, '\\omega', 'How fast the arm pattern turns over time. Zero holds it still; negative values turn it the other way.')
        },
        equation: 'phase = arms·theta − pitch·log(r+0.1)',
        steps: [
            step('\\phi = m\\, \\theta - k \\log(r/s + 0.1) - 0.1\\, \\omega t, \\quad \\text{arm} = \\left(\\frac{1}{2} + \\frac{1}{2}\\cos(\\phi + \\text{noise})\\right)^8', 'Around the center of the tilted disk, the phase φ climbs m times per turn of the angle θ, and it changes with log r, the logarithm of the distance, which grows fast near the center and slowly far out. So the lines of equal phase are m spiral arms. The cosine is brightest along them, the 8th power makes the arms narrow, and a little noise makes them ragged.'),
            step('I = C(r)\\,(0.17 + \\text{arm})\\, e^{-1.65\\, r/s}\\,(1 - \\delta\\, \\text{lanes}) + \\text{bulge} + \\text{knots}', 'The arms sit on a faint disk (the 0.17), and everything fades with distance from the center. Noisy dust lanes darken it by up to δ, and a glowing central bulge and bright knots in the arms are added on top. The color C(r) changes from reddish near the center to blue farther out.')
        ],
        outputSymbols: ['I'],
        notes: [['r, \\theta', 'the distance and angle of the point, measured in the tilted, flattened disk']],
        concepts: ['log-spiral', 'polar', 'fbm'],
        description: 'Draws a spiral galaxy seen at a tilt. Bright arms wind out from a glowing golden center, dark dust lanes cross the disk, and small violet knots dot the arms. The arms are logarithmic spirals, the shape of a nautilus shell, and the pattern slowly turns. Send its coordinates through Star-cluster lens map and the galaxy bends into arcs.',
        emit: (i, u) => `spiralGalaxy(${i.p},${u.arms},${u.pitch},${u.radius},${u.dust},u_time*${u.speed})`
    }),
    aurora: component({
        name: 'Spiral auroral curtain', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            turns: num('Winding', 4, 0.5, 12, 0.1, 'k', 'How tightly the ribbons wind around the center. Slide right for more turns.'),
            width: num('Ribbon width', 0.115, 0.01, 0.4, 0.005, 'w', 'How thick the bright ribbons are. Slide right for wider ribbons; slide left for thin ones.'),
            curtain: num('Fine rays', 1, 0, 3, 0.01, 'c', 'How strongly the thin rays streak the ribbons. Zero gives smooth ribbons.'),
            speed: num('Flow speed', 0.5, -2, 2, 0.01, '\\omega', 'How fast the spiral and its rays move. Zero holds them still.')
        },
        equation: 'ribbon = exp(−[sin(theta + turns·log(r+0.12))/width]²)',
        steps: [
            step('\\phi = \\theta + k \\log(r + 0.12) + 0.18\\, \\omega t + \\text{noise}, \\quad B = e^{-(\\sin\\phi / w)^2}(1 - e^{-8r})\\, e^{-0.7 r}', 'The phase φ grows with the angle θ and with log r, the logarithm of the distance, so lines of equal phase are spirals. The ribbon B is bright where sin φ is close to 0, which happens along two spiral arms, with a bell-shaped profile of width w. The last two factors dim it right at the center and far away.'),
            step('F = 0.28 + 0.72\\left(\\frac{1}{2} + \\frac{1}{2}\\sin(175\\,\\theta + \\ldots)\\right)^2, \\quad I = (0.05, 0.86, 0.22)\\, B\\,(0.4 + c F) + \\text{fringe}', 'The pattern F makes about 175 thin rays around the center, like the folds of a curtain, and c sets how strongly they streak the green ribbons. A faint purple fringe runs along one edge of each ribbon, next to a wider, dim green glow.')
        ],
        outputSymbols: ['I'],
        notes: [['r, \\theta', 'the distance and angle of the point around the spiral’s center'], ['B', 'how bright the ribbon is at this point'], ['F', 'the pattern of thin rays']],
        concepts: ['log-spiral', 'gaussian'],
        curve: { title: 'Brightness across a ribbon', x: 'phase φ (mod π)', y: 'B', domain: () => [-Math.PI / 2, Math.PI / 2], series: [{ f: (x, P) => Math.exp(-((Math.sin(x) / P.width) ** 2)) }], range: () => [0, 1.05] },
        description: 'Draws glowing green aurora ribbons that spiral out from a center. Two ribbons wind outward, streaked by about 175 thin rays like the folds of a curtain, with a faint purple fringe along one edge. It shows what an aurora can look like, but it does not simulate the real physics. The Spiral aurora scene puts it over a star field.',
        emit: (i, u) => `auroraVortex(${i.p},${u.turns},${u.width},${u.curtain},u_time*${u.speed})`
    }),
    disk: component({
        name: 'Accretion disk & shadow', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            radius: num('Shadow scale', 0.34, 0.06, 0.8, 0.005, '\\rho', 'How big the black shadow in the middle is. The disk and the arc grow and shrink with it.'),
            inclination: num('Projection flattening', 3, 1, 7, 0.05, '\\iota', 'How tilted the disk looks. At 1 you see it face-on; slide right to see it more edge-on.'),
            spin: num('Texture winding', 4, 0, 12, 0.1, '\\tau', 'How much the ring pattern in the disk twists into a spiral. Slide right for a stronger twist.'),
            speed: num('Flow speed', 0.5, -2, 2, 0.01, '\\omega', 'How fast the ring pattern swirls. Zero holds it still.')
        },
        equation: 'projected annulus + bent rear arc − central shadow',
        steps: [
            step('r = \\sqrt{x_r^2 + (\\iota\\, y_r)^2}, \\quad E = e^{-((r - 1.65\\rho)/0.65\\rho)^2}', 'Squashing circles up and down by ι makes a flat disk look tilted, as if you saw it from the side. E is a bell-shaped band of that disk around the distance 1.65ρ, where the gas glows.'),
            step('\\text{rings} = \\frac{1}{2} + \\frac{1}{2}\\sin\\left(90 r + 4\\sin(3\\theta + \\tau\\log(r + 0.1) - 0.8\\, \\omega t)\\right)', 'Fine rings, about 14 per unit of distance, give the disk its texture. The inner sine makes them wobble, τ twists that wobble into a spiral, and ωt makes it swirl over time.'),
            step('I = E\\, \\text{rings}\\, D(\\theta) + \\text{arc}, \\quad I = 0 \\text{ where } |p| < 0.9\\rho', 'The disk is brighter on one side (D). Around real black holes, gas rushing toward us looks brighter; here a simple cosine fakes that effect. A thin bright arc over the top stands in for light bent around the black hole, and inside |p| < 0.9ρ, the shadow, everything is black.')
        ],
        outputSymbols: ['I'],
        notes: [['x_r, y_r', 'p turned by −0.28 radians, which tilts the disk a little'], ['\\theta', 'the angle around the flattened disk'], ['D(\\theta)', 'the brightening on one side']],
        concepts: ['phase-modulation', 'gaussian'],
        description: 'Draws a glowing disk of gas around a black hole’s shadow. The disk is seen at a tilt, is brighter on one side and swirls with fine rings, while a thin bright arc curves over the top and the middle is black. It is an artist’s version: the one-sided brightness and the arc come from simple formulas, not from the real physics of black holes.',
        emit: (i, u) => `accretionDisk(${i.p},${u.radius},${u.inclination},${u.spin},u_time*${u.speed})`
    }),
    tidal: component({
        name: 'Stretched star & tidal stream', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            stretch: num('Taper power', 2.5, 0.3, 6, 0.05, 'a', 'How quickly the stream widens toward the star. Slide right to keep it thin for longer.'),
            size: num('Star width', 0.13, 0.02, 0.4, 0.005, '\\sigma', 'How big the star is, which is also the stream’s widest width. Slide right for a bigger star.'),
            speed: num('Stream speed', 0.5, -2, 2, 0.01, '\\omega', 'How fast the wiggle and the fibers move along the stream. Zero holds them still.')
        },
        equation: 'emission = Gaussian(distance to tapered centerline) + star core',
        steps: [
            step('u = \\operatorname{clamp}\\left(\\frac{x + 0.05}{1.65}, 0, 1\\right), \\quad y_c = 0.14 + 0.4 u^2 + 0.05 \\sin(5u - 0.25\\, \\omega t)', 'The number u measures how far along the stream the point is, from the tail on the left (u = 0) to the star on the right (u = 1). The center line y_c of the stream curves upward toward the star and wiggles slowly over time.'),
            step('w = \\operatorname{mix}(0.015,\\ \\sigma,\\ u^{a}), \\quad I = e^{-((y - y_c)/w)^2}\\, \\text{fibers} + 2.4\\, e^{-(|p - p_\\star|/\\sigma)^2} + \\text{glow}', 'The stream is a bell-shaped band around its center line, and its width w grows from 0.015 at the tail to σ at the star; a larger a keeps it thin for longer. Fine fibers streak the stream, and the star itself is a bright, bell-shaped spot of size σ at the end, with a soft blue glow around it.')
        ],
        outputSymbols: ['I'],
        notes: [['p_\\star', 'where the star sits, at the end of the stream'], ['u', 'how far along the stream the point is'], ['w', 'how wide the stream is at u']],
        concepts: ['gaussian', 'mix'],
        curve: { title: 'How wide the stream is along its length', x: 'position u (tail → star)', y: 'width w', domain: () => [0, 1], series: [{ f: (u, P) => 0.015 + (P.size - 0.015) * u ** P.stretch }] },
        description: 'Draws a star being stretched into a long, thin stream. A narrow, curved stream of gas grows wider as it nears a bright star at its right end, and fine fibers ripple along it. In the Tidal disruption scene, this is the star being torn apart by the black hole. It is separate from the disk, so you can move it, mask it, or reuse it as a comet.',
        emit: (i, u) => `tidalStream(${i.p},${u.stretch},${u.size},u_time*${u.speed})`
    }),
    feather: component({
        name: 'Single eyespot feather', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            width: num('Width', 0.095, 0.02, 0.3, 0.005, 'w_0', 'How wide the feather is: the distance from its middle line to its edge at the widest point. Slide right for a broader feather.'),
            eye: num('Eyespot scale', 1, 0.3, 2, 0.01, 's', 'How big the eye rings near the tip are. Slide right for a bigger eye.'),
            speed: num('Barb motion', 0.2, 0, 2, 0.01, '\\omega', 'How fast the fine barb stripes shimmer. Zero holds them still.')
        },
        equation: 'tapered local silhouette + oblique cosine barbs + nested eyespot rings',
        steps: [
            step('w(v) = w_0 \\sin(\\pi v)^{0.55}, \\quad \\text{coverage} = [\\,|x| < w(v)\\,]', 'The number v runs along the shaft from the base (0) to the tip (1), and w(v) is how far the feather reaches out on each side there. It is widest in the middle and closes at both ends. Inside that outline the coverage is 1, so the feather is solid.'),
            step('\\text{barbs} = 0.25 + 0.75\\left(\\frac{1}{2} + \\frac{1}{2}\\cos(250(v + 1.3|x|) + 0.4 \\sin \\omega t)\\right)^3', 'Narrow stripes slant away from the shaft, like the fine hairs (barbs) of a real feather. They shimmer slightly over time.'),
            step('e = \\sqrt{\\left(\\frac{x}{0.76\\, w_0 s}\\right)^2 + \\left(\\frac{v - 0.79}{0.107\\, s}\\right)^2} \\quad \\text{(eyespot rings at fixed } e\\text{)}', 'The number e is a stretched distance from the center of the eye, which sits near the tip. Bands of color at fixed values of e draw the nested rings of the eye: bronze on the outside, then teal, then blue, and a dark center.')
        ],
        notes: [['p = (x, v)', 'the feather’s own coordinates: the base is at v = 0 and the tip at v = 1'], ['e', 'the stretched distance from the center of the eye']],
        concepts: ['stamp', 'sdf', 'alpha'],
        curve: { title: 'How wide the feather is along its shaft', x: 'v (base → tip)', y: 'w(v)', domain: () => [0, 1], series: [{ f: (v, P) => P.width * Math.sin(Math.PI * v) ** 0.55 }] },
        description: 'Draws one peacock feather with its colorful eye near the tip. The feather lives in its own little frame, with its base at (0, 0) and its tip at (0, 1), so connect Translate · rotate · scale to its input to place it. It is drawn entirely from formulas, with no picture files, and Peacock feather fan draws this same feather up to 74 times.',
        emit: (i, u) => `feather(${i.p},${u.width},${u.eye},u_time*${u.speed})`
    }),
    fan: component({
        name: 'Peacock feather fan', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            spread: num('Fan spread', 2.9, 0.4, 3.5, 0.01, '\\Delta', 'How wide the fan opens, as an angle in radians (3.14 is a half circle). Slide right to open it wider.'),
            rows: num('Feather rows', 4, 1, 4, 1, 'N', 'How many rows of feathers are drawn, starting from the outside (23, 20, 17 and 14 feathers).'),
            width: num('Feather width', 0.095, 0.03, 0.2, 0.005, 'w', 'How wide each feather is. Slide right for broader feathers.'),
            speed: num('Breeze speed', 0.3, 0, 2, 0.01, '\\omega', 'How fast the feathers sway in the breeze. Zero holds them still.')
        },
        equation: 'fan = Overᵢ feather(Rᵢ(p−base)/lengthᵢ)',
        steps: [
            step('a_{ri} = \\left(\\frac{i}{n_r - 1} - \\frac{1}{2}\\right)\\Delta + 0.015\\sin(1.8\\, i + 0.45\\, \\omega t), \\quad \\ell_r = 2.12 - 0.26\\, r', 'Feather i of row r points at the angle a_ri, and the feathers of a row are spread evenly across the opening Δ, with a tiny sway over time. Each row is 0.26 shorter than the one outside it, so the length ℓ_r shrinks row by row.'),
            step('F = \\mathrm{Over}_{r=0}^{N-1}\\ \\mathrm{Over}_{i}\\ \\operatorname{feather}\\left(\\frac{R(a_{ri})\\,(p - b)}{\\ell_r};\\ w\\right)', 'Every feather is the same stamp, drawn in coordinates turned around the shared base b and scaled by the row length. The feathers are stacked with Over, one on top of another, outer rows first, so the inner rows sit in front.')
        ],
        outputSymbols: ['F'],
        notes: [['b', 'the shared base point where all the feathers start'], ['n_r', 'how many feathers are in row r']],
        concepts: ['stamp', 'backward-map', 'over'],
        description: 'Spreads 74 peacock feathers into a fan of four rows. Every feather is the same Single eyespot feather, turned to its own angle around a shared base and scaled to its row’s length. The rows are stacked from the outside in, each a little shorter and darker, and a gentle breeze makes the feathers sway. This is our own construction, not a formula recovered from the original artwork.',
        emit: (i, u) => `peacockFan(${i.p},${u.spread},${u.rows},${u.width},u_time*${u.speed})`
    }),
    peacockBody: component({
        name: 'Peacock body & crest', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: { size: num('Size', 1, 0.3, 2, 0.01, 's', 'How big the whole bird is, crest included. Slide right for a bigger bird.') },
        equation: 'body ellipses + curved neck + head + crest segments',
        steps: [step('q = p / s, \\quad \\text{coverage} = \\max(\\text{body},\\ \\text{neck},\\ \\text{head},\\ \\text{beak},\\ \\text{crest})(q)', 'The plane is first divided by the size s, which makes the bird bigger or smaller. The bird is built from soft ovals and short line segments for the body, neck, head, beak and crest, each with its own color. Taking the largest (max) of their coverages joins them into one silhouette: a point is inside the bird if it is inside any piece.')],
        concepts: ['sdf', 'union', 'alpha'],
        description: 'Draws the peacock’s blue body, neck, head, beak and crest. The bird is a solid silhouette made of soft ovals and short line segments, each with its own color. It is a separate layer placed over the feather fan, so you can change the fan without bending the bird.',
        emit: (i, u) => `peacockBody(${i.p},${u.size})`
    }),
    fire: component({
        name: 'Tapered flame field', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            height: num('Height', 2, 0.2, 3, 0.01, 'h', 'How tall the flame is. Slide right for a taller flame.'),
            width: num('Base width', 0.8, 0.1, 2, 0.01, 'b', 'How wide the flame is at its base. Slide right for a wider flame.'),
            turbulence: num('Turbulence', 1, 0, 2, 0.01, '\\tau', 'How much the noise tears the edge into tongues of flame. Zero gives a smooth teardrop.'),
            speed: num('Rise speed', 1, 0, 3, 0.01, '\\omega', 'How fast the flame pattern rises. Zero freezes it.')
        },
        equation: 'tapered silhouette + advected noise + heat palette',
        steps: [
            step('q = \\left(\\frac{x}{b},\\ \\frac{y + 1.05}{h}\\right), \\quad u = \\operatorname{warp}_{0.75\\tau}\\left(2 q_x,\\ 3.8\\, q_y - 0.3\\, \\omega t\\right)', 'First the flame’s box is scaled so that its base is b wide and it is h tall. The noise position u slides downward over time, so the pattern read through it seems to rise, and the higher the turbulence τ, the more u is warped.'),
            step('\\text{flame} = 1 - \\operatorname{smoothstep}\\left(-0.13,\\ 0.13,\\ |q_x| - 0.7(1 - q_y)^{0.63} - 0.65\\,\\tau\\,\\left(n(u) - \\frac{1}{2}\\right)\\right)', 'The outline is a teardrop that narrows toward the top, and the rising noise n(u) pushes its edge in and out to make tongues of flame. A heat palette then colors it by height and brightness, from dark red through orange and yellow to white. The code also makes the flame sway gently from side to side.')
        ],
        notes: [['n(u)', 'the noise pattern, read at positions that slide downward, so it seems to rise'], ['\\text{heat}', 'how hot this point looks: the flame, fading with height, colored from red through yellow to white']],
        concepts: ['domain-warp', 'fbm', 'smoothstep'],
        curve: { title: 'How wide the flame is at each height (with τ = 0)', x: 'height q_y', y: 'half-width', domain: () => [0, 1], series: [{ f: y => 0.7 * (1 - y) ** 0.63 }] },
        description: 'Draws a flickering flame that rises from its base. The flame is a teardrop whose edge is torn into tongues by noise, colored from dark red at the edges to yellow and white-hot in the core. The noise never really moves: the part reads it at positions that slide downward over time, which makes the pattern appear to rise. This is our own study, not a copy of the video that inspired it.',
        emit: (i, u) => `firePlume(${i.p},${u.height},${u.width},${u.turbulence},u_time*${u.speed})`
    }),
    hedgehog: component({
        name: 'Hedgehog & quill field', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            quills: num('Quill length', 0.28, 0.02, 0.7, 0.01, 'L', 'How long the quills are. Slide right for longer spikes.'),
            density: num('Quill count', 160, 10, 160, 1, 'N', 'How many quills are drawn, up to 160. Slide left for a sparser coat.'),
            speed: num('Breathing speed', 0.5, 0, 2, 0.01, '\\omega', 'How fast the hedgehog breathes. Zero holds it still.')
        },
        equation: 'elliptical body + repeated tapered segment quills + facial masks',
        steps: [
            step('\\text{body} = [\\,|q/(0.91, 0.59)| < 1\\,], \\quad q = (p - c)\\,/\\,(1,\\ 1 + 0.007 \\sin(1.8\\, \\omega t))', 'The body is an oval that reaches 0.91 units to each side of its center c and 0.59 units up and down. A tiny up-and-down stretch that rises and falls over time makes the hedgehog breathe.'),
            step('\\text{quill}_i = e^{-(d_i/0.007(1.1 - 0.8 u_i))^2}, \\quad |\\text{quill}_i| = L\\,(0.65 + 0.35\\, h_i), \\quad i < N', 'Each of the N quills is a thin, bell-shaped line that gets narrower toward its tip. It starts at a point on the body picked by a hash (a scrambling formula that gives random-looking but repeatable numbers) and is about L long. The quills are stacked with Over, and the head, ear, eye, nose and feet are added on top the same way.')
        ],
        notes: [['d_i, u_i', 'the distance to quill i, and how far along it the point is'], ['h_i', 'a random-looking number for quill i that varies its length']],
        concepts: ['hash', 'gaussian', 'over', 'stamp'],
        description: 'Draws a hedgehog with up to 160 spiky quills. An oval body with fuzzy brown fur is covered along its back by quills, thin lines that taper to pale tips, each with a random-looking but repeatable position and length. A head, ear, eye, nose and feet are layered on top, and the whole animal breathes gently. This is our own construction, not a copy of the video steps that inspired it.',
        emit: (i, u) => `hedgehog(${i.p},${u.quills},${u.density},u_time*${u.speed})`
    })
};
/** What each kind of part makes: a short label, and the name with its GLSL type (for the documents). */
export const typeNames = { coord: 'Positions · vec2 (x, y) per pixel', scalar: 'Numbers · one float per pixel', geometry: 'A shape · S, A and coverage per pixel', layer: 'A picture · color and alpha (vec4) per pixel' };
export const typeLabels = { coord: 'positions', scalar: 'numbers', geometry: 'shape', layer: 'picture' };
export const zeroByType = { coord: 'vec2(0)', scalar: '0.0', geometry: 'Geometry(0.0,0.0,0.0)', layer: 'vec4(0)' };
export function parameterDefaults(type) {
    if (!Object.hasOwn(catalog, type)) {
        throw new Error(`Unknown component: ${type}`);
    }
    return Object.fromEntries(Object.entries(catalog[type].params).map(([key, spec]) => [key, spec.value]));
}
/** Parameter specs of a node: its component's, plus the parameters a custom
 * equation declares with `param` lines (see expression.js). An equation that
 * does not parse contributes none; validation reports it.
 */
export function paramSpecs(node) {
    const def = catalog[node.type];
    if (def?.code) {
        try {
            return { ...def.params, ...codeParams(node.params.code), ...loopStepSpecs(analyzeCode(node.params.code)) };
        }
        catch (e) {
            return def.params;
        }
    }
    if (!def?.custom) {
        return def?.params || {};
    }
    try {
        return { ...def.params, ...equationParams(node.params.expression, node.type) };
    }
    catch (e) {
        return def.params;
    }
}
/** One slider per loop of shader code, `steps1`, `steps2`, …: stop the loop after
 * that many steps to see how the picture builds up. The range ends at the number
 * of steps the loop really takes (glsl.js measures it), or at the safety budget
 * when that depends on the pixel.
 */
export function loopStepSpecs(analysis) {
    return Object.fromEntries(analysis.loops.map(l => {
        const n = l.index + 1, max = l.steps ?? CODE_LIMITS.budget, where = l.caption || l.name;
        const help = l.steps === null
            ? `Stop loop ${n} (${where}, line ${l.line}) after this many steps. The loop normally keeps going until its condition is false, so the highest value means “no limit”.`
            : `Stop loop ${n} (${where}, line ${l.line}) after this many steps; it normally takes ${l.steps}${l.depth ? ' each time it runs' : ''}. Slide left to watch the picture build up step by step.`;
        return [`steps${n}`, { kind: 'number', label: `Loop ${n} steps`, value: max, min: 0, max, step: 1, symbol: `N_{${n}}`, help, loop: l.index, custom: true }];
    }));
}
/** Socket passed through when a node of this type is disabled, or null. */
export function bypassSocket(type) {
    return catalog[type]?.bypass ?? null;
}
/** Types that can be inserted on a wire of `kind`: modifiers whose bypass socket
 * and output both have that type, so the old connection passes through them.
 */
export function insertableTypes(kind) {
    return Object.entries(catalog).filter(([, d]) => d.output === kind && d.bypass && d.inputs[d.bypass] === kind).map(([type]) => type);
}
/** Types with the same output that could replace a node of `type`. */
export function replacementTypes(type) {
    const output = catalog[type].output;
    return Object.entries(catalog).filter(([t, d]) => t !== type && d.output === output).map(([t]) => t);
}
/** GLSL for one node with readable names: socket names for inputs and parameter
 * keys for uniforms. Shown in the inspector next to the typeset equation.
 */
export function emitPreview(type, params = {}) {
    const d = catalog[type], names = keys => Object.fromEntries(keys.map(k => [k, k]));
    return d.emit(names(Object.keys(d.inputs)), names(Object.keys(d.params))) || params.expression || '';
}
