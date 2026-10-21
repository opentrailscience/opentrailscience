/**
 * POST /api/feedback  { "message": "..." }
 * The optional "How can I improve this survey?" box on the thank-you page.
 *
 * Feedback is kept apart from the survey data on purpose: its own collection,
 * a random id, no timestamp and no link to a hike, and it is never published
 * (it is not part of the snapshot). Read it with `npm run feedback`.
 */
const crypto = require('crypto');
const { getDb, COLLECTIONS } = require('./db');
const { json, methodNotAllowed, readJsonBody } = require('./http');
const { isThrottled } = require('./spam');
const { SCHEMA_VERSION } = require('../../../public/lib/survey-schema');

const MAX_MESSAGE_CHARS = 1000;
// 1000 characters of emoji-heavy UTF-8 plus the JSON around it.
const MAX_BODY_BYTES = 8 * 1024;

/** Trimmed text without control characters (newlines and tabs stay). */
function cleanMessage(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');

  const parsed = readJsonBody(event, MAX_BODY_BYTES);
  if (!parsed.body) return json(parsed.status, { success: false, error: parsed.message });

  const message = cleanMessage(parsed.body.message);
  if (!message) return json(400, { success: false, error: 'Please write something first.' });
  if ([...message].length > MAX_MESSAGE_CHARS) {
    return json(400, { success: false, error: `Please keep it under ${MAX_MESSAGE_CHARS} characters.` });
  }

  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return json(503, { success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
  }

  if (await isThrottled(db, event, new Date(), 'feedback')) {
    return json(429, { success: false, error: 'Thanks, that is plenty of feedback for now. Please try again in an hour.' });
  }

  try {
    await db.collection(COLLECTIONS.feedback).insertOne({ _id: crypto.randomUUID(), message, schemaVersion: SCHEMA_VERSION });
    return json(201, { success: true });
  } catch (err) {
    console.error('Saving feedback failed:', err.message);
    return json(503, { success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
  }
};

exports.MAX_MESSAGE_CHARS = MAX_MESSAGE_CHARS;
