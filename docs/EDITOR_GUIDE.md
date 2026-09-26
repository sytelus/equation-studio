# Editor guide

A tour of every panel, gesture and shortcut in Equation Studio. The [README](../README.md) explains what the scenes are and what is or is not reconstructed; this guide explains how to read, explore and edit a construction. Everything runs locally; nothing is uploaded. Hover any control in the app for a short explanation of what it does, its shortcut, and whether it is currently on.

![The editor: final image with rulers, the live pipeline, and the typeset equation](../gallery/studio-desktop.png)

## Is the picture live?

Yes. The canvas is computed on your GPU from the equations every time anything changes: a parameter, a wire, the camera, the playhead. The **LIVE GPU** badge in the corner of the image shows the resolution, the time the last frame took and a frame counter, and its dot pulses on each new frame. There is no stored picture behind the canvas. The only saved pictures are the small scene thumbnails in the library.

## The panels

| Panel | Where | Purpose |
|---|---|---|
| Library | left | Scenes to open, components to add, snapshots to return to |
| Canvas | center top | The live image, its view switch, rulers, readouts and the explorer |
| Pipeline / Function graph / GLSL | center bottom | Every component's output in order; how components are wired; the generated shader |
| Inspector | right | The selected component explained and edited |

The timeline runs underneath. The footer reports the GPU backend, the autosave status and the component and track counts. Drag the thin bar above the bottom panel to resize it; double-click to reset. On narrow screens the library becomes a drawer behind ☰ and the panels stack.

## Reading a construction

### The Pipeline

The **Pipeline** tab, open by default, lists every component in evaluation order, each after everything it reads. Each card shows:

- a checkbox to include or bypass the component, its step number and label;
- a **live thumbnail of that component's output**, what the image is at that stage;
- its output type and what it feeds (for example “feeds Gas emission · cloud”);
- **FINAL** on the scene's output, **UNUSED** on components nothing uses.

Click a card to show that stage on the canvas. `[` and `]` step to the previous and next stage, so you can walk through a construction from coordinates to final image. The arrow keys move between cards when one has focus.

### The view switch

The switch above the canvas chooses what the canvas shows:

- **Final image** (`Esc`): the scene's finished output, the same image Export and Save use.
- **This stage** (`I`): only the selected component's output, before anything downstream uses it. You do not need to make a component the final output to see it.
- **What it changes** (`C`): the final image rendered with and without the selected component (bypassed), in one of two styles. *Changed pixels in color* keeps the image where the component matters and turns the rest gray. *Signed difference* is warm where the component adds light and cool where it removes light.

![This stage: the geometry of the Bipolar Nebula alone, with its false-color legend and typeset equation](../gallery/studio-stage.png)

![What it changes: only the pixels the star lattices affect stay in color](../gallery/studio-effect.png)

In the stage and change views the viewed component follows your selection. Press **🔓** to lock it: the canvas keeps showing that component while you select and edit others, for example to watch a field while you tune something upstream of it.

Colors, layers and lights appear as themselves. Scalar, coordinate and geometry stages have no color of their own, so they are shown in false color, and a legend on the canvas explains it:

| Stage type | False color |
|---|---|
| scalar field | gray = ½ + ½·tanh(value): black is negative, mid-gray zero, white positive |
| coordinates | red = ½ + ½ sin x, green = ½ + ½ sin y, repeating every 2π |
| geometry | red = 4 × rim A, green = coverage, blue = warp S |

The rulers' readout gives the exact values behind these colors.

### Rulers, grid and readouts

**Rulers** (`R`) and **Grid** (`G`) are on by default. The rulers show world coordinates along the top and left with a 1–2–5 tick spacing that adapts to the zoom; the top-right corner shows the size of a major tick. The crosshair follows the cursor with a label giving:

- the world coordinate `x, y` of the pixel center;
- the pixel column and row (row 0 is the top);
- the displayed RGB bytes and hex color;
- the **raw value of the shown component** at that point (in the stage view) or of the selected component (otherwise): the scalar, the coordinate pair, the geometry channels S, A and coverage, or the RGBA radiance before exposure and tone mapping.

Click the image to **pin** the reading; it stays at that point and updates as you edit or scrub. **Unpin** or `Esc` removes it. Alt-click reads one raw value into a message. Rulers, grid, readouts and legends are never part of an export.

### The camera

