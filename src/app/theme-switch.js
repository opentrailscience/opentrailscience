/**
 * The light / dark switch (theme.js sets the first theme before the page is drawn).
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $ } from './core.js';

// --- LIGHT / DARK THEME (theme.js sets the initial one before the page is drawn) ---
const THEME_KEY = 'ots-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  $('theme-toggle').setAttribute('aria-label', label);
  $('theme-toggle').title = label;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#1b1e22');
}

export function initTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* not saved, still switched */ }
  });
}
