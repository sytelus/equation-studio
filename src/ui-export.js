import { $, state, showError, pause, viewOptions, currentNode } from './editor.js';
import { clone, aspectOf } from './graph.js';
import { catalog } from './catalog.js';
import { makeZip, download, fileStem, frameTimes, embedPNGMetadata } from './export.js';
import { encodeGIF, assembleAPNG, muxMP4, sheetLayout } from './encoders.js';
import { standalonePage, codeFile } from './standalone.js';
import { updateClock } from './ui-timeline.js';
import { frameLook } from './ui-look.js';
/** Export dialog. Stills: PNG with embedded project metadata, JPEG, WebP.
 * Animations over the whole timeline: MP4 (exact frames, encoded with WebCodecs
 * and muxed by encoders.js), GIF, animated PNG, a real-time WebM recording, a
 * deterministic PNG sequence ZIP, or a sprite sheet. Code: a self-contained web
 * page that plays the scene (standalone.js), or the selected component's shader
 * code for twigl.app. Exports draw on the main canvas at the requested size and
 * restore the preview afterwards.
 */
/** Per-format limits that keep memory and time bounded. */
const LIMITS = { gif: { side: 800, frames: 300 }, apng: { side: 1280, frames: 240 }, sheet: { side: 1024 }, mp4: { frames: 7200 } };
const FORMAT_ADVICE = {
    png: 'PNG exports the current playhead at the selected resolution, with the whole project embedded (Open reads it back). Reference overlays are never included.',
    jpeg: 'JPEG: the current frame, much smaller than PNG and slightly lossy. Quality 90 is visually lossless for most scenes.',
    webp: 'WebP: the current frame, smaller than JPEG at the same quality. Quality 100 is lossless.',
    mp4: 'MP4 (H.264): every frame rendered at its exact time i/FPS and encoded on this device, so the result is smooth even when rendering is slow. Plays everywhere. Quality sets the bitrate.',
    gif: 'GIF: the whole timeline as a looping animation with one 256-color palette for all frames (lightly dithered). Best for small sizes: at most 800 pixels per side and 300 frames.',
    apng: 'Animated PNG: full color and lossless, loops forever; plays in every modern browser. Files are large: keep it small and short.',
    video: 'WebM: records one timeline pass in real time; a slow device skips frames. Use MP4 for exact frames.',
    sequence: 'Exports the whole timeline, end point excluded. Up to 240 PNG frames and 1280 pixels per side; the ZIP holds the frames, the project and a manifest.',
    sheet: 'Sprite sheet: Frames moments spread over the loop, in one PNG grid, with a JSON file of their times and positions. For games, slides and printed comparisons.',
    html: 'Web page: one HTML file that plays this scene live on any device with WebGL 2, with its credits. Its shaders are compiled from the scene; nothing is fetched.',
    code: 'Shader code: the selected component’s code, with its author’s credit, ready to paste into twigl.app (mode geekest 300 es).'
};
const app = $('app'), canvas = $('artCanvas');
let recording = null, abortExport = false;
function stopRecording() {
    abortExport = true;
    if (recording?.state === 'recording') {
        recording.stop();
    }
}
function updateExportAdvice() {
    const mode = $('exportFormat').value, still = ['png', 'jpeg', 'webp'].includes(mode), code = mode === 'html' || mode === 'code';
    $('exportAdvice').textContent = FORMAT_ADVICE[mode] || '';
    $('exportFPS').disabled = still || code || mode === 'sheet';
    $('exportWidth').disabled = $('exportHeight').disabled = code;
    $('exportQualityLabel').hidden = !['jpeg', 'webp', 'mp4'].includes(mode);
    $('exportFramesLabel').hidden = mode !== 'sheet';
    $('exportIsolated').parentElement.hidden = state.viewMode === 'final' || code;
}
/** Suggested export size for the format, in the scene's aspect ratio. */
function suggestSize(mode) {
    const aspect = aspectOf(state.project), width = { gif: 480, apng: 480, sheet: 320, sequence: 800 }[mode] ?? (aspect >= 1 ? 1920 : Math.round(1920 * aspect));
    $('exportWidth').value = width;
    $('exportHeight').value = Math.round(width / aspect);
}
$('exportButton').onclick = () => {
    if (!state.renderer) {
        showError('A working WebGL 2 context is required to export.');
        return;
    }
    $('exportWidth').max = state.renderer.info.maxSize;
    $('exportHeight').max = state.renderer.info.maxSize;
    $('exportMessage').textContent = '';
    suggestSize($('exportFormat').value);
    updateExportAdvice();
    $('exportDialog').showModal();
};
// A size the user chose is kept across formats; only one above the new format's limit shrinks.
$('exportFormat').onchange = () => {
    const mode = $('exportFormat').value, limit = { gif: 800, apng: 1280, sequence: 1280, sheet: 1024 }[mode];
    const width = Number($('exportWidth').value), height = Number($('exportHeight').value);
    if (limit && Math.max(width, height) > limit) {
        const scale = limit / Math.max(width, height);
        $('exportWidth').value = Math.max(32, Math.round(width * scale));
        $('exportHeight').value = Math.max(32, Math.round(height * scale));
    }
    updateExportAdvice();
};

