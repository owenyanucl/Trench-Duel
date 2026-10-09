# Replay controller and audience output

## Summary

The replay controller lets a co-streamer prepare a historical play privately and publish a clean replay graphic to a separate audience URL that browser capture can pick up. It reconstructs two real 2021 plays from NFL tracking data: on Brady to Gronkowski the measured gap to the nearest defender closes from 2.6 yd at the snap to 0.9 yd at 1.0 s, then opens to 8.1 yd at release, with the nearest defender changing from Tarell Basham to Jourdan Lewis. On the Wentz sack the nearest pass rusher closes from 6.2 yd at the snap to 0.6 yd at the sack marker 3.6 s later, and the recorded sack credit is Harold Landry. It is built for creators who explain plays live: the audience sees only what the creator publishes, and every player on screen and every number shown comes from the recorded tracking and PFF data.

## Run it

```bash
python3 server.py --port 8000          # Python 3 standard library only
```

| URL | What it is |
|---|---|
| `http://localhost:8000/replay/control` | Private controller (draft preview, On stream panel) |
| `http://localhost:8000/replay/output` | Audience output: transparent page, add as a browser source |
| `http://localhost:8000/` | The existing Trench Duel overlay, served from `overlay/` as before |

The server binds `127.0.0.1`; `--host` changes that. The controller accepts an optional draft preset in its hash, for example `/replay/control#play=gronkowski-play&frame=39&player=35481&layers=trails,receiverSpacing,context`.

## Files

| File | Role |
|---|---|
| `server.py` | Static server for `overlay/`, the two replay routes, the published-state API and the SSE stream |
| `overlay/replay/replay.js` | Shared renderer (SVG field, layers, chart, card) and `PublishedView`, used by the controller preview, its on-stream mirror and the output |
| `overlay/replay/replay.css` | Card and field styles |
| `overlay/replay/control.html`, `control.js`, `control.css` | Private controller |
| `overlay/replay/output.html` | Audience output |
| `overlay/replay/data/*.json` | The two prepared plays, copied unchanged from this folder (`schemaVersion: 1`) |

## How it works

- **Draft.** The draft scene `{playKey, frameId, selectedPlayerId, layers {trails, receiverSpacing, qbRusher, context}, contextVisible}` lives only in the controller page and its `sessionStorage`. Selecting a play, a player, a layer, scrubbing or playing the private preview changes only the draft. Changing play resets the selected player and the frame (to the snap) and re-enables only the jumps that play has markers for; layer toggles carry over.
- **Published state.** The server holds the one published scene and playhead `{playing, anchorFrameId, anchorServerTimeMs, rateFps: 10}`.
  - `POST /api/publish` takes the full draft snapshot, validates it against the play (known `playKey`, a real `frameId`, a player in that play, boolean layers, at most one of receiver spacing and nearest pass rusher) and stores only those fields, paused at the snapshot's frame.
  - `POST /api/stream/play` and `/api/stream/pause` move the published playhead. Play at the last frame restarts from the published frame.
  - `POST /api/hide` clears the published scene and stops playback; the draft is untouched.
  - `GET /api/published` returns the state. `GET /api/events` is a Server-Sent Events stream of the published state only: the current state on connect, every change, and a heartbeat every 15 s carrying `serverNowMs`.
- **Playhead.** Every message carries `serverNowMs`. Each output keeps a clock offset and computes `frame = min(last, anchorFrameId + floor(elapsed × 10 / 1000))`, so separate outputs show the same frame without their own timers drifting. A server timer marks `playing: false` at the last available frame.
- **Output.** The output page has no controls, its background is transparent and the card is opaque. It stays empty until Publish and after Hide, and `EventSource` reconnects on its own and receives the current state.
- **One metric at a time.** Receiver spacing and QB to nearest rusher are exclusive in the controller and the server rejects a scene with both.

## What the card shows

