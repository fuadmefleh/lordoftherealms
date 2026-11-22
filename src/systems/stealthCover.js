// ============================================
// STEALTH COVER — the odds of hiding, being seen, and springing an ambush
// ============================================
// The pure half of hiding in cover on the street map (world/streetCover.js
// says where cover is; ui/innerMapHiding.js plays it):
//
//   noticeRate   how fast a watcher notices someone hidden (per second):
//                distance against a sight range the dark, fog and rain cut
//                short (a light carried gives the dark no say, a torch gives
//                cover little), the cover's quality, the hider's Stealth,
//                moving or still, armour that clanks; the watcher's kind (the
//                watch sharper, alert sharper still, a child or a chatterer
//                duller, the observant by their traits).
//   noticeChance the rate over a tick: 1 - e^(-rate * dt).
//   perception   the player as the watcher of someone lying in wait for them.
//   surprise     the first blow from cover: its weight and the chance it fells
//                them outright; blindside — they never saw who.
//   grabChance / mugChance  seizing and binding someone; a blade at their back.
//   lurkChance / lurkKind   someone lying in wait for the player: how likely
//                this hour, and who (a footpad, a cutthroat, an outlaw in the
//                wilds, a bounty hunter, a rival House's hired blade or
//                assassin).
//
// Numbers in data/stealthCover.json. No randomness here and no globals:
// callers pass every fact and roll their own dice.

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

let _cfg = null;
let _src;

