# Architecture: a small language for visual fields

## The central idea

A picture is evaluated as a function of position, time and a project:

```text
pixel position → coordinates → geometry / scalar fields → radiance + coverage
                                      ↑                         ↓
                              shared subexpressions      composition → display
```

The graph is a program, not a stack of bitmaps. Each output pixel independently runs that program on the GPU. An input wire means “evaluate this expression and use its value,” not “sample a previously drawn preview.” A shared upstream component is emitted once in the shader, even if several downstream components use it.

The implementation deliberately separates **atoms**, **compound kernels**, **graph definitions**, **explanations** and **the UI**. Low-level kernels are ordinary GLSL functions. The catalog assigns selected functions typed inputs, parameters, and the metadata that explains them: the equation as captioned steps, symbols, the ideas behind it and its key function. Presets connect catalog components. The UI edits the same validated JSON used by the public renderer. Compound kernels such as the planet keep their internal lighting/cloud calculations together; those internals are documented and editable source, not separately exposed graph sockets for every subexpression.

```text
catalog.js ─┬─ compiler.js ── renderer.js ── canvas, thumbnails, probes, exports
concepts.js ┤                      ↑
expression.js ─ custom equations ──┘ (parsed, checked, printed as GLSL)
            └─ math-render.js, formula.js, plot.js ── the explanations in the UI
```

## Four value types

| Type | GLSL representation | Contract |
|---|---|---|
| `coord` | `vec2` | A location in a sampling domain; not a color |
| `scalar` | `float` | A number at each point; may be negative or greater than one |
| `geometry` | `Geometry {warp, rim, coverage}` | Source-compatible geometric texture coordinate, emission envelope and diagnostic membership |
| `layer` | `vec4` | Straight/unpremultiplied RGB radiance plus coverage alpha |

Every socket has one of these types. The editor rejects a color-to-coordinate wire rather than silently treating red/green as position. Missing sockets are typed zeros. In particular an unconnected coordinate socket is `(0,0)`, **not** the world position; inputs are always explicit.

### Disabled means bypassed

A disabled component is **bypassed**. Each catalog entry names a `bypass` socket whose type equals its output; a disabled node forwards that input unchanged. Components without one output a typed zero:

| Role | Examples | Disabled |
|---|---|---|
| modifier | Translate, Vortex, Domain warp, Polar, Angular mirror, Lens map, Custom coordinate, Tint, Mask layer, Soft threshold | passes its input through (a warp becomes the identity) |
| combiner | Add light (a), Front over back (back), Combine scalar fields (a) | passes its main input through |
| content | fields, shapes, lights, star fields, nebula layers, custom scalar/color | outputs zero |
| source | Image coordinates | outputs zero |

This matches the pass-through convention of compositing tools and keeps experiments meaningful: switching off a warp removes the warp instead of collapsing every downstream coordinate to the origin. `activeInputs()` in `graph.js` decides which inputs a view evaluates (a disabled node pulls in only its bypass input), and every statement of the compiled program chooses between the component's expression and its bypass at run time (see below), so bypassing never recompiles. The roles also drive the editor's *Only structure* action, which bypasses content and keeps the rest.

The `geometry` bundle does not mean a mesh, physical volume, or signed-distance field. The original `warp` is an implicit shell-following coordinate, `rim` is an emission multiplier, and `coverage` is a diagnostic of shell selection. The cloud shader only needs the first two; another geometry can satisfy that interface. Ring Nebula does exactly this.

## Coordinate maps and why they compose

A transform samples an object in local coordinates:

\[
q=R(-\alpha)(p-c)/(s_x,s_y),\qquad I_{\mathrm{world}}(p)=I_{\mathrm{local}}(q).
\]

This is backward mapping: ask each destination pixel which position of the source function it should evaluate. Moving the sampling coordinates moves the visible object in the opposite way. The same principle explains rotation, a vortex, a polar unwrap, kaleidoscopic folding, and the illustrative lens map. These maps can feed **any compatible downstream field**, not only the motif for which they were introduced.

