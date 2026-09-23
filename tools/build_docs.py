#!/usr/bin/env python3
"""Rebuild local HTML reading pages with native MathML; no runtime CDN/scripts.

Optional development dependency: Pandoc, found on PATH or through the
``pypandoc-binary`` package (``python -m pip install pypandoc-binary``). The
ready-made HTML pages are included so app users do not need Pandoc, Node, or
Python merely to read the documentation.
"""
from pathlib import Path
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
ROOT = Path(__file__).resolve().parents[1]
NAV = [
    ('Equation%20Studio.html', 'Open studio'), ('README.html', 'Start here'), ('docs/EDITOR_GUIDE.html', 'Editor guide'),
    ('docs/RECIPES.html', 'Recipes'), ('docs/ARCHITECTURE.html', 'Architecture'), ('docs/COMPONENTS.html', 'Components'),
    ('docs/DEVELOPMENT.html', 'Development'), ('docs/RESEARCH.html', 'Research'), ('docs/VALIDATION.html', 'Validation')
]


def find_pandoc() -> str | None:
    exe = shutil.which('pandoc')
    if exe:
        return exe
    try:
        import pypandoc
        return pypandoc.get_pandoc_path()
    except (ImportError, OSError):
        return None


def main() -> int:
    exe = find_pandoc()
    if not exe:
        print('Pandoc is required only to regenerate HTML docs. Existing HTML and Markdown remain usable.', file=sys.stderr)
        return 1
    sources = [ROOT / 'README.md', ROOT / 'ATTRIBUTION.md', ROOT / 'CHANGELOG.md', ROOT / 'examples/README.md', *sorted((ROOT / 'docs').glob('*.md'))]
    sources = [s for s in sources if s.exists()]
    outputs = {p.with_suffix('.html') for p in sources}
    for source in sources:
        prefix = os.path.relpath(ROOT, source.parent).replace(os.sep, '/')

        def link(path):
            return f'{prefix}/{path}' if prefix != '.' else path
        nav = '<nav class="topnav">' + ' '.join(f'<a href="{html.escape(link(path))}">{label}</a>' for path, label in NAV) + '</nav>'
        title = source.read_text(encoding='utf-8').splitlines()[0].lstrip('# ').strip()
        with tempfile.NamedTemporaryFile('w', suffix='.html', encoding='utf-8', delete=False) as temp:
            temp.write(nav)
            header = Path(temp.name)
        output = source.with_suffix('.html')
        try:
            subprocess.run([exe, str(source), '--from=markdown+tex_math_single_backslash', '--to=html5', '--standalone', '--mathml', '--toc', '--toc-depth=2', '--metadata', f'pagetitle={title}', '--css', link('docs/reading.css'), '--include-before-body', str(header), '--output', str(output)], check=True)
        finally:
            header.unlink(missing_ok=True)
        content = output.read_text(encoding='utf-8')

        def local_reading_link(match):
            url = html.unescape(match[1])
            if '://' in url or not url.endswith('.md'):
                return match[0]
            target = (source.parent / url).resolve().with_suffix('.html')
            if target in outputs or target.exists():
                return 'href="' + match[1][:-3] + '.html"'
            return match[0]
        content = re.sub(r'href="([^"]+)"', local_reading_link, content)
        output.write_text(content, encoding='utf-8', newline='\n')
        print(output.relative_to(ROOT))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
