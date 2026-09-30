import { state, transact, toast, showError, setView, setShow, setEnabled, nodeById, clamp } from './editor.js';
import { catalog, paramSpecs } from './catalog.js';
import { analyzeCode, showable } from './glsl.js';
import { getWork } from './works.js';
import { guides } from './presets.js';
import { buildUp } from './ui-code-view.js';
import { togglePlay } from './ui-timeline.js';
/** The guide of the open scene and its "Try this" challenges.
 *
 * A scene's guide says what the scene is, how hard it is and what to try. A work's
 * scene (project.work) takes it from works.js; a construction from `guides` in
 * presets.js. Each challenge is one action on one part (see the field lists in
 * works.js and presets.js); applying it is a single undoable step, and the
 * challenges tried in this scene are remembered until another scene is opened.
 */
/** {kind: 'work'|'scene', level, about, try, tour, work, node} for the open scene, or null. */
export function sceneGuide(project = state.project) {
    const work = project.work ? getWork(project.work) : null;
    if (work) {
        const node = project.nodes.find(n => n.work === work.id);
        return { kind: 'work', work, node: node?.id ?? null, level: work.level, about: work.summary, try: work.try || [], tour: work.tour || [] };
    }
    const guide = guides[project.id];
    return guide ? { kind: 'scene', work: null, node: null, level: guide.level, about: guide.about, try: guide.try || [], tour: [] } : null;
}
/** The part a challenge acts on. */
function targetOf(entry, guide) {
    return entry.hide || entry.node || entry.set?.node || entry.code?.node || guide.node;
}
/** The text a `code` challenge edits: the code of a Shader code part, else its equation. */
function textKey(node) {
    return catalog[node.type].code ? 'code' : 'expression';
}
/** Whether a challenge can be applied to the scene as it is now (a part may have been deleted or edited). */
export function tryAvailable(entry, guide) {
    if (entry.view === 'motion') {
        return true; // the whole picture: no part needed
    }
    const node = nodeById(targetOf(entry, guide));
    if (!node) {
        return false;
    }
    if (entry.set) {
        return !!paramSpecs(node)[entry.set.param];
    }
    if (entry.code) {
        return typeof node.params[textKey(node)] === 'string' && node.params[textKey(node)].includes(entry.code.find);
    }
    if (entry.build !== undefined) {
        return !!paramSpecs(node)[`steps${entry.build}`];
    }
    return true;
}
const tried = { scene: null, keys: new Set() };
/** Whether challenge `index` was tried in the open scene. */
export function wasTried(index) {
    return tried.scene === state.project.id && tried.keys.has(index);
}
/** Apply challenge `index` of the open scene's guide. */
export function applyTry(index) {
    const guide = sceneGuide(), entry = guide?.try[index];
    if (!entry || !tryAvailable(entry, guide)) {
        showError('This one cannot be tried on the scene as it is now. Start over (top bar) brings the scene back.');
        return false;
    }
    const id = targetOf(entry, guide), node = nodeById(id);
    let ok = true, play = true;
    try {
        if (entry.set) {
            const spec = paramSpecs(node)[entry.set.param];
            const value = spec.kind === 'number'
                ? clamp(entry.set.times !== undefined ? node.params[entry.set.param] * entry.set.times : entry.set.value, spec.min, spec.max)
                : entry.set.value;
            ok = transact(p => p.nodes.find(n => n.id === id).params[entry.set.param] = value);
        }
        else if (entry.code) {
            const key = textKey(node);
            ok = transact(p => {
                const n = p.nodes.find(x => x.id === id);
                n.params[key] = n.params[key].replace(entry.code.find, entry.code.replace);
            }, { structural: true });
        }
        else if (entry.hide) {
            setEnabled([id], false);
        }
        else if (entry.view === 'motion') {
            setView('motion');
        }
        else if (entry.view === 'stage') {
            setView('stage', { node: id });
        }
        else if (entry.show) {
            const index = showable(analyzeCode(node.params.code)).findIndex(item => item.name === entry.show) + 1;
            setShow(id, index);
        }
        else if (entry.build !== undefined) {
            play = false;
            buildUp(node, entry.build - 1);
        }
    }
    catch (e) {
        showError(e);
        return false;
    }
    if (!ok) {
        return false;
    }
    if (tried.scene !== state.project.id) {
        tried.scene = state.project.id;
        tried.keys.clear();
    }
    tried.keys.add(index);
    if (play && !state.playing && state.project.duration > 0) {
        togglePlay(); // most changes show best in motion
    }
    toast(entry.build !== undefined ? 'Watch the picture build up, step by step. Press Esc to stop.'
        : entry.view || entry.show ? 'The canvas shows something new. Choose Whole picture above it (or press Esc) to go back.'
            : 'Changed. Watch the picture. Undo (Ctrl+Z, or ↶ at the top) puts it back.');
    return true;
}
