// ============================================
// PROFANE CRIMES — sins against the dead and the faithful
// ============================================
// Three dark acts, each with coin that comes from somewhere real and a
// memory that outlives the one who did it (data/profaneCrimes.json):
//
//   THE CRYPT   A rival House (house.rivals, systems/rivalHouses.js) keeps
//               its dead in a crypt at its seat (`rival.crypt`: grave goods
//               and bones; each head who dies after the first is laid there
//               with goods bought out of the House's purse). Break in by
//               night to ROB it (the goods → your packs as grave_goods) or to
//               SCATTER the bones of their fathers (bones → your packs; the
//               deeper insult). Seen (stealth, the House's guard) and it is
//               known at once: Gossip 'desecration', the town's memory. Unseen,
//               the House finds the crypt broken and in time learns whose hand
//               it was (weekly roll). Once known the House never forgets:
//               `rival.profaned.floor` — its feud never falls below it, through
//               every new head (read weekly here; RivalHouses' own cooling and
//               succession cannot take it lower); a remembered deed in the
//               head's memory; a grudge offered to Nemesis.wrong (and sworn
//               again by every new head). Your own faith sees it (clergy
//               standing, karma). Bring the bones back and pay a requiem
//               (`rebury`): the floor halves — it never goes.
//   RELICS      A town's temple keeps a reliquary (stock by a hash of the
//               town). Lift one (seen: fined, the faith's standing and the
//               realm's piety lost); sell an House relic heirloom; or FORGE a
//               fake from charnel bones and a gilt box. A temple pays out of
//               its realm's towns' purses (Religion.offeringsFromRealm, else
//               the town's own): a true relic sold to another faith costs you
//               with your own clergy (and is sometimes found out); a fake may be
//               exposed any day for two years (`player.profane.sold`), and then
//               the temple takes restitution, the realm's reputation and the
//               faith's standing fall and Gossip carries 'relic_fraud'.
//   THE WITCH   Cry witch on a healer or an old woman (the npc dialog). Before
//               the priest (a trial: your charisma and renown, a bribe, the
//               realm's piety against her trade and her kin) or to the street
//               (a mob: she dies, you get only part of her purse). Condemned,
//               she dies (Townsfolk.slay — the town loses its healer, read by
//               systems/illness.js), her purse is seized (your share, the rest
//               to the town's purse) and her land — the lot she held, else a
//               free lot of the town — passes to you as the law allows
//               (Laws.mayHoldLand; player.lotHoldings). Her kin remember it as a
//               blood wrong (NpcMemory 'witch_burned' → Nemesis' folk grudges,
//               prices, work, testimony); the town remembers. Acquitted, you are
//               the false accuser: Gossip 'false_witch', her kin's grudge.
//
// Every act writes the House's chronicle (House._chronicle → the Annals).
// Rules: explicit params, no domain globals; player acts draw on Utils'
// seeded stream, the daily tick on its own stream (world seed + day). State:
// player.profane (saved), rival.crypt / rival.profaned (saved with the House).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { LotBook } from '../world/lotBook.js';
import { House } from './house.js';
import { RivalHouses } from './rivalHouses.js';
import { Nemesis } from './nemesis.js';
import { Gossip } from './gossip.js';
import { NpcMemory } from './npcMemory.js';
import { Devotion } from './devotion.js';
import { Religion } from './religion.js';
import { Heirlooms } from './heirlooms.js';
import { Townsfolk } from './townsfolk.js';
import { Ledger } from './ledger.js';
import { Laws } from './laws.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

function _inv(player) {
    if (!player.inventory || typeof player.inventory !== 'object') player.inventory = {};
    return player.inventory;
}
function _give(player, id, n) {
    const inv = _inv(player);
    inv[id] = _num(inv[id]) + n;
}
function _take(player, id, n) {
    const inv = _inv(player);
    inv[id] = Math.max(0, _num(inv[id]) - n);
    if (!inv[id]) delete inv[id];
}

const DEFAULTS = {
    crypt: {
        startGoods: 4, funeralGoods: 2, funeralGoodGold: 30, startBones: 9, takeGoods: 4, takeBones: 6,
        seen: { base: 0.42, perStealth: 0.03, perGuard: 0.015, scatterExtra: 0.12, min: 0.06, max: 0.9 },
        feud: { rob: 22, scatter: 40 }, floor: { rob: 35, scatter: 60 }, memory: { rob: -45, scatter: -75 },
        nemesisScore: { rob: 55, scatter: 90 }, faithStanding: { rob: -6, scatter: -14 }, karma: { rob: -6, scatter: -12 },
        learnWeekly: 0.05, learnPerFeud: 0.002,
        rebury: { cost: 160, floorMult: 0.5, feud: -15, memory: 25, karma: 6, standing: 6 },
        townMemoryWeight: -16,
    },
    relics: {
        stockRange: [1, 3],
        price: { base: 240, pietyMin: 0.6, pietyMax: 1.5, fakeMult: 0.95, foreignMult: 1.25 },
        steal: { seenBase: 0.4, perStealth: 0.03, min: 0.05, max: 0.85, fine: 80, reputation: -12, standing: -12, piety: -3 },
        sell: { buyerPiety: 3, ownFaithStanding: -18, ownFaithKarma: -8, betrayalFound: 0.35, betrayalStanding: -20, foundStanding: 10 },
        fake: { bones: 2, gold: 30, qualityBase: 0.35, perIntelligence: 0.04, perCraft: 0.02, qualityMax: 0.9 },
        expose: { daily: 0.006, windowDays: 720, fineMult: 1.5, reputation: -16, standing: -25, karma: -4 },
    },
    witch: {
        oldAge: 55,
        trial: { base: 0.42, perCharisma: 0.03, perRenown: 0.002, maxRenown: 0.15, healer: -0.15, perKin: -0.03, maxKin: 5, piety: 0.004, bribe: 0.18, bribeGold: 60, min: 0.08, max: 0.92 },
        accuserShare: 0.34, mobLootShare: 0.5,
        karma: { trial: -10, mob: -16, acquitted: -4 }, standingSameFaith: 5,
        renown: { acquitted: -6, mob: -4 }, reputation: { mob: -10, acquitted: -6 },
        cause: 'burned as a witch', mobCause: 'killed by a mob, cried a witch',
    },
    names: { saints: ['Aldwin'], relics: ['the finger of Saint {saint}'], fakes: ['the finger of Saint {saint}'] },
    lines: {},
};

