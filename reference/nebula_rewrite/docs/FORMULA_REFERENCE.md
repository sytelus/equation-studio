# Source-to-code formula reference

This appendix is the mathematical audit trail. The companion [walkthrough](WALKTHROUGH.md) explains the visual roles without requiring you to read all these expressions.

All formulas below describe the **default source reconstruction**. Configurable variations deliberately change selected constants. All angles are radians. Let

\[
g(z)=\exp(-\exp(z)),\qquad c_k(s)=\cos(ks^2),\qquad t_k(s)=\sin(ks^2).
\]

The shorthand `g` removes repeated nested exponentials. A product `g(a)g(b)` equals `exp(-exp(a)-exp(b))`; it does **not** equal `g(a+b)`.

## Symbol map

| Printed symbol | Rewritten name/function | Role |
|---|---|---|
| `F` | `numeric.to_rgb8` | Nonlinear output conversion and integer quantization |
| `H_v` | `scene.SceneFields.composite` | Total floating-point RGB emission |
| `K_v` | `textures.build_cloud_color` | Colored cloud detail before geometric masking |
| `T_v` | `stars.build_starfield` | Independent RGB star field |
| `B_s` | `ray_modulation` in `stars.star_kernel` | Angular variation in bright star centers |
| `M_s`, `N_s` | `stars.star_lattice` | Two folded star-lattice coordinates |
| `O` | `numeric.folded_angle` | Periodic fold `acos(cos(t))` |
| `I_s` | `textures.filament_intensity` | Strong filaments plus soft haze |
| `C_(a,s)` | `sharp_filaments`, `soft_haze` | Two threshold sharpnesses, not RGB indices |
| `A` | `GeometryFields.rim` | Hollow-shell emission envelope |
| `W` | `NebulaFields.core_mask` | Adds central glow and suppresses gas there |
| `E` | `textures.build_turbulence` | Weighted, signed multiscale modulation |
| `D_s` | `textures.turbulence_band` | One nested-cosine modulation band |
| `S` | `GeometryFields.warp` | Shell-following texture coordinate |
| `J_s` | `membership` in `geometry.build_geometry` | Soft shell membership |
| Product of `1-J_u` | `remaining` | Ordered prefix remainder |
| `L_s` | `geometry.shell_residual` | Signed implicit shell residual, not a true SDF |
| `P_s`, `Q_s` | `numeric.rotated_coordinates` | Rotated coordinate pair; returns **Q, P** |
| `R(s)` | `geometry.shell_radius` | Shell size |
| `U_s` | local `u` in `geometry.shell_residual` | Sheared longitudinal coordinate |

`v=0,1,2` indexes RGB only in `H`, `K`, and `T`. This appendix uses `a=0,1` for the sharpness selector in `C`, avoiding the printed formula's overloaded index notation.

## 1. Pixel coordinates and output

For source column \(m=1,\ldots,2000\), row \(n=1,\ldots,1200\):

\[
x=\frac{m-1000}{420},\qquad y=\frac{601-n}{420}.
\]

\[
F(h)=\left\lfloor 255\,g(-1000h)\,|h|^{g(1000(h-1))}\right\rfloor.
\]

The source's integer brackets are interpreted as floor/truncation of a nonnegative expression. A final byte-range guard is applied before uint8 conversion. No separate gamma or contrast transform is added.

## 2. Shell geometry

For a shell index \(s\):

\[
R_s=\frac{s}{10}+\frac{3}{50}c_5(s),
\]
\[
U_s=x+\left(\frac{3}{20}+\frac{1}{5}c_3(s)\right)y+10^{-4},
\]
\[
V_s=y-\left(\frac{3}{20}+\frac{1}{5}c_4(s)\right)x,
\]
\[
L_s=\sqrt{U_s^2+\left(2R_s^{3/10}|U_s|^{-3/10}V_s\right)^2}-R_s.
\]

`V_s` is a new local name for a subexpression already present in the source; it does not introduce a new formula.

\[
J_s=g(25-50s)\,g(10L_s),
\qquad w_s=J_s\prod_{u=0}^{s-1}(1-J_u).
\]

\[
S=2\sum_{s=1}^{27}w_sL_s,
\]
\[
A=\frac14\sum_{s=1}^{27}w_s\,g\left(\frac3{20}(s-23)\right)g(-3L_s).
\]

The code evaluates `w_s` with a running prefix product. The `s=0` membership underflows to exactly zero in float64, so the running remainder starts at 1. The implementation's treatment of `U_s=0` is documented separately; the printed formula is singular there.

## 3. Rotated coordinates

\[
P_s=y\cos(15s^2)-x\sin(15s^2),
\qquad Q_s=x\cos(15s^2)+y\sin(15s^2).
\]

The reusable function returns the conventional local pair `(u,v)=(Q_s,P_s)`. Keeping that order explicit avoids swapping the star lattice's coordinates accidentally.

## 4. Turbulent modulation

Let \(f_s=(5/4)^s\). Define four directional expressions:

