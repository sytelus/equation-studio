import { catalog, zeroByType, bypassSocket, paramSpecs } from './catalog.js';
import { compileEquation, programGLSL } from './expression.js';
import { validateProject, evaluationOrder, topologicalOrder, upstream, MAX_NODES, MAX_POINT_CLOUDS } from './graph.js';
import { analyzeCode, codeGLSL, codeStructure, showType } from './glsl.js';
import { twiglGLSL } from './twigl-glsl.js';
import { linkLibraries } from './shader-link.js';
import { mathGLSL } from './math-glsl.js';
import { nebulaGLSL } from './nebula-glsl.js';
import { motifsGLSL } from './motifs-glsl.js';
import { presentGLSL } from './looks.js';
import { animatedParameters } from './timeline.js';
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
function nodeExpression(node, name, k, inputs, uniforms, custom) {
    const d = catalog[node.type];
    if (d.code) {
        // The code's own time, and which of its values to return (glsl.js).
        return `code_${name}(${inputs.p},u_time*${uniforms.speed}+${uniforms.phase},u_target==${k}?u_show:0)`;
    }
    if (d.points) {
        return `pointsLayer(u_points${custom.slot},${inputs.p})`;
    }
    if (custom) {
        const call = `equation_${name}(${inputs.p},${inputs.a},${inputs.b},u_time)`;
        return custom.returns === 'vec3' ? `vec4(${call},1)` : call;
    }
    return d.emit(inputs, uniforms);
}
/** What decides a node's generated code besides its type and wiring: the text of
 * an equation, or the structure of shader code (its numbers are uniforms).
 */
function structureOf(node, inlineNumbers) {
    return catalog[node.type].code ? codeStructure(node.params.code, inlineNumbers) : node.params.expression ?? null;
}
/** Everything that changes the generated source. Parameter values, enabled
 * flags, the output choice and the view are uniforms and are excluded; so are
 * the numbers of shader code, unless `inlineNumbers` compiles them as constants.
 */
export function programKey(project, subset = null, inlineNumbers = false) {
    const include = subset ? new Set(subset) : null;
    return JSON.stringify(evaluationOrder(project).filter(n => !include || include.has(n.id)).map(n => [n.id, n.type, n.inputs, structureOf(n, inlineNumbers)])) + (inlineNumbers ? '#inline' : '');
}
/** The target and everything upstream of it, whatever the enabled flags: the
 * nodes a program for viewing `target` must contain.
 */
export function subgraph(project, target) {
    return [...upstream(project, target), target];
}
/** The shader libraries, in dependency order. A program links only what it uses. */
export const LIBRARIES = [mathGLSL, nebulaGLSL, motifsGLSL, twiglGLSL];
/** The world frame: 2000/420 units wide, with the original scene's half-pixel offset. */
const FRAME_GLSL = 'const float FRAME_WIDTH=2000.0/420.0;const vec2 FRAME_OFFSET=vec2(0.5/420.0);';
/** Sample the texture of a point cloud (drawn by its point pass in the pixels of
 * the frame) at a point of the plane. Its colors are premultiplied by coverage;
 * layers are straight.
 */
const POINTS_LAYER_GLSL = `vec4 pointsLayer(highp sampler2D tex,vec2 p){
 vec2 pixel=(p-FRAME_OFFSET-u_view.xy)*u_view.z*(u_frame.x/FRAME_WIDTH)+0.5*u_frame;
 vec4 c=textureLod(tex,pixel/u_frame,0.0);
 return c.a>1e-6?vec4(c.rgb/c.a,min(c.a,1.0)):vec4(0);
}`;
/** The point pass of a point cloud: one vertex per point, placed by its equation,
 * drawn as a round antialiased dot into a texture the size of the frame.
 */
