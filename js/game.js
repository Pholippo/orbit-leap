// game.js — ORBIT LEAP: Orbit-/Slingshot-Kernlogik + Neon-Weltraum-Rendering (Sprite-Upgrade)
// Mechanik: Schiff kreist um einen Planeten. Tap = loslassen → fliegt tangential weg →
// muss den Orbit-Ring des nächsten Planeten treffen (Gravity-Hop). Verfehlt = Absturz.
'use strict';

const W = {
  PLAY_TOP: -240, PLAY_BOT: 240,
  CORRIDOR: 150,
  ORBIT_GAP: 30,
  VIEW_W: 1040, VIEW_H: 900,
  LEAD: 150,
  MAX_FLIGHT: 3.2,
  STAR_R: 34,
  START_X: 0,
};

// Neon-Planeten-Paletten {core, glow, ring} — Index matcht ASSETS.planets
const PLANET_HUES = [
  { core: '#3fd4ff', glow: '#0a7fbf', ring: '#8ef0ff' }, // 0 cyan / ice
  { core: '#ff5ea8', glow: '#b01d63', ring: '#ffb0d6' }, // 1 magenta / gas
  { core: '#ffcf47', glow: '#b8791a', ring: '#ffe9a8' }, // 2 gold / lava
  { core: '#7c6bff', glow: '#3a2ea8', ring: '#c3bcff' }, // 3 violet
  { core: '#4dffa6', glow: '#149a5c', ring: '#b0ffd8' }, // 4 green
];
const ORB_COLOR = '#eafcff';
const ORB_GLOW = '#5cf6ff';

