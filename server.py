#!/usr/bin/env python3
"""Local server for the Trench Duel overlay and the private replay controller.

Serves overlay/ as static files, so / is the Trench Duel overlay, and adds:

  /replay/control       private controller: the draft scene lives only in that page
  /replay/output        audience output: renders only the published scene
  GET  /api/plays       the prepared plays in overlay/replay/data/
  GET  /api/published   the current published state
  GET  /api/events      Server-Sent Events stream of the published state
  POST /api/publish     body: a complete draft scene; stored paused at its frame
  POST /api/stream/play, /api/stream/pause, /api/hide

The server holds the single published scene and its playhead. Outputs compute
the current frame from the playhead anchor and the server clock, so every output
shows the same frame. Python standard library only; binds 127.0.0.1 by default.

    python3 server.py --port 8000
"""
import argparse
import copy
import json
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
OVERLAY = ROOT / 'overlay'
REPLAY_DATA = OVERLAY / 'replay' / 'data'
RATE_FPS = 10
HEARTBEAT_SECONDS = 15
MAX_BODY_BYTES = 16 * 1024
LAYERS = ('trails', 'receiverSpacing', 'qbRusher', 'context')
PAGES = {'/replay/control': '/replay/control.html', '/replay/output': '/replay/output.html'}


def now_ms():
    return int(time.time() * 1000)


def load_plays(data_dir):
    """Index each prepared play: its frame ids, player ids and a readable summary."""
    plays = {}
    for path in sorted(Path(data_dir).glob('*.json')):
        raw = json.loads(path.read_text(encoding='utf-8'))
        frame_ids = [int(f['frameId']) for f in raw['frames']]
        player_ids = {int(e['nflId']) for f in raw['frames'] for e in f['entities'] if e.get('nflId') is not None}
        recorded = raw['recordedPlay']
        plays[path.stem] = {
            'frameIds': set(frame_ids),
            'firstFrameId': min(frame_ids),
            'lastFrameId': max(frame_ids),
            'playerIds': player_ids,
            'summary': {
                'playKey': path.stem,
                'file': f'data/{path.name}',
                'gameId': raw['gameId'],
                'playId': raw['playId'],
                'possessionTeam': recorded.get('possessionTeam'),
                'defensiveTeam': recorded.get('defensiveTeam'),
                'quarter': recorded.get('quarter'),
                'gameClock': recorded.get('gameClock'),
                'down': recorded.get('down'),
                'yardsToGo': recorded.get('yardsToGo'),
                'passResult': recorded.get('passResult'),
                'playDescription': recorded.get('playDescription'),
            },
        }
    return plays


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


