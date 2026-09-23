"""Behavioral tests, independent-reference checks, and rendering invariants."""
from dataclasses import replace
from pathlib import Path
import json
import math
import re
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

from nebula import (SceneConfig, ShellConfig, StarConfig, TextureConfig, GeometryFields,
                    build_geometry, evaluate_scene, evaluate_nebula,
                    render, sample_coordinates, save_png, soft_cutoff, shell_residual, to_rgb8)
from nebula.atlas import make_atlas
from nebula.composition import add_emission, colorize, mask_emission, tint, transform_coordinates
from nebula.numeric import folded_angle
from nebula.presets import preset
from nebula.render import Viewport
from nebula.stars import star_color, star_kernel
from nebula.textures import filament_color
from reference_scalar import evaluate as scalar_reference


class NumericalTests(unittest.TestCase):
    def test_soft_cutoff_midpoint(self):
        self.assertAlmostEqual(float(soft_cutoff(0)), 1 / math.e)

    def test_soft_cutoff_extremes_without_overflow(self):
        with np.errstate(all="raise"):
            np.testing.assert_array_equal(soft_cutoff([-np.inf, -1000, 1000, np.inf]), [1, 1, 0, 0])

    def test_soft_cutoff_decreasing(self):
        self.assertTrue(np.all(np.diff(soft_cutoff(np.linspace(-10, 10, 300))) <= 0))

    def test_triangle_fold(self):
        np.testing.assert_allclose(folded_angle([0, math.pi, 2 * math.pi, -math.pi / 2]), [0, math.pi, 0, math.pi / 2], atol=1e-14)

    def test_display_matches_scalar_formula(self):
        values = np.array([-1, -0.1, -0.0001, 0, 0.001, 0.1, 0.5, 0.995, 0.999, 1, 1.001, 1.5, 10])
        expected = []
        def g(z):
            return math.exp(-math.exp(max(-745, min(7, z))))
        for h in values:
            expected.append(max(0, min(255, math.floor(255 * g(-1000 * h) * abs(h) ** g(1000 * (h - 1))))))
        np.testing.assert_array_equal(to_rgb8(values), expected)

    def test_display_rejects_nonfinite(self):
        for value in (np.nan, np.inf, -np.inf):
            with self.assertRaises(ValueError):
                to_rgb8(value)

    def test_display_extreme_finite(self):
        with np.errstate(all="raise"):
            np.testing.assert_array_equal(to_rgb8([-1e300, 1e300]), [0, 255])

    def test_original_blue_coefficients_not_clamped(self):
        self.assertTrue(any(filament_color(s)[2] < 0 for s in range(1, 51)))

    def test_star_alternating_colors(self):
        np.testing.assert_array_equal(star_color(1), [1.25, 0.75, 0.75])
        np.testing.assert_array_equal(star_color(2), [0.75, 0.75, 1.25])

    def test_star_kernel_at_lattice_origin(self):
        center, halo = star_kernel(np.array(0.0), np.array(0.0), 1)
        self.assertTrue(np.isfinite(center + halo))


class GeometryTests(unittest.TestCase):
    def test_scalar_evaluation(self):
        scene = evaluate_scene(0.0, 0.0)
        self.assertEqual(scene.composite().shape, (3,))
        self.assertTrue(np.isfinite(scene.composite()).all())

    def test_broadcast_evaluation(self):
        scene = evaluate_scene(np.array([0, 0.1])[None, :], np.array([-0.1, 0.0, 0.1])[:, None])
        self.assertEqual(scene.gas.shape, (3, 2, 3))

    def test_shell_envelope_bounds(self):
        x, y = sample_coordinates(59, 37)
        fields = build_geometry(x, y)
        self.assertGreaterEqual(float(fields.rim.min()), 0)
        self.assertLessEqual(float(fields.rim.max()), 0.25)
        self.assertGreaterEqual(float(fields.coverage.min()), 0)
        self.assertLessEqual(float(fields.coverage.max()), 1)

    def test_singular_contour_has_finite_aggregate(self):
        # x=-offset,y=0 makes u exactly zero for all default shells.
        self.assertTrue(np.isinf(shell_residual(-1e-4, 0.0, 1)))
        fields = build_geometry(-1e-4, 0.0)
        self.assertTrue(np.isfinite(fields.warp))
        self.assertTrue(np.isfinite(fields.rim))

    def test_undefined_intersection_convention(self):
        cfg = replace(ShellConfig(), neck_offset=0)
        self.assertLess(float(shell_residual(0.0, 0.0, 1, cfg)), 0)

    def test_replace_geometry(self):
        x, y = sample_coordinates(8, 5)
        blank = np.zeros_like(x)
        geometry = GeometryFields(blank, blank, blank)
        fields = evaluate_nebula(x, y, geometry=geometry)
        np.testing.assert_array_equal(fields.gas, 0)

    def test_reject_mismatched_geometry(self):
        with self.assertRaises(ValueError):
            evaluate_nebula(np.zeros((3, 2)), np.zeros((3, 2)), geometry=GeometryFields(np.zeros(2), np.zeros(2), np.zeros(2)))

    def test_reject_nonfinite_coordinates(self):
        with self.assertRaises(ValueError):
            evaluate_scene(np.inf, 0)

    def test_zero_star_gain(self):
        scene = evaluate_scene([0.0, 0.1], [0.1, 0.0], replace(SceneConfig(), star_gain=0))
        np.testing.assert_array_equal(scene.stars, 0)

    def test_scene_layer_identity(self):
        scene = evaluate_scene(np.array([0, 0.2]), np.array([0, 0.4]))
        np.testing.assert_array_equal(scene.composite(), scene.gas + scene.core + scene.stars)


