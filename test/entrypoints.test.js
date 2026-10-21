const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { submission, freshDb } = require('./helpers');

const DIR = path.join(__dirname, '../netlify/functions');
const submit = require('../netlify/functions/submit');
const hikeCode = require('../netlify/functions/hike-code');
const feedback = require('../netlify/functions/feedback');
const functionFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));
const load = f => require(path.join(DIR, f));

/** A request as Netlify hands it to a function: web Request plus context.ip. */
async function call(fn, route, body, ip = '198.51.100.20') {
  const req = new Request(`https://opentrailscience.org${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const res = await fn.default(req, { ip });
  return { status: res.status, body: await res.json() };
}

test('every web function has its own path, so none is reachable at /.netlify/functions/<name>', () => {
  assert.equal(submit.config.path, '/api/submit');
  assert.deepEqual(hikeCode.config.path, ['/api/my-hike', '/api/delete']);
  assert.equal(feedback.config.path, '/api/feedback');
  // The other function files are the two scheduled jobs, which have no URL in production.
  const web = functionFiles.filter(f => typeof load(f).default === 'function');
  for (const f of web) assert.ok(load(f).config && load(f).config.path, `${f} has a path`);
  const scheduled = functionFiles.filter(f => !web.includes(f));
  assert.deepEqual(scheduled.sort(), ['feedback-cleanup.js', 'snapshot-nightly.js']);
  for (const f of scheduled) assert.equal(typeof load(f).handler, 'function');
  const toml = fs.readFileSync(path.join(__dirname, '../netlify.toml'), 'utf8');
  assert.ok(!/from = "\/api\//.test(toml), 'no /api redirect to /.netlify/functions');
});

test('two rate limit rules, as many as the free plan allows', () => {
  const rules = functionFiles.map(f => load(f).config && load(f).config.rateLimit).filter(Boolean);
  assert.equal(rules.length, 2);
  assert.deepEqual(submit.config.rateLimit, { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] });
  assert.deepEqual(hikeCode.config.rateLimit, { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] });
  for (const rule of rules) assert.ok(rule.windowSize <= 180, 'Netlify allows windows up to 180 s');
});

test('submit, look up and delete through the web entry points', async () => {
  const db = freshDb();
  const sent = await call(submit, '/api/submit', submission());
  assert.equal(sent.status, 201);
  const code = sent.body.deletionCode;
  assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

  const found = await call(hikeCode, '/api/my-hike', { code });
  assert.equal(found.status, 200);
  assert.equal(found.body.data.trail, 'PCT');

  assert.equal((await call(hikeCode, '/api/delete', { code })).status, 200);
  assert.equal((await call(hikeCode, '/api/my-hike', { code })).status, 404);
  assert.equal(db.collection('surveys').docs.length, 0);
  assert.equal((await call(hikeCode, '/api/other', { code })).status, 404);
});

test('the hourly limit uses the IP from the Netlify context, not a header the client sends', async () => {
  const db = freshDb();
  const send = (contextIp, headerIp) => feedback.default(new Request('https://opentrailscience.org/api/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': headerIp }, body: JSON.stringify({ message: 'hi' })
  }), { ip: contextIp });
  assert.equal((await send('198.51.100.30', '203.0.113.1')).status, 201);
  assert.equal((await send('198.51.100.30', '203.0.113.2')).status, 201);
  const counters = () => db.collection('submission_throttle').docs;
  assert.equal(counters().length, 1, 'a different header from the same client is the same network');
  assert.equal(counters()[0].count, 2);
  assert.equal((await send('198.51.100.31', '203.0.113.1')).status, 201);
  assert.equal(counters().length, 2, 'another context IP is another network');
  assert.ok(counters().every(d => !d.key.includes('198.51.100.3') && !d.key.includes('203.0.113.')), 'stored hashed');
});

test('a wrong method is answered by the handler, not swallowed', async () => {
  freshDb();
  const res = await submit.default(new Request('https://opentrailscience.org/api/submit'), { ip: '198.51.100.40' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST');
});

test('the web adapter passes bodies byte for byte and keeps the size limit', async () => {
  const { webHandler } = require('../netlify/functions/utils/http');
  const echo = webHandler(async event => ({ statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: event.body }));
  const text = JSON.stringify({ message: 'Crème brûlée at the hut 🥾 – ¡genial!' });
  const res = await echo(new Request('https://opentrailscience.org/x', { method: 'POST', body: text }), {});
  assert.equal(await res.text(), text);

  freshDb();
  const big = await submit.default(new Request('https://opentrailscience.org/api/submit', { method: 'POST', body: 'x'.repeat(25 * 1024) }), { ip: '198.51.100.50' });
  assert.equal(big.status, 413);
  const broken = await submit.default(new Request('https://opentrailscience.org/api/submit', { method: 'POST', body: '{"trail":' }), { ip: '198.51.100.51' });
  assert.equal(broken.status, 400);
  assert.equal(broken.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(broken.headers.get('Content-Type'), /^application\/json/);
});

test('feedback with accents and emoji arrives unchanged through the entry point', async () => {
  const db = freshDb();
  const message = 'Naïve question: what counts as a nero? 🥾 Ümlaut, ñ and – dashes';
  const res = await call(feedback, '/api/feedback', { message });
  assert.equal(res.status, 201);
  assert.equal(db.collection('feedback').docs[0].message, message);
});
