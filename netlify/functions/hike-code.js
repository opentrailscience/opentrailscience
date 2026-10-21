/**
 * POST /api/my-hike and POST /api/delete: everything done with a personal
 * code (the logic is in utils/my-hike.js and utils/delete.js). One function,
 * so looking up and deleting share one rate limit rule: 10 requests a minute
 * per network, on top of the hourly limit in utils/spam.js.
 */
const { json, webHandler } = require('./utils/http');
const myHike = require('./utils/my-hike');
const deleteHike = require('./utils/delete');

const HANDLERS = {
  '/api/my-hike': webHandler(myHike.handler),
  '/api/delete': webHandler(deleteHike.handler)
};

exports.default = (req, context) => {
  const handle = HANDLERS[new URL(req.url).pathname];
  if (handle) return handle(req, context);
  const res = json(404, { success: false, error: 'Not found' });
  return new Response(res.body, { status: res.statusCode, headers: res.headers });
};

// Written out: Netlify reads this config from the source, it doesn't run it.
exports.config = {
  path: ['/api/my-hike', '/api/delete'],
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
