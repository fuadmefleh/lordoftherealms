// ============================================
// MAIL — the letters the player sends, and what comes of them
// ============================================
// From Journal → Letters → Write: pick a recipient (the lords of the realms,
// rival Houses, your spouse, children abroad or held, friends and loves,
// townsfolk you have spoken with, merchant houses), a kind of letter
// (data/couriers.json kinds: courtesy, a gift of gold or goods, a favour, a
// proposal, an apology, a threat, a love letter, a release negotiation for a
// held child, a warning) and a courier: a house with a station in the town
// you stand in (systems/couriers.js — its price, speed and reliability), your
// own courier house (free), or your own rider / a companion from anywhere.
//
// The letter rides for real days (distance, roads, season). On the day it
// is due it may be delayed, lost, robbed (enclosures stolen: dangerous roads,
// raiders, outlaw lairs, war — guards help), or intercepted and read (the
// recipient's enemies, your rival Houses, a busybody): a threat read by its
// target's enemy pleases them, a warning or proposal read by the realm it
// concerns angers it, a married soul's love letter becomes a scandal
// (Gossip 'affair', the spouse's affection) or a blackmailer's letter.
// Delivered, the recipient reacts by their regard for you (lord opinion and
// reputation, rival feud, affection, a townsperson's disposition, a house's
// rivalry) and the kind — real state moves: lord memory (rememberDeed),
// disposition, affection, feud, reputation, a held child freed — with
// diminishing returns per recipient (courtesy only helps so much; favours
// once in a while). A reply rides back on the same terms: plain answers are
// filed in the Letters archive (Answered), ones that need a decision (a pact
// to seal, a ransom to pay) come to the inbox (systems/courtLetters.js kinds
// with `mail: true`, applied here by answerReply).
//
// Every flow of gold goes through the Ledger (postage, mailGifts,
// mailReceipts, hushMoney, diplomacy). Each letter's fate draws from its own
// seeded stream (world seed, letter id, day); the main RNG is untouched by
// the daily tick. State on player.mail (saved). No import-time effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { NPCLords } from '../world/npcLords.js';
import { Couriers } from './couriers.js';
import { CourtLetters } from './courtLetters.js';
import { House } from './house.js';
import { Throne } from './throne.js';
import { Relationships } from './relationships.js';
import { Townsfolk } from './townsfolk.js';
import { NpcDisposition } from './npcDisposition.js';
import { Upbringing } from './upbringing.js';
import { MerchantHouses } from './merchantHouses.js';
import { Gossip } from './gossip.js';
import { Ledger } from './ledger.js';
import { Companions } from './companions.js';
import { Holdings } from './holdings.js';
import { MailVoice } from './mailVoice.js';
import { Whispers } from './whispers.js';
import { RivalAgents } from './rivalAgents.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Names } from '../core/names.js';
// (a letter in the player's own words, answered by the AI brain: systems/letterChat.js)
import { LetterChat } from './letterChat.js';