function pointPassSources(cloud, aliases, vectors) {
    const u = cloud.uniforms, header = `#version 300 es
precision highp float;
precision highp int;
uniform vec4 u_params[${vectors}];
${aliases.join('\n')}`;
    const own = `${cloud.equation}
out float v_radius;
out float v_size;
void main(){
 float n=floor(${u.count}+0.5), S=${u.canvas};
 vec2 s=points_${cloud.name}(float(gl_VertexID),n,u_clock*${u.speed}+${u.phase});
 // Sketch pixels (y down, S wide, centered) → world → pixels of the frame.
 vec2 world=vec2(s.x-0.5*S,0.5*S-s.y)*(FRAME_WIDTH/S);
 vec2 pixel=(world-u_view.xy)*u_view.z*(u_frame.x/FRAME_WIDTH)+0.5*u_frame;
 float diameter=${u.size}/S*u_frame.x*u_view.z;
 v_radius=0.5*diameter;
 v_size=clamp(ceil(diameter)+2.0,1.0,u_pointMax);
 gl_PointSize=v_size;
 bool bad=isnan(pixel.x)||isnan(pixel.y)||isinf(pixel.x)||isinf(pixel.y);
 gl_Position=bad?vec4(2.0,2.0,2.0,1.0):vec4(pixel/u_frame*2.0-1.0,0.0,1.0);
}`;
    return {
        node: cloud.node,
        slot: cloud.slot,
        vertex: `${header}
uniform vec2 u_frame;
uniform vec3 u_view;
uniform float u_clock;
uniform float u_pointMax;
${FRAME_GLSL}
${linkLibraries(own, LIBRARIES)}
${own}`,
        fragment: `${header}
in float v_radius;
in float v_size;
out vec4 outputColor;
void main(){
 // The area of this pixel inside the dot, from 4 × 4 samples (like a canvas's antialiasing).
 vec2 at=(gl_PointCoord-0.5)*v_size;
 float cover=0.0;
 for(int k=0;k<16;k++) cover+=step(length(at+(vec2(k&3,k>>2)-1.5)*0.25),v_radius);
 float a=clamp(${u.alpha},0.0,1.0)*cover/16.0;
 outputColor=vec4(${u.color}*a,a);
}`
    };
}
/** Compile a project (or the `subset` of its node ids) into one fragment program.
 * Returns {vertex, fragment, key, order, index, types, params, vectors, points, code}:
 *   order    node ids in evaluation order (index = position)
 *   types    node id → output type
 *   params   [{node, param, kind, vector, component, literal?}]: where each numeric
 *            or color parameter lives in u_params; kind 'literal' is number
 *            `literal` of a node's shader code
 *   points   [{node, slot, vertex, fragment}]: the point pass of each point cloud,
 *            whose texture the program reads from sampler u_points<slot>
 *   code     node id → {start, lines}: the first line (0-based) of the node's code
 *            function in `fragment` and the code line of each of its lines, to
 *            point GPU compiler messages at the code (sourceLine())
 * The numbers of shader code are uniforms, so dragging one never recompiles;
 * `inlineNumbers` writes them as constants instead, exactly as in the original
 * code (the GPU compiler may then fold them, as it does on twigl).
 */
