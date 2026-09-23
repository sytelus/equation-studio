import { catalog, zeroByType } from './catalog.js';
import { validateProject, topologicalOrder } from './graph.js';
import { mathGLSL } from './math-glsl.js';
import { nebulaGLSL } from './nebula-glsl.js';
import { motifsGLSL } from './motifs-glsl.js';
const glslTypes = { coord: 'vec2', scalar: 'float', geometry: 'Geometry', layer: 'vec4' };
export const vertexSource = `#version 300 es
precision highp float;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
export function compileGraph(project, target = project.output, raw = false) {
    validateProject(project);
    const order = topologicalOrder(project, target), names = new Map(order.map((n, k) => [n.id, `n${k}`]));
    const uniforms = [], statements = [], functions = [];
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
            expression = zeroByType[d.output];
        }
        else if (['expression', 'vectorExpression', 'colorExpression'].includes(n.type)) {
            const resultType = n.type === 'expression' ? 'float' : n.type === 'vectorExpression' ? 'vec2' : 'vec3';
            functions.push(`${resultType} equation_${name}(vec2 p,float a,float b,float t){float x=p.x,y=p.y,r=length(p),theta=angleOf(p);return ${n.params.expression};}`);
            expression = `equation_${name}(${inputs.p},${inputs.a},${inputs.b},u_time)`;
            if (n.type === 'colorExpression') {
                expression = `vec4(${expression},1)`;
            }
        }
        else {
            expression = d.emit(inputs, params);
        }
        statements.push(`  // ${name}: ${d.name.replace(/\n/g, ' ')} [${n.id}]\n  ${glslTypes[d.output]} ${name} = ${expression};`);
    }
    const last = order.at(-1), name = names.get(last.id), type = catalog[last.type].output;
    let result = name;
    if (type === 'scalar') {
        result = raw ? `vec4(${name},0,0,1)` : `vec4(vec3(0.5+0.5*tanh(${name})),1)`;
    }
    if (type === 'coord') {
        result = raw ? `vec4(${name},0,1)` : `vec4(0.5+0.5*sin(${name}.x),0.5+0.5*sin(${name}.y),0.5,1)`;
    }
    if (type === 'geometry') {
        result = raw ? `vec4(${name}.warp,${name}.rim,${name}.coverage,1)` : `vec4(${name}.rim*4.0,${name}.coverage,0.5+0.5*tanh(${name}.warp),1)`;
    }
    const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_resolution;
uniform vec3 u_view; // pan.x, pan.y, zoom
uniform float u_time;
uniform float u_exposure;
uniform int u_tone;
uniform int u_debug;
${uniforms.map(u => `uniform ${u.type} ${u.name};`).join('\n')}
out vec4 outputColor;
${mathGLSL}\n${nebulaGLSL}\n${motifsGLSL}\n${functions.join('\n')}
vec4 shade(vec2 p){
${statements.join('\n')}
 return ${result};
}
void main(){
 // Fixed horizontal field of view; arbitrary aspect ratios crop/extend vertically.
 vec2 p=(gl_FragCoord.xy-0.5*u_resolution)*(2000.0/420.0)/u_resolution.x;
 p=p/u_view.z+u_view.xy+vec2(0.5/420.0);
 vec4 field=shade(p);
 ${raw ? 'outputColor=field;return;' : ''}
 vec3 c=field.rgb;
 if(any(isnan(field))||any(isinf(field))){outputColor=vec4(1,0,1,1);return;}
 if(u_debug==1){outputColor=vec4(0,0,0,1);return;}
 if(u_debug==2){outputColor=vec4(vec3(field.a),1);return;}
 ${type === 'layer' ? 'outputColor=vec4(displayColor(c,u_exposure,u_tone),1);' : 'outputColor=vec4(clamp(c,0.0,1.0),1);'}
}
`;
    return { vertex: vertexSource, fragment, uniforms, order: order.map(n => n.id), target, type, raw };
}
