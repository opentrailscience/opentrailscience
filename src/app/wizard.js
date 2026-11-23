/**
 * The five survey steps: moving between them, collecting and checking answers, and submitting.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { getBotCheckToken, loadTurnstileIfStarted } from './botcheck.js';
import { showGateAgain } from './consent.js';
import { pillSet } from './controls.js';
import { $, HumanCheck, Schema, VIEW_PATHS, attrValue, errorText, go, scrollMode, state } from './core.js';
import { clearDraft, resetSurveyForm } from './draft.js';
import { fetchStats, rememberMySubmission } from './home.js';
import { markInsightsStale } from './insights-page.js';
import { populateDeletionCode } from './privacy.js';
import { populateSuccessCard, renderCompareTable, resetFeedback, setSuccessMode, showComparison } from './results.js';
import { YES_NO_TOGGLES, syncRampWeeksWithDates } from './units.js';

// Milestone banner per wizard step: the hiker's likely mood by now.
const MILESTONES = [
  {
    badge: 'Step 1 of 5',
    title: 'Your hike',
    percent: '20%',
    nextLabel: 'Next: About you',
    milestoneTitle: 'Mood: Unreasonably optimistic',
    milestoneDesc: 'Fresh legs, clean socks, and a survey that surely can\'t be that long. Let\'s start with where and when you hiked.'
  },
  {
    badge: 'Step 2 of 5',
    title: 'About you',
    percent: '40%',
    nextLabel: 'Next: Your gear',
    milestoneTitle: 'Mood: Still smiling',
    milestoneDesc: 'The honeymoon phase. A few questions about you before day one on trail.'
  },
  {
    badge: 'Step 3 of 5',
    title: 'Your gear',
    percent: '60%',
    nextLabel: 'Next: On the trail',
    milestoneTitle: 'Mood: Suddenly very awake',
    milestoneDesc: 'Gear talk. You\'ve been waiting for someone to finally ask about your base weight.'
  },
  {
    badge: 'Step 4 of 5',
    title: 'On the trail',
    percent: '80%',
    nextLabel: 'Next: How it ended',
    milestoneTitle: 'Mood: Questioning your life choices',
    milestoneDesc: 'The mid-survey slump is real. Grab a snack; this part is about pacing, rest days and sleep.'
  },
  {
    badge: 'Step 5 of 5',
    title: 'How it ended',
    percent: '100%',
    nextLabel: 'Submit my hike',
    milestoneTitle: 'Mood: Summit fever',
    milestoneDesc: 'The last climb, I promise. How did it end, and how did it feel?'
  }
];

// --- MULTI-STEP WIZARD ENGINE ---
export function initWizardControls() {
  const btnNext = $('btn-wizard-next');
  const btnPrev = $('btn-wizard-prev');
  if (btnNext) btnNext.addEventListener('click', handleNextStep);
  if (btnPrev) btnPrev.addEventListener('click', handlePrevStep);
}

export function renderWizardStep(stepNumber, options) {
  state.currentStep = stepNumber;
  const meta = MILESTONES[stepNumber - 1];

  for (let i = 1; i <= state.totalSteps; i++) {
    const stepEl = $(`step-${i}`);
    if (stepEl) stepEl.classList.toggle('active', i === stepNumber);
  }

  $('wizard-step-badge').textContent = meta.badge;
  $('wizard-step-title').textContent = meta.title;
  $('wizard-progress-bar').style.width = meta.percent;
  $('wizard-milestone-title').textContent = meta.milestoneTitle;
  $('wizard-milestone-desc').textContent = meta.milestoneDesc;

  const btnPrev = $('btn-wizard-prev');
  btnPrev.disabled = stepNumber === 1;
  btnPrev.classList.toggle('opacity-40', stepNumber === 1);
  btnPrev.classList.toggle('cursor-not-allowed', stepNumber === 1);

  $('btn-wizard-next-text').textContent = meta.nextLabel;

  if (stepNumber === 4) syncRampWeeksWithDates();
  // The bot check sits on the last step; load it early so Submit doesn't wait for it.
  const lastStep = stepNumber === state.totalSteps;
  $('turnstile-box').classList.toggle('hidden', !lastStep);
  loadTurnstileIfStarted();

  hideErrors();
  if (!options || options.scroll !== false) window.scrollTo({ top: 100, behavior: scrollMode() });
}

/**
 * Each step is a browser history entry, so the phone's Back button goes to the
 * previous step instead of leaving the survey. The on-page Back button uses the
 * same history, so both stay in step.
 */
