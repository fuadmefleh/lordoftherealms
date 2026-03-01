// ============================================
// RELIGION — World Religion & Holy Sites System
// ============================================

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';


export const Religion = {

    // ─────────────────────────────────────────────
    // WORLD RELIGIONS — Historical & Active faiths
    // ─────────────────────────────────────────────

    /**
     * All world religions — some still active, some extinct.
     * Each kingdom will adopt one of the active faiths at world‑gen.
     */
    FAITHS: {
        // ── Still-active religions ──
        solaris: {
            id: 'solaris',
            name: 'The Solar Covenant',
            icon: '☀️',
            founded: 42,
            extinct: false,
            tenets: ['Order', 'Justice', 'Light'],
            description: 'Worship of the Eternal Sun — the oldest surviving faith. Temples face east, and adherents mark holy days at dawn.',
            holyColor: '#f5c542',
            virtues: { unity: 3, militancy: 1, scholarship: 1 },
        },
        tidemother: {
            id: 'tidemother',
            name: 'Faith of the Tidemother',
            icon: '🌊',
            founded: 189,
            extinct: false,
            tenets: ['Generosity', 'Exploration', 'Adaptability'],
            description: 'Seafarers\' faith centred on the Tidemother — goddess of currents, storms, and safe harbour.',
            holyColor: '#3498db',
            virtues: { unity: 1, militancy: 0, scholarship: 2 },
        },
        earthroot: {
            id: 'earthroot',
            name: 'The Earthroot Communion',
            icon: '🌿',
            founded: 310,
            extinct: false,
            tenets: ['Harmony', 'Growth', 'Patience'],
            description: 'Nature worship venerating the world-tree whose roots bind all living things. Shrines stand in forest glades.',
            holyColor: '#27ae60',
            virtues: { unity: 2, militancy: 0, scholarship: 2 },
        },
        ironfaith: {
            id: 'ironfaith',
            name: 'The Iron Creed',
            icon: '⚒️',
            founded: 487,
            extinct: false,
            tenets: ['Strength', 'Honour', 'Endurance'],
            description: 'Born among mountain clans, the Iron Creed teaches that the soul is forged through trial and labour.',
            holyColor: '#7f8c8d',
            virtues: { unity: 1, militancy: 3, scholarship: 0 },
        },
        starseers: {
            id: 'starseers',
            name: 'Order of the Starseers',
            icon: '⭐',
            founded: 612,
            extinct: false,
            tenets: ['Wisdom', 'Prophecy', 'Charity'],
            description: 'Mystic scholar-monks who chart the heavens and claim to read fate in the constellations.',
            holyColor: '#8e44ad',
            virtues: { unity: 2, militancy: 0, scholarship: 3 },
        },

        // ── Extinct religions (historical only) ──
        ashwalkers: {
            id: 'ashwalkers',
            name: 'The Ashwalker Path',
            icon: '🔥',
            founded: 15,
            extinctYear: 234,
            extinct: true,
            tenets: ['Purification', 'Rebirth', 'Sacrifice'],
            description: 'Fire-worshippers who practised ritual immolation. Suppressed after the Great Pyre Rebellion of 230.',
            holyColor: '#e67e22',
            virtues: { unity: 0, militancy: 3, scholarship: 0 },
        },
        voidcallers: {
            id: 'voidcallers',
            name: 'The Cult of the Void',
            icon: '🌑',
            founded: 120,
            extinctYear: 401,
            extinct: true,
            tenets: ['Entropy', 'Secrets', 'Transcendence'],
            description: 'An esoteric cult that worshipped the emptiness between stars. Banned after the Mindbreak Plague of 400.',
            holyColor: '#2c3e50',
            virtues: { unity: 0, militancy: 1, scholarship: 2 },
        },
        bonesingers: {
            id: 'bonesingers',
            name: 'The Bonesinger Rites',
            icon: '💀',
            founded: 78,
            extinctYear: 550,
            extinct: true,
            tenets: ['Ancestor Veneration', 'Memory', 'Duty'],
            description: 'Ancestor-worship tradition where the dead were preserved and "sang" through wind-harps atop burial spires. Faded after prolonged plague.',
            holyColor: '#bdc3c7',
            virtues: { unity: 2, militancy: 1, scholarship: 1 },
        },
        flameheralds: {
            id: 'flameheralds',
            name: 'Heralds of the Eternal Flame',
            icon: '🕯️',
            founded: 355,
            extinctYear: 710,
            extinct: true,
            tenets: ['Illumination', 'Purity', 'Zeal'],
            description: 'A militant offshoot of the Solar Covenant. Launched three crusades before collapsing into internal schism.',
            holyColor: '#d35400',
            virtues: { unity: 1, militancy: 3, scholarship: 0 },
        },
    },

    /**
     * Default kingdom → religion mapping (used at world gen)
     */
    KINGDOM_FAITHS: {
        valdoria: 'solaris',
        sylvaris: 'earthroot',
        kharzun: 'ironfaith',
        azurath: 'starseers',
        merathis: 'tidemother',
    },

    // ─────────────────────────────────────────────
    // HOLY SITES
    // ─────────────────────────────────────────────

    HOLY_SITE_TYPES: [
        { id: 'sacred_spring', name: 'Sacred Spring', icon: '⛲', bonusType: 'healing', faithBonus: 8, incomeBonus: 50, description: 'Blessed waters said to cure ailments' },
        { id: 'ancient_altar', name: 'Ancient Altar', icon: '🗿', bonusType: 'unity', faithBonus: 12, incomeBonus: 30, description: 'Stone altar predating written history' },
        { id: 'celestial_observatory', name: 'Celestial Observatory', icon: '🔭', bonusType: 'scholarship', faithBonus: 10, incomeBonus: 40, description: 'Star-gazing tower aligned to constellations' },
        { id: 'world_tree', name: 'World-Tree Sapling', icon: '🌳', bonusType: 'growth', faithBonus: 15, incomeBonus: 60, description: 'A sapling of the legendary world-tree' },
        { id: 'reliquary', name: 'Grand Reliquary', icon: '⚱️', bonusType: 'pilgrimage', faithBonus: 20, incomeBonus: 80, description: 'Repository of sacred relics from many faiths' },
    ],

    // ─────────────────────────────────────────────
    // HERESY definitions
    // ─────────────────────────────────────────────

    HERESIES: [
        { id: 'dualist_heresy', name: 'Dualist Heresy', description: 'Claims the divine has both a light and dark aspect, equal in power', unityPenalty: -15, scholarshipBonus: 5, spreadChance: 0.03 },
        { id: 'iconoclasm', name: 'Iconoclast Movement', description: 'Demands destruction of all religious imagery and relics', unityPenalty: -20, scholarshipBonus: 0, spreadChance: 0.02 },
        { id: 'free_prophets', name: 'Free Prophet Schism', description: 'Anyone may declare prophecy — no central authority', unityPenalty: -10, scholarshipBonus: 8, spreadChance: 0.04 },
        { id: 'ascetic_revolt', name: 'Ascetic Revolt', description: 'Extreme poverty movement rejecting all temple wealth', unityPenalty: -12, scholarshipBonus: 3, spreadChance: 0.025 },
        { id: 'blood_rite', name: 'Blood Rite Revival', description: 'Attempts to revive forbidden sacrificial practices', unityPenalty: -25, scholarshipBonus: -5, spreadChance: 0.015 },
    ],

    // ─────────────────────────────────────────────
    // PILGRIMAGES
    // ─────────────────────────────────────────────

    PILGRIM_ROUTES: [],   // populated at world gen

    // ─────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────

    /**
     * Called during world generation to assign religions to kingdoms,
     * place holy sites, and seed religious history.
     */
    initialize(world) {
        // 1. Assign faiths to kingdoms
        for (const kingdom of world.kingdoms) {
            const faithId = Religion.KINGDOM_FAITHS[kingdom.id] || Utils.randPick(Object.keys(Religion.getActiveFaiths()));
            const faith = Religion.FAITHS[faithId];
            kingdom.religion = {
                faithId: faithId,
                name: faith.name,
                icon: faith.icon,
                piety: Utils.randInt(30, 70),       // 0-100 devotion level
                unity: 50 + (faith.virtues.unity * 5),
                heresies: [],                        // active heresies
                holySites: [],                       // controlled holy sites [{q,r}]
                pilgrimIncome: 0,
            };
        }

        // 2. Place holy sites across the map
        Religion.placeHolySites(world);

        // 3. Generate religious history entries
        Religion.generateReligiousHistory(world);
    },

    /**
     * Return only faiths that are still practised
     */
    getActiveFaiths() {
        const result = {};
        for (const [k, v] of Object.entries(Religion.FAITHS)) {
            if (!v.extinct) result[k] = v;
        }
        return result;
    },

    // ─────────────────────────────────────────────
    // HOLY SITE PLACEMENT
    // ─────────────────────────────────────────────

    placeHolySites(world) {
        const count = Utils.randInt(5, 9);
        const placed = [];

        for (let i = 0; i < count; i++) {
            let attempts = 0;
            while (attempts < 300) {
                attempts++;
                const q = Utils.randInt(0, world.width - 1);
                const r = Utils.randInt(2, world.height - 3);
                const tile = world.getTile(q, r);
                if (!tile || !tile.terrain.passable) continue;
                if (tile.settlement || tile.improvement) continue;

                // Min distance from other holy sites
                let tooClose = false;
                for (const hs of placed) {
                    if (Hex.wrappingDistance(q, r, hs.q, hs.r, world.width) < 8) {
                        tooClose = true; break;
                    }
                }
                if (tooClose) continue;

                const siteType = Utils.randPick(Religion.HOLY_SITE_TYPES);
                // Decide controlling kingdom (whoever owns this tile, or nearest, or contested)
                const controllingKingdom = tile.kingdom || null;

                tile.holySite = {
                    ...siteType,
                    controller: controllingKingdom,
                    contested: false,
                    pilgrimCount: 0,
                    faithId: controllingKingdom ? (world.getKingdom(controllingKingdom)?.religion?.faithId || null) : null,
                    level: 1,
                    q, r,
                };

                if (controllingKingdom) {
                    const kd = world.getKingdom(controllingKingdom);
                    if (kd && kd.religion) {
                        kd.religion.holySites.push({ q, r });
                    }
                }

                placed.push({ q, r, site: tile.holySite });
                break;
            }
        }

        // Build pilgrim routes between holy sites
        Religion.PILGRIM_ROUTES = [];
        for (let i = 0; i < placed.length; i++) {
            for (let j = i + 1; j < placed.length; j++) {
                const dist = Hex.wrappingDistance(placed[i].q, placed[i].r, placed[j].q, placed[j].r, world.width);
                if (dist < 30) {
                    Religion.PILGRIM_ROUTES.push({
                        from: { q: placed[i].q, r: placed[i].r, name: placed[i].site.name },
                        to: { q: placed[j].q, r: placed[j].r, name: placed[j].site.name },
                        distance: dist,
                        income: Math.floor(dist * 3),
                    });
                }
            }
        }
    },

    // ─────────────────────────────────────────────
    // RELIGIOUS HISTORY GENERATION
    // ─────────────────────────────────────────────

    generateReligiousHistory(world) {
        const allFaiths = Object.values(Religion.FAITHS);
        const sorted = [...allFaiths].sort((a, b) => a.founded - b.founded);

        for (const faith of sorted) {
            // Founding event
            world.history.push({
                year: faith.founded,
                text: `${faith.icon} The ${faith.name} was founded. "${faith.tenets.join(', ')}" became its core tenets.`,
            });

            // For extinct religions, add decline + extinction events
            if (faith.extinct && faith.extinctYear) {
                const declineYear = faith.extinctYear - Utils.randInt(20, 60);
                world.history.push({
                    year: declineYear,
                    text: `${faith.icon} The ${faith.name} began to decline as followers dwindled and temples fell silent.`,
                });
                world.history.push({
                    year: faith.extinctYear,
                    text: `${faith.icon} The ${faith.name} faded from practice. ${faith.description.split('.')[1] || 'Its last adherents scattered.'}`,
                });
            }

            // Active faiths get expansion / schism / great council events
            if (!faith.extinct) {
                const expansionYear = faith.founded + Utils.randInt(50, 150);
                if (expansionYear < (world.year || 853)) {
                    world.history.push({
                        year: expansionYear,
                        text: `${faith.icon} The ${faith.name} expanded rapidly, establishing temples across multiple kingdoms.`,
                    });
                }

                const reformYear = faith.founded + Utils.randInt(200, 400);
                if (reformYear < (world.year || 853)) {
                    world.history.push({
                        year: reformYear,
                        text: `${faith.icon} A Great Council of the ${faith.name} reformed its doctrines and codified sacred texts.`,
                    });
                }
            }
        }

        // Add inter-faith conflict events
        const interFaithConflicts = [
            { year: Utils.randInt(250, 350), text: '⚔️ The War of Faiths erupted between followers of the Solar Covenant and the Ashwalker Path, devastating the central plains.' },
            { year: Utils.randInt(500, 600), text: '📜 The Concordat of Faiths was signed — the first inter-religious peace treaty in recorded history.' },
            { year: Utils.randInt(650, 750), text: '🔥 The Inquisition of the Flame Heralds purged thousands before the order itself collapsed from within.' },
            { year: Utils.randInt(780, 840), text: '🕊️ A period of religious tolerance began, allowing multiple faiths to coexist in major cities.' },
        ];

        for (const event of interFaithConflicts) {
            if (event.year < (world.year || 853)) {
                world.history.push(event);
            }
        }

        // Re-sort history by year
        world.history.sort((a, b) => a.year - b.year);
    },

    // ─────────────────────────────────────────────
    // DAILY PROCESSING (called from world.advanceDay)
    // ─────────────────────────────────────────────

    processTurn(world) {
        for (const kingdom of world.kingdoms) {
            if (!kingdom.isAlive || !kingdom.religion) continue;

            // 1. Pilgrim income from holy sites
            let pilgrimIncome = 0;
            for (const siteRef of kingdom.religion.holySites) {
                const tile = world.getTile(siteRef.q, siteRef.r);
                if (!tile || !tile.holySite) continue;
                if (tile.holySite.controller !== kingdom.id) {
                    // Lost control — remove from list
                    kingdom.religion.holySites = kingdom.religion.holySites.filter(
                        s => !(s.q === siteRef.q && s.r === siteRef.r)
                    );
                    continue;
                }
                const pilgrims = Utils.randInt(1, 5) * tile.holySite.level;
                tile.holySite.pilgrimCount += pilgrims;
                pilgrimIncome += tile.holySite.incomeBonus * tile.holySite.level * 0.1;
            }
            kingdom.religion.pilgrimIncome = Math.floor(pilgrimIncome);
            kingdom.treasury += kingdom.religion.pilgrimIncome;

            // 2. Piety drift
            const faith = Religion.FAITHS[kingdom.religion.faithId];
            if (faith) {
                kingdom.religion.piety = Math.max(0, Math.min(100,
                    kingdom.religion.piety + (faith.virtues.unity - 1) * 0.5 + Utils.randFloat(-1, 1)
                ));
            }

            // 3. Unity from piety
            kingdom.religion.unity = Math.max(0, Math.min(100,
                50 + kingdom.religion.piety * 0.3 + (faith ? faith.virtues.unity * 5 : 0)
            ));

            // 4. Heresy spread chance
            if (kingdom.religion.piety < 30 && Math.random() < 0.005) {
                Religion.spawnHeresy(kingdom, world);
            }

            // 5. Process existing heresies
            for (let i = kingdom.religion.heresies.length - 1; i >= 0; i--) {
                const heresy = kingdom.religion.heresies[i];
                heresy.strength += Utils.randFloat(-2, 3);

                if (heresy.strength <= 0) {
                    // Heresy fizzles
                    kingdom.religion.heresies.splice(i, 1);
                    world.events.push({
                        category: 'religious',
                        text: `${kingdom.name}: The ${heresy.name} has fizzled out.`,
                        kingdom: kingdom.id,
                        impact: 'positive',
                    });
                } else if (heresy.strength > 50) {
                    // Heresy triggers religious conflict
                    Religion.triggerReligiousConflict(kingdom, heresy, world);
                    kingdom.religion.heresies.splice(i, 1);
                }

                // Unity penalty while heresy persists
                kingdom.religion.unity = Math.max(0,
                    kingdom.religion.unity + (heresy.unityPenalty || 0) * 0.05
                );
            }

            // 6. Holy site contestation
            Religion.processHolySiteContestation(kingdom, world);
        }
    },

    // ─────────────────────────────────────────────
    // HERESIES
    // ─────────────────────────────────────────────

    spawnHeresy(kingdom, world) {
        if (kingdom.religion.heresies.length >= 2) return; // max 2 concurrent
        const available = Religion.HERESIES.filter(
            h => !kingdom.religion.heresies.some(kh => kh.id === h.id)
        );
        if (available.length === 0) return;

        const heresy = { ...Utils.randPick(available), strength: Utils.randInt(5, 20) };
        kingdom.religion.heresies.push(heresy);

        world.events.push({
            category: 'religious',
            text: `${kingdom.name}: The ${heresy.name} has emerged! "${heresy.description}"`,
            kingdom: kingdom.id,
            impact: 'negative',
        });
    },

    triggerReligiousConflict(kingdom, heresy, world) {
        // Severe consequences: treasury loss, population loss, relation changes
        const treasuryLoss = Math.floor(kingdom.treasury * 0.15);
        kingdom.treasury -= treasuryLoss;
        kingdom.religion.piety = Math.max(0, kingdom.religion.piety - 15);

        world.events.push({
            category: 'religious',
            text: `${kingdom.name}: Religious conflict erupted over the ${heresy.name}! Lost ${treasuryLoss} gold suppressing unrest.`,
            kingdom: kingdom.id,
            impact: 'negative',
        });

        // Chance to damage relations with kingdoms of same faith
        for (const other of world.kingdoms) {
            if (other.id === kingdom.id || !other.isAlive || !other.religion) continue;
            if (other.religion.faithId === kingdom.religion.faithId) {
                kingdom.relations[other.id] = Math.max(-100,
                    (kingdom.relations[other.id] || 0) - Utils.randInt(5, 15)
                );
            }
        }
    },

    // ─────────────────────────────────────────────
    // HOLY SITE CONTESTATION
    // ─────────────────────────────────────────────

    processHolySiteContestation(kingdom, world) {
        // Check if any of our holy sites are now in enemy territory
        for (const siteRef of [...kingdom.religion.holySites]) {
            const tile = world.getTile(siteRef.q, siteRef.r);
            if (!tile || !tile.holySite) continue;

            if (tile.kingdom && tile.kingdom !== kingdom.id) {
                // Territory changed hands — transfer holy site control
                const newController = world.getKingdom(tile.kingdom);
                if (newController && newController.religion) {
                    tile.holySite.controller = newController.id;
                    tile.holySite.contested = true;
                    newController.religion.holySites.push({ q: siteRef.q, r: siteRef.r });

                    kingdom.religion.holySites = kingdom.religion.holySites.filter(
                        s => !(s.q === siteRef.q && s.r === siteRef.r)
                    );

                    world.events.push({
                        category: 'religious',
                        text: `${newController.name} seized the ${tile.holySite.name} from ${kingdom.name}!`,
                        kingdoms: [kingdom.id, newController.id],
                        impact: 'negative',
                    });

                    // Relations penalty
                    kingdom.relations[newController.id] = Math.max(-100,
                        (kingdom.relations[newController.id] || 0) - 20
                    );
                }
            }
        }
    },

    // ─────────────────────────────────────────────
    // PLAYER-FACING PILGRIMAGE SYSTEM
    // ─────────────────────────────────────────────

    /**
     * Start a pilgrimage from the player's current location toward a holy site.
     * Returns {success, route, reward} or {success:false, reason}.
     */
    startPilgrimage(player, world) {
        // Find all holy sites
        const holySites = [];
        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.getTile(q, r);
                if (tile && tile.holySite) {
                    holySites.push({ q, r, site: tile.holySite });
                }
            }
        }

        if (holySites.length === 0) {
            return { success: false, reason: 'No holy sites exist in this world' };
        }

        return { success: true, sites: holySites };
    },

    /**
     * Complete a pilgrimage visit (player standing on a holy site tile).
     */
    completePilgrimage(player, tile, world) {
        if (!tile.holySite) {
            return { success: false, reason: 'This is not a holy site' };
        }

        const site = tile.holySite;
        const faithBonus = site.faithBonus || 5;
        const goldReward = site.incomeBonus + Utils.randInt(20, 100);

        player.karma += Math.floor(faithBonus / 2);
        player.gold += goldReward;
        player.renown += 5;
        player.faith = Math.min(10, player.faith + 0.5);

        // Heal if sacred spring
        if (site.bonusType === 'healing') {
            player.health = Math.min(player.maxHealth, player.health + 30);
        }

        return {
            success: true,
            siteName: site.name,
            goldReward,
            karmaGained: Math.floor(faithBonus / 2),
            renownGained: 5,
            healed: site.bonusType === 'healing',
        };
    },

    // ─────────────────────────────────────────────
    // RELIGIOUS BUILDINGS FOR KINGDOMS (NPC)
    // ─────────────────────────────────────────────

    KINGDOM_BUILDING_TYPES: {
        chapel: {
            id: 'chapel', name: 'Chapel', icon: '⛪', cost: 200,
            pietyBonus: 2, unityBonus: 3, incomeBonus: 10,
            description: 'Small place of worship that boosts local piety',
        },
        cathedral: {
            id: 'cathedral', name: 'Cathedral', icon: '🏰', cost: 1500,
            pietyBonus: 8, unityBonus: 10, incomeBonus: 50,
            description: 'Grand cathedral that becomes a centre of faith',
        },
        monastery_npc: {
            id: 'monastery_npc', name: 'Monastery', icon: '🏛️', cost: 600,
            pietyBonus: 5, unityBonus: 5, incomeBonus: 25,
            scholarshipBonus: 5,
            description: 'Scholarly retreat producing manuscripts and beer',
        },
    },

    // ─────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────

    /**
     * Get the religion object for a kingdom
     */
    getKingdomFaith(kingdom) {
        if (!kingdom.religion || !kingdom.religion.faithId) return null;
        return Religion.FAITHS[kingdom.religion.faithId] || null;
    },

    /**
     * Check if two kingdoms share the same faith
     */
    sameFaith(k1, k2) {
        return k1.religion && k2.religion && k1.religion.faithId === k2.religion.faithId;
    },

    /**
     * Religious compatibility score between two kingdoms (-50 to +50)
     */
    faithCompatibility(k1, k2) {
        if (!k1.religion || !k2.religion) return 0;
        if (k1.religion.faithId === k2.religion.faithId) return 30;
        // Different faiths — compare virtues
        const f1 = Religion.FAITHS[k1.religion.faithId];
        const f2 = Religion.FAITHS[k2.religion.faithId];
        if (!f1 || !f2) return 0;
        // Higher militancy difference = more conflict
        const militancyDiff = Math.abs(f1.virtues.militancy - f2.virtues.militancy);
        return 10 - militancyDiff * 15;
    },
};
