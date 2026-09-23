"""Small, reusable numerical building blocks shared by all visual layers.

All angles are radians. All calculations use NumPy float64. A scalar field has
shape (height, width); an RGB field has shape (height, width, 3). Broadcasting
also allows evaluation at a single point or at an arbitrary list of points.
"""
from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

FloatArray = NDArray[np.float64]


def soft_cutoff(value: ArrayLike) -> FloatArray:
    """Evaluate g(z) = exp(-exp(z)) without overflowing the inner exponential.

    g(-large) is 1, g(0) is 1/e, and g(+large) is 0. This is a *decreasing*
    gate, not a sigmoid centered at 1/2. The original artwork uses it for
    boundaries, brightness peaks, and the output transfer function.

    Clipping only affects values already indistinguishable from 0 or 1 in
    float64: exp(-exp(7)) underflows to zero, and exp(-745) is subnormal.
    Infinities have their natural limiting values; NaNs remain NaNs.
    """
    z = np.asarray(value, dtype=np.float64)
    with np.errstate(under="ignore"):
        return np.exp(-np.exp(np.clip(z, -745.0, 7.0)))


def folded_angle(angle: ArrayLike) -> FloatArray:
    """Original O(t) = arccos(cos(t)): a periodic fold into [0, pi].

    Its minima at multiples of 2*pi turn a rotated coordinate grid into a
    repeating lattice of star centers. Keep the trig implementation here:
    replacing it with a remainder-based triangle wave can move last bits.
    """
    return np.arccos(np.clip(np.cos(angle), -1.0, 1.0))


def rotated_coordinates(
    x: ArrayLike, y: ArrayLike, angle: float
) -> tuple[FloatArray, FloatArray]:
    """Return (u, v) in a coordinate frame rotated by ``angle``.

    u = x*cos(angle) + y*sin(angle)
    v = y*cos(angle) - x*sin(angle)

    In the printed formula, u is Q_s and v is P_s for angle = 15*s*s.
    """
    c, s = np.cos(angle), np.sin(angle)
    return np.asarray(x) * c + np.asarray(y) * s, np.asarray(y) * c - np.asarray(x) * s


def coordinate_arrays(x: ArrayLike, y: ArrayLike) -> tuple[FloatArray, FloatArray]:
    """Broadcast and validate coordinates at a public evaluation boundary."""
    x, y = np.broadcast_arrays(np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64))
    if not (np.isfinite(x).all() and np.isfinite(y).all()):
        raise ValueError("Coordinates must be finite.")
    return x, y


def to_rgb8(radiance: ArrayLike) -> NDArray[np.uint8]:
    """Apply the printed F, then convert to 8-bit output (no extra gamma).

    F(h) = floor(255 * g(-1000*h) * abs(h)**g(1000*(h-1))).

    This closely resembles floor(255*clip(h, 0, 1)), but is NOT replaced by
    that approximation. Radiance is added before this nonlinear operation.
    The original square brackets are interpreted as integer truncation/floor.
    Final clipping is a defensive byte-range guard, not a tone mapper.
    """
    h = np.asarray(radiance, dtype=np.float64)
    if not np.isfinite(h).all():
        raise ValueError("Cannot display non-finite radiance.")
    with np.errstate(under="ignore", over="ignore"):
        low_gate = soft_cutoff(-1000.0 * h)
        high_power = soft_cutoff(1000.0 * (h - 1.0))
        mapped = 255.0 * low_gate * np.power(np.abs(h), high_power)
    return np.floor(np.clip(mapped, 0.0, 255.0)).astype(np.uint8)
