# Development guide

How the code is organized, how the pieces talk to each other, and the checklist for shipping a change. [Architecture](ARCHITECTURE.md) explains the rendering model, the equation language and how to add a component; this document is about working in the repository.

## Requirements

- **Running the app:** a browser with WebGL 2. Nothing else.
- **Editing and serving the modules:** Python 3.10+ for `start.py` (standard library only).
- **Unit tests and generated files:** Node 20+ (no npm packages).
- **Browser tests and screenshots:** `python -m pip install playwright numpy pillow` and `python -m playwright install chromium`, or point `EQUATION_STUDIO_CHROMIUM` at an existing Chromium.
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
  Model and math (no DOM; covered by the Node unit tests)
  catalog.js          43 component definitions: sockets, parameters with symbols and help, steps with
                      captions, symbols, ideas, key-function curves, roles and bypass sockets, GLSL emitters
  concepts.js         the 30 recurring ideas behind the equations: formula, explanation, plot with a knob
  graph.js            project schema, validation, traversal (bypass-aware topological order, evaluation
                      order, upstream/downstream, consumers), edits, history
  expression.js       the custom equation language: parser, type checker, GLSL printer, library table
  fork.js             components as equations: the equation of a built-in component (from the catalog's
                      source), and withEquation(), the project with a component running a given equation
  compiler.js         typed DAG → one fragment program per graph structure; view state; compare pass
  looks.js            how values without colors are shown: colormaps, statistics, look pass, CPU twin
  renderer.js         WebGL 2: program cache and background compilation, views and passes, offscreen
                      snapshots / thumbnail atlas / line and point probes, asynchronous readbacks, timers
  gpu-info.js         renderer-string classification (hardware / software), software-fallback probe
  math-render.js      TeX subset → MathML with symbol roles; custom equations → MathML
  formula.js          the construction as a formula sheet (how the image is composed)
  plot.js             small SVG line plots (key functions, idea cards, the profile)
  timeline.js         keyframe interpolation, key insertion and retiming
  view-math.js        camera arithmetic: pixel ↔ world, zoom about a point, ruler ticks
  explore.js          parameter sweeps, seeded variations, original values for reset
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

  Editor (DOM; covered by the browser suites)
  editor.js           shared editor state, event bus, the canvas view model and every model operation
                      (transact, load, revert, select and step, view, enable/bypass, live parameter edits,
                      equation drafts and apply, reset, add, insert, replace, connect…)
  ui-component-view.js ComponentView: one component, explained and edited: a header that stays in view
                      (◀ step n of N ▶, include switch, title, tabs) and the tabs Equation (captioned
                      steps with colored symbols, ✎ Edit in place, parameters, key function), In & out,
                      Ideas and More (code, tracks, replace/duplicate/delete); for the component panel
                      or a pop-out window; two columns by container width
  ui-inspector.js     the component panel: a ComponentView on the right
  ui-playground.js    the panel's width: resizing, and the Equation Playground (the panel made wide,
                      with the step and profile on the canvas and the pipeline as a compact strip)
  ui-popout.js        the component panel in a separate window (following the selection or pinned)
  ui-study-link.js    double-click on any component opens the playground
  ui-canvas.js        frame rendering (the project, a draft, a preview or the original), compile indicator,
                      view switch and the label saying what the canvas shows, live badge, adaptive
                      resolution, camera gestures, rulers and readouts, hold-to-compare, canvas toolbar
  ui-look.js          the stage's automatic colors (statistics, refresh, lock) and the legend
  ui-scope.js         the profile: raw values along a line under the canvas
  ui-previews.js      the shared live-thumbnail atlas painted into pipeline and graph cards
  ui-pipeline.js      the Pipeline tab: stages in evaluation order with include checkboxes
  ui-graph.js         graph rendering, wiring, drop target, bottom-panel tabs, GLSL tab, splitter
  ui-formula.js       the Formulas tab
  ui-explore.js       the explorer tray: sweeps and variations with hover preview
  ui-performance.js   GPU labels and the GPU & performance dialog
  ui-mobile.js        the phone tab bar; touch-screen policies
  ui-tooltip.js       rich hover and long-press tips for every control (data-tip, data-key, data-toggle)
  ui-library.js       the library drawer (or docked column): scenes, components, snapshots, drag sources
  ui-timeline.js      transport and key lanes
  ui-export.js        export dialog
  ui-toolbar.js       top bar, dialogs, keyboard shortcuts
  app.js              boot: restore the session, create the renderer, frame loop, window.equationStudio
  test-entry.js       minimal bundle entry used by the GPU test harness
