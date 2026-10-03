// ============================================
// SCHEMES — rival Houses plot against the player
// ============================================
// Rival Houses (seeded by House.seedRivals) no longer just glower in the
// chronicle: an aggrieved rival hatches a *scheme* against a concrete target —
// a property, the treasury, a colony, the heir, the House's good name. Each
// scheme has a strike day. Until then it is hidden; spies, a spymaster and
// counter-espionage may *reveal* it, which opens counter-play (post guards,
// send a spy to foil it, or buy the rival off). An unrevealed scheme strikes
// without warning.
//
// Every scheme type is one catalogue entry with the same shape
// ({ minFeud, eligible, pickTarget, resolve, guard }), so new kinds of
// hostility — including a future "declare war on the player" — slot in as
// one more entry. The House brain seam (House._brain.chooseScheme) picks
// among eligible entries, so an LLM brain gains new schemes for free.
//
// State lives on player.house (schemes[], _nextSchemeId) and therefore
// round-trips through House.serialize. Randomness flows through Utils only.

import { Utils } from '../core/utils.js';
import { House } from './house.js';

const CONFIG = {
    plotCadence: 20,          // days between rival plotting rolls
    plotChanceDivisor: 120,   // chance a rival plots = feud / this
    maxActive: 2,             // schemes in flight at once
    leadMin: 8,               // days from hatching to strike
    leadMax: 15,
    envyCadence: 30,          // days between envy feud ticks
    envyCap: 6,               // max feud gained per envy tick
    revealBase: 0.06,         // daily chance a hidden scheme is exposed
    revealSpymaster: 0.12,
    revealPerIdleSpy: 0.03,
    revealCounterEspionage: 0.25,
    feudOnSuccess: -10,       // a landed scheme partly sates the grudge
    feudOnFoiled: 5,          // a foiled one inflames it
    feudOnBribe: -15,
    spyFoilBase: 0.35,
    spyFoilPerLevel: 0.1,
};

const goldOf = p => p.gold || 0;

/** Find the live property object for a player.properties reference. */
function findProperty(world, ref) {
    const tile = world && world.getTile ? world.getTile(ref.q, ref.r) : null;
    if (!tile) return null;
    if (Array.isArray(tile.playerProperties)) {
        const hit = tile.playerProperties.find(p => p && p.type === ref.type);
        if (hit) return hit;
    }
    return tile.playerProperty && tile.playerProperty.type === ref.type ? tile.playerProperty : null;
}

function workingProperties(player, world) {
    return (player.properties || []).filter(ref => {
        const p = findProperty(world, ref);
        return p && !p.underConstruction;
    });
}

function playerColonies(player, world) {
    return (player.colonies || []).filter(c => {
        const tile = world && world.getTile ? world.getTile(c.q, c.r) : null;
        return tile && tile.settlement && tile.settlement.colony;
    });
}

function livingChildren(player) {
    return (player.children || []).filter(c => c && c.isAlive);
}

const propLabel = (ref) => `${String(ref.type).replace(/_/g, ' ')} at (${ref.q}, ${ref.r})`;

