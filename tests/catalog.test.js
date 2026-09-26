import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, bypassSocket, insertableTypes, replacementTypes, emitPreview, typeLabels } from '../src/catalog.js';
import { texToMathML } from '../src/math-render.js';

const ROLES = ['source', 'modifier', 'combine', 'content'];
const TYPES = Object.keys(typeLabels);

describe('component catalog', () => {
    for (const [type, def] of Object.entries(catalog)) {
        it(`${type}: documented, typeset and consistent`, () => {
            assert(ROLES.includes(def.role), `role ${def.role}`);
            assert(TYPES.includes(def.output));
            assert(Array.isArray(def.tex) && def.tex.length > 0, 'has typeset equation lines');
            const tex = def.tex.join(' ');
            for (const line of def.tex) {
                texToMathML(line); // throws on unsupported TeX
            }
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
            for (const socket of Object.keys(def.inputSymbols)) {
                assert(Object.hasOwn(def.inputs, socket), `input symbol for unknown socket ${socket}`);
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
