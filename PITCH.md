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
- Put two browser windows side by side. Left: the streamer's controller, `http://localhost:8000/`, which has everything. Right: the viewer page, `http://localhost:8000/viewer.html`, which is what viewers see and what OBS would capture: the game plus only what the controller pushes.
- Backup if the live push misbehaves: `http://localhost:8000/viewer.html#demo=push&play=67&phase=after` renders the pushed Duel card on its own.

## 0:00–0:20 Hook

> "On every pass, rushers race blockers to the quarterback. No broadcast we found keeps a running score of who is winning each one-on-one. A co-streamer who wants that stat has to leave the game for another screen. We built the scoreboard for that battle, and it hands the streamer one line to read out."

- On screen, the line itself: **"Garrett has beaten Hill on 6 of 22 reps tonight; edge rushers averaged 1 in 13 before tonight."**

## 0:20–1:30 Live demo

Game: CLE @ MIN, 2021 Week 4, played back as a simulated live feed and labelled "SIMULATED LIVE · 2021 DATA · CLE @ MIN Wk 4". Each play runs pre-snap, live, then after-play. Tracking data reaches the overlay about 2 seconds after it happens, as a real feed would. The streamer's controller shows each Duel result as soon as the data could know it: when the ball is thrown or the 3-second window closes, plus that latency, even mid-play. The PFF-based results (pressure story, sack, ball-out time) arrive about 2 seconds after the play. Viewers see only what the streamer pushes, Push is disabled during live action, and a pushed card clears at the snap.

The core is steps 1–6 and 9: the private controller, push to stream, the spoiler-safe tally and the broadcast clip. Steps 7, 8 and 8b are optional, if time allows.

1. **Fresh load, controller on the left:** `http://localhost:8000/`. Every pill starts collapsed. One chip offers "SUGGESTED Garrett vs Hill". The viewer window on the right shows only the game.
   > "On the left is the streamer's private desk. On the right is what the viewers see. Nothing pops up on its own. The streamer decides."
2. **During the play:** `http://localhost:8000/#play=67&frame=10&duel=1`. 4th quarter, 0:57. The bar reads "2nd & 10 · Q4 00:57 · MIN ball", "11 · Shotgun · Box 6" and "Blitz 22 of 93".
   > "The ball is live. On the streamer's screen, the Duel pill says Garrett has won 5 of 21 and this rep is pending, because the data can't know the result yet. The viewers' screen shows only the game: Push is off while the ball is live."
3. **After the play:** `http://localhost:8000/#play=67&phase=after&duel=1&pressure=1`. The bar flips to "Ball out 2.5 s" and "4 rushed / 5 blocked". The Duel pill reads Garrett 6, Hill 16, after 22 reps.
   > "Garrett has beaten Hill on 6 of 22 reps tonight; edge rushers averaged 1 in 13 before tonight. That sentence is ready to say on air. Underneath is the context, using only games before tonight: Garrett had won 10 of 67 rusher-plays, 15%, 1.9 times his expected rate. Hill had lost 11 of 105, 1.4 times."
4. **Push to stream.** Click "Push to stream" in the Duel pill. The Duel card appears on the viewer window, and the controller's bar shows "ON AIR: Garrett vs Hill".
   > "Now the viewers see it, between plays, because the streamer chose this story. Click again and it is gone. It also clears itself at the next snap, and `H` pulls it at once."
5. **Pressure story.** From PFF's charting: "#95 Myles Garrett beat the LT", a hit with the ball out at 2.5 s. A story names a blocker only when PFF charged him against that rusher. On a hit or a sack the Pressure button gets a subtle highlight. It never opens itself, and the rings and the line to the quarterback appear only while the Duel pill is open.
   > "The overlay suggests. The streamer chooses."
6. **Spoiler check.** Back in step 2, the tally said 5 of 21 and "pending". Open `http://localhost:8000/#play=75&phase=after&duel=1`, the last play: the tally ends the game at **6 of 29**. (Live alternative: press `→` to play 75, then `Space`; once the data lands, about 2 seconds after the throw or the 3-second mark, it reads 6 of 29.)
   > "Live streams run 26 to 51 seconds behind the action. A stats feed that runs ahead spoils the play. The streamer sees each result as soon as the data lands. The viewers see it only when the streamer pushes it, never during a live play, and the season line uses no game after tonight."
