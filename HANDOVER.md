# Handover

Everything needed to take this project over. Read this first, then the README for how
the pipeline works.

## What this is

A password-gated leaderboard scoring 55 WA Labor MPs and candidates on Facebook and
Instagram performance over a rolling 7 days.

- **Live site:** https://wa-social-leaderboard.vercel.app
- **Repo:** https://github.com/coastsideg/wa-social-leaderboard (private)
- **Vercel project:** `coastsidegs-projects/wa-social-leaderboard`
- **Refresh:** GitHub Action runs daily at 05:00 AWST, commits fresh data, and the push
  auto-triggers a Vercel redeploy. Nothing manual required day to day.

## Access you need (David has to grant these)

| What | How |
|---|---|
| GitHub repo | Added as collaborator on `coastsideg/wa-social-leaderboard` |
| Vercel project | Added to the `coastsidegs-projects` team |
| Site password | Sent separately — do not put it in this repo |
| ScrapeCreators API key | Sent separately. Also stored as GitHub secret `SCRAPECREATORS_API_KEY` |
| Meta Graph token | Sent separately. Also stored as GitHub secret `META_ACCESS_TOKEN` |
| Meta Business Manager | Admin on the WA Labor Business Manager, so you can assign pages to the `metrics-puller` system user |

Both API credentials live in a local `.env` file (gitignored) for local runs, and as
GitHub Actions secrets for the daily run. They are never committed.

Create your local `.env` as:

```
SCRAPECREATORS_API_KEY=<key David sends you>
META_ACCESS_TOKEN=<token David sends you>
```

## Where the data comes from

Two sources, and the difference matters:

- **Meta Graph API** — used for any Facebook page the `metrics-puller` system user token
  can reach. Returns the full 7-day window. **49 of 55 pages.**
- **ScrapeCreators (public scrape)** — fallback for pages the token can't reach, and the
  only source for Instagram. Facebook scraping is hard-capped by Facebook at **3 posts
  per page**, no matter how active the page is.

Ingest tries Graph first, falls back to scrape automatically, and logs which path each
person took (`[graph]` / `[scrape]`).

## Known issues, in priority order

**1. Six MPs are unfairly ranked (worth fixing first)**

John Carey, Hugh Jones, Tony Buti, Jodie Hanns, David Michael, Mark Folkard still use
the scrape, so they're measured on 3 posts while everyone else is measured on their full
week. They look far worse than they are. This is not a code problem.

Fix: Business Settings → Users → System Users → `metrics-puller` → Add Assets → Pages →
add those six with Full control. Then `node scripts/check-graph-access.mjs` should show
55 of 55, and the next ingest picks them up automatically.

**2. New Followers is switched off, and turning it on right now would publish false numbers**

The metric needs 8 daily snapshots to compute a delta. There are 13 days of history, so
it would otherwise be ready — but the first 12 days were scraped (rounded to the nearest
thousand: 127000, 33000, 12000) and the latest is from Graph (precise: 129110, 34156,
12730). A delta across that boundary invents growth that didn't happen — Roger Cook would
show roughly "+2,110 new followers" that is mostly a rounding artefact.

It currently shows `n/a` everywhere and is excluded from scoring, so nothing false is
live. To enable it honestly: delete `snapshots/follower-history.json`, let it rebuild
from Graph-only readings, and it becomes accurate 8 days later.

**3. ScrapeCreators `/v1/instagram/post` is broken upstream (does not affect us)**

They flagged it on 2026-08-07. We don't call that endpoint — Instagram views come from
`/v1/instagram/user/reels`, which is the workaround they recommend. No action needed,
but don't switch to `/v1/instagram/post` while it's broken.

**4. Occasional transient API failures**

Roughly one MP per run gets a 500 from ScrapeCreators (proxy errors, not account
problems). Ingest logs it and continues; that person's row just doesn't update that day.
Self-corrects next run.

## Routine tasks

**Add or fix someone's accounts:**
```bash
node scripts/add-mp.mjs "Name" "Seat" "https://facebook.com/..." "https://instagram.com/..."
```
Pass `""` for Instagram if they don't have one. It resolves and verifies both accounts
live before writing to `roster.json`.

**Refresh data manually** (the daily Action does this automatically):
```bash
node scripts/ingest.mjs
```
Takes several minutes — the Facebook scrape path needs a separate API call per post.

**Check Graph API coverage:**
```bash
node scripts/check-graph-access.mjs
```

**Change branding** (title, colours, contact line, cross-link): edit `config.json`.

**Change the site password:** it's the `SITE_PASSWORD` env var in Vercel (Production),
not in the repo. `vercel env rm SITE_PASSWORD production` then `vercel env add`.

**Deploy:** just `git push`. Vercel auto-deploys from the repo. Manual fallback is
`vercel --prod`.

## Watch out for

- **Always `git pull` before running a local ingest.** The daily Action commits to the
  same files (`data.json`, `snapshots/follower-history.json`). Working from a stale local
  copy causes merge conflicts, and resolving them carelessly can silently drop days of
  follower history.
- **Don't commit `.env`.** It's gitignored; keep it that way.
- **`add-mp.mjs` must store `adLibrary.pageId`, not ScrapeCreators' `id` field.** The
  `id` field is a profile-style ID the Graph API cannot resolve. This bug was already hit
  once and fixed; don't reintroduce it.

## Scoring

Percentile rank against the tracked group, weighted: Reels 25%, Views 20%, Posts 15%,
New followers 15%, Shares 10%, Reactions 10%, Comments 5%. Weights renormalise when a
metric is unavailable (Instagram never exposes shares; New followers is currently off).

Methodology borrowed from the Tasmanian Labor leaderboard this site was modelled on:
https://github.com/chillihambone/tas-meta-leaderboard
