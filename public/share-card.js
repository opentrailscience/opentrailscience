/**
 * Draws the personal share card (1080x1350 PNG, the 4:5 portrait size that
 * works in WhatsApp, Instagram and most feeds) shown after submitting.
 *
 * With comparisons it leads with the big percentages ("89% of PCT hikers
 * carried a heavier pack"); otherwise it shows the hiker's own numbers.
 * Everything happens in the browser; nothing is uploaded.
 *
 *   ShareCard.render(record, comparison, { unitSystem }) -> Promise<Blob>
 */
(function () {
  'use strict';

  const W = 1080;
  const H = 1350;
  const PAD = 90;
  const FONT = '"IBM Plex Sans", -apple-system, "Segoe UI", sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, monospace';
  // The site's light theme.
  const C = {
    bg: '#ffffff', ink: '#15181c', text: '#3f454c', muted: '#5b626b',
    brand: '#1f4f8f', box: '#f7f8f9', border: '#d3d7dc', ridgeBack: '#e3e8ef', ridgeFront: '#d2dbe7'
  };
  // Same threshold as the share text: weaker results are not bragged about.
  const MIN_PERCENT = window.SurveyStats.MIN_SHARE_PERCENT;

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
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // The blue band along the top of the site's header.
    ctx.fillStyle = C.brand;
    ctx.fillRect(0, 0, W, 14);
    // Mountain ridges along the bottom.
    const ridge = (points, color) => {
      ctx.beginPath();
      ctx.moveTo(0, H);
      points.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    ridge([[0, 1150], [150, 1060], [260, 1120], [410, 1010], [560, 1130], [690, 1060], [820, 1140], [960, 1040], [1080, 1100]], C.ridgeBack);
    ridge([[0, 1220], [190, 1150], [320, 1205], [490, 1120], [640, 1210], [800, 1140], [950, 1215], [1080, 1170]], C.ridgeFront);
  }

  function drawBrand(ctx) {
    const y = PAD;
    roundRect(ctx, PAD, y, 84, 84, 6);
    ctx.fillStyle = C.brand;
    ctx.fill();

    // Logo mark (the site's mountain icon, 24x24 path scaled).
    ctx.save();
    ctx.translate(PAD + 18, y + 18);
    ctx.scale(2, 2);
    ctx.beginPath();
    ctx.moveTo(8, 3); ctx.lineTo(12, 11); ctx.lineTo(17, 6); ctx.lineTo(22, 21); ctx.lineTo(2, 21); ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 40px ${FONT}`;
    ctx.fillStyle = C.ink;
    ctx.fillText('OPEN TRAIL', PAD + 110, y + 44);
    const w = ctx.measureText('OPEN TRAIL ').width;
    ctx.fillStyle = C.brand;
    ctx.fillText('SCIENCE', PAD + 110 + w, y + 44);
    ctx.font = `400 24px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText('Thru-Hiker Survey', PAD + 111, y + 78);
  }

  function drawHeadline(ctx, record) {
    const trail = window.SurveySchema.trailName(record.trail) || 'long-distance';
    ctx.font = `600 76px ${FONT}`;
    ctx.fillStyle = C.ink;
    let y = wrapText(ctx, `My ${record.hikeYear} ${trail}`, PAD, 330, W - 2 * PAD, 86);
    ctx.fillStyle = C.brand;
    ctx.fillText(hikeNoun(record), PAD, y);
    return y + 40;
  }

  function drawComparisons(ctx, items, y) {
    y += 60;
    items.forEach(item => {
      ctx.font = `600 128px ${FONT}`;
      ctx.fillStyle = C.brand;
      ctx.fillText(`${item.percent}%`, PAD, y + 112);
      ctx.font = `500 38px ${FONT}`;
      ctx.fillStyle = C.text;
      y = wrapText(ctx, item.cardLine, PAD + 4, y + 168, W - 2 * PAD, 48) + 76;
    });
    return y;
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
    const gap = 30;
    const boxW = (W - 2 * PAD - gap) / 2;
    const boxH = 190;
    stats.forEach(([label, value], i) => {
      const x = PAD + (i % 2) * (boxW + gap);
      const by = y + Math.floor(i / 2) * (boxH + gap);
      roundRect(ctx, x, by, boxW, boxH, 6);
      ctx.fillStyle = C.box;
      ctx.fill();
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `500 28px ${FONT}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(label, x + 36, by + 64);
      ctx.font = `600 64px ${FONT}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(value, x + 36, by + 148);
    });
    return y + Math.ceil(stats.length / 2) * (boxH + gap);
  }

  function drawFooter(ctx) {
    ctx.font = `600 50px ${FONT}`;
    ctx.fillStyle = C.ink;
    ctx.fillText('How does yours compare?', PAD, 1145);
    ctx.font = `500 34px ${MONO}`;
    ctx.fillStyle = C.brand;
    ctx.fillText('opentrailscience.org', PAD, 1205);
  }

  async function render(record, comparison, options) {
    const unitSystem = (options && options.unitSystem) || 'imperial';
    // Canvas only uses web fonts that are already loaded.
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load(`600 76px ${FONT}`),
        document.fonts.load(`500 38px ${FONT}`),
        document.fonts.load(`400 24px ${FONT}`),
        document.fonts.load(`500 34px ${MONO}`)
      ]).catch(() => {});
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    drawBackground(ctx);
    drawBrand(ctx);
    let y = drawHeadline(ctx, record);

    const brags = ((comparison && comparison.items) || []).filter(i => i.brag && i.percent >= MIN_PERCENT);
    if (brags.length) {
      // The two strongest, like the share text; a third would crowd the footer.
      drawComparisons(ctx, brags.slice(0, 2), y);
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
