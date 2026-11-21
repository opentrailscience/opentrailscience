/**
 * Thank-you page: the summary, every answer, the comparisons, the share card, the personal code and feedback.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, Schema, Stats, VIEW_PATHS, attrValue, copyText, errorText, escapeHtml, go, humanize, orDash, showToast, state } from './core.js';
import { STEP_GROUPS } from './dataset.js';
import { populateDeletionCode } from './privacy.js';

// How a hike ended looks the same everywhere: thank-you page, data preview and the
// tags on the survey cards (index.html), in the colors the charts use for outcomes.
const STATUS_BADGE_BASE = 'inline-block px-2 py-0.5 rounded-sm font-sans text-xs font-semibold whitespace-nowrap ';
const STATUS_BADGE_COLORS = {
  continuous_purist: 'bg-green-tint text-green-strong',
  flip_flop: 'bg-yellow-tint text-yellow-strong',
  skipped_sections: 'bg-blue-tint text-blue-strong',
  section_hike: 'bg-subtle text-secondary',
  quit_early: 'bg-orange-tint text-orange-strong'
};
const STATUS_LABELS = Schema.COMPLETION_LABELS;

function statusBadgeClass(status) {
  return STATUS_BADGE_BASE + (STATUS_BADGE_COLORS[status] || STATUS_BADGE_COLORS.section_hike);
}

export function statusBadge(status) {
  return `<span class="${statusBadgeClass(status)}">${escapeHtml(STATUS_LABELS[status] || status || '')}</span>`;
}

export function populateSuccessCard(data) {
  const set = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };
  set('summary-trail-badge', data.trail);
  set('summary-hike-year', `${data.hikeYear} hike`);
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
/** A stored answer in the words of the survey (the form's own labels where it has them). */
export function answerText(name, value) {
  if (name === 'trail') return Schema.trailName(value) || value;
  if (name === 'ageBand') return value === '20-and-under' ? '20 and under' : String(value).replace('-', '–');
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
      th.className = 'pt-3 pb-1 text-[11px] text-muted';
      th.textContent = group;
      head.appendChild(th);
      body.appendChild(head);
    }
    const [text, other] = formatAnswer(col, data[col.name], data);
    const row = document.createElement('tr');
    row.className = 'border-t border-subtle/60 align-top';
    const label = document.createElement('td');
    label.className = 'py-1.5 pr-3 text-muted';
    label.textContent = col.label;
    const answer = document.createElement('td');
    answer.className = 'py-1.5 text-ink-soft';
    answer.textContent = text;
    if (other) {
      const muted = document.createElement('span');
      muted.className = 'text-muted';
      muted.textContent = ` (${other})`;
      answer.appendChild(muted);
    }
    row.append(label, answer);
    body.appendChild(row);
  });
}

/** "Your base weight was lighter than 70% of PCT hikers." with the percentage highlighted. */
export function populateComparison(comparison) {
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
    icon.className = 'text-blue font-bold';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '•'; // neutral: the lines can be flattering or not
    const text = document.createElement('span');
    const marker = `${item.percent}%`;
    const [before, after] = item.text.split(marker);
    const strong = document.createElement('strong');
    strong.className = 'text-blue-strong';
    strong.textContent = marker;
    text.append(before, strong, after || '');
    li.append(icon, text);
    list.appendChild(li);
  });

  $('summary-comparison-note').textContent =
    `Compared with ${comparison.peerCount} ${comparison.peerNoun} who shared their data.`;
  box.classList.remove('hidden');
}

