# Equation Studio

**A local GPU equation-art laboratory: compose fields, inspect formulas, animate parameters, and export reproducible images.**

![The running editor](gallery/studio-desktop.png)

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

## First ten minutes

1. Start with **Bipolar Nebula**. Select *Pinched shells*, then **Isolate**. Red is the emission rim, green is coverage, and blue displays the signed coordinate warp. This is a diagnostic false-color view, not the nebula's RGB color.
2. Inspect *Turbulence*, *Cloud filaments*, *Gas*, *Central glow*, and *Stars*. **Return to composite** restores the full image. **Probe value**, followed by a click, reads actual field numbers before tone mapping; Alt-click does the same. Raw probes require `EXT_color_buffer_float`; ordinary rendering does not.
3. Open **Ring Nebula**. Its cloud machinery is unchanged; only its geometry input is replaced. This is the smallest useful example of composition rather than merely retinting an image.
4. Open **Lensed Galaxy**. Play the timeline and inspect the lens-strength keys. At strength zero the lens coordinate map is the identity. The foreground cluster is not distorted with the background galaxy.
5. Select a numeric control and click **◆** to make a first key. Move the playhead, then change that control: a tracked parameter gets a new key at the current time. Choose smooth, linear, or hold interpolation in its animation section.
6. Open **Components**, search for **Custom scalar**, and add it. Edit `0.5 + 0.5*cos(12.0*r - t)` and apply. Isolate it, or connect it to a palette. Coordinates are explicitly connected; an unconnected socket supplies zero, not an inferred world coordinate.
7. Save the project JSON, then export PNG or a PNG sequence. PNG files from the Export dialog include the complete project and render settings as embedded text metadata.

## Editing and inspection

The left library contains scenes and components. The center contains a live canvas, a typed function graph, generated GLSL, and a timeline. The right inspector explains the selected component's intent, equation, input sockets, parameters, and animation tracks.

Connect an output dot to an input dot of the same type, or select the input in the inspector. Cycles and mismatched types are rejected. Graph layout is automatic and scrollable; this is not a free-position node-canvas editor. Components can be duplicated, disabled, deleted, isolated, or assigned as output. Numeric changes update uniforms; graph or equation changes compile a new shader. A failed custom equation does not replace the last valid project/image.

Drag the artwork to pan; scroll to zoom; **Fit** resets the camera. Hover reports displayed RGB and world coordinates. **Compare** loads a local PNG/JPEG/WebP overlay or difference view. It does not infer equations, fit parameters, or affect exported artwork. Crop a reference before loading; the overlay is stretched to the canvas rectangle.

Projects autosave opportunistically to browser storage. Browser storage can be unavailable or cleared; **Save project** is the portable backup. Reference images are session-only and are not included in the saved project. Keyboard shortcuts: Space plays/pauses; Ctrl/Cmd+S saves JSON; Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z undo/redo; Escape cancels a pending connection or isolated view when no dialog is open.

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
  compiler.js              Typed DAG → one fused fragment shader
  renderer.js              WebGL programs, uniforms, float probes, context recovery
  math-glsl.js             Low-level field, noise, shape, color and composition atoms
  source-constants.js      Float64 constant folding of source's fixed band expressions
  nebula-glsl.js            Original source nebula GPU kernels
  motifs-glsl.js            New subject-based kernels
  timeline.js              Deterministic parameter interpolation
  presets.js               Editable scene graphs
  export.js                PNG metadata and dependency-free ZIP export
  app.js                   Browser UI and editor workflows
  research.js              Evidence/provenance ledger displayed inside the app
examples/                  Saved projects and an embeddable renderer example
reference/nebula_rewrite/   Retained complete Python project and original documentation
tools/                     Build, documentation, metadata extraction and verification
tests/                     Node tests; small browser-produced verification artifacts
docs/                      Theory, recipes, API, research and measured validation
```

Browser-readable copies are included as `README.html` and `docs/*.html`, with typeset equations and no online scripts. Regenerating those reading pages is optional and uses `python3 tools/build_docs.py` with Pandoc installed.

Read [Architecture and API](docs/ARCHITECTURE.md), [Construction recipes](docs/RECIPES.md), and the [generated component catalog](docs/COMPONENTS.md). The retained [original formula reference](reference/nebula_rewrite/docs/FORMULA_REFERENCE.md) maps every source symbol to its purpose.

## Development and verification

No installation is needed to edit the source modules and serve them with `start.py`. Node 20+ is only needed for development tests and generating example JSON; Python 3.10+ builds the standalone file:

```bash
node --test tests/*.test.js
node tools/generate_catalog.js
python3 tools/build.py
python3 start.py
```

Optional browser tests need Python Playwright, NumPy and Pillow, and an installed Chromium. CPU reference tests additionally need the requirements in `reference/nebula_rewrite/`. Detailed commands, environment, measurements, and known gaps are in [Validation](docs/VALIDATION.md). The single-file distribution should be rebuilt after modifying any runtime source module, HTML, CSS, or thumbnail.

## Performance and portability

This is WebGL 2, not WebGPU. All per-pixel math runs in fragment shaders; there are no remote services or CPU-rendered preview substitutes. Dense source formulas and a large peacock fan can be expensive. Start with 480/800-pixel previews; shader compilation on the first use of a graph may pause the UI. Numeric edits then reuse linked programs. Raw probes synchronously compile/read back a field and may also pause briefly.

The app was exercised in Chromium using the real WebGL 2 API with the **ANGLE/SwiftShader software backend**, including full-resolution source comparison. No physical-GPU frame-rate claim is made. This environment blocks URL navigation by managed policy, so automated UI testing loaded the actual bundled HTML into an in-memory page without changing that policy. File-URL and localhost browser navigation were not end-to-end tested here. The HTTP launcher itself was tested separately. Safari/Firefox/iOS and hardware-GPU matrices remain untested. WebGL absence, missing float-probe support, recording codec errors, and context loss have explicit handling.

This is a procedural-art tool, not a physical astronomical/weather simulator, an automatic inverse-image-fitting system, a general 3D modeller, or a recovery of the artist's private design process.

## Attribution

The original **Bipolar Nebula** mathematical artwork is credited to **Hamid Naderi Yeganeh**. This project is independent and is not affiliated with or endorsed by the artist. New scene studies and software must not be represented as his original equations. See [Attribution](ATTRIBUTION.md) and [Research](docs/RESEARCH.md).
