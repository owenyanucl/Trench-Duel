(function () {
  'use strict';
  var T = window.TRENCH;
  if (!T) { document.getElementById('fatal').hidden = false; return; }

  var FPS = 10, HOLD_MS = 1500;
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
    label: 'Cleveland Browns YouTube · CLE @ MIN 2021 Wk 4, play shown: Q3 11:29 McKinley sack',
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
    var s = T.season[id], by = league.byAlign || {}, e = s && s.expected, best = 'other', bd = 1e9;
    if (e == null) return best;
    Object.keys(by).forEach(function (k) { var d = Math.abs(by[k] - e); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  var ALIGN_PLURAL = { edge: 'edge rushers', interior: 'interior rushers', other: 'rushers from his spots' };
  var ALIGN_ONE = { edge: 'an edge rusher', interior: 'an interior rusher', other: 'a rusher from his spots' };
  function expectedOf(id) { var s = T.season[id]; return s && s.expected != null ? s.expected : league.repWinRate; }
  function times(rate, exp) { return exp > 0 ? (rate / exp).toFixed(1) + 'x' : '—'; }

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
    i: 0, frame: 0, playing: true, holdUntil: 0, last: 0, acc: 0,
    overlay: true, pills: { duel: false, pressure: false, team: false },
    selected: null, pair: null, team: null, bg: 'replay'
  };

  // ---------- duel logic (spoiler-safe: plays[0..S.i] only) ----------
  function isRusher(id) {
    var s = T.season[id]; if (s && s.role) return s.role === 'rusher';
    return plays.some(function (p) { return p.duels.some(function (d) { return d.rusherId == id; }); });
  }
  function bestDuel(list) {
    return list.slice().sort(function (a, b) {
      return (a.closestYds - b.closestYds) || ((b.rusherWon ? 1 : 0) - (a.rusherWon ? 1 : 0));
    })[0] || null;
  }
  // A rep is scored once the rule's window has closed: the throw/end of tracking, or windowSec after the snap.
  function closeFrame(p) { return Math.min(p.endFrame, p.snapFrame + league.windowSec * FPS); }
  // Spoiler-safe: earlier plays always count; the play on screen counts only once its window has closed.
  function scored(k) { return k < S.i || (k === S.i && S.frame >= closeFrame(plays[k])); }
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
    var padX = 16, top = innerWidth <= 760 ? 96 : 10 + barH + 6 + PILL_MAX + 8, bottom = innerWidth <= 760 ? 124 : 52;
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
  function pressureColor(d) {
    var thr = league.thresholdYds;
    if (d <= thr) return '#ff3b30';
    if (d <= thr * 2) return '#ff9f0a';
    if (d <= thr * 3) return '#ffd60a';
    return 'rgba(255,255,255,0.55)';
  }

  function drawPlayers(play, f) {
    var s = view.s, r = Math.max(5, s * 0.95), font = getComputedStyle(document.body).fontFamily;
    var pos = {};
    play.players.forEach(function (p) { pos[p.nflId] = lerpXY(p.xy, f); });
    var duel = S.overlay && S.pills.duel ? currentDuel() : null;
    var ringR = duel && duel.onPlay ? duel.rusherId : null, ringB = duel && duel.onPlay ? duel.blockerId : null;
    var ringOnly = duel && duel.only != null && pos[duel.only] ? duel.only : null;
    if (duel && !duel.onPlay && S.selected != null && pos[S.selected]) ringOnly = S.selected;

    // rusher -> QB line
    var qbDist = null, qbCol = null;
    if (ringR != null && pos[ringR] && pos[play.qbId]) {
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
      ctx.strokeStyle = id == ringR ? '#ff5a4e' : id == ringB ? '#4fc3ff' : '#ffcf3f';
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X(pos[id][0]), Y(pos[id][1]), r + 4, 0, Math.PI * 2); ctx.stroke();
    });
    // the rusher's tag goes on the side away from the blocker, the blocker's on the other side
    var rusherAbove = !(ringR != null && ringB != null && pos[ringR] && pos[ringB]) || Y(pos[ringR][1]) <= Y(pos[ringB][1]);
    hi.forEach(function (id) {
      var cx = X(pos[id][0]), cy = Y(pos[id][1]), isR = id == ringR;
      var above = isR ? rusherAbove : id == ringB ? !rusherAbove : false;
      var label = lastName(id) + (isR && qbDist != null ? ' · ' + qbDist.toFixed(1) + ' yd to QB now' : '');
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
  function chip(t) { return '<span class="sb-team" style="background:' + teamColor(t) + ';color:' + inkOn(teamColor(t)) + '">' + esc(t) + '</span>'; }
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
    var done = S.frame >= p.nFrames - 1;
    $('playResult').textContent = done ? (RESULT[p.passResult] || p.passResult) : '';
    $('playResult').style.color = done && (p.passResult === 'S' || p.passResult === 'IN') ? '#ff5a4e' : '';
  }

  // ---------- overlay: bar ----------
  var overlay = $('overlay'), picker = $('picker');
  function renderChips() {
    var box = $('chips'); box.innerHTML = '';
    teams.forEach(function (t) {
      var b = el('button', 'chip', esc(t));
      b.style.background = teamColor(t); b.style.color = inkOn(teamColor(t));
      b.title = TEAM_NAME[t] ? TEAM_NAME[t] + ': team pill, players filtered to ' + t : t;
      var focus = teamFocus();
      if (focus === t) b.classList.add('active');
      else if (focus) b.classList.add('dim');
      b.onclick = function () { setTeam(teamFocus() === t ? null : t); };
      box.appendChild(b);
    });
  }
  function teamFocus() { return S.pills.team ? S.team : null; }
  function setTeam(t) {
    S.team = t; S.pills.team = !!t;
    renderChips(); renderPicker(); renderOverlay();
  }
  function renderPicker() {
    picker.innerHTML = '';
    var auto = el('option', null, 'Pick a player…'); auto.value = ''; picker.appendChild(auto);
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
    if (S.selected != null) S.pills.duel = true;
    picker.blur(); renderOverlay(); draw();
  });
  document.querySelectorAll('.icon-btn[data-pill]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-pill');
      if (k === 'team') { setTeam(S.pills.team ? null : (S.team || plays[S.i].defense)); return; }
      S.pills[k] = !S.pills[k]; renderOverlay(); draw();
    });
  });
  // Suggested matchup: the pair that meets most often in this game. Nothing is selected until it is clicked.
  var hl = headline ? headline.split('|').map(Number) : null;
  if (hl) $('suggest').innerHTML = '<span>Suggested</span> ' + esc(lastName(hl[0])) + ' vs ' + esc(lastName(hl[1]));
  else $('suggest').hidden = true;
  $('suggest').addEventListener('click', function () {
    S.pair = { r: hl[0], b: hl[1] }; S.selected = null; S.pills.duel = true;
    renderPicker(); renderOverlay(); draw();
  });
  $('barClose').addEventListener('click', hideAll);
  $('btnHide').addEventListener('click', function () { if (S.overlay) hideAll(); else showOverlay(); });

  // ---------- overlay: pills ----------
  function renderDuel() {
    var box = $('pill-duel');
    var d = currentDuel();
    var head = '<div class="pill-head"><span>Trench duel · <span class="tag">' +
      (d.mode === 'pinned' ? 'your pick' : d.mode === 'pair' || d.mode === 'headline' ? 'suggested matchup' : 'closest rush this play') + '</span></span>' +
      '<span>spoiler-safe · win = within ' + league.thresholdYds + ' yd of QB in ' + league.windowSec + 's' +
      (S.selected != null || S.pair ? ' <button data-act="auto">Clear ✕</button>' : '') + '</span></div>';
    if (d.rusherId == null) {
      var who = d.only != null ? esc(tagName(d.only)) + ' has no trench reps yet tonight.' : 'No pass-rush duels on this play.';
      box.innerHTML = head + '<div class="muted">' + who + '</div>';
      return;
    }
    var r = d.rusherId, b = d.blockerId, t = pairTally(r, b);
    var rL = esc(lastName(r)), bL = esc(lastName(b));
    var rAlign = alignOf(r), avg = ALIGN_PLURAL[rAlign] + ' average 1 in ' + oneIn(expectedOf(r));
    var reps = t.reps + ' rep' + (t.reps > 1 ? 's' : '');
    var line;
    if (t.reps === 0) line = rL + ' and ' + bL + ' have not met yet tonight.';
    else if (t.wins === 0) line = bL + ' has stonewalled ' + rL + (t.reps === 1 ? ' on their only rep' : ' on all ' + reps) + ' tonight; ' + avg + '.';
    else line = rL + ' has beaten ' + bL + ' on ' + t.wins + ' of ' + reps + ' tonight; ' + avg + '.';
    var thisRep = d.onPlay && !scored(S.i) ? '<b>in progress</b>' : d.onPlay ? (d.onPlay.rusherWon ? '<b style="color:var(--win)">rusher won</b>' : '<b style="color:var(--hold)">blocker held</b>') : '<span>not matched</span>';
    var sr = T.season[r], sb = T.season[b];
    var rt = playerTally(r, true), bt = playerTally(b, false);
    var dots = t.seq.map(function (x) { return '<i class="dot' + (x.w ? ' w' : '') + (x.now ? ' now' : '') + '"></i>'; }).join('');
    var rSeason = sr ? 'wins <b>' + pct(sr.winRate) + '</b> of ' + sr.reps + ' reps, <b>' + times(sr.winRate, expectedOf(r)) + '</b> what\'s expected for ' + ALIGN_ONE[rAlign] : 'no season data';
    var bSeason = sb ? 'loses <b>' + pct(sb.winRate) + '</b> of ' + sb.reps + ' reps, <b>' + times(sb.winRate, expectedOf(b)) + '</b> what\'s expected for the rushers he faced' : 'no season data';
    box.innerHTML = head +
      '<div class="duel-grid"><div>' +
      '<div class="matchup"><span class="r">' + esc(tagName(r)) + '</span><span class="vs">vs</span><span class="b">' + esc(tagName(b)) + '</span></div>' +
      '<div class="tally"><div class="score"><span class="r">' + rL + ' <em>' + t.wins + '</em></span><em>–</em><span class="b"><em>' + (t.reps - t.wins) + '</em> ' + bL + '</span></div>' +
      '<div class="who">' + t.reps + ' rep' + (t.reps === 1 ? '' : 's') + ' · this play: ' + thisRep + '</div></div>' +
      '<div class="dots" title="Each rep tonight, oldest first. Red = rusher won.">' + dots + '</div>' +
      '</div><div class="oneliner">' + line + '</div></div>' +
      '<div class="ctx">' +
      '<div title="Tonight vs all blockers: ' + rt.wins + ' of ' + rt.reps + '"><span class="r">●</span> <b>' + rL + '</b> <span class="ctx-k">season wks 1–8</span> ' + rSeason + '</div>' +
      '<div title="Tonight vs all rushers: lost ' + bt.wins + ' of ' + bt.reps + '"><span class="b">●</span> <b>' + bL + '</b> <span class="ctx-k">season wks 1–8</span> ' + bSeason + '</div>' +
      '</div>';
  }
  function renderPressure() {
    var box = $('pill-pressure'), play = plays[S.i];
    var head = '<div class="pill-head"><span>Pressure · this play</span><span><i class="key-thr"></i>' + league.thresholdYds + '-yd win line <i class="key-now"></i>now</span></div>';
    if (!play.duels.length) { box.innerHTML = head + '<div class="muted">No duels recorded on this play.</div>'; return; }
    // one row per rusher (double teams collapse)
    var rows = {}, order = [];
    play.duels.forEach(function (d) {
      if (!rows[d.rusherId]) { rows[d.rusherId] = { r: d.rusherId, b: [], d: d }; order.push(d.rusherId); }
      rows[d.rusherId].b.push(d.blockerId);
    });
    var qb = play.players.filter(function (p) { return p.nflId == play.qbId; })[0];
    var qxy = qb ? lerpXY(qb.xy, S.frame) : null;
    var done = scored(S.i);
    order.forEach(function (id) {
      var pl = play.players.filter(function (p) { return p.nflId == id; })[0];
      rows[id].live = pl && qxy ? dist(lerpXY(pl.xy, S.frame), qxy) : null;
    });
    // before the window closes, rank and draw by live distance only: the result is not known yet
    order.sort(function (a, b) {
      return done ? rows[a].d.closestYds - rows[b].d.closestYds : (rows[a].live == null ? 1e9 : rows[a].live) - (rows[b].live == null ? 1e9 : rows[b].live);
    });
    var top = rows[order[0]].d;
    var tp = top.secToPressure != null
      ? 'within ' + league.thresholdYds + ' yd at <b>' + top.secToPressure.toFixed(1) + 's</b>'
      : 'not within ' + league.thresholdYds + ' yd inside ' + league.windowSec + 's';
    var MAX = 10, sel = currentDuel();
    var bars = order.map(function (id) {
      var x = rows[id], d = x.d, ld = x.live, shown = done ? d.closestYds : ld;
      var w = shown == null ? 0 : Math.max(4, (1 - Math.min(shown, MAX) / MAX) * 100);
      var live = ld == null ? '' : '<span class="live" style="left:calc(' + (1 - Math.min(ld, MAX) / MAX) * 100 + '% - 1px)"></span>';
      var dbl = x.b.length > 1 ? ' ×2' : '';
      return '<div class="barrow' + (sel.rusherId == id ? ' sel' : '') + '" data-id="' + id + '" title="vs ' + esc(x.b.map(shortName).join(' + ')) + '">' +
        '<span class="nm">' + esc(lastName(id)) + dbl + '</span>' +
        '<span class="track"><span class="fill' + (done ? (d.rusherWon ? ' w' : '') : ' now') + '" style="width:' + w + '%"></span>' +
        '<span class="thr" style="left:' + (1 - league.thresholdYds / MAX) * 100 + '%"></span>' + live + '</span>' +
        '<span class="v">' + (shown == null ? '–' : shown.toFixed(1)) + '</span></div>';
    }).join('');
    var summary = done
      ? '<div class="pr-top">Closest: <span class="r">' + esc(tagName(top.rusherId)) + '</span></div><div class="pr-sub">closest in first ' + league.windowSec + 's or to the throw: <b>' + top.closestYds.toFixed(1) + ' yd</b> · ' + tp + '</div>'
      : '<div class="pr-top">Closest now: <span class="r">' + esc(tagName(top.rusherId)) + '</span></div><div class="pr-sub">live distance to the QB · result after ' + league.windowSec + 's or the throw</div>';
    box.innerHTML = head + summary +
      '<div class="bars" title="' + (done ? 'Bar = how close each rusher got to the QB in the first ' + league.windowSec + 's or until the throw/sack (longer = closer)' : 'Bar = live distance to the QB (longer = closer)') + '">' + bars + '</div>';
    box.querySelectorAll('.barrow').forEach(function (row) {
      row.onclick = function () { S.selected = +row.getAttribute('data-id'); renderPicker(); renderOverlay(); draw(); };
    });
  }
  var TEAM_LINES = {
    thirdDownBlitzRate: function (n, x, y) { return n + ' blitzes on ' + x + ' of 3rd downs, league average ' + y + '.'; },
    blitzRate: function (n, x, y) { return n + ' blitzes on ' + x + ' of dropbacks, league average ' + y + '.'; },
    manRate: function (n, x, y) { return n + ' plays man coverage on ' + x + ' of man-or-zone dropbacks, league average ' + y + '.'; },
    pressureRate: function (n, x, y) { return n + ' pressures the QB on ' + x + ' of dropbacks, league average ' + y + '.'; },
    sackRate: function (n, x, y) { return n + ' sacks the QB on ' + x + ' of dropbacks, league average ' + y + '.'; }
  };
  function renderTeam() {
    var box = $('pill-team'), t = S.team, data = T.teams && T.teams[t], lg = league.team || {};
    var name = TEAM_NAME[t] || t;
    var head = '<div class="pill-head"><span><b class="team-dot" style="background:' + teamColor(t) + '"></b>' + esc(t) + ' · <span class="tag">team</span> · season wks 1–8</span>' +
      '<span>' + (data && data.defense ? data.defense.plays + ' def. plays · ' : '') + 'vs league</span></div>';
    if (!data || !data.defense) { box.innerHTML = head + '<div class="muted">No team data for ' + esc(t) + ' in this file.</div>'; return; }
    var D = data.defense, O = data.offense || {};
    // the ready-to-read line: the tendency furthest from league average, relative to the league figure.
    // Blitzing less yet pressuring more (or the reverse) is one story, scored by both gaps together.
    var pick = null, best = 0, line = '';
    Object.keys(TEAM_LINES).forEach(function (k) {
      if (D[k] == null || !lg[k]) return;
      var gap = Math.abs(D[k] / lg[k] - 1);
      if (gap > best) { best = gap; pick = k; }
    });
    if (pick) line = TEAM_LINES[pick](name, pct(D[pick]), pct(lg[pick]));
    if (D.blitzRate != null && D.pressureRate != null && lg.blitzRate && lg.pressureRate) {
      var bg = D.blitzRate / lg.blitzRate - 1, pg = D.pressureRate / lg.pressureRate - 1;
      if (bg * pg < 0 && Math.abs(bg) + Math.abs(pg) > best) {
        line = bg < 0
          ? name + ' blitzes less than average (' + pct(D.blitzRate) + ' vs ' + pct(lg.blitzRate) + ') but still pressures on ' + pct(D.pressureRate) + ' of dropbacks.'
          : name + ' blitzes more than average (' + pct(D.blitzRate) + ' vs ' + pct(lg.blitzRate) + ') but pressures on only ' + pct(D.pressureRate) + ' of dropbacks.';
      }
    }
    function stat(label, k, src, l) {
      var v = (src || D)[k], lv = (l || lg)[k];
      if (v == null) return '';
      var cls = lv != null ? (v > lv * 1.1 ? ' hi' : v < lv * 0.9 ? ' lo' : '') : '';
      return '<div class="st"><span class="sl">' + label + '</span><b class="sv' + cls + '">' + pct(v) + '</b>' + (lv != null ? '<span class="lg">lg ' + pct(lv) + '</span>' : '') + '</div>';
    }
    var cov = (D.coverages || []).slice(0, 3).map(function (c) { return esc(c.name) + ' <b>' + pct(c.share) + '</b>'; }).join(' · ');
    box.innerHTML = head +
      (line ? '<div class="oneliner">' + esc(line) + '</div>' : '') +
      '<div class="stats">' +
      stat('Blitz', 'blitzRate') + stat('3rd-down blitz', 'thirdDownBlitzRate') + stat('Pressure', 'pressureRate') +
      (D.manRate != null ? '<div class="st"><span class="sl">Man / zone</span><b class="sv">' + Math.round(D.manRate * 100) + '/' + Math.round((1 - D.manRate) * 100) + '</b>' + (lg.manRate != null ? '<span class="lg">lg ' + Math.round(lg.manRate * 100) + '/' + Math.round((1 - lg.manRate) * 100) + '</span>' : '') + '</div>' : '') +
      stat('Sack', 'sackRate') + stat('Off. pressured', 'pressureAllowedRate', O) +
      '</div>' +
      (cov ? '<div class="cov"><span class="sl">Top coverages</span> ' + cov + '</div>' : '');
  }
  $('pill-duel').addEventListener('click', function (e) {
    if (e.target.getAttribute('data-act') === 'auto') { S.selected = null; S.pair = null; renderPicker(); renderOverlay(); draw(); }
  });

  function renderOverlay() {
    overlay.classList.toggle('hidden', !S.overlay);
    document.querySelectorAll('.icon-btn[data-pill]').forEach(function (b) { b.classList.toggle('on', !!S.pills[b.getAttribute('data-pill')]); });
    $('pill-duel').classList.toggle('open', S.pills.duel);
    $('pill-pressure').classList.toggle('open', S.pills.pressure);
    $('pill-team').classList.toggle('open', S.pills.team && !!S.team);
    $('suggest').classList.toggle('on', S.pills.duel && S.selected == null && (!!S.pair || currentDuel().mode === 'headline'));
    if (S.overlay && S.pills.duel) renderDuel();
    if (S.overlay && S.pills.pressure) renderPressure();
    if (S.overlay && S.pills.team && S.team) renderTeam();
    renderChrome();
    if (!dragged) placeOverlayDefault();
  }
  function hideAll() {
    S.overlay = false; S.pills.duel = false; S.pills.pressure = false; S.pills.team = false; S.team = null;
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
    if (!S.overlay || S.bg === 'video') return;
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
    S.i = (i + plays.length) % plays.length; S.frame = 0; S.acc = 0; S.holdUntil = 0;
    renderOverlay(); renderTick(); draw();
  }
  function togglePlay() {
    S.playing = !S.playing;
    if (S.playing && S.frame >= plays[S.i].nFrames - 1) { S.frame = 0; S.holdUntil = 0; }
    renderChrome();
  }
  $('btnPrev').onclick = function () { gotoPlay(S.i - 1); };
  $('btnNext').onclick = function () { gotoPlay(S.i + 1); };
  $('btnPlay').onclick = togglePlay;

  var lastPressureFrame = -1, lastScored = null;
  function loop(ts) {
    var dt = S.last ? Math.min(ts - S.last, 200) : 0; S.last = ts;
    var play = plays[S.i];
    if (S.playing) {
      if (S.frame < play.nFrames - 1) {
        S.frame = Math.min(play.nFrames - 1, S.frame + dt * FPS / 1000);
        if (S.frame >= play.nFrames - 1) S.holdUntil = ts + HOLD_MS;
      } else if (S.holdUntil && ts >= S.holdUntil) {
        gotoPlay(S.i + 1);
      } else if (!S.holdUntil) S.holdUntil = ts + HOLD_MS;
      draw(); renderTick();
      var fi = Math.floor(S.frame);
      if (S.overlay && S.pills.pressure && fi !== lastPressureFrame) { lastPressureFrame = fi; renderPressure(); }
      var sc = scored(S.i);
      if (sc !== lastScored) { lastScored = sc; if (S.overlay && S.pills.duel) renderDuel(); }
    }
    requestAnimationFrame(loop);
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', function (e) {
    var k = e.key, inForm = /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (k === 'Tab') { e.preventDefault(); if (inForm) e.target.blur(); if (S.overlay) { S.overlay = false; renderOverlay(); draw(); } else showOverlay(); return; }
    if (k === 'Escape' || ((k === 'h' || k === 'H') && !inForm)) { e.preventDefault(); if (inForm) e.target.blur(); hideAll(); return; }
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
      : '<b>REPLAY</b>' + esc(String(T.meta.label || 'Replay from tracking data — not live'));
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
      gotoPlay(idx);
      S.frame = plays[idx].nFrames - 1; S.playing = false; S.holdUntil = 0;
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
      S.frame = 0; S.playing = true; S.holdUntil = 0;
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
  // #play=N&frame=F&duel=1&pressure=1&team=CLE&bg=video opens paused on a given moment (used for screenshots)
  function applyHash() {
    var hash = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) hash[a[0]] = decodeURIComponent(a[1] || ''); });
    if (hash.bg !== 'video' && S.bg === 'video') setBg('replay');
    if (hash.play) {
      gotoPlay(parseInt(hash.play, 10) - 1);
      if (hash.frame) { S.frame = Math.max(0, Math.min(plays[S.i].nFrames - 1, parseFloat(hash.frame) || 0)); S.playing = false; }
    }
    S.pills.pressure = hash.pressure === '1';
    S.pills.duel = hash.duel === '1';
    if (S.pills.duel && S.selected == null && !S.pair && hl) S.pair = { r: hl[0], b: hl[1] };
    if (hash.team && teams.indexOf(hash.team) >= 0) { S.team = hash.team; S.pills.team = true; }
    else { S.team = null; S.pills.team = false; }
    S.overlay = true;
    renderChips(); renderPicker(); renderChrome(); renderOverlay(); renderTick(); draw();
    if (hash.bg === 'video') setBg('video');
  }
  applyHash();
  window.addEventListener('hashchange', applyHash);
  requestAnimationFrame(loop);
})();
