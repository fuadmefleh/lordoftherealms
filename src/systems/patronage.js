// ============================================
// PATRONAGE & GREAT WORKS — a long-term home for gold, goods and Prestige
// ============================================
// Two halves:
//
//   • Clients. A town's salon offers a few named artists, scholars,
//     architects, physicians and chroniclers (skill, temperament, a weekly
//     stipend, an ambition), chosen by a hash of the world seed, the town and
//     the month. Hired, they draw their stipend each week and produce works
//     on commission:
//        painting / sculpture → House Prestige; kept in the gallery or
//                               donated to a town (its happiness, or your
//                               standing with its realm)
//        treatise             → days of progress on your current research
//        medical text         → sickness is less deadly, wounds mend faster
//        chronicle            → House Prestige and a line in the chronicle
//                               (Legacy scores chronicles)
//     An architect speeds the labour of a Great Work instead. Unpaid or idle
//     clients sour and leave; rival Houses (House.rivals) try to poach them
//     with an offer you can match or let go.
//
//   • Great Works. A cathedral, the Great Library, a university, the Royal
//     Observatory, a hippodrome, a grand bridge or the Colossus, raised at a
//     settlement you rule (Holdings) or hold a house in (your seat). Each
//     stage wants goods + gold delivered (from the packs on site, or bought
//     at a markup), then days of paid labour. Work stops in winter (outdoor
//     stages), famine, siege, or when the wages can't be paid, and slows
//     during war. A finished work stands on the map and grants a permanent
//     effect while you hold the site — cached on player.patronage.fx and
//     read by Technology, PlayerReligion, Upbringing, Player visibility,
//     Festivals, Infrastructure, Ailments and Taxation (settlement.patronage).
//     Kingdoms raise wonders too, at their capitals, out of their treasuries;
//     some works are unique, and the first to finish claims it for the world.
//
// State: player.patronage (saved with the player), world.greatWorks (saved
// with the world), settlement.patronage (saved with the tiles) and
// kingdom.greatWorks (saved with the kingdoms). No RNG is drawn: every roll
// is a hash of the world seed and the day, so the system never perturbs the
// shared Utils stream and is reproducible from the seed.
//
// Content: data/patronage.json (DataLoader.patronage).

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Seasons } from '../world/seasons.js';
import { WorldEvents } from '../world/worldEvents.js';
import { House } from './house.js';
import { Holdings } from './holdings.js';
import { HoldingSieges } from './holdingSieges.js';
import { Ships } from './ships.js';

const TYPE_RANK = { hamlet: 0, village: 1, town: 2, city: 3, capital: 3 };
const FX_KEYS = ['research', 'conversion', 'education', 'vision', 'festivalRenown', 'riverCross', 'monthlyPrestige', 'care', 'woundHeal'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
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
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return p && p.seed != null ? p.seed : 0;
}

/** A deterministic roll in [0, 1) from the world seed and the given parts. */
function _roll(world, ...parts) {
    return _hash(`${_seed(world)}|${parts.join('|')}`) / 4294967296;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id);
    return (world.kingdoms || []).find(k => k.id === id) || null;
}

