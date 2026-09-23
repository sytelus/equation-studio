#!/usr/bin/env python3
"""Bundle the small, dependency-free ES-module graph into one offline HTML file.

This is a deliberately narrow build script for OUR named-import modules, not a
JavaScript parser or general-purpose bundler. It rejects unsupported imports.
The editable ES modules also run directly from the provided local static server.
"""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]
IMPORT=re.compile(r"^import\s*\{([^}]+)\}\s*from\s*['\"](.+?)['\"];?\s*$",re.M)
EXPORT=re.compile(r'\bexport\s+(?:async\s+)?(?:const|let|class|function)\s+(\w+)')
def bundle(entry='app.js'):
    seen=set(); pieces=['const __modules = Object.create(null);']
    def visit(name):
        if name in seen:return
        seen.add(name)
        source=(ROOT/'src'/name).read_text()
        imports=IMPORT.findall(source)
        for names,path in imports:
            if not path.startswith('./') or '/' in path[2:]:raise ValueError(f'Unsupported import {path}')
            visit(path[2:])
        exports=EXPORT.findall(source)
        source=IMPORT.sub(lambda m:f'const {{{m.group(1)}}} = __modules[{m.group(2)[2:]!r}];',source)
        source=re.sub(r'\bexport\s+(?=(?:async\s+)?(?:const|let|class|function)\b)','',source)
        if re.search(r'^import\s',source,re.M):raise ValueError(f'Unprocessed import in {name}')
        pieces.append(f'__modules[{name!r}] = (() => {{\n{source}\nreturn {{{",".join(exports)}}};\n}})();')
    visit(entry)
    return '\n'.join(pieces)
def build():
    js=bundle(); (ROOT/'studio.js').write_text(js)
    html=(ROOT/'index.html').read_text()
    css=(ROOT/'style.css').read_text()
    html=html.replace('<link rel="stylesheet" href="style.css">',f'<style>\n{css}\n</style>')
    escaped_js=js.replace("</script", "<\\/script")
    html=html.replace('<script type="module" src="src/app.js"></script>',f'<script>\n{escaped_js}\n</script>')
    (ROOT/'Equation Studio.html').write_text(html)
    print(f'Built Equation Studio.html ({len(html):,} characters); no runtime external dependencies.')
if __name__=='__main__':build()
