const test = require('node:test');
const assert = require('node:assert/strict');
const { PUBLIC_COLUMNS } = require('../public/lib/survey-schema');
const { generateSyntheticHikers } = require('../scripts/lib/synthetic-hikers');
const { useDatabase } = require('../netlify/functions/utils/db');
const submit = require('../netlify/functions/submit');
const { fetchPublicRecords, buildSnapshot, publicOrder, PREVIEW_FIELDS } = require('../netlify/functions/utils/dataset');
const { THROTTLE_MAX } = require('../netlify/functions/utils/spam');
const deleteFn = require('../netlify/functions/delete');
const { hashCode } = require('../netlify/functions/utils/deletion');
const { freshDb, submission, get, post } = require('./helpers');

const surveys = db => db.collection('surveys').docs;

test.beforeEach(() => {
  delete process.env.INCLUDE_SYNTHETIC;
});

test('submit stores a valid survey and returns the stored record', async () => {
  const db = freshDb();
  const res = await post(submit, submission());
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.success, true);
  assert.equal(body.data.averageDailyMiles, 16.8);
  assert.equal(body.data._id, undefined, 'MongoDB id is not leaked');
  assert.equal(surveys(db).length, 1);
  assert.equal(surveys(db)[0].formElapsedSeconds, undefined, 'anti-spam fields are not stored');
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined, 'submit is same-origin only');
});

test('submit rejects invalid data with field errors', async () => {
  const db = freshDb();
  const res = await post(submit, submission({ age: 200 }));
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.match(body.errors[0], /Age at the start of the hike must be between/);
  assert.ok(body.fieldErrors.age);
  assert.equal(surveys(db).length, 0);
});

test('submit rejects malformed JSON and wrong methods', async () => {
  freshDb();
  assert.equal((await post(submit, '{nope')).statusCode, 400);
  assert.equal((await post(submit, '[1,2]')).statusCode, 400);
  assert.equal((await get(submit)).statusCode, 405);
});

test('honeypot and too-fast submissions are silently dropped', async () => {
  const db = freshDb();
  for (const body of [submission({ website_url: 'http://spam' }), submission({ formElapsedSeconds: 3 }), submission({ formElapsedSeconds: undefined })]) {
    const res = await post(submit, body);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).success, true);
  }
  assert.equal(surveys(db).length, 0);
});

test('submissions are throttled per client', async () => {
  const db = freshDb();
  for (let i = 0; i < THROTTLE_MAX; i++) {
    assert.equal((await post(submit, submission())).statusCode, 201);
  }
  assert.equal((await post(submit, submission())).statusCode, 429);
  // Another client is unaffected.
  assert.equal((await post(submit, submission(), { 'x-nf-client-connection-ip': '198.51.100.1' })).statusCode, 201);
  assert.equal(surveys(db).length, THROTTLE_MAX + 1);
  assert.ok(db.collection('submission_throttle').docs.every(d => !d.key.includes('203.0.113.7')), 'IPs are hashed');
});

test('submit returns 503 when the database is down', async () => {
  useDatabase({ collection() { throw new Error('down'); } });
  const res = await post(submit, submission());
  assert.equal(res.statusCode, 503);
});

async function seededDb() {
  const db = freshDb();
  await db.collection('surveys').insertMany(generateSyntheticHikers(20, { seed: 7 }));
  for (let i = 0; i < 12; i++) {
    const res = await post(submit, submission({ trail: i % 2 ? 'AT' : 'PCT' }), { 'x-nf-client-connection-ip': `10.0.0.${i}` });
    assert.equal(res.statusCode, 201);
  }
  return db;
}

test('submit returns a peer comparison once enough hikers have shared', async () => {
  await seededDb(); // 12 real submissions (6 PCT, 6 AT) plus synthetic ones, which are ignored
  const res = await post(submit, submission({ baseWeightLbs: 9.5, maxHeavyLoadLbs: 20 }), { 'x-nf-client-connection-ip': '10.0.1.1' });
  const body = JSON.parse(res.body);
  assert.equal(body.comparison.group, 'hikers in the dataset', 'only 6 PCT peers, so all 12 are used');
  assert.equal(body.comparison.peerCount, 12, 'synthetic records and the new record are excluded');
  assert.equal(body.comparison.items[0].text, 'Your base weight was lighter than 100% of hikers in the dataset.');
});

