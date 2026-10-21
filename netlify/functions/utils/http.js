/** Small helpers for Lambda-style Netlify function responses. */

function json(statusCode, body, headers) {
  return {
    statusCode,
    // nosniff here too: it isn't documented whether public/_headers reaches functions with their own path.
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, headers),
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

/**
 * Runs a Lambda-style handler as a function of Netlify's current API (web
 * Request in, Response out), which is what allows rate limits in `config`.
 * The client IP comes from Netlify's context, so the hourly limits in
 * spam.js keep working as before.
 */
function webHandler(handler) {
  return async (req, context) => {
    const headers = Object.fromEntries(req.headers);
    if (context && context.ip) headers['x-nf-client-connection-ip'] = context.ip;
    const event = {
      httpMethod: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? '' : await req.text(),
      isBase64Encoded: false
    };
    const res = await handler(event);
    return new Response(res.body, { status: res.statusCode, headers: res.headers });
  };
}

module.exports = { json, methodNotAllowed, readJsonBody, header, webHandler };
