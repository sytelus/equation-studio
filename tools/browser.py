"""Shared Chromium launcher for the browser test scripts.

The browser is chosen in this order:

1. ``EQUATION_STUDIO_CHROMIUM`` — an explicit executable path.
2. ``/usr/bin/chromium`` when it exists (the documented Linux environment).
3. Playwright's bundled Chromium (``python -m playwright install chromium``).

By default the ANGLE/SwiftShader flags force the software GPU backend so that
results are comparable across machines. Set ``EQUATION_STUDIO_HARDWARE_GPU=1``
to render on the machine's graphics processor instead: headless Chromium does
not use it unless asked, so the platform's ANGLE backend (Direct3D 11, Metal or
Vulkan) is requested explicitly. Timings and rounding then differ from the
published report.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

SOFTWARE_GPU_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
HARDWARE_ANGLE = {'win32': 'd3d11', 'darwin': 'metal'}


def hardware_gpu_args() -> list[str]:
    return [f'--use-angle={HARDWARE_ANGLE.get(sys.platform, "vulkan")}', '--enable-gpu', '--ignore-gpu-blocklist']


def chromium_path() -> str | None:
    explicit = os.environ.get('EQUATION_STUDIO_CHROMIUM')
    if explicit:
        return explicit
    default = Path('/usr/bin/chromium')
    return str(default) if default.exists() else None


def launch(playwright, **kwargs):
    """Launch Chromium headless with the project's standard flags."""
    args = list(kwargs.pop('args', []))
    args = (hardware_gpu_args() if os.environ.get('EQUATION_STUDIO_HARDWARE_GPU') else SOFTWARE_GPU_ARGS) + args
    options = {'headless': True, 'args': args, **kwargs}
    path = chromium_path()
    if path:
        options['executable_path'] = path
    return playwright.chromium.launch(**options)


def describe_backend() -> str:
    return 'hardware GPU (ANGLE)' if os.environ.get('EQUATION_STUDIO_HARDWARE_GPU') else 'ANGLE / SwiftShader software backend'
