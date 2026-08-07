// Daily refresh: pulls live Facebook + Instagram data for every MP in roster.json via
// ScrapeCreators, appends today's follower counts to snapshots/follower-history.json
// (needed for the New Followers metric, which is a delta and needs history), computes
// post-engagement metrics for the trailing WINDOW_DAYS from the live post lists, scores
// everyone by percentile rank within the group (methodology borrowed from
// https://github.com/chillihambone/tas-meta-leaderboard's published weights — this is
// NOT a recreation of whatever formula the original spreadsheet's LOOKER tab used,
// which was never disclosed), and writes data.json for the site.
//
// Usage: node scripts/ingest.mjs

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.SCRAPECREATORS_API_KEY;
if (!KEY) { console.error('Set SCRAPECREATORS_API_KEY (.env)'); process.exit(1); }

// Optional. When set, Facebook data comes from the official Meta Graph API for any page
// the token can reach — which matters a lot: a logged-out scrape only ever returns the
// 3 most recent posts per page, whereas Graph returns the full window (28 posts in a
// week for an active page). Pages the token can't reach fall back to the scrape.
const META_TOKEN = process.env.META_ACCESS_TOKEN;

const WINDOW_DAYS = 7;
const MIN_SNAPSHOTS_FOR_FOLLOWERS = 8;

// Weights from the Tas Labor leaderboard's published methodology.md — a real, sourced
// methodology, not a guess at what the original WA spreadsheet used. Shares is
// Facebook-only (Instagram never exposes it publicly, confirmed against the live
// payload) — scoreRows() renormalises it out of the Instagram-only view.
const WEIGHTS = { reels: 0.25, views: 0.20, posts: 0.15, followers: 0.15, shares: 0.10, reactions: 0.10, comments: 0.05 };

const roster = JSON.parse(readFileSync('roster.json', 'utf8'));

