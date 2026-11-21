const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildBrowserBundle, BROWSER_SCRIPTS, BUNDLE, APP_ENTRY } = require('../scripts/build-js');

const PUBLIC_DIR = path.join(__dirname, '../public');
// Loaded on its own in <head>, before anything is drawn: sets the light/dark theme.
const EARLY_SCRIPT = 'theme.js';

test('the bundle includes every browser script', () => {
  const sources = ['.', 'lib']
    .flatMap(dir => fs.readdirSync(path.join(PUBLIC_DIR, dir)).filter(f => f.endsWith('.js')).map(f => path.posix.join(dir, f)))
    .map(f => f.replace(/^\.\//, ''))
    .filter(f => f !== EARLY_SCRIPT);
  assert.deepEqual(sources.sort(), BROWSER_SCRIPTS.slice().sort());
});

test('the app is ES modules in src/app, reached from main.js, with nothing left in public/app.js', async () => {
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'app.js')), false, 'the app now lives in src/app');
  const esbuild = require('esbuild');
  const result = await esbuild.build({ entryPoints: [APP_ENTRY], bundle: true, write: false, metafile: true, format: 'iife' });
  const bundled = Object.keys(result.metafile.inputs).map(f => path.basename(f)).sort();
  const files = fs.readdirSync(path.dirname(APP_ENTRY)).filter(f => f.endsWith('.js')).sort();
  assert.deepEqual(bundled, files, 'every module in src/app is used');
});

test('the page loads the theme script in <head>, then only the deferred bundle', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]).filter(tag => !tag.includes('application/ld+json'));
  assert.deepEqual(scripts, [`<script src="/${EARLY_SCRIPT}">`, `<script src="/${BUNDLE}" defer>`]);
  assert.ok(html.indexOf(EARLY_SCRIPT) < html.indexOf('</head>'));
  assert.ok(fs.statSync(path.join(PUBLIC_DIR, EARLY_SCRIPT)).size < 1500, 'keep the blocking script tiny');
});

test('the minified bundle is valid JavaScript and smaller than its sources', async () => {
  const minified = await buildBrowserBundle();
  const plain = await buildBrowserBundle({ minify: false });
  assert.doesNotThrow(() => new vm.Script(minified));
  assert.ok(minified.length < plain.length * 0.7, `${minified.length} vs ${plain.length}`);
});
