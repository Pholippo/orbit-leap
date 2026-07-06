// particles.js — Partikel- & Juice-System (Burst, Ringe, Floating-Text, Screenshake)
'use strict';

class ParticleSystem {
  constructor() {
    this.parts = [];
    this.rings = [];
    this.texts = [];
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.flashA = 0;
    this.flashColor = '#ffffff';
  }

  // Explosion aus farbigen Kreisen
  burst(x, y, color, { count = 18, speed = 260, size = 5, life = 0.7, gravity = 0, glow = false } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.parts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: size * (0.5 + Math.random()),
        life, t: 0, color, gravity, glow,
      });
    }
  }

  // gerichteter, additiv leuchtender Funke (Warp-Burst / Capture / Crash)
  spark(x, y, dx, dy, speed, color, { spread = 0.3, size = 3, life = 0.5 } = {}) {
    const base = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * spread;
    const sp = speed * (0.7 + Math.random() * 0.5);
    this.parts.push({
      x, y, vx: Math.cos(base) * sp, vy: Math.sin(base) * sp,
      r: size * (0.6 + Math.random() * 0.7), life, t: 0, color, gravity: 0, glow: true, add: true,
    });
  }

  // expandierender Ring (Shockwave)
  ring(x, y, color, { radius = 90, width = 5, life = 0.45 } = {}) {
    this.rings.push({ x, y, color, radius, width, life, t: 0 });
  }

  // aufsteigender Score-Text
  text(x, y, str, color, { size = 26, life = 0.9, vy = -80 } = {}) {
    this.texts.push({ x, y, str, color, size, life, t: 0, vy });
  }

  shake(amp = 8, dur = 0.25) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  flash(color = '#ffffff', alpha = 0.25) {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, alpha);
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.35, dt);
      p.vy *= Math.pow(0.55, dt);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.life) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      t.y += t.vy * dt;
      if (t.t >= t.life) this.texts.splice(i, 1);
    }
    if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) this.shakeAmp = 0; }
    if (this.flashA > 0) this.flashA = Math.max(0, this.flashA - dt * 1.8);
  }

  // Kamera-Offset für Screenshake — vor dem Welt-Rendern anwenden
  applyShake(c) {
    if (this.shakeAmp <= 0) return;
    const decay = this.shakeT > 0 ? this.shakeT : 0;
    const a = this.shakeAmp * Math.min(1, decay * 5);
    c.translate((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a);
  }

  // Welt-Partikel zeichnen. offset = {x,y,scale} für Kamera-Transform (world→screen).
  draw(c, off = null) {
    const T = off
      ? (x, y) => [(x - off.x) * off.scale + off.cx, (y - off.y) * off.scale + off.cy]
      : (x, y) => [x, y];
    const S = off ? off.scale : 1;
    // Partikel — erst normale, dann additive Funken (glow)
    const drawPart = (p) => {
      const k = 1 - p.t / p.life;
      const [sx, sy] = T(p.x, p.y);
      c.globalAlpha = k;
      if (p.glow) { c.shadowColor = p.color; c.shadowBlur = 12; }
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(sx, sy, Math.max(0.5, p.r * k * S), 0, TAU);
      c.fill();
      c.shadowBlur = 0;
    };
    for (const p of this.parts) if (!p.add) drawPart(p);
    c.globalCompositeOperation = 'lighter';
    for (const p of this.parts) if (p.add) drawPart(p);
    c.globalCompositeOperation = 'source-over';
    // Ringe
    for (const r of this.rings) {
      const k = r.t / r.life;
      const [sx, sy] = T(r.x, r.y);
      c.globalAlpha = (1 - k) * 0.9;
      c.strokeStyle = r.color;
      c.lineWidth = (r.width * (1 - k) + 1) * S;
      c.beginPath();
      c.arc(sx, sy, r.radius * easeOutCubic(k) * S, 0, TAU);
      c.stroke();
    }
    // Texte
    for (const t of this.texts) {
      const k = t.t / t.life;
      const [sx, sy] = T(t.x, t.y);
      c.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
      c.font = `800 ${t.size * (1 + easeOutBack(Math.min(1, k * 3)) * 0.15)}px Nunito, system-ui, sans-serif`;
      c.textAlign = 'center';
      c.lineWidth = 4;
      c.strokeStyle = 'rgba(0,0,0,0.4)';
      c.strokeText(t.str, sx, sy);
      c.fillStyle = t.color;
      c.fillText(t.str, sx, sy);
    }
    c.globalAlpha = 1;
  }

  // Fullscreen-Flash — NACH allem anderen zeichnen (Screen-Space)
  drawFlash(c, w, h) {
    if (this.flashA <= 0) return;
    c.globalAlpha = this.flashA;
    c.fillStyle = this.flashColor;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  }
}