function handlePrevStep() {
  if (state.currentStep <= 1) return;
  if (history.state && history.state.step === state.currentStep) history.back();
  else renderWizardStep(state.currentStep - 1);
}

export function initStepHistory() {
  window.addEventListener('popstate', e => {
    const step = e.state && e.state.step;
    if (!step || state.currentView !== 'survey' || !state.consentGiven || step === state.currentStep) return;
    renderWizardStep(Math.min(Math.max(step, 1), state.totalSteps));
  });
}

async function handleNextStep() {
  const errors = validateStep(state.currentStep);
  if (errors.length > 0) {
    showErrors(errors);
    return;
  }
  hideErrors();

  if (state.currentStep < state.totalSteps) {
    renderWizardStep(state.currentStep + 1);
    history.pushState({ step: state.currentStep }, '', VIEW_PATHS.survey);
  } else {
    await submitSurveyForm();
  }
}

/**
 * Reads every schema field from the form, converting metric input to the
 * stored imperial units. Unanswered questions become null.
 */
function collectAnswers() {
  const answers = {};
  Schema.FIELDS.forEach(field => {
    if (field.derived) return;
    if (field.name === 'consent') {
      answers.consent = state.consentGiven;
      return;
    }
    if (field.type === 'enumArray' && field.name !== 'unknownAnswers') {
      answers[field.name] = Array.from(pillSet(field.name));
      return;
    }
    if (field.name === 'unknownAnswers') {
      answers.unknownAnswers = Array.from(state.unknownFields);
      return;
    }
    const el = $(field.input);
    let raw = el ? el.value.trim() : '';
    // An untouched slider has not been answered, whatever position it shows.
    if (el && el.type === 'range' && !state.touchedSliders.has(el.id)) raw = '';

    if (field.type === 'boolean') {
      answers[field.name] = raw === '' ? null : raw === 'true';
    } else if (field.type === 'number' || field.type === 'integer') {
      const num = Schema.parseNumberInput(raw); // also "6,5" (decimal comma)
      answers[field.name] = num === null || isNaN(num) ? num : Schema.toStoredUnit(num, field.unit, state.unitSystem);
    } else {
      answers[field.name] = raw === '' ? null : raw;
    }
  });
  return answers;
}

/** Tells assistive technology which inputs are required (the schema default). */
export function markRequiredInputs() {
  Schema.FIELDS.forEach(field => {
    const el = field.input && $(field.input);
    if (el && el.type !== 'hidden' && !field.optional) el.setAttribute('aria-required', 'true');
  });
}

function validateStep(step) {
  const fields = Schema.fieldsForStep(step);
  const result = Schema.validateSurvey(collectAnswers(), { fields, unitSystem: state.unitSystem });

  // Mark what needs an answer, for the eye (styles.css) and for screen readers.
  fields.forEach(name => {
    const target = invalidTarget(name);
    if (!target) return;
    if (result.fieldErrors[name]) target.setAttribute('aria-invalid', 'true');
    else target.removeAttribute('aria-invalid');
  });

  // Sliders read better as an instruction than as "... is required".
  const errors = fields.filter(name => result.fieldErrors[name]).map(name => {
    const field = Schema.FIELDS_BY_NAME[name];
    const el = field.input && $(field.input);
    if (el && el.type === 'range' && !state.touchedSliders.has(el.id)) {
      return `Please tap the slider for: ${(field.question || field.label).split(' (')[0]}`;
    }
    return result.fieldErrors[name];
  });
  return errors;
}

/**
 * The element that shows a field's problem: the input itself, or for choice
 * cards, pills and yes/no buttons their group.
 */
function invalidTarget(name) {
  const field = Schema.FIELDS_BY_NAME[name];
  const el = field.input && $(field.input);
  if (el && el.type !== 'hidden') return el;
  const card = document.querySelector(`.choice-card[data-name="${attrValue(name)}"]`);
  if (card) return card.parentElement;
  const pills = document.querySelector(`.pill-group[data-field="${attrValue(name)}"]`);
  if (pills) return pills;
  const toggle = el && YES_NO_TOGGLES.find(t => t.field === el.id);
  if (toggle) return $(`btn-${toggle.name}-no`).parentElement;
  return null;
}

