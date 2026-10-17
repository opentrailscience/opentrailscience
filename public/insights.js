/**
 * Insights page: a few single-series bar charts over the public dataset.
 * The numbers are computed at build time (netlify/functions/utils/insights.js)
 * and loaded from /data/insights.json.
 *
 *   Insights.render(container, insights)
 *
 * Chart conventions: bars colored by category (see the color notes below),
 * bars at most 18px thick with a 4px rounded end, a hairline
 * baseline, the value at each bar's tip, a hover/focus tooltip per row and a
 * table view under every chart.
 */
(function () {
  'use strict';

  // Bar colors are CSS variables (public/styles.css, one set per theme), so
  // switching light/dark recolors the charts. Each chart's colors were checked
  // for color-blind separation and contrast against the card in both themes.
  const TRAILS_WITH_COLOR = ['PCT', 'AT', 'CDT', 'CT', 'AZT', 'TMB', 'TA']; // as on the home page
  const INJURY_GROUPS = {
    feet: { label: 'Feet & ankles', keys: ['plantar_fasciitis_foot', 'ankle_sprain', 'achilles_tendon', 'extensor_tendonitis', 'foot_numbness_nerve', 'blisters_severe'] },
    legs: { label: 'Legs & hips', keys: ['knee_it_band', 'shin_splints', 'stress_fracture', 'hip_flexor'] },
    back: { label: 'Back', keys: ['back_spine'] },
    falls: { label: 'Falls', keys: ['fall_trauma'] },
    other: { label: 'Other', keys: ['other'] }
  };
  const injuryGroup = key => Object.keys(INJURY_GROUPS).find(g => INJURY_GROUPS[g].keys.includes(key)) || 'other';

  // Titles and units per chart; the rows come from insights.json.
  const CHARTS = [
    {
      id: 'baseWeightByOutcome',
      title: 'Median base weight by outcome',
      subtitle: 'Pack base weight of hikers who finished, flip-flopped, section-hiked or went home early.',
      unit: ' lb',
      nLabel: 'hikers',
      color: row => `var(--chart-outcome-${row.key})` // the outcome colors of the survey cards
    },
    {
      id: 'finishRateByTrail',
      title: 'Finish rate by trail',
      subtitle: 'Share of thru-hike attempts that reached the end (continuous or flip-flop). Section hikes are left out.',
      unit: '%',
      max: 100,
      nLabel: 'attempts',
      color: row => `var(--chart-trail-${TRAILS_WITH_COLOR.includes(row.key) ? row.key.toLowerCase() : 'other'})`
    },
    {
      id: 'commonInjuries',
      title: 'Most common trail-altering injuries',
      subtitle: 'Share of injured hikers reporting each injury. One hiker can report several.',
      unit: '%',
      max: 100,
      nLabel: 'injured hikers',
      color: row => `var(--chart-injury-${injuryGroup(row.key)})`,
      legend: rows => [...new Set(rows.map(r => injuryGroup(r.key)))].map(g => ({ label: INJURY_GROUPS[g].label, color: `var(--chart-injury-${g})` }))
    },
    {
      id: 'injuryRateByFirstWeek',
      title: 'Injury rate by first-week mileage',
      subtitle: 'Share of hikers with a trail-altering injury, by average miles per day in their first week.',
      unit: '%',
      max: 100,
      nLabel: 'hikers',
      color: row => `var(--chart-ramp-${row.key})` // ordered bins: one green, light to dark
    }
  ];

  // --- Rendering ----------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function describeRow(chart, row) {
    const n = row.of ? `${row.n} of ${row.of} ${chart.nLabel}` : `${row.n} ${chart.nLabel}`;
    return { value: `${row.value}${chart.unit}`, n };
  }

  function showTooltip(tooltip, card, anchor, chart, row) {
    const text = describeRow(chart, row);
    tooltip.replaceChildren(
      el('div', 'text-sm font-bold text-white', text.value),
      el('div', 'text-xs text-slate-400', `${row.label} · ${text.n}`)
    );
    tooltip.classList.remove('hidden');
    const cardBox = card.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    tooltip.style.left = `${Math.min(box.left - cardBox.left + 8, cardBox.width - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${box.top - cardBox.top - tooltip.offsetHeight - 6}px`;
  }

  function renderBars(card, chart, rows) {
    const max = chart.max || Math.max(...rows.map(r => r.value)) * 1.15;
    const tooltip = el('div', 'hidden absolute z-10 pointer-events-none px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 shadow-xl');
    const list = el('div', 'mt-5 space-y-1.5');
    list.setAttribute('role', 'list');

    rows.forEach(row => {
      const text = describeRow(chart, row);
      const item = el('div', 'grid grid-cols-1 sm:grid-cols-[10rem_1fr] sm:items-center gap-x-3 gap-y-1 py-1 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-pine-500 cursor-default');
      item.setAttribute('role', 'listitem');
      item.tabIndex = 0;
      item.setAttribute('aria-label', `${row.label}: ${text.value}, ${text.n}`);

      const label = el('div', 'text-xs text-slate-300 sm:text-right truncate', row.label);
      label.title = row.label;

      // Bar area: hairline baseline on the left, value at the bar's tip.
      const track = el('div', 'flex items-center gap-2 border-l border-slate-700 min-h-[24px]');
      const bar = el('div', 'h-[18px] rounded-r transition');
      bar.style.width = `${Math.max(0.5, (row.value / max) * 85)}%`;
      bar.style.backgroundColor = chart.color(row);
      const value = el('span', 'text-xs font-semibold text-slate-200 whitespace-nowrap', text.value);
      track.append(bar, value);
      item.append(label, track);

      const enter = () => { bar.style.filter = 'brightness(1.15)'; showTooltip(tooltip, card, track, chart, row); };
      const leave = () => { bar.style.filter = ''; tooltip.classList.add('hidden'); };
      item.addEventListener('pointerenter', enter);
      item.addEventListener('pointerleave', leave);
      item.addEventListener('focus', enter);
      item.addEventListener('blur', leave);
      list.appendChild(item);
    });

    card.append(list, tooltip);
    if (chart.legend) card.appendChild(renderLegend(chart.legend(rows)));
    card.appendChild(renderTable(chart, rows));
  }

  /** Color key for charts whose colors mean something beyond the bar labels. */
  function renderLegend(entries) {
    const legend = el('div', 'mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-400');
    entries.forEach(entry => {
      const item = el('span', 'inline-flex items-center gap-1.5');
      const swatch = el('span', 'inline-block w-2.5 h-2.5 rounded-sm');
      swatch.style.backgroundColor = entry.color;
      item.append(swatch, document.createTextNode(entry.label));
      legend.appendChild(item);
    });
    return legend;
  }

  function renderTable(chart, rows) {
    // mt-auto: 'Show table' sits at the bottom of every card, at the same height in a row.
    const details = el('details', 'mt-auto pt-4 text-xs');
    details.appendChild(el('summary', 'cursor-pointer text-slate-400 hover:text-slate-200', 'Show table'));
    const table = el('table', 'mt-2 w-full text-left');
    const head = el('tr', 'text-slate-400 border-b border-slate-800');
    ['Group', 'Value', 'Hikers'].forEach(h => head.appendChild(el('th', 'py-1.5 pr-3 font-medium', h)));
    table.appendChild(head);
    rows.forEach(row => {
      const text = describeRow(chart, row);
      const tr = el('tr', 'border-b border-slate-800/60 text-slate-300');
      tr.append(el('td', 'py-1.5 pr-3', row.label), el('td', 'py-1.5 pr-3 tabular-nums', text.value), el('td', 'py-1.5 tabular-nums', text.n));
      table.appendChild(tr);
    });
    details.appendChild(table);
    return details;
  }

  /** Draws every chart from insights.json ({ total, charts: { id: rows } }). */
  function render(container, insights) {
    container.replaceChildren();
    CHARTS.forEach(chart => {
      const card = el('div', 'card-glow rounded-2xl p-6 relative flex flex-col');
      card.append(el('h3', 'font-bold text-white', chart.title), el('p', 'text-xs text-slate-400 mt-1', chart.subtitle));
      const rows = insights.charts[chart.id] || [];
      if (rows.length < 2) {
        card.appendChild(el('p', 'mt-6 text-sm text-slate-500', 'Not enough answers for this chart yet.'));
      } else {
        renderBars(card, chart, rows);
      }
      container.appendChild(card);
    });
  }

  // Accent per card (rank 1-3): the validated outcome colors, per theme.
  const TOGETHER_ACCENTS = ['var(--chart-outcome-continuous_purist)', 'var(--chart-outcome-flip_flop)', 'var(--chart-outcome-skipped_sections)'];
  const STRENGTH = { weak: ['Weak link', 2], moderate: ['Moderate link', 3], strong: ['Strong link', 5] };

  /** "Some correlations we found": the strongest links in the data, one card each. */
  function renderTogether(section, note, cards, insights) {
    const list = insights.correlations || [];
    note.textContent = `Calculated from the ${insights.total} hikes in the dataset each time it is updated: we check ` +
      `${insights.comparisonsTried || 'several'} pairs of answers and show the strongest links. With this many hikes they are ` +
      'hints, not findings: going together doesn\u2019t mean one causes the other.';
    cards.replaceChildren();
    if (!list.length) {
      const empty = el('p', 'text-center text-sm text-slate-500', 'Nothing stands out clearly yet.');
      cards.appendChild(empty);
    }
    list.forEach((item, i) => cards.appendChild(togetherCard(item, i)));
    section.classList.remove('hidden');
  }

  function togetherCard(item, i) {
    const accent = TOGETHER_ACCENTS[i % TOGETHER_ACCENTS.length];
    const card = el('article', 'card-glow rounded-2xl p-6 pt-7 relative overflow-hidden flex flex-col w-full md:w-[calc((100%-3rem)/3)]');
    const stripe = el('div', 'absolute inset-x-0 top-0 h-1');
    stripe.style.backgroundColor = accent;
    const rank = el('div', 'corr-rank absolute -right-1 -top-3 text-7xl font-extrabold text-slate-800/70 select-none pointer-events-none', String(i + 1).padStart(2, '0'));
    rank.setAttribute('aria-hidden', 'true');

    const head = el('div', 'relative flex items-start gap-3');
    const badge = el('div', 'corr-emoji w-12 h-12 shrink-0 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-2xl', item.emoji || '📈');
    badge.setAttribute('aria-hidden', 'true');
    head.append(badge, el('h4', 'text-lg font-extrabold text-white leading-snug pt-1', item.headline));

    // The two groups on one shared scale, with their real values.
    const bars = el('div', 'relative mt-5 space-y-3');
    const max = Math.max(...item.groups.map(g => g.value)) * 1.1 || 1;
    item.groups.forEach((group, g) => {
      const row = el('div');
      const top = el('div', 'flex items-baseline justify-between gap-3 text-xs');
      top.append(el('span', 'text-slate-300', `${group.label} (${group.n})`), el('span', 'font-bold text-white tabular-nums whitespace-nowrap', group.display));
      const track = el('div', 'mt-1 h-2.5 rounded-full bg-slate-800 overflow-hidden');
      const fill = el('div', 'h-full rounded-full');
      fill.style.width = `${Math.max(3, (group.value / max) * 100)}%`;
      fill.style.backgroundColor = accent;
      if (g === 1) fill.style.opacity = '0.45';
      track.appendChild(fill);
      row.append(top, track);
      bars.appendChild(row);
    });

    const text = el('p', 'relative text-sm text-slate-400 mt-4', item.text);

    const [strengthLabel, dots] = STRENGTH[item.strength] || STRENGTH.weak;
    const footer = el('div', 'relative mt-auto pt-5 flex items-center gap-2 text-xs font-mono text-slate-500');
    const meter = el('span', 'inline-flex gap-1');
    meter.setAttribute('aria-hidden', 'true');
    for (let d = 0; d < 5; d++) {
      const dot = el('span', 'inline-block w-1.5 h-3 rounded-full');
      dot.style.backgroundColor = d < dots ? accent : 'var(--range-track)';
      meter.appendChild(dot);
    }
    footer.append(meter, el('span', '', `${strengthLabel} · r = ${item.r} · ${item.n} hikes`));

    card.append(stripe, rank, head, bars, text, footer);
    return card;
  }

  window.Insights = { render, renderTogether };
})();
