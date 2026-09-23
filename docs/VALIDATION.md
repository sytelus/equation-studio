# Validation and known limits

Validation date: **22 September 2026**. This is an executed implementation, not a mock-up or a shader listing that was never compiled.

## Executed test groups

| Group | Result | Evidence |
|---|---|---|
| JavaScript unit tests | **59 passed, 0 failed** | [Captured output](NODE_TEST_RESULTS.txt) |
| Retained Python source tests | **42 passed, 0 failed** | [Captured output](CPU_TEST_RESULTS.txt) |
| Actual WebGL scene rendering | **12/12 presets** at 640 × 384, with finite-output checks | [GPU report](GPU_VALIDATION.json) |
| Actual component shaders | **43/43 component kinds** compiled and rendered with finite default outputs | [GPU report](GPU_VALIDATION.json) |
| Stateless animation | **9/9 tested moving presets** changed at t=2.3 and repeated the original t=0 frame exactly on this backend | [GPU report](GPU_VALIDATION.json) |
| Original source raw fields | **32 native-grid points**, seven field groups, actual float framebuffer readback vs float64 CPU | [GPU report](GPU_VALIDATION.json) |
| Original source native image | **2000 × 1200** rendered and compared without alignment or color fitting | [GPU PNG](../gallery/bipolar_2000x1200_gpu.png) |
| Editor workflows | Keys, interpolation, undo/redo, connection rejection, raw probe, project save/import, exports, context recovery | [Workflow report](WORKFLOW_VALIDATION.json) |
| GPU-unavailable fallback | Visible error panel, export rejected, no uncaught JS errors | [Failure report](FAILURE_VALIDATION.json) |
| Local server | Root page, JS MIME type and port-collision handling passed | [HTTP report](HTTP_VALIDATION.json) |

The unit tests cover all preset models, graph types, cycles including disconnected cycles, missing/disabled inputs, reachable sharing, bounds, custom-expression restrictions, structural/uniform changes, deletion, history, interpolation, deterministic frame times, ZIP CRC/path checks, and PNG metadata construction. The Python tests retain an independently written scalar source transcription as well as image/CLI/composition checks.

Browser workflow tests exercise actual event handlers and downloads, not only direct function calls. PNG metadata was independently decoded with Pillow after loading all PNG chunks. Four-frame sequence ZIP output was independently checked using Python's zipfile module, including CRCs, frame dimensions, exact timestamps and differing frame pixels. A VP9 WebM was downloaded through MediaRecorder and decoded with ffprobe. The metadata-extraction utility also successfully recovered the PNG's project without Pillow.

## Native GPU versus CPU measurement

The comparison uses the same source sampling grid, defaults and display function. No crop search, spatial alignment, fitted palette, blur or histogram correction was applied. Each error is measured across RGB **channel samples**, not a count of whole pixels.

| Metric | Result |
|---|---:|
| Mean absolute channel error, 0–255 | 0.293761 |
| Root mean squared channel error, 0–255 | 2.372531 |
| 95th percentile absolute channel error | 1 |
| 99th percentile absolute channel error | 4 |
| Largest single-channel error | **145** |
| RGB Pearson correlation | 0.999421624 |
| PSNR | 40.6266 dB |

**This is not byte-for-byte identity.** The relatively small average error coexists with large rare outliers near very sharp features. Correlation is a similarity statistic, not “percent accuracy.” The highest-frequency star/filament terms are sensitive to float32 coordinate and trigonometric rounding. The retained CPU image is itself a documented transcription of the supplied equations, not a recovered native original from the artist; agreement between implementations cannot prove the historical transcription is infallible.

The native draw plus readback took approximately **71.32 seconds** in the software test environment. This number includes driver behavior and may include compilation; concurrent tests also affect it. It is **not a physical-GPU benchmark** and should not be used to predict a user's hardware frame rate.

## Raw field comparison

Readback used a one-pixel RGBA32F framebuffer at each selected source-grid position. These are actual field values before false-color diagnostic mapping, exposure or final display conversion. The seeded sample set, coordinates and complete statistics are in the JSON report.

