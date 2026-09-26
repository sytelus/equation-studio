# Changelog

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
