/**
 * Reads public/_headers (Netlify's headers file) so the dev server sends the
 * same headers as production, and the tests can check them.
 */
const fs = require('fs');
const path = require('path');

const HEADERS_FILE = path.join(__dirname, '../../public/_headers');

/** Returns [{ pattern, headers: { name: value } }] in file order. */
function readHeaderRules(file = HEADERS_FILE) {
  const rules = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: {} });
    } else if (rules.length) {
      const i = line.indexOf(':');
      rules[rules.length - 1].headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

/** The headers for a URL path: every matching rule, later rules win. */
function headersFor(pathname, rules) {
  const matches = rule => rule.pattern.endsWith('/*')
    ? pathname.startsWith(rule.pattern.slice(0, -1))
    : pathname === rule.pattern;
  return Object.assign({}, ...rules.filter(matches).map(rule => rule.headers));
}

module.exports = { readHeaderRules, headersFor, HEADERS_FILE };