7. **Optional, get out of the way.** Drag the bar to a snap point: top-left, top-centre or top-right. `Solid` swaps the tinted glass for an opaque bar over bright turf. `Tab` hides the bar. `H` hides everything.
   > "One key, and the screen is all football."
8. **Optional, Team pill:** `http://localhost:8000/#play=67&phase=after&team=CLE`. Weeks 1–3 only, a count beside every percentage. ▲ and ▼ mark above or below the league average, not good or bad.
   > "Before tonight, Cleveland blitzed on 22 of 93 passing plays, about the league rate. But they sacked the quarterback on 12 of 93, 13%, against 6% for the league. Pressure without extra rushers is what a rusher like Garrett buys you."
8b. **Optional, coverage heat map (built in Python, next as an overlay pill):** show `output/heatmap_johnson_2021100305.png`. John Johnson III's position from snap to throw, stacked on the line of scrimmage: weeks 1–3 against tonight's first and second half, one colour scale.
   > "Every play starts somewhere different, so we line them all up on the line of scrimmage and stack them. This is where Johnson played before tonight, and this is tonight. The honest answer is: the same. 19.3 yards deep at the throw over 40 plays, against 18.3 over 87 before, which is normal variation. When a safety starts cheating up or drifting wide, an in-game version would show it, from plays already seen."
9. **Broadcast clip:** `http://localhost:8000/#bg=video&duel=1&pressure=1`. The real broadcast of play 38: 3rd quarter, 11:29, 3rd & 3. It opens before the snap. Let the clip run to Takkarist McKinley's sack of Cousins, then press `N` twice (or "Next phase" twice: live, then after-play) to reveal the after-play result. The story reads "#55 McKinley sack — QB held it 5.1 s, no blocker charged", which matches the clip.
   > "Here is the overlay over real footage. McKinley gets the sack, but our tally does not score his rep as a win, and that is on purpose. The sack came 5.1 seconds after the snap, after our 3-second window. Inside 3 seconds, Garrett had already beaten the Hill and Bradbury double team: 1.9 yards from Cousins at 2.7 seconds. The metric measures beating your blocker fast. A sack at 5.1 seconds says as much about the coverage as the rush."

## 1:30–2:15 The metric and what it shows

> "A rep is one rusher against one blocker on one play: 44,045 of them across 122 games. The rusher wins if tracking puts him within 2 yards of the quarterback inside 3 seconds of the snap."
>
> "Where he lines up matters. Interior linemen start closer, and a collapsing pocket brings them near the quarterback without beating anyone. At 2.5 yards, only about a quarter of interior 'wins' were real pressures: 25.6%. At 2 yards it is 58.7% inside and 67.0% on the edge. So we use 2 yards and judge every player against his alignment: over weeks 1 to 8, edge rushers win 7.7% of blocked rusher-plays, interior linemen 4.3%."
>
> "We checked it against PFF's hand-charted pressures. When tracking says a rusher won, PFF credited him with a hit, hurry or sack 66.8% of the time, 5.7 times the base rate. It catches 38.4% of PFF's pressures, because a hurry from outside 2 yards is not a won rep."
>
> "The leaderboard, over weeks 1 to 8, passes the eye test. Among rushers with at least 150 rusher-plays: Garrett first, at 39 wins in 191, then Javon Hargrave, Yannick Ngakoue, Trey Hendrickson, Maxx Crosby and Brian Burns, with Aaron Donald seventh. Hargrave plays inside. His raw win rate, 15.4%, trails Ngakoue's 16.0%. Judged against the interior, he is second only to Garrett."

- On screen: `output/top_rushers.png` (weeks 1–8, min 150 rusher-plays; bar = reps won, tick = expected for where he lines up).
- Two windows, said plainly: the overlay's season lines use weeks 1–3, before the game. The analysis and the chart use all of weeks 1–8.

## 2:15–2:35 What is new, and who did it first

