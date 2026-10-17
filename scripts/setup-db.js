/**
 * Creates the indexes the app relies on (`npm run db:setup`). Safe to run
 * repeatedly: existing indexes are left as they are. Run once before the first
 * deploy, against the database in MONGODB_URI.
 *
 *   deletion_codes      unique codeHash  -> fast, exact lookups on /api/delete
 *   submission_throttle TTL on createdAt -> hourly counters vanish after their hour
 *   submission_throttle unique key       -> one counter per network, scope and hour
 *
 * The surveys collection needs no index: it is only inserted into, deleted
 * from by _id, and read in full for snapshot rebuilds and peer comparisons.
 */
require('dotenv').config({ quiet: true });
const { getDb, closeDatabase, COLLECTIONS } = require('../netlify/functions/utils/db');

async function main() {
  const db = await getDb();
  await db.command({ ping: 1 });

  await db.collection(COLLECTIONS.deletionCodes).createIndex({ codeHash: 1 }, { unique: true, name: 'codeHash_unique' });
  // Counters are per network and hour; createdAt is the start of that hour,
  // so each counter disappears about an hour later.
  await db.collection(COLLECTIONS.submissionThrottle).createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });
  await db.collection(COLLECTIONS.submissionThrottle).createIndex({ key: 1 }, { unique: true, name: 'key_unique' });

  for (const name of [COLLECTIONS.deletionCodes, COLLECTIONS.submissionThrottle]) {
    const indexes = await db.collection(name).indexes();
    console.log(`${name}: ${indexes.map(i => i.name).join(', ')}`);
  }
  console.log(`Database "${db.databaseName}" is ready.`);
}

main()
  .catch(err => {
    console.error('Database setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
