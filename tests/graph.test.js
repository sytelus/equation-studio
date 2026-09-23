import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, parameterDefaults } from '../src/catalog.js';
import { presets, getPreset } from '../src/presets.js';
import { makeNode, clone, validateProject, parseProject, topologicalOrder, removeNode, uniqueId, History, validateExpression, upstream, downstream, MAX_NODES, MAX_LABEL, VIEW_LIMITS } from '../src/graph.js';

describe('presets and catalog', () => {
    for (const p of presets) {
        it(`preset validates: ${p.id}`, () => {
            assert.equal(validateProject(p), p);
        });
    }
    it('preset clones do not mutate originals', () => {
        const p = getPreset('bipolar');
        p.nodes[1].params.pinch = .5;
        assert.equal(getPreset('bipolar').nodes[1].params.pinch, .3);
    });
    it('catalog defaults cover every parameter and every entry is documented', () => {
        for (const [type, def] of Object.entries(catalog)) {
            assert(def.description.length > 20, type);
            assert(def.equation.length > 5, type);
            assert.deepEqual(Object.keys(parameterDefaults(type)), Object.keys(def.params));
        }
    });
    it('unknown catalog type fails', () => {
        assert.throws(() => makeNode('not-a-type', 'x'));
    });
});

describe('project validation', () => {
    const broken = (edit, pattern) => {
        const p = getPreset('bipolar');
        edit(p);
        assert.throws(() => validateProject(p), pattern);
    };
    it('duplicate node id fails', () => broken(p => p.nodes.push(clone(p.nodes[0])), /duplicate/));
    it('invalid id cannot inject GLSL', () => broken(p => p.nodes[0].id = 'x; discard', /Invalid/));
    it('wrong socket type fails', () => broken(p => p.nodes.find(n => n.id === 'gas').inputs.geometry = 'stars', /expects geometry/));
    it('dangling socket fails', () => broken(p => p.nodes[1].inputs.p = 'missing', /Missing input/));
    it('cycles including disconnected nodes fail', () => broken(p => p.nodes.push(makeNode('transform', 'loopA', { p: 'loopB' }), makeNode('transform', 'loopB', { p: 'loopA' })), /Cycle/));
    it('self-cycle fails', () => broken(p => p.nodes.push(makeNode('transform', 'loop', { p: 'loop' })), /Cycle/));
    it('unknown params fail', () => broken(p => p.nodes[1].params.unexpected = 1, /Unknown parameter/));
    it('nonfinite parameters fail', () => broken(p => p.nodes[1].params.pinch = NaN, /finite/));
    it('out of range parameters fail', () => broken(p => p.nodes[1].params.pinch = -1, /finite/));
    it('bad exposure, duration and zoom fail', () => {
        broken(p => p.exposure = 9);
        broken(p => p.duration = 0);
        broken(p => p.view.zoom = 0);
        broken(p => p.view.x = VIEW_LIMITS.pan[1] + 1);
    });
    it('over-long labels and titles fail', () => {
        broken(p => p.title = 'x'.repeat(MAX_LABEL + 1), /title/);
        broken(p => p.nodes[0].label = 'x'.repeat(MAX_LABEL + 1), /label/);
    });
    it('parse rejects schema and oversize data', () => {
        assert.throws(() => parseProject('{"schemaVersion":2}'));
        assert.throws(() => parseProject('x'.repeat(1_000_001)), /1 MB/);
    });
    it('unknown output fails', () => broken(p => p.output = 'bad', /output/));
    it('graph size is bounded', () => {
        const p = getPreset('bipolar');
        while (p.nodes.length <= MAX_NODES) {
            p.nodes.push(makeNode('solid', `s${p.nodes.length}`));
        }
        assert.throws(() => validateProject(p), /components/);
    });
    it('color tracks are not silently accepted', () => {
        const p = getPreset('peacock');
        p.tracks = [{ node: 'background', param: 'color', interpolation: 'linear', keys: [] }];
        assert.throws(() => validateProject(p), /track/);
    });
});

