/**
 * Home page: the counters, the first-50 cairns and the trail stones.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, FIRST_HIKERS_GOAL, STATIC_STATS_URL, STONES_PER_CAIRN, Schema, showToast, state } from './core.js';
import { renderDatasetMeta } from './dataset.js';

// --- MY SUBMISSIONS (so the counters include them right away) ---------------
// The counters come from a snapshot rebuilt every few hours. Until a snapshot
// newer than a hiker's submission arrives, it is added on this page. Kept in
// memory only: nothing is stored in the browser, a reload shows the snapshot.
const mySubmissions = [];
const normalizeCode = code => String(code || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

/** `serverDate` is the submit response's Date header, so a wrong device clock doesn't matter. */
export function rememberMySubmission(trail, deletionCode, serverDate) {
  mySubmissions.push({ at: Date.parse(serverDate) || Date.now(), trail, code: normalizeCode(deletionCode) });
}

export function forgetMySubmission(deletionCode) {
  const code = normalizeCode(deletionCode);
  const i = mySubmissions.findIndex(s => s.code && s.code === code);
  if (i >= 0) mySubmissions.splice(i, 1);
}

/** My submissions that the snapshot generated at `snapshotTime` doesn't include yet. */
export function mySubmissionsAfter(snapshotTime) {
  const builtAt = Date.parse(snapshotTime);
  if (!Number.isFinite(builtAt)) return [];
  return mySubmissions.filter(s => s.at > builtAt);
}

// --- STATS (prebuilt stats.json) & ANIMATED COUNTER ---
export async function fetchStats() {
  try {
    const res = await fetch(STATIC_STATS_URL);
    if (!res.ok) throw new Error('stats.json returned ' + res.status);
    state.stats = await res.json();
    renderStats(state.stats);
  } catch (err) {
    console.warn('Could not load the stats snapshot:', err.message);
  }
}

export function renderStats(data) {
  const mine = mySubmissionsAfter(data.lastUpdated);
  const total = (data.totalCount || 0) + mine.length;
  const early = total < FIRST_HIKERS_GOAL;
  state.publicCount = total;
  renderDatasetMeta();

  // Until there are enough hikes, invite people instead of showing thin numbers.
  $('stats-first50').classList.toggle('hidden', !early);
  $('stats-tiles').classList.toggle('hidden', early);
  $('stats-bias-note').classList.toggle('hidden', early);
  if (early) {
    renderFirstHikersProgress($('first50-bar'), $('first50-count'), total, mine.length > 0);
    $('first50-progress').setAttribute('aria-valuenow', String(total));
  } else {
    animateNumber($('stat-total-count'), total, 0, '');
    animateNumber($('stat-completion-rate'), data.completionRate, 0, '%');
    animateNumber($('stat-median-baseweight'), data.medianBaseWeightLbs, 1, ' lbs');
    animateNumber($('stat-avg-miles'), data.avgDailyMiles, 1, ' mi');
  }
}

/** One stone per hike so far, colored in the order of the four accents (styles.css .stones), as 10 cairns of 5. */
export function renderFirstHikersProgress(stones, label, total, includesYou) {
  if (stones) {
    // 10 small cairns of 5, filled one cairn at a time from the bottom stone up.
    // The color follows the stone's number (c0 to c3, repeating), not its cairn.
    if (stones.querySelectorAll('span').length !== FIRST_HIKERS_GOAL) {
      stones.replaceChildren(...Array.from({ length: FIRST_HIKERS_GOAL / STONES_PER_CAIRN }, (_, c) => {
        const cairn = document.createElement('div');
        cairn.append(...Array.from({ length: STONES_PER_CAIRN }, (__, s) => {
          const stone = document.createElement('span');
          stone.className = `c${(c * STONES_PER_CAIRN + s) % 4}`;
          return stone;
        }));
        return cairn;
      }));
    }
    stones.querySelectorAll('span').forEach((stone, i) => stone.classList.toggle('filled', i < total));
  }
  if (label) label.textContent = `${Math.min(total, FIRST_HIKERS_GOAL)} of ${FIRST_HIKERS_GOAL} hikers so far${includesYou ? ', including you' : ''}`;
}

/** Counts up from 0 to `end`; shows a dash when there is no value yet. */
function animateNumber(element, end, decimals, suffix) {
  if (!element) return;
  if (end === null || end === undefined) {
    element.textContent = '—';
    return;
  }
  const duration = 1000;
  const startTime = performance.now();
  function update(time) {
    const progress = Math.min((time - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    element.textContent = (end * ease).toFixed(progress < 1 ? 0 : decimals) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// --- TRAIL QUICK SELECT FROM HOME ---
export function initTrailQuickCards() {
  document.querySelectorAll('.trail-quick-card').forEach(card => {
    card.addEventListener('click', () => {
      // "Any other long trail" has no data-trail: the "Other" choice depends on the region,
      // so the hiker picks it in the list.
      const trail = card.getAttribute('data-trail');
      const trailSelect = $('field-trail');
      if (trail && trailSelect) {
        trailSelect.value = trail;
        trailSelect.dispatchEvent(new Event('change'));
      }
      window.location.hash = '#survey';
      showToast(trail ? `Selected: ${Schema.trailName(trail)}` : 'Pick your trail from the list in the survey');
    });
  });
}
