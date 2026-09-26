import { compileProgram, programKey, subgraph, viewState, withBypassed, comparePassSource, vertexSource, MODES, CONTRIBUTION_STYLES } from './compiler.js';
import { animatedParameters } from './timeline.js';
import { validateProject } from './graph.js';
import { lookUniforms, lookPassSource } from './looks.js';
import { describeRenderer } from './gpu-info.js';
/** A single fullscreen triangle evaluates the field graph independently per pixel.
 * No mesh, image texture, off-site requests, runtime dependency or CPU pixel loop.
 *
 * Programs. One program is compiled per graph structure (compiler.js) and serves
 * every view of it. Compilation is asynchronous where the browser allows it
 * (KHR_parallel_shader_compile): `programFor()` starts it, `poll()` advances it,
 * and a program is "ready" only after one warm-up draw has finished on the GPU,
 * because several drivers finish compiling at the first draw. Synchronous calls
 * (draw, snapshot, probes) simply wait for the program.
 *
 * Views. Most views are one draw of the graph program. "What it changes" draws the
 * image with and without the component into two textures and combines them with
 * a small compare shader; the automatic colors of a non-color stage draw its raw
 * values into a float texture and color them with a small look shader. Both
 * helper shaders are compiled once, so the graph program stays lean.
 *
 * Drawing. `draw()` renders to the visible canvas; `snapshot()`, `previewAtlas()`,
 * `samplePoint()`, `sampleLine()` and `rawImage()` render into temporary
 * framebuffers, so inspection never resizes or disturbs the visible image. The
 * *Async variants read back through a pixel-pack buffer and a fence, so the page
 * never waits for the GPU.
 *
 * Frame options (draw, snapshot, …):
 *   target               node shown (default: the project's output)
 *   contribution, contributionStyle  show what one node changes (two draws)
 *   raw                  output raw values instead of display colors
 *   look                 how non-color values are colored (looks.js); default classic
 *   subgraph             compile only the target's subgraph (smaller, faster to compile)
 *   debug                1: finite values black, nonfinite magenta; 2: alpha
 */
