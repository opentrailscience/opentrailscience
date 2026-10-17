/**
 * Public dataset access: which records are public, which fields they expose,
 * their order, and the prebuilt snapshot files. Used by the snapshot build
 * script, the submit function and the dev server so they all publish the same thing.
 *
 * Page views (stats, preview, insights) only ever read the snapshot files,
 * which the CDN serves without any function call or database read.
 */
const { PUBLIC_COLUMNS, TRAILS, describeSchema } = require('../../../public/lib/survey-schema');
const { computeStats } = require('../../../public/lib/survey-stats');
const { computeInsights } = require('./insights');
const { getDb, COLLECTIONS } = require('./db');

const DATASET_BASENAME = 'thru_hiker_survey_dataset';

// Columns of the Live Data Preview table (public/data/preview.json).
const PREVIEW_FIELDS = [
  'trail', 'hikeYear', 'direction', 'baseWeightLbs', 'averageDailyMiles', 'backpackType',
  'cookSystem', 'sleepPadType', 'completionStatus', 'severeInjuryOccurred', 'overallEnjoymentRating'
];

// Never expose MongoDB ids or the internal synthetic flag.
const PUBLIC_PROJECTION = { _id: 0, isSynthetic: 0 };

/**
 * Query filter for public records. Synthetic (seed) records are excluded
 * unless INCLUDE_SYNTHETIC=true, which offline development uses.
 */
function publicFilter(extra) {
  const filter = Object.assign({}, extra);
  if (process.env.INCLUDE_SYNTHETIC !== 'true') {
    filter.isSynthetic = { $ne: true };
  }
  return filter;
}

async function surveysCollection() {
  const db = await getDb();
  return db.collection(COLLECTIONS.surveys);
}

/** All public records, in publication order (see publicOrder). */
async function fetchPublicRecords(projection) {
  const collection = await surveysCollection();
  const records = await collection.find(publicFilter(), { projection: projection || PUBLIC_PROJECTION }).toArray();
  return publicOrder(records);
}

/**
 * Orders records by trail, year and start month, in random order within a
 * group. Never by submission order: otherwise the newest row could be linked
 * to someone who just said they took the survey.
 */
function publicOrder(records, random) {
  const rand = random || Math.random;
  const trailIndex = trail => {
    const i = TRAILS.indexOf(trail);
    return i === -1 ? TRAILS.length : i;
  };
  return records
    .map(record => ({ record, tiebreak: rand() }))
    .sort((a, b) =>
      trailIndex(a.record.trail) - trailIndex(b.record.trail) ||
      (b.record.hikeYear || 0) - (a.record.hikeYear || 0) ||
      String(a.record.startMonth || '').localeCompare(String(b.record.startMonth || '')) ||
      a.tiebreak - b.tiebreak)
    .map(item => item.record);
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = Array.isArray(value) ? value.join(';') : String(value);
  return /[",\n\r]/.test(str) || Array.isArray(value) ?`"${str.replace(/"/g, '""')}"` : str;
}

/** RFC 4180 CSV with one column per schema field; arrays are ';'-joined. */
function toCSV(records) {
  const rows = [PUBLIC_COLUMNS.join(',')];
  (records || []).forEach(record => {
    rows.push(PUBLIC_COLUMNS.map(col => escapeCSV(record[col])).join(','));
  });
  return rows.join('\r\n') + '\r\n';
}

/**
 * A record as published: exactly the documented columns, in column order, with
 * null for a column the record doesn't have. Fields that are not (or no longer)
 * public, e.g. from an old schema version, never leave the database.
 */
function toPublicRecord(record) {
  return Object.fromEntries(PUBLIC_COLUMNS.map(col => [col, record[col] === undefined ? null : record[col]]));
}

/**
 * Every prebuilt file in public/data, keyed by file name. Written by
 * scripts/export-static-dataset.js and served by the CDN.
 */
function buildSnapshot(records, now) {
  const generatedAt = (now || new Date()).toISOString();
  const ordered = publicOrder(records);
  const preview = ordered.map(r => Object.fromEntries(PREVIEW_FIELDS.map(f => [f, r[f] === undefined ? null : r[f]])));
  const stats = Object.assign(computeStats(ordered), { lastUpdated: generatedAt });
  return {
    [`${DATASET_BASENAME}.json`]: JSON.stringify(ordered.map(toPublicRecord)) + '\n',
    [`${DATASET_BASENAME}.csv`]: toCSV(ordered),
    'preview.json': JSON.stringify({ generatedAt, total: preview.length, data: preview }) + '\n',
    'stats.json': JSON.stringify(stats) + '\n',
    'insights.json': JSON.stringify(Object.assign(computeInsights(ordered), { generatedAt })) + '\n',
    'schema.json': JSON.stringify(describeSchema(now), null, 2) + '\n'
  };
}

module.exports = {
  PUBLIC_PROJECTION, PREVIEW_FIELDS, DATASET_BASENAME,
  publicFilter, publicOrder, surveysCollection, fetchPublicRecords, toPublicRecord, toCSV, buildSnapshot
};
