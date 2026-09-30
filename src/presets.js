import { makeNode, clone, validateProject } from './graph.js';
import { works, P5_CANVAS } from './works.js';
const N = makeNode;
/** A node with its own label (custom equations otherwise show their component name). */
const named = (label, node) => ({ ...node, label });
/** Kaleidoscope garden's two equations, written with parameters, definitions and
 * captions to show the equation language (same image as the 1.x one-liners).
 */
const PETALS = [
    '// Interference petals: bands whose phase is bent by a second wave',
    'param bands = 14 [1, 40] step 0.1       // frequency of the bands across x: more, thinner petals',
    'param bend = 9 [0, 30] step 0.1         // frequency of the wave that bends the bands, along y',
    'param sharpness = 4 [1, 12] step 0.1    // exponent: higher values keep only the crests',
    'wave = 0.5 + 0.5*cos(bands*x + sin(bend*y - t))   // bands from 0 to 1, bent by a sine that drifts with time',
    'wave^sharpness   // a power sharpens each band into a thin petal'
].join('\n');
const RAINBOW = [
    '// Rainbow petals that fade away from the center',
    'param hueScale = 0.3 [0, 2] step 0.01   // how quickly the hue cycles with distance from the center',
    'param drift = 0.05 [-1, 1] step 0.01    // how quickly the colors flow outward over time',
    'param falloff = 0.22 [0, 2] step 0.01   // how quickly the image fades with distance',
    'hue = spectrum(hueScale*r - drift*t, 0.25)   // a rainbow color for each distance r',
    'hue * a * exp(-falloff*r^2)   // the petals a, colored, under a Gaussian fade'
].join('\n');
const base = (id, title, description, status, nodes, output, options = {}) => ({ id, title, description, status, schemaVersion: 1, nodes, output, duration: 8, exposure: 1, tone: 'filmic', view: { x: 0, y: 0, zoom: 1 }, tracks: [], ...options });
function sourceNodes(geometry = 'nebulaGeometry') {
    return [N('coordinates', 'space'), N(geometry, 'shell', { p: 'space' }), N('nebulaTurbulence', 'turbulence', { p: 'space', geometry: 'shell' }), N('nebulaCloud', 'cloud', { p: 'space', geometry: 'shell', turbulence: 'turbulence' }), N('nebulaGas', 'gas', { p: 'space', geometry: 'shell', turbulence: 'turbulence', cloud: 'cloud' }), N('nebulaCore', 'core', { p: 'space', turbulence: 'turbulence' }), N('nebulaStars', 'stars', { p: 'space' }), N('add', 'gascore', { a: 'gas', b: 'core' }), N('add', 'final', { a: 'gascore', b: 'stars' })];
}
export const presets = [
    base('bipolar', 'Bipolar nebula', 'Hamid Naderi Yeganeh’s nebula equations, split into the nine parts that build its lobes, threads and stars.', 'Source-equation port', sourceNodes(), 'final', { tone: 'source' }),
    base('water', 'Stormy water planet', 'A blue ocean planet with swirling storm clouds and a thin glowing atmosphere, floating in front of the stars.', 'Interpretive study', [
        N('coordinates', 'space'), N('scatterStars', 'stars', { p: 'space' }, { gain: 0.36 }), N('planet', 'planet', { p: 'space' }), N('over', 'planetOverStars', { front: 'planet', back: 'stars' }), N('atmosphere', 'limb', { p: 'space' }), N('add', 'final', { a: 'planetOverStars', b: 'limb' })
    ], 'final', { exposure: 1.5 }),
    base('lensing', 'Galaxy behind a star cluster', 'A spiral galaxy bent into glowing arcs by the gravity of a star cluster in front of it.', 'Interpretive study', [
        N('coordinates', 'space'), N('scatterStars', 'stars', { p: 'space' }, { gain: 0.32 }), N('lens', 'lens', { p: 'space' }, { strength: 1.45 }), N('transform', 'sourcePosition', { p: 'lens' }, { x: 0.14, y: 0.065, scale: 0.63 }), N('galaxy', 'galaxy', { p: 'sourcePosition' }, { radius: 0.66 }), N('clusterLights', 'cluster', { p: 'space' }), N('add', 'backdrop', { a: 'stars', b: 'galaxy' }), N('add', 'final', { a: 'backdrop', b: 'cluster' })
    ], 'final', { exposure: 2.1 }),
    base('aurora', 'Spiral aurora', 'A green ribbon of light spirals out over the stars, streaked with fine rays like an aurora.', 'Interpretive study', [
        N('coordinates', 'space'), N('scatterStars', 'stars', { p: 'space' }, { gain: 0.35 }), N('aurora', 'curtain', { p: 'space' }), N('add', 'final', { a: 'stars', b: 'curtain' })
    ], 'final', { exposure: 1.4 }),
    base('tidal', 'Tidal disruption', 'A drawing, not a simulation, of a black hole with a glowing disk tearing gas from a star.', 'Interpretive study', [
        N('coordinates', 'space'), N('scatterStars', 'stars', { p: 'space' }, { gain: 0.40 }), N('disk', 'disk', { p: 'space' }), N('tidal', 'stream', { p: 'space' }), N('add', 'emission', { a: 'disk', b: 'stream' }), N('disc', 'shadowMask', { p: 'space' }, { radius: 0.285, edge: 0.007 }), named('Outside the shadow', N('expression', 'outsideShadow', { p: 'space', a: 'shadowMask' }, { expression: '1 - a   // 1 outside the black hole’s shadow disc, 0 inside' })), N('mask', 'maskedStars', { layer: 'stars', mask: 'outsideShadow' }), N('solid', 'black', {}, { color: '#000000' }), N('over', 'background', { front: 'maskedStars', back: 'black' }), N('add', 'final', { a: 'background', b: 'emission' })
    ], 'final', { exposure: 1.4 }),
    base('peacock', 'Peacock in full display', 'One feather equation, stamped 74 times in four rows, makes the fan behind a peacock’s blue body.', 'Interpretive study', [
        N('coordinates', 'space'), N('solid', 'background', {}, { color: '#010305' }), N('fan', 'fan', { p: 'space' }), N('over', 'tail', { front: 'fan', back: 'background' }), N('peacockBody', 'body', { p: 'space' }), N('over', 'final', { front: 'body', back: 'tail' })
    ], 'final', { exposure: 1.7 }),
    base('fire', 'Fire · construction study', 'A teardrop shape, torn into rising tongues by drifting noise and colored by heat, makes a flickering flame.', 'Original tutorial study', [
        N('coordinates', 'space'), N('fire', 'flame', { p: 'space' })
    ], 'flame', { exposure: 1.1 }),
    base('hedgehog', 'Hedgehog · construction study', 'A hedgehog built in layers: an oval body, 160 quills, and then a head, eye, nose and feet.', 'Original tutorial study', [
        N('coordinates', 'space'), N('solid', 'background', {}, { color: '#040408' }), N('hedgehog', 'animal', { p: 'space' }), N('over', 'final', { front: 'animal', back: 'background' })
    ], 'final', { exposure: 1.6 }),
    base('ring', 'Filament ring', 'The bipolar nebula with only its shape part swapped for an oval ring, and every other part reused.', 'Component remix', sourceNodes('ringGeometry'), 'final', { tone: 'source' }),
    base('marble', 'Living mineral', 'Wavy stripes pushed around by a slow wobble look like polished marble, made from just four parts.', 'Component remix', [
        N('coordinates', 'space'), N('domainwarp', 'warp', { p: 'space' }, { amplitude: 0.8, frequency: 2.1, speed: 0.12 }), N('waves', 'veins', { p: 'warp' }, { frequency: 10, bend: 2.8, speed: 0.8 }), N('palette', 'final', { field: 'veins' }, { low: '#081927', high: '#d09c55', power: 3, gain: 1.2 })
    ], 'final'),
    base('kaleidoscope', 'Kaleidoscope garden', 'Two short equations you can edit, a petal pattern and a rainbow, repeated in eight mirrored wedges.', 'Component remix', [
        N('coordinates', 'space'), N('kaleidoscope', 'fold', { p: 'space' }, { sectors: 8 }), N('domainwarp', 'warp', { p: 'fold' }, { amplitude: 0.28 }), named('Interference petals', N('expression', 'petals', { p: 'warp' }, { expression: PETALS })), named('Rainbow color', N('colorExpression', 'final', { p: 'space', a: 'petals' }, { expression: RAINBOW }))
    ], 'final', { exposure: 1.6 }),
    base('feather', 'One feather, many possibilities', 'The single peacock feather that the fan repeats 74 times, on its own, ready to move, turn or resize.', 'Component study', [
        N('coordinates', 'space'), N('solid', 'background', {}, { color: '#010305' }), N('transform', 'local', { p: 'space' }, { x: 0, y: -1.08, scale: 2.1 }), N('feather', 'feather', { p: 'local' }, { width: 0.19 }), N('over', 'final', { front: 'feather', back: 'background' })
    ], 'final', { exposure: 1.8 })
];
/** What the scene panel tells about each construction (a work's scene takes this from
 * works.js): `about`, a paragraph for a curious reader of about thirteen (what you see
 * first, then how the parts make it); `level`, 'easy', 'medium' or 'expert' (the gallery
 * badge); `try`, "Try this" challenges: {text, and one action}, each undoable in one step:
 *   set: {node, param, value} or {node, param, times}   change a setting (times multiplies it)
 *   code: {node, find, replace}   edit the text of an equation part (the first occurrence)
 *   view: 'motion'   color only what moves;  view: 'stage', node   show just that part
 *   hide: node   switch that part off, to see what it adds
 * These guides are not part of the project data: a saved project with the same id shows them too.
 */
