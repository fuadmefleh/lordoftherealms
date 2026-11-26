// InnerMap — the newcomers' camp on a town's outskirts (systems/arrivalCamps.js).
//
// While a town's camp stands (settlement.growth.camp) its street map shows it:
// on open ground beyond the built town (outside the walls), east or west along
// the roads out rather than where the new streets go (north and south:
// world/townGrowth.js, though they may come its way: the camp moves then),
// near water if there is any — canvas tents in rows (a tent to each household
// still under canvas: TownGrowth.tentHouseholds), fires between them, firewood,
// sacks, crates and a water barrel, washing lines (drawn by
// ui/innerMapLayers/entities.js), a wagon or two (ui/innerMapCarts.js) and a
// few of the households' beasts; the ground trodden bare about it and a path
// worn to the road. The camp's households (p.camp) sleep in its tents and
// spend part of their day about it; the rest of the day they go to the well,
// the market and to work like anyone else. As households move into their new
// houses (p.lotHome: their house on its lot is their home) the camp shrinks;
// struck, a cold fire ring is left and the trodden ground grows back over
// the fade days.
//
// Pitched on entering (enter → _pitchArrivalCamp, after the buildings are
// known), laid again only when it has changed (the record's sig, kept on its
// hub tile); everything it puts down is tagged (customObject.arrivalCamp,
// tile._campSoil) so it can always be struck. Hash-placed: no draws on any RNG.

import { InnerMap } from './_ref.js';
import { CustomObjects, CustomBuildings, Utils } from './_imports.js';
import { TownProps } from '../townProps.js';
import { TownGrowth } from '../townGrowth.js';
import { markHash } from '../townMarks.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _h = markHash;
const _wet = t => !!(t && (t._wet || (t.subTerrain && /water/.test(t.subTerrain.id || ''))));

// Tent slots about the hub: rows of five, the doors (south) on the open band between
// the first two rows; [dq, dr] of each tent's anchor (its bottom-left cell)
const ROWS = [-2, 7, -11, 16];
const COLS = [-1, 4, -6, 9, -11];

