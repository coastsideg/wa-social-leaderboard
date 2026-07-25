// One-time (re-run only if the roster changes) resolution of each MP's Facebook
// canonical page URL and Instagram handle, starting from the numeric page/business
// account IDs already present in the source spreadsheet's Supermetrics config.
//
// Why this is needed: ScrapeCreators' /v1/facebook/profile/posts only reliably
// returns posts when called with the page's canonical vanity `url` — calling it with
// `pageId` alone silently returns an empty list. And Instagram lookups need a
// `handle`, not the numeric business-account id. Both had to be resolved once,
// against the live API, then cached here so daily ingest doesn't re-resolve them.
//
// Usage: node scripts/resolve-roster.mjs roster.base.json > roster.json

import { readFileSync } from 'node:fs';
import 'dotenv/config';

const KEY = process.env.SCRAPECREATORS_API_KEY;
if (!KEY) { console.error('Set SCRAPECREATORS_API_KEY (.env)'); process.exit(1); }

const baseRoster = JSON.parse(readFileSync(process.argv[2], 'utf8'));

async function sc(path, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://api.scrapecreators.com${path}?${qs}`, {
    headers: { 'x-api-key': KEY },
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`${path} ${qs} -> ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

function slugGuess(label) {
  // WA Labor MP FB/IG handles are usually a lowercase, no-space version of the FB
  // page name, e.g. "Roger Cook" -> "rogercook", "Rita Saffioti MLA" -> "ritasaffiotimla".
  return label.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

async function resolveFacebook(mp) {
  const data = await sc('/v1/facebook/profile', { url: `https://www.facebook.com/profile.php?id=${mp.facebook_id}` });
  return { url: data.url, followerCount: data.followerCount, likeCount: data.likeCount, resolvedName: data.name };
}

async function resolveInstagramHandle(mp, fbUrl) {
  const candidates = new Set();
  if (fbUrl) {
    const m = fbUrl.match(/facebook\.com\/([^/?]+)/);
    if (m) candidates.add(m[1].toLowerCase());
  }
  candidates.add(slugGuess(mp.instagram_label));
  candidates.add(slugGuess(mp.name));
  for (const handle of candidates) {
    try {
      const data = await sc('/v1/instagram/profile', { handle, trim: 'true' });
      if (data.data?.user?.fbid === mp.instagram_id) {
        return { handle, followerCount: data.data.user.edge_followed_by.count };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

const out = [];
for (const mp of baseRoster) {
  process.stderr.write(`Resolving ${mp.name}... `);
  const entry = { name: mp.name, seat: mp.seat, facebook: null, instagram: null };
  try {
    const fb = await resolveFacebook(mp);
    entry.facebook = { id: mp.facebook_id, url: fb.url, followerCount: fb.followerCount };
  } catch (e) {
    process.stderr.write(`[FB FAILED: ${e.message}] `);
  }
  if (mp.instagram_id) {
    const ig = await resolveInstagramHandle(mp, entry.facebook?.url);
    if (ig) entry.instagram = { id: mp.instagram_id, handle: ig.handle, followerCount: ig.followerCount };
    else process.stderr.write('[IG handle not found] ');
  }
  process.stderr.write('done\n');
  out.push(entry);
}

console.log(JSON.stringify(out, null, 2));
