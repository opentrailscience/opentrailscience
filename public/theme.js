/**
 * Sets the color theme before the page is drawn, so it never flashes the
 * wrong one: the choice saved by the header button, otherwise light.
 * Loaded in <head> without defer, so it stays tiny; app.js handles
 * the button. The colors are in src/tailwind.css and public/styles.css.
 */
(function () {
  var theme = null;
  try { theme = localStorage.getItem('ots-theme'); } catch (e) { /* storage blocked */ }
  if (theme !== 'light' && theme !== 'dark') theme = 'light';
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f4f6' : '#121417');
})();
