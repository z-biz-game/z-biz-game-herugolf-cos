// ヘルゴルフ service worker —— **网络优先，失败退缓存**。
//
// 为什么不是 cache-first：手工 VERSION 号 + cache-first 会把 js/css 永久钉死在旧版，
// 出新 HTML 配旧 JS 的鬼状态就是这么来的（派工简报 §2 点名的那个坑）。这一份对**同源子资源**
// 一律先走网络，命中网络才落 cache；只有离线（fetch 抛错）时才退回缓存副本。
// 缓存名带版本号（HERUGOLF_V1），版本换在 main 改这一行即可；旧 cache 在 activate 里清掉。
//
// file:// 下不注册：注册逻辑在 js/main.js 里按 protocol 跳过，这一份压根不会被装上去。
const CACHE = 'herugolf-v1';
const CORE = [
  './',
  'index.html',
  'css/app.css',
  'js/bundle/herugolf.js',
  'manifest.webmanifest',
  'web/icons/icon-192.png',
  'web/icons/icon-512.png',
  'web/icons/apple-touch-icon-180.png',
  'web/img/paper-256.png',
  'web/img/ball-96.png',
  'web/img/hole-96.png',
  'web/img/pond-128.png',
  'web/img/particles-128.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 单个文件拿不到不许把整个安装卡死（这一版页面可能还没那张 og 图）
    await Promise.all(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨源不接管：不替别人缓存，也不假装能离线
  e.respondWith(
    (async () => {
      try {
        const net = await fetch(req);
        if (net && net.ok && (req.cache !== 'no-cache' || url.pathname !== '/')) {
          const cache = await caches.open(CACHE);
          cache.put(req, net.clone());
        }
        return net;
      } catch (err) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
