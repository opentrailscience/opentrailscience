const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../scripts/migrate-planned-distance');
const { freshDb } = require('./helpers');

test('1.9.0 migration: finished hikes planned what they hiked, the others stay unknown, and it runs once', async () => {
  const surveys = freshDb().collection('surveys');
  await surveys.insertMany([
    { _id: 'a', completionStatus: 'continuous_purist', totalDistanceMiles: 2650, totalDistanceKm: 4264.8 },
    { _id: 'b', completionStatus: 'flip_flop', totalDistanceMiles: 490, totalDistanceKm: 788.6 },
    { _id: 'c', completionStatus: 'skipped_sections', totalDistanceMiles: 2400, totalDistanceKm: 3862.4 },
    { _id: 'd', completionStatus: 'quit_early', totalDistanceMiles: 700, totalDistanceKm: 1126.5 },
    { _id: 'e', completionStatus: 'section_hike', totalDistanceMiles: 300, totalDistanceKm: 482.8, plannedDistanceMiles: 320, plannedDistanceKm: 515, plannedDistanceDerived: false }
  ]);

  const dry = await migrate(surveys, { apply: false });
  assert.deepEqual(dry, { copied: 2, unknown: 2, synthetic: 0 });
  assert.equal((await surveys.findOne({ _id: 'a' })).plannedDistanceDerived, undefined, 'a dry run writes nothing');

  assert.deepEqual(await migrate(surveys, { apply: true }), { copied: 2, unknown: 2, synthetic: 0 });
  const get = async id => { const r = await surveys.findOne({ _id: id }); return [r.plannedDistanceMiles, r.plannedDistanceKm, r.plannedDistanceDerived]; };
  assert.deepEqual(await get('a'), [2650, 4264.8, true]);
  assert.deepEqual(await get('b'), [490, 788.6, true]);
  assert.deepEqual(await get('c'), [null, null, null], 'skipped parts: the plan is unknown');
  assert.deepEqual(await get('d'), [null, null, null], 'ended early: the plan is unknown');
  assert.deepEqual(await get('e'), [320, 515, false], 'an answered question is never overwritten');

  assert.deepEqual(await migrate(surveys, { apply: true }), { copied: 0, unknown: 0, synthetic: 0 }, 'a second run changes nothing');
});