export const guides = {
    bipolar: {
        level: 'expert',
        about: 'This nebula, two glowing lobes pinched in the middle like an hourglass, comes straight from the equations of the artist Hamid Naderi Yeganeh. After every pixel gets its position, the shape part draws 27 thin, leaning outlines squeezed at the waist, and for every pixel it finds the first outline in front of it, like the top sheet in a stack of tracing paper. The turbulence part adds up 50 waves into a rough, rippled pattern that later ruffles the threads and the edge of the central glow. The cloud part adds up 50 more waves, turns their tops into thin glowing threads (filaments) and adds a soft colored haze. The gas part lets that light shine only along the rims of the outlines and clears the very center, where the core part puts a bluish-white glow. The stars come from 30 grids of mirrored tiles, each turned and sized differently, with a pointed star at the center of every tile. Two last parts add up the light of the gas, the core and the stars.',
        try: [
            { text: 'Switch the stars off and look at the glowing gas on its own.', hide: 'stars' },
            { text: 'Pinch the waist harder: set the neck pinch to 0.6. Watch the middle of the nebula get narrower.', set: { node: 'shell', param: 'pinch', value: 0.6 } },
            { text: 'Keep only the first 5 of the 27 outlines. With fewer outlines overlapping, the nebula gets simpler.', set: { node: 'shell', param: 'shells', value: 5 } },
            { text: 'Turn off the sharp threads by setting their gain to 0. Only the soft haze is left.', set: { node: 'cloud', param: 'detail', value: 0 } },
            { text: 'This nebula is a still picture. Give the turbulence a speed of 0.3 and play the timeline to watch the threads shift and flicker.', set: { node: 'turbulence', param: 'speed', value: 0.3 } }
        ]
    },
    water: {
        level: 'medium',
        about: 'A blue ocean world wrapped in swirling white storms floats in front of the stars, lit by a sun on the left. After every pixel gets its position, the star part splits the sky into small cells and uses a hash, a dice roll that always gives the same answer for the same cell, to decide which cells hold a star and how bright it is. The planet part treats a disc as the front half of a ball, so it knows which way each point of the surface faces and how much sunlight falls on it. Its clouds come from noise, a pattern of smooth, random-looking bumps, which seven small whirlpools twist into cyclones and which drifts slowly over time. The next part lays the planet over the stars, so that no star shines through its dark side. Last, the atmosphere part draws a thin blue glow at the edge of the planet, and one more part adds that glow to the picture. This is our own study of the subject, and nothing in it simulates real weather.',
        try: [
            { text: 'Clear the skies: set the cloud cover to 0. You will see mostly ocean, with the sun glinting on the water.', set: { node: 'planet', param: 'cloud', value: 0 } },
            { text: 'Wind up the storms: set the cyclone twist to 14 and watch the clouds curl into tight spirals.', set: { node: 'planet', param: 'twist', value: 14 } },
            { text: 'Move the sun behind the planet: set the light angle to 4. Only a thin crescent at the edge stays lit.', set: { node: 'planet', param: 'light', value: 4 } },
            { text: 'Shrink the planet to a radius of 0.7. The blue ring of air stays where it was, because it is a separate part with its own radius.', set: { node: 'planet', param: 'radius', value: 0.7 } }
        ]
    },
    lensing: {
        level: 'medium',
        about: 'Gravity bends light, so a spiral galaxy far behind a heavy cluster of stars appears smeared into glowing arcs. After every pixel gets its position and the star part scatters faint background stars, the lens part bends the positions, making each pixel look a little toward the heavy stars, most of all close to them. Anything drawn with these bent positions appears pushed away from the stars and stretched into arcs around them. The move part then shifts the galaxy slightly off-center and makes it smaller, and the galaxy part draws three spiral arms with dark dust lanes and a warm, bright middle. The cluster part draws the bright foreground stars from the unbent positions, right where the lens bends the light, and two adding parts put all the light together. The lens strength is animated, fading almost to nothing at 4 seconds and coming back, so you can watch the arcs relax into a plain spiral and bend again. Real gravity bends light like this, but the masses and positions here are made up for the picture.',
        try: [
            { text: 'Switch the lens off. The galaxy turns back into an ordinary spiral, while the cluster stars stay where they are.', hide: 'lens' },
            { text: 'Show just the lens part. Its grid lines show how the positions bend around each star.', view: 'stage', node: 'lens' },
            { text: 'Move the galaxy right behind the center of the cluster: set Center X of the move part to 0. Its bright middle is stretched almost all the way around into a ring.', set: { node: 'sourcePosition', param: 'x', value: 0 } },
            { text: 'Give the galaxy 6 spiral arms and see how every one of them is bent.', set: { node: 'galaxy', param: 'arms', value: 6 } }
        ]
    },
    aurora: {
        level: 'easy',
        about: 'A green ribbon of light winds out from the middle in a spiral, streaked with fine rays like the curtains of an aurora, the northern lights. After every pixel gets its position, the star part scatters stars over the sky. The curtain part measures each pixel’s angle around the center, like the hand of a clock, and its distance from the center, and mixes the two into one number. Lines where that number stays the same wind outward in a spiral, like the groove of a snail shell, and the ribbon glows along those lines, fading near the center and far away. A noise pattern of smooth, random-looking bumps makes the edges wobble, about 175 thin rays run outward across the ribbon, and a faint purple fringe runs along one side. One last part adds this light to the stars, and over time the spiral slowly turns and the rays drift. It is a picture of an aurora, not a simulation of the charged particles that make real ones.',
        try: [
            { text: 'Set the fine rays to 0. The streaks disappear and a smooth ribbon is left.', set: { node: 'curtain', param: 'curtain', value: 0 } },
            { text: 'Wind the spiral tighter: set the winding to 10. Count how many more times it wraps around the center.', set: { node: 'curtain', param: 'turns', value: 10 } },
            { text: 'Make the ribbon three times as wide, and it spreads into broad, glowing curtains.', set: { node: 'curtain', param: 'width', times: 3 } },
            { text: 'Make the aurora flow four times as fast, then play the timeline.', set: { node: 'curtain', param: 'speed', times: 4 } }
        ]
    },
    tidal: {
        level: 'medium',
        about: 'A black hole sits in the middle, ringed by a tilted, glowing disk of gas, while a thin stream torn from a bright star curves in from the right. After every pixel gets its position and the star part scatters background stars, the disk part draws a flat ring seen at a slant, with swirling stripes, one brighter side, a thin arc over the top and a black center. The stream part draws a curved band of light that starts very thin and widens toward the star at its end, and an adding part puts the disk and the stream together. The remaining parts keep the background stars out of the black hole, because black adds no light and would not hide them. A disc part marks the shadow, and a one-line equation, 1 − a, flips it, so that it is 1 outside the shadow and 0 inside. A mask part removes the stars wherever that number is 0, the stars are laid over a black background, and the last part adds the glowing disk and stream on top. This is a drawing, not a physics simulation, so the bright side and the arc are artistic choices rather than results of real gravity.',
        try: [
            { text: 'Switch the mask off. Stars now shine through the black hole, because adding black light hides nothing.', hide: 'maskedStars' },
            { text: 'Turn the disk to face you: set the projection flattening to 1. The flat oval opens into a round ring.', set: { node: 'disk', param: 'inclination', value: 1 } },
            { text: 'Make the star more than twice as big: set its width to 0.3. The end of the stream widens with it.', set: { node: 'stream', param: 'size', value: 0.3 } },
            { text: 'Set the texture winding to 12, and the stripes in the disk twist into tight spirals.', set: { node: 'disk', param: 'spin', value: 12 } }
        ]
    },
    peacock: {
        level: 'medium',
        about: 'A peacock shows off a huge fan of 74 feathers behind its blue body, and every feather carries a shining eyespot. After every pixel gets its position and a solid part paints a very dark background, the fan part stamps one and the same feather equation 74 times, like a rubber stamp. Each copy is turned to its own angle around a shared base, in four rows of 23, 20, 17 and 14 feathers, with the inner rows a little shorter. The rows are drawn from the outside in, so the inner feathers cover the outer ones, and every feather sways a little over time. The next part lays the whole fan over the background. The body part draws the bird’s body, neck, head, beak, eye and five-feathered crest from a few soft ovals and short lines, and a last part puts the bird in front of the fan. The feather and the bird are our own design.',
        try: [
            { text: 'Keep only the outer row: set the feather rows to 1. You can count its 23 feathers.', set: { node: 'fan', param: 'rows', value: 1 } },
            { text: 'Fold the fan partly closed: set its spread to 1.2.', set: { node: 'fan', param: 'spread', value: 1.2 } },
            { text: 'Make every feather twice as wide, so that they overlap like roof tiles.', set: { node: 'fan', param: 'width', times: 2 } },
            { text: 'Switch the body off to see the spot where all 74 feathers meet.', hide: 'body' }
        ]
    },
    fire: {
        level: 'easy',
        about: 'A single flame flickers and rises, white-hot in its heart and dark red at its ragged edges. It takes only two parts, because after every pixel gets its position, the flame part does all the rest. First it draws a smooth teardrop, wide at the bottom and narrowing to a point at the top. Then it tears the edge into tongues of flame with noise, a pattern of smooth, random-looking bumps. The flame reads the noise through a window that slides down a little every moment, so the bumps seem to rise, like the view from a glass elevator going down. A heat palette colors each point, from dark red where the flame is weak, through orange and yellow, to white where it is hottest, low in the middle. This is our own teaching example, and nothing in it simulates real burning.',
        try: [
            { text: 'Set the turbulence to 0. The tongues disappear and a smooth, swaying teardrop is left.', set: { node: 'flame', param: 'turbulence', value: 0 } },
            { text: 'Make a wide bonfire: set the base width to 1.6.', set: { node: 'flame', param: 'width', value: 1.6 } },
            { text: 'Make the flame rise three times as fast, then play the timeline.', set: { node: 'flame', param: 'speed', times: 3 } },
            { text: 'Color only what moves. The whole flame keeps changing, while the faint glow around it stays still.', view: 'motion' }
        ]
    },
    hedgehog: {
        level: 'easy',
        about: 'A hedgehog stands sideways, facing right, its round back bristling with spiky quills. After every pixel gets its position and a solid part paints a nearly black background, the hedgehog part builds the animal in layers, from back to front. The body is an oval filled with a fine, furry noise pattern of smooth, random-looking bumps, and it breathes very slightly over time. Then come 160 quills, each a thin line that tapers to a point, dark at the root and pale at the tip. A hash, a dice roll that always gives the same answer for the same quill, decides where each quill starts and how long it is, so the quills look random but never change. Last come a head, an ear, a shiny eye, a nose and two feet, each a simple oval or dot, and a final part puts the finished animal over the background. This hedgehog is our own teaching example.',
        try: [
            { text: 'Draw only 20 quills, so you can see each one on its own.', set: { node: 'animal', param: 'density', value: 20 } },
            { text: 'Grow the quills: set their length to 0.6.', set: { node: 'animal', param: 'quills', value: 0.6 } },
            { text: 'Now shrink the quills to 0.02. The hedgehog is almost bald, and its furry body was underneath all along.', set: { node: 'animal', param: 'quills', value: 0.02 } },
            { text: 'Paint the background deep blue. Only the background changes, because it is a separate part.', set: { node: 'background', param: 'color', value: '#0a1a40' } }
        ]
    },
    ring: {
        level: 'expert',
        about: 'This glowing oval of threads looks like a ring nebula, the shell of gas that a dying star blows off, but it is really the bipolar nebula with one part swapped. Only the shape part is new, and instead of 27 pinched outlines it draws a single ring, a circle squashed from top to bottom into an oval. It hands on the same two numbers as the original shape part, a number that follows the shape of the ring and a glow along its rim, so every later part works with it unchanged. The turbulence and cloud parts lay their 50 waves each along the ring and turn them into thin threads in a soft haze, and the gas part lets that light shine only on the rim. The core part adds the same bluish-white glow in the center, the stars come from the same 30 grids of mirrored tiles, and two last parts add up all the light. The ring shape is our own, and all the other parts are the nebula equations of the artist Hamid Naderi Yeganeh, reused exactly. Swapping one part like this is a quick way to invent a new picture from old equations.',
        try: [
            { text: 'Make the ring a perfect circle: set the vertical compression to 1.', set: { node: 'shell', param: 'flatten', value: 1 } },
            { text: 'Make the rim three times as thick, and watch the threads fill the wider band.', set: { node: 'shell', param: 'width', times: 3 } },
            { text: 'Switch the central glow off. The middle goes dark, because the gas only shines along the rim.', hide: 'core' },
            { text: 'The ring is a still picture. Give the turbulence a speed of 0.3 and play the timeline to watch the threads shift and flicker.', set: { node: 'turbulence', param: 'speed', value: 0.3 } }
        ]
    },
    marble: {
        level: 'easy',
        about: 'This picture looks like polished marble or a slice of agate, but it is made in four small steps. First, every pixel gets its position on the picture. Then those positions are pushed around by a smooth, slowly changing wobble, the warp, so that straight lines become wavy. Next, a pattern of stripes is drawn at the pushed positions, which bends the stripes into veins. Last, a palette turns each stripe value, a number between 0 and 1, into a color between deep blue and gold. The wobble and the bend of the stripes both change slowly over time, so the marble seems to flow.',
        try: [
            { text: 'Switch the warp off. The veins turn back into plain stripes.', hide: 'warp' },
            { text: 'Push the wobble twice as far.', set: { node: 'warp', param: 'amplitude', times: 2 } },
            { text: 'Draw more stripes: set their frequency to 25.', set: { node: 'veins', param: 'frequency', value: 25 } },
            { text: 'Make the gold color bright red.', set: { node: 'final', param: 'high', value: '#ff3030' } }
        ]
    },
    kaleidoscope: {
        level: 'medium',
        about: 'A rainbow flower of thin petals turns slowly in eight mirrored wedges, like the view inside a kaleidoscope. After every pixel gets its position, the mirror part takes its angle around the center, like the hand of a clock, and folds it into one wedge, so everything drawn later repeats in every wedge with mirror symmetry. The warp part then pushes the folded positions around with a smooth, slowly changing wobble, which makes the petals wavy and uneven. The petals come from a short equation that draws stripes, bends them with a second wave and raises them to the power 4 (wave × wave × wave × wave). Numbers below 1 shrink when they are multiplied by themselves, the small ones fastest, so only the thin bright crests of the stripes survive. The color is a second equation that picks a rainbow color by distance from the center, lets the colors flow outward over time and fades everything toward the edges. Both equations have sliders for their numbers and a comment on every line, so you can change a number or rewrite a line and watch the result.',
        try: [
            { text: 'Fold the picture into 3 wedges instead of 8.', set: { node: 'fold', param: 'sectors', value: 3 } },
            { text: 'Switch the warp off. The wavy petals become smooth and perfectly regular.', hide: 'warp' },
            { text: 'Raise the sharpness of the petals to 12. Only the very tops of the crests stay bright, so the petals get thinner.', set: { node: 'petals', param: 'sharpness', value: 12 } },
            { text: 'In the petals equation, change bands*x to bands*r, where r is the distance from the center. The stripes curl into rings.', code: { node: 'petals', find: 'cos(bands*x', replace: 'cos(bands*r' } },
            { text: 'Make the colors flow outward ten times as fast, then play the timeline.', set: { node: 'final', param: 'drift', times: 10 } }
        ]
    },
    feather: {
        level: 'easy',
        about: 'One peacock feather stands upright, with fine green barbs and a shining eyespot near its tip. The peacock scene uses this same feather equation 74 times to build its fan, and here you can study one copy on its own. The feather part draws the feather in its own little world, with its base at (0, 0) and its tip at (0, 1). So the move part in front of it places the base near the bottom of the picture and makes everything 2.1 times bigger. Inside the feather part, the outline is widest in the middle and closes at both ends, and slanted stripes on each side of the shaft make the barbs. Near the tip, rings around an oval center paint the eyespot, from a bronze rim through turquoise and blue to a dark pupil. A last part lays the feather over a very dark background, and the barbs shimmer slightly over time.',
        try: [
            { text: 'Make the eyespot twice as big: set its scale to 2.', set: { node: 'feather', param: 'eye', value: 2 } },
            { text: 'Tilt the feather: set the rotation of the move part to 0.8 (a full turn is 6.28). It swings around its base, like the hand of a clock going backward.', set: { node: 'local', param: 'angle', value: 0.8 } },
            { text: 'Make the feather thin: set its width to 0.05. The eyespot narrows with it.', set: { node: 'feather', param: 'width', value: 0.05 } },
            { text: 'Show just the move part. The grid is the feather’s own little world: a red line runs up the shaft and a green line marks its base.', view: 'stage', node: 'local' }
        ]
    }
};
/** The scene of a work (works.js): its readable code in a Shader code component,
 * or its point formula in a Point cloud over the sketch's background. Colors are
 * shown as the code computes them (linear output, exposure 1), in the clip's
 * aspect ratio.
 */
