/**
 * Scheduled function (see netlify.toml): once a day, rebuild the public
 * snapshot if any answers were submitted or deleted since the last rebuild.
 * Rebuilds in between happen after enough new answers (utils/rebuild.js),
 * and this also retries a build that was triggered but failed.
 *
 * Requires BUILD_HOOK_URL (Site settings > Build & deploy > Build hooks).
 */
const { getDb } = require('./utils/db');
const { rebuildIfPending } = require('./utils/rebuild');

exports.handler = async () => {
  try {
    const triggered = await rebuildIfPending(await getDb(), new Date());
    return { statusCode: 200, body: triggered ? 'triggered' : 'nothing to rebuild' };
  } catch (err) {
    console.error('Nightly snapshot check failed:', err.message);
    return { statusCode: 503, body: 'database unavailable' };
  }
};
