/* ============================================================
   方块枪神 2D · Service Worker（离线可玩）
   - install 预缓存全部本地资源
   - fetch：页面导航=网络优先+缓存回退；静态资源=缓存优先+网络回退
   ============================================================ */
'use strict';

/* Release process: bump this version (+1) whenever web assets change,
   otherwise installed PWAs keep serving the old cache-first files. */
var CACHE_NAME = 'bg2d-v5';
var PRECACHE = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/data.js',
  './js/levels100.js',
  './js/net.js',
  './js/game.js',
  './js/ui.js',
  './js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE.map(function (url) {
        return new Request(url, { cache: 'reload' });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE_NAME ? null : caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 只接管同源页面资源，不碰 WebSocket / 穿透中继 / 第三方请求
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/ws' || url.pathname.indexOf('/ws/') === 0) return;

  // 页面导航：网络优先，离线回退到缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put('./index.html', copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  // 静态资源：缓存优先（离线可用），同时后台静默更新缓存，避免旧 JS 常驻
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
      if (hit) {
        try { event.waitUntil(network.catch(function () { /* offline: keep cache */ })); } catch (e) { /* ignore */ }
        return hit;
      }
      return network.catch(function (err) {
        if (req.destination === 'document') return caches.match('./index.html');
        throw err;
      });
    })
  );
});