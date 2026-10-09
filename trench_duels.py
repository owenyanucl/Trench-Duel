"""Trench Duel: who is winning each pass rusher vs blocker battle, rep by rep.

A rep is one play on which PFF charted an offensive player blocking a pass rusher;
a double-teamed rusher has two reps on that play but one rusher-play.
The rusher wins the rep when tracking puts him within THRESHOLD_YDS of the
quarterback inside WINDOW_SEC of the snap (cut short if the ball is thrown first).
Interior linemen start closer to the quarterback than edge rushers, so every rep
also carries the win rate expected for where the rusher lined up, and players are
compared on wins over that expectation.

Outputs:
  output/reps.csv              every rep in weeks 1-8
  output/season.csv            per-player totals: rusher-plays for rushers, reps for blockers
  output/validation.txt        how the tracking definition agrees with PFF pressures
  output/teams.csv             per-team blitz, coverage and pressure rates on defense, pressure allowed on offense
  output/*.png                 charts
  overlay/data/demo_game.js    one game's replay and duels for the co-streamer overlay, with to-date context from earlier weeks

Run: python trench_duels.py [--game GAMEID]
"""

import argparse
import glob
import json
import os
import re

import numpy as np
import pandas as pd

DATA = os.path.join(os.path.dirname(__file__), "data")
OUT = os.path.join(os.path.dirname(__file__), "output")
OVERLAY = os.path.join(os.path.dirname(__file__), "overlay", "data")

FPS = 10
WINDOW_SEC = 3.0
THRESHOLD_YDS = 2.0
SNAP_EVENTS = {"ball_snap", "autoevent_ballsnap"}
THROW_EVENTS = {"pass_forward", "autoevent_passforward"}
SACK_EVENTS = {"qb_sack", "qb_strip_sack"}
END_EVENTS = THROW_EVENTS | SACK_EVENTS | {"run", "pass_shovel"}
INTERIOR = {"NT", "NLT", "NRT", "DLT", "DRT"}
EDGE = {"LE", "RE", "LEO", "REO", "LOLB", "ROLB"}
DEFAULT_GAME = 2021100305  # Week 4, CLE @ MIN: Myles Garrett vs Rashod Hill
FORMATIONS = {"SHOTGUN": "Shotgun", "EMPTY": "Empty", "SINGLEBACK": "Singleback", "I_FORM": "I-form", "PISTOL": "Pistol",
              "JUMBO": "Jumbo", "WILDCAT": "Wildcat"}
PRESSURE_TYPES = [("sack", "pff_sack", "pff_sackAllowed"), ("hit", "pff_hit", "pff_hitAllowed"),
                  ("hurry", "pff_hurry", "pff_hurryAllowed")]


def load_tables():
    plays = pd.read_csv(os.path.join(DATA, "plays.csv"))
    players = pd.read_csv(os.path.join(DATA, "players.csv"))
    games = pd.read_csv(os.path.join(DATA, "games.csv"))
    pff = pd.read_csv(os.path.join(DATA, "pffScoutingData.csv"))
    return plays, players, games, pff


def play_windows(track):
    """Snap frame and the frame the rush window closes, per play."""
    ev = track.loc[track["event"].isin(SNAP_EVENTS | END_EVENTS), ["playId", "frameId", "event"]].drop_duplicates()
    snap = ev[ev["event"].isin(SNAP_EVENTS)].groupby("playId")["frameId"].min().rename("snap")
    last = track.groupby("playId")["frameId"].max().rename("last")
    w = pd.concat([snap, last], axis=1).dropna(subset=["snap"])
    ends = ev[ev["event"].isin(END_EVENTS)].merge(w["snap"], left_on="playId", right_index=True)
    ends = ends[ends["frameId"] > ends["snap"]].groupby("playId")["frameId"].min().rename("end_event")
    w = w.join(ends)
    w["end"] = w["end_event"].fillna(w["last"])
    w["close"] = np.minimum(w["end"], w["snap"] + WINDOW_SEC * FPS)
    return w.astype({"snap": int, "end": int, "close": int})


