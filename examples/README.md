# Portable examples

`projects/` contains one validated JSON project for every built-in scene. Open any of them with **Open project** in the app. They are independent files; modifying one does not edit the preset's source definition. JSON contains equations, topology, parameters and tracks, not image pixels.

`embedded.html` demonstrates using the renderer, presets and PNG metadata helper without the editor. Pass an options object as the fifth argument of `renderer.draw()` to render an isolated node (`{target}`) or a contribution view (`{contribution}`); see [Architecture](../docs/ARCHITECTURE.md#reuse-the-renderer-without-the-editor). Serve the project root using `python3 start.py`, then visit `http://127.0.0.1:8765/examples/embedded.html`. Unlike the bundled single-file application, this source-module example should be served rather than opened as `file://` because it uses ES-module imports.

## Three useful starting points

**Ring Nebula** (`projects/ring.json`) replaces the original geometry bundle without modifying the cloud generator. Compare its graph to `bipolar.json` and trace which node changed. This demonstrates interface-driven reuse rather than copying a monolithic formula.

**One Feather** (`projects/feather.json`) isolates the same analytic stamp that the Peacock fan repeatedly calls. Modify width/eyespot scale in the small scene before working on a dense full display.

**Kaleidoscope** (`projects/kaleidoscope.json`) combines coordinate symmetry with custom scalar and color expressions. It is a small, editable authoring example for effects unrelated to the supplied nebula.

The full [Recipes guide](../docs/RECIPES.md) explains how to apply a lens to a nebula, combine two nebular branches over shared stars, and build a new flower field. [Architecture](../docs/ARCHITECTURE.md) describes adding a component with typed sockets and sliders.
