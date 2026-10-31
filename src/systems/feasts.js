// ============================================
// FEASTS — a planned table, real guests, real food, and what happens after
// ============================================
// Hosting a feast is a plan, not a price tier:
//
//   guests        — the rulers of realms within reach (the town's own lord
//                   first; never one at war with you) and the town's notable
//                   people from its living roster (systems/townsfolk.js).
//   menu          — each course needs real goods: drawn from your own stores
//                   first, the rest bought at the town's market at its
//                   current price (the stock leaves the stalls).
//   entertainment — minstrels, jesters, a bard's epic, games of strength.
//
// Every guest who comes judges the evening (the menu, the entertainment, their
// own traits' tastes, their regard for you). Honoured guests think better of
// you, slighted ones worse — the town's own lord left off the list takes it
// badly. Lords remember it (NpcLords.rememberDeed when that memory exists,
// with keys feast_honoured / feast_slighted / feast_uninvited /
// feast_insulted / feast_betrothal) and your reputation in their realm moves
// either way. Incidents may follow: an insult, a betrothal suggested (a real
// match for a grown child through Heirs.marryForAlliance), a drunken brawl
// (the duel engine, or talk it down), a toast, court gossip. The feast is
// talked about (a deed rumour). A cooldown, and a town that tires of them.
//
// State on player.feasts (saved). Rolls come from the feast's own seeded
// stream. Content: data/feasts.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { NPCLords } from '../world/npcLords.js';
import { RealmWars } from './realmWars.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';
import { Townsfolk } from './townsfolk.js';
import { NpcDisposition } from './npcDisposition.js';
import { Gossip } from './gossip.js';
import { Heirs } from './heirs.js';

