# Phone-readable UI: what's done and what's next

Goal: overlay text readable for audiences watching on a phone; fewer words, plain phrases; each pill opens on a glanceable first page (players, score, one line), with later pages for detail.

## Done on this branch
- `overlay/style.css` rewritten as one layer:
  - **Viewer card** sized in a stream unit (`--u: min(1vw, 1.7778vh)`): names ≈2.2u, score ≈5.6u, sentence ≈2.6u; rep dots, source line and rep count hidden on the viewer.
  - Scorebug and SIMULATED LIVE label scale with the same unit.
  - Bigger, calmer bar (16 px, one weight); low-value items drop as the window narrows.
  - Styles for paged pills (`.pager`, `.page`, `.pager-dots`, `.pd`, `.pd.on`) ready for the markup below.

## Next: app.js
- **Pager:** keep a current page per pill and re-apply it with an instant `scrollTo` after each re-render; reset to page 1 when the pill opens or its subject changes (new pair, new play/result, new team). Dots follow the pager's scroll position (`data-pg`, click to jump); `[` / `]` page the last-used pill; no dots for one-page pills. Add "[ ] pages" to the keyboard hint.
- **Duel**
  - Page 1: "Garrett has beaten Hill 6 times in 22 snaps tonight." Variants: once / their only snap / "Hill has held Garrett on all N snaps tonight" / "have not met yet tonight". This snap: Garrett won / Hill held / waiting for the data / not played yet / not facing each other. Rename "Clear ✕" to "Clear pick".
  - Page 2: "Garrett wins 15% of his snaps (10 of 67) — about 2× a normal edge rusher" (say "about N×" only within 0.1 of a whole number ≥2, else the exact figure); "Hill loses 10% of his snaps (11 of 105) — 1.4× normal for the rushers he faced".
  - Page 3: every snap with a legend (orange = rusher won, blue = blocker held).
  - Page 4: "A win = the rusher gets within 2 yards of the QB within 3 seconds of the snap."
- **Pressure**
  - Page 1: "#95 Garrett beat the left tackle — hit the QB as he threw at 2.5 s"; no blocker named: "#55 McKinley sacked the QB after 5.1 s — no blocker was blamed".
  - Map LT, LG, C, RG, RT, TE-oL, HB, HB-L, HB-R, LWR to words.
  - Page 2: the closest-rusher bars. Page 3: "Charted by PFF after the game".
- **Team**
  - Page 1: one plain sentence + two big-number tiles (`.tb`, `.tb-v`, `.tb-l`, `.tb-c`), e.g. "Cleveland sacks the QB on 13% of pass plays (12 of 93) — league 6%". Say "pass plays", not "throws".
  - Page 2: the full grid. Page 3: coverages.
- **Viewer card:** matchup, big score, the one page-1 sentence only.
- **Slots:** "2nd & 10 · 0:57 Q4", "Shotgun · 6 in the box", "Blitzes 24% (22/93)"; after the play "Throw in 2.5 s", "4 rushers vs 5 blockers" (usual time to throw in the tooltip only).
- New classes for the CSS: `.page-t`, `.legend`, `.pill-x`.
- Known issue to tune: at the 1.4× zoom the bigger viewer card can cover the line of scrimmage when it sits in the lower-left; consider moving the card to whichever lower corner is away from the ball.
