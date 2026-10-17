const { MongoClient, ServerApiVersion } = require('mongodb');

const COLLECTIONS = {
  // Survey records have a random UUID as _id: MongoDB's ObjectId would carry the submission time.
  surveys: 'surveys',
  // { _id: random UUID, codeHash, surveyId }: lets a hiker delete their record. No survey data, no date.
  deletionCodes: 'deletion_codes',
  submissionThrottle: 'submission_throttle',
  // One document counting changes since the last snapshot rebuild (utils/rebuild.js).
  snapshotState: 'snapshot_state',
  // { _id: random UUID, message, schemaVersion }: survey feedback. Never published,
  // and on purpose not linked to a survey record and without a timestamp.
  feedback: 'feedback'
};

let clientPromise = null;
let cachedDb = null;
let overrideDb = null;

/**
 * Returns the MongoDB database, reusing one client and one Db object per warm
 * function instance. The same Db object every time matters: callers cache
 * per database object (e.g. the peer list in submit.js), and the driver
 * creates a new object on every client.db() call.
 *
 * Timeouts stay below Netlify's 10-second function limit, so a slow or
 * unreachable database gives the hiker a clean "try again" (503) instead of a
 * killed function. One function instance handles one request at a time, so a
 * pool of 2 is plenty and keeps Atlas Free's 500-connection cap far away.
 */
async function getDb() {
  if (overrideDb) return overrideDb;
  if (cachedDb) return cachedDb;

  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI environment variable is not defined');

    const client = new MongoClient(uri, {
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
      maxPoolSize: 2,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 4000,
      connectTimeoutMS: 4000,
      socketTimeoutMS: 7000
    });
    // Forget a failed connection attempt so the next request retries.
    clientPromise = client.connect().catch(err => {
      clientPromise = null;
      throw err;
    });
  }

  const client = await clientPromise;
  cachedDb = client.db(process.env.MONGODB_DB || 'hikersurvey');
  return cachedDb;
}

/** Use another database object (the in-memory one for tests and offline dev). */
function useDatabase(db) {
  overrideDb = db;
}

async function closeDatabase() {
  cachedDb = null;
  if (clientPromise) {
    const client = await clientPromise.catch(() => null);
    clientPromise = null;
    if (client) await client.close();
  }
}

module.exports = { getDb, useDatabase, closeDatabase, COLLECTIONS };
