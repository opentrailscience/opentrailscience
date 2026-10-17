/**
 * Inserts synthetic hikers into MongoDB for development (`npm run seed`).
 *
 * The records carry `isSynthetic: true`, so they never appear in the public
 * stats, preview or dataset files. Set INCLUDE_SYNTHETIC=true to see them locally.
 *
 *   npm run seed            # insert 65 records
 *   npm run seed -- 200     # insert 200 records
 */
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const { getDb, closeDatabase, COLLECTIONS } = require('../netlify/functions/utils/db');
const { generateSyntheticHikers } = require('./lib/synthetic-hikers');

async function main() {
  const count = parseInt(process.argv[2] || '65', 10);
  const db = await getDb();
  // Random ids like real submissions (an ObjectId would carry the insert time).
  const hikers = generateSyntheticHikers(count, { seed: Date.now() }).map(h => Object.assign({ _id: crypto.randomUUID() }, h));
  const result = await db.collection(COLLECTIONS.surveys).insertMany(hikers);
  console.log(`Inserted ${result.insertedCount} synthetic records (isSynthetic: true).`);
}

main()
  .catch(err => {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
