/**
 * Schema 1.9.0: fills in the planned distance for hikes collected before the question existed
 * (`npm run db:migrate-planned-distance`, then `-- --apply` to write).
 *
 * Finished hikes (continuous or flip-flop) planned what they hiked: plannedDistanceMiles and
 * plannedDistanceKm are copied from totalDistanceMiles / totalDistanceKm (already rounded as
 * published) and plannedDistanceDerived is true. For every other hike the planned distance is
 * unknown: all three are null. Hikes that already have plannedDistanceDerived are left alone, so
 * running it twice changes nothing. Without --apply it only prints what it would do.
 */
require('dotenv').config({ quiet: true });
const { COMPLETED_STATUSES } = require('../public/lib/survey-schema');

/** The change for one record, or null if it already has the new columns. */
function plannedDistanceUpdate(record) {
  if (Object.prototype.hasOwnProperty.call(record, 'plannedDistanceDerived')) return null;
  const finished = COMPLETED_STATUSES.includes(record.completionStatus) && typeof record.totalDistanceMiles === 'number';
  return finished
    ? { plannedDistanceMiles: record.totalDistanceMiles, plannedDistanceKm: record.totalDistanceKm ?? null, plannedDistanceDerived: true }
    : { plannedDistanceMiles: null, plannedDistanceKm: null, plannedDistanceDerived: null };
}

async function migrate(surveys, { apply }) {
  const records = await surveys.find({ plannedDistanceDerived: { $exists: false } }).toArray();
  const changes = records.map(r => ({ r, set: plannedDistanceUpdate(r) })).filter(c => c.set);
  if (apply) {
    for (const { r, set } of changes) await surveys.updateOne({ _id: r._id, plannedDistanceDerived: { $exists: false } }, { $set: set });
  }
  return {
    copied: changes.filter(c => c.set.plannedDistanceDerived === true).length,
    unknown: changes.filter(c => c.set.plannedDistanceDerived === null).length,
    synthetic: changes.filter(c => c.r.isSynthetic).length
  };
}

async function main() {
  const { getDb, closeDatabase, COLLECTIONS } = require('../netlify/functions/utils/db');
  const apply = process.argv.includes('--apply');
  try {
    const result = await migrate((await getDb()).collection(COLLECTIONS.surveys), { apply });
    console.log(`${apply ? 'Updated' : 'Would update'}: ${result.copied} finished hikes get planned = hiked (plannedDistanceDerived true), ` +
      `${result.unknown} others get null${result.synthetic ? ` (${result.synthetic} of them synthetic)` : ''}.`);
    if (!apply) console.log('Nothing was written. Run again with --apply to write.');
  } finally {
    await closeDatabase();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { plannedDistanceUpdate, migrate };
