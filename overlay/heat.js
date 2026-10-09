// Heat map panel (controller only): where one player stood from snap to throw, tonight so far against his weeks
// before tonight. Loaded after app.js, which exposes window.TD. The baseline comes from data/heat.js (TRENCH_HEAT);
// tonight is counted here from the replay's own tracking, spoiler-safe: a play counts once TD.isReady says its
// tracking up to the throw or sack has arrived.
(function () {
  'use strict';
  var TD = window.TD, T = window.TRENCH, H = window.TRENCH_HEAT || null;
  var panel = document.getElementById('heatPanel'), btn = document.querySelector('.icon-btn[data-pill=heat]');
  if (!TD || !T || !panel) return;

  // ---------- grid: x = yards downfield of the ball at the snap, y = yards across (+ = the offense's left) ----------
  var M = H && H.meta ? H.meta : { gridYd: 1, xMin: -15, xMax: 35, yMin: -25, yMax: 25, weeks: [] };
  var G = M.gridYd, X0 = M.xMin, X1 = M.xMax, Y0 = M.yMin, Y1 = M.yMax;
  var NX = Math.round((X1 - X0) / G), NY = Math.round((Y1 - Y0) / G);
  var ASPECT = (X1 - X0) / (Y1 - Y0); // map height / width
  var SMOOTH_YD = 1.2; // Gaussian blur, yards
  var SAME_YD = 1.5; // a gap smaller than this reads "about the same"
  var DEFAULT_ID = 44903; // John Johnson III, Cleveland's free safety
  var WEEKS = (function () {
    var w = M.weeks || [];
    return w.length ? 'wks ' + (w.length > 1 ? w[0] + '–' + w[w.length - 1] : w[0]) : '';
  })();
  var DEF_ORDER = ['FS', 'SS', 'S', 'CB', 'DB', 'MLB', 'ILB', 'OLB', 'LB', 'DE', 'DT', 'NT', 'DL'];
  var OFF_ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'T', 'G', 'C'];
  var SUFFIX = { JR: 1, 'JR.': 1, SR: 1, 'SR.': 1, II: 1, III: 1, IV: 1, V: 1 };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // ---------- players: everyone in the baseline file for these two teams, plus everyone on the field tonight ----------
  var teams = [T.meta.away, T.meta.home], info = {}, seen = {};
  TD.plays.forEach(function (p) {
    p.players.forEach(function (q) {
      var s = seen[q.nflId] || (seen[q.nflId] = { def: 0, off: 0 });
      if (q.team === p.defense) s.def++; else s.off++;
    });
  });
  function addPlayer(id) {
    var h = H && H.players[id], t = T.players[id], s = seen[id];
    if (info[id] || !(h || t)) return;
    var team = (t && t.team) || (h && h.team);
    if (teams.indexOf(team) < 0) return;
    info[id] = {
      name: (t && t.name) || (h && h.name) || 'Unknown', pos: (t && t.pos) || (h && h.pos) || '', team: team,
      jersey: t ? t.jersey : null,
      side: (h && h.side) || (s && s.def >= s.off ? 'defense' : 'offense')
    };
  }
  if (H) Object.keys(H.players).forEach(addPlayer);
  Object.keys(T.players).forEach(addPlayer);
  function words(id) { return String(info[id].name).split(/\s+/); }
  function lastName(id) {
    var w = words(id);
    while (w.length > 1 && SUFFIX[w[w.length - 1].toUpperCase()]) w.pop();
    return w[w.length - 1];
  }
  function shortName(id) { var w = words(id); return w.length > 1 ? w[0][0] + '. ' + lastName(id) : w[0]; }
  function baselineOf(id) { var h = H && H.players[id]; return h && h.baseline && h.baseline.frames ? h.baseline : null; }
  function rank(id) {
    var o = info[id].side === 'defense' ? DEF_ORDER : OFF_ORDER, k = o.indexOf(info[id].pos);
    return k < 0 ? o.length : k;
  }
  // defenders first (tonight's defense on this play first), then by position group and jersey
  function ordered() {
    var d = TD.plays[TD.state.i].defense;
    function key(id) { var x = info[id]; return [x.side === 'defense' ? 0 : 1, x.team === d ? 0 : 1, rank(id), x.jersey == null ? 999 : x.jersey]; }
    return Object.keys(info).map(Number).sort(function (a, b) {
      var ka = key(a), kb = key(b);
      for (var i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return a - b;
    });
  }
  // nothing chosen: Johnson when Cleveland defends, else the first of this play's defenders with earlier games
  function defaultId() {
    var d = TD.plays[TD.state.i].defense;
    if (info[DEFAULT_ID] && info[DEFAULT_ID].team === d) return DEFAULT_ID;
    var list = ordered();
    return list.filter(function (id) { return info[id].side === 'defense' && info[id].team === d && baselineOf(id); })[0] || list[0];
  }

  // ---------- whose map: the panel's own pick, else the overlay's selected player, else the default ----------
  var choice = null, lastSel = TD.selected();
  function current() {
    var sel = TD.selected();
    if (sel !== lastSel) { lastSel = sel; choice = null; } // a new pick in the bar or on the field takes over
    if (choice != null && info[choice]) return choice;
    if (sel != null && info[sel]) return sel;
    return defaultId();
  }

  // ---------- tonight so far, from the replay's tracking ----------
  function cellOf(down, across) {
    var ix = clamp(Math.floor((down - X0) / G), 0, NX - 1), iy = clamp(Math.floor((across - Y0) / G), 0, NY - 1);
    return iy * NX + ix;
  }
  function tonight(id) {
    var cells = new Float64Array(NX * NY), out = { cells: cells, snaps: 0, frames: 0, depthSum: 0, depthPlays: 0, counted: 0 };
    for (var k = 0; k <= TD.state.i; k++) {
      if (!TD.isReady(k)) continue;
      out.counted++;
      var p = TD.plays[k], me = null;
      for (var j = 0; j < p.players.length; j++) if (p.players[j].nflId === id) { me = p.players[j]; break; }
      if (!me) continue;
      var b = p.ball[p.snapFrame], bx = b[0], by = b[1];
      out.snaps++;
      for (var f = p.snapFrame; f <= p.endFrame; f++) { cells[cellOf(me.xy[f][0] - bx, me.xy[f][1] - by)]++; out.frames++; }
      // depth at the end counts only plays that ended with an event (throw, sack or scramble), not the tracking running out
      if (p.endFrame < p.nFrames - 1) { out.depthSum += me.xy[p.endFrame][0] - bx; out.depthPlays++; }
    }
    out.depth = out.depthPlays ? out.depthSum / out.depthPlays : null;
    return out;
  }
  // mean distance from the ball side to side, from the grid itself, so tonight and the baseline are measured alike
  function sideToSide(cells) {
    var s = 0, w = 0;
    for (var iy = 0; iy < NY; iy++) {
      var a = Math.abs(Y0 + (iy + 0.5) * G);
      for (var ix = 0; ix < NX; ix++) { var v = cells[iy * NX + ix]; s += v; w += v * a; }
    }
    return s ? w / s : null;
  }

  // ---------- density: share of time per cell, lightly blurred ----------
  var KERNEL = (function () {
    var sg = SMOOTH_YD / G, r = Math.ceil(3 * sg), k = [], t = 0;
    for (var i = -r; i <= r; i++) { var v = Math.exp(-0.5 * (i / sg) * (i / sg)); k.push(v); t += v; }
    return k.map(function (v) { return v / t; });
  })();
  function density(cells) {
    var total = 0, i;
    for (i = 0; i < cells.length; i++) total += cells[i];
    if (!total) return null;
    var a = new Float64Array(NX * NY), b = new Float64Array(NX * NY), r = (KERNEL.length - 1) / 2;
    for (i = 0; i < cells.length; i++) a[i] = cells[i] / total;
    for (var iy = 0; iy < NY; iy++) for (var ix = 0; ix < NX; ix++) {
      var s = 0;
      for (var q = -r; q <= r; q++) { var x = ix + q; if (x >= 0 && x < NX) s += a[iy * NX + x] * KERNEL[q + r]; }
      b[iy * NX + ix] = s;
    }
    for (iy = 0; iy < NY; iy++) for (ix = 0; ix < NX; ix++) {
      s = 0;
      for (q = -r; q <= r; q++) { var y = iy + q; if (y >= 0 && y < NY) s += b[y * NX + ix] * KERNEL[q + r]; }
      a[iy * NX + ix] = s;
    }
    return a;
  }
  function maxOf(d) { var m = 0; if (d) for (var i = 0; i < d.length; i++) if (d[i] > m) m = d[i]; return m; }

  // ---------- drawing: downfield up, the line of scrimmage near the bottom, the offense's left on the left ----------
  var FONT = getComputedStyle(document.body).fontFamily;
  function drawMap(cv, d, vmax, w) {
    var dpr = window.devicePixelRatio || 1, h = Math.round(w * ASPECT);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    function px(across) { return (Y1 - across) / (Y1 - Y0) * w; }
    function py(down) { return (X1 - down) / (X1 - X0) * h; }
    if (d && vmax > 0) {
      // one pixel per cell, scaled up with smoothing: image column = across (+ on the left), row = downfield (far end on top)
      var img = document.createElement('canvas'); img.width = NY; img.height = NX;
      var ic = img.getContext('2d'), id = ic.createImageData(NY, NX), px4 = id.data;
      for (var iy = 0; iy < NY; iy++) for (var ix = 0; ix < NX; ix++) {
        var t = Math.min(1, d[iy * NX + ix] / vmax), o = ((NX - 1 - ix) * NY + (NY - 1 - iy)) * 4, wt = Math.pow(t, 1.6);
        px4[o] = 79 + (240 - 79) * wt; px4[o + 1] = 195 + (248 - 195) * wt; px4[o + 2] = 255;
        px4[o + 3] = Math.round(255 * Math.min(1, 1.1 * Math.pow(t, 0.5)));
      }
      ic.putImageData(id, 0, 0);
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(img, 0, 0, w, h);
    }
    // 10-yard guides, the line of scrimmage stronger and labelled
    c.lineWidth = 1;
    for (var a = Math.ceil(Y0 / 10) * 10; a <= Y1; a += 10) {
      if (a === Y0 || a === Y1) continue;
      c.strokeStyle = 'rgba(255,255,255,0.10)';
      c.beginPath(); c.moveTo(Math.round(px(a)) + 0.5, 0); c.lineTo(Math.round(px(a)) + 0.5, h); c.stroke();
    }
    c.font = '600 10px ' + FONT; c.textBaseline = 'bottom'; c.textAlign = 'left';
    for (var y = Math.ceil(X0 / 10) * 10; y <= X1; y += 10) {
      if (y === X0 || y === X1) continue;
      var yy = Math.round(py(y)) + 0.5;
      c.strokeStyle = y === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)';
      c.lineWidth = y === 0 ? 1.5 : 1;
      c.beginPath(); c.moveTo(0, yy); c.lineTo(w, yy); c.stroke();
      if (y >= 0) { c.fillStyle = y === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)'; c.fillText(y === 0 ? 'LOS' : String(y), 4, yy - 2); }
    }
    // the ball at the snap
    var bx = px(0), by = py(0);
    c.fillStyle = '#8b4a1c'; c.strokeStyle = '#f5e6d0'; c.lineWidth = 1;
    c.beginPath(); c.ellipse(bx, by, 4, 2.6, Math.PI / 2, 0, Math.PI * 2); c.fill(); c.stroke();
  }

  // ---------- the sentence ----------
  var FEW = 5; // under this many depth plays tonight: the numbers only, no judgement
  function yd(v) { return Math.abs(v).toFixed(1); }
  // depth at the throw: "19.2 yd" downfield, "5.2 yd behind the line" in the backfield
  function depthLong(v) { return yd(v) + ' yd' + (v < 0 ? ' behind the line' : ''); }
  function depthShort(v) { return yd(v) + (v < 0 ? ' behind' : ''); }
  function about(gap, unit) { var n = Math.max(1, Math.round(Math.abs(gap))); return 'about ' + n + ' ' + unit + (n === 1 ? '' : 's'); }
  // "closer to the line" only while both depths sit on the same side of it; across the line, field direction
  function moved(gap, base, now, def) {
    if (base < 0 && now < 0) return gap < 0 ? 'farther behind the line' : 'closer to the line';
    if (base >= 0 && now >= 0 && !def) return gap > 0 ? 'farther downfield' : 'closer to the line';
    if (def) return gap > 0 ? 'deeper' : 'shallower';
    return gap > 0 ? 'farther downfield' : 'farther back';
  }
  function sentence(id, base, now) {
    var name = lastName(id), def = info[id].side === 'defense';
    var baseDepth = base && base.depthPlays && base.avgDepthAtEnd != null ? base.avgDepthAtEnd : null;
    var before = baseDepth != null ? depthShort(baseDepth) + ' over ' + plural(base.depthPlays, 'snap') : null;
    if (!now.snaps) return 'Not on the field yet tonight.' + (before ? ' Before tonight: ' + depthLong(baseDepth) + ' at the throw over ' + plural(base.depthPlays, 'snap') + '.' : '');
    if (now.depth == null) return name + ' has ' + plural(now.snaps, 'snap') + ' tonight, none ending in a throw or sack yet.';
    var tonightPart = depthLong(now.depth) + ' at the throw over ' + plural(now.depthPlays, 'snap');
    if (!base) return name + ' tonight: ' + tonightPart + '. No earlier games yet.';
    if (!before) return name + ' tonight: ' + tonightPart + ', with no throw or sack in earlier games to compare.';
    if (now.depthPlays < FEW) return name + ' tonight: ' + tonightPart + ' (before: ' + before + ').';
    var gap = now.depth - baseDepth, same = Math.abs(gap) < SAME_YD;
    var depthWords = same ? 'at his usual depth' : 'sitting ' + about(gap, 'yard') + ' ' + moved(gap, baseDepth, now.depth, def) + ' than usual';
    var wNow = sideToSide(now.cells), wBase = sideToSide(base.cells), wide = '';
    if (wNow != null && wBase != null && Math.abs(wNow - wBase) >= SAME_YD) {
      wide = (same ? ', but ' : ', and ') + about(wNow - wBase, 'yard') + ' ' + (wNow > wBase ? 'wider of' : 'tighter to') +
        ' the ball (' + yd(wNow) + ' vs ' + yd(wBase) + ' yd)';
    }
    return name + ' is ' + depthWords + ' tonight: ' + tonightPart + ' vs ' + before + ' before' + wide + '.';
  }

  // ---------- panel ----------
  panel.innerHTML =
    '<div class="pill-head heat-head"><span>Heat map</span><span class="heat-head-r">' +
    '<select class="heat-pick" title="Whose heat map"></select><button type="button" class="heat-x" title="Close the heat map">✕</button></span></div>' +
    '<div class="heat-maps">' +
    '<figure class="heat-fig"><figcaption><b>Before tonight</b> <span class="heat-n" data-k="base"></span></figcaption>' +
    '<div class="heat-box"><canvas data-k="base"></canvas><div class="heat-empty" data-k="base"></div></div></figure>' +
    '<figure class="heat-fig"><figcaption><b>Tonight so far</b> <span class="heat-n" data-k="now"></span></figcaption>' +
    '<div class="heat-box"><canvas data-k="now"></canvas><div class="heat-empty" data-k="now"></div></div></figure>' +
    '</div>' +
    '<div class="heat-keys"><span>offense\'s left ← → offense\'s right</span><span>less<i class="heat-ramp"></i>more time · one scale</span></div>' +
    '<div class="oneliner heat-line"></div>' +
    '<div class="heat-foot">Where he stood from snap to throw, passing plays. Positions only, not why.</div>';
  function q(sel) { return panel.querySelector(sel); }
  var pick = q('.heat-pick');
  panel.style.setProperty('--heat-aspect', ASPECT);

  var pickKey = null;
  function renderPick(id) {
    var d = TD.plays[TD.state.i].defense;
    if (pickKey !== d && document.activeElement !== pick) {
      pickKey = d; pick.innerHTML = '';
      var groups = {};
      ordered().forEach(function (pid) {
        var x = info[pid], g = x.team + ' ' + x.side;
        if (!groups[g]) { groups[g] = document.createElement('optgroup'); groups[g].label = g; pick.appendChild(groups[g]); }
        var o = document.createElement('option'); o.value = pid;
        o.textContent = (x.jersey != null ? '#' + x.jersey + ' ' : '') + shortName(pid) + (x.pos ? ' · ' + x.pos : '');
        groups[g].appendChild(o);
      });
    }
    if (pick.value !== String(id)) pick.value = String(id);
  }
  pick.addEventListener('change', function () { choice = +pick.value; pick.blur(); render(); });
  q('.heat-x').addEventListener('click', function () { if (btn) btn.click(); });

  // ---------- placement: on the left inside the safe margin, below the bar, beside or below the open pills ----------
  // Each candidate top (just below the bar, or just below an open pill) gets the widest maps that fit between the
  // pills still beside it and the bottom chrome; the panel takes the candidate with the biggest maps. When none fits,
  // it takes the smallest maps where it covers least of the pills.
  var MAP_MIN = 110, MAP_MAX = 230, GAP = 12;
  var mapW = 200;
  function rectOf(id) {
    var e = document.getElementById(id);
    if (!e || e.hidden) return null;
    var r = e.getBoundingClientRect();
    return r.width && r.height ? r : null;
  }
  function place() {
    if (!panel.offsetWidth) return false;
    var W = innerWidth, Hh = innerHeight, sx = Math.max(12, 0.05 * W), sy = Math.max(12, 0.05 * Hh);
    var maxW = W < 760 ? W - 2 * sx : clamp(0.36 * W, 420, 560), left = sx, right = left + maxW;
    var pad = panel.offsetWidth - panel.clientWidth + 28; // border + padding
    var chrome = panel.offsetHeight - mapW * ASPECT; // everything but the maps
    var first = sy, bar = rectOf('bar');
    if (bar) first = Math.max(first, bar.bottom + 8);
    var bottom = Hh - sy;
    ['scorebug', 'controls', 'replayLabel'].forEach(function (k) {
      var r = rectOf(k);
      if (r && r.left < right + 8 && r.right > left - 8) bottom = Math.min(bottom, r.top - 8);
    });
    var pills = [];
    document.querySelectorAll('#pills .pill.open').forEach(function (p) {
      var r = p.getBoundingClientRect();
      if (r.width && r.left < right + 8 && r.right > left - 8) pills.push(r);
    });
    var tops = [first].concat(pills.map(function (r) { return r.bottom + 8; })).filter(function (t) { return t >= first; });
    var best = null;
    tops.forEach(function (t) {
      var lim = right, ok = true;
      pills.forEach(function (r) {
        if (r.bottom + 8 <= t || r.top - 8 >= bottom) return; // not beside this slot
        if (r.left - 8 < left + pad + GAP + 2 * MAP_MIN) ok = false; else lim = Math.min(lim, r.left - 8);
      });
      var w = Math.min(MAP_MAX, Math.floor((lim - left - pad - GAP) / 2), Math.floor((bottom - t - chrome) / ASPECT));
      if (ok && w >= MAP_MIN && (!best || w > best.w)) best = { t: t, w: w };
    });
    if (!best) {
      // no slot fits: the smallest maps, in the slot that covers least of the Duel pill (its Push button above all),
      // then least of the other pills, kept above the bottom chrome
      setMapW(MAP_MIN);
      var h = panel.offsetHeight, pw = panel.offsetWidth, duel = document.getElementById('pill-duel');
      var dr = duel && duel.classList.contains('open') ? duel.getBoundingClientRect() : null;
      var cover = function (r, t) {
        if (!r) return 0;
        return Math.max(0, Math.min(left + pw, r.right) - Math.max(left, r.left)) * Math.max(0, Math.min(t + h, r.bottom) - Math.max(t, r.top));
      };
      tops.concat([bottom - h]).forEach(function (t0) {
        var t = Math.max(first, Math.min(t0, bottom - h));
        var d = cover(dr, t), all = pills.reduce(function (sum, r) { return sum + cover(r, t); }, 0);
        if (!best || d < best.d || (d === best.d && all < best.all)) best = { t: t, w: MAP_MIN, d: d, all: all };
      });
    }
    panel.style.left = left + 'px'; panel.style.top = Math.round(best.t) + 'px';
    setMapW(best.w);
    // a narrower panel wraps the sentence onto more lines: shrink the maps until it fits
    for (var n = 0; n < 3; n++) {
      var over = panel.offsetHeight - (bottom - best.t);
      if (over <= 0 || mapW <= MAP_MIN) break;
      setMapW(Math.max(MAP_MIN, Math.floor(mapW - over / ASPECT)));
    }
    return true;
  }
  function setMapW(w) { mapW = w; panel.style.setProperty('--heat-map', w + 'px'); }

  // ---------- render ----------
  var drawnKey = null;
  function render() {
    var S = TD.state, open = !!(S.pills && S.pills.heat);
    panel.classList.toggle('open', open);
    if (!open || !S.overlay) { drawnKey = null; return; }
    var id = current();
    renderPick(id);
    var base = baselineOf(id), now = tonight(id);
    // text first: placement measures the panel with it
    q('.heat-n[data-k=base]').textContent = base ? (WEEKS ? WEEKS + ' · ' : '') + plural(base.plays, 'snap') : (WEEKS || '');
    q('.heat-n[data-k=now]').textContent = now.snaps ? plural(now.snaps, 'snap') : 'no snaps yet';
    q('.heat-empty[data-k=base]').textContent = base ? '' : H ? 'No earlier games yet' : 'Earlier games did not load (data/heat.js)';
    q('.heat-empty[data-k=now]').textContent = now.snaps ? '' : 'Not on the field yet tonight';
    q('.heat-line').textContent = sentence(id, base, now);
    place();
    var key = [id, S.i, now.counted, mapW, window.devicePixelRatio || 1].join('|');
    if (key === drawnKey) return;
    drawnKey = key;
    var dB = base ? density(base.cells) : null, dN = density(now.cells), vmax = Math.max(maxOf(dB), maxOf(dN));
    drawMap(q('canvas[data-k=base]'), dB, vmax, mapW);
    drawMap(q('canvas[data-k=now]'), dN, vmax, mapW);
  }
  TD.onRender.push(render);

  // the play on screen joins "tonight" the moment its tracking arrives, which can fall between overlay renders
  var lastSig = null;
  (function tick() {
    var S = TD.state, sig = S.i + '|' + TD.isReady(S.i);
    if (sig !== lastSig) { lastSig = sig; if (S.pills.heat && S.overlay) render(); }
    requestAnimationFrame(tick);
  })();
  function relayout() { if (panel.classList.contains('open') && TD.state.overlay) render(); }
  window.addEventListener('resize', relayout);
  if (window.ResizeObserver) { var ro = new ResizeObserver(relayout); ro.observe(document.getElementById('pills')); ro.observe(document.getElementById('bar')); }
  new MutationObserver(relayout).observe(document.getElementById('overlay'), { attributes: true, attributeFilter: ['style', 'class'] });

  // #heat=1 opens the panel (app.js); #heatPlayer=<nflId> picks whose map
  function applyHash() {
    var m = /(?:^#|&)heatPlayer=(\d+)/.exec(location.hash);
    choice = m && info[+m[1]] ? +m[1] : null;
    lastSel = TD.selected();
    render();
  }
  window.addEventListener('hashchange', applyHash);
  applyHash();
})();