class Stage:
    """The one authoritative published scene and playhead."""

    def __init__(self, plays):
        self.plays = plays
        self.cond = threading.Condition()
        self.version = 0
        self.published = None

    def clean_scene(self, body):
        if not isinstance(body, dict):
            raise ValueError('The scene must be a JSON object.')
        key = body.get('playKey')
        if key not in self.plays:
            raise ValueError('Unknown playKey.')
        play = self.plays[key]
        frame_id = body.get('frameId')
        if not is_int(frame_id) or frame_id not in play['frameIds']:
            raise ValueError('frameId is not a frame of this play.')
        selected = body.get('selectedPlayerId')
        if selected is not None and (not is_int(selected) or selected not in play['playerIds']):
            raise ValueError('selectedPlayerId is not a player in this play.')
        given = body.get('layers')
        if not isinstance(given, dict):
            raise ValueError('layers must be an object.')
        layers = {}
        for name in LAYERS:
            value = given.get(name, False)
            if not isinstance(value, bool):
                raise ValueError(f'layers.{name} must be true or false.')
            layers[name] = value
        if layers['receiverSpacing'] and layers['qbRusher']:
            raise ValueError('Publish one primary metric at a time: receiver spacing or nearest pass rusher.')
        return {'playKey': key, 'frameId': frame_id, 'selectedPlayerId': selected,
                'layers': layers, 'contextVisible': layers['context']}

    def message(self):
        """Caller holds the lock."""
        return {'version': self.version, 'serverNowMs': now_ms(), 'published': copy.deepcopy(self.published)}

    def _changed(self):
        self.version += 1
        self.cond.notify_all()

    def _current_frame(self, at_ms):
        playhead = self.published['playhead']
        if not playhead['playing']:
            return playhead['anchorFrameId']
        elapsed = max(0, at_ms - playhead['anchorServerTimeMs'])
        advanced = playhead['anchorFrameId'] + elapsed * playhead['rateFps'] // 1000
        return min(self.published['lastFrameId'], advanced)

    def publish(self, body):
        scene = self.clean_scene(body)
        play = self.plays[scene['playKey']]
        with self.cond:
            self.published = {
                'scene': scene,
                'firstFrameId': play['firstFrameId'],
                'lastFrameId': play['lastFrameId'],
                'playhead': {'playing': False, 'anchorFrameId': scene['frameId'],
                             'anchorServerTimeMs': now_ms(), 'rateFps': RATE_FPS},
            }
            self._changed()
            return self.message()

    def play(self):
        with self.cond:
            if self.published is None:
                raise LookupError('Nothing is published.')
            playhead = self.published['playhead']
            last = self.published['lastFrameId']
            if not playhead['playing']:
                start = playhead['anchorFrameId']
                if start >= last:
                    start = self.published['scene']['frameId']
                if start < last:
                    self.published['playhead'] = {'playing': True, 'anchorFrameId': start,
                                                  'anchorServerTimeMs': now_ms(), 'rateFps': RATE_FPS}
                    self._changed()
                    delay = (last - start) / RATE_FPS + 0.05
                    timer = threading.Timer(delay, self._reach_end, args=(self.version,))
                    timer.daemon = True
                    timer.start()
            return self.message()

    def _reach_end(self, version):
        with self.cond:
            if self.published is None or self.version != version:
                return
            self.published['playhead'] = {'playing': False, 'anchorFrameId': self.published['lastFrameId'],
                                          'anchorServerTimeMs': now_ms(), 'rateFps': RATE_FPS}
            self._changed()

    def pause(self):
        with self.cond:
            if self.published is None:
                raise LookupError('Nothing is published.')
            if self.published['playhead']['playing']:
                at = now_ms()
                self.published['playhead'] = {'playing': False, 'anchorFrameId': self._current_frame(at),
                                              'anchorServerTimeMs': at, 'rateFps': RATE_FPS}
                self._changed()
            return self.message()

    def hide(self):
        with self.cond:
            if self.published is not None:
                self.published = None
                self._changed()
            return self.message()


class Handler(SimpleHTTPRequestHandler):
    stage = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(OVERLAY), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/plays':
            return self.send_json([p['summary'] for p in self.stage.plays.values()])
        if path == '/api/published':
            with self.stage.cond:
                return self.send_json(self.stage.message())
        if path == '/api/events':
            return self.stream_events()
        if path in PAGES:
            self.path = PAGES[path]
        return super().do_GET()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path in PAGES:
            self.path = PAGES[path]
        return super().do_HEAD()

    def do_POST(self):
        path = urlsplit(self.path).path
        actions = {'/api/stream/play': self.stage.play, '/api/stream/pause': self.stage.pause,
                   '/api/hide': self.stage.hide}
        try:
            if path == '/api/publish':
                return self.send_json(self.stage.publish(self.read_json()))
            if path in actions:
                return self.send_json(actions[path]())
        except ValueError as error:
            return self.send_json({'error': str(error)}, HTTPStatus.BAD_REQUEST)
        except LookupError as error:
            return self.send_json({'error': str(error)}, HTTPStatus.CONFLICT)
        return self.send_json({'error': 'Not found.'}, HTTPStatus.NOT_FOUND)

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError('Send a JSON body of at most 16 KB.')
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError('The body is not valid JSON.') from error

    def stream_events(self):
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.end_headers()
        stage = self.stage
        sent = None
        try:
            self.wfile.write(b'retry: 1000\n\n')
            while True:
                with stage.cond:
                    stage.cond.wait_for(lambda: stage.version != sent, timeout=HEARTBEAT_SECONDS)
                    message = stage.message() if stage.version != sent else None
                if message is None:
                    chunk = f'event: heartbeat\ndata: {json.dumps({"serverNowMs": now_ms()})}\n\n'
                else:
                    sent = message['version']
                    chunk = f'event: published\ndata: {json.dumps(message, allow_nan=False)}\n\n'
                self.wfile.write(chunk.encode('utf-8'))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return


def main():
    parser = argparse.ArgumentParser(description='Serve the Trench Duel overlay and the replay controller.')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    Handler.stage = Stage(load_plays(REPLAY_DATA))
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    base = f'http://{args.host}:{args.port}'
    print(f'Trench Duel overlay  {base}/\nReplay controller    {base}/replay/control\n'
          f'Audience output      {base}/replay/output', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
