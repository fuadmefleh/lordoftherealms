// ============================================
// VICTORY — the optional goal of a game
// ============================================
// Chosen at New Game (or later, from Dynasty → Ambition of this Life), kept
// on player.scenario.victory (core/difficulty.js keeps the record). Each goal
// is read straight off the state the rest of the game keeps:
//   crown           — Throne.ruledKingdom (a throne won, or a realm founded)
//   merchant_prince — EconomyChronicle.netWorth total
//   dynasty         — the House's generation, or its years since founding
//   monopoly        — monopolies the player holds: their company's
//                     (holder 'player'), their crown's edicts in the realm
//                     they rule, and those of a guild they head
//   conqueror       — Holdings.list (settlements held in the player's name)
//   empire          — the settlements of the realm the player rules (Throne)
//   faith           — settlements devoted to the player's faith (Religion
//                     presence ≥ the devoted share: player.religion.presence)
//   kingpin         — towns where the player is boss of a gang (Gangs.bossTowns)
// check() runs from the day's end (ui/game/endDay.js): the cheap goals every
// day, net worth and monopolies once a week. The first time a goal is met
// it is recorded (player.scenario.victoryAchieved) and reported once; play
// goes on. Tuned in data/scenarios.json → victory. No RNG.

import { DataLoader } from '../core/dataLoader.js';
import { Difficulty } from '../core/difficulty.js';
import { Economy } from '../world/economy.js';
import { Throne } from './throne.js';
import { House } from './house.js';
import { EconomyChronicle } from './economyChronicle.js';
import { Holdings } from './holdings.js';
import { Guilds } from './guilds.js';
import { Relationships } from './relationships.js';
import { Religion } from './religion.js';
import { Gangs } from './gangs.js';

const DEFAULTS = {
    none: { name: 'Sandbox', icon: '🌍', blurb: 'No goal: live as you please.' },
    crown: { name: 'Wear a Crown', icon: '👑', blurb: 'Rule a kingdom.' },
    merchant_prince: { name: 'Merchant Prince', icon: '💰', blurb: 'Reach a net worth of {target} gold.', target: 150000 },
    dynasty: { name: 'Dynasty', icon: '🛡️', blurb: 'Keep your House alive for {generations} generations or {years} years.', generations: 4, years: 100 },
    monopoly: { name: 'Monopolist', icon: '⚖️', blurb: 'Hold {target} trade monopolies at once.', target: 3 },
    conqueror: { name: 'Conqueror', icon: '🏰', blurb: 'Hold {target} settlements in your own hands.', target: 8 },
    empire: { name: 'Empire', icon: '🗺️', blurb: 'Rule a realm of {target} settlements.', target: 10 },
    faith: { name: 'Faith Ascendant', icon: '🕯️', blurb: 'Make {target} settlements devoted to your faith.', target: 10 },
    kingpin: { name: 'Kingpin', icon: '🗝️', blurb: 'Be boss of the underworld in {target} towns at once.', target: 4 },
};

/** Goals whose reading is heavy (net worth, every town's monopolies): checked weekly. */
const WEEKLY = new Set(['merchant_prince', 'monopoly']);

const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => _num(world && world.day);
const _fmt = n => Math.round(n).toLocaleString('en-US');

