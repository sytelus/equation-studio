# Architecture: a small language for visual fields

## The central idea

A picture is evaluated as a function of position, time and a project:

```text
pixel position → coordinates → geometry / scalar fields → radiance + coverage
                                      ↑                         ↓
                              shared subexpressions      composition → display
```

The graph is a program, not a stack of bitmaps. Each output pixel independently runs that program on the GPU. An input wire means “evaluate this expression and use its value,” not “sample a previously drawn preview.” A shared upstream component is emitted once in the shader, even if several downstream components use it.

The implementation deliberately separates **atoms**, **compound kernels**, **graph definitions**, and **the UI**. Low-level kernels are ordinary GLSL functions. The catalog assigns selected functions typed inputs, parameters and explanatory metadata. Presets connect catalog components. The UI edits the same validated JSON used by the public renderer. Compound kernels such as the planet keep their internal lighting/cloud calculations together; those internals are documented and editable source, not separately exposed graph sockets for every subexpression.

## Four value types

| Type | GLSL representation | Contract |
|---|---|---|
| `coord` | `vec2` | A location in a sampling domain; not a color |
| `scalar` | `float` | A number at each point; may be negative or greater than one |
| `geometry` | `Geometry {warp, rim, coverage}` | Source-compatible geometric texture coordinate, emission envelope and diagnostic membership |
| `layer` | `vec4` | Straight/unpremultiplied RGB radiance plus coverage alpha |

Every socket has one of these types. The editor rejects a color-to-coordinate wire rather than silently treating red/green as position. Missing sockets and disabled outputs are typed zeros. In particular an unconnected coordinate socket is `(0,0)`, **not** the world position. Disabled nodes do not forward their inputs. Those choices make graph behavior explicit; bypass a node by reconnecting its upstream field.

The `geometry` bundle does not mean a mesh, physical volume, or signed-distance field. The original `warp` is an implicit shell-following coordinate, `rim` is an emission multiplier, and `coverage` is a diagnostic of shell selection. The cloud shader only needs the first two; another geometry can satisfy that interface. Ring Nebula does exactly this.

## Coordinate maps and why they compose

A transform samples an object in local coordinates:

\[
q=R(-\alpha)(p-c)/(s_x,s_y),\qquad I_{\mathrm{world}}(p)=I_{\mathrm{local}}(q).
\]

This is backward mapping: ask each destination pixel which position of the source function it should evaluate. Moving the sampling coordinates moves the visible object in the opposite way. The same principle explains rotation, a vortex, a polar unwrap, kaleidoscopic folding, and the illustrative lens map. These maps can feed **any compatible downstream field**, not only the motif for which they were introduced.

A cloud coordinate map and a sphere normal are not interchangeable. One determines which surface pattern is sampled; the other determines shading. Within `waterPlanet`, the surface UV is distorted by cyclone maps while the geometric normal still comes from the projected sphere. Distorting the normal by the cloud coordinates would incorrectly bend the lighting with the weather pattern.

## The compiler

`validateProject()` checks the whole JSON, including disconnected nodes: valid IDs, known component types, finite bounded parameters, valid sockets, references, types, output, track settings, and cycles. Limits are 80 nodes, 160 tracks, and 500 keys per track. A disconnected cycle is still an invalid project, even when it does not affect the current output.

`topologicalOrder()` then selects only the dependencies of the requested output. `compileGraph()` assigns one GLSL variable to each reachable node. It creates uniform declarations for numeric/color parameters and emits a single `shade(p)` function. Custom expressions become small typed GLSL functions with local `p,x,y,r,theta,a,b,t` variables.

All kernel libraries are included as source; the graphics driver removes unreachable functions. A graph does not allocate a texture or framebuffer per node. This avoids hidden inter-pass quantization and makes inspection/reuse straightforward, at the cost of potentially expensive first-time shader compilation for a large expression network.

The renderer caches eight linked programs. Its structural cache key includes node types, enabled states, connections, expressions, output target and raw/diagnostic mode. Numeric values are **not** in this key. Changing a numeric control updates a uniform. Changing a connection or equation compiles a different program. The new program must compile/link successfully before it replaces the previous render.

## Color, alpha, masks and light

