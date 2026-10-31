// ============================================
// DEVOTION — prayer, meditation, vows, omens, alms and pilgrimage
// ============================================
// What the player's piety does, and why it can't be farmed:
//
//   devote   — prayer or meditation at a place (open ground, an altar, a
//              temple, a holy site). The gain depends on the creed the
//              player keeps (their own founded religion, or a world faith
//              they adopt), whether the place's faith is theirs, who holds a
//              holy site (a hostile or contested shrine is risky; one held by
//              another faith is half-desecrated) and the player's tenets.
//              Each devotion of the day is worth less than the last, the
//              same place within a few days is worth less again, and karma
//              per day is capped. Stat gains are small steps under a lifetime
//              cap. A soul sold to a stranger (systems/soulPact.js) dulls it.
//   omens    — now and then a vision points at a real place nearby the
//              player hasn't found: an unexplored delve, a holy site, an
//              outlaw den, an untouched ruin. The tile is revealed.
//   vows     — a devotion may move the player to swear a vow (peace,
//              sobriety, no dice, alms, a pilgrimage). Vows watch real
//              records (earned-trait deeds, quest stats, alms given) and are
//              rewarded when kept, punished when broken.
//   alms     — gold to a recipient: the temple (clergy standing, the realm's
//              piety, your faith's hold on the town), the poor (the town's
//              happiness, your reputation), a guild you belong to (standing),
//              or a named townsperson in need (their purse and regard). Each
//              town tires of the same giver: recent gifts there diminish.
//   pilgrimage — declare a holy site (a vow), walk there, kneel and make an
//              offering. The pilgrim pays, never receives. Completion gives
//              karma, faith, renown and the site's blessing; repeat visits
//              diminish; a hostile holder or a contested shrine is a risk.
//
// State on player.devotion (saved). Every roll comes from the system's own
// seeded stream (world seed + day + a counter), so nothing here moves the
// shared RNG. Content: data/devotion.json. No import-time side effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Religion } from './religion.js';
import { RealmWars } from './realmWars.js';
import { Traits } from './traits.js';
import { Ledger } from './ledger.js';
import { Quests } from './quests.js';
import { Delves } from './delves.js';
import { OutlawLairs } from './outlawLairs.js';
import { Guilds } from './guilds.js';
import { Townsfolk } from './townsfolk.js';
import { NpcDisposition } from './npcDisposition.js';
import { Gossip } from './gossip.js';
import { SoulPact } from './soulPact.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r1 = v => Math.round(v * 10) / 10;
const _r2 = v => Math.round(v * 100) / 100;
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

const WINDS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

let _cfgSrc;
let _data = null;