> "We did not invent the question. ESPN's Pass Rush Win Rate asks whether a rusher beat his block within 2.5 seconds. STRAIN, a Big Data Bowl 2023 entry, measures how fast rushers close on the quarterback. A 2026 Penn preprint ranks blocker–rusher contests head to head. And since September, FAN.live and Creator Sports Network give creators overlays built from official data. What is new here is the delivery: a spoiler-safe, alignment-adjusted head-to-head tally that a commentator can read out, built from public data."

## 2:35–2:55 What's next

> "Next: push every card, a live feed, and the rest of our spec."

1. **Push every card, not just the Duel.** The streamer browses in private and sends only what they pick; the prototype already does this for the Duel card.
2. **Protected areas.** The streamer marks the parts of the screen a card may never cover, such as the ball, the players in the play and the score.
3. **A live feed through Genius Sports**, the NFL's exclusive distributor of real-time stats and Next Gen Stats, synced to the stream's delay.
4. **Next Gen Stats live models in place of PFF charting**, since PFF charts after the game.
5. **The rest of the team's spec:** five fixed pills, per-position cards for the QB, pass rusher, lineman and team defense, and layouts that snap into place on their own.
6. **OBS integration**, so the overlay drops into the software streamers already use.
7. **An in-game form pill:** the coverage heat map (`heatmaps.py`) inside the overlay, built only from plays already shown and compared with the player's own earlier weeks.

## 2:55–3:00 Close

> "Trench Duel keeps score of the battle in the trenches and gives the streamer a line they can say on air."

## Judge questions

**Double teams?** A double-teamed rusher counts once per play in his own numbers, and each blocker on him gets the rep. A win against a double team is charged to both blockers, which is harsh on the helper. It is a known limitation.

**Why 2 yards and 3 seconds?** A quarterback usually needs about 2.5 to 3 seconds to throw, so 3 seconds covers the window where pressure changes the play. At 2.5 yards, only 25.6% of interior "wins" were real pressures. At 2 yards, 67.0% of edge wins and 58.7% of interior wins match a PFF pressure credited to that rusher.

**Only 38% recall. Isn't that low?** It is low on purpose. A commentator reads the number out loud, so a false win costs more than a missed hurry. A hurry from outside 2 yards is real pressure, but it is not a won rep.

**McKinley got the sack on play 38. Why doesn't the tally give him the win?** The sack came 5.1 seconds after the snap, after the 3-second window, and inside that window McKinley never got within 2 yards. Garrett did: he beat the Hill and Bradbury double team and was 1.9 yards from Cousins at 2.7 seconds. The tally measures beating your blocker fast; a late sack depends on the coverage too. PFF charged no blocker for that sack, which is common: 195 of 543 sacks in the data, about 36%, have no blocker charged, so the pressure story has wording for it.

**What do viewers actually see?** Only what the streamer pushes. The controller has everything; the viewer page, which OBS would capture, shows the game plus the pushed card. Push is disabled during live action, and a pushed card clears itself at the snap, so nothing new reaches viewers during a live play.

**Why do results show up about 2 seconds late?** That is data latency: the gap between the play and the tracking data arriving, as with a real feed. It is not a deliberate hold. The streamer's controller shows a Duel result as soon as the data could know it, at the throw or when the 3-second window closes, plus that latency, even mid-play. PFF-based stories arrive about 2 seconds after the play. Viewers stay spoiler-safe because they see only what the streamer pushes, and Push is off while the ball is live.

**Isn't 6 of 29 just one game's noise?** One game is a small sample, so the pill puts the season so far next to it: before tonight, Garrett had won 10 of 67 rusher-plays, 1.9 times his expected rate. Over all of weeks 1–8 it is 39 of 191, 20.4%, 2.7 times, the most over expectation among rushers with at least 150 rusher-plays.

**Does the season line leak future games?** No. The overlay's season line and Team pill use only weeks 1–3, the games before this Week 4 game. The leaderboard and chart use weeks 1–8, and are labelled that way.

**The data only covers weeks 1–8 of 2021, passing plays.** Yes. The Big Data Bowl 2023 set has no running plays, and tracking stops at the throw or sack.

