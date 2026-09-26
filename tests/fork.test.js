import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, paramSpecs } from '../src/catalog.js';
import { forkable, forkBlocker, forkProgram, symbolName, equationSource, withEquation } from '../src/fork.js';
import { makeNode, validateProject } from '../src/graph.js';
import { compileProgram } from '../src/compiler.js';
import { getPreset } from '../src/presets.js';
import { parseExpression, parseProgram, formatExpression, checkProgram } from '../src/expression.js';

describe('components as equations', () => {
    it('knows which components fit a custom equation, and says why not', () => {
        const yes = Object.keys(catalog).filter(forkable);
        for (const type of ['transform', 'vortex', 'disc', 'threshold', 'fieldmath', 'palette', 'planet', 'nebulaStars', 'nebulaCore']) {
            assert(yes.includes(type), type);
        }
        for (const type of ['nebulaGeometry', 'nebulaCloud', 'tint', 'add', 'over', 'mask', 'geometryField', 'expression', 'coordinates']) {
            assert(!yes.includes(type), type);
        }
        assert.match(forkBlocker('tint'), /color layer/);
        assert.match(forkBlocker('nebulaGeometry'), /geometry bundle/);
        assert.match(forkBlocker('coordinates'), /pixel coordinates/);
        assert.equal(forkBlocker('expression'), null, 'a custom equation is already editable');
        assert.equal(forkBlocker('vortex'), null);
    });
    it('names parameters after their symbols when the name is free', () => {
        assert.equal(symbolName('\\kappa'), 'kappa');
        assert.equal(symbolName('k_\\theta'), 'k_theta');
        assert.equal(symbolName('c_x'), 'c_x');
        assert.equal(symbolName('H_{\\text{gas}}'), null);
        const vortex = forkProgram(makeNode('vortex', 'v', { p: 'space' }));
        assert.deepEqual(vortex.renames, { strength: 'kappa', radius: 'rho', speed: 'omega' });
        assert(vortex.expression.includes('param kappa = 4 [-16, 16] step 0.1  // Twist: Rotation at the center in radians;'));
        const disc = forkProgram(makeNode('disc', 'd', { p: 'space' }));
        assert.equal(disc.renames.radius, 'radius', 'r is taken by the polar radius of p');
        const transform = forkProgram(makeNode('transform', 't', { p: 'space' }));
        assert.equal(transform.renames.angle, 'angle', 'theta is taken');
    });
    it('writes the steps out as equation lines where the catalog has a source', () => {
        const vortex = forkProgram(makeNode('vortex', 'v', { p: 'space' })).expression.split('\n');
        assert(vortex[0].startsWith('// Localized vortex, written as an equation'));
        assert(vortex.some(l => l.startsWith('alpha = kappa*exp(-(r/rho)^2) + omega*t')));
        assert(vortex.at(-1).startsWith('rotate2(p, alpha)'));
        const program = parseProgram(forkProgram(makeNode('kaleidoscope', 'k', { p: 'space' })).expression);
        assert.deepEqual(program.definitions.map(d => d.name), ['w', 'phi']);
        assert(program.definitions.every(d => d.comment), 'every line keeps its caption');
        const stars = forkProgram(makeNode('nebulaStars', 's', { p: 'space' })).expression.split('\n');
        assert(stars.at(-2).includes('nebulaStars() is a function of the shader library'));
        assert(stars.at(-1).startsWith('nebulaStars(p, L, g)'));
    });
    it('catalog sources use only the component’s parameters and inputs', () => {
        for (const [type, d] of Object.entries(catalog)) {
            if (!d.source) {
                continue;
            }
            assert(forkable(type), `${type} has a source but cannot be forked`);
            const used = new Set(d.source.join('\n').match(/\$(\w+)/g).map(m => m.slice(1)));
            for (const key of used) {
                assert(Object.hasOwn(d.params, key), `${type}: $${key}`);
            }
            assert(!d.source.at(-1).match(/^\s*[A-Za-z_]\w*\s*=(?!=)/), `${type}: the last line is the result`);
        }
    });
    it('maps sockets to p, a and b and keeps the values', () => {
        const node = makeNode('threshold', 'th', { field: 'noise' }, { level: 0.7, sharpness: 12 });
        const fork = forkProgram(node);
        assert.equal(fork.type, 'expression');
        assert.deepEqual(fork.inputs, { a: 'noise' });
        assert.equal(fork.params.ell, 0.7);
        assert.equal(fork.params.s, 12);
        assert.throws(() => forkProgram(makeNode('tint', 'x')), /cannot become an equation/);
    });
    it('every forkable component becomes a valid equation in a project', () => {
        for (const type of Object.keys(catalog).filter(forkable)) {
            const p = getPreset('marble'), d = catalog[type];
            p.nodes.push(makeNode('noise', 'scalarA', { p: 'space' }));
            const inputs = Object.fromEntries(Object.entries(d.inputs).map(([s, k]) => [s, k === 'coord' ? 'space' : 'scalarA']));
            const fork = forkProgram(makeNode(type, 'target', inputs));
            p.nodes.push({ id: 'target', type: fork.type, label: 'fork', inputs: fork.inputs, params: fork.params, enabled: true });
            validateProject(p);
            const program = compileProgram(p);
            assert(program.fragment.includes('equation_n'), type);
            assert.deepEqual(Object.keys(paramSpecs(p.nodes.at(-1))).sort(), ['expression', ...Object.values(fork.renames)].sort(), type);
        }
    });
    it('formats expressions with the parentheses they need', () => {
        const f = s => formatExpression(parseExpression(s));
        assert.equal(f('softInside(length(p)-radius,edge)'), 'softInside(length(p) - radius, edge)');
        assert.equal(f('(a+b)*c'), '(a + b)*c');
        assert.equal(f('a-(b-c)'), 'a - (b - c)');
        assert.equal(f('a/(b*c)'), 'a/(b*c)');
        assert.equal(f('-(x^2)'), '-x^2');
        assert.equal(f('(-x)^2'), '(-x)^2');
        assert.equal(f('x>0.0?1.0:0.0'), 'x > 0.0 ? 1.0 : 0.0');
        assert.equal(checkProgram(f('vec4(mix(p.xyx,p.yxy,pow(clamp(a,0.0,1.0),2.0))*b,1)'), null).resultType, 'vec4');
    });
});

