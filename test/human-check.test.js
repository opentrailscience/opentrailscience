const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const HumanCheck = require('../public/lib/human-check');
const submit = require('../netlify/functions/utils/submit');
const { passesHumanCheck } = require('../netlify/functions/utils/spam');
const { freshDb, submission, solvePow, post } = require('./helpers');

test('every trail check has three pieces of gear and one item to leave at home', () => {
  assert.ok(HumanCheck.TRAIL_CHECKS.length >= 5);
  const ids = new Set();
  HumanCheck.TRAIL_CHECKS.forEach(round => {
    assert.ok(!ids.has(round.id), round.id);
    ids.add(round.id);
    assert.equal(round.gear.length, 3, round.id);
    assert.ok(!round.gear.includes(round.odd), round.id);
  });
  const round = HumanCheck.TRAIL_CHECKS[1];
  assert.equal(HumanCheck.isCorrectTrailCheck({ id: round.id, choice: round.odd }), true);
  assert.equal(HumanCheck.isCorrectTrailCheck({ id: round.id, choice: round.gear[0] }), false);
  assert.equal(HumanCheck.isCorrectTrailCheck({ id: 'nope', choice: round.odd }), false);
  assert.equal(HumanCheck.isCorrectTrailCheck(null), false);
});

test('deployed code uses the full puzzle; only the test runner uses an easy one', () => {
  assert.equal(HumanCheck.PRODUCTION_POW_BITS, 15);
  assert.ok(process.env.NODE_TEST_CONTEXT, 'running under node --test');
  assert.equal(HumanCheck.POW_BITS, 8);
  const { execFileSync } = require('child_process');
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  const bits = execFileSync(process.execPath, ['-p', "require('./public/lib/human-check').POW_BITS"], { env, cwd: require('path').join(__dirname, '..') });
  assert.equal(String(bits).trim(), '15', 'outside the test runner the full difficulty applies');
});

test('leading-zero-bit check', () => {
  assert.equal(HumanCheck.hasLeadingZeroBits(Uint8Array.from([0, 0b00011111]), 11), true);
  assert.equal(HumanCheck.hasLeadingZeroBits(Uint8Array.from([0, 0b00111111]), 11), false);
  assert.equal(HumanCheck.hasLeadingZeroBits(Uint8Array.from([0, 0, 1]), 16), true);
  assert.equal(HumanCheck.hasLeadingZeroBits(Uint8Array.from([0, 1]), 16), false);
});

test('the browser SHA-256 (plain JavaScript) matches Node crypto', () => {
  const samples = ['', 'abc', 'Größe ü ß', 'Hiker 🥾⛺🏔️ 日本語', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'z'.repeat(1000)];
  for (const text of samples) {
    const expected = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    assert.equal(Buffer.from(HumanCheck.sha256(text)).toString('hex'), expected, JSON.stringify(text.slice(0, 20)));
  }
});

test('the browser solver works without Web Crypto and the server accepts it', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const body = submission({ powNonce: undefined, preTrailWeightLbs: 151 });
    body.powNonce = await HumanCheck.solveProofOfWork(body);
    assert.equal(passesHumanCheck(body), true);
  } finally {
    Object.defineProperty(globalThis, 'crypto', saved);
  }
});

test('the proof of work is tied to the answers: it cannot be reused for other answers', () => {
  const body = submission();
  assert.equal(passesHumanCheck(body), true);
  assert.equal(passesHumanCheck(Object.assign({}, body, { baseWeightLbs: 3 })), false);
  assert.equal(passesHumanCheck(Object.assign({}, body, { powNonce: body.powNonce + 1 })), false);
  assert.equal(passesHumanCheck(Object.assign({}, body, { powNonce: 'abc' })), false);
});

test('submissions without a solved human check are dropped silently', async () => {
  const db = freshDb();
  const noPow = submission({ powNonce: undefined });
  delete noPow.powNonce;
  const wrongItem = submission({ trailCheck: { id: HumanCheck.TRAIL_CHECKS[0].id, choice: HumanCheck.TRAIL_CHECKS[0].gear[0] } });
  for (const body of [noPow, wrongItem, Object.assign(submission(), { trailCheck: undefined })]) {
    const res = await post(submit, body);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).success, true, 'looks like success to a bot');
  }
  assert.equal(db.collection('surveys').docs.length, 0);
  assert.equal((await post(submit, submission())).statusCode, 201, 'a real submission still works');
});

test('helper sanity: solvePow is deterministic', () => {
  const body = submission();
  assert.equal(solvePow(body), body.powNonce);
});
