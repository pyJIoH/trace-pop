// Checks the glyph data, the phrase list, the offline file list and the drawing engine.
// Run: node tools/check.mjs
//
//   1. every stroke path is valid and stays inside its glyph's box;
//   2. every glyph has a phrase and an mp3, and there are no stray phrases;
//   3. the engine, fed made-up finger movements: the child draws freely, so neat and sloppy
//      drawing counts in any order, direction and number of pieces; taps, a few lines across
//      and doodles in the middle do not.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load the app's own files the way the browser does.
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const f of ['js/glyphs.js', 'js/tracer.js', 'js/speech.js']) {
  vm.runInContext(`(function (window) { ${readFileSync(join(ROOT, f), 'utf8')} })(window);`, sandbox, { filename: f });
}
const { glyphs, createTracer, speech, TUNING } = sandbox.window.TP;

let failed = 0;
let passed = 0;
const section = (name) => console.log(`\n${name}`);
function ok(cond, what) {
  if (cond) { passed++; return; }
  failed++;
  console.log('  ! ' + what);
}

// ---------- 1. glyph data ----------
section('Glyphs');
const wantIds = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...Array.from({ length: 31 }, (_, i) => String(i))];
ok(glyphs.all.length === wantIds.length, `expected ${wantIds.length} glyphs, found ${glyphs.all.length}`);
for (const id of wantIds) ok(!!glyphs.get(id), `glyph ${id} is missing`);
ok(new Set(glyphs.all.map((g) => g.id)).size === glyphs.all.length, 'glyph ids repeat');
for (const g of glyphs.all) {
  const widest = g.id.length > 1 ? 190 : 90; // a number of two digits is two glyphs wide
  ok(g.w >= 40 && g.w <= widest, `${g.id}: width ${g.w} is outside 40–${widest}`);
  ok(g.strokes.length >= 1, `${g.id}: no strokes`);
  g.strokes.forEach((d, i) => {
    let st;
    try { st = glyphs.sample(d, 1); } catch (e) { ok(false, `${g.id} stroke ${i + 1}: ${e.message}`); return; }
    ok(st.len >= 25, `${g.id} stroke ${i + 1}: only ${st.len.toFixed(1)} long, a tap could finish it`);
    let out = false;
    let gap = 0;
    for (let k = 0; k < st.n; k++) {
      if (st.x[k] < -0.01 || st.x[k] > g.w + 0.01 || st.y[k] < -0.01 || st.y[k] > 100.01) out = true;
      if (k) gap = Math.max(gap, st.s[k] - st.s[k - 1]);
    }
    ok(!out, `${g.id} stroke ${i + 1}: leaves the box 0–${g.w} × 0–100`);
    ok(gap <= 1.01, `${g.id} stroke ${i + 1}: points ${gap.toFixed(2)} apart`);
  });
}
// The sampler against known shapes: a quarter of the way round O is its leftmost point.
{
  const o = glyphs.sampled(glyphs.get('O'))[0];
  const q = glyphs.at(o, o.len / 4);
  ok(Math.abs(q.x - 4) < 0.5 && Math.abs(q.y - 50) < 0.5, `O goes anticlockwise from the top (quarter point ${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);
  const line = glyphs.sample('M0 0 L30 40', 1);
  ok(Math.abs(line.len - 50) < 1e-6, 'a 3-4-5 line is 50 long');
  const circle = glyphs.sample('M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0', 1);
  ok(Math.abs(circle.len - Math.PI * 100) < 0.1, `circle length ${circle.len.toFixed(2)}`);
}
console.log(`  ${glyphs.all.length} glyphs, ${glyphs.all.reduce((n, g) => n + g.strokes.length, 0)} strokes`);

// ---------- 2. phrases and audio ----------
section('Phrases');
const usedKeys = new Set(['letters', 'numbers', 'hint-start', 'all-letters', 'all-numbers', ...speech.PRAISE]);
for (const g of glyphs.all) {
  const key = speech.keyFor(g);
  usedKeys.add(key);
  ok(!!speech.SAY[key], `no phrase for ${g.id} (${key})`);
}
for (const key of usedKeys) ok(!!speech.SAY[key], `phrase "${key}" is used but not in the list`);
for (const key of Object.keys(speech.SAY)) ok(usedKeys.has(key), `phrase "${key}" is not used`);
const noAudio = Object.keys(speech.SAY).filter((key) => !existsSync(join(ROOT, speech.url(key))));
ok(noAudio.length === 0, `${noAudio.length} of ${Object.keys(speech.SAY).length} phrases have no mp3 yet (node tools/make-audio.mjs): ${noAudio.slice(0, 6).join(', ')}${noAudio.length > 6 ? ', …' : ''}`);
console.log(`  ${Object.keys(speech.SAY).length} phrases`);

// ---------- the offline copy ----------
section('Service worker');
{
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const shell = (/const SHELL = \[([^\]]*)\]/.exec(sw) || ['', ''])[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const needed = [...html.matchAll(/(?:src|href)="([^"#:]+\.[a-z]+)"/g)].map((m) => m[1]);
  for (const f of needed) ok(shell.includes(f), `sw.js: ${f} is used by index.html but is not in SHELL (it would be missing offline)`);
  for (const f of shell) if (f !== './') ok(existsSync(join(ROOT, f)), `sw.js: SHELL lists ${f}, which does not exist`);
  ok(/const VERSION = 'tracepop-v\d+'/.test(sw), 'sw.js: VERSION should look like tracepop-v12');
  console.log(`  ${shell.length} app files kept for offline, ${(/VERSION = '([^']+)'/.exec(sw) || [])[1]}`);
}

// ---------- 3. the engine ----------
section('Drawing engine');

/** A tracer that also records what happened. */
function rig(g, opts) {
  const t = createTracer(g, Object.assign({ pxPerUnit: 4 }, opts));
  const log = { strokes: 0, glyph: 0, order: [], lastT: 0, shrank: false };
  t.on('strokeDone', (e) => { log.strokes++; log.order.push(e.stroke); });
  t.on('glyphDone', () => { log.glyph++; });
  t.on('progress', (e) => { if (e.t < log.lastT) log.shrank = true; log.lastT = e.t; });
  return { t, log, st: glyphs.sampled(g) };
}

// A repeatable "random" number, so a failing test fails the same way every time.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Finger positions along a stroke: every `step` units, pushed sideways by a slow wobble. */
function fingerPath(st, step, wobble, rand) {
  const pts = [];
  const phase = rand() * 6.28;
  const wave = 25 + rand() * 30;
  for (let s = 0; ; s += step) {
    const at = glyphs.at(st, Math.min(s, st.len));
    const side = wobble * Math.sin(phase + (s / wave) * 6.28) * 0.8 + wobble * (rand() - 0.5) * 0.4;
    pts.push([at.x - Math.sin(at.a) * side, at.y + Math.cos(at.a) * side]);
    if (s >= st.len) break;
  }
  return pts;
}

function draw(t, pts, id = 1) {
  const took = t.down(id, pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) t.move(id, pts[i][0], pts[i][1]);
  t.up(id);
  return took;
}

const pct = (t) => (t * 100).toFixed(0) + '%';
let closest = { t: 0, what: '' }; // the nearest a "must not count" case came to counting
const near = (r, what) => {
  for (const s of r.t.state().strokes) if (!s.done && s.t > closest.t) closest = { t: s.t, what };
};

for (const g of glyphs.all) {
  const n = g.strokes.length;
  const first = glyphs.sampled(g)[0];
  let r;

  // Neat, and sloppy but on the road (wobbling to the side, at several speeds): in the school
  // order, in the opposite order, and every stroke from its far end.
  for (const [step, wobble, seed] of [[2, 0, 1], [3, 5, 2], [4, 8, 3], [9, 6, 4], [14, 4, 5]]) {
    for (const way of ['school order', 'last stroke first', 'every stroke from its end', 'backwards and last first']) {
      r = rig(g);
      const rand = rng(seed);
      const order = r.st.map((st, i) => i);
      if (way.includes('last')) order.reverse();
      for (const i of order) {
        const pts = fingerPath(r.st[i], step, wobble, rand);
        if (way.includes('end') || way.includes('backwards')) pts.reverse();
        draw(r.t, pts);
      }
      ok(r.log.glyph === 1 && r.log.strokes === n, `${g.id}: ${way}, step ${step}, wobble ${wobble}: should finish (strokes ${r.log.strokes}/${n})`);
      ok(!r.log.shrank, `${g.id}: the drawn part shrank`);
    }
  }

  // In pieces, out of order: every stroke cut into pieces of 45 units or more, drawn in a
  // shuffled order, every other one backwards.
  r = rig(g);
  {
    const rand = rng(6);
    const pieces = [];
    for (const st of r.st) {
      const pts = fingerPath(st, 2, 3, rand);
      const parts = Math.max(1, Math.floor(st.len / 45));
      const q = Math.ceil(pts.length / parts);
      for (let k = 0; k < parts; k++) {
        const piece = pts.slice(Math.max(0, k * q - 1), (k + 1) * q + 1);
        if (piece.length > 1) pieces.push(k % 2 ? piece.reverse() : piece);
      }
    }
    for (let k = pieces.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [pieces[k], pieces[j]] = [pieces[j], pieces[k]];
    }
    for (const piece of pieces) draw(r.t, piece);
    ok(r.log.glyph === 1, `${g.id}: drawn in shuffled pieces should finish (strokes ${r.log.strokes}/${n})`);
  }

  // The whole glyph without lifting the finger (jumping from stroke to stroke in a straight line).
  r = rig(g);
  draw(r.t, [].concat(...r.st.map((st) => fingerPath(st, 3, 3, rng(7)))));
  ok(r.log.glyph === 1, `${g.id}: drawn without lifting the finger should finish`);

  // Taps on both ends of every stroke are not a drawing.
  r = rig(g);
  for (const st of r.st) {
    for (const k of [0, st.n - 1]) { r.t.down(1, st.x[k], st.y[k]); r.t.up(1); }
  }
  ok(r.log.glyph === 0, `${g.id}: taps on the ends must not finish it`);
  near(r, `${g.id} taps`);

  // Scribble across: a few wide sweeps over the whole glyph.
  r = rig(g);
  draw(r.t, [[-15, 8], [g.w + 15, 8], [g.w + 15, 50], [-15, 50], [-15, 92], [g.w + 15, 92]]);
  ok(r.log.glyph === 0, `${g.id}: three sweeps across must not finish it`);
  near(r, `${g.id} sweeps across`);
  if (g.id.length === 1) { // (two sweeps down are a fair 11)
    r = rig(g);
    draw(r.t, [[g.w * 0.15, -15], [g.w * 0.15, 115], [g.w * 0.85, 115], [g.w * 0.85, -15]]);
    ok(r.log.glyph === 0, `${g.id}: two sweeps down must not finish it`);
    r = rig(g);
    draw(r.t, [[-10, -10], [g.w + 10, 110], [g.w + 10, -10], [-10, 110]]);
    if (g.id !== 'X') ok(r.log.glyph === 0, `${g.id}: a big cross must not finish it`); // a big cross is an X
  }

  // A dense scribble over the whole glyph, lines 7 units apart: across, down, and both diagonals.
  // It crosses every part of the figure many times, but crossing is not drawing. (Where the
  // scribble happens to run along every stroke it is drawing, and counts: up-and-down lines over
  // a glyph made of upright strokes, a slanted scribble over the small loops of 8.)
  const ALONG = { down: '1JMNUVWXY', 'the other diagonal': '8' };
  if (g.id.length === 1) {
    const span = g.w + 130;
    const zig = (to) => {
      const pts = [];
      for (let k = 0; k * 7 <= span; k++) pts.push(to(k % 2 ? -15 : span, k * 7 - 15), to(k % 2 ? span : -15, k * 7 - 15));
      return pts;
    };
    const ways = {
      across: zig((u, v) => [u, v]),
      down: zig((u, v) => [v, u]),
      'one diagonal': zig((u, v) => [(u + v) * 0.7 - 40, (v - u) * 0.7 + 50]),
      'the other diagonal': zig((u, v) => [(u - v) * 0.7 + 40, (u + v) * 0.7 - 40]),
    };
    for (const [name, pts] of Object.entries(ways)) {
      if ((ALONG[name] || '').includes(g.id)) continue;
      r = rig(g);
      draw(r.t, pts);
      ok(r.log.glyph === 0, `${g.id}: a dense scribble ${name} must not finish it`);
      near(r, `${g.id} dense scribble ${name}`);
    }
  }

  // A doodle in the middle.
  r = rig(g);
  r.t.down(1, g.w / 2, 50);
  for (let k = 0; k < 300; k++) {
    const rad = (k % 100) * 0.15;
    r.t.move(1, g.w / 2 + Math.cos(k * 0.21) * rad, 50 + Math.sin(k * 0.21) * rad);
  }
  r.t.up(1);
  ok(r.log.glyph === 0, `${g.id}: a doodle in the middle must not finish it`);

  // Drawing beside the glyph does nothing at all.
  r = rig(g);
  draw(r.t, [[-30, -30], [-30, 130], [g.w + 30, 130], [g.w + 30, -30], [-30, -30]]);
  ok(r.t.state().t === 0, `${g.id}: drawing beside the glyph covered ${pct(r.t.state().t)}`);

  // Half a stroke stays drawn after the finger lifts; the other half finishes it.
  // (The glyph's longest stroke: half of a short one is too short a line to count at all.)
  r = rig(g);
  const longest = r.st.indexOf(r.st.reduce((a, b) => (b.len > a.len ? b : a)));
  const pts = fingerPath(r.st[longest], 2, 0, rng(8));
  const half = Math.floor(pts.length / 2);
  draw(r.t, pts.slice(0, half));
  const kept = r.t.state().strokes[longest].t;
  ok(!r.t.state().strokes[longest].done && kept > 0.4 && kept < 0.75, `${g.id}: half a stroke should stay half drawn (${pct(kept)})`);
  draw(r.t, pts.slice(half).reverse());
  ok(r.t.state().strokes[longest].done, `${g.id}: the other half should finish the stroke`);

  // A bit more than half of a stroke is not the stroke.
  r = rig(g);
  draw(r.t, pts.slice(0, Math.floor(pts.length * 0.6)));
  ok(!r.t.state().strokes[longest].done, `${g.id}: 60% of a stroke must not finish it (${pct(r.t.state().strokes[longest].t)})`);

  // A second finger (a palm, the other hand) while drawing changes nothing.
  r = rig(g);
  const quiet = rig(g);
  const some = pts.slice(0, half);
  r.t.down(1, some[0][0], some[0][1]);
  quiet.t.down(1, some[0][0], some[0][1]);
  ok(r.t.down(2, first.x[first.n - 1], first.y[first.n - 1]) === false, `${g.id}: a second finger must not start drawing`);
  for (let i = 1; i < some.length; i++) {
    r.t.move(2, pts[pts.length - 1 - (i % 9)][0], pts[pts.length - 1 - (i % 9)][1]);
    r.t.move(1, some[i][0], some[i][1]);
    quiet.t.move(1, some[i][0], some[i][1]);
  }
  r.t.up(2);
  ok(r.t.state().t === quiet.t.state().t && r.t.state().active, `${g.id}: a second finger disturbed the drawing`);
}

// A short cut through the middle of a round letter covers only its top and bottom.
{
  const r = rig(glyphs.get('O'));
  draw(r.t, [[44, 0], [44, 100], [44, 0]]);
  ok(r.log.strokes === 0 && r.t.state().t < 0.3, `O: a line through the middle must not count (${pct(r.t.state().t)})`);
}

// A line too short to be a line along the figure (a dab, a crossing of the road) leaves nothing.
{
  const r = rig(glyphs.get('H'));
  draw(r.t, [[8, 10], [8, 30]]);
  ok(r.t.state().t === 0, 'a 20-unit dab on a stroke leaves nothing');
  draw(r.t, [[-10, 25], [30, 25]]);
  ok(r.t.state().t === 0, 'a line across a stroke leaves nothing');
  draw(r.t, [[8, 10], [8, 50]]);
  ok(r.t.state().t > 0, 'a 40-unit line along a stroke stays');
  let ends = [];
  const t = createTracer(glyphs.get('H'), { pxPerUnit: 4 });
  t.on('runEnd', (e) => ends.push(e.kept));
  draw(t, [[-10, 25], [30, 25]]);
  draw(t, [[8, 10], [8, 50]]);
  ok(ends.join() === 'false,true', `the view is told which lines stay (${ends.join()})`);
}

// Only the figure can be drawn on: a line right beside the road counts for nothing.
{
  for (const id of ['1', 'L', 'O', '8']) {
    const g = glyphs.get(id);
    const r = rig(g);
    for (const st of r.st) draw(r.t, fingerPath(st, 2, 0, rng(30)).map(([x, y], i, all) => {
      const at = glyphs.at(st, Math.min(st.len, i * 2));
      return [x - Math.sin(at.a) * 13, y + Math.cos(at.a) * 13]; // 13 units to the side: off the road
    }));
    ok(r.t.state().t < 0.2 && r.log.glyph === 0, `${id}: a line beside the road must not count (${pct(r.t.state().t)})`);
  }
}

// On a small screen the pixel size wins: 12 units off the middle is still inside at 1.5 px per unit.
{
  const r = rig(glyphs.get('1'), { pxPerUnit: 1.5 });
  draw(r.t, [[32, 0], [32, 100]]);
  ok(r.log.glyph === 1, 'the figure is a little wider for the finger on small screens (20 px)');
  const r2 = rig(glyphs.get('1'));
  draw(r2.t, [[32, 0], [32, 100]]);
  ok(r2.log.glyph === 0, 'the finger must be within 10 units of the middle of the road on big screens');
}

// Once the glyph is done, nothing more is drawn.
{
  const r = rig(glyphs.get('1'));
  draw(r.t, [[20, 0], [20, 100]]);
  ok(r.log.glyph === 1 && r.t.down(1, 20, 50) === false, 'a finished glyph takes no more drawing');
}

console.log(`  tuning: inside the figure = within ${TUNING.insideUnits} units of the road's middle, a line counts from ${TUNING.minRun} units, finger covers ${TUNING.coverUnits} units, a stroke is done at ${pct(TUNING.strokeDoneAt)}`);
console.log(`  closest call among things that must not count: ${pct(closest.t)} of a stroke (${closest.what})`);

console.log(`\n${failed ? `FAILED: ${failed} problem${failed === 1 ? '' : 's'}` : 'All good'} (${passed} checks passed)`);
process.exit(failed ? 1 : 0);
