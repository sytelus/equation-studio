import { compileGraph } from './compiler.js';
import { animatedParameters } from './timeline.js';
import { validateProject } from './graph.js';
/** A single fullscreen triangle evaluates the field graph independently per pixel.
 * No mesh, image texture, off-site requests, runtime dependency or CPU pixel loop.
 */
export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', premultipliedAlpha: false });
        if (!this.gl) {
            throw new Error('WebGL 2 is unavailable. Enable browser hardware acceleration and use a browser with WebGL 2 support. The Python reference remains available.');
        }
        const gl = this.gl;
        this.cache = new Map();
        this.current = null;
        this.lost = false;
        gl.disable(gl.DITHER);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        canvas.addEventListener('webglcontextlost', e => {
            e.preventDefault();
            this.lost = true;
            this.onLost?.();
        });
        canvas.addEventListener('webglcontextrestored', () => {
            this.cache.clear();
            this.current = null;
            this.lost = false;
            this.info.rawFields = !!gl.getExtension('EXT_color_buffer_float');
            gl.disable(gl.DITHER);
            this.vao = gl.createVertexArray();
            gl.bindVertexArray(this.vao);
            this.onRestored?.();
        });
        const fp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        this.info = { backend: 'WebGL 2 / GLSL ES 3.00', renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), precisionBits: fp?.precision ?? null, rawFields: !!gl.getExtension('EXT_color_buffer_float'), maxSize: Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096), maxUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) };
    }
    structuralKey(project, target, raw = false) {
        return JSON.stringify({ target, raw, nodes: project.nodes.map(n => ({ id: n.id, type: n.type, inputs: n.inputs, enabled: n.enabled, expression: n.params.expression })) });
    }
    getProgram(project, target, raw = false) {
        const key = this.structuralKey(project, target, raw);
        if (this.cache.has(key)) {
            const entry = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, entry);
            return entry;
        }
        const compiled = compileGraph(project, target, raw), gl = this.gl;
        const shader = (kind, source) => {
            const s = gl.createShader(kind);
            gl.shaderSource(s, source);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(s);
                gl.deleteShader(s);
                throw new Error(`Shader compilation failed:\n${log}`);
            }
            return s;
        };
        let vs = null, fs = null, program = null;
        try {
            vs = shader(gl.VERTEX_SHADER, compiled.vertex);
            fs = shader(gl.FRAGMENT_SHADER, compiled.fragment);
            program = gl.createProgram();
            gl.attachShader(program, vs);
            gl.attachShader(program, fs);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                throw new Error(`Shader link failed:\n${gl.getProgramInfoLog(program)}`);
            }
        }
        catch (e) {
            if (program) {
                gl.deleteProgram(program);
            }
            throw e;
        }
        finally {
            if (vs) {
                gl.deleteShader(vs);
            }
            if (fs) {
                gl.deleteShader(fs);
            }
        }
        const names = ['u_resolution', 'u_view', 'u_time', 'u_exposure', 'u_tone', 'u_debug', ...compiled.uniforms.map(u => u.name)];
        const entry = { program, compiled, locations: Object.fromEntries(names.map(n => [n, gl.getUniformLocation(program, n)])) };
        this.cache.set(key, entry);
        if (this.cache.size > 8) {
            const old = this.cache.keys().next().value;
            gl.deleteProgram(this.cache.get(old).program);
            this.cache.delete(old);
        }
        return entry;
    }
    draw(project, time, width = this.canvas.width, height = this.canvas.height, target = project.output, debug = 0, raw = false) {
        validateProject(project);
        if (this.lost) {
            throw new Error('GPU context lost. Playback is paused; wait for browser restoration or reload the page.');
        }
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > this.info.maxSize || height > this.info.maxSize) {
            throw new Error(`Render dimensions must be 1–${this.info.maxSize} pixels per side.`);
        }
        if (!Number.isFinite(time)) {
            throw new Error('Time must be finite.');
        }
        // Compile before resizing: invalid custom equations preserve the last good canvas.
        const entry = this.getProgram(project, target, raw), gl = this.gl;
        if (this.canvas.width !== width) {
            this.canvas.width = width;
        }
        if (this.canvas.height !== height) {
            this.canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.useProgram(entry.program);
        gl.bindVertexArray(this.vao);
        const loc = entry.locations;
        gl.uniform2f(loc.u_resolution, width, height);
        gl.uniform3f(loc.u_view, project.view.x, project.view.y, project.view.zoom);
        gl.uniform1f(loc.u_time, time);
        gl.uniform1f(loc.u_exposure, project.exposure);
        gl.uniform1i(loc.u_tone, { source: 0, filmic: 1, linear: 2 }[project.tone]);
        gl.uniform1i(loc.u_debug, debug);
        const values = new Map(project.nodes.map(n => [n.id, animatedParameters(project, n, time)]));
        for (const u of entry.compiled.uniforms) {
            const value = values.get(u.node)[u.param];
            if (u.type === 'vec3') {
                const rgb = [1, 3, 5].map(k => parseInt(value.slice(k, k + 2), 16) / 255);
                gl.uniform3fv(loc[u.name], rgb);
            }
            else {
                gl.uniform1f(loc[u.name], value);
            }
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.current = entry;
        this.last = { project, time, width, height, target, debug, raw };
        return entry.compiled;
    }
    /** Read actual field values at one world coordinate, before diagnostic mapping,
     * exposure, tone mapping and quantization. Requires EXT_color_buffer_float.
     * A one-pixel floating-point framebuffer avoids downloading a full float image.
     * The previous visible render is restored even when sampling fails.
     */
    samplePoint(project, time, target, x, y) {
        if (!this.info.rawFields) {
            throw new Error('Raw field probes need EXT_color_buffer_float, unavailable on this browser/GPU.');
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 19 || Math.abs(y) > 19) {
            throw new Error('Probe point must be finite and within world coordinates ±19.');
        }
        const gl = this.gl, last = this.last, probe = { ...project, view: { x: x - 1 / 840, y: y - 1 / 840, zoom: 1 } };
        const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
        try {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error('The GPU rejected a floating-point probe framebuffer.');
            }
            this.draw(probe, time, 1, 1, target, 0, true);
            const out = new Float32Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
            return [...out];
        }
        finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.deleteFramebuffer(framebuffer);
            gl.deleteTexture(texture);
            if (last) {
                this.draw(last.project, last.time, last.width, last.height, last.target, last.debug, last.raw);
            }
        }
    }
    pixels() {
        const gl = this.gl, a = new Uint8Array(this.canvas.width * this.canvas.height * 4);
        gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, a);
        return a;
    }
    probe(x, y) {
        const gl = this.gl, a = new Uint8Array(4);
        gl.readPixels(Math.max(0, Math.min(this.canvas.width - 1, Math.floor(x))), Math.max(0, Math.min(this.canvas.height - 1, Math.floor(y))), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a);
        return [...a];
    }
    async png() {
        return new Promise((resolve, reject) => this.canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed.')), 'image/png'));
    }
    dispose() {
        for (const e of this.cache.values()) {
            this.gl.deleteProgram(e.program);
        }
        this.cache.clear();
        this.gl.deleteVertexArray(this.vao);
    }
}
