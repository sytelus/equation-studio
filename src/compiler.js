import { catalog, zeroByType, bypassSocket } from './catalog.js';
import { validateProject, topologicalOrder } from './graph.js';
import { mathGLSL } from './math-glsl.js';
import { nebulaGLSL } from './nebula-glsl.js';
import { motifsGLSL } from './motifs-glsl.js';
/** Typed DAG → one fused GLSL ES 3.00 fragment shader.
 *
 * Every reachable node becomes one local variable inside `shade()`. A disabled
 * node is bypassed: it forwards its catalog `bypass` input unchanged, or yields a
 * typed zero when it has none (content such as a star field). Numeric and
 * color parameters become uniforms, so value edits never recompile. Only the
 * structure (types, wiring, enabled flags, custom expressions, compile mode)
 * changes the generated source.
 *
 * Compile modes (see `compileGraph` options):
 *   default       the target's value, converted for display (diagnostic
 *                 false color for non-layer types)
 *   raw           the target's numeric value without any conversion; used by
 *                 float probes
 *   contribution  the target with and without one node (bypassed, exactly as if
 *                 it were disabled), shown as a highlight or signed-difference
 *                 view of the pixels it changes
 *   preview       every node computed once; `u_previewIndex` selects which
 *                 one is shown, so all graph thumbnails share one program
 */
const glslTypes = { coord: 'vec2', scalar: 'float', geometry: 'Geometry', layer: 'vec4' };
const expressionTypes = { expression: 'float', vectorExpression: 'vec2', colorExpression: 'vec3' };
export const CONTRIBUTION_STYLES = ['highlight', 'signed'];
export const vertexSource = `#version 300 es
precision highp float;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
/** Convert a typed node value to vec4. Non-layer types get a lossy diagnostic
 * false-color view unless `raw` is requested (see ARCHITECTURE.md).
 */
function toVec4(type, name, raw) {
    if (type === 'scalar') {
        return raw ? `vec4(${name},0,0,1)` : `vec4(vec3(0.5+0.5*tanh(${name})),1)`;
    }
    if (type === 'coord') {
        return raw ? `vec4(${name},0,1)` : `vec4(0.5+0.5*sin(${name}.x),0.5+0.5*sin(${name}.y),0.5,1)`;
    }
    if (type === 'geometry') {
        return raw ? `vec4(${name}.warp,${name}.rim,${name}.coverage,1)` : `vec4(${name}.rim*4.0,${name}.coverage,0.5+0.5*tanh(${name}.warp),1)`;
    }
    return name;
}
/** Final displayed RGB of a vec4 field of the given type. */
function presentGLSL(type) {
    return type === 'layer' ? 'displayColor(f.rgb,u_exposure,u_tone)' : 'clamp(f.rgb,0.0,1.0)';
}
/** What a bypassed node evaluates to: its pass-through input, or a typed zero. */
function bypassExpression(node, names) {
    const socket = bypassSocket(node.type), source = socket && node.inputs[socket];
    return source && names.has(source) ? names.get(source) : zeroByType[catalog[node.type].output];
}
export function compileGraph(project, target = project.output, options = {}) {
    const { raw = false, contribution = null, contributionStyle = 'highlight', preview = false } = options;
    validateProject(project);
    if (contribution && !project.nodes.some(n => n.id === contribution)) {
        throw new Error(`Unknown contribution node ${contribution}.`);
    }
    if (!CONTRIBUTION_STYLES.includes(contributionStyle)) {
        throw new Error(`Unknown contribution style ${contributionStyle}.`);
    }
    const order = topologicalOrder(project, preview ? null : target);
    const names = new Map(order.map((n, k) => [n.id, `n${k}`]));
    const uniforms = [], functions = [], expressions = new Map();
    for (const n of order) {
        const d = catalog[n.type], name = names.get(n.id);
        const inputs = Object.fromEntries(Object.entries(d.inputs).map(([k, t]) => [k, n.inputs[k] ? names.get(n.inputs[k]) : zeroByType[t]]));
        const params = {};
        for (const [k, spec] of Object.entries(d.params)) {
            if (spec.kind === 'expression') {
                continue;
            }
            const uname = `u_${name}_${k}`;
            params[k] = uname;
            uniforms.push({ name: uname, node: n.id, param: k, type: spec.kind === 'color' ? 'vec3' : 'float' });
        }
        let expression;
        if (!n.enabled) {
            expression = bypassExpression(n, names);
        }
        else if (Object.hasOwn(expressionTypes, n.type)) {
            // Custom equations become small typed functions with the documented local names.
            functions.push(`${expressionTypes[n.type]} equation_${name}(vec2 p,float a,float b,float t){float x=p.x,y=p.y,r=length(p),theta=angleOf(p);return ${n.params.expression};}`);
            expression = `equation_${name}(${inputs.p},${inputs.a},${inputs.b},u_time)`;
            if (n.type === 'colorExpression') {
                expression = `vec4(${expression},1)`;
            }
        }
        else {
            expression = d.emit(inputs, params);
        }
        expressions.set(n.id, expression);
    }
    const statement = (n, bypassed = false) => {
        const d = catalog[n.type], name = names.get(n.id);
        return `  // ${name}: ${d.name.replace(/\n/g, ' ')} [${n.id}]\n  ${glslTypes[d.output]} ${name} = ${bypassed ? bypassExpression(n, names) : expressions.get(n.id)};`;
    };
    const last = order.at(-1), type = preview ? 'layer' : catalog[last.type].output;
    let shaders, fieldCall, presentation;
    if (preview) {
        // One program for every thumbnail: layers are display-converted inside so
        // that all node kinds return a displayable value.
        const cases = order.map(n => {
            const name = names.get(n.id), out = catalog[n.type].output;
            const value = out === 'layer' ? `vec4(displayColor(${name}.rgb,u_exposure,u_tone),1)` : toVec4(out, name, false);
            return `  if(index==${order.indexOf(n)}) return ${value};`;
        });
        shaders = `vec4 shade(vec2 p,int index){\n${order.map(n => statement(n)).join('\n')}\n${cases.join('\n')}\n  return vec4(0,0,0,1);\n}`;
        fieldCall = 'shade(p,u_previewIndex)';
        presentation = 'outputColor=vec4(clamp(field.rgb,0.0,1.0),1);';
    }
    else {
        const result = toVec4(type, names.get(last.id), raw);
        shaders = `vec3 present(vec4 f){ return ${presentGLSL(type)}; }\nvec4 shade(vec2 p){\n${order.map(n => statement(n)).join('\n')}\n  return ${result};\n}`;
        fieldCall = 'shade(p)';
        presentation = 'outputColor=vec4(present(field),1);';
        if (contribution) {
            shaders += `\nvec4 shadeWithout(vec2 p){\n${order.map(n => statement(n, n.id === contribution)).join('\n')}\n  return ${result};\n}`;
            const compare = contributionStyle === 'signed'
                // Warm where the node brightens the result, cool where it darkens it.
                ? 'vec3 diff=a-b; float s=dot(diff,vec3(1.0/3.0));\n vec3 heat=s>0.0?vec3(1.0,0.45,0.15)*s:vec3(0.25,0.55,1.0)*(-s);\n outputColor=vec4(clamp(heat*4.0,0.0,1.0),1);'
                // Pixels the node changes keep their color; the rest becomes dim gray.
                : 'float d=max(max(abs(a.r-b.r),abs(a.g-b.g)),abs(a.b-b.b));\n float lum=dot(a,vec3(0.2126,0.7152,0.0722));\n outputColor=vec4(mix(vec3(lum)*0.18+0.02,a,smoothstep(0.0,0.02,d)),1);';
            presentation = `vec4 without=shadeWithout(p);
 if(any(isnan(without))||any(isinf(without))){outputColor=vec4(1,0,1,1);return;}
 vec3 a=present(field), b=present(without);
 ${compare}`;
        }
    }
    const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_resolution;
