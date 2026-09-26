import { catalog, zeroByType, bypassSocket, paramSpecs } from './catalog.js';
import { compileEquation, programGLSL } from './expression.js';
import { validateProject, evaluationOrder, topologicalOrder, upstream, MAX_NODES } from './graph.js';
import { mathGLSL } from './math-glsl.js';
import { nebulaGLSL } from './nebula-glsl.js';
import { motifsGLSL } from './motifs-glsl.js';
import { presentGLSL } from './looks.js';
/** Typed DAG → one GLSL ES 3.00 fragment program per graph STRUCTURE.
 *
 * Every component becomes one local variable inside `evaluate()`. What changes
 * from frame to frame is passed as uniforms, never baked into the source:
 *
 *   parameters          u_params, four numbers per vec4 (named by #define aliases)
 *   which is shown      u_target: the index of the component whose value is output
 *   included / bypassed u_enabled: one bit per component
 *   what is evaluated   u_active: one bit per component, the target's dependencies,
 *                       so a program for the whole graph only computes what the
 *                       current view needs
 *   view mode           u_mode: display colors or raw values
 *
 * So ticking a checkbox, walking the pipeline, showing what a component changes,
 * rendering every thumbnail and probing raw values all reuse one linked program.
 * Only wiring, component kinds and custom equations change the source. This
 * matters because some drivers take seconds to compile a large program; for the
 * same reason the program stays lean: "what it changes" is two ordinary draws
 * combined by comparePassSource, and the automatic colormaps of looks.js are a
 * post pass over raw values, both small fixed shaders compiled once.
 *
 * A bypassed component forwards its catalog `bypass` input unchanged, or a typed
 * zero when it has none (content such as a star field).
 */
