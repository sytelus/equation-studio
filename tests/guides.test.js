import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { presets, getPreset, guides } from '../src/presets.js';
import { works, linesOf } from '../src/works.js';
import { catalog, paramSpecs } from '../src/catalog.js';
import { analyzeCode, showable } from '../src/glsl.js';
// Every scene tells its story (About this scene) and offers Try this challenges
// (ui-try.js). These checks keep the data honest: each challenge names a part,
// a setting and a value that exist, and each walk-through step finds its lines.
const LEVELS = ['easy', 'medium', 'expert'];
const ACTIONS = ['set', 'code', 'view', 'show', 'build', 'hide'];
/** Problems with challenge `entry` of a scene whose guide acts on `defaultNode` by default. */
function tryProblems(project, entry, defaultNode) {
    const problems = [], actions = ACTIONS.filter(a => entry[a] !== undefined);
    if (actions.length !== 1) {
        return [`one action expected, got ${actions.join(', ') || 'none'}`];
    }
    if (!entry.text || entry.text.length < 12) {
        problems.push('text missing');
    }
    if (entry.view === 'motion') {
        return problems; // What moves shows the whole picture: no part needed
    }
    const id = entry.hide || entry.node || entry.set?.node || entry.code?.node || defaultNode;
    const node = project.nodes.find(n => n.id === id);
    if (!node) {
        return [...problems, `unknown part ${id}`];
    }
    const specs = paramSpecs(node);
    if (entry.set) {
        const spec = specs[entry.set.param];
        if (!spec) {
            problems.push(`unknown setting ${entry.set.param}`);
        }
        else if (spec.kind === 'number') {
            const value = entry.set.times !== undefined ? node.params[entry.set.param] * entry.set.times : entry.set.value;
            if (!(Number.isFinite(value) && value >= spec.min - 1e-9 && value <= spec.max + 1e-9)) {
                problems.push(`${entry.set.param} = ${value} is outside ${spec.min} … ${spec.max}`);
            }
        }
        else if (!/^#[0-9a-f]{6}$/i.test(entry.set.value)) {
            problems.push(`color ${entry.set.value}`);
        }
    }
    if (entry.code) {
        const text = catalog[node.type].code ? node.params.code : node.params.expression;
        if (typeof text !== 'string' || !text.includes(entry.code.find)) {
            problems.push(`code.find not found: ${entry.code.find}`);
        }
        else if (catalog[node.type].code) {
            try {
                analyzeCode(text.replace(entry.code.find, entry.code.replace));
            }
            catch (e) {
                problems.push(`the changed code does not check: ${e.message}`);
            }
        }
    }
    if (entry.view !== undefined && !['motion', 'stage'].includes(entry.view)) {
        problems.push(`view ${entry.view}`);
    }
    if (entry.build !== undefined && !specs[`steps${entry.build}`]) {
        problems.push(`no loop ${entry.build}`);
    }
    if (entry.show !== undefined && !showable(analyzeCode(node.params.code)).some(item => item.name === entry.show)) {
        problems.push(`no value ${entry.show}`);
    }
    return problems;
}
describe('scene guides', () => {
    it('every work has a level, challenges that apply to its scene, and a walk-through that finds its lines', () => {
        for (const w of works) {
            assert(LEVELS.includes(w.level), `${w.id}: level`);
            assert(w.try.length >= 3, `${w.id}: at least three challenges`);
            const project = getPreset(w.id), node = project.nodes.find(n => n.work === w.id);
            assert(node, `${w.id}: the scene has the work's part`);
            for (const [k, entry] of w.try.entries()) {
                assert.deepEqual(tryProblems(project, entry, node.id), [], `${w.id} challenge ${k + 1}`);
            }
            for (const [k, step] of w.tour.entries()) {
                for (const snippet of step.at || []) {
                    assert(linesOf(w.readable, [snippet]).length, `${w.id} step ${k + 1}: ${snippet}`);
                }
                if (step.show) {
                    assert(showable(analyzeCode(w.readable)).some(item => item.name === step.show), `${w.id} step ${k + 1} shows ${step.show}`);
                }
                for (const loop of Object.keys(step.steps || {})) {
                    assert(paramSpecs(node)[`steps${loop}`], `${w.id} step ${k + 1}: loop ${loop}`);
                }
            }
        }
    });
    it('every construction has a guide with a story, a level and challenges that apply to it', () => {
        const constructions = presets.filter(p => !p.work);
        assert.equal(constructions.length, 12);
        for (const p of constructions) {
            const guide = guides[p.id];
            assert(guide, `${p.id}: a guide`);
            assert(LEVELS.includes(guide.level) && guide.about.length > 200, `${p.id}: level and story`);
            assert(guide.try.length >= 3, `${p.id}: at least three challenges`);
            for (const [k, entry] of guide.try.entries()) {
                assert.deepEqual(tryProblems(getPreset(p.id), entry, null), [], `${p.id} challenge ${k + 1}`);
            }
        }
    });
    it('the first sentence of every part description stands alone', () => {
        for (const [type, def] of Object.entries(catalog)) {
            const first = /^(.+?[.!?])(\s|$)/.exec(def.description)?.[1];
            assert(first && first.split(/\s+/).length <= 14, `${type}: “${first}”`);
        }
    });
});
