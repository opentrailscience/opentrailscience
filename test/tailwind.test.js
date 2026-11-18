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

test('every color class uses a color named in the theme, with values for both themes', () => {
  const styles = read('public/styles.css');
  const names = new Set([...css.slice(css.indexOf('@theme inline reference')).matchAll(/--color-([a-z-]+): var\(--color-\1\);/g)].map(m => m[1]));
  assert.ok(names.size > 10, 'the color names are listed in src/tailwind.css');
  for (const name of names) assert.match(styles, new RegExp(`--color-${name}:`), `--color-${name} needs a value in public/styles.css`);
  // Values that differ in the light theme are set again there; the rest are the same in both.
  const pattern = /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|accent|from|via|to|fill|stroke|outline|decoration|caret|placeholder)-([a-z]+(?:-[a-z]+)*)(?:\/\d+)?(?![\w-])/g;
  const notColors = /^(?:transparent|current|inherit|none|hidden|solid|dashed|dotted|left|right|center|justify|start|end|top|bottom|wrap|nowrap|balance|pretty|clip|ellipsis|base|xs|sm|md|lg|xl|[234]xl|t|b|l|r|x|y|s|e|collapse|separate|offset|inset|auto|fixed|scroll|cover|contain|repeat|no-repeat|linear|radial|conic|blend|clip-text|origin|linecap|linejoin|width|opacity|miterlimit|dasharray|dashoffset)(?:-|$)/;
  for (const [, color] of markup.matchAll(pattern)) {
    if (notColors.test(color)) continue;
    assert.ok(names.has(color), `${color} is used but has no name in @theme (src/tailwind.css)`);
  }
  // Tailwind's own palettes are not used (their names mean dark shades, which the light theme would have to swap).
  assert.doesNotMatch(markup, /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|divide|accent)-(?:slate|gray|pine|sky|emerald|amber|orange|rose|teal|purple|white|black)(?:-\d+)?(?![\w-])/);
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
