// ============================================
// PRISON — the days in a cell, and the ways out of it
// ============================================
// player.jailState (made by the watch, the underworld, debtors' prison, map
// theft, …) keeps its old shape: days remaining, bail, the old escape
// chance. When the player first looks around the cell (the prison panel,
// ui/actionMenu/prisonScenes.js) it gains a sub-state, jailState.prison:
//
//   • CELLMATES — two or three, named by a hash of the town and the sentence,
//     each an archetype (data/underworld.json → prison.archetypes): the
//     smuggler (befriended, has tools brought in), the informant (sells you
//     out if you dig while he isn't your friend — befriended, he tells you the
//     guards' rounds), the old soldier (follows you out as a companion), the
//     fence (a guild contact once you're out). Talk (once a day each, charm
//     and diplomacy) or share food from your packs to win them over.
//   • BRIBES — a guard looks the other way tonight, brings tools, or "loses"
//     your papers (early release). The price scales with the town's size,
//     the sentence and the offence; a guard may refuse and report you.
//   • THE TUNNEL — with tools, a day's digging adds progress; the informant
//     or a cell search may find it (tools taken, days added). At 100% you can
//     go out through it.
//   • LABOUR — a day in the yard counts double against the sentence.
//   • JAILBREAK — once a day: rush the guard, slip out at the change of the
//     watch (helped by a bribed guard and friends), or the tunnel. An escape
//     brings heat with the crown (Underworld 'jailbreak' crime: posters and
//     warrants) and a gaoler's bounty (Gossip), and costs reputation.
//
// processDay (from PlayerActions.endDay) draws only when jailState.prison
// exists, on its own seeded stream, so the soak bot's jail stints keep their
// dice. Explicit params; Utils RNG; no DOM.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Underworld } from '../systems/underworld.js';
import { Gossip } from '../systems/gossip.js';
import { Relationships } from '../systems/relationships.js';
import { Ledger } from '../systems/ledger.js';
import { Traits } from '../systems/traits.js';
import { Hex } from '../core/hex.js';
import { WorldUnit } from '../world/units.js';

const DEFAULTS = {
    cellmates: { count: [2, 3], firstNames: ['Odo'], epithets: ['the Grey'] },
    archetypes: {
        smuggler: { label: 'Smuggler', icon: '📦', blurb: '', friendAt: 2, toolsCost: 20 },
        informant: { label: 'Informant', icon: '👂', blurb: '', friendAt: 3, betrayChance: 0.2, breakBonus: 0.15 },
        veteran: { label: 'Old Soldier', icon: '💂', blurb: '', friendAt: 3, breakBonus: 0.1 },
        fence: { label: 'Fence', icon: '💍', blurb: '', friendAt: 2, standing: 5 },
    },
    talk: { base: 0.45, charisma: 0.03, diplomacy: 0.04, foods: ['bread', 'food', 'meat', 'fish'] },
    bribe: {
        base: { village: 15, town: 30, city: 50, capital: 80 }, perDay: 0.12, perOffense: 0.25,
        lookAwayMult: 1, releaseMult: 3, toolsMult: 0.6,
        refuse: { village: 0.1, town: 0.2, city: 0.3, capital: 0.4 }, diplomacy: 0.03, lookAwayBonus: 0.35, reportDays: [1, 3],
    },
    tunnel: { perDay: [12, 22], strength: 1.5, toolBreak: 0.25, discovery: 0.06, discoveryPer10: 0.01, escapeChance: 0.85, addedDays: [2, 4] },
    work: { extraDays: 1, health: 2, strength: 0.1 },
    breakout: { rush: { base: 0.12, combat: 0.04, strength: 0.01 }, slip: { base: 0.1, stealth: 0.04 }, failDays: [2, 5], reputation: 10, bounty: 60 },
    servitude: { bribeShare: 0.4, bribeBase: 0.5, bribeDiplomacy: 0.04, failDays: [1, 3], workExtraDays: 1 },
};

// The march from a settlement with no jail to one with (data/jail.json → transport)
const TRANSPORT_DEFAULTS = {
    jailTypes: ['town', 'city', 'capital'],
    hexesPerDay: 4,
    raid: { base: 0.06, perHostile: 0.2, radius: 3, max: 0.6 },
    events: { bribe: 0.1, delay: 0.08, kindness: 0.08, cruelty: 0.08 },
    slip: { base: 0.3, stealth: 0.05, agility: 0.02 },
    fight: { base: 0.35, combat: 0.06, strength: 0.01, reward: 0.34 },
    stay: { guardsWin: 0.65, takenShare: 0.6 },
    bribeCost: [20, 60],
    kindnessHealth: 6,
    crueltyHealth: 6,
    lines: { quiet: ['The escort marches on.'], arrive: ['You are marched into {town} in chains.'], outcomes: {} },
};

function _fill(text, vars = {}) {
    return text ? String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : text;
}

function _pick(arr, vars = {}) {
    if (!Array.isArray(arr) || !arr.length) return null;
    return _fill(arr[Math.floor(Utils.random() * arr.length) % arr.length], vars);
}

const ARCHETYPE_ORDER = ['smuggler', 'informant', 'veteran', 'fence'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v) => Math.max(0.03, Math.min(0.95, v));
const _day = (world) => _num(world && world.day);