export const StealthCover = {
    config() {
        const d = (DataLoader.get && DataLoader.get('stealthCover')) || (DataLoader._gamedata && DataLoader._gamedata.stealthCover) || null;
        if (_cfg && _src === d) return _cfg;
        _src = d;
        const c = _obj(d);
        _cfg = {
            cover: _obj(c.cover), props: _obj(c.props), fields: Array.isArray(c.fields) ? c.fields : [],
            ground: _obj(c.ground), townCover: _obj(c.townCover), sight: _obj(c.sight), watcher: _obj(c.watcher),
            hider: _obj(c.hider), perceive: _obj(c.perceive), train: _obj(c.train), ambush: _obj(c.ambush),
            lurk: _obj(c.lurk), listen: _obj(c.listen), lines: _obj(c.lines),
        };
        return _cfg;
    },

    /** A kind of cover's { quality, word, minDarkness } (null when unknown). */
    coverDef(kind) {
        const d = StealthCover.config().cover[kind];
        return d ? { quality: _clamp(_num(d.quality, 0.5), 0, 0.98), word: d.word || kind, minDarkness: _num(d.minDarkness, 0) } : null;
    },

    /** The watcher's sight range (tiles) in this light and weather. */
    sightRange(env = {}) {
        const S = StealthCover.config().sight;
        let range = _num(S.range, 9);
        // (a light carried by the one hidden shows them whatever the dark: the dark cuts nothing;
        // the watcher's own light shows half of what the dark hides — watcherLit)
        const dark = env.lit ? 0 : _clamp(_num(env.darkness), 0, 1) * (env.watcherLit ? 0.5 : 1);
        range *= 1 - _num(S.darkCut, 0.65) * dark;
        range *= 1 - _num(S.fogCut, 0.5) * _clamp(_num(env.fog), 0, 1);
        range *= 1 - _num(S.rainCut, 0.25) * _clamp(_num(env.rain), 0, 1);
        range *= 1 - _num(S.snowCut, 0.2) * _clamp(_num(env.snow), 0, 1);
        return Math.max(_num(S.minRange, 1.5), range);
    },

    /** Stealth's share of notice left (level 1 → 1, each level less, to the floor). */
    stealthFactor(level) {
        const H = StealthCover.config().hider;
        const lv = Math.max(1, _num(level, 1));
        return Math.max(_num(H.stealthFloor, 0.4), 1 - _num(H.stealthPerLevel, 0.06) * (lv - 1));
    },

    /**
     * How fast a watcher notices one hidden, per second.
     * @param {object} o {
     *   dist, cover (0..1 quality, 0 = in the open), darkness, fog, rain, snow,
     *   lit (a light carried by the one hidden: lantern or torch), torch (a burning torch),
     *   watcherLit (the watcher carries a light),
     *   stealth (level), moving, armour (0..1 share of a blow it stops),
     *   watcher: { guard, child, alert, chatting, working, perceptive, asleep } }
     * @returns {number} rate per second (0 when out of sight)
     */
    noticeRate(o = {}) {
        const C = StealthCover.config();
        const S = C.sight, W = C.watcher, H = C.hider;
        const w = _obj(o.watcher);
        if (w.asleep) return 0;
        const dist = Math.max(0, _num(o.dist, 99));
        const range = StealthCover.sightRange(o);
        if (dist > range) return 0;
        let rate = _num(S.rate, 0.9) * Math.pow(Math.max(0, 1 - dist / range), _num(S.falloff, 1.5));
        // Brushing past: whatever the cover, someone beside you may well see you
        if (dist <= 1) rate = Math.max(rate, _num(S.adjacent, 0.35));
        // The cover: a torch gives you away in any bush, a lantern half-way
        let hide = 1 - _clamp(_num(o.cover), 0, 0.98);
        if (o.torch) hide = Math.max(hide, _num(H.torch, 0.85));
        else if (o.lit && _num(o.darkness) > 0.2) hide = Math.max(hide, _num(H.lantern, 0.55));
        rate *= hide;
        rate *= StealthCover.stealthFactor(o.stealth);
        if (o.moving) rate *= _num(H.moving, 2.2);
        rate *= 1 + _num(H.armour, 1.6) * _clamp(_num(o.armour), 0, 1);
        if (w.guard) rate *= _num(W.guard, 1.6);
        if (w.child) rate *= _num(W.child, 0.8);
        if (w.alert) rate *= _num(W.alert, 2.2);
        if (w.chatting) rate *= _num(W.chatting, 0.6);
        if (w.working) rate *= _num(W.working, 0.8);
        if (w.perceptive) rate *= _num(W.perceptive, 1.35);
        if (Number.isFinite(w.mult)) rate *= Math.max(0, w.mult);
        return Math.max(0, rate);
    },

    /** The chance a rate notices within dt seconds. */
    noticeChance(rate, dt) {
        const r = Math.max(0, _num(rate)), t = Math.max(0, _num(dt));
        return 1 - Math.exp(-r * t);
    },

    /** Are these traits an observant watcher's? */
    perceptiveTraits(traits) {
        const list = StealthCover.config().watcher.perceptiveTraits || [];
        return Array.isArray(traits) && traits.some(t => list.includes(String(t).toLowerCase()));
    },

    /**
     * The player's eye for someone lying in wait: a multiplier on the notice
     * (Stealth level — knowing how it's done — and the cunning, the wanderer).
     * @param {number} level the player's Stealth
     * @param {string[]} traits the player's earned trait ids
     */
    perception(level, traits = []) {
        const P = StealthCover.config().perceive;
        let m = _num(P.base, 1) + _num(P.perLevel, 0.07) * (Math.max(1, _num(level, 1)) - 1);
        const T = _obj(P.traits);
        for (const t of traits || []) m += _num(T[t]);
        return Math.max(0.2, m);
    },

    /** A lurker's own Stealth by kind. */
    npcStealth(kind) {
        const N = _obj(StealthCover.config().hider.npcStealth);
        return _num(N[kind], _num(N.base, 3));
    },

    /**
     * The first blow from cover.
     * @param {object} o { stealth, darkness, lit, unaware, brawling (fighting barehanded or a cudgel),
     *   guard (the victim is of the watch), child, fromCover }
     * @returns {{ mult:number, koChance:number }}
     */
    surprise(o = {}) {
        const A = StealthCover.config().ambush;
        const K = _obj(A.ko);
        let mult = o.fromCover === false ? 1 : _num(A.strikeMult, 1.8);
        if (o.unaware) mult *= _num(A.unawareMult, 1.3);
        const dark = !o.lit && _num(o.darkness) >= 0.45;
        let ko = _num(K.base, 0.2) + _num(K.perStealth, 0.03) * (Math.max(1, _num(o.stealth, 1)) - 1);
        if (dark) ko += _num(K.night, 0.1);
        if (o.brawling) ko += _num(K.brawling, 0.12);
        if (o.unaware) ko += _num(K.unaware, 0.1);
        if (o.guard) ko += _num(K.guard, -0.15);
        if (o.child) ko += _num(K.child, 0.3);
        if (o.fromCover === false) ko *= 0.5;
        return { mult, koChance: _clamp(ko, 0, _num(K.max, 0.8)) };
    },

    /**
     * Do they never see who struck them? Felled by the blow they never saw
     * coming, or struck down unaware in the dark without a light to show you.
     */
    blindside(o = {}) {
        if (!o.unaware) return false;
        if (o.felled) return true;
        return !o.lit && _num(o.darkness) >= 0.6;
    },

    /** Seize and bind: { brawling, stealth, unaware, night, guard, child, aggressive } → 0..1. */
    grabChance(o = {}) {
        const G = _obj(StealthCover.config().ambush.grab);
        let p = _num(G.base, 0.3) + _num(G.perBrawling, 0.04) * (Math.max(1, _num(o.brawling, 1)) - 1)
            + _num(G.perStealth, 0.02) * (Math.max(1, _num(o.stealth, 1)) - 1);
        if (o.unaware) p += _num(G.unaware, 0.25);
        if (o.night) p += _num(G.night, 0.05);
        if (o.guard) p += _num(G.guard, -0.25);
        if (o.child) p += _num(G.child, 0.25);
        if (o.aggressive) p += _num(G.aggressive, -0.1);
        return _clamp(p, _num(G.min, 0.05), _num(G.max, 0.9));
    },

    /** A blade at their back: do they hand over the purse? { armed, unaware, night, guard, aggressive, noble } → 0..1. */
    mugChance(o = {}) {
        const M = _obj(StealthCover.config().ambush.mug);
        let p = _num(M.base, 0.45);
        if (o.armed) p += _num(M.armed, 0.15);
        if (o.unaware) p += _num(M.unaware, 0.15);
        if (o.night) p += _num(M.night, 0.1);
        if (o.guard) p += _num(M.guard, -0.5);
        if (o.aggressive) p += _num(M.aggressive, -0.3);
        if (o.noble) p += _num(M.noble, -0.05);
        return _clamp(p, _num(M.min, 0.05), _num(M.max, 0.92));
    },

    /**
     * The chance someone lies in wait for the player this game hour.
     * @param {object} o { night, wilds, bounty (gold on your head), feud (a rival House's, 0..100),
     *   assassinPlot, nemesis, poor (a poor town), lair (an outlaw lair near), curfew }
     */
    lurkChance(o = {}) {
        const L = StealthCover.config().lurk;
        const base = _obj(o.wilds ? L.wilds : L.perHour);
        let p = _num(o.night ? base.night : base.day);
        const M = _obj(L.mult);
        let m = 1;
        const bounty = Math.max(0, _num(o.bounty));
        if (bounty > 0) m *= _num(M.bounty, 1.5) + _num(M.bountyPer100, 0.25) * bounty / 100;
        const feud = _clamp(_num(o.feud), 0, 100);
        if (feud > 0) m *= 1 + _num(M.feud, 0.02) * feud;
        if (o.assassinPlot) m *= _num(M.assassinPlot, 2.5);
        if (o.nemesis) m *= _num(M.nemesis, 1.6);
        if (o.poor) m *= _num(M.poor, 1.4);
        if (o.lair) m *= _num(M.lair, 1.6);
        if (o.curfew) m *= _num(M.curfew, 0.7);
        m = Math.min(m, _num(M.max, 5));
        return _clamp(p * m, 0, 1);
    },

    /**
     * Who lies in wait (a roll 0..1): weighed by what drew them. The wilds send
     * outlaws; a bounty, hunters; a hot feud or a rival's assassin plot, its men.
     */
    lurkKind(roll, o = {}) {
        const K = _obj(StealthCover.config().lurk.kinds);
        const w = {};
        for (const [id, k] of Object.entries(K)) {
            if (o.night ? k.night === false : k.day === false) continue;
            w[id] = Math.max(0, _num(k.weight));
        }
        if (o.wilds) { for (const id of Object.keys(w)) w[id] *= 0.25; w.outlaw = (w.outlaw || 0) + 4; }
        if (_num(o.bounty) > 0 && K.hunter) w.hunter = (w.hunter || 0) + 1 + _num(o.bounty) / 150;
        if (_num(o.feud) >= 40 && K.agent) w.agent = (w.agent || 0) + _num(o.feud) / 30;
        if (o.assassinPlot && K.assassin) w.assassin = (w.assassin || 0) + 3;
        const ids = Object.keys(w).filter(id => w[id] > 0);
        if (!ids.length) return 'footpad';
        const total = ids.reduce((s, id) => s + w[id], 0);
        let r = _clamp(_num(roll), 0, 0.999999) * total;
        for (const id of ids) { r -= w[id]; if (r < 0) return id; }
        return ids[ids.length - 1];
    },

    /** A lurker kind's record (name, role, rob, kill, hp). */
    lurkDef(kind) {
        const K = _obj(StealthCover.config().lurk.kinds);
        return _obj(K[kind] || K.footpad);
    },

    /** XP to Stealth for a deed (data train.<key>) × n. */
    xp(key, n = 1) {
        return _num(StealthCover.config().train[key]) * n;
    },

    /** A line from a pool, picked by a roll 0..1, {house} filled. */
    line(pool, roll, vars = {}) {
        const list = StealthCover.config().lines[pool];
        if (!Array.isArray(list) || !list.length) return null;
        const s = list[Math.floor(_clamp(_num(roll), 0, 0.999999) * list.length)];
        return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    },
};
