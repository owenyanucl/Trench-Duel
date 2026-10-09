// Private controller. The draft scene lives only in this page (and sessionStorage);
// the server receives it only when the creator presses Publish.
'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const STORE = 'replayDraft';
  const ui = {
    play: $('play'), desc: $('playDesc'), preview: $('preview'), pPlay: $('pPlay'), speed: $('speed'), scrub: $('scrub'),
    frameLabel: $('frameLabel'), player: $('player'), hint: $('hint'), readout: $('readout'),
    publish: $('publish'), sPlay: $('sPlay'), sPause: $('sPause'), hide: $('hide'), live: $('live'),
    status: $('streamStatus'), diff: $('diff'), mirror: $('mirror'),
  };
  const previewCard = Replay.mountCard(ui.preview);

  let catalogue = [];
  let play = null;           // indexed play for the draft
  let draft = null;          // {playKey, frameId, selectedPlayerId, layers}
  let published = null;      // last /api/events message
  const preview = { playing: false, speed: 1, last: 0, acc: 0 };

  const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : 'unavailable');

  function describe(p) {
    const dd = ({ 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' })[p.down];
    return `${p.possessionTeam} vs ${p.defensiveTeam} · Q${p.quarter} ${p.gameClock} · ${dd ? `${dd} & ${p.yardsToGo}` : ''} · game ${p.gameId}, play ${p.playId}`;
  }

  function snapshot() {
    return {
      playKey: draft.playKey, frameId: draft.frameId, selectedPlayerId: draft.selectedPlayerId,
      layers: { ...draft.layers }, contextVisible: draft.layers.context,
    };
  }

  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (e) { /* storage unavailable */ }
  }

  // Optional draft preset, e.g. #play=gronkowski-play&frame=39&player=35481&layers=trails,receiverSpacing,context
  function fromHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get('play')) return null;
    const on = new Set((h.get('layers') || '').split(','));
    return {
      playKey: h.get('play'), frameId: Number(h.get('frame')),
      selectedPlayerId: h.get('player') ? Number(h.get('player')) : null,
      layers: Object.fromEntries(Replay.LAYERS.map((k) => [k, on.has(k)])),
    };
  }

  function restore() {
    try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }

  // Changing play resets the selection, frame and event jumps; layer toggles carry over.
  async function setPlay(key, from) {
    stopPreview();
    const next = await Replay.loadPlay(key);
    const layers = from?.layers || draft?.layers || { trails: true, receiverSpacing: false, qbRusher: false, context: false };
    play = next;
    const snap = play.timing.snapFrame;
    let frameId = play.byId.has(snap) ? snap : play.firstFrameId;
    let selected = null;
    if (from && from.playKey === key) {
      if (play.byId.has(from.frameId)) frameId = from.frameId;
      if (play.players.has(from.selectedPlayerId)) selected = from.selectedPlayerId;
    }
    draft = { playKey: key, frameId, selectedPlayerId: selected, layers: { ...layers } };
    if (draft.layers.receiverSpacing && draft.layers.qbRusher) draft.layers.qbRusher = false;
    ui.play.value = key;
    const entry = catalogue.find((p) => p.playKey === key);
    ui.desc.textContent = `${describe(entry)}. ${entry.playDescription}`;
    ui.scrub.min = play.firstFrameId;
    ui.scrub.max = play.lastFrameId;
    fillPlayers();
    render();
  }

  function fillPlayers() {
    const groups = [[play.offense, true], [play.defense, false]];
    const opts = ['<option value="">No player selected</option>'];
    for (const [team, offense] of groups) {
      const list = [...play.players.values()].filter((p) => p.offense === offense).sort((a, b) => (a.jersey ?? 999) - (b.jersey ?? 999));
      opts.push(`<optgroup label="${team} ${offense ? 'offense' : 'defense'}">`);
      for (const p of list) opts.push(`<option value="${p.id}">${p.jersey ?? '?'} ${escapeHtml(p.name)} · ${escapeHtml(p.role || 'role unavailable')}</option>`);
      opts.push('</optgroup>');
    }
    ui.player.innerHTML = opts.join('');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setFrame(frameId) {
    draft.frameId = Math.max(play.firstFrameId, Math.min(play.lastFrameId, frameId));
    render();
  }

  function render() {
    if (!play) return;
    const scene = snapshot();
    previewCard.innerHTML = Replay.renderCard(play, scene, draft.frameId, { interactive: true });
    previewCard.hidden = false;
    ui.scrub.value = draft.frameId;
    const t = Replay.secondsFromSnap(play, draft.frameId);
    ui.frameLabel.textContent = `frame ${draft.frameId} / ${play.lastFrameId} · ${t == null ? 'snap unavailable' : `${t >= 0 ? '+' : ''}${t.toFixed(1)} s`}`;
    ui.pPlay.textContent = preview.playing ? 'Pause' : 'Play';
    const timing = play.timing;
    const jumps = { snap: timing.snapFrame, release: timing.releaseFrame, sack: timing.sackFrame, last: play.lastFrameId };
    document.querySelectorAll('[data-jump]').forEach((b) => {
      const f = jumps[b.dataset.jump];
      b.disabled = !(typeof f === 'number' && play.byId.has(f));
      b.title = b.disabled ? 'No recorded marker for this play' : `Frame ${f}`;
    });
    ui.player.value = draft.selectedPlayerId == null ? '' : String(draft.selectedPlayerId);
    document.querySelectorAll('[data-layer]').forEach((c) => { c.checked = !!draft.layers[c.dataset.layer]; });

    const sel = draft.selectedPlayerId != null ? play.players.get(draft.selectedPlayerId) : null;
    let hint = '';
    if (draft.layers.receiverSpacing && !(sel && sel.offense && sel.role === 'Pass Route')) {
      hint = 'Receiver spacing needs a selected player whose role on this play is Pass Route.';
    }
    ui.hint.textContent = hint;

    const f = play.byId.get(draft.frameId);
    const parts = [`players ${f.playerCount} + ball${f.ball ? '' : ' (ball missing)'}`];
    if (sel) {
      const nd = f.ents.get(sel.id)?.nearestDefender;
      if (sel.role === 'Pass Route') parts.push(`nearest defender to ${sel.name}: ${nd ? `${nd.name} ${fmt(nd.distanceYards)} yd` : 'unavailable'}`);
    }
    const q = f.qb;
    parts.push(`nearest pass rusher: ${q ? `${play.players.get(Number(q.nearestRusherId))?.name} ${fmt(q.distanceYards)} yd` : 'unavailable'}`);
    const secs = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)} s` : 'unavailable');
    parts.push(`snap→release ${secs(play.timing.snapToReleaseSeconds)} · snap→sack ${secs(play.timing.snapToSackSeconds)}`);
    ui.readout.textContent = parts.join(' · ');
    save();
    renderStream();
  }

  // ---------- private playback ----------
  function stopPreview() { preview.playing = false; ui.pPlay.textContent = 'Play'; }

  function startPreview() {
    if (draft.frameId >= play.lastFrameId) draft.frameId = play.firstFrameId;
    preview.playing = true;
    preview.last = performance.now();
    preview.acc = 0;
    requestAnimationFrame(step);
  }

  function step(now) {
    if (!preview.playing) return;
    preview.acc += ((now - preview.last) / 1000) * 10 * preview.speed;
    preview.last = now;
    if (preview.acc >= 1) {
      const n = Math.floor(preview.acc);
      preview.acc -= n;
      const next = Math.min(play.lastFrameId, draft.frameId + n);
      if (next >= play.lastFrameId) preview.playing = false;
      setFrame(next);
    }
    if (preview.playing) requestAnimationFrame(step);
    else render();
  }

  // ---------- stream ----------
  async function post(path, body) {
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? '{}' : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function act(fn) {
    try { await fn(); } catch (e) { ui.status.textContent = `Not sent: ${e.message}`; }
  }

  let mirrorFrame = null;
  const mirror = new Replay.PublishedView(ui.mirror, (info) => { mirrorFrame = info; renderStream(); });

  function renderStream() {
    const pub = published && published.published;
    ui.sPlay.disabled = !pub || pub.playhead.playing;
    ui.sPause.disabled = !pub || !pub.playhead.playing;
    ui.hide.disabled = !pub;
    ui.live.textContent = pub ? 'ON AIR' : 'OFF AIR';
    ui.live.classList.toggle('on', !!pub);
    if (!pub) {
      ui.status.textContent = published ? 'Nothing on stream. The output is empty.' : 'Connecting to the server…';
      ui.diff.textContent = '';
      return;
    }
    const entry = catalogue.find((p) => p.playKey === pub.scene.playKey);
    const frame = mirrorFrame ? mirrorFrame.frame : pub.playhead.anchorFrameId;
    ui.status.textContent = `${entry ? `${entry.possessionTeam} vs ${entry.defensiveTeam}, play ${entry.playId}` : pub.scene.playKey} · frame ${frame} of ${pub.lastFrameId} · ${pub.playhead.playing ? 'playing' : 'paused'}`;
    if (draft) {
      const d = snapshot();
      const same = d.playKey === pub.scene.playKey && d.frameId === pub.scene.frameId
        && d.selectedPlayerId === pub.scene.selectedPlayerId
        && Replay.LAYERS.every((k) => d.layers[k] === pub.scene.layers[k]);
      ui.diff.textContent = same ? '' : 'Your draft differs from what is on stream. Publish to send it.';
    }
  }

  // ---------- wiring ----------
  ui.play.addEventListener('change', () => setPlay(ui.play.value));
  ui.pPlay.addEventListener('click', () => { if (preview.playing) { stopPreview(); render(); } else startPreview(); });
  ui.speed.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-speed]');
    if (!b) return;
    preview.speed = Number(b.dataset.speed);
    ui.speed.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  ui.scrub.addEventListener('input', () => { stopPreview(); setFrame(Number(ui.scrub.value)); });
  document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
    const t = play.timing;
    const f = { snap: t.snapFrame, release: t.releaseFrame, sack: t.sackFrame, last: play.lastFrameId }[b.dataset.jump];
    if (typeof f === 'number' && play.byId.has(f)) { stopPreview(); setFrame(f); }
  }));
  ui.player.addEventListener('change', () => {
    const id = ui.player.value === '' ? null : Number(ui.player.value);
    draft.selectedPlayerId = id != null && play.players.has(id) ? id : null;
    render();
  });
  ui.preview.addEventListener('click', (e) => {
    const g = e.target.closest('[data-id]');
    if (!g) return;
    const id = Number(g.dataset.id);
    if (play.players.has(id)) { draft.selectedPlayerId = id; render(); }
  });
  document.querySelectorAll('[data-layer]').forEach((c) => c.addEventListener('change', () => {
    draft.layers[c.dataset.layer] = c.checked;
    // One primary metric at a time.
    if (c.checked && c.dataset.layer === 'receiverSpacing') draft.layers.qbRusher = false;
    if (c.checked && c.dataset.layer === 'qbRusher') draft.layers.receiverSpacing = false;
    render();
  }));
  ui.publish.addEventListener('click', () => act(() => post('/api/publish', snapshot())));
  ui.sPlay.addEventListener('click', () => act(() => post('/api/stream/play')));
  ui.sPause.addEventListener('click', () => act(() => post('/api/stream/pause')));
  ui.hide.addEventListener('click', () => act(() => post('/api/hide')));
  ui.outputUrl = $('outputUrl');
  ui.outputUrl.textContent = `${location.origin}/replay/output`;

  Replay.subscribe(
    (msg) => { published = msg; mirror.update(msg); renderStream(); },
    (hb) => mirror.clock(hb.serverNowMs),
    (ok) => { if (!ok) ui.status.textContent = 'Reconnecting to the server…'; },
  );

  (async () => {
    catalogue = await Replay.catalogue();
    ui.play.innerHTML = catalogue.map((p) => `<option value="${escapeHtml(p.playKey)}">${escapeHtml(`${p.possessionTeam} vs ${p.defensiveTeam} · ${p.passResult === 'S' ? 'Sack' : 'Pass'} · ${p.playDescription}`)}</option>`).join('');
    const saved = fromHash() || restore();
    const key = saved && catalogue.some((p) => p.playKey === saved.playKey) ? saved.playKey : catalogue[0].playKey;
    await setPlay(key, saved);
  })();
})();
