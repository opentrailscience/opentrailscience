const test = require('node:test');
const assert = require('node:assert/strict');
const submit = require('../netlify/functions/submit');
const myHike = require('../netlify/functions/my-hike');
const { THROTTLE_MAX } = require('../netlify/functions/utils/spam');
const { freshDb, submission, get, post } = require('./helpers');

// Distinct networks, so the submissions are not throttled.
const from = i => ({ 'x-nf-client-connection-ip': `10.9.0.${i}` });

async function submitHikes(count) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const res = await post(submit, submission({ baseWeightLbs: 8 + i }), from(i));
    codes.push(JSON.parse(res.body).deletionCode);
  }
  return codes;
}

test('the deletion code shows the hike and an up-to-date comparison', async () => {
  freshDb();
  const [first] = await submitHikes(1);
  const early = JSON.parse((await post(myHike, { code: first }, from(200))).body);
  assert.equal(early.success, true);
  assert.equal(early.comparison, null, 'nobody to compare with yet');

  await submitHikes(12);
  const later = JSON.parse((await post(myHike, { code: first.toLowerCase() }, from(201))).body);
  assert.ok(later.comparison, 'compared once others have answered');
  assert.equal(later.comparison.peerCount, 12, 'the hiker is not compared with their own hike');
  assert.equal(later.data.baseWeightLbs, 8);
  assert.ok(!('_id' in later.data) && !('isSynthetic' in later.data));
});

test('unknown or malformed codes, and other methods, are refused', async () => {
  freshDb();
  assert.equal((await post(myHike, { code: '7K3Q-M9XD-2WPA-HV4T' })).statusCode, 404);
  assert.equal((await post(myHike, { code: 'nope' })).statusCode, 404);
  assert.equal((await post(myHike, 'not json')).statusCode, 400);
  assert.equal((await get(myHike)).statusCode, 405);
});

test('lookups are limited per network and hour', async () => {
  freshDb();
  for (let i = 0; i < THROTTLE_MAX; i++) assert.equal((await post(myHike, { code: '7K3Q-M9XD-2WPA-HV4T' })).statusCode, 404);
  assert.equal((await post(myHike, { code: '7K3Q-M9XD-2WPA-HV4T' })).statusCode, 429);
});
