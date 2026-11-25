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
    // The fate of prisoners after a battle (player/prisonerFates.js)
    'prisonerFates',
    // Harrying the countryside in war (systems/harrying.js, player/harrying.js)
    'harrying',
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
    // The weather on the street map hour by hour: rain, mud, puddles, getting wet (world/streetWeather.js)
    'streetWeather',
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
    // Many crowns on one head: personal union, viceroys, the high crown (systems/highCrowns.js)
    'highCrowns',
    // Personal unions between the AI realms: two crowns on one head (systems/realmUnions.js)
    'realmUnions',
    'crises',
    // The last crisis of the age (systems/lastCrisis.js)
    'lastCrisis',
    // The weight of greatness: graft, drifting provinces, soft heirs, entrenched guilds and clergy (systems/realmDecline.js)
    'realmDecline',
    // The commons rise: grievances, risings, rebel hosts, charters (systems/peasantRevolts.js)
    'peasantRevolts',
    'climate',
    'rivalHouses',
    // Children promised to bind Houses and realms (systems/betrothals.js)
    'betrothals',
    'rivalVoice',
    // Cadet branches of the House (systems/cadetBranches.js)
    'cadetBranches',
    // The war for your own crown at the seat's passing (systems/crownSuccession.js)
    'crownSuccession',
    // Crimes against your own blood (systems/kinCrimes.js)
    'kinCrimes',
    // Maiming: hands, eyes, noses, tongues — the deed, the law, the aids (systems/maiming.js, maimMarks.js)
    'maiming',
    // Public executions: the condemned, the crowd, the last words, martyrs (systems/executions.js)
    'executions',
    // The dead on show and war trophies (systems/gibbets.js, world/deadDisplays.js)
    'gibbets',
    // Pit fights and blood sports: bouts, bear-baiting, cockfights, the book, the law (systems/pitFights.js)
    'pitFights',
    // Lesser punishments and penal labour: the lash, the pillory, the iron, the mines and the oar (systems/penalLabour.js)
    'penalLabour',
    // Flaying: a traitor's skin on the gate, a corrupt judge's over his chair (systems/flaying.js)
    'flaying',
    // Walled up alive, and the castle haunted for generations (systems/immurement.js)
    'immurement',
    // Decimation of a company that broke (player/decimation.js)
    'decimation',
    // A starving garrison eats its dead (systems/eatingTheDead.js)
    'eatingTheDead',
    // The dungeon: putting prisoners to the question (systems/interrogation.js)
    'interrogation',
    'realmIntel',
    'containers',
    // Using furniture indoors: sit, sleep, warm up, read, eat, wash (player/furnitureActions.js)
    'furnitureActions',
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
    // Below decks (berths, galley, hold, cabin) and the ships' officers (systems/belowDecks.js, systems/shipOfficers.js)
    'belowDecks',
    'shipOfficers',
    // Sea fights under sail and royal squadrons on the map (systems/seaFights.js, world/navySquadrons.js)
    'seaFights',
    'animals',
    'swimming',
    'running',
    'pixelIcons',
    'diving',
    'practiceSkills',
    'wrecks',
    'furniture',
    // Interiors planned by rules: sizes, rooms, placement, decor (world/innerMap/interiorPlanner.js)
    'interiorPlans',
    // A shop's real stock on its shelves, counters and barrels (world/innerMap/shopStock.js)
    'shopStock',
    // The player's own house, lived in: rooms, servants, guests, larder (player/household.js)
    'household',
    'crops',
    'craftGrades',
    'livestock',
    // Your own dogs, cats, hawks and the horse, walking with you (systems/animalCompanions.js)
    'animalCompanions',
    // Your horse through fords and swimming you across rivers on the street map (player/horseSwim.js, ui/innerMapHorseSwim.js)
    'horseSwim',
    // Flying your hawk at quarry on the street map (systems/falconry.js, ui/innerMapHawk.js)
    'falconry',
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
    // Wicker fish traps set in the edge water and checked later (systems/fishTraps.js)
    'fishTraps',
    // Small things built with your own hands on the street map: fences, gates, sheds, wells (world/handBuilding.js, ui/innerMapHandBuild.js)
    'handBuilding',
    // A torch or lantern carried at night; fishing by torchlight (systems/carriedLight.js, ui/innerMapTorchlight.js)
    'torchlight',
    // A rowboat of your own on the street map's rivers and lakes (player/rowboats.js, ui/innerMapRowboat.js)
    'rowboats',
    // Pixel sprites for goods lying on the inner map, dropped or afloat (ui/itemSprites.js)
    'itemSprites',
    // The set of the sea (world/oceanCurrents.js)
    'currents',
    // Wind by latitude and season, storms crossing the sea, the coast's dangers, pilots and lighthouses (world/seaWinds.js, systems/seaPassage.js)
    'seaWinds',
    // History written into the land: sited ruins, pass forts, old mines, old roads (world/landHistory.js, terrainGen 17)
    'landHistory',
    'marketStalls',
    // Haggling face to face with a stall's keeper (player/haggling.js, ui/actionMenu/haggle.js)
    'haggling',
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
    // Water: thirst, waterskins, the towns' wells, foul and dry wells, water in sieges, armies and ships (systems/water.js, player/thirst.js)
    'water',
    // The towns' architectural eras, weathering and walls (world/townEras.js)
    'townEras',
    // Questioned by the watch when a town's suspicion adds up (systems/watchQuestioning.js)
    'watchQuestioning',
    'nemesis',
    // Blood feuds and blood money: wergild tariffs, avengers, feuds among the world's own (systems/bloodFeuds.js)
    'bloodFeuds',
    // The law of fratricide: the bowstring, the cage, the spared, the mothers' schemes (systems/fratricide.js)
    'fratricide',
    // Putting a dead enemy on trial: tombs, the synod, its sentences (systems/cadaverSynod.js)
    'cadaverSynod',
    // Wiping a House's name from the world: tombs, chronicles, towns, sons; those who remember (systems/damnatio.js)
    'damnatio',
    // Holy wars, the sees of the faiths, excommunication (systems/holyWars.js); the inquisition (systems/inquisition.js)
    'holyWars', 'inquisition',
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
    'nightStreets',
    // Begging: alms from the passers-by, the cost to a noble name, the townsfolk who fall to it (systems/begging.js)
    'begging',
    // Works of the Ages: cathedrals, universities, great bridges, canals, walls, keeps, harbours over decades (systems/greatWorks.js)
    'greatWorks',
    // Your name on the world: law codes, places named after the House, founding myths, last chapters (systems/namedLegacy.js)
    'namedLegacy',
    // Law courts: the player tried, the player as judge, lawsuits between Houses (player/trials.js)
    'trials',
    // Trial by combat and by ordeal: the hot iron, the water, the bread, oath-helpers, champions (player/ordeals.js)
    'ordeals',
    // Tournaments fought in person on the town's lists: the joust, the melee, wagers (systems/lists.js)
    'lists',
    // Hiding in cover on the street map, being spotted, the ambush, those who lie in wait (systems/stealthCover.js)
    'stealthCover',
    // Pack load: what every good weighs, what you can carry on your back, a horse, a handcart, a horse cart (core/inventory.js)
    'packLoad',
    // The names of the land and the water, drawn like an atlas (world/geoNames.js, ui/renderer/geoLabels.js)
    'geography',
    // Interiors by the hour, the season and what has happened (world/innerMap/interiorState.js)
    'interiorState',
    // Ports as places, ferries and the working boats: harbourmaster and dues, the slip, careening, the fishing fleet, ferries, barges (systems/ports.js, world/ferries.js, systems/barges.js)
    'ports',
    // River size in play: brooks, rivers, great rivers; crossing costs, natural fords, boats by river size (world/rivers.js)
    'rivers'
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
