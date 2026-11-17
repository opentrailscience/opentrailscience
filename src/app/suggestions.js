/**
 * "Suggest a trail" on the home page and in step 1.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, errorText } from './core.js';

// --- SUGGEST A TRAIL (home page, and step 1 when an "Other" trail is picked) -------
// Sent on its own to /api/trail-suggestion, never with the survey answers.
const TRAIL_SUGGEST_NOTE = {};

/** Empty and ready again ("Start over", "Add another hike"). */
export function resetTrailSuggestion(box) {
  const input = box.querySelector('.trail-suggest-input');
  input.value = '';
  input.disabled = false;
  box.querySelector('.trail-suggest-send').disabled = false;
  const result = box.querySelector('.trail-suggest-result');
  result.className = 'trail-suggest-result text-xs text-slate-400 mt-2';
  result.textContent = TRAIL_SUGGEST_NOTE[input.id];
}

export function initTrailSuggestions() {
  document.querySelectorAll('.trail-suggest').forEach(box => {
    const input = box.querySelector('.trail-suggest-input');
    const button = box.querySelector('.trail-suggest-send');
    const result = box.querySelector('.trail-suggest-result');
    TRAIL_SUGGEST_NOTE[input.id] = result.textContent;
    const send = async () => {
      const trail = input.value.trim();
      if (!trail) {
        result.className = 'trail-suggest-result text-xs mt-2 text-amber-300';
        result.textContent = 'Please enter a trail first.';
        return;
      }
      button.disabled = true;
      result.className = 'trail-suggest-result text-xs mt-2 text-slate-400';
      result.textContent = 'Sending…';
      try {
        const res = await fetch('/api/trail-suggestion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trail, hp_trail_notes: box.querySelector('.trail-suggest-trap').value })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(errorText(res, body.error, `Sending failed (HTTP ${res.status}).`));
        input.disabled = true;
        result.className = 'trail-suggest-result text-xs mt-2 text-pine-300 font-semibold';
        result.textContent = "Thanks! I'll add trails that several hikers ask for.";
      } catch (err) {
        button.disabled = false;
        result.className = 'trail-suggest-result text-xs mt-2 text-rose-300';
        result.textContent = err.message === 'Failed to fetch' ? 'Network error. Please try again.' : err.message;
      }
    };
    button.addEventListener('click', send);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (!button.disabled) send(); }
    });
  });
  const trailSelect = $('field-trail');
  const surveyBox = $('trail-suggest-survey-box');
  const toggle = () => surveyBox.classList.toggle('hidden', !trailSelect.value.startsWith('Other'));
  trailSelect.addEventListener('change', toggle);
  toggle();
}
