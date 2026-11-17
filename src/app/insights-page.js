/**
 * Insights page: loads insights.json and hands it to insights.js.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, FIRST_HIKERS_GOAL, STATIC_INSIGHTS_URL } from './core.js';
import { mySubmissionsAfter, renderFirstHikersProgress } from './home.js';

// --- INSIGHTS --------------------------------------------------------------------
let insightsLoaded = false;

/** The next visit to Insights loads the data again (after submitting or deleting a hike). */
export function markInsightsStale() {
  insightsLoaded = false;
}

export async function loadInsights() {
  if (insightsLoaded || !window.Insights) return;
  let insights = null;
  try {
    const res = await fetch(STATIC_INSIGHTS_URL);
    if (res.ok) insights = await res.json();
  } catch (err) { /* handled below */ }
  if (!insights || !insights.charts) {
    $('insights-meta').textContent = 'The dataset could not be loaded right now. Please try again later.';
    return;
  }
  insightsLoaded = true;

  const mine = mySubmissionsAfter(insights.generatedAt);
  const total = insights.total + mine.length;
  const early = total < FIRST_HIKERS_GOAL;
  $('insights-meta').textContent = `${total} ${total === 1 ? 'hike' : 'hikes'} in the dataset`;
  $('insights-locked').classList.toggle('hidden', !early);
  $('insights-charts').classList.toggle('hidden', early);
  $('insights-footnote').classList.toggle('hidden', early);
  if (early) {
    renderFirstHikersProgress($('insights-locked-bar'), $('insights-locked-count'), total, mine.length > 0);
  } else {
    window.Insights.render($('insights-charts'), insights);
    window.Insights.renderTogether($('insights-together'), $('insights-together-note'), $('insights-together-cards'), insights);
  }
}
