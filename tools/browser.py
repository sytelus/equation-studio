"""Shared Chromium launcher for the browser test scripts.

The browser is chosen in this order:

1. ``EQUATION_STUDIO_CHROMIUM`` — an explicit executable path.
2. ``/usr/bin/chromium`` when it exists (the documented Linux environment).
3. Playwright's bundled Chromium (``python -m playwright install chromium``).

The ANGLE/SwiftShader flags force the software GPU backend so that results are
comparable across machines; set ``EQUATION_STUDIO_HARDWARE_GPU=1`` to let the
browser pick its own backend instead.
"""
from __future__ import annotations
import os
from pathlib import Path

SOFTWARE_GPU_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']


def chromium_path() -> str | None:
    explicit = os.environ.get('EQUATION_STUDIO_CHROMIUM')
    if explicit:
        return explicit
    default = Path('/usr/bin/chromium')
    return str(default) if default.exists() else None


def launch(playwright, **kwargs):
    """Launch Chromium headless with the project's standard flags."""
    args = list(kwargs.pop('args', []))
    if not os.environ.get('EQUATION_STUDIO_HARDWARE_GPU'):
        args = SOFTWARE_GPU_ARGS + args
    options = {'headless': True, 'args': args, **kwargs}
    path = chromium_path()
    if path:
        options['executable_path'] = path
    return playwright.chromium.launch(**options)


def describe_backend() -> str:
    return 'browser-selected GPU backend' if os.environ.get('EQUATION_STUDIO_HARDWARE_GPU') else 'ANGLE / SwiftShader software backend'
