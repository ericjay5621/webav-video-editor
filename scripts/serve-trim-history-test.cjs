// NODE_OPTIONS=--openssl-legacy-provider node scripts/serve-trim-history-test.cjs
// Builds into a unique temporary directory; does not touch dist or saved drafts.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'webav-trim-history-'));
const config = require('../webpack.config.js')({}, { mode: 'development' });
config.context = root;
const suite = process.argv[2] || 'trim-history-browser.ts';
if (!/^[a-z-]+-browser\.ts$/.test(suite)) throw new Error('Invalid test suite filename');
config.entry = path.join(__dirname, suite);
config.output = { path: output, filename: 'suite.js', publicPath: '/' };
config.plugins = [];
config.devtool = false;
delete config.devServer;
const fixtures = new Set(['webav-audio-test.mp3', 'webav-video-with-audio-test.mp4', 'demo-cover.png']);
webpack(config, (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ all:false, errors:true })); process.exitCode = 1; return; }
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><meta charset="utf-8"><title>${suite}</title><h1>${suite}</h1><p>独立测试，不读写编辑器草稿。</p><button id="run">开始测试</button><pre id="result">READY</pre><div id="canvas" style="width:640px;height:360px"></div><script src="/suite.js"></script>`);
      return;
    }
    const name = pathname.slice('/media/'.length);
    const media = pathname.startsWith('/media/') && fixtures.has(name);
    const file = media ? path.join(root, '.test-media', name) : path.resolve(output, '.' + pathname);
    if ((!media && !file.startsWith(output + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.mp3') ? 'audio/mpeg' : file.endsWith('.mp4') ? 'video/mp4' : 'image/png');
    fs.createReadStream(file).pipe(res);
  });
  server.listen(0, '127.0.0.1', () => console.log(`Trim regression: http://127.0.0.1:${server.address().port}/`));
});
