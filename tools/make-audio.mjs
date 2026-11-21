// Makes the spoken phrases with ElevenLabs, from the list in js/speech.js, into audio/say/<key>.mp3.
// Only files that are missing are made, so it is safe to run again after adding a phrase.
//
//   node tools/make-audio.mjs --check                    check every glyph has a phrase; make nothing
//   node tools/make-audio.mjs                            make all missing files
//   node tools/make-audio.mjs --only=letter-a,num-3      remake these, even if they exist
//   node tools/make-audio.mjs --takes=3 --only=letter-g  3 versions to compare, in takes/letter-g-1.mp3 …
//   node tools/make-audio.mjs --pick=letter-g:2          take 2 becomes audio/say/letter-g.mp3
//
// Voice: eleven_v3, a cheerful tone: "[excited] Ay!".
// The API key is read from elevenlabs.txt in the project folder (ignored by git) or ELEVENLABS_API_KEY.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOICE = 'piI8Kku0DcvcL6TTSeQt';
const MODEL = 'eleven_v3';
const FORMAT = 'mp3_44100_64';
const PARALLEL = 3; // the account allows 3 requests at once
const TAKES_DIR = join(ROOT, 'takes'); // ignored by git

const args = process.argv.slice(2);
const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const checkOnly = args.includes('--check');
const only = new Set(flag('only').split(',').filter(Boolean));
const takes = Math.max(0, Math.min(6, Number(flag('takes')) || 0));
const pick = flag('pick');

// Load the app's own data files the way the browser does.
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const f of ['js/glyphs.js', 'js/speech.js']) {
  vm.runInContext(`(function (window) { ${readFileSync(join(ROOT, f), 'utf8')} })(window);`, sandbox, { filename: f });
}
const { glyphs, speech } = sandbox.window.TP;

// ---- check the list ----
const problems = [];
const used = new Set(speech.OTHER);
for (const g of glyphs.all) {
  const key = speech.keyFor(g);
  used.add(key);
  if (!speech.SAY[key]) problems.push(`no phrase for ${g.id} (${key})`);
}
for (const key of used) if (!speech.SAY[key]) problems.push(`phrase "${key}" is used but not in the list`);
for (const key of Object.keys(speech.SAY)) if (!used.has(key)) problems.push(`phrase "${key}" is not used`);
for (const key of only) if (!speech.SAY[key]) problems.push(`--only: no phrase called "${key}"`);
if (takes && !only.size) problems.push('--takes needs --only=<key>');
console.log(`${glyphs.all.length} glyphs, ${Object.keys(speech.SAY).length} phrases`);
if (problems.length) {
  console.log(problems.map((p) => '  ! ' + p).join('\n'));
  process.exit(1);
}
if (checkOnly) { console.log('list OK'); process.exit(0); }

// ---- choose a take ----
if (pick) {
  const [key, n] = pick.split(':');
  const from = join(TAKES_DIR, `${key}-${n}.mp3`);
  if (!speech.SAY[key] || !existsSync(from)) { console.error(`--pick: no take ${key}-${n}.mp3 in takes/`); process.exit(1); }
  copyFileSync(from, join(ROOT, speech.url(key)));
  console.log(`take ${n} is now ${speech.url(key)}`);
  process.exit(0);
}

// ---- make the audio ----
let apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  try { apiKey = readFileSync(join(ROOT, 'elevenlabs.txt'), 'utf8').trim(); } catch (e) { /* none */ }
}
if (!apiKey) { console.error('No API key: put it in elevenlabs.txt or ELEVENLABS_API_KEY'); process.exit(1); }

const voiceText = (text) => `[excited] ${text}`;
const jobs = [];
for (const [key, text] of Object.entries(speech.SAY)) {
  if (takes) {
    if (only.has(key)) for (let n = 1; n <= takes; n++) jobs.push({ name: `takes/${key}-${n}.mp3`, file: join(TAKES_DIR, `${key}-${n}.mp3`), text });
  } else {
    const file = join(ROOT, speech.url(key));
    if (only.has(key) || (!only.size && !existsSync(file))) jobs.push({ name: speech.url(key), file, text });
  }
}
console.log(`${jobs.length} files to make`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let credits = 0;
let failed = 0;
let stop = false;

async function run(job) {
  for (let attempt = 1; attempt <= 4 && !stop; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=${FORMAT}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: voiceText(job.text), model_id: MODEL }),
      });
    } catch (e) {
      await wait(1500 * attempt);
      continue;
    }
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(job.file), { recursive: true });
      writeFileSync(job.file, buf);
      credits += Number(res.headers.get('character-cost')) || 0;
      console.log(`  ok ${job.name} ${(buf.length / 1024).toFixed(0)} KB  "${job.text}"`);
      return;
    }
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) { await wait(2000 * attempt); continue; }
    if (/quota|credits/i.test(text)) { stop = true; console.error('  out of credits: stopping'); }
    console.error(`  FAILED ${job.name}: ${res.status} ${text.slice(0, 200)}`);
    failed++;
    return;
  }
  if (!stop) { console.error(`  FAILED ${job.name}: gave up after retries`); failed++; }
}

const queue = jobs.slice();
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (queue.length && !stop) await run(queue.shift());
}));
console.log(`done: ${jobs.length - failed} made, ${failed} failed, about ${credits} credits used`);
process.exit(failed ? 1 : 0);
