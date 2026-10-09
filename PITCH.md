# Trench Duel: the 3-minute pitch

| Time | Part | Judging criterion |
|---|---|---|
| 0:00–0:20 | Hook | Communication |
| 0:20–1:30 | Live demo | Technical Execution, Communication |
| 1:30–2:15 | The metric and what it shows | Football Insight |
| 2:15–2:35 | What is new, and who did it first | Originality |
| 2:35–2:55 | What's next | Originality, Communication |
| 2:55–3:00 | Close | |

Quoted lines are spoken. Bullets are what the presenter does on screen.

## Before you start

- In the repository, run `python3 -m http.server 8000 -d overlay` and leave it running. Broadcast mode needs http, so every demo URL below starts with `http://localhost:8000/`.
- Open each demo URL in a fresh tab, or reload after pasting it, so the page lands on exactly that moment.
- Keep the browser window at 1280×720 or larger. At that size no pill sits over the field or the video.

## 0:00–0:20 Hook

> "On every pass, rushers race blockers to the quarterback. No broadcast we found keeps a running score of who is winning each one-on-one. A co-streamer who wants that stat has to leave the game for another screen. We built the scoreboard for that battle, and it hands the streamer one line to read out."

- On screen, the line itself: **"Garrett has beaten Hill on 6 of 22 reps tonight; edge rushers average 1 in 13."**

## 0:20–1:30 Live demo

Game: CLE @ MIN, 2021 Week 4, replayed from NFL tracking data and labelled as a replay.

1. **Fresh load:** `http://localhost:8000/`. Every pill starts collapsed. One chip offers "Suggested: Garrett vs Hill".
   > "Nothing pops up on its own. The streamer decides."
2. **Open the moment:** `http://localhost:8000/#play=67&frame=33&duel=1&pressure=1`. 4th quarter, 0:57, 2nd & 10, play 67 of 75. The field label shows Garrett 0.3 yards from Kirk Cousins.
   > "Late in the fourth, Myles Garrett is on top of Cousins. The Duel pill keeps score: Garrett 6, Hill 16, after 22 reps. One dot per rep."
3. **Read the line.**
   > "Garrett has beaten Hill on 6 of 22 reps tonight; edge rushers average 1 in 13. That sentence is ready to say on air. Underneath is the context: over weeks 1 to 8, Garrett wins 20.4% of his rusher-plays, 2.7 times what an edge rusher is expected to win."
4. **Pressure pill.** The closest approach inside the 3-second window: Garrett, pressure at 2.4 seconds, with a bar per rusher.
5. **Rings on the field.** The rings and the line to the quarterback appear only while the Duel pill is open, so the field is clean otherwise.
6. **Spoiler check.** Press `←` to step back a play.
   > "Garrett's sixth win disappears. A play only counts once its scoring window has closed: 3 seconds after the snap, or the throw if that comes first. Until then the pill says 'in progress'."
   - Press `→` through to the last play. The tally ends the game at **6 of 29**.
   > "Live streams run 26 to 51 seconds behind the action. A stats feed that runs ahead spoils the play. This tally never shows a result before the viewer has seen it."
7. **Get out of the way.** Drag the bar by its handle to another spot. `Tab` hides the bar. `H` hides everything.
   > "One key, and the screen is all football."
8. **Team pill:** `http://localhost:8000/#play=67&frame=33&team=CLE`. Blitz rate, 3rd-down blitz rate, man vs zone, top coverages and pressure rate against the league. The pill's own talking point picks the biggest gap from league ("Cleveland sacks the QB on 8% of dropbacks, league average 6%"); then point at the blitz and pressure rows:
   > "Cleveland blitzes less than the league, 22% of dropbacks against 25%, but pressures the quarterback on 43%. Pressure without the blitz is what a rusher like Garrett buys you."
