/**
 * Insights page: charts over the public dataset. The numbers are computed at
 * build time (netlify/functions/utils/insights.js) and loaded from
 * /data/insights.json.
 *
 *   Insights.render(container, insights, { label })
 *
 * `label(field, value)` turns a stored answer into the words the survey used.
 *
 * With few hikes the page only describes: who answered, what they used, every
 * hike as a dot, the first four weeks, injuries and illness, how hikes ended.
 * The comparisons between groups follow once insights.json has them (30 hikes
 * per group), "things that go together" from 300 hikes.
 *
 * Chart conventions: bars colored by category (see the color notes below), at
 * most 18px thick with a 4px rounded end, a hairline baseline, the value at each
 * bar's tip, a hover/focus tooltip per row and a table view under every chart.
 */
(function () {
  'use strict';

  // Colors are CSS variables (public/styles.css, one set per theme), so switching
  // light/dark recolors the charts. Every bar, dot and swatch has an ink outline.
  const TRAILS_WITH_COLOR = ['PCT', 'AT', 'CDT', 'CT', 'AZT', 'TMB', 'TA']; // as on the home page
  const ACCENTS = ['var(--sage)', 'var(--terracotta)', 'var(--blue)', 'var(--yellow)', 'var(--teal)', 'var(--lavender)', 'var(--pink)'];
  const accent = i => ACCENTS[i % ACCENTS.length];
  const trailColor = key => `var(--chart-trail-${TRAILS_WITH_COLOR.includes(key) ? key.toLowerCase() : 'other'})`;
  // Long and short trails in the dot plots and the first four weeks.
  const GROUP_COLOR = { long: 'var(--blue)', short: 'var(--sage)', all: 'var(--terracotta)' };

  const round1 = v => Math.round(v * 10) / 10;
  const kg = lb => round1(lb * 0.45359237);
  const km = mi => round1(mi * 1.609344);

  // The comparisons: titles and units per chart; the rows come from insights.json.
  const COMPARISONS = [
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
      color: row => trailColor(row.key)
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

  // Every hike as a dot: how to write the values.
  const SPREADS = [
    { id: 'baseWeightLbs', title: 'Base weight', subtitle: 'Pack weight without food, water and fuel.', format: v => `${round1(v)} lb`, both: v => `${round1(v)} lb (${kg(v)} kg)` },
    { id: 'averageDailyMiles', title: 'Daily distance', subtitle: 'Distance divided by days on trail, zero days included.', format: v => `${round1(v)} mi`, both: v => `${round1(v)} mi (${km(v)} km) a day` },
    { id: 'daysOnTrail', title: 'Days on trail', subtitle: 'From the first day to the last.', format: v => `${Math.round(v)} days`, both: v => `${Math.round(v)} days` },
    { id: 'weightChangeLbs', title: 'Body weight change', subtitle: 'After the hike compared with before.', format: v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${round1(Math.abs(v))} lb`, both: v => { const sign = v > 0 ? '+' : v < 0 ? '−' : ''; return `${sign}${round1(Math.abs(v))} lb (${sign}${kg(Math.abs(v))} kg)`; } },
  ];

  // --- Building blocks ------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function median(sorted) {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function card(title, subtitle) {
    const box = el('div', 'card p-6 relative flex flex-col');
    box.appendChild(el('h3', 'font-bold', title));
    if (subtitle) box.appendChild(el('p', 'text-xs text-muted mt-1', subtitle));
    return box;
  }

  function section(container, title, intro) {
    const wrap = el('section');
    wrap.appendChild(el('h2', 'text-2xl font-extrabold', title));
    if (intro) wrap.appendChild(el('p', 'text-sm text-muted mt-1 max-w-3xl', intro));
    const grid = el('div', 'grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5');
    wrap.appendChild(grid);
    container.appendChild(wrap);
    return grid;
  }

  function empty(box) {
    box.appendChild(el('p', 'mt-6 text-sm text-muted', 'Not enough answers for this chart yet.'));
  }

  function table(headers, rows) {
    // mt-auto: 'Show table' sits at the bottom of every card, at the same height in a row.
    const details = el('details', 'mt-auto pt-4 text-xs');
    details.appendChild(el('summary', 'cursor-pointer text-muted hover:text-ink-soft', 'Show table'));
    const wrap = el('div', 'overflow-x-auto');
    const t = el('table', 'mt-2 w-full text-left');
    const head = el('tr', 'text-muted border-b border-subtle');
    headers.forEach(h => head.appendChild(el('th', 'py-1.5 pr-3 font-medium', h)));
    t.appendChild(head);
    rows.forEach(cells => {
      const tr = el('tr', 'border-b border-subtle/60 text-secondary');
      cells.forEach((c, i) => tr.appendChild(el('td', `py-1.5 pr-3${i ? ' tabular-nums' : ''}`, String(c))));
      t.appendChild(tr);
    });
    wrap.appendChild(t);
    details.appendChild(wrap);
    return details;
  }

  function legend(entries) {
    const box = el('div', 'mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted');
    entries.forEach(entry => {
      const item = el('span', 'inline-flex items-center gap-1.5');
      const swatch = el('span', `chart-swatch inline-block w-2.5 h-2.5 ${entry.round ? 'rounded-full' : 'rounded-sm'}`);
      swatch.style.backgroundColor = entry.color;
      item.append(swatch, document.createTextNode(entry.label));
      box.appendChild(item);
    });
    return box;
  }

  // --- Bars -----------------------------------------------------------------------

  function describeRow(chart, row) {
    const n = row.of ? `${row.n} of ${row.of} ${chart.nLabel}` : `${row.n} ${chart.nLabel}`;
    return { value: `${row.value}${chart.unit}`, tip: row.of ? `${row.value}${chart.unit} (${row.n})` : `${row.value}${chart.unit}`, n };
  }

  function showTooltip(tooltip, box, anchor, chart, row) {
    const text = describeRow(chart, row);
    tooltip.replaceChildren(
      el('div', 'text-sm font-bold', text.value),
      el('div', 'text-xs text-muted', `${row.label} · ${text.n}`)
    );
    tooltip.classList.remove('hidden');
    const cardBox = box.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    tooltip.style.left = `${Math.min(rect.left - cardBox.left + 8, cardBox.width - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${rect.top - cardBox.top - tooltip.offsetHeight - 6}px`;
  }

  function renderBars(box, chart, rows) {
    const max = chart.max || Math.max(...rows.map(r => r.value)) * 1.15;
    const tooltip = el('div', 'hidden absolute z-10 pointer-events-none px-3 py-2 rounded-lg bg-sunken border border-transparent');
    const list = el('div', 'mt-5 space-y-1.5');
    list.setAttribute('role', 'list');

    rows.forEach(row => {
      const text = describeRow(chart, row);
      const item = el('div', 'grid grid-cols-1 sm:grid-cols-[10rem_1fr] sm:items-center gap-x-3 gap-y-1 py-1 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-blue-mid cursor-default');
      item.setAttribute('role', 'listitem');
      item.tabIndex = 0;
      item.setAttribute('aria-label', `${row.label}: ${text.value}, ${text.n}`);

      const label = el('div', 'text-xs text-secondary sm:text-right truncate', row.label);
      label.title = row.label;

      // Bar area: hairline baseline on the left, value at the bar's tip.
      const track = el('div', 'flex items-center gap-2 border-l border-line min-h-[24px]');
      const bar = el('div', 'chart-bar h-[18px] rounded-r transition');
      bar.style.width = `${Math.max(0.5, (row.value / max) * 85)}%`;
      bar.style.backgroundColor = chart.color(row);
      const value = el('span', 'text-xs font-semibold text-ink-soft whitespace-nowrap', text.tip);
      track.append(bar, value);
      item.append(label, track);

      const enter = () => { bar.style.filter = 'brightness(1.15)'; showTooltip(tooltip, box, track, chart, row); };
      const leave = () => { bar.style.filter = ''; tooltip.classList.add('hidden'); };
      item.addEventListener('pointerenter', enter);
      item.addEventListener('pointerleave', leave);
      item.addEventListener('focus', enter);
      item.addEventListener('blur', leave);
      list.appendChild(item);
    });

    box.append(list, tooltip);
    if (chart.legend) box.appendChild(legend(chart.legend(rows)));
    box.appendChild(table(['Answer', 'Share', 'Hikers'], rows.map(row => {
      const text = describeRow(chart, row);
      return [row.label, text.value, text.n];
    })));
  }

  /** A card of shares from { answered, rows: [{ key, n }] }: how many hikes gave each answer. */
  function countCard(grid, title, subtitle, data, opts) {
    const box = card(title, subtitle);
    const rows = (data && data.rows) || [];
    if (!rows.length) empty(box);
    else {
      const of = opts.of || data.answered;
      renderBars(box, { unit: '%', nLabel: opts.nLabel || 'hikers', color: opts.color }, rows.map((r, i) => ({
        key: r.key, label: opts.label(r.key), value: Math.round((r.n / of) * 100), n: r.n, of, index: i
      })));
    }
    grid.appendChild(box);
    return box;
  }

  // --- Every hike as a dot --------------------------------------------------------

  /**
   * One row of dots per group on a shared scale, a line at each group's median, and
   * the lowest and highest values under it. Dots that would overlap stack upwards.
   */
  function renderDots(box, spec, groups) {
    const all = groups.flatMap(g => g.values);
    let lo = Math.min(...all), hi = Math.max(...all);
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.04;
    lo -= pad; hi += pad;
    const x = v => ((v - lo) / (hi - lo)) * 100;

    const plot = el('div', 'mt-5 space-y-5');
    plot.setAttribute('aria-hidden', 'true');
    groups.forEach(g => {
      const row = el('div');
      row.appendChild(el('div', 'text-xs text-secondary', `${g.label} · ${g.values.length} ${g.values.length === 1 ? 'hike' : 'hikes'}`));
      // Stack: a dot goes into the lowest lane where it doesn't touch the previous dot.
      const lanes = [];
      const dots = g.values.map(v => {
        const pos = x(v);
        let lane = lanes.findIndex(last => pos - last >= 2.6);
        if (lane === -1) { lane = lanes.length; lanes.push(pos); } else lanes[lane] = pos;
        return { pos, lane };
      });
      const track = el('div', 'relative mt-2 border-b border-line');
      track.style.height = `${lanes.length * 9 + 6}px`;
      dots.forEach(d => {
        const dot = el('span', 'chart-swatch absolute w-2.5 h-2.5 rounded-full');
        dot.style.left = `calc(${d.pos}% - 5px)`;
        dot.style.bottom = `${d.lane * 9 + 2}px`;
        dot.style.backgroundColor = g.color;
        track.appendChild(dot);
      });
      const mid = median(g.values);
      const line = el('span', 'absolute -top-1 -bottom-1 w-0.5 bg-ink');
      line.style.left = `calc(${x(mid)}% - 1px)`;
      track.appendChild(line);
      row.append(track, el('div', 'text-xs text-muted mt-1', `Median ${spec.both(mid)}`));
      plot.appendChild(row);
    });
    const axis = el('div', 'flex justify-between text-[11px] text-muted font-mono keep-mono');
    axis.append(el('span', '', spec.format(Math.min(...all))), el('span', '', spec.format(Math.max(...all))));
    plot.appendChild(axis);
    box.appendChild(plot);

    // The same as text, for screen readers and exact numbers.
    const summary = groups.map(g => `${g.label}: ${g.values.length} hikes, median ${spec.both(median(g.values))}`).join('; ');
    box.setAttribute('aria-label', `${spec.title}. ${summary}.`);
    box.appendChild(table(['Group', 'Hikes', 'Lowest', 'Median', 'Highest'], groups.map(g =>
      [g.label, g.values.length, spec.format(g.values[0]), spec.format(median(g.values)), spec.format(g.values[g.values.length - 1])])));
  }

  function spreadGroups(data, longMiles) {
    return [
      { key: 'long', label: `Long trails (${longMiles} mi or more)`, values: (data && data.long) || [] },
      { key: 'short', label: `Shorter trails`, values: (data && data.short) || [] }
    ].filter(g => g.values.length).map(g => Object.assign(g, { color: GROUP_COLOR[g.key] }));
  }

  // --- The first four weeks -------------------------------------------------------

  function renderRampUp(box, hikes, longMiles) {
    const W = 640, H = 260, L = 48, R = 36, T = 12, B = 34;
    const top = Math.max(5, Math.ceil(Math.max(...hikes.flatMap(h => h.miles.filter(v => v !== null))) / 5) * 5);
    const x = i => L + (i * (W - L - R)) / 3;
    const y = v => T + (1 - v / top) * (H - T - B);
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mt-5 w-full max-w-[640px] h-auto', role: 'img' });

    [0, top / 2, top].forEach(v => {
      const grid = svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v) });
      grid.style.stroke = 'var(--soft-border)';
      const label = svg('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 12 });
      label.style.fill = 'var(--text-muted)';
      label.textContent = `${v} mi`;
      chart.append(grid, label);
    });
    [0, 1, 2, 3].forEach(i => {
      const label = svg('text', { x: x(i), y: H - 10, 'text-anchor': 'middle', 'font-size': 12 });
      label.style.fill = 'var(--text-muted)';
      label.textContent = `Week ${i + 1}`;
      chart.appendChild(label);
    });

    // One thin line per hike (broken where a week is unknown), then each group's median on top.
    const path = (miles, color, width, opacity) => {
      let d = '';
      miles.forEach((v, i) => {
        if (v === null) return;
        d += `${d && miles[i - 1] !== null && i > 0 ? 'L' : 'M'}${x(i)},${y(v)} `;
      });
      const p = svg('path', { d, fill: 'none', 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      p.style.stroke = color;
      p.style.opacity = opacity;
      return p;
    };
    hikes.forEach(h => chart.appendChild(path(h.miles, GROUP_COLOR[h.long ? 'long' : 'short'], 1.5, 0.5)));

    const groups = [['long', `Long trails (${longMiles} mi or more)`], ['short', 'Shorter trails']]
      .map(([key, label]) => {
        const list = hikes.filter(h => h.long === (key === 'long'));
        const medians = [0, 1, 2, 3].map(i => {
          const vals = list.map(h => h.miles[i]).filter(v => v !== null).sort((a, b) => a - b);
          return { n: vals.length, value: vals.length ? round1(median(vals)) : null };
        });
        return { key, label, hikes: list.length, medians };
      })
      .filter(g => g.hikes);
    groups.forEach(g => {
      chart.appendChild(path(g.medians.map(m => m.value), 'var(--strong-border)', 5, 1));
      chart.appendChild(path(g.medians.map(m => m.value), GROUP_COLOR[g.key], 3, 1));
    });
    chart.setAttribute('aria-label', groups.map(g => `${g.label}, median miles a day in weeks 1 to 4: ${g.medians.map(m => (m.value === null ? 'no answers' : m.value)).join(', ')}`).join('; '));
    box.appendChild(chart);
    box.appendChild(legend(groups.map(g => ({ label: `${g.label} · ${g.hikes} hikes`, color: GROUP_COLOR[g.key] }))));
    box.appendChild(el('p', 'text-xs text-muted mt-2', 'Thin lines: one hike each. Thick lines: the median of each week.'));
    box.appendChild(table(['Week', ...groups.map(g => `${g.label}: median`)], [0, 1, 2, 3].map(i =>
      [`Week ${i + 1}`, ...groups.map(g => (g.medians[i].value === null ? '–' : `${g.medians[i].value} mi (${km(g.medians[i].value)} km) · ${g.medians[i].n} hikes`))])));
  }

  // --- The page -------------------------------------------------------------------

  function headline(box, yes, answered, text) {
    const p = el('p', 'mt-3');
    p.append(el('span', 'text-2xl font-extrabold text-ink', `${yes} of ${answered}`), document.createTextNode(` ${text}`));
    box.appendChild(p);
  }

  /** Draws everything from insights.json ({ total, describe, charts, correlations }). */
  function render(container, insights, options) {
    const label = (options && options.label) || ((field, value) => String(value));
    const d = insights.describe || {};
    const longMiles = d.longTrailMiles || 300;
    container.replaceChildren();

    let grid = section(container, 'Who answered', 'The hikes in the dataset so far, by trail, year, home region and age.');
    if (d.sample) {
      countCard(grid, 'Trail', null, d.sample.trail, { label: v => label('trail', v), color: row => trailColor(row.key) });
      countCard(grid, 'Year of the hike', null, d.sample.hikeYear, { label: String, color: () => 'var(--sage)' });
      countCard(grid, 'Home region', null, d.sample.homeRegion, { label: v => label('homeRegion', v), color: row => accent(row.index) });
      countCard(grid, 'Age at the start of the hike', null, d.sample.ageBand, { label: v => label('ageBand', v), color: () => 'var(--sage)' });
    }

    grid = section(container, 'What people used');
    const gearTitles = { shelterType: 'Shelter', backpackType: 'Backpack', footwearCategory: 'Footwear', trekkingPoleUsage: 'Trekking poles', waterFiltration: 'Water treatment', cookSystem: 'Food and cooking', sleepPadType: 'Sleeping pad' };
    Object.entries(gearTitles).forEach(([field, title]) => {
      if (d.gear && d.gear[field]) countCard(grid, title, null, d.gear[field], { label: v => label(field, v), color: row => accent(row.index) });
    });

    grid = section(container, 'Hike by hike', `One dot per hike, with long trails (${longMiles} mi or more) and shorter ones apart. The dark line marks the median: half the hikes are below it, half above.`);
    SPREADS.forEach(spec => {
      const box = card(spec.title, spec.subtitle);
      const groups = spreadGroups(d.spread && d.spread[spec.id], longMiles);
      if (!groups.length) empty(box); else renderDots(box, spec, groups);
      grid.appendChild(box);
    });

    // Enjoyment is a whole number from 1 to 10: a bar per rating, all hikes together.
    const enjoyment = d.spread && d.spread.overallEnjoymentRating;
    const ratings = enjoyment ? [...enjoyment.long, ...enjoyment.short] : [];
    const byRating = {};
    ratings.forEach(v => { byRating[v] = (byRating[v] || 0) + 1; });
    countCard(grid, 'Enjoyment', 'How much hikers enjoyed their hike, from 1 to 10.',
      { answered: ratings.length, rows: Object.keys(byRating).map(Number).sort((a, b) => b - a).map(v => ({ key: v, n: byRating[v] })) },
      { label: v => `${v} out of 10`, color: () => 'var(--yellow)' });

    grid = section(container, 'The first four weeks');
    const ramp = card('Daily distance in the first four weeks', 'Average miles a day in each week, for the hikes with at least two weeks answered.');
    if (!d.rampUp || d.rampUp.length < 2) empty(ramp); else renderRampUp(ramp, d.rampUp, longMiles);
    ramp.classList.add('lg:col-span-2');
    grid.appendChild(ramp);

    grid = section(container, 'Injuries and illness');
    if (d.health) {
      const injury = card('Trail-altering injuries', 'Injuries that changed or ended the hike. One hiker can report several.');
      headline(injury, d.health.injury.yes, d.health.injury.answered, 'hikers had one.');
      if (d.health.injury.locations.rows.length) {
        renderBars(injury, { unit: '%', nLabel: 'injured hikers', color: row => accent(row.index) }, d.health.injury.locations.rows.map((r, i) => ({
          key: r.key, label: label('injuryLocations', r.key), value: Math.round((r.n / d.health.injury.yes) * 100), n: r.n, of: d.health.injury.yes, index: i
        })));
      }
      grid.appendChild(injury);

      const where = card('When injuries happened', 'Miles into the hike, one dot per injured hiker.');
      if (d.health.injury.miles.length) {
        renderDots(where, { title: 'When injuries happened', format: v => `${Math.round(v)} mi`, both: v => `${Math.round(v)} mi (${Math.round(v * 1.609344)} km)` },
          [{ key: 'all', label: 'Injured hikers', values: d.health.injury.miles, color: GROUP_COLOR.all }]);
      } else empty(where);
      grid.appendChild(where);

      const illness = card('Illness', 'Getting sick on the trail. One hiker can report several kinds.');
      headline(illness, d.health.illness.yes, d.health.illness.answered, 'hikers got sick.');
      if (d.health.illness.types.rows.length) {
        renderBars(illness, { unit: '%', nLabel: 'sick hikers', color: row => accent(row.index) }, d.health.illness.types.rows.map((r, i) => ({
          key: r.key, label: label('illnessTypes', r.key), value: Math.round((r.n / d.health.illness.yes) * 100), n: r.n, of: d.health.illness.yes, index: i
        })));
      }
      grid.appendChild(illness);
    }

    grid = section(container, 'How hikes ended');
    if (d.endings) {
      countCard(grid, 'Outcome', null, d.endings.outcome, { label: v => label('completionStatus', v), color: row => `var(--chart-outcome-${row.key})` });
      countCard(grid, 'Why hikers left the trail, skipped parts or flip-flopped', 'The main reason, as each hiker chose it.', d.endings.quitReason, { label: v => label('quitReason', v), color: row => accent(row.index) });
      countCard(grid, 'Seriously thought about quitting: hikers who finished', null, d.endings.consideredQuittingFinished, { label: v => label('consideredQuitting', v), color: () => 'var(--sage)' });
      countCard(grid, 'Seriously thought about quitting: hikers who went home early', null, d.endings.consideredQuittingEndedEarly, { label: v => label('consideredQuitting', v), color: () => 'var(--terracotta)' });
    }

    // Comparisons between groups: only once insights.json has them (30 hikes per group).
    const comparisons = COMPARISONS.filter(c => (insights.charts[c.id] || []).length >= 2);
    if (comparisons.length) {
      grid = section(container, 'Comparisons');
      comparisons.forEach(chart => {
        const box = card(chart.title, chart.subtitle);
        renderBars(box, chart, insights.charts[chart.id]);
        grid.appendChild(box);
      });
    }
  }

  // Accent per card (rank 1-3): the validated outcome colors, per theme.
  const TOGETHER_ACCENTS = ['var(--chart-outcome-continuous_purist)', 'var(--chart-outcome-flip_flop)', 'var(--chart-outcome-skipped_sections)'];
  const STRENGTH = { weak: ['Weak link', 2], moderate: ['Moderate link', 3], strong: ['Strong link', 5] };

  /** "Some things that go together": the strongest links in the data, one card each (from 300 hikes on). */
  function renderTogether(sectionEl, note, cards, insights) {
    const list = insights.correlations || [];
    sectionEl.classList.toggle('hidden', !list.length);
    if (!list.length) return;
    note.textContent = `Calculated from the ${insights.total} hikes in the dataset each time it is updated: I check ` +
      `${insights.comparisonsTried || 'several'} pairs of answers and show the strongest links. They are ` +
      'hints, not findings: going together doesn’t mean one causes the other.';
    cards.replaceChildren();
    list.forEach((item, i) => cards.appendChild(togetherCard(item, i)));
  }

  function togetherCard(item, i) {
    const color = TOGETHER_ACCENTS[i % TOGETHER_ACCENTS.length];
    const box = el('article', 'card p-6 pt-7 relative overflow-hidden flex flex-col w-full md:w-[calc((100%-3rem)/3)]');
    const stripe = el('div', 'absolute inset-x-0 top-0 h-1');
    stripe.style.backgroundColor = color;

    const head = el('div', 'relative flex items-start gap-3');
    head.append(el('h3', 'text-lg font-extrabold leading-snug pt-1', item.headline));

    // The two groups on one shared scale, with their real values.
    const bars = el('div', 'relative mt-5 space-y-3');
    const max = Math.max(...item.groups.map(g => g.value)) * 1.1 || 1;
    item.groups.forEach((group, g) => {
      const row = el('div');
      const top = el('div', 'flex items-baseline justify-between gap-3 text-xs');
      top.append(el('span', 'text-secondary', `${group.label} (${group.n})`), el('span', 'font-bold tabular-nums whitespace-nowrap', group.display));
      const track = el('div', 'mt-1 h-2.5 rounded-full bg-subtle overflow-hidden');
      const fill = el('div', 'chart-fill h-full rounded-full');
      fill.style.width = `${Math.max(3, (group.value / max) * 100)}%`;
      fill.style.backgroundColor = color;
      if (g === 1) fill.style.opacity = '0.45';
      track.appendChild(fill);
      row.append(top, track);
      bars.appendChild(row);
    });

    const text = el('p', 'relative text-sm text-muted mt-4', item.text);

    const [strengthLabel, dots] = STRENGTH[item.strength] || STRENGTH.weak;
    const footer = el('div', 'relative mt-auto pt-5 flex items-center gap-2 text-xs text-muted');
    const meter = el('span', 'inline-flex gap-1');
    meter.setAttribute('aria-hidden', 'true');
    for (let d = 0; d < 5; d++) {
      const dot = el('span', 'inline-block w-1.5 h-3 rounded-full');
      dot.style.backgroundColor = d < dots ? color : 'var(--range-track)';
      meter.appendChild(dot);
    }
    footer.append(meter, el('span', '', `${strengthLabel} · r = ${item.r} · ${item.n} hikes`));

    box.append(stripe, head, bars, text, footer);
    return box;
  }

  window.Insights = { render, renderTogether };
})();
