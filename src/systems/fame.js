// ============================================
// FAME — how the people of one realm see the player
// ============================================
// Renown is one number; fame is what it means in a given place. For each
// realm the player's renown, their standing (reputation) there, their karma,
// the honours their House has won (systems/house.js ambitions) and — on the
// dark side — bad standing, black karma and underworld heat combine into a
// local fame *stage* (data/fame.json):
//
//   good   stranger → known → celebrated → legend
//   ill    distrusted → shunned
//
// The stage is read by real systems:
//   - npcDisposition.getPriceModifiers: traders shade their prices
//   - npcDisposition.seedFromStanding: the first impression of a townsperson
//     (and a rival House ruling the realm makes its people colder)
//   - ui/npcDialog greetings: stage-gated lines here and in data/chatter.json
//     (the `fame` condition)
//   - player/tavern: free meal and room for the celebrated (once a week a town)
//   - systems/underworld: the shunned pay more to bribe the watch and are
//     shadowed (black-market deals are caught more often)
//   - arriving in a town: crowds, well-wishers' gifts, or guards falling in
//   - petitions: a celebrated or legendary hero is now and then begged for
//     help by a townsperson — a real favour made through the quest machinery
//     (Quests.createNpcTask → systems/npcTasks.js), drawn on its own seeded
//     stream (data/fame.json requests)
//
// State: player.fame = { towns: { "q,r": { meal, room, crowd } } } (saved by
// systems/saveLoad.js). Rolls are hashes of the world seed, the town and the
// day — never the shared RNG. Gold flows through Ledger.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Ledger } from './ledger.js';
import { Quests } from './quests.js';
import { Townsfolk } from './townsfolk.js';

const DEFAULTS = {
    enabled: true,
    weights: { renown: 0.35, rep: 0.45, karma: 0.08, badRep: 0.7, badKarma: 0.35, heat: 0.5, rivalFeud: 0.15 },
    perkCooldownDays: 7,
    crowdCooldownDays: 10,
    stages: [
        { id: 'stranger', kind: 'good', min: 0, label: 'Stranger', icon: '🚶', price: 0, disposition: 0 },
        { id: 'known', kind: 'good', min: 15, label: 'Known', icon: '🗣️', price: -0.03, disposition: 5 },
        { id: 'celebrated', kind: 'good', min: 40, label: 'Celebrated', icon: '🌟', price: -0.06, disposition: 10, freeMeal: true, freeRoom: true, crowd: true },
        { id: 'legend', kind: 'good', min: 80, label: 'Legend', icon: '👑', price: -0.1, disposition: 18, freeMeal: true, freeRoom: true, crowd: true, gifts: [5, 25] },
        { id: 'distrusted', kind: 'ill', min: 25, label: 'Distrusted', icon: '🤨', price: 0.06, disposition: -8, bribeMult: 1.25 },
        { id: 'shunned', kind: 'ill', min: 55, label: 'Shunned', icon: '🚫', price: 0.15, disposition: -18, bribeMult: 1.6, shadowed: true, shadowCatch: 0.08 },
    ],
    crowdLines: {}, giftLines: [], shadowLines: [], greetings: {},
    rivalSeed: { perFeud: 0.25, max: 20, minFeud: 15 },
    requests: {
        enabled: true, chance: { celebrated: 0.15, legend: 0.35 }, cooldownDays: 20, townCooldownDays: 45, maxOpen: 1,
        hooks: [], lines: [],
    },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

let _cfg = null;
let _cfgSrc;

/** A deterministic unit roll from a string (no shared RNG). */
function _roll(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 100000) / 100000;
}

