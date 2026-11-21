/* Trace Pop — shared helpers. Classic script (no modules) so the app also runs from file://. */
(function () {
  'use strict';
  const TP = (window.TP = window.TP || {});

  TP.$ = (sel, root) => (root || document).querySelector(sel);
  TP.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  TP.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  TP.lerp = (a, b, t) => a + (b - a) * t;
  TP.ease = (t) => t * t * (3 - 2 * t);
  TP.reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const PREFIX = 'tracepop:';
  TP.store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
    },
  };

  const SVG = 'http://www.w3.org/2000/svg';
  /** Makes an SVG element: TP.svgEl('path', { d, class }, parent). */
  TP.svgEl = function (tag, attrs, parent) {
    const el = document.createElementNS(SVG, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };

  /** An icon from the sprite in index.html. */
  TP.icon = function (name) {
    const svg = TP.svgEl('svg', { class: 'ico', 'aria-hidden': 'true' });
    TP.svgEl('use', { href: '#i-' + name }, svg);
    return svg;
  };

  /**
   * One or more glyphs drawn side by side from their strokes, as an <svg>.
   * opts: { stroke (pen width, glyph units), gap, colors: (glyph, index) => colour, pad }
   */
  TP.glyphSvg = function (ids, opts) {
    opts = opts || {};
    const pen = opts.stroke || 14;
    const gap = opts.gap == null ? 18 : opts.gap;
    const pad = opts.pad == null ? pen / 2 + 1 : opts.pad;
    const list = [].concat(ids).map((id) => TP.glyphs.get(id));
    const width = list.reduce((sum, g) => sum + g.w, 0) + gap * (list.length - 1);
    const svg = TP.svgEl('svg', { class: 'glyph', viewBox: `${-pad} ${-pad} ${width + pad * 2} ${100 + pad * 2}`, 'aria-hidden': 'true' });
    let x = 0;
    list.forEach((g, i) => {
      const group = TP.svgEl('g', { transform: `translate(${x} 0)`, fill: 'none', 'stroke-width': pen, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      // One colour for the whole glyph if asked for; otherwise its own (a picture has one per stroke).
      g.strokes.forEach((d, k) => TP.svgEl('path', { d, stroke: opts.colors ? opts.colors(g, i) : TP.glyphs.ink(g, k) }, group));
      x += g.w + gap;
    });
    return svg;
  };

  // ---------- taps ----------
  // A tap counts when the finger moved less than ~12 px. A second tap on the same thing within
  // half a second, and any tap while a screen is changing, is ignored.
  let lockedUntil = 0;
  TP.lockTaps = (ms) => { lockedUntil = Math.max(lockedUntil, performance.now() + ms); };

  TP.onTap = function (el, fn) {
    let start = null;
    let lastTap = -1e9;
    const clear = () => { start = null; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', (e) => {
      if (start || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.classList.add('pressed');
    });
    el.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      clear();
      const now = performance.now();
      if (moved > 12 || now < lockedUntil || now - lastTap < 500) return;
      lastTap = now;
      if (TP.sound) TP.sound.pop();
      fn(e);
    });
    el.addEventListener('pointercancel', clear);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('click', (e) => {
      // Keyboard (Enter / Space) on a desktop: there was no pointer.
      if (e.detail === 0 && performance.now() >= lockedUntil) fn(e);
    });
  };
})();
