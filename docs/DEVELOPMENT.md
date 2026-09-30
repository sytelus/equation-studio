# Development guide

How the code is organized, how the pieces talk to each other, how to write the text the app shows, and the checklist for shipping a change. [Architecture](ARCHITECTURE.md) explains the rendering model, the equation language and how to add a component; this document is about working in the repository. The code keeps the model's names (component, parameter, bypass, playhead); the interface says part, setting, switching a part off and the time (see [Writing for the app](#writing-for-the-app)).

## Requirements

- **Running the app:** a browser with WebGL 2. Nothing else.
- **Editing and serving the modules:** Python 3.10+ for `start.py` (standard library only).
- **Unit tests and generated files:** Node 20+ (no npm packages).
- **Browser tests and screenshots:** `python -m pip install playwright numpy pillow` and `python -m playwright install chromium`, or point `EQUATION_STUDIO_CHROMIUM` at an existing Chromium.
- **HTML reading pages:** Pandoc on `PATH`, or `python -m pip install pypandoc-binary`.
- **Reference renderer tests:** `python -m pip install -r reference/nebula_rewrite/requirements.txt`.

## Run from source

```bash
python3 start.py --dev    # serves the repository on http://127.0.0.1:8765/ (loopback only) and opens src/index.html
```

`src/index.html` loads `src/style.css` and `src/app.js` as an ES module, so edits to any module or style are live after a reload. The root `index.html` is the generated single-file app (markup, styles and a bundle of the modules) and must be rebuilt after changes (see the checklist); `python3 start.py` without `--dev` serves it.

## Module map