RGB values in graph layers are **radiance-like floating-point numbers**. They are artistic quantities, not calibrated physical units. They can exceed one. The source cloud has individual negative blue coefficients; those are preserved through the original composition.

The two important layer operators are intentionally different:

\[
\operatorname{Add}(A,B).rgb=A.rgb+gB.rgb.
\]

Add sums emission regardless of alpha. Use it for independent star glows, atmospheric light, nebular gas or a flame over black. It does not behave like painting a transparent PNG.

For front-over-back straight-alpha composition:

\[
a=a_f+a_b(1-a_f),\quad
C=\frac{a_fC_f+(1-a_f)a_bC_b}{\max(a,10^{-8})}.
\]

Use Over when a planet, body or feather must hide the layer behind it. **Mask layer changes alpha, not RGB**, so apply it with Over. Sending an alpha-masked field through Add does not remove its RGB; the inspector explicitly warns about this. To attenuate emitted RGB, multiply/tint it or author a color expression with that multiplier.

Color-picker bytes are interpreted as direct numeric radiance multipliers; the app does not perform a color-managed spectral workflow. The three final display modes are:

- **Source**: the original nonlinear `F`, including integer floor, with no extra gamma transform.
- **Filmic**: the deliberately simple artistic curve `(1-exp(-max(H,0)))^(1/2.2)`.
- **Linear**: direct clipping to display range.

No tone mapping is applied between graph nodes. Exports currently have opaque displayed RGB, even though alpha exists inside the graph. Transparent PNG and HDR/EXR export are not implemented.

## Field inspection is not the same as output color

An isolated layer uses the selected display curve. Other isolated types use diagnostic views:

```text
scalar   → gray = 0.5 + 0.5*tanh(value)
coord    → red = 0.5 + 0.5*sin(x), green = 0.5 + 0.5*sin(y), blue = 0.5
geometry → red = 4*rim, green = coverage, blue = 0.5 + 0.5*tanh(warp)
```

These views are useful but lossy. A negative field is not “negative light”; its display is merely dark gray. A coordinate image repeats by design. Use **Probe value** for actual numbers.

`Renderer.samplePoint()` renders a one-pixel `RGBA32F` framebuffer and reads it as floats, before exposure, mapping and quantization. It returns `[scalar,0,0,1]`, `[x,y,0,1]`, `[warp,rim,coverage,1]`, or actual RGBA, depending on the target. The optional `EXT_color_buffer_float` capability is checked. The previous visible render is restored in a `finally` block. The inspection action is synchronous and may stall briefly; it is not a streaming full-frame field export.

The normal shader flags NaN or infinity in any output component as magenta. A debug mode turns all finite outputs black, supporting automated nonfinite tests. The separate raw mode returns values without this diagnostic conversion.

## Source coordinates and numerical choices

At 2000 × 1200 with zero pan and unit zoom, pixel column `m` and row `n` reproduce the supplied mapping:

\[
x=(m-1000)/420,\quad y=(601-n)/420,\quad m=1\ldots2000,\ n=1\ldots1200.
\]

The framebuffer origin is bottom-left; exported PNG rows are top-first. The shader's half-pixel accounting adds `1/840` to both coordinates. General image sizes preserve the horizontal world span `2000/420`; a different aspect ratio changes the vertical extent. One sample is evaluated per pixel. Multisampling of the fullscreen triangle does not antialias procedural subpixel lines, so WebGL canvas antialiasing is disabled rather than misleadingly advertised as a solution.

The source defaults retain **27 shells, 50 turbulence terms, 50 cloud terms and 30 star lattices**. Lowering preview width does not drop bands. Band counts are available as explicit artistic parameters, which deliberately change the source construction.

`exp(-exp(z))` is evaluated with `z` clamped to `[-80,6]` to avoid irrelevant inner overflow under shader precision. Singular shell coordinates use an explicit finite sentinel for the fixed-transverse limit and the same centerline convention as the reference. `atan(M,N)` preserves the source's argument order; at the undefined folded-lattice origin the angle is set to zero. Small denominator guards in new artistic kernels are declared regularizations, not exact mathematical equivalences.

### Why `source-constants.js` exists