```

## How the editor fits together

`editor.js` owns a single `state` object (project, selection, view modes, playhead, preferences, interaction) and a tiny event bus. Panels subscribe to events and re-render themselves; they never call each other's render functions directly:

| Event | Emitted when | Typical listeners |
|---|---|---|
| `refresh` | the project was replaced or structurally edited | every panel |
| `selection` | the selected component changed | component views, graph, pipeline, canvas, tracks, legend, panel width |
| `view` | the canvas view (final / stage / effect), its lock or style changed | graph, pipeline, canvas, legend |
| `draft` | an equation draft started, changed, was applied or discarded | component views, pipeline, panel width |
| `values` | a parameter changed during a live edit (slider, symbol drag), without a history entry | component views: plots, values in the steps |
| `time` | the playhead moved | clock, lanes, live values |
| `previews` | new thumbnails were painted | component views (input thumbnails) |
| `history` | undo/redo availability changed | toolbar buttons |
| `prefs` | a persisted preference changed | canvas labels, overlay, legend, panels |

Every model change goes through `transact(edit, {structural})`: it edits a clone, validates it, pushes the previous project onto the history and only then replaces `state.project`. Structural edits (adding, wiring, deleting, enabling, equations, output) also mark the project as a custom construction so the scene list stops highlighting the preset. Continuous gestures (sliders, dragged symbols, panning, zooming) mutate the live project through `liveParam()` and friends for smooth feedback, mark `state.interacting` (which lets the canvas lower its resolution when frames are slow), and push one history entry when the gesture ends (`endLiveEdit()`).

The frame loop in `app.js` first calls `renderer.poll()` (background compilations, readbacks, GPU timers), then renders when `state.dirty` is set, refreshes the thumbnails when `state.previewsDirty` is set, updates the profile, and redraws the ruler overlay when `state.overlayDirty` is set. `markDirty()` sets all three. The canvas draws `state.baseline` while the Original button is held and `state.preview` (an explorer candidate) while one is hovered; otherwise the project in the current view. While the program for what is drawn is still compiling, `renderFrame()` keeps the last image and shows the compile indicator and progress cursor. `state.baseline` is the project as it was opened; loading a preset, file or snapshot replaces it, and undo and revert do not.

`ComponentView` renders one component from catalog metadata and the project; two instances can exist (the component panel, and a pop-out window, which has its own document). It renders only the active tab. It updates in place for `values` and `time` (numbers, plot, symbol values) so a drag never loses its pointer capture; everything else re-renders the view. Element ids used by the tests (`#nodeEnabled`, `#number-KEY`, `#param-KEY`, `#equationEditor`, `#applyEquation`, …) are stable.

Tooltips are declarative: give an element `data-tip="Heading|Body"`, optionally `data-key` for its shortcut and `data-toggle` for on/off controls, and `ui-tooltip.js` does the rest, including a long press on touch screens. Use `registerTipProvider(selector, fn)` for generated content such as the palette's equations, and `data-sym-title` on symbols. Prefer `data-tip` over `title` so tips are immediate, styled and consistent.

### Layouts

`style.css` is organized from the desktop layout down. The app is a column (top bar, layout, timeline, footer) filling the window; the layout is a grid of the work area (canvas over the bottom panel) and the component panel, whose width is the `--panel-width` variable set by `ui-playground.js` (the remembered normal or wide width, or about a quarter or half of the window). The library is a fixed drawer unless `.library-docked` adds its column (`--library-width` by breakpoint). ≤ 1100 px hides the dock option; tablets held upright (701–1100 px, portrait) put the canvas across the full width with the pipeline and panel below; phones (≤ 700 px) use one column with the canvas pinned on top, a tab bar choosing the panel and the transport pinned at the bottom; `(pointer: coarse)` enlarges touch targets and hides the pop-out button. The component view, the bottom panel's bar and the canvas legend lay themselves out by their **own** width with container queries (`cview`, `graphbar`, `image`), so the same markup works in the panel, the Playground and a pop-out window. `tools/browser_check.py` checks that neither the tablet nor the phone layout scrolls sideways and that the bottom bar ends at the bottom of the screen.

