/** Single source of truth for the node palette, type system, UI and shader compiler.
 *
 * Each component declares:
 *   name, category, output      display name, palette group, output type
 *   inputs                      socket name → type ('coord' | 'scalar' | 'geometry' | 'layer')
 *   inputSymbols                optional socket name → TeX symbol used in the equation
 *   params                      parameter schema; every number/color has a TeX `symbol`
 *                               that appears in `tex`, and a plain-language `help`
 *   tex                         typeset equation lines (TeX subset, see math-render.js)
 *   notes                       [TeX symbol, meaning] for symbols that are not parameters
 *   equation                    one-line plain-text summary (search, docs)
 *   description                 what the component is for
 *   role                        'source' | 'modifier' | 'combine' | 'content'
 *   bypass                      socket passed through unchanged when the node is
 *                               disabled; null means a disabled node outputs typed zero
 *   emit(inputs, uniforms)      GLSL expression; receives GLSL expression strings,
 *                               not JS values. Numerical parameters are uniforms.
 */
const num = (label, value, min, max, step, symbol, help) => ({ kind: 'number', label, value, min, max, step, symbol, help });
const rgb = (label, value, symbol, help) => ({ kind: 'color', label, value, symbol, help: `${help} A linear radiance multiplier; display conversion happens only after composition.` });
const expr = value => ({ kind: 'expression', label: 'GLSL expression', value, help: 'Use p, x, y, r, theta, t, a and b. Expression only: no statements, loops, declarations, or JavaScript.' });
const component = def => ({ inputs: {}, inputSymbols: {}, params: {}, notes: [], role: 'content', bypass: null, ...def });
const customNotes = [['p = (x, y)', 'input coordinates'], ['r, \\theta', 'polar radius and angle of p'], ['a, b', 'optional scalar inputs'], ['t', 'time in seconds']];
export const catalog = {
    coordinates: component({
        name: 'Image coordinates', category: 'Coordinates', output: 'coord', role: 'source',
        equation: 'p = (pixel − center) × worldUnitsPerPixel / zoom + pan',
        tex: ['p = \\frac{W}{w\\, z}\\left(\\mathbf{x} - \\frac{\\mathbf{s}}{2}\\right) + \\mathbf{o}'],
        notes: [['\\mathbf{x}', 'pixel position'], ['\\mathbf{s}, w', 'image size and width in pixels'], ['W', 'world width, 2000/420 units'], ['z, \\mathbf{o}', 'camera zoom and pan']],
        description: 'World-space coordinates of every pixel. Native 2000 × 1200 sampling keeps the original +1/840 offset on each axis. Most scenes feed all their components from this one field.',
        emit: () => 'p'
    }),
    transform: component({
        name: 'Translate · rotate · scale', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            x: num('Center X', 0, -5, 5, 0.01, 'c_x', 'Horizontal position of the local origin in world units. Moves whatever is sampled downstream right (+) or left (−).'),
            y: num('Center Y', 0, -5, 5, 0.01, 'c_y', 'Vertical position of the local origin. Moves the downstream object up (+) or down (−).'),
            angle: num('Rotation', 0, -6.28, 6.28, 0.01, '\\theta', 'Counter-clockwise rotation in radians (6.28 is one full turn).'),
            scale: num('Scale', 1, 0.05, 5, 0.01, 's', 'Uniform size: values above 1 enlarge the downstream object, below 1 shrink it.'),
            stretch: num('Vertical stretch', 1, 0.1, 4, 0.01, 'k', 'Extra vertical scale on top of Scale: above 1 makes the object taller, below 1 flatter.')
        },
        equation: 'q = R(−angle) (p − center) / scale',
        tex: ['q = \\operatorname{diag}(s,\\ s k)^{-1}\\, R(-\\theta)\\,(p - c), \\quad c = (c_x, c_y)'],
        notes: [['R(\\theta)', 'rotation matrix']],
        description: 'Inverse-map world pixels into local object coordinates. This moves the object without stretching a stored picture.',
        emit: (i, u) => `rotate2(${i.p}-vec2(${u.x},${u.y}),-${u.angle})/vec2(${u.scale},${u.scale}*${u.stretch})`
    }),
    vortex: component({
        name: 'Localized vortex', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            strength: num('Twist', 4, -16, 16, 0.1, '\\kappa', 'Rotation at the center in radians; negative twists the other way. The twist fades to zero away from the center.'),
            radius: num('Influence radius', 1, 0.02, 4, 0.02, '\\rho', 'Distance over which the twist fades (Gaussian falloff). Larger values twist a wider area.'),
            speed: num('Rotation speed', 0, -2, 2, 0.01, '\\omega', 'Extra rotation that grows with time, in radians per second. Zero keeps the twist static.')
        },
        equation: 'q = R(strength · exp(−r²/radius²) + speed · t) p',
        tex: ['q = R\\left(\\kappa\\, e^{-|p|^2/\\rho^2} + \\omega t\\right) p'],
        notes: [['R(\\cdot)', 'rotation by the given angle'], ['t', 'time in seconds']],
        description: 'A smooth local coordinate twist. Send any texture, star field or silhouette through this map.',
        emit: (i, u) => `vortex(${i.p},${u.strength},${u.radius},${u.speed}*u_time)`
    }),
    domainwarp: component({
        name: 'Turbulent coordinate warp', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            amplitude: num('Displacement', 0.4, 0, 2, 0.01, 'A', 'How far coordinates are pushed, in world units. Zero leaves them unchanged.'),
            frequency: num('Frequency', 2, 0.1, 12, 0.1, 'f', 'Spatial frequency of the displacement noise. Higher values give smaller, busier wobbles.'),
            speed: num('Flow speed', 0.1, -2, 2, 0.01, '\\omega', 'How quickly the noise pattern drifts over time. Zero freezes it.')
        },
        equation: 'q = p + amplitude · (noise₁(p,t), noise₂(p,t))',
        tex: ['q = p + A\\left[\\left(n_1(f p + \\omega t),\\ n_2(f p - \\omega t)\\right) - \\frac{1}{2}\\right]'],
        notes: [['n_1, n_2', 'independent five-octave fractal noise, 0 to 1'], ['t', 'time in seconds']],
        description: 'Independent smooth fields displace the two coordinate axes. A reusable alternative to drawing complicated boundaries directly.',
        emit: (i, u) => `domainWarp(${i.p},${u.amplitude},${u.frequency},u_time*${u.speed})`
    }),
    polar: component({
        name: 'Polar coordinates', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            angleScale: num('Angle scale', 1, 0.1, 12, 0.1, 'k_\\theta', 'Multiplies the angle before it becomes the x coordinate. Integer values tile the pattern around the circle without a seam.'),
            radiusScale: num('Radius scale', 1, 0.1, 12, 0.1, 'k_r', 'Multiplies the distance from the center before it becomes the y coordinate. Higher values repeat the pattern more often outward.')
        },
        equation: 'q = (atan2(y,x), length(p))',
        tex: ['q = (k_\\theta\\, \\theta,\\ k_r\\, r), \\quad \\theta = \\operatorname{atan2}(p_y, p_x),\\ r = |p|'],
        description: 'Unroll angles and radii into a texture plane. There is a branch seam at ±π; integer angular repetition can hide it.',
        emit: (i, u) => `vec2(angleOf(${i.p})*${u.angleScale},length(${i.p})*${u.radiusScale})`
    }),
    kaleidoscope: component({
        name: 'Angular mirror', category: 'Coordinates', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            sectors: num('Sectors', 6, 2, 24, 1, 'n', 'Number of mirrored wedges around the center.'),
            spin: num('Rotation speed', 0.1, -1, 1, 0.01, '\\omega', 'Rotates the mirror pattern over time, in radians per second.')
        },
        equation: 'a = |mod(theta + π/n, 2π/n) − π/n|',
        tex: ['\\varphi = \\left|\\left(\\theta + \\omega t + \\frac{\\pi}{n}\\right) \\bmod \\frac{2\\pi}{n} - \\frac{\\pi}{n}\\right|, \\quad q = |p|\\,(\\cos\\varphi,\\ \\sin\\varphi)'],
        notes: [['\\theta', 'angle of p'], ['t', 'time in seconds']],
        description: 'Fold the angular coordinate into mirrored sectors. Reuse any source pattern to create symmetry.',
        emit: (i, u) => `angularMirror(${i.p},${u.sectors},u_time*${u.spin})`
    }),
    noise: component({
        name: 'Fractal value noise', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
        params: {
            frequency: num('Frequency', 3, 0.1, 30, 0.1, '\\nu', 'Size of the noise features: higher values are finer.'),
            octaves: num('Octaves', 6, 1, 8, 1, 'N', 'Number of noise layers, each about twice as fine and half as strong. More octaves add fine detail.'),
            speed: num('Flow speed', 0.1, -2, 2, 0.01, '\\omega', 'Vertical drift of the pattern per second.'),
            seed: num('Seed offset', 0, 0, 100, 1, '\\sigma', 'Shifts to a different but equally random-looking pattern.')
        },
        equation: 'f(p) = Σ 2⁻ᵏ noise(2ᵏ Rp + offset)',
        tex: ['f = \\frac{1}{Z}\\sum_{k=0}^{N-1} 2^{-k}\\, n\\left(2.03^{k} M^{k} q\\right), \\quad q = \\nu p + (\\sigma,\\ \\omega t)'],
        notes: [['n', 'smooth value noise, 0 to 1'], ['M', 'fixed small rotation between octaves'], ['Z', 'normalization so f stays in 0 to 1']],
        description: 'Smooth deterministic multiscale noise. Not part of the original nebula formulas; useful for new organic surfaces.',
        emit: (i, u) => `fbm(${i.p}*${u.frequency}+vec2(${u.seed},u_time*${u.speed}),${u.octaves})`
    }),
    waves: component({
        name: 'Nested cosine bands', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
        params: {
            frequency: num('Frequency', 9, 0.1, 80, 0.1, '\\nu', 'Bands per world unit: higher values give thinner, denser bands.'),
            bend: num('Phase bending', 4, 0, 20, 0.1, '\\beta', 'How strongly a second wave bends the bands. Zero gives straight parallel stripes.'),
            speed: num('Phase speed', 0.5, -4, 4, 0.01, '\\omega', 'Speed of the bending wave over time.')
        },
        equation: 'f = ½ + ½ cos(kx + b sin(ky − t))',
        tex: ['f = \\frac{1}{2} + \\frac{1}{2}\\cos\\left(\\nu x + \\beta \\sin(0.65\\, \\nu y - \\omega t)\\right)'],
        notes: [['p = (x, y)', 'input coordinates']],
        description: 'A compact example of phase modulation: one wave bends another. It becomes marbling under a coordinate warp.',
        emit: (i, u) => `(0.5+0.5*cos(${i.p}.x*${u.frequency}+${u.bend}*sin(${i.p}.y*${u.frequency}*0.65-u_time*${u.speed})))`
    }),
    disc: component({
        name: 'Soft disc / sphere mask', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1, 0.02, 3, 0.01, 'r', 'Radius of the disc in world units.'),
            edge: num('Edge softness', 0.02, 0.001, 0.6, 0.001, '\\epsilon', 'Width of the soft transition at the rim. Small values give a crisp edge.')
        },
        equation: 'mask = 1 − smoothstep(−edge, edge, |p| − radius)',
        tex: ['m = 1 - \\operatorname{smoothstep}\\left(-\\epsilon,\\ \\epsilon,\\ |p| - r\\right)'],
        description: 'Coverage mask: 1 inside, 0 outside. Connect it to Mask layer, or use it to modulate another field.',
        emit: (i, u) => `softInside(length(${i.p})-${u.radius},${u.edge})`
    }),
    ring: component({
        name: 'Gaussian ring', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1, 0, 3, 0.01, 'r', 'Distance of the bright rim from the center.'),
            width: num('Width', 0.1, 0.005, 1, 0.005, 'w', 'Thickness of the rim (Gaussian width).')
        },
        equation: 'f = exp(−((|p| − radius)/width)²)',
        tex: ['f = \\exp\\left(-\\left(\\frac{|p| - r}{w}\\right)^2\\right)'],
        description: 'A luminous rim with a hollow center. A Gaussian field, not a geometric mesh.',
        emit: (i, u) => `gaussian(length(${i.p})-${u.radius},${u.width})`
    }),
    threshold: component({
        name: 'Soft threshold', category: 'Scalar fields', output: 'scalar', inputs: { field: 'scalar' }, inputSymbols: { field: 'g' }, role: 'modifier', bypass: 'field',
        params: {
            level: num('Threshold', 0.5, -2, 2, 0.01, '\\ell', 'Input value where the output crosses about 0.37. Raise it to keep only the highest parts of the field.'),
            sharpness: num('Sharpness', 8, 0.1, 60, 0.1, 's', 'Steepness of the transition. High values give hard-edged islands; low values a gentle ramp.')
        },
        equation: 'f = exp(−exp(−sharpness · (field − level)))',
        tex: ['f = \\exp\\left(-e^{-s\\,(g - \\ell)}\\right)'],
        description: 'The same nested-exponential gate used by the source equations. Turns smooth variation into wisps, islands or filaments.',
        emit: (i, u) => `cutoff(-${u.sharpness}*(${i.field}-${u.level}))`
    }),
    fieldmath: component({
        name: 'Combine scalar fields', category: 'Scalar fields', output: 'scalar', inputs: { a: 'scalar', b: 'scalar' }, role: 'combine', bypass: 'a',
        params: {
            weightA: num('A weight', 1, -5, 5, 0.01, 'w_a', 'Multiplier for input a.'),
            weightB: num('B weight', 1, -5, 5, 0.01, 'w_b', 'Multiplier for input b. Use a negative value to subtract b.'),
            product: num('Product weight', 0, -5, 5, 0.01, 'w_p', 'Weight of the product a·b; use it to modulate one field by another.'),
            bias: num('Bias', 0, -4, 4, 0.01, 'c', 'Constant added to the result.')
        },
        equation: 'f = wa·a + wb·b + wp·a·b + bias',
        tex: ['f = w_a\\, a + w_b\\, b + w_p\\, a b + c'],
        description: 'One small arithmetic node supports sums, differences, products and threshold offsets.',
        emit: (i, u) => `(${u.weightA}*${i.a}+${u.weightB}*${i.b}+${u.product}*${i.a}*${i.b}+${u.bias})`
    }),
    expression: component({
        name: 'Custom scalar equation', category: 'Authoring', output: 'scalar', inputs: { p: 'coord', a: 'scalar', b: 'scalar' },
        params: { expression: expr('0.5 + 0.5*cos(8.0*r - 3.0*theta - t)') },
        equation: 'float f(p,a,b,t) = your expression', tex: ['f(p, a, b, t) = \\text{your expression}'], notes: customNotes,
        description: 'Compile an editable GLSL scalar expression. x,y,r,theta are derived from p. Additional scalar sockets a and b can carry any fields.',
        emit: () => ''
    }),
    vectorExpression: component({
        name: 'Custom coordinate equation', category: 'Authoring', output: 'coord', inputs: { p: 'coord', a: 'scalar', b: 'scalar' }, role: 'modifier', bypass: 'p',
        params: { expression: expr('rotate2(p, 0.5*sin(r*3.0-t))') },
        equation: 'vec2 q(p,a,b,t) = your expression', tex: ['q(p, a, b, t) = \\text{your expression}'], notes: customNotes,
        description: 'Author new coordinate maps without rewriting the renderer. Returns vec2; no JavaScript execution.',
        emit: () => ''
    }),
    colorExpression: component({
        name: 'Custom color equation', category: 'Authoring', output: 'layer', inputs: { p: 'coord', a: 'scalar', b: 'scalar' },
        params: { expression: expr('spectrum(r - t*0.1, 0.0) * (0.5 + 0.5*cos(theta*6.0))') },
        equation: 'vec3 color(p,a,b,t) = your expression', tex: ['\\mathrm{RGB}(p, a, b, t) = \\text{your expression}'], notes: customNotes,
        description: 'Author RGB radiance. Returns vec3; alpha is set to one. Combine with a mask for transparency.',
        emit: () => ''
    }),
    palette: component({
        name: 'Two-color emission', category: 'Color & composition', output: 'layer', inputs: { field: 'scalar' }, inputSymbols: { field: 'f' },
        params: {
            low: rgb('Low color', '#09212e', 'C_0', 'Color where the field is 0 or below.'),
            high: rgb('High color', '#62edc3', 'C_1', 'Color where the field is 1 or above.'),
            gain: num('Emission', 1, 0, 5, 0.01, 'g', 'Overall brightness multiplier, before exposure and tone mapping.'),
            power: num('Contrast power', 1, 0.1, 8, 0.05, '\\gamma', 'Shapes the blend: above 1 keeps more of the low color, below 1 pushes toward the high color.')
        },
        equation: 'RGB = gain · mix(low, high, clamp(field)^power)',
        tex: ['\\mathrm{RGB} = g\\cdot \\operatorname{mix}\\left(C_0,\\ C_1,\\ \\operatorname{clamp}(f, 0, 1)^{\\gamma}\\right), \\quad \\alpha = 1'],
        description: 'Color a scalar field. This returns straight RGB with full coverage; add a mask when the layer should be transparent.',
        emit: (i, u) => `vec4(mix(${u.low},${u.high},pow(clamp(${i.field},0.0,1.0),${u.power}))*${u.gain},1)`
    }),
    solid: component({
        name: 'Solid color', category: 'Color & composition', output: 'layer',
        params: {
            color: rgb('Color', '#030712', 'C', 'The constant color.'),
            gain: num('Gain', 1, 0, 4, 0.01, 'g', 'Brightness multiplier.')
        },
        equation: 'RGB = color × gain', tex: ['\\mathrm{RGB} = g\\, C, \\quad \\alpha = 1'],
        description: 'A background or constant radiance layer.',
        emit: (i, u) => `vec4(${u.color}*${u.gain},1)`
    }),
    tint: component({
        name: 'Tint & gain', category: 'Color & composition', output: 'layer', inputs: { layer: 'layer' }, inputSymbols: { layer: 'L' }, role: 'modifier', bypass: 'layer',
        params: {
            color: rgb('RGB multiplier', '#ffffff', 'C', 'Per-channel multiplier; white leaves the layer unchanged.'),
            gain: num('Gain', 1, 0, 5, 0.01, 'g', 'Overall brightness multiplier.')
        },
        equation: 'RGB = incoming RGB × tint × gain',
        tex: ['\\mathrm{RGB} = g\\, C \\odot L_{\\mathrm{rgb}}, \\quad \\alpha = L_{\\alpha}'],
        description: 'Multiply floating-point radiance before output conversion. Does not discard highlight detail.',
        emit: (i, u) => `vec4(${i.layer}.rgb*${u.color}*${u.gain},${i.layer}.a)`
    }),
    mask: component({
        name: 'Mask layer', category: 'Color & composition', output: 'layer', inputs: { layer: 'layer', mask: 'scalar' }, inputSymbols: { layer: 'L', mask: 'm' }, role: 'modifier', bypass: 'layer',
        params: { strength: num('Strength', 1, 0, 1, 0.01, 's', 'How much the mask applies: 0 ignores it, 1 applies it fully.') },
        equation: 'alpha = alpha × mix(1, clamp(mask), strength)',
        tex: ['\\alpha = L_{\\alpha} \\cdot \\operatorname{mix}\\left(1,\\ \\operatorname{clamp}(m, 0, 1),\\ s\\right), \\quad \\mathrm{RGB} = L_{\\mathrm{rgb}}'],
        description: 'Changes coverage, not straight RGB. Use Over to honor alpha; Add intentionally sums emitted RGB regardless of coverage.',
        emit: (i, u) => `vec4(${i.layer}.rgb,${i.layer}.a*mix(1.0,clamp(${i.mask},0.0,1.0),${u.strength}))`
    }),
    add: component({
        name: 'Add light', category: 'Color & composition', output: 'layer', inputs: { a: 'layer', b: 'layer' }, inputSymbols: { a: 'A', b: 'B' }, role: 'combine', bypass: 'a',
        params: { gain: num('B gain', 1, 0, 5, 0.01, 'g', 'Brightness of layer B before it is added to A. Zero removes B; 2 doubles it.') },
        equation: 'RGB = A.rgb + gain · B.rgb',
        tex: ['\\mathrm{RGB} = A_{\\mathrm{rgb}} + g\\, B_{\\mathrm{rgb}}, \\quad \\alpha = \\max(A_{\\alpha}, B_{\\alpha})'],
        description: 'Sum radiance before tone mapping. Alpha does not attenuate emission; use Over for opaque objects or alpha-masked layers.',
        emit: (i, u) => `addLight(${i.a},${i.b},${u.gain})`
    }),
    over: component({
        name: 'Front over back', category: 'Color & composition', output: 'layer', inputs: { front: 'layer', back: 'layer' }, inputSymbols: { front: 'F', back: 'B' }, role: 'combine', bypass: 'back',
        equation: 'alpha = af + ab(1−af); RGB = (af Cf + (1−af)ab Cb)/alpha',
        tex: ['\\alpha = \\alpha_F + \\alpha_B(1 - \\alpha_F), \\quad C = \\frac{\\alpha_F C_F + (1 - \\alpha_F)\\,\\alpha_B C_B}{\\alpha}'],
        notes: [['C_F, \\alpha_F', 'front color and coverage'], ['C_B, \\alpha_B', 'back color and coverage']],
        description: 'Correct straight-alpha composition. Use it to hide background stars behind a planet, feathers, or a silhouette.',
        emit: i => `overLayer(${i.front},${i.back})`
    }),
    nebulaGeometry: component({
        name: 'Pinched shell family · S,A', category: 'Source nebula', output: 'geometry', inputs: { p: 'coord' },
        params: {
            pinch: num('Neck pinch', 0.3, 0.05, 0.8, 0.005, '\\eta', 'Exponent that squeezes the shells toward the vertical center line, forming the waist between the two lobes. The source uses 0.3; higher values pinch harder.'),
            shear: num('Shell shear', 0.15, -0.5, 0.6, 0.005, '\\sigma', 'Common tilt added to every shell’s sheared coordinates. The source uses 0.15; changing it leans and skews the lobes.'),
            shells: num('Shell count', 27, 1, 27, 1, 'N', 'How many of the 27 source shells are evaluated, from the first. Fewer shells give fewer overlapping contours.')
        },
        equation: 'Lₛ = sqrt(Uₛ² + (2Rₛ^0.3 |Uₛ|^−0.3 Vₛ)²) − Rₛ',
        tex: [
            'U_s = x + (\\sigma + c_s)\\, y, \\quad V_s = y - (\\sigma + d_s)\\, x',
            'L_s = \\sqrt{U_s^2 + \\left(\\frac{2 R_s^{\\eta}\\, V_s}{|U_s|^{\\eta}}\\right)^2} - R_s, \\quad s = 1 \\ldots N',
            'w_s = J_s \\prod_{u<s}(1 - J_u), \\quad J_s = e^{-e^{25 - 50 s}}\\, e^{-e^{10 L_s}}',
            'S = \\sum_s 2 w_s L_s, \\quad A = \\sum_s \\frac{w_s}{4}\\, e^{-e^{0.15(s - 23)}}\\, e^{-e^{-3 L_s}}'
        ],
        notes: [['R_s, c_s, d_s', 'fixed per-shell radius and shears from the source'], ['S', 'shell-following texture coordinate (warp)'], ['A', 'emission rim'], ['w_s', 'ordered first-hit weight of shell s']],
        description: 'Exact structural port at defaults. Ordered soft first-hit selection produces S (texture coordinate), A (emission rim), and coverage. These are separate meanings.',
        emit: (i, u) => `nebulaGeometry(${i.p},${u.pinch},${u.shear},${u.shells})`
    }),
    ringGeometry: component({
        name: 'Replacement ring geometry', category: 'Source nebula', output: 'geometry', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1.1, 0.1, 2, 0.01, 'r', 'Radius of the ring in world units.'),
            width: num('Rim width', 0.16, 0.01, 0.7, 0.01, 'w', 'Thickness of the emitting rim.'),
            flatten: num('Vertical compression', 1.5, 0.2, 3, 0.01, 'k', 'Squashes the ring vertically: 1 is a circle, larger values a flatter ellipse.')
        },
        equation: 'S=2d; A=0.22 exp(−(d/width)²); d=|scaled p|−radius',
        tex: ['d = \\sqrt{x^2 + (k y)^2} - r, \\quad S = 2 d, \\quad A = 0.22\\, e^{-(d/w)^2}, \\quad \\text{coverage} = e^{-(d/w)^2}'],
        description: 'New geometry with the same interface as the pinched shell family. Reuse the entire original cloud machinery unchanged.',
        emit: (i, u) => `ringGeometry(${i.p},${u.radius},${u.width},${u.flatten})`
    }),
    geometryField: component({
        name: 'Inspect geometry channel', category: 'Source nebula', output: 'scalar', inputs: { geometry: 'geometry' },
        params: {
            channel: num('0=warp · 1=rim · 2=coverage', 1, 0, 2, 1, 'c', 'Which geometry channel to output: 0 the shell-following warp coordinate S, 1 the emission rim A, 2 the coverage.'),
            gain: num('Display gain', 4, 0.1, 10, 0.1, 'g', 'Multiplier applied to the extracted channel.')
        },
        equation: 'f = geometry.warp / rim / coverage',
        tex: ['f = g \\cdot G_c, \\quad G_0 = S,\\ G_1 = A,\\ G_2 = \\text{coverage}'],
        description: 'Extract one named field for diagnosis, masks or further composition. The rim and coverage are deliberately not interchangeable.',
        emit: (i, u) => `((${u.channel}<0.5)?${i.geometry}.warp:((${u.channel}<1.5)?${i.geometry}.rim:${i.geometry}.coverage))*${u.gain}`
    }),
    nebulaTurbulence: component({
        name: 'Nested-cosine turbulence · E', category: 'Source nebula', output: 'scalar', inputs: { p: 'coord', geometry: 'geometry' }, inputSymbols: { geometry: 'S' },
        params: {
            bands: num('Bands', 50, 1, 50, 1, 'N', 'Number of the 50 source cosine terms summed, from the largest scale. Fewer bands give smoother, blobbier turbulence.'),
            speed: num('Phase speed', 0, -1, 1, 0.01, '\\omega', 'Optional animation that shifts the cosine phases over time. The source is static (0).')
        },
        equation: 'E = Σ (19/20)ˢ Dₛ(S,Qₛ)',
        tex: [
            'E = \\sum_{s=1}^{N} 0.95^{s} \\cos\\left(a_s + 4\\cos b_s + \\phi_s + \\omega t\\right)\\cos\\left(c_s + 4\\cos d_s + \\psi_s - \\omega t\\right)',
            'a_s, b_s, c_s, d_s = 1.25^{s} \\times \\text{fixed rotations of } (S, Q_s), \\quad Q_s = p \\cdot (\\cos 15 s^2,\\ \\sin 15 s^2)'
        ],
        notes: [['S', 'warp coordinate from the geometry'], ['\\phi_s, \\psi_s', 'fixed phases from the source']],
        description: 'Original 50-band signed modulation. It perturbs the filament threshold and central glow. Motion is an optional new phase shift, zero in source mode.',
        emit: (i, u) => `nebulaTurbulence(${i.p},${i.geometry},${u.bands},u_time*${u.speed})`
    }),
    nebulaCloud: component({
        name: 'Filaments & haze · K', category: 'Source nebula', output: 'layer', inputs: { p: 'coord', geometry: 'geometry', turbulence: 'scalar' }, inputSymbols: { geometry: 'S, A', turbulence: 'E' },
        params: {
            bands: num('Bands', 50, 1, 50, 1, 'N', 'Number of the 50 source filament bands summed, coarse to fine. Fewer bands remove the finest filaments.'),
            detail: num('Sharp filament gain', 1, 0, 3, 0.01, '\\delta', 'Weight of the sharp filament term (45 in the source). Zero leaves only the soft haze.')
        },
        equation: 'Iₛ=45 C₁,ₛ+6 C₀,ₛ; Kᵥ=Σ Iₛ (19/20)ˢ κᵥ,ₛ',
        tex: [
            'Z_s = C_s - 1.25 + 2A + \\frac{E}{7}, \\quad I_s = 45\\,\\delta\\, e^{-e^{-4 Z_s}} + 6\\, e^{-e^{-Z_s/4}}',
            'K = \\sum_{s=1}^{N} 0.95^{s}\\, I_s\\, \\kappa_s'
        ],
        notes: [['C_s', 'product of two cosines of S and the rotated coordinate at frequency 0.2·1.15^s'], ['\\kappa_s', 'fixed per-band RGB weight (can be negative)']],
        description: 'Original RGB field before the geometry rim and core cutout are applied. Preview looks over-bright because masking happens downstream.',
        emit: (i, u) => `nebulaCloud(${i.p},${i.geometry},${i.turbulence},${u.bands},${u.detail})`
    }),
    nebulaGas: component({
        name: 'Gas emission · Hgas', category: 'Source nebula', output: 'layer', inputs: { p: 'coord', geometry: 'geometry', turbulence: 'scalar', cloud: 'layer' }, inputSymbols: { geometry: 'A', turbulence: 'E', cloud: 'K' },
        params: { gain: num('Gas gain', 1, 0, 3, 0.01, 'g', 'Brightness of the shell gas emission.') },
        equation: 'Hgas = 1.1 (1−W) K A',
        tex: ['H_{\\text{gas}} = 1.1\\, g\\, (1 - W)\\, K A, \\quad W = e^{-e^{10|p| - 1 + E/4}}'],
        notes: [['W', 'central glow mask']],
        description: 'Original gas contribution. A confines emission to shell rims; 1−W clears the central glow region.',
        emit: (i, u) => `nebulaGas(${i.p},${i.geometry},${i.turbulence},${i.cloud},${u.gain})`
    }),
    nebulaCore: component({
        name: 'Central glow · W', category: 'Source nebula', output: 'layer', inputs: { p: 'coord', turbulence: 'scalar' }, inputSymbols: { turbulence: 'E' },
        params: { gain: num('Core gain', 1, 0, 3, 0.01, 'g', 'Brightness of the central glow.') },
        equation: 'W=exp(−exp(10|p|−1+E/4)); Hcore=W(2,2,3)',
        tex: ['W = e^{-e^{10|p| - 1 + E/4}}, \\quad H_{\\text{core}} = g\\, W\\, (2, 2, 3)'],
        description: 'Original glow. The square root in the source contains x²+y² only, not −1 or E/4.',
        emit: (i, u) => `nebulaCore(${i.p},${i.turbulence},${u.gain})`
    }),
    nebulaStars: component({
        name: 'Folded star lattices · T', category: 'Source nebula', output: 'layer', inputs: { p: 'coord' },
        params: {
            bands: num('Lattices', 30, 1, 30, 1, 'L', 'Number of the 30 folded star lattices summed. Fewer lattices give a sparser star field.'),
            gain: num('Starlight', 1, 0, 3, 0.01, 'g', 'Brightness of all stars.')
        },
        equation: 'M,N=acos(cos(rotated coordinates)); T=Σ colored(center+halo)',
        tex: [
            'M_s, N_s = \\arccos\\cos(\\text{rotated, scaled } p), \\quad \\rho_s^2 = M_s^2 + N_s^2',
            'T = g \\sum_{s=1}^{L} \\left(4\\, e^{-e^{200(\\rho_s^2 - 0.00125 - B_s/200)}} + e^{-e^{20 \\rho_s^2 - 0.14}}\\right) \\chi_s'
        ],
        notes: [['B_s', 'angular modulation that makes the pointed star shapes'], ['\\chi_s', 'alternating warm and cool star color']],
        description: 'Original deterministic stars with pointed centers. Folded-angle lattices, not random sprites or an astronomical catalog.',
        emit: (i, u) => `nebulaStars(${i.p},${u.bands},${u.gain})`
    }),
    scatterStars: component({
        name: 'Seeded star field', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            density: num('Density scale', 22, 3, 60, 1, '\\rho', 'Grid frequency of the star cells: higher values give more, closer stars.'),
            gain: num('Starlight', 0.7, 0, 3, 0.01, 'g', 'Brightness of all stars.'),
            seed: num('Seed', 17, 0, 100, 1, '\\sigma', 'Chooses a different random arrangement.'),
            speed: num('Twinkle speed', 0.1, 0, 2, 0.01, '\\omega', 'How fast the stars twinkle (±12% brightness).')
        },
        equation: 'star = Gaussian core + halo + cross rays',
        tex: [
            'q_\\ell = \\rho\\,(1 + 0.71\\,\\ell)\\, p, \\quad \\ell = 0, 1, 2, \\quad \\text{cells hashed with seed } \\sigma',
            'I = g \\sum_{\\ell} \\sum_{\\text{cells}} \\left(e^{-(d/r)^2} + 0.018\\, e^{-(d/6r)^2}\\right) b\\, \\left(0.88 + 0.12 \\sin(\\omega t + 2\\pi h)\\right)'
        ],
        notes: [['d', 'distance to the jittered star in the cell (hashed with seed σ)'], ['r, b, h', 'hashed star size, brightness and phase']],
        description: 'New deterministic jittered-cell stars. Three scales and warm/cool variation; distinct from the original folded lattice algorithm.',
        emit: (i, u) => `scatterStars(${i.p},${u.density},${u.gain},${u.seed},u_time*${u.speed})`
    }),
    planet: component({
        name: 'Cyclonic water planet', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1.08, 0.1, 2, 0.01, 'R', 'Planet radius in world units.'),
            cloud: num('Cloud cover', 0.65, 0, 2, 0.01, 'c', 'How much of the surface is covered by bright cloud; 0 shows mostly ocean.'),
            twist: num('Cyclone twist', 5, 0, 14, 0.1, '\\tau', 'Strength of the seven storm vortices that swirl the clouds.'),
            light: num('Light angle', 2.25, 0, 6.28, 0.01, '\\lambda', 'Direction of the sunlight around the planet, in radians.'),
            speed: num('Cloud drift', 0.5, -2, 2, 0.01, '\\omega', 'How fast the cloud pattern drifts east–west.')
        },
        equation: 'visible sphere → spherical coordinates → cyclone maps → clouds → lighting',
        tex: [
            'd = p / R, \\quad \\mathbf{n} = \\left(d_x,\\ d_y,\\ \\sqrt{1 - |d|^2}\\right)',
            'u = \\operatorname{cyclones}_{\\tau}(\\text{lon}, \\text{lat}) + (0.025\\, \\omega t,\\ 0), \\quad m = \\operatorname{smoothstep}(0.62 - 0.3 c,\\ 0.79 - 0.28 c,\\ n(u))',
            'C = \\operatorname{mix}(C_{\\text{ocean}},\\ C_{\\text{cloud}},\\ m)\\,\\left(0.06 + \\max(\\mathbf{n} \\cdot \\mathbf{l},\\ 0)\\right), \\quad \\mathbf{l} \\propto (\\cos\\lambda,\\ 0.35,\\ \\sin\\lambda)'
        ],
        notes: [['\\mathbf{n}', 'sphere normal (lighting)'], ['n(u)', 'fractal noise of the cyclone-warped surface coordinate']],
        description: 'Subject-inspired study, not the artist’s unretrieved formula. Rotated cloud coordinates, finite-octave noise, Lambert-like light, glint and rim scattering.',
        emit: (i, u) => `waterPlanet(${i.p},${u.radius},${u.cloud},${u.twist},${u.light},u_time*${u.speed})`
    }),
    atmosphere: component({
        name: 'Atmospheric rim', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            radius: num('Radius', 1.08, 0.1, 2, 0.01, 'R', 'Radius of the glowing limb; match it to the planet radius.'),
            gain: num('Glow', 0.7, 0, 3, 0.01, 'g', 'Brightness of the atmospheric rim.')
        },
        equation: 'glow = Gaussian(|p|−radius)',
        tex: ['I = g\\left(e^{-(\\Delta/0.025)^2} + 0.18\\, e^{-(\\Delta/0.07)^2}\\right)(0.08, 0.25, 0.55), \\quad \\Delta = |p| - R'],
        description: 'An independent analytic limb glow; align its radius with the planet when composing them.',
        emit: (i, u) => `atmosphere(${i.p},${u.radius},${u.gain})`
    }),
    lens: component({
        name: 'Star-cluster lens map', category: 'Astronomical studies', output: 'coord', inputs: { p: 'coord' }, role: 'modifier', bypass: 'p',
        params: {
            strength: num('Deflection strength', 1, 0, 3, 0.01, 'k', 'Scales every lens mass. 0 is no lensing (the identity map); higher values bend the background into bigger arcs.'),
            count: num('Lenses', 7, 1, 12, 1, 'n', 'How many cluster members deflect light; the first is the heavy central one.'),
            softening: num('Softening', 0.015, 0.001, 0.2, 0.001, '\\epsilon', 'Core radius that keeps the deflection finite near each lens; larger values give softer, smaller distortion.')
        },
        equation: 'β = θ − Σ mᵢ(θ−θᵢ)/(|θ−θᵢ|²+ε²)',
        tex: ['q = p - \\sum_{i=0}^{n-1} m_i\\, \\frac{p - c_i}{|p - c_i|^2 + \\epsilon^2}, \\quad m_0 = 0.18\\, k,\\ m_{i>0} = 0.024\\, k'],
        notes: [['c_i', 'fixed golden-angle cluster positions (shared with Foreground cluster stars)']],
        description: 'Illustrative softened thin-lens backward mapping. Zero strength is the identity. Feed the result into a galaxy; draw foreground lens stars in the unwarped plane.',
        emit: (i, u) => `clusterLens(${i.p},${u.strength},${u.count},${u.softening})`
    }),
    clusterLights: component({
        name: 'Foreground cluster stars', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            gain: num('Brightness', 1, 0, 3, 0.01, 'g', 'Brightness of the foreground cluster stars.'),
            count: num('Stars', 7, 1, 12, 1, 'n', 'How many cluster stars are drawn; keep it equal to the lens count.')
        },
        equation: 'centers share the lens map’s deterministic positions',
        tex: ['I = g \\sum_{i=0}^{n-1} \\left(1.8\\, e^{-(|p - c_i|/0.014)^2} + 0.14\\, e^{-(|p - c_i|/0.055)^2} + \\text{rays}\\right) \\chi_i'],
        notes: [['c_i', 'the lens map’s cluster positions'], ['\\chi_i', 'per-star color']],
        description: 'Draw these AFTER lensing the background. Moving a background star image through this node would not model a foreground lens cluster.',
        emit: (i, u) => `clusterLights(${i.p},${u.gain},${u.count})`
    }),
    galaxy: component({
        name: 'Logarithmic spiral galaxy', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            arms: num('Spiral arms', 3, 1, 8, 1, 'm', 'Number of spiral arms.'),
            pitch: num('Winding', 7, 0.5, 15, 0.1, 'k', 'How tightly the arms wind: higher values wrap them around the center more times.'),
            radius: num('Scale', 0.75, 0.1, 2, 0.01, 's', 'Overall size of the galaxy.'),
            dust: num('Dust lanes', 0.6, 0, 1, 0.01, '\\delta', 'Strength of the dark dust lanes across the disk.'),
            speed: num('Phase speed', 0.2, -2, 2, 0.01, '\\omega', 'Rotation of the arm pattern over time.')
        },
        equation: 'phase = arms·theta − pitch·log(r+0.1)',
        tex: [
            '\\phi = m\\, \\theta - k \\log(r/s + 0.1) - 0.1\\, \\omega t, \\quad \\text{arm} = \\left(\\frac{1}{2} + \\frac{1}{2}\\cos(\\phi + \\text{noise})\\right)^8',
            'I = C(r)\\,(0.17 + \\text{arm})\\, e^{-1.65\\, r/s}\\,(1 - \\delta\\, \\text{lanes}) + \\text{bulge} + \\text{knots}'
        ],
        notes: [['r, \\theta', 'polar coordinates of the tilted, flattened p']],
        description: 'New analytic spiral arms, Gaussian-like central bulge, radial fade, dusty modulation and emission knots. Its input coordinates can be gravitationally warped.',
        emit: (i, u) => `spiralGalaxy(${i.p},${u.arms},${u.pitch},${u.radius},${u.dust},u_time*${u.speed})`
    }),
    aurora: component({
        name: 'Spiral auroral curtain', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            turns: num('Winding', 4, 0.5, 12, 0.1, 'k', 'How tightly the ribbon spirals around its center.'),
            width: num('Ribbon width', 0.115, 0.01, 0.4, 0.005, 'w', 'Thickness of the bright ribbon, in phase units.'),
            curtain: num('Fine rays', 1, 0, 3, 0.01, 'c', 'Strength of the thin radial rays within the ribbon; 0 gives a smooth ribbon.'),
            speed: num('Flow speed', 0.5, -2, 2, 0.01, '\\omega', 'How fast the spiral and its rays move.')
        },
        equation: 'ribbon = exp(−[sin(theta + turns·log(r+0.12))/width]²)',
        tex: [
            '\\phi = \\theta + k \\log(r + 0.12) + 0.18\\, \\omega t + \\text{noise}, \\quad B = e^{-(\\sin\\phi / w)^2}(1 - e^{-8r})\\, e^{-0.7 r}',
            'F = 0.28 + 0.72\\left(\\frac{1}{2} + \\frac{1}{2}\\sin(175\\,\\theta + \\ldots)\\right)^2, \\quad I = (0.05, 0.86, 0.22)\\, B\\,(0.4 + c F) + \\text{fringe}'
        ],
        notes: [['r, \\theta', 'polar coordinates around the spiral center']],
        description: 'New projected spiral ribbon with green/purple emission and angular striations. It illustrates appearance, not an auroral plasma simulation.',
        emit: (i, u) => `auroraVortex(${i.p},${u.turns},${u.width},${u.curtain},u_time*${u.speed})`
    }),
    disk: component({
        name: 'Accretion disk & shadow', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            radius: num('Shadow scale', 0.34, 0.06, 0.8, 0.005, '\\rho', 'Size of the black-hole shadow; the disk and arc scale with it.'),
            inclination: num('Projection flattening', 3, 1, 7, 0.05, '\\iota', 'How edge-on the disk appears: 1 is face-on, higher values flatter.'),
            spin: num('Texture winding', 4, 0, 12, 0.1, '\\tau', 'How much the disk’s ring texture spirals.'),
            speed: num('Flow speed', 0.5, -2, 2, 0.01, '\\omega', 'Speed of the swirling texture.')
        },
        equation: 'projected annulus + bent rear arc − central shadow',
        tex: [
            'r = \\sqrt{x_r^2 + (\\iota\\, y_r)^2}, \\quad E = e^{-((r - 1.65\\rho)/0.65\\rho)^2}',
            '\\text{rings} = \\frac{1}{2} + \\frac{1}{2}\\sin\\left(90 r + 4\\sin(3\\theta + \\tau\\log(r + 0.1) - 0.8\\, \\omega t)\\right), \\quad \\text{shadow: } |p| < 0.9\\rho'
        ],
        notes: [['x_r, y_r', 'p rotated by −0.28 rad'], ['\\theta', 'angle in the flattened disk plane']],
        description: 'New stylized construction. The bright-side weighting and bent arc are artistic terms, not a relativistic transfer calculation.',
        emit: (i, u) => `accretionDisk(${i.p},${u.radius},${u.inclination},${u.spin},u_time*${u.speed})`
    }),
    tidal: component({
        name: 'Stretched star & tidal stream', category: 'Astronomical studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            stretch: num('Taper power', 2.5, 0.3, 6, 0.05, 'a', 'How quickly the stream widens toward the star; higher values keep it thin for longer.'),
            size: num('Star width', 0.13, 0.02, 0.4, 0.005, '\\sigma', 'Size of the disrupted star and the stream’s maximum width.'),
            speed: num('Stream speed', 0.5, -2, 2, 0.01, '\\omega', 'Speed of the wiggle and fibers along the stream.')
        },
        equation: 'emission = Gaussian(distance to tapered centerline) + star core',
        tex: [
            'u = \\operatorname{clamp}\\left(\\frac{x + 0.05}{1.65}, 0, 1\\right), \\quad y_c = 0.14 + 0.4 u^2 + 0.05 \\sin(5u - 0.25\\, \\omega t)',
            'w = \\operatorname{mix}(0.015,\\ \\sigma,\\ u^{a}), \\quad I = e^{-((y - y_c)/w)^2}\\, \\text{fibers} + 2.4\\, e^{-(|p - p_\\star|/\\sigma)^2} + \\text{glow}'
        ],
        notes: [['p_\\star', 'position of the star at the stream’s end']],
        description: 'New narrow curved stream broadening toward a luminous star. Independent from the disk so it can be translated, masked or reused as a comet.',
        emit: (i, u) => `tidalStream(${i.p},${u.stretch},${u.size},u_time*${u.speed})`
    }),
    feather: component({
        name: 'Single eyespot feather', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            width: num('Width', 0.095, 0.02, 0.3, 0.005, 'w_0', 'Maximum half-width of the feather vane.'),
            eye: num('Eyespot scale', 1, 0.3, 2, 0.01, 's', 'Size of the eyespot rings near the tip.'),
            speed: num('Barb motion', 0.2, 0, 2, 0.01, '\\omega', 'Speed of the shimmering barb pattern.')
        },
        equation: 'tapered local silhouette + oblique cosine barbs + nested eyespot rings',
        tex: [
            'w(v) = w_0 \\sin(\\pi v)^{0.55}, \\quad \\text{coverage} = [\\,|x| < w(v)\\,]',
            '\\text{barbs} = 0.25 + 0.75\\left(\\frac{1}{2} + \\frac{1}{2}\\cos(250(v + 1.3|x|) + 0.4 \\sin \\omega t)\\right)^3',
            'e = \\sqrt{\\left(\\frac{x}{0.76\\, w_0 s}\\right)^2 + \\left(\\frac{v - 0.79}{0.107\\, s}\\right)^2} \\quad \\text{(eyespot rings at fixed } e\\text{)}'
        ],
        notes: [['p = (x, v)', 'local coordinates: base at v = 0, tip at v = 1']],
        description: 'Reusable analytic stamp. Base at (0,0), tip at (0,1). No texture. The fan node instances this exact kernel many times.',
        emit: (i, u) => `feather(${i.p},${u.width},${u.eye},u_time*${u.speed})`
    }),
    fan: component({
        name: 'Peacock feather fan', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            spread: num('Fan spread', 2.9, 0.4, 3.5, 0.01, '\\Delta', 'Total opening angle of the fan in radians (3.14 is a half circle).'),
            rows: num('Feather rows', 4, 1, 4, 1, 'N', 'Number of feather rows, outermost first (23, 20, 17 and 14 feathers).'),
            width: num('Feather width', 0.095, 0.03, 0.2, 0.005, 'w', 'Width of each feather.'),
            speed: num('Breeze speed', 0.3, 0, 2, 0.01, '\\omega', 'Speed of the gentle swaying.')
        },
        equation: 'fan = Overᵢ feather(Rᵢ(p−base)/lengthᵢ)',
        tex: [
            'F = \\mathrm{Over}_{r=0}^{N-1}\\ \\mathrm{Over}_{i}\\ \\operatorname{feather}\\left(\\frac{R(a_{ri})\\,(p - b)}{\\ell_r};\\ w\\right)',
            'a_{ri} = \\left(\\frac{i}{n_r - 1} - \\frac{1}{2}\\right)\\Delta + 0.015\\sin(1.8\\, i + 0.45\\, \\omega t), \\quad \\ell_r = 2.12 - 0.26\\, r'
        ],
        notes: [['b', 'common base point'], ['n_r', 'feathers in row r']],
        description: 'New full-display construction, not a recovered 2026 formula. Outer-to-inner rows, shared feather kernels and staggered phase give repeated yet varied detail.',
        emit: (i, u) => `peacockFan(${i.p},${u.spread},${u.rows},${u.width},u_time*${u.speed})`
    }),
    peacockBody: component({
        name: 'Peacock body & crest', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: { size: num('Size', 1, 0.3, 2, 0.01, 's', 'Overall size of the body, neck, head and crest.') },
        equation: 'body ellipses + curved neck + head + crest segments',
        tex: ['q = p / s, \\quad \\text{coverage} = \\max(\\text{body},\\ \\text{neck},\\ \\text{head},\\ \\text{beak},\\ \\text{crest})(q)'],
        description: 'A separate opaque silhouette over the feather fan, so changing the fan does not distort the bird.',
        emit: (i, u) => `peacockBody(${i.p},${u.size})`
    }),
    fire: component({
        name: 'Tapered flame field', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            height: num('Height', 2, 0.2, 3, 0.01, 'h', 'Height of the flame envelope.'),
            width: num('Base width', 0.8, 0.1, 2, 0.01, 'b', 'Width of the flame at its base.'),
            turbulence: num('Turbulence', 1, 0, 2, 0.01, '\\tau', 'How much noise tears the envelope into tongues; 0 gives a smooth teardrop.'),
            speed: num('Rise speed', 1, 0, 3, 0.01, '\\omega', 'How fast the flame pattern rises.')
        },
        equation: 'tapered silhouette + advected noise + heat palette',
        tex: [
            'q = \\left(\\frac{x}{b},\\ \\frac{y + 1.05}{h}\\right), \\quad u = \\operatorname{warp}_{0.75\\tau}\\left(2 q_x,\\ 3.8\\, q_y - 0.3\\, \\omega t\\right)',
            '\\text{flame} = 1 - \\operatorname{smoothstep}\\left(-0.13,\\ 0.13,\\ |q_x| - 0.7(1 - q_y)^{0.63} - 0.65\\,\\tau\\,\\left(n(u) - \\frac{1}{2}\\right)\\right)'
        ],
        notes: [['n(u)', 'fractal noise of the upward-advected coordinate'], ['\\text{heat}', 'flame × height falloff, mapped red → yellow → white']],
        description: 'New explanatory fire study. Moving the sampling coordinates creates upward flow without storing a simulation state. Not a reconstruction of the linked video.',
        emit: (i, u) => `firePlume(${i.p},${u.height},${u.width},${u.turbulence},u_time*${u.speed})`
    }),
    hedgehog: component({
        name: 'Hedgehog & quill field', category: 'Natural studies', output: 'layer', inputs: { p: 'coord' },
        params: {
            quills: num('Quill length', 0.28, 0.02, 0.7, 0.01, 'L', 'Length of the quills.'),
            density: num('Quill count', 160, 10, 160, 1, 'N', 'Number of quills drawn (up to 160).'),
            speed: num('Breathing speed', 0.5, 0, 2, 0.01, '\\omega', 'Speed of the subtle breathing motion.')
        },
        equation: 'elliptical body + repeated tapered segment quills + facial masks',
        tex: [
            '\\text{body} = [\\,|q/(0.91, 0.59)| < 1\\,], \\quad q = (p - c)\\,/\\,(1,\\ 1 + 0.007 \\sin(1.8\\, \\omega t))',
            '\\text{quill}_i = e^{-(d_i/0.007(1.1 - 0.8 u_i))^2}, \\quad |\\text{quill}_i| = L\\,(0.65 + 0.35\\, h_i), \\quad i < N'
        ],
        notes: [['d_i, u_i', 'distance to quill i and position along it'], ['h_i', 'hashed per-quill variation']],
        description: 'New constructive hedgehog example. Separate local stamps supply a readable silhouette and repeated surface detail; no claim about the inaccessible video steps.',
        emit: (i, u) => `hedgehog(${i.p},${u.quills},${u.density},u_time*${u.speed})`
    })
};
export const typeNames = { coord: 'Coordinates · vec2', scalar: 'Scalar field · float', geometry: 'Geometry · S/A/coverage', layer: 'Radiance + alpha · vec4' };
export const typeLabels = { coord: 'coordinates', scalar: 'scalar field', geometry: 'geometry', layer: 'color layer' };
export const zeroByType = { coord: 'vec2(0)', scalar: '0.0', geometry: 'Geometry(0.0,0.0,0.0)', layer: 'vec4(0)' };
export function parameterDefaults(type) {
    if (!Object.hasOwn(catalog, type)) {
        throw new Error(`Unknown component: ${type}`);
    }
    return Object.fromEntries(Object.entries(catalog[type].params).map(([key, spec]) => [key, spec.value]));
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
