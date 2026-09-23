# Editor guide

A tour of every panel, gesture and shortcut in Equation Studio. The [README](../README.md) explains what the scenes are and what is or is not reconstructed; this guide explains how to drive the editor. Everything below runs locally; nothing is uploaded.

![The editor with live previews and rulers](../gallery/studio-desktop.png)

## The four panels

| Panel | Where | Purpose |
|---|---|---|
| Library | left | Scenes to open, components to add, snapshots to return to |
| Canvas | center top | The live image, camera, rulers and readouts |
| Function graph | center bottom | The typed program that produces the image, plus the generated GLSL |
| Inspector | right | The selected component's intent, equation, inputs, parameters and animation |

The timeline runs underneath. The footer reports the GPU backend, the autosave status and the component/track counts. Drag the thin bar above the graph to give the graph more room; double-click it to reset. On narrow screens the library becomes a drawer behind the ☰ button and the panels stack vertically.

## Library

**Scenes** lists the twelve built-in constructions with their provenance status. Opening one replaces the current project; Undo returns to what you had.

**Components** lists all component kinds by category with a live search. Click one to add it: its inputs connect to the selected component when the types match, otherwise to the first compatible component, and the new component is shown isolated so you can see what it produces. Every entry can also be **dragged**:

- onto an empty part of the graph to add it, exactly like a click;
- onto an **input dot** to add it and wire its output into that socket immediately (incompatible types are refused with a message);
- onto a **component card** to wire it into that card's first compatible input, preferring an empty one;
- onto the canvas to add it without wiring.

**Snapshots** are bookmarks of the whole project, the playhead time and a thumbnail. Press **Snapshot** above the canvas (or `S`) before trying something risky, keep going, and click the snapshot later to return; Undo then steps back to where you were before restoring. Up to thirty snapshots are kept in this browser's storage. They are not part of the saved project file.

## Canvas

### View modes

The label at the top left names what is displayed.

- **COMPOSITE**: the project output through the chosen output conversion and exposure.
- **FIELD / name**: one component alone (**Isolate** in the inspector, or `I`). Layers use the output conversion; scalar, coordinate and geometry fields use the diagnostic false colors described in [Architecture](ARCHITECTURE.md). Use the readouts for real numbers.
- **CONTRIBUTION / name**: the composite rendered with and without the selected component (**Contribution** in the inspector, or `C`). *Changed pixels in color* keeps the composite where the component makes a difference and dims the rest to gray. *Signed difference* paints warm colors where the component brightens the result and cool colors where it darkens it, scaled ×4. Both compare displayed colors after exposure and tone mapping. A component that does not reach the output changes nothing, so the whole image dims; the inspector also says so.

**Return to composite**, `Escape` or the same button again leaves either mode.

### Camera

Drag to pan. Scroll or pinch to zoom about the point under the cursor, so the feature you are looking at stays put. **Fit** (`F`) restores the native framing: at 2000 × 1200 the canvas reproduces the supplied source grid exactly. The camera is part of the project and is saved, undone and redone like any other edit.

The **quality** menu sets the preview width; the height follows the 5:3 aspect ratio. Lower widths render faster but sample the same equations more coarsely, which can alias thin lines and stars. Your choice is remembered.

### Rulers, grid and readouts

**Rulers** (`R`) draw world-coordinate scales along the top and left edges with 1–2–5 tick spacing that adapts to the zoom, and a crosshair that follows the cursor with a label showing:

- the world coordinate `x, y` of the pixel center;
- the framebuffer pixel column and row (row 0 is the top);
- the displayed RGB bytes and hex color;
- when the GPU supports float readback, the **raw value of the selected component** at that point: the scalar, the coordinate pair, the geometry channels (S/warp, A/rim, coverage) or the RGBA radiance before exposure and tone mapping.

Click while rulers are on to **pin** the readout at that point. The pin stays put while you adjust parameters or scrub time and its values update with each frame; **Unpin** or `Escape` removes it. Without rulers, the bottom bar still shows the coordinate and RGB under the cursor.

**Grid** (`G`) overlays world-unit lines with the two axes highlighted. Rulers and grid are display overlays only: they are never rendered into exports.

**Probe value** in the inspector, or Alt-click at any time, reads a one-off raw value into a message without turning rulers on.

### Other canvas actions

- **Compare** loads a local PNG/JPEG/WebP as an overlay or difference view. It stretches to the canvas, so crop and align the source first. It never affects exports and is discarded when the page closes.
- **Copy** puts the current preview on the clipboard as a PNG (browser permitting).
- ⛶ expands the canvas over the other panels; press it again to return.

