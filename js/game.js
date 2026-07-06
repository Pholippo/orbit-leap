// game.js — ORBIT LEAP: Orbit-/Slingshot-Kernlogik + Neon-Weltraum-Rendering
// Mechanik: Orb kreist um einen Planeten. Tap = loslassen → fliegt tangential weg →
// muss den Orbit-Ring des nächsten Planeten treffen (Gravity-Hop). Verfehlt = Absturz.
'use strict';

// --- Welt-Konstanten (virtuelle Einheiten, kamera-unabhängig) ----------------
const W = {
  PLAY_TOP: -240, PLAY_BOT: 240,   // Band, in dem Planeten liegen
  CORRIDOR: 150,                   // Zusatzrand; Orb außerhalb = Absturz
  ORBIT_GAP: 30,                   // Abstand Planetenoberfläche → Orbit-Ring
  VIEW_W: 1040, VIEW_H: 900,       // garantiert sichtbarer Welt-Ausschnitt
  LEAD: 150,                       // Kamera schaut so weit vor den Orb (nach rechts)
  MAX_FLIGHT: 3.2,                 // s im Flug ohne Fang → Absturz (ins Leere)
  STAR_R: 34,                      // Sammelradius Energie-Stern
  START_X: 0,
};

// Neon-Planeten-Paletten {core, glow, ring}
const PLANET_HUES = [
  { core: '#3fd4ff', glow: '#0a7fbf', ring: '#8ef0ff' }, // cyan
  { core: '#ff5ea8', glow: '#b01d63', ring: '#ffb0d6' }, // magenta
  { core: '#ffcf47', glow: '#b8791a', ring: '#ffe9a8' }, // gold
  { core: '#7c6bff', glow: '#3a2ea8', ring: '#c3bcff' }, // violet
  { core: '#4dffa6', glow: '#149a5c', ring: '#b0ffd8' }, // green
];
const ORB_COLOR = '#eafcff';
const ORB_GLOW = '#5cf6ff';

class Board {
  constructor(mode, cfg) {
    this.mode = mode;                 // 'endless' | 'level' | 'duel'
    this.cfg = cfg || {};
    this.fx = new ParticleSystem();
    const seed = (cfg && cfg.seed != null) ? cfg.seed : ((Math.random() * 1e9) | 0);
    this.rng = makeRng(seed);
    this.bgRng = makeRng(seed ^ 0x9e3779b9);

    this.phase = 'play';              // 'play' | 'done' | 'won'
    this.score = 0;
    this.passed = 0;                  // gefangene Planeten = Fortschritt/Distanz
    this.combo = 0;
    this.bestCombo = 0;
    this.starsCollected = 0;
    this.starsTotal = 0;
    this.pressure = 0;                // Duell-Stress vom Gegner
    this.onPassed = null;

    this.planets = [];
    this.stars = [];
    this.nextIdx = 0;
    this.cam = { x: 0, y: 0 };
    this.time = 0;
    this.flightTime = 0;

    this.orb = { x: 0, y: 0, vx: 0, vy: 0, trail: [] };
    this.state = 'orbit';             // 'orbit' | 'flight'
    this.cur = null;
    this.theta = 0;
    this.dir = 1;
    this.releaseFromIdx = -1;
    this.pulse = 0;

    // Start-Planet + initialer Parcours
    const p0 = this._makePlanet(W.START_X, 0, 0);
    this.planets.push(p0);
    this.cur = p0;
    this._spawnAhead(true);
    this.theta = -Math.PI / 2;        // startet oben
    this.dir = 1;
    this._snapOrbit();
    this.cam.x = this.orb.x + W.LEAD;
    this.cam.y = this.orb.y * 0.4;

    // Hintergrund-Sternfeld (feste Weltpunkte, werden gewrappt)
    this.bgStars = [];
    for (let i = 0; i < 90; i++) {
      this.bgStars.push({
        x: this.bgRng() * 2600, y: this.bgRng() * 1400 - 700,
        r: 0.6 + this.bgRng() * 1.8, p: 0.2 + this.bgRng() * 0.6, // p = Parallax-Rate
        tw: this.bgRng() * TAU,
      });
    }
  }

