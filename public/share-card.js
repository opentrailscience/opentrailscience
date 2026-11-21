/**
 * Draws the personal share card (1080x1350 PNG, the 4:5 portrait size that
 * works in WhatsApp, Instagram and most feeds) shown after submitting.
 *
 * One plain sentence ("My 2025 PCT thru-hike, out of 112 other PCT hikers."),
 * a hand-drawn cairn and the address; deliberately no logo header, big
 * two-colour headline or "how does yours compare?" hook. With comparisons each
 * stone carries one of the hiker's best three ("86%", labelled "carried a
 * heavier pack"); otherwise the stones carry the hiker's own numbers.
 * Phones show the card about 330px wide, so no text is smaller than 36px here.
 * Everything happens in the browser; nothing is uploaded.
 *
 *   ShareCard.render(record, comparison, { unitSystem }) -> Promise<Blob>
 */
(function () {
  'use strict';

  const W = 1080;
  const H = 1350;
  const M = 80; // side margin
  const FONT = '"IBM Plex Sans", -apple-system, "Segoe UI", sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, monospace';
  const C = {
    paper: '#f3f1ea', ink: '#181b1f', text: '#3c4248', blue: '#1f4f8f', pebble: '#cdd0d4'
  };
  // Stone fills from the bottom up (the design's accents), and the blank capstone.
  const STONE_FILLS = ['#e39a72', '#93b4d6', '#e5c77a', '#bba9d6'];
  const CAP_FILL = '#8db89c';
  // Small pushes so the cairn looks stacked by hand: x offset, rotation (degrees).
  const NUDGES = [[14, -0.8], [-2, 1.2], [-18, -1.5], [-30, 1.0]];

  const GROUND_Y = 1150;
  const LABEL_X = 700; // labels sit in a column right of the stones
  const CAIRN_X = 312;

  function hikeNoun(record) {
    if (record.completionStatus === 'section_hike') return 'section hike';
    if (record.completionStatus === 'quit_early') return 'hike';
    return 'thru-hike';
  }

  /** A small seeded random generator, so every card draws the same stones. */
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Outline of a sturdy stone: flat faces, rounded corners, small bumps. */
  function stonePoints(cx, cy, rx, ry, seed) {
    const rnd = random(seed);
    const n = 32;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const p = s > 0 ? 3.4 : 2.6; // flatter base than top
      const k = 1 + (rnd() - 0.5) * 0.06;
      pts.push([cx + Math.sign(c) * Math.pow(Math.abs(c), 2 / p) * rx * k, cy + Math.sign(s) * Math.pow(Math.abs(s), 2 / p) * ry * k]);
    }
    return pts;
  }

  /** A smooth closed path through the points (Catmull-Rom as Bezier curves). */
  function smoothPath(ctx, pts) {
    const n = pts.length;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    ctx.closePath();
  }

  /**
   * A chip: a shallow flake knocked off the edge at `angle` (degrees, y down):
   * the bite outline, and the broken edge inside the stone.
   */
  function chipShape(pts, cx, cy, angle, w, depth, seed) {
    const n = pts.length;
    const j = Math.round((((angle * Math.PI) / 180) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * n) % n;
    const [px, py] = pts[j];
    let tx = pts[(j + 1) % n][0] - pts[(j - 1 + n) % n][0];
    let ty = pts[(j + 1) % n][1] - pts[(j - 1 + n) % n][1];
    const len = Math.hypot(tx, ty);
    tx /= len; ty /= len;
    let nx = ty;
    let ny = -tx;
    if ((px - cx) * nx + (py - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const rnd = random(seed);
    const profile = [[-1.15, -0.5], [-0.62, 0.55 + (rnd() - 0.5) * 0.2], [-0.15, 0.95], [0.3, 1 + (rnd() - 0.7) * 0.15],
      [0.7, 0.5 + (rnd() - 0.5) * 0.2], [1.15, -0.5]];
    const edge = profile.map(([t, d]) => [px + tx * t * w - nx * (d * depth - 3), py + ty * t * w - ny * (d * depth - 3)]);
    const bite = edge.concat([[px + tx * w * 1.2 + nx * 40, py + ty * w * 1.2 + ny * 40], [px - tx * w * 1.2 + nx * 40, py - ty * w * 1.2 + ny * 40]]);
    const face = edge.slice(1, -1).map(([x, y]) => [x - nx * 8, y - ny * 8]);
    return { edge, bite, face: [edge[0]].concat(face, [edge[edge.length - 1]], edge.slice(1, -1).reverse()) };
  }

  function polyPath(ctx, pts, close) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
  }

  /** Draws one stone (on its own canvas, so a chip can cut through the outline). */
  function drawStone(ctx, stone) {
    const { cx, cy, rx, ry, rot, fill, seed, chip } = stone;
    const pad = 40;
    const off = document.createElement('canvas');
    off.width = Math.ceil(2 * rx + 2 * pad);
    off.height = Math.ceil(2 * ry + 2 * pad);
    const o = off.getContext('2d');
    const lx = rx + pad;
    const ly = ry + pad;
    const pts = stonePoints(lx, ly, rx, ry, seed);
    const outline = () => smoothPath(o, pts);

    outline();
    o.fillStyle = fill;
    o.fill();
    o.save();
    outline();
    o.clip();
    o.lineCap = 'round';
    o.globalAlpha = 0.4;
    o.strokeStyle = '#ffffff';
    o.lineWidth = 7;
    o.beginPath();
    o.moveTo(lx - rx * 0.7, ly - ry * 0.2);
    o.quadraticCurveTo(lx - rx * 0.42, ly - ry * 0.8, lx + rx * 0.08, ly - ry * 0.82);
    o.stroke();
    o.globalAlpha = 0.16;
    o.strokeStyle = C.ink;
    o.lineWidth = 10;
    o.beginPath();
    o.moveTo(lx - rx * 0.5, ly + ry * 0.66);
    o.quadraticCurveTo(lx + rx * 0.05, ly + ry * 0.92, lx + rx * 0.6, ly + ry * 0.55);
    o.stroke();
    o.restore();
    outline();
    o.lineWidth = 6;
    o.lineJoin = 'round';
    o.strokeStyle = C.ink;
    o.stroke();

    if (chip) {
      const shape = chipShape(pts, lx, ly, chip.angle, chip.w, chip.depth, seed + 1);
      o.globalCompositeOperation = 'destination-out';
      polyPath(o, shape.bite, true);
      o.fill();
      o.globalCompositeOperation = 'source-over';
      o.save();
      outline();
      o.clip();
      polyPath(o, shape.face, true);
      o.fillStyle = 'rgba(255, 255, 255, 0.38)';
      o.fill();
      polyPath(o, shape.edge, false);
      o.lineWidth = 10;
      o.lineJoin = 'miter';
      o.strokeStyle = C.ink;
      o.stroke();
      o.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(off, -lx, -ly);
    ctx.restore();
  }

  // The ground line: two cubic curves, as [start, control 1, control 2, end] points.
  const GROUND = [
    [[56, 0], [300, -6], [560, 6], [800, -2]],
    [[800, -2], [900, -5], [990, 2], [1024, 0]]
  ];

  /** The ground line's y at `x`, so pebbles can sit on it. */
  function groundY(x) {
    let best = { dx: Infinity, y: 0 };
    GROUND.forEach(seg => {
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const u = 1 - t;
        const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        const px = seg.reduce((sum, p, j) => sum + k[j] * p[0], 0);
        const py = seg.reduce((sum, p, j) => sum + k[j] * p[1], 0);
        if (Math.abs(px - x) < best.dx) best = { dx: Math.abs(px - x), y: py };
      }
    });
    return GROUND_Y + best.y;
  }

  function drawGround(ctx) {
    ctx.save();
    ctx.strokeStyle = C.ink;
    ctx.lineCap = 'round';
    // Pebbles first, their flat base on the line, so the line runs over their bottom edge.
    [[690, 26, 13], [738, 15, 8], [104, 18, 9]].forEach(([x, rx, ry]) => {
      ctx.beginPath();
      ctx.ellipse(x, groundY(x) + 1, rx, ry, 0, Math.PI, 2 * Math.PI);
      ctx.closePath();
      ctx.fillStyle = C.pebble;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.stroke();
    });
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(GROUND[0][0][0], GROUND_Y + GROUND[0][0][1]);
    GROUND.forEach(([, c1, c2, end]) => ctx.bezierCurveTo(c1[0], GROUND_Y + c1[1], c2[0], GROUND_Y + c2[1], end[0], GROUND_Y + end[1]));
    ctx.stroke();
    ctx.restore();
  }

  async function loadImage(path) {
    try {
      const img = new Image();
      img.src = new URL(path, document.baseURI).href;
      await img.decode();
      return img;
    } catch (err) {
      return null;
    }
  }

  /** Paper, and the contour map from the home page, fading out towards the cairn. */
  function drawBackground(ctx, topo) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);
    if (!topo) return;
    const off = document.createElement('canvas');
    off.width = W;
    off.height = 820;
    const o = off.getContext('2d');
    const tw = 1300;
    const th = (topo.naturalHeight / topo.naturalWidth) * tw || 820;
    o.drawImage(topo, W - tw + 40, 0, tw, th);
    o.globalCompositeOperation = 'destination-in';
    const fade = o.createLinearGradient(0, 0, 0, 820);
    fade.addColorStop(0.35, 'rgba(0, 0, 0, 1)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    o.fillStyle = fade;
    o.fillRect(0, 0, W, 820);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  function formatStats(record, unitSystem) {
    const metric = unitSystem === 'metric';
    const num = v => String(Math.round(v * 10) / 10);
    const stats = [];
    if (typeof record.baseWeightLbs === 'number') {
      stats.push({ value: num(metric ? record.baseWeightLbs * 0.45359237 : record.baseWeightLbs), unit: metric ? 'kg' : 'lb', label: 'base weight' });
    }
    if (typeof record.averageDailyMiles === 'number') {
      stats.push({ value: num(metric ? record.averageDailyMiles * 1.60934 : record.averageDailyMiles), unit: metric ? 'km' : 'mi', label: metric ? 'km a day' : 'miles a day' });
    }
    if (typeof record.totalZeroDays === 'number') stats.push({ value: String(record.totalZeroDays), unit: '', label: 'zero days' });
    if (typeof record.overallEnjoymentRating === 'number') stats.push({ value: String(record.overallEnjoymentRating), unit: '/10', label: 'enjoyment' });
    return stats;
  }

  /**
   * Splits `text` into at most three lines no wider than `maxWidth` (in the current font),
   * as even as possible: "carried a / heavier pack", not "carried a heavier / pack".
   */
  function lineBreak(ctx, text, maxWidth) {
    const words = text.split(' ');
    const width = t => ctx.measureText(t).width;
    if (width(text) <= maxWidth) return [text];
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const widest = Math.max(...lines.map(width));
      if (widest <= maxWidth && (!best || widest < best.widest)) best = { lines, widest };
    }
    if (best) return best.lines;
    const lines = [];
    words.forEach(word => {
      const last = lines[lines.length - 1];
      if (last && width(`${last} ${word}`) <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    });
    return lines.slice(0, 3);
  }

  /** Greedy wrap without a line limit (for the sentence at the top). */
  function lineBreakAll(ctx, text, maxWidth) {
    const lines = [];
    text.split(' ').forEach(word => {
      const last = lines[lines.length - 1];
      if (last && ctx.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    });
    return lines;
  }

  /**
   * The cairn between `top` and the ground: one stone per entry ({ value, unit, label }),
   * the first at the bottom and biggest, a blank capstone on top.
   */
  function drawCairn(ctx, entries, top) {
    const count = Math.max(entries.length, 1);
    // Sizes from the bottom up; scaled down when a long headline leaves less room.
    let sizes = [0, 1, 2, 3].slice(0, count).map(i => ({ rx: 238 - i * 30, ry: 90 - i * 6 }));
    const capRy = 38;
    const overlap = 12;
    const need = sizes.reduce((sum, s) => sum + 2 * s.ry - overlap, 0) + 2 * capRy;
    // Up to a little bigger when there is room (stones stay clear of the labels).
    const scale = Math.min(1.08, (GROUND_Y - 4 - top) / need);
    sizes = sizes.map(s => ({ rx: s.rx * scale, ry: s.ry * scale }));

    let bottom = GROUND_Y - 4;
    const stones = sizes.map((s, i) => {
      const cy = bottom - s.ry;
      bottom = cy - s.ry + overlap * scale;
      const [dx, rot] = NUDGES[i];
      return Object.assign({ cx: CAIRN_X + dx * scale, cy, rot, fill: STONE_FILLS[i], seed: 11 + i * 12 }, s);
    });
    // One chip on the bottom stone's top-right corner, a smaller one low on the top stone.
    stones[0].chip = { angle: -42, w: 30 * scale, depth: 8 * scale };
    if (stones.length >= 3) stones[stones.length - 1].chip = { angle: 145, w: 26 * scale, depth: 8 * scale };
    stones.forEach(stone => drawStone(ctx, stone));
    const capRx = 84 * scale;
    drawStone(ctx, { cx: CAIRN_X + 12 * scale, cy: bottom - capRy * scale, rx: capRx, ry: capRy * scale, rot: 5, fill: CAP_FILL, seed: 53 });

    entries.forEach((entry, i) => {
      const s = stones[i];
      // The number in the stone, shrunk if it would not fit.
      let size = Math.round(s.ry * 1.05);
      const unitSize = () => Math.round(size * 0.5);
      const widthAt = () => {
        ctx.font = `700 ${size}px ${FONT}`;
        const v = ctx.measureText(entry.value).width;
        ctx.font = `600 ${unitSize()}px ${FONT}`;
        return v + (entry.unit ? 8 + ctx.measureText(entry.unit).width : 0);
      };
      while (widthAt() > s.rx * 1.5 && size > 40) size -= 2;
      const total = widthAt();
      ctx.save();
      ctx.translate(s.cx, s.cy);
      ctx.rotate((s.rot * 0.8 * Math.PI) / 180);
      ctx.fillStyle = C.ink;
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${size}px ${FONT}`;
      const vw = ctx.measureText(entry.value).width;
      ctx.fillText(entry.value, -total / 2, 4);
      if (entry.unit) {
        ctx.font = `600 ${unitSize()}px ${FONT}`;
        ctx.fillText(entry.unit, -total / 2 + vw + 8, 4 + size * 0.18);
      }
      ctx.restore();

      // The label to the right, joined by a dotted leader.
      ctx.font = `600 42px ${FONT}`;
      const lines = lineBreak(ctx, entry.label, W - M - LABEL_X);
      const x0 = s.cx + s.rx + 16;
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(x0, s.cy, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.setLineDash([2, 10]);
      ctx.beginPath();
      ctx.moveTo(x0 + 14, s.cy);
      ctx.lineTo(LABEL_X - 16, s.cy);
      ctx.stroke();
      ctx.restore();
      ctx.textBaseline = 'middle';
      lines.forEach((line, j) => ctx.fillText(line, LABEL_X, s.cy + (j - (lines.length - 1) / 2) * 48));
      ctx.textBaseline = 'alphabetic';
    });
  }

  /**
   * The one sentence at the top, plain on purpose (no logo, no big two-colour headline):
   * "My 2025 PCT thru-hike, out of 112 other PCT hikers."
   */
  function sentence(record, comparison, hasHighlights) {
    const trail = window.SurveySchema.trailName(record.trail) || 'long-distance';
    let note = 'one of the first in the dataset';
    if (comparison) note = `${hasHighlights ? 'out of' : 'compared with'} ${comparison.peerCount} other ${comparison.peerNoun}`;
    return `My ${record.hikeYear} ${trail} ${hikeNoun(record)}, ${note}.`;
  }

  async function render(record, comparison, options) {
    const unitSystem = (options && options.unitSystem) || 'imperial';
    // Canvas only uses web fonts that are already loaded.
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load(`700 90px ${FONT}`),
        document.fonts.load(`600 42px ${FONT}`),
        document.fonts.load(`500 58px ${FONT}`),
        document.fonts.load(`500 36px ${MONO}`)
      ]).catch(() => {});
    }
    const topo = await loadImage('/img/hero-topo.svg');

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    drawBackground(ctx, topo);

    // With comparisons: the hiker's best three (highlights in survey-stats.js). Without: their own numbers.
    const highlights = (comparison && comparison.highlights) || [];
    const entries = highlights.length
      ? highlights.map(h => ({ value: `${h.percent}%`, unit: '', label: h.cardLine }))
      : formatStats(record, unitSystem);

    ctx.font = `500 58px ${FONT}`;
    ctx.fillStyle = C.ink;
    ctx.textBaseline = 'alphabetic';
    let y = 150;
    lineBreakAll(ctx, sentence(record, comparison, highlights.length > 0), W - 2 * M).forEach(line => {
      ctx.fillText(line, M, y);
      y += 72;
    });

    drawGround(ctx);
    drawCairn(ctx, entries, y + 30);

    ctx.font = `500 36px ${MONO}`;
    ctx.fillStyle = C.blue;
    ctx.fillText('opentrailscience.org', M, 1270);

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not create share card'))), 'image/png');
    });
  }

  window.ShareCard = { render, WIDTH: W, HEIGHT: H };
})();
