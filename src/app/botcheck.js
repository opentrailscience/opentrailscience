/**
 * Cloudflare Turnstile, the bot check before submitting.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, scrollMode, showToast, state } from './core.js';

// --- CLOUDFLARE TURNSTILE (bot check before submitting) -----------------------
// Loaded only on the last step, so visiting the site never contacts Cloudflare.
// It runs when the hiker presses Submit and only shows a box if Cloudflare wants
// an interaction. The server checks the token (netlify/functions/utils/turnstile.js).
// Away from the real domain, Cloudflare's test key is used, which always passes.
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_TEST_KEY = '1x00000000000000000000BB';
const TURNSTILE_TIMEOUT_MS = 20000;
const TURNSTILE_SLOW = "Cloudflare's bot check didn't answer in time. Please press Submit again. Your answers are saved.";
const TURNSTILE_BLOCKED = "Cloudflare's bot check couldn't load. Please allow challenges.cloudflare.com (for example in your ad blocker) or try another browser. Your answers are saved.";
const botCheck = { script: null, loading: null, widget: null, used: false, waiting: null };

function turnstileSiteKey() {
  return location.hostname === 'opentrailscience.org' ? $('turnstile-box').dataset.sitekey : TURNSTILE_TEST_KEY;
}

/**
 * Cloudflare's script is downloaded as soon as the hiker starts the survey (only
 * on the survey page, never just from visiting the site), so a browser that
 * blocks it gets a banner on the first step instead of a dead end after ten
 * minutes. The widget is drawn and the check runs only on the last step.
 */
export function loadTurnstileIfStarted() {
  if (state.currentView !== 'survey' || !state.consentGiven) return;
  loadTurnstileScript().then(() => setBotCheckBanner(false), () => setBotCheckBanner(true));
  if (state.currentStep === state.totalSteps) loadTurnstile().catch(() => {});
}

/**
 * Blocked: the banner shows and the form is locked (inert: no typing, tapping or
 * focus), so nobody fills in ten minutes of answers that can't be sent.
 */
function setBotCheckBanner(blocked) {
  const banner = $('bot-check-banner');
  const wasHidden = banner.classList.contains('hidden');
  banner.classList.toggle('hidden', !blocked);
  $('survey-form').inert = blocked;
  $('survey-form').classList.toggle('opacity-40', blocked);
  if (blocked && wasHidden) banner.scrollIntoView({ behavior: scrollMode(), block: 'center' });
}

/** Downloads Cloudflare's script once; a failed download can be retried. */
function loadTurnstileScript() {
  if (botCheck.script) return botCheck.script;
  botCheck.script = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve() : reject(new Error('Turnstile missing')));
    script.onerror = () => { script.remove(); reject(new Error('Turnstile blocked')); };
    document.head.appendChild(script);
  });
  botCheck.script.catch(() => { botCheck.script = null; });
  return botCheck.script;
}

/** The script plus the (invisible) widget, drawn once on the last step. */
function loadTurnstile() {
  if (botCheck.loading) return botCheck.loading;
  botCheck.loading = loadTurnstileScript().then(() => {
    botCheck.widget = window.turnstile.render('#turnstile-widget', {
      sitekey: turnstileSiteKey(),
      action: 'submit',
      execution: 'execute',
      appearance: 'interaction-only',
      // Cloudflare's normal box is 300 px wide; on the narrowest phones use the compact one.
      size: $('turnstile-widget').clientWidth < 300 ? 'compact' : 'normal',
      // The site's own light/dark choice, not the system's (Cloudflare's default).
      theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
      callback: token => { if (botCheck.waiting) botCheck.waiting.resolve(token); },
      'error-callback': () => { if (botCheck.waiting) botCheck.waiting.reject(new Error(TURNSTILE_BLOCKED)); },
      'timeout-callback': () => { if (botCheck.waiting) botCheck.waiting.reject(new Error(TURNSTILE_SLOW)); },
      'expired-callback': () => { if (botCheck.waiting) botCheck.waiting.reject(new Error(TURNSTILE_SLOW)); }
    });
  });
  // A failed load can be retried with the next press of Submit.
  botCheck.loading.catch(() => { botCheck.loading = null; });
  return botCheck.loading;
}

export function initBotCheckBanner() {
  $('btn-bot-check-retry').addEventListener('click', () => {
    $('btn-bot-check-retry').disabled = true;
    loadTurnstileScript()
      .then(() => { setBotCheckBanner(false); showToast('Cloudflare loaded. You can submit at the end.'); },
        () => setBotCheckBanner(true))
      .finally(() => { $('btn-bot-check-retry').disabled = false; });
  });
}

/** A fresh token for one submission: tokens are single-use and valid for 5 minutes. */
export async function getBotCheckToken() {
  try {
    await loadTurnstile();
  } catch (err) {
    throw new Error(TURNSTILE_BLOCKED);
  }
  if (botCheck.used) window.turnstile.reset(botCheck.widget);
  botCheck.used = true;
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      botCheck.waiting = { resolve, reject };
      timer = setTimeout(() => reject(new Error(TURNSTILE_SLOW)), TURNSTILE_TIMEOUT_MS);
      window.turnstile.execute(botCheck.widget);
    });
  } finally {
    clearTimeout(timer);
    botCheck.waiting = null;
  }
}
