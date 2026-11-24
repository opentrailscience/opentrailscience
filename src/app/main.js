/**
 * Entry point: wires up every part of the page once the HTML is ready.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { initBotCheckBanner } from './botcheck.js';
import { initConsent, initTrailCheck } from './consent.js';
import { initChoiceCards, initHikeYears, initOptionHints, initPillGroups, initSliders, initUrinationAids } from './controls.js';
import { initDatasetDocs, initPreviewTable } from './dataset.js';
import { initDraftAutosave, initSurveyReset, restoreDraft } from './draft.js';
import { fetchStats, initTrailQuickCards } from './home.js';
import { initPrivacyPage } from './privacy.js';
import { initFeedback, initMyHike } from './results.js';
import { initRouter } from './router.js';
import { initTrailSuggestions } from './suggestions.js';
import { initTrailRegions } from './trail-region.js';
import { initTheme } from './theme-switch.js';
import { initConditionals, initDefaultUnits, initDirectionCards, initDontKnowToggles, initHeightFeetInches, initRampCalculator, initUnitSwitcher } from './units.js';
import { initInvalidMarks, initStepHistory, initWizardControls, markRequiredInputs } from './wizard.js';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  // Both forms are handled in JS; pressing Enter must never submit them.
  document.querySelectorAll('form').forEach(form => form.addEventListener('submit', e => e.preventDefault()));
  initHikeYears();
  initDefaultUnits();
  initChoiceCards();
  initOptionHints();
  initTrailRegions();
  initSliders();
  initUnitSwitcher();
  initPillGroups();
  initUrinationAids();
  initConsent();
  initPrivacyPage();
  initConditionals();
  initHeightFeetInches();
  initDirectionCards();
  initRampCalculator();
  initWizardControls();
  initBotCheckBanner();
  initStepHistory();
  initInvalidMarks();
  initPreviewTable();
  initTrailQuickCards();
  initDontKnowToggles();
  initSurveyReset();
  initTrailCheck();
  initFeedback();
  initTrailSuggestions();
  initMyHike();
  initTheme();
  initDatasetDocs();
  markRequiredInputs();
  restoreDraft();
  initDraftAutosave();
  initRouter();
  fetchStats();
});
