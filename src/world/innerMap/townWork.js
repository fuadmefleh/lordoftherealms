// ============================================
// InnerMap — town work: the townsfolk at their trades, meals, prayers and beds
// ============================================
// Over world/innerMap/townLife.js (who goes where each hour) this puts each
// townsperson to their own occupation (systems/townJobs.js person.job) on
// the map, at the hours of their trade:
//
//   - the day by occupation (data/townJobs.json hours): the baker up before
//     dawn at the oven, the innkeeper and the potboy late to bed, the farmer
//     out with the light and home at dusk (less in winter); breakfast at home
//     after waking, a bite at midday at the work, supper at the family table
//     (single folk at the tavern), then their leisure — and church for the
//     devout (systems/townWorship.js);
//   - the work itself: farmers to the fields (sowing in spring, hoeing in
//     summer, reaping in autumn: townLife's fields), herders and shepherds
//     with the village's flocks, fishers on the shore facing the water,
//     woodcutters and miners out at their trees and rocks (townWoodcutters.js,
//     townMiners.js) or splitting firewood at the woodpile, the smith at the
//     anvil, the carpenter at the sawhorse, the miller with the sacks (each at
//     a prop by their workplace, facing it, with the tool swung), the baker,
//     weaver, priest, healer and scribe within at their oven, loom, altar or
//     desk (furnitureUse.js), carters with a sack between the stores, servants
//     sweeping the step, washerwomen at the well; and the player's own
//     servants, guards and hands at the player's house;
//   - the homeless sleep rough in a doorway; folk of another faith pray at
//     home on the holy day; the devout drop in to the church, or kneel at a
//     wayside stone; the town's congregation is who TownWorship says goes.
//
// Hooks (one line each) from townLife.js (_settleTownLife, _townPickActivity,
// _doActivity, _npcArrivedInTown, _townStayInside, _townAbed), townScenes.js
// (_sceneAttends), furnitureUse.js (_pickFurnitureFor), npcs.js (updateNPCs)
// and interiors.js (_settleTownWork). Draws only from Utils (seedable) and
// hashes. Data: data/townJobs.json, data/townWorship.json.

import { InnerMap } from './_ref.js';
import { Utils, DataLoader } from './_imports.js';
import { TownJobs } from '../../systems/townJobs.js';
import { TownWorship } from '../../systems/townWorship.js';
import { Seasons } from '../seasons.js';
import { SettlementMarket } from '../settlementMarket.js';

const DIRS4 = [[0, 1], [1, 0], [-1, 0], [0, -1]];
const _arr = (v) => (Array.isArray(v) ? v : []);
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _dirTo(dq, dr) {
    if (Math.abs(dq) >= Math.abs(dr)) return dq >= 0 ? 3 : 1;
    return dr >= 0 ? 2 : 0;
}

