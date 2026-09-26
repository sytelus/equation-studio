import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { texToMathML, expressionToMathML, texSegments, texToMathMLSegments, numberMathML, symbolKey, nameMathML, programToMathML } from '../src/math-render.js';
import { parseExpression } from '../src/expression.js';

describe('TeX to MathML', () => {
    it('wraps output in a math element', () => {
        assert.equal(texToMathML('x'), '<math display="block"><mi>x</mi></math>');
        assert.equal(texToMathML('x', { display: false }), '<math><mi>x</mi></math>');
    });
    it('renders fractions, roots, scripts and Greek letters', () => {
        assert.equal(texToMathML('\\frac{a}{b}', { display: false }), '<math><mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac></math>');
        assert(texToMathML('\\sqrt{x}').includes('<msqrt><mrow><mi>x</mi></mrow></msqrt>'));
        assert(texToMathML('x_s^2').includes('<msubsup><mi>x</mi><mi>s</mi><mn>2</mn></msubsup>'));
        assert(texToMathML('\\eta + \\Delta').includes('<mi>η</mi><mo>+</mo><mi>Δ</mi>'));
    });
    it('uses under/over limits for big operators', () => {
        assert(texToMathML('\\sum_{s=1}^{N} s').includes('<munderover><mo largeop="true" movablelimits="false">∑</mo>'));
    });
    it('renders text, upright names, functions and escapes', () => {
        const xml = texToMathML('\\text{a<b} + \\operatorname{mix}(x) + \\cos x - y');
        assert(xml.includes('<mtext>a&lt;b</mtext>'));
        assert(xml.includes('<mi mathvariant="normal">mix</mi>'));
        assert(xml.includes('<mi mathvariant="normal">cos</mi>'));
        assert(xml.includes('<mo>−</mo>'), 'minus sign, not hyphen');
    });
    it('ignores \\left and \\right sizing but keeps the delimiters', () => {
        assert(texToMathML('\\left(x\\right)').includes('<mo>(</mo><mi>x</mi><mo>)</mo>'));
    });
    it('rejects unsupported or unbalanced input', () => {
        assert.throws(() => texToMathML('\\begin{matrix}'), /Unsupported TeX command/);
        assert.throws(() => texToMathML('{x'), /Unclosed/);
        assert.throws(() => texToMathML('x}'), /Unbalanced/);
        assert.throws(() => texToMathML('x^'), /Missing argument/);
    });
});

describe('GLSL expressions to MathML', () => {
    it('parses the documented grammar with correct precedence', () => {
        const tree = parseExpression('a + b * c');
        assert.equal(tree.op, '+');
        assert.equal(tree.right.op, '*');
        assert.equal(parseExpression('x > 0.0 ? 1.0 : 0.0').type, 'ternary');
        assert.equal(parseExpression('p.x').type, 'member');
        assert.equal(parseExpression('-x').type, 'unary');
    });
    it('reports syntax errors', () => {
        assert.throws(() => parseExpression('sin(x'), /Expected/);
        assert.throws(() => parseExpression('x +'), /Unexpected end/);
        assert.throws(() => parseExpression('x $ y'), /Unexpected character/);
        assert.throws(() => parseExpression('x y'), /Unexpected/);
    });
    it('renders division, powers, roots, absolute values and tuples as mathematics', () => {
        assert(expressionToMathML('a/b').includes('<mfrac><mi>a</mi><mi>b</mi></mfrac>'));
        assert(expressionToMathML('pow(x, 2.0)').includes('<msup><mi>x</mi><mn>2</mn></msup>'));
        assert(expressionToMathML('sqrt(x)').includes('<msqrt><mi>x</mi></msqrt>'));
        assert(expressionToMathML('length(p)').includes('<mo>|</mo><mi>p</mi><mo>|</mo>'));
        assert(expressionToMathML('vec2(x, y)').includes('<mo>(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>)</mo>'));
        assert(expressionToMathML('exp(-r)').includes('<msup><mi mathvariant="normal">e</mi>'));
    });
    it('shows theta as θ, trims float literals and juxtaposes coefficients', () => {
        const xml = expressionToMathML('3.0*theta');
        assert(xml.includes('<mn>3</mn><mo>&#x2062;</mo><mi>θ</mi>'));
    });
    it('keeps only the parentheses the meaning needs', () => {
        assert(expressionToMathML('(a + b) * c').includes('<mo>(</mo><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo>)</mo>'));
        assert(!expressionToMathML('(a * b) + c').includes('<mo>(</mo>'));
        assert(expressionToMathML('a - (b - c)').includes('<mo>(</mo>'), 'right side of a subtraction keeps its parentheses');
    });
    it('adds a left-hand side when requested', () => {
        assert(expressionToMathML('x', '<mi>f</mi>').startsWith('<math display="block"><mrow><mi>f</mi><mo>=</mo>'));
    });
    it('renders every preset and starter equation', async () => {
        const { presets } = await import('../src/presets.js');
        const { catalog } = await import('../src/catalog.js');
        const sources = [...presets.flatMap(p => p.nodes.map(n => n.params.expression)), ...Object.values(catalog).map(d => d.params.expression?.value)];
        for (const source of sources.filter(s => typeof s === 'string')) {
            const rows = programToMathML(source);
            assert.equal(rows.at(-1).kind, 'result');
            assert(rows.every(r => r.mathml.startsWith('<math') && r.text), `every line has a caption: ${source}`);
        }
    });
    it('renders ^ as a superscript and a program’s result line', () => {
        assert(expressionToMathML('x^2').includes('<msup><mi>x</mi><mn>2</mn></msup>'));
        assert(expressionToMathML('(x + 1)^2').includes('<msup><mrow><mo>(</mo>'));
        assert(expressionToMathML('param k = 2\nk*x').includes('<mi mathvariant="normal">k</mi>') === false);
    });
});

