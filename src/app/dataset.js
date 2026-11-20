/**
 * Dataset page: the preview table, data dictionary and changelog.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $, STATIC_PREVIEW_URL, Schema, escapeHtml, humanize, orDash, state } from './core.js';
import { shareSurvey, statusBadge } from './results.js';

// --- PUBLIC DOWNLOAD VIEW / DATA PREVIEW TABLE ---
export function initPreviewTable() {
  const resetAndFetch = () => {
    state.previewPage = 1;
    fetchPreviewData();
  };
  const filterTrail = $('preview-filter-trail');
  if (filterTrail) filterTrail.addEventListener('change', resetAndFetch);

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
async function loadPreviewPage(trail) {
  if (!state.previewRows) {
    const res = await fetch(STATIC_PREVIEW_URL);
    if (!res.ok) throw new Error('preview.json returned ' + res.status);
    state.previewRows = (await res.json()).data || [];
    addTrailFilterOptions(state.previewRows);
  }
  const list = state.previewRows.filter(d => trail === 'ALL' || d.trail === trail);
  const offset = (state.previewPage - 1) * state.previewLimit;
  return { rows: list.slice(offset, offset + state.previewLimit), total: list.length, note: '' };
}

export async function fetchPreviewData() {
  const tbody = $('preview-table-body');
  const pageInfo = $('preview-pagination-info');
  const btnPrev = $('btn-preview-prev');
  const btnNext = $('btn-preview-next');
  const trail = ($('preview-filter-trail') || {}).value || 'ALL';

  if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="py-6 text-center text-muted">Loading dataset...</td></tr>';

  try {
    const page = await loadPreviewPage(trail);
    renderPreviewRows(page.rows);

    const start = (state.previewPage - 1) * state.previewLimit + 1;
    const end = start + page.rows.length - 1;
    if (pageInfo) {
      pageInfo.textContent = page.total > 0 ? `Showing rows ${start} - ${end} of ${page.total}${page.note}` : 'No matching records';
    }
    if (btnPrev) btnPrev.disabled = state.previewPage <= 1;
    if (btnNext) btnNext.disabled = state.previewPage * state.previewLimit >= page.total;
  } catch (e) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="py-6 text-center text-red">Failed loading preview data.</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="11" class="py-6 text-center text-muted">No records found matching current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-subtle/40 transition';

    const injuryBadge = r.severeInjuryOccurred
      ? '<span class="text-red font-bold">Yes</span>'
      : '<span class="text-muted">None</span>';

    tr.innerHTML = `
        <td class="py-3 px-4"><span class="trail-chip" data-trail="${escapeHtml(r.trail)}">${escapeHtml(r.trail)}</span></td>
        <td class="py-3 px-4">${escapeHtml(r.hikeYear)}</td>
        <td class="py-3 px-4">${escapeHtml(r.direction)}</td>
        <td class="py-3 px-4 font-semibold text-ink">${escapeHtml(previewUnit(r.baseWeightLbs, 'lb', ' lbs', ' kg'))}</td>
        <td class="py-3 px-4">${escapeHtml(previewUnit(r.averageDailyMiles, 'mi/day', ' mi/d', ' km/d'))}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(r.backpackType)}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(r.cookSystem === 'huts_restaurants' ? 'huts / restaurants' : humanize(r.cookSystem))}</td>
        <td class="py-3 px-4 capitalize">${escapeHtml(humanize(r.sleepPadType))}</td>
        <td class="py-3 px-4">${statusBadge(r.completionStatus)}</td>
        <td class="py-3 px-4">${injuryBadge}</td>
        <td class="py-3 px-4 text-center text-yellow font-bold">${escapeHtml(orDash(r.overallEnjoymentRating, '/10'))}</td>
      `;
    tbody.appendChild(tr);
  });
}

// --- DATASET PAGE: dictionary and changelog ------------------------------------
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
        th.colSpan = 4;
        th.className = 'py-2 px-3 text-left bg-sunken/60 text-muted font-sans font-semibold text-xs';
        th.textContent = group;
        head.appendChild(th);
        body.appendChild(head);
      }
      const row = document.createElement('tr');
      cell(row, col.name, 'text-blue whitespace-nowrap');
      cell(row, TYPE_LABELS[col.type] || col.type, 'whitespace-nowrap');
      cell(row, describeValues(col), 'wrap-break-word max-w-xs');
      cell(row, describeNotes(col), 'font-sans text-muted min-w-56');
      body.appendChild(row);
    });
  }

  const log = $('schema-changelog');
  if (log) {
    doc.changelog.forEach(entry => {
      const li = document.createElement('li');
      const title = document.createElement('div');
      title.className = 'text-secondary';
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