Drag to pan. Scroll or pinch to zoom about the point under the cursor. **Fit** (`F`) restores the native framing; at 2000 × 1200 the canvas reproduces the supplied source grid exactly. The camera is part of the project and is saved and undone like any other edit. The quality menu sets how many pixels the canvas computes; lower is faster while exploring, and every setting evaluates the same equations.

## Understanding a component

Select a component in the pipeline, the graph or the canvas view to open it in the inspector:

- **The switch** at the top includes or bypasses it (see below). The title is editable; the id stays fixed.
- **Show this stage**, **What it changes** and **Make final output**. The last one changes which component the scene outputs, which is what saves and exports use. To just look at a component, use Show this stage.
- **The equation**, typeset as mathematics, followed by a **where** list: every parameter's symbol, name and live value (click one to jump to its slider), every input and where it comes from, and the fixed symbols in the formula. **GLSL** shows the shader code the component contributes, with parameter names in place of uniforms. The section can be collapsed.
- **Inputs**: which component feeds each socket. *Unconnected · zero* means the socket contributes a typed zero, not an implicit image coordinate. **＋** next to a connected input inserts a modifier on it (see Composing).
- **Parameters**: each one says what it does, in plain language. Its label shows the symbol it has in the equation. Next to the value are **◆** (add a key at the playhead), **↺** (reset) and **▦** (sweep). A marker on the slider shows the original value.

## Experimenting safely

Nothing you try is hard to take back:

- **↺ on a parameter** returns it to its value when the scene was opened (for a component you added, the catalog default), and removes its animation. Double-clicking the parameter's label does the same. Changed parameters are marked with a dot, and **↺ Reset all** resets the whole component.
- **◐ Original**: press and hold the button, or hold `O`, to see the scene as it was when you opened it; release to return to your version.
- **⟲ Revert** restores the whole scene as it was opened. Your selection, view and playhead stay where they are, and Undo brings your changes back.
- **Undo and redo** (`Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z`) cover every edit, including the camera and bypass checkboxes.
- **Snapshot** (`S`) bookmarks the project and playhead in the Snapshots tab of the library; click one to return to it. Up to thirty are kept in this browser; they are not part of the saved file.

### Sweeps and variations

**▦** on a parameter opens the explorer below the canvas with the image rendered at seven values across the parameter's whole range. It is the quickest way to see what a parameter does. **✦ Variations** in the inspector renders eight random variations of the component's parameters. Its controls choose how far they may move (subtle, medium, bold) and whether to vary this component or the whole scene; **⟳ Shuffle** makes new ones.

![A sweep of Neck pinch across its range; hovering a thumbnail previews it on the canvas](../gallery/studio-explore.png)

In both, hover a thumbnail to preview it on the main canvas, and click it to use it; the one in use is outlined. Each click is one undo step. `Esc` or **×** closes the explorer. The thumbnails use the current view, so a sweep while viewing a stage shows how that stage changes. For an animated parameter, a sweep edits the key at the playhead.

## Including and bypassing components

Every component has a checkbox, on its pipeline card, on its graph card and as the switch in the inspector. Unticking it **bypasses** the component:

- a **modifier** (a coordinate map such as Translate, Vortex, Lens or Custom coordinate; a Tint, Mask or Soft threshold) passes its input through unchanged, so unticking a warp simply removes the warp;
- a **combiner** passes its main input through: Add light passes A, Front over back passes the back layer, Combine scalar fields passes a;
- **content** (a field, shape, light or star field) contributes nothing (zero).

The tooltip on each checkbox says exactly what that component will do when bypassed. Ticking a component also ticks anything it needs that was unticked, and says so. Above the pipeline:

- **All** includes every component.
- **Only structure** bypasses every content component but keeps coordinates, combiners and modifiers. Tick components one at a time to watch the image build up.
- **Original** restores which components were included when the scene was opened.

## Composing

**Components** in the library lists every building block with a live search. Hover an entry to see its description and typeset equation. Click it to add it: its inputs connect to the selection when the types match, otherwise to the first compatible component, and the canvas shows its output. Or drag it:

- onto an empty part of the graph to add it;
- onto an **input dot** to add it and wire it into that socket (incompatible types are refused with a message);
- onto a **component card** to wire it into that card's first compatible input, preferring an empty one;
- onto the canvas to add it without wiring.

In the inspector:

