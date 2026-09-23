# Numerical fidelity, tests, and limitations

## What was verified

The delivered implementation was executed, not only written. Its default settings rendered the complete **2000 × 1200** source grid to `gallery/reconstruction_2000x1200.png`. Every output tile passed the renderer's finite-radiance check before conversion to RGB bytes.

The **42-test** standard-library `unittest` suite passed. The captured run is in [TEST_RESULTS.txt](TEST_RESULTS.txt). The suite covers an independent scalar formula reference at 32 source-grid pixels; intermediate fields `S,A,E,W,K,T,H`; final `F` values; scalar and broadcast evaluation; envelope bounds; singular-coordinate conventions; color coefficients; layer composition; custom geometry; source-grid indexing; tile-size invariance; supersampling; invalid inputs; PNG round-tripping; CLI metadata; and the atlas's eight correctly assembled combinations and raw-field export.

The independent reference uses Python `math`, separate functions, literal per-channel formulas, and explicit prefix products. It does not import the production formula helpers. Intermediate comparisons use relative tolerance `2e-8` and absolute tolerance `2e-9`; final byte colors are compared exactly at the selected test pixels.

This is not exhaustive formal verification. In particular, two implementations can share a transcription error. During development, comparison with the supplied image revealed misplaced phase offsets in an early reading of `D_s`; the delivered implementations, formula appendix, and renders use the corrected grouping. This is a concrete reason to keep both field-level tests and visual/source checks.

## Viewer verification scope

The atlas's generated combinations, raw fields, and all local HTML asset/link targets were checked. Interactive browser testing was attempted, but this execution environment blocked both file URLs and localhost navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`. No browser policy was changed. The browser UI therefore was not end-to-end verified here; this limitation is also recorded in [VIEWER_VALIDATION.json](VIEWER_VALIDATION.json).

The viewer has no external scripts, fonts, network fetches, or server-side computation: it uses relative PNG paths and inline JavaScript. It is designed to open from an extracted folder in an ordinary browser. An organization-managed browser may apply additional local-file restrictions.

## Comparison with the supplied image

The supplied file is a **1536 × 1536 JPEG** containing the artwork above its formulas. The comparison crops `[left=0, top=0, right=1536, bottom=922)` and resizes the native reconstruction to that rectangle. It does not optimize alignment, color correction, or crop position.

Different resize filters produce different pixel errors. All four tested filters are retained in [IMAGE_COMPARISON.json](IMAGE_COMPARISON.json):

| Native render resized with | Mean absolute channel error, 0–255 scale | RGB Pearson correlation |
|---|---:|---:|
| Nearest neighbor | 10.050 | 0.961946 |
| Bilinear | 4.924 | 0.993166 |
| Bicubic | 5.696 | 0.990664 |
| Lanczos | 6.286 | 0.988697 |

The bilinear comparison also has RMSE 7.802 and PSNR 30.286 dB. These are similarity measurements, not a “99.3% accurate” score or a proof that every formula character is correct. The source's native, uncompressed bitmap and original conversion pipeline were not available. JPEG compression, resizing, color handling, and arithmetic conventions prevent a justified byte-for-byte identity claim against the chat image.

The bundled `preview.png` is a Lanczos reduction of the native reconstruction. The atlas's 1000 × 600 fields, in contrast, were evaluated directly at their own pixel centers. Their fine detail can differ through sampling alone.

To repeat the comparison with a local copy of the supplied JPEG:

```bash
python -m tools.compare_reference \
  --reference path/to/supplied.jpg \
  --render gallery/reconstruction_2000x1200.png \
  --crop-height 922 \
  --output output/comparison.json
```

## Numerical decisions

### 1. Stable nested exponentials

`g(z)=exp(-exp(z))` is evaluated after clipping `z` to `[-745,7]`. At the upper endpoint the outer exponential already underflows to zero in float64; at the lower endpoint the result is already indistinguishable from one. This avoids overflowing an intermediate when the meaningful final result is zero. NaNs are not hidden.

