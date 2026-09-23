/** Stateless animation evaluation. Rendering t never depends on previous frames. */
export function interpolateTrack(track, time, fallback) {
    const keys = track.keys;
    if (!keys.length) {
        return fallback;
    }
    if (time <= keys[0].time) {
        return keys[0].value;
    }
    if (time >= keys.at(-1).time) {
        return keys.at(-1).value;
    }
    let lo = 0, hi = keys.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (keys[mid].time <= time) {
            lo = mid;
        }
        else {
            hi = mid;
        }
    }
    const a = keys[lo], b = keys[hi];
    let u = (time - a.time) / (b.time - a.time);
    if (track.interpolation === 'hold') {
        u = 0;
    }
    else if (track.interpolation === 'smooth') {
        u = u * u * (3 - 2 * u);
    }
    return a.value + (b.value - a.value) * u;
}
export function animatedParameters(project, node, time) {
    const p = { ...node.params };
    for (const t of project.tracks) {
        if (t.node === node.id) {
            p[t.param] = interpolateTrack(t, time, p[t.param]);
        }
    }
    return p;
}
export function insertKey(project, node, param, time, value) {
    let track = project.tracks.find(t => t.node === node && t.param === param);
    if (!track) {
        track = { node, param, interpolation: 'smooth', keys: [] };
        project.tracks.push(track);
    }
    const t = Math.round(time * 1000) / 1000;
    track.keys = track.keys.filter(k => Math.abs(k.time - t) > 0.0005);
    track.keys.push({ time: t, value });
    track.keys.sort((a, b) => a.time - b.time);
    return track;
}
export function loopTime(time, duration) {
    return ((time % duration) + duration) % duration;
}