def play_timing(track, windows):
    """Seconds from the snap to the first forward pass and to the sack, per play."""
    ev = track.loc[track["event"].isin(THROW_EVENTS | SACK_EVENTS), ["playId", "frameId", "event"]].drop_duplicates()
    ev = ev.merge(windows["snap"], left_on="playId", right_index=True)
    ev = ev[ev["frameId"] > ev["snap"]]
    out = pd.DataFrame(index=windows.index)
    for name, events in (("timeToThrow", THROW_EVENTS), ("timeToSack", SACK_EVENTS)):
        e = ev[ev["event"].isin(events)].groupby("playId")
        out[name] = (e["frameId"].min() - e["snap"].first()) / FPS
    return out


def rusher_closest(track, pff_game, windows):
    """For every pass rusher on every play: closest distance to the QB and seconds until within threshold."""
    qb = pff_game.loc[pff_game["pff_role"] == "Pass", ["playId", "nflId"]]
    rushers = pff_game.loc[pff_game["pff_role"] == "Pass Rush", ["playId", "nflId"]]
    qb_xy = track.merge(qb, on=["playId", "nflId"])[["playId", "frameId", "x", "y"]]
    r_xy = track.merge(rushers, on=["playId", "nflId"])[["playId", "nflId", "frameId", "x", "y"]]
    m = r_xy.merge(qb_xy, on=["playId", "frameId"], suffixes=("", "_qb")).merge(windows, left_on="playId", right_index=True)
    m = m[(m["frameId"] >= m["snap"]) & (m["frameId"] <= m["close"])]
    m["dist"] = np.hypot(m["x"] - m["x_qb"], m["y"] - m["y_qb"])
    closest = m.groupby(["playId", "nflId"])["dist"].min().rename("closestYds")
    hit = m[m["dist"] <= THRESHOLD_YDS]
    first = ((hit.groupby(["playId", "nflId"])["frameId"].min() - hit.groupby(["playId", "nflId"])["snap"].first()) / FPS).rename("secToPressure")
    return pd.concat([closest, first], axis=1).reset_index()


def build_reps(plays, pff, games):
    """One row per (play, blocker, rusher) rep across every game, and one row per (play, rusher) rusher-play.

    A double-teamed rusher has one rep per blocker but one rusher-play, so rusher totals and the
    alignment expectation come from rusher-plays and blocker totals from reps."""
    blocks = pff.loc[(pff["pff_role"] == "Pass Block") & pff["pff_nflIdBlockedPlayer"].notna(),
                     ["gameId", "playId", "nflId", "pff_nflIdBlockedPlayer", "pff_blockType"]]
    blocks = blocks.rename(columns={"nflId": "blockerId", "pff_nflIdBlockedPlayer": "rusherId"})
    blocks["rusherId"] = blocks["rusherId"].astype(int)
    rush_rows, timing_rows = [], []
    for path in sorted(glob.glob(os.path.join(DATA, "tracking", "tracking_*.csv"))):
        track = pd.read_csv(path, usecols=["gameId", "playId", "nflId", "frameId", "x", "y", "event"])
        gid = int(track["gameId"].iloc[0])
        windows = play_windows(track)
        rc = rusher_closest(track, pff[pff["gameId"] == gid], windows)
        rc["gameId"] = gid
        rush_rows.append(rc)
        timing_rows.append(play_timing(track, windows).assign(gameId=gid).reset_index())
    timing = pd.concat(timing_rows, ignore_index=True)
    rush = pd.concat(rush_rows, ignore_index=True).rename(columns={"nflId": "rusherId"})
    reps = blocks.merge(rush, on=["gameId", "playId", "rusherId"], how="inner")
    reps["rusherWon"] = reps["closestYds"] <= THRESHOLD_YDS
    pressure = pff.assign(pressure=pff[["pff_hit", "pff_hurry", "pff_sack"]].fillna(0).sum(axis=1) > 0)
    reps = reps.merge(pressure[["gameId", "playId", "nflId", "pressure"]].rename(columns={"nflId": "rusherId", "pressure": "pffPressure"}),
                      on=["gameId", "playId", "rusherId"], how="left")
    reps = reps.merge(games[["gameId", "week"]], on="gameId")
    aligned = pff[["gameId", "playId", "nflId", "pff_positionLinedUp"]].rename(columns={"nflId": "rusherId"})
    reps = reps.merge(aligned, on=["gameId", "playId", "rusherId"], how="left")
    reps["align"] = np.select([reps["pff_positionLinedUp"].isin(INTERIOR), reps["pff_positionLinedUp"].isin(EDGE)],
                              ["interior", "edge"], "other")
    keys = ["gameId", "playId", "rusherId"]
    assert (reps.groupby(keys)[["rusherWon", "closestYds", "align"]].nunique(dropna=False) <= 1).all().all()
    rusher_plays = reps.drop_duplicates(keys).drop(columns=["blockerId", "pff_blockType"]).reset_index(drop=True)
    expected = rusher_plays.groupby("align")["rusherWon"].mean()
    rusher_plays["expected"] = rusher_plays["align"].map(expected)
    reps["expected"] = reps["align"].map(expected)
    return reps, rusher_plays, rush, timing