Shader `float` is not the Python reference's float64. Repeatedly multiplying frequencies and evaluating fixed large angles such as `cos(28*s*s)` in GPU precision caused visible discrepancies during development. This module evaluates **only coordinate-independent expressions** in JavaScript's double precision and emits GLSL constant arrays. It includes shell coefficients, rotations, frequencies, phase offsets and per-band RGB weights. Every entry is generated from its named formula, rather than hidden fitted data.

These arrays are not image samples or a shortcut renderer. Every position-dependent shell, wave, filament and star evaluation still runs per pixel on the GPU. Constants ultimately round to shader precision. Remaining high-frequency phase and transcendental differences explain why this is a close numerical port, not a cross-platform bitwise clone. See the measured errors in [Validation](VALIDATION.md).

## Reuse the renderer without the editor

Serve the project directory, then use its modules from another page. The working [embedded example](../examples/embedded.html) does this:

```javascript
import { Renderer } from '../src/renderer.js';
import { getPreset } from '../src/presets.js';

const renderer = new Renderer(document.querySelector('canvas'));
const project = getPreset('lensing'); // returns fresh editable JSON
renderer.draw(project, 2.0, 1000, 600); // explicit time and pixel dimensions
```

Core APIs:

```javascript
makeNode(type, id, inputs = {}, parameterOverrides = {})
validateProject(project)              // throws; no partial acceptance
parseProject(jsonText)                // validates size and full model
compileGraph(project, target, raw)    // returns shader source, uniforms, reachable IDs
renderer.draw(project, time, width, height, target, debug, raw)
renderer.samplePoint(project, time, target, x, y)
renderer.png()                       // Promise<Blob>; plain PNG, no metadata by itself
embedPNGMetadata(pngBlob, metadata)   // used by the editor's Export dialog
renderer.dispose()                   // release owned GPU resources
```

`Renderer.draw()` expects finite time, positive integer sizes within the reported limits, and a validated-compatible project. It validates again at the API boundary. Caller code owns scheduling; the renderer does not start an animation loop. `samplePoint()` currently restricts points to world coordinates within ±19.

The editor also exposes `window.equationStudio` for integration: `getProject()`, `loadProject(project)`, `seek(t)`, `getTime()`, `getRenderer()`, `getCatalog()`, `isolate(id)`, `renderNow()`, and `exportPNG()`. `getProject()` returns a clone. The low-level `exportPNG()` hook returns a plain preview-resolution PNG; use the dialog or metadata helper for an archival export.

## Add your own component

Small formulas can be authored inside the browser with Custom scalar, Custom coordinate, or Custom color. Use GLSL float literals such as `2.0`; integer/float overload mismatches are errors, not JavaScript's permissive coercion. Available helpers include `rotate2`, `noise2`, `fbm`, `gaussian`, `cutoff`, `segmentDistance`, and `spectrum`. These expressions compile as GLSL, never as JavaScript. Statements, loops, declarations, assignments, comments and certain unsafe tokens are rejected; arbitrary JS evaluation is not used.

For a reusable component with sliders, add an entry to `catalog.js`. For example, using the existing local `node` and `num` helpers:

```javascript
petals: node(
    'Petal field', 'Scalar fields', 'scalar', {p: 'coord'},
    {count: num('Petals', 5, 2, 16, 1), width: num('Edge', .02, .001, .1, .001)},
    'mask = inside(r − [0.8 + 0.2 cos(n theta)])',
    'A radial flower silhouette. Feed it into a palette or use it as coverage.',
    (inputs, uniforms) =>
        `softInside(length(${inputs.p}) - (0.8 + 0.2*cos(${uniforms.count}*angleOf(${inputs.p}))), ${uniforms.width})`
)
```

For a larger kernel, put a named GLSL function with comments into a shader library and have the emitter call it. The emitter receives **GLSL expression strings**, including uniform names, not runtime JS numbers. The metadata automatically drives the component browser, controls, socket validation and code generation. Add a preset/example, a unit test, and a GPU test. Regenerate documentation/examples and rebuild the standalone HTML.

## Boundaries and extensions

This first version supports acyclic spatial function graphs and stateless time. It does not yet implement feedback textures, fluid simulation state, full volumetric transport, parameter expressions linking two controls, arbitrary reusable subgraph packaging, 3D object cameras, transparent/HDR exports, automatic inverse fitting, or unrestricted GLSL file editing within the browser. Large compound kernels remain source-level functions. These are explicit extension points, not hidden UI placeholders.
