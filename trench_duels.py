"""Trench Duel: who is winning each pass rusher vs blocker battle, rep by rep.

A rep is one play on which PFF charted an offensive player blocking a pass rusher.
The rusher wins the rep when tracking puts him within THRESHOLD_YDS of the
quarterback inside WINDOW_SEC of the snap (cut short if the ball is thrown first).
Interior linemen start closer to the quarterback than edge rushers, so every rep
also carries the win rate expected for where the rusher lined up, and players are
compared on wins over that expectation.

Outputs:
  output/reps.csv              every rep in weeks 1-8
  output/season.csv            per-player rep totals
  output/validation.txt        how the tracking definition agrees with PFF pressures
  output/*.png                 charts
  overlay/data/demo_game.js    one game's replay and duels for the co-streamer overlay

Run: python trench_duels.py [--game GAMEID]
"""

import argparse
import glob
import json
import os

import numpy as np
import pandas as pd

DATA = os.path.join(os.path.dirname(__file__), "data")
OUT = os.path.join(os.path.dirname(__file__), "output")
OVERLAY = os.path.join(os.path.dirname(__file__), "overlay", "data")

FPS = 10
WINDOW_SEC = 3.0
THRESHOLD_YDS = 2.0
SNAP_EVENTS = {"ball_snap", "autoevent_ballsnap"}
END_EVENTS = {"pass_forward", "autoevent_passforward", "qb_sack", "qb_strip_sack", "run", "pass_shovel"}
INTERIOR = {"NT", "NLT", "NRT", "DLT", "DRT"}
EDGE = {"LE", "RE", "LEO", "REO", "LOLB", "ROLB"}
DEFAULT_GAME = 2021100305  # Week 4, CLE @ MIN: Myles Garrett vs Rashod Hill


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
    """One row per (play, blocker, rusher) rep across every game."""
    blocks = pff.loc[(pff["pff_role"] == "Pass Block") & pff["pff_nflIdBlockedPlayer"].notna(),
                     ["gameId", "playId", "nflId", "pff_nflIdBlockedPlayer", "pff_blockType"]]
    blocks = blocks.rename(columns={"nflId": "blockerId", "pff_nflIdBlockedPlayer": "rusherId"})
    blocks["rusherId"] = blocks["rusherId"].astype(int)
    rush_rows = []
    for path in sorted(glob.glob(os.path.join(DATA, "tracking", "tracking_*.csv"))):
        track = pd.read_csv(path, usecols=["gameId", "playId", "nflId", "frameId", "x", "y", "event"])
        gid = int(track["gameId"].iloc[0])
        windows = play_windows(track)
        rc = rusher_closest(track, pff[pff["gameId"] == gid], windows)
        rc["gameId"] = gid
        rush_rows.append(rc)
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
    reps["expected"] = reps.groupby("align")["rusherWon"].transform("mean")
    return reps, rush


def validate(rush, pff):
    """Agreement between the tracking definition and PFF's hand-charted pressures, per rusher-play."""
    p = pff.loc[pff["pff_role"] == "Pass Rush", ["gameId", "playId", "nflId", "pff_hit", "pff_hurry", "pff_sack"]]
    p["pffPressure"] = p[["pff_hit", "pff_hurry", "pff_sack"]].fillna(0).sum(axis=1) > 0
    v = rush.merge(p.rename(columns={"nflId": "rusherId"}), on=["gameId", "playId", "rusherId"])
    v["won"] = v["closestYds"] <= THRESHOLD_YDS
    ct = pd.crosstab(v["won"], v["pffPressure"])
    tp = ct.loc[True, True]
    precision = tp / ct.loc[True].sum()
    recall = tp / ct[True].sum()
    base = v["pffPressure"].mean()
    lines = [
        f"Rusher-plays: {len(v)}",
        f"Definition: within {THRESHOLD_YDS} yds of the QB inside {WINDOW_SEC}s of the snap (or before the throw)",
        f"Tracking 'win' rate: {v['won'].mean():.1%}   PFF pressure rate: {base:.1%}",
        f"When tracking says win, PFF charted a pressure {precision:.1%} of the time ({precision / base:.1f}x the base rate)",
        f"Of PFF pressures, tracking flags {recall:.1%}",
        "",
        "Crosstab (rows: tracking win, cols: PFF pressure):",
        ct.to_string(),
    ]
    return "\n".join(lines)