describe('putting an equation into a component', () => {
    it('turns a built-in component into its equation, keeping wiring, values and animation', () => {
        const p = getPreset('lensing'), lens = p.nodes.find(n => n.id === 'lens');
        const source = equationSource(lens);
        const q = withEquation(p, 'lens', source);
        const node = q.nodes.find(n => n.id === 'lens');
        assert.equal(node.type, 'vectorExpression');
        assert.equal(node.label, `${lens.label} · equation`);
        assert.deepEqual(node.inputs, { p: lens.inputs.p });
        assert.equal(node.params.k, lens.params.strength);
        assert.deepEqual(q.tracks.map(t => [t.node, t.param]), [['lens', 'k']], 'the animation follows the rename');
        validateProject(q);
        assert.equal(p.nodes.find(n => n.id === 'lens').type, 'lens', 'the original project is untouched');
    });
    it('keeps values whose param line is unchanged and takes edited defaults', () => {
        const p = getPreset('kaleidoscope'), petals = p.nodes.find(n => n.id === 'petals');
        p.nodes.find(n => n.id === 'petals').params.bands = 20; // moved with the slider
        const source = petals.params.expression;
        const same = withEquation(p, 'petals', source.replace('wave^sharpness', 'wave^sharpness*0.5'));
        assert.equal(same.nodes.find(n => n.id === 'petals').params.bands, 20, 'the slider value survives an unrelated edit');
        const edited = withEquation(p, 'petals', source.replace('param bands = 14', 'param bands = 30'));
        assert.equal(edited.nodes.find(n => n.id === 'petals').params.bands, 30, 'an edited default is taken');
        const removed = withEquation(p, 'petals', source.replace(/param bend.*\n/, '').replace('bend*y', '9*y'));
        assert(!Object.hasOwn(removed.nodes.find(n => n.id === 'petals').params, 'bend'));
    });
    it('drops tracks of removed parameters and clamps keys to new ranges', () => {
        const p = getPreset('kaleidoscope');
        p.tracks = [{ node: 'petals', param: 'bands', interpolation: 'linear', keys: [{ time: 0, value: 14 }, { time: 1, value: 40 }] }, { node: 'petals', param: 'bend', interpolation: 'linear', keys: [{ time: 0, value: 9 }] }];
        const source = p.nodes.find(n => n.id === 'petals').params.expression.replace('[1, 40]', '[1, 20]').replace(/param bend.*\n/, '').replace('bend*y', '9*y');
        const q = withEquation(p, 'petals', source);
        assert.deepEqual(q.tracks.map(t => t.param), ['bands']);
        assert.deepEqual(q.tracks[0].keys.map(k => k.value), [14, 20]);
        validateProject(q);
    });
    it('rejects an invalid equation and a component that cannot be one', () => {
        const p = getPreset('kaleidoscope');
        assert.throws(() => withEquation(p, 'petals', 'wave^'), /Line 1/);
        assert.throws(() => withEquation(getPreset('bipolar'), 'shell', 'x'), /cannot become an equation/);
        assert.throws(() => withEquation(p, 'nope', 'x'), /Unknown component/);
    });
});
