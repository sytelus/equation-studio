# Changelog

## 1.4.0 — 25 September 2026

Clarity release: editing an equation is one obvious action on the equation itself, and the layout is calmer, with the screen always saying where you are. Projects from earlier versions open unchanged and render identically.

### Edit the equation you are reading

- **✎ Edit** sits in the heading of every equation (or double-click the equation). It opens the equation as text right where the steps were, for custom equations and built-in components alike, and the panel widens to give it room.
- **Built-in components open as their own math**, line for line with the steps: the vortex as `alpha = kappa*exp(-(r/rho)^2) + omega*t` and `rotate2(p, alpha)`, the warp as two noises and `p + A*d`, and so on for 14 components (the others, loops over lattices or whole scenes, open as a call of their shader function). The GPU validation checks that all 29 render exactly the same values as the built-ins. In 1.3, “Edit as equation” was at the bottom of the inspector and produced a one-line kernel call.
- **The canvas previews the edit** as a draft (labelled DRAFT) a moment after you pause typing, while the typeset lines update at once; **Apply** (Ctrl/⌘ Enter) puts it into the scene as one undo step, **Cancel** discards it. Drafts survive looking at other components (the pipeline marks them ✎). Nothing changes before Apply, and an equation with an error is never applied.
- Editing a `param` line’s default now sets the parameter to it; unchanged lines keep the slider’s value.
- A dimmed ✎ Edit explains why a component cannot be an equation (it reads a color layer or geometry).
- The component catalog lists each editable component’s equation.

### Always know where you are

- **Selecting never changes the canvas.** Clicking a component anywhere (pipeline, graph, formulas, the panel) selects it; the canvas keeps showing what you chose above it: **Final image**, **This step** (named, e.g. *Step 7 · Folded star lattices*) or **What it changes**, the last two following the selection. In 1.3 a pipeline click switched the canvas to that stage while a graph click did not.
- **A label on the canvas** says what it shows: FINAL IMAGE, THIS STEP, WHAT IT CHANGES, DRAFT, PREVIEW or ORIGINAL.
- **The component panel** has a header that stays in view: **◀ Step 7 of 9 ▶**, the include switch, the title and type. Its content is in four tabs (**Equation**, **In & out**, **Ideas**, **More**) instead of twelve stacked sections, starts at the top for each component and keeps the tab you chose.
- **The Equation Playground is the same panel, made wide** (⤢ or `E`), with the step and its profile on the canvas and the pipeline as a compact strip of step names. It no longer moves the inspector into a separate layout with its own navigation.
- Pipeline cards mark the step on the canvas (👁) and unapplied edits (✎). Clicking a card’s name selects it; only the checkbox includes or bypasses it (clicking the name used to toggle the checkbox).
- `[` and `]` select the previous and next component; `Esc` backs out one level at a time.
- The browser tab and the top bar name the scene; its provenance label opens the research notes.

### More room for the image

- **The library is a drawer** (☰ Scenes, or ＋ Component), closed after a choice, or docked as a column if you prefer.
- One toolbar above the canvas; the pipeline’s controls moved into its tab bar; no empty row in the timeline; the pipeline’s height adapts to the window. At 1440 × 900 the canvas grows from 500 × 300 to 638 × 383 pixels.
- The component panel is resizable (drag its edge) and sizes itself to the window by default.

### Fixes

- The Generated GLSL tab is now called Shader.
- Pipeline arrows stay level with the thumbnails in a tall bottom panel.

### Code, tests and documentation

- `fork.js`: `forkBlocker()`, `equationSource()` and `withEquation()`, the one operation behind the draft preview and Apply; catalog entries gained `source`.
- `editor.js`: equation drafts (`setDraft`, `startEdit`, `discardDraft`, `draftChanged`) and `selectStep`; `ui-playground.js` now manages the panel width; `ui-library.js` the drawer.
- Unit tests grow to 259 (sources, withEquation, parameter merging). The workflow suite’s checks were rewritten for the new behavior (selection model, canvas label, tabs, in-place editing with a draft, the Playground, the drawer). The screenshot suite adds the library drawer and editing a built-in.
- The editor guide, README, architecture, development guide, recipes and catalog were updated.

