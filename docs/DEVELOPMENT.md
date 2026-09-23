# Development guide

How the code is organized, how the pieces talk to each other, and the checklist for shipping a change. [Architecture](ARCHITECTURE.md) explains the rendering model and how to add a component; this document is about working in the repository.

## Requirements

- **Running the app:** a desktop browser with WebGL 2. Nothing else.
- **Editing and serving the modules:** Python 3.10+ for `start.py` (standard library only).
- **Unit tests and generated files:** Node 20+ (no npm packages).
- **Browser tests and thumbnails:** `python -m pip install playwright numpy pillow` and `python -m playwright install chromium`, or point `EQUATION_STUDIO_CHROMIUM` at an existing Chromium.
- **HTML reading pages:** Pandoc on `PATH`, or `python -m pip install pypandoc-binary`.
- **Reference renderer tests:** `python -m pip install -r reference/nebula_rewrite/requirements.txt`.

## Run from source

```bash
python3 start.py          # serves the repository on http://127.0.0.1:8765/ (loopback only)
```

`index.html` loads `src/app.js` as an ES module, so edits to any module are live after a reload. `Equation Studio.html` is a generated bundle of the same code and must be rebuilt after changes (see the checklist).

## Module map

```text
src/
  catalog.js          43 component definitions: sockets, parameters, equation text, GLSL emitter
  graph.js            project schema, validation, traversal (topological order, upstream/downstream), edits, history
  compiler.js         typed DAG → one fragment shader; display, raw, contribution and preview modes
  renderer.js         WebGL 2 programs and cache, visible draw, offscreen snapshot / preview atlas / float probe
  timeline.js         keyframe interpolation, key insertion and retiming
  view-math.js        camera arithmetic: pixel ↔ world, zoom about a point, ruler ticks
  graph-layout.js     deterministic layered layout and socket geometry for the graph panel
  export.js           ZIP writer, PNG metadata, frame times, downloads
  presets.js          the twelve editable scenes
  snapshots.js        snapshot list management and thumbnails
  math-glsl.js        shared GLSL atoms (noise, shapes, composition, display curves)
  source-constants.js float64 constant folding for the source nebula
  nebula-glsl.js      source nebula kernels
  motifs-glsl.js      new subject-study kernels
  research.js         evidence ledger shown in the app
  thumbnails.js       generated JPEG data URLs for the scene list

  editor.js           shared editor state, event bus and every model operation (transact, load, select, add, connect…)
  ui-library.js       scenes / components / snapshots panel, drag sources
  ui-canvas.js        frame rendering, camera gestures, rulers and readouts, compare, canvas toolbar
  ui-graph.js         graph rendering, previews, wiring, drop target, GLSL tab, splitter
  ui-inspector.js     inspector rendering and parameter editing
  ui-timeline.js      transport and key lanes
  ui-export.js        export dialog
  ui-toolbar.js       top bar, dialogs, keyboard shortcuts
  app.js              boot: restore the session, create the renderer, frame loop, window.equationStudio
  test-entry.js       minimal bundle entry used by the GPU test harness
```

The first group has no DOM dependency and is covered by the Node unit tests. The `ui-*.js` modules touch the DOM and are exercised by the browser suites.

## How the editor fits together

`editor.js` owns a single `state` object (project, selection, view modes, playhead, preferences) and a tiny event bus. Panels subscribe to events and re-render themselves; they never call each other's render functions directly:

| Event | Emitted when | Typical listeners |
|---|---|---|
| `refresh` | the project was replaced or structurally edited | every panel |
| `selection` | the selected component changed | inspector, graph, tracks |
| `view` | isolation or contribution mode changed | inspector, graph, canvas labels |
| `time` | the playhead moved | clock, lanes, live inspector values |
| `history` | undo/redo availability changed | toolbar buttons |
| `prefs` | a persisted preference changed | canvas labels and overlay |

Every model change goes through `transact(edit, {structural})`: it edits a clone, validates it, pushes the previous project onto the history and only then replaces `state.project`. Structural edits (adding, wiring, deleting, enabling, expressions, output) also mark the project as a custom construction so the scene list stops highlighting the preset. Continuous gestures (sliders, panning, zooming) mutate the live project for smooth feedback and push one history entry when the gesture ends.

The frame loop in `app.js` renders when `state.dirty` is set, refreshes graph previews when `state.previewsDirty` is set, and redraws the ruler overlay when `state.overlayDirty` is set. `markDirty()` sets all three.

