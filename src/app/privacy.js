/**
 * Privacy page: trail lists, deleting a hike, copying the personal code.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, Schema, copyText, errorText, state } from './core.js';
import { forgetMySubmission, renderStats } from './home.js';
import { markInsightsStale } from './insights-page.js';

// --- DELETION CODE ------------------------------------------------------------------
export function populateDeletionCode(code) {
  const panel = $('deletion-code-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', !code);
  if (code) $('deletion-code-value').textContent = code;
}

export function initPrivacyPage() {
  const popular = Schema.TRAILS.filter(t => Schema.datePrecision(t) === 'week');
  const small = Schema.TRAILS.filter(t => Schema.datePrecision(t) === 'month');
  // The three "Other" choices have no name of their own: list them once, at the end.
  const names = list => [...new Set(list.map(t => Schema.trailName(t) || 'any other trail'))].join(' · ');
  $('privacy-popular-trails').textContent = names(popular);
  $('privacy-small-trails').textContent = names(small);
  $('privacy-consent-version').textContent = Schema.CONSENT_VERSION;

  $('btn-copy-deletion-code').addEventListener('click', () => {
    const code = $('deletion-code-value').textContent;
    if (code) copyText(code, 'Code copied');
  });

  const result = $('deletion-result');
  const button = $('btn-delete-answers');
  const submitDeletion = async () => {
    const code = $('deletion-code-input').value.trim();
    if (!code) {
      result.className = 'mt-3 text-sm text-amber-300';
      result.textContent = 'Please enter your personal code.';
      return;
    }
    button.disabled = true;
    result.className = 'mt-3 text-sm text-slate-400';
    result.textContent = 'Deleting…';
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        result.className = 'mt-3 text-sm text-pine-300';
        result.textContent = 'Done. Your answers have been deleted from the database. They will be gone from the website and download files with the next dataset update (usually within a day).';
        $('deletion-code-input').value = '';
        forgetMySubmission(code);
        if (state.stats) renderStats(state.stats);
        markInsightsStale();
      } else {
        result.className = 'mt-3 text-sm text-rose-300';
        result.textContent = errorText(res, body.error, `Deletion failed (HTTP ${res.status}).`);
      }
    } catch (err) {
      result.className = 'mt-3 text-sm text-rose-300';
      result.textContent = 'Network error. Please try again.';
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener('click', submitDeletion);
  $('deletion-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitDeletion(); });
}