## 1.3.0 — 25 September 2026

Understanding and editing release: every equation now explains itself line by line, shows where its values come from and go, and can be edited; a new Equation Playground and pop-out window give it room; and the renderer was rebuilt so that interacting never freezes the page. Projects from 1.0–1.2 open unchanged and render identically (every stage, bypass and “what it changes” view of all twelve scenes matches 1.2 within one level of 255). Projects that use the new equation features need 1.3.

### Understand what each equation does

- **How it is computed**: each component’s equation is shown as numbered steps, each with a plain-language caption saying what the line computes and why; the result line is marked **⇒**. All 43 components were documented this way, e.g. *Folded star lattices*: fold the plane with arccos cos → distance to the lattice point → a star core and halo per lattice.
- **Colored symbols**: inputs in the color of their type, parameters in peach, the output bold, time in pink. Hover a symbol to light it up everywhere, click an input to open the component that feeds it, and **drag a parameter symbol sideways to change it** (Shift for fine steps). **Values** replaces every parameter symbol by its live number.
- **Data flow**: where each input comes from (with thumbnails) and where the output goes, with the downstream equation that uses it: *T is read by Add light as B in RGB = A + gB*.
- **Why it is written this way**: 30 recurring ideas (the double-exponential gate, Gaussian bumps, folding with arccos cos, backward mapping, fractal noise, front-to-back selection, logarithmic spirals, …), each explained with a formula and a small plot with a knob to play with.
- **Key function**: a live plot of the one-dimensional function at the heart of a component (a threshold’s S-curve, a ring’s profile, a star’s core and halo, a vortex’s twist, a stream’s width), redrawn as parameters change.
- **Formulas** tab: the whole construction as a formula sheet: how the image is composed (*image = Gas emission + Central glow + Folded star lattices*), then every component’s equation with each input bound to the component that feeds it.

### See the values, not just their colors

- **Automatic stage colors**: a scalar stage is shown with a colormap over its actual range, diverging (cool below zero, dark at zero, warm above) when it takes both signs, with contour lines drawn only where the field actually crosses a level between neighboring pixels (so flat regions and decaying tails are never hatched); coordinates as the image of a regular grid with the q_x = 0 and q_y = 0 axes; geometry by channel; a clipped or black layer with adjusted exposure (labelled). The legend shows the range, a histogram, and a lock to compare parameter values fairly. Classic colors remain one click away.
- **Thumbnails** in the Pipeline and graph use the same looks, each over its own range, so *Filaments & haze* is no longer a white rectangle and the turbulence no longer saturates to black and white.
- **Profile** (`V`): a plot under the canvas of the shown component’s raw values along the line through the cursor or the pinned reading.

### Equation Playground and pop-out

- **⤢ Playground** (`E`, or double-click any component): a wide study layout for one component: the canvas shows its stage with the profile under it, and the explanation, editor and controls get two columns beside it. A strip of chips walks the construction in evaluation order.
- **↗ Pop out**: the explanation in a separate window, e.g. on a second screen; it follows the selection (or pins a component) and its controls edit the scene.

### Edit equations

- **✎ Edit as equation**: turns any of 29 built-in components into an equivalent custom equation (verified to render identical values on the GPU), with its parameters named after their symbols (κ → `kappa`), then change it line by line.
- **The equation language** gained parameters, definitions and captions:
  `param width = 0.1 [0.01, 1]` adds a slider (animatable, sweepable, part of variations), `param tint = #ffd080` a color, `d = length(p) - 1` a definition, `// …` a caption shown next to the typeset line. Whole numbers need no decimal point, `x^2` is a power (exact for negative x), `%` is mod, and every function of the shader libraries can be called (`fbm`, `rotate2`, `waterPlanet`, …). Equations are parsed, type-checked with readable messages (*“Unknown name raduis. Did you mean radius?”*) and re-printed as GLSL, never pasted into the shader.