A cloud coordinate map and a sphere normal are not interchangeable. One determines which surface pattern is sampled; the other determines shading. Within `waterPlanet`, the surface UV is distorted by cyclone maps while the geometric normal still comes from the projected sphere. Distorting the normal by the cloud coordinates would incorrectly bend the lighting with the weather pattern.

## The compiler: one program per graph structure

`validateProject()` checks the whole JSON, including disconnected nodes: valid IDs, known component types, finite bounded parameters, valid sockets, references, types, output, custom equations, track settings, and cycles. Limits are 80 nodes, 160 tracks, and 500 keys per track. A disconnected cycle is still an invalid project, even when it does not affect the current output.

`compileProgram(project, {subset})` turns the graph (or a subset of its node ids) into **one GLSL ES 3.00 fragment program**. Each component becomes one local variable of an `evaluate(p)` function, in dependency order:

```glsl
// n4: Folded star lattices [stars]
vec4 n4=vec4(0);
if(evaluated(4)){ if(included(4)) n4=nebulaStars(n0,n4_count,n4_brightness); else n4=vec4(0); }
```

Everything that changes while you work is a **uniform**, never baked into the source:

| What | Uniform | Consequence |
|---|---|---|
| parameter values | `u_params[]`, four numbers per `vec4`, a color per `vec4`; readable aliases such as `#define n4_count u_params[3].y` | sliders, keyframes, sweeps and variations never recompile |
| included / bypassed | `u_enabled`, one bit per component | checkboxes, *Only structure* and “what it changes” never recompile |
| what is evaluated | `u_active`, one bit per component: the shown component's dependencies | a program for the whole graph costs only what the current view needs |
| which component is shown | `u_target` | walking the pipeline, thumbnails and probes use the same program |
| display colors or raw values | `u_mode` (`MODES.display`, `MODES.raw`) | float probes and automatic stage colors use the same program |
| sampling | `u_sampling`, `u_line`, `u_offset` | the camera grid, a line of points (the profile) or a tile of an atlas |

`programKey(project)` is the structural key of a program: node ids, types, connections and custom equations, in evaluation order. Parameter values, enabled flags, the output choice and the view are deliberately excluded. `viewState(program, project, target, contribution)` computes the per-frame masks (`active`, `enabled`), the list of nodes the view evaluates, and whether a contribution can reach the target at all.

All kernel libraries are included as source; the graphics driver removes unreachable functions. A graph does not allocate a texture or framebuffer per node. This avoids hidden inter-pass quantization and makes inspection/reuse straightforward.

Why one program? Shader compilation is the one expensive operation in the app, and some drivers are slow at it: on Direct3D 11 (ANGLE), 1.2 compiled two programs of about two seconds each whenever a checkbox was unticked, freezing the page. 1.3 compiles the whole scene once (about 0.4 s for the Bipolar Nebula on the same machine) and never again until the wiring or an equation changes. To keep that program small, looks and comparisons are separate fixed shaders (below), not branches of the graph program.

`compileGraph(project, target, options)` remains the readable description of one view: the program for the target's subgraph plus `{target, type, raw, contribution, contributionStyle, reachable, evaluated}`. `subgraph(project, target)` lists the target and everything upstream of it, whatever the enabled flags. The GLSL tab shows this smaller program for the current view, which is easier to read; the canvas runs the same statements in the program for the whole graph.

### Custom equations in the program

A custom component's equation is compiled by `expression.js` (see [The equation language](#the-equation-language)) into a small typed GLSL function, `equation_n3(p, a, b, t)`, whose parameters read their `u_params` aliases like any other. The statement calls it; a color equation that returns `vec3` is given full coverage.

## The renderer: views, passes and background compilation

`Renderer` in `renderer.js` owns the WebGL 2 context. Programs are cached by structural key (12 by default, least recently used first; the program on screen is never evicted).

### Views

| View | How it is drawn |
|---|---|
| final image, a layer stage | one draw of the graph program (`u_mode` display) |
| a scalar, coordinate or geometry stage with automatic colors | one draw of raw values into an `RGBA32F` texture, then the **look pass** (`lookPassSource` in `looks.js`) colors them |
| what a component changes | two draws of the displayed image, with the component and with it bypassed (`withBypassed(project, id)`), into two float textures, then the **compare pass** (`comparePassSource` in `compiler.js`) |
| thumbnails | `previewAtlas()`: one draw per tile of one framebuffer, each with its own `u_target`, one readback |
| profile, point readouts | `sampleLine()` / `samplePoint()`: `u_sampling` evaluates the target at points along a segment into a `count × 1` float target |
| statistics for automatic colors | `rawImage()`: raw values of the target over the camera view at 120 × 72 |

