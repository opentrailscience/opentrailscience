/**
 * Survey schema: the single source of truth for every survey field.
 *
 * Loaded in two places:
 *   - the browser (as window.SurveySchema) to build the payload, convert units
 *     and validate each wizard step;
 *   - Node (require) by the Netlify functions, export, seed and docs scripts.
 *
 * Adding a field here makes it flow through validation, storage, the CSV
 * export and the data dictionary automatically. The form input itself still
 * has to be added to public/index.html (test/html-sync.test.js checks that).
 *
 * Storage conventions:
 *   - Numbers are stored in imperial units; fields with `metricName` also get
 *     a metric copy (e.g. heightInches + heightCm).
 *   - Every question must be answered (fields are required unless marked
 *     `optional`); the wizard does not continue until they are. Questions
 *     marked `allowUnknown` can be answered "Don't know": the value is null
 *     and the field name is listed in `unknownAnswers`.
 *   - null / [] means "does not apply": conditional fields (`when`) whose
 *     condition is false, e.g. week 3 mileage for a two-week hike. Never 0 or a guess.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SurveySchema = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Published in the data dictionary and on the dataset page. Newest first.
  const CHANGELOG = [
    { version: '1.0.0', date: '2026-10-17', changes: ['First public version.'] }
  ];
  const SCHEMA_VERSION = CHANGELOG[0].version;

  const MAX_DAILY_MILES = 100;

  // Canonical (stored) unit -> metric unit and multiplication factor.
  const UNITS = {
    in: { label: 'in', metric: 'cm', factor: 2.54 },
    lb: { label: 'lbs', metric: 'kg', factor: 0.45359237 },
    mi: { label: 'mi', metric: 'km', factor: 1.60934 },
    ft: { label: 'ft', metric: 'm', factor: 0.3048 },
    'mi/day': { label: 'mi/day', metric: 'km/day', factor: 1.60934 }
  };

  const TRAILS = [
    'PCT', 'AT', 'CDT', 'CT', 'AZT', 'JMT', 'TRT', 'PNT', 'Long Trail', 'Hayduke', 'FT', 'IAT', 'BMT', 'SHT',
    'CDS', 'TMB', 'WHW', 'GR20', 'GR10', 'HEX', 'VIA', 'AV1', 'KUN', 'C2C', 'TA',
    'Other North America', 'Other Europe', 'Other'
  ];

  // Short names for prose ("Camino hikers", "my 2025 Te Araroa thru-hike").
  const TRAIL_NAMES = {
    PCT: 'PCT', AT: 'AT', CDT: 'CDT', CT: 'Colorado Trail', AZT: 'Arizona Trail', JMT: 'JMT', TRT: 'Tahoe Rim Trail',
    PNT: 'PNT', 'Long Trail': 'Long Trail', Hayduke: 'Hayduke', CDS: 'Camino', TMB: 'Tour du Mont Blanc',
    WHW: 'West Highland Way', GR20: 'GR20', TA: 'Te Araroa', KUN: 'Kungsleden', C2C: 'Coast to Coast', SHT: 'Superior Hiking Trail',
    GR10: 'GR10', HEX: 'Hexatrek', VIA: 'Via Alpina', AV1: 'Alta Via 1', FT: 'Florida Trail', IAT: 'Ice Age Trail', BMT: 'Benton MacKaye Trail'
  };

  /**
   * Which ways a trail can be hiked: the two main directions offered in the
   * form. East-west trails, loops and the Camino have their own; everything
   * else is NOBO/SOBO. Flip-flop and Section are always offered too.
   */
  const TRAIL_DIRECTIONS = {
    PNT: ['WEBO', 'EABO'], C2C: ['EABO', 'WEBO'], GR10: ['EABO', 'WEBO'], VIA: ['WEBO', 'EABO'], IAT: ['WEBO', 'EABO'],
    TMB: ['CCW', 'CW'], TRT: ['CW', 'CCW'],
    CDS: ['TO_SANTIAGO', 'FROM_SANTIAGO']
  };
  const DIRECTION_LABELS = {
    NOBO: ['NOBO', 'Northbound'], SOBO: ['SOBO', 'Southbound'],
    EABO: ['EABO', 'Eastbound'], WEBO: ['WEBO', 'Westbound'],
    CW: ['Clockwise', 'Loop'], CCW: ['Counter-clockwise', 'Loop'],
    TO_SANTIAGO: ['To Santiago', 'Towards the cathedral'], FROM_SANTIAGO: ['From Santiago', 'Away from it']
  };
  function directionsFor(trail) {
    return TRAIL_DIRECTIONS[trail] || ['NOBO', 'SOBO'];
  }

  /** Display name of a trail code; null for the "Other" choices (custom trail names are not collected). */
  function trailName(code) {
    if (!code || String(code).startsWith('Other')) return null;
    return TRAIL_NAMES[code] || code || null;
  }

  const COMPLETION_LABELS = {
    continuous_purist: 'Continuous hike',
    flip_flop: 'Flip-flop, every mile',
    skipped_sections: 'Skipped parts',
    section_hike: 'Section hike',
    quit_early: 'Ended early'
  };

  // Statuses for which the hiker is asked why they left, skipped or flipped.
  const STATUSES_WITH_QUIT_REASON = ['quit_early', 'flip_flop', 'skipped_sections'];
  // Statuses counted as "completed" (every mile hiked) in the public stats.
  const COMPLETED_STATUSES = ['continuous_purist', 'flip_flop'];

  // Short labels for charts; the form shows longer ones.
  const INJURY_LABELS = {
    knee_it_band: 'Knee / IT band',
    plantar_fasciitis_foot: 'Plantar fasciitis / foot',
    shin_splints: 'Shin splints',
    stress_fracture: 'Stress fracture',
    achilles_tendon: 'Achilles tendonitis',
    ankle_sprain: 'Ankle sprain',
    extensor_tendonitis: 'Extensor tendonitis',
    foot_numbness_nerve: 'Foot numbness / nerve',
    hip_flexor: 'Hip / hip flexor',
    back_spine: 'Back / spine',
    fall_trauma: 'Fall or trauma',
    blisters_severe: 'Severe blisters',
    other: 'Other'
  };
  const INJURY_LOCATIONS = Object.keys(INJURY_LABELS);

  const ILLNESS_TYPES = [
    'norovirus_gi', 'giardia', 'cold_flu_respiratory', 'covid', 'tick_borne', 'heat_illness', 'hypothermia', 'altitude_sickness', 'other'
  ];

  const HOME_REGIONS = [
    'north_america', 'latin_america', 'western_europe', 'eastern_europe', 'africa', 'middle_east', 'asia', 'oceania'
  ];

  /**
   * The busiest trails in the survey, with starts bunched into a main season
   * (some see a few hundred thru-hikers a year, most far more). On these, a start week
   * plus age band, sex and region still matches many hikers, so dates are
   * published as ISO weeks. Every other trail (and "Other") is published with
   * month precision, distance rounded to 10 mi and days on trail rounded to
   * whole weeks, so a hike can't be singled out among a few dozen hikers.
   */
  const POPULAR_TRAILS = ['PCT', 'AT', 'CDT', 'CT', 'AZT', 'JMT', 'Long Trail', 'CDS', 'TMB', 'WHW', 'GR20', 'TA'];

  // Version of the consent text shown before the survey; stored with each record.
  const CONSENT_VERSION = '1';

  /**
   * Field definitions, in storage / CSV column order.
   *
   *   name        property name
   *   label       human label used in error messages and the data dictionary
   *   type        'enum' | 'number' | 'integer' | 'boolean' | 'string' | 'date' | 'enumArray'
   *   step        wizard step (1-5) the question is on; omitted for derived fields
   *   input       id of the form element holding the answer
   *   optional    true if the question may be left blank (default: required)
   *   question    the exact question shown in the form (data dictionary)
   *   questionFrom for a derived column, the asked field whose question it answers
   *   requiredMessage  error shown when the answer is missing
   *   allowUnknown     the hiker may answer "Don't know" (hard-to-remember numbers)
   *   when        function (data) => boolean; when false the question is not asked
   *               and stored empty; when true it is required like any other
   *   store       false for answers that are validated and used for derived
   *               values but never stored or published (exact dates, exact age)
   *   publish     function (value, data) => stored value (coarsening)
   *   min/max     numeric bounds in the stored unit (max may be a function)
   *   values      allowed values for enum / enumArray
   *   unit        stored unit (key of UNITS); the form converts metric input
   *   metricName  name of the extra metric column written next to this one
   *   decimals    rounding when stored (number default 1, integer 0)
   *   check       function (value, data, ctx) => error message | null
   *   derived     function (data, ctx) => value, computed instead of asked
   *   role        ML role, shown in the data dictionary
   */
  const FIELDS = [
    // --- Consent (asked before step 1, never stored itself) ---
    {
      name: 'consent', question: 'I am 18 or older and I agree that my answers, including health information, are stored and published as an open dataset as described above and on the privacy page.', label: 'Consent', type: 'boolean', store: false,
      requiredMessage: 'Please confirm that you are 18 or older and agree to how your answers are published',
      check: value => (value === true ? null : 'Please confirm that you are 18 or older and agree to how your answers are published')
    },
    {
      name: 'consentVersion', label: 'Consent version', type: 'string', role: 'Metadata',
      derived: d => (d.consent === true ? CONSENT_VERSION : null),
      description: 'Version of the consent text the hiker agreed to before starting.'
    },

    // --- Pillar 1: Trail & journey metadata ---
    { name: 'trail', question: 'Which long-distance trail did you hike?', label: 'Trail', type: 'enum', step: 1, input: 'field-trail', values: TRAILS, role: 'Categorical feature' },
    {
      name: 'hikeYear', question: 'Year of the hike', label: 'Year of the hike', type: 'integer', step: 1, input: 'field-hikeYear',
      min: 1970, max: ctx => ctx.now.getUTCFullYear() + 1, role: 'Temporal feature'
    },
    {
      name: 'direction', question: 'Direction', label: 'Direction', type: 'enum', step: 1, input: 'field-direction',
      values: [...Object.keys(DIRECTION_LABELS), 'Flip-flop', 'Section'], role: 'Categorical feature',
      check: (value, d) => (['Flip-flop', 'Section'].includes(value) || directionsFor(d.trail).includes(value)
        ? null : 'Please pick a direction for this trail'),
      description: 'NOBO/SOBO on most trails; EABO/WEBO on east-west trails, CW/CCW on loops, TO_SANTIAGO/FROM_SANTIAGO on the Camino.'
    },
    {
      name: 'startDate', question: 'Start date', label: 'Start date', type: 'date', step: 1, input: 'field-startDate', store: false,
      check: (value, d) => {
        if (!d.hikeYear) return null;
        const startYear = Number(value.slice(0, 4));
        // Allow seasons that straddle New Year (e.g. Te Araroa, SOBO winter starts).
        if (Math.abs(startYear - d.hikeYear) > 1) {
          return `Start date (${value}) does not match the ${d.hikeYear} hike year`;
        }
        return null;
      }
    },
    {
      name: 'endDate', question: 'End date (finish, or the day you left)', label: 'End date', type: 'date', step: 1, input: 'field-endDate', store: false,
      check: (value, d, ctx) => {
        if (d.startDate && value < d.startDate) return 'End date cannot be before the start date';
        // The survey is about finished (or abandoned) hikes. One day of slack for time zones.
        const latest = new Date(ctx.now.getTime() + 86400000).toISOString().slice(0, 10);
        return value > latest ? 'End date cannot be in the future' : null;
      }
    },
    {
      name: 'datePrecision', label: 'Date precision', type: 'enum', values: ['week', 'month'], role: 'Metadata',
      derived: d => datePrecision(d.trail),
      description: '"week" on popular trails, "month" on small trails and "Other" (see the privacy page).'
    },
    {
      name: 'startWeek', questionFrom: 'startDate', label: 'Start week', type: 'string', role: 'Temporal feature',
      derived: d => (datePrecision(d.trail) === 'week' ? isoWeek(d.startDate) : null),
      description: 'ISO 8601 week of the start date (e.g. 2025-W16). Null when datePrecision is "month".'
    },
    {
      name: 'startMonth', questionFrom: 'startDate', label: 'Start month', type: 'string', role: 'Temporal feature',
      derived: d => d.startDate.slice(0, 7),
      description: 'Month of the start date (YYYY-MM).'
    },
    {
      name: 'endWeek', questionFrom: 'endDate', label: 'End week', type: 'string', role: 'Temporal feature',
      derived: d => (datePrecision(d.trail) === 'week' ? isoWeek(d.endDate) : null),
      description: 'ISO 8601 week of the end date. Null when datePrecision is "month".'
    },
    {
      name: 'endMonth', questionFrom: 'endDate', label: 'End month', type: 'string', role: 'Temporal feature',
      derived: d => d.endDate.slice(0, 7),
      description: 'Month of the end date (YYYY-MM).'
    },
    {
      name: 'daysOnTrail', label: 'Days on trail', type: 'integer', role: 'Continuous feature',
      derived: d => publishedDays(d),
      description: 'Start and end date inclusive. Rounded to whole weeks when datePrecision is "month".'
    },
    {
      name: 'monthsSinceTrail', label: 'Months since leaving the trail', type: 'integer', role: 'Recency-bias control',
      derived: (d, ctx) => monthsBetween(d.endDate, ctx.now.toISOString().slice(0, 10)),
      description: 'Whole months from the end date to the submission date.'
    },
    {
      name: 'totalDistanceMiles', question: 'Total distance hiked (miles or km)', label: 'Total distance hiked', type: 'number', step: 1, input: 'field-totalDistance',
      min: 0, max: 10000, unit: 'mi', metricName: 'totalDistanceKm', role: 'Continuous feature',
      publish: (value, d) => publishedDistance(d),
      description: 'Rounded to the nearest 10 mi when datePrecision is "month".',
      check: (value, d, ctx) => {
        const pace = computeAverageDailyMiles(d);
        if (pace !== null && pace > MAX_DAILY_MILES) {
          return `Total distance and dates work out to ${formatQuantity(pace, 'mi/day', ctx.unitSystem)}, ` +
            `above the ${formatQuantity(MAX_DAILY_MILES, 'mi/day', ctx.unitSystem)} limit. Please check your distance and dates`;
        }
        return null;
      }
    },
    { name: 'totalElevationGainFt', question: 'Total elevation gain (feet or metres)', allowUnknown: true, label: 'Total elevation gain', type: 'integer', step: 1, input: 'field-totalElevationGain', min: 0, max: 2000000, unit: 'ft', metricName: 'totalElevationGainM', role: 'Continuous feature' },

    // --- Pillar 2: Demographics & baseline ---
    {
      name: 'age', question: 'How old were you when you started this hike?', label: 'Age at the start of the hike', type: 'integer', step: 2, input: 'field-age', min: 5, max: 99, store: false,
      requiredMessage: 'Please enter how old you were when you started this hike'
    },
    {
      name: 'ageBand', questionFrom: 'age', label: 'Age band', type: 'enum', role: 'Ordinal predictor',
      values: ['20-and-under', '21-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70+'],
      derived: d => ageBand(d.age),
      description: 'Age at the start of the hike: one band for 20 and under, then 21-24 and 5-year bands from 25-29.'
    },
    { name: 'biologicalSex', question: 'Biological sex', label: 'Biological sex', type: 'enum', step: 2, input: 'field-biologicalSex', values: ['male', 'female', 'prefer_not_to_say'], role: 'Categorical feature' },
    { name: 'heightInches', question: 'Height (feet and inches, or cm)', label: 'Height', type: 'number', step: 2, input: 'field-height', min: 40, max: 90, unit: 'in', metricName: 'heightCm', role: 'Continuous predictor' },
    {
      name: 'homeRegion', question: 'Home region', label: 'Home region', type: 'enum', step: 2, input: 'field-homeRegion', values: HOME_REGIONS, role: 'Categorical feature',
      description: 'World region of residence. The exact country is never collected.'
    },
    { name: 'neededVisa', question: 'Did you need a visa for this hike?', label: 'Needed a visa for the hike', type: 'boolean', step: 2, input: 'field-neededVisa', requiredMessage: 'Please say whether you needed a visa for this hike', role: 'Binary feature' },
    { name: 'preTrailWeightLbs', question: 'Body weight before the hike (lbs or kg)', label: 'Body weight before the hike', type: 'number', step: 2, input: 'field-weight', min: 60, max: 450, unit: 'lb', metricName: 'preTrailWeightKg', role: 'Continuous predictor' },
    { name: 'preTrailFitnessRating', question: 'Fitness before the hike (1 to 10)', label: 'Fitness before the hike', type: 'integer', step: 2, input: 'field-preTrailFitnessRating', min: 1, max: 10, role: 'Ordinal predictor' },
    { name: 'priorExperience', question: 'Backpacking experience before this hike', label: 'Backpacking experience before this hike', type: 'enum', step: 2, input: 'field-priorExperience', values: ['none', 'weekend_trips', 'multi_week_trips', 'previous_thru_hike'], role: 'Ordinal predictor' },
    { name: 'startGroup', question: 'Did you start the hike alone or with others?', label: 'Start group', type: 'enum', step: 2, input: 'field-startGroup', values: ['solo', 'partner', 'group'], role: 'Categorical feature' },
    {
      name: 'trainedBeforeHike', question: "I didn't train at all for this hike", label: 'Trained before the hike', type: 'boolean', step: 2, input: 'field-trainedBeforeHike',
      requiredMessage: "Please move the training slider, or tick \"I didn't train at all\"", role: 'Binary predictor',
      description: 'false only when the hiker ticked that they did not train at all; any training, however little, is true.'
    },
    {
      name: 'trainingFocus', question: 'How did you train before the hike?', label: 'Training focus (0 = cardio, 1 = strength)', type: 'number', step: 2, input: 'field-trainingFocus',
      min: 0, max: 1, decimals: 2, role: 'Continuous predictor', when: d => d.trainedBeforeHike === true,
      description: 'null when trainedBeforeHike is false (did not train), never a special value.'
    },
    { name: 'priorInjuryHistory', question: 'Injuries before the hike?', label: 'Prior injury history', type: 'boolean', step: 2, input: 'field-priorInjuryHistory', role: 'Binary predictor' },
    {
      name: 'priorInjuryAreas', question: 'Where was it? (select all that apply)', label: 'Prior injury areas', type: 'enumArray', step: 2, values: ['knee', 'ankle', 'foot', 'hip', 'back', 'shoulder', 'other'],
      requiredMessage: 'Please select where your prior injury was', when: d => d.priorInjuryHistory === true, role: 'Multi-label predictor'
    },
    {
      name: 'totalBudget', question: 'Total cost of the hike', allowUnknown: true, label: 'Total cost of the hike', type: 'integer', step: 2, input: 'field-totalBudget',
      min: 0, max: 100000, role: 'Continuous predictor', description: 'In budgetCurrency, as entered; no exchange rate is applied.'
    },
    {
      name: 'budgetCurrency', question: 'Total cost of the hike (currency: USD or EUR)', label: 'Budget currency', type: 'enum', step: 2, input: 'field-budgetCurrency', values: ['USD', 'EUR'],
      when: d => typeof d.totalBudget === 'number', requiredMessage: 'Please pick the currency of your budget', role: 'Categorical feature'
    },

    // --- Pillar 3: Gear & physical load ---
    { name: 'baseWeightLbs', question: 'Base weight (lbs or kg)', label: 'Base weight', type: 'number', step: 3, input: 'field-baseWeight', min: 2, max: 75, unit: 'lb', metricName: 'baseWeightKg', role: 'Continuous predictor' },
    {
      name: 'maxHeavyLoadLbs', question: 'Heaviest pack weight (lbs or kg)', allowUnknown: true, label: 'Heaviest pack weight', type: 'number', step: 3, input: 'field-maxHeavyLoad', min: 2, max: 130,
      unit: 'lb', metricName: 'maxHeavyLoadKg', role: 'Continuous predictor',
      check: (value, d) => (d.baseWeightLbs && value < d.baseWeightLbs ? 'Your heaviest pack can\'t weigh less than your base weight' : null)
    },
    { name: 'footwearCategory', question: 'Main footwear', label: 'Main footwear', type: 'enum', step: 3, input: 'field-footwearCategory', values: ['trail_runners', 'hiking_shoes', 'boots', 'sandals_minimalist', 'other'], role: 'Categorical feature' },
    {
      name: 'shoePairsUsed', question: 'How many pairs of shoes did you go through?', allowUnknown: true, label: 'Pairs of shoes used', type: 'integer', step: 3, input: 'field-shoePairsUsed',
      min: 1, max: 20, role: 'Gear wear feature', description: 'Including the pair the hiker started in. totalDistanceMiles / shoePairsUsed gives miles per pair.'
    },
    { name: 'trekkingPoleUsage', question: 'Trekking poles', label: 'Trekking pole usage', type: 'enum', step: 3, input: 'field-trekkingPoleUsage', values: ['two_poles', 'one_pole', 'no_poles'], role: 'Categorical feature' },
    { name: 'waterFiltration', question: 'Water treatment: filter or chemicals', label: 'Water treatment', type: 'enum', step: 3, input: 'field-waterFiltration', values: ['water_filter', 'chemical_drops', 'uv_purifier', 'boil_only', 'none', 'combination'], role: 'Categorical feature' },
    { name: 'backpackType', question: 'Backpack: framed or frameless', label: 'Backpack type', type: 'enum', step: 3, input: 'field-backpackType', values: ['framed', 'frameless'], role: 'Binary category' },
    { name: 'cookSystem', question: 'Cooking: stove or cold soaking', label: 'Cook system', type: 'enum', step: 3, input: 'field-cookSystem', values: ['stove_cooked', 'cold_soaking', 'no_cook_packaged', 'hybrid'], role: 'Categorical feature' },
    { name: 'sleepPadType', question: 'Sleeping pad: inflatable or foam', label: 'Sleeping pad', type: 'enum', step: 3, input: 'field-sleepPadType', values: ['inflatable', 'foam_closed_cell', 'both_hybrid', 'hammock_underquilt', 'none'], role: 'Categorical feature' },
    { name: 'sleepLocation', question: 'Where did you sleep most nights?', label: 'Sleep location', type: 'enum', step: 3, input: 'field-sleepLocation', values: ['own_system', 'huts_refuges'], role: 'Categorical feature' },
    { name: 'shelterType', question: 'Shelter: tent or tarp', label: 'Shelter', type: 'enum', step: 3, input: 'field-shelterType', values: ['tent', 'tarp', 'hammock'], when: d => d.sleepLocation === 'own_system', role: 'Categorical feature' },
    { name: 'sleepInsulation', question: 'Quilt or sleeping bag', label: 'Quilt or sleeping bag', type: 'enum', step: 3, input: 'field-sleepInsulation', values: ['quilt', 'sleeping_bag'], when: d => d.sleepLocation === 'own_system', role: 'Binary category' },
    { name: 'averageCalories', question: 'Calories eaten per day (average)', allowUnknown: true, label: 'Calories eaten per day', type: 'integer', step: 3, input: 'field-averageCalories', min: 0, max: 15000, role: 'Continuous predictor' },
    {
      name: 'resupplyStrategy', question: 'How did you resupply?', label: 'Resupply strategy', type: 'enum', step: 3, input: 'field-resupplyStrategy',
      values: ['bought_along_the_way', 'mostly_mail_drops', 'mix'], role: 'Categorical feature',
      description: 'bought_along_the_way includes towns, trail stores and food bought at huts.'
    },
    { name: 'trailDiet', question: 'Did you eat vegetarian or vegan on trail?', label: 'Diet on trail', type: 'enum', step: 3, input: 'field-trailDiet', values: ['omnivore', 'vegetarian', 'vegan'], role: 'Categorical feature' },

    // --- Pillar 4: In-trail decisions & behaviour ---
    {
      name: 'rampWeeksHiked', question: 'How long was your hike?', label: 'Weeks hiked (for the ramp-up)', type: 'integer', step: 4, input: 'field-rampWeeksHiked', min: 1, max: 4,
      role: 'Ramp-rate context', description: '4 means four weeks or more. Week columns beyond this value are null.',
      check: (value, d) => {
        const days = daysOnTrail(d.startDate, d.endDate);
        if (days === null) return null;
        const expected = Math.min(4, Math.ceil(days / 7));
        if (value === expected) return null;
        return expected === 4
          ? `Your dates cover ${days} days on trail, so please choose "4+ weeks" for the ramp-up`
          : `Your dates cover ${days} days on trail, so please choose ${expected} week${expected === 1 ? '' : 's'} for the ramp-up`;
      }
    },
    { name: 'week1DailyMiles', question: 'Week 1 (mi/day or km/day)', allowUnknown: true, label: 'Week 1 daily distance', type: 'number', step: 4, input: 'field-week1DailyMiles', min: 0, max: MAX_DAILY_MILES, unit: 'mi/day', role: 'Ramp-rate time series' },
    { name: 'week2DailyMiles', question: 'Week 2 (mi/day or km/day)', allowUnknown: true, label: 'Week 2 daily distance', type: 'number', step: 4, input: 'field-week2DailyMiles', min: 0, max: MAX_DAILY_MILES, unit: 'mi/day', when: d => d.rampWeeksHiked >= 2, role: 'Ramp-rate time series' },
    { name: 'week3DailyMiles', question: 'Week 3 (mi/day or km/day)', allowUnknown: true, label: 'Week 3 daily distance', type: 'number', step: 4, input: 'field-week3DailyMiles', min: 0, max: MAX_DAILY_MILES, unit: 'mi/day', when: d => d.rampWeeksHiked >= 3, role: 'Ramp-rate time series' },
    { name: 'week4DailyMiles', question: 'Week 4 (mi/day or km/day)', allowUnknown: true, label: 'Week 4 daily distance', type: 'number', step: 4, input: 'field-week4DailyMiles', min: 0, max: MAX_DAILY_MILES, unit: 'mi/day', when: d => d.rampWeeksHiked >= 4, role: 'Ramp-rate time series' },
    {
      name: 'averageDailyMiles', label: 'Average daily distance', type: 'number', unit: 'mi/day', role: 'Continuous feature',
      derived: d => publishedPace(d),
      description: 'totalDistanceMiles / daysOnTrail, computed from the published (rounded) values so it does not reveal the exact duration.'
    },
    {
      name: 'totalZeroDays', question: 'Zero days (full rest days)', label: 'Zero days', type: 'integer', step: 4, input: 'field-totalZeroDays', min: 0, max: 150, role: 'Recovery feature',
      check: (value, d) => {
        const days = daysOnTrail(d.startDate, d.endDate);
        const total = value + (d.totalNeroDays || 0);
        return days !== null && total > days
          ? `Zero and nero days (${total}) cannot exceed your ${days} days on trail`
          : null;
      }
    },
    {
      name: 'totalNeroDays', question: 'Nero days (short hiking days)', allowUnknown: true, label: 'Nero days', type: 'integer', step: 4, input: 'field-totalNeroDays', min: 0, max: 150, role: 'Recovery feature',
      description: 'Short hiking days ("near zero"), roughly under 10 mi / 16 km, e.g. into or out of town. Zero days are not counted here.'
    },
    { name: 'hoursSleepPerNight', question: 'Hours of sleep per night (average)', allowUnknown: true, label: 'Hours of sleep per night', type: 'number', step: 4, input: 'field-hoursSleepPerNight', min: 3, max: 16, role: 'Recovery feature' },
    { name: 'sleepQualityRating', question: 'Sleep quality (0 to 10)', label: 'Sleep quality', type: 'integer', step: 4, input: 'field-sleepQualityRating', min: 0, max: 10, role: 'Ordinal feature' },
    {
      name: 'painkillerUse', question: 'How often did you take painkillers such as ibuprofen?', label: 'Painkiller use', type: 'enum', step: 4, input: 'field-painkillerUse',
      values: ['never', 'sometimes', 'daily'], role: 'Ordinal feature',
      description: 'Over-the-counter painkillers (ibuprofen, naproxen, paracetamol/acetaminophen). daily means daily or almost daily.'
    },
    { name: 'percentHikingAlone', question: 'How much of the time did you hike alone?', label: 'Share of the time hiking alone', type: 'integer', step: 4, input: 'field-percentHikingAlone', min: 0, max: 100, role: 'Continuous feature' },
    { name: 'hadCompletionDeadline', question: 'Did you have a fixed deadline to finish?', label: 'Hard completion deadline', type: 'boolean', step: 4, input: 'field-hadCompletionDeadline', role: 'Binary feature' },
    {
      name: 'deadlineReasons', question: 'What was the deadline? (select all that apply)', label: 'Deadline reasons', type: 'enumArray', step: 4, values: ['return_flight', 'job_school', 'visa', 'weather_window', 'money', 'other'],
      requiredMessage: 'Please select what your deadline was', when: d => d.hadCompletionDeadline === true, role: 'Multi-label feature'
    },

    // --- Pillar 5: Outcomes & targets ---
    {
      name: 'completionStatus', question: 'How did your hike end?', label: 'Completion status', type: 'enum', step: 5, input: 'field-completionStatus', values: Object.keys(COMPLETION_LABELS), role: 'Target (classification)',
      description: 'flip_flop hiked every mile out of order (counts as finished); skipped_sections reached the end but skipped parts.'
    },
    {
      name: 'quitReason', question: 'Main reason for leaving the trail, skipping parts or flip-flopping', label: 'Main reason for leaving the trail', type: 'enum', step: 5, input: 'field-quitReason',
      values: [
        'not_applicable_completed', 'severe_injury', 'overuse_injury', 'mental_burnout_loneliness', 'budget_exhaustion',
        'weather_wildfire_closure', 'family_personal_emergency', 'ran_out_of_time', 'other'
      ],
      // Only asked for quit / flip-flop; everyone else is stored as not applicable.
      normalize: (value, d) => (STATUSES_WITH_QUIT_REASON.includes(d.completionStatus) ? value : 'not_applicable_completed'),
      check: (value, d) => (d.completionStatus === 'quit_early' && value === 'not_applicable_completed'
        ? 'Please select the primary reason you left the trail'
        : null),
      role: 'Target (classification)'
    },
    {
      name: 'consideredQuitting', question: 'How often did you seriously think about quitting?', label: 'Seriously thought about quitting', type: 'enum', step: 5, input: 'field-consideredQuitting',
      values: ['never', 'once_or_twice', 'several_times', 'almost_constantly'], role: 'Ordinal outcome',
      description: 'How often the hiker seriously thought about quitting during the hike (also asked of hikers who went home early).'
    },
    { name: 'severeInjuryOccurred', question: 'Did you have an injury that changed your hike?', label: 'Severe injury occurred', type: 'boolean', step: 5, input: 'field-severeInjuryOccurred', role: 'Target (binary)' },
    { name: 'injuryLocations', question: 'What kind of injury? (select all that apply)', label: 'Injury types', type: 'enumArray', step: 5, values: INJURY_LOCATIONS, requiredMessage: 'Please select at least one injury category / location', when: d => d.severeInjuryOccurred === true, role: 'Target (multi-label)'
    },
    { name: 'injuryMilestoneMiles', question: 'After how many miles (or km) into the hike did the injury happen?', allowUnknown: true, label: 'Distance into the hike when the injury happened', type: 'number', step: 5, input: 'field-injuryMilestoneMiles', min: 0, max: 10000, unit: 'mi', metricName: 'injuryMilestoneKm', when: d => d.severeInjuryOccurred === true, role: 'Continuous feature' },
    { name: 'gotSick', question: 'Did you get sick on the trail?', label: 'Got sick on trail', type: 'boolean', step: 5, input: 'field-gotSick', role: 'Binary outcome' },
    {
      name: 'illnessTypes', question: 'What did you have? (select all that apply)', label: 'Illness types', type: 'enumArray', step: 5, values: ILLNESS_TYPES,
      requiredMessage: 'Please select what kind of illness you had', when: d => d.gotSick === true, role: 'Multi-label outcome'
    },
    {
      name: 'illnessEpisodes', question: 'How many separate times were you sick?', label: 'Times sick', type: 'integer', step: 5, input: 'field-illnessEpisodes', min: 1, max: 3,
      when: d => d.gotSick === true, role: 'Ordinal outcome', description: 'How many separate times; 3 means three or more.'
    },
    { name: 'postTrailWeightLbs', question: 'Body weight after the hike (lbs or kg)', label: 'Body weight after the hike', type: 'number', step: 5, input: 'field-postTrailWeight', min: 50, max: 500, unit: 'lb', metricName: 'postTrailWeightKg', role: 'Continuous outcome' },
    { name: 'overallEnjoymentRating', question: 'How much did you enjoy the hike overall? (1 to 10)', label: 'Enjoyment of the hike', type: 'integer', step: 5, input: 'field-overallEnjoymentRating', min: 1, max: 10, role: 'Target (regression)' },
    {
      name: 'surveyMinutesBand', label: 'Time taken for the survey', type: 'enum', role: 'Data quality',
      values: ['under-5', '5-10', '10-20', '20-40', '40+'],
      derived: (d, ctx) => surveyMinutesBand(ctx.formElapsedSeconds),
      description: 'Roughly how many minutes passed between opening the survey and submitting it. Very short times can mean rushed answers; long ones include breaks.'
    },
    {
      name: 'unknownAnswers', label: 'Answered "Don\'t know"', type: 'enumArray', optional: true, values: [], role: 'Missing-data indicator',
      description: 'Names of the questions answered "Don\'t know" (their value is null). A null that is not listed here means the question did not apply.'
    }
  ];

  const FIELDS_BY_NAME = Object.fromEntries(FIELDS.map(f => [f.name, f]));
  const UNKNOWN_FIELDS = FIELDS.filter(f => f.allowUnknown).map(f => f.name);
  FIELDS_BY_NAME.unknownAnswers.values = UNKNOWN_FIELDS;
  const STORED_FIELDS = FIELDS.filter(f => f.store !== false);

  // Columns of the stored and public dataset (CSV header order). They are the same.
  const PUBLIC_COLUMNS = ['schemaVersion'].concat(
    ...STORED_FIELDS.map(f => (f.metricName ? [f.name, f.metricName] : [f.name]))
  );

  // --- Helpers ---------------------------------------------------------------

  function round(value, decimals) {
    const p = Math.pow(10, decimals);
    return Math.round(value * p) / p;
  }

  function decimalsOf(field) {
    if (field.decimals !== undefined) return field.decimals;
    return field.type === 'integer' ? 0 : 1;
  }

  function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === value;
  }

  /** Days on trail, counting start and end date inclusively. Null if not computable. */
  function daysOnTrail(startDate, endDate) {
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) return null;
    const ms = Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z');
    return Math.round(ms / 86400000) + 1;
  }

  /** Whole calendar months from one YYYY-MM-DD date to a later one (0 if not later). */
  function monthsBetween(fromDate, toDate) {
    if (!isIsoDate(fromDate) || !isIsoDate(toDate)) return null;
    const [y1, m1, d1] = fromDate.split('-').map(Number);
    const [y2, m2, d2] = toDate.split('-').map(Number);
    return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
  }

  function datePrecision(trail) {
    return POPULAR_TRAILS.includes(trail) ? 'week' : 'month';
  }

  /** ISO 8601 week of a YYYY-MM-DD date, e.g. "2025-W16" (week-year may differ near New Year). */
  function isoWeek(isoDate) {
    const date = new Date(isoDate + 'T00:00:00Z');
    const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
    date.setUTCDate(date.getUTCDate() - weekday + 3); // Thursday of this week
    const weekYear = date.getUTCFullYear();
    const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
    firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
    const week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
    return `${weekYear}-W${String(week).padStart(2, '0')}`;
  }

  function surveyMinutesBand(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
    const minutes = seconds / 60;
    if (minutes < 5) return 'under-5';
    if (minutes < 10) return '5-10';
    if (minutes < 20) return '10-20';
    if (minutes < 40) return '20-40';
    return '40+';
  }

  function ageBand(age) {
    if (typeof age !== 'number') return null;
    if (age <= 20) return '20-and-under';
    if (age < 25) return '21-24';
    if (age >= 70) return '70+';
    const low = Math.floor(age / 5) * 5;
    return `${low}-${low + 4}`;
  }

  /** Days on trail as published: whole weeks on small trails. */
  function publishedDays(d) {
    const days = daysOnTrail(d.startDate, d.endDate);
    if (days === null || datePrecision(d.trail) === 'week') return days;
    return Math.max(7, Math.round(days / 7) * 7);
  }

  /** Distance as published: nearest 10 mi on small trails. */
  function publishedDistance(d) {
    if (typeof d.totalDistanceMiles !== 'number') return d.totalDistanceMiles;
    if (datePrecision(d.trail) === 'week') return d.totalDistanceMiles;
    return Math.max(10, Math.round(d.totalDistanceMiles / 10) * 10);
  }

  /** Pace from the published distance and days, so it can't reveal the exact duration. */
  function publishedPace(d) {
    const days = publishedDays(d);
    const distance = publishedDistance(d);
    if (!days || !distance || distance <= 0) return null;
    return round(distance / days, 1);
  }

  function computeAverageDailyMiles(d) {
    const days = daysOnTrail(d.startDate, d.endDate);
    if (days === null || !d.totalDistanceMiles || d.totalDistanceMiles <= 0) return null;
    return round(d.totalDistanceMiles / days, 1);
  }

  /** Convert a value entered in the form's unit system to the stored (imperial) unit. */
  function toStoredUnit(value, unit, unitSystem) {
    if (value === null || !unit || unitSystem !== 'metric') return value;
    return value / UNITS[unit].factor;
  }

  /** "40 in" for imperial, "101.6 cm" for metric. `value` is in the stored unit. */
  function formatQuantity(value, unit, unitSystem) {
    if (!unit) return String(value);
    const u = UNITS[unit];
    if (unitSystem === 'metric') return `${round(value * u.factor, 1)} ${u.metric}`;
    return `${round(value, 1)} ${u.label}`;
  }

  function sanitizeString(value, maxLength) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim().replace(/[<>]/g, '').slice(0, maxLength || 300);
    return cleaned === '' ? null : cleaned;
  }

  function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['true', 'yes', '1'].includes(value.trim().toLowerCase());
    return false;
  }

  /** Parse one raw input value. Returns { value } or { error }. */
  function parseValue(field, raw) {
    if (field.type === 'boolean') {
      // No default: an unanswered yes/no question is missing, not "no".
      if (raw === undefined || raw === null || raw === '') return { value: null };
      return { value: parseBoolean(raw) };
    }

    if (field.type === 'enumArray') {
      if (raw === undefined || raw === null || raw === '') return { value: [] };
      const list = Array.isArray(raw) ? raw : [raw];
      return { value: Array.from(new Set(list.map(v => sanitizeString(String(v), 60)).filter(Boolean))) };
    }

    if (field.type === 'number' || field.type === 'integer') {
      if (raw === undefined || raw === null || raw === '') return { value: null };
      const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(num)) return { error: `${field.label} must be a number` };
      return { value: num };
    }

    // enum, string, date
    if (raw === undefined || raw === null) return { value: null };
    return { value: sanitizeString(String(raw), field.maxLength || 100) };
  }

  function emptyValue(field) {
    if (field.type === 'enumArray') return [];
    if (field.type === 'boolean') return false;
    return null;
  }

  function isEmpty(field, value) {
    return value === null || (field.type === 'enumArray' && value.length === 0);
  }

  function resolve(option, arg) {
    return typeof option === 'function' ? option(arg) : option;
  }

  /**
   * Validate and normalize a survey submission.
   *
   * @param input   raw answers keyed by field name (numbers in stored units)
   * @param options.fields       only report errors for these field names (wizard steps)
   * @param options.unitSystem   'imperial' | 'metric', only changes error message units
   * @param options.now          Today, for monthsSinceTrail and the latest allowed dates
   * @returns { isValid, errors: string[], fieldErrors: {name: message}, data }
   */
  /**
   * "Please answer: Did you get sick on the trail?" for questions, and
   * "Zero days is required" for plain fields, so errors use the form's wording.
   */
  function requiredMessageFor(field) {
    const question = field.question && field.question.split(' (')[0];
    if (question && question.endsWith('?')) {
      return `Please answer: ${question}${field.allowUnknown ? ' (or tick "Don\'t know")' : ''}`;
    }
    return field.allowUnknown ? `${field.label} is required (or tick "Don't know")` : `${field.label} is required`;
  }

  function validateSurvey(input, options) {
    const opts = options || {};
    const ctx = { now: opts.now || new Date(), unitSystem: opts.unitSystem || 'imperial', formElapsedSeconds: opts.formElapsedSeconds };
    const reportFor = opts.fields ? new Set(opts.fields) : null;
    const fieldErrors = {};

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { isValid: false, errors: ['Invalid request payload'], fieldErrors: {}, data: null };
    }

    // Pass 1: parse every asked field so cross-field checks can see all values.
    const d = {};
    FIELDS.forEach(field => {
      if (field.derived) return;
      const parsed = parseValue(field, input[field.name]);
      if (parsed.error) fieldErrors[field.name] = parsed.error;
      d[field.name] = parsed.error ? null : parsed.value;
    });

    // "Don't know" answers. Their value is cleared before any check runs.
    const saidUnknown = new Set(d.unknownAnswers || []);
    const answeredUnknown = [];
    UNKNOWN_FIELDS.forEach(name => {
      if (saidUnknown.has(name)) d[name] = null;
    });

    // Pass 2: conditions, normalization, requirement, bounds and custom checks.
    FIELDS.forEach(field => {
      if (field.derived || fieldErrors[field.name]) return;

      if (field.name === 'unknownAnswers') {
        const invalid = d.unknownAnswers.filter(v => !UNKNOWN_FIELDS.includes(v));
        if (invalid.length) fieldErrors.unknownAnswers = `"Don't know" is not allowed for: ${invalid.join(', ')}`;
        // Only keep questions that were actually asked.
        d.unknownAnswers = answeredUnknown;
        return;
      }

      if (field.when && !field.when(d)) {
        d[field.name] = emptyValue(field);
        return;
      }
      if (field.allowUnknown && saidUnknown.has(field.name)) {
        answeredUnknown.push(field.name);
        return;
      }
      if (field.normalize) d[field.name] = field.normalize(d[field.name], d);

      const value = d[field.name];
      if (isEmpty(field, value)) {
        if (!field.optional) {
          fieldErrors[field.name] = field.requiredMessage || requiredMessageFor(field);
        }
        return;
      }

      let error = null;
      if (field.type === 'enum' && !field.values.includes(value)) {
        error = `${field.label} must be one of: ${field.values.join(', ')}`;
      } else if (field.type === 'enumArray') {
        const invalid = value.filter(v => !field.values.includes(v));
        if (invalid.length) error = `${field.label} contains unknown values: ${invalid.join(', ')}`;
      } else if (field.type === 'date' && !isIsoDate(value)) {
        error = `${field.label} must be a valid date (YYYY-MM-DD)`;
      } else if (field.type === 'number' || field.type === 'integer') {
        const min = resolve(field.min, ctx);
        const max = resolve(field.max, ctx);
        if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
          error = `${field.label} must be between ${formatQuantity(min, field.unit, ctx.unitSystem)} and ${formatQuantity(max, field.unit, ctx.unitSystem)}`;
        }
      }
      if (!error && field.check) error = field.check(value, d, ctx);
      if (error) fieldErrors[field.name] = error;
    });

    const reported = Object.keys(fieldErrors).filter(name => !reportFor || reportFor.has(name));
    // Keep messages in form order.
    const errors = FIELDS.filter(f => reported.includes(f.name)).map(f => fieldErrors[f.name]);
    const reportedErrors = Object.fromEntries(reported.map(name => [name, fieldErrors[name]]));

    if (Object.keys(fieldErrors).length > 0) {
      return { isValid: false, errors, fieldErrors: reportedErrors, data: null };
    }

    FIELDS.forEach(field => {
      if (field.derived) d[field.name] = field.derived(d, ctx);
    });

    // Build the stored document in column order: only coarsened, public-safe
    // values. Exact dates and age were used above and are dropped here.
    const doc = { schemaVersion: SCHEMA_VERSION };
    STORED_FIELDS.forEach(field => {
      let value = d[field.name];
      if (field.publish) value = field.publish(value, d);
      if (typeof value === 'number') value = round(value, decimalsOf(field));
      doc[field.name] = value;
      if (field.metricName) {
        doc[field.metricName] = typeof value === 'number' ? round(value * UNITS[field.unit].factor, 1) : null;
      }
    });

    return { isValid: true, errors: [], fieldErrors: {}, data: doc };
  }

  /**
   * Plain-data description of every public column (no functions), used for
   * /data/schema.json and the data dictionary on the dataset page.
   */
  function describeSchema(now) {
    const ctx = { now: now || new Date(), unitSystem: 'imperial' };
    const columns = [
      { name: 'schemaVersion', label: 'Schema version', type: 'string', role: 'Metadata', required: true, description: 'Schema the record was collected under (see changelog).' }
    ];
    STORED_FIELDS.forEach(f => {
      const col = {
        name: f.name,
        label: f.label,
        type: f.type,
        role: f.role || null,
        step: f.step || null,
        required: !f.optional && !f.derived,
        conditional: !!f.when,
        allowUnknown: !!f.allowUnknown,
        derived: !!f.derived
      };
      const question = f.question || (f.questionFrom && FIELDS_BY_NAME[f.questionFrom].question);
      if (question) col.question = question;
      if (f.values) col.values = f.values.slice();
      if (f.min !== undefined) col.min = resolve(f.min, ctx);
      if (f.max !== undefined) col.max = resolve(f.max, ctx);
      if (f.unit) col.unit = UNITS[f.unit].label;
      if (f.maxLength) col.maxLength = f.maxLength;
      if (f.description) col.description = f.description;
      columns.push(col);
      if (f.metricName) {
        columns.push({
          name: f.metricName, label: `${f.label} (metric)`, type: 'number', role: f.role || null, step: f.step || null,
          unit: UNITS[f.unit].metric, metricOf: f.name, derived: true,
          description: `${f.name} converted to ${UNITS[f.unit].metric}.`
        });
      }
    });
    return { name: 'Open Thru-Hiker Survey Dataset', version: SCHEMA_VERSION, license: 'CC0-1.0', changelog: CHANGELOG, columns };
  }

  function fieldsForStep(step) {
    return FIELDS.filter(f => f.step === step).map(f => f.name);
  }

  return {
    SCHEMA_VERSION,
    CHANGELOG,
    UNKNOWN_FIELDS,
    MAX_DAILY_MILES,
    UNITS,
    TRAILS,
    INJURY_LOCATIONS,
    INJURY_LABELS,
    COMPLETION_LABELS,
    TRAIL_NAMES,
    trailName,
    TRAIL_DIRECTIONS,
    DIRECTION_LABELS,
    directionsFor,
    COMPLETED_STATUSES,
    STATUSES_WITH_QUIT_REASON,
    FIELDS,
    FIELDS_BY_NAME,
    PUBLIC_COLUMNS,
    validateSurvey,
    fieldsForStep,
    describeSchema,
    daysOnTrail,
    computeAverageDailyMiles,
    POPULAR_TRAILS,
    CONSENT_VERSION,
    HOME_REGIONS,
    ILLNESS_TYPES,
    STORED_FIELDS,
    datePrecision,
    isoWeek,
    ageBand,
    monthsBetween,
    toStoredUnit,
    formatQuantity,
    isIsoDate
  };
});
