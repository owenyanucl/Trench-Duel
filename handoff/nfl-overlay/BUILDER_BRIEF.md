# NFL replay overlay builder brief

Build a working hackathon demo that lets an NFL co-streamer privately prepare an explanation of a play and publish a clean replay graphic for their audience. Implement the app using the supplied research, two real-play data files and Python exporter. Deliver working code and a demonstrated user flow, not another proposal.

The creator is the only operator. Viewers watch the output and have no controls. The useful football questions are: how did a receiver's space change, how quickly did defenders approach the quarterback, and what was the down-and-distance situation?

## Start here

1. Inspect the existing project and follow its applicable instructions. Preserve existing work and reuse its stack and conventions. If it has no app, choose the smallest practical stack that serves a browser interface and shared state; a lightweight Python server with HTML, SVG and JavaScript is sufficient.
2. Read this brief, then inspect `gronkowski-play.json`, `wentz-sack.json` and `build_overlay_data.py`. Use the prepared data immediately so UI work does not depend on downloading the entire dataset.
3. Build the private controller and the audience output, then implement the required layers and acceptance checks below.
4. Use `viewer-questions-and-data-plan.html`, `feature-map.json` and `data-audit.json` as supporting research. The 45 questions are a catalogue of possibilities, not 45 requested features.
5. Make routine implementation choices yourself. Ask only if a missing dependency or conflicting requirement actually prevents progress. Do not treat the earlier three-hour deadline as three new hours available now.

## Required product behavior

Provide two separate views, such as `/control` and `/overlay`.

### Private controller

- Select one of the two prepared plays, with a readable description.
- Play, pause and scrub a private replay. Support 0.5x and 1x playback if straightforward.
- Jump to snap and, when available, release or sack.
- Select a player by clicking the field or choosing a name. Show jersey number and name together where possible.
- Toggle player trails, receiver spacing, quarterback-to-rusher distance, and recorded context.
- Preview the scene privately before publishing it.
- Publish the complete scene, play or pause the published replay, and hide the audience graphic.
- Clearly distinguish private preview controls from controls that affect the stream.

### Audience output

- Show only the published scene, without buttons, selectors, debugging text, private notes or editable controls.
- Use a clean field reconstruction, readable player labels and at most one primary analysis metric at a time.
- Show the recorded play context when the creator enables it.
- Have a transparent surrounding background suitable for browser capture; the field graphic itself can have an opaque background for contrast.
- Stay empty until the creator publishes. Hide must remove all audience graphics without deleting the private draft.
- Provide a stable local URL that can be opened independently of the controller. Browser capture compatibility is enough for this MVP; do not build an OBS plugin.

The app reconstructs historical tracking on a two-dimensional field. It does not supply game video. Positioning graphics over moving television footage would need footage synchronization and camera calibration and is outside this build.

## Private preview and published state

Keep two independent scenes: `draftScene` and `publishedScene`. A scene includes the play key, selected frame, selected player, visible layers, trail settings and whether recorded context is visible.

Use these explicit interaction rules:

1. Selecting a play, selecting a player, changing a layer, scrubbing or playing the private preview changes only the draft.
2. Publish copies a complete snapshot of the draft to the published scene atomically. Start the newly published snapshot paused, so the frame and explanation are predictable.
3. Explicit Play on stream and Pause on stream controls affect the published playhead. They must not depend on whatever the creator subsequently does in the draft.
4. To send a privately scrubbed frame or different scene to the audience, publish again.
5. Hide clears the published scene and stops its playback. The draft remains available for further preparation.
6. Changing the draft play resets incompatible player selections, frames and event buttons. Changing a published play replaces all corresponding data together.

Maintain one authoritative published state and playhead. The output must work in a separate browser session, including a browser capture process, rather than relying on shared React component state or same-browser BroadcastChannel alone. A small local server with WebSocket or SSE updates and mutation endpoints is sufficient. Reconnecting or newly opened output clients must receive the current published state. Avoid independent timers that make two output clients show different frames.