function _hash(...parts) {
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return h >>> 0;
}

const _seed = (world) => (world && world.generationParams && world.generationParams.seed) || 0;
const _skill = (player, id) => _num(player && player.skills && player.skills[id], 1);

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) ? _merge(base[k], v) : v;
    }
    return out;
}

let _cfg = null;
let _cfgSrc;

export const Prison = {
    DEFAULTS,

    config() {
        const src = (DataLoader.underworld && DataLoader.underworld.prison) || null;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            _cfg = _merge(DEFAULTS, src || {});
        }
        return _cfg;
    },

    /** Where the jail is: the settlement (live object), its type, kingdom and hex. */
    _where(player, world) {
        const jail = player.jailState;
        const here = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        if (here && here.settlement && (!jail || here.settlement.name === jail.settlement)) {
            return { settlement: here.settlement, type: here.settlement.type || 'town', kingdom: here.settlement.kingdom || null, q: here.q, r: here.r };
        }
        const all = world && typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        const s = all.find(x => jail && x.name === jail.settlement);
        if (s) return { settlement: s, type: s.type || 'town', kingdom: s.kingdom || null, q: s.q, r: s.r };
        return { settlement: null, type: 'town', kingdom: here && here.kingdom ? here.kingdom : null, q: player.q, r: player.r };
    },

    /** The prison sub-state of the current sentence (created on first look). */
    state(player, world) {
        const jail = player && player.jailState;
        if (!jail) return null;
        if (jail.prison && typeof jail.prison === 'object') return jail.prison;
        const cfg = Prison.config();
        const where = Prison._where(player, world);
        const key = [_seed(world), jail.settlement, jail.offense, jail.offenseNumber, jail.totalDays];
        const [lo, hi] = cfg.cellmates.count;
        const n = lo + (_hash(...key, 'n') % (Math.max(0, hi - lo) + 1));
        const order = ARCHETYPE_ORDER.filter(a => cfg.archetypes[a]);
        const start = _hash(...key, 'arch') % order.length;
        const cellmates = [];
        for (let i = 0; i < n; i++) {
            const archetype = order[(start + i) % order.length];
            cellmates.push({
                id: `cm${i}`,
                name: `${cfg.cellmates.firstNames[_hash(...key, i, 'f') % cfg.cellmates.firstNames.length]} ${cfg.cellmates.epithets[_hash(...key, i, 'e') % cfg.cellmates.epithets.length]}`,
                archetype, rapport: 0, friend: false, talkedDay: null, sold: false,
            });
        }
        jail.prison = {
            startDay: _day(world), type: where.type, kingdom: where.kingdom, q: where.q, r: where.r,
            cellmates, tools: 0, tunnel: 0, toolsDueDay: null, lookAwayDay: null, lastBreakDay: null,
            failedBreaks: 0, workDays: 0, log: [],
        };
        return jail.prison;
    },

    _log(pr, text) {
        pr.log.push(text);
        if (pr.log.length > 12) pr.log.splice(0, pr.log.length - 12);
    },

    archetype(id) {
        return Prison.config().archetypes[id] || { label: id, icon: '👤', friendAt: 3 };
    },

    friend(pr, archetype) {
        return pr.cellmates.find(c => c.archetype === archetype && c.friend) || null;
    },

    // ── Cellmates ─────────────────────────────────────

    talkChance(player) {
        const t = Prison.config().talk;
        return _clamp(t.base + _num(player.charisma, 5) * t.charisma + _skill(player, 'diplomacy') * t.diplomacy);
    },

    _food(player) {
        const inv = player.inventory || {};
        return (Prison.config().talk.foods || []).find(id => _num(inv[id]) > 0) || null;
    },

    /** Talk to a cellmate ('talk', a charm roll) or share food ('food', certain). Once a day each. */
    talk(player, world, mateId, how = 'talk') {
        const pr = Prison.state(player, world);
        const m = pr && pr.cellmates.find(c => c.id === mateId);
        if (!m) return { success: false, reason: 'No one by that name here.' };
        const day = _day(world);
        if (m.talkedDay === day) return { success: false, reason: `You have already spent time with ${m.name} today.` };
        if (m.sold) return { success: false, reason: `${m.name} will not meet your eye since the guards came.` };
        let ok;
        if (how === 'food') {
            const food = Prison._food(player);
            if (!food) return { success: false, reason: 'You have nothing to share.' };
            player.inventory[food] -= 1;
            if (player.inventory[food] <= 0) delete player.inventory[food];
            ok = true;
        } else {
            ok = Utils.random() < Prison.talkChance(player);
            if (!player.skills) player.skills = {};
            player.skills.diplomacy = Math.min(10, _skill(player, 'diplomacy') + (ok ? 0.05 : 0.02));
        }
        m.talkedDay = day;
        const def = Prison.archetype(m.archetype);
        if (ok) m.rapport += 1;
        const became = ok && !m.friend && m.rapport >= _num(def.friendAt, 3);
        if (became) m.friend = true;
        const text = became ? `${m.name} the ${def.label.toLowerCase()} counts you a friend now.`
            : ok ? `You and ${m.name} talk long into the night.` : `${m.name} turns to the wall and says nothing.`;
        Prison._log(pr, text);
        return { success: true, ok, became, text };
    },

    /** A befriended smuggler has tools brought in tomorrow (for gold). */
    orderTools(player, world, mateId) {
        const pr = Prison.state(player, world);
        const m = pr && pr.cellmates.find(c => c.id === mateId);
        if (!m || m.archetype !== 'smuggler' || !m.friend) return { success: false, reason: 'Only a friend with the right connections can arrange that.' };
        if (pr.toolsDueDay != null) return { success: false, reason: 'Tools are already on their way.' };
        const cost = _num(Prison.archetype('smuggler').toolsCost, 20);
        if (_num(player.gold) < cost) return { success: false, reason: `It will cost ${cost} gold.` };
        player.gold -= cost;
        Ledger.record(player, 'bribes', -cost);
        pr.toolsDueDay = _day(world) + 1;
        const text = `${m.name} takes your ${cost} gold: "Tomorrow, in the bread."`;
        Prison._log(pr, text);
        return { success: true, text, cost };
    },

    // ── Bribes ────────────────────────────────────────

    bribeCost(player, world, kind) {
        const b = Prison.config().bribe;
        const jail = player.jailState;
        const pr = Prison.state(player, world);
        const base = _num(b.base[pr.type], _num(b.base.town, 30));
        const mult = { lookaway: b.lookAwayMult, release: b.releaseMult, tools: b.toolsMult }[kind] || 1;
        const days = kind === 'release' ? _num(jail.daysRemaining, 1) : _num(jail.totalDays, 1);
        return Math.max(5, Math.round(base * (1 + days * b.perDay) * (1 + (_num(jail.offenseNumber, 1) - 1) * b.perOffense) * mult));
    },

    bribeChance(player, world) {
        const b = Prison.config().bribe;
        const pr = Prison.state(player, world);
        return _clamp(1 - _num(b.refuse[pr.type], 0.2) + _skill(player, 'diplomacy') * b.diplomacy);
    },

    /** Bribe a guard: 'lookaway' (tonight), 'tools', 'release' (lost papers). */
    bribe(player, world, kind) {
        const jail = player.jailState;
        if (!jail) return { success: false, reason: 'You are not in jail.' };
        const pr = Prison.state(player, world);
        const cost = Prison.bribeCost(player, world, kind);
        if (_num(player.gold) < cost) return { success: false, reason: `The guard wants ${cost} gold.` };
        const day = _day(world);
        if (kind === 'lookaway' && pr.lookAwayDay === day) return { success: false, reason: 'A guard already owes you tonight.' };
        player.gold -= cost;
        Ledger.record(player, 'bribes', -cost);
        const ok = Utils.random() < Prison.bribeChance(player, world);
        if (!ok) {
            const [lo, hi] = Prison.config().bribe.reportDays;
            const added = Utils.randInt(lo, hi);
            jail.daysRemaining += added;
            jail.totalDays += added;
            const text = `The guard pocketed your ${cost} gold and reported you anyway: +${added} day${added === 1 ? '' : 's'}.`;
            Prison._log(pr, text);
            return { success: true, ok: false, cost, added, text };
        }
        Traits.recordDeed(player, 'deceit', 0.5);
        if (kind === 'release') {
            const text = `For ${cost} gold, your papers were "lost". The door is opened for you before dawn.`;
            const rel = Prison.release(player, world, 'bribed');
            return { success: true, ok: true, cost, released: true, text: `${text}${rel.text ? ` ${rel.text}` : ''}` };
        }
        if (kind === 'tools') {
            pr.tools += 1;
            const text = `${cost} gold, and a chisel and a spoon-handle come in under the guard's cloak.`;
            Prison._log(pr, text);
            return { success: true, ok: true, cost, text };
        }
        pr.lookAwayDay = day;
        const text = `${cost} gold: tonight the guard on your corridor will be looking the other way.`;
        Prison._log(pr, text);
        return { success: true, ok: true, cost, text };
    },

    // ── Days in the cell ──────────────────────────────

    /** A day of labour in the yard: counts double against the sentence. The caller ends the day. */
    work(player, world) {
        const jail = player.jailState;
        if (!jail) return { success: false, reason: 'You are not in jail.' };
        const pr = Prison.state(player, world);
        const w = Prison.config().work;
        const extra = Math.min(Math.max(0, jail.daysRemaining - 1), _num(w.extraDays, 1));
        jail.daysRemaining -= extra;
        pr.workDays += 1;
        player.health = Math.max(5, _num(player.health, 100) - _num(w.health, 2));
        player.strength = Math.min(20, _num(player.strength, 5) + _num(w.strength, 0.1));
        const text = `A day breaking stones in the yard${extra ? ' — it counts double' : ''}.`;
        Prison._log(pr, text);
        return { success: true, extra, text };
    },

    /** A day on the tunnel (needs tools). The caller ends the day. */
    dig(player, world) {
        const jail = player.jailState;
        if (!jail) return { success: false, reason: 'You are not in jail.' };
        const pr = Prison.state(player, world);
        if (pr.tools <= 0) return { success: false, reason: 'You have nothing to dig with.' };
        if (pr.tunnel >= 100) return { success: false, reason: 'The tunnel is through. Go.' };
        const t = Prison.config().tunnel;
        const gain = Math.round(Utils.randInt(t.perDay[0], t.perDay[1]) + (_num(player.strength, 5) - 5) * t.strength);
        pr.tunnel = Math.min(100, pr.tunnel + Math.max(4, gain));
        let broke = false;
        if (Utils.random() < t.toolBreak) {
            pr.tools -= 1;
            broke = true;
        }
        const text = `You dig behind the loose stone: the tunnel is ${pr.tunnel}% of the way${broke ? ', but a tool snapped' : ''}.`;
        Prison._log(pr, text);
        return { success: true, gain, broke, tunnel: pr.tunnel, text };
    },

    // ── Jailbreak ─────────────────────────────────────

    breakChance(player, world, kind) {
        const pr = Prison.state(player, world);
        const jail = player.jailState;
        const b = Prison.config().breakout;
        const bonus = ['informant', 'veteran'].reduce((s, a) => s + (Prison.friend(pr, a) ? _num(Prison.archetype(a).breakBonus) : 0), 0)
            - pr.failedBreaks * 0.03 + (pr.lookAwayDay === _day(world) ? _num(Prison.config().bribe.lookAwayBonus) : 0);
        if (kind === 'tunnel') return pr.tunnel >= 100 ? _clamp(_num(Prison.config().tunnel.escapeChance, 0.85) + bonus * 0.5) : 0;
        if (kind === 'rush') return _clamp(b.rush.base + _skill(player, 'combat') * b.rush.combat + _num(player.strength, 5) * b.rush.strength + bonus);
        return _clamp(Math.max(_num(jail && jail.escapeChance, 0.1), b.slip.base + _skill(player, 'stealth') * b.slip.stealth) + bonus);
    },

    canBreakToday(player, world) {
        const pr = Prison.state(player, world);
        return !!pr && pr.lastBreakDay !== _day(world);
    },

    /** Try to break out: 'rush' | 'slip' | 'tunnel'. Once a day. */
    breakout(player, world, kind) {
        const jail = player.jailState;
        if (!jail) return { success: false, reason: 'You are not in jail.' };
        const pr = Prison.state(player, world);
        if (!Prison.canBreakToday(player, world)) return { success: false, reason: 'The guards are wary after today\'s attempt. Wait for another night.' };
        if (kind === 'tunnel' && pr.tunnel < 100) return { success: false, reason: 'The tunnel is not through yet.' };
        const chance = Prison.breakChance(player, world, kind);
        pr.lastBreakDay = _day(world);
        const ok = Utils.random() < chance;
        if (!player.skills) player.skills = {};
        if (kind === 'rush') player.skills.combat = Math.min(10, _skill(player, 'combat') + (ok ? 0.3 : 0.1));
        else player.skills.stealth = Math.min(10, _skill(player, 'stealth') + (ok ? 0.5 : 0.1));
        if (ok) {
            const where = Prison._where(player, world);
            const kingdom = pr.kingdom || where.kingdom;
            const b = Prison.config().breakout;
            Underworld.recordCrime(player, world, 'jailbreak', { kingdom });
            if (kingdom && player.reputation) player.reputation[kingdom] = _num(player.reputation[kingdom]) - _num(b.reputation, 10);
            if (kingdom) {
                Gossip.initializePlayer(player);
                player.gossip.bounties.push({ rumorId: null, kingdom, gold: _num(b.bounty, 60) + _num(jail.daysRemaining) * 5, issuedDay: _day(world), description: 'jailbreak' });
            }
            const how = { rush: 'You knocked the guard down and ran', slip: 'You slipped out at the change of the watch', tunnel: 'You crawled out through your tunnel' }[kind] || 'You got out';
            const rel = Prison.release(player, world, 'escaped');
            return { success: true, escaped: true, text: `${how}! The realm will be looking for you: heat, a gaoler's bounty, −${_num(b.reputation, 10)} reputation.${rel.text ? ` ${rel.text}` : ''}` };
        }
        const [lo, hi] = Prison.config().breakout.failDays;
        const added = Utils.randInt(lo, hi);
        jail.daysRemaining += added;
        jail.totalDays += added;
        jail.escapeChance = Math.max(0.03, _num(jail.escapeChance, 0.1) - 0.02);
        pr.failedBreaks += 1;
        const hurt = Utils.randInt(3, 10);
        player.health = Math.max(10, _num(player.health, 100) - hurt);
        let lost = '';
        if (kind === 'rush' && pr.tools > 0) {
            pr.tools = 0;
            lost = ' They searched the cell and took your tools.';
        }
        if (kind === 'tunnel') {
            pr.tunnel = 0;
            lost = ' They were waiting at the other end; the tunnel is filled in.';
        }
        const text = `Caught! +${added} days added to your sentence, and a beating (−${hurt} health).${lost}`;
        Prison._log(pr, text);
        return { success: true, escaped: false, added, text };
    },

    // ── Release ───────────────────────────────────────

    /**
     * Out of the cell (served, bail, bribe, escape): befriended cellmates
     * follow up — the old soldier joins you, the fence and the smuggler vouch
     * for you with the guild. Returns { text, friends }.
     */
    release(player, world, how = 'served') {
        const jail = player.jailState;
        const pr = jail && jail.prison;
        player.jailState = null;
        // How they got out (the jail map opens the cell door, or sees them over the wall)
        player.lastJailRelease = { how, day: _day(world), settlement: jail ? jail.settlement : null };
        player.stamina = player.maxStamina;
        player.movementRemaining = player.maxStamina;
        if (!pr) return { text: '', friends: [] };
        const out = [];
        for (const m of pr.cellmates.filter(c => c.friend && !c.sold)) {
            if (m.archetype === 'veteran') {
                const npc = Prison._companion(player, world, m);
                if (npc) out.push(`${m.name}, the old soldier, walks out beside you and stays.`);
            } else if (m.archetype === 'fence' || m.archetype === 'smuggler') {
                const st = Underworld.ensure(player);
                st.guild.contactMet = true;
                st.guild.standing = _num(st.guild.standing) + _num(Prison.archetype(m.archetype).standing, 2);
                out.push(`${m.name} gives you a name to ask for: the guild knows of you now.`);
            } else if (m.archetype === 'informant') {
                if (pr.kingdom) Underworld.addHeat(player, pr.kingdom, -5, world);
                out.push(`${m.name} puts in a good word with the watch for you.`);
            }
        }
        return { text: out.join(' '), friends: out, how };
    },

    /** Post bail: the bail on the Ledger, then out (befriended cellmates follow up). */
    postBail(player, world) {
        const jail = player.jailState;
        if (!jail) return { success: false, reason: 'You are not in jail.' };
        const bail = _num(jail.bailCost);
        if (!bail) return { success: false, reason: 'No bail has been set.' };
        if (_num(player.gold) < bail) return { success: false, reason: `You need ${bail} gold (have ${Math.floor(_num(player.gold))}).` };
        player.gold -= bail;
        Ledger.record(player, 'bail', -bail);
        const settlement = jail.settlement;
        const rel = Prison.release(player, world, 'bail');
        return { success: true, bail, text: `You paid ${bail} gold and were released from jail in ${settlement}.${rel.text ? ` ${rel.text}` : ''}` };
    },

    /** The sentence served (from the day's end): release on the prison's own stream. */
    releaseServed(player, world) {
        return Utils.withRng(Prison._rng(world, player), () => Prison.release(player, world, 'served'));
    },

    _companion(player, world, m) {
        const where = Prison._where(player, world);
        const s = where.settlement || { name: 'the road', kingdom: where.kingdom };
        if (!world || typeof world.getKingdom !== 'function') return null;
        const npc = Relationships.generateNPC(s, world);
        const [first, ...rest] = m.name.split(' ');
        npc.firstName = first;
        npc.dynasty = rest.join(' ') || npc.dynasty;
        npc.occupation = 'soldier';
        npc.gender = 'male';
        npc.metDay = _day(world);
        if (!player.relationships) player.relationships = {};
        const rel = Relationships.getRelationship(player, npc.id);
        rel.score = Math.max(_num(rel.score), 30);
        rel.history.push({ day: _day(world), action: 'cellmate', result: 'freed together' });
        Relationships.ensureTravelParty(player);
        if (!player.travelParty.includes(npc.id)) player.travelParty.push(npc.id);
        npc.isTravelingWithPlayer = true;
        return npc;
    },

    // ── The day ───────────────────────────────────────

    _rng(world, player) {
        const j = player.jailState || {};
        return Utils.seededRandom((_hash(_seed(world), 'prison', _day(world), j.settlement, j.totalDays) % 233279) + 1);
    },

    /**
     * A night in the cell (before the sentence ticks down): tools arrive, the
     * informant may sell you out, a search may find the tunnel. Only for a
     * sentence that has a prison sub-state; its own seeded stream.
     * Returns { notices }.
     */
    processDay(player, world) {
        const out = { notices: [] };
        const jail = player && player.jailState;
        const pr = jail && jail.prison;
        if (!pr) return out;
        const day = _day(world);
        const t = Prison.config().tunnel;
        Utils.withRng(Prison._rng(world, player), () => {
            if (pr.toolsDueDay != null && day >= pr.toolsDueDay) {
                pr.tools += 1;
                pr.toolsDueDay = null;
                Prison._log(pr, 'A chisel came in, baked into a loaf.');
                out.notices.push({ icon: '🔧', title: 'Tools Smuggled In', text: 'Your smuggler friend kept his word: a chisel, baked into a loaf.', type: 'success' });
            }
            const digging = pr.tunnel > 0 || pr.tools > 0;
            const snitch = pr.cellmates.find(c => c.archetype === 'informant' && !c.friend && !c.sold);
            let found = null;
            if (digging && snitch && Utils.random() < _num(Prison.archetype('informant').betrayChance, 0.2)) {
                snitch.sold = true;
                found = `${snitch.name} sold you out to the guards`;
            } else if (pr.tunnel > 0 && Utils.random() < _num(t.discovery) + Math.floor(pr.tunnel / 10) * _num(t.discoveryPer10)) {
                found = 'A cell search turned up your tunnel';
            }
            if (found) {
                const added = Utils.randInt(t.addedDays[0], t.addedDays[1]);
                jail.daysRemaining += added;
                jail.totalDays += added;
                pr.tunnel = 0;
                pr.tools = 0;
                const text = `${found}: tools taken, the tunnel filled in, +${added} days.`;
                Prison._log(pr, text);
                out.notices.push({ icon: '🚨', title: 'Found Out', text, type: 'error' });
            }
        });
        return out;
    },

    // ── Servitude ─────────────────────────────────────

    servitudeBribeCost(player) {
        const s = player.indenturedServitude;
        const c = Prison.config().servitude;
        return Math.max(10, Math.round(_num(s && s.freedomCost, 200) * _num(c.bribeShare, 0.4)));
    },

    servitudeBribeChance(player) {
        const c = Prison.config().servitude;
        return _clamp(_num(c.bribeBase, 0.5) + _skill(player, 'diplomacy') * _num(c.bribeDiplomacy, 0.04));
    },

    canTryServitudeEscape(player, world) {
        const s = player && player.indenturedServitude;
        return !!s && s.lastEscapeDay !== _day(world);
    },

    /** Bribe an overseer to let you go. Once a day (shares the escape attempt). */
    bribeOverseer(player, world) {
        const s = player.indenturedServitude;
        if (!s) return { success: false, reason: 'You are not bound.' };
        if (!Prison.canTryServitudeEscape(player, world)) return { success: false, reason: 'You have already tried your luck today.' };
        const cost = Prison.servitudeBribeCost(player);
        if (_num(player.gold) < cost) return { success: false, reason: `The overseer wants ${cost} gold.` };
        s.lastEscapeDay = _day(world);
        player.gold -= cost;
        Ledger.record(player, 'bribes', -cost);
        if (Utils.random() < Prison.servitudeBribeChance(player)) {
            const captor = s.captor;
            player.indenturedServitude = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            Traits.recordDeed(player, 'deceit', 1);
            return { success: true, freed: true, cost, text: `${cost} gold, and the overseer of ${captor} found you "dead of fever". You walk free.` };
        }
        const [lo, hi] = Prison.config().servitude.failDays;
        const added = Utils.randInt(lo, hi);
        s.daysRemaining += added;
        return { success: true, freed: false, cost, text: `The overseer took the ${cost} gold and told your master: +${added} days.` };
    },

    /** Work hard for an early release: the day counts double. The caller ends the day. */
    servitudeWork(player) {
        const s = player.indenturedServitude;
        if (!s) return { success: false, reason: 'You are not bound.' };
        const extra = Math.min(Math.max(0, s.daysRemaining - 1), _num(Prison.config().servitude.workExtraDays, 1));
        s.daysRemaining -= extra;
        player.strength = Math.min(20, _num(player.strength, 5) + 0.1);
        return { success: true, extra, text: `You work like two men${extra ? ' and the overseer takes a day off your bond' : ''}.` };
    },

    // ── The march to a town with a jail ───────────────

    /** The march's settings (data/jail.json → transport). */
    transportConfig() {
        const d = DataLoader._gamedata && DataLoader._gamedata.jail && DataLoader._gamedata.jail.transport;
        return _merge(TRANSPORT_DEFAULTS, d && typeof d === 'object' ? d : {});
    },

    /** Does a settlement of this size keep a jail? */
    hasJail(type) {
        return (Prison.transportConfig().jailTypes || []).includes(type || 'village');
    },

    /** The settlement the sentence was passed in (by name), or null. */
    _sentencedAt(player, world) {
        const jail = player && player.jailState;
        if (!jail || !world) return null;
        const all = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        return all.find(s => s && s.name === jail.settlement) || null;
    },

    /**
     * The nearest settlement with a jail to march a prisoner from `from` to:
     * one of the same crown first, any if none. Null when there is none.
     */
    jailTownFor(world, from) {
        if (!world || !from) return null;
        const all = (typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [])
            .filter(s => s && s.q != null && Prison.hasJail(s.type) && s.name !== from.name);
        if (!all.length) return null;
        const dist = (s) => (world.width ? Hex.wrappingDistance(from.q, from.r, s.q, s.r, world.width) : Hex.distance(from.q, from.r, s.q, s.r));
        const same = all.filter(s => from.kingdom != null && s.kingdom === from.kingdom);
        const pool = same.length ? same : all;
        const best = pool.slice().sort((a, b) => dist(a) - dist(b))[0];
        return { name: best.name, q: best.q, r: best.r, type: best.type, kingdom: best.kingdom != null ? best.kingdom : null, distance: dist(best) };
    },

    /** Sentenced where there is no jail, and not yet marched to one? */
    needsTransport(player, world) {
        const jail = player && player.jailState;
        if (!jail || (jail.transport && jail.transport.done)) return false;
        if (jail.transport) return true;
        const at = Prison._sentencedAt(player, world);
        return !!(at && !Prison.hasJail(at.type) && Prison.jailTownFor(world, at));
    },

    /**
     * Put the prisoner in chains for the march: from where they were
     * sentenced to the nearest town with a jail, a few hexes a day.
     * Returns jailState.transport (the existing one if under way).
     */
    beginTransport(player, world) {
        const jail = player && player.jailState;
        if (!jail) return null;
        if (jail.transport) return jail.transport;
        const at = Prison._sentencedAt(player, world);
        const to = at && Prison.jailTownFor(world, at);
        if (!to) return null;
        const T = Prison.transportConfig();
        const days = Math.max(1, Math.ceil(to.distance / Math.max(1, _num(T.hexesPerDay, 4))));
        const path = Hex.lineDraw(at.q, at.r, to.q, to.r);
        jail.transport = {
            from: { name: at.name, q: at.q, r: at.r, kingdom: at.kingdom != null ? at.kingdom : null },
            to, days, day: 0, path, event: null, log: [], done: false,
        };
        return jail.transport;
    },

    /**
     * A day on the road (from the day's end): the escort marches on — the
     * prisoner's place on the map moves with them — and something may happen:
     * raiders fall on the escort (likelier with raiders about), a guard eyes
     * the prisoner's purse, a wheel breaks, a kindness, a cruelty. Arrived,
     * the sentence passes to the jail there. A choice left unmade is settled
     * the quiet way. On the prison's own seeded stream.
     * @returns {{ text, kind, arrived?:boolean, choice?:boolean } | null}
     */
    transportStep(player, world) {
        const jail = player && player.jailState;
        const tr = jail && jail.transport;
        if (!tr || tr.done) return null;
        // Yesterday's choice, never made: the quiet way
        if (tr.event && tr.event.choice && !tr.event.resolved) Prison.transportChoice(player, world, tr.event.kind === 'raid' ? 'stay' : 'refuse');
        if (!player.jailState || tr.done) return null;
        const T = Prison.transportConfig();
        return Utils.withRng(Prison._rng(world, player), () => {
            const delayed = tr.event && tr.event.kind === 'delay' && !tr.event.spent;
            if (delayed) tr.event.spent = true;
            else tr.day += 1;
            const step = tr.path.length > 1 ? tr.path[Math.min(tr.path.length - 1, Math.round((tr.day / tr.days) * (tr.path.length - 1)))] : tr.to;
            player.q = step.q;
            player.r = step.r;
            if (tr.day >= tr.days) {
                tr.done = true;
                jail.settlement = tr.to.name;
                jail.prison = null;
                const text = _pick(T.lines.arrive, { town: tr.to.name }) || `You are marched into ${tr.to.name} in chains.`;
                tr.event = { kind: 'arrive', text, resolved: true };
                tr.log.push(text);
                return { ...tr.event, arrived: true };
            }
            // Raiders about make an ambush likelier
            const R = T.raid;
            const near = (world.units || []).filter(u => u && !u.destroyed && WorldUnit.isHostile(u)
                && (world.width ? Hex.wrappingDistance(u.q, u.r, step.q, step.r, world.width) : Hex.distance(u.q, u.r, step.q, step.r)) <= _num(R.radius, 3)).length;
            const raidChance = Math.min(_num(R.max, 0.6), _num(R.base, 0.06) + near * _num(R.perHostile, 0.2));
            const E = T.events;
            const roll = Utils.random();
            let kind = 'quiet';
            if (roll < raidChance) kind = 'raid';
            else {
                let acc = raidChance;
                for (const k of ['bribe', 'delay', 'kindness', 'cruelty']) {
                    acc += _num(E[k]);
                    if (roll < acc) { kind = k; break; }
                }
            }
            const vars = { town: tr.to.name, from: tr.from.name, left: tr.days - tr.day };
            const ev = { kind, text: _pick(T.lines[kind], vars) || '', choice: kind === 'raid' || kind === 'bribe', resolved: false, raiders: near };
            if (kind === 'bribe') {
                const [lo, hi] = T.bribeCost;
                ev.cost = Math.round(lo + Utils.random() * (hi - lo));
                ev.text = _fill(ev.text, { cost: ev.cost });
            }
            if (kind === 'kindness') player.health = Math.min(_num(player.maxHealth, 100), _num(player.health, 100) + _num(T.kindnessHealth, 6));
            if (kind === 'cruelty') player.health = Math.max(5, _num(player.health, 100) - _num(T.crueltyHealth, 6));
            if (!ev.choice) ev.resolved = true;
            tr.event = ev;
            tr.log.push(ev.text);
            if (tr.log.length > 8) tr.log.splice(0, tr.log.length - 8);
            return ev;
        });
    },

    /** The odds of each way out of a raid on the road. */
    transportOdds(player) {
        const T = Prison.transportConfig();
        const s = T.slip, f = T.fight;
        const agility = _num(player && (player.agility != null ? player.agility : player.dexterity), 5);
        return {
            slip: _clamp(_num(s.base) + _skill(player, 'stealth') * _num(s.stealth) + agility * _num(s.agility)),
            fight: _clamp(_num(f.base) + _skill(player, 'combat') * _num(f.combat) + _num(player && player.strength, 5) * _num(f.strength)),
        };
    },

    /**
     * Answer the day's event on the road. Raid: 'slip' (away in the fight —
     * an escape, with its heat and bounty), 'fight' (beside the guards: a
     * shorter sentence for it), 'stay' (the guards drive them off — or they
     * scatter the escort and take you, or rob you and leave you on the road).
     * Bribe: 'pay' (loosed in the night — an escape) or 'refuse'.
     * @returns {{ success, text, escaped?, captured?, freed?, reason? }}
     */
    transportChoice(player, world, choice) {
        const jail = player && player.jailState;
        const tr = jail && jail.transport;
        const ev = tr && tr.event;
        if (!ev || !ev.choice || ev.resolved) return { success: false, reason: 'Nothing to decide.' };
        const T = Prison.transportConfig();
        const odds = Prison.transportOdds(player);
        const L = T.lines.outcomes || {};
        const done = (text, extra = {}) => {
            ev.resolved = true;
            ev.outcome = text;
            tr.log.push(text);
            return { success: true, text, ...extra };
        };
        if (ev.kind === 'bribe') {
            if (choice === 'pay') {
                if (_num(player.gold) < ev.cost) return { success: false, reason: `The guard wants ${ev.cost} gold.` };
                player.gold -= ev.cost;
                Ledger.record(player, 'bribes', -ev.cost);
                const rel = Prison._escapedCustody(player, world, tr);
                return done(`${_fill(L.bribePaid || 'Your chains are loose by morning.', { cost: ev.cost })}${rel ? ` ${rel}` : ''}`, { escaped: true });
            }
            return done(L.bribeRefused || 'You keep your coin. The guard spits.');
        }
        // A raid
        if (choice === 'slip') {
            if (Utils.random() < odds.slip) {
                const rel = Prison._escapedCustody(player, world, tr);
                return done(`${L.slipped || 'In the fight you slip your chains and run.'}${rel ? ` ${rel}` : ''}`, { escaped: true });
            }
            const [lo, hi] = Prison.config().breakout.failDays;
            const added = Utils.randInt(lo, hi);
            jail.daysRemaining += added;
            jail.totalDays += added;
            player.health = Math.max(5, _num(player.health, 100) - 8);
            return done(_fill(L.slipCaught || 'They catch you running: +{added} days and a beating.', { added }));
        }
        if (choice === 'fight') {
            if (Utils.random() < odds.fight) {
                const cut = Math.max(1, Math.round(jail.daysRemaining * _num(T.fight.reward, 0.34)));
                jail.daysRemaining = Math.max(1, jail.daysRemaining - cut);
                if (!player.skills) player.skills = {};
                player.skills.combat = Math.min(10, _skill(player, 'combat') + 0.2);
                return done(_fill(L.fought || 'You fight beside the guards; the captain takes {cut} days off your sentence.', { cut }));
            }
            player.health = Math.max(5, _num(player.health, 100) - 12);
            return done(L.foughtHurt || 'You are cut down in the fight; the guards drive the raiders off without you.');
        }
        // Stay down
        const S = T.stay;
        if (Utils.random() < _num(S.guardsWin, 0.65)) return done(L.guardsWin || 'The guards drive the raiders off.');
        if (Utils.random() < _num(S.takenShare, 0.6)) {
            // Taken by the raiders: from the crown's chains into theirs (indentured servitude)
            const days = Utils.randInt(5, 12);
            const took = Math.floor(_num(player.gold) * 0.3);
            player.gold = _num(player.gold) - took;
            player.jailState = null;
            player.lastJailRelease = { how: 'taken', day: _day(world), settlement: tr.to.name };
            player.indenturedServitude = {
                captor: 'the raiders', daysRemaining: days, totalDays: days, dailyWage: 0, goldConfiscated: took,
                canBuyFreedom: true, freedomCost: 150 + days * 10, escapeChance: 0.1 + _skill(player, 'stealth') * 0.03,
            };
            return done(_fill(L.taken || 'The escort scatters; the raiders take you for themselves: {days} days in their chains.', { days }), { captured: true });
        }
        const took = Math.floor(_num(player.gold) * 0.5);
        player.gold = _num(player.gold) - took;
        if (took > 0) Ledger.record(player, 'robbery', -took);
        player.jailState = null;
        player.lastJailRelease = { how: 'abandoned', day: _day(world), settlement: tr.from.name };
        return done(_fill(L.abandoned || 'The escort flees; the raiders take {took} gold and leave you chained on the road. You work the chains loose by dark — free.', { took }), { freed: true });
    },

    /** Away from the escort: a jailbreak in the crown's eyes (heat, a bounty, reputation). Returns what friends do. */
    _escapedCustody(player, world, tr) {
        const kingdom = tr ? (tr.from.kingdom != null ? tr.from.kingdom : tr.to.kingdom) : null;
        const b = Prison.config().breakout;
        Underworld.recordCrime(player, world, 'jailbreak', { kingdom });
        if (kingdom != null && player.reputation) player.reputation[kingdom] = _num(player.reputation[kingdom]) - _num(b.reputation, 10);
        if (kingdom != null) {
            Gossip.initializePlayer(player);
            player.gossip.bounties.push({ rumorId: null, kingdom, gold: _num(b.bounty, 60) + _num(player.jailState && player.jailState.daysRemaining) * 5, issuedDay: _day(world), description: 'escaped custody' });
        }
        const rel = Prison.release(player, world, 'escaped');
        return rel.text || '';
    },
};
