/**
 * Things worth a second look in a new survey entry, for `npm run new-entries`.
 * They don't reject anything: real hikes can be unusual. They help spot invented
 * or rushed entries before they are published (see scripts/read-new-entries.js).
 */
const isNum = v => typeof v === 'number' && Number.isFinite(v);

// Each check: a short note and the test. Limits are generous on purpose.
const CHECKS = [
  ['survey under 5 min', r => r.surveyMinutesBand === 'under-5'],
  ['pace over 35 mi/day', r => isNum(r.averageDailyMiles) && r.averageDailyMiles > 35],
  ['week 1 over 30 mi/day', r => isNum(r.week1DailyMiles) && r.week1DailyMiles > 30],
  ['base weight under 5 lb', r => isNum(r.baseWeightLbs) && r.baseWeightLbs < 5],
  ['heaviest pack = base weight', r => isNum(r.baseWeightLbs) && r.maxHeavyLoadLbs === r.baseWeightLbs],
  ['body weight changed over 40 lb', r => isNum(r.preTrailWeightLbs) && isNum(r.postTrailWeightLbs) && Math.abs(r.postTrailWeightLbs - r.preTrailWeightLbs) > 40],
  ['every rating 1 or every rating 10', r => {
    const ratings = [r.preTrailFitnessRating, r.sleepQualityRating, r.overallEnjoymentRating].filter(isNum);
    return ratings.length === 3 && (ratings.every(v => v === 1) || ratings.every(v => v === 10));
  }]
];

/** The notes for one entry; `others` are the other new entries (identical answers are suspicious). */
function plausibilityNotes(record, others) {
  const notes = CHECKS.filter(([, test]) => test(record)).map(([note]) => note);
  const same = (others || []).filter(o => o !== record && JSON.stringify(o) === JSON.stringify(record)).length;
  if (same) notes.push(`same answers as ${same} other new ${same === 1 ? 'entry' : 'entries'}`);
  return notes;
}

module.exports = { plausibilityNotes, CHECKS };
