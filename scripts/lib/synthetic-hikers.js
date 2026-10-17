/**
 * Synthetic hiker generator for local development and tests.
 *
 * Distributions loosely follow public long-distance hiking surveys, but the
 * records are invented. Every record is marked `isSynthetic: true`, which keeps
 * it out of the public stats, preview and exports (see utils/dataset.js).
 */
const { validateSurvey, daysOnTrail, directionsFor } = require('../../public/lib/survey-schema');

const TRAILS = [
  { name: 'PCT', share: 0.38, miles: 2650, dailyMiles: [16, 22], start: [3, 5] },
  { name: 'AT', share: 0.33, miles: 2198, dailyMiles: [14, 19], start: [3, 5] },
  { name: 'CDT', share: 0.11, miles: 3100, dailyMiles: [19, 25], start: [4, 5] },
  { name: 'CT', share: 0.07, miles: 486, dailyMiles: [15, 20], start: [7, 7] },
  { name: 'AZT', share: 0.05, miles: 800, dailyMiles: [16, 21], start: [3, 3] },
  // Small trails: published with month precision (see POPULAR_TRAILS).
  { name: 'Hayduke', share: 0.03, miles: 812, dailyMiles: [12, 16], start: [3, 4] },
  { name: 'KUN', share: 0.03, miles: 273, dailyMiles: [12, 16], start: [7, 8] }
];