For the hackathon, local hosting is sufficient. Production accounts, remote access and deployment are outside scope. The audience route must not display or receive private draft state through its published-state channel.

## Required visualization layers

### Field and play context

Render all available players and the ball at the current frame. Distinguish the two teams by color and distinguish the ball by shape. Use names or jersey labels for selected/highlighted players rather than labelling every dot with a long name.

Draw the play start line and first-down target. Display down and yards to go in normal football notation, for example `1st & 10`. The first-down line is a reference: an off-ball receiver crossing it does not mean a first down was earned.

The game clock and scores are the recorded values before the play. Do not count down the game clock during the animation or fabricate a later score. The current JSON does not include the `games.csv` mapping from home/away to team abbreviations. Join that metadata before labelling scores by team, or omit the score in the MVP. Do not guess which team is home from `possessionTeam`.

### Receiver spacing

For a selected player whose per-play role is `Pass Route`, show:

- Their observed movement trail.
- The current nearest opposing defender, highlighted with a connecting line.
- The gap in yards, labelled `Nearest defender` or `Nearest-defender distance`.
- A compact distance-over-time chart whose cursor follows the replay.
- The nearest defender's name. Update that name when the nearest defender changes.

Use the existing exported `nearestDefender` values. If recalculating, calculate the Euclidean distance to every opposing defender in the same frame and take the minimum:

`distance = min(sqrt((receiver_x - defender_x)^2 + (receiver_y - defender_y)^2))`

Exclude teammates and the ball. A valid nearest-distance calculation requires the required defender positions to be present. Missing data must remain unavailable, not zero. The two prepared plays have all 11 defenders in every frame.

This is a geometric measurement. Do not rename it catch probability, safe-pass score, best target, coverage assignment or proof that the quarterback made a mistake. Do not invent green/red openness thresholds. A chosen player's nearest defender can be a pass rusher rather than an assigned coverage defender.

### Quarterback approach distance

Identify the passer using the per-play `Pass` role and eligible rushers using `Pass Rush`. Display the current shortest distance from the quarterback to an annotated pass rusher, highlight the corresponding rusher, and optionally show their trails.

Label the metric `Nearest pass rusher` or `Distance to nearest pass rusher`. It is not pressure probability or Amazon Pocket Health: a nearby blocker can change the meaning of the same distance.

For the sack example, show snap-to-sack time. For a passing example, show snap-to-release time. A sack does not have a time-to-throw value.

### Recorded scouting context

The creator can reveal the supplied PFF coverage label and credited hit, hurry or sack information. PFF means Pro Football Focus, the scouting-data provider.

Treat these as retrospective annotations. Use wording such as `Recorded coverage: Cover-2 / Zone` and `Recorded sack credit: Harold Landry`. Do not present them as live pre-snap predictions. Blocking assignments identify the first recorded blocked player, not a continuous matchup for every frame.

Keep the recorded result separate from the animated tracking. A completed-pass result does not mean the supplied clip includes the catch.

## Data contract

The included exporter produces `schemaVersion: 1` JSON. Preserve this contract or introduce one clearly documented adapter. Inspect the actual files rather than inventing differently named keys.

