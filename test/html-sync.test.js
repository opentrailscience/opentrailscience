/**
 * Guards against the form and the schema drifting apart: every schema input
 * must exist in index.html, and every option the form offers must be a value
 * the schema accepts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Schema = require('../public/lib/survey-schema');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf-8');

function selectOptions(id) {
  const match = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(match, `select #${id} exists`);
  return Array.from(match[1].matchAll(/<option value="([^"]*)"/g), m => m[1]);
}

test('every schema input exists in index.html', () => {
  Schema.FIELDS.filter(f => f.input).forEach(f => {
    assert.ok(html.includes(`id="${f.input}"`), `#${f.input} for ${f.name}`);
  });
});

test('select options are accepted by the schema, after an empty placeholder', () => {
  Schema.FIELDS.filter(f => f.type === 'enum' && f.input).forEach(f => {
    if (!html.match(new RegExp(`<select[^>]*id="${f.input}"`))) return;
    const [placeholder, ...options] = selectOptions(f.input);
    assert.equal(placeholder, '', `${f.name} starts on a "Select…" placeholder`);
    options.forEach(v => assert.ok(f.values.includes(v), `${f.name}: "${v}"`));
  });
});

test('choice cards are accepted by the schema', () => {
  const cards = Array.from(html.matchAll(/data-name="([^"]+)" data-value="([^"]+)"/g), m => [m[1], m[2]]);
  assert.ok(cards.length > 20);
  cards.forEach(([name, value]) => {
    const field = Schema.FIELDS_BY_NAME[name];
    assert.ok(field, `choice card field ${name}`);
    if (field.type === 'boolean') return;
    if (field.type === 'integer') {
      assert.ok(Number(value) >= field.min && Number(value) <= field.max, `${name}: "${value}"`);
      return;
    }
    assert.ok(field.values.includes(value), `${name}: "${value}"`);
  });
});

test('every multi-select question has a pill group matching the schema', () => {
  const groups = Array.from(html.matchAll(/class="[^"]*pill-group"[^>]*data-field="([^"]+)">([\s\S]*?)<\/div>/g), m => [m[1], m[2]]);
  const multi = Schema.FIELDS.filter(f => f.type === 'enumArray' && f.name !== 'unknownAnswers').map(f => f.name);
  assert.deepEqual(groups.map(g => g[0]).sort(), multi.slice().sort());
  groups.forEach(([field, inner]) => {
    const values = Array.from(inner.matchAll(/data-val="([^"]+)"/g), m => m[1]);
    assert.deepEqual(values, Schema.FIELDS_BY_NAME[field].values, field);
  });
});

test('there are no free-text inputs apart from the hidden honeypots', () => {
  const survey = html.slice(html.indexOf('id="view-survey"'), html.indexOf('id="view-success"'));
  const textInputs = Array.from(survey.matchAll(/<input type="text" id="([^"]+)"/g), m => m[1]);
  assert.deepEqual(textInputs, ['website_url', 'hiker_anti_spam']);
  assert.doesNotMatch(survey, /<textarea/);
});

test('consent is asked before the survey, and only adults (today) can answer', () => {
  assert.match(html, /id="consent-checkbox"/);
  assert.match(html, /<button type="button" id="btn-start-survey" disabled/);
  assert.match(html, /<div id="survey-body" class="hidden">/);
  assert.match(html, /18 or older/);
  // The age question is the age at the start of the hike, which may be under 18.
  assert.match(html, new RegExp(`id="field-age"[^>]*min="${Schema.FIELDS_BY_NAME.age.min}"`));
});

test('the privacy page explains storage, rights, deletion and contact', () => {
  const page = html.slice(html.indexOf('id="view-privacy"'), html.indexOf('<!-- VIEW: INSIGHTS'));
  for (const heading of ['The short version', 'What you tell me and what I store', 'Why blurring matters', 'What I never collect',
    'Technical data while you visit', 'Where your data is stored', 'My reasons for using your data', 'Deleting your answers', 'Your rights', 'Who is responsible']) {
    assert.ok(page.includes(heading), heading);
  }
  assert.match(page, /id="deletion-code-input"/);
  assert.match(page, /mailto:/);
  // The worked example in the table matches what the server actually stores.
  assert.ok(page.includes(`${Schema.isoWeek('2025-04-18')} to ${Schema.isoWeek('2025-09-22')}, ${Schema.daysOnTrail('2025-04-18', '2025-09-22')} days`));
  assert.ok(page.includes(Schema.ageBand(29).replace('-', '–')));
});

test('no request leaves the site for fonts or other third-party assets', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf-8');
  assert.doesNotMatch(html + css, /fonts\.googleapis|fonts\.gstatic|cdn\.tailwindcss/);
  const fontFiles = Array.from(css.matchAll(/url\('(fonts\/[^']+)'\)/g), m => m[1]);
  assert.ok(fontFiles.length >= 4, 'the page loads its own fonts');
  fontFiles.forEach(f => assert.ok(fs.existsSync(path.join(__dirname, '../public', f)), f));
  assert.doesNotMatch(html, /\b100% Anonymous\b|No Personal Identifiers Collected/);
});

test('nothing is answered by default: the hiker has to interact with every question', () => {
  // Choice cards and yes/no questions start empty...
  Schema.FIELDS.filter(f => (f.type === 'enum' || f.type === 'boolean') && f.input).forEach(f => {
    const match = html.match(new RegExp(`<input type="hidden" id="${f.input}"[^>]*value="([^"]*)"`));
    if (match && f.name !== 'rampWeeksHiked') assert.equal(match[1], '', `${f.name} has no default`);
  });
  assert.doesNotMatch(html, /class="choice-card selected/, 'no preselected choice card');
  // ...no "No" button looks selected...
  (html.match(/<button type="button" id="btn-[a-z-]+-no" class="[^"]*"/g) || []).forEach(btn => {
    assert.doesNotMatch(btn, /bg-pine-600/, btn);
  });
  // ...sliders start untouched, and free-text inputs have no prefilled value.
  (html.match(/<input type="range"[^>]*>/g) || []).forEach(r => assert.match(r, /slider-untouched/, r));
  assert.doesNotMatch(html, /id="field-hikerCountry"[^>]*value=/);
});

test('every "Don\'t know" question has a checkbox in the form', () => {
  const toggled = new Set();
  (html.match(/data-fields="[^"]+"/g) || []).forEach(m => m.slice(13, -1).split(',').forEach(f => toggled.add(f)));
  assert.deepEqual(Array.from(toggled).sort(), Schema.UNKNOWN_FIELDS.slice().sort());
});

test('shelter and insulation choice cards match the schema', () => {
  ['shelterType', 'sleepInsulation'].forEach(name => {
    const values = Array.from(html.matchAll(new RegExp(`data-name="${name}" data-value="([^"]+)"`, 'g')), m => m[1]);
    assert.deepEqual(values, Schema.FIELDS_BY_NAME[name].values);
  });
});

test('preview filters only offer valid values', () => {
  selectOptions('preview-filter-trail').filter(v => v !== 'ALL').forEach(v => assert.ok(Schema.TRAILS.includes(v), v));
  selectOptions('preview-filter-status').filter(v => v !== 'ALL')
    .forEach(v => assert.ok(Schema.FIELDS_BY_NAME.completionStatus.values.includes(v), v));
});

test('every unit-switched input has a unit in the schema and a label in the page', () => {
  const ids = Array.from(app.matchAll(/input: '(field-[^']+)', label: '([^']+)'/g), m => [m[1], m[2]]);
  assert.ok(ids.length >= 10);
  ids.forEach(([input, label]) => {
    const field = Schema.FIELDS.find(f => f.input === input);
    assert.ok(field && field.unit, `${input} has a schema unit`);
    assert.ok(html.includes(`id="${label}"`), `#${label}`);
  });
  // And every schema field with a unit (except derived ones) is switchable.
  Schema.FIELDS.filter(f => f.unit && f.input).forEach(f => {
    assert.ok(ids.some(([input]) => input === f.input), `${f.input} is in UNIT_INPUTS`);
  });
});

test('the page has exactly one h1 (all four views share one document)', () => {
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
});

test('honeypot fields are hidden from screen readers and keyboard users', () => {
  const trap = html.match(/<div class="anti-spam-trap"([^>]*)>([\s\S]*?)<\/div>/);
  assert.ok(trap, 'honeypot container exists');
  assert.match(trap[1], /aria-hidden="true"/);
  const inputs = trap[2].match(/<input[^>]*>/g);
  assert.equal(inputs.length, 2);
  inputs.forEach(input => {
    assert.match(input, /tabindex="-1"/);
    assert.match(input, /autocomplete="off"/);
  });
});

test('Open Graph tags use absolute URLs and the image exists at 1200x630', () => {
  const meta = name => {
    const m = html.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]+)"`));
    return m && m[1];
  };
  ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name', 'twitter:card'].forEach(n => assert.ok(meta(n), n));
  assert.match(meta('og:url'), /^https:\/\/opentrailscience\.org\//);
  assert.match(meta('og:image'), /^https:\/\/opentrailscience\.org\/og-image\.png$/);

  const png = fs.readFileSync(path.join(__dirname, '../public/og-image.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(meta('og:image:width'), '1200');
  assert.equal(meta('og:image:height'), '630');
});

test('the trail check is on the start page, between the consent box and the start button', () => {
  const gate = html.slice(html.indexOf('id="consent-gate"'), html.indexOf('id="survey-body"'));
  const box = gate.indexOf('id="consent-checkbox"');
  const check = gate.indexOf('id="trail-check"');
  const start = gate.indexOf('id="btn-start-survey"');
  assert.ok(box > 0 && box < check && check < start);
});

test('no field invites password managers or browser autofill', () => {
  for (const [tag] of html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
    if (/type="(hidden|checkbox|radio)"/.test(tag)) continue;
    for (const attr of ['autocomplete="off"', 'data-1p-ignore', 'data-lpignore="true"', 'data-bwignore', 'data-form-type="other"']) {
      assert.ok(tag.includes(attr), `${tag.slice(0, 70)}… lacks ${attr}`);
    }
  }
  assert.match(html, /<form id="survey-form"[^>]*autocomplete="off"/);
});

test('the documented question wording matches the form', () => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  for (const f of Schema.FIELDS.filter(f => f.question)) {
    const core = f.question.split(' (')[0];
    assert.ok(text.includes(core), `${f.name}: "${core}" not found in index.html`);
  }
});

test('every element the scripts look up by id exists in the page', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const scripts = ['app.js', 'insights.js'].map(f => fs.readFileSync(path.join(__dirname, '../public', f), 'utf-8')).join('\n');
  const used = new Set([...scripts.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map(m => m[1]));
  const missing = [...used].filter(id => !ids.has(id));
  assert.deepEqual(missing, [], `index.html lacks: ${missing.join(', ')}`);
});

test('class attributes contain only class names', () => {
  for (const [, cls] of html.matchAll(/\sclass="([^"]*)"/g)) {
    assert.ok(!/[A-Z][a-z]+ [a-z]+ [a-z]+ [a-z]+/.test(cls) && !/[.!?] [A-Z]/.test(cls), `prose inside a class attribute: "${cls.slice(0, 80)}…"`);
  }
});

test('every required question shows a red * in the form', () => {
  // trainedBeforeHike is the "I didn't train at all" tick box, not a question of its own.
  const missing = Schema.FIELDS.filter(f => f.step && !f.optional && f.question && f.name !== 'trainedBeforeHike')
    .filter(f => html.includes(f.question)) // unit-dependent labels are written by app.js
    .filter(f => {
      const q = f.question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // &nbsp; keeps the star on the line of the question's last word.
      return !new RegExp(`${q}(?:\\s|&nbsp;)*(?:<[^>]+>(?:\\s|&nbsp;)*)?<span class="text-rose-400">\\*</span>`).test(html);
    })
    .map(f => f.name);
  assert.deepEqual(missing, []);
});
