import { $, esc, state, on, toast, showError, setSelected, connect, transact, addComponent, nodeById, setPref, clamp } from './editor.js';
import { catalog } from './catalog.js';
import { upstream, downstream } from './graph.js';
import { layoutGraph, PREVIEW_WIDTH, PREVIEW_HEIGHT, SOCKET_TOP, SOCKET_PITCH, outputSocketPoint, inputSocketPoint, wirePath } from './graph-layout.js';
import { DRAG_TYPE, draggedType, showLibraryTab } from './ui-library.js';
import { download } from './export.js';
/** Bottom panel: the typed function graph (automatic layered layout), live
 * per-node previews, wiring by click or drag, drag-and-drop from the palette,
 * and the generated GLSL view.
 */
const wireColors = { coord: '#7094b6', scalar: '#b4946d', layer: '#649b83', geometry: '#9a82b1' };
let positions = new Map(), tiles = new Map(), previewFrames = 0, previewError = false, bottomTab = 'graph';
function socketMarkup(n, def) {
    const inputs = Object.entries(def.inputs);
    return inputs.map(([socket, kind], i) => `<button class="socket input ${kind} ${n.inputs[socket] ? 'connected' : ''}" data-to="${n.id}" data-socket="${socket}" style="top:${SOCKET_TOP + i * SOCKET_PITCH}px" title="${esc(socket)} · ${kind} input" aria-label="Connect to ${esc(n.label)} ${socket}"></button>`).join('')
        + `<button class="socket output ${def.output} ${state.connection === n.id ? 'chosen' : ''}" data-from="${n.id}" title="${def.output} output · click or drag to connect" aria-label="Connect output of ${esc(n.label)}"></button>`;
}
function marks(n) {
    const list = [];
    if (state.project.output === n.id) {
        list.push('OUTPUT');
    }
    if (state.isolated === n.id) {
        list.push('ISOLATED');
    }
    if (state.contribution === n.id) {
        list.push('CONTRIBUTION');
    }
    return list.length ? `<span class="output-mark">${list.join(' · ')}</span>` : '';
}
export function renderGraph() {
    const project = state.project, previews = state.prefs.previews, layout = layoutGraph(project, { previews });
    positions = layout.positions;
    $('graphBoard').style.width = `${layout.width}px`;
    $('graphBoard').style.height = `${layout.height}px`;
    $('graphEdges').setAttribute('width', layout.width);
    $('graphEdges').setAttribute('height', layout.height);
    let edges = '', nodes = '';
    for (const n of project.nodes) {
        const pos = positions.get(n.id), def = catalog[n.type], inputs = Object.entries(def.inputs);
        inputs.forEach(([socket, kind], i) => {
            const from = n.inputs[socket];
            if (from) {
                edges += `<path d="${wirePath(outputSocketPoint(positions.get(from)), inputSocketPoint(pos, i))}" data-edge-from="${from}" data-edge-to="${n.id}" fill="none" stroke="${wireColors[kind]}" stroke-width="1.5" opacity="${n.enabled ? .75 : .25}"/>`;
            }
        });
        const preview = previews ? `<canvas class="node-preview" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" data-preview="${n.id}" aria-label="Preview of ${esc(n.label)}"></canvas>` : '';
        nodes += `<div class="graph-node ${def.output} ${state.selected === n.id ? 'selected' : ''} ${n.enabled ? '' : 'disabled'}" data-node="${n.id}" style="left:${pos.x}px;top:${pos.y}px;height:${pos.height}px" tabindex="0" role="button" aria-label="Inspect ${esc(n.label)}"><b>${esc(n.label)}</b><small>${esc(def.category)} · ${esc(def.output)}</small><div class="node-sockets">${inputs.map(([socket]) => `<span class="in-label">${esc(socket)}</span>`).join('')}</div>${preview}${socketMarkup(n, def)}${marks(n)}</div>`;
    }
    const hadFocus = $('graphNodes').contains(document.activeElement);
    $('graphEdges').innerHTML = edges + '<path id="dragWire" fill="none" stroke="#a5f2cf" stroke-width="1.5" stroke-dasharray="4 3" style="display:none"/>';
    $('graphNodes').innerHTML = nodes;
    if (hadFocus) { // keep keyboard focus on the selected card so Delete/Enter keep working
        document.querySelector(`[data-node="${state.selected}"]`)?.focus({ preventScroll: true });
    }
    paintTiles();
    updateSummary();
    $('connectionHint').textContent = state.connection
        ? `Connecting ${state.connection} (${catalog[nodeById(state.connection).type].output}). Click a compatible input dot. Escape cancels.`
        : 'Click a component to inspect it. Drag an output dot to an input dot to wire them, or drag a palette entry onto a socket.';
}
function updateSummary() {
    const status = state.prefs.previews ? (previewError ? ' · previews unavailable' : ' · live previews') : '';
    $('graphSummary').textContent = `${state.project.nodes.length} nodes / typed DAG${status}`;
    $('previewsButton').classList.toggle('active', state.prefs.previews);
    $('previewsButton').setAttribute('aria-pressed', String(state.prefs.previews));
}
function paintTiles() {
    document.querySelectorAll('[data-preview]').forEach(canvas => {
        const tile = tiles.get(canvas.dataset.preview);
        if (tile) {
            canvas.getContext('2d').putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
        }
    });
}
/** Refresh every node thumbnail from one atlas draw; called by the frame loop. */
export function updatePreviews() {
    if (!state.prefs.previews || !state.renderer || state.busy || previewError || !state.previewsDirty) {
        return;
    }
    if (state.playing && (previewFrames++ % 2)) {
        return; // half rate during playback
    }
    try {
        tiles = state.renderer.previewAtlas(state.project, state.time, state.project.nodes.map(n => n.id), PREVIEW_WIDTH, PREVIEW_HEIGHT);
        paintTiles();
        state.previewsDirty = false;
    }
    catch (e) {
        previewError = true;
        showError(e);
        updateSummary();
    }
}
export function setPreviews(enabled) {
    previewError = false;
    tiles = new Map();
    setPref('previews', !!enabled);
    renderGraph();
}
/** Scroll the selected component into view. */
export function locateSelected() {
    const card = document.querySelector(`[data-node="${state.selected}"]`);
    card?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}
// ---- Hover: dim everything unrelated to the hovered component ----------------
function highlightRelated(id) {
    const related = id ? new Set([id, ...upstream(state.project, id), ...downstream(state.project, id)]) : null;
    document.querySelectorAll('.graph-node').forEach(el => el.classList.toggle('dim', !!related && !related.has(el.dataset.node)));
    document.querySelectorAll('[data-edge-from]').forEach(el => el.classList.toggle('dim', !!related && !(related.has(el.dataset.edgeFrom) && related.has(el.dataset.edgeTo))));
}
$('graphNodes').addEventListener('mouseover', e => {
    const card = e.target.closest('[data-node]');
    if (card) {
        highlightRelated(card.dataset.node);
    }
});
$('graphNodes').addEventListener('mouseleave', () => highlightRelated(null));
// ---- Wiring: click-click or drag between dots ---------------------------------
let wire = null;
function boardPoint(clientX, clientY) {
    const rect = $('graphBoard').getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
}
function rewire(from, detach, to) {
    return transact(p => {
        if (detach) {
            delete p.nodes.find(n => n.id === detach.node).inputs[detach.socket];
        }
        if (to) {
            p.nodes.find(n => n.id === to.node).inputs[to.socket] = from;
        }
    }, { structural: true });
}
$('graphNodes').addEventListener('pointerdown', e => {
    if (state.busy || e.button !== 0) {
        return;
    }
    const output = e.target.closest('[data-from]'), input = e.target.closest('[data-to]');
    if (output) {
        wire = { from: output.dataset.from, detach: null, x: e.clientX, y: e.clientY, moved: false };
    }
    else if (input) {
        const source = nodeById(input.dataset.to)?.inputs[input.dataset.socket];
        wire = { from: source || null, detach: source ? { node: input.dataset.to, socket: input.dataset.socket } : null, target: { node: input.dataset.to, socket: input.dataset.socket }, x: e.clientX, y: e.clientY, moved: false };
    }
    if (wire) {
        e.target.setPointerCapture(e.pointerId);
        e.preventDefault();
    }
});
$('graphNodes').addEventListener('pointermove', e => {
    if (!wire || !wire.from) {
        return;
    }
    if (!wire.moved && Math.hypot(e.clientX - wire.x, e.clientY - wire.y) < 4) {
        return;
    }
    wire.moved = true;
    const path = $('dragWire');
    path.setAttribute('d', wirePath(outputSocketPoint(positions.get(wire.from)), boardPoint(e.clientX, e.clientY)));
    path.style.display = ''; // SVG elements ignore the HTML `hidden` property
    document.querySelectorAll('.socket.input').forEach(el => el.classList.toggle('drop-ok', catalog[nodeById(el.dataset.to).type].inputs[el.dataset.socket] === catalog[nodeById(wire.from).type].output));
});
function finishWire(e) {
    const w = wire;
    wire = null;
    if (!w) {
        return;
    }
    $('dragWire').style.display = 'none';
    document.querySelectorAll('.drop-ok').forEach(el => el.classList.remove('drop-ok'));
    if (!w.moved) { // Plain click keeps the two-click workflow.
        if (w.target) {
            if (state.connection) {
                connect(state.connection, w.target.node, w.target.socket);
            }
            else {
                toast('First click an output dot, then a compatible input. You can also drag between dots.');
            }
        }
        else {
            state.connection = state.connection === w.from ? null : w.from;
            renderGraph();
        }
        return;
    }
    const drop = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-to]');
    if (drop) {
        const to = { node: drop.dataset.to, socket: drop.dataset.socket };
        if (w.detach && to.node === w.detach.node && to.socket === w.detach.socket) {
            return; // dropped back where it started
        }
        rewire(w.from, w.detach, to);
    }
    else if (w.detach) {
        rewire(w.from, w.detach, null);
    }
}
$('graphNodes').addEventListener('pointerup', finishWire);
$('graphNodes').addEventListener('pointercancel', () => {
    wire = null;
    $('dragWire').style.display = 'none';
});
$('graphNodes').addEventListener('click', e => {
    if (e.target.closest('.socket')) {
        return; // handled by the pointer handlers above
    }
    const card = e.target.closest('[data-node]');
    if (card) {
        setSelected(card.dataset.node);
    }
});
$('graphNodes').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.graph-node')) {
        e.preventDefault();
        setSelected(e.target.dataset.node);
    }
});
// ---- Drag-and-drop from the palette --------------------------------------------
function dropTarget(e, type) {
    const socket = e.target.closest?.('[data-to]'), card = e.target.closest?.('[data-node]'), output = catalog[type].output;
    if (socket) {
        return { node: socket.dataset.to, socket: socket.dataset.socket };
    }
    if (card) {
        const n = nodeById(card.dataset.node), inputs = Object.entries(catalog[n.type].inputs).filter(([, kind]) => kind === output);
        const free = inputs.find(([s]) => !n.inputs[s]) || inputs[0];
        return free ? { node: n.id, socket: free[0] } : null;
    }
    return null;
}
for (const zone of [$('graphViewport'), $('stage')]) {
    zone.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        zone.classList.add('drop');
        const type = draggedType();
        if (type && zone === $('graphViewport')) {
            const target = dropTarget(e, type);
            document.querySelectorAll('.socket.input').forEach(el => el.classList.toggle('drop-ok', !!target && el.dataset.to === target.node && el.dataset.socket === target.socket));
        }
    });
    zone.addEventListener('dragleave', e => {
        if (!zone.contains(e.relatedTarget)) {
            zone.classList.remove('drop');
            document.querySelectorAll('.drop-ok').forEach(el => el.classList.remove('drop-ok'));
        }
    });
    zone.addEventListener('drop', e => {
        zone.classList.remove('drop');
        document.querySelectorAll('.drop-ok').forEach(el => el.classList.remove('drop-ok'));
        const type = e.dataTransfer.getData(DRAG_TYPE);
        if (!type) {
            return;
        }
        e.preventDefault();
        try {
            addComponent(type, { connectTo: zone === $('graphViewport') ? dropTarget(e, type) : null });
        }
        catch (err) {
            showError(err);
        }
    });
}
// ---- Toolbar, tabs, GLSL view and the resizable splitter ----------------------
document.querySelectorAll('[data-bottom]').forEach(b => b.onclick = () => {
    bottomTab = b.dataset.bottom;
    document.querySelectorAll('[data-bottom]').forEach(v => v.classList.toggle('active', v === b));
    $('graphViewport').hidden = bottomTab !== 'graph';
    $('shaderView').hidden = bottomTab !== 'shader';
    $('copyShader').hidden = bottomTab !== 'shader';
    $('graphFit').hidden = bottomTab !== 'graph';
    $('previewsButton').hidden = bottomTab !== 'graph';
});
$('copyShader').onclick = async () => {
    try {
        await navigator.clipboard.writeText($('shaderView').textContent);
        toast('Generated GLSL copied.');
    }
    catch (e) {
        download(new Blob([$('shaderView').textContent], { type: 'text/plain' }), 'construction.frag');
        toast('Clipboard unavailable. Saved the fragment shader instead.');
    }
};
$('previewsButton').onclick = () => setPreviews(!state.prefs.previews);
$('graphFit').onclick = locateSelected;
$('addComponent').onclick = () => {
    showLibraryTab('parts');
    $('library').classList.add('open');
    $('librarySearch').focus();
};
const splitter = $('graphSplitter');
let splitDrag = null;
export function applyGraphHeight(height) {
    const limit = Math.max(160, Math.floor($('layout').clientHeight * 0.7));
    const h = clamp(Math.round(height), 140, limit);
    $('layout').style.setProperty('--graph-height', `${h}px`);
    return h;
}
splitter.addEventListener('pointerdown', e => {
    splitDrag = { y: e.clientY, height: $('graphSection').getBoundingClientRect().height };
    splitter.setPointerCapture(e.pointerId);
    e.preventDefault();
});
splitter.addEventListener('pointermove', e => {
    if (splitDrag) {
        applyGraphHeight(splitDrag.height - (e.clientY - splitDrag.y));
    }
});
splitter.addEventListener('pointerup', e => {
    if (splitDrag) {
        setPref('graphHeight', applyGraphHeight(splitDrag.height - (e.clientY - splitDrag.y)));
        splitDrag = null;
    }
});
splitter.addEventListener('dblclick', () => setPref('graphHeight', applyGraphHeight(228)));
on('refresh', renderGraph);
on('selection', renderGraph);
on('view', renderGraph);
