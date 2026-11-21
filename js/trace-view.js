/* Trace Pop — the drawing screen's picture: the pale letter to draw over, the child's own line,
   the hand that shows how the letter is written, and the gentle hints.

   The child draws freely, but only inside the figure: the line appears where the finger goes on
   the letter's road and nowhere else, and it stays only if it runs along the figure (a line that
   just crosses it fades at once). The parts of the letter the finger has run along take on a tint,
   a stroke that is nearly covered fills in neatly, and when every stroke is filled the letter is done. Which parts count is decided in tracer.js; this file
   only feeds it finger positions and draws what it reports. */
(function () {
  'use strict';
  const TP = window.TP;
  const el = TP.svgEl;
  const G = TP.glyphs;
  const INK_CHUNK = 60; // points per piece of the child's line (keeps each update small)

  /**
   * createTraceView(stage, hooks)
   * hooks: onProgress({ t, x, y }), onStrokeDone({ stroke, last }), onDone(glyph), onTapDone(),
   *        onHint() — the hand has come to show how, for the first time on this glyph
   * returns: show(glyph, { intro }), demo(), restart(), celebrate(), hide(), isDone()
   */
  TP.createTraceView = function (stage, hooks) {
    hooks = hooks || {};
    const T = TP.TUNING;

    let glyph = null;
    let strokes = [];
    let tracer = null;
    let svg = null;
    let letterG, tintEls, trailEls, seen, inkG, demoG, hand;
    let finished = false;
    let raf = 0;
    let demo = null;       // the running hand demo: { cancelled }
    let idleTimer = 0;
    let hinted = false;    // the voice hint was given for this glyph
    let inverse = null;    // screen → glyph units
    let ink = null;        // the line being drawn: { nodes, node, pts }
    let drawing = null;    // id of the pointer that draws
    let tapStart = null;   // a tap on the finished letter
    let shown = 0;         // counts show() calls, so late timers know they are stale

    // ---------- building ----------
    function build() {
      stage.textContent = '';
      const W = glyph.w;
      const P = T.viewPad;
      svg = el('svg', { class: 'trace-svg', viewBox: `${-P} ${-P} ${W + P * 2} ${100 + P * 2}` }, stage);
      svg.style.setProperty('--c', glyph.color);

      const rules = el('g', { class: 'rules' }, svg);
      el('line', { x1: -3000, x2: 3000, y1: 0, y2: 0 }, rules);
      el('line', { x1: -3000, x2: 3000, y1: 50, y2: 50, class: 'mid' }, rules);
      el('line', { x1: -3000, x2: 3000, y1: 100, y2: 100 }, rules);

      letterG = el('g', { class: 'letter' }, svg);
      const roads = el('g', { class: 'roads' }, letterG);
      const dots = el('g', { class: 'road-dots' }, letterG);
      const tints = el('g', { class: 'tints' }, letterG);
      const trails = el('g', { class: 'trails' }, letterG);
      strokes.forEach((st) => el('path', { d: st.d, class: 'road', 'stroke-width': T.roadW }, roads));
      strokes.forEach((st) => el('path', { d: st.d, class: 'road-dot' }, dots));
      // The covered parts of each stroke (a tint), and the whole stroke once it is done.
      tintEls = strokes.map(() => el('path', { class: 'tint', 'stroke-width': T.trailW }, tints));
      trailEls = strokes.map((st) => {
        const p = el('path', { d: st.d, class: 'trail', 'stroke-width': T.trailW }, trails);
        p.style.display = 'none';
        return p;
      });
      seen = strokes.map(() => -1);
      // The child's line is cut to the shape of the road: nothing can be drawn outside the figure.
      const mask = el('mask', { id: 'inkMask', maskUnits: 'userSpaceOnUse', x: -P, y: -P, width: W + P * 2, height: 100 + P * 2 }, svg);
      strokes.forEach((st) => el('path', { d: st.d, class: 'ink-mask', 'stroke-width': T.roadW }, mask));
      inkG = el('g', { class: 'ink', 'stroke-width': T.inkW, mask: 'url(#inkMask)' }, svg);
      demoG = el('g', { class: 'demo-trails' }, svg);

      hand = el('g', { class: 'hand' }, svg);
      const inner = el('g', { transform: 'scale(0.8) translate(-14.5 -3)' }, hand);
      for (const cls of ['hand-line', 'hand-fill']) {
        const g = el('g', { class: cls }, inner);
        el('rect', { x: 10, y: 2, width: 9, height: 30, rx: 4.5 }, g);
        el('rect', { x: 18.5, y: 17, width: 8.5, height: 16, rx: 4.2 }, g);
        el('rect', { x: 26.5, y: 18.5, width: 8, height: 16, rx: 4 }, g);
        el('rect', { x: 34, y: 20.5, width: 7.5, height: 15, rx: 3.7 }, g);
        el('rect', { x: 10, y: 24, width: 31.5, height: 23, rx: 9 }, g);
        el('rect', { x: 2, y: 25, width: 9.5, height: 19, rx: 4.7, transform: 'rotate(-32 11 42)' }, g);
      }
      el('path', { d: 'M27 22.5 V30 M34.5 23.5 V31', class: 'hand-crease' }, inner);
      hand.style.display = 'none';
      measure();
    }

    function measure() {
      inverse = null;
      if (!svg || !tracer) return;
      const m = svg.getScreenCTM();
      if (m && m.a > 0) tracer.setScale(m.a);
    }

    // ---------- drawing a frame ----------
    function invalidate() {
      if (!raf) raf = requestAnimationFrame(render);
    }

    function render() {
      raf = 0;
      if (!tracer) return;
      const list = tracer.state().strokes;
      for (let i = 0; i < strokes.length; i++) {
        const v = tracer.version(i);
        if (v === seen[i]) continue;
        seen[i] = v;
        if (list[i].done) {
          trailEls[i].style.display = '';
          tintEls[i].style.display = 'none';
          continue;
        }
        // The covered pieces of the road, as one path with a part per piece.
        const st = strokes[i];
        let d = '';
        for (const [from, to] of tracer.runs(i)) {
          d += `M${st.x[from].toFixed(1)} ${st.y[from].toFixed(1)}`;
          if (to === from) d += `L${st.x[from].toFixed(1)} ${st.y[from].toFixed(1)}`;
          for (let k = from + 1; k <= to; k++) d += `L${st.x[k].toFixed(1)} ${st.y[k].toFixed(1)}`;
        }
        tintEls[i].setAttribute('d', d);
      }
    }

    function tween(ms, fn, token) {
      return new Promise((resolve) => {
        const t0 = performance.now();
        const frame = (now) => {
          if (token.cancelled) { resolve(false); return; }
          const t = Math.min(1, Math.max(0, (now - t0) / ms));
          fn(t);
          if (t < 1) requestAnimationFrame(frame); else resolve(true);
        };
        requestAnimationFrame(frame);
      });
    }

    // ---------- the child's own line ----------
    // The engine says where the line is: it starts when the finger enters the figure and ends when
    // it leaves. A line too short to count (a tap, a crossing of the road) fades away at once.
    function inkStart(pt) {
      const node = el('polyline', {}, inkG);
      ink = { nodes: [node], node, pts: [pt, pt] };
      inkDraw();
    }

    function inkAdd(pt) {
      if (!ink) return;
      const last = ink.pts[ink.pts.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 0.4) return;
      if (ink.pts.length >= INK_CHUNK) { // carry on in a fresh piece, joined to the last point
        ink.node = el('polyline', {}, inkG);
        ink.nodes.push(ink.node);
        ink.pts = [last];
      }
      ink.pts.push(pt);
      inkDraw();
    }

    function inkDraw() {
      ink.node.setAttribute('points', ink.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
    }

    function inkEnd(kept) {
      if (!ink) return;
      const nodes = ink.nodes;
      ink = null;
      if (kept) return;
      for (const n of nodes) n.classList.add('fading');
      setTimeout(() => { for (const n of nodes) n.remove(); }, 450);
    }

    // ---------- the hand shows the way ----------
    function stopDemo() {
      if (!demo) return;
      demo.cancelled = true;
      demo = null;
      demoG.textContent = '';
      demoG.style.opacity = '';
      hand.style.display = 'none';
      stage.classList.remove('demoing');
    }

    /** The hand draws the given strokes, one after another. */
    async function runDemo(list) {
      stopDemo();
      if (!list.length) return;
      const token = (demo = { cancelled: false });
      stage.classList.add('demoing');
      const moveHand = (x, y) => hand.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      let pos = G.at(strokes[list[0]], 0);
      moveHand(pos.x, pos.y);
      hand.style.display = '';
      hand.style.opacity = '0';
      await tween(220, (t) => { hand.style.opacity = String(t); }, token);
      for (let n = 0; n < list.length; n++) {
        if (token.cancelled) return;
        const st = strokes[list[n]];
        if (n > 0) {
          const a = pos;
          const b = G.at(st, 0);
          await tween(380, (t) => { const e = TP.ease(t); moveHand(TP.lerp(a.x, b.x, e), TP.lerp(a.y, b.y, e) - Math.sin(t * Math.PI) * 5); }, token);
          if (token.cancelled) return;
        }
        const ms = TP.clamp((st.len / 100) * T.demoMsPer100, T.demoMinMs, T.demoMaxMs);
        const line = el('path', { d: st.d, class: 'demo-trail', 'stroke-width': T.trailW }, demoG);
        await tween(ms, (t) => {
          const s = st.len * TP.ease(t);
          pos = G.at(st, s);
          moveHand(pos.x, pos.y);
          line.style.strokeDasharray = `${Math.max(0.01, s).toFixed(2)} ${(st.len + 20).toFixed(0)}`;
        }, token);
        if (token.cancelled) return;
        await tween(160, () => {}, token);
      }
      if (token.cancelled) return;
      await tween(450, (t) => { demoG.style.opacity = String(1 - t); hand.style.opacity = String(1 - t); }, token);
      if (demo === token) stopDemo();
    }

    /** The hand writes the whole glyph (the "show me" button). */
    function demoAll() {
      if (!tracer) return;
      clearTimeout(idleTimer);
      return runDemo(strokes.map((st, i) => i)).then(() => armIdle(T.hintRepeatMs));
    }

    // ---------- the hint: only after a quiet while, never a telling-off ----------
    function armIdle(ms) {
      clearTimeout(idleTimer);
      if (!tracer || finished) return;
      idleTimer = setTimeout(onIdle, ms || T.hintIdleMs);
    }

    /** Nothing has been drawn for a while: the hand shows the strokes that are still to do. */
    function onIdle() {
      if (!tracer || finished) return;
      if (tracer.state().active || demo) { armIdle(); return; }
      const todo = [];
      tracer.state().strokes.forEach((info, i) => { if (!info.done) todo.push(i); });
      if (!hinted) { // the voice joins the hand once per glyph, not every time
        hinted = true;
        if (hooks.onHint) hooks.onHint();
      }
      runDemo(todo).then(() => armIdle(T.hintRepeatMs));
    }

    /** Any touch: whatever hint is playing stops at once, and the quiet while starts again. */
    function touched() {
      stopDemo();
      armIdle();
    }

    // ---------- pointer input ----------
    function toGlyph(e) {
      if (!inverse) {
        const m = svg.getScreenCTM();
        if (!m) return null;
        inverse = m.inverse();
      }
      return { x: inverse.a * e.clientX + inverse.c * e.clientY + inverse.e, y: inverse.b * e.clientX + inverse.d * e.clientY + inverse.f };
    }

    function onDown(e) {
      if (!tracer) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      touched();
      if (finished) {
        if (!tapStart) tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
      const pt = toGlyph(e);
      if (!pt || tracer.state().active) return; // one finger draws; a palm or a second hand is ignored
      drawing = e.pointerId;
      stage.classList.add('drawing');
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
      tracer.down(e.pointerId, pt.x, pt.y);
    }

    function onMove(e) {
      if (!tracer || finished || e.pointerId !== drawing) return;
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      for (const ev of list && list.length ? list : [e]) {
        const pt = toGlyph(ev);
        if (!pt) continue;
        tracer.move(e.pointerId, pt.x, pt.y);
        if (finished) break; // the letter was finished by this very move
      }
    }

    function onUp(e) {
      if (tapStart && e.pointerId === tapStart.id) {
        const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
        tapStart = null;
        if (finished && moved <= 12 && hooks.onTapDone) hooks.onTapDone();
        return;
      }
      if (tracer) tracer.up(e.pointerId);
    }

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    // Without this iOS may show the magnifier or start a text selection under a resting finger.
    stage.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });
    stage.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    if (window.ResizeObserver) new ResizeObserver(measure).observe(stage);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    // ---------- the engine's reports ----------
    function wire() {
      tracer.on('runStart', inkStart);
      tracer.on('runPoint', inkAdd);
      tracer.on('runEnd', (e) => inkEnd(e.kept));
      tracer.on('release', () => {
        drawing = null;
        stage.classList.remove('drawing');
        armIdle();
      });
      tracer.on('progress', (e) => {
        invalidate();
        if (hooks.onProgress) hooks.onProgress(e);
      });
      tracer.on('strokeDone', (e) => {
        invalidate();
        if (hooks.onStrokeDone) hooks.onStrokeDone(e);
      });
      tracer.on('glyphDone', () => {
        finished = true;
        ink = null;
        drawing = null;
        clearTimeout(idleTimer);
        stopDemo();
        render();
        stage.classList.remove('drawing');
        stage.classList.add('done'); // the child's own line fades into the neat letter
        celebrate();
        if (hooks.onDone) hooks.onDone(glyph);
      });
    }

    /** The whole letter shimmers through the rainbow and hops. */
    function celebrate() {
      if (!letterG) return;
      letterG.classList.remove('party');
      void letterG.getBoundingClientRect();
      letterG.classList.add('party');
    }

    function show(g, opts) {
      opts = opts || {};
      hide();
      const mine = ++shown;
      glyph = g;
      strokes = G.sampled(g);
      tracer = TP.createTracer(g);
      finished = false;
      hinted = false;
      stage.classList.remove('done', 'drawing', 'demoing');
      build();
      wire();
      render();
      armIdle(); // no demo on opening: the hand comes only if nothing is drawn for a while
      if (opts.intro === false) return;
      stage.classList.add('arriving');
      setTimeout(() => { if (mine === shown) stage.classList.remove('arriving'); }, 400);
    }

    function hide() {
      clearTimeout(idleTimer);
      if (demo) { demo.cancelled = true; demo = null; }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      tracer = null;
      ink = null;
      drawing = null;
      tapStart = null;
      shown++;
    }

    return {
      show,
      hide,
      demo: demoAll,
      celebrate,
      /** Wipes the drawing so the same glyph can be drawn again. */
      restart() { if (glyph) show(glyph, { intro: false }); },
      isDone: () => finished,
      glyph: () => glyph,
      /** Where a point of the glyph is on the screen (for the fireworks and the flying star). */
      toScreen(x, y) {
        const m = svg && svg.getScreenCTM();
        return m ? { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, scale: m.a } : null;
      },
    };
  };
})();
