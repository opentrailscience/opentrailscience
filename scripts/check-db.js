/** Verifies the MongoDB connection and prints record counts (`npm run db:check`). */
require('dotenv').config({ quiet: true });
const { getDb, closeDatabase, COLLECTIONS } = require('../netlify/functions/utils/db');

async function main() {
  const db = await getDb();
  await db.command({ ping: 1 });
  const surveys = db.collection(COLLECTIONS.surveys);
  const [total, synthetic] = await Promise.all([
    surveys.countDocuments({}),
    surveys.countDocuments({ isSynthetic: true })
  ]);
  console.log('Connected to MongoDB.');
  console.log(`Surveys: ${total} total, ${total - synthetic} real, ${synthetic} synthetic.`);
}

main()
  .catch(err => {
    console.error('MongoDB check failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
