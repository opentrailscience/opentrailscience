/**
 * The last step of `npm run build`: saves the finished public/index.html again as one file per page
 * (survey.html, insights.html, … in scripts/lib/pages.js), each with its own title, description,
 * canonical address and link-preview tags. netlify.toml serves /survey from survey.html and so on;
 * visitors get the same page as before (one HTML file per visit, then switching pages in the browser
 * as always), while readers without JavaScript see the right head for each address.
 *
 * dataset.html also lists the dataset's columns for Google Dataset Search (only there, so no other
 * page gets heavier). The copies are build outputs (git-ignored); the local dev server ignores them
 * and always serves index.html. A missing or changed tag fails the build, so the previous deploy stays.
 */
const fs = require('fs');
const path = require('path');
const Schema = require('../public/lib/survey-schema');
const { PAGES, SITE } = require('./lib/pages');

const PUBLIC = path.join(__dirname, '../public');

/** Replaces the first match of `re` (which must match exactly once) with `text`. */
function swap(html, re, text, what) {
  const found = html.match(new RegExp(re.source, 'g')) || [];
  if (found.length !== 1) throw new Error(`build-pages: expected one ${what} in index.html, found ${found.length}`);
  return html.replace(re, text);
}

const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The years the dataset covers ("2018/2026"), from the published dataset file, or null. */
function yearsCovered() {
  try {
    const years = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/thru_hiker_survey_dataset.json'), 'utf8'))
      .map(r => r.hikeYear).filter(y => Number.isInteger(y));
    return years.length ? `${Math.min(...years)}/${Math.max(...years)}` : null;
  } catch (err) {
    return null;
  }
}

/** For Google Dataset Search: every column, how the answers were collected, the years, the schema version. */
function datasetDetails(html) {
  const re = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/;
  const ld = html.match(re);
  if (!ld) throw new Error('build-pages: the JSON-LD block is missing');
  const data = JSON.parse(ld[2]);
  data.version = Schema.SCHEMA_VERSION;
  data.measurementTechnique = 'Online survey, self-reported by hikers';
  const years = yearsCovered();
  if (years) data.temporalCoverage = years;
  data.variableMeasured = Schema.describeSchema().columns.map(c => ({ '@type': 'PropertyValue', name: c.name, description: c.label }));
  return html.replace(re, `${ld[1]}\n  ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')}\n  ${ld[3]}`);
}

/** index.html with the head of one page. Pure, for the tests. */
function pageHtml(html, page) {
  const title = `${page.title} | Open Trail Science`;
  const url = `${SITE}${page.path}`;
  let out = html;
  out = swap(out, /<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`, '<title>');
  out = swap(out, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(page.description)}">`, 'description');
  out = swap(out, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`, 'canonical link');
  out = swap(out, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`, 'og:url');
  out = swap(out, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(title)}">`, 'og:title');
  out = swap(out, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(page.description)}">`, 'og:description');
  out = swap(out, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(title)}">`, 'twitter:title');
  out = swap(out, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(page.description)}">`, 'twitter:description');
  return page.dataset ? datasetDetails(out) : out;
}

function buildPages() {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  PAGES.forEach(page => fs.writeFileSync(path.join(PUBLIC, page.file), pageHtml(html, page)));
  console.log(`Wrote ${PAGES.map(p => p.file).join(', ')} (one head per page).`);
}

if (require.main === module) {
  try {
    buildPages();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { pageHtml, buildPages };