// kürzeste Winkel-Interpolation (frameunabhängig gedämpft)
function angleTo(cur, target, smoothing, dt) {
  let d = ((target - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return cur + d * (1 - Math.pow(smoothing, dt));
}

class Board {
  constructor(mode, cfg) {
    this.mode = mode;
    this.cfg = cfg || {};
    this.fx = new ParticleSystem();
    const seed = (cfg && cfg.seed != null) ? cfg.seed : ((Math.random() * 1e9) | 0);
    this.rng = makeRng(seed);
    this.bgRng = makeRng(seed ^ 0x9e3779b9);

    this.phase = 'play';
    this.score = 0;
    this.passed = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.starsCollected = 0;
    this.starsTotal = 0;
    this.pressure = 0;
    this.onPassed = null;

    this.planets = [];
    this.stars = [];
    this.nextIdx = 0;
    this.cam = { x: 0, y: 0 };
    this.time = 0;
    this.flightTime = 0;

    this.orb = { x: 0, y: 0, vx: 0, vy: 0, trail: [] };
    this.state = 'orbit';
    this.cur = null;
    this.theta = 0;
    this.dir = 1;
    this.releaseFromIdx = -1;
    this.pulse = 0;

    // Juice / Game-Feel
    this.hitstop = 0;      // Physik-Freeze (Capture-Snap)
    this.slowmo = 0;       // Zeitlupe (Skip-Belohnung)
    this.zoomKick = 0;     // kurzer Kamera-Punch
    this.camZoom = 1;      // Speed-Kamera
    this.shipAngle = -Math.PI / 2;
    this.thrust = 0;       // Thruster-Intensität 0..1
    this.speed = 0;

    const p0 = this._makePlanet(W.START_X, 0, 0);
    this.planets.push(p0);
    this.cur = p0;
    this._spawnAhead(true);
    this.theta = -Math.PI / 2;
    this.dir = 1;
    this._snapOrbit();
    this.cam.x = this.orb.x + W.LEAD;
    this.cam.y = this.orb.y * 0.4;

    this.bgStars = [];
    for (let i = 0; i < 120; i++) {
      this.bgStars.push({
        x: this.bgRng() * 2600, y: this.bgRng() * 1400 - 700,
        r: 0.5 + this.bgRng() * 1.9, p: 0.15 + this.bgRng() * 0.7,
        tw: this.bgRng() * TAU,
      });
    }
  }

  _params() {
    let d;
    if (this.mode === 'level') d = clamp(this.cfg.diff != null ? this.cfg.diff : 0.4, 0, 1);
    else d = clamp(this.passed / 45, 0, 1);
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
      hueIdx: idx % PLANET_HUES.length,
      hue: PLANET_HUES[idx % PLANET_HUES.length],
      visited: idx === 0, spin: this.rng() * TAU, goal: isGoal,
    };
  }

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
      let ny = last.y + (this.rng() * 2 - 1) * dyMax;
      const center = (W.PLAY_TOP + W.PLAY_BOT) / 2;
      if (ny > W.PLAY_BOT || ny < W.PLAY_TOP) ny = last.y + (center - last.y) * 0.6 + (this.rng() * 2 - 1) * dyMax * 0.4;
      ny = clamp(ny, W.PLAY_TOP, W.PLAY_BOT);
      const nx = last.x + P.gap * (0.92 + this.rng() * 0.16);
      const p = this._makePlanet(nx, ny, this.nextIdx + 1);
      this.nextIdx++;
      this.planets.push(p);

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
    const cutoff = this.cam.x - W.VIEW_W * 0.9;
    if (this.planets.length > 12) this.planets = this.planets.filter(p => p.x > cutoff || p.idx >= this.cur.idx - 1);
    this.stars = this.stars.filter(s => s.x > cutoff);
  }

  _snapOrbit() {
    this.orb.x = this.cur.x + Math.cos(this.theta) * this.cur.or;
    this.orb.y = this.cur.y + Math.sin(this.theta) * this.cur.or;
  }

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
    this.thrust = 1;
    this.zoomKick = Math.max(this.zoomKick, 0.03);
    AudioEngine.play('launch');
    this.fx.ring(this.orb.x, this.orb.y, this.cur.hue.ring, { radius: this.cur.or * 0.9, width: 4, life: 0.4 });
    // Warp-Burst: additive Speedlines entgegen der Flugrichtung
    for (let i = 0; i < 10; i++) {
      const sp = 120 + this.rng() * 160;
      this.fx.spark(this.orb.x, this.orb.y, -tx, -ty, sp, ORB_GLOW, { spread: 0.5, size: 2.5, life: 0.35 });
    }
  }
  tap() { this.release(); }
  toggleEntry() { this.release(); }

  _capture(p) {
    const dx = this.orb.x - p.x, dy = this.orb.y - p.y;
    this.theta = Math.atan2(dy, dx);
    const cross = dx * this.orb.vy - dy * this.orb.vx;
    this.dir = cross >= 0 ? 1 : -1;
    const prevIdx = this.cur.idx;
    const skip = Math.max(0, p.idx - prevIdx - 1);

    let missedStar = false;
    for (const s of this.stars) {
      if (!s.got && s.seg >= prevIdx && s.seg < p.idx) { missedStar = true; break; }
    }
    if (missedStar && this.combo > 0) this.combo = 0;

    this.cur = p;
    p.visited = true;
    p.hitT = 0.5; // Planet "zündet" kurz
    this.state = 'orbit';
    this._snapOrbit();
    this.passed++;

    this.score += 100 * (1 + skip);
    // Capture-Snap-Choreografie
    this.hitstop = 0.06;
    this.zoomKick = Math.max(this.zoomKick, 0.05);
    this.thrust = 0.5;
    AudioEngine.play('capture', this.combo + 1);
    this.fx.ring(p.x, p.y, '#ffffff', { radius: p.or * 0.6, width: 6, life: 0.45 });
    this.fx.ring(p.x, p.y, p.hue.ring, { radius: p.or * 1.3, width: 4, life: 0.6 });
    for (let i = 0; i < 16; i++) {
      const a = this.rng() * TAU;
      this.fx.spark(this.orb.x, this.orb.y, Math.cos(a), Math.sin(a), 160 + this.rng() * 160, p.hue.core, { spread: 0.15, size: 3, life: 0.55 });
    }
    this.fx.shake(6, 0.18);
    this.fx.flash('#ffffff', 0.14);
    if (skip > 0) {
      AudioEngine.play('perfect');
      this.slowmo = 0.22;
      this.fx.text(this.orb.x, this.orb.y - 30, 'SKIP +' + (150 * skip), '#ffcf47', { size: 26 });
      this.score += 150 * skip;
    }
    if (typeof this.onPassed === 'function') this.onPassed();

    if (this.mode === 'level' && this.cfg.goal != null && this.passed >= this.cfg.goal) this.phase = 'won';
  }

  _crash() {
    if (this.phase !== 'play') return;
    this.phase = 'done';
    this.state = 'flight';
    AudioEngine.play('gameover');
    this.fx.burst(this.orb.x, this.orb.y, '#ff5a5a', { count: 30, speed: 360, size: 5, life: 0.9, glow: true });
    for (let i = 0; i < 20; i++) {
      const a = this.rng() * TAU;
      this.fx.spark(this.orb.x, this.orb.y, Math.cos(a), Math.sin(a), 200 + this.rng() * 220, pick(['#ff5a5a', '#ffb347', '#fff']), { spread: 0.1, size: 3.5, life: 0.9 });
    }
    this.fx.ring(this.orb.x, this.orb.y, '#ff7a7a', { radius: 150, width: 6, life: 0.6 });
    this.fx.shake(18, 0.5);
    this.fx.flash('#ff3b3b', 0.4);
  }

  revive() {
    this.phase = 'play';
    this.state = 'orbit';
    const dx = this.orb.x - this.cur.x, dy = this.orb.y - this.cur.y;
    this.theta = Math.atan2(dy, dx);
    this.dir = 1;
    this._snapOrbit();
    this.orb.trail.length = 0;
    this.hitstop = 0; this.slowmo = 0;
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

  screenToWorld() { return { x: 0, y: 0 }; }

  // --- Update -----------------------------------------------------------------
  update(realDt) {
    this.time += realDt;
    this.pulse = (this.pulse + realDt * 3) % TAU;
    this.fx.update(realDt);
    for (const p of this.planets) if (p.hitT > 0) p.hitT = Math.max(0, p.hitT - realDt);

    // Kamera-Kick + Thruster-Abklingen (Echtzeit)
    this.zoomKick *= Math.pow(0.02, realDt);
    this.thrust = damp(this.thrust, this.state === 'flight' ? 0.85 : 0.12, 0.001, realDt);

    if (this.phase === 'done') { this._updateCamera(realDt); return; }

    // Zeit-Skalierung (Hitstop / Slowmo) — nur Physik, nicht FX/Kamera
    let dt = realDt;
    if (this.hitstop > 0) { this.hitstop -= realDt; dt = realDt * 0.04; }
    else if (this.slowmo > 0) { this.slowmo -= realDt; dt = realDt * 0.32; }

    const P = this._params();
    if (this.state === 'orbit') {
      const ang = this.mode === 'duel' ? P.ang + this.pressure * 0.05 : P.ang;
      this.theta += this.dir * ang * dt;
      this._snapOrbit();
      this.speed = ang * this.cur.or;
    } else {
      this.flightTime += dt;
      this.speed = Math.hypot(this.orb.vx, this.orb.vy);
      const steps = 3, h = dt / steps;
      for (let s = 0; s < steps && this.state === 'flight'; s++) {
        this.orb.x += this.orb.vx * h;
        this.orb.y += this.orb.vy * h;
        for (const st of this.stars) {
          if (st.got) continue;
          if (dist2(this.orb.x, this.orb.y, st.x, st.y) <= W.STAR_R * W.STAR_R) {
            st.got = true;
            this.combo++;
            this.bestCombo = Math.max(this.bestCombo, this.combo);
            this.starsCollected++;
            this.score += 25 * Math.min(this.combo, 20);
            AudioEngine.play('star');
            for (let k = 0; k < 6; k++) { const a = this.rng() * TAU; this.fx.spark(st.x, st.y, Math.cos(a), Math.sin(a), 90 + this.rng() * 90, '#ffe9a8', { spread: 0.2, size: 2.5, life: 0.5 }); }
            if (this.combo > 1 && this.combo % 5 === 0) {
              AudioEngine.play('combo', this.combo);
              this.fx.text(st.x, st.y - 26, t('combo') + ' x' + this.combo, '#ffcf47', { size: 28 });
              this.fx.flash('#ffcf47', 0.1);
            }
          }
        }
        for (const p of this.planets) {
          if (p.idx <= this.releaseFromIdx) continue;
          if (dist2(this.orb.x, this.orb.y, p.x, p.y) <= p.or * p.or) { this._capture(p); break; }
        }
      }
      if (this.state === 'flight') {
        // magnetisches Einsaugen naher Energie-Kristalle (Juice)
        for (const st of this.stars) {
          if (st.got) continue;
          const d2 = dist2(this.orb.x, this.orb.y, st.x, st.y);
          if (d2 < 5800 && d2 > 1) {
            const d = Math.sqrt(d2);
            const pull = (1 - d / 76) * 340 * realDt;
            st.x += (this.orb.x - st.x) / d * pull;
            st.y += (this.orb.y - st.y) / d * pull;
          }
        }
        if (this.orb.y < W.PLAY_TOP - W.CORRIDOR || this.orb.y > W.PLAY_BOT + W.CORRIDOR) this._crash();
        else if (this.flightTime > W.MAX_FLIGHT) this._crash();
      }
    }

    // Schiffs-Ausrichtung (smooth) auf Bewegungsrichtung
    let aimA;
    if (this.state === 'orbit') aimA = Math.atan2(Math.cos(this.theta) * this.dir, -Math.sin(this.theta) * this.dir);
    else aimA = Math.atan2(this.orb.vy, this.orb.vx);
    this.shipAngle = angleTo(this.shipAngle, aimA, 0.0001, realDt);

    // Trail
    this.orb.trail.push({ x: this.orb.x, y: this.orb.y, f: this.state === 'flight' });
    if (this.orb.trail.length > 26) this.orb.trail.shift();

    this._spawnAhead(false);
    this._updateCamera(realDt);
  }

  _updateCamera(dt) {
    const tx = this.orb.x + W.LEAD;
    const ty = clamp(this.orb.y * 0.5, W.PLAY_TOP, W.PLAY_BOT);
    this.cam.x = damp(this.cam.x, tx, 0.0008, dt);
    this.cam.y = damp(this.cam.y, ty, 0.0015, dt);
    // Speed-Kamera: im Orbit leicht rein, im Flug leicht raus
    const zt = this.state === 'flight' ? 0.95 : 1.07;
    this.camZoom = damp(this.camZoom, zt, 0.002, dt);
  }

  // --- Rendering --------------------------------------------------------------
  render(ctx, vp) {
    const baseScale = Math.min(vp.w / W.VIEW_W, vp.h / W.VIEW_H);
    const scale = baseScale * this.camZoom * (1 + this.zoomKick);
    const off = { x: this.cam.x, y: this.cam.y, scale, cx: vp.w / 2, cy: vp.h / 2 };
    const W2S = (wx, wy) => [(wx - off.x) * scale + off.cx, (wy - off.y) * scale + off.cy];

    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.w, vp.h);
    ctx.clip();
    ctx.translate(vp.x, vp.y);

    const bg = ctx.createLinearGradient(0, 0, 0, vp.h);
    bg.addColorStop(0, '#0b0620');
    bg.addColorStop(0.55, '#120a2e');
    bg.addColorStop(1, '#090418');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, vp.w, vp.h);

    this._drawNebula(ctx, vp);
    this.fx.applyShake(ctx);
    this._drawStarfield(ctx, vp);
    this._drawCorridor(ctx, vp, W2S);

    for (const s of this.stars) {
      if (s.got) continue;
      const [sx, sy] = W2S(s.x, s.y);
      if (sx < -40 || sx > vp.w + 40) continue;
      this._drawEnergyStar(ctx, sx, sy, scale, s.tw);
    }

    for (const p of this.planets) {
      const [sx, sy] = W2S(p.x, p.y);
      if (sx < -180 || sx > vp.w + 180) continue;
      this._drawPlanet(ctx, p, sx, sy, scale);
    }

    if (this.state === 'orbit' && this.phase === 'play') this._drawAimHint(ctx, W2S, scale);

    this.fx.draw(ctx, off);
    this._drawShip(ctx, W2S, scale);

    this.fx.drawFlash(ctx, vp.w, vp.h);
    ctx.restore();
  }

  _drawNebula(ctx, vp) {
    const img = ASSETS.nebula;
    if (ASSETS.ready(img)) {
      // Cover-Fit + langsame horizontale Parallax
      const s = Math.max(vp.w / img.naturalWidth, vp.h / img.naturalHeight) * 1.15;
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      let ox = (-this.cam.x * 0.06) % iw; if (ox > 0) ox -= iw;
      const oy = (vp.h - ih) / 2 - this.cam.y * 0.04;
      ctx.globalAlpha = 0.55;
      for (let x = ox; x < vp.w; x += iw) ctx.drawImage(img, x, oy, iw, ih);
      ctx.globalAlpha = 1;
      // Abdunkeln für Lesbarkeit
      ctx.fillStyle = 'rgba(9,5,20,0.45)';
      ctx.fillRect(0, 0, vp.w, vp.h);
    } else {
      const blobs = [{ x: 0.25, y: 0.3, c: 'rgba(80,40,150,0.16)', r: 0.6 }, { x: 0.8, y: 0.7, c: 'rgba(30,120,160,0.13)', r: 0.7 }];
      for (const b of blobs) {
        const cx = b.x * vp.w, cy = b.y * vp.h, rad = b.r * Math.max(vp.w, vp.h);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, b.c); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, vp.w, vp.h);
      }
    }
  }

  _drawStarfield(ctx, vp) {
    const tileW = 2600, tileH = 1400;
    for (const s of this.bgStars) {
      let x = ((s.x - this.cam.x * s.p) % tileW + tileW) % tileW;
      let y = ((s.y - this.cam.y * s.p + tileH / 2) % tileH + tileH) % tileH;
      x = (x / tileW) * (vp.w + 40) - 20;
      y = (y / tileH) * (vp.h + 40) - 20;
      const tw = 0.5 + 0.5 * Math.sin(this.time * 2 + s.tw);
      ctx.globalAlpha = 0.3 + tw * 0.5;
      ctx.fillStyle = '#cfe4ff';
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawCorridor(ctx, vp, W2S) {
    const [, topY] = W2S(0, W.PLAY_TOP - W.CORRIDOR);
    const [, botY] = W2S(0, W.PLAY_BOT + W.CORRIDOR);
    if (topY > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, topY);
      g.addColorStop(0, 'rgba(255,50,60,0.12)'); g.addColorStop(1, 'rgba(255,50,60,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, vp.w, topY);
    }
    if (botY < vp.h) {
      const g = ctx.createLinearGradient(0, botY, 0, vp.h);
      g.addColorStop(0, 'rgba(255,50,60,0)'); g.addColorStop(1, 'rgba(255,50,60,0.12)');
      ctx.fillStyle = g; ctx.fillRect(0, botY, vp.w, vp.h - botY);
    }
    ctx.strokeStyle = 'rgba(255,90,100,0.28)';
    ctx.lineWidth = 1.5; ctx.setLineDash([10, 12]);
    ctx.beginPath(); ctx.moveTo(0, topY); ctx.lineTo(vp.w, topY); ctx.moveTo(0, botY); ctx.lineTo(vp.w, botY); ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawPlanet(ctx, p, sx, sy, scale) {
    const r = p.r * scale, or = p.or * scale;
    const isCur = p === this.cur && this.phase === 'play';
    const hit = p.hitT > 0 ? p.hitT / 0.5 : 0;

    // Orbit-Ring
    ctx.lineWidth = (isCur ? 2.6 : 1.6);
    ctx.strokeStyle = p.hue.ring;
    ctx.globalAlpha = isCur ? 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(this.pulse)) : (p.visited ? 0.16 : 0.3);
    ctx.beginPath(); ctx.arc(sx, sy, or, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;

    // Atmosphären-Glow
    const gr = r * (1.7 + hit * 0.5);
    const g = ctx.createRadialGradient(sx, sy, r * 0.55, sx, sy, gr);
    g.addColorStop(0, p.hue.core); g.addColorStop(0.55, p.hue.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (p.visited ? 0.35 : 0.7) + hit * 0.4;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, gr, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;

    // Planeten-Sprite (Circle-Clip) oder prozeduraler Kern
    const img = ASSETS.planets[p.hueIdx];
    if (ASSETS.ready(img)) {
      ctx.save();
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.clip();
      if (p.visited) ctx.globalAlpha = 0.72;
      const d = r * 2.06; // leicht überfüllen → kein schwarzer Rand
      ctx.drawImage(img, sx - d / 2, sy - d / 2, d, d);
      ctx.restore();
      ctx.globalAlpha = 1;
      // Rim-Glow zur Farbkohärenz
      ctx.strokeStyle = p.hue.core;
      ctx.globalAlpha = 0.35 + hit * 0.5;
      ctx.lineWidth = 2 * scale;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.shadowColor = p.hue.core; ctx.shadowBlur = 18 * scale;
      ctx.fillStyle = p.visited ? p.hue.glow : p.hue.core;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(sx - r * 0.32, sy - r * 0.32, r * 0.24, 0, TAU); ctx.fill();
    }

    if (p.goal) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.pulse * 1.5);
      ctx.beginPath(); ctx.arc(sx, sy, r + 8 * scale, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = `800 ${13 * scale}px Nunito, system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('★', sx, sy - or - 6 * scale);
    }
  }

  _drawEnergyStar(ctx, sx, sy, scale, tw) {
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 5 + tw);
    const s = 11 * scale * pulse;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.globalCompositeOperation = 'lighter';
    // weicher Glow-Hof
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.4);
    g.addColorStop(0, 'rgba(255,232,150,0.65)');
    g.addColorStop(0.5, 'rgba(255,200,80,0.22)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, s * 2.4, 0, TAU); ctx.fill();
    // Kristall (facettierter Diamant), langsam rotierend
    ctx.rotate(this.time * 1.1 + tw);
    ctx.fillStyle = '#fff6cf';
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s * 0.6, -s * 0.2); ctx.lineTo(s * 0.42, s); ctx.lineTo(-s * 0.42, s); ctx.lineTo(-s * 0.6, -s * 0.2);
    ctx.closePath(); ctx.fill();
    // Facetten-Schattierung
    ctx.fillStyle = 'rgba(255,205,90,0.85)';
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.6, -s * 0.2); ctx.lineTo(0, s * 0.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,225,120,0.6)';
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(-s * 0.6, -s * 0.2); ctx.lineTo(0, s * 0.1); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawAimHint(ctx, W2S, scale) {
    const tx = -Math.sin(this.theta) * this.dir;
    const ty = Math.cos(this.theta) * this.dir;
    const [ox, oy] = W2S(this.orb.x, this.orb.y);
    ctx.save();
    ctx.strokeStyle = ORB_GLOW; ctx.globalAlpha = 0.32; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + tx * 62 * scale, oy + ty * 62 * scale); ctx.stroke();
    ctx.setLineDash([]);
    const ex = ox + tx * 62 * scale, ey = oy + ty * 62 * scale, ang = Math.atan2(ty, tx);
    ctx.globalAlpha = 0.5; ctx.fillStyle = ORB_GLOW;
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.4) * 10 * scale, ey - Math.sin(ang - 0.4) * 10 * scale);
    ctx.lineTo(ex - Math.cos(ang + 0.4) * 10 * scale, ey - Math.sin(ang + 0.4) * 10 * scale);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawShip(ctx, W2S, scale) {
    // Ion-Trail (additiv, geschwindigkeits-reaktiv)
    const tr = this.orb.trail;
    if (tr.length > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        const [ax, ay] = W2S(tr[i - 1].x, tr[i - 1].y);
        const [bx, by] = W2S(tr[i].x, tr[i].y);
        const k = i / tr.length;
        const wide = tr[i].f ? 9 : 4.5;
        ctx.globalAlpha = k * (tr[i].f ? 0.5 : 0.32);
        ctx.strokeStyle = tr[i].f ? '#aef2ff' : ORB_GLOW;
        ctx.lineWidth = k * wide * scale;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.restore();
    }
    if (this.phase === 'done') return;

    const [ox, oy] = W2S(this.orb.x, this.orb.y);
    const shipSz = 50 * scale;

    // Thruster-Flamme (additiv, am Heck)
    const th = this.thrust;
    if (th > 0.05) {
      const back = this.shipAngle + Math.PI;
      const hx = ox + Math.cos(back) * shipSz * 0.42, hy = oy + Math.sin(back) * shipSz * 0.42;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(hx, hy);
      ctx.rotate(back);
      const len = (14 + th * 34 + Math.sin(this.time * 40) * 3) * scale;
      const wdt = (6 + th * 4) * scale;
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(230,250,255,0.95)');
      g.addColorStop(0.4, 'rgba(70,190,255,0.6)');
      g.addColorStop(1, 'rgba(70,120,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(len * 0.5, 0, len * 0.5, wdt, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // Schiff-Sprite (rotiert zur Flugrichtung; Sprite-Nase zeigt nach oben)
    if (ASSETS.ready(ASSETS.ship)) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(this.shipAngle + Math.PI / 2);
      ctx.shadowColor = ORB_GLOW; ctx.shadowBlur = 14 * scale;
      const d = shipSz;
      ctx.drawImage(ASSETS.ship, -d / 2, -d / 2, d, d);
      ctx.restore();
    } else {
      const r = 11 * scale;
      ctx.shadowColor = ORB_GLOW; ctx.shadowBlur = 22 * scale;
      ctx.fillStyle = ORB_GLOW; ctx.beginPath(); ctx.arc(ox, oy, r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = ORB_COLOR; ctx.beginPath(); ctx.arc(ox, oy, r * 0.55, 0, TAU); ctx.fill();
    }
  }
}
