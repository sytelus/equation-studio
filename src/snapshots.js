import { clone, validateProject } from './graph.js';
/** Session bookmarks: named project states with a thumbnail, kept in browser
 * storage so an exploration can branch and return. They are not exported with
 * the project; Save project remains the portable format.
 */
export const SNAPSHOT_LIMIT = 30;
export const THUMB_WIDTH = 160, THUMB_HEIGHT = 96;
export function parseSnapshots(text) {
    try {
        const list = JSON.parse(text || '[]');
        if (!Array.isArray(list)) {
            return [];
        }
        return list.filter(s => {
            try {
                return s && typeof s.id === 'string' && typeof s.title === 'string' && Number.isFinite(s.time) && Number.isFinite(s.savedAt) && validateProject(s.project);
            }
            catch (e) {
                return false;
            }
        }).slice(0, SNAPSHOT_LIMIT);
    }
    catch (e) {
        return [];
    }
}
/** Newest first; the list is capped so storage stays small. */
export function addSnapshot(list, { project, time, thumb, title = project.title }) {
    validateProject(project);
    const entry = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title: String(title).slice(0, 160), time, savedAt: Date.now(), thumb: typeof thumb === 'string' ? thumb : '', project: clone(project) };
    return [entry, ...list].slice(0, SNAPSHOT_LIMIT);
}
export function removeSnapshot(list, id) {
    return list.filter(s => s.id !== id);
}
/** A small JPEG data URL of a rendered canvas, or an empty string when unavailable. */
export function thumbnailFrom(source, width = THUMB_WIDTH, height = THUMB_HEIGHT) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(source, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.8);
    }
    catch (e) {
        return '';
    }
}
export function relativeTime(savedAt, now = Date.now()) {
    const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
    if (seconds < 60) {
        return 'just now';
    }
    if (seconds < 3600) {
        return `${Math.round(seconds / 60)} min ago`;
    }
    if (seconds < 86400) {
        return `${Math.round(seconds / 3600)} h ago`;
    }
    return `${Math.round(seconds / 86400)} d ago`;
}
