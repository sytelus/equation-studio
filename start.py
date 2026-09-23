#!/usr/bin/env python3
"""Serve Equation Studio on loopback only. No third-party Python packages needed.

Double-clicking 'Equation Studio.html' is the simpler standalone path. This
launcher is useful when editing ES modules or when local-file policies differ.
It never exposes the project to other machines on your network.
"""
from __future__ import annotations
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent

class LocalHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript; charset=utf-8',
                      '.mjs': 'text/javascript; charset=utf-8'}

    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def list_directory(self, path: str):
        self.send_error(403, 'Directory listing is disabled')
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-open', action='store_true', help='Do not open a browser')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    handler = partial(LocalHandler, directory=str(ROOT))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as exc:
        print(f'Cannot start local server: {exc}\nTry --port {args.port + 1 if args.port < 65535 else 8765}', file=sys.stderr)
        return 1
    url = f'http://127.0.0.1:{args.port}/'
    print(f'Equation Studio: {url}\nServing only {ROOT}\nPress Ctrl+C to stop.', flush=True)
    if not args.no_open:
        timer = threading.Timer(.3, lambda: webbrowser.open(url))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    finally:
        server.server_close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