test('submit has no comparison while the dataset is small', async () => {
  freshDb();
  const body = JSON.parse((await post(submit, submission())).body);
  assert.equal(body.success, true);
  assert.equal(body.comparison, null);
});

const snapshot = async () => buildSnapshot(await fetchPublicRecords(), new Date('2026-10-15T03:00:00Z'));

test('the preview snapshot has the table columns of public records only', async () => {
  await seededDb();
  const preview = JSON.parse((await snapshot())['preview.json']);
  assert.equal(preview.total, 12, 'synthetic records are excluded');
  assert.equal(preview.generatedAt, '2026-10-15T03:00:00.000Z');
  preview.data.forEach(row => assert.deepEqual(Object.keys(row), PREVIEW_FIELDS));
});

test('the snapshot has compact JSON and precomputed Insights charts', async () => {
  await seededDb();
  const files = await snapshot();
  assert.ok(!files['thru_hiker_survey_dataset.json'].includes('\n  '), 'dataset JSON is not pretty-printed');
  const insights = JSON.parse(files['insights.json']);
  assert.equal(insights.total, 12);
  assert.equal(insights.generatedAt, '2026-10-15T03:00:00.000Z');
  assert.deepEqual(Object.keys(insights.charts), ['baseWeightByOutcome', 'finishRateByTrail', 'commonInjuries', 'injuryRateByFirstWeek']);
  for (const rows of Object.values(insights.charts)) {
    for (const row of rows) {
      assert.equal(typeof row.label, 'string');
      assert.equal(typeof row.value, 'number');
      assert.ok(row.of || row.n >= 5, `small group in ${row.label}`);
    }
  }
});

test('INCLUDE_SYNTHETIC=true shows synthetic records (offline dev)', async () => {
  await seededDb();
  process.env.INCLUDE_SYNTHETIC = 'true';
  assert.equal(JSON.parse((await snapshot())['preview.json']).total, 32);
});

test('the stats snapshot aggregates public records only', async () => {
  await seededDb();
  const stats = JSON.parse((await snapshot())['stats.json']);
  assert.equal(stats.totalCount, 12);
  assert.deepEqual(stats.trails, { PCT: 6, AT: 6 });
  assert.equal(stats.avgDailyMiles, 16.8);
  assert.equal(stats.completionRate, 100);
  assert.equal(stats.breakdowns.cookSystem.stove_cooked, 100);
  assert.equal(stats.breakdowns.cookSystem.hybrid, 0);
  assert.equal(stats.lastUpdated, '2026-10-15T03:00:00.000Z');
});

test('the snapshot contains every file the site and researchers read', async () => {
  await seededDb();
  const files = await snapshot();
  assert.deepEqual(Object.keys(files).sort(),
    ['insights.json', 'preview.json', 'schema.json', 'stats.json', 'thru_hiker_survey_dataset.csv', 'thru_hiker_survey_dataset.json']);
  assert.equal(JSON.parse(files['thru_hiker_survey_dataset.json']).length, 12);
  assert.equal(files['thru_hiker_survey_dataset.csv'].trim().split('\r\n').length, 13);
});

test('public files never reveal submission order', () => {
  // Inserted newest-last; published by trail, year and start month instead.
  const records = [
    { trail: 'AT', hikeYear: 2024, startMonth: '2024-03', id: 'first' },
    { trail: 'PCT', hikeYear: 2023, startMonth: '2023-05', id: 'second' },
    { trail: 'PCT', hikeYear: 2025, startMonth: '2025-04', id: 'newest' }
  ];
  assert.deepEqual(publicOrder(records).map(r => r.id), ['newest', 'second', 'first']);
  // Ties are shuffled, so the newest of identical-looking hikes isn't last.
  const twins = Array.from({ length: 50 }, (_, i) => ({ trail: 'PCT', hikeYear: 2025, startMonth: '2025-04', id: i }));
  assert.notDeepEqual(publicOrder(twins).map(r => r.id), twins.map(r => r.id));
});