  // --- Parameter je nach Modus/Schwierigkeit ---------------------------------
  _params() {
    let d;
    if (this.mode === 'level') d = clamp(this.cfg.diff != null ? this.cfg.diff : 0.4, 0, 1);
    else d = clamp(this.passed / 45, 0, 1); // endless/duel: Ramp über gefangene Planeten
    if (this.mode === 'duel') d = Math.min(1, d + this.pressure * 0.02);
    return {
      gap: lerp(250, 380, d),
      rad: lerp(60, 34, d),
      ang: lerp(1.7, 3.05, d),
      flight: lerp(465, 645, d),
      vary: lerp(120, 220, d),
      starChance: this.mode === 'level' ? (this.cfg.starChance != null ? this.cfg.starChance : 0.6) : 0.55,
    };
  }

  _makePlanet(x, y, idx) {
    const P = this._params();
    const r = idx === 0 ? 60 : P.rad * (0.9 + this.rng() * 0.2);
    const isGoal = this.mode === 'level' && this.cfg.goal != null && idx === this.cfg.goal;
    return {
      x, y, r, or: r + W.ORBIT_GAP, idx,
      hue: PLANET_HUES[idx % PLANET_HUES.length],
      visited: idx === 0, spin: this.rng() * TAU, goal: isGoal,
    };
  }

  // Planeten (und Sterne) nach rechts erzeugen, bis genug vor der Kamera liegen
  _spawnAhead(initial) {
    const targetX = this.cam.x + W.VIEW_W * 1.2;
    let guard = 0;
    while (guard++ < 60) {
      const last = this.planets[this.planets.length - 1];
      if (this.mode === 'level' && this.cfg.goal != null && last.idx >= this.cfg.goal) break;
      if (!initial && last.x > targetX) break;
      if (initial && this.planets.length >= 6) break;

      const P = this._params();
      let dyMax = P.vary;
      // Bias zur Mitte, wenn nah am Rand
      let ny = last.y + (this.rng() * 2 - 1) * dyMax;
      const center = (W.PLAY_TOP + W.PLAY_BOT) / 2;
      if (ny > W.PLAY_BOT || ny < W.PLAY_TOP) ny = last.y + (center - last.y) * 0.6 + (this.rng() * 2 - 1) * dyMax * 0.4;
      ny = clamp(ny, W.PLAY_TOP, W.PLAY_BOT);
      const nx = last.x + P.gap * (0.92 + this.rng() * 0.16);
      const p = this._makePlanet(nx, ny, this.nextIdx + 1);
      this.nextIdx++;
      this.planets.push(p);

      // Energie-Stern im Segment last→p (leicht abseits der Direktlinie → belohnt Skill)
      if (this.rng() < P.starChance) {
        const t = 0.4 + this.rng() * 0.2;
        const mx = lerp(last.x, nx, t), my = lerp(last.y, ny, t);
        const off = (this.rng() * 2 - 1) * 60;
        const perpx = -(ny - last.y), perpy = (nx - last.x);
        const pl = Math.hypot(perpx, perpy) || 1;
        this.stars.push({ x: mx + perpx / pl * off, y: clamp(my + perpy / pl * off, W.PLAY_TOP, W.PLAY_BOT), got: false, seg: last.idx, tw: this.rng() * TAU });
        this.starsTotal++;
      }
    }
    // Alte Objekte aufräumen (Endless-Speicher)
    const cutoff = this.cam.x - W.VIEW_W * 0.9;
    if (this.planets.length > 12) this.planets = this.planets.filter(p => p.x > cutoff || p.idx >= this.cur.idx - 1);
    this.stars = this.stars.filter(s => s.x > cutoff);
  }

  _snapOrbit() {
    this.orb.x = this.cur.x + Math.cos(this.theta) * this.cur.or;
    this.orb.y = this.cur.y + Math.sin(this.theta) * this.cur.or;
  }

