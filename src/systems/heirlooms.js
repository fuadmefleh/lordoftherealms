// ============================================
// HEIRLOOMS — named things that carry the House's story down the generations
// ============================================
// A sword, a ring, a crown, a book, a banner, a harness or a relic with a
// name of its own ("Oathbrand", "the Ring of House Vael"). An heirloom comes
// into the House
//   • from a great deed — the first crowning, the fifth victory, a great work
//     (house.stats thresholds, data/heirlooms.json forges),
//   • from a masterwork the ruler made (player/crafting.js grades) or a
//     treasure carried home (player/treasures.js), taken out of the packs
//     with Heirlooms.forgeFromItem,
//   • or found at the bottom of a delve (systems/delves.js stats.cleared).
// It gathers history lines as the House does things with it in hand ("Carried
// by Aldric when he broke a Vael army in the field"), read from the House's
// Prestige log. Each line adds to its legend; the legend raises the modest
// bonus its kind gives (battle power, negotiation, damage reduction, a little
// Prestige a year), read through PlayerEffects.treasureBonus.
//
// It can be given to a child, pawned to moneylenders (sold away when the
// pledge runs out), stolen (a few times a century), lost on the field where a
// ruler fell, carried off in a disputed succession, or sent with a child as a
// dowry. A lost one keeps a trail (a town on the map): going there to buy it
// back, take it back or ask for it is the quest. At a succession the heirlooms
// the ruler held pass to the heir (Heirlooms.onSuccession, from
// Relationships.succeedAsHeir) — they live on player.house.heirlooms, not in
// the packs, so the heir's fresh inventory never loses them.
//
// State: player.house.heirlooms (saved with the House). Content:
// data/heirlooms.json. Randomness: its own seeded streams (world seed, day,
// key) — the shared stream is never drawn. No import-time side effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Grades } from '../core/grades.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Names } from '../core/names.js';

const DEFAULTS = {
    kinds: {
        sword: { icon: '🗡️', label: 'Sword', bonus: { battlePower: 0.02 }, nouns: ['brand'], titles: ['the Sword of {founder}'] },
        ring: { icon: '💍', label: 'Ring', bonus: { negotiation: 0.015 }, nouns: ['band'], titles: ['the Ring of {house}'] },
        crown: { icon: '👑', label: 'Crown', bonus: { negotiation: 0.01 }, prestigeYear: 2, nouns: ['crown'], titles: ['the Crown of {founder}'] },
        book: { icon: '📕', label: 'Book', bonus: { negotiation: 0.01 }, prestigeYear: 1, nouns: ['book'], titles: ['the Book of {house}'] },
        banner: { icon: '🚩', label: 'Banner', bonus: { battlePower: 0.015 }, prestigeYear: 1, nouns: ['banner'], titles: ['the Banner of {house}'] },
        armour: { icon: '🛡️', label: 'Armour', bonus: { damageReduction: 0.04 }, nouns: ['mail'], titles: ['the Mail of {house}'] },
        relic: { icon: '🏺', label: 'Relic', bonus: {}, prestigeYear: 2, nouns: ['relic'], titles: ['the Relic of {house}'] },
    },
    adjectives: ['Dawn', 'Grey', 'Oath', 'Storm'],
    titleChance: 0.4,
    legend: { perPoint: 0.04, cap: 50, tiers: [{ min: 0, label: 'Unsung' }, { min: 5, label: 'Storied' }, { min: 15, label: 'Renowned' }, { min: 30, label: 'Legendary' }] },
    caps: { battlePower: 0.08, negotiation: 0.06, damageReduction: 0.12 },
    weights: { battle: 3, crowned: 6, deed: 1, succession: 2, recovered: 3, made: 1, dowry: 2, regency: 1 },
    deedMinPrestige: 8,
    battlePattern: 'army|broke|defeated|battle|took .+ for|outlasted|revolt|retook|relief|crushed',
    skipPattern: '^(an heir takes up the mantle|legacy dynasty prestige|quest:|contract:)',
    historyCap: 30,
    forges: [],
    masterworks: {},
    treasures: {},
    finds: { delveChance: 0.15, digChance: 0.1 },
    theft: { yearlyChance: 0.025, minLegend: 3 },
    succession: { disputeTakeChance: 0.5, fieldLossChance: 0.35, fieldCausePattern: 'battle|slain|killed|wound|fell|duel|murder|assassin' },
    pawn: { base: 120, perLegend: 12, redeemMult: 1.25, termDays: 360 },
    recover: { buyMult: 1.6, takeBase: 0.35, takePerSkill: 0.05, takeHurt: 25, searchChance: 0.3, surfaceDays: 720, askReputation: 40 },
    dowry: { prestige: 4, reputation: 12 },
    lines: {},
    thieves: ['a band of road thieves'],
};

/** Where an heirloom is. Only 'held' (the ruler's) gives its bonus. */
export const HEIRLOOM_STATUS = ['held', 'child', 'pawned', 'stolen', 'lost', 'sold', 'dowry'];
const GONE = ['stolen', 'lost', 'sold', 'dowry'];

