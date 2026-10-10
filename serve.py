#!/usr/bin/env python3
"""Serve this folder.

    python3 serve.py                      # http://127.0.0.1:5180, this computer only
    python3 serve.py 8080 --bind 0.0.0.0  # another port, reachable from other computers

Unlike `python3 -m http.server`, it tells the browser to check for newer files on every load.
Without that, a browser can go on using scripts it saved earlier for an hour or more after the
files change, and a new page running old scripts breaks.
"""
import argparse
import functools
import http.server
import pathlib


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


parser = argparse.ArgumentParser(description='Serve this folder.')
parser.add_argument('port', nargs='?', type=int, default=5180)
parser.add_argument('--bind', default='127.0.0.1')
args = parser.parse_args()

root = pathlib.Path(__file__).resolve().parent
server = http.server.ThreadingHTTPServer((args.bind, args.port), functools.partial(Handler, directory=str(root)))
print(f'Serving {root} at http://{args.bind}:{args.port}', flush=True)
server.serve_forever()
