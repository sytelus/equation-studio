import { catalog, parameterDefaults, bypassSocket, paramSpecs } from './catalog.js';
import { compileEquation, EquationError } from './expression.js';
/** JSON-only graph model; imported projects are data, never executable JavaScript. */
export const SCHEMA_VERSION = 1;
export const MAX_NODES = 80;
export const MAX_TRACKS = 160;
export const MAX_KEYS = 500;
export const MAX_LABEL = 160;
/** Camera bounds shared by validation and the canvas gestures. */
export const VIEW_LIMITS = { zoom: [0.1, 12], pan: [-20, 20] };
export const DURATION_LIMITS = [0.1, 120];
export const EXPOSURE_LIMITS = [0, 8];
const validId = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
export function makeNode(type, id, inputs = {}, params = {}) {
    const node = { id, type, label: catalog[type]?.name || type, inputs: { ...inputs }, params: { ...parameterDefaults(type), ...params }, enabled: true };
    // Parameters declared by a custom equation (`param` lines) start at their declared values.
    for (const [key, spec] of Object.entries(paramSpecs(node))) {
        if (!Object.hasOwn(node.params, key)) {
            node.params[key] = spec.value;
        }
    }
    return node;
}
/** Check a custom equation (see expression.js): it must parse and, when `kind`
 * (the component type) is given, have that component's result type. Equations
 * are data: they are type-checked and re-printed as GLSL, never pasted. Returns
 * the source unchanged.
 */
