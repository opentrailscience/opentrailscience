# Development notes

How the site works and how to run it. For the project itself see the [README](../README.md);
every column of the dataset is described in [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## Overview

A single-page site without a framework, a few Netlify Functions and a MongoDB database.

```
public/                     The website (Netlify's publish directory)
  index.html                All views: home, survey, thank-you, insights, dataset, privacy, about
  app.js                    Routing, the survey wizard and its saved draft, the dataset page
  insights.js               Charts on the Insights page
  share-card.js             The personal share card, drawn in the browser
  theme.js                  Sets light or dark mode before the page is drawn
  styles.css                Styles on top of Tailwind
  lib/survey-schema.js      Every question, allowed answer and blurring rule
  lib/survey-stats.js       Statistics and the "how you compare" numbers
  lib/human-check.js        The trail check and the proof of work before submitting
  _headers                  Security headers, including a strict Content-Security-Policy
  fonts/, img/              Self-hosted fonts (SIL OFL) and images
netlify/functions/          submit, delete, my-hike, feedback and two scheduled jobs
  utils/                    Database, public dataset, insights, spam checks, rebuilds
scripts/                    Dev server, dataset export, database scripts, data dictionary
src/                        Tailwind theme, and the sources of the two generated images
test/                       npm test
```

Generated and not in the repository: `public/css/`, `public/js/` (all browser scripts in one
bundle) and `public/data/` (the dataset files).

## The schema

`public/lib/survey-schema.js` defines every field once: type, unit, limits, allowed values, the
step and input it belongs to, and when it applies. The browser uses it to check the form, the
server to validate and store, and the scripts to write the CSV columns, the synthetic hikers and
the data dictionary.

To add a question: add it to `FIELDS` in the schema, add the input to `index.html` (and to
`UNIT_INPUTS` in `app.js` if it has a unit), then run `npm run docs` and `npm test`.
`test/html-sync.test.js` fails if the form and the schema disagree.

## What is stored

What is stored is exactly what is published. The server validates the exact answers, works out
the derived values and then saves only the blurred version:

| Answer | Stored as |
|---|---|
| Start and end date | calendar week and month, number of days on trail |
| Small trails and "Other" | months only, distance to 10 mi, days to whole weeks |
| Age | a 5-year range (everyone 20 or younger in one group) |
| Country | a world region |
| Submission time, names, free text | not collected |

- Numbers are stored in imperial units; the form converts metric input.
- Every question is required and nothing is preselected.
- Hard-to-remember numbers can be answered "Don't know": the value is `null` and the field is
  listed in `unknownAnswers`.
- `null` or `[]` means "does not apply" (for example week 3 of a two-week hike), never 0.
- Every record carries the `schemaVersion` and `consentVersion` it was collected under.

After submitting, a hiker gets a personal code. Only its SHA-256 hash is stored, in a separate
collection, so the code can show the hiker's own comparison later or delete the hike. The
optional feedback box on the thank-you page is stored apart from the answers, without a
timestamp, and never published.

## Free tiers

- Page views never touch a function or the database. Everything the pages show comes from
  prebuilt files in `public/data/` (`buildSnapshot()` in `netlify/functions/utils/dataset.js`).
- These files are rebuilt with every deploy. New answers start a rebuild through a Netlify build
  hook: after 5 changes, at most every 6 hours, plus one nightly catch-up if anything is waiting
  (`netlify/functions/utils/rebuild.js`).
- The database is only used to submit, delete, look up a code and rebuild the files.
- Public rows are ordered by trail, year and start month, never by submission time.

## Spam

Hidden honeypot fields, a minimum time on the form, a short trail question, a proof of work in
the browser and at most 10 submissions per network and hour. The network is stored only as a
keyed hash, apart from the answers, and is deleted after an hour.

## Running it locally

Needs Node.js 20.19 or newer (Netlify builds with Node 22, see `.nvmrc`).

```bash
npm install
npm run dev:offline   # http://127.0.0.1:3000 with 65 synthetic hikers, no database needed
npm test              # never touches a real database
```

For a real database, put the connection string in `.env`:

```bash
MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/?appName=<name>"
MONGODB_DB="hikersurvey"   # optional, this is the default
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with the database from `.env` (offline without one) |
| `npm run dev:offline` | Dev server with an in-memory database; `-- --hikers=60` for another number |
| `npm test` | All tests |
| `npm run build` | Tailwind CSS, the JS bundle and the dataset files |
| `npm run docs` | Rewrites `docs/DATA_DICTIONARY.md` after schema changes |
| `npm run render:example-card` | Redraws the example share card (needs Firefox and ImageMagick) |
| `npm run db:setup` | Creates the database indexes; safe to run again |
| `npm run db:check` | Connection check and record counts |
| `npm run feedback` | Prints the feedback messages |
| `npm run seed` / `npm run db:remove-synthetic` | Adds or removes synthetic hikers in the real database |

## Deploying

The site runs on Netlify; the build settings are in `netlify.toml`.

1. Run `npm run db:setup` once against the database.
2. Set these environment variables in Netlify (Builds and Functions scopes):
   - `MONGODB_URI`: the database connection string;
   - `BUILD_HOOK_URL`: a Netlify build hook for the `main` branch, so new answers get published;
   - `THROTTLE_SECRET`: a random string, the key for hashing networks.
3. Deploy. If the database can't be read during a build, the build fails and the previous
   version of the site stays live.

## API

| Endpoint | |
|---|---|
| `POST /api/submit` | The answers, keyed by field name. 201 with the stored record and the comparison, 400 with the errors, 429 when throttled, 503 if the database is down. |
| `POST /api/my-hike` | `{ "code": "XXXX-XXXX-XXXX-XXXX" }`. 200 with the hike and today's comparison, 404 for unknown codes. |
| `POST /api/delete` | `{ "code": "XXXX-XXXX-XXXX-XXXX" }`. 200 when deleted, 404 for unknown codes. |
| `POST /api/feedback` | `{ "message": "…" }`, up to 1000 characters. 201 when saved. |
| `/data/*.json`, `/data/*.csv` | The static dataset files and page data. |
