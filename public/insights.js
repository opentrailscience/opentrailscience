/**
 * Insights page: charts over the public dataset. The numbers are computed at
 * build time (netlify/functions/utils/insights.js) and loaded from
 * /data/insights.json.
 *
 *   Insights.render(container, insights, { label, unitSystem })
 *
 * `label(field, value)` turns a stored answer into the words the survey used;
 * `unitSystem` is 'imperial' (default) or 'metric' (the switch at the top of the page).
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
  const TRAILS_WITH_COLOR = ['PCT', 'AT', 'CDT', 'CT', 'TMB', 'TA', 'CDS']; // as on the home page; the rest grey
  const ACCENTS = ['var(--sage)', 'var(--terracotta)', 'var(--blue)', 'var(--yellow)', 'var(--teal)', 'var(--lavender)', 'var(--pink)'];
  const accent = i => ACCENTS[i % ACCENTS.length];
  const trailColor = key => `var(--chart-trail-${TRAILS_WITH_COLOR.includes(key) ? key.toLowerCase() : 'other'})`;
  // Long and short trails in the dot plots and the first four weeks.
  const GROUP_COLOR = { long: 'var(--blue)', short: 'var(--sage)', all: 'var(--terracotta)' };

  const round1 = v => Math.round(v * 10) / 10;

  // Units: insights.json is in imperial units (as stored); `metric` is set by each render.
  let metric = false;
  const METRIC = { lb: ['kg', 0.45359237], mi: ['km', 1.609344], 'mi/day': ['km/day', 1.609344], ft: ['m', 0.3048], in: ['cm', 2.54] };
  const inUnit = (v, unit) => (metric && METRIC[unit] ? v * METRIC[unit][1] : v);
  const unitName = unit => (metric && METRIC[unit] ? METRIC[unit][0] : unit);
  const number = (v, decimals) => v.toLocaleString('en-US', { maximumFractionDigits: decimals }).replace(/^-/, '−'); // a real minus sign
  /** "14.5 lb" or "6.6 kg": a stored value in the unit chosen at the top of the page. */
  const fmt = (v, unit, decimals = 1) => {
    const n = number(inUnit(v, unit), decimals);
    return !unit ? n : unit === '%' ? `${n}%` : `${n} ${unitName(unit)}`;
  };
  const signed = (v, unit, decimals) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), unit, decimals)}`;

  // The comparisons: titles and units per chart; the rows come from insights.json.
  const COMPARISONS = [
    {
      id: 'baseWeightByOutcome',
      title: 'Median base weight by outcome',
      subtitle: 'Pack base weight of hikers who finished, flip-flopped, section-hiked or went home early.',
      unit: ' lb',
      valueText: row => fmt(row.value, 'lb'),
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
      subtitle: 'Share of hikers with a trail-altering injury, by average distance a day in their first week.',
      unit: '%',
      max: 100,
      nLabel: 'hikers',
      // The bins are 10, 15 and 20 mi a day (utils/insights.js); labelled here in the chosen unit.
      rowLabel: row => {
        const d = v => number(inUnit(v, 'mi'), 0);
        const per = unitName('mi/day');
        return [`Under ${d(10)} ${per}`, `${d(10)} to ${metric ? d(15) : 14} ${per}`, `${d(15)} to ${metric ? d(20) : 19} ${per}`, `${d(20)}+ ${per}`][row.key] || row.label;
      },
      color: row => `var(--chart-ramp-${row.key})` // ordered bins: one green, light to dark
    }
  ];

  // Every hike as a dot: how to write the values.
  const SPREADS = [
    { id: 'baseWeightLbs', title: 'Base weight', subtitle: 'Pack weight without food, water and fuel.', unit: 'lb', format: v => fmt(v, 'lb') },
    { id: 'averageDailyMiles', title: 'Daily distance', subtitle: 'Distance divided by days on trail, zero days included.', unit: 'mi/day', format: v => `${fmt(v, 'mi')} a day` },
    { id: 'daysOnTrail', title: 'Days on trail', subtitle: 'From the first day to the last.', unitWord: 'days', format: v => `${Math.round(v)} days` },
    { id: 'weightChangeLbs', title: 'Body weight change', subtitle: 'After the hike compared with before.', unit: 'lb', format: v => signed(v, 'lb') },
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

  // Sections open and close by their title; the first one starts open, and which ones are open
  // survives a re-render (switching units). Wide screens: one bar of titles, built like the mi · lb |
  // km · kg switch, with the open sections under it, each with its heading. Phones: each title is a
  // full-width button with its section right under it.
  const openSections = new Set(['Who answered']);
  let sectionBar = null; // the bar on wide screens, made by render()
  let sectionGrids = []; // every section's grid, to centre a lone last card (render())

  /** A last card without a partner (an odd number of half-width cards) sits centred under the pair above. */
  function centreLoneCards() {
    sectionGrids.forEach(grid => {
      const half = [...grid.children].filter(c => !c.classList.contains('lg:col-span-2'));
      const last = grid.lastElementChild;
      if (half.length > 1 && half.length % 2 === 1 && half.includes(last)) {
        last.classList.add('lg:col-span-2', 'lg:w-[calc(50%-0.75rem)]', 'lg:justify-self-center');
      }
    });
  }
  const BAR_ON = 'px-3.5 py-1.5 rounded-md text-sm font-bold bg-brand text-on-color transition';
  const BAR_OFF = 'px-3.5 py-1.5 rounded-md text-sm font-bold text-secondary hover:text-ink transition';

  function section(container, title, intro) {
    const id = `insights-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    const tab = el('button', BAR_OFF, title);
    tab.type = 'button';
    tab.setAttribute('aria-controls', id);
    sectionBar.appendChild(tab);
    const heading = el('h2', 'lg:hidden');
    const toggle = el('button', 'card !block w-full text-left px-4 py-3 text-base font-bold', title);
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', id);
    heading.appendChild(toggle);
    const panel = el('section', 'insights-section pt-2 pb-6 lg:pt-10 lg:pb-0');
    panel.id = id;
    panel.appendChild(el('h2', 'hidden lg:block text-2xl font-extrabold text-center', title));
    if (intro) panel.appendChild(el('p', 'text-sm text-muted mt-1 max-w-3xl mx-auto text-center', intro));
    const grid = el('div', 'grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5');
    panel.appendChild(grid);
    sectionGrids.push(grid);
    const show = open => {
      panel.hidden = !open;
      tab.className = open ? BAR_ON : BAR_OFF;
      // The phone button filled like the bar's (set here: .card's own colours would win over classes).
      toggle.style.backgroundColor = open ? 'var(--color-brand)' : '';
      toggle.style.color = open ? 'var(--color-on-color)' : '';
      [tab, toggle].forEach(b => b.setAttribute('aria-expanded', String(open)));
      if (open) openSections.add(title); else openSections.delete(title);
    };
    [tab, toggle].forEach(b => b.addEventListener('click', () => show(panel.hidden)));
    show(openSections.has(title));
    container.append(heading, panel);
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

  /** Round tick values between lo and hi (1, 2, 2.5 or 5 times a power of ten), about `count` of them. */
  function niceTicks(lo, hi, count, whole) {
    const raw = (hi - lo) / count, pow = 10 ** Math.floor(Math.log10(raw));
    let step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(st => st >= raw);
    if (whole) step = Math.max(1, Math.round(step));
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6 || 0); // || 0: never "-0"
    return { ticks, step };
  }

  // --- Bars -----------------------------------------------------------------------

  function describeRow(chart, row) {
    const n = row.of ? `${row.n} of ${row.of} ${chart.nLabel}` : `${row.n} ${chart.nLabel}`;
    const value = chart.valueText ? chart.valueText(row) : `${row.value}${chart.unit}`;
    return { value, tip: row.of ? `${value} (${row.n})` : value, n };
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
    // `foldSingles: 'trails'`: the answers given by one hike each fold into a row that opens (from three of them).
    const singles = chart.foldSingles ? rows.filter(r => r.n === 1) : [];
    const folded = singles.length >= 3 ? singles : [];
    const extra = el('div', 'hidden space-y-1.5');
    extra.id = `fold-${Math.random().toString(36).slice(2, 9)}`;
    extra.setAttribute('role', 'list');

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
      (folded.includes(row) ? extra : list).appendChild(item);
    });

    box.append(list);
    if (folded.length) {
      const toggle = el('button', 'self-start mt-1 min-h-[44px] text-xs font-semibold text-secondary hover:text-ink underline underline-offset-2 text-left sm:ml-[calc(10rem+0.75rem)]');
      toggle.type = 'button';
      toggle.setAttribute('aria-controls', extra.id);
      const show = open => {
        extra.classList.toggle('hidden', !open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? `Hide the ${folded.length} ${chart.foldSingles} with one hike each` : `${folded.length} more ${chart.foldSingles} with one hike each`;
      };
      toggle.addEventListener('click', () => show(extra.classList.contains('hidden')));
      show(false);
      box.append(extra, toggle);
    }
    box.append(tooltip);
    if (chart.legend) box.appendChild(legend(chart.legend(rows)));
    box.appendChild(table(['Answer', 'Share', 'Hikers'], rows.map(row => {
      const text = describeRow(chart, row);
      return [row.label, text.value, text.n];
    })));
  }

  // --- Pies -----------------------------------------------------------------------

  /**
   * A pie for answers that split everyone into a few parts (one answer per hike): slices with an
   * ink outline, the shares next to it and the table under it, like the bars.
   */
  function renderPie(box, chart, all) {
    const rows = all.filter(r => r.n > 0); // answers nobody gave get no slice
    const total = rows.reduce((sum, r) => sum + r.n, 0);
    const wrap = el('div', 'mt-5 flex flex-col sm:flex-row sm:items-center gap-6');
    const size = 160, c = size / 2, rad = c - 2;
    const pie = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'shrink-0 self-center', role: 'img' });
    let angle = -Math.PI / 2;
    rows.forEach(row => {
      const share = row.n / total;
      let slice;
      if (share >= 0.9999) slice = svg('circle', { cx: c, cy: c, r: rad });
      else {
        const end = angle + share * 2 * Math.PI;
        const p = a => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
        slice = svg('path', { d: `M${c},${c} L${p(angle)} A${rad},${rad} 0 ${share > 0.5 ? 1 : 0} 1 ${p(end)} Z` });
        angle = end;
      }
      slice.setAttribute('stroke-width', 1.5);
      slice.setAttribute('stroke-linejoin', 'round');
      slice.style.fill = chart.color(row);
      slice.style.stroke = 'var(--strong-border)';
      const tip = svg('title');
      tip.textContent = `${row.label}: ${row.value}% (${row.n})`;
      slice.appendChild(tip);
      pie.appendChild(slice);
    });
    pie.setAttribute('aria-label', rows.map(r => `${r.label}: ${r.value}%, ${r.n} ${chart.nLabel}`).join('; '));
    const list = el('ul', 'space-y-2 text-xs');
    rows.forEach(row => {
      const item = el('li', 'flex items-center gap-2');
      const swatch = el('span', 'chart-swatch inline-block w-3 h-3 rounded-sm shrink-0');
      swatch.style.backgroundColor = chart.color(row);
      item.append(swatch, el('span', 'text-secondary', row.label), el('span', 'font-semibold text-ink-soft whitespace-nowrap', `${row.value}% (${row.n})`));
      list.appendChild(item);
    });
    wrap.append(pie, list);
    box.appendChild(wrap);
    box.appendChild(table(['Answer', 'Share', 'Hikers'], rows.map(row => [row.label, `${row.value}%`, row.n])));
  }

  /** A card of shares from { answered, rows: [{ key, n }] }: how many hikes gave each answer. */
  function countCard(grid, title, subtitle, data, opts) {
    const box = card(title, subtitle);
    const rows = (data && data.rows) || [];
    if (!rows.length) empty(box);
    else {
      const of = opts.of || data.answered;
      const chart = { unit: '%', nLabel: opts.nLabel || 'hikers', color: opts.color, foldSingles: opts.foldSingles };
      const shares = rows.map((r, i) => ({ key: r.key, label: opts.label(r.key), value: Math.round((r.n / of) * 100), n: r.n, of, index: i }));
      (opts.pie ? renderPie : renderBars)(box, chart, shares);
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
    // The scale starts and ends on a round number in the unit shown, so the ruler under the dots
    // has equally spaced numbers with one at each end.
    const factor = inUnit(1, spec.unit);
    let shownLo = Math.min(...all) * factor, shownHi = Math.max(...all) * factor;
    if (shownLo === shownHi) { shownLo -= 1; shownHi += 1; }
    const { step } = niceTicks(shownLo, shownHi, 5, spec.unitWord === 'days');
    const first = Math.floor(shownLo / step + 1e-9) * step, last = Math.ceil(shownHi / step - 1e-9) * step;
    const ticks = [];
    for (let t = first; t <= last + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6 || 0);
    const lo = first / factor, hi = last / factor;
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
      row.append(track, el('div', 'text-xs text-muted mt-1', `Median ${spec.format(mid)}`));
      plot.appendChild(row);
    });
    // A ruler under the dots: round numbers in the unit shown, the unit under the last one.
    const ruler = el('div', 'relative h-7 border-t border-line text-[11px] text-muted font-mono keep-mono');
    const unitLabel = spec.unit ? unitName(spec.unit) : spec.unitWord || '';
    ticks.forEach(t => {
      const at = x(t / factor);
      const mark = el('span', 'absolute top-0 w-px h-2');
      mark.style.left = `${at}%`;
      mark.style.backgroundColor = 'var(--strong-border)';
      const text = el('span', 'absolute top-2.5 -translate-x-1/2 whitespace-nowrap', number(t, step >= 1 ? 0 : 1));
      text.style.left = `${at}%`;
      ruler.append(mark, text);
    });
    plot.appendChild(ruler);
    if (unitLabel) plot.appendChild(el('div', '!mt-0 text-right text-[11px] text-muted font-mono keep-mono', unitLabel));
    box.appendChild(plot);

    // The same as text, for screen readers and exact numbers.
    const summary = groups.map(g => `${g.label}: ${g.values.length} hikes, median ${spec.format(median(g.values))}`).join('; ');
    box.setAttribute('aria-label', `${spec.title}. ${summary}.`);
    box.appendChild(table(['Group', 'Hikes', 'Lowest', 'Median', 'Highest'], groups.map(g =>
      [g.label, g.values.length, spec.format(g.values[0]), spec.format(median(g.values)), spec.format(g.values[g.values.length - 1])])));
  }

  const longLabel = miles => `Long trails (${fmt(miles, 'mi', 0)} or more)`;

  function spreadGroups(data, longMiles) {
    return [
      { key: 'long', label: longLabel(longMiles), values: (data && data.long) || [] },
      { key: 'short', label: `Shorter trails`, values: (data && data.short) || [] }
    ].filter(g => g.values.length).map(g => Object.assign(g, { color: GROUP_COLOR[g.key] }));
  }

  // --- The first four weeks -------------------------------------------------------

  function renderRampUp(box, stored, longMiles) {
    const hikes = stored.map(h => ({ long: h.long, miles: h.miles.map(v => (v === null ? null : round1(inUnit(v, 'mi')))) }));
    const unit = unitName('mi');
    // Drawn at about the width it is shown (the card spans both columns), so the 12px labels stay 12px.
    const W = Math.round(Math.min(1100, Math.max(300, window.innerWidth - 90))), H = W < 560 ? 240 : 300, L = 60, R = 36, T = 12, B = 34;
    const top = Math.max(5, Math.ceil(Math.max(...hikes.flatMap(h => h.miles.filter(v => v !== null))) / 5) * 5);
    const x = i => L + (i * (W - L - R)) / 3;
    const y = v => T + (1 - v / top) * (H - T - B);
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mt-5 w-full h-auto', role: 'img' });

    [0, top / 2, top].forEach(v => {
      const grid = svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v) });
      grid.style.stroke = 'var(--soft-border)';
      const label = svg('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 12 });
      label.style.fill = 'var(--text-muted)';
      label.textContent = `${v} ${unit}`;
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

    const groups = [['long', longLabel(longMiles)], ['short', 'Shorter trails']]
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
    chart.setAttribute('aria-label', groups.map(g => `${g.label}, median ${unit} a day in weeks 1 to 4: ${g.medians.map(m => (m.value === null ? 'no answers' : m.value)).join(', ')}`).join('; '));
    box.appendChild(chart);
    box.appendChild(legend(groups.map(g => ({ label: `${g.label} · ${g.hikes} hikes`, color: GROUP_COLOR[g.key] }))));
    box.appendChild(el('p', 'text-xs text-muted mt-2', 'Thin lines: one hike each. Thick lines: the median of each week.'));
    box.appendChild(table(['Week', ...groups.map(g => `${g.label}: median`)], [0, 1, 2, 3].map(i =>
      [`Week ${i + 1}`, ...groups.map(g => (g.medians[i].value === null ? '–' : `${g.medians[i].value} ${unit} · ${g.medians[i].n} hikes`))])));
  }

  // --- Make your own chart -------------------------------------------------------------

  // The axes to choose from (the columns of insights.json's points), with their units.
  // `ordered`: an answer from a list with an order, stored as its position; the axis shows the answers.
  const AXES = {
    ageBand: { label: 'Age', ordered: ['20-and-under', '21-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70+'] },
    heightInches: { sym: ['H'], label: 'Height', unit: 'in', decimals: 0 },
    preTrailWeightLbs: { sym: ['W', 'pre'], label: 'Body weight before the hike', unit: 'lb' },
    postTrailWeightLbs: { sym: ['W', 'post'], label: 'Body weight after the hike', unit: 'lb' },
    weightChangeLbs: { sym: ['ΔW'], label: 'Body weight change', unit: 'lb', signed: true },
    priorExperience: { label: 'Experience before the hike', ordered: ['none', 'weekend_trips', 'multi_week_trips', 'previous_thru_hike'] },
    preTrailFitnessRating: { sym: ['Fit'], label: 'Fitness before the hike (1 to 10)', decimals: 0, one: 'fitness point', many: 'fitness points' },
    trainingFocus: { sym: ['Train'], label: 'Training: cardio (0) to strength (1)', decimals: 2, perPhrase: 'from all cardio (0) to all strength (1)' },
    baseWeightLbs: { sym: ['W', 'base'], label: 'Base weight', unit: 'lb' },
    maxHeavyLoadLbs: { sym: ['W', 'max'], label: 'Heaviest pack weight', unit: 'lb' },
    shoePairsUsed: { sym: ['Shoes'], label: 'Pairs of shoes used', decimals: 0, one: 'pair of shoes', many: 'pairs of shoes' },
    hikeYear: { sym: ['Year'], label: 'Year of the hike', decimals: 0, plain: true, perPhrase: 'for each year later' },
    plannedDistanceMiles: { sym: ['D', 'plan'], label: 'Planned distance', unit: 'mi', decimals: 0 },
    totalDistanceMiles: { sym: ['D'], label: 'Distance hiked', unit: 'mi', decimals: 0 },
    daysOnTrail: { sym: ['Days'], label: 'Days on trail', decimals: 0, one: 'day on trail', many: 'days on trail' },
    averageDailyMiles: { sym: ['D', 'day'], label: 'Daily distance', unit: 'mi/day' },
    totalZeroDays: { sym: ['Zero'], label: 'Zero days', decimals: 0, one: 'zero day', many: 'zero days' },
    totalNeroDays: { sym: ['Nero'], label: 'Nero days', decimals: 0, one: 'nero day', many: 'nero days' },
    totalElevationGainFt: { sym: ['Elev'], label: 'Elevation gain', unit: 'ft', decimals: 0 },
    averageCalories: { sym: ['kcal'], label: 'Calories eaten per day', decimals: 0, one: 'calorie a day', many: 'calories a day' },
    hoursSleepPerNight: { sym: ['Sleep'], label: 'Hours of sleep per night', one: 'hour of sleep', many: 'hours of sleep' },
    sleepQualityRating: { sym: ['Q', 'sleep'], label: 'Sleep quality (0 to 10)', decimals: 0, one: 'sleep quality point', many: 'sleep quality points' },
    percentHikingAlone: { sym: ['Alone'], label: 'Time hiking alone', unit: '%', decimals: 0 },
    painkillerUse: { label: 'Painkillers', ordered: ['never', 'sometimes', 'daily'] },
    consideredQuitting: { label: 'Seriously thought about quitting', ordered: ['never', 'once_or_twice', 'several_times', 'almost_constantly'] },
    overallEnjoymentRating: { sym: ['Joy'], label: 'Enjoyment (1 to 10)', decimals: 0, one: 'enjoyment point', many: 'enjoyment points' }
  };
  // The choice survives a re-render (switching units): kept here, not in the page.
  const picked = { x: 'daysOnTrail', y: 'totalZeroDays' };
  // A line is drawn only for a strong link: |r| of 0.5 or more (from 3 hikes, see linearFit).
  const LINE_MIN_R = 0.5;

  /**
   * Least-squares straight line through the points ({ x, y } in the units shown), computed here in the
   * browser: y = intercept + slope · x, with Pearson's r. Null with fewer than 3 points or no spread in x.
   */
  function linearFit(list) {
    const n = list.length;
    if (n < 3) return null;
    const mx = list.reduce((sum, p) => sum + p.x, 0) / n, my = list.reduce((sum, p) => sum + p.y, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    list.forEach(p => { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); });
    if (sxx < 1e-12) return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx, r: syy < 1e-12 ? 0 : sxy / Math.sqrt(sxx * syy), n };
  }
  // Two significant digits ("0.034", "12", "1,200"), and never "-0".
  const sig = v => number(Number(v.toPrecision(2)) || 0, 6);

  // The line's formula as MathML (drawn by the browser itself): y = a + b * x, with short symbols.
  function mathml(tag, children, attrs) {
    const node = document.createElementNS('http://www.w3.org/1998/Math/MathML', tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    [].concat(children || []).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }
  const symbol = spec => (spec.sym[1] ? mathml('msub', [mathml('mi', spec.sym[0]), mathml('mi', spec.sym[1], { mathvariant: 'normal' })]) : mathml('mi', spec.sym[0]));
  function formula(ax, ay, fit) {
    const slope = Math.abs(fit.slope);
    const row = mathml('mrow', [symbol(ay), mathml('mo', '='),
      ...(fit.intercept < 0 ? [mathml('mo', '−', { form: 'prefix', lspace: '0', rspace: '0' }), mathml('mn', sig(-fit.intercept))] : [mathml('mn', sig(fit.intercept))]),
      mathml('mo', fit.slope < 0 ? '−' : '+'), mathml('mn', sig(slope)), mathml('mo', '*'), symbol(ax)]);
    return siteFont(mathml('math', row, { display: 'block' }));
  }
  // The formulas in the site's font, not the browser's maths serif.
  function siteFont(node) {
    node.style.fontFamily = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";
    return node;
  }
  function fitStats(fit) {
    const sq = mathml('msup', [mathml('mi', 'R'), mathml('mn', '2')]);
    return siteFont(mathml('math', mathml('mrow', [
      mathml('mi', 'r'), mathml('mo', '='), mathml('mn', sig(fit.r)), mathml('mo', ',', { separator: 'true' }), mathml('mspace', [], { width: '1em' }),
      sq, mathml('mo', '='), mathml('mn', sig(fit.r * fit.r)), mathml('mo', ',', { separator: 'true' }), mathml('mspace', [], { width: '1em' }),
      mathml('mi', 'n'), mathml('mo', '='), mathml('mn', String(fit.n))
    ]), { display: 'block' }));
  }

  /** A scatter plot of two answers the reader picks, long and short trails in their colors, with a table. */
  function renderPickTwo(box, points, longMiles, label) {
    // In the order of AXES (who, body, gear, the hike, sleep, how it felt), which the dropdowns follow.
    const fields = Object.keys(AXES).filter(f => points.fields.includes(f));
    const answerOf = f => (AXES[f].ordered ? v => label(f, AXES[f].ordered[v]) : null);
    if (!fields.includes(picked.x)) picked.x = fields[0];
    if (!fields.includes(picked.y)) picked.y = fields[1];
    const controls = el('div', 'flex flex-wrap gap-x-6 gap-y-3');
    const plot = el('div', 'flex flex-col flex-1');
    const pick = (axis, name) => {
      const wrap = el('label', 'flex items-center gap-2 text-sm max-w-full');
      wrap.appendChild(el('span', 'font-semibold text-ink-soft', name));
      const select = el('select', 'field field-compact sm:text-xs min-w-0 max-w-full');
      Object.entries({ autocomplete: 'off', 'data-1p-ignore': '', 'data-lpignore': 'true', 'data-bwignore': '', 'data-form-type': 'other' })
        .forEach(([k, v]) => select.setAttribute(k, v));
      fields.forEach(f => {
        const option = el('option', '', AXES[f].label);
        option.value = f;
        select.appendChild(option);
      });
      select.value = picked[axis];
      select.addEventListener('change', () => { picked[axis] = select.value; draw(); });
      wrap.appendChild(select);
      return wrap;
    };
    controls.append(pick('x', 'Across'), pick('y', 'Up'));
    box.append(controls, plot);

    function draw() {
      plot.replaceChildren();
      const xi = points.fields.indexOf(picked.x) + 1, yi = points.fields.indexOf(picked.y) + 1;
      const ax = AXES[picked.x], ay = AXES[picked.y];
      const ansX = answerOf(picked.x), ansY = answerOf(picked.y);
      const show = (spec, v) => (spec.ordered ? answerOf(spec === ax ? picked.x : picked.y)(v)
        : spec.plain ? String(v) : spec.signed ? signed(v, spec.unit, spec.decimals) : fmt(v, spec.unit, spec.decimals ?? 1));
      const hikes = points.rows.filter(r => r[xi] !== null && r[yi] !== null)
        .map(r => ({ long: r[0] === 1, x: inUnit(r[xi], ax.unit), y: inUnit(r[yi], ay.unit), rawX: r[xi], rawY: r[yi] }));
      if (hikes.length < 2) { empty(plot); return; }

      // Drawn at about the width it is shown, so the 12px labels stay 12px on phones too.
      const W = Math.round(Math.min(880, Math.max(300, window.innerWidth - 90))), narrow = W < 560;
      const H = narrow ? 300 : 400, R = 12, T = 10, B = 44;
      // Room for the answers on the left when the vertical axis is an ordered answer.
      const L = ansY ? Math.min(narrow ? 124 : 150, 16 + 6.6 * Math.max(...ay.ordered.map((_, i) => ansY(i).length))) : 44;
      // Round tick values (1, 2, 2.5 or 5 times a power of ten; whole numbers for whole-number answers).
      const scale = (vals, from, to, count, whole, ordered) => {
        if (ordered) {
          // Every answer from the first to the last, also those nobody gave, half a step of room at each end.
          const lo = -0.5, hi = ordered.length - 0.5;
          return { ticks: ordered.map((_, i) => i), step: 1, at: v => from + ((v - lo) / (hi - lo)) * (to - from) };
        }
        let lo = Math.min(...vals), hi = Math.max(...vals);
        if (lo === hi) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.06;
        lo -= pad; hi += pad;
        return Object.assign(niceTicks(lo, hi, count, whole), { at: v => from + ((v - lo) / (hi - lo)) * (to - from) });
      };
      const whole = spec => spec.decimals === 0 && !METRIC[spec.unit];
      const sx = scale(hikes.map(h => h.x), L, W - R, narrow ? 4 : 6, whole(ax), ax.ordered);
      const sy = scale(hikes.map(h => h.y), H - B, T, narrow ? 4 : 5, whole(ay), ay.ordered);
      const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mt-2 w-full h-auto', role: 'img' });
      const muted = node => { node.style.fill = 'var(--text-muted)'; return node; };
      const tickText = (s, v, ans, plain) => (ans ? ans(v) : plain ? String(v) : number(v, s.step >= 1 ? 0 : s.step >= 0.1 ? 1 : 2));
      sy.ticks.forEach(v => {
        const line = svg('line', { x1: L, x2: W - R, y1: sy.at(v), y2: sy.at(v) });
        line.style.stroke = 'var(--soft-border)';
        const t = muted(svg('text', { x: L - 8, y: sy.at(v) + 4, 'text-anchor': 'end', 'font-size': 12 }));
        t.textContent = tickText(sy, v, ansY, ay.plain);
        chart.append(line, t);
      });
      // Ordered answers across: on a phone, every third one when there are many (ages), so they don't overlap.
      sx.ticks.filter((v, i) => !ansX || !narrow || ax.ordered.length <= 4 || i % 3 === 1).forEach(v => {
        const t = muted(svg('text', { x: sx.at(v), y: H - B + 18, 'text-anchor': 'middle', 'font-size': 12 }));
        t.textContent = tickText(sx, v, ansX, ax.plain);
        if (ansX && !narrow && ax.ordered.length > 6) t.setAttribute('font-size', 11);
        chart.appendChild(t);
      });
      const base = svg('line', { x1: L, x2: W - R, y1: H - B, y2: H - B });
      base.style.stroke = 'var(--strong-border)';
      chart.appendChild(base);
      const unitOf = spec => (spec.unit && !spec.ordered ? ` (${unitName(spec.unit)})` : '');
      const xLabel = muted(svg('text', { x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 12 }));
      xLabel.textContent = `${ax.label}${unitOf(ax)}`;
      chart.appendChild(xLabel);
      // Hikes with the same two answers (and kind of trail) share one dot, larger for more hikes.
      const same = new Map();
      hikes.forEach(h => {
        const k = `${h.long}|${h.rawX}|${h.rawY}`;
        if (same.has(k)) same.get(k).n += 1; else same.set(k, Object.assign({ n: 1 }, h));
      });
      [...same.values()].sort((a, b) => b.n - a.n).forEach(h => {
        const dot = svg('circle', { cx: sx.at(h.x), cy: sy.at(h.y), r: Math.min(12, 6 + 2 * (h.n - 1)), 'stroke-width': 1.5 });
        dot.style.fill = GROUP_COLOR[h.long ? 'long' : 'short'];
        dot.style.stroke = 'var(--strong-border)';
        dot.style.fillOpacity = '0.85';
        const tip = svg('title');
        tip.textContent = `${ax.label}: ${show(ax, h.rawX)} · ${ay.label}: ${show(ay, h.rawY)}${h.n > 1 ? ` · ${h.n} hikes` : ''}`;
        dot.appendChild(tip);
        chart.appendChild(dot);
      });
      // The straight line that fits the dots best (least squares), when both answers are numbers.
      const fit = ax.ordered || ay.ordered ? null : linearFit(hikes);
      const strong = fit && Math.abs(fit.r) >= LINE_MIN_R;
      if (strong) {
        const xs = hikes.map(h => h.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
        const clipId = `fit-${Math.random().toString(36).slice(2, 9)}`;
        const clip = svg('clipPath', { id: clipId });
        clip.appendChild(svg('rect', { x: L, y: T, width: W - R - L, height: H - B - T }));
        const line = svg('line', { x1: sx.at(x0), y1: sy.at(fit.intercept + fit.slope * x0), x2: sx.at(x1), y2: sy.at(fit.intercept + fit.slope * x1),
          'stroke-width': 2.5, 'stroke-dasharray': '7 5', 'stroke-linecap': 'round', 'clip-path': `url(#${clipId})` });
        line.style.stroke = 'var(--page-text)';
        chart.append(clip, line);
      }
      chart.setAttribute('aria-label', `${ay.label} against ${ax.label}, one dot per hike, ${hikes.length} hikes. The table below has every value.`);
      plot.appendChild(el('p', 'mt-5 text-xs text-muted', `${ay.label}${unitOf(ay)}`));
      plot.appendChild(chart);
      const groups = [['long', longLabel(longMiles)], ['short', 'Shorter trails']]
        .map(([key, text]) => ({ key, n: hikes.filter(h => h.long === (key === 'long')).length, text }))
        .filter(g => g.n);
      plot.appendChild(legend(groups.map(g => ({ label: `${g.text} · ${g.n} ${g.n === 1 ? 'hike' : 'hikes'}`, color: GROUP_COLOR[g.key] }))));
      if (same.size < hikes.length) plot.appendChild(el('p', 'text-xs text-muted mt-2', 'A larger dot is several hikes with the same two answers.'));
      if (strong) {
        const unitText = spec => (spec.unit === '%' ? ' percentage points' : spec.unit ? ` ${unitName(spec.unit)}` : spec.many ? ` ${spec.many}` : '');
        const per = ax.unit === '%' ? 'percentage point' : ax.unit ? unitName(ax.unit) : ax.one || 'step';
        const maths = el('div', 'fit-formula mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 text-ink [&_math]:text-xl');
        maths.append(formula(ax, ay, fit), fitStats(fit));
        maths.setAttribute('aria-label', `Dashed line (least squares): ${ay.label} = ${sig(fit.intercept)} ${fit.slope < 0 ? 'minus' : 'plus'} ${sig(Math.abs(fit.slope))} times ${ax.label}; r = ${sig(fit.r)}, R squared = ${sig(fit.r * fit.r)}, ${fit.n} hikes.`);
        // The key: what the symbols stand for (with the unit shown), then the slope in words.
        const name = spec => `${spec.label}${spec.unit ? ` in ${spec.unit === '%' ? '%' : unitName(spec.unit)}` : ''}`;
        const key = el('p', 'text-xs text-muted mt-2', 'Dashed line (least squares). ');
        [ay, ax].forEach((spec, i) => {
          key.append(siteFont(mathml('math', symbol(spec))), `: ${name(spec)}${i ? '.' : ' · '}`);
        });
        const q = el('p', 'text-xs text-muted mt-1');
        q.textContent = `${fit.slope < 0 ? '−' : '+'}${sig(Math.abs(fit.slope))}${unitText(ay)} ${ax.perPhrase || `for each extra ${per}`}.`;
        plot.append(maths, key, q);
      } else if (fit) {
        plot.appendChild(el('p', 'text-xs text-muted mt-3', `No line: r = ${sig(fit.r)} from ${fit.n} hikes. A line is drawn from r = ±${LINE_MIN_R}.`));
      } else if (ax.ordered || ay.ordered) {
        plot.appendChild(el('p', 'text-xs text-muted mt-3', 'No straight line for answers without numbers (like age bands).'));
      }
      const sorted = [...hikes].sort((a, b) => a.rawX - b.rawX || a.rawY - b.rawY);
      plot.appendChild(table([ax.label, ay.label, 'Trail'], sorted.map(h => [show(ax, h.rawX), show(ay, h.rawY), h.long ? 'Long' : 'Shorter'])));
    }
    draw();
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
    metric = !!options && options.unitSystem === 'metric';
    const d = insights.describe || {};
    const longMiles = d.longTrailMiles || 300;
    container.replaceChildren();
    // The bar of section titles (wide screens), then the sections (see section()).
    sectionGrids = [];
    sectionBar = el('div', 'hidden lg:flex flex-wrap justify-center gap-1 w-fit max-w-full mx-auto rounded-lg p-1 bg-surface border border-line');
    sectionBar.setAttribute('role', 'group');
    sectionBar.setAttribute('aria-label', 'Sections');
    const sections = el('div', 'flex flex-col gap-y-3 lg:gap-y-0');
    container.append(sectionBar, sections);
    container = sections;

    let grid = section(container, 'Who answered', 'The hikes in the dataset so far, by trail, year, home region and age.');
    if (d.sample) {
      // Pies for a few answers that split everyone (one each), bars for the rest; laid out so a pie
      // never sits next to or under another pie (two columns on wide screens).
      countCard(grid, 'Trail', null, d.sample.trail, { label: v => label('trail', v), color: row => trailColor(row.key), foldSingles: 'trails' });
      countCard(grid, 'Home region', null, d.sample.homeRegion, { label: v => label('homeRegion', v), color: row => accent(row.index), pie: true });
      countCard(grid, 'Year of the hike', null, d.sample.hikeYear, { label: String, color: () => 'var(--sage)' });
      countCard(grid, 'Age at the start of the hike', null, d.sample.ageBand, { label: v => label('ageBand', v), color: () => 'var(--sage)' });
    }

    grid = section(container, 'What people used');
    // In this order pies and bars alternate like a chessboard: pie | bar, bar | pie, pie | bar, bar.
    const gearTitles = { shelterType: 'Shelter', footwearCategory: 'Footwear', waterFiltration: 'Water treatment', backpackType: 'Backpack', trekkingPoleUsage: 'Trekking poles', cookSystem: 'Food and cooking', sleepPadType: 'Sleeping pad' };
    Object.entries(gearTitles).forEach(([field, title]) => {
      const name = v => (field === 'shelterType' && v === 'indoors' ? 'Huts and hotels'
        : field === 'sleepPadType' && v === 'none_indoors' ? 'No pad (hotels, huts)' : label(field, v));
      const pie = ['shelterType', 'backpackType', 'trekkingPoleUsage'].includes(field);
      // Trekking poles starts further along the palette, so its pie doesn't look like the backpack one.
      const shift = field === 'trekkingPoleUsage' ? 2 : 0;
      if (d.gear && d.gear[field]) countCard(grid, title, null, d.gear[field], { label: name, color: row => accent(row.index + shift), pie });
    });

    grid = section(container, 'Hike by hike', `One dot per hike, with long trails (${fmt(longMiles, 'mi', 0)} or more) and shorter ones apart. The dark line marks the median: half the hikes are below it, half above.`);
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

    if (d.points && d.points.rows.length) {
      grid = section(container, 'Make your own chart', 'One dot per hike. Choose what goes on each axis.');
      const box = el('div', 'card p-6 relative flex flex-col lg:col-span-2');
      renderPickTwo(box, d.points, longMiles, label);
      grid.appendChild(box);
    }

    grid = section(container, 'The first four weeks');
    const ramp = card('Daily distance in the first four weeks', 'Average distance a day in each week, for the hikes with at least two weeks answered.');
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

      const where = card('When injuries happened', 'Distance into the hike, one dot per injured hiker.');
      if (d.health.injury.miles.length) {
        renderDots(where, { title: 'When injuries happened', unit: 'mi', format: v => fmt(v, 'mi', 0) },
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
      countCard(grid, 'Outcome', null, d.endings.outcome, { label: v => label('completionStatus', v), color: row => `var(--chart-outcome-${row.key})`, pie: true });
      countCard(grid, 'Why hikers left the trail, skipped parts or flip-flopped', 'The main reason, as each hiker chose it.', d.endings.quitReason, { label: v => label('quitReason', v), color: row => accent(row.index) });
      countCard(grid, 'Seriously thought about quitting: finished', null, d.endings.consideredQuittingFinished, { label: v => label('consideredQuitting', v), color: () => 'var(--sage)' });
      countCard(grid, 'Seriously thought about quitting: didn’t hike every mile', null, d.endings.consideredQuittingNotEveryMile, { label: v => label('consideredQuitting', v), color: () => 'var(--terracotta)' });
    }

    // Comparisons between groups: only once insights.json has them (30 hikes per group).
    const comparisons = COMPARISONS.filter(c => (insights.charts[c.id] || []).length >= 2);
    if (comparisons.length) {
      grid = section(container, 'Comparisons');
      comparisons.forEach(chart => {
        const box = card(chart.title, chart.subtitle);
        const rows = insights.charts[chart.id];
        renderBars(box, chart, chart.rowLabel ? rows.map(row => Object.assign({}, row, { label: chart.rowLabel(row) })) : rows);
        grid.appendChild(box);
      });
    }
    centreLoneCards();
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