The look and compare shaders are fixed: they are compiled once, on first use, whatever the graph. Comparing float images keeps the highlight threshold unquantized; without `EXT_color_buffer_float` the comparison uses bytes and the automatic looks fall back to the classic diagnostic colors (which the graph program computes directly, `presentGLSL`).

### Background compilation

`programFor(project)` returns a program entry at once and compiles in the background when the browser has `KHR_parallel_shader_compile`. `poll()`, called once per animation frame, advances compilations; a program is **ready** only after a one-pixel warm-up draw has finished on the GPU (checked with a fence), because several drivers finish compiling at the first draw. Without the extension, one queued program is compiled per frame, after the page has shown that it is busy. `drawIfReady()` draws only when the program is ready and otherwise returns `null`, so the editor keeps the last image, shows *Compiling shader…* and a progress cursor, and stays responsive. `whenReady()` returns a promise for code that wants to wait. Synchronous calls (`draw`, `snapshot`, probes) link immediately and may block.

### Reading back without waiting

Thumbnails, the profile and the statistics behind automatic colors read back **asynchronously**: `readPixels` into a pixel-pack buffer, a fence, and `getBufferSubData` once `poll()` sees the fence signalled. The page never waits for the GPU for those. Readouts under the cursor still read one pixel synchronously.

### Measuring the GPU

`info.gpu` classifies the renderer string (`describeRenderer()` in `gpu-info.js`): a hardware GPU (named, with its API: Direct3D 11, Metal, OpenGL, Vulkan), software rendering (SwiftShader, llvmpipe, Microsoft Basic Render Driver), or unknown when the browser masks it; for an unknown name, `probeSoftwareFallback()` asks for a context with `failIfMajorPerformanceCaveat`. `beginTimer()`/`endTimer()` measure a visible draw with `EXT_disjoint_timer_query_webgl2` when available (`gpuTimeExact`), else as the time until a fence signals (an upper bound). The editor's Auto quality uses that time to lower the resolution during interaction when frames exceed about 24 ms, and the LIVE badge and **GPU & performance** dialog report it. Web pages cannot schedule per-pixel work on a neural processing unit; the GPU is the only accelerator available to this kind of rendering.

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

## Looks: showing values that are not colors

A scalar, a coordinate pair or a geometry bundle has no color of its own; showing one means choosing an encoding. `looks.js` holds these encodings as pure data and functions, from which it generates both the GLSL of the look pass and a CPU twin used to paint thumbnails, so a stage looks the same on the canvas and in the Pipeline.

| Type | Automatic look | Classic look (1.x diagnostic, `presentGLSL`) |
|---|---|---|
| scalar | colormap over a robust range of the values in view (0.5th to 99.5th percentile); a diverging map symmetric about zero when the field takes both signs, sequential otherwise; contour lines at a 1–2–5 interval drawn with `fwidth`, brighter at zero | gray = ½ + ½·tanh(value) |
| coord | the image of a regular grid: the color of the grid cell each output coordinate falls in, lines at multiples of the cell size, the q_x = 0 and q_y = 0 axes in red and green | red = ½ + ½ sin x, green = ½ + ½ sin y |
| geometry | one channel (S, A or coverage) as a scalar | red = 4·rim, green = coverage, blue = ½ + ½·tanh(warp) |
| layer | natural display, times an exposure gain when the layer is almost entirely clipped or black (`layerGain`) | natural display |

`fieldStats()` computes minimum, maximum, mean, median, the robust range and a histogram; `lookForStats()` turns statistics into a look; `lookUniforms()` into the look pass's uniforms. The canvas computes a new stage's look synchronously from a 120 × 72 raw render, so it never flashes in the wrong colors, then refreshes it asynchronously at most every 220 ms while parameters, time or the camera change (`ui-look.js`). A look can be locked.

