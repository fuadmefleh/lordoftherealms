// Cartography — usage members (split from the original monolith).
import { Cartography } from './_ref.js';
import { Utils, Hex, KingdomAtlas } from './_imports.js';
import { Quests } from '../quests.js';

Object.assign(Cartography, {
    // ── Map Reading / Applying ─────────────────
    /**
     * Apply a map — reveal tiles to the player based on map data & accuracy
     */
    /** opts.detected: the reader already saw through the map's alterations. */
    applyMap(player, map, world, opts = {}) {
        const accuracy = map.accuracy || 0.5;
        let tilesRevealed = 0;

        // Kingdom maps: reveal all kingdom territory tiles
        if (map.type === 'kingdom' && map.tiles && map.tiles.length > 0) {
            for (const t of map.tiles) {
                const tile = world.getTile(t.q, t.r);
                if (!tile) continue;
                tile.explored = true;
                tilesRevealed++;
            }
            // Also reveal a radius around the capital for border context
            if (map.centerQ !== undefined && map.centerR !== undefined) {
                const hexes = Hex.hexesInRange(map.centerQ, map.centerR, 5);
                for (const hex of hexes) {
                    const tile = world.getTile(hex.q, hex.r);
                    if (!tile) continue;
                    if (!tile.explored) {
                        tile.explored = true;
                        tilesRevealed++;
                    }
                }
            }
        }
        // Continent maps: reveal all tiles with matching regionId
        else if (map.type === 'continent' && map.regionId !== undefined) {
            for (let r = 0; r < world.height; r++) {
                for (let q = 0; q < world.width; q++) {
                    const tile = world.getTile(q, r);
                    if (!tile) continue;
                    if (tile.regionId === map.regionId) {
                        if (Utils.random() > accuracy) continue;
                        if (!tile.explored) {
                            tile.explored = true;
                            tilesRevealed++;
                        }
                    }
                }
            }
        }
        // Standard maps: use radius circle
        else {
            const hexes = Hex.hexesInRange(map.centerQ, map.centerR, map.radius);
            for (const hex of hexes) {
                const tile = world.getTile(hex.q, hex.r);
                if (!tile) continue;
                if (Utils.random() > accuracy) continue;
                tile.explored = true;
                tilesRevealed++;
            }
        }

        // Mark treasure maps
        if (map.type === 'treasure' && map.treasureQ !== undefined) {
            const tTile = world.getTile(map.treasureQ, map.treasureR);
            if (tTile) {
                tTile.explored = true;
                if (!tTile.improvement && tTile.terrain.passable) {
                    tTile.improvement = {
                        type: 'treasure_cache',
                        icon: '💎',
                        name: 'Buried Treasure',
                        explored: false,
                        founded: 0,
                    };
                }
            }
        }

        // Ancient maps may reveal POI locations
        if (map.isAncient && map.sites) {
            for (const site of map.sites) {
                const siteTile = world.getTile(site.q, site.r);
                if (siteTile) siteTile.explored = true;
            }
        }

        // Cartography skill gain from reading maps made by others
        if (map.createdBy !== player.name) {
            player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.05);
        }

        const deceit = (map.createdBy === player.name || opts.detected)
            ? { planted: 0, spotted: 0 }
            : Cartography.plantDeceptions(player, map, world);

        return {
            tilesRevealed, accuracy,
            hasErrors: (map.deliberateErrors || []).length > 0,
            deceptionsPlanted: deceit.planted,
            deceptionsSpotted: deceit.spotted,
        };
    },

    // ── Map Deceptions ─────────────────────────
    /** Cartography skill at which you notice each alteration on a map you read. */
    SPOT_ALTERATION_SKILL: 6,

    /**
     * Reading a doctored or propaganda map plants its falsehoods in your own
     * picture of the world: phantom towns, roads that aren't there, wrong
     * terrain, inflated borders. They show on your map until you see the
     * hex for yourself. A skilled cartographer (SPOT_ALTERATION_SKILL+)
     * notices each alteration with 15% per skill point above 5.
     * Returns { planted, spotted }.
     */
    plantDeceptions(player, map, world) {
        const out = { planted: 0, spotted: 0 };
        const errors = map.deliberateErrors || [];
        if (errors.length === 0) return out;
        if (!player.mapDeceptions) player.mapDeceptions = {};
        const skill = (player.skills && player.skills.cartography) || 0;
        const spotChance = skill >= Cartography.SPOT_ALTERATION_SKILL ? Math.min(0.9, (skill - 5) * 0.15) : 0;

        for (const err of errors) {
            const tile = world.getTile(err.q, err.r);
            if (!tile || tile.visible) continue; // can't fool eyes on the ground
            if (spotChance > 0 && Utils.random() < spotChance) {
                out.spotted++;
                continue;
            }
            const key = `${err.q},${err.r}`;
            player.mapDeceptions[key] = { ...err, mapName: map.name, source: map.createdBy || 'unknown', since: world.day || 0 };
            tile.explored = true;
            out.planted++;
        }
        return out;
    },

    /** The falsehood your maps tell about this hex, if any. */
    getDeception(player, q, r) {
        return (player && player.mapDeceptions && player.mapDeceptions[`${q},${r}`]) || null;
    },

    /**
     * Falsehoods are exposed once you see their hex. Returns the exposed
     * deceptions (for messages) — seeing through a phantom town or a stolen
     * border earns a little cartography skill.
     */
    exposeDeceptions(player, world) {
        const exposed = [];
        if (!player || !player.mapDeceptions) return exposed;
        for (const [key, d] of Object.entries(player.mapDeceptions)) {
            const tile = world.getTile(d.q, d.r);
            if (!tile || !tile.visible) continue;
            exposed.push(d);
            delete player.mapDeceptions[key];
        }
        if (exposed.length > 0 && player.skills) {
            player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.02 * exposed.length);
        }
        return exposed;
    },

    /** One line describing a deception, as your map shows it. */
    describeDeception(d, world) {
        switch (d.type) {
            case 'settlement': return `a settlement called "${d.false_settlement}"`;
            case 'terrain': return `${String(d.false_terrain).replace(/_/g, ' ')}`;
            case 'path': return 'a road';
            case 'false_border': {
                const k = world && world.getKingdom ? world.getKingdom(d.claimedKingdom) : null;
                return `the lands of ${k ? k.name : 'a rival realm'}`;
            }
            default: return 'something that is not there';
        }
    },

    /**
     * Dig up treasure at a treasure map location
     */
    digTreasure(player, world, q, r) {
        const tile = world.getTile(q, r);
        if (!tile) return { success: false, reason: 'Invalid location.' };

        if (tile.buried && !tile.buried.discovered) {
            const gold = tile.buried.gold;
            player.gold += gold;
            tile.buried.discovered = true;

            // Remove the treasure POI
            if (tile.improvement && tile.improvement.type === 'treasure_cache') {
                tile.improvement = null;
            }

            let bonusText = '';
            if (tile.buried.items && tile.buried.items.length > 0) {
                player.renown = (player.renown || 0) + 10;
                bonusText = ' You also found an ancient relic! (+10 renown)';
            }

            player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.3);
            Quests.track(player, 'treasures_found');
            return { success: true, gold, bonusText };
        }

        return { success: false, reason: 'Nothing buried here.' };
    },

    // ── Stolen Maps ────────────────────────────
    /**
     * Attempt to steal a map from a settlement/tavern
     */
    attemptStealMap(player, world, tile) {
        const skill = player.skills.stealth || 1;
        const chance = 0.2 + skill * 0.08;
        const roll = Utils.random();

        if (roll < chance) {
            // Success — generate a useful stolen map
            const stolenMap = Cartography._generateStolenMap(world, tile);
            if (!player.maps) player.maps = [];
            player.maps.push(stolenMap);

            player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 0.1);
            player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.1);

            return {
                success: true,
                caught: false,
                map: stolenMap,
                message: `You successfully pilfered a ${stolenMap.name}!`,
            };
        } else if (roll < chance + 0.3) {
            // Caught!
            const fine = Utils.randInt(50, 200);
            const actualFine = Math.min(fine, player.gold);
            player.gold -= actualFine;
            player.renown = Math.max(0, (player.renown || 0) - 5);

            // Reputation hit with local kingdom
            if (tile.kingdom) {
                player.reputation[tile.kingdom] = Math.max(-100, (player.reputation[tile.kingdom] || 0) - 15);
            }

            return {
                success: false,
                caught: true,
                fine: actualFine,
                message: `Caught stealing! Fined ${actualFine} gold and lost reputation.`,
            };
        } else {
            // Failed but not caught
            return {
                success: false,
                caught: false,
                message: 'You couldn\'t find any maps worth taking.',
            };
        }
    },

    /**
     * Generate a stolen map
     */
    _generateStolenMap(world, tile) {
        const types = ['regional', 'kingdom', 'survey'];
        const type = Utils.randPick(types);

        let map;
        if (type === 'kingdom' && tile.kingdom) {
            const kingdom = world.getKingdom(tile.kingdom);
            if (kingdom && kingdom.capital) {
                map = {
                    id: `stolen_${Date.now()}_${Utils.randInt(0, 9999)}`,
                    type: 'kingdom',
                    name: `Stolen Map of ${kingdom.name}`,
                    icon: '🗡️',
                    quality: Utils.randPick(['basic', 'detailed']),
                    accuracy: 0.6 + Utils.random() * 0.2,
                    kingdomId: kingdom.id,
                    centerQ: kingdom.capital.q,
                    centerR: kingdom.capital.r,
                    radius: Cartography.MAP_TYPES.stolen.radius,
                    createdDay: world.day,
                    createdBy: `${kingdom.name} Archives`,
                    value: Utils.randInt(40, 100),
                    tiles: Cartography._chartKingdomTiles(kingdom, world, 0.7),
                    deliberateErrors: [],
                    isPropaganda: false,
                    isStolen: true,
                    isAncient: false,
                    notes: `Stolen from ${kingdom.name}'s records.`,
                };
            }
        }

        if (!map) {
            const q = tile.q || Utils.randInt(0, world.width - 1);
            const r = tile.r || Utils.randInt(5, world.height - 6);
            map = {
                id: `stolen_${Date.now()}_${Utils.randInt(0, 9999)}`,
                type: 'regional',
                name: `Stolen Regional Map`,
                icon: '🗡️',
                quality: Utils.randPick(['crude', 'basic', 'detailed']),
                accuracy: 0.5 + Utils.random() * 0.3,
                centerQ: q,
                centerR: r,
                radius: Cartography.MAP_TYPES.regional.radius,
                createdDay: world.day,
                createdBy: 'Unknown',
                value: Utils.randInt(20, 60),
                tiles: Cartography._chartTiles(q, r, Cartography.MAP_TYPES.regional.radius, world, 0.6),
                deliberateErrors: [],
                isPropaganda: false,
                isStolen: true,
                isAncient: false,
                notes: 'Acquired through... unconventional means.',
            };
        }

        return map;
    },

    // ── Map Trading ────────────────────────────
    /**
     * Get maps available for purchase at a settlement
     */
    getAvailableMapsForSale(tile, world) {
        const maps = [];
        if (!tile.settlement) return maps;

        const settlement = tile.settlement;
        const isCity = settlement.type === 'capital' || settlement.type === 'city' || settlement.type === 'town';

        // Local regional map
        const q = tile.q !== undefined ? tile.q : 0;
        const r = tile.r !== undefined ? tile.r : 0;

        maps.push({
            map: {
                id: `sale_regional_${q}_${r}`,
                type: 'regional',
                name: `Map of ${Cartography._getRegionName(q, r, world)}`,
                icon: '🗺️',
                quality: isCity ? 'detailed' : 'basic',
                accuracy: isCity ? 0.8 : 0.6,
                centerQ: q,
                centerR: r,
                radius: Cartography.MAP_TYPES.regional.radius,
                createdDay: world.day,
                createdBy: `${settlement.name} Cartographer`,
                value: isCity ? 60 : 30,
                tiles: Cartography._chartTiles(q, r, Cartography.MAP_TYPES.regional.radius, world, isCity ? 0.8 : 0.6),
                deliberateErrors: [],
                isPropaganda: false,
                isStolen: false,
                isAncient: false,
                notes: `Drawn by a ${isCity ? 'city' : 'village'} cartographer.`,
            },
            price: isCity ? 60 : 35,
        });

        // Kingdom map (in aligned settlements) — drawn as well as the realm's
        // own cartographers can draw (KingdomAtlas skill)
        if (tile.kingdom && isCity) {
            const kingdom = world.getKingdom(tile.kingdom);
            if (kingdom && kingdom.capital) {
                const acc = Math.round(KingdomAtlas.chartAccuracy(kingdom) * 100) / 100;
                const scale = acc / 0.75;
                maps.push({
                    map: {
                        id: `sale_kingdom_${tile.kingdom}`,
                        type: 'kingdom',
                        name: `Official Map of ${kingdom.name}`,
                        icon: '👑',
                        quality: Cartography.getQualityForSkill(KingdomAtlas.skill(kingdom)),
                        accuracy: acc,
                        kingdomId: tile.kingdom,
                        centerQ: kingdom.capital.q,
                        centerR: kingdom.capital.r,
                        radius: 0,
                        createdDay: world.day,
                        createdBy: `Royal Cartographer of ${kingdom.name}`,
                        value: Math.round(100 * scale),
                        tiles: Cartography._chartKingdomTiles(kingdom, world, acc),
                        deliberateErrors: [],
                        isPropaganda: false,
                        isStolen: false,
                        isAncient: false,
                        notes: `Official cartographic record of ${kingdom.name}.`,
                    },
                    price: Math.round(120 * scale),
                });

                // The royal archive in the capital sells copies of its charts of other realms
                if (settlement.type === 'capital') {
                    for (const offer of Cartography.getArchiveCopiesForSale(kingdom, world)) maps.push(offer);
                }
            }
        }

        // Chance of treasure map in taverns (30%)
        if (isCity && Utils.random() < 0.3) {
            const tMap = Cartography.generateTreasureMap(world);
            if (tMap) {
                maps.push({
                    map: tMap,
                    price: Utils.randInt(80, 200),
                });
            }
        }

        // Chance of ancient map (15%)
        if (Utils.random() < 0.15) {
            const aMap = Cartography.generateAncientMap(world, q, r);
            maps.push({
                map: aMap,
                price: Utils.randInt(50, 150),
            });
        }

        // Propaganda maps from enemy kingdoms
        if (tile.kingdom) {
            const enemies = world.kingdoms.filter(k =>
                k.isAlive && k.id !== tile.kingdom &&
                (world.getKingdom(tile.kingdom)?.wars || []).includes(k.id)
            );
            if (enemies.length > 0) {
                const enemy = Utils.randPick(enemies);
                const propMap = Cartography.generatePropagandaMap(enemy, world);
                if (propMap) {
                    maps.push({
                        map: propMap,
                        price: Utils.randInt(20, 50),
                    });
                }
            }
        }

        // Continent map — extremely rare (3% chance, capitals only)
        if (settlement.type === 'capital' && Utils.random() < 0.03) {
            const currentTile = world.getTile(q, r);
            if (currentTile && currentTile.regionId !== undefined) {
                // Count tiles in this continent for pricing
                let continentSize = 0;
                for (let cr = 0; cr < world.height; cr++) {
                    for (let cq = 0; cq < world.width; cq++) {
                        const ct = world.getTile(cq, cr);
                        if (ct && ct.regionId === currentTile.regionId) continentSize++;
                    }
                }
                const price = Math.max(5000, Math.floor(continentSize * 10));

                maps.push({
                    map: {
                        id: `sale_continent_${currentTile.regionId}`,
                        type: 'continent',
                        name: `Grand Continental Atlas`,
                        icon: '🌍',
                        quality: 'masterwork',
                        accuracy: 0.95,
                        centerQ: q,
                        centerR: r,
                        regionId: currentTile.regionId,
                        radius: 0,
                        createdDay: world.day,
                        createdBy: `Royal Geographic Society of ${settlement.name}`,
                        value: price,
                        tiles: [],
                        deliberateErrors: [],
                        isPropaganda: false,
                        isStolen: false,
                        isAncient: false,
                        notes: `A masterwork atlas covering the entire continent. Painstakingly compiled over decades.`,
                    },
                    price: price,
                });
            }
        }

        return maps;
    },

    // ── Royal Archives (kingdom cartography) ──
    /** Copies of a realm's archive charts of other realms, newest first (max 2). */
    getArchiveCopiesForSale(kingdom, world) {
        const out = [];
        const charts = ((kingdom.cartography && kingdom.cartography.mapsOwned) || [])
            .filter(c => !c.lies)
            .slice()
            .sort((a, b) => (b.day || 0) - (a.day || 0));
        for (const chart of charts) {
            if (out.length >= 2) break;
            const subject = world.getKingdom(chart.kingdomId);
            if (!subject || !subject.isAlive || !subject.capital) continue;
            const acc = chart.accuracy || 0.5;
            out.push({
                map: {
                    id: `archive_${kingdom.id}_${subject.id}_${chart.day || 0}`,
                    type: 'kingdom',
                    name: `Archive Map of ${subject.name}`,
                    icon: '🏛️',
                    quality: Cartography.getQualityForSkill((acc - 0.45) / 0.05),
                    accuracy: acc,
                    kingdomId: subject.id,
                    centerQ: subject.capital.q,
                    centerR: subject.capital.r,
                    radius: 0,
                    createdDay: chart.day || 0,
                    createdBy: `Royal Archive of ${kingdom.name}`,
                    value: Math.round(60 + acc * 100),
                    tiles: Cartography._chartKingdomTiles(subject, world, acc),
                    deliberateErrors: [],
                    isPropaganda: false,
                    isStolen: false,
                    isAncient: false,
                    fromArchive: true,
                    notes: `Copied from ${kingdom.name}'s chart of ${subject.name}, drawn on day ${chart.day || 0}.`,
                },
                price: Math.round(80 + acc * 120),
            });
        }
        return out;
    },

    /** The foreign realm a map charts: its kingdomId, or whoever holds its centre. */
    _mapSubject(map, world) {
        if (map.kingdomId) return map.kingdomId;
        const t = map.centerQ !== undefined ? world.getTile(map.centerQ, map.centerR) : null;
        return (t && t.kingdom) || null;
    },

    /**
     * What a realm's royal archive will pay for one of your maps. Only maps of
     * other realms interest it; it pays well for a better chart than it holds
     * (more in wartime against that realm) and little for one it has already.
     * Each doctored map it caught you selling cuts the price, and after
     * KingdomAtlas.CONFIG.distrustLimit it buys nothing from you.
     * Returns { price, subjectId, improves } or { price: 0, reason }.
     */
    archiveOffer(map, kingdom, world) {
        const subjectId = Cartography._mapSubject(map, world);
        const subject = subjectId ? world.getKingdom(subjectId) : null;
        if (!subject || !subject.isAlive) return { price: 0, reason: 'It charts no realm the archive cares about.' };
        if (subject.id === kingdom.id) return { price: 0, reason: 'They know their own lands.' };
        const distrust = (kingdom.cartography && kingdom.cartography.distrust) || 0;
        if (distrust >= KingdomAtlas.CONFIG.distrustLimit) return { price: 0, reason: 'The archivists will not deal with you.' };
        const chart = KingdomAtlas.getChart(kingdom, subject.id);
        const improves = !chart || (map.accuracy || 0) > (chart.accuracy || 0);
        const atWar = (kingdom.wars || []).includes(subject.id);
        const price = Math.max(5, Math.floor((map.value || 0) * (improves ? 1.0 : 0.3) * (atWar ? 1.5 : 1)
            * Math.max(0.25, 1 - 0.25 * distrust)));
        return { price, subjectId: subject.id, improves };
    },

    /**
     * Sell a map to a realm's royal archive. A doctored map may be spotted
     * (KingdomAtlas.spotChance — better atlases spot more): the sale fails,
     * you lose reputation and the archive trusts you less. Otherwise you are
     * paid and, if it improves their knowledge, the map becomes their chart —
     * lies and all, weakening their campaigns against that realm until their
     * own cartographer redraws it.
     */
    sellMapToArchive(player, mapIndex, kingdom, world) {
        if (!player.maps || mapIndex < 0 || mapIndex >= player.maps.length) {
            return { success: false, reason: 'Invalid map.' };
        }
        const map = player.maps[mapIndex];
        const offer = Cartography.archiveOffer(map, kingdom, world);
        if (!offer.price) return { success: false, reason: offer.reason };

        const lies = (map.deliberateErrors || []).length;
        KingdomAtlas.ensure(kingdom);
        if (lies > 0 && Utils.random() < KingdomAtlas.spotChance(kingdom, lies)) {
            kingdom.cartography.distrust += 1;
            if (player.reputation) {
                player.reputation[kingdom.id] = Math.max(-100, (player.reputation[kingdom.id] || 0) - 15);
            }
            return { success: false, caught: true, reason: `${kingdom.name}'s archivists spot the alterations and turn you away.` };
        }

        player.gold += offer.price;
        player.maps.splice(mapIndex, 1);
        if (offer.improves || lies > 0) {
            KingdomAtlas.recordChart(kingdom, {
                kingdomId: offer.subjectId,
                accuracy: Math.round((map.accuracy || 0.5) * 100) / 100,
                day: world.day || 0,
                source: 'player',
                lies,
            });
        }
        if (player.skills) player.skills.commerce = Math.min(10, (player.skills.commerce || 1) + 0.05);
        return { success: true, gold: offer.price, mapName: map.name, planted: lies };
    },

    /**
     * Sell a player's map
     */
    sellMap(player, mapIndex) {
        if (!player.maps || mapIndex < 0 || mapIndex >= player.maps.length) {
            return { success: false, reason: 'Invalid map.' };
        }

        const map = player.maps[mapIndex];
        // Cartographers pay by how trustworthy the map is
        const trust = Math.max(0.3, Math.min(1, (map.accuracy || 0.6) + 0.2));
        const sellPrice = Math.floor(map.value * 0.7 * trust);
        player.gold += sellPrice;
        player.maps.splice(mapIndex, 1);

        player.skills.commerce = Math.min(10, (player.skills.commerce || 1) + 0.05);
        return { success: true, gold: sellPrice, mapName: map.name };
    },

    /**
     * Buy a map
     */
    buyMap(player, mapData, price) {
        if (player.gold < price) {
            return { success: false, reason: 'Not enough gold.' };
        }

        player.gold -= price;
        if (!player.maps) player.maps = [];
        player.maps.push(mapData);

        player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + 0.05);
        return { success: true };
    },

    // ── Daily Processing ───────────────────────
    /**
     * Process cartography events each turn
     */
    processTurn(world) {
        // Kingdoms may commission propaganda maps
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive || !kingdom.capital) continue;
            KingdomAtlas.ensure(kingdom);

            // Small chance to generate propaganda during wartime
            if (kingdom.wars && kingdom.wars.length > 0 && Utils.random() < Cartography.PROPAGANDA_CHANCE) {
                const propMap = Cartography.generatePropagandaMap(kingdom, world);
                if (propMap) {
                    kingdom.cartography.propagandaMaps.push(propMap);
                    kingdom.cartography.mapsMade += 1; // propaganda is cartography too
                    if (kingdom.cartography.propagandaMaps.length > 3) {
                        kingdom.cartography.propagandaMaps.shift();
                    }
                    world.events.push({
                        text: `📣 ${kingdom.name} has published a new "official" map showing expanded borders.`,
                        type: 'cartography',
                        category: 'POLITICAL',
                    });
                }
            }

            // Court cartographer: hiring, upkeep, charting rival realms
            KingdomAtlas.processDay(kingdom, world);
        }
    },

    // ── Internal Tile Charting ──────────────────
    /**
     * Chart tiles in a radius with given accuracy
     */
    _chartTiles(centerQ, centerR, radius, world, accuracy) {
        const charted = [];
        const hexes = Hex.hexesInRange(centerQ, centerR, radius);

        for (const hex of hexes) {
            const tile = world.getTile(hex.q, hex.r);
            if (!tile) continue;
            if (Utils.random() > accuracy) continue;

            const entry = {
                q: hex.q,
                r: hex.r,
                terrain: tile.terrain.id,
                hasSettlement: !!tile.settlement,
                settlementName: tile.settlement ? tile.settlement.name : null,
                kingdom: tile.kingdom,
                hasResource: !!tile.resource,
                resource: tile.resource || null,
            };
            charted.push(entry);
        }

        return charted;
    },

    /**
     * Chart tiles belonging to a kingdom
     */
    _chartKingdomTiles(kingdom, world, accuracy) {
        const charted = [];
        if (!kingdom.territory) return charted;

        for (const t of kingdom.territory) {
            if (Utils.random() > accuracy) continue;
            const tile = world.getTile(t.q, t.r);
            if (!tile) continue;

            charted.push({
                q: t.q,
                r: t.r,
                terrain: tile.terrain.id,
                hasSettlement: !!tile.settlement,
                settlementName: tile.settlement ? tile.settlement.name : null,
                kingdom: kingdom.id,
                hasResource: !!tile.resource,
                resource: tile.resource || null,
            });
        }

        return charted;
    },

    /**
     * Chart propaganda tiles (exaggerated territory)
     */
    _chartPropagandaTiles(kingdom, world) {
        const charted = Cartography._chartKingdomTiles(kingdom, world, 0.9);

        // Add false border claims
        if (kingdom.territory) {
            for (const t of kingdom.territory) {
                const neighbors = Hex.neighbors(t.q, t.r);
                for (const n of neighbors) {
                    const tile = world.getTile(n.q, n.r);
                    if (tile && tile.terrain.passable && tile.kingdom !== kingdom.id && Utils.random() < 0.4) {
                        charted.push({
                            q: n.q,
                            r: n.r,
                            terrain: tile.terrain.id,
                            hasSettlement: !!tile.settlement,
                            settlementName: tile.settlement ? tile.settlement.name : null,
                            kingdom: kingdom.id,  // FALSE — claims this tile
                            hasResource: !!tile.resource,
                            resource: tile.resource || null,
                        });
                    }
                }
            }
        }

        return charted;
    },

    /**
     * Get a descriptive region name based on coordinates
     */
    _getRegionName(q, r, world) {
        const tile = world.getTile(q, r);
        if (!tile) return 'Unknown Region';

        // Check for nearby settlement
        const hexes = Hex.hexesInRange(q, r, 3);
        for (const h of hexes) {
            const t = world.getTile(h.q, h.r);
            if (t && t.settlement) return `the ${t.settlement.name} Region`;
        }

        // Use terrain descriptors
        const terrainNames = {
            forest: 'the Woodlands', dense_forest: 'the Deep Forest',
            plains: 'the Plains', grassland: 'the Grasslands',
            mountains: 'the Mountains', hills: 'the Hills',
            desert: 'the Desert', tundra: 'the Frozen North',
            swamp: 'the Marshes', coast: 'the Coast',
        };

        return terrainNames[tile.terrain.id] || `Region (${q},${r})`;
    },

    // ── Player Cartography Data ────────────────
    /**
     * Get player's maps collection with display data
     */
    getPlayerMaps(player) {
        return player.maps || [];
    },

    /**
     * Count tiles the player has personally explored
     */
    countExploredTiles(world) {
        let count = 0;
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                if (world.tiles[r][q].explored) count++;
            }
        }
        return count;
    },

    /**
     * Get cartography skill level description
     */
    getSkillDescription(skill) {
        if (skill >= 9) return 'Grand Cartographer';
        if (skill >= 7) return 'Master Cartographer';
        if (skill >= 5) return 'Journeyman Cartographer';
        if (skill >= 3) return 'Apprentice Cartographer';
        if (skill >= 1) return 'Novice Map-Maker';
        return 'No cartographic training';
    },

    /**
     * Check if player can detect propaganda/errors in a map
     */
    canDetectErrors(player, map) {
        const skill = player.skills.cartography || 0;
        const intelligence = player.intelligence || 5;
        const detectChance = (skill * 0.08) + (intelligence * 0.03);
        return Utils.random() < detectChance;
    },
});
