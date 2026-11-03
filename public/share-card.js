/**
 * Draws the personal share card (1080x1350 PNG, the 4:5 portrait size that
 * works in WhatsApp, Instagram and most feeds) shown after submitting.
 *
 * With comparisons it shows every one of them ("89% of PCT hikers carried a
 * heavier pack"); otherwise it shows the hiker's own numbers.
 * Everything happens in the browser; nothing is uploaded.
 *
 *   ShareCard.render(record, comparison, { unitSystem }) -> Promise<Blob>
 */
(function () {
  'use strict';

  const W = 1080;
  const H = 1350;
  // The card face sits on the page color with the design's offset shadow.
  const CARD = { x: 54, y: 54, w: W - 108 - 18, h: H - 108 - 18, shadow: 18, radius: 24, line: 5 };
  const PAD = 130;
  const FONT = '"IBM Plex Sans", -apple-system, "Segoe UI", sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, monospace';
  // The site's light theme and two of its accents.
  const C = {
    page: '#f2f2ef', card: '#ffffff', ink: '#181b1f', text: '#3c4248', muted: '#555c63',
    green: '#1f4f8f', terracotta: '#b4572d', blue: '#1f4f8f', soft: '#cdd0d4', sage: '#3e6f57', ochre: '#7a5a12'
  };

  function hikeNoun(record) {
    if (record.completionStatus === 'section_hike') return 'section hike';
    if (record.completionStatus === 'quit_early') return 'hike';
    return 'thru-hike';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Draws `text` wrapped to `maxWidth`; returns the y below the last line. */
  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    let line = '';
    text.split(' ').forEach(word => {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    });
    ctx.fillText(line, x, y);
    return y + lineHeight;
  }

  function drawBackground(ctx) {
    ctx.fillStyle = C.page;
    ctx.fillRect(0, 0, W, H);
    roundRect(ctx, CARD.x + CARD.shadow, CARD.y + CARD.shadow, CARD.w, CARD.h, CARD.radius);
    ctx.fillStyle = C.ink;
    ctx.fill();
    roundRect(ctx, CARD.x, CARD.y, CARD.w, CARD.h, CARD.radius);
    ctx.fillStyle = C.card;
    ctx.fill();
    ctx.lineWidth = CARD.line;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
  }

  /** The cairn logo (img/cairn-logo.svg), or nothing if it can't be loaded. */
  async function loadLogo() {
    try {
      const img = new Image();
      img.src = new URL('img/cairn-logo.svg', document.baseURI).href;
      await img.decode();
      return img;
    } catch (err) {
      return null;
    }
  }

  function drawBrand(ctx, logo) {
    const y = PAD - 10;
    if (logo) ctx.drawImage(logo, PAD - 6, y, 84, 84);
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 36px ${FONT}`;
    ctx.fillStyle = C.ink;
    ctx.fillText('OPEN TRAIL SCIENCE', PAD + (logo ? 96 : 0), y + 56);
  }

  function drawHeadline(ctx, record) {
    const trail = window.SurveySchema.trailName(record.trail) || 'long-distance';
    const noun = hikeNoun(record);
    const maxWidth = W - 2 * PAD;
    ctx.font = `700 76px ${FONT}`;
    ctx.fillStyle = C.ink;
    // "My 2025 PCT" above "thru-hike"; when a long trail name wraps anyway, the
    // hike type follows on its last line if it fits ("…Mont Blanc hike").
    const lines = [];
    `My ${record.hikeYear} ${trail}`.split(' ').forEach(word => {
      const last = lines[lines.length - 1];
      if (last && ctx.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    });
    lines.forEach((line, i) => ctx.fillText(line, PAD, 340 + i * 86));
    const lastY = 340 + (lines.length - 1) * 86;
    const last = lines[lines.length - 1];
    ctx.fillStyle = C.green;
    if (lines.length > 1 && ctx.measureText(`${last} ${noun}`).width <= maxWidth) {
      ctx.fillText(noun, PAD + ctx.measureText(`${last} `).width, lastY);
      return lastY + 40;
    }
    ctx.fillText(noun, PAD, lastY + 86);
    return lastY + 86 + 40;
  }

  const PERCENT_COLORS = [C.terracotta, C.blue, C.sage, C.ochre];
  const FOOTER_Y = 1120;

  /** One or two comparisons: big percentages. Three or four: compact rows, percentage beside its line. */
  function drawComparisons(ctx, items, y) {
    if (items.length <= 2) {
      y += 50;
      items.forEach((item, i) => {
        ctx.font = `700 128px ${FONT}`;
        ctx.fillStyle = PERCENT_COLORS[i];
        ctx.fillText(`${item.percent}%`, PAD, y + 112);
        ctx.font = `500 38px ${FONT}`;
        ctx.fillStyle = C.text;
        y = wrapText(ctx, item.cardLine, PAD + 4, y + 168, W - 2 * PAD, 48) + 66;
      });
      return y;
    }
    const top = y + 10;
    const rowH = Math.min(165, (FOOTER_Y - 40 - top) / items.length);
    const percentFont = `700 ${Math.round(rowH * 0.56)}px ${FONT}`;
    ctx.font = percentFont;
    const numW = Math.max(...items.map(item => ctx.measureText(`${item.percent}%`).width)) + 36;
    items.forEach((item, i) => {
      const mid = top + i * rowH + rowH / 2;
      ctx.font = percentFont;
      ctx.fillStyle = PERCENT_COLORS[i];
      ctx.textBaseline = 'middle';
      ctx.fillText(`${item.percent}%`, PAD, mid);
      ctx.font = `500 36px ${FONT}`;
      ctx.fillStyle = C.text;
      // Up to two lines, centered on the percentage.
      const words = item.cardLine.split(' ');
      const maxW = W - 2 * PAD - numW - 18;
      let first = '';
      while (words.length && ctx.measureText(first ? `${first} ${words[0]}` : words[0]).width <= maxW) first = first ? `${first} ${words.shift()}` : words.shift();
      const lines = words.length ? [first, words.join(' ')] : [first];
      lines.forEach((line, j) => ctx.fillText(line, PAD + numW, mid + (j - (lines.length - 1) / 2) * 44));
      ctx.textBaseline = 'alphabetic';
    });
    return top + items.length * rowH;
  }

  function formatStats(record, unitSystem) {
    const metric = unitSystem === 'metric';
    const num = v => Math.round(v * 10) / 10;
    const stats = [];
    if (typeof record.baseWeightLbs === 'number') {
      stats.push(['Base weight', metric ? `${num(record.baseWeightLbs * 0.45359237)} kg` : `${num(record.baseWeightLbs)} lb`]);
    }
    if (typeof record.averageDailyMiles === 'number') {
      stats.push(['Daily pace', metric ? `${num(record.averageDailyMiles * 1.60934)} km` : `${num(record.averageDailyMiles)} mi`]);
    }
    if (typeof record.totalZeroDays === 'number') stats.push(['Zero days', String(record.totalZeroDays)]);
    if (typeof record.overallEnjoymentRating === 'number') stats.push(['Enjoyment', `${record.overallEnjoymentRating}/10`]);
    return stats;
  }

  function drawStatsGrid(ctx, record, unitSystem, y) {
    const stats = formatStats(record, unitSystem);
    const gap = 28;
    const boxW = (W - 2 * PAD - gap) / 2;
    const boxH = 180;
    stats.forEach(([label, value], i) => {
      const x = PAD + (i % 2) * (boxW + gap);
      const by = y + Math.floor(i / 2) * (boxH + gap);
      roundRect(ctx, x, by, boxW, boxH, 24);
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.soft;
      ctx.stroke();
      ctx.font = `600 28px ${FONT}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(label, x + 32, by + 60);
      ctx.font = `500 60px ${MONO}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(value, x + 32, by + 138);
    });
    return y + Math.ceil(stats.length / 2) * (boxH + gap);
  }

  function drawFooter(ctx) {
    const lineY = FOOTER_Y;
    ctx.fillStyle = C.ink;
    ctx.fillRect(PAD, lineY, W - 2 * PAD - 18, CARD.line);
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText('How does yours compare?', PAD, lineY + 76);
    ctx.font = `500 32px ${MONO}`;
    ctx.fillStyle = C.blue;
    ctx.fillText('opentrailscience.org', PAD, lineY + 128);
  }

  async function render(record, comparison, options) {
    const unitSystem = (options && options.unitSystem) || 'imperial';
    // Canvas only uses web fonts that are already loaded.
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load(`700 76px ${FONT}`),
        document.fonts.load(`500 38px ${FONT}`),
        document.fonts.load(`600 28px ${FONT}`),
        document.fonts.load(`500 60px ${MONO}`),
        document.fonts.load(`500 32px ${MONO}`)
      ]).catch(() => {});
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    drawBackground(ctx);
    drawBrand(ctx, await loadLogo());
    let y = drawHeadline(ctx, record);

    const items = (comparison && comparison.items) || [];
    if (items.length) {
      drawComparisons(ctx, items, y);
    } else {
      y = drawStatsGrid(ctx, record, unitSystem, y + 30);
      if (comparison) {
        ctx.font = `500 30px ${FONT}`;
        ctx.fillStyle = C.muted;
        ctx.fillText(`Compared with ${comparison.peerCount} other ${comparison.group.replace(' in the dataset', '')}`, PAD, y + 30);
      }
    }
    drawFooter(ctx);

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not create share card'))), 'image/png');
    });
  }

  window.ShareCard = { render, WIDTH: W, HEIGHT: H };
})();