**Why not just use PFF pressures?** PFF charts by hand, after the game, and some of it is judgment. Tracking applies one rule to every player and could run off a live feed. We use PFF pressures as the answer key for the metric, and label the after-play pressure story as PFF-charted. We also use PFF's who-blocked-whom labels to pair rusher and blocker; live, the pairing would have to come from tracking or Next Gen Stats' live models, which we have not built.

**Is this just Pass Rush Win Rate?** Same question, different delivery. Win Rate asks whether a rusher beat his block within 2.5 seconds, from Next Gen Stats. Ours asks whether he got within 2 yards of the quarterback, keeps a per-matchup tally that grows during the game, judges it against alignment, never spoils, and comes as a sentence.

## Every number, and where it comes from

| Number | Source |
|---|---|
| 44,045 blocker–rusher reps, 122 games | `output/reps.csv` row count |
| 2 yards, 3 seconds | `output/validation.txt` definition line |
| Interior at 2.5 yd 25.6%; at 2.0 yd edge 67.0%, interior 58.7% | `output/validation.txt` by-alignment block |
| Edge 7.7%, interior 4.3% of blocked rusher-plays (weeks 1–8) | `overlay/data/demo_game.js` `league.byAlign` (0.0767, 0.0432). `output/validation.txt` counts every rusher-play instead and gives 7.7% and 4.4%; this pitch uses `league.byAlign` throughout |
| "1 in 13" | edge 7.7% (weeks 1–8) or 7.9% (weeks 1–3, `league.toDate.byAlign`); both round to 1 in 13 |
| 66.8%, 5.7×, 38.4% (rusher-plays) | `output/validation.txt` |
| 5 of 21 pending at frame 10; 6 of 22 after play 67; 6 of 29 after play 75 | `output/reps.csv` (game 2021100305; play 67 is playId 4020, rep 22 of 29) |
| 2nd & 10 · Q4 00:57 · MIN ball; 11 · Shotgun · Box 6; ball out 2.5 s; 4 rushed / 5 blocked | `overlay/data/demo_game.js` play 67 |
| "#95 Myles Garrett beat the LT", hit, ball out at 2.5 s | `overlay/data/demo_game.js` play 67 `pressureEvents` (blocker 43640, LT, 2.5 s) |
| Garrett before tonight 10 of 67, 15%, 1.9×; Hill 11 of 105, 10%, 1.4× | `overlay/data/demo_game.js` `seasonToDate` (expected 7.94%, 7.60%) |
| Garrett weeks 1–8 39 of 191, 20.4%, 2.7× | `output/season.csv` |
| Leaderboard order, min 150 rusher-plays; Hargrave 15.4%, Ngakoue 16.0% | `output/season.csv`, `output/top_rushers.png` |
| Cleveland blitz 22 of 93, 3rd & long 7 of 24, sacks 12 of 93 (13%) | `overlay/data/demo_game.js` `teamsToDate.CLE` |
| League blitz 797 of 3,383; sacks 219 of 3,383 (6%) | `overlay/data/demo_game.js` `league.teamToDate` |
| Play 38: Q3 11:29, 3rd & 3, sack at 5.1 s, no blocker charged, #55 | `overlay/data/demo_game.js` playId 2349 |
| Garrett 1.9 yd at 2.7 s vs Hill and Bradbury | `output/reps.csv` (playId 2349: 1.86 yd, 2.7 s, blockers 43640 and 47801) |
| Johnson III: 19.3 yd at the throw over 40 plays tonight; 18.3 yd over 87 plays in weeks 1–3 | `output/heatmap_johnson_2021100305.txt` (19.29 yd over 40; 18.32 yd over 87) |
| 195 of 543 sacks with no blocker charged | `data/plays.csv` sacks joined to `data/pffScoutingData.csv` `pff_sackAllowed` |
| 26–51 s stream delay (Super Bowl LIX) | brief section 13 |
| ESPN Win Rate 2.5 s; STRAIN; Penn 2026; FAN.live + CSN | brief section 13 |
| QB needs about 2.5–3 s to throw | brief section 4 |
