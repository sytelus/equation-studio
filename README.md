# Equation Studio

**A local GPU equation-art laboratory: compose fields, inspect formulas, animate parameters, and export reproducible images.**

![The editor: the final image with rulers, the live pipeline of stages, and the typeset equation of the selected component](gallery/studio-desktop.png)

Every image is a typed graph of equations evaluated live, per pixel, on your GPU. The editor is built for understanding and experimenting:

- **See every step.** The Pipeline shows each component's output, in order, as a live thumbnail. The canvas can show the final image, any single stage, or exactly which pixels a component changes.
- **Understand the math.** Each component's equation is typeset, with every symbol explained and its live value shown. Every parameter says what it does. Rulers read coordinates, colors and raw field values under the cursor.
- **Experiment without fear.** Every parameter can be reset, and a marker shows its original value. Sweeps render a parameter across its whole range. Variations suggest nearby versions. Hold *Original* to compare, and *Revert* is undoable. Tick and untick components to bypass them and build the image up layer by layer.
- **Compose.** Drag components from the library onto the graph or an input, drag wires between sockets, insert a modifier on any input, or replace a component while keeping its wiring. Custom equations are typeset live as you type.

It then animates parameters with keyframes and exports stills, frame sequences or video with the full project embedded. The [editor guide](docs/EDITOR_GUIDE.md) covers every control, and every control in the app explains itself when hovered.

## Open the app

**Open `Equation Studio.html` in a desktop browser with WebGL 2 enabled.** This single file includes the application, styles, and small gallery thumbnails. It needs no npm installation, account, API key, network connection, or Python. The thumbnails are navigation aids; the artwork canvas is computed live from equations and never samples them.

For development, or when the browser restricts local files, use the included loopback-only server:

```bash
# macOS / Linux; Python 3.10+; no packages to install
python3 start.py

# Windows
py -3 start.py
```

The launcher opens `http://127.0.0.1:8765/`. Press Ctrl+C to stop. Use `--port 8766` if needed; `--no-open` only prints the address. Windows and macOS launchers are also included. macOS may require launching downloaded scripts from Terminal rather than double-clicking them. Do not override an organization's browser or device policies; use an authorized browser/environment.

Only Python's static server is involved in this second route. **Rendering remains in the browser**, not in Python. The supplied Python nebula renderer is an independent reference, not a hidden backend.

## What is reconstructed, and what is new?

| Construction | Delivered implementation | Evidence boundary |
|---|---|---|
| Original Bipolar Nebula | GPU port of the supplied equations, with the previous Python project retained | Full source equation reference and measured GPU/CPU comparison; not byte-identical across precision/backends |
| Stormy water planet | Sphere coordinates, seven cyclone warps, multiscale clouds, ocean glint, atmosphere | New procedural study of the requested subject; original formula sheet unavailable |
| Galaxy lensed by a star cluster | Shared cluster positions, softened lens map, spiral source galaxy, foreground lights | New illustrative model; not the artist's recovered formula |
| Spiral aurora | Logarithmic spiral ribbon, angular rays, layered emission | New procedural study; not an MHD simulation |
| Black hole stretching a star | Projected disk, illustrative rear arc, shadow, tapered stream, stellar glow | New stylized construction; not relativistic ray tracing |
| Peacock in full display | Reusable eye-feather stamp, four ordered fan rows, independent body/head | New construction; not an exact transcription of the linked artwork |
| Hedgehog and Fire | Quill-stamp/ellipse assembly; advected tapered flame field | Original teaching examples, **not transcriptions of the unavailable videos** |
| Ring Nebula, Marble, Kaleidoscope, One Feather | Additional remix/teaching scenes | Original demonstrations of component reuse |

There are **12 editable scenes and 43 typed component kinds**. The interface and the [research report](docs/RESEARCH.md) preserve the distinction between source reconstruction and interpretation. We did not recover the complete new formula sheets, video frames/transcripts, 2023 thread, or two third-party exchanges. No exact reconstruction of those inaccessible materials is claimed.

## First fifteen minutes

