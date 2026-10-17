const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');
const css = read('src/tailwind.css');
const markup = ['public/index.html', 'public/app.js', 'public/insights.js'].map(read).join('\n');

test('every space-x/space-y class has a Tailwind 3 compatibility rule', () => {
  const used = new Set(markup.match(/(?<![\w-])(?:(?:sm|md|lg|xl):)?space-[xy]-[\d.]+(?![\w.-])/g));
  for (const cls of used) {
    const selector = '.' + cls.replace(/[:.]/g, ch => `\\${ch}`) + ' > :not([hidden]) ~ :not([hidden])';
    assert.ok(css.includes(selector), `add a rule for ${cls} in src/tailwind.css`);
  }
});

test('every color class uses a color defined in the theme', () => {
  const defined = new Set([...css.matchAll(/--color-([a-z]+)-?(\d*):/g)].map(m => m[1] + (m[2] ? `-${m[2]}` : '')));
  const families = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|pine';
  const pattern = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*(?:bg|text|border|from|via|to|ring|shadow|fill|stroke|accent|outline|divide|decoration|caret|placeholder)-((?:${families})-\\d+)`, 'g');
  for (const [, color] of markup.matchAll(pattern)) {
    assert.ok(defined.has(color), `${color} is used but not defined in @theme (src/tailwind.css)`);
  }
});

test('form fields use at least 16px text on phones, so iOS does not zoom in on focus', () => {
  const html = read('public/index.html');
  for (const [tag] of html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
    if (/type="(hidden|checkbox|range|radio)"|website_url|hiker_anti_spam/.test(tag)) continue;
    const classes = (tag.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/);
    const size = classes.find(c => /^text-(xs|sm|base|lg|xl)$/.test(c));
    assert.ok(size === 'text-base' || size === 'text-lg' || size === 'text-xl', `${tag.slice(0, 80)}… needs text-base (sm:text-sm for desktop)`);
  }
});
