/**
 * Prints the survey entries that are in the database but not yet on the live site
 * (`npm run new-entries`): trail, home region and how long the survey took. Read-only.
 *
 * Records have no timestamps on purpose, so "new" means "not in the published
 * dataset": each database record is matched against a record of
 * opentrailscience.org/data/thru_hiker_survey_dataset.json with the same answers
 * (the published file adds metric columns, which are ignored). The order is
 * arbitrary, never the order the surveys came in.
 */
require('dotenv').config({ quiet: true });
const { isDeepStrictEqual } = require('util');
const { closeDatabase } = require('../netlify/functions/utils/db');
const { fetchPublicRecords } = require('../netlify/functions/utils/dataset');
const Schema = require('../public/lib/survey-schema');

const LIVE_DATASET = 'https://opentrailscience.org/data/thru_hiker_survey_dataset.json';

async function main() {
  const res = await fetch(LIVE_DATASET);
  if (!res.ok) throw new Error(`could not load the live dataset (HTTP ${res.status})`);
  const published = await res.json();
  const stored = await fetchPublicRecords();

  // Each published record can match one stored record only (two hikers can give identical answers).
  const unmatched = [...published];
  const fresh = stored.filter(record => {
    const i = unmatched.findIndex(p => Object.keys(record).every(k => isDeepStrictEqual(record[k], p[k])));
    if (i === -1) return true;
    unmatched.splice(i, 1);
    return false;
  });

  console.log(`Database: ${stored.length}. Live site: ${published.length}.`);
  if (!fresh.length) console.log('No new entries: the live site is up to date.');
  else {
    const show = v => (v == null ? '-' : String(v).replace(/_/g, ' '));
    const rows = fresh.map(r => [Schema.trailName(r.trail) || show(r.trail), show(r.homeRegion), show(r.surveyMinutesBand && `${r.surveyMinutesBand} min`)]);
    const head = ['Trail', 'Home region', 'Survey time'];
    const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
    const line = cells => cells.map((c, i) => c.padEnd(width[i])).join('   ');
    console.log(`\n${fresh.length} new ${fresh.length === 1 ? 'entry' : 'entries'}, not yet on the live site:\n`);
    console.log(line(head));
    rows.forEach(r => console.log(line(r)));
  }
  // Published records with no match left were deleted (with a personal code) since the last rebuild.
  if (unmatched.length) console.log(`\n${unmatched.length} on the live site ${unmatched.length === 1 ? 'was' : 'were'} deleted since the last rebuild.`);
}

main()
  .catch(err => {
    console.error('Reading new entries failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
