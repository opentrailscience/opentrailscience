const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');

test('getDb returns the same Db object every time (the peer cache depends on it)', async () => {
  // Pretend to connect, so no real database is needed.
  const realConnect = MongoClient.prototype.connect;
  MongoClient.prototype.connect = async function () { return this; };
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/test';
  const db = require('../netlify/functions/utils/db');
  try {
    const first = await db.getDb();
    const second = await db.getDb();
    assert.equal(first, second);
    // The real driver creates a new object per client.db() call, which is why getDb caches it.
    const client = new MongoClient('mongodb://127.0.0.1:1');
    assert.notEqual(client.db('x'), client.db('x'));
  } finally {
    MongoClient.prototype.connect = realConnect;
    await db.closeDatabase().catch(() => {});
    delete process.env.MONGODB_URI;
  }
});

test('database timeouts stay below the 10-second function limit', () => {
  const source = require('fs').readFileSync(require.resolve('../netlify/functions/utils/db'), 'utf-8');
  for (const option of ['serverSelectionTimeoutMS', 'connectTimeoutMS', 'socketTimeoutMS']) {
    const match = source.match(new RegExp(`${option}: (\\d+)`));
    assert.ok(match && Number(match[1]) < 10000, option);
  }
});