| Location | Meaning and use |
| --- | --- |
| `gameId`, `playId` | Combined identity of a play. A `playId` alone is not globally unique. |
| `units.frameRateHz` | 10 frames per second. |
| `coordinates.attackDirection` | `left` or `right`, in raw dataset coordinates. |
| `coordinates.startLineX` | Line of scrimmage in raw x coordinates. |
| `coordinates.firstDownTargetX` | Direction-aware target, clipped to goal lines. |
| `coordinates.opponentGoalLineX` | 10 for left-going offense, 110 for right-going offense. |
| `recordedPlay` | Original play fields, including down, yardsToGo, quarter, gameClock, passResult, playResult, playDescription and PFF coverage. |
| `potentialNoPlay` | Description contains `No Play`; a flag for review, not a complete official-stat eligibility classifier. |
| `timing` | snapFrame, releaseFrame, sackFrame, lastAvailableFrame, snapToReleaseSeconds and snapToSackSeconds. Unavailable markers and metrics are null. |
| `frames[]` | Ordered frame records. Use frameId, not an assumed zero-based index, as the football frame identity. |
| `frames[].secondsFromSnap` | Negative during available pre-snap frames; zero at snap. |
| `frames[].entities[]` | Players and ball: nflId, name, jersey, team, role, x, y, speed and orientation fields. |
| `entities[].nearestDefender` | On annotated route runners: opposing nflId, name and distanceYards, or null. |
| `entities[].depthFromStartLineYards` | Receiver depth at that frame. This is not air yards. |
| `frames[].qbToNearestRusher` | Passer ID, nearest rusher ID and distanceYards, or null. |
| `frames[].playerCount`, `allDefendersAvailable` | Completeness information for rendering and metric availability. |
| `retrospectiveScouting[]` | Original player-level PFF roles and credits. |

The ball has `team: football` and a null `nflId`. Give it a separate rendering key rather than treating it as a missing player. Player IDs are numbers in the JSON; normalize UI selector values before matching them to IDs.

The CSV role values include `Pass`, `Pass Route`, `Pass Rush`, `Pass Block` and `Coverage`. If reading CSVs directly, match case-insensitively. A player's usual position in `players.csv` is not a substitute for their role on this play.

### Coordinates and units

Raw x covers 0–120 yards, including the end zones. The goal lines are at x=10 and x=110. Field width is approximately 53.3 yards. Respect attack direction; the simplest approach is to preserve raw coordinates and show an attack-direction arrow.

If normalizing left-going plays to move right, transform all players, ball positions, trails and field lines consistently. For a 180-degree rotation use `x' = 120 - x` and `y' = fieldWidth - y`; adjust orientation and movement angles if drawn. Preserve the physical field aspect ratio. Stretching the field independently in x and y makes visually displayed distances misleading.

When deriving the target line from raw data:

`target_x = start_line_x + direction_sign * yardsToGo`

Use `direction_sign = +1` for right and `-1` for left, and cap at the opponent goal line. Handle goal-to-go context appropriately. Do not turn a missing start line into zero.

Tracking speed `s` is yards per second. Convert to mph with `s * 3600 / 1760`. A maximum from the available segment is not necessarily a whole-play maximum.

### Timing and missing frames

Use `(frameId - snapFrame) / 10`. The exported CSV timestamp strings have whole-second precision and must not be used for subsecond timing.

Prefer the annotated `ball_snap`, `pass_forward` and `qb_sack` markers. Automated event markers can disagree with annotated ones. Do not silently substitute a different event or frame. Missing or ambiguous markers should disable dependent jump buttons and leave their timing unavailable.

Stop playback at `lastAvailableFrame`. Do not invent a catch, a tackle, future positions or ball flight. A short `End of available tracking` label can explain the stop. Any visual interpolation must remain between actual adjacent observations; never extrapolate beyond them or change the measured values.

The spacing chart, connecting line, player highlight, trails and displayed value must all correspond to the same frame. Do not imply that a future maximum is the value at the currently selected frame.

## Verified demonstration plays

### Receiver spacing example

Use `gronkowski-play.json`.

- Game `2021090900`, play `3793`; Tampa Bay vs Dallas on 9 September 2021.
- Tampa Bay possession, Q4 10:54, 1st & 10 at its own 37.
- Quarterback: Tom Brady. Selected receiver: Rob Gronkowski, `nflId 35481`.
- Snap frame 6; release frame 39; last available frame 43.
- Snap-to-release: 3.3 seconds. Tracking ends 3.7 seconds after snap.
- Raw start line x=47; first-down target x=57; offense moves right.
- Recorded PFF coverage: Cover-2 / Zone.
- At snap, Gronkowski's nearest defender is Tarell Basham at approximately 2.61 yards.
- At 1.0 seconds after snap, Basham is approximately 0.92 yards away.
- At release, the nearest defender is Jourdan Lewis at approximately 8.06 yards.
- Recorded outcome: a 7-yard completion. Target identity for this example was confirmed manually from the play description; there is no general targeted-receiver-ID field.