def validate(rush, pff):
    """Agreement between the tracking definition and PFF's hand-charted pressures, per rusher-play."""
    p = pff.loc[pff["pff_role"] == "Pass Rush", ["gameId", "playId", "nflId", "pff_positionLinedUp", "pff_hit", "pff_hurry", "pff_sack"]]
    p["pffPressure"] = p[["pff_hit", "pff_hurry", "pff_sack"]].fillna(0).sum(axis=1) > 0
    v = rush.merge(p.rename(columns={"nflId": "rusherId"}), on=["gameId", "playId", "rusherId"])
    v["won"] = v["closestYds"] <= THRESHOLD_YDS
    ct = pd.crosstab(v["won"], v["pffPressure"])
    tp = ct.loc[True, True]
    precision = tp / ct.loc[True].sum()
    recall = tp / ct[True].sum()
    base = v["pffPressure"].mean()
    lines = [
        f"Rusher-plays: {len(v)} (every Pass Rush rusher-play with tracking, blocked or unblocked; season.csv counts only rusher-plays against a charted blocker)",
        f"Definition: within {THRESHOLD_YDS} yds of the QB inside {WINDOW_SEC}s of the snap (or before the throw)",
        f"Tracking 'win' rate: {v['won'].mean():.1%}   PFF pressure rate: {base:.1%}",
        f"When tracking says win, PFF charted a pressure {precision:.1%} of the time ({precision / base:.1f}x the base rate)",
        f"Of PFF pressures, tracking flags {recall:.1%}",
        "",
        "Crosstab (rows: tracking win, cols: PFF pressure):",
        ct.to_string(),
        "",
        "By alignment and threshold (same unit, edge and interior alignments only; pressure credited to that rusher):",
    ]
    v["align"] = np.select([v["pff_positionLinedUp"].isin(INTERIOR), v["pff_positionLinedUp"].isin(EDGE)],
                           ["interior", "edge"], "other")
    for align in ("edge", "interior"):
        a = v[v["align"] == align]
        for yds in (2.0, 2.5):
            won = a["closestYds"] <= yds
            lines.append(f"  {align:<8} {yds:.1f} yds  rusher-plays {len(a)}  win rate {won.mean():.1%}  "
                         f"precision {a.loc[won, 'pffPressure'].mean():.1%}  recall {won[a['pffPressure']].mean():.1%}")
    return "\n".join(lines)


def season_table(reps, rusher_plays, players):
    """Rushers count rusher-plays; blockers count reps, one per blocker per play."""
    agg = {"reps": ("rusherWon", "size"), "wins": ("rusherWon", "sum"), "expected": ("expected", "mean")}
    as_rusher = rusher_plays.groupby("rusherId").agg(**agg).rename_axis("nflId")
    as_blocker = reps.groupby("blockerId").agg(**agg).rename_axis("nflId")
    as_rusher["role"] = "rusher"
    as_blocker["role"] = "blocker"
    s = pd.concat([as_rusher, as_blocker]).reset_index()
    s["winRate"] = s["wins"] / s["reps"]
    s["overExpected"] = s["winRate"] - s["expected"]
    return s.merge(players[["nflId", "displayName", "officialPosition"]], on="nflId", how="left")