class ReferenceTests(unittest.TestCase):
    def test_independent_scalar_reference_at_32_source_pixels(self):
        # Deterministic sampling for tests; production has no random generator.
        rng = np.random.default_rng(20260922)
        pixels = [(1000, 601), (1, 1), (2000, 1200), (1001, 600), (420, 900), (1400, 400), (1000, 1), (2000, 601)]
        pixels += list(zip(rng.integers(1, 2001, 24), rng.integers(1, 1201, 24)))
        for m, n in pixels:
            x, y = (float(m) - 1000) / 420, (601 - float(n)) / 420
            expected = scalar_reference(x, y)
            scene = evaluate_scene(x, y)
            actual = dict(S=scene.nebula.geometry.warp, A=scene.nebula.geometry.rim,
                          E=scene.nebula.turbulence, W=scene.nebula.core_mask,
                          K=scene.nebula.cloud_color, T=scene.stars, H=scene.composite())
            for name, value in actual.items():
                with self.subTest(pixel=(m, n), field=name):
                    np.testing.assert_allclose(value, expected[name], rtol=2e-8, atol=2e-9)
            with self.subTest(pixel=(m, n), field="F"):
                np.testing.assert_array_equal(to_rgb8(scene.composite()), expected["F"])


class RenderTests(unittest.TestCase):
    def test_original_grid_coordinates(self):
        x, y = sample_coordinates(2000, 1200, start_row=600, row_count=1)
        self.assertEqual(x[0, 0], -999 / 420)
        self.assertEqual(x[0, -1], 1000 / 420)
        self.assertEqual(y[0, 0], 0)
        self.assertEqual(x[0, 999], 0)

    def test_grid_y_orientation(self):
        x, y = sample_coordinates(7, 5)
        self.assertGreater(y[0, 0], y[-1, 0])
        self.assertLess(x[0, 0], x[0, -1])

    def test_custom_viewport(self):
        x, y = sample_coordinates(1, 1, viewport=Viewport(2, -3, 4, 2))
        np.testing.assert_allclose([x.item(), y.item()], [2, -3])

    def test_coordinate_tiles_match_full_grid(self):
        full_x, full_y = sample_coordinates(31, 17)
        x, y = sample_coordinates(31, 17, start_row=7, row_count=6)
        np.testing.assert_array_equal(x, full_x[7:13])
        np.testing.assert_array_equal(y, full_y[7:13])

    def test_tiled_render_is_pixel_identical(self):
        shader = lambda x, y: evaluate_scene(x, y).composite()
        a = render(shader, width=47, height=29, tile_rows=1)
        b = render(shader, width=47, height=29, tile_rows=29)
        np.testing.assert_array_equal(a, b)

    def test_supersampling_constant_field(self):
        def constant(x, y):
            return np.broadcast_to([0.2, 0.4, 0.8], x.shape + (3,))
        a = render(constant, width=9, height=7, supersample=1)
        b = render(constant, width=9, height=7, supersample=3)
        np.testing.assert_array_equal(a, b)

    def test_supersampling_averages_before_display(self):
        def shader(x, y):
            intensity = np.where(x > 0, 2.0, 0.0)
            return colorize(intensity, (1, 1, 1))
        pixels = render(shader, width=1, height=1, supersample=2, viewport=Viewport(0, 0, 2, 2))
        np.testing.assert_array_equal(pixels, 255)

    def test_reject_bad_shader_shape(self):
        with self.assertRaises(ValueError):
            render(lambda x, y: x, width=4, height=3)

    def test_progress_completes(self):
        seen = []
        render(lambda x, y: colorize(x * 0, (1, 1, 1)), width=5, height=7, tile_rows=3,
               progress=lambda done, total: seen.append((done, total)))
        self.assertEqual(seen, [(3, 7), (6, 7), (7, 7)])

    def test_reject_bad_dimensions(self):
        for kwargs in (dict(width=0), dict(height=-1), dict(tile_rows=0), dict(supersample=0)):
            with self.assertRaises(ValueError):
                render(lambda x, y: colorize(x, (1, 1, 1)), **kwargs)

    def test_png_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "subdir/pixels.png"
            pixels = np.zeros((3, 4, 3), dtype=np.uint8)
            pixels[0, 0] = [1, 2, 3]
            save_png(path, pixels)
            with Image.open(path) as image:
                self.assertEqual(image.mode, "RGB")
                np.testing.assert_array_equal(np.array(image), pixels)