function _pick(arr, key) {
    return Array.isArray(arr) && arr.length ? arr[Math.floor(_roll(key) * arr.length) % arr.length] : null;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

export const Fame = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.fame : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const o = _obj(src) || {};
            _cfg = {
                ...DEFAULTS, ...o,
                weights: { ...DEFAULTS.weights, ...(_obj(o.weights) || {}) },
                rivalSeed: { ...DEFAULTS.rivalSeed, ...(_obj(o.rivalSeed) || {}) },
                requests: { ...DEFAULTS.requests, ...(_obj(o.requests) || {}) },
                stages: Array.isArray(o.stages) && o.stages.length ? o.stages : DEFAULTS.stages,
            };
        }
        return _cfg;
    },

    stageDef(id) {
        return Fame.config().stages.find(s => s.id === id) || Fame.config().stages[0];
    },

    // ── Reckoning ──────────────────────────────────────

    /** Fame from the House's honours (completed ambitions), everywhere. */
    honourFame(player) {
        const h = player && player.house && Array.isArray(player.house.honours) ? player.house.honours : [];
        return h.reduce((t, x) => t + _num(x && x.fame), 0);
    },

    /** The rival House ruling this realm, if the player has one there: { kingdomId, name, feud }. */
    rivalHouse(player, kingdomId) {
        const rivals = player && player.house && player.house.rivals;
        const r = rivals && kingdomId != null ? rivals[kingdomId] : null;
        return r ? { kingdomId, name: r.name, feud: _num(r.feud) } : null;
    },

    /** Good and ill fame scores in a realm: { good, ill }. */
    scores(player, kingdomId) {
        if (!player) return { good: 0, ill: 0 };
        const W = Fame.config().weights;
        const rep = kingdomId != null && player.reputation ? _num(player.reputation[kingdomId]) : 0;
        const karma = _num(player.karma);
        const heat = kingdomId != null && player.underworld && player.underworld.heat ? _num(player.underworld.heat[kingdomId]) : 0;
        const rival = Fame.rivalHouse(player, kingdomId);
        const good = _num(player.renown) * W.renown + Math.max(0, rep) * W.rep + Math.max(0, karma) * W.karma + Fame.honourFame(player);
        const ill = Math.max(0, -rep) * W.badRep + Math.max(0, -karma) * W.badKarma + heat * W.heat
            + (rival ? rival.feud * W.rivalFeud : 0);
        return { good: Math.round(good * 10) / 10, ill: Math.round(ill * 10) / 10 };
    },

    /**
     * The player's fame stage in a realm: the stage definition plus
     * { good, ill, kingdomId }.
     */
    stageIn(player, kingdomId) {
        const C = Fame.config();
        const { good, ill } = Fame.scores(player, kingdomId);
        let stage = null;
        if (C.enabled !== false) {
            const ills = C.stages.filter(s => s.kind === 'ill' && ill >= _num(s.min)).sort((a, b) => _num(b.min) - _num(a.min));
            if (ills.length && ill >= good) stage = ills[0];
            if (!stage) {
                const goods = C.stages.filter(s => s.kind !== 'ill' && good >= _num(s.min)).sort((a, b) => _num(b.min) - _num(a.min));
                stage = goods[0] || null;
            }
        }
        stage = stage || C.stages.find(s => s.kind !== 'ill') || DEFAULTS.stages[0];
        return { ...stage, good, ill, kingdomId: kingdomId != null ? kingdomId : null };
    },

    /** The realm of the settlement at (q, r) (or the tile's), or null. */
    _kingdomAt(world, q, r) {
        const tile = world && typeof world.getTile === 'function' && q != null ? world.getTile(q, r) : null;
        return (tile && tile.settlement && tile.settlement.kingdom) || (tile && tile.kingdom) || null;
    },

    /** Fame where the player stands (or at q, r). */
    here(player, world, q = null, r = null) {
        const qq = q != null ? q : player && player.q;
        const rr = r != null ? r : player && player.r;
        return Fame.stageIn(player, Fame._kingdomAt(world, qq, rr));
    },

    // ── What it does ───────────────────────────────────

    /** Price shift for traders in this realm: { shift, label } (positive = dearer). */
    priceShift(player, kingdomId) {
        const st = Fame.stageIn(player, kingdomId);
        return { shift: _num(st.price), label: st.label, stage: st.id };
    },

    /**
     * How a townsperson of this realm first sees the player:
     * { delta, reasons:[{label, delta}] } — the fame stage, and a rival House's feud.
     */
    dispositionSeed(player, kingdomId) {
        const reasons = [];
        const st = Fame.stageIn(player, kingdomId);
        let delta = _num(st.disposition);
        if (delta) reasons.push({ label: st.label, delta });
        const R = Fame.config().rivalSeed;
        const rival = Fame.rivalHouse(player, kingdomId);
        if (rival && rival.feud >= _num(R.minFeud)) {
            const d = -Math.min(_num(R.max, 20), Math.round(rival.feud * _num(R.perFeud, 0.25)));
            if (d) { delta += d; reasons.push({ label: `${rival.name}'s feud`, delta: d }); }
        }
        return { delta, reasons, stage: st.id };
    },

    /** Multiplier on what it costs to bribe the watch here. */
    bribeMult(player, kingdomId) {
        return Math.max(1, _num(Fame.stageIn(player, kingdomId).bribeMult, 1));
    },

    /** Extra chance a shady deal here is caught because guards shadow the player. */
    shadowCatch(player, kingdomId) {
        const st = Fame.stageIn(player, kingdomId);
        return st.shadowed ? _num(st.shadowCatch, 0.08) : 0;
    },

    /** A stage-gated greeting for this realm (or null): deterministic by `key`. */
    greeting(player, world, settlement, key = '') {
        if (!player || !settlement) return null;
        const st = Fame.stageIn(player, settlement.kingdom);
        const pool = (Fame.config().greetings || {})[st.id];
        const line = _pick(pool, `${key}|fame|${st.id}`);
        if (!line) return null;
        const k = world && typeof world.getKingdom === 'function' && settlement.kingdom ? world.getKingdom(settlement.kingdom) : null;
        return _fill(line, { player: player.name || 'stranger', town: settlement.name || 'this town', kingdom: (k && k.name) || 'the realm' });
    },

    // ── Inns ───────────────────────────────────────────

    _state(player) {
        if (!player) return { towns: {} };
        if (!_obj(player.fame)) player.fame = { towns: {} };
        if (!_obj(player.fame.towns)) player.fame.towns = {};
        return player.fame;
    },

    _town(player, tile) {
        const key = `${tile.q},${tile.r}`;
        const st = Fame._state(player);
        if (!_obj(st.towns[key])) st.towns[key] = {};
        return st.towns[key];
    },

    /** Will the house stand the player a meal / room here today? kind: 'meal' | 'room'. */
    innFree(player, world, tile, kind) {
        if (!player || !tile || !tile.settlement) return false;
        const st = Fame.stageIn(player, tile.settlement.kingdom);
        if (!(kind === 'meal' ? st.freeMeal : st.freeRoom)) return false;
        const t = player.fame && player.fame.towns ? player.fame.towns[`${tile.q},${tile.r}`] : null;
        const last = t ? t[kind] : null;
        const day = _num(world && world.day);
        return last == null || day - last >= _num(Fame.config().perkCooldownDays, 7);
    },

    /** Take the free meal / room (call after innFree said yes). */
    claimInn(player, world, tile, kind) {
        Fame._town(player, tile)[kind] = _num(world && world.day);
    },

    // ── Arriving in a town ─────────────────────────────

    /**
     * Arriving at a settlement: a crowd (celebrated, legend), a well-wisher's
     * gift (legend), or guards falling in behind (shunned). Returns notices
     * [{ icon, title, text, type }].
     */
    onEnterSettlement(player, world, tile) {
        const out = [];
        const s = tile && tile.settlement;
        if (!player || !s || Fame.config().enabled === false) return out;
        const st = Fame.stageIn(player, s.kingdom);
        const C = Fame.config();
        const day = _num(world && world.day);
        const town = Fame._town(player, tile);
        const seed = (world && world.generationParams && world.generationParams.seed) || 1;
        const key = `${seed}|${tile.q},${tile.r}|${day}`;
        const vars = { town: s.name || 'the town', player: player.name || 'you' };
        if (town.crowd != null && day - town.crowd < _num(C.crowdCooldownDays, 10)) return out;
        if (st.crowd) {
            town.crowd = day;
            const line = _pick((C.crowdLines || {})[st.id], `${key}|crowd`);
            if (line) out.push({ icon: st.icon || '🌟', title: `${st.label} in ${s.name}`, text: _fill(line, vars), type: 'success' });
            if (player.modifyNeed) player.modifyNeed('social', 10);
            if (Array.isArray(st.gifts) && st.gifts.length >= 2 && _roll(`${key}|gift`) < 0.5) {
                const lo = _num(st.gifts[0]);
                const hi = Math.max(lo, _num(st.gifts[1]));
                const gold = lo + Math.floor(_roll(`${key}|giftAmt`) * (hi - lo + 1));
                if (gold > 0) {
                    player.gold = _num(player.gold) + gold;
                    Ledger.record(player, 'admirers', gold);
                    const g = _pick(C.giftLines, `${key}|giftLine`) || 'A well-wisher presses {gold} gold on you.';
                    out.push({ icon: '🎁', title: 'A Gift', text: _fill(g, { ...vars, gold }), type: 'success' });
                }
            }
            const asked = Fame.townRequest(player, world, tile, st);
            if (asked) out.push(asked);
        } else if (st.shadowed) {
            town.crowd = day;
            const line = _pick(C.shadowLines, `${key}|shadow`);
            if (line) out.push({ icon: '👁️', title: `${st.label} in ${s.name}`, text: _fill(line, vars), type: 'warning' });
        }
        return out;
    },

    // ── Requests: the famous are asked for help ───────

    /** The seeded stream a town's request is drawn on (never the shared RNG). */
    _requestRng(world, tile) {
        const seed = (world && world.generationParams && world.generationParams.seed) || 1;
        return Utils.seededRandom((Utils.hashStr(`${seed}|fame-request|${tile.q},${tile.r}|${_num(world && world.day)}`) >>> 0) % 233279 + 1);
    },

    /** Open favours the player's fame brought them. */
    openRequests(player) {
        const act = player && player.quests && Array.isArray(player.quests.active) ? player.quests.active : [];
        return act.filter(q => q && q.fameRequest);
    },

    /**
     * A celebrated or legendary hero arriving in a town may be begged for a
     * favour (data/fame.json requests): a townsperson's real request, made a
     * tracked task (Quests.createNpcTask). The pick, the asker and any band
     * the task spawns are drawn on the request's own seeded stream. Returns a
     * notice, or null.
     */
    townRequest(player, world, tile, stage = null) {
        const R = Fame.config().requests;
        const s = tile && tile.settlement;
        if (!R || R.enabled === false || !player || !player.quests || !s || !world) return null;
        const st = stage || Fame.stageIn(player, s.kingdom);
        const chance = _num(_obj(R.chance) ? R.chance[st.id] : 0);
        if (!(chance > 0)) return null;
        const day = _num(world.day);
        const fs = Fame._state(player);
        if (fs.lastRequest != null && day - fs.lastRequest < _num(R.cooldownDays, 20)) return null;
        const town = Fame._town(player, tile);
        if (town.req != null && day - town.req < _num(R.townCooldownDays, 45)) return null;
        if (Fame.openRequests(player).length >= _num(R.maxOpen, 1)) return null;
        const hooks = (Array.isArray(R.hooks) ? R.hooks : []).filter(h => h && h.text && h.type && Quests.NPC_TASK_OBJECTIVES[h.type]);
        if (!hooks.length) return null;
        return Utils.withRng(Fame._requestRng(world, tile), () => {
            if (Utils.random() >= chance) return null;
            const hook = hooks[Math.floor(Utils.random() * hooks.length) % hooks.length];
            // The asker: a real townsperson where the town keeps its folk, else a nameless local
            const folk = s.folk;
            const people = folk ? Townsfolk.residents(folk).filter(p => Townsfolk.age(p, day) >= 16) : [];
            const p = people.length ? people[Math.floor(Utils.random() * people.length) % people.length] : null;
            const npc = p
                ? { id: `fame_${tile.q}_${tile.r}_${p.id}`, uid: `${folk.q != null ? folk.q : tile.q},${folk.r != null ? folk.r : tile.r}#${p.id}`, name: Townsfolk.name(p) }
                : { id: `fame_${tile.q}_${tile.r}_${day}`, name: `a ${hook.role || 'townsman'} of ${s.name}` };
            const res = Quests.createNpcTask(player, hook, npc, world);
            if (!res || !res.success) return null;
            res.quest.fameRequest = { stage: st.id, day, town: s.name };
            fs.lastRequest = day;
            town.req = day;
            const vars = { town: s.name || 'the town', player: player.name || 'you', who: npc.name, stage: st.label };
            const lead = _fill(_pick(R.lines, `${tile.q},${tile.r}|${day}|reqLine`) || '{who} pushes through the crowd: word of you has reached {town}, and they need your help.', vars);
            const first = res.quest.objectives && res.quest.objectives[0];
            return { icon: '🙏', title: `A Plea in ${s.name}`, text: `${lead} "${hook.text}"${first && first.text ? ` (Journal: ${first.text}.)` : ''}`, type: 'info', questId: res.quest.id };
        });
    },

    // ── Persistence ────────────────────────────────────

    serialize(player) {
        return player && _obj(player.fame) ? JSON.parse(JSON.stringify(player.fame)) : null;
    },

    restore(player, data) {
        if (!player) return;
        player.fame = _obj(data) ? { towns: _obj(data.towns) || {} } : { towns: {} };
        if (_obj(data) && Number.isFinite(data.lastRequest)) player.fame.lastRequest = data.lastRequest;
    },
};
