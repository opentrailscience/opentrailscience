/**
 * Anti-spam checks for survey submissions.
 *
 * 1. Honeypot: hidden inputs real users never fill in.
 * 2. Time trap: the form reports how many seconds it was open; nobody
 *    finishes five wizard steps in under MIN_FILL_SECONDS.
 * 3. Human check: a trail question plus a small proof of work, see
 *    public/lib/human-check.js.
 * 4. Throttle: at most THROTTLE_MAX requests per network per hour. A network
 *    is an IPv4 address or an IPv6 /64 block (one household's IPv6 range),
 *    so rotating IPv6 addresses doesn't escape the limit. Networks are stored
 *    only as an HMAC in a separate collection, which MongoDB empties after an
 *    hour (TTL index, created by `npm run db:setup`), never linked to answers.
 */
const crypto = require('crypto');
const HumanCheck = require('../../../public/lib/human-check');
const { COLLECTIONS } = require('./db');
const { header } = require('./http');

const HONEYPOT_FIELDS = ['website_url', 'hiker_anti_spam'];
const MIN_FILL_SECONDS = 20;
const THROTTLE_MAX = 10;
const THROTTLE_WINDOW_MS = 60 * 60 * 1000;

/** True if the payload looks automated. Bots get a fake success response. */
function isLikelySpam(body) {
  if (HONEYPOT_FIELDS.some(name => body[name])) return true;
  const elapsed = Number(body.formElapsedSeconds);
  return !Number.isFinite(elapsed) || elapsed < MIN_FILL_SECONDS;
}

/** The trail question was answered correctly and the proof of work matches these answers. */
function passesHumanCheck(body) {
  if (!HumanCheck.isCorrectTrailCheck(body.trailCheck)) return false;
  const nonce = Number(body.powNonce);
  if (!Number.isSafeInteger(nonce) || nonce < 0) return false;
  const answersHash = crypto.createHash('sha256').update(HumanCheck.answersString(body)).digest('hex');
  const digest = crypto.createHash('sha256').update(HumanCheck.powMessage(answersHash, nonce)).digest();
  return HumanCheck.hasLeadingZeroBits(digest, HumanCheck.POW_BITS);
}

function clientIp(event) {
  return header(event, 'x-nf-client-connection-ip') ||
    (header(event, 'x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown';
}

/**
 * The network an address belongs to: IPv4 as is, IPv6 as its /64 prefix
 * (e.g. "2001:db8:abcd:12::/64"). IPv4-mapped IPv6 (::ffff:1.2.3.4) is IPv4.
 */
function networkOf(ip) {
  const address = String(ip).trim().split('%')[0]; // drop an IPv6 zone id
  if (!address.includes(':')) return address;
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];

  const [head, tail] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const groups = address.includes('::')
    ? headGroups.concat(Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'), tailGroups)
    : headGroups;
  const prefix = groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16));
  while (prefix.length < 4) prefix.push('0');
  return `${prefix.join(':')}::/64`;
}

function networkKey(event) {
  const secret = process.env.THROTTLE_SECRET || process.env.MONGODB_URI || 'local-dev';
  return crypto.createHmac('sha256', secret).update(networkOf(clientIp(event))).digest('hex');
}

/**
 * Counts this request and returns true if its network is over the limit.
 * One atomic upsert per request: a counter per network, scope and hour.
 * Fails open: a throttle error never blocks a real hiker.
 */
async function isThrottled(db, event, now, scope) {
  try {
    const windowStart = new Date(Math.floor(now.getTime() / THROTTLE_WINDOW_MS) * THROTTLE_WINDOW_MS);
    const key = `${scope || 'submit'}:${networkKey(event)}:${windowStart.getTime()}`;
    const doc = await db.collection(COLLECTIONS.submissionThrottle).findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { createdAt: windowStart } },
      { upsert: true, returnDocument: 'after' }
    );
    return Boolean(doc && doc.count > THROTTLE_MAX);
  } catch (err) {
    console.warn('Throttle unavailable, allowing request:', err.message);
    return false;
  }
}

module.exports = { isLikelySpam, passesHumanCheck, isThrottled, networkOf, clientIp, MIN_FILL_SECONDS, THROTTLE_MAX, HONEYPOT_FIELDS };
