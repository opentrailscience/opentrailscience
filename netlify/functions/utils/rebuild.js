/**
 * Decides when to rebuild the public snapshot (a Netlify deploy via the
 * BUILD_HOOK_URL build hook). Page views only read the snapshot files, so
 * this is the only way new answers reach the site.
 *
 * Budget (legacy Netlify Free plan: 300 build minutes a month, about one
 * minute per build):
 *   - after REBUILD_AFTER_CHANGES new submissions or deletions,
 *   - but at most once every MIN_HOURS_BETWEEN_REBUILDS hours,
 *   - plus the nightly scheduled function, which rebuilds if anything is
 *     still waiting (and nothing was triggered in the last hour).
 * Worst case: 4 data rebuilds a day, about 120 build minutes a month.
 *
 * State lives in one document of the `snapshot_state` collection:
 *   pending        changes not yet in a built snapshot
 *   lastTriggerAt  when the build hook was last called
 *   lastBuildAt    when a build last exported the data
 * Only a build that actually exported the data lowers `pending`
 * (noteSnapshotBuilt, called by scripts/export-static-dataset.js in production
 * builds). So every production deploy, including code deploys, counts as a rebuild, and a build that
 * fails leaves the changes waiting for the next trigger.
 * Claiming a trigger is a single conditional update, so two simultaneous
 * submissions can't both call the build hook.
 */
const { COLLECTIONS } = require('./db');

const REBUILD_AFTER_CHANGES = 5;
const MIN_HOURS_BETWEEN_REBUILDS = 6;
// The nightly run retries a build that was triggered but never finished.
const NIGHTLY_MIN_HOURS_SINCE_TRIGGER = 1;
const STATE_ID = 'public-snapshot';
const HOUR = 3600 * 1000;
let warnedMissingHook = false; // warn once per function instance

function state(db) {
  return db.collection(COLLECTIONS.snapshotState);
}

/** Calls the Netlify build hook. Never throws: a failed trigger is retried by the next change or night. */
async function triggerBuild(reason) {
  const hook = process.env.BUILD_HOOK_URL;
  if (!hook) {
    console.warn(`BUILD_HOOK_URL is not set; skipping snapshot rebuild (${reason}).`);
    return false;
  }
  try {
    const res = await fetch(`${hook}?trigger_title=${encodeURIComponent(`Dataset rebuild: ${reason}`)}`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000) // never hold up the hiker's request for long
    });
    if (!res.ok) throw new Error(`build hook returned ${res.status}`);
    console.log(`Triggered snapshot rebuild: ${reason}`);
    return true;
  } catch (err) {
    console.error('Snapshot rebuild trigger failed:', err.message);
    return false;
  }
}

/**
 * Calls the build hook if at least minChanges are pending and the last
 * trigger is at least minGapMs ago. Only the caller that wins the
 * conditional update calls the hook; if the call fails, the claim is undone.
 */
async function claimAndRebuild(db, now, minChanges, minGapMs, reason) {
  const current = await state(db).findOne({ _id: STATE_ID });
  if (!current || current.pending < minChanges) return false;
  const last = current.lastTriggerAt;
  if (last && now.getTime() - last.getTime() < minGapMs) return false;

  const result = await state(db).updateOne(
    { _id: STATE_ID, lastTriggerAt: last || { $exists: false } },
    { $set: { lastTriggerAt: now } }
  );
  if (result.modifiedCount !== 1) return false;
  if (await triggerBuild(reason)) return true;
  await state(db).updateOne({ _id: STATE_ID, lastTriggerAt: now }, { $set: { lastTriggerAt: new Date(0) } });
  return false;
}

/**
 * Records one change to the public data (a submission or deletion) and
 * triggers a rebuild if enough changes are waiting. Never blocks or fails
 * the request that caused it.
 */
async function notePublicChange(db, now) {
  try {
    await state(db).updateOne(
      { _id: STATE_ID },
      { $inc: { pending: 1 }, $setOnInsert: { lastTriggerAt: new Date(0) } },
      { upsert: true }
    );
    // Without a build hook (local development) changes are only counted.
    if (!process.env.BUILD_HOOK_URL) {
      if (!warnedMissingHook) {
        console.warn('BUILD_HOOK_URL is not set: new answers are counted but the public snapshot is never rebuilt.');
        warnedMissingHook = true;
      }
      return false;
    }
    return await claimAndRebuild(db, now, REBUILD_AFTER_CHANGES, MIN_HOURS_BETWEEN_REBUILDS * HOUR,
      `${REBUILD_AFTER_CHANGES}+ new answers`);
  } catch (err) {
    console.warn('Could not record snapshot change:', err.message);
  }
  return false;
}

/** Nightly: rebuild if anything is still waiting, unless a build was just triggered. */
async function rebuildIfPending(db, now) {
  if (await claimAndRebuild(db, now, 1, NIGHTLY_MIN_HOURS_SINCE_TRIGGER * HOUR, 'nightly catch-up')) return true;
  console.log('No rebuild triggered (nothing waiting, a build was triggered within the hour, or the build hook failed).');
  return false;
}

/**
 * Build: the number of changes waiting before the data is read. Changes
 * that arrive while the build runs stay pending for the next one.
 */
async function pendingChanges(db) {
  const current = await state(db).findOne({ _id: STATE_ID });
  return (current && current.pending) || 0;
}

/** Build: the data was exported, so the changes counted before reading it are done. */
async function noteSnapshotBuilt(db, pendingAtStart, now) {
  const update = { $set: { lastBuildAt: now }, $setOnInsert: { lastTriggerAt: new Date(0) } };
  if (pendingAtStart > 0) update.$inc = { pending: -pendingAtStart };
  else update.$setOnInsert.pending = 0;
  await state(db).updateOne({ _id: STATE_ID }, update, { upsert: true });
}

module.exports = {
  notePublicChange, rebuildIfPending, pendingChanges, noteSnapshotBuilt, triggerBuild,
  REBUILD_AFTER_CHANGES, MIN_HOURS_BETWEEN_REBUILDS, NIGHTLY_MIN_HOURS_SINCE_TRIGGER, STATE_ID
};
