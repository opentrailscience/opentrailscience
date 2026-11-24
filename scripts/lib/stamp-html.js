/**
 * Writes the current numbers into public/index.html (and the date into the sitemap) on Netlify builds, so readers that don't run
 * JavaScript (search engines, AI assistants, link previews) see the real count instead of the
 * placeholders ("0 of 50 hikers so far", "of --"). The browser overwrites the same elements with
 * the same words from the snapshot files, so nothing changes for visitors.
 *
 * Only on Netlify (export-static-dataset.js): a local build leaves the checked-in file as it is.
 */
const fs = require('fs');
const path = require('path');
const Schema = require('../../public/lib/survey-schema');

const FIRST_HIKERS_GOAL = 50; // as in src/app/core.js
const PREVIEW_ROWS = 8; // the preview's page size (state.previewLimit in src/app/core.js)

/** Replaces the text of the element with this id; throws if it is missing, so a renamed id is noticed. */
function setText(html, id, text) {
  const re = new RegExp(`(<[a-z]+[^>]*\\bid="${id}"[^>]*>)[^<]*(<)`);
  if (!re.test(html)) throw new Error(`stamp-html: #${id} not found in index.html`);
  return html.replace(re, (m, open, close) => `${open}${text}${close}`);
}

/** The page with `count` hikes, built on `date` (a Date). Pure, for the tests. */
function stampHtml(html, count, date) {
  const day = date.toISOString().slice(0, 10);
  let out = html;
  out = setText(out, 'first50-count', `${Math.min(count, FIRST_HIKERS_GOAL)} of ${FIRST_HIKERS_GOAL} hikers so far`);
  out = setText(out, 'insights-meta', `${count} ${count === 1 ? 'hike' : 'hikes'} in the dataset`);
  out = setText(out, 'dataset-meta', [`${count} public ${count === 1 ? 'record' : 'records'}`, `schema v${Schema.SCHEMA_VERSION}`, 'CC0 1.0 public domain', `updated ${day}`].join(' • '));
  out = setText(out, 'preview-pagination-info', count ? `Showing rows 1 - ${Math.min(count, PREVIEW_ROWS)} of ${count}` : 'No matching records');
  // Google Dataset Search reads this block: when it last changed, and how many hikes it holds.
  const ld = out.match(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/);
  if (!ld) throw new Error('stamp-html: the JSON-LD block is missing');
  const data = JSON.parse(ld[2]);
  data.dateModified = day;
  data.description = `${data.description.replace(/\s*As of \d{4}-\d{2}-\d{2}: \d+ hikes?\.$/, '')} As of ${day}: ${count} ${count === 1 ? 'hike' : 'hikes'}.`;
  out = out.replace(ld[0], `${ld[1]}\n  ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')}\n  ${ld[3]}`);
  return out;
}

/** The sitemap with today's date on the pages whose content changes with the data. Pure, for the tests. */
function stampSitemap(xml, date) {
  const day = date.toISOString().slice(0, 10);
  return xml.replace(/<url><loc>(https:\/\/opentrailscience\.org(?:\/|\/insights|\/dataset))<\/loc>(?:<lastmod>[^<]*<\/lastmod>)?<\/url>/g,
    (m, loc) => `<url><loc>${loc}</loc><lastmod>${day}</lastmod></url>`);
}

function stampIndexHtml(count, date) {
  const when = date || new Date();
  const file = path.join(__dirname, '../../public/index.html');
  fs.writeFileSync(file, stampHtml(fs.readFileSync(file, 'utf8'), count, when));
  const sitemap = path.join(__dirname, '../../public/sitemap.xml');
  fs.writeFileSync(sitemap, stampSitemap(fs.readFileSync(sitemap, 'utf8'), when));
}

module.exports = { stampHtml, stampSitemap, stampIndexHtml };
