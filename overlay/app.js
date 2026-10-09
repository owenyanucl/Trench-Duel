(function () {
  'use strict';
  var T = window.TRENCH;
  if (!T) { document.getElementById('fatal').hidden = false; return; }
  // The streamer's controller (index.html) drives; the viewer page (viewer.html, what OBS captures) only follows
  // and shows the game view plus the Duel card the controller pushed.
  var VIEWER = window.TRENCH_MODE === 'viewer';

  var FPS = 10, LATENCY_MS = 2000, AFTER_HOLD_MS = 4000, PILL_STALE_MS = 10000;
  var TEAM = {
    ARI: '#97233F', ATL: '#A71930', BAL: '#5B3FB8', BUF: '#00338D', CAR: '#0085CA', CHI: '#C83803', CIN: '#FB4F14', CLE: '#FF3C00',
    DAL: '#2E5FB3', DEN: '#FB4F14', DET: '#0076B6', GB: '#FFB612', HOU: '#A71930', IND: '#1F5BA8', JAX: '#006778', KC: '#E31837',
    LA: '#2E5FB3', LAC: '#0080C6', LV: '#A5ACAF', MIA: '#008E97', MIN: '#6B3FB0', NE: '#1D3B6F', NO: '#D3BC8D', NYG: '#1F3C99',
    NYJ: '#E8E8E8', PHI: '#00818C', PIT: '#FFB612', SEA: '#69BE28', SF: '#AA0000', TB: '#D50A0A', TEN: '#4B92DB', WAS: '#7A1F1F'
  };
  var TEAM_NAME = {
    ARI: 'Arizona', ATL: 'Atlanta', BAL: 'Baltimore', BUF: 'Buffalo', CAR: 'Carolina', CHI: 'Chicago', CIN: 'Cincinnati', CLE: 'Cleveland',
    DAL: 'Dallas', DEN: 'Denver', DET: 'Detroit', GB: 'Green Bay', HOU: 'Houston', IND: 'Indianapolis', JAX: 'Jacksonville', KC: 'Kansas City',
    LA: 'The Rams', LAC: 'The Chargers', LV: 'Las Vegas', MIA: 'Miami', MIN: 'Minnesota', NE: 'New England', NO: 'New Orleans', NYG: 'The Giants',
    NYJ: 'The Jets', PHI: 'Philadelphia', PIT: 'Pittsburgh', SEA: 'Seattle', SF: 'San Francisco', TB: 'Tampa Bay', TEN: 'Tennessee', WAS: 'Washington'
  };
  var PILL_MAX = 140; // px: every pill is designed to fit this height; the field starts below it
  // Broadcast mode: real footage of one play in this game, shown behind the overlay.
  var BROADCAST = {
    playId: 2349,
    src: 'https://www.youtube-nocookie.com/embed/e7VpmQzDL4k?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&playlist=e7VpmQzDL4k&cc_load_policy=0&rel=0&modestbranding=1&end=22',
    tag: 'BROADCAST CLIP',
    label: 'Cleveland Browns YouTube · CLE @ MIN 2021 Wk 4, play shown: Q3 11:29, 3rd & 3',
    fileNotice: 'Broadcast mode needs a local server: <code>python3 -m http.server 8000 -d overlay</code>, then open <code>http://localhost:8000</code>'
  };
  var RESULT = { C: 'Complete', I: 'Incomplete', S: 'Sack', IN: 'Interception', R: 'Scramble' };
  var SUFFIX = { JR: 1, 'JR.': 1, SR: 1, 'SR.': 1, II: 1, III: 1, IV: 1, V: 1 };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function teamColor(t) { return TEAM[t] || '#888'; }
  function inkOn(hex) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111' : '#fff';
  }
  function P(id) { return T.players[id] || { name: 'Unknown', pos: '', team: '', jersey: '' }; }
  function parts(id) { return String(P(id).name).split(/\s+/); }
  function lastName(id) {
    var w = parts(id);
    while (w.length > 1 && SUFFIX[w[w.length - 1].toUpperCase()]) w.pop();
    return w[w.length - 1];
  }
  function shortName(id) { var w = parts(id); return w.length > 1 ? w[0][0] + '. ' + lastName(id) : w[0]; }
  function tagName(id) { return '#' + P(id).jersey + ' ' + shortName(id); }
  function ordinal(n) { return ['', '1st', '2nd', '3rd', '4th'][n] || n + 'th'; }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function oneIn(rate) { return rate > 0 ? Math.round(1 / rate) : '∞'; }
  function dist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
  function pairKey(r, b) { return r + '|' + b; }
  // Which alignment group a player's expected rate matches best: the label for the comparison.
  function alignOf(id) {
    var s = SEASON[id], by = LG.byAlign || league.byAlign || {}, e = s && s.expected, best = 'other', bd = 1e9;
    if (e == null) return best;
    Object.keys(by).forEach(function (k) { var d = Math.abs(by[k] - e); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  var ALIGN_PLURAL = { edge: 'edge rushers', interior: 'interior rushers', other: 'rushers from his spots' };
  var ALIGN_ONE = { edge: 'an edge rusher', interior: 'an interior rusher', other: 'a rusher from his spots' };
  // Season context never uses future games: only weeks before tonight.
  var SEASON = T.seasonToDate || {};
  var LG = T.league.toDate || {};
  var TEAMS = T.teamsToDate || {};
  var LG_TEAM = T.league.teamToDate || {};
  var toDateLabel = (function () {
    var w = T.meta.toDateWeeks;
    if (Array.isArray(w)) return w.length ? 'wks ' + (w.length > 1 ? w[0] + '–' + w[w.length - 1] : w[0]) : '';
    if (typeof w === 'number') return w > 0 ? 'wks 1–' + w : '';
    return w ? 'wks ' + w : '';
  })();
  var BEFORE = 'before tonight' + (toDateLabel ? ' (' + toDateLabel + ')' : '');
  function expectedOf(id) { var s = SEASON[id]; return s && s.expected != null ? s.expected : LG.repWinRate; }
  function cnt(n, of) { return '(' + n + ' of ' + of + ')'; }
  // a to-date figure is either {n, of} or a rate
  function rateOf(x) { return typeof x === 'number' ? x : x && x.of ? x.n / x.of : null; }
  function countOf(x) { return x && typeof x === 'object' && x.of != null ? cnt(x.n, x.of) : ''; }
  function num(n) { return Number(n).toLocaleString('en-US'); }
  function lgCount(x, sep) { return x && typeof x === 'object' && x.of ? ' (' + num(x.n) + (sep || '/') + num(x.of) + ')' : ''; }
  function arrow(v, lv) { return v == null || lv == null || Math.round(v * 100) === Math.round(lv * 100) ? '' : v > lv ? '<i class="mk up">▲</i>' : '<i class="mk down">▼</i>'; }
  function times(rate, exp) { return exp > 0 ? (rate / exp).toFixed(1) + '×' : '—'; }

  // ---------- derived game data ----------
  var plays = T.plays, league = T.league;
  var teams = [T.meta.away, T.meta.home];
  var duelPlayers = {}; // nflId -> true for every rusher/blocker in a duel this game
  var pairReps = {};
  plays.forEach(function (p) {
    p.duels.forEach(function (d) {
      duelPlayers[d.rusherId] = true; duelPlayers[d.blockerId] = true;
      var k = pairKey(d.rusherId, d.blockerId); pairReps[k] = (pairReps[k] || 0) + 1;
    });
  });
  // Headline matchup: the pair that meets most often in this game. Chosen by how often they meet, never by who won.
  var headline = Object.keys(pairReps).sort(function (a, b) { return pairReps[b] - pairReps[a]; })[0];

  // ---------- state ----------
  var S = {
    i: 0, frame: 0, playing: !VIEWER, last: 0, endAt: 0, afterAt: 0, after: false, openedAt: {}, pushed: null, clearedAt: 0,
    overlay: true, pills: { duel: false, pressure: false, team: false },
    selected: null, pair: null, team: null, bg: 'replay'
  };

  // ---------- duel logic (spoiler-safe: plays[0..S.i] only) ----------
  function isRusher(id) {
    var s = T.season[id]; if (s && s.role) return s.role === 'rusher';
    return plays.some(function (p) { return p.duels.some(function (d) { return d.rusherId == id; }); });
  }
  // Which of this play's duels to show: the pair that has met most often before this play.
  // Chosen from earlier plays only, so the pick never hints at this play's result.
  function bestDuel(list) {
    var met = {};
    for (var k = 0; k < S.i; k++) plays[k].duels.forEach(function (d) { var key = pairKey(d.rusherId, d.blockerId); met[key] = (met[key] || 0) + 1; });
    return list.slice().sort(function (a, b) {
      return (met[pairKey(b.rusherId, b.blockerId)] || 0) - (met[pairKey(a.rusherId, a.blockerId)] || 0);
    })[0] || null;
  }
  // Simulated live: PRE-SNAP, LIVE, then AFTER-PLAY, which starts LATENCY_MS after the last frame while playing,
  // or at once when paused on the last frame, opened on it by hash, or forced with phase=after.
  function lastFrame(p) { return p.nFrames - 1; }
  function phase() {
    var p = plays[S.i];
    if (S.after) return 'after';
    return S.frame < p.snapFrame ? 'pre' : 'live';
  }
  // Spoiler-safe: earlier plays always count; the play on screen counts only in AFTER-PLAY.
  // The tracking-based duel result is known DATA_LATENCY frames after the rule's window closes (the throw, the end of
  // tracking, or windowSec after the snap). Wall time spent at the last frame while playing counts as frames.
  var DATA_LATENCY_FRAMES = LATENCY_MS / 1000 * FPS;
  function readyFrame(p) { return Math.min(p.endFrame, p.snapFrame + league.windowSec * FPS) + DATA_LATENCY_FRAMES; }
  function effFrame() {
    var p = plays[S.i], last = lastFrame(p);
    if (S.frame < last || !S.playing || !S.endAt) return S.frame;
    return last + (performance.now() - S.endAt) * FPS / 1000;
  }
  function duelReady() {
    if (VIEWER && S.remoteReady != null) return S.remoteReady;
    return S.after || effFrame() >= readyFrame(plays[S.i]);
  }
  // Spoiler-safe: earlier plays always count; the play on screen counts once its tracking result is ready.
  function scored(k) { return k < S.i || (k === S.i && duelReady()); }
  function pairTally(r, b) {
    var reps = 0, wins = 0, seq = [];
    for (var k = 0; k <= S.i; k++) {
      if (!scored(k)) continue;
      plays[k].duels.forEach(function (d) {
        if (d.rusherId == r && d.blockerId == b) { reps++; if (d.rusherWon) wins++; seq.push({ w: d.rusherWon, now: k === S.i }); }
      });
    }
    return { reps: reps, wins: wins, seq: seq };
  }
  function playerTally(id, asRusher) {
    var reps = 0, wins = 0;
    for (var k = 0; k <= S.i; k++) {
      if (!scored(k)) continue;
      // one rep per play per player, even when double-teamed
      var mine = plays[k].duels.filter(function (d) { return asRusher ? d.rusherId == id : d.blockerId == id; });
      if (!mine.length) continue;
      reps++; if (mine.some(function (d) { return d.rusherWon; })) wins++;
    }
    return { reps: reps, wins: wins };
  }
  // The duel shown: { rusherId, blockerId, mode, onPlay (duel object on current play or null) }
  function currentDuel() {
    var play = plays[S.i];
    if (S.pair) {
      var pd = play.duels.filter(function (d) { return d.rusherId == S.pair.r && d.blockerId == S.pair.b; })[0] || null;
      return { rusherId: S.pair.r, blockerId: S.pair.b, mode: 'pair', onPlay: pd };
    }
    if (S.selected != null) {
      var id = S.selected;
      var mine = play.duels.filter(function (d) { return d.rusherId == id || d.blockerId == id; });
      if (mine.length) { var d = bestDuel(mine); return { rusherId: d.rusherId, blockerId: d.blockerId, mode: 'pinned', onPlay: d }; }
      // not in a duel this play: most frequent opponent so far tonight
      var cnt = {};
      for (var k = 0; k <= S.i; k++) plays[k].duels.forEach(function (d) {
        if (d.rusherId == id || d.blockerId == id) { var key = pairKey(d.rusherId, d.blockerId); cnt[key] = (cnt[key] || 0) + 1; }
      });
      var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
      if (!top) return { rusherId: null, blockerId: null, mode: 'pinned', onPlay: null, only: id };
      var rb = top.split('|');
      return { rusherId: +rb[0], blockerId: +rb[1], mode: 'pinned', onPlay: null };
    }
    var h = play.duels.filter(function (d) { return pairKey(d.rusherId, d.blockerId) === headline; })[0];
    if (h) return { rusherId: h.rusherId, blockerId: h.blockerId, mode: 'headline', onPlay: h };
    var b = bestDuel(play.duels);
    if (!b) return { rusherId: null, blockerId: null, mode: 'auto', onPlay: null };
    return { rusherId: b.rusherId, blockerId: b.blockerId, mode: 'auto', onPlay: b };
  }

  // ---------- canvas / field ----------
  var cv = $('field'), ctx = cv.getContext('2d'), dpr = 1, view = { s: 10, ox: 0, oy: 0 }, barH = 34;
  document.documentElement.style.setProperty('--pill-max', PILL_MAX + 'px');
  function resize() {
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    if (S.overlay && $('bar').offsetHeight) barH = $('bar').offsetHeight;
    // reserve a band for the bar and one row of pills so an open pill never covers the field
    var padX = 16, top = VIEWER ? 16 : innerWidth <= 760 ? 96 : 10 + barH + 6 + PILL_MAX + 8, bottom = innerWidth <= 760 ? 124 : 52;
    var s = Math.min((innerWidth - 2 * padX) / 120, (innerHeight - top - bottom) / 53.3);
    view.s = s;
    view.ox = (innerWidth - 120 * s) / 2;
    view.oy = top + ((innerHeight - top - bottom) - 53.3 * s) / 2;
    layoutVideo();
    if (!dragged) placeOverlayDefault();
    draw();
  }
  // Broadcast footage starts where the field starts, so open pills never cover it.
  // The iframe covers that band at 16:9 and is cropped, which also pushes YouTube's title bar and controls out of view.
  function layoutVideo() {
    var box = $('video'), f = box.firstChild, top = Math.round(view.oy), w = innerWidth, h = innerHeight - top;
    box.style.top = top + 'px';
    if (!f) return;
    var fw = Math.max(w, h * 16 / 9) * 1.08, fh = fw * 9 / 16;
    f.style.width = fw + 'px'; f.style.height = fh + 'px';
    f.style.left = (w - fw) / 2 + 'px'; f.style.top = (h - fh) / 2 + 'px';
  }
  // field y=53.3 is drawn at the top of the screen
  function X(x) { return view.ox + x * view.s; }
  function Y(y) { return view.oy + (53.3 - y) * view.s; }

  function drawField(play) {
    var s = view.s;
    ctx.fillStyle = '#0b1a10'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    for (var k = 0; k < 24; k++) {
      ctx.fillStyle = k % 2 ? '#2f7a3a' : '#2b7135';
      ctx.fillRect(X(k * 5), Y(53.3), 5 * s + 0.5, 53.3 * s);
    }
    // end zones: offense defends the left, attacks the right
    [[0, play.offense], [110, play.defense]].forEach(function (e) {
      ctx.fillStyle = '#1f5a2a'; ctx.fillRect(X(e[0]), Y(53.3), 10 * s, 53.3 * s);
      ctx.fillStyle = teamColor(e[1]); ctx.globalAlpha = 0.35; ctx.fillRect(X(e[0]), Y(53.3), 10 * s, 53.3 * s); ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(X(e[0] + 5), Y(26.65)); ctx.rotate(e[0] ? Math.PI / 2 : -Math.PI / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '800 ' + Math.round(s * 4.2) + 'px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e[1], 0, 0); ctx.restore();
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
    for (var x = 10; x <= 110; x += 5) {
      ctx.globalAlpha = x % 10 ? 0.45 : 0.8;
      ctx.beginPath(); ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(53.3)); ctx.stroke();
    }
    ctx.globalAlpha = 0.55;
    for (x = 11; x < 110; x++) {
      if (x % 5 === 0) continue;
      [[0, 0.7], [23.36, 0.7], [29.96, 0.7], [53.3 - 0.7, 0.7]].forEach(function (h) {
        ctx.beginPath(); ctx.moveTo(X(x), Y(h[0])); ctx.lineTo(X(x), Y(h[0] + h[1])); ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2; ctx.strokeRect(X(0), Y(53.3), 120 * s, 53.3 * s);
    // yard numbers
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '700 ' + Math.round(s * 2) + 'px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (x = 20; x <= 100; x += 10) {
      var n = String(x <= 60 ? x - 10 : 110 - x);
      ctx.fillText(n, X(x), Y(12));
      ctx.save(); ctx.translate(X(x), Y(41.3)); ctx.rotate(Math.PI); ctx.fillText(n, 0, 0); ctx.restore();
    }
    // line of scrimmage + line to gain
    var los = play.ball[0][0];
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(80,150,255,0.9)'; ctx.beginPath(); ctx.moveTo(X(los), Y(0)); ctx.lineTo(X(los), Y(53.3)); ctx.stroke();
    var ltg = los + play.yardsToGo;
    if (ltg < 110) { ctx.strokeStyle = 'rgba(255,214,0,0.9)'; ctx.beginPath(); ctx.moveTo(X(ltg), Y(0)); ctx.lineTo(X(ltg), Y(53.3)); ctx.stroke(); }
  }

  function lerpXY(arr, f) {
    var a = Math.floor(f), t = f - a, p = arr[Math.min(a, arr.length - 1)], q = arr[Math.min(a + 1, arr.length - 1)];
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  }
  function cssVar(name, fallback) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
  // inside the win line: the rusher's colour; near: the blocker's colour; far: neutral grey
  function pressureColor(d) {
    var thr = league.thresholdYds;
    if (d <= thr) return cssVar('--win', '#ff8a3d');
    if (d <= thr * 3) return cssVar('--hold', '#4fc3ff');
    return 'rgba(238,242,250,0.55)';
  }

  function drawPlayers(play, f) {
    var s = view.s, r = Math.max(5, s * 0.95), font = getComputedStyle(document.body).fontFamily;
    var pos = {};
    play.players.forEach(function (p) { pos[p.nflId] = lerpXY(p.xy, f); });
    var duel = S.overlay && S.pills.duel ? currentDuel() : null;
    var ringR = duel && duel.onPlay ? duel.rusherId : null, ringB = duel && duel.onPlay ? duel.blockerId : null;
    var ringOnly = duel && duel.only != null && pos[duel.only] ? duel.only : null;
    if (duel && !duel.onPlay && S.selected != null && pos[S.selected]) ringOnly = S.selected;

    // rusher -> QB line and tags only in AFTER-PLAY, as the replay of what happened; rings only before that
    var replayMarks = phase() === 'after';
    var qbDist = null, qbCol = null;
    if (replayMarks && ringR != null && pos[ringR] && pos[play.qbId]) {
      var a = pos[ringR], q = pos[play.qbId], d = dist(a, q), c = pressureColor(d);
      ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(q[0]), Y(q[1])); ctx.stroke(); ctx.setLineDash([]);
      qbDist = d; qbCol = c;
    }

    play.players.forEach(function (p) {
      var xy = pos[p.nflId], cx = X(xy[0]), cy = Y(xy[1]), col = teamColor(p.team);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = p.nflId == play.qbId ? 2.5 : 1.2;
      ctx.strokeStyle = p.team === play.offense ? '#ffffff' : '#111111'; ctx.stroke();
      ctx.fillStyle = inkOn(col); ctx.font = '700 ' + Math.max(8, Math.round(r * 1.05)) + 'px ' + font;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.jersey, cx, cy + 0.5);
    });
    // ball
    var b = lerpXY(play.ball, f);
    ctx.fillStyle = '#8b4a1c'; ctx.strokeStyle = '#f5e6d0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(X(b[0]), Y(b[1]), Math.max(3, s * 0.45), Math.max(2.2, s * 0.3), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // highlight rings, then name tags, on top of everything
    var hi = [ringB, ringR, ringOnly].filter(function (id) { return id != null && pos[id]; });
    hi.forEach(function (id) {
      ctx.strokeStyle = id == ringR ? cssVar('--win', '#ff8a3d') : id == ringB ? cssVar('--hold', '#4fc3ff') : cssVar('--accent', '#eef2fa');
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X(pos[id][0]), Y(pos[id][1]), r + 4, 0, Math.PI * 2); ctx.stroke();
    });
    // the rusher's tag goes on the side away from the blocker, the blocker's on the other side
    var rusherAbove = !(ringR != null && ringB != null && pos[ringR] && pos[ringB]) || Y(pos[ringR][1]) <= Y(pos[ringB][1]);
    if (!replayMarks) return;
    hi.forEach(function (id) {
      var cx = X(pos[id][0]), cy = Y(pos[id][1]), isR = id == ringR;
      var above = isR ? rusherAbove : id == ringB ? !rusherAbove : false;
      var label = lastName(id) + (isR && qbDist != null ? ' · ' + qbDist.toFixed(1) + ' yd to QB at the end' : '');
      ctx.font = '700 11px ' + font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var w = ctx.measureText(label).width + 12, ly = above ? cy - r - 26 : cy + r + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; roundRect(cx - w / 2, ly, w, 16, 8); ctx.fill();
      ctx.fillStyle = isR && qbCol ? qbCol : '#fff'; ctx.fillText(label, cx, ly + 8.5);
    });
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw() {
    var play = plays[S.i];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawField(play);
    drawPlayers(play, S.frame);
  }

  // ---------- game chrome ----------
  function teamVars(t) { return '--team:' + teamColor(t) + ';--team-ink:' + inkOn(teamColor(t)); }
  function chip(t) { return '<span class="sb-team team-' + esc(t) + '" style="' + teamVars(t) + '">' + esc(t) + '</span>'; }
  function renderChrome() {
    var p = plays[S.i];
    $('sbTeams').innerHTML = chip(p.offense) + '<span class="sb-vs">vs</span>' + chip(p.defense);
    $('sbQtr').textContent = 'Q' + p.quarter;
    $('sbClock').textContent = p.clock;
    $('sbDown').textContent = ordinal(p.down) + ' & ' + p.yardsToGo;
    $('sbPlay').textContent = 'Play ' + (S.i + 1) + '/' + plays.length;
    $('btnPlay').innerHTML = S.playing ? '&#10073;&#10073;' : '&#9654;';
    $('btnHide').textContent = S.overlay ? 'Hide all' : 'Show overlay';
  }
  function renderTick() {
    var p = plays[S.i];
    var t = (S.frame - p.snapFrame) / FPS;
    $('tClock').textContent = (t < 0 ? 'pre-snap ' : '+') + Math.abs(t).toFixed(1) + 's';
    var done = phase() === 'after';
    $('playResult').textContent = done ? (RESULT[p.passResult] || p.passResult) : '';
    $('playResult').classList.toggle('bad', done && (p.passResult === 'S' || p.passResult === 'IN'));
  }

  // ---------- overlay: bar ----------
  var overlay = $('overlay'), picker = $('picker');
  function renderChips() {
    var box = $('chips'); box.innerHTML = '';
    teams.forEach(function (t) {
      var b = el('button', 'chip', esc(t));
      b.setAttribute('style', teamVars(t)); b.classList.add('team-' + t);
      b.title = TEAM_NAME[t] ? TEAM_NAME[t] + ': team pill, players filtered to ' + t : t;
      var focus = teamFocus();
      if (focus === t) b.classList.add('active');
      else if (focus) b.classList.add('dim');
      b.onclick = function () { setTeam(teamFocus() === t ? null : t); };
      box.appendChild(b);
    });
  }
  function teamFocus() { return S.pills.team ? S.team : null; }
  function touch(k) { if (S.pills[k]) S.openedAt[k] = performance.now(); }
  function setTeam(t) {
    S.team = t; S.pills.team = !!t; touch('team');
    renderChips(); renderPicker(); renderOverlay();
  }
  function renderPicker() {
    picker.innerHTML = '';
    var auto = el('option', null, 'Player…'); auto.value = ''; picker.appendChild(auto);
    teams.filter(function (t) { return !teamFocus() || teamFocus() === t; }).forEach(function (t) {
      var ids = Object.keys(duelPlayers).filter(function (id) { return P(id).team === t; });
      var rush = ids.filter(isRusher), block = ids.filter(function (id) { return !isRusher(id); });
      [['rushers', rush], ['blockers', block]].forEach(function (g) {
        if (!g[1].length) return;
        var og = el('optgroup'); og.label = t + ' ' + g[0];
        g[1].sort(function (a, b) { return P(a).jersey - P(b).jersey; }).forEach(function (id) {
          var o = el('option', null, esc('#' + P(id).jersey + ' ' + shortName(id) + ' · ' + P(id).pos)); o.value = id; og.appendChild(o);
        });
        picker.appendChild(og);
      });
    });
    picker.value = S.selected != null ? String(S.selected) : '';
    if (picker.value !== (S.selected != null ? String(S.selected) : '')) picker.value = '';
  }
  picker.addEventListener('change', function () {
    S.selected = picker.value ? +picker.value : null; S.pair = null;
    if (S.selected != null) { S.pills.duel = true; touch('duel'); }
    picker.blur(); renderOverlay(); draw();
  });
  document.querySelectorAll('.icon-btn[data-pill]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-pill');
      if (k === 'team') { setTeam(S.pills.team ? null : (S.team || plays[S.i].defense)); return; }
      S.pills[k] = !S.pills[k]; touch(k); renderOverlay(); draw();
    });
  });
  // Suggested matchup: the pair that meets most often in this game. Nothing is selected until it is clicked.
  var hl = headline ? headline.split('|').map(Number) : null;
  if (hl) $('suggest').innerHTML = '<span>Suggested</span> ' + esc(lastName(hl[0])) + ' vs ' + esc(lastName(hl[1]));
  else $('suggest').hidden = true;
  $('suggest').addEventListener('click', function () {
    S.pair = { r: hl[0], b: hl[1] }; S.selected = null; S.pills.duel = true; touch('duel');
    renderPicker(); renderOverlay(); draw();
  });
  $('barClose').addEventListener('click', hideAll);
  $('btnHide').addEventListener('click', function () { if (S.overlay) hideAll(); else showOverlay(); });

  // ---------- overlay: pills ----------
  function duelLine(r, b, t) {
    var rL = esc(lastName(r)), bL = esc(lastName(b)), exp = expectedOf(r);
    var avg = exp ? '; ' + ALIGN_PLURAL[alignOf(r)] + ' averaged 1 in ' + oneIn(exp) + ' before tonight' : '';
    var reps = t.reps + ' rep' + (t.reps > 1 ? 's' : '');
    if (t.reps === 0) return rL + ' and ' + bL + ' have not met yet tonight.';
    if (t.wins === 0) return bL + ' has stonewalled ' + rL + (t.reps === 1 ? ' on their only rep' : ' on all ' + reps) + ' tonight' + avg + '.';
    return rL + ' has beaten ' + bL + ' on ' + t.wins + ' of ' + reps + ' tonight' + avg + '.';
  }
  function isPushed(r, b) { return !!S.pushed && S.pushed.rusherId == r && S.pushed.blockerId == b; }
  function renderDuel() {
    var box = $('pill-duel');
    var d = currentDuel();
    var head = '<div class="pill-head"><span>Trench duel · <span class="tag">' +
      (d.mode === 'pinned' ? 'your pick' : d.mode === 'pair' || d.mode === 'headline' ? 'suggested matchup' : 'most-met pair this play') + '</span></span>' +
      '<span>win = ≤' + league.thresholdYds + ' yd in ' + league.windowSec + 's' +
      (S.selected != null || S.pair ? ' <button data-act="auto">Clear ✕</button>' : '') +
      (d.rusherId != null ? ' <button id="pushDuel" class="push-btn' + (isPushed(d.rusherId, d.blockerId) ? ' on' : '') + '" data-act="push"' + (phase() === 'live' ? ' disabled title="Available after the play"' : '') + '>' + (isPushed(d.rusherId, d.blockerId) ? 'On air · Pull' : 'Push to stream') + '</button>' : '') +
      '</span></div>';
    if (d.rusherId == null) {
      var who = d.only != null ? esc(tagName(d.only)) + ' has no trench reps yet tonight.' : 'No pass-rush duels on this play.';
      box.innerHTML = head + '<div class="muted">' + who + '</div>';
      return;
    }
    var r = d.rusherId, b = d.blockerId, t = pairTally(r, b);
    var rL = esc(lastName(r)), bL = esc(lastName(b));
    var rAlign = alignOf(r), exp = expectedOf(r);
    var line = duelLine(r, b, t);
    var thisRep = !d.onPlay ? '<span>not matched</span>'
      : !scored(S.i) ? '<b class="pending">pending</b>'
      : d.onPlay.rusherWon ? '<b class="r">rusher won</b>' : '<b class="b">blocker held</b>';
    var sr = SEASON[r], sb = SEASON[b];
    var rt = playerTally(r, true), bt = playerTally(b, false);
    var dots = t.seq.map(function (x) { return '<i class="dot' + (x.w ? ' w' : '') + (x.now ? ' now' : '') + '"></i>'; }).join('');
    var rSeason = sr && sr.reps ? 'wins <b>' + pct(sr.wins / sr.reps) + '</b> (' + sr.wins + '/' + sr.reps + ')' + (exp ? ' · <b>' + times(sr.wins / sr.reps, exp) + '</b> exp. for ' + ALIGN_ONE[rAlign].replace(/^an? /, '') : '') : 'No earlier games yet';
    var bExp = expectedOf(b);
    var bSeason = sb && sb.reps ? 'loses <b>' + pct(sb.wins / sb.reps) + '</b> (' + sb.wins + '/' + sb.reps + ')' + (bExp ? ' · <b>' + times(sb.wins / sb.reps, bExp) + '</b> exp. vs rushers faced' : '') : 'No earlier games yet';
    box.innerHTML = head +
      '<div class="duel-grid"><div>' +
      '<div class="matchup"><span class="r">' + esc(tagName(r)) + '</span><span class="vs">vs</span><span class="b">' + esc(tagName(b)) + '</span></div>' +
      '<div class="tally"><div class="score"><span class="r">' + rL + ' <em>' + t.wins + '</em></span><em>–</em><span class="b"><em>' + (t.reps - t.wins) + '</em> ' + bL + '</span></div>' +
      '<div class="who">' + t.reps + ' rep' + (t.reps === 1 ? '' : 's') + ' · this play: ' + thisRep + '</div></div>' +
      '<div class="dots" title="Each rep tonight, oldest first. Orange = rusher won, blue = blocker held.">' + dots + '</div>' +
      '</div><div class="oneliner">' + line + '</div></div>' +
      '<div class="ctx">' +
      '<div title="Tonight vs all blockers: ' + rt.wins + ' of ' + rt.reps + '"><span class="r">●</span> <b>' + rL + '</b> <span class="ctx-k">' + BEFORE + '</span> ' + rSeason + '</div>' +
      '<div title="Tonight vs all rushers: lost ' + bt.wins + ' of ' + bt.reps + '"><span class="b">●</span> <b>' + bL + '</b> <span class="ctx-k">' + BEFORE + '</span> ' + bSeason + '</div>' +
      '</div>';
  }
  // The play's pressure story from PFF-charted events: the most serious event (sack, then hit, then hurry), earliest first.
  var EVENT_RANK = { sack: 0, hit: 1, hurry: 2 };
  function pressureStory(play) {
    var ev = (play.pressureEvents || []).slice().sort(function (a, b) {
      return ((EVENT_RANK[a.type] == null ? 9 : EVENT_RANK[a.type]) - (EVENT_RANK[b.type] == null ? 9 : EVENT_RANK[b.type])) || ((a.seconds == null ? 99 : a.seconds) - (b.seconds == null ? 99 : b.seconds));
    });
    if (!ev.length) return null;
    var e = ev[0], secs = e.seconds != null ? e.seconds.toFixed(1) + ' s' : '';
    var full = P(e.rusherId).name || ('#' + e.jersey), last = e.rusherId != null ? lastName(e.rusherId) : full;
    var jersey = '#' + (e.jersey != null ? e.jersey : P(e.rusherId).jersey);
    // sacks are timed to the sack; hits and hurries to when the ball came out
    var when = !secs ? '' : e.type === 'sack' ? ' in ' + secs : ' · ball out at ' + secs;
    var text = e.blockerId != null || e.blockerPos
      ? jersey + ' ' + full + ' beat the ' + (e.blockerPos || shortName(e.blockerId)) + ' — ' + e.type + when
      : e.chargedElsewhere
        ? jersey + ' ' + full + ' ' + e.type + when
        : e.type === 'sack' && secs
          ? jersey + ' ' + last + ' sack — QB held it ' + secs + ', no blocker charged'
          : jersey + ' ' + last + ' ' + e.type + when + ' — no blocker charged';
    return { e: e, text: text, more: ev.length - 1, short: jersey + ' ' + e.type + (secs ? ' · ' + secs : ''),
      big: e.type === 'sack' || e.type === 'hit' };
  }
  function renderPressure() {
    var box = $('pill-pressure'), play = plays[S.i];
    var after = phase() === 'after';
    if (!after && !duelReady()) {
      box.innerHTML = '<div class="pill-head"><span>Pressure · this play</span><span>PFF-charted</span></div>' +
        '<div class="muted">' + (phase() === 'pre' ? 'Result ~2 s after the play.' : 'Live play: result in ~2 s after the whistle.') + '</div>';
      return;
    }
    var st = after ? pressureStory(play) : null;
    var head = '<div class="pill-head"><span>Pressure · this play</span><span>PFF-charted</span></div>';
    var story = !after
      ? '<div class="pr-top">Charted pressure after the play</div>'
      : st
        ? '<div class="pr-top">' + esc(st.text) + (st.more ? ' <span class="pr-sub">+' + st.more + ' more</span>' : '') + '</div>'
        : '<div class="pr-top">No charted pressure' + (play.timeToThrow != null ? ' — ball out in ' + play.timeToThrow.toFixed(1) + ' s' : '') + '</div>';
    if (!play.duels.length) { box.innerHTML = head + story; return; }
    // tracking-based closest-rusher bars, one row per rusher (double teams collapse)
    var rows = {}, order = [];
    play.duels.forEach(function (d) {
      if (!rows[d.rusherId]) { rows[d.rusherId] = { r: d.rusherId, b: [], d: d }; order.push(d.rusherId); }
      rows[d.rusherId].b.push(d.blockerId);
    });
    order.sort(function (a, b) { return rows[a].d.closestYds - rows[b].d.closestYds; });
    var top = rows[order[0]].d;
    var tp = top.secToPressure != null
      ? '≤' + league.thresholdYds + ' yd at <b>' + top.secToPressure.toFixed(1) + 's</b>'
      : 'never ≤' + league.thresholdYds + ' yd';
    var MAX = 10, sel = currentDuel();
    var bars = order.map(function (id) {
      var x = rows[id], d = x.d, w = Math.max(4, (1 - Math.min(d.closestYds, MAX) / MAX) * 100);
      var dbl = x.b.length > 1 ? ' ×' + x.b.length : '';
      return '<div class="barrow' + (sel.rusherId == id ? ' sel' : '') + '" data-id="' + id + '" title="vs ' + esc(x.b.map(shortName).join(' + ')) + '">' +
        '<span class="nm">' + esc(lastName(id)) + dbl + '</span>' +
        '<span class="track"><span class="fill' + (d.rusherWon ? ' w' : '') + '" style="width:' + w + '%"></span>' +
        '<span class="thr" style="left:' + (1 - league.thresholdYds / MAX) * 100 + '%"></span></span>' +
        '<span class="v">' + d.closestYds.toFixed(1) + '</span></div>';
    }).join('');
    box.innerHTML = head + story +
      '<div class="pr-sub" title="Tracking: closest approach to the QB in the first ' + league.windowSec + ' s or until the throw">Tracking: <b>' + esc(lastName(top.rusherId)) + '</b> closest, ' + top.closestYds.toFixed(1) + ' yd · ' + tp + '</div>' +
      '<div class="bars" title="Bar = how close each rusher got to the QB in the first ' + league.windowSec + 's or until the throw/sack (longer = closer)">' + bars + '</div>';
    box.querySelectorAll('.barrow').forEach(function (row) {
      row.onclick = function () { S.selected = +row.getAttribute('data-id'); renderPicker(); renderOverlay(); draw(); };
    });
  }
  // the Pressure button: its short label and a subtle suggestion after a sack or hit (never auto-opens)
  function renderPressureButton() {
    var btn = document.querySelector('.icon-btn[data-pill=pressure]'), span = btn && btn.querySelector('span');
    if (!btn) return;
    var st = phase() === 'after' ? pressureStory(plays[S.i]) : null;
    if (span) span.textContent = st ? st.short : 'Pressure';
    btn.classList.toggle('suggested', !!(st && st.big) && !S.pills.pressure);
  }

  // ---------- bar slots: situation, offense look, defense ----------
  var slots = (function () {
    var box = el('div', 'slots');
    [['sit', 'Situation'], ['off', 'Offense'], ['def', 'Defense']].forEach(function (k) {
      var sl = el('span', 'slot slot-' + k[0]); sl.title = k[1];
      sl.innerHTML = '<span class="slot-v"></span>';
      box.appendChild(sl);
    });
    var bar = $('bar'), first = bar.querySelector('.icon-btn[data-pill]');
    bar.insertBefore(box, first);
    return box;
  })();
  function isThirdLong(p) { return p.down === 3 && p.yardsToGo >= 7; }
  function defenseLook(p) {
    var d = TEAMS[p.defense];
    if (!d) return 'No earlier games yet';
    var src = d.defense || d;
    var k = isThirdLong(p) && src.thirdLongBlitz ? 'thirdLongBlitz' : 'blitz', v = src[k];
    if (!v || !v.of) return 'No earlier games yet';
    return 'Blitz ' + (k === 'thirdLongBlitz' ? '3rd&long ' : '') + v.n + ' of ' + v.of;
  }
  function renderSlots() {
    var p = plays[S.i], ph = phase();
    var set = function (k, v) { slots.querySelector('.slot-' + k + ' .slot-v').textContent = v; };
    set('sit', ordinal(p.down) + ' & ' + p.yardsToGo + ' · Q' + p.quarter + ' ' + p.clock + ' · ' + p.offense + ' ball');
    if (ph === 'after') {
      var med = TEAMS[p.offense] && TEAMS[p.offense].offense && TEAMS[p.offense].offense.timeToThrowMedian;
      set('off', p.timeToThrow != null ? 'Ball out ' + p.timeToThrow.toFixed(1) + ' s' + (typeof med === 'number' ? ' · med ' + med.toFixed(2) : '') : 'No throw');
      set('def', p.rushers != null ? p.rushers + ' rushed / ' + (p.blockers != null ? p.blockers : '—') + ' blocked' : '—');
    } else {
      // pre-snap look; unchanged through LIVE
      set('off', [p.personnel, p.formation, p.box != null ? 'Box ' + p.box : null].filter(Boolean).join(' · ') || '—');
      set('def', defenseLook(p));
    }
  }
  var TEAM_LINES = {
    thirdLongBlitz: function (n, x, c, y) { return n + ' blitzes on ' + x + ' of 3rd-and-long ' + c + ', league average ' + y + '.'; },
    blitz: function (n, x, c, y) { return n + ' blitzes on ' + x + ' of dropbacks ' + c + ', league average ' + y + '.'; },
    man: function (n, x, c, y) { return n + ' plays man coverage on ' + x + ' of man-or-zone dropbacks ' + c + ', league average ' + y + '.'; },
    pressure: function (n, x, c, y) { return n + ' pressures the QB on ' + x + ' of dropbacks ' + c + ', league average ' + y + '.'; },
    sack: function (n, x, c, y) { return n + ' sacks the QB on ' + x + ' of dropbacks ' + c + ', league average ' + y + '.'; }
  };
  function tget(obj, k) { return obj ? (obj[k] != null ? obj[k] : obj.defense && obj.defense[k] != null ? obj.defense[k] : obj.offense ? obj.offense[k] : null) : null; }
  function renderTeam() {
    var box = $('pill-team'), t = S.team, data = TEAMS[t];
    var name = TEAM_NAME[t] || t;
    var head = '<div class="pill-head"><span><b class="team-dot team-' + esc(t) + '" style="' + teamVars(t) + '"></b>' + esc(t) + ' · <span class="tag">team</span> · ' + BEFORE + '</span><span>vs league</span></div>';
    if (!data) { box.innerHTML = head + '<div class="muted">No earlier games yet.</div>'; return; }
    // the ready-to-read line: the tendency furthest from league average, relative to the league figure.
    // Blitzing less yet pressuring more (or the reverse) is one story, scored by both gaps together.
    var pick = null, best = 0, line = '';
    Object.keys(TEAM_LINES).forEach(function (k) {
      var v = rateOf(tget(data, k)), lv = rateOf(tget(LG_TEAM, k));
      if (v == null || !lv) return;
      var gap = Math.abs(v / lv - 1);
      if (gap > best) { best = gap; pick = k; }
    });
    if (pick) line = TEAM_LINES[pick](name, pct(rateOf(tget(data, pick))), countOf(tget(data, pick)), pct(rateOf(tget(LG_TEAM, pick))) + lgCount(tget(LG_TEAM, pick), ' of '));
    var B = tget(data, 'blitz'), Pr = tget(data, 'pressure'), lb = rateOf(tget(LG_TEAM, 'blitz')), lp = rateOf(tget(LG_TEAM, 'pressure'));
    if (rateOf(B) != null && rateOf(Pr) != null && lb && lp) {
      var bg = rateOf(B) / lb - 1, pg = rateOf(Pr) / lp - 1;
      if (bg * pg < 0 && Math.abs(bg) + Math.abs(pg) > best) {
        line = bg < 0
          ? name + ' blitzes less than average (' + pct(rateOf(B)) + ' ' + countOf(B) + ' vs ' + pct(lb) + lgCount(tget(LG_TEAM, 'blitz'), ' of ') + ') but still pressures on ' + pct(rateOf(Pr)) + ' of dropbacks ' + countOf(Pr) + '.'
          : name + ' blitzes more than average (' + pct(rateOf(B)) + ' ' + countOf(B) + ' vs ' + pct(lb) + lgCount(tget(LG_TEAM, 'blitz'), ' of ') + ') but pressures on only ' + pct(rateOf(Pr)) + ' of dropbacks ' + countOf(Pr) + '.';
      }
    }
    function stat(label, short, k) {
      var x = tget(data, k), v = rateOf(x), lv = rateOf(tget(LG_TEAM, k));
      if (v == null) return '';
      return '<div class="st" title="' + esc(label) + ': ' + pct(v) + (x && x.of ? ' (' + x.n + ' of ' + x.of + ')' : '') + (lv != null ? ', league ' + pct(lv) + lgCount(tget(LG_TEAM, k), ' of ') : '') + '"><span class="sl">' + short + '</span><b class="sv">' + pct(v) + '</b>' +
        (x && x.of ? '<span class="ct">' + x.n + '/' + x.of + '</span>' : '') + arrow(v, lv) + (lv != null ? '<span class="lg" title="League ' + pct(lv) + lgCount(tget(LG_TEAM, k), ' of ') + '">lg ' + pct(lv) + '</span>' : '') + '</div>';
    }
    var covs = tget(data, 'coverages') || [];
    // coverages share one denominator, so it is shown once: "Cov. of 93: Quarters 37% (34) · …"
    var top3 = covs.slice(0, 3), ofs = top3.map(function (c) { return c.of; });
    var sameOf = ofs.length && ofs.every(function (o) { return o && o === ofs[0]; });
    var cov = top3.map(function (c) {
      var r = c.of ? c.n / c.of : c.share;
      return esc(c.name) + ' <b>' + pct(r) + '</b>' + (c.of ? (sameOf ? ' (' + c.n + ')' : ' ' + c.n + '/' + c.of) : '');
    }).join(' · ');
    var covLabel = sameOf ? 'Cov. of ' + ofs[0] : 'Coverages';
    box.innerHTML = head +
      (line ? '<div class="oneliner">' + esc(line) + '</div>' : '') +
      '<div class="stats">' +
      stat('Blitz', 'Blitz', 'blitz') + stat('3rd-and-long blitz', '3rd&L', 'thirdLongBlitz') + stat('Pressure', 'Press.', 'pressure') +
      stat('Man coverage (vs zone)', 'Man', 'man') + stat('Sack', 'Sack', 'sack') + stat('Offense: pressure allowed', 'Off. press.', 'pressureAllowed') +
      '</div>' +
      (cov ? '<div class="cov"><span class="sl">' + covLabel + '</span> ' + cov + '</div>' : '');
  }
  $('pill-duel').addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'auto') { S.selected = null; S.pair = null; renderPicker(); renderOverlay(); draw(); }
    if (act === 'push') {
      var d = currentDuel();
      S.pushed = isPushed(d.rusherId, d.blockerId) ? null : { kind: 'duel', rusherId: d.rusherId, blockerId: d.blockerId };
      S.clearedAt = 0; renderOverlay();
    }
  });

  // ---------- stream: controller -> viewer ----------
  var chan = null;
  try { chan = new BroadcastChannel('trench-duel'); } catch (err) { chan = null; }
  function postState() {
    if (VIEWER || !chan) return;
    chan.postMessage({ type: 'state', play: S.i + 1, frame: S.frame, phase: phase(), ready: duelReady(), playing: S.playing, bg: S.bg, pushed: S.pushed });
  }
  var onAir = el('span', 'on-air'); onAir.id = 'onAir'; onAir.hidden = true;
  $('bar').insertBefore(onAir, $('bar').querySelector('.slots') || $('bar').querySelector('.icon-btn[data-pill]'));
  var CLEARED_NOTE_MS = 2500;
  function renderOnAir() {
    if (S.pushed) { onAir.textContent = 'ON AIR: ' + lastName(S.pushed.rusherId) + ' vs ' + lastName(S.pushed.blockerId); onAir.hidden = false; onAir.classList.remove('cleared'); }
    else if (S.clearedAt && performance.now() - S.clearedAt < CLEARED_NOTE_MS) { onAir.textContent = 'Cleared at snap'; onAir.hidden = false; onAir.classList.add('cleared'); }
    else { onAir.hidden = true; onAir.classList.remove('cleared'); }
  }
  // viewer: the pushed Duel card, with the same spoiler-safe tally as the controller
  function renderViewerCard() {
    var card = $('viewerCard');
    if (!card) return;
    if (!S.pushed) { card.style.display = 'none'; card.innerHTML = ''; return; }
    var r = S.pushed.rusherId, b = S.pushed.blockerId, t = pairTally(r, b);
    card.innerHTML =
      '<div class="vc-head"><span class="vc-r">' + esc(tagName(r)) + '</span><span class="vc-vs">vs</span><span class="vc-b">' + esc(tagName(b)) + '</span></div>' +
      '<div class="vc-tally"><span class="vc-n">' + t.wins + '</span> – <span class="vc-n">' + (t.reps - t.wins) + '</span> <span class="vc-reps">' + t.reps + ' rep' + (t.reps === 1 ? '' : 's') + '</span></div>' +
      '<div class="vc-line">' + duelLine(r, b, t) + '</div>' +
      '<div class="vc-dots">' + t.seq.map(function (x) { return '<i class="dot ' + (x.w ? 'win' : 'hold') + '"></i>'; }).join('') + '</div>' +
      '<div class="vc-src">Tracking: within ' + league.thresholdYds + ' yd of the QB inside ' + league.windowSec + ' s · ' + BEFORE + ' context</div>';
    card.style.display = '';
  }
  function applyRemote(m) {
    if (!m || m.type !== 'state') return;
    if (m.bg && m.bg !== S.bg) setBg(m.bg);
    var idx = Math.max(0, Math.min(plays.length - 1, (m.play || 1) - 1));
    if (idx !== S.i) gotoPlay(idx);
    S.frame = Math.max(0, Math.min(lastFrame(plays[S.i]), +m.frame || 0));
    S.after = m.phase === 'after'; S.playing = false; S.remoteReady = m.ready != null ? !!m.ready : null;
    S.pushed = m.pushed || null;
    renderOverlay(); renderTick(); draw();
  }

  function renderOverlay() {
    if (VIEWER) { renderChrome(); renderViewerCard(); return; }
    overlay.classList.toggle('hidden', !S.overlay);
    document.querySelectorAll('.icon-btn[data-pill]').forEach(function (b) { b.classList.toggle('on', !!S.pills[b.getAttribute('data-pill')]); });
    $('pill-duel').classList.toggle('open', S.pills.duel);
    $('pill-pressure').classList.toggle('open', S.pills.pressure);
    $('pill-team').classList.toggle('open', S.pills.team && !!S.team);
    $('suggest').classList.toggle('on', S.pills.duel && S.selected == null && (!!S.pair || currentDuel().mode === 'headline'));
    if (S.overlay && S.pills.duel) renderDuel();
    if (S.overlay && S.pills.pressure) renderPressure();
    if (S.overlay && S.pills.team && S.team) renderTeam();
    renderSlots(); renderPressureButton(); renderOnAir();
    renderChrome();
    if (!dragged) placeOverlayDefault();
    postState();
  }
  function hideAll() {
    // the panic button also pulls whatever is on the stream
    S.overlay = false; S.pills.duel = false; S.pills.pressure = false; S.pills.team = false; S.team = null; S.pushed = null;
    renderChips(); renderPicker(); renderOverlay(); draw();
  }
  function showOverlay() { S.overlay = true; renderOverlay(); draw(); }

  // ---------- drag ----------
  var dragged = false;
  function placeOverlayDefault() {
    overlay.style.left = Math.max(8, (innerWidth - overlay.offsetWidth) / 2) + 'px';
    overlay.style.top = '10px';
  }
  (function () {
    var h = $('handle'), sx, sy, ox, oy, on = false;
    h.addEventListener('pointerdown', function (e) {
      on = true; h.setPointerCapture(e.pointerId); document.body.classList.add('dragging');
      sx = e.clientX; sy = e.clientY; ox = overlay.offsetLeft; oy = overlay.offsetTop; e.preventDefault();
    });
    h.addEventListener('pointermove', function (e) {
      if (!on) return; dragged = true;
      var nx = Math.min(Math.max(0, ox + e.clientX - sx), innerWidth - 60);
      var ny = Math.min(Math.max(0, oy + e.clientY - sy), innerHeight - 40);
      overlay.style.left = nx + 'px'; overlay.style.top = ny + 'px';
    });
    function up() { on = false; document.body.classList.remove('dragging'); }
    h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    h.addEventListener('dblclick', function () { dragged = false; placeOverlayDefault(); });
  })();

  // ---------- canvas click: pick a player ----------
  cv.addEventListener('click', function (e) {
    if (VIEWER || !S.overlay || S.bg === 'video') return;
    var play = plays[S.i], best = null, bd = 1e9;
    play.players.forEach(function (p) {
      var xy = lerpXY(p.xy, S.frame), d = Math.hypot(X(xy[0]) - e.clientX, Y(xy[1]) - e.clientY);
      if (d < bd) { bd = d; best = p.nflId; }
    });
    if (best != null && bd < Math.max(14, view.s * 1.6) && duelPlayers[best]) {
      S.selected = best; S.pills.duel = true; renderPicker(); renderOverlay(); draw();
    }
  });

  // ---------- playback ----------
  function gotoPlay(i) {
    S.i = (i + plays.length) % plays.length; S.frame = 0; S.endAt = 0; S.afterAt = 0; S.after = false;
    lastPhase = phase();
    renderOverlay(); renderTick(); draw();
  }
  // AFTER-PLAY: the result is out; the play now counts and the overlay shows what happened
  function enterAfter(ts) {
    S.after = true; S.afterAt = ts || performance.now(); S.frame = lastFrame(plays[S.i]);
    onPhase();
  }
  function togglePlay() {
    S.playing = !S.playing;
    var p = plays[S.i];
    if (!S.playing && !S.after && S.frame >= lastFrame(p)) enterAfter();
    else if (S.playing && S.after) { S.frame = 0; S.endAt = 0; S.after = false; onPhase(); }
    renderChrome();
  }
  // Re-render only when the phase changes, so nothing in the overlay moves during LIVE.
  var lastPhase = null;
  function onPhase() {
    var ph = phase();
    if (ph === lastPhase) return;
    var prev = lastPhase; lastPhase = ph;
    // the pushed card comes off the stream the moment the next play goes live
    if (ph === 'live' && S.pushed && !VIEWER) {
      S.pushed = null; S.clearedAt = performance.now();
      setTimeout(renderOnAir, CLEARED_NOTE_MS + 50);
    }
    // at the snap, pills the streamer opened more than PILL_STALE_MS ago fold away while the replay plays
    if (prev === 'pre' && ph === 'live' && S.playing) {
      var now = performance.now();
      ['duel', 'pressure', 'team'].forEach(function (k) {
        if (S.pills[k] && now - (S.openedAt[k] || 0) > PILL_STALE_MS) { S.pills[k] = false; if (k === 'team') S.team = null; }
      });
      renderChips(); renderPicker();
    }
    renderOverlay(); renderTick(); draw();
  }
  $('btnPrev').onclick = function () { gotoPlay(S.i - 1); };
  $('btnNext').onclick = function () { gotoPlay(S.i + 1); };
  $('btnPlay').onclick = togglePlay;
  // Next phase: PRE-SNAP -> LIVE -> AFTER-PLAY by hand, paused. In Broadcast it is the only way to reveal the result.
  function nextPhase() {
    var p = plays[S.i], ph = phase();
    S.playing = false;
    if (ph === 'pre') { S.frame = p.snapFrame; onPhase(); }
    else if (ph === 'live') enterAfter();
    renderChrome(); renderOverlay(); renderTick(); draw();
  }
  var nextBtn = el('button', null, 'Next phase'); nextBtn.id = 'nextPhase'; nextBtn.title = 'Next phase: pre-snap → live → after the play (N)';
  $('controls').insertBefore(nextBtn, $('tClock'));
  nextBtn.onclick = nextPhase;

  var lastPost = 0, lastReady = null;
  function loop(ts) {
    var dt = S.last ? Math.min(ts - S.last, 200) : 0; S.last = ts;
    var play = plays[S.i], end = lastFrame(play);
    if (S.playing) {
      if (S.frame < end) {
        S.frame = Math.min(end, S.frame + dt * FPS / 1000);
        if (S.frame >= end) S.endAt = ts;
      } else if (!S.after) {
        // simulated broadcast latency: the result arrives LATENCY_MS after the last frame
        if (!S.endAt) S.endAt = ts;
        if (ts - S.endAt >= LATENCY_MS) enterAfter(ts);
      } else if (ts - S.afterAt >= AFTER_HOLD_MS) {
        gotoPlay(S.i + 1);
      }
      draw(); renderTick();
      onPhase();
      var rd = duelReady();
      if (rd !== lastReady) { lastReady = rd; renderOverlay(); }
      if (ts - lastPost >= 100) { lastPost = ts; postState(); }
    }
    requestAnimationFrame(loop);
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', function (e) {
    if (VIEWER) return;
    var k = e.key, inForm = /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (k === 'Tab') { e.preventDefault(); if (inForm) e.target.blur(); if (S.overlay) { S.overlay = false; renderOverlay(); draw(); } else showOverlay(); return; }
    if (k === 'Escape' || ((k === 'h' || k === 'H') && !inForm)) { e.preventDefault(); if (inForm) e.target.blur(); hideAll(); return; }
    if (!inForm && (k === 'n' || k === 'N')) { e.preventDefault(); nextPhase(); return; }
    if (inForm || S.bg === 'video') return;
    if (k === 'ArrowRight') { e.preventDefault(); gotoPlay(S.i + 1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); gotoPlay(S.i - 1); }
    else if (k === ' ') { e.preventDefault(); togglePlay(); }
  });
  // buttons should not keep focus (Space would re-click them)
  document.addEventListener('mouseup', function (e) { if (e.target.closest && e.target.closest('button')) e.target.closest('button').blur(); });

  // ---------- background: replay or broadcast clip ----------
  var noticeTimer = 0;
  function notice(html) {
    var n = $('notice'); n.innerHTML = html; n.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(function () { n.hidden = true; }, 10000);
  }
  $('notice').addEventListener('click', function () { $('notice').hidden = true; });
  function renderLabel() {
    $('replayLabel').innerHTML = S.bg === 'video'
      ? '<b>' + BROADCAST.tag + '</b>' + esc(BROADCAST.label)
      : '<b>SIMULATED LIVE</b>· ' + esc(String(T.meta.date || '').slice(-4) + ' DATA · ' + T.meta.away + ' @ ' + T.meta.home + ' Wk ' + T.meta.week);
  }
  function setBg(mode) {
    var idx = -1;
    if (mode === 'video') {
      if (location.protocol === 'file:') { notice(BROADCAST.fileNotice); return; }
      plays.forEach(function (p, k) { if (p.playId === BROADCAST.playId) idx = k; });
      if (idx < 0) { notice('The broadcast clip\'s play is not in this data file.'); return; }
    }
    S.bg = mode;
    var box = $('video');
    if (mode === 'video') {
      // the clip starts before the snap: the result is revealed only with Next phase (N)
      gotoPlay(idx);
      S.playing = false; renderOverlay(); renderTick();
      if (!box.firstChild) {
        var f = document.createElement('iframe');
        f.src = BROADCAST.src; f.title = 'Broadcast clip';
        f.allow = 'autoplay; encrypted-media; picture-in-picture';
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        box.appendChild(f);
        layoutVideo();
      }
      box.hidden = false;
    } else {
      box.innerHTML = ''; box.hidden = true;
      S.frame = 0; S.playing = true; S.endAt = 0; S.after = false;
    }
    document.body.classList.toggle('broadcast', mode === 'video');
    document.querySelectorAll('#bgSeg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-bg') === S.bg); });
    renderLabel(); renderOverlay(); renderTick(); draw();
  }
  document.querySelectorAll('#bgSeg button').forEach(function (b) {
    b.addEventListener('click', function () { if (b.getAttribute('data-bg') !== S.bg) setBg(b.getAttribute('data-bg')); });
  });
  document.querySelector('#bgSeg [data-bg=replay]').classList.add('on');

  // ---------- boot ----------
  renderLabel();
  document.title = 'Trench Duel · ' + T.meta.away + ' @ ' + T.meta.home;
  renderChips(); renderPicker(); renderOverlay(); renderTick();
  window.addEventListener('resize', resize);
  resize();
  // #play=N&frame=F&phase=after&duel=1&pressure=1&team=CLE&bg=video opens paused on a given moment (used for screenshots)
  function applyHash() {
    var hash = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) hash[a[0]] = decodeURIComponent(a[1] || ''); });
    if (hash.bg !== 'video' && S.bg === 'video') setBg('replay');
    if (hash.play) {
      gotoPlay(parseInt(hash.play, 10) - 1);
      if (hash.frame) { S.frame = Math.max(0, Math.min(lastFrame(plays[S.i]), parseFloat(hash.frame) || 0)); S.playing = false; }
      if (hash.phase === 'after' || (hash.frame && S.frame >= lastFrame(plays[S.i]))) { S.playing = false; S.after = true; S.frame = lastFrame(plays[S.i]); }
    }
    S.pills.pressure = hash.pressure === '1';
    S.pills.duel = hash.duel === '1';
    S.openedAt = { duel: performance.now(), pressure: performance.now(), team: performance.now() };
    if (S.pills.duel && S.selected == null && !S.pair && hl) S.pair = { r: hl[0], b: hl[1] };
    if (hash.team && teams.indexOf(hash.team) >= 0) { S.team = hash.team; S.pills.team = true; }
    else { S.team = null; S.pills.team = false; }
    S.overlay = true; lastPhase = phase();
    renderChips(); renderPicker(); renderChrome(); renderOverlay(); renderTick(); draw();
    if (hash.bg === 'video') { setBg('video'); if (hash.phase === 'after') enterAfter(); }
  }
  var SYNC_NOTICE = 'Stream sync needs a local server: <code>python3 -m http.server 8000 -d overlay</code>, then open <code>http://localhost:8000</code>';
  if (VIEWER) {
    ['overlay', 'controls', 'hint'].forEach(function (id) { if ($(id)) $(id).style.display = 'none'; });
    // #demo=push&play=67&phase=after renders the suggested pair's card from the hash alone (for screenshots)
    var vh = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) vh[a[0]] = decodeURIComponent(a[1] || ''); });
    if (vh.play) gotoPlay(parseInt(vh.play, 10) - 1);
    if (vh.phase === 'after') { S.after = true; S.frame = lastFrame(plays[S.i]); }
    if (vh.demo === 'push' && hl) S.pushed = { kind: 'duel', rusherId: hl[0], blockerId: hl[1] };
    S.playing = false;
    renderOverlay(); renderTick(); draw();
    // the demo hash is a fixed screenshot: it does not follow a controller
    if (chan && vh.demo !== 'push') { chan.onmessage = function (e) { applyRemote(e.data); }; chan.postMessage({ type: 'hello' }); }
  } else {
    applyHash();
    window.addEventListener('hashchange', applyHash);
    if (chan) chan.onmessage = function (e) { if (e.data && e.data.type === 'hello') postState(); };
  }
  if (location.protocol === 'file:') notice(SYNC_NOTICE);
  requestAnimationFrame(loop);
})();