function workScene(w) {
    const options = { tone: 'linear', exposure: 1, aspect: w.video.width / w.video.height, duration: w.duration, work: w.id, thumbTime: w.thumbTime ?? 1.3 };
    const status = w.platform === 'study' ? 'Interpretive study' : 'Reproduction · original code';
    const description = `${w.summary.split('. ')[0]}. By ${w.author} (@${w.handle}).`;
    // The component carries the work's id, so its credit and explanation travel with it into other scenes.
    if (w.platform === 'p5') {
        const cloud = { ...named(w.title, N('points', 'cloud', { p: 'space' }, { expression: w.readable, canvas: P5_CANVAS, size: 1, color: '#ffffff', ...w.points })), work: w.id };
        return base(w.id, w.title, description, status, [N('coordinates', 'space'), N('solid', 'background', {}, { color: '#090909' }), cloud, N('over', 'final', { front: 'cloud', back: 'background' })], 'final', options);
    }
    const shader = { ...named(w.title, N('code', 'shader', { p: 'space' }, { code: w.readable })), work: w.id };
    return base(w.id, w.title, description, status, [N('coordinates', 'space'), shader], 'shader', options);
}
presets.push(...works.map(workScene));
// A saved keyframe track demonstrates the animation model without changing t=0.
presets.find(p => p.id === 'lensing').tracks = [{ node: 'lens', param: 'strength', interpolation: 'smooth', keys: [{ time: 0, value: 1.45 }, { time: 4, value: 0.05 }, { time: 8, value: 1.45 }] }];
for (const p of presets) {
    validateProject(p);
}
export function getPreset(id) {
    const p = presets.find(p => p.id === id);
    if (!p) {
        throw new Error(`Unknown preset ${id}`);
    }
    return clone(p);
}
