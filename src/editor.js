import { catalog } from './catalog.js';
import { clone, makeNode, validateProject, uniqueId, removeNode, History, MAX_LABEL } from './graph.js';
import { getPreset } from './presets.js';
import { CONTRIBUTION_STYLES } from './compiler.js';
/** Shared editor core: transient state, the event bus and every model operation.
 *
 * UI state never enters shader source; numeric values remain uniforms. The
 * project JSON is the single persistent source of truth and every edit goes
 * through `transact()`, which validates a clone before it replaces the model, so
 * cycles and bad values never reach the renderer. Panels subscribe to events
 * rather than calling each other:
 *
 *   refresh    the project was replaced or structurally edited; rebuild everything
 *   selection  the selected component changed
 *   view       isolation / contribution mode changed
 *   time       the playhead moved
 *   history    undo/redo availability changed
 *   prefs      a persisted preference changed
 */
export const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const STORAGE = { project: 'equation-studio.project.v1', prefs: 'equation-studio.prefs.v1', snapshots: 'equation-studio.snapshots.v1' };
export const CUSTOM_STATUS = 'Custom construction';
const defaultPrefs = { previews: false, rulers: false, grid: false, quality: 800, graphHeight: 228 };
export const state = {
    project: getPreset('bipolar'),
    selected: 'shell',
    /** Node shown alone in the canvas, or null for the composite. */
    isolated: null,
    /** Node whose effect on the output is visualized, or null. */
    contribution: null,
    contributionStyle: 'highlight',
    time: 0,
    playing: false,
    /** The canvas needs a new frame. */
    dirty: true,
    /** An export owns the renderer; editing is suspended. */
    busy: false,
    /** Output node awaiting an input click (click-to-wire), or null. */
    connection: null,
    renderer: null,
    compiled: null,
    prefs: { ...defaultPrefs },
    /** Framebuffer position of a pinned readout marker, or null. */
    probePin: null,
    overlayDirty: true,
    previewsDirty: true,
    fps: 0,
    frameStamp: 0
};
export const history = new History();
const listeners = new Map();
export function on(event, fn) {
    if (!listeners.has(event)) {
        listeners.set(event, []);
    }
    listeners.get(event).push(fn);
}
export function emit(event, ...args) {
    for (const fn of listeners.get(event) || []) {
        fn(...args);
    }
}
export function readStorage(key) {
    try {
        return localStorage.getItem(key);
    }
    catch (e) { // Storage is optional (private mode / opaque origins). Never block rendering.
        return null;
    }
}
export function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    }
    catch (e) {
        return false;
    }
}
try {
    Object.assign(state.prefs, JSON.parse(readStorage(STORAGE.prefs) || '{}'));
}
catch (e) { /* Ignore unreadable preferences. */
}
export function savePrefs() {
    writeStorage(STORAGE.prefs, JSON.stringify(state.prefs));
    emit('prefs');
}
export function setPref(key, value) {
    state.prefs[key] = value;
    markDirty();
    savePrefs();
}
let toastTimer, saveTimer;
export function toast(message, error = false) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').className = error ? 'error' : '';
    $('toast').hidden = false;
    toastTimer = setTimeout(() => $('toast').hidden = true, error ? 8500 : 4200);
}
export function showError(error) {
    toast(error instanceof Error ? error.message : String(error), true);
}
/** Debounced autosave to browser storage; Save project remains the portable backup. */
export function persist() {
    clearTimeout(saveTimer);
    $('saveStatus').textContent = 'Unsaved changes';
    saveTimer = setTimeout(() => {
        $('saveStatus').textContent = writeStorage(STORAGE.project, JSON.stringify(state.project))
            ? 'Saved in this browser · no uploads'
            : 'Use Save project · browser storage unavailable';
    }, 300);
}
export function pause() {
    state.playing = false;
    $('play').textContent = '▶';
    $('play').setAttribute('aria-label', 'Play animation');
}
/** Request a new frame plus overlay and preview updates. */
export function markDirty() {
    state.dirty = true;
    state.overlayDirty = true;
    state.previewsDirty = true;
}
export function changed() {
    markDirty();
    persist();
    emit('history');
}
export function refreshUI() {
    if (!state.project.nodes.some(n => n.id === state.selected)) {
        state.selected = state.project.nodes[0].id;
    }
    if (state.isolated && !state.project.nodes.some(n => n.id === state.isolated)) {
        state.isolated = null;
    }
    if (state.contribution && !state.project.nodes.some(n => n.id === state.contribution)) {
        state.contribution = null;
    }
    if (state.connection && !state.project.nodes.some(n => n.id === state.connection)) {
        state.connection = null;
    }
    state.time = clamp(state.time, 0, state.project.duration);
    emit('refresh');
}
/** Structural edits turn a preset into a custom construction; value edits do not. */
export function markCustom(project) {
    project.status = CUSTOM_STATUS;
    project.id = 'custom';
}
/** Apply `edit` to a clone; keep it only when the result validates. */
export function transact(edit, { refresh = true, structural = false } = {}) {
    if (state.busy) {
        return false;
    }
    try {
        const next = clone(state.project);
        edit(next);
        if (structural) {
            markCustom(next);
        }
        validateProject(next);
        history.push(state.project);
        state.project = next;
        changed();
        if (refresh) {
            refreshUI();
        }
        return true;
    }
    catch (e) {
        showError(e);
        return false;
    }
}
/** Replace the whole project. History restores keep the playhead and selection. */
export function loadProject(next, { fromHistory = false } = {}) {
    validateProject(next);
    pause();
    if (!fromHistory) {
        history.push(state.project);
    }
    state.project = clone(next);
    state.connection = null;
    if (!fromHistory) {
        state.time = 0;
        state.isolated = null;
        state.contribution = null;
        state.probePin = null;
        state.selected = state.project.nodes.find(n => n.id !== 'space')?.id || state.project.nodes[0].id;
    }
    changed();
    refreshUI();
}
export function undo() {
    const previous = history.undo(state.project);
    if (previous) {
        loadProject(previous, { fromHistory: true });
    }
}
export function redo() {
    const next = history.redo(state.project);
    if (next) {
        loadProject(next, { fromHistory: true });
    }
}
export function currentNode() {
    return state.project.nodes.find(n => n.id === state.selected) || state.project.nodes[0];
}
export function nodeById(id) {
    return state.project.nodes.find(n => n.id === id);
}
export function setSelected(id) {
    state.selected = id;
    state.connection = null;
    emit('selection');
}
/** Show one component alone; clears contribution mode. */
export function setIsolated(id) {
    state.isolated = id;
    state.contribution = null;
    markDirty();
    emit('view');
}
/** Show which output pixels one component changes; clears isolation. */
export function setContribution(id, style = state.contributionStyle) {
    if (!CONTRIBUTION_STYLES.includes(style)) {
        throw new Error(`Unknown contribution style ${style}.`);
    }
    state.contribution = id;
    state.contributionStyle = style;
    state.isolated = null;
    markDirty();
    emit('view');
}
/** The node the canvas currently shows: isolated field, or the project output. */
export function viewTarget() {
    return state.isolated || state.project.output;
}
export function seek(t) {
    if (!Number.isFinite(t)) {
        throw new Error('Playhead time must be finite.');
    }
    pause();
    state.time = clamp(t, 0, state.project.duration);
    markDirty();
    emit('time');
}
// ---- Graph operations -------------------------------------------------------
/** Add a component; sockets connect to the selection when types match, else to
 * the first compatible node. `connectTo` = {node, socket} wires the new output
 * into that socket instead (drag-and-drop onto an input).
 */
