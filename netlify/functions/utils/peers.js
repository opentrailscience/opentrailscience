/**
 * The peer list behind "How you compare" (submit and my-hike). Peers are
 * read at most every PEER_CACHE_MS per warm instance, so a launch-day rush
 * doesn't re-read the whole collection on every request (Atlas Free allows
 * 10 GB out per week).
 */
const { compareToPeers, COMPARISON_FIELDS } = require('../../../public/lib/survey-stats');
const { COLLECTIONS } = require('./db');
const { publicFilter } = require('./dataset');

const PEER_CACHE_MS = 10 * 60 * 1000;
const peerCache = new WeakMap(); // db -> { at, records }

async function peers(db) {
  let cached = peerCache.get(db);
  if (!cached || Date.now() - cached.at > PEER_CACHE_MS) {
    const projection = Object.fromEntries(COMPARISON_FIELDS.map(f => [f, 1]));
    cached = { at: Date.now(), records: await db.collection(COLLECTIONS.surveys).find(publicFilter(), { projection }).toArray() };
    peerCache.set(db, cached);
  }
  return cached;
}

/**
 * "Your base weight was lighter than 70% of PCT hikers", or null. Leaves out
 * the record `ownId` (the hiker's own hike, when looking it up later). Never
 * throws: a comparison is a bonus, not a requirement.
 */
async function comparisonFor(db, record, ownId) {
  try {
    const { records } = await peers(db);
    const others = ownId ? records.filter(r => String(r._id) !== String(ownId)) : records;
    return compareToPeers(record, others);
  } catch (err) {
    console.warn('Peer comparison unavailable:', err.message);
    return null;
  }
}

/** A newly stored hike joins the cached peers right away. */
function addPeer(db, record, id) {
  const cached = peerCache.get(db);
  if (cached) cached.records.push(Object.assign({ _id: id }, Object.fromEntries(COMPARISON_FIELDS.map(f => [f, record[f]]))));
}

module.exports = { comparisonFor, addPeer, PEER_CACHE_MS };
