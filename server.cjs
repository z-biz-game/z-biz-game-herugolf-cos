#!/usr/bin/env node
// 本地静态服务器（端口 5340，README 立项时查实空闲并预留的那两个号之一）。
//
// 为什么要有它：这一版产物虽然是经典脚本（双击 file:// 也能玩），但 service worker 与
// manifest 只在 http(s) 下生效；"可安装"这条判据要能被真人验一次，就得有个起得来的站点。
// 它同时是 tools/verify 那一类浏览器闸的落脚点。
//
// 三条安全边界（静态服务器最容易糊弄过去的就是这三条）：
//   · 路径穿越：URL 段解码后必须仍在 ROOT 内，`..`、绝对路径、符号链接出仓一律 403。
//   · 只读：没有任何写路径、没有 exec、没有模板注入面。
//   · 只监听 127.0.0.1：不把自己变成一台对外的静态站。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5340);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function resolve(reqUrl) {
  const pathname = decodeURIComponent(reqUrl.split('?')[0]);
  let rel = pathname === '/' ? '/index.html' : pathname;
  const abs = path.normalize(path.join(ROOT, rel));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return { denied: true, abs };
  return { abs };
}

const server = http.createServer((req, res) => {
  const { abs, denied } = resolve(req.url || '/');
  if (denied) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 越界了：只服务本仓目录\n');
    return;
  }
  fs.stat(abs, (err, st) => {
    const target = !err && st.isDirectory() ? path.join(abs, 'index.html') : abs;
    fs.readFile(target, (readErr, buf) => {
      if (readErr) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404 没有这个文件：' + path.relative(ROOT, target) + '\n');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': buf.length,
        // 开发服务器上的资源不许被 SW 的旧副本钉住
        'cache-control': ext === '.html' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=0',
      });
      res.end(buf);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`herugolf 静态服务器 http://${HOST}:${PORT}/  根目录=${ROOT}`);
});
