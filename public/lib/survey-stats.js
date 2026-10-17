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

  // Below this many peers a percentage would be noise, so none is shown.
  const MIN_PEERS = 10;

  /** Zero days per day on trail, so short and long hikes compare fairly. */
  function zeroDayRate(d) {
    return d.daysOnTrail && typeof d.totalZeroDays === 'number' ? d.totalZeroDays / d.daysOnTrail : null;
  }

  /**
   * Each comparison phrases the hiker's value against the share of peers it
   * beats. `value` reads the compared number (default: the field).
   * `smaller` applies when the value is below most peers, `larger` when
   * above; a missing direction is never shown. Per direction:
   *   text   sentence on the results page
   *   brag   whether it is flattering enough to put in the share text / card
   *   share  first-person phrase for the share text, given "89% of PCT hikers"
   *   card   caption under the big percentage on the share card
   * `sameTrailOnly` comparisons are skipped when the hiker is compared with
   * everyone: pace depends too much on the trail (a hut-to-hut hike vs a
   * desert thru-hike).
   */
  const COMPARISONS = [
    {
      field: 'baseWeightLbs',
      smaller: {
        brag: true,
        text: (p, g) => `Your base weight was lighter than ${p}% of ${g}.`,
        share: who => `my pack was lighter than ${who}`,
        card: g => `of ${g} carried a heavier pack`
      },
      larger: { text: (p, g) => `Your base weight was heavier than ${p}% of ${g}.` }
    },
    {
      field: 'averageDailyMiles',
      sameTrailOnly: true,
      smaller: { text: (p, g) => `Your average pace was slower than ${p}% of ${g}.` },
      larger: {
        brag: true,
        text: (p, g) => `Your average pace was faster than ${p}% of ${g}.`,
        share: who => `I hiked faster than ${who}`,
        card: g => `of ${g} hiked a slower pace`
      }
    },
    {
      field: 'zeroDayRate',
      value: zeroDayRate,
      smaller: {
        brag: true,
        text: (p, g) => `You took zero days less often than ${p}% of ${g}.`,
        share: who => `I took zero days less often than ${who}`,
        card: g => `of ${g} took zero days more often`
      },
      larger: { text: (p, g) => `You took zero days more often than ${p}% of ${g}.` }
    },
    {
      field: 'overallEnjoymentRating',
      larger: {
        brag: true,
        text: (p, g) => `You enjoyed your hike more than ${p}% of ${g}.`,
        share: who => `I enjoyed it more than ${who}`,
        card: g => `of ${g} rated their hike lower`
      }
    }
  ];

  const COMPARISON_FIELDS = ['trail', 'baseWeightLbs', 'averageDailyMiles', 'overallEnjoymentRating', 'totalZeroDays', 'daysOnTrail'];

  /**
   * Compares one record with other hikers: the same trail when there are
   * enough of them, otherwise everyone. Returns null when there are too few
   * peers to say anything meaningful.
   *
   * Items are sorted strongest first. Each has `text` (results page); items
   * with `brag: true` also have `shareFirst` / `shareThen` (share text, as
   * first or second clause) and `cardLine` (share card).
   *
   * @returns {{ group, groupSingular, peerCount, items: object[] } | null}
   */
  function compareToPeers(record, others) {
    const sameTrail = record.trail && record.trail !== 'Other'
      ? others.filter(d => d.trail === record.trail)
      : [];
    let peers;
    let group;
    let groupSingular;
    const sameTrailGroup = sameTrail.length >= MIN_PEERS;
    if (sameTrailGroup) {
      const name = Schema.trailName(record.trail);
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
    COMPARISONS.forEach(c => {
      if (c.sameTrailOnly && !sameTrailGroup) return;
      const read = c.value || (d => d[c.field]);
      const mine = read(record);
      if (typeof mine !== 'number' || !Number.isFinite(mine)) return;
      const values = peers.map(read).filter(v => typeof v === 'number' && Number.isFinite(v));
      if (values.length < MIN_PEERS) return;

      const above = percent(values.filter(v => v > mine).length, values.length);
      const below = percent(values.filter(v => v < mine).length, values.length);
      let direction = null;
      let p = 0;
      if (above >= below && above > 0 && c.smaller) {
        direction = c.smaller;
        p = above;
      } else if (below > above && c.larger) {
        direction = c.larger;
        p = below;
      }
      if (!direction) return;

      const item = { field: c.field, percent: p, brag: !!direction.brag, text: direction.text(p, group) };
      if (direction.brag) {
        item.shareFirst = direction.share(p === 100 ? `every other ${groupSingular}` : `${p}% of ${group}`);
        item.shareThen = direction.share(p === 100 ? 'all of them' : `${p}% of them`);
        item.cardLine = direction.card(group);
      }
      items.push(item);
    });

    items.sort((a, b) => b.percent - a.percent);
    return items.length ? { group, groupSingular, peerCount: peers.length, items } : null;
  }

  // --- Share text -------------------------------------------------------------

  // Below this a comparison is not worth bragging about in the share text.
  const MIN_SHARE_PERCENT = 60;

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
   * are enough peers it is about the comparison: the (at most) two strongest
   * flattering results, or just the number of peers if none is flattering.
   * Before that it mentions two of the hiker's own numbers. The link is
   * added separately.
   */
  function buildShareText(record, comparison, options) {
    const unitSystem = (options && options.unitSystem) || 'imperial';
    const trail = Schema.trailName(record.trail);
    const hike = `my ${record.hikeYear} ${trail ? trail + ' ' : ''}${hikeNoun(record)}`;
    const intro = `Just added ${hike} to Open Trail Science.`;

    const brags = ((comparison && comparison.items) || [])
      .filter(i => i.brag && i.percent >= MIN_SHARE_PERCENT)
      .slice(0, 2);

    if (brags.length) {
      const facts = brags.length === 2
        ? `${brags[0].shareFirst}, and ${brags[1].shareThen}`
        : brags[0].shareFirst;
      return `${intro} Turns out ${facts}. How does yours compare?`;
    }

    // Enough peers but nothing flattering: still about comparing, without the numbers.
    if (comparison) {
      return `Just added ${hike} to Open Trail Science and saw how it stacks up against ` +
        `${comparison.peerCount} other ${comparison.group.replace(' in the dataset', '')}. How does yours compare?`;
    }

    const numbers = [];
    if (typeof record.baseWeightLbs === 'number') numbers.push(`${formatWeight(record.baseWeightLbs, unitSystem)} base weight`);
    if (typeof record.averageDailyMiles === 'number') numbers.push(formatPace(record.averageDailyMiles, unitSystem));
    const intro2 = numbers.length ? `Just added ${hike} (${numbers.join(', ')}) to Open Trail Science.` : intro;
    return `${intro2} It's an open dataset on how long-distance hikes really go. Have you hiked one?`;
  }

  return { computeStats, compareToPeers, buildShareText, STATS_FIELDS, BREAKDOWN_FIELDS, COMPARISON_FIELDS, MIN_PEERS, MIN_SHARE_PERCENT };
});