/** "How you compare on every answer": one row per answer, against the same trail and against everyone. */
export function renderCompareTable(record, table) {
  const box = $('compare-all');
  const body = $('compare-all-body');
  if (!box || !body) return;
  box.open = false;
  body.replaceChildren();
  if (!table) {
    box.classList.add('hidden');
    return;
  }
  $('compare-all-trail-head').textContent = table.trailName ? `${table.trailName} hikers (${table.trailCount})` : 'Same trail';
  $('compare-all-all-head').textContent = `All hikers (${table.allCount})`;
  $('compare-all-note').textContent = table.trailName
    ? 'Same trail needs at least 3 other hikers, all hikers at least 10. Money is compared in dollars, with euros converted at a fixed rate.'
    : 'Hikes on the "Other" trails are compared with all hikers only, which needs at least 10. Money is compared in dollars, with euros converted at a fixed rate.';
  const unknown = record.unknownAnswers || [];
  table.rows.forEach(r => {
    const def = Stats.TABLE_ROWS.find(row => row.key === r.key);
    if (!def) return;
    const cells = [
      def.label,
      Stats.tableValueText(def, record, state.unitSystem) || (unknown.includes(def.key) ? "Don't know" : '–'),
      table.trailName ? Stats.tableCellText(def, r.trail, record) : '–',
      Stats.tableCellText(def, r.all, record)
    ];
    const tr = document.createElement('tr');
    tr.className = 'border-t border-subtle/60 align-top';
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.className = `py-1.5 ${i < 3 ? 'pr-3 ' : ''}${i === 0 ? 'text-muted' : 'text-ink-soft'}`;
      td.textContent = text;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  box.classList.remove('hidden');
}

/** Builds the share card image for this submission. */
export async function prepareShare(record, comparison) {
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

/**
 * Shares just the link (and on phones the card image): no ready-made text,
 * so hikers say it in their own words instead of sending something that reads like a bot.
 */
export async function shareSurvey() {
  const url = window.location.origin + VIEW_PATHS.survey;

  // Phones: share the card image with the link (apps often drop `url` when
  // files are attached, so it goes into `text`).
  const card = state.shareCard;
  const file = card && typeof File === 'function' ? new File([card.blob], card.filename, { type: 'image/png' }) : null;
  const attempts = [];
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    attempts.push({ text: url, files: [file] });
  }
  if (navigator.share) attempts.push({ url });

  for (const data of attempts) {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // the hiker closed the share sheet
    }
  }
  if (!(await copyText(url, 'Link copied.', true))) showToast('Link: ' + url);
}

// --- YOUR HIKE, COMPARED TODAY (deletion code -> /api/my-hike) ------------------
// The thank-you page shows either a fresh submission or a looked-up hike.
const SUCCESS_TEXT = {
  submitted: {
    badge: 'Hike saved',
    title: 'Thanks for sharing your hike',
    intro: 'Your hike is now part of the open dataset. Every answer makes the picture of long-distance hiking a little clearer, for future hikers and for anyone researching it.'
  },
  revisit: {
    badge: 'Your hike',
    title: 'How your hike compares today',
    intro: 'Compared with everyone who has shared a hike so far. Come back with your personal code as more hikers join, and share your updated card if you like.'
  }
};

export function setSuccessMode(mode) {
  const text = SUCCESS_TEXT[mode];
  $('success-badge').textContent = text.badge;
  $('success-title').textContent = text.title;
  $('success-intro').textContent = text.intro;
  // Right after submitting the share card says it all; a looked-up hike shows the full summary.
  $('success-summary-card').classList.toggle('hidden', mode === 'submitted');
  if (mode === 'revisit') {
    populateDeletionCode(null); // they have the code already
    resetFeedback();
  }
}

export function initMyHike() {
  const input = $('my-hike-code');
  const button = $('btn-my-hike');
  const result = $('my-hike-result');
  const lookUp = async () => {
    const code = input.value.trim();
    if (!code) {
      result.className = 'mt-3 text-sm text-yellow-strong';
      result.textContent = 'Please enter your code.';
      return;
    }
    button.disabled = true;
    result.className = 'mt-3 text-sm text-muted';
    result.textContent = 'Looking up your hike…';
    try {
      const res = await fetch('/api/my-hike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(errorText(res, body.error, `Lookup failed (HTTP ${res.status}).`));
      populateSuccessCard(body.data);
      populateComparison(body.comparison);
      renderCompareTable(body.data, body.table);
      prepareShare(body.data, body.comparison);
      setSuccessMode('revisit');
      state.hasSubmitted = true;
      result.textContent = '';
      go(VIEW_PATHS.success);
    } catch (err) {
      result.className = 'mt-3 text-sm text-red-strong';
      result.textContent = err.message === 'Failed to fetch' ? 'Network error. Please try again.' : err.message;
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener('click', lookUp);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') lookUp(); });
}

// --- FEEDBACK (thank-you page; stored apart from the answers, never published) ------
export function resetFeedback() {
  $('feedback-message').value = '';
  $('feedback-message').disabled = false;
  $('btn-send-feedback').disabled = false;
  $('feedback-result').className = 'text-xs text-muted';
  $('feedback-result').textContent = '';
}

export function initFeedback() {
  const box = $('feedback-message');
  const button = $('btn-send-feedback');
  const result = $('feedback-result');
  button.addEventListener('click', async () => {
    const message = box.value.trim();
    if (!message) {
      result.className = 'text-xs text-yellow-strong';
      result.textContent = 'Please write something first.';
      return;
    }
    button.disabled = true;
    result.className = 'text-xs text-muted';
    result.textContent = 'Sending…';
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(errorText(res, body.error, `Sending failed (HTTP ${res.status}).`));
      box.disabled = true;
      result.className = 'text-xs text-blue-strong font-semibold';
      result.textContent = 'Thank you! I read every single message.';
    } catch (err) {
      button.disabled = false;
      result.className = 'text-xs text-red-strong';
      result.textContent = err.message === 'Failed to fetch' ? 'Network error. Please try again.' : err.message;
    }
  });
}
