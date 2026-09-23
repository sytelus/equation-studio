#!/usr/bin/env python3
"""Write MANIFEST.json: every distributed file with its size and SHA-256.

Run last, after building the bundle and regenerating documentation, so the
manifest describes exactly what is shipped. Version control, caches, virtual
environments and render outputs are excluded.
"""
from __future__ import annotations
from pathlib import Path
import datetime
import hashlib
import json
ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRS = {'.git', '__pycache__', '.venv', 'node_modules', '.pytest_cache', '.ruff_cache', 'output'}
EXCLUDED_FILES = {'MANIFEST.json', '.DS_Store', 'Thumbs.db'}


def distributed_files():
    for path in sorted(ROOT.rglob('*')):
        relative = path.relative_to(ROOT)
        if not path.is_file() or relative.name in EXCLUDED_FILES and relative.parent == Path('.'):
            continue
        if any(part in EXCLUDED_DIRS for part in relative.parts) or relative.name in {'.DS_Store', 'Thumbs.db'}:
            continue
        yield relative


def main() -> int:
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    files = []
    for relative in distributed_files():
        data = (ROOT / relative).read_bytes()
        files.append({'path': relative.as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    manifest = {'project': 'Equation Studio', 'version': version, 'date': datetime.date.today().isoformat(), 'file_count': len(files), 'files': files}
    (ROOT / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f'Wrote MANIFEST.json with {len(files)} files (version {version}).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
