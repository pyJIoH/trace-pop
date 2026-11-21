/* Trace Pop — sound. The voice is recorded (audio/say/*.mp3, decoded ahead of time so it starts at
   once); everything else is synthesised with the Web Audio API: the little tune under the finger,
   the "ding" of a finished stroke, the chord of a finished letter.
   The voice is the loudest thing, and it never talks over itself: a new phrase cuts the old one. */
(function () {
  'use strict';
  const TP = (window.TP = window.TP || {});

  let ctx = null;
  let master, fxBus, duck, speechBus, noiseBuf;
  const opts = { voice: true, sounds: true };

  // On iPhone and iPad a context can be left interrupted, or "running" yet silent, after the page
  // was in the background, a call, Siri or a change of audio output. Such a context is not trusted
  // again: it is replaced on the next tap, because a new one can only start inside a user gesture.
  const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let stale = false; // replace the context on the next user gesture
  let ran = false;   // this context has been running at least once

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    let made;
    try { made = new AC({ latencyHint: 'interactive' }); } catch (e) { return null; }
    ctx = made;
    stale = false;
    ran = made.state === 'running';
    made.onstatechange = () => {
      if (made !== ctx) return;
      if (made.state === 'running') ran = true;
      else if (ran) stale = true; // it stopped without being asked to: this code never suspends it
    };

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);
    master = ctx.createGain();
    master.connect(limiter);

    speechBus = ctx.createGain();
    speechBus.gain.value = 1.7;
    speechBus.connect(master);
    duck = ctx.createGain(); // the effects step back while the voice speaks
    duck.connect(master);
    fxBus = ctx.createGain();
    fxBus.gain.value = 0.55;
    fxBus.connect(duck);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /** False while the browser would refuse to start audio (the first half of a tap). */
  function gestureLive() {
    const ua = navigator.userActivation;
    return !ua || ua.isActive;
  }

  /** Must run inside a user gesture the first time, for iOS and Chrome autoplay rules. */
  function unlock() {
    try {
      // Safari 17+: play even when the ring/silent switch is on — the voice has to be heard.
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch (e) { /* ignore */ }
    const fresh = !ctx;
    let c = ensure();
    if (!c) return;
    if (!fresh && (stale || c.state === 'closed') && gestureLive()) {
      const old = ctx;
      old.onstatechange = null;
      ctx = null;
      speechSources = [];
      try { const closing = old.close(); if (closing && closing.catch) closing.catch(() => {}); } catch (e) { /* ignore */ }
      c = ensure();
      if (!c) return;
    }
    if (c.state !== 'running') c.resume().catch(() => {});
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
    } catch (e) { /* ignore */ }
  }

  const ready = () => !!ctx && ctx.state === 'running';
  const fxReady = () => opts.sounds && ready();

  // ---------- building blocks ----------
  function env(param, t, attack, peak, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function osc(type, freq, t, out, peak, attack, decay) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    env(g.gain, t, attack, peak, decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    return o;
  }

  function noise(t, out, { type = 'bandpass', freq = 2000, q = 1, peak = 1, attack = 0.001, decay = 0.05 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g.gain, t, attack, peak, decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.8);
    src.stop(t + attack + decay + 0.05);
    return { src, filter: f, gain: g };
  }

  /** A marimba bar: a soft fundamental, a quick bright overtone, a tiny knock. */
  function marimba(freq, t, peak) {
    osc('sine', freq, t, fxBus, peak, 0.004, 0.42);
    osc('sine', freq * 4, t, fxBus, peak * 0.22, 0.002, 0.09);
    osc('triangle', freq * 2, t, fxBus, peak * 0.1, 0.003, 0.16);
    noise(t, fxBus, { freq: 1800, q: 1.2, peak: peak * 0.18, decay: 0.012 });
  }

  /** A small bell. */
  function bell(freq, t, peak, decay) {
    osc('sine', freq, t, fxBus, peak, 0.003, decay);
    osc('sine', freq * 2.76, t, fxBus, peak * 0.28, 0.002, decay * 0.45);
    osc('sine', freq * 5.4, t, fxBus, peak * 0.1, 0.001, decay * 0.2);
  }

  // ---------- drawing sounds ----------
  // A major pentatonic scale: any run of its notes sounds like a tune, never a wrong note.
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093];

  /** The next note of the tune, as the drawing grows (step 0, 1, 2 …). */
  function note(step) {
    if (!fxReady()) return;
    marimba(SCALE[Math.max(0, step) % SCALE.length], ctx.currentTime + 0.005, 0.5);
  }

  /** A stroke is done: a short, bright "ding". */
  function ding() {
    if (!fxReady()) return;
    const t = ctx.currentTime + 0.005;
    bell(1318.51, t, 0.42, 0.5);
    bell(1975.53, t + 0.07, 0.3, 0.6);
  }

  /** The letter is done: a rising chord and a "whoosh". */
  function fanfare() {
    if (!fxReady()) return;
    const t = ctx.currentTime + 0.01;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      marimba(f, t + i * 0.07, 0.5);
      bell(f * 2, t + i * 0.07, 0.16, 0.9);
    });
    bell(2093, t + 0.3, 0.26, 1.2);
    const w = noise(t, fxBus, { freq: 500, q: 0.9, peak: 0.3, attack: 0.16, decay: 0.34 });
    w.filter.frequency.setValueAtTime(400, t);
    w.filter.frequency.exponentialRampToValueAtTime(5200, t + 0.42);
  }

  /** A soft pop under a button. */
  function pop() {
    if (!fxReady()) return;
    const t = ctx.currentTime + 0.003;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.07);
    const g = ctx.createGain();
    env(g.gain, t, 0.003, 0.3, 0.09);
    o.connect(g).connect(fxBus);
    o.start(t);
    o.stop(t + 0.14);
  }

  // ---------- the voice ----------
  const clips = new Map(); // key → Promise of { buffer, offset, duration, gain } or null
  let speechSources = [];
  let speechToken = 0;
  let speechTimer = 0;

  function decode(c, data) {
    return new Promise((resolve) => {
      try {
        const p = c.decodeAudioData(data, resolve, () => resolve(null)); // callback form for older Safari
        if (p && p.catch) p.catch(() => resolve(null));
      } catch (e) { resolve(null); }
    });
  }

  /** Where the word really starts and ends (the files carry silence and tiny clicks at both ends),
      and how much to turn it up so that every clip is about as loud as the others. */
  function trimmed(buffer) {
    const data = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    const win = Math.max(1, Math.round(rate * 0.01));
    const quiet = 0.012;
    const loud = [];
    for (let i = 0; i + win <= data.length; i += win) {
      let peak = 0;
      for (let k = i; k < i + win; k++) { const v = Math.abs(data[k]); if (v > peak) peak = v; }
      loud.push(peak >= quiet);
    }
    // The first and the last stretch of sound that lasts 40 ms or more: a click is not a word.
    const solid = (i, dir) => loud[i] && loud[i + dir] && loud[i + dir * 2] && loud[i + dir * 3];
    let a = 0;
    let b = loud.length - 1;
    while (a < b && !solid(a, 1)) a++;
    while (b > a && !solid(b, -1)) b--;
    const from = Math.max(0, a * win - Math.round(rate * 0.02));
    const to = Math.min(data.length - 1, (b + 1) * win + Math.round(rate * 0.08));
    let sum = 0;
    let n = 0;
    let peak = 0;
    for (let i = from; i <= to; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      if (v >= quiet) { sum += v * v; n++; }
    }
    const rms = n ? Math.sqrt(sum / n) : 0;
    const gain = rms ? Math.max(0.35, Math.min(4, 0.25 / rms, 1.1 / Math.max(peak, 1e-3))) : 1;
    return { buffer, offset: from / rate, duration: Math.max(0.05, (to - from) / rate), gain };
  }

  /** Fetches and decodes a phrase once; a failed load (offline, opened from disk) is tried again next time. */
  function loadClip(key) {
    if (clips.has(key)) return clips.get(key);
    const job = fetch(TP.speech.url(key))
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((data) => {
        if (!data) return null;
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const c = ctx || (OAC ? new OAC(1, 1, 44100) : null);
        return c ? decode(c, data) : null;
      })
      .then((buffer) => (buffer ? trimmed(buffer) : null))
      .catch(() => null)
      .then((clip) => { if (!clip) clips.delete(key); return clip; });
    clips.set(key, job);
    return job;
  }

  function stopSpeech() {
    speechToken++;
    clearTimeout(speechTimer);
    speechSources.forEach((s) => { try { s.stop(); } catch (e) { /* ignore */ } });
    speechSources = [];
    if (ctx && duck) {
      const t = ctx.currentTime;
      duck.gain.cancelScheduledValues(t);
      duck.gain.setTargetAtTime(1, t, 0.1);
    }
  }

  /**
   * Says one phrase or several in a row: say('letters'), say(['letter-a', 'praise-2'], { delay: 0.3 }).
   * Whatever was being said stops. delay = seconds before the first phrase, gap = between phrases.
   */
  function say(keys, o) {
    stopSpeech();
    if (!opts.voice) return;
    const list = [].concat(keys).filter(Boolean);
    if (!list.length) return;
    const delay = (o && o.delay) || 0;
    const gap = o && o.gap != null ? o.gap : 0.22;
    const token = speechToken;
    const asked = performance.now();
    Promise.all(list.map(loadClip)).then((loaded) => {
      if (token !== speechToken || !ctx || !loaded.some(Boolean)) return;
      const left = Math.max(0, delay - (performance.now() - asked) / 1000);
      // Right after the first tap the context may still be starting: wait for it instead of staying silent.
      if (ctx.state === 'running') play(loaded, left);
      else ctx.resume().then(() => play(loaded, left), () => {});
    });
    function play(loaded, wait) {
      if (token !== speechToken || !ready()) return;
      const start = ctx.currentTime + 0.03 + wait;
      let t = start;
      for (const clip of loaded) {
        if (!clip) continue;
        const s = ctx.createBufferSource();
        s.buffer = clip.buffer;
        const g = ctx.createGain();
        g.gain.value = clip.gain;
        s.connect(g).connect(speechBus);
        s.start(t, clip.offset, clip.duration);
        speechSources.push(s);
        t += clip.duration + gap;
      }
      duck.gain.cancelScheduledValues(ctx.currentTime);
      duck.gain.setTargetAtTime(0.35, Math.max(ctx.currentTime, start - 0.05), 0.05);
      duck.gain.setTargetAtTime(1, t - gap, 0.25);
    }
  }

  // Coming back to the page, or a new audio output, is when iOS breaks a context without saying so.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (IOS && ctx) stale = true;
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && ctx) stale = true; });
  if (IOS && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => { if (ctx) stale = true; });
  }

  TP.sound = {
    unlock,
    ready,
    /** { voice, sounds }: the parent's switches. */
    setOptions(o) {
      Object.assign(opts, o);
      if (!opts.voice) stopSpeech();
    },
    /** Loads and decodes phrases ahead of time, so they play without a delay. */
    preload(keys) { (keys || []).forEach(loadClip); },
    say,
    stopSpeech,
    note,
    ding,
    fanfare,
    pop,
  };
})();
