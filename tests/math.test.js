import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { texToMathML, expressionToMathML, parseExpression } from '../src/math-render.js';

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
    it('renders every preset expression', async () => {
        const { presets } = await import('../src/presets.js');
        for (const p of presets) {
            for (const n of p.nodes) {
                if (typeof n.params.expression === 'string') {
                    expressionToMathML(n.params.expression);
                }
            }
        }
    });
});
