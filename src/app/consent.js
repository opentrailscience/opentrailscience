/**
 * The start page: consent and the trail check.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { loadTurnstileIfStarted } from './botcheck.js';
import { $, HumanCheck, scrollMode, showToast, state } from './core.js';
import { saveDraftSoon } from './draft.js';

// --- CONSENT (before the survey starts) -----------------------------------------
export function giveConsent() {
  state.consentGiven = true;
  $('consent-checkbox').checked = true;
  $('consent-gate').classList.add('hidden');
  $('survey-body').classList.remove('hidden');
  $('survey-progress').classList.remove('hidden');
  loadTurnstileIfStarted();
}

/** Back to the consent step: a fresh survey (start over, another hike) asks again. */
export function resetConsent() {
  state.consentGiven = false;
  $('consent-checkbox').checked = false;
  $('btn-start-survey').disabled = true;
  $('consent-gate').classList.remove('hidden');
  $('survey-body').classList.add('hidden');
  $('survey-progress').classList.add('hidden');
}

/** Back to the start page for the trail check; the answers and the current step stay. */
export function showGateAgain() {
  $('consent-gate').classList.remove('hidden');
  $('survey-body').classList.add('hidden');
  $('survey-progress').classList.add('hidden');
  updateStartButton();
  $('trail-check').scrollIntoView({ behavior: scrollMode(), block: 'center' });
  showToast('Please answer the quick trail check first.');
}

/** The survey starts once the consent box is ticked and the trail check is answered. */
export function updateStartButton() {
  $('btn-start-survey').disabled = !($('consent-checkbox').checked && state.trailCheck.passed);
}

export function initConsent() {
  const box = $('consent-checkbox');
  const start = $('btn-start-survey');
  box.addEventListener('change', updateStartButton);
  start.addEventListener('click', () => {
    if (!box.checked || !state.trailCheck.passed) return;
    giveConsent();
    state.surveyStartedAt = state.surveyStartedAt || Date.now();
    window.scrollTo({ top: 0, behavior: scrollMode() });
  });
}

// --- TRAIL CHECK (human check, see lib/human-check.js) ----------------------------
const TRAIL_CHECK_BASE = 'trail-check-option px-3 py-3 rounded-xl text-sm font-semibold border transition text-left';
const TRAIL_CHECK_IDLE = `${TRAIL_CHECK_BASE} border-line bg-surface/60 hover:border-blue-mid`;
const TRAIL_CHECK_RIGHT = `${TRAIL_CHECK_BASE} border-blue-mid bg-blue-tint/60`;
const TRAIL_CHECK_WRONG = `${TRAIL_CHECK_BASE} border-red-mid bg-red-tint/40`;
const WRONG_REPLIES = [
  "Nope, you'd miss that one by day three. Try again.",
  'Your future self in the rain disagrees. Pick another one.',
  "That one's coming with you. Try again!"
];

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A random round, or round `id` (from a draft), already answered if `passed`. */
export function newTrailCheck(id, passed) {
  const rounds = HumanCheck.TRAIL_CHECKS;
  const round = rounds.find(r => r.id === id) || rounds[Math.floor(Math.random() * rounds.length)];
  state.trailCheck = { round, choice: null, passed: false };

  const container = $('trail-check-options');
  const feedback = $('trail-check-feedback');
  container.replaceChildren();
  feedback.className = 'text-xs text-muted';
  feedback.textContent = '';
  let wrongCount = 0;

  shuffle(round.gear.concat(round.odd)).forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = TRAIL_CHECK_IDLE;
    btn.textContent = item;
    const pass = () => {
      state.trailCheck.choice = item;
      state.trailCheck.passed = true;
      btn.className = TRAIL_CHECK_RIGHT;
      btn.setAttribute('aria-pressed', 'true');
      container.querySelectorAll('button').forEach(b => { if (b !== btn) b.disabled = true; });
      feedback.className = 'text-xs text-blue-strong font-semibold';
      feedback.textContent = "Right, you're clearly a great hiker!";
    };
    btn.addEventListener('click', () => {
      if (state.trailCheck.passed) return;
      if (item === round.odd) {
        pass();
        updateStartButton();
        saveDraftSoon();
      } else {
        btn.className = TRAIL_CHECK_WRONG;
        feedback.className = 'text-xs text-red-strong';
        feedback.textContent = WRONG_REPLIES[wrongCount++ % WRONG_REPLIES.length];
      }
    });
    container.appendChild(btn);
    if (passed && item === round.odd) pass();
  });
}

export function initTrailCheck() {
  if ($('trail-check-options')) newTrailCheck();
}
