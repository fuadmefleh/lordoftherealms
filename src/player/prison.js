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
};
