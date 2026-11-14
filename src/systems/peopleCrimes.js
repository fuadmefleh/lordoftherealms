// ============================================
// PEOPLE CRIMES — deplorable acts against people, and what they cost for generations
// ============================================
// Five acts, each with a real victim on a town's roster (systems/townsfolk.js),
// real goods and coin, a real chance of being found out, and a memory that
// outlives the one who did it (systems/npcMemory.js episodes → prices, work,
// testimony, greetings, the town's opinion, and the folk grudges that raise a
// NEMESIS, systems/nemesis.js):
//
//   FRAME     plant goods in a townsperson's house (a container there: the seen
//             roll is the containers theft odds), then tip off the watch
//             (a guard, in talk). The trial a few days on: conviction by the
//             goods (truly stolen and reported: 'hot'), their worth, a thief's
//             brand already on them, their standing, and your name as a liar
//             (frames of yours already exposed); the sentence by the realm's
//             punishment law — hanged, or flogged and driven out. The goods are
//             seized and sold in the town's market (the town's purse pays the
//             crown); the informer's reward comes out of the crown's treasury.
//             The kin hold the accusation against you; every year after, the
//             truth may come out (worse for a known liar).
//   BONDAGE   sell someone bound (on the street, or out of your cellar) to the
//             galley masters at a coastal town: the coin out of the town's
//             purse. The dock may have seen. They may come home years later and
//             name you (a nemesis is born), or die at the oar unknown.
//   CAPTIVE   lock someone bound in the cellar of a property of yours in that
//             town. Fed (a few coins a day from your purse into the town's), or
//             starved — they die in the dark. Each day the cellar may be found
//             (more kin in town, sooner; the stink of a starving cellar sooner
//             still). Or let them go — and they tell.
//   STOCKS /  a tenant in arrears (systems/lots.js) put in the stocks: their kin
//   EVICTION  pay what they can toward the debt out of their own purses; in
//             winter the stocks can kill. A tenant put out in winter: the old and
//             the young of the household may freeze. Lawful — but the town
//             remembers a hard landlord.
//   BRAND /   mark a caught thief yourself instead of handing them to the watch.
//   MAIM      The town's culture (world/cultures.js) decides whether that is the
//             fathers' justice or an assault; a harsh punishment law softens it.
//             The brand stays on them (person.pcMark): it convicts them sooner
//             at a trial, and cheapens them to a slaver.
//
// Found out (expose): reputation in the realm, Prestige, heat with the crown,
// karma, deeds of character (systems/traits.js), the Annals (house.history,
// tagged betrayal), the town's memory, the kin's memory, a nemesis.
//
// State on player.peopleCrimes (saved). Explicit params; no globals. The
// player's own acts draw on Utils' stream; the day runs on its own seeded
// stream (world seed + day). Data: data/peopleCrimes.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Seasons } from '../world/seasons.js';
import { Cultures } from '../world/cultures.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Townsfolk } from './townsfolk.js';
import { NpcMemory } from './npcMemory.js';
import { Nemesis } from './nemesis.js';
import { House } from './house.js';
import { Underworld } from './underworld.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';
import { Laws } from './laws.js';
import { Lots } from './lots.js';
import { Infrastructure } from './infrastructure.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
const _span = (v, d, rnd) => {
    const [a, b] = Array.isArray(v) && v.length === 2 ? v : d;
    return a + rnd() * (b - a);
};

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

let _cfg = null;
let _cfgSrc;