- The editor shows the typeset steps and a **live preview** of the edited component as you type, compiled in the background; Apply commits it.
- New custom components start from a short example written in the language (sliders, a definition, captions), and *Kaleidoscope garden*’s two equations are written this way too (same image as before), as *Interference petals* and *Rainbow color*.

### Performance and hardware

- **One compiled program per graph structure** serves every view: ticking and unticking components, walking the stages, “what it changes”, thumbnails and probes change uniforms only. Fixes the reported freeze: on Direct3D, unticking a checkbox stalled the page for 4–8 seconds while two new shaders compiled; it now takes a few milliseconds.
- **Background compilation** (`KHR_parallel_shader_compile` plus a fenced warm-up draw): wiring edits and scene changes keep the page responsive; the last image stays up with a **Compiling shader…** indicator and a progress cursor. Browsers without the extension show the indicator before compiling.
- The program stays lean (colormaps and comparisons are small fixed post passes), so a whole scene compiles about as fast as a single view did in 1.2.
- **GPU detection**: the LIVE badge says **GPU** or **SOFTWARE**, the footer names the graphics processor and API, and a **GPU & performance** dialog lists capabilities, exact GPU frame times (timer queries where available), compiled programs and advice for enabling hardware acceleration.
- **Auto quality** (new default) renders at the display’s pixel density, and drops resolution during a drag or playback when frames are slow, refining when you let go. Thumbnails, probes and statistics read back without blocking.

### Screens and devices

- Wider inspector on large screens; container-aware layouts for the explanation and the legend.
- **Tablets in portrait** put the canvas across the full width with the panels below.
- **Phones**: the canvas stays pinned at the top while one panel at a time (Pipeline, Inspect, Formulas, Graph) scrolls under it, pipeline stages wrap two to a row, and a compact transport stays at the bottom of the screen; the playground stacks.
- **Touch**: larger targets; press and hold any control for its explanation. Phones and tablets use the playground instead of pop-out windows (which would open as hidden tabs), so the pop-out buttons are hidden there.

### Fixes

- Typesetting: operator names get TeX spacing (“arccos cos”, not “arccoscos”), spaces at the ends of text are kept (“scaled p”), and long equations wrap at their natural breaks instead of overflowing.
- The LIVE badge reported CPU submission time (“<1 ms”) as the frame time; it now reports GPU time.
- The frame loop no longer forces a layout on every frame: not to size the canvas, not to draw the rulers, and not to restart the LIVE badge’s pulse.
- A tooltip that was still waiting for its delay was not cancelled when the pointer moved onto something without a tip, so it could appear later over the wrong place (e.g. a pipeline card’s tip while the pointer was on the canvas).
- Browser video export retries a recording pass that delivers no frames (Chromium’s first canvas capture after a pop-up window closed can be empty), instead of failing.
- Captions set TeX-style indices as sub- and superscripts (L<sub>s</sub>, |U|<sup>η</sup>).

### Code, tests and documentation

