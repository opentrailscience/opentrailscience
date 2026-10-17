/**
 * Deletion codes: after submitting, a hiker gets a random code that deletes
 * their record. Only a SHA-256 hash of the code is stored, next to the
 * record's internal id, in a separate collection that holds no survey data.
 *
 * Codes are 16 characters of Crockford base32 (80 bits), shown in groups of
 * four: e.g. 7K3Q-M9XD-2WPA-HV4T. Too many to guess.
 */
const crypto = require('crypto');
const { COLLECTIONS } = require('./db');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U

function generateCode() {
  const bytes = crypto.randomBytes(16);
  let code = '';
  for (let i = 0; i < 16; i++) code += ALPHABET[bytes[i] % 32];
  return code.match(/.{4}/g).join('-');
}

/** Uppercase, drop spaces/dashes, map look-alikes (O→0, I/L→1) as Crockford does. */
function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');
}

/** Stores the code's hash next to the record's id, with a random id and no date (the submission time is never stored). */
async function createDeletionCode(db, surveyId) {
  const code = generateCode();
  await db.collection(COLLECTIONS.deletionCodes).insertOne({ _id: crypto.randomUUID(), codeHash: hashCode(code), surveyId });
  return code;
}

/** The hike belonging to `code` (with its _id), or null. */
async function findByCode(db, code) {
  const normalized = normalizeCode(code);
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(normalized)) return null;
  const entry = await db.collection(COLLECTIONS.deletionCodes).findOne({ codeHash: hashCode(normalized) });
  if (!entry) return null;
  return db.collection(COLLECTIONS.surveys).findOne({ _id: entry.surveyId });
}

/** Deletes the record belonging to `code`. Returns true if something was deleted. */
async function deleteByCode(db, code) {
  const normalized = normalizeCode(code);
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(normalized)) return false;
  const codes = db.collection(COLLECTIONS.deletionCodes);
  const entry = await codes.findOne({ codeHash: hashCode(normalized) });
  if (!entry) return false;
  await db.collection(COLLECTIONS.surveys).deleteOne({ _id: entry.surveyId });
  await codes.deleteOne({ codeHash: entry.codeHash });
  return true;
}

module.exports = { generateCode, normalizeCode, hashCode, createDeletionCode, findByCode, deleteByCode };