// What a learned intel key means in a sentence ('military' → 'armies'), joined "a, b and c"
const _INTEL_WORDS = { ruler: 'ruler', military: 'armies', diplomacy: 'alliances and quarrels', economy: 'trade and treasury' };
function _intelPhrase(keys) {
    const w = keys.map(k => _INTEL_WORDS[k] || k);
    return w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}` : w.join('');
}

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _key = (q, r) => `${q},${r}`;

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

const MAIL_DEFAULTS = {
    maxInTransit: 4, perDay: 2, recentDays: 45, courtesyCap: 2, maxSent: 30,
    lossShare: 0.5, delay: 0.1, winterDelay: 0.2, delayDays: [1, 3],
    intercept: 0.04, interceptPerEnemy: 0.04, interceptRival: 0.05, interceptMax: 0.25, foundOut: 0.6,
    ownRiderFee: 12, ownRiderPerHex: 0.5, ownRiderReliability: 0.85, ownRiderHexes: 8,
    replyChance: 0.85, replyExpiry: 14, favourDays: 60, giftPresets: [25, 100, 300], ransom: [150, 2000], freeReleaseRegard: 45,
    // Unprompted letters and the hooks a letter may carry (data/couriers.json → config.mail.voice)
    voice: {
        firstDay: 12, gap: [9, 22], minRegard: 15, maxPending: 2, eventDays: 40, eventMax: 2,
        requestChance: 0.35, requestDays: 45, requestQty: [4, 10],
        inviteChance: 0.18, inviteDays: 40, inviteDeadline: 30, visitDisposition: 8, visitScore: 5, visitApproval: 4, visitAffection: 6, missedVisit: -3,
        feastChance: 0.2, tipChance: 0.6, tipSuspicion: 45, lairTipChance: 0.5, secretChance: 0.35,
        coinChance: 0.12, goodsChance: 0.15, tokenChance: 0.35, maxKeepsakes: 20,
        requestThanks: 6, requestRefused: -2, requestLapsed: -3,
    },
};

export const Mail = {

    // ──────────── DATA ────────────

    config() {
        const m = Couriers.config().mail || {};
        return { ...MAIL_DEFAULTS, ...m, voice: { ...MAIL_DEFAULTS.voice, ...(m.voice || {}) } };
    },

    kinds() {
        return Couriers.data().kinds || {};
    },

    kind(id) {
        return this.kinds()[id] || null;
    },

    recipientTypes() {
        return Couriers.data().recipientTypes || {};
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            outbox: [], replies: [], sent: [], recent: {}, favours: {}, nextId: 1, today: { day: -1, n: 0 },
            corr: {}, visits: [], keepsakes: [], heard: {}, nextUnprompted: null,
            stats: { sent: 0, delivered: 0, lost: 0, robbed: 0, intercepted: 0, replies: 0, delayed: 0, unprompted: 0 },
        };
    },

    state(player) {
        if (!player) return this._blank();
        let st = player.mail;
        if (!st || typeof st !== 'object') {
            player.mail = this._blank();
            return player.mail;
        }
        const blank = this._blank();
        for (const k of ['outbox', 'replies', 'sent', 'visits', 'keepsakes']) if (!Array.isArray(st[k])) st[k] = [];
        for (const k of ['recent', 'favours', 'corr', 'heard']) if (!st[k] || typeof st[k] !== 'object' || Array.isArray(st[k])) st[k] = {};
        if (st.nextUnprompted === undefined) st.nextUnprompted = null;
        if (!(st.nextId > 0)) st.nextId = 1;
        if (!st.today || typeof st.today !== 'object') st.today = { day: -1, n: 0 };
        st.stats = { ...blank.stats, ...(st.stats || {}) };
        return st;
    },

    serialize(player) {
        return player && player.mail ? JSON.parse(JSON.stringify(player.mail)) : null;
    },

    /** Backfill for older saves (nothing sent yet). */
    loadState(player) {
        if (!player) return;
        if (player.mail) this.state(player);
        else player.mail = this._blank();
    },

    // ──────────── PLACES ────────────

    /** A realm's chief town: its capital, else its biggest. */
    _seat(world, kid) {
        if (!kid) return null;
        const rank = { capital: 3, city: 2, town: 1, village: 0 };
        let best = null;
        for (const t of Couriers.towns(world).values()) {
            if (t.kingdomId !== kid) continue;
            if (!best || (rank[t.type] || 0) > (rank[best.type] || 0) || ((rank[t.type] || 0) === (rank[best.type] || 0) && t.population > best.population)) best = t;
        }
        return best;
    },

    _townAt(world, q, r) {
        if (!Number.isFinite(q) || !Number.isFinite(r) || !world || typeof world.getTile !== 'function') return null;
        const t = world.getTile(q, r);
        if (!t || !t.settlement) return { key: _key(q, r), q, r, name: 'the countryside', kingdomId: null };
        return { key: _key(q, r), q, r, name: t.settlement.name || 'a town', kingdomId: t.settlement.kingdom || null };
    },

    // ──────────── RECIPIENTS ────────────

    _lordRec(world, k, extra = {}) {
        const seat = this._seat(world, k.id);
        if (!seat) return null;
        return {
            key: `lord:${k.id}`, type: 'lord', kingdomId: k.id, name: `${k.lord.name || k.ruler || 'The ruler'} of ${Names.realm(k.name)}`,
            sub: k.name, q: seat.q, r: seat.r, townKey: seat.key, place: seat.name, ...extra,
        };
    },

    _heldChildren(player, kid) {
        return ((player && player.children) || []).filter(c => c && c.isAlive !== false && Upbringing.ensure(c).heldBy && Upbringing.ensure(c).heldBy.kingdomId === kid)
            .map(c => ({ childId: c.id, name: c.firstName || 'your child' }));
    },

    /** Everyone the player could write to: [{ key, type, name, sub, q, r, townKey, place, kingdomId, ... }]. */
    recipients(player, world) {
        if (!player || !world) return [];
        const out = [];
        const ruled = Throne.ruledKingdom(player, world);
        for (const k of (world.kingdoms || []).filter(x => x && x.isAlive !== false && x.lord)) {
            if (ruled && ruled.id === k.id) continue;
            const r = this._lordRec(world, k, { held: this._heldChildren(player, k.id), enemies: (k.wars || []).slice() });
            if (r) out.push(r);
        }
        for (const rv of Object.values((player.house && player.house.rivals) || {})) {
            if (!rv || !rv.kingdomId) continue;
            const k = world.getKingdom(rv.kingdomId);
            const seat = k && k.isAlive !== false ? this._seat(world, k.id) : null;
            if (!seat) continue;
            out.push({ key: `rival:${rv.kingdomId}`, type: 'rival', kingdomId: rv.kingdomId, name: rv.name || 'A rival House', sub: `feud ${Math.round(_num(rv.feud))}`, q: seat.q, r: seat.r, townKey: seat.key, place: seat.name });
        }
        const sp = CourtLetters._spouse(player);
        if (sp && Number.isFinite(sp.settlementQ)) {
            const t = this._townAt(world, sp.settlementQ, sp.settlementR);
            out.push({ key: `spouse:${sp.id}`, type: 'spouse', npcId: sp.id, kingdomId: sp.kingdomId || null, name: `${sp.firstName || 'Your spouse'}${sp.dynasty ? ` ${sp.dynasty}` : ''}`, sub: 'your spouse', q: t.q, r: t.r, townKey: t.key, place: t.name });
        }
        const seen = new Set();
        for (const a of CourtLetters._childrenAbroad(player, world)) {
            const seat = this._seat(world, a.kingdom.id);
            if (!seat) continue;
            seen.add(a.child.id);
            out.push({ key: `child:${a.child.id}`, type: 'child', childId: a.child.id, kingdomId: a.kingdom.id, name: a.child.firstName || 'Your child', sub: `at the court of ${Names.realm(a.kingdom.name)}`, q: seat.q, r: seat.r, townKey: seat.key, place: seat.name });
        }
        for (const c of (player.children || [])) {
            if (!c || c.isAlive === false || seen.has(c.id)) continue;
            const held = Upbringing.ensure(c).heldBy;
            const k = held && world.getKingdom(held.kingdomId);
            const seat = k ? this._seat(world, k.id) : null;
            if (!seat) continue;
            out.push({ key: `child:${c.id}`, type: 'child', childId: c.id, kingdomId: k.id, name: c.firstName || 'Your child', sub: `held at ${k.name}`, held: true, q: seat.q, r: seat.r, townKey: seat.key, place: seat.name });
        }
        // Companions away from the party: governing a holding, dismissed, parted ways
        const away = new Set();
        for (const a of Companions.away(player, world)) {
            const npc = a.npc;
            if (npc.id === player.spouse) continue;
            away.add(npc.id);
            const t = this._townAt(world, a.q, a.r);
            const sub = a.status === 'governing' ? `governing ${t.name}` : a.status === 'deserted' ? 'left your company' : a.status === 'dismissed' ? 'dismissed from your company' : 'away from your company';
            out.push({ key: `companion:${npc.id}`, type: 'companion', npcId: npc.id, kingdomId: t.kingdomId || npc.kingdomId || null, name: `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`, sub, status: a.status, governing: npc.governing || null, q: t.q, r: t.r, townKey: t.key, place: t.name });
        }
        const npcUids = new Set();
        if (player.relationships) {
            for (const npc of Relationships.getKnownNPCs(player)) {
                if (!npc || npc.isAlive === false || npc.id === player.spouse || away.has(npc.id) || !Number.isFinite(npc.settlementQ)) continue;
                if (npc.folkUid) npcUids.add(npc.folkUid);
                const rel = player.relationships[npc.id] || {};
                const t = this._townAt(world, npc.settlementQ, npc.settlementR);
                out.push({ key: `npc:${npc.id}`, type: 'npc', npcId: npc.id, kingdomId: npc.kingdomId || null, name: `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`, sub: rel.romantic ? 'your love' : String((Relationships.getRelationLabel(_num(rel.score)) || {}).label || 'an acquaintance').toLowerCase(), q: t.q, r: t.r, townKey: t.key, place: t.name, romantic: !!rel.romantic });
            }
        }
        for (const a of Townsfolk.acquaintances(world)) {
            const p = a.person;
            if (!p || p.died != null || a.status.kind !== 'here' || !a.folk || !Number.isFinite(a.folk.q)) continue;
            if (npcUids.has(Relationships.folkUid(a.folk, p))) continue;
            const t = this._townAt(world, a.folk.q, a.folk.r);
            out.push({ key: `folk:${a.folk.q},${a.folk.r}:${p.id}`, type: 'folk', personId: p.id, kingdomId: t.kingdomId, name: Townsfolk.name(p), sub: Townsfolk.roleTitle(p), q: t.q, r: t.r, townKey: t.key, place: a.town || t.name });
        }
        for (const h of MerchantHouses.activeRivals(player)) {
            if (!h.seat) continue;
            const t = this._townAt(world, h.seat.q, h.seat.r);
            out.push({ key: `house:${h.id}`, type: 'house', houseId: h.id, kingdomId: t.kingdomId, name: h.name, sub: `merchant house of ${h.seat.name}`, q: t.q, r: t.r, townKey: t.key, place: h.seat.name });
        }
        return out;
    },

    /** One recipient by key (as recipients() would give it), or null. */
    recipient(player, world, key) {
        if (!key) return null;
        const [type, rest] = [String(key).split(':')[0], String(key).slice(String(key).indexOf(':') + 1)];
        if (type === 'lord') {
            const k = world.getKingdom(rest);
            return k && k.isAlive !== false && k.lord ? this._lordRec(world, k, { held: this._heldChildren(player, k.id), enemies: (k.wars || []).slice() }) : null;
        }
        return this.recipients(player, world).find(r => r.key === key) || null;
    },

    /** The live state behind a recipient: { kingdom, lord, rival, npc, rel, person, folk, house, child }. */
    _subject(player, world, to) {
        const out = {};
        if (to.kingdomId && world.getKingdom) out.kingdom = world.getKingdom(to.kingdomId);
        if (to.type === 'lord') out.lord = out.kingdom && out.kingdom.lord;
        if (to.type === 'rival') out.rival = ((player.house && player.house.rivals) || {})[to.kingdomId] || null;
        if (to.npcId != null) { out.npc = Relationships.getNPC(to.npcId); out.rel = player.relationships ? Relationships.getRelationship(player, to.npcId) : null; }
        if (to.type === 'folk') {
            const t = world.getTile && world.getTile(to.q, to.r);
            out.folk = t && t.settlement && t.settlement.folk;
            out.person = out.folk ? Townsfolk.get(out.folk, to.personId) : null;
        }
        if (to.type === 'house') out.house = MerchantHouses.rivals(player).find(h => h.id === to.houseId) || null;
        if (to.childId != null) out.child = (player.children || []).find(c => c && c.id === to.childId) || null;
        if (to.type === 'companion' && out.npc) out.companion = Companions.ensure(out.npc, world);
        return out;
    },

    /** How the recipient regards the player (−100..100). */
    regard(player, world, to) {
        const s = this._subject(player, world, to);
        switch (to.type) {
            case 'lord': return s.kingdom ? CourtLetters.regard(player, world, s.kingdom) : 0;
            case 'rival': return 20 - _num(s.rival && s.rival.feud);
            case 'spouse':
            case 'npc': return s.rel ? Math.round(_num(s.rel.score) * 0.6 + _num(s.rel.affection) * 0.4) : 0;
            case 'child': return 50;
            case 'folk': return s.person && s.person.mem ? _num(s.person.mem.disposition, 50) - 50 : 0;
            case 'house': return 30 - _num(s.house && s.house.rivalry);
            case 'companion': return s.companion ? Math.round(_num(s.companion.approval, 50) - 50) : 0;
        }
        return 0;
    },

    // ──────────── WHAT TO WRITE ────────────

    /** Letters sent to this key within the window (diminishing returns). */
    _recentCount(player, key, day) {
        const days = this.state(player).recent[key] || [];
        return days.filter(d => day - d < this.config().recentDays).length;
    },

    /** The kinds of letter open for a recipient: [{ id, name, icon, desc, ok, why }]. */
    kindOptions(player, world, to) {
        const out = [];
        if (!to) return out;
        const day = _day(world);
        const st = this.state(player);
        for (const [id, K] of Object.entries(this.kinds())) {
            // (a letter in your own words has its own row: LetterChat.canWrite)
            if (!K || typeof K !== 'object' || K.free || !(K.to || []).includes(to.type)) continue;
            let ok = true;
            let why = '';
            if (K.needsHeld && !(to.held && to.held.length)) continue;
            if (K.needsEnemy && to.type === 'lord' && !(to.enemies && to.enemies.length)) continue;
            if (id === 'favour') {
                const last = st.favours[to.key];
                if (last != null && day - last < this.config().favourDays) { ok = false; why = `You asked ${to.name} a favour on day ${last}. Wait until day ${last + this.config().favourDays}.`; }
            }
            if (id === 'proposal' && to.type === 'npc') {
                if (player.spouse) { ok = false; why = 'You are already married.'; }
                else if (!to.romantic) { ok = false; why = `${to.name} is not your love — court them first.`; }
            }
            if (id === 'ransom' && to.type === 'lord' && !(to.held || []).length) { ok = false; why = 'This court holds no child of yours.'; }
            if (id === 'proposal' && to.type === 'lord' && CourtLetters.atWar(player, world, to.kingdomId)) { ok = false; why = 'Not while you are at war.'; }
            out.push({ id, name: K.name || id, icon: K.icon || '✉️', desc: K.desc || '', enclose: !!K.enclose, ok, why });
        }
        return out;
    },

    /** Goods the player could enclose: the six most valuable stacks. */
    itemOptions(player) {
        const inv = (player && player.inventory) || {};
        return Object.entries(inv).filter(([id, q]) => id !== 'gold' && q > 0)
            .map(([id, q]) => ({ id, qty: q, value: PlayerInventory.goodValue(id) }))
            .filter(x => x.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).slice(0, 6);
    },

    /**
     * The ways to send a letter to `to` from where the player stands:
     * [{ id, name, icon, own, price, days, reliability, guardCover, offNetwork, danger }].
     * Houses with a station in this town, your own house there (free), and
     * always your own rider (or a companion, if one travels with you).
     */
    courierOptions(player, world, to) {
        if (!player || !world || !to) return [];
        const M = this.config();
        const here = Couriers.townHere(world, player);
        const from = here || { q: player.q, r: player.r, key: _key(player.q, player.r), kingdomId: null };
        const dest = { q: to.q, r: to.r };
        const danger = Couriers.routeDanger(world, player, from, dest, from.kingdomId, to.kingdomId);
        const out = [];
        if (here) {
            for (const c of Couriers.servingAt(world, here.key, here.kingdomId)) {
                out.push({ ...Couriers.quote(world, c, from, dest, to.townKey), danger });
            }
        }
        const dist = Hex.wrappingDistance(from.q, from.r, to.q, to.r, world.width || 0);
        const companions = Array.isArray(player.travelParty) ? player.travelParty.length : 0;
        const fee = Math.round(M.ownRiderFee + dist * M.ownRiderPerHex);
        out.push({
            id: 'own', name: companions ? 'A companion rides it' : 'Your own rider', icon: '🐴', own: false, rider: true,
            price: companions ? Math.round(fee / 2) : fee, days: Couriers.travelDays(world, from, dest, M.ownRiderHexes),
            reliability: companions ? Math.min(0.95, M.ownRiderReliability + 0.05) : M.ownRiderReliability,
            guardCover: companions ? 0.3 : 0, offNetwork: false, danger,
        });
        return out;
    },

    // ──────────── SENDING ────────────

    /**
     * Send a letter. opts { to (recipient key), kind, courier (option id),
     * gold, item (inventory id), childId (ransom) } → { success, letter, text } | { success: false, reason }.
     */
    send(player, world, opts = {}) {
        const M = this.config();
        const st = this.state(player);
        const day = _day(world);
        const to = this.recipient(player, world, opts.to);
        if (!to) return { success: false, reason: 'You have no way to reach them.' };
        const K = this.kind(opts.kind);
        const kindOpt = K && K.free ? LetterChat.canWrite(player, world, to) : this.kindOptions(player, world, to).find(k => k.id === opts.kind);
        if (!K || !kindOpt) return { success: false, reason: 'That is not a letter you can send them.' };
        if (!kindOpt.ok) return { success: false, reason: kindOpt.why };
        if (st.outbox.length >= M.maxInTransit) return { success: false, reason: `${M.maxInTransit} letters are already on the road; wait for one to arrive.` };
        if (st.today.day === day && st.today.n >= M.perDay) return { success: false, reason: `You have written ${M.perDay} letters today. Your hand aches.` };
        const courier = this.courierOptions(player, world, to).find(c => String(c.id) === String(opts.courier));
        if (!courier) return { success: false, reason: 'Choose a courier.' };
        // Your own words (systems/letterChat.js): checked here, coin may go with them
        const text = K.free ? LetterChat.clean(opts.text) : null;
        if (K.free && LetterChat.checkText(text)) return { success: false, reason: LetterChat.checkText(text) };
        const gold = K.enclose || K.free ? Math.max(0, Math.round(_num(opts.gold))) : 0;
        let item = null;
        if (K.enclose && opts.item) {
            const have = _num(player.inventory && player.inventory[opts.item]);
            if (have < 1) return { success: false, reason: 'You no longer have that.' };
            item = { id: opts.item, qty: 1, value: PlayerInventory.goodValue(opts.item) };
        }
        if (K.enclose && !gold && !item) return { success: false, reason: 'Enclose gold or one of your goods.' };
        if (_num(player.gold) < courier.price + gold) return { success: false, reason: `You need ${courier.price + gold} gold.` };
        let childId = null;
        if (opts.kind === 'ransom') {
            const held = (to.held || []).find(h => opts.childId == null || h.childId === opts.childId);
            if (!held) return { success: false, reason: 'This court holds no child of yours.' };
            childId = held.childId;
        }
        let enemyId = null;
        if (opts.kind === 'warning' && to.type === 'lord') {
            const foes = (to.enemies || []).map(id => world.getKingdom(id)).filter(k => k && k.isAlive !== false);
            if (!foes.length) return { success: false, reason: `${to.name} has no enemy to warn of.` };
            foes.sort((a, b) => _num(b.military) - _num(a.military) || String(a.id).localeCompare(String(b.id)));
            enemyId = foes[0].id;
        }

        // Pay, enclose
        if (courier.price > 0) { player.gold = _num(player.gold) - courier.price; Ledger.record(player, 'postage', -courier.price); }
        if (gold > 0) { player.gold = _num(player.gold) - gold; Ledger.record(player, 'mailGifts', -gold); }
        if (item) {
            player.inventory[item.id] -= 1;
            if (player.inventory[item.id] <= 0) delete player.inventory[item.id];
        }
        if (courier.id !== 'own') Couriers.recordLetter(world, courier.id, courier.price);

        const here = Couriers.townHere(world, player);
        const letter = {
            id: st.nextId++, kind: opts.kind, to: { ...to }, from: here ? { q: here.q, r: here.r, name: here.name, kingdomId: here.kingdomId } : { q: player.q, r: player.r, name: 'the road', kingdomId: null },
            courier: { id: courier.id, name: courier.name, reliability: courier.reliability, guardCover: courier.guardCover || 0, own: !!courier.own },
            sentDay: day, days: courier.days, arriveDay: day + courier.days, danger: courier.danger || 0,
            gold, item, childId, enemyId, postage: courier.price, status: 'transit', delayed: false,
            ...(text ? { text } : {}),
        };
        st.outbox.push(letter);
        if (!st.recent[to.key]) st.recent[to.key] = [];
        st.recent[to.key] = st.recent[to.key].filter(d => day - d < M.recentDays);
        st.recent[to.key].push(day);
        if (opts.kind === 'favour') st.favours[to.key] = day;
        st.today = st.today.day === day ? { day, n: st.today.n + 1 } : { day, n: 1 };
        st.stats.sent++;
        return { success: true, letter, text: `${K.icon || '✉️'} Your letter to ${to.name} rides with ${courier.name}: due at ${to.place} in about ${courier.days} day${courier.days === 1 ? '' : 's'}.` };
    },

    // ──────────── THE DAY ────────────

    _rng(world, id, day) {
        const seed = (world && world.generationParams && world.generationParams.seed) || 0;
        return Utils.seededRandom((_hash(`${seed}:mail:${id}:${day}`) % 233279) + 1);
    },

    /** Letters due today meet their fate; replies due come home. → { notices, delivered, replies } */
    processDay(world, player) {
        const out = { notices: [], delivered: [], replies: [] };
        if (!world || !player) return out;
        // (a spouse or a governing companion away may write first, before the player ever has)
        if (!player.mail) {
            Utils.withRng(this._rng(world, 'unprompted', _day(world)), () => this._unprompted(world, player, out));
            return out;
        }
        const st = this.state(player);
        const day = _day(world);
        for (const L of st.outbox.slice()) {
            if (day < L.arriveDay) continue;
            Utils.withRng(this._rng(world, `L${L.id}`, day), () => this._resolve(world, player, L, out));
        }
        for (const R of st.replies.slice()) {
            if (day < R.due) continue;
            Utils.withRng(this._rng(world, `R${R.id}`, day), () => this._reply(world, player, R, out));
        }
        this._visits(world, player, out);
        LetterChat.processDay(world, player, out);
        Utils.withRng(this._rng(world, 'unprompted', day), () => this._unprompted(world, player, out));
        return out;
    },

    _done(player, L, status, text) {
        const st = this.state(player);
        L.status = status;
        st.outbox = st.outbox.filter(x => x !== L);
        st.sent.unshift({ id: L.id, kind: L.kind, to: L.to.name, toType: L.to.type, place: L.to.place, sentDay: L.sentDay, day: L.resolvedDay, status, tone: L.tone || null, text: text || '', courier: L.courier.name, intercepted: L.intercepted && L.intercepted.foundOut ? L.intercepted.name : null });
        if (st.sent.length > this.config().maxSent) st.sent.length = this.config().maxSent;
    },

    _resolve(world, player, L, out) {
        const M = this.config();
        const D = Couriers.config().danger;
        const st = this.state(player);
        const day = _day(world);
        const K = this.kind(L.kind) || {};
        L.resolvedDay = day;
        // Held up on the road (once)
        if (!L.delayed && Utils.random() < M.delay + (world.season === 'Winter' ? M.winterDelay : 0)) {
            L.delayed = true;
            L.arriveDay = day + Utils.randInt(M.delayDays[0], M.delayDays[1]);
            st.stats.delayed++;
            return;
        }
        // Lost
        if (Utils.random() < (1 - _num(L.courier.reliability, 0.85)) * M.lossShare) {
            st.stats.lost++;
            if (L.courier.id !== 'own') Couriers.recordLoss(world, L.courier.id, 1);
            const text = `Your letter to ${L.to.name} never arrived: ${L.courier.name} lost it on the road${L.gold || L.item ? ', and what it carried' : ''}.`;
            this._done(player, L, 'lost', text);
            out.notices.push({ icon: '📭', title: 'A Letter Lost', text, type: 'warning' });
            return;
        }
        // Robbed (a letter with a rider on the map met its road already: systems/courierRiders.js)
        if (!L.rider && L.danger > 0 && Utils.random() < L.danger * D.robChance * (1 - _num(L.courier.guardCover))) {
            if (this.robLetter(world, player, L, out)) return;
        }
        // Intercepted and read (by a warring realm's agents on the rider's road, or here)
        const by = L.road && L.road.intercepted ? { ...L.road.intercepted } : this._interceptor(world, player, L, !!L.rider);
        if (by) {
            st.stats.intercepted++;
            L.intercepted = { ...by, foundOut: Utils.random() < M.foundOut };
            this._intercepted(world, player, L, out);
        }
        // Delivered: the recipient reacts
        const to = this.recipient(player, world, L.to.key) || L.to;
        const sub = this._subject(player, world, to);
        if ((to.type === 'npc' || to.type === 'spouse' || to.type === 'companion') && (!sub.npc || sub.npc.isAlive === false)) {
            this._done(player, L, 'undelivered', `Your letter to ${L.to.name} came back: there was no one to give it to.`);
            return;
        }
        if (to.type === 'folk' && (!sub.person || sub.person.died != null)) {
            this._done(player, L, 'undelivered', `Your letter to ${L.to.name} came back: they are gone.`);
            return;
        }
        st.stats.delivered++;
        // Your own words: the AI brain answers (systems/letterChat.js); off, they are read as the nearest plain kind
        const free = L.kind === 'free' ? LetterChat.deliver(world, player, L, to, sub) : null;
        const LK = free && free.fallback ? { ...L, kind: free.fallback } : L;
        const r = free && !free.fallback ? free : this._react(world, player, LK, to, sub, free ? (this.kind(free.fallback) || {}) : K);
        L.tone = r.tone;
        this._done(player, L, 'delivered', r.text);
        out.delivered.push(L);
        if (r.reply && Utils.random() < (r.reply.always ? 1 : M.replyChance)) {
            const R = { id: L.id, due: day + Math.max(1, L.days), sentDay: day, from: { ...L.to }, back: L.from ? { ...L.from } : null, kind: L.kind, tone: r.tone, ...r.reply };
            R.inReplyTo = L.kind;
            if (R.kind === 'plain' || !R.kind) R.kind = 'plain';
            if (R.free) LetterChat.write(world, player, R);
            else this._write(world, player, R, { L: LK, to, sub });
            st.replies.push(R);
        } else if (!r.reply) {
            out.notices.push({ icon: K.icon || '✉️', title: 'A Letter Delivered', text: r.text, type: 'info' });
        }
    },

    /**
     * The road robs a letter's rider: the enclosure is taken (L.stolen), the
     * house's name suffers, and half the time the letter is lost with it.
     * ctx { by, where }: who and where (a rider on the map). → true when the letter ended.
     */
    robLetter(world, player, L, out, ctx = {}) {
        const st = this.state(player);
        st.stats.robbed++;
        if (L.courier.id !== 'own') Couriers.recordLoss(world, L.courier.id, 2);
        const had = L.gold || L.item;
        L.stolen = { gold: L.gold, item: L.item };
        L.gold = 0;
        L.item = null;
        L.road = { ...(L.road || {}), robbed: { by: ctx.by || null, where: ctx.where || null, q: ctx.q, r: ctx.r, day: _day(world) } };
        const how = ctx.by ? ` by ${ctx.by}${ctx.where ? ` near ${ctx.where}` : ''}` : ' on the road';
        if (Utils.random() < 0.5) {
            const text = `The rider carrying your letter to ${L.to.name} was robbed${how}${had ? ' — and what you enclosed is gone' : ''}. The letter never arrived.`;
            L.resolvedDay = _day(world);
            this._done(player, L, 'robbed', text);
            out.notices.push({ icon: '🗡️', title: 'A Rider Robbed', text, type: 'warning' });
            return true;
        }
        if (had) out.notices.push({ icon: '🗡️', title: 'A Rider Robbed', text: `The rider carrying your letter to ${L.to.name} was robbed${how}; the letter rides on, but what you enclosed was taken.`, type: 'warning' });
        return false;
    },

    /**
     * Who reads the letter on the way, if anyone: { kind: 'realm'|'rival'|'busybody', kingdomId, name }.
     * roadOnly: a rider on the map met the warring realms' agents on its road already.
     */
    _interceptor(world, player, L, roadOnly = false) {
        const M = this.config();
        const cands = [];
        const k = L.to.kingdomId && world.getKingdom ? world.getKingdom(L.to.kingdomId) : null;
        if (!roadOnly && k && (L.to.type === 'lord' || L.to.type === 'rival' || L.to.type === 'child')) {
            for (const eid of k.wars || []) {
                const e = world.getKingdom(eid);
                if (e && e.isAlive !== false && e.lord) cands.push({ kind: 'realm', kingdomId: e.id, name: `agents of ${e.name}` });
            }
        }
        const rivals = Object.values((player.house && player.house.rivals) || {}).filter(r => r && r.kingdomId && r.kingdomId !== L.to.kingdomId && _num(r.feud) >= 30);
        for (const r of rivals) cands.push({ kind: 'rival', kingdomId: r.kingdomId, name: `the spies of ${r.name}` });
        let p = M.intercept + M.interceptPerEnemy * cands.filter(c => c.kind === 'realm').length + (rivals.length ? M.interceptRival : 0);
        p *= Math.max(0.3, 1.2 - _num(L.courier.reliability, 0.85));
        if (Utils.random() >= Math.min(M.interceptMax, p)) return null;
        if (!cands.length || L.kind === 'love') return { kind: 'busybody', kingdomId: null, name: 'a busybody at the post house' };
        return Utils.randPick(cands);
    },

    _intercepted(world, player, L, out) {
        const by = L.intercepted;
        const enemy = by.kingdomId && world.getKingdom ? world.getKingdom(by.kingdomId) : null;
        const elord = enemy && enemy.lord;
        let line = '';
        if (L.kind === 'threat' && L.to.type === 'lord' && elord && by.kind === 'realm') {
            NPCLords.rememberDeed(world, elord, 'letter_shared_enemy', { note: `against ${L.to.sub || L.to.name}` });
            line = `${enemy.name}'s agents read your threat to ${L.to.name} — and liked it.`;
        } else if ((L.kind === 'warning' || L.kind === 'proposal') && elord) {
            NPCLords.rememberDeed(world, elord, 'letter_read_by_enemy', { note: `to ${L.to.sub || L.to.name}` });
            L.compromised = true;
            line = `${by.name} read your ${L.kind === 'warning' ? 'warning' : 'proposal'} to ${L.to.name}. ${enemy.name} will not forget it.`;
        } else if (L.kind === 'love' && player.spouse && L.to.type !== 'spouse') {
            if (Utils.random() < 0.5) {
                this._blackmail(world, player, L, out);
                return;
            }
            this._scandal(world, player, L.to);
            line = `Your love letter to ${L.to.name} was opened and read aloud: the whole town is talking, and your spouse has heard.`;
            L.intercepted.foundOut = true;
        } else {
            line = `The seal of your letter to ${L.to.name} was found lifted: ${by.name} read it.`;
        }
        if (L.intercepted.foundOut && line) out.notices.push({ icon: '🔓', title: 'A Letter Opened', text: line, type: 'warning' });
    },

    /** A love letter read by others: talk in the town, and the spouse's anger. */
    _scandal(world, player, to) {
        const t = world.getTile && world.getTile(to.q, to.r);
        Gossip.spreadDeed(player, world, 'affair', { q: to.q, r: to.r, location: to.place, kingdom: t && t.settlement ? t.settlement.kingdom : to.kingdomId, victim: to.name });
        if (player.spouse && player.relationships) {
            const rel = Relationships.getRelationship(player, player.spouse);
            rel.affection = _clamp(_num(rel.affection) - 15, 0, 100);
        }
    },

    _blackmail(world, player, L, out) {
        const day = _day(world);
        const K = CourtLetters.kind('mail_blackmail') || {};
        const amount = Math.round(_clamp(_num(player.gold) * 0.08, 40, 400));
        const vars = { lover: L.to.name, amount, from: 'An unsigned hand' };
        CourtLetters.deliver(player, {
            id: 0, kind: 'mail_blackmail', day, expires: day + _num(K.expiry, 8),
            from: { type: 'mail', name: 'An unsigned hand' }, key: `blackmail:${L.id}`, vars,
            data: { amount, to: { ...L.to } }, subject: _fill(K.subject, vars), body: _fill(K.body, vars), read: false,
        });
        out.notices.push({ icon: '🐍', title: 'An Unsigned Letter', text: `Someone read your letter to ${L.to.name}, and wants paying. Journal → Letters.`, type: 'warning' });
    },

    // ──────────── THE RECIPIENT'S REACTION ────────────

    _tone(regard, warmAt = 15, hostileAt = -25) {
        return regard >= warmAt ? 'warm' : regard <= hostileAt ? 'hostile' : 'cool';
    },

    _adjustFolk(player, person, delta) {
        if (!person) return 0;
        if (!person.mem) person.mem = { timesSpoken: 1, disposition: 50, giftsReceived: 0, threatened: false };
        return NpcDisposition.adjustDisposition({ _dialogMemory: person.mem, type: person.role || 'villager' }, delta, player);
    },

    _armyStrength(player) {
        return ((player && player.army) || []).reduce((s, u) => s + _num(u && u.strength, _num(u && u.count, 1)), 0);
    },

    /**
     * Apply what the letter does to its recipient. → { tone, text, reply }
     * reply: { kind: 'plain'|'mail_proposal'|'mail_ransom', body, gold, data, always }
     */
    _react(world, player, L, to, s, K) {
        const day = _day(world);
        const st = this.state(player);
        const M = this.config();
        const regard = this.regard(player, world, to);
        // Earlier letters to the same person this season (not this one)
        const earlier = (st.recent[to.key] || []).filter(d => d < L.sentDay && L.sentDay - d < M.recentDays).length
            + Math.max(0, (st.recent[to.key] || []).filter(d => d === L.sentDay).length - 1);
        const f = Math.pow(0.5, earlier);
        const lord = s.lord || (s.kingdom && s.kingdom.lord);
        const kid = to.kingdomId;
        const remember = (deed, opts = {}) => { if (lord) NPCLords.rememberDeed(world, lord, deed, { note: K.name, ...opts }); };
        const rep = (n) => { if (kid && n) { if (!player.reputation) player.reputation = {}; player.reputation[kid] = _clamp(_num(player.reputation[kid]) + n, -100, 100); } };
        const feud = (n, why) => { if (kid && n) House.accrueRivalFeud(player, world, kid, Math.round(n), why); };
        const rel = s.rel;
        const bump = (field, n, lo = -100, hi = 100) => { if (rel && n) rel[field] = Math.round(_clamp(_num(rel[field]) + n, lo, hi) * 10) / 10; };
        const rivalry = (n) => { if (s.house && n) s.house.rivalry = Math.round(_clamp(_num(s.house.rivalry) + n, 0, 100)); };
        const worth = _num(L.gold) + (L.item ? _num(L.item.value) * _num(L.item.qty, 1) : 0);
        // A companion away: their approval of you (systems/companions.js)
        const approve = (n, why) => { if (to.type === 'companion' && s.npc && n) Companions.adjust(s.npc, Math.round(n * 10) / 10, why, day); };
        const greedy = !!(s.companion && (s.companion.values || []).includes('greed'));
        let tone = this._tone(regard);
        let textKey = null;
        let outcome = null;
        let reply = { kind: 'plain' };
        const lines = [];
        // What the answer refers back to (data/couriers.json → letters.answers)
        const av = { gift: this._giftPhrase(L), gold: L.gold || '' };

        switch (L.kind) {
            case 'courtesy': {
                if (earlier >= M.courtesyCap) {
                    textKey = 'tiresome';
                    tone = 'cool';
                    if (to.type === 'lord') remember('letter_tiresome');
                    else if (to.type === 'folk') this._adjustFolk(player, s.person, -1);
                    else if (to.type === 'companion') approve(-1, 'too many letters');
                    else bump('score', -1);
                    break;
                }
                if (tone === 'hostile') break;
                if (to.type === 'companion') { approve(3 * f, 'a letter from you'); bump('score', 1 * f); }
                if (to.type === 'lord') remember('letter_kind', { weight: Math.max(0.5, 2 * f) });
                else if (to.type === 'rival') feud(-2 * f, 'a courteous letter');
                else if (to.type === 'spouse') bump('affection', 3 * f, 0, 100);
                else if (to.type === 'npc') bump('score', 3 * f);
                else if (to.type === 'folk') this._adjustFolk(player, s.person, Math.max(1, Math.round(4 * f)));
                else if (to.type === 'house') rivalry(-3 * f);
                if (to.type === 'child' && s.kingdom) {
                    tone = 'warm';
                    outcome = 'child';
                    lines.push(CourtLetters._news(world, s.kingdom));
                    if (typeof player.learnAboutKingdom === 'function') player.learnAboutKingdom(kid, ['ruler', 'diplomacy']);
                }
                break;
            }
            case 'gift': {
                if (worth <= 0) { textKey = 'stolen'; tone = 'cool'; break; }
                if (s.kingdom && to.type === 'lord') s.kingdom.treasury = _num(s.kingdom.treasury) + _num(L.gold);
                if (to.type === 'lord') { remember('gift', { weight: _clamp(worth / 40, 1, 10) * f, note: `${worth} gold's worth, by letter` }); rep(Math.min(5, Math.round(worth / 100))); }
                else if (to.type === 'rival') feud(-Math.min(15, worth / 30) * f, 'a gift');
                else if (to.type === 'spouse') bump('affection', Math.min(10, worth / 20) * f, 0, 100);
                else if (to.type === 'child') rep(2);
                else if (to.type === 'npc') { bump('score', Math.min(10, worth / 20) * f); bump('affection', Math.min(6, worth / 40) * f, 0, 100); }
                else if (to.type === 'folk') {
                    this._adjustFolk(player, s.person, Math.max(1, Math.round(Math.min(20, worth / 5) * f)));
                    if (s.person && s.person.mem) s.person.mem.giftsReceived = _num(s.person.mem.giftsReceived) + 1;
                } else if (to.type === 'house') rivalry(-Math.min(15, worth / 40) * f);
                else if (to.type === 'companion') { approve(Math.min(10, worth / 15) * f * (greedy ? 1.5 : 1), 'a gift by letter'); bump('score', Math.min(5, worth / 40) * f); }
                tone = regard <= -40 ? 'hostile' : regard >= 0 || worth >= 100 ? 'warm' : 'cool';
                lines.push(`They received ${L.gold ? `${L.gold} gold` : ''}${L.gold && L.item ? ' and ' : ''}${L.item ? `your ${String(L.item.id).replace(/_/g, ' ')}` : ''}.`);
                break;
            }
            case 'favour': {
                if (f < 1) { textKey = 'tiresome'; tone = 'cool'; remember('letter_favour'); bump('score', -2); approve(-2, 'asked again by letter'); break; }
                if (to.type === 'companion') {
                    // Recall them to your side: those who still think well of you come
                    const c = s.companion || {};
                    const need = c.leftHow === 'deserted' ? _num(M.recallDeserted, 60) : _num(M.recallApproval, 45);
                    if (_num(c.approval, 50) >= need) {
                        tone = 'warm';
                        const gov = s.npc && s.npc.governing;
                        reply = { kind: 'mail_proposal', always: true, data: { seal: 'rejoin', npcId: to.npcId }, sealLabel: `Welcome ${to.name} back to your company`, sealTip: gov ? 'They hand over their governorship and ride to join you.' : 'They rejoin your travelling party.' };
                        outcome = gov ? 'come_gov' : 'come';
                        lines.push(gov ? 'They will hand over the governorship and come, if you still want them.' : 'They will come, if you still want them.');
                    } else {
                        tone = _num(c.approval, 50) < 25 ? 'hostile' : 'cool';
                        approve(-2, 'asked to come back');
                    }
                    break;
                }
                if (to.type === 'lord') {
                    remember('letter_favour');
                    tone = this._tone(regard, 20, -20);
                    if (tone === 'warm' && s.kingdom) {
                        const g = Math.round(Math.min(_num(s.kingdom.treasury) * 0.04, 40 + regard * 3));
                        if (g >= 10) { s.kingdom.treasury -= g; reply.gold = g; outcome = 'warm_gold'; lines.push(`A purse of ${g} gold comes with the reply.`); } else { rep(3); outcome = 'warm_word'; lines.push('The treasury is bare, but they will speak well of you at court.'); }
                    }
                } else if (to.type === 'npc') {
                    tone = rel && (_num(rel.score) >= 30 || _num(rel.affection) >= 50) ? 'warm' : 'cool';
                    if (tone === 'warm') {
                        // A friend who is one of a town's people pays out of their own purse
                        const want = Utils.randInt(15, 50);
                        const lp = s.npc && s.npc.folkUid ? MailVoice._personByUid(world, s.npc.folkUid) : null;
                        const purse = lp ? Townsfolk.purse(lp.folk, lp.person, world) : want;
                        reply.gold = Math.min(want, purse);
                        if (lp) lp.person.purse = purse - reply.gold;
                        bump('score', -2);
                        if (reply.gold > 0) { outcome = 'warm_gold'; lines.push(`${reply.gold} gold comes with the reply.`); } else { tone = 'cool'; reply.gold = 0; }
                    } else bump('score', -1);
                } else if (to.type === 'folk') {
                    const disp = s.person && s.person.mem ? _num(s.person.mem.disposition, 50) : 50;
                    tone = disp >= 70 ? 'warm' : 'cool';
                    // What they can spare comes out of their own purse (systems/townsfolk.js)
                    const purse = s.person && s.folk ? Townsfolk.purse(s.folk, s.person, world) : 0;
                    const spare = Math.min(Utils.randInt(5, 20), Math.floor(purse * 0.6));
                    if (tone === 'warm' && spare >= 2) {
                        reply.gold = spare;
                        s.person.purse = purse - spare;
                        this._adjustFolk(player, s.person, -3);
                        outcome = 'warm_gold';
                        lines.push(`${reply.gold} gold, all they could spare, comes with the reply.`);
                    } else {
                        if (tone === 'warm') tone = 'cool';
                        this._adjustFolk(player, s.person, -1);
                    }
                } else if (to.type === 'house') {
                    tone = _num(s.house && s.house.rivalry) <= 20 ? 'warm' : 'cool';
                    if (tone === 'warm') { rep(3); outcome = 'warm_word'; lines.push(`They will put in a good word for you in ${(s.kingdom && s.kingdom.name) || 'their town'}.`); }
                } else if (to.type === 'child') {
                    tone = 'warm';
                    const learned = typeof player.learnAboutKingdom === 'function' ? player.learnAboutKingdom(kid, ['ruler', 'military', 'diplomacy', 'economy']) : [];
                    if (s.kingdom) {
                        const foes = (s.kingdom.wars || []).map(id => (world.getKingdom(id) || {}).name).filter(Boolean);
                        av.intel = `the court keeps an army of about ${Math.round(_num(s.kingdom.military))}, the treasury holds some ${Math.round(_num(s.kingdom.treasury) / 100) * 100} gold, and the realm is ${foes.length ? `at war with ${foes.join(' and ')}` : 'at peace'}.`;
                        outcome = 'warm_intel';
                        lines.push(`${s.kingdom.name}: army ${Math.round(_num(s.kingdom.military))}, treasury about ${Math.round(_num(s.kingdom.treasury) / 100) * 100} gold${learned.length ? ` · you learn of its ${_intelPhrase(learned)}` : ''}.`);
                    }
                }
                break;
            }
            case 'proposal': {
                if (to.type === 'lord') {
                    const ruled = Throne.ruledKingdom(player, world);
                    tone = this._tone(regard, 25, -25);
                    if (L.compromised) tone = tone === 'warm' ? 'cool' : tone;
                    if (tone === 'warm') {
                        remember('letter_proposal');
                        outcome = ruled ? 'warm_alliance' : 'warm_pact';
                        reply = { kind: 'mail_proposal', always: true, data: { seal: ruled ? 'alliance' : 'pact', ruledId: ruled ? ruled.id : null }, sealLabel: ruled ? `Seal the alliance with ${Names.realm(s.kingdom.name)}` : `Seal a pact of friendship with ${Names.realm(s.kingdom.name)}`, sealTip: ruled ? 'Your realms become allies.' : 'Reputation in the realm, and the lord remembers it.' };
                    } else if (tone === 'cool') remember('letter_proposal', { weight: 1 });
                    else remember('insult', { weight: -3, note: 'a presumptuous proposal' });
                } else if (to.type === 'rival') {
                    tone = _num(s.rival && s.rival.feud) < 50 ? 'warm' : 'hostile';
                    if (tone === 'warm') outcome = 'warm_truce';
                    if (tone === 'warm') reply = { kind: 'mail_proposal', always: true, data: { seal: 'truce' }, sealLabel: `Agree a truce with ${to.name}`, sealTip: 'The feud cools by 25.' };
                    else feud(3, 'a proposal scorned');
                } else if (to.type === 'npc') {
                    const ok = rel && rel.romantic && _num(rel.affection) >= 60 && !player.spouse && !(s.npc && s.npc.isMarried);
                    tone = ok ? 'warm' : 'cool';
                    if (ok) outcome = 'warm_marry';
                    if (ok) reply = { kind: 'mail_proposal', always: true, data: { seal: 'marriage', npcId: to.npcId }, sealLabel: `Wed ${to.name}`, sealTip: 'You marry by letter and banns.' };
                    else bump('affection', -3, 0, 100);
                } else if (to.type === 'house') {
                    tone = _num(s.house && s.house.rivalry) < 40 ? 'warm' : 'cool';
                    if (tone === 'warm') outcome = 'warm_partner';
                    if (tone === 'warm') reply = { kind: 'mail_proposal', always: true, data: { seal: 'partnership', houseId: to.houseId }, sealLabel: `Partner with ${to.name}`, sealTip: 'Their rivalry with you cools by 20, and they speak well of you.' };
                }
                break;
            }
            case 'apology': {
                if (to.type === 'lord') {
                    const mem = lord ? NPCLords.memoryOpinion(lord, day) : 0;
                    if (mem >= 0) { textKey = 'puzzled'; tone = 'cool'; break; }
                    remember('letter_apology', { weight: Math.max(0.5, Math.min(6, -mem / 3) * f) * (regard <= -40 ? 0.5 : 1) });
                    tone = regard > -40 ? 'warm' : 'cool';
                } else if (to.type === 'rival') {
                    feud(-8 * f, 'an apology');
                    tone = _num(s.rival && s.rival.feud) < 60 ? 'warm' : 'cool';
                } else if (to.type === 'spouse' || to.type === 'npc') {
                    if (rel && (_num(rel.affection) < 50 || _num(rel.score) < 0)) { bump('affection', 5 * f, 0, 100); bump('score', 4 * f); tone = 'warm'; } else { textKey = 'puzzled'; tone = 'cool'; }
                } else if (to.type === 'folk') {
                    const mem = s.person && s.person.mem;
                    if (mem && mem.threatened) { mem.threatened = false; this._adjustFolk(player, s.person, 6); tone = 'warm'; } else if (mem && _num(mem.disposition, 50) < 50) { this._adjustFolk(player, s.person, Math.max(1, Math.round(4 * f))); tone = 'warm'; } else { textKey = 'puzzled'; tone = 'cool'; }
                } else if (to.type === 'house') {
                    if (_num(s.house && s.house.rivalry) > 0) { rivalry(-6 * f); tone = 'warm'; } else { textKey = 'puzzled'; tone = 'cool'; }
                }
                break;
            }
            case 'threat': {
                if (to.type === 'lord' && s.kingdom) {
                    remember('letter_threat');
                    const strong = this._armyStrength(player) > _num(s.kingdom.military) * 1.2;
                    if (strong && regard < 30 && Utils.random() < 0.4) {
                        const g = Math.round(Math.min(_num(s.kingdom.treasury) * 0.05, 250));
                        if (g >= 10) { s.kingdom.treasury -= g; reply.gold = g; tone = 'warm'; outcome = 'paid'; lines.push(`${g} gold comes with the reply, and a request to be left in peace.`); } else tone = 'cool';
                    } else { tone = 'hostile'; rep(-5); }
                } else if (to.type === 'rival') { feud(12, 'a threatening letter'); tone = 'hostile'; }
                else if (to.type === 'folk') {
                    this._adjustFolk(player, s.person, -20);
                    if (s.person && s.person.mem) s.person.mem.threatened = true;
                    // Frightened enough to pay — out of their own purse
                    const purse = s.person && s.folk ? Townsfolk.purse(s.folk, s.person, world) : 0;
                    const pay = Math.min(Utils.randInt(5, 25), purse);
                    if (Utils.random() < 0.3 && pay >= 2) { reply.gold = pay; s.person.purse = purse - pay; tone = 'warm'; outcome = 'paid'; lines.push(`${reply.gold} gold is sent, with shaking hands.`); } else tone = 'hostile';
                } else if (to.type === 'npc') { bump('score', -15); bump('affection', -10, 0, 100); tone = 'hostile'; }
                else if (to.type === 'house') {
                    rivalry(15);
                    if (Utils.random() < 0.25) { reply.gold = Utils.randInt(50, 150); tone = 'warm'; outcome = 'paid'; lines.push(`${reply.gold} gold, to be left alone.`); } else tone = 'hostile';
                }
                break;
            }
            case 'love': {
                if (to.type === 'spouse') { bump('affection', 6 * f, 0, 100); tone = 'warm'; }
                else if (rel && (rel.romantic || _num(rel.affection) >= 25)) { bump('affection', 6 * f, 0, 100); bump('score', 2 * f); tone = 'warm'; }
                else { bump('affection', 2 * f, 0, 100); bump('score', -1); tone = 'cool'; }
                break;
            }
            case 'ransom': {
                const child = (player.children || []).find(c => c && c.id === L.childId);
                const held = child && Upbringing.ensure(child).heldBy;
                const vars = { child: child ? child.firstName : 'your child' };
                av.child = vars.child;
                if (!child || !held || held.kingdomId !== kid) { tone = 'cool'; outcome = 'gone'; lines.push(`${vars.child} is no longer held there.`); break; }
                if (regard >= M.freeReleaseRegard) {
                    this.release(player, world, child, kid);
                    tone = 'warm';
                    outcome = 'free';
                    lines.push(`${vars.child} is already on the road home, with an escort.`);
                    break;
                }
                const [lo, hi] = M.ransom;
                const amount = Math.round(_clamp(lo + (20 - regard) * 8 + _num(player.gold) * 0.05, lo, hi) / 10) * 10;
                tone = regard <= -25 ? 'hostile' : 'cool';
                outcome = 'price';
                av.amount = amount;
                reply = { kind: 'mail_ransom', always: true, data: { childId: child.id, amount }, amount, child: vars.child };
                break;
            }
            case 'warning': {
                if (to.type === 'companion') {
                    // A word of danger about their road or their post
                    approve(4 * f, 'a warning by letter');
                    tone = f < 1 ? 'cool' : 'warm';
                    if (tone === 'warm') {
                        outcome = s.npc && s.npc.governing ? 'gov' : 'road';
                        lines.push(s.npc && s.npc.governing ? 'They double the watch on the walls.' : 'They keep to the safer roads.');
                    }
                    break;
                }
                const enemy = L.enemyId && world.getKingdom ? world.getKingdom(L.enemyId) : null;
                if (enemy) av.enemy = enemy.name;
                const w = 6 * f * (L.compromised ? 0.5 : 1);
                if (regard <= -40) { tone = 'hostile'; remember('letter_warning', { weight: Math.max(0.5, w / 3) }); break; }
                remember('letter_warning', { weight: Math.max(0.5, w), note: enemy ? `of ${enemy.name}` : undefined });
                rep(2);
                tone = f < 1 || L.compromised ? 'cool' : 'warm';
                if (enemy) lines.push(`They will look to their borders with ${enemy.name}.`);
                break;
            }
        }
        const vars = { to: to.name, child: (reply && reply.child) || '' };
        const text = [_fill(K[textKey || tone] || '', vars), ...lines].filter(Boolean).join(' ');
        if (reply) {
            reply.body = text;
            reply.subject = `Re: ${_fill(K.subject || 'your letter', vars)}`;
            reply.outcome = outcome || textKey || tone;
            reply.answerVars = { ...av, replyGold: reply.gold || '' };
            if (reply.kind === 'plain' && !reply.gold && tone === 'hostile' && (to.type === 'folk' || to.type === 'npc')) reply = null; // no answer at all
        }
        return { tone, text, reply, outcome: outcome || textKey || tone };
    },

    /**
     * A companion away comes back to the party: out of their governorship
     * (systems/holdings.js, which puts them back in the party) or straight in.
     */
    rejoin(player, world, npcId) {
        const npc = Relationships.getNPC(npcId);
        if (!npc || npc.isAlive === false) return { success: false, reason: 'They are gone.' };
        if (Relationships.isInTravelParty(player, npcId)) return { success: false, reason: 'They already ride with you.' };
        if (npc.governing) {
            const [q, r] = String(npc.governing).split(',').map(Number);
            const res = Holdings.dismissGovernor(player, world, q, r);
            if (!res.success) delete npc.governing;
        }
        if (!Relationships.isInTravelParty(player, npcId)) {
            Relationships.ensureTravelParty(player);
            player.travelParty.push(npcId);
            npc.isTravelingWithPlayer = true;
        }
        const c = Companions.ensure(npc, world);
        c.leftHow = null;
        c.leftDay = null;
        c.rejoinedDay = _day(world);
        c.daysTogether = 0;
        Companions.adjust(npc, 3, 'called back by letter', _day(world));
        return { success: true, npc };
    },

    /** A held child freed: home, the hostage record cleared. */
    release(player, world, child, kid) {
        const up = Upbringing.ensure(child);
        delete up.heldBy;
        up.recalledHome = { kingdomId: kid, day: _day(world) };
        if (up.placement && up.placement.kind === 'ward') up.placement.returned = true;
        if (player.house) House._chronicle(player.house, world, `${child.firstName} is released by the court of ${(world.getKingdom(kid) || {}).name || 'their captors'} and comes home.`, ['heirs']);
    },

    // ──────────── WRITING THE LETTER ────────────

    /** "the 100 gold", "the bolt of silk", "the 100 gold and the wine". */
    _giftPhrase(L) {
        const bits = [];
        if (L && L.gold) bits.push(`the ${L.gold} gold`);
        if (L && L.item) bits.push(`the ${this._goodName(L.item.id)}`);
        return bits.join(' and ');
    },

    _goodName(id) {
        const G = (DataLoader._gamedata && DataLoader._gamedata.playerEconomy && DataLoader._gamedata.playerEconomy.GOODS) || {};
        const def = G[String(id || '').toUpperCase()];
        return String((def && def.name) || id || 'goods').replace(/_/g, ' ').toLowerCase();
    },

    /** What the model may know of the writer (systems/npcBrain.js writeLetter). */
    _sketch(R) {
        return { type: R.from.type, place: R.from.place || '', kind: R.inReplyTo || (R.unprompted ? 'unprompted' : '') };
    },

    /**
     * Write a letter for a reply or an unprompted letter R: the writer, the
     * hooks it carries (decided and paid for at the writer's end now; what
     * rides with it is handed over on arrival, _arrive), and the letter itself.
     */
    _write(world, player, R, ctx = {}) {
        const to = ctx.to || R.from;
        const sub = ctx.sub || this._subject(player, world, to);
        const W = MailVoice.writer(player, world, to, sub);
        const plain = R.kind === 'plain';
        const hooks = this._hooks(world, player, to, sub, W, R.tone, { L: ctx.L || null, reason: R.reason || null, plain });
        const decision = plain ? hooks.find(h => h.decision) : null;
        if (decision) {
            R.kind = decision.decision;
            R.data = { ...(decision.data || {}) };
            R.decisionVars = { ...(decision.decisionVars || decision.vars || {}) };
        }
        // A plea that found nothing to ask for is only news
        if (R.reason === 'request' && !(decision && decision.k === 'request_food')) {
            R.reason = 'news';
            if (/^A plea from/.test(R.subject || '')) R.subject = `News from ${to.place || 'afar'}`;
        }
        R.hooks = hooks.filter(h => !h.decision || h === decision).map(h => ({ k: h.k, arrive: h.arrive || null }));
        R.summary = R.body || '';
        R.letter = MailVoice.compose(player, world, {
            // (paid to be left alone is fear, not warmth)
            to, s: sub, W, kind: ctx.L ? ctx.L.kind : 'unprompted', outcome: R.outcome, tone: R.outcome === 'paid' ? 'cool' : R.tone, vars: { ...(R.answerVars || {}), ...(R.vars || {}) },
            L: ctx.L || null, reason: R.reason || null, hooks: hooks.filter(h => !h.decision || h === decision),
        });
        R.body = MailVoice.plain(player, R.letter);
        if (!R.summary) R.summary = R.body.length > 160 ? `${R.body.slice(0, 157).replace(/\s+\S*$/, '')}…` : R.body;
        return R;
    },

    /**
     * What a letter carries besides words, decided by the writer's state:
     * [{ k, vars, decision?, data?, arrive?, enclosed? }]. Only true things:
     * a dearth in their market, an agent of a rival House in their town, an
     * outlaw lair near them, a court scandal's truth, coin from their own
     * purse, goods bought in their own market.
     */
    _hooks(world, player, to, s, W, tone, ctx = {}) {
        const V = this.config().voice;
        const out = [];
        if (tone === 'hostile') return out;
        const st = this.state(player);
        const day = _day(world);
        const corr = MailVoice.corr(player, to.key);
        const settlement = W.town && W.town.settlement;
        const people = ['folk', 'npc', 'companion', 'spouse'];
        const open = CourtLetters.state(player).inbox;
        const r = () => Utils.random();

        // A request: their market is short of food
        if (ctx.plain && people.includes(to.type) && settlement && settlement.market && (corr.lastRequest == null || day - corr.lastRequest >= V.requestDays)
            && !open.some(l => l.kind === 'mail_request' && l.key === `mail:${to.key}`) && !st.replies.some(x => x.from && x.from.key === to.key && x.kind === 'mail_request')) {
            const short = SettlementMarket.worstShortage(settlement, 1.6);
            const food = short && (SettlementMarket.good(short.id) || {}).group === 'food' ? short.id : (SettlementMarket.inDearth(settlement) ? 'grain' : null);
            if (food && (ctx.reason === 'request' || r() < V.requestChance)) {
                const qty = Utils.randInt(V.requestQty[0], V.requestQty[1]);
                const unit = Math.max(1, PlayerInventory.goodValue(food) || 3);
                const gold = Math.max(5, Math.round(qty * unit * 1.5));
                const goodName = this._goodName(food);
                corr.lastRequest = day;
                out.push({
                    k: 'request_food', vars: { good: goodName, qty, gold }, decision: 'mail_request',
                    data: { request: { good: food, goodName, qty, gold, town: W.town.name } }, decisionVars: { good: goodName, qty, gold, town: W.town.name },
                });
            }
        }
        // An invitation: come and see them
        const here = Number.isFinite(player.q) && player.q === to.q && player.r === to.r;
        if (ctx.plain && !out.some(h => h.decision) && tone === 'warm' && people.includes(to.type) && !here && (corr.lastInvite == null || day - corr.lastInvite >= V.inviteDays)
            && !st.visits.some(v => v.key === to.key) && Number.isFinite(to.q) && r() < V.inviteChance) {
            const until = day + V.inviteDeadline;
            corr.lastInvite = day;
            const deadline = this._dayWord(world, until);
            out.push({
                k: 'invite_visit', vars: { deadline, town: W.town.name }, decision: 'mail_invite',
                data: { visit: { key: to.key, type: to.type, name: to.name, q: to.q, r: to.r, town: W.town.name, until, npcId: to.npcId != null ? to.npcId : null, personId: to.personId != null ? to.personId : null } },
                decisionVars: { town: W.town.name, until, deadline },
            });
        }
        // A lord's feast: the steward's letter follows (a real courtLetters feast_invite)
        if (to.type === 'lord' && tone === 'warm' && ctx.L && (ctx.L.kind === 'courtesy' || ctx.L.kind === 'gift') && r() < V.feastChance
            && !open.some(l => l.kind === 'feast_invite' && l.key === to.key)) {
            const cand = CourtLetters._candidates(world, player, 'feast_invite').find(c => c.key === to.key);
            if (cand) out.push({ k: 'invite_feast', vars: {}, arrive: { feast: to.kingdomId } });
        }
        // A tip: someone in their town is in a rival House's pay
        if ((to.type === 'folk' || to.type === 'npc' || to.type === 'companion') && tone === 'warm') {
            const writerPid = W.person && W.person.person ? W.person.person.id : null;
            const agent = RivalAgents.list(player).find(a => a && !a.known && !a.turned && a.q === to.q && a.r === to.r && a.pid !== writerPid);
            if (agent && r() < V.tipChance) out.push({ k: 'tip_agent', vars: { agent: agent.name, role: agent.role || 'townsman', rival: agent.rivalName || 'a rival House' }, arrive: { agentId: agent.id } });
        }
        // A tip: where the outlaws who trouble them have their lair
        if (people.concat(['lord']).includes(to.type)) {
            const lairs = (player.outlawLairs && Array.isArray(player.outlawLairs.lairs)) ? player.outlawLairs.lairs : [];
            let best = null;
            for (const l of lairs) {
                if (!l || l.status !== 'active' || l.known || !Number.isFinite(l.q)) continue;
                const d = Hex.wrappingDistance(l.q, l.r, to.q, to.r, world.width || 0);
                if (d <= 6 && (!best || d < best.d)) best = { d, l };
            }
            if (best && r() < V.lairTipChance) {
                const where = this._nearestName(world, best.l.q, best.l.r) || W.town.name;
                out.push({ k: 'tip_lair', vars: { lair: best.l.name, leader: (best.l.leader && best.l.leader.name) || 'their chief', where }, arrive: { lairId: best.l.id != null ? best.l.id : null, lairName: best.l.name } });
            }
        }
        // A secret: the truth of a tale told about the great of their realm
        if (['lord', 'rival', 'npc', 'companion', 'child', 'spouse'].includes(to.type) && tone === 'warm') {
            const sc = Whispers.secretIn(player, to.kingdomId || (W.town && W.town.kingdomId));
            if (sc && r() < V.secretChance) out.push({ k: sc.truth ? 'secret_true' : 'secret_false', vars: { subject: sc.subject.name }, arrive: { secret: sc.id } });
        }
        // An enclosure from the writer's own means (not from someone begging bread in the same letter)
        if (tone === 'warm' && ctx.plain && !out.some(h => h.k === 'request_food')) {
            const lp = W.person;
            if (to.type === 'folk' && lp && r() < V.coinChance) {
                const purse = Townsfolk.purse(lp.folk, lp.person, world);
                const coin = Math.min(6, Math.floor(purse / 3));
                if (coin >= 2) {
                    lp.person.purse = purse - coin;
                    out.push({ k: 'enclose_coin', vars: { coin: `${coin} gold` }, arrive: { gold: coin }, enclosed: `${coin} gold` });
                }
            } else if ((to.type === 'folk' || (to.type === 'npc' && lp)) && lp && settlement && r() < V.goodsChance) {
                // Something cheap from their own market, paid for out of their purse into the town's
                const ids = ['bread', 'cheese', 'honey', 'beer', 'wool', 'linen', 'fish', 'preserved_fish', 'spices', 'wine'];
                const purse = Townsfolk.purse(lp.folk, lp.person, world);
                const opts = ids.filter(id => SettlementMarket.tracks(id) && SettlementMarket.available(settlement, id) >= 6 && PlayerInventory.goodValue(id) > 0 && PlayerInventory.goodValue(id) * 2 <= purse);
                if (opts.length) {
                    const id = opts[Math.floor(r() * opts.length)];
                    const qty = 2;
                    const cost = Math.ceil(PlayerInventory.goodValue(id) * qty);
                    SettlementMarket.take(settlement, id, qty);
                    lp.person.purse = purse - cost;
                    if (settlement.economy && Number.isFinite(settlement.economy.gold)) settlement.economy.gold += cost;
                    const name = this._goodName(id);
                    out.push({ k: 'enclose_goods', vars: { goodsLine: `${qty} ${name}` }, arrive: { goods: { id, qty } }, enclosed: `${qty} ${name}` });
                }
            } else if ((to.type === 'spouse' || (to.type === 'npc' && to.romantic)) && r() < V.tokenChance) {
                const T = MailVoice.data().tokens || {};
                const season = String(world.season || 'spring').toLowerCase();
                const kids = to.type === 'spouse' ? (player.children || []).filter(c => c && c.isAlive !== false && _num(c.age) < 12 && !Upbringing.isAway(c)) : [];
                // (never the same keepsake twice from the same hand)
                const given = new Set(Array.isArray(corr.tokens) ? corr.tokens : []);
                const fresh = (list) => list.filter(t => !given.has(t));
                let token;
                if (kids.length && Array.isArray(T.kid) && T.kid.length && r() < 0.5) {
                    const c = kids[Math.floor(r() * kids.length)];
                    const opts = fresh(T.kid.map(t => _fill(t, { child: c.firstName })));
                    token = opts.length ? opts[Math.floor(r() * opts.length)] : null;
                }
                if (!token) {
                    const pool = fresh([...(T[season] || []), ...(T.any || [])]);
                    token = pool.length ? pool[Math.floor(r() * pool.length)] : null;
                }
                if (token) {
                    corr.tokens = [...given, token].slice(-20);
                    out.push({ k: 'enclose_token', vars: { token }, arrive: { token }, enclosed: token });
                }
            }
        }
        return out;
    },

    /** "the turn of the season" — a deadline as a letter writes it: "the 14th day of summer". */
    _dayWord(world, day) {
        const Y = 120;
        const d = Math.max(1, Math.round(day));
        const season = ['spring', 'summer', 'autumn', 'winter'][Math.floor(((d - 1) % Y) / 30)] || 'spring';
        const n = ((d - 1) % 30) + 1;
        const th = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
        return `the ${n}${th} day of ${season} (day ${d})`;
    },

    _nearestName(world, q, r) {
        let best = null;
        for (const t of Couriers.towns(world).values()) {
            const d = Hex.wrappingDistance(q, r, t.q, t.r, world.width || 0);
            if (!best || d < best.d) best = { d, t };
        }
        return best ? best.t.name : null;
    },

    /** What rides with a letter is handed over as it arrives. → { lines, lost } */
    _arrive(world, player, R, out) {
        const st = this.state(player);
        const lines = [];
        let lost = false;
        for (const h of R.hooks || []) {
            const a = h.arrive;
            if (!a) continue;
            if (a.gold) {
                if (R.robbed) { lost = true; continue; }
                player.gold = _num(player.gold) + a.gold;
                Ledger.record(player, 'mailReceipts', a.gold);
                lines.push(`+${a.gold} gold enclosed.`);
            }
            if (a.goods) {
                if (R.robbed) { lost = true; continue; }
                if (!player.inventory) player.inventory = {};
                player.inventory[a.goods.id] = _num(player.inventory[a.goods.id]) + a.goods.qty;
                lines.push(`+${a.goods.qty} ${this._goodName(a.goods.id)} enclosed.`);
            }
            if (a.token) {
                st.keepsakes.unshift({ what: a.token, from: R.from.name, day: _day(world) });
                if (st.keepsakes.length > this.config().voice.maxKeepsakes) st.keepsakes.length = this.config().voice.maxKeepsakes;
            }
            if (a.agentId != null) {
                const ag = RivalAgents.list(player).find(x => x && x.id === a.agentId && !x.known);
                if (ag) {
                    ag.suspicion = _num(ag.suspicion) + this.config().voice.tipSuspicion;
                    const need = _num(((RivalAgents.config() || {}).suspicion || {}).known, 100);
                    if (ag.suspicion >= need) RivalAgents._reveal(player, world, ag, out);
                    else lines.push(`You have your eye on ${ag.name} now.`);
                }
            }
            if (a.lairName) {
                const lairs = (player.outlawLairs && Array.isArray(player.outlawLairs.lairs)) ? player.outlawLairs.lairs : [];
                const lair = lairs.find(l => l && (a.lairId != null ? l.id === a.lairId : l.name === a.lairName));
                if (lair && !lair.known) { lair.known = true; lair.rumoured = true; lines.push(`You know where ${lair.name} lies now.`); }
            }
            if (a.secret != null) {
                const sc = Whispers.get(player, a.secret);
                if (sc && !sc.truthKnown) Whispers.reveal(player, a.secret);
            }
            if (a.feast) {
                const k = world.getKingdom && world.getKingdom(a.feast);
                const cand = k ? CourtLetters._candidates(world, player, 'feast_invite').find(c => c.key === `lord:${k.id}`) : null;
                if (cand && !CourtLetters.state(player).inbox.some(l => l.kind === 'feast_invite' && l.key === cand.key)) CourtLetters.deliver(player, CourtLetters.compose(world, player, 'feast_invite', cand));
            }
        }
        return { lines, lost };
    },

    /** Goodwill (or ill) for a correspondent, by what they are to the player. */
    _warmth(player, world, to, n, why) {
        if (!to || !n) return;
        const s = this._subject(player, world, to);
        switch (to.type) {
            case 'folk': this._adjustFolk(player, s.person, n); break;
            case 'npc':
            case 'spouse':
                if (s.rel) {
                    s.rel.score = Math.round(_clamp(_num(s.rel.score) + n, -100, 100) * 10) / 10;
                    if (n > 0 || to.type === 'spouse') s.rel.affection = Math.round(_clamp(_num(s.rel.affection) + n / 2, 0, 100) * 10) / 10;
                }
                break;
            case 'companion': if (s.npc) Companions.adjust(s.npc, n, why, _day(world)); break;
            case 'lord': if (s.lord) NPCLords.rememberDeed(world, s.lord, n > 0 ? 'letter_kind' : 'letter_tiresome', { note: why }); break;
            case 'rival': House.accrueRivalFeud(player, world, to.kingdomId, -n, why); break;
            case 'house': if (s.house) s.house.rivalry = Math.round(_clamp(_num(s.house.rivalry) - n, 0, 100)); break;
            default: break;
        }
    },

    /** Send what a correspondent in want asked for, or refuse. → { success, lines } */
    _answerRequest(player, world, letter, choiceId) {
        const V = this.config().voice;
        const d = letter.data || {};
        const q = d.request;
        const to = d.to;
        if (!q || !to) return { success: true, lines: [] };
        const lines = [];
        const tile = world.getTile && world.getTile(to.q, to.r);
        const settlement = tile && tile.settlement;
        if (choiceId === 'goods') {
            const have = _num(player.inventory && player.inventory[q.good]);
            if (have < q.qty) return { success: false, reason: `You carry only ${have}.` };
            player.inventory[q.good] = have - q.qty;
            if (player.inventory[q.good] <= 0) delete player.inventory[q.good];
            if (settlement) SettlementMarket.add(settlement, q.good, q.qty);
            lines.push(`📦 ${q.qty} ${q.goodName || q.good} ride to ${q.town || to.place}.`);
        } else if (choiceId === 'coin') {
            if (_num(player.gold) < q.gold) return { success: false, reason: `You need ${q.gold} gold.` };
            player.gold = _num(player.gold) - q.gold;
            Ledger.record(player, 'mailGifts', -q.gold);
            // The coin goes to them (a townsperson's purse), or to their town's market purse
            const s = this._subject(player, world, to);
            if (to.type === 'folk' && s.person) s.person.purse = _num(s.person.purse) + q.gold;
            else if (settlement && settlement.economy && Number.isFinite(settlement.economy.gold)) settlement.economy.gold += q.gold;
            lines.push(`💰 ${q.gold} gold rides to ${q.town || to.place}.`);
        }
        if (choiceId === 'refuse') {
            this._warmth(player, world, to, V.requestRefused, 'a plea refused');
            return { success: true, lines };
        }
        this._warmth(player, world, to, V.requestThanks, 'help in hard times');
        if (settlement) Gossip.spreadDeed(player, world, 'famine_dole', { q: to.q, r: to.r, location: q.town || to.place, kingdom: settlement.kingdom || to.kingdomId, victim: to.name });
        const corr = MailVoice.corr(player, to.key);
        corr.helped = _day(world);
        lines.push(`🤝 ${to.name} will not forget it.`);
        return { success: true, lines };
    },

    /** Promised visits: kept by standing in their town in time, or missed. */
    _visits(world, player, out) {
        const st = this.state(player);
        if (!st.visits.length) return;
        const V = this.config().voice;
        const day = _day(world);
        for (const v of st.visits.slice()) {
            if (player.q === v.q && player.r === v.r) {
                st.visits = st.visits.filter(x => x !== v);
                const to = this.recipient(player, world, v.key) || { ...v, place: v.town };
                const n = v.type === 'folk' ? V.visitDisposition : v.type === 'companion' ? V.visitApproval : v.type === 'spouse' ? V.visitAffection : V.visitScore;
                this._warmth(player, world, to, n, 'a promised visit kept');
                const corr = MailVoice.corr(player, v.key);
                corr.visited = day;
                out.notices.push({ icon: '🏡', title: `${v.name} Welcomes You`, text: `You kept your word and came to ${v.town}. ${v.name} has a bed and a supper ready, and is gladder of it than words say.`, type: 'success' });
            } else if (day > v.until) {
                st.visits = st.visits.filter(x => x !== v);
                const to = this.recipient(player, world, v.key) || { ...v, place: v.town };
                this._warmth(player, world, to, V.missedVisit, 'a promised visit missed');
                out.notices.push({ icon: '🕯️', title: 'A Visit Missed', text: `You promised ${v.name} you would come to ${v.town}, and never came.`, type: 'warning' });
            }
        }
    },

    // ──────────── LETTERS NOBODY ASKED FOR ────────────

    /**
     * Correspondents write first: condolence when someone of the player's
     * family dies, congratulations on a birth, a marriage, a crown, word of
     * the player's deeds as it reached their town, a plea in a dearth, news,
     * a spouse missing them — at a sane rate (data: config.mail.voice).
     */
    _unprompted(world, player, out) {
        const V = this.config().voice;
        const day = _day(world);
        if (day < V.firstDay) return;
        // No mail yet: only a spouse away or a companion governing writes, and the mailbag is begun for them
        if (!player.mail) {
            if (!(player.spouse || Companions.away(player, world).some(a => a.status === 'governing'))) return;
            this.state(player);
        }
        const st = this.state(player);
        if (st.nextUnprompted == null) st.nextUnprompted = day + Utils.randInt(V.gap[0], V.gap[1]);
        const pending = () => st.replies.filter(x => x.unprompted).length;
        // The family's news, as the House's chronicle has it
        const since = _num(st.heard.scan, day - 1);
        st.heard.scan = day;
        const events = this._familyEvents(player, world, since, day);
        for (const ev of events) {
            if (st.heard[ev.key]) continue;
            st.heard[ev.key] = day;
            const who = this._correspondents(player, world, V.minRegard).filter(r => r.key !== ev.not);
            for (const to of who.slice(0, V.eventMax)) {
                if (pending() >= V.maxPending + V.eventMax) break;
                this._sendUnprompted(world, player, to, ev.reason, ev.vars, ev.subject);
            }
        }
        // A letter now and then from those who write to you
        if (day < st.nextUnprompted || pending() >= V.maxPending) return;
        st.nextUnprompted = day + Utils.randInt(V.gap[0], V.gap[1]);
        const cands = this._correspondents(player, world, V.minRegard).filter(r => {
            const c = st.corr[r.key];
            return !(c && c.last != null && day - c.last < 15) && !st.replies.some(x => x.from && x.from.key === r.key);
        });
        if (!cands.length) return;
        const to = cands[Math.floor(Utils.random() * cands.length)];
        const sub = this._subject(player, world, to);
        const W = MailVoice.writer(player, world, to, sub);
        const tile = world.getTile && world.getTile(to.q, to.r);
        const settlement = tile && tile.settlement;
        let reason = 'news';
        if (settlement && settlement.market && ['folk', 'npc', 'companion', 'spouse'].includes(to.type) && (SettlementMarket.inDearth(settlement) || (SettlementMarket.worstShortage(settlement, 1.6) && (SettlementMarket.good(SettlementMarket.worstShortage(settlement, 1.6).id) || {}).group === 'food'))) reason = 'request';
        else if (to.type === 'spouse' || (to.type === 'npc' && to.romantic)) reason = Utils.random() < 0.5 ? 'missing' : 'news';
        else {
            const deed = MailVoice.facts(player, world, W, sub).find(f => /^deed_(duel_won|beast_slain|feast_given|famine_dole|pilgrimage_made|pardon|wilds_rescue)$/.test(f.k));
            const c = st.corr[to.key];
            if (deed && !(c && c.told && c.told[`${deed.k}:${deed.x}`] != null)) reason = 'deed';
        }
        this._sendUnprompted(world, player, to, reason, {}, null);
    },

    /** The people who write to the player: those they have written to, and a spouse or companion away. */
    _correspondents(player, world, minRegard) {
        const st = this.state(player);
        const out = [];
        for (const r of this.recipients(player, world)) {
            const known = st.corr[r.key] && st.corr[r.key].n > 0;
            if (!known && r.type !== 'spouse' && !(r.type === 'companion' && r.status === 'governing')) continue;
            if (r.type === 'spouse' && Number.isFinite(player.q) && Hex.wrappingDistance(player.q, player.r, r.q, r.r, world.width || 0) <= 2) continue;
            if (r.type === 'rival' || r.type === 'house') continue;
            if (this.regard(player, world, r) < minRegard) continue;
            out.push(r);
        }
        return out.sort((a, b) => a.key.localeCompare(b.key));
    },

    /** The family's news since `since`: [{ key, reason, vars, subject, not }]. */
    _familyEvents(player, world, since, day) {
        const out = [];
        for (const h of ((player.house && player.house.history) || [])) {
            if (!h || !(h.day > since) || h.day > day) continue;
            const tags = h.tags || [];
            const key = `h:${h.day}:${String(h.text).slice(0, 24)}`;
            if (tags.includes('widowed')) {
                const dead = String(h.text).split(',')[0].trim();
                out.push({ key, reason: 'condolence_spouse', vars: { dead }, subject: 'With deepest sympathy' });
            } else if (tags.includes('birth')) {
                const child = String(h.text).split(' is born')[0].trim();
                const c = (player.children || []).find(x => x && x.firstName === child);
                out.push({ key, reason: 'congrats_birth', vars: { child, childWord: c && c.gender === 'female' ? 'daughter' : c && c.gender === 'male' ? 'son' : 'child' }, subject: `On the birth of ${child}` });
            } else if (tags.includes('marriage') && tags.includes('love')) {
                const m = / weds (.+)\.$/.exec(String(h.text));
                if (m) out.push({ key, reason: 'congrats_wed', vars: { spouse: m[1] }, subject: 'On your marriage' });
            } else if (tags.includes('throne') && Throne.ruledKingdom(player, world) && /crown|throne|king|queen/i.test(String(h.text)) && !/ends/.test(String(h.text))) {
                out.push({ key, reason: 'congrats_crown', vars: {}, subject: 'On your crown' });
            }
        }
        for (const c of player.children || []) {
            if (!c || c.isAlive !== false || !Number.isFinite(c.deathDay) || !(c.deathDay > since) || c.deathDay > day) continue;
            out.push({ key: `child:${c.id}`, reason: 'condolence_child', vars: { dead: c.firstName, deadWord: c.gender === 'female' ? 'daughter' : 'son' }, subject: `For ${c.firstName}` });
        }
        return out;
    },

    _sendUnprompted(world, player, to, reason, vars = {}, subject = null) {
        const st = this.state(player);
        const day = _day(world);
        const sub = this._subject(player, world, to);
        const regard = this.regard(player, world, to);
        const dest = Number.isFinite(player.q) ? { q: player.q, r: player.r } : { q: to.q, r: to.r };
        const days = Math.max(1, Couriers.travelDays(world, { q: to.q, r: to.r }, dest, 7));
        const subj = subject || ({ news: `News from ${to.place || 'afar'}`, request: `A plea from ${to.place || 'afar'}`, missing: 'From home', deed: 'Word of you' }[reason]) || `A letter from ${to.name}`;
        const R = {
            id: st.nextId++, due: day + days, sentDay: day, from: { ...to }, back: null, kind: 'plain', tone: this._tone(regard),
            unprompted: true, reason, subject: subj, vars: { ...vars }, outcome: null, answerVars: {}, body: '',
        };
        if (R.tone === 'hostile') return null;
        this._write(world, player, R, { to, sub });
        st.replies.push(R);
        st.stats.unprompted = _num(st.stats.unprompted) + 1;
        return R;
    },

    // ──────────── REPLIES ────────────

    /** A reply comes home: a plain one is filed (Letters → Answered), one that needs a decision goes to the inbox. */
    _reply(world, player, R, out) {
        const st = this.state(player);
        const day = _day(world);
        // A letter in its writer's own words still being written waits a day; never written, it is answered plainly (systems/letterChat.js)
        if (R.free && LetterChat.hold(world, player, R)) return;
        if (R.free && R.free.state !== 'done' && R.free.state !== 'fallback' && !LetterChat.fallbackReply(world, player, R)) {
            st.replies = st.replies.filter(x => x !== R);
            return;
        }
        st.replies = st.replies.filter(x => x !== R);
        st.stats.replies++;
        // Its messenger was waylaid on the road (systems/courierRiders.js): the purse is gone, the letter comes on
        if (R.robbed) R.body = `${R.body || ''} (The messenger was robbed by ${R.robbed.by} near ${R.robbed.where}${R.robbed.gold ? `; the ${R.robbed.gold} gold they carried is gone` : ''}.)`.trim();
        if (R.gold > 0) {
            player.gold = _num(player.gold) + R.gold;
            Ledger.record(player, 'mailReceipts', R.gold);
        }
        const got = this._arrive(world, player, R, out);
        // The tales a letter tells are tales the player has now heard (systems/whispers.js)
        for (const id of (R.letter && R.letter.heard) || []) { const sc = Whispers.get(player, id); if (sc) sc.known = true; }
        if (R.letter) {
            if (R.robbed) R.letter.handNote = [R.letter.handNote, `The messenger was robbed by ${R.robbed.by} near ${R.robbed.where} on the way${R.robbed.gold || got.lost ? ', and what came with the letter is gone' : ''}.`].filter(Boolean).join(' ');
            if (got.lines.length) R.letter.received = got.lines;
        }
        const sub = R.unprompted ? (R.subject || `A letter from ${R.from.name}`) : R.subject;
        const isDecision = R.kind === 'mail_proposal' || R.kind === 'mail_ransom' || R.kind === 'mail_request' || R.kind === 'mail_invite';
        if (!isDecision) {
            const filed = { kind: 'mail_reply', day, from: { type: R.from.type, name: R.from.name, kingdomId: R.from.kingdomId || null }, subject: sub, outcome: R.unprompted ? 'letter' : 'reply', text: R.summary || R.body };
            if (R.letter) filed.letter = R.letter;
            this._file(player, filed);
            if (R.letter) MailVoice.voice(R.letter, this._sketch(R));
            out.replies.push(R);
            const gist = R.unprompted ? `${R.from.name} writes from ${R.from.place || 'afar'}. Read it in Journal → Letters → Answered.` : `${R.summary || R.body} (Journal → Letters → Answered)`;
            out.notices.push({ icon: '📨', title: R.unprompted ? `A Letter from ${R.from.name}` : `A Reply from ${R.from.name}`, text: gist + (R.gold ? ` (+${R.gold} gold)` : '') + (got.lines.length ? ` ${got.lines.join(' ')}` : ''), type: R.tone === 'warm' ? 'success' : R.tone === 'hostile' ? 'warning' : 'info' });
            return;
        }
        const CK = CourtLetters.kind(R.kind) || {};
        const realm = R.from.kingdomId && world.getKingdom ? (world.getKingdom(R.from.kingdomId) || {}).name : '';
        const body = R.letter ? MailVoice.plain(player, R.letter) : R.body;
        const vars = { from: R.from.name, subject: sub, body, sealLabel: R.sealLabel || 'Agree', sealTip: R.sealTip || '', amount: R.amount || (R.data && R.data.amount) || 0, child: R.child || '', realm: realm || '', ...(R.decisionVars || {}) };
        const letter = CourtLetters.deliver(player, {
            id: 0, kind: R.kind, day, expires: day + _num(CK.expiry, this.config().replyExpiry),
            from: { type: 'mail', name: R.from.name, kingdomId: R.from.kingdomId || null, npcId: R.from.npcId != null ? R.from.npcId : undefined },
            key: `mail:${R.from.key}`, vars, data: { ...(R.data || {}), to: { ...R.from }, amount: vars.amount },
            subject: _fill(CK.subject, vars), body: _fill(CK.body, vars), read: false,
            ...(R.letter ? { letter: R.letter } : {}),
        });
        if (R.letter) MailVoice.voice(R.letter, this._sketch(R));
        out.replies.push(R);
        out.notices.push({ icon: CK.icon || '📨', title: `A Reply from ${R.from.name}`, text: `${letter.subject}. Answer it in Journal → Letters.`, type: 'info' });
    },

    /** Put a letter straight into the Letters archive. */
    _file(player, entry) {
        const st = CourtLetters.state(player);
        st.archive.unshift({ id: st.nextId++, ...entry });
        const cap = CourtLetters.config().maxArchive;
        if (st.archive.length > cap) st.archive.length = cap;
    },

    /** Can this answer be given now? (CourtLetters.choicesFor for the mail kinds) → { ok, why, hide } */
    choiceCheck(player, world, letter, choiceId) {
        const amount = _num(letter.data && letter.data.amount);
        switch (`${letter.kind}:${choiceId}`) {
            case 'mail_ransom:pay':
            case 'mail_blackmail:pay':
                if (_num(player.gold) < amount) return { ok: false, why: `You need ${amount} gold.` };
                break;
            case 'mail_ransom:refuse':
                break;
            case 'mail_proposal:seal': {
                const d = letter.data || {};
                if (d.seal === 'marriage' && player.spouse) return { ok: false, why: 'You are already married.' };
                if (d.seal === 'rejoin') {
                    const npc = Relationships.getNPC(d.npcId);
                    if (!npc || npc.isAlive === false) return { ok: false, why: 'They are gone.' };
                    if (Relationships.isInTravelParty(player, d.npcId)) return { ok: false, why: 'They already ride with you.', hide: true };
                }
                if (d.seal === 'alliance') {
                    const ruled = Throne.ruledKingdom(player, world);
                    if (!ruled) return { ok: false, why: 'You no longer rule a realm.' };
                    if (CourtLetters.atWar(player, world, letter.from.kingdomId)) return { ok: false, why: 'You are at war with them.' };
                }
                break;
            }
            case 'courier_bag:sell':
            case 'stolen_mailbag:sell':
                if (!letter.data || !letter.data.enemyId) return { ok: false, why: 'No enemy of theirs to sell it to.', hide: true };
                break;
            case 'mail_request:goods': {
                const q = letter.data && letter.data.request;
                if (!q) return { ok: false, why: '', hide: true };
                const have = _num(player.inventory && player.inventory[q.good]);
                if (have < q.qty) return { ok: false, why: `You carry ${have} ${q.goodName || q.good}; they asked for ${q.qty}.` };
                break;
            }
            case 'mail_request:coin': {
                const q = letter.data && letter.data.request;
                if (!q) return { ok: false, why: '', hide: true };
                if (_num(player.gold) < q.gold) return { ok: false, why: `You need ${q.gold} gold.` };
                break;
            }
        }
        return { ok: true, why: '' };
    },

    /** Answer a mail letter in the inbox (from CourtLetters.answer). → { success, lines } */
    answerReply(player, world, letter, choiceId) {
        const d = letter.data || {};
        const lines = [];
        const kid = letter.from && letter.from.kingdomId;
        const k = kid && world.getKingdom ? world.getKingdom(kid) : null;
        switch (`${letter.kind}:${choiceId}`) {
            case 'mail_proposal:seal':
                switch (d.seal) {
                    case 'alliance': {
                        const ruled = Throne.ruledKingdom(player, world);
                        if (!ruled || !k) return { success: false, reason: 'The realm is gone.' };
                        for (const [a, b] of [[ruled, k], [k, ruled]]) {
                            if (!Array.isArray(a.allies)) a.allies = [];
                            if (!a.allies.includes(b.id)) a.allies.push(b.id);
                            if (!a.relations) a.relations = {};
                            a.relations[b.id] = _clamp(_num(a.relations[b.id]) + 20, -100, 100);
                        }
                        if (k.lord) NPCLords.rememberDeed(world, k.lord, 'broker_alliance', { note: 'sealed by letter' });
                        lines.push(`🤝 ${ruled.name} and ${k.name} are allies.`);
                        break;
                    }
                    case 'pact':
                        if (!player.reputation) player.reputation = {};
                        if (kid) player.reputation[kid] = _clamp(_num(player.reputation[kid]) + 5, -100, 100);
                        if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'letter_proposal', { note: 'a pact sealed' });
                        lines.push(`📈 +5 reputation in ${k ? k.name : 'the realm'}.`);
                        break;
                    case 'truce':
                        if (kid) House.accrueRivalFeud(player, world, kid, -25, 'a truce by letter');
                        lines.push('🕊️ The feud cools.');
                        break;
                    case 'marriage': {
                        const r = Relationships.marry(player, d.npcId, world);
                        if (!r || r.success === false) return { success: false, reason: (r && r.reason) || 'The match cannot be made.' };
                        lines.push(`💍 You are wed to ${letter.from.name}.`);
                        break;
                    }
                    case 'rejoin': {
                        const r = this.rejoin(player, world, d.npcId);
                        if (!r.success) return r;
                        lines.push(`🧭 ${letter.from.name} rides to rejoin your company.`);
                        break;
                    }
                    case 'partnership': {
                        const h = MerchantHouses.rivals(player).find(x => x.id === d.houseId);
                        if (h) h.rivalry = Math.max(0, _num(h.rivalry) - 20);
                        if (d.to && d.to.kingdomId) { if (!player.reputation) player.reputation = {}; player.reputation[d.to.kingdomId] = _clamp(_num(player.reputation[d.to.kingdomId]) + 3, -100, 100); }
                        lines.push(`⚖️ ${letter.from.name} is your partner now, not your rival.`);
                        break;
                    }
                }
                break;
            case 'mail_proposal:decline':
                if (d.seal === 'marriage' && d.npcId != null && player.relationships) {
                    const rel = Relationships.getRelationship(player, d.npcId);
                    rel.affection = _clamp(_num(rel.affection) - 10, 0, 100);
                }
                break;
            case 'mail_ransom:pay': {
                const child = (player.children || []).find(c => c && c.id === d.childId);
                if (!child || !Upbringing.ensure(child).heldBy) return { success: false, reason: 'That child is no longer held.' };
                const amount = _num(d.amount);
                player.gold = _num(player.gold) - amount;
                Ledger.record(player, 'diplomacy', -amount);
                if (k) k.treasury = _num(k.treasury) + amount;
                this.release(player, world, child, Upbringing.ensure(child).heldBy.kingdomId);
                lines.push(`⛓️ ${child.firstName} is free and coming home.`);
                break;
            }
            case 'mail_ransom:refuse':
                break;
            case 'mail_request:goods':
            case 'mail_request:coin':
            case 'mail_request:refuse': {
                const res = this._answerRequest(player, world, letter, choiceId);
                if (!res.success) return res;
                lines.push(...res.lines);
                break;
            }
            case 'mail_invite:promise': {
                const v = d.visit;
                if (!v) break;
                const st = this.state(player);
                st.visits = st.visits.filter(x => x.key !== v.key);
                st.visits.push({ ...v });
                lines.push(`🗓️ You promise to be at ${v.town} by day ${v.until}.`);
                break;
            }
            case 'mail_invite:regrets':
                break;
            case 'mail_blackmail:pay': {
                const amount = _num(d.amount);
                player.gold = _num(player.gold) - amount;
                Ledger.record(player, 'hushMoney', -amount);
                break;
            }
            case 'mail_blackmail:refuse':
                if (d.to) this._scandal(world, player, d.to);
                lines.push('💔 The letter is read aloud in the market. Your spouse has heard.');
                break;
            case 'courier_bag:deliver': {
                const c = Couriers.get(world, d.courierId);
                if (c) c.reputation = _clamp(_num(c.reputation, 50) + 2, 0, 100);
                break;
            }
            case 'stolen_mailbag:burn':
                lines.push('🔥 The letter curls in the fire, its secrets with it.');
                break;
            case 'stolen_mailbag:read':
            case 'stolen_mailbag:sell':
            case 'courier_bag:read':
            case 'courier_bag:sell': {
                const E = Couriers.config().events;
                const stolen = letter.kind === 'stolen_mailbag';
                const c = Couriers.get(world, d.courierId);
                if (choiceId === 'read') {
                    const learned = typeof player.learnAboutKingdom === 'function' ? player.learnAboutKingdom(kid, ['ruler', 'military', 'diplomacy', 'economy']) : [];
                    if (k) lines.push(`📜 ${k.name}: army ${Math.round(_num(k.military))}, treasury about ${Math.round(_num(k.treasury) / 100) * 100} gold, ${(k.wars || []).length ? `at war with ${(k.wars || []).map(id => (world.getKingdom(id) || {}).name).filter(Boolean).join(', ')}` : 'at peace'}${learned.length ? ` · you learn of its ${_intelPhrase(learned)}` : ''}.`);
                } else {
                    const enemy = world.getKingdom(d.enemyId);
                    const price = _num(d.price);
                    player.gold = _num(player.gold) + price;
                    Ledger.record(player, 'mailReceipts', price);
                    if (enemy && enemy.lord) NPCLords.rememberDeed(world, enemy.lord, 'letter_shared_enemy', { note: `${k ? k.name : 'a'} letter, sold` });
                    lines.push(`💰 +${price} gold from ${enemy ? enemy.name : 'their enemy'}'s agents.`);
                }
                if (Utils.random() < (choiceId === 'read' ? E.foundOut : E.sellFoundOut)) {
                    if (c && !stolen) c.reputation = _clamp(_num(c.reputation, 50) - 15, 0, 100);
                    if (k && k.lord) NPCLords.rememberDeed(world, k.lord, 'mail_tampered');
                    const st = c && c.stations.find(s => s.key === c.home);
                    Gossip.spreadDeed(player, world, 'mail_opened', { q: st ? st.q : player.q, r: st ? st.r : player.r, location: st ? st.name : undefined, kingdom: kid, victim: k ? k.lord.name : 'a lord' });
                    lines.push(stolen
                        ? `🔓 It came out: the letter from the robbed bag was read, and ${k ? k.name : 'the crown'} knows whose hand it passed through.`
                        : `🔓 It came out: the seal was seen to have been lifted. ${c ? c.name : 'Your house'}'s name is ruined for a season, and ${k ? k.name : 'the crown'} will not forget.`);
                }
                break;
            }
        }
        return { success: true, lines };
    },

    /** An inbox letter of a mail kind left to lapse. */
    lapseReply(world, player, letter) {
        if (letter.kind === 'mail_blackmail' && letter.data && letter.data.to) this._scandal(world, player, letter.data.to);
        // A plea left unanswered is remembered
        if (letter.kind === 'mail_request' && letter.data && letter.data.to) this._warmth(player, world, letter.data.to, this.config().voice.requestLapsed, 'a plea unanswered');
        if (letter.kind === 'courier_bag') {
            const c = Couriers.get(world, letter.data && letter.data.courierId);
            if (c) c.reputation = _clamp(_num(c.reputation, 50) + 1, 0, 100);
        }
    },

    // ──────────── THE PANEL ────────────

    view(player, world) {
        const st = this.state(player);
        const day = _day(world);
        return {
            transit: st.outbox.map(L => ({ id: L.id, kind: L.kind, icon: (this.kind(L.kind) || {}).icon || '✉️', name: (this.kind(L.kind) || {}).name || L.kind, to: L.to.name, place: L.to.place, courier: L.courier.name, sentDay: L.sentDay, daysLeft: Math.max(0, L.arriveDay - day), delayed: !!L.delayed, gold: L.gold, item: L.item })),
            replies: st.replies.map(R => ({ id: R.id, from: R.from.name, daysLeft: Math.max(0, R.due - day) })),
            sent: st.sent.slice(0, 15),
            visits: st.visits.map(v => ({ ...v, daysLeft: Math.max(0, v.until - day) })),
            keepsakes: st.keepsakes.slice(0, 12),
            stats: st.stats,
            limits: { inTransit: st.outbox.length, maxInTransit: this.config().maxInTransit, today: st.today.day === day ? st.today.n : 0, perDay: this.config().perDay },
        };
    },
};
