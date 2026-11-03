const test = require('node:test');
const assert = require('node:assert/strict');
const suggestion = require('../netlify/functions/utils/trail-suggestion');
const submit = require('../netlify/functions/utils/submit');
const { fetchPublicRecords, buildSnapshot } = require('../netlify/functions/utils/dataset');
const { THROTTLE_MAX } = require('../netlify/functions/utils/spam');
const { SCHEMA_VERSION } = require('../public/lib/survey-schema');
const { freshDb, submission, get, post } = require('./helpers');

const stored = db => db.collection('trail_suggestions').docs;

test('a trail suggestion is stored on its own: random id, no timestamp, no link to a hike', async () => {
  const db = freshDb();
  await post(submit, submission());
  const res = await post(suggestion, { trail: '  Lycian Way,\n  Turkey ' });
  assert.equal(res.statusCode, 201, res.body);
  const [doc] = stored(db);
  assert.deepEqual(Object.keys(doc).sort(), ['_id', 'schemaVersion', 'trail']);
  assert.match(doc._id, /^[0-9a-f-]{36}$/);
  assert.equal(doc.trail, 'Lycian Way, Turkey', 'one line, trimmed');
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.ok(!JSON.stringify(doc).includes(String(db.collection('surveys').docs[0]._id)));
});

test('trail suggestions never reach the public files or the rebuild counter', async () => {
  const db = freshDb();
  await post(suggestion, { trail: 'secret-trail-name' });
  for (const content of Object.values(buildSnapshot(await fetchPublicRecords()))) assert.ok(!content.includes('secret-trail-name'));
  assert.equal(db.collection('snapshot_state').docs.length, 0);
});

test('empty, too long or non-text suggestions are rejected; the bot trap stores nothing', async () => {
  const db = freshDb();
  for (const trail of ['', '   ', 42, null, 'x'.repeat(suggestion.MAX_TRAIL_CHARS + 1)]) {
    assert.equal((await post(suggestion, { trail })).statusCode, 400, String(trail).slice(0, 20));
  }
  assert.equal((await post(suggestion, 'not json')).statusCode, 400);
  assert.equal((await get(suggestion)).statusCode, 405);
  assert.equal((await post(suggestion, { trail: 'Spam Trail', website_url: 'http://spam.example' })).statusCode, 201, 'looks fine to the bot');
  assert.equal(stored(db).length, 0);
});

test('suggestions are limited per network and hour, and in total until reviewed', async () => {
  const db = freshDb();
  for (let i = 0; i < THROTTLE_MAX; i++) assert.equal((await post(suggestion, { trail: `Trail ${i}` })).statusCode, 201);
  assert.equal((await post(suggestion, { trail: 'one too many' })).statusCode, 429);
  assert.equal(stored(db).length, THROTTLE_MAX);

  const full = freshDb();
  for (let i = 0; i < suggestion.MAX_STORED; i++) full.collection('trail_suggestions').docs.push({ _id: `id-${i}`, trail: `T${i}` });
  assert.equal((await post(suggestion, { trail: 'Lycian Way' })).statusCode, 429);
  assert.equal(stored(full).length, suggestion.MAX_STORED);
});

test('the yearly cleanup deletes the trail suggestions too, and leaves the survey answers alone', async () => {
  const cleanup = require('../netlify/functions/feedback-cleanup');
  const db = freshDb();
  await post(submit, submission());
  await post(suggestion, { trail: 'Lycian Way' });
  const res = await cleanup.handler();
  assert.equal(res.statusCode, 200);
  assert.equal(stored(db).length, 0);
  assert.equal(db.collection('surveys').docs.length, 1);
});