class CompositionTests(unittest.TestCase):
    def test_transform_translation_scale(self):
        x, y = transform_coordinates(3, 4, center=(1, 2), scale=2)
        np.testing.assert_allclose([x, y], [1, 1])

    def test_transform_rotation(self):
        x, y = transform_coordinates(1, 0, angle=math.pi / 2)
        np.testing.assert_allclose([x, y], [0, -1], atol=1e-15)

    def test_tint_and_mask(self):
        field = colorize(np.ones((2, 3)), (1, 2, 3))
        result = mask_emission(tint(field, (2, 1, 0.5)), np.full((2, 3), 0.5))
        np.testing.assert_allclose(result, np.broadcast_to([1, 1, 0.75], (2, 3, 3)))

    def test_emission_not_clipped(self):
        np.testing.assert_array_equal(add_emission([1, 2, 3], [1, 1, 1]), [2, 3, 4])

    def test_composition_rejects_shape_mismatch(self):
        with self.assertRaises(ValueError):
            add_emission(np.zeros((2, 3)), np.zeros((4, 3)))

    def test_color_index_is_not_mask_index(self):
        self.assertNotEqual(tuple(filament_color(1)), tuple(star_color(1)))


class ConfigurationAndCLITests(unittest.TestCase):
    def test_reject_invalid_config(self):
        for constructor in (lambda: ShellConfig(count=0), lambda: TextureConfig(turbulence_decay=2),
                            lambda: StarConfig(bands=True), lambda: SceneConfig(gas_gain=-1),
                            lambda: SceneConfig(core_color=(1, 2)), lambda: ShellConfig(radius_wobble=0.2)):
            with self.assertRaises(ValueError):
                constructor()

    def test_presets_leave_defaults_unchanged(self):
        self.assertEqual(preset("gas-only").star_gain, 0)
        self.assertEqual(SceneConfig().star_gain, 1)
        with self.assertRaises(ValueError):
            preset("missing")

    def test_cli_small_render_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.png"
            process = subprocess.run([sys.executable, "-m", "nebula", "render", "--width", "20", "--output", str(path), "--quiet"],
                                     capture_output=True, text=True)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertTrue(path.exists())
            metadata = json.loads(path.with_suffix(".json").read_text())
            self.assertEqual((metadata["width"], metadata["height"]), (20, 12))

    def test_atlas_contains_real_composites_and_raw_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            make_atlas(directory, width=16, height=10, tile_rows=3, save_fields=True)
            folder = Path(directory)
            self.assertTrue((folder / "index.html").exists())
            with np.load(folder / "fields.npz") as fields:
                expected = to_rgb8(fields["gas"] + fields["core"] + fields["stars"])
            with Image.open(folder / "composite_111.png") as image:
                np.testing.assert_array_equal(np.array(image), expected)
            self.assertEqual(len(list(folder.glob("composite_*.png"))), 8)
            # An atlas is self-contained even when generated outside the repo.
            page = (folder / "index.html").read_text(encoding="utf-8")
            for relative in re.findall(r'(?:src|href)="([^"#]+)"', page):
                self.assertTrue((folder / relative).exists(), relative)


if __name__ == "__main__":
    unittest.main()
