// Сервис-воркер Fianchetto: приложение работает без интернета.
// Код, стили и данные берутся из сети (чтобы обновления приходили сразу),
// а при отсутствии сети — из памяти устройства. Картинки и движок — из памяти.
const VERSION = 'fianchetto-v3';
const PRECACHE = ["./","index.html","manifest.webmanifest","css/style.css","js/analysis-view.js","js/analysis.js","js/app.js","js/board.js","js/botplay.js","js/bots.js","js/config.js","js/engine.js","js/i18n.js","js/icons.js","js/learn.js","js/lessons-data.js","js/opening-vars.js","js/train-gen.js","js/train-worker.js","js/training.js","js/ui.js","js/locales/de.js","js/locales/en.js","js/locales/es.js","js/locales/fr.js","js/locales/pt.js","js/locales/ru.js","js/locales/tr.js","js/locales/uk.js","lib/chess.js","pieces/bB.svg","pieces/bK.svg","pieces/bN.svg","pieces/bP.svg","pieces/bQ.svg","pieces/bR.svg","pieces/wB.svg","pieces/wK.svg","pieces/wN.svg","pieces/wP.svg","pieces/wQ.svg","pieces/wR.svg","icons/apple-touch-icon.png","icons/favicon-32.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","data/puzzles.json","engine/stockfish-19-lite-single.js","engine/stockfish-19-lite-single.wasm"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const STATIC = /\.(svg|png|jpg|jpeg|webp|wasm|ico)$/i;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Метрика и прочее — мимо
  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetchAndStore(req)));
    return;
  }
  e.respondWith(fetchAndStore(req).catch(async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return caches.match('index.html');
    return Response.error();
  }));
});

async function fetchAndStore(req) {
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy));
  }
  return res;
}