function _roll(...parts) {
    let h = Utils.hashStr(parts.join('|')) >>> 0;
    // (well mixed: similar strings must not give similar rolls)
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/** Is hour h within [a, b) on the clock (a window may wrap past midnight)? */
function _inWin(h, a, b) {
    return a <= b ? h >= a && h < b : h >= a || h < b;
}

Object.assign(InnerMap, {
    /** The world and player the map was entered with (for the church and the player's people). */
    _townWorkCtx: null,

    /** From interiors.js on entering a town: keep the world and player; the homeless laid down if it is night. */
    _settleTownWork(settlement, world, player) {
        this._townWorkCtx = settlement ? { world, player, settlement } : null;
        this._attendKey = null;
        if (!settlement || !this.townArea()) return;
        for (const npc of this.npcs || []) {
            if (npc._home || npc.type === 'traveler' || npc.type === 'guard' || !this._jobSleeps || !this._jobSleeps(npc)) continue;
            const spot = this._roughSpot(npc);
            if (!spot) continue;
            npc.q = npc.prevQ = spot.q; npc.r = npc.prevR = spot.r;
            npc.path = null; npc.state = 'idle';
            this._lieRough(npc, spot.face);
        }
    },

    _jobOf(npc) {
        const p = npc && npc._person;
        const j = p && p.job;
        if (!j || p.retired || npc.departing) return null;
        const o = TownJobs.occ(j.id);
        return o ? { p, j, o } : null;
    },

    _jobHours(job) {
        const H = TownJobs.config().hours || {};
        return H[job.o.hours] || H.day || { sleep: [21.5, 5.5], work: [[7, 12], [13, 18]] };
    },

    // ──────────── PLACES ────────────

    /** After homes and work are given out (townLife._assignHomesAndWork): each to their trade's place. */
    _assignJobPlaces() {
        const blds = this._townBuildings().filter(b => !b.isPlayerOwned);
        const mine = (this.buildings || []).filter(b => b && (b.isPlayerProperty || b.isPlayerOwned));
        const byType = {};
        for (const b of blds) (byType[b.type] = byType[b.type] || []).push(b);
        const byPerson = new Map();
        for (const n of this.npcs || []) if (n._person) byPerson.set(n._person.id, n);
        for (const npc of this.npcs || []) {
            const job = this._jobOf(npc);
            npc.job = job ? job.j.id : null;
            if (!job) continue;
            npc.roleTitle = TownJobs.title(job.p) || npc.roleTitle;
            // The player's people work at the player's house
            if (job.j.employer === 'player') {
                if (mine.length) npc._work = mine[Math.floor(_roll(npc.uid, 'pw') * mine.length)];
                continue;
            }
            // The homeless sleep rough (a beggar's home was only lent them)
            if (job.j.id === 'beggar') npc._home = null;
            const owned = blds.find(b => b.ownerId === npc.id && job.o.workplaces && job.o.workplaces.includes(b.type));
            if (owned) { npc._work = owned; continue; }
            // A servant to their household; the potboy to the innkeeper's house
            const boss = job.j.master != null ? byPerson.get(job.j.master) : null;
            if (boss && (job.o.employer === 'noble' || job.o.employer === 'innkeeper')) {
                npc._work = (job.o.employer === 'noble' ? boss._home : boss._work) || npc._work;
                if (npc._work) continue;
            }
            const kinds = _arr(job.o.workplaces).filter(t => byType[t] && byType[t].length && t !== 'house');
            if (kinds.length) {
                const list = byType[kinds[0]];
                npc._work = list[Math.floor(_roll(npc.uid, 'work') * list.length)];
            } else if (_arr(job.o.workplaces).includes('house') || ['inside', 'prop', 'sweep'].includes(job.o.work)) {
                // (no shop in town: they work at home)
                npc._work = npc._home || npc._work;
            }
        }
    },

    // ──────────── THE HOUR ────────────

    /** The schedule table for a townsperson with a trade, this hour: { [period]: weights }, or null (townLife's own). */
    _jobSchedule(npc) {
        npc._roughSleep = false;
        npc._meal = null;
        npc._prayHome = false;
        npc._outWork = false;
        if (npc._awayAtWork && npc.state !== 'inside_building') { npc._awayAtWork = null; if (npc.currentBuilding === 'away') npc.currentBuilding = null; }
        const job = this._jobOf(npc);
        if (!job || npc.type === 'guard' || npc.type === 'child' || npc.type === 'traveler') return null;
        if (job.j.employer === 'player' && job.j.pk === 'guard') return null;
        const period = this.townPeriod();
        const h = ((this.timeOfDay == null ? 8 : this.timeOfDay) % 24 + 24) % 24;
        const day = this.worldDay || 0;
        const H = this._jobHours(job);
        const [bed, wake] = H.sleep || [21.5, 5.5];
        const one = (w) => ({ [period]: w });
        if (_inWin(h, bed, wake)) return one(npc._home ? { home: 1 } : { rough: 1 });
        // Another faith keeps the holy day at home
        const sv = this.serviceAt ? this.serviceAt(h, day) : null;
        const ctx = this._townWorkCtx;
        if (sv && sv.holy && sv.idx === 2 && TownWorship.faithOf(npc._folk, job.p, ctx && ctx.player) !== 'town' && npc._home) {
            npc._prayHome = true;
            return one({ home: 1 });
        }
        const M = TownJobs.config().meals || {};
        const u = _roll(npc.uid, day, Math.floor(h), 'meal');
        const B = M.breakfast || {};
        if (_inWin(h, wake + _num(B.after, 0.3), wake + _num(B.after, 0.3) + _num(B.len, 0.7)) && u < _num(B.share, 0.7)) return one({ breakfast: 1 });
        const S = M.supper || {};
        if (S.hours && h >= S.hours[0] && h < S.hours[1] && u < _num(S.share, 0.85) && !_arr(H.work).some(w => _inWin(h, w[0], w[1]))) return one({ supper: 1 });
        const L = M.midday || {};
        if (L.hours && h >= L.hours[0] && h < L.hours[1] && u < _num(L.share, 0.8)) return one({ lunch: 1 });
        const working = _arr(H.work).some(w => _inWin(h, w[0], w[1]));
        const winter = Seasons.seasonOf(day) === 'Winter';
        if (working && !(winter && H.winterWork != null && u > H.winterWork)) return one({ work: 8, chat: 0.4, errand: 0.3 });
        // Leisure: the evening out, or the day's own; the devout to church
        const Ls = TownJobs.config().leisure || {};
        const w = { ...(h >= 18 ? Ls.evening : Ls.day) };
        const dev = TownWorship.devotion(npc._folk, job.p, day, ctx ? TownWorship.piety(ctx.world, ctx.settlement) : 50);
        w.church = _num(w.church, 0.4) * dev * 3;
        if (dev > 0.6) w.wayside = 0.6;
        return one(w);
    },

    /** One of the trade's own doings (townLife._doActivity's hook): true when it set them going. */
    _jobActivity(npc, act, period) {
        const job = this._jobOf(npc);
        const rnd = Utils.random;
        switch (act) {
            case 'rough': {
                const spot = this._roughSpot(npc);
                if (!spot) return false;
                npc._roughFace = spot.face;
                return this._goStand(npc, spot, 'rough', spot.face);
            }
            case 'breakfast':
            case 'supper': {
                const single = job && job.p.spouse == null && !_arr(job.p.kids).length;
                const M = TownJobs.config().living || {};
                if (act === 'supper' && (!npc._home || (single && _roll(npc.uid, this.worldDay, 'tav') < _num(M.tavernShare, 0.5)))) {
                    const tav = this._townBuildings().find(b => ['tavern', 'inn'].includes(b.type));
                    if (tav) { npc._meal = 'tavern'; return this._goInto(npc, tav, 'tavern'); }
                }
                if (!npc._home) return false;
                npc._meal = act;
                return this._goInto(npc, npc._home, 'home');
            }
            case 'lunch': {
                if (!job) return false;
                // (a bite where they work: out front of the workplace, or where they stand)
                // (out front of the workplace, along its own frontage: never a tile behind its walls)
                const at = npc._work ? this._findPassableAdjacentTile(npc._work.q, npc._work.r) : { q: npc.q, r: npc.r };
                const taken = new Set((this.npcs || []).filter(o => o !== npc).map(o => `${o.q},${o.r}`));
                const spot = [[0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0], [0, 1]].map(([dq, dr]) => ({ q: at.q + dq, r: at.r + dr })).find(s => {
                    const t = this.tiles[s.r] && this.tiles[s.r][s.q];
                    return t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart && !this.getBuildingAt(s.q, s.r) && !taken.has(`${s.q},${s.r}`);
                }) || at;
                npc._meal = 'midday';
                return this._goStand(npc, spot, 'lunch', 2);
            }
            case 'wayside': {
                const stone = this._waysideStone(npc);
                if (!stone) return false;
                return this._goStand(npc, stone.spot, 'wayside', stone.face);
            }
            case 'work':
                return job ? this._jobWork(npc, job) : false;
            default:
                return false;
        }
    },

    /** At work, by the trade's kind. */
    _jobWork(npc, job) {
        const rnd = Utils.random;
        const o = job.o;
        npc._jobAct = null;
        if (job.j.employer === 'player') {
            const K = (TownJobs.config().playerJobs.kinds || {})[job.j.pk] || {};
            if (K.work === 'carry') return this._jobCarry(npc);
            const b = npc._work;
            if (!b) return false;
            const door = this._findPassableAdjacentTile(b.q, b.r);
            npc._jobAct = K.work === 'post' ? { icon: '🛡️', label: 'Keeping your door', anim: 'ready' } : { icon: '🏠', label: 'Sweeping your step', anim: 'swing' };
            return this._goStand(npc, door, 'job', K.work === 'post' ? 2 : 0);
        }
        switch (o.work) {
            case 'field': {
                const winter = Seasons.seasonOf(this.worldDay || 0) === 'Winter';
                if (!winter && this._goToField(npc)) return true;
                return this._jobAtProp(npc, ['tp_logs', 'tp_firewood', 'tp_haystack', 'tp_hay_gold'], { icon: '🌲', label: 'Splitting firewood', anim: 'slash', tool: 'axe', swing: 0.9 }, npc._home);
            }
            case 'herd': {
                if (this._jobHerd(npc, o)) return true;
                return this._goToField(npc);
            }
            // (no shore within reach: out at dawn to the river or the coast beyond the map, back at dusk)
            case 'fish': return this._jobFish(npc, o) || this._jobCommute(npc, job);
            case 'chop': {
                if (this._goToTree && rnd() < 0.65 && this._goToTree(npc)) return true;
                return this._jobAtProp(npc, o.props, o.activity, npc._work || npc._home);
            }
            case 'mine': {
                if (this._goToRock && this._goToRock(npc)) return true;
                // (no rock in reach: off to the pits in the hills for the day)
                return this._jobCommute(npc, job);
            }
            case 'prop': {
                if (this._jobAtProp(npc, o.props, o.activity, npc._work || npc._home)) return true;
                return npc._work ? this._goInto(npc, npc._work, 'work') : false;
            }
            case 'inside': return npc._work ? this._goInto(npc, npc._work, 'work') : false;
            case 'carry': return this._jobCarry(npc);
            case 'sweep': {
                const b = npc._work || npc._home;
                if (!b || rnd() < 0.4) return b ? this._goInto(npc, b, 'work') : false;
                npc._jobAct = { icon: '🏠', label: 'Sweeping the step', anim: 'swing' };
                return this._goStand(npc, this._findPassableAdjacentTile(b.q, b.r), 'job', 2);
            }
            case 'wash': return this._jobWash(npc);
            case 'beg': {
                // In a dearth the beggars wait at the baker's door
                const ctx = this._townWorkCtx;
                let dearth = false;
                try { dearth = !!(ctx && SettlementMarket.inDearth(ctx.settlement)); } catch (e) { dearth = false; }
                const bakery = dearth ? this._townBuildings().find(b => b.type === 'bakery') : null;
                if (!bakery) return false;
                npc._jobAct = { icon: '🍲', label: 'Begging bread at the baker\'s', anim: 'sitting', pose: 0 };
                return this._goStand(npc, this._findPassableAdjacentTile(bakery.q, bakery.r), 'job', 2);
            }
            case 'none':
                if (job.j.id === 'unemployed') {
                    npc._jobAct = { icon: '💰', label: 'Asking for work', anim: 'idle' };
                    const b = this._townBuildings().filter(x => x.type !== 'house');
                    const t = b[Math.floor(rnd() * b.length)];
                    return t ? this._goStand(npc, this._findPassableAdjacentTile(t.q, t.r), 'job', _dirTo(t.q - npc.q, t.r - npc.r)) : false;
                }
                return false;
            default:
                return false;   // (the stall's keeper: townScenes; a beggar's alms: townScenes)
        }
    },

    /** Stand at one of the props by a workplace, facing it, at the trade's work. */
    _jobAtProp(npc, props, activity, base) {
        if (!base || !_arr(props).length) return false;
        const want = new Set(props);
        const door = this._findPassableAdjacentTile(base.q, base.r);
        const reach = 7;
        let best = null;
        const taken = new Set((this.npcs || []).filter(o => o !== npc).map(o => `${o.q},${o.r}`));
        for (let r = door.r - reach; r <= door.r + reach; r++) {
            for (let q = door.q - reach; q <= door.q + reach; q++) {
                const t = this.tiles[r] && this.tiles[r][q];
                if (!t || !t.customObject || !want.has(t.customObject.defId) || t._isInterior) continue;
                for (const key of this._footprintAt(q, r)) {
                    const [fq, fr] = key.split(',').map(Number);
                    for (const [dq, dr] of DIRS4) {
                        const sq = fq + dq, sr = fr + dr;
                        const st = this.tiles[sr] && this.tiles[sr][sq];
                        if (!st || !st.subTerrain || !st.subTerrain.passable || st.customObject || st.customObjectPart || st.isWater || this.getBuildingAt(sq, sr) || taken.has(`${sq},${sr}`)) continue;
                        // (beside it or before it, not behind it, where the work is seen)
                        const d = Math.hypot(sq - door.q, sr - door.r) + (dr < 0 ? 1.5 : 0);
                        if (!best || d < best.d) best = { d, spot: { q: sq, r: sr }, face: _dirTo(fq - sq, fr - sr) };
                    }
                }
            }
        }
        if (!best) return false;
        npc._jobAct = activity || null;
        return this._goStand(npc, best.spot, 'job', best.face);
    },

    /** A herder to the flock: beside one of the town's beasts, facing it. */
    _jobHerd(npc, o) {
        const beasts = (this.animals || []).filter(a => a && a.livestock && !a.dead && !a.carcass);
        if (!beasts.length) return false;
        const base = npc._home || npc;
        const near = beasts.map(a => ({ a, d: Math.hypot(a.q - base.q, a.r - base.r) })).sort((x, y) => x.d - y.d).slice(0, 4);
        const { a } = near[Math.floor(Utils.random() * near.length)];
        const aq = Math.round(a.q), ar = Math.round(a.r);
        // (not on another's spot, nor where another is headed)
        const taken = new Set((this.npcs || []).filter(x => x !== npc).flatMap(x => [`${x.q},${x.r}`, ...(x.path && x.path.length ? [`${x.path[x.path.length - 1].q},${x.path[x.path.length - 1].r}`] : [])]));
        for (const [dq, dr] of [[-2, 0], [2, 0], [0, 2], [0, -2], [-1, 1], [1, 1]]) {
            const q = aq + dq, r = ar + dr;
            const t = this.tiles[r] && this.tiles[r][q];
            if (!t || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.customObjectPart || t.isWater || taken.has(`${q},${r}`)) continue;
            npc._outWork = true;
            npc._jobAct = { icon: o.icon || '🐑', label: o.icon === '🐄' ? 'Minding the herd' : 'Tending the flock', anim: 'idle' };
            if (this._goStand(npc, { q, r }, 'job', _dirTo(aq - q, ar - r))) return true;
        }
        return false;
    },

    /** The shore, or a pier: dry land beside the water within reach of home, facing it. */
    _shoreSpots() {
        if (this._shoreCache && this._shoreCache.tiles === this.tiles) return this._shoreCache.list;
        const list = [];
        const m = (this.townArea() || {}).margin || 8;
        for (let r = m; r < this.height - m; r++) {
            const row = this.tiles[r];
            if (!row) continue;
            for (let q = m; q < this.width - m; q++) {
                const t = row[q];
                if (!t || t.isWater || !t.subTerrain || !t.subTerrain.passable || t.customObject || t._isInterior) continue;
                for (const [dq, dr] of DIRS4) {
                    const w = this.tiles[r + dr] && this.tiles[r + dr][q + dq];
                    if (w && w.isWater) { list.push({ q, r, face: _dirTo(dq, dr) }); break; }
                }
            }
        }
        this._shoreCache = { tiles: this.tiles, list };
        return list;
    },

    _jobFish(npc, o) {
        const base = npc._home || npc;
        const taken = new Set((this.npcs || []).filter(x => x !== npc).map(x => `${x.q},${x.r}`));
        const spots = this._shoreSpots().filter(s => !taken.has(`${s.q},${s.r}`) && Math.hypot(s.q - base.q, s.r - base.r) < 45);
        if (!spots.length) return false;
        spots.sort((a, b) => Math.hypot(a.q - base.q, a.r - base.r) - Math.hypot(b.q - base.q, b.r - base.r));
        const pick = spots[Math.floor(Utils.random() * Math.min(8, spots.length))];
        npc._outWork = true;
        npc._jobAct = { icon: '🎣', label: 'Fishing', anim: 'halfslash', pose: 1, fish: true };
        return this._goStand(npc, pick, 'job', pick.face);
    },

    /**
     * A fisher or miner with no shore or rock on the map: to the nearest of
     * the town's gates, and out (TownJobs hours: back at the end of the day's
     * work). → true when set going.
     */
    _jobCommute(npc, job) {
        const A = this.townArea();
        if (!A || !_arr(A.gates).length || npc.type === 'child') return false;
        if (npc._commuted === (this.worldDay || 0)) return false;
        const base = npc._home || npc;
        const gate = [...A.gates].sort((a, b) => Math.hypot(a.q - base.q, a.r - base.r) - Math.hypot(b.q - base.q, b.r - base.r))[0];
        // (the gateway itself, or the nearest open ground beside it)
        const ok = (q, r) => { const t = this.tiles[r] && this.tiles[r][q]; return t && t.subTerrain && t.subTerrain.passable && !t.isWater && !t.customObject; };
        let spot = ok(gate.q, gate.r) ? { q: gate.q, r: gate.r } : null;
        for (let rad = 1; !spot && rad <= 3; rad++) {
            for (let dq = -rad; dq <= rad && !spot; dq++) for (let dr = -rad; dr <= rad && !spot; dr++) if (ok(gate.q + dq, gate.r + dr)) spot = { q: gate.q + dq, r: gate.r + dr };
        }
        if (!spot) return false;
        npc._commuteKind = job.o.work;
        npc._outWork = true;
        return this._goStand(npc, spot, 'commute', gate.face != null ? gate.face : null);
    },

    /** At the gate: gone out of the town till the day's work ends (hidden 'away', back in at the same gate). */
    _goAway(npc) {
        const job = this._jobOf(npc);
        if (!job) return false;
        const H = this._jobHours(job);
        const end = Math.max(..._arr(H.work).map(w => _num(w[1], 18)), 17);
        const secs = this._sceneSecsTo ? this._sceneSecsTo(end) : 0;
        if (!(secs > 20)) return false;
        const lines = (TownJobs.config().commute || {})[npc._commuteKind] || [];
        if (lines.length && this._sceneNear && this._sceneNear(npc.q, npc.r) && this._sceneSay) this._sceneSay(npc, lines[Math.floor(_roll(npc.uid, this.worldDay, 'cm') * lines.length)], 200);
        npc._commuted = this.worldDay || 0;
        npc.path = null;
        npc.activity = null;
        npc._outsideQ = npc.q; npc._outsideR = npc.r;
        npc.state = 'inside_building';
        npc.currentBuilding = 'away';
        npc._insideBuildingQ = -9999; npc._insideBuildingR = -9999;
        npc._awayAtWork = { kind: npc._commuteKind, until: end };
        npc.idleTimer = secs;
        return true;
    },

    /** Washing at the water's edge, else at the well in the square. */
    _jobWash(npc) {
        const base = npc._home || npc;
        const shore = this._shoreSpots().filter(s => Math.hypot(s.q - base.q, s.r - base.r) < 30);
        npc._outWork = true;
        npc._jobAct = { icon: '🧺', label: 'Washing linen', anim: 'sitting', pose: 1 };
        if (shore.length) {
            const s = shore[Math.floor(Utils.random() * shore.length)];
            return this._goStand(npc, s, 'job', s.face);
        }
        return this._jobAtProp(npc, ['tp_well', 'tp_water_barrel', 'tp_pool'], npc._jobAct, (this.townArea() || {}).center ? { q: this.townArea().center.q, r: this.townArea().center.r } : null);
    },

    /** A carter with a sack: from where they are to another of the stores or the market. */
    _jobCarry(npc) {
        const stores = this._townBuildings().filter(b => ['granary', 'barn', 'mill', 'warehouse', 'marketplace', 'farm'].includes(b.type) && b !== npc._lastHaul);
        if (!stores.length) return false;
        const b = stores[Math.floor(Utils.random() * stores.length)];
        const goods = ['grain', 'flour', 'wool', 'salt', 'cabbage'];
        npc._carry = { good: goods[Math.floor(Utils.random() * goods.length)], qty: 0 };
        npc._lastHaul = b;
        return this._goInto(npc, b, 'deliver');
    },

    /** A wayside stone to kneel at (a runestone or menhir about the town), or null. */
    _waysideStone(npc) {
        const A = this.townArea();
        if (!A) return null;
        return this._findPropSpot(['tp_runestone', 'tp_runestone_grey', 'tp_rock_menhir'], A.center, 30);
    },

    _findPropSpot(props, near, reach) {
        const want = new Set(props);
        let best = null;
        for (let r = Math.floor(near.r - reach); r <= near.r + reach; r++) {
            for (let q = Math.floor(near.q - reach); q <= near.q + reach; q++) {
                const t = this.tiles[r] && this.tiles[r][q];
                if (!t || !t.customObject || !want.has(t.customObject.defId)) continue;
                const s = this.tiles[r + 1] && this.tiles[r + 1][q];
                if (!s || !s.subTerrain || !s.subTerrain.passable || s.customObject) continue;
                const d = Math.hypot(q - near.q, r - near.r);
                if (!best || d < best.d) best = { d, spot: { q, r: r + 1 }, face: 0 };
            }
        }
        return best;
    },

    /** A doorway or an alley to sleep rough in: beside a building that isn't a house, out of the way. */
    _roughSpot(npc) {
        const blds = this._townBuildings().filter(b => b.type !== 'house');
        if (!blds.length) return null;
        const taken = new Set((this.npcs || []).filter(o => o !== npc).map(o => `${o.q},${o.r}`));
        const k = Math.floor(_roll(npc.uid || npc.id, 'rough') * blds.length);
        for (let i = 0; i < blds.length; i++) {
            const b = blds[(k + i) % blds.length];
            const door = this._findPassableAdjacentTile(b.q, b.r);
            for (const [dq, dr] of [[1, 0], [-1, 0], [2, 0], [-2, 0]]) {
                const q = door.q + dq, r = door.r + dr;
                const t = this.tiles[r] && this.tiles[r][q];
                if (!t || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.customObjectPart || t.isWater || taken.has(`${q},${r}`)) continue;
                return { q, r, face: 2 };
            }
        }
        return null;
    },

    _lieRough(npc, face) {
        const S = TownJobs.config().sleepRough || {};
        npc._roughSleep = true;
        npc.facing = face != null ? face : 2;
        npc.activity = { type: 'rough', icon: S.icon || '💤', label: S.label || 'Sleeping rough', anim: 'idle', quiet: true, _scene: true };
        npc.idleTimer = 60 + _roll(npc.uid, this.worldDay, 'zz') * 60;
    },

    // ──────────── ARRIVED ────────────

    /** Arrived at the business (townLife._npcArrivedInTown): to it, with the tool, the bark. */
    _jobArrived(npc, act) {
        const job = this._jobOf(npc);
        if (act === 'rough') { this._lieRough(npc, npc._roughFace); return; }
        if (act === 'commute') { this._goAway(npc); return; }
        if (act === 'field') {
            // The season's work in the fields
            const ssn = Seasons.seasonOf(this.worldDay || 0);
            if (npc.activity && npc.activity.type === 'field' && npc.activity.anim !== 'halfslash') {
                if (ssn === 'Spring') Object.assign(npc.activity, { label: 'Sowing', icon: '🌾', anim: 'halfslash', tool: null });
                else if (ssn === 'Summer') npc.activity.label = 'Hoeing between the rows';
                else if (ssn === 'Winter') npc.activity.label = 'Turning the soil';
            } else if (npc.activity && npc.activity.type === 'field') npc.activity.label = 'Reaping';
            if (job) this._jobBark(npc, job.o.barks);
            return;
        }
        if (act === 'lunch') {
            const p = job && job.p;
            const day = this.worldDay || 0;
            const M = TownJobs.config().meals || {};
            const hungry = p && p.hungry != null && day - p.hungry < 30;
            const diet = hungry ? 'hungry' : (p && p.diet === 'poor') ? 'poor' : (p && p.diet === 'rich') ? 'rich' : 'midday';
            const icon = hungry ? '🍲' : diet === 'poor' ? '🍲' : diet === 'rich' ? '🍖' : '🍞';
            npc.activity = { type: 'meal', icon, label: (M.labels || {})[diet] || 'Eating', anim: 'idle', _scene: true };
            this._jobBark(npc, (M.barks || {})[hungry ? 'hungry' : diet === 'poor' ? 'poor' : 'midday']);
            return;
        }
        if (act === 'wayside') {
            const W = (DataLoader._gamedata && DataLoader._gamedata.townWorship && DataLoader._gamedata.townWorship.lines) || {};
            npc.activity = { type: 'pray', icon: '🙏', label: W.wayside || 'Praying', anim: 'sitting', _scene: true };
            npc._pose = 0;
            return;
        }
        if (act !== 'job' || !npc._jobAct) return;
        const A = npc._jobAct;
        npc.activity = { type: 'job', icon: A.icon, label: A.label, anim: A.anim || 'idle', _scene: true };
        if (A.pose != null) npc._pose = A.pose;
        if (A.tool) npc._swing = { tool: A.tool, interval: Number(A.swing) || 0.9, t: _roll(npc.uid, 'sw'), sound: A.sound || null };
        if (job) this._jobBark(npc, A.fish ? job.o.barks : job.o.barks);
    },

    /** Now and then, near the player: a line about the work. */
    _jobBark(npc, lines) {
        const C = TownJobs.config();
        if (!_arr(lines).length || !this._sceneNear || !this._sceneNear(npc.q, npc.r)) return;
        const now = _now();
        if (npc._jobBarkAt && now - npc._jobBarkAt < _num(C.barkGap, 90) * 1000) return;
        if (Utils.random() >= _num(C.barkChance, 0.18)) return;
        npc._jobBarkAt = now;
        const line = lines[Math.floor(Utils.random() * lines.length)];
        if (this._sceneSay) this._sceneSay(npc, line, 400);
    },

    // ──────────── BEDS AND FURNITURE ────────────

    /** Abed by their trade's hours? true/false, or null (townLife's own night). */
    _jobSleeps(npc) {
        const job = this._jobOf(npc);
        if (!job || npc.type === 'guard' || npc.type === 'traveler' || npc.type === 'child') return null;
        const h = ((this.timeOfDay == null ? 8 : this.timeOfDay) % 24 + 24) % 24;
        const [bed, wake] = this._jobHours(job).sleep || [21.5, 5.5];
        return _inWin(h, bed, wake);
    },

    /** Indoors: what furniture they go to — the table at a meal, the trade's own at work, the altar at home on the holy day. */
    _jobFurniture(npc) {
        if (npc._meal === 'breakfast' || npc._meal === 'supper') return ['table'];
        if (npc._prayHome) return ['altar', 'statue', 'table'];
        const job = this._jobOf(npc);
        const b = npc._work;
        if (job && b && npc._insideBuildingQ === b.q && npc._insideBuildingR === b.r && _arr(job.o.furniture).length) return job.o.furniture;
        return null;
    },

    /** The seats round this room's tables (a stool each side of a table tile), facing the table. */
    _tableSeats() {
        if (this._mealSeats && this._mealSeats.tiles === this.tiles) return this._mealSeats.list;
        const list = [];
        const seen = new Set();
        for (const f of this.getFurnitureSpots().filter(s => s.type === 'table')) {
            for (const [dq, dr] of [[0, 1], [0, -1], [-1, 0], [1, 0]]) {
                const q = f.q + dq, r = f.r + dr;
                const t = this.tiles[r] && this.tiles[r][q];
                if (!t || !t.subTerrain || !t.subTerrain.passable || t._furniture || t._isDoor || t._stairs || seen.has(`${q},${r}`)) continue;
                seen.add(`${q},${r}`);
                list.push({ q, r, at: { q: f.q, r: f.r }, face: _dirTo(-dq, -dr) });
            }
        }
        this._mealSeats = { tiles: this.tiles, list };
        return list;
    },

    /**
     * A seat for one the table has no stool left for: a stool drawn up to the
     * hearth (facing the fire), else against a wall, never left standing.
     * → { q, r, at, face, hearth?, wall? } or null
     */
    _overflowSeat(used) {
        const free = (q, r) => {
            const t = this.tiles[r] && this.tiles[r][q];
            return t && t.subTerrain && t.subTerrain.passable && !t._furniture && !t._isDoor && !t._stairs && !used.has(`${q},${r}`)
                && !(this.npcs || []).some(o => o.q === q && o.r === r && o.state !== 'walking');
        };
        const spots = this.getFurnitureSpots();
        for (const f of spots.filter(x => x.type === 'fireplace')) {
            for (const [dq, dr] of [[0, 1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, 2], [-1, 2], [1, 2]]) {
                const q = f.q + dq, r = f.r + dr;
                if (free(q, r)) return { q, r, at: { q: f.q, r: f.r }, face: _dirTo(f.q - q, f.r - r), hearth: true };
            }
        }
        // (by a wall: the floor beside one, sat facing into the room)
        for (let r = 1; r < this.height - 1; r++) {
            for (let q = 1; q < this.width - 1; q++) {
                if (!free(q, r)) continue;
                for (const [dq, dr] of DIRS4) {
                    const w = this.tiles[r + dr] && this.tiles[r + dr][q + dq];
                    if (w && w.subTerrain && !w.subTerrain.passable && !w._furniture) return { q, r, at: { q: q - dq, r: r - dr }, face: _dirTo(-dq, -dr), wall: true };
                }
            }
        }
        return null;
    },

    /**
     * Indoors at home for breakfast or supper: to a seat at the table, sat on a stool
     * facing it with a bowl (furnitureUse.js _updateInteriorNpc's hook). True while it has them.
     */
    _jobTableMeal(npc, dt) {
        const meal = npc._meal;
        const b = this._insideBuilding;
        if ((meal !== 'supper' && meal !== 'breakfast') || !b || !npc._home || npc._home.q !== b.q || npc._home.r !== b.r) return false;
        npc.idleTimer -= dt;
        if (npc.idleTimer <= 0) { npc._meal = null; npc._mealSeat = null; npc.activity = null; return false; }
        if (!npc._mealSeat) {
            const used = new Set((this.npcs || []).filter(o => o !== npc && o._mealSeat).map(o => `${o._mealSeat.q},${o._mealSeat.r}`));
            // (a big household: past the table's stools, the rest draw a stool up to the hearth, else by the wall)
            const seat = this._tableSeats().find(s => !used.has(`${s.q},${s.r}`)) || this._overflowSeat(used);
            if (!seat) { npc._meal = null; return false; }
            npc._mealSeat = seat;
            npc.activity = null;
            if (!(npc.q === seat.q && npc.r === seat.r) && !this._npcWalkTo(npc, seat.q, seat.r)) { npc.q = npc.prevQ = seat.q; npc.r = npc.prevR = seat.r; }
        }
        const seat = npc._mealSeat;
        if (npc.path) { this._npcStep(npc, dt); return true; }
        if (npc.q !== seat.q || npc.r !== seat.r) { npc.q = npc.prevQ = seat.q; npc.r = npc.prevR = seat.r; }
        if (!npc.activity || npc.activity.type !== 'meal') {
            const M = TownJobs.config().meals || {};
            const p = npc._person;
            const poor = p && p.diet === 'poor';
            const label = seat.hearth ? (M.labels || {}).hearth || 'Supper by the hearth' : seat.wall ? (M.labels || {}).secondSitting || 'Eating off the knee' : (M.labels || {})[poor ? 'poor' : meal] || 'At supper';
            npc.activity = { type: 'meal', icon: '🍲', label, anim: 'sitting', seat: 'stool', at: seat.at };
            npc.facing = seat.face;
        }
        return true;
    },

    // ──────────── LIT WINDOWS ────────────

    /**
     * Is this house dark tonight — everyone who lives there abed, or out
     * (ui/lightSystem.js leaves its window glow off)? Only houses with
     * people of the town's roll; recounted at most twice a second.
     */
    _householdDark(bldg) {
        if (!bldg || !this.townArea() || this._insideBuilding) return false;
        const now = _now();
        let C = this._darkCache;
        if (!C || C.tiles !== this.tiles || now - C.t > 500) {
            const homes = new Map();
            for (const n of this.npcs || []) {
                const h = n && n._home;
                if (!h || n.state === 'gone' || n.type === 'traveler') continue;
                const k = `${h.q},${h.r}`;
                const e = homes.get(k) || { lives: 0, awake: 0 };
                e.lives++;
                const atHome = n.state === 'inside_building' && n._insideBuildingQ === h.q && n._insideBuildingR === h.r;
                if (atHome && !(this._townAbed && this._townAbed(n))) e.awake++;
                homes.set(k, e);
            }
            C = this._darkCache = { tiles: this.tiles, t: now, homes };
        }
        const e = C.homes.get(`${bldg.q},${bldg.r}`);
        return !!e && e.lives > 0 && e.awake === 0;
    },

    // ──────────── THE CHURCH ────────────

    /** Does this townsperson go to this service? (townScenes._sceneAttends) true/false, or null for its own rule. */
    _worshipAttends(npc, sv) {
        const p = npc && npc._person;
        const folk = npc && npc._folk;
        if (!p || !folk || !TownWorship.config().enabled) return null;
        const ctx = this._townWorkCtx;
        const piety = ctx ? TownWorship.piety(ctx.world, ctx.settlement) : 50;
        const faith = ctx ? TownWorship.townFaith(ctx.world, ctx.settlement) : null;
        return TownWorship.attends(folk, p, this.worldDay || 0, !!sv.holy, sv.idx, { piety, player: ctx && ctx.player, faithId: faith && faith.id });
    },

    /** Each frame: the player sat through a service in the church is noticed (once a service). */
    _updateTownWork() {
        const ctx = this._townWorkCtx;
        const b = this._insideBuilding;
        const ref = this._currentWorldTileRef;
        if (!ctx || !ref || ref.settlement !== ctx.settlement) return;
        if (!b || !['church', 'temple', 'chapel'].includes(String(b.type).replace(/^player_/, '')) || !this.serviceAt) return;
        const sv = this.serviceAt(this._sceneClock ? this._sceneClock() : this.timeOfDay, this.worldDay || 0, false);
        const key = sv ? `${this.worldDay}:${sv.idx}` : null;
        if (sv && sv.phase >= 0.8 && this._attendKey !== key) {
            this._attendKey = key;
            const res = TownWorship.attend(ctx.player, ctx.world, ctx.settlement);
            const priest = (this.npcs || []).find(n => n._scene && n._scene.role === 'staff');
            const W = TownWorship.config().lines || {};
            if (res && priest && this._sceneSay) this._sceneSay(priest, _arr(W.attended)[Math.floor(Utils.random() * _arr(W.attended).length)] || 'Go in peace.', 1500, 4);
        }
    },
});