  // --- Input: Loslassen aus dem Orbit ----------------------------------------
  release() {
    if (this.phase !== 'play' || this.state !== 'orbit') return;
    const tx = -Math.sin(this.theta) * this.dir;
    const ty = Math.cos(this.theta) * this.dir;
    const P = this._params();
    this.orb.vx = tx * P.flight;
    this.orb.vy = ty * P.flight;
    this.state = 'flight';
    this.flightTime = 0;
    this.releaseFromIdx = this.cur.idx;
    AudioEngine.play('launch');
    this.fx.ring(this.orb.x, this.orb.y, this.cur.hue.ring, { radius: this.cur.or * 0.9, width: 4, life: 0.4 });
    this.fx.burst(this.orb.x, this.orb.y, ORB_GLOW, { count: 8, speed: 180, size: 3, life: 0.4, glow: true });
  }
  // main.js ruft je nach Bindung tap() oder release()
  tap() { this.release(); }
  toggleEntry() { this.release(); }

  // --- Fang eines neuen Planeten ---------------------------------------------
  _capture(p) {
    const dx = this.orb.x - p.x, dy = this.orb.y - p.y;
    this.theta = Math.atan2(dy, dx);
    const cross = dx * this.orb.vy - dy * this.orb.vx;
    this.dir = cross >= 0 ? 1 : -1;
    const prevIdx = this.cur.idx;
    const skip = Math.max(0, p.idx - prevIdx - 1);

    // Combo-Bruch: gab es im durchflogenen Segment einen NICHT gesammelten Stern?
    let missedStar = false;
    for (const s of this.stars) {
      if (!s.got && s.seg >= prevIdx && s.seg < p.idx) { missedStar = true; break; }
    }
    if (missedStar && this.combo > 0) { this.combo = 0; }

    this.cur = p;
    p.visited = true;
    this.state = 'orbit';
    this._snapOrbit();
    this.passed++;

    let gain = 100 * (1 + skip);
    this.score += gain;
    AudioEngine.play('capture', this.combo + 1);
    this.fx.ring(p.x, p.y, p.hue.ring, { radius: p.or * 1.15, width: 5, life: 0.5 });
    this.fx.burst(p.x, p.y, p.hue.core, { count: 14, speed: 240, size: 4, life: 0.6, glow: true });
    this.fx.shake(5, 0.16);
    if (skip > 0) {
      AudioEngine.play('perfect');
      this.fx.text(this.orb.x, this.orb.y - 30, 'SKIP +' + (150 * skip), '#ffcf47', { size: 26 });
      this.score += 150 * skip;
    }
    if (typeof this.onPassed === 'function') this.onPassed();

    // Level-Ziel erreicht?
    if (this.mode === 'level' && this.cfg.goal != null && this.passed >= this.cfg.goal) {
      this.phase = 'won';
    }
  }

  _crash() {
    if (this.phase !== 'play') return;
    this.phase = 'done';
    this.state = 'flight';
    AudioEngine.play('gameover');
    this.fx.burst(this.orb.x, this.orb.y, '#ff5a5a', { count: 26, speed: 340, size: 5, life: 0.9, glow: true });
    this.fx.ring(this.orb.x, this.orb.y, '#ff7a7a', { radius: 140, width: 6, life: 0.6 });
    this.fx.shake(16, 0.5);
    this.fx.flash('#ff3b3b', 0.35);
  }

  // Nach Rewarded-Ad: zurück in einen sicheren Orbit am letzten Planeten
  revive() {
    this.phase = 'play';
    this.state = 'orbit';
    const dx = this.orb.x - this.cur.x, dy = this.orb.y - this.cur.y;
    this.theta = Math.atan2(dy, dx);
    this.dir = 1;
    this._snapOrbit();
    this.orb.trail.length = 0;
    this.fx.ring(this.cur.x, this.cur.y, '#4dffa6', { radius: this.cur.or * 1.3, width: 5, life: 0.6 });
    this.fx.flash('#4dffa6', 0.2);
  }