## Function graph

The graph is laid out automatically: components sit in the column of their dependency depth, in project order. There are no saved positions to manage. Cards carry a colored left edge and dots colored by type: blue coordinates, amber scalars, violet geometry, green layers.

- **Select** a card to inspect it. Hovering a card dims everything that is neither upstream nor downstream of it, which makes the data flow of a busy graph readable at a glance.
- **Wire** by dragging from an output dot to an input dot; compatible sockets light up while you drag. Clicking an output dot and then an input dot also works. Drag a wire off an input dot to disconnect it, or drop it on another input to move it. Types must match, and a connection that would form a cycle is refused and the previous state restored.
- **Previews** (`P`) shows a live thumbnail of every component's output on its card, using the same diagnostic conversions as isolation. All thumbnails come from one shared shader, so the first switch-on compiles once and later edits only re-render. Thumbnails follow the playhead at half rate during playback. Turn previews off on slow machines.
- **Locate** (`L`) scrolls to the selected card. **＋ Component** opens the palette.
- **Generated GLSL** shows the fused fragment shader for the current view; **Copy GLSL** copies it. Each component's statement is labelled with its ID.

## Inspector

The title is editable. Beneath it are the component's intent, its equation in the notation of the [component catalog](COMPONENTS.md), and the actions **Isolate**, **Contribution**, **Set as output**, **Disable/Enable** and **Probe value**. A note appears when the component does not reach the output.

**Input connections** are menus of compatible components; *Unconnected · zero* means the socket contributes a typed zero, not an implicit world coordinate.

**Parameters**:

- Numbers have a slider, a numeric field, a ◆ key button and a ↺ reset (visible on hover) that restores the catalog default. Dragging a slider updates the image live and creates one undo step when released.
- Colors are linear radiance multipliers; the hex value is shown next to the picker.
- Custom equations have a GLSL expression editor with a helper menu that inserts the available functions at the cursor. **Apply** or `Ctrl/⌘ Enter` compiles; a failed compile shows the driver message and leaves the previous image in place.

**Animation tracks** appear for parameters with keys: choose smooth, linear or hold interpolation, jump to a key, delete a key or remove the whole track. **Duplicate** (`Ctrl/⌘ D`) and **Delete component** (`Delete` while the graph has focus) are at the bottom.

## Timeline

Space plays and pauses; ↤ rewinds; the scrubber and the clock show the playhead. `,` and `.` step one frame at 24 fps; `Home` and `End` jump to the ends. The duration field, **Loop** checkbox, output conversion (Source, Filmic, Linear) and exposure slider are project settings.

Each keyed parameter gets a lane. Click a lane to seek, click a key to jump to it, and **drag a key** to retime it; dropping it on another key replaces that key. Tracked values are shown live in the inspector during playback. See [Animation](ANIMATION.md) for the interpolation rules and export determinism.

## Export

**Export** opens a dialog for a still PNG at any size up to the GPU limit (with the full project embedded as metadata), a deterministic PNG sequence in a ZIP with the project and a manifest, or a real-time browser video recording. When an isolated field or a contribution view is active, a checkbox exports that view instead of the composite. Details and limits are in [Animation and export](ANIMATION.md).

## Keyboard shortcuts

Single-key shortcuts apply when no text field or dialog is active.

| Keys | Action |
|---|---|
| `Space` | Play / pause |
| `Home` / `End` | Go to the start / end |
| `,` / `.` | Step one frame back / forward |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z` | Undo, redo |
| `Ctrl/⌘ S` | Save the project JSON |
| `Ctrl/⌘ D` | Duplicate the selected component |
| `Delete` / `Backspace` | Delete the selected component (graph focused) |
| `I` | Isolate the selected component |
| `C` | Contribution view of the selected component |
| `P` | Toggle graph previews |
| `R` / `G` | Toggle rulers / grid |
| `F` | Fit the camera |
| `S` | Take a snapshot |
| `L` | Locate the selected component in the graph |
| `Escape` | Cancel a pending connection, unpin the probe, or return to the composite |
| `Alt`-click canvas | One-off raw probe of the selected component |

## What is remembered

The project autosaves to this browser's storage a moment after every edit, and reopens on the next visit. Preferences (preview quality, rulers, grid, previews, graph height) and snapshots are stored the same way. Browser storage can be unavailable or cleared, so **Save project** remains the portable backup, and reference images are never stored at all.