export function compileProgram(project, { subset = null, inlineNumbers = false } = {}) {
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
    const params = [], aliases = [], functions = [], statements = [], selects = [], clouds = [], codeFunctions = [];
    const nodeAliases = new Map();
    let vectors = 0, open = null;
    const allocate = (node, key, kind, alias, extra = {}) => {
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
        params.push({ node, param: key, kind, vector, component, ...extra });
        const line = `#define ${alias} u_params[${vector}].${swizzle}`;
        aliases.push(line);
        nodeAliases.get(node).push(line);
        return alias;
    };
    order.forEach((n, k) => {
        const d = catalog[n.type], name = names.get(n.id), uniforms = {};
        nodeAliases.set(n.id, []);
        for (const [key, spec] of Object.entries(paramSpecs(n))) {
            if (spec.kind !== 'expression' && spec.kind !== 'code') {
                uniforms[key] = allocate(n.id, key, spec.kind, `${name}_${key}`);
            }
        }
        let custom = null;
        if (d.code) {
            const analysis = analyzeCode(n.params.code);
            const numbers = inlineNumbers ? null : analysis.numbers.map((x, i) => allocate(n.id, `#${i}`, 'literal', `${name}_k${i}`, { literal: i }));
            const fn = codeGLSL(analysis, `code_${name}`, { numbers: numbers && (i => numbers[i]), params: key => uniforms[key], caps: loop => `int(${uniforms[`steps${loop + 1}`]})` });
            functions.push(fn.code);
            codeFunctions.push({ node: n.id, name: `code_${name}`, lines: fn.lines });
        }
        else if (d.points) {
            if (clouds.length >= MAX_POINT_CLOUDS) {
                throw new Error(`A program draws at most ${MAX_POINT_CLOUDS} point clouds.`);
            }
            const equation = programGLSL(compileEquation(n.params.expression, 'points'), `points_${name}`, uniforms);
            custom = { slot: clouds.length };
            clouds.push({ node: n.id, slot: clouds.length, name, equation: equation.code, uniforms });
        }
        else if (d.custom) {
            custom = customFunction(n, name, uniforms);
            functions.push(custom.code);
        }
        const expression = nodeExpression(n, name, k, inputExpressions(n, names), uniforms, custom);
        statements.push(`  // ${name}: ${d.name.replace(/\n/g, ' ')} [${n.id}]
  ${glslTypes[d.output]} ${name}=${zeroByType[d.output]};
  if(evaluated(${k})){ if(included(${k})) ${name}=${expression}; else ${name}=${bypassExpression(n, names)}; }`);
        selects.push(`  if(u_target==${k}) return ${rawVec4(d.output, name)};`);
    });
    vectors = Math.max(vectors, 1);
    // The program's own code; the libraries contribute only what it uses.
    const own = `${presentGLSL}
bool componentBit(uvec4 mask,int i){return ((mask[i>>5]>>uint(i&31))&1u)!=0u;}
bool evaluated(int i){return componentBit(u_active,i);}
bool included(int i){return componentBit(u_enabled,i);}
// Parameters: node variable _ parameter name (_k<i>: number i of shader code)
${aliases.join('\n')}
${clouds.length ? POINTS_LAYER_GLSL : ''}
${functions.join('\n')}
vec4 evaluate(vec2 p){
${statements.join('\n')}
${selects.join('\n')}
  return vec4(0);
}
bool nonfinite(vec4 v){return any(isnan(v))||any(isinf(v));}
void main(){
 u_time=u_clock;
 g_pixel=vec2(-1e9);
 vec2 p;
 if(u_sampling==1){
  // Points along the line u_line (probes and profiles).
  p=mix(u_line.xy,u_line.zw,(gl_FragCoord.x-u_offset.x)/u_resolution.x);
 } else if(u_sampling==2){
  // One point, u_line.xy, at times from u_line.z to u_line.w (time profiles).
  p=u_line.xy;
  u_time=mix(u_line.z,u_line.w,(gl_FragCoord.x-u_offset.x)/u_resolution.x);
 } else {
  // Fixed horizontal field of view; other aspect ratios crop or extend vertically.
  p=(gl_FragCoord.xy-u_offset-0.5*u_resolution)*FRAME_WIDTH/u_resolution.x;
  p=p/u_view.z+u_view.xy+FRAME_OFFSET;
  if(u_view==vec3(0,0,1)) g_pixel=gl_FragCoord.xy-u_offset;
 }
 g_cameraP=p;
 vec4 field=evaluate(p);
 if(u_mode==1){outputColor=field;return;}
 if(nonfinite(field)){outputColor=vec4(1,0,1,1);return;}
 if(u_debug==1){outputColor=vec4(0,0,0,1);return;}
 if(u_debug==2){outputColor=vec4(vec3(field.a),1);return;}
 outputColor=vec4(present(field),1);
}
`;
    const fragment = `#version 300 es
precision highp float;
precision highp int;
// Equation Studio program: ${order.length} components. One program serves every view of
// this graph: the component shown, which are included and how values are colored are
// uniforms. See docs/ARCHITECTURE.md, "The compiler".
uniform vec2 u_resolution;
uniform vec2 u_offset;   // framebuffer origin of the current tile (atlas rendering)
uniform vec3 u_view;     // pan x, pan y, zoom
uniform int u_sampling;  // 0 camera grid, 1 points along u_line, 2 one point over time
uniform vec4 u_line;     // line sampling: start (xy) and end (zw) in world units
uniform vec2 u_frame;    // size in pixels of the frame the view shows (twigl's r)
uniform float u_clock;   // studio time in seconds
uniform float u_exposure;
uniform int u_tone;
uniform int u_debug;
uniform int u_mode;      // 0 display colors, 1 raw values
uniform int u_target;    // index of the component shown
uniform int u_show;      // shown value of shader code: 0 its color o, k its k-th variable
uniform uvec4 u_active;  // one bit per component: evaluate it
uniform uvec4 u_enabled; // one bit per component: include it (otherwise bypass it)
uniform vec4 u_params[${vectors}];
${clouds.map(c => `uniform highp sampler2D u_points${c.slot};`).join('\n')}
out vec4 outputColor;
float u_time;            // time of this sample: u_clock, or a point of the time line
vec2 g_cameraP;          // the camera point of this pixel
vec2 g_pixel;            // its pixel position, when the camera is neither panned nor zoomed
${FRAME_GLSL}
${linkLibraries(own, LIBRARIES)}
${own}`;
    const fragmentLines = fragment.split('\n');
    const code = Object.fromEntries(codeFunctions.map(f => [f.node, { start: fragmentLines.findIndex(l => l.startsWith(`vec4 ${f.name}(`)), lines: f.lines }]));
    return {
        vertex: vertexSource,
        fragment,
        key: programKey(project, subset, inlineNumbers),
        order: order.map(n => n.id),
        index: Object.fromEntries(order.map((n, k) => [n.id, k])),
        types: Object.fromEntries(order.map(n => [n.id, catalog[n.type].output])),
        params,
        vectors,
        points: clouds.map(c => pointPassSources(c, nodeAliases.get(c.node), vectors)),
        code
    };
}
/** Parameter values of `project` at `time`, packed as the program's u_params:
 * four floats per vector (compileProgram's `params` says where each lives). The
 * numbers of shader code come from the code text itself.
 */
