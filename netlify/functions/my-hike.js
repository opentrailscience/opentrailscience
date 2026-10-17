/**
 * POST /api/my-hike  { "code": "7K3Q-M9XD-2WPA-HV4T" }
 * Shows a hiker their own hike and how it compares today, with the deletion
 * code they got after submitting: early hikers can come back once more
 * people have answered. The record is public anyway; the code only proves
 * which row is yours. Limited per network and hour like the other endpoints.
 */
const { getDb } = require('./utils/db');
const { json, methodNotAllowed, readJsonBody } = require('./utils/http');
const { isThrottled } = require('./utils/spam');
const { findByCode } = require('./utils/deletion');
const { comparisonFor } = require('./utils/peers');
const { toPublicRecord } = require('./utils/dataset');

const MAX_BODY_BYTES = 1024;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');

  const parsed = readJsonBody(event, MAX_BODY_BYTES);
  if (!parsed.body) return json(parsed.status, { success: false, error: parsed.message });

  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return json(503, { success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
  }

  if (await isThrottled(db, event, new Date(), 'lookup')) {
    return json(429, { success: false, error: 'Too many attempts. Please try again in an hour.' });
  }

  try {
    const record = await findByCode(db, parsed.body.code);
    if (!record) return json(404, { success: false, error: 'No hike found for this code. Please check it and try again.' });
    const comparison = await comparisonFor(db, record, record._id);
    return json(200, { success: true, data: toPublicRecord(record), comparison });
  } catch (err) {
    console.error('Looking up a hike failed:', err.message);
    return json(503, { success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
  }
};
