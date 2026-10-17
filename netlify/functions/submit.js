/**
 * POST /api/submit — validate a survey, store it, and return how the hiker
 * compares with others on the same trail.
 * Same-origin only (no CORS headers): the survey form is the only client.
 */
const crypto = require('crypto');
const { validateSurvey, SCHEMA_VERSION } = require('../../public/lib/survey-schema');
const { getDb, COLLECTIONS } = require('./utils/db');
const { comparisonFor, addPeer } = require('./utils/peers');
const { json, methodNotAllowed, readJsonBody } = require('./utils/http');
const { isLikelySpam, passesHumanCheck, isThrottled } = require('./utils/spam');
const { createDeletionCode } = require('./utils/deletion');
const { notePublicChange } = require('./utils/rebuild');

// A complete survey is about 3 KB of JSON; anything far larger isn't a survey.
const MAX_BODY_BYTES = 20 * 1024;

const THANK_YOU = 'Survey successfully submitted! Thank you for contributing your trail journey to research.';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');

  const parsed = readJsonBody(event, MAX_BODY_BYTES);
  if (!parsed.body) return json(parsed.status, { success: false, errors: [parsed.message] });
  const body = parsed.body;

  // A page loaded before a new version went live would fail the proof of work
  // (it covers the list of questions) and be dropped as a bot. Tell the hiker
  // to reload instead; their draft is kept in the browser.
  if (body.schemaVersion !== undefined && body.schemaVersion !== SCHEMA_VERSION) {
    return json(409, { success: false, outdated: true, errors: ['The survey was updated while you were filling it in. Please reload the page: your answers are saved.'] });
  }

  // Bots get the same success response as people so they don't adapt.
  // (Real browsers only send after the trail check and proof of work pass.)
  if (isLikelySpam(body) || !passesHumanCheck(body)) {
    console.log('Likely bot submission discarded.');
    return json(200, { success: true, message: THANK_YOU });
  }

  const now = new Date();
  const validation = validateSurvey(body, { now, formElapsedSeconds: Number(body.formElapsedSeconds) });
  if (!validation.isValid) {
    return json(400, { success: false, errors: validation.errors, fieldErrors: validation.fieldErrors });
  }

  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return json(503, { success: false, errors: ['Database temporarily unavailable. Please try again shortly.'] });
  }

  if (await isThrottled(db, event, now)) {
    return json(429, { success: false, errors: ['Too many submissions from your network. Please try again in an hour.'] });
  }

  // Read the peers before inserting so the hiker is not compared with themselves.
  const comparison = await comparisonFor(db, validation.data);

  let deletionCode;
  let insertedId = null;
  try {
    // A random id: MongoDB's default ObjectId would contain the submission time.
    // (Also a copy, so validation.data stays without _id.)
    ({ insertedId } = await db.collection(COLLECTIONS.surveys).insertOne(Object.assign({ _id: crypto.randomUUID() }, validation.data)));
    deletionCode = await createDeletionCode(db, insertedId);
  } catch (err) {
    console.error('Failed to save survey:', err.message);
    // Never keep a record the hiker can't delete: they will retry, which would create a duplicate.
    if (insertedId) {
      await db.collection(COLLECTIONS.surveys).deleteOne({ _id: insertedId }).catch(e => {
        console.error('Could not remove the record without a deletion code:', e.message);
      });
    }
    return json(503, { success: false, errors: ['Database temporarily unavailable. Please try again shortly.'] });
  }

  // Keep this instance's peer cache current without another read.
  addPeer(db, validation.data, insertedId);

  // Counts towards the next snapshot rebuild (see utils/rebuild.js).
  await notePublicChange(db, now);

  // The deletion code is shown to the hiker once and never stored in readable form.
  return json(201, { success: true, data: validation.data, comparison, deletionCode, message: THANK_YOU });
};
