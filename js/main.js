// main.js — Bootstrap, Game-States, Loop, Input-Routing (Tap = loslassen)
'use strict';

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let dpr = 1, cw = 0, ch = 0;

  // Bloom-Offscreens (halbe/viertel Auflösung → billiger Blur via Down-/Upscale)
  const bloomA = document.createElement('canvas'), bcA = bloomA.getContext('2d');
  const bloomB = document.createElement('canvas'), bcB = bloomB.getContext('2d');
  const BLOOM = 0.44; // Stärke des additiven Glows
  function applyBloom() {
    const aw = bloomA.width, ah = bloomA.height;
    if (aw < 2 || ah < 2) return;
    bcA.clearRect(0, 0, aw, ah);
    bcA.drawImage(canvas, 0, 0, aw, ah);
    bcB.clearRect(0, 0, bloomB.width, bloomB.height);
    bcB.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);
    bcA.drawImage(bloomB, 0, 0, aw, ah); // weichgezeichnet zurück
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = BLOOM;
    ctx.drawImage(bloomA, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  let state = 'menu';   // menu | levelselect | play | paused | end
  let mode = 'endless'; // endless | level | duel
  let boards = [];
  let attract = null;   // Demo-Board hinterm Menü
  let levelIdx = 0;
  let lastT = performance.now();
  let endHandled = false;
  let revivedThisRun = false;
  let apCool = 0;       // Attract-Autopilot-Cooldown

  // --- Persistenz -----------------------------------------------------------
  const store = {
    get best() { return +(Store.get('ol_best') || 0); },
    set best(v) { Store.set('ol_best', v); },
    get stars() { try { return JSON.parse(Store.get('ol_stars')) || []; } catch { return []; } },
    setStar(i, s) { const a = this.stars; a[i] = Math.max(a[i] || 0, s); Store.set('ol_stars', JSON.stringify(a)); },
  };
  if (Store.get('ol_muted') === '1') AudioEngine.toggleMute();

  // --- Canvas ---------------------------------------------------------------
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = window.innerWidth; ch = window.innerHeight;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    bloomA.width = Math.max(2, canvas.width >> 1); bloomA.height = Math.max(2, canvas.height >> 1);
    bloomB.width = Math.max(2, canvas.width >> 2); bloomB.height = Math.max(2, canvas.height >> 2);
  }
  window.addEventListener('resize', resize);
  resize();

  function viewports() {
    if (mode === 'duel' && boards.length === 2) {
      if (cw >= ch) return [{ x: 0, y: 0, w: cw / 2 - 2, h: ch }, { x: cw / 2 + 2, y: 0, w: cw / 2 - 2, h: ch }];
      return [{ x: 0, y: 0, w: cw, h: ch / 2 - 2 }, { x: 0, y: ch / 2 + 2, w: cw, h: ch / 2 - 2 }];
    }
    return [{ x: 0, y: 0, w: cw, h: ch }];
  }

  // --- Modi -----------------------------------------------------------------
  function startEndless() {
    mode = 'endless';
    boards = [new Board('endless', ENDLESS)];
    enterPlay();
  }
  function startLevel(i) {
    mode = 'level'; levelIdx = i;
    boards = [new Board('level', LEVELS[i])];
    enterPlay();
  }
  function startDuel() {
    mode = 'duel';
    const matchSeed = (Math.random() * 1e9) | 0;
    const cfg = { ...DUEL, seed: matchSeed };
    const b1 = new Board('duel', cfg), b2 = new Board('duel', cfg);
    b1.onPassed = () => { b2.pressure++; b2.fx.text(b2.orb.x, b2.orb.y - 40, '⚠ ' + t('pressure'), '#ff9d3d', { size: 22 }); };
    b2.onPassed = () => { b1.pressure++; b1.fx.text(b1.orb.x, b1.orb.y - 40, '⚠ ' + t('pressure'), '#ff9d3d', { size: 22 }); };
    boards = [b1, b2];
    UI.duelHint(true);
    setTimeout(() => UI.duelHint(false), 5000);
    enterPlay();
  }
  function enterPlay() {
    state = 'play';
    endHandled = false;
    revivedThisRun = false;
    attract = null;
    AudioEngine.sfxEnabled = true;
    Ads.gameplayStart();
    UI.hideAll();
    UI.hud(true);
    if (mode !== 'duel' && !Store.get('ol_seen')) {
      UI.tutorial(true);
      setTimeout(() => UI.tutorial(false), 7000);
    }
  }
  function toMenu() {
    state = 'menu'; mode = 'endless';
    boards = [];
    Ads.gameplayStop();
    UI.hud(false);
    UI.show('menu');
    UI.duelHint(false);
    UI.setMenuBest(store.best);
  }
  function retry() {
    if (mode === 'level') startLevel(levelIdx);
    else if (mode === 'duel') startDuel();
    else startEndless();
  }
  function nextLevel() {
    if (levelIdx < LEVELS.length - 1) startLevel(levelIdx + 1);
    else toMenu();
  }
  function pauseGame() {
    if (state !== 'play') return;
    state = 'paused';
    UI.show('pause');
  }
  function resumeGame() {
    if (state !== 'paused') return;
    state = 'play';
    UI.hideAll();
    lastT = performance.now();
  }
  function reviveGame() {
    if (revivedThisRun || !boards[0]) return;
    revivedThisRun = true;
    Ads.rewarded().then((rewarded) => {
      if (!rewarded) return;
      UI.hideAll();
      UI.hud(true);
      endHandled = false;
      state = 'play';
      Ads.gameplayStart();
      boards[0].revive();
      lastT = performance.now();
    });
  }

  UI.init({
    startEndless, startLevel, startDuel, retry, nextLevel, toMenu,
    pause: pauseGame, resume: resumeGame, revive: reviveGame,
    getStars: () => store.stars,
    langChanged: () => UI.setMenuBest(store.best),
  });
  UI.setMenuBest(store.best);

  // --- Ende-Erkennung ---------------------------------------------------------
  function checkEnd() {
    if (endHandled) return;
    if (mode === 'duel') {
      const crashed = boards.findIndex(b => b.phase === 'done');
      if (crashed >= 0) {
        endHandled = true;
        Ads.gameplayStop();
        const winner = crashed === 0 ? 1 : 0;
        AudioEngine.play('highscore');
        setTimeout(() => {
          state = 'end';
          UI.showEnd({
            title: t(winner === 0 ? 'p1wins' : 'p2wins'),
            score: boards[winner].score, best: Math.max(boards[0].score, boards[1].score),
            isNewBest: false, stars: null, mode: 'duel', hasNext: false,
          });
        }, 400);
      }
      return;
    }
    const b = boards[0];
    if (!b) return;
    if (b.phase === 'done') {
      endHandled = true;
      Ads.gameplayStop();
      let isNewBest = false;
      if (mode === 'endless' && b.score > store.best) { store.best = b.score; isNewBest = true; }
      if (isNewBest) AudioEngine.play('highscore');
      state = 'end';
      const canRevive = mode === 'endless' && !revivedThisRun && Ads.rewardedAvailable;
      Ads.interstitial().finally(() => {
        UI.showEnd({
          title: mode === 'level' ? t('levelFail') : t('gameover'),
          score: b.score, best: mode === 'endless' ? store.best : b.score,
          isNewBest, stars: null, mode, hasNext: false, showRevive: canRevive,
        });
      });
    } else if (b.phase === 'won') {
      endHandled = true;
      Ads.gameplayStop();
      Ads.happyMoment();
      AudioEngine.play('win');
      const stars = b.rating();
      store.setStar(levelIdx, stars);
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          b.fx.burst(b.orb.x + rand(-120, 120), b.orb.y + rand(-100, 100), pick(['#3fd4ff', '#ff5ea8', '#ffcf47', '#7c6bff', '#4dffa6']), { count: 22, speed: 300, size: 5, life: 1.1, glow: true });
        }, i * 180);
      }
      setTimeout(() => {
        state = 'end';
        UI.showEnd({
          title: t('levelDone'),
          score: b.score, best: b.score, isNewBest: false,
          stars, mode, hasNext: levelIdx < LEVELS.length - 1,
        });
      }, 1100);
    }
  }

  // --- Input ------------------------------------------------------------------
  canvas.addEventListener('pointerdown', (e) => {
    AudioEngine.unlock();
    if (state !== 'play') return;
    if (!Store.get('ol_seen')) { Store.set('ol_seen', '1'); UI.tutorial(false); }
    if (mode === 'duel' && boards.length === 2) {
      const leftHalf = cw >= ch ? e.clientX < cw / 2 : e.clientY < ch / 2;
      boards[leftHalf ? 0 : 1].release();
    } else if (boards[0]) {
      boards[0].release();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (state === 'play') pauseGame(); else if (state === 'paused') resumeGame();
      return;
    }
    if (state !== 'play') return;
    if (mode === 'duel') {
      if (e.code === 'Space' || e.code === 'KeyW') { boards[0]?.release(); e.preventDefault(); }
      if (e.code === 'Enter' || e.code === 'ArrowUp') { boards[1]?.release(); e.preventDefault(); }
    } else if (['Space', 'KeyW', 'Enter', 'ArrowUp'].includes(e.code)) {
      boards[0]?.release(); e.preventDefault();
    }
  });

  // Attract-Autopilot: lässt den Demo-Orb grob Richtung nächstem Planeten los
  function autopilot(b, dt) {
    apCool -= dt;
    if (b.phase !== 'play' || b.state !== 'orbit' || apCool > 0) return;
    const next = b.planets.find(p => p.idx === b.cur.idx + 1);
    if (!next) return;
    const ax = -Math.sin(b.theta) * b.dir, ay = Math.cos(b.theta) * b.dir;
    let dx = next.x - b.orb.x, dy = next.y - b.orb.y;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (ax * dx + ay * dy > 0.985) { b.release(); apCool = 0.25; }
  }

  // --- Loop ---------------------------------------------------------------------
  let loadSignaled = false;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!loadSignaled) { loadSignaled = true; Ads.loadingStop(); }
    const rdt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0b0620';
    ctx.fillRect(0, 0, cw, ch);

    if (state === 'menu' || state === 'levelselect') {
      if (!attract || attract.phase === 'done') { attract = new Board('endless', ENDLESS); apCool = 0.5; }
      AudioEngine.sfxEnabled = false;
      autopilot(attract, rdt);
      attract.update(rdt);
      attract.render(ctx, { x: 0, y: 0, w: cw, h: ch });
      // dunkler Schleier, damit das Menü lesbar bleibt
      ctx.fillStyle = 'rgba(9,5,20,0.45)';
      ctx.fillRect(0, 0, cw, ch);
    } else if (boards.length) {
      if (state === 'play') { for (const b of boards) b.update(rdt); checkEnd(); }
      else if (state === 'end') { for (const b of boards) b.update(rdt); }
      const vps = viewports();
      for (let i = 0; i < boards.length; i++) boards[i].render(ctx, vps[i]);
      if (mode === 'duel' && boards.length === 2) {
        ctx.fillStyle = '#05070f';
        if (cw >= ch) ctx.fillRect(cw / 2 - 3, 0, 6, ch);
        else ctx.fillRect(0, ch / 2 - 3, cw, 6);
      }
      if (state === 'play' || state === 'end') {
        if (mode === 'duel') UI.hudUpdate({ duel: [fmtScore(boards[0].score), fmtScore(boards[1].score)] });
        else if (mode === 'level') UI.hudUpdate({ score: `${boards[0].passed}/${boards[0].cfg.goal}`, sub: `${t('level')} ${levelIdx + 1} · ${fmtScore(boards[0].score)}` });
        else UI.hudUpdate({ score: fmtScore(boards[0].score), sub: `${t('best')} ${fmtScore(store.best)}` });
      }
    }
    ctx.restore();
    applyBloom();
  }

  Ads.init();
  requestAnimationFrame(frame);

  // Test-Hook (nur mit ?debug)
  if (location.search.includes('debug')) {
    window.__game = {
      get state() { return state; },
      get mode() { return mode; },
      get boards() { return boards; },
      get attract() { return attract; },
      startEndless, startLevel, startDuel, toMenu,
    };
  }
})();
