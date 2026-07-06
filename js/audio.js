// audio.js — prozedurale WebAudio-Sound-Engine (0 Asset-Dateien, 0 externe Requests)
// Alle Sounds werden synthetisiert: kein Download, kein Copyright, ~0 KB.
'use strict';

const AudioEngine = (() => {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let muted = false;
  let musicTimer = null;

  const ensure = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 1.0;
      sfxGain.connect(master);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.3;
      musicGain.connect(master);
      return true;
    } catch (e) { return false; }
  };

  // --- Bausteine -----------------------------------------------------------
  const tone = ({ freq = 440, freqEnd = null, type = 'sine', dur = 0.15, vol = 0.5, delay = 0, curve = 0.0001, dest = null }) => {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(curve, t0 + dur);
    osc.connect(g).connect(dest || sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  const noise = ({ dur = 0.2, vol = 0.3, delay = 0, filterFreq = 2000, filterQ = 1, type = 'lowpass', sweepTo = null }) => {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, (dur * ctx.sampleRate) | 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    f.Q.value = filterQ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(sfxGain);
    src.start(t0);
  };

  // --- Sound-Katalog (Weltraum/Orbit) ---------------------------------------
  const S = {
    // Loslassen aus dem Orbit — aufsteigender Slingshot-Whoosh
    launch() {
      tone({ freq: 240, freqEnd: 620, type: 'sine', dur: 0.16, vol: 0.32 });
      noise({ dur: 0.18, vol: 0.14, filterFreq: 500, sweepTo: 2600, filterQ: 1.2, type: 'bandpass' });
    },

    // Einfangen in einen neuen Orbit — satter Snap + heller Bling
    capture(combo = 1) {
      const base = 300 * Math.pow(1.045, Math.min(combo, 20));
      tone({ freq: base, freqEnd: base * 1.9, type: 'triangle', dur: 0.14, vol: 0.4 });
      tone({ freq: base * 2.02, type: 'sine', dur: 0.2, vol: 0.22, delay: 0.02 });
      noise({ dur: 0.09, vol: 0.12, filterFreq: 4200, type: 'bandpass', filterQ: 3 });
    },

    // Energie-Stern eingesammelt — heller kurzer Ping
    star() {
      tone({ freq: 1180, type: 'triangle', dur: 0.09, vol: 0.22 });
      tone({ freq: 1770, type: 'sine', dur: 0.12, vol: 0.14, delay: 0.03 });
    },

    // Combo-Meilenstein — kleines aufsteigendes Arpeggio
    combo(n = 2) {
      const root = 523 * Math.pow(1.03, Math.min(n, 12));
      [0, 4, 7, 12].slice(0, Math.min(4, n)).forEach((semi, i) => {
        tone({ freq: root * Math.pow(2, semi / 12), type: 'triangle', dur: 0.13, vol: 0.26, delay: i * 0.05 });
      });
    },

    // Perfekter/knapper Fang — kurzer Whoosh-Akzent
    perfect() {
      tone({ freq: 700, freqEnd: 1400, type: 'sine', dur: 0.12, vol: 0.2 });
      noise({ dur: 0.1, vol: 0.1, filterFreq: 3000, type: 'bandpass', filterQ: 2.5 });
    },

    click() { tone({ freq: 760, freqEnd: 480, type: 'square', dur: 0.05, vol: 0.1 }); },

    warn() { tone({ freq: 210, type: 'sawtooth', dur: 0.22, vol: 0.14 }); },

    // Verfehlt / ins Leere gestürzt — abstürzender Fall + tiefe Explosion
    gameover() {
      [523, 415, 330, 247].forEach((f, i) => tone({ freq: f, freqEnd: f * 0.6, type: 'sawtooth', dur: 0.42, vol: 0.2, delay: i * 0.14 }));
      noise({ dur: 0.7, vol: 0.16, filterFreq: 1400, sweepTo: 120, type: 'lowpass', delay: 0.05 });
      tone({ freq: 90, freqEnd: 34, type: 'sine', dur: 0.6, vol: 0.35, delay: 0.05 });
    },

    highscore() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.25, vol: 0.3, delay: i * 0.09 }));
    },

    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.28, delay: i * 0.11 }));
      tone({ freq: 1568, type: 'sine', dur: 0.5, vol: 0.2, delay: 0.44 });
    },

    danger() { tone({ freq: 170, freqEnd: 150, type: 'sawtooth', dur: 0.3, vol: 0.12 }); },
  };

  // --- Ambient-Soundtrack: sanfte generative Weltraum-Pads --------------------
  const CHORD_POOL = [
    [110.00, 164.81, 220.00, 329.63],  // Am add
    [98.00, 146.83, 196.00, 293.66],   // Gsus
    [87.31, 130.81, 174.61, 261.63],   // F
    [123.47, 185.00, 246.94, 369.99],  // Bm-ish
  ];
  let chordIdx = 0;

  const playPad = () => {
    if (!ctx || muted) return;
    const chord = CHORD_POOL[chordIdx % CHORD_POOL.length];
    chordIdx++;
    chord.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.003);
      const t0 = ctx.currentTime + i * 0.04;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.075 / (i + 1), t0 + 2.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 7.8);
      o.connect(g).connect(musicGain);
      o.start(t0);
      o.stop(t0 + 8.2);
    });
    // gelegentliches funkelndes Arpeggio-Highlight
    if (chordIdx % 2 === 0) {
      const notes = chord.map(f => f * 4);
      notes.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        const t0 = ctx.currentTime + 1.5 + i * 0.5;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
        o.connect(g).connect(musicGain);
        o.start(t0); o.stop(t0 + 1.6);
      });
    }
  };

  const startMusic = () => {
    if (musicTimer) return;
    playPad();
    musicTimer = setInterval(playPad, 6500);
  };
  const stopMusic = () => {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  };

  return {
    sfxEnabled: true, // false im Menü (Attract-Mode soll stumm sein)
    unlock() { if (ensure()) startMusic(); },
    play(name, ...args) { if (this.sfxEnabled && !muted && ensure() && S[name]) S[name](...args); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    get muted() { return muted; },
  };
})();
