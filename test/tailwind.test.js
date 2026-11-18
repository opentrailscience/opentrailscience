const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');
const css = read('src/tailwind.css');
const markup = ['public/index.html', 'public/insights.js'].map(read).join('\n') + '\n' + require('../scripts/build-js').appSources();

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

test('.field keeps 16px text on phones and 14px from the sm breakpoint on', () => {
  const built = read('public/css/tailwind.css');
  const field = built.match(/\.field\{[^}]*\}/);
  assert.ok(field, '.field is in the built CSS');
  assert.match(field[0], /font-size:var\(--text-base\)/);
  assert.match(built, /@media \((?:min-width:|width>=)40rem\)\{\.field\{[^}]*font-size:var\(--text-sm\)/);
});

test('form fields use at least 16px text on phones, so iOS does not zoom in on focus', () => {
  const html = read('public/index.html');
  for (const [tag] of html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)) {
    if (/type="(hidden|checkbox|range|radio)"|hp_trail_notes|hiker_anti_spam|trail-suggest-trap/.test(tag)) continue;
    const classes = (tag.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/);
    // .field sets text-base (sm:text-sm on wider screens); a phone-size override must not go below it.
    const size = classes.find(c => /^text-(xs|sm|base|lg|xl)$/.test(c)) || (classes.includes('field') ? 'text-base' : undefined);
    assert.ok(size === 'text-base' || size === 'text-lg' || size === 'text-xl', `${tag.slice(0, 80)}… needs .field or text-base (sm:text-sm for desktop)`);
  }
});
