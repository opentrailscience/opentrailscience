const test = require('node:test');
const assert = require('node:assert/strict');
const Schema = require('../public/lib/survey-schema');
const { validAnswers } = require('./helpers');

const NOW = new Date('2026-10-14T12:00:00Z');
const validate = (overrides, options) => Schema.validateSurvey(validAnswers(overrides), Object.assign({ now: NOW }, options));

test('a complete submission is valid and stored in column order', () => {
  const result = validate();
  assert.equal(result.isValid, true, result.errors.join('; '));
  assert.deepEqual(Object.keys(result.data), Schema.PUBLIC_COLUMNS);
  assert.equal(result.data.schemaVersion, Schema.SCHEMA_VERSION);
  assert.equal(result.data.consentVersion, Schema.CONSENT_VERSION);
  assert.equal(result.data.heightCm, 170.2);
  assert.equal(result.data.totalDistanceKm, 4264.8);
});

test('averageDailyMiles is derived from distance and inclusive trail days', () => {
  // 2024-04-18 .. 2024-09-22 is 158 days inclusive.
  assert.equal(Schema.daysOnTrail('2024-04-18', '2024-09-22'), 158);
  assert.equal(validate().data.averageDailyMiles, 16.8);
  assert.equal(validate({ averageDailyMiles: 99 }).data.averageDailyMiles, 16.8, 'client value is ignored');
});

test('monthsSinceTrail is derived from the end date and submission date', () => {
  // 2024-09-22 -> 2026-10-14 is 24 whole months.
  assert.equal(validate().data.monthsSinceTrail, 24);
  assert.equal(validate({ monthsSinceTrail: 3 }).data.monthsSinceTrail, 24, 'client value is ignored');
  assert.equal(Schema.monthsBetween('2026-09-15', '2026-10-14'), 0);
  assert.equal(Schema.monthsBetween('2026-09-14', '2026-10-14'), 1);
});

test('implausible pace from distance and dates is rejected', () => {
  const result = validate({ endDate: '2024-04-30', totalDistanceMiles: 2650, totalZeroDays: 0, totalNeroDays: 0 });
  assert.equal(result.isValid, false);
  assert.match(result.errors[0], /work out to .* above the 100 mi\/day limit/);
});

test('every question is required', () => {
  // quitReason defaults to "not applicable" for completers by design (covered in 'quit reason rules').
  const asked = Schema.FIELDS.filter(f => !f.derived && !f.when && !f.optional && f.name !== 'quitReason');
  assert.ok(asked.length >= 40);
  asked.forEach(field => {
    const result = validate({ [field.name]: '' });
    assert.equal(result.isValid, false, field.name);
    assert.ok(result.fieldErrors[field.name], field.name);
  });
});

test('follow-up questions are required when they apply', () => {
  assert.deepEqual(validate({ priorInjuryHistory: true }).errors, ['Please select where your prior injury was']);
  assert.deepEqual(validate({ hadCompletionDeadline: true }).errors, ['Please select what your deadline was']);
  assert.deepEqual(validate({ gotSick: true }).errors, ['Please select what kind of illness you had', 'Please answer: How many separate times were you sick?']);
  const injury = validate({ severeInjuryOccurred: true });
  assert.deepEqual(injury.errors, [
    'Please select at least one injury category / location',
    'Distance into the hike when the injury happened is required (or tick "Don\'t know")'
  ]);
  assert.equal(validate({ severeInjuryOccurred: true, injuryLocations: ['knee_it_band', 'shin_splints'], injuryMilestoneMiles: 400 }).isValid, true);
  assert.deepEqual(validate({ gotSick: true, illnessTypes: ['giardia'], illnessEpisodes: 2 }).data.illnessTypes, ['giardia']);
});

test('a blank post-trail weight says it is required, not out of range', () => {
  assert.deepEqual(validate({ postTrailWeightLbs: '' }).errors, ['Body weight after the hike is required']);
});

