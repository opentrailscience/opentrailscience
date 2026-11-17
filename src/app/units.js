/**
 * Survey inputs that depend on other answers: yes/no follow-ups, units, height, direction, ramp-up weeks and "Don't know".
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { setCardSelected } from './controls.js';
import { $, Schema, state } from './core.js';
import { fetchPreviewData } from './dataset.js';
import { readDraft } from './draft.js';

/**
 * Inputs whose label, placeholder and value change with the unit system.
 * `decimals` is the rounding used when converting an entered value.
 */
const UNIT_INPUTS = [
  {
    input: 'field-height', label: 'label-height', helper: 'height-helper',
    imperial: { label: 'Height (feet and inches)', placeholder: 'e.g. 70', helper: 'e.g. 5 ft 10 in (~178 cm)', decimals: 1 },
    metric: { label: 'Height (cm)', placeholder: 'e.g. 178', helper: 'e.g. 178 cm (~5 ft 10 in)', decimals: 0 }
  },
  {
    input: 'field-weight', label: 'label-weight', helper: 'weight-helper',
    imperial: { label: 'Body weight before the hike (lbs)', placeholder: 'e.g. 165 lbs', helper: 'e.g. 165 lbs (~75 kg)', decimals: 0 },
    metric: { label: 'Body weight before the hike (kg)', placeholder: 'e.g. 75 kg', helper: 'e.g. 75 kg (~165 lbs)', decimals: 1 }
  },
  {
    input: 'field-baseWeight', label: 'label-baseweight',
    imperial: { label: 'Base weight (lbs)', placeholder: 'e.g. 13.5 lbs', decimals: 1 },
    metric: { label: 'Base weight (kg)', placeholder: 'e.g. 6.1 kg', decimals: 1 }
  },
  {
    input: 'field-maxHeavyLoad', label: 'label-heavyweight',
    imperial: { label: 'Heaviest pack weight (lbs)', placeholder: 'e.g. 32.0 lbs', decimals: 1 },
    metric: { label: 'Heaviest pack weight (kg)', placeholder: 'e.g. 14.5 kg', decimals: 1 }
  },
  {
    input: 'field-totalDistance', label: 'label-totalDistance', helper: 'totalDistance-helper',
    imperial: { label: 'Total distance hiked (miles)', placeholder: 'e.g. 2650', helper: 'Miles you actually hiked on the trail', decimals: 1 },
    metric: { label: 'Total distance hiked (km)', placeholder: 'e.g. 4265', helper: 'Kilometres you actually hiked on the trail', decimals: 1 }
  },
  {
    input: 'field-totalElevationGain', label: 'label-totalElevationGain', helper: 'totalElevationGain-helper',
    imperial: { label: 'Total elevation gain (feet)', placeholder: 'e.g. 420880', helper: 'Total climbing over the whole hike (your watch or app may show it)', decimals: 0 },
    metric: { label: 'Total elevation gain (metres)', placeholder: 'e.g. 128406', helper: 'Total climbing over the whole hike (your watch or app may show it)', decimals: 0 }
  },
  {
    input: 'field-week1DailyMiles', label: 'label-week1',
    imperial: { label: 'Week 1 (mi/day)', placeholder: '', decimals: 1 },
    metric: { label: 'Week 1 (km/day)', placeholder: '', decimals: 1 }
  },
  {
    input: 'field-week2DailyMiles', label: 'label-week2',
    imperial: { label: 'Week 2 (mi/day)', placeholder: '', decimals: 1 },
    metric: { label: 'Week 2 (km/day)', placeholder: '', decimals: 1 }
  },
  {
    input: 'field-week3DailyMiles', label: 'label-week3',
    imperial: { label: 'Week 3 (mi/day)', placeholder: '', decimals: 1 },
    metric: { label: 'Week 3 (km/day)', placeholder: '', decimals: 1 }
  },
  {
    input: 'field-week4DailyMiles', label: 'label-week4',
    imperial: { label: 'Week 4 (mi/day)', placeholder: '', decimals: 1 },
    metric: { label: 'Week 4 (km/day)', placeholder: '', decimals: 1 }
  },
  {
    input: 'field-injuryMilestoneMiles', label: 'label-injuryMilestoneUnit',
    imperial: { label: 'miles', placeholder: 'e.g. 450', decimals: 1 },
    metric: { label: 'kilometres', placeholder: 'e.g. 724', decimals: 1 }
  },
  {
    input: 'field-postTrailWeight', label: 'label-postTrailWeight',
    imperial: { label: 'Body weight after the hike (lbs)', placeholder: 'e.g. 155', decimals: 0 },
    metric: { label: 'Body weight after the hike (kg)', placeholder: 'e.g. 70.3', decimals: 1 }
  }
];

