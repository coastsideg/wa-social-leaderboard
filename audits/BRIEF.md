# Social audit build brief

## The goal

Produce the two audit documents for any WA Labor MP straight from the Meta Graph API, with no manual exports or screenshots:

- `NAME Audit.docx`: the one-pager
- `NAME Findings.docx`: the seven-finding detail doc

The target format is in `audits/reference/` (Daniel Pastorelli, 4 Mar to 3 Jun 2026). Match its structure and voice.

This used to take someone exporting 5 CSVs and 4 screenshots per MP from Business Suite, then a long chat per MP. The new flow is:

1. A script pulls one MP's data into `audits/data/<slug>/`.
2. A `social-auditor` subagent analyses it and writes headline findings.
3. David approves the headlines.
4. The subagent builds the two docs.
5. Fan out: one subagent per MP, all in parallel.

## What already exists (reuse it)

- `roster.json` has all 55 MPs, with Facebook page `id` and Instagram business account `id`. Read it, don't edit it.
- `.env` has `META_ACCESS_TOKEN`, the `metrics-puller` system user token in the WA Labor Business Manager.
- `scripts/check-graph-access.mjs` reports which pages the token reaches. Its approach of exchanging for a page token via `/{page-id}?fields=access_token` is the pattern to reuse.
- `scripts/ingest.mjs` has a working Graph fetch helper, currently on `v21.0`. Check that version is still live, and use the current Graph version for audit code.
- Node project with `dotenv`. Add `docx` (and whatever else is needed) as dependencies.

## Phase 0: check access (no building yet)

1. Run `node scripts/check-graph-access.mjs`. As of the last handover, 6 of 55 pages weren't reachable (John Carey, Hugh Jones, Tony Buti, Jodie Hanns, David Michael, Mark Folkard). David says access is now complete, so confirm it.
2. **Instagram has never been pulled via Graph in this repo**, only scraped. Test that the token can read Instagram insights for Daniel Pastorelli (IG id `17841466388197575`): one call to `/{ig-id}/insights?metric=reach&period=day` and one media insights call. If permissions are missing, report exactly which permission (likely `instagram_manage_insights`) and what David has to do in Business Manager.
3. Confirm the token can read `read_insights` metrics on Pastorelli's FB page (`252675147936868`).

**STOP.** Report Facebook coverage (X of 55), Instagram access yes or no, and any permission fixes needed.

### Instagram fallback: ScrapeCreators

The leaderboard gets Instagram from ScrapeCreators (`SCRAPECREATORS_API_KEY` in `.env`; see `fetchInstagram` in `scripts/ingest.mjs`). Graph stays first choice for audits, because scraping only sees public numbers. If Graph can't read an MP's Instagram, fall back to ScrapeCreators for that MP and mark the source in `audit-data.json`.

What the scrape can and can't support:

| Available from the scrape | Not available from the scrape |
|---|---|
| Follower count (today only) | Reach, or any follower vs non-follower split |
| Post timestamps, type, caption | IG follows and unfollows (churn) |
| Likes and comments per post | Audience by country |
| Reel plays (`/v1/instagram/user/reels`, `play_count`) | Views on images and carousels |
| | Reel watch time |

Check how far back each endpoint actually goes. The profile timeline returns recent posts only. Paginate the reels endpoint, and confirm whether it covers a full 90 days. Don't use `/v1/instagram/post`, which is broken upstream (see `HANDOVER.md`).

When the scrape is the source, the agent says so in the doc and drops or caveats the findings it can't support. It never fills them in.

## Phase 1: the data puller

Write `audits/pull.mjs`: `node audits/pull.mjs "<MP name>" <start YYYY-MM-DD> <end YYYY-MM-DD>`.

It saves the raw API responses as JSON in `audits/data/<slug>/`, plus one tidy `audit-data.json` the agent reads. It also pulls the **prior period of equal length** for the comparison figures.

Each finding and its source:

| Finding | What to pull |
|---|---|
| Reach | Page `page_media_view` with the `is_from_followers` breakdown. IG account `views` (breakdown `follower_type`) and `reach` (breakdown `follow_type`). |
| Cadence | All FB posts (`/{page-id}/published_posts`) and IG media (`/{ig-id}/media`) in the window, with `created_time`/`timestamp`, type, and permalink. |
| Retention | For each FB video or reel: `total_video_views`, `total_video_15s_views`, `total_video_60s_excludes_shorter_views`, `total_video_complete_views`, `total_video_avg_time_watched`, `total_video_retention_graph`, and the video's `length`. For IG reels: `ig_reels_avg_watch_time`. |
| Time of day | Post timestamps converted to AWST (UTC+8). The API gives UTC, so the old "add 16 hours" export rule does not apply here. |
| Format mix | Per FB post: `post_media_view` (with `is_from_followers`). Per IG media: `views`, `reach`, `total_interactions`, and `follows` (FEED only). FB reels show as videos, so classify a post as a reel if the permalink contains `/reel/` or it appears on `/{page-id}/video_reels`. |
| Local content | FB post `message` and IG `caption`, so suburb names can be counted. |
| Churn | FB `page_daily_follows_unique` and `page_daily_unfollows_unique`. IG `follows_and_unfollows` (breakdown `follow_type`). Current and prior period. |
| Audience | IG `follower_demographics` with breakdown `country` (timeframe `this_month`). FB country if a working metric exists. The old `page_fans_country` is deprecated, so don't fake it. |

Known API limits. Handle these, don't fight them:

- **IG `follows` is not available for reels.** Meta's docs say so. The old "reels win follows" finding can't come from the API. Put `null` in the data and let the agent caveat it.
- IG account metrics may cap the date range per request. Chunk by 30 days if the API rejects a longer range.
- `follows_and_unfollows` and `follower_demographics` need 100+ IG followers.
- Missing data comes back as an empty set, not 0. Store `null`, never 0.
- Insights can lag by up to 48 hours.
- Respect rate limits. `ingest.mjs` shows the pattern.

## Phase 2: prove it against Pastorelli

Run `node audits/pull.mjs "Daniel Pastorelli" 2026-03-04 2026-06-03` and compare with the reference docs:

| Figure | Reference value |
|---|---|
| FB views | 903,837 |
| FB views from followers / non-followers | 141,412 (15.6%) / 762,243 (84.4%) |
| IG views (account) | 291,914 |
| IG views / reach across his own posts | 69,015 / 37,426 across 86 posts |
| FB posts | 103 (77 photo, 16 video, 8 text, 2 link) |
| IG posts | 86 (35 carousel, 35 image, 16 reel) |
| IG avg views by format | carousel 900, reel 829, image 693 |
| FB median video length | 29 seconds, 11 of 16 over 25 seconds |
| IG time of day | 12 posts at 3pm, 12 at 4pm, 11 at 5pm AWST. 9 of 86 in 7 to 9pm. |
| IG churn | 121 unfollows, net follows 323, follow growth down 44.9% |
| FB churn | 183 follows, 51 unfollows |
| Audience | 94% Australia |

Post counts should match exactly. Views can differ a few per cent: the API counts organic only and Business Suite definitions shift. Explain any gap over 5% rather than adjusting the numbers to fit.

**STOP.** Show David a side-by-side table of reference vs API, with notes on every mismatch.

## Phase 3: the agent and the documents

The `social-auditor` agent (`.claude/agents/social-auditor.md`) does the analysis for one MP. Test it on Pastorelli:

1. It writes `audits/output/<Name>/headlines.md` with 3 to 5 headline findings.
2. **STOP.** David checks the headlines.
3. Once approved, it builds both docs into `audits/output/<Name>/`, using the Node `docx` library.

Document rules:

- Match the structure of the reference docs.
- Plain black Aptos, set explicitly in the build. No colour, no shaded headers, no banding, no horizontal rules, no headers, footers, page numbers or cover page. Bold for emphasis only.
- Charts as PNG, embedded. Use whatever charting runs on this machine, and ask David if nothing does.
- File names: `NAME Audit.docx` and `NAME Findings.docx`, with spaces and no underscores.

**STOP.** David compares the generated Pastorelli docs against the reference.

## Phase 4: trial run, then on demand

Audits run when David decides, not as one batch. The repo has a `/digital-audit` command (`.claude/commands/digital-audit.md`) that runs the whole flow for one or more named MPs.

1. Ask David which one or two MPs to trial, and each one's role: backbencher, frontbencher, minister, first-term MLA or established MLA. The roster doesn't hold roles.
2. Run them through `/digital-audit`. With two MPs, the subagents run in parallel.
3. **STOP.** David reviews the headlines, then the docs.
4. Fix whatever the review turns up, in the agent file, the command or `pull.mjs`. The build is finished at this point. Every audit after this is David asking for a digital audit when he wants one.

## Out of scope

- Any change to the live leaderboard.
- Scraping Facebook. Facebook audits are Graph-only, because the scrape caps at 3 posts per page. ScrapeCreators is only the Instagram fallback described in Phase 0.
- Making up a substitute for any metric the API doesn't give.