9. **Broadcast clip:** `http://localhost:8000/#play=38&bg=video&duel=1&pressure=1`. The real broadcast of play 38: 3rd quarter, 11:29, 3rd & 3, Takkarist McKinley sacks Cousins.
   > "Here is the overlay over real footage. McKinley gets the sack, but our tally does not score his rep as a win, and that is on purpose. The sack came 5.1 seconds after the snap, after our 3-second window. Inside 3 seconds, Garrett had already beaten the Hill and Bradbury double team: 1.9 yards from Cousins at 2.7 seconds. The metric measures beating your blocker fast. A sack at 5.1 seconds says as much about the coverage as the rush."

## 1:30–2:15 The metric and what it shows

> "A rep is one rusher against one blocker on one play: 44,045 of them across 122 games. The rusher wins if tracking puts him within 2 yards of the quarterback inside 3 seconds of the snap."
>
> "Where he lines up matters. Interior linemen start closer, and a collapsing pocket brings them near the quarterback without beating anyone. At 2.5 yards, only about a quarter of interior 'wins' were real pressures: 25.6%. At 2 yards it is 58.7% inside and 67.0% on the edge. So we use 2 yards and judge every player against his alignment: edge rushers win 7.7% of rusher-plays, interior linemen 4.3%."
>
> "We checked it against PFF's hand-charted pressures. When tracking says a rusher won, PFF credited him with a hit, hurry or sack 66.8% of the time, 5.7 times the base rate. It catches 38.4% of PFF's pressures, because a hurry from outside 2 yards is not a won rep."
>
> "The leaderboard passes the eye test. Among rushers with at least 150 rusher-plays: Garrett first, then Javon Hargrave, Yannick Ngakoue, Trey Hendrickson, Maxx Crosby and Brian Burns, with Aaron Donald seventh. Hargrave plays inside. His raw win rate, 15.4%, trails Ngakoue's 16.0%. Judged against the interior, he is second only to Garrett."

- On screen: `output/top_rushers.png` (min 150 rusher-plays; bar = reps won, tick = expected for where he lines up).

## 2:15–2:35 What is new, and who did it first

> "We did not invent the question. ESPN's Pass Rush Win Rate asks whether a rusher beat his block within 2.5 seconds. STRAIN, a Big Data Bowl 2023 entry, measures how fast rushers close on the quarterback. A 2026 Penn preprint ranks blocker–rusher contests head to head. And since September, FAN.live and Creator Sports Network give creators overlays built from official data. What is new here is the delivery: a spoiler-safe, alignment-adjusted head-to-head tally that a commentator can read out, built from public data."

## 2:35–2:55 What's next

> "Four steps to a live product."

1. **A streamer-private control panel that pushes chosen cards to the stream.** The streamer browses in private and sends only what they pick. Viewers never see a stat before they see the play.
2. **Protected areas.** The streamer marks the parts of the screen a card may never cover, such as the ball, the players in the play and the score.
3. **A live feed through Genius Sports**, the NFL's exclusive distributor of real-time stats and Next Gen Stats, synced to the stream's delay.
4. **OBS integration**, so the overlay drops into the software streamers already use.

## 2:55–3:00 Close

> "Trench Duel keeps score of the battle in the trenches and gives the streamer a line they can say on air."

## Judge questions

**Double teams?** A double-teamed rusher counts once per play in his own numbers, and each blocker on him gets the rep. A win against a double team is charged to both blockers, which is harsh on the helper. It is a known limitation.

**Why 2 yards and 3 seconds?** A quarterback usually needs about 2.5 to 3 seconds to throw, so 3 seconds covers the window where pressure changes the play. At 2.5 yards, only 25.6% of interior "wins" were real pressures. At 2 yards, 67.0% of edge wins and 58.7% of interior wins match a PFF pressure credited to that rusher.

**Only 38% recall. Isn't that low?** It is low on purpose. A commentator reads the number out loud, so a false win costs more than a missed hurry. A hurry from outside 2 yards is real pressure, but it is not a won rep.

**McKinley got the sack on play 38. Why doesn't the tally give him the win?** The sack came 5.1 seconds after the snap, after the 3-second window, and inside that window McKinley never got within 2 yards. Garrett did: he beat the Hill and Bradbury double team and was 1.9 yards from Cousins at 2.7 seconds. The tally measures beating your blocker fast; a late sack depends on the coverage too.

