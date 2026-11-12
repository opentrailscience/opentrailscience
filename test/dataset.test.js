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

const { compareToPeers, MIN_TRAIL_PEERS, MIN_PEERS } = require('../public/lib/survey-stats');

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

test('the results page is honest; the card highlights the best, phrased the good way round', () => {
  const result = compareToPeers({ trail: 'PCT', baseWeightLbs: 18.5, overallEnjoymentRating: 3 }, peers(10));
  assert.deepEqual(result.items.map(i => i.text),
    ['You enjoyed your hike less than 100% of PCT hikers.', 'Your base weight was heavier than 90% of PCT hikers.']);
  assert.deepEqual(result.highlights.map(h => [h.percent, h.cardLine]), [[10, 'of PCT hikers carried a heavier pack']],
    'beating nobody ("0% of PCT hikers rated their hike lower") is never shown');
});

test('the card shows the three best of all categories, including sleep, money, quitting and distance', () => {
  const peer = i => ({
    hoursSleepPerNight: 6 + i * 0.2, sleepQualityRating: 4 + (i % 5), trailSpending: 5000 + i * 100, budgetCurrency: 'USD',
    consideredQuitting: ['never', 'once_or_twice', 'several_times', 'almost_constantly'][i % 4], totalDistanceMiles: 2600 + i
  });
  const record = {
    trail: 'PCT', baseWeightLbs: 18, averageDailyMiles: 16, overallEnjoymentRating: 8, daysOnTrail: 100, totalZeroDays: 15,
    hoursSleepPerNight: 9, sleepQualityRating: 10, trailSpending: 3000, budgetCurrency: 'EUR', consideredQuitting: 'never', totalDistanceMiles: 2605
  };
  const result = compareToPeers(record, peers(10, peer));
  assert.equal(result.highlights.length, 3);
  assert.deepEqual(result.highlights.map(h => h.field), ['hoursSleepPerNight', 'sleepQualityRating', 'spendingPerDay'],
    'best first; €3000 is $3300, $33 a day, less than everyone');
  assert.ok(result.highlights.every((h, i, all) => i === 0 || all[i - 1].percent >= h.percent));
  const texts = result.items.map(i => i.text);
  assert.ok(texts.includes('You thought about quitting less often than 70% of PCT hikers.'), texts.join(' | '));
  assert.ok(texts.includes('You hiked further than 50% of PCT hikers.'));
  const everyone = compareToPeers(Object.assign({}, record, { trail: 'Other' }), peers(12, peer));
  assert.ok(!everyone.items.concat(everyone.highlights).some(i => ['averageDailyMiles', 'totalDistanceMiles'].includes(i.field)),
    'no pace or distance when compared with everyone');
});

test('comparison falls back to all hikers, and needs enough peers', () => {
  // 3 others on the same trail are enough; fewer fall back to everyone, which needs 10.
  assert.equal(compareToPeers({ trail: 'PCT', baseWeightLbs: 9 }, peers(MIN_TRAIL_PEERS)).group, 'PCT hikers');
  const mixed = peers(MIN_TRAIL_PEERS - 1).concat(peers(8, () => ({ trail: 'AT' })));
  assert.equal(compareToPeers({ trail: 'PCT', baseWeightLbs: 9 }, mixed).group, 'all hikers');
  assert.equal(compareToPeers({ trail: 'PCT', baseWeightLbs: 9 }, peers(MIN_TRAIL_PEERS - 1)), null);
  assert.equal(compareToPeers({ trail: 'Other', baseWeightLbs: 9 }, peers(MIN_PEERS - 1)), null);
  assert.equal(compareToPeers({ trail: 'Other', baseWeightLbs: 9 }, peers(12)).group, 'all hikers');
  for (const trail of ['Other Europe', 'Other North America']) {
    const result = compareToPeers({ trail, baseWeightLbs: 9 }, peers(12, () => ({ trail })));
    assert.equal(result.group, 'all hikers', trail);
  }
});

const { buildShareText } = require('../public/lib/survey-stats');

const hiker = overrides => Object.assign({
  trail: 'PCT', hikeYear: 2025, completionStatus: 'continuous_purist', baseWeightLbs: 12.5, averageDailyMiles: 19,
  overallEnjoymentRating: 8, daysOnTrail: 123, totalZeroDays: 20
}, overrides);

test('share text names the three best comparisons, like the card', () => {
  const text = buildShareText(hiker(), compareToPeers(hiker(), peers(12)));
  assert.equal(text, 'Just added my 2025 PCT thru-hike to Open Trail Science: lighter pack than 75% of PCT hikers, faster than 67% and fewer zero days than 42%. How does yours compare?');
  const other = hiker({ trail: 'Other' });
  assert.doesNotMatch(buildShareText(other, compareToPeers(other, peers(12))), /faster/, 'no pace when compared with everyone');
});

test('share text says "every other" instead of 100%', () => {
  const record = hiker({ baseWeightLbs: 5 });
  assert.match(buildShareText(record, compareToPeers(record, peers(12))), /: lighter pack than every other PCT hiker, faster/);
});