## Conventions for the bundler

`tools/build.py` is a deliberately small bundler, not a JavaScript parser. Source modules must follow these rules or the standalone build breaks:

- Import only with the named form: `import { a, b } from './module.js';`. No default imports, no namespace imports, no side-effect-only imports (`import './x.js'`), no `as` renames, no dynamic `import()`. A module that only registers listeners is included by importing one of its names (see `app.js`).
- Export only with `export const|let|class|function|async function name`. No `export { … }` lists, no default exports, no re-exports.
- Keep every module directly inside `src/`; subdirectories are not resolved.
- Do not create import cycles; modules are emitted in dependency order and evaluated once.

Style: four-space indentation, one statement per line, a doc comment on every exported function and module that explains intent or non-obvious constraints rather than restating code. Keep the model modules free of DOM access so they stay testable in Node. Keep UI strings free of claims the research ledger does not support. Files use LF line endings (`.gitattributes`).

## Tests

```bash
node --test tests/*.test.js                 # unit tests: catalog, compiler, expression, fork, formula, looks,
                                            # math, gpu-info, graph, explore, timeline, export, view
python3 tools/workflow_check.py             # editor workflows in Chromium: views, bypass without recompiling,
                                            # playground, pop-out, equations, fork, wiring, exports…
python3 tools/browser_check.py              # UI and layout checks, and the gallery screenshots
python3 tools/gpu_validate.py               # every preset, component and view on the GPU; raw fields against
                                            # the CPU reference; fork equivalence; program reuse
python3 tools/gpu_smoke.py                  # quick render of every preset to gallery/*.png
(cd reference/nebula_rewrite && python3 -m unittest discover -s tests -v)
```

The browser suites load the built `Equation Studio.html` into an in-memory page, so rebuild first. By default they use Chromium's ANGLE/SwiftShader **software** backend, for measurements that are comparable between machines; that is slow (minutes per suite). Set `EQUATION_STUDIO_HARDWARE_GPU=1` to render with the machine's GPU through the platform's ANGLE backend (Direct3D 11 on Windows, Metal on macOS, Vulkan elsewhere): much faster, but timings and rounding differ from the published report. On headless Linux, prefix with `xvfb-run -a` if ANGLE needs a display. On Windows set `PYTHONIOENCODING=utf-8` so the suites can print the app's text.

Unit tests must stay dependency-free and fast; put pure logic in a DOM-free module so it can be tested there. When adding a UI feature, add a check to `workflow_check.py` that drives it through real events.

## Regeneration checklist

Run in this order after changing source, documentation or assets:

```bash
node tools/generate_catalog.js           # docs/COMPONENTS.md and examples/projects/*.json from the catalog, ideas and presets
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
| `tools/browser.py` | Shared Chromium launcher used by all browser suites (software or hardware GPU) |
| `tools/browser_check.py`, `tools/workflow_check.py`, `tools/gpu_validate.py`, `tools/gpu_smoke.py` | Browser verification (see Tests) |
| `tools/thumbnails.py` | Small JPEG thumbnails for the scene list from the gallery PNGs |
| `tools/write_validation_report.py` | Assemble `docs/VALIDATION.md` from captured results |
| `tools/write_manifest.py` | SHA-256 manifest of every distributed file |
| `tools/read_png_project.py` | Recover a project from an exported PNG without Pillow |

## Releasing

Bump `version` in `package.json`, add a section to [CHANGELOG.md](../CHANGELOG.md), run the regeneration checklist, and commit the regenerated bundle, documentation, gallery and manifest together with the source change so that a checkout is always self-consistent.
