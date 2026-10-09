"""In-game coverage map: a defender's position heat map tonight against his own
baseline from earlier weeks, on a common grid in yards from the line of scrimmage.

Positions only: it shows where he was between the snap and the throw, sack or scramble, not why.
Every play uses the replay's window, trench_duels.play_windows: from the snap to the first throw,
sack, scramble or shovel pass after it, else the last frame.

    python heatmaps.py --player 44903 --game 2021100305

writes output/heatmap_<lastname>_<gameId>.png and .txt.

    python heatmaps.py --overlay --game 2021100305

writes overlay/data/heat.js: every player tracked in that game who has 5+ plays on the same side of
the ball in earlier weeks, with his frame counts per square yard from the line of scrimmage.
"""
import argparse
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap

from trench_duels import play_windows

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")

DEFENSE_ROLES = ("Coverage", "Pass Rush")
FIELD_WIDTH = 53.3
HASH_HALF_WIDTH = 18.5 / 3 / 2  # NFL hashes are 18 ft 6 in apart

# Grid: downfield (yards past the line of scrimmage) by across (yards from the ball).
DOWN_RANGE = (-5.0, 35.0)  # positions beyond the grid are pinned to its edge
ACROSS_RANGE = (-22.0, 22.0)
BIN = 1.0
SMOOTH_SIGMA = 1.2  # yards
SMALL_SAMPLE = 5
SAME_YD = 1.5  # a depth gap smaller than this is "his usual depth"

# Overlay grid: downfield (x) by across (y = y - ball_y, offense's left positive), raw frame counts.
OVERLAY_HEAT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "overlay", "data", "heat.js")
HEAT_GRID = 1  # yards per cell
HEAT_DOWN = (-15, 35)
HEAT_ACROSS = (-25, 25)

# Sequential blue ramp (dataviz reference palette), light surface.
SURFACE = "#fcfcfb"
INK = "#1f1f1e"
INK_2 = "#5c5b57"
INK_3 = "#8a8984"
RULE = "#d9d8d4"
RAMP = ["#fcfcfb", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
CMAP = LinearSegmentedColormap.from_list("seq_blue", RAMP)


def read_tracking(gid):
    return pd.read_csv(os.path.join(DATA, "tracking", f"tracking_{gid}.csv"),
                       usecols=["playId", "nflId", "frameId", "team", "playDirection", "x", "y", "event"])


def windowed_plays(gid, play_ids):
    """The plays of game `gid` in `play_ids`, each flipped so the offense moves toward +x and cut to
    the replay's window (trench_duels.play_windows): yields (playId, frames from snap to end,
    end_frame, ended_by_event, ball_x, ball_y), skipping plays with no snap or no ball at it."""
    t = read_tracking(gid)
    t = t[t.playId.isin(play_ids)]
    windows = play_windows(t)
    for pid, play in t.groupby("playId"):
        if pid not in windows.index:
            continue
        w = windows.loc[pid]
        left = play.playDirection.iloc[0] == "left"
        # Rounded to the centimetre like the replay's positions (trench_duels.demo_game), so the
        # panel's tonight and this baseline put a frame on a cell edge in the same cell.
        play = play.assign(x=np.where(left, 120 - play.x, play.x).round(2),
                           y=np.where(left, FIELD_WIDTH - play.y, play.y).round(2))
        ball = play[(play.team == "football") & (play.frameId == w.snap)]
        if ball.empty:
            continue
        yield (pid, play[play.frameId.between(w.snap, w.end)], int(w.end), bool(pd.notna(w.end_event)),
               float(ball.x.iloc[0]), float(ball.y.iloc[0]))


def player_frames(player, game_ids, plays, pff):
    """Frames from snap to throw, sack or scramble for every defensive snap of `player`, in LOS-relative yards."""
    on_d = pff[(pff.nflId == player) & pff.pff_role.isin(DEFENSE_ROLES) & pff.gameId.isin(game_ids)]
    quarters = plays.set_index(["gameId", "playId"]).quarter
    rows = []
    per_play = []
    for gid in sorted(game_ids):
        for pid, play, end_frame, ended, bx, by in windowed_plays(gid, on_d[on_d.gameId == gid].playId):
            me = play[play.nflId == player]
            if me.empty:
                continue
            down = me.x.to_numpy() - bx
            # Viewed from behind the offense: offense's left (+y) on the left of the picture.
            across = -(me.y.to_numpy() - by)
            q = int(quarters.loc[(gid, pid)])
            rows.append(pd.DataFrame({"gameId": gid, "playId": pid, "quarter": q,
                                      "frameId": me.frameId.to_numpy(), "down": down, "across": across}))
            end_row = me[me.frameId == end_frame]
            per_play.append({"gameId": gid, "playId": pid, "quarter": q, "ended_by_event": ended,
                             "frames": len(me),
                             "depth_at_end": float(end_row.x.iloc[0] - bx) if ended and not end_row.empty else np.nan})
    frames = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame(
        columns=["gameId", "playId", "quarter", "frameId", "down", "across"])
    return frames, pd.DataFrame(per_play)


def smooth(h, sigma_bins):
    r = int(np.ceil(3 * sigma_bins))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_bins) ** 2)
    k /= k.sum()
    h = np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 0, h)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 1, h)


