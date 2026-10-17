/**
 * Human check before submitting, shared by the browser and the server.
 *
 * 1. Trail check: "Which of these would a thru-hiker leave at home?" with
 *    three real pieces of gear and one absurd item. Stops generic form bots.
 * 2. Proof of work: the browser hashes the answers once, then finds a number
 *    (nonce) so that SHA-256(POW_PREFIX + answers hash + nonce) starts with
 *    POW_BITS zero bits.
 *    That takes the browser about a second (plain JavaScript, no Web Crypto,
 *    so it works in every browser and on any page), the server checks it with one
 *    hash, and because it is tied to the exact answers it can't be reused
 *    for other submissions: every fake hike costs real computing time.
 *
 * Neither is stored, and nothing is sent to a third party. A determined bot
 * that runs this code can still pass; together with the throttle it makes
 * mass faking slow and expensive.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./survey-schema'));
  } else {
    root.HumanCheck = factory(root.SurveySchema);
  }
})(typeof self !== 'undefined' ? self : this, function (Schema) {
  'use strict';

  // ~32,000 hashes on average: about a second on a phone, two hashes to verify.
  const PRODUCTION_POW_BITS = 15;
  // Node's test runner sets NODE_TEST_CONTEXT; tests use an easy puzzle so the
  // suite stays fast. Browsers and deployed functions always use the full one.
  const POW_BITS = typeof process !== 'undefined' && process.env && process.env.NODE_TEST_CONTEXT ? 8 : PRODUCTION_POW_BITS;
  const POW_PREFIX = 'ots-trail-check-v1|';

  const TRAIL_CHECKS = [
    { id: 'skillet', gear: ['🔦 Headlamp', '💧 Water filter', '🧥 Rain jacket'], odd: '🍳 Cast-iron skillet' },
    { id: 'bowling', gear: ['🥢 Trekking poles', '⛺ Tent stakes', '🧴 Sunscreen'], odd: '🎳 Bowling ball' },
    { id: 'piano', gear: ['🥄 Long spoon', '🛏️ Sleeping pad', '🩹 First-aid kit'], odd: '🎹 Grand piano' },
    { id: 'flamingo', gear: ['🗺️ Map', '🔥 Lighter', '🧦 Spare socks'], odd: '🦩 Inflatable pool flamingo' },
    { id: 'ironing', gear: ['🪥 Toothbrush', '🍫 Snacks', '🧭 Compass'], odd: '👔 Ironing board' },
    { id: 'sink', gear: ['🧢 Sun hat', '🧂 Electrolytes', '🎒 Rain cover'], odd: '🚰 The kitchen sink' },
    { id: 'chair', gear: ['🧻 Trowel & TP', '🩴 Camp shoes', '🔋 Battery pack'], odd: '🪑 Office chair' }
  ];

  const CHECKS_BY_ID = Object.fromEntries(TRAIL_CHECKS.map(c => [c.id, c]));

  /** True if `choice` is the item that doesn't belong in round `id`. */
  function isCorrectTrailCheck(answer) {
    if (!answer || typeof answer !== 'object') return false;
    const round = CHECKS_BY_ID[answer.id];
    return Boolean(round && answer.choice === round.odd);
  }

  /** The answers in a fixed order, identical in the browser and on the server. */
  function answersString(answers) {
    return JSON.stringify(Schema.FIELDS.filter(f => !f.derived).map(f => (answers[f.name] === undefined ? null : answers[f.name])));
  }

  /** What each proof-of-work attempt hashes: short, so attempts are cheap. */
  function powMessage(answersHash, nonce) {
    return `${POW_PREFIX}${answersHash}|${nonce}`;
  }

  // --- SHA-256 in plain JavaScript ---------------------------------------------
  // Web Crypto (crypto.subtle) only exists on HTTPS pages and in newer
  // browsers, so the browser uses this instead and works everywhere. The
  // server checks with Node's crypto; test/human-check.test.js compares both.
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const W = new Uint32Array(64);

  /** UTF-8 bytes of a string (no TextEncoder needed). */
  function utf8(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low < 0xe000) { code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00); i++; }
      }
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return bytes;
  }

  /** SHA-256 of a string (UTF-8), as 32 bytes. */
  function sha256(text) {
    const bytes = utf8(text);
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLength >>> (i * 8)) & 0xff);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    for (let block = 0; block < bytes.length; block += 64) {
      for (let t = 0; t < 16; t++) {
        const j = block + t * 4;
        W[t] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
      }
      for (let t = 16; t < 64; t++) {
        const a = W[t - 15], b = W[t - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let t = 0; t < 64; t++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    const out = new Uint8Array(32);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => {
      out[i * 4] = word >>> 24; out[i * 4 + 1] = (word >>> 16) & 0xff; out[i * 4 + 2] = (word >>> 8) & 0xff; out[i * 4 + 3] = word & 0xff;
    });
    return out;
  }

  function toHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function hasLeadingZeroBits(bytes, bits) {
    let remaining = bits;
    for (let i = 0; remaining > 0; i++) {
      const byte = bytes[i];
      if (remaining >= 8) {
        if (byte !== 0) return false;
        remaining -= 8;
      } else {
        return (byte >> (8 - remaining)) === 0;
      }
    }
    return true;
  }

  /**
   * Browser: finds a nonce for these answers. Pure JavaScript, so it works on
   * any page and in any browser; it pauses every few thousand attempts so the
   * page stays responsive. Resolves to the nonce.
   */
  async function solveProofOfWork(answers, maxAttempts) {
    const answersHash = toHex(sha256(answersString(answers)));
    const limit = maxAttempts || 1 << 22;
    const batch = 4096;
    for (let start = 0; start < limit; start += batch) {
      for (let nonce = start; nonce < start + batch; nonce++) {
        if (hasLeadingZeroBits(sha256(powMessage(answersHash, nonce)), POW_BITS)) return nonce;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error('The trail check took too long. Please try again.');
  }

  return { TRAIL_CHECKS, POW_BITS, PRODUCTION_POW_BITS, isCorrectTrailCheck, answersString, powMessage, hasLeadingZeroBits, sha256, solveProofOfWork };
});
