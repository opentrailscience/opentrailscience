/**
 * Aggregate statistics over public survey records.
 * Used for public/data/stats.json and for the hiker's comparison after submitting.
 *
 * Averages only count records that answered the question, and every
 * categorical breakdown lists each option separately (so e.g. "hybrid" cook
 * systems are no longer counted as cold soaking).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./survey-schema'));
  } else {
    root.SurveyStats = factory(root.SurveySchema);
  }
})(typeof self !== 'undefined' ? self : this, function (Schema) {
  'use strict';

  const BREAKDOWN_FIELDS = [
    'backpackType', 'cookSystem', 'sleepPadType', 'waterFiltration', 'footwearCategory', 'trekkingPoleUsage'
  ];

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function numbers(docs, key) {
    return docs.map(d => d[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
  }

  function mean(values) {
    return values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return round1(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  }

  function percent(part, whole) {
    return whole ? Math.round((part / whole) * 100) : null;
  }

  /** Percentage of answering records per option, e.g. { framed: 70, frameless: 30 }. */
  function breakdown(docs, key) {
    const answered = docs.filter(d => d[key] !== null && d[key] !== undefined);
    const result = {};
    Schema.FIELDS_BY_NAME[key].values.forEach(value => {
      result[value] = percent(answered.filter(d => d[key] === value).length, answered.length);
    });
    return result;
  }

  function computeStats(docs) {
    const list = docs || [];
    const trails = {};
    list.forEach(d => {
      if (d.trail) trails[d.trail] = (trails[d.trail] || 0) + 1;
    });

    const withStatus = list.filter(d => d.completionStatus);
    const completed = withStatus.filter(d => Schema.COMPLETED_STATUSES.includes(d.completionStatus));
    const baseWeights = numbers(list, 'baseWeightLbs');

    const breakdowns = {};
    BREAKDOWN_FIELDS.forEach(key => {
      breakdowns[key] = breakdown(list, key);
    });

    return {
      totalCount: list.length,
      trails,
      avgBaseWeightLbs: mean(baseWeights),
      medianBaseWeightLbs: median(baseWeights),
      avgDailyMiles: mean(numbers(list, 'averageDailyMiles')),
      completionRate: percent(completed.length, withStatus.length),
      injuryRate: percent(list.filter(d => d.severeInjuryOccurred === true).length, list.length),
      avgEnjoyment: mean(numbers(list, 'overallEnjoymentRating')),
      breakdowns,
      lastUpdated: new Date().toISOString()
    };
  }

  /** Fields computeStats reads; used as a MongoDB projection. */
  const STATS_FIELDS = ['trail', 'baseWeightLbs', 'averageDailyMiles', 'completionStatus', 'severeInjuryOccurred', 'overallEnjoymentRating']
    .concat(BREAKDOWN_FIELDS);

  // --- Personal comparison shown after submitting ---------------------------

  // Below this many peers a percentage would be noise, so none is shown: 3 others on
  // the same trail (so the 4th hiker gets a comparison), 10 when compared with everyone.
  const MIN_TRAIL_PEERS = 3;
  const MIN_PEERS = 10;

  /** Zero days per day on trail, so short and long hikes compare fairly. */
  function zeroDayRate(d) {
    return d.daysOnTrail && typeof d.totalZeroDays === 'number' ? d.totalZeroDays / d.daysOnTrail : null;
  }

  // Euros are converted at a fixed rate, only to compare spending (stored answers keep their currency).
  const EUR_TO_USD = 1.1;
  /** Trail spending per day on trail, in USD, so short and long hikes compare fairly. */
  function spendingPerDay(d) {
    if (typeof d.trailSpending !== 'number' || !d.daysOnTrail) return null;
    return (d.budgetCurrency === 'EUR' ? d.trailSpending * EUR_TO_USD : d.trailSpending) / d.daysOnTrail;
  }

  const QUITTING_ORDER = ['never', 'once_or_twice', 'several_times', 'almost_constantly'];
  function quittingLevel(d) {
    const i = QUITTING_ORDER.indexOf(d.consideredQuitting);
    return i === -1 ? null : i;
  }

  /**
   * What hikers are compared on. `value` reads the compared number (default:
   * the field) and `better` says which end is the good one.
   *   smaller / larger  results-page sentence when the hiker is below / above most peers
   *   share             short phrase for the share text, before "75% of PCT hikers" or "67%"
   *   card              caption under the percentage on the share card
   * The results page is honest and shows every comparison in its real direction.
   * The share card and text show the hiker's best three (`highlights`), always
   * phrased the good way round, so the card is something people want to post.
   * `sameTrailOnly` comparisons are skipped when the hiker is compared with
   * everyone: pace and distance depend too much on the trail.
   */
  const COMPARISONS = [
    {
      field: 'baseWeightLbs', better: 'smaller',
      smaller: (p, g) => `Your base weight was lighter than ${p}% of ${g}.`,
      larger: (p, g) => `Your base weight was heavier than ${p}% of ${g}.`,
      share: 'lighter pack than',
      card: g => `of ${g} carried a heavier pack`
    },
    {
      field: 'averageDailyMiles', better: 'larger', sameTrailOnly: true,
      smaller: (p, g) => `Your average pace was slower than ${p}% of ${g}.`,
      larger: (p, g) => `Your average pace was faster than ${p}% of ${g}.`,
      share: 'faster than',
      card: g => `of ${g} hiked a slower pace`
    },
    {
      field: 'totalDistanceMiles', better: 'larger', sameTrailOnly: true,
      smaller: (p, g) => `You hiked fewer miles than ${p}% of ${g}.`,
      larger: (p, g) => `You hiked further than ${p}% of ${g}.`,
      share: 'further than',
      card: g => `of ${g} hiked fewer miles`
    },
    {
      field: 'zeroDayRate', value: zeroDayRate, better: 'smaller',
      smaller: (p, g) => `You took zero days less often than ${p}% of ${g}.`,
      larger: (p, g) => `You took zero days more often than ${p}% of ${g}.`,
      share: 'fewer zero days than',
      card: g => `of ${g} took zero days more often`
    },
    {
      field: 'overallEnjoymentRating', better: 'larger',
      smaller: (p, g) => `You enjoyed your hike less than ${p}% of ${g}.`,
      larger: (p, g) => `You enjoyed your hike more than ${p}% of ${g}.`,
      share: 'enjoyed it more than',
      card: g => `of ${g} rated their hike lower`
    },
    {
      field: 'hoursSleepPerNight', better: 'larger',
      smaller: (p, g) => `You slept less than ${p}% of ${g}.`,
      larger: (p, g) => `You slept more than ${p}% of ${g}.`,
      share: 'more sleep than',
      card: g => `of ${g} slept less`
    },
    {
      field: 'sleepQualityRating', better: 'larger',
      smaller: (p, g) => `You rated your sleep worse than ${p}% of ${g}.`,
      larger: (p, g) => `You rated your sleep better than ${p}% of ${g}.`,
      share: 'better sleep than',
      card: g => `of ${g} rated their sleep lower`
    },
    {
      field: 'spendingPerDay', value: spendingPerDay, better: 'smaller',
      smaller: (p, g) => `You spent less per day than ${p}% of ${g}.`,
      larger: (p, g) => `You spent more per day than ${p}% of ${g}.`,
      share: 'spent less per day than',
      card: g => `of ${g} spent more per day`
    },
    {
      field: 'consideredQuitting', value: quittingLevel, better: 'smaller',
      smaller: (p, g) => `You thought about quitting less often than ${p}% of ${g}.`,
      larger: (p, g) => `You thought about quitting more often than ${p}% of ${g}.`,
      share: 'thought about quitting less than',
      card: g => `of ${g} thought about quitting more often`
    }
  ];

  // How many comparisons the share card and text show.
  const HIGHLIGHTS = 3;

  // Every field the comparisons and the "every answer" table read from other hikers.
  const COMPARISON_FIELDS = ['trail', 'baseWeightLbs', 'averageDailyMiles', 'totalDistanceMiles', 'overallEnjoymentRating', 'totalZeroDays', 'daysOnTrail',
    'hoursSleepPerNight', 'sleepQualityRating', 'trailSpending', 'budgetCurrency', 'consideredQuitting',
    'totalElevationGainFt', 'week1DailyMiles', 'totalNeroDays', 'maxHeavyLoadLbs', 'shoePairsUsed', 'gearCost', 'averageCalories',
    'preTrailFitnessRating', 'percentHikingAlone', 'painkillerUse', 'preTrailWeightLbs', 'postTrailWeightLbs'];

  /**
   * Compares one record with other hikers: the same trail when there are
   * enough of them, otherwise everyone. Returns null when there are too few
   * peers to say anything meaningful.
   *
   * `items` (results page): every comparison in its real direction, strongest
   * first, each with `text`. `highlights` (share card and text): the hiker's
   * best HIGHLIGHTS categories by the share of peers they did better than,
   * whatever that share is, each with `percent`, `cardLine` and
   * `shareFirst` / `shareThen` (share text: "lighter pack than 75% of PCT hikers", then "faster than 67%").
   * Peers with the same value count for neither side.
   *
   * @returns {{ group, groupSingular, peerNoun, peerCount, items: object[], highlights: object[] } | null}
   */
  function compareToPeers(record, others) {
    // The "Other" choices (any region) are many different trails: compared with everyone.
    const name = Schema.trailName(record.trail);
    const sameTrail = name ? others.filter(d => d.trail === record.trail) : [];
    // group: "70% of PCT hikers" / "70% of all hikers"; peerNoun: "compared with 112 other PCT hikers" / "300 other hikers".
    let peers;
    let group;
    let groupSingular;
    let peerNoun;
    const sameTrailGroup = sameTrail.length >= MIN_TRAIL_PEERS;
    if (sameTrailGroup) {
      peers = sameTrail;
      group = peerNoun = `${name} hikers`;
      groupSingular = `${name} hiker`;
    } else if (others.length >= MIN_PEERS) {
      peers = others;
      group = 'all hikers';
      groupSingular = 'hiker';
      peerNoun = 'hikers';
    } else {
      return null;
    }

    const items = [];
    const candidates = [];
    COMPARISONS.forEach(c => {
      if (c.sameTrailOnly && !sameTrailGroup) return;
      const read = c.value || (d => d[c.field]);
      const mine = read(record);
      if (typeof mine !== 'number' || !Number.isFinite(mine)) return;
      const values = peers.map(read).filter(v => typeof v === 'number' && Number.isFinite(v));
      if (values.length < (sameTrailGroup ? MIN_TRAIL_PEERS : MIN_PEERS)) return;

      const above = percent(values.filter(v => v > mine).length, values.length);
      const below = percent(values.filter(v => v < mine).length, values.length);
      if (above >= below && above > 0) items.push({ field: c.field, percent: above, text: c.smaller(above, group) });
      else if (below > above) items.push({ field: c.field, percent: below, text: c.larger(below, group) });

      const p = c.better === 'smaller' ? above : below;
      candidates.push({
        field: c.field,
        percent: p,
        cardLine: c.card(group),
        shareFirst: `${c.share} ${p === 100 ? `every other ${groupSingular}` : `${p}% of ${group}`}`,
        shareThen: `${c.share} ${p === 100 ? 'all' : `${p}%`}`
      });
    });

    items.sort((a, b) => b.percent - a.percent);
    // Stable sort: equal shares keep the order of COMPARISONS.
    const highlights = candidates.sort((a, b) => b.percent - a.percent).slice(0, HIGHLIGHTS);
    return candidates.length ? { group, groupSingular, peerNoun, peerCount: peers.length, items, highlights } : null;
  }

  // --- Every answer compared: the table on the thank-you page ------------------

  const PAINKILLER_ORDER = ['never', 'sometimes', 'daily'];
  const ordinal = (field, order) => d => { const i = order.indexOf(d[field]); return i === -1 ? null : i; };
  const per100Days = field => d => (d.daysOnTrail && typeof d[field] === 'number' ? (d[field] / d.daysOnTrail) * 100 : null);
  const toUsd = (amount, currency) => (currency === 'EUR' ? amount * EUR_TO_USD : amount);
  const weightChange = d => (typeof d.postTrailWeightLbs === 'number' && typeof d.preTrailWeightLbs === 'number' ? d.postTrailWeightLbs - d.preTrailWeightLbs : null);

  function money(amount, currency) {
    if (typeof amount !== 'number') return null;
    const n = Math.round(amount).toLocaleString('en-US');
    return currency === 'EUR' ? `€${n}` : `$${n}`;
  }

  /**
   * The rows of the "every answer" table: each numeric answer, compared with
   * the same trail and with everyone. `value` reads the compared number
   * (default: the field), `words` phrase a lower / higher value, and `show`
   * writes the hiker's own answer (in their units and currency).
   */
  const TABLE_ROWS = [
    { key: 'totalDistanceMiles', label: 'Total distance', words: ['Shorter than', 'Longer than'], unit: 'mi' },
    { key: 'daysOnTrail', label: 'Days on trail', words: ['Fewer days than', 'More days than'], show: d => (d.daysOnTrail ? `${d.daysOnTrail} days` : null) },
    { key: 'totalElevationGainFt', label: 'Elevation gain', words: ['Less climbing than', 'More climbing than'], unit: 'ft' },
    { key: 'averageDailyMiles', label: 'Average daily distance', words: ['Slower than', 'Faster than'], unit: 'mi/day' },
    { key: 'week1DailyMiles', label: 'First-week daily distance', words: ['Slower start than', 'Faster start than'], unit: 'mi/day' },
    { key: 'zeroDaysPer100', label: 'Zero days per 100 days', value: per100Days('totalZeroDays'), words: ['Fewer than', 'More than'] },
    { key: 'neroDaysPer100', label: 'Nero days per 100 days', value: per100Days('totalNeroDays'), words: ['Fewer than', 'More than'] },
    { key: 'baseWeightLbs', label: 'Base weight', words: ['Lighter than', 'Heavier than'], unit: 'lb' },
    { key: 'maxHeavyLoadLbs', label: 'Heaviest pack', words: ['Lighter than', 'Heavier than'], unit: 'lb' },
    { key: 'shoePairsUsed', label: 'Pairs of shoes', words: ['Fewer than', 'More than'] },
    {
      key: 'gearCost', label: 'Gear cost', words: ['Cheaper than', 'More expensive than'],
      value: d => (typeof d.gearCost === 'number' ? toUsd(d.gearCost, d.budgetCurrency) : null),
      show: d => money(d.gearCost, d.budgetCurrency)
    },
    {
      key: 'spendingPerDay', label: 'Spent per day on trail', words: ['Less than', 'More than'], value: spendingPerDay,
      show: d => (typeof d.trailSpending === 'number' && d.daysOnTrail ? money(d.trailSpending / d.daysOnTrail, d.budgetCurrency) : null)
    },
    { key: 'averageCalories', label: 'Calories per day', words: ['Fewer than', 'More than'] },
    { key: 'hoursSleepPerNight', label: 'Hours of sleep per night', words: ['Less than', 'More than'], show: d => (typeof d.hoursSleepPerNight === 'number' ? `${d.hoursSleepPerNight} h` : null) },
    { key: 'sleepQualityRating', label: 'Sleep quality', words: ['Worse than', 'Better than'], suffix: ' / 10' },
    { key: 'preTrailFitnessRating', label: 'Fitness before the hike', words: ['Lower than', 'Higher than'], suffix: ' / 10' },
    { key: 'percentHikingAlone', label: 'Time hiking alone', words: ['Less than', 'More than'], suffix: '%' },
    {
      key: 'consideredQuitting', label: 'Thoughts of quitting', words: ['Less often than', 'More often than'], value: quittingLevel,
      show: d => ({ never: 'Never', once_or_twice: 'Once or twice', several_times: 'Several times', almost_constantly: 'Almost constantly' })[d.consideredQuitting] || null
    },
    {
      key: 'painkillerUse', label: 'Painkiller use', words: ['Less often than', 'More often than'], value: ordinal('painkillerUse', PAINKILLER_ORDER),
      show: d => ({ never: 'Never', sometimes: 'Sometimes', daily: 'Daily' })[d.painkillerUse] || null
    },
    {
      key: 'weightChange', label: 'Body weight change', words: ['Lost more than', 'Lost less than'], value: weightChange,
      show: (d, metric) => {
        const v = weightChange(d);
        if (v === null) return null;
        return `${v > 0 ? '+' : ''}${metric ? `${round1(v * 0.45359237)} kg` : `${round1(v)} lb`}`;
      }
    },
    { key: 'overallEnjoymentRating', label: 'Enjoyment', words: ['Lower than', 'Higher than'], suffix: ' / 10' }
  ];

  /** The hiker's own answer for a table row, in their units; null if not answered or "Don't know". */
  function tableValueText(row, record, unitSystem) {
    const metric = unitSystem === 'metric';
    if (row.show) return row.show(record, metric);
    const v = row.value ? row.value(record) : record[row.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    if (row.unit) {
      const u = Schema.UNITS[row.unit];
      return metric ? `${round1(v * u.factor).toLocaleString('en-US')} ${u.metric}` : `${round1(v).toLocaleString('en-US')} ${u.label}`;
    }
    return `${round1(v).toLocaleString('en-US')}${row.suffix || ''}`;
  }

  /** One cell: { percent, lower } or { status: 'few' | 'same' }; null when the hiker has no value. */
  function tableCell(read, mine, group, min) {
    if (typeof mine !== 'number' || !Number.isFinite(mine)) return null;
    const values = group.map(read).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (values.length < min) return { status: 'few' };
    const above = percent(values.filter(v => v > mine).length, values.length);
    const below = percent(values.filter(v => v < mine).length, values.length);
    if (!above && !below) return { status: 'same' };
    return above >= below ? { percent: above, lower: true } : { percent: below, lower: false };
  }

  /** The words for a cell: "Lighter than 70%", "Same as everyone", "Not enough hikers yet" or "–". */
  function tableCellText(row, cell) {
    if (!cell) return '–';
    if (cell.status === 'few') return 'Not enough hikers yet';
    if (cell.status === 'same') return 'Same as everyone';
    return `${row.words[cell.lower ? 0 : 1]} ${cell.percent}%`;
  }

  /**
   * Every answer compared with the same trail and with everyone, for the
   * "How you compare on every answer" table. The trail column is null for the
   * "Other" trails. Peers with the same value count for neither side.
   */
  function compareAll(record, others) {
    const name = Schema.trailName(record.trail);
    const sameTrail = name ? others.filter(d => d.trail === record.trail) : null;
    const rows = TABLE_ROWS.map(row => {
      const read = row.value || (d => d[row.key]);
      const mine = read(record);
      return {
        key: row.key,
        trail: sameTrail ? tableCell(read, mine, sameTrail, MIN_TRAIL_PEERS) : null,
        all: tableCell(read, mine, others, MIN_PEERS)
      };
    });
    return { trailName: name, trailCount: sameTrail ? sameTrail.length : null, allCount: others.length, rows };
  }

  // --- Share text -------------------------------------------------------------


  function hikeNoun(record) {
    if (record.completionStatus === 'section_hike') return 'section hike';
    if (record.completionStatus === 'quit_early') return 'hike';
    return 'thru-hike';
  }

  /**
   * The text shared with "Share Survey with Tramily": short, and written to
   * sound like a person, not a bot (no emoji, hashtags or exclamation marks).
   * Once there are enough peers it names the hiker's best three comparisons,
   * like the card. The link is added separately.
   */
  function buildShareText(record, comparison) {
    const trail = Schema.trailName(record.trail);
    const hike = `my ${record.hikeYear} ${trail ? trail + ' ' : ''}${hikeNoun(record)}`;

    const highlights = (comparison && comparison.highlights) || [];
    if (highlights.length) {
      // "a", "a and b", "a, b and c"
      const phrases = highlights.map((item, i) => (i === 0 ? item.shareFirst : item.shareThen));
      const facts = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
      return `Just added ${hike} to Open Trail Science: ${facts}. How does yours compare?`;
    }

    // Enough peers but nothing the hiker answered to compare with: still about comparing.
    if (comparison) {
      return `Just added ${hike} to Open Trail Science and compared it with ${comparison.peerCount} other ${comparison.peerNoun}. How does yours compare?`;
    }

    return `Just added ${hike} to Open Trail Science. It's an open dataset for every long trail, open all year. Have you hiked one?`;
  }


  return { computeStats, compareToPeers, buildShareText, STATS_FIELDS, BREAKDOWN_FIELDS, COMPARISON_FIELDS, HIGHLIGHTS, MIN_TRAIL_PEERS, MIN_PEERS,
    compareAll, TABLE_ROWS, tableValueText, tableCellText };
});
