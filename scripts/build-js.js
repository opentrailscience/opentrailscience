/**
 * Joins the browser scripts into public/js/app.bundle.js and minifies it
 * (`npm run build:js`, part of `npm run build`). The page loads this one
 * deferred file; the dev server builds it on every request, so edits to the
 * source files show up on reload.
 *
 * The files are plain scripts that share globals (window.SurveySchema, ...),
 * so they are concatenated in dependency order, not bundled as modules.
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
  'insights.js',
  'app.js'
];
const BUNDLE = 'js/app.bundle.js';

/** Returns the bundle as a string; minify: false keeps it readable for development. */
async function buildBrowserBundle({ minify = true } = {}) {
  const source = BROWSER_SCRIPTS
    .map(file => `// ${file}\n${fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8')}`)
    .join(';\n');
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

module.exports = { buildBrowserBundle, BROWSER_SCRIPTS, BUNDLE };
