/**
 * Dataset page: the preview table, code snippets, data dictionary, changelog and citation.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, STATIC_PREVIEW_URL, Schema, copyText, escapeHtml, humanize, orDash, state } from './core.js';
import { shareSurvey, statusBadge } from './results.js';

// --- PUBLIC DOWNLOAD VIEW / DATA PREVIEW TABLE ---
export function initPreviewTable() {
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

export async function fetchPreviewData(reload) {
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


/** A stored (imperial) number in the preview table, in the unit system the hiker picked. */
function previewUnit(value, unit, imperialSuffix, metricSuffix) {
  if (typeof value !== 'number' || state.unitSystem !== 'metric') return orDash(value, imperialSuffix);
  return `${(value * Schema.UNITS[unit].factor).toFixed(1)}${metricSuffix}`;
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
        <td class="py-3 px-4"><span class="trail-chip" data-trail="${escapeHtml(r.trail)}">${escapeHtml(r.trail)}</span></td>
        <td class="py-3 px-4">${escapeHtml(r.hikeYear)}</td>
        <td class="py-3 px-4">${escapeHtml(r.direction)}</td>
        <td class="py-3 px-4 font-semibold text-white">${escapeHtml(previewUnit(r.baseWeightLbs, 'lb', ' lbs', ' kg'))}</td>
        <td class="py-3 px-4">${escapeHtml(previewUnit(r.averageDailyMiles, 'mi/day', ' mi/d', ' km/d'))}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(r.backpackType)}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(r.cookSystem === 'huts_restaurants' ? 'huts / restaurants' : humanize(r.cookSystem))}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(humanize(r.sleepPadType))}</td>
        <td class="py-3 px-4">${statusBadge(r.completionStatus)}</td>
        <td class="py-3 px-4">${injuryBadge}</td>
        <td class="py-3 px-4 text-center text-amber-400 font-bold">${escapeHtml(orDash(r.overallEnjoymentRating, '/10'))}</td>
      `;
    tbody.appendChild(tr);
  });
}

// --- CODE SNIPPET TABS & COPY ---
export function initCodeSnippets() {
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
      copyText(code, 'Code copied to clipboard').then(copied => {
        if (!copied) return;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
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

// --- DATASET PAGE: dictionary, changelog, citation -----------------------------
const TYPE_LABELS = {
  string: 'string', datetime: 'datetime', enum: 'category', enumArray: 'list of categories',
  number: 'number', integer: 'integer', boolean: 'boolean', date: 'date'
};
export const STEP_GROUPS = { 1: 'Trail & journey', 2: 'Hiker & preparation', 3: 'Gear', 4: 'On trail', 5: 'Outcomes' };

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

export function initDatasetDocs() {
  const doc = Schema.describeSchema();
  const body = $('dictionary-body');
  if ($('dictionary-count')) $('dictionary-count').textContent = String(doc.columns.length);
  if (body) {
    let group = null;
    doc.columns.forEach(col => {
      const colGroup = col.step ? STEP_GROUPS[col.step] : (group || 'Record');
      if (colGroup !== group) {
        group = colGroup;
        const head = document.createElement('tr');
        const th = document.createElement('th');
        th.colSpan = 5;
        th.className = 'py-2 px-3 text-left bg-slate-950/60 text-slate-400 font-sans font-semibold text-xs';
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
      title.className = 'text-slate-300';
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
    copyText($('citation-text').textContent, 'Citation copied');
  });
}

export function renderDatasetMeta() {
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
