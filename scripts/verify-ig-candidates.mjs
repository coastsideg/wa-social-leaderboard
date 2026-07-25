import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = process.env.SCRAPECREATORS_API_KEY;

const candidates = {
  'Rita Saffioti': ['rita_saffioti'],
  'Dan Bull': ['danbullmla'],
  'Caitlin Collins': ['caitlincollinshillarys'],
  'Divina D’Anna': ['divinadannamla'],
  'Tony Buti': ['tonybuti_mla'],
  'Emily Hamilton': ['emily.hamilton.mla'],
  'David Scaife': ['davidscaifecockburn'],
  'Michelle Maynard': ['michellemaynardforswanhills'],
  'Lisa Munday': ['lisamunday4dawesville'],
  'Jodie Hanns': ['jodie.hanns'],
  'Steve Catania': ['stevecataniamidland', 'stevecatania'],
  'David Michael': ['david.michael.balcatta'],
  'Stephen Pratt': ['stephenpratt4jandakot'],
};

const base = JSON.parse(readFileSync('roster.base.json', 'utf8'));
const roster = JSON.parse(readFileSync('roster.json', 'utf8'));

for (const [name, handles] of Object.entries(candidates)) {
  const wantId = base.find((x) => x.name === name).instagram_id;
  let found = null;
  for (const handle of handles) {
    const res = await fetch(`https://api.scrapecreators.com/v1/instagram/profile?handle=${handle}&trim=true`, {
      headers: { 'x-api-key': KEY },
    });
    const body = await res.json();
    const fbid = body?.data?.user?.fbid;
    const followers = body?.data?.user?.edge_followed_by?.count;
    console.log(name, handle, '-> fbid', fbid, fbid === wantId ? 'MATCH' : 'no match', 'followers', followers);
    if (fbid === wantId) { found = { handle, followerCount: followers }; break; }
  }
  const entry = roster.find((x) => x.name === name);
  if (found) entry.instagram = { id: wantId, handle: found.handle, followerCount: found.followerCount };
  else console.log(`!! NO MATCH for ${name} — leaving instagram null`);
}

writeFileSync('roster.json', JSON.stringify(roster, null, 2));
console.log('done');