The story is how measured space changes before the pass. The recorded catch is not animated because this clip does not include it.

### Sack example

Use `wentz-sack.json`.

- Game `2021103106`, play `1231`; Indianapolis vs Tennessee on 31 October 2021.
- Quarterback: Carson Wentz.
- Snap frame 6; sack frame 42; last available frame 47.
- Snap-to-sack: 3.6 seconds; snap-to-release is null.
- Nearest annotated pass rusher is approximately 6.24 yards away at snap and 0.59 yards away at the sack marker. The nearest rusher changes during the play.
- PFF credits Harold Landry with the sack. Recorded result: a 7-yard loss.

The story is the closing space around the quarterback, illustrated by measured positions and the recorded sack credit.

## Acceptance checks

Treat these as completion requirements. Test behavior and data correctness, not just whether the page loads.

1. Both prepared plays load and render 22 players plus the ball in their supplied frames.
2. Gronkowski's release view shows frame 39, 3.3 seconds, Jourdan Lewis and approximately 8.06 yards. Snap and one-second values match the numbers above within display rounding.
3. Wentz's sack view shows frame 42, 3.6 seconds, recorded Harold Landry sack credit and no fabricated time-to-throw value.
4. Down, target line and attack direction are correct. Also validate left-going play `2021090900/137` if fetching additional data: start x=108, target x=98, release after 2.5 seconds. A labelled deterministic test fixture can verify equivalent left-direction logic if only the two packaged plays are available.
5. In two separate browser contexts, private play/player/layer/scrubber edits do not affect the public scene. Publish updates the complete scene together. Public Play/Pause affects the published scene; Hide clears it. A fresh output client gets the current published state.
6. Audience output contains no editing controls, private notes or draft changes, and has no visible content before Publish or after Hide.
7. Playback, chart cursor, trails, nearest-player identity and metric values remain synchronized. Playback ends at the actual last frame and never animates a catch for the Gronkowski fixture.
8. Changing plays clears stale player selections and invalid event/frame references. Missing metrics display as unavailable or are omitted; they never appear as zero, NaN or a plausible invented number.
9. A test copy with an incomplete defense makes nearest-defender distance unavailable rather than recomputing a misleading minimum over the remaining players. A missing release marker disables Jump to release and its time metric. Validate this in preprocessing if consuming already exported JSON.
10. Recorded coverage, pressure credits and result are clearly retrospective. Receiver spacing is not presented as probability, route depth as air yards, or an off-ball receiver crossing the yellow line as a first down.
11. The app runs from the documented setup commands, and the supplied Python exporter remains runnable. Capture screenshots and complete the demonstration flow below.

## Build order

1. Load the two prepared JSON fixtures and draw a correct static field at a selectable frame.
2. Add private playback, scrubbing, snap/release/sack jumps and player selection.
3. Add trails and the nearest-defender display/chart, followed by the quarterback distance layer and recorded context.
4. Add independent published state and the audience output route. Verify it across separate browser contexts.
5. Complete the data checks, handle missing states, refine readability and capture the demo.

Favor finishing this path over adding more plays or inventing a new metric. Make the two prepared stories clear before adding optional features.

## Scope to exclude

