# Animation, reproducibility and export

## A frame has no hidden history

The renderer evaluates `image = R(project, time)`. There is no evolving fluid grid or previous-frame feedback. This is why scrubbing backward, jumping between times, and regenerating a chosen frame works without replaying earlier frames. The GPU tests explicitly render `t=0`, `t=2.3`, then `t=0` again for nine moving presets: the middle frame changes, and the repeated first frame is identical on the tested backend.

Determinism here means **the same project, time, dimensions and backend**, not bitwise equality across all GPU models or browsers. High-frequency trigonometric fields can differ with shader precision and math implementations. Archive your project, exported frames and backend metadata when exact historical output matters.

## Two complementary kinds of motion

**Procedural time** is already present in many kernels. A coordinate drift `q=p-vt`, a phase `cos(kx-omega*t)`, or a small per-stamp oscillation gives continuous motion. Each corresponding speed slider scales the time passed to that kernel. Zero speed freezes that procedural motion.

**Keyframes** interpolate a component's numeric parameter. Select a component, click its parameter's ◆ at the current time, move the playhead, and change the control. Once a track exists, edits insert or replace keys at the current time. Numeric component parameters can be tracked; color pickers, the global exposure setting and graph connections are not keyframe tracks in this version. Count-like parameters can interpolate through fractional values even though the loop body uses integer indices; for discrete changes use Hold interpolation.

The UI shows the evaluated tracked value at the playhead. A parameter edit also updates its base value. Removing the track therefore returns to the **last edited base value**, not automatically to the original preset's value.

## Interpolation

Outside the keyed interval, the endpoint value is held. Between keys `(t0,v0)` and `(t1,v1)`, let `u=clamp((t-t0)/(t1-t0),0,1)`.

```text
linear: v = v0 + (v1-v0)*u
smooth: v = v0 + (v1-v0)*u*u*(3-2*u)
hold:   v = v0 until the next key, then v1
```

Smooth is a zero-end-slope cubic easing **for each interval**, not a global cubic spline. It avoids overshooting the parameter bounds. Times are rounded to milliseconds when adding keys. Adding another key at that time replaces its value. Keys can be dragged along their timeline lane to retime them; dropping one on an existing key replaces that key. Tracks and keys can be removed in the inspector. Shrinking project duration is rejected when existing keys would lie outside it; move or remove those keys first.

While the animation plays, the inspector shows the evaluated value of every tracked control without rebuilding the panel, so an expression you are typing is not discarded. A parameter sweep (▦) on an animated parameter edits its key at the playhead, and ↺ reset removes a parameter's animation along with restoring its original value. `,` and `.` step the playhead by one frame at 24 fps, which matches the export dialog's default rate.

## Seamless loops require more than the Loop checkbox

The checkbox wraps the playhead. It does not change the mathematical phases. For a seamless loop of length `T`, key values should agree at `0` and `T`, and any procedural phase should return modulo its period. For example `sin(2*pi*t/T)` is periodic, while sampling a nonperiodic noise field at `p-(0,t)` generally is not. Equal lens-strength endpoint keys do not guarantee a seamless scene if the source galaxy independently keeps rotating. The bundled studies demonstrate animation, not a blanket seamless-loop guarantee.

## Still PNG with project metadata

The Export dialog draws the requested target and dimensions at the current playhead, then adds an uncompressed UTF-8 PNG `iTXt` chunk with keyword `equation-studio`. The JSON contains the full project, time, target ID, the contribution node when a contribution view was exported, width/height and backend information. The canvas pixels are not recompressed during metadata insertion. Rulers, grid, readouts and reference overlays are never part of an export.

Most viewers ignore the metadata; some image editors strip it on save. The application's own project files remain the most direct portable format. Recover a project from an exported PNG with:

```bash
python3 tools/read_png_project.py my-image.png --output recovered.json
# Or retain all render metadata:
python3 tools/read_png_project.py my-image.png --metadata > render-settings.json
```

Then open `recovered.json` through the editor's Open project action. Project labels and custom expressions are embedded, so inspect the metadata before sharing an image containing sensitive project information. A PNG generated through the low-level `renderer.png()` or `window.equationStudio.exportPNG()` API does not automatically receive this metadata; call `embedPNGMetadata()` explicitly or use the dialog.

## Deterministic PNG sequence

For duration `T` and frame rate `f`, the export generates `ceil(T*f)` samples at `t=i/f`, with `i` starting at zero. The end point is excluded to avoid an unnecessary duplicate when the construction loops. A duration not divisible by the frame interval can make the encoded sequence's playback duration differ from `T` by less than one frame interval.

The ZIP contains:

```text
project.json
manifest.json      dimensions, times, FPS, tone, exposure, target and backend
frames/frame_00000.png
frames/frame_00001.png
...
```

PNG frames are already compressed. The ZIP uses the standard stored method rather than wasting time recompressing them. The writer validates paths, duplicate filenames, offsets, sizes and CRCs. Frames do not repeat the full project in every PNG; the shared JSON/manifest supplies provenance. Cancellation does not download a partial archive.

Limits are 240 frames, 1280 pixels per side and 150 MB of frame bytes; the ZIP writer has a separate 160 MB total safety limit. The export currently holds compressed frames in memory rather than streaming them directly to disk. Use shorter sequences for large images. The UI restores the previous playhead and preview after success or failure.

## Browser video

The application checks `canvas.captureStream` and `MediaRecorder`, then chooses a supported WebM or MP4 MIME type. It records one pass through the timeline in wall-clock time, drawing frame `i` at exactly `t=i/FPS` when the clock reaches that frame and pushing it to the recorder explicitly (`requestFrame`), so every recorded frame shows an exact sample time. It does not wait for every theoretical frame number: on a slow device, missed frames are skipped rather than recorded late, and rendering, encoding, tab visibility and browser scheduling can reduce the actual frame count. The dialog reports how many of the planned frames were drawn. If a pass delivers no frames at all (Chromium's first canvas capture after a pop-up window closed can be empty), it is repeated, once with compositor-driven capture and once more with explicit frames, before the export reports a failure. Use PNG sequence export when every frame must be present.

The tested Chromium/SwiftShader run produced a decodable VP9 WebM at 64 × 40. The short tests recorded fewer decoded frames than their capture-rate requests on the software backend, illustrating why this mode is explicitly not advertised as a deterministic frame exporter. Other codecs/browsers were not tested. There is no audio track or audio-authoring feature in this application.

## Practical performance

Preview width does not change formula band counts, but it changes sample spacing and pixel work. A source scene with tiny stars can look different at 480 versus 2000 pixels through aliasing, even though the same mathematical function is used. Hardware acceleration matters; the full source port is deliberately not replaced with a cheap approximate shader during motion.

A scene's shader is compiled once per graph structure, in the background where the browser allows it; changing a numeric value, a keyframe, the playhead, a bypass checkbox or the view reuses the linked program, so playback never compiles. With **Auto** quality the canvas renders at the display's pixel density and, when a frame takes longer than about 24 ms on the GPU during playback or a drag, at a lower resolution until the motion stops; exports always render at their own size. The LIVE badge reports the GPU time of the last frame: an exact timer-query measurement where the browser offers `EXT_disjoint_timer_query_webgl2`, otherwise an upper bound (marked ≤) from a fence. Thumbnails, the profile and the statistics behind automatic stage colors read back asynchronously; the readouts under the cursor read one pixel. Frame-rate counters describe the current browser session, not a promised hardware capability.
