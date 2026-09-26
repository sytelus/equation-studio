import { catalog, bypassSocket } from './catalog.js';
import { clone, makeNode, validateProject, uniqueId, removeNode, upstream, evaluationOrder, History, MAX_LABEL } from './graph.js';
import { presets, getPreset } from './presets.js';
import { CONTRIBUTION_STYLES } from './compiler.js';
import { originalValue } from './explore.js';
/** Shared editor core: transient state, the event bus and every model operation.
 *
 * UI state never enters shader source; numeric values remain uniforms. The
 * project JSON is the single persistent source of truth and every edit goes
 * through `transact()`, which validates a clone before it replaces the model, so
 * cycles and bad values never reach the renderer. Panels subscribe to events
 * rather than calling each other:
 *
 *   refresh    the project was replaced or edited; rebuild everything
 *   selection  the selected component changed
 *   view       the canvas view mode, lock or contribution style changed
 *   time       the playhead moved
 *   history    undo/redo availability changed
 *   prefs      a persisted preference changed
 *
 * The canvas shows one of three views of the project:
 *   final   the scene's final output (what exports and saves)
 *   stage   the output of one component: the viewed node alone
 *   effect  the final output with and without the viewed node (what it changes)
 * The viewed node follows the selection unless the view is locked to a node.
 */
