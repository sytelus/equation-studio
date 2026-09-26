/** Small, dependency-free SVG line plots for the equation explanations: a
 * component's key function with its live parameters (catalog `curve`), or the
 * idea behind a concept (concepts.js). Pure: returns markup, no DOM access.
 */
const escapeXML = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Round, readable tick values covering [lo, hi]. */
export function ticks(lo, hi, count = 4) {
    if (!(hi > lo)) {
        return [lo];
    }
    const raw = (hi - lo) / count, magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= raw) || 10 * magnitude;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * step; v += step) {
        out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    }
    return out;
}
const label = v => {
    const a = Math.abs(v);
    return a !== 0 && (a < 1e-3 || a >= 1e4) ? v.toExponential(0) : String(Number(v.toPrecision(3)));
};
/** Sample `f` at `count` points across `domain`, dropping nonfinite values. */
export function sample(f, [a, b], count = 160) {
    const points = [];
    for (let i = 0; i < count; i++) {
        const x = a + (b - a) * i / (count - 1), y = f(x);
        if (Number.isFinite(y)) {
            points.push([x, y]);
        }
    }
    return points;
}
/** An SVG plot. `series` = [{f, label, color, bars, points}]: a function
 * evaluated over `domain`, bars [[x, y]], or given points [[x, y]] joined by a line;
 * `range` is fitted to the data unless given. `marks` = [{x, label}] vertical
 * guides (e.g. a parameter's position). Returns markup with a viewBox, so it
 * scales with its container.
 */
export function plotSVG({ series, domain, range = null, xLabel = '', yLabel = '', marks = [], width = 320, height = 150, samples = 160 }) {
    const labelled = series.some(s => s.label);
    // The y label and the legend sit in a band above the plot area, never over the curves.
    const left = 34, right = 8, top = yLabel || labelled ? 20 : 8, bottom = 26, w = width - left - right, h = height - top - bottom;
    const data = series.map(s => ({ ...s, points: s.points || (s.bars ? s.bars.map(([x, y]) => [x, y]) : sample(s.f, domain, samples)) }));
    let [y0, y1] = range || [Math.min(0, ...data.flatMap(s => s.points.map(p => p[1]))), Math.max(...data.flatMap(s => s.points.map(p => p[1])))];
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
        [y0, y1] = [0, 1];
    }
    if (y1 - y0 < 1e-12) {
        y0 -= 0.5;
        y1 += 0.5;
    }
    if (!range) {
        const pad = (y1 - y0) * 0.06;
        y1 += pad;
        if (y0 < 0) {
            y0 -= pad;
        }
    }
    const [x0, x1] = domain, X = x => left + (x - x0) / (x1 - x0) * w, Y = y => top + (1 - (y - y0) / (y1 - y0)) * h;
    let svg = `<svg class="plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXML(`${yLabel} against ${xLabel}`)}">`;
    for (const t of ticks(y0, y1, 3)) {
        svg += `<line class="grid" x1="${left}" x2="${left + w}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="tick" x="${left - 4}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end">${label(t)}</text>`;
    }
    for (const t of ticks(x0, x1, 4)) {
        svg += `<line class="grid" y1="${top}" y2="${top + h}" x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}"/><text class="tick" y="${top + h + 12}" x="${X(t).toFixed(1)}" text-anchor="middle">${label(t)}</text>`;
    }
    if (y0 < 0 && y1 > 0) {
        svg += `<line class="axis" x1="${left}" x2="${left + w}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`;
    }
    for (const m of marks) {
        if (m.x >= x0 && m.x <= x1) {
            svg += `<line class="mark" y1="${top}" y2="${top + h}" x1="${X(m.x).toFixed(1)}" x2="${X(m.x).toFixed(1)}"/>${m.label ? `<text class="mark-label" x="${(X(m.x) + 3).toFixed(1)}" y="${top + 9}">${escapeXML(m.label)}</text>` : ''}`;
        }
    }
    data.forEach((s, k) => {
        const color = s.color || ['#a5f2cf', '#e6b37f', '#91bce3', '#c6a0e7'][k % 4];
        if (s.bars) {
            const bw = Math.max(2, w / Math.max(s.points.length, 1) * 0.6);
            for (const [x, y] of s.points) {
                svg += `<rect x="${(X(x) - bw / 2).toFixed(1)}" y="${Math.min(Y(y), Y(0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(Y(y) - Y(0)).toFixed(1)}" fill="${color}" opacity="0.85"/>`;
            }
        }
        else if (s.points.length) {
            const d = s.points.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(Math.max(y0, Math.min(y1, y))).toFixed(1)}`).join('');
            svg += `<path class="curve" d="${d}" stroke="${color}"/>`;
        }
    });
    svg += `<text class="axis-label" x="${left + w}" y="${height - 2}" text-anchor="end">${escapeXML(xLabel)}</text><text class="axis-label" x="${left - 30}" y="12">${escapeXML(yLabel)}</text>`;
    const legend = data.map((s, k) => s.label ? `<tspan fill="${s.color || ['#a5f2cf', '#e6b37f', '#91bce3', '#c6a0e7'][k % 4]}">■ ${escapeXML(s.label)}</tspan>` : '').filter(Boolean).join(' ');
    if (legend) {
        svg += `<text class="legend" x="${left + w}" y="12" text-anchor="end">${legend}</text>`;
    }
    return `${svg}</svg>`;
}
