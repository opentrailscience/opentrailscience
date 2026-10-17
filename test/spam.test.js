const test = require('node:test');
const assert = require('node:assert/strict');
const submit = require('../netlify/functions/submit');
const deleteFn = require('../netlify/functions/delete');
const { networkOf, THROTTLE_MAX } = require('../netlify/functions/utils/spam');
const { freshDb, submission, post } = require('./helpers');

test('networks: IPv4 as is, IPv6 as its /64 block', () => {
  assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
  assert.equal(networkOf('2001:db8:abcd:12:1111:2222:3333:4444'), '2001:db8:abcd:12::/64');
  assert.equal(networkOf('2001:db8:abcd:12::1'), '2001:db8:abcd:12::/64');
  assert.equal(networkOf('2001:0DB8:ABCD:0012::ffff'), '2001:db8:abcd:12::/64', 'case and leading zeros');
  assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(networkOf('::1'), '0:0:0:0::/64');
  assert.equal(networkOf('::ffff:198.51.100.4'), '198.51.100.4', 'IPv4-mapped IPv6 is IPv4');
  assert.equal(networkOf('fe80::1%eth0'), 'fe80:0:0:0::/64', 'zone id dropped');
});

test('rotating IPv6 addresses inside one /64 does not escape the throttle', async () => {
  freshDb();
  const codes = [];
  for (let i = 0; i < THROTTLE_MAX + 1; i++) {
    const ip = `2001:db8:abcd:12:${(i + 1).toString(16)}::${(i * 7 + 3).toString(16)}`;
    codes.push((await post(submit, submission(), { 'x-nf-client-connection-ip': ip })).statusCode);
  }
  assert.deepEqual(codes.slice(0, THROTTLE_MAX), Array(THROTTLE_MAX).fill(201));
  assert.equal(codes[THROTTLE_MAX], 429);
  // A different /64 is a different household.
  assert.equal((await post(submit, submission(), { 'x-nf-client-connection-ip': '2001:db8:abcd:13::1' })).statusCode, 201);
});

test('the throttle uses one counter document per network and hour', async () => {
  const db = freshDb();
  for (let i = 0; i < 3; i++) await post(submit, submission());
  const counters = db.collection('submission_throttle').docs;
  assert.equal(counters.length, 1);
  assert.equal(counters[0].count, 3);
  assert.equal(counters[0].createdAt.getUTCMinutes(), 0, 'createdAt is the start of the hour (TTL cleans it up)');
});

test('oversized request bodies are refused before parsing', async () => {
  freshDb();
  const huge = JSON.stringify(Object.assign(submission(), { padding: 'x'.repeat(25 * 1024) }));
  const res = await post(submit, huge);
  assert.equal(res.statusCode, 413);
  assert.equal((await post(deleteFn, JSON.stringify({ code: 'A'.repeat(2000) }))).statusCode, 413);
  const b64 = { httpMethod: 'POST', isBase64Encoded: true, headers: {}, body: Buffer.from(JSON.stringify(submission())).toString('base64') };
  assert.equal((await submit.handler(b64)).statusCode, 201, 'base64-encoded bodies are decoded');
});

test('a survey is never kept without its deletion code', async () => {
  const db = freshDb();
  const codes = db.collection('deletion_codes');
  codes.insertOne = async () => { throw new Error('write failed'); };
  const res = await post(submit, submission());
  assert.equal(res.statusCode, 503);
  assert.equal(db.collection('surveys').docs.length, 0, 'the half-saved survey was removed');
});

test('a page from before a new survey version is asked to reload, not silently dropped', async () => {
  const db = freshDb();
  const { SCHEMA_VERSION } = require('../public/lib/survey-schema');
  const outdated = await post(submit, submission({ schemaVersion: '0.9.0' }));
  assert.equal(outdated.statusCode, 409);
  assert.match(JSON.parse(outdated.body).errors[0], /reload the page/);
  assert.equal(db.collection('surveys').docs.length, 0);
  const current = await post(submit, submission({ schemaVersion: SCHEMA_VERSION }), { 'x-nf-client-connection-ip': '198.51.100.9' });
  assert.equal(current.statusCode, 201, current.body);
});