$('exportDialog').addEventListener('cancel', e => {
    if (state.busy) {
        e.preventDefault();
        stopRecording();
    }
});
$('cancelExport').onclick = stopRecording;
document.querySelectorAll('[data-close="exportDialog"]').forEach(b => b.onclick = () => {
    if (state.busy) {
        stopRecording();
    }
    else {
        $('exportDialog').close();
    }
});
async function exportPNG(scene, drawAt, savedTime, width, height, options, stem) {
    drawAt(savedTime);
    const png = await embedPNGMetadata(await state.renderer.png(), { project: scene, time: savedTime, width, height, target: options.target, contribution: options.contribution || null, backend: state.renderer.info });
    download(png, `${stem}-${savedTime.toFixed(3)}s.png`);
    $('exportMessage').textContent = `Saved ${width} × ${height} PNG at ${savedTime.toFixed(3)} seconds, with embedded project metadata.`;
}
async function exportSequence(scene, drawAt, times, width, height, fps, options, stem) {
    const files = [{ name: 'project.json', data: JSON.stringify(scene, null, 2) }];
    let total = 0;
    for (let i = 0; i < times.length; i++) {
        if (abortExport) {
            throw new Error('Rendering cancelled. No partial archive was downloaded.');
        }
        drawAt(times[i]);
        const data = new Uint8Array(await (await state.renderer.png()).arrayBuffer());
        total += data.length;
        if (total > 150 * 1024 * 1024) {
            throw new Error('PNG frames exceed 150 MB. Reduce FPS, duration or resolution.');
        }
        files.push({ name: `frames/frame_${String(i).padStart(5, '0')}.png`, data });
        $('exportProgress').value = (i + 1) / times.length;
        $('exportMessage').textContent = `Frame ${i + 1}/${times.length} · ${(total / 1048576).toFixed(1)} MB · t=${times[i].toFixed(3)} s`;
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    files.push({ name: 'manifest.json', data: JSON.stringify({ schema: 'equation-studio-export-v1', width, height, fps, times, target: options.target, contribution: options.contribution || null, backend: state.renderer.info, tone: scene.tone, exposure: scene.exposure, alpha: 'opaque displayed RGB', referenceOverlayIncluded: false }, null, 2) });
    download(makeZip(files), `${stem}-frames.zip`);
    $('exportMessage').textContent = `Saved ${times.length} exact-time PNG frames, project and manifest.`;
}
/** One real-time pass through the timeline into a MediaRecorder. With `manual`
 * capture every drawn frame is pushed explicitly (`requestFrame`), otherwise the
 * compositor decides when the canvas changed. Returns the encoded chunks and the
 * number of frames drawn.
 */
async function recordPass(scene, drawAt, fps, mime, manual) {
    drawAt(0);
    const stream = canvas.captureStream(manual ? 0 : fps), track = manual ? stream.getVideoTracks()[0] : null;
    const chunks = [], totalFrames = Math.max(1, Math.ceil(scene.duration * fps));
    let size = 0, recordingError = null, lastFrame = -1, drawn = 0;
    try {
        recording = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
        const done = new Promise(resolve => {
            recording.ondataavailable = e => {
                if (e.data.size) {
                    chunks.push(e.data);
                    size += e.data.size;
                    if (size > 150 * 1024 * 1024) {
                        stopRecording();
                    }
                }
            };
            recording.onerror = e => {
                recordingError = new Error(e.error?.message || 'Browser recording failed.');
                abortExport = true;
                resolve();
            };
            recording.onstop = resolve;
        });
        // The encoder can take a second or more to start on a slow device; frames drawn
        // before its start event are lost, so the timeline pass waits for it.
        const started = new Promise(resolve => {
            recording.addEventListener('start', () => resolve(true), { once: true });
            setTimeout(() => resolve(false), 15000);
        });
        recording.start(250);
        if (recording.state !== 'recording') {
            throw new Error('The browser did not start recording the canvas. Use the PNG sequence.');
        }
        $('exportMessage').textContent = 'Starting the recorder…';
        if (!await Promise.race([started, done.then(() => false)])) {
            if (recordingError || abortExport) {
                throw recordingError || new Error('Recording cancelled. No partial video was downloaded.');
            }
            throw new Error('The browser did not start recording the canvas. Use the PNG sequence.');
        }
        const start = performance.now();
        // Each captured frame shows the exact time i/FPS; a slow device skips frames
        // rather than recording smeared timestamps.
        while (!abortExport && (performance.now() - start) / 1000 < scene.duration) {
            const elapsed = (performance.now() - start) / 1000, frame = Math.min(Math.floor(elapsed * fps), totalFrames - 1);
            if (frame !== lastFrame) {
                drawAt(frame / fps);
                track?.requestFrame();
                lastFrame = frame;
                drawn++;
            }
            $('exportProgress').value = elapsed / scene.duration;
            $('exportMessage').textContent = `Recording real time · ${elapsed.toFixed(1)} / ${scene.duration} s · frame ${frame + 1}/${totalFrames}`;
            await new Promise(requestAnimationFrame);
        }
        if (lastFrame < 0) { // never yielded: still deliver one frame
            drawAt(0);
            track?.requestFrame();
            lastFrame = 0;
            drawn = 1;
        }
        if (recording.state === 'recording') {
            recording.stop();
        }
        // The stop event normally arrives within a few hundred milliseconds; never hang the dialog.
        await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('The browser did not finish the recording. Use the PNG sequence.')), 20000))]);
    }
    finally {
        stream.getTracks().forEach(t => t.stop());
        recording = null;
    }
    if (recordingError) {
        throw recordingError;
    }
    return { chunks, drawn, totalFrames };
}
async function exportVideo(scene, drawAt, fps, stem) {
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
        throw new Error('This browser does not expose canvas recording. Use the PNG sequence.');
    }
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
    if (!mime) {
        throw new Error('No supported browser recording codec. Use PNG sequence.');
    }
    const probe = canvas.captureStream(0), manual = typeof probe.getVideoTracks()[0]?.requestFrame === 'function';
    probe.getTracks().forEach(t => t.stop());
    // Manual capture is deterministic. If a pass still delivers nothing (a browser
    // that drops the capture of a very short pass), it is retried once each way
    // before giving up.
    const modes = manual ? [true, false, true] : [false, false];
    let pass = null;
    for (const mode of modes) {
        pass = await recordPass(scene, drawAt, fps, mime, mode);
        if (pass.chunks.length || abortExport) {
            break;
        }
    }
    if (abortExport) {
        throw new Error('Recording cancelled or exceeded the memory limit. No partial video was downloaded.');
    }
    if (!pass.chunks.length) {
        throw new Error(`The browser produced no video frames (${pass.drawn} of ${pass.totalFrames} were drawn). Use PNG sequence.`);
    }
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    download(new Blob(pass.chunks, { type: mime }), `${stem}.${ext}`);
    $('exportMessage').textContent = `Saved ${ext.toUpperCase()} real-time recording (${pass.drawn} of ${pass.totalFrames} frames drawn). Exact frame count is not guaranteed.`;
}
/** Top-down RGBA bytes of the canvas after a draw (readPixels returns bottom-up). */
function canvasRGBA(width, height) {
    const pixels = state.renderer.pixels(), out = new Uint8ClampedArray(pixels.length), row = width * 4;
    for (let y = 0; y < height; y++) {
        out.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
    }
    return out;
}
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
function progress(done, total, text) {
    $('exportProgress').value = done / total;
    $('exportMessage').textContent = text;
}
async function exportStill(drawAt, savedTime, width, height, type, quality, stem) {
    drawAt(savedTime);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error(`This browser cannot encode ${type}.`)), `image/${type}`, quality));
    if (blob.type !== `image/${type}`) {
        throw new Error(`This browser cannot encode ${type.toUpperCase()}; it produced ${blob.type}. Use PNG.`);
    }
    download(blob, `${stem}-${savedTime.toFixed(3)}s.${type === 'jpeg' ? 'jpg' : type}`);
    $('exportMessage').textContent = `Saved ${width} × ${height} ${type.toUpperCase()} at ${savedTime.toFixed(3)} seconds (${(blob.size / 1024).toFixed(0)} KB).`;
}
async function exportGIF(scene, drawAt, width, height, fps, stem) {
    const times = frameTimes(scene.duration, Math.min(fps, 50)), frames = [];
    for (let i = 0; i < times.length; i++) {
        if (abortExport) {
            throw new Error('Rendering cancelled.');
        }
        drawAt(times[i]);
        frames.push(canvasRGBA(width, height));
        progress(i + 1, times.length * 2, `Rendering frame ${i + 1}/${times.length}`);
        await yieldFrame();
    }
    $('exportMessage').textContent = 'Choosing 256 colors and compressing…';
    await yieldFrame();
    const bytes = encodeGIF(frames, width, height, Math.max(2, Math.round(100 / Math.min(fps, 50))));
    download(new Blob([bytes], { type: 'image/gif' }), `${stem}.gif`);
    $('exportMessage').textContent = `Saved a looping ${width} × ${height} GIF of ${times.length} frames (${(bytes.length / 1048576).toFixed(1)} MB).`;
}
async function exportAPNG(scene, drawAt, width, height, fps, stem) {
    const times = frameTimes(scene.duration, fps), pngs = [];
    let total = 0;
    for (let i = 0; i < times.length; i++) {
        if (abortExport) {
            throw new Error('Rendering cancelled.');
        }
        drawAt(times[i]);
        const data = new Uint8Array(await (await state.renderer.png()).arrayBuffer());
        total += data.length;
        if (total > 150 * 1024 * 1024) {
            throw new Error('The frames exceed 150 MB. Reduce the size, FPS or duration.');
        }
        pngs.push(data);
        progress(i + 1, times.length, `Frame ${i + 1}/${times.length} · ${(total / 1048576).toFixed(1)} MB`);
        await yieldFrame();
    }
    const bytes = assembleAPNG(pngs, fps);
    download(new Blob([bytes], { type: 'image/apng' }), `${stem}.png`);
    $('exportMessage').textContent = `Saved a looping ${width} × ${height} animated PNG of ${times.length} frames (${(bytes.length / 1048576).toFixed(1)} MB).`;
}
/** MP4: every frame drawn at i/FPS, encoded with WebCodecs, muxed in encoders.js. */
async function exportMP4(scene, drawAt, width, height, fps, quality, stem) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
        throw new Error('This browser cannot encode MP4 (WebCodecs is missing). Use WebM, GIF or the PNG sequence.');
    }
    if (width % 2 || height % 2) {
        throw new Error('H.264 needs an even width and height.');
    }
    const bitrate = Math.round(width * height * fps * 0.12 * (quality / 90));
    let config = null;
    for (const codec of ['avc1.640034', 'avc1.4d0034', 'avc1.640028', 'avc1.42003e', 'avc1.42001f']) {
        const candidate = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } };
        if ((await VideoEncoder.isConfigSupported(candidate)).supported) {
            config = candidate;
            break;
        }
    }
    if (!config) {
        throw new Error(`No H.264 encoder for ${width} × ${height} in this browser. Try a smaller size, or WebM.`);
    }
    const samples = [];
    let description = null, failure = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => {
            if (meta?.decoderConfig?.description) {
                const d = meta.decoderConfig.description;
                description = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d);
            }
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            samples.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp });
        },
        error: e => failure = e
    });
    encoder.configure(config);
    const count = Math.max(1, Math.round(scene.duration * fps));
    if (count > LIMITS.mp4.frames) {
        throw new Error(`At most ${LIMITS.mp4.frames} frames: lower the FPS.`);
    }
    try {
        for (let i = 0; i < count; i++) {
            if (abortExport || failure) {
                throw failure || new Error('Rendering cancelled.');
            }
            drawAt(i / fps);
            const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
            encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
            frame.close();
            while (encoder.encodeQueueSize > 4) {
                await new Promise(resolve => setTimeout(resolve, 2));
            }
            progress(i + 1, count, `Encoding frame ${i + 1}/${count} · t = ${(i / fps).toFixed(2)} s`);
            await yieldFrame();
        }
        await encoder.flush();
    }
    finally {
        if (encoder.state !== 'closed') {
            encoder.close();
        }
    }
    if (failure) {
        throw failure;
    }
    if (!description) {
        throw new Error('The encoder did not describe its stream; use WebM or the PNG sequence.');
    }
    const bytes = muxMP4(samples, { width, height, fps, description });
    download(new Blob([bytes], { type: 'video/mp4' }), `${stem}.mp4`);
    $('exportMessage').textContent = `Saved a ${width} × ${height} MP4 of ${count} exact frames at ${fps} FPS (${(bytes.length / 1048576).toFixed(1)} MB, ${config.codec}).`;
}
async function exportSheet(scene, drawAt, width, height, count, stem) {
    const layout = sheetLayout(count, width, height), sheet = document.createElement('canvas');
    sheet.width = layout.width;
    sheet.height = layout.height;
    const ctx = sheet.getContext('2d'), frames = [];
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let k = 0; k < count; k++) {
        const t = scene.duration * k / count, cell = layout.cells[k];
        drawAt(t);
        ctx.drawImage(canvas, cell.x, cell.y, width, height);
        frames.push({ index: k, time: Number(t.toFixed(4)), x: cell.x, y: cell.y, width, height });
        progress(k + 1, count, `Frame ${k + 1}/${count}`);
        await yieldFrame();
    }
    const png = new Uint8Array(await (await new Promise(resolve => sheet.toBlob(resolve, 'image/png'))).arrayBuffer());
    const json = JSON.stringify({ schema: 'equation-studio-sprite-sheet-v1', title: scene.title, duration: scene.duration, columns: layout.columns, rows: layout.rows, frames }, null, 2);
    download(makeZip([{ name: `${stem}-sheet.png`, data: png }, { name: `${stem}-sheet.json`, data: json }, { name: 'project.json', data: JSON.stringify(scene, null, 2) }]), `${stem}-sheet.zip`);
    $('exportMessage').textContent = `Saved a ${layout.columns} × ${layout.rows} sheet of ${count} frames (${layout.width} × ${layout.height} pixels) with its JSON and the project.`;
}
function exportPage(scene, stem) {
    download(new Blob([standalonePage(scene)], { type: 'text/html' }), `${stem}.html`);
    $('exportMessage').textContent = 'Saved a web page that plays this scene live. Open it in any browser with WebGL 2.';
}
function exportCode(stem) {
    const node = currentNode();
    if (!catalog[node.type].code) {
        throw new Error('Select a Shader code component first: this exports its code.');
    }
    download(new Blob([codeFile(node)], { type: 'text/plain' }), `${fileStem(node.label) || stem}.glsl`);
    $('exportMessage').textContent = `Saved the code of ${node.label}, ready for twigl.app.`;
}
$('startExport').onclick = async () => {
    const renderer = state.renderer;
    if (!renderer || state.busy) {
        return;
    }
    const width = Number($('exportWidth').value), height = Number($('exportHeight').value), fps = Number($('exportFPS').value), mode = $('exportFormat').value;
    const quality = Math.min(100, Math.max(1, Number($('exportQuality').value) || 90)), sheetFrames = Math.min(256, Math.max(2, Math.round(Number($('exportFrames').value) || 16)));
    const useView = $('exportIsolated').checked && state.viewMode !== 'final';
    const options = useView ? viewOptions() : { target: state.project.output };
    if (useView && state.viewMode === 'stage') {
        // In the colors the canvas shows, with its current range for every frame.
        options.look = frameLook(state.project, options.target);
    }
    const savedTime = state.time, scene = clone(state.project), stem = fileStem(state.project.title);
    try {
        if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 32 || Math.max(width, height) > renderer.info.maxSize) {
            throw new Error(`Use integer dimensions from 32 to ${renderer.info.maxSize}.`);
        }
        if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
            throw new Error('FPS must be an integer from 1 to 60.');
        }
        let times;
        if (mode === 'sequence') {
            times = frameTimes(scene.duration, fps);
            if (Math.max(width, height) > 1280) {
                throw new Error('Sequence export is limited to 1280 pixels per side to bound memory.');
            }
        }
        const limit = LIMITS[mode];
        if (limit?.side && Math.max(width, height) > limit.side) {
            throw new Error(`${mode.toUpperCase()} export is limited to ${limit.side} pixels per side.`);
        }
        if (limit?.frames && mode !== 'mp4' && Math.ceil(scene.duration * fps) > limit.frames) {
            throw new Error(`${mode.toUpperCase()} export is limited to ${limit.frames} frames: lower the FPS.`);
        }
        if (mode === 'html' || mode === 'code') {
            if (mode === 'html') {
                exportPage(scene, stem);
            }
            else {
                exportCode(stem);
            }
            return;
        }
        pause();
        state.busy = true;
        abortExport = false;
        app.classList.add('busy');
        $('startExport').disabled = true;
        $('cancelExport').hidden = false;
        $('exportProgress').hidden = false;
        $('exportProgress').value = 0;
        const drawAt = t => renderer.draw(scene, t, width, height, options);
        if (mode === 'png') {
            await exportPNG(scene, drawAt, savedTime, width, height, options, stem);
        }
        else if (mode === 'jpeg' || mode === 'webp') {
            await exportStill(drawAt, savedTime, width, height, mode, quality / 100, stem);
        }
        else if (mode === 'gif') {
            await exportGIF(scene, drawAt, width, height, fps, stem);
        }
        else if (mode === 'apng') {
            await exportAPNG(scene, drawAt, width, height, fps, stem);
        }
        else if (mode === 'mp4') {
            await exportMP4(scene, drawAt, width, height, fps, quality, stem);
        }
        else if (mode === 'sheet') {
            await exportSheet(scene, drawAt, width, height, sheetFrames, stem);
        }
        else if (mode === 'sequence') {
            await exportSequence(scene, drawAt, times, width, height, fps, options, stem);
        }
        else {
            await exportVideo(scene, drawAt, fps, stem);
        }
        $('exportProgress').value = 1;
    }
    catch (e) {
        $('exportMessage').textContent = e.message;
        showError(e);
    }
    finally {
        if (recording?.state === 'recording') {
            recording.stop();
        }
        recording = null;
        state.busy = false;
        state.time = savedTime;
        app.classList.remove('busy');
        $('startExport').disabled = false;
        $('cancelExport').hidden = true;
        state.dirty = true;
        state.previewsDirty = true;
        updateClock();
    }
};
export function exportDialogOpen() {
    return $('exportDialog').open;
}
