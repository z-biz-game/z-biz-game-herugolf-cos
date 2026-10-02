// 零依赖静态服务器。故意用 CommonJS：package.json 是 "type": "module"，
// 于是 `node --check` 按 ES 模块解析浏览器侧那些文件，而这一份仍然能被 tools/verify.sh require。
//
// 它**同时回答两种 URL 形态**：Pages 把我们挂在 /z-biz-game-herugolf-cos/ 下，本机跑是根 /。
// 一个服务器答两种，闸的"前缀形态"才是真的第二种形态，而不是为测试另起一个服务器。
//
// 端口 5340：本仓在 z-biz-game 端口表里独占的那一号（5341 是同一对里留白的第二号，目前没有东西在用）。
// 为什么要写死一个专属号：别的车道此刻正在跑各自的 verify.sh，端口撞了就会拿到"另一个仓"的
// index.html —— 那种绿比红更糟（所以 tools/verify.sh 还有一道 preflight 逐字核对字节是谁家的）。
const http = require('http');
const fs = require('fs');
const path = require('path');

const PREFIX = '/z-biz-game-herugolf-cos';
const PORT = 5340;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function resolveFile(root, urlPath) {
  let p = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  if (p === PREFIX || p.startsWith(PREFIX + path.sep)) p = p.slice(PREFIX.length) || '/';
  if (p === '' || p === '/' || p === path.sep) p = '/index.html';
  const file = path.join(root, p);
  return file.startsWith(root) ? file : null;
}

function createServer(root = __dirname) {
  return http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    const file = resolveFile(root, urlPath);
    if (!file) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
}

function startServer({ port = PORT, root = __dirname } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(root);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { createServer, startServer, resolveFile, PREFIX, PORT };

if (require.main === module) {
  const port = Number(process.argv[2]) || Number(process.env.PORT) || PORT;
  startServer({ port })
    .then((server) => {
      console.log(`ヘルゴルフ Herugolf served at http://127.0.0.1:${port}/  and  http://127.0.0.1:${port}${PREFIX}/  (ctrl+c to stop)`);
      process.on('SIGINT', () => server.close(() => process.exit(0)));
    })
    .catch((err) => {
      console.error('failed to start:', err.message);
      process.exit(1);
    });
}