let _cfg = null;
let _cfgSrc;

function _num(v, d = 0) {
    return typeof v === 'number' && isFinite(v) ? v : d;
}

function _day(world) {
    return _num(world && world.day);
}

function _dpy() {
    const rel = (typeof DataLoader !== 'undefined' && DataLoader.relationships) || null;
    return _num(rel && rel.heirSettings && rel.heirSettings.daysPerYear) || 120;
}

function _fill(t, vars) {
    return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : ''));
}

/** A private seeded stream (world seed × key): never the shared one. */
function _rng(world, key) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    let s = (Utils.hashStr(`${seed}|heirlooms|${key}`) >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function _pick(rng, arr) {
    return arr && arr.length ? arr[Math.floor(rng() * arr.length) % arr.length] : null;
}

function _first(name) {
    return String(name || '').split(' ')[0] || name || '';
}

function _tile(world, player) {
    return world && player && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
}

function _hereName(world, player) {
    const t = _tile(world, player);
    if (t && t.settlement && t.settlement.name) return t.settlement.name;
    const k = t && t.kingdom != null && typeof world.getKingdom === 'function' ? world.getKingdom(t.kingdom) : null;
    return k ? `the lands of ${Names.realm(k.name)}` : 'the wilds';
}

function _towns(world) {
    return world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
}

export const Heirlooms = {
    STATUS: HEIRLOOM_STATUS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.heirlooms : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const o = (src && typeof src === 'object') ? src : {};
            _cfg = {
                ...DEFAULTS, ...o,
                kinds: { ...DEFAULTS.kinds, ...(o.kinds || {}) },
                legend: { ...DEFAULTS.legend, ...(o.legend || {}) },
                caps: { ...DEFAULTS.caps, ...(o.caps || {}) },
                weights: { ...DEFAULTS.weights, ...(o.weights || {}) },
                theft: { ...DEFAULTS.theft, ...(o.theft || {}) },
                succession: { ...DEFAULTS.succession, ...(o.succession || {}) },
                pawn: { ...DEFAULTS.pawn, ...(o.pawn || {}) },
                recover: { ...DEFAULTS.recover, ...(o.recover || {}) },
                dowry: { ...DEFAULTS.dowry, ...(o.dowry || {}) },
                finds: { ...DEFAULTS.finds, ...(o.finds || {}) },
                lines: { ...DEFAULTS.lines, ...(o.lines || {}) },
            };
        }
        return _cfg;
    },

    /** The House's heirloom book (backfilled for old saves). Null without a House. */
    ensure(player) {
        const house = player && player.house;
        if (!house) return null;
        let st = house.heirlooms;
        if (!st || typeof st !== 'object' || !Array.isArray(st.items)) {
            st = house.heirlooms = { v: 1, items: [], seq: 0, cursor: null, statsSeen: null, delvesSeen: null };
        }
        return st;
    },

    list(player) {
        const st = Heirlooms.ensure(player);
        return st ? st.items : [];
    },

    get(player, id) {
        return Heirlooms.list(player).find(h => h && h.id === id) || null;
    },

    kind(kindId) {
        return Heirlooms.config().kinds[kindId] || Heirlooms.config().kinds.relic;
    },

    // ── Legend & bonuses ──────────────────────────────

    legend(item) {
        return Math.max(0, _num(item && item.legend));
    },

    tier(item) {
        const tiers = (Heirlooms.config().legend.tiers || []).slice().sort((a, b) => a.min - b.min);
        let out = tiers[0] || { min: 0, label: '' };
        for (const t of tiers) if (Heirlooms.legend(item) >= t.min) out = t;
        return out;
    },

    /** The legend's lift: 1 for a new heirloom, up to 1 + cap × perPoint. */
    lift(item) {
        const L = Heirlooms.config().legend;
        return 1 + Math.min(Heirlooms.legend(item), _num(L.cap, 50)) * _num(L.perPoint, 0.04);
    },

    /** { battlePower: 0.03, ... } — what this heirloom gives when the ruler holds it. */
    bonusOf(item) {
        const k = Heirlooms.kind(item && item.kind);
        const lift = Heirlooms.lift(item);
        const out = {};
        for (const [key, v] of Object.entries(k.bonus || {})) out[key] = Math.round(_num(v) * lift * 1000) / 1000;
        return out;
    },

    /** Prestige a year from an heirloom the ruler holds (a crown, a relic, a banner). */
    prestigeOf(item) {
        const k = Heirlooms.kind(item && item.kind);
        return Math.round(_num(k.prestigeYear) * Heirlooms.lift(item));
    },

    /** The heirlooms the ruler holds. */
    held(player) {
        return Heirlooms.list(player).filter(h => h.status === 'held');
    },

    /** Total of one bonus over the heirlooms the ruler holds, capped (PlayerEffects.treasureBonus). */
    bonus(player, key) {
        if (!player || !player.house || !player.house.heirlooms) return 0;
        const cap = _num(Heirlooms.config().caps[key], 0.05);
        let total = 0;
        if (key === 'damageReduction') {
            let keep = 1;
            for (const h of Heirlooms.held(player)) keep *= 1 - _num(Heirlooms.bonusOf(h)[key]);
            total = 1 - keep;
        } else {
            for (const h of Heirlooms.held(player)) total += _num(Heirlooms.bonusOf(h)[key]);
        }
        return Math.min(cap, Math.max(0, total));
    },

    /** One-line description of an heirloom's bonuses: "+3% battle power · +2 Prestige a year". */
    describeBonus(item) {
        const LABEL = { battlePower: 'battle power', negotiation: 'in negotiation', damageReduction: 'less harm taken' };
        const parts = Object.entries(Heirlooms.bonusOf(item))
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `+${Math.round(v * 1000) / 10}% ${LABEL[k] || k}`);
        const p = Heirlooms.prestigeOf(item);
        if (p > 0) parts.push(`+${p} Prestige a year`);
        return parts.join(' · ');
    },

    // ── Making ────────────────────────────────────────

    /** A name for a new heirloom of `kind` (seeded by the House and the count). */
    _name(player, world, kind, seq) {
        const C = Heirlooms.config();
        const k = Heirlooms.kind(kind);
        const rng = _rng(world, `name|${(player.house && player.house.name) || ''}|${seq}`);
        const founder = _first(player.name);
        const house = (player.house && player.house.name) || `House ${player.lastName || founder}`;
        if (rng() < _num(C.titleChance, 0.4) && (k.titles || []).length) {
            const t = _fill(_pick(rng, k.titles), { founder, house });
            return t.charAt(0).toUpperCase() + t.slice(1);
        }
        const adj = _pick(rng, C.adjectives) || 'Grey';
        const noun = _pick(rng, k.nouns) || 'heirloom';
        return `${adj}${noun}`;
    },

    /**
     * A new heirloom. o = { kind, origin, line (template key), vars, name,
     * itemId }. Returns the item, or null without a House.
     */
    create(player, world, o = {}) {
        const st = Heirlooms.ensure(player);
        if (!st) return null;
        const C = Heirlooms.config();
        const kind = C.kinds[o.kind] ? o.kind : 'relic';
        st.seq = _num(st.seq) + 1;
        const k = Heirlooms.kind(kind);
        const item = {
            id: `hl_${st.seq}`,
            name: o.name || Heirlooms._name(player, world, kind, st.seq),
            kind, icon: k.icon, origin: o.origin || 'deed', itemId: o.itemId || null,
            made: _day(world), status: 'held', holderId: null,
            legend: 0, history: [], bearers: [],
            trail: null, pawn: null,
        };
        Heirlooms._bear(player, item, _day(world));
        st.items.push(item);
        const vars = { ruler: player.name, ...(o.vars || {}) };
        Heirlooms.addLine(item, world, _fill(C.lines[o.line] || o.text || 'Came into the House under {ruler}', vars), _num(C.weights.made, 1));
        if (player.house) House._chronicle(player.house, world, `${item.name}, ${Heirlooms._article(k.label)}, becomes an heirloom of ${player.house.name}.`, ['heirloom']);
        return item;
    },

    _article(label) {
        const l = String(label || 'thing').toLowerCase();
        return `${/^[aeiou]/.test(l) ? 'an' : 'a'} ${l}`;
    },

    /** Add a line to an heirloom's history; its weight goes to the legend. */
    addLine(item, world, text, weight = 1) {
        if (!item || !text) return;
        item.history = Array.isArray(item.history) ? item.history : [];
        item.history.push({ day: _day(world), text, w: _num(weight) });
        item.legend = _num(item.legend) + Math.max(0, _num(weight));
        const cap = _num(Heirlooms.config().historyCap, 30);
        if (item.history.length > cap) {
            // the first line (how it came to the House) is always kept
            item.history = [item.history[0], ...item.history.slice(-(cap - 1))];
        }
    },

    /** Note the current bearer in the item's roll of bearers (lineage ids, for the tree). */
    _bear(player, item, day, who = null) {
        const L = player.house && player.house.lineage;
        const id = who ? who.id : (L && L.currentId) || 'ruler';
        const name = who ? who.name : player.name;
        item.bearers = Array.isArray(item.bearers) ? item.bearers : [];
        const last = item.bearers[item.bearers.length - 1];
        if (last && last.id === id && last.to == null) return;
        if (last && last.to == null) last.to = day;
        item.bearers.push({ id, name, from: day, to: null });
    },

    _unbear(item, day) {
        const last = (item.bearers || [])[item.bearers.length - 1];
        if (last && last.to == null) last.to = day;
    },

    /** Goods in the packs that could become an heirloom: masterworks of arms, jewels and books, and treasures. */
    eligible(player) {
        const C = Heirlooms.config();
        const out = [];
        if (!player || !player.house) return out;
        for (const [itemId, qty] of Object.entries(player.inventory || {})) {
            if (!(qty > 0)) continue;
            if (C.treasures[itemId]) out.push({ itemId, kind: C.treasures[itemId], how: 'treasure' });
            else if (C.masterworks[itemId] && Grades.counts(player, itemId).masterwork > 0) out.push({ itemId, kind: C.masterworks[itemId], how: 'masterwork' });
        }
        return out;
    },

    /** Take one unit out of the packs and make it an heirloom (a masterwork or a treasure). */
    forgeFromItem(player, world, itemId, name = null) {
        const e = Heirlooms.eligible(player).find(x => x.itemId === itemId);
        if (!e) return { success: false, reason: 'That is not something to hand down: a masterwork of arms, a jewel or a book, or a treasure.' };
        const goods = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        const def = goods[String(itemId).toUpperCase()] || {};
        const label = (def.name || String(itemId).replace(/_/g, ' ')).toLowerCase();
        if (e.how === 'masterwork') Grades.remove(player, itemId, 1, { grade: 'masterwork' });
        else {
            Grades.take(player, itemId, 1, { order: 'best' });
            player.inventory[itemId] = _num(player.inventory[itemId]) - 1;
            if (!(player.inventory[itemId] > 0)) delete player.inventory[itemId];
        }
        const item = Heirlooms.create(player, world, {
            kind: e.kind, origin: e.how === 'masterwork' ? 'made' : 'treasure', itemId,
            line: e.how === 'masterwork' ? 'made' : 'fromTreasure', vars: { item: label },
            name: name ? String(name).slice(0, 40) : null,
        });
        return { success: true, item };
    },

    // ── What happens to it ──────────────────────────────

    _living(player, childId) {
        return (player.children || []).find(c => c && c.id === childId && c.isAlive !== false) || null;
    },

    /** Give a held heirloom to a living child (it leaves the ruler's hand; no bonus while away). */
    give(player, world, id, childId) {
        const h = Heirlooms.get(player, id);
        const c = Heirlooms._living(player, childId);
        if (!h || h.status !== 'held') return { success: false, reason: 'You do not hold it.' };
        if (!c) return { success: false, reason: 'No such child.' };
        h.status = 'child';
        h.holderId = c.id;
        Heirlooms._bear(player, h, _day(world), { id: c.id, name: `${c.firstName} ${c.dynasty || ''}`.trim() });
        Heirlooms.addLine(h, world, _fill(Heirlooms.config().lines.given, { ruler: player.name, child: c.firstName }), 0);
        return { success: true, item: h, child: c };
    },

    /** Take back an heirloom given to a child. */
    takeBack(player, world, id) {
        const h = Heirlooms.get(player, id);
        if (!h || h.status !== 'child') return { success: false, reason: 'No child holds it.' };
        const c = (player.children || []).find(x => x && x.id === h.holderId);
        h.status = 'held';
        h.holderId = null;
        Heirlooms._bear(player, h, _day(world));
        Heirlooms.addLine(h, world, _fill(Heirlooms.config().lines.returned, { ruler: player.name, child: c ? c.firstName : 'a child' }), 0);
        return { success: true, item: h };
    },

    /** What the moneylenders lend on it: more for a storied piece. */
    pawnValue(item) {
        const P = Heirlooms.config().pawn;
        return Math.round(_num(P.base) + Heirlooms.legend(item) * _num(P.perLegend));
    },

    /** Pawn a held heirloom in the town the ruler stands in. */
    pawn(player, world, id) {
        const h = Heirlooms.get(player, id);
        if (!h || h.status !== 'held') return { success: false, reason: 'You do not hold it.' };
        const t = _tile(world, player);
        if (!t || !t.settlement) return { success: false, reason: 'There are moneylenders only in a town.' };
        const P = Heirlooms.config().pawn;
        const gold = Heirlooms.pawnValue(h);
        const day = _day(world);
        player.gold = _num(player.gold) + gold;
        Ledger.record(player, 'heirlooms', gold);
        h.status = 'pawned';
        h.pawn = { place: t.settlement.name, q: t.q != null ? t.q : player.q, r: t.r != null ? t.r : player.r, gold, redeem: Math.round(gold * _num(P.redeemMult, 1.25)), day, due: day + _num(P.termDays, 360) };
        Heirlooms._unbear(h, day);
        Heirlooms.addLine(h, world, _fill(Heirlooms.config().lines.pawned, { ruler: player.name, place: h.pawn.place, gold }), 0);
        return { success: true, item: h, gold };
    },

    /** Is the ruler standing where the heirloom is (its pawnbroker, its trail)? */
    isHere(player, world, item) {
        const at = item && (item.status === 'pawned' ? item.pawn : item.trail);
        if (!at || at.q == null) return false;
        return player && player.q === at.q && player.r === at.r;
    },

    /** Redeem a pawned heirloom at the moneylenders who hold it. */
    redeem(player, world, id) {
        const h = Heirlooms.get(player, id);
        if (!h || h.status !== 'pawned' || !h.pawn) return { success: false, reason: 'It is not in pawn.' };
        if (!Heirlooms.isHere(player, world, h)) return { success: false, reason: `The moneylenders of ${h.pawn.place} hold it: redeem it there.` };
        if (_num(player.gold) < h.pawn.redeem) return { success: false, reason: `Redeeming it costs ${h.pawn.redeem} gold.` };
        player.gold = _num(player.gold) - h.pawn.redeem;
        Ledger.record(player, 'heirlooms', -h.pawn.redeem);
        const place = h.pawn.place;
        h.status = 'held';
        h.pawn = null;
        Heirlooms._bear(player, h, _day(world));
        Heirlooms.addLine(h, world, _fill(Heirlooms.config().lines.redeemed, { ruler: player.name, place }), 0);
        return { success: true, item: h };
    },

    /** Children wed into a realm (alliance or royal match) an heirloom can go with as dowry. */
    dowryChildren(player) {
        return (player.children || []).filter(c => {
            const sp = c && c.isAlive !== false && c.upbringing && c.upbringing.spouse;
            return sp && (sp.kind === 'alliance' || sp.kind === 'royal') && sp.kingdomId != null;
        });
    },

    /** Send an heirloom with a child wed into a realm: standing and Prestige, and the heirloom leaves the House. */
    giveAsDowry(player, world, id, childId) {
        const h = Heirlooms.get(player, id);
        if (!h || (h.status !== 'held' && h.status !== 'child')) return { success: false, reason: 'You do not hold it.' };
        const c = Heirlooms.dowryChildren(player).find(x => x.id === childId);
        if (!c) return { success: false, reason: 'Only a child wed into a realm can take a dowry there.' };
        const C = Heirlooms.config();
        const sp = c.upbringing.spouse;
        const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(sp.kingdomId) : null;
        const realm = (k && k.name) || sp.kingdomName || 'a foreign court';
        const day = _day(world);
        if (!player.reputation) player.reputation = {};
        player.reputation[sp.kingdomId] = _num(player.reputation[sp.kingdomId]) + _num(C.dowry.reputation);
        if (player.house) House.award(player.house, _num(C.dowry.prestige), `${h.name} sent as dowry into ${realm}`, day);
        h.status = 'dowry';
        h.holderId = c.id;
        h.trail = { kingdomId: sp.kingdomId, place: realm, q: k && k.capital ? k.capital.q : null, r: k && k.capital ? k.capital.r : null, holder: `the court of ${realm}`, price: Math.round(Heirlooms.pawnValue(h) * _num(C.recover.buyMult, 1.6)), since: day, how: 'dowry' };
        Heirlooms._bear(player, h, day, { id: c.id, name: `${c.firstName} ${c.dynasty || ''}`.trim() });
        Heirlooms.addLine(h, world, _fill(C.lines.dowry, { child: c.firstName, realm }), _num(C.weights.dowry, 2));
        return { success: true, item: h, realm };
    },

    /** Put an heirloom on a trail: in a town somewhere (stolen, sold) — the quest to recover it. */
    _toTown(world, h, key, how, holder) {
        const C = Heirlooms.config();
        const towns = _towns(world);
        const rng = _rng(world, `${key}|${h.id}|${_day(world)}`);
        const s = _pick(rng, towns);
        h.trail = s
            ? { q: s.q, r: s.r, place: s.name, holder, price: Math.round(Heirlooms.pawnValue(h) * _num(C.recover.buyMult, 1.6)), since: _day(world), how }
            : { q: null, r: null, place: 'parts unknown', holder, price: Math.round(Heirlooms.pawnValue(h) * _num(C.recover.buyMult, 1.6)), since: _day(world), how };
        return h.trail;
    },

    /**
     * The ways to get a lost heirloom back from where it lies, and whether
     * the ruler is there: { here, place, buy, take, ask, search }.
     */
    recoverOptions(player, world, id) {
        const h = Heirlooms.get(player, id);
        if (!h || !GONE.includes(h.status) || !h.trail) return null;
        const C = Heirlooms.config().recover;
        const here = Heirlooms.isHere(player, world, h);
        const skill = _num(player.skills && player.skills.stealth) + _num(player.skills && player.skills.combat) / 2;
        const take = Math.max(0.05, Math.min(0.9, _num(C.takeBase) + skill * _num(C.takePerSkill)));
        const rep = h.trail.kingdomId != null ? _num(player.reputation && player.reputation[h.trail.kingdomId]) : 0;
        return {
            here, place: h.trail.place, holder: h.trail.holder,
            buy: h.status === 'lost' ? null : h.trail.price,
            take: h.status === 'lost' || h.status === 'dowry' ? null : take,
            ask: h.status === 'dowry' ? { ok: rep >= _num(C.askReputation), need: _num(C.askReputation), rep } : null,
            search: h.status === 'lost' ? _num(C.searchChance) : null,
        };
    },

    /** Try to get it back: how = 'buy' | 'take' | 'ask' | 'search'. Seeded by the day. */
    recover(player, world, id, how) {
        const h = Heirlooms.get(player, id);
        const o = Heirlooms.recoverOptions(player, world, id);
        if (!h || !o) return { success: false, reason: 'It is not lost.' };
        if (!o.here) return { success: false, reason: `It lies in ${o.place}: go there.` };
        const C = Heirlooms.config();
        const day = _day(world);
        const rng = _rng(world, `recover|${h.id}|${day}|${how}`);
        const place = h.trail.place;
        const won = (lineKey, vars = {}) => {
            h.status = 'held';
            h.holderId = null;
            h.trail = null;
            Heirlooms._bear(player, h, day);
            Heirlooms.addLine(h, world, _fill(C.lines[lineKey], { ruler: player.name, place, ...vars }), _num(C.weights.recovered, 3));
            if (player.house) House._chronicle(player.house, world, `${player.name} recovers ${h.name} in ${place}.`, ['heirloom']);
            return { success: true, item: h };
        };
        if (how === 'buy') {
            if (o.buy == null) return { success: false, reason: 'No one here will sell it.' };
            if (_num(player.gold) < o.buy) return { success: false, reason: `They ask ${o.buy} gold.` };
            player.gold = _num(player.gold) - o.buy;
            Ledger.record(player, 'heirlooms', -o.buy);
            return won('recovered');
        }
        if (how === 'take') {
            if (o.take == null) return { success: false, reason: 'There is no taking it here.' };
            h.trail.tries = _num(h.trail.tries) + 1;
            if (rng() < o.take) return won('recovered');
            const hurt = _num(C.recover.takeHurt, 25);
            player.health = Math.max(1, _num(player.health, 100) - hurt);
            const t = _tile(world, player);
            if (t && t.kingdom != null) {
                if (!player.reputation) player.reputation = {};
                player.reputation[t.kingdom] = _num(player.reputation[t.kingdom]) - 5;
            }
            return { success: false, failed: true, hurt, reason: `${h.trail.holder} catches you at it. You get away hurt (−${hurt} health).` };
        }
        if (how === 'ask') {
            if (!o.ask) return { success: false, reason: 'There is no one to ask.' };
            if (!o.ask.ok) return { success: false, reason: `${place} will not part with it: your standing there is ${o.ask.rep} (need ${o.ask.need}).` };
            if (h.trail.kingdomId != null && player.reputation) player.reputation[h.trail.kingdomId] = _num(player.reputation[h.trail.kingdomId]) - Math.round(o.ask.need / 2);
            return won('askedBack', { realm: place });
        }
        if (how === 'search') {
            if (o.search == null) return { success: false, reason: 'There is nothing to search for here.' };
            if (h.trail.searchedDay === day) return { success: false, reason: 'You have searched today. Come back tomorrow.' };
            h.trail.searchedDay = day;
            if (rng() < o.search) return won('recovered');
            return { success: false, failed: true, reason: 'You search the ground until dark and find nothing.' };
        }
        return { success: false, reason: 'Unknown way.' };
    },

    // ── The succession ────────────────────────────────

    /**
     * The ruler is dead; the heir takes up the mantle (Relationships.succeedAsHeir,
     * after the heir took the seat). ctx = { oldName, oldId, heirId, heirName,
     * cause, disputed, secured, regent }. The heirlooms the late ruler held pass on;
     * a disputed succession or a death in the field may cost one.
     */
    onSuccession(player, world, ctx = {}) {
        const st = Heirlooms.ensure(player);
        if (!st || !st.items.length) return { passed: [], lost: [] };
        const C = Heirlooms.config();
        const day = _day(world);
        const rng = _rng(world, `succession|${day}|${ctx.oldName || ''}`);
        const heir = { id: ctx.heirId || 'ruler', name: ctx.heirName || player.name };
        const passed = [];
        const lost = [];
        // A death in the field: the sword, banner or harness may stay where the ruler fell
        const fieldRe = new RegExp(C.succession.fieldCausePattern || '$^', 'i');
        if (ctx.cause && fieldRe.test(String(ctx.cause))) {
            const arms = st.items.filter(h => h.status === 'held' && ['sword', 'banner', 'armour'].includes(h.kind));
            const h = arms.length && rng() < _num(C.succession.fieldLossChance) ? _pick(rng, arms) : null;
            if (h) {
                h.status = 'lost';
                h.trail = { q: ctx.q != null ? ctx.q : player.q, r: ctx.r != null ? ctx.r : player.r, place: ctx.place || 'the field where they fell', holder: 'the field', price: null, since: day, how: 'field' };
                Heirlooms._unbear(h, day);
                Heirlooms.addLine(h, world, _fill(C.lines.fieldLost, { ruler: ctx.oldName }), _num(C.weights.battle, 3));
                lost.push(h);
            }
        }
        for (const h of st.items) {
            if (h.status === 'held' || (h.status === 'child' && h.holderId === ctx.heirId)) {
                h.status = 'held';
                h.holderId = null;
                Heirlooms._bear(player, h, day, heir);
                Heirlooms.addLine(h, world, _fill(C.lines.succession, { heir: heir.name, ruler: ctx.oldName }), _num(C.weights.succession, 2));
                if (ctx.regent) Heirlooms.addLine(h, world, _fill(C.lines.regency, { regent: ctx.regent, heir: _first(heir.name) }), _num(C.weights.regency, 1));
                passed.push(h);
            }
        }
        // A claimant in a disputed succession carries one off
        if (ctx.disputed && !ctx.secured && passed.length && rng() < _num(C.succession.disputeTakeChance)) {
            const h = _pick(rng, passed);
            h.status = 'stolen';
            Heirlooms._unbear(h, day);
            const thief = 'a rival claimant of the blood';
            Heirlooms._toTown(world, h, 'dispute', 'stolen', thief);
            Heirlooms.addLine(h, world, _fill(C.lines.dispute, { thief, heir: heir.name }), 0);
            passed.splice(passed.indexOf(h), 1);
            lost.push(h);
        }
        return { passed, lost };
    },

    /**
     * A buried cache dug up whole (systems/treasureDigs.js giveLoot): now and then
     * a named thing lies among it (finds.digChance; a hash of the hex and the day,
     * no Utils draw). → the new heirloom, or null.
     */
    onDig(player, world, tile) {
        if (!player || !world || !tile || player._isDead || !Heirlooms.ensure(player)) return null;
        const C = Heirlooms.config();
        const rng = _rng(world, `dig|${_day(world)}|${tile.q},${tile.r}`);
        if (rng() >= _num(C.finds.digChance)) return null;
        return Heirlooms.create(player, world, { kind: _pick(rng, Object.keys(C.kinds)), origin: 'found', line: 'found', vars: { place: `a cache buried near ${_hereName(world, player)}` } });
    },

    // ── The day ───────────────────────────────────────

    /**
     * One day: deeds to remember, heirlooms born of great deeds, finds in the
     * deep places; yearly: Prestige from crowns and relics, a theft now and
     * then; pledges that run out; lost things surfacing. Returns { notices }.
     */
    processDay(player, world) {
        const notices = [];
        const st = Heirlooms.ensure(player);
        if (!st || !world || player._isDead) return { notices };
        const C = Heirlooms.config();
        const house = player.house;
        const day = _day(world);
        const stats = house.stats || {};

        // 1. Great deeds forge heirlooms (thresholds crossed since last look)
        if (!st.statsSeen) st.statsSeen = { ...stats };
        else {
            for (const f of C.forges || []) {
                const was = _num(st.statsSeen[f.stat]);
                const now = _num(stats[f.stat]);
                for (const at of f.at || []) {
                    if (was < at && now >= at) {
                        const h = Heirlooms.create(player, world, { kind: f.kind, origin: 'deed', text: f.line, vars: { ruler: player.name, n: at } });
                        if (h) notices.push({ icon: h.icon, title: 'An Heirloom', text: `${h.name} becomes an heirloom of ${house.name}: ${h.history[0].text}.`, type: 'success' });
                    }
                }
            }
            // A crowning marks every heirloom the ruler holds
            if (_num(stats.crowned) > _num(st.statsSeen.crowned)) {
                for (const h of Heirlooms.held(player)) Heirlooms.addLine(h, world, _fill(C.lines.crowned, { ruler: player.name }), _num(C.weights.crowned, 6));
            }
            st.statsSeen = { ...stats };
        }

        // 2. The deeds done with them in hand (the Prestige log since last look)
        const log = Array.isArray(house.prestigeLog) ? house.prestigeLog : [];
        if (!st.cursor) st.cursor = { day, n: log.filter(e => _num(e.day) === day).length };
        else {
            const battleRe = new RegExp(C.battlePattern, 'i');
            const skipRe = new RegExp(C.skipPattern, 'i');
            const held = Heirlooms.held(player);
            let seenAtCursor = 0;
            for (const e of log) {
                const d = _num(e.day);
                if (d < st.cursor.day) continue;
                if (d === st.cursor.day) {
                    seenAtCursor++;
                    if (seenAtCursor <= st.cursor.n) continue;
                }
                if (!(_num(e.delta) > 0) || !e.reason || skipRe.test(e.reason)) continue;
                const battle = battleRe.test(e.reason);
                if (!battle && _num(e.delta) < _num(C.deedMinPrestige, 8)) continue;
                const who = player.gender === 'female' ? 'she' : 'he';
                for (const h of held) {
                    Heirlooms.addLine(h, world, _fill(C.lines[battle ? 'battle' : 'deed'], { ruler: _first(player.name), who, reason: e.reason }), _num(C.weights[battle ? 'battle' : 'deed'], 1));
                }
            }
            const lastDay = log.length ? _num(log[log.length - 1].day) : day;
            st.cursor = { day: lastDay, n: log.filter(e => _num(e.day) === lastDay).length };
        }

        // 3. Found in the deep places (a delve cleared to the bottom)
        const cleared = _num(player.delves && player.delves.stats && player.delves.stats.cleared);
        if (st.delvesSeen == null) st.delvesSeen = cleared;
        else if (cleared > st.delvesSeen) {
            for (let i = st.delvesSeen; i < cleared; i++) {
                const rng = _rng(world, `delve|${day}|${i}`);
                if (rng() >= _num(C.finds.delveChance)) continue;
                const kinds = Object.keys(C.kinds);
                const h = Heirlooms.create(player, world, { kind: _pick(rng, kinds), origin: 'found', line: 'found', vars: { place: `the deep places under ${_hereName(world, player)}` } });
                if (h) notices.push({ icon: h.icon, title: 'Found in the Deep', text: `Among the bones at the bottom lay ${h.name}. It is the House's now.`, type: 'success' });
            }
            st.delvesSeen = cleared;
        }

        // 4. Children holding heirlooms who died: they come back to the House
        for (const h of st.items) {
            if (h.status !== 'child') continue;
            const c = (player.children || []).find(x => x && x.id === h.holderId);
            if (!c || c.isAlive === false) {
                h.status = 'held';
                h.holderId = null;
                Heirlooms._bear(player, h, day);
                Heirlooms.addLine(h, world, _fill(C.lines.returned, { ruler: player.name, child: c ? c.firstName : 'one now gone' }), 0);
            }
        }

        // 5. Pledges run out: the moneylenders sell it away
        for (const h of st.items) {
            if (h.status === 'pawned' && h.pawn && day > _num(h.pawn.due)) {
                const place = h.pawn.place;
                h.status = 'sold';
                h.pawn = null;
                Heirlooms._toTown(world, h, 'sold', 'sold', 'a dealer in old things');
                Heirlooms.addLine(h, world, _fill(C.lines.sold, { place }), 0);
                Heirlooms.addLine(h, world, _fill(C.lines.surfaced, { place: h.trail.place }), 0);
                notices.push({ icon: h.icon, title: 'Pledge Forfeit', text: `The moneylenders of ${place} sold ${h.name}. Word is it is for sale in ${h.trail.place}.`, type: 'warning' });
            }
            // Lost on a field: in time it turns up at a market
            if (h.status === 'lost' && h.trail && day - _num(h.trail.since) >= _num(C.recover.surfaceDays, 720)) {
                h.status = 'sold';
                Heirlooms._toTown(world, h, 'surface', 'sold', 'a dealer in old things');
                Heirlooms.addLine(h, world, _fill(C.lines.surfaced, { place: h.trail.place }), 0);
                notices.push({ icon: h.icon, title: 'An Heirloom Surfaces', text: `${h.name}, long lost, is for sale in ${h.trail.place}.`, type: 'info' });
            }
        }

        // 6. Once a year: crowns and relics bring Prestige; now and then a theft
        const Y = _dpy();
        if (day > 0 && day % Y === 0) {
            let prestige = 0;
            for (const h of Heirlooms.held(player)) prestige += Heirlooms.prestigeOf(h);
            if (prestige > 0) House.award(house, prestige, 'the heirlooms of the House', day);
            const rng = _rng(world, `theft|${day}`);
            const T = C.theft;
            const worth = st.items.filter(h => (h.status === 'held' || h.status === 'child') && Heirlooms.legend(h) >= _num(T.minLegend));
            if (worth.length && rng() < _num(T.yearlyChance)) {
                const h = _pick(rng, worth);
                const thief = _pick(rng, C.thieves) || 'a thief';
                h.status = 'stolen';
                h.holderId = null;
                Heirlooms._unbear(h, day);
                Heirlooms._toTown(world, h, 'theft', 'stolen', thief);
                Heirlooms.addLine(h, world, _fill(C.lines.stolen, { ruler: player.name, thief, place: h.trail.place }), 0);
                House._chronicle(house, world, `${h.name} is stolen from ${house.name} by ${thief}.`, ['heirloom', 'theft']);
                notices.push({ icon: '🕵️', title: 'An Heirloom Stolen', text: `${h.name} is gone, taken by ${thief}. It was seen on the road to ${h.trail.place}.`, type: 'warning' });
            }
        }
        return { notices };
    },

    /** Heirlooms whose recovery is open business (the quest list). */
    quests(player) {
        return Heirlooms.list(player).filter(h => GONE.includes(h.status) && h.trail);
    },

    /** Plain data for the tree / the chronicle book: { id, name, icon, kind, status, tier, legend, bonus, history, bearers }. */
    summary(item) {
        if (!item) return null;
        return {
            id: item.id, name: item.name, icon: item.icon, kind: item.kind, status: item.status, holderId: item.holderId || null,
            tier: Heirlooms.tier(item).label, legend: Heirlooms.legend(item), bonus: Heirlooms.describeBonus(item),
            history: (item.history || []).map(l => ({ day: l.day, text: l.text })), bearers: (item.bearers || []).map(b => ({ ...b })),
            trail: item.trail ? { place: item.trail.place, holder: item.trail.holder } : null,
        };
    },
};