- Viewer accounts, viewer controls, voting, chat commands or fan editing.
- Live NFL tracking ingestion, rebroadcast/game-video delivery, camera-anchored overlays or video calibration.
- Catch probability, CPOE, EPA, win probability, YAC, air yards, field-goal probability or fourth-down recommendations.
- Automatic coverage-blame, best-pass or quarterback-error judgments.
- Claims to reproduce Amazon proprietary models, ESPN win rates or PFF player grades.
- Full drives, full-game totals or whole-season rankings from this passing subset.
- Commercial-viability work, billing, production infrastructure and unrelated features.

## Deliverables

- A runnable app with a private controller and an independently functioning audience output URL.
- The two real-play fixtures wired into the app.
- The working Python exporter and a minimal dependency declaration. Do not require all 122 tracking files for the demo.
- Clear setup and run instructions, including the two view URLs.
- One audience screenshot for receiver spacing and one for the sack explanation.
- A 3–5 sentence submission summary explaining what was built, what it reveals and who would use it. Put longer setup and limitations below that summary in the README if needed.
- A short account of which acceptance checks passed and any remaining limitations.

The event requires working Python code, an output such as a visualization/screenshot/demo, and the short README. Its four scored areas are Football Insight, Technical Execution, Communication and Originality, each scored 1–5. Build for a clear football explanation and a reliable demonstration.

## Demonstration sequence

1. Open the controller and audience output side by side. The audience starts empty.
2. Load the Gronkowski play privately, select him, enable trails and separation, and pause at one second after snap.
3. Publish that frame, then play the public replay to release. Explain the widening gap and the change in nearest defender.
4. Prepare the Wentz play privately while the audience retains the previous scene. Publish, play toward the sack marker, and show the elapsed time and recorded sack credit.
5. Hide the output. Briefly state that this is a historical tracking reconstruction and the underlying clips end where the supplied tracking ends.

## Source data and reproducibility

Team repository: https://github.com/owenyanucl/wedobewinningtho

Event repository: https://github.com/ThompsonJamesBliss/nfl-big-data-bowl-regional-event-data

Field documentation: https://github.com/owenyanucl/wedobewinningtho/blob/main/README.md

The actual dataset is 2021 weeks 1–8, although the photographed event slide mentions 2023. Four metadata files were audited in full: 122 games, 8,557 play records, 1,679 players and 188,254 scouting rows. Tracking was deeply checked for two games and 181 plays, not every game in the repository.

In that tracking sample, 170 plays have a pass-release marker and all end 0.3–0.5 seconds later; there is one catch marker and no tackle marker. Scope the UI around the observed pre-release/sack sequence.

There are 489 descriptions containing `No Play`. Do not derive official performance totals by simply counting passResult or PFF flags. The provided demo plays are not flagged as nullified.

To reproduce the prepared files from the repository's data directory:

```text
python build_overlay_data.py --data-dir data --game 2021090900 --play 3793 --out gronkowski-play.json
python build_overlay_data.py --data-dir data --game 2021103106 --play 1231 --out wentz-sack.json
```

The exporter requires Python and pandas. It reads `plays.csv`, `players.csv`, `pffScoutingData.csv` and the relevant `tracking/tracking_GAMEID.csv`. It also accepts the tracking file directly inside the data directory.

If the companion files were not attached, obtain these inputs from the public repository and implement the calculations and JSON fields specified above. Do not replace the verified examples with synthetic game data and present it as real.

## Files in this handoff

| File | Purpose |
| --- | --- |
| `START_HERE.txt` | Short prompt the user can paste into the builder agent. |
| `BUILDER_BRIEF.md` | This implementation brief and acceptance criteria. |
| `gronkowski-play.json` | Prepared receiver-spacing fixture. |
| `wentz-sack.json` | Prepared sack fixture. |
| `build_overlay_data.py` | Reusable Python preprocessing/exporter. |
| `viewer-questions-and-data-plan.html` | Full readable research and feasibility guide. |
| `feature-map.json` | All 45 question mappings for reference. |
| `data-audit.json` | Audit scope, source hashes and checked values. |
| `receiver-spacing.png` | Example graphic derived from the real tracking data. |
