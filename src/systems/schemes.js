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
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Townsfolk } from './townsfolk.js';
import { Ledger } from './ledger.js';
import { Traits } from './traits.js';

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
    revealCounterEspionage: 0.30, // fallback for data/espionage.json counter_espionage.detectionBonus
    counterRadius: 3,          // fallback for counter_espionage.counterRadius
    feudOnSuccess: -10,       // a landed scheme partly sates the grudge
    feudOnFoiled: 5,          // a foiled one inflames it
    feudOnBribe: -15,
    spyFoilBase: 0.35,
    spyFoilPerLevel: 0.1,
    // Faces in town: the townsperson a rival works through (see Schemes._cast)
    suspectDays: 90,          // how long a named suspect can be confronted
    feudOnExposed: 5,         // a public accusation shames the rival
    feudOnMercy: -3,          // mercy to its man takes the edge off the grudge
    exposeReputation: 3,      // the realm's standing for rooting out a traitor
    recoverShare: 0.5,        // share of stolen gold an accused thief gives back
    turnBase: 60,             // gold to turn a suspect informant: base + perFeud * feud
    turnPerFeud: 2,
    informantDays: 120,       // an informant watches their rival this long
    informantReveal: 0.15,    // daily reveal chance an informant adds against their rival
    mercyKarma: 3,
};

/** Who a rival hires for each kind of plot (townsfolk roles, best first), and what they do. */
const AGENTS = {
    slander: { roles: ['traveler', 'merchant', 'villager', 'priest'], deed: 'spread lies about {house}' },
    theft: { roles: ['merchant', 'villager'], deed: 'let thieves at the treasury of {house}' },
    sabotage: { roles: ['blacksmith_npc', 'farmer', 'villager'], deed: 'wrecked the works of {house}' },
    raid_property: { roles: ['guard', 'villager'], deed: 'opened the way to raiders against {house}' },
    incite_unrest: { roles: ['priest', 'farmer', 'villager'], deed: 'stirred revolt against {house}' },
    assassin: { roles: ['villager', 'merchant', 'guard'], deed: 'sheltered an assassin sent against {house}' },
};