let _cfg = null;
let _cfgSrc;

export const ProfaneCrimes = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.profaneCrimes : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            const deep = (base, over) => {
                const out = { ...base };
                for (const [k, v] of Object.entries(_obj(over) || {})) {
                    if (k.startsWith('_')) continue;
                    out[k] = _obj(v) && _obj(base[k]) ? deep(base[k], v) : v;
                }
                return out;
            };
            _cfg = {
                crypt: deep(DEFAULTS.crypt, d.crypt), relics: deep(DEFAULTS.relics, d.relics), witch: deep(DEFAULTS.witch, d.witch),
                names: { ...DEFAULTS.names, ...(_obj(d.names) || {}) }, lines: { ...(_obj(d.lines) || {}) },
            };
        }
        return _cfg;
    },

    line(key, vars = {}, fallback = '') {
        return _fill(ProfaneCrimes.config().lines[key] || fallback, vars);
    },

    /** player.profane: the relics in hand, the relics sold (fakes awaiting exposure), the witches cried. */
    state(player) {
        let st = player.profane;
        if (!_obj(st)) st = player.profane = {};
        if (!Array.isArray(st.relics)) st.relics = [];
        if (!Array.isArray(st.sold)) st.sold = [];
        if (!Array.isArray(st.witches)) st.witches = [];
        if (!Number.isFinite(st.seq)) st.seq = 0;
        if (!_obj(st.stats)) st.stats = { crypts: 0, relicsStolen: 0, relicsSold: 0, fakesMade: 0, fakesExposed: 0, witches: 0, burned: 0 };
        return st;
    },

    _chronicle(player, world, text) {
        if (player && player.house) House._chronicle(player.house, world, text, ['crime', 'profane']);
    },

    _creedId(player) {
        const c = Devotion.creed(player);
        return c ? c.id : null;
    },

    _settlementAt(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        return (t && t.settlement) || null;
    },

    _kingdom(world, id) {
        return id != null && world && typeof world.getKingdom === 'function' ? world.getKingdom(id) : ((world && world.kingdoms) || []).find(k => k && k.id === id) || null;
    },

    _stealth(player) {
        return _num(player.skills && player.skills.stealth);
    },

    // ──────────── THE CRYPT ────────────

    /** The rival Houses whose seat is the town the player stands in. */
    rivalsHere(player, world) {
        return RivalHouses.rivals(player).filter(r => r && r.seat && r.seat.q === player.q && r.seat.r === player.r);
    },

    /** A rival's crypt (made on first asking): { goods, bones, heads, broken }. */
    crypt(rival) {
        const C = ProfaneCrimes.config().crypt;
        if (!_obj(rival.crypt)) {
            const heads = _num(rival.stats && rival.stats.heads, 1);
            rival.crypt = { goods: _num(C.startGoods, 4), bones: _num(C.startBones, 9), heads, broken: null };
        }
        return rival.crypt;
    },

    /** The chance of being seen at it (0..1). how: 'rob' | 'scatter'. */
    seenChance(player, rival, how = 'rob') {
        const S = ProfaneCrimes.config().crypt.seen;
        let p = _num(S.base) - ProfaneCrimes._stealth(player) * _num(S.perStealth) + _num(rival.guard) * _num(S.perGuard);
        if (how === 'scatter') p += _num(S.scatterExtra);
        return Math.round(_clamp(p, _num(S.min, 0.05), _num(S.max, 0.9)) * 100) / 100;
    },

    /** What the crypt panel shows. */
    cryptView(player, world, rival) {
        const cr = ProfaneCrimes.crypt(rival);
        const pf = rival.profaned || null;
        const C = ProfaneCrimes.config().crypt;
        const bones = Math.floor(_num(player.inventory && player.inventory.bones));
        const owed = pf ? _num(pf.bonesTaken) - _num(pf.bonesReturned) : 0;
        return {
            kingdomId: rival.kingdomId, house: rival.name, head: rival.head ? RivalHouses.headName(rival) : null,
            goods: cr.goods, bones: cr.bones, broken: cr.broken,
            seenRob: ProfaneCrimes.seenChance(player, rival, 'rob'), seenScatter: ProfaneCrimes.seenChance(player, rival, 'scatter'),
            profaned: pf ? { kind: pf.kind, known: !!pf.known, floor: pf.floor, day: pf.day } : null,
            canRob: cr.goods > 0, canScatter: cr.bones > 0,
            rebury: pf && pf.known && owed > 0 ? { owed, have: bones, cost: _num(C.rebury.cost), ok: bones >= owed && _num(player.gold) >= _num(C.rebury.cost) } : null,
        };
    },

    /**
     * Break into a rival House's crypt. how: 'rob' (its grave goods) or 'scatter'
     * (the bones of their fathers). → { success, seen, text, goods, bones }
     */
    desecrate(player, world, kingdomId, how = 'rob', rnd = Utils.random) {
        const rival = RivalHouses.rival(player, kingdomId);
        if (!rival) return { success: false, reason: 'No such House is your rival.' };
        if (!rival.seat || rival.seat.q !== player.q || rival.seat.r !== player.r) return { success: false, reason: `The crypt of ${rival.name} is at its seat${rival.seat ? `, ${rival.seat.name}` : ''}.` };
        const C = ProfaneCrimes.config().crypt;
        const cr = ProfaneCrimes.crypt(rival);
        const day = _day(world);
        if (cr.broken === day) return { success: false, reason: 'The crypt was broken tonight already; the sexton is up with a lantern.' };
        const scatter = how === 'scatter';
        let goods = 0;
        let bones = 0;
        if (scatter) {
            if (cr.bones <= 0) return { success: false, reason: 'Their dead are already scattered.' };
            bones = Math.min(cr.bones, _num(C.takeBones, 6));
            cr.bones -= bones;
            _give(player, 'bones', bones);
            // (what goods lay with them come too)
            goods = Math.min(cr.goods, Math.ceil(_num(C.takeGoods, 4) / 2));
        } else {
            if (cr.goods <= 0) return { success: false, reason: 'Nothing is left beside their dead to take.' };
            goods = Math.min(cr.goods, _num(C.takeGoods, 4));
        }
        if (goods > 0) {
            cr.goods -= goods;
            _give(player, 'grave_goods', goods);
        }
        cr.broken = day;
        const kind = scatter ? 'scatter' : 'rob';
        const seen = rnd() < ProfaneCrimes.seenChance(player, rival, kind);
        // The record the House keeps (the worse deed stands)
        const prev = _obj(rival.profaned);
        const pf = rival.profaned = {
            kind: prev && prev.kind === 'scatter' ? 'scatter' : kind,
            day, by: player.name || 'you', gen: (player.house && player.house.generation) || 1,
            known: !!(prev && prev.known), floor: prev ? _num(prev.floor) : 0, heads: _num(rival.stats && rival.stats.heads, 1),
            bonesTaken: _num(prev && prev.bonesTaken) + bones, bonesReturned: _num(prev && prev.bonesReturned),
            town: (rival.seat && rival.seat.name) || null, times: _num(prev && prev.times) + 1,
        };
        // The gods see it, whoever else does
        const creed = ProfaneCrimes._creedId(player);
        if (creed) Devotion._addStanding(player, creed, _num(C.faithStanding[kind]));
        player.karma = _num(player.karma) + _num(C.karma[kind]);
        const st = ProfaneCrimes.state(player);
        st.stats.crypts++;
        const vars = { house: rival.name, goods, bones, town: pf.town || 'their seat' };
        let text = ProfaneCrimes.line(scatter ? 'cryptScatter' : 'cryptRob', vars, `You break into the crypt of ${rival.name}.`);
        if (scatter && goods) text += ` (${goods} grave goods besides.)`;
        if (seen) {
            ProfaneCrimes._known(player, world, rival, kind, { seen: true });
            text += ` ${ProfaneCrimes.line('cryptSeen', vars, 'You were seen.')}`;
        } else {
            text += ` ${ProfaneCrimes.line('cryptUnseen', vars, 'No one saw.')}`;
            RivalHouses._note(rival, world, 'Found the crypt of the House broken open.', 'bereaved');
        }
        return { success: true, seen, goods, bones, text, kind };
    },

    /** The House knows whose hand it was: the feud, a floor it never falls below, its memory, a nemesis. */
    _known(player, world, rival, kind, opts = {}) {
        const C = ProfaneCrimes.config().crypt;
        const pf = rival.profaned;
        if (!pf) return;
        kind = pf.kind === 'scatter' ? 'scatter' : kind;
        const first = !pf.known;
        pf.known = true;
        pf.knownDay = _day(world);
        pf.floor = Math.max(_num(pf.floor), _num(C.floor[kind]));
        House.accrueRivalFeud(player, world, rival.kingdomId, _num(C.feud[kind]), kind === 'scatter' ? 'the bones of their fathers scattered' : 'their crypt robbed');
        if (_num(rival.feud) < pf.floor) rival.feud = pf.floor;
        if (!Array.isArray(rival.memory)) rival.memory = [];
        rival.memory.push({ kind: kind === 'scatter' ? 'desecrated' : 'cryptRobbed', day: _day(world), w: _num(C.memory[kind]), note: pf.town || null });
        const M = RivalHouses.config().memory;
        if (rival.memory.length > _num(M.keep, 14)) rival.memory.splice(0, rival.memory.length - _num(M.keep, 14));
        RivalHouses.event(rival, world, 'insulted');
        RivalHouses._note(rival, world, kind === 'scatter' ? 'Learned who scattered the bones of the House\'s dead.' : 'Learned who robbed the House\'s crypt.');
        ProfaneCrimes._nemesis(player, world, rival, kind);
        if (opts.seen) {
            const s = ProfaneCrimes._settlementAt(world, player.q, player.r);
            if (s) {
                Gossip.accuse(player, world, 'desecration', { q: s.q, r: s.r, victim: rival.name, credibility: 0.9 });
                NpcMemory.rememberTown(world, s, { kind: 'crypt_profaned', player, victim: rival.name, weight: _num(C.townMemoryWeight, -16) });
            }
        }
        if (first) {
            const vars = { ruler: player.name || 'The head of the House', house: rival.name, town: pf.town || 'their seat' };
            ProfaneCrimes._chronicle(player, world, ProfaneCrimes.line(kind === 'scatter' ? 'chronicleScatter' : 'chronicleRob', vars, `${vars.ruler} profaned the crypt of ${rival.name}.`));
        }
    },

    _nemesis(player, world, rival, kind) {
        const C = ProfaneCrimes.config().crypt;
        Nemesis.wrong(player, world, {
            kind: 'house', ref: { kingdomId: rival.kingdomId }, name: rival.head ? RivalHouses.headName(rival) : rival.name, line: rival.name,
            deed: { key: 'desecration', label: kind === 'scatter' ? 'the bones of their fathers scattered' : 'their crypt robbed', note: rival.profaned && rival.profaned.town },
            score: _num(C.nemesisScore[kind], 60),
        });
    },

    /** Bring the bones back and pay for a requiem: the floor halves, the feud cools a little. */
    rebury(player, world, kingdomId) {
        const rival = RivalHouses.rival(player, kingdomId);
        const pf = rival && rival.profaned;
        if (!pf || !pf.known) return { success: false, reason: 'They do not know it was you. To bring the bones back would tell them.' };
        if (!rival.seat || rival.seat.q !== player.q || rival.seat.r !== player.r) return { success: false, reason: 'The bones go back to their crypt, at the House\'s seat.' };
        const C = ProfaneCrimes.config().crypt;
        const R = C.rebury;
        const owed = _num(pf.bonesTaken) - _num(pf.bonesReturned);
        if (owed <= 0) return { success: false, reason: 'Their bones are back where they lay.' };
        const have = Math.floor(_num(player.inventory && player.inventory.bones));
        if (have < owed) return { success: false, reason: `You took ${owed} sets of their bones; you carry ${have}.` };
        const cost = _num(R.cost);
        if (_num(player.gold) < cost) return { success: false, reason: `The requiem costs ${cost}g.` };
        _take(player, 'bones', owed);
        player.gold = _num(player.gold) - cost;
        Ledger.record(player, 'faith', -cost);
        const s = ProfaneCrimes._settlementAt(world, player.q, player.r);
        if (s) Economy.payTown(s, cost);
        const cr = ProfaneCrimes.crypt(rival);
        cr.bones += owed;
        pf.bonesReturned = _num(pf.bonesReturned) + owed;
        pf.floor = Math.round(_num(pf.floor) * _num(R.floorMult, 0.5));
        pf.reburied = _day(world);
        rival.feud = _clamp(_num(rival.feud) + _num(R.feud), pf.floor, 100);
        RivalHouses.remember(rival, world, 'bonesReturned');
        const last = rival.memory[rival.memory.length - 1];
        if (last && last.kind === 'bonesReturned' && !last.w) last.w = _num(R.memory);
        player.karma = _num(player.karma) + _num(R.karma);
        const creed = ProfaneCrimes._creedId(player);
        if (creed) Devotion._addStanding(player, creed, _num(R.standing));
        return { success: true, text: ProfaneCrimes.line('cryptRebury', { house: rival.name }, 'You bring the bones back.') };
    },

    /** Weekly: the floors held, the unseen deed found out, a new head's oath, a funeral's goods laid in. */
    _cryptWeek(player, world, rnd, out) {
        const C = ProfaneCrimes.config().crypt;
        for (const rival of RivalHouses.rivals(player)) {
            if (!rival) continue;
            const heads = _num(rival.stats && rival.stats.heads, 1);
            if (_obj(rival.crypt) && heads > _num(rival.crypt.heads, heads)) {
                // A head was laid in the crypt: bones, and goods bought out of the House's purse
                const cr = rival.crypt;
                const n = heads - _num(cr.heads, heads);
                cr.heads = heads;
                cr.bones += n;
                const want = n * _num(C.funeralGoods, 2);
                const each = _num(C.funeralGoodGold, 30);
                const afford = each > 0 ? Math.min(want, Math.floor(Math.max(0, _num(rival.gold)) / each)) : want;
                cr.goods += afford;
                rival.gold = Math.max(0, _num(rival.gold) - afford * each);
            }
            const pf = _obj(rival.profaned);
            if (!pf) continue;
            if (!pf.known) {
                const p = _num(C.learnWeekly) + _num(rival.feud) * _num(C.learnPerFeud);
                if (rnd() < p) {
                    ProfaneCrimes._known(player, world, rival, pf.kind);
                    out.notices.push({ icon: '⚰️', title: 'They Know', text: ProfaneCrimes.line('cryptLearned', { house: rival.name }, `${rival.name} has learned it was you.`), type: 'warning' });
                }
                continue;
            }
            // The House never forgets: no cooling, no new head takes the feud below the floor
            if (_num(rival.feud) < _num(pf.floor)) rival.feud = _num(pf.floor);
            if (heads > _num(pf.heads, heads)) {
                pf.heads = heads;
                if (_num(pf.floor) > 0) {
                    ProfaneCrimes._nemesis(player, world, rival, pf.kind);
                    out.notices.push({ icon: '⚰️', title: 'An Oath Over the Bones', text: ProfaneCrimes.line('cryptNewHead', { house: rival.name, head: rival.head ? RivalHouses.headName(rival) : 'The new head' }, `${rival.name} swears vengeance anew.`), type: 'warning' });
                }
            }
        }
    },

    // ──────────── RELICS ────────────

    /** The temple of a town: its realm and that realm's faith, or null. */
    templeOf(world, s) {
        if (!s) return null;
        const k = ProfaneCrimes._kingdom(world, s.kingdom);
        const fid = k && k.religion && k.religion.faithId;
        if (!fid) return null;
        const f = Religion.FAITHS[fid] || { name: k.religion.name || fid, icon: k.religion.icon || '⛪' };
        return { kingdom: k, faithId: fid, faith: f.name, icon: f.icon || '⛪', piety: _num(k.religion.piety, 50) };
    },

    /** The reliquary of a town's temple: { stock, taken } (stock by a hash of the town, made on first asking). */
    reliquary(world, s) {
        if (!_obj(s.reliquary)) {
            const [lo, hi] = ProfaneCrimes.config().relics.stockRange;
            const n = lo + (_hash(`${world && world.seed}|${s.q},${s.r}|reliquary`) % (Math.max(0, hi - lo) + 1));
            s.reliquary = { stock: n, taken: 0 };
        }
        return s.reliquary;
    },

    _relicName(world, key, fake = false) {
        const N = ProfaneCrimes.config().names;
        const saints = N.saints || ['Aldwin'];
        const pool = (fake ? N.fakes : N.relics) || N.relics || ['the relic of Saint {saint}'];
        const h = _hash(key);
        return _fill(pool[h % pool.length], { saint: saints[(h >>> 8) % saints.length] });
    },

    relics(player) {
        return ProfaneCrimes.state(player).relics;
    },

    /** The House's relic heirlooms the ruler holds (systems/heirlooms.js), for sale. */
    houseRelics(player) {
        return Heirlooms.held(player).filter(h => h.kind === 'relic');
    },

    /** What this temple would pay for a relic. */
    relicPrice(world, s, relic) {
        const P = ProfaneCrimes.config().relics.price;
        const t = ProfaneCrimes.templeOf(world, s);
        if (!t) return 0;
        let p = _num(P.base) * _clamp(t.piety / 50, _num(P.pietyMin, 0.6), _num(P.pietyMax, 1.5));
        // (a relic of another god is a prize to take from them)
        if (relic && !relic.fake && relic.faithId && relic.faithId !== t.faithId) p *= _num(P.foreignMult, 1);
        if (relic && relic.fake) p *= _num(P.fakeMult, 1);
        return Math.max(1, Math.round(p));
    },

    /** The chance of being seen lifting a relic. */
    stealChance(player) {
        const S = ProfaneCrimes.config().relics.steal;
        return Math.round(_clamp(_num(S.seenBase) - ProfaneCrimes._stealth(player) * _num(S.perStealth), _num(S.min), _num(S.max)) * 100) / 100;
    },

    /** Lift a relic from this town's temple. */
    stealRelic(player, world, s, rnd = Utils.random) {
        const t = ProfaneCrimes.templeOf(world, s);
        if (!t) return { success: false, reason: 'There is no temple here with a reliquary.' };
        const R = ProfaneCrimes.reliquary(world, s);
        if (R.stock <= 0) return { success: false, reason: 'The reliquary stands empty.' };
        const S = ProfaneCrimes.config().relics.steal;
        const st = ProfaneCrimes.state(player);
        const seen = rnd() < ProfaneCrimes.stealChance(player);
        // Lifted or not, the realm's faithful feel the loss of their saints
        if (seen) {
            const fine = _num(S.fine);
            const paid = Math.min(fine, Math.max(0, _num(player.gold)));
            player.gold = _num(player.gold) - paid;
            Ledger.record(player, 'fines', -paid);
            Economy.payTown(s, paid);
            if (!player.reputation) player.reputation = {};
            player.reputation[t.kingdom.id] = _num(player.reputation[t.kingdom.id]) + _num(S.reputation);
            Devotion._addStanding(player, t.faithId, _num(S.standing));
            return { success: false, caught: true, reason: ProfaneCrimes.line('relicCaught', { fine: paid, town: s.name }, `You are caught and fined ${paid}g.`) };
        }
        R.stock -= 1;
        R.taken += 1;
        t.kingdom.religion.piety = _clamp(_num(t.kingdom.religion.piety, 50) + _num(S.piety), 0, 100);
        const id = `rl${++st.seq}`;
        const relic = { id, name: ProfaneCrimes._relicName(world, `${s.q},${s.r}|${R.taken}`), faithId: t.faithId, fake: false, from: `the temple of ${s.name}`, day: _day(world) };
        st.relics.push(relic);
        st.stats.relicsStolen++;
        player.karma = _num(player.karma) - 4;
        return { success: true, relic, text: ProfaneCrimes.line('relicStolen', { relic: relic.name, town: s.name }, `You take ${relic.name}.`) };
    },

    /** How good a fake the player would make (0..1): wits and a craftsman's hand. */
    fakeQuality(player) {
        const F = ProfaneCrimes.config().relics.fake;
        const craft = _num(player.skills && (player.skills.crafting ?? player.skills.craft));
        return Math.round(_clamp(_num(F.qualityBase) + (_num(player.intelligence, 5) - 5) * _num(F.perIntelligence) + craft * _num(F.perCraft), 0.05, _num(F.qualityMax, 0.9)) * 100) / 100;
    },

    /** Forge a relic from charnel bones and a gilt box (bought from the town's purse). */
    forgeRelic(player, world, s) {
        const F = ProfaneCrimes.config().relics.fake;
        const bones = Math.floor(_num(player.inventory && player.inventory.bones));
        if (bones < _num(F.bones)) return { success: false, reason: `A fake wants ${F.bones} sets of bones (the charnel sells them); you carry ${bones}.` };
        const gold = _num(F.gold);
        if (_num(player.gold) < gold) return { success: false, reason: `The gilt box costs ${gold}g.` };
        _take(player, 'bones', _num(F.bones));
        player.gold = _num(player.gold) - gold;
        Ledger.record(player, 'fraud', -gold);
        if (s) Economy.payTown(s, gold);
        const st = ProfaneCrimes.state(player);
        const id = `rl${++st.seq}`;
        const relic = { id, name: ProfaneCrimes._relicName(world, `fake|${id}|${_day(world)}`, true), faithId: null, fake: true, quality: ProfaneCrimes.fakeQuality(player), from: 'your own hands', day: _day(world) };
        st.relics.push(relic);
        st.stats.fakesMade++;
        player.karma = _num(player.karma) - 2;
        return { success: true, relic, text: ProfaneCrimes.line('fakeMade', { relic: relic.name }, `You make ${relic.name}.`) };
    },

    /** The temple pays out of its realm's faithful (else the town's own purse). → what was paid. */
    _templePays(world, s, t, price) {
        let paid = 0;
        try { paid = Religion.offeringsFromRealm(t.kingdom, world, price, 'templeMaxPurseShare'); } catch (e) { paid = 0; }
        if (paid < price) paid += Economy.drawTown(s, price - paid);
        return Math.floor(paid);
    },

    /**
     * Sell a relic to this town's temple: one from your packs (relicId 'rl…') or a
     * House relic heirloom (its id 'hl_…'). → { success, gold, text }
     */
    sellRelic(player, world, s, relicId, rnd = Utils.random) {
        const t = ProfaneCrimes.templeOf(world, s);
        if (!t) return { success: false, reason: 'There is no temple here to buy it.' };
        const st = ProfaneCrimes.state(player);
        const C = ProfaneCrimes.config().relics;
        const heir = String(relicId).startsWith('hl_') ? Heirlooms.get(player, relicId) : null;
        let relic = heir ? null : st.relics.find(r => r.id === relicId);
        if (heir) {
            if (heir.status !== 'held' || heir.kind !== 'relic') return { success: false, reason: 'You do not hold that relic.' };
            relic = { id: heir.id, name: heir.name, faithId: ProfaneCrimes._creedId(player), fake: false, heirloom: true };
        }
        if (!relic) return { success: false, reason: 'You carry no such relic.' };
        if (!relic.fake && relic.faithId === t.faithId) {
            // Brought home: the priests pay a finder's thanks and think the better of you
            const price = Math.round(ProfaneCrimes.relicPrice(world, s, relic) * 0.5);
            const paid = ProfaneCrimes._templePays(world, s, t, price);
            ProfaneCrimes._handOver(player, world, st, relic, heir, s, t);
            player.gold = _num(player.gold) + paid;
            Ledger.record(player, 'faith', paid);
            Devotion._addStanding(player, t.faithId, _num(C.sell.foundStanding));
            return { success: true, gold: paid, text: `The priests of ${t.faith} take ${relic.name} home with thanks, and ${paid}g for the finder.` };
        }
        const price = ProfaneCrimes.relicPrice(world, s, relic);
        const paid = ProfaneCrimes._templePays(world, s, t, price);
        if (paid <= 0) return { success: false, reason: 'The temple has no coin to pay for it.' };
        ProfaneCrimes._handOver(player, world, st, relic, heir, s, t);
        player.gold = _num(player.gold) + paid;
        Ledger.record(player, 'fraud', paid);
        st.stats.relicsSold++;
        t.kingdom.religion.piety = _clamp(_num(t.kingdom.religion.piety, 50) + _num(C.sell.buyerPiety), 0, 100);
        let text = ProfaneCrimes.line('relicSold', { faith: t.faith, town: s.name, gold: paid, relic: relic.name }, `Sold for ${paid}g.`);
        if (relic.fake) {
            st.sold.push({ id: relic.id, name: relic.name, quality: _num(relic.quality, 0.4), price: paid, kingdomId: t.kingdom.id, faithId: t.faithId, q: s.q, r: s.r, town: s.name, day: _day(world), until: _day(world) + _num(C.expose.windowDays, 720) });
            return { success: true, gold: paid, text };
        }
        // A true relic sold to another god: your own clergy's loss, and perhaps the world's knowledge
        const own = ProfaneCrimes._creedId(player);
        if (own && relic.faithId === own) {
            Devotion._addStanding(player, own, _num(C.sell.ownFaithStanding));
            player.karma = _num(player.karma) + _num(C.sell.ownFaithKarma);
            text += ` ${ProfaneCrimes.line('relicBetrayal', {}, '')}`;
        }
        if (relic.faithId && rnd() < _num(C.sell.betrayalFound)) {
            Devotion._addStanding(player, relic.faithId, _num(C.sell.betrayalStanding));
            Gossip.accuse(player, world, 'relic_betrayal', { q: s.q, r: s.r, victim: relic.name, credibility: 0.8 });
            const f = Religion.FAITHS[relic.faithId];
            text += ` ${ProfaneCrimes.line('relicBetrayalFound', { relic: relic.name, faith: t.faith, own: f ? f.name : 'your faith' }, 'It is found out.')}`;
        }
        ProfaneCrimes._chronicle(player, world, ProfaneCrimes.line('chronicleRelicSold', { ruler: player.name || 'The head of the House', relic: relic.name, faith: t.faith }, `${player.name} sold ${relic.name}.`));
        return { success: true, gold: paid, text };
    },

    _handOver(player, world, st, relic, heir, s, t) {
        if (heir) {
            heir.status = 'sold';
            heir.trail = { q: s.q, r: s.r, place: s.name, holder: `the temple of ${t.faith}`, kingdomId: t.kingdom.id, price: Math.round(Heirlooms.pawnValue(heir) * 1.6), since: _day(world), how: 'sold' };
            Heirlooms._unbear(heir, _day(world));
            Heirlooms.addLine(heir, world, `Sold by ${player.name || 'the House'} to the priests of ${t.faith} at ${s.name}`, 0);
        } else {
            st.relics = st.relics.filter(r => r.id !== relic.id);
        }
    },

    /** A fake found out: restitution, the realm's and the faith's anger, the talk. */
    _expose(player, world, sale, out) {
        const E = ProfaneCrimes.config().relics.expose;
        const st = ProfaneCrimes.state(player);
        sale.exposed = _day(world);
        st.stats.fakesExposed++;
        const fine = Math.round(_num(sale.price) * _num(E.fineMult, 1.5));
        const s = ProfaneCrimes._settlementAt(world, sale.q, sale.r);
        const k = ProfaneCrimes._kingdom(world, sale.kingdomId);
        let key;
        if (_num(player.gold) >= fine) {
            player.gold = _num(player.gold) - fine;
            Ledger.record(player, 'fines', -fine);
            if (s) Economy.payTown(s, fine);
            if (!player.reputation) player.reputation = {};
            player.reputation[sale.kingdomId] = _num(player.reputation[sale.kingdomId]) + _num(E.reputation);
            key = 'fakeExposedPaid';
        } else {
            if (!player.reputation) player.reputation = {};
            player.reputation[sale.kingdomId] = _num(player.reputation[sale.kingdomId]) + _num(E.reputation) * 2;
            sale.unpaid = fine;
            key = 'fakeExposedUnpaid';
        }
        Devotion._addStanding(player, sale.faithId, _num(E.standing));
        player.karma = _num(player.karma) + _num(E.karma);
        Gossip.accuse(player, world, 'relic_fraud', { q: sale.q, r: sale.r, victim: sale.name, credibility: 0.95 });
        const vars = { relic: sale.name, town: sale.town, fine, realm: (k && k.name) || 'the realm', ruler: player.name || 'The head of the House' };
        ProfaneCrimes._chronicle(player, world, ProfaneCrimes.line('chronicleFakeExposed', vars, `${vars.ruler} was found out selling a false relic.`));
        out.notices.push({ icon: '📿', title: 'A False Relic Found Out', text: ProfaneCrimes.line(key, vars, 'Your fake relic has been found out.'), type: 'warning' });
    },

    _relicDay(player, world, rnd, out) {
        const st = ProfaneCrimes.state(player);
        const E = ProfaneCrimes.config().relics.expose;
        const day = _day(world);
        for (const sale of st.sold) {
            if (sale.exposed != null || sale.safe) continue;
            if (day > _num(sale.until)) { sale.safe = day; continue; }
            if (rnd() < _num(E.daily) * (1.4 - _num(sale.quality, 0.4))) ProfaneCrimes._expose(player, world, sale, out);
        }
        // Old, settled sales go (the exposed are kept for the record, a few)
        if (st.sold.length > 40) st.sold = st.sold.filter(x => x.exposed == null && x.safe == null).concat(st.sold.filter(x => x.exposed != null).slice(-10));
    },

    // ──────────── THE WITCH ────────────

    /** Can this townsperson be cried a witch? → { ok, reason, healer } */
    accusable(world, folk, p) {
        const W = ProfaneCrimes.config().witch;
        if (!folk || !p) return { ok: false, reason: 'No one to accuse.' };
        if (!Townsfolk.isHere(p)) return { ok: false, reason: 'They are gone from town.' };
        const healer = !!(p.job && p.job.id === 'healer') || p.role === 'healer';
        const old = p.gender === 'female' && Townsfolk.age(p, _day(world)) >= _num(W.oldAge, 55);
        if (!healer && !old) return { ok: false, reason: 'No one would believe it of them.' };
        return { ok: true, healer };
    },

    _kin(folk, p) {
        const ids = new Set([p.spouse, ...(p.kids || []), ...(p.parents || [])].filter(x => x != null));
        for (const s of Townsfolk.siblings(folk, p)) ids.add(s.id);
        return [...ids].map(id => Townsfolk.get(folk, id)).filter(x => x && Townsfolk.isHere(x));
    },

    /** The chance a trial finds against her. opts.bribe: the priest paid. */
    trialChance(player, world, s, folk, p, opts = {}) {
        const T = ProfaneCrimes.config().witch.trial;
        const chk = ProfaneCrimes.accusable(world, folk, p);
        let c = _num(T.base) + (_num(player.charisma, 5) - 5) * _num(T.perCharisma);
        c += Math.min(_num(T.maxRenown), _num(player.renown) * _num(T.perRenown));
        if (chk.healer) c += _num(T.healer);
        c += Math.min(_num(T.maxKin, 5), ProfaneCrimes._kin(folk, p).length) * _num(T.perKin);
        const t = ProfaneCrimes.templeOf(world, s);
        if (t) c += (t.piety - 50) * _num(T.piety);
        if (opts.bribe) c += _num(T.bribe);
        return Math.round(_clamp(c, _num(T.min, 0.05), _num(T.max, 0.95)) * 100) / 100;
    },

    /** The land she holds in town: a lot of hers with nothing built on it, else null. */
    _herLot(s, p) {
        const book = LotBook.of(s);
        const name = Townsfolk.name(p);
        for (const [id, rec] of Object.entries(book.lots)) {
            if (rec && rec.holder !== 'player' && rec.holderName === name && !rec.built) return id;
        }
        return null;
    },

    /** Her land passes to the accuser (her lot, else a free lot of the town granted for it). → the lot id, or null. */
    _seizeLand(player, world, s, p) {
        const law = Laws.mayHoldLand(world, player, s.kingdom);
        if (!law.ok) return { lot: null, barred: true };
        const book = LotBook.of(s);
        let id = ProfaneCrimes._herLot(s, p);
        if (!id) {
            const free = LotBook.freeLots(s).sort((a, b) => a.price - b.price)[0];
            id = free ? free.id : null;
        }
        if (!id) return { lot: null };
        book.lots[id] = { holder: 'player', holderName: player.name || 'You', price: 0, day: _day(world), built: null, seized: Townsfolk.name(p) };
        if (!Array.isArray(player.lotHoldings)) player.lotHoldings = [];
        player.lotHoldings.push({ kind: 'lot', q: s.q, r: s.r, id, town: s.name, price: 0, seized: Townsfolk.name(p) });
        return { lot: id };
    },

    /**
     * Cry witch on a townswoman. how: 'trial' (before the priest; opts.bribe pays
     * him) or 'mob' (the street). → { success, outcome: 'condemned'|'acquitted'|'mob', text, coin, lot }
     */
    accuseWitch(player, world, s, folk, p, how = 'trial', opts = {}, rnd = Utils.random) {
        const W = ProfaneCrimes.config().witch;
        const chk = ProfaneCrimes.accusable(world, folk, p);
        if (!chk.ok) return { success: false, reason: chk.reason };
        if (!s) return { success: false, reason: 'Only a town tries a witch.' };
        const day = _day(world);
        const st = ProfaneCrimes.state(player);
        const name = Townsfolk.name(p);
        const ref = { folk, person: p };
        const t = ProfaneCrimes.templeOf(world, s);
        if (!player.reputation) player.reputation = {};
        st.stats.witches++;
        if (how === 'trial' && opts.bribe) {
            const b = _num(W.trial.bribeGold);
            if (_num(player.gold) < b) return { success: false, reason: `The priest wants ${b}g.` };
            player.gold = _num(player.gold) - b;
            Ledger.record(player, 'bribes', -b);
            Economy.payTown(s, b);
        }
        const condemned = how === 'mob' || rnd() < ProfaneCrimes.trialChance(player, world, s, folk, p, opts);
        const rec = { name, pid: p.id, town: s.name, q: s.q, r: s.r, day, how, healer: !!chk.healer };
        const vars = { name, town: s.name, ruler: player.name || 'The head of the House' };
        if (!condemned) {
            // Acquitted: the false accuser, and her kin's grudge
            rec.outcome = 'acquitted';
            st.witches.push(rec);
            NpcMemory.remember(world, ref, { kind: 'witch_accused', player, kin: true });
            NpcMemory.rememberTown(world, s, { kind: 'witch_accused', player, victim: name });
            Gossip.accuse(player, world, 'false_witch', { q: s.q, r: s.r, victim: name, credibility: 0.85 });
            player.karma = _num(player.karma) + _num(W.karma.acquitted);
            player.renown = Math.max(0, _num(player.renown) + _num(W.renown.acquitted));
            if (s.kingdom != null) player.reputation[s.kingdom] = _num(player.reputation[s.kingdom]) + _num(W.reputation.acquitted);
            Townsfolk.note(p, day, 'accused', null, `cried a witch by ${player.name || 'a stranger'}, and acquitted`);
            ProfaneCrimes._chronicle(player, world, ProfaneCrimes.line('chronicleWitchAcquitted', vars, `${vars.ruler} cried witch on ${name}.`));
            return { success: true, outcome: 'acquitted', text: ProfaneCrimes.line('witchAcquitted', vars, `${name} is acquitted.`) };
        }
        // Condemned (or the mob): she dies; her kin are told it as done to their kin
        const cause = how === 'mob' ? W.mobCause : W.cause;
        NpcMemory.rememberKin(world, ref, { kind: 'witch_burned', player });
        Townsfolk.slay(folk, p, day, cause);
        Townsfolk.record(folk, world, day, { k: 'died', a: p.id, x: cause });
        NpcMemory.rememberTown(world, s, { kind: 'witch_burned', player, victim: name });
        const coin = Math.max(0, Math.floor(_num(p.purse)));
        p.purse = 0;
        let share;
        let land = { lot: null };
        if (how === 'mob') {
            share = Math.floor(coin * _num(W.mobLootShare, 0.5));
            Economy.payTown(s, coin - share);
            Gossip.accuse(player, world, 'false_witch', { q: s.q, r: s.r, victim: name, credibility: 0.7 });
            player.karma = _num(player.karma) + _num(W.karma.mob);
            player.renown = Math.max(0, _num(player.renown) + _num(W.renown.mob));
            if (s.kingdom != null) player.reputation[s.kingdom] = _num(player.reputation[s.kingdom]) + _num(W.reputation.mob);
        } else {
            share = Math.floor(coin * _num(W.accuserShare, 0.34));
            Economy.payTown(s, coin - share);
            land = ProfaneCrimes._seizeLand(player, world, s, p);
            player.karma = _num(player.karma) + _num(W.karma.trial);
            // The zealous of the town's faith think the better of a witch-finder
            if (t && t.faithId === ProfaneCrimes._creedId(player)) Devotion._addStanding(player, t.faithId, _num(W.standingSameFaith));
        }
        if (share > 0) {
            player.gold = _num(player.gold) + share;
            Ledger.record(player, 'theft', share);
        }
        st.stats.burned++;
        rec.outcome = how === 'mob' ? 'mob' : 'condemned';
        rec.coin = share;
        if (land.lot) rec.lot = land.lot;
        st.witches.push(rec);
        if (st.witches.length > 30) st.witches.splice(0, st.witches.length - 30);
        vars.cause = cause;
        vars.coin = coin;
        vars.share = share;
        vars.lot = land.lot ? `lot ${String(land.lot).replace(/^lot/, '#')} in ${s.name}` : '';
        let text = ProfaneCrimes.line(how === 'mob' ? 'witchMob' : 'witchCondemned', vars, `${name} is ${cause}.`);
        if (how !== 'mob') text += land.lot ? ProfaneCrimes.line('witchLand', vars, '') : land.barred ? ProfaneCrimes.line('witchNoLand', vars, '') : '';
        ProfaneCrimes._chronicle(player, world, ProfaneCrimes.line('chronicleWitch', vars, `${vars.ruler} cried witch on ${name}.`));
        return { success: true, outcome: rec.outcome, coin: share, lot: land.lot, text };
    },

    // ──────────── THE DAY ────────────

    _rng(world) {
        return Utils.seededRandom((_hash(`${world && world.seed}:profane:${_day(world)}`) % 233279) + 1);
    },

    /** The day: fakes found out; weekly, the crypts' grudges. → { notices } */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !world || player.interregnum || !_obj(player.profane) && !RivalHouses.rivals(player).some(r => r && (r.profaned || r.crypt))) return out;
        const st = ProfaneCrimes.state(player);
        const day = _day(world);
        if (st.lastDay === day) return out;
        st.lastDay = day;
        const rnd = ProfaneCrimes._rng(world);
        ProfaneCrimes._relicDay(player, world, rnd, out);
        if (day % 7 === 0) ProfaneCrimes._cryptWeek(player, world, rnd, out);
        return out;
    },
};