const TOGGLE_ON = 'px-3.5 py-1.5 max-sm:px-5 max-sm:py-2.5 rounded-lg text-xs font-bold bg-brand text-white transition';
const TOGGLE_ON_WARNING = 'px-3.5 py-1.5 max-sm:px-5 max-sm:py-2.5 rounded-lg text-xs font-bold bg-rose-600 text-white transition';
export const TOGGLE_OFF = 'px-3.5 py-1.5 max-sm:px-5 max-sm:py-2.5 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 hover:text-white transition';
const UNIT_BUTTON_ON = 'px-3 py-1 rounded-md text-xs font-bold bg-brand text-white transition';
const UNIT_BUTTON_OFF = 'px-3 py-1 rounded-md text-xs font-bold text-slate-400 hover:text-white transition';

/** Every unit switch on the page (survey progress bar, dataset preview) shows the current system. */
function renderUnitButtons() {
  document.querySelectorAll('[data-unit-system]').forEach(btn => {
    const on = btn.getAttribute('data-unit-system') === state.unitSystem;
    btn.className = on ? UNIT_BUTTON_ON : UNIT_BUTTON_OFF;
    btn.setAttribute('aria-pressed', String(on));
  });
}

// --- CONDITIONAL VISIBILITY TRIGGERS ---
// Yes/No questions: button pair, hidden boolean field, follow-up container.
export const YES_NO_TOGGLES = [
  { name: 'injury-history', field: 'field-priorInjuryHistory', details: 'injury-history-details-container', yesClass: TOGGLE_ON },
  { name: 'deadline', field: 'field-hadCompletionDeadline', details: 'deadline-details-container', yesClass: TOGGLE_ON },
  { name: 'injury-occurred', field: 'field-severeInjuryOccurred', details: 'injury-details-container', yesClass: TOGGLE_ON_WARNING },
  { name: 'sick', field: 'field-gotSick', details: 'sick-details-container', yesClass: TOGGLE_ON_WARNING }
];

/** Wires a No/Yes button pair to a hidden boolean field and a details container. Neither starts selected. */
function bindYesNoToggle(name, fieldId, detailsId, yesClass) {
  const btnNo = $(`btn-${name}-no`);
  const btnYes = $(`btn-${name}-yes`);
  const field = $(fieldId);
  const details = $(detailsId);
  if (!btnNo || !btnYes) return;
  // aria-pressed tells screen readers which of the two is chosen.
  btnNo.setAttribute('aria-pressed', 'false');
  btnYes.setAttribute('aria-pressed', 'false');

  btnNo.addEventListener('click', () => {
    btnNo.className = TOGGLE_ON;
    btnYes.className = TOGGLE_OFF;
    btnNo.setAttribute('aria-pressed', 'true');
    btnYes.setAttribute('aria-pressed', 'false');
    field.value = 'false';
    details.classList.add('hidden');
  });
  btnYes.addEventListener('click', () => {
    btnYes.className = yesClass;
    btnNo.className = TOGGLE_OFF;
    btnYes.setAttribute('aria-pressed', 'true');
    btnNo.setAttribute('aria-pressed', 'false');
    field.value = 'true';
    details.classList.remove('hidden');
  });
}

export function initConditionals() {
  YES_NO_TOGGLES.forEach(t => bindYesNoToggle(t.name, t.field, t.details, t.yesClass));

  // Sleep location -> shelter and insulation (own gear only)
  const sleepLocationField = $('field-sleepLocation');
  if (sleepLocationField) {
    sleepLocationField.addEventListener('change', () => {
      $('own-shelter-container').classList.toggle('hidden', sleepLocationField.value !== 'own_system');
    });
  }

  // Completion Status -> Quit Reason
  const completionField = $('field-completionStatus');
  const quitContainer = $('quit-reason-container');
  if (completionField && quitContainer) {
    completionField.addEventListener('change', () => {
      quitContainer.classList.toggle('hidden', !Schema.STATUSES_WITH_QUIT_REASON.includes(completionField.value));
    });
  }
}

// --- UNIT SWITCHER (Imperial vs Metric) ---
function unitFactorFor(inputId) {
  const field = Schema.FIELDS.find(f => f.input === inputId);
  return Schema.UNITS[field.unit].factor;
}