def season_table(reps, players):
    agg = {"reps": ("rusherWon", "size"), "wins": ("rusherWon", "sum"), "expected": ("expected", "mean")}
    as_rusher = reps.groupby("rusherId").agg(**agg).rename_axis("nflId")
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
    ax.set_title("Pass rushers who beat their blocker most often beyond expectation\n2021 weeks 1-8, min 150 reps")
    ax.legend(loc="lower right", frameon=False, fontsize=9)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "top_rushers.png"), dpi=160)
    plt.close(fig)

    pairs = reps.groupby(["gameId", "rusherId", "blockerId"]).agg(reps=("rusherWon", "size"), wins=("rusherWon", "sum")).reset_index()
    return pairs


def demo_game(game_id, plays, players, games, pff, reps, season):
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
        out_plays.append({
            "playId": pid, "quarter": int(p["quarter"]), "clock": p["gameClock"], "down": int(p["down"]),
            "yardsToGo": int(p["yardsToGo"]), "offense": p["possessionTeam"], "defense": p["defensiveTeam"],
            "description": p["playDescription"], "passResult": None if pd.isna(p["passResult"]) else p["passResult"],
            "coverage": None if pd.isna(p["pff_passCoverage"]) else p["pff_passCoverage"],
            "qbId": int(qb.iloc[0]) if len(qb) else None,
            "snapFrame": index[w["snap"]], "endFrame": index[w["end"]], "nFrames": len(frames),
            "ball": ball.values.tolist(), "players": people, "duels": duels,
        })

    on_field = {pl["nflId"] for op in out_plays for pl in op["players"]}
    jerseys = track.dropna(subset=["nflId"]).groupby("nflId")[["team", "jerseyNumber"]].first()
    pl = players.set_index("nflId")
    player_map = {str(n): {"name": pl.loc[n, "displayName"], "pos": pl.loc[n, "officialPosition"],
                           "team": jerseys.loc[n, "team"], "jersey": int(jerseys.loc[n, "jerseyNumber"])}
                  for n in on_field if n in pl.index}
    season_map = {}
    for r in season[season["nflId"].isin(on_field)].itertuples():
        key = str(int(r.nflId))
        if key not in season_map or r.reps > season_map[key]["reps"]:
            season_map[key] = {"reps": int(r.reps), "wins": int(r.wins), "winRate": round(float(r.winRate), 4),
                               "expected": round(float(r.expected), 4), "role": r.role}

    payload = {
        "meta": {"gameId": int(game_id), "week": int(g["week"]), "date": g["gameDate"], "home": g["homeTeamAbbr"],
                 "away": g["visitorTeamAbbr"],
                 "label": f"Replay of 2021 Week {int(g['week'])} {g['visitorTeamAbbr']} @ {g['homeTeamAbbr']} from NFL tracking data — not live"},
        "players": player_map,
        "season": season_map,
        "league": {"repWinRate": round(float(reps["rusherWon"].mean()), 4), "thresholdYds": THRESHOLD_YDS, "windowSec": WINDOW_SEC,
                   "byAlign": {k: round(float(v), 4) for k, v in reps.groupby("align")["rusherWon"].mean().items()}},
        "plays": out_plays,
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
    reps, rush = build_reps(plays, pff, games)
    reps.to_csv(os.path.join(OUT, "reps.csv"), index=False)
    report = validate(rush, pff)
    with open(os.path.join(OUT, "validation.txt"), "w") as f:
        f.write(report + "\n")
    print(report)

    season = season_table(reps, players)
    season.to_csv(os.path.join(OUT, "season.csv"), index=False)
    pairs = charts(reps, season)
    print(f"\nReps: {len(reps)}  league rusher win rate: {reps['rusherWon'].mean():.1%}")
    print("By alignment:", reps.groupby("align")["rusherWon"].mean().round(3).to_dict())
    print("Top rushers over expected (min 150 reps):")
    print(season[(season["role"] == "rusher") & (season["reps"] >= 150)].nlargest(10, "overExpected")
          [["displayName", "officialPosition", "reps", "winRate", "expected", "overExpected"]].round(3).to_string(index=False))
    print("Most-contested single-game duels:")
    pairs = pairs.merge(players[["nflId", "displayName"]].rename(columns={"nflId": "rusherId", "displayName": "rusher"}), on="rusherId") \
                 .merge(players[["nflId", "displayName"]].rename(columns={"nflId": "blockerId", "displayName": "blocker"}), on="blockerId")
    print(pairs[pairs["reps"] >= 15].sort_values("wins", ascending=False).head(10).to_string(index=False))

    n = demo_game(args.game, plays, players, games, pff, reps, season)
    print(f"\nWrote overlay/data/demo_game.js with {n} plays from game {args.game}")


if __name__ == "__main__":
    main()
