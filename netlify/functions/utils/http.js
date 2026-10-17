/** Small helpers for Lambda-style Netlify function responses. */

function json(statusCode, body, headers) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers),
    body: JSON.stringify(body)
  };
}

function methodNotAllowed(allowed, headers) {
  return json(405, { success: false, errors: [`Method not allowed. Use ${allowed}.`] }, Object.assign({ Allow: allowed }, headers));
}

/**
 * Parses a JSON object body, refusing anything larger than maxBytes before
 * parsing it. Returns { body } or { status, message } for an error response.
 */
function readJsonBody(event, maxBytes) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) return { status: 413, message: 'Request body too large' };
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    return { status: 400, message: 'Malformed JSON payload in request body' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, message: 'Invalid request payload' };
  return { body };
}

function header(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

module.exports = { json, methodNotAllowed, readJsonBody, header };