test('page views need no function: the old live endpoints are gone', () => {
  const fs = require('fs');
  const path = require('path');
  assert.equal(fs.existsSync(path.join(__dirname, '../netlify/functions/data.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../netlify/functions/stats.js')), false);
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf-8');
  assert.doesNotMatch(app, /\/api\/(data|stats|export)/, 'the browser only reads /data/* files');
});

test('submit returns a deletion code and stores only its hash', async () => {
  const db = freshDb();
  const body = JSON.parse((await post(submit, submission())).body);
  assert.match(body.deletionCode, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  const codes = db.collection('deletion_codes').docs;
  assert.equal(codes.length, 1);
  assert.equal(codes[0].codeHash, hashCode(body.deletionCode));
  assert.doesNotMatch(JSON.stringify(codes) + JSON.stringify(surveys(db)), new RegExp(body.deletionCode), 'plain code is never stored');
  assert.equal(codes[0].surveyId, surveys(db)[0]._id);
});

test('a deletion code deletes exactly its own record', async () => {
  const db = freshDb();
  const first = JSON.parse((await post(submit, submission())).body);
  await post(submit, submission({ trail: 'AT' }), { 'x-nf-client-connection-ip': '10.9.9.9' });
  assert.equal(surveys(db).length, 2);

  // Codes are case- and dash-insensitive.
  const res = await post(deleteFn, { code: first.deletionCode.toLowerCase().replace(/-/g, ' ') });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(surveys(db).map(d => d.trail), ['AT']);
  assert.equal(db.collection('deletion_codes').docs.length, 1);

  // A used code no longer works.
  assert.equal((await post(deleteFn, { code: first.deletionCode })).statusCode, 404);
});

test('unknown or malformed deletion codes are rejected', async () => {
  freshDb();
  assert.equal((await post(deleteFn, { code: 'AAAA-BBBB-CCCC-DDDD' })).statusCode, 404);
  assert.equal((await post(deleteFn, { code: 'nope' })).statusCode, 404);
  assert.equal((await post(deleteFn, {})).statusCode, 404);
  assert.equal((await post(deleteFn, '{bad')).statusCode, 400);
  assert.equal((await get(deleteFn)).statusCode, 405);
});

test('deletion attempts are throttled separately from submissions', async () => {
  freshDb();
  for (let i = 0; i < THROTTLE_MAX; i++) {
    assert.equal((await post(deleteFn, { code: 'AAAA-BBBB-CCCC-DDDD' })).statusCode, 404);
  }
  assert.equal((await post(deleteFn, { code: 'AAAA-BBBB-CCCC-DDDD' })).statusCode, 429);
  assert.equal((await post(submit, submission())).statusCode, 201, 'submitting still works');
});

test('the stored record is exactly the public record', async () => {
  const db = freshDb();
  await post(submit, submission({ homeRegion: 'western_europe' }));
  const stored = Object.assign({}, surveys(db)[0]);
  delete stored._id;
  const published = JSON.parse((await snapshot())['thru_hiker_survey_dataset.json'])[0];
  assert.deepEqual(stored, published);
  assert.equal('startDate' in stored || 'age' in stored || 'submittedAt' in stored, false);
});

test('a stored survey and its deletion code carry no time: random ids, no date field', async () => {
  const db = freshDb();
  const res = await post(submit, submission());
  assert.equal(res.statusCode, 201, res.body);
  const [survey] = db.collection('surveys').docs;
  const [code] = db.collection('deletion_codes').docs;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(survey._id, uuid, 'not an ObjectId, which would contain the submission time');
  assert.match(code._id, uuid);
  assert.deepEqual(Object.keys(code).sort(), ['_id', 'codeHash', 'surveyId']);
  assert.equal(code.surveyId, survey._id);
});
