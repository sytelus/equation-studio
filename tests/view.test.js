import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreset } from '../src/presets.js';
import { makeNode, VIEW_LIMITS } from '../src/graph.js';
import { WORLD_WIDTH, HALF_PIXEL, unitsPerPixel, pixelToWorld, worldToPixel, clientToPixel, zoomAbout, panBy, tickSpacing, formatTick } from '../src/view-math.js';
import { layoutGraph, nodeHeight, outputSocketPoint, inputSocketPoint, wirePath, NODE_WIDTH, COLUMN_PITCH, PREVIEW_HEIGHT } from '../src/graph-layout.js';
import { parseSnapshots, addSnapshot, removeSnapshot, relativeTime, SNAPSHOT_LIMIT } from '../src/snapshots.js';

const close = (a, b, eps = 1e-9) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('camera arithmetic', () => {
    const view = { x: 0, y: 0, zoom: 1 };
    it('reproduces the native source mapping at 2000 × 1200', () => {
        // Column m and row n (1-based, top-first) map to x=(m-1000)/420, y=(601-n)/420.
        const m = 1300, n = 450, p = pixelToWorld(m - 1 + .5, 1200 - n + .5, 2000, 1200, view);
        close(p.x, (m - 1000) / 420);
        close(p.y, (601 - n) / 420);
    });
    it('pixel ↔ world round trips at several zooms and pans', () => {
        for (const v of [view, { x: 1.5, y: -0.7, zoom: 3.3 }, { x: -4, y: 2, zoom: .25 }]) {
            const w = pixelToWorld(123.5, 45.5, 800, 480, v), back = worldToPixel(w.x, w.y, 800, 480, v);
            close(back.px, 123.5);
            close(back.py, 45.5);
        }
    });
    it('client coordinates flip the y axis', () => {
        const rect = { left: 100, top: 50, right: 500, bottom: 290, width: 400, height: 240 };
        const p = clientToPixel(100, 290, rect, 800, 480);
        assert.deepEqual(p, { px: 0, py: 0 });
        assert.deepEqual(clientToPixel(500, 50, rect, 800, 480), { px: 800, py: 480 });
    });
    it('zoomAbout keeps the world point under the cursor fixed', () => {
        const v = { x: .3, y: -.2, zoom: 1.7 }, pixel = { px: 611.5, py: 77.5 };
        const before = pixelToWorld(pixel.px, pixel.py, 800, 480, v), next = zoomAbout(v, 2.9, before.x, before.y);
        const after = pixelToWorld(pixel.px, pixel.py, 800, 480, next);
        close(after.x, before.x);
        close(after.y, before.y);
        assert.equal(zoomAbout(v, 100, 0, 0).zoom, VIEW_LIMITS.zoom[1]);
        assert.equal(zoomAbout(v, 0, 0, 0).zoom, VIEW_LIMITS.zoom[0]);
    });
    it('panBy moves the view against the pointer and stays in bounds', () => {
        const v = panBy(view, 100, -50, 800);
        close(v.x, -100 * unitsPerPixel(800, 1));
        close(v.y, 50 * unitsPerPixel(800, 1));
        assert.equal(panBy(view, -1e9, 0, 800).x, VIEW_LIMITS.pan[1]);
    });
    it('constants match the shader', () => {
        close(WORLD_WIDTH, 2000 / 420);
        close(HALF_PIXEL, 1 / 840);
    });
});

describe('rulers', () => {
    it('tick spacing follows a 1-2-5 sequence and respects the pixel minimum', () => {
        assert.equal(tickSpacing(0.01, 64), 1);
        assert.equal(tickSpacing(0.001, 64), .1);
        assert.equal(tickSpacing(0.003, 64), .2);
        assert.equal(tickSpacing(0.006, 64), .5);
        assert(tickSpacing(0.0123, 50) / 0.0123 >= 50);
    });
    it('tick labels avoid floating-point noise and negative zero', () => {
        assert.equal(formatTick(0.30000000000000004, .1), '0.3');
        assert.equal(formatTick(-0.00001, .5), '0.0');
        assert.equal(formatTick(-1.5, .5), '-1.5');
        assert.equal(formatTick(2, 1), '2');
        assert.equal(formatTick(-0.0000001, 1), '0');
    });
});

describe('graph layout', () => {
    it('places nodes in dependency-depth columns, in project order', () => {
        const p = getPreset('bipolar'), { positions, width, height } = layoutGraph(p);
        assert.equal(positions.get('space').column, 0);
        assert.equal(positions.get('shell').column, 1);
        assert.equal(positions.get('turbulence').column, 2);
        assert.equal(positions.get('final').column, Math.max(...[...positions.values()].map(v => v.column)));
        assert(positions.get('stars').y > positions.get('shell').y);
        assert(width >= 50 + 6 * COLUMN_PITCH && height > 165);
    });
    it('is deterministic and grows with previews', () => {
        const p = getPreset('water');
        assert.deepEqual([...layoutGraph(p).positions], [...layoutGraph(p).positions]);
        const plain = nodeHeight(p.nodes[0], false), withPreview = nodeHeight(p.nodes[0], true);
        assert.equal(withPreview - plain, PREVIEW_HEIGHT + 8);
        assert(layoutGraph(p, { previews: true }).height > layoutGraph(p).height);
    });
    it('socket points and wire paths are consistent', () => {
        const pos = { x: 24, y: 18, height: 78 }, out = outputSocketPoint(pos), inp = inputSocketPoint(pos, 1);
        assert.equal(out.x, pos.x + NODE_WIDTH);
        assert(inp.y > outputSocketPoint(pos).y);
        assert(wirePath(out, inp).startsWith(`M${out.x},${out.y} C`));
    });
    it('handles a graph with unconnected nodes', () => {
        const p = getPreset('fire');
        p.nodes.push(makeNode('solid', 'extra'));
        assert.equal(layoutGraph(p).positions.get('extra').column, 0);
    });
});

describe('snapshots', () => {
    it('adds newest first, caps the list and drops invalid entries on parse', () => {
        let list = [];
        for (let i = 0; i < SNAPSHOT_LIMIT + 2; i++) {
            list = addSnapshot(list, { project: getPreset('fire'), time: i, thumb: '', title: `s${i}` });
        }
        assert.equal(list.length, SNAPSHOT_LIMIT);
        assert.equal(list[0].title, `s${SNAPSHOT_LIMIT + 1}`);
        const parsed = parseSnapshots(JSON.stringify([...list, { id: 'bad', title: 'x', time: 0, savedAt: 1, project: { schemaVersion: 9 } }, null]));
        assert.equal(parsed.length, SNAPSHOT_LIMIT);
        assert.deepEqual(parseSnapshots('not json'), []);
        assert.equal(removeSnapshot(list, list[0].id).length, SNAPSHOT_LIMIT - 1);
    });
    it('rejects invalid projects', () => {
        assert.throws(() => addSnapshot([], { project: { schemaVersion: 2 }, time: 0 }));
    });
    it('describes ages briefly', () => {
        const now = 1_000_000_000;
        assert.equal(relativeTime(now - 5000, now), 'just now');
        assert.equal(relativeTime(now - 120000, now), '2 min ago');
        assert.equal(relativeTime(now - 7200000, now), '2 h ago');
        assert.equal(relativeTime(now - 2 * 86400000, now), '2 d ago');
    });
});
