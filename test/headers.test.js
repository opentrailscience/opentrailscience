const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readHeaderRules, headersFor } = require('../scripts/lib/headers-file');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
const rules = readHeaderRules();

test('every page gets a strict Content-Security-Policy and the other security headers', () => {
  const headers = headersFor('/index.html', rules);
  const csp = headers['Content-Security-Policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  for (const name of ['Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security']) assert.ok(headers[name], name);
});

test('fonts are cached as immutable, pages are not', () => {
  assert.match(headersFor('/fonts/any-font-latin-400-normal.woff2', rules)['Cache-Control'], /immutable/);
  assert.equal(headersFor('/index.html', rules)['Cache-Control'], undefined);
});

test('the page has nothing inline that the policy would block', () => {
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, 'inline <script>');
  assert.doesNotMatch(html, /<style[\s>]/, 'inline <style>');
  assert.doesNotMatch(html, /\sstyle="/, 'style attribute');
  assert.doesNotMatch(html, /\son[a-z]+="/, 'inline event handler');
  assert.doesNotMatch(html, /javascript:/);
  for (const [, url] of html.matchAll(/<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"/g)) {
    assert.ok(!/^(https?:)?\/\//.test(url) || /opentrailscience\.org/.test(url), `external resource ${url}`);
  }
});
