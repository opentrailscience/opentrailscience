const crypto = require('crypto');
const HumanCheck = require('../public/lib/human-check');
const { useDatabase } = require('../netlify/functions/utils/db');
const { createMemoryDb } = require('../scripts/lib/memory-db');

/** A complete, valid set of answers as the browser sends them (imperial units). */
function validAnswers(overrides) {
  return Object.assign({
    consent: true,
    trail: 'PCT',
    hikeYear: 2024,
    direction: 'NOBO',
    startDate: '2024-04-18',
    endDate: '2024-09-22',
    totalDistanceMiles: 2650,
    totalElevationGainFt: 420880,
    age: 29,
    biologicalSex: 'female',
    heightInches: 67,
    homeRegion: 'north_america',
    neededVisa: false,
    preTrailWeightLbs: 140,
    preTrailFitnessRating: 7,
    priorExperience: 'weekend_trips',
    startGroup: 'solo',
    trainedBeforeHike: true,
    trainingFocus: 0.5,
    priorInjuryHistory: false,
    priorInjuryAreas: [],
    trailSpending: 5200,
    gearCost: 3000,
    budgetCurrency: 'USD',
    baseWeightLbs: 12.8,
    maxHeavyLoadLbs: 27.5,
    footwearCategory: 'trail_runners',
    shoePairsUsed: 4,
    trekkingPoleUsage: 'two_poles',
    waterFiltration: 'water_filter',
    backpackType: 'framed',
    cookSystem: 'stove_cooked',
    sleepPadType: 'inflatable',
    sleepLocation: 'own_system',
    shelterType: 'tent',
    sleepInsulation: 'quilt',
    averageCalories: 3500,
    resupplyStrategy: 'bought_along_the_way',
    trailDiet: 'omnivore',
    rampWeeksHiked: 4,
    week1DailyMiles: 12,
    week2DailyMiles: 15.5,
    week3DailyMiles: 18,
    week4DailyMiles: 21,
    totalZeroDays: 16,
    totalNeroDays: 12,
    hoursSleepPerNight: 8.5,
    sleepQualityRating: 8,
    painkillerUse: 'sometimes',
    percentHikingAlone: 60,
    hadCompletionDeadline: false,
    deadlineReasons: [],
    completionStatus: 'continuous_purist',
    quitReason: 'not_applicable_completed',
    consideredQuitting: 'never',
    severeInjuryOccurred: false,
    injuryLocations: [],
    injuryMilestoneMiles: null,
    gotSick: false,
    illnessTypes: [],
    illnessEpisodes: null,
    postTrailWeightLbs: 128,
    overallEnjoymentRating: 9
  }, overrides);
}

/** Solves the proof of work for a body, as the browser does (see public/lib/human-check.js). */
function solvePow(body) {
  const answersHash = crypto.createHash('sha256').update(HumanCheck.answersString(body)).digest('hex');
  for (let nonce = 0; ; nonce++) {
    const digest = crypto.createHash('sha256').update(HumanCheck.powMessage(answersHash, nonce)).digest();
    if (HumanCheck.hasLeadingZeroBits(digest, HumanCheck.POW_BITS)) return nonce;
  }
}

const TRAIL_CHECK_OK = { id: HumanCheck.TRAIL_CHECKS[0].id, choice: HumanCheck.TRAIL_CHECKS[0].odd };

/** Body of a real form submission: answers, anti-spam fields and a solved human check. */
function submission(overrides) {
  const body = Object.assign(validAnswers(), { website_url: '', hiker_anti_spam: '', formElapsedSeconds: 300, trailCheck: TRAIL_CHECK_OK }, overrides);
  if (!('powNonce' in (overrides || {}))) body.powNonce = solvePow(body);
  return body;
}

/** Fresh in-memory database installed as the app's database. */
function freshDb() {
  const db = createMemoryDb();
  useDatabase(db);
  return db;
}

function get(handler, query, headers) {
  return handler.handler({ httpMethod: 'GET', queryStringParameters: query || {}, headers: headers || {} });
}

function post(handler, body, headers) {
  return handler.handler({
    httpMethod: 'POST',
    headers: Object.assign({ 'x-nf-client-connection-ip': '203.0.113.7' }, headers),
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

module.exports = { validAnswers, submission, solvePow, freshDb, get, post };
