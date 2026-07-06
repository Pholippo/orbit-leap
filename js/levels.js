// levels.js — Konfigurationen für Endless, Duell und die 20 Level.
'use strict';

// Endless: kein fester Seed → jeder Lauf neu, Schwierigkeit rampt über gefangene Planeten.
const ENDLESS = { mode: 'endless' };

// Duell: main.js injiziert pro Match denselben Seed für beide Boards (faire, identische Bahn).
const DUEL = { mode: 'duel' };

// 20 Level: Ziel (Planetenzahl) und Difficulty steigen stetig. Feste Seeds = reproduzierbar.
const LEVELS = (() => {
  const out = [];
  for (let i = 0; i < 20; i++) {
    const p = i / 19;                          // 0..1
    out.push({
      mode: 'level',
      seed: 1000 + i * 137,                    // deterministisch, aber je Level anders
      goal: Math.round(6 + p * 22),            // 6 → 28 Planeten
      diff: +(0.08 + p * 0.9).toFixed(3),      // 0.08 → 0.98
      starChance: 0.7 - p * 0.15,              // frühe Level großzügiger mit Sternen
    });
  }
  return out;
})();
