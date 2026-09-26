import { $, esc, state, on } from './editor.js';
import { SOFTWARE_ADVICE } from './gpu-info.js';
/** What is doing the work: the GPU chip in the LIVE badge, the footer label and
 * the GPU & performance dialog (renderer, capabilities, compile and frame times).
 */
const yes = ok => ok ? '<span class="ok">yes</span>' : '<span class="no">no</span>';
/** Short label for the badge chip and the footer. */
export function gpuSummary(info) {
    const gpu = info.gpu;
    if (info.softwareFallback || gpu.kind === 'software') {
        return { text: 'SOFTWARE', title: `Software rendering · ${gpu.name}`, software: true };
    }
    return { text: 'GPU', title: `${gpu.name}${gpu.api ? ` · ${gpu.api}` : ''}`, software: false };
}
export function refreshGpuLabels() {
    const renderer = state.renderer;
    if (!renderer) {
        return;
    }
    const summary = gpuSummary(renderer.info);
    $('gpuChip').textContent = summary.text;
    $('liveBadge').classList.toggle('software', summary.software);
    $('gpuLabel').textContent = summary.software ? `⚠ SOFTWARE RENDERING · ${renderer.info.gpu.name}` : `⚡ ${summary.title} · hardware accelerated`;
    $('liveBadge').dataset.tip = summary.software
        ? `Rendered live, but in software|${SOFTWARE_ADVICE} Click for details.`
        : `Rendered live on your GPU|${summary.title}. Every pixel is computed from the equations each time anything changes; there is no stored picture. The dot pulses on each new frame. Click for GPU details.`;
}
function programRows(renderer) {
    return [...renderer.cache.values()].reverse().map(entry => {
        const time = entry.finished ? `${((entry.finished - entry.started) / 1000).toFixed(2)} s` : `${((performance.now() - entry.started) / 1000).toFixed(1)} s so far`;
        const status = entry.status === 'failed' ? '<span class="no">failed</span>' : entry.status === 'ready' ? 'ready' : entry.status;
        return `<tr><td>${entry.compiled.order.length} components${entry === renderer.current ? ' · <b>on screen</b>' : ''}</td><td>${status}</td><td>${time}</td></tr>`;
    }).join('');
}
function dialogHTML() {
    const renderer = state.renderer;
    if (!renderer) {
        return '<p>WebGL 2 is unavailable, so nothing can be rendered. Enable hardware acceleration in the browser settings.</p>';
    }
    const info = renderer.info, summary = gpuSummary(info), ms = renderer.gpuTime;
    const status = summary.software
        ? `<div class="note warning"><b>Software rendering.</b> ${esc(SOFTWARE_ADVICE)}</div>`
        : `<div class="note"><b>Hardware accelerated.</b> Every pixel runs on <b>${esc(info.gpu.name)}</b>${info.gpu.api ? ` through ${esc(info.gpu.api)}` : ''}.</div>`;
    return `${status}
<table class="gpu-table">
<tr><th>Renderer</th><td class="mono">${esc(info.renderer)}</td></tr>
<tr><th>Vendor</th><td>${esc(info.vendor || '—')}</td></tr>
<tr><th>API</th><td>${esc(info.backend)}${info.gpu.api ? ` on ${esc(info.gpu.api)}` : ''}</td></tr>
<tr><th>Float precision</th><td>${info.precisionBits ?? '—'} mantissa bits (highp)</td></tr>
<tr><th>Raw value probes</th><td>${yes(info.rawFields)} <small>float framebuffers: rulers readout, auto colors, profiles</small></td></tr>
<tr><th>Background shader compilation</th><td>${yes(info.parallelCompile)} <small>${info.parallelCompile ? 'the page keeps running while a new graph compiles' : 'the page pauses briefly while a new graph compiles'}</small></td></tr>
<tr><th>GPU timer</th><td>${yes(info.gpuTimer)} <small>${info.gpuTimer ? 'exact GPU time per frame' : 'frame time is an upper bound'}</small></td></tr>
<tr><th>Largest image</th><td>${info.maxSize} px per side</td></tr>
<tr><th>Last frame</th><td>${ms === null ? '—' : `${renderer.gpuTimeExact ? '' : '≤ '}${ms.toFixed(2)} ms on the GPU for ${renderer.gpuPixels.toLocaleString()} pixels`}</td></tr>
<tr><th>Interactive resolution</th><td>${Math.round(state.adaptiveScale * 100)}% of the still-frame width while dragging or playing</td></tr>
</table>
<h3>Compiled programs</h3>
<p class="muted">One program per graph structure serves every view of it (stages, what a component changes, thumbnails, probes), so ticking components, walking the pipeline or changing parameters never recompiles. Wiring, adding components and editing equations do.</p>
<table class="gpu-table programs"><tr><th>Program</th><th>Status</th><th>Compile time</th></tr>${programRows(renderer)}</table>
<p class="muted">The equations run as WebGL fragment shaders on the graphics processor. Web pages cannot use a neural processing unit (NPU) for this kind of per-pixel work, so the GPU is the accelerator that matters here.</p>`;
}
export function openPerformance() {
    $('gpuContent').innerHTML = dialogHTML();
    $('gpuDialog').showModal();
}
$('liveBadge').addEventListener('click', openPerformance);
$('liveBadge').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPerformance();
    }
});
$('gpuLabel').addEventListener('click', openPerformance);
on('refresh', refreshGpuLabels);