// ── The catalogue ───────────────────────────────────────────────
const SCHEME_TYPES = {
    slander: {
        name: 'Slander',
        icon: '🗣️',
        minFeud: 10,
        eligible: () => true,
        pickTarget: () => ({ label: 'your good name' }),
        describe: () => 'spread poisonous rumours about your House',
        guard: null, // you cannot post guards around a rumour
        resolve(player) {
            const rep = player.reputation || {};
            for (const k of Object.keys(rep)) rep[k] -= 8;
            const renownLoss = Math.min(player.renown || 0, 5);
            player.renown = (player.renown || 0) - renownLoss;
            return `Slander spreads through every court: −8 reputation with all kingdoms${renownLoss ? `, −${renownLoss} renown` : ''}.`;
        },
    },
    theft: {
        name: 'Treasury Theft',
        icon: '💰',
        minFeud: 20,
        eligible: (player) => goldOf(player) >= 200,
        pickTarget: () => ({ label: 'your treasury' }),
        describe: () => 'send thieves after your treasury',
        guard: { cost: 40, success: 0.8, label: 'Hire vault guards' },
        resolve(player) {
            const loss = Math.min(2000, Math.floor(goldOf(player) * Utils.randFloat(0.08, 0.15)));
            player.gold = goldOf(player) - loss;
            return `Thieves empty part of your treasury: −${loss} gold.`;
        },
    },
    sabotage: {
        name: 'Sabotage',
        icon: '🔥',
        minFeud: 20,
        eligible: (player, world) => workingProperties(player, world).length > 0,
        pickTarget(player, world) {
            const ref = Utils.randPick(workingProperties(player, world));
            return { q: ref.q, r: ref.r, type: ref.type, label: `your ${propLabel(ref)}` };
        },
        describe: (t) => `sabotage ${t.label}`,
        guard: { cost: 30, success: 0.75, label: 'Post watchmen' },
        resolve(player, world, scheme) {
            const prop = findProperty(world, scheme.target);
            if (!prop) return null; // property gone — scheme fizzles
            prop.sabotagedDays = Math.max(prop.sabotagedDays || 0, 12);
            return `Saboteurs wreck ${scheme.target.label}: no production for 12 days.`;
        },
    },
    raid_property: {
        name: 'Raid',
        icon: '⚔️',
        minFeud: 40,
        eligible: (player, world) => workingProperties(player, world).length > 0,
        pickTarget(player, world) {
            // Raiders go for the most valuable holding.
            const refs = workingProperties(player, world).slice().sort((a, b) =>
                ((findProperty(world, b).level || 1) - (findProperty(world, a).level || 1)));
            const ref = refs[0];
            return { q: ref.q, r: ref.r, type: ref.type, label: `your ${propLabel(ref)}` };
        },
        describe: (t) => `send armed men to raid ${t.label}`,
        guard: { cost: 80, success: 0.7, label: 'Garrison the holding' },
        resolve(player, world, scheme) {
            const prop = findProperty(world, scheme.target);
            if (!prop) return null;
            const parts = [];
            if ((prop.storage || 0) > 0) { parts.push(`${prop.storage} stored goods carried off`); prop.storage = 0; }
            if ((prop.level || 1) > 1) { prop.level -= 1; parts.push(`burned down to level ${prop.level}`); }
            prop.sabotagedDays = Math.max(prop.sabotagedDays || 0, 20);
            parts.push('no production for 20 days');
            return `Raiders fall upon ${scheme.target.label}: ${parts.join(', ')}.`;
        },
    },
    incite_unrest: {
        name: 'Incite Unrest',
        icon: '🔥',
        minFeud: 35,
        eligible: (player, world) => playerColonies(player, world).length > 0,
        pickTarget(player, world) {
            const c = Utils.randPick(playerColonies(player, world));
            return { q: c.q, r: c.r, label: `your colony ${c.name || `at (${c.q}, ${c.r})`}` };
        },
        describe: (t) => `stir up revolt in ${t.label}`,
        guard: { cost: 60, success: 0.8, label: 'Reinforce the garrison' },
        resolve(player, world, scheme) {
            const tile = world.getTile(scheme.target.q, scheme.target.r);
            const colony = tile && tile.settlement && tile.settlement.colony;
            if (!colony) return null;
            colony.loyalty = Math.max(0, (colony.loyalty || 0) - 20);
            return `Agitators turn ${scheme.target.label} against you: −20 loyalty (now ${Math.round(colony.loyalty)}).`;
        },
    },
    assassin: {
        name: 'Assassination',
        icon: '🗡️',
        minFeud: 65,
        eligible: (player) => livingChildren(player).length > 0,
        pickTarget(player) {
            const kids = livingChildren(player);
            const heir = kids.find(c => c.id === player.heir);
            const c = heir || Utils.randPick(kids);
            return { childId: c.id, label: `your ${heir ? 'heir' : 'child'} ${c.firstName || 'child'}` };
        },
        describe: (t) => `send an assassin after ${t.label}`,
        guard: { cost: 100, success: 0.85, label: 'Hire bodyguards' },
        resolve(player, world, scheme) {
            const child = (player.children || []).find(c => c.id === scheme.target.childId);
            if (!child || !child.isAlive) return null;
            if (Utils.random() < 0.5) {
                child.isAlive = false;
                if (player.heir === child.id) player.heir = null;
                return `An assassin's blade finds ${scheme.target.label}. They are dead.`;
            }
            return `An assassin strikes at ${scheme.target.label}, who survives, badly wounded.`;
        },
    },
};

