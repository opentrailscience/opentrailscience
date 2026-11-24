/**
 * The pages that get their own copy of index.html at build time (scripts/build-pages.js), so that
 * readers without JavaScript (search engines, AI assistants, link previews) see each page's own
 * title, description and address. The content is the same single page; only the head differs.
 * The titles match VIEW_TITLES in src/app/core.js, which the browser sets when switching pages
 * (test/entrypoints.test.js checks both). /thanks has no copy: it only exists right after submitting.
 */
const PAGES = [
  {
    path: '/survey', file: 'survey.html', title: 'Survey',
    description: 'Share your long-distance hike in about 10 minutes: gear, pace, costs, injuries and how it ended. No name, email, account or sign-up.'
  },
  {
    path: '/insights', file: 'insights.html', title: 'Insights',
    description: 'Explore the survey data: charts of gear, pace, injuries and how hikes ended, and tools to dig into the answers yourself, like making your own chart.'
  },
  {
    path: '/dataset', file: 'dataset.html', title: 'Dataset', dataset: true,
    description: 'The thru-hiker survey dataset as CSV or JSON: one row per hike, every column documented, free to use for anything (CC0).'
  },
  {
    path: '/about', file: 'about.html', title: 'About',
    description: 'Who runs Open Trail Science and why: a one-person project collecting open data about long-distance hiking.'
  },
  {
    path: '/privacy', file: 'privacy.html', title: 'Privacy',
    description: 'What the survey asks for, what it stores, how it blurs data for safety and technical data about the site.'
  }
];

const SITE = 'https://opentrailscience.org';

module.exports = { PAGES, SITE };
