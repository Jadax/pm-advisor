"""PM Copilot local server — the bridge between your browser and the project's data folder.

GET  /ping                   status: data counts, last refit, model version
GET  /<path>                 serves project files (the userscript self-updates from /pm-copilot.user.js,
                             and hot-loads /model/params.json)
GET  /list?dir=data/reports  JSON list of file names in a data folder
POST /save                   {"path": "data/...", "content": <json|string>, "append": bool}
                             writes under data/ or model/ only

New data under data/reports or data/players triggers a refit (node model/fit.js) a minute later,
at most every 10 minutes, so the model keeps learning without anyone running it.

Run:  python tools/server.py        (http://127.0.0.1:8765)
"""
import http.server
import json
import os
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITABLE = ('data', 'model')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
REFIT_DELAY, REFIT_MIN_GAP = 60, 600

state = {'dirty_at': None, 'last_fit': None, 'last_fit_ok': None, 'fitting': False}
lock = threading.Lock()


def safe_path(rel):
    rel = rel.replace('\\', '/').lstrip('/')
    full = os.path.normpath(os.path.join(ROOT, rel))
    top = os.path.relpath(full, ROOT).split(os.sep)[0]
    if top not in WRITABLE or not full.startswith(ROOT):
        raise ValueError('path outside data/ or model/: ' + rel)
    return full


def count(d):
    p = os.path.join(ROOT, 'data', d)
    return len(os.listdir(p)) if os.path.isdir(p) else 0


def refit_loop():
    while True:
        time.sleep(15)
        with lock:
            due = state['dirty_at'] and time.time() - state['dirty_at'] > REFIT_DELAY \
                and (not state['last_fit'] or time.time() - state['last_fit'] > REFIT_MIN_GAP)
            if not due:
                continue
            state['dirty_at'], state['fitting'] = None, True
        try:
            r = subprocess.run(['node', os.path.join(ROOT, 'model', 'fit.js')], cwd=ROOT, capture_output=True, text=True, timeout=600)
            ok = r.returncode == 0
            print(time.strftime('%H:%M'), 'refit', 'ok' if ok else 'FAILED\n' + r.stderr[-2000:], flush=True)
        except Exception as e:
            ok = False
            print('refit error', e, flush=True)
        with lock:
            state.update(last_fit=time.time(), last_fit_ok=ok, fitting=False)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/ping'):
            params = {}
            try:
                with open(os.path.join(ROOT, 'model', 'params.json'), encoding='utf-8') as f:
                    params = json.load(f)
            except Exception:
                pass
            return self.reply(200, {'ok': True, 'reports': count('reports'), 'teams': count('teams'), 'players': count('players'),
                                    'fittedOn': params.get('fittedOn'), 'fittedAt': params.get('fittedAt'),
                                    'fitting': state['fitting'], 'pendingRefit': bool(state['dirty_at'])})
        if self.path.startswith('/list'):
            from urllib.parse import urlparse, parse_qs
            d = parse_qs(urlparse(self.path).query).get('dir', [''])[0]
            try:
                full = safe_path(d)
                return self.reply(200, sorted(os.listdir(full)) if os.path.isdir(full) else [])
            except ValueError as e:
                return self.reply(400, {'error': str(e)})
        return super().do_GET()

    def do_POST(self):
        if self.path != '/save':
            return self.reply(404, {'error': 'unknown endpoint'})
        try:
            msg = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            full = safe_path(msg['path'])
            os.makedirs(os.path.dirname(full), exist_ok=True)
            content = msg['content']
            if msg.get('append'):
                with open(full, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(content, ensure_ascii=False) + '\n')
            elif isinstance(content, str):
                with open(full, 'w', encoding='utf-8', newline='\n') as f:
                    f.write(content)
            else:
                with open(full, 'w', encoding='utf-8', newline='\n') as f:
                    json.dump(content, f, ensure_ascii=False, indent=1)
            if msg['path'].replace('\\', '/').startswith(('data/reports/', 'data/players/', 'data/decisions')):
                with lock:
                    state['dirty_at'] = time.time()
            return self.reply(200, {'ok': True, 'path': msg['path']})
        except Exception as e:  # every failure goes back to the caller
            return self.reply(400, {'error': str(e)})


if __name__ == '__main__':
    threading.Thread(target=refit_loop, daemon=True).start()
    print(f'PM Copilot server on http://127.0.0.1:{PORT} (root {ROOT})', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
