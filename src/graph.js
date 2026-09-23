import { catalog, parameterDefaults } from './catalog.js';
/** JSON-only graph model; imported projects are data, never executable JavaScript. */
export const SCHEMA_VERSION = 1;
export const MAX_NODES = 80;
const validId = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
export function makeNode(type, id, inputs = {}, params = {}) {
    return { id, type, label: catalog[type]?.name || type, inputs: { ...inputs }, params: { ...parameterDefaults(type), ...params }, enabled: true };
}
export function validateExpression(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 3000) {
        throw new Error('An expression must contain 1–3000 characters.');
    }
    // Expressions cannot declare variables, call JS, create textures, or contain loops.
    // GLSL itself performs the remaining symbol and return-type checks.
    if (!/^[a-zA-Z0-9_\s.+\-*/%(),?:<>=!&|]*$/.test(value) || /\b(?:while|for|do|return|discard|uniform|precision|layout|void)\b/.test(value) || /(?:\/\/|\/\*|\*\/|\+\+|--)/.test(value) || /(?<![<>=!])=(?!=)/.test(value)) {
        throw new Error('Use a GLSL expression only. Statements, assignments, comments, loops and declarations are not allowed.');
    }
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
    if (typeof project.title !== 'string' || project.title.length > 160) {
        throw new Error('Project title must be at most 160 characters.');
    }
    if (!Array.isArray(project.nodes) || !project.nodes.length || project.nodes.length > MAX_NODES) {
        throw new Error(`Projects require 1–${MAX_NODES} components.`);
    }
    finiteRange(project.duration, 0.1, 120, 'Duration');
    finiteRange(project.exposure, 0, 8, 'Exposure');
    if (!['source', 'filmic', 'linear'].includes(project.tone)) {
        throw new Error('Unknown output conversion.');
    }
    if (!project.view) {
        throw new Error('Missing view settings.');
    }
    finiteRange(project.view.zoom, 0.1, 12, 'View zoom');
    finiteRange(project.view.x, -20, 20, 'View X');
    finiteRange(project.view.y, -20, 20, 'View Y');
    const byId = new Map();
    for (const n of project.nodes) {
        if (!n || !validId.test(n.id) || byId.has(n.id)) {
            throw new Error(`Invalid or duplicate node id: ${n?.id}`);
        }
        if (!Object.hasOwn(catalog, n.type)) {
            throw new Error(`Unknown component type: ${n.type}`);
        }
        if (typeof n.label !== 'string' || n.label.length > 160) {
            throw new Error('Node labels must be strings of at most 160 characters.');
        }
        if (typeof n.enabled !== 'boolean') {
            throw new Error(`${n.id}: enabled must be boolean.`);
        }
        if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params) || !n.inputs || typeof n.inputs !== 'object' || Array.isArray(n.inputs)) {
            throw new Error(`Invalid inputs or params for ${n.id}.`);
        }
        const def = catalog[n.type];
        for (const k of Object.keys(n.params)) {
            if (!Object.hasOwn(def.params, k)) {
                throw new Error(`Unknown parameter ${n.id}.${k}.`);
            }
        }
        for (const [k, s] of Object.entries(def.params)) {
            const v = n.params[k];
            if (s.kind === 'number') {
                finiteRange(v, s.min, s.max, `${n.id}.${k}`);
            }
            else if (s.kind === 'color' && (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))) {
                throw new Error(`Invalid RGB color at ${n.id}.${k}.`);
            }
            else if (s.kind === 'expression') {
                validateExpression(v);
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
    if (!Array.isArray(project.tracks) || project.tracks.length > 160) {
        throw new Error('Invalid animation tracks.');
    }
    const trackIds = new Set();
    for (const track of project.tracks) {
        const n = byId.get(track.node), s = n && catalog[n.type].params[track.param], key = `${track.node}.${track.param}`;
        if (!s || s.kind !== 'number' || trackIds.has(key)) {
            throw new Error(`Invalid or duplicate track: ${key}`);
        }
        trackIds.add(key);
        if (!['linear', 'smooth', 'hold'].includes(track.interpolation)) {
            throw new Error(`Invalid interpolation for ${key}.`);
        }
        if (!Array.isArray(track.keys) || track.keys.length > 500) {
            throw new Error('A track can have at most 500 keys.');
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
        if (n.enabled) {
            for (const i of Object.values(n.inputs)) {
                if (i) {
                    walk(i);
                }
            }
        }
        order.push(n);
    }
    walk(target);
    return order;
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