```text
src/
  Model and math (no DOM; covered by the Node unit tests)
  catalog.js          45 component definitions: sockets, parameters with symbols and help, steps with
                      captions, symbols, ideas, key-function curves, roles and bypass sockets, GLSL emitters;
                      loopStepSpecs() for the loops of shader code
  concepts.js         the 47 recurring ideas behind the equations: formula, explanation, plot with a knob
  works.js            the 18 studied animations: credit, original and readable code, tour, ideas, tags,
                      difficulty level and Try this challenges (level, try)
  glsl.js             the shader-code language: tokens, parser, scope and type checker, loop-length
                      simulation (float32), printer with renamed/hoisted variables, loop counters, a step
                      budget, uniform numbers and a shown-value selector; formatter; number editing
  twigl-glsl.js       twigl's helpers (noise, hsv, rotations) and the code frame (codeFragCoord, codeColor)
  shader-link.js      keeps only the library items a program reaches (functions, overloads, constants)
  stats.js            measurements of raw renders: channels, histograms, loop verdicts, GPU cost shares
  encoders.js         GIF (median cut, dithering, LZW), animated PNG, MP4 (ISO BMFF) and sprite sheets
  standalone.js       a scene as a self-contained web page; shader code as a twigl file
  graph.js            project schema, validation, traversal (bypass-aware topological order, evaluation
                      order, upstream/downstream, consumers), edits, history
  expression.js       the custom equation language: parser, type checker, GLSL printer, library table;
                      the point-cloud kind (locals i, n, t)
  fork.js             components as equations: the equation of a built-in component (from the catalog's
                      source), withEquation() and withCode(): the project with a component running a given
                      equation or code
  compiler.js         typed DAG → one fragment program per graph structure; code functions, point passes,
                      linked libraries, time sampling, shown values; view state; compare pass; parameter packing
  looks.js            how values without colors are shown: colormaps, statistics, look pass, CPU twin
  renderer.js         WebGL 2: program cache and background compilation, views and passes (look, compare,
                      copy, motion), point passes, offscreen snapshots / thumbnail and time atlases / line,
                      point and time probes, measure(), asynchronous readbacks, timers
  gpu-info.js         renderer-string classification (hardware / software), software-fallback probe
  math-render.js      TeX subset → MathML with symbol roles; custom equations → MathML
  formula.js          the construction as a formula sheet (how the image is composed)
  plot.js             small SVG line plots (key curves, big-idea cards, Measure along a line)
  timeline.js         keyframe interpolation, key insertion and retiming
  view-math.js        camera arithmetic: pixel ↔ world, zoom about a point, ruler ticks
  explore.js          parameter sweeps, seeded variations, original values for reset
  graph-layout.js     deterministic layered layout and socket geometry for the graph panel
  export.js           ZIP writer, PNG metadata, frame times, downloads
  presets.js          the thirty editable scenes (twelve constructions, and a scene per work); guides:
                      the story, level and Try this challenges of each construction
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
                      equation drafts and apply, reset, add, insert, replace, connect…); what the side
                      panel shows (state.panel, showScene) and the walk-through step (state.tour, setTour);
                      plain-word helpers for the UI: firstSentence, sceneOrigin, KIND_LABELS, KIND_NAMES
  ui-scene-view.js    SceneView: the whole scene in the side panel (About this scene): credit, level and
                      check badges, welcome note, What you are seeing, Try this, How it works (steps with
                      code excerpts), How it is built, Big ideas, Where it comes from
  ui-try.js           the scene's guide and the Try this engine: sceneGuide (from works.js or presets.js
                      guides), tryAvailable, applyTry (actions set, code, view, show, build and, for
                      constructions, hide)
  ui-component-view.js ComponentView: one part, explained and edited: a header that stays in view
                      (‹ Whole scene, Part n of N, ◀ ▶, ⤢ Wide, ↗, the on/off switch, name, what it makes,
                      tabs) and the tabs Math (intro, settings, key curve, the math step by step with
                      colored symbols, ✎ Edit in place), Big ideas, and in a quieter style Connections,
                      Measure and More (shader code, keyframes, swap/duplicate/delete); Shader code
                      parts get Code and Look inside instead of Math (ui-code-view.js); for the side
                      panel or a pop-out window; two columns by container width
  ui-code-view.js     shader code in the part view: the Code tab (highlighted code with tooltips, draggable
                      numbers, loops with sliders and buildUp, time and freeze, as posted) and Look inside
                      (values on the canvas and at a pin); the walk-through: applyTour, tourBanner,
                      tourLines; highlightCode (its `only` option prints an excerpt)
  ui-stats.js         the Measure tab: values and histogram, points, over the loop, inside the code, GPU time
  ui-filmstrip.js     the frames across the animation, under the time bar (redrawn while playing too)
  ui-settings.js      high contrast, playback speed, exact numbers
  ui-inspector.js     the side panel on the right: a SceneView or a ComponentView, as state.panel says
  ui-playground.js    the panel's width: resizing, and the wide panel (formerly the Equation Playground:
                      the panel made wide, with the part and Measure along a line on the canvas and the
                      parts strip as a compact row)
  ui-popout.js        the part panel in a separate window (following the selection or pinned)
  ui-study-link.js    double-click on any part opens the wide panel
  ui-canvas.js        frame rendering (the project, a draft, a preview or the original), compile indicator,
                      view switch and the label saying what the canvas shows (WHOLE PICTURE, JUST THIS
                      PART…), live badge, adaptive resolution, camera gestures, rulers and readings (a click
                      always pins one), hold to compare, the View menu
  ui-look.js          the stage's automatic colors (statistics, refresh, lock) and the legend
  ui-scope.js         Measure along a line: raw values along a line (or at one point over time) under
                      the canvas
  ui-previews.js      the shared live-thumbnail atlas painted into pipeline and graph cards
  ui-pipeline.js      the parts strip (Parts tab): compact cards in evaluation order with on/off checkboxes
  ui-graph.js         the Wiring view: rendering, wiring, drop target; bottom-panel tabs, Shader code tab,
                      splitter
  ui-formula.js       the All the math tab
  ui-explore.js       the tray of small pictures: sweeps (▦) and Surprise me, with hover preview
  ui-performance.js   GPU labels and the GPU dialog
  ui-mobile.js        the phone tab bar (About, Parts, Math, Wiring; starts on About); touch-screen policies
  ui-tooltip.js       rich hover and long-press tips for every control (data-tip, data-key, data-toggle)
  ui-library.js       the library drawer (or a column with ⇥ Keep open): the scene gallery (easy scenes
                      first, then by kind; level badges, filters, live hover previews; opens by itself
                      until the `welcomed` preference is set; openScene starts playback), the parts
                      palette (works first, previews in the tips), snapshots
  ui-timeline.js      the time bar: play, the time in seconds, the ruler of seconds, loop, length, and the
                      keyframe lanes; Brightness and Light to color (in the View menu)
  ui-export.js        export dialog
  ui-toolbar.js       top bar, dialogs (Help, Where these came from), keyboard shortcuts
  app.js              boot: restore the session, create the renderer, frame loop, window.equationStudio
  test-entry.js       minimal bundle entry used by the GPU test harness
```

## How the editor fits together