1. Start with **Bipolar Nebula**. The **Pipeline** below the canvas shows all nine components in evaluation order, each with a live picture of its output. Click *Pinched shell family*: the canvas now shows **This stage**, the geometry alone. The legend explains the false colors: red is the emission rim, green is coverage, blue the signed coordinate warp. Press `]` repeatedly to walk through the construction to the final image, and `Esc` to return to it.
2. Select *Folded star lattices* and choose **What it changes**: the final image is rendered with and without the stars, and only the pixels they change stay in color. Move over the image: the rulers' crosshair reads the world coordinate, pixel, displayed color and the component's raw value; click to pin the reading. Raw values require `EXT_color_buffer_float`; ordinary rendering does not.
3. In the inspector, read the typeset equation and its *where* list, then press **▦** next to *Neck pinch* to see the image across the parameter's whole range. Hover a thumbnail to preview it, click to use it, then **↺** to put it back. Hold **◐ Original** to compare with the scene as opened.
4. Press **Only structure** above the pipeline, then tick *Folded star lattices*, then *Gas emission*. The image builds up one layer at a time, and ticking a component also includes what it needs.
5. Open **Ring Nebula**. Its cloud machinery is unchanged; only its geometry is replaced (the inspector's **Replace with…** does exactly this). This is the smallest useful example of composition rather than merely retinting an image.
6. Open **Galaxy behind a star cluster**. Play the timeline and inspect the lens-strength keys. Untick the lens: a bypassed coordinate map passes its input through, so the galaxy appears unlensed. The foreground cluster is not distorted with the background galaxy.
7. Select a numeric control and click **◆** to make a first key. Move the playhead, then change that control: a tracked parameter gets a new key at the current time. Drag keys along their lane to retime them.
8. Open **Components**, search for **Custom scalar**, and drag it onto the graph. Type `0.5 + 0.5*cos(12.0*r - t)` and watch it typeset above the text; apply it. Coordinates are explicitly connected; an unconnected socket supplies zero, not an inferred world coordinate.
9. Press **Snapshot** before a risky change; the Snapshots tab brings the state back, and **⟲ Revert** restores the whole scene (undoably). Save the project JSON, then export PNG or a PNG sequence. PNG files from the Export dialog include the complete project and render settings as embedded text metadata.

## Editing and inspection

The left library contains scenes, components and snapshots. The center contains the live canvas and, below it, the Pipeline, the typed function graph and the generated GLSL. The right inspector explains the selected component: its intent, typeset equation and symbols, inputs, parameters with plain-language help, and animation tracks. Every control has a hover explanation.

The canvas shows the **final image**, one **stage** (any component's own output), or **what a component changes**. Unticking a component bypasses it: a modifier such as a coordinate warp, tint or mask passes its input through unchanged, a combiner passes its main input, and content such as a field or star layer contributes nothing.

Wire components by dragging between dots, by clicking an output dot and then an input dot, or by choosing the input in the inspector; drag a library entry onto a socket to add and connect in one step, use **＋** on an input to insert a modifier, and **Replace with…** to swap a component. Cycles and mismatched types are rejected. Graph layout is automatic and scrollable; this is not a free-position node-canvas editor. Numeric changes update uniforms; graph or equation changes compile a new shader. A failed custom equation does not replace the last valid project/image.

Drag the artwork to pan; scroll or pinch to zoom about the cursor; **Fit** resets the camera. **Rulers** and **Grid**, on by default, overlay world coordinates with a crosshair readout of position, pixel, color and raw field values; a click pins the readout. **Compare with a picture** (in the ⋯ menu) loads a local PNG/JPEG/WebP overlay or difference view. It does not infer equations, fit parameters, or affect exported artwork. Crop a reference before loading; the overlay is stretched to the canvas rectangle.

Projects autosave opportunistically to browser storage. Browser storage can be unavailable or cleared; **Save project** is the portable backup. Reference images are session-only and are not included in the saved project; snapshots and preferences stay in the browser. The complete list of controls and keyboard shortcuts is in the [editor guide](docs/EDITOR_GUIDE.md).

## Animation and export

**Animation is stateless:** a frame is a function of project parameters and time. Scrubbing backward does not require replaying a simulation. Most studies animate directly through a flow-speed parameter; the source nebula's default time dependence is zero to preserve its static source construction. Add keys or change its motion control to animate it.

| Export | Behavior |
|---|---|
| PNG | Current playhead; opaque displayed RGB; up to the lower of GPU limits and 4096 pixels per side; embedded project/settings metadata |
| PNG sequence ZIP | Explicit times `i/FPS`, end point excluded; PNGs, project JSON, and manifest; at most 240 frames, 1280 pixels per side, and 150 MB of compressed frame bytes |
| Browser video | One real-time timeline pass using a supported MediaRecorder codec; may drop frames on a slow device; exact frame count is not promised |

Use PNG sequences for reproducible frame times and lossless stills. Video support depends on browser codecs. A looping playhead does **not** guarantee a seamless visual loop: endpoint keys and procedural phases must also agree. See [Animation and export](docs/ANIMATION.md).

The preview has a 5:3 aspect ratio. Exporting another aspect ratio preserves horizontal world-space scale and reveals/crops the vertical extent; it does not stretch the scene. Preview resolution changes sample locations, not the number of original formula terms. Fine lines and stars can alias at low resolutions; there is no hidden temporal antialiasing or band removal.

## Project structure

```text
Equation Studio.html       Self-contained application, ready to open
index.html / style.css     Editable application shell and styling
src/
  catalog.js               43 component definitions: intent, sockets, params, GLSL emitter
  graph.js                 Project schema, validation, graph traversal, history
  compiler.js              Typed DAG → one fused fragment shader (display, raw, contribution, preview modes)
  renderer.js              WebGL programs, uniforms, offscreen snapshots and previews, float probes
  view-math.js             Camera arithmetic shared by the canvas, rulers and tests
  math-render.js           TeX and GLSL expressions → MathML for typeset equations
  explore.js               Parameter sweeps, variations and original values
  graph-layout.js          Deterministic graph layout
  math-glsl.js             Low-level field, noise, shape, color and composition atoms
  source-constants.js      Float64 constant folding of source's fixed band expressions
  nebula-glsl.js            Original source nebula GPU kernels
  motifs-glsl.js            New subject-based kernels
  timeline.js              Deterministic parameter interpolation and key editing
  presets.js               Editable scene graphs
  export.js                PNG metadata and dependency-free ZIP export
  snapshots.js             Session bookmarks
  editor.js                Shared editor state, event bus and model operations
  ui-*.js                  One module per panel or tool: library, canvas, pipeline, graph, previews,
                           inspector, explorer, tooltips, timeline, export, toolbar
  app.js                   Boot, frame loop and integration hooks
  research.js              Evidence/provenance ledger displayed inside the app
examples/                  Saved projects and an embeddable renderer example
reference/nebula_rewrite/   Retained complete Python project and original documentation
tools/                     Build, documentation, metadata extraction and verification
tests/                     Node tests; small browser-produced verification artifacts
docs/                      Guides, theory, recipes, API, research and measured validation
```

Browser-readable copies are included as `README.html` and `docs/*.html`, with typeset equations and no online scripts. Regenerating those reading pages is optional and uses `python3 tools/build_docs.py` with Pandoc installed.

Read the [Editor guide](docs/EDITOR_GUIDE.md), [Architecture and API](docs/ARCHITECTURE.md), [Construction recipes](docs/RECIPES.md), the [generated component catalog](docs/COMPONENTS.md) and, for working on the code, the [Development guide](docs/DEVELOPMENT.md). The retained [original formula reference](reference/nebula_rewrite/docs/FORMULA_REFERENCE.md) maps every source symbol to its purpose. Changes are listed in the [changelog](CHANGELOG.md).

## Development and verification

No installation is needed to edit the source modules and serve them with `start.py`. Node 20+ is only needed for development tests and generating example JSON; Python 3.10+ builds the standalone file:

```bash
node --test tests/*.test.js
node tools/generate_catalog.js
python3 tools/build.py
python3 start.py
```

Optional browser tests need Python Playwright, NumPy and Pillow, and a Chromium (Playwright's bundled one works: `python3 -m playwright install chromium`). CPU reference tests additionally need the requirements in `reference/nebula_rewrite/`. Detailed commands, environment, measurements, and known gaps are in [Validation](docs/VALIDATION.md); the full regeneration checklist is in the [Development guide](docs/DEVELOPMENT.md). The single-file distribution should be rebuilt after modifying any runtime source module, HTML, CSS, or thumbnail.

## Performance and portability

This is WebGL 2, not WebGPU. All per-pixel math runs in fragment shaders; there are no remote services or CPU-rendered preview substitutes. Dense source formulas and a large peacock fan can be expensive. Start with 480/800-pixel previews; shader compilation on the first use of a graph may pause the UI. Numeric edits then reuse linked programs. Raw probes synchronously compile/read back a field and may also pause briefly.

The app was exercised in Chromium using the real WebGL 2 API with the **ANGLE/SwiftShader software backend**, including full-resolution source comparison. No physical-GPU frame-rate claim is made. Automated UI testing loads the actual bundled HTML into an in-memory page, so no browser policy is involved; file-URL and localhost browser navigation were not end-to-end tested by those suites. The HTTP launcher itself was tested separately. Safari/Firefox/iOS and hardware-GPU matrices remain untested. WebGL absence, missing float-probe support, recording codec errors, and context loss have explicit handling. Live previews and contribution views compile additional shaders on first use; turn previews off on slow machines.

This is a procedural-art tool, not a physical astronomical/weather simulator, an automatic inverse-image-fitting system, a general 3D modeller, or a recovery of the artist's private design process.

## Attribution

The original **Bipolar Nebula** mathematical artwork is credited to **Hamid Naderi Yeganeh**. This project is independent and is not affiliated with or endorsed by the artist. New scene studies and software must not be represented as his original equations. See [Attribution](ATTRIBUTION.md) and [Research](docs/RESEARCH.md).