test('hikes shorter than four weeks only report the weeks they hiked', () => {
  // 2024-04-18 .. 2024-05-01 is 14 days: two weeks.
  const short = { endDate: '2024-05-01', totalDistanceMiles: 200, totalZeroDays: 1, totalNeroDays: 1 };
  const result = validate(Object.assign({}, short, { rampWeeksHiked: 2, week3DailyMiles: 18, week4DailyMiles: 21 }));
  assert.equal(result.isValid, true, result.errors.join('; '));
  assert.equal(result.data.week2DailyMiles, 15.5);
  assert.equal(result.data.week3DailyMiles, null, 'weeks not hiked are null');
  assert.equal(result.data.week4DailyMiles, null);

  assert.match(validate(Object.assign({}, short, { rampWeeksHiked: 4 })).errors[0], /14 days on trail, so please choose 2 weeks/);
  assert.match(validate({ rampWeeksHiked: 3 }).errors[0], /158 days on trail, so please choose "4\+ weeks"/);
  assert.match(validate({ week3DailyMiles: null }).errors[0], /Week 3 daily distance is required/);
});

test('dates are validated', () => {
  assert.match(validate({ startDate: 'banana' }).errors[0], /Start date must be a valid date/);
  assert.match(validate({ startDate: '2024-02-30' }).errors[0], /valid date/);
  assert.match(validate({ endDate: '2024-01-01' }).errors.join(), /End date cannot be before the start date/);
  assert.match(validate({ hikeYear: 2019 }).errors[0], /does not match the 2019 hike year/);
  assert.match(validate({ hikeYear: 2026, startDate: '2026-04-15', endDate: '2026-10-30' }).errors.join(), /End date cannot be in the future/);
  // Seasons that straddle New Year are fine.
  assert.equal(validate({ hikeYear: 2025, startDate: '2024-11-20', endDate: '2025-03-20', totalDistanceMiles: 1864, totalZeroDays: 10, totalNeroDays: 5 }).isValid, true);
});

test('zero + nero days cannot exceed days on trail', () => {
  const result = validate({ endDate: '2024-05-17', totalDistanceMiles: 500, totalZeroDays: 20, totalNeroDays: 15 });
  assert.match(result.errors.join(), /cannot exceed your 30 days on trail/);
});

