"""Independent, slow scalar transcription of the printed DEFAULT equations.

This intentionally does not import any production formula helpers. It uses
math rather than NumPy, spells out the three color channels, and recomputes
prefix products literally. It is a test oracle for finite ordinary points,
not the renderer. Both implementations still share a human transcription;
agreement cannot independently prove that the source was read correctly.
"""
from math import acos, atan, cos, exp, floor, isfinite, prod, sin, sqrt


def g(z):
    if z >= 7:
        return 0.0
    if z <= -745:
        return 1.0
    return exp(-exp(z))


def evaluate(x, y):
    def R(s):
        return s / 10 + 3 / 50 * cos(5 * s * s)

    def U(s):
        return x + (3 / 20 + cos(3 * s * s) / 5) * y + 1e-4

    def L(s):
        u = U(s)
        if u == 0:
            raise ValueError("Scalar reference deliberately excludes the source's singular contour.")
        transverse = 2 * R(s) ** (3 / 10) * abs(u) ** (-3 / 10) * (y - (3 / 20 + cos(4 * s * s) / 5) * x)
        return sqrt(u * u + transverse * transverse) - R(s)

    ls = [L(s) for s in range(28)]
    js = [exp(-exp(25 - 50 * s)) * g(10 * ls[s]) for s in range(28)]
    weights = [prod(1 - js[u] for u in range(s)) * js[s] for s in range(1, 28)]
    S = 2 * sum(weights[s - 1] * ls[s] for s in range(1, 28))
    A = sum(weights[s - 1] * exp(-exp(3 / 20 * (s - 23)) - exp(-3 * ls[s]))
            for s in range(1, 28)) / 4

    def P(s):
        return y * cos(15 * s * s) - x * sin(15 * s * s)

    def Q(s):
        return x * cos(15 * s * s) + y * sin(15 * s * s)

    def D(s):
        f = 5 ** s * 4 ** (-s)
        return cos(f * (cos(7 * s) * S + sin(7 * s) * Q(s) + 2 * cos(17 * s))
                   + 4 * cos(f * (cos(4 * s) * S + sin(4 * s) * Q(s))) + 2 * cos(5 * s)) * cos(
                       f * (cos(7 * s) * Q(s) - sin(7 * s) * S + 2 * cos(15 * s))
                       + 4 * cos(f * (cos(8 * s) * S + sin(8 * s) * Q(s))) + 2 * cos(7 * s))

    E = sum((19 / 20) ** s * D(s) for s in range(1, 51))
    W = g(10 * sqrt(x * x + y * y) - 1 + E / 4)

    def C(a, s):
        f = (23 / 20) ** s / 5
        cells = cos(f * (cos(15 * s * s) * S + sin(15 * s * s) * Q(s)) + 2 * cos(27 * s * s)) * cos(
            f * (cos(15 * s * s) * Q(s) - sin(15 * s * s) * S) + 2 * cos(28 * s * s))
        return g(-(1 + 15 * a) / 4 * (cells - 5 / 4 + 2 * A + E / 7))

    def I(s):
        return 45 * C(1, s) + 6 * C(0, s)

    def K(v):
        return sum(I(s) * (19 / 20) ** s * (
            12 - 4 * v + v * v + (v - 1) * cos(2 * s * s) + 8 * cos((7 + v) * s * s)
        ) / 50 for s in range(1, 51))

    def M(s):
        return acos(cos(6 ** s * 5 ** (-s) * 2 * (
            cos(19 * s * s) * P(s) + sin(19 * s * s) * Q(s)) + 2 * cos(27 * s * s)))

    def N(s):
        return acos(cos(6 ** s * 5 ** (-s) * 2 * (
            cos(19 * s * s) * Q(s) - sin(19 * s * s) * P(s)) + 2 * cos(28 * s * s)))

    def B(s):
        angle = atan(M(s) / N(s))
        return g(5 * cos(20 * angle + 2 * cos(9 * angle + s * s)) + 15 / 4)

    def T(v):
        return sum((v * v - 2 * v + 4 + (v - 1) * (-1) ** s) / 4 * (
            4 * g(200 * (M(s) ** 2 + N(s) ** 2 - 1 / 800 - B(s) / 200))
            + g(20 * M(s) ** 2 + 20 * N(s) ** 2 - 7 / 50)
        ) for s in range(1, 31))

    ks, ts = [K(v) for v in range(3)], [T(v) for v in range(3)]
    hs = [11 / 10 * (1 - W) * ks[v] * A + (4 + v * v - v) / 2 * W + ts[v] for v in range(3)]
    fs = [max(0, min(255, floor(255 * g(-1000 * h) * abs(h) ** g(1000 * (h - 1))))) for h in hs]
    assert all(isfinite(h) for h in hs)
    return dict(S=S, A=A, E=E, W=W, K=ks, T=ts, H=hs, F=fs)
