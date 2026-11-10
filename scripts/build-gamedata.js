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
    'ships', 'tavern', 'technology', 'terrain', 'titles', 'units', 'worldEvents',
    'gossip', 'streetCrime', 'traits', 'petitions', 'companions', 'delves',
    'underworld', 'throne', 'holdings', 'rivals', 'ailments', 'upbringing',
    'sagas', 'discovery', 'merchantHouses', 'kingship', 'counsel', 'chatter',
    'patronage', 'digging', 'npcChat',
    'outlawLairs',
    'finance',
    'markets',
    'merchantCaravans',
    'merchantPrince',
    'labour',
    'guilds',
    'priceKnowledge',
    'hinterland',
    'tradePolicy',
    'harvests',
    'chronicle',
    'bourse',
    'transport',
    'mints',
    'fiscal',
    'estates',
    'townsfolk',
    'npcTasks',
    'npcKnowledge',
    'townLife',
    'knockout',
    'jail',
    'seats',
    'lots',
    'laws',
    'duels',
    'arms',
    'crafting',
    'mercenaryContracts',
    'devotion',
    'books',
    'feasts',
    'fame',
    'house',
    'lordMemory',
    'courtLetters',
    'couriers',
    'pirates',
    'hospitality',
    'firstSteps',
    'afterlife',
    'scenarios',
    'annals',
    'coalitions',
    'rivalHouses',
    'rivalVoice',
    'realmIntel',
    'containers',
    'townProps',
    'buildingFloors',
    'mapTasks',
    'performTasks',
    'wildTasks',
    'dawn',
    'cultures',
    'architecture',
    'shipHulls',
    'commissions',
    'deckLife',
    'animals',
    'swimming',
    'diving',
    'practiceSkills',
    'wrecks',
    'furniture',
    'crops',
    'craftGrades',
    'livestock',
    'graves',
    'ambient'
];

const merged = {};

// ── Top-level files ──────────────────────────────────────────────────
for (const name of topLevel) {
    const data = readJson(path.join(dataDir, `${name}.json`));
    if (data !== null) { merged[name] = data; console.log(`  + ${name}.json`); }
}

// ── The grave art's manifest (assets/lpc/new/graves/manifest.json, scripts/make_graves.py) → graves.art ──
// (world/graveArt.js stands a marker on the map only once its sprite is listed here)
if (merged.graves) {
    const dir = merged.graves.artDir || 'assets/lpc/new/graves';
    const man = path.join(__dirname, '..', dir, 'manifest.json');
    if (fs.existsSync(man)) {
        const art = readJson(man);
        if (art) { merged.graves.art = art; console.log(`  + ${dir}/manifest.json → graves.art (${Object.keys(art).length} sprites)`); }
    }
}

// ── The ambient art's manifest (assets/lpc/new/anim/manifest.json) → ambient.art ──
// (ui/innerMapLayers/ambient.js draws a moving part — a waterwheel, sails — only once its art is listed here)
if (merged.ambient) {
    const dir = merged.ambient.artDir || 'assets/lpc/new/anim';
    const man = path.join(__dirname, '..', dir, 'manifest.json');
    if (fs.existsSync(man)) {
        const art = readJson(man);
        if (art) { merged.ambient.art = art; console.log(`  + ${dir}/manifest.json → ambient.art (${Object.keys(art).length} pieces)`); }
    }
}

// ── skillPacks/: more practised skills, each file deep-merged into practiceSkills ──
// (a pack: { skills: {...}, npc: { base, roles, dailyXp, ... } }; objects merge, values replace)
{
    const deepMerge = (into, from) => {
        for (const [k, v] of Object.entries(from || {})) {
            if (k.startsWith('_')) continue;
            if (v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object' && !Array.isArray(into[k])) deepMerge(into[k], v);
            else into[k] = v;
        }
        return into;
    };
    const packDir = path.join(dataDir, 'skillPacks');
    if (merged.practiceSkills && fs.existsSync(packDir)) {
        for (const f of fs.readdirSync(packDir).filter(f => f.endsWith('.json')).sort()) {
            const data = readJson(path.join(packDir, f));
            if (data !== null) { deepMerge(merged.practiceSkills, data); console.log(`  + skillPacks/${f}`); }
        }
    }
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