export const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const STORAGE = { project: 'equation-studio.project.v1', baseline: 'equation-studio.baseline.v1', prefs: 'equation-studio.prefs.v1', snapshots: 'equation-studio.snapshots.v1' };
export const CUSTOM_STATUS = 'Custom construction';
export const VIEW_MODES = ['final', 'stage', 'effect'];
/** Bump when defaults change in a way returning users should receive. */
const PREFS_VERSION = 2;
const defaultPrefs = { version: PREFS_VERSION, previews: true, rulers: true, grid: true, quality: 800, graphHeight: 260, bottomTab: 'pipeline' };
export const state = {
    project: getPreset('bipolar'),
    /** The project as it was opened (preset, file or snapshot): what "Original" and resets return to. */
    baseline: getPreset('bipolar'),
    selected: 'shell',
    viewMode: 'final',
    /** Node the stage/effect view is locked to, or null to follow the selection. */
    viewLock: null,
    contributionStyle: 'highlight',
    /** Temporary project drawn instead of the real one (explore hover), or null. */
    preview: null,
    /** Show the baseline while the Original button is held. */
    compareOriginal: false,
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
    frameStamp: 0,
    frameCount: 0
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
/** Stored preferences, upgraded to the current defaults for older versions. */
export function loadPrefs(text) {
    let stored = {};
    try {
        stored = JSON.parse(text || '{}') || {};
    }
    catch (e) { /* Ignore unreadable preferences. */
    }
    if (stored.version !== PREFS_VERSION) { // new defaults: previews, rulers and grid on
        stored = { quality: stored.quality, graphHeight: stored.graphHeight };
    }
    const prefs = { ...defaultPrefs };
    for (const [key, value] of Object.entries(stored)) {
        if (Object.hasOwn(defaultPrefs, key) && typeof value === typeof defaultPrefs[key]) {
            prefs[key] = value;
        }
    }
    prefs.version = PREFS_VERSION;
    return prefs;
}
state.prefs = loadPrefs(readStorage(STORAGE.prefs));
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
    toastTimer = setTimeout(() => $('toast').hidden = true, error ? 8500 : 4800);
}
export function showError(error) {
    toast(error instanceof Error ? error.message : String(error), true);
}
/** Debounced autosave to browser storage; Save project remains the portable backup. */
export function persist() {
    clearTimeout(saveTimer);
    $('saveStatus').textContent = 'Unsaved changes';
    saveTimer = setTimeout(() => {
        const ok = writeStorage(STORAGE.project, JSON.stringify(state.project)) && writeStorage(STORAGE.baseline, JSON.stringify(state.baseline));
        $('saveStatus').textContent = ok ? 'Autosaved in this browser · no uploads' : 'Use Save project · browser storage unavailable';
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
    const ids = new Set(state.project.nodes.map(n => n.id));
    if (!ids.has(state.selected)) {
        state.selected = state.project.nodes[0].id;
    }
    if (state.viewLock && !ids.has(state.viewLock)) {
        state.viewLock = null;
    }
    if (state.connection && !ids.has(state.connection)) {
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
/** Replace the whole project. History restores and reverts (`keepContext`) keep
 * the playhead, selection and view; a newly opened project becomes the new
 * baseline unless `keepBaseline` is set.
 */
export function loadProject(next, { fromHistory = false, keepBaseline = false, keepContext = false } = {}) {
    validateProject(next);
    pause();
    if (!fromHistory) {
        history.push(state.project);
    }
    state.project = clone(next);
    state.connection = null;
    state.preview = null;
    if (!keepBaseline && !fromHistory) {
        state.baseline = clone(next);
    }
    else if (fromHistory && next.id !== state.baseline.id && presets.some(p => p.id === next.id)) {
        state.baseline = getPreset(next.id); // undo/redo across a scene change: the original follows the scene
    }
    if (!fromHistory && !keepContext) {
        state.time = 0;
        state.viewMode = 'final';
        state.viewLock = null;
        state.probePin = null;
        state.selected = state.project.nodes.find(n => n.id !== 'space')?.id || state.project.nodes[0].id;
    }
    changed();
    refreshUI();
    emit('view');
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
/** Restore the scene exactly as it was opened (undoable). */
export function revertScene() {
    loadProject(state.baseline, { keepBaseline: true, keepContext: true });
    toast('Scene restored to how it was when opened. Undo brings your changes back.');
}
export function currentNode() {
    return state.project.nodes.find(n => n.id === state.selected) || state.project.nodes[0];
}
export function nodeById(id) {
    return state.project.nodes.find(n => n.id === id);
}
export function setSelected(id) {
    if (!nodeById(id)) {
        return;
    }
    state.selected = id;
    state.connection = null;
    if (state.viewMode !== 'final' && !state.viewLock) {
        markDirty(); // the stage/effect view follows the selection
    }
    emit('selection');
}
// ---- Canvas view -------------------------------------------------------------
/** The node the stage and effect views show: the lock, else the selection. */
export function viewedNode() {
    return (state.viewLock && nodeById(state.viewLock)) || currentNode();
}
/** Switch the canvas view. `node` also selects that node; `lock` pins the view. */
export function setView(mode, { node = null, lock } = {}) {
    if (!VIEW_MODES.includes(mode)) {
        throw new Error(`Unknown view ${mode}.`);
    }
    if (node) {
        state.selected = node;
        state.connection = null;
    }
    state.viewMode = mode;
    if (lock !== undefined) {
        state.viewLock = lock ? (node || viewedNode().id) : null;
    }
    if (mode === 'final') {
        state.viewLock = null;
    }
    markDirty();
    if (node) {
        emit('selection');
    }
    emit('view');
}
export function setContributionStyle(style) {
    if (!CONTRIBUTION_STYLES.includes(style)) {
        throw new Error(`Unknown contribution style ${style}.`);
    }
    state.contributionStyle = style;
    markDirty();
    emit('view');
}
/** Renderer options for the current view. */
export function viewOptions() {
    const project = state.project;
    if (state.viewMode === 'stage') {
        return { target: viewedNode().id };
    }
    if (state.viewMode === 'effect') {
        return { target: project.output, contribution: viewedNode().id, contributionStyle: state.contributionStyle };
    }
    return { target: project.output };
}
/** Node the canvas currently displays (for readouts and legends). */
export function viewTarget() {
    return state.viewMode === 'stage' ? viewedNode().id : state.project.output;
}
/** Move the stage view to the previous/next component in evaluation order. */
export function stepStage(delta) {
    const order = evaluationOrder(state.project), index = order.findIndex(n => n.id === viewedNode().id);
    const next = order[clamp((index < 0 ? 0 : index) + delta, 0, order.length - 1)];
    setView('stage', { node: next.id, lock: false });
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
// ---- Enabling and bypassing ---------------------------------------------------
/** Enable or disable components. Enabling also enables disabled components that
 * they depend on, so the result is visible; returns the ids enabled that way.
 */
export function setEnabled(ids, enabled) {
    const extra = new Set();
    const ok = transact(p => {
        for (const id of ids) {
            p.nodes.find(n => n.id === id).enabled = enabled;
            if (enabled) {
                for (const dep of upstream(p, id)) {
                    const n = p.nodes.find(v => v.id === dep);
                    if (!n.enabled) {
                        n.enabled = true;
                        extra.add(dep);
                    }
                }
            }
        }
    });
    if (ok && extra.size) {
        toast(`Also enabled ${[...extra].map(id => nodeById(id).label).join(', ')}, which ${ids.length === 1 ? nodeById(ids[0]).label : 'these'} ${ids.length === 1 ? 'needs' : 'need'}.`);
    }
    return ok ? [...extra] : null;
}
export function toggleEnabled(id) {
    return setEnabled([id], !nodeById(id).enabled);
}
export function enableAll() {
    return transact(p => p.nodes.forEach(n => n.enabled = true));
}
/** Disable every content component, keeping coordinates, combiners and modifiers,
 * so ticking components one by one builds the image up layer by layer.
 */
export function onlyStructure() {
    return transact(p => p.nodes.forEach(n => n.enabled = catalog[n.type].role !== 'content'));
}
/** Enabled flags as in the baseline; components added since are enabled. */
export function restoreEnabled() {
    return transact(p => p.nodes.forEach(n => {
        const original = state.baseline.nodes.find(b => b.id === n.id);
        n.enabled = original ? original.enabled : true;
    }));
}
/** What unticking a component does, for tooltips. */
export function bypassDescription(node) {
    const socket = bypassSocket(node.type), source = socket && nodeById(node.inputs[socket]);
    if (socket) {
        return source ? `passes “${source.label}” through unchanged` : `passes its ${socket} input through (currently unconnected, so zero)`;
    }
    return 'contributes nothing (zero)';
}
// ---- Parameters ---------------------------------------------------------------
export function resetParam(nodeId, key) {
    return transact(p => {
        const n = p.nodes.find(v => v.id === nodeId);
        n.params[key] = originalValue(state.baseline, n, key);
        p.tracks = p.tracks.filter(t => !(t.node === nodeId && t.param === key));
    });
}
export function resetNode(nodeId) {
    return transact(p => {
        const n = p.nodes.find(v => v.id === nodeId);
        for (const key of Object.keys(catalog[n.type].params)) {
            n.params[key] = originalValue(state.baseline, n, key);
        }
        p.tracks = p.tracks.filter(t => t.node !== nodeId);
    });
}
/** Replace one component's parameters with those of a candidate project (explore). */
export function applyParams(candidate, nodeIds = null) {
    return transact(p => {
        for (const n of p.nodes) {
            const source = candidate.nodes.find(c => c.id === n.id);
            if (source && (!nodeIds || nodeIds.includes(n.id))) {
                n.params = clone(source.params);
            }
        }
    });
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
        state.viewMode = connectTo ? state.viewMode : 'stage';
        state.viewLock = null;
        refreshUI();
        emit('view');
        toast(connectTo ? 'Component added and connected.' : 'Component added; the canvas shows its output. Wire it downstream, or make it the final output.');
    }
    return ok ? id : null;
}
/** Insert a modifier on an input: target.socket ← new ← previous source. */
export function insertComponent(type, targetId, socket) {
    const def = catalog[type], target = nodeById(targetId);
    if (!def || !target || !def.bypass || def.output !== catalog[target.type].inputs[socket]) {
        throw new Error('That component cannot be inserted on this input.');
    }
    let id;
    const ok = transact(p => {
        id = uniqueId(p, type);
        const t = p.nodes.find(n => n.id === targetId), inputs = {};
        if (t.inputs[socket]) {
            inputs[def.bypass] = t.inputs[socket];
        }
        const coordinates = t.inputs.p || p.nodes.find(n => n.type === 'coordinates')?.id; // extra coordinate sockets share the scene's coordinates
        for (const [s, kind] of Object.entries(def.inputs)) {
            if (!inputs[s] && kind === 'coord' && coordinates) {
                inputs[s] = coordinates;
            }
        }
        p.nodes.push(makeNode(type, id, inputs));
        t.inputs[socket] = id;
    }, { refresh: false, structural: true });
    if (ok) {
        state.selected = id;
        refreshUI();
        emit('view');
        toast(`${def.name} inserted on ${target.label} · ${socket}. Its parameters are in the inspector.`);
    }
    return ok ? id : null;
}
/** Change a component's kind in place, keeping its id, label and connections
 * wherever the new kind has a socket of the same name and type.
 */
export function replaceComponent(id, type) {
    const node = nodeById(id), def = catalog[type];
    if (!node || !def || def.output !== catalog[node.type].output) {
        throw new Error('The replacement must produce the same type.');
    }
    const ok = transact(p => {
        const n = p.nodes.find(v => v.id === id), fresh = makeNode(type, id);
        const oldInputs = n.inputs;
        fresh.inputs = {};
        for (const [socket, kind] of Object.entries(def.inputs)) {
            const same = oldInputs[socket] && catalog[n.type].inputs[socket] === kind ? oldInputs[socket] : null;
            const byType = Object.entries(catalog[n.type].inputs).find(([s, k]) => k === kind && oldInputs[s] && !Object.hasOwn(def.inputs, s));
            const source = same || (byType && oldInputs[byType[0]]);
            if (source) {
                fresh.inputs[socket] = source;
            }
        }
        fresh.enabled = n.enabled;
        Object.assign(n, fresh);
        p.tracks = p.tracks.filter(t => t.node !== id);
    }, { structural: true });
    if (ok) {
        toast(`Replaced with ${def.name}. Connections with matching sockets were kept.`);
    }
    return ok;
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
        emit('view');
    }
    return ok ? copyId : null;
}
export function deleteNode(id) {
    return transact(p => removeNode(p, id), { structural: true });
}
export function setOutput(id) {
    const ok = transact(p => p.output = id, { structural: true });
    if (ok) {
        setView('final');
        toast(`${nodeById(id).label} is now the final output: it is what the canvas shows in Final image, and what saves and exports use.`);
    }
    return ok;
}
