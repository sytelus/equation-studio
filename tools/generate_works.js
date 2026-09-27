// Writes docs/WORKS.md from src/works.js (the single source of the works) and,
// when present, the GPU verification in docs/WORKS_VALIDATION.json.
// Run: node tools/generate_works.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { works, creditLine } from '../src/works.js';
import { analyzeCode } from '../src/glsl.js';
import { compileEquation } from '../src/expression.js';
import { concept } from '../src/concepts.js';

const root = new URL('..', import.meta.url);
const validationPath = new URL('docs/WORKS_VALIDATION.json', root);
const validation = existsSync(validationPath) ? JSON.parse(readFileSync(validationPath, 'utf8')) : null;
const PLATFORM = { twigl: 'twigl.app shader (GLSL, geekest mode)', p5: 'p5.js sketch', study: 'clip only; our own study' };
const verdict = w => {
    const v = validation?.works?.[w.id];
    if (!v) {
        return w.platform === 'study' ? 'not applicable (no original code)' : 'not measured in this build';
    }
    if (w.platform === 'twigl') {
        const exact = v.readable_vs_raw.max === 0 && v.original_vs_raw.max === 0;
        return exact ? 'bit-identical to twigl (3 renders)' : `max difference ${v.readable_vs_raw.max}/255, ${(v.readable_vs_raw.pixels_over_2 * 100).toFixed(2)}% of pixels over 2`;
    }
    if (w.platform === 'p5') {
        return `mean difference ${v.per_pixel.mean.toFixed(2)}/255 against the sketch`;
    }
    return 'rendered';
};
const lines = [];
lines.push('# Works: animations reproduced and explained', '');
lines.push('Equation Studio 2.0 studies eighteen animations posted by their artists: thirteen twigl.app shaders, four p5.js point sketches, and one clip whose code was not published (our own study of its look). Each is a scene in the gallery (☰ Scenes), credited to its author in the app, in exported pages and in exported code. Seventeen run their original code; the scenes open a **readable version** that computes exactly the same thing with named variables and a caption on every line.', '');
lines.push('This file is generated from `src/works.js` by `node tools/generate_works.js`; do not edit it by hand.', '');
lines.push(`Verification (\`tools/works_check.py\`, ${validation ? `${validation.backend}, ${validation.date}, ${validation.size} pixels, t = ${validation.time} s${validation.exact_numbers ? ', numbers compiled as constants' : ''}` : 'not run'}): for twigl works the original code in a twigl-style shader, the original in a Shader code component and the readable version are rendered and compared pixel by pixel; for p5 works the original sketch is drawn by a p5.js stand-in at pixel density 2 and compared with the Point cloud scene.`, '');
lines.push('| # | Work | Artist | Posted | Made with | Loop | Verification |', '|---|---|---|---|---|---|---|');
works.forEach((w, k) => lines.push(`| ${k + 1} | [${w.title}](#${w.id}) | ${w.author} (@${w.handle}) | ${w.posted} | ${PLATFORM[w.platform]} | ${w.duration} s | ${verdict(w)} |`));
lines.push('');
lines.push('One requested link could not be studied: the Grok conversation `https://x.com/i/grok?conversation=2103445614214463548` redirects to the X login page and has no public copy. Nothing here is based on it.', '');
for (const w of works) {
    lines.push(`## ${w.title}`, '');
    lines.push(`<a id="${w.id}"></a>${w.platform === 'study' ? 'After' : 'By'} ${creditLine(w)} · [the post](${w.url}) · ${PLATFORM[w.platform]} · clip ${w.video.width} × ${w.video.height}, ${w.video.seconds} s · scene loop ${w.duration} s${w.titled ? '' : ' · title given by Equation Studio'}`, '');
    lines.push(w.summary, '');
    lines.push('### How it works', '');
    w.tour.forEach((step, k) => {
        const extras = [step.show ? `shows \`${step.show}\` on the canvas` : '', step.steps ? `stops ${Object.entries(step.steps).map(([l, n]) => `loop ${l} after ${n} step${n === 1 ? '' : 's'}`).join(', ')}` : ''].filter(Boolean).join('; ');
        lines.push(`${k + 1}. **${step.title}.** ${step.text}${extras ? ` *(In the app this step ${extras}.)*` : ''}`);
    });
    lines.push('');
    if (w.platform === 'p5') {
        const program = compileEquation(w.readable, 'points');
        lines.push(`The point formula defines ${program.definitions.map(d => `\`${d.name}\``).join(', ')} and places point i at the last line. The Point cloud draws ${w.points.count} points with opacity ${w.points.alpha.toFixed(3)} (stroke alpha ${Math.round(w.points.alpha * 255)}), sketch time t = ${w.points.speed.toFixed(4)} × seconds + ${w.points.phase.toFixed(4)}.`, '');
    }
    else {
        const a = analyzeCode(w.readable);
        const loops = a.loops.map(l => `loop ${l.index + 1} (line ${l.line}, ${l.caption || l.name}): ${l.steps ?? 'until its condition fails'} steps${l.depth ? ' per run' : ''}`).join('; ');
        lines.push(`Loops: ${loops}. Variables: ${a.variables.map(v => `\`${v.name}\` ${v.type}`).join(', ')}. Helpers: ${a.helpers.length ? a.helpers.map(h => `\`${h}\``).join(', ') : 'none'}. ${a.numbers.length} numbers can be dragged.`, '');
    }
    lines.push(`Ideas: ${w.concepts.map(id => concept(id).title).join(' · ')}.`, '');
    lines.push(`### ${w.platform === 'p5' ? 'The point formula (equation language)' : 'Readable version'}`, '');
    lines.push(w.platform === 'p5' ? '```text' : '```glsl', w.readable, '```', '');
    if (w.original) {
        lines.push('### As posted', '');
        lines.push(w.platform === 'p5' ? '```js' : '```glsl', w.original, '```', '');
    }
}
writeFileSync(new URL('docs/WORKS.md', root), lines.join('\n'), 'utf8');
console.log(`Wrote docs/WORKS.md (${works.length} works).`);
