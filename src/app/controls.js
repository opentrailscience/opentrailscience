/**
 * Survey inputs: choice cards, dropdown hints, sliders, pills and the hike years.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, Schema, state } from './core.js';

// --- POPULATE HIKE YEARS ---
export function initHikeYears() {
  const select = $('field-hikeYear');
  if (!select) return;
  const currentYear = new Date().getFullYear();
  select.innerHTML = '<option value="" disabled selected>Select the year…</option>';
  // Same lower bound as the server check.
  for (let y = currentYear; y >= Schema.FIELDS_BY_NAME.hikeYear.min; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = String(y);
    select.appendChild(opt);
  }
}

// --- CHOICE CARDS SELECTION (Radio replacement) ---
/** Marks a choice card (un)selected, for the eye and for screen readers. */
export function setCardSelected(card, selected) {
  card.classList.toggle('selected', selected);
  card.setAttribute('aria-checked', String(selected));
}

export function initChoiceCards() {
  // The cards act as radio buttons: reachable with Tab, chosen with Enter or Space.
  document.querySelectorAll('.choice-card').forEach(card => {
    const group = card.parentElement;
    if (!group.hasAttribute('role')) {
      group.setAttribute('role', 'radiogroup');
      const label = group.parentElement.querySelector('label') || group.previousElementSibling;
      if (label) {
        const text = label.cloneNode(true);
        text.querySelectorAll('button, .text-red').forEach(el => el.remove()); // info button, required star
        const name = text.textContent.replace(/\s+/g, ' ').trim();
        if (name) group.setAttribute('aria-label', name);
      }
    }
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', 'false');
    card.tabIndex = 0;
    card.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); card.click(); }
    });
    card.addEventListener('click', () => {
      const name = card.getAttribute('data-name');
      const val = card.getAttribute('data-value');
      if (!name || !val) return;

      document.querySelectorAll(`.choice-card[data-name="${name}"]`).forEach(c => setCardSelected(c, false));
      setCardSelected(card, true);

      const hiddenInput = $(`field-${name}`);
      if (hiddenInput) {
        hiddenInput.value = val;
        hiddenInput.dispatchEvent(new Event('change'));
      }
    });
  });
}

// --- DROPDOWN HINTS: short option labels, details (data-hint) shown below once picked ---
// On wider screens these selects put the detail back into the option itself
// ("Pacific Crest Trail (PCT) - 2,650 mi / 4,265 km"); only phones need the short labels.
const HINT_IN_LABEL_SELECTS = ['field-trail'];
const wideScreen = window.matchMedia('(min-width: 640px)');

function hintInLabel(select) {
  return wideScreen.matches && HINT_IN_LABEL_SELECTS.includes(select.id);
}

export function updateOptionHint(select) {
  const hint = $(`${select.id}-hint`);
  const option = select.options[select.selectedIndex];
  const text = (option && !hintInLabel(select) && option.getAttribute('data-hint')) || '';
  hint.textContent = text;
  hint.classList.toggle('hidden', !text);
}

function applyOptionLabels(select) {
  select.querySelectorAll('option[data-hint]').forEach(option => {
    if (!option.hasAttribute('data-label')) option.setAttribute('data-label', option.textContent);
    const label = option.getAttribute('data-label');
    option.textContent = hintInLabel(select) ? `${label} - ${option.getAttribute('data-hint')}` : label;
  });
  updateOptionHint(select);
}

export function initOptionHints() {
  const selects = Array.from(document.querySelectorAll('select')).filter(select => select.querySelector('option[data-hint]'));
  selects.forEach(select => {
    const hint = document.createElement('span');
    hint.id = `${select.id}-hint`;
    hint.className = 'hidden text-xs text-muted mt-1 block';
    hint.setAttribute('aria-live', 'polite');
    select.after(hint);
    select.setAttribute('data-has-hints', '');
    select.addEventListener('change', () => updateOptionHint(select));
    applyOptionLabels(select);
  });
  // Rotating a tablet or resizing the window switches between the two styles.
  wideScreen.addEventListener('change', () => selects.forEach(applyOptionLabels));
}

// --- SLIDERS WITH DYNAMIC LABELS ---
const SLIDER_LABELS = {};

/** A slider only counts as answered once the hiker has moved it. */
function bindSlider(inputId, labelId, describe) {
  const slider = $(inputId);
  const label = $(labelId);
  SLIDER_LABELS[inputId] = labelId;
  if (slider && label) {
    const touch = () => {
      state.touchedSliders.add(inputId);
      slider.classList.remove('slider-untouched');
      label.textContent = describe(parseFloat(slider.value));
    };
    slider.addEventListener('input', touch);
    // A tap on the current position is an answer too; it fires no input event.
    slider.addEventListener('change', touch);
    slider.addEventListener('pointerup', touch);
  }
}

export function resetSlider(inputId) {
  const slider = $(inputId);
  state.touchedSliders.delete(inputId);
  slider.value = slider.defaultValue;
  slider.classList.add('slider-untouched');
  $(SLIDER_LABELS[inputId]).textContent = 'Tap where it fits';
}

/**
 * A scale of numbers under the rating sliders (1 to 10, 0 to 10), lined up with
 * where the handle lands, so an untouched slider reads as a scale to tap on
 * rather than a disabled bar. Tapping a number answers it too.
 */
const SCALED_SLIDERS = ['field-preTrailFitnessRating', 'field-sleepQualityRating', 'field-overallEnjoymentRating'];