test('share text is always phrased the good way round, even below average', () => {
  const below = hiker({ baseWeightLbs: 18, averageDailyMiles: 16, overallEnjoymentRating: 8, totalZeroDays: 20 });
  const text = buildShareText(below, compareToPeers(below, peers(12)));
  assert.doesNotMatch(text, /heavier|slower|more often/);
  assert.equal((text.match(/ than /g) || []).length, 3, 'still three comparisons');
  // Worst at everything: no "0% of …", so the text is about comparing instead.
  const slow = hiker({ baseWeightLbs: 30, averageDailyMiles: 10, overallEnjoymentRating: 8, totalZeroDays: 60 });
  assert.doesNotMatch(buildShareText(slow, compareToPeers(slow, peers(12))), / 0%/);

  const empty = { group: 'PCT hikers', peerNoun: 'PCT hikers', peerCount: 12, items: [], highlights: [] };
  assert.equal(buildShareText(hiker(), empty),
    'Just added my 2025 PCT thru-hike to Open Trail Science and compared it with 12 other PCT hikers. How does yours compare?');
});

test('share text before there are enough peers is about the dataset', () => {
  assert.equal(buildShareText(hiker(), null),
    "Just added my 2025 PCT thru-hike to Open Trail Science. It's an open dataset for every long trail, open all year. Have you hiked one?");
  assert.match(buildShareText(hiker({ trail: 'CDS', completionStatus: 'section_hike' }), null), /^Just added my 2025 Camino section hike to/);
  assert.match(buildShareText(hiker({ trail: 'Other' }), null), /^Just added my 2025 thru-hike to/, 'custom trails have no name');
});

test('share text reads like a person: no emoji, hashtags or exclamation marks', () => {
  const texts = [
    buildShareText(hiker(), compareToPeers(hiker(), peers(12))),
    buildShareText(hiker({ baseWeightLbs: 40 }), compareToPeers(hiker({ baseWeightLbs: 40 }), peers(12))),
    buildShareText(hiker(), null),
    // all four comparisons, longest trail code and wording
    buildShareText(hiker({ baseWeightLbs: 5, averageDailyMiles: 30, overallEnjoymentRating: 10, totalZeroDays: 1 }),
      compareToPeers(hiker({ baseWeightLbs: 5, averageDailyMiles: 30, overallEnjoymentRating: 10, totalZeroDays: 1 }), peers(12)))
  ];
  texts.forEach(t => {
    assert.doesNotMatch(t, /[#!]|\p{Extended_Pictographic}/u, t);
    assert.ok(t.length < 200, `short enough for a chat message, even with three comparisons: ${t.length}`);
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
  assert.equal(tmb.group, 'all hikers');
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

const { compareAll, TABLE_ROWS, tableValueText, tableCellText } = require('../public/lib/survey-stats');

test('the "every answer" table compares with the same trail and with everyone', () => {
  const others = peers(6).concat(peers(6, () => ({ trail: 'AT', baseWeightLbs: 30 })));
  const record = { trail: 'PCT', baseWeightLbs: 12.5, daysOnTrail: 100, totalZeroDays: 30, averageCalories: null, unknownAnswers: ['averageCalories'] };
  const table = compareAll(record, others);
  assert.deepEqual([table.trailName, table.trailCount, table.allCount], ['PCT', 6, 12]);
  assert.deepEqual(table.rows.map(r => r.key), TABLE_ROWS.map(r => r.key), 'one row per category, calories included');
  const row = key => [TABLE_ROWS.find(r => r.key === key), table.rows.find(r => r.key === key)];
  const [baseDef, base] = row('baseWeightLbs');
  assert.equal(tableCellText(baseDef, base.trail), 'Lighter than 50%', 'base weights 10..15: 12.5 is below 3 of 6');
  assert.equal(tableCellText(baseDef, base.all), 'Lighter than 75%', 'plus six AT hikers at 30 lb');
  assert.equal(tableValueText(baseDef, record, 'metric'), '5.7 kg');
  const [calDef, cal] = row('averageCalories');
  assert.deepEqual([cal.trail, cal.all], [null, null], '"Don\'t know" has nothing to compare');
  assert.equal(tableCellText(calDef, cal.trail), '–');
  const [, zeros] = row('zeroDaysPer100');
  assert.deepEqual(zeros.trail, { percent: 100, lower: false }, '30 per 100 days is more than everyone');
  const few = compareAll(record, peers(2));
  assert.deepEqual(few.rows.find(r => r.key === 'baseWeightLbs').trail, { status: 'few' });
  assert.equal(tableCellText(baseDef, { status: 'few' }), 'Not enough hikers yet');
  const same = compareAll({ trail: 'PCT', overallEnjoymentRating: 8 }, peers(6));
  assert.equal(tableCellText(TABLE_ROWS.find(r => r.key === 'overallEnjoymentRating'), same.rows.find(r => r.key === 'overallEnjoymentRating').trail), 'Same as everyone');
  const other = compareAll(Object.assign({}, record, { trail: 'Other Europe' }), others);
  assert.equal(other.trailName, null);
  assert.ok(other.rows.every(r => r.trail === null), 'no trail column for the "Other" trails');
});

test('a weight gain is not worded as a weight loss', () => {
  const others = peers(6, i => ({ preTrailWeightLbs: 160, postTrailWeightLbs: 150 - i }));
  const def = TABLE_ROWS.find(r => r.key === 'weightChange');
  const gained = { trail: 'PCT', preTrailWeightLbs: 160, postTrailWeightLbs: 162 };
  const lost = { trail: 'PCT', preTrailWeightLbs: 160, postTrailWeightLbs: 140 };
  const cell = r => compareAll(r, others).rows.find(x => x.key === 'weightChange').trail;
  assert.equal(tableValueText(def, gained, 'imperial'), '+2 lb');
  assert.equal(tableCellText(def, cell(gained), gained), 'Gained more than 100%');
  assert.equal(tableCellText(def, cell(lost), lost), 'Lost more than 100%');
});
