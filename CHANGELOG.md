# Changelog

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
