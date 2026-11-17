/**
 * The survey draft saved in this browser, and "Start over".
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { giveConsent, newTrailCheck, resetConsent, updateStartButton } from './consent.js';
import { clearPills, resetSlider, setCardSelected, syncNoTraining, updateOptionHint } from './controls.js';
import { $, HumanCheck, Schema, attrValue, scrollMode, showToast, state } from './core.js';
import { resetTrailSuggestion } from './suggestions.js';
import { TOGGLE_OFF, YES_NO_TOGGLES, setRampWeeks, setUnitSystem, syncHeightParts, updateDirectionCards } from './units.js';
import { renderWizardStep } from './wizard.js';

// --- DRAFT: answers survive a reload, saved only in this browser ---------------
// Add a version (-v2, -v3, …) when a form change would make restored drafts wrong.
const DRAFT_KEY = 'ots-survey-draft';
const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
let draftTimer = null;

export function readDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return null;
    return draft;
  } catch (err) {
    return null; // storage blocked (private mode) or corrupt: start fresh
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (err) { /* storage unavailable */ }
  const notice = $('draft-notice');
  if (notice) notice.classList.add('hidden');
}

function saveDraft() {
  const values = {};
  Schema.FIELDS.forEach(field => {
    const el = field.input && $(field.input);
    if (el && el.value !== '' && !(el.type === 'range' && !state.touchedSliders.has(el.id))) values[field.input] = el.value;
  });
  const answered = Object.keys(values).filter(id => id !== 'field-rampWeeksHiked').length > 0 ||
    Object.values(state.pillSelections).some(set => set.size > 0) || state.unknownFields.size > 0;
  if (!answered) return;

  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      savedAt: Date.now(),
      startedAt: state.surveyStartedAt,
      step: state.currentStep,
      unitSystem: state.unitSystem,
      values,
      touchedSliders: Array.from(state.touchedSliders),
      unknownFields: Array.from(state.unknownFields),
      consent: state.consentGiven,
      consentVersion: Schema.CONSENT_VERSION,
      trailCheck: state.trailCheck.passed ? { id: state.trailCheck.round.id, choice: state.trailCheck.choice } : null,
      pills: Object.fromEntries(Object.entries(state.pillSelections).map(([field, set]) => [field, Array.from(set)])),
      rampWeeks: state.rampWeeks
    }));
  } catch (err) { /* storage full or blocked: the survey still works */ }
}

export function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 300);
}

export function initDraftAutosave() {
  const form = $('survey-form');
  // Choice cards and toggles change hidden inputs, so clicks are watched too.
  ['input', 'change', 'click'].forEach(type => form.addEventListener(type, saveDraftSoon));
  window.addEventListener('pagehide', saveDraft);
}

/** Puts a saved draft back into the form by replaying the hiker's choices. */
export function restoreDraft() {
  const draft = readDraft();
  if (!draft) return;

  if (draft.unitSystem) setUnitSystem(draft.unitSystem);
  Object.entries(draft.values || {}).forEach(([id, value]) => {
    const el = $(id);
    if (!el) return;
    const card = document.querySelector(`.choice-card[data-name="${id.replace('field-', '')}"][data-value="${attrValue(value)}"]`);
    const toggle = YES_NO_TOGGLES.find(t => t.field === id);
    if (card) {
      card.click();
    } else if (toggle) {
      $(`btn-${toggle.name}-${value === 'true' ? 'yes' : 'no'}`).click();
    } else {
      el.value = value;
      el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change'));
    }
  });
  Object.entries(draft.pills || {}).forEach(([field, values]) => {
    values.forEach(val => {
      const pill = document.querySelector(`.pill-group[data-field="${attrValue(field)}"] .select-pill[data-val="${attrValue(val)}"]`);
      if (pill) pill.click();
    });
  });
  // Skip the start page only if both the consent and the trail check were done.
  if (draft.trailCheck && HumanCheck.isCorrectTrailCheck(draft.trailCheck)) newTrailCheck(draft.trailCheck.id, true);
  // A consent given to an older consent text is asked again.
  const consented = draft.consent && draft.consentVersion === Schema.CONSENT_VERSION;
  if (consented) $('consent-checkbox').checked = true;
  if (consented && state.trailCheck.passed) giveConsent();
  updateStartButton();
  (draft.unknownFields || []).forEach(name => {
    const box = Array.from(document.querySelectorAll('.dont-know-toggle'))
      .find(b => b.getAttribute('data-fields').split(',').includes(name));
    if (box && !box.checked) {
      box.checked = true;
      box.dispatchEvent(new Event('change'));
    }
  });
  setRampWeeks(draft.rampWeeks || 4);
  syncHeightParts();
  syncNoTraining();

  state.surveyStartedAt = draft.startedAt || Date.now();
  renderWizardStep(Math.min(Math.max(draft.step || 1, 1), state.totalSteps), { scroll: false });
  $('draft-notice').classList.remove('hidden');
}

// --- RESET: "Start over" and "Add another hike" --------------------------------
export function resetSurveyForm() {
  Schema.FIELDS.forEach(field => {
    const el = field.input && $(field.input);
    if (!el) return;
    if (el.type === 'range') {
      resetSlider(el.id);
    } else if (el.tagName === 'SELECT') {
      el.selectedIndex = 0; // the "Select…" placeholder
      if (el.hasAttribute('data-has-hints')) updateOptionHint(el);
    } else {
      el.value = '';
    }
    el.removeAttribute('aria-invalid');
  });
  document.querySelectorAll('#survey-form [aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  document.querySelectorAll('.choice-card.selected').forEach(c => setCardSelected(c, false));
  YES_NO_TOGGLES.forEach(t => {
    ['no', 'yes'].forEach(answer => {
      $(`btn-${t.name}-${answer}`).className = TOGGLE_OFF;
      $(`btn-${t.name}-${answer}`).setAttribute('aria-pressed', 'false');
    });
    $(t.details).classList.add('hidden');
  });
  ['quit-reason-container', 'own-shelter-container', 'trail-suggest-survey-box', 'urination-aids-container'].forEach(id => $(id).classList.add('hidden'));
  resetTrailSuggestion($('trail-suggest-survey-box'));
  clearPills();
  document.querySelectorAll('.dont-know-toggle').forEach(box => { box.checked = false; });
  state.unknownFields.clear();
  setRampWeeks(4);
  updateDirectionCards();
  syncHeightParts();
  syncNoTraining();

  state.surveyStartedAt = null;
  newTrailCheck();
  resetConsent();
  renderWizardStep(1, { scroll: false });
}

export function initSurveyReset() {
  $('btn-start-over').addEventListener('click', () => {
    clearDraft();
    resetSurveyForm();
    window.scrollTo({ top: 0, behavior: scrollMode() });
    showToast('Cleared. Starting fresh.');
  });
  $('btn-add-another-hike').addEventListener('click', () => {
    clearDraft();
    resetSurveyForm();
    window.location.hash = '#survey';
  });
}
