// Reports which roster pages the Meta Graph token can actually reach, so we know
// who gets full API data vs who falls back to the (3-post-capped) public scrape.
//
// Usage: node scripts/check-graph-access.mjs

import 'dotenv/config';
import { readFileSync } from 'node:fs';

const TOKEN = process.env.META_ACCESS_TOKEN;
if (!TOKEN) { console.error('Set META_ACCESS_TOKEN in .env'); process.exit(1); }

const roster = JSON.parse(readFileSync('roster.json', 'utf8'));
const ok = [], no = [];

for (const mp of roster) {
  if (!mp.facebook?.id) continue;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${mp.facebook.id}?fields=access_token,name&access_token=${TOKEN}`);
    const body = await res.json();
    if (body.access_token) ok.push(`${mp.name} (${body.name})`);
    else no.push(`${mp.name} — ${body.error?.message?.slice(0, 60) || 'no page token returned'}`);
  } catch (e) {
    no.push(`${mp.name} — ${e.message}`);
  }
}

console.log(`\nGraph API access OK (${ok.length}):`);
ok.forEach((n) => console.log('  ✓', n));
console.log(`\nNo Graph access, will use scrape fallback (${no.length}):`);
no.forEach((n) => console.log('  ✗', n));
