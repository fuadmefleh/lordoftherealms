#!/usr/bin/env node
// ============================================================
// scripts/build-gamedata.js
// Merges all data/*.json files into data/gamedata.json.
// Run with:  npm run build:data
// ============================================================

const fs   = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

function readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.warn(`  [SKIP] ${p} — ${e.message}`); return null; }
}

const topLevel = [
    'achievements', 'artifacts', 'assets', 'buildings', 'cartography', 'characters',
    'colonization', 'culture', 'earlyJobs', 'economy', 'espionage',
    'housing', 'infrastructure', 'innerMap', 'innerMapRenderer', 'interiors',
    'kingdomAI', 'kingdoms', 'market', 'military', 'npcLords', 'objects',
    'peoples', 'playerEconomy', 'quests', 'relationships', 'religion',
    'ships', 'tavern', 'technology', 'terrain', 'titles', 'units', 'worldEvents'
];

const merged = {};

// ── Top-level files ──────────────────────────────────────────────────
for (const name of topLevel) {
    const data = readJson(path.join(dataDir, `${name}.json`));
    if (data !== null) { merged[name] = data; console.log(`  + ${name}.json`); }
}

// ── spritesheets/ ────────────────────────────────────────────────────
merged.spritesheets = {};
const ssDir = path.join(dataDir, 'spritesheets');
for (const f of fs.readdirSync(ssDir).filter(f => f.endsWith('.json'))) {
    const key  = f.replace('.json', '');
    const data = readJson(path.join(ssDir, f));
    if (data !== null) { merged.spritesheets[key] = data; console.log(`  + spritesheets/${f}`); }
}

// ── Write output ─────────────────────────────────────────────────────
const out  = path.join(dataDir, 'gamedata.json');
fs.writeFileSync(out, JSON.stringify(merged));
const size = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`\nWrote data/gamedata.json  (${size} KB, ${Object.keys(merged).length} top-level keys)`);
