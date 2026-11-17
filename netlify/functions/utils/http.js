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
 * Refuses POSTs that a browser could only send from another website: the page
 * always sends JSON from this site, while a plain HTML form elsewhere can only
 * send form or text bodies, and a browser marks cross-site requests with
 * Origin / Sec-Fetch-Site. Requests without those headers (curl, scripts) are
 * not a browser on another site, so they pass to the other checks.
 * Returns a Lambda-style error response, or null when the request is fine.
 */
function crossSiteRefusal(req) {
  if (req.method !== 'POST') return null;
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return json(415, { success: false, error: 'Please send JSON.', errors: ['Please send JSON.'] });
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  let sameOrigin = true;
  if (origin) {
    try { sameOrigin = new URL(origin).host === new URL(req.url).host; } catch (err) { sameOrigin = false; }
  }
  if ((site && !['same-origin', 'none'].includes(site)) || !sameOrigin) {
    return json(403, { success: false, error: 'Requests from other websites are not accepted.', errors: ['Requests from other websites are not accepted.'] });
  }
  return null;
}

/**
 * Runs a Lambda-style handler as a function of Netlify's current API (web
 * Request in, Response out), which is what allows rate limits in `config`.
 * The client IP comes from Netlify's context, so the hourly limits in
 * spam.js keep working as before. POSTs from other websites are refused first
 * (crossSiteRefusal).
 */
function webHandler(handler) {
  return async (req, context) => {
    const refused = crossSiteRefusal(req);
    if (refused) return new Response(refused.body, { status: refused.statusCode, headers: refused.headers });
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

module.exports = { json, methodNotAllowed, readJsonBody, header, webHandler, crossSiteRefusal };