  rating() {
    if (this.starsTotal === 0) return 3;
    const r = this.starsCollected / this.starsTotal;
    if (r >= 0.85) return 3;
    if (r >= 0.5) return 2;
    return 1;
  }

  screenToWorld() { return { x: 0, y: 0 }; } // Kompat-Stub (Input ist positions-los)

  // --- Update -----------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.pulse = (this.pulse + dt * 3) % TAU;
    this.fx.update(dt);

    if (this.phase === 'done') { this._updateCamera(dt); return; }

    const P = this._params();
    if (this.state === 'orbit') {
      const ang = this.mode === 'duel' ? P.ang + this.pressure * 0.05 : P.ang;
      this.theta += this.dir * ang * dt;
      this._snapOrbit();
    } else {
      // Flight-Integration (Substeps gegen Tunneling durch kleine Ringe)
      this.flightTime += dt;
      const steps = 3;
      const h = dt / steps;
      for (let s = 0; s < steps && this.state === 'flight'; s++) {
        this.orb.x += this.orb.vx * h;
        this.orb.y += this.orb.vy * h;
        // Sterne einsammeln
        for (const st of this.stars) {
          if (st.got) continue;
          if (dist2(this.orb.x, this.orb.y, st.x, st.y) <= W.STAR_R * W.STAR_R) {
            st.got = true;
            this.combo++;
            this.bestCombo = Math.max(this.bestCombo, this.combo);
            this.starsCollected++;
            this.score += 25 * Math.min(this.combo, 20);
            AudioEngine.play('star');
            this.fx.burst(st.x, st.y, '#ffe9a8', { count: 7, speed: 150, size: 3, life: 0.5, glow: true });
            if (this.combo > 1 && this.combo % 5 === 0) {
              AudioEngine.play('combo', this.combo);
              this.fx.text(st.x, st.y - 26, t('combo') + ' x' + this.combo, '#ffcf47', { size: 28 });
            }
          }
        }
        // Fang prüfen
        for (const p of this.planets) {
          if (p.idx <= this.releaseFromIdx) continue;
          if (dist2(this.orb.x, this.orb.y, p.x, p.y) <= p.or * p.or) { this._capture(p); break; }
        }
      }
      // Absturz-Bedingungen
      if (this.state === 'flight') {
        if (this.orb.y < W.PLAY_TOP - W.CORRIDOR || this.orb.y > W.PLAY_BOT + W.CORRIDOR) this._crash();
        else if (this.flightTime > W.MAX_FLIGHT) this._crash();
      }
    }

    // Trail
    this.orb.trail.push({ x: this.orb.x, y: this.orb.y });
    if (this.orb.trail.length > 22) this.orb.trail.shift();

