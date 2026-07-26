# Social Media Leaderboard

Static leaderboard scoring a tracked group of people's Facebook/Instagram performance,
modelled on [tas-meta-leaderboard](https://github.com/chillihambone/tas-meta-leaderboard)'s
percentile-rank methodology. Data comes from the [ScrapeCreators](https://scrapecreators.com)
API, not the platforms' own APIs — no login-owner access needed, just public profile/post
scraping.

No database: `data.json` and `snapshots/follower-history.json` are the entire state,
committed to the repo. A GitHub Action refreshes them daily and pushes the update, which
triggers Vercel's Git integration to redeploy automatically.

## How it works

- `roster.json` — the tracked people: name, seat, Facebook page (id + canonical URL),
  Instagram (business-account id + handle).
- `scripts/ingest.mjs` — pulls live data for everyone in the roster, appends today's
  follower counts to `snapshots/follower-history.json` (needed for the New Followers
  metric, which is a delta and needs ≥8 days of history to be reliable), and writes
  `data.json`.
- `index.html` — the static site. Fetches `data.json` and `config.json` client-side, no
  build step.
- `.github/workflows/daily-refresh.yml` — runs `ingest.mjs` daily, commits the refreshed
  data, and pushes. Vercel's GitHub integration redeploys automatically off that push.

## Standing up your own copy

This is a template, not a hosted platform — each instance is its own repo/deployment.

1. **Copy this repo** (new GitHub repo, don't fork if you want a clean history).
2. **Get a [ScrapeCreators](https://scrapecreators.com) API key.**
3. **Edit `config.json`** — org name, title, contact line, colours, and the cross-link
   (or remove `crossLink` entirely to hide it). This is the only file you need to touch
   for branding.
4. **Build the roster.** For each person you're tracking, run:
   ```bash
   node scripts/add-mp.mjs "Name" "Seat" "https://facebook.com/..." "https://instagram.com/..."
   ```
   This resolves and verifies both accounts live before writing to `roster.json` — pass
   `""` for the Instagram URL if someone's Facebook-only. If you're setting this up via a
   Claude Code session, just hand over your list as Name / Seat / Facebook URL / Instagram
   URL per person and the API key — that's the whole input format, no manual ID lookup
   needed.
5. **Run the first ingest:** `node scripts/ingest.mjs` (needs `SCRAPECREATORS_API_KEY`
   in `.env` locally).
6. **Deploy:** `vercel --prod`, then `vercel git connect` to link it to your GitHub repo
   for auto-deploy on push.
7. **Set the GitHub secret and enable the daily Action:**
   ```bash
   gh secret set SCRAPECREATORS_API_KEY --body "<your key>"
   ```
   The workflow is already there (`.github/workflows/daily-refresh.yml`) — it'll start
   running on its schedule once the secret exists. Adjust the cron if you're not in AWST.

## Local preview

Any static file server works, e.g. `npx serve .`.

## Known limitations

- **Facebook Shares/Views** need a per-post detail call (the list endpoint doesn't carry
  them), so ingest is slower than it looks like it should be — budget a few minutes for
  a full roster, not seconds.
- **Instagram Shares** are never available publicly, on any endpoint — confirmed against
  the live payload, not just the docs. Shown as `n/a` and excluded from the Instagram
  score (weights renormalise).
- **New Followers** needs ≥8 daily snapshots before it's reliable — shows `n/a` and is
  excluded from the score until then. No backfill is possible; scraping only sees the
  current count.
- **ScrapeCreators occasionally 500s** on individual accounts (proxy/internal errors,
  not account-specific) — `ingest.mjs` logs the failure and moves on rather than failing
  the whole run; that person's row just won't update that day.