def charts(reps, season):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    top = season[(season["role"] == "rusher") & (season["reps"] >= 150)].nlargest(15, "overExpected").iloc[::-1]
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.barh(top["displayName"], top["winRate"] * 100, color="#c8102e", label="reps won")
    ax.scatter(top["expected"] * 100, top["displayName"], color="#111", marker="|", s=300, zorder=3,
               label="expected for where he lines up")
    ax.set_xlabel(f"Reps won (%)  ·  within {THRESHOLD_YDS} yds of the QB inside {WINDOW_SEC:g} s of the snap")
    ax.set_title("Pass rushers who beat their blocker most often beyond expectation\n2021 weeks 1-8, min 150 rusher-plays")
    ax.legend(loc="lower right", frameon=False, fontsize=9)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "top_rushers.png"), dpi=160)
    plt.close(fig)

    pairs = reps.groupby(["gameId", "rusherId", "blockerId"]).agg(reps=("rusherWon", "size"), wins=("rusherWon", "sum")).reset_index()
    return pairs


def team_rates(df):
    """Defensive and pass-protection rates over any set of plays."""
    typed = df[df["pff_passCoverageType"].isin(["Man", "Zone"])]
    return {"blitzRate": df["blitz"].mean(), "thirdDownBlitzRate": df.loc[df["down"] == 3, "blitz"].mean(),
            "manRate": (typed["pff_passCoverageType"] == "Man").mean(), "pressureRate": df["pressure"].mean(),
            "sackRate": (df["passResult"] == "S").mean()}


def play_flags(plays, pff, timing, games):
    """Plays with week, rusher and blocker counts, blitz (5+ rushers), any PFF pressure, and snap-to-throw/sack seconds."""
    roles = pff.groupby(["gameId", "playId"])["pff_role"].value_counts().unstack(fill_value=0)
    roles = roles.reindex(columns=["Pass Rush", "Pass Block"], fill_value=0).rename(columns={"Pass Rush": "rushers", "Pass Block": "blockers"})
    pressured = (pff[["pff_hit", "pff_hurry", "pff_sack"]].fillna(0) == 1).any(axis=1)
    pressured = pressured.groupby([pff["gameId"], pff["playId"]]).any().rename("pressure")
    p = plays.merge(games[["gameId", "week"]], on="gameId").join(roles, on=["gameId", "playId"]).join(pressured, on=["gameId", "playId"])
    p = p.merge(timing, on=["gameId", "playId"], how="left")
    p[["rushers", "blockers"]] = p[["rushers", "blockers"]].fillna(0).astype(int)
    p["pressure"] = p["pressure"].eq(True)
    p["blitz"] = p["rushers"] >= 5
    return p


def team_table(p):
    """Per-team blitz, coverage and pressure rates on defense and pressure allowed on offense, plus the league."""
    rows = []
    for team in sorted(p["defensiveTeam"].unique()):
        d = p[p["defensiveTeam"] == team]
        o = p[p["possessionTeam"] == team]
        cov = d["pff_passCoverage"].dropna().value_counts().head(3) / len(d)
        rows.append({"team": team, "defPlays": len(d), **team_rates(d),
                     "coverages": [{"name": k, "share": round(float(v), 4)} for k, v in cov.items()],
                     "offPlays": len(o), "pressureAllowedRate": o["pressure"].mean(),
                     "sackAllowedRate": (o["passResult"] == "S").mean()})
    teams = pd.DataFrame(rows)
    league = {k: round(float(v), 4) for k, v in team_rates(p).items()}
    league["pressureAllowedRate"] = league["pressureRate"]
    return teams, league


def count(mask):
    return {"n": int(mask.sum()), "of": int(len(mask))}


def team_counts(df):
    """Defensive tendencies as {n, of} counts over any set of plays."""
    typed = df[df["pff_passCoverageType"].isin(["Man", "Zone"])]
    third_long = df[(df["down"] == 3) & (df["yardsToGo"] >= 7)]
    return {"blitz": count(df["blitz"]), "thirdLongBlitz": count(third_long["blitz"]),
            "man": count(typed["pff_passCoverageType"] == "Man"), "pressure": count(df["pressure"]),
            "sack": count(df["passResult"] == "S")}