- New modules: `looks.js` (colormaps, statistics, display conversion twin), `gpu-info.js`, `expression.js` (the equation language), `fork.js`, `concepts.js`, `plot.js`, `formula.js`, and the UI modules `ui-component-view.js`, `ui-look.js`, `ui-scope.js`, `ui-playground.js`, `ui-popout.js`, `ui-formula.js`, `ui-performance.js`, `ui-mobile.js`. `compiler.js` gained `compileProgram`; `compileGraph` now returns the program for one view’s subgraph (modes are chosen at draw time). The renderer gained `programFor`, `poll`, `whenReady`, `drawIfReady`, `sampleLine`, `rawImage` and asynchronous readbacks.
- The bundle uses no regular-expression lookbehind, so Safari before 16.4 can still load it (the layout needs Safari 16).
- `makeNode()` gives a custom node the declared values of its equation’s parameters; the renderer releases pending compilations, readbacks and timer queries when it is disposed or a program is evicted.
- Unit tests grow from 177 to 253 (equation language, forking, looks, formula sheet, GPU classification, catalog content). The workflow suite grows from 24 to 35 browser checks, GPU validation checks program reuse, subgraph/whole-graph agreement, line probes, float thumbnails and fork equivalence, and the screenshot suite checks the tablet and phone layouts (no sideways scrolling, bottom bar at the bottom) and the two-column playground.
- `EQUATION_STUDIO_HARDWARE_GPU=1` now really selects the hardware GPU in headless Chromium.
- The editor guide, architecture, development guide, recipes and README were rewritten for the new features; the component catalog now includes every step’s explanation and the ideas behind each component.

## 1.2.0 — 24 September 2026

Usability release focused on understanding a construction and experimenting safely. The project format is unchanged; 1.0 and 1.1 files open as before. The one behaviour change: **disabling a component now bypasses it** instead of replacing its output with zero (see below).

### See what every step produces

- **Pipeline** tab, now the default bottom panel: every component in evaluation order with a live thumbnail of its output, what it feeds, and an include checkbox. Click a card to show that stage; `[` and `]` step through the construction.
- **View switch** above the canvas: *Final image*, *This stage* and *What it changes*, following the selection, with a lock to keep watching one component while editing another. You no longer need *Set as output* to look at a component.
- A **legend** explains the false colors of scalar, coordinate and geometry stages and of the change view.
- A **LIVE GPU** badge with frame time and counter pulses on every frame, so it is always clear the image is computed live.
- Previews, rulers and grid are **on by default** (returning users get the new defaults once).

### Understand each component

- **Typeset equations** (native MathML, offline) for all 43 components, with a *where* list naming every symbol, its parameter and its live value, plus inputs and fixed constants. A **GLSL** toggle shows the component's shader code.
- **Every parameter explains itself**: plain-language help text, its symbol in the equation, its range, and its original value as a marker on the slider.
- **Custom equations** are typeset live above the editable text as you type.
- **Rich tooltips** on every control: what it does, its shortcut, and whether a toggle is on. Palette tips show each component's equation.

### Experiment safely

- **↺ Reset** on every parameter, always visible when the value differs from the original (the scene as opened, or the catalog default for added components); **Reset all** per component; double-click a label to reset.
- **◐ Original**: hold the button or `O` to compare with the scene as opened. **⟲ Revert** restores the scene, keeps your selection and view, and is undoable.
- **▦ Sweep** renders the image across a parameter's whole range; **✦ Variations** renders random nearby versions of a component or the whole scene. Hover to preview on the canvas, click to apply; the explorer sits below the canvas instead of covering it.
- **Include / bypass checkboxes** everywhere, with **All**, **Only structure** (bypass content, keep coordinates, combiners and modifiers, then build the image up) and **Original**. Including a component also includes what it needs.

### Compose

- **Insert** a modifier on any connected input (＋), and **Replace with…** another component of the same output type while keeping its wiring.
- Graph cards gain an include checkbox and a 👁 button that shows the stage.

### Behaviour change: disabled means bypassed

A disabled modifier (coordinate maps, tint, mask, threshold, custom coordinate) now passes its input through; a disabled combiner passes its main input (Add → A, Over → back, Combine → a); disabled content still outputs zero. Previously every disabled node output zero, so disabling a warp collapsed all coordinates to the origin. The contribution view compares against the bypassed graph for the same reason. Saved projects with disabled modifiers render differently; nothing else changes.

### Engine, code and tests

