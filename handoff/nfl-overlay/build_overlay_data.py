"""Build an honest, descriptive replay payload from the supplied NFL CSV files.

Requires Python 3 and pandas. Example from the team repository:
python build_overlay_data.py --data-dir data --game 2021090900 --play 3793 --out gronkowski.json

No probabilities or automatic football blame are inferred. Coverage and credited
outcomes are retrospective PFF annotations. NFL tracking uses 10 frames/second;
this export's timestamp strings are rounded to whole seconds.
"""
import argparse
import json
import math
from pathlib import Path

import pandas as pd


def clean(value):
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if value is None or pd.isna(value):
        return None
    if hasattr(value, 'item'):
        return value.item()
    return value


def build(data_dir, game_id, play_id):
    data_dir = Path(data_dir)
    plays = pd.read_csv(data_dir / 'plays.csv')
    chosen = plays[(plays.gameId == game_id) & (plays.playId == play_id)]
    if len(chosen) != 1:
        raise ValueError('Expected exactly one matching play; use gameId AND playId.')
    meta = chosen.iloc[0]
    names = pd.read_csv(data_dir / 'players.csv')
    scout = pd.read_csv(data_dir / 'pffScoutingData.csv')
    scout = scout[(scout.gameId == game_id) & (scout.playId == play_id)]
    tracking_file = data_dir / 'tracking' / f'tracking_{game_id}.csv'
    if not tracking_file.exists():
        tracking_file = data_dir / f'tracking_{game_id}.csv'
    track = pd.read_csv(tracking_file)
    track = track[(track.gameId == game_id) & (track.playId == play_id)].copy()
    if track.empty:
        raise ValueError('No tracking frames for this play.')
    if track.duplicated(['frameId', 'nflId']).any():
        raise ValueError('Duplicate entities within a frame.')
    if names.duplicated('nflId').any() or scout.duplicated('nflId').any():
        raise ValueError('Non-unique player or scouting key.')
    if track.playDirection.nunique() != 1:
        raise ValueError('Inconsistent attack direction.')
    track = track.merge(names[['nflId', 'displayName']], on='nflId', how='left', validate='many_to_one')
    track = track.merge(scout, on=['gameId', 'playId', 'nflId'], how='left', validate='many_to_one')
    track['role'] = track.pff_role.str.casefold()
    events = track.dropna(subset=['event']).drop_duplicates(['frameId', 'event'])

    def event_frame(label):
        found = events.loc[events.event.eq(label), 'frameId'].unique()
        return int(found[0]) if len(found) == 1 else None

    snap, release, sack = (event_frame(e) for e in ['ball_snap', 'pass_forward', 'qb_sack'])
    direction = track.playDirection.iloc[0]
    sign = 1 if direction == 'right' else -1
    line_x = clean(meta.absoluteYardlineNumber)
    goal_x = 110 if sign == 1 else 10
    target_x = None if line_x is None else max(10, min(110, line_x + sign * meta.yardsToGo))
    frames = []
    for frame_id, frame in track.groupby('frameId', sort=True):
        defenders = frame[frame.team.eq(meta.defensiveTeam)]
        full_defense = len(defenders) == 11 and defenders[['x', 'y']].notna().all().all()
        passer = frame[frame.role.eq('pass') & frame.team.eq(meta.possessionTeam)]
        rushers = defenders[defenders.role.eq('pass rush')]
        qb_metric = None
        if len(passer) == 1 and full_defense and len(rushers):
            qb = passer.iloc[0]
            distances = ((rushers.x-qb.x)**2 + (rushers.y-qb.y)**2)**0.5
            if distances.notna().all():
                r = rushers.loc[distances.idxmin()]
                qb_metric = {'passerId': int(qb.nflId), 'nearestRusherId': int(r.nflId),
                             'distanceYards': float(distances.min())}
        entities = []
        for _, player in frame.iterrows():
            item = {'nflId': player.nflId, 'name': player.displayName, 'jersey': player.jerseyNumber,
                    'team': player.team, 'role': player.pff_role, 'x': player.x, 'y': player.y,
                    'speedYardsPerSecond': player.s, 'speedMph': player.s*3600/1760,
                    'accelerationYardsPerSecondSquared': player.a,
                    'directionDegrees': player.dir, 'orientationDegrees': player.o}
            if player.role == 'pass route' and player.team == meta.possessionTeam:
                item['nearestDefender'] = None
                if full_defense and pd.notna(player.x) and pd.notna(player.y):
                    distances = ((defenders.x-player.x)**2 + (defenders.y-player.y)**2)**0.5
                    near = defenders.loc[distances.idxmin()]
                    item['nearestDefender'] = {'nflId': int(near.nflId), 'name': near.displayName,
                                              'distanceYards': float(distances.min())}
                item['depthFromStartLineYards'] = None if line_x is None else sign*(player.x-line_x)
            entities.append(item)
        frames.append({'frameId': int(frame_id), 'secondsFromSnap': None if snap is None else (int(frame_id)-snap)/10,
                       'events': sorted(frame.event.dropna().unique().tolist()),
                       'playerCount': int(frame.team.ne('football').sum()),
                       'allDefendersAvailable': bool(full_defense),
                       'qbToNearestRusher': qb_metric, 'entities': entities})
    roles = scout.merge(names[['nflId','displayName']], on='nflId', how='left', validate='many_to_one')
    timing_valid = snap is not None and release is not None and release >= snap
    sack_valid = snap is not None and sack is not None and sack >= snap
    result = {
        'schemaVersion': 1, 'gameId': game_id, 'playId': play_id,
        'source': f'https://github.com/owenyanucl/wedobewinningtho/blob/main/data/tracking/tracking_{game_id}.csv',
        'units': {'position': 'yards', 'time': 'seconds', 'frameRateHz': 10},
        'coordinates': {'mode': 'raw dataset', 'attackDirection': direction, 'startLineX': line_x,
                        'firstDownTargetX': target_x, 'opponentGoalLineX': goal_x},
        'recordedPlay': meta.to_dict(),
        'potentialNoPlay': 'no play' in str(meta.playDescription).casefold(),
        'timing': {'snapFrame': snap, 'releaseFrame': release, 'sackFrame': sack,
                   'lastAvailableFrame': int(track.frameId.max()),
                   'snapToReleaseSeconds': (release-snap)/10 if timing_valid else None,
                   'snapToSackSeconds': (sack-snap)/10 if sack_valid else None},
        'retrospectiveScouting': roles.to_dict('records'),
        'frames': frames,
        'limitations': [
            'Historical reconstruction; no live feed or camera-to-field calibration is supplied.',
            'Nearest defender and nearest pass rusher are geometric measures, not assignments or probabilities.',
            'Use frame differences / 10 for timing; exported timestamps lack subsecond precision.',
            'Coverage and pressure-credit labels are retrospective. Do not represent them as pre-snap predictions.',
            'Catch and tackle tracking is generally unavailable in the inspected sample; stop at the actual last frame.',
            'Nullified plays and penalty effects need review before official-stat aggregation.',
            'Missing measurements remain null; frame completeness is exposed for the renderer.'
        ]
    }
    return clean(result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--game', type=int, required=True)
    parser.add_argument('--play', type=int, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = build(args.data_dir, args.game, args.play)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'file': str(args.out), 'frames': len(result['frames']), 'timing': result['timing']}))