**Isn't 6 of 29 just one game's noise?** One game is a small sample, so the pill puts the season next to it. Garrett wins 39 of 191 rusher-plays, 20.4%, 2.7 times the edge expectation. Hill loses 19 of 163 reps, 11.7%, 1.6 times what is expected for the rushers he faced.

**The season line says weeks 1–8 on a Week 4 game. Isn't that a spoiler?** The tonight tally is spoiler-safe. The season line is the season-to-date sample this dataset has, weeks 1–8, so for a Week 4 game it includes later weeks. A live version would use only games played before tonight.

**The data only covers weeks 1–8 of 2021, passing plays.** Yes. The Big Data Bowl 2023 set has no running plays, and tracking stops at the throw or sack. Season context in the demo means those 8 weeks.

**Why not just use PFF pressures?** PFF charts by hand, after the game, and some of it is judgment. Tracking applies one rule to every player and could run off a live feed. We use PFF pressures as the answer key, not as the input. We do use PFF's who-blocked-whom labels to pair rusher and blocker; live, the pairing would have to come from tracking, which we have not built.

**Is this just Pass Rush Win Rate?** Same question, different delivery. Win Rate asks whether a rusher beat his block within 2.5 seconds, from Next Gen Stats. Ours asks whether he got within 2 yards of the quarterback, keeps a per-matchup tally that grows during the game, judges it against alignment, never spoils, and comes as a sentence.

## Every number, and where it comes from

| Number | Source |
|---|---|
| 44,045 blocker–rusher reps, 122 games | `README.md`; `output/reps.csv` row count |
| 33,107 rusher-plays | `output/season.csv` (sum of rusher reps) |
| 2 yards, 3 seconds | `output/validation.txt` definition line |
| Interior at 2.5 yd 25.6%; at 2.0 yd edge 67.0%, interior 58.7% | `output/validation.txt` by-alignment block |
| Edge 7.7% ("1 in 13"), interior 4.3% | `overlay/data/demo_game.js` `league.byAlign` (0.0767, 0.0432) |
| 66.8%, 5.7×, 38.4% (rusher-plays) | `output/validation.txt` |
| Garrett 6 of 22 at play 67; 6 of 29 at game end | `output/reps.csv` (game 2021100305; play 67 is playId 4020, rep 22 of 29) |
| Play 67 counts at frame 33 | `overlay/data/demo_game.js` (snap frame 5, end frame 30; window closes at frame 30) |
| Q4, 0:57, 2nd & 10, play 67 of 75 | `overlay/data/demo_game.js` |
| 0.3 yd to Cousins | `output/overlay_screenshot.png` |
| Pressure at 2.4 s | `output/reps.csv` (playId 4020) |
| Garrett 39 of 191, 20.4%, 2.7× | `output/season.csv` (expected 7.65%) |
| Hill 19 of 163, 11.7%, 1.6× | `output/season.csv` (expected 7.36%) |
| Leaderboard order, min 150 rusher-plays; Hargrave 15.4%, Ngakoue 16.0% | `output/season.csv`, `output/top_rushers.png` |
| Cleveland blitz 22% vs league 25%, pressure 43% | `output/teams.csv` (0.2154, 0.4346); `overlay/data/demo_game.js` `league.team.blitzRate` 0.2462 |
| Play 38: Q3 11:29, 3rd & 3, sack at 5.1 s | `overlay/data/demo_game.js` (playId 2349; snap frame 5, end frame 56) |
| Garrett 1.9 yd at 2.7 s vs Hill and Bradbury | `output/reps.csv` (playId 2349: 1.86 yd, 2.7 s, blockers 43640 and 47801) |
| 26–51 s stream delay (Super Bowl LIX) | brief section 13 |
| ESPN Win Rate 2.5 s; STRAIN; Penn 2026; FAN.live + CSN | brief section 13 |
| QB needs about 2.5–3 s to throw | brief section 4 |