- **＋ on a connected input** inserts a modifier between that input and whatever feeds it: a warp before a field, a tint before a layer, a threshold before a scalar. The old connection passes through the new component.
- **Replace with…** swaps the component for another with the same output type. Its connections are kept wherever the new kind has a socket with the same name and type. The Ring Nebula scene is the Bipolar Nebula with its geometry replaced exactly this way.

### The function graph

![The function graph with include checkboxes, live previews and typed sockets](../gallery/studio-graph.png)

The **Function graph** tab shows the wiring. It is laid out automatically: components sit in the column of their dependency depth, in project order, so there are no positions to manage. Cards carry a colored edge and dots by type: blue coordinates, amber scalars, violet geometry, green layers. Each card has an include checkbox, a 👁 button that shows its stage, and, with **Previews** on (`P`, default on), a live thumbnail.

- Hover a card to dim everything that is neither upstream nor downstream of it.
- Drag from an output dot to an input dot to wire them; compatible sockets light up while you drag. Clicking an output dot and then an input dot also works. Drag a wire off an input to disconnect it, or onto another input to move it. Connections that would form a cycle or mix types are refused and the previous state restored.
- **Locate** (`L`) scrolls to the selected card. With the graph focused, `Delete` removes the selected component and `Ctrl/⌘ D` duplicates it.

The **Generated GLSL** tab shows the single fragment shader compiled for the current view, with each component's statement labelled by its id. **Copy GLSL** copies it.

### Custom equations

The *Custom scalar*, *Custom coordinate* and *Custom color* components take a GLSL expression over `p, x, y, r, theta, t, a, b`. The inspector shows the expression **typeset as mathematics above the editable text**, and the typeset version updates as you type: `a/b` becomes a fraction, `pow(x, 2.0)` a power, `theta` θ, `vec2(x, y)` a tuple. The helper menu inserts the built-in functions at the cursor. **Apply** or `Ctrl/⌘ Enter` compiles; a failed compile shows the driver's message and leaves the previous image in place.

## Animation and the timeline

Space plays and pauses; ↤ rewinds; `,` and `.` step one frame at 24 fps; `Home` and `End` jump to the ends. The duration, **Loop**, output conversion (Source, Filmic, Linear) and exposure are project settings.

Click **◆** next to a parameter to add a key at the playhead. After that, changing the parameter at another time adds or updates a key there. Each keyed parameter gets a lane in the timeline: click the lane to seek, click a key to jump to it, and drag a key to retime it. In the inspector's Animation section, choose smooth, linear or hold interpolation, or delete keys and tracks. Tracked values update live during playback. See [Animation](ANIMATION.md) for the interpolation rules and export determinism.

## Export

**Export** renders a still PNG at any size up to the GPU limit (with the full project embedded as metadata), a deterministic PNG sequence in a ZIP with the project and a manifest, or a real-time browser video. When the canvas shows a stage or a “what it changes” view, a checkbox exports that view instead of the final image. Details and limits are in [Animation and export](ANIMATION.md).

## Keyboard shortcuts

Single-key shortcuts apply when no text field or dialog has focus.

| Keys | Action |
|---|---|
| `Space` | Play / pause |
| `Home` / `End` | Go to the start / end |
| `,` / `.` | Step one frame back / forward |
| `[` / `]` | Show the previous / next stage of the pipeline |
| `I` | Show the selected component's stage (again: back to the final image) |
| `C` | Show what the selected component changes |
| `Esc` | Close the explorer, cancel a connection, unpin a reading, or return to the final image |
| hold `O` | Compare with the original scene |
| `P` | Toggle live previews |
| `R` / `G` | Toggle rulers / grid |
| `F` | Fit the camera |
| `S` | Take a snapshot |
| `L` | Locate the selected component in the graph |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z` | Undo, redo |
| `Ctrl/⌘ S` | Save the project JSON |
| `Ctrl/⌘ D` | Duplicate the selected component |
| `Delete` / `Backspace` | Delete the selected component (graph focused) |
| `Alt`-click canvas | One-off raw value |

## What is remembered

The project autosaves to this browser's storage a moment after every edit, together with the scene as it was opened (so Original, reset and Revert still work after a reload). Preferences are stored the same way: preview quality, rulers, grid, previews, the bottom tab and the panel height. So are snapshots. Browser storage can be unavailable or cleared, so **Save project** remains the portable backup. Reference images are never stored.
