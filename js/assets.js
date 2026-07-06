// assets.js — lädt die KI-generierten Sprites (Raumschiff, Planeten, Nebel).
// Prozedurale Zeichnung bleibt Fallback, falls ein Bild (noch) nicht geladen ist.
'use strict';

const ASSETS = (() => {
  let pending = 0, loaded = 0;
  const mk = (src) => {
    pending++;
    const img = new Image();
    img.onload = () => { loaded++; };
    img.onerror = () => { pending--; };
    img.src = src;
    return img;
  };
  const ship = mk('assets/ship.webp');
  // Reihenfolge = PLANET_HUES: 0 cyan/ice, 1 magenta/gas, 2 gold/lava, 3 violet, 4 green
  const planets = ['ice', 'gas', 'lava', 'violet', 'green'].map(n => mk('assets/planet_' + n + '.webp'));
  const nebula = mk('assets/nebula.webp');

  const rdy = (img) => !!img && img.complete && img.naturalWidth > 0;
  return {
    ship, planets, nebula,
    ready(img) { return rdy(img); },
    get allReady() { return pending > 0 && loaded >= pending; },
  };
})();
