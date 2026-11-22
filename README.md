# Open Trail Science

<img src="public/og-image.png" alt="Open Trail Science logo: a cairn of four stones" width="96">

One survey for every long trail, open all year.

[opentrailscience.org](https://opentrailscience.org) is a survey for anyone who has hiked a long-distance trail, finished or not. I never ask for your name or an annoying sign-up, and I blur the data a bit to make it harder to pinpoint a specific hiker, then publish every answer in an open dataset that anyone can download and play around with.

## Why I'm making this

While planning for the PCT I of course watched all the mandatory indie-folk-infused journey videos, but I also really enjoyed looking at different statistics and surveys. These are great for answering how popular a specific trend is. But I couldn't find any surveys that release each submission as a complete row, which would be cool if you want to look for interesting correlations or try to model some predictions.

So I'm trying to make this survey to provide datasets for any long-distance trail. Every hike is published as a complete row, meaning all of one hiker's answers are together, so anyone can look for their own connections or even train models. People could make hiking cost or injury forecasts, try to model a weight loss curve for each trail, or make a boots vs trail runners comparison based on body weight and age. That takes a lot of hikes tho!

## A word on vibe coding

The entire codebase was written by AI. I did, however, run extensive local testing and understand all backend functionality, which (to the best of my abilities with a decent amount of pre-LLM programming experience) looks good. If you think I missed something, let me know at hello@opentrailscience.org.

## What's in here

- `public/`: the website and the survey
- `netlify/functions/`: the small server part that checks, blurs and stores the answers
- `public/lib/survey-schema.js`: every question, allowed answer and blurring rule in one place
- [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md): every column of the dataset
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): how it all works, and how to deploy it

Want to try it locally? You only need Node.js 20.19 or newer:

```bash
npm install
npm run dev:offline   # http://127.0.0.1:3000 with synthetic hikers, no database needed
npm test
```

## The data

The dataset is free for everyone, as CSV and JSON on [opentrailscience.org/dataset](https://opentrailscience.org/dataset). How the answers are blurred and what is stored is explained on the [privacy page](https://opentrailscience.org/privacy).

## License

The code is MIT ([LICENSE](LICENSE)), the dataset is public domain (CC0 1.0) and the fonts in `public/fonts/` come with their own SIL Open Font License.

## Contact

This is a one-person project, not a company, and I still change things a lot (especially how the site looks). If something is confusing or annoying, or you have any suggestions or questions, don't hesitate! hello@opentrailscience.org

For anything about your data: privacy@opentrailscience.org
