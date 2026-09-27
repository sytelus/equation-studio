# Animation, reproducibility and export

This guide covers everything about time in Equation Studio: how a frame is computed, the three ways things move (procedural time, shader code and point clouds, keyframes), the tools that show and measure motion, and every export format. The works themselves are described in [WORKS](WORKS.md); the controls in the [editor guide](EDITOR_GUIDE.md).

## A frame has no hidden history

The renderer evaluates `image = R(project, time)`. There is no evolving fluid grid and no previous-frame feedback (twigl's backbuffer `b` is deliberately not offered). This is why scrubbing backward, jumping between times, regenerating a chosen frame, rendering twelve frames of a filmstrip at once or exporting frames out of order all work without replaying earlier frames. The GPU tests render `t=0`, `t=2.3`, then `t=0` again for the moving presets: the middle frame changes, and the repeated first frame is identical.

Determinism means **the same project, time, dimensions and backend**, not bitwise equality across GPU models or browsers. Chaotic fractal loops amplify differences in the last bit of a float, so two GPUs (or two browsers on one GPU) can render the grain of such a shader differently while agreeing everywhere else. Archive the project, the exported frames and the backend metadata when exact historical output matters.

## Time in a scene

The studio clock `τ` runs from 0 to the scene's **duration** (the timeline). The playback speed menu (¼× to 2×) only changes how fast the playhead moves while you watch; exports always use real time.

Components see time in three ways:

- **Procedural time** in built-in kernels: a coordinate drift `q = p − vt`, a phase `cos(kx − ωt)`. Each speed slider scales the time given to that kernel; zero freezes it.
- **Shader code and point clouds** have their own clock: `t = σ τ + τ₀`, with the **Time speed** σ and **Time offset** τ₀ parameters. σ = 1 is real time, 0 freezes the picture at τ₀, a negative σ plays backward. **❄ Freeze here** sets σ = 0 and τ₀ to the moment under the playhead, so an animation becomes a still that can be used in any scene; setting σ again brings the motion back. For a p5.js sketch that adds Δ to `t` every frame at 60 frames per second, σ = 60 Δ (the works set this).
- **Keyframes** interpolate any numeric parameter (below), including the time speed, the loop step limits and the parameters of `param` lines.

## Shader code (twigl)

A **Shader code** component holds the whole program for one pixel, written as GLSL ES 3.00 statements exactly as on [twigl.app](https://twigl.app) in its *geekest (300 es)* mode. The inputs are twigl's:

| Name | Type | Meaning |
|---|---|---|
| `FC` | vec4 | pixel position (`gl_FragCoord`): FC.xy in pixels from the bottom-left corner, FC.z = 0.5, FC.w = 1 |
| `r` | vec2 | resolution: the image's width and height in pixels |
| `t` | float | time in seconds (the component's clock, above) |
| `o` | vec4 | the output color, 0 at the start; the code adds light to it |
| `m`, `f`, `s` | vec2, float, float | mouse (fixed at the center), frame number (60 per second), sound (0) |
| `PI`, `PI2` | float | π and 2π |

Helpers: `hsv(h, s, v)`, `rotate2D(a)` (a 2×2 rotation matrix; `v *= rotate2D(a)` turns v), `rotate3D(a, axis)`, `snoise2D/3D/4D` (simplex noise), `fsnoise` (a hash), and every GLSL built-in. `param name = value [min, max]` lines make sliders, as in equations.

The code is **checked, not pasted**: `src/glsl.js` parses it, checks names, scopes and types (GLSL does not convert `int` to `float` by itself, and the checker says so in words, with the line), and prints it again as a function of the studio's program. Function definitions, arrays, textures, `b`, `#define` and `discard` are not available, each with an explanation. So that a mistake cannot freeze the GPU, all loops of a pixel together stop after **30,000 steps**.

How the code sits in a scene: the component's input `p` is a point of the plane, and `FC.xy` is the pixel of the code's own canvas at that point, `r` pixels wide; the code's canvas spans the image. So the code zooms and pans with the camera, and it can be warped like any other layer by connecting a coordinate map to `p`. At the camera's native framing an unwarped point gets the exact pixel center, so the original code computes exactly what it computes on twigl. The output `o` becomes an opaque layer (NaN becomes 0, and values are kept above 1 so exposure can reveal detail; the canvas of twigl clips at 1, which exposure 1 and *Linear* output reproduce).

### Numbers are live

Every decimal number in the code (and a whole number inside a float constructor such as `vec4(0, 1, 2, 3)`) is read from a uniform, so **dragging a number** in the Code view changes the picture in a few milliseconds without compiling anything (compiling takes 0.1–1 s, and more for large scenes on a cold driver cache). Its structure (the code without its numbers and comments) decides when a new program is needed. For a bit-for-bit match with twigl, **GPU & performance ▸ Compile numbers as constants** compiles them as literals, as twigl does; then a number change recompiles. On the deterministic SwiftShader backend, the thirteen twigl works render bit-identical frames either way to the code in a twigl-style shader; on hardware GPUs the constant version lets the driver fold numbers exactly as twigl's does.

### Loops and variables

Every loop gets a slider **Loop N steps**: stop it after that many steps (in each run, for an inner loop). The slider's range is the loop's real length, which `glsl.js` computes from the code in float32 arithmetic, as the GPU does (`for(float i=.2; i<1.; …) i+=.05` runs 16 times, not 17). A raymarcher's outer loop is the number of steps along each ray, so few steps show which surfaces are found first; a fractal's inner loop is its depth of detail. **▶ Build up** sweeps a loop from 0 to all of its steps; a keyframe track on the step count animates it in a scene or an export.

Every variable of the code, and the step count of every loop, can be shown on the canvas instead of the color (**Look inside**, or click a variable in the code). All declarations are gathered at the top of the generated function, so a variable is shown with the value it had when the code finished (with loops stopped where their sliders say); with a pinned point, Look inside reads them all there.

## Point clouds (p5.js style)

A **Point cloud** draws `n` points placed by one equation of their index `i` (0 to n − 1), `n` and the time `t`, like a p5.js sketch that calls `point()` in a loop. The equation uses the language of custom equations; its last line is the position `vec2(x, y)` in sketch pixels (x to the right, y down, the sketch `S` pixels wide and centered, so `(S/2, S/2)` is the middle of the image). **Points**, **Point size** (the strokeWeight), **Color**, **Opacity** (the stroke alpha: 66/255 ≈ 0.26), **Sketch size** and the time parameters are sliders.

The points are drawn by the GPU in a vertex shader into a texture the size of the frame, as antialiased round dots (the area of each pixel inside the dot, from 4 × 4 samples), blended over each other like the strokes of a canvas. The layer is straight-alpha: its coverage builds up where points overlap, so density becomes brightness. Put it **over** a background (the works use Solid color #090909, p5.js's `background(9)`); *Add light* ignores coverage and would add the color everywhere a point touches. A point cloud warped through its input samples that texture at the warped places, so it shows only what is inside the frame.

## Seeing and measuring motion

- **What moves** (`M`): the final image now and a tenth of a second later. Pixels that change keep their color; still ones turn gray.
- **Trails**: eight frames over the last half second averaged, like a long exposure: still parts stay sharp, moving parts smear along their path.
- **🎞 Frames**: twelve frames spread over the timeline under the transport (the view the canvas shows, in its colors). Click one to go there. They are drawn together with one non-blocking readback, only when the scene changes.
- **Profile ▸ Over time**: one point (the cursor or the pinned reading) through the whole timeline, as a plot with the playhead marked: see a pixel flicker, pulse or drift.
- **Stats ▸ Over the loop**: 25 frames across the timeline, their mean brightness, the change between neighbouring frames (when things move fastest) and a verdict on the loop. The loop is **seamless** when the last frame differs from the first no more than neighbouring frames differ (1.5 × their median); otherwise the dialog says how many times more.

## Seamless loops require more than the Loop checkbox

The checkbox wraps the playhead. It does not change the mathematical phases. For a seamless loop of length `T`, key values should agree at `0` and `T`, and every procedural phase must return modulo its period: `sin(t)` and `rotate2D(t)` repeat every 2π s, which is why many works last 6.283 s, `t/8` needs 16π s, a zoom `log R − t` repeats when the pattern repeats in log R. The *Stats* verdict measures it. Some works are not loops at all: Xor's Vortex turns its rings at speeds 0.2 to 0.95, whose common period is 125.7 s, and the reef's caustics are noise in time; their scenes play the length of the posted clip.

## Keyframes and interpolation

Select a component, click a parameter's ◆ at the current time, move the playhead and change the control. Once a track exists, edits insert or replace keys at the current time. Numeric parameters can be tracked (including code `param` lines, loop step limits and time speeds); colors, the global exposure and graph connections cannot. Count-like parameters interpolate through fractional values; use *Hold* for discrete changes.

Outside the keyed interval the endpoint value is held. Between keys `(t0,v0)` and `(t1,v1)`, let `u = clamp((t − t0)/(t1 − t0), 0, 1)`:

```text
linear: v = v0 + (v1-v0)*u
smooth: v = v0 + (v1-v0)*u*u*(3-2*u)
hold:   v = v0 until the next key, then v1
```

Smooth is a zero-end-slope cubic easing for each interval, not a global spline; it never overshoots the parameter's range. Times are rounded to milliseconds. Keys can be dragged along their lane to retime them. The panel shows the evaluated value of every tracked control during playback without rebuilding, and `,` and `.` step the playhead one frame at 24 fps.

## Export

Exports draw at the requested size on the GPU and restore the preview afterwards. The Export dialog suggests a size in the scene's aspect ratio; a size you type is kept when you switch formats (and shrunk only to a format's limit). *Export the current stage* exports the view the canvas shows, in its colors.

| Format | What you get | Limits |
|---|---|---|
| PNG | The current playhead, with the project embedded (below) | GPU limit, at most 4096 px |
| JPEG, WebP | The current playhead, smaller; quality 1–100 | as PNG |
| MP4 | Every frame at its exact time `i/FPS`, encoded on the device (H.264, WebCodecs), muxed by `encoders.js`; quality sets the bitrate | even sizes; 7200 frames |
| GIF | The whole timeline, looping; one 256-color palette for all frames (median cut) with light ordered dithering | 800 px, 300 frames |
| Animated PNG | Looping, full color, lossless; the browser's own PNG frames re-chunked | 1280 px, 240 frames, 150 MB |
| WebM video | One real-time pass recorded with MediaRecorder (below) | 150 MB |
| PNG sequence | Exact frames, the project and a manifest in a ZIP (below) | 1280 px, 240 frames, 150 MB |
| Sprite sheet | *Frames* moments across the loop in one PNG grid, a JSON of their times and positions, and the project, in a ZIP | 4096-px sheet |
| Web page | One HTML file that plays the scene live on any device with WebGL 2: its compiled shaders (numbers as constants), point passes, parameters (sampled 30 times a second when keyframes animate them) and credits; nothing is fetched | — |
| Shader code | The selected Shader code component's code, with its author's credit, ready for twigl.app; `param` lines become declarations holding their current values | — |

MP4 needs WebCodecs, which browsers offer in secure contexts: opening `index.html` from disk or through `start.py` qualifies. On this machine's Chromium a 20-second, 24 FPS, 640 × 640 clip encodes in about 4 seconds, and the file decodes in OpenCV as 480 frames at 24 FPS. GIF and APNG files were checked with Pillow (frame count, loop, delay).

### Still PNG with project metadata

The Export dialog draws the requested target and dimensions at the current playhead, then adds an uncompressed UTF-8 PNG `iTXt` chunk with keyword `equation-studio`. The JSON contains the full project, time, target ID, the contribution node when a contribution view was exported, width/height and backend information. Rulers, grid, readouts and reference overlays are never part of an export. Recover a project from an exported PNG with:

```bash
python3 tools/read_png_project.py my-image.png --output recovered.json
python3 tools/read_png_project.py my-image.png --metadata > render-settings.json
```

Then open `recovered.json` with *Open*. Project labels, equations and code are embedded, so inspect the metadata before sharing an image containing sensitive project information.

### Deterministic PNG sequence

For duration `T` and frame rate `f`, the export generates `ceil(T*f)` samples at `t = i/f`, with `i` starting at zero; the end point is excluded to avoid a duplicate when the construction loops. The ZIP contains `project.json`, `manifest.json` (dimensions, times, FPS, tone, exposure, target and backend) and `frames/frame_00000.png` onward, stored without recompression; the writer validates paths, duplicate names, offsets, sizes and CRCs. Cancellation does not download a partial archive.

### Browser video (WebM)

The WebM export records one pass through the timeline in wall-clock time, drawing frame `i` at exactly `t = i/FPS` when the clock reaches it and pushing it to the recorder explicitly (`requestFrame`). A slow device skips frames rather than recording them late, and the dialog reports how many were drawn. Use MP4 when every frame must be present and on time.

## Practical performance

Preview width changes sample spacing and pixel work, not the formulas. A scene's shader is compiled once per graph structure, in the background where the browser allows it; changing a value, a code number, a keyframe, the playhead, a bypass checkbox, the view or a shown variable reuses the linked program, so playback and exploration never compile. With **Auto** quality the canvas renders at the display's pixel density and, when a frame takes longer than about 24 ms on the GPU during playback or a drag, at a lower resolution until the motion stops; exports always render at their own size.

Measured on an NVIDIA RTX 5070 (Direct3D 11 through ANGLE) with `tools/perf_report.py` ([PERFORMANCE.json](PERFORMANCE.json)): every work draws a 1024-pixel frame in 0.4–9.4 ms; a code-number drag costs 2–7 ms per change against 160–220 ms per recompile; 20,000 points take 0.13 ms on the GPU against about 130 ms in Canvas 2D. Point clouds, thumbnails, the filmstrip, gallery previews, profiles and statistics read back asynchronously. The large nebula programs compile slowly on a cold Direct3D driver cache (several seconds when shader code is fused into them); the previous image stays up with a *Compiling* indicator meanwhile.