const toneIndex = { source: 0, filmic: 1, linear: 2 };
const BUILTINS = ['u_resolution', 'u_offset', 'u_view', 'u_sampling', 'u_line', 'u_time', 'u_exposure', 'u_tone', 'u_debug', 'u_mode', 'u_target', 'u_active', 'u_enabled', 'u_params', 'u_type', 'u_look', 'u_gain'];
const PASS_UNIFORMS = { look: ['u_field', 'u_origin', 'u_type', 'u_channel', 'u_range', 'u_grid'], compare: ['u_with', 'u_without', 'u_origin', 'u_style'] };
/** Largest line or point probe, in samples. */
export const MAX_LINE_SAMPLES = 4096;
/** readPixels returns the bottom row first; images and ImageData want the top row first. */
function flipRows(pixels, width, height) {
    const out = new pixels.constructor(pixels.length), row = width * 4;
    for (let y = 0; y < height; y++) {
        out.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
    }
    return out;
}
const now = () => performance.now();
export class Renderer {
    constructor(canvas, { programCacheSize = 12 } = {}) {
        this.canvas = canvas;
        this.programCacheSize = programCacheSize;
        this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', premultipliedAlpha: false });
        if (!this.gl) {
            throw new Error('WebGL 2 is unavailable. Enable browser hardware acceleration and use a browser with WebGL 2 support. The Python reference remains available.');
        }
        const gl = this.gl;
        /** Program entries by structural key, least recently used first. */
        this.cache = new Map();
        /** Program entry of the most recent visible draw, or null. */
        this.current = null;
        this.lost = false;
        /** Last measured GPU time of a visible draw in ms, and whether it is exact (timer query) or an upper bound. */
        this.gpuTime = null;
        this.gpuTimeExact = false;
        /** Pixels of the draw that gpuTime measured. */
        this.gpuPixels = 0;
        this.readbacks = [];
        this.timers = [];
        this.configureContext();
        canvas.addEventListener('webglcontextlost', e => {
            e.preventDefault();
            this.lost = true;
            for (const r of this.readbacks) {
                r.reject(new Error('GPU context lost.'));
            }
            this.readbacks = [];
            this.timers = [];
            this.onLost?.();
        });
        canvas.addEventListener('webglcontextrestored', () => {
            this.cache.clear();
            this.current = null;
            this.lost = false;
            this.configureContext();
            this.info.rawFields = this.rawFieldsSupported;
            this.onRestored?.();
        });
        const fp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        const vendor = debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        this.info = {
            backend: 'WebGL 2 / GLSL ES 3.00',
            renderer,
            vendor,
            gpu: describeRenderer(renderer, vendor),
            precisionBits: fp?.precision ?? null,
            rawFields: this.rawFieldsSupported,
            parallelCompile: !!this.parallel,
            gpuTimer: !!this.timerExt,
            maxSize: Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096),
            maxUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)
        };
    }
    /** Fixed-function state and extensions; repeated after a context restoration. */
    configureContext() {
        const gl = this.gl;
        gl.disable(gl.DITHER);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.SCISSOR_TEST);
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        this.rawFieldsSupported = !!gl.getExtension('EXT_color_buffer_float');
        this.parallel = gl.getExtension('KHR_parallel_shader_compile');
        this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        this.warmTarget = null;
        /** The fixed look and compare shaders, compiled on first use. */
        this.passes = {};
        /** Reusable render targets of the multi-draw views, by name. */
        this.targets = new Map();
    }
    // ---- Programs ---------------------------------------------------------------
    /** The program entry for a project, or for the subset of nodes a view needs.
     * Creates it when needed. With `wait` it is linked before returning (this
     * blocks, and throws if compilation failed); otherwise compilation continues
     * in the background and `entry.status` reports 'queued', 'compiling',
     * 'warming', 'ready' or 'failed'.
     */
    programFor(project, { subset = null, wait = false } = {}) {
        const key = programKey(project, subset);
        let entry = this.cache.get(key);
        if (entry) {
            this.cache.delete(key);
            this.cache.set(key, entry); // most recently used goes last
        }
        else {
            entry = { key, compiled: compileProgram(project, { subset }), status: 'queued', program: null, shaders: [], error: null, started: now(), finished: null, fence: null, locations: null, waiters: [] };
            this.cache.set(key, entry);
            this.evict();
            if (this.parallel) {
                this.startCompile(entry); // the driver compiles on its own threads
            }
        }
        if (wait && (entry.status === 'queued' || entry.status === 'compiling')) {
            if (entry.status === 'queued') {
                this.startCompile(entry);
            }
            this.link(entry, false);
        }
        if (wait && entry.status === 'failed') {
            throw entry.error;
        }
        return entry;
    }
    /** Legacy name: the whole-graph program, linked. */
    getProgram(project) {
        return this.programFor(project, { wait: true });
    }
    /** Drop the least recently used programs beyond the cache size, never the one on screen. */
    evict() {
        for (const [key, entry] of this.cache) {
            if (this.cache.size <= this.programCacheSize) {
                break;
            }
            if (entry === this.current) {
                continue;
            }
            this.release(entry);
            this.cache.delete(key);
            this.settle(entry, new Error('Program evicted before it was ready.'));
        }
    }
    /** Delete an entry's GPU objects: program, unfinished shaders and warm-up fence. */
    release(entry) {
        const gl = this.gl;
        if (entry.program) {
            gl.deleteProgram(entry.program);
            entry.program = null;
        }
        for (const s of entry.shaders) {
            gl.deleteShader(s);
        }
        entry.shaders = [];
        if (entry.fence) {
            gl.deleteSync(entry.fence);
            entry.fence = null;
        }
    }
    startCompile(entry) {
        const gl = this.gl, shader = (kind, source) => {
            const s = gl.createShader(kind);
            gl.shaderSource(s, source);
            gl.compileShader(s);
            return s;
        };
        entry.shaders = [shader(gl.VERTEX_SHADER, entry.compiled.vertex), shader(gl.FRAGMENT_SHADER, entry.compiled.fragment)];
        entry.program = gl.createProgram();
        for (const s of entry.shaders) {
            gl.attachShader(entry.program, s);
        }
        gl.linkProgram(entry.program);
        entry.status = 'compiling';
    }
    /** Read the link result (blocking until the driver is done) and, when `warm`,
     * start a one-pixel warm-up draw whose completion poll() waits for.
     */
    link(entry, warm) {
        const gl = this.gl;
        if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
            const log = entry.shaders.map(s => gl.getShaderInfoLog(s)).filter(Boolean).join('\n') || gl.getProgramInfoLog(entry.program);
            gl.deleteProgram(entry.program);
            entry.program = null;
            entry.status = 'failed';
            entry.error = new Error(`Shader compilation failed:\n${log}`);
        }
        else {
            entry.locations = Object.fromEntries(BUILTINS.map(n => [n, gl.getUniformLocation(entry.program, n)]));
            entry.status = 'ready';
        }
        for (const s of entry.shaders) {
            gl.deleteShader(s);
        }
        entry.shaders = [];
        if (entry.status === 'ready' && warm && !this.lost) {
            try {
                this.warmUp(entry);
                entry.status = 'warming';
                return;
            }
            catch (e) { /* A failed warm-up only means the first real draw pays the cost. */
            }
        }
        if (entry.status !== 'warming') {
            entry.finished = now();
            this.settle(entry);
        }
    }
    /** One pixel of every component into a private 1×1 target, then a fence. */
    warmUp(entry) {
        const gl = this.gl;
        if (!this.warmTarget) {
            const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            gl.bindTexture(gl.TEXTURE_2D, null);
            this.warmTarget = { texture, framebuffer };
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.warmTarget.framebuffer);
        gl.viewport(0, 0, 1, 1);
        const loc = entry.locations;
        gl.useProgram(entry.program);
        gl.bindVertexArray(this.vao);
        gl.uniform2f(loc.u_resolution, 1, 1);
        gl.uniform3f(loc.u_view, 0, 0, 1);
        gl.uniform4ui(loc.u_active, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff);
        gl.uniform4ui(loc.u_enabled, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        entry.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
    }
    settle(entry, error = null) {
        for (const w of entry.waiters.splice(0)) {
            if (error || entry.status === 'failed') {
                w.reject(error || entry.error);
            }
            else {
                w.resolve(entry);
            }
        }
    }
    /** Advance background work: compilations, warm-ups, readbacks and GPU timers.
     * Call once per animation frame. Returns true when a program became ready or
     * failed, so the caller can redraw.
     */
    poll() {
        if (this.lost) {
            return false;
        }
        const gl = this.gl;
        let changed = false, compiledOne = false;
        for (const entry of [...this.cache.values()]) {
            if (entry.status === 'queued' && !compiledOne) {
                // Without parallel compilation, compile one program per frame so the
                // page can show that it is busy first.
                compiledOne = true;
                this.startCompile(entry);
                this.link(entry, true);
                changed = true;
            }
            else if (entry.status === 'compiling' && this.parallel && gl.getProgramParameter(entry.program, this.parallel.COMPLETION_STATUS_KHR)) {
                this.link(entry, true);
                changed = true;
            }
            else if (entry.status === 'warming' && gl.getSyncParameter(entry.fence, gl.SYNC_STATUS) === gl.SIGNALED) {
                gl.deleteSync(entry.fence);
                entry.fence = null;
                entry.status = 'ready';
                entry.finished = now();
                this.settle(entry);
                changed = true;
            }
        }
        this.pollReadbacks();
        this.pollTimers();
        return changed;
    }
    /** Entries still compiling or warming up, oldest first. */
    pending() {
        return [...this.cache.values()].filter(e => e.status === 'queued' || e.status === 'compiling' || e.status === 'warming');
    }
    /** A promise for a ready program entry (rejects with the compile error).
     * Resolution happens in poll(), so the page keeps running while it waits.
     */
    whenReady(project, options = {}) {
        const entry = this.programFor(project, options);
        if (entry.status === 'ready') {
            return Promise.resolve(entry);
        }
        if (entry.status === 'failed') {
            return Promise.reject(entry.error);
        }
        return new Promise((resolve, reject) => entry.waiters.push({ resolve, reject }));
    }
    // ---- Drawing ----------------------------------------------------------------
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
    checkOptions(project, options) {
        const { target = project.output, contribution = null, contributionStyle = 'highlight' } = options;
        if (!project.nodes.some(n => n.id === target)) {
            throw new Error(`Unknown component ${target}.`);
        }
        if (contribution && !project.nodes.some(n => n.id === contribution)) {
            throw new Error(`Unknown contribution node ${contribution}.`);
        }
        if (!CONTRIBUTION_STYLES.includes(contributionStyle)) {
            throw new Error(`Unknown contribution style ${contributionStyle}.`);
        }
        return target;
    }
    subsetFor(project, options) {
        return options.subgraph ? subgraph(project, options.target ?? project.output) : null;
    }
    /** Parameter values at `time`, packed as the program's u_params array. */
    packParams(compiled, project, time) {
        const data = new Float32Array(compiled.vectors * 4), values = new Map();
        for (const slot of compiled.params) {
            if (!values.has(slot.node)) {
                values.set(slot.node, animatedParameters(project, project.nodes.find(n => n.id === slot.node), time));
            }
            const value = values.get(slot.node)[slot.param], base = slot.vector * 4;
            if (slot.kind === 'color') {
                [1, 3, 5].forEach((k, c) => data[base + c] = parseInt(value.slice(k, k + 2), 16) / 255);
            }
            else {
                data[base + slot.component] = value;
            }
        }
        return data;
    }
    /** Upload uniforms and issue the draw call into the currently bound framebuffer
     * and viewport. `offset` is the tile origin inside that framebuffer.
     */
    execute(entry, project, time, width, height, frame = {}, offset = [0, 0], params = null) {
        const gl = this.gl, loc = entry.locations, compiled = entry.compiled;
        const target = frame.target ?? project.output, state = viewState(compiled, project, target, frame.contribution);
        const look = lookUniforms(compiled.types[target], frame.look);
        gl.useProgram(entry.program);
        gl.bindVertexArray(this.vao);
        gl.uniform2f(loc.u_resolution, width, height);
        gl.uniform2f(loc.u_offset, offset[0], offset[1]);
        gl.uniform3f(loc.u_view, project.view.x, project.view.y, project.view.zoom);
        gl.uniform1i(loc.u_sampling, frame.line ? 1 : 0);
        gl.uniform4fv(loc.u_line, frame.line || [0, 0, 0, 0]);
        gl.uniform1f(loc.u_time, time);
        gl.uniform1f(loc.u_exposure, project.exposure);
        gl.uniform1i(loc.u_tone, toneIndex[project.tone]);
        gl.uniform1i(loc.u_debug, frame.debug || 0);
        gl.uniform1i(loc.u_mode, frame.raw ? MODES.raw : MODES.display);
        gl.uniform1i(loc.u_target, compiled.index[target]);
        gl.uniform4uiv(loc.u_active, state.active);
        gl.uniform4uiv(loc.u_enabled, state.enabled);
        gl.uniform1i(loc.u_type, look.type);
        gl.uniform1i(loc.u_look, look.look);
        gl.uniform1f(loc.u_gain, look.gain);
        gl.uniform4fv(loc.u_params, params || this.packParams(compiled, project, time));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return state;
    }
    describe(entry, project, target, frame, state) {
        return {
            fragment: entry.compiled.fragment,
            key: entry.key,
            target,
            type: entry.compiled.types[target],
            order: state.order,
            raw: !!frame.raw && !frame.contribution,
            contribution: frame.contribution || null,
            contributionStyle: frame.contribution ? (frame.contributionStyle || 'highlight') : null,
            reachable: state.reachable
        };
    }
    /** Render to the visible canvas, resizing it when needed, and wait for the
     * program if it is still compiling. Returns a description of the frame
     * {fragment, target, type, order, raw, contribution, contributionStyle, reachable}.
     */
    draw(project, time, width = this.canvas.width, height = this.canvas.height, options = {}) {
        this.checkArguments(project, time, width, height);
        const target = this.checkOptions(project, options);
        // Compile before resizing: invalid custom equations preserve the last good canvas.
        const entry = this.programFor(project, { subset: this.subsetFor(project, options), wait: true });
        return this.present(entry, project, time, width, height, { ...options, target });
    }
    /** Like draw(), but only when the program is ready; otherwise start or continue
     * compiling it in the background and return null, leaving the canvas as it is.
     * Throws the compile error of a failed program.
     */
    drawIfReady(project, time, width = this.canvas.width, height = this.canvas.height, options = {}) {
        this.checkArguments(project, time, width, height);
        const target = this.checkOptions(project, options);
        const entry = this.programFor(project, { subset: this.subsetFor(project, options) });
        if (entry.status === 'failed') {
            throw entry.error;
        }
        if (entry.status !== 'ready') {
            return null;
        }
        return this.present(entry, project, time, width, height, { ...options, target });
    }
    present(entry, project, time, width, height, frame) {
        const gl = this.gl;
        if (this.canvas.width !== width) {
            this.canvas.width = width;
        }
        if (this.canvas.height !== height) {
            this.canvas.height = height;
        }
        const timer = frame.timed ? this.beginTimer(width * height) : null;
        const state = this.renderView(entry, project, time, width, height, frame, null);
        if (timer) {
            this.endTimer(timer);
        }
        this.current = entry;
        return this.describe(entry, project, frame.target, frame, state);
    }
    // ---- Views: one draw, or several draws and a small pass ------------------------
    /** A texture and framebuffer of the given size and format ('rgba8', 'rgba16f'
     * or 'rgba32f'), reused across frames.
     */
    renderTarget(name, width, height, format) {
        const gl = this.gl, formats = { rgba8: [gl.RGBA8, gl.UNSIGNED_BYTE], rgba16f: [gl.RGBA16F, gl.HALF_FLOAT], rgba32f: [gl.RGBA32F, gl.FLOAT] };
        let t = this.targets.get(name);
        if (t && (t.width !== width || t.height !== height || t.format !== format)) {
            gl.deleteFramebuffer(t.framebuffer);
            gl.deleteTexture(t.texture);
            t = null;
        }
        if (!t) {
            const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, formats[format][0], width, height, 0, gl.RGBA, formats[format][1], null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            gl.bindTexture(gl.TEXTURE_2D, null);
            t = { texture, framebuffer, width, height, format };
            this.targets.set(name, t);
        }
        return t;
    }
    /** One of the fixed helper shaders ('look' or 'compare'), linked on first use. */
    passProgram(kind) {
        if (this.passes[kind]) {
            return this.passes[kind];
        }
        const gl = this.gl, shader = (type, source) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, source);
            gl.compileShader(s);
            return s;
        };
        const vs = shader(gl.VERTEX_SHADER, vertexSource), fs = shader(gl.FRAGMENT_SHADER, kind === 'look' ? lookPassSource : comparePassSource), program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        const ok = gl.getProgramParameter(program, gl.LINK_STATUS), log = ok ? '' : gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!ok) {
            gl.deleteProgram(program);
            throw new Error(`The ${kind} shader failed to compile:\n${log}`);
        }
        this.passes[kind] = { program, locations: Object.fromEntries(PASS_UNIFORMS[kind].map(n => [n, gl.getUniformLocation(program, n)])) };
        return this.passes[kind];
    }
    /** Bind texture `t` to unit `unit` for sampler uniform `location`. */
    bindTexture(unit, t, location) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t.texture);
        gl.uniform1i(location, unit);
    }
    /** Draw one view of `project` into `output` ({framebuffer, x, y}, or null for the
     * canvas) at the given size. Returns the view state of the target.
     */
    renderView(entry, project, time, width, height, frame, output) {
        const gl = this.gl, out = output || { framebuffer: null, x: 0, y: 0 };
        const target = frame.target ?? project.output, type = entry.compiled.types[target];
        const into = t => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
            gl.viewport(0, 0, width, height);
        };
        const finish = () => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
            gl.viewport(out.x, out.y, width, height);
        };
        if (frame.contribution && !frame.raw) {
            // Float images keep the comparison unquantized (small differences near the
            // highlight threshold survive); bytes where float targets are unavailable.
            const format = this.info.rawFields ? 'rgba32f' : 'rgba8';
            const a = this.renderTarget('with', width, height, format), b = this.renderTarget('without', width, height, format);
            const plain = { target, debug: frame.debug };
            into(a);
            const state = this.execute(entry, project, time, width, height, plain);
            into(b);
            this.execute(entry, withBypassed(project, frame.contribution), time, width, height, plain);
            finish();
            const pass = this.passProgram('compare');
            gl.useProgram(pass.program);
            this.bindTexture(0, a, pass.locations.u_with);
            this.bindTexture(1, b, pass.locations.u_without);
            gl.uniform2f(pass.locations.u_origin, out.x, out.y);
            gl.uniform1i(pass.locations.u_style, frame.contributionStyle === 'signed' ? 1 : 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.activeTexture(gl.TEXTURE0);
            return { ...state, reachable: state.order.includes(frame.contribution) };
        }
        if (frame.look?.mode === 'auto' && type !== 'layer' && !frame.raw && !frame.debug && this.info.rawFields) {
            const field = this.renderTarget('field', width, height, 'rgba32f');
            into(field);
            const state = this.execute(entry, project, time, width, height, { ...frame, raw: true });
            finish();
            const pass = this.passProgram('look'), look = lookUniforms(type, frame.look), loc = pass.locations;
            gl.useProgram(pass.program);
            this.bindTexture(0, field, loc.u_field);
            gl.uniform2f(loc.u_origin, out.x, out.y);
            gl.uniform1i(loc.u_type, look.type);
            gl.uniform1i(loc.u_channel, look.channel);
            gl.uniform4fv(loc.u_range, look.range);
            gl.uniform1f(loc.u_grid, look.grid);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.bindTexture(gl.TEXTURE_2D, null);
            return state;
        }
        finish();
        return this.execute(entry, project, time, width, height, frame, [out.x, out.y]);
    }
    /** Run `body` with a temporary color attachment bound, then read it back
     * (bottom row first). Float attachments need EXT_color_buffer_float. With
     * `async` the read goes through a pixel-pack buffer and a Promise is returned.
     */
    offscreen(width, height, float, body, async = false) {
        const gl = this.gl;
        if (float && !this.info.rawFields) {
            throw new Error('Raw field readback needs EXT_color_buffer_float, unavailable on this browser/GPU.');
        }
        const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
        let buffer = null;
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
            body(framebuffer);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            const type = float ? gl.FLOAT : gl.UNSIGNED_BYTE, length = width * height * 4;
            if (!async) {
                const out = float ? new Float32Array(length) : new Uint8Array(length);
                gl.readPixels(0, 0, width, height, gl.RGBA, type, out);
                return out;
            }
            buffer = gl.createBuffer();
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
            gl.bufferData(gl.PIXEL_PACK_BUFFER, length * (float ? 4 : 1), gl.STREAM_READ);
            gl.readPixels(0, 0, width, height, gl.RGBA, type, 0);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.flush();
            const pending = buffer;
            buffer = null;
            return new Promise((resolve, reject) => this.readbacks.push({ fence, buffer: pending, length, float, resolve, reject }));
        }
        finally {
            gl.disable(gl.SCISSOR_TEST);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.deleteFramebuffer(framebuffer);
            gl.deleteTexture(texture);
            if (buffer) {
                gl.deleteBuffer(buffer);
            }
        }
    }
    pollReadbacks() {
        const gl = this.gl;
        this.readbacks = this.readbacks.filter(r => {
            if (gl.getSyncParameter(r.fence, gl.SYNC_STATUS) !== gl.SIGNALED) {
                return true;
            }
            const out = r.float ? new Float32Array(r.length) : new Uint8Array(r.length);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, r.buffer);
            gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.deleteBuffer(r.buffer);
            gl.deleteSync(r.fence);
            r.resolve(out);
            return false;
        });
    }
    /** Render offscreen and return top-down RGBA bytes (ImageData layout), or raw
     * floats with `options.raw` (needs EXT_color_buffer_float).
     */
    snapshot(project, time, width, height, options = {}) {
        this.checkArguments(project, time, width, height);
        const target = this.checkOptions(project, options), gl = this.gl, float = !!options.raw && !options.contribution;
        const entry = this.programFor(project, { subset: this.subsetFor(project, options), wait: true });
        const pixels = this.offscreen(width, height, float, framebuffer => {
            this.renderView(entry, project, time, width, height, { ...options, target, raw: float }, { framebuffer, x: 0, y: 0 });
        });
        return { width, height, data: float ? flipRows(pixels, width, height) : new Uint8ClampedArray(flipRows(pixels, width, height).buffer) };
    }
    /** Thumbnails of several nodes from one program and one readback. Returns a Map
     * of node id → {width, height, data} in ImageData layout: display bytes, or raw
     * floats (Float32Array) with `options.raw`. `options.look(id)` may return a look
     * per tile. With `options.async` the result is a Promise and nothing blocks.
     */
    previewAtlas(project, time, ids, tileWidth, tileHeight, options = {}) {
        this.checkArguments(project, time, tileWidth, tileHeight);
        if (!ids.length) {
            return options.async ? Promise.resolve(new Map()) : new Map();
        }
        const float = !!options.raw, gl = this.gl;
        const entry = this.programFor(project, { wait: true });
        const columns = Math.max(1, Math.min(ids.length, Math.floor(this.info.maxSize / tileWidth)));
        const rows = Math.ceil(ids.length / columns), width = columns * tileWidth, height = rows * tileHeight;
        if (height > this.info.maxSize) {
            throw new Error('Too many previews for one atlas.');
        }
        const params = this.packParams(entry.compiled, project, time);
        const result = this.offscreen(width, height, float, () => {
            gl.enable(gl.SCISSOR_TEST);
            ids.forEach((id, i) => {
                const x = (i % columns) * tileWidth, y = Math.floor(i / columns) * tileHeight;
                gl.viewport(x, y, tileWidth, tileHeight);
                gl.scissor(x, y, tileWidth, tileHeight);
                this.execute(entry, project, time, tileWidth, tileHeight, { target: id, raw: float, look: options.look?.(id) }, [x, y], params);
            });
            gl.disable(gl.SCISSOR_TEST);
        }, !!options.async);
        const split = pixels => {
            const tiles = new Map(), stride = width * 4;
            ids.forEach((id, i) => {
                const x0 = (i % columns) * tileWidth, y0 = Math.floor(i / columns) * tileHeight;
                const data = float ? new Float32Array(tileWidth * tileHeight * 4) : new Uint8ClampedArray(tileWidth * tileHeight * 4);
                for (let y = 0; y < tileHeight; y++) {
                    const source = (y0 + y) * stride + x0 * 4;
                    data.set(pixels.subarray(source, source + tileWidth * 4), (tileHeight - 1 - y) * tileWidth * 4);
                }
                tiles.set(id, { width: tileWidth, height: tileHeight, data, type: entry.compiled.types[id] });
            });
            return tiles;
        };
        return options.async ? result.then(split) : split(result);
    }
    /** Raw values of `target` at `count` points evenly spaced along the segment from
     * `a` to `b` (world coordinates; sample i sits at (i + ½)/count). Returns a
     * Float32Array of count × RGBA, or a Promise of one with `async`. The values are
     * those before diagnostic mapping, exposure, tone mapping and quantization.
     */
    sampleLine(project, time, target, a, b, count, { async = false } = {}) {
        if (!this.info.rawFields) {
            throw new Error('Raw field probes need EXT_color_buffer_float, unavailable on this browser/GPU.');
        }
        const points = [...a, ...b];
        if (!points.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6)) {
            throw new Error('Probe points must be finite world coordinates.');
        }
        if (!Number.isInteger(count) || count < 1 || count > MAX_LINE_SAMPLES) {
            throw new Error(`A line probe takes 1–${MAX_LINE_SAMPLES} samples.`);
        }
        this.checkArguments(project, time, count, 1);
        this.checkOptions(project, { target });
        const entry = this.programFor(project, { wait: true }), gl = this.gl;
        return this.offscreen(count, 1, true, () => {
            gl.viewport(0, 0, count, 1);
            this.execute(entry, project, time, count, 1, { target, raw: true, line: points });
        }, async);
    }
    /** Actual field values at one world coordinate: [4 numbers]. */
    samplePoint(project, time, target, x, y) {
        return [...this.sampleLine(project, time, target, [x, y], [x, y], 1)];
    }
    /** Raw values of `target` over the camera view at a small size (top row first),
     * for statistics. Returns a Float32Array, or a Promise of one with `async`.
     */
    rawImage(project, time, target, width, height, { async = false } = {}) {
        this.checkArguments(project, time, width, height);
        this.checkOptions(project, { target });
        const entry = this.programFor(project, { wait: true }), gl = this.gl;
        const result = this.offscreen(width, height, true, () => {
            gl.viewport(0, 0, width, height);
            this.execute(entry, project, time, width, height, { target, raw: true });
        }, async);
        return async ? result.then(p => flipRows(p, width, height)) : flipRows(result, width, height);
    }
    // ---- GPU timing ---------------------------------------------------------------
    /** Measure the next draw: an exact timer query when EXT_disjoint_timer_query_webgl2
     * is available, else the time until a fence signals (an upper bound).
     */
    beginTimer(pixels = 0) {
        const gl = this.gl;
        if (this.timerExt) {
            if (this.timers.length >= 4 || this.timers.some(t => !t.ended)) {
                return null;
            }
            const query = gl.createQuery();
            gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, query);
            const timer = { query, ended: false, pixels };
            this.timers.push(timer);
            return timer;
        }
        if (this.timers.length) {
            return null;
        }
        const timer = { start: now(), fence: null, pixels };
        this.timers.push(timer);
        return timer;
    }
    endTimer(timer) {
        const gl = this.gl;
        if (timer.query) {
            gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
            timer.ended = true;
        }
        else {
            timer.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.flush();
        }
    }
    pollTimers() {
        const gl = this.gl;
        this.timers = this.timers.filter(t => {
            if (t.query) {
                if (!t.ended || !gl.getQueryParameter(t.query, gl.QUERY_RESULT_AVAILABLE)) {
                    return true;
                }
                const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
                if (!disjoint) {
                    this.gpuTime = gl.getQueryParameter(t.query, gl.QUERY_RESULT) / 1e6;
                    this.gpuTimeExact = true;
                    this.gpuPixels = t.pixels;
                }
                gl.deleteQuery(t.query);
                return false;
            }
            if (!t.fence || gl.getSyncParameter(t.fence, gl.SYNC_STATUS) !== gl.SIGNALED) {
                return true;
            }
            this.gpuTime = now() - t.start;
            this.gpuTimeExact = false;
            this.gpuPixels = t.pixels;
            gl.deleteSync(t.fence);
            return false;
        });
    }
    // ---- Visible canvas -----------------------------------------------------------
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
        const gl = this.gl;
        for (const e of this.cache.values()) {
            this.release(e);
            this.settle(e, new Error('Renderer disposed.'));
        }
        this.cache.clear();
        for (const r of this.readbacks) {
            gl.deleteBuffer(r.buffer);
            gl.deleteSync(r.fence);
            r.reject(new Error('Renderer disposed.'));
        }
        this.readbacks = [];
        for (const t of this.timers) {
            if (t.query) {
                gl.deleteQuery(t.query);
            }
            if (t.fence) {
                gl.deleteSync(t.fence);
            }
        }
        this.timers = [];
        if (this.warmTarget) {
            gl.deleteFramebuffer(this.warmTarget.framebuffer);
            gl.deleteTexture(this.warmTarget.texture);
        }
        for (const t of this.targets.values()) {
            gl.deleteFramebuffer(t.framebuffer);
            gl.deleteTexture(t.texture);
        }
        for (const pass of Object.values(this.passes)) {
            gl.deleteProgram(pass.program);
        }
        gl.deleteVertexArray(this.vao);
    }
}