`editor.js` owns a single `state` object (project, selection, what the side panel shows, view modes, playhead, preferences, interaction) and a tiny event bus. Panels subscribe to events and re-render themselves; they never call each other's render functions directly:

| Event | Emitted when | Typical listeners |
|---|---|---|
| `refresh` | the project was replaced or structurally edited | every panel |
| `selection` | the selected component changed, or the side panel switched between the scene and a part (`setSelected()` shows the part, `showScene()` the scene) | side panel, component views, graph, pipeline, canvas, tracks, legend, panel width |
| `view` | the canvas view (final / stage / effect / motion), its lock, its style or the shown variable changed | graph, pipeline, canvas, legend, filmstrip |
| `draft` | an equation or code draft started, changed, was applied or discarded | component views, pipeline, panel width |
| `pin` | the pinned reading on the canvas was set or cleared | Look inside (values at the pin) |
| `values` | a parameter changed during a live edit (slider, symbol drag), without a history entry | component views: plots, values in the steps |
| `time` | the playhead (the time) moved | clock, lanes, live values |
| `previews` | new thumbnails were painted | component views (input thumbnails) |
| `history` | undo/redo availability changed | toolbar buttons |
| `prefs` | a persisted preference changed | canvas labels, overlay, legend, panels |
| `tour` | the active step of a work's How it works walk-through changed (`state.tour`, `setTour()`) | side panel (scene and part views) |
| `playing` | playback started or stopped | the scene panel's Play button |

Every model change goes through `transact(edit, {structural})`: it edits a clone, validates it, pushes the previous project onto the history and only then replaces `state.project`. Structural edits (adding, wiring, deleting, enabling, equations, output) also mark the project as a custom construction so the scene list stops highlighting the preset. Continuous gestures (sliders, dragged symbols, panning, zooming) mutate the live project through `liveParam()` and friends for smooth feedback, mark `state.interacting` (which lets the canvas lower its resolution when frames are slow), and push one history entry when the gesture ends (`endLiveEdit()`).

The frame loop in `app.js` first calls `renderer.poll()` (background compilations, readbacks, GPU timers), then renders when `state.dirty` is set, refreshes the thumbnails when `state.previewsDirty` is set, updates Measure along a line, and redraws the ruler overlay when `state.overlayDirty` is set. `markDirty()` sets all three. The canvas draws `state.baseline` while ◐ Hold to compare is held and `state.preview` (a sweep or Surprise me candidate) while one is hovered; otherwise the project in the current view. While the program for what is drawn is still compiling, `renderFrame()` keeps the last image and shows the compile indicator and progress cursor. `state.baseline` is the project as it was opened; loading a preset, file or snapshot replaces it, and undo and Start over (revert) do not.

The side panel shows the whole scene or one part, as `state.panel` says (`'scene'` or `'part'`). Opening a scene with `loadProject()` sets it to `'scene'` and clears `state.tour` (undo and Start over keep both), `setSelected()` to `'part'`, and `showScene()` (the ‹ Whole scene button) back to `'scene'` without changing the selection, so the canvas views keep following the selected component. `SceneView` renders the scene from `sceneGuide()` (`ui-try.js`), the catalog and the works; `state.tour` (`{node, index}` or null) is the open step of a work's walk-through, which both the scene panel and the part's Code or Math tab show.

`ComponentView` renders one component from catalog metadata and the project; two instances can exist (the side panel, and a pop-out window, which has its own document). It renders only the active tab. It updates in place for `values` and `time` (numbers, plot, symbol values) so a drag never loses its pointer capture; everything else re-renders the view. Element ids used by the tests (`#nodeEnabled`, `#number-KEY`, `#param-KEY`, `#equationEditor`, `#applyEquation`, …) are stable.

Tooltips are declarative: give an element `data-tip="Heading|Body"`, optionally `data-key` for its shortcut and `data-toggle` for on/off controls, and `ui-tooltip.js` does the rest, including a long press on touch screens. Use `registerTipProvider(selector, fn)` for generated content such as the palette's equations, and `data-sym-title` on symbols. Prefer `data-tip` over `title` so tips are immediate, styled and consistent.

### Layouts

