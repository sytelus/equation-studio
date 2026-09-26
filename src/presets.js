import { makeNode, clone, validateProject } from './graph.js';
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
    base('bipolar', 'Bipolar nebula', 'The supplied equations, decomposed into their original fields. GPU float32 port; use the included Python oracle for float64 output.', 'Source-equation port', sourceNodes(), 'final', { tone: 'source' }),
    base('water', 'Stormy water planet', 'A visible sphere, several cyclone coordinate maps, multiscale clouds, ocean light and an independent atmosphere.', 'Interpretive study', [
        N('coordinates', 'space'), N('scatterStars', 'stars', { p: 'space' }, { gain: 0.36 }), N('planet', 'planet', { p: 'space' }), N('over', 'planetOverStars', { front: 'planet', back: 'stars' }), N('atmosphere', 'limb', { p: 'space' }), N('add', 'final', { a: 'planetOverStars', b: 'limb' })
    ], 'final', { exposure: 1.5 }),
    base('lensing', 'Galaxy behind a star cluster', 'Backward-map the background galaxy through a softened lens field. Foreground stars remain in the observer plane.', 'Interpretive study', [
        N('coordinates', 'space'), N('scatterStars', 'stars', { p: 'space' }, { gain: 0.32 }), N('lens', 'lens', { p: 'space' }, { strength: 1.45 }), N('transform', 'sourcePosition', { p: 'lens' }, { x: 0.14, y: 0.065, scale: 0.63 }), N('galaxy', 'galaxy', { p: 'sourcePosition' }, { radius: 0.66 }), N('clusterLights', 'cluster', { p: 'space' }), N('add', 'backdrop', { a: 'stars', b: 'galaxy' }), N('add', 'final', { a: 'backdrop', b: 'cluster' })
    ], 'final', { exposure: 2.1 }),
    base('aurora', 'Spiral aurora', 'Logarithmic polar winding, a narrow luminous ribbon and hundreds of fine angular rays.', 'Interpretive study', [
        N('coordinates', 'space'), N('scatterStars', 'stars', { p: 'space' }, { gain: 0.35 }), N('aurora', 'curtain', { p: 'space' }), N('add', 'final', { a: 'stars', b: 'curtain' })
    ], 'final', { exposure: 1.4 }),
    base('tidal', 'Tidal disruption', 'A tapered stellar stream, a projected accretion disk and an illustrative central shadow. Not a physical simulation.', 'Interpretive study', [
        N('coordinates', 'space'), N('scatterStars', 'stars', { p: 'space' }, { gain: 0.40 }), N('disk', 'disk', { p: 'space' }), N('tidal', 'stream', { p: 'space' }), N('add', 'emission', { a: 'disk', b: 'stream' }), N('disc', 'shadowMask', { p: 'space' }, { radius: 0.285, edge: 0.007 }), named('Outside the shadow', N('expression', 'outsideShadow', { p: 'space', a: 'shadowMask' }, { expression: '1 - a   // 1 outside the black hole’s shadow disc, 0 inside' })), N('mask', 'maskedStars', { layer: 'stars', mask: 'outsideShadow' }), N('solid', 'black', {}, { color: '#000000' }), N('over', 'background', { front: 'maskedStars', back: 'black' }), N('add', 'final', { a: 'background', b: 'emission' })
    ], 'final', { exposure: 1.4 }),
    base('peacock', 'Peacock in full display', 'One eyespot-feather kernel instanced across four fan rows, with an independent body, crest and background.', 'Interpretive study', [
        N('coordinates', 'space'), N('solid', 'background', {}, { color: '#010305' }), N('fan', 'fan', { p: 'space' }), N('over', 'tail', { front: 'fan', back: 'background' }), N('peacockBody', 'body', { p: 'space' }), N('over', 'final', { front: 'body', back: 'tail' })
    ], 'final', { exposure: 1.7 }),
    base('fire', 'Fire · construction study', 'A tapered envelope, upward-moving coordinate noise, wispy thresholds and a hot emission palette. Not a video transcription.', 'Original tutorial study', [
        N('coordinates', 'space'), N('fire', 'flame', { p: 'space' })
    ], 'flame', { exposure: 1.1 }),
    base('hedgehog', 'Hedgehog · construction study', 'Layered analytic shapes and a deterministic quill field. Not a reconstruction of the linked video.', 'Original tutorial study', [
        N('coordinates', 'space'), N('solid', 'background', {}, { color: '#040408' }), N('hedgehog', 'animal', { p: 'space' }), N('over', 'final', { front: 'animal', back: 'background' })
    ], 'final', { exposure: 1.6 }),
    base('ring', 'Filament ring', 'Replace only the geometry node, then reuse the source nebula’s turbulence, filaments, central glow and stars.', 'Component remix', sourceNodes('ringGeometry'), 'final', { tone: 'source' }),
    base('marble', 'Living mineral', 'Coordinate warp → nested wave bands → palette. Five small nodes, no bespoke scene renderer.', 'Component remix', [
        N('coordinates', 'space'), N('domainwarp', 'warp', { p: 'space' }, { amplitude: 0.8, frequency: 2.1, speed: 0.12 }), N('waves', 'veins', { p: 'warp' }, { frequency: 10, bend: 2.8, speed: 0.8 }), N('palette', 'final', { field: 'veins' }, { low: '#081927', high: '#d09c55', power: 3, gain: 1.2 })
    ], 'final'),
    base('kaleidoscope', 'Kaleidoscope garden', 'Angular mirror → domain warp → interference field → custom color expression. Fully editable typed equations.', 'Component remix', [
        N('coordinates', 'space'), N('kaleidoscope', 'fold', { p: 'space' }, { sectors: 8 }), N('domainwarp', 'warp', { p: 'fold' }, { amplitude: 0.28 }), named('Interference petals', N('expression', 'petals', { p: 'warp' }, { expression: PETALS })), named('Rainbow color', N('colorExpression', 'final', { p: 'space', a: 'petals' }, { expression: RAINBOW }))
    ], 'final', { exposure: 1.6 }),
    base('feather', 'One feather, many possibilities', 'Inspect the reusable stamp that makes the fan. Rotate, scale, mask, tint or repeat it in your own construction.', 'Component study', [
        N('coordinates', 'space'), N('solid', 'background', {}, { color: '#010305' }), N('transform', 'local', { p: 'space' }, { x: 0, y: -1.08, scale: 2.1 }), N('feather', 'feather', { p: 'local' }, { width: 0.19 }), N('over', 'final', { front: 'feather', back: 'background' })
    ], 'final', { exposure: 1.8 })
];
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
