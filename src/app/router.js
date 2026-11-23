/**
 * The router: one view at a time, each at its own address (/survey, /dataset, ...,
 * VIEW_PATHS in core.js). Links to these addresses open the view without a reload;
 * old links with a #hash (#download, #privacy-delete, ...) are moved to the new address.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { loadTurnstileIfStarted } from './botcheck.js';
import { $, VIEW_PATHS, VIEW_TITLES, go, scrollMode, state } from './core.js';
import { fetchPreviewData, renderDatasetMeta, resetPreviewOrder } from './dataset.js';
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

const HOME_TITLE = document.title;
let firstRoute = true;

const viewAt = pathname => Object.keys(VIEW_PATHS).find(key => VIEW_PATHS[key] === pathname.replace(/\/+$/, '') || (key === 'home' && pathname === '/'));

/** The address an old #hash link meant: a view (#download) or a section inside one (#privacy-delete). */
function addressForHash(hash) {
  if (views[hash]) return VIEW_PATHS[hash];
  const target = hash && document.getElementById(hash);
  const view = target && target.closest('.app-view');
  return view ? `${VIEW_PATHS[view.id.replace('view-', '')]}#${hash}` : null;
}

// --- ROUTER ---
export function initRouter() {
  // Old links (opentrailscience.org/#download) keep working: they move to the new address.
  const legacy = location.pathname === '/' && addressForHash(location.hash.replace('#', '').toLowerCase());
  if (legacy) history.replaceState(null, '', legacy);

  window.addEventListener('popstate', handleRoute);
  window.addEventListener('routechange', handleRoute);
  // An old #link opened while the site is already open only changes the hash.
  window.addEventListener('hashchange', () => {
    const address = location.pathname === '/' && addressForHash(location.hash.replace('#', '').toLowerCase());
    if (address) go(address, true);
    else handleRoute();
  });

  // Links to a view open it here instead of loading the page again.
  document.addEventListener('click', e => {
    const link = e.target.closest && e.target.closest('a[href]');
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !viewAt(url.pathname)) return;
    e.preventDefault();
    if (url.pathname === location.pathname && url.hash && url.hash !== location.hash) history.pushState(null, '', url.hash);
    else if (url.pathname + url.hash !== location.pathname + location.hash) history.pushState(null, '', url.pathname + url.hash);
    handleRoute();
  });

  handleRoute();
}

function handleRoute() {
  let key = viewAt(location.pathname) || 'home';
  // A #section on the address (e.g. /privacy#privacy-delete) scrolls to it.
  const target = location.hash && document.getElementById(location.hash.slice(1));
  const anchor = target && views[key] && views[key].contains(target) ? target : null;

  // The thank-you page only makes sense right after submitting.
  if (key === 'success' && !state.hasSubmitted) {
    history.replaceState(null, '', VIEW_PATHS.home);
    key = 'home';
  }

  const changed = state.currentView !== key;
  state.currentView = key;

  Object.keys(views).forEach(k => {
    views[k].classList.toggle('active', k === key);
  });

  // The current page gets the pill in the header; the logo is the way home.
  Object.keys(navLinks).forEach(k => {
    if (!navLinks[k]) return;
    navLinks[k].classList.toggle('is-active', k === key);
    if (k === key) navLinks[k].setAttribute('aria-current', 'page');
    else navLinks[k].removeAttribute('aria-current');
  });

  // Search engines see the address and the name of the view, not the home page's;
  // the tab and the browser history get the name too.
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = `https://opentrailscience.org${VIEW_PATHS[key]}`;
  document.title = VIEW_TITLES[key] ? `${VIEW_TITLES[key]} | Open Trail Science` : HOME_TITLE;

  // Screen readers hear about the new page: focus moves to its headline (invisible to everyone
  // else). Not on the first load, where the browser starts at the top anyway.
  if (changed && !anchor && !firstRoute) {
    const heading = views[key].querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  if (anchor) {
    // A folded section (the details on the privacy page) opens so the link lands on its text.
    const fold = anchor.closest('details');
    if (fold) fold.open = true;
    setTimeout(() => anchor.scrollIntoView({ behavior: scrollMode(), block: 'start' }), 50);
  } else if (changed) {
    window.scrollTo({ top: 0, behavior: scrollMode() });
  }

  // The server uses the time spent on the form as a bot check.
  if (key === 'survey' && !state.surveyStartedAt) {
    state.surveyStartedAt = Date.now();
  }
  if (key === 'survey') {
    loadTurnstileIfStarted();
    if (!(history.state && history.state.step)) history.replaceState({ step: state.currentStep }, '', VIEW_PATHS.survey);
  }

  if (key === 'download' && changed) {
    resetPreviewOrder(); // a new random order on every visit
    fetchPreviewData();
    renderDatasetMeta();
  }
  if (key === 'insights') loadInsights();
  firstRoute = false;
}