## Conventions for the bundler

`tools/build.py` is a deliberately small bundler, not a JavaScript parser. Source modules must follow these rules or the standalone build breaks:

- Import only with the named form on one line: `import { a, b } from './module.js';`. No default imports, no namespace imports, no dynamic `import()`.
- Export only with `export const|let|class|function|async function name`. No `export { … }` lists, no default exports, no re-exports.
- Keep every module directly inside `src/`; subdirectories are not resolved.
- Do not create import cycles; modules are emitted in dependency order and evaluated once.

Style: four-space indentation, one statement per line, comments that explain intent or non-obvious constraints rather than restating code. Keep UI strings free of claims the research ledger does not support.

## Tests

```bash
node --test tests/*.test.js                 # unit tests: graph, compiler, timeline, export, view math, layout, snapshots
python3 tools/workflow_check.py             # editor workflows in Chromium: keys, wiring, drag-and-drop, previews, exports…
python3 tools/browser_check.py              # UI checks and the gallery screenshots
python3 tools/gpu_validate.py               # renders every preset and component, raw-field and native-image comparison
python3 tools/gpu_smoke.py                  # quick render of every preset to gallery/*.png
(cd reference/nebula_rewrite && python3 -m unittest discover -s tests -v)
```

The browser suites load the built `Equation Studio.html` into an in-memory page, so rebuild first. They force the ANGLE/SwiftShader software backend for comparable measurements; set `EQUATION_STUDIO_HARDWARE_GPU=1` to use the browser's own backend (much faster, but timings and rounding differ from the published report). On headless Linux, prefix with `xvfb-run -a` if ANGLE needs a display.

Unit tests must stay dependency-free and fast; put pure logic in a DOM-free module so it can be tested there. When adding a UI feature, add a check to `workflow_check.py` that drives it through real events.

## Regeneration checklist

Run in this order after changing source, documentation or assets:

```bash
node tools/generate_catalog.js           # docs/COMPONENTS.md and examples/projects/*.json from catalog.js and presets.js
python3 tools/build.py                   # studio.js and Equation Studio.html
node --test --test-reporter=tap tests/*.test.js > docs/NODE_TEST_RESULTS.txt 2>&1
(cd reference/nebula_rewrite && python3 -m unittest discover -s tests -v > ../../docs/CPU_TEST_RESULTS.txt 2>&1)
python3 tools/workflow_check.py          # docs/WORKFLOW_VALIDATION.json, tests/artifacts/*
python3 tools/browser_check.py           # gallery/studio-*.png
python3 tools/gpu_validate.py            # docs/GPU_VALIDATION.json, gallery/*.png
python3 tools/thumbnails.py              # src/thumbnails.js from gallery/*.png, then rebuild once more
python3 tools/build.py
python3 tools/write_validation_report.py # docs/VALIDATION.md from the captured results
python3 tools/build_docs.py              # README.html, docs/*.html
python3 tools/write_manifest.py          # MANIFEST.json, always last
```

`docs/FAILURE_VALIDATION.json` and `docs/HTTP_VALIDATION.json` record two manual checks: the app with WebGL deliberately unavailable, and the loopback server's headers and port handling.

## Tools

| Script | Purpose |
|---|---|
| `tools/build.py` | Bundle `src/` into `studio.js` and inline it with the CSS into `Equation Studio.html` |
| `tools/generate_catalog.js` | Regenerate the component catalog document and example projects |
| `tools/build_docs.py` | Render Markdown to the local HTML reading pages with MathML |
| `tools/browser.py` | Shared Chromium launcher used by all browser suites |
| `tools/browser_check.py`, `tools/workflow_check.py`, `tools/gpu_validate.py`, `tools/gpu_smoke.py` | Browser verification (see Tests) |
| `tools/thumbnails.py` | Small JPEG thumbnails for the scene list from the gallery PNGs |
| `tools/write_validation_report.py` | Assemble `docs/VALIDATION.md` from captured results |
| `tools/write_manifest.py` | SHA-256 manifest of every distributed file |
| `tools/read_png_project.py` | Recover a project from an exported PNG without Pillow |

## Releasing

Bump `version` in `package.json`, add a section to [CHANGELOG.md](../CHANGELOG.md), run the regeneration checklist, and commit the regenerated bundle, documentation, gallery and manifest together with the source change so that a checkout is always self-consistent.
