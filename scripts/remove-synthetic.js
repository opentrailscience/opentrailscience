/**
 * Deletes every synthetic survey (isSynthetic: true) from MongoDB
 * (`npm run db:remove-synthetic`). Real answers are not touched. Run it
 * before the public launch, against the database in MONGODB_URI.
 */
require('dotenv').config({ quiet: true });
const { getDb, closeDatabase, COLLECTIONS } = require('../netlify/functions/utils/db');

async function main() {
  const surveys = (await getDb()).collection(COLLECTIONS.surveys);
  const result = await surveys.deleteMany({ isSynthetic: true });
  const left = await surveys.countDocuments({});
  console.log(`Deleted ${result.deletedCount} synthetic records. ${left} real records remain.`);
}

main()
  .catch(err => {
    console.error('Removing synthetic records failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