export const Patronage = {

    // ──────────── DATA ────────────

    data() {
        return (DataLoader && DataLoader.patronage) || {};
    },

    config() {
        const c = Patronage.data().config || {};
        return { ...c, poach: { ...(c.poach || {}) }, quality: { ...(c.quality || {}) }, npc: { ...(c.npc || {}) } };
    },

    professions() {
        return Patronage.data().professions || {};
    },

    works() {
        return Patronage.data().works || {};
    },

    greatWorks() {
        return Patronage.data().greatWorks || {};
    },

    greatWork(id) {
        return Patronage.greatWorks()[id] || null;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            clients: [], gallery: [], works: [], projects: [], offers: [], log: [],
            scholarship: 0, medicalTexts: 0, nextId: 1,
            fx: Patronage._emptyFx(),
            lastDay: null,
            stats: {
                hired: 0, works: 0, masterpieces: 0, donated: 0, treatises: 0, chronicles: 0, medicalTexts: 0,
                greatWorks: 0, uniqueWorks: 0, forestalled: 0, poached: 0, matched: 0, left: 0, goldSpent: 0,
            },
        };
    },

    _emptyFx() {
        const fx = {};
        for (const k of FX_KEYS) fx[k] = 0;
        fx.care = 1;
        return fx;
    },

    /** The player's patronage record, backfilled (old saves, partial state). */
    state(player) {
        if (!player) return Patronage._blank();
        let st = player.patronage;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.patronage = Patronage._blank();
            return player.patronage;
        }
        const blank = Patronage._blank();
        for (const k of ['clients', 'gallery', 'works', 'projects', 'offers', 'log']) if (!Array.isArray(st[k])) st[k] = [];
        st.scholarship = _num(st.scholarship);
        st.medicalTexts = _num(st.medicalTexts);
        if (!(st.nextId > 0)) st.nextId = 1;
        if (st.lastDay === undefined) st.lastDay = null;
        st.fx = { ...blank.fx, ...(st.fx && typeof st.fx === 'object' ? st.fx : {}) };
        st.stats = { ...blank.stats, ...(st.stats && typeof st.stats === 'object' ? st.stats : {}) };
        return st;
    },

    serialize(player) {
        return player && player.patronage ? JSON.parse(JSON.stringify(player.patronage)) : null;
    },

    loadState(player) {
        Patronage.state(player);
    },

    /** The world's wonders: { built, npc, claimed, nextId }, backfilled. */
    worldState(world) {
        if (!world) return { built: [], npc: [], claimed: {}, nextId: 1 };
        let ws = world.greatWorks;
        if (!ws || typeof ws !== 'object' || Array.isArray(ws)) {
            world.greatWorks = { built: [], npc: [], claimed: {}, nextId: 1 };
            return world.greatWorks;
        }
        if (!Array.isArray(ws.built)) ws.built = [];
        if (!Array.isArray(ws.npc)) ws.npc = [];
        if (!ws.claimed || typeof ws.claimed !== 'object') ws.claimed = {};
        if (!(ws.nextId > 0)) ws.nextId = 1;
        return ws;
    },

    serializeWorld(world) {
        return world && world.greatWorks ? JSON.parse(JSON.stringify(world.greatWorks)) : null;
    },

    /** Put the world's wonders back from a save (older saves start with none). */
    restoreWorld(saved, world) {
        if (!world) return;
        world.greatWorks = saved && typeof saved === 'object' ? JSON.parse(JSON.stringify(saved)) : null;
        Patronage.worldState(world);
    },

    _log(player, world, text) {
        const st = Patronage.state(player);
        st.log.push({ day: _day(world), text });
        if (st.log.length > 40) st.log.splice(0, st.log.length - 40);
    },

    _uid(player, prefix) {
        const st = Patronage.state(player);
        return `${prefix}${st.nextId++}`;
    },

    // ──────────── PRICES ────────────

    _basePrice(goodId) {
        const goods = (DataLoader.get && DataLoader.get('playerEconomy.json') || {}).GOODS || {};
        const g = Object.values(goods).find(x => x && x.id === goodId);
        return Math.max(1, _num(g && g.basePrice, 10));
    },

    /** Gold to have a good bought for you: base price × markup (more when you're away). */
    unitPrice(goodId, present = true) {
        const cfg = Patronage.config();
        return Math.ceil(Patronage._basePrice(goodId) * _num(cfg.materialMarkup, 1.6) * (present ? 1 : _num(cfg.remoteMarkup, 1.25)));
    },

    /** What `materials` would take from the packs and what buying the rest costs. */
    quote(player, materials, present = true) {
        const inv = (player && player.inventory) || {};
        const lines = Object.entries(materials || {}).map(([id, need]) => {
            const have = present ? Math.max(0, Math.min(need, Math.floor(_num(inv[id])))) : 0;
            const missing = Math.max(0, need - have);
            return { id, need, have, missing, price: Patronage.unitPrice(id, present) };
        });
        return { lines, buyCost: lines.reduce((s, l) => s + l.missing * l.price, 0) };
    },

    _take(player, id, n) {
        if (!(n > 0) || !player.inventory) return;
        player.inventory[id] = _num(player.inventory[id]) - n;
        if (player.inventory[id] <= 0) delete player.inventory[id];
    },

    _spend(player, gold) {
        const st = Patronage.state(player);
        player.gold = _num(player.gold) - gold;
        st.stats.goldSpent += gold;
    },

    // ──────────── PLACES ────────────

    _rank(settlement) {
        return _num(TYPE_RANK[settlement && settlement.type], 1);
    },

    _present(player, q, r) {
        return !!player && player.q === q && player.r === r;
    },

    /**
     * Where the player may raise a Great Work: holdings, and settlements where
     * they own a house (their seat). → [{ q, r, key, settlement, kind }]
     */
    sites(player, world) {
        const out = [];
        if (!player || !world || typeof world.getTile !== 'function') return out;
        const seen = new Set();
        for (const h of Holdings.list(player, world)) {
            seen.add(h.key);
            out.push({ q: h.q, r: h.r, key: h.key, settlement: h.settlement, kind: 'holding' });
        }
        for (const ref of player.houses || []) {
            if (!ref || typeof ref.q !== 'number') continue;
            const key = _key(ref.q, ref.r);
            if (seen.has(key)) continue;
            const t = world.getTile(ref.q, ref.r);
            if (!t || !t.settlement) continue;
            seen.add(key);
            out.push({ q: ref.q, r: ref.r, key, settlement: t.settlement, kind: 'seat' });
        }
        return out;
    },

    siteAt(player, world, q, r) {
        return Patronage.sites(player, world).find(s => s.q === q && s.r === r) || null;
    },

    _hasRiver(world, q, r) {
        for (const h of [{ q, r }, ...Hex.neighbors(q, r)]) {
            if (h.r < 0 || h.r >= world.height) continue;
            const t = world.getTile(Hex.wrapQ ? Hex.wrapQ(h.q, world.width) : h.q, h.r);
            if (t && t.hasRiver) return true;
        }
        return false;
    },

    /** Does the place meet the work's needs (size, a river, a harbour)? → reason or null */
    _placeProblem(world, def, q, r, settlement) {
        if (!settlement) return 'There is no settlement here.';
        if (def.minType && Patronage._rank(settlement) < _num(TYPE_RANK[def.minType], 1)) return `Needs a ${def.minType} or larger.`;
        if (def.requires === 'river' && !Patronage._hasRiver(world, q, r)) return 'Needs a river at the town.';
        if (def.requires === 'port' && !Ships.isPortTile(world, q, r)) return 'Needs a harbour.';
        return null;
    },

    // ──────────── CLIENTS ────────────

    _month(world) {
        return Math.floor(_day(world) / Math.max(1, _num(Patronage.config().salonRefreshDays, 30)));
    },

    /** Can this town keep a salon? */
    hasSalon(tile) {
        const s = tile && tile.settlement;
        if (!s) return false;
        return Patronage._rank(s) >= _num(TYPE_RANK[Patronage.config().salonMinType || 'town'], 2);
    },

    _pick(arr, h) {
        return arr.length ? arr[h % arr.length] : null;
    },

    /** One candidate, entirely from a hash (no RNG). */
    _candidate(world, tile, month, i) {
        const D = Patronage.data();
        const profs = Object.keys(Patronage.professions());
        const temps = Object.keys(D.temperaments || {});
        const ambs = Object.keys(D.ambitions || {});
        const names = D.names || {};
        const id = `pc_${tile.q}_${tile.r}_${month}_${i}`;
        const h = _hash(`${_seed(world)}|salon|${id}`);
        const h2 = _hash(`${h}|more`);
        const profession = Patronage._pick(profs, h);
        const prof = Patronage.professions()[profession] || {};
        const temperament = Patronage._pick(temps, h >>> 7);
        const ambition = Patronage._pick(ambs, h >>> 13);
        const skill = _clamp(2 + (h2 % 7) + (Patronage._rank(tile.settlement) >= 3 ? 1 : 0), 1, 10);
        const [lo, hi] = Array.isArray(prof.stipend) ? prof.stipend : [15, 35];
        const tmp = (D.temperaments || {})[temperament] || {};
        const stipend = Math.round((lo + (hi - lo) * (skill - 1) / 9) * _num(tmp.stipend, 1));
        const first = Patronage._pick(names.first || ['Anon'], h2 >>> 5);
        const family = Patronage._pick(names.family || [''], h2 >>> 11);
        return {
            id, profession, temperament, ambition, skill, stipend,
            name: `${first} ${family}`.trim(),
            from: tile.settlement.name,
        };
    },

    /** The town's salon this month, less anyone already in your service (or who left it). */
    salon(player, world, tile) {
        if (!Patronage.hasSalon(tile)) return [];
        const st = Patronage.state(player);
        const month = Patronage._month(world);
        const taken = new Set([...st.clients.map(c => c.id), ...st.log.filter(l => l.clientId).map(l => l.clientId)]);
        const out = [];
        const n = _num(Patronage.config().salonSize, 3);
        for (let i = 0; i < n; i++) {
            const c = Patronage._candidate(world, tile, month, i);
            if (!taken.has(c.id)) out.push(c);
        }
        return out;
    },

    hireFee(cand) {
        return Math.round(_num(cand && cand.stipend) * _num(Patronage.config().hireFeeWeeks, 2));
    },

    maxClients(player) {
        const cfg = Patronage.config();
        const titled = player && player.currentTitle ? _num(cfg.maxClientsPerTitle, 1) : 0;
        return _num(cfg.maxClients, 4) + titled;
    },

    client(player, id) {
        return Patronage.state(player).clients.find(c => c.id === id) || null;
    },

    /** Take a candidate from the salon here into your service. */
    hire(player, world, tile, candId) {
        const st = Patronage.state(player);
        const cand = Patronage.salon(player, world, tile).find(c => c.id === candId);
        if (!cand) return { success: false, reason: 'They are not here to be hired.' };
        if (st.clients.length >= Patronage.maxClients(player)) return { success: false, reason: `You can keep at most ${Patronage.maxClients(player)} clients.` };
        const fee = Patronage.hireFee(cand);
        if (_num(player.gold) < fee) return { success: false, reason: `You need ${fee} gold to bring them into your service.` };
        Patronage._spend(player, fee);
        const day = _day(world);
        const client = {
            ...cand,
            content: _num(Patronage.config().contentStart, 60),
            hiredDay: day, lastPaidDay: day, unpaidWeeks: 0, idleDays: 0,
            task: null, assignedTo: null, worksDone: 0, lastDonatedDay: null,
        };
        st.clients.push(client);
        st.stats.hired++;
        Patronage._log(player, world, `${client.name}, ${Patronage.professions()[client.profession].name.toLowerCase()}, enters your service.`);
        return { success: true, client, text: `${client.name} enters your service for ${client.stipend}g a week.` };
    },

    /** Let a client go (they take nothing with them; work in hand is lost). */
    dismiss(player, world, clientId) {
        const st = Patronage.state(player);
        const c = Patronage.client(player, clientId);
        if (!c) return { success: false, reason: 'No such client.' };
        Patronage._release(player, world, c, `You release ${c.name} from your service.`);
        st.stats.left++;
        return { success: true, text: `${c.name} leaves your service.` };
    },

    _release(player, world, c, text) {
        const st = Patronage.state(player);
        st.clients = st.clients.filter(x => x !== c);
        st.offers = st.offers.filter(o => o.clientId !== c.id);
        for (const p of st.projects) if (p.architectId === c.id) p.architectId = null;
        st.log.push({ day: _day(world), text, clientId: c.id });
        if (st.log.length > 40) st.log.splice(0, st.log.length - 40);
    },

    /** Raise a client's stipend by a fifth: they are glad of it. */
    raise(player, world, clientId) {
        const c = Patronage.client(player, clientId);
        if (!c) return { success: false, reason: 'No such client.' };
        c.stipend = Math.ceil(c.stipend * 1.2);
        c.content = _clamp(c.content + (c.ambition === 'wealth' ? 25 : 12), 0, 100);
        return { success: true, text: `${c.name} now draws ${c.stipend}g a week.` };
    },

    /** Days a commission takes this client. */
    workDays(client, workId) {
        const w = Patronage.works()[workId];
        if (!w) return 0;
        const tmp = (Patronage.data().temperaments || {})[client.temperament] || {};
        const speed = _num(tmp.speed, 1) * (1 + 0.05 * (_num(client.skill, 5) - 5));
        return Math.max(5, Math.round(_num(w.days, 40) / Math.max(0.2, speed)));
    },

    /** Set a client to work. Materials come from the packs, or are bought (at a markup). */
    commission(player, world, clientId, workId, opts = {}) {
        const c = Patronage.client(player, clientId);
        if (!c) return { success: false, reason: 'No such client.' };
        const prof = Patronage.professions()[c.profession] || {};
        if (!(prof.works || []).includes(workId)) return { success: false, reason: `${c.name} does not make that.` };
        if (c.task) return { success: false, reason: `${c.name} is already at work.` };
        if (c.assignedTo) return { success: false, reason: `${c.name} is overseeing a Great Work.` };
        const w = Patronage.works()[workId];
        const present = opts.present !== undefined ? !!opts.present : true;
        const q = Patronage.quote(player, w.materials, present);
        if (q.buyCost > 0 && opts.buyMissing === false) return { success: false, reason: 'You lack the materials.' };
        if (_num(player.gold) < q.buyCost) return { success: false, reason: `Buying the materials costs ${q.buyCost} gold.` };
        for (const l of q.lines) Patronage._take(player, l.id, l.have);
        if (q.buyCost) Patronage._spend(player, q.buyCost);
        const days = Patronage.workDays(c, workId);
        c.task = { workId, progress: 0, days, startDay: _day(world) };
        c.idleDays = 0;
        return { success: true, text: `${c.name} begins a ${w.name.toLowerCase()} (~${days} days).` };
    },

    _quality(world, c, uid) {
        const cfg = Patronage.config();
        const tmp = (Patronage.data().temperaments || {})[c.temperament] || {};
        const score = _num(c.skill, 5) + _num(tmp.qualityBonus) + (_num(c.content, 50) - 50) / 25 + _roll(world, 'quality', uid) * 3 - 1;
        if (score >= _num(cfg.quality.masterpieceSkill, 8) + 1) return 'masterpiece';
        if (score < _num(cfg.quality.modestBelow, 4)) return 'modest';
        return 'fine';
    },

    /** A client finishes a commission: the work and its effect. */
    _finishWork(player, world, c, out) {
        const st = Patronage.state(player);
        const cfg = Patronage.config();
        const task = c.task;
        c.task = null;
        const w = Patronage.works()[task.workId];
        if (!w) return;
        const uid = Patronage._uid(player, 'w');
        const quality = Patronage._quality(world, c, uid);
        const mult = _num((cfg.quality.mult || {})[quality], 1);
        const titles = w.titles || [w.name];
        const title = titles[_hash(`${uid}|${c.id}`) % titles.length];
        const rec = { uid, kind: task.workId, title, by: c.name, clientId: c.id, quality, day: _day(world) };
        const house = player.house;
        const day = _day(world);
        const prestige = Math.round(_num(w.prestige) * mult);
        if (house && prestige > 0) House.award(house, prestige, `${w.name.toLowerCase()}: ${title}`, day);
        let effect = prestige ? `+${prestige} Prestige` : '';
        if (w.artValue) {
            rec.artValue = Math.max(1, Math.round(_num(w.artValue) * mult));
            rec.donatedTo = null;
            st.gallery.push(rec);
        }
        if (w.researchDays) {
            const daysOf = Math.round(_num(w.researchDays) * mult);
            const applied = Patronage._applyResearch(player, daysOf);
            st.scholarship = Math.min(_num(cfg.treatiseCap, 12) * 4, st.scholarship + (daysOf - applied));
            st.stats.treatises++;
            effect += `${effect ? ', ' : ''}${daysOf} days of research${applied < daysOf ? ` (${daysOf - applied} banked)` : ''}`;
        }
        if (w.care) {
            st.medicalTexts += quality === 'masterpiece' ? 2 : 1;
            st.stats.medicalTexts++;
            effect += `${effect ? ', ' : ''}better medicine`;
        }
        if (w.chronicle) {
            if (house) {
                house.stats = house.stats || {};
                house.stats.chronicle = _num(house.stats.chronicle) + (quality === 'masterpiece' ? 2 : 1);
                House._chronicle(house, world, `${c.name} completes "${title}", a chronicle of ${house.name}.`, ['chronicle', 'patronage']);
            }
            st.stats.chronicles++;
        }
        c.worksDone++;
        const amb = (Patronage.data().ambitions || {})[c.ambition] || {};
        if (amb.skillGain) c.skill = Math.min(10, Math.round((_num(c.skill) + _num(amb.skillGain)) * 100) / 100);
        st.works.push(rec);
        if (st.works.length > 60) st.works.splice(0, st.works.length - 60);
        st.stats.works++;
        if (quality === 'masterpiece') st.stats.masterpieces++;
        Patronage.refreshFx(player, world);
        const qualityText = quality === 'masterpiece' ? 'a masterpiece' : quality === 'modest' ? 'a modest piece' : 'a fine piece';
        out.notices.push({ icon: w.icon || '🎨', title: quality === 'masterpiece' ? 'A Masterpiece!' : `${w.name} Finished`,
            text: `${c.name} finishes "${title}", ${qualityText}${effect ? ` (${effect})` : ''}.`, type: 'success' });
    },

    /** Push research forward by `days` (the last day is left to Technology.processResearch). */
    _applyResearch(player, days) {
        const cur = player && player.technology && player.technology.currentResearch;
        if (!cur || !(days > 0)) return 0;
        const room = Math.max(0, _num(cur.totalDays) - 1 - _num(cur.progress));
        const n = Math.min(room, days);
        cur.progress = _num(cur.progress) + n;
        return n;
    },

    /** Give a work from the gallery to the town you stand in. */
    donate(player, world, tile, workUid) {
        const st = Patronage.state(player);
        if (!tile || !tile.settlement) return { success: false, reason: 'You must be in a town to donate a work.' };
        const rec = st.gallery.find(g => g.uid === workUid && !g.donatedTo);
        if (!rec) return { success: false, reason: 'That work is not in your gallery.' };
        const cfg = Patronage.config();
        const s = tile.settlement;
        rec.donatedTo = { name: s.name, q: tile.q, r: tile.r, day: _day(world) };
        const sp = Patronage._settlementState(s);
        sp.art = _num(sp.art) + _num(rec.artValue, 1);
        Patronage._refreshMood(world, tile.q, tile.r);
        st.stats.donated++;
        const c = Patronage.client(player, rec.clientId);
        if (c) {
            c.lastDonatedDay = _day(world);
            if (c.ambition === 'fame') c.content = _clamp(c.content + 15, 0, 100);
        }
        let text = `"${rec.title}" now hangs in ${s.name}`;
        if (Holdings.isHolding(player, world, tile.q, tile.r)) {
            text += ': the town is happier for it.';
        } else if (s.kingdom) {
            const gain = Math.round(_num(cfg.donateReputationPerValue, 3) * _num(rec.artValue, 1));
            player.reputation = player.reputation || {};
            player.reputation[s.kingdom] = _clamp(_num(player.reputation[s.kingdom]) + gain, -100, 100);
            const k = _kingdom(world, s.kingdom);
            text += `: +${gain} standing with ${k ? k.name : 'its realm'}.`;
        } else {
            text += '.';
        }
        player.renown = _num(player.renown) + 1;
        return { success: true, text };
    },

    /** Send an architect to oversee one of your Great Works (null to recall them). */
    assignArchitect(player, world, clientId, projectId) {
        const st = Patronage.state(player);
        const c = Patronage.client(player, clientId);
        if (!c || c.profession !== 'architect') return { success: false, reason: 'Only an architect can oversee a Great Work.' };
        for (const p of st.projects) if (p.architectId === c.id) p.architectId = null;
        c.assignedTo = null;
        if (!projectId) return { success: true, text: `${c.name} returns to your household.` };
        const p = st.projects.find(x => x.id === projectId);
        if (!p) return { success: false, reason: 'No such Great Work.' };
        if (p.architectId) {
            const other = Patronage.client(player, p.architectId);
            if (other) other.assignedTo = null;
        }
        p.architectId = c.id;
        c.assignedTo = p.id;
        c.idleDays = 0;
        return { success: true, text: `${c.name} takes charge of the ${Patronage.greatWork(p.workId).name} at ${p.name}.` };
    },

    /** Answer a rival House's offer for a client: 'match' (pay to keep them) or 'release'. */
    answerOffer(player, world, clientId, answer) {
        const st = Patronage.state(player);
        const offer = st.offers.find(o => o.clientId === clientId);
        const c = Patronage.client(player, clientId);
        if (!offer || !c) return { success: false, reason: 'There is no offer to answer.' };
        const P = Patronage.config().poach;
        if (answer === 'match') {
            if (_num(player.gold) < offer.counter) return { success: false, reason: `Matching the offer costs ${offer.counter} gold.` };
            Patronage._spend(player, offer.counter);
            c.stipend = Math.ceil(c.stipend * (1 + _num(P.matchStipendRaise, 0.25)));
            c.content = _clamp(c.content + _num(P.matchContent, 15), 0, 100);
            st.offers = st.offers.filter(o => o !== offer);
            st.stats.matched++;
            return { success: true, text: `${c.name} stays, for ${c.stipend}g a week.` };
        }
        Patronage._poached(player, world, c, offer);
        return { success: true, text: `${c.name} leaves for ${offer.rivalName}.` };
    },

    _poached(player, world, c, offer) {
        const st = Patronage.state(player);
        Patronage._release(player, world, c, `${c.name} leaves your service for ${offer.rivalName}.`);
        st.stats.poached++;
        if (player.house) {
            House.accrueRivalFeud(player, world, offer.kingdomId, _num(Patronage.config().poach.feudOnLoss, 6), `they lured away ${c.name}`);
            House._chronicle(player.house, world, `${offer.rivalName} lures ${c.name} away from ${player.house.name}.`, ['rival', 'patronage']);
        }
    },

    _clientsDay(player, world, out) {
        const st = Patronage.state(player);
        const cfg = Patronage.config();
        const P = cfg.poach;
        const day = _day(world);
        const D = Patronage.data();
        const prestige = House.getPrestige(player);
        for (const c of st.clients.slice()) {
            const tmp = (D.temperaments || {})[c.temperament] || {};
            const amb = (D.ambitions || {})[c.ambition] || {};
            // Work in hand
            if (c.task) {
                c.task.progress++;
                c.content += _num(cfg.contentWorkingPerDay, 0.25);
                if (c.task.progress >= c.task.days) Patronage._finishWork(player, world, c, out);
            } else if (c.assignedTo) {
                c.content += _num(cfg.contentWorkingPerDay, 0.25);
            } else {
                c.idleDays = _num(c.idleDays) + 1;
                if (c.idleDays > _num(cfg.idleGraceDays, 14)) c.content += _num(cfg.contentIdlePerDay, -0.6) * _num(tmp.idle, 1);
            }
            // The stipend, weekly
            if (day - _num(c.lastPaidDay, day) >= _num(cfg.payCadence, 7)) {
                c.lastPaidDay = day;
                if (_num(player.gold) >= c.stipend) {
                    Patronage._spend(player, c.stipend);
                    c.unpaidWeeks = 0;
                    c.content += _num(cfg.contentPaid, 2);
                } else {
                    c.unpaidWeeks = _num(c.unpaidWeeks) + 1;
                    c.content += _num(cfg.contentUnpaid, -18);
                    out.notices.push({ icon: '💸', title: 'Stipend Unpaid', text: `You could not pay ${c.name} this week (${c.stipend}g).`, type: 'warning' });
                }
            }
            // Ambitions, monthly
            if (day % 30 === 0) {
                let d = 0;
                if (c.ambition === 'glory') d = prestige >= _num(amb.prestige, 150) ? _num(amb.content, 5) : -2;
                else if (c.ambition === 'fame') d = c.lastDonatedDay != null && day - c.lastDonatedDay <= 120 ? _num(amb.content, 6) : -2;
                else if (c.ambition === 'mastery') d = c.task || c.assignedTo ? _num(amb.content, 4) : -2;
                else if (c.ambition === 'wealth') d = c.stipend >= _num((Patronage.professions()[c.profession] || {}).stipend?.[1], 40) ? 4 : -1;
                c.content += d;
            }
            c.content = _clamp(Math.round(c.content * 100) / 100, 0, 100);
            // Leaving
            if (_num(c.unpaidWeeks) >= _num(cfg.leaveUnpaidWeeks, 3) || c.content < _num(cfg.leaveContentBelow, 5)) {
                const why = _num(c.unpaidWeeks) >= _num(cfg.leaveUnpaidWeeks, 3) ? 'unpaid for too long' : 'neglected and unhappy';
                Patronage._release(player, world, c, `${c.name} leaves your service, ${why}.`);
                st.stats.left++;
                out.notices.push({ icon: '🚪', title: 'Client Departs', text: `${c.name} has left your service, ${why}.`, type: 'warning' });
                continue;
            }
            // Rival Houses come calling
            const rivals = Object.values((player.house && player.house.rivals) || {});
            const cadence = Math.max(1, _num(P.cadence, 15));
            if (rivals.length && !st.offers.some(o => o.clientId === c.id) && (day + (_hash(c.id) % cadence)) % cadence === 0) {
                let chance = _num(P.base, 0.04) + _num(c.skill) * _num(P.perSkill, 0.006) + _num(tmp.poach) + _num(amb.poach);
                if (c.content < _num(P.lowContent, 40)) chance += _num(P.lowContentBonus, 0.06);
                if (c.content > _num(P.highContent, 80)) chance -= _num(P.highContentGuard, 0.04);
                const rival = rivals.slice().sort((a, b) => _num(b.feud) - _num(a.feud))[_hash(`${c.id}|${day}`) % rivals.length];
                const k = _kingdom(world, rival.kingdomId);
                if (k && k.isAlive !== false) {
                    chance += _num(rival.feud) * _num(P.perFeud, 0.002);
                    if (_roll(world, 'poach', c.id, day) < chance) {
                        const offer = {
                            clientId: c.id, kingdomId: rival.kingdomId, rivalName: rival.name || k.name,
                            day, dueDay: day + _num(P.answerDays, 6),
                            counter: Math.round(c.stipend * _num(P.counterWeeks, 10)),
                        };
                        st.offers.push(offer);
                        out.notices.push({ icon: '🎭', title: 'A Rival Offer', text: `${offer.rivalName} courts ${c.name} with a richer stipend. Match it (${offer.counter}g) or let them go: ${_num(P.answerDays, 6)} days to answer (Patronage).`, type: 'warning' });
                    }
                }
            }
        }
        // Offers left unanswered: the client decides
        for (const offer of st.offers.slice()) {
            const c = Patronage.client(player, offer.clientId);
            if (!c) { st.offers = st.offers.filter(o => o !== offer); continue; }
            if (day < offer.dueDay) continue;
            const tmp = (D.temperaments || {})[c.temperament] || {};
            const stay = c.content / 100 - _num(tmp.poach) * 2;
            if (_roll(world, 'stay', c.id, day) < stay) {
                st.offers = st.offers.filter(o => o !== offer);
                out.notices.push({ icon: '🤝', title: 'Loyal Client', text: `${c.name} turns down ${offer.rivalName} and stays with you.`, type: 'success' });
            } else {
                Patronage._poached(player, world, c, offer);
                out.notices.push({ icon: '🎭', title: 'Client Poached', text: `${c.name} has gone over to ${offer.rivalName}.`, type: 'error' });
            }
        }
        // Banked scholarship goes into research a day at a time
        if (st.scholarship > 0 && Patronage._applyResearch(player, 1) > 0) st.scholarship--;
    },

    // ──────────── GREAT WORKS ────────────

    /** Built works in the world: [{ uid, workId, q, r, name, icon, owner, kingdomId, day, settlementName }] */
    built(world) {
        return Patronage.worldState(world).built;
    },

    builtAt(world, q, r) {
        return Patronage.built(world).filter(b => b.q === q && b.r === r);
    },

    /** Has a unique work been claimed? → its built record, or null. */
    claimed(world, workId) {
        const uid = Patronage.worldState(world).claimed[workId];
        return uid ? Patronage.built(world).find(b => b.uid === uid) || { uid } : null;
    },

    playerBuilt(world) {
        return Patronage.built(world).filter(b => b.owner === 'player');
    },

    project(player, id) {
        return Patronage.state(player).projects.find(p => p.id === id) || null;
    },

    /** Can the player begin this Great Work at (q, r)? → { ok, reason } */
    canFound(player, world, q, r, workId) {
        const def = Patronage.greatWork(workId);
        if (!def) return { ok: false, reason: 'Unknown work.' };
        const site = Patronage.siteAt(player, world, q, r);
        if (!site) return { ok: false, reason: 'You must rule this town or keep a house here.' };
        const st = Patronage.state(player);
        if (def.unique && Patronage.claimed(world, workId)) return { ok: false, reason: 'Already raised elsewhere in the world.' };
        if (Patronage.playerBuilt(world).some(b => b.workId === workId)) return { ok: false, reason: 'You have already raised one.' };
        if (st.projects.some(p => p.workId === workId)) return { ok: false, reason: 'Already under construction.' };
        if (st.projects.some(p => p.q === q && p.r === r)) return { ok: false, reason: 'A Great Work is already rising here.' };
        if (Patronage.builtAt(world, q, r).some(b => b.workId === workId)) return { ok: false, reason: 'This town already has one.' };
        const max = _num(Patronage.config().maxGreatWorksBuilding, 2);
        if (st.projects.length >= max) return { ok: false, reason: `You can raise at most ${max} Great Works at once.` };
        const problem = Patronage._placeProblem(world, def, q, r, site.settlement);
        if (problem) return { ok: false, reason: problem };
        return { ok: true };
    },

    /** Break ground: the work's first stage waits for its goods and gold. */
    found(player, world, q, r, workId) {
        const can = Patronage.canFound(player, world, q, r, workId);
        if (!can.ok) return { success: false, reason: can.reason };
        const st = Patronage.state(player);
        const def = Patronage.greatWork(workId);
        const site = Patronage.siteAt(player, world, q, r);
        const p = {
            id: Patronage._uid(player, 'gw'), workId, q, r, name: site.settlement.name,
            startDay: _day(world), stage: 0, delivered: {}, goldPaid: false, progress: 0,
            status: 'supplying', stall: null, architectId: null, spent: 0,
        };
        st.projects.push(p);
        Patronage._log(player, world, `Ground is broken for the ${def.name} at ${p.name}.`);
        return { success: true, project: p, text: `Ground is broken for the ${def.name} at ${p.name}. Deliver the first stage's goods and gold to begin.` };
    },

    stageDef(p) {
        const def = Patronage.greatWork(p && p.workId);
        return def && def.stages ? def.stages[p.stage] || null : null;
    },

    /** What the current stage still wants: { goods: [{ id, need, delivered, missing, have, price }], gold, goldPaid } */
    stageNeeds(player, p, present = null) {
        const stage = Patronage.stageDef(p);
        if (!stage) return null;
        const here = present == null ? Patronage._present(player, p.q, p.r) : present;
        const inv = (player && player.inventory) || {};
        const goods = Object.entries(stage.goods || {}).map(([id, need]) => {
            const delivered = _num(p.delivered[id]);
            const missing = Math.max(0, need - delivered);
            return { id, need, delivered, missing, have: here ? Math.min(missing, Math.floor(_num(inv[id]))) : 0, price: Patronage.unitPrice(id, here) };
        });
        return { goods, gold: _num(stage.gold), goldPaid: !!p.goldPaid, labour: _num(stage.labour), days: _num(stage.days) };
    },

    /**
     * Deliver to the current stage: goods from the packs (on site), and, with
     * opts.buyMissing, the rest bought for you at a markup; the stage's gold if
     * the purse holds it. A fully supplied stage starts building.
     */
    deliver(player, world, projectId, opts = {}) {
        const p = Patronage.project(player, projectId);
        if (!p) return { success: false, reason: 'No such Great Work.' };
        if (p.status !== 'supplying') return { success: false, reason: 'This stage is already supplied.' };
        const needs = Patronage.stageNeeds(player, p);
        const parts = [];
        let moved = 0;
        for (const g of needs.goods) {
            if (g.have > 0) {
                Patronage._take(player, g.id, g.have);
                p.delivered[g.id] = _num(p.delivered[g.id]) + g.have;
                p.spent += g.have * Patronage._basePrice(g.id);
                moved += g.have;
                parts.push(`${g.have} ${g.id}`);
            }
        }
        if (opts.buyMissing) {
            const rest = Patronage.stageNeeds(player, p);
            const cost = rest.goods.reduce((s, g) => s + g.missing * g.price, 0);
            if (cost > 0) {
                if (_num(player.gold) < cost) {
                    if (!moved) return { success: false, reason: `Buying the rest costs ${cost} gold.` };
                } else {
                    Patronage._spend(player, cost);
                    p.spent += cost;
                    for (const g of rest.goods) p.delivered[g.id] = _num(p.delivered[g.id]) + g.missing;
                    parts.push(`the rest bought for ${cost}g`);
                }
            }
        }
        if (!p.goldPaid && _num(player.gold) >= needs.gold) {
            Patronage._spend(player, needs.gold);
            p.spent += needs.gold;
            p.goldPaid = true;
            parts.push(`${needs.gold}g for the masons`);
        }
        const after = Patronage.stageNeeds(player, p);
        const supplied = after.goldPaid && after.goods.every(g => g.missing === 0);
        if (!parts.length) return { success: false, reason: 'You have nothing this stage needs, and too little gold.' };
        if (supplied) {
            p.status = 'building';
            p.progress = 0;
        }
        const stage = Patronage.stageDef(p);
        return { success: true, text: `Delivered: ${parts.join(', ')}.${supplied ? ` Work on the ${stage.name.toLowerCase()} begins.` : ''}` };
    },

    /** Abandon a Great Work: nothing is refunded. */
    abandon(player, world, projectId) {
        const st = Patronage.state(player);
        const p = Patronage.project(player, projectId);
        if (!p) return { success: false, reason: 'No such Great Work.' };
        Patronage._dropProject(player, p);
        Patronage._log(player, world, `Work on the ${Patronage.greatWork(p.workId).name} at ${p.name} is abandoned.`);
        st.stats.abandoned = _num(st.stats.abandoned) + 1;
        return { success: true, text: 'The scaffolding comes down.' };
    },

    _dropProject(player, p) {
        const st = Patronage.state(player);
        st.projects = st.projects.filter(x => x !== p);
        for (const c of st.clients) if (c.assignedTo === p.id) c.assignedTo = null;
    },

    /** Daily progress multiplier and the reason work stands still today (or null). */
    conditions(player, world, p) {
        const cfg = Patronage.config();
        const stage = Patronage.stageDef(p);
        const tile = world.getTile(p.q, p.r);
        const out = { stall: null, speed: 1, notes: [] };
        if (!Patronage.siteAt(player, world, p.q, p.r)) { out.stall = 'lost'; return out; }
        if (HoldingSieges.at(player, p.q, p.r)) { out.stall = 'siege'; return out; }
        const day = Seasons.today(world);
        if (stage && stage.outdoor && day != null && Seasons.seasonOf(day) === 'Winter') { out.stall = 'winter'; return out; }
        if (WorldEvents.getModifier(world, 'farmProduction', tile) <= _num(cfg.famineFarmProduction, -0.3)) { out.stall = 'famine'; return out; }
        if (stage && _num(player.gold) < _num(stage.labour)) { out.stall = 'unpaid'; return out; }
        const k = tile && tile.settlement && tile.settlement.kingdom ? _kingdom(world, tile.settlement.kingdom) : null;
        const playerWars = player.realmWars && player.realmWars.wars ? Object.keys(player.realmWars.wars).length : 0;
        const atWar = (k && Array.isArray(k.wars) && k.wars.length > 0) || playerWars > 0;
        if (atWar) { out.speed *= _num(cfg.warSpeed, 0.5); out.notes.push('war levies'); }
        const arch = p.architectId ? Patronage.client(player, p.architectId) : null;
        if (arch) { out.speed *= 1 + _num(cfg.architectSpeedPerSkill, 0.05) * _num(arch.skill); out.notes.push(`${arch.name}`); }
        const tier = tile && tile.settlement ? Math.max(0, Patronage._rank(tile.settlement) - 1) : 0;
        out.speed *= 1 + _num(cfg.labourTierBonus, 0.1) * tier;
        return out;
    },

    STALL_TEXT: {
        lost: 'the site is no longer yours',
        siege: 'the town is under siege',
        winter: 'no stone is laid in winter',
        famine: 'famine has taken the workers',
        unpaid: 'the labourers want their wages',
    },

    _projectsDay(player, world, out) {
        const st = Patronage.state(player);
        for (const p of st.projects.slice()) {
            if (p.status !== 'building') { p.stall = null; continue; }
            const stage = Patronage.stageDef(p);
            if (!stage) { Patronage._complete(player, world, p, out); continue; }
            const cond = Patronage.conditions(player, world, p);
            const was = p.stall;
            p.stall = cond.stall;
            if (cond.stall) {
                if (cond.stall !== was && cond.stall !== 'winter') {
                    out.notices.push({ icon: '🏗️', title: 'Great Work Stalled', text: `The ${Patronage.greatWork(p.workId).name} at ${p.name} stands still: ${Patronage.STALL_TEXT[cond.stall]}.`, type: 'warning' });
                }
                continue;
            }
            Patronage._spend(player, _num(stage.labour));
            p.spent += _num(stage.labour);
            p.progress = Math.round((p.progress + cond.speed) * 100) / 100;
            if (p.progress >= _num(stage.days)) {
                const def = Patronage.greatWork(p.workId);
                if (p.stage + 1 >= def.stages.length) {
                    Patronage._complete(player, world, p, out);
                } else {
                    p.stage++;
                    p.status = 'supplying';
                    p.progress = 0;
                    p.delivered = {};
                    p.goldPaid = false;
                    out.notices.push({ icon: '🏗️', title: 'Stage Complete', text: `The ${stage.name.toLowerCase()} of the ${def.name} at ${p.name} is done. The ${def.stages[p.stage].name.toLowerCase()} wants its goods and gold.`, type: 'info' });
                }
            }
        }
    },

    _settlementState(settlement) {
        if (!settlement.patronage || typeof settlement.patronage !== 'object') settlement.patronage = { art: 0, works: [], mood: 0 };
        const sp = settlement.patronage;
        if (!Array.isArray(sp.works)) sp.works = [];
        sp.art = _num(sp.art);
        sp.mood = _num(sp.mood);
        return sp;
    },

    /** Happiness the town's great works and donated art add (read by Taxation). */
    _refreshMood(world, q, r) {
        const t = world.getTile(q, r);
        if (!t || !t.settlement) return;
        const cfg = Patronage.config();
        const sp = Patronage._settlementState(t.settlement);
        sp.works = Patronage.builtAt(world, q, r).map(b => b.workId);
        let mood = 0;
        for (const id of sp.works) mood += _num(((Patronage.greatWork(id) || {}).effects || {}).mood);
        mood += Math.min(_num(cfg.artMoodCap, 8), sp.art * _num(cfg.artMoodPerValue, 1.5));
        sp.mood = Math.round(mood * 10) / 10;
    },

    _record(world, workId, q, r, owner, kingdomId) {
        const ws = Patronage.worldState(world);
        const def = Patronage.greatWork(workId);
        const t = world.getTile(q, r);
        const rec = {
            uid: `gwb${ws.nextId++}`, workId, q, r, name: def.name, icon: def.icon,
            owner, kingdomId: kingdomId != null ? kingdomId : null, day: _day(world),
            settlementName: t && t.settlement ? t.settlement.name : '',
        };
        ws.built.push(rec);
        if (def.unique) ws.claimed[workId] = rec.uid;
        Patronage._refreshMood(world, q, r);
        return rec;
    },

    _complete(player, world, p, out) {
        const st = Patronage.state(player);
        const def = Patronage.greatWork(p.workId);
        Patronage._dropProject(player, p);
        if (def.unique && Patronage.claimed(world, p.workId)) {
            Patronage._forestall(player, world, p, out);
            return;
        }
        const rec = Patronage._record(world, p.workId, p.q, p.r, 'player', null);
        st.stats.greatWorks++;
        if (def.unique) st.stats.uniqueWorks++;
        const house = player.house;
        if (house) {
            House.award(house, _num(def.prestige, 50), `great work: ${def.name}`, _day(world));
            house.stats = house.stats || {};
            house.stats.greatWork = _num(house.stats.greatWork) + 1;
            House._chronicle(house, world, `${house.name} raises the ${def.name} at ${p.name}.`, ['greatWork', 'patronage']);
        }
        player.renown = _num(player.renown) + Math.round(_num(def.prestige, 50) / 5);
        // Kingdoms racing for the same unique work have lost the race
        if (def.unique) Patronage._abandonNpc(world, p.workId, null);
        Patronage.refreshFx(player, world);
        Patronage._log(player, world, `The ${def.name} at ${p.name} is complete.`);
        out.completed.push(rec);
        out.notices.push({ icon: def.icon || '🏛️', title: 'A Great Work Completed!', text: `The ${def.name} at ${p.name} stands complete (+${_num(def.prestige, 50)} Prestige).`, type: 'success' });
    },

    /** Someone else finished a unique work first: half the money comes back. */
    _forestall(player, world, p, out) {
        const st = Patronage.state(player);
        const def = Patronage.greatWork(p.workId);
        Patronage._dropProject(player, p);
        const refund = Math.floor(_num(p.spent) * _num(Patronage.config().refundOnForestall, 0.5));
        player.gold = _num(player.gold) + refund;
        st.stats.forestalled++;
        const by = Patronage.claimed(world, p.workId);
        const k = by && by.kingdomId != null ? _kingdom(world, by.kingdomId) : null;
        Patronage._log(player, world, `${k ? k.name : 'Another'} finished the ${def.name} first; your works at ${p.name} are sold off.`);
        out.notices.push({ icon: '🥈', title: 'Beaten to It', text: `${k ? k.name : 'A rival realm'} has finished the ${def.name} first. Your half-built works at ${p.name} are sold off for ${refund} gold.`, type: 'error' });
    },

    // ──────────── KINGDOMS' WONDERS ────────────

    npcProjects(world) {
        return Patronage.worldState(world).npc;
    },

    /** Kingdoms' projects of this work, with how far along they are. */
    race(world, workId) {
        return Patronage.npcProjects(world).filter(n => n.workId === workId)
            .map(n => ({ ...n, share: n.days > 0 ? n.progress / n.days : 0, kingdom: _kingdom(world, n.kingdomId) }));
    },

    _abandonNpc(world, workId, exceptUid) {
        const ws = Patronage.worldState(world);
        for (const n of ws.npc.slice()) {
            if (n.workId !== workId || n.uid === exceptUid) continue;
            const k = _kingdom(world, n.kingdomId);
            if (k) k.treasury = _num(k.treasury) + Math.floor(_num(n.paid) * 0.5);
            ws.npc = ws.npc.filter(x => x !== n);
        }
    },

    _npcDay(world, player, out) {
        const ws = Patronage.worldState(world);
        const N = Patronage.config().npc;
        const day = _day(world);
        const defs = Patronage.greatWorks();

        // Raise what is rising
        for (const n of ws.npc.slice()) {
            const k = _kingdom(world, n.kingdomId);
            const def = defs[n.workId];
            if (!k || k.isAlive === false || !def) { ws.npc = ws.npc.filter(x => x !== n); continue; }
            if (def.unique && ws.claimed[n.workId]) { Patronage._abandonNpc(world, n.workId, null); continue; }
            const cost = _num(def.npc && def.npc.cost) / Math.max(1, n.days);
            if (_num(k.treasury) < cost) continue;
            k.treasury = _num(k.treasury) - cost;
            n.paid = _num(n.paid) + cost;
            let speed = 1;
            if (Seasons.seasonOf(day) === 'Winter') speed *= _num(N.winterSpeed, 0.5);
            if (Array.isArray(k.wars) && k.wars.length) speed *= _num(N.warSpeed, 0.5);
            n.progress = Math.round((n.progress + speed) * 100) / 100;
            if (n.progress >= n.days) {
                ws.npc = ws.npc.filter(x => x !== n);
                const rec = Patronage._record(world, n.workId, n.q, n.r, 'kingdom', k.id);
                if (!Array.isArray(k.greatWorks)) k.greatWorks = [];
                k.greatWorks.push({ id: n.workId, uid: rec.uid, stability: _num(def.npc && def.npc.stability, 3) });
                if (def.unique) {
                    Patronage._abandonNpc(world, n.workId, null);
                    if (player) {
                        for (const p of Patronage.state(player).projects.filter(x => x.workId === n.workId)) Patronage._forestall(player, world, p, out);
                    }
                }
                out.worldCompleted.push(rec);
            }
        }

        // Kingdoms begin new wonders
        const cadence = Math.max(1, _num(N.cadence, 30));
        if (day < _num(N.firstDay, 90) || day % cadence !== 0) return;
        for (const k of (world.kingdoms || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
            if (ws.npc.length >= _num(N.maxActive, 3)) break;
            if (!k || k.isAlive === false || !k.capital || k.capital.q == null) continue;
            if (ws.npc.some(n => n.kingdomId === k.id)) continue;
            const have = Array.isArray(k.greatWorks) ? k.greatWorks : [];
            if (have.length >= _num(N.maxPerKingdom, 2)) continue;
            if (_roll(world, 'npcStart', k.id, day) >= _num(N.startChance, 0.22)) continue;
            const tile = world.getTile(k.capital.q, k.capital.r);
            if (!tile || !tile.settlement) continue;
            const options = Object.entries(defs).filter(([id, def]) => {
                if (!def.npc) return false;
                if (def.unique && ws.claimed[id]) return false;
                if (have.some(g => g.id === id)) return false;
                if (Patronage.builtAt(world, k.capital.q, k.capital.r).some(b => b.workId === id)) return false;
                if (_num(k.treasury) < _num(def.npc.cost) * _num(N.treasuryShare, 0.5)) return false;
                return !Patronage._placeProblem(world, def, k.capital.q, k.capital.r, tile.settlement);
            }).map(([id]) => id);
            if (!options.length) continue;
            const workId = options[_hash(`${_seed(world)}|npcWork|${k.id}|${day}`) % options.length];
            const def = defs[workId];
            const n = { uid: `gwn${ws.nextId++}`, kingdomId: k.id, workId, q: k.capital.q, r: k.capital.r, progress: 0, days: _num(def.npc.days, 360), paid: 0, startDay: day };
            ws.npc.push(n);
            out.worldBegun.push(n);
        }
    },

    // ──────────── EFFECTS ────────────

    /**
     * Recompute the player's standing effects: each kind of great work counts
     * once, and only while its site is still the player's; medical texts add up.
     */
    refreshFx(player, world) {
        const st = Patronage.state(player);
        const cfg = Patronage.config();
        const fx = Patronage._emptyFx();
        const counted = new Set();
        if (world) {
            for (const b of Patronage.playerBuilt(world)) {
                if (counted.has(b.workId) || !Patronage.siteAt(player, world, b.q, b.r)) continue;
                counted.add(b.workId);
                const eff = (Patronage.greatWork(b.workId) || {}).effects || {};
                for (const k of FX_KEYS) if (k !== 'care' && typeof eff[k] === 'number') fx[k] += eff[k];
            }
        }
        const texts = _num(st.medicalTexts);
        fx.care = Math.max(_num(cfg.careFloor, 0.6), Math.pow(_num(cfg.carePerText, 0.94), texts));
        fx.woundHeal = Math.min(_num(cfg.woundHealCap, 0.5), texts * _num(cfg.woundHealPerText, 0.1));
        fx.riverCross = Math.min(1, fx.riverCross);
        st.fx = fx;
        return fx;
    },

    /** One standing effect (0 when there is none; care is a multiplier, 1 when none). */
    fx(player, key) {
        const fx = player && player.patronage && player.patronage.fx;
        const v = fx && fx[key];
        return typeof v === 'number' && Number.isFinite(v) ? v : (key === 'care' ? 1 : 0);
    },

    // ──────────── DAILY ────────────

    /**
     * One day of patronage: clients work, are paid, sour or are poached; great
     * works are raised; kingdoms raise their wonders; standing effects are
     * refreshed. Draws no RNG.
     * → { notices, completed, worldCompleted, worldBegun }
     */
    processDay(world, player) {
        const out = { notices: [], completed: [], worldCompleted: [], worldBegun: [] };
        if (!world) return out;
        const day = _day(world);
        if (player) {
            const st = Patronage.state(player);
            if (st.lastDay === day) return out;
            st.lastDay = day;
            if (st.clients.length || st.offers.length || st.scholarship > 0) Patronage._clientsDay(player, world, out);
            if (st.projects.length) Patronage._projectsDay(player, world, out);
        }
        Patronage._npcDay(world, player, out);
        if (player) {
            const st = Patronage.state(player);
            const fx = Patronage.refreshFx(player, world);
            // The Colossus: Prestige every month
            if (fx.monthlyPrestige > 0 && day % 30 === 0 && player.house) {
                House.award(player.house, fx.monthlyPrestige, 'the Colossus', day);
            }
            for (const rec of out.worldCompleted) {
                const k = _kingdom(world, rec.kingdomId);
                out.notices.push({ icon: rec.icon || '🏛️', title: 'A Wonder Rises', text: `${k ? k.name : 'A realm'} has completed the ${rec.name} at ${rec.settlementName}.`, type: 'info' });
            }
            for (const n of out.worldBegun) {
                const def = Patronage.greatWork(n.workId);
                if (def && def.unique && st.projects.some(p => p.workId === n.workId)) {
                    const k = _kingdom(world, n.kingdomId);
                    out.notices.push({ icon: '⏳', title: 'A Race Begins', text: `${k ? k.name : 'A realm'} has begun its own ${def.name}. Only the first to finish will have it.`, type: 'warning' });
                }
            }
        }
        return out;
    },

    // ──────────── SUMMARY ────────────

    /** A short status for the panel header and the counsel. */
    summary(player, world) {
        const st = Patronage.state(player);
        return {
            clients: st.clients.length,
            max: Patronage.maxClients(player),
            weekly: st.clients.reduce((s, c) => s + _num(c.stipend), 0),
            projects: st.projects.length,
            built: world ? Patronage.playerBuilt(world).length : 0,
            gallery: st.gallery.filter(g => !g.donatedTo).length,
            spent: Math.round(_num(st.stats.goldSpent)),
        };
    },

    /** Describe a work's standing effects in words. */
    effectText(effects) {
        const e = effects || {};
        const out = [];
        if (e.research) out.push(`research +${Math.round(e.research * 100)}%`);
        if (e.conversion) out.push(`faith converts +${Math.round(e.conversion * 100)}%`);
        if (e.education) out.push(`heirs learn +${Math.round(e.education * 100)}%`);
        if (e.vision) out.push(`sight +${e.vision} hex`);
        if (e.festivalRenown) out.push(`festivals +${e.festivalRenown} renown`);
        if (e.riverCross) out.push(`river fording −${Math.round(e.riverCross * 100)}%`);
        if (e.monthlyPrestige) out.push(`+${e.monthlyPrestige} Prestige a month`);
        if (e.mood) out.push(`town happiness +${e.mood}`);
        return out.join(', ');
    },
};
