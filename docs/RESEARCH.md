# Research, provenance, and what “from equations” establishes

Research date: **22 September 2026**. This report separates recovered evidence, mathematical inference, and new implementation choices. The executable studies are documented in [Recipes](RECIPES.md); their formulas are not attributed to unretrieved source sheets.

## Findings about the artist's process

In his own 2017 essay, [How to Draw with Math](https://www.scientificamerican.com/blog/guest-blog/how-to-draw-with-math/), Hamid Naderi Yeganeh describes choosing a real-world subject and incrementally adding mathematical expressions to increase the resemblance. He explains why periodic, bounded, smooth sine and cosine functions are useful. This supports deliberate, iterative mathematical design; it does not imply that recognizable subjects appear without intent.

His short article [Pictures from Networks of Mathematical Functions](https://doi.org/10.1080/10724117.2024.2368373), *Math Horizons* 32(1), 22–23, first published online 29 August 2024, describes a multi-step construction scenario, repeated computer experiments with candidate functions, and auxiliary-function networks that keep the final definition compact. The short article's text was retrieved through Exa; its DOI metadata was independently indexed. It supports a network-of-functions interpretation of the printed equations, not a claim that an automatic pixel optimizer, image-tracing pipeline, or generative model was used.

The following is our distinction, not a quotation or a diagnosis of the artist's private workflow:

**Forward rendering** evaluates a finished construction:

\[
I(x,y,t)=R(\mathcal G,\theta,x,y,t).
\]

Here \(\mathcal G\) is a graph of functions, \(\theta\) its parameters, and \(R\) the evaluation procedure. This is exactly what the application does.

**Inverse design** works backward from a desired result toward \(\mathcal G\) and \(\theta\). A human imagining a peacock and refining a feather equation is doing inverse design in this broad sense. That is compatible with the final renderer using nothing but mathematical functions.

**Automatic fitting** is a narrower, additional mechanism. One possible formulation would minimize an image discrepancy plus a complexity penalty:

\[
\min_{\mathcal G,\theta} L\big(R(\mathcal G,\theta),I_{\mathrm{target}}\big)
+\lambda\,\mathrm{complexity}(\mathcal G).
\]

This equation illustrates a possible optimization problem. It is **not** evidence that the artist used it, and this application does not implement such an optimizer. The local reference overlay supports human comparison only.

A finished expression ordinarily does not determine its history: the same function could be invented analytically, refined visually, optimized automatically, or copied from another source. Reproduction verifies the executable construction, not how it was discovered. Conversely, explaining an image by a function is most informative when the representation exposes reusable structure, not just a table of independent pixel values. Function sharing is therefore a central feature of the editor.

## Exact source-by-source ledger

Direct retrieval of the ten X URLs below was blocked; a batch Exa fetch also returned `SOURCE_NOT_AVAILABLE` for each. Searches recovered some primary captions and announcements, but **a caption is not a formula sheet**. The linked pages are retained as research leads, not treated as fully read documents.

| Requested source | Recovered evidence | Not recovered / consequence |
|---|---|---|
| [Stormy water planet](https://x.com/naderi_yeganeh/status/2099486463528153310) | Indexed artist-post caption identifying the subject | Full-resolution artwork/equations unavailable. Our sphere/cyclone/cloud construction is interpretive. |
| [Galaxy lensed by a star cluster](https://x.com/naderi_yeganeh/status/2098386890013479111) | Indexed primary caption identifying the subject | No original lens or galaxy equation sheet. We specify our own softened coordinate lens. |
| [Spiral aurora / auroral vortex](https://x.com/naderi_yeganeh/status/2094384568648261800) | Indexed primary caption identifying the subject | No original spiral/curtain equations. Our logarithmic ribbon is a new recipe. |
| [Black hole stretching a star](https://x.com/naderi_yeganeh/status/2089682273930998050) | Indexed primary caption; related artist caption also retrievable | No complete original formula. Our illustration is not a derivation of that exact artwork or a relativistic solver. |
| [Peacock in full display](https://x.com/naderi_yeganeh/status/2083165498674426049) | Indexed caption of the requested post; an older artist-posted peacock thumbnail was visible during research | The older thumbnail is not the requested formula sheet and was not substituted for it. The delivered feather/fan recipe is new. |
| [Hedgehog video announcement](https://x.com/naderi_yeganeh/status/1881707698640551955) | Indexed announcement of a short construction-scenario animation; corroborating artist-channel title | No inspected video frames or transcript. Our teaching example is not a transcription. |
| [Fire video announcement](https://x.com/naderi_yeganeh/status/1884272742159057270) | Indexed announcement and corroborating artist-channel title | No inspected video frames or transcript. Our advected flame field is not attributed to the video. |
| [2023 explanation thread](https://x.com/naderi_yeganeh/status/1610740065763745792) | URL and description supplied by the user | Full text not recovered. No invented quotation or reconstructed thread. |
| [Deedy's Rust debugging post](https://x.com/deedydas/status/1863051658022023477) | URL and description supplied by the user | Code and exchange not recovered. No claim to have diagnosed that program. |
| [Forward/inverse-design reply](https://x.com/aussetg/status/2102138297623433273) | URL and description supplied by the user | Reply text not recovered. Our distinction above is not represented as its exact wording. |

The [artist's YouTube channel](https://www.youtube.com/@naderiyeganeh) was also checked. Indexed listings corroborated the Hedgehog and Fire titles. Direct channel retrieval returned a shell rather than the video content. A presentation announcement is not equivalent to inspecting the presentation itself.

## The evidence standard used in the library

The supplied nebula has a readable equation sheet, a retained independent scalar transcription, the prior vectorized Python implementation, a native CPU image, and a new GPU implementation. It therefore supports a **source-equation port** label with explicit precision qualifications. The old CPU code remains unchanged and testable.

The five newer subjects have high-level descriptions but not recovered formulas. Their executable implementations are **subject-based studies**. The decomposition into geometry, texture, light, and composition is a constructive design proposal. We do not claim numerical similarity to unseen images, exact matching to the artist's private construction, or a recovered inverse-design search.

Hedgehog and Fire are **teaching studies**. They demonstrate how a compact scenario can be assembled from familiar atoms, without pretending to reproduce inaccessible tutorial steps. Additional Ring Nebula, Marble, Kaleidoscope, and One Feather scenes expose reuse directly.

## Reproduction pitfalls addressed in the port

The retained nebula equations contain a nested network, not a single unstructured pixel expression. Several errors can remain visually plausible: swapping the rotated coordinate pair; moving a phase term inside a nested cosine; using the wrong angular argument order; confusing scalar threshold indices with RGB indices; suppressing negative per-band color coefficients; clipping layers before addition; ignoring the one-based source pixel grid; and using a prefix sum instead of the ordered prefix product.

The GPU port adds a further issue: fixed large-angle trigonometric constants evaluated in shader float32 can shift very fine details. This was observed during development and reduced by computing those coordinate-independent constants once in JavaScript float64. Position-dependent fields remain GPU calculations. We tested both raw fields and the native final image; neither test alone establishes every aspect of transcription correctness. The full error distribution is summarized in [Validation](VALIDATION.md), including the worst outlier rather than only a favorable correlation score.

These are lessons from this implementation and its reference, **not** asserted explanations of the unrecovered Rust debugging exchange.

## Technical primary references

- [Khronos WebGL 2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/) — API, framebuffer, shader, precision, and context behavior. The `latest` document is an editor's draft, not a claim of a newly finalized standard.
- [Khronos EXT_color_buffer_float](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/) — optional floating-point render targets for raw field probes.
- [W3C Media Capture from DOM Elements](https://www.w3.org/TR/mediacapture-fromelement/) — canvas capture used for real-time video. Browser support is detected rather than assumed.
- [Bartelmann and Schneider, Weak Gravitational Lensing](https://arxiv.org/abs/astro-ph/9912508) — scientific background for lens mapping. Our dimensionless softened map is an illustrative simplification, not an implementation validated against that review, the artist's formulas, or astronomical observations.

## What would change the reconstruction status?

An exact new transcription needs the corresponding readable, complete equation sheet (and ideally a native uncompressed render). The source should first be recorded with attribution and dimensions. Then implement the equations independently, compare intermediate fields and source-grid pixels, and inspect disagreement maps before changing a preset's provenance label. A successful subject resemblance alone is insufficient. This pipeline is already embodied by the original nebula reference and GPU tests.