export function validateExpression(value, kind = null) {
    if (typeof value !== 'string') {
        throw new EquationError('An equation must be text.');
    }
    compileEquation(value, kind);
    return value;
}
function finiteRange(x, min, max, label) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) {
        throw new Error(`${label} must be a finite number in [${min}, ${max}].`);
    }
}
export function validateProject(project) {
    if (!project || typeof project !== 'object' || Array.isArray(project) || project.schemaVersion !== SCHEMA_VERSION) {
        throw new Error('Unsupported project schema. Expected equation-studio schemaVersion 1.');
    }
    if (typeof project.title !== 'string' || project.title.length > MAX_LABEL) {
        throw new Error(`Project title must be at most ${MAX_LABEL} characters.`);
    }
    if (!Array.isArray(project.nodes) || !project.nodes.length || project.nodes.length > MAX_NODES) {
        throw new Error(`Projects require 1–${MAX_NODES} components.`);
    }
    finiteRange(project.duration, ...DURATION_LIMITS, 'Duration');
    finiteRange(project.exposure, ...EXPOSURE_LIMITS, 'Exposure');
    if (!['source', 'filmic', 'linear'].includes(project.tone)) {
        throw new Error('Unknown output conversion.');
    }
    if (!project.view || typeof project.view !== 'object') {
        throw new Error('Missing view settings.');
    }
    finiteRange(project.view.zoom, ...VIEW_LIMITS.zoom, 'View zoom');
    finiteRange(project.view.x, ...VIEW_LIMITS.pan, 'View X');
    finiteRange(project.view.y, ...VIEW_LIMITS.pan, 'View Y');
    const byId = new Map();
    for (const n of project.nodes) {
        if (!n || !validId.test(n.id) || byId.has(n.id)) {
            throw new Error(`Invalid or duplicate node id: ${n?.id}`);
        }
        if (!Object.hasOwn(catalog, n.type)) {
            throw new Error(`Unknown component type: ${n.type}`);
        }
        if (typeof n.label !== 'string' || n.label.length > MAX_LABEL) {
            throw new Error(`Node labels must be strings of at most ${MAX_LABEL} characters.`);
        }
        if (typeof n.enabled !== 'boolean') {
            throw new Error(`${n.id}: enabled must be boolean.`);
        }
        if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params) || !n.inputs || typeof n.inputs !== 'object' || Array.isArray(n.inputs)) {
            throw new Error(`Invalid inputs or params for ${n.id}.`);
        }
        const def = catalog[n.type];
        if (def.custom) {
            try {
                validateExpression(n.params.expression, n.type);
            }
            catch (e) {
                throw new Error(`${n.label || n.id}: ${e.message}`);
            }
        }
        const specs = paramSpecs(n);
        for (const k of Object.keys(n.params)) {
            if (!Object.hasOwn(specs, k)) {
                throw new Error(`Unknown parameter ${n.id}.${k}.`);
            }
        }
        for (const [k, s] of Object.entries(specs)) {
            const v = n.params[k];
            if (s.kind === 'number') {
                finiteRange(v, s.min, s.max, `${n.id}.${k}`);
            }
            else if (s.kind === 'color' && (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))) {
                throw new Error(`Invalid RGB color at ${n.id}.${k}.`);
            }
            else if (s.kind === 'expression' && typeof v !== 'string') {
                throw new Error(`Invalid equation at ${n.id}.${k}.`);
            }
        }
        for (const k of Object.keys(n.inputs)) {
            if (!Object.hasOwn(def.inputs, k)) {
                throw new Error(`Unknown socket ${n.id}.${k}.`);
            }
        }
        byId.set(n.id, n);
    }
    for (const n of project.nodes) {
        for (const [key, target] of Object.entries(n.inputs)) {
            if (target === null || target === '') {
                continue;
            }
            if (typeof target !== 'string' || !byId.has(target)) {
                throw new Error(`Missing input ${target} on ${n.id}.${key}.`);
            }
            const actual = catalog[byId.get(target).type].output, expected = catalog[n.type].inputs[key];
            if (actual !== expected) {
                throw new Error(`${n.id}.${key} expects ${expected}, not ${actual}.`);
            }
        }
    }
    if (!byId.has(project.output)) {
        throw new Error('The output component does not exist.');
    }
    // Validate all nodes, including disconnected ones. Never permit latent cycles.
    const colors = new Map();
    function visit(id) {
        if (colors.get(id) === 1) {
            throw new Error(`Cycle detected at ${id}. Connections must form a directed acyclic graph.`);
        }
        if (colors.get(id) === 2) {
            return;
        }
        colors.set(id, 1);
        for (const t of Object.values(byId.get(id).inputs)) {
            if (t) {
                visit(t);
            }
        }
        colors.set(id, 2);
    }
    for (const id of byId.keys()) {
        visit(id);
    }
    if (!Array.isArray(project.tracks) || project.tracks.length > MAX_TRACKS) {
        throw new Error('Invalid animation tracks.');
    }
    const trackIds = new Set();
    for (const track of project.tracks) {
        const n = byId.get(track.node), s = n && paramSpecs(n)[track.param], key = `${track.node}.${track.param}`;
        if (!s || s.kind !== 'number' || trackIds.has(key)) {
            throw new Error(`Invalid or duplicate track: ${key}`);
        }
        trackIds.add(key);
        if (!['linear', 'smooth', 'hold'].includes(track.interpolation)) {
            throw new Error(`Invalid interpolation for ${key}.`);
        }
        if (!Array.isArray(track.keys) || track.keys.length > MAX_KEYS) {
            throw new Error(`A track can have at most ${MAX_KEYS} keys.`);
        }
        let previous = -1;
        for (const k of track.keys) {
            finiteRange(k.time, 0, project.duration, 'Key time');
            finiteRange(k.value, s.min, s.max, 'Key value');
            if (k.time <= previous) {
                throw new Error('Key times must be unique and increasing.');
            }
            previous = k.time;
        }
    }
    return project;
}
/** Inputs a node actually evaluates. A disabled node is bypassed: it evaluates only
 * its pass-through socket (catalog `bypass`), or nothing when it has none.
 */
export function activeInputs(node) {
    if (node.enabled) {
        return Object.values(node.inputs).filter(Boolean);
    }
    const socket = bypassSocket(node.type);
    return socket && node.inputs[socket] ? [node.inputs[socket]] : [];
}
/** Dependencies of `target` in evaluation order, ending with the target itself.
 * Disabled nodes pull in only their bypass input. Pass `null` to order every
 * node, which the multi-target preview shader uses.
 */