    this._spawnAhead(false);
    this._updateCamera(dt);
  }

  _updateCamera(dt) {
    const tx = this.orb.x + W.LEAD;
    const ty = clamp(this.orb.y * 0.5, W.PLAY_TOP, W.PLAY_BOT);
    this.cam.x = damp(this.cam.x, tx, 0.0008, dt);
    this.cam.y = damp(this.cam.y, ty, 0.0015, dt);
  }

  // --- Rendering --------------------------------------------------------------
  render(ctx, vp) {
    const scale = Math.min(vp.w / W.VIEW_W, vp.h / W.VIEW_H);
    const off = { x: this.cam.x, y: this.cam.y, scale, cx: vp.w / 2, cy: vp.h / 2 };
    const W2S = (wx, wy) => [(wx - off.x) * scale + off.cx, (wy - off.y) * scale + off.cy];

    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.w, vp.h);
    ctx.clip();
    ctx.translate(vp.x, vp.y);

    // Hintergrund-Gradient (Weltraum)
    const bg = ctx.createLinearGradient(0, 0, 0, vp.h);
    bg.addColorStop(0, '#0b0620');
    bg.addColorStop(0.55, '#120a2e');
    bg.addColorStop(1, '#090418');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, vp.w, vp.h);

    // Screenshake
    this.fx.applyShake(ctx);

    // Nebel-Blobs (dezent, langsame Parallax)
    this._drawNebula(ctx, vp);
    // Parallax-Sternenfeld
    this._drawStarfield(ctx, vp, scale);
    // Korridor-Gefahrenzone
    this._drawCorridor(ctx, vp, W2S, scale);

    // Energie-Sterne
    for (const s of this.stars) {
      if (s.got) continue;
      const [sx, sy] = W2S(s.x, s.y);
      if (sx < -40 || sx > vp.w + 40) continue;
      this._drawEnergyStar(ctx, sx, sy, scale, s.tw);
    }

    // Planeten
    for (const p of this.planets) {
      const [sx, sy] = W2S(p.x, p.y);
      if (sx < -160 || sx > vp.w + 160) continue;
      this._drawPlanet(ctx, p, sx, sy, scale);
    }

    // Release-Vorschau (Tangenten-Hinweis) im Orbit
    if (this.state === 'orbit' && this.phase === 'play') {
      this._drawAimHint(ctx, W2S, scale);
    }

    // Partikel (Welt-Raum)
    this.fx.draw(ctx, off);

    // Orb + Trail
    this._drawOrb(ctx, W2S, scale);

    // Fullscreen-Flash (Screen-Space, im vp-Clip)
    this.fx.drawFlash(ctx, vp.w, vp.h);
    ctx.restore();
  }

  _drawNebula(ctx, vp) {
    const blobs = [
      { x: 0.25, y: 0.3, c: 'rgba(80,40,150,0.16)', r: 0.6 },
      { x: 0.8, y: 0.7, c: 'rgba(30,120,160,0.13)', r: 0.7 },
    ];
    for (const b of blobs) {
      const px = ((b.x - (this.cam.x * 0.02 % vp.w) / vp.w) % 1 + 1) % 1;
      const cx = px * vp.w, cy = b.y * vp.h, rad = b.r * Math.max(vp.w, vp.h);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, b.c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vp.w, vp.h);
    }
  }

  _drawStarfield(ctx, vp, scale) {
    const tileW = 2600, tileH = 1400;
    for (const s of this.bgStars) {
      const px = -this.cam.x * s.p, py = -this.cam.y * s.p;
      let x = ((s.x + px) % tileW + tileW) % tileW;
      let y = ((s.y + py + tileH / 2) % tileH + tileH) % tileH;
      // in Screen einpassen (Tile deckt Viewport)
      x = (x / tileW) * (vp.w + 40) - 20;
      y = (y / tileH) * (vp.h + 40) - 20;
      const tw = 0.5 + 0.5 * Math.sin(this.time * 2 + s.tw);
      ctx.globalAlpha = 0.35 + tw * 0.5;
      ctx.fillStyle = '#cfe4ff';
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawCorridor(ctx, vp, W2S, scale) {
    const [, topY] = W2S(0, W.PLAY_TOP - W.CORRIDOR);
    const [, botY] = W2S(0, W.PLAY_BOT + W.CORRIDOR);
    // rote Gefahrenzone über/unter dem Korridor
    if (topY > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, topY);
      g.addColorStop(0, 'rgba(255,50,60,0.12)');
      g.addColorStop(1, 'rgba(255,50,60,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, vp.w, topY);
    }
    if (botY < vp.h) {
      const g = ctx.createLinearGradient(0, botY, 0, vp.h);
      g.addColorStop(0, 'rgba(255,50,60,0)');
      g.addColorStop(1, 'rgba(255,50,60,0.12)');
      ctx.fillStyle = g; ctx.fillRect(0, botY, vp.w, vp.h - botY);
    }
    ctx.strokeStyle = 'rgba(255,90,100,0.28)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 12]);
    ctx.beginPath(); ctx.moveTo(0, topY); ctx.lineTo(vp.w, topY);
    ctx.moveTo(0, botY); ctx.lineTo(vp.w, botY); ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawPlanet(ctx, p, sx, sy, scale) {
    const r = p.r * scale, or = p.or * scale;
    // Orbit-Ring (aktueller pulsiert)
    const isCur = p === this.cur && this.phase === 'play';
    ctx.lineWidth = (isCur ? 2.6 : 1.6);
    ctx.strokeStyle = p.hue.ring;
    ctx.globalAlpha = isCur ? 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(this.pulse)) : (p.visited ? 0.18 : 0.32);
    ctx.beginPath(); ctx.arc(sx, sy, or, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;

    // Glow
    const g = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 1.9);
    g.addColorStop(0, p.hue.core);
    g.addColorStop(0.5, p.hue.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = p.visited ? 0.5 : 0.95;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, r * 1.9, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;

    // Kern
    ctx.shadowColor = p.hue.core; ctx.shadowBlur = 18 * scale;
    ctx.fillStyle = p.visited ? p.hue.glow : p.hue.core;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    // Glanzpunkt
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(sx - r * 0.32, sy - r * 0.32, r * 0.24, 0, TAU); ctx.fill();

    // Ziel-Planet (Level) markieren
    if (p.goal) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.pulse * 1.5);
      ctx.beginPath(); ctx.arc(sx, sy, r + 8 * scale, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${13 * scale}px Nunito, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('★', sx, sy - or - 6 * scale);
    }
  }

  _drawEnergyStar(ctx, sx, sy, scale, tw) {
    const s = (7 + Math.sin(this.time * 4 + tw) * 1.5) * scale;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.time * 1.5 + tw);
    ctx.shadowColor = '#ffe9a8'; ctx.shadowBlur = 12 * scale;
    ctx.fillStyle = '#ffe37a';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU;
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      ctx.lineTo(Math.cos(a + TAU / 8) * s * 0.42, Math.sin(a + TAU / 8) * s * 0.42);
    }
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawAimHint(ctx, W2S, scale) {
    const tx = -Math.sin(this.theta) * this.dir;
    const ty = Math.cos(this.theta) * this.dir;
    const [ox, oy] = W2S(this.orb.x, this.orb.y);
    ctx.save();
    ctx.strokeStyle = ORB_GLOW;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + tx * 60 * scale, oy + ty * 60 * scale);
    ctx.stroke();
    ctx.setLineDash([]);
    // Pfeilspitze
    const ex = ox + tx * 60 * scale, ey = oy + ty * 60 * scale;
    const ang = Math.atan2(ty, tx);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ORB_GLOW;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.4) * 10 * scale, ey - Math.sin(ang - 0.4) * 10 * scale);
    ctx.lineTo(ex - Math.cos(ang + 0.4) * 10 * scale, ey - Math.sin(ang + 0.4) * 10 * scale);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawOrb(ctx, W2S, scale) {
    // Trail
    const tr = this.orb.trail;
    if (tr.length > 1) {
      for (let i = 1; i < tr.length; i++) {
        const [ax, ay] = W2S(tr[i - 1].x, tr[i - 1].y);
        const [bx, by] = W2S(tr[i].x, tr[i].y);
        const k = i / tr.length;
        ctx.globalAlpha = k * 0.55;
        ctx.strokeStyle = ORB_GLOW;
        ctx.lineWidth = k * 7 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (this.phase === 'done') return;
    const [ox, oy] = W2S(this.orb.x, this.orb.y);
    const r = 11 * scale;
    ctx.shadowColor = ORB_GLOW; ctx.shadowBlur = 22 * scale;
    ctx.fillStyle = ORB_GLOW;
    ctx.beginPath(); ctx.arc(ox, oy, r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = ORB_COLOR;
    ctx.beginPath(); ctx.arc(ox, oy, r * 0.55, 0, TAU); ctx.fill();
  }
}

// Konfigs werden in levels.js definiert (ENDLESS, DUEL, LEVELS)