uniform vec2 u_offset; // framebuffer origin of the current tile (atlas rendering)
uniform vec3 u_view; // pan.x, pan.y, zoom
uniform float u_time;
uniform float u_exposure;
uniform int u_tone;
uniform int u_debug;
uniform int u_previewIndex;
${uniforms.map(u => `uniform ${u.type} ${u.name};`).join('\n')}
out vec4 outputColor;
${mathGLSL}\n${nebulaGLSL}\n${motifsGLSL}\n${functions.join('\n')}
${shaders}
void main(){
 // Fixed horizontal field of view; arbitrary aspect ratios crop/extend vertically.
 vec2 p=(gl_FragCoord.xy-u_offset-0.5*u_resolution)*(2000.0/420.0)/u_resolution.x;
 p=p/u_view.z+u_view.xy+vec2(0.5/420.0);
 vec4 field=${fieldCall};
 ${raw && !contribution ? 'outputColor=field;return;' : ''}
 if(any(isnan(field))||any(isinf(field))){outputColor=vec4(1,0,1,1);return;}
 if(u_debug==1){outputColor=vec4(0,0,0,1);return;}
 if(u_debug==2){outputColor=vec4(vec3(field.a),1);return;}
 ${presentation}
}
`;
    return {
        vertex: vertexSource,
        fragment,
        uniforms,
        order: order.map(n => n.id),
        target: preview ? null : target,
        type,
        raw: raw && !contribution,
        contribution,
        contributionStyle: contribution ? contributionStyle : null,
        reachable: contribution ? order.some(n => n.id === contribution) : true,
        preview,
        previewIndex: preview ? Object.fromEntries(order.map((n, k) => [n.id, k])) : null
    };
}
