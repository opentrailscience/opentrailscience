const test = require('node:test');
const assert = require('node:assert/strict');
const submit = require('../netlify/functions/utils/submit');
const deleteFn = require('../netlify/functions/utils/delete');
const nightly = require('../netlify/functions/snapshot-nightly');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { notePublicChange, rebuildIfPending, REBUILD_AFTER_CHANGES, MIN_HOURS_BETWEEN_REBUILDS, STATE_ID } = require('../netlify/functions/utils/rebuild');
const { exportStaticData } = require('../scripts/export-static-dataset');
const { freshDb, submission, post } = require('./helpers');

const HOUR = 3600 * 1000;
let hookCalls;
let hookOk;
const realFetch = global.fetch;

test.beforeEach(() => {
  hookCalls = [];
  hookOk = true;
  process.env.BUILD_HOOK_URL = 'https://api.netlify.example/build_hooks/test';
  global.fetch = async (url) => {
    hookCalls.push(String(url));
    return { ok: hookOk, status: hookOk ? 200 : 500 };
  };
});
test.afterEach(() => {
  global.fetch = realFetch;
  delete process.env.BUILD_HOOK_URL;
});

const pending = db => (db.collection('snapshot_state').docs.find(d => d._id === STATE_ID) || {}).pending;

/** Runs the build's export step against the test database, into a temp folder. */
async function build(context = 'production') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ots-build-'));
  process.env.MONGODB_URI = 'mongodb://unused-the-test-database-is-in-memory';
  process.env.CONTEXT = context;
  try {
    return await exportStaticData(dir);
  } finally {
    delete process.env.MONGODB_URI;
    delete process.env.CONTEXT;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test(`a rebuild is triggered after ${REBUILD_AFTER_CHANGES} new answers, not before`, async () => {
  const db = freshDb();
  const t0 = new Date('2026-10-15T10:00:00Z');
  for (let i = 1; i < REBUILD_AFTER_CHANGES; i++) await notePublicChange(db, t0);
  assert.equal(hookCalls.length, 0);
  assert.equal(pending(db), REBUILD_AFTER_CHANGES - 1);
  await notePublicChange(db, t0);
  assert.equal(hookCalls.length, 1);
  assert.match(hookCalls[0], /trigger_title=Dataset%20rebuild/);
  assert.equal(pending(db), REBUILD_AFTER_CHANGES, 'only a finished build lowers the count');
  await build();
  assert.equal(pending(db), 0);
});

test('every build counts, so a code deploy also resets the count', async () => {
  const db = freshDb();
  for (let i = 0; i < 3; i++) await notePublicChange(db, new Date());
  await build();
  assert.equal(pending(db), 0);
  await rebuildIfPending(db, new Date());
  assert.equal(hookCalls.length, 0, 'nothing left for the nightly run');
});

test('local builds and deploy previews leave the count alone', async () => {
  const db = freshDb();
  for (let i = 0; i < 3; i++) await notePublicChange(db, new Date());
  await build(''); // local: CONTEXT is not set
  await build('deploy-preview');
  assert.equal(pending(db), 3);
  assert.equal(db.collection('snapshot_state').docs[0].lastBuildAt, undefined);
});

test('changes that arrive while a build runs stay pending', async () => {
  const db = freshDb();
  await notePublicChange(db, new Date());
  const surveys = db.collection('surveys');
  const find = surveys.find.bind(surveys);
  surveys.find = (...args) => {
    notePublicChange(db, new Date()); // a submission during the build
    return find(...args);
  };
  await build();
  assert.equal(pending(db), 1);
});

test('a build that was triggered but failed is retried by the nightly run', async () => {
  const db = freshDb();
  const t0 = new Date('2026-10-15T10:00:00Z');
  for (let i = 0; i < REBUILD_AFTER_CHANGES; i++) await notePublicChange(db, t0);
  assert.equal(hookCalls.length, 1);
  // The build fails, so build() never runs and the changes stay pending.
  await rebuildIfPending(db, new Date(t0.getTime() + 0.5 * HOUR));
  assert.equal(hookCalls.length, 1, 'not while the build may still be running');
  await rebuildIfPending(db, new Date(t0.getTime() + 2 * HOUR));
  assert.equal(hookCalls.length, 2, 'retried by the nightly run');
});

test(`rebuilds are at most every ${MIN_HOURS_BETWEEN_REBUILDS} hours, however many answers arrive`, async () => {
  const db = freshDb();
  const t0 = new Date('2026-10-15T10:00:00Z');
  for (let i = 0; i < REBUILD_AFTER_CHANGES; i++) await notePublicChange(db, t0);
  assert.equal(hookCalls.length, 1);
  await build();
  const soon = new Date(t0.getTime() + 2 * HOUR);
  for (let i = 0; i < 50; i++) await notePublicChange(db, soon);
  assert.equal(hookCalls.length, 1, 'a launch-day rush still costs one build per window');
  await notePublicChange(db, new Date(t0.getTime() + MIN_HOURS_BETWEEN_REBUILDS * HOUR));
  assert.equal(hookCalls.length, 2);
});

test('the nightly run rebuilds only if something changed', async () => {
  const db = freshDb();
  await nightly.handler();
  assert.equal(hookCalls.length, 0, 'nothing pending: no build');
  await notePublicChange(db, new Date());
  await nightly.handler();
  assert.equal(hookCalls.length, 1, 'one pending answer: nightly catch-up');
  await build();
  await nightly.handler();
  assert.equal(hookCalls.length, 1, 'already rebuilt');
});

test('a failed build hook keeps the changes for the next attempt', async () => {
  const db = freshDb();
  hookOk = false;
  for (let i = 0; i < REBUILD_AFTER_CHANGES; i++) await notePublicChange(db, new Date());
  assert.equal(hookCalls.length, 1);
  assert.equal(pending(db), REBUILD_AFTER_CHANGES, 'changes kept');
  hookOk = true;
  await notePublicChange(db, new Date());
  assert.equal(hookCalls.length, 2, 'retried with the next change');
});

test('without a build hook (local dev) changes are only counted', async () => {
  delete process.env.BUILD_HOOK_URL;
  const db = freshDb();
  for (let i = 0; i < 10; i++) await notePublicChange(db, new Date());
  assert.equal(hookCalls.length, 0);
  assert.equal(pending(db), 10);
});

test('submissions and deletions both count as changes', async () => {
  const db = freshDb();
  const body = JSON.parse((await post(submit, submission())).body);
  assert.equal(pending(db), 1);
  await post(deleteFn, { code: body.deletionCode });
  assert.equal(pending(db), 2, 'a deleted hike should leave the download files soon too');
});

test('peer comparisons read the database at most every 10 minutes', async () => {
  const db = freshDb();
  const surveys = db.collection('surveys');
  let reads = 0;
  const find = surveys.find.bind(surveys);
  surveys.find = (...args) => { reads++; return find(...args); };
  for (let i = 0; i < 5; i++) {
    await post(submit, submission(), { 'x-nf-client-connection-ip': `10.1.0.${i}` });
  }
  assert.equal(reads, 1, '5 submissions, 1 read');
});