`src/style.css` is organized from the desktop layout down. The app is a column (top bar, layout, time bar, footer) filling the window; the layout is a grid of the work area (canvas over the bottom panel) and the side panel, whose width is the `--panel-width` variable set by `ui-playground.js` (the remembered normal or wide width, or about a quarter or half of the window). The library is a fixed drawer unless `.library-docked` (⇥ Keep open) adds its column (`--library-width` by breakpoint). ≤ 1100 px hides the Keep open option; tablets held upright (701–1100 px, portrait) put the canvas across the full width with the parts strip and panel below; phones (≤ 700 px) use one column with the canvas pinned on top, a tab bar choosing the panel (About, Parts, Math, Wiring; it starts on About) and the time bar pinned at the bottom; `(pointer: coarse)` enlarges touch targets and hides the pop-out button. The component view, the bottom panel's bar and the canvas legend lay themselves out by their **own** width with container queries (`cview`, `graphbar`, `image`), so the same markup works in the panel, the wide panel and a pop-out window. `tools/browser_check.py` checks that neither the tablet nor the phone layout scrolls sideways and that the bottom bar ends at the bottom of the screen.

## Conventions for the bundler

`tools/build.py` is a deliberately small bundler, not a JavaScript parser. Source modules must follow these rules or the standalone build breaks:

- Import only with the named form: `import { a, b } from './module.js';`. No default imports, no namespace imports, no side-effect-only imports (`import './x.js'`), no `as` renames, no dynamic `import()`. A module that only registers listeners is included by importing one of its names (see `app.js`).
- Export only with `export const|let|class|function|async function name`. No `export { … }` lists, no default exports, no re-exports.
- Keep every module directly inside `src/`; subdirectories are not resolved.
- Do not create import cycles; modules are emitted in dependency order and evaluated once.
- `src/index.html` keeps exactly one `<link rel="stylesheet" href="style.css">` and one `<script type="module" src="app.js"></script>`; the build replaces them with the inlined styles and bundle (and stops if either is missing).

