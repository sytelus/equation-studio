import { $, esc, state, on, toast, showError, loadProject, addComponent, seek, readStorage, writeStorage, STORAGE, setPref } from './editor.js';
import { catalog, typeNames, typeLabels } from './catalog.js';
import { texToMathML } from './math-render.js';
import { registerTipProvider } from './ui-tooltip.js';
import { presets, getPreset } from './presets.js';
import { thumbnails } from './thumbnails.js';
import { parseSnapshots, addSnapshot, removeSnapshot, thumbnailFrom, relativeTime } from './snapshots.js';
/** The library: scene presets, the component palette (click or drag to add) and
 * session snapshots. It is a drawer over the left of the window, opened with
 * ☰ Scenes (or ＋ Component) and closed after a choice; Dock keeps it open as a
 * column of the layout instead (remembered).
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
export function libraryOpen() {
    return $('library').classList.contains('open');
}
/** Open the drawer (a no-op when docked), optionally on a tab. */
export function openLibrary(next = null) {
    if (next) {
        showLibraryTab(next);
    }
    $('library').classList.add('open');
    $('libraryButton').setAttribute('aria-expanded', 'true');
    if (!state.prefs.libraryDocked) {
        $('librarySearch').focus({ preventScroll: true });
    }
}
export function closeLibrary() {
    if (state.prefs.libraryDocked) {
        return;
    }
    $('library').classList.remove('open');
    $('libraryButton').setAttribute('aria-expanded', 'false');
}
function applyDock() {
    const docked = state.prefs.libraryDocked;
    $('app').classList.toggle('library-docked', docked);
    $('library').classList.toggle('open', docked); // undocking puts it away as a closed drawer
    $('libraryButton').setAttribute('aria-expanded', String(docked));
    $('libraryDock').textContent = docked ? '⇤ Undock' : '⇥ Dock';
    $('libraryDock').setAttribute('aria-pressed', String(docked));
    $('libraryClose').hidden = docked;
}
function renderScenes(query) {
    const cards = presets.filter(p => `${p.title} ${p.status}`.toLowerCase().includes(query)).map(p => `<button class="scene-card ${state.project.id === p.id ? 'active' : ''}" data-preset="${p.id}" data-tip="${esc(p.title)} · ${esc(p.status)}|${esc(p.description)}
The thumbnail is a small saved picture; opening the scene renders it live from its equations."><img src="${thumbnails[p.id] || ''}" alt="${esc(p.title)} procedural preview"><span><span class="scene-name">${esc(p.title)}</span><small>${esc(p.status)}</small></span></button>`);
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
        html += `<button class="part-card" draggable="true" data-add="${type}" data-rich-tip><span class="type-dot ${def.output}"></span><span><b>${esc(def.name)}</b><small>${esc(typeLabels[def.output])} · ${esc(def.description.split('. ')[0])}</small></span></button>`;
    }
    return html || '<p class="muted">No matching components.</p>';
}
function renderSnapshots(query) {
    const list = snapshots.filter(s => s.title.toLowerCase().includes(query));
    if (!list.length) {
        return '<div class="library-kicker">SNAPSHOTS</div><p class="muted library-note">No snapshots yet. Press <b>Snapshot</b> above the canvas (or the S key) to bookmark the current state before trying a variation. Snapshots stay in this browser.</p>';
    }
    return `<div class="library-kicker">${list.length} SNAPSHOTS · THIS BROWSER</div>` + list.map(s => `<div class="scene-card snapshot-card" data-snapshot="${s.id}" role="button" tabindex="0" data-tip="Restore this snapshot|Returns the project and playhead to this bookmark. Undo takes you back."><img src="${s.thumb}" alt=""><span><span class="scene-name">${esc(s.title)}</span><small>t = ${s.time.toFixed(2)} s · ${esc(relativeTime(s.savedAt))}</small></span><button class="snapshot-remove" data-remove-snapshot="${s.id}" data-tip="Delete this snapshot" aria-label="Delete snapshot ${esc(s.title)}">×</button></div>`).join('') + '<button class="library-clear" data-clear-snapshots>Clear all snapshots</button>';
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
        // A snapshot of the scene being edited keeps that scene's original for Revert and reset.
        loadProject(s.project, { keepBaseline: s.project.id === state.baseline.id });
        seek(s.time);
        closeLibrary();
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
        closeLibrary();
    }
    else if (part) {
        try {
            addComponent(part.dataset.add);
            closeLibrary();
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
$('libraryContent').addEventListener('dragend', e => {
    dragged = null;
    document.body.classList.remove('dragging-component');
    if (e.dataTransfer.dropEffect !== 'none') {
        closeLibrary(); // dropped onto the graph, a card or the canvas
    }
});
/** Palette tips: description, the typeset equation and how to add the component. */
registerTipProvider('[data-add]', el => {
    const def = catalog[el.dataset.add];
    let equation = '';
    try {
        equation = def.tex.map(line => texToMathML(line)).join('');
    }
    catch (e) { /* plain-text fallback below */
    }
    return `<b>${esc(def.name)}</b><span class="tip-state">${esc(typeNames[def.output])}</span><p>${esc(def.description)}</p><div class="tip-math">${equation || esc(def.equation)}</div><p class="muted">Click to add it, or drag it onto the graph, a card or a matching input dot.</p>`;
});
$('librarySearch').oninput = renderLibrary;
/** The library only changes with the scene (active preset highlight). */
let libraryScene = null;
function refreshLibrary() {
    const key = `${state.project.id}|${state.project.status}`;
    if (key !== libraryScene) {
        libraryScene = key;
        renderLibrary();
    }
}
document.querySelectorAll('[data-library]').forEach(b => b.onclick = () => showLibraryTab(b.dataset.library));
$('libraryButton').onclick = () => libraryOpen() && !state.prefs.libraryDocked ? closeLibrary() : openLibrary(state.prefs.libraryDocked ? 'scenes' : null);
$('libraryClose').onclick = closeLibrary;
$('libraryDock').onclick = () => {
    setPref('libraryDocked', !state.prefs.libraryDocked);
    applyDock();
};
// A click outside the open drawer closes it.
document.addEventListener('pointerdown', e => {
    if (libraryOpen() && !state.prefs.libraryDocked && !e.target.closest('#library, #libraryButton, #addComponent')) {
        closeLibrary();
    }
}, true);
$('snapshotButton').onclick = () => takeSnapshot();
on('refresh', refreshLibrary);
applyDock();