- `catalog.js` restructured into named fields with `tex`, `notes`, `symbol`, `help`, `role` and `bypass`; new `math-render.js`, `explore.js`, `ui-tooltip.js`, `ui-pipeline.js`, `ui-previews.js` and `ui-explore.js`; `graph.js` gains `activeInputs`, `evaluationOrder` and `consumers`.
- Larger, more readable type throughout; the canvas toolbar keeps rarely used actions in a ⋯ menu.
- Unit tests grow to 177 (catalog consistency, TeX and expression typesetting, bypass, sweeps and variations); the browser workflow suite drives 24 checks through real events, including every new tool; GPU validation adds bypass and identity-contribution checks.
- Docs: the editor guide is rewritten around the pipeline, views, bypass and exploration tools; README, architecture, development, recipes and the component catalog (now with typeset equations and symbol tables) are updated.

## 1.1.0 — 23 September 2026

Exploration and editing release. The project format is unchanged: every 1.0 project file and export opens as before.

### Seeing what each component does

- **Live previews** in the graph: a thumbnail of every component's output on its card, all rendered from one shared shader and following the playhead.
- **Contribution view**: render the composite with and without one component and show only the pixels it changes, or a signed warm/cool difference. Exportable like any other view.
- **Rulers and grid** in world coordinates with a crosshair readout of position, pixel, displayed color and the selected component's raw field values; click to pin a probe that updates as you edit.
- The inspector warns when a component does not reach the output.

### Building graphs

- **Drag and drop** components from the library onto the graph, onto an input dot (wired immediately) or onto a card.
- **Drag wiring** between dots, drag a wire off an input to disconnect it; compatible sockets light up while dragging. Click-to-connect still works.
- Hovering a card dims everything that is not upstream or downstream of it. Cards and dots are colored by type.
- Resizable graph panel, **Locate** for the selected component, keyboard delete and duplicate.

### Exploring variations

- **Snapshots**: bookmark the project state with a thumbnail and return to it later, from a new library tab.
- **Zoom about the cursor** with the wheel or a pinch; parameter **reset** buttons; expression helper menu and `Ctrl/⌘ Enter` to apply.
- **Drag keys** along their timeline lane; click a lane to seek; step frames with `,` and `.`.
- Live inspector values during playback without losing focus or unapplied edits; undo and redo keep the playhead and selection.
- Copy the preview to the clipboard; more keyboard shortcuts (see the [editor guide](docs/EDITOR_GUIDE.md)).
- Video export draws each frame at its exact time `i/FPS` and pushes it to the recorder explicitly, reports how many frames were drawn, and falls back to compositor capture if a browser delivers nothing.

### Engine and code

- Probes, snapshots and previews render into offscreen framebuffers and never disturb the visible canvas.
- `compileGraph` gained `contribution` and `preview` modes; the renderer gained `snapshot()`, `previewAtlas()`, an options object for `draw()` and a larger program cache.
- The editor is split into focused modules around a shared state and event bus (`src/editor.js`, `src/ui-*.js`), with camera and layout arithmetic in testable DOM-free modules.
- The kaleidoscope emitter uses a shared `angularMirror` GLSL helper instead of a duplicated expression.
- Fixes: the bundler now handles `$` identifiers and reads and writes UTF-8 explicitly on every platform; undo no longer resets the playhead and selection; keyboard focus survives graph re-rendering.

### Tests, tools and documentation

- Unit tests are organized by module and extended to 100 cases (camera math, layout, compile modes, key retiming, snapshots, traversal helpers).
- Browser suites share a Chromium launcher that also finds Playwright's bundled browser; `workflow_check.py` drives every new interaction through real pointer events.
- `write_validation_report.py` derives every figure from captured results; `write_manifest.py` regenerates the file manifest.
- New [Editor guide](docs/EDITOR_GUIDE.md) and [Development guide](docs/DEVELOPMENT.md); README, architecture and animation documents updated.

## 1.0.0 — 22 September 2026

Initial release: GPU port of the supplied Bipolar Nebula equations, eleven further editable scenes, the typed function-graph editor, animation, exports and the retained Python reference.