export const Schemes = {

    CONFIG,
    TYPES: SCHEME_TYPES,

    _state(player) {
        const house = player && player.house;
        if (!house) return null;
        if (!Array.isArray(house.schemes)) house.schemes = [];
        if (!house._nextSchemeId) house._nextSchemeId = 1;
        return house;
    },

    /** Schemes currently in flight against the player. */
    active(player) {
        const house = Schemes._state(player);
        return house ? house.schemes : [];
    },

    /** Schemes the player knows about (revealed). */
    known(player) {
        return Schemes.active(player).filter(s => s.revealed);
    },

    /** Scheme types a rival with this feud could launch right now. */
    eligibleTypes(player, world, feud) {
        const taken = new Set(Schemes.active(player).map(s => s.type));
        return Object.keys(SCHEME_TYPES).filter(id => {
            const def = SCHEME_TYPES[id];
            return feud >= def.minFeud && !taken.has(id) && def.eligible(player, world);
        });
    },

    /** Hatch a scheme of `type` by `rival`. Returns the scheme or null. */
    hatch(player, world, rival, type) {
        const house = Schemes._state(player);
        const def = SCHEME_TYPES[type];
        if (!house || !def || !rival || !def.eligible(player, world)) return null;
        const day = (world && world.day) || 0;
        const target = def.pickTarget(player, world);
        const scheme = {
            id: house._nextSchemeId++,
            type,
            rivalId: rival.kingdomId,
            rivalName: rival.name,
            target,
            startDay: day,
            dueDay: day + Utils.randInt(CONFIG.leadMin, CONFIG.leadMax),
            revealed: false,
            guarded: false,
            spyTried: false,
        };
        house.schemes.push(scheme);
        return scheme;
    },

    /** Daily chance a hidden scheme is exposed. */
    revealChance(player) {
        let c = CONFIG.revealBase;
        const house = player.house;
        if (house && house.roles && house.roles.spymaster) c += CONFIG.revealSpymaster;
        const esp = player.espionage;
        if (esp) {
            const idle = (esp.spies || []).filter(s => s.status === 'idle').length;
            c += idle * CONFIG.revealPerIdleSpy;
            if ((esp.activeMissions || []).some(m => m.type === 'counter_espionage')) c += CONFIG.revealCounterEspionage;
        }
        return Math.min(0.9, c);
    },

    /** Expose every hidden scheme (a successful counter-espionage sweep). */
    revealAll(player) {
        const out = [];
        for (const s of Schemes.active(player)) {
            if (!s.revealed) { s.revealed = true; out.push(s); }
        }
        return out;
    },

    describe(scheme) {
        const def = SCHEME_TYPES[scheme.type];
        return `${scheme.rivalName} plots to ${def ? def.describe(scheme.target) : 'move against you'}`;
    },

    // ── Counter-play ────────────────────────────────────────────

    _find(player, schemeId) {
        return Schemes.active(player).find(s => s.id === schemeId) || null;
    },

    _remove(player, scheme) {
        const house = player.house;
        house.schemes = house.schemes.filter(s => s !== scheme);
    },

    bribeGoldCost(player, scheme) {
        const rival = player.house.rivals && player.house.rivals[scheme.rivalId];
        return 150 + 10 * ((rival && rival.feud) || 0);
    },

    bribePrestigeCost(player, scheme) {
        const rival = player.house.rivals && player.house.rivals[scheme.rivalId];
        return 10 + Math.floor(((rival && rival.feud) || 0) / 10);
    },

    /** Pay to guard the scheme's target; it may fail on the strike day. */
    guard(player, world, schemeId) {
        const scheme = Schemes._find(player, schemeId);
        if (!scheme || !scheme.revealed) return { success: false, reason: 'No such known plot.' };
        const def = SCHEME_TYPES[scheme.type];
        if (!def.guard) return { success: false, reason: 'Guards cannot stop this plot.' };
        if (scheme.guarded) return { success: false, reason: 'Already guarded.' };
        if (goldOf(player) < def.guard.cost) return { success: false, reason: `Need ${def.guard.cost} gold.` };
        player.gold -= def.guard.cost;
        scheme.guarded = true;
        return { success: true, cost: def.guard.cost, chance: def.guard.success };
    },

    /** Send an idle spy to break the plot before it strikes. One attempt per scheme. */
    sendSpy(player, world, schemeId) {
        const scheme = Schemes._find(player, schemeId);
        if (!scheme || !scheme.revealed) return { success: false, reason: 'No such known plot.' };
        if (scheme.spyTried) return { success: false, reason: 'Your agents already tried and failed.' };
        const spies = ((player.espionage && player.espionage.spies) || []).filter(s => s.status === 'idle');
        if (!spies.length) return { success: false, reason: 'No idle spy available.' };
        const spy = spies.slice().sort((a, b) => (b.level || 1) - (a.level || 1))[0];
        scheme.spyTried = true;
        const chance = Math.min(0.9, CONFIG.spyFoilBase + CONFIG.spyFoilPerLevel * (spy.level || 1));
        if (Utils.random() < chance) {
            spy.experience = (spy.experience || 0) + 25;
            Schemes._settle(player, world, scheme, 'foiled', `${spy.name} unmasked the plotters and broke their scheme.`);
            return { success: true, foiled: true, spy: spy.name };
        }
        spy.loyalty = Math.max(0, (spy.loyalty || 50) - 10);
        return { success: true, foiled: false, spy: spy.name };
    },

    /** Buy the rival off with gold or Prestige: cancels the scheme and cools the feud. */
    bribe(player, world, schemeId, currency = 'gold') {
        const scheme = Schemes._find(player, schemeId);
        if (!scheme || !scheme.revealed) return { success: false, reason: 'No such known plot.' };
        const day = (world && world.day) || 0;
        if (currency === 'prestige') {
            const cost = Schemes.bribePrestigeCost(player, scheme);
            if (!House.spend(player.house, cost, `bought off ${scheme.rivalName}`, day)) {
                return { success: false, reason: `Need ${cost} Prestige.` };
            }
        } else {
            const cost = Schemes.bribeGoldCost(player, scheme);
            if (goldOf(player) < cost) return { success: false, reason: `Need ${cost} gold.` };
            player.gold -= cost;
        }
        House.accrueRivalFeud(player, world, scheme.rivalId, CONFIG.feudOnBribe);
        Schemes._remove(player, scheme);
        House._chronicle(player.house, world, `${player.house.name} buys off ${scheme.rivalName}'s plot.`, ['rival', 'scheme']);
        return { success: true };
    },

    // ── Resolution ──────────────────────────────────────────────

    _settle(player, world, scheme, outcome, text) {
        Schemes._remove(player, scheme);
        const feudDelta = outcome === 'struck' ? CONFIG.feudOnSuccess : outcome === 'foiled' ? CONFIG.feudOnFoiled : 0;
        if (feudDelta) House.accrueRivalFeud(player, world, scheme.rivalId, feudDelta);
        if (text) House._chronicle(player.house, world, `${scheme.rivalName}: ${text}`, ['rival', 'scheme', outcome]);
        return { scheme, outcome, text, revealed: scheme.revealed };
    },

    _resolve(player, world, scheme) {
        const def = SCHEME_TYPES[scheme.type];
        if (!def) return Schemes._settle(player, world, scheme, 'fizzled', null);
        if (scheme.guarded && def.guard && Utils.random() < def.guard.success) {
            return Schemes._settle(player, world, scheme, 'foiled', `Your guards turned back the ${def.name.toLowerCase()} on ${scheme.target.label}.`);
        }
        const text = def.resolve(player, world, scheme);
        if (!text) return Schemes._settle(player, world, scheme, 'fizzled', null);
        return Schemes._settle(player, world, scheme, 'struck', text);
    },

    // ── Rival roster upkeep & feud sources ──────────────────────

    /** Drop rivals whose kingdom has fallen and seed replacements. */
    _refreshRivals(player, world) {
        const house = player.house;
        if (!house.rivals || !world || !world.kingdoms) return [];
        const replaced = [];
        for (const key of Object.keys(house.rivals)) {
            const k = world.kingdoms.find(x => x.id === house.rivals[key].kingdomId);
            if (!k || !k.isAlive) { replaced.push(house.rivals[key].name); delete house.rivals[key]; }
        }
        if (replaced.length) {
            const want = Object.keys(house.rivals).length + replaced.length;
            const candidates = world.kingdoms
                .filter(k => k && k.isAlive && k.id !== player.allegiance && !house.rivals[k.id])
                .sort((a, b) => (b.military || 0) - (a.military || 0));
            for (const k of candidates) {
                if (Object.keys(house.rivals).length >= want) break;
                const dyn = k.characterData && k.characterData.dynasty;
                house.rivals[k.id] = {
                    kingdomId: k.id,
                    name: (dyn && dyn.name) ? `House ${dyn.name}` : (k.name || k.id),
                    feud: 10,
                    lastActedDay: world.day || 0,
                };
                House._chronicle(house, world, `${house.rivals[k.id].name} rises to rival ${house.name}.`, ['rival']);
            }
        }
        return replaced;
    },

    /** Success breeds envy: rivals' feud creeps up as the House grows. */
    envyAmount(player, world) {
        const house = player.house;
        const amount = 1
            + Math.floor((house.prestige || 0) / 30)
            + Math.floor(workingProperties(player, world).length / 4)
            + playerColonies(player, world).length
            + (player.currentTitle ? 1 : 0);
        return Math.min(CONFIG.envyCap, amount);
    },

    _plot(player, world) {
        const house = player.house;
        if (house.schemes.length >= CONFIG.maxActive) return null;
        const busy = new Set(house.schemes.map(s => s.rivalId));
        const rival = Object.values(house.rivals || {})
            .filter(r => !busy.has(r.kingdomId))
            .sort((a, b) => (b.feud || 0) - (a.feud || 0))[0];
        if (!rival) return null;
        const options = Schemes.eligibleTypes(player, world, rival.feud || 0);
        if (!options.length) return null;
        const roll = Utils.random();
        if (roll >= (rival.feud || 0) / CONFIG.plotChanceDivisor) return null;
        const pick = Utils.random();
        const choice = House._brain.chooseScheme({ rival, options, roll: pick, house, world });
        const type = options.includes(choice) ? choice : options[options.length - 1];
        return Schemes.hatch(player, world, rival, type);
    },

    /**
     * Advance schemes one day. Call after House.processDaily.
     * @returns {{ revealed: object[], resolved: object[], hatched: object|null, replaced: string[] }}
     */
    processDaily(player, world) {
        const out = { revealed: [], resolved: [], hatched: null, replaced: [] };
        const house = Schemes._state(player);
        if (!house || !house.rivals) return out;
        const day = (world && world.day) || 0;

        out.replaced = Schemes._refreshRivals(player, world);

        if (day > 0 && day % CONFIG.envyCadence === 0) {
            const envy = Schemes.envyAmount(player, world);
            for (const key of Object.keys(house.rivals)) {
                House.accrueRivalFeud(player, world, key, envy, 'envy of your rise');
            }
        }

        // Strike or reveal existing schemes (copy: resolution mutates the list).
        for (const scheme of house.schemes.slice()) {
            if (day >= scheme.dueDay) {
                out.resolved.push(Schemes._resolve(player, world, scheme));
            } else if (!scheme.revealed && Utils.random() < Schemes.revealChance(player)) {
                scheme.revealed = true;
                out.revealed.push(scheme);
            }
        }

        if (day > 0 && day % CONFIG.plotCadence === 0) {
            out.hatched = Schemes._plot(player, world);
        }
        return out;
    },
};