export function topologicalOrder(project, target = project.output) {
    const map = new Map(project.nodes.map(n => [n.id, n])), seen = new Set(), order = [];
    function walk(id) {
        if (seen.has(id)) {
            return;
        }
        const n = map.get(id);
        if (!n) {
            throw new Error(`Unknown component ${id}`);
        }
        seen.add(id);
        for (const i of activeInputs(n)) {
            walk(i);
        }
        order.push(n);
    }
    if (target === null) {
        for (const n of project.nodes) {
            walk(n.id);
        }
    }
    else {
        walk(target);
    }
    return order;
}
/** Every node in a valid evaluation order, following all connections whatever the
 * enabled flags. This is the order of the Pipeline panel: each node appears after
 * everything it reads.
 */
export function evaluationOrder(project) {
    const map = new Map(project.nodes.map(n => [n.id, n])), seen = new Set(), order = [];
    const walk = id => {
        if (seen.has(id) || !map.has(id)) {
            return;
        }
        seen.add(id);
        for (const source of Object.values(map.get(id).inputs)) {
            if (source) {
                walk(source);
            }
        }
        order.push(map.get(id));
    };
    project.nodes.forEach(n => walk(n.id));
    return order;
}
/** Nodes that read `id` directly, with the socket they read it through. */
export function consumers(project, id) {
    const result = [];
    for (const n of project.nodes) {
        for (const [socket, source] of Object.entries(n.inputs)) {
            if (source === id) {
                result.push({ node: n, socket });
            }
        }
    }
    return result;
}
/** IDs that `id` depends on, transitively (regardless of enabled flags). */
export function upstream(project, id) {
    const map = new Map(project.nodes.map(n => [n.id, n])), result = new Set();
    const walk = current => {
        for (const source of Object.values(map.get(current)?.inputs || {})) {
            if (source && !result.has(source)) {
                result.add(source);
                walk(source);
            }
        }
    };
    walk(id);
    return result;
}
/** IDs that depend on `id`, transitively (regardless of enabled flags). */
export function downstream(project, id) {
    const result = new Set();
    let frontier = [id];
    while (frontier.length) {
        const next = [];
        for (const n of project.nodes) {
            if (!result.has(n.id) && Object.values(n.inputs).some(source => frontier.includes(source))) {
                result.add(n.id);
                next.push(n.id);
            }
        }
        frontier = next;
    }
    return result;
}
export function parseProject(text) {
    if (typeof text !== 'string' || text.length > 1000000) {
        throw new Error('Project files are limited to 1 MB.');
    }
    return validateProject(JSON.parse(text));
}
export function uniqueId(project, type) {
    const ids = new Set(project.nodes.map(n => n.id));
    for (let i = 1; i <= MAX_NODES + 1; i++) {
        if (!ids.has(`${type}${i}`)) {
            return `${type}${i}`;
        }
    }
    throw new Error('No free component identifier.');
}
/** Delete a node, its incoming references and its tracks; the output falls back
 * to the last remaining node. Mutates and revalidates `project`.
 */
export function removeNode(project, id) {
    if (project.nodes.length === 1) {
        throw new Error('The project must keep at least one component.');
    }
    project.nodes = project.nodes.filter(n => n.id !== id);
    for (const n of project.nodes) {
        for (const k of Object.keys(n.inputs)) {
            if (n.inputs[k] === id) {
                delete n.inputs[k];
            }
        }
    }
    project.tracks = project.tracks.filter(t => t.node !== id);
    if (project.output === id) {
        project.output = project.nodes.at(-1).id;
    }
    return validateProject(project);
}
/** Undo/redo stack of project snapshots. Every entry is an independent clone. */
export class History {
    constructor(limit = 60) {
        this.limit = limit;
        this.past = [];
        this.future = [];
    }
    push(project) {
        this.past.push(clone(project));
        if (this.past.length > this.limit) {
            this.past.shift();
        }
        this.future = [];
    }
    undo(current) {
        if (!this.past.length) {
            return null;
        }
        this.future.push(clone(current));
        return this.past.pop();
    }
    redo(current) {
        if (!this.future.length) {
            return null;
        }
        this.past.push(clone(current));
        return this.future.pop();
    }
}
