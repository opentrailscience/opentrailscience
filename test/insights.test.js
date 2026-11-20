const test = require('node:test');
const assert = require('node:assert/strict');
const { computeInsights, MIN_GROUP } = require('../netlify/functions/utils/insights');
const { INJURY_LOCATIONS, INJURY_LABELS } = require('../public/lib/survey-schema');

const hiker = overrides => Object.assign({
  trail: 'PCT', completionStatus: 'continuous_purist', baseWeightLbs: 12, week1DailyMiles: 12, severeInjuryOccurred: false
}, overrides);

test('every injury category has a chart label', () => {
  for (const loc of INJURY_LOCATIONS) assert.ok(INJURY_LABELS[loc], loc);
});

test('charts leave out groups smaller than MIN_GROUP', () => {
  const records = [
    ...Array.from({ length: MIN_GROUP }, () => hiker()),
    ...Array.from({ length: MIN_GROUP - 1 }, () => hiker({ trail: 'AT', completionStatus: 'quit_early' }))
  ];
  const { total, charts } = computeInsights(records);
  assert.equal(total, records.length);
  assert.deepEqual(charts.finishRateByTrail.map(r => r.label), ['PCT']);
  assert.deepEqual(charts.baseWeightByOutcome.map(r => r.label), ['Continuous hike']);
});

test('injuries are counted among the injured hikers, most common first', () => {
  const records = Array.from({ length: 10 }, (_, i) => hiker({
    severeInjuryOccurred: i < 6,
    injuryLocations: i < 6 ? (i < 3 ? ['hip_flexor', 'ankle_sprain'] : ['hip_flexor']) : null,
    injuryMilestoneMiles: i < 6 ? 600 - i * 100 : null
  }));
  const { injury } = computeInsights(records).describe.health;
  assert.deepEqual([injury.yes, injury.answered], [6, 10]);
  assert.deepEqual(injury.locations, { answered: 6, rows: [{ key: 'hip_flexor', n: 6 }, { key: 'ankle_sprain', n: 3 }] });
  assert.deepEqual(injury.miles, [100, 200, 300, 400, 500, 600], 'sorted, so the order says nothing about who');
});

test('the descriptions count every answer and keep long and short trails apart', () => {
  const records = [
    hiker({ totalDistanceMiles: 2650, baseWeightLbs: 14, backpackType: 'frameless', week1DailyMiles: 12, week2DailyMiles: 15 }),
    hiker({ trail: 'TMB', totalDistanceMiles: 106, baseWeightLbs: 22, backpackType: 'framed', week1DailyMiles: 9, week2DailyMiles: null }),
    hiker({ totalDistanceMiles: 2650, baseWeightLbs: 10, backpackType: 'frameless', week1DailyMiles: 18, week2DailyMiles: 20, week3DailyMiles: 22 })
  ];
  const { describe } = computeInsights(records);
  assert.deepEqual(describe.sample.trail.rows, [{ key: 'PCT', n: 2 }, { key: 'TMB', n: 1 }]);
  assert.deepEqual(describe.gear.backpackType, { answered: 3, rows: [{ key: 'frameless', n: 2 }, { key: 'framed', n: 1 }] });
  assert.deepEqual(describe.spread.baseWeightLbs, { long: [10, 14], short: [22] });
  // Only hikes with at least two known weeks; the TMB hike has one.
  assert.deepEqual(describe.rampUp.map(h => h.miles), [[12, 15, null, null], [18, 20, 22, null]]);
});

test('comparisons and "things that go together" wait for enough hikes', async () => {
  const { MIN_HIKES_FOR_LINKS } = require('../netlify/functions/utils/insights');
  const records = Array.from({ length: 60 }, (_, i) => hiker({ sleepQualityRating: i % 10, overallEnjoymentRating: 1 + (i % 10) }));
  assert.ok(computeCorrelations(records).length > 0, 'a strong link exists in these hikes');
  assert.deepEqual(computeInsights(records).correlations, [], `not shown below ${MIN_HIKES_FOR_LINKS} hikes`);
  assert.ok(MIN_GROUP >= 30);
});

const { computeCorrelations, MIN_PAIRS } = require('../netlify/functions/utils/insights');

