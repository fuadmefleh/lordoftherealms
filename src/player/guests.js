// ============================================
// GUESTS — being welcome under someone else's roof
// ============================================
// Who lets the player stay, and the social calls that ask: a visit, a meal
// at the household's table, a night under their roof.
//
//   Welcome without asking (welcomeIn): the house of the player's own
//   parents (Born to a Family: player.parentage.folk, or the royal parents'
//   seat at parentage.home), of their kin (a relationship NPC with a family
//   role: rel.family / npc.kin, unless estranged below kinMin) and of their
//   friends (rel.score from friendMin, or a street regard p.mem.disposition
//   from friendDisposition). Disowned, a runaway's parents shut the door.
//
//   Asked (ask): 'visit' (come in and sit a while today), 'meal' (share the
//   household's food — out of its own larder, systems/townTrade.js
//   serveGuest — and hunger, company and goodwill for it) and 'stay' (a bed
//   for tonight). A stranger says yes by their regard (yesFrom, a roll
//   between askFrom and yesFrom: one Utils.random); a lord of a seat by
//   regard and the player's standing (renown, a title) as a host.
//
// State: player.guestAt — the houses that have asked the player in, as keys
// `${worldQ},${worldR}|${type}@${q},${r}` (read by ui/objectActions/
// furniture.js), with player.guestStays[key] = { until, host, kind, since }
// (the last day the welcome holds). Both saved (SaveLoad
// EXTRA_PLAYER_FIELDS); expired stays are pruned on every read and write.
// No import-time effects; world/player passed in. Data: data/furnitureActions.json `guests`.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Relationships } from '../systems/relationships.js';
import { TownTrade } from '../systems/townTrade.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

const DEFAULTS = {
    kinMin: -20,
    friendMin: 40,
    friendDisposition: 80,
    askFrom: 55,
    yesFrom: 72,
    lordYesFrom: 65,
    lordRenownPer: 8,
    lordRenownMax: 25,
    lordTitle: 15,
    regard: { visit: 3, meal: 4, stay: 2, refused: -1 },
    visit: { hours: 1, effects: { social: 12, fun: 4, comfort: 3 } },
    meal: { hours: 1, portion: 0.5, effects: { hunger: 35, social: 10, comfort: 4 }, thin: { hunger: 10, social: 8 } },
    stay: { nights: 1 },
    homes: ['house', 'cottage', 'farm', 'manor', 'castle', 'palace'],
    seats: ['manor', 'castle', 'palace'],
    lines: {
        parents: 'This is your home. Your bed is where it always was.',
        kin: 'You never need ask. Family sleeps under this roof.',
        friend: 'You needn\'t ask, friend. Stay as long as you like.',
        visitYes: 'Come in, come in. Sit by the fire a while.',
        visitHere: 'You sit a while with {who} and the talk runs on.',
        mealYes: 'Sit down, there\'s enough for one more.',
        mealThin: 'There\'s little enough in the house, but you\'re welcome to share it.',
        stayYes: 'There\'s a bed for you tonight. Don\'t mind the snoring.',
        lordYes: '{who} will have a bed made up for you. You are the house\'s guest tonight.',
        no: 'I\'d rather not. Find yourself a room at the inn.',
        lordNo: 'My lord keeps no lodging for passing strangers.',
        notHome: 'We\'ve no house in this town to ask you into.',
    },
};