- All 22 players as team-coloured dots with jersey numbers, and the ball as a brown ellipse. Raw dataset coordinates are drawn with one scale in x and y, plus an attack-direction label.
- The line of scrimmage (blue) and the first-down target (orange), down and distance (`1st & 10`, `& Goal` when the target is the goal line), the ball spot, and the recorded pre-snap game clock, which does not count down. The score is omitted because home/away is not in the JSON.
- **Trails:** the selected player's observed path up to the current frame. With the quarterback layer it also shows the trails of the passer and the current nearest rusher.
- **Receiver spacing** (selected `Pass Route` player): a dashed line to the current nearest defender, the line `Nearest defender: <name> · <d> yd`, a large distance, and a distance-over-time chart drawn up to the playhead, with its cursor on the playhead and snap and release or sack marks. It reads the exported `nearestDefender`.
- **QB to nearest rusher:** the passer and the current nearest annotated pass rusher are highlighted and joined, with the line `Nearest pass rusher: <name> · <d> yd` and the same chart. It reads the exported `qbToNearestRusher`.
- Footer: time from snap (`(frameId − snapFrame) / 10`), `Snap to release` or `Snap to sack`, and `Pass released`, `Sack` and `End of available tracking` badges.
- **Recorded context:** `Recorded coverage`, `Recorded sack/hit/hurry credit` (or `none`), `Recorded result`, in a separate panel headed "Recorded after the play · PFF". For a completion it adds "The tracking clip ends before the catch."
- A null measurement shows as `unavailable`, never 0. Playback stops at `lastAvailableFrame`.

## Checks run

These were run against `python3 server.py --port 8870`. The controller and output were open in the desktop app's built-in browser as separate tabs. Separate headless Chrome instances with fresh `--user-data-dir` profiles acted as independent browser contexts.

| Check | Result | Evidence |
|---|---|---|
| Output empty before Publish | PASS | Card hidden, body text empty, 0 buttons/selects/inputs, `body` background `rgba(0,0,0,0)` |
| Draft edits do not reach the output | PASS | After selecting Gronkowski, turning on layers and scrubbing to frame 16, `/api/published` was still `null` and the output still empty. Later the draft sat at frame 39 while the output and headless Chrome stayed on frame 16. |
| Publish puts the draft frame on the output, paused | PASS | Output and mirror: `+1.0 s after snap`, `Nearest defender: Tarell Basham · 0.9 yd`. Controller status `frame 16 of 43 · paused` |
| Separate browser context receives the published state | PASS | Headless Chrome (isolated profile) `--dump-dom` of `/replay/output`: `+1.0 s after snap`, `Nearest defender: Tarell Basham · 0.9 yd`, 0 controls |
| Play on stream, two outputs in sync, stop at the last frame | PASS | Two independent `PublishedView`s on separate SSE connections, sampled 14 times over 3.5 s, had 0 mismatches. The server ended at `{playing: false, anchorFrameId: 43}`; the output showed `Pass released`, `End of available tracking` and `+3.7 s` |
| Pause on stream | PASS | Play then Pause from the controller left the stream paused at `frame 26 of 43` while the draft stayed at frame 39 |
| Reloading the output restores the published state | PASS | After reload: `+2.0 s after snap`, `Nearest defender: Tarell Basham · 2.3 yd` (frame 26) |
| Switching plays leaves no stale values | PASS | Switching the draft to Wentz cleared the player selection, set the frame to the snap (6/47) and disabled Release while Snap, Sack and End stayed enabled. The card showed no Gronkowski, Basham, Lewis or "TB 37" text; header `3rd & 6 · Ball on IND 36 · Q2 · 10:04` |
| Hide clears the output, draft stays | PASS | Output card hidden, body text empty. The controller still held Wentz at frame 42 with its metric |
| Missing values show as unavailable | PASS | A test copy of the Gronkowski frame 39 with one defender removed, `nearestDefender: null` and the release marker removed rendered `Nearest defender: unavailable` and `Snap to release: unavailable`, with no connector, no NaN and no 0 |
| Server validation | PASS | Play with nothing published returns 409. A bad frame, a player from another play, or both metrics returns 400 with a message |
| `/` still serves the Trench Duel overlay | PASS | `GET /` → `<title>Trench Duel</title>` |
| `/viewer.html` | Not testable in this worktree | `overlay/viewer.html` is not committed on this branch (404 here). The server serves any file in `overlay/`, so it loads once that file is merged |
| Console errors | PASS | Controller: none. Output: only the deliberate `/viewer.html` 404 probe above |

