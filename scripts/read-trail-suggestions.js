/**
 * Prints the trail suggestions (`npm run trail-suggestions`), grouped by trail,
 * most asked for first. Read-only, unless run with `-- --clear`, which deletes
 * all of them once you have reviewed them (new ones keep coming in).
 */
require('dotenv').config({ quiet: true });
const { getDb, closeDatabase, COLLECTIONS } = require('../netlify/functions/utils/db');

async function main() {
  const db = await getDb();
  const collection = db.collection(COLLECTIONS.trailSuggestions);
  if (process.argv.includes('--clear')) {
    const { deletedCount } = await collection.deleteMany({});
    return console.log(`Deleted ${deletedCount} trail ${deletedCount === 1 ? 'suggestion' : 'suggestions'}.`);
  }

  const suggestions = await collection.find({}).toArray();
  if (!suggestions.length) return console.log('No trail suggestions yet.');
  // Grouped case-insensitively; the first spelling seen is shown.
  const groups = new Map();
  suggestions.forEach(({ trail }) => {
    const key = trail.toLowerCase();
    const group = groups.get(key) || { trail, count: 0 };
    group.count++;
    groups.set(key, group);
  });
  [...groups.values()].sort((a, b) => b.count - a.count).forEach(g => console.log(`${String(g.count).padStart(4)}  ${g.trail}`));
  console.log(`\n${suggestions.length} ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}, ${groups.size} different.`);
}

main()
  .catch(err => {
    console.error('Reading trail suggestions failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