`J_0` includes the factor `exp(-exp(25))`, which is mathematically positive but rounds to zero in float64. The prefix-product accumulator therefore starts at 1. This is a numerical simplification at the chosen precision, not a claim that the real-valued expression is literally zero.

### 2. Undefined shell coordinates

The source contains `abs(U_s)**(-0.3)` and is undefined on `U_s=0`.

For `U_s=0` with nonzero transverse coordinate, the implementation takes the fixed-transverse-coordinate limit `L_s=+infinity`. Membership then vanishes. A masked multiply avoids evaluating `0*infinity` in the aggregate warp.

At the isolated point where both transformed coordinates are zero, there is no unique two-dimensional limit. The implementation explicitly chooses the centerline value `L_s=-R_s`. That convention is tested and documented, not disguised by silently adding an arbitrary epsilon to every denominator. The default native grid does not sample that isolated point.

### 3. Undefined star angle

The source uses `atan(M_s/N_s)` with nonnegative folded coordinates. The implementation uses `atan2(M_s,N_s)`, preserving the ratio's angle where it is defined and supplying the correct axis limit when `N_s=0<M_s`. At `M_s=N_s=0`, the angle is explicitly defined as zero.

The argument order is intentional: swapping `M` and `N` changes the angular star detail.

### 4. Algebraic refactoring and floating-point order

Factors such as `5**s * 4**(-s)` become `(5/4)**s`; norms use `hypot`; repeated RGB geometry is computed once; and prefix products use a running remainder. These are real-arithmetic equivalences, but transcendental functions and rounding can produce last-bit differences across implementations, CPUs, and math libraries.

A few individual cloud blue coefficients are negative in the source and are preserved. Only the final display conversion clips the byte range. No extra gamma correction, contrast stretch, or filmic tone mapping is introduced.

The integer brackets in the source's `F` are interpreted as floor/truncation of the nonnegative expression. Different quantization conventions can change a boundary pixel by one channel level.

### 5. Supersampling is an optional change

The faithful default uses one sample per source pixel. `--supersample 2` evaluates four samples for each output pixel, averages **radiance**, and only then applies `F`. That is not the same operation as averaging already displayed RGB pixels, and it is not claimed to reconstruct an undocumented anti-aliasing choice by the artist.

A shifted-mean implementation preserves constant fields exactly and avoids a one-byte change caused solely by a mean's rounding error landing just below a floor boundary.

## Runtime and memory

The recorded native run took **21.38 seconds**, including PNG writing, in this execution environment. The JSON sidecar contains the precise measured duration and settings. The environment used Python 3.13.5, NumPy 2.3.5, and Pillow 12.3.0. The code targets Python 3.10+ and uses established NumPy/Pillow APIs, but the full version matrix was not tested.

Ordinary rendering holds a tile's intermediate fields plus the final RGB image. Its major working arrays scale with `width * tile_rows * supersample**2`. Increasing both image dimensions roughly quadruples work; doubling supersampling also roughly quadruples the number of evaluated points. Runtime is hardware- and library-dependent.

The atlas intentionally retains raw intermediate fields and can use much more memory than the tiled renderer. It is designed for moderate resolutions. Optional `fields.npz` exports are compressed float64 arrays; they are not necessary to render the default scene or view the bundled gallery.

## Boundaries of the implementation

This is a deterministic, two-dimensional procedural artwork, not a physical nebula simulation, astronomical reconstruction, 3-D volumetric asset, or star catalog renderer. “Turbulence,” “rim,” and related names describe visual/computational roles.

Small direct previews can alias fine detail. A different GPU backend, float32 precision, reduced band counts, fast trigonometric approximations, or a modulo-based replacement for `acos(cos(t))` can change the result. The supplied tests and field exports are intended to make those changes measurable, not to prohibit new artistic variations.
