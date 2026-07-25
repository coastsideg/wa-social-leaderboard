# WA Labor Social Media Leaderboard

Static leaderboard of WA Labor MPs' Facebook/Instagram performance, modelled on
[tas-meta-leaderboard](https://github.com/chillihambone/tas-meta-leaderboard) but backed
by the WA Labor Supermetrics/Looker spreadsheet export instead of live scraping.

No backend: `data.json` is a snapshot generated from the LOOKER tab of the spreadsheet.
There is no scraper, cron, or database — refresh by re-running the build script against
a fresh export.

## Refresh the data

1. Download the latest "WA Labor Social Media Dashboard" xlsx (Supermetrics refresh in
   Google Sheets, then File > Download > Microsoft Excel).
2. `node scripts/build-data.mjs "path/to/the.xlsx"` — regenerates `data.json`.
3. Redeploy.

## Local preview

Any static file server works, e.g. `npx serve .`.

## Deploy

Static site, no build step — deploy the folder as-is (Vercel: `vercel --prod`, or drag the
folder into any static host).

## Known data gaps (from the source spreadsheet, not this site)

- Instagram rows only carry New_Followers — Posts/Reels/Comments/Reactions/Views are 0
  across the board, so the Instagram Score is effectively a followers-growth-only ranking.
- The `Score` column is whatever the source spreadsheet computed — this site doesn't
  recalculate it, just displays and re-sorts it.