export function setUnitSystem(system) {
  if (state.unitSystem === system) return;

  UNIT_INPUTS.forEach(cfg => {
    const text = cfg[system];
    const input = $(cfg.input);
    $(cfg.label).textContent = text.label;
    if (!input.disabled) input.placeholder = text.placeholder;
    if (cfg.helper && $(cfg.helper)) $(cfg.helper).textContent = text.helper;

    // Convert what the hiker already typed. Switching back without editing
    // restores the typed value exactly instead of rounding it twice.
    if (input.value) {
      if (input.dataset.unitShown === input.value && input.dataset.unitTypedIn === system) {
        input.value = input.dataset.unitTyped;
      } else {
        const factor = unitFactorFor(cfg.input);
        const value = parseFloat(input.value);
        const converted = system === 'metric' ? value * factor : value / factor;
        input.dataset.unitTyped = input.value;
        input.dataset.unitTypedIn = state.unitSystem;
        input.value = text.decimals === 0 ? Math.round(converted) : converted.toFixed(text.decimals);
        input.dataset.unitShown = input.value;
      }
    }
  });

  state.unitSystem = system;
  renderUnitButtons();
  applyHeightMode();
  if (state.previewRows) fetchPreviewData();
}

// --- HEIGHT: feet + inches in imperial mode ----------------------------------
// The stored answer stays field-height (inches, or cm in metric mode); in
// imperial mode the hiker types feet and inches, which are kept in sync.
export function syncHeightParts() {
  const inches = parseFloat($('field-height').value);
  const known = state.unitSystem === 'imperial' && Number.isFinite(inches);
  $('height-feet').value = known ? Math.floor(inches / 12) : '';
  $('height-inches').value = known ? Math.round((inches % 12) * 2) / 2 : '';
}

function applyHeightMode() {
  const imperial = state.unitSystem === 'imperial';
  $('height-feet-inches').classList.toggle('hidden', !imperial);
  $('field-height').classList.toggle('hidden', imperial);
  syncHeightParts();
}

export function initHeightFeetInches() {
  const update = () => {
    const feet = $('height-feet').value, inches = $('height-inches').value;
    const height = $('field-height');
    height.value = feet === '' && inches === '' ? '' : (parseFloat(feet) || 0) * 12 + (parseFloat(inches) || 0);
    height.dispatchEvent(new Event('input', { bubbles: true }));
    height.dispatchEvent(new Event('change', { bubbles: true }));
  };
  ['height-feet', 'height-inches'].forEach(id => $(id).addEventListener('input', update));
  applyHeightMode();
}

// --- DIRECTION: the first two options follow the trail ------------------------
export function updateDirectionCards() {
  const options = Schema.directionsFor($('field-trail').value);
  // Four cards; most trails use two, the "Other" trails all four.
  [0, 1, 2, 3].forEach(i => {
    const card = $(`direction-card-${i}`);
    const value = options[i];
    card.classList.toggle('hidden', !value);
    if (!value || card.getAttribute('data-value') !== value) setCardSelected(card, false);
    if (!value) return;
    const [title, subtitle] = Schema.DIRECTION_LABELS[value];
    card.setAttribute('data-value', value);
    card.children[0].textContent = title;
    card.children[1].textContent = subtitle;
  });
  // An answer that this trail doesn't offer is cleared.
  const field = $('field-direction');
  if (field.value && !['Flip-flop', 'Section'].includes(field.value) && !options.includes(field.value)) field.value = '';
}

export function initDirectionCards() {
  $('field-trail').addEventListener('change', updateDirectionCards);
}

export function initUnitSwitcher() {
  const refreshRampBadge = () => {
    const first = document.querySelector('.ramp-calc');
    if (first) first.dispatchEvent(new Event('input'));
  };
  document.querySelectorAll('[data-unit-system]').forEach(btn => {
    btn.addEventListener('click', () => { setUnitSystem(btn.getAttribute('data-unit-system')); refreshRampBadge(); });
  });
  renderUnitButtons();
}

// --- STARTING MILEAGE RAMP-UP CALCULATOR ---
export function initRampCalculator() {
  const badge = $('ramp-gradient-badge');
  const badgeBase = 'px-2.5 py-1 rounded-sm text-xs font-mono font-semibold ';

  function updateRamp() {
    const lastWeek = rampWeeks();
    const w1 = parseFloat($('field-week1DailyMiles').value) || 0;
    const wLast = parseFloat($(`field-week${lastWeek}DailyMiles`).value) || 0;

    if (lastWeek < 2 || !w1 || !wLast) {
      if (badge) badge.textContent = 'Your ramp-up';
      return;
    }

    const delta = wLast - w1;
    const unit = state.unitSystem === 'metric' ? 'km/day' : 'mi/day';
    // The thresholds are in miles per day, whichever unit is shown.
    const deltaMiles = state.unitSystem === 'metric' ? delta / unitFactorFor('field-week1DailyMiles') : delta;
    if (deltaMiles > 10) {
      badge.textContent = `Fast ramp-up (+${delta.toFixed(1)} ${unit})`;
      badge.className = badgeBase + 'bg-rose-950 text-rose-300 border border-rose-800';
    } else if (deltaMiles >= 4) {
      badge.textContent = `Gradual ramp-up (+${delta.toFixed(1)} ${unit})`;
      badge.className = badgeBase + 'bg-pine-950 text-pine-300 border border-pine-800';
    } else if (delta < 0) {
      badge.textContent = `Slowed down (${delta.toFixed(1)} ${unit})`;
      badge.className = badgeBase + 'bg-amber-950 text-amber-300 border border-amber-800';
    } else {
      badge.textContent = `Steady pace (+${delta.toFixed(1)} ${unit})`;
      badge.className = badgeBase + 'bg-slate-800 text-slate-300 border border-slate-700';
    }
  }

  document.querySelectorAll('.ramp-calc').forEach(inp => inp.addEventListener('input', updateRamp));
}

