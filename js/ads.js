// ads.js — plattform-erkennender Ad-Adapter für CrazyGames + Yandex + GameMonetize.
// Der Core ruft nur diese Hooks. Auf itch/Newgrounds/eigenem Host = No-Op (0 externe Requests).
// SDKs werden NUR auf der jeweiligen Portal-Domain dynamisch nachgeladen.
'use strict';

const Ads = (() => {
  let sdk = 'none';        // 'none' | 'crazygames' | 'yandex' | 'gamemonetize' | 'mock'
  let cg = null;           // window.CrazyGames.SDK
  let ysdk = null;         // Yandex SDK
  let ready = false;
  let lastInterstitial = 0; // Yandex verlangt >= 60s zwischen Fullscreen-Ads
  let loadDone = false;     // loadingStop schon gesendet?
  let loadStopPending = false; // loadingStop angefragt, bevor SDK bereit war

  const host = (location.hostname || '').toLowerCase();
  const ref = (document.referrer || '').toLowerCase();
  let ancestors = '';
  try { ancestors = location.ancestorOrigins ? Array.from(location.ancestorOrigins).join(' ').toLowerCase() : ''; } catch (e) {}
  const embedded = host + ' ' + ref + ' ' + ancestors; // deckt iframe-Hosting ab (Spiel läuft in Portal-iframe)
  const mock = location.search.includes('mockads'); // nur zum Testen des Ad-Flows
  const detectYandex = /yandex|games\.s3|\.ya\./.test(embedded) || location.search.includes('yandex');
  const detectCrazy = /crazygames|1001juegos/.test(embedded) || !!window.CrazyGames || location.search.includes('crazygames');
  // GameMonetize: nur aktiv, wenn deren SDK-Loader auf der Seite ist (window.SDK_OPTIONS) —
  // damit bleibt itch/CrazyGames/Pages-Build unberührt (0 externe Requests).
  const detectGM = !!window.SDK_OPTIONS || /gamemonetize/.test(embedded);

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });

  async function initYandex() {
    try {
      await loadScript('https://yandex.ru/games/sdk/v2');
      ysdk = await window.YaGames.init();
      sdk = 'yandex';
      try { ysdk.features.LoadingAPI?.ready(); } catch (e) {}
      ready = true;
    } catch (e) { sdk = 'none'; }
  }

  async function initCrazy() {
    try {
      if (!window.CrazyGames) await loadScript('https://sdk.crazygames.com/crazygames-sdk-v3.js');
      cg = window.CrazyGames.SDK;
      await cg.init();
      sdk = 'crazygames';
      ready = true;
      try { cg.game.loadingStart(); } catch (e) {}
      if (loadStopPending) { try { cg.game.loadingStop(); loadDone = true; } catch (e) {} }
    } catch (e) { sdk = 'none'; }
  }

  // GameMonetize: das SDK (api.gamemonetize.com/sdk.js) wird per Script-Tag im index.html
  // dieser Build-Variante geladen und setzt window.sdk. Wir nutzen nur window.sdk.showBanner().
  function initGM() {
    sdk = 'gamemonetize';
    ready = true;
  }

  return {
    get platform() { return sdk; },

    async init() {
      if (mock) { sdk = 'mock'; ready = true; return; }
      if (detectYandex) return initYandex();
      if (detectCrazy) return initCrazy();
      if (detectGM) return initGM();
      // itch/Newgrounds/self-host: nichts laden
    },

    // Signalisiert dem Portal-SDK, dass das Spiel fertig geladen & spielbar ist
    // (CrazyGames misst darüber die Load-Time; ohne Stop läuft der Timer ewig).
    loadingStop() {
      if (loadDone) return;
      try {
        if (sdk === 'crazygames' && cg) { cg.game.loadingStop(); loadDone = true; }
        else if (sdk === 'yandex' && ysdk) { ysdk.features.LoadingAPI?.ready(); loadDone = true; }
        else loadStopPending = true; // SDK noch nicht bereit → beim init nachholen
      } catch (e) {}
    },

    // Gameplay-Signale (CrazyGames-Pflicht für Full Launch, Yandex empfohlen)
    gameplayStart() {
      try {
        if (sdk === 'crazygames') cg.game.gameplayStart();
        else if (sdk === 'yandex') ysdk.features.GameplayAPI?.start();
      } catch (e) {}
    },
    gameplayStop() {
      try {
        if (sdk === 'crazygames') cg.game.gameplayStop();
        else if (sdk === 'yandex') ysdk.features.GameplayAPI?.stop();
      } catch (e) {}
    },

    // Interstitial nach Game Over — resolved immer (blockiert Restart nie länger als nötig)
    interstitial() {
      return new Promise((resolve) => {
        try {
          if (sdk === 'crazygames') {
            cg.ad.requestAd('midgame', {
              adFinished: () => resolve(true),
              adError: () => resolve(true),
            });
            return;
          }
          if (sdk === 'yandex') {
            const now = Date.now();
            if (now - lastInterstitial < 61000) return resolve(true); // Yandex-Frequency-Cap
            lastInterstitial = now;
            ysdk.adv.showFullscreenAdv({ callbacks: {
              onClose: () => resolve(true),
              onError: () => resolve(true),
            }});
            return;
          }
          if (sdk === 'gamemonetize') {
            if (window.sdk && typeof window.sdk.showBanner === 'function') window.sdk.showBanner();
            return setTimeout(() => resolve(true), 300);
          }
        } catch (e) {}
        resolve(true);
      });
    },

    // Rewarded Ad — nur anbieten, wenn ein Portal-SDK aktiv ist
    get rewardedAvailable() { return sdk === 'crazygames' || sdk === 'yandex' || sdk === 'mock'; },
    rewarded() {
      return new Promise((resolve) => {
        if (sdk === 'mock') return setTimeout(() => resolve(true), 300);
        try {
          if (sdk === 'crazygames') {
            cg.ad.requestAd('rewarded', {
              adFinished: () => resolve(true),
              adError: () => resolve(false),
              rewardGranted: () => {},
            });
            return;
          }
          if (sdk === 'yandex') {
            let rewarded = false;
            ysdk.adv.showRewardedVideo({ callbacks: {
              onRewarded: () => { rewarded = true; },
              onClose: () => resolve(rewarded),
              onError: () => resolve(false),
            }});
            return;
          }
        } catch (e) {}
        resolve(false);
      });
    },

    // Happy-Moment (Level geschafft) — Yandex mag sowas als Trigger
    happyMoment() {
      try { if (sdk === 'yandex') ysdk.features.GameplayAPI?.stop(); } catch (e) {}
    },
  };
})();
