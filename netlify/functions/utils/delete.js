/**
 * POST /api/delete  { "code": "7K3Q-M9XD-2WPA-HV4T" }
 * Deletes the hike that belongs to a deletion code. Same-origin only.
 * The record is removed from the database at once, and from the website and
 * download files with the next snapshot rebuild (utils/rebuild.js).
 */
const { getDb } = require('./db');
const { json, methodNotAllowed, readJsonBody } = require('./http');
const { isThrottled } = require('./spam');
const { deleteByCode } = require('./deletion');
const { notePublicChange } = require('./rebuild');

// { "code": "XXXX-XXXX-XXXX-XXXX" } is about 30 bytes.
const MAX_BODY_BYTES = 1024;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed('POST');

  const parsed = readJsonBody(event, MAX_BODY_BYTES);
  if (!parsed.body) return json(parsed.status, { success: false, error: parsed.message });
  const body = parsed.body;

  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return json(503, { success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
  }

  if (await isThrottled(db, event, new Date(), 'delete')) {
    return json(429, { success: false, error: 'Too many attempts. Please try again in an hour.' });
  }

  try {
    const deleted = await deleteByCode(db, body.code);
    if (!deleted) return json(404, { success: false, error: 'No hike found for this code. Please check it and try again.' });
    // The download files still contain the hike until the next rebuild.
    await notePublicChange(db, new Date());
    return json(200, { success: true, message: 'Your answers have been deleted.' });
  } catch (err) {
    console.error('Deletion failed:', err.message);
    return json(503, { success: false, error: 'Database temporarily unavailable. Please try again shortly.' });
  }
};