def team_to_date(p, team):
    """One team's defensive tendencies and pass protection as counts over the plays given."""
    d = p[p["defensiveTeam"] == team]
    o = p[p["possessionTeam"] == team]
    ttt = o["timeToThrow"].median()
    return {"defense": {"plays": len(d), **team_counts(d),
                        "coverages": [{"name": k, "n": int(v), "of": len(d)}
                                      for k, v in d["pff_passCoverage"].dropna().value_counts().head(3).items()]},
            "offense": {"plays": len(o), "pressureAllowed": count(o["pressure"]), "sackAllowed": count(o["passResult"] == "S"),
                        "timeToThrowMedian": None if pd.isna(ttt) else round(float(ttt), 2)}}


def season_entries(season, ids):
    """Payload season lines for the given players, keeping each player's larger role."""
    out = {}
    for r in season[season["nflId"].isin(ids)].itertuples():
        key = str(int(r.nflId))
        if key not in out or r.reps > out[key]["reps"]:
            out[key] = {"reps": int(r.reps), "wins": int(r.wins), "winRate": round(float(r.winRate), 4),
                        "expected": round(float(r.expected), 4), "role": r.role}
    return out


def personnel_code(s):
    """'1 RB, 1 TE, 3 WR' -> '11'."""
    rb = re.search(r"(\d+) RB", s) if isinstance(s, str) else None
    te = re.search(r"(\d+) TE", s) if isinstance(s, str) else None
    return rb.group(1) + te.group(1) if rb and te else None


def pressure_events(pff_play, jerseys, play):
    """One entry per defender credited with a sack, hit or hurry (his most severe), sacks first.

    The blocker is the one PFF charged with that type while blocking this rusher, else the only charged blocker
    of that type who was not blocking another credited rusher, else none; chargedElsewhere marks a charge left unnamed."""
    credited = set(pff_play.loc[(pff_play[[c for _, c, _ in PRESSURE_TYPES]] == 1).any(axis=1), "nflId"])
    events = []
    for kind, credit, allowed in PRESSURE_TYPES:
        charged = pff_play[pff_play[allowed] == 1]
        for r in pff_play[pff_play[credit] == 1].itertuples():
            if any(e["rusherId"] == int(r.nflId) for e in events):
                continue
            match = charged[charged["pff_nflIdBlockedPlayer"] == r.nflId]
            free = charged[~charged["pff_nflIdBlockedPlayer"].isin(credited - {r.nflId})]
            blocker = match.iloc[0] if len(match) else free.iloc[0] if len(free) == 1 else None
            sec = play["timeToSack" if kind == "sack" else "timeToThrow"]
            events.append({"type": kind, "rusherId": int(r.nflId),
                           "jersey": int(jerseys.loc[r.nflId, "jerseyNumber"]) if r.nflId in jerseys.index else None,
                           "rusherPos": None if pd.isna(r.pff_positionLinedUp) else r.pff_positionLinedUp,
                           "blockerId": None if blocker is None else int(blocker["nflId"]),
                           "blockerPos": None if blocker is None or pd.isna(blocker["pff_positionLinedUp"]) else blocker["pff_positionLinedUp"],
                           "chargedElsewhere": blocker is None and len(charged) > 0,
                           "seconds": None if pd.isna(sec) else round(float(sec), 1)})
    return events


