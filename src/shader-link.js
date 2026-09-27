/** Dead-code elimination for the shader libraries.
 *
 * The studio's GLSL libraries (math-glsl.js, nebula-glsl.js, motifs-glsl.js,
 * twigl-glsl.js) hold every function any component might call, over 20 KB of
 * source. A program needs only the functions its components call, and their
 * helpers: the rest still has to be parsed and checked by the browser and the
 * driver, which on some systems takes seconds. linkLibraries() keeps only the
 * top-level items (functions, constants, structs, uniforms) reachable from the
 * program's own code, in their original order (GLSL needs a declaration before
 * its use, and the libraries are written in that order). Pure text processing.
 */
const IDENTIFIER = /[A-Za-z_]\w*/g;
/** Skip whitespace and comments from `i`; returns the next index. */
function skipSpace(source, i) {
    for (;;) {
        while (i < source.length && /\s/.test(source[i])) {
            i++;
        }
        if (source.startsWith('//', i)) {
            const end = source.indexOf('\n', i);
            i = end < 0 ? source.length : end + 1;
        }
        else if (source.startsWith('/*', i)) {
            const end = source.indexOf('*/', i + 2);
            i = end < 0 ? source.length : end + 2;
        }
        else {
            return i;
        }
    }
}
/** Text without comments, for finding identifiers. */
function stripComments(text) {
    return text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
}
/** The names an item defines. */
function definedNames(text) {
    const code = stripComments(text).trim();
    let m = code.match(/^#\s*define\s+([A-Za-z_]\w*)/);
    if (m) {
        return [m[1]];
    }
    m = code.match(/^struct\s+([A-Za-z_]\w*)/);
    if (m) {
        return [m[1]];
    }
    const paren = code.indexOf('('), equals = code.indexOf('='), brace = code.indexOf('{');
    if (paren >= 0 && brace > paren && (equals < 0 || equals > paren)) {
        // A function: the identifier just before the parameter list.
        const head = code.slice(0, paren).match(IDENTIFIER);
        return head ? [head.at(-1)] : [];
    }
    // A declaration: `[qualifiers] type name [= value] (, name [= value])* ;`
    const names = [];
    let depth = 0, part = '';
    const parts = [];
    for (const c of code.replace(/;$/, '')) {
        if (c === '(' || c === '[' || c === '{') {
            depth++;
        }
        if (c === ')' || c === ']' || c === '}') {
            depth--;
        }
        if (c === ',' && depth === 0) {
            parts.push(part);
            part = '';
        }
        else {
            part += c;
        }
    }
    parts.push(part);
    parts.forEach((p, k) => {
        const left = p.split('=')[0].match(IDENTIFIER) || [];
        const name = k === 0 ? left.at(-1) : left[0];
        if (name) {
            names.push(name);
        }
    });
    return names;
}
/** Split GLSL source into top-level items {text, names, refs}. */
export function topLevelItems(source) {
    const items = [];
    let i = skipSpace(source, 0);
    while (i < source.length) {
        const start = i;
        if (source[i] === '#') {
            const end = source.indexOf('\n', i);
            i = end < 0 ? source.length : end + 1;
        }
        else {
            let depth = 0;
            for (; i < source.length; i++) {
                const next = skipSpace(source, i);
                if (next !== i) {
                    i = next - 1;
                    continue;
                }
                const c = source[i];
                if (c === '{' || c === '(' || c === '[') {
                    depth++;
                }
                else if (c === '}' || c === ')' || c === ']') {
                    depth--;
                    if (c === '}' && depth === 0) {
                        // End of a function body, or of a struct (which ends with ;).
                        const after = skipSpace(source, i + 1);
                        i = source[after] === ';' ? after + 1 : i + 1;
                        break;
                    }
                }
                else if (c === ';' && depth === 0) {
                    i++;
                    break;
                }
            }
        }
        const text = source.slice(start, i).trim(), names = definedNames(text);
        const refs = new Set(stripComments(text).match(IDENTIFIER) || []);
        names.forEach(n => refs.delete(n));
        items.push({ text, names, refs });
        i = skipSpace(source, i);
    }
    return items;
}
const itemCache = new Map();
function itemsOf(library) {
    if (!itemCache.has(library)) {
        itemCache.set(library, topLevelItems(library));
    }
    return itemCache.get(library);
}
/** The library code a program needs: every item reachable from the identifiers
 * of `code` (the program's own text), in library order. `libraries` is a list
 * of GLSL sources; later ones may use earlier ones.
 */
export function linkLibraries(code, libraries) {
    const items = libraries.flatMap(itemsOf), byName = new Map();
    for (const item of items) {
        for (const name of item.names) {
            if (!byName.has(name)) {
                byName.set(name, []);
            }
            byName.get(name).push(item);
        }
    }
    const included = new Set(), queue = [...new Set(stripComments(code).match(IDENTIFIER) || [])], seen = new Set();
    while (queue.length) {
        const name = queue.pop();
        if (seen.has(name)) {
            continue;
        }
        seen.add(name);
        for (const item of byName.get(name) || []) {
            if (!included.has(item)) {
                included.add(item);
                queue.push(...item.refs);
            }
        }
    }
    return items.filter(item => included.has(item)).map(item => item.text).join('\n');
}