/** Scrolls to the first marked answer on this step and puts the focus there. */
function focusFirstInvalid() {
  const step = $(`step-${state.currentStep}`);
  const first = step && Array.from(step.querySelectorAll('[aria-invalid="true"]')).find(el => el.offsetParent !== null);
  if (!first) return false;
  first.scrollIntoView({ behavior: scrollMode(), block: 'center' });
  const focusable = first.matches('input, select, textarea, button') ? first : first.querySelector('input, select, button, [tabindex="0"]');
  if (focusable) focusable.focus({ preventScroll: true });
  return true;
}

/** An answer given clears its mark right away. */
export function initInvalidMarks() {
  const clear = e => {
    const marked = e.target.closest && e.target.closest('[aria-invalid="true"]');
    if (marked && !marked.classList.contains('wizard-step')) marked.removeAttribute('aria-invalid');
  };
  ['input', 'change', 'click'].forEach(type => $('survey-form').addEventListener(type, clear));
}

function showErrors(errors) {
  const box = $('survey-validation-errors');
  const list = $('survey-error-list');
  if (!box || !list) return;

  list.innerHTML = '';
  errors.forEach(e => {
    const li = document.createElement('li');
    li.textContent = e;
    list.appendChild(li);
  });

  box.classList.remove('hidden');
  if (!focusFirstInvalid()) box.scrollIntoView({ behavior: scrollMode(), block: 'nearest' });
}

function hideErrors() {
  const box = $('survey-validation-errors');
  if (box) box.classList.add('hidden');
}

// --- FORM SUBMISSION & BACKEND COMMUNICATION ---
async function submitSurveyForm() {
  // Normally answered on the start page; without it the server would silently drop the hike.
  if (!state.trailCheck.passed) {
    showGateAgain();
    return;
  }
  const btnNext = $('btn-wizard-next');
  const btnNextText = $('btn-wizard-next-text');
  const originalText = btnNextText.textContent;

  btnNext.disabled = true;

  const answers = collectAnswers();

  try {
    btnNextText.textContent = 'Quick bot check…';
    const botCheckToken = await getBotCheckToken();
    // Proof of work for these exact answers (see lib/human-check.js), about a second.
    btnNextText.textContent = 'Checking…';
    const powNonce = await HumanCheck.solveProofOfWork(answers);
    btnNextText.textContent = 'Sending your answers…';

    const payload = Object.assign({}, answers, {
      hp_trail_notes: $('hp_trail_notes').value,
      hiker_anti_spam: $('hiker_anti_spam').value,
      formElapsedSeconds: Math.round((Date.now() - (state.surveyStartedAt || Date.now())) / 1000),
      trailCheck: { id: state.trailCheck.round.id, choice: state.trailCheck.choice },
      powNonce,
      turnstileToken: botCheckToken,
      schemaVersion: Schema.SCHEMA_VERSION
    });

    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success) {
      throw new Error(errorText(res, result.errors && result.errors.join(', '), `Submission failed (HTTP ${res.status})`));
    }
    // A stored hike always comes with its personal code. Without one the server
    // did not keep it (it looked automated): keep the answers and let the hiker retry.
    if (!result.deletionCode) {
      throw new Error("Your hike couldn't be confirmed. Your answers are still saved here: please press Submit again in a moment.");
    }

    // The server returns the stored record, including the derived pace.
    populateSuccessCard(result.data || Object.assign({}, answers, {
      averageDailyMiles: Schema.computeAverageDailyMiles(answers)
    }));
    renderCompareTable(result.data || answers, result.table);
    populateDeletionCode(result.deletionCode);
    showComparison(result.data || answers, result.comparison, result.comparisonAll);
    setSuccessMode('submitted');

    state.hasSubmitted = true;
    resetFeedback();
    rememberMySubmission(answers.trail, result.deletionCode, res.headers.get('Date'));
    markInsightsStale(); // show the new count next time
    go(VIEW_PATHS.success);
    fetchStats();

    // The answers are stored; start fresh for a possible next hike.
    clearDraft();
    resetSurveyForm();
  } catch (err) {
    console.error('Submission error:', err);
    showErrors([err.message || 'Network error occurred while submitting survey.']);
  } finally {
    btnNext.disabled = false;
    btnNextText.textContent = originalText;
  }
}
