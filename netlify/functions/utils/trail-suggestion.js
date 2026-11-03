/**
 * POST /api/trail-suggestion  { "trail": "..." }
 * "Don't see your trail? Suggest it": on the home page and in step 1 of the
 * survey when an "Other" trail is picked. Anyone can send one, no survey needed.
 *
 * Stored like the feedback: its own collection, a random id, no timestamp and
 * no link to a hike, never published. Read it with `npm run trail-suggestions`.
 */
const crypto = require('crypto');
const { getDb, COLLECTIONS } = require('./db');
const { json, methodNotAllowed, readJsonBody } = require('./http');
const { isThrottled } = require('./spam');
const { SCHEMA_VERSION } = require('../../../public/lib/survey-schema');

const MAX_TRAIL_CHARS = 100;
// Unreviewed suggestions kept at most, so a spam wave can't fill the free database.
const MAX_STORED = 500;
const MAX_BODY_BYTES = 2 * 1024;

/** One line of text: control characters and runs of whitespace become single spaces. */
function cleanTrail(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');

  const parsed = readJsonBody(event, MAX_BODY_BYTES);
  if (!parsed.body) return json(parsed.status, { success: false, error: parsed.message });

  // The hidden field only bots fill in: accept quietly, store nothing.
  if (parsed.body.website_url) return json(201, { success: true });

  const trail = cleanTrail(parsed.body.trail);
  if (!trail) return json(400, { success: false, error: 'Please enter a trail first.' });
  if ([...trail].length > MAX_TRAIL_CHARS) {
    return json(400, { success: false, error: `Please keep it under ${MAX_TRAIL_CHARS} characters.` });
  }

  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return json(503, { success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
  }

  if (await isThrottled(db, event, new Date(), 'trail-suggestion')) {
    return json(429, { success: false, error: 'Thanks, that is plenty of suggestions for now. Please try again in an hour.' });
  }

  try {
    const collection = db.collection(COLLECTIONS.trailSuggestions);
    if (await collection.countDocuments({}) >= MAX_STORED) {
      return json(429, { success: false, error: 'Thanks! There are a lot of suggestions waiting for review right now. Please try again in a few days.' });
    }
    await collection.insertOne({ _id: crypto.randomUUID(), trail, schemaVersion: SCHEMA_VERSION });
    return json(201, { success: true });
  } catch (err) {
    console.error('Saving trail suggestion failed:', err.message);
    return json(503, { success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
  }
};

exports.MAX_TRAIL_CHARS = MAX_TRAIL_CHARS;
exports.MAX_STORED = MAX_STORED;