function addSliderScales() {
  SCALED_SLIDERS.forEach(id => {
    const slider = $(id);
    if (!slider) return;
    const scale = document.createElement('div');
    scale.className = 'slider-scale';
    scale.setAttribute('aria-hidden', 'true'); // the slider itself is what screen readers use
    for (let v = Number(slider.min); v <= Number(slider.max); v++) {
      const mark = document.createElement('span');
      mark.textContent = String(v);
      mark.addEventListener('click', () => {
        slider.value = String(v);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      });
      scale.appendChild(mark);
    }
    slider.after(scale);
  });
}

export function initSliders() {
  addSliderScales();
  bindSlider('field-preTrailFitnessRating', 'fitness-label', v => {
    let desc = 'Elite mountain athlete';
    if (v <= 2) desc = 'Couch to trail';
    else if (v <= 4) desc = 'Lightly active';
    else if (v <= 6) desc = 'Active, casual runner';
    else if (v <= 8) desc = 'Very fit hiker';
    return `${v} / 10 · ${desc}`;
  });

  bindSlider('field-sleepQualityRating', 'sleep-label', v => `${v} / 10`);

  bindSlider('field-percentHikingAlone', 'alone-label', v => {
    if (v === 0) return '0% · always with others';
    if (v === 100) return '100% · always alone';
    return `${v}% alone`;
  });

  bindSlider('field-overallEnjoymentRating', 'enjoyment-label', v => {
    let desc = 'Best thing I ever did';
    if (v <= 2) desc = 'A miserable sufferfest';
    else if (v <= 4) desc = 'Rough with rare highs';
    else if (v <= 6) desc = 'Mixed highs and lows';
    else if (v <= 8) desc = 'Great journey';
    return `${v} / 10 · ${desc}`;
  });

  initNoTraining();
  bindSlider('field-trainingFocus', 'training-label', v => {
    let desc = 'Only strength training';
    if (v <= 0.25) desc = 'Only cardio';
    else if (v <= 0.4) desc = 'Mostly cardio';
    else if (v <= 0.6) desc = 'Balanced mix';
    else if (v <= 0.75) desc = 'Mostly strength';
    return `${v.toFixed(2)} · ${desc}`;
  });
}

// --- "I didn't train at all" (trainedBeforeHike) ----------------------------
// Moving the training slider means trained (true); the checkbox means false
// and switches the slider off, so trainingFocus is stored as null.
export function syncNoTraining() {
  const noTraining = $('field-trainedBeforeHike').value === 'false';
  const slider = $('field-trainingFocus');
  $('no-training-toggle').checked = noTraining;
  slider.disabled = noTraining;
  slider.classList.toggle('opacity-30', noTraining);
  if (noTraining) $('training-label').textContent = "Didn't train";
  else if (!state.touchedSliders.has('field-trainingFocus')) $('training-label').textContent = 'Tap where it fits';
}

function initNoTraining() {
  const field = $('field-trainedBeforeHike');
  $('no-training-toggle').addEventListener('change', e => {
    field.value = e.target.checked ? 'false' : (state.touchedSliders.has('field-trainingFocus') ? 'true' : '');
    field.dispatchEvent(new Event('change', { bubbles: true }));
    if (!e.target.checked && state.touchedSliders.has('field-trainingFocus')) $('field-trainingFocus').dispatchEvent(new Event('input'));
  });
  // Drafts and "Start over" set the hidden field; the checkbox and slider follow it.
  field.addEventListener('change', syncNoTraining);
  const trained = () => {
    if (field.value === 'false') return;
    field.value = 'true';
  };
  ['input', 'change', 'pointerup'].forEach(type => $('field-trainingFocus').addEventListener(type, trained));
}

// --- MULTI-SELECT PILLS (injuries, illness, prior injuries, deadline) ---
export function pillSet(field) {
  if (!state.pillSelections[field]) state.pillSelections[field] = new Set();
  return state.pillSelections[field];
}

export function initPillGroups() {
  document.querySelectorAll('.pill-group').forEach(group => {
    const field = group.getAttribute('data-field');
    group.querySelectorAll('.select-pill').forEach(pill => {
      pill.setAttribute('role', 'checkbox');
      pill.setAttribute('aria-checked', 'false');
      pill.tabIndex = 0;
      const toggle = () => {
        const val = pill.getAttribute('data-val');
        const set = pillSet(field);
        if (set.has(val)) set.delete(val);
        else {
          // "Neither" or "Prefer not to say" (data-exclusive) stand alone.
          group.querySelectorAll('.select-pill').forEach(other => {
            if (other !== pill && (pill.hasAttribute('data-exclusive') || other.hasAttribute('data-exclusive'))) set.delete(other.getAttribute('data-val'));
          });
          set.add(val);
        }
        group.querySelectorAll('.select-pill').forEach(p => {
          p.classList.toggle('active', set.has(p.getAttribute('data-val')));
          p.setAttribute('aria-checked', String(set.has(p.getAttribute('data-val'))));
        });
      };
      pill.addEventListener('click', toggle);
      pill.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
      });
    });
  });
}

/** The urination aids question follows the biological sex answer (urinationAids `when` in the schema). */
export function initUrinationAids() {
  const sex = $('field-biologicalSex');
  const box = $('urination-aids-container');
  const sync = () => {
    const asked = Schema.FIELDS_BY_NAME.urinationAids.when({ biologicalSex: sex.value });
    box.classList.toggle('hidden', !asked);
    if (!asked) {
      pillSet('urinationAids').clear();
      box.querySelectorAll('.select-pill').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-checked', 'false'); });
    }
  };
  sex.addEventListener('change', sync);
  sync();
}

export function clearPills() {
  state.pillSelections = {};
  document.querySelectorAll('.select-pill.active').forEach(p => {
    p.classList.remove('active');
    p.setAttribute('aria-checked', 'false');
  });
}
