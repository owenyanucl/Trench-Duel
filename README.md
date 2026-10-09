# Trench Duel: a co-streamer overlay for the battle in the trenches

**Trench Duel** turns NFL player-tracking data into a running scorecard of every pass rusher vs offensive lineman matchup: a rusher wins the rep when he gets within 2 yards of the quarterback inside 3 seconds of the snap, judged against the rate expected for where he lines up. It shows how lopsided single matchups get: in Week 4 of 2021, Myles Garrett beat Rashod Hill on 6 of 29 reps, about 2.7 times what an edge rusher usually manages, and over weeks 1–8 Garrett leads the league (min 150 rusher-plays) in reps won over expectation. It is built for co-streamers and broadcasters, who get a ready-to-read line ("Garrett has beaten Hill on 6 of 29 reps tonight") in a movable overlay they control and can clear with one key. The tally counts a play only once its scoring window has closed, so it never shows a result viewers haven't seen. A scout or coach can use the same rep table to find which blocker an opponent's best rusher should be matched against.

![The overlay: Garrett beats Hill late in the 4th quarter](output/overlay_screenshot.png)

![Top rushers](output/top_rushers.png)

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install pandas numpy matplotlib
.venv/bin/python trench_duels.py            # about 30 s; writes output/ and overlay/data/demo_game.js
open overlay/index.html                     # the co-streamer overlay over a replay of CLE @ MIN
python3 -m http.server 8000 -d overlay      # Broadcast mode (YouTube clip) needs http: open http://localhost:8000
```

In the overlay, `Tab` shows or hides the bar, `H` or `Esc` hides everything, and `←` `→` `space` step through plays. Drag the bar by its handle. Pills start collapsed; the "Suggested" chip opens the game's most-met matchup. Opening `http://localhost:8000/#play=67&frame=33&duel=1&pressure=1` pauses on the moment in the screenshot with the Duel and Pressure pills open.

## What is in the box

| File | What it is |
|---|---|
| `trench_duels.py` | The pipeline: builds every rep from PFF's who-blocked-whom labels and the tracking data, validates it and writes the outputs |
| `output/reps.csv` | 44,045 blocker–rusher reps across 122 games: blocker, rusher, closest distance to the QB, seconds to pressure, win, expected win |
| `output/season.csv` | Per-player totals with wins over expected; a rusher counts once per play (33,107 rusher-plays) |
| `output/teams.csv` | Per-team blitz rate, 3rd-down blitz rate, man coverage rate, top coverages, and pressure and sack rates for and against |
| `output/validation.txt` | Agreement with PFF's hand-charted pressures, overall and by alignment and threshold |
| `output/top_rushers.png` | Top rushers over expectation (min 150 rusher-plays) |
| `output/overlay_screenshot.png` | The overlay at play 67, Garrett vs Hill |
| `overlay/` | The overlay: a replay drawn from tracking or a Broadcast clip of one play, with the draggable top bar, a suggested-matchup chip, Duel, Pressure and Team pills, and hide-all |

## How far to trust it

- **Validation:** when tracking says a rusher won, PFF credited a hit, hurry or sack to him 67% of the time, 5.7× the base rate (unit: rusher-plays). The tracking rule catches 38% of PFF's pressures, because pressure that never gets within 2 yards (a hurry from outside) is not a won rep.
- **Alignment matters.** Interior linemen start closer to the quarterback, and a collapsing pocket can bring them within 2.5 yards without beating anyone. At 2.5 yards only 25.6% of interior "wins" were PFF pressures, about a quarter; at 2 yards it is 58.7% inside and 67.0% on the edge. So the threshold is 2 yards and every player is judged against the average for his alignment (edge 7.7% of rusher-plays, interior 4.3%).
- **Double teams:** a double-teamed rusher counts once per play; each blocker on him gets the rep.
- **Data:** the Big Data Bowl 2023 set covers 2021 weeks 1–8, passing plays only, and tracking stops at the throw or sack. The overlay replays a recorded game and is labelled as a replay; a live version needs the NFL's licensed real-time feed.
- **Prior work:** ESPN's Pass Rush Win Rate asks the same question with Next Gen Stats (did the rusher beat his block within 2.5 s), STRAIN (Big Data Bowl 2023) measures how fast rushers close on the quarterback, and a 2026 Penn preprint ranks blocker–rusher contests head to head. Creator overlays exist too: since 15 September 2026, FAN.live and Creator Sports Network give creators live NFL renders with overlays and player info built from official data. Neither the overlay idea nor the stat is new. Trench Duel's contribution is the delivery: a spoiler-safe, alignment-adjusted head-to-head tally a commentator can read out, built from public data.

## What's next

- **A streamer-private control panel that pushes chosen cards to the stream.** The streamer browses in private and sends only what they pick. It also keeps stats from running ahead of the video: at Super Bowl LIX, streams ran 26 to 51 seconds behind the live action.
- **Protected areas:** the streamer marks the parts of the screen a card may never cover, such as the ball, the players in the play and the score.
- **A live feed from Genius Sports**, the NFL's exclusive distributor of real-time stats and Next Gen Stats, synced to the stream's delay.
- **OBS integration**, so the overlay drops into the software streamers already use.
