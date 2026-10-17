const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { toCSV } = require('../netlify/functions/utils/dataset');
const { computeStats } = require('../public/lib/survey-stats');
const { PUBLIC_COLUMNS, SCHEMA_VERSION } = require('../public/lib/survey-schema');
const { generateSyntheticHikers } = require('../scripts/lib/synthetic-hikers');
const dictionary = require('../scripts/generate-data-dictionary');

test('CSV escapes quotes, commas, newlines and joins arrays', () => {
  const csv = toCSV([{ trail: 'PCT', consentVersion: 'v "1", then\nnew', injuryLocations: ['knee_it_band', 'ankle_sprain'], startWeek: null }]);
  const [header, row] = csv.split('\r\n');
  assert.equal(header, PUBLIC_COLUMNS.join(','));
  assert.ok(row.startsWith(','), 'missing schemaVersion is empty');
  assert.ok(csv.includes('"v ""1"", then\nnew"'));
  assert.ok(csv.includes('"knee_it_band;ankle_sprain"'));
});

test('CSV of no records is just the header', () => {
  assert.equal(toCSV([]), PUBLIC_COLUMNS.join(',') + '\r\n');
});

test('stats average only answered values and list every category', () => {
  const s = computeStats([
    { trail: 'PCT', baseWeightLbs: 10, averageDailyMiles: 20, cookSystem: 'hybrid', completionStatus: 'quit_early' },
    { trail: 'PCT', baseWeightLbs: 20, averageDailyMiles: null, cookSystem: 'stove_cooked', completionStatus: 'continuous_purist' }
  ]);
  assert.equal(s.avgDailyMiles, 20, 'null pace is not counted as 0');
  assert.equal(s.medianBaseWeightLbs, 15);
  assert.equal(s.completionRate, 50);
  assert.equal(s.breakdowns.cookSystem.hybrid, 50);
  assert.equal(s.breakdowns.cookSystem.cold_soaking, 0, 'hybrid is not counted as cold soaking');
});

test('stats of an empty dataset are empty, not invented', () => {
  const s = computeStats([]);
  assert.equal(s.totalCount, 0);
  assert.equal(s.avgDailyMiles, null);
  assert.equal(s.completionRate, null);
});

test('synthetic hikers are valid, flagged and reproducible', () => {
  const a = generateSyntheticHikers(200, { seed: 3, now: new Date('2026-01-01T00:00:00Z') });
  const b = generateSyntheticHikers(200, { seed: 3, now: new Date('2026-01-01T00:00:00Z') });
  assert.deepEqual(a, b);
  assert.ok(a.every(h => h.isSynthetic === true));
});

test('docs/DATA_DICTIONARY.md is up to date (run `npm run docs`)', () => {
  assert.equal(fs.readFileSync(dictionary.OUT_FILE, 'utf-8'), dictionary.render());
});

const { compareToPeers, MIN_PEERS } = require('../public/lib/survey-stats');

function peers(n, overrides) {
  return Array.from({ length: n }, (_, i) => Object.assign({
    trail: 'PCT', baseWeightLbs: 10 + i, averageDailyMiles: 15 + i * 0.5, overallEnjoymentRating: 8,
    // 100 days on trail, so zero-day rates are 0.10 .. 0.19
    daysOnTrail: 100, totalZeroDays: 10 + i
  }, overrides && overrides(i)));
}

test('comparison phrases the share of same-trail hikers the record beats', () => {
  // Base weights 10..19: 12.5 is lighter than 7 of 10.
  const result = compareToPeers({
    trail: 'PCT', baseWeightLbs: 12.5, averageDailyMiles: 30, overallEnjoymentRating: 10,
    daysOnTrail: 20, totalZeroDays: 5 // rate 0.25
  }, peers(10));
  assert.equal(result.group, 'PCT hikers');
  assert.equal(result.peerCount, 10);
  const texts = result.items.map(i => i.text);
  assert.ok(texts.includes('Your base weight was lighter than 70% of PCT hikers.'), texts.join(' | '));
  assert.ok(texts.includes('Your average pace was faster than 100% of PCT hikers.'));
  assert.ok(texts.includes('You took zero days more often than 100% of PCT hikers.'), 'rate, not total: 5 zeros in 20 days');
  assert.ok(texts.includes('You enjoyed your hike more than 100% of PCT hikers.'));
  assert.ok(result.items.every((item, i, all) => i === 0 || all[i - 1].percent >= item.percent), 'sorted, strongest first');
});

test('comparison picks the true direction and skips unflattering enjoyment', () => {
  const result = compareToPeers({ trail: 'PCT', baseWeightLbs: 18.5, overallEnjoymentRating: 3 }, peers(10));
  assert.deepEqual(result.items.map(i => i.text), ['Your base weight was heavier than 90% of PCT hikers.']);
});

test('comparison falls back to all hikers, and needs enough peers', () => {
  const mixed = peers(6).concat(peers(6, () => ({ trail: 'AT' })));
  assert.equal(compareToPeers({ trail: 'PCT', baseWeightLbs: 9 }, mixed).group, 'hikers in the dataset');
  assert.equal(compareToPeers({ trail: 'PCT', baseWeightLbs: 9 }, peers(MIN_PEERS - 1)), null);
  assert.equal(compareToPeers({ trail: 'Other', baseWeightLbs: 9 }, peers(12)).group, 'hikers in the dataset');
});

const { buildShareText, MIN_SHARE_PERCENT } = require('../public/lib/survey-stats');