def density(frames):
    """Share of his time per square yard (sums to 1 over the grid before clipping at its edges)."""
    xb = np.arange(ACROSS_RANGE[0], ACROSS_RANGE[1] + BIN, BIN)
    yb = np.arange(DOWN_RANGE[0], DOWN_RANGE[1] + BIN, BIN)
    h, _, _ = np.histogram2d(frames.down.clip(*DOWN_RANGE), frames.across.clip(*ACROSS_RANGE), bins=[yb, xb])
    if h.sum() > 0:
        h = smooth(h / h.sum(), SMOOTH_SIGMA / BIN)
    return h


def summarise(frames, per_play):
    ended = per_play[per_play.ended_by_event] if len(per_play) else per_play
    return {
        "plays": len(per_play),
        "frames": len(frames),
        "plays_without_end_event": int((~per_play.ended_by_event).sum()) if len(per_play) else 0,
        "depth_plays": int(ended.depth_at_end.notna().sum()) if len(ended) else 0,
        "avg_depth_at_throw": float(ended.depth_at_end.mean()) if len(ended) else np.nan,
        "avg_depth_all_frames": float(frames.down.mean()) if len(frames) else np.nan,
        "avg_width_from_ball": float(frames.across.abs().mean()) if len(frames) else np.nan,
        "share_deeper_than_10": float((frames.down > 10).mean()) if len(frames) else np.nan,
    }


def permutation_p(a, b, n=20000, seed=0):
    """Two-sided permutation p-value for a difference in means (per-play depths)."""
    a, b = np.asarray(a), np.asarray(b)
    if len(a) < 2 or len(b) < 2:
        return np.nan
    rng = np.random.default_rng(seed)
    pooled = np.concatenate([a, b])
    obs = abs(a.mean() - b.mean())
    hits = 0
    for _ in range(n):
        rng.shuffle(pooled)
        hits += abs(pooled[:len(a)].mean() - pooled[len(a):].mean()) >= obs
    return (hits + 1) / (n + 1)


def side_of(roles):
    """Side of the ball for a run of PFF roles: defense when most are Coverage or Pass Rush."""
    return "defense" if roles.isin(DEFENSE_ROLES).mean() >= 0.5 else "offense"