// What a learned intel key means in a sentence ('military' → 'armies'), joined "a, b and c"
const _INTEL_WORDS = { ruler: 'ruler', military: 'armies', diplomacy: 'alliances and quarrels', economy: 'trade and treasury' };
function _intelPhrase(keys) {
    const w = keys.map(k => _INTEL_WORDS[k] || k);
    return w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}` : w.join('');
}

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r1 = v => Math.round(v * 10) / 10;
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _key = (q, r) => `${q},${r}`;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

export const Feasts = {
    data() {
        const gd = DataLoader._gamedata;
        return (gd && gd.feasts) || {};
    },

    config() {
        return Feasts.data().config || {};
    },

    _blank() {
        return { lastDay: null, towns: {}, history: [], pending: null, stats: { held: 0, honoured: 0, slighted: 0, brawls: 0 }, n: 0 };
    },

    state(player) {
        if (!player) return Feasts._blank();
        let st = player.feasts;
        if (!_obj(st)) {
            player.feasts = Feasts._blank();
            return player.feasts;
        }
        const b = Feasts._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        if (!_obj(st.towns)) st.towns = {};
        if (!Array.isArray(st.history)) st.history = [];
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && player.feasts ? JSON.parse(JSON.stringify(player.feasts)) : null;
    },

    loadState(player) {
        if (player && player.feasts) Feasts.state(player);
    },

    _rng(world, player, tag) {
        const st = Feasts.state(player);
        st.n = (st.n || 0) + 1;
        return Utils.seededRandom((_hash(`${_seed(world)}:feast:${tag}:${_day(world)}:${st.n}`) % 233279) + 1);
    },

    /** Days until another feast may be held (0 = now). */
    cooldownLeft(player, world) {
        const st = Feasts.state(player);
        if (st.lastDay == null) return 0;
        return Math.max(0, _num(Feasts.config().cooldownDays, 7) - (_day(world) - st.lastDay));
    },

    /** How fresh a feast still is in this town (1, or less when it had one lately). */
    townMult(player, world, tile) {
        const C = Feasts.config();
        const last = Feasts.state(player).towns[_key(tile.q, tile.r)];
        if (last == null || _day(world) - last >= _num(C.townRepeatDays, 30)) return 1;
        return _num(C.townRepeatMult, 0.5);
    },

    // ──────────── GUESTS ────────────

    _dist(world, a, b) {
        return world && world.width ? Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width) : Hex.distance(a.q, a.r, b.q, b.r);
    },

    _lordGuests(player, world, tile) {
        const C = Feasts.config();
        const s = tile.settlement;
        const list = [];
        for (const k of (world && world.kingdoms) || []) {
            if (!k || k.isAlive === false || !k.lord) continue;
            const local = k.id === s.kingdom;
            const seat = k.capital || null;
            const d = seat ? Feasts._dist(world, tile, seat) : (local ? 0 : Infinity);
            if (!local && d > _num(C.lordRange, 14)) continue;
            const war = RealmWars.atWarWith(player, k.id);
            const rep = _num(player.reputation && player.reputation[k.id]);
            const regard = Math.round(NPCLords.getLordOpinion(k.lord, player, world) + rep);
            list.push({
                id: `lord:${k.id}`, kind: 'lord', kingdomId: k.id, local, d,
                name: k.lord.name || k.ruler || 'the ruler', title: `${local ? 'Lord of these lands' : 'Ruler of'} ${k.name}`,
                traits: (k.lord.traits || []).map(t => t && t.id).filter(Boolean),
                regard, war, available: !war, reason: war ? 'at war with you' : null,
            });
        }
        list.sort((a, b) => (b.local ? 1 : 0) - (a.local ? 1 : 0) || a.d - b.d);
        return list.slice(0, _num(C.maxLords, 4));
    },

    _folkGuests(world, tile) {
        const C = Feasts.config();
        const folk = tile.settlement && tile.settlement.folk;
        if (!folk || !Array.isArray(folk.people)) return [];
        const roles = C.folkRoles || ['noble', 'merchant', 'priest'];
        const day = _day(world);
        const out = [];
        for (const p of folk.people) {
            if (p.died != null || p.away || !roles.includes(p.role)) continue;
            if (Townsfolk.age(p, day) < Townsfolk.config().comeOfAge) continue;
            out.push({ id: `folk:${p.id}`, kind: 'folk', pid: p.id, name: `${p.first} ${p.last}`, title: Townsfolk.roleTitle(p), traits: p.traits || [], regard: _num(p.mem && p.mem.disposition, 50) - 50, available: true });
        }
        out.sort((a, b) => roles.indexOf(a.title) - roles.indexOf(b.title) || a.pid - b.pid);
        return out.slice(0, _num(C.maxFolk, 5));
    },

    // ──────────── MENU ────────────

    /** Where each course's goods would come from, and the market bill. */
    source(player, world, tile, menuId) {
        const menu = (Feasts.data().menus || {})[menuId];
        if (!menu) return null;
        const s = tile.settlement;
        SettlementMarket.ensure(s);
        const inv = player.inventory || {};
        const usedInv = {};
        const usedMkt = {};
        const courses = [];
        let cost = 0;
        let short = 0;
        let drink = 0;
        const goods = Economy._goods();
        for (const course of menu.courses || []) {
            let need = _num(course.qty);
            const take = [];
            for (const id of course.goods || []) {
                if (need <= 0) break;
                const have = _num(inv[id]) - _num(usedInv[id]);
                const n = Math.min(need, Math.max(0, Math.floor(have)));
                if (n > 0) { usedInv[id] = _num(usedInv[id]) + n; need -= n; take.push({ id, n, from: 'stores' }); }
            }
            // The rest from the market, cheapest ask first
            const offers = [];
            for (const id of course.goods || []) {
                const ask = Economy.marketAsk(world, tile, id);
                if (ask == null) continue;
                const good = goods[id.toUpperCase()];
                const tracked = SettlementMarket.tracks(id);
                const stock = tracked ? Math.floor(SettlementMarket.available(s, id)) - _num(usedMkt[id]) : 999;
                if (stock > 0) offers.push({ id, ask, good, tracked, stock });
            }
            offers.sort((a, b) => a.ask - b.ask);
            for (const o of offers) {
                if (need <= 0) break;
                const n = Math.min(need, o.stock);
                let sum = 0;
                const s0 = o.tracked ? SettlementMarket.stock(s, o.id) - _num(usedMkt[o.id]) : 0;
                for (let i = 0; i < n; i++) {
                    sum += o.tracked && o.good
                        ? Math.floor(Economy.marketAskBase(o.good, s, tile, world) * SettlementMarket.scarcity(s, o.id, s0 - i))
                        : o.ask;
                }
                usedMkt[o.id] = _num(usedMkt[o.id]) + n;
                need -= n;
                cost += sum;
                take.push({ id: o.id, n, from: 'market', cost: sum });
            }
            if (need > 0) short += need;
            if ((course.goods || []).some(g => ['beer', 'wine', 'liquor'].includes(g))) drink += _num(course.qty) - Math.max(0, need);
            courses.push({ label: course.label, qty: _num(course.qty), take, short: Math.max(0, need) });
        }
        return { id: menuId, label: menu.label, icon: menu.icon, quality: _num(menu.quality), courses, cost, short, drink, usedInv, usedMkt };
    },

    /** Everything the planning dialog needs. */
    plan(player, world, tile) {
        const s = tile && tile.settlement;
        if (!s) return null;
        const D = Feasts.data();
        const menus = Object.keys(D.menus || {}).map(id => {
            const src = Feasts.source(player, world, tile, id);
            return { ...src, can: src.short === 0 && _num(player.gold) >= src.cost };
        });
        const entertainment = Object.entries(D.entertainment || {}).map(([id, e]) => ({ id, ...e }));
        return {
            settlement: s, cooldownLeft: Feasts.cooldownLeft(player, world), townMult: Feasts.townMult(player, world, tile),
            guests: [...Feasts._lordGuests(player, world, tile), ...Feasts._folkGuests(world, tile)],
            maxGuests: _num(Feasts.config().maxGuests, 6), menus, entertainment,
        };
    },

    // ──────────── HOSTING ────────────

    _taste(traits, menuId, entId) {
        const T = Feasts.data().traitTaste || {};
        let s = 0;
        for (const t of traits || []) {
            const row = T[t];
            if (!row) continue;
            s += _num(row[menuId]) + _num(row[entId]);
        }
        return s;
    },

    _remember(world, kingdomId, deed, weight, note) {
        const k = world && world.getKingdom ? world.getKingdom(kingdomId) : null;
        if (!k || !k.lord || typeof NPCLords.rememberDeed !== 'function') return false;
        return !!NPCLords.rememberDeed(world, k.lord, deed, { day: _day(world), weight, note });
    },

    _lordOpinion(player, world, kingdomId, deed, delta, note) {
        const remembered = Feasts._remember(world, kingdomId, deed, delta, note);
        // Reputation in the realm moves too (half as much when the lord also remembers it)
        if (!player.reputation) player.reputation = {};
        const rep = _r1(delta * (remembered ? 0.5 : 1));
        player.reputation[kingdomId] = _num(player.reputation[kingdomId]) + rep;
        return rep;
    },

    _folkRegard(player, folk, pid, delta) {
        const p = folk && Townsfolk.get(folk, pid);
        if (!p) return 0;
        const npc = { type: p.role };
        Object.defineProperty(npc, '_dialogMemory', { get: () => p.mem, set: v => { p.mem = v; }, enumerable: true });
        return NpcDisposition.adjustDisposition(npc, delta, player);
    },

    /**
     * Host the feast. opts { guests: [guest ids], menu, entertainment }.
     * Consumes the goods (stores, then market), pays, and judges the evening.
     */
    host(player, world, tile, opts = {}) {
        const s = tile && tile.settlement;
        if (!s) return { success: false, reason: 'A feast needs a hall and a town to fill it.' };
        const C = Feasts.config();
        const D = Feasts.data();
        const cd = Feasts.cooldownLeft(player, world);
        if (cd > 0) return { success: false, reason: `Your cooks and stewards need ${cd} more day${cd === 1 ? '' : 's'} before another feast.` };
        const menu = (D.menus || {})[opts.menu];
        if (!menu) return { success: false, reason: 'Choose a menu.' };
        const ent = (D.entertainment || {})[opts.entertainment || 'none'] || (D.entertainment || {}).none || { cost: 0, bonus: 0 };
        const plan = Feasts.plan(player, world, tile);
        const chosen = (opts.guests || []).map(id => plan.guests.find(g => g.id === id)).filter(g => g && g.available !== false);
        if (chosen.length > plan.maxGuests) return { success: false, reason: `The hall seats ${plan.maxGuests} guests of honour.` };
        const src = Feasts.source(player, world, tile, opts.menu);
        if (src.short > 0) return { success: false, reason: `The town's market cannot supply the ${menu.label.toLowerCase()} (${src.short} portions short).` };
        const bill = src.cost + _num(ent.cost);
        if (_num(player.gold) < bill) return { success: false, reason: `The feast would cost ${bill} gold.` };

        // Lay the table: your stores first, then the stalls
        for (const [id, n] of Object.entries(src.usedInv)) {
            player.inventory[id] = _num(player.inventory[id]) - n;
            if (player.inventory[id] <= 0) delete player.inventory[id];
        }
        for (const [id, n] of Object.entries(src.usedMkt)) if (SettlementMarket.tracks(id)) SettlementMarket.take(s, id, n);
        player.gold -= bill;
        if (bill > 0) Ledger.record(player, 'feast', -bill);

        const st = Feasts.state(player);
        const rng = Feasts._rng(world, player, 'host');
        const townMult = Feasts.townMult(player, world, tile);
        const folk = s.folk;
        const result = { success: true, menu: menu.label, entertainment: ent.label, spent: bill, fromStores: Object.values(src.usedInv).reduce((a, b) => a + b, 0), guests: [], incidents: [], notes: [], renown: 0, karma: 0, happiness: 0, reputation: 0 };

        // Who comes, and what they make of it
        for (const g of chosen) {
            const chance = g.kind === 'lord'
                ? _clamp(0.35 + g.regard / 100 + (g.local ? 0.2 : 0) + _num(menu.quality) / 250, 0.05, 0.95)
                : 0.85;
            const came = rng() < chance;
            const entry = { id: g.id, kind: g.kind, name: g.name, title: g.title, kingdomId: g.kingdomId, pid: g.pid, came, score: 0, verdict: came ? 'content' : 'absent', delta: 0 };
            if (came) {
                const score = _num(menu.quality) + _num(ent.bonus) + Feasts._taste(g.traits, opts.menu, opts.entertainment) + g.regard * 0.15 + (rng() - 0.5) * 24 - (1 - townMult) * 20;
                entry.score = Math.round(score);
                entry.verdict = score >= _num(C.honouredAt, 60) ? 'honoured' : score < _num(C.slightedBelow, 35) ? 'slighted' : 'content';
            }
            result.guests.push(entry);
        }
        // The town's own lord, left off a list with other lords on it
        const localLord = plan.guests.find(g => g.kind === 'lord' && g.local && g.available !== false);
        if (C.uninvitedSlight !== false && localLord && !chosen.includes(localLord) && chosen.some(g => g.kind === 'lord')) {
            result.guests.push({ id: localLord.id, kind: 'lord', name: localLord.name, title: localLord.title, kingdomId: localLord.kingdomId, came: false, verdict: 'uninvited', delta: 0 });
        }

        // Incidents
        const present = result.guests.filter(g => g.came);
        const incidents = Feasts._incidents(player, world, tile, menu, ent, src, present, rng);
        result.incidents = incidents;

        // Settle opinions
        const O = D.opinion || {};
        const FD = D.folkDisposition || {};
        for (const g of result.guests) {
            const deed = { honoured: 'feast_honoured', slighted: 'feast_slighted', uninvited: 'feast_uninvited', insulted: 'feast_insulted' }[g.verdict];
            if (!deed) continue;
            if (g.kind === 'lord') g.delta = Feasts._lordOpinion(player, world, g.kingdomId, deed, _num(O[g.verdict]), s.name);
            else if (g.kind === 'folk') g.delta = Feasts._folkRegard(player, folk, g.pid, _num(FD[g.verdict === 'honoured' ? 'honoured' : 'slighted']));
            if (g.verdict === 'honoured') st.stats.honoured++;
            else st.stats.slighted++;
        }

        // The town and the realm
        const lordsCame = present.filter(g => g.kind === 'lord').length;
        result.renown = Math.round((_num(menu.renown) * (1 + 0.25 * lordsCame) + _num(ent.renown)) * townMult);
        for (const inc of incidents) result.renown += _num(inc.renown);
        player.renown = Math.max(0, _num(player.renown) + result.renown);
        result.karma = _r1(_num(menu.karma) * townMult);
        player.karma = _r1(_num(player.karma) + result.karma);
        result.happiness = _r1(_num(menu.happiness) * townMult);
        s.happiness = _clamp(_num(s.happiness, 50) + result.happiness, 0, 100);
        if (s.kingdom) {
            if (!player.reputation) player.reputation = {};
            result.reputation = _r1(_num(menu.reputation) * townMult);
            player.reputation[s.kingdom] = _num(player.reputation[s.kingdom]) + result.reputation;
        }
        Traits.recordDeeds(player, { popularity: 1 + lordsCame * 0.5, generosity: Math.min(3, bill / 200), drinking: src.drink >= 8 ? 1 : 0 });
        Gossip.spreadDeed(player, world, 'feast_given', { q: tile.q, r: tile.r, location: s.name });
        if (townMult < 1) result.notes.push(`${s.name} feasted with you not long ago; the novelty has worn thin.`);

        st.lastDay = _day(world);
        st.towns[_key(tile.q, tile.r)] = _day(world);
        st.stats.held++;
        st.history.unshift({ d: _day(world), town: s.name, menu: menu.label, guests: present.map(g => g.name), honoured: result.guests.filter(g => g.verdict === 'honoured').length, slighted: result.guests.filter(g => ['slighted', 'uninvited', 'insulted'].includes(g.verdict)).length });
        if (st.history.length > 12) st.history.length = 12;
        return result;
    },

    _incidents(player, world, tile, menu, ent, src, present, rng) {
        const D = Feasts.data();
        const I = D.incidents || {};
        const st = Feasts.state(player);
        st.pending = null;
        const out = [];
        const lords = present.filter(g => g.kind === 'lord');
        const pickGuest = (list) => list[Math.floor(rng() * list.length)];
        const eligible = () => {
            const e = [];
            if (present.length >= 1 && I.insult) e.push(['insult', _num(I.insult.weight) + (ent.insultRisk ? 3 : 0)]);
            if (I.betrothal && lords.some(g => g.verdict === 'honoured') && _num(menu.quality) >= _num(I.betrothal.minQuality)) e.push(['betrothal', _num(I.betrothal.weight)]);
            if (I.brawl && (src.drink >= _num(I.brawl.drinkAt, 8) || ent.brawlRisk)) e.push(['brawl', _num(I.brawl.weight) + (ent.brawlRisk ? 4 : 0)]);
            if (I.toast && present.length && _num(menu.quality) >= _num(I.toast.minQuality)) e.push(['toast', _num(I.toast.weight)]);
            if (I.gossip && lords.length) e.push(['gossip', _num(I.gossip.weight)]);
            return e.filter(x => !out.some(o => o.kind === x[0]) && x[1] > 0);
        };
        let rolls = rng() < _num(D.incidentChance, 0.55) ? 1 : 0;
        if (rolls && rng() < _num(D.secondIncidentChance, 0.25)) rolls = 2;
        for (let i = 0; i < rolls; i++) {
            const e = eligible();
            if (!e.length) break;
            const total = e.reduce((a, x) => a + x[1], 0);
            let x = rng() * total;
            let kind = e[e.length - 1][0];
            for (const [k, w] of e) { x -= w; if (x <= 0) { kind = k; break; } }
            const def = I[kind];
            const inc = { kind, icon: def.icon || '•' };
            if (kind === 'insult') {
                const g = pickGuest(present);
                g.verdict = 'insulted';
                inc.text = def.text.replace('{guest}', g.name);
            } else if (kind === 'betrothal') {
                const g = pickGuest(lords.filter(l => l.verdict === 'honoured'));
                inc.text = def.text.replace('{guest}', g.name);
                Feasts._lordOpinion(player, world, g.kingdomId, 'feast_betrothal', _num((D.opinion || {}).betrothal, 4), tile.settlement.name);
                const kids = Feasts.eligibleChildren(player);
                inc.followUp = kids.length ? 'betrothal' : null;
                if (!kids.length) inc.text += ' You have no grown child to promise — but the offer is remembered kindly.';
                st.pending = { kind: 'betrothal', day: _day(world), kingdomId: g.kingdomId, lord: g.name };
            } else if (kind === 'brawl') {
                const folkGuests = present.filter(g => g.kind === 'folk');
                const who = folkGuests.length ? pickGuest(folkGuests).name : 'a drunken man-at-arms';
                inc.text = def.text.replace('{brawler}', who);
                inc.followUp = 'brawl';
                st.pending = { kind: 'brawl', day: _day(world), brawler: who };
                st.stats.brawls++;
            } else if (kind === 'toast') {
                const g = pickGuest(present);
                inc.text = def.text.replace('{guest}', g.name);
                inc.renown = _num(def.renown, 3);
            } else if (kind === 'gossip') {
                const g = pickGuest(lords);
                inc.text = def.text.replace('{guest}', g.name);
                if (typeof player.learnAboutKingdom === 'function') {
                    const learned = player.learnAboutKingdom(g.kingdomId, ['diplomacy', 'military', 'ruler']);
                    if (learned && learned.length) inc.text += ` (You learn of ${(world.getKingdom && world.getKingdom(g.kingdomId) || {}).name || 'their realm'}'s ${_intelPhrase(learned)}.)`;
                }
            }
            out.push(inc);
        }
        return out;
    },

    // ──────────── FOLLOW-UPS ────────────

    /** Grown, unwed children at home who could be promised. [{ id, name }] */
    eligibleChildren(player) {
        const out = [];
        for (const c of (player && player.children) || []) {
            if (!c || c.isAlive === false) continue;
            const got = Heirs._available(player, c.id);
            if (got.error || (got.up && got.up.spouse)) continue;
            out.push({ id: c.id, name: c.firstName || 'your child' });
        }
        return out;
    },

    /** Accept the betrothal suggested at today's feast for a grown child. */
    acceptBetrothal(player, world, childId) {
        const st = Feasts.state(player);
        const p = st.pending;
        if (!p || p.kind !== 'betrothal' || p.day !== _day(world)) return { success: false, reason: 'The moment has passed; the guests have gone home.' };
        // The guest offered the match: no reputation bar (as a match proposed by letter — systems/courtLetters.js)
        const r = Heirs.marryForAlliance(player, world, childId, p.kingdomId, { minReputation: -100, deed: 'match_accepted' });
        if (r.success) st.pending = null;
        return r;
    },

    /** The brawler as a duel combatant (fists, a little drunk). */
    brawlerProfile(player, world) {
        const st = Feasts.state(player);
        const p = st.pending;
        const name = (p && p.brawler) || 'a drunk';
        const h = _hash(`${_seed(world)}:${name}:${_day(world)}`);
        return { id: 'feast_brawler', name, icon: '🍺', kind: 'npc', attack: 2 + (h % 3), defense: 1 + ((h >> 3) % 2), power: 5 + ((h >> 5) % 3), hp: 20 + ((h >> 7) % 8), stamina: 8, weapon: 'fists and a tankard', temperament: 'aggressive', skill: 2 };
    },

    /**
     * Settle the brawl: 'won' / 'lost' (the duel engine's verdict) or 'calm'
     * (talk him down: a charisma roll on the feast's stream).
     */
    settleBrawl(player, world, outcome) {
        const st = Feasts.state(player);
        const p = st.pending;
        if (!p || p.kind !== 'brawl' || p.day !== _day(world)) return { success: false, reason: 'The hall has quieted.' };
        const B = Feasts.data().brawl || {};
        st.pending = null;
        let renown = 0;
        let text;
        if (outcome === 'calm') {
            const rng = Feasts._rng(world, player, 'calm');
            const ok = rng() < _num(B.calmBase, 0.25) + _num(B.calmCharisma, 0.07) * _num(player.charisma, 5);
            if (ok) {
                renown = _num(B.calmRenown, 1);
                text = `You laugh it off, pour ${p.brawler} another cup and seat him by the fire. The hall cheers your grace.`;
            } else {
                renown = _num(B.loseRenown, -2);
                text = `${p.brawler} will not be calmed; he swings, misses, and is dragged out by the servants. The evening sours.`;
            }
        } else if (outcome === 'won') {
            renown = _num(B.winRenown, 3);
            text = `You put ${p.brawler} on the rushes with the hall roaring. They will tell this one for weeks.`;
            Traits.recordDeed(player, 'valor', 0.5);
        } else {
            renown = _num(B.loseRenown, -2);
            text = `${p.brawler} gets the better of you before your own guests. Your dignity is bruised more than your jaw.`;
        }
        player.renown = Math.max(0, _num(player.renown) + renown);
        Gossip.spreadDeed(player, world, 'feast_brawl', { q: player.q, r: player.r });
        return { success: true, renown, text };
    },
};
