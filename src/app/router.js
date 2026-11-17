/**
 * The hash router: one view at a time (#home, #survey, #download, ...).
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { loadTurnstileIfStarted } from './botcheck.js';
import { $, scrollMode, state } from './core.js';
import { fetchPreviewData, renderDatasetMeta } from './dataset.js';
import { loadInsights } from './insights-page.js';

// --- DOM REFERENCES ---
const views = {
  home: $('view-home'),
  survey: $('view-survey'),
  success: $('view-success'),
  download: $('view-download'),
  insights: $('view-insights'),
  about: $('view-about'),
  privacy: $('view-privacy')
};

const navLinks = {
  insights: $('nav-link-insights'),
  download: $('nav-link-download'),
  about: $('nav-link-about')
};

// --- ROUTER ---
export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

function handleRoute() {
  let hash = (window.location.hash || '#home').replace('#', '').toLowerCase();
  // A link to a section inside a view (e.g. #privacy-delete) opens that view and scrolls to it.
  let anchor = null;
  if (!views[hash]) {
    const target = hash && document.getElementById(hash);
    const view = target && target.closest('.app-view');
    if (view) {
      anchor = target;
      hash = view.id.replace('view-', '');
    } else {
      hash = 'home';
    }
  }
  // The thank-you page only makes sense right after submitting.
  if (hash === 'success' && !state.hasSubmitted) {
    history.replaceState(null, '', '#home');
    hash = 'home';
  }

  state.currentView = hash;

  Object.keys(views).forEach(key => {
    views[key].classList.toggle('active', key === hash);
  });

  // Update active nav link styling
  // The current page gets the pill in the header; the logo is the way home.
  Object.keys(navLinks).forEach(key => {
    if (!navLinks[key]) return;
    navLinks[key].classList.toggle('is-active', key === hash);
    if (key === hash) navLinks[key].setAttribute('aria-current', 'page');
    else navLinks[key].removeAttribute('aria-current');
  });

  if (anchor) {
    setTimeout(() => anchor.scrollIntoView({ behavior: scrollMode(), block: 'start' }), 50);
  } else {
    window.scrollTo({ top: 0, behavior: scrollMode() });
  }

  // The server uses the time spent on the form as a bot check.
  if (hash === 'survey' && !state.surveyStartedAt) {
    state.surveyStartedAt = Date.now();
  }
  if (hash === 'survey') {
    loadTurnstileIfStarted();
    history.replaceState({ step: state.currentStep }, '', '#survey');
  }

  if (hash === 'download') {
    fetchPreviewData();
    renderDatasetMeta();
  }
  if (hash === 'insights') loadInsights();
}