These encodings are views of numbers, not the numbers. A negative field is not “negative light,” and a coordinate grid is not a texture of the scene. The readouts and the profile report the actual values: `sampleLine()` and `samplePoint()` render into `RGBA32F` framebuffers and return floats before exposure, mapping and quantization, as `[scalar,0,0,1]`, `[x,y,0,1]`, `[warp,rim,coverage,1]`, or actual RGBA, depending on the target. They need `EXT_color_buffer_float`, which is checked. All inspection renders into temporary framebuffers, so the visible canvas is never resized or redrawn by an inspection.

The display path flags NaN or infinity in any output component as magenta. A debug mode turns all finite outputs black, supporting automated nonfinite tests. Raw mode returns values without this conversion.

## Source coordinates and numerical choices

At 2000 × 1200 with zero pan and unit zoom, pixel column `m` and row `n` reproduce the supplied mapping:

\[
x=(m-1000)/420,\quad y=(601-n)/420,\quad m=1\ldots2000,\ n=1\ldots1200.
\]

The framebuffer origin is bottom-left; exported PNG rows are top-first. The shader's half-pixel accounting adds `1/840` to both coordinates. A `u_offset` uniform subtracts the tile origin when several previews share one framebuffer; it is zero for ordinary draws. `src/view-math.js` implements the same mapping in JavaScript for the rulers, readouts and zoom-about-cursor, and the unit tests check that it reproduces the native grid. General image sizes preserve the horizontal world span `2000/420`; a different aspect ratio changes the vertical extent. One sample is evaluated per pixel. Multisampling of the fullscreen triangle does not antialias procedural subpixel lines, so WebGL canvas antialiasing is disabled rather than misleadingly advertised as a solution.

The source defaults retain **27 shells, 50 turbulence terms, 50 cloud terms and 30 star lattices**. Lowering preview width does not drop bands. Band counts are available as explicit artistic parameters, which deliberately change the source construction.

`exp(-exp(z))` is evaluated with `z` clamped to `[-80,6]` to avoid irrelevant inner overflow under shader precision. Singular shell coordinates use an explicit finite sentinel for the fixed-transverse limit and the same centerline convention as the reference. `atan(M,N)` preserves the source's argument order; at the undefined folded-lattice origin the angle is set to zero. Small denominator guards in new artistic kernels are declared regularizations, not exact mathematical equivalences.

### Why `source-constants.js` exists

Shader `float` is not the Python reference's float64. Repeatedly multiplying frequencies and evaluating fixed large angles such as `cos(28*s*s)` in GPU precision caused visible discrepancies during development. This module evaluates **only coordinate-independent expressions** in JavaScript's double precision and emits GLSL constant arrays. It includes shell coefficients, rotations, frequencies, phase offsets and per-band RGB weights. Every entry is generated from its named formula, rather than hidden fitted data.

These arrays are not image samples or a shortcut renderer. Every position-dependent shell, wave, filament and star evaluation still runs per pixel on the GPU. Constants ultimately round to shader precision. Remaining high-frequency phase and transcendental differences explain why this is a close numerical port, not a cross-platform bitwise clone. See the measured errors in [Validation](VALIDATION.md).

## The equation language

The Custom scalar, Custom coordinate and Custom color components hold a short program in a small language (`expression.js`), written like mathematics and checked like code:

```text
param radius = 1 [0.1, 3]      // a parameter: default, range, optional "step s", caption
param tint = #ffd080           // a color parameter
d = length(p) - radius         // a definition
exp(-(d / 0.1)^2)              // the last line is the result
```

`parseProgram()` splits statements (lines or `;`), captions (`//`), parameters and definitions, and parses each expression with a precedence-climbing parser into an AST (numbers, names, calls, unary, binary including `^` and `%`, comparisons, `&&`/`||`, `? :`, swizzles). `checkProgram(source, kind)` type-checks it: every name must be a local (`p, x, y, r, theta, a, b, t`), a constant (`PI`, `TAU`), a parameter or an earlier definition; every call a GLSL built-in with matching overloads or a function of the shader libraries, whose signatures `LIBRARY` reads from the GLSL sources, so a new kernel is callable without further work. The result type must suit the component (`float`, `vec2`, `vec3`/`vec4`). Errors carry line numbers and suggestions (edit distance with transpositions: *Unknown name “raduis”. Did you mean “radius”?*). Limits: 3000 characters, 8 parameters, 24 definitions, names of at most 24 characters; no loops, assignments to built-ins, or declarations.

