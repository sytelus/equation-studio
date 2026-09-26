import { catalog } from './catalog.js';
import { clone, validateProject } from './graph.js';
/** Pure helpers behind the editor's exploration tools: parameter sweeps, random
 * variations, and the "original value" each control resets to. No DOM here.
 */
/** Snap a value to a parameter's step and clamp it to its range. */
export function snapToStep(spec, value) {
    const steps = Math.round((value - spec.min) / spec.step);
    const snapped = spec.min + steps * spec.step;
    return Number(Math.min(spec.max, Math.max(spec.min, snapped)).toFixed(6));
}
/** `count` values evenly spread across a numeric parameter's range, snapped to
 * its step, without duplicates (integer parameters may yield fewer).
 */
export function sweepValues(spec, count = 7) {
    if (spec.kind !== 'number' || count < 2) {
        throw new Error('Sweeps need a numeric parameter and at least two samples.');
    }
    const values = [];
    for (let i = 0; i < count; i++) {
        const v = snapToStep(spec, spec.min + (spec.max - spec.min) * i / (count - 1));
        if (!values.includes(v)) {
            values.push(v);
        }
    }
    return values;
}
/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
export function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function perturbColor(hex, amount, random) {
    const channels = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
    const shifted = channels.map(c => Math.round(Math.min(255, Math.max(0, c + (random() * 2 - 1) * amount * 255))));
    return `#${shifted.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}
/** Parameters a variation may change: animated (keyed) parameters are skipped
 * because their keys, not the base value, decide what is shown.
 */
function variableParams(project, node, includeColors) {
    const keyed = new Set(project.tracks.filter(t => t.node === node.id && t.keys.length).map(t => t.param));
    return Object.entries(catalog[node.type].params).filter(([key, spec]) => !keyed.has(key) && (spec.kind === 'number' || (includeColors && spec.kind === 'color')));
}
/** Random variations of one component (`nodeId`) or, with `nodeId` null, of every
 * enabled content component. Each numeric parameter moves by up to `amount` of its
 * range around the current value. Returns [{project, changes}], every project valid.
 */
export function makeVariations(project, { nodeId = null, count = 8, amount = 0.25, seed = 1, includeColors = true } = {}) {
    const random = seededRandom(seed), results = [];
    const targets = project.nodes.filter(n => nodeId ? n.id === nodeId : n.enabled && catalog[n.type].role === 'content');
    if (!targets.length) {
        throw new Error(nodeId ? `Unknown component ${nodeId}.` : 'No enabled components to vary.');
    }
    for (let i = 0; i < count; i++) {
        const next = clone(project), changes = [];
        for (const target of targets) {
            const node = next.nodes.find(n => n.id === target.id);
            for (const [key, spec] of variableParams(next, node, includeColors)) {
                const before = node.params[key];
                node.params[key] = spec.kind === 'color'
                    ? perturbColor(before, amount * 0.6, random)
                    : snapToStep(spec, before + (random() * 2 - 1) * amount * (spec.max - spec.min));
                if (node.params[key] !== before) {
                    changes.push({ node: node.id, param: key, from: before, to: node.params[key] });
                }
            }
        }
        validateProject(next);
        results.push({ project: next, changes });
    }
    return results;
}
/** The value a parameter resets to: its value in the baseline project (the scene
 * as it was opened) when that node exists there, otherwise the catalog default.
 */
export function originalValue(baseline, node, key) {
    const original = baseline?.nodes.find(n => n.id === node.id && n.type === node.type);
    return original && Object.hasOwn(original.params, key) ? original.params[key] : catalog[node.type].params[key].value;
}
/** True when any parameter of `node` differs from its original value. */
export function isModified(baseline, node) {
    return Object.keys(catalog[node.type].params).some(key => node.params[key] !== originalValue(baseline, node, key));
}