// --- RAMP-UP WEEKS (hikes shorter than four weeks) ---
function rampWeeks() {
  return parseInt($('field-rampWeeksHiked').value, 10) || 4;
}

/** Shows mileage inputs for the first `weeks` weeks and disables the rest. */
export function setRampWeeks(weeks) {
  state.rampWeeks = weeks;
  $('field-rampWeeksHiked').value = String(weeks);
  const WORDS = ['', 'one week', 'two weeks', 'three weeks'];
  $('ramp-weeks-note').textContent = weeks >= 4
    ? 'Your dates cover four weeks or more, so all four weeks are asked.'
    : `Your dates cover ${WORDS[weeks]}, so only ${weeks === 1 ? 'week 1 is' : `the first ${WORDS[weeks].replace(' weeks', '')} weeks are`} asked.`;
  for (let n = 1; n <= 4; n++) refreshInputState(`week${n}DailyMiles`);

  const first = document.querySelector('.ramp-calc');
  if (first) first.dispatchEvent(new Event('input'));
}

/**
 * Enables or disables one input: disabled when answered "Don't know" or,
 * for ramp-up weeks, beyond the weeks hiked.
 */
function refreshInputState(fieldName) {
  const field = Schema.FIELDS_BY_NAME[fieldName];
  const input = $(field.input);
  if (!input) return;
  const week = /^week(\d)DailyMiles$/.exec(fieldName);
  const notHiked = week ? Number(week[1]) > state.rampWeeks : false;
  const unknown = state.unknownFields.has(fieldName);
  const disabled = notHiked || unknown;

  input.disabled = disabled;
  input.classList.toggle('opacity-40', disabled);
  input.classList.toggle('cursor-not-allowed', disabled);
  if (disabled) {
    input.value = '';
    input.placeholder = notHiked ? 'N/A' : "Don't know";
  } else {
    const cfg = UNIT_INPUTS.find(c => c.input === input.id);
    input.placeholder = cfg ? cfg[state.unitSystem].placeholder : (input.getAttribute('data-placeholder') || '');
  }
}

/** The number of weeks with mileage boxes follows the trail dates from step 1 (not asked). */
export function syncRampWeeksWithDates() {
  const days = Schema.daysOnTrail($('field-startDate').value, $('field-endDate').value);
  if (days !== null) setRampWeeks(Math.min(4, Math.ceil(days / 7)));
}

// --- UNITS: metric by default outside the US ---------------------------------
export function initDefaultUnits() {
  // A saved draft brings its own unit system (see restoreDraft).
  if (readDraft()) return;
  const lang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US';
  const [language, region] = lang.split('-');
  const imperial = region ? ['US', 'LR', 'MM'].includes(region.toUpperCase()) : language === 'en';
  if (!imperial) setUnitSystem('metric');
}

// --- "DON'T KNOW" ANSWERS ------------------------------------------------------
function setUnknown(fieldNames, unknown) {
  fieldNames.forEach(name => {
    if (unknown) state.unknownFields.add(name);
    else state.unknownFields.delete(name);
    refreshInputState(name);
  });
  const first = document.querySelector('.ramp-calc');
  if (first) first.dispatchEvent(new Event('input'));
}

export function initDontKnowToggles() {
  document.querySelectorAll('.dont-know-toggle').forEach(box => {
    const fields = box.getAttribute('data-fields').split(',');
    // Remember the original hint so it comes back when unticked.
    fields.forEach(name => {
      const input = $(Schema.FIELDS_BY_NAME[name].input);
      if (input && !input.hasAttribute('data-placeholder')) input.setAttribute('data-placeholder', input.placeholder);
    });
    box.addEventListener('change', () => setUnknown(fields, box.checked));
  });
}
