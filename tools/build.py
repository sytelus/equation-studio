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
EXPORT=re.compile(r'\bexport\s+(?:async\s+)?(?:const|let|class|function)\s+([\w$]+)')
def bundle(entry='app.js'):
    seen=set(); pieces=['const __modules = Object.create(null);']
    def visit(name):
        if name in seen:return
        seen.add(name)
        source=(ROOT/'src'/name).read_text(encoding='utf-8')
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
STYLE_TAG='<link rel="stylesheet" href="style.css">'
SCRIPT_TAG='<script type="module" src="app.js"></script>'
def build():
    """src/index.html (the page that loads the modules) → index.html (one self-contained file)."""
    js=bundle(); (ROOT/'studio.js').write_text(js, encoding='utf-8', newline='\n')
    html=(ROOT/'src'/'index.html').read_text(encoding='utf-8')
    css=(ROOT/'src'/'style.css').read_text(encoding='utf-8')
    for tag in (STYLE_TAG,SCRIPT_TAG):
        if html.count(tag)!=1:raise ValueError(f'src/index.html must contain {tag} exactly once')
    html=html.replace(STYLE_TAG,f'<style>\n{css}\n</style>')
    escaped_js=js.replace("</script", "<\\/script")
    html=html.replace(SCRIPT_TAG,f'<script>\n{escaped_js}\n</script>')
    (ROOT/'index.html').write_text(html, encoding='utf-8', newline='\n')
    print(f'Built index.html ({len(html):,} characters); no runtime external dependencies.')
if __name__=='__main__':build()