/** A unit roll from a string — the shared RNG is never drawn for the faces. */
function _hroll(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 100000) / 100000;
}

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
        resolve(player, world, scheme) {
            const loss = Math.min(2000, Math.floor(goldOf(player) * Utils.randFloat(0.08, 0.15)));
            player.gold = goldOf(player) - loss;
            if (scheme) scheme.loss = loss;
            Ledger.record(player, 'schemeLosses', -loss);
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
        const agent = Schemes._cast(player, world, scheme);
        if (agent) scheme.agent = agent;
        house.schemes.push(scheme);
        return scheme;
    },

    // ── Faces in town ───────────────────────────────────────────

    /** The settlement whose people a scheme works through: the one nearest its target (or the player). */
    _townOf(player, world, scheme) {
        const views = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const t = scheme && scheme.target;
        const q = t && t.q != null ? t.q : player && player.q;
        const r = t && t.q != null ? t.r : player && player.r;
        let best = null;
        for (const s of views) {
            const folk = s && s.folk;
            if (!folk || !Array.isArray(folk.people) || Townsfolk.residents(folk).length < 3) continue;
            const d = q != null ? Hex.distance(q, r, folk.q, folk.r) : 0;
            if (!best || d < best.d) best = { s, folk, d };
        }
        return best;
    },

    /** An adult resident of `folk` suited to `roles` (not one in the player's own life), by hash. */
    _castPerson(folk, world, roles, key, exclude = null) {
        const day = (world && world.day) || 0;
        const pool = Townsfolk.residents(folk).filter(p => p !== exclude && !p.rnpc && !p.wedHouse
            && Townsfolk.age(p, day) >= 17 && p.role !== 'child' && p.role !== 'noble');
        if (!pool.length) return null;
        for (const role of roles || []) {
            const fit = pool.filter(p => p.role === role);
            if (fit.length) return fit[Math.floor(_hroll(`${key}|${role}`) * fit.length) % fit.length];
        }
        return pool[Math.floor(_hroll(`${key}|any`) * pool.length) % pool.length];
    },

    /** Pick the townsperson a scheme works through: { q, r, pid, name, role, town } or null. */
    _cast(player, world, scheme) {
        const town = Schemes._townOf(player, world, scheme);
        if (!town) return null;
        const seed = (world && world.generationParams && world.generationParams.seed) || 1;
        const a = AGENTS[scheme.type] || AGENTS.slander;
        const p = Schemes._castPerson(town.folk, world, a.roles, `${seed}|scheme${scheme.id}|${scheme.startDay}|${scheme.rivalId}`);
        if (!p) return null;
        return { q: town.folk.q, r: town.folk.r, pid: p.id, name: Townsfolk.name(p), role: Townsfolk.roleTitle(p), town: town.s.name || 'the town' };
    },

    /** The live roster and person behind an agent record, or null when they are gone. */
    _agentPerson(world, agent) {
        if (!agent || !world || typeof world.getTile !== 'function') return null;
        const tile = world.getTile(agent.q, agent.r);
        const folk = tile && tile.settlement && tile.settlement.folk;
        const p = folk ? Townsfolk.get(folk, agent.pid) : null;
        return p ? { folk, person: p, settlement: tile.settlement } : null;
    },

    /** "spread lies about House X" for an agent of this scheme. */
    _deed(player, scheme) {
        const a = AGENTS[scheme.type] || AGENTS.slander;
        return a.deed.replace('{house}', (player.house && player.house.name) || 'your House');
    },

    /** Name the scheme's agent a suspect the player can confront in town. */
    _suspect(player, world, scheme, status) {
        const house = player.house;
        if (!house || !scheme.agent) return null;
        if (!Array.isArray(house.suspects)) house.suspects = [];
        const found = Schemes._agentPerson(world, scheme.agent);
        if (!found || !Townsfolk.isHere(found.person)) return null;
        let s = house.suspects.find(x => x.schemeId === scheme.id);
        const day = (world && world.day) || 0;
        if (!s) {
            house._nextSuspectId = (house._nextSuspectId || 0) + 1;
            s = {
                id: house._nextSuspectId, schemeId: scheme.id, type: scheme.type,
                rivalId: scheme.rivalId, rivalName: scheme.rivalName,
                ...scheme.agent, status, day, untilDay: day + CONFIG.suspectDays, loss: scheme.loss || 0,
            };
            house.suspects.push(s);
            // Keep the record short: drop long-settled ones
            if (house.suspects.length > 20) house.suspects = house.suspects.filter(x => !x.outcome && day <= x.untilDay).slice(-20);
        } else {
            s.status = status;
            s.loss = scheme.loss || s.loss || 0;
        }
        return s;
    },

    /** Suspects the player can still confront (alive, in town, not yet dealt with). */
    suspects(player, world) {
        const house = player && player.house;
        if (!house || !Array.isArray(house.suspects)) return [];
        const day = (world && world.day) || 0;
        return house.suspects.filter(s => {
            if (s.outcome || day > s.untilDay) return false;
            const f = Schemes._agentPerson(world, s);
            return !!f && Townsfolk.isHere(f.person);
        });
    },

    /** The open suspect record for this townsperson, or null. */
    suspectFor(player, world, folk, person) {
        if (!folk || !person) return null;
        return Schemes.suspects(player, world).find(s => s.q === folk.q && s.r === folk.r && s.pid === person.id) || null;
    },

    /** Gold to turn a suspect into the player's informant. */
    turnCost(player, suspect) {
        const rival = player.house && player.house.rivals && player.house.rivals[suspect.rivalId];
        return CONFIG.turnBase + CONFIG.turnPerFeud * Math.round((rival && rival.feud) || 0);
    },

    /**
     * Confront a suspect: 'accuse' (named a traitor and driven out; a plot
     * still in hand is foiled, the realm thanks you, the rival is shamed and
     * angrier, their kin turn on you; a thief gives back part of the haul),
     * 'turn' (pay them to inform on their master: the plot is foiled and
     * that rival's next plots come to light far more easily), or 'release'
     * (mercy: karma, a friend for life, the grudge cools — but a plot still
     * in hand goes on).
     * @returns {{ success, text, outcome, gold? }}
     */
    confront(player, world, suspectId, choice) {
        const house = player && player.house;
        const s = house && Array.isArray(house.suspects) ? house.suspects.find(x => x.id === suspectId) : null;
        if (!s || s.outcome) return { success: false, reason: 'They are no longer a suspect.' };
        const found = Schemes._agentPerson(world, s);
        if (!found || !Townsfolk.isHere(found.person)) return { success: false, reason: 'They are gone from town.' };
        const { folk, person, settlement } = found;
        const day = (world && world.day) || 0;
        const scheme = Schemes._find(player, s.schemeId);
        if (scheme) scheme._confronted = true;
        const kingdomId = settlement && settlement.kingdom;
        if (!person.mem) person.mem = { timesSpoken: 0, disposition: 50, lastAction: null, giftsReceived: 0, threatened: false, flattered: false, questOffered: false, rumorsTold: 0, playerTitle: null };
        const mem = person.mem;
        const disp = () => (typeof mem.disposition === 'number' ? mem.disposition : 50);
        const out = { success: true, outcome: choice };

        if (choice === 'accuse') {
            if (scheme) Schemes._settle(player, world, scheme, 'foiled', `${s.name} of ${s.town} was unmasked as their agent; the plot is broken.`);
            House.accrueRivalFeud(player, world, s.rivalId, CONFIG.feudOnExposed, 'exposed in public');
            if (kingdomId) {
                if (!player.reputation) player.reputation = {};
                player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + CONFIG.exposeReputation;
            }
            if (!scheme && s.loss > 0) {
                const gold = Math.floor(s.loss * CONFIG.recoverShare);
                player.gold = goldOf(player) + gold;
                Ledger.record(player, 'schemeLosses', gold);
                out.gold = gold;
            }
            mem.disposition = 0;
            mem.grudge = true;
            // Their kin take it hard
            for (const id of [person.spouse, ...(person.parents || []), ...(person.kids || [])]) {
                const k = id != null ? Townsfolk.get(folk, id) : null;
                if (k && k.mem) k.mem.disposition = Math.max(0, (typeof k.mem.disposition === 'number' ? k.mem.disposition : 50) - 20);
            }
            Townsfolk.exile(folk, person, day, `exile, for serving ${s.rivalName}`);
            Townsfolk.record(folk, world, day, { k: 'exiled', a: person.id, x: `for serving ${s.rivalName}` });
            House._chronicle(house, world, `${house.name} unmasks ${s.name} of ${s.town} as an agent of ${s.rivalName}.`, ['rival', 'scheme', 'suspect']);
            out.text = `You name ${s.name} a traitor before all ${s.town}, and they are driven out of town.${scheme ? ' The plot is broken.' : ''}${out.gold ? ` ${out.gold} gold of what was stolen is recovered.` : ''} ${s.rivalName} is shamed — and angrier.`;
        } else if (choice === 'turn') {
            const cost = Schemes.turnCost(player, s);
            if (goldOf(player) < cost) return { success: false, reason: `They want ${cost} gold.` };
            player.gold = goldOf(player) - cost;
            Ledger.record(player, 'informants', -cost);
            out.gold = -cost;
            if (scheme) Schemes._settle(player, world, scheme, 'foiled', `${s.name} of ${s.town}, turned by your coin, fed the plotters false word.`);
            if (!house.informants || typeof house.informants !== 'object') house.informants = {};
            house.informants[s.rivalId] = { name: s.name, town: s.town, q: s.q, r: s.r, pid: s.pid, untilDay: day + CONFIG.informantDays };
            mem.disposition = Math.min(100, disp() + 15);
            Townsfolk.note(person, day, 'informant', null, s.rivalName);
            House._chronicle(house, world, `${s.name} of ${s.town} turns informant against ${s.rivalName}.`, ['rival', 'scheme', 'suspect']);
            out.text = `${cost} gold buys ${s.name}'s loyalty. ${scheme ? 'They feed the plotters false word, and the plot comes to nothing. ' : ''}For the next ${CONFIG.informantDays} days they will warn you of ${s.rivalName}'s plots.`;
        } else if (choice === 'release') {
            player.karma = (player.karma || 0) + CONFIG.mercyKarma;
            Traits.recordDeeds(player, { mercy: 1 });
            House.accrueRivalFeud(player, world, s.rivalId, CONFIG.feudOnMercy);
            mem.disposition = Math.min(100, disp() + 25);
            Townsfolk.note(person, day, 'spared', null, `serving ${s.rivalName}`);
            if (scheme) scheme._confronted = false;
            out.text = `You let ${s.name} go. They weep their thanks.${scheme ? ` ${s.rivalName}'s plot goes on without them.` : ''} (+${CONFIG.mercyKarma} karma)`;
        } else {
            if (scheme) scheme._confronted = false;
            return { success: false, reason: 'Unknown choice.' };
        }
        s.outcome = choice;
        s.outcomeDay = day;
        return out;
    },

    /** The faces of a plot that struck or failed: the town annals, a guard slain, a suspect named. */
    _faces(player, world, scheme, outcome) {
        const found = scheme.agent ? Schemes._agentPerson(world, scheme.agent) : null;
        const day = (world && world.day) || 0;
        if (!found || !Townsfolk.isHere(found.person)) return null;
        const { folk, person } = found;
        const parts = [];
        if (outcome === 'struck') {
            Townsfolk.record(folk, world, day, { k: 'plot', a: person.id, x: `${scheme.rivalName}|${Schemes._deed(player, scheme)}` });
            Townsfolk.note(person, day, 'plotted', null, scheme.rivalName);
            parts.push(`Word in ${scheme.agent.town} is that ${scheme.agent.name}, ${scheme.agent.role}, did their work.`);
            if (scheme.type === 'raid_property') {
                const seed = (world && world.generationParams && world.generationParams.seed) || 1;
                const victim = Schemes._castPerson(folk, world, ['guard'], `${seed}|scheme${scheme.id}|victim`, person);
                if (victim && victim.role === 'guard') {
                    const cause = `cut down by ${scheme.rivalName}'s raiders`;
                    Townsfolk.slay(folk, victim, day, cause);
                    Townsfolk.record(folk, world, day, { k: 'died', a: victim.id, x: cause });
                    parts.push(`${Townsfolk.name(victim)}, a guard of ${scheme.agent.town}, died defending your holding.`);
                }
                for (const p of Townsfolk.residents(folk).filter(x => x !== person && x.mem && x.mem.timesSpoken > 0).slice(0, 2)) {
                    Townsfolk.note(p, day, 'raided', null, `${scheme.rivalName}'s raiders`);
                }
            }
        } else if (outcome === 'foiled') {
            Townsfolk.record(folk, world, day, { k: 'plotFoiled', a: person.id, x: scheme.rivalName });
            parts.push(`${scheme.agent.name}, ${scheme.agent.role} of ${scheme.agent.town}, was seen slipping away.`);
        } else {
            return null;
        }
        const suspect = Schemes._suspect(player, world, scheme, outcome);
        if (suspect) parts.push(`Confront them in ${suspect.town}.`);
        return parts.join(' ');
    },

    /**
     * Daily chance a hidden scheme is exposed. Any counter-espionage mission
     * adds its detectionBonus; a scheme aimed at a holding within the
     * station's counterRadius is watched twice over.
     */
    revealChance(player, scheme = null, day = null) {
        let c = CONFIG.revealBase;
        const house = player.house;
        if (house && house.roles && house.roles.spymaster) c += CONFIG.revealSpymaster;
        // A townsperson turned informant against this rival (Schemes.confront 'turn')
        const inf = scheme && house && house.informants ? house.informants[scheme.rivalId] : null;
        if (inf && (day == null || day <= inf.untilDay)) c += CONFIG.informantReveal;
        const esp = player.espionage;
        if (esp) {
            const idle = (esp.spies || []).filter(s => s.status === 'idle').length;
            c += idle * CONFIG.revealPerIdleSpy;
            if (Schemes.counterStations(player).length) {
                const { detectionBonus } = Schemes.counterEspionageEffects();
                c += detectionBonus;
                if (scheme && Schemes.isCovered(player, scheme)) c += detectionBonus;
            }
        }
        // ...while one of the rival's own informants in your towns warns them (systems/rivalAgents.js)
        const ra = player.rivalAgents && Array.isArray(player.rivalAgents.agents) ? player.rivalAgents.agents : null;
        if (scheme && ra && ra.some(a => a && a.rivalId === scheme.rivalId && a.kind === 'informant' && !a.turned)) {
            const g = DataLoader._gamedata;
            const inf = g && g.coalitions && g.coalitions.agents && g.coalitions.agents.kinds ? g.coalitions.agents.kinds.informant : null;
            c *= inf && typeof inf.revealCut === 'number' ? inf.revealCut : 0.5;
        }
        return Math.min(0.9, c);
    },

    /** detectionBonus / counterRadius of the counter_espionage mission (data/espionage.json). */
    counterEspionageEffects() {
        const def = DataLoader.espionage && DataLoader.espionage.missions && DataLoader.espionage.missions.counter_espionage;
        const fx = (def && def.effects) || {};
        return {
            detectionBonus: typeof fx.detectionBonus === 'number' ? fx.detectionBonus : CONFIG.revealCounterEspionage,
            counterRadius: typeof fx.counterRadius === 'number' ? fx.counterRadius : CONFIG.counterRadius,
        };
    },

    /** Where counter-espionage spies are posted (missions from older saves: the player's position). */
    counterStations(player) {
        const missions = (player.espionage && player.espionage.activeMissions) || [];
        return missions.filter(m => m.type === 'counter_espionage').map(m => ({
            q: m.stationQ != null ? m.stationQ : player.q,
            r: m.stationR != null ? m.stationR : player.r,
        }));
    },

    /** Is the scheme's target a place inside a counter-espionage station's radius? */
    isCovered(player, scheme) {
        const t = scheme && scheme.target;
        if (!t || t.q == null || t.r == null) return false;
        const { counterRadius } = Schemes.counterEspionageEffects();
        return Schemes.counterStations(player).some(s => Hex.distance(s.q, s.r, t.q, t.r) <= counterRadius);
    },

    /** Expose every hidden scheme (a successful counter-espionage sweep). */
    revealAll(player, world = null) {
        const out = [];
        for (const s of Schemes.active(player)) {
            if (!s.revealed) {
                s.revealed = true;
                out.push(s);
                if (world) Schemes._suspect(player, world, s, 'plotting');
            }
        }
        return out;
    },

    describe(scheme) {
        const def = SCHEME_TYPES[scheme.type];
        const a = scheme.revealed && scheme.agent;
        return `${scheme.rivalName} plots to ${def ? def.describe(scheme.target) : 'move against you'}`
            + (a ? ` — through ${a.name}, ${a.role} of ${a.town}` : '');
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
        // The townsfolk it worked through (a plot settled by confronting its agent names no one new)
        const faces = text && !scheme._confronted ? Schemes._faces(player, world, scheme, outcome) : null;
        return { scheme, outcome, text: faces ? `${text} ${faces}` : text, revealed: scheme.revealed };
    },

    _resolve(player, world, scheme) {
        const def = SCHEME_TYPES[scheme.type];
        if (!def) return Schemes._settle(player, world, scheme, 'fizzled', null);
        if (scheme.guarded && def.guard && Utils.random() < def.guard.success) {
            return Schemes._settle(player, world, scheme, 'foiled', `Your guards turned back the ${def.name.toLowerCase()} on ${scheme.target.label}.`);
        }
        // Counter-espionage agents posted nearby may catch the plotters in the act
        if (Schemes.isCovered(player, scheme) && Utils.random() < Schemes.counterEspionageEffects().detectionBonus) {
            return Schemes._settle(player, world, scheme, 'foiled', `Your counter-espionage agents caught the plotters before they struck ${scheme.target.label}.`);
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
            } else if (!scheme.revealed && Utils.random() < Schemes.revealChance(player, scheme, day)) {
                scheme.revealed = true;
                Schemes._suspect(player, world, scheme, 'plotting');
                out.revealed.push(scheme);
            }
        }

        if (day > 0 && day % CONFIG.plotCadence === 0) {
            out.hatched = Schemes._plot(player, world);
        }
        return out;
    },
};
