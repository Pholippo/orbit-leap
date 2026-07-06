// ui.js — DOM-Overlays: Menü, Missionsauswahl, HUD, Game-Over/Win/Duell-Screens
'use strict';

const UI = (() => {
  const $ = (id) => document.getElementById(id);
  let cb = {}; // Callbacks von main.js

  function init(callbacks) {
    cb = callbacks;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="hud" class="hidden">
      <div id="hudLeft">
        <div id="hudScore">0</div>
        <div id="hudSub"></div>
      </div>
      <div id="hudRight">
        <button id="btnPause" class="iconBtn" aria-label="Pause">II</button>
        <button id="btnMute" class="iconBtn" aria-label="Sound">🔊</button>
      </div>
      <div id="hudDuel" class="hidden"><span id="duelS1">0</span><span class="duelVs">VS</span><span id="duelS2">0</span></div>
    </div>

    <div id="menu" class="screen">
      <div class="menuCard">
        <h1 class="logo">ORBIT<span>LEAP</span></h1>
        <div class="tagline" data-i18n="subtitle"></div>
        <div id="menuBest" class="menuBest hidden"></div>
        <button class="bigBtn primary" id="mEndless"><span class="btnIco">🚀</span><span class="btnCol"><span class="btnTitle" data-i18n="endless"></span><span class="btnSub" data-i18n="endlessSub"></span></span></button>
        <button class="bigBtn" id="mLevels"><span class="btnIco">🪐</span><span class="btnCol"><span class="btnTitle" data-i18n="levels"></span><span class="btnSub" data-i18n="levelsSub"></span></span></button>
        <button class="bigBtn" id="mDuel"><span class="btnIco">⚔️</span><span class="btnCol"><span class="btnTitle" data-i18n="duel"></span><span class="btnSub" data-i18n="duelSub"></span></span></button>
        <div class="howBox">
          <div class="howTitle" data-i18n="howTitle"></div>
          <div class="howLine">👆 <span data-i18n="how1"></span></div>
          <div class="howLine">🪐 <span data-i18n="how2"></span></div>
          <div class="howLine">⭐ <span data-i18n="how3"></span></div>
        </div>
        <div class="menuFoot">
          <button id="mLang" class="miniBtn"></button>
          <button id="mMute" class="miniBtn">🔊</button>
        </div>
      </div>
    </div>

    <div id="levelselect" class="screen hidden">
      <div class="menuCard wide">
        <h2 class="screenTitle" data-i18n="levels"></h2>
        <div id="levelGrid"></div>
        <button class="bigBtn" id="lsBack" data-i18n="menu"></button>
      </div>
    </div>

    <div id="gameover" class="screen hidden">
      <div class="menuCard">
        <h2 class="screenTitle crashTitle" id="goTitle"></h2>
        <div id="goNewBest" class="newBest hidden" data-i18n="newBest"></div>
        <div class="scoreRow"><div class="scoreBig" id="goScore">0</div></div>
        <div class="scoreRow small"><span data-i18n="best"></span>&nbsp;<span id="goBest">0</span></div>
        <div id="goStars" class="stars hidden"></div>
        <button class="bigBtn revive hidden" id="goRevive"><span class="btnIco">▶️</span><span class="btnCol"><span class="btnTitle" data-i18n="revive"></span><span class="btnSub" data-i18n="reviveSub"></span></span></button>
        <button class="bigBtn primary" id="goRetry" data-i18n="retry"></button>
        <button class="bigBtn" id="goNext" data-i18n="next"></button>
        <button class="bigBtn" id="goMenu" data-i18n="menu"></button>
      </div>
    </div>

    <div id="pause" class="screen hidden">
      <div class="menuCard">
        <h2 class="screenTitle" data-i18n="paused"></h2>
        <button class="bigBtn primary" id="pResume" data-i18n="resume"></button>
        <button class="bigBtn" id="pMenu" data-i18n="menu"></button>
      </div>
    </div>

    <div id="duelHint" class="hidden"></div>
    <div id="tutBanner" class="hidden"><span class="tutHand">👆</span><span id="tutText"></span></div>
    `);

    // Events
    $('mEndless').onclick = () => { AudioEngine.unlock(); cb.startEndless(); };
    $('mLevels').onclick = () => { AudioEngine.unlock(); showLevelSelect(); };
    $('mDuel').onclick = () => { AudioEngine.unlock(); cb.startDuel(); };
    $('lsBack').onclick = () => show('menu');
    $('goRetry').onclick = () => cb.retry();
    $('goNext').onclick = () => cb.nextLevel();
    $('goMenu').onclick = () => cb.toMenu();
    $('goRevive').onclick = () => cb.revive();
    $('pResume').onclick = () => cb.resume();
    $('pMenu').onclick = () => cb.toMenu();
    $('btnPause').onclick = () => cb.pause();
    const muteBtns = [$('btnMute'), $('mMute')];
    for (const b of muteBtns) b.onclick = () => {
      const m = AudioEngine.toggleMute();
      Store.set('ol_muted', m ? '1' : '0');
      muteBtns.forEach(x => x.textContent = m ? '🔇' : '🔊');
    };
    $('mLang').onclick = () => { I18N.cycle(); refreshTexts(); cb.langChanged && cb.langChanged(); };

    refreshTexts();
  }

  function refreshTexts() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $('mLang').textContent = '🌐 ' + I18N.lang.toUpperCase();
  }

  function show(name) {
    for (const s of ['menu', 'levelselect', 'gameover', 'pause']) {
      $(s).classList.toggle('hidden', s !== name);
    }
    if (name) $(name)?.classList.remove('hidden');
  }
  function hideAll() { show('__none__'); }

  function showLevelSelect() {
    const grid = $('levelGrid');
    const stars = cb.getStars();
    grid.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const unlocked = i === 0 || stars[i - 1] > 0;
      const b = document.createElement('button');
      b.className = 'lvBtn' + (unlocked ? '' : ' locked');
      b.innerHTML = `<div class="lvNum">${i + 1}</div><div class="lvStars">${'★'.repeat(stars[i] || 0)}${'☆'.repeat(unlocked ? 3 - (stars[i] || 0) : 0)}</div>${unlocked ? '' : '<div class="lvLock">🔒</div>'}`;
      if (unlocked) b.onclick = () => cb.startLevel(i);
      grid.appendChild(b);
    });
    show('levelselect');
  }

  // HUD
  function hud(visible) { $('hud').classList.toggle('hidden', !visible); }
  function hudUpdate({ score, sub, duel }) {
    if (duel) {
      $('hudDuel').classList.remove('hidden');
      $('hudLeft').classList.add('hidden');
      $('duelS1').textContent = duel[0];
      $('duelS2').textContent = duel[1];
    } else {
      $('hudDuel').classList.add('hidden');
      $('hudLeft').classList.remove('hidden');
      $('hudScore').textContent = score;
      $('hudSub').textContent = sub || '';
    }
  }

  function duelHint(on) {
    const el = $('duelHint');
    el.textContent = t('duelHint');
    el.classList.toggle('hidden', !on);
  }

  // Game-Over / Win-Screen
  function showEnd({ title, score, best, isNewBest, stars, mode, hasNext, showRevive }) {
    $('goTitle').textContent = title;
    $('goScore').textContent = fmtScore(score);
    $('goBest').textContent = fmtScore(best);
    $('goNewBest').classList.toggle('hidden', !isNewBest);
    const st = $('goStars');
    if (stars != null) {
      st.classList.remove('hidden');
      st.innerHTML = [1, 2, 3].map(n => `<span class="${n <= stars ? 'starOn' : 'starOff'}">★</span>`).join('');
    } else st.classList.add('hidden');
    $('goNext').classList.toggle('hidden', !hasNext);
    $('goRevive').classList.toggle('hidden', !showRevive);
    $('goRetry').classList.remove('hidden');
    document.querySelector('#gameover .scoreRow.small').classList.toggle('hidden', mode === 'duel' || mode === 'level');
    $('goTitle').classList.toggle('winTitle', title === t('levelDone'));
    show('gameover');
  }

  function setMenuBest(best) {
    const el = $('menuBest');
    el.classList.toggle('hidden', !best);
    if (best) el.textContent = `🏆 ${t('best')} ${fmtScore(best)}`;
  }

  function tutorial(on) {
    const el = $('tutBanner');
    if (on) $('tutText').textContent = t('how1');
    el.classList.toggle('hidden', !on);
  }

  return { init, show, hideAll, hud, hudUpdate, showEnd, showLevelSelect, refreshTexts, duelHint, tutorial, setMenuBest };
})();
