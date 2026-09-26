import { catalog } from './catalog.js';
/** Deterministic layered layout of the function graph. Nodes go into the column
 * of their dependency depth, in project order within a column, so the picture is
 * a function of the project alone and never needs saved positions.
 */
export const NODE_WIDTH = 176;
export const COLUMN_PITCH = 225;
export const ROW_GAP = 23;
export const SOCKET_PITCH = 13;
export const SOCKET_TOP = 29;
/** Size of every live thumbnail tile (graph cards and pipeline). */
export const PREVIEW_WIDTH = 160;
export const PREVIEW_HEIGHT = 96;
/** Height the thumbnail occupies on a graph card, which shows it at 150 × 90. */
export const CARD_PREVIEW_HEIGHT = 90;
const MARGIN_X = 24, MARGIN_Y = 18;
export function nodeHeight(node, previews) {
    const sockets = Object.keys(catalog[node.type].inputs).length;
    return Math.max(78, 42 + sockets * SOCKET_PITCH) + (previews ? CARD_PREVIEW_HEIGHT + 8 : 0);
}
/** Returns positions (id → {x, y, height, column}) and the board size in pixels. */
export function layoutGraph(project, { previews = false } = {}) {
    const map = new Map(project.nodes.map(n => [n.id, n])), depths = new Map();
    const depth = id => {
        if (depths.has(id)) {
            return depths.get(id);
        }
        const inputs = Object.values(map.get(id).inputs).filter(Boolean);
        const d = inputs.length ? 1 + Math.max(...inputs.map(depth)) : 0;
        depths.set(id, d);
        return d;
    };
    const columns = new Map();
    let maxDepth = 0;
    for (const n of project.nodes) {
        const d = depth(n.id);
        maxDepth = Math.max(d, maxDepth);
        if (!columns.has(d)) {
            columns.set(d, []);
        }
        columns.get(d).push(n);
    }
    const positions = new Map();
    let height = 165;
    for (const [d, nodes] of columns) {
        let y = MARGIN_Y;
        for (const n of nodes) {
            const h = nodeHeight(n, previews);
            positions.set(n.id, { x: MARGIN_X + d * COLUMN_PITCH, y, height: h, column: d });
            y += h + ROW_GAP;
        }
        height = Math.max(height, y + 10);
    }
    return { positions, width: 50 + (maxDepth + 1) * COLUMN_PITCH, height };
}
/** Board coordinates of a node's output dot and of its i-th input dot. */
export function outputSocketPoint(position) {
    return { x: position.x + NODE_WIDTH, y: position.y + SOCKET_TOP + 6 };
}
export function inputSocketPoint(position, index) {
    return { x: position.x, y: position.y + SOCKET_TOP + 6 + index * SOCKET_PITCH };
}
/** Cubic wire path between an output dot and an input dot. */
export function wirePath(from, to) {
    const bend = Math.max(30, Math.abs(to.x - from.x) / 3);
    return `M${from.x},${from.y} C${from.x + bend},${from.y} ${to.x - bend},${to.y} ${to.x},${to.y}`;
}
