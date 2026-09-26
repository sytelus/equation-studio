import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, bypassSocket, insertableTypes, replacementTypes, emitPreview, typeLabels, parameterDefaults } from '../src/catalog.js';
import { texToMathML, symbolKey } from '../src/math-render.js';
import { concepts, concept } from '../src/concepts.js';
import { plotSVG, sample, ticks } from '../src/plot.js';

const ROLES = ['source', 'modifier', 'combine', 'content'];
const TYPES = Object.keys(typeLabels);

describe('component catalog', () => {
    for (const [type, def] of Object.entries(catalog)) {
        it(`${type}: documented, typeset and consistent`, () => {
            assert(ROLES.includes(def.role), `role ${def.role}`);
            assert(TYPES.includes(def.output));
            assert(Array.isArray(def.steps) && def.steps.length > 0, 'has equation steps');
            assert.deepEqual(def.tex, def.steps.map(s => s.tex), 'tex is derived from the steps');
            for (const s of def.steps) {
                texToMathML(s.tex); // throws on unsupported TeX
                assert(typeof s.text === 'string' && s.text.length > 25, `step explains itself: ${s.tex}`);
                assert(/[.!?)]$/.test(s.text.trim()), `step text is a sentence: ${s.text}`);
            }
            const tex = def.tex.join(' '), keys = symbolKey(tex);
            for (const [symbol, meaning] of def.notes) {
                texToMathML(symbol, { display: false });
                assert(meaning.length > 3);
            }
            for (const [key, spec] of Object.entries(def.params)) {
                assert(spec.help && spec.help.length > 15, `${key} has help text`);
                if (spec.kind === 'expression') {
                    continue;
                }
                assert(spec.symbol, `${key} has a symbol`);
                texToMathML(spec.symbol, { display: false });
                assert(tex.includes(spec.symbol), `${key} symbol ${spec.symbol} appears in the equation`);
                if (spec.kind === 'number') {
                    assert(spec.min < spec.max && spec.step > 0 && spec.value >= spec.min && spec.value <= spec.max, `${key} range`);
                }
            }
            for (const symbol of def.outputSymbols) {
                assert(keys.includes(symbolKey(symbol)), `output symbol ${symbol} appears in the steps`);
            }
            for (const socket of Object.keys(def.inputSymbols)) {
                assert(Object.hasOwn(def.inputs, socket), `input symbol for unknown socket ${socket}`);
            }
            for (const id of def.concepts) {
                concept(id); // throws on unknown ids
            }
            if (def.bypass) {
                assert.equal(def.inputs[def.bypass], def.output, 'a bypass socket carries the output type');
                assert.notEqual(def.role, 'content', 'content components have no bypass');
            }
            assert.equal(bypassSocket(type), def.bypass);
        });
    }
    it('parameter symbols are unique within a component', () => {
        for (const [type, def] of Object.entries(catalog)) {
            const symbols = Object.values(def.params).map(s => s.symbol).filter(Boolean);
            assert.equal(new Set(symbols).size, symbols.length, type);
        }
    });
    it('curves evaluate to finite numbers at the defaults and at the parameter extremes', () => {
        for (const [type, def] of Object.entries(catalog)) {
            if (!def.curve) {
                continue;
            }
            const c = def.curve, defaults = parameterDefaults(type);
            const extremes = [defaults, ...['min', 'max'].map(end => Object.fromEntries(Object.entries(def.params).map(([k, s]) => [k, s.kind === 'number' ? s[end] : s.value])))];
            for (const P of extremes) {
                const domain = c.domain(P);
                assert(domain[0] < domain[1], `${type} domain`);
                const series = c.bars ? [{ bars: c.bars(P) }] : c.series.map(s => ({ ...s, f: x => s.f(x, P) }));
                for (const s of series) {
                    const points = s.bars || sample(s.f, domain, 40);
                    assert(points.length > 0 && points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), `${type} finite curve`);
                }
                assert(plotSVG({ series, domain, range: c.range?.(P) || null, xLabel: c.x, yLabel: c.y, marks: c.marks?.(P) || [] }).startsWith('<svg'));
            }
            assert(c.title && c.x && c.y, `${type} curve is labelled`);
        }
    });
    it('every component that has a key one-dimensional function shows it', () => {
        for (const type of ['vortex', 'disc', 'ring', 'threshold', 'palette', 'nebulaCloud', 'nebulaStars', 'lens', 'tidal', 'feather']) {
            assert(catalog[type].curve, type);
        }
    });
    it('insertable types are modifiers that pass the wire type through', () => {
        assert.deepEqual(insertableTypes('coord').sort(), ['domainwarp', 'kaleidoscope', 'lens', 'polar', 'transform', 'vectorExpression', 'vortex']);
        assert(insertableTypes('layer').includes('tint') && insertableTypes('layer').includes('mask'));
        assert.deepEqual(insertableTypes('geometry'), []);
    });
    it('replacement types share the output type', () => {
        assert(replacementTypes('nebulaGeometry').includes('ringGeometry'));
        assert(!replacementTypes('nebulaGeometry').includes('nebulaGeometry'));
        for (const t of replacementTypes('palette')) {
            assert.equal(catalog[t].output, 'layer');
        }
    });
    it('GLSL previews use readable names', () => {
        assert.equal(emitPreview('disc'), 'softInside(length(p)-radius,edge)');
        assert.equal(emitPreview('expression', { expression: 'x*2.0' }), 'x*2.0');
    });
});

describe('concepts', () => {
    it('each concept is explained and its formula and plot render', () => {
        for (const [id, c] of Object.entries(concepts)) {
            assert(c.title && c.text.length > 60, id);
            if (c.tex) {
                texToMathML(c.tex);
            }
            if (c.plot) {
                const k = c.knob ? c.knob.value : undefined;
                const options = c.plot(k);
                assert(options.series.length && options.domain[0] < options.domain[1], id);
                assert(plotSVG(options).includes('<path'), id);
                if (c.knob) {
                    assert(c.knob.min <= c.knob.value && c.knob.value <= c.knob.max && c.knob.step > 0, `${id} knob`);
                    plotSVG(c.plot(c.knob.min));
                    plotSVG(c.plot(c.knob.max));
                }
            }
        }
    });
    it('every concept is used by at least one component', () => {
        const used = new Set(Object.values(catalog).flatMap(d => d.concepts));
        for (const id of Object.keys(concepts)) {
            assert(used.has(id), id);
        }
    });
    it('rejects unknown concept ids', () => {
        assert.throws(() => concept('nope'), /Unknown concept/);
    });
});

describe('plots', () => {
    it('picks round ticks', () => {
        assert.deepEqual(ticks(0, 1, 4), [0, 0.25, 0.5, 0.75, 1]);
        assert.deepEqual(ticks(-2, 2, 4), [-2, -1, 0, 1, 2]);
    });
    it('skips nonfinite samples and marks parameters', () => {
        assert.equal(sample(x => 1 / x, [-1, 1], 3).length, 2);
        const svg = plotSVG({ series: [{ f: x => x * x, label: 'x²' }], domain: [-1, 1], marks: [{ x: 0.5, label: 'a' }], xLabel: 'x', yLabel: 'y' });
        assert(svg.includes('class="mark"') && svg.includes('x²') && svg.includes('viewBox'));
    });
    it('draws bar series', () => {
        assert(plotSVG({ series: [{ bars: [[0, 1], [1, 0.5]] }], domain: [-0.5, 1.5] }).includes('<rect'));
    });
});
