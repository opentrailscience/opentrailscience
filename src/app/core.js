/**
 * Shared by every part of the page: the libraries, the state, small helpers and toasts.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
export const Schema = window.SurveySchema;
export const Stats = window.SurveyStats;
export const HumanCheck = window.HumanCheck;

// Page views only read prebuilt files (served by the CDN, no function or
// database call). They are rebuilt by scripts/export-static-dataset.js.
export const STATIC_INSIGHTS_URL = '/data/insights.json';
export const STATIC_STATS_URL = '/data/stats.json';
export const STATIC_PREVIEW_URL = '/data/preview.json';
// Below this many public records the home page and Insights show a
// "be part of the first 50" invitation instead of statistics.
export const FIRST_HIKERS_GOAL = 50;
export const STONES_PER_CAIRN = 5;

// --- STATE STORE ---
export const state = {
  currentView: 'home',
  currentStep: 1,
  totalSteps: 5,
  unitSystem: 'imperial', // 'imperial' (lbs, in, mi) or 'metric' (kg, cm, km)
  stats: null,
  previewPage: 1,
  previewRows: null, // preview.json, loaded once
  previewLimit: 8,
  pillSelections: {}, // multi-select questions: field name -> Set of values
  consentGiven: false,
  unknownFields: new Set(), // fields answered "Don't know"
  touchedSliders: new Set(), // sliders count as answered only once moved
  rampWeeks: 4,
  surveyStartedAt: null,
  publicCount: null,
  hasSubmitted: false,
  shareCard: null, // { blob, url, filename }
  trailCheck: { round: null, choice: null, passed: false }
};

export const $ = id => document.getElementById(id);

// --- ADDRESSES -----------------------------------------------------------------
// Each view has its own address. netlify.toml serves index.html for exactly these
// paths (test/entrypoints.test.js checks that both lists match); anything else is a 404.
export const VIEW_PATHS = {
  home: '/',
  survey: '/survey',
  success: '/thanks',
  insights: '/insights',
  download: '/dataset',
  privacy: '/privacy',
  about: '/about'
};

// The browser tab title of each view; the home page keeps the title in index.html.
export const VIEW_TITLES = {
  survey: 'Survey',
  success: 'Thank you',
  insights: 'Insights',
  download: 'Dataset',
  privacy: 'Privacy',
  about: 'About'
};

/** Opens an address of the site without reloading the page (the router draws the view). */
export function go(address, replace) {
  history[replace ? 'replaceState' : 'pushState'](null, '', address);
  window.dispatchEvent(new Event('routechange'));
}
// Smooth scrolling, unless the device asks for less motion.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export const scrollMode = () => (reducedMotion.matches ? 'auto' : 'smooth');

// --- HELPERS ---
// Netlify's rate limits (config in netlify/functions/*.js) answer 429 with their
// own page instead of our JSON, so there is no message from the server then.
export function errorText(res, message, fallback) {
  if (message) return message;
  return res.status === 429 ? 'Too many attempts in a short time. Please wait a minute and try again.' : fallback;
}

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Copies text and says so. Where the browser refuses (no permission, an old
 * browser, an embedded view), it says that too instead of doing nothing.
 * Resolves to true when copied; `quiet` leaves the failure message to the caller.
 */
export function copyText(text, done, quiet) {
  const failed = () => { if (!quiet) showToast("Couldn't copy here. Please select it and copy it by hand."); return false; };
  if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(failed());
  return navigator.clipboard.writeText(text).then(() => { if (done) showToast(done); return true; }, failed);
}

export function humanize(value) {
  return (value || '').replace(/_/g, ' ');
}

/** Escapes a value for use inside a quoted CSS attribute selector. */
export function attrValue(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

export function orDash(value, suffix) {
  return value === null || value === undefined ? '—' : `${value}${suffix || ''}`;
}

// --- TOAST NOTIFICATIONS ---
export function showToast(msg) {
  const container = $('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'px-4 py-3 rounded-xl bg-surface border border-blue-mid/50 text-ink text-xs flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0';
  toast.innerHTML = '<svg class="w-4 h-4 text-blue shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span></span>';
  toast.querySelector('span').textContent = msg;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