export const Devotion = {
    // ──────────── DATA ────────────

    data() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.devotion) || null;
        if (_data && d === _cfgSrc) return _data;
        _cfgSrc = d;
        _data = d || {};
        return _data;
    },

    config() {
        return Devotion.data().config || {};
    },

    vowDef(id) {
        return (Devotion.data().vows || {})[id] || null;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            faithId: null, faithSince: null, apostasyDay: null,
            today: { day: -1, n: 0, karma: 0 },
            places: {}, standing: {}, statGains: {},
            vows: [], offer: null, nextVowOffer: 0, lastOmenDay: -999,
            omens: [], pilgrimages: {}, donations: {},
            stats: { prayers: 0, meditations: 0, almsGiven: 0, vowsKept: 0, vowsBroken: 0, pilgrimages: 0, omens: 0 },
            log: [], n: 0,
        };
    },

    state(player) {
        if (!player) return Devotion._blank();
        let st = player.devotion;
        if (!_obj(st)) {
            player.devotion = Devotion._blank();
            return player.devotion;
        }
        const b = Devotion._blank();
        for (const k of Object.keys(b)) if (st[k] === undefined) st[k] = b[k];
        if (!_obj(st.today)) st.today = b.today;
        for (const k of ['places', 'standing', 'statGains', 'pilgrimages', 'donations']) if (!_obj(st[k])) st[k] = {};
        for (const k of ['vows', 'omens', 'log']) if (!Array.isArray(st[k])) st[k] = [];
        st.stats = { ...b.stats, ...(_obj(st.stats) || {}) };
        return st;
    },

    serialize(player) {
        return player && player.devotion ? JSON.parse(JSON.stringify(player.devotion)) : null;
    },

    loadState(player) {
        if (player && player.devotion) Devotion.state(player);
    },

    _log(st, world, text) {
        st.log.unshift({ d: _day(world), text });
        if (st.log.length > 30) st.log.length = 30;
    },

    /** A fresh seeded stream for one draw-set: world seed, day, a tag and a counter. */
    _rng(world, player, tag) {
        const st = Devotion.state(player);
        st.n = (st.n || 0) + 1;
        return Utils.seededRandom((_hash(`${_seed(world)}:devotion:${tag}:${_day(world)}:${st.n}`) % 233279) + 1);
    },

    // ──────────── CREED ────────────

    /**
     * The creed the player keeps: their own founded religion ({ id: 'own' }),
     * a world faith they adopted, or null.
     */
    creed(player) {
        if (player && player.religion && player.religion.name) {
            return { id: 'own', name: player.religion.name, icon: '🕯️', own: true, tenets: player.religion.tenets || [] };
        }
        const st = player && _obj(player.devotion);
        const fid = st && st.faithId;
        const f = fid && Religion.FAITHS[fid];
        return f ? { id: fid, name: f.name, icon: f.icon || '🙏', own: false, tenets: f.tenets || [] } : null;
    },

    /** Tenet effect sum from the player's founded religion (data → config.tenets). */
    tenet(player, key) {
        const tenets = (player && player.religion && player.religion.tenets) || [];
        const T = Devotion.config().tenets || {};
        let s = 0;
        for (const t of tenets) s += _num(T[t] && T[t][key]);
        return s;
    },

    /** Can the player take up this faith (or is there a reason not)? */
    canAdopt(player, world, faithId) {
        const f = Religion.FAITHS[faithId];
        if (!f || f.extinct) return { can: false, reason: 'No living faith by that name.' };
        if (player && player.religion) return { can: false, reason: `You keep your own faith, ${player.religion.name}.` };
        const st = Devotion.state(player);
        if (st.faithId === faithId) return { can: false, reason: `You already keep ${f.name}.` };
        const cd = _num((Devotion.config().apostasy || {}).cooldownDays, 30);
        if (st.faithId && st.faithSince != null && _day(world) - st.faithSince < cd) {
            return { can: false, reason: `You took up your faith only ${_day(world) - st.faithSince} days ago. Conversion takes longer than that.` };
        }
        return { can: true };
    },

    /** Take up a world faith. Leaving another one costs karma and standing. */
    adoptFaith(player, world, faithId) {
        const chk = Devotion.canAdopt(player, world, faithId);
        if (!chk.can) return { success: false, reason: chk.reason };
        const st = Devotion.state(player);
        const f = Religion.FAITHS[faithId];
        let karma = 0;
        if (st.faithId) {
            karma = _num((Devotion.config().apostasy || {}).karma, -5);
            player.karma = _num(player.karma) + karma;
            st.standing[st.faithId] = _r1(_num(st.standing[st.faithId]) / 2);
            st.apostasyDay = _day(world);
        }
        st.faithId = faithId;
        st.faithSince = _day(world);
        Devotion._log(st, world, `Took up ${f.name}.`);
        return { success: true, faith: f, karma };
    },

    // ──────────── PLACES ────────────

    /** The faith a place belongs to: a holy site's, a temple's (the town's realm), your own shrine's. */
    placeFaith(world, tile, place, player = null) {
        if (!tile) return null;
        if (place === 'holy' && tile.holySite) return tile.holySite.faithId || null;
        if (tile.religiousBuilding && player && player.religion && tile.religiousBuilding.religion === player.religion.name) return 'own';
        if (place === 'temple' || place === 'altar') {
            const s = tile.settlement;
            const kid = (s && s.kingdom) || tile.kingdom;
            const k = kid && world && world.getKingdom ? world.getKingdom(kid) : null;
            return (k && k.religion && k.religion.faithId) || null;
        }
        return null;
    },

    /** same | foreign | none (no creed) | unaligned (the place keeps no faith). */
    matchOf(creed, faithId) {
        if (!faithId) return 'unaligned';
        if (!creed) return 'none';
        return creed.id === faithId ? 'same' : 'foreign';
    },

    /** How the player stands with a holy site's holder: { hostile, contested, holder }. */
    siteRisk(player, world, site) {
        if (!site) return { hostile: false, contested: false, holder: null };
        const holder = site.controller && world && world.getKingdom ? world.getKingdom(site.controller) : null;
        const rep = holder && player && player.reputation ? _num(player.reputation[holder.id]) : 0;
        const hostile = !!(holder && (RealmWars.atWarWith(player, holder.id) || rep <= -20));
        // A shrine held by a realm of another faith is half-desecrated
        const desecrated = !!(holder && site.faithId && holder.religion && holder.religion.faithId && holder.religion.faithId !== site.faithId);
        return { hostile, contested: !!site.contested, holder, desecrated };
    },

    // ──────────── STATS ────────────

    /**
     * Raise a stat by up to `amount` under a lifetime cap per source (devotion:
     * config.statCaps; books: their own caps) and the absolute maximum.
     * Negative amounts lower it (not below 1). Returns the change applied.
     */
    raiseStat(player, stat, amount, source = 'devotion', caps = null) {
        if (!player || !stat || !amount) return 0;
        const cfg = Devotion.config();
        const max = _num(cfg.absoluteStatMax, 10);
        const before = _num(player[stat], 5);
        if (amount < 0) {
            player[stat] = _r2(Math.max(1, before + amount));
            return _r2(player[stat] - before);
        }
        const st = Devotion.state(player);
        const gains = st.statGains[source] = _obj(st.statGains[source]) || {};
        const cap = _num((caps || cfg.statCaps || {})[stat], Infinity);
        const room = Math.max(0, Math.min(cap - _num(gains[stat]), max - before));
        const add = _r2(Math.min(amount, room));
        if (add <= 0) return 0;
        player[stat] = _r2(before + add);
        gains[stat] = _r2(_num(gains[stat]) + add);
        return add;
    },

    standing(player, faithId) {
        const st = player && _obj(player.devotion);
        return st && faithId ? _num(st.standing[faithId]) : 0;
    },

    _addStanding(player, faithId, n) {
        if (!faithId || !n) return 0;
        const st = Devotion.state(player);
        const max = _num((Devotion.config().standing || {}).max, 100);
        const before = _num(st.standing[faithId]);
        st.standing[faithId] = _r1(_clamp(before + n, -max, max));
        return _r1(st.standing[faithId] - before);
    },

    /** Clergy standing's discount at that faith's temples (redemption, rites): 0..maxDiscount. */
    templeDiscount(player, faithId) {
        const S = Devotion.config().standing || {};
        return _clamp(Devotion.standing(player, faithId) * _num(S.templeDiscountPer, 0.004), 0, _num(S.maxDiscount, 0.35));
    },

    // ──────────── DEVOTION ────────────

    /** The place multiplier from repeated devotion at the same spot within placeRepeatDays. */
    _placeMult(st, key, day, commit) {
        const cfg = Devotion.config();
        const rec = st.places[key];
        let n = 0;
        if (rec && day - _num(rec.day) < _num(cfg.placeRepeatDays, 6)) n = _num(rec.n);
        if (commit) {
            st.places[key] = { day, n: n + 1 };
            // Keep the book short: forget places long unvisited
            const keys = Object.keys(st.places);
            if (keys.length > 60) {
                keys.sort((a, b) => st.places[a].day - st.places[b].day);
                for (const k of keys.slice(0, keys.length - 60)) delete st.places[k];
            }
        }
        return Math.pow(_num(cfg.placeRepeatMult, 0.5), n);
    },

    _today(st, day) {
        if (st.today.day !== day) st.today = { day, n: 0, karma: 0 };
        return st.today;
    },

    /**
     * What a devotion here would be worth before it is done: { mult, match,
     * dayMult, placeMult, karmaRoom, notes }. Used by the UI.
     */
    preview(player, world, ctx = {}) {
        return Devotion._compute(player, world, ctx, false);
    },

    _compute(player, world, ctx, commit) {
        const cfg = Devotion.config();
        const st = Devotion.state(player);
        const day = _day(world);
        const kind = (cfg.kinds || {})[ctx.kind] || (cfg.kinds || {}).pray || {};
        const place = (cfg.places || {})[ctx.place] || (cfg.places || {}).field || {};
        const tile = ctx.tile || null;
        const creed = Devotion.creed(player);
        const faithId = ctx.faithId !== undefined ? ctx.faithId : Devotion.placeFaith(world, tile, ctx.place, player);
        const match = Devotion.matchOf(creed, faithId);
        const matchRaw = _num((cfg.match || {})[match], 1);
        const bound = _num(kind.faithBound, 1);
        const matchMult = 1 + (matchRaw - 1) * bound;
        const today = Devotion._today(st, day);
        const dd = cfg.dayDiminish || [1];
        const dayMult = _num(dd[Math.min(today.n, dd.length - 1)], 1);
        const placeKey = ctx.placeKey || (tile ? `${ctx.place}:${_key(tile.q, tile.r)}` : `${ctx.place}:here`);
        const placeMult = Devotion._placeMult(st, placeKey, day, commit);
        const q = _clamp(ctx.quality == null ? 0.5 : _num(ctx.quality, 0.5), 0, 1);
        const qMult = 0.75 + 0.5 * q;
        const soul = SoulPact.prayerMult(player);
        const site = ctx.place === 'holy' && tile ? tile.holySite : null;
        const risk = Devotion.siteRisk(player, world, site);
        const desecrated = risk.desecrated ? _num(cfg.desecratedMult, 0.6) : 1;
        const mult = _num(place.mult, 1) * matchMult * dayMult * placeMult * qMult * desecrated;
        const karmaCap = _num(cfg.dailyKarmaCap, 6) + Devotion.tenet(player, 'karmaCap');
        const karmaRoom = Math.max(0, karmaCap - _num(today.karma));
        const notes = [];
        notes.push((cfg.matchText || {})[match] || '');
        if (dayMult < 1) notes.push(`You have already prayed ${today.n} time${today.n === 1 ? '' : 's'} today; the words come slower.`);
        if (placeMult < 1) notes.push('You knelt here only days ago; the place has given what it had.');
        if (risk.desecrated) notes.push('The shrine is held by another faith; its keepers have let it sour.');
        if (risk.hostile) notes.push(`${risk.holder ? risk.holder.name : 'Its holders'} hold this shrine, and they are no friends of yours.`);
        if (risk.contested) notes.push('The shrine is contested; the crowd is tense.');
        if (soul < 1) notes.push(soul === 0 ? 'Your prayers fall into a silence that answers nothing.' : 'Something is missing in you; the prayer echoes hollow.');
        return { kind, place, creed, faithId, match, matchMult, dayMult, placeMult, qMult, soul, mult, karmaRoom, risk, site, placeKey, notes: notes.filter(Boolean), today };
    },

    /**
     * Pray or meditate. ctx { kind: 'pray'|'meditate', place: 'field'|'altar'|
     * 'temple'|'holy', tile, quality 0..1 (minigame), faithId (override) }.
     * Returns { heal, karma, faith, intelligence, standing, omen, vowOffers,
     * fine, harm, reputation, notes, mult }.
     */
    devote(player, world, ctx = {}) {
        const cfg = Devotion.config();
        const st = Devotion.state(player);
        const c = Devotion._compute(player, world, ctx, true);
        const rng = Devotion._rng(world, player, `devote:${ctx.kind}`);
        const out = { heal: 0, karma: 0, faith: 0, intelligence: 0, standing: 0, omen: null, vowOffers: [], fine: 0, harm: 0, reputation: 0, notes: c.notes.slice(), mult: _r2(c.mult * c.soul), match: c.match, creed: c.creed };
        c.today.n += 1;
        if (ctx.kind === 'meditate') st.stats.meditations++;
        else st.stats.prayers++;

        // Body: rest heals whether or not heaven listens
        const faithStat = _num(player.faith, 5);
        let heal = (_num(c.kind.heal) + _num(c.kind.healPerFaith) * (faithStat - 3) + _num(c.place.heal)) * c.qMult * c.dayMult;
        if (ctx.kind === 'meditate') heal *= 1 + Devotion.tenet(player, 'meditateHeal');
        heal = Math.max(0, Math.round(heal));
        if (heal > 0 && Number.isFinite(player.health)) {
            const before = player.health;
            player.health = Math.min(_num(player.maxHealth, 100), player.health + heal);
            out.heal = Math.round(player.health - before);
        }

        // Spirit: karma under the daily cap, a small chance of deeper faith
        const m = c.mult * c.soul;
        const karma = _r1(Math.min(_num(c.kind.karma) * m, c.karmaRoom));
        if (karma > 0) {
            player.karma = _r1(_num(player.karma) + karma);
            c.today.karma = _r1(_num(c.today.karma) + karma);
            out.karma = karma;
        }
        const step = cfg.statStep || {};
        if (c.soul > 0 && rng() < _num(c.kind.faithChance) * m) out.faith = Devotion.raiseStat(player, 'faith', _num(step.faith, 0.25));
        if (rng() < _num(c.kind.intChance) * c.qMult * c.dayMult * c.placeMult) out.intelligence = Devotion.raiseStat(player, 'intelligence', _num(step.intelligence, 0.2));
        const piety = _num(c.kind.piety) * c.dayMult * c.placeMult * c.soul;
        if (piety >= 0.05) Traits.recordDeed(player, 'piety', _r2(piety));
        if (c.faithId && c.faithId !== 'own' && c.match === 'same') {
            out.standing = Devotion._addStanding(player, c.faithId, _num((cfg.standing || {}).prayer, 0.3) * c.dayMult * c.placeMult);
        }

        // A shrine held by enemies, or fought over, is no safe place to kneel
        if (c.site) Devotion._siteDanger(player, world, c.site, c.risk, cfg.hostileSite || {}, cfg.contestedSite || {}, rng, out);

        // Omens
        const omenGap = _num((cfg.omen || {}).cooldownDays, 6);
        if (c.soul > 0 && _day(world) - _num(st.lastOmenDay, -999) >= omenGap) {
            let chance = _num(c.place.omen) + Devotion.tenet(player, 'omen') + 0.03 * (c.qMult - 0.75) * 2;
            if (c.site && (c.site.bonusType === 'prophecy' || c.site.bonusType === 'mystery')) chance *= 2;
            chance *= c.dayMult * c.placeMult;
            if (rng() < chance) out.omen = Devotion.omen(player, world, player.q, player.r, rng);
        }

        // A vow, offered (the player chooses in the panel)
        if (c.soul > 0 && st.vows.length < _num(cfg.maxVows, 2) && _day(world) >= _num(st.nextVowOffer)) {
            if (rng() < _num(cfg.vowChance, 0.14) * _num(c.place.mult, 1) * c.dayMult) {
                out.vowOffers = Devotion._offerVows(player, world, rng);
                st.nextVowOffer = _day(world) + _num(cfg.vowOfferCooldownDays, 4);
            }
        }
        return out;
    },

    _siteDanger(player, world, site, risk, H, C, rng, out) {
        if (risk.hostile && rng() < _num(H.risk)) {
            const fine = Math.min(Math.max(0, Math.floor(_num(player.gold))), Math.round(_num(H.fineMin) + rng() * (_num(H.fineMax) - _num(H.fineMin))));
            if (fine > 0) {
                player.gold -= fine;
                Ledger.record(player, 'fines', -fine);
                if (risk.holder) risk.holder.treasury = _num(risk.holder.treasury) + fine;
                out.fine = fine;
            }
            if (risk.holder) {
                if (!player.reputation) player.reputation = {};
                player.reputation[risk.holder.id] = _num(player.reputation[risk.holder.id]) + _num(H.reputation, -3);
                out.reputation = _num(H.reputation, -3);
            }
            const harm = Math.round(_num(H.harm));
            if (harm > 0 && Number.isFinite(player.health)) {
                player.health = Math.max(1, player.health - harm);
                out.harm += harm;
            }
            out.notes.push(`${risk.holder ? risk.holder.name : 'The holders'}' wardens drag you from the shrine${fine ? ` and take ${fine} gold as a fine` : ''}.`);
        } else if (risk.contested && rng() < _num(C.risk)) {
            const harm = Math.round(_num(C.harm));
            if (harm > 0 && Number.isFinite(player.health)) {
                player.health = Math.max(1, player.health - harm);
                out.harm += harm;
            }
            out.notes.push('A scuffle breaks out between the two factions\' pilgrims, and you take a blow in the crush.');
        }
    },

    // ──────────── OMENS ────────────

    _dir(world, q, r, tq, tr) {
        const a = Hex.axialToPixel(q, r, 1);
        const b = Hex.axialToPixel(tq, tr, 1);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const i = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
        return WINDS[i];
    },

    /** The real places an omen could point at, nearest-unseen first. */
    omenCandidates(player, world, q, r) {
        const out = [];
        if (!world || typeof world.getTile !== 'function' || !Number.isFinite(q)) return out;
        const st = Devotion.state(player);
        const radius = _num((Devotion.config().omen || {}).radius, 14);
        const seen = new Set(st.omens.map(o => _key(o.q, o.r)));
        for (const h of Hex.hexesInRange(q, r, radius)) {
            const tile = world.getTile(h.q, h.r);
            if (!tile) continue;
            const tq = Number.isFinite(tile.q) ? tile.q : h.q;
            const tr = Number.isFinite(tile.r) ? tile.r : h.r;
            if (seen.has(_key(tq, tr))) continue;
            const d = Hex.distance(q, r, h.q, h.r);
            if (d < 2) continue;
            if (Delves.isDelveSite(tile) && !tile.explored) {
                const info = Delves.siteInfo(tile);
                out.push({ kind: 'delve', q: tq, r: tr, d, name: (info && info.name) || 'a dark place', w: 3 });
            } else if (tile.holySite && !st.pilgrimages[_key(tq, tr)] && !tile.explored) {
                out.push({ kind: 'holy', q: tq, r: tr, d, name: tile.holySite.name, w: 2 });
            } else if (tile.improvement && !tile.improvement.explored && !tile.explored) {
                out.push({ kind: 'poi', q: tq, r: tr, d, name: tile.improvement.name || 'a forgotten place', w: 1 });
            }
        }
        for (const l of OutlawLairs.active(player)) {
            if (l.known || l.rumoured) continue;
            const d = Hex.distance(q, r, l.q, l.r);
            if (d <= radius && !seen.has(_key(l.q, l.r))) out.push({ kind: 'lair', q: l.q, r: l.r, d, name: l.name || 'an outlaw den', w: 2, lair: l });
        }
        return out;
    },

    /** A vision of a real place nearby: revealed on the map and written in the journal. */
    omen(player, world, q, r, rng = null) {
        const st = Devotion.state(player);
        const roll = rng || Devotion._rng(world, player, 'omen');
        const cands = Devotion.omenCandidates(player, world, q, r);
        const O = Devotion.data().omens || {};
        st.lastOmenDay = _day(world);
        st.stats.omens++;
        if (!cands.length) {
            const o = { day: _day(world), kind: 'none', icon: (O.none || {}).icon || '🌫️', text: (O.none || {}).text || 'The veil shows only fog.' };
            return o;
        }
        // Weighted, nearer ones likelier
        let total = 0;
        for (const c of cands) { c.p = c.w / (1 + c.d / 6); total += c.p; }
        let x = roll() * total;
        let pick = cands[cands.length - 1];
        for (const c of cands) { x -= c.p; if (x <= 0) { pick = c; break; } }
        const tile = world.getTile(pick.q, pick.r);
        if (tile) tile.explored = true;
        if (pick.lair) pick.lair.rumoured = true;
        const def = O[pick.kind] || O.poi || {};
        const text = String(def.text || '{name}, {dist} hexes to the {dir}.')
            .replace('{name}', pick.name).replace('{dist}', pick.d).replace('{dir}', Devotion._dir(world, q, r, pick.q, pick.r));
        const o = { day: _day(world), kind: pick.kind, icon: def.icon || '✨', q: pick.q, r: pick.r, name: pick.name, text };
        st.omens.unshift(o);
        if (st.omens.length > 15) st.omens.length = 15;
        Devotion._log(st, world, `Omen: ${text}`);
        return o;
    },

    // ──────────── VOWS ────────────

    _snapshot(player, def) {
        const deeds = (player.traits && player.traits.deeds) || {};
        const stats = (player.quests && player.quests.stats) || {};
        const w = def.watch || {};
        const snap = { deeds: {}, stats: {} };
        for (const k of w.deeds || []) snap.deeds[k] = _num(deeds[k]);
        for (const k of w.stats || []) snap.stats[k] = _num(stats[k]);
        return snap;
    },

    _broken(player, vow) {
        const deeds = (player.traits && player.traits.deeds) || {};
        const stats = (player.quests && player.quests.stats) || {};
        const s = vow.snap || {};
        for (const [k, v] of Object.entries(s.deeds || {})) if (_num(deeds[k]) > v + 1e-9) return k;
        for (const [k, v] of Object.entries(s.stats || {})) if (_num(stats[k]) > v + 1e-9) return k;
        return null;
    },

    _almsTarget(player, def) {
        const g = def.gold || {};
        return Math.round(Math.min(_num(g.max, 300), _num(g.base, 40) + _num(g.perRenown, 0.5) * _num(player.renown)));
    },

    _describe(def, vow) {
        return String(def.desc || '').replace('{days}', vow.days).replace('{gold}', vow.gold || 0).replace('{site}', (vow.site && vow.site.name) || 'the shrine');
    },

    _offerVows(player, world, rng) {
        const st = Devotion.state(player);
        const all = Object.keys(Devotion.data().vows || {}).filter(id => id !== 'pilgrimage' && !st.vows.some(v => v.id === id));
        const picks = [];
        while (all.length && picks.length < 2) picks.push(all.splice(Math.floor(rng() * all.length), 1)[0]);
        st.offer = { day: _day(world), ids: picks };
        return picks.map(id => Devotion.vowPreview(player, id));
    },

    /** What a vow would bind the player to: { id, name, icon, days, gold, text }. */
    vowPreview(player, id) {
        const def = Devotion.vowDef(id);
        if (!def) return null;
        const v = { id, name: def.name, icon: def.icon, days: _num(def.days, 7) };
        if (id === 'alms') v.gold = Devotion._almsTarget(player, def);
        v.text = Devotion._describe(def, v);
        return v;
    },

    /** The vows the player may swear today (offered by a devotion today). */
    offeredVows(player, world) {
        const st = Devotion.state(player);
        if (!st.offer || st.offer.day !== _day(world)) return [];
        return st.offer.ids.filter(id => !st.vows.some(v => v.id === id)).map(id => Devotion.vowPreview(player, id)).filter(Boolean);
    },

    /** Swear an offered vow. */
    takeVow(player, world, id) {
        const st = Devotion.state(player);
        const def = Devotion.vowDef(id);
        if (!def || id === 'pilgrimage') return { success: false, reason: 'No such vow.' };
        if (!st.offer || st.offer.day !== _day(world) || !st.offer.ids.includes(id)) return { success: false, reason: 'The moment for that vow has passed.' };
        if (st.vows.some(v => v.id === id)) return { success: false, reason: 'You are already bound by that vow.' };
        if (st.vows.length >= _num(Devotion.config().maxVows, 2)) return { success: false, reason: 'You are bound by as many vows as you can keep.' };
        const v = Devotion.vowPreview(player, id);
        const vow = { id, name: v.name, icon: v.icon, days: v.days, start: _day(world), until: _day(world) + v.days, snap: Devotion._snapshot(player, def) };
        if (id === 'alms') { vow.gold = v.gold; vow.given0 = st.stats.almsGiven; }
        vow.text = Devotion._describe(def, vow);
        st.vows.push(vow);
        st.offer.ids = st.offer.ids.filter(x => x !== id);
        Devotion._log(st, world, `Swore the ${vow.name}: ${vow.text}`);
        return { success: true, vow };
    },

    /** The player's vows with their progress: [{ ...vow, daysLeft, progress }]. */
    vows(player, world) {
        const st = Devotion.state(player);
        return st.vows.map(v => {
            const o = { ...v, daysLeft: Math.max(0, v.until - _day(world)) };
            if (v.id === 'alms') o.progress = Math.min(v.gold, Math.round(st.stats.almsGiven - _num(v.given0)));
            return o;
        });
    },

    _settleVow(player, world, vow, kept, why, out) {
        const st = Devotion.state(player);
        const def = Devotion.vowDef(vow.id) || {};
        const fx = (kept ? def.keep : def.break) || {};
        if (fx.karma) player.karma = _r1(_num(player.karma) + fx.karma);
        let renown = _num(fx.renown);
        if (kept && renown) renown += Devotion.tenet(player, 'vowRenown');
        if (renown) player.renown = Math.max(0, _num(player.renown) + renown);
        let faith = 0;
        if (fx.faith) faith = Devotion.raiseStat(player, 'faith', fx.faith);
        if (fx.deeds) Traits.recordDeeds(player, fx.deeds);
        st.vows = st.vows.filter(v => v !== vow);
        if (kept) st.stats.vowsKept++;
        else st.stats.vowsBroken++;
        const text = kept
            ? `You kept the ${vow.name}. ${fx.karma ? `+${fx.karma} karma` : ''}${renown ? `, +${renown} renown` : ''}${faith ? `, faith +${faith}` : ''}.`
            : `You broke the ${vow.name}${why ? ` (${why})` : ''}. ${fx.karma ? `${fx.karma} karma` : ''}${renown ? `, ${renown} renown` : ''}${faith ? `, faith ${faith}` : ''}.`;
        Devotion._log(st, world, text);
        if (out) out.notices.push({ icon: vow.icon || '🙏', title: kept ? 'Vow Kept' : 'Vow Broken', text, type: kept ? 'success' : 'warning' });
        return { kept, text, karma: _num(fx.karma), renown, faith };
    },

    _checkAlms(player, world, out) {
        const st = Devotion.state(player);
        for (const v of st.vows.slice()) {
            if (v.id === 'alms' && st.stats.almsGiven - _num(v.given0) >= v.gold) Devotion._settleVow(player, world, v, true, null, out);
        }
    },

    // ──────────── ALMS ────────────

    _settlementKey(tile) {
        return tile ? _key(tile.q, tile.r) : 'none';
    },

    /** How much of a gift here still counts (recent giving here decays daily). */
    donationFactor(player, world, tile) {
        const D = Devotion.data().donations || {};
        const st = Devotion.state(player);
        const rec = st.donations[Devotion._settlementKey(tile)];
        if (!rec) return 1;
        const recent = _num(rec.recent) * Math.pow(1 - _num(D.recentDecayPerDay, 0.04), Math.max(0, _day(world) - _num(rec.day)));
        return 1 / (1 + recent / Math.max(1, _num(D.diminishRef, 120)));
    },

    /** The needy of a town the player could help by name (from the living roster). */
    needyFolk(world, tile, limit = 3) {
        const s = tile && tile.settlement;
        const folk = s && s.folk;
        if (!folk || !Array.isArray(folk.people)) return [];
        const day = _day(world);
        const C = Townsfolk.config();
        const list = [];
        for (const p of folk.people) {
            if (p.died != null || p.away) continue;
            const age = Townsfolk.age(p, day);
            if (age < C.comeOfAge) continue;
            const purse = Townsfolk.purse(folk, p, world);
            const hurt = Townsfolk.injury(p, day);
            const poor = p.role === 'beggar' ? 3 : (p.role === 'villager' || p.role === 'farmer') ? 1 : 0;
            const old = age >= 60 ? 1 : 0;
            const need = poor + old + (hurt ? 2 : 0) + (purse <= 3 ? 1 : 0);
            if (need <= 0) continue;
            const why = hurt ? 'hurt and unable to work' : p.role === 'beggar' ? 'begging at the gate' : old ? 'old, and alone' : 'down to their last coppers';
            list.push({ id: p.id, name: `${p.first} ${p.last}`, role: Townsfolk.roleTitle(p), why, need, purse });
        }
        return list.sort((a, b) => b.need - a.need || a.id - b.id).slice(0, limit);
    },

    /** Who can receive alms here: [{ id, kind, label, icon, detail, available, reason }]. */
    donationOptions(player, world, tile) {
        const D = Devotion.data().donations || {};
        const s = tile && tile.settlement;
        const out = [];
        if (!s) return out;
        const k = s.kingdom && world && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        const faith = k && k.religion && k.religion.faithId ? Religion.FAITHS[k.religion.faithId] : null;
        out.push({ id: 'temple', kind: 'temple', label: (D.temple || {}).label || 'The temple', icon: (D.temple || {}).icon || '⛪',
            detail: faith ? `${faith.icon} ${faith.name} — your standing with its clergy: ${Math.round(Devotion.standing(player, faith.id))}` : 'The town\'s chapel', available: true });
        out.push({ id: 'poor', kind: 'poor', label: (D.poor || {}).label || 'The poor', icon: (D.poor || {}).icon || '🥖',
            detail: `Mood in ${s.name}: ${Math.round(_num(s.happiness, 50))}/100`, available: true });
        for (const gid of Object.keys(s.guilds || {})) {
            const m = Guilds.membership(player, s, gid);
            const def = Guilds.def(gid);
            if (!def) continue;
            out.push({ id: `guild:${gid}`, kind: 'guild', label: `${def.icon || '⚒️'} ${def.name}`, icon: (D.guild || {}).icon || '⚒️',
                detail: m ? `Your standing: ${Math.round(_num(m.standing))}` : 'Only members\' gifts are taken', available: !!m, reason: m ? null : 'You are not a member.' });
        }
        for (const p of Devotion.needyFolk(world, tile)) {
            out.push({ id: `folk:${p.id}`, kind: 'folk', label: p.name, icon: (D.folk || {}).icon || '🧑', detail: `${p.role}, ${p.why}`, available: true });
        }
        return out;
    },

    /**
     * Give `amount` gold to a recipient here (an id from donationOptions).
     * Returns { success, karma, notes[] }.
     */
    donate(player, world, tile, recipient, amount) {
        const D = Devotion.data().donations || {};
        const s = tile && tile.settlement;
        amount = Math.floor(_num(amount));
        if (!s) return { success: false, reason: 'There is no one here to give to.' };
        if (amount < _num(D.minGold, 5)) return { success: false, reason: `Give at least ${_num(D.minGold, 5)} gold.` };
        if (amount > _num(player.gold)) return { success: false, reason: 'You cannot give what you do not have.' };
        const opt = Devotion.donationOptions(player, world, tile).find(o => o.id === recipient);
        if (!opt) return { success: false, reason: 'No such recipient here.' };
        if (!opt.available) return { success: false, reason: opt.reason || 'They will not take it.' };

        const st = Devotion.state(player);
        const factor = Devotion.donationFactor(player, world, tile);
        const eff = amount * factor; // what still counts here
        const k = s.kingdom && world && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        const R = D[opt.kind] || {};
        const notes = [];
        player.gold -= amount;
        Ledger.record(player, 'donation', -amount);

        // Karma: a square-root curve on what counts, softened by the soul's state
        let karma = _num(R.karmaPerGold) * Math.sqrt(eff) * Math.sqrt(10) * (1 + Devotion.tenet(player, 'donationKarma'));
        karma = _r1(karma * Math.max(0.25, SoulPact.prayerMult(player)));
        if (karma > 0) player.karma = _r1(_num(player.karma) + karma);

        if (opt.kind === 'temple') {
            const fid = k && k.religion && k.religion.faithId;
            if (fid) {
                const S = Devotion.config().standing || {};
                const gain = Devotion._addStanding(player, fid, Math.min(_num(S.maxPerGift, 6), eff * _num(S.perGold, 0.08)));
                if (gain) notes.push(`The clergy of ${Religion.FAITHS[fid] ? Religion.FAITHS[fid].name : 'the faith'} think better of you (standing +${gain}).`);
                const piety = _r2(Math.min(_num(R.maxPiety, 3), eff * _num(R.piety, 0.02)));
                if (piety > 0 && k.religion) {
                    k.religion.piety = _clamp(_num(k.religion.piety) + piety, 0, 100);
                    notes.push(`${k.name}'s piety +${piety}.`);
                }
            }
            // Your own faith's chapel in the town: its hold on the town grows
            const pres = player.religion && player.religion.presence;
            const key = _key(tile.q, tile.r);
            if (pres && pres[key] != null) {
                const add = Math.min(_num(R.maxPresence, 0.02), eff * _num(R.presence, 0.0002));
                pres[key] = Math.round(Math.min(1, _num(pres[key]) + add) * 10000) / 10000;
                if (add > 0) notes.push(`Your faith's hold on ${s.name} grows.`);
            }
            Traits.recordDeeds(player, { piety: Math.min(2, eff / 100), generosity: Math.min(2, eff / 80) });
        } else if (opt.kind === 'poor') {
            const pop = Math.max(100, _num(s.population, 500));
            const h = _r1(Math.min(_num(R.maxHappiness, 6), eff / (pop / 100) * _num(R.happinessPer100Pop, 0.6)));
            if (h > 0) {
                s.happiness = _clamp(_num(s.happiness, 50) + h, 0, 100);
                notes.push(`The town's mood lifts (+${h}).`);
            }
            if (s.kingdom) {
                if (!player.reputation) player.reputation = {};
                const rep = _r1(Math.min(_num(R.maxReputation, 5), eff * _num(R.reputationPerGold, 0.05)));
                if (rep > 0) {
                    player.reputation[s.kingdom] = _num(player.reputation[s.kingdom]) + rep;
                    notes.push(`Reputation with ${k ? k.name : 'the realm'} +${rep}.`);
                }
            }
            Traits.recordDeeds(player, { generosity: Math.min(3, eff / 60), mercy: Math.min(2, eff / 100) });
        } else if (opt.kind === 'guild') {
            const gid = recipient.slice(6);
            const m = Guilds.membership(player, s, gid);
            if (m) {
                const add = _r2(Math.min(_num(R.maxStanding, 8), eff * _num(R.standingPerGold, 0.06)));
                m.standing = _r2(Math.min(100, _num(m.standing) + add));
                notes.push(`Your standing in the guild +${add}.`);
            }
            Traits.recordDeeds(player, { generosity: Math.min(1, eff / 150) });
        } else if (opt.kind === 'folk') {
            const pid = Number(recipient.slice(5));
            const folk = s.folk;
            const p = folk && Townsfolk.get(folk, pid);
            if (p) {
                p.purse = _num(p.purse) + amount;
                const npc = { type: p.role };
                Object.defineProperty(npc, '_dialogMemory', { get: () => p.mem, set: v => { p.mem = v; }, enumerable: true });
                const disp = NpcDisposition.adjustDisposition(npc, Math.min(_num(R.maxDisposition, 20), eff * _num(R.disposition, 0.4)), player);
                NpcDisposition.recordGift(npc, player);
                notes.push(`${p.first} ${p.last} will not forget it${disp > 0 ? ` (regard +${disp})` : ''}.`);
            }
            Traits.recordDeeds(player, { generosity: Math.min(2, eff / 50), mercy: Math.min(2, eff / 50) });
        }
        if (factor < 0.6) notes.push(`${s.name} has had a great deal from you lately; this gift counts for less.`);

        const rec = st.donations[Devotion._settlementKey(tile)] || { recent: 0, day: _day(world), total: 0 };
        const decay = Math.pow(1 - _num(D.recentDecayPerDay, 0.04), Math.max(0, _day(world) - _num(rec.day)));
        rec.recent = _r1(_num(rec.recent) * decay + amount);
        rec.day = _day(world);
        rec.total = _num(rec.total) + amount;
        st.donations[Devotion._settlementKey(tile)] = rec;
        st.stats.almsGiven += amount;
        const out = { notices: [] };
        Devotion._checkAlms(player, world, out);
        Devotion._log(st, world, `Gave ${amount} gold to ${opt.label} in ${s.name}.`);
        return { success: true, amount, karma, factor: _r2(factor), notes, vowNotices: out.notices, recipient: opt };
    },

    // ──────────── PILGRIMAGE ────────────

    /** Every holy site in the world: [{ q, r, site }]. */
    holySites(world) {
        const out = [];
        if (!world || typeof world.getTile !== 'function') return out;
        for (let r = 0; r < (world.height || 0); r++) {
            for (let q = 0; q < (world.width || 0); q++) {
                const t = world.getTile(q, r);
                if (t && t.holySite) out.push({ q, r, site: t.holySite });
            }
        }
        return out;
    },

    /** Holy sites a pilgrimage could be sworn to, nearest first, with what awaits there. */
    pilgrimageTargets(player, world, limit = 8) {
        const st = Devotion.state(player);
        const creed = Devotion.creed(player);
        const P = (Devotion.vowDef('pilgrimage') || {});
        const list = [];
        for (const h of Devotion.holySites(world)) {
            const d = world.width ? Hex.wrappingDistance(player.q, player.r, h.q, h.r, world.width) : Hex.distance(player.q, player.r, h.q, h.r);
            if (d < 1) continue;
            const risk = Devotion.siteRisk(player, world, h.site);
            const f = h.site.faithId ? Religion.FAITHS[h.site.faithId] : null;
            list.push({
                q: h.q, r: h.r, name: h.site.name, icon: h.site.icon || '⛲', dist: d,
                days: Math.round(_num(P.baseDays, 8) + d * _num(P.perHex, 1.6)),
                faith: f ? f.name : null, match: Devotion.matchOf(creed, h.site.faithId),
                holder: risk.holder ? risk.holder.name : null, hostile: risk.hostile, contested: risk.contested,
                visits: _num((st.pilgrimages[_key(h.q, h.r)] || {}).n),
            });
        }
        return list.sort((a, b) => a.dist - b.dist).slice(0, limit);
    },

    /** The pilgrimage vow in progress, or null. */
    pilgrimage(player) {
        const st = player && _obj(player.devotion);
        return st ? st.vows.find(v => v.id === 'pilgrimage') || null : null;
    },

    /** Swear to walk to the holy site at (q, r). */
    declarePilgrimage(player, world, q, r) {
        const st = Devotion.state(player);
        if (Devotion.pilgrimage(player)) return { success: false, reason: 'You are already sworn to a pilgrimage.' };
        if (st.vows.length >= _num(Devotion.config().maxVows, 2)) return { success: false, reason: 'You are bound by as many vows as you can keep.' };
        const tile = world && world.getTile ? world.getTile(q, r) : null;
        if (!tile || !tile.holySite) return { success: false, reason: 'There is no holy site there.' };
        const t = Devotion.pilgrimageTargets(player, world, 999).find(x => x.q === q && x.r === r);
        if (!t) return { success: false, reason: 'You are already there. Kneel, rather than swear.' };
        const def = Devotion.vowDef('pilgrimage') || {};
        const vow = { id: 'pilgrimage', name: def.name || 'Vow of Pilgrimage', icon: def.icon || '🥾', days: t.days, start: _day(world), until: _day(world) + t.days, site: { q, r, name: t.name } };
        vow.text = Devotion._describe(def, vow);
        st.vows.push(vow);
        Devotion._log(st, world, `Swore a pilgrimage to ${t.name} (${t.days} days).`);
        return { success: true, vow, target: t };
    },

    /** What kneeling at this holy site would bring today: offerings, multipliers, risks. */
    pilgrimagePreview(player, world, tile) {
        const P = Devotion.data().pilgrimage || {};
        const site = tile && tile.holySite;
        if (!site) return null;
        const st = Devotion.state(player);
        const creed = Devotion.creed(player);
        const match = Devotion.matchOf(creed, site.faithId);
        const vow = Devotion.pilgrimage(player);
        const vowed = !!(vow && vow.site && vow.site.q === tile.q && vow.site.r === tile.r);
        const rec = st.pilgrimages[_key(tile.q, tile.r)];
        const visits = _num(rec && rec.n);
        const blessingReady = !rec || _day(world) - _num(rec.blessDay, -999) >= _num(P.blessingCooldownDays, 30);
        const risk = Devotion.siteRisk(player, world, site);
        const offerings = (P.offerings || []).map(o => ({ ...o, can: _num(player.gold) >= o.gold }));
        return { site, match, vowed, visits, blessingReady, risk, offerings, soul: SoulPact.state(player).state };
    },

    /**
     * Kneel at the holy site on `tile` with an offering (an id from
     * data → pilgrimage.offerings). The pilgrim pays; the shrine's holder
     * takes the offering. Returns the outcome.
     */
    completePilgrimage(player, world, tile, offeringId = 'token') {
        const P = Devotion.data().pilgrimage || {};
        const pre = Devotion.pilgrimagePreview(player, world, tile);
        if (!pre) return { success: false, reason: 'This is not a holy site.' };
        const site = pre.site;
        const st = Devotion.state(player);
        const key = _key(tile.q, tile.r);
        const rec = st.pilgrimages[key];
        if (rec && rec.day === _day(world)) return { success: false, reason: 'You have already made your devotions here today.' };
        const off = (P.offerings || []).find(o => o.id === offeringId) || (P.offerings || [])[0] || { id: 'token', gold: 0, mult: 1 };
        if (_num(player.gold) < off.gold) return { success: false, reason: `The offering is ${off.gold} gold.` };
        const rng = Devotion._rng(world, player, 'pilgrim');
        const out = { success: true, siteName: site.name, offering: off.gold, karma: 0, faith: 0, renown: 0, blessing: null, notes: [], vowKept: null, redeemed: false, omen: null, harm: 0, fine: 0 };

        // The offering: the pilgrim gives, the shrine's keepers take
        if (off.gold > 0) {
            player.gold -= off.gold;
            Ledger.record(player, 'donation', -off.gold);
            if (pre.risk.holder) pre.risk.holder.treasury = _num(pre.risk.holder.treasury) + off.gold;
        }

        // Worth: faith match, a vow kept, repeat visits, the soul's state, a soured shrine
        let mult = _num(off.mult, 1);
        if (pre.match === 'same') mult *= _num(P.sameFaithMult, 1.25);
        else if (pre.match === 'foreign') mult *= _num(P.foreignMult, 0.7);
        if (pre.vowed) mult *= _num(P.vowedMult, 1.5);
        mult *= Math.pow(_num(P.repeatMult, 0.5), pre.visits);
        if (pre.risk.desecrated) mult *= _num(Devotion.config().desecratedMult, 0.6);
        const soul = SoulPact.prayerMult(player);
        mult *= Math.max(soul, 0.25);

        const B = P.base || {};
        out.karma = _r1(_num(site.faithBonus, 5) * _num(B.karmaPerFaithBonus, 0.5) * mult);
        player.karma = _r1(_num(player.karma) + out.karma);
        out.renown = Math.round(_num(B.renown, 5) * mult);
        if (pre.risk.contested && !pre.risk.hostile) out.renown += _num((P.contested || {}).renownBonus, 3);
        player.renown = Math.max(0, _num(player.renown) + out.renown);
        if (soul > 0) out.faith = Devotion.raiseStat(player, 'faith', _r2(_num(B.faith, 0.5) * Math.min(1.5, mult)));
        Traits.recordDeeds(player, { piety: _r2(2 * Math.min(1.5, mult)), travel: pre.vowed ? 1 : 0 });
        if (site.faithId && pre.match === 'same') Devotion._addStanding(player, site.faithId, 2 * Math.min(1.5, mult));
        site.pilgrimCount = _num(site.pilgrimCount) + 1;

        // Danger at a hostile or contested shrine
        const danger = { notes: [], harm: 0, fine: 0, reputation: 0 };
        Devotion._siteDanger(player, world, site, pre.risk, P.hostile || {}, P.contested || {}, rng, danger);
        out.notes.push(...danger.notes);
        out.harm = danger.harm;
        out.fine = danger.fine;

        // The site's blessing (once a season per site)
        if (pre.blessingReady && soul > 0) out.blessing = Devotion._bless(player, world, tile, site, rng);
        else if (!pre.blessingReady) out.notes.push('The keepers bless you, but the shrine\'s great blessing is not given twice in a season.');

        // A vow fulfilled — and, for a soul sold, the long road home
        const vow = Devotion.pilgrimage(player);
        if (pre.vowed && vow) {
            const r = Devotion._settleVow(player, world, vow, true, null, null);
            out.vowKept = r.text;
            const pact = SoulPact.state(player);
            if ((SoulPact.config().pilgrimRedeems !== false) && pre.match === 'same' && ['sold', 'due', 'cursed'].includes(pact.state)) {
                const red = SoulPact.redeem(player, world, 'pilgrimage');
                if (red.success) { out.redeemed = true; out.notes.push(red.text); }
            }
        }

        st.pilgrimages[key] = { n: pre.visits + 1, day: _day(world), blessDay: out.blessing ? _day(world) : _num(rec && rec.blessDay, -999), name: site.name };
        st.stats.pilgrimages++;
        Quests.track(player, 'holy_sites_visited');
        Gossip.spreadDeed(player, world, 'pilgrimage_made', { q: tile.q, r: tile.r, location: site.name });
        Devotion._log(st, world, `Pilgrimage to ${site.name}: +${out.karma} karma, +${out.renown} renown.`);
        return out;
    },

    _bless(player, world, tile, site, rng) {
        const def = (Devotion.data().blessings || {})[site.bonusType];
        if (!def) return null;
        const b = { type: site.bonusType, text: def.text || 'You are blessed.', effects: [] };
        if (def.heal) {
            const before = _num(player.health);
            player.health = Math.min(_num(player.maxHealth, 100), before + _num(def.heal));
            if (player.health > before) b.effects.push(`+${Math.round(player.health - before)} health`);
        }
        for (const [k, days] of Object.entries(def.blessings || {})) {
            player.blessings = player.blessings || {};
            player.blessings[k] = Math.max(_num(player.blessings[k]), days);
            b.effects.push(`${k.replace(/_/g, ' ')} for ${days} day${days === 1 ? '' : 's'}`);
        }
        for (const [k, v] of Object.entries(def.skills || {})) {
            if (!player.skills) continue;
            const before = _num(player.skills[k]);
            player.skills[k] = _r2(Math.min(10, before + v));
            if (player.skills[k] > before) b.effects.push(`${k} +${_r2(player.skills[k] - before)}`);
        }
        for (const [k, v] of Object.entries(def.stats || {})) {
            const got = Devotion.raiseStat(player, k, v);
            if (got) b.effects.push(`${k} +${got}`);
        }
        if (def.karma) { player.karma = _r1(_num(player.karma) + def.karma); b.effects.push(`+${def.karma} karma`); }
        if (def.renown) { player.renown = _num(player.renown) + def.renown; b.effects.push(`+${def.renown} renown`); }
        if (def.faith) { const got = Devotion.raiseStat(player, 'faith', def.faith); if (got) b.effects.push(`faith +${got}`); }
        if (def.harm && Number.isFinite(player.health)) { player.health = Math.max(1, player.health - def.harm); b.effects.push(`−${def.harm} health`); }
        if (def.omen) b.omen = Devotion.omen(player, world, tile.q, tile.r, rng);
        return b;
    },

    // ──────────── DAILY ────────────

    /** Vows kept or broken, pilgrimages overdue. Returns { notices }. */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !_obj(player.devotion)) return out;
        const st = Devotion.state(player);
        const day = _day(world);
        for (const v of st.vows.slice()) {
            const def = Devotion.vowDef(v.id);
            if (!def) { st.vows = st.vows.filter(x => x !== v); continue; }
            if (v.id === 'pilgrimage' || v.id === 'alms') {
                if (day > v.until) Devotion._settleVow(player, world, v, false, v.id === 'pilgrimage' ? 'you never reached the shrine' : 'the alms were never given', out);
                continue;
            }
            const broke = Devotion._broken(player, v);
            if (broke) Devotion._settleVow(player, world, v, false, Devotion._brokeText(broke), out);
            else if (day >= v.until) Devotion._settleVow(player, world, v, true, null, out);
        }
        return out;
    },

    _brokeText(k) {
        return { valor: 'you fought', cruelty: 'blood was spilled', dread: 'you put a town in fear', battles_won: 'you won a battle', drinking: 'you drank', gambling: 'you gambled' }[k] || k;
    },
};
