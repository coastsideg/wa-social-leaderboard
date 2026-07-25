// Converts the "WA Labor Social Media Dashboard" xlsx export (Supermetrics -> LOOKER tab)
// into data.json for the static leaderboard site.
//
// Usage: node scripts/build-data.mjs "path/to/WA Labor Social Media Dashboard.xlsx"
//
// Assumes the fixed layout of that specific export:
//   LOOKER tab: Platform | MP | Seat | Score | New_Followers | Posts | Reels |
//               Comments | Reactions | Shares | Views | Last_Updated
//   FB Followers / IG Followers History tabs: Page | Date | Followers
// If Supermetrics changes the tab/column layout this script will need updating.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const srcPath = process.argv[2];
if (!srcPath) {
  console.error('Usage: node scripts/build-data.mjs <path-to-xlsx>');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'wa-social-'));
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${srcPath.replace(/'/g, "''")}', '${work.replace(/'/g, "''")}')`,
]);

function loadSharedStrings() {
  const xml = readFileSync(join(work, 'xl/sharedStrings.xml'), 'utf8');
  const sst = [];
  const siRe = /<si>(.*?)<\/si>/gs;
  let m;
  while ((m = siRe.exec(xml))) {
    const t = m[1].match(/<t[^>]*>(.*?)<\/t>/s);
    sst.push(t ? decodeXml(t[1]) : '');
  }
  return sst;
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function loadSheetNames() {
  const xml = readFileSync(join(work, 'xl/workbook.xml'), 'utf8');
  const rels = readFileSync(join(work, 'xl/_rels/workbook.xml.rels'), 'utf8');
  const ridToTarget = {};
  for (const m of rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
    ridToTarget[m[1]] = m[2];
  }
  const nameToFile = {};
  for (const m of xml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    nameToFile[m[1]] = ridToTarget[m[2]].replace('worksheets/', '');
  }
  return nameToFile;
}

function readSheet(fileName, sst) {
  const xml = readFileSync(join(work, 'xl/worksheets', fileName), 'utf8');
  const rows = xml.match(/<row r="\d+">.*?<\/row>/g) || [];
  const grid = rows.map((r) => {
    const cells = [...r.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>(.*?)<\/v>)?<\/c>/g)];
    const obj = {};
    for (const [, col, attrs, val] of cells) {
      if (val === undefined) continue;
      const isStr = /t="s"/.test(attrs);
      obj[col] = isStr ? sst[Number(val)] : Number(val);
    }
    return obj;
  });
  const header = grid[0];
  const headerNames = {};
  for (const [col, val] of Object.entries(header)) headerNames[col] = val;
  return grid.slice(1).map((row) => {
    const named = {};
    for (const [col, name] of Object.entries(headerNames)) named[name] = row[col];
    return named;
  });
}

function excelSerialToISODate(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

const sst = loadSharedStrings();
const sheetFiles = loadSheetNames();

const looker = readSheet(sheetFiles['LOOKER'], sst);

// Work out the "as of" date and window length from the FB Followers history tab
// (one row per page per day in the trailing window).
const fbFollowers = readSheet(sheetFiles['FB Followers'], sst);
const dates = [...new Set(fbFollowers.map((r) => r['Date']).filter((d) => typeof d === 'number'))].sort();
const windowDays = dates.length && fbFollowers.length
  ? Math.round(fbFollowers.length / new Set(fbFollowers.map((r) => r['Page'] ?? r['Page name'])).size)
  : null;
const asOfDate = dates.length ? excelSerialToISODate(dates[dates.length - 1]) : null;
const fromDate = dates.length ? excelSerialToISODate(dates[0]) : null;

const rows = looker
  .filter((r) => r['Platform'] && r['MP'])
  .map((r) => ({
    platform: r['Platform'],
    name: r['MP'],
    seat: r['Seat'] || null,
    score: r['Score'] ?? null,
    followers: r['New_Followers'] ?? null,
    posts: r['Posts'] ?? null,
    reels: r['Reels'] ?? null,
    comments: r['Comments'] ?? null,
    reactions: r['Reactions'] ?? null,
    shares: r['Shares'] ?? null,
    views: r['Views'] ?? null,
  }));

const out = {
  generated_at: new Date().toISOString(),
  window_days: windowDays,
  start_date: fromDate,
  end_date: asOfDate,
  rows,
};

writeFileSync(join(process.cwd(), 'data.json'), JSON.stringify(out, null, 2));
rmSync(work, { recursive: true, force: true });
console.log(`Wrote data.json — ${rows.length} rows, window ${fromDate} to ${asOfDate} (${windowDays} days)`);
