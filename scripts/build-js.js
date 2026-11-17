/**
 * Builds public/js/app.bundle.js (`npm run build:js`, part of `npm run build`).
 * The page loads this one deferred file; the dev server builds it on every
 * request, so edits to the source files show up on reload.
 *
 * Two parts, in this order:
 *   1. BROWSER_SCRIPTS: plain scripts shared with the server or used as globals
 *      (window.SurveySchema, window.SurveyStats, ...), joined in dependency order.
 *   2. The app itself: ES modules in src/app/, bundled by esbuild from
 *      src/app/main.js into one function scope.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const PUBLIC_DIR = path.join(__dirname, '../public');
const BROWSER_SCRIPTS = [
  'lib/survey-schema.js',
  'lib/survey-stats.js',
  'lib/human-check.js',
  'share-card.js',
  'insights.js'
];
const APP_ENTRY = path.join(__dirname, '../src/app/main.js');
const APP_DIR = path.dirname(APP_ENTRY);
const BUNDLE = 'js/app.bundle.js';

/** The app's source files (src/app/*.js), e.g. for tests that read the code. */
function appSources() {
  return fs.readdirSync(APP_DIR).filter(f => f.endsWith('.js')).sort()
    .map(f => fs.readFileSync(path.join(APP_DIR, f), 'utf8')).join('\n');
}

/** Returns the bundle as a string; minify: false keeps it readable for development. */
async function buildBrowserBundle({ minify = true } = {}) {
  const libraries = BROWSER_SCRIPTS
    .map(file => `// ${file}\n${fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8')}`)
    .join(';\n');
  const app = await esbuild.build({
    entryPoints: [APP_ENTRY], bundle: true, format: 'iife', target: 'es2022', write: false, legalComments: 'none'
  });
  const source = `${libraries};\n// src/app (bundled)\n${app.outputFiles[0].text}`;
  if (!minify) return source;
  const { code } = await esbuild.transform(source, { minify: true, target: 'es2022', legalComments: 'none' });
  return code;
}

if (require.main === module) {
  buildBrowserBundle().then(code => {
    const out = path.join(PUBLIC_DIR, BUNDLE);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, code);
    console.log(`Wrote public/${BUNDLE} (${code.length} bytes)`);
  }).catch(err => {
    console.error('JavaScript build failed:', err.message);
    process.exit(1);
  });
}

module.exports = { buildBrowserBundle, appSources, BROWSER_SCRIPTS, APP_ENTRY, BUNDLE };
