/**
 * Writes the prebuilt snapshot files to public/data (see buildSnapshot):
 * the dataset as JSON and CSV, schema.json, and the preview.json / stats.json /
 * insights.json that the website reads instead of calling the database on every page view.
 * Runs on every Netlify build: deploys of new code as well as the data
 * rebuilds that utils/rebuild.js triggers through the build hook.
 *
 * Afterwards a production build on Netlify (CONTEXT=production) tells
 * utils/rebuild.js how many changes it covered, so a build that fails
 * before this point is retried later. Local builds and deploy previews
 * don't update the live site, so they only read.
 *
 * If MONGODB_URI is set and the database cannot be read, the script fails so
 * the build fails and the previous deploy (with its dataset) stays live.
 * Without MONGODB_URI (local builds) it writes an empty dataset.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { fetchPublicRecords, buildSnapshot } = require('../netlify/functions/utils/dataset');
const { getDb, closeDatabase } = require('../netlify/functions/utils/db');
const { pendingChanges, noteSnapshotBuilt } = require('../netlify/functions/utils/rebuild');

const OUT_DIR = path.join(__dirname, '../public/data');

function writeDataset(records, outDir) {
  const dir = outDir || OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  Object.entries(buildSnapshot(records)).forEach(([name, content]) => {
    fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  });
}

async function exportStaticData(outDir) {
  if (!process.env.MONGODB_URI) {
    console.warn('MONGODB_URI is not set: writing an empty dataset.');
    writeDataset([], outDir);
    return 0;
  }

  try {
    const db = await getDb();
    const isLiveBuild = process.env.CONTEXT === 'production';
    // Read the counter before the data, so changes during the build stay pending.
    const pending = isLiveBuild ? await pendingChanges(db) : 0;
    const records = await fetchPublicRecords();
    console.log(`Fetched ${records.length} public records from MongoDB.`);
    writeDataset(records, outDir);
    if (isLiveBuild) {
      try {
        await noteSnapshotBuilt(db, pending, new Date());
      } catch (err) {
        // The files are written; at worst the next change triggers one extra build.
        console.warn('Could not record the rebuild:', err.message);
      }
    }
    console.log(`Wrote ${records.length} records to ${path.relative(process.cwd(), outDir || OUT_DIR)}/ (dataset, preview, stats, insights, schema)`);
    return records.length;
  } finally {
    await closeDatabase();
  }
}

if (require.main === module) {
  exportStaticData().catch(err => {
    console.error('Dataset export failed:', err.message);
    process.exit(1);
  });
}

module.exports = { exportStaticData, writeDataset };
