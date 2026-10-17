/**
 * Prints the survey feedback (`npm run feedback`). Read-only. Feedback has no
 * timestamps, so it is printed in the database's natural order.
 */
require('dotenv').config({ quiet: true });
const { getDb, closeDatabase, COLLECTIONS } = require('../netlify/functions/utils/db');

async function main() {
  const db = await getDb();
  const feedback = await db.collection(COLLECTIONS.feedback).find({}).toArray();
  if (!feedback.length) return console.log('No feedback yet.');
  feedback.forEach((f, i) => console.log(`--- ${i + 1} (schema ${f.schemaVersion})\n${f.message}\n`));
  console.log(`${feedback.length} ${feedback.length === 1 ? 'message' : 'messages'}.`);
}

main()
  .catch(err => {
    console.error('Reading feedback failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
