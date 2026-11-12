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

  // Below this many peers a percentage would be noise, so none is shown: 5 on the
  // same trail (like the Insights charts), 10 when compared with everyone.
  const MIN_TRAIL_PEERS = 5;
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
   *   share             first-person phrase for the share text, given "89% of PCT hikers"
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
      share: who => `my pack was lighter than ${who}`,
      card: g => `of ${g} carried a heavier pack`
    },
    {
      field: 'averageDailyMiles', better: 'larger', sameTrailOnly: true,
      smaller: (p, g) => `Your average pace was slower than ${p}% of ${g}.`,
      larger: (p, g) => `Your average pace was faster than ${p}% of ${g}.`,
      share: who => `I hiked faster than ${who}`,
      card: g => `of ${g} hiked a slower pace`
    },
    {
      field: 'totalDistanceMiles', better: 'larger', sameTrailOnly: true,
      smaller: (p, g) => `You hiked fewer miles than ${p}% of ${g}.`,
      larger: (p, g) => `You hiked further than ${p}% of ${g}.`,
      share: who => `I hiked further than ${who}`,
      card: g => `of ${g} hiked fewer miles`
    },
    {
      field: 'zeroDayRate', value: zeroDayRate, better: 'smaller',
      smaller: (p, g) => `You took zero days less often than ${p}% of ${g}.`,
      larger: (p, g) => `You took zero days more often than ${p}% of ${g}.`,
      share: who => `I took zero days less often than ${who}`,
      card: g => `of ${g} took zero days more often`
    },
    {
      field: 'overallEnjoymentRating', better: 'larger',
      smaller: (p, g) => `You enjoyed your hike less than ${p}% of ${g}.`,
      larger: (p, g) => `You enjoyed your hike more than ${p}% of ${g}.`,
      share: who => `I enjoyed it more than ${who}`,
      card: g => `of ${g} rated their hike lower`
    },
    {
      field: 'hoursSleepPerNight', better: 'larger',
      smaller: (p, g) => `You slept less than ${p}% of ${g}.`,
      larger: (p, g) => `You slept more than ${p}% of ${g}.`,
      share: who => `I slept more than ${who}`,
      card: g => `of ${g} slept less`
    },
    {
      field: 'sleepQualityRating', better: 'larger',
      smaller: (p, g) => `You rated your sleep worse than ${p}% of ${g}.`,
      larger: (p, g) => `You rated your sleep better than ${p}% of ${g}.`,
      share: who => `I slept better than ${who}`,
      card: g => `of ${g} rated their sleep lower`
    },
    {
      field: 'spendingPerDay', value: spendingPerDay, better: 'smaller',
      smaller: (p, g) => `You spent less per day than ${p}% of ${g}.`,
      larger: (p, g) => `You spent more per day than ${p}% of ${g}.`,
      share: who => `I spent less per day than ${who}`,
      card: g => `of ${g} spent more per day`
    },
    {
      field: 'consideredQuitting', value: quittingLevel, better: 'smaller',
      smaller: (p, g) => `You thought about quitting less often than ${p}% of ${g}.`,
      larger: (p, g) => `You thought about quitting more often than ${p}% of ${g}.`,
      share: who => `I thought about quitting less often than ${who}`,
      card: g => `of ${g} thought about quitting more often`
    }
  ];

  // How many comparisons the share card and text show.
  const HIGHLIGHTS = 3;

  const COMPARISON_FIELDS = ['trail', 'baseWeightLbs', 'averageDailyMiles', 'totalDistanceMiles', 'overallEnjoymentRating', 'totalZeroDays', 'daysOnTrail',
    'hoursSleepPerNight', 'sleepQualityRating', 'trailSpending', 'budgetCurrency', 'consideredQuitting'];

  /**
   * Compares one record with other hikers: the same trail when there are
   * enough of them, otherwise everyone. Returns null when there are too few
   * peers to say anything meaningful.
   *
   * `items` (results page): every comparison in its real direction, strongest
   * first, each with `text`. `highlights` (share card and text): the hiker's
   * best HIGHLIGHTS categories by the share of peers they did better than,
   * whatever that share is, each with `percent`, `cardLine` and
   * `shareFirst` / `shareThen` (share text, as first or later clause).
   * Peers with the same value count for neither side.
   *
   * @returns {{ group, groupSingular, peerCount, items: object[], highlights: object[] } | null}
   */
  function compareToPeers(record, others) {
    // The "Other" choices (any region) are many different trails: compared with everyone.
    const name = Schema.trailName(record.trail);
    const sameTrail = name ? others.filter(d => d.trail === record.trail) : [];
    let peers;
    let group;
    let groupSingular;
    const sameTrailGroup = sameTrail.length >= MIN_TRAIL_PEERS;
    if (sameTrailGroup) {
      peers = sameTrail;
      group = `${name} hikers`;
      groupSingular = `${name} hiker`;
    } else if (others.length >= MIN_PEERS) {
      peers = others;
      group = 'hikers in the dataset';
      groupSingular = 'hiker in the dataset';
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
        shareFirst: c.share(p === 100 ? `every other ${groupSingular}` : `${p}% of ${group}`),
        shareThen: c.share(p === 100 ? 'all of them' : `${p}% of them`)
      });
    });

    items.sort((a, b) => b.percent - a.percent);
    // Stable sort: equal shares keep the order of COMPARISONS.
    const highlights = candidates.sort((a, b) => b.percent - a.percent).slice(0, HIGHLIGHTS);
    return candidates.length ? { group, groupSingular, peerCount: peers.length, items, highlights } : null;
  }

  // --- Share text -------------------------------------------------------------


  function hikeNoun(record) {
    if (record.completionStatus === 'section_hike') return 'section hike';
    if (record.completionStatus === 'quit_early') return 'hike';
    return 'thru-hike';
  }

  function formatWeight(lbs, unitSystem) {
    return unitSystem === 'metric' ? `${round1(lbs * 0.45359237)} kg` : `${round1(lbs)} lb`;
  }

  function formatPace(miPerDay, unitSystem) {
    return unitSystem === 'metric' ? `${round1(miPerDay * 1.60934)} km a day` : `${round1(miPerDay)} miles a day`;
  }

  /**
   * The text shared with "Share Survey with Tramily". Written to sound like a
   * person, not a bot: no emoji, hashtags or exclamation marks. Once there
   * are enough peers it names the hiker's best three comparisons, like the card.
   * Before that it mentions two of the hiker's own numbers. The link is
   * added separately.
   */
  function buildShareText(record, comparison, options) {
    const unitSystem = (options && options.unitSystem) || 'imperial';
    const trail = Schema.trailName(record.trail);
    const hike = `my ${record.hikeYear} ${trail ? trail + ' ' : ''}${hikeNoun(record)}`;
    const intro = `Just added ${hike} to Open Trail Science.`;

    const highlights = (comparison && comparison.highlights) || [];
    if (highlights.length) {
      // "a", "a, and b", "a, b, and c"
      const phrases = highlights.map((item, i) => (i === 0 ? item.shareFirst : item.shareThen));
      const facts = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
      return `${intro} Turns out ${facts}. How does yours compare?`;
    }

    // Enough peers but nothing the hiker answered to compare with: still about comparing.
    if (comparison) {
      return `Just added ${hike} to Open Trail Science and saw how it stacks up against ` +
        `${comparison.peerCount} other ${comparison.group.replace(' in the dataset', '')}. How does yours compare?`;
    }

    const numbers = [];
    if (typeof record.baseWeightLbs === 'number') numbers.push(`${formatWeight(record.baseWeightLbs, unitSystem)} base weight`);
    if (typeof record.averageDailyMiles === 'number') numbers.push(formatPace(record.averageDailyMiles, unitSystem));
    const intro2 = numbers.length ? `Just added ${hike} (${numbers.join(', ')}) to Open Trail Science.` : intro;
    return `${intro2} It's an open dataset for every long trail, open all year. Have you hiked one?`;
  }

  return { computeStats, compareToPeers, buildShareText, STATS_FIELDS, BREAKDOWN_FIELDS, COMPARISON_FIELDS, HIGHLIGHTS, MIN_TRAIL_PEERS, MIN_PEERS };
});
