#!/usr/bin/env node
/**
 * Scans games/*.html and writes games.json so the homepage picks up new
 * games without anyone hand-editing index.html.
 *
 * Run locally with: node generate-manifest.js
 * Or wire it to a GitHub Action (see .github/workflows/build-manifest.yml)
 * so it runs itself every time you push a new game.
 *
 * This can only see local .html files. Games embedded from other sites
 * (iframes, external links) have no local file to scan, so they still
 * need one manual line below in EXTERNAL_LINKS. That's unavoidable, an
 * external URL isn't something a folder scan can discover.
 */

const fs = require('fs');

const GAMES_DIR = 'games';
const OUTPUT = 'games.json';

const EXTERNAL_LINKS = [
  { name: 'Cookie Clicker', url: 'https://cookieclickernew.com/' },
  { name: 'Messages', url: 'https://tlk.io/mysite-chat' }
];

function listHtmlBaseNames(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`No "${dir}" folder found. Run this from your site's root.`);
    return [];
  }
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.html'))
    .map(f => f.slice(0, -5))
    .filter(n => n.trim().length > 0);
}

const localGames = listHtmlBaseNames(GAMES_DIR).map(name => ({ name }));

const merged = [...localGames, ...EXTERNAL_LINKS];
const seen = new Set();
const deduped = merged.filter(g => {
  if (seen.has(g.name)) return false;
  seen.add(g.name);
  return true;
});

deduped.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(OUTPUT, JSON.stringify(deduped, null, 2) + '\n');
console.log(`Wrote ${deduped.length} entries to ${OUTPUT}`);
