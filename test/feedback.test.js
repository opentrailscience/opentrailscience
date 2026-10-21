const test = require('node:test');
const assert = require('node:assert/strict');
const feedback = require('../netlify/functions/utils/feedback');
const submit = require('../netlify/functions/utils/submit');
const { fetchPublicRecords, buildSnapshot } = require('../netlify/functions/utils/dataset');
const { THROTTLE_MAX } = require('../netlify/functions/utils/spam');
const { SCHEMA_VERSION } = require('../public/lib/survey-schema');
const { freshDb, submission, get, post } = require('./helpers');

const stored = db => db.collection('feedback').docs;

test('feedback is stored on its own: random id, no timestamp, no link to a hike', async () => {
  const db = freshDb();
  await post(submit, submission());
  const res = await post(feedback, { message: '  The nero day question confused me.\n\nOtherwise great!  ' });
  assert.equal(res.statusCode, 201, res.body);
  const [doc] = stored(db);
  assert.deepEqual(Object.keys(doc).sort(), ['_id', 'message', 'schemaVersion']);
  assert.match(doc._id, /^[0-9a-f-]{36}$/);
  assert.equal(doc.message, 'The nero day question confused me.\n\nOtherwise great!');
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  const survey = db.collection('surveys').docs[0];
  assert.ok(!JSON.stringify(doc).includes(String(survey._id)));
});

test('feedback never reaches the public files or the rebuild counter', async () => {
  const db = freshDb();
  await post(feedback, { message: 'secret-feedback-text' });
  const files = buildSnapshot(await fetchPublicRecords());
  for (const content of Object.values(files)) assert.ok(!content.includes('secret-feedback-text'));
  assert.equal(db.collection('snapshot_state').docs.length, 0);
});

test('empty, too long or non-text feedback is rejected', async () => {
  const db = freshDb();
  for (const message of ['', '   ', 42, null, 'x'.repeat(feedback.MAX_MESSAGE_CHARS + 1)]) {
    assert.equal((await post(feedback, { message })).statusCode, 400, String(message).slice(0, 20));
  }
  assert.equal((await post(feedback, 'not json')).statusCode, 400);
  assert.equal((await post(feedback, { message: 'x'.repeat(20000) })).statusCode, 413);
  assert.equal((await get(feedback)).statusCode, 405);
  assert.equal(stored(db).length, 0);
});

test('feedback is limited per network and hour', async () => {
  const db = freshDb();
  for (let i = 0; i < THROTTLE_MAX; i++) assert.equal((await post(feedback, { message: `note ${i}` })).statusCode, 201);
  assert.equal((await post(feedback, { message: 'one too many' })).statusCode, 429);
  assert.equal(stored(db).length, THROTTLE_MAX);
});

test('the yearly cleanup deletes all feedback and leaves the survey answers alone', async () => {
  const cleanup = require('../netlify/functions/feedback-cleanup');
  const db = freshDb();
  await post(submit, submission());
  await post(feedback, { message: 'first' });
  await post(feedback, { message: 'second' }, { 'x-nf-client-connection-ip': '198.51.100.9' });
  const res = await cleanup.handler();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'deleted 2');
  assert.equal(stored(db).length, 0);
  assert.equal(db.collection('surveys').docs.length, 1);
});