async function sc(path, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://api.scrapecreators.com${path}?${qs}`, { headers: { 'x-api-key': KEY } });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`${path} ${qs} -> ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const now = new Date();
const windowStartMs = now.getTime() - WINDOW_DAYS * 86400 * 1000;
const today = now.toISOString().slice(0, 10);

// --- Meta Graph API path (preferred when the token can reach the page) ---

async function graph(path, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}?${qs}`);
  const body = await res.json();
  if (body.error) throw new Error(`graph ${path} -> ${body.error.message?.slice(0, 120)}`);
  return body;
}

// The system-user token can't read /posts directly ("a Page access token is required
// for the new Pages experience") — it has to be exchanged for a per-page token first.
async function pageToken(pageId) {
  const r = await graph(pageId, { fields: 'access_token', access_token: META_TOKEN });
  if (!r.access_token) throw new Error('no page token returned');
  return r.access_token;
}

async function fetchFacebookGraph(mp) {
  const token = await pageToken(mp.facebook.id);
  const profile = await graph(mp.facebook.id, { fields: 'followers_count,fan_count', access_token: token });

  // Page through until we're past the window, so a busy page isn't truncated.
  const posts = [];
  let url = null;
  for (let page = 0; page < 5; page++) {
    const body = url
      ? await (await fetch(url)).json()
      : await graph(`${mp.facebook.id}/posts`, {
          fields: 'created_time,attachments{media_type},shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),insights.metric(post_video_views)',
          limit: '100',
          access_token: token,
        });
    if (body.error) break;
    const batch = body.data || [];
    posts.push(...batch);
    const oldest = batch.length ? new Date(batch[batch.length - 1].created_time).getTime() : 0;
    if (!body.paging?.next || oldest < windowStartMs) break;
    url = body.paging.next;
  }

  const inWindow = posts.filter((p) => new Date(p.created_time).getTime() >= windowStartMs);
  const isVideo = (p) => (p.attachments?.data || []).some((a) => /video/i.test(a.media_type || ''));
  // post_video_views comes back with both a "lifetime" and a "day" series; the lifetime
  // total is the comparable figure (the scrape path reports lifetime views too).
  const videoViews = (p) => {
    const m = (p.insights?.data || []).find((x) => x.name === 'post_video_views' && x.period === 'lifetime');
    return m?.values?.[0]?.value || 0;
  };

  return {
    followerCount: profile.followers_count ?? profile.fan_count ?? null,
    posts: inWindow.length,
    reels: inWindow.filter(isVideo).length,
    comments: sum(inWindow, (p) => p.comments?.summary?.total_count),
    reactions: sum(inWindow, (p) => p.reactions?.summary?.total_count),
    shares: sum(inWindow, (p) => p.shares?.count),
    views: sum(inWindow, videoViews),
    source: 'graph',
  };
}

async function fetchFacebook(mp) {
  const profile = await sc('/v1/facebook/profile', { url: mp.facebook.url });
  const posts = await sc('/v1/facebook/profile/posts', { url: mp.facebook.url });
  const inWindow = (posts.posts || []).filter((p) => p.publishTime * 1000 >= windowStartMs);
  const videos = inWindow.filter((p) => p.videoDetails && Object.keys(p.videoDetails).length > 0);

  // The list endpoint never populates view/share counts (verified live) — the
  // per-post detail endpoint does, but one post at a time, so fetch every in-window
  // post individually. This is the slow part of ingest (N extra calls per MP).
  let viewTotal = 0, shareTotal = 0;
  for (const p of inWindow) {
    try {
      const detail = await sc('/v1/facebook/post', { url: p.url });
      viewTotal += detail.view_count || 0;
      shareTotal += detail.share_count || 0;
    } catch { /* leave uncounted rather than fail the whole MP */ }
  }
  return {
    followerCount: profile.followerCount ?? profile.likeCount ?? null,
    posts: inWindow.length,
    reels: videos.length,
    comments: sum(inWindow, (p) => p.commentCount),
    reactions: sum(inWindow, (p) => p.reactionCount),
    views: viewTotal,
    shares: shareTotal,
  };
}

async function fetchInstagram(mp) {
  const profile = await sc('/v1/instagram/profile', { handle: mp.instagram.handle });
  const user = profile.data.user;
  const edges = user.edge_owner_to_timeline_media?.edges || [];
  const inWindow = edges.map((e) => e.node).filter((n) => n.taken_at_timestamp * 1000 >= windowStartMs);

  // The profile-embed timeline never populates video_view_count for reels (verified
  // live — always 0). The dedicated reels endpoint has real numbers under media.play_count,
  // so pull that separately and use it in place of the embed's view figure.
  let viewsByShortcode = {};
  try {
    const reels = await sc('/v1/instagram/user/reels', { handle: mp.instagram.handle });
    for (const item of reels.items || []) {
      const m = item.media;
      if (m?.taken_at * 1000 >= windowStartMs) viewsByShortcode[m.code] = m.play_count ?? m.ig_play_count ?? 0;
    }
  } catch { /* fall through with no view data rather than fail the whole MP */ }

  return {
    followerCount: user.edge_followed_by.count,
    posts: inWindow.length,
    reels: inWindow.filter((n) => n.product_type === 'clips').length,
    comments: sum(inWindow, (n) => n.edge_media_to_comment?.count),
    reactions: sum(inWindow, (n) => n.edge_liked_by?.count ?? n.edge_media_preview_like?.count),
    views: Object.values(viewsByShortcode).reduce((a, v) => a + (v || 0), 0),
    shares: null, // Instagram never exposes share counts publicly — confirmed against the full live payload, not just this endpoint's docs.
  };
}

function sum(arr, f) { return arr.reduce((a, x) => a + (f(x) || 0), 0); }

// --- Run ingest ---
const history = existsSync('snapshots/follower-history.json')
  ? JSON.parse(readFileSync('snapshots/follower-history.json', 'utf8'))
  : {};
history[today] = history[today] || {};

const raw = [];
for (const mp of roster) {
  process.stderr.write(`${mp.name}... `);
  let fb = null, ig = null;
  // Prefer the Graph API (full post history); fall back to the scrape (3-post cap).
  if (META_TOKEN) {
    try { fb = await fetchFacebookGraph(mp); process.stderr.write('[graph] '); }
    catch { /* not reachable by the token — fall through to the scrape */ }
  }
  if (!fb) {
    try { fb = await fetchFacebook(mp); process.stderr.write('[scrape] '); }
    catch (e) { process.stderr.write(`[FB failed: ${e.message}] `); }
  }
  if (mp.instagram) {
    try { ig = await fetchInstagram(mp); } catch (e) { process.stderr.write(`[IG failed: ${e.message}] `); }
  }
  if (fb) history[today][`${mp.name}__facebook`] = fb.followerCount;
  if (ig) history[today][`${mp.name}__instagram`] = ig.followerCount;
  raw.push({ name: mp.name, seat: mp.seat, fb, ig });
  process.stderr.write('ok\n');
}
writeFileSync('snapshots/follower-history.json', JSON.stringify(history, null, 2));

// --- Net-new followers from history (needs >= MIN_SNAPSHOTS_FOR_FOLLOWERS days) ---
const dates = Object.keys(history).sort();
const warmedUp = dates.length >= MIN_SNAPSHOTS_FOR_FOLLOWERS;
const baselineDate = dates[Math.max(0, dates.length - MIN_SNAPSHOTS_FOR_FOLLOWERS)];

function netNew(name, platform) {
  if (!warmedUp) return null;
  const now = history[today]?.[`${name}__${platform}`];
  const base = history[baselineDate]?.[`${name}__${platform}`];
  if (now == null || base == null) return null;
  return now - base;
}

// --- Build per-platform rows, percentile-rank score ---
function percentileRank(values, v) {
  if (v == null) return null;
  const sorted = [...values].filter((x) => x != null).sort((a, b) => a - b);
  if (sorted.length <= 1) return 100;
  const below = sorted.filter((x) => x < v).length;
  const equal = sorted.filter((x) => x === v).length;
  return ((below + equal / 2) / sorted.length) * 100;
}

function scoreRows(rows, metricsAvailable) {
  const weights = { ...WEIGHTS };
  const unavailable = Object.keys(WEIGHTS).filter((k) => !metricsAvailable.includes(k));
  const keep = Object.keys(weights).filter((k) => metricsAvailable.includes(k));
  const renorm = 1 / keep.reduce((a, k) => a + weights[k], 0);
  for (const k of unavailable) weights[k] = 0;
  for (const k of keep) weights[k] *= renorm;

  for (const key of keep) {
    const values = rows.map((r) => r[key]);
    rows.forEach((r) => { r[`_pct_${key}`] = percentileRank(values, r[key]); });
  }
  for (const r of rows) {
    let score = 0, weightSum = 0;
    for (const k of keep) {
      if (r[`_pct_${k}`] != null) { score += weights[k] * r[`_pct_${k}`]; weightSum += weights[k]; }
    }
    r.score = weightSum > 0 ? Math.round((score / weightSum) * 10) / 10 : 0;
  }
  return rows;
}

function buildPlatformRows(platformKey, extractor) {
  const metricsAvailable = platformKey === 'instagram'
    ? ['reels', 'views', 'posts', 'followers', 'reactions', 'comments'] // no shares on Instagram
    : ['reels', 'views', 'posts', 'followers', 'shares', 'reactions', 'comments'];
  const rows = raw.filter((r) => extractor(r)).map((r) => {
    const d = extractor(r);
    return {
      name: r.name,
      seat: r.seat,
      posts: d.posts,
      reels: d.reels,
      comments: d.comments,
      reactions: d.reactions,
      views: d.views,
      shares: d.shares,
      followers: netNew(r.name, platformKey),
    };
  });
  return scoreRows(rows, metricsAvailable);
}

const fbRows = buildPlatformRows('facebook', (r) => r.fb);
const igRows = buildPlatformRows('instagram', (r) => r.ig);

// Combined = Facebook + Instagram metrics summed per MP, re-scored as its own group.
const combinedRaw = raw.map((r) => {
  const fb = r.fb, ig = r.ig;
  if (!fb && !ig) return null;
  const add = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
  return {
    name: r.name,
    seat: r.seat,
    posts: add(fb?.posts, ig?.posts),
    reels: add(fb?.reels, ig?.reels),
    comments: add(fb?.comments, ig?.comments),
    reactions: add(fb?.reactions, ig?.reactions),
    views: add(fb?.views, ig?.views),
    shares: fb?.shares ?? null, // Facebook-only; Instagram never has a value to add.
    followers: add(netNew(r.name, 'facebook'), netNew(r.name, 'instagram')),
  };
}).filter(Boolean);
const combinedRows = scoreRows(combinedRaw, ['reels', 'views', 'posts', 'followers', 'shares', 'reactions', 'comments']);

const out = {
  generated_at: now.toISOString(),
  window_days: WINDOW_DAYS,
  start_date: new Date(windowStartMs).toISOString().slice(0, 10),
  end_date: today,
  followers_warmup: !warmedUp,
  rows: [
    ...fbRows.map((r) => ({ platform: 'Facebook', ...pick(r) })),
    ...igRows.map((r) => ({ platform: 'Instagram', ...pick(r) })),
    ...combinedRows.map((r) => ({ platform: 'Combined', ...pick(r) })),
  ],
};

function pick(r) {
  return { name: r.name, seat: r.seat, score: r.score, followers: r.followers, posts: r.posts, reels: r.reels, comments: r.comments, reactions: r.reactions, shares: r.shares, views: r.views };
}

writeFileSync('data.json', JSON.stringify(out, null, 2));
console.log(`\nWrote data.json — ${out.rows.length} rows. Follower history: ${dates.length} day(s) captured${warmedUp ? '' : ` (need ${MIN_SNAPSHOTS_FOR_FOLLOWERS - dates.length} more before Followers is live)`}.`);
