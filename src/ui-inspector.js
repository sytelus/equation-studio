import { $, esc, clamp, state, on, history, toast, showError, transact, changed, markDirty, markCustom, pause, seek, currentNode, setIsolated, setContribution, setOutput, toggleEnabled, duplicateNode, deleteNode, connect, refreshUI } from './editor.js';
import { catalog, typeNames } from './catalog.js';
import { clone, validateProject, topologicalOrder } from './graph.js';
import { animatedParameters, insertKey } from './timeline.js';
import { compileGraph } from './compiler.js';
import { armProbe } from './ui-canvas.js';
/** Right panel: the selected component's intent, equation, inputs, parameters,
 * animation tracks and actions.
 */
const helpers = [
    ['rotate2(p, angle)', 'rotate a coordinate'], ['angleOf(p)', 'atan2 of a coordinate'], ['noise2(p)', 'smooth value noise 0–1'], ['fbm(p, octaves)', 'fractal noise 0–1'],
    ['gaussian(d, width)', 'exp(−(d/width)²)'], ['cutoff(x)', 'exp(−exp(x)) source gate'], ['softInside(d, edge)', 'soft inside mask 0–1'], ['sat(x)', 'clamp to 0–1'],
    ['segmentDistance(p, a, b)', 'distance to a segment'], ['spectrum(x, shift)', 'vec3 rainbow palette'], ['vortex(p, strength, radius, phase)', 'local twist map'],
    ['domainWarp(p, amplitude, frequency, time)', 'noise displacement map'], ['angularMirror(p, sectors, phase)', 'kaleidoscopic fold'], ['hash21(p)', 'deterministic pseudo-random 0–1']
];
const formatNumber = value => String(Number(value.toFixed(5)));
function reachesOutput(node) {
    return topologicalOrder(state.project).some(n => n.id === node.id);
}
function renderActions(n) {
    const isolated = state.isolated === n.id, contribution = state.contribution === n.id;
    let html = `<div class="mini-actions"><button id="isolateNode" class="${isolated ? 'active' : ''}" title="Show only this component's field (I)">${isolated ? 'Viewing isolated' : 'Isolate'}</button><button id="contributionNode" class="${contribution ? 'active' : ''}" title="Show which output pixels this component changes (C)">${contribution ? 'Viewing contribution' : 'Contribution'}</button><button id="makeOutput" ${state.project.output === n.id ? 'disabled' : ''}>${state.project.output === n.id ? '✓ Output' : 'Set as output'}</button><button id="toggleNode">${n.enabled ? 'Disable' : 'Enable'}</button><button id="sampleField" title="Read raw field values before tone mapping">Probe value</button></div>`;
    if (contribution) {
        html += `<div class="input-row contribution-row"><label for="contributionStyle">View</label><select id="contributionStyle" aria-label="Contribution view style"><option value="highlight" ${state.contributionStyle === 'highlight' ? 'selected' : ''}>Changed pixels in color, others dimmed</option><option value="signed" ${state.contributionStyle === 'signed' ? 'selected' : ''}>Signed difference: warm brightens, cool darkens</option></select></div><p class="node-caption">The composite is rendered with and without this component. The comparison uses displayed colors after exposure and tone mapping.</p>`;
    }
    if (!reachesOutput(n)) {
        html += '<div class="selection-note warning">Not connected to the output. It does not affect the composite image until something downstream uses it, or it becomes the output.</div>';
    }
    return html;
}
function renderInputs(n, def) {
    const entries = Object.entries(def.inputs);
    if (!entries.length) {
        return '';
    }
    let html = '<div class="inspector-section">INPUT CONNECTIONS</div>';
    for (const [socket, kind] of entries) {
        const options = state.project.nodes.filter(other => other.id !== n.id && catalog[other.type].output === kind).map(other => `<option value="${other.id}" ${n.inputs[socket] === other.id ? 'selected' : ''}>${esc(other.label)} [${other.id}]</option>`).join('');
        html += `<div class="input-row"><label for="in-${socket}"><span class="type-dot ${kind}"></span>${esc(socket)}</label><select id="in-${socket}" data-input="${socket}" aria-label="${esc(socket)} input"><option value="">Unconnected · zero</option>${options}</select></div>`;
    }
    return html;
}
function renderParameters(n, def, evaluated) {
    const params = Object.entries(def.params);
    if (!params.length) {
        return '';
    }
    const numeric = params.some(([, s]) => s.kind === 'number');
    let html = `<div class="inspector-section">PARAMETERS ${numeric ? '<span>◆ ADD KEY · ↺ RESET</span>' : ''}</div>`;
    if (state.project.tracks.some(t => t.node === n.id && t.keys.length)) {
        html += '<div class="selection-note">Tracked controls show the value at the playhead. Adjusting one adds a key here. Untracked controls change the base value.</div>';
    }
    for (const [key, s] of params) {
        const value = evaluated[key], track = state.project.tracks.find(t => t.node === n.id && t.param === key);
        const reset = `<button class="reset" data-reset="${key}" title="Reset to the default ${esc(String(s.value))}" aria-label="Reset ${esc(s.label)}">↺</button>`;
        if (s.kind === 'number') {
            html += `<div class="param"><div class="param-head"><label for="param-${key}">${esc(s.label)}</label><input type="number" data-param="${key}" id="number-${key}" value="${formatNumber(value)}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${esc(s.label)} numerical value"><button class="key ${track?.keys.length ? 'keyed' : ''}" data-key="${key}" title="Add or replace a key at ${state.time.toFixed(3)} s" aria-label="Keyframe ${esc(s.label)}">◆</button>${reset}</div><input type="range" id="param-${key}" data-param="${key}" value="${value}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${esc(s.label)}">${s.help ? `<small>${esc(s.help)}</small>` : ''}</div>`;
        }
        else if (s.kind === 'color') {
            html += `<div class="param"><div class="param-head"><label>${esc(s.label)}</label><input type="color" value="${value}" data-param="${key}" aria-label="${esc(s.label)}"><span class="muted" data-color-text="${key}">${esc(value)}</span>${reset}</div><small>${esc(s.help)}</small></div>`;
        }
        else {
            const options = helpers.map(([signature, hint]) => `<option value="${esc(signature)}">${esc(signature)} — ${esc(hint)}</option>`).join('');
            html += `<textarea id="equationEditor" class="expression-input" spellcheck="false" aria-label="Custom GLSL expression">${esc(n.params[key])}</textarea><div class="expression-tools"><select id="insertHelper" aria-label="Insert a helper function"><option value="">Insert helper…</option>${options}</select><button id="applyEquation" class="primary" title="Apply (Ctrl/⌘ Enter)">Apply equation</button></div><p class="node-caption">${esc(s.help)} Use decimal literals: <code>2.0</code>, not <code>2</code>. Ctrl/⌘ Enter applies.</p><pre id="equationError" class="code-error"></pre>`;
        }
    }
    return html;
}
function renderTracks(n) {
    const tracks = state.project.tracks.filter(t => t.node === n.id);
    if (!tracks.length) {
        return '';
    }
    return '<div class="inspector-section">ANIMATION TRACKS</div>' + tracks.map(t => `<div class="track-edit"><header><b>${esc(t.param)}</b><select data-interpolation="${t.param}" aria-label="Interpolation for ${t.param}">${['smooth', 'linear', 'hold'].map(v => `<option ${v === t.interpolation ? 'selected' : ''}>${v}</option>`).join('')}</select><button data-remove-track="${t.param}" title="Remove track; use base value" aria-label="Remove ${t.param} animation track">×</button></header><div class="key-list">${t.keys.map(k => `<button class="key-chip" data-seek="${k.time}" title="Seek to this key">${k.time}s: ${Number(k.value.toFixed(3))}<span data-remove-key="${t.param}" data-time="${k.time}" title="Delete this key">×</span></button>`).join('')}</div></div>`).join('');
}
export function renderInspector() {
    const n = currentNode(), def = catalog[n.type], evaluated = animatedParameters(state.project, n, state.time);
    $('nodeTypeBadge').textContent = typeNames[def.output];
    $('inspectorContent').innerHTML = `<input class="node-title" id="nodeLabel" value="${esc(n.label)}" aria-label="Component label" maxlength="160"><p class="node-caption">${esc(def.description)}</p><div class="equation-box">${esc(def.equation)}</div>`
        + renderActions(n) + renderInputs(n, def) + renderParameters(n, def, evaluated) + renderTracks(n)
        + `<div class="node-bottom"><button id="duplicateNode" title="Duplicate (Ctrl/⌘ D)">Duplicate</button><button id="deleteNode" class="danger" title="Delete (Delete key while the graph has focus)">Delete component</button></div><p class="node-caption">ID: <code>${n.id}</code> · Type: <code>${n.type}</code><br>Output: ${esc(typeNames[def.output])}. Unconnected inputs evaluate to zero; they are not inferred dependencies.</p>`;
    bindInspector(n, def);
}
function bindInspector(n, def) {
    $('nodeLabel').onchange = e => transact(p => p.nodes.find(v => v.id === n.id).label = e.target.value);
    $('isolateNode').onclick = () => setIsolated(state.isolated === n.id ? null : n.id);
    $('contributionNode').onclick = () => setContribution(state.contribution === n.id ? null : n.id);
    $('makeOutput').onclick = () => setOutput(n.id);
    $('toggleNode').onclick = () => toggleEnabled(n.id);
    $('sampleField').onclick = () => armProbe();
    $('duplicateNode').onclick = () => duplicateNode(n.id);
    $('deleteNode').onclick = () => deleteNode(n.id);
    const style = $('contributionStyle');
    if (style) {
        style.onchange = () => setContribution(n.id, style.value);
    }
    document.querySelectorAll('[data-input]').forEach(input => input.onchange = e => connect(e.target.value, n.id, input.dataset.input));
    bindParameters(n, def);
    document.querySelectorAll('[data-key]').forEach(button => button.onclick = () => {
        pause();
        const key = button.dataset.key;
        transact(p => {
            const value = animatedParameters(p, p.nodes.find(v => v.id === n.id), state.time)[key];
            insertKey(p, n.id, key, state.time, value);
        });
        toast(`Key added at ${state.time.toFixed(3)} s. Move the playhead, then change the control to add another.`);
    });
    document.querySelectorAll('[data-reset]').forEach(button => button.onclick = () => {
        const key = button.dataset.reset, value = def.params[key].value;
        transact(p => {
            const node = p.nodes.find(v => v.id === n.id);
            node.params[key] = value;
            if (p.tracks.some(t => t.node === n.id && t.param === key && t.keys.length)) {
                insertKey(p, n.id, key, state.time, value);
            }
        });
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
    bindExpression(n);
}
/** Live parameter edits mutate the model directly for smooth dragging; history
 * receives one entry per completed gesture (the `change` event).
 */
function bindParameters(n, def) {
    document.querySelectorAll('[data-param]').forEach(input => {
        input.oninput = () => {
            if (state.busy) {
                return;
            }
            pause();
            const key = input.dataset.param, s = def.params[key], raw = s.kind === 'color' ? input.value : Number(input.value);
            if (s.kind === 'number' && (input.value === '' || !Number.isFinite(raw))) {
                return;
            }
            if (!input._before) {
                input._before = clone(state.project);
            }
            const value = s.kind === 'number' ? clamp(raw, s.min, s.max) : raw, node = state.project.nodes.find(v => v.id === n.id);
            node.params[key] = value;
            if (state.project.tracks.some(t => t.node === n.id && t.param === key && t.keys.length)) {
                insertKey(state.project, n.id, key, state.time, value);
            }
            document.querySelectorAll(`[data-param="${key}"]`).forEach(el => {
                if (el !== input) {
                    el.value = value;
                }
            });
            const text = document.querySelector(`[data-color-text="${key}"]`);
            if (text) {
                text.textContent = value;
            }
            markDirty();
        };
        input.onchange = () => {
            if (input._before) {
                history.push(input._before);
                delete input._before;
                changed();
                refreshUI();
            }
        };
    });
}
function bindExpression(n) {
    const editor = $('equationEditor');
    if (!editor) {
        return;
    }
    const apply = () => {
        const next = clone(state.project);
        next.nodes.find(v => v.id === n.id).params.expression = editor.value;
        try {
            validateProject(next);
            if (state.renderer) {
                state.renderer.getProgram(next, n.id);
            }
            else {
                compileGraph(next, n.id);
            }
            history.push(state.project);
            markCustom(next);
            state.project = next;
            changed();
            refreshUI();
            toast('Equation compiled.');
        }
        catch (e) {
            $('equationError').textContent = e.message;
            showError('Equation not applied. The last good image is unchanged.');
        }
    };
    $('applyEquation').onclick = apply;
    editor.onkeydown = e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            apply();
        }
    };
    $('insertHelper').onchange = e => {
        const text = e.target.value;
        e.target.value = '';
        if (text) {
            editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
            editor.focus();
        }
    };
}
/** Update visible values for the playhead without rebuilding the panel, so
 * scrubbing and playback never steal focus or discard an unapplied expression.
 */
export function syncInspectorValues() {
    const n = currentNode(), def = catalog[n.type];
    if (!state.project.tracks.some(t => t.node === n.id && t.keys.length)) {
        return;
    }
    const evaluated = animatedParameters(state.project, n, state.time);
    document.querySelectorAll('[data-param]').forEach(input => {
        const s = def.params[input.dataset.param];
        if (!s || s.kind !== 'number' || input === document.activeElement) {
            return;
        }
        input.value = input.type === 'number' ? formatNumber(evaluated[input.dataset.param]) : evaluated[input.dataset.param];
    });
    document.querySelectorAll('[data-key]').forEach(button => button.title = `Add or replace a key at ${state.time.toFixed(3)} s`);
}
on('refresh', renderInspector);
on('selection', renderInspector);
on('view', renderInspector);
on('time', syncInspectorValues);