| Field group | Mean absolute error | Maximum absolute error |
|---|---:|---:|
| shell | 8.29762267e-08 | 1.54103139e-06 |
| turbulence | 0.00178210516 | 0.0102743652 |
| cloud | 0.00402155081 | 0.0232963255 |
| gas | 0.000133562828 | 0.00105603023 |
| core | 7.15954417e-06 | 0.000274345955 |
| stars | 0.00275000727 | 0.0888712165 |
| final | 0.00280975466 | 0.0888386557 |

The source's fixed band-angle constants and powers are evaluated once in JavaScript float64 before being emitted as GLSL constants. An initial implementation that evaluated large fixed angles in shader precision had substantially worse raw-field disagreement. The delivered constant-folded version above is what the tests and screenshots use. High-frequency position-dependent calculations still use shader precision; constant folding cannot make those bitwise equivalent to float64.

The zero-strength lens-map identity was also verified through raw float readback. Changing a numeric parameter was checked to reuse the same linked program, rather than forcing a compilation. Nonfinite tests check output RGBA, not merely the final displayed RGB.

## Browser verification and portability boundary

The tested browser was **Chromium 144.0.7559.96**, with **ANGLE / SwiftShader software Vulkan**, reported highp precision of 23 bits, and `EXT_color_buffer_float` available. There was no physical GPU available for a hardware benchmark. The software backend still executes the actual shipped WebGL 2/GLSL code, rather than a substitute Python renderer.

This environment has a managed browser policy that blocks URL navigation. The tests loaded the **actual bundled HTML and JavaScript into an in-memory about:blank page**. No browser policy was edited and no policy restriction was bypassed. Local file and localhost browser navigation were therefore **not end-to-end verified here**. The local static server was independently checked using ordinary loopback HTTP requests. Firefox, Safari, iOS and physical-GPU/browser combinations remain untested.

Desktop (1600 × 1030), tablet-width (860 × 1000) and mobile-width (390 × 844) screenshots were captured from the running app. These test responsive layout in Chromium; they are not device certification. Custom equation failure was tested to preserve the last valid project. Connection-cycle failure was tested to restore both the model and visible dropdown. GPU context loss and restoration were exercised using the test extension, including re-enabling float-buffer support and reading a field afterward.

Real-time recording successfully produced a decodable video but did **not** achieve a guaranteed requested frame count on the software backend. The PNG sequence is the deterministic export path. Reference-image auto-alignment, a full accessibility audit, hardware performance matrix, memory-stress testing at all maximum limits, and browser codec matrix are not completed.

## Repeat the tests

Run from the project root:

```bash
node --test tests/*.test.js
python3 tools/build.py

# Optional Python reference dependencies and tests
python3 -m pip install -r reference/nebula_rewrite/requirements.txt
(cd reference/nebula_rewrite && python3 -m unittest discover -s tests -v)

# Optional browser-testing dependencies
python3 -m pip install playwright numpy pillow
# The scripts use /usr/bin/chromium. Set executable_path in them for another installation.
python3 tools/browser_check.py
python3 tools/workflow_check.py
python3 tools/gpu_validate.py
```

On a headless Linux machine whose ANGLE driver needs X11, prefix a browser test with `xvfb-run -a`. The supplied automated tests select SwiftShader deliberately for the documented software test environment. Ordinary app launches do not force that backend; the browser chooses its supported GPU backend. Do not alter managed browser policies to run these tests.

Full GPU validation can take several minutes on a software renderer. Run the browser suites sequentially when comparing performance or video capture behavior; concurrent software rendering competes for CPU resources. `tools/generate_catalog.js` regenerates docs/example JSON; `tools/thumbnails.py` regenerates small UI thumbnails from actual preset PNGs; `tools/build.py` rebuilds the single-file application. `tools/build_docs.py` optionally uses Pandoc to rebuild HTML reading pages.

## What has not been verified

The five new subject studies do not have recovered original formula sheets or native reference images. No pixel-fidelity claim is made about those artworks. The Hedgehog/Fire video algorithms, third-party Rust implementation and unavailable thread/reply content were not reconstructed. The new astronomical/natural effects are not validated physical simulations. See the evidence ledger in [Research](RESEARCH.md).
