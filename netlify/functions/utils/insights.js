/**
 * The numbers behind the Insights page charts, computed when the snapshot is
 * built (public/data/insights.json), so the page doesn't have to download
 * the whole dataset. public/insights.js draws them.
 *
 * Each chart is a list of rows { key, label, value, n } (plus `of` for shares of
 * a group); `key` is the category's code, which the page uses for its color. Groups smaller than MIN_GROUP hikers are left out.
 */
const Schema = require('../../../public/lib/survey-schema');

const MIN_GROUP = 5;

function numbers(list, key) {
  return list.map(r => r[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

function pct(part, whole) {
  return Math.round((part / whole) * 100);
}

function baseWeightByOutcome(records) {
  return Object.keys(Schema.COMPLETION_LABELS).map(status => {
    const weights = numbers(records.filter(r => r.completionStatus === status), 'baseWeightLbs');
    return { key: status, label: Schema.COMPLETION_LABELS[status], value: weights.length ? median(weights) : null, n: weights.length };
  });
}

function finishRateByTrail(records) {
  const attempts = records.filter(r => r.completionStatus && r.completionStatus !== 'section_hike');
  const byTrail = {};
  attempts.forEach(r => { (byTrail[r.trail] = byTrail[r.trail] || []).push(r); });
  return Object.entries(byTrail)
    .map(([trail, list]) => ({
      key: trail,
      label: Schema.trailName(trail) || 'Other trails',
      value: pct(list.filter(r => Schema.COMPLETED_STATUSES.includes(r.completionStatus)).length, list.length),
      n: list.length
    }))
    .sort((a, b) => b.value - a.value);
}

function commonInjuries(records) {
  const injured = records.filter(r => r.severeInjuryOccurred === true);
  if (injured.length < MIN_GROUP) return [];
  const counts = {};
  injured.forEach(r => (r.injuryLocations || []).forEach(loc => { counts[loc] = (counts[loc] || 0) + 1; }));
  return Object.entries(counts)
    .map(([loc, count]) => ({ key: loc, label: Schema.INJURY_LABELS[loc] || loc, value: pct(count, injured.length), n: count, of: injured.length }))
    .sort((a, b) => b.value - a.value);
}

function injuryRateByFirstWeek(records) {
  const bins = [
    { label: 'Under 10 mi/day', test: v => v < 10 },
    { label: '10 to 14 mi/day', test: v => v >= 10 && v < 15 },
    { label: '15 to 19 mi/day', test: v => v >= 15 && v < 20 },
    { label: '20+ mi/day', test: v => v >= 20 }
  ];
  const known = records.filter(r => typeof r.week1DailyMiles === 'number' && typeof r.severeInjuryOccurred === 'boolean');
  return bins.map((bin, i) => {
    const group = known.filter(r => bin.test(r.week1DailyMiles));
    return {
      key: String(i),
      label: bin.label,
      value: group.length ? pct(group.filter(r => r.severeInjuryOccurred).length, group.length) : null,
      n: group.length
    };
  });
}

const CHARTS = { baseWeightByOutcome, finishRateByTrail, commonInjuries, injuryRateByFirstWeek };

// --- Things that go together ---------------------------------------------------
// A fixed list of pairs worth telling (some surprising, some obvious). Each is
// scored with a Pearson correlation; the strongest few are shown, each as a
// plain comparison of two groups. With few hikes these are hints, not findings.

const MIN_PAIRS = 30;       // hikes with both answers
const MIN_SPLIT_GROUP = 10; // hikes on each side of the comparison
const MIN_STRENGTH = 0.2;   // |r| below this is not worth a headline
const TOP_CORRELATIONS = 3;

const round1 = v => Math.round(v * 10) / 10;
const kg = lb => Math.round(lb * 0.4536 * 10) / 10;
const km = mi => Math.round(mi * 1.60934);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const finished = r => (r.completionStatus === 'section_hike' || !r.completionStatus ? null : Schema.COMPLETED_STATUSES.includes(r.completionStatus) ? 1 : 0);
const weightChange = r => (isNum(r.postTrailWeightLbs) && isNum(r.preTrailWeightLbs) ? r.postTrailWeightLbs - r.preTrailWeightLbs : null);
const bool = v => (typeof v === 'boolean' ? (v ? 1 : 0) : null);
const oneOf = (field, values) => r => (r[field] ? (values.includes(r[field]) ? 1 : 0) : null);
const milesPerShoePair = r => (isNum(r.totalDistanceMiles) && isNum(r.shoePairsUsed) && r.shoePairsUsed > 0 ? r.totalDistanceMiles / r.shoePairsUsed : null);

// y formats: `avg` writes a group's average with its verb (for the sentence),
// `short` writes the bare value (for the bars on the card).
const Y = {
  pace: { avg: v => `hiked ${round1(v)} mi/day (${km(v)} km)`, short: v => `${round1(v)} mi/day` },
  enjoyment: { avg: v => `rated their enjoyment ${round1(v)}/10`, short: v => `${round1(v)}/10` },
  zeros: { avg: v => `took ${round1(v)} zero days`, short: v => `${round1(v)} zeros` },
  weightLoss: { avg: v => `${v <= 0 ? 'lost' : 'gained'} ${round1(Math.abs(v))} lb (${kg(Math.abs(v))} kg)`, short: v => `${v <= 0 ? '−' : '+'}${round1(Math.abs(v))} lb`, magnitude: v => Math.abs(v) },
  alone: { avg: v => `hiked alone ${Math.round(v)}% of the time`, short: v => `${Math.round(v)}% alone` },
  base: { avg: v => `carried a ${round1(v)} lb (${kg(v)} kg) base weight`, short: v => `${round1(v)} lb` },
  shoeMiles: { avg: v => `got ${Math.round(v)} mi (${km(v)} km) per pair`, short: v => `${Math.round(v)} mi/pair` },
  rate: phrase => ({ share: true, phrase, short: v => `${Math.round(v * 100)}%` })
};

// Each pair: x and y read from a public record, how to split the hikers into
// two groups (`split` at the median, or `binary` for yes/no), short bar
// labels, and a headline for each direction. The data decides the direction.
const CANDIDATES = [
  { emoji: '🎒', x: r => r.baseWeightLbs, y: r => r.averageDailyMiles, yf: Y.pace, split: t => [`Hikers with a base weight over ${round1(t)} lb (${kg(t)} kg)`, 'the lighter half'], bars: t => [`Over ${round1(t)} lb`, `${round1(t)} lb or less`], headline: ['Heavier packs, faster pace', 'Lighter packs, faster pace'] },
  { emoji: '😴', x: r => r.sleepQualityRating, y: r => r.overallEnjoymentRating, yf: Y.enjoyment, split: t => [`Hikers who rated their sleep above ${round1(t)}`, 'the others'], bars: t => [`Sleep above ${round1(t)}/10`, `Sleep ${round1(t)}/10 or less`], headline: ['Better sleep, happier hike', 'Better sleep, less enjoyment'] },
  { emoji: '💤', x: r => r.hoursSleepPerNight, y: r => r.overallEnjoymentRating, yf: Y.enjoyment, split: t => [`Hikers sleeping more than ${round1(t)} hours`, 'shorter sleepers'], bars: t => [`Over ${round1(t)} h sleep`, `${round1(t)} h or less`], headline: ['More sleep, happier hike', 'Less sleep, happier hike'] },
  { emoji: '🧭', x: r => r.percentHikingAlone, y: r => r.overallEnjoymentRating, yf: Y.enjoyment, split: t => [`Hikers who were alone more than ${Math.round(t)}% of the time`, 'the more social half'], bars: t => [`Alone > ${Math.round(t)}%`, `Alone ≤ ${Math.round(t)}%`], headline: ['More time alone, happier hike', 'More company, happier hike'] },
  { emoji: '🛋️', x: r => r.daysOnTrail, y: r => r.totalZeroDays, yf: Y.zeros, split: t => [`Hikes longer than ${Math.round(t)} days`, 'shorter hikes'], bars: t => [`Over ${Math.round(t)} days`, `${Math.round(t)} days or less`], headline: ['Longer hikes, more zero days', 'Longer hikes, fewer zero days'] },
  { emoji: '⚖️', x: r => r.daysOnTrail, y: weightChange, yf: Y.weightLoss, split: t => [`Hikers out for more than ${Math.round(t)} days`, 'shorter hikes'], bars: t => [`Over ${Math.round(t)} days`, `${Math.round(t)} days or less`], headline: ['Longer hikes, less weight lost', 'Longer hikes, more weight lost'] },
  { emoji: '🍫', x: r => r.averageCalories, y: weightChange, yf: Y.weightLoss, split: t => [`Hikers eating more than ${Math.round(t)} calories a day`, 'those eating less'], bars: t => [`Over ${Math.round(t)} kcal`, `${Math.round(t)} kcal or less`], headline: ['More food, less weight lost', 'More food, more weight lost'] },
  { emoji: '🩹', x: r => r.week1DailyMiles, y: r => bool(r.severeInjuryOccurred), yf: Y.rate('had a trail-altering injury'), split: t => [`hikers who started faster than ${round1(t)} mi/day (${km(t)} km)`, 'slower starters'], bars: t => [`Week 1 over ${round1(t)} mi/day`, `${round1(t)} mi/day or less`], headline: ['Faster starts, more injuries', 'Faster starts, fewer injuries'] },
  { emoji: '🎒', x: r => r.baseWeightLbs, y: r => bool(r.severeInjuryOccurred), yf: Y.rate('had a trail-altering injury'), split: t => [`hikers with a base weight over ${round1(t)} lb (${kg(t)} kg)`, 'the lighter half'], bars: t => [`Over ${round1(t)} lb`, `${round1(t)} lb or less`], headline: ['Heavier packs, more injuries', 'Heavier packs, fewer injuries'] },
  { emoji: '💪', x: r => r.preTrailFitnessRating, y: finished, yf: Y.rate('finished their thru-hike'), split: t => [`hikers who rated their fitness above ${round1(t)}`, 'the others'], bars: t => [`Fitness above ${round1(t)}/10`, `${round1(t)}/10 or less`], headline: ['Fitter hikers finished more often', 'Fitter hikers finished less often'] },
  { emoji: '🥾', x: oneOf('priorExperience', ['multi_week_trips', 'previous_thru_hike']), y: finished, yf: Y.rate('finished their thru-hike'), binary: ['hikers with multi-week or thru-hike experience', 'less experienced hikers'], bars: () => ['Multi-week or more', 'Less experience'], headline: ['More experience, more finishes', 'More experience, fewer finishes'] },
  { emoji: '💧', x: oneOf('waterFiltration', ['none']), y: r => bool(r.gotSick), yf: Y.rate('got sick on the trail'), binary: ['hikers who didn’t treat their water', 'those who did'], bars: () => ['Untreated water', 'Treated water'], headline: ['Untreated water, more sickness', 'Untreated water, less sickness'] },
  { emoji: '⛰️', x: oneOf('trekkingPoleUsage', ['two_poles', 'one_pole']), y: r => bool(r.severeInjuryOccurred), yf: Y.rate('had a trail-altering injury'), binary: ['hikers with trekking poles', 'those without'], bars: () => ['With poles', 'Without poles'], headline: ['Poles, more injuries', 'Poles, fewer injuries'] },
  { emoji: '⏰', x: r => bool(r.hadCompletionDeadline), y: r => r.averageDailyMiles, yf: Y.pace, binary: ['Hikers with a fixed deadline', 'those without'], bars: () => ['With a deadline', 'No deadline'], headline: ['A deadline, a faster pace', 'A deadline, a slower pace'] },
  { emoji: '🧍', x: oneOf('startGroup', ['solo']), y: r => r.percentHikingAlone, yf: Y.alone, binary: ['Hikers who started solo', 'those who started with others'], bars: () => ['Started solo', 'Started with others'], headline: ['Started solo, more time alone', 'Started solo, less time alone'] },
  { emoji: '🔥', x: oneOf('cookSystem', ['cold_soaking', 'no_cook_packaged']), y: r => r.baseWeightLbs, yf: Y.base, binary: ['Hikers without a stove', 'stove users'], bars: () => ['No stove', 'Stove'], headline: ['No stove, heavier pack', 'No stove, lighter pack'] },
  { emoji: '💊', x: oneOf('painkillerUse', ['daily']), y: r => bool(r.severeInjuryOccurred), yf: Y.rate('had a trail-altering injury'), binary: ['hikers who took painkillers daily', 'those who took them less often'], bars: () => ['Daily painkillers', 'Less often'], headline: ['Daily painkillers, more injuries', 'Daily painkillers, fewer injuries'] },
  { emoji: '🤔', x: oneOf('consideredQuitting', ['several_times', 'almost_constantly']), y: finished, yf: Y.rate('finished their thru-hike'), binary: ['hikers who thought about quitting several times or more', 'those who did once, twice or never'], bars: () => ['Several times or more', 'Once, twice or never'], headline: ['Frequent doubts, finished more often', 'Frequent doubts, finished less often'] },
  { emoji: '👟', x: oneOf('footwearCategory', ['boots', 'hiking_shoes']), y: milesPerShoePair, yf: Y.shoeMiles, binary: ['Hikers in boots or hiking shoes', 'everyone else'], bars: () => ['Boots or hiking shoes', 'Trail runners and others'], headline: ['Boots, more miles per pair', 'Boots, fewer miles per pair'] },
  { emoji: '📦', x: oneOf('resupplyStrategy', ['mostly_mail_drops']), y: r => r.totalZeroDays, yf: Y.zeros, binary: ['Hikers who mostly used mail drops', 'everyone else'], bars: () => ['Mostly mail drops', 'Shopped along the way'], headline: ['Mail drops, more zero days', 'Mail drops, fewer zero days'] },
  { emoji: '🥗', x: oneOf('trailDiet', ['vegetarian', 'vegan']), y: weightChange, yf: Y.weightLoss, binary: ['Vegetarian and vegan hikers', 'everyone else'], bars: () => ['Vegetarian or vegan', 'Everyone else'], headline: ['Plant-based, less weight lost', 'Plant-based, more weight lost'] }
];

function pearson(pairs) {
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

const average = list => list.reduce((s, v) => s + v, 0) / list.length;

function describeCorrelation(c, pairs, r) {
  let high, low, labels;
  if (c.binary) {
    high = pairs.filter(p => p[0] === 1).map(p => p[1]);
    low = pairs.filter(p => p[0] === 0).map(p => p[1]);
    labels = c.binary;
  } else {
    const xs = pairs.map(p => p[0]).sort((a, b) => a - b);
    const t = xs[Math.floor((xs.length - 1) / 2)];
    high = pairs.filter(p => p[0] > t).map(p => p[1]);
    low = pairs.filter(p => p[0] <= t).map(p => p[1]);
    labels = c.split(t);
    labels.threshold = t;
  }
  if (high.length < MIN_SPLIT_GROUP || low.length < MIN_SPLIT_GROUP) return null;
  const [hi, lo] = [average(high), average(low)];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const text = c.yf.share
    ? `${cap(String(Math.round(hi * 100)))}% of ${labels[0]} ${c.yf.phrase}, vs ${Math.round(lo * 100)}% of ${labels[1]}.`
    : `${cap(labels[0])} ${c.yf.avg(hi)} on average; ${labels[1]} ${c.yf.avg(lo)}.`;
  const barLabels = c.bars(c.binary ? null : labels.threshold);
  const magnitude = c.yf.magnitude || (v => v);
  const strength = Math.abs(r) >= 0.5 ? 'strong' : Math.abs(r) >= 0.3 ? 'moderate' : 'weak';
  return {
    emoji: c.emoji,
    headline: r > 0 ? c.headline[0] : c.headline[1],
    text,
    groups: [
      { label: barLabels[0], value: Math.round(magnitude(hi) * 1000) / 1000, display: c.yf.short(hi), n: high.length },
      { label: barLabels[1], value: Math.round(magnitude(lo) * 1000) / 1000, display: c.yf.short(lo), n: low.length }
    ],
    r: Math.round(r * 100) / 100,
    strength,
    n: pairs.length
  };
}

/**
 * Every pair, scored: the (x, y) points it used, r, and the card if it would
 * qualify. computeCorrelations picks from these; tests check them against an
 * independent calculation.
 */
function scoreAllPairs(records) {
  return CANDIDATES.map((c, index) => {
    const pairs = records.map(r => [c.x(r), c.y(r)]).filter(([x, y]) => isNum(x) && isNum(y));
    const r = pairs.length >= 2 ? pearson(pairs) : 0;
    const qualifies = pairs.length >= MIN_PAIRS && Math.abs(r) >= MIN_STRENGTH;
    return { index, headlines: c.headline, binary: !!c.binary, pairs, r, card: qualifies ? describeCorrelation(c, pairs, r) : null };
  });
}

/** The strongest relationships in the data, as plain sentences (at most TOP_CORRELATIONS). */
function computeCorrelations(records) {
  return scoreAllPairs(records)
    .map(s => s.card)
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, TOP_CORRELATIONS);
}

/** { total, charts: { id: rows } } with small groups removed, at most 8 rows per chart. */
function computeInsights(records) {
  const charts = {};
  for (const [id, rowsOf] of Object.entries(CHARTS)) {
    charts[id] = rowsOf(records)
      .filter(r => r.value !== null && r.n >= (r.of ? 1 : MIN_GROUP))
      .slice(0, 8);
  }
  return { total: records.length, charts, correlations: computeCorrelations(records), comparisonsTried: CANDIDATES.length };
}

module.exports = { computeInsights, computeCorrelations, scoreAllPairs, MIN_GROUP, MIN_PAIRS, MIN_SPLIT_GROUP, MIN_STRENGTH };
