import { catalog, bypassSocket } from './catalog.js';
import { evaluationOrder, consumers } from './graph.js';
/** The construction as a formula sheet (pure; ui-formula.js renders it).
 *
 * compositionTeX() summarizes how the final image is assembled: the combiners
 * (Add light, Front over back, Tint, Mask, Combine scalar fields) are written
 * out as operations and every other component is named, e.g.
 *   Add light = (Gas emission + Central glow) + Folded star lattices.
 * formulaSheet() lists every component in evaluation order with where each input
 * comes from and where the output goes.
 */
const texText = s => String(s).replace(/[\\{}^_$&%#~]/g, ' ').replace(/\s+/g, ' ').trim();
/** A component's name without the " · symbol" suffix some labels carry. */
export function shortLabel(node) {
    return node.label.split(' · ')[0].trim() || node.id;
}
const fmt = v => String(Number(Number(v).toPrecision(3)));
/** TeX for the output of `project` as an expression over its components.
 * Bypassed components are skipped the way the renderer skips them.
 */
export function compositionTeX(project, { maxDepth = 8 } = {}) {
    const byId = new Map(project.nodes.map(n => [n.id, n]));
    const name = n => `\\text{${texText(shortLabel(n))}}`;
    const wrap = (tex, level, parent) => level < parent ? `\\left(${tex}\\right)` : tex;
    function expr(id, depth, parent) {
        const n = byId.get(id);
        if (!n) {
            return '0';
        }
        if (!n.enabled) {
            const socket = bypassSocket(n.type);
            return socket && n.inputs[socket] ? expr(n.inputs[socket], depth, parent) : '0';
        }
        if (depth > maxDepth) {
            return name(n);
        }
        const input = (socket, level) => n.inputs[socket] ? expr(n.inputs[socket], depth + 1, level) : '0';
        switch (n.type) {
            case 'add': {
                const g = n.params.gain;
                const b = input('b', g !== 1 ? 3 : 1);
                return wrap(`${input('a', 1)} + ${g !== 1 ? `${fmt(g)}\\,` : ''}${b}`, 1, parent);
            }
            case 'over': // always parenthesized next to a sum, so "A + B over C" never needs precedence rules
                return wrap(`${input('front', 3)}\\ \\text{over}\\ ${input('back', 3)}`, 0.5, parent);
            case 'tint':
                return `${n.params.gain !== 1 ? `${fmt(n.params.gain)}\\,` : ''}\\text{tint}\\left(${input('layer', 0)}\\right)`;
            case 'mask':
                return `\\text{mask}\\left(${input('layer', 0)},\\ ${input('mask', 0)}\\right)`;
            case 'fieldmath': {
                const { weightA: wa, weightB: wb, product: wp, bias: c } = n.params, terms = [];
                if (wa) {
                    terms.push(`${wa !== 1 ? `${fmt(wa)}\\,` : ''}${input('a', 3)}`);
                }
                if (wb) {
                    terms.push(`${wb !== 1 ? `${fmt(wb)}\\,` : ''}${input('b', 3)}`);
                }
                if (wp) {
                    terms.push(`${wp !== 1 ? `${fmt(wp)}\\,` : ''}${input('a', 3)}\\,${input('b', 3)}`);
                }
                if (c) {
                    terms.push(fmt(c));
                }
                return wrap(terms.join(' + ').replace(/\+ -/g, '- ') || '0', 1, parent);
            }
            default:
                return name(n);
        }
    }
    return `\\text{image} = ${expr(project.output, 0, 0)}`;
}
/** Every component in evaluation order with its inputs and uses:
 * [{node, index, def, inputs: [{socket, kind, symbol, source}], uses: [{node, socket, symbol}], isOutput}].
 */
export function formulaSheet(project) {
    return evaluationOrder(project).map((node, index) => {
        const def = catalog[node.type];
        const inputs = Object.entries(def.inputs).map(([socket, kind]) => ({ socket, kind, symbol: def.inputSymbols[socket] || socket, source: project.nodes.find(n => n.id === node.inputs[socket]) || null }));
        const uses = consumers(project, node.id).map(u => ({ node: u.node, socket: u.socket, symbol: catalog[u.node.type].inputSymbols[u.socket] || u.socket }));
        return { node, index, def, inputs, uses, isOutput: project.output === node.id };
    });
}
