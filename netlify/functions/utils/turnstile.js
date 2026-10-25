/**
 * Cloudflare Turnstile: checks the token the survey page gets from Cloudflare
 * right before submitting (see "Cloudflare Turnstile" in public/app.js).
 *
 * Results:
 *   ok          the token is valid
 *   missing     no token sent (an old page, or a bot that skips the check)
 *   failed      invalid, expired or already used token
 *   unavailable Cloudflare could not be asked (down, slow, wrong secret): the
 *               submission goes through, the other checks in spam.js still apply
 *   skipped     no TURNSTILE_SECRET_KEY (local development, tests)
 *
 * Nothing from the check is stored.
 */
const crypto = require('crypto');

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 3000;
// Turnstile tokens are about 2,000 characters; anything far longer isn't one.
const MAX_TOKEN_CHARS = 4096;

let warnedMissingSecret = false;

async function checkTurnstile(token, ip, fetchImpl = fetch) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!warnedMissingSecret) {
      console.warn('TURNSTILE_SECRET_KEY is not set: submissions are not checked by Cloudflare Turnstile.');
      warnedMissingSecret = true;
    }
    return 'skipped';
  }
  if (typeof token !== 'string' || !token) return 'missing';
  if (token.length > MAX_TOKEN_CHARS) return 'failed';

  // The same idempotency key makes the retry safe: Cloudflare counts it as one check.
  const body = new URLSearchParams({ secret, response: token, idempotency_key: crypto.randomUUID() });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchImpl(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success === true) return 'ok';
      const codes = result['error-codes'] || [];
      if (codes.includes('internal-error')) throw new Error('internal-error');
      if (codes.some(code => code.includes('secret'))) {
        // Our setup is wrong, not the hiker: never turn everyone away because of it.
        console.error('Turnstile rejected the secret key (check TURNSTILE_SECRET_KEY):', codes.join(', '));
        return 'unavailable';
      }
      return 'failed';
    } catch (err) {
      if (attempt === 2) {
        console.error('Turnstile check unavailable, relying on the other checks:', err.message);
        return 'unavailable';
      }
    }
  }
  return 'unavailable';
}

module.exports = { checkTurnstile, SITEVERIFY };
