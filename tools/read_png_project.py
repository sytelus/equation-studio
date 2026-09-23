#!/usr/bin/env python3
"""Recover Equation Studio's project from a PNG without Pillow or other packages.

python3 tools/read_png_project.py image.png --output recovered.json
python3 tools/read_png_project.py image.png --metadata > render-settings.json

Only the application's uncompressed UTF-8 iTXt format is supported. Chunk lengths,
CRCs, signature, JSON structure and metadata size are checked. A metadata-bearing
PNG can contain private project labels/expressions; inspect before sharing it.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import struct
import sys
import zlib

SIGNATURE = b'\x89PNG\r\n\x1a\n'

def extract(path: Path) -> dict:
    with path.open('rb') as handle:
        if handle.read(8) != SIGNATURE:
            raise ValueError('Not a PNG file')
        while True:
            header = handle.read(8)
            if len(header) != 8:
                raise ValueError('No Equation Studio metadata found')
            length, kind = struct.unpack('>I4s', header)
            if length > 128 * 1024 * 1024:
                raise ValueError('PNG chunk exceeds safety limit')
            payload = handle.read(length)
            crc = handle.read(4)
            if len(payload) != length or len(crc) != 4:
                raise ValueError('Truncated PNG chunk')
            if zlib.crc32(kind + payload) & 0xFFFFFFFF != struct.unpack('>I', crc)[0]:
                raise ValueError(f'Invalid {kind!r} chunk CRC')
            if kind == b'iTXt' and payload.startswith(b'equation-studio\0'):
                if length > 1_500_000:
                    raise ValueError('Metadata exceeds safety limit')
                keyword, rest = payload.split(b'\0', 1)
                if rest[:2] != b'\0\0':
                    raise ValueError('Expected uncompressed iTXt')
                language, translated, text = rest[2:].split(b'\0', 2)
                data = json.loads(text.decode('utf-8'))
                if not isinstance(data, dict) or not isinstance(data.get('project'), dict):
                    raise ValueError('Metadata has no project object')
                return data
            if kind == b'IEND':
                raise ValueError('No Equation Studio metadata found; some editors strip it')

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('png', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--metadata', action='store_true', help='Return full render metadata, not just the project')
    args = parser.parse_args()
    try:
        metadata = extract(args.png)
        text = json.dumps(metadata if args.metadata else metadata['project'], indent=2, ensure_ascii=False) + '\n'
        if args.output:
            args.output.write_text(text, encoding='utf-8')
        else:
            print(text, end='')
    except (OSError, ValueError, UnicodeError) as exc:
        print(f'Cannot recover project: {exc}', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