test('the strongest relationship is described as a plain comparison of two groups', () => {
  const records = Array.from({ length: 40 }, (_, i) => hiker({ sleepQualityRating: i % 10, overallEnjoymentRating: 1 + (i % 10) }));
  const [top] = computeCorrelations(records);
  assert.equal(top.headline, 'Better sleep, happier hike');
  assert.deepEqual(top.groups.map(g => [g.label, g.display, g.n]), [['Sleep above 4/10', '8/10', 20], ['Sleep 4/10 or less', '3/10', 20]]);
  assert.equal(top.strength, 'strong');
  assert.match(top.text, /^Hikers who rated their sleep above 4 rated their enjoyment 8\/10 on average; the others rated their enjoyment 3\/10\.$/);
  assert.equal(top.n, 40);
  assert.ok(top.r > 0.9);
});

test('relationships need enough hikes on both sides, and weak ones are left out', () => {
  const few = Array.from({ length: MIN_PAIRS - 1 }, (_, i) => hiker({ sleepQualityRating: i % 10, overallEnjoymentRating: 1 + (i % 10) }));
  assert.deepEqual(computeCorrelations(few), []);
  // Enjoyment unrelated to sleep: nothing to report.
  const noise = Array.from({ length: 60 }, (_, i) => hiker({ sleepQualityRating: i % 10, overallEnjoymentRating: 5 + ((i * 7) % 3) - 1 }));
  assert.ok(!computeCorrelations(noise).some(c => /sleep/.test(c.text)));
});

const { scoreAllPairs } = require('../netlify/functions/utils/insights');
const { generateSyntheticHikers } = require('../scripts/lib/synthetic-hikers');

test('planted effects are found with the right direction and the right numbers', () => {
  // 2000 synthetic hikes; untreated water makes 60% sick (15% otherwise), a deadline adds 4 mi/day.
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const records = generateSyntheticHikers(2000, { seed: 5 }).map(r => {
    const untreated = rand() < 0.2;
    const deadline = rand() < 0.4;
    return Object.assign(r, {
      waterFiltration: untreated ? 'none' : 'water_filter',
      gotSick: rand() < (untreated ? 0.6 : 0.15),
      hadCompletionDeadline: deadline,
      averageDailyMiles: (deadline ? 19 : 15) + (rand() - 0.5) * 4
    });
  });
  // Look at every qualifying card, not just the top 3: the synthetic hikers have strong effects of their own.
  const top = scoreAllPairs(records).map(s => s.card).filter(Boolean);
  assert.ok(computeCorrelations(records).length <= 3);
  const water = top.find(c => c.headline === 'Untreated water, more sickness');
  const deadline = top.find(c => c.headline === 'A deadline, a faster pace');
  assert.ok(water && deadline, top.map(c => c.headline).join(' | '));
  assert.ok(Math.abs(water.groups[0].value - 0.6) < 0.05 && Math.abs(water.groups[1].value - 0.15) < 0.03, JSON.stringify(water.groups));
  assert.ok(Math.abs(deadline.groups[0].value - 19) < 0.3 && Math.abs(deadline.groups[1].value - 15) < 0.3, JSON.stringify(deadline.groups));
  // Group sizes add up to the hikes used, and r matches a fresh calculation.
  for (const s of scoreAllPairs(records).filter(s => s.card)) {
    assert.equal(s.card.groups[0].n + s.card.groups[1].n, s.pairs.length);
    const n = s.pairs.length, mx = s.pairs.reduce((a, p) => a + p[0], 0) / n, my = s.pairs.reduce((a, p) => a + p[1], 0) / n;
    const cov = s.pairs.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
    const r = cov / Math.sqrt(s.pairs.reduce((a, p) => a + (p[0] - mx) ** 2, 0) * s.pairs.reduce((a, p) => a + (p[1] - my) ** 2, 0));
    assert.ok(Math.abs(r - s.r) < 1e-12);
  }
});

test('hikers who mostly ate at huts or restaurants stay out of the stove comparison', () => {
  const records = [
    ...Array.from({ length: 20 }, () => hiker({ cookSystem: 'stove_cooked', baseWeightLbs: 20 })),
    ...Array.from({ length: 20 }, () => hiker({ cookSystem: 'cold_soaking', baseWeightLbs: 10 })),
    ...Array.from({ length: 20 }, () => hiker({ cookSystem: 'huts_restaurants', baseWeightLbs: 30 }))
  ];
  const stove = computeCorrelations(records).find(c => /stove/i.test(c.headline));
  assert.ok(stove, 'the stove pair is found');
  assert.equal(stove.n, 40, 'hut and restaurant meals are neither "no stove" nor "stove"');
  assert.deepEqual(stove.groups.map(g => [g.label, g.n]).sort(), [['No stove', 20], ['Stove', 20]]);
});
