const test = require('node:test');
const assert = require('node:assert/strict');
const { checkTurnstile, SITEVERIFY } = require('../netlify/functions/utils/turnstile');
const submit = require('../netlify/functions/utils/submit');
const { submission, freshDb, post } = require('./helpers');

/** A stand-in for Cloudflare's siteverify that records what it was sent. */
function fakeCloudflare(...answers) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, body: Object.fromEntries(options.body) });
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer instanceof Error) throw answer;
    return { status: answer.status || 200, json: async () => answer };
  };
  fn.calls = calls;
  return fn;
}

function withSecret(t, value = 'test-secret') {
  const before = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = value;
  t.after(() => { if (before === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = before; });
}

test('without a secret key the check is skipped (local development, tests)', async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  const cloudflare = fakeCloudflare({ success: false });
  assert.equal(await checkTurnstile('token', '198.51.100.1', cloudflare), 'skipped');
  assert.equal(cloudflare.calls.length, 0);
});

test('a valid token passes; the secret, token and IP go to siteverify', async t => {
  withSecret(t);
  const cloudflare = fakeCloudflare({ success: true });
  assert.equal(await checkTurnstile('token-1', '198.51.100.1', cloudflare), 'ok');
  assert.equal(cloudflare.calls[0].url, SITEVERIFY);
  assert.equal(cloudflare.calls[0].body.secret, 'test-secret');
  assert.equal(cloudflare.calls[0].body.response, 'token-1');
  assert.equal(cloudflare.calls[0].body.remoteip, '198.51.100.1');
  assert.match(cloudflare.calls[0].body.idempotency_key, /^[0-9a-f-]{36}$/);
});

test('no token, a bad token or a used token is refused', async t => {
  withSecret(t);
  assert.equal(await checkTurnstile(undefined, '198.51.100.1', fakeCloudflare({ success: true })), 'missing');
  assert.equal(await checkTurnstile('', '198.51.100.1', fakeCloudflare({ success: true })), 'missing');
  assert.equal(await checkTurnstile('x'.repeat(5000), '198.51.100.1', fakeCloudflare({ success: true })), 'failed');
  assert.equal(await checkTurnstile('t', '198.51.100.1', fakeCloudflare({ success: false, 'error-codes': ['invalid-input-response'] })), 'failed');
  assert.equal(await checkTurnstile('t', '198.51.100.1', fakeCloudflare({ success: false, 'error-codes': ['timeout-or-duplicate'] })), 'failed');
});

test('when Cloudflare is down or slow, it retries once with the same key and then lets the hike through', async t => {
  withSecret(t);
  const flaky = fakeCloudflare(new Error('network down'), { success: true });
  assert.equal(await checkTurnstile('t', '198.51.100.1', flaky), 'ok');
  assert.equal(flaky.calls.length, 2);
  assert.equal(flaky.calls[0].body.idempotency_key, flaky.calls[1].body.idempotency_key);
  assert.equal(await checkTurnstile('t', '198.51.100.1', fakeCloudflare(new Error('down'), new Error('down'))), 'unavailable');
  assert.equal(await checkTurnstile('t', '198.51.100.1', fakeCloudflare({ status: 503 }, { status: 503 })), 'unavailable');
  assert.equal(await checkTurnstile('t', '198.51.100.1', fakeCloudflare({ success: false, 'error-codes': ['internal-error'] }, { success: false, 'error-codes': ['internal-error'] })), 'unavailable');
});

test('a wrong secret key never turns hikers away', async t => {
  withSecret(t);
  assert.equal(await checkTurnstile('t', '198.51.100.1', fakeCloudflare({ success: false, 'error-codes': ['invalid-input-secret'] })), 'unavailable');
});

test('submitting: refused without a valid token, stored with one, the token itself is never stored', async t => {
  withSecret(t);
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  const db = freshDb();

  global.fetch = fakeCloudflare({ success: true });
  const missing = await post(submit, submission(), { 'x-nf-client-connection-ip': '198.51.100.60' });
  assert.equal(missing.statusCode, 400);
  assert.match(JSON.parse(missing.body).errors[0], /bot check is missing/);

  global.fetch = fakeCloudflare({ success: false, 'error-codes': ['invalid-input-response'] });
  const failed = await post(submit, submission({ turnstileToken: 'bad' }), { 'x-nf-client-connection-ip': '198.51.100.61' });
  assert.equal(failed.statusCode, 400);
  assert.match(JSON.parse(failed.body).errors[0], /press Submit again/);
  assert.equal(db.collection('surveys').docs.length, 0);

  global.fetch = fakeCloudflare({ success: true });
  const ok = await post(submit, submission({ turnstileToken: 'good' }), { 'x-nf-client-connection-ip': '198.51.100.62' });
  assert.equal(ok.statusCode, 201);
  assert.equal(db.collection('surveys').docs.length, 1);
  assert.ok(!JSON.stringify(db.collection('surveys').docs[0]).includes('good'), 'no token in the record');
  assert.equal(global.fetch.calls[0].body.remoteip, '198.51.100.62');
});

test('obvious bots are still dropped silently before anyone asks Cloudflare', async t => {
  withSecret(t);
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  freshDb();
  global.fetch = fakeCloudflare({ success: true });
  const bot = await post(submit, submission({ website_url: 'http://spam.example', turnstileToken: 'good' }));
  assert.equal(bot.statusCode, 200);
  assert.equal(global.fetch.calls.length, 0);
});