test('required fields and ranges', () => {
  assert.match(validate({ age: null }).errors[0], /Please enter how old you were when you started this hike/);
  assert.match(validate({ age: 200 }).errors[0], /Age at the start of the hike must be between 5 and 99/);
  assert.match(validate({ age: 4 }).errors[0], /Age at the start of the hike must be between 5 and 99/);
  assert.match(validate({ age: 'abc' }).errors[0], /Age at the start of the hike must be a number/);
  assert.match(validate({ maxHeavyLoadLbs: 10 }).errors[0], /can't weigh less than your base weight/);
  assert.match(validate({ week2DailyMiles: 150 }).errors[0], /Week 2 daily distance must be between/);
});

test('range messages use the hiker\'s unit system', () => {
  const metric = validate({ heightInches: 20 }, { unitSystem: 'metric' });
  assert.match(metric.errors[0], /Height must be between 101.6 cm and 228.6 cm/);
  const imperial = validate({ heightInches: 20 });
  assert.match(imperial.errors[0], /Height must be between 40 in and 90 in/);
});

test('enum values are checked, including injury locations', () => {
  assert.match(validate({ trail: 'Narnia' }).errors[0], /Trail must be one of/);
  assert.match(validate({ trail: 'LT' }).errors[0], /Trail must be one of/, 'duplicate LT code was removed');
  const injury = validate({ severeInjuryOccurred: true, injuryLocations: ['knee_it_band', 'elbow'] });
  assert.match(injury.errors[0], /Injury types contains unknown values: elbow/);
});

test('conditional answers are cleared when their question does not apply', () => {
  const d = validate({
    priorInjuryAreas: ['knee'], deadlineReasons: ['visa'], injuryLocations: ['knee_it_band'], injuryMilestoneMiles: 400,
    illnessTypes: ['covid'], illnessEpisodes: 3
  }).data;
  assert.deepEqual(d.priorInjuryAreas, []);
  assert.deepEqual(d.deadlineReasons, []);
  assert.deepEqual(d.injuryLocations, []);
  assert.equal(d.injuryMilestoneMiles, null);
  assert.equal(d.injuryMilestoneKm, null);
  assert.deepEqual(d.illnessTypes, []);
  assert.equal(d.illnessEpisodes, null);
});

test('"Other" trails need no name and are published with month precision', () => {
  const d = validate({ trail: 'Other', trailOther: 'Wonderland Trail' }).data;
  assert.equal(d.trail, 'Other');
  assert.equal('trailOther' in d, false, 'custom trail names are not collected');
  assert.equal(d.datePrecision, 'month');
});

test('quit reason rules', () => {
  assert.equal(validate({ quitReason: 'budget_exhaustion' }).data.quitReason, 'not_applicable_completed', 'completers are N/A');
  assert.equal(validate({ completionStatus: 'section_hike', quitReason: 'other' }).data.quitReason, 'not_applicable_completed');
  assert.equal(validate({ completionStatus: 'skipped_sections', quitReason: 'weather_wildfire_closure' }).data.quitReason, 'weather_wildfire_closure');
  assert.match(validate({ completionStatus: 'quit_early' }).errors[0], /primary reason you left/);
  assert.equal(validate({ completionStatus: 'quit_early', quitReason: 'overuse_injury' }).isValid, true);
});

test('there are no free-text questions', () => {
  const asked = Schema.FIELDS.filter(f => f.input && !f.derived);
  assert.deepEqual(asked.filter(f => f.type === 'string').map(f => f.name), []);
  for (const name of ['trailOther', 'hikerCountry', 'priorInjuryDetails', 'deadlineDetails', 'injuryDescription', 'sicknessFrequency']) {
    assert.equal(Schema.FIELDS_BY_NAME[name], undefined, name);
  }
});

test('the fields option limits which errors are reported (wizard steps)', () => {
  const result = Schema.validateSurvey(validAnswers({ age: null, trail: null }), { now: NOW, fields: Schema.fieldsForStep(2) });
  assert.deepEqual(result.errors, ['Please enter how old you were when you started this hike']);
});

test('metric input is converted to stored imperial units', () => {
  assert.equal(Math.round(Schema.toStoredUnit(178, 'in', 'metric') * 10) / 10, 70.1);
  assert.equal(Schema.toStoredUnit(178, 'in', 'imperial'), 178);
  assert.equal(Schema.toStoredUnit(null, 'lb', 'metric'), null);
});

test('yes/no questions have no default answer', () => {
  for (const name of ['neededVisa', 'priorInjuryHistory', 'hadCompletionDeadline', 'severeInjuryOccurred', 'gotSick']) {
    assert.match(validate({ [name]: undefined }).fieldErrors[name], /is required|Please say|Please answer/, name);
    assert.match(validate({ [name]: '' }).fieldErrors[name], /is required|Please say|Please answer/, name);
  }
  assert.equal(validate({ gotSick: 'false' }).data.gotSick, false);
});

test('"Don\'t know" answers are stored as null and listed in unknownAnswers', () => {
  const result = validate({
    totalElevationGainFt: 420880, // a value sent with "Don't know" is discarded
    averageCalories: null,
    week2DailyMiles: null,
    unknownAnswers: ['totalElevationGainFt', 'averageCalories', 'week2DailyMiles']
  });
  assert.equal(result.isValid, true, result.errors.join('; '));
  assert.equal(result.data.totalElevationGainFt, null);
  assert.equal(result.data.totalElevationGainM, null);
  assert.equal(result.data.averageCalories, null);
  assert.deepEqual(result.data.unknownAnswers, ['totalElevationGainFt', 'averageCalories', 'week2DailyMiles'], 'form order');
  assert.deepEqual(validate().data.unknownAnswers, []);
});

test('"Don\'t know" is only accepted for hard-to-remember questions that were asked', () => {
  assert.match(validate({ unknownAnswers: ['baseWeightLbs'] }).errors.join(), /not allowed for: baseWeightLbs/);
  assert.match(validate({ unknownAnswers: ['preTrailWeightLbs'] }).errors.join(), /not allowed/, 'body weight is not "don\'t know"-able');
  // Injury mile only applies when there was an injury, so the flag is dropped otherwise.
  assert.deepEqual(validate({ unknownAnswers: ['injuryMilestoneMiles'] }).data.unknownAnswers, []);
});

test('shelter and insulation are asked only when carrying your own shelter', () => {
  const huts = validate({ sleepLocation: 'huts_refuges' }).data;
  assert.equal(huts.shelterType, null);
  assert.equal(huts.sleepInsulation, null);
  assert.match(validate({ shelterType: null }).errors[0], /Shelter is required/);
  assert.match(validate({ sleepInsulation: 'blanket' }).errors[0], /Quilt or sleeping bag must be one of/);
});

// --- Privacy: what is stored ------------------------------------------------------

test('exact dates, exact age, country and submission time are never stored', () => {
  const d = validate({ homeRegion: 'western_europe' }).data;
  for (const key of ['startDate', 'endDate', 'age', 'submittedAt', 'hikerCountry', 'consent']) {
    assert.equal(key in d, false, key);
    assert.equal(Schema.PUBLIC_COLUMNS.includes(key), false, key);
  }
  assert.doesNotMatch(JSON.stringify(d), /2024-04-18|2024-09-22/, 'no exact date anywhere in the record');
});

test('popular trails keep ISO weeks; months are always stored', () => {
  const d = validate().data; // PCT, 2024-04-18 .. 2024-09-22
  assert.equal(d.datePrecision, 'week');
  assert.equal(d.startWeek, '2024-W16');
  assert.equal(d.endWeek, '2024-W38', '22 Sep 2024 is a Sunday, the last day of week 38');
  assert.equal(d.startMonth, '2024-04');
  assert.equal(d.endMonth, '2024-09');
  assert.equal(d.daysOnTrail, 158);
  assert.equal(d.totalDistanceMiles, 2650);
  assert.equal(d.averageDailyMiles, 16.8);
});

test('small trails get months, rounded distance and whole-week durations', () => {
  const d = validate({ trail: 'Hayduke', totalDistanceMiles: 812, totalZeroDays: 5, totalNeroDays: 3 }).data;
  assert.equal(d.datePrecision, 'month');
  assert.equal(d.startWeek, null);
  assert.equal(d.endWeek, null);
  assert.equal(d.startMonth, '2024-04');
  assert.equal(d.totalDistanceMiles, 810);
  assert.equal(d.daysOnTrail, 161, '158 days rounded to 23 weeks');
  // Pace comes from the rounded values, so distance / pace can't reveal the exact duration.
  assert.equal(d.averageDailyMiles, Math.round((810 / 161) * 10) / 10);
});

test('every trail is either popular (weeks) or small (months)', () => {
  assert.deepEqual(Schema.POPULAR_TRAILS.filter(t => !Schema.TRAILS.includes(t)), []);
  ['PCT', 'AT', 'TMB', 'CDS', 'TA'].forEach(t => assert.equal(Schema.datePrecision(t), 'week', t));
  ['Hayduke', 'KUN', 'PNT', 'Other'].forEach(t => assert.equal(Schema.datePrecision(t), 'month', t));
});

test('ISO weeks are correct around New Year', () => {
  assert.equal(Schema.isoWeek('2024-12-30'), '2025-W01');
  assert.equal(Schema.isoWeek('2021-01-03'), '2020-W53');
  assert.equal(Schema.isoWeek('2026-12-31'), '2026-W53');
  assert.equal(Schema.isoWeek('2025-04-18'), '2025-W16');
  assert.equal(Schema.isoWeek('2025-09-22'), '2025-W39');
});

test('age is stored as a 5-year band', () => {
  assert.equal(validate({ age: 12 }).data.ageBand, '20-and-under', 'one band for everyone 20 or younger');
  assert.equal(validate({ age: 20 }).data.ageBand, '20-and-under');
  assert.equal(validate({ age: 21 }).data.ageBand, '21-24');
  assert.equal(validate({ age: 29 }).data.ageBand, '25-29');
  assert.equal(validate({ age: 47 }).data.ageBand, '45-49');
  assert.equal(validate({ age: 77 }).data.ageBand, '70+');
});

test('everyone is asked for a world region (never a country) and whether they needed a visa', () => {
  assert.equal(validate({ homeRegion: 'eastern_europe' }).data.homeRegion, 'eastern_europe');
  assert.match(validate({ homeRegion: null }).errors[0], /Home region is required/);
  assert.match(validate({ homeRegion: 'Canada' }).errors[0], /Home region must be one of/);
  assert.equal(validate({ neededVisa: 'true' }).data.neededVisa, true);
  assert.equal('isInternational' in validate().data, false, 'US-vs-international question removed');
});

test('consent is required before anything is stored', () => {
  assert.match(validate({ consent: undefined }).errors[0], /18 or older and agree/);
  assert.match(validate({ consent: false }).errors[0], /18 or older and agree/);
  assert.equal(validate({ consent: true }).data.consentVersion, Schema.CONSENT_VERSION);
});

test('directions depend on the trail', () => {
  assert.equal(validate({ trail: 'TMB', direction: 'CCW' }).isValid, true);
  assert.match(validate({ trail: 'TMB', direction: 'NOBO' }).errors[0], /direction for this trail/);
  assert.equal(validate({ trail: 'CDS', direction: 'TO_SANTIAGO' }).isValid, true);
  assert.equal(validate({ trail: 'PCT', direction: 'Flip-flop' }).isValid, true);
  assert.match(validate({ trail: 'PCT', direction: 'EABO' }).errors[0], /direction for this trail/);
  for (const trail of Schema.TRAILS) {
    for (const d of Schema.directionsFor(trail)) assert.ok(Schema.DIRECTION_LABELS[d], `${trail}: ${d}`);
  }
});

test('flip-flops that hiked every mile count as finished, skipped parts do not', () => {
  assert.ok(Schema.COMPLETED_STATUSES.includes('flip_flop'));
  assert.ok(!Schema.COMPLETED_STATUSES.includes('skipped_sections'));
  assert.equal(validate({ completionStatus: 'flip_flop', quitReason: 'weather_wildfire_closure' }).data.quitReason, 'weather_wildfire_closure');
});

test('the budget is stored with its currency, without conversion', () => {
  const ok = validate({ totalBudget: 6000, budgetCurrency: 'EUR' }).data;
  assert.deepEqual([ok.totalBudget, ok.budgetCurrency], [6000, 'EUR']);
  assert.match(validate({ budgetCurrency: null }).errors[0], /currency of your budget/);
  const unknown = validate({ totalBudget: null, budgetCurrency: null, unknownAnswers: ['totalBudget'] });
  assert.equal(unknown.isValid, true);
  assert.equal(unknown.data.budgetCurrency, null);
});

test('the survey duration is stored only as a rough band', () => {
  const at = seconds => Schema.validateSurvey(validAnswers(), { now: NOW, formElapsedSeconds: seconds }).data.surveyMinutesBand;
  assert.equal(at(200), 'under-5');
  assert.equal(at(13 * 60), '10-20');
  assert.equal(at(3 * 3600), '40+');
  assert.equal(at(undefined), null);
});

test('every asked question is documented with its wording', () => {
  for (const f of Schema.FIELDS.filter(f => f.step && !f.derived)) assert.ok(f.question, f.name);
});

test('"didn\'t train at all" is its own answer, and trainingFocus then does not apply', () => {
  const none = validate({ trainedBeforeHike: false, trainingFocus: 0.7 });
  assert.equal(none.isValid, true);
  assert.equal(none.data.trainedBeforeHike, false);
  assert.equal(none.data.trainingFocus, null, 'never a special value like -1');
  assert.equal(validate({ trainedBeforeHike: true, trainingFocus: 0 }).data.trainingFocus, 0, '0 = only cardio, a real answer');
  assert.match(validate({ trainedBeforeHike: null }).errors[0], /training slider, or tick/);
  assert.ok(validate({ trainedBeforeHike: true, trainingFocus: null }).errors.length > 0, 'trained but no slider answer');
});

test('illnesses are asked as illnesses, not as injury types', () => {
  const result = validate({ severeInjuryOccurred: true, injuryLocations: ['knee_it_band', 'tick_borne'], injuryMilestoneMiles: 400 });
  assert.equal(result.isValid, false);
  assert.equal(validate({ gotSick: true, illnessTypes: ['hypothermia'], illnessEpisodes: 1 }).isValid, true);
});

test('how often someone thought about quitting is one of four answers', () => {
  assert.equal(validate({ consideredQuitting: 'several_times' }).isValid, true);
  assert.equal(validate({ consideredQuitting: 'first_two_weeks' }).isValid, false);
  assert.deepEqual(validate({ consideredQuitting: '' }).errors, ['Please answer: How often did you seriously think about quitting?']);
});
