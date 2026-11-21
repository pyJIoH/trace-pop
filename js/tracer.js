/* Trace Pop — the tracing engine. Pure logic, no DOM: it is fed pointer positions in glyph units
   and reports how much of the glyph is drawn, so tools/check.mjs can run it in Node.

   The child draws freely: anywhere, in any order and direction, in one go or in many little
   pieces. Nothing is on rails. The engine only watches which parts of the letter's road the finger
   has passed over; a stroke is done when nearly all of it is covered, the glyph when every stroke
   is. A tap or a few lines across cover too little to count. */
(function () {
  'use strict';
  const TP = (window.TP = window.TP || {});

  /** Every number that shapes how drawing feels, in one place. Units are glyph units (height 100). */
  TP.TUNING = {
    // --- engine ---
    coverUnits: 12,    // the finger covers the road within this distance …
    coverPx: 24,       // … or within this many screen pixels, whichever is more
    strokeDoneAt: 0.9, // a stroke is done when this much of it is covered
    subStep: 2,        // a fast finger move is walked in steps this long

    // --- drawing ---
    viewPad: 15,       // empty space around the glyph inside the picture
    roadW: 16,
    trailW: 12,        // a finished stroke, and the tint on the covered parts of the road
    inkW: 8,           // the child's own line

    // --- demo and hints ---
    demoMsPer100: 1200, // hand speed: this long per 100 units …
    demoMinMs: 1000,    // … but each stroke takes at least this
    demoMaxMs: 1500,    // … and at most this
    hintIdleMs: 7000,   // nothing drawn for this long: the hand shows how
    hintRepeatMs: 10000, // … and again after this long, for as long as nothing happens
    nextPopMs: 1500,    // after a finished letter, the "next one" card appears this much later
    replayGapMs: 1500,  // taps on a finished letter repeat the party no more often than this

    // --- sound ---
    noteEvery: 0.1,     // a note for every 10% of the glyph
  };

  /**
   * createTracer(glyph, { pxPerUnit, tuning })
   *   down(id, x, y) → true if this pointer is now the one drawing
   *   move(id, x, y), up(id), cancel(id)
   *   on('progress' | 'strokeDone' | 'glyphDone' | 'release', fn)
   *   state() → { strokes: [{ t, done }], t, done, active }   (t = covered part, 0…1)
   *   runs(i) → the covered pieces of stroke i as index ranges [[from, to], …]
   */
  TP.createTracer = function (glyph, opts) {
    opts = opts || {};
    const cfg = Object.assign({}, TP.TUNING, opts.tuning);
    const strokes = TP.glyphs.sampled(glyph);
    let pxPerUnit = opts.pxPerUnit || 4;

    const covered = strokes.map((st) => new Uint8Array(st.n)); // per point of the road: 1 = drawn over
    const count = strokes.map(() => 0);
    const finished = strokes.map(() => false);
    const version = strokes.map(() => 0); // grows whenever a stroke's coverage changes
    const points = strokes.reduce((sum, st) => sum + st.n, 0);
    let active = null; // the one pointer that is drawing: { id, x, y, gained }
    let done = false;
    const handlers = {};

    const emit = (name, data) => {
      const list = handlers[name];
      if (list) for (const fn of list.slice()) fn(data);
    };
    const radius = () => Math.max(cfg.coverUnits, cfg.coverPx / pxPerUnit);

    function state() {
      let all = 0;
      const list = strokes.map((st, i) => { all += count[i]; return { t: count[i] / st.n, done: finished[i] }; });
      return { strokes: list, t: all / points, done, active: active !== null };
    }

    /** The finger is at (x, y): the road points near it are now drawn over. */
    function mark(x, y) {
      const r = radius();
      if (x < -r || y < -r || x > glyph.w + r || y > 100 + r) return 0;
      const r2 = r * r;
      let gained = 0;
      for (let i = 0; i < strokes.length; i++) {
        if (finished[i]) continue;
        const st = strokes[i];
        const c = covered[i];
        let got = 0;
        for (let k = 0; k < st.n; k++) {
          if (c[k]) continue;
          const dx = st.x[k] - x;
          const dy = st.y[k] - y;
          if (dx * dx + dy * dy <= r2) { c[k] = 1; got++; }
        }
        if (got) { count[i] += got; version[i]++; gained += got; }
      }
      return gained;
    }

    /** After the finger moved: report, and close the strokes that are covered enough. */
    function settle(x, y, gained) {
      if (!gained) return;
      if (active) active.gained += gained;
      for (let i = 0; i < strokes.length; i++) {
        if (finished[i] || count[i] < strokes[i].n * cfg.strokeDoneAt) continue;
        finished[i] = true;
        covered[i].fill(1);
        count[i] = strokes[i].n;
        version[i]++;
        done = finished.every(Boolean);
        emit('strokeDone', { stroke: i, last: done });
      }
      emit('progress', Object.assign(state(), { x, y }));
      if (done) {
        active = null;
        emit('glyphDone', { id: glyph.id });
      }
    }

    return {
      glyph,
      state,
      version: (i) => version[i],
      on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); return this; },
      setScale(px) { if (px > 0) pxPerUnit = px; },

      runs(i) {
        const c = covered[i];
        const out = [];
        let from = -1;
        for (let k = 0; k < c.length; k++) {
          if (c[k] && from < 0) from = k;
          if (from >= 0 && (!c[k] || k === c.length - 1)) {
            out.push([from, c[k] ? k : k - 1]);
            from = -1;
          }
        }
        return out;
      },

      down(id, x, y) {
        if (done || active !== null) return false; // a palm or a second hand: quietly ignored
        active = { id, x, y, gained: 0 };
        settle(x, y, mark(x, y));
        return true;
      },

      move(id, x, y) {
        if (!active || id !== active.id || done) return;
        const a = active;
        const steps = Math.max(1, Math.ceil(Math.hypot(x - a.x, y - a.y) / cfg.subStep));
        let gained = 0;
        for (let k = 1; k <= steps; k++) gained += mark(a.x + ((x - a.x) * k) / steps, a.y + ((y - a.y) * k) / steps);
        a.x = x;
        a.y = y;
        settle(x, y, gained);
      },

      up(id) {
        if (!active || id !== active.id) return;
        const gained = active.gained;
        active = null;
        emit('release', { gained });
      },

      cancel(id) { this.up(id); },
    };
  };
})();