export const MODES = { display: 0, raw: 1 };
export const CONTRIBUTION_STYLES = ['highlight', 'signed'];
const glslTypes = { coord: 'vec2', scalar: 'float', geometry: 'Geometry', layer: 'vec4' };
export const vertexSource = `#version 300 es
precision highp float;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
/** A typed value as the raw vec4 every program returns: scalar (v,0,0,1),
 * coordinates (x,y,0,1), geometry (warp,rim,coverage,1), layers unchanged.
 */
function rawVec4(type, name) {
    if (type === 'scalar') {
        return `vec4(${name},0,0,1)`;
    }
    if (type === 'coord') {
        return `vec4(${name},0,1)`;
    }
    if (type === 'geometry') {
        return `vec4(${name}.warp,${name}.rim,${name}.coverage,1)`;
    }
    return name;
}
/** GLSL for each input socket: the source's variable, or a typed zero when unconnected. */
function inputExpressions(node, names) {
    return Object.fromEntries(Object.entries(catalog[node.type].inputs).map(([socket, type]) => {
        const source = node.inputs[socket];
        return [socket, source && names.has(source) ? names.get(source) : zeroByType[type]];
    }));
}
/** What a bypassed node evaluates to: its pass-through input, or a typed zero. */
function bypassExpression(node, names) {
    const socket = bypassSocket(node.type), source = socket && node.inputs[socket];
    return source && names.has(source) ? names.get(source) : zeroByType[catalog[node.type].output];
}
/** A custom equation as a small typed GLSL function (expression.js prints it from
 * the checked program; parameters read their uniform aliases).
 */
function customFunction(node, name, uniforms) {
    return programGLSL(compileEquation(node.params.expression, node.type), `equation_${name}`, uniforms);
}
/** GLSL expression of an included node. */
function nodeExpression(node, name, inputs, uniforms, custom) {
    if (custom) {
        const call = `equation_${name}(${inputs.p},${inputs.a},${inputs.b},u_time)`;
        return custom.returns === 'vec3' ? `vec4(${call},1)` : call;
    }
    return catalog[node.type].emit(inputs, uniforms);
}
/** Everything that changes the generated source. Parameter values, enabled
 * flags, the output choice and the view are uniforms and are excluded.
 */
export function programKey(project, subset = null) {
    const include = subset ? new Set(subset) : null;
    return JSON.stringify(evaluationOrder(project).filter(n => !include || include.has(n.id)).map(n => [n.id, n.type, n.inputs, n.params.expression ?? null]));
}
/** The target and everything upstream of it, whatever the enabled flags: the
 * nodes a program for viewing `target` must contain.
 */
export function subgraph(project, target) {
    return [...upstream(project, target), target];
}
/** Compile a project (or the `subset` of its node ids) into one fragment program.
 * Returns {vertex, fragment, key, order, index, types, params, vectors}:
 *   order    node ids in evaluation order (index = position)
 *   types    node id → output type
 *   params   [{node, param, kind, vector, component}]: where each numeric or color
 *            parameter lives in u_params
 */
export function compileProgram(project, { subset = null } = {}) {
    validateProject(project);
    const include = subset ? new Set(subset) : null;
    const order = evaluationOrder(project).filter(n => !include || include.has(n.id));
    if (!order.length) {
        throw new Error('Nothing to compile.');
    }
    if (order.length > MAX_NODES) {
        throw new Error(`A program holds at most ${MAX_NODES} components.`);
    }
    const names = new Map(order.map((n, k) => [n.id, `n${k}`]));
    const params = [], aliases = [], functions = [], statements = [], selects = [];
    let vectors = 0, open = null;
    const allocate = (node, key, kind, alias) => {
        let vector, component = 0, swizzle;
        if (kind === 'color') {
            vector = vectors++;
            swizzle = 'rgb';
        }
        else {
            if (!open || open.next === 4) {
                open = { vector: vectors++, next: 0 };
            }
            vector = open.vector;
            component = open.next++;
            swizzle = 'xyzw'[component];
        }
        params.push({ node, param: key, kind, vector, component });
        aliases.push(`#define ${alias} u_params[${vector}].${swizzle}`);
        return alias;
    };
    order.forEach((n, k) => {
        const d = catalog[n.type], name = names.get(n.id), uniforms = {};
        for (const [key, spec] of Object.entries(paramSpecs(n))) {
            if (spec.kind !== 'expression') {
                uniforms[key] = allocate(n.id, key, spec.kind, `${name}_${key}`);
            }
        }
        let custom = null;
        if (d.custom) {
            custom = customFunction(n, name, uniforms);
            functions.push(custom.code);
        }
        const expression = nodeExpression(n, name, inputExpressions(n, names), uniforms, custom);
        statements.push(`  // ${name}: ${d.name.replace(/\n/g, ' ')} [${n.id}]
  ${glslTypes[d.output]} ${name}=${zeroByType[d.output]};
  if(evaluated(${k})){ if(included(${k})) ${name}=${expression}; else ${name}=${bypassExpression(n, names)}; }`);
        selects.push(`  if(u_target==${k}) return ${rawVec4(d.output, name)};`);
    });
    const fragment = `#version 300 es
precision highp float;
precision highp int;
// Equation Studio program: ${order.length} components. One program serves every view of
// this graph: the component shown, which are included and how values are colored are
// uniforms. See docs/ARCHITECTURE.md, "The compiler".
uniform vec2 u_resolution;
uniform vec2 u_offset;   // framebuffer origin of the current tile (atlas rendering)
uniform vec3 u_view;     // pan x, pan y, zoom
uniform int u_sampling;  // 0 camera grid, 1 points along u_line
uniform vec4 u_line;     // line sampling: start (xy) and end (zw) in world units
uniform float u_time;
uniform float u_exposure;
uniform int u_tone;
uniform int u_debug;
uniform int u_mode;      // 0 display colors, 1 raw values
uniform int u_target;    // index of the component shown
uniform uvec4 u_active;  // one bit per component: evaluate it
uniform uvec4 u_enabled; // one bit per component: include it (otherwise bypass it)
uniform vec4 u_params[${Math.max(vectors, 1)}];
out vec4 outputColor;
${mathGLSL}
${nebulaGLSL}
${motifsGLSL}
${presentGLSL}
bool componentBit(uvec4 mask,int i){return ((mask[i>>5]>>uint(i&31))&1u)!=0u;}
bool evaluated(int i){return componentBit(u_active,i);}
bool included(int i){return componentBit(u_enabled,i);}
// Parameters: node variable _ parameter name
${aliases.join('\n')}
${functions.join('\n')}
vec4 evaluate(vec2 p){
${statements.join('\n')}
${selects.join('\n')}
  return vec4(0);
}
bool nonfinite(vec4 v){return any(isnan(v))||any(isinf(v));}
void main(){
 vec2 p;
 if(u_sampling==1){
  p=mix(u_line.xy,u_line.zw,(gl_FragCoord.x-u_offset.x)/u_resolution.x);
 } else {
  // Fixed horizontal field of view; other aspect ratios crop or extend vertically.
  p=(gl_FragCoord.xy-u_offset-0.5*u_resolution)*(2000.0/420.0)/u_resolution.x;
  p=p/u_view.z+u_view.xy+vec2(0.5/420.0);
 }
 vec4 field=evaluate(p);
 if(u_mode==1){outputColor=field;return;}
 if(nonfinite(field)){outputColor=vec4(1,0,1,1);return;}
 if(u_debug==1){outputColor=vec4(0,0,0,1);return;}
 if(u_debug==2){outputColor=vec4(vec3(field.a),1);return;}
 outputColor=vec4(present(field),1);
}
`;
    return {
        vertex: vertexSource,
        fragment,
        key: programKey(project, subset),
        order: order.map(n => n.id),
        index: Object.fromEntries(order.map((n, k) => [n.id, k])),
        types: Object.fromEntries(order.map(n => [n.id, catalog[n.type].output])),
        params,
        vectors: Math.max(vectors, 1)
    };
}
/** "What it changes": the displayed image with the component (u_with) and with it
 * bypassed (u_without), both drawn by the graph program, compared per pixel.
 * `highlight` keeps the pixels it changes in color and dims the rest to gray;
 * `signed` is warm where it adds light and cool where it removes light.
 */