export const PeopleCrimes = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.peopleCrimes : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                daysPerYear: _num(d.daysPerYear, 120),
                frame: _obj(d.frame) || {}, bondage: _obj(d.bondage) || {}, captive: _obj(d.captive) || {},
                stocks: _obj(d.stocks) || {}, evict: _obj(d.evict) || {}, thief: _obj(d.thief) || {},
                expose: _obj(d.expose) || {}, nemesis: _obj(d.nemesis) || {}, lines: _obj(d.lines) || {},
            };
        }
        return _cfg;
    },

    line(key, vars = {}) {
        return _fill(PeopleCrimes.config().lines[key] || '', vars);
    },

    // ──────────── STATE ────────────

    state(player) {
        let st = player.peopleCrimes;
        if (!_obj(st)) st = player.peopleCrimes = {};
        if (!Array.isArray(st.frames)) st.frames = [];
        if (!Array.isArray(st.captives)) st.captives = [];
        if (!Array.isArray(st.sold)) st.sold = [];
        if (!Array.isArray(st.stocks)) st.stocks = [];
        if (!Array.isArray(st.cold)) st.cold = [];
        if (!_obj(st.stats)) st.stats = {};
        if (!Number.isFinite(st.nextId)) st.nextId = 1;
        if (!Number.isFinite(st.liar)) st.liar = 0;
        return st;
    },

    serialize(player) {
        return player && player.peopleCrimes ? JSON.parse(JSON.stringify(player.peopleCrimes)) : null;
    },

    _count(st, k) { st.stats[k] = _num(st.stats[k]) + 1; },

    // ──────────── WHERE AND WHO ────────────

    settlementAt(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        return (t && t.settlement) || null;
    },

    personAt(world, q, r, pid) {
        const s = PeopleCrimes.settlementAt(world, q, r);
        const folk = s && s.folk;
        const p = folk && pid != null ? Townsfolk.get(folk, pid) : null;
        return { s, folk, p };
    },

    /** A tenant's townsperson (lots record names, not ids): by full name, else a lone first name. */
    personByName(world, q, r, name) {
        const s = PeopleCrimes.settlementAt(world, q, r);
        const folk = s && s.folk;
        if (!folk || !Array.isArray(folk.people) || !name) return { s, folk, p: null };
        const living = folk.people.filter(p => p && p.died == null && !p.away);
        let p = living.find(o => Townsfolk.name(o) === name || `${o.first} ${o.last || ''}`.trim() === name);
        if (!p) { const same = living.filter(o => o.first === name); if (same.length === 1) p = same[0]; }
        return { s, folk, p: p || null };
    },

    _age(p, day) { return Math.floor(Townsfolk.age(p, day)); },

    /** The family of a person (living, here): spouse, parents, children, siblings. */
    kinOf(folk, p) {
        if (!folk || !p) return [];
        const ids = new Set([p.spouse, ...(p.parents || []), ...(p.kids || [])].filter(x => x != null));
        const out = [];
        for (const id of ids) { const k = Townsfolk.get(folk, id); if (k && k.died == null && !k.away) out.push(k); }
        for (const k of Townsfolk.siblings(folk, p) || []) if (k && k.died == null && !k.away && !out.includes(k)) out.push(k);
        return out;
    },

    /** The one who will carry the feud: the eldest grown kin here, else the person themself. */
    _avenger(folk, p, day) {
        const Y = PeopleCrimes.config().daysPerYear;
        const grown = PeopleCrimes.kinOf(folk, p).filter(k => (day - _num(k.born, day)) / Y >= 14).sort((a, b) => _num(a.born) - _num(b.born));
        return grown[0] || null;
    },

    _nemesis(player, world, folk, holder, score, deed) {
        if (!player || !holder || !folk || !(score > 0)) return null;
        const day = _day(world);
        const Y = PeopleCrimes.config().daysPerYear;
        return Nemesis.wrong(player, world, {
            kind: 'blood', ref: { folkRef: `${folk.q},${folk.r}#${holder.id}` }, name: Townsfolk.name(holder), line: holder.last || null,
            score, age: Math.max(14, Math.floor((day - _num(holder.born, day)) / Y)), gender: holder.gender === 'female' ? 'female' : 'male', deed,
        });
    },

    _town(s) { return (s && s.name) || 'the town'; },

    _annal(folk, world, text) {
        if (folk && text) Townsfolk.record(folk, world, _day(world), { k: 'townMemory', x: text.replace(/\.$/, '') + ' {when}.' });
    },

    // ──────────── BEING FOUND OUT ────────────

    /**
     * What a deed costs when it is known: reputation in the realm, Prestige, heat
     * with the crown, karma, deeds of character, the Annals. → the applied amounts.
     */
    expose(player, world, kind, ctx = {}) {
        const E = (PeopleCrimes.config().expose || {})[kind] || {};
        const scale = _num(ctx.scale, 1);
        const out = { rep: 0, prestige: 0, heat: 0 };
        if (!player) return out;
        const kid = ctx.kingdom != null ? ctx.kingdom : null;
        const rep = Math.round(_num(E.rep) * scale) + Math.round(_num(ctx.rep));
        if (rep && kid != null && _obj(player.reputation)) {
            player.reputation[kid] = _num(player.reputation[kid]) + rep;
            out.rep = rep;
        }
        const house = player.house;
        const pr = Math.round(_num(E.prestige) * scale);
        if (house && pr > 0) {
            const take = Math.min(_num(house.prestige), pr);
            if (take > 0 && House.spend(house, take, `infamy: ${kind}`, _day(world))) out.prestige = take;
        }
        const heat = _num(E.heat) * scale + _num(ctx.heat);
        if (heat > 0 && kid != null && !ctx.aboveLaw) out.heat = Underworld.addHeat(player, kid, heat, world);
        if (E.karma) player.karma = Math.max(-100, Math.min(100, _num(player.karma) + Math.round(_num(E.karma) * scale)));
        if (_obj(E.deeds)) {
            const deeds = {};
            for (const [k, v] of Object.entries(E.deeds)) deeds[k] = _num(v) * scale;
            Traits.recordDeeds(player, deeds);
        }
        if (ctx.chronicle && house) House._chronicle(house, world, ctx.chronicle, ctx.secret ? ['scheme'] : ['betrayal']);
        return out;
    },

    _aboveLaw(player, kingdomId) {
        const ruling = player && player.throne && player.throne.ruling;
        return !!(ruling && kingdomId != null && String(ruling.kingdomId) === String(kingdomId));
    },

    // ════════════════════════════════════════════
    // 1. FRAME AN INNOCENT
    // ════════════════════════════════════════════

    /** The goods you could hide in a house: [{ id, qty, hot, value }], hot and dear first. */
    plantable(player, day) {
        const F = PeopleCrimes.config().frame;
        const out = [];
        for (const [id, n] of Object.entries((player && player.inventory) || {})) {
            if (!(_num(n) >= 1)) continue;
            const unit = _num(PlayerInventory.goodValue(id));
            if (!(unit > 0)) continue;
            const hot = Underworld.hotQty(player, id, day);
            out.push({ id, qty: Math.floor(n), hot: hot > 0, value: unit });
        }
        return out.filter(g => g.value * Math.max(1, g.qty) >= _num(F.minValue, 8))
            .sort((a, b) => (b.hot - a.hot) || (b.value - a.value));
    },

    /** How many to plant: enough to be worth a trial, no more than carried. */
    plantQty(g) {
        const F = PeopleCrimes.config().frame;
        return Math.max(1, Math.min(g.qty, Math.ceil(_num(F.minValue, 8) * 3 / Math.max(1, g.value))));
    },

    /**
     * Hide goods in a townsperson's house. o = { q, r, pid, goodId, qty, box, larder (the
     * container's store: systems/containers.js larder(), the goods go into it), lk (its key),
     * seenChance (the containers theft odds) }. → { ok, seen, text, frame }
     */
    plant(player, world, o = {}, rnd = Utils.random) {
        const day = _day(world);
        const { s, folk, p } = PeopleCrimes.personAt(world, o.q, o.r, o.pid);
        if (!player || !s || !p || p.died != null) return { ok: false, text: 'There is no one living here to put it on.' };
        const n = Math.max(1, Math.min(Math.floor(_num(o.qty, 1)), Math.floor(_num(player.inventory && player.inventory[o.goodId]))));
        if (!(_num(player.inventory && player.inventory[o.goodId]) >= 1)) return { ok: false, text: 'You have nothing of that to hide.' };
        const st = PeopleCrimes.state(player);
        const name = Townsfolk.name(p);
        const good = (PlayerInventory.describe && PlayerInventory.describe({ [o.goodId]: n })) || o.goodId;
        const hot = Underworld.hotQty(player, o.goodId, day) >= 1;
        if (rnd() < _num(o.seenChance, 0.2)) {
            // Seen at it: you keep the goods, the household knows what you tried
            NpcMemory.remember(world, { folk, person: p }, { kind: 'false_accused', player, weight: _num(PeopleCrimes.config().frame.seenWeight, -10), kin: true });
            PeopleCrimes.expose(player, world, 'frameSeen', { kingdom: s.kingdom, aboveLaw: PeopleCrimes._aboveLaw(player, s.kingdom) });
            PeopleCrimes._count(st, 'frameSeen');
            return { ok: false, seen: true, text: PeopleCrimes.line('plantSeen', { owner: p.first, box: o.box || 'chest' }) };
        }
        player.inventory[o.goodId] -= n;
        if (player.inventory[o.goodId] <= 0) delete player.inventory[o.goodId];
        if (hot) Underworld._consumeHot(player, o.goodId, n);
        if (o.larder && _obj(o.larder.stock)) o.larder.stock[o.goodId] = _num(o.larder.stock[o.goodId]) + n;
        const f = {
            id: st.nextId++, q: o.q, r: o.r, pid: p.id, name, town: s.name || null, kingdom: s.kingdom != null ? s.kingdom : null,
            good: o.goodId, goodText: good, qty: n, value: Math.round(_num(PlayerInventory.goodValue(o.goodId)) * n), hot,
            lk: o.lk || null, day, status: 'planted', tipped: null, trialDay: null,
        };
        st.frames.push(f);
        PeopleCrimes._count(st, 'planted');
        return { ok: true, text: PeopleCrimes.line('planted', { good, box: o.box || 'chest' }), frame: f };
    },

    /** Goods you have hidden in this town that the watch has not yet been told of. */
    pendingFrames(player, q, r, day = null) {
        if (!player || !player.peopleCrimes) return [];
        const F = PeopleCrimes.config().frame;
        return PeopleCrimes.state(player).frames.filter(f => f.status === 'planted' && f.q === q && f.r === r
            && (day == null || day - f.day <= _num(F.tipDays, 6)));
    },

    /** The conviction odds, and why. → { chance, parts:[{ label, delta }] } */
    convictOdds(player, world, f) {
        const F = PeopleCrimes.config().frame;
        const { p } = PeopleCrimes.personAt(world, f.q, f.r, f.pid);
        const parts = [{ label: 'The goods in their house', delta: _num(F.base, 0.45) }];
        if (f.hot) parts.push({ label: 'Truly stolen, and reported', delta: _num(F.hot) });
        const v = Math.min(_num(F.valueCap, 0.2), _num(f.value) * _num(F.perValue));
        if (v) parts.push({ label: `Worth ${f.value}g`, delta: v });
        if (p && p.pcMark === 'branded') parts.push({ label: 'A thief\'s brand on their face', delta: _num(F.branded) });
        const status = p ? _num((F.status || {})[p.role]) : 0;
        if (status) parts.push({ label: `A ${p.role}'s word against yours`, delta: -status });
        const liar = _num(PeopleCrimes.state(player).liar);
        if (liar) parts.push({ label: `Known to have sworn falsely (${liar})`, delta: -liar * _num(F.liar) });
        const chance = Math.max(_num(F.min, 0.08), Math.min(_num(F.max, 0.92), parts.reduce((a, x) => a + x.delta, 0)));
        return { chance, parts };
    },

    /** Tell the watch (a guard of the town, in talk). → { ok, text } */
    tipOff(player, world, frameId, rnd = Utils.random) {
        const st = PeopleCrimes.state(player);
        const f = st.frames.find(x => x.id === frameId);
        if (!f || f.status !== 'planted') return { ok: false, text: 'There is nothing to tell them.' };
        const day = _day(world);
        f.tipped = day;
        f.status = 'tipped';
        f.trialDay = day + Math.round(_span(PeopleCrimes.config().frame.trialDays, [2, 4], rnd));
        return { ok: true, text: PeopleCrimes.line('tipped', { name: f.name }) };
    },

    _seize(world, s, f) {
        // The goods out of the house, sold in the town's market; the town's purse pays the crown
        const lard = f.lk && s.larders ? s.larders[f.lk] : null;
        if (lard && _obj(lard.stock)) lard.stock[f.good] = Math.max(0, _num(lard.stock[f.good]) - f.qty);
        if (SettlementMarket.tracks(f.good)) SettlementMarket.add(s, f.good, f.qty);
        const k = s.kingdom != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(s.kingdom) : null;
        if (k && s.economy && Number.isFinite(s.economy.gold)) {
            const pay = Math.min(Math.max(0, s.economy.gold), Math.round(f.value * 0.5));
            s.economy.gold -= pay;
            k.treasury = _num(k.treasury) + pay;
        }
        return k;
    },

    /** The trial: hanged, exiled, or the court will not have it. */
    _trial(player, world, f, out, rnd = Utils.random) {
        const F = PeopleCrimes.config().frame;
        const N = PeopleCrimes.config().nemesis;
        const st = PeopleCrimes.state(player);
        const day = _day(world);
        const { s, folk, p } = PeopleCrimes.personAt(world, f.q, f.r, f.pid);
        if (!s || !p || p.died != null || p.away) { f.status = 'fizzled'; return; }
        const town = PeopleCrimes._town(s);
        const vars = { name: f.name, town, good: f.goodText || f.good };
        const k = PeopleCrimes._seize(world, s, f);
        const { chance } = PeopleCrimes.convictOdds(player, world, f);
        if (rnd() >= chance) {
            f.status = 'acquitted';
            const fine = Math.min(_num(player.gold), _num(F.acquitFine, 30));
            if (fine > 0) {
                player.gold -= fine;
                Ledger.record(player, 'fines', -fine);
                if (k) k.treasury = _num(k.treasury) + fine;
            }
            NpcMemory.remember(world, { folk, person: p }, { kind: 'false_accused', player, kin: true });
            PeopleCrimes.expose(player, world, 'frameSeen', { kingdom: s.kingdom, scale: 0.5, aboveLaw: PeopleCrimes._aboveLaw(player, s.kingdom) });
            out.notices.push({ icon: '⚖️', title: 'Acquitted', text: PeopleCrimes.line('acquitted', { ...vars, fine }), type: 'warning' });
            return;
        }
        const law = Laws.value(world, s.kingdom, 'punishment') || 'standard';
        const hang = f.value >= _num((F.hangValue || {})[law], 120);
        f.status = hang ? 'hanged' : 'exiled';
        f.verdictDay = day;
        f.exposeRolls = 0;
        // The informer's reward, out of the crown's chests
        const reward = k ? Math.min(Math.max(0, _num(k.treasury)), Math.round(f.value * _num(F.rewardShare, 0.25))) : 0;
        if (reward > 0) {
            k.treasury -= reward;
            player.gold = _num(player.gold) + reward;
            Ledger.record(player, 'bounties', reward);
            f.reward = reward;
        }
        // The kin hold the accusation against you (they never believed it)
        const kin = PeopleCrimes._avenger(folk, p, day);
        NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'false_accused', player, weight: hang ? -28 : -18 });
        if (hang) Townsfolk.slay(folk, p, day, 'hanged for a theft');
        else {
            Townsfolk.exile(folk, p, day, 'exile, flogged for a theft');
            NpcMemory.remember(world, { folk, person: p }, { kind: 'false_accused', player, weight: -24 });
        }
        PeopleCrimes._annal(folk, world, PeopleCrimes.line(hang ? 'hanged' : 'exiled', vars));
        if (kin) PeopleCrimes._nemesis(player, world, folk, kin, Math.round(_num(hang ? N.hanged : N.exiled, 40) * 0.6), { key: 'framed', label: `the theft you swore against ${f.name}`, note: town });
        PeopleCrimes._count(st, hang ? 'hanged' : 'exiled');
        if (player.house) House._chronicle(player.house, world, `On ${player.name || 'your'} word, ${f.name} of ${town} was ${hang ? 'hanged' : 'flogged and exiled'} for a theft they did not do.`, ['scheme']);
        out.notices.push({ icon: hang ? '💀' : '⚖️', title: hang ? 'Hanged' : 'Flogged and Exiled', text: PeopleCrimes.line(hang ? 'hanged' : 'exiled', vars) + (reward ? ` The crown pays you ${reward}g for the information.` : ''), type: 'warning' });
    },

    /** The truth comes out (a yearly roll, from the verdict on). */
    _exposeFrame(player, world, f, out) {
        const N = PeopleCrimes.config().nemesis;
        const st = PeopleCrimes.state(player);
        f.exposed = _day(world);
        st.liar = _num(st.liar) + 1;
        const s = PeopleCrimes.settlementAt(world, f.q, f.r);
        const folk = s && s.folk;
        const p = folk ? Townsfolk.get(folk, f.pid) : null;
        const town = f.town || PeopleCrimes._town(s);
        const hanged = f.status === 'hanged';
        const text = PeopleCrimes.line(hanged ? 'exposedFrame' : 'exposedFrameExiled', { name: f.name, town });
        PeopleCrimes.expose(player, world, 'frame', { kingdom: f.kingdom, chronicle: text, scale: hanged ? 1 : 0.7, aboveLaw: PeopleCrimes._aboveLaw(player, f.kingdom) });
        if (folk) {
            NpcMemory.rememberTown(world, folk, { kind: 'framed', player, victim: f.name });
            if (p) {
                NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'framed', player });
                const kin = PeopleCrimes._avenger(folk, p, _day(world));
                if (kin) PeopleCrimes._nemesis(player, world, folk, kin, _num(hanged ? N.hanged : N.exiled, 40), { key: 'framed', label: `the goods you planted on ${f.name}`, note: town });
            }
            PeopleCrimes._annal(folk, world, text);
        }
        PeopleCrimes._count(st, 'framesExposed');
        out.notices.push({ icon: '📜', title: 'Your Lie Is Out', text, type: 'error' });
    },

    // ════════════════════════════════════════════
    // 2. BONDAGE — sold to the galleys
    // ════════════════════════════════════════════

    /** A coastal town or city: the galley masters put in here. */
    isHarbour(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (!t || !t.settlement) return false;
        if (t.settlement.port || t.settlement.isPort || t.settlement.coastal) return true;
        return Infrastructure.isCoastal(t, world);
    },

    /** What the galley master pays for this person (never more than the town's purse holds). */
    bondagePrice(world, q, r, p) {
        const P = PeopleCrimes.config().bondage.price || {};
        const s = PeopleCrimes.settlementAt(world, q, r);
        if (!p) return 0;
        const age = PeopleCrimes._age(p, _day(world));
        let v = _num(P.base, 90);
        if (age < 14) v = _num(P.child, 40);
        else if (age >= 55) v = _num(P.old, 30);
        if (['laborer', 'miner', 'woodcutter', 'fisher', 'blacksmith'].includes(p.role)) v += _num(P.laborer);
        if (p.role === 'farmer') v += _num(P.farmer);
        if (p.role === 'noble') v += _num(P.noble);
        if (p.pcMark === 'maimed') v += _num(P.maimed);
        if (p.pcMark === 'branded') v += _num(P.branded);
        v = Math.max(5, Math.round(v));
        const purse = s && s.economy && Number.isFinite(s.economy.gold) ? Math.max(0, Math.floor(s.economy.gold)) : v;
        return Math.min(v, purse);
    },

    /**
     * Sell someone to the galley masters. o = { q, r (the harbour), pid, home: { q, r } (where they
     * belong, default the harbour), witnesses (count), night, captiveId }. → { ok, text, price, seen }
     */
    sellToGalleys(player, world, o = {}, rnd = Utils.random) {
        const B = PeopleCrimes.config().bondage;
        const st = PeopleCrimes.state(player);
        if (!PeopleCrimes.isHarbour(world, o.q, o.r)) return { ok: false, text: 'No galley master puts in here: only at a harbour.' };
        const home = o.home || { q: o.q, r: o.r };
        const { s: hs, folk, p } = PeopleCrimes.personAt(world, home.q, home.r, o.pid);
        if (!p || p.died != null) return { ok: false, text: 'There is no one to sell.' };
        const s = PeopleCrimes.settlementAt(world, o.q, o.r);
        const day = _day(world);
        const price = PeopleCrimes.bondagePrice(world, o.q, o.r, p);
        if (s.economy && Number.isFinite(s.economy.gold)) s.economy.gold -= price;
        player.gold = _num(player.gold) + price;
        Ledger.record(player, 'theft', price);
        if (o.captiveId != null) st.captives = st.captives.filter(c => c.id !== o.captiveId);
        const name = Townsfolk.name(p);
        const town = PeopleCrimes._town(hs);
        p.away = { d: day, to: 'no one knows where' };
        Townsfolk.note(p, day, 'left', null, 'no one knows where');
        const Y = PeopleCrimes.config().daysPerYear;
        const comes = rnd() < _num(B.returnChance, 0.3);
        const rec = {
            id: st.nextId++, q: home.q, r: home.r, pid: p.id, name, first: p.first, last: p.last || null, gender: p.gender, born: p.born,
            town, kingdom: hs ? hs.kingdom : null, harbour: (s && s.name) || null, day, price,
            returnDay: comes ? day + Math.round(_span(B.returnYears, [3, 10], rnd) * Y) : null,
            dieDay: comes ? null : day + Math.round(_span(B.dieYears, [2, 12], rnd) * Y),
        };
        const seenP = Math.min(0.95, _num(B.seenChance, 0.25) * (o.night ? _num(B.nightShare, 0.5) : 1) * (1 + 0.25 * Math.max(0, _num(o.witnesses))));
        const seen = rnd() < seenP;
        if (seen) PeopleCrimes._exposeBondage(player, world, rec, { notices: [] }, false);
        st.sold.push(rec);
        PeopleCrimes._count(st, 'sold');
        if (player.house) House._chronicle(player.house, world, `${name} of ${town} was sold to the galley masters at ${rec.harbour || 'the harbour'} for ${price}g.`, ['scheme']);
        return { ok: true, seen, price, text: PeopleCrimes.line('sold', { name, price }) + (seen ? ` ${PeopleCrimes.line('soldSeen', { name, town })}` : '') };
    },

    _exposeBondage(player, world, rec, out, returned) {
        if (rec.exposed) return;
        rec.exposed = _day(world);
        const N = PeopleCrimes.config().nemesis;
        const s = PeopleCrimes.settlementAt(world, rec.q, rec.r);
        const folk = s && s.folk;
        const p = folk ? Townsfolk.get(folk, rec.pid) : null;
        const text = returned
            ? PeopleCrimes.line('returned', { name: rec.name, town: rec.town, years: Math.max(1, Math.round((_day(world) - rec.day) / PeopleCrimes.config().daysPerYear)) })
            : `${rec.name} of ${rec.town} was sold to the slavers at ${rec.harbour || 'the harbour'}, and it was you who sold them.`;
        PeopleCrimes.expose(player, world, 'bondage', { kingdom: rec.kingdom, chronicle: text, aboveLaw: PeopleCrimes._aboveLaw(player, rec.kingdom) });
        if (folk) {
            NpcMemory.rememberTown(world, folk, { kind: 'sold_bondage', player, victim: rec.name });
            if (p) {
                if (returned) NpcMemory.remember(world, { folk, person: p }, { kind: 'sold_bondage', player, kin: true });
                else NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'sold_bondage', player });
                const holder = returned ? p : PeopleCrimes._avenger(folk, p, _day(world));
                if (holder) PeopleCrimes._nemesis(player, world, folk, holder, _num(N.bondage, 85), { key: 'sold_bondage', label: returned ? 'the years at the oar you sold them to' : `the selling of ${rec.name} to the galleys`, note: rec.town });
            }
            PeopleCrimes._annal(folk, world, text);
        }
        out.notices.push({ icon: '⛓️', title: returned ? 'Home from the Galleys' : 'Seen at the Docks', text, type: 'error' });
    },

    // ════════════════════════════════════════════
    // 3. CAPTIVES — your cellar
    // ════════════════════════════════════════════

    /**
     * Lock someone bound in the cellar of your property in town. o = { q, r, pid, place,
     * witnesses, night }. → { ok, text, seen, captive }
     */
    lockAway(player, world, o = {}, rnd = Utils.random) {
        const C = PeopleCrimes.config().captive;
        const st = PeopleCrimes.state(player);
        const { s, folk, p } = PeopleCrimes.personAt(world, o.q, o.r, o.pid);
        if (!s || !p || p.died != null) return { ok: false, text: 'There is no one to lock away.' };
        const day = _day(world);
        const name = Townsfolk.name(p);
        p.away = { d: day, to: 'no one knows where' };
        const c = {
            id: st.nextId++, q: o.q, r: o.r, pid: p.id, name, town: s.name || null, kingdom: s.kingdom != null ? s.kingdom : null,
            place: o.place || 'house', day, fed: true, hunger: 0, starveAt: Math.round(_span(C.starveDays, [14, 22], rnd)),
        };
        st.captives.push(c);
        PeopleCrimes._count(st, 'captives');
        const seenP = Math.min(_num(C.seenMax, 0.9), Math.max(0, _num(o.witnesses)) * _num(C.seenPerWitness, 0.15) * (o.night ? 0.5 : 1));
        const seen = rnd() < seenP;
        let text = PeopleCrimes.line('locked', { name, place: c.place, town: c.town });
        if (seen) {
            text += ` ${PeopleCrimes.line('lockedSeen', { name, place: c.place })}`;
            PeopleCrimes._discover(player, world, c, { notices: [] }, folk, p);
        }
        return { ok: true, seen, text, captive: seen ? null : c };
    },

    captives(player) {
        return player && player.peopleCrimes ? PeopleCrimes.state(player).captives : [];
    },

    /** Feed them (a few coins a day bought in the town) or let them starve. */
    setFed(player, id, fed) {
        const c = PeopleCrimes.captives(player).find(x => x.id === id);
        if (!c) return { ok: false, text: 'No such captive.' };
        c.fed = !!fed;
        return { ok: true, text: fed ? `${c.name} will be fed.` : `No more bread goes down to ${c.name}.` };
    },

    /** Let them go: home they run, and they tell. */
    release(player, world, id) {
        const st = PeopleCrimes.state(player);
        const c = st.captives.find(x => x.id === id);
        if (!c) return { ok: false, text: 'No such captive.' };
        st.captives = st.captives.filter(x => x !== c);
        const { folk, p } = PeopleCrimes.personAt(world, c.q, c.r, c.pid);
        if (p && p.died == null) {
            p.away = null;
            PeopleCrimes._telling(player, world, c, folk, p, 0.6);
        }
        return { ok: true, text: PeopleCrimes.line('released', { name: c.name, town: c.town }) };
    },

    /** A captive's story told (released, or found alive). */
    _telling(player, world, c, folk, p, scale = 1) {
        const N = PeopleCrimes.config().nemesis;
        const lawful = c.kingdom != null && Laws.privatePrisons(world, c.kingdom);
        const text = `${c.name} of ${c.town || 'the town'} was kept chained in your cellar.`;
        PeopleCrimes.expose(player, world, 'captive', { kingdom: c.kingdom, scale: scale * (lawful ? 0.5 : 1), chronicle: text, aboveLaw: PeopleCrimes._aboveLaw(player, c.kingdom) });
        NpcMemory.remember(world, { folk, person: p }, { kind: 'held_captive', player, kin: true });
        NpcMemory.rememberTown(world, folk, { kind: 'held_captive', player, victim: c.name });
        PeopleCrimes._nemesis(player, world, folk, p, _num(N.captive, 45), { key: 'held_captive', label: 'the cellar you kept them in', note: c.town });
        PeopleCrimes._annal(folk, world, text);
    },

    _discover(player, world, c, out, folk = null, p = null) {
        const st = PeopleCrimes.state(player);
        st.captives = st.captives.filter(x => x !== c);
        if (!folk || !p) ({ folk, p } = PeopleCrimes.personAt(world, c.q, c.r, c.pid));
        if (!folk || !p) return;
        const N = PeopleCrimes.config().nemesis;
        if (p.died != null) {
            const text = PeopleCrimes.line('discoveredDead', { name: c.name, town: c.town });
            PeopleCrimes.expose(player, world, 'starved', { kingdom: c.kingdom, chronicle: text, aboveLaw: PeopleCrimes._aboveLaw(player, c.kingdom) });
            NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'starved', player });
            NpcMemory.rememberTown(world, folk, { kind: 'starved', player, victim: c.name });
            const kin = PeopleCrimes._avenger(folk, p, _day(world));
            if (kin) PeopleCrimes._nemesis(player, world, folk, kin, _num(N.starved, 75), { key: 'starved', label: `the starving of ${c.name} in your cellar`, note: c.town });
            PeopleCrimes._annal(folk, world, text);
            PeopleCrimes._count(st, 'starvedFound');
            out.notices.push({ icon: '💀', title: 'Your Cellar Found', text, type: 'error' });
            return;
        }
        p.away = null;
        PeopleCrimes._telling(player, world, c, folk, p, 1);
        PeopleCrimes._count(st, 'captivesFound');
        out.notices.push({ icon: '⛓️', title: 'Your Captive Found', text: PeopleCrimes.line('discovered', { name: c.name, town: c.town }), type: 'error' });
    },

    _captiveDay(player, world, c, out) {
        const C = PeopleCrimes.config().captive;
        const { s, folk, p } = PeopleCrimes.personAt(world, c.q, c.r, c.pid);
        const st = PeopleCrimes.state(player);
        if (!s || !p) { st.captives = st.captives.filter(x => x !== c); return; }
        if (p.died != null && !c.dead) {
            // Died of something else in the dark (the roster's own sickness or age)
            c.dead = _day(world);
        }
        if (!c.dead) {
            const cost = _num(C.feedCost, 2);
            if (c.fed && _num(player.gold) >= cost) {
                player.gold -= cost;
                Ledger.record(player, 'propertyUpkeep', -cost);
                if (s.economy && Number.isFinite(s.economy.gold)) s.economy.gold += cost;
                c.hunger = Math.max(0, _num(c.hunger) - 1);
            } else {
                c.hunger = _num(c.hunger) + 1;
                if (c.hunger >= _num(c.starveAt, 18)) {
                    Townsfolk.slay(folk, p, _day(world), 'starved in a cellar');
                    c.dead = _day(world);
                    PeopleCrimes._count(st, 'starved');
                    if (player.house) House._chronicle(player.house, world, `${c.name} of ${c.town || 'the town'} starved to death in a cellar of yours.`, ['scheme']);
                    out.notices.push({ icon: '💀', title: 'Starved', text: PeopleCrimes.line('starvedDied', { name: c.name, town: c.town }), type: 'warning' });
                }
            }
        }
        const kin = PeopleCrimes.kinOf(folk, p).length;
        let d = _num(C.discoveryDaily, 0.004) + kin * _num(C.discoveryPerKin, 0.0015);
        if (c.dead || c.hunger > 3) d *= _num(C.starvingMult, 2.5);
        if (c.kingdom != null && Laws.privatePrisons(world, c.kingdom) && !c.dead) d *= 0.5;
        if (Utils.random() < d) PeopleCrimes._discover(player, world, c, out, folk, p);
    },

    // ════════════════════════════════════════════
    // 4. THE STOCKS AND THE SNOW — a hard landlord
    // ════════════════════════════════════════════

    isWinter(day) {
        return String(Seasons.seasonOf(Math.max(1, _num(day, 1)))).toLowerCase() === 'winter';
    },

    _tenant(player, world, q, r, ref) {
        const lr = Lots._letRecord(world, (player.lotHoldings || []).find(h => h.q === q && h.r === r && (h.kind === 'lot' ? h.id : h.key) === ref));
        return lr && lr.rec.tenant ? lr : null;
    },

    /** A tenant in the stocks for their arrears: the family pays what it can. → { ok, text } */
    stockDebtor(player, world, q, r, ref, rnd = Utils.random) {
        const S = PeopleCrimes.config().stocks;
        const lr = PeopleCrimes._tenant(player, world, q, r, ref);
        if (!lr) return { ok: false, text: 'No one rents that house from you.' };
        const t = lr.rec.tenant;
        if (!(_num(t.owed) > 0)) return { ok: false, text: `${t.name} owes you nothing.` };
        const st = PeopleCrimes.state(player);
        if (st.stocks.some(x => x.q === q && x.r === r && x.ref === ref)) return { ok: false, text: `${t.name} is in the stocks already.` };
        const day = _day(world);
        const { s, folk, p } = PeopleCrimes.personByName(world, q, r, t.name);
        // The family scrape together what they can, out of their own purses
        let paid = 0;
        if (folk && p) {
            for (const k of [p, ...PeopleCrimes.kinOf(folk, p)]) {
                if (paid >= t.owed) break;
                const have = Math.floor(Townsfolk.purse(folk, k, world) * _num(S.familyPays, 0.6));
                const give = Math.min(have, t.owed - paid);
                if (give > 0) { k.purse -= give; paid += give; }
            }
        }
        if (paid > 0) {
            t.owed -= paid;
            if (t.owed <= 0) { t.owed = 0; t.missed = 0; }
            player.gold = _num(player.gold) + paid;
            Ledger.record(player, 'townRentIncome', paid);
        }
        const winter = PeopleCrimes.isWinter(day);
        st.stocks.push({ q, r, ref, name: t.name, pid: p ? p.id : null, town: (s && s.name) || null, until: day + _num(S.stocksDays, 3), winter });
        if (p) {
            NpcMemory.remember(world, { folk, person: p }, { kind: 'stocked', player, kin: true });
            const hurt = Math.max(1, Math.round(10 * _num(S.hurt, 0.35)));
            Townsfolk.injure(p, day, 10 - hurt, 10);
        }
        if (folk) NpcMemory.rememberTown(world, folk, { kind: 'stocked', player, victim: t.name });
        PeopleCrimes.expose(player, world, 'stocks', { kingdom: s ? s.kingdom : null });
        PeopleCrimes._count(st, 'stocked');
        const text = PeopleCrimes.line('stocked', { name: t.name, town: PeopleCrimes._town(s), owed: t.owed + paid, paid });
        PeopleCrimes._annal(folk, world, `${t.name} was put in the stocks for the rent`);
        return { ok: true, text };
    },

    _stocksDay(player, world, x, out) {
        const S = PeopleCrimes.config().stocks;
        const N = PeopleCrimes.config().nemesis;
        const st = PeopleCrimes.state(player);
        const day = _day(world);
        const { folk, p } = x.pid != null ? PeopleCrimes.personAt(world, x.q, x.r, x.pid) : { folk: null, p: null };
        if (p && p.died == null && PeopleCrimes.isWinter(day) && Utils.random() < _num(S.stocksWinterDeath, 0.06)) {
            Townsfolk.slay(folk, p, day, 'the cold, in the stocks');
            NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'stocks_died', player });
            NpcMemory.rememberTown(world, folk, { kind: 'stocks_died', player, victim: x.name });
            const kin = PeopleCrimes._avenger(folk, p, day);
            if (kin) PeopleCrimes._nemesis(player, world, folk, kin, _num(N.stocksDied, 50), { key: 'stocks_died', label: `${x.name}'s death in your stocks`, note: x.town });
            PeopleCrimes.expose(player, world, 'evict', { kingdom: (PeopleCrimes.settlementAt(world, x.q, x.r) || {}).kingdom, chronicle: PeopleCrimes.line('stocksDied', { name: x.name, town: x.town }) });
            st.stocks = st.stocks.filter(o => o !== x);
            out.notices.push({ icon: '🥶', title: 'Dead in the Stocks', text: PeopleCrimes.line('stocksDied', { name: x.name, town: x.town }), type: 'error' });
            return;
        }
        if (day >= x.until) {
            st.stocks = st.stocks.filter(o => o !== x);
            out.notices.push({ icon: '🔒', title: 'Out of the Stocks', text: PeopleCrimes.line('stocksFreed', { name: x.name, town: x.town }), type: 'info' });
        }
    },

    /** Put a tenant out in winter (Lots.evictTenant), and the household into the snow. → { ok, text } */
    evictInWinter(player, world, q, r, ref, rnd = Utils.random) {
        const E = PeopleCrimes.config().evict;
        const lr = PeopleCrimes._tenant(player, world, q, r, ref);
        if (!lr) return { ok: false, text: 'No one rents that house from you.' };
        const name = lr.rec.tenant.name;
        const res = Lots.evictTenant(player, world, q, r, ref);
        if (!res.success) return { ok: false, text: res.reason };
        const day = _day(world);
        if (!PeopleCrimes.isWinter(day)) return { ok: true, text: res.text };
        const st = PeopleCrimes.state(player);
        const { s, folk, p } = PeopleCrimes.personByName(world, q, r, name);
        const town = PeopleCrimes._town(s);
        if (folk) NpcMemory.rememberTown(world, folk, { kind: 'evicted_winter', player, victim: name });
        if (p) {
            NpcMemory.remember(world, { folk, person: p }, { kind: 'evicted_winter', player, kin: true });
            // The household out in the snow: the old and the young may not see the spring
            const hh = [p, ...PeopleCrimes.kinOf(folk, p).filter(k => k.id === p.spouse || (p.kids || []).includes(k.id))];
            for (const k of hh) {
                const age = PeopleCrimes._age(k, day);
                const risk = age >= _num(E.oldAge, 60) ? _num((E.froze || {}).old) : age <= _num(E.youngAge, 8) ? _num((E.froze || {}).young) : _num((E.froze || {}).adult);
                if (rnd() < risk) st.cold.push({ q, r, pid: k.id, name: Townsfolk.name(k), tenant: name, town, due: day + Math.round(_span(E.frozeDays, [3, 12], rnd)) });
            }
        }
        PeopleCrimes.expose(player, world, 'evict', { kingdom: s ? s.kingdom : null, rep: _num(E.rep, -3) });
        PeopleCrimes._count(st, 'evictedWinter');
        PeopleCrimes._annal(folk, world, `${name}'s household was turned out into the snow`);
        return { ok: true, text: PeopleCrimes.line('evictedWinter', { name, town }) };
    },

    _coldDay(player, world, x, out) {
        const N = PeopleCrimes.config().nemesis;
        const st = PeopleCrimes.state(player);
        const day = _day(world);
        if (day < x.due) return;
        st.cold = st.cold.filter(o => o !== x);
        const { s, folk, p } = PeopleCrimes.personAt(world, x.q, x.r, x.pid);
        if (!p || p.died != null) return;
        Townsfolk.slay(folk, p, day, 'the cold, turned out in winter');
        NpcMemory.rememberKin(world, { folk, person: p }, { kind: 'froze_evicted', player });
        NpcMemory.rememberTown(world, folk, { kind: 'froze_evicted', player, victim: x.name });
        const kin = PeopleCrimes._avenger(folk, p, day);
        if (kin) PeopleCrimes._nemesis(player, world, folk, kin, _num(N.froze, 55), { key: 'froze_evicted', label: `the winter you turned ${x.name} out into`, note: x.town });
        const text = PeopleCrimes.line('froze', { name: x.name, town: x.town });
        PeopleCrimes.expose(player, world, 'evict', { kingdom: s ? s.kingdom : null, chronicle: text });
        PeopleCrimes._annal(folk, world, text);
        PeopleCrimes._count(st, 'froze');
        out.notices.push({ icon: '🥶', title: 'Frozen', text, type: 'error' });
    },

    // ════════════════════════════════════════════
    // 5. BRAND OR MAIM A THIEF — your own justice
    // ════════════════════════════════════════════

    /** How the town takes a thief marked by the one who caught them. → { stance, label, culture } */
    stanceAt(world, s) {
        const T = PeopleCrimes.config().thief;
        const culture = s ? Cultures.cultureOf(world, s) : null;
        let stance = (T.stances || {})[culture] || 'tolerate';
        // A harsh law: the crown looks kindly on a hard hand
        if (s && s.kingdom != null && Laws.value(world, s.kingdom, 'punishment') === 'harsh') stance = stance === 'condemn' ? 'tolerate' : 'approve';
        return { stance, culture, label: (T.stanceLabels || {})[stance] || '' };
    },

    /** Brand or maim a caught thief. o = { q, r, pid, name, how: 'brand'|'maim' }. → { ok, text, stance } */
    punishThief(player, world, o = {}) {
        const T = PeopleCrimes.config().thief;
        const N = PeopleCrimes.config().nemesis;
        const how = o.how === 'maim' ? 'maim' : 'brand';
        const s = PeopleCrimes.settlementAt(world, o.q, o.r);
        const { stance } = PeopleCrimes.stanceAt(world, s);
        const R = ((T[how] || {})[stance]) || {};
        const st = PeopleCrimes.state(player);
        const folk = s && s.folk;
        const p = folk && o.pid != null ? Townsfolk.get(folk, o.pid) : null;
        const name = p ? Townsfolk.name(p) : (o.name || 'the thief');
        const day = _day(world);
        if (p) {
            p.pcMark = how === 'maim' ? 'maimed' : (p.pcMark === 'maimed' ? 'maimed' : 'branded');
            p.pcMarkDay = day;
            NpcMemory.remember(world, { folk, person: p }, { kind: how === 'maim' ? 'maimed' : 'branded', player, kin: true });
            if (how === 'maim') Townsfolk.injure(p, day, 3, 10);
            if (how === 'maim' || stance === 'condemn') {
                const kin = stance === 'approve' ? null : p;
                if (kin) PeopleCrimes._nemesis(player, world, folk, kin, Math.round(_num(N.maim, 40) * (how === 'maim' ? 1 : 0.5)), { key: how === 'maim' ? 'maimed' : 'branded', label: how === 'maim' ? 'the hand you took' : 'the brand you burned on them', note: s ? s.name : null });
            }
        }
        if (folk && R.town) NpcMemory.rememberTown(world, folk, { kind: R.town, player, victim: name });
        PeopleCrimes.expose(player, world, how, { kingdom: s ? s.kingdom : null, rep: _num(R.rep), heat: _num(R.heat), aboveLaw: PeopleCrimes._aboveLaw(player, s && s.kingdom) });
        PeopleCrimes._count(st, how === 'maim' ? 'maimed' : 'branded');
        PeopleCrimes._annal(folk, world, `${name} was ${how === 'maim' ? 'maimed' : 'branded'} for a thief by ${player.name || 'a stranger'}`);
        if (how === 'maim' && player.house) House._chronicle(player.house, world, `${player.name || 'You'} took the hand of ${name}, a thief, in the street of ${s ? s.name : 'a town'}.`, stance === 'approve' ? ['chronicle'] : ['betrayal']);
        return { ok: true, stance, text: `${PeopleCrimes.line(how, { name })} ${PeopleCrimes.line('thiefTaken', { name })}` };
    },

    /** The mark a person carries from your hand ('branded' | 'maimed' | null) and how it looks. */
    markOf(p) {
        if (!p || !p.pcMark) return null;
        const text = { maimed: 'The stump of a wrist, bound in a dirty rag.', galley: 'A slaver\'s brand on the shoulder, and hands like horn from the oar.' }[p.pcMark]
            || 'A thief\'s brand, puckered and red, on the cheek.';
        return { mark: p.pcMark, text };
    },

    // ════════════════════════════════════════════
    // THE DAY
    // ════════════════════════════════════════════

    _rng(world) {
        const seed = (world && world.generationParams && world.generationParams.seed) || 0;
        return Utils.seededRandom((_hash(`${seed}:peopleCrimes:${_day(world)}`) % 233279) + 1);
    },

    /** Trials, captives, the stocks, the cold, the sold, old lies. → { notices } */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player || !player.peopleCrimes || player.interregnum) return out;
        const st = PeopleCrimes.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        const F = PeopleCrimes.config().frame;
        const Y = PeopleCrimes.config().daysPerYear;
        Utils.withRng(PeopleCrimes._rng(world), () => {
            for (const f of st.frames.slice()) {
                if (f.status === 'planted' && day - f.day > _num(F.tipDays, 6)) {
                    f.status = 'fizzled';
                    out.notices.push({ icon: '🌫️', title: 'The Plot Fizzles', text: PeopleCrimes.line('fizzled', { name: f.name }), type: 'info' });
                } else if (f.status === 'tipped' && day >= _num(f.trialDay)) {
                    PeopleCrimes._trial(player, world, f, out);
                } else if ((f.status === 'hanged' || f.status === 'exiled') && !f.exposed && Math.floor((day - f.verdictDay) / Y) > _num(f.exposeRolls)) {
                    // (once a year from the verdict: counted in whole years, so skipped days still roll)
                    f.exposeRolls = _num(f.exposeRolls) + 1;
                    if (f.exposeRolls <= _num(F.exposeMaxYears, 40) && Utils.random() < _num(F.exposeYearly, 0.06) + _num(st.liar) * _num(F.exposePerLiar, 0.03)) PeopleCrimes._exposeFrame(player, world, f, out);
                }
            }
            // Old, settled plots fall off the book (an exposed or long-quiet one; acquittals and fizzles at once)
            st.frames = st.frames.filter(f => !(['fizzled', 'acquitted'].includes(f.status) && day - f.day > Y)
                && !(f.verdictDay != null && day - f.verdictDay > _num(F.exposeMaxYears, 40) * Y));
            for (const c of st.captives.slice()) PeopleCrimes._captiveDay(player, world, c, out);
            for (const x of st.stocks.slice()) PeopleCrimes._stocksDay(player, world, x, out);
            for (const x of st.cold.slice()) PeopleCrimes._coldDay(player, world, x, out);
            for (const rec of st.sold.slice()) PeopleCrimes._soldDay(player, world, rec, out);
        });
        return out;
    },

    _soldDay(player, world, rec, out) {
        const st = PeopleCrimes.state(player);
        const day = _day(world);
        if (rec.returnDay != null && day >= rec.returnDay) {
            st.sold = st.sold.filter(x => x !== rec);
            const s = PeopleCrimes.settlementAt(world, rec.q, rec.r);
            const folk = s && s.folk;
            const p = folk ? Townsfolk.get(folk, rec.pid) : null;
            if (p && p.died == null) {
                p.away = null;
                Townsfolk.note(p, day, 'arrived', null, 'the galleys');
                p.pcMark = p.pcMark || 'galley';
            }
            PeopleCrimes._count(st, 'returned');
            rec.exposed = null;
            PeopleCrimes._exposeBondage(player, world, rec, out, true);
            if (!p) {
                // The roster has forgotten them; the feud has not
                Nemesis.wrong(player, world, { kind: 'blood', name: rec.name, line: rec.last, score: _num(PeopleCrimes.config().nemesis.bondage, 85), gender: rec.gender === 'female' ? 'female' : 'male', deed: { key: 'sold_bondage', label: 'the years at the oar you sold them to', note: rec.town } });
            }
        } else if (rec.dieDay != null && day >= rec.dieDay) {
            st.sold = st.sold.filter(x => x !== rec);
            const { folk, p } = PeopleCrimes.personAt(world, rec.q, rec.r, rec.pid);
            if (p && p.died == null) Townsfolk.slay(folk, p, day, 'at the oar, far away');
            PeopleCrimes._count(st, 'diedOar');
            out.notices.push({ icon: '🌊', title: 'Died at the Oar', text: PeopleCrimes.line('diedOar', { name: rec.name, town: rec.town }), type: 'info' });
        }
    },

    /** For the panel: captives, people in the stocks, the sold, the tally. */
    view(player, world) {
        const st = player && player.peopleCrimes ? PeopleCrimes.state(player) : null;
        if (!st) return { captives: [], stocks: [], sold: [], frames: [], stats: {} };
        const day = _day(world);
        return {
            captives: st.captives.map(c => ({ ...c, days: day - c.day, harbour: PeopleCrimes.isHarbour(world, c.q, c.r) })),
            stocks: st.stocks.slice(),
            sold: st.sold.map(r => ({ name: r.name, town: r.town, day: r.day, price: r.price })),
            frames: st.frames.filter(f => f.status === 'planted' || f.status === 'tipped'),
            stats: { ...st.stats }, liar: st.liar,
        };
    },
};
