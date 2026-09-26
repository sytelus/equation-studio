import { $, esc, state, on, showError, transact, markDirty, applyParams, viewOptions, nodeById } from './editor.js';
import { catalog } from './catalog.js';
import { clone } from './graph.js';
import { animatedParameters, insertKey } from './timeline.js';
import { sweepValues, makeVariations } from './explore.js';
/** Exploration tray over the bottom of the canvas. A parameter sweep renders the
 * image across one parameter's range; variations render random nearby parameter
 * sets. Hovering a thumbnail previews it on the main canvas; clicking applies it
 * (undoable), so experiments are cheap to try and to take back.
 */
const THUMB_WIDTH = 176, THUMB_HEIGHT = 106;
let session = null, token = 0, applying = false;
const formatNumber = value => String(Number(Number(value).toFixed(4)));
function candidatesForSweep(nodeId, key) {
    const node = nodeById(nodeId), spec = catalog[node.type].params[key];
    const tracked = state.project.tracks.some(t => t.node === nodeId && t.param === key && t.keys.length);
    const current = animatedParameters(state.project, node, state.time)[key];
    return sweepValues(spec, 7).map(value => {
        const project = clone(state.project);
        if (tracked) { // animated: the sweep edits the key at the playhead
            insertKey(project, nodeId, key, state.time, value);
        }
        else {
            project.nodes.find(n => n.id === nodeId).params[key] = value;
        }
        return { project, label: `${spec.label} = ${formatNumber(value)}`, short: formatNumber(value), current: Math.abs(value - current) <= spec.step / 2 };
    });
}
function candidatesForVariations() {
    const { nodeId, scope, amount, seed } = session;
    return makeVariations(state.project, { nodeId: scope === 'scene' ? null : nodeId, count: 8, amount, seed }).map((v, i) => ({
        project: v.project,
        label: v.changes.map(c => `${nodeById(c.node)?.label}: ${catalog[nodeById(c.node).type].params[c.param].label} ${typeof c.from === 'number' ? `${formatNumber(c.from)} → ${formatNumber(c.to)}` : `${c.from} → ${c.to}`}`).join('\n') || 'No change',
        short: `#${i + 1}`
    }));
}
function build() {
    session.items = session.kind === 'sweep' ? candidatesForSweep(session.nodeId, session.key) : candidatesForVariations();
    render();
}
export function openSweep(nodeId, key) {
    const node = nodeById(nodeId), spec = catalog[node.type].params[key];
    session = { kind: 'sweep', nodeId, key, title: `${spec.label} across its range (${spec.min} → ${spec.max})`, subtitle: node.label };
    build();
}
export function openVariations(nodeId, scope = 'node') {
    session = { kind: 'variations', nodeId, scope, amount: 0.25, seed: Math.floor(Math.random() * 1e9), title: 'Variations', subtitle: nodeById(nodeId).label };
    build();
}
export function closeExplore() {
    session = null;
    token++;
    state.preview = null;
    $('exploreTray').hidden = true;
    markDirty();
}
export function exploreOpen() {
    return !!session;
}
function render() {
    const tray = $('exploreTray'), variations = session.kind === 'variations';
    $('exploreTitle').innerHTML = `${esc(session.title)} <small>${esc(variations && session.scope === 'scene' ? 'whole scene' : session.subtitle)}</small>`;
    $('exploreShuffle').hidden = !variations;
    $('exploreAmount').hidden = !variations;
    $('exploreScope').hidden = !variations;
    if (variations) {
        $('exploreAmount').value = String(session.amount);
        $('exploreScope').value = session.scope;
    }
    $('exploreItems').innerHTML = session.items.map((item, i) => `<button class="explore-item ${item.current ? 'current' : ''}" data-explore="${i}" data-tip="${esc(item.short)}|${esc(item.label)}\nHover to preview on the canvas, click to use it."><canvas width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" data-explore-thumb="${i}"></canvas><span>${esc(item.short)}</span></button>`).join('');
    tray.hidden = false;
    drawThumbnails(++token);
}
/** Render thumbnails one per frame so the editor stays responsive. */
function drawThumbnails(current) {
    const items = session.items;
    let i = 0;
    const step = () => {
        if (current !== token || !session || i >= items.length || !state.renderer) {
            return;
        }
        if (state.busy) {
            requestAnimationFrame(step);
            return;
        }
        try {
            const tile = state.renderer.snapshot(items[i].project, state.time, THUMB_WIDTH, THUMB_HEIGHT, viewOptions());
            const canvas = document.querySelector(`[data-explore-thumb="${i}"]`);
            canvas?.getContext('2d').putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
        }
        catch (e) {
            showError(e);
            return;
        }
        i++;
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
function apply(index) {
    const item = session.items[index];
    applying = true;
    let ok;
    if (session.kind === 'sweep') {
        const { nodeId, key } = session, source = item.project;
        ok = transact(p => {
            p.nodes.find(n => n.id === nodeId).params[key] = source.nodes.find(n => n.id === nodeId).params[key];
            p.tracks = clone(source.tracks);
        });
    }
    else {
        ok = applyParams(item.project, session.scope === 'scene' ? null : [session.nodeId]);
    }
    applying = false;
    state.preview = null;
    if (ok) {
        session.items.forEach((it, i) => it.current = i === index);
        document.querySelectorAll('[data-explore]').forEach(el => el.classList.toggle('current', Number(el.dataset.explore) === index));
    }
}
$('exploreItems').addEventListener('pointerover', e => {
    const item = e.target.closest('[data-explore]');
    if (item && session) {
        state.preview = session.items[Number(item.dataset.explore)].project;
        markDirty();
    }
});
$('exploreItems').addEventListener('pointerleave', () => {
    state.preview = null;
    markDirty();
});
$('exploreItems').addEventListener('click', e => {
    const item = e.target.closest('[data-explore]');
    if (item) {
        apply(Number(item.dataset.explore));
    }
});
$('exploreClose').onclick = closeExplore;
$('exploreShuffle').onclick = () => {
    session.seed = Math.floor(Math.random() * 1e9);
    build();
};
$('exploreAmount').onchange = e => {
    session.amount = Number(e.target.value);
    build();
};
$('exploreScope').onchange = e => {
    session.scope = e.target.value;
    build();
};
// Other edits make the candidates stale: rebuild them from the new project.
on('refresh', () => {
    if (!session || applying) {
        return;
    }
    if (!nodeById(session.nodeId)) {
        closeExplore();
        return;
    }
    build();
});
