const test = require('node:test');
const assert = require('node:assert/strict');
const { plausibilityNotes } = require('../scripts/lib/plausibility');

const entry = o => Object.assign({ surveyMinutesBand: '10-20', averageDailyMiles: 18, week1DailyMiles: 14, baseWeightLbs: 14, maxHeavyLoadLbs: 28,
  preTrailWeightLbs: 170, postTrailWeightLbs: 158, preTrailFitnessRating: 6, sleepQualityRating: 7, overallEnjoymentRating: 9, trail: 'PCT' }, o);

test('an ordinary entry has nothing worth a second look', () => {
  assert.deepEqual(plausibilityNotes(entry(), [entry({ trail: 'AT' })]), []);
});

test('rushed, extreme or copied entries are pointed out', () => {
  assert.deepEqual(plausibilityNotes(entry({ surveyMinutesBand: 'under-5' })), ['survey under 5 min']);
  assert.deepEqual(plausibilityNotes(entry({ averageDailyMiles: 40, week1DailyMiles: 33 })), ['pace over 35 mi/day', 'week 1 over 30 mi/day']);
  assert.deepEqual(plausibilityNotes(entry({ maxHeavyLoadLbs: 14 })), ['heaviest pack = base weight']);
  assert.deepEqual(plausibilityNotes(entry({ postTrailWeightLbs: 120 })), ['body weight changed over 40 lb']);
  assert.deepEqual(plausibilityNotes(entry({ preTrailFitnessRating: 10, sleepQualityRating: 10, overallEnjoymentRating: 10 })), ['every rating 1 or every rating 10']);
  const a = entry(), b = entry();
  assert.deepEqual(plausibilityNotes(a, [a, b]), ['same answers as 1 other new entry']);
});

test('missing answers ("Don\'t know", does not apply) are never flagged', () => {
  assert.deepEqual(plausibilityNotes(entry({ averageDailyMiles: null, week1DailyMiles: null, baseWeightLbs: null, maxHeavyLoadLbs: null, postTrailWeightLbs: null })), []);
});
