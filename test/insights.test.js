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

test('injury shares are of injured hikers and use the short labels', () => {
  const records = Array.from({ length: 10 }, (_, i) => hiker({
    severeInjuryOccurred: i < 6,
    injuryLocations: i < 6 ? (i < 3 ? ['hip_flexor', 'ankle_sprain'] : ['hip_flexor']) : null
  }));
  const rows = computeInsights(records).charts.commonInjuries;
  assert.deepEqual(rows, [
    { key: 'hip_flexor', label: 'Hip / hip flexor', value: 100, n: 6, of: 6 },
    { key: 'ankle_sprain', label: 'Ankle sprain', value: 50, n: 3, of: 6 }
  ]);
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
