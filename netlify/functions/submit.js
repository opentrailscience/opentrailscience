/**
 * POST /api/submit (the logic is in utils/submit.js).
 *
 * Netlify stops a network after 5 submissions a minute, before the function
 * runs; the hourly limit in utils/spam.js still applies on top. The free plan
 * allows two such rules per site: this one and the one in hike-code.js.
 * Netlify reads `config` from the source, so it stays a plain object.
 */
const { webHandler } = require('./utils/http');
const { handler } = require('./utils/submit');

exports.default = webHandler(handler);

exports.config = {
  path: '/api/submit',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
