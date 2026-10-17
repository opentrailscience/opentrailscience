/**
 * Open Trail Science - Thru-Hiker Survey client application
 * Vanilla JavaScript: hash router, five-step survey wizard with a draft saved
 * in this browser, live stats, insights and the dataset pages. Field
 * definitions, unit handling and validation come from lib/survey-schema.js
 * (window.SurveySchema), shared with the server.
 */

(function () {
  'use strict';

  const Schema = window.SurveySchema;
  const Stats = window.SurveyStats;
  const HumanCheck = window.HumanCheck;

  // Page views only read prebuilt files (served by the CDN, no function or
  // database call). They are rebuilt by scripts/export-static-dataset.js.
  const STATIC_INSIGHTS_URL = '/data/insights.json';
  const STATIC_STATS_URL = '/data/stats.json';
  const STATIC_PREVIEW_URL = '/data/preview.json';
  // Below this many public records the home page and Insights show a
  // "be part of the first 50" invitation instead of statistics.
  const FIRST_HIKERS_GOAL = 50;

  // --- STATE STORE ---
  const state = {
    currentView: 'home',
    currentStep: 1,
    totalSteps: 5,
    unitSystem: 'imperial', // 'imperial' (lbs, in, mi) or 'metric' (kg, cm, km)
    stats: null,
    previewPage: 1,
    previewRows: null, // preview.json, loaded once
    previewLimit: 8,
    pillSelections: {}, // multi-select questions: field name -> Set of values
    consentGiven: false,
    unknownFields: new Set(), // fields answered "Don't know"
    touchedSliders: new Set(), // sliders count as answered only once moved
    rampWeeks: 4,
    surveyStartedAt: null,
    publicCount: null,
    hasSubmitted: false,
    shareText: null,
    shareCard: null, // { blob, url, filename }
    trailCheck: { round: null, choice: null, passed: false }
  };

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
      milestoneDesc: 'The last climb, we promise. How did it end, and how did it feel?'
    }
  ];

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
      imperial: { label: 'Week 1 (mi/day)', placeholder: '10.5', decimals: 1 },
      metric: { label: 'Week 1 (km/day)', placeholder: '16.9', decimals: 1 }
    },
    {
      input: 'field-week2DailyMiles', label: 'label-week2',
      imperial: { label: 'Week 2 (mi/day)', placeholder: '14.0', decimals: 1 },
      metric: { label: 'Week 2 (km/day)', placeholder: '22.5', decimals: 1 }
    },
    {
      input: 'field-week3DailyMiles', label: 'label-week3',
      imperial: { label: 'Week 3 (mi/day)', placeholder: '17.5', decimals: 1 },
      metric: { label: 'Week 3 (km/day)', placeholder: '28.2', decimals: 1 }
    },
    {
      input: 'field-week4DailyMiles', label: 'label-week4',
      imperial: { label: 'Week 4 (mi/day)', placeholder: '20.0', decimals: 1 },
      metric: { label: 'Week 4 (km/day)', placeholder: '32.2', decimals: 1 }
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
  const TOGGLE_OFF = 'px-3.5 py-1.5 max-sm:px-5 max-sm:py-2.5 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 hover:text-white transition';
  const UNIT_BUTTON_ON = 'px-3 py-1 rounded-md text-xs font-bold bg-brand text-white transition';
  const UNIT_BUTTON_OFF = 'px-3 py-1 rounded-md text-xs font-bold text-slate-400 hover:text-white transition';
  const RAMP_BUTTON_ON = 'ramp-weeks-btn px-2 sm:px-3 py-1 rounded-md text-xs font-bold whitespace-nowrap bg-brand text-white transition';
  const RAMP_BUTTON_OFF = 'ramp-weeks-btn px-2 sm:px-3 py-1 rounded-md text-xs font-bold whitespace-nowrap text-slate-400 hover:text-white transition';

  const $ = id => document.getElementById(id);

  // --- DOM REFERENCES ---
  const views = {
    home: $('view-home'),
    survey: $('view-survey'),
    success: $('view-success'),
    download: $('view-download'),
    insights: $('view-insights'),
    about: $('view-about'),
    privacy: $('view-privacy')
  };

  const navLinks = {
    home: $('nav-link-home'),
    survey: $('nav-link-survey'),
    insights: $('nav-link-insights'),
    download: $('nav-link-download')
  };

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', () => {
    // Both forms are handled in JS; pressing Enter must never submit them.
    document.querySelectorAll('form').forEach(form => form.addEventListener('submit', e => e.preventDefault()));
    initHikeYears();
    initDefaultUnits();
    initChoiceCards();
    initOptionHints();
    initSliders();
    initUnitSwitcher();
    initPillGroups();
    initConsent();
    initPrivacyPage();
    initConditionals();
    initHeightFeetInches();
    initDirectionCards();
    initRampCalculator();
    initRampWeeks();
    initCodeSnippets();
    initWizardControls();
    initPreviewTable();
    initTrailQuickCards();
    initDontKnowToggles();
    initSurveyReset();
    initTrailCheck();
    initFeedback();
    initMyHike();
    initTheme();
    initDatasetDocs();
    markRequiredInputs();
    restoreDraft();
    initDraftAutosave();
    initRouter();
    fetchStats();
  });

  // --- HELPERS ---
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function humanize(value) {
    return (value || '').replace(/_/g, ' ');
  }

  /** Escapes a value for use inside a quoted CSS attribute selector. */
  function attrValue(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function orDash(value, suffix) {
    return value === null || value === undefined ? '—' : `${value}${suffix || ''}`;
  }

  // --- ROUTER ---
  function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    let hash = (window.location.hash || '#home').replace('#', '').toLowerCase();
    // A link to a section inside a view (e.g. #privacy-delete) opens that view and scrolls to it.
    let anchor = null;
    if (!views[hash]) {
      const target = hash && document.getElementById(hash);
      const view = target && target.closest('.app-view');
      if (view) {
        anchor = target;
        hash = view.id.replace('view-', '');
      } else {
        hash = 'home';
      }
    }
    // The thank-you page only makes sense right after submitting.
    if (hash === 'success' && !state.hasSubmitted) {
      history.replaceState(null, '', '#home');
      hash = 'home';
    }

    state.currentView = hash;

    Object.keys(views).forEach(key => {
      views[key].classList.toggle('active', key === hash);
    });

    // Update active nav link styling
    Object.keys(navLinks).forEach(key => {
      // The survey link is a green button already; it keeps its look everywhere.
      if (!navLinks[key] || key === 'survey') return;
      if (key === hash) {
        navLinks[key].classList.add('text-white', 'bg-slate-800/80');
      } else {
        navLinks[key].classList.remove('text-white', 'bg-slate-800/80');
      }
    });

    if (anchor) {
      setTimeout(() => anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // The server uses the time spent on the form as a bot check.
    if (hash === 'survey' && !state.surveyStartedAt) {
      state.surveyStartedAt = Date.now();
    }

    if (hash === 'download') {
      fetchPreviewData();
      renderDatasetMeta();
    }
    if (hash === 'insights') loadInsights();
  }

  // --- POPULATE HIKE YEARS ---
  function initHikeYears() {
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

  // --- MY SUBMISSIONS (so the counters include them right away) ---------------
  // The counters come from a snapshot rebuilt every few hours. Until a snapshot
  // newer than a hiker's submission arrives, it is added on this page. Kept in
  // memory only: nothing is stored in the browser, a reload shows the snapshot.
  const mySubmissions = [];
  const normalizeCode = code => String(code || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

  /** `serverDate` is the submit response's Date header, so a wrong device clock doesn't matter. */
  function rememberMySubmission(trail, deletionCode, serverDate) {
    mySubmissions.push({ at: Date.parse(serverDate) || Date.now(), trail, code: normalizeCode(deletionCode) });
  }

  function forgetMySubmission(deletionCode) {
    const code = normalizeCode(deletionCode);
    const i = mySubmissions.findIndex(s => s.code && s.code === code);
    if (i >= 0) mySubmissions.splice(i, 1);
  }

  /** My submissions that the snapshot generated at `snapshotTime` doesn't include yet. */
  function mySubmissionsAfter(snapshotTime) {
    const builtAt = Date.parse(snapshotTime);
    if (!Number.isFinite(builtAt)) return [];
    return mySubmissions.filter(s => s.at > builtAt);
  }

  // --- STATS (prebuilt stats.json) & ANIMATED COUNTER ---
  async function fetchStats() {
    try {
      const res = await fetch(STATIC_STATS_URL);
      if (!res.ok) throw new Error('stats.json returned ' + res.status);
      state.stats = await res.json();
      renderStats(state.stats, 'Open Dataset');
    } catch (err) {
      console.warn('Could not load the stats snapshot:', err.message);
    }
  }

  function renderStats(data, sourceLabel) {
    const mine = mySubmissionsAfter(data.lastUpdated);
    const total = (data.totalCount || 0) + mine.length;
    const early = total < FIRST_HIKERS_GOAL;
    state.publicCount = total;
    renderDatasetMeta();

    // Until there are enough hikes, invite people instead of showing thin numbers.
    $('stats-first50').classList.toggle('hidden', !early);
    $('stats-tiles').classList.toggle('hidden', early);
    if (early) {
      renderFirstHikersProgress($('first50-bar'), $('first50-count'), total, mine.length > 0);
      $('first50-progress').setAttribute('aria-valuenow', String(total));
    } else {
      animateNumber($('stat-total-count'), total, 0, '');
      animateNumber($('stat-completion-rate'), data.completionRate, 0, '%');
      animateNumber($('stat-median-baseweight'), data.medianBaseWeightLbs, 1, ' lbs');
      animateNumber($('stat-avg-miles'), data.avgDailyMiles, 1, ' mi');
    }

    const badgeEl = $('hero-live-badge-text');
    if (badgeEl) {
      badgeEl.textContent = early
        ? `Early days • ${total === 0 ? 'be the very first hiker' : `${total} ${total === 1 ? 'hiker' : 'hikers'} so far`}`
        : `${total} Hiker Journeys Logged • ${sourceLabel}`;
    }

    ['pct', 'at', 'cdt', 'ct', 'azt', 'tmb', 'ta'].forEach(t => {
      const el = $(`trail-count-${t}`);
      if (el) {
        const count = ((data.trails || {})[t.toUpperCase()] || 0) + mine.filter(s => s.trail === t.toUpperCase()).length;
        el.textContent = early ? 'Be one of the first' : `${count} ${count === 1 ? 'entry' : 'entries'}`;
      }
    });
  }

  function renderFirstHikersProgress(bar, label, total, includesYou) {
    if (bar) bar.style.width = `${Math.min(100, (total / FIRST_HIKERS_GOAL) * 100)}%`;
    if (label) {
      label.textContent = total === 0
        ? 'Be the very first'
        : `${total} of ${FIRST_HIKERS_GOAL} hikers so far${includesYou ? ', including you 🎉' : ''}`;
    }
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
  function initTrailQuickCards() {
    document.querySelectorAll('.trail-quick-card').forEach(card => {
      card.addEventListener('click', () => {
        const trail = card.getAttribute('data-trail');
        const trailSelect = $('field-trail');
        if (trailSelect) {
          trailSelect.value = trail;
          trailSelect.dispatchEvent(new Event('change'));
        }
        window.location.hash = '#survey';
        showToast(`Selected: ${Schema.trailName(trail) || 'another trail'}`);
      });
    });
  }

  // --- CHOICE CARDS SELECTION (Radio replacement) ---
  /** Marks a choice card (un)selected, for the eye and for screen readers. */
  function setCardSelected(card, selected) {
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-checked', String(selected));
  }

  function initChoiceCards() {
    // The cards act as radio buttons: reachable with Tab, chosen with Enter or Space.
    document.querySelectorAll('.choice-card').forEach(card => {
      const group = card.parentElement;
      if (!group.hasAttribute('role')) {
        group.setAttribute('role', 'radiogroup');
        const label = group.parentElement.querySelector('label') || group.previousElementSibling;
        if (label) {
          const text = label.cloneNode(true);
          text.querySelectorAll('button, .text-rose-400').forEach(el => el.remove()); // info button, required star
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

  function updateOptionHint(select) {
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

  function initOptionHints() {
    const selects = Array.from(document.querySelectorAll('select')).filter(select => select.querySelector('option[data-hint]'));
    selects.forEach(select => {
      const hint = document.createElement('span');
      hint.id = `${select.id}-hint`;
      hint.className = 'hidden text-xs text-slate-400 mt-1 block';
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

  function resetSlider(inputId) {
    const slider = $(inputId);
    state.touchedSliders.delete(inputId);
    slider.value = slider.defaultValue;
    slider.classList.add('slider-untouched');
    $(SLIDER_LABELS[inputId]).textContent = 'Move the slider';
  }

  function initSliders() {
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
  function syncNoTraining() {
    const noTraining = $('field-trainedBeforeHike').value === 'false';
    const slider = $('field-trainingFocus');
    $('no-training-toggle').checked = noTraining;
    slider.disabled = noTraining;
    slider.classList.toggle('opacity-30', noTraining);
    if (noTraining) $('training-label').textContent = "Didn't train";
    else if (!state.touchedSliders.has('field-trainingFocus')) $('training-label').textContent = 'Move the slider';
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
  function pillSet(field) {
    if (!state.pillSelections[field]) state.pillSelections[field] = new Set();
    return state.pillSelections[field];
  }

  function initPillGroups() {
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
          else set.add(val);
          pill.classList.toggle('active', set.has(val));
          pill.setAttribute('aria-checked', String(set.has(val)));
        };
        pill.addEventListener('click', toggle);
        pill.addEventListener('keydown', e => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
        });
      });
    });
  }

  function clearPills() {
    state.pillSelections = {};
    document.querySelectorAll('.select-pill.active').forEach(p => {
      p.classList.remove('active');
      p.setAttribute('aria-checked', 'false');
    });
  }

  // --- CONDITIONAL VISIBILITY TRIGGERS ---
  // Yes/No questions: button pair, hidden boolean field, follow-up container.
  const YES_NO_TOGGLES = [
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

  function initConditionals() {
    // NOBO/SOBO help: shown while hovering those cards or the (i) button, or toggled with the button (touch, keyboard).
    const help = $('direction-help');
    const helpBtn = $('direction-help-btn');
    let helpPinned = false;
    const showHelp = visible => {
      help.classList.toggle('hidden', !visible);
      helpBtn.setAttribute('aria-expanded', String(visible));
    };
    helpBtn.addEventListener('click', () => { helpPinned = !helpPinned; showHelp(helpPinned); });
    // Hover only with a real mouse. On phones a tap counts as hovering, so tapping
    // NOBO opened the box and the next tap anywhere closed it: the page jumped
    // under the finger. There the (i) button is the way to open it.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      helpBtn.addEventListener('mouseenter', () => showHelp(true));
      helpBtn.addEventListener('mouseleave', () => showHelp(helpPinned));
      // Hovering NOBO or SOBO shows the explanation too; these cards change with the
      // trail (clockwise, eastbound, ...), so check what they mean right now.
      ['direction-card-0', 'direction-card-1'].forEach(id => {
        const card = $(id);
        const isNoboSobo = () => ['NOBO', 'SOBO'].includes(card.getAttribute('data-value'));
        card.addEventListener('mouseenter', () => { if (isNoboSobo()) showHelp(true); });
        card.addEventListener('mouseleave', () => showHelp(helpPinned));
      });
    }

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

  function setUnitSystem(system) {
    if (state.unitSystem === system) return;

    $('btn-unit-metric').className = system === 'metric' ? UNIT_BUTTON_ON : UNIT_BUTTON_OFF;
    $('btn-unit-imperial').className = system === 'imperial' ? UNIT_BUTTON_ON : UNIT_BUTTON_OFF;

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
    applyHeightMode();
  }

  // --- HEIGHT: feet + inches in imperial mode ----------------------------------
  // The stored answer stays field-height (inches, or cm in metric mode); in
  // imperial mode the hiker types feet and inches, which are kept in sync.
  function syncHeightParts() {
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

  function initHeightFeetInches() {
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
  function updateDirectionCards() {
    const options = Schema.directionsFor($('field-trail').value);
    options.forEach((value, i) => {
      const card = $(`direction-card-${i}`);
      const [title, subtitle] = Schema.DIRECTION_LABELS[value];
      if (card.getAttribute('data-value') !== value) setCardSelected(card, false);
      card.setAttribute('data-value', value);
      card.children[0].textContent = title;
      card.children[1].textContent = subtitle;
    });
    // The NOBO/SOBO explanation only fits trails that use NOBO/SOBO (including custom ones).
    const nobo = options[0] === 'NOBO';
    $('direction-help-btn').classList.toggle('hidden', !nobo);
    if (!nobo) $('direction-help').classList.add('hidden');
    // An answer that this trail doesn't offer is cleared.
    const field = $('field-direction');
    if (field.value && !['Flip-flop', 'Section'].includes(field.value) && !options.includes(field.value)) field.value = '';
  }

  function initDirectionCards() {
    $('field-trail').addEventListener('change', updateDirectionCards);
  }

  function initUnitSwitcher() {
    const btnImperial = $('btn-unit-imperial');
    const btnMetric = $('btn-unit-metric');
    if (!btnImperial || !btnMetric) return;

    const refreshRampBadge = () => {
      const first = document.querySelector('.ramp-calc');
      if (first) first.dispatchEvent(new Event('input'));
    };
    btnImperial.addEventListener('click', () => { setUnitSystem('imperial'); refreshRampBadge(); });
    btnMetric.addEventListener('click', () => { setUnitSystem('metric'); refreshRampBadge(); });
  }

  // --- STARTING MILEAGE RAMP-UP CALCULATOR ---
  function initRampCalculator() {
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
  function setRampWeeks(weeks) {
    state.rampWeeks = weeks;
    $('field-rampWeeksHiked').value = String(weeks);
    document.querySelectorAll('.ramp-weeks-btn').forEach(btn => {
      btn.className = Number(btn.getAttribute('data-weeks')) === weeks ? RAMP_BUTTON_ON : RAMP_BUTTON_OFF;
    });
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

  function initRampWeeks() {
    document.querySelectorAll('.ramp-weeks-btn').forEach(btn => {
      btn.addEventListener('click', () => setRampWeeks(Number(btn.getAttribute('data-weeks'))));
    });
  }

  /** Preselects the ramp-up week count that matches the trail dates from step 1. */
  function syncRampWeeksWithDates() {
    const days = Schema.daysOnTrail($('field-startDate').value, $('field-endDate').value);
    if (days !== null) setRampWeeks(Math.min(4, Math.ceil(days / 7)));
  }

  // --- MULTI-STEP WIZARD ENGINE ---
  function initWizardControls() {
    const btnNext = $('btn-wizard-next');
    const btnPrev = $('btn-wizard-prev');
    if (btnNext) btnNext.addEventListener('click', handleNextStep);
    if (btnPrev) btnPrev.addEventListener('click', handlePrevStep);
  }

  function renderWizardStep(stepNumber, options) {
    state.currentStep = stepNumber;
    const meta = MILESTONES[stepNumber - 1];

    for (let i = 1; i <= state.totalSteps; i++) {
      const stepEl = $(`step-${i}`);
      if (stepEl) stepEl.classList.toggle('active', i === stepNumber);
    }

    $('wizard-step-badge').textContent = meta.badge;
    $('wizard-step-title').textContent = meta.title;
    $('wizard-progress-percent').textContent = meta.percent;
    $('wizard-progress-bar').style.width = meta.percent;
    $('wizard-milestone-title').textContent = meta.milestoneTitle;
    $('wizard-milestone-desc').textContent = meta.milestoneDesc;

    const btnPrev = $('btn-wizard-prev');
    btnPrev.disabled = stepNumber === 1;
    btnPrev.classList.toggle('opacity-40', stepNumber === 1);
    btnPrev.classList.toggle('cursor-not-allowed', stepNumber === 1);

    $('btn-wizard-next-text').textContent = meta.nextLabel;

    if (stepNumber === 4) syncRampWeeksWithDates();

    hideErrors();
    if (!options || options.scroll !== false) window.scrollTo({ top: 100, behavior: 'smooth' });
  }

  function handlePrevStep() {
    if (state.currentStep > 1) renderWizardStep(state.currentStep - 1);
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
        const num = raw === '' ? null : Number(raw);
        answers[field.name] = num === null || isNaN(num) ? num : Schema.toStoredUnit(num, field.unit, state.unitSystem);
      } else {
        answers[field.name] = raw === '' ? null : raw;
      }
    });
    return answers;
  }

  /** Tells assistive technology which inputs are required (the schema default). */
  function markRequiredInputs() {
    Schema.FIELDS.forEach(field => {
      const el = field.input && $(field.input);
      if (el && el.type !== 'hidden' && !field.optional) el.setAttribute('aria-required', 'true');
    });
  }

  function validateStep(step) {
    const fields = Schema.fieldsForStep(step);
    const result = Schema.validateSurvey(collectAnswers(), { fields, unitSystem: state.unitSystem });

    // Flag the inputs that need attention for screen readers.
    fields.forEach(name => {
      const el = Schema.FIELDS_BY_NAME[name].input && $(Schema.FIELDS_BY_NAME[name].input);
      if (!el) return;
      if (result.fieldErrors[name]) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    });

    // Sliders read better as an instruction than as "... is required".
    const errors = fields.filter(name => result.fieldErrors[name]).map(name => {
      const field = Schema.FIELDS_BY_NAME[name];
      const el = field.input && $(field.input);
      if (el && el.type === 'range' && !state.touchedSliders.has(el.id)) {
        return `Please move the slider for: ${(field.question || field.label).split(' (')[0]}`;
      }
      return result.fieldErrors[name];
    });
    return errors;
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
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      // Proof of work for these exact answers (see lib/human-check.js), about a second.
      btnNextText.textContent = 'Checking your trail permit… 🥾';
      const powNonce = await HumanCheck.solveProofOfWork(answers);
      btnNextText.textContent = 'Sending your answers…';

      const payload = Object.assign({}, answers, {
        website_url: $('website_url').value,
        hiker_anti_spam: $('hiker_anti_spam').value,
        formElapsedSeconds: Math.round((Date.now() - (state.surveyStartedAt || Date.now())) / 1000),
        trailCheck: { id: state.trailCheck.round.id, choice: state.trailCheck.choice },
        powNonce,
        schemaVersion: Schema.SCHEMA_VERSION
      });

      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok || !result.success) {
        throw new Error((result.errors && result.errors.join(', ')) || `Submission failed (HTTP ${res.status})`);
      }

      // The server returns the stored record, including the derived pace.
      populateSuccessCard(result.data || Object.assign({}, answers, {
        averageDailyMiles: Schema.computeAverageDailyMiles(answers)
      }));
      populateComparison(result.comparison);
      populateDeletionCode(result.deletionCode);
      prepareShare(result.data || answers, result.comparison);
      setSuccessMode('submitted');

      state.hasSubmitted = true;
      resetFeedback();
      rememberMySubmission(answers.trail, result.deletionCode, res.headers.get('Date'));
      insightsLoaded = false; // show the new count next time
      window.location.hash = '#success';
      showToast('Survey submitted successfully! Thank you.');
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

  // How a hike ended looks the same everywhere: thank-you page, data preview and the
  // tags on the survey cards (index.html), in the colors the charts use for outcomes.
  const STATUS_BADGE_BASE = 'inline-block px-2 py-0.5 rounded-sm font-sans text-xs font-semibold whitespace-nowrap ';
  const STATUS_BADGE_COLORS = {
    continuous_purist: 'bg-emerald-950 text-emerald-300',
    flip_flop: 'bg-amber-950 text-amber-300',
    skipped_sections: 'bg-sky-950 text-sky-300',
    section_hike: 'bg-slate-800 text-slate-300',
    quit_early: 'bg-rose-950 text-rose-300'
  };
  const STATUS_LABELS = Schema.COMPLETION_LABELS;

  function statusBadgeClass(status) {
    return STATUS_BADGE_BASE + (STATUS_BADGE_COLORS[status] || STATUS_BADGE_COLORS.section_hike);
  }

  function statusBadge(status) {
    return `<span class="${statusBadgeClass(status)}">${escapeHtml(STATUS_LABELS[status] || status || '')}</span>`;
  }

  function populateSuccessCard(data) {
    const set = (id, text) => {
      const el = $(id);
      if (el) el.textContent = text;
    };
    set('summary-trail-badge', data.trail);
    set('summary-hike-year', `${data.hikeYear} Hike`);
    set('summary-status', STATUS_LABELS[data.completionStatus] || data.completionStatus);
    $('summary-status').className = statusBadgeClass(data.completionStatus);
    // In the units the hiker used in the survey.
    const metric = state.unitSystem === 'metric';
    const toMetric = (value, unit) => (typeof value === 'number' ? Math.round(value * Schema.UNITS[unit].factor * 10) / 10 : value);
    set('summary-base-weight', metric ? orDash(toMetric(data.baseWeightLbs, 'lb'), ' kg') : orDash(data.baseWeightLbs, ' lbs'));
    set('summary-daily-miles', metric ? orDash(toMetric(data.averageDailyMiles, 'mi/day'), ' km/day') : orDash(data.averageDailyMiles, ' mi/day'));
    set('summary-zero-days', data.totalZeroDays === 1 ? '1 day' : orDash(data.totalZeroDays, ' days'));
    set('summary-enjoyment', orDash(data.overallEnjoymentRating, ' / 10'));
    renderAllAnswers(data);
  }

  // --- ALL MY ANSWERS: every stored column of the hike, as on the dataset page ---
  // Ratings and shares get their scale; everything else is shown as answered.
  const ANSWER_SUFFIXES = { preTrailFitnessRating: ' / 10', sleepQualityRating: ' / 10', overallEnjoymentRating: ' / 10', percentHikingAlone: '%' };

  /** A stored value in the form's own words: the label of its option, card or pill. */
  function answerText(name, value) {
    if (name === 'trail') return Schema.trailName(value) || value;
    if (name === 'direction') return (Schema.DIRECTION_LABELS[value] || [value])[0];
    if (name === 'injuryLocations') return Schema.INJURY_LABELS[value] || humanize(value);
    if (name === 'trailDiet' && value === 'omnivore') return 'Neither vegetarian nor vegan';
    if (name === 'surveyMinutesBand') return `${value === 'under-5' ? 'Under 5' : value.replace('-', '–')} minutes`;
    const field = Schema.FIELDS_BY_NAME[name];
    const select = field && field.input && $(field.input);
    if (select && select.tagName === 'SELECT') {
      const option = Array.from(select.options).find(o => o.value === value);
      if (option) return option.getAttribute('data-label') || option.textContent;
    }
    const card = document.querySelector(`.choice-card[data-name="${attrValue(name)}"][data-value="${attrValue(value)}"]`);
    if (card) return (card.querySelector('.font-bold') || card).textContent.trim();
    const pill = document.querySelector(`.pill-group[data-field="${attrValue(name)}"] .select-pill[data-val="${attrValue(value)}"]`);
    if (pill) return pill.textContent.trim();
    const text = humanize(String(value));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** One answer as text, plus the same number in the other unit system (or ''). */
  function formatAnswer(col, value, data) {
    const unknown = (data.unknownAnswers || []).includes(col.name);
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) {
      return [unknown ? "Don't know" : "Doesn't apply", ''];
    }
    if (typeof value === 'boolean') return [value ? 'Yes' : 'No', ''];
    if (Array.isArray(value)) return [value.map(v => answerText(col.name, v)).join(', '), ''];
    const field = Schema.FIELDS_BY_NAME[col.name];
    if (typeof value === 'number' && field && field.unit) {
      const unit = Schema.UNITS[field.unit];
      const imperial = `${value} ${unit.label}`;
      const metric = `${Math.round(value * unit.factor * 10) / 10} ${unit.metric}`;
      return state.unitSystem === 'metric' ? [metric, imperial] : [imperial, metric];
    }
    return [typeof value === 'number' ? `${value}${ANSWER_SUFFIXES[col.name] || ''}` : answerText(col.name, value), ''];
  }

  function renderAllAnswers(data) {
    const body = $('all-answers-body');
    if (!body) return;
    $('all-answers').open = false;
    body.replaceChildren();
    let group = null;
    Schema.describeSchema().columns.forEach(col => {
      // Metric copies are shown next to their imperial column; "Don't know" is shown per answer.
      if (col.metricOf || col.name === 'unknownAnswers') return;
      const colGroup = col.step ? STEP_GROUPS[col.step] : (group || 'Record');
      if (colGroup !== group) {
        group = colGroup;
        const head = document.createElement('tr');
        const th = document.createElement('th');
        th.colSpan = 2;
        th.className = 'pt-3 pb-1 text-[11px] uppercase font-mono tracking-wider text-slate-400';
        th.textContent = group;
        head.appendChild(th);
        body.appendChild(head);
      }
      const [text, other] = formatAnswer(col, data[col.name], data);
      const row = document.createElement('tr');
      row.className = 'border-t border-slate-800/60 align-top';
      const label = document.createElement('td');
      label.className = 'py-1.5 pr-3 text-slate-400';
      label.textContent = col.label;
      const answer = document.createElement('td');
      answer.className = 'py-1.5 text-slate-200';
      answer.textContent = text;
      if (other) {
        const muted = document.createElement('span');
        muted.className = 'text-slate-500';
        muted.textContent = ` (${other})`;
        answer.appendChild(muted);
      }
      row.append(label, answer);
      body.appendChild(row);
    });
  }

  /** "Your base weight was lighter than 70% of PCT hikers." with the percentage highlighted. */
  function populateComparison(comparison) {
    const box = $('summary-comparison');
    const list = $('summary-comparison-list');
    if (!box || !list) return;

    list.innerHTML = '';
    if (!comparison || !comparison.items.length) {
      box.classList.add('hidden');
      return;
    }

    comparison.items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'flex gap-2';
      const icon = document.createElement('span');
      icon.className = 'text-pine-400 font-bold';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '•'; // neutral: the lines can be flattering or not
      const text = document.createElement('span');
      const marker = `${item.percent}%`;
      const [before, after] = item.text.split(marker);
      const strong = document.createElement('strong');
      strong.className = 'text-pine-300';
      strong.textContent = marker;
      text.append(before, strong, after || '');
      li.append(icon, text);
      list.appendChild(li);
    });

    $('summary-comparison-note').textContent =
      `Compared with ${comparison.peerCount} ${comparison.group} who shared their data.`;
    box.classList.remove('hidden');
  }

  /** Builds the share text and the share card image for this submission. */
  async function prepareShare(record, comparison) {
    state.shareText = Stats.buildShareText(record, comparison, { unitSystem: state.unitSystem });

    const container = $('share-card-container');
    if (state.shareCard) URL.revokeObjectURL(state.shareCard.url);
    state.shareCard = null;
    if (!container || !window.ShareCard) return;
    try {
      const blob = await window.ShareCard.render(record, comparison, { unitSystem: state.unitSystem });
      const url = URL.createObjectURL(blob);
      const filename = `open-trail-science-${(record.trail || 'hike').toLowerCase().replace(/\s+/g, '-')}-${record.hikeYear}.png`;
      state.shareCard = { blob, url, filename };
      $('share-card-preview').src = url;
      $('btn-download-card').href = url;
      $('btn-download-card').setAttribute('download', filename);
      container.classList.remove('hidden');
    } catch (err) {
      console.warn('Share card unavailable:', err);
      container.classList.add('hidden');
    }
  }

  async function shareSurvey() {
    const url = window.location.origin + window.location.pathname + '#survey';
    const text = state.shareText || 'Help build the open dataset on long-distance hiking. Sharing your hike takes about 10 minutes.';

    // Phones: share the card image with the text (apps often drop `url` when
    // files are attached, so it goes into the text).
    const card = state.shareCard;
    const file = card && typeof File === 'function' ? new File([card.blob], card.filename, { type: 'image/png' }) : null;
    const attempts = [];
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      attempts.push({ title: 'Open Trail Science', text: `${text} ${url}`, files: [file] });
    }
    if (navigator.share) attempts.push({ title: 'Open Trail Science', text, url });

    for (const data of attempts) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // the hiker closed the share sheet
      }
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(`${text} ${url}`);
      showToast('Copied to clipboard: paste it to your tramily!');
    } else {
      showToast('Share link: ' + url);
    }
  }

  // --- PUBLIC DOWNLOAD VIEW / DATA PREVIEW TABLE ---
  function initPreviewTable() {
    const resetAndFetch = () => {
      state.previewPage = 1;
      fetchPreviewData();
    };
    const filterTrail = $('preview-filter-trail');
    const filterStatus = $('preview-filter-status');
    if (filterTrail) filterTrail.addEventListener('change', resetAndFetch);
    if (filterStatus) filterStatus.addEventListener('change', resetAndFetch);

    const btnRefresh = $('btn-refresh-preview');
    if (btnRefresh) btnRefresh.addEventListener('click', () => fetchPreviewData(true));

    const btnPrev = $('btn-preview-prev');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.previewPage > 1) {
          state.previewPage--;
          fetchPreviewData();
        }
      });
    }

    const btnNext = $('btn-preview-next');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        state.previewPage++;
        fetchPreviewData();
      });
    }

    const btnShare = $('btn-share-survey');
    if (btnShare) btnShare.addEventListener('click', shareSurvey);
  }

  /** The trail filter starts with the big five; every other trail in the data is added after them. */
  function addTrailFilterOptions(rows) {
    const select = $('preview-filter-trail');
    if (!select) return;
    const listed = new Set(Array.from(select.options, o => o.value));
    Schema.TRAILS.filter(t => !listed.has(t) && rows.some(r => r.trail === t)).forEach(t => {
      select.add(new Option(`${Schema.trailName(t) || t} Only`, t));
    });
  }

  /** Filters and pages the prebuilt preview.json in the browser (fetched once per visit). */
  async function loadPreviewPage(trail, status, reload) {
    if (!state.previewRows || reload) {
      const res = await fetch(STATIC_PREVIEW_URL);
      if (!res.ok) throw new Error('preview.json returned ' + res.status);
      state.previewRows = (await res.json()).data || [];
      addTrailFilterOptions(state.previewRows);
    }
    const list = state.previewRows.filter(d =>
      (trail === 'ALL' || d.trail === trail) && (status === 'ALL' || d.completionStatus === status));
    const offset = (state.previewPage - 1) * state.previewLimit;
    return { rows: list.slice(offset, offset + state.previewLimit), total: list.length, note: '' };
  }

  async function fetchPreviewData(reload) {
    const tbody = $('preview-table-body');
    const pageInfo = $('preview-pagination-info');
    const btnPrev = $('btn-preview-prev');
    const btnNext = $('btn-preview-next');
    const trail = ($('preview-filter-trail') || {}).value || 'ALL';
    const status = ($('preview-filter-status') || {}).value || 'ALL';

    if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="py-6 text-center text-slate-500">Loading dataset...</td></tr>';

    try {
      const page = await loadPreviewPage(trail, status, reload === true);
      renderPreviewRows(page.rows);

      const start = (state.previewPage - 1) * state.previewLimit + 1;
      const end = start + page.rows.length - 1;
      if (pageInfo) {
        pageInfo.textContent = page.total > 0 ? `Showing rows ${start} - ${end} of ${page.total}${page.note}` : 'No matching records';
      }
      if (btnPrev) btnPrev.disabled = state.previewPage <= 1;
      if (btnNext) btnNext.disabled = state.previewPage * state.previewLimit >= page.total;
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="py-6 text-center text-rose-400">Failed loading preview data.</td></tr>';
    }
  }


  function renderPreviewRows(rows) {
    const tbody = $('preview-table-body');
    if (!tbody) return;

    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="py-6 text-center text-slate-400">No records found matching current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-800/40 transition';

      const injuryBadge = r.severeInjuryOccurred
        ? '<span class="text-rose-400 font-bold">Yes</span>'
        : '<span class="text-slate-500">None</span>';

      tr.innerHTML = `
        <td class="py-3 px-4 font-bold text-pine-400">${escapeHtml(r.trail)}</td>
        <td class="py-3 px-4">${escapeHtml(r.hikeYear)}</td>
        <td class="py-3 px-4">${escapeHtml(r.direction)}</td>
        <td class="py-3 px-4 font-semibold text-white">${escapeHtml(orDash(r.baseWeightLbs, ' lbs'))}</td>
        <td class="py-3 px-4">${escapeHtml(orDash(r.averageDailyMiles, ' mi/d'))}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(r.backpackType)}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(humanize(r.cookSystem))}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(humanize(r.sleepPadType))}</td>
        <td class="py-3 px-4">${statusBadge(r.completionStatus)}</td>
        <td class="py-3 px-4">${injuryBadge}</td>
        <td class="py-3 px-4 text-center text-amber-400 font-bold">${escapeHtml(orDash(r.overallEnjoymentRating, '/10'))}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- CODE SNIPPET TABS & COPY ---
  function initCodeSnippets() {
    // Point the example URLs at wherever the site is actually hosted (previews, local dev).
    document.querySelectorAll('.snippet-block code').forEach(code => {
      code.textContent = code.textContent.split('https://opentrailscience.org').join(window.location.origin);
      highlightCode(code);
    });

    const tabs = document.querySelectorAll('.snippet-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.classList.remove('active', 'bg-brand', 'text-white', 'font-semibold');
          t.classList.add('text-slate-400');
        });
        tab.classList.add('active', 'bg-brand', 'text-white', 'font-semibold');
        tab.classList.remove('text-slate-400');

        document.querySelectorAll('.snippet-block').forEach(b => b.classList.add('hidden'));
        const targetBlock = $(tab.getAttribute('data-target'));
        if (targetBlock) targetBlock.classList.remove('hidden');
      });
    });

    document.querySelectorAll('.copy-code-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.parentElement.querySelector('code').textContent;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
            showToast('Code copied to clipboard');
          });
        }
      });
    });
  }

  // Colors the Quickstart snippets: a tiny tokenizer instead of a highlighting
  // library, which the CSP would not allow. Colors are the --code-* variables.
  const CODE_KEYWORDS = {
    python: 'from import as def return if else elif not in and or for lambda with True False None',
    r: 'library function if else for in while return TRUE FALSE NULL NA Inf',
    javascript: 'import from const let async await function return if else new throw of true false null',
  };

  function highlightCode(code) {
    const lang = code.dataset.lang;
    if (!CODE_KEYWORDS[lang]) return;
    const name = lang === 'r' ? '[A-Za-z.][\\w.]*' : '[A-Za-z_$][\\w$]*';
    const tokens = new RegExp([
      `(${lang === 'javascript' ? '//' : '#'}[^\n]*)`,
      '("(?:\\\\.|[^"\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\n])*\'|`[^`]*`)',
      '\\b(\\d+(?:\\.\\d+)?)\\b',
      `\\b(${CODE_KEYWORDS[lang].split(' ').join('|')})\\b|(<-|\\|>|=>)`,
      `(${name})(?=\\()`,
    ].join('|'), 'g');
    const kinds = ['comment', 'string', 'number', 'keyword', 'keyword', 'function'];
    const text = code.textContent;
    let html = '';
    let last = 0;
    for (const match of text.matchAll(tokens)) {
      const kind = kinds[match.slice(1).findIndex(group => group !== undefined)];
      html += escapeHtml(text.slice(last, match.index)) + `<span class="tok-${kind}">${escapeHtml(match[0])}</span>`;
      last = match.index + match[0].length;
    }
    code.innerHTML = html + escapeHtml(text.slice(last));
  }

  // --- TOAST NOTIFICATIONS ---
  function showToast(msg) {
    const container = $('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'px-4 py-3 rounded-xl bg-slate-900 border border-pine-500/50 text-slate-100 text-xs shadow-2xl flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0';
    toast.innerHTML = '<svg class="w-4 h-4 text-pine-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span></span>';
    toast.querySelector('span').textContent = msg;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // --- UNITS: metric by default outside the US ---------------------------------
  function initDefaultUnits() {
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

  function initDontKnowToggles() {
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

  // --- DRAFT: answers survive a reload, saved only in this browser ---------------
  // Add a version (-v2, -v3, …) when a form change would make restored drafts wrong.
  const DRAFT_KEY = 'ots-survey-draft';
  const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  let draftTimer = null;

  function readDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!draft || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return null;
      return draft;
    } catch (err) {
      return null; // storage blocked (private mode) or corrupt: start fresh
    }
  }

  function clearDraft() {
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
        trailCheck: state.trailCheck.passed ? { id: state.trailCheck.round.id, choice: state.trailCheck.choice } : null,
        pills: Object.fromEntries(Object.entries(state.pillSelections).map(([field, set]) => [field, Array.from(set)])),
        rampWeeks: state.rampWeeks
      }));
    } catch (err) { /* storage full or blocked: the survey still works */ }
  }

  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 300);
  }

  function initDraftAutosave() {
    const form = $('survey-form');
    // Choice cards and toggles change hidden inputs, so clicks are watched too.
    ['input', 'change', 'click'].forEach(type => form.addEventListener(type, saveDraftSoon));
    window.addEventListener('pagehide', saveDraft);
  }

  /** Puts a saved draft back into the form by replaying the hiker's choices. */
  function restoreDraft() {
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
    if (draft.consent) $('consent-checkbox').checked = true;
    if (draft.consent && state.trailCheck.passed) giveConsent();
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
  function resetSurveyForm() {
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
    document.querySelectorAll('.choice-card.selected').forEach(c => setCardSelected(c, false));
    YES_NO_TOGGLES.forEach(t => {
      ['no', 'yes'].forEach(answer => {
        $(`btn-${t.name}-${answer}`).className = TOGGLE_OFF;
        $(`btn-${t.name}-${answer}`).setAttribute('aria-pressed', 'false');
      });
      $(t.details).classList.add('hidden');
    });
    ['quit-reason-container', 'own-shelter-container'].forEach(id => $(id).classList.add('hidden'));
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

  function initSurveyReset() {
    $('btn-start-over').addEventListener('click', () => {
      clearDraft();
      resetSurveyForm();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('Cleared. Starting fresh.');
    });
    $('btn-add-another-hike').addEventListener('click', () => {
      clearDraft();
      resetSurveyForm();
      window.location.hash = '#survey';
    });
  }

  // --- EXAMPLE SHARE CARD on the home page ---------------------------------------
  // --- INSIGHTS --------------------------------------------------------------------
  let insightsLoaded = false;

  async function loadInsights() {
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

  // --- DATASET PAGE: dictionary, changelog, citation -----------------------------
  const TYPE_LABELS = {
    string: 'string', datetime: 'datetime', enum: 'category', enumArray: 'list of categories',
    number: 'number', integer: 'integer', boolean: 'boolean', date: 'date'
  };
  const STEP_GROUPS = { 1: 'Trail & journey', 2: 'Hiker & preparation', 3: 'Gear', 4: 'On trail', 5: 'Outcomes' };

  function cell(row, text, className) {
    const td = document.createElement('td');
    td.className = 'py-2 px-3 align-top ' + (className || '');
    td.textContent = text;
    row.appendChild(td);
  }

  function describeValues(col) {
    if (col.values && col.values.length) return col.values.join(' | ');
    const parts = [];
    if (col.min !== undefined) parts.push(`${col.min} to ${col.max}`);
    if (col.unit) parts.push(col.unit);
    if (col.maxLength) parts.push(`max ${col.maxLength} characters`);
    if (col.type === 'date') parts.push('YYYY-MM-DD');
    return parts.join(' ') || '—';
  }

  function describeNotes(col) {
    const notes = [];
    if (col.metricOf) notes.push(`Metric copy of ${col.metricOf}.`);
    else if (col.derived && !col.description) notes.push('Derived, not asked.');
    else if (col.conditional) notes.push('Required when it applies, otherwise null.');
    else if (col.required) notes.push('Required.');
    else notes.push('Optional.');
    if (col.allowUnknown) notes.push('Can be "Don\'t know".');
    if (col.description && !col.metricOf) notes.push(col.description);
    return notes.join(' ');
  }

  function initDatasetDocs() {
    const doc = Schema.describeSchema();
    const body = $('dictionary-body');
    if (body) {
      let group = null;
      doc.columns.forEach(col => {
        const colGroup = col.step ? STEP_GROUPS[col.step] : (group || 'Record');
        if (colGroup !== group) {
          group = colGroup;
          const head = document.createElement('tr');
          const th = document.createElement('th');
          th.colSpan = 5;
          th.className = 'py-2 px-3 text-left bg-slate-950/60 text-slate-400 font-sans font-semibold text-xs uppercase tracking-wider';
          th.textContent = group;
          head.appendChild(th);
          body.appendChild(head);
        }
        const row = document.createElement('tr');
        cell(row, col.name, 'text-pine-400 whitespace-nowrap');
        cell(row, TYPE_LABELS[col.type] || col.type, 'whitespace-nowrap');
        cell(row, describeValues(col), 'wrap-break-word max-w-xs');
        cell(row, col.role || '—', 'text-slate-400');
        cell(row, describeNotes(col), 'font-sans text-slate-400 min-w-56');
        body.appendChild(row);
      });
    }

    const log = $('schema-changelog');
    if (log) {
      doc.changelog.forEach(entry => {
        const li = document.createElement('li');
        const title = document.createElement('div');
        title.className = 'font-mono text-slate-300';
        title.textContent = `v${entry.version} · ${entry.date}`;
        const list = document.createElement('ul');
        list.className = 'list-disc list-inside mt-1 space-y-0.5';
        entry.changes.forEach(change => {
          const item = document.createElement('li');
          item.textContent = change;
          list.appendChild(item);
        });
        li.append(title, list);
        log.appendChild(li);
      });
    }

    // APA style for a dataset that keeps changing: version and retrieval date. Always
    // the real address, also on previews and local dev.
    const now = new Date();
    const today = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    $('citation-text').textContent =
      `Open Trail Science. (${now.getFullYear()}). ${doc.name} (Schema version ${doc.version}) [Data set]. ` +
      `Retrieved ${today}, from https://opentrailscience.org/#download`;
    $('btn-copy-citation').addEventListener('click', () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText($('citation-text').textContent).then(() => showToast('Citation copied'));
    });
  }

  function renderDatasetMeta() {
    const meta = $('dataset-meta');
    if (!meta) return;
    const count = state.publicCount;
    meta.textContent = [
      count === null ? null : `${count} public ${count === 1 ? 'record' : 'records'}`,
      `schema v${Schema.SCHEMA_VERSION}`,
      'CC0 1.0 public domain',
      state.stats && state.stats.lastUpdated ? `updated ${state.stats.lastUpdated.slice(0, 10)}` : null
    ].filter(Boolean).join(' • ');
  }

  // --- CONSENT (before the survey starts) -----------------------------------------
  function giveConsent() {
    state.consentGiven = true;
    $('consent-checkbox').checked = true;
    $('consent-gate').classList.add('hidden');
    $('survey-body').classList.remove('hidden');
    $('survey-progress').classList.remove('hidden');
  }

  /** Back to the consent step: a fresh survey (start over, another hike) asks again. */
  function resetConsent() {
    state.consentGiven = false;
    $('consent-checkbox').checked = false;
    $('btn-start-survey').disabled = true;
    $('consent-gate').classList.remove('hidden');
    $('survey-body').classList.add('hidden');
    $('survey-progress').classList.add('hidden');
  }

  /** Back to the start page for the trail check; the answers and the current step stay. */
  function showGateAgain() {
    $('consent-gate').classList.remove('hidden');
    $('survey-body').classList.add('hidden');
    $('survey-progress').classList.add('hidden');
    updateStartButton();
    $('trail-check').scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Please answer the quick trail check first.');
  }

  /** The survey starts once the consent box is ticked and the trail check is answered. */
  function updateStartButton() {
    $('btn-start-survey').disabled = !($('consent-checkbox').checked && state.trailCheck.passed);
  }

  function initConsent() {
    const box = $('consent-checkbox');
    const start = $('btn-start-survey');
    box.addEventListener('change', updateStartButton);
    start.addEventListener('click', () => {
      if (!box.checked || !state.trailCheck.passed) return;
      giveConsent();
      state.surveyStartedAt = state.surveyStartedAt || Date.now();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // --- DELETION CODE ------------------------------------------------------------------
  function populateDeletionCode(code) {
    const panel = $('deletion-code-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !code);
    if (code) $('deletion-code-value').textContent = code;
  }

  function initPrivacyPage() {
    const popular = Schema.TRAILS.filter(t => Schema.datePrecision(t) === 'week');
    const small = Schema.TRAILS.filter(t => Schema.datePrecision(t) === 'month');
    // The three "Other" choices have no name of their own: list them once, at the end.
    const names = list => [...new Set(list.map(t => Schema.trailName(t) || 'any other trail'))].join(' · ');
    $('privacy-popular-trails').textContent = names(popular);
    $('privacy-small-trails').textContent = names(small);
    $('privacy-consent-version').textContent = Schema.CONSENT_VERSION;

    $('btn-copy-deletion-code').addEventListener('click', () => {
      const code = $('deletion-code-value').textContent;
      if (navigator.clipboard && code) navigator.clipboard.writeText(code).then(() => showToast('Code copied'));
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
          if (state.stats) renderStats(state.stats, 'Open Dataset');
          insightsLoaded = false;
        } else {
          result.className = 'mt-3 text-sm text-rose-300';
          result.textContent = body.error || `Deletion failed (HTTP ${res.status}).`;
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

  // --- LIGHT / DARK THEME (theme.js sets the initial one before the page is drawn) ---
  const THEME_KEY = 'ots-theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    $('theme-toggle').setAttribute('aria-label', label);
    $('theme-toggle').title = label;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f4f6' : '#121417');
  }

  function initTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    $('theme-toggle').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* not saved, still switched */ }
    });
    // Follow the system setting until the hiker picks a theme themselves.
    const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
    if (media && media.addEventListener) {
      media.addEventListener('change', e => {
        let saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* storage blocked */ }
        if (!saved) applyTheme(e.matches ? 'light' : 'dark');
      });
    }
  }

  // --- YOUR HIKE, COMPARED TODAY (deletion code -> /api/my-hike) ------------------
  // The thank-you page shows either a fresh submission or a looked-up hike.
  const SUCCESS_TEXT = {
    submitted: {
      badge: 'Hike Recorded',
      title: 'Thank You for Advancing Trail Science!',
      intro: 'Your hike is now part of the open dataset, thank you! Every single answer makes the picture of what really happens on long trails a little clearer, for future hikers and for anyone researching it.'
    },
    revisit: {
      badge: 'Your hike',
      title: 'How your hike compares today',
      intro: 'Compared with everyone who has shared a hike so far. Come back with your personal code as more hikers join, and share your updated card if you like.'
    }
  };

  function setSuccessMode(mode) {
    const text = SUCCESS_TEXT[mode];
    $('success-badge').textContent = text.badge;
    $('success-title').textContent = text.title;
    $('success-intro').textContent = text.intro;
    if (mode === 'revisit') {
      populateDeletionCode(null); // they have the code already
      resetFeedback();
    }
  }

  function initMyHike() {
    const input = $('my-hike-code');
    const button = $('btn-my-hike');
    const result = $('my-hike-result');
    const lookUp = async () => {
      const code = input.value.trim();
      if (!code) {
        result.className = 'mt-3 text-sm text-amber-300';
        result.textContent = 'Please enter your code.';
        return;
      }
      button.disabled = true;
      result.className = 'mt-3 text-sm text-slate-400';
      result.textContent = 'Looking up your hike…';
      try {
        const res = await fetch('/api/my-hike', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(body.error || `Lookup failed (HTTP ${res.status}).`);
        populateSuccessCard(body.data);
        populateComparison(body.comparison);
        prepareShare(body.data, body.comparison);
        setSuccessMode('revisit');
        state.hasSubmitted = true;
        result.textContent = '';
        window.location.hash = '#success';
      } catch (err) {
        result.className = 'mt-3 text-sm text-rose-300';
        result.textContent = err.message === 'Failed to fetch' ? 'Network error. Please try again.' : err.message;
      } finally {
        button.disabled = false;
      }
    };
    button.addEventListener('click', lookUp);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') lookUp(); });
  }

  // --- FEEDBACK (thank-you page; stored apart from the answers, never published) ------
  function resetFeedback() {
    $('feedback-message').value = '';
    $('feedback-message').disabled = false;
    $('btn-send-feedback').disabled = false;
    $('feedback-result').className = 'text-xs text-slate-400';
    $('feedback-result').textContent = '';
  }

  function initFeedback() {
    const box = $('feedback-message');
    const button = $('btn-send-feedback');
    const result = $('feedback-result');
    button.addEventListener('click', async () => {
      const message = box.value.trim();
      if (!message) {
        result.className = 'text-xs text-amber-300';
        result.textContent = 'Please write something first.';
        return;
      }
      button.disabled = true;
      result.className = 'text-xs text-slate-400';
      result.textContent = 'Sending…';
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(body.error || `Sending failed (HTTP ${res.status}).`);
        box.disabled = true;
        result.className = 'text-xs text-pine-300 font-semibold';
        result.textContent = 'Thank you! I read every single message.';
      } catch (err) {
        button.disabled = false;
        result.className = 'text-xs text-rose-300';
        result.textContent = err.message === 'Failed to fetch' ? 'Network error. Please try again.' : err.message;
      }
    });
  }

  // --- TRAIL CHECK (human check, see lib/human-check.js) ----------------------------
  const TRAIL_CHECK_BASE = 'trail-check-option px-3 py-3 rounded-xl text-sm font-semibold text-white border transition text-left';
  const TRAIL_CHECK_IDLE = `${TRAIL_CHECK_BASE} border-slate-700 bg-slate-900/60 hover:border-pine-500`;
  const TRAIL_CHECK_RIGHT = `${TRAIL_CHECK_BASE} border-pine-500 bg-pine-950/60`;
  const TRAIL_CHECK_WRONG = `${TRAIL_CHECK_BASE} border-rose-600 bg-rose-950/40`;
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
  function newTrailCheck(id, passed) {
    const rounds = HumanCheck.TRAIL_CHECKS;
    const round = rounds.find(r => r.id === id) || rounds[Math.floor(Math.random() * rounds.length)];
    state.trailCheck = { round, choice: null, passed: false };

    const container = $('trail-check-options');
    const feedback = $('trail-check-feedback');
    container.replaceChildren();
    feedback.className = 'text-xs text-slate-400';
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
        feedback.className = 'text-xs text-pine-300 font-semibold';
        feedback.textContent = "Correct, that one stays home. You're clearly a hiker. ✓";
      };
      btn.addEventListener('click', () => {
        if (state.trailCheck.passed) return;
        if (item === round.odd) {
          pass();
          updateStartButton();
          saveDraftSoon();
        } else {
          btn.className = TRAIL_CHECK_WRONG;
          feedback.className = 'text-xs text-rose-300';
          feedback.textContent = WRONG_REPLIES[wrongCount++ % WRONG_REPLIES.length];
        }
      });
      container.appendChild(btn);
      if (passed && item === round.odd) pass();
    });
  }

  function initTrailCheck() {
    if ($('trail-check-options')) newTrailCheck();
  }

})();