\[
a_s=\cos(7s)S+\sin(7s)Q_s+2\cos(17s),
\]
\[
b_s=\cos(4s)S+\sin(4s)Q_s,
\]
\[
p_s=\cos(7s)Q_s-\sin(7s)S+2\cos(15s),
\]
\[
q_s=\cos(8s)S+\sin(8s)Q_s.
\]

Then the exact printed grouping is

\[
D_s=\cos\big(f_sa_s+4\cos(f_sb_s)+2\cos(5s)\big)
     \cos\big(f_sp_s+4\cos(f_sq_s)+2\cos(7s)\big).
\]

\[
E=\sum_{s=1}^{50}\left(\frac{19}{20}\right)^sD_s.
\]

**Do not move the phase offsets across parentheses.** The terms `2*cos(17*s)` and `2*cos(15*s)` are frequency-scaled. The terms `2*cos(5*s)` and `2*cos(7*s)` are added outside the inner bending cosine. This differs from putting every phase shift inside a cosine or placing every offset outside the frequency scaling.

## 5. Filament masks and cloud color

Let \(h_s=\frac15(23/20)^s\) and

\[
Z_s=\cos\left(h_s(\cos(15s^2)S+\sin(15s^2)Q_s)+2\cos(27s^2)\right)
\]
\[
\phantom{Z_s=}\times\cos\left(h_s(\cos(15s^2)Q_s-\sin(15s^2)S)+2\cos(28s^2)\right)
-\frac54+2A+\frac{E}{7}.
\]

\[
C_{a,s}=g\left(-\frac{1+15a}{4}Z_s\right),\qquad a\in\{0,1\},
\]
\[
I_s=45C_{1,s}+6C_{0,s}.
\]

For RGB channel \(v\in\{0,1,2\}\), define

\[
\kappa_{v,s}=\frac{12-4v+v^2+(v-1)\cos(2s^2)+8\cos((7+v)s^2)}{50},
\]
\[
K_v=\sum_{s=1}^{50}I_s\left(\frac{19}{20}\right)^s\kappa_{v,s}.
\]

All coefficients, including negative individual blue coefficients, are retained. `K_v` has not yet been multiplied by `A` or the central cutout.

## 6. Stars

Define the fold \(O(t)=\arccos(\cos t)\) and the lattice frequency \(j_s=2(6/5)^s\):

\[
M_s=O\left(j_s(\cos(19s^2)P_s+\sin(19s^2)Q_s)+2\cos(27s^2)\right),
\]
\[
N_s=O\left(j_s(\cos(19s^2)Q_s-\sin(19s^2)P_s)+2\cos(28s^2)\right).
\]

For ordinary points, let \(\theta_s=\arctan(M_s/N_s)\). Since \(M_s,N_s\ge0\), the implementation uses the equivalent \(\operatorname{atan2}(M_s,N_s)\) and defines the otherwise undefined `(0,0)` angle as zero.

\[
B_s=g\left(5\cos\left(20\theta_s+2\cos(9\theta_s+s^2)\right)+\frac{15}{4}\right).
\]

Let \(r_s^2=M_s^2+N_s^2\). The center and halo are

\[
\operatorname{center}_s=4g\left(200\left(r_s^2-\frac1{800}-\frac{B_s}{200}\right)\right),
\]
\[
\operatorname{halo}_s=g\left(20r_s^2-\frac7{50}\right).
\]

\[
\tau_{v,s}=\frac{v^2-2v+4+(v-1)(-1)^s}{4},
\qquad T_v=\sum_{s=1}^{30}\tau_{v,s}(\operatorname{center}_s+\operatorname{halo}_s).
\]

The scalar reference uses `20*M*M + 20*N*N` as printed; the vector implementation factors this to `20*(M*M+N*N)`. These are algebraically identical but can differ in last floating-point bits.

## 7. Core and final assembly

\[
W=g\left(10\sqrt{x^2+y^2}-1+\frac{E}{4}\right).
\]

Only \(x^2+y^2\) is inside the square root. The `-1` and `E/4` terms are outside it.

\[
H_v=\underbrace{\frac{11}{10}(1-W)K_vA}_{\text{gas}}
+\underbrace{\frac{4+v^2-v}{2}W}_{\text{central glow}}
+\underbrace{T_v}_{\text{stars}}.
\]

The source core coefficients evaluate to `(2,2,3)`. The displayed pixel is

\[
\operatorname{RGB}(F(H_0),F(H_1),F(H_2)).
\]

## Independent executable reference

`tests/reference_scalar.py` is a separate scalar transcription using Python's `math` module. It recomputes the prefix products literally and does not import production formula functions. Tests compare the intermediate fields `S,A,E,W,K,T,H` and the final byte colors at 32 deterministic source-grid pixels.

This is valuable for catching implementation and refactoring mistakes. It is not a formal proof of transcription: both implementations still depend on reading the supplied formula correctly. That is why the package also includes a full native render, comparison metrics against the supplied JPEG, and a source-mapping appendix rather than relying on tests alone.
