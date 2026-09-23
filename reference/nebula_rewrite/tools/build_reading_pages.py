"""Generate offline reading pages from Markdown; no renderer dependency.

Run after: python -m pip install -r requirements-docs.txt
Then: python -m tools.build_reading_pages
The LaTeX-heavy formula appendix remains Markdown rather than requiring an
online math renderer or shipping external font files.
"""
from pathlib import Path
import html
import re

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[1]
PAGES = ("README.md", "ATTRIBUTION.md", "docs/WALKTHROUGH.md", "docs/COMPOSITION.md", "docs/NUMERICS_AND_VALIDATION.md")
CSS = '''
:root{color-scheme:light}body{margin:0;color:#243142;background:#f5f4f0;font:17px/1.7 system-ui,sans-serif}
main{max-width:1040px;margin:auto;padding:28px 32px 90px;background:white}nav{font-size:.9rem;border-bottom:1px solid #ccd1db;padding-bottom:18px;margin-bottom:30px}
a{color:#713265}h1,h2,h3{line-height:1.25;letter-spacing:-.02em;color:#172438}h1{font-size:2.4rem}h2{font-size:1.7rem;margin-top:2.3em}h3{margin-top:1.9em}
p,li{max-width:88ch}pre{padding:20px;overflow:auto;background:#f1f3f7;border-radius:8px;font-size:14px;line-height:1.6}code{font-family:ui-monospace,monospace;font-size:.9em}p code,td code{background:#f0eef4;padding:.1em .3em;border-radius:3px}
table{width:100%;border-collapse:collapse;font-size:.9rem;display:block;overflow:auto}th,td{padding:11px 14px;border-bottom:1px solid #dfe3ea;text-align:left;vertical-align:top}th{background:#f0eef4}img{max-width:100%;height:auto;border-radius:8px}
@media(max-width:650px){main{padding:20px 16px}body{font-size:16px}h1{font-size:2rem}}
'''


def main():
    markdown = MarkdownIt("commonmark").enable("table")
    generated = {str((ROOT / page).resolve()) for page in PAGES}
    for filename in PAGES:
        source = ROOT / filename
        text = source.read_text(encoding="utf-8")
        content = markdown.render(text)
        def replace_link(match):
            target = match.group(1)
            if target.endswith(".md") and str((source.parent / target).resolve()) in generated:
                target = target[:-3] + ".html"
            return 'href="' + target + '"'
        content = re.sub(r'href="([^"]+)"', replace_link, content)
        prefix = "../" if source.parent.name == "docs" else ""
        title = text.splitlines()[0].lstrip("# ")
        nav = f'<nav><a href="{prefix}README.html">Start / run instructions</a> · <a href="{prefix}gallery/index.html">Layer viewer</a> · <a href="{source.name}">Markdown source</a></nav>'
        page = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{CSS}</style></head><body><main>{nav}{content}</main></body></html>'
        source.with_suffix(".html").write_text(page, encoding="utf-8")
        print(source.with_suffix(".html").relative_to(ROOT))


if __name__ == "__main__":
    main()
