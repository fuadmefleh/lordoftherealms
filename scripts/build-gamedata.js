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
    'patronage', 'digging', 'carrying', 'downed', 'npcChat', 'llmModels',
    'outlawLairs',
    'atrocities',
    'finance',
    'markets',
    'merchantCaravans',
    'merchantPrince',
    'labour',
    'migration',
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
    'streetSeasons',
    'townScenes',
    'knockout',
    'jail',
    'seats',
    'lots',
    'construction',
    'laws',
    'duels',
    'arms',
    'crafting',
    'mercenaryContracts',
    'generalship',
    'escort',
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
    'travel',
    'realmGrowth',
    'firstSteps',
    'afterlife',
    'scenarios',
    'annals',
    'heirlooms',
    'coalitions',
    'crises',
    'climate',
    'rivalHouses',
    'rivalVoice',
    // Cadet branches of the House (systems/cadetBranches.js)
    'cadetBranches',
    // Crimes against your own blood (systems/kinCrimes.js)
    'kinCrimes',
    'realmIntel',
    'containers',
    'townProps',
    'buildingFloors',
    'mapTasks',
    'performTasks',
    'wildTasks',
    'dawn',
    'eras',
    'birth',
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
    // The player's own house, lived in: rooms, servants, guests, larder (player/household.js)
    'household',
    'crops',
    'craftGrades',
    'livestock',
    'graves',
    'ambient',
    'autoUpkeep',
    // What the spare hours of each day go on (player/standingOrders.js)
    'standingOrders',
    'riverDrift',
    // Caves and mines: the rock cut by hand, its geology, the bigger crags of terrainGen 9 (world/innerMap/mines.js)
    'mining',
    // River boats, fishing rights, salting and spring floods (systems/riverBoats.js, systems/riverLife.js)
    'riverLife',
    // Pixel sprites for goods lying on the inner map, dropped or afloat (ui/itemSprites.js)
    'itemSprites',
    // The set of the sea (world/oceanCurrents.js)
    'currents',
    'marketStalls',
    'npcTheft',
    'brawls',
    'romance',
    'townJobs',
    'townWorship',
    'illness',
    // Plague in the streets: severity, shut gates, nursing, burning, remedies, looting (systems/plague.js)
    'plague',
    'townFamily',
    'townSchool',
    // Who can read, town by town, and what letters change (systems/literacy.js)
    'literacy',
    'townTrade',
    'carts',
    // Stewards, bailiffs and governors (systems/stewards.js)
    'stewards',
    // The Inventory window's filters by kind (ui/inventoryView.js, ui/ui/inventoryPanel.js)
    'inventory',
    // Standing trade and supply lines run by a caravan or a ship (player/tradeLines.js)
    'tradeLines',
    // The Hall of Houses' unlocks, kept across games (systems/metaLegacy.js)
    'metaLegacy',
    'chronicleBook',
    'npcMemory',
    // Companions lost on the road with the player (systems/vanishings.js)
    'vanishings',
    'townMemory',
    // Deplorable acts against a town: a poisoned well, a plague lie, a burnt granary, hoarded grain (systems/townCrimes.js)
    'townCrimes',
    // The towns' architectural eras, weathering and walls (world/townEras.js)
    'townEras',
    // Questioned by the watch when a town's suspicion adds up (systems/watchQuestioning.js)
    'watchQuestioning',
    'nemesis',
    // Friends & Bonds: sworn kin, drinking companions, mentors, protégés (systems/bonds.js)
    'bonds',
    // Personal quests from the House's own history (systems/houseQuests.js)
    'houseQuests',
    // The Timeline of the Realm (systems/realmTimeline.js)
    'timeline',
    // The Almanac of the World (systems/almanac.js)
    'almanac',
    // Letters written freely, answered by the AI brain (systems/letterChat.js)
    'letterChat',
    // Townsfolk talking about the player within earshot (systems/overheard.js)
    'overheard',
    // What townsfolk remember you told them, and the hearsay that travels town to town (systems/hearsay.js)
    'hearsay',
    // Profane crimes: crypts desecrated, relics stolen/sold/faked, witch accusations (systems/profaneCrimes.js)
    'profaneCrimes',
    // Crimes against people: framing, bondage, the stocks, winter evictions, branding, starving captives (systems/peopleCrimes.js)
    'peopleCrimes',
    // Consequences that follow you: charge sheets, posters, bounty hunters, blood debts (systems/wanted.js)
    'wanted',
    // The night-time underworld on the street map: curfews, smugglers' landings, the thieves' market (systems/nightStreets.js)
    'nightStreets'
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
