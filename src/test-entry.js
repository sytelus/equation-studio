import { Renderer } from './renderer.js';
import { presets, getPreset } from './presets.js';
import { compileGraph, compileProgram } from './compiler.js';
import { forkable, forkProgram } from './fork.js';
import { lookForStats, paintTile } from './looks.js';
/** Minimal bundle entry for the GPU test harness (tools/gpu_validate.py): the
 * renderer and the pure modules it needs, without the editor's DOM code.
 */
window.testLibrary = { Renderer, presets, getPreset, compileGraph, compileProgram, forkable, forkProgram, lookForStats, paintTile };
