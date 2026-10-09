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

## 0:00–0:20 Hook

> "On every pass, rushers race blockers to the quarterback. Nobody on air keeps score of who is winning each one-on-one. A co-streamer who wants that stat has to leave the game for another screen. We built the scoreboard for that battle, and it hands the streamer one line to read out."

- On screen, the line itself: **"Garrett has beaten Hill on 6 of 22 reps tonight; edge rushers average 1 in 14."**

## 0:20–1:30 Live demo

Game: CLE @ MIN, 2021 Week 4, replayed from NFL tracking data and labelled as a replay.

<!-- PENDING:collapsed -->
1. **Fresh load.** Every pill starts collapsed. One chip offers "Suggested: Garrett vs Hill". "Nothing pops up on its own. The streamer decides."
2. **Open the moment:** `overlay/index.html#play=67&frame=33&duel=1&pressure=1`. 4th quarter, 0:57, 2nd & 10, play 67 of 75. The field label shows Garrett 0.3 yards from Kirk Cousins.
   > "Late in the fourth, Myles Garrett is on top of Cousins. The Duel pill keeps score: Garrett 6, Hill 16, after 22 reps. One dot per rep, red for a Garrett win."
3. **Read the line.**
   > "Garrett has beaten Hill on 6 of 22 reps tonight; edge rushers average 1 in 14. That sentence is ready to say on air. Underneath is the context: over weeks 1 to 8, Garrett wins 19% of his reps, 2.7 times what an edge rusher is expected to win."
4. **Pressure pill.** Closest rusher this play: Garrett, pressure at 2.4 seconds, with a bar per rusher.
<!-- PENDING:collapsed -->
5. **Rings on the field.** The rings and the line to the quarterback appear only while the Duel pill is open, so the field is clean otherwise.
6. **Spoiler check.** Press `←` to step back a play.
   > "Garrett's sixth win disappears. The tally only counts plays the viewer has already seen."
   - Press `→` through to the last play. The tally ends the game at **6 of 29**.
   > "Live streams run 26 to 51 seconds behind the action. A stats feed that runs ahead spoils the play. This one can't."
7. **Get out of the way.** Drag the bar by its handle to another spot. `Tab` hides the bar. `H` hides everything.
   > "One key, and the screen is all football."
<!-- PENDING:team -->
8. **Team pill.** Click a team chip: blitz rate, 3rd-down blitz rate, man vs zone, top coverages and pressure rate against the league average, for the pre-snap talking point.
<!-- PENDING:video -->
9. **Video mode.** Switch the background from the tracking replay to a public highlight clip, to show the overlay where it belongs: over the game.

## 1:30–2:15 The metric and what it shows

> "A rep is one rusher against one blocker on one play: 44,045 of them across 122 games. The rusher wins if tracking puts him within 2 yards of the quarterback inside 3 seconds of the snap."
>
> "Where he lines up matters. Interior linemen start closer, and a collapsing pocket brings them near the quarterback without beating anyone. At 2.5 yards, only 22% of interior 'wins' were real pressures. So we use 2 yards and judge every player against his alignment: edge rushers win 7.1% of reps, interior linemen 3.8%."
>
> "We checked it against PFF's hand-charted pressures. When tracking says the rusher won, PFF charted a hit, hurry or sack 67% of the time, 5.7 times the base rate. It catches 38% of PFF's pressures, because a hurry from outside 2 yards is not a won rep."
>
> "The leaderboard passes the eye test: Garrett first, then Brandon Williams, Javon Hargrave, Yannick Ngakoue, Trey Hendrickson, Von Miller, Maxx Crosby and Brian Burns, with Aaron Donald in the top 15. Williams and Hargrave play inside. On raw win rate, Ngakoue and Hendrickson rank above them; judged against the interior, they climb to second and third."

- On screen: `output/top_rushers.png` (min 150 reps; bar = reps won, tick = expected for where he lines up).

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

**Double teams?** When two blockers share a rusher, a win counts against both. That is harsh on the helper, and it is a known limitation.

**Why 2 yards and 3 seconds?** A quarterback usually needs about 2.5 to 3 seconds to throw, so 3 seconds covers the window where pressure changes the play. At 2.5 yards, only 22% of interior "wins" were real pressures; at 2 yards, 67% of all wins match a PFF pressure.

**Only 38% recall. Isn't that low?** It is low on purpose. A commentator reads the number out loud, so a false win costs more than a missed hurry. A hurry from outside 2 yards is real pressure, but it is not a won rep.

**Isn't 6 of 29 just one game's noise?** One game is a small sample, so the pill puts the season next to it: Garrett wins 19% of 231 reps, 2.7 times the edge expectation. Hill loses 12% of 163, 1.7 times what is expected where he lines up.

**The data only covers weeks 1–8 of 2021, passing plays.** Yes. The Big Data Bowl 2023 set has no running plays, and tracking stops at the throw or sack. Season context in the demo means those 8 weeks.

**Why not just use PFF pressures?** PFF charts by hand, after the game, and some of it is judgment. Tracking applies one rule to every player and could run off a live feed. We use PFF pressures as the answer key, not as the input. We do use PFF's who-blocked-whom labels to pair rusher and blocker; live, the pairing would have to come from tracking, which we have not built.

**Is this just Pass Rush Win Rate?** Same question, different delivery. Win Rate asks whether a rusher beat his block within 2.5 seconds, from Next Gen Stats. Ours asks whether he got within 2 yards of the quarterback, keeps a per-matchup tally that grows during the game, judges it against alignment, never spoils, and comes as a sentence.

**Why a tracking replay and not video?** Every dot on the field is real NFL tracking data at 10 frames per second, so the overlay and the numbers come from the same source. The product is meant to sit over live video.

## Every number, and where it comes from

| Number | Source |
|---|---|
| 44,045 reps, 122 games | `README.md` (reps.csv row count) |
| 2 yards, 3 seconds | `output/validation.txt` (definition line), `trench_duels.py` |
| 22% of interior "wins" real at 2.5 yards | `README.md`, brief section 14 |
| Edge 7.1%, interior 3.8% | `README.md`; `output/reps.csv` by alignment (7.08%, 3.83%) |
| 67% precision, 5.7× base rate, 38% recall | `output/validation.txt` (66.8%, 5.7x, 38.4%) |
| Garrett 6 of 22 at play 67; 6 of 29 at the end; "1 in 14" | `README.md`, brief section 14, `output/reps.csv` |
| 4th quarter, 0:57, 2nd & 10, play 67 of 75, 0.3 yd | `output/overlay_screenshot.png`, brief section 14 |
| Pressure at 2.4 s | `output/overlay_screenshot.png`, `output/reps.csv` (play 4020) |
| Garrett 19% of 231, 2.7×; Hill 12% of 163, 1.7× | `output/season.csv`, `output/overlay_screenshot.png` |
| Leaderboard order, min 150 reps | `output/top_rushers.png`, brief section 14 |
| 26–51 s stream delay (Super Bowl LIX) | brief section 13 |
| ESPN Win Rate 2.5 s; STRAIN; Penn 2026; FAN.live + CSN | brief section 13 |
| QB needs about 2.5–3 s to throw | brief section 4 |
| 10 frames per second | brief sections 6 and 14 |
