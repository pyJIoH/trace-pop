/* Trace Pop — screens, navigation and progress.
   Three screens inside one page (no history entries, so an edge swipe has nowhere to go back to):
   home (two tiles) → grid (a set of glyphs) → trace (one glyph). */
(function () {
  'use strict';
  const TP = window.TP;
  const { $, $$ } = TP;
  const G = TP.glyphs;
  const S = TP.sound;
  const SP = TP.speech;

  const SETS = {
    letter: { tile: '#tileLetters', word: ['A', 'B', 'C'], dots: '#dotsLetters' },
    number: { tile: '#tileNumbers', word: ['1', '2', '3'], dots: '#dotsNumbers' },
  };

  // { done: { A: 3, … }, settings: { … }, finale: { letter: true } }
  const saved = TP.store.get('state', null) || {};
  const state = {
    done: saved.done || {},
    settings: Object.assign({ voice: true, sounds: true, praise: true }, saved.settings),
    finale: saved.finale || {},
  };
  const save = () => TP.store.set('state', state);
  const isDone = (g) => !!state.done[g.id];

  let screen = 'home';
  let kind = 'letter';
  let index = 0; // the glyph on the trace screen, within its set

  // ---------- screens ----------
  function go(name) {
    if (name === screen) return;
    TP.lockTaps(350); // touches during the change are ignored
    if (screen === 'trace') view.hide();
    for (const s of $$('.screen')) s.hidden = s.id !== name;
    screen = name;
    const el = $('#' + name);
    el.classList.remove('entering');
    void el.offsetWidth;
    el.classList.add('entering');
  }

  // ---------- home ----------
  function buildHome() {
    for (const k of Object.keys(SETS)) {
      const set = SETS[k];
      const word = $(k === 'letter' ? '#wordLetters' : '#wordNumbers');
      word.textContent = '';
      word.appendChild(TP.glyphSvg(set.word, { stroke: 15, gap: 20 }));
      TP.onTap($(set.tile), () => { S.say(k === 'letter' ? 'letters' : 'numbers'); openGrid(k); });
    }
    refreshHome();
  }

  /** The thin strip of dots under each tile: how many are traced (for the parent). */
  function refreshHome() {
    for (const k of Object.keys(SETS)) {
      const dots = $(SETS[k].dots);
      dots.textContent = '';
      for (const g of G.set(k)) {
        const dot = document.createElement('i');
        if (isDone(g)) { dot.className = 'on'; dot.style.background = g.color; }
        dots.appendChild(dot);
      }
    }
  }

  // ---------- grid ----------
  function openGrid(k) {
    kind = k;
    buildGrid();
    go('grid');
    layoutGrid();
  }

  function buildGrid() {
    const box = $('#bubbles');
    box.textContent = '';
    const list = G.set(kind);
    const next = list.findIndex((g) => !isDone(g));
    list.forEach((g, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bubble' + (isDone(g) ? ' done' : '') + (i === next ? ' next-up' : '');
      b.style.setProperty('--c', g.color);
      b.setAttribute('aria-label', g.id);
      b.appendChild(TP.glyphSvg(g.id, { stroke: 15, colors: () => 'currentColor' }));
      if (isDone(g)) {
        const star = TP.icon('star');
        star.classList.add('star');
        b.appendChild(star);
      }
      TP.onTap(b, () => openTrace(i));
      box.appendChild(b);
    });
  }

  /** Picks the number of columns that gives the biggest bubbles with no scrolling. */
  function layoutGrid() {
    const box = $('#bubbles');
    const n = box.children.length;
    const W = box.clientWidth;
    const H = box.clientHeight;
    if (!n || !W || !H) return;
    let best = { cell: 0, cols: 1, gap: 8 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      // The gap grows with the bubble: 8 px on a small phone, up to 20 px on an iPad.
      let cell = Math.min(W / cols, H / rows);
      let gap = 8;
      for (let pass = 0; pass < 3; pass++) {
        gap = TP.clamp(cell * 0.16, 8, 20);
        cell = Math.min((W - gap * (cols - 1)) / cols, (H - gap * (rows - 1)) / rows);
      }
      if (cell > best.cell) best = { cell, cols, gap };
    }
    box.style.setProperty('--cell', Math.floor(Math.min(best.cell, 190)) + 'px');
    box.style.setProperty('--cols', best.cols);
    box.style.setProperty('--gap', Math.round(best.gap) + 'px');
  }

  // ---------- trace ----------
  let lastParty = 0;
  let lastPraise = '';
  let noteStep = 0;

  /** A random "Great job!", never the same one twice in a row. */
  function praise() {
    if (!state.settings.praise) return null;
    const pool = SP.PRAISE.filter((k) => k !== lastPraise);
    lastPraise = pool[Math.floor(Math.random() * pool.length)];
    return lastPraise;
  }

  const view = TP.createTraceView($('#stage'), {
    // The drawing grows: a note of the tune for every tenth of the glyph.
    onProgress(e) {
      const step = Math.floor(e.t / TP.TUNING.noteEvery + 1e-6);
      if (step > noteStep) { noteStep = step; S.note(step - 1); }
    },
    onStrokeDone(e) {
      if (!e.last) S.ding();
    },
    onDone(g) {
      const wasLast = G.set(kind).every((x) => x === g || isDone(x)) && !isDone(g);
      state.done[g.id] = (state.done[g.id] || 0) + 1;
      if (wasLast) state.finale[kind] = true;
      save();
      $('#trace').classList.add('done');
      lastParty = performance.now();
      S.fanfare();
      // The chord first, then the name, then a word of praise (or the big news: all of them!).
      const after = wasLast ? (kind === 'letter' ? 'all-letters' : 'all-numbers') : praise();
      S.say([SP.keyFor(g), after], { delay: 0.3, gap: 0.3 });
    },
    onTapDone() {
      const now = performance.now();
      if (now - lastParty < TP.TUNING.replayGapMs) return;
      lastParty = now;
      view.celebrate();
      S.fanfare();
      S.say(SP.keyFor(view.glyph()), { delay: 0.3 });
    },
    onVoiceHint() {
      S.say('hint-start');
    },
  });

  function openTrace(i) {
    index = i;
    go('trace');
    showGlyph();
  }

  function showGlyph() {
    const g = G.set(kind)[index];
    $('#trace').classList.remove('done');
    $('#trace').style.setProperty('--c', g.color);
    noteStep = 0;
    view.show(g);
    S.say(SP.keyFor(g), { delay: 0.15 });
  }

  /** ◀ ▶ always work. Past either end of the set they lead back to the grid. */
  function step(by) {
    const list = G.set(kind);
    const to = index + by;
    if (to < 0 || to >= list.length) { S.stopSpeech(); openGrid(kind); return; }
    index = to;
    TP.lockTaps(250);
    showGlyph();
  }

  function bindTrace() {
    TP.onTap($('#toGrid'), () => { S.stopSpeech(); openGrid(kind); });
    TP.onTap($('#prev'), () => step(-1));
    TP.onTap($('#next'), () => step(1));
    TP.onTap($('#showMe'), () => {
      if (view.isDone()) { // ↺ again: wipes the trail, the star stays
        $('#trace').classList.remove('done');
        noteStep = 0;
        S.stopSpeech();
        view.restart();
      } else { // the hand: says the name again and shows how it is written
        S.say(SP.keyFor(view.glyph()));
        view.demo();
      }
    });
    TP.onTap($('#gridHome'), () => { refreshHome(); go('home'); });
  }

  // ---------- no accidental gestures ----------
  function guard() {
    // Pinch zoom (iOS Safari), the long-press menu, a double-tap zoom, a rubber-band scroll.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || e.cancelable) e.preventDefault(); }, { passive: false });
    document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS show press states
    document.addEventListener('selectstart', (e) => e.preventDefault());
    document.addEventListener('dragstart', (e) => e.preventDefault());
  }

  /** Sound may only start inside a touch: every touch makes sure it is awake. */
  function wakeSound() {
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      document.addEventListener(type, () => S.unlock(), { capture: true, passive: true });
    }
    S.setOptions({ voice: state.settings.voice, sounds: state.settings.sounds });
    S.preload(Object.keys(SP.SAY)); // the clips are small: all of them are decoded ahead of time
  }

  function start() {
    guard();
    wakeSound();
    buildHome();
    bindTrace();
    const relayout = () => { if (screen === 'grid') layoutGrid(); };
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', () => setTimeout(relayout, 200));
    TP.app = { state, go, openGrid, openTrace, view };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