describe('graph traversal', () => {
    it('topological order ends with the target and visits shared inputs once', () => {
        const order = topologicalOrder(getPreset('bipolar')).map(n => n.id);
        assert.equal(order.at(-1), 'final');
        assert.equal(order.filter(id => id === 'turbulence').length, 1);
        assert(order.indexOf('turbulence') < order.indexOf('cloud'));
    });
    it('a disabled node does not pull in its inputs', () => {
        const p = getPreset('bipolar');
        p.nodes.find(n => n.id === p.output).enabled = false;
        assert.deepEqual(topologicalOrder(p).map(n => n.id), ['final']);
    });
    it('null target orders every node, including unreachable ones', () => {
        const p = getPreset('bipolar');
        p.nodes.push(makeNode('solid', 'unused'));
        const order = topologicalOrder(p, null).map(n => n.id);
        assert.equal(order.length, p.nodes.length);
        assert(order.includes('unused'));
    });
    it('upstream and downstream sets are transitive', () => {
        const p = getPreset('bipolar');
        assert.deepEqual([...upstream(p, 'gas')].sort(), ['cloud', 'shell', 'space', 'turbulence']);
        assert.deepEqual([...downstream(p, 'shell')].sort(), ['cloud', 'core', 'final', 'gas', 'gascore', 'turbulence']);
        assert.equal(upstream(p, 'space').size, 0);
        assert.equal(downstream(p, 'final').size, 0);
    });
});

describe('custom expressions', () => {
    it('lexical restrictions reject statements and injection', () => {
        for (const s of ['return 1.0;', 'for(;;){}', 'x = 2.0', 'x++', 'x/*hide*/', 'window.alert(1);', 'vec3[2](1)', '#define x y', '']) {
            assert.throws(() => validateExpression(s), s);
        }
    });
    it('comparisons, ternaries and whitespace are allowed', () => {
        for (const s of ['x >= 0.0 ? 1.0 : 0.0', 'a == b ? 0.0 : 1.0', 'sin( x + t )', 'vec2(x,y)']) {
            assert.equal(validateExpression(s), s);
        }
    });
});

describe('editing helpers', () => {
    it('delete removes downstream references and tracks', () => {
        const p = getPreset('lensing');
        removeNode(p, 'lens');
        assert(!p.nodes.find(n => n.id === 'sourcePosition').inputs.p);
        assert.equal(p.tracks.length, 0);
        validateProject(p);
    });
    it('delete of the output chooses an existing fallback', () => {
        const p = getPreset('bipolar');
        removeNode(p, 'final');
        assert(p.nodes.some(n => n.id === p.output));
    });
    it('cannot delete the final remaining node', () => {
        const p = getPreset('bipolar');
        p.nodes = [makeNode('solid', 'only')];
        p.output = 'only';
        assert.throws(() => removeNode(p, 'only'));
    });
    it('unique ids skip existing identifiers', () => {
        const p = getPreset('bipolar');
        p.nodes.push(makeNode('solid', 'solid1'));
        assert.equal(uniqueId(p, 'solid'), 'solid2');
    });
    it('history undo / redo snapshots are independent', () => {
        const h = new History(2), a = getPreset('bipolar');
        h.push(a);
        a.title = 'new';
        const old = h.undo(a);
        assert.equal(old.title, 'Bipolar nebula');
        assert.equal(h.redo(old).title, 'new');
    });
    it('new edit invalidates redo', () => {
        const h = new History();
        h.push(getPreset('bipolar'));
        h.undo(getPreset('water'));
        h.push(getPreset('water'));
        assert.equal(h.redo(getPreset('water')), null);
    });
    it('history honors its limit', () => {
        const h = new History(3);
        for (let i = 0; i < 5; i++) {
            h.push({ ...getPreset('fire'), title: `t${i}` });
        }
        assert.equal(h.past.length, 3);
        assert.equal(h.past[0].title, 't2');
    });
});
