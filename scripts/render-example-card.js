/**
 * Renders src/example-share-card.html with headless Firefox and writes
 * public/img/example-share-card.webp (560 px wide, twice the size it is shown
 * at). Needs firefox and ImageMagick (`magick`). Run: npm run render:example-card
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/img/example-share-card.webp');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/__wait') return setTimeout(() => res.end(), 1500);
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// The server must keep answering while Firefox runs, so nothing here blocks.
server.listen(0, '127.0.0.1', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ots-card-'));
  const png = path.join(tmp, 'card.png');
  try {
    await execFile('firefox', ['--headless', '--profile', tmp, '--window-size=1080,1350', '--screenshot', png,
      `http://127.0.0.1:${server.address().port}/src/example-share-card.html`], { timeout: 60000 });
    await execFile('magick', [png, '-resize', '560x', '-quality', '82', OUT]);
    console.log(`Wrote ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes)`);
  } catch (err) {
    console.error('Rendering failed:', err.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    server.close();
  }
});
