// Overlay chrome: the solid-background toggle and the bar's snap points.
// Loaded after app.js. app.js owns dragging and writes the overlay's style.left/top;
// this file only adjusts those same two properties after a drag ends, on resize and when the overlay changes size.
(function () {
  var overlay = document.getElementById('overlay'), bar = document.getElementById('bar'), handle = document.getElementById('handle');
  var solidBtn = document.getElementById('solidBtn'), hint = document.getElementById('hint');
  if (!overlay || !handle) return;

  function load(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage blocked: the choice lasts this session */ } }

  // ---------- solid background fallback ----------
  function setSolid(on) {
    document.body.classList.toggle('solid', on);
    if (solidBtn) { solidBtn.classList.toggle('on', on); solidBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  }
  setSolid(load('trenchDuel.solid') === '1');
  if (solidBtn) solidBtn.addEventListener('click', function () {
    var on = !document.body.classList.contains('solid');
    setSolid(on); save('trenchDuel.solid', on ? '1' : '0');
  });

  // ---------- snap points: top-left, top-centre, top-right ----------
  // Horizontally the bar keeps a 5% safe margin from the screen edges (less only when the open pills need the width).
  // Vertically it stays at app.js's 10px: the field starts below a band reserved for the bar and one row of pills,
  // so moving the bar lower would push open pills onto the field.
  var SNAPS = ['left', 'center', 'right'], TOP = 10;
  var snap = SNAPS.indexOf(load('trenchDuel.snap')) >= 0 ? load('trenchDuel.snap') : 'center';
  var pressed = false, moved = false;

  function xFor(s, w) {
    var W = window.innerWidth, slack = W - w, m = Math.max(8, Math.min(0.05 * W, slack / 2));
    if (s === 'left') return m;
    if (s === 'right') return Math.max(8, W - w - m);
    return Math.max(8, slack / 2); // the same centre app.js places the bar at
  }
  function setClasses() {
    overlay.classList.toggle('snap-left', snap === 'left');
    overlay.classList.toggle('snap-right', snap === 'right');
  }
  // the keyboard hint sits top-right; it is hidden whenever the bar would cover it
  function placeHint() {
    if (!hint || !bar) return;
    var b = bar.getBoundingClientRect(), h = hint.getBoundingClientRect();
    var hit = b.width > 0 && h.width > 0 && b.right + 8 > h.left && b.left < h.right && b.top < h.bottom + 4 && b.bottom + 4 > h.top;
    document.body.classList.toggle('hint-off', hit);
  }
  function apply() {
    if (pressed) { placeHint(); return; }
    var w = overlay.offsetWidth;
    if (w) { // hidden: placed again when it is shown
      var x = xFor(snap, w);
      if (Math.abs((parseFloat(overlay.style.left) || 0) - x) > 0.5) overlay.style.left = x + 'px';
      if (overlay.style.top !== TOP + 'px') overlay.style.top = TOP + 'px';
    }
    placeHint();
  }
  function nearest() {
    var w = overlay.offsetWidth, cx = overlay.offsetLeft + w / 2, best = 'center', bd = Infinity;
    SNAPS.forEach(function (s) { var d = Math.abs(xFor(s, w) + w / 2 - cx); if (d < bd) { bd = d; best = s; } });
    return best;
  }
  function setSnap(s) { snap = s; save('trenchDuel.snap', s); setClasses(); apply(); }

  handle.addEventListener('pointerdown', function () { pressed = true; moved = false; });
  handle.addEventListener('pointermove', function () { if (pressed) moved = true; });
  function release() {
    if (!pressed) return;
    pressed = false;
    if (moved) setSnap(nearest()); else apply();
  }
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  // app.js re-centres on double-click; centre is the top-centre snap
  handle.addEventListener('dblclick', function () { setSnap('center'); });

  // app.js re-places the bar at the centre whenever it re-renders; keep it on the chosen snap instead
  new MutationObserver(apply).observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
  if (window.ResizeObserver) new ResizeObserver(apply).observe(overlay);
  window.addEventListener('resize', apply);

  setClasses();
  apply();
})();