export const Victory = {
    /** { id: { id, name, icon, blurb, ...targets } } — data over the code defaults, blurbs filled in. */
    defs() {
        const src = _obj(DataLoader._gamedata && DataLoader._gamedata.scenarios);
        const data = (src && _obj(src.victory)) || {};
        const out = {};
        for (const id of Object.keys(DEFAULTS)) {
            const d = { ...DEFAULTS[id], ...(_obj(data[id]) || {}), id };
            d.blurb = String(d.blurb || '').replace(/\{(\w+)\}/g, (m, k) => (d[k] != null ? (typeof d[k] === 'number' ? _fmt(d[k]) : d[k]) : m));
            out[id] = d;
        }
        return out;
    },

    def(id) {
        return Victory.defs()[id] || null;
    },

    /** The goal the player is playing for ('none' for a sandbox game). */
    goal(player) {
        const id = player && _obj(player.scenario) ? player.scenario.victory : 'none';
        return Victory.def(id) ? id : 'none';
    },

    /** Pick (or change) the goal mid-game. A change starts the goal afresh. */
    setGoal(player, id) {
        if (!player || !Victory.def(id)) return { success: false, reason: 'No such goal.' };
        const sc = Difficulty.state(player);
        if (sc.victory === id) return { success: true };
        // A goal already won stays on the record (the Ambition panel lists past victories)
        if (_obj(sc.victoryAchieved)) {
            if (!Array.isArray(sc.pastVictories)) sc.pastVictories = [];
            if (!sc.pastVictories.some(v => v && v.id === sc.victoryAchieved.id && Victory.wonThisLife(sc, v))) sc.pastVictories.push(sc.victoryAchieved);
        }
        sc.victory = id;
        // Switching back to a goal this life already won keeps its record (no second victory scene)
        sc.victoryAchieved = (Array.isArray(sc.pastVictories) ? sc.pastVictories.find(v => v && v.id === id && Victory.wonThisLife(sc, v)) : null) || null;
        return { success: true };
    },

    /** Was this recorded victory won in the current life (on or after its start), not a past one? */
    wonThisLife(sc, v) {
        return !!(v && _obj(sc) && _num(v.day, -1) >= _num(sc.startDay, 0));
    },

    /** Monopolies the player holds now: [{ town, good, by }]. */
    monopolies(player, world) {
        const out = [];
        if (!player || !world || typeof world.getSettlementViews !== 'function') return out;
        const day = _day(world);
        const ruled = Throne.ruledKingdom(player, world);
        for (const v of world.getSettlementViews()) {
            const t = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = t && t.settlement;
            if (!s || !_obj(s.monopolies)) continue;
            for (const good of Object.keys(s.monopolies)) {
                const holder = Economy.monopolyHolder(s, good, day);
                const m = s.monopolies[good];
                let by = null;
                if (holder === 'player') by = 'company';
                else if (holder === 'crown' && ruled && m && m.kingdomId === ruled.id) by = 'crown';
                else if (holder === 'guild') {
                    const g = Guilds.guardOf(s, good);
                    if (g && Object.keys(s.guilds || {}).some(gid => s.guilds[gid] === g && Guilds.rankOf(player, s, gid) >= 3)) by = 'guild';
                }
                if (by) out.push({ town: s.name, good, by });
            }
        }
        return out;
    },

    /** Settlements devoted to the player's faith now: [{ q, r, name }]. */
    devotedTowns(player, world) {
        const out = [];
        const rel = player && player.religion;
        if (!rel || !_obj(rel.presence) || !world || typeof world.getTile !== 'function') return out;
        for (const key of Object.keys(rel.presence)) {
            const [q, r] = key.split(',').map(Number);
            if (!Religion.isDevoted(rel, q, r)) continue;
            const t = world.getTile(q, r);
            if (t && t.settlement && _num(t.settlement.population) > 0) out.push({ q, r, name: t.settlement.name });
        }
        return out;
    },

    /**
     * How far along the goal is: { id, name, icon, blurb, pct (0..1), done,
     * text, lines[] }. Reads only; draws no RNG.
     */
    progress(player, world, id = null) {
        const goalId = id || Victory.goal(player);
        const def = Victory.def(goalId) || Victory.def('none');
        const out = { id: def.id, name: def.name, icon: def.icon, blurb: def.blurb, pct: 0, done: false, text: '', lines: [] };
        if (!player || def.id === 'none') {
            out.text = 'No goal: play as you please. Choose one at any time.';
            return out;
        }
        if (def.id === 'crown') {
            const k = Throne.ruledKingdom(player, world);
            if (k) {
                out.done = true;
                out.pct = 1;
                out.text = `You rule ${k.name}.`;
                return out;
            }
            const claims = world ? Throne.claims(player, world) : [];
            const best = claims[0] || null;
            const st = player.throne || {};
            const press = Throne.config().pressMinStrength;
            out.pct = Math.min(0.9, best ? best.strength / 100 : 0);
            if (st.civilWar) {
                out.pct = Math.max(out.pct, 0.5 + Math.max(-0.4, Math.min(0.4, _num(st.civilWar.momentum) / 250)));
                out.text = `Civil war for ${st.civilWar.kingdomName}: momentum ${Math.round(_num(st.civilWar.momentum))}.`;
            } else if (best) {
                out.text = `Best claim: ${best.kingdom.name}, strength ${best.strength} (${best.strength >= press ? 'strong enough to press' : `${press} needed to press`}).`;
            } else {
                out.text = 'No claim on any throne yet: marry into a royal line, hold a royal office, forge or buy one, or found a realm from towns you hold.';
            }
            for (const c of claims.slice(1, 4)) out.lines.push(`Claim on ${c.kingdom.name}: ${c.strength}`);
            // The realm the life began in (player.scenario.realm, set by an Origin: player/scenarios.js)
            const realmId = _obj(player.scenario) ? player.scenario.realm : null;
            const home = realmId != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(realmId) : null;
            if (home && home.isAlive !== false) {
                const hc = claims.find(c => c.kingdom && c.kingdom.id === home.id);
                out.lines.unshift(hc ? `Home realm: ${home.name} (your claim ${hc.strength})` : `Home realm: ${home.name}, on which you hold no claim yet`);
            }
            return out;
        }
        if (def.id === 'merchant_prince') {
            const worth = EconomyChronicle.netWorth(player, world).total;
            const target = Math.max(1, _num(def.target, 150000));
            out.pct = Math.max(0, Math.min(1, worth / target));
            out.done = worth >= target;
            out.text = `Net worth ${_fmt(worth)} of ${_fmt(target)} gold.`;
            return out;
        }
        if (def.id === 'dynasty') {
            const house = player.house;
            const gens = Math.max(2, _num(def.generations, 4));
            const years = Math.max(1, _num(def.years, 100));
            if (!house) { out.text = 'You have no House.'; return out; }
            const Y = Relationships._getHeirSettings().daysPerYear || 120;
            const gen = _num(house.generation, 1);
            const age = Math.floor((_day(world) - _num(house.foundedDay)) / Y);
            out.pct = Math.max(0, Math.min(1, Math.max((gen - 1) / (gens - 1), age / years)));
            out.done = gen >= gens || age >= years;
            out.text = `${house.name}: generation ${gen} of ${gens}, ${age} of ${years} years.`;
            return out;
        }
        if (def.id === 'monopoly') {
            const held = Victory.monopolies(player, world);
            const target = Math.max(1, _num(def.target, 3));
            out.pct = Math.min(1, held.length / target);
            out.done = held.length >= target;
            out.text = `${held.length} of ${target} monopolies held.`;
            for (const m of held.slice(0, 6)) out.lines.push(`${m.good.replace(/_/g, ' ')} in ${m.town} (${m.by})`);
            return out;
        }
        if (def.id === 'empire') {
            const k = Throne.ruledKingdom(player, world);
            const target = Math.max(1, _num(def.target, 10));
            if (!k) {
                out.text = 'You rule no realm: win or found one, then grow it.';
                return out;
            }
            const n = Throne._settlementsOf(world, k).length;
            out.pct = Math.min(1, n / target);
            out.done = n >= target;
            out.text = `${k.name}: ${n} of ${target} settlements.`;
            return out;
        }
        if (def.id === 'faith') {
            const held = Victory.devotedTowns(player, world);
            const target = Math.max(1, _num(def.target, 10));
            out.pct = Math.min(1, held.length / target);
            out.done = held.length >= target;
            out.text = player.religion ? `${held.length} of ${target} settlements devoted to ${player.religion.name}.` : 'You keep no faith of your own: found one, or lead one.';
            for (const h of held.slice(0, 6)) out.lines.push(h.name);
            return out;
        }
        if (def.id === 'kingpin') {
            const held = world ? Gangs.bossTowns(player, world) : [];
            const target = Math.max(1, _num(def.target, 4));
            out.pct = Math.min(1, held.length / target);
            out.done = held.length >= target;
            out.text = `Boss in ${held.length} of ${target} towns.`;
            for (const h of held.slice(0, 6)) out.lines.push(`${h.gang.name} of ${h.town}`);
            return out;
        }
        if (def.id === 'conqueror') {
            const held = Holdings.list(player, world);
            const target = Math.max(1, _num(def.target, 8));
            out.pct = Math.min(1, held.length / target);
            out.done = held.length >= target;
            out.text = `${held.length} of ${target} settlements held.`;
            for (const h of held.slice(0, 6)) out.lines.push(h.settlement && h.settlement.name ? h.settlement.name : `${h.q},${h.r}`);
            return out;
        }
        return out;
    },

    /** Has the player already won the goal of this life? */
    achieved(player) {
        return !!(player && _obj(player.scenario) && player.scenario.victoryAchieved);
    },

    /**
     * The day's check. Returns { id, name, icon, day, text } the first day the
     * goal is met (and records it), else null. `force` skips the weekly cadence.
     */
    check(player, world, { force = false } = {}) {
        if (!player || !world || !_obj(player.scenario) || player.interregnum) return null;
        const id = Victory.goal(player);
        if (id === 'none' || player.scenario.victoryAchieved) return null;
        if (!force && WEEKLY.has(id) && _day(world) % 7 !== 0) return null;
        const p = Victory.progress(player, world, id);
        if (!p.done) return null;
        const won = { id, name: p.name, icon: p.icon, day: _day(world), text: p.text, by: player.name };
        player.scenario.victoryAchieved = won;
        if (player.house) House._chronicle(player.house, world, `${p.icon} ${player.name} achieves the ambition of a lifetime: ${p.name}. ${p.text}`, ['victory']);
        return won;
    },
};
