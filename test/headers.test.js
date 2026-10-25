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
  // The one exception: Cloudflare Turnstile's script and frame on the last survey step.
  assert.match(csp, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.deepEqual([...new Set(csp.match(/https?:\/\/[^\s;]+/g))], ['https://challenges.cloudflare.com'], 'no other origin');
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

test('the page has a real Turnstile site key, so the bot check works on opentrailscience.org', () => {
  const key = (html.match(/id="turnstile-box"[^>]*data-sitekey="([^"]*)"/) || [])[1];
  assert.match(key || '', /^0x[0-9A-Za-z_-]{16,}$/, 'Cloudflare site keys start with 0x');
  assert.doesNotMatch(key, /^[123]x0{10,}/, 'not one of Cloudflare\'s test keys');
});