export const comparePassSource = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_with;
uniform highp sampler2D u_without;
uniform vec2 u_origin;  // framebuffer position of texel (0, 0)
uniform int u_style;    // 0 highlight, 1 signed
out vec4 outputColor;
bool magenta(vec3 c){return c.r>0.999&&c.g<0.001&&c.b>0.999;}
void main(){
 ivec2 at=ivec2(gl_FragCoord.xy-u_origin);
 vec3 a=texelFetch(u_with,at,0).rgb, b=texelFetch(u_without,at,0).rgb;
 if(magenta(a)||magenta(b)){outputColor=vec4(1,0,1,1);return;} // a nonfinite value in either image
 if(u_style==1){
  // Warm where the component brightens the result, cool where it darkens it.
  vec3 diff=a-b; float s=dot(diff,vec3(1.0/3.0));
  vec3 heat=s>0.0?vec3(1.0,0.45,0.15)*s:vec3(0.25,0.55,1.0)*(-s);
  outputColor=vec4(clamp(heat*4.0,0.0,1.0),1);
 } else {
  // Pixels the component changes keep their color; the rest becomes dim gray.
  float d=max(max(abs(a.r-b.r),abs(a.g-b.g)),abs(a.b-b.b));
  float lum=dot(a,vec3(0.2126,0.7152,0.0722));
  outputColor=vec4(mix(vec3(lum)*0.18+0.02,a,smoothstep(0.0,0.02,d)),1);
 }
}
`;
/** Four 32-bit words with one bit set per listed node that the program contains. */
export function nodeMask(program, ids) {
    const words = new Uint32Array(4);
    for (const id of ids) {
        const k = program.index[id];
        if (k !== undefined) {
            words[k >> 5] |= 1 << (k & 31);
        }
    }
    return words;
}
/** Per-frame component state for drawing `target` with `program`:
 * {order, active, enabled, reachable}. `order` lists the nodes the view actually
 * evaluates (a disabled node pulls in only its bypass input); `reachable` says
 * whether `contribution` influences the target at all.
 */
export function viewState(program, project, target, contribution = null) {
    if (program.index[target] === undefined) {
        throw new Error(`The program does not contain ${target}.`);
    }
    const order = topologicalOrder(project, target).map(n => n.id);
    return {
        order,
        active: nodeMask(program, order),
        enabled: nodeMask(program, project.nodes.filter(n => n.enabled).map(n => n.id)),
        reachable: contribution ? order.includes(contribution) : true
    };
}
/** The project with one more component bypassed: the second image of "what it changes". */
export function withBypassed(project, id) {
    return { ...project, nodes: project.nodes.map(n => n.id === id ? { ...n, enabled: false } : n) };
}
/** The program for viewing one target, as a readable description of that view.
 * Contains only the target's subgraph, so it is the smallest program that can
 * show it; raw values and "what it changes" are chosen at draw time (MODES).
 * Returns the compileProgram() result plus {target, type, raw, contribution,
 * contributionStyle, reachable, evaluated}; `evaluated` lists the nodes the view
 * evaluates with the current enabled flags.
 */
export function compileGraph(project, target = project.output, options = {}) {
    const { raw = false, contribution = null, contributionStyle = 'highlight' } = options;
    validateProject(project);
    if (!project.nodes.some(n => n.id === target)) {
        throw new Error(`Unknown component ${target}.`);
    }
    if (contribution && !project.nodes.some(n => n.id === contribution)) {
        throw new Error(`Unknown contribution node ${contribution}.`);
    }
    if (!CONTRIBUTION_STYLES.includes(contributionStyle)) {
        throw new Error(`Unknown contribution style ${contributionStyle}.`);
    }
    const program = compileProgram(project, { subset: subgraph(project, target) });
    const state = viewState(program, project, target, contribution);
    return {
        ...program,
        target,
        type: catalog[project.nodes.find(n => n.id === target).type].output,
        raw: raw && !contribution,
        contribution,
        contributionStyle: contribution ? contributionStyle : null,
        reachable: state.reachable,
        evaluated: state.order
    };
}
