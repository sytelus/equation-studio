import { $, state, on, seek, setPref, viewOptions } from './editor.js';
import { aspectOf } from './graph.js';
import { frameLook } from './ui-look.js';
/** The filmstrip under the timeline: the canvas's view at evenly spaced moments
 * of the timeline, so the whole animation is visible at a glance. Click a frame
 * to move the playhead there. The frames are redrawn (without blocking) when the
 * scene, the view or the duration change, also while it plays, since scenes open playing.
 */
const FRAMES = 12, TILE_HEIGHT = 54;
let key = '', timer = null, token = 0;
export function filmstripVisible() {
    return !!state.prefs.filmstrip;
}
function times() {
    return Array.from({ length: FRAMES }, (_, k) => state.project.duration * k / FRAMES);
}
/** Redraw the frames soon, if anything they depend on changed. */
function schedule() {
    if (!filmstripVisible() || !state.renderer) {
        return;
    }
    const options = viewOptions();
    const next = JSON.stringify([state.project.nodes, state.project.tracks, state.project.view, state.project.duration, state.project.exposure, state.project.tone, options.target, options.show || 0]);
    if (next === key) {
        return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => draw(next), 500);
}
function draw(next) {
    const renderer = state.renderer;
    if (!renderer || state.busy) {
        timer = setTimeout(() => draw(next), 800); // not while exporting
        return;
    }
    const aspect = aspectOf(state.project), height = TILE_HEIGHT * 2, width = Math.max(8, Math.round(height * aspect));
    const options = viewOptions(), frame = { target: options.target, show: options.show || 0 };
    if (state.viewMode === 'stage') {
        frame.look = frameLook(state.project, options.target); // the canvas's colors, one range for every frame
    }
    const project = JSON.parse(JSON.stringify(state.project)), mine = ++token;
    if (renderer.programFor(project, {}).status !== 'ready') {
        timer = setTimeout(() => draw(next), 400); // wait for the program to compile
        return;
    }
    try {
        renderer.timeAtlas(project, times(), width, height, frame).then(images => {
            if (mine !== token) {
                return;
            }
            key = next;
            paint(images);
        }, () => {});
    }
    catch (e) {
        key = next;
    }
}
function paint(images) {
    const strip = $('filmstrip');
    strip.innerHTML = images.map((img, k) => {
        const t = times()[k];
        return `<button class="film-frame" data-film-time="${t}" aria-label="Go to ${t.toFixed(2)} seconds" data-tip="The picture at ${t.toFixed(1)} s|Click to go to this moment."><canvas width="${img.width}" height="${img.height}"></canvas></button>`;
    }).join('') + '<span class="film-playhead" aria-hidden="true"></span>';
    strip.querySelectorAll('canvas').forEach((canvas, k) => canvas.getContext('2d').putImageData(new ImageData(images[k].data, images[k].width, images[k].height), 0, 0));
    movePlayhead();
}
function movePlayhead() {
    const head = $('filmstrip').querySelector('.film-playhead');
    if (head) {
        head.style.left = `${state.time / state.project.duration * 100}%`;
    }
}
export function setFilmstrip(visible) {
    setPref('filmstrip', visible);
    refresh();
}
function refresh() {
    const visible = filmstripVisible();
    $('filmstrip').hidden = !visible;
    $('filmstripButton').classList.toggle('active', visible);
    $('filmstripButton').setAttribute('aria-pressed', String(visible));
    if (visible) {
        key = '';
        schedule();
    }
}
$('filmstrip').addEventListener('click', e => {
    const frame = e.target.closest('[data-film-time]');
    if (frame) {
        seek(Number(frame.dataset.filmTime));
    }
});
$('filmstripButton').onclick = () => setFilmstrip(!filmstripVisible());
on('refresh', schedule);
on('view', schedule);
on('selection', schedule);
on('time', movePlayhead);
on('values', () => {
    clearTimeout(timer);
    timer = setTimeout(schedule, 400);
});
refresh();
