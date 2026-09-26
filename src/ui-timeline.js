import { $, esc, state, on, transact, history, changed, markDirty, pause, seek, setSelected, clamp } from './editor.js';
import { clone } from './graph.js';
import { moveKey } from './timeline.js';
/** Bottom strip: transport, playhead, duration, output conversion and the
 * keyframe lanes (click a lane to seek, drag a key to move it in time).
 */
export function updateClock() {
    $('clock').textContent = state.time.toFixed(3).padStart(6, '0');
    $('scrubber').value = state.time;
    document.querySelectorAll('.track-playhead').forEach(el => el.style.left = `${state.time / state.project.duration * 100}%`);
}
function refreshTransport() {
    const project = state.project;
    $('duration').value = project.duration;
    $('scrubber').max = project.duration;
    $('outputTone').value = project.tone;
    $('exposure').value = project.exposure;
    updateClock();
}
export function renderTracks() {
    const { project, time } = state;
    if (!project.tracks.length) {
        $('tracks').innerHTML = '<div class="empty-tracks">No keyframes yet. Click ◆ next to any numeric parameter. Procedural flow-speed controls also animate directly with time.</div>';
        return;
    }
    $('tracks').innerHTML = project.tracks.map(t => `<div class="track-row"><span class="track-label" data-select-track="${t.node}" data-tip="Select ${esc(t.node)}|Shows this component in the inspector.">${esc(t.node)} / ${esc(t.param)}</span><div class="track-lane" data-lane="${t.node}" data-param="${t.param}"><span class="track-playhead" style="left:${time / project.duration * 100}%"></span>${t.keys.map(k => `<button class="track-key" data-track-time="${k.time}" style="left:${k.time / project.duration * 100}%" data-tip="Key at ${k.time} s = ${k.value}|Drag along the lane to retime it; click to move the playhead here." aria-label="Key for ${t.param} at ${k.time} seconds">◆</button>`).join('')}</div></div>`).join('');
}
export function togglePlay() {
    if (!state.renderer || state.busy) {
        return;
    }
    if (state.playing) {
        pause();
        seek(state.time);
        return;
    }
    if (state.time >= state.project.duration) {
        state.time = 0;
    }
    state.playing = true;
    state.frameStamp = performance.now();
    $('play').textContent = 'Ⅱ';
    $('play').setAttribute('aria-label', 'Pause animation');
}
/** Step the playhead by whole frames at the export frame rate. */
export function stepFrames(count, fps = 24) {
    seek(clamp(Math.round(state.time * fps + count) / fps, 0, state.project.duration));
}
$('play').onclick = togglePlay;
$('rewind').onclick = () => seek(0);
$('scrubber').oninput = e => seek(Number(e.target.value));
$('duration').onchange = e => {
    transact(p => p.duration = Number(e.target.value));
    $('duration').value = state.project.duration;
};
$('outputTone').onchange = e => transact(p => p.tone = e.target.value);
$('exposure').oninput = e => {
    if (!$('exposure')._before) {
        $('exposure')._before = clone(state.project);
    }
    state.project.exposure = Number(e.target.value);
    markDirty();
};
$('exposure').onchange = () => {
    if ($('exposure')._before) {
        history.push($('exposure')._before);
        delete $('exposure')._before;
        changed();
    }
};
// Lanes: click to seek, drag a key to move it, click a key to jump to it.
let drag = null;
const laneTime = (lane, clientX) => {
    const rect = lane.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * state.project.duration;
};
$('tracks').addEventListener('pointerdown', e => {
    if (state.busy || e.button !== 0) {
        return;
    }
    const key = e.target.closest('[data-track-time]'), lane = e.target.closest('[data-lane]'), label = e.target.closest('[data-select-track]');
    if (key && lane) {
        drag = { key, lane, from: Number(key.dataset.trackTime), x: e.clientX, moved: false };
        key.setPointerCapture(e.pointerId);
        e.preventDefault();
    }
    else if (lane) {
        seek(laneTime(lane, e.clientX));
    }
    else if (label) {
        setSelected(label.dataset.selectTrack);
    }
});
$('tracks').addEventListener('pointermove', e => {
    if (!drag) {
        return;
    }
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) {
        return;
    }
    drag.moved = true;
    const t = laneTime(drag.lane, e.clientX);
    drag.key.style.left = `${t / state.project.duration * 100}%`;
    drag.to = t;
});
$('tracks').addEventListener('pointerup', e => {
    const d = drag;
    drag = null;
    if (!d) {
        return;
    }
    if (!d.moved) {
        seek(d.from);
        return;
    }
    const { lane } = d, to = Math.round(laneTime(lane, e.clientX) * 1000) / 1000;
    const ok = transact(p => moveKey(p, lane.dataset.lane, lane.dataset.param, d.from, to));
    if (ok) {
        seek(to);
    }
    else {
        renderTracks();
    }
});
$('tracks').addEventListener('pointercancel', () => {
    drag = null;
    renderTracks();
});
on('refresh', () => {
    refreshTransport();
    renderTracks();
});
on('selection', renderTracks);
on('time', updateClock);