describe('typesetting for explanation', () => {
    it('spaces operator names like TeX and keeps spaces at the ends of text', () => {
        const xml = texToMathML('M = \\arccos\\cos(\\text{rotated, scaled } p) + 4\\cos b', { display: false });
        assert(xml.includes('<mi mathvariant="normal">arccos</mi><mspace width="0.167em"></mspace><mi mathvariant="normal">cos</mi><mo>(</mo>'), 'arccos cos, then no space before (');
        assert(xml.includes('<mtext>rotated, scaled </mtext>'), 'a trailing space survives');
        assert(xml.includes('<mn>4</mn><mspace width="0.167em"></mspace><mi mathvariant="normal">cos</mi><mspace width="0.167em"></mspace><mi>b</mi>'));
        assert(texToMathML('\\cos\\left(x\\right)').includes('<mi mathvariant="normal">cos</mi><mo>(</mo>'));
    });
    it('annotates symbols by role and can substitute parameter values', () => {
        const symbols = { '\\kappa': { role: 'param', param: 'strength', value: 4 }, 'c_x': { role: 'param', param: 'x', value: -0.25 }, p: { role: 'input', type: 'coord', socket: 'p' }, q: { role: 'output', type: 'coord' }, t: { role: 'time' } };
        const xml = texToMathML('q = \\kappa\\, p + c_{x} + \\omega t', { symbols });
        assert(xml.includes('<mrow class="sym sym-output coord"><mi>q</mi></mrow>'));
        assert(xml.includes('<mrow class="sym sym-param" data-param="strength"><mi>κ</mi></mrow>'));
        assert(xml.includes('<mrow class="sym sym-input coord" data-socket="p"><mi>p</mi></mrow>'));
        assert(xml.includes('<mrow class="sym sym-param" data-param="x"><msub><mi>c</mi><mrow><mi>x</mi></mrow></msub></mrow>'), 'braces do not matter when matching');
        assert(xml.includes('<mrow class="sym sym-time"><mi>t</mi></mrow>'));
        assert(!xml.includes('ω</mi></mrow>'), 'unknown symbols stay plain');
        const values = texToMathML('q = \\kappa\\, p + c_x', { symbols, values: true });
        assert(values.includes('data-param="strength"><mn>4</mn></mrow>'));
        assert(values.includes('data-param="x"><mrow><mo>(</mo><mo>−</mo><mn>0.25</mn><mo>)</mo></mrow></mrow>'), 'negative values are parenthesized');
        assert.equal(numberMathML(0.123456), '<mn>0.1235</mn>');
        assert.equal(symbolKey('c_{x} '), 'c_x');
    });
    it('splits long lines at top-level quads only', () => {
        assert.deepEqual(texSegments('a = 1, \\quad b = 2'), ['a = 1', 'b = 2']);
        assert.deepEqual(texSegments('f\\left(a \\quad b\\right) \\qquad g'), ['f\\left(a \\quad b\\right)', 'g']);
        assert.deepEqual(texSegments('{a \\quad b}'), ['{a \\quad b}']);
        const segments = texToMathMLSegments('x = 1, \\quad y = 2');
        assert.equal(segments.length, 2);
        assert(segments.every(s => s.startsWith('<math displaystyle="true">')));
    });
    it('typesets names and multi-line programs with captions', () => {
        assert.equal(nameMathML('theta'), '<mi>θ</mi>');
        assert.equal(nameMathML('w_0'), '<msub><mi>w</mi><mn>0</mn></msub>');
        assert.equal(nameMathML('k_theta'), '<msub><mi>k</mi><mi>θ</mi></msub>');
        assert.equal(nameMathML('radius'), '<mi mathvariant="normal">radius</mi>');
        const lines = programToMathML('param w = 0.1 [0.01, 1]\nd = length(p) - 1 // distance to the circle\nexp(-(d/w)^2) // a bump', '<mi>f</mi>', { symbols: { w: { role: 'param', param: 'w', value: 0.1 } } });
        assert.deepEqual(lines.map(l => [l.kind, l.name, l.text]), [['define', 'd', 'distance to the circle'], ['result', null, 'a bump']]);
        assert(lines[0].mathml.includes('<mi>d</mi><mo>=</mo>'));
        assert(lines[1].mathml.includes('data-param="w"'));
        assert(lines[1].mathml.startsWith('<math displaystyle="true"><mrow><mi>f</mi><mo>=</mo>'));
    });
});
