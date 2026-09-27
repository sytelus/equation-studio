import { $, esc, state, on, toast, showError, loadProject, addComponent, addWorkComponent, seek, readStorage, writeStorage, STORAGE, setPref } from './editor.js';
import { aspectOf, makeNode } from './graph.js';
import { subgraph } from './compiler.js';
import { works, getWork, creditLine } from './works.js';
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
 *
 * Scenes are a gallery that scales: filters by kind (shader code, point clouds,
 * constructions, studies) and by artist, a search over titles, authors, tags
 * and descriptions, and cards whose saved thumbnail comes alive on hover (the
 * scene rendered live, small, from its equations). The palette starts with the
 * components of the works, so any animation can be reused in another scene.
 */
export const DRAG_TYPE = 'application/x-equation-studio-component';
let tab = 'scenes', dragged = null;
/** Gallery filters: kind ('all', 'code', 'points', 'construction', 'study') and artist handle ('' for any). */
const gallery = { kind: 'all', artist: '' };
const KINDS = [['all', 'All'], ['code', 'Shader code'], ['points', 'Point clouds'], ['construction', 'Constructions'], ['study', 'Studies']];
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
    stopLive();
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
/** What kind of scene a preset is, for the gallery's filters and sections. */
function kindOf(p) {
    const w = p.work && getWork(p.work);
    if (!w) {
        return 'construction';
    }
    return w.platform === 'study' ? 'study' : w.platform === 'p5' ? 'points' : 'code';
}
const SECTIONS = { code: 'Animations · shader code (twigl)', points: 'Animations · point clouds (p5.js)', study: 'Studies', construction: 'Constructions from equations' };
function sceneCard(p) {
    const w = p.work && getWork(p.work), kind = kindOf(p);
    const meta = w ? `${esc(w.author)} · ${p.duration} s loop` : esc(p.status);
    const tip = `${esc(p.title)}${w ? ` · ${esc(creditLine(w))}` : ` · ${esc(p.status)}`}|${esc(w ? w.summary : p.description)}
Hover to see it move; click to open it. The thumbnail is a saved picture, the moving preview is rendered live.`;
    return `<button class="gallery-card ${state.project.id === p.id ? 'active' : ''}" data-preset="${p.id}" data-kind="${kind}" data-tip="${tip}"><span class="gallery-thumb"><img src="${thumbnails[p.id] || ''}" alt="" loading="lazy"><canvas class="gallery-live" hidden aria-hidden="true"></canvas>${w ? '<span class="gallery-play" aria-hidden="true">▶</span>' : ''}</span><span class="gallery-name">${esc(p.title)}</span><small>${meta}</small></button>`;
}
function renderScenes(query) {
    const artists = [...new Map(works.map(w => [w.handle, w.author])).entries()];
    const text = p => {
        const w = p.work && getWork(p.work);
        return `${p.title} ${p.status} ${p.description} ${w ? `${w.author} ${w.handle} ${w.tags.join(' ')} ${w.summary}` : ''}`.toLowerCase();
    };
    const shown = presets.filter(p => text(p).includes(query) && (gallery.kind === 'all' || kindOf(p) === gallery.kind) && (!gallery.artist || getWork(p.work)?.handle === gallery.artist));
    const chips = KINDS.map(([id, label]) => `<button class="chip ${gallery.kind === id ? 'active' : ''}" data-gallery-kind="${id}" aria-pressed="${gallery.kind === id}">${label}</button>`).join('');
    const artist = `<select id="galleryArtist" aria-label="Artist" data-tip="Artist|Show only the works of one artist."><option value="">Any artist</option>${artists.map(([handle, name]) => `<option value="${esc(handle)}" ${gallery.artist === handle ? 'selected' : ''}>${esc(name)} (@${esc(handle)})</option>`).join('')}</select>`;
    let body = '';
    for (const kind of ['code', 'points', 'study', 'construction']) {
        const list = shown.filter(p => kindOf(p) === kind);
        if (list.length) {
            body += `<div class="library-kicker">${esc(SECTIONS[kind].toUpperCase())} · ${list.length}</div><div class="gallery-grid">${list.map(sceneCard).join('')}</div>`;
        }
    }
    return `<div class="gallery-filters" role="group" aria-label="Filter scenes">${chips}${artist}</div>${body || '<p class="muted library-note">No scene matches. Clear the search or choose All.</p>'}`;
}
// ---- Live previews of gallery cards ------------------------------------------------
let live = null;
/** Animate a card's preview: the scene rendered small and live, while hovered. */
function startLive(card) {
    stopLive();
    const renderer = state.renderer;
    if (!renderer || state.busy) {
        return;
    }
    const project = getPreset(card.dataset.preset), canvas = card.querySelector('.gallery-live'), start = performance.now();
    canvas.width = 200;
    canvas.height = Math.min(240, Math.max(8, Math.round(200 / aspectOf(project))));
    live = { card, project, canvas, busy: false, frame: 0, start };
    card.classList.add('loading');
    const step = () => {
        if (!live || live.card !== card) {
            return;
        }
        live.frame = requestAnimationFrame(step);
        const entry = renderer.programFor(project, {});
        if (entry.status === 'failed') {
            stopLive();
            return;
        }
        if (entry.status !== 'ready' || live.busy) {
            return; // compiling in the background, or the last frame is still on its way
        }
        live.busy = true;
        const t = ((performance.now() - start) / 1000) % project.duration;
        renderer.timeAtlas(project, [t], canvas.width, canvas.height, { target: project.output }).then(([img]) => {
            if (live?.card !== card) {
                return;
            }
            live.busy = false;
            canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
            canvas.hidden = false;
            card.classList.remove('loading');
        }, () => stopLive());
    };
    live.frame = requestAnimationFrame(step);
}
function stopLive() {
    if (!live) {
        return;
    }
    cancelAnimationFrame(live.frame);
    live.canvas.hidden = true;
    live.card.classList.remove('loading');
    live = null;
}
let hoverTimer = null;
$('libraryContent').addEventListener('pointerover', e => {
    const card = e.target.closest('.gallery-card');
    if (!card || live?.card === card) {
        return;
    }
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => startLive(card), 300);
});
$('libraryContent').addEventListener('pointerout', e => {
    const card = e.target.closest('.gallery-card');
    if (card && !card.contains(e.relatedTarget)) {
        clearTimeout(hoverTimer);
        if (live?.card === card) {
            stopLive();
        }
    }
});
$('libraryContent').addEventListener('focusin', e => {
    const card = e.target.closest?.('.gallery-card');
    if (card) {
        startLive(card);
    }
});
$('libraryContent').addEventListener('focusout', () => stopLive());
$('libraryContent').addEventListener('change', e => {
    if (e.target.id === 'galleryArtist') {
        gallery.artist = e.target.value;
        renderLibrary();
    }
});
function renderParts(query) {
    let html = '', category = '';
    const fromWorks = works.filter(w => `${w.title} ${w.author} ${w.handle} ${w.tags.join(' ')} shader code point cloud`.toLowerCase().includes(query));
    if (fromWorks.length) {
        html += '<div class="library-kicker">FROM THE WORKS · REUSE ANY ANIMATION</div>';
        html += fromWorks.map(w => `<button class="part-card work-part" data-add-work="${w.id}" data-tip="${esc(w.title)} · ${esc(creditLine(w))}|Adds this work’s ${w.platform === 'p5' ? 'point cloud' : 'shader code'} to the current scene as a color layer, credited to its author. Combine it with Add light or Front over back; ❄ Freeze here (in its Time section) makes it a still."><img src="${thumbnails[w.id] || ''}" alt="" loading="lazy"><span><b>${esc(w.title)}</b><small>${w.platform === 'p5' ? 'Point cloud' : 'Shader code'} · ${esc(w.author)}</small></span></button>`).join('');
    }
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
    stopLive();
    $('library').classList.toggle('gallery', tab === 'scenes');
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
    const kind = e.target.closest('[data-gallery-kind]'), workPart = e.target.closest('[data-add-work]');
    if (kind) {
        gallery.kind = kind.dataset.galleryKind;
        renderLibrary();
        return;
    }
    if (workPart) {
        try {
            addWorkComponent(workPart.dataset.addWork);
            closeLibrary();
        }
        catch (err) {
            showError(err);
        }
        return;
    }
    if (preset) {
        stopLive();
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
// ---- Component previews in the palette's tips ------------------------------------------
const palettePreviews = new Map();
/** A tiny scene that shows one component with default inputs: coordinates, a
 * noise field, a nebula shell and a colored layer feed its sockets by type. */
function previewProject(type) {
    const inputs = { coord: 'space', scalar: 'field', geometry: 'shell', layer: 'colors' };
    const nodes = [makeNode('coordinates', 'space'), makeNode('noise', 'field', { p: 'space' }), makeNode('nebulaGeometry', 'shell', { p: 'space' }), makeNode('palette', 'colors', { field: 'field' })];
    nodes.push(makeNode(type, 'candidate', Object.fromEntries(Object.entries(catalog[type].inputs).map(([socket, kind]) => [socket, inputs[kind]]))));
    return { schemaVersion: 1, title: 'Preview', nodes, output: 'candidate', duration: 8, exposure: 1, tone: 'filmic', view: { x: 0, y: 0, zoom: 1 }, tracks: [] };
}
/** Render (once) and paint a component's preview into the tip's canvas. */
function paintPalettePreview(type) {
    const paint = img => document.querySelectorAll(`canvas[data-palette-preview="${type}"]`).forEach(c => {
        c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
        c.classList.add('painted');
    });
    const cached = palettePreviews.get(type);
    if (cached && cached !== 'pending') {
        paint(cached);
        return;
    }
    const renderer = state.renderer;
    if (cached === 'pending' || !renderer || state.busy) {
        return;
    }
    palettePreviews.set(type, 'pending');
    const project = previewProject(type), started = performance.now();
    const attempt = () => {
        const entry = renderer.programFor(project, { subset: subgraph(project, 'candidate') }); // the program timeAtlas will use
        if (entry.status === 'failed') {
            palettePreviews.delete(type);
            return;
        }
        if (entry.status !== 'ready') {
            if (performance.now() - started < 20000) {
                setTimeout(attempt, 120);
            }
            else {
                palettePreviews.delete(type);
            }
            return;
        }
        renderer.timeAtlas(project, [1.2], 160, 96, { target: 'candidate', subgraph: true }).then(([img]) => {
            palettePreviews.set(type, img);
            paint(img);
        }, () => palettePreviews.delete(type));
    };
    attempt();
}
/** Palette tips: description, the typeset equation and how to add the component. */
registerTipProvider('[data-add]', el => {
    const def = catalog[el.dataset.add];
    let equation = '';
    try {
        equation = def.tex.map(line => texToMathML(line)).join('');
    }
    catch (e) { /* plain-text fallback below */
    }
    requestAnimationFrame(() => paintPalettePreview(el.dataset.add));
    return `<b>${esc(def.name)}</b><span class="tip-state">${esc(typeNames[def.output])}</span><canvas class="tip-preview" data-palette-preview="${el.dataset.add}" width="160" height="96" aria-hidden="true"></canvas><p>${esc(def.description)}</p><div class="tip-math">${equation || esc(def.equation)}</div><p class="muted">The picture shows it on its own, fed with default inputs. Click to add it, or drag it onto the graph, a card or a matching input dot.</p>`;
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