export const Guests = {
    cfg() {
        const d = (DataLoader.get && DataLoader.get('furnitureActions')) || {};
        const g = _obj(d.guests) || {};
        return { ...DEFAULTS, ...g, lines: { ...DEFAULTS.lines, ...(_obj(g.lines) || {}) }, regard: { ...DEFAULTS.regard, ...(_obj(g.regard) || {}) } };
    },

    /** The key a house goes by in player.guestAt (as ui/objectActions/furniture.js reads it). */
    key(worldQ, worldR, building) {
        if (!building) return null;
        return `${worldQ},${worldR}|${building.type}@${building.q},${building.r}`;
    },

    /** player.guestAt (keys) and player.guestStays (each key's welcome), made when missing. */
    ensure(player) {
        if (!player) return null;
        if (!Array.isArray(player.guestAt)) player.guestAt = [];
        if (!_obj(player.guestStays)) player.guestStays = {};
        return player;
    },

    /** Drop the welcomes that have run out (before `day`). */
    prune(player, world) {
        if (!player || !Array.isArray(player.guestAt)) return;
        Guests.ensure(player);
        const day = _day(world);
        const S = player.guestStays;
        player.guestAt = player.guestAt.filter((k) => {
            const s = S[k];
            // (a key with no record of its own: a welcome given by something else, kept)
            if (!s) return true;
            if (_num(s.until, -1) >= day) return true;
            delete S[k];
            return false;
        });
        for (const k of Object.keys(S)) if (!player.guestAt.includes(k)) delete S[k];
    },

    /** The welcome the player holds at this house now ({ until, host, kind, since }), or null. */
    stayAt(player, world, key) {
        if (!player || !key || !Array.isArray(player.guestAt)) return null;
        Guests.prune(player, world);
        if (!player.guestAt.includes(key)) return null;
        return (player.guestStays && player.guestStays[key]) || { until: Infinity, host: null, kind: 'stay' };
    },

    /** Has the house asked the player in to sleep tonight (a 'stay', not a day's visit)? */
    sleepsAt(player, world, key) {
        const s = Guests.stayAt(player, world, key);
        return !!(s && s.kind !== 'visit' && s.kind !== 'meal');
    },

    /** Asked in: the key on player.guestAt, its welcome till `until` (a stay lasts the night: till the morning after). */
    invite(player, world, key, { host = null, kind = 'stay', nights = 1 } = {}) {
        if (!player || !key) return null;
        Guests.ensure(player);
        Guests.prune(player, world);
        const day = _day(world);
        const until = kind === 'stay' ? day + Math.max(1, _num(nights, 1)) - 1 : day;
        const prev = player.guestStays[key];
        // (a night's stay outranks a day's visit; neither shortens a welcome already given)
        const keepKind = prev && prev.kind === 'stay' && kind !== 'stay';
        const rec = {
            until: prev ? Math.max(_num(prev.until, day), until) : until,
            host: host || (prev && prev.host) || null,
            kind: keepKind ? prev.kind : kind,
            since: prev ? prev.since : day,
        };
        player.guestStays[key] = rec;
        if (!player.guestAt.includes(key)) player.guestAt.push(key);
        return rec;
    },

    /**
     * Who this one person is to the player: { kind: 'parents' | 'kin' |
     * 'friend' | null, score }. folk/p: their town roster and person.
     */
    standingWith(player, world, folk, p) {
        const out = { kind: null, score: 0 };
        if (!player || !p) return out;
        const C = Guests.cfg();
        const pa = _obj(player.parentage);
        const disowned = !!(pa && (pa.disinherited || (pa.ended && (pa.ended.how === 'disowned' || pa.ended.how === 'ran'))));
        const pf = pa && _obj(pa.folk);
        const isParent = !!(pf && folk && pf.q === folk.q && pf.r === folk.r && (p.id === pf.f || p.id === pf.m));
        if (isParent && !disowned) return { kind: 'parents', score: 100 };
        const npc = folk && Relationships.npcForPerson ? Relationships.npcForPerson(folk, p) : null;
        const rel = npc && player.relationships ? player.relationships[npc.id] : null;
        const score = rel ? _num(rel.score) : 0;
        out.score = score;
        if (isParent) return out;
        if (rel && (rel.family || npc.kin) && score >= _num(C.kinMin, -20)) return { kind: 'kin', score };
        const disp = p.mem && Number.isFinite(p.mem.disposition) ? p.mem.disposition : 50;
        if ((rel && score >= _num(C.friendMin, 40)) || disp >= _num(C.friendDisposition, 80)) return { kind: 'friend', score };
        return out;
    },

    /**
     * Does this household take the player in without asking? residents:
     * townspeople whose home it is (map npcs with _person and _folk, or
     * { folk, p }). opts.building / worldQ / worldR: the royal parents' seat.
     * → { ok, kind, who } (who: the name of the one whose welcome it is).
     */
    welcomeIn(player, world, residents = [], opts = {}) {
        const rank = { parents: 3, kin: 2, friend: 1 };
        let best = null;
        for (const r of residents || []) {
            if (!r) continue;
            const p = r._person || r.p;
            const folk = r._folk || r.folk;
            if (!p || p.died != null) continue;
            const s = Guests.standingWith(player, world, folk, p);
            if (s.kind && (!best || rank[s.kind] > rank[best.kind])) best = { ok: true, kind: s.kind, who: r.name || `${p.first || ''} ${p.last || ''}`.trim() };
        }
        if (best) return best;
        // A prince's home: the royal parents' seat in the capital
        const pa = player && _obj(player.parentage);
        const b = opts.building;
        if (pa && pa.royal && b && pa.home && opts.worldQ === pa.home.q && opts.worldR === pa.home.r
            && Guests.cfg().seats.includes(String(b.type || '').replace(/^player_/, ''))
            && !(pa.disinherited || (pa.ended && (pa.ended.how === 'disowned' || pa.ended.how === 'ran')))) {
            return { ok: true, kind: 'parents', who: null };
        }
        return { ok: false, kind: null, who: null };
    },

    /**
     * May the player sleep under this roof tonight? A welcome given for the
     * night (player.guestAt), or one that needs no asking (welcomeIn).
     * → { ok, kind, host }
     */
    mayStay(player, world, { key = null, residents = [], building = null, worldQ = null, worldR = null } = {}) {
        if (key && Guests.sleepsAt(player, world, key)) {
            const s = Guests.stayAt(player, world, key);
            return { ok: true, kind: 'invited', host: s && s.host };
        }
        const w = Guests.welcomeIn(player, world, residents, { building, worldQ, worldR });
        return { ok: w.ok, kind: w.kind, host: w.who };
    },

    /** The player's standing as a lord's guest: regard plus renown and a title. */
    lordScore(player, disposition) {
        const C = Guests.cfg();
        const renown = Math.min(_num(C.lordRenownMax, 25), Math.max(0, _num(player && player.renown)) / Math.max(1, _num(C.lordRenownPer, 8)));
        const titled = player && player.title && player.title !== 'Nobody' ? _num(C.lordTitle, 15) : 0;
        return _num(disposition, 50) + renown + titled;
    },

    /**
     * Will they say yes? → { yes, rolled } — welcome needs no asking; a
     * stranger by their regard (a roll between askFrom and yesFrom), a lord by
     * lordScore. `lord`: the one asked keeps a seat.
     */
    willHost(player, world, { welcome = null, disposition = 50, lord = false } = {}) {
        const C = Guests.cfg();
        if (welcome && welcome.ok) return { yes: true, rolled: false };
        const score = lord ? Guests.lordScore(player, disposition) : _num(disposition, 50);
        const yes = lord ? _num(C.lordYesFrom, 65) : _num(C.yesFrom, 72);
        const from = _num(C.askFrom, 55);
        if (score >= yes) return { yes: true, rolled: false };
        if (score < from) return { yes: false, rolled: false };
        return { yes: Utils.random() < (score - from) / Math.max(1, yes - from), rolled: true };
    },

    /** The chance they say yes (for the menu's tooltip), 0..1. */
    hostChance(player, { welcome = null, disposition = 50, lord = false } = {}) {
        const C = Guests.cfg();
        if (welcome && welcome.ok) return 1;
        const score = lord ? Guests.lordScore(player, disposition) : _num(disposition, 50);
        const yes = lord ? _num(C.lordYesFrom, 65) : _num(C.yesFrom, 72);
        const from = _num(C.askFrom, 55);
        if (score >= yes) return 1;
        if (score < from) return 0;
        return (score - from) / Math.max(1, yes - from);
    },

    _mod(player, effects) {
        const out = {};
        for (const [need, amt] of Object.entries(effects || {})) {
            const v = Math.round(_num(amt));
            if (!v) continue;
            if (player && typeof player.modifyNeed === 'function') player.modifyNeed(need, v);
            out[need] = v;
        }
        return out;
    },

    /**
     * Ask a household for a visit, a meal or a night. ctx: { folk, p, name,
     * key (their house's key: null when they keep none here), disposition,
     * lord, atHome (the player stands in that house now), settlement }.
     * → { ok, text, kind, hours, gains, regard, served }
     */
    ask(player, world, what, ctx = {}) {
        const C = Guests.cfg();
        const L = C.lines;
        const who = ctx.name || (ctx.p ? ctx.p.first : 'they');
        if (!ctx.key) return { ok: false, text: L.notHome, hours: 0, regard: 0 };
        const st = ctx.p ? Guests.standingWith(player, world, ctx.folk, ctx.p) : { kind: null };
        const welcome = st.kind ? { ok: true, kind: st.kind } : (ctx.welcome || null);
        const ans = Guests.willHost(player, world, { welcome, disposition: ctx.disposition, lord: !!ctx.lord });
        if (!ans.yes) return { ok: false, text: ctx.lord ? L.lordNo : L.no, hours: 0, regard: _num(C.regard.refused, -1) };
        const day = _day(world);
        if (what === 'visit') {
            Guests.invite(player, world, ctx.key, { host: who, kind: 'visit' });
            if (!ctx.atHome) return { ok: true, kind: 'visit', text: welcome && welcome.ok ? L[welcome.kind] || L.visitYes : L.visitYes, hours: 0, regard: _num(C.regard.visit, 3) };
            const gains = Guests._mod(player, C.visit.effects);
            return { ok: true, kind: 'visit', text: _fill(L.visitHere, { who }), hours: _num(C.visit.hours, 1), gains, regard: _num(C.regard.visit, 3) };
        }
        if (what === 'meal') {
            Guests.invite(player, world, ctx.key, { host: who, kind: 'meal' });
            const served = ctx.settlement && ctx.p ? TownTrade.serveGuest(ctx.settlement, ctx.p, day, _num(C.meal.portion, 0.5)) : { units: 0, goods: {} };
            // (a bare larder still shares what it has: a crust and the warmth of the table)
            const full = served.units >= _num(C.meal.portion, 0.5) * 0.5 || !ctx.settlement || !ctx.settlement.townTrade;
            const gains = Guests._mod(player, full ? C.meal.effects : C.meal.thin);
            return { ok: true, kind: 'meal', text: full ? L.mealYes : L.mealThin, hours: _num(C.meal.hours, 1), gains, served, regard: _num(C.regard.meal, 4) };
        }
        if (what === 'stay') {
            const rec = Guests.invite(player, world, ctx.key, { host: who, kind: 'stay', nights: _num(C.stay.nights, 1) });
            const text = welcome && welcome.ok ? (L[welcome.kind] || L.stayYes) : ctx.lord ? _fill(L.lordYes, { who }) : L.stayYes;
            return { ok: true, kind: 'stay', text, hours: 0, until: rec.until, regard: _num(C.regard.stay, 2) };
        }
        return { ok: false, text: '…', hours: 0, regard: 0 };
    },
};
