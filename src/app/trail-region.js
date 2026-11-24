/**
 * Survey step 1: the trail is picked in two steps, region first. #field-trail keeps every trail in
 * its markup (one optgroup per region, which the tests check against the schema); picking a region
 * fills it with only that region's trails. Setting a trail from code (the home page stones, a saved
 * draft) picks its region too. The region is only a way to the trail: it is not an answer.
 * Part of the browser app (src/app/, bundled by scripts/build-js.js into public/js/app.bundle.js).
 */
import { $ } from './core.js';
import { applyOptionLabels, updateOptionHint } from './controls.js';

let regions = []; // [{ label, options: [<option>, …] }], read once from the markup

/** The trail's name as the list shows it ("Pacific Crest Trail (PCT)"), whichever region is shown. */
export function trailOptionLabel(code) {
  for (const region of regions) {
    const option = region.options.find(o => o.value === code);
    if (option) return (option.getAttribute('data-label') || option.textContent).trim();
  }
  return null;
}

function regionOf(code) {
  return regions.find(region => region.options.some(o => o.value === code)) || null;
}

/** Fills the trail list with one region's trails ('' = none yet: the list waits for a region). */
function showRegion(label) {
  const trail = $('field-trail');
  const region = regions.find(r => r.label === label);
  const placeholder = new Option(region ? 'Select your trail…' : 'Pick a region first', '', true, true);
  placeholder.disabled = true;
  trail.replaceChildren(placeholder, ...(region ? region.options : []));
  // An option picked earlier stays "selected" while it is out of the list and would win again
  // when its region comes back: always start on the placeholder.
  trail.selectedIndex = 0;
  trail.disabled = !region;
  applyOptionLabels(trail); // the length hints, as for the full list
}

/** Picks a trail from code: its region, then the trail, as if the hiker had chosen both. */
export function selectTrail(code) {
  const region = regionOf(code);
  if (!region) return;
  $('field-trail-region').value = region.label;
  showRegion(region.label);
  const trail = $('field-trail');
  trail.value = code;
  trail.dispatchEvent(new Event('change'));
}

/** Back to the start: no region, no trail (resetting the survey). */
export function resetTrailRegion() {
  $('field-trail-region').selectedIndex = 0;
  showRegion('');
  updateOptionHint($('field-trail'));
}

export function initTrailRegions() {
  const trail = $('field-trail');
  const select = $('field-trail-region');
  regions = Array.from(trail.querySelectorAll('optgroup'), group => ({
    label: group.label,
    options: Array.from(group.querySelectorAll('option'))
  }));
  regions.forEach(region => select.add(new Option(region.label, region.label)));
  select.addEventListener('change', () => {
    showRegion(select.value);
    trail.dispatchEvent(new Event('change')); // no trail picked yet: directions, hints and "Other" follow
  });
  showRegion('');
}
