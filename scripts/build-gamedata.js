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
    'achievements', 'artifacts', 'assets', 'cartography', 'characters',
    'colonization', 'culture', 'earlyJobs', 'economy', 'espionage',
    'housing', 'infrastructure', 'innerMap', 'innerMapRenderer',
    'kingdomAI', 'kingdoms', 'market', 'military', 'npcLords',
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

// ── custom_buildings/ ───────────────────────────────────────────────
const cbDir      = path.join(dataDir, 'custom_buildings');
const cbManifest = readJson(path.join(cbDir, 'manifest.json')) || { files: [] };
merged.custom_buildings = { manifest: cbManifest, files: {} };
for (const f of (cbManifest.files || [])) {
    const data = readJson(path.join(cbDir, f));
    if (data !== null) { merged.custom_buildings.files[f] = data; console.log(`  + custom_buildings/${f}`); }
}

// ── custom_objects/ ─────────────────────────────────────────────────
const coDir      = path.join(dataDir, 'custom_objects');
const coManifest = readJson(path.join(coDir, 'manifest.json')) || { files: [] };
merged.custom_objects = { manifest: coManifest, files: {} };
for (const f of (coManifest.files || [])) {
    const data = readJson(path.join(coDir, f));
    if (data !== null) { merged.custom_objects.files[f] = data; console.log(`  + custom_objects/${f}`); }
}

// ── Write output ─────────────────────────────────────────────────────
const out  = path.join(dataDir, 'gamedata.json');
fs.writeFileSync(out, JSON.stringify(merged));
const size = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`\nWrote data/gamedata.json  (${size} KB, ${Object.keys(merged).length} top-level keys)`);
