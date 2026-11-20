/**
 * ShinPoW Service Worker (PWA 오프라인 지원 · Network-First)
 * - 온라인: 항상 최신 배포 버전(index.html, app.js, problems.json 등)을 즉시 반영
 * - 오프라인: 캐시된 앱 셸과 문제 데이터로 끊김 없이 동작
 */

const CACHE_NAME = 'shinpow-shell-v6';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './assets/icon.svg',
  './src/app.js',
  './src/core/crypto.js',
  './src/core/chain.js',
  './src/modules/math/defaultProblems.js',
  './src/modules/math/mathModule.js',
  './src/modules/activity/activityModule.js',
  './src/adapters/storageAdapter.js',
  './src/adapters/feedAdapter.js',
  './src/adapters/onchainAdapter.js',
  './src/adapters/opentimestampsAdapter.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-First: 온라인이면 항상 최신 배포본 즉시 표시, 오프라인이면 캐시 폴백
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
