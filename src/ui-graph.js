import { $, esc, state, on, toast, showError, setSelected, setView, setEnabled, viewedNode, connect, transact, addComponent, nodeById, setPref, clamp, bypassDescription } from './editor.js';
import { catalog, typeLabels } from './catalog.js';
import { upstream, downstream } from './graph.js';
import { layoutGraph, SOCKET_TOP, SOCKET_PITCH, outputSocketPoint, inputSocketPoint, wirePath } from './graph-layout.js';
import { DRAG_TYPE, draggedType, showLibraryTab } from './ui-library.js';
import { paintPreviews, resetPreviews, previewsFailed } from './ui-previews.js';
import { download } from './export.js';
/** Bottom panel: the Pipeline tab (see ui-pipeline.js), the typed function graph
 * (automatic layered layout) with live per-node previews, wiring by click or drag,
 * drag-and-drop from the palette, and the generated GLSL view.
 */
const wireColors = { coord: '#7094b6', scalar: '#b4946d', layer: '#649b83', geometry: '#9a82b1' };
let positions = new Map();
function socketMarkup(n, def) {
    const inputs = Object.entries(def.inputs), source = id => nodeById(id)?.label;
    return inputs.map(([socket, kind], i) => `<button class="socket input ${kind} ${n.inputs[socket] ? 'connected' : ''}" data-to="${n.id}" data-socket="${socket}" style="top:${SOCKET_TOP + i * SOCKET_PITCH}px" aria-label="Connect to ${esc(n.label)} ${socket}" data-tip="Input ${esc(socket)} · ${esc(typeLabels[kind])}|${n.inputs[socket] ? `Fed by ${esc(source(n.inputs[socket]))}. Drag away to disconnect or onto another input to move the wire.` : 'Unconnected: evaluates to zero. Drag here from a matching output dot.'}"></button>`).join('')
        + `<button class="socket output ${def.output} ${state.connection === n.id ? 'chosen' : ''}" data-from="${n.id}" aria-label="Connect output of ${esc(n.label)}" data-tip="Output · ${esc(typeLabels[def.output])}|Drag to an input dot of the same color to connect, or click here and then an input."></button>`;
}
function marks(n) {
    const list = [];
    if (state.project.output === n.id) {
        list.push('FINAL');
    }
    if (state.viewMode !== 'final' && viewedNode().id === n.id) {
        list.push(state.viewMode === 'stage' ? 'ON CANVAS' : 'EFFECT ON CANVAS');
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
        const preview = previews ? `<canvas class="node-preview" width="160" height="96" data-preview="${n.id}" aria-hidden="true"></canvas>` : '';
        const checkTip = `${n.enabled ? 'Included' : 'Bypassed'}|Untick to bypass: it then ${esc(bypassDescription(n))}.`;
        nodes += `<div class="graph-node ${def.output} ${state.selected === n.id ? 'selected' : ''} ${n.enabled ? '' : 'disabled'}" data-node="${n.id}" style="left:${pos.x}px;top:${pos.y}px;height:${pos.height}px" tabindex="0" role="button" aria-label="Inspect ${esc(n.label)}"><div class="node-head"><input type="checkbox" class="node-enable" data-enable="${n.id}" ${n.enabled ? 'checked' : ''} aria-label="Include ${esc(n.label)}" data-tip="${checkTip}"><b>${esc(n.label)}</b><button class="node-eye" data-show="${n.id}" aria-label="Show ${esc(n.label)} on the canvas" data-tip="Show this stage|Show this component’s output on the canvas.">👁</button></div><small>${esc(def.category)} · ${esc(typeLabels[def.output])}</small><div class="node-sockets">${inputs.map(([socket]) => `<span class="in-label">${esc(socket)}</span>`).join('')}</div>${preview}${socketMarkup(n, def)}${marks(n)}</div>`;
    }
    const hadFocus = $('graphNodes').contains(document.activeElement);
    $('graphEdges').innerHTML = edges + '<path id="dragWire" fill="none" stroke="#a5f2cf" stroke-width="1.5" stroke-dasharray="4 3" style="display:none"/>';
    $('graphNodes').innerHTML = nodes;
    if (hadFocus) { // keep keyboard focus on the selected card so Delete/Enter keep working
        document.querySelector(`[data-node="${state.selected}"]`)?.focus({ preventScroll: true });
    }
    paintPreviews($('graphNodes'));
    updateSummary();
    $('connectionHint').textContent = state.connection
        ? `Connecting ${state.connection} (${catalog[nodeById(state.connection).type].output}). Click a compatible input dot. Escape cancels.`
        : 'Click a card to inspect it · tick to include or bypass · 👁 shows its output · drag between dots to wire · drag palette entries onto sockets.';
}
function updateSummary() {
    const status = state.prefs.previews ? (previewsFailed() ? ' · previews unavailable' : ' · live previews') : '';
    $('graphSummary').textContent = `${state.project.nodes.length} components${status}`;
    $('previewsButton').classList.toggle('active', state.prefs.previews);
    $('previewsButton').setAttribute('aria-pressed', String(state.prefs.previews));
}
export function setPreviews(enabled) {
    resetPreviews();
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
    if (e.target.closest('.socket') || e.target.closest('.node-enable')) {
        return; // sockets use the pointer handlers above; checkboxes their change event
    }
    const eye = e.target.closest('[data-show]');
    if (eye) {
        setView('stage', { node: eye.dataset.show, lock: false });
        return;
    }
    const card = e.target.closest('[data-node]');
    if (card) {
        setSelected(card.dataset.node);
    }
});
$('graphNodes').addEventListener('change', e => {
    const box = e.target.closest('[data-enable]');
    if (box) {
        setEnabled([box.dataset.enable], box.checked);
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
/** Show one bottom-panel tab: pipeline, graph or shader. Remembered across sessions. */
export function showBottomTab(tab) {
    const known = ['pipeline', 'graph', 'shader'], active = known.includes(tab) ? tab : 'pipeline';
    document.querySelectorAll('[data-bottom]').forEach(v => v.classList.toggle('active', v.dataset.bottom === active));
    $('pipelineView').hidden = active !== 'pipeline';
    $('graphViewport').hidden = active !== 'graph';
    $('shaderView').hidden = active !== 'shader';
    $('copyShader').hidden = active !== 'shader';
    $('graphFit').hidden = active !== 'graph';
    $('connectionHint').hidden = active !== 'graph';
    $('previewsButton').hidden = active === 'shader';
    if (state.prefs.bottomTab !== active) {
        state.prefs.bottomTab = active;
        setPref('bottomTab', active);
    }
    state.previewsDirty = true;
}
document.querySelectorAll('[data-bottom]').forEach(b => b.onclick = () => showBottomTab(b.dataset.bottom));
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
splitter.addEventListener('dblclick', () => setPref('graphHeight', applyGraphHeight(260)));
on('refresh', renderGraph);
on('selection', renderGraph);
on('view', renderGraph);
on('prefs', updateSummary);