const hiker = overrides => Object.assign({
  trail: 'PCT', hikeYear: 2025, completionStatus: 'continuous_purist', baseWeightLbs: 12.5, averageDailyMiles: 19,
  overallEnjoymentRating: 8, daysOnTrail: 123, totalZeroDays: 20
}, overrides);

test('share text leads with the two strongest flattering comparisons', () => {
  const text = buildShareText(hiker(), compareToPeers(hiker(), peers(12)));
  assert.equal(text, 'Just added my 2025 PCT thru-hike to Open Trail Science. Turns out my pack was lighter than 75% of PCT hikers, and I hiked faster than 67% of them. How does yours compare?');
});

test('share text says "every other" instead of 100%', () => {
  const record = hiker({ baseWeightLbs: 5 });
  assert.match(buildShareText(record, compareToPeers(record, peers(12))), /my pack was lighter than every other PCT hiker, and/);
});

test('share text never brags about unflattering or weak results', () => {
  const slow = hiker({ baseWeightLbs: 30, averageDailyMiles: 10, overallEnjoymentRating: 3, totalZeroDays: 60 });
  const comparison = compareToPeers(slow, peers(12));
  assert.ok(comparison.items.length > 0, 'the results page still shows them');
  assert.equal(buildShareText(slow, comparison),
    'Just added my 2025 PCT thru-hike to Open Trail Science and saw how it stacks up against 12 other PCT hikers. How does yours compare?');

  const weak = { group: 'PCT hikers', peerCount: 12, items: [{ brag: true, percent: MIN_SHARE_PERCENT - 1, shareFirst: 'x' }] };
  assert.doesNotMatch(buildShareText(hiker(), weak), /Turns out/);
});

test('share text before there are enough peers mentions the hiker\'s own numbers', () => {
  assert.equal(buildShareText(hiker(), null),
    "Just added my 2025 PCT thru-hike (12.5 lb base weight, 19 miles a day) to Open Trail Science. It's an open dataset on how long-distance hikes really go. Have you hiked one?");
  assert.match(buildShareText(hiker({ trail: 'CDS', completionStatus: 'section_hike' }), null, { unitSystem: 'metric' }),
    /^Just added my 2025 Camino section hike \(5\.7 kg base weight, 30\.6 km a day\)/);
  assert.match(buildShareText(hiker({ trail: 'Other' }), null), /^Just added my 2025 thru-hike \(/, 'custom trails have no name');
});

test('share text reads like a person: no emoji, hashtags or exclamation marks', () => {
  const texts = [
    buildShareText(hiker(), compareToPeers(hiker(), peers(12))),
    buildShareText(hiker({ baseWeightLbs: 40 }), compareToPeers(hiker({ baseWeightLbs: 40 }), peers(12))),
    buildShareText(hiker(), null)
  ];
  texts.forEach(t => {
    assert.doesNotMatch(t, /[#!]|\p{Extended_Pictographic}/u, t);
    assert.ok(t.length < 220, `short enough for a chat message: ${t.length}`);
  });
});

test('comparison groups use readable trail names', () => {
  const camino = peers(12, () => ({ trail: 'CDS' }));
  assert.equal(compareToPeers({ trail: 'CDS', baseWeightLbs: 9 }, camino).group, 'Camino hikers');
});

test('describeSchema lists every public column in file order', () => {
  const { describeSchema } = require('../public/lib/survey-schema');
  const doc = describeSchema(new Date('2026-10-14T00:00:00Z'));
  assert.deepEqual(doc.columns.map(c => c.name), PUBLIC_COLUMNS);
  assert.equal(doc.license, 'CC0-1.0');
  assert.doesNotThrow(() => JSON.stringify(doc));
  assert.equal(doc.columns.find(c => c.name === 'hikeYear').max, 2027);
  assert.equal(doc.columns.some(c => ['startDate', 'endDate', 'age', 'submittedAt', 'consent'].includes(c.name)), false, 'unstored answers are not documented as columns');
});

test('pace is only compared within the same trail', () => {
  const others = Array.from({ length: 12 }, (_, i) => ({ trail: 'PCT', averageDailyMiles: 18 + i * 0.1, baseWeightLbs: 15 + i, overallEnjoymentRating: 8 }));
  const tmb = compareToPeers({ trail: 'TMB', averageDailyMiles: 7, baseWeightLbs: 12, overallEnjoymentRating: 9 }, others);
  assert.equal(tmb.group, 'hikers in the dataset');
  assert.ok(!tmb.items.some(i => i.field === 'averageDailyMiles'));
  const pct = compareToPeers({ trail: 'PCT', averageDailyMiles: 25, baseWeightLbs: 12, overallEnjoymentRating: 9 }, others);
  assert.ok(pct.items.some(i => i.field === 'averageDailyMiles'));
});

test('the public files carry only the documented columns, even if a record has more', () => {
  const { buildSnapshot } = require('../netlify/functions/utils/dataset');
  const old = { schemaVersion: SCHEMA_VERSION, trail: 'TMB', submittedAt: '2026-10-14T19:51:50.957Z', startDate: '2026-08-17', age: 20, hikerCountry: 'United States', totalBudgetUsd: 4000 };
  const files = buildSnapshot([old]);
  const [row] = JSON.parse(files['thru_hiker_survey_dataset.json']);
  assert.deepEqual(Object.keys(row), PUBLIC_COLUMNS);
  for (const content of Object.values(files)) {
    assert.ok(!/2026-10-14T19|2026-08-17|United States|totalBudgetUsd|hikerCountry|submittedAt/.test(content));
  }
});