/** Deterministic PRNG (mulberry32) so tests and seeds are reproducible. */
function createRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createHelpers(random) {
  return {
    chance: p => random() < p,
    pick: arr => arr[Math.floor(random() * arr.length)],
    range: (min, max, decimals = 0) => {
      const p = Math.pow(10, decimals);
      return Math.round((random() * (max - min) + min) * p) / p;
    }
  };
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Raw answers shaped like the browser's payload (imperial units). */
function generateAnswers(h, now) {
  const r = h.chance(0.40) ? 0 : h.chance(0.58) ? 1 : 2;
  let trail = TRAILS[0];
  let roll = h.range(0, 1, 3);
  for (const t of TRAILS) {
    roll -= t.share;
    if (roll <= 0) { trail = t; break; }
  }

  // At least two seasons back, so every hike has ended before it is submitted.
  const year = now.getUTCFullYear() - 2 - r;
  const female = h.chance(0.38);
  const packType = h.pick(['framed', 'framed', 'framed', 'frameless']);
  const baseWeight = packType === 'frameless' ? h.range(7.5, 13.5, 1) : h.range(12, 22, 1);
  const dailyMiles = h.range(trail.dailyMiles[0], trail.dailyMiles[1], 1);
  const week1 = h.range(Math.max(8, dailyMiles - 7), dailyMiles - 3, 1);
  const week2 = h.range(week1 + 1, dailyMiles - 1, 1);
  const week3 = h.range(week2 + 0.5, dailyMiles + 1, 1);
  const week4 = h.range(week3, dailyMiles + 3, 1);
  const shortTrail = trail.miles < 1000;
  const zeros = shortTrail ? h.range(1, 6) : h.range(12, 30);
  const neros = shortTrail ? h.range(2, 8) : h.range(10, 26);

  let completionStatus = 'continuous_purist';
  let quitReason = 'not_applicable_completed';
  const statusRoll = h.range(0, 1, 3);
  if (statusRoll >= 0.82) {
    completionStatus = 'quit_early';
    quitReason = h.pick(['overuse_injury', 'severe_injury', 'mental_burnout_loneliness', 'budget_exhaustion', 'weather_wildfire_closure', 'family_personal_emergency']);
  } else if (statusRoll >= 0.70) {
    completionStatus = 'section_hike';
  } else if (statusRoll >= 0.62) {
    completionStatus = 'flip_flop';
    quitReason = 'weather_wildfire_closure';
  } else if (statusRoll >= 0.52) {
    completionStatus = 'skipped_sections';
    quitReason = 'weather_wildfire_closure';
  }

  const distance = completionStatus === 'quit_early'
    ? Math.round(trail.miles * h.range(0.1, 0.8, 2))
    : completionStatus === 'section_hike' ? Math.round(trail.miles * h.range(0.3, 0.9, 2)) : trail.miles;
  const hikingDays = Math.ceil(distance / dailyMiles);
  const startDate = `${year}-${String(h.range(trail.start[0], trail.start[1])).padStart(2, '0')}-${String(h.range(1, 28)).padStart(2, '0')}`;
  const endDate = addDays(startDate, hikingDays + zeros + neros - 1);
  const rampWeeksHiked = Math.min(4, Math.ceil(daysOnTrail(startDate, endDate) / 7));

  const injured = (completionStatus === 'quit_early' && /injury/.test(quitReason)) || h.chance(0.3);
  const injuryLocations = injured ? [h.pick(['knee_it_band', 'plantar_fasciitis_foot', 'shin_splints', 'achilles_tendon', 'stress_fracture', 'ankle_sprain'])] : [];
  const international = h.chance(0.22);
  const preTrailWeight = female ? h.range(115, 175) : h.range(145, 220);
  const sick = h.chance(0.2);
  const trainingSkipped = h.chance(0.1);
  const footwear = h.pick(['trail_runners', 'trail_runners', 'trail_runners', 'hiking_shoes', 'boots', 'sandals_minimalist']);
  const milesPerPair = footwear === 'boots' || footwear === 'hiking_shoes' ? h.range(550, 900) : h.range(350, 600);

  return {
    consent: true,
    trail: trail.name,
    hikeYear: year,
    direction: h.pick([...Array(3).fill(directionsFor(trail.name)[0]), directionsFor(trail.name)[1], 'Flip-flop']),
    startDate,
    endDate,
    totalDistanceMiles: distance,
    totalElevationGainFt: Math.round(distance * h.range(120, 190)),
    age: h.range(20, 58),
    biologicalSex: female ? 'female' : 'male',
    heightInches: female ? h.range(60, 71) : h.range(66, 76),
    homeRegion: international ? h.pick(['western_europe', 'western_europe', 'north_america', 'oceania', 'eastern_europe', 'asia']) : 'north_america',
    neededVisa: international && trail.name !== 'TMB' ? h.chance(0.8) : false,
    preTrailWeightLbs: preTrailWeight,
    preTrailFitnessRating: h.range(4, 9),
    priorExperience: h.pick(['none', 'weekend_trips', 'multi_week_trips', 'previous_thru_hike']),
    startGroup: h.pick(['solo', 'solo', 'partner', 'group']),
    trainedBeforeHike: !trainingSkipped,
    trainingFocus: trainingSkipped ? null : h.range(0.2, 0.8, 2),
    priorInjuryHistory: h.chance(0.25),
    priorInjuryAreas: [h.pick(['knee', 'ankle', 'foot', 'hip', 'back'])],
    totalBudget: h.range(45, 135) * 100,
    budgetCurrency: h.chance(0.25) ? 'EUR' : 'USD',
    baseWeightLbs: baseWeight,
    maxHeavyLoadLbs: h.range(baseWeight + 12, baseWeight + 28, 1),
    footwearCategory: footwear,
    shoePairsUsed: Math.max(1, Math.round(distance / milesPerPair)),
    trekkingPoleUsage: h.pick(['two_poles', 'two_poles', 'two_poles', 'one_pole', 'no_poles']),
    waterFiltration: h.pick(['water_filter', 'water_filter', 'water_filter', 'chemical_drops', 'combination', 'none']),
    backpackType: packType,
    cookSystem: h.pick(['stove_cooked', 'stove_cooked', 'cold_soaking', 'hybrid']),
    sleepPadType: h.pick(['inflatable', 'inflatable', 'inflatable', 'foam_closed_cell', 'both_hybrid']),
    sleepLocation: h.chance(0.9) ? 'own_system' : 'huts_refuges',
    shelterType: h.pick(['tent', 'tent', 'tent', 'tarp', 'hammock']),
    sleepInsulation: h.chance(0.65) ? 'quilt' : 'sleeping_bag',
    averageCalories: h.range(25, 50) * 100,
    resupplyStrategy: h.pick(['bought_along_the_way', 'bought_along_the_way', 'mix', 'mostly_mail_drops']),
    trailDiet: h.pick([...Array(8).fill('omnivore'), 'vegetarian', 'vegan']),
    rampWeeksHiked,
    week1DailyMiles: week1,
    week2DailyMiles: rampWeeksHiked >= 2 ? week2 : null,
    week3DailyMiles: rampWeeksHiked >= 3 ? week3 : null,
    week4DailyMiles: rampWeeksHiked >= 4 ? week4 : null,
    totalZeroDays: zeros,
    totalNeroDays: neros,
    hoursSleepPerNight: h.range(6.5, 9.5, 1),
    sleepQualityRating: h.range(5, 9),
    painkillerUse: injured ? h.pick(['sometimes', 'daily', 'daily']) : h.pick(['never', 'never', 'sometimes', 'sometimes', 'daily']),
    percentHikingAlone: h.range(20, 85),
    hadCompletionDeadline: h.chance(0.35),
    deadlineReasons: [h.pick(['return_flight', 'job_school', 'visa', 'weather_window'])],
    completionStatus,
    quitReason,
    consideredQuitting: completionStatus === 'quit_early'
      ? h.pick(['once_or_twice', 'several_times', 'several_times', 'almost_constantly'])
      : h.pick(['never', 'never', 'once_or_twice', 'once_or_twice', 'several_times', 'almost_constantly']),
    severeInjuryOccurred: injured,
    injuryLocations,
    injuryMilestoneMiles: injured ? Math.round(distance * h.range(0.1, 0.9, 2)) : null,
    gotSick: sick,
    illnessTypes: [h.pick(['norovirus_gi', 'giardia', 'cold_flu_respiratory', 'covid'])],
    illnessEpisodes: h.range(1, 3),
    postTrailWeightLbs: Math.round(preTrailWeight * h.range(0.88, 0.97, 2)),
    overallEnjoymentRating: completionStatus === 'quit_early' ? h.range(4, 8) : h.range(7, 10),
    // Some hikers do not remember the harder numbers.
    unknownAnswers: ['totalElevationGainFt', 'averageCalories', 'week2DailyMiles', 'week3DailyMiles', 'shoePairsUsed'].filter(() => h.chance(0.12))
  };
}

/**
 * Generate `count` validated, synthetic survey documents.
 * @param options.seed  PRNG seed (default 42)
 * @param options.now   reference date (default: now)
 */
function generateSyntheticHikers(count, options) {
  const opts = options || {};
  const now = opts.now || new Date();
  const h = createHelpers(createRandom(opts.seed === undefined ? 42 : opts.seed));

  return Array.from({ length: count }, (_, i) => {
    const answers = generateAnswers(h, now);
    // Spread submissions over the last 30 days.
    const submittedAt = new Date(now.getTime() - Math.round(h.range(0, 30 * 24, 2) * 3600 * 1000));
    const result = validateSurvey(answers, { now: submittedAt });
    if (!result.isValid) {
      throw new Error(`Synthetic hiker #${i} failed validation: ${result.errors.join('; ')}`);
    }
    return Object.assign(result.data, { isSynthetic: true });
  });
}

module.exports = { generateSyntheticHikers, generateAnswers, createRandom, createHelpers };