def demo_game(game_id, plays, players, games, pff, reps, rusher_plays, season, teams, team_league):
    """Writes the overlay payload: weeks 1-8 season context, plus to-date context from weeks before the game."""
    track = pd.read_csv(os.path.join(DATA, "tracking", f"tracking_{game_id}.csv"))
    flip = track["playDirection"] == "left"
    track.loc[flip, "x"] = 120 - track.loc[flip, "x"]
    track.loc[flip, "y"] = 53.3 - track.loc[flip, "y"]
    track[["x", "y"]] = track[["x", "y"]].round(2)
    windows = play_windows(track)
    g = games.set_index("gameId").loc[game_id]
    gp = plays[plays["gameId"] == game_id].sort_values("playId")
    pff_g = pff[pff["gameId"] == game_id]
    reps_g = reps[reps["gameId"] == game_id]
    jerseys = track.dropna(subset=["nflId"]).groupby("nflId")[["team", "jerseyNumber"]].first()

    out_plays = []
    for _, p in gp.iterrows():
        pid = int(p["playId"])
        t = track[track["playId"] == pid]
        if t.empty or pid not in windows.index:
            continue
        frames = sorted(t["frameId"].unique())
        index = {f: i for i, f in enumerate(frames)}
        ball = t[t["team"] == "football"].set_index("frameId").reindex(frames)[["x", "y"]].ffill().bfill()
        people = []
        for nid, pt in t[t["team"] != "football"].groupby("nflId"):
            xy = pt.set_index("frameId").reindex(frames)[["x", "y"]].ffill().bfill()
            people.append({"nflId": int(nid), "team": pt["team"].iloc[0], "jersey": int(pt["jerseyNumber"].iloc[0]),
                           "xy": xy.values.tolist()})
        qb = pff_g[(pff_g["playId"] == pid) & (pff_g["pff_role"] == "Pass")]["nflId"]
        duels = [{"blockerId": int(r.blockerId), "rusherId": int(r.rusherId), "closestYds": round(float(r.closestYds), 2),
                  "secToPressure": None if pd.isna(r.secToPressure) else round(float(r.secToPressure), 1),
                  "rusherWon": bool(r.rusherWon)}
                 for r in reps_g[reps_g["playId"] == pid].itertuples()]
        w = windows.loc[pid]
        ttt = p["timeToThrow"]
        out_plays.append({
            "playId": pid, "quarter": int(p["quarter"]), "clock": p["gameClock"], "down": int(p["down"]),
            "yardsToGo": int(p["yardsToGo"]), "offense": p["possessionTeam"], "defense": p["defensiveTeam"],
            "description": p["playDescription"], "passResult": None if pd.isna(p["passResult"]) else p["passResult"],
            "coverage": None if pd.isna(p["pff_passCoverage"]) else p["pff_passCoverage"],
            "qbId": int(qb.iloc[0]) if len(qb) else None,
            "snapFrame": index[w["snap"]], "endFrame": index[w["end"]], "nFrames": len(frames),
            "ball": ball.values.tolist(), "players": people, "duels": duels,
            "personnel": personnel_code(p["personnelO"]), "formation": FORMATIONS.get(p["offenseFormation"]),
            "box": None if pd.isna(p["defendersInBox"]) else int(p["defendersInBox"]),
            "rushers": int(p["rushers"]), "blockers": int(p["blockers"]),
            "timeToThrow": None if pd.isna(ttt) else round(float(ttt), 1),
            "pressureEvents": pressure_events(pff_g[pff_g["playId"] == pid], jerseys, p),
        })

    on_field = {pl["nflId"] for op in out_plays for pl in op["players"]}
    pl = players.set_index("nflId")
    player_map = {str(n): {"name": pl.loc[n, "displayName"], "pos": pl.loc[n, "officialPosition"],
                           "team": jerseys.loc[n, "team"], "jersey": int(jerseys.loc[n, "jerseyNumber"])}
                  for n in on_field if n in pl.index}
    week = int(g["week"])
    rp_td = rusher_plays[rusher_plays["week"] < week].copy()
    reps_td = reps[reps["week"] < week].copy()
    expected_td = rp_td.groupby("align")["rusherWon"].mean()
    rp_td["expected"] = rp_td["align"].map(expected_td)
    reps_td["expected"] = reps_td["align"].map(expected_td)
    season_td = season_table(reps_td, rp_td, players)
    plays_td = plays[plays["week"] < week]

    payload = {
        "meta": {"gameId": int(game_id), "week": int(g["week"]), "date": g["gameDate"], "home": g["homeTeamAbbr"],
                 "away": g["visitorTeamAbbr"],
                 "label": f"SIMULATED LIVE · {g['season']} DATA · {g['visitorTeamAbbr']} @ {g['homeTeamAbbr']} Wk {int(g['week'])}",
                 "toDateWeeks": sorted(int(x) for x in games.loc[games["week"] < week, "week"].unique())},
        "players": player_map,
        "season": season_entries(season, on_field),
        "seasonToDate": season_entries(season_td, on_field),
        "league": {"repWinRate": round(float(rusher_plays["rusherWon"].mean()), 4), "thresholdYds": THRESHOLD_YDS, "windowSec": WINDOW_SEC,
                   "byAlign": {k: round(float(v), 4) for k, v in rusher_plays.groupby("align")["rusherWon"].mean().items()},
                   "team": team_league,
                   "toDate": {"repWinRate": round(float(rp_td["rusherWon"].mean()), 4),
                              "byAlign": {k: round(float(v), 4) for k, v in expected_td.items()}},
                   "teamToDate": team_counts(plays_td)},
        "teams": {},
        "teamsToDate": {t: team_to_date(plays_td, t) for t in (g["visitorTeamAbbr"], g["homeTeamAbbr"])},
        "plays": out_plays,
    }
    for t in teams[teams["team"].isin([g["homeTeamAbbr"], g["visitorTeamAbbr"]])].itertuples():
        payload["teams"][t.team] = {
            "defense": {"plays": int(t.defPlays), "blitzRate": round(float(t.blitzRate), 4),
                        "thirdDownBlitzRate": round(float(t.thirdDownBlitzRate), 4), "manRate": round(float(t.manRate), 4),
                        "pressureRate": round(float(t.pressureRate), 4), "sackRate": round(float(t.sackRate), 4),
                        "coverages": t.coverages},
            "offense": {"plays": int(t.offPlays), "pressureAllowedRate": round(float(t.pressureAllowedRate), 4),
                        "sackAllowedRate": round(float(t.sackAllowedRate), 4)},
        }
    os.makedirs(OVERLAY, exist_ok=True)
    with open(os.path.join(OVERLAY, "demo_game.js"), "w") as f:
        f.write("window.TRENCH = ")
        json.dump(payload, f, separators=(",", ":"))
        f.write(";\n")
    return len(out_plays)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", type=int, default=DEFAULT_GAME)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    plays, players, games, pff = load_tables()
    reps, rusher_plays, rush, timing = build_reps(plays, pff, games)
    reps.to_csv(os.path.join(OUT, "reps.csv"), index=False)
    report = validate(rush, pff)
    with open(os.path.join(OUT, "validation.txt"), "w") as f:
        f.write(report + "\n")
    print(report)

    season = season_table(reps, rusher_plays, players)
    season.to_csv(os.path.join(OUT, "season.csv"), index=False)
    pairs = charts(reps, season)
    print(f"\nReps (blocker–rusher pairs): {len(reps)}; rusher-plays: {len(rusher_plays)}")
    print(f"League rusher win rate: {rusher_plays['rusherWon'].mean():.1%}")
    print("By alignment:", rusher_plays.groupby("align")["rusherWon"].mean().round(3).to_dict())
    print("Top rushers over expected (min 150 rusher-plays):")
    print(season[(season["role"] == "rusher") & (season["reps"] >= 150)].nlargest(10, "overExpected")
          [["displayName", "officialPosition", "reps", "winRate", "expected", "overExpected"]].round(3).to_string(index=False))
    print("Most-contested single-game duels:")
    pairs = pairs.merge(players[["nflId", "displayName"]].rename(columns={"nflId": "rusherId", "displayName": "rusher"}), on="rusherId") \
                 .merge(players[["nflId", "displayName"]].rename(columns={"nflId": "blockerId", "displayName": "blocker"}), on="blockerId")
    print(pairs[pairs["reps"] >= 15].sort_values("wins", ascending=False).head(10).to_string(index=False))

    flagged = play_flags(plays, pff, timing, games)
    teams, team_league = team_table(flagged)
    csv = teams.assign(coverages=teams["coverages"].map(lambda c: ", ".join(f"{x['name']} {x['share']:.0%}" for x in c)))
    csv.round(4).to_csv(os.path.join(OUT, "teams.csv"), index=False)
    cols = ["team", "defPlays", "blitzRate", "thirdDownBlitzRate", "manRate", "pressureRate", "sackRate", "pressureAllowedRate"]
    print("\nLeague team rates:", team_league)
    print("Top blitzing defenses:")
    print(teams.nlargest(5, "blitzRate")[cols].round(3).to_string(index=False))
    g = games.set_index("gameId").loc[args.game]
    print("Demo game teams:")
    print(csv[csv["team"].isin([g["visitorTeamAbbr"], g["homeTeamAbbr"]])][cols + ["coverages"]].round(3).to_string(index=False))

    n = demo_game(args.game, flagged, players, games, pff, reps, rusher_plays, season, teams, team_league)
    print(f"\nWrote overlay/data/demo_game.js with {n} plays from game {args.game}")


if __name__ == "__main__":
    main()