def overlay_heat(game_id, players, games, pff):
    """Baseline heat grids for every player tracked in `game_id`: frame counts per cell, snap to
    throw, sack or scramble, on the side of the ball he plays tonight, over every earlier week."""
    nx = int((HEAT_DOWN[1] - HEAT_DOWN[0]) / HEAT_GRID)
    ny = int((HEAT_ACROSS[1] - HEAT_ACROSS[0]) / HEAT_GRID)
    week = int(games.loc[games.gameId == game_id, "week"].iloc[0])
    base_games = games[games.week < week]
    tonight = read_tracking(game_id)
    teams = tonight.dropna(subset=["nflId"]).astype({"nflId": int}).groupby("nflId").team.first()
    sides = pff[pff.gameId == game_id].groupby("nflId").pff_role.apply(side_of)
    sides = sides[sides.index.isin(teams.index)]

    base = pff[pff.gameId.isin(base_games.gameId) & pff.nflId.isin(sides.index)]
    base = base[base.pff_role.isin(DEFENSE_ROLES) == (base.nflId.map(sides) == "defense")]
    on_play = base.groupby(["gameId", "playId"]).nflId.apply(set)

    acc = {nid: {"plays": 0, "frames": 0, "cells": np.zeros((ny, nx), dtype=np.int64), "depths": []}
           for nid in sides.index}
    for gid in sorted(base.gameId.unique()):
        wanted = on_play.loc[gid]
        for pid, play, end_frame, ended, bx, by in windowed_plays(gid, wanted.index):
            for nid, me in play[play.nflId.isin(wanted.loc[pid])].groupby("nflId"):
                down = me.x.to_numpy() - bx
                across = me.y.to_numpy() - by
                ix = np.clip(np.floor((down - HEAT_DOWN[0]) / HEAT_GRID).astype(int), 0, nx - 1)
                iy = np.clip(np.floor((across - HEAT_ACROSS[0]) / HEAT_GRID).astype(int), 0, ny - 1)
                a = acc[nid]
                np.add.at(a["cells"], (iy, ix), 1)
                a["plays"] += 1
                a["frames"] += len(me)
                end_row = me.frameId.to_numpy() == end_frame
                if ended and end_row.any():
                    a["depths"].append(float(down[end_row][0]))

    names = players.set_index("nflId")
    out = {}
    for nid, a in sorted(acc.items()):
        if a["plays"] < SMALL_SAMPLE:
            continue
        out[str(int(nid))] = {
            "name": names.loc[nid, "displayName"], "pos": names.loc[nid, "officialPosition"],
            "team": teams.loc[nid], "side": sides.loc[nid],
            "baseline": {
                "plays": a["plays"], "frames": a["frames"], "cells": a["cells"].ravel().tolist(),
                "avgDepthAtEnd": round(float(np.mean(a["depths"])), 1) if a["depths"] else None,
                "depthPlays": len(a["depths"]),
            },
        }
    meta = {"gameId": int(game_id), "gridYd": HEAT_GRID, "xMin": HEAT_DOWN[0], "xMax": HEAT_DOWN[1],
            "yMin": HEAT_ACROSS[0], "yMax": HEAT_ACROSS[1],
            "weeks": sorted(int(w) for w in base_games.week.unique()),
            "note": "positions from snap to throw, sack or scramble, passing plays, yards from the line of scrimmage"}
    return {"meta": meta, "players": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--player", type=int, default=44903, help="nflId (default: John Johnson III)")
    ap.add_argument("--game", type=int, default=2021100305, help="gameId tonight (default: CLE @ MIN, week 4)")
    ap.add_argument("--overlay", action="store_true",
                    help="write the overlay's baseline grids for every player in --game to overlay/data/heat.js")
    args = ap.parse_args()

    players = pd.read_csv(os.path.join(DATA, "players.csv"))
    games = pd.read_csv(os.path.join(DATA, "games.csv"))
    if args.overlay:
        pff = pd.read_csv(os.path.join(DATA, "pffScoutingData.csv"), usecols=["gameId", "playId", "nflId", "pff_role"])
        heat = overlay_heat(args.game, players, games, pff)
        os.makedirs(os.path.dirname(OVERLAY_HEAT), exist_ok=True)
        with open(OVERLAY_HEAT, "w") as fh:
            fh.write("window.TRENCH_HEAT = " + json.dumps(heat, separators=(",", ":")) + ";\n")
        print(f"wrote {OVERLAY_HEAT}: {len(heat['players'])} players, {os.path.getsize(OVERLAY_HEAT):,} bytes")
        return

    plays = pd.read_csv(os.path.join(DATA, "plays.csv"), usecols=["gameId", "playId", "quarter", "defensiveTeam"])
    pff = pd.read_csv(os.path.join(DATA, "pffScoutingData.csv"), usecols=["gameId", "playId", "nflId", "pff_role"])

    if not (players.nflId == args.player).any():
        raise SystemExit(f"No player with nflId {args.player} in data/players.csv.")
    prow = players[players.nflId == args.player].iloc[0]
    name, pos = prow.displayName, prow.officialPosition
    game = games[games.gameId == args.game].iloc[0]
    week = int(game.week)

    mine = pff[(pff.nflId == args.player) & pff.pff_role.isin(DEFENSE_ROLES)].merge(plays, on=["gameId", "playId"])
    if not (mine.gameId == args.game).any():
        raise SystemExit(f"{name} has no defensive snaps in game {args.game}.")
    team = mine[mine.gameId == args.game].defensiveTeam.iloc[0]
    base_games = sorted(set(mine.gameId) & set(games[games.week < week].gameId))
    base_weeks = sorted(games[games.gameId.isin(base_games)].week.unique())
    if not base_games:
        raise SystemExit(f"{name} has no defensive snaps before week {week}: no baseline to compare against.")
    opp = game.homeTeamAbbr if game.visitorTeamAbbr == team else game.visitorTeamAbbr
    matchup = f"{game.visitorTeamAbbr} @ {game.homeTeamAbbr}"

    base_f, base_p = player_frames(args.player, base_games, plays, pff)
    night_f, night_p = player_frames(args.player, [args.game], plays, pff)

    week_label = f"Weeks {base_weeks[0]}–{base_weeks[-1]}" if len(base_weeks) > 1 else f"Week {base_weeks[0]}"
    n_base_games = len(base_games)
    panels = [
        (f"{week_label} baseline", base_f, base_p),
        ("Tonight: 1st half", night_f[night_f.quarter.isin([1, 2])], night_p[night_p.quarter.isin([1, 2])]),
        ("Tonight: 2nd half", night_f[night_f.quarter.isin([3, 4])], night_p[night_p.quarter.isin([3, 4])]),
    ]
    stats = [summarise(f, p) for _, f, p in panels]
    tonight = summarise(night_f, night_p)
    dens = [density(f) for _, f, _ in panels]
    vmax = max(float(np.percentile(d[d > 0], 99.5)) if (d > 0).any() else 1e-9 for d in dens)

    # "Usual depth" unless tonight's depth at the end differs from his baseline by 1.5+ yards, as in the overlay panel.
    b_depths = base_p.loc[base_p.ended_by_event, "depth_at_end"].dropna()
    n_depths = night_p.loc[night_p.ended_by_event, "depth_at_end"].dropna()
    diff = n_depths.mean() - b_depths.mean()
    p_val = permutation_p(n_depths, b_depths)
    takeaway = ""
    if abs(diff) >= SAME_YD:
        word = "deeper" if diff > 0 else "shallower"
        takeaway = (f"Tonight he sat {abs(diff):.1f} yd {word} at the throw/sack/scramble: {n_depths.mean():.1f} yd over "
                    f"{len(n_depths)} plays vs {b_depths.mean():.1f} yd over {len(b_depths)} plays in "
                    f"{week_label.lower()}.")
    elif len(n_depths) and len(b_depths):
        takeaway = (f"Tonight he played at his usual depth: {n_depths.mean():.1f} yd at the throw/sack/scramble over {len(n_depths)} plays "
                    f"vs {b_depths.mean():.1f} yd over {len(b_depths)} plays in {week_label.lower()}.")

    # Figure
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "text.color": INK,
                         "axes.labelcolor": INK_2, "xtick.color": INK_3, "ytick.color": INK_3})
    fig, axes = plt.subplots(1, 3, figsize=(14, 7.4), facecolor=SURFACE, sharey=True)
    fig.subplots_adjust(left=0.06, right=0.9, top=0.8, bottom=0.25, wspace=0.12)
    extent = [ACROSS_RANGE[0], ACROSS_RANGE[1], DOWN_RANGE[0], DOWN_RANGE[1]]
    for ax, (title, f, p), d, s in zip(axes, panels, dens, stats):
        ax.set_facecolor(SURFACE)
        im = ax.imshow(d, origin="lower", extent=extent, cmap=CMAP, vmin=0, vmax=vmax,
                       aspect="equal", interpolation="bilinear")
        ax.axvspan(-HASH_HALF_WIDTH, HASH_HALF_WIDTH, color=INK_3, alpha=0.07, lw=0)
        for xh in (-HASH_HALF_WIDTH, HASH_HALF_WIDTH):
            ax.axvline(xh, color=INK_3, lw=0.6, ls=(0, (2, 3)), alpha=0.6)
        for yd in (10, 20):
            ax.axhline(yd, color=RULE, lw=0.6, alpha=0.8)
        ax.axhline(0, color=INK_2, lw=1.4)
        ax.plot(0, 0, marker="o", ms=8, mfc=SURFACE, mec=INK, mew=1.6, zorder=5)
        ax.set_title(title, loc="left", fontsize=13, fontweight="bold", color=INK, pad=8)
        ax.set_xlim(*ACROSS_RANGE)
        ax.set_ylim(*DOWN_RANGE)
        ax.set_xticks([-20, -10, 0, 10, 20])
        ax.set_yticks([0, 10, 20, 30])
        ax.tick_params(length=0)
        for sp in ax.spines.values():
            sp.set_visible(False)
        ax.set_xlabel("yards from the ball  (← offense's left · right →)", fontsize=9)
        depth = f"{s['avg_depth_at_throw']:.1f} yd" if s["depth_plays"] else "n/a"
        games_note = f" · {n_base_games} games" if f is base_f else ""
        lines = [f"{s['plays']} plays{games_note} · {s['frames']:,} frames",
                 f"avg depth at throw/sack/scramble {depth} · {s['depth_plays']} plays",
                 f"{s['share_deeper_than_10']:.0%} of time 10+ yd deep",
                 f"avg {s['avg_width_from_ball']:.1f} yd across from the ball"]
        ax.text(0, -0.17, "\n".join(lines), transform=ax.transAxes, ha="left", va="top",
                fontsize=9.5, color=INK_2, linespacing=1.5)
        if s["plays"] < SMALL_SAMPLE:
            ax.text(0.5, 0.5, f"Small sample: {s['plays']} plays", transform=ax.transAxes,
                    ha="center", va="center", fontsize=11, color=INK, fontweight="bold")
    axes[0].set_ylabel("yards downfield from the line of scrimmage")
    axes[0].text(ACROSS_RANGE[1] - 0.5, 0.4, "line of scrimmage", ha="right", va="bottom", fontsize=8, color=INK_2)
    axes[0].text(1.0, -1.0, "ball at snap", ha="left", va="top", fontsize=8, color=INK_2)
    axes[0].text(HASH_HALF_WIDTH + 0.6, DOWN_RANGE[1] - 0.8, "hash width", ha="left", va="top", fontsize=8, color=INK_3)

    cax = fig.add_axes([0.915, 0.2, 0.012, 0.6])
    cb = fig.colorbar(im, cax=cax)
    cb.outline.set_visible(False)
    cb.ax.tick_params(length=0, labelsize=8)
    cb.set_ticks([0, vmax])
    cb.set_ticklabels(["0", f"{vmax:.1%}"])
    cb.set_label("share of his time per square yard (same scale in all panels)", fontsize=8.5, color=INK_2)

    last = name.split()[1] if len(name.split()) > 1 else name
    fig.text(0.06, 0.94, f"{name}: where he played, tonight vs his first {n_base_games} games",
             fontsize=17, fontweight="bold", color=INK)
    sub = f"{team} {pos}, {matchup} (week {week}) · passing plays, snap to throw, sack or scramble · yards from the line of scrimmage"
    fig.text(0.06, 0.895, sub, fontsize=10.5, color=INK_2)
    if takeaway:
        fig.text(0.06, 0.855, takeaway, fontsize=10.5, color=INK)
    fig.text(0.06, 0.025, "Positions only: where he stood, not why. Tracking 10 Hz, NFL Big Data Bowl 2023; "
             "plays where PFF lists him in coverage or rushing. Smoothed 1-yd grid.",
             fontsize=8, color=INK_3)

    os.makedirs(OUT, exist_ok=True)
    stem = os.path.join(OUT, f"heatmap_{last.lower()}_{args.game}")
    fig.savefig(stem + ".png", dpi=150, facecolor=SURFACE)

    with open(stem + ".txt", "w") as fh:
        fh.write(f"{name} (nflId {args.player}, {team} {pos}) · {matchup}, week {week}, gameId {args.game}\n")
        fh.write(f"Baseline games: {', '.join(str(g) for g in base_games)} ({week_label.lower()})\n")
        fh.write("Frames: the replay's window (trench_duels.play_windows), snap to the first throw, sack, scramble or "
                 "shovel pass after the snap (last frame if none); "
                 "yards relative to the ball at the snap, offense moving toward +downfield.\n\n")
        for (title, _, _), s in zip(panels + [("Tonight: whole game", None, None)], stats + [tonight]):
            fh.write(f"{title}\n")
            fh.write(f"  plays {s['plays']}, frames {s['frames']}, plays without a throw, sack or scramble {s['plays_without_end_event']}\n")
            fh.write(f"  avg depth at throw/sack/scramble {s['avg_depth_at_throw']:.2f} yd over {s['depth_plays']} plays\n")
            fh.write(f"  avg depth over all frames {s['avg_depth_all_frames']:.2f} yd\n")
            fh.write(f"  avg width from the ball {s['avg_width_from_ball']:.2f} yd\n")
            fh.write(f"  share of time deeper than 10 yd {s['share_deeper_than_10']:.1%}\n")
            if s["plays"] < SMALL_SAMPLE:
                fh.write(f"  small sample: fewer than {SMALL_SAMPLE} plays\n")
        fh.write(f"\nTonight vs baseline, depth at throw/sack/scramble: {diff:+.2f} yd "
                 f"(permutation p = {p_val:.3f}, {len(n_depths)} vs {len(b_depths)} plays)\n")
        fh.write(f"Takeaway: {takeaway}\n")
    print(open(stem + ".txt").read())
    print("wrote", stem + ".png")


if __name__ == "__main__":
    main()