export function addComponent(type, { connectTo = null } = {}) {
    if (!Object.hasOwn(catalog, type)) {
        throw new Error(`Unknown component: ${type}`);
    }
    let id;
    const ok = transact(p => {
        id = uniqueId(p, type);
        const def = catalog[type], selection = p.nodes.find(n => n.id === state.selected), inputs = {};
        for (const [socket, kind] of Object.entries(def.inputs)) {
            const match = selection && catalog[selection.type].output === kind ? selection : p.nodes.find(n => catalog[n.type].output === kind);
            if (match) {
                inputs[socket] = match.id;
            }
        }
        p.nodes.push(makeNode(type, id, inputs));
        if (connectTo) {
            const target = p.nodes.find(n => n.id === connectTo.node);
            if (!target || catalog[target.type].inputs[connectTo.socket] !== def.output) {
                throw new Error(`${def.name} produces ${def.output}; that socket expects a different type.`);
            }
            target.inputs[connectTo.socket] = id;
        }
    }, { refresh: false, structural: true });
    if (ok) {
        state.selected = id;
        state.isolated = connectTo ? null : id;
        state.contribution = null;
        refreshUI();
        toast(connectTo ? 'Component added and connected.' : 'Component added and isolated. Wire it downstream, then choose Set as output.');
    }
    return ok ? id : null;
}
export function connect(source, target, socket) {
    state.connection = null;
    const ok = transact(p => {
        const n = p.nodes.find(v => v.id === target);
        if (!n) {
            throw new Error('Unknown component.');
        }
        if (source) {
            n.inputs[socket] = source;
        }
        else {
            delete n.inputs[socket];
        }
    }, { structural: true });
    if (!ok) { // A rejected cycle must not leave stale DOM: rebuild from the model.
        refreshUI();
    }
    return ok;
}
export function duplicateNode(id) {
    const original = nodeById(id);
    if (!original) {
        return null;
    }
    let copyId;
    const ok = transact(p => {
        copyId = uniqueId(p, original.type);
        const copy = clone(original);
        copy.id = copyId;
        copy.label = `${original.label} copy`.slice(0, MAX_LABEL);
        p.nodes.push(copy);
    }, { refresh: false, structural: true });
    if (ok) {
        state.selected = copyId;
        refreshUI();
    }
    return ok ? copyId : null;
}
export function deleteNode(id) {
    return transact(p => removeNode(p, id), { structural: true });
}
export function setOutput(id) {
    state.isolated = null;
    state.contribution = null;
    return transact(p => p.output = id, { structural: true });
}
export function toggleEnabled(id) {
    return transact(p => {
        const n = p.nodes.find(v => v.id === id);
        n.enabled = !n.enabled;
    }, { structural: true });
}
