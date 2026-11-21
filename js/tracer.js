/* Trace Pop — the tracing engine. Pure logic, no DOM: it is fed pointer positions in glyph units
   and reports how much of the glyph is drawn, so tools/check.mjs can run it in Node.

   The child draws freely inside the figure: in any order and direction, in one go or in many
   little pieces. Nothing is on rails, but only the figure itself can be drawn on: a finger that
   is off the letter's road draws nothing and counts for nothing, and the finger has to travel
   along the figure: a scribble that merely crosses it, however dense, leaves nothing behind.
   The engine watches which parts of the road the finger has run along; a stroke is done when
   nearly all of it is covered, the glyph when every stroke is. */
(function () {
  'use strict';
  const TP = (window.TP = window.TP || {});

  /** Every number that shapes how drawing feels, in one place. Units are glyph units (height 100). */
  TP.TUNING = {
    // --- engine ---
    insideUnits: 10,   // the finger is "inside the figure" this close to the middle of the road
    insidePx: 20,      // (half the road is 8) … or this close in screen pixels, whichever is more
    minRun: 32,        // the finger must travel this far inside the figure, without leaving it, for
                       // its line to stay (straight across the road is about 20: that does not)
    coverUnits: 12,    // a finger inside the figure covers the road within this distance …
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
   *   on('runStart' | 'runPoint' | 'runEnd', fn) — the child's line: it starts where the finger
   *     enters the figure, and ends where it leaves ({ kept: false } if it was too short to stay)
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
    let active = null; // the one pointer that is drawing: { id, x, y, gained, run }
    let done = false;
    const handlers = {};

    const emit = (name, data) => {
      const list = handlers[name];
      if (list) for (const fn of list.slice()) fn(data);
    };
    const radius = () => Math.max(cfg.coverUnits, cfg.coverPx / pxPerUnit);
    const insideR = () => Math.max(cfg.insideUnits, cfg.insidePx / pxPerUnit);

    /** Is the point on the figure (on the road of any stroke)? */
    function inside(x, y) {
      const r = insideR();
      if (x < -r || y < -r || x > glyph.w + r || y > 100 + r) return false;
      const r2 = r * r;
      for (const st of strokes) {
        for (let k = 0; k < st.n; k++) {
          const dx = st.x[k] - x;
          const dy = st.y[k] - y;
          if (dx * dx + dy * dy <= r2) return true;
        }
      }
      return false;
    }

    function state() {
      let all = 0;
      const list = strokes.map((st, i) => { all += count[i]; return { t: count[i] / st.n, done: finished[i] }; });
      return { strokes: list, t: all / points, done, active: active !== null };
    }

    /** The finger's line ends here (it left the figure, or lifted). */
    function endRun() {
      const a = active;
      if (!a || !a.run) return;
      const kept = a.run.live;
      a.run = null;
      emit('runEnd', { kept });
    }

    /**
     * One small step of the finger. Inside the figure it draws a line; the line starts to count
     * (and what it has passed so far is counted too) once it is long enough to be a line along the
     * figure rather than a crossing of it.
     */
    function feed(x, y) {
      const a = active;
      if (!inside(x, y)) { endRun(); return 0; }
      if (!a.run) {
        a.run = { len: 0, x, y, wait: [[x, y]], live: false };
        emit('runStart', { x, y });
        return 0;
      }
      const run = a.run;
      run.len += Math.hypot(x - run.x, y - run.y);
      run.x = x;
      run.y = y;
      emit('runPoint', { x, y });
      if (run.live) return mark(x, y);
      run.wait.push([x, y]);
      if (run.len < Math.max(cfg.minRun, insideR() * 3.2)) return 0;
      run.live = true;
      let gained = 0;
      for (const [px, py] of run.wait) gained += mark(px, py);
      run.wait = null;
      return gained;
    }

    /** The road points near (x, y) are now drawn over. */
    function mark(x, y) {
      const r = radius();
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
        endRun();
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
        active = { id, x, y, gained: 0, run: null };
        feed(x, y);
        return true;
      },

      move(id, x, y) {
        if (!active || id !== active.id || done) return;
        const a = active;
        const steps = Math.max(1, Math.ceil(Math.hypot(x - a.x, y - a.y) / cfg.subStep));
        let gained = 0;
        const fromX = a.x;
        const fromY = a.y;
        a.x = x;
        a.y = y;
        for (let k = 1; k <= steps; k++) gained += feed(fromX + ((x - fromX) * k) / steps, fromY + ((y - fromY) * k) / steps);
        settle(x, y, gained);
      },

      up(id) {
        if (!active || id !== active.id) return;
        endRun();
        const gained = active.gained;
        active = null;
        emit('release', { gained });
      },

      cancel(id) { this.up(id); },
    };
  };
})();
