/**
 * ShinPoW Service Worker (PWA 오프라인 지원)
 * - data/problems.json: Network-First (온라인이면 항상 최신 문제 반영, 오프라인이면 캐시 사용)
 * - 앱 셸 정적 자산: Stale-While-Revalidate (빠른 실행 + 자동 업데이트)
 */

const CACHE_NAME = 'shinpow-shell-v3';
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
  './src/adapters/onchainAdapter.js'
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

  // 문제 피드 JSON은 항상 네트워크 우선 (최신 문제 즉시 반영)
  if (url.pathname.endsWith('/problems.json')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 앱 셸은 Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

