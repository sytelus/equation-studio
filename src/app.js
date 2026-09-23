import { Renderer } from './renderer.js';
import { catalog, typeNames } from './catalog.js';
import { clone, makeNode, validateProject, parseProject, uniqueId, removeNode, History } from './graph.js';
import { presets, getPreset } from './presets.js';
import { animatedParameters, insertKey, loopTime } from './timeline.js';
import { compileGraph } from './compiler.js';
import { sources, methodNotes } from './research.js';
import { makeZip, download, fileStem, frameTimes, embedPNGMetadata } from './export.js';
import { thumbnails } from './thumbnails.js';
/** UI state never enters shader source. Numeric values remain uniforms. Projects
 * are validated JSON and are the single persistent source of truth. The editor
 * adds only transient selection, playback, dialog and reference-image state.
 */
const $ = id => document.getElementById(id), app = $('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const history = new History();
let project = getPreset('bipolar'), selected = 'shell', isolated = null, time = 0, playing = false, dirty = true, busy = false, connection = null;
let rawProbeArmed = false;
let libraryTab = 'scenes', bottomTab = 'graph', renderer = null, compiled = null, toastTimer, saveTimer, referenceURL = null, abortExport = false;
let recording = null, gesture = null, frameStamp = 0, frames = 0, lastFPS = performance.now(), fps = 0, lastCompilation = null;
const storageKey = 'equation-studio.project.v1';
try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
        project = parseProject(saved);
        selected = project.nodes.find(n => n.id !== 'space')?.id || project.nodes[0].id;
    }
}
catch (e) { /* Storage is optional (private mode / opaque origins). Never block rendering. */
}
try {
    renderer = new Renderer($('artCanvas'));
    renderer.onLost = () => {
        pause();
        showError('GPU context lost. The browser may restore it; save your project before reloading.');
    };
    renderer.onRestored = () => {
        dirty = true;
        toast('GPU context restored.');
    };
    $('gpuLabel').textContent = `WEBGL 2 · highp: ${renderer.info.precisionBits} precision bits · ${renderer.info.renderer}`;
    $('gpuLabel').title = JSON.stringify(renderer.info, null, 2);
}
catch (e) {
    $('gpuFailure').hidden = false;
    $('gpuFailure').textContent = e.message;
    $('gpuLabel').textContent = 'WEBGL 2 UNAVAILABLE';
}
function toast(message, error = false) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').className = error ? 'error' : '';
    $('toast').hidden = false;
    toastTimer = setTimeout(() => $('toast').hidden = true, error ? 8500 : 4200);
}
function showError(error) {
    toast(error instanceof Error ? error.message : String(error), true);
}
function persist() {
    clearTimeout(saveTimer);
    $('saveStatus').textContent = 'Unsaved changes';
    saveTimer = setTimeout(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(project));
            $('saveStatus').textContent = 'Saved in this browser · no uploads';
        }
        catch (e) {
            $('saveStatus').textContent = 'Use Save project · browser storage unavailable';
        }
    }, 300);
}
function pause() {
    playing = false;
    $('play').textContent = '▶';
    $('play').setAttribute('aria-label', 'Play animation');
}
function changed() {
    dirty = true;
    persist();
    $('undo').disabled = !history.past.length;
    $('redo').disabled = !history.future.length;
}
function transact(edit, { refresh = true } = {}) {
    if (busy) {
        return false;
    }
    try {
        const next = clone(project);
        edit(next);
        validateProject(next);
        history.push(project);
        project = next;
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
function loadProject(next, fromHistory = false) {
    validateProject(next);
    pause();
    if (!fromHistory) {
        history.push(project);
    }
    project = clone(next);
    time = 0;
    isolated = null;
    connection = null;
    selected = project.nodes.find(n => n.id !== 'space')?.id || project.nodes[0].id;
    changed();
    refreshUI();
}
function currentNode() {
    return project.nodes.find(n => n.id === selected) || project.nodes[0];
}
function setSelected(id) {
    selected = id;
    connection = null;
    renderInspector();
    renderGraph();
    renderTracks();
}
function setIsolated(id) {
    isolated = id;
    dirty = true;
    renderInspector();
    renderGraph();
    refreshViewLabel();
}
function refreshViewLabel() {
    const n = project.nodes.find(n => n.id === (isolated || project.output));
    $('viewLabel').textContent = isolated ? `FIELD / ${n?.label || isolated}` : 'COMPOSITE';
    $('previewBadge').hidden = !isolated;
    $('clearPreview').hidden = !isolated;
    $('sceneStatus').textContent = project.status || 'Custom construction';
    $('sceneStatus').classList.toggle('study', project.status === 'Interpretive study');
}
function refreshUI() {
    $('projectTitle').value = project.title;
    $('duration').value = project.duration;
    $('scrubber').max = project.duration;
    $('outputTone').value = project.tone;
    $('exposure').value = project.exposure;
    $('counts').textContent = `${project.nodes.length} components · ${project.tracks.length} tracks`;
    if (!project.nodes.some(n => n.id === selected)) {
        selected = project.nodes[0].id;
    }
    if (isolated && !project.nodes.some(n => n.id === isolated)) {
        isolated = null;
    }
    time = clamp(time, 0, project.duration);
    refreshViewLabel();
    renderLibrary();
    renderInspector();
    renderGraph();
    renderTracks();
    updateClock();
    resizeImage();
}
function updateClock() {
    const v = time.toFixed(3).padStart(6, '0');
    $('clock').textContent = v;
    $('scrubber').value = time;
    document.querySelectorAll('.track-playhead').forEach(el => el.style.left = `${time / project.duration * 100}%`);
}
function renderLibrary() {
    const q = $('librarySearch').value.toLowerCase();
    document.querySelectorAll('[data-library]').forEach(b => b.classList.toggle('active', b.dataset.library === libraryTab));
    if (libraryTab === 'scenes') {
        $('libraryContent').innerHTML = '<div class="library-kicker">12 CONSTRUCTIONS / ALL EDITABLE</div>' + presets.filter(p => (p.title + ' ' + p.status).toLowerCase().includes(q)).map(p => `<button class="scene-card ${project.id === p.id ? 'active' : ''}" data-preset="${p.id}" title="${esc(p.description)}"><img src="${thumbnails[p.id] || ''}" alt="${esc(p.title)} procedural preview"><span><span class="scene-name">${esc(p.title)}</span><small>${esc(p.status)}</small></span></button>`).join('');
    }
    else {
        let html = '', last = '';
        for (const [type, def] of Object.entries(catalog)) {
            if (!(def.name + ' ' + def.category + ' ' + def.description).toLowerCase().includes(q)) {
                continue;
            }
            if (last !== def.category) {
                html += `<div class="library-kicker">${esc(def.category.toUpperCase())}</div>`;
                last = def.category;
            }
            html += `<button class="part-card" data-add="${type}" title="${esc(def.description)}"><span class="type-dot ${def.output}"></span><span><b>${esc(def.name)}</b><small>${esc(typeNames[def.output])} · add to graph</small></span></button>`;
        }
        $('libraryContent').innerHTML = html || '<p class="muted">No matching components.</p>';
    }
}
function addComponent(type) {
    let id;
    if (transact(p => {
        id = uniqueId(p, type);
        const inputs = {}, def = catalog[type], sel = p.nodes.find(n => n.id === selected);
        for (const [socket, kind] of Object.entries(def.inputs)) {
            const match = sel && catalog[sel.type].output === kind ? sel : p.nodes.find(n => catalog[n.type].output === kind);
            if (match) {
                inputs[socket] = match.id;
            }
        }
        p.nodes.push(makeNode(type, id, inputs));
        p.status = 'Custom construction';
        p.id = 'custom';
    }, { refresh: false })) {
        selected = id;
        isolated = id;
        refreshUI();
        toast('Component added and isolated. Wire it downstream, then choose Set as output.');
    }
}
function renderInspector() {
    const n = currentNode(), def = catalog[n.type], evaluated = animatedParameters(project, n, time), hasTracks = project.tracks.some(t => t.node === n.id && t.keys.length);
    $('nodeTypeBadge').textContent = typeNames[def.output];
    let html = `<input class="node-title" id="nodeLabel" value="${esc(n.label)}" aria-label="Component label" maxlength="160"><p class="node-caption">${esc(def.description)}</p><div class="equation-box">${esc(def.equation)}</div><div class="mini-actions"><button id="isolateNode" class="${isolated === n.id ? 'active' : ''}">${isolated === n.id ? 'Viewing isolated' : 'Isolate'}</button><button id="makeOutput">${project.output === n.id ? '✓ Output' : 'Set as output'}</button><button id="toggleNode">${n.enabled ? 'Disable' : 'Enable'}</button><button id="sampleField" title="Read raw field values before tone mapping">Probe value</button></div>`;
    const entries = Object.entries(def.inputs);
    if (entries.length) {
        html += '<div class="inspector-section">INPUT CONNECTIONS</div>';
        for (const [socket, kind] of entries) {
            html += `<div class="input-row"><label for="in-${socket}"><span class="type-dot ${kind}"></span>${esc(socket)}</label><select id="in-${socket}" data-input="${socket}" aria-label="${esc(socket)} input"><option value="">Unconnected · zero</option>${project.nodes.filter(other => other.id !== n.id && catalog[other.type].output === kind).map(other => `<option value="${other.id}" ${n.inputs[socket] === other.id ? 'selected' : ''}>${esc(other.label)} [${other.id}]</option>`).join('')}</select></div>`;
        }
    }
    if (Object.keys(def.params).length) {
        html += '<div class="inspector-section">PARAMETERS <span>◆ ADD KEY</span></div>';
    }
    if (hasTracks) {
        html += '<div class="selection-note">Tracked controls show the value at the playhead. Adjusting one adds a key here. Untracked controls change the base value.</div>';
    }
    for (const [key, s] of Object.entries(def.params)) {
        const value = evaluated[key], track = project.tracks.find(t => t.node === n.id && t.param === key);
        if (s.kind === 'number') {
            html += `<div class="param"><div class="param-head"><label for="param-${key}">${esc(s.label)}</label><input type="number" data-param="${key}" id="number-${key}" value="${Number(value.toFixed(5))}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${esc(s.label)} numerical value"><button class="key ${track?.keys.length ? 'keyed' : ''}" data-key="${key}" title="Add or replace a key at ${time.toFixed(3)} s" aria-label="Keyframe ${esc(s.label)}">◆</button></div><input type="range" id="param-${key}" data-param="${key}" value="${value}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${esc(s.label)}">${s.help ? `<small>${esc(s.help)}</small>` : ''}</div>`;
        }
        else if (s.kind === 'color') {
            html += `<div class="param"><div class="param-head"><label>${esc(s.label)}</label><input type="color" value="${value}" data-param="${key}" aria-label="${esc(s.label)}"><span class="muted">${esc(value)}</span></div></div>`;
        }
        else {
            html += `<textarea id="equationEditor" class="expression-input" spellcheck="false" aria-label="Custom GLSL expression">${esc(n.params[key])}</textarea><button id="applyEquation" class="primary">Apply equation</button><p class="node-caption">${esc(s.help)} Use decimal literals: <code>2.0</code>, not <code>2</code>.</p><pre id="equationError" class="code-error"></pre>`;
        }
    }
    const tracks = project.tracks.filter(t => t.node === n.id);
    if (tracks.length) {
        html += '<div class="inspector-section">ANIMATION TRACKS</div>';
        for (const t of tracks) {
            html += `<div class="track-edit"><header><b>${esc(t.param)}</b><select data-interpolation="${t.param}" aria-label="Interpolation for ${t.param}">${['smooth', 'linear', 'hold'].map(v => `<option ${v === t.interpolation ? 'selected' : ''}>${v}</option>`).join('')}</select><button data-remove-track="${t.param}" title="Remove track; use base value" aria-label="Remove ${t.param} animation track">×</button></header><div class="key-list">${t.keys.map(k => `<button class="key-chip" data-seek="${k.time}" title="Seek to this key">${k.time}s: ${Number(k.value.toFixed(3))}<span data-remove-key="${t.param}" data-time="${k.time}" title="Delete this key">×</span></button>`).join('')}</div></div>`;
        }
    }
    html += `<div class="node-bottom"><button id="duplicateNode">Duplicate</button><button id="deleteNode" class="danger">Delete component</button></div><p class="node-caption">ID: <code>${n.id}</code> · Type: <code>${n.type}</code><br>Output: ${esc(typeNames[def.output])}. Unconnected inputs evaluate to zero; they are not inferred dependencies.</p>`;
    $('inspectorContent').innerHTML = html;
    $('nodeLabel').onchange = e => transact(p => p.nodes.find(v => v.id === n.id).label = e.target.value);
    $('isolateNode').onclick = () => setIsolated(isolated === n.id ? null : n.id);
    $('makeOutput').onclick = () => {
        isolated = null;
        transact(p => p.output = n.id);
    };
    $('toggleNode').onclick = () => transact(p => p.nodes.find(v => v.id === n.id).enabled = !n.enabled);
    $('sampleField').onclick = () => {
        rawProbeArmed = true;
        toast('Click a point on the artwork to read this component’s raw field value. Alt-click also probes.');
    };
    $('duplicateNode').onclick = () => {
        let id;
        transact(p => {
            id = uniqueId(p, n.type);
            const copy = clone(n);
            copy.id = id;
            copy.label += ' copy';
            p.nodes.push(copy);
        });
        setSelected(id);
    };
    $('deleteNode').onclick = () => transact(p => removeNode(p, n.id));
    document.querySelectorAll('[data-input]').forEach(input => input.onchange = e => connect(e.target.value, n.id, input.dataset.input));
    document.querySelectorAll('[data-param]').forEach(input => {
        input.oninput = e => {
            if (busy) {
                return;
            }
            pause();
            const key = input.dataset.param, s = def.params[key], value = s.kind === 'color' ? input.value : Number(input.value);
            if (s.kind === 'number' && (input.value === '' || !Number.isFinite(value))) {
                return;
            }
            if (!input._before) {
                input._before = clone(project);
            }
            const v = s.kind === 'number' ? clamp(value, s.min, s.max) : value, nn = project.nodes.find(v => v.id === n.id);
            nn.params[key] = v;
            if (project.tracks.some(t => t.node === n.id && t.param === key && t.keys.length)) {
                insertKey(project, n.id, key, time, v);
            }
            document.querySelectorAll(`[data-param="${key}"]`).forEach(el => {
                if (el !== input) {
                    el.value = v;
                }
            });
            dirty = true;
        };
        input.onchange = () => {
            if (input._before) {
                history.push(input._before);
                delete input._before;
                changed();
                renderTracks();
                renderInspector();
            }
        };
    });
    document.querySelectorAll('[data-key]').forEach(button => button.onclick = () => {
        pause();
        const key = button.dataset.key;
        transact(p => {
            const value = animatedParameters(p, p.nodes.find(v => v.id === n.id), time)[key];
            insertKey(p, n.id, key, time, value);
        });
        toast(`Key added at ${time.toFixed(3)} s. Move the playhead, then change the control to add another.`);
    });
    document.querySelectorAll('[data-interpolation]').forEach(el => el.onchange = () => transact(p => p.tracks.find(t => t.node === n.id && t.param === el.dataset.interpolation).interpolation = el.value));
    document.querySelectorAll('[data-remove-track]').forEach(el => el.onclick = () => transact(p => p.tracks = p.tracks.filter(t => !(t.node === n.id && t.param === el.dataset.removeTrack))));
    document.querySelectorAll('[data-remove-key]').forEach(el => el.onclick = e => {
        e.stopPropagation();
        transact(p => {
            const t = p.tracks.find(t => t.node === n.id && t.param === el.dataset.removeKey);
            t.keys = t.keys.filter(k => k.time !== Number(el.dataset.time));
        });
    });
    document.querySelectorAll('[data-seek]').forEach(el => el.onclick = () => seek(Number(el.dataset.seek)));
    if ($('applyEquation')) {
        $('applyEquation').onclick = () => {
            const next = clone(project);
            next.nodes.find(v => v.id === n.id).params.expression = $('equationEditor').value;
            try {
                validateProject(next);
                if (renderer) {
                    renderer.getProgram(next, n.id);
                }
                else {
                    compileGraph(next, n.id);
                }
                history.push(project);
                project = next;
                changed();
                refreshUI();
                toast('Equation compiled.');
            }
            catch (e) {
                $('equationError').textContent = e.message;
                showError('Equation not applied. The last good image is unchanged.');
            }
        };
    }
}
function connect(source, target, socket) {
    connection = null;
    const ok = transact(p => {
        const n = p.nodes.find(v => v.id === target);
        if (source) {
            n.inputs[socket] = source;
        }
        else {
            delete n.inputs[socket];
        }
    });
    // Restore the input menu after a rejected cycle; DOM and model must agree.
    if (!ok) {
        renderInspector();
        renderGraph();
    }
}
function renderGraph() {
    const map = new Map(project.nodes.map(n => [n.id, n])), depths = new Map();
    function depth(id) {
        if (depths.has(id)) {
            return depths.get(id);
        }
        const inputs = Object.values(map.get(id).inputs).filter(Boolean), d = inputs.length ? 1 + Math.max(...inputs.map(depth)) : 0;
        depths.set(id, d);
        return d;
    }
    const columns = new Map(), positions = new Map();
    let maxHeight = 165, maxDepth = 0;
    for (const n of project.nodes) {
        const d = depth(n.id);
        maxDepth = Math.max(d, maxDepth);
        if (!columns.has(d)) {
            columns.set(d, []);
        }
        columns.get(d).push(n);
    }
    for (const [d, nodes] of columns) {
        let y = 18;
        for (const n of nodes) {
            const count = Object.keys(catalog[n.type].inputs).length, height = Math.max(78, 42 + count * 13);
            positions.set(n.id, { x: 24 + d * 225, y, height });
            y += height + 23;
        }
        maxHeight = Math.max(maxHeight, y + 10);
    }
    const width = 50 + (maxDepth + 1) * 225;
    $('graphBoard').style.width = `${width}px`;
    $('graphBoard').style.height = `${maxHeight}px`;
    $('graphEdges').setAttribute('width', width);
    $('graphEdges').setAttribute('height', maxHeight);
    let edges = '', nodes = '';
    const colors = { coord: '#7094b6', scalar: '#b4946d', layer: '#649b83', geometry: '#9a82b1' };
    for (const n of project.nodes) {
        const pos = positions.get(n.id), def = catalog[n.type], inputs = Object.entries(def.inputs);
        inputs.forEach(([socket, kind], i) => {
            const from = n.inputs[socket];
            if (!from) {
                return;
            }
            const start = positions.get(from), x1 = start.x + 176, y1 = start.y + 35, x2 = pos.x, y2 = pos.y + 35 + i * 13;
            edges += `<path d="M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}" fill="none" stroke="${colors[kind]}" stroke-width="1.5" opacity="${n.enabled ? .75 : .25}"/>`;
        });
        nodes += `<div class="graph-node ${selected === n.id ? 'selected' : ''} ${!n.enabled ? 'disabled' : ''}" data-node="${n.id}" style="left:${pos.x}px;top:${pos.y}px;height:${pos.height}px" tabindex="0" role="button" aria-label="Inspect ${esc(n.label)}"><b>${esc(n.label)}</b><small>${esc(def.category)} · ${esc(def.output)}</small><div class="node-sockets">${inputs.map(([socket]) => `<span class="in-label">${esc(socket)}</span>`).join('')}</div>${inputs.map(([socket, kind], i) => `<button class="socket input ${kind}" data-to="${n.id}" data-socket="${socket}" style="top:${29 + i * 13}px" title="${esc(socket)} · ${kind} input" aria-label="Connect to ${esc(n.label)} ${socket}"></button>`).join('')}<button class="socket output ${def.output} ${connection === n.id ? 'chosen' : ''}" data-from="${n.id}" title="${def.output} output · click to connect" aria-label="Connect output of ${esc(n.label)}"></button>${project.output === n.id ? '<span class="output-mark">OUTPUT</span>' : ''}</div>`;
    }
    $('graphEdges').innerHTML = edges;
    $('graphNodes').innerHTML = nodes;
    $('graphSummary').textContent = `${project.nodes.length} nodes / typed DAG`;
    $('connectionHint').textContent = connection ? `Connecting ${connection} (${catalog[map.get(connection).type].output}). Click a compatible input dot. Escape cancels.` : 'Select a component to inspect it. Connect an output dot to a compatible input dot, or use the inspector’s input menus.';
}
function renderTracks() {
    if (!project.tracks.length) {
        $('tracks').innerHTML = '<div class="empty-tracks">No keyframes yet. Click ◆ next to any numeric parameter. Procedural flow-speed controls also animate directly with time.</div>';
        return;
    }
    $('tracks').innerHTML = project.tracks.map(t => `<div class="track-row"><span class="track-label" data-select-track="${t.node}" title="Select ${esc(t.node)}">${esc(t.node)} / ${esc(t.param)}</span><div class="track-lane"><span class="track-playhead" style="left:${time / project.duration * 100}%"></span>${t.keys.map(k => `<button class="track-key" data-track-time="${k.time}" style="left:${k.time / project.duration * 100}%" title="${k.time}s: ${k.value}" aria-label="Seek ${t.param} key at ${k.time} seconds">◆</button>`).join('')}</div></div>`).join('');
}
function seek(t) {
    if (!Number.isFinite(t)) {
        throw new Error('Playhead time must be finite.');
    }
    pause();
    time = clamp(t, 0, project.duration);
    dirty = true;
    updateClock();
    renderInspector();
}
function resizeImage() {
    const stage = $('stage'), pad = innerWidth < 650 ? 24 : innerWidth < 1200 ? 36 : 56;
    const width = Math.max(10, Math.min(stage.clientWidth - pad, (stage.clientHeight - 42) * 5 / 3));
    $('imageWrap').style.width = `${width}px`;
}
function render() {
    if (!renderer) {
        return;
    }
    const width = Number($('quality').value), height = Math.round(width * .6);
    try {
        const start = performance.now();
        compiled = renderer.draw(project, time, width, height, isolated || project.output);
        if (renderer.current !== lastCompilation) {
            lastCompilation = renderer.current;
            $('shaderView').textContent = compiled.fragment;
        }
        const ms = performance.now() - start;
        $('renderStats').textContent = `${width} × ${height}${playing ? ` · ${fps.toFixed(0)} fps` : ` · ${ms.toFixed(1)} ms submit`}`;
        $('cornerLabel').textContent = isolated ? 'ISOLATED FIELD · DIAGNOSTIC VIEW' : 'LIVE EQUATIONS · NO IMAGE TEXTURES';
    }
    catch (e) {
        pause();
        showError(e);
        $('renderStats').textContent = 'Render error · last good image retained';
    }
}
function tick(now) {
    if (playing && !busy) {
        const dt = Math.min((now - frameStamp) / 1000, .25);
        time += dt;
        if (time >= project.duration) {
            if ($('loop').checked) {
                time = loopTime(time, project.duration);
            }
            else {
                time = project.duration;
                pause();
            }
        }
        dirty = true;
        updateClock();
    }
    if (dirty && !busy) {
        dirty = false;
        render();
        frames++;
    }
    if (now - lastFPS > 1000) {
        fps = frames * 1000 / (now - lastFPS);
        frames = 0;
        lastFPS = now;
    }
    frameStamp = now;
    requestAnimationFrame(tick);
}
// Toolbar, library, keyboard and graph interaction. All graph edits go through
// validation before replacing the previous model, so cycles never reach shaders.
$('libraryContent').onclick = e => {
    const preset = e.target.closest('[data-preset]'), part = e.target.closest('[data-add]');
    if (preset) {
        loadProject(getPreset(preset.dataset.preset));
        $('library').classList.remove('open');
    }
    if (part) {
        addComponent(part.dataset.add);
    }
};
$('librarySearch').oninput = renderLibrary;
document.querySelectorAll('[data-library]').forEach(b => b.onclick = () => {
    libraryTab = b.dataset.library;
    $('librarySearch').value = '';
    renderLibrary();
});
$('mobileLibrary').onclick = () => $('library').classList.toggle('open');
$('addComponent').onclick = () => {
    libraryTab = 'parts';
    $('librarySearch').value = '';
    renderLibrary();
    $('library').classList.add('open');
    $('librarySearch').focus();
};
$('graphFit').onclick = () => {
    $('graphViewport').scrollTo({ left: 0, top: 0, behavior: 'smooth' });
    renderGraph();
};
$('graphNodes').onclick = e => {
    const from = e.target.closest('[data-from]'), to = e.target.closest('[data-to]'), card = e.target.closest('[data-node]');
    if (from) {
        connection = connection === from.dataset.from ? null : from.dataset.from;
        renderGraph();
        return;
    }
    if (to) {
        if (connection) {
            connect(connection, to.dataset.to, to.dataset.socket);
        }
        else {
            toast('First click an output dot, then a compatible input.');
        }
        return;
    }
    if (card) {
        setSelected(card.dataset.node);
    }
};
$('graphNodes').onkeydown = e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.graph-node')) {
        e.preventDefault();
        setSelected(e.target.dataset.node);
    }
};
$('tracks').onclick = e => {
    const key = e.target.closest('[data-track-time]'), label = e.target.closest('[data-select-track]');
    if (key) {
        seek(Number(key.dataset.trackTime));
    }
    if (label) {
        setSelected(label.dataset.selectTrack);
    }
};
document.querySelectorAll('[data-bottom]').forEach(b => b.onclick = () => {
    bottomTab = b.dataset.bottom;
    document.querySelectorAll('[data-bottom]').forEach(v => v.classList.toggle('active', v === b));
    $('graphViewport').hidden = bottomTab !== 'graph';
    $('shaderView').hidden = bottomTab !== 'shader';
    $('copyShader').hidden = bottomTab !== 'shader';
    $('graphFit').hidden = bottomTab !== 'graph';
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
$('projectTitle').onchange = e => transact(p => p.title = e.target.value);
$('undo').onclick = () => {
    if (busy) {
        return;
    }
    const p = history.undo(project);
    if (p) {
        loadProject(p, true);
    }
};
$('redo').onclick = () => {
    if (busy) {
        return;
    }
    const p = history.redo(project);
    if (p) {
        loadProject(p, true);
    }
};
$('saveProject').onclick = () => {
    try {
        validateProject(project);
        download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), fileStem(project.title) + '.json');
        toast('Project JSON exported.');
    }
    catch (e) {
        showError(e);
    }
};
$('openProject').onclick = () => $('projectFile').click();
$('projectFile').onchange = async () => {
    const f = $('projectFile').files[0];
    if (!f) {
        return;
    }
    try {
        if (f.size > 1000000) {
            throw new Error('Project files are limited to 1 MB.');
        }
        loadProject(parseProject(await f.text()));
        toast('Project opened.');
    }
    catch (e) {
        showError(e);
    }
    finally {
        $('projectFile').value = '';
    }
};
$('play').onclick = () => {
    if (!renderer || busy) {
        return;
    }
    if (playing) {
        pause();
        renderInspector();
    }
    else {
        if (time >= project.duration) {
            time = 0;
        }
        playing = true;
        frameStamp = performance.now();
        $('play').textContent = 'Ⅱ';
        $('play').setAttribute('aria-label', 'Pause animation');
    }
};
$('rewind').onclick = () => seek(0);
$('scrubber').oninput = e => seek(Number(e.target.value));
$('duration').onchange = e => {
    const value = Number(e.target.value);
    transact(p => p.duration = value);
    $('duration').value = project.duration;
};
$('outputTone').onchange = e => transact(p => p.tone = e.target.value);
$('exposure').oninput = e => {
    if (!$('exposure')._before) {
        $('exposure')._before = clone(project);
    }
    project.exposure = Number(e.target.value);
    dirty = true;
};
$('exposure').onchange = () => {
    if ($('exposure')._before) {
        history.push($('exposure')._before);
        delete $('exposure')._before;
        changed();
    }
};
$('quality').onchange = () => dirty = true;
$('clearPreview').onclick = () => setIsolated(null);
$('resetView').onclick = () => transact(p => p.view = { x: 0, y: 0, zoom: 1 });
$('focusButton').onclick = () => {
    app.classList.toggle('focus-canvas');
    resizeImage();
};
new ResizeObserver(resizeImage).observe($('stage'));
const canvas = $('artCanvas');
canvas.onpointerdown = e => {
    if (busy || e.button !== 0) {
        return;
    }
    if (rawProbeArmed || e.altKey) {
        rawProbeArmed = false;
        const r = canvas.getBoundingClientRect(), px = Math.floor((e.clientX - r.left) / r.width * canvas.width) + .5, py = Math.floor((r.bottom - e.clientY) / r.height * canvas.height) + .5, unit = (2000 / 420) / (canvas.width * project.view.zoom), x = (px - canvas.width / 2) * unit + project.view.x + 1 / 840, y = (py - canvas.height / 2) * unit + project.view.y + 1 / 840;
        try {
            if (!renderer) {
                throw new Error('GPU unavailable.');
            }
            const values = renderer.samplePoint(project, time, selected, x, y), type = catalog[currentNode().type].output, names = { scalar: ['value'], coord: ['x', 'y'], geometry: ['S / warp', 'A / rim', 'coverage'], layer: ['R', 'G', 'B', 'alpha'] }[type];
            toast(`Raw ${currentNode().label} at (${x.toFixed(5)}, ${y.toFixed(5)})\n` + names.map((name, i) => `${name}: ${values[i].toPrecision(7)}`).join(' · '));
        }
        catch (e) {
            showError(e);
        }
        return;
    }
    canvas.setPointerCapture(e.pointerId);
    gesture = { startX: e.clientX, startY: e.clientY, view: { ...project.view }, before: clone(project) };
};
let probeStamp = 0;
canvas.onpointermove = e => {
    const r = canvas.getBoundingClientRect();
    if (gesture) {
        const unit = (2000 / 420) / (r.width * gesture.view.zoom);
        project.view.x = clamp(gesture.view.x - (e.clientX - gesture.startX) * unit, -20, 20);
        project.view.y = clamp(gesture.view.y + (e.clientY - gesture.startY) * unit, -20, 20);
        dirty = true;
        return;
    }
    if (renderer && renderer.current && performance.now() - probeStamp > 120) {
        probeStamp = performance.now();
        try {
            const px = (e.clientX - r.left) / r.width * canvas.width, py = (r.bottom - e.clientY) / r.height * canvas.height, rgba = renderer.probe(px, py), u = (2000 / 420) / (canvas.width * project.view.zoom), x = (Math.floor(px) + .5 - canvas.width / 2) * u + project.view.x + 1 / 840, y = (Math.floor(py) + .5 - canvas.height / 2) * u + project.view.y + 1 / 840;
            $('probe').textContent = `p(${x.toFixed(2)},${y.toFixed(2)}) RGB ${rgba.slice(0, 3).join(' ')}`;
        }
        catch (e) { /* Context loss is reported by the renderer's event handler. */
        }
    }
};
const endGesture = () => {
    if (gesture) {
        history.push(gesture.before);
        gesture = null;
        changed();
    }
};
canvas.onpointerup = endGesture;
canvas.onpointercancel = endGesture;
let wheelBefore = null, wheelTimer;
canvas.addEventListener('wheel', e => {
    if (busy) {
        return;
    }
    e.preventDefault();
    if (!wheelBefore) {
        wheelBefore = clone(project);
    }
    project.view.zoom = clamp(project.view.zoom * Math.exp(-e.deltaY * .001), .1, 12);
    dirty = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
        if (wheelBefore) {
            history.push(wheelBefore);
            wheelBefore = null;
            changed();
        }
    }, 250);
}, { passive: false });
$('compareButton').onclick = () => $('referenceFile').click();
$('referenceFile').onchange = () => {
    const f = $('referenceFile').files[0];
    if (!f) {
        return;
    }
    try {
        if (f.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
            throw new Error('Use a PNG, JPEG or WebP no larger than 20 MB.');
        }
        if (referenceURL) {
            URL.revokeObjectURL(referenceURL);
        }
        referenceURL = URL.createObjectURL(f);
        $('referenceImage').src = referenceURL;
        $('referenceImage').hidden = false;
        $('compareControls').hidden = false;
        resizeImage();
        toast('Reference stays on your device. Overlay stretches to the canvas; crop and align the source first.');
    }
    catch (e) {
        showError(e);
    }
    finally {
        $('referenceFile').value = '';
    }
};
$('referenceImage').onerror = () => {
    showError('The reference image could not be decoded.');
    $('removeReference').click();
};
$('compareOpacity').oninput = e => $('referenceImage').style.opacity = e.target.value;
$('compareMode').onchange = e => $('referenceImage').style.mixBlendMode = e.target.value;
$('removeReference').onclick = () => {
    if (referenceURL) {
        URL.revokeObjectURL(referenceURL);
    }
    referenceURL = null;
    $('referenceImage').hidden = true;
    $('referenceImage').removeAttribute('src');
    $('compareControls').hidden = true;
    resizeImage();
};
$('researchContent').innerHTML = '<p class="research-intro">Prepared 22 September 2026. The original nebula equations were supplied in this conversation and have a retained Python reference. The other requested subjects have executable, editable studies, but their exact equation sheets were not recovered. No original image is used as a render texture.</p>' + methodNotes.map(([h, p]) => `<section class="research-method"><h3>${esc(h)}</h3><p>${esc(p)}</p></section>`).join('') + '<h3>Source-by-source evidence ledger</h3>' + sources.map(s => `<article class="source-entry"><a href="${s.url}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a><small>${esc(s.status)}</small><p>${esc(s.note)}</p>${s.scene ? `<button data-study="${s.scene}">Open the interpretive study →</button>` : ''}</article>`).join('');
$('researchContent').onclick = e => {
    const el = e.target.closest('[data-study]');
    if (el) {
        $('researchDialog').close();
        loadProject(getPreset(el.dataset.study));
    }
};
$('helpButton').onclick = () => $('helpDialog').showModal();
$('researchButton').onclick = () => $('researchDialog').showModal();
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
    if (busy && b.dataset.close === 'exportDialog') {
        abortExport = true;
        if (recording?.state === 'recording') {
            recording.stop();
        }
        return;
    }
    $(b.dataset.close).close();
});
$('exportButton').onclick = () => {
    if (!renderer) {
        showError('A working WebGL 2 context is required to export.');
        return;
    }
    $('exportWidth').max = renderer.info.maxSize;
    $('exportHeight').max = renderer.info.maxSize;
    $('exportMessage').textContent = '';
    updateExportAdvice();
    $('exportDialog').showModal();
};
$('exportFormat').onchange = () => {
    if ($('exportFormat').value === 'sequence' && Number($('exportWidth').value) > 1280) {
        $('exportWidth').value = 800;
        $('exportHeight').value = 480;
    }
    updateExportAdvice();
};
function updateExportAdvice() {
    const mode = $('exportFormat').value;
    $('exportAdvice').textContent = mode === 'sequence' ? `Exports the whole ${project.duration} s timeline, end point excluded. Up to 240 PNG frames and 1280 pixels per side; ZIP holds compressed PNGs without recompressing them.` : mode === 'video' ? 'Records one timeline pass in real time. Browser codec support varies; use the PNG sequence for exact frame times and lossless output.' : 'PNG exports the current playhead at the selected resolution. Preview width does not remove equation terms. Reference overlays are never included.';
    $('exportFPS').disabled = mode === 'png';
}
$('exportDialog').addEventListener('cancel', e => {
    if (busy) {
        e.preventDefault();
        abortExport = true;
        if (recording?.state === 'recording') {
            recording.stop();
        }
    }
});
$('cancelExport').onclick = () => {
    abortExport = true;
    if (recording?.state === 'recording') {
        recording.stop();
    }
};
$('startExport').onclick = async () => {
    if (!renderer || busy) {
        return;
    }
    const width = Number($('exportWidth').value), height = Number($('exportHeight').value), fps = Number($('exportFPS').value), mode = $('exportFormat').value, target = $('exportIsolated').checked ? (isolated || project.output) : project.output;
    const savedTime = time, scene = clone(project), stem = fileStem(project.title);
    let stream = null;
    try {
        if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 32 || Math.max(width, height) > renderer.info.maxSize) {
            throw new Error(`Use integer dimensions from 32 to ${renderer.info.maxSize}.`);
        }
        if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
            throw new Error('FPS must be an integer from 1 to 60.');
        }
        let times;
        if (mode === 'sequence') {
            times = frameTimes(scene.duration, fps);
            if (Math.max(width, height) > 1280) {
                throw new Error('Sequence export is limited to 1280 pixels per side to bound memory.');
            }
        }
        pause();
        busy = true;
        abortExport = false;
        app.classList.add('busy');
        $('startExport').disabled = true;
        $('cancelExport').hidden = false;
        $('exportProgress').hidden = false;
        $('exportProgress').value = 0;
        const drawAt = t => renderer.draw(scene, t, width, height, target);
        if (mode === 'png') {
            drawAt(savedTime);
            const png = await embedPNGMetadata(await renderer.png(), { project: scene, time: savedTime, width, height, target, backend: renderer.info });
            download(png, `${stem}-${savedTime.toFixed(3)}s.png`);
            $('exportMessage').textContent = `Saved ${width} × ${height} PNG at ${savedTime.toFixed(3)} seconds, with embedded project metadata.`;
        }
        else if (mode === 'sequence') {
            const files = [{ name: 'project.json', data: JSON.stringify(scene, null, 2) }];
            let total = 0;
            for (let i = 0; i < times.length; i++) {
                if (abortExport) {
                    throw new Error('Rendering cancelled. No partial archive was downloaded.');
                }
                drawAt(times[i]);
                const data = new Uint8Array(await (await renderer.png()).arrayBuffer());
                total += data.length;
                if (total > 150 * 1024 * 1024) {
                    throw new Error('PNG frames exceed 150 MB. Reduce FPS, duration or resolution.');
                }
                files.push({ name: `frames/frame_${String(i).padStart(5, '0')}.png`, data });
                $('exportProgress').value = (i + 1) / times.length;
                $('exportMessage').textContent = `Frame ${i + 1}/${times.length} · ${(total / 1048576).toFixed(1)} MB · t=${times[i].toFixed(3)} s`;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            files.push({ name: 'manifest.json', data: JSON.stringify({ schema: 'equation-studio-export-v1', width, height, fps, times, target, backend: renderer.info, tone: scene.tone, exposure: scene.exposure, alpha: 'opaque displayed RGB', referenceOverlayIncluded: false }, null, 2) });
            download(makeZip(files), `${stem}-frames.zip`);
            $('exportMessage').textContent = `Saved ${times.length} exact-time PNG frames, project and manifest.`;
        }
        else {
            if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
                throw new Error('This browser does not expose canvas recording. Use the PNG sequence.');
            }
            const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
            if (!mime) {
                throw new Error('No supported browser recording codec. Use PNG sequence.');
            }
            drawAt(0);
            stream = canvas.captureStream(fps);
            const chunks = [];
            recording = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
            let size = 0;
            let recordingError = null;
            const done = new Promise(resolve => {
                recording.ondataavailable = e => {
                    if (e.data.size) {
                        chunks.push(e.data);
                        size += e.data.size;
                        if (size > 150 * 1024 * 1024) {
                            abortExport = true;
                            if (recording?.state === 'recording') {
                                recording.stop();
                            }
                        }
                    }
                };
                recording.onerror = e => {
                    recordingError = new Error(e.error?.message || 'Browser recording failed.');
                    abortExport = true;
                    resolve();
                };
                recording.onstop = resolve;
            });
            recording.start(250);
            const start = performance.now();
            while (!abortExport && (performance.now() - start) / 1000 < scene.duration) {
                const t = (performance.now() - start) / 1000;
                drawAt(t);
                $('exportProgress').value = t / scene.duration;
                $('exportMessage').textContent = `Recording real time · ${t.toFixed(1)} / ${scene.duration} s`;
                await new Promise(requestAnimationFrame);
            }
            if (recording.state === 'recording') {
                recording.stop();
            }
            await done;
            if (recordingError) {
                throw recordingError;
            }
            if (abortExport) {
                throw new Error('Recording cancelled or exceeded the memory limit. No partial video was downloaded.');
            }
            if (!chunks.length) {
                throw new Error('The browser produced no video frames. Use PNG sequence.');
            }
            const ext = mime.includes('mp4') ? 'mp4' : 'webm';
            download(new Blob(chunks, { type: mime }), `${stem}.${ext}`);
            $('exportMessage').textContent = `Saved ${ext.toUpperCase()} real-time recording. Exact frame count is not guaranteed.`;
        }
        $('exportProgress').value = 1;
    }
    catch (e) {
        $('exportMessage').textContent = e.message;
        showError(e);
    }
    finally {
        if (recording?.state === 'recording') {
            recording.stop();
        }
        recording = null;
        stream?.getTracks().forEach(t => t.stop());
        busy = false;
        time = savedTime;
        app.classList.remove('busy');
        $('startExport').disabled = false;
        $('cancelExport').hidden = true;
        dirty = true;
        updateClock();
    }
};
document.addEventListener('keydown', e => {
    const editing = e.target.matches('input,textarea,select,[contenteditable]'), modal = document.querySelector('dialog[open]');
    if (e.key === 'Escape') {
        connection = null;
        renderGraph();
        if (!modal && isolated) {
            setIsolated(null);
        }
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        $('saveProject').click();
        return;
    }
    if (editing || modal || busy) {
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        $(e.shiftKey ? 'redo' : 'undo').click();
    }
    else if (e.code === 'Space') {
        e.preventDefault();
        $('play').click();
    }
});
// Documented integration hooks. Consumers receive cloned JSON, not mutable UI state.
window.equationStudio = { getProject: () => clone(project), loadProject: p => loadProject(p), getTime: () => time, seek: t => seek(t), getRenderer: () => renderer, getCatalog: () => catalog, isolate: id => {
        if (id && !project.nodes.some(n => n.id === id)) {
            throw new Error('Unknown node.');
        }
        setIsolated(id);
    }, renderNow: () => render(), exportPNG: async () => {
        if (!renderer) {
            throw new Error('GPU unavailable.');
        }
        render();
        return renderer.png();
    } };
refreshUI();
changed();
frameStamp = performance.now();
requestAnimationFrame(tick);
