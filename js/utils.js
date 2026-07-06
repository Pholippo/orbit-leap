// utils.js — kleine Mathe-/Helper-Bibliothek (kein Framework, keine Deps)
'use strict';

const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => (v - a) / (b - a);
const remap = (inA, inB, outA, outB, v) => lerp(outA, outB, clamp(invLerp(inA, inB, v), 0, 1));

const rand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const dist2 = (x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  return dx * dx + dy * dy;
};
const dist = (x1, y1, x2, y2) => Math.sqrt(dist2(x1, y1, x2, y2));

// Easing — t in [0,1]
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
};
const easeInQuad = (t) => t * t;

// Zeitbasiertes Dämpfen (frameunabhängig): factor pro Sekunde
const damp = (current, target, smoothing, dt) =>
  lerp(current, target, 1 - Math.pow(smoothing, dt));

// Format: 12345 -> "12.345"
const fmtScore = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// Deterministischer PRNG (mulberry32) — gleicher Seed = gleiche Sequenz (fair fürs Duell/Level).
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sicherer Storage: localStorage wirft in sandboxed/cross-origin iframes (itch.io!)
// eine SecurityError — dann In-Memory-Fallback (Highscores gelten pro Session).
const Store = (() => {
  const mem = {};
  let ls = null;
  try {
    window.localStorage.setItem('__ol_t', '1');
    window.localStorage.removeItem('__ol_t');
    ls = window.localStorage;
  } catch (e) { /* Fallback auf mem */ }
  return {
    get(k) { try { return ls ? ls.getItem(k) : (k in mem ? mem[k] : null); } catch { return k in mem ? mem[k] : null; } },
    set(k, v) { try { if (ls) ls.setItem(k, v); } catch { } mem[k] = String(v); },
  };
})();