Object.assign(InnerMap, {
    /**
     * How many tents the camp shows: a tent to each household still under canvas
     * (systems/arrivalCamps.js tentHouseholds: the roster's households, or for a
     * town that keeps no roster as many families as its campers make), never more
     * tents than households, at most maxTents.
     */
    _campTentCount(settlement) {
        const C = TownGrowth.config();
        const camp = TownGrowth.camp(settlement);
        if (!camp) return 0;
        const n = TownGrowth.tentHouseholds(settlement);
        return Math.max(0, Math.min(_num(C.maxTents, 14), n));
    },

    /**
     * What room the town's street map has for its streets laid since: the map laid
     * out without being shown (its plan, its water and the streets, nothing more),
     * drawing nothing from the shared dice and leaving the map in hand as it is.
     * → the lots laid ([{ id, street, infill?, … }]), or null when there is no map
     * to lay (the street data not loaded).
     */
    surveyGrowth(world, q, r) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        if (!tile || !tile.settlement || !this.CONFIG || typeof this.generate !== 'function') return null;
        // (the town's designs must be in hand, as they are on its map: else no survey — the street is
        // kept whole and fitted to the map the first time it is laid, TownGrowth.settleUnsurveyed)
        if (!CustomBuildings.isLoaded || !CustomBuildings.isLoaded() || !CustomObjects.isLoaded || !CustomObjects.isLoaded()) return null;
        const keep = [this.width, this.height, this._waterGround];
        try {
            const seed = (Utils.hashStr(`survey|${q},${r}`) >>> 0) || 1;
            return Utils.withRng(Utils.seededRandom(seed), () => {
                const tiles = this.generate(tile, q, r, { world, player: null }, { survey: true });
                return tiles && Array.isArray(tiles._growthLaid) ? tiles._growthLaid : null;
            });
        } catch (e) {
            return null;
        } finally {
            [this.width, this.height, this._waterGround] = keep;
        }
    },

    /** The camp's record on this map (on its hub tile), or null. */
    _arrivalCampRecord() {
        for (const row of this.tiles || []) for (const t of row) if (t && t._arrivalCamp) return t._arrivalCamp;
        return null;
    },

    /**
     * The camp as the town's record has it today: pitched, shrunk, struck (its
     * trodden ground fading), or nothing. → the record laid, or null.
     */
    _pitchArrivalCamp(settlement, world) {
        this._campView = null;
        if (this._insideBuilding || !this.tiles || !settlement || !TownGrowth.on()) return null;
        if (this._isDawnVillage && this._isDawnVillage(settlement)) return null;
        const g = TownGrowth.of(settlement);
        const camp = g && g.camp;
        const cleared = g && !camp ? g.cleared : null;
        const day = Math.floor(_num(world && world.day));
        const fade = Math.max(1, _num(TownGrowth.config().fadeDays, 40));
        let want = null;
        if (camp) want = `${camp.id}|t${this._campTentCount(settlement)}`;
        else if (cleared && day - _num(cleared.d) < fade) want = `${cleared.id}|x${Math.min(3, Math.floor((day - _num(cleared.d)) / fade * 4))}`;
        const rec = this._arrivalCampRecord();
        if (rec && rec.sig === want) { this._campView = camp ? rec : null; return rec; }
        if (!rec && !want) return null;
        const id = camp ? camp.id : cleared ? cleared.id : null;
        const keepHub = rec && rec.id === id ? rec.hub : null;
        const struck = this._strikeArrivalCamp();
        if (!want) { if (struck) this._regrassCamp(struck); return null; }
        // (where it stood before, kept on the town's record, so a map laid out anew finds it in its place)
        const was = (camp && camp.site) || (cleared && cleared.site) || null;
        const wt = was && this.tiles[was.r] && this.tiles[was.r][was.q];
        const okWas = wt && !wt.isRoad && !wt.customBuilding && !wt.customBuildingPart && !wt._lot && !_wet(wt) && !wt._townWall;
        const hub = keepHub || (okWas ? { q: was.q, r: was.r } : null) || this._campSite(settlement, camp ? this._campTentCount(settlement) : 4);
        if (camp) camp.site = { q: hub.q, r: hub.r };
        if (!hub) { if (struck) this._regrassCamp(struck); return null; }
        const laid = camp ? this._layArrivalCamp(settlement, camp, hub, want) : this._layCampScar(settlement, cleared, hub, want, day, fade);
        if (struck) this._regrassCamp(struck);
        // (where its tents stood, for the trodden ground they leave when it is struck)
        if (camp && laid) camp.tentAt = laid.tents.map(t => [t.q - hub.q, t.r - hub.r]);
        this._refreshGrassLayer(this.tiles);
        this._campView = camp ? laid : null;
        return laid;
    },

    /** Take down everything the camp put up; the trodden cells (that had grass) are returned, for the grass to grow back. */
    _strikeArrivalCamp() {
        const tiles = this.tiles;
        const H = tiles.length, W = H ? tiles[0].length : 0;
        const soil = [];
        let any = false;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                if (t._arrivalCamp) { delete t._arrivalCamp; any = true; }
                if (t._campSoil) {
                    if (t._campSoil.g) soil.push(t);
                    delete t._townSoil;
                    delete t._campSoil;
                    any = true;
                }
                const o = t.customObject;
                if (!o || !o.arrivalCamp) continue;
                any = true;
                const def = CustomObjects.getDef(o.defId);
                t.customObject = null;
                if (!_wet(t)) t.subTerrain.passable = true;
                for (const m of [...((def && def.meta) || []), ...((def && def.tiles) || [])]) {
                    const c = tiles[r + m.localRow] && tiles[r + m.localRow][q + m.localCol];
                    if (!c || !c.customObjectPart || c.customObjectPart.anchorQ !== q || c.customObjectPart.anchorR !== r) continue;
                    c.customObjectPart = null;
                    if (!_wet(c)) c.subTerrain.passable = true;
                }
            }
        }
        return any ? soil : null;
    },

    /** The grass grows back over trodden cells (that had it). */
    _regrassCamp(cells) {
        if (!cells || !cells.length) return;
        const back = new Set(cells);
        const isGrass = t => !!(t && t.terrainDetail && (t.terrainDetail.layer || 'grass') === 'grass');
        const mask = this.tiles.map(row => row.map(t => {
            const bare = !!(t && (t.isRoad || t._townSoil || (this.isBareDug && this.isBareDug(t))));
            return !bare && (isGrass(t) || back.has(t));
        }));
        this._erodeUntileableStubs(mask);
        for (let r = 0; r < this.tiles.length; r++) for (let q = 0; q < this.tiles[r].length; q++) {
            const t = this.tiles[r][q];
            if (!mask[r][q] && isGrass(t)) t.terrainDetail = null;
        }
        this._stampNineTileMask(this.tiles, mask, this._getGrassNineTileBrush(), 'grass');
    },

    /**
     * Where the camp goes: open ground beyond the built town and its walls, best
     * east or west of it (the new streets go north and south), near a road in, near
     * water if any. Hash-tied, so the same town camps in the same place. → { q, r } or null.
     */
    _campSite(settlement, tents) {
        const A = this.townArea();
        const tiles = this.tiles;
        if (!A || !tiles) return null;
        const H = tiles.length, W = tiles[0].length;
        const box = tiles._townWalls && tiles._townWalls.box;
        const key = settlement.foundingName || settlement.name || `${settlement.q},${settlement.r}`;
        const hw = 14, hh = tents > 10 ? 13 : 8;
        const hard = t => !t || t.isRoad || t.customBuilding || t.customBuildingPart || t._lot || t._townWall || t._plaza || _wet(t)
            || t._fieldSoil || t._townSoil || (t.customObject && !this._floraAnchor(t)) || (t.customObjectPart && !this._floraAnchor(t));
        let best = null, bs = Infinity;
        for (let r = hh + 3; r < H - hh - 3; r += 3) {
            for (let q = hw + 3; q < W - hw - 3; q += 3) {
                const dx = q - A.center.q, dy = r - A.center.r;
                const d = Math.hypot(dx, dy);
                if (d < A.R * 0.95 + hw * 0.5 || d > A.R + 40) continue;
                if (box && q + hw >= box.q0 - 2 && q - hw <= box.q1 + 2 && r + hh >= box.r0 - 2 && r - hh <= box.r1 + 3) continue;
                let bad = 0, road = 0;
                for (let rr = r - hh; rr <= r + hh; rr += 2) {
                    for (let qq = q - hw; qq <= q + hw; qq += 2) {
                        const t = tiles[rr][qq];
                        if (t && t.isRoad) road++;
                        if (hard(t)) bad++;
                    }
                }
                const cells = (hh + 1) * (hw + 1);
                if (bad > cells * 0.12) continue;
                let water = false;
                for (let a = 0; a < 16 && !water; a++) {
                    const ang = a * Math.PI / 8;
                    for (const rad of [hw + 3, hw + 9]) {
                        const t = tiles[Math.round(r + Math.sin(ang) * rad * 0.7)] && tiles[Math.round(r + Math.sin(ang) * rad * 0.7)][Math.round(q + Math.cos(ang) * rad)];
                        if (_wet(t)) { water = true; break; }
                    }
                }
                let nearRoad = false;
                for (let k = hh + 1; k <= hh + 6 && !nearRoad; k++) {
                    for (const [qq, rr] of [[q, r - k], [q, r + k], [q - k - 6, r], [q + k + 6, r]]) {
                        const t = tiles[rr] && tiles[rr][qq];
                        if (t && t.isRoad) { nearRoad = true; break; }
                    }
                }
                const sc = bad * 2 + road * 3 + Math.abs(d - (A.R + hw + 4)) * 0.4 + (Math.abs(dy) > Math.abs(dx) ? 30 : 0)
                    - (water ? 10 : 0) - (nearRoad ? 8 : 0) + _h(key, 'campSite', q, r) * 2;
                if (sc < bs) { bs = sc; best = { q, r }; }
            }
        }
        return best;
    },

    /** Put a camp prop down, tagged as the camp's. */
    _campPut(id, q, r, campId, out = null) {
        const def = CustomObjects.getDef(id);
        if (!def || !TownProps.place(this.tiles, def, q, r)) return false;
        this.tiles[r][q].customObject.arrivalCamp = campId;
        if (out) out.push({ q, r, id });
        return true;
    },

    /**
     * The camp's ground trodden bare: the open band between the rows of tents where the
     * fires burn, a patch before each tent's door, and a path worn to the nearest road —
     * ragged at the edges, in patches as it grows back (`keep` of it left).
     */
    _treadCamp(hub, rx, ry, campId, keep = 1, tents = []) {
        const tiles = this.tiles;
        const H = tiles.length, W = tiles[0].length;
        const tread = (q, r, strong = false) => {
            const t = tiles[r] && tiles[r][q];
            if (!t || t.isRoad || _wet(t) || t.customBuilding || t.customBuildingPart || t._lot || t._campSoil || t._townSoil || t._fieldSoil || q < 1 || r < 1 || q >= W - 1 || r >= H - 1) return;
            if (!strong && _h(campId, 'fade', q, r) > keep) return;
            const g = !!(t.terrainDetail && (t.terrainDetail.layer || 'grass') === 'grass');
            t._campSoil = { id: campId, g };
            t._townSoil = true;
        };
        // The band where the fires burn: bare in the middle, in patches at its ends and edges
        for (let r = hub.r - 1; r <= hub.r + 4; r++) {
            for (let q = hub.q - rx; q <= hub.q + rx; q++) {
                const edge = Math.abs(q - hub.q) / rx;
                const inner = r >= hub.r && r <= hub.r + 3;
                if ((inner && edge < 0.65) || _h(campId, 'band', q, r) < (inner ? 0.7 : 0.3) * (1.15 - edge)) tread(q, r);
            }
        }
        // Before each tent's door, and round it in patches
        for (const t of tents) {
            for (let r = t.r - 4; r <= t.r + 2; r++) {
                for (let q = t.q - 1; q <= t.q + 4; q++) {
                    const front = r === t.r + 1 && q >= t.q && q <= t.q + 3;
                    if (front || _h(campId, 'tent', q, r) < 0.15) tread(q, r);
                }
            }
        }
        void ry;
        // A path worn to the nearest road
        let to = null, bd = Infinity;
        for (let r = Math.max(1, hub.r - 30); r <= Math.min(H - 2, hub.r + 30); r += 1) {
            for (let q = Math.max(1, hub.q - 40); q <= Math.min(W - 2, hub.q + 40); q += 1) {
                if (!tiles[r][q].isRoad) continue;
                const d = Math.abs(q - hub.q) + Math.abs(r - hub.r);
                if (d < bd) { bd = d; to = { q, r }; }
            }
        }
        if (to) {
            let q = hub.q, r = hub.r + 2;
            for (let n = 0; n < 90 && !(q === to.q && r === to.r); n++) {
                tread(q, r);
                tread(q + 1, r);
                if (Math.abs(to.q - q) > Math.abs(to.r - r)) q += Math.sign(to.q - q); else r += Math.sign(to.r - r);
                if (tiles[r] && tiles[r][q] && tiles[r][q].isRoad) break;
            }
        }
    },

    /** Pitch the camp about `hub`: tents, fires, stores, lines, wagons' places, beasts' places. → its record. */
    _layArrivalCamp(settlement, camp, hub, sig) {
        const C = TownGrowth.config();
        const tents = this._campTentCount(settlement);
        const rows = Math.ceil(tents / COLS.length);
        const hh = rows > 2 ? 13 : 8;
        // The ground cleared of brush and saplings, trodden bare
        if (this._clearFlora) this._clearFlora(hub.q - 15, hub.q + 15, hub.r - hh - 4, hub.r + hh + 1);
        const placed = [];
        const ids = Array.isArray(C.tents) && C.tents.length ? C.tents : ['tp_tent_canvas'];
        const rec = { id: camp.id, sig, hub: { q: hub.q, r: hub.r }, tents: [], fires: [], lines: [], wagons: [], spots: [] };
        // The tents, row by row from the middle out
        const slots = [];
        for (let ri = 0; ri < ROWS.length; ri++) for (const dq of COLS) slots.push([dq, ROWS[ri]]);
        for (const [dq, dr] of slots) {
            if (rec.tents.length >= tents) break;
            const id = ids[Math.floor(_h(camp.id, 'tent', dq, dr) * ids.length)];
            const jq = Math.round((_h(camp.id, 'jq', dq, dr) - 0.5) * 2);
            for (const [oq, or] of [[jq, 0], [0, 0], [1, 0], [-1, 0], [0, -1], [0, 1]]) {
                if (this._campPut(id, hub.q + dq + oq, hub.r + dr + or, camp.id, placed)) {
                    rec.tents.push({ q: hub.q + dq + oq, r: hub.r + dr + or });
                    break;
                }
            }
        }
        // Fires on the open band between the first two rows, one to every firePer tents
        const fires = Math.max(1, Math.round(rec.tents.length / Math.max(1, _num(C.firePer, 5))));
        const fireQ = [1, -7, 9, -13];
        for (let i = 0; i < fires && i < fireQ.length; i++) {
            for (const [oq, or] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (this._campPut('tp_campfire', hub.q + fireQ[i] + oq, hub.r + 2 + or, camp.id, placed)) { rec.fires.push({ q: hub.q + fireQ[i] + oq, r: hub.r + 2 + or }); break; }
            }
        }
        // What they brought: firewood by the fires, sacks and crates by the tents, a water barrel
        const gear = [['tp_firewood', 3, 1], ['tp_sacks', -4, 3], ['tp_crate', 6, 3], ['tp_barrel', -9, 3], ['tp_water_barrel', 12, 1], ['tp_logs', -14, 1], ['tp_crate_small', 7, 3], ['tp_sack', -3, 3]];
        const nGear = Math.min(gear.length, 2 + Math.ceil(rec.tents.length / 2));
        for (const [id, dq, dr] of gear.slice(0, nGear)) {
            for (const [oq, or] of [[0, 0], [1, 0], [-1, 0], [0, 1]]) if (this._campPut(id, hub.q + dq + oq, hub.r + dr + or, camp.id, placed)) break;
        }
        // Washing lines strung across the band (drawn by ui/innerMapLayers/entities.js): two posts and the line
        const nLines = Math.min(_num(C.maxLines, 4), Math.max(1, Math.round(rec.tents.length / Math.max(1, _num(C.linePer, 3)))));
        const lineQ = [-5, 5, -12, 12];
        const open = (q, r) => { const t = this.tiles[r] && this.tiles[r][q]; return !!(t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart && !t.isRoad && !_wet(t)); };
        for (let i = 0; i < nLines && i < lineQ.length; i++) {
            const q0 = hub.q + lineQ[i] - 1, q1 = q0 + 3, r = hub.r + (i % 2 ? 3 : 1);
            if (open(q0, r) && open(q1, r)) rec.lines.push({ q0, q1, r, seed: Math.floor(_h(camp.id, 'line', i) * 1e6) });
        }
        // Where the wagons stand (ui/innerMapCarts.js parks them) and the beasts graze: the band's ends
        const nWagons = Math.min(_num(C.maxWagons, 3), Math.max(1, Math.round(rec.tents.length / Math.max(1, _num(C.wagonPer, 4)))));
        for (const [dq, f] of [[16, 1], [-17, 3], [17, 1]].slice(0, nWagons)) rec.wagons.push({ q: hub.q + dq, r: hub.r + 2 + (rec.wagons.length === 2 ? 3 : 0), facing: f });
        // Spots to be about the camp: round each fire, by the lines, at the tents' doors
        for (const f of rec.fires) for (const [dq, dr, face] of [[0, 1, 0], [-1, 0, 3], [1, 0, 1], [0, -1, 2]]) if (open(f.q + dq, f.r + dr)) rec.spots.push({ q: f.q + dq, r: f.r + dr, face, kind: 'fire' });
        for (const l of rec.lines) if (open(l.q0 + 1, l.r + 1)) rec.spots.push({ q: l.q0 + 1, r: l.r + 1, face: 0, kind: 'line' });
        for (const t of rec.tents) if (open(t.q + 1, t.r + 1)) rec.spots.push({ q: t.q + 1, r: t.r + 1, face: 2, kind: 'tent' });
        rec.placed = placed.length;
        // The ground trodden bare about it all, a path worn to the road
        this._treadCamp(hub, 15, hh + 1, camp.id, 1, rec.tents);
        this.tiles[hub.r][hub.q]._arrivalCamp = rec;
        // (in sight: you can see the camp from the road)
        if (this._revealAround) this._revealAround(this.tiles, hub.q, hub.r, 16);
        return rec;
    },

    /** The camp struck: a cold fire ring, and the trodden ground growing back in patches. */
    _layCampScar(settlement, cleared, hub, sig, day, fade) {
        const keep = Math.max(0, 1 - (day - _num(cleared.d)) / fade);
        this._treadCamp(hub, 14, 8, cleared.id, keep, (cleared.tents || []).map(t => ({ q: hub.q + t[0], r: hub.r + t[1] })));
        this._campPut('tp_campfire_out', hub.q + 1, hub.r + 2, cleared.id);
        const rec = { id: cleared.id, sig, hub: { q: hub.q, r: hub.r }, tents: [], fires: [], lines: [], wagons: [], spots: [], struck: true };
        this.tiles[hub.r][hub.q]._arrivalCamp = rec;
        return rec;
    },

    // ──────────── ITS PEOPLE ────────────

    /**
     * After the homes are handed out (townLife._assignHomesAndWork): the camp's
     * households sleep in its tents (a family to a tent, in the order they came),
     * and those whose house on its lot is done live in it.
     */
    _campHomes() {
        const ref = this._currentWorldTileRef;
        const s = ref && ref.settlement;
        if (!s || !s.growth) return;
        const view = this._campView;
        const camp = TownGrowth.camp(s);
        const order = new Map();
        if (camp) (camp.hh || []).filter(h => !h.housed).forEach((h, i) => { for (const id of h.ids) order.set(id, i); });
        const byLot = new Map();
        for (const b of this.buildings || []) if (b && b._lotId && b.type === 'house') byLot.set(b._lotId, b);
        for (const npc of this.npcs || []) {
            const p = npc._person;
            npc._campDweller = false;
            if (!p) continue;
            if (p.camp && view && view.tents.length && order.has(p.id)) {
                const t = view.tents[order.get(p.id) % view.tents.length];
                npc._home = { type: 'tent', q: t.q, r: t.r, name: 'Tent', icon: '⛺', _tent: true };
                npc._campDweller = true;
            } else if (p.lotHome && byLot.has(p.lotHome)) {
                npc._home = byLot.get(p.lotHome);
            }
        }
    },

    /**
     * Part of a camper's day is spent about the camp: by a fire, at the washing line,
     * at the tent's door. True when they go there (townLife._townPickActivity).
     */
    _campPick(npc, period) {
        if (npc.activity && npc.activity._camp) npc.activity = null;
        if (!npc._campDweller || period === 'night') return false;
        const view = this._campView;
        if (!view || !view.spots.length || Utils.random() > 0.45) return false;
        const spot = view.spots[Math.floor(Utils.random() * view.spots.length)];
        if (!spot) return false;
        npc._campSpot = spot;
        return this._goStand(npc, { q: spot.q, r: spot.r }, 'camp', spot.face);
    },

    /** At the camp spot: sat by the fire, hanging out the washing, at the tent's door. */
    _campArrived(npc) {
        const s = npc._campSpot;
        npc._campSpot = null;
        const kind = s ? s.kind : 'tent';
        npc.activity = kind === 'fire' ? { type: 'camp', icon: '🔥', label: 'By the camp fire', anim: 'sitting', _camp: true }
            : kind === 'line' ? { type: 'camp', icon: '🧺', label: 'Hanging out the washing', anim: 'thrust', _camp: true }
                : { type: 'camp', icon: '⛺', label: 'At the tent', anim: 'idle', _camp: true };
        npc.idleTimer = 15 + Utils.random() * 25;
    },

    /** The households' beasts about the camp (after the hex's own animals: enter). */
    _campAnimals() {
        const view = this._campView;
        const ref = this._currentWorldTileRef;
        const camp = ref && ref.settlement ? TownGrowth.camp(ref.settlement) : null;
        if (!view || !camp || !this._makeAnimal || !Array.isArray(this.animals)) return 0;
        const C = TownGrowth.config();
        const kinds = (Array.isArray(C.beasts) ? C.beasts : []).filter(k => this.animalSpecies && this.animalSpecies(k));
        const n = Math.min(_num(C.maxBeasts, 6), kinds.length, 1 + Math.floor(view.tents.length / 2));
        const cfg = this.animalConfig();
        const owner = { name: `the newcomers from ${camp.from || 'afar'}` };
        let added = 0;
        for (let i = 0; i < n; i++) {
            const base = view.wagons[i % Math.max(1, view.wagons.length)] || view.hub;
            for (let k = 0; k < 12; k++) {
                const q = base.q + Math.round((_h(camp.id, 'bq', i, k) - 0.5) * 6), r = base.r + 2 + Math.round((_h(camp.id, 'br', i, k) - 0.5) * 4);
                const t = this.tiles[r] && this.tiles[r][q];
                if (!t || !t.subTerrain || !t.subTerrain.passable || t.customObject || t.customObjectPart || t.isRoad || _wet(t)) continue;
                const a = this._makeAnimal({ id: `camp:${camp.id}:${i}`, species: kinds[i], herd: `camp:${camp.id}`, q, r, livestock: true, owner }, cfg);
                this.animals.push(a);
                added++;
                break;
            }
        }
        return added;
    },
});
