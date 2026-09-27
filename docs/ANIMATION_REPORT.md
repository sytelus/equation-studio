# Enable animations: report for Equation Studio 2.0

This report answers the brief *Enable animations* item by item: what was asked, what was built, and the evidence for each claim. The works are described in [WORKS](WORKS.md), the features in the [editor guide](EDITOR_GUIDE.md) and [Animation](ANIMATION.md), the code in [Architecture](ARCHITECTURE.md), the measurements in [Validation](VALIDATION.md).

## 1. Checklist of the brief

| # | The brief asked | Status | What was done | Evidence |
|---|---|---|---|---|
| 1 | Study all of the posts; extract the equations from the image, the post, quoted tweets or threads | **Done** (18 of 19 links; 1 inaccessible) | Every post was read with its text, author, date and clip. Seventeen publish their complete code in the post (13 twigl shaders, 4 p5.js sketches); none has quoted tweets or threads with more code. The anemone post has only a clip and a description; a web search found no published source. The Grok conversation link redirects to the X login page and has no public copy. | [Research](RESEARCH.md#animation-works-research-of-2526-september-2026), `src/works.js`, the in-app research ledger |
| 2 | Implement each in Equation Studio so the animation reproduces | **Done** | Thirteen Shader code scenes run the posted code unchanged; four Point cloud scenes run the sketches' formulas; the anemone is our own study, labelled as such. | [WORKS](WORKS.md): bit-identical frames on SwiftShader for all 13 shaders; the 4 sketches within 0.81/255 mean of the originals drawn by a p5.js stand-in |
| 3 | Enhance the code base while still supporting existing renders | **Done** | The compiler, renderer, catalog, editor and UI were extended; 1.x projects open unchanged. | `tools/compare_versions.py HEAD`: the twelve 1.x scenes (final images and every component's raw values, at two times) are **identical** under 2.0 and 1.4.0 ([regression report](REGRESSION_VALIDATION.json)) |
| 4 | Enable animations in keeping with the repository's principles: exploration, analysis, composition and decomposition, understanding | **Done** | Code is decomposed into loops (each with a step slider), variables (each viewable on the canvas) and numbers (each draggable); composition: a code or point layer is a component that can be warped, masked, tinted and combined; understanding: readable versions, captions, guided tours, ideas | Code view, Look inside, Stats; [editor guide](EDITOR_GUIDE.md#animations-shader-code-and-point-clouds) |
| 5 | Design an interface language for animations that enables exploration, analysis and understanding with decent performance | **Done** | (a) the **shader-code language** (`glsl.js`): twigl's GLSL, checked and re-printed with loop counters, a step budget, uniform numbers and a shown-value selector; (b) **point equations** of index, count and time; (c) a **time mapping** per component (`t = σ τ + τ₀`, freeze); (d) **loop step limits** and **shown values** as uniforms | [Architecture](ARCHITECTURE.md#shader-code-the-language-of-the-code-component), [Animation](ANIMATION.md) |
| 6 | Extend the UI so users can play with animations along many axes of freedom and edit them | **Done** | Drag any number (live, no recompilation); `param` sliders; loop steps and ▶ build-up; time speed, offset and freeze; any variable on the canvas; edit the code with a checked draft; warp through the input p; keyframe any of these; reuse in other scenes | The 2.0 workflow checks (number drag, variables, loops, tour, freeze, code editing…) in the [Workflow report](WORKFLOW_VALIDATION.json) |
| 7 | Popup hints and small explanations so no documentation or questions are needed | **Done** | Every token of the code explains itself on hover (inputs, helpers, 38 built-ins, each variable with its declaring line's caption, numbers, loops); every new control has a tip; the work's summary and tour; the Help dialog covers the new panels and keys | `ui-code-view.js` (`highlightCode`), Help dialog sections 05–06 |
| 8 | Compute and display statistics that throw light on compositions and their parts | **Done** | Stats tab for every component: values, histogram, clipped/black/nonfinite shares; point coverage; over the loop (brightness, motion, seamless verdict); inside the code (every variable's range, real loop steps); GPU time per component and own share | `stats.js` (unit-tested), `ui-stats.js`; [editor guide](EDITOR_GUIDE.md#measuring-the-stats-tab) |
| 9 | Export in various formats | **Done** | PNG (with project), JPEG, WebP, MP4 (exact frames), GIF, animated PNG, WebM, PNG sequence, sprite sheet, web page, twigl code | Unit tests (GIF LZW round trip, APNG chunks and CRCs, MP4 boxes); the workflow's export check; MP4 decoded by OpenCV, GIF/APNG by Pillow |
| 10 | Browse, explore and preview a growing number of built-ins in a scalable way | **Done** | Gallery with sections, kind and artist filters, search over titles, artists, tags and descriptions, cards that come alive on hover; palette previews of every component; the works first in the palette | The workflow's gallery check; `studio-gallery.png` |
| 11 | Reuse components from animation to static and vice versa | **Done** | Any work can be added to another scene as a credited layer; ❄ Freeze turns an animated component into a still; static components can be added to animated scenes and animated with keyframes or their speed parameters | The workflow's reuse and freeze checks; `studio-reuse.png` |
| 12 | Analyze every example so explanations, annotations, visualizations and views such as graphs prove understanding | **Done** | For each work: a summary, 2–5 tour steps tied to code lines (some showing a variable or stopping a loop), a readable version with a caption on every line, 3–7 ideas; 17 new idea cards with interactive plots (raymarching convergence, glow falloff, repetition, inversion, log R, octaves, hsv channels, tanh, density…); variable views with colormaps; stats plots; profile over time | [WORKS](WORKS.md), `concepts.js` |
| 13 | Usable for people who need high contrast | **Done** | High-contrast theme (system setting or forced): black background, white text and borders, strong focus ring, no faint gray; every control keyboard-reachable; numbers adjustable with arrow keys; reduced motion respected | The workflow's contrast check; `studio-contrast.png` |
| 14 | Highly readable, well documented, maintainable code | **Done** | Eleven new modules, each with a module comment and doc comments on exports; pure logic separated from the DOM and unit-tested; the bundler conventions kept; the works are data in one registry | [Development](DEVELOPMENT.md), `src/*.js` |
| 15 | Thorough, readable, complete documentation | **Done** | README, CHANGELOG, WORKS (generated), Animation (rewritten), editor guide, architecture, development (including adding a work), research, attribution, this report | `docs/` |
| 16 | Significantly improve performance | **Done** | Numbers as uniforms (30–65× faster edits), GPU point clouds (~1000× faster than Canvas 2D), exact-frame MP4 export faster than real time, linked libraries (programs about 7× smaller), non-blocking multi-frame atlases | Section 5, [PERFORMANCE.json](PERFORMANCE.json) |
| 17 | Maintain a checklist and a tabular report | **Done** | This document | — |

## 2. The posts

| # | Post | Artist | What the post contains | Scene | Verification |
|---|---|---|---|---|---|
| 1 | [1430657958329917450](https://x.com/zozuar/status/1430657958329917450) | yonatan (@zozuar) | twigl code + clip | Jellyfish lattice | bit-identical |
| 2 | [1632160439944478721](https://x.com/zozuar/status/1632160439944478721) | yonatan | twigl code + clip | Stormy sea | bit-identical |
| 3 | [1726103550986469869](https://x.com/XorDev/status/1726103550986469869) | Xor (@XorDev) | twigl code “Vortex” + clip | Vortex | bit-identical |
| 4 | [1763906851337326736](https://x.com/zozuar/status/1763906851337326736) | yonatan | twigl code + clip | Blossoming tree | bit-identical |
| 5 | [1786335843700912160](https://x.com/zozuar/status/1786335843700912160) | yonatan | twigl code + clip | Folded jewel box | bit-identical |
| 6 | [1861521606390018548](https://x.com/zozuar/status/1861521606390018548) | yonatan | twigl code + clip | Lace garden | bit-identical |
| 7 | [1862325652013097042](https://x.com/zozuar/status/1862325652013097042) | yonatan | twigl code + clip | Carved stone kaleidoscope | bit-identical |
| 8 | [1865850795822104948](https://x.com/zozuar/status/1865850795822104948) | yonatan | twigl code + clip | Underwater reef | bit-identical |
| 9 | [1875945664070475933](https://x.com/zozuar/status/1875945664070475933) | yonatan | twigl code + clip | Golden spiral | bit-identical |
| 10 | [1880163156741275732](https://x.com/YoheiNishitsuji/status/1880163156741275732) | Yohei Nishitsuji | twigl code + clip | Cloud cave | bit-identical |
| 11 | [1898392319386366065](https://x.com/YoheiNishitsuji/status/1898392319386366065) | Yohei Nishitsuji | twigl code + clip | Smoke tunnel | bit-identical |
| 12 | [2027368118130000146](https://x.com/YoheiNishitsuji/status/2027368118130000146) | Yohei Nishitsuji | twigl code + clip | Cloud mountains | bit-identical |
| 13 | [2094068054590190033](https://x.com/zozuar/status/2094068054590190033) | yonatan | twigl code + clip | Rainbow trefoil | bit-identical |
| 14 | [2093710258120331463](https://x.com/yuruyurau/status/2093710258120331463) | ア (@yuruyurau) | p5.js sketch + clip | Point jellyfish | mean 0.52/255 vs the sketch |
| 15 | [2100230050063024467](https://x.com/yuruyurau/status/2100230050063024467) | ア | p5.js sketch + clip | Swimming creature | mean 0.63/255 |
| 16 | [2100956346057392137](https://x.com/yuruyurau/status/2100956346057392137) | ア | p5.js sketch + clip | Circling twins | mean 0.60/255 |
| 17 | [2101319815772397831](https://x.com/yuruyurau/status/2101319815772397831) | ア | p5.js sketch (one term changed from #16) + clip | Circling twins, bristled | mean 0.81/255 (the chaotic `sin(9/k)` term differs between float32 and float64) |
| 18 | [2082449968548159779](https://x.com/Jaenam97/status/2082449968548159779) | Jae (@Jaenam97) | a clip and a description; **no code** | Fluffy anemone (study) | our own construction, compared by eye with the clip |
| 19 | [Grok conversation 2103445614214463548](https://x.com/i/grok?conversation=2103445614214463548) | — | **not accessible** (login required, no public copy) | — | — |

“Bit-identical” means: on Chromium's deterministic SwiftShader backend, the original code in twigl's geekest template, the same code in a Shader code component and the readable version render identical bytes (with numbers compiled as constants, as twigl does). Hardware GPUs may differ from one another in the last bits of chaotic fractals, as twigl itself does between browsers. The sketch comparisons are for the numbers at the time of writing; see [WORKS](WORKS.md) for the current table.

## 3. What was built

| Area | New | Where |
|---|---|---|
| Components | **Shader code** (twigl GLSL), **Point cloud** (p5.js-style point formula) | `catalog.js` |
| Languages | the shader-code language (parser, checker with explanations, loop-length simulation, printer, formatter); point equations (kind `points` of the equation language) | `glsl.js`, `expression.js` |
| Engine | code functions with loop counters, a 30,000-step budget, uniform numbers and shown values; point passes; global time with time sampling; linked libraries; per-scene aspect ratio | `compiler.js`, `renderer.js`, `shader-link.js`, `twigl-glsl.js` |
| Works | 18 works with credit, original and readable code, summary, tour, ideas; 17 new ideas | `works.js`, `concepts.js`, `presets.js` |
| Understanding | Code view (hover explanations, draggable numbers, click-to-show variables), How it works, Loops with ▶ build-up, Look inside with values at a pin | `ui-code-view.js` |
| Time | What moves and Trails views, filmstrip, playback speed, profile over time, time speed/offset per component, ❄ Freeze | `renderer.js`, `ui-filmstrip.js`, `ui-scope.js` |
| Measures | Stats tab: values, histogram, points, over the loop, inside the code, GPU time | `stats.js`, `ui-stats.js` |
| Browsing and reuse | gallery with filters, search and live previews; works in the palette; palette previews | `ui-library.js` |
| Export | JPEG, WebP, MP4, GIF, APNG, sprite sheet, web page, twigl code (plus PNG, sequence, WebM) | `encoders.js`, `standalone.js`, `ui-export.js` |
| Accessibility | high contrast (auto/high/normal), keyboard-adjustable numbers, reduced motion | `ui-settings.js`, `style.css` |
| Tools | works verification, version regression, performance report, WORKS generator | `tools/` |

## 4. Exports

| Format | How | Verified by |
|---|---|---|
| PNG | canvas PNG + `iTXt` project metadata | workflow (Pillow reads the metadata) |
| JPEG, WebP | canvas encoder with quality | workflow (JPEG size and format) |
| MP4 | WebCodecs H.264, exact frames, muxed by `muxMP4()` | unit test (box structure, offsets); OpenCV decoded 480 frames at 24 FPS from a 20 s export |
| GIF | median cut, ordered dithering, LZW, Netscape loop | unit test (LZW decoded back exactly); workflow (Pillow: frames, loop) |
| Animated PNG | browser PNG frames re-chunked (acTL, fcTL, fdAT) | unit test (chunk order, sequence numbers, CRCs); workflow (Pillow: animated, frames) |
| Sprite sheet | 2D canvas grid + JSON + project in a ZIP | workflow (16 frames in the JSON) |
| Web page | compiled shaders, point passes, parameters, credits in one HTML file | unit test (scene JSON); workflow (credit present); opened and played in Chromium |
| twigl code | the component's code, `param` lines as declarations, credit | unit test; workflow |
| PNG sequence, WebM | unchanged from 1.x | workflow |

## 5. Performance

Measured on an NVIDIA GeForce RTX 5070 through Direct3D 11 (ANGLE) with `tools/perf_report.py`; see [PERFORMANCE.json](PERFORMANCE.json) for every number.

| Improvement | Before | After |
|---|---|---|
| Changing a number of shader code | a recompile per change: 160–220 ms | a redraw: 2–7 ms |
| Drawing 20,000 points of a p5.js sketch | Canvas 2D: 120–137 ms per frame | GPU point pass: 0.12–0.16 ms per frame |
| Exporting a 20 s animation with every frame | real-time recording (20 s, frames may drop) | exact-frame MP4: about 4 s at 640 × 640 |
| Program source per scene | about 60 KB (every library) | 5–12 KB for most scenes (linked) |
| Filmstrip, gallery and palette previews | — | several moments per draw, one non-blocking readback |
| Frame time of the works at 1024 px | — | 0.4–9.4 ms (60 frames per second and more) |

Honest notes: linking the libraries shrinks programs about 7× but, on this Direct3D 11 driver, hardly changes compile time (the functions actually used dominate). Adding shader code to the large nebula scene compiles slowly on a cold driver cache (seconds); the previous image stays up meanwhile.

## 6. Tests

| Suite | 2.0 additions | Result |
|---|---|---|
| Unit tests (`node --test`) | `glsl.test.js` (parsing all works, loop lengths, more than twenty error messages, printing, formatting invariance, structure keys, number editing, linking, point clouds, limits), `encoders.test.js` (GIF, APNG, MP4, sheets, stats, web page, code), catalog and concept checks for the new entries | 328 passed, 0 failed |
| Workflow (`workflow_check.py`) | 16 new checks: gallery, live preview, number drag without recompiling, variables, loops, tour, Look inside at a pin, Stats, What moves and Trails, profile over time, filmstrip, freeze, code editing, point clouds, reuse, six exports, contrast and exact numbers | 51 passed (see [Validation](VALIDATION.md)) |
| Screenshots (`browser_check.py`) | gallery, code with a tour step, a variable, stats, point cloud, trails, reuse, high contrast | passed, no page errors; tablet and phone without sideways scrolling |
| Works (`works_check.py`) | new | 13/13 shaders bit-identical; 4/4 sketches within 0.81/255 mean |
| Regression (`compare_versions.py`) | new | 24/24 renders of the 1.x scenes identical to 1.4.0 |
| GPU validation (`gpu_validate.py`) | all 30 scenes, all 45 component kinds | see [Validation](VALIDATION.md) |

## 7. Known limits

| Limit | Why | Workaround |
|---|---|---|
| The Grok conversation was not studied | it requires a signed-in X account and has no public copy | none; recorded in the research ledger |
| The anemone is not a reproduction | its multi-pass shader was not published | it is labelled a study everywhere |
| twigl's backbuffer `b`, function definitions, arrays, textures are not supported | frames are stateless by design; the checker keeps code safe and explainable | write the code inline; each case has an explanatory error |
| Hardware GPUs can differ in the grain of chaotic fractals | float rounding differs between drivers | *Compile numbers as constants* matches twigl on the same driver; SwiftShader is bit-exact |
| A warped point cloud shows only what is inside the frame | points are drawn into a frame-sized texture | warp before placing the points in the equation, or zoom out |
| MP4 export needs WebCodecs | browsers offer it in secure contexts | open the file from disk or through `start.py`; otherwise use WebM, GIF or the PNG sequence |
| Safari, Firefox and physical phones were not tested | test environment | Chromium desktop, tablet and phone emulation were tested |
