/**
 * Local development server: serves public/ and runs the Netlify functions,
 * mirroring the redirects in netlify.toml. No dependencies beyond Node.
 *
 *   npm run dev              # uses MONGODB_URI from .env, or offline mode without it
 *   npm run dev -- --offline # in-memory database with synthetic hikers
 *   npm run dev -- --host    # also reachable from other devices on your network
 *
 * Without --host it only listens on 127.0.0.1. Only use --host on a network
 * you trust: this server is for development, not hardened like production.
 */
require('dotenv').config({ quiet: true });
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.argv.includes('--host') ? '0.0.0.0' : '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '../public');
const { readHeaderRules, headersFor } = require('./lib/headers-file');
const { buildBrowserBundle, BUNDLE } = require('./build-js');
const HEADER_RULES = readHeaderRules();
const OFFLINE = process.argv.includes('--offline') || !process.env.MONGODB_URI;
// Offline: how many synthetic hikers to start with, e.g. `npm run dev:offline -- --hikers=60`.
const HIKERS_ARG = process.argv.find(arg => arg.startsWith('--hikers='));
const SYNTHETIC_HIKERS = HIKERS_ARG ? parseInt(HIKERS_ARG.split('=')[1], 10) : 65;

if (OFFLINE) {
  const { useDatabase } = require('../netlify/functions/utils/db');
  const { createMemoryDb } = require('./lib/memory-db');
  const { generateSyntheticHikers } = require('./lib/synthetic-hikers');
  const db = createMemoryDb();
  db.collection('surveys').insertMany(generateSyntheticHikers(SYNTHETIC_HIKERS));
  useDatabase(db);
  // Synthetic records are hidden from public endpoints unless this is set.
  process.env.INCLUDE_SYNTHETIC = 'true';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const functions = {
  submit: require('../netlify/functions/submit'),
  delete: require('../netlify/functions/delete'),
  feedback: require('../netlify/functions/feedback'),
  'my-hike': require('../netlify/functions/my-hike')
};

/**
 * Offline mode has no files in public/data, so the snapshot (dataset,
 * preview, stats, schema) is built on request from the in-memory database.
 * That also shows new submissions immediately. With MONGODB_URI, run
 * `npm run export-data` to refresh the files, as the Netlify build does.
 */
async function serveOfflineSnapshot(pathname, res) {
  const { fetchPublicRecords, buildSnapshot } = require('../netlify/functions/utils/dataset');
  const name = pathname.replace(/^\/data\//, '');
  const files = buildSnapshot(await fetchPublicRecords());
  if (!(name in files)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const ext = path.extname(name);
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(files[name]);
}

/** The browser bundle, rebuilt (unminified) on every request so edits show up on reload. */
async function serveBundle(res) {
  try {
    const code = await buildBrowserBundle({ minify: false });
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(code);
  } catch (err) {
    res.writeHead(500);
    res.end(`Bundle failed: ${err.message}`);
  }
}

// Same as the /download/* redirects in netlify.toml.
const DOWNLOAD_ALIASES = {
  '/download/csv': '/data/thru_hiker_survey_dataset.csv',
  '/download/json': '/data/thru_hiker_survey_dataset.json'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function runFunction(name, req, res, url) {
  const fn = functions[name];
  if (!fn) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Function ${name} not found` }));
  }

  try {
    const body = await readBody(req);
    const response = await fn.handler({
      httpMethod: req.method,
      headers: Object.assign({ 'x-nf-client-connection-ip': req.socket.remoteAddress }, req.headers),
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: body || null
    }, {});
    res.writeHead(response.statusCode || 200, response.headers || {});
    res.end(response.body || '');
  } catch (err) {
    console.error(`Function ${name} threw:`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function serveStatic(pathname, res) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    // SPA fallback for client-side routes.
    if (err || !stats.isFile()) filePath = path.join(PUBLIC_DIR, 'index.html');

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Error reading file');
      }
      const ext = path.extname(filePath).toLowerCase();
      const headers = { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
      if (filePath.includes(`${path.sep}data${path.sep}`)) {
        headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
      }
      res.writeHead(200, headers);
      res.end(content);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  for (const [name, value] of Object.entries(headersFor(pathname, HEADER_RULES))) {
    if (name !== 'Strict-Transport-Security') res.setHeader(name, value); // plain http locally
  }
  if (pathname === '/_headers') {
    res.writeHead(404);
    return res.end('Not found');
  }

  const fnMatch = pathname.match(/^\/(?:api|\.netlify\/functions)\/([^/]+)/);
  if (fnMatch) return runFunction(fnMatch[1], req, res, url);

  if (pathname === `/${BUNDLE}`) return serveBundle(res);

  const target = DOWNLOAD_ALIASES[pathname] || pathname;
  if (OFFLINE && target.startsWith('/data/')) return serveOfflineSnapshot(target, res);
  serveStatic(target, res);
});

/** IPv4 addresses of this computer on the local network, for --host. */
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

server.listen(PORT, HOST, () => {
  console.log(`\nOpen Trail Science dev server: http://127.0.0.1:${PORT}`);
  if (HOST === '0.0.0.0') {
    lanAddresses().forEach(ip => console.log(`On your network:               http://${ip}:${PORT}`));
  }
  console.log(OFFLINE
    ? `Database: in-memory with ${SYNTHETIC_HIKERS} synthetic hikers (offline mode; submissions are lost on restart)`
    : `Database: MongoDB (${process.env.MONGODB_DB || 'hikersurvey'})`);
  console.log('API: POST /api/submit, POST /api/delete, POST /api/feedback, POST /api/my-hike. Page data: /data/*.json\n');
});
