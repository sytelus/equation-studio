import { $, esc, state, on, toast, showError, loadProject, addComponent, seek, readStorage, writeStorage, STORAGE } from './editor.js';
import { catalog, typeNames } from './catalog.js';
import { presets, getPreset } from './presets.js';
import { thumbnails } from './thumbnails.js';
import { parseSnapshots, addSnapshot, removeSnapshot, thumbnailFrom, relativeTime } from './snapshots.js';
/** Left panel: scene presets, the component palette (click or drag to add) and
 * session snapshots.
 */
export const DRAG_TYPE = 'application/x-equation-studio-component';
let tab = 'scenes', dragged = null;
let snapshots = parseSnapshots(readStorage(STORAGE.snapshots));
/** Component type currently being dragged from the palette, if any. */
export function draggedType() {
    return dragged;
}
export function showLibraryTab(next) {
    tab = next;
    $('librarySearch').value = '';
    renderLibrary();
}
function renderScenes(query) {
    const cards = presets.filter(p => `${p.title} ${p.status}`.toLowerCase().includes(query)).map(p => `<button class="scene-card ${state.project.id === p.id ? 'active' : ''}" data-preset="${p.id}" title="${esc(p.description)}"><img src="${thumbnails[p.id] || ''}" alt="${esc(p.title)} procedural preview"><span><span class="scene-name">${esc(p.title)}</span><small>${esc(p.status)}</small></span></button>`);
    return `<div class="library-kicker">${presets.length} CONSTRUCTIONS / ALL EDITABLE</div>${cards.join('')}`;
}
function renderParts(query) {
    let html = '', category = '';
    for (const [type, def] of Object.entries(catalog)) {
        if (!`${def.name} ${def.category} ${def.description}`.toLowerCase().includes(query)) {
            continue;
        }
        if (category !== def.category) {
            html += `<div class="library-kicker">${esc(def.category.toUpperCase())}</div>`;
            category = def.category;
        }
        html += `<button class="part-card" draggable="true" data-add="${type}" title="${esc(def.description)}"><span class="type-dot ${def.output}"></span><span><b>${esc(def.name)}</b><small>${esc(typeNames[def.output])} · click or drag into the graph</small></span></button>`;
    }
    return html || '<p class="muted">No matching components.</p>';
}
function renderSnapshots(query) {
    const list = snapshots.filter(s => s.title.toLowerCase().includes(query));
    if (!list.length) {
        return '<div class="library-kicker">SNAPSHOTS</div><p class="muted library-note">No snapshots yet. Press <b>Snapshot</b> above the canvas (or the S key) to bookmark the current state before trying a variation. Snapshots stay in this browser.</p>';
    }
    return `<div class="library-kicker">${list.length} SNAPSHOTS · THIS BROWSER</div>` + list.map(s => `<div class="scene-card snapshot-card" data-snapshot="${s.id}" role="button" tabindex="0" title="Restore this state"><img src="${s.thumb}" alt=""><span><span class="scene-name">${esc(s.title)}</span><small>t = ${s.time.toFixed(2)} s · ${esc(relativeTime(s.savedAt))}</small></span><button class="snapshot-remove" data-remove-snapshot="${s.id}" title="Delete snapshot" aria-label="Delete snapshot ${esc(s.title)}">×</button></div>`).join('') + '<button class="library-clear" data-clear-snapshots>Clear all snapshots</button>';
}
export function renderLibrary() {
    const query = $('librarySearch').value.toLowerCase();
    document.querySelectorAll('[data-library]').forEach(b => b.classList.toggle('active', b.dataset.library === tab));
    $('libraryContent').innerHTML = tab === 'scenes' ? renderScenes(query) : tab === 'parts' ? renderParts(query) : renderSnapshots(query);
}
function saveSnapshots() {
    if (!writeStorage(STORAGE.snapshots, JSON.stringify(snapshots))) {
        toast('Browser storage is unavailable; snapshots last only for this page.', true);
    }
}
/** Bookmark the current project, playhead and a thumbnail of the canvas. */
export function takeSnapshot(title = state.project.title) {
    try {
        snapshots = addSnapshot(snapshots, { project: state.project, time: state.time, thumb: thumbnailFrom($('artCanvas')), title });
        saveSnapshots();
        if (tab === 'snapshots') {
            renderLibrary();
        }
        toast(`Snapshot saved (${snapshots.length}). Open the Snapshots tab to return to it.`);
        return snapshots[0];
    }
    catch (e) {
        showError(e);
        return null;
    }
}
export function getSnapshots() {
    return snapshots;
}
function restoreSnapshot(id) {
    const s = snapshots.find(v => v.id === id);
    if (!s) {
        return;
    }
    try {
        loadProject(s.project);
        seek(s.time);
        $('library').classList.remove('open');
        toast('Snapshot restored. Undo returns to the previous state.');
    }
    catch (e) {
        showError(e);
    }
}
$('libraryContent').addEventListener('click', e => {
    const preset = e.target.closest('[data-preset]'), part = e.target.closest('[data-add]'), remove = e.target.closest('[data-remove-snapshot]'), snapshot = e.target.closest('[data-snapshot]');
    if (preset) {
        loadProject(getPreset(preset.dataset.preset));
        $('library').classList.remove('open');
    }
    else if (part) {
        try {
            addComponent(part.dataset.add);
        }
        catch (err) {
            showError(err);
        }
    }
    else if (remove) {
        snapshots = removeSnapshot(snapshots, remove.dataset.removeSnapshot);
        saveSnapshots();
        renderLibrary();
    }
    else if (e.target.closest('[data-clear-snapshots]')) {
        snapshots = [];
        saveSnapshots();
        renderLibrary();
    }
    else if (snapshot) {
        restoreSnapshot(snapshot.dataset.snapshot);
    }
});
$('libraryContent').addEventListener('keydown', e => {
    const snapshot = e.target.closest?.('[data-snapshot]');
    if (snapshot && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        restoreSnapshot(snapshot.dataset.snapshot);
    }
});
$('libraryContent').addEventListener('dragstart', e => {
    const part = e.target.closest?.('[data-add]');
    if (!part) {
        return;
    }
    dragged = part.dataset.add;
    e.dataTransfer.setData(DRAG_TYPE, dragged);
    e.dataTransfer.setData('text/plain', dragged);
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging-component');
});
$('libraryContent').addEventListener('dragend', () => {
    dragged = null;
    document.body.classList.remove('dragging-component');
});
$('librarySearch').oninput = renderLibrary;
document.querySelectorAll('[data-library]').forEach(b => b.onclick = () => showLibraryTab(b.dataset.library));
$('mobileLibrary').onclick = () => $('library').classList.toggle('open');
$('snapshotButton').onclick = () => takeSnapshot();
on('refresh', renderLibrary);
