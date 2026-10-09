// Shared replay renderer for the private controller and the audience output.
// A scene is {playKey, frameId, selectedPlayerId, layers {trails, receiverSpacing, qbRusher, context}, contextVisible}.
// The card is drawn at a fixed design size and scaled to its host, so the preview,
// the on-stream mirror and the audience output show the same picture.
'use strict';

(function () {
  const FIELD_W = 53.3;
  const S = 10;                       // SVG units per yard
  const CARD_W = 1200, CARD_H = 640;
  const SIDE_W = 380, HEAD_H = 54, FOOT_H = 46;
  const FIELD_PX_W = CARD_W - SIDE_W, FIELD_PX_H = CARD_H - HEAD_H - FOOT_H;
  const WINDOW_YD = FIELD_W * FIELD_PX_W / FIELD_PX_H;   // field window keeps the physical aspect ratio
  const LAYERS = ['trails', 'receiverSpacing', 'qbRusher', 'context'];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const yd = (v) => (num(v) == null ? 'unavailable' : `${v.toFixed(1)} yd`);
  const sec = (v) => (num(v) == null ? 'unavailable' : `${v.toFixed(1)} s`);
  const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };

  // ---------- data ----------
  let catalogueP = null;
  const playCache = new Map();

  function catalogue() {
    if (!catalogueP) catalogueP = fetch('/api/plays').then((r) => r.json());
    return catalogueP;
  }

  function loadPlay(key) {
    if (!playCache.has(key)) {
      playCache.set(key, catalogue().then((list) => {
        const entry = list.find((p) => p.playKey === key);
        if (!entry) throw new Error(`Unknown play ${key}`);
        return fetch(`/replay/${entry.file}`).then((r) => r.json()).then((raw) => index(raw, key));
      }));
    }
    return playCache.get(key);
  }

  function index(raw, key) {
    const rp = raw.recordedPlay || {};
    const offense = rp.possessionTeam;
    const frames = raw.frames.map((f) => {
      const ents = new Map();
      let ball = null;
      for (const e of f.entities) {
        if (e.team === 'football') ball = e;
        else if (e.nflId != null) ents.set(Number(e.nflId), e);
      }
      return { id: f.frameId, t: num(f.secondsFromSnap), events: f.events || [], ents, ball, qb: f.qbToNearestRusher, playerCount: f.playerCount };
    });
    const byId = new Map(frames.map((f) => [f.id, f]));
    const frameIds = frames.map((f) => f.id);
    const players = new Map();
    for (const f of frames) {
      for (const [id, e] of f.ents) {
        if (!players.has(id)) players.set(id, { id, name: e.name, jersey: num(e.jersey), team: e.team, role: e.role, offense: e.team === offense });
      }
    }
    const passers = [...players.values()].filter((p) => p.offense && p.role === 'Pass');
    const firstQb = frames.find((f) => f.qb)?.qb;
    const passerId = firstQb ? Number(firstQb.passerId) : (passers.length === 1 ? passers[0].id : null);

    let minX = Infinity, maxX = -Infinity;
    for (const f of frames) {
      for (const e of [...f.ents.values(), f.ball]) {
        if (e && num(e.x) != null) { minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x); }
      }
    }
    const c = raw.coordinates || {};
    for (const x of [c.startLineX, c.firstDownTargetX]) if (num(x) != null) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    const center = Number.isFinite(minX) ? (minX + maxX) / 2 : 60;
    const x0 = Math.max(0, Math.min(120 - WINDOW_YD, center - WINDOW_YD / 2));

    return {
      key, raw, rp, coords: c, timing: raw.timing || {}, offense, defense: rp.defensiveTeam,
      frames, byId, frameIds, firstFrameId: frameIds[0], lastFrameId: frameIds[frameIds.length - 1],
      players, passerId, x0, x1: x0 + WINDOW_YD,
    };
  }

  function playerLabel(p) {
    if (!p) return '';
    return p.jersey == null ? p.name : `${p.jersey} ${p.name}`;
  }

  function downDistance(play) {
    const { rp, coords } = play;
    const down = ORD[rp.down];
    if (!down || num(rp.yardsToGo) == null) return 'Down and distance unavailable';
    const goal = num(coords.firstDownTargetX) != null && coords.firstDownTargetX === coords.opponentGoalLineX;
    return `${down} & ${goal ? 'Goal' : rp.yardsToGo}`;
  }

  function ballOn(play) {
    const { rp } = play;
    if (num(rp.yardlineNumber) == null) return null;
    return rp.yardlineNumber === 50 ? 'Ball on midfield' : `Ball on ${rp.yardlineSide} ${rp.yardlineNumber}`;
  }

  function resultText(rp) {
    const n = num(rp.playResult);
    switch (rp.passResult) {
      case 'C': return n == null ? 'completion (yards unavailable)' : n >= 0 ? `${n}-yard completion` : `completion, ${-n}-yard loss`;
      case 'I': return 'incomplete pass';
      case 'S': return n == null ? 'sack (yards unavailable)' : n < 0 ? `sack, ${-n}-yard loss` : `sack, ${n === 0 ? 'no loss' : `${n} yards`}`;
      case 'IN': return 'interception';
      case 'R': return n == null ? 'scramble (yards unavailable)' : `scramble, ${n} yards`;
      default: return 'unavailable';
    }
  }

  function coverageText(rp) {
    const parts = [rp.pff_passCoverage, rp.pff_passCoverageType].filter((v) => v != null && v !== '');
    return parts.length ? parts.join(' / ') : 'unavailable';
  }

  function creditLines(play) {
    const rows = play.raw.retrospectiveScouting || [];
    const kinds = [['pff_sack', 'sack'], ['pff_hit', 'hit'], ['pff_hurry', 'hurry']];
    const lines = [];
    let available = false;
    for (const [field, label] of kinds) {
      if (rows.some((r) => r[field] != null)) available = true;
      const names = rows.filter((r) => r[field] === 1).map((r) => r.displayName || 'name unavailable');
      if (names.length) lines.push(`Recorded ${label} credit: ${names.join(', ')}`);
    }
    if (!lines.length) lines.push(available ? 'Recorded pressure credits: none' : 'Recorded pressure credits: unavailable');
    return lines;
  }

  // Which single metric the card shows. Receiver spacing needs a selected route runner.
  function primaryMetric(play, scene) {
    const sel = scene.selectedPlayerId != null ? play.players.get(scene.selectedPlayerId) : null;
    if (scene.layers.receiverSpacing && sel && sel.offense && sel.role === 'Pass Route') return 'spacing';
    if (scene.layers.qbRusher && play.passerId != null) return 'qb';
    return null;
  }

  function spacingSeries(play, id) {
    return play.frames.map((f) => {
      const nd = f.ents.get(id)?.nearestDefender;
      return { f: f.id, d: nd ? num(nd.distanceYards) : null, otherId: nd ? Number(nd.nflId) : null, otherName: nd ? nd.name : null };
    });
  }

  function qbSeries(play) {
    return play.frames.map((f) => {
      const q = f.qb;
      const other = q ? play.players.get(Number(q.nearestRusherId)) : null;
      return { f: f.id, d: q ? num(q.distanceYards) : null, otherId: q ? Number(q.nearestRusherId) : null, otherName: other ? other.name : null };
    });
  }

  function secondsFromSnap(play, frameId) {
    const snap = play.timing.snapFrame;
    return num(snap) == null ? null : (frameId - snap) / 10;
  }

  // ---------- field ----------
  const sx = (x) => (x * S).toFixed(1);
  const sy = (y) => ((FIELD_W - y) * S).toFixed(1);

  function fieldBackground(play) {
    const out = [];
    const { x0, x1 } = play;
    out.push(`<rect x="${sx(x0)}" y="0" width="${sx(x1 - x0)}" height="${FIELD_W * S}" class="f-grass"/>`);
    if (x0 < 10) out.push(`<rect x="${sx(x0)}" y="0" width="${sx(10 - x0)}" height="${FIELD_W * S}" class="f-endzone"/>`);
    if (x1 > 110) out.push(`<rect x="${sx(110)}" y="0" width="${sx(x1 - 110)}" height="${FIELD_W * S}" class="f-endzone"/>`);
    for (let x = Math.ceil(x0); x <= Math.floor(x1); x++) {
      if (x < 10 || x > 110) continue;
      if (x % 5 === 0) {
        out.push(`<line x1="${sx(x)}" y1="0" x2="${sx(x)}" y2="${FIELD_W * S}" class="${x === 10 || x === 110 ? 'f-goal' : 'f-yard'}"/>`);
        if (x % 10 === 0 && x !== 10 && x !== 110) {
          const n = x <= 60 ? x - 10 : 110 - x;
          out.push(`<text x="${sx(x)}" y="${sy(6)}" class="f-num">${n}</text><text x="${sx(x)}" y="${sy(FIELD_W - 8)}" class="f-num">${n}</text>`);
        }
      } else {
        for (const hy of [1, 23.6, 29.7, FIELD_W - 1]) out.push(`<line x1="${sx(x)}" y1="${sy(hy - 0.4)}" x2="${sx(x)}" y2="${sy(hy + 0.4)}" class="f-hash"/>`);
      }
    }
    return out.join('');
  }

  function trailPath(play, id, frameId) {
    let d = '', pen = false;
    for (const f of play.frames) {
      if (f.id > frameId) break;
      const e = f.ents.get(id);
      if (!e || num(e.x) == null || num(e.y) == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${sx(e.x)} ${sy(e.y)}`;
      pen = true;
    }
    return d;
  }

  function renderField(play, scene, frameId, opts) {
    const f = play.byId.get(frameId);
    const metric = primaryMetric(play, scene);
    const selId = scene.selectedPlayerId;
    const out = [`<svg class="rp-svg" viewBox="${sx(play.x0)} 0 ${sx(play.x1 - play.x0)} ${FIELD_W * S}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Field reconstruction">`];
    out.push(fieldBackground(play));

    const c = play.coords;
    if (num(c.startLineX) != null) out.push(`<line x1="${sx(c.startLineX)}" y1="0" x2="${sx(c.startLineX)}" y2="${FIELD_W * S}" class="f-los"/><text x="${sx(c.startLineX)}" y="${sy(FIELD_W - 2.2)}" class="f-linetag f-los-tag">Line of scrimmage</text>`);
    if (num(c.firstDownTargetX) != null) out.push(`<line x1="${sx(c.firstDownTargetX)}" y1="0" x2="${sx(c.firstDownTargetX)}" y2="${FIELD_W * S}" class="f-target"/><text x="${sx(c.firstDownTargetX)}" y="${sy(1.6)}" class="f-linetag f-target-tag">First-down target</text>`);
    if (c.attackDirection === 'left' || c.attackDirection === 'right') {
      const right = c.attackDirection === 'right';
      const ax = right ? play.x0 + 2 : play.x1 - 2;
      out.push(`<text x="${sx(ax)}" y="${sy(FIELD_W / 2)}" class="f-attack" text-anchor="${right ? 'start' : 'end'}">${right ? `${esc(play.offense)} attack →` : `← ${esc(play.offense)} attack`}</text>`);
    }
    if (!f) { out.push('</svg>'); return out.join(''); }

    const highlight = [];
    if (selId != null && f.ents.has(selId)) highlight.push(selId);

    // trails
    if (scene.layers.trails) {
      const ids = new Set();
      if (selId != null) ids.add(selId);
      if (metric === 'qb' && f.qb) { ids.add(Number(f.qb.passerId)); ids.add(Number(f.qb.nearestRusherId)); }
      for (const id of ids) {
        const p = play.players.get(id);
        out.push(`<path d="${trailPath(play, id, frameId)}" class="f-trail ${p && p.offense ? 'off' : 'def'}"/>`);
      }
    }

    // metric connector
    let link = null;
    if (metric === 'spacing') {
      const nd = f.ents.get(selId)?.nearestDefender;
      if (nd) link = { a: selId, b: Number(nd.nflId), d: num(nd.distanceYards), cls: 'spacing' };
    } else if (metric === 'qb' && f.qb) {
      link = { a: Number(f.qb.passerId), b: Number(f.qb.nearestRusherId), d: num(f.qb.distanceYards), cls: 'qb' };
      if (!highlight.includes(link.a)) highlight.push(link.a);
    }
    if (link) {
      if (!highlight.includes(link.b)) highlight.push(link.b);
      const ea = f.ents.get(link.a), eb = f.ents.get(link.b);
      if (ea && eb) {
        out.push(`<line x1="${sx(ea.x)}" y1="${sy(ea.y)}" x2="${sx(eb.x)}" y2="${sy(eb.y)}" class="f-link ${link.cls}"/>`);
      }
    }

    // players
    const dots = [];
    for (const [id, e] of f.ents) {
      if (num(e.x) == null || num(e.y) == null) continue;
      const p = play.players.get(id);
      const hl = highlight.includes(id);
      const cls = `f-pl ${p.offense ? 'off' : 'def'}${hl ? ' hl' : ''}${id === selId ? ' sel' : ''}${opts.interactive ? ' click' : ''}`;
      const g = `<g class="${cls}" data-id="${id}"><circle cx="${sx(e.x)}" cy="${sy(e.y)}" r="${0.95 * S}"/>${p.jersey == null ? '' : `<text x="${sx(e.x)}" y="${sy(e.y)}" class="f-jersey">${p.jersey}</text>`}</g>`;
      if (hl) dots.push(g); else out.push(g);
    }
    out.push(...dots);
    if (f.ball && num(f.ball.x) != null && num(f.ball.y) != null) {
      out.push(`<ellipse cx="${sx(f.ball.x)}" cy="${sy(f.ball.y)}" rx="${0.62 * S}" ry="${0.38 * S}" class="f-ball"/>`);
    }

    // labels for highlighted players: the higher of a pair is labelled above, the lower below
    const placed = highlight.map((id) => f.ents.get(id)).filter((e) => e && num(e.y) != null);
    const meanY = placed.reduce((sum, e) => sum + e.y, 0) / Math.max(1, placed.length);
    highlight.forEach((id, i) => {
      const e = f.ents.get(id);
      if (!e || num(e.y) == null) return;
      const above = placed.length < 2 || e.y > meanY || (e.y === meanY && i % 2 === 0);
      out.push(`<text x="${sx(e.x)}" y="${sy(e.y + (above ? 1.9 : -2.9))}" class="f-name">${esc(playerLabel(play.players.get(id)))}</text>`);
    });
    if (link && num(link.d) != null) {
      const ea = f.ents.get(link.a), eb = f.ents.get(link.b);
      if (ea && eb) out.push(`<text x="${sx((ea.x + eb.x) / 2 + 0.8)}" y="${sy((ea.y + eb.y) / 2)}" class="f-dist" text-anchor="start">${link.d.toFixed(1)} yd</text>`);
    }
    out.push('</svg>');
    return out.join('');
  }

  // ---------- chart ----------
  function chart(play, series, frameId, eventFrame, eventLabel) {
    const W = SIDE_W - 36, H = 128, L = 34, R = 10, T = 12, B = 24;
    const f0 = play.firstFrameId, f1 = play.lastFrameId;
    const vals = series.map((p) => p.d).filter((d) => d != null);
    const yMax = Math.max(1, Math.ceil(vals.length ? Math.max(...vals) : 1));
    const X = (f) => L + ((f - f0) / Math.max(1, f1 - f0)) * (W - L - R);
    const Y = (d) => T + (1 - d / yMax) * (H - T - B);
    let d = '', pen = false;
    for (const p of series) {
      if (p.f > frameId) break;
      if (p.d == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${X(p.f).toFixed(1)} ${Y(p.d).toFixed(1)}`;
      pen = true;
    }
    const out = [`<svg class="rp-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`];
    out.push(`<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="c-axis"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" class="c-axis"/>`);
    out.push(`<text x="${L - 5}" y="${T + 4}" class="c-lab" text-anchor="end">${yMax}</text><text x="${L - 5}" y="${H - B + 4}" class="c-lab" text-anchor="end">0</text><text x="${L - 5}" y="${(T + H - B) / 2 + 4}" class="c-lab" text-anchor="end">yd</text>`);
    const snap = play.timing.snapFrame;
    if (num(snap) != null) out.push(`<line x1="${X(snap)}" y1="${T}" x2="${X(snap)}" y2="${H - B}" class="c-mark"/><text x="${X(snap)}" y="${H - 8}" class="c-lab" text-anchor="middle">snap</text>`);
    if (num(eventFrame) != null) out.push(`<line x1="${X(eventFrame)}" y1="${T}" x2="${X(eventFrame)}" y2="${H - B}" class="c-mark"/><text x="${X(eventFrame)}" y="${H - 8}" class="c-lab" text-anchor="middle">${esc(eventLabel)}</text>`);
    out.push(`<path d="${d}" class="c-line"/>`);
    out.push(`<line x1="${X(frameId)}" y1="${T - 4}" x2="${X(frameId)}" y2="${H - B}" class="c-cursor"/>`);
    const cur = series.find((p) => p.f === frameId);
    if (cur && cur.d != null) out.push(`<circle cx="${X(frameId)}" cy="${Y(cur.d)}" r="4" class="c-dot"/>`);
    out.push('</svg>');
    return out.join('');
  }

  // ---------- card ----------
  function renderCard(play, scene, frameId, opts = {}) {
    const f = play.byId.get(frameId);
    const metric = primaryMetric(play, scene);
    const t = secondsFromSnap(play, frameId);
    const { timing } = play;
    const head = [
      `<span class="rp-dd">${esc(downDistance(play))}</span>`,
      ballOn(play) ? `<span>${esc(ballOn(play))}</span>` : '',
      `<span>Q${esc(play.rp.quarter ?? '?')} · ${esc(play.rp.gameClock ?? 'clock unavailable')} <small>recorded pre-snap clock</small></span>`,
      `<span class="rp-teams"><i class="sw off"></i>${esc(play.offense)} offense <i class="sw def"></i>${esc(play.defense)} defense</span>`,
    ].join('');

    const side = [];
    if (metric === 'spacing') {
      const sel = play.players.get(scene.selectedPlayerId);
      const nd = f?.ents.get(scene.selectedPlayerId)?.nearestDefender;
      side.push(`<div class="rp-metric"><div class="rp-kicker">Receiver spacing</div><div class="rp-who">${esc(playerLabel(sel))}</div>`
        + `<div class="rp-big">${nd && num(nd.distanceYards) != null ? `${nd.distanceYards.toFixed(1)}<small> yd</small>` : '<span class="na">unavailable</span>'}</div>`
        + `<div class="rp-line">Nearest defender: <b>${esc(nd ? nd.name : 'unavailable')}</b>${nd ? ` · ${yd(num(nd.distanceYards))}` : ''}</div>`
        + chart(play, spacingSeries(play, scene.selectedPlayerId), frameId, timing.releaseFrame ?? timing.sackFrame, timing.releaseFrame != null ? 'release' : 'sack')
        + '<div class="rp-note">Distance to the closest defender in this frame. A measurement, not coverage or catch probability.</div></div>');
    } else if (metric === 'qb') {
      const q = f?.qb;
      const rusher = q ? play.players.get(Number(q.nearestRusherId)) : null;
      side.push(`<div class="rp-metric"><div class="rp-kicker">Space around the quarterback</div><div class="rp-who">${esc(playerLabel(play.players.get(play.passerId)))}</div>`
        + `<div class="rp-big">${q && num(q.distanceYards) != null ? `${q.distanceYards.toFixed(1)}<small> yd</small>` : '<span class="na">unavailable</span>'}</div>`
        + `<div class="rp-line">Nearest pass rusher: <b>${esc(rusher ? rusher.name : 'unavailable')}</b>${q ? ` · ${yd(num(q.distanceYards))}` : ''}</div>`
        + chart(play, qbSeries(play), frameId, timing.sackFrame ?? timing.releaseFrame, timing.sackFrame != null ? 'sack' : 'release')
        + '<div class="rp-note">Distance to the closest annotated pass rusher. Blockers in between can change what it means.</div></div>');
    }
    if (scene.layers.context) {
      const lines = [`Recorded coverage: ${coverageText(play.rp)}`, ...creditLines(play), `Recorded result: ${resultText(play.rp)}`];
      const note = play.rp.passResult === 'C' ? 'The tracking clip ends before the catch.' : 'Recorded by PFF after the play, not a prediction.';
      side.push(`<div class="rp-context"><div class="rp-kicker">Recorded after the play · PFF</div>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}<div class="rp-note">${esc(note)}</div></div>`);
    }

    const timingText = num(timing.snapToReleaseSeconds) != null ? `Snap to release: ${sec(timing.snapToReleaseSeconds)}`
      : num(timing.snapToSackSeconds) != null ? `Snap to sack: ${sec(timing.snapToSackSeconds)}` : 'Snap to release: unavailable';
    const badges = [];
    if (num(timing.releaseFrame) != null && frameId >= timing.releaseFrame) badges.push('Pass released');
    if (num(timing.sackFrame) != null && frameId >= timing.sackFrame) badges.push('Sack');
    if (frameId === play.lastFrameId) badges.push('End of available tracking');
    const clock = t == null ? 'Snap time unavailable' : t < 0 ? `${(-t).toFixed(1)} s before snap` : t === 0 ? 'Snap' : `+${t.toFixed(1)} s after snap`;
    const foot = `<span class="rp-clock">${esc(clock)}</span><span>${esc(timingText)}</span>`
      + `<span class="rp-badges">${badges.map((b) => `<b>${esc(b)}</b>`).join('')}</span><span class="rp-src">Replay · reconstructed from 2021 tracking</span>`;

    return `<div class="rp-head">${head}</div><div class="rp-body"><div class="rp-field">${renderField(play, scene, frameId, opts)}</div>`
      + `<div class="rp-side">${side.join('')}</div></div><div class="rp-foot">${foot}</div>`;
  }

  // Scale a fixed-size card to fit its host, centred.
  function fit(host, card) {
    const s = Math.min(host.clientWidth / CARD_W, host.clientHeight / CARD_H);
    if (!(s > 0)) return;
    const dx = (host.clientWidth - CARD_W * s) / 2, dy = (host.clientHeight - CARD_H * s) / 2;
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  }

  function mountCard(host) {
    host.classList.add('rp-host');
    const card = document.createElement('div');
    card.className = 'rp-card';
    card.hidden = true;
    host.appendChild(card);
    const refit = () => fit(host, card);
    new ResizeObserver(refit).observe(host);
    refit();
    return card;
  }

  // Renders the published state from /api/events messages. Used by the audience
  // output and by the controller's on-stream mirror; it never sees the draft.
  class PublishedView {
    constructor(host, onFrame) {
      this.card = mountCard(host);
      this.onFrame = onFrame || (() => {});
      this.msg = null;
      this.offset = 0;
      this.play = null;
      this.drawn = null;
      const loop = () => { this.tick(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }

    clock(serverNowMs) { this.offset = serverNowMs - Date.now(); }

    update(msg) {
      this.clock(msg.serverNowMs);
      this.msg = msg;
      const pub = msg.published;
      if (!pub) { this.play = null; this.draw(); return; }
      if (!this.play || this.play.key !== pub.scene.playKey) {
        this.play = null;
        this.draw();
        loadPlay(pub.scene.playKey).then((p) => {
          if (this.msg && this.msg.published && this.msg.published.scene.playKey === p.key) { this.play = p; this.draw(); }
        });
      } else {
        this.draw();
      }
    }

    frameNow() {
      const pub = this.msg.published;
      const ph = pub.playhead;
      if (!ph.playing) return ph.anchorFrameId;
      const elapsed = Date.now() + this.offset - ph.anchorServerTimeMs;
      return Math.min(pub.lastFrameId, ph.anchorFrameId + Math.max(0, Math.floor(elapsed * ph.rateFps / 1000)));
    }

    tick() {
      const pub = this.msg && this.msg.published;
      if (pub && this.play && pub.playhead.playing && this.frameNow() !== this.drawn?.frame) this.draw();
    }

    draw() {
      const pub = this.msg && this.msg.published;
      if (!pub || !this.play || this.play.key !== pub.scene.playKey) {
        this.card.hidden = true;
        this.card.innerHTML = '';
        this.drawn = null;
        this.onFrame(null);
        return;
      }
      const frame = this.frameNow();
      this.card.innerHTML = renderCard(this.play, pub.scene, frame);
      this.card.hidden = false;
      this.drawn = { version: this.msg.version, frame };
      this.onFrame({ play: this.play, scene: pub.scene, frame, playing: pub.playhead.playing });
    }
  }

  function subscribe(onMessage, onHeartbeat, onStatus) {
    const es = new EventSource('/api/events');
    es.addEventListener('published', (ev) => onMessage(JSON.parse(ev.data)));
    es.addEventListener('heartbeat', (ev) => onHeartbeat && onHeartbeat(JSON.parse(ev.data)));
    es.onopen = () => onStatus && onStatus(true);
    es.onerror = () => onStatus && onStatus(false);
    return es;
  }

  window.Replay = {
    LAYERS, CARD_W, CARD_H,
    catalogue, loadPlay, index, renderCard, mountCard, fit, PublishedView, subscribe,
    playerLabel, downDistance, primaryMetric, secondsFromSnap,
  };
})();
