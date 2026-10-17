/**
 * Scheduled function (see netlify.toml): every 1 January, delete all survey
 * feedback. Feedback has no date on purpose (so it can't be matched to a
 * survey entry), so it can't expire message by message; deleting everything
 * once a year keeps the privacy page's promise that no message is kept for
 * more than 12 months. Read it before then with `npm run feedback`.
 */
const { getDb, COLLECTIONS } = require('./utils/db');

exports.handler = async () => {
  try {
    const db = await getDb();
    const { deletedCount } = await db.collection(COLLECTIONS.feedback).deleteMany({});
    console.log(`Yearly feedback cleanup: deleted ${deletedCount} message(s).`);
    return { statusCode: 200, body: `deleted ${deletedCount}` };
  } catch (err) {
    console.error('Yearly feedback cleanup failed:', err.message);
    return { statusCode: 503, body: 'database unavailable' };
  }
};
