/**
 * Scheduled function (see netlify.toml): every 1 January, delete all survey
 * feedback and trail suggestions. Neither has a date on purpose (so it can't be
 * matched to a survey entry), so they can't expire one by one; deleting
 * everything once a year keeps the privacy page's promise that nothing is kept
 * for more than 12 months. Read them before then with `npm run feedback` and
 * `npm run trail-suggestions`.
 */
const { getDb, COLLECTIONS } = require('./utils/db');

exports.handler = async () => {
  try {
    const db = await getDb();
    const feedback = (await db.collection(COLLECTIONS.feedback).deleteMany({})).deletedCount;
    const suggestions = (await db.collection(COLLECTIONS.trailSuggestions).deleteMany({})).deletedCount;
    console.log(`Yearly cleanup: deleted ${feedback} feedback message(s) and ${suggestions} trail suggestion(s).`);
    return { statusCode: 200, body: `deleted ${feedback + suggestions}` };
  } catch (err) {
    console.error('Yearly cleanup failed:', err.message);
    return { statusCode: 503, body: 'database unavailable' };
  }
};