`programGLSL()` then **prints the checked AST as GLSL**, never splicing the source text: definitions become `d_name`, parameters their uniform aliases, whole numbers get a decimal point, `x^2`, `x^3` and `x^4` become products (exact for negative `x`, unlike `pow`), other powers `pow`, and `%` becomes `mod`. `compileEquation()` caches the result per source; `equationParams()` gives the parameter specs, which `paramSpecs(node)` in `catalog.js` merges into the node's own, so equation parameters behave like built-in ones everywhere (uniform packing, sliders, keyframes, sweeps, variations, validation).

`math-render.js` typesets the same AST as MathML (`a/b` as a fraction, `x^2` as a superscript, `sqrt` as a radical, `abs`/`length` as bars, `vecN` as a tuple, `theta` as θ), keeping only the parentheses the meaning needs, one row per statement, with its caption.

### Components as equations: ✎ Edit

`fork.js` writes a built-in component as an equivalent equation, so that **✎ Edit** can open every eligible component the same way. `forkBlocker(type)` says why a component cannot be written as one (it reads a color layer or geometry, has more inputs than `p`, `a` and `b`, or is the image source), and `forkable(type)` is its negation for built-in components. `forkProgram(node)` names the parameters after their TeX symbols (`\kappa` → `kappa`, `c_x` → `c_x`) as `param` lines with their current values, ranges and first sentence of help, and writes the computation from the catalog's `source`: the steps as equation lines, with `$key` standing for parameter `key`. The vortex, for example, becomes

```text
alpha = kappa*exp(-(r/rho)^2) + omega*t   // the twist angle …
rotate2(p, alpha)                         // turn each point about the center by its own angle …
```

so a user edits the math the steps show. Fourteen components have a `source`; the others (loops over lattices, bands or cyclones, and whole scenes) are written as a call of their shader-library function. `tools/gpu_validate.py` renders every forkable component both ways and requires the same raw values; all 29 agree exactly.

`withEquation(project, nodeId, source)` is the single operation behind editing: the project with that component running `source`. A custom equation gets the new text; a built-in component first becomes its equivalent equation (same id and wiring, label “… · equation”, animation tracks renamed with its parameters). Parameters are then synchronized: one whose `param` line keeps its default keeps its current value (clamped to a changed range); a new one, or one whose default was edited, takes the declared default; removed ones lose their tracks. It throws the checker's `EquationError` for an invalid equation.

The editor keeps unapplied edits as **drafts** (`state.drafts`: component id → text, `setDraft()`, `startEdit()`, `discardDraft()` in `editor.js`), shared by every view of the component. While the selected component has a draft, `updateDraftPreview()` computes `withEquation()` for the last text that checked (debounced while typing) and the canvas draws that project instead of the real one, labelled DRAFT; its program compiles in the background like any other. `applyEquation(nodeId, source)` commits `withEquation()` as one undo step and discards the draft.

## Metadata that explains

The explanation panel is generated from catalog metadata, so every component is explained the same way and a new component is explained by adding data:

| Field | Shown as |
|---|---|
| `steps: [step(tex, text)]` | *How it is computed*: numbered, typeset lines with captions; the last is the result |
| `source: [line, …]` | what ✎ Edit opens: the steps as equation-language lines with captions (see above) |
| params' `symbol`, `help`; `inputSymbols`, `outputSymbols`, `notes` | colored, hoverable symbols in the steps, parameter help, *Other symbols* |
| `concepts: [id]` | *Why it is written this way*: cards from `concepts.js`, each with a formula, a paragraph and optionally a plot with a knob |
| `curve: {title, x, y, domain(P), series, marks(P)}` | *Key function*: an SVG plot (`plot.js`) with the live parameters |
| `role`, `bypass` | what the checkbox does, *Only structure* |

