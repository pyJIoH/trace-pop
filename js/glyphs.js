/* Trace Pop — the letters and digits, as strokes. No font: everything a child sees is drawn from
   these paths (the road, the trail, the grid, the tiles).

   Units: height 100. y = 0 is the top line, 50 the middle line, 100 the base line. A stroke is the
   centre line of the pen, drawn in the direction of writing; its first point is where it starts.
   Paths use absolute M L C Q A only, one command letter per segment.
   Style: school print, ball and stick (Zaner-Bloser stroke order).

   Classic script (no modules) so the app also runs from file://, and pure logic (no DOM) so the
   same file loads in Node for tools/check.mjs. */
(function () {
  'use strict';
  const TP = (window.TP = window.TP || {});

  const L = (id, w, strokes) => ({ id, kind: 'letter', w, strokes });
  const N = (id, w, strokes) => ({ id, kind: 'number', w, strokes });

  const LIST = [
    L('A', 80, ['M40 0 L4 100', 'M40 0 L76 100', 'M17 64 L63 64']),
    L('B', 66, ['M8 0 L8 100', 'M8 0 L32 0 A25 25 0 0 1 32 50 L8 50 L36 50 A25 25 0 0 1 36 100 L8 100']),
    L('C', 84, ['M79 25 A40 50 0 1 0 79 75']),
    L('D', 78, ['M8 0 L8 100', 'M8 0 L26 0 A46 50 0 0 1 26 100 L8 100']),
    L('E', 62, ['M8 0 L8 100', 'M8 0 L56 0', 'M8 50 L48 50', 'M8 100 L56 100']),
    L('F', 60, ['M8 0 L8 100', 'M8 0 L54 0', 'M8 50 L46 50']),
    L('G', 86, ['M79 25 A40 50 0 1 0 79 75 L79 50 L50 50']),
    L('H', 72, ['M8 0 L8 100', 'M64 0 L64 100', 'M8 50 L64 50']),
    L('I', 48, ['M24 0 L24 100', 'M6 0 L42 0', 'M6 100 L42 100']),
    L('J', 64, ['M40 0 L40 70 A17 30 0 0 1 6 70', 'M22 0 L58 0']),
    L('K', 70, ['M8 0 L8 100', 'M60 0 L8 52 L64 100']),
    L('L', 58, ['M8 0 L8 100 L52 100']),
    L('M', 90, ['M8 0 L8 100', 'M8 0 L45 75 L82 0 L82 100']),
    L('N', 76, ['M8 0 L8 100', 'M8 0 L68 100 L68 0']),
    L('O', 88, ['M44 0 A40 50 0 1 0 44 100 A40 50 0 1 0 44 0']),
    L('P', 64, ['M8 0 L8 100', 'M8 0 L32 0 A25 25 0 0 1 32 50 L8 50']),
    L('Q', 90, ['M44 0 A40 50 0 1 0 44 100 A40 50 0 1 0 44 0', 'M54 68 L86 100']),
    L('R', 68, ['M8 0 L8 100', 'M8 0 L32 0 A25 25 0 0 1 32 50 L8 50 L62 100']),
    L('S', 58, ['M49.5 10.7 A25 25 0 1 0 29 50 A25 25 0 1 1 8.5 89.3']),
    L('T', 72, ['M36 0 L36 100', 'M4 0 L68 0']),
    L('U', 72, ['M8 0 L8 70 A28 30 0 0 0 64 70 L64 0']),
    L('V', 76, ['M4 0 L38 100 L72 0']),
    L('W', 90, ['M4 0 L25 100 L45 20 L65 100 L86 0']),
    L('X', 72, ['M6 0 L66 100', 'M66 0 L6 100']),
    L('Y', 72, ['M4 0 L36 50', 'M68 0 L36 50 L36 100']),
    L('Z', 70, ['M6 0 L64 0 L6 100 L64 100']),

    N('0', 70, ['M35 0 A31 50 0 1 0 35 100 A31 50 0 1 0 35 0']),
    N('1', 40, ['M20 0 L20 100']),
    N('2', 68, ['M9.6 35.9 A26 26 0 1 1 53.9 43.7 L8 100 L62 100']),
    N('3', 62, ['M10.5 10.7 A25 25 0 1 1 31 50 A25 25 0 1 1 10.5 89.3']),
    N('4', 72, ['M10 0 L10 58 L66 58', 'M52 0 L52 100']),
    N('5', 66, ['M12 0 L12 43.8 A31 31 0 1 1 6.3 88.9', 'M12 0 L58 0']),
    N('6', 66, ['M50 0 Q8 18 4 70 A29 29 0 1 0 62 70 A29 29 0 1 0 4 70']),
    N('7', 66, ['M6 0 L60 0 L22 100']),
    N('8', 64, ['M50.8 9.8 A23 23 0 1 0 32 46 A27 27 0 1 1 32 100 A27 27 0 1 1 32 46 A23 23 0 0 0 50.8 9.8']),
    N('9', 64, ['M57 26 A26 26 0 1 0 5 26 A26 26 0 1 0 57 26 L57 100']),
  ];

  // Eight rainbow colours, strong but not acid. A glyph keeps its colour everywhere.
  const COLORS = ['#EB5757', '#F2994A', '#E5B41F', '#1FB5A5', '#3D9BE9', '#5B6EE1', '#9B59D0', '#EC5FA4'];

  const byId = {};
  const sets = { letter: [], number: [] };
  for (const g of LIST) {
    g.color = COLORS[sets[g.kind].length % COLORS.length];
    byId[g.id] = g;
    sets[g.kind].push(g);
  }

  // ---------- path → points ----------
  const NEED = { M: 2, L: 2, C: 6, Q: 4, A: 7 };

  /** 'M40 0 L4 100' → [{ c: 'M', n: [40, 0] }, …]. Throws on anything outside the small subset. */
  function parse(d) {
    if (typeof d !== 'string' || /[^MLCQA0-9.\-\s,]/.test(d)) throw new Error('bad character in path: ' + d);
    const out = [];
    const re = /([MLCQA])([^MLCQA]*)/g;
    let m;
    while ((m = re.exec(d))) {
      const nums = (m[2].match(/-?\d*\.?\d+/g) || []).map(Number);
      if (nums.length !== NEED[m[1]]) throw new Error(`"${m[1]}" needs ${NEED[m[1]]} numbers: ${d}`);
      out.push({ c: m[1], n: nums });
    }
    if (out.length < 2 || out[0].c !== 'M') throw new Error('a stroke starts with M and goes somewhere: ' + d);
    if (out.filter((c) => c.c === 'M').length !== 1) throw new Error('one M per stroke: ' + d);
    return out;
  }

  const FINE = 0.25; // spacing of the first, fine pass over curves

  function bezier(pts) {
    // De Casteljau for a quadratic (3 points) or cubic (4 points).
    let rough = 0;
    for (let i = 1; i < pts.length; i++) rough += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const steps = Math.max(8, Math.ceil(rough / FINE));
    const out = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      let p = pts;
      while (p.length > 1) {
        const q = [];
        for (let i = 0; i < p.length - 1; i++) q.push([p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t]);
        p = q;
      }
      out.push(p[0]);
    }
    return out;
  }

  /** SVG elliptical arc, end-point form → points (the standard centre conversion). */
  function arc(x1, y1, rx, ry, rotDeg, large, sweep, x2, y2) {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x1, y1], [x2, y2]];
    const phi = (rotDeg * Math.PI) / 180;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const xp = c * dx + s * dy;
    const yp = -s * dx + c * dy;
    const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
    if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
    const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
    const den = rx * rx * yp * yp + ry * ry * xp * xp;
    let co = Math.sqrt(Math.max(0, num / den));
    if (!!large === !!sweep) co = -co;
    const cxp = (co * rx * yp) / ry;
    const cyp = (-co * ry * xp) / rx;
    const cx = c * cxp - s * cyp + (x1 + x2) / 2;
    const cy = s * cxp + c * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (xp - cxp) / rx;
    const uy = (yp - cyp) / ry;
    const th1 = ang(1, 0, ux, uy);
    let dth = ang(ux, uy, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!sweep && dth > 0) dth -= 2 * Math.PI;
    else if (sweep && dth < 0) dth += 2 * Math.PI;
    const steps = Math.max(8, Math.ceil((Math.max(rx, ry) * Math.abs(dth)) / FINE));
    const out = [];
    for (let k = 0; k <= steps; k++) {
      const th = th1 + (dth * k) / steps;
      const ex = rx * Math.cos(th);
      const ey = ry * Math.sin(th);
      out.push([c * ex - s * ey + cx, s * ex + c * ey + cy]);
    }
    out[0] = [x1, y1];
    out[out.length - 1] = [x2, y2];
    return out;
  }

  /**
   * A stroke as points about `step` apart, each with the length of the path up to it:
   * { d, x[], y[], s[], n, len }. Corners of the path are always kept as points.
   */
  function sample(d, step) {
    step = step || 1;
    const xs = [];
    const ys = [];
    const ss = [];
    let total = 0;
    let cx = 0;
    let cy = 0;
    const push = (x, y) => {
      if (xs.length) total += Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1]);
      xs.push(x);
      ys.push(y);
      ss.push(total);
    };
    for (const { c, n } of parse(d)) {
      if (c === 'M') { cx = n[0]; cy = n[1]; push(cx, cy); continue; }
      let fine;
      if (c === 'L') fine = [[cx, cy], [n[0], n[1]]];
      else if (c === 'Q') fine = bezier([[cx, cy], [n[0], n[1]], [n[2], n[3]]]);
      else if (c === 'C') fine = bezier([[cx, cy], [n[0], n[1]], [n[2], n[3]], [n[4], n[5]]]);
      else fine = arc(cx, cy, n[0], n[1], n[2], n[3], n[4], n[5], n[6]);
      // Walk the fine line and keep equal pieces no longer than `step`.
      const cum = [0];
      for (let i = 1; i < fine.length; i++) cum.push(cum[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
      const segLen = cum[cum.length - 1];
      const pieces = Math.max(1, Math.ceil(segLen / step));
      let j = 1;
      for (let k = 1; k <= pieces; k++) {
        const want = (segLen * k) / pieces;
        while (j < fine.length - 1 && cum[j] < want) j++;
        const span = cum[j] - cum[j - 1] || 1;
        const t = Math.min(1, Math.max(0, (want - cum[j - 1]) / span));
        push(fine[j - 1][0] + (fine[j][0] - fine[j - 1][0]) * t, fine[j - 1][1] + (fine[j][1] - fine[j - 1][1]) * t);
      }
      const end = fine[fine.length - 1];
      cx = end[0];
      cy = end[1];
    }
    return { d, x: xs, y: ys, s: ss, n: xs.length, len: total };
  }

  /** Index of the last point at or before length `s`. */
  function indexAt(st, s) {
    let lo = 0;
    let hi = st.n - 1;
    if (s <= 0) return 0;
    if (s >= st.len) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (st.s[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Position and direction (radians) on a sampled stroke at length `s`. */
  function at(st, s) {
    s = Math.min(st.len, Math.max(0, s));
    let i = indexAt(st, s);
    if (i >= st.n - 1) i = st.n - 2;
    const span = st.s[i + 1] - st.s[i] || 1;
    const t = (s - st.s[i]) / span;
    const dx = st.x[i + 1] - st.x[i];
    const dy = st.y[i + 1] - st.y[i];
    return { x: st.x[i] + dx * t, y: st.y[i] + dy * t, a: Math.atan2(dy, dx) };
  }

  const cache = new Map();
  /** The sampled strokes of a glyph (made once). */
  function sampled(glyph) {
    let hit = cache.get(glyph.id);
    if (!hit) {
      hit = glyph.strokes.map((d) => sample(d, 1));
      cache.set(glyph.id, hit);
    }
    return hit;
  }

  TP.glyphs = {
    all: LIST,
    colors: COLORS,
    get: (id) => byId[id],
    set: (kind) => sets[kind],
    parse,
    sample,
    sampled,
    at,
    indexAt,
  };
})();
