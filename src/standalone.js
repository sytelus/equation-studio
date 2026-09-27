import { compileProgram, viewState, packParameters } from './compiler.js';
import { catalog } from './catalog.js';
import { aspectOf } from './graph.js';
import { lookUniforms } from './looks.js';
import { getWork, creditLine } from './works.js';
import { analyzeCode } from './glsl.js';
/** A scene as one self-contained web page: its compiled shaders and a small
 * WebGL 2 player (no library, nothing fetched), to share an animation or embed it
 * anywhere. The page plays the final image in a loop, filling the window in the
 * scene's aspect ratio, and credits the works it uses.
 *
 * Everything the studio would set per frame is fixed here: the parameters (at
 * FRAMES_PER_SECOND samples over the loop when keyframes animate them), which
 * components are evaluated and included, the look. Shader-code numbers are
 * compiled as constants (compileProgram's inlineNumbers). Pure: returns text.
 */
const FRAMES_PER_SECOND = 30, TONES = { source: 0, filmic: 1, linear: 2 };
const escapeHTML = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** JSON that is safe inside a <script> element. */
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
export function standalonePage(project) {
    const compiled = compileProgram(project, { inlineNumbers: true }), target = project.output;
    const state = viewState(compiled, project, target), look = lookUniforms(compiled.types[target], { mode: 'classic' });
    const animated = project.tracks.some(t => t.keys.length > 1);
    const frames = animated ? Math.max(1, Math.round(project.duration * FRAMES_PER_SECOND)) : 1;
    const params = Array.from({ length: frames }, (_, k) => Array.from(packParameters(compiled, project, project.duration * k / frames), v => Number(v.toPrecision(7))));
    const clouds = compiled.points.map(pass => ({ slot: pass.slot, vertex: pass.vertex, fragment: pass.fragment, count: Math.round(project.nodes.find(n => n.id === pass.node).params.count) }));
    const credits = [...new Set(project.nodes.filter(n => n.work && getWork(n.work)).map(n => n.work))].map(id => {
        const w = getWork(id);
        return `${escapeHTML(w.title)} by ${escapeHTML(creditLine(w))} (<a href="${escapeHTML(w.url)}">post</a>)`;
    });
    const scene = {
        vertex: compiled.vertex, fragment: compiled.fragment, clouds, params, frames, duration: project.duration,
        target: compiled.index[target], active: [...state.active], enabled: [...state.enabled],
        view: [project.view.x, project.view.y, project.view.zoom], exposure: project.exposure, tone: TONES[project.tone],
        type: look.type, look: look.look, gain: look.gain, overBlack: catalog[project.nodes.find(n => n.id === target).type].points ? 1 : 0,
        aspect: aspectOf(project)
    };
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(project.title)}</title>
<style>html,body{margin:0;height:100%;background:#000;color:#ccc;font:12px/1.5 system-ui,sans-serif}main{height:100%;display:grid;place-items:center}canvas{max-width:100vw;max-height:100vh;aspect-ratio:${scene.aspect};width:min(100vw,calc(100vh*${scene.aspect}));display:block}p{position:fixed;left:10px;bottom:6px;margin:0;opacity:.75}a{color:#9fe}</style></head>
<body><main><canvas id="c" aria-label="${escapeHTML(project.title)}, animated"></canvas></main>
<p>${escapeHTML(project.title)}${credits.length ? ` · ${credits.join(' · ')}` : ''} · made with Equation Studio · computed live on your GPU</p>
<script>
// The scene, compiled by Equation Studio: shaders, fixed uniforms and parameters.
const S=${scriptJSON(scene)};
const canvas=document.getElementById('c'),gl=canvas.getContext('webgl2',{antialias:false,alpha:false,premultipliedAlpha:false});
if(!gl)document.body.textContent='This page needs WebGL 2.';
const float=!!gl.getExtension('EXT_color_buffer_float');
function program(vs,fs){const p=gl.createProgram();for(const[t,src]of[[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
const main=program(S.vertex,S.fragment),clouds=S.clouds.map(c=>({...c,program:program(c.vertex,c.fragment),texture:gl.createTexture(),fb:gl.createFramebuffer(),size:[0,0]}));
gl.bindVertexArray(gl.createVertexArray());
const U=(p,n)=>gl.getUniformLocation(p,n);
function frame(now){
  const dpr=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(canvas.clientWidth*dpr)),h=Math.max(1,Math.round(canvas.clientHeight*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const t=(now/1000)%S.duration,params=new Float32Array(S.params[Math.floor(t/S.duration*S.frames)%S.frames]);
  for(const c of clouds){
    if(c.size[0]!==w||c.size[1]!==h){gl.bindTexture(gl.TEXTURE_2D,c.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,float?gl.RGBA16F:gl.RGBA8,w,h,0,gl.RGBA,float?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,c.fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,c.texture,0);c.size=[w,h];}
    gl.bindFramebuffer(gl.FRAMEBUFFER,c.fb);gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(c.program);gl.uniform4fv(U(c.program,'u_params'),params);gl.uniform2f(U(c.program,'u_frame'),w,h);gl.uniform3fv(U(c.program,'u_view'),S.view);gl.uniform1f(U(c.program,'u_clock'),t);gl.uniform1f(U(c.program,'u_pointMax'),gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.POINTS,0,c.count);gl.disable(gl.BLEND);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);gl.useProgram(main);
  const set={u_resolution:[w,h],u_offset:[0,0],u_frame:[w,h],u_line:[0,0,0,0]};
  for(const[k,v]of Object.entries(set))(v.length===2?gl.uniform2fv:gl.uniform4fv).call(gl,U(main,k),v);
  gl.uniform3fv(U(main,'u_view'),S.view);gl.uniform1i(U(main,'u_sampling'),0);gl.uniform1f(U(main,'u_clock'),t);gl.uniform1f(U(main,'u_exposure'),S.exposure);gl.uniform1i(U(main,'u_tone'),S.tone);gl.uniform1i(U(main,'u_debug'),0);gl.uniform1i(U(main,'u_mode'),0);gl.uniform1i(U(main,'u_target'),S.target);gl.uniform1i(U(main,'u_show'),0);
  gl.uniform4uiv(U(main,'u_active'),S.active);gl.uniform4uiv(U(main,'u_enabled'),S.enabled);gl.uniform1i(U(main,'u_type'),S.type);gl.uniform1i(U(main,'u_look'),S.look);gl.uniform1f(U(main,'u_gain'),S.gain);gl.uniform1i(U(main,'u_overBlack'),S.overBlack);gl.uniform4fv(U(main,'u_params'),params);
  clouds.forEach(c=>{gl.activeTexture(gl.TEXTURE4+c.slot);gl.bindTexture(gl.TEXTURE_2D,c.texture);gl.uniform1i(U(main,'u_points'+c.slot),4+c.slot);});
  gl.drawArrays(gl.TRIANGLES,0,3);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>
`;
}
/** Shader code as a file to paste into twigl.app (geekest 300 es), with its
 * credit. twigl has no `param` lines, so each becomes a declaration holding the
 * parameter's current value.
 */
export function codeFile(node) {
    const w = node.work && getWork(node.work);
    const credit = w ? `// ${w.title}: ${creditLine(w)} · ${w.url}\n` : '';
    const lines = node.params.code.split('\n'), rgb = hex => [1, 3, 5].map(k => Number((parseInt(hex.slice(k, k + 2), 16) / 255).toFixed(4))).join(', ');
    for (const p of analyzeCode(node.params.code).params) {
        const value = node.params[p.name] ?? p.value;
        lines[p.line - 1] = p.kind === 'color' ? `vec3 ${p.name} = vec3(${rgb(value)});` : `float ${p.name} = ${Number.isInteger(value) ? `${value}.` : value};`;
    }
    return `${credit}// Shader code from Equation Studio. Paste into twigl.app, mode "geekest (300 es)".\n${lines.join('\n')}\n`;
}