`texToMathML()` in `math-render.js` annotates each symbol it recognizes with its role (`sym-input`, `sym-param`, `sym-output`, `sym-time`) and a data attribute naming the socket or parameter; the UI uses those for coloring, hover highlighting, clicking through to inputs and dragging parameter symbols. `formula.js` writes the whole construction as a formula sheet (`compositionTeX()` expands the combiners into an expression over the components they combine). `tests/catalog.test.js` checks that every component has steps with captions, that every parameter's symbol appears in them, that every TeX converts and that the curves evaluate to finite numbers.

## Reuse the renderer without the editor

Serve the project directory, then use its modules from another page. The working [embedded example](../examples/embedded.html) does this:

```javascript
import { Renderer } from '../src/renderer.js';
import { getPreset } from '../src/presets.js';

const renderer = new Renderer(document.querySelector('canvas'));
const project = getPreset('lensing'); // returns fresh editable JSON
renderer.draw(project, 2.0, 1000, 600); // explicit time and pixel dimensions
renderer.draw(project, 2.0, 1000, 600, { contribution: 'galaxy' }); // what the galaxy changes
```

Core APIs:

```javascript
makeNode(type, id, inputs = {}, parameterOverrides = {})
validateProject(project)              // throws; no partial acceptance
parseProject(jsonText)                // validates size and full model
topologicalOrder(project, target)     // bypass-aware evaluation order of a target
evaluationOrder(project)              // every node, dependencies first
upstream(project, id), downstream(project, id)
compileProgram(project, { subset })   // {fragment, key, order, index, types, params, vectors}
compileGraph(project, target, { raw, contribution, contributionStyle }) // one view, described
compileEquation(source, kind)         // a custom equation, checked; throws EquationError

renderer.draw(project, time, width, height, options)        // visible canvas; waits for the program
renderer.drawIfReady(project, time, width, height, options) // null while the program compiles
renderer.poll()                        // call once per frame: compilations, readbacks, timers
renderer.whenReady(project)            // Promise of a ready program
renderer.snapshot(project, time, width, height, options)    // offscreen; top-down RGBA bytes
renderer.previewAtlas(project, time, ids, tileWidth, tileHeight, { raw, look, async })
renderer.sampleLine(project, time, target, [x0, y0], [x1, y1], count, { async })
renderer.samplePoint(project, time, target, x, y)          // raw floats at a world point
renderer.rawImage(project, time, target, width, height, { async })
renderer.info                          // {renderer, gpu: {kind, name, api}, rawFields, parallelCompile, gpuTimer, maxSize, …}
renderer.png()                         // Promise<Blob>; plain PNG, no metadata by itself
embedPNGMetadata(pngBlob, metadata)    // used by the editor's Export dialog
renderer.dispose()                     // release owned GPU resources
```

Frame options: `target` (default: the project's output), `contribution` and `contributionStyle` (`highlight` or `signed`), `raw`, `look` (a look from `lookForStats()`; default classic), `subgraph` (compile only the target's subgraph: smaller and faster to compile for a one-off view), `debug`, `timed`.

`Renderer.draw()` expects finite time, positive integer sizes within the reported limits, and a validated-compatible project. It validates again at the API boundary. Caller code owns scheduling; the renderer does not start an animation loop, so a caller using `drawIfReady()` or the asynchronous readbacks must call `poll()` each frame. `snapshot()` and `previewAtlas()` return `{width, height, data}` objects whose `data` is laid out like `ImageData`.

The editor also exposes `window.equationStudio` for integration: `getProject()`, `getBaseline()`, `loadProject(project)`, `seek(t)`, `getTime()`, `getRenderer()`, `getCatalog()`, `getView()`, `setView(mode, node)` with mode `final`, `stage` or `effect`, `isolate(id)` and `contribution(id, style)` (1.1-compatible shorthands), `setPreviews(enabled)`, `openPlayground(id)` (select a component and widen the panel into the Equation Playground), `closePlayground()`, `isPlaygroundOpen()`, `popOut(id)` (false when the browser blocks the window), `snapshot(title)`, `getSnapshots()`, `renderNow()`, and `exportPNG()`. `getProject()`, `getBaseline()` and `getSnapshots()` return clones. The low-level `exportPNG()` hook returns a plain preview-resolution PNG; use the dialog or metadata helper for an archival export. The [development guide](DEVELOPMENT.md) maps the editor's modules and events.