export function packParameters(compiled, project, time) {
    const data = new Float32Array(compiled.vectors * 4), values = new Map();
    for (const slot of compiled.params) {
        if (!values.has(slot.node)) {
            const node = project.nodes.find(n => n.id === slot.node), animated = animatedParameters(project, node, time);
            values.set(slot.node, catalog[node.type].code ? { ...animated, numbers: analyzeCode(node.params.code).numbers } : animated);
        }
        const own = values.get(slot.node), value = slot.kind === 'literal' ? own.numbers[slot.literal].value : own[slot.param], base = slot.vector * 4;
        if (slot.kind === 'color') {
            [1, 3, 5].forEach((k, c) => data[base + c] = parseInt(value.slice(k, k + 2), 16) / 255);
        }
        else {
            data[base + slot.component] = value;
        }
    }
    return data;
}
/** The code line behind line `glslLine` (1-based, as in compiler messages) of a
 * compiled fragment program: {node, line}, or null outside shader code.
 */
export function sourceLine(compiled, glslLine) {
    for (const [node, map] of Object.entries(compiled.code || {})) {
        const k = glslLine - 1 - map.start;
        if (map.start >= 0 && k >= 0 && k < map.lines.length) {
            return { node, line: map.lines[k] };
        }
    }
    return null;
}
/** Point GPU compiler messages ("ERROR: 0:123: …") at the lines of shader code. */
export function explainCompileLog(compiled, project, log) {
    return String(log).replace(/ERROR: \d+:(\d+):/g, (match, line) => {
        const at = sourceLine(compiled, Number(line));
        if (!at) {
            return match;
        }
        const node = project.nodes.find(n => n.id === at.node);
        return at.line ? `${node?.label || at.node}, code line ${at.line}:` : `${node?.label || at.node}:`;
    });
}
/** The type of value a view of `target` shows: the node's output type, or for
 * shader code with a shown variable (`show` > 0), that variable's type.
 */
export function shownType(project, target, show = 0) {
    const node = project.nodes.find(n => n.id === target), d = node && catalog[node.type];
    if (!d) {
        return null;
    }
    return d.code && show ? showType(analyzeCode(node.params.code), show) : d.output;
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