Style: four-space indentation, one statement per line, a doc comment on every exported function and module that explains intent or non-obvious constraints rather than restating code. Keep the model modules free of DOM access so they stay testable in Node. Keep UI strings free of claims the research ledger does not support, and write them by the rules in [Writing for the app](#writing-for-the-app). Files use LF line endings (`.gitattributes`).

## Tests

```bash
node --test tests/*.test.js                 # unit tests: catalog, compiler, expression, fork, formula, looks,
                                            # math, gpu-info, graph, explore, timeline, export, view, glsl
                                            # (shader code), encoders (GIF/APNG/MP4, stats, web page)
                                            # guides (every scene's story, level and Try this apply to it)
python3 tools/workflow_check.py             # editor workflows in Chromium: first visit, scene panel, Try this
                                            # and undo, views, bypass without recompiling, wide panel,
                                            # pop-out, equations, fork, wiring, time bar, View menu, exports…
python3 tools/browser_check.py              # UI and layout checks, and the screenshots in gallery/
python3 tools/gpu_validate.py               # every preset, component and view on the GPU; raw fields against
                                            # the CPU reference; fork equivalence; program reuse
python3 tools/gpu_smoke.py                  # quick render of every preset to gallery/*.png
python3 tools/works_check.py --exact        # every work: original vs twigl-style shader vs readable version,
                                            # p5 sketches vs a p5.js stand-in (bit-exact on SwiftShader)
python3 tools/compare_versions.py HEAD      # the twelve 1.x scenes rendered by a git revision and by the tree
python3 tools/perf_report.py                # docs/PERFORMANCE.json: compile, number drags, points, frame times
(cd reference/nebula_rewrite && python3 -m unittest discover -s tests -v)
```

The browser suites load the built `index.html` into an in-memory page, so rebuild first. By default they use Chromium's ANGLE/SwiftShader **software** backend, for measurements that are comparable between machines; that is slow (minutes per suite). Set `EQUATION_STUDIO_HARDWARE_GPU=1` to render with the machine's GPU through the platform's ANGLE backend (Direct3D 11 on Windows, Metal on macOS, Vulkan elsewhere): much faster, but timings and rounding differ from the published report. On headless Linux, prefix with `xvfb-run -a` if ANGLE needs a display. On Windows set `PYTHONIOENCODING=utf-8` so the suites can print the app's text.

Unit tests must stay dependency-free and fast; put pure logic in a DOM-free module so it can be tested there. When adding a UI feature, add a check to `workflow_check.py` that drives it through real events. The suites drive the app through `window.equationStudio` (see [Architecture](ARCHITECTURE.md#reuse-the-renderer-without-the-editor)): `openScene(id)` opens a scene as the gallery does (it starts playing), `loadProject(project)` opens one without playing, `showScene()` shows the whole scene in the side panel, and `getView().panel` (`'scene'` or `'part'`) and `getView().tour` report what the panel shows. A new page starts with the `welcomed` preference unset, so the gallery opens by itself; close it (`#libraryClose`) or open a scene first.

`browser_check.py` writes the screenshots used by the documentation, among them `studio-welcome.png` (the first visit), `studio-desktop.png` (the Vortex with its scene panel), `studio-scene.png` (the scene panel with Try this and a step of How it works open) and `studio-part.png` (a part explained).

## Regeneration checklist

Run in this order after changing source, documentation or assets:

```bash
node tools/generate_catalog.js           # docs/COMPONENTS.md and examples/projects/*.json from the catalog, ideas and presets
python3 tools/works_check.py --exact     # docs/WORKS_VALIDATION.json (software backend: bit-exact comparison)
node tools/generate_works.js             # docs/WORKS.md from src/works.js and the verification
python3 tools/build.py                   # studio.js and index.html
node --test --test-reporter=tap tests/*.test.js > docs/NODE_TEST_RESULTS.txt 2>&1
(cd reference/nebula_rewrite && python3 -m unittest discover -s tests -v > ../../docs/CPU_TEST_RESULTS.txt 2>&1)
python3 tools/workflow_check.py          # docs/WORKFLOW_VALIDATION.json, tests/artifacts/*
python3 tools/browser_check.py           # gallery/studio-*.png (the welcome gallery, scene panel, a part, …)
python3 tools/gpu_validate.py            # docs/GPU_VALIDATION.json, gallery/*.png (works at their thumbnail time)
EQUATION_STUDIO_HARDWARE_GPU=1 python3 tools/perf_report.py   # docs/PERFORMANCE.json on the GPU
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
| `tools/build.py` | Bundle `src/` into `studio.js` and inline it with `src/style.css` into `src/index.html`, giving the single-file `index.html` |
| `tools/generate_catalog.js` | Regenerate the component catalog document and example projects |
| `tools/build_docs.py` | Render Markdown to the local HTML reading pages with MathML |
| `tools/browser.py` | Shared Chromium launcher used by all browser suites (software or hardware GPU) |
| `tools/browser_check.py`, `tools/workflow_check.py`, `tools/gpu_validate.py`, `tools/gpu_smoke.py` | Browser verification (see Tests) |
| `tools/thumbnails.py` | Small JPEG thumbnails for the gallery (constructions and works) from the gallery PNGs |
| `tools/works_check.py` | Verify every work against its original code (see Tests) |
| `tools/generate_works.js` | Write `docs/WORKS.md` from `src/works.js` |
| `tools/compare_versions.py` | Render scenes with a git revision's engine and the working tree; exit 1 on any difference |
| `tools/perf_report.py` | Measure compile times with and without linking, number drags, point passes and frame times |
| `tools/write_validation_report.py` | Assemble `docs/VALIDATION.md` from captured results |
| `tools/write_manifest.py` | SHA-256 manifest of every distributed file |
| `tools/read_png_project.py` | Recover a project from an exported PNG without Pillow |

## Adding a work

1. Add an entry to `works` in `src/works.js`: credit (`author`, `handle`, `url`, `posted`), `platform` (`twigl`, `p5` or `study`), the clip (`video`), the loop (`duration`, a period of the motion when there is one), the code exactly as posted (`original`), a `readable` version (twigl: same operations in the same order, named variables, a `//` caption on every line; p5: the point formula in the equation language), the p5 `points` settings, a `summary`, a `tour` (`at` snippets of the readable code to highlight, optional `show` and `steps`), `concepts`, `tags`, a `level` (`easy`, `medium` or `expert`: how much there is to take in) and three to five `try` challenges (the actions are listed at the top of `works.js`). Every sentence follows [Writing for the app](#writing-for-the-app). A new idea goes into `src/concepts.js`.
2. `node --test tests/*.test.js` checks that both versions parse and that their loops have the same lengths.
3. `python3 tools/works_check.py --exact --only ID` must report 0 differences for a twigl work on the software backend; look at the side-by-side PNG it writes for a p5 work.
4. Render its gallery picture (`tools/gpu_validate.py`, or a quick hardware render), run `tools/thumbnails.py`, `node tools/generate_works.js`, and add it to `ATTRIBUTION.md` and the research ledger's notes if its status differs.

A new construction gets its guide in `guides` in `src/presets.js` (`about`, `level`, `try`, with `node` in each action and `hide` to switch a part off), written by the same rules.

## Writing for the app

Every text the app shows is written for one reader: a curious thirteen-year-old who likes the animation and wants to know how it works. That covers the work summaries, walk-through steps and code captions, the parts' descriptions, step captions and setting help, the big ideas, the scene guides, the Try this challenges and the tooltips. The reader knows multiplication, negative numbers and what a coordinate (x, y) is, and may have heard of sine as “a wave”. They do not know words such as shader, GLSL, uniform, fragment, raymarch, distance field, radiance, premultiplied, float, vec2/vec3/vec4, index, domain, kernel, port, octave, fbm or SDF, and they do not know polar coordinates or what tanh, mod, fract and atan do. Explain these in plain words where they appear.

### Rules

1. Write full sentences, with a subject, a verb and an object. No telegraph style, and no strings of noun phrases joined by colons and semicolons.
2. Put one idea in each sentence. Short sentences are fine; hurried fragments are not.
3. Say what you **see** first, then how the math makes it. “The bell pulses because…” beats “12·sin(2.6d − t) moves each ring”.
4. Explain every technical word the first time it is used, in the same sentence or the next: “atan gives the angle of the pixel around the center (like the hand of a clock)”.
5. Use concrete numbers and everyday comparisons: like the hand of a clock, like a scan line on an old TV, like stacking tracing paper.
6. Give a symbol, then say what it is: “d, the distance from the top of the bell”. Keep formulas small, and never put one in a sentence without saying what it means.
7. Be friendly and direct, in the second person where it is natural: “Try dragging…”, “You will see…”.
8. No hedging jargon (“interpretive”, “structural”, “decomposed”, “at defaults”).
9. Use American spelling: color, center.
10. Keep the facts exact. Do not invent behavior; when unsure, describe literally what the code does.
11. Keep to these lengths: a summary has 4–7 sentences and a walk-through step 2–5. A code caption is one short sentence, or a clear phrase that reads as one (“Count the rows: y goes up by 1 every 99 dots.”).
12. Write numbers for people: 20,000 in prose, not 20000 or 2e4, and seconds with “s” or “seconds”.

### Examples

| Before | After |
|---|---|
| a slow second index: 0 to 202 over the 20000 points | y counts rows: it goes up by 1 every 99 dots, so over all 20,000 dots it climbs from 0 to about 202. |
| Exact structural port at defaults. Ordered soft first-hit selection produces S (texture coordinate), A (emission rim), and coverage. | This part builds the shape of the nebula: a stack of thin, glowing shells pinched in the middle like an hourglass. For every pixel it finds the first shell in front of it and reports where on that shell the pixel lands (S) and how brightly its rim glows (A). |
| Light 1/l with l the distance to the arc is huge on the arc and fades smoothly, a classic glow. | The glow comes from one division: brightness = 1 ÷ distance. Right on the arc the distance is tiny, so the brightness is huge; a little farther away it drops quickly. That is what makes the arcs look like neon tubes. |

### Words and colors in the interface

The interface uses the same words everywhere: *parts* (components), *settings* (parameters), *the parts strip* (the pipeline), *switching a part off* (bypassing), *the time* and *the time bar* (the playhead and timeline), and the views *Whole picture*, *Just this part*, *What this part adds* and *What moves*. Code, ids and file formats keep the model's names; anything a user reads uses these words. A tooltip (`data-tip="Heading|Body"`) names the control as its label does and says in a full sentence what it does.

Colors mean the same thing everywhere, so use them only for their meaning when you add UI:

| Color | CSS | Means | Used for |
|---|---|---|---|
| orange | `--change`, `.sym-par`, `.c-num` | something you can change | sliders, draggable numbers in code, setting letters in math, Try this |
| pink | `--time`, `.sym-tm` | time | t, the play button, the time bar, keyframes ◆ once set, What moves |
| blue | `--where`, `.sym-in` | what comes into a part | input letters in math, like where the pixel is |
| green | `--result`, `.sym-out` | what a part makes | outputs, the final picture, checks that passed |

Selection, tabs and menus stay neutral gray and white (`--active-bg`, `--active-line`); never use the four colors for decoration or for “selected”. The type colors of the Wiring view (`--coord`, `--scalar`, `--geometry`, `--layer`) only mark what kind of value a socket carries.

## Releasing

Bump `version` in `package.json`, add a section to [CHANGELOG.md](../CHANGELOG.md), run the regeneration checklist, and commit the regenerated bundle, documentation, gallery and manifest together with the source change so that a checkout is always self-consistent.
