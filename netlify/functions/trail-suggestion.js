/**
 * POST /api/trail-suggestion (the logic is in utils/trail-suggestion.js). No rate
 * limit rule of its own (the free plan allows two, used by submit.js and
 * hike-code.js); the hourly limit in utils/spam.js applies.
 */
const { webHandler } = require('./utils/http');
const { handler } = require('./utils/trail-suggestion');

exports.default = webHandler(handler);
exports.config = {
  path: '/api/trail-suggestion'
};