## Add your own component

Small formulas can be authored inside the browser with Custom scalar, Custom coordinate, or Custom color, in the [equation language](#the-equation-language); **✎ Edit** on a built-in component starts from its equation.

For a reusable component, add an entry to `catalog.js` using its local `component`, `num`, `rgb` and `step` helpers. Each parameter has a TeX `symbol` that appears in the steps, and a plain-language `help` string saying what changing it does; each step has a caption saying what the line computes and why:

```javascript
petals: component({
    name: 'Petal field', category: 'Scalar fields', output: 'scalar', inputs: { p: 'coord' },
    params: {
        count: num('Petals', 5, 2, 16, 1, 'n', 'Number of petals around the center.'),
        width: num('Edge', 0.02, 0.001, 0.1, 0.001, '\\epsilon', 'Softness of the petal outline; small values give a crisp edge.')
    },
    equation: 'mask = inside(r − [0.8 + 0.2 cos(n theta)])',
    steps: [
        step('R(\\theta) = 0.8 + 0.2\\cos n\\theta', 'The outline in polar form: a circle whose radius swells n times around the center.'),
        step('m = 1 - \\operatorname{smoothstep}\\left(-\\epsilon,\\ \\epsilon,\\ r - R(\\theta)\\right)', 'One inside the outline, zero outside, with a soft edge of width ε.')
    ],
    outputSymbols: ['m'],
    notes: [['r, \\theta', 'polar coordinates of p']],
    concepts: ['polar', 'smoothstep'],
    curve: { title: 'Petal radius around the circle', x: 'angle θ', y: 'radius R', domain: () => [-Math.PI, Math.PI], series: [{ f: (a, P) => 0.8 + 0.2 * Math.cos(P.count * a) }] },
    description: 'A radial flower silhouette. Feed it into a palette or use it as coverage.',
    emit: (inputs, uniforms) =>
        `softInside(length(${inputs.p}) - (0.8 + 0.2*cos(${uniforms.count}*angleOf(${inputs.p}))), ${uniforms.width})`
})
```

A modifier also sets `role: 'modifier'` and `bypass` to the socket it passes through when disabled. `tests/catalog.test.js` checks the metadata as described above, and that bypass sockets have the output's type. A new idea goes into `concepts.js` as `{title, tex, text}`, optionally with a `knob` (`{label, min, max, step, value}`) and a `plot(k)` returning `plotSVG` options for the knob value `k`.

For a larger kernel, put a named GLSL function with comments into a shader library and have the emitter call it. The emitter receives **GLSL expression strings**, including uniform aliases, not runtime JS numbers. The metadata automatically drives the component browser and its tips, the explanation panel, socket validation, drag-and-drop typing, insert and replace menus, previews, the formula sheet and code generation; the kernel also becomes callable from custom equations. Add a preset/example, a unit test, and a GPU test. Then follow the regeneration checklist in the [development guide](DEVELOPMENT.md).

## Typeset equations

`src/math-render.js` converts the catalog's TeX subset to native MathML, which browsers typeset without fonts, scripts or network access. It supports fractions, roots, scripts, big operators with limits, Greek letters, upright names (`\operatorname`, `\mathrm`, `\text`), common functions and relations, accents, `\left`/`\right` and spacing, with TeX's spacing classes (an operator name followed by another gets a thin space: arccos cos, not arccoscos). An unknown command throws, so a catalog typo fails the unit tests instead of rendering wrongly. Long equations split at top-level `\quad` into segments that wrap at their natural breaks. With `values`, parameter symbols are replaced by their live numbers.

## Boundaries and extensions

This version supports acyclic spatial function graphs and stateless time. It does not yet implement feedback textures, fluid simulation state, full volumetric transport, parameter expressions linking two controls, arbitrary reusable subgraph packaging, 3D object cameras, transparent/HDR exports, automatic inverse fitting, loops in custom equations, or unrestricted GLSL file editing within the browser. Large compound kernels remain source-level functions. These are explicit extension points, not hidden UI placeholders.
