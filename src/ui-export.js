import { $, state, showError, pause, viewTarget } from './editor.js';
import { clone } from './graph.js';
import { makeZip, download, fileStem, frameTimes, embedPNGMetadata } from './export.js';
import { updateClock } from './ui-timeline.js';
/** Export dialog: still PNG with embedded project metadata, deterministic PNG
 * sequence ZIP, or a real-time browser video recording. Exports draw on the main
 * canvas at the requested size and restore the preview afterwards.
 */
const app = $('app'), canvas = $('artCanvas');
let recording = null, abortExport = false;
function stopRecording() {
    abortExport = true;
    if (recording?.state === 'recording') {
        recording.stop();
    }
}
function updateExportAdvice() {
    const mode = $('exportFormat').value;
    $('exportAdvice').textContent = mode === 'sequence'
        ? `Exports the whole ${state.project.duration} s timeline, end point excluded. Up to 240 PNG frames and 1280 pixels per side; ZIP holds compressed PNGs without recompressing them.`
        : mode === 'video'
            ? 'Records one timeline pass in real time. Browser codec support varies; use the PNG sequence for exact frame times and lossless output.'
            : 'PNG exports the current playhead at the selected resolution. Preview width does not remove equation terms. Reference overlays are never included.';
    $('exportFPS').disabled = mode === 'png';
    $('exportIsolated').parentElement.hidden = !(state.isolated || state.contribution);
}
$('exportButton').onclick = () => {
    if (!state.renderer) {
        showError('A working WebGL 2 context is required to export.');
        return;
    }
    $('exportWidth').max = state.renderer.info.maxSize;
    $('exportHeight').max = state.renderer.info.maxSize;
    $('exportMessage').textContent = '';
    updateExportAdvice();
    $('exportDialog').showModal();
};
$('exportFormat').onchange = () => {
    if ($('exportFormat').value === 'sequence' && Number($('exportWidth').value) > 1280) {
        $('exportWidth').value = 800;
        $('exportHeight').value = 480;
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
    let size = 0, recordingError = null, lastFrame = -1;
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
        recording.start(250);
        if (recording.state !== 'recording') {
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
            }
            $('exportProgress').value = elapsed / scene.duration;
            $('exportMessage').textContent = `Recording real time · ${elapsed.toFixed(1)} / ${scene.duration} s · frame ${frame + 1}/${totalFrames}`;
            await new Promise(requestAnimationFrame);
        }
        if (lastFrame < 0) { // never yielded: still deliver one frame
            drawAt(0);
            track?.requestFrame();
            lastFrame = 0;
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
    return { chunks, drawn: lastFrame + 1, totalFrames };
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
    // Manual capture is deterministic; if a browser delivers nothing that way, one
    // compositor-driven pass is tried before giving up.
    let pass = await recordPass(scene, drawAt, fps, mime, manual);
    if (!pass.chunks.length && !abortExport && manual) {
        pass = await recordPass(scene, drawAt, fps, mime, false);
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
$('startExport').onclick = async () => {
    const renderer = state.renderer;
    if (!renderer || state.busy) {
        return;
    }
    const width = Number($('exportWidth').value), height = Number($('exportHeight').value), fps = Number($('exportFPS').value), mode = $('exportFormat').value;
    const useView = $('exportIsolated').checked && (state.isolated || state.contribution);
    const options = useView && state.contribution
        ? { target: state.project.output, contribution: state.contribution, contributionStyle: state.contributionStyle }
        : { target: useView ? viewTarget() : state.project.output };
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
