import { compileGraph } from './compiler.js';
import { animatedParameters } from './timeline.js';
import { validateProject } from './graph.js';
/** A single fullscreen triangle evaluates the field graph independently per pixel.
 * No mesh, image texture, off-site requests, runtime dependency or CPU pixel loop.
 *
 * `draw()` renders to the visible canvas. `snapshot()`, `previewAtlas()` and
 * `samplePoint()` render into temporary framebuffers, so inspection never resizes
 * or disturbs the visible image. Linked programs are cached by graph structure;
 * numeric edits only upload uniforms.
 */
const toneIndex = { source: 0, filmic: 1, linear: 2 };
const builtinUniforms = ['u_resolution', 'u_offset', 'u_view', 'u_time', 'u_exposure', 'u_tone', 'u_debug', 'u_previewIndex'];
/** readPixels returns the bottom row first; images and ImageData want the top row first. */
function flipRows(pixels, width, height) {
    const out = new Uint8ClampedArray(pixels.length), row = width * 4;
    for (let y = 0; y < height; y++) {
        out.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
    }
    return out;
}
export class Renderer {
    constructor(canvas, { programCacheSize = 32 } = {}) {
        this.canvas = canvas;
        this.programCacheSize = programCacheSize;
        this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', premultipliedAlpha: false });
        if (!this.gl) {
            throw new Error('WebGL 2 is unavailable. Enable browser hardware acceleration and use a browser with WebGL 2 support. The Python reference remains available.');
        }
        const gl = this.gl;
        this.cache = new Map();
        /** Program entry of the most recent visible draw, or null. */
        this.current = null;
        this.lost = false;
        this.configureContext();
        canvas.addEventListener('webglcontextlost', e => {
            e.preventDefault();
            this.lost = true;
            this.onLost?.();
        });
        canvas.addEventListener('webglcontextrestored', () => {
            this.cache.clear();
            this.current = null;
            this.lost = false;
            this.configureContext();
            this.info.rawFields = !!gl.getExtension('EXT_color_buffer_float');
            this.onRestored?.();
        });
        const fp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        this.info = {
            backend: 'WebGL 2 / GLSL ES 3.00',
            renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            precisionBits: fp?.precision ?? null,
            rawFields: !!gl.getExtension('EXT_color_buffer_float'),
            maxSize: Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096),
            maxUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)
        };
    }
    /** Fixed-function state; repeated after a context restoration. */
    configureContext() {
        const gl = this.gl;
        gl.disable(gl.DITHER);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.SCISSOR_TEST);
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
    }
    /** Everything that changes the generated shader; numeric values are excluded. */
    structuralKey(project, target, options = {}) {
        const { raw = false, contribution = null, contributionStyle = 'highlight', preview = false } = options;
        return JSON.stringify({
            target: preview ? null : target, raw, contribution, contributionStyle: contribution ? contributionStyle : null, preview,
            nodes: project.nodes.map(n => ({ id: n.id, type: n.type, inputs: n.inputs, enabled: n.enabled, expression: n.params.expression }))
        });
    }
    /** Compile, link and cache the program for one graph structure. Throws with the
     * driver log when a custom expression fails, leaving the previous image intact.
     */
    getProgram(project, target, options = {}) {
        const key = this.structuralKey(project, target, options);
        if (this.cache.has(key)) {
            const entry = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, entry); // most recently used goes last
            return entry;
        }
        const compiled = compileGraph(project, target, options), gl = this.gl;
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
        const names = [...builtinUniforms, ...compiled.uniforms.map(u => u.name)];
        const entry = { program, compiled, locations: Object.fromEntries(names.map(n => [n, gl.getUniformLocation(program, n)])) };
        this.cache.set(key, entry);
        while (this.cache.size > this.programCacheSize) {
            const oldest = this.cache.keys().next().value;
            gl.deleteProgram(this.cache.get(oldest).program);
            this.cache.delete(oldest);
        }
        return entry;
    }
    checkArguments(project, time, width, height) {
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
    }
    /** Upload uniforms and issue the draw call into the currently bound framebuffer
     * and viewport. `offset` is the tile origin inside that framebuffer.
     */
    execute(entry, project, time, width, height, { debug = 0, previewIndex = 0 } = {}, offset = [0, 0]) {
        const gl = this.gl, loc = entry.locations;
        gl.useProgram(entry.program);
        gl.bindVertexArray(this.vao);
        gl.uniform2f(loc.u_resolution, width, height);
        gl.uniform2f(loc.u_offset, offset[0], offset[1]);
        gl.uniform3f(loc.u_view, project.view.x, project.view.y, project.view.zoom);
        gl.uniform1f(loc.u_time, time);
        gl.uniform1f(loc.u_exposure, project.exposure);
        gl.uniform1i(loc.u_tone, toneIndex[project.tone]);
        gl.uniform1i(loc.u_debug, debug);
        gl.uniform1i(loc.u_previewIndex, previewIndex);
        const values = new Map(project.nodes.map(n => [n.id, animatedParameters(project, n, time)]));
        for (const u of entry.compiled.uniforms) {
            const value = values.get(u.node)[u.param];
            if (u.type === 'vec3') {
                gl.uniform3fv(loc[u.name], [1, 3, 5].map(k => parseInt(value.slice(k, k + 2), 16) / 255));
            }
            else {
                gl.uniform1f(loc[u.name], value);
            }
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    /** Render to the visible canvas, resizing it when needed.
     * Options: target (node id, default project.output), debug (0 normal,
     * 1 finite→black nonfinite→magenta, 2 alpha), raw, contribution,
     * contributionStyle. Returns the compiled description.
     */
    draw(project, time, width = this.canvas.width, height = this.canvas.height, options = {}) {
        this.checkArguments(project, time, width, height);
        const { target = project.output, debug = 0 } = options;
        // Compile before resizing: invalid custom equations preserve the last good canvas.
        const entry = this.getProgram(project, target, options), gl = this.gl;
        if (this.canvas.width !== width) {
            this.canvas.width = width;
        }
        if (this.canvas.height !== height) {
            this.canvas.height = height;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        this.execute(entry, project, time, width, height, { debug });
        this.current = entry;
        return entry.compiled;
    }
    /** Run `body` with a temporary color attachment bound, then read it back.
     * Float attachments need EXT_color_buffer_float. The visible canvas is untouched.
     */
    offscreen(width, height, float, body) {
        const gl = this.gl, texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
        try {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA32F : gl.RGBA8, width, height, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error(float ? 'The GPU rejected a floating-point probe framebuffer.' : 'The GPU rejected an offscreen framebuffer.');
            }
            body();
            const out = float ? new Float32Array(width * height * 4) : new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, out);
            return out;
        }
        finally {
            gl.disable(gl.SCISSOR_TEST);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.deleteFramebuffer(framebuffer);
            gl.deleteTexture(texture);
        }
    }
    /** Render offscreen and return top-down RGBA bytes (ImageData layout). */
    snapshot(project, time, width, height, options = {}) {
        this.checkArguments(project, time, width, height);
        const { target = project.output, debug = 0 } = options, entry = this.getProgram(project, target, options), gl = this.gl;
        const pixels = this.offscreen(width, height, false, () => {
            gl.viewport(0, 0, width, height);
            this.execute(entry, project, time, width, height, { debug });
        });
        return { width, height, data: flipRows(pixels, width, height) };
    }
    /** Thumbnails of several nodes from one shared program and one readback.
     * Returns a Map of node id → {width, height, data} in ImageData layout.
     */
    previewAtlas(project, time, ids, tileWidth, tileHeight) {
        this.checkArguments(project, time, tileWidth, tileHeight);
        if (!ids.length) {
            return new Map();
        }
        const entry = this.getProgram(project, null, { preview: true }), index = entry.compiled.previewIndex, gl = this.gl;
        const columns = Math.max(1, Math.min(ids.length, Math.floor(this.info.maxSize / tileWidth)));
        const rows = Math.ceil(ids.length / columns), width = columns * tileWidth, height = rows * tileHeight;
        if (height > this.info.maxSize) {
            throw new Error('Too many previews for one atlas.');
        }
        const pixels = this.offscreen(width, height, false, () => {
            gl.enable(gl.SCISSOR_TEST);
            ids.forEach((id, i) => {
                const x = (i % columns) * tileWidth, y = Math.floor(i / columns) * tileHeight;
                gl.viewport(x, y, tileWidth, tileHeight);
                gl.scissor(x, y, tileWidth, tileHeight);
                this.execute(entry, project, time, tileWidth, tileHeight, { previewIndex: index[id] ?? -1 }, [x, y]);
            });
            gl.disable(gl.SCISSOR_TEST);
        });
        const tiles = new Map(), stride = width * 4;
        ids.forEach((id, i) => {
            const x0 = (i % columns) * tileWidth, y0 = Math.floor(i / columns) * tileHeight, data = new Uint8ClampedArray(tileWidth * tileHeight * 4);
            for (let y = 0; y < tileHeight; y++) {
                const source = (y0 + y) * stride + x0 * 4;
                data.set(pixels.subarray(source, source + tileWidth * 4), (tileHeight - 1 - y) * tileWidth * 4);
            }
            tiles.set(id, { width: tileWidth, height: tileHeight, data });
        });
        return tiles;
    }
    /** Read actual field values at one world coordinate, before diagnostic mapping,
     * exposure, tone mapping and quantization. Requires EXT_color_buffer_float.
     * A one-pixel floating-point framebuffer avoids downloading a full float image.
     */
    samplePoint(project, time, target, x, y) {
        if (!this.info.rawFields) {
            throw new Error('Raw field probes need EXT_color_buffer_float, unavailable on this browser/GPU.');
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 19 || Math.abs(y) > 19) {
            throw new Error('Probe point must be finite and within world coordinates ±19.');
        }
        // Center a unit-zoom, one-pixel view on the point; the shader's half-pixel offset cancels.
        const probe = { ...project, view: { x: x - 1 / 840, y: y - 1 / 840, zoom: 1 } };
        this.checkArguments(probe, time, 1, 1);
        const entry = this.getProgram(probe, target, { raw: true }), gl = this.gl;
        const out = this.offscreen(1, 1, true, () => {
            gl.viewport(0, 0, 1, 1);
            this.execute(entry, probe, time, 1, 1);
        });
        return [...out];
    }
    /** Bottom-up RGBA bytes of the visible canvas. */
    pixels() {
        const gl = this.gl, a = new Uint8Array(this.canvas.width * this.canvas.height * 4);
        gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, a);
        return a;
    }
    /** Displayed RGBA bytes at one framebuffer pixel (origin bottom-left). */
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
