import { $, esc, clamp, state, on, history, toast, showError, transact, changed, markDirty, markCustom, pause, seek, currentNode, nodeById, setView, viewedNode, setOutput, toggleEnabled, duplicateNode, deleteNode, connect, refreshUI, resetParam, resetNode, insertComponent, replaceComponent, bypassDescription } from './editor.js';
import { catalog, typeNames, typeLabels, insertableTypes, replacementTypes, emitPreview } from './catalog.js';
import { clone, validateProject, topologicalOrder } from './graph.js';
import { animatedParameters, insertKey } from './timeline.js';
import { compileGraph } from './compiler.js';
import { texToMathML, expressionToMathML } from './math-render.js';
import { originalValue } from './explore.js';
import { openSweep, openVariations } from './ui-explore.js';
/** Right panel: the selected component explained and edited. Its intent, typeset
 * equation with a live "where" legend, inputs (with insert), parameters (with
 * help, original-value markers, reset and sweep), animation tracks, and actions.
 */
const helpers = [
    ['rotate2(p, angle)', 'rotate a coordinate'], ['angleOf(p)', 'atan2 of a coordinate'], ['noise2(p)', 'smooth value noise 0–1'], ['fbm(p, octaves)', 'fractal noise 0–1'],
    ['gaussian(d, width)', 'exp(−(d/width)²)'], ['cutoff(x)', 'exp(−exp(x)) source gate'], ['softInside(d, edge)', 'soft inside mask 0–1'], ['sat(x)', 'clamp to 0–1'],
    ['segmentDistance(p, a, b)', 'distance to a segment'], ['spectrum(x, shift)', 'vec3 rainbow palette'], ['vortex(p, strength, radius, phase)', 'local twist map'],
    ['domainWarp(p, amplitude, frequency, time)', 'noise displacement map'], ['angularMirror(p, sectors, phase)', 'kaleidoscopic fold'], ['hash21(p)', 'deterministic pseudo-random 0–1']
];
const expressionLHS = { expression: '<mi>f</mi>', vectorExpression: '<mi>q</mi>', colorExpression: '<mi mathvariant="normal">RGB</mi>' };
const formatNumber = value => String(Number(Number(value).toFixed(5)));
/** Whether the equation section is expanded; kept while moving between components. */
let equationOpen = true;
/** Typeset TeX, falling back to the source text so a typo never hides content. */
function math(tex, display = false) {
    try {
        return texToMathML(tex, { display });
    }
    catch (e) {
        return `<code>${esc(tex)}</code>`;
    }
}
function reachesOutput(node) {
    return topologicalOrder(state.project).some(n => n.id === node.id);
}
function isParamModified(node, key) {
    const tracked = state.project.tracks.some(t => t.node === node.id && t.param === key && t.keys.length);
    const trackedOriginally = state.baseline.tracks.some(t => t.node === node.id && t.param === key && t.keys.length);
    return node.params[key] !== originalValue(state.baseline, node, key) || tracked !== trackedOriginally;
}
function renderHeader(n, def) {
    const bypass = bypassDescription(n);
    return `<div class="inspector-head"><label class="switch" data-tip="${n.enabled ? 'Included' : 'Bypassed'}|Untick to bypass this component: it then ${esc(bypass)}. Tick to include it again." data-toggle aria-pressed="${n.enabled}"><input type="checkbox" id="nodeEnabled" ${n.enabled ? 'checked' : ''} aria-label="Include this component"><span></span></label><input class="node-title" id="nodeLabel" value="${esc(n.label)}" aria-label="Component label" maxlength="160" data-tip="Rename|The label is only for you; the id stays ${esc(n.id)}."></div>
<div class="node-kind"><span class="type-chip ${def.output}">${esc(typeLabels[def.output])}</span><span>${esc(def.category)}</span><code>${esc(n.id)}</code></div>
<p class="node-caption">${esc(def.description)}</p>`;
}
function renderViewButtons(n) {
    const viewing = viewedNode().id === n.id, stage = viewing && state.viewMode === 'stage', effect = viewing && state.viewMode === 'effect', output = state.project.output === n.id;
    let html = `<div class="view-buttons"><button id="showStage" class="${stage ? 'active' : ''}" data-key="I" data-tip="Show this stage|The canvas shows only this component’s output: what it produces before anything downstream uses it. Scalar, coordinate and geometry fields appear in false color (see the legend on the canvas).">👁 Show this stage</button><button id="showEffect" class="${effect ? 'active' : ''}" data-key="C" data-tip="Show what it changes|Renders the final image with and without this component (bypassed) and highlights the pixels it changes.">Δ What it changes</button><button id="makeOutput" ${output ? 'disabled' : ''} data-tip="${output ? 'This is the final output|The canvas’s Final image, saves and exports use this component.' : 'Make final output|Use this component as the scene’s final image, for the canvas, saves and exports. To just look at it, use Show this stage instead.'}">${output ? '★ Final output' : '☆ Make final output'}</button></div>`;
    if (!n.enabled) {
        html += `<div class="selection-note warning">Bypassed: this component ${esc(bypassDescription(n))}. Tick the switch above to include it.</div>`;
    }
    else if (!reachesOutput(n)) {
        html += '<div class="selection-note warning">Not connected to the final output, so it does not change the image. Show this stage to see it, wire it into something downstream, or make it the final output.</div>';
    }
    return html;
}
function renderEquation(n, def, evaluated) {
    const custom = Object.hasOwn(expressionLHS, n.type);
    let equation;
    if (custom) {
        let rendered;
        try {
            rendered = expressionToMathML(n.params.expression, expressionLHS[n.type]);
        }
        catch (e) {
            rendered = `<code>${esc(n.params.expression)}</code>`;
        }
        const options = helpers.map(([signature, hint]) => `<option value="${esc(signature)}">${esc(signature)} — ${esc(hint)}</option>`).join('');
        const modified = isParamModified(n, 'expression');
        equation = `<div class="equation-card" id="expressionPreview" data-tip="Live preview|Your GLSL expression typeset as mathematics while you type. Apply compiles it into the shader.">${rendered}</div>
<textarea id="equationEditor" class="expression-input" spellcheck="false" aria-label="Custom GLSL expression">${esc(n.params.expression)}</textarea><div class="expression-tools"><select id="insertHelper" aria-label="Insert a helper function" data-tip="Insert a helper|Adds a built-in GLSL function at the cursor."><option value="">Insert helper…</option>${options}</select><button id="resetExpression" class="reset" ${modified ? '' : 'disabled'} data-tip="Reset the expression|Back to the expression the scene was opened with.">↺</button><button id="applyEquation" class="primary" data-key="Ctrl/⌘ Enter" data-tip="Apply equation|Compiles the expression. A failed compile leaves the image unchanged.">Apply</button></div><p class="node-caption">${esc(def.params.expression.help)} Use decimal literals: <code>2.0</code>, not <code>2</code>.</p><pre id="equationError" class="code-error"></pre>`;
    }
    else {
        equation = `<div class="equation-card">${def.tex.map(line => math(line, true)).join('')}</div>`;
    }
    const rows = [];
    for (const [key, s] of Object.entries(def.params)) {
        if (s.symbol) {
            const value = s.kind === 'number' ? formatNumber(evaluated[key]) : evaluated[key];
            rows.push(`<button class="sym-row" data-focus-param="${key}" data-tip="${esc(s.label)}|${esc(s.help)}"><span class="sym">${math(s.symbol)}</span><span>${esc(s.label)}</span><span class="val" data-sym-value="${key}">${s.kind === 'color' ? `<i class="chip" style="background:${esc(value)}"></i>` : ''}${esc(value)}</span></button>`);
        }
    }
    for (const [socket, kind] of Object.entries(def.inputs)) {
        const symbol = def.inputSymbols[socket] || socket, source = nodeById(n.inputs[socket]);
        rows.push(`<div class="sym-row input"><span class="sym">${math(symbol)}</span><span>${esc(typeLabels[kind])} input</span><span class="val">${source ? `from ${esc(source.label)}` : 'unconnected · zero'}</span></div>`);
    }
    for (const [symbol, meaning] of def.notes) {
        rows.push(`<div class="sym-row sym-note"><span class="sym">${math(symbol)}</span><span class="wide">${esc(meaning)}</span></div>`);
    }
    return `<details class="equation-details" id="equationDetails" ${equationOpen ? 'open' : ''}><summary class="inspector-section" data-tip="Equation|What this component computes, typeset, with every symbol explained below it. Click to collapse or expand.">EQUATION <button id="toggleCode" class="link" data-tip="Show the GLSL|The shader code this component contributes, with parameter names in place of uniforms.">GLSL</button></summary>${equation}<pre id="nodeCode" class="node-code" hidden>${esc(emitPreview(n.type, n.params))}</pre>${rows.length ? `<div class="sym-list"><small class="where">where</small>${rows.join('')}</div>` : ''}</details>`;
}
function renderInputs(n, def) {
    const entries = Object.entries(def.inputs);
    if (!entries.length) {
        return '';
    }
    let html = '<div class="inspector-section">INPUTS</div>';
    for (const [socket, kind] of entries) {
        const options = state.project.nodes.filter(other => other.id !== n.id && catalog[other.type].output === kind).map(other => `<option value="${other.id}" ${n.inputs[socket] === other.id ? 'selected' : ''}>${esc(other.label)}</option>`).join('');
        const inserts = !n.inputs[socket] ? '' : insertableTypes(kind).map(type => `<option value="${type}">${esc(catalog[type].name)}</option>`).join('');
        html += `<div class="input-row"><label for="in-${socket}" data-tip="${esc(socket)}: ${esc(typeLabels[kind])}|Choose which component feeds this input. Unconnected inputs are zero, not the image coordinates."><span class="type-dot ${kind}"></span>${esc(socket)}</label><select id="in-${socket}" data-input="${socket}" aria-label="${esc(socket)} input"><option value="">Unconnected · zero</option>${options}</select>${inserts ? `<select class="insert" data-insert="${socket}" aria-label="Insert a component on ${esc(socket)}" data-tip="Insert on this input|Put a modifier between this input and what feeds it, e.g. a warp before a field or a tint before a layer. The old connection passes through it."><option value="">＋</option>${inserts}</select>` : ''}</div>`;
    }
    return html;
}
function renderNumber(n, key, s, value, modified) {
    const original = originalValue(state.baseline, n, key), track = state.project.tracks.find(t => t.node === n.id && t.param === key);
    const pct = clamp((original - s.min) / (s.max - s.min), 0, 1);
    return `<div class="param ${modified ? 'modified' : ''}" data-param-row="${key}"><div class="param-head"><label for="param-${key}" data-tip="${esc(s.label)}|${esc(s.help)}\nDouble-click to reset.">${esc(s.label)} <span class="sym">${math(s.symbol)}</span></label><input type="number" data-param="${key}" id="number-${key}" value="${formatNumber(value)}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${esc(s.label)} numerical value"><button class="key ${track?.keys.length ? 'keyed' : ''}" data-keyframe="${key}" aria-label="Keyframe ${esc(s.label)}" data-tip="Add a key|Records this value at ${state.time.toFixed(2)} s. Move the playhead and change the value to animate it.">◆</button><button class="reset" data-reset="${key}" ${modified ? '' : 'disabled'} aria-label="Reset ${esc(s.label)}" data-tip="Reset to ${formatNumber(original)}|Returns this parameter to its value when the scene was opened${track ? ' and removes its animation' : ''}.">↺</button><button class="sweep" data-sweep="${key}" aria-label="Explore ${esc(s.label)}" data-tip="Explore this parameter|Renders the image across the parameter’s whole range. Hover a thumbnail to preview it, click to use it.">▦</button></div><div class="slider-wrap"><input type="range" id="param-${key}" data-param="${key}" value="${value}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${esc(s.label)}"><span class="default-mark" style="left:calc(${(pct * 100).toFixed(2)}% + ${((0.5 - pct) * 14).toFixed(1)}px)" data-tip="Original value ${formatNumber(original)}|Where this parameter started. ↺ returns here."></span></div><small>${esc(s.help)} <span class="range">Range ${s.min} to ${s.max}${formatNumber(original) !== formatNumber(value) ? ` · original ${formatNumber(original)}` : ''}</span></small></div>`;
}
function renderParameters(n, def, evaluated) {
    const params = Object.entries(def.params).filter(([, s]) => s.kind !== 'expression'); // expressions are edited with their equation
    if (!params.length) {
        return '';
    }
    const anyModified = params.some(([key]) => isParamModified(n, key));
    let html = `<div class="inspector-section">PARAMETERS <button id="resetNode" class="link" ${anyModified ? '' : 'disabled'} data-tip="Reset all parameters|Returns every parameter of this component to its value when the scene was opened (undoable).">↺ Reset all</button></div>`;
    if (state.project.tracks.some(t => t.node === n.id && t.keys.length)) {
        html += '<div class="selection-note">Animated controls (◆ lit) show the value at the playhead. Changing one adds or updates a key there.</div>';
    }
    for (const [key, s] of params) {
        const value = evaluated[key], modified = isParamModified(n, key);
        if (s.kind === 'number') {
            html += renderNumber(n, key, s, value, modified);
        }
        else if (s.kind === 'color') {
            const original = originalValue(state.baseline, n, key);
            html += `<div class="param ${modified ? 'modified' : ''}" data-param-row="${key}"><div class="param-head"><label data-tip="${esc(s.label)}|${esc(s.help)}">${esc(s.label)} <span class="sym">${math(s.symbol)}</span></label><input type="color" value="${value}" data-param="${key}" aria-label="${esc(s.label)}"><span class="muted mono" data-color-text="${key}">${esc(value)}</span><button class="reset" data-reset="${key}" ${modified ? '' : 'disabled'} aria-label="Reset ${esc(s.label)}" data-tip="Reset to ${esc(original)}|Returns this color to its value when the scene was opened.">↺</button></div><small>${esc(s.help)}</small></div>`;
        }

    }
    return html;
}
function renderTracks(n) {
    const tracks = state.project.tracks.filter(t => t.node === n.id);
    if (!tracks.length) {
        return '';
    }
    return '<div class="inspector-section">ANIMATION</div>' + tracks.map(t => `<div class="track-edit"><header><b>${esc(catalog[n.type].params[t.param]?.label || t.param)}</b><select data-interpolation="${t.param}" aria-label="Interpolation for ${t.param}" data-tip="Interpolation|smooth eases in and out of each key, linear moves at constant speed, hold jumps at each key.">${['smooth', 'linear', 'hold'].map(v => `<option ${v === t.interpolation ? 'selected' : ''}>${v}</option>`).join('')}</select><button data-remove-track="${t.param}" aria-label="Remove ${t.param} animation track" data-tip="Remove animation|Deletes every key; the parameter keeps its current base value.">×</button></header><div class="key-list">${t.keys.map(k => `<button class="key-chip" data-seek="${k.time}" data-tip="Key at ${k.time} s|Click to move the playhead here.">${k.time}s: ${Number(k.value.toFixed(3))}<span data-remove-key="${t.param}" data-time="${k.time}" data-tip="Delete this key">×</span></button>`).join('')}</div></div>`).join('');
}
function renderActions(n) {
    const replacements = replacementTypes(n.type).map(type => `<option value="${type}">${esc(catalog[type].name)}</option>`).join('');
    const numeric = Object.values(catalog[n.type].params).some(s => s.kind === 'number');
    return `<div class="inspector-section">EXPLORE & EDIT</div><div class="node-bottom">${numeric ? '<button id="variations" data-tip="Variations|Renders eight random variations of this component’s parameters. Hover to preview, click to use one; Undo returns.">✦ Variations</button>' : ''}<select id="replaceWith" aria-label="Replace with another component" data-tip="Replace with…|Swap this component for another of the same output type, keeping its connections where the sockets match. The Ring Nebula scene is the Bipolar Nebula with its geometry replaced this way."><option value="">Replace with…</option>${replacements}</select><button id="duplicateNode" data-key="Ctrl/⌘ D" data-tip="Duplicate|Adds a copy with the same parameters and inputs.">Duplicate</button><button id="deleteNode" class="danger" data-key="Delete" data-tip="Delete component|Removes it and disconnects anything it fed (undoable).">Delete</button></div><p class="node-caption">Type <code>${n.type}</code> · output ${esc(typeNames[catalog[n.type].output])}. Unconnected inputs evaluate to zero; they are not inferred.</p>`;
}
export function renderInspector() {
    const n = currentNode(), def = catalog[n.type], evaluated = animatedParameters(state.project, n, state.time);
    $('nodeTypeBadge').textContent = typeNames[def.output];
    const code = $('nodeCode') && !$('nodeCode').hidden;
    $('inspectorContent').innerHTML = renderHeader(n, def) + renderViewButtons(n) + renderEquation(n, def, evaluated) + renderInputs(n, def) + renderParameters(n, def, evaluated) + renderTracks(n) + renderActions(n);
    $('nodeCode').hidden = !code;
    bindInspector(n, def);
}
function bindInspector(n, def) {
    $('nodeEnabled').onchange = () => toggleEnabled(n.id);
    $('nodeLabel').onchange = e => transact(p => p.nodes.find(v => v.id === n.id).label = e.target.value);
    $('showStage').onclick = () => setView(state.viewMode === 'stage' && viewedNode().id === n.id ? 'final' : 'stage', { node: n.id, lock: false });
    $('showEffect').onclick = () => setView(state.viewMode === 'effect' && viewedNode().id === n.id ? 'final' : 'effect', { node: n.id, lock: false });
    $('makeOutput').onclick = () => setOutput(n.id);
    $('toggleCode').onclick = e => {
        e.preventDefault(); // do not also toggle the <details>
        $('nodeCode').hidden = !$('nodeCode').hidden;
        $('equationDetails').open = true;
    };
    $('equationDetails').ontoggle = () => equationOpen = $('equationDetails').open;
    $('duplicateNode').onclick = () => duplicateNode(n.id);
    $('deleteNode').onclick = () => deleteNode(n.id);
    $('replaceWith').onchange = e => e.target.value && replaceComponent(n.id, e.target.value);
    if ($('variations')) {
        $('variations').onclick = () => openVariations(n.id);
    }
    if ($('resetNode')) {
        $('resetNode').onclick = () => resetNode(n.id);
    }
    document.querySelectorAll('[data-focus-param]').forEach(row => row.onclick = () => {
        const target = $(`number-${row.dataset.focusParam}`) || document.querySelector(`[data-param="${row.dataset.focusParam}"]`);
        const block = document.querySelector(`[data-param-row="${row.dataset.focusParam}"]`);
        block?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        block?.classList.add('flash');
        setTimeout(() => block?.classList.remove('flash'), 900);
        target?.focus({ preventScroll: true });
    });
    document.querySelectorAll('[data-input]').forEach(input => input.onchange = e => connect(e.target.value, n.id, input.dataset.input));
    document.querySelectorAll('[data-insert]').forEach(select => select.onchange = e => {
        if (e.target.value) {
            try {
                insertComponent(e.target.value, n.id, select.dataset.insert);
            }
            catch (err) {
                showError(err);
            }
        }
    });
    bindParameters(n, def);
    document.querySelectorAll('[data-keyframe]').forEach(button => button.onclick = () => {
        pause();
        const key = button.dataset.keyframe;
        transact(p => {
            const value = animatedParameters(p, p.nodes.find(v => v.id === n.id), state.time)[key];
            insertKey(p, n.id, key, state.time, value);
        });
        toast(`Key added at ${state.time.toFixed(3)} s. Move the playhead, then change the control to add another.`);
    });
    document.querySelectorAll('[data-reset]').forEach(button => button.onclick = () => resetParam(n.id, button.dataset.reset));
    document.querySelectorAll('[data-param-row] label').forEach(label => label.ondblclick = () => resetParam(n.id, label.closest('[data-param-row]').dataset.paramRow));
    document.querySelectorAll('[data-sweep]').forEach(button => button.onclick = () => openSweep(n.id, button.dataset.sweep));
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
            const legend = document.querySelector(`[data-sym-value="${key}"]`);
            if (legend) {
                legend.textContent = s.kind === 'number' ? formatNumber(value) : value;
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
    const preview = () => {
        try {
            $('expressionPreview').innerHTML = expressionToMathML(editor.value, expressionLHS[n.type]);
            $('expressionPreview').classList.remove('invalid');
        }
        catch (e) {
            $('expressionPreview').classList.add('invalid');
            $('equationError').textContent = `Preview: ${e.message}`;
            return;
        }
        $('equationError').textContent = '';
    };
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
    editor.oninput = preview;
    $('applyEquation').onclick = apply;
    $('resetExpression').onclick = () => resetParam(n.id, 'expression');
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
            preview();
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
    document.querySelectorAll('[data-sym-value]').forEach(el => {
        const s = def.params[el.dataset.symValue];
        if (s?.kind === 'number') {
            el.textContent = formatNumber(evaluated[el.dataset.symValue]);
        }
    });
}
on('refresh', renderInspector);
on('selection', renderInspector);
on('view', renderInspector);
on('time', syncInspectorValues);