### The two examples as displayed

**Gronkowski** (game 2021090900, play 3793, receiver nflId 35481), with exact values from the controller's private readout:

| Frame | Displayed | Private readout |
|---|---|---|
| 6 (snap) | Tarell Basham · 2.6 yd (from the JSON at one decimal; this frame was not opened in the browser) | 2.61 yd in the JSON |
| 16 (+1.0 s) | Tarell Basham · 0.9 yd | 0.92 yd |
| 39 (release, +3.3 s) | `Nearest defender: Jourdan Lewis · 8.1 yd`, `Pass released`, `Snap to release: 3.3 s` | 8.06 yd |
| 43 (last frame) | `End of available tracking`, +3.7 s | |

Line of scrimmage at x=47, first-down target at x=57 (read from the SVG lines), offense attacks right, header `1st & 10 · Ball on TB 37 · Q4 · 10:54`. Recorded panel: `Recorded coverage: Cover-2 / Zone`, `Recorded pressure credits: none`, `Recorded result: 7-yard completion`, "The tracking clip ends before the catch."

**Wentz sack** (game 2021103106, play 1231): snap frame 6, sack frame 42, last frame 47. At the sack frame the card shows `+3.6 s after snap`, `Snap to sack: 3.6 s`, `Sack`, and `Nearest pass rusher: Harold Landry · 0.6 yd`. In the exported data (checked in Python, not opened in the browser) the nearest rusher at the snap is Denico Autry at 6.24 yd, and the rusher changes during the play: Autry, then Jeffery Simmons, then Bud Dupree, then Landry. Recorded panel: `Recorded coverage: Quarters / Zone`, `Recorded sack credit: Harold Landry`, `Recorded result: sack, 7-yard loss`. Release is unavailable: the Release jump is disabled, and no time-to-throw is shown.

### Screenshots

- `screenshots/controller-gronkowski-release.png`: the controller with the Gronkowski receiver-spacing draft at release (frame 39, Jourdan Lewis 8.1 yd). The On stream panel mirrors the published frame 16 and flags that the draft differs.
- `screenshots/output-wentz-sack.png`: the audience output at 1280×720 in a separate headless Chrome showing the published Wentz sack frame. Headless Chrome paints the transparent page background white.

## Limitations

- Raw coordinates only: left-going plays are drawn as recorded with a `← TEAM attack` label, not mirrored. The left-direction acceptance check (play 2021090900/137) was not run, because only the two right-going plays are packaged.
- The renderer trusts the exporter's `nearestDefender`, `qbToNearestRusher` and `allDefendersAvailable` and does not recompute them; the incomplete-defense check above exercised the null path on a test copy in the browser, not through the exporter.
- No score: `games.csv` home/away is not joined. No game date in the play description.
- Stream playback is 1x only; 0.5x applies to the private preview. Frame ids are assumed consecutive, which holds for both plays.
- Playback is frame-stepped at 10 Hz without interpolation. A browser tab in the background throttles redraws to about once a second, although the frame it shows is still correct for the server clock.
- Nearby player labels can still touch when three players are highlighted close together.
- State is in memory: restarting the server clears the published scene. There are no accounts and no remote access; it is meant for one creator on one machine.
- No automated test suite: the checks above were run by hand in browsers and with `curl`.
- The exporter `build_overlay_data.py` was not re-run, because the prepared JSON was used as supplied.
