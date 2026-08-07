// Adds (or updates) one person in roster.json from a plain Facebook/Instagram URL —
// no numeric IDs or handles needed up front. Resolves and verifies both accounts live
// against ScrapeCreators before writing, so a bad URL fails loudly instead of silently
// corrupting the roster.
//
// Usage:
//   node scripts/add-mp.mjs "Name" "Seat" "https://facebook.com/..." "https://instagram.com/..."
// Instagram URL is optional — pass "" to skip it (some people only run Facebook).

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.SCRAPECREATORS_API_KEY;
if (!KEY) { console.error('Set SCRAPECREATORS_API_KEY (.env)'); process.exit(1); }

const [name, seat, fbUrl, igUrl] = process.argv.slice(2);
if (!name || !fbUrl) {
  console.error('Usage: node scripts/add-mp.mjs "Name" "Seat" "<facebook-url>" "<instagram-url-or-empty>"');
  process.exit(1);
}

async function sc(path, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://api.scrapecreators.com${path}?${qs}`, { headers: { 'x-api-key': KEY } });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`${path} ${qs} -> ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

function igHandleFromUrl(url) {
  const m = url.match(/instagram\.com\/([^/?]+)/);
  if (!m) throw new Error(`Not a recognisable Instagram URL: ${url}`);
  return m[1];
}

const entry = { name, seat: seat || null, facebook: null, instagram: null };

console.log(`Resolving Facebook: ${fbUrl}`);
const fb = await sc('/v1/facebook/profile', { url: fbUrl });
// Use adLibrary.pageId, NOT fb.id — the latter is a profile-style id (100057…) that the
// Meta Graph API can't resolve. adLibrary.pageId is the real numeric Page ID, which is
// what the Graph API path in ingest.mjs needs.
const pageId = fb.adLibrary?.pageId || fb.id;
entry.facebook = { id: pageId, url: fb.url, followerCount: fb.followerCount ?? fb.likeCount ?? null };
console.log(`  -> "${fb.name}", ${entry.facebook.followerCount} followers, page id ${pageId}, canonical url ${fb.url}`);

if (igUrl) {
  const handle = igHandleFromUrl(igUrl);
  console.log(`Resolving Instagram: @${handle}`);
  const ig = await sc('/v1/instagram/profile', { handle, trim: 'true' });
  entry.instagram = { id: ig.data.user.fbid, handle, followerCount: ig.data.user.edge_followed_by.count };
  console.log(`  -> "${ig.data.user.full_name}", ${entry.instagram.followerCount} followers`);
}

const rosterPath = 'roster.json';
const roster = existsSync(rosterPath) ? JSON.parse(readFileSync(rosterPath, 'utf8')) : [];
const i = roster.findIndex((r) => r.name === name);
if (i >= 0) { roster[i] = entry; console.log(`Updated existing entry for ${name}.`); }
else { roster.push(entry); console.log(`Added new entry for ${name}.`); }

writeFileSync(rosterPath, JSON.stringify(roster, null, 2));
console.log(`roster.json now has ${roster.length} people. Run scripts/ingest.mjs to pull their data in.`);
