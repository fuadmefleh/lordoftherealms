// ============================================
// INNER MAP TOWN WORLD — the realm's great affairs in the town's streets
// ============================================
// What systems/townWorld.js finds for the town the player stands in, walked
// and drawn on its street map:
//
//   WAR          soldiers in the realm's livery (the battlefield's looks,
//                ui/innerMapEscort.js layersFor) billeted at the inns and
//                houses, drilling in ranks on the square at the drill hours
//                (on guard, a thrust together on the sergeant's call,
//                recover, a pace forward and back: TownWorld.drillBeat),
//                indoors at night; a host gathering here pitches its tents,
//                fires and stores outside the walls (real props, as the
//                plague's herb fires are) with its men about them, and its
//                supply train of wagons rolls in from the road on a schedule
//                (ui/innerMapCarts.js startConvoy), unloads while two of the
//                men carry its sacks to the stores, and drives off; a war of
//                crowns fought in KingdomAI's battles (no host on the map)
//                shows by its front (world/kingdomAI.js noteFront); a besieged
//                town sees the siege lines' fires ringing it beyond the walls
//                and keeps indoors; the wounded sit by the temple door.
//   THE CROSS    crusaders in mail and red tabards with the white cross
//                (drawn over them: drawOverlay) walk in at one gate, stop in
//                the square and go out at another on the way to the muster (or
//                camp, at the muster itself); a preacher with his cross-staff
//                calls for the cross in the square while a call is open (Take
//                the Cross opens the Church panel); an inquisitor and two
//                clerks stand in the square through a hearing.
//   WHO RULES    the realm's banner on poles at each road in and at the seat,
//                a union's junior realm flying both crowns'; a town lately
//                conquered has the new crown's garrison at the gates and seat,
//                and its people grumble of the old crown within earshot.
//   HARD TIMES   famine: stalls left bare under a cloth and their keepers at
//                home, a thinner crowd, beggars at the church and the market;
//                in every era (stalls or none) a bread line at the barred
//                bakery's door (else the granary's, the market's, the square's),
//                the granary barred with a guard at its door, empty baskets and
//                crates tipped about the square;
//                a realm under the ban: the temple's doors boarded shut.
//   NEWS         the proclamations come to the town (systems/heralds.js) are
//                what the town crier cries (world/innerMap/townScenes.js reads
//                InnerMap._townCry), a handbell in his hand; ask him for the
//                news and he repeats it.
//   COME TO YOU  now and then (one a day at most, a hash roll) a messenger
//                with a letter come lately, a petitioner when petitions wait
//                and you hold the town, or a beggar in hard times walks up to
//                you and speaks; their row opens the letters, the court, or
//                gives a coin.
//
// The figures are townsfolk-shaped NPCs (npc._tw) pushed into InnerMap.npcs,
// so the depth-sorted entity pass draws them, labels them and lets you talk to
// them; world/innerMap/townWorld.js keeps townLife's hands off them. Counts
// are capped (systems/townWorld.js, data/townWorld.json); nothing is saved —
// the next visit derives it all again. Picks are hashes, never the shared RNG.
//
// Their sounds (the drill, the preacher, the camp, the crier's handbell): ui/townWorldSound.js.

import { InnerMap } from '../world/innerMap.js';
import { CustomObjects } from '../world/customObjects.js';
import { TownProps } from '../world/townProps.js';
import { TownWorld, townHash } from '../systems/townWorld.js';
import { CourtLetters } from '../systems/courtLetters.js';
import { Petitions } from '../systems/petitions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapEscort } from './innerMapEscort.js';
import { InnerMapBattle } from './innerMapBattle.js';
import { InnerMapTournament } from './innerMapTournament.js';
import { InnerMapPlague } from './innerMapPlague.js';
import { PlagueArt } from './plagueArt.js';
import { ActionMenu } from './actionMenu.js';
import { esc, lede, rowList } from './actionMenu/uiKit.js';
import { Economy } from '../world/economy.js';
import { TownWorldSound } from './townWorldSound.js';
import { InnerMapCarts } from './innerMapCarts.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const TAG = '_tw';
const ID_BASE = 7000;
const SEAT_TYPES = ['castle', 'castle_keep', 'keep', 'palace', 'manor', 'town_hall', 'barracks'];
const INN_TYPES = ['inn', 'tavern', 'hotel', 'guest_house', 'roadhouse'];
const CHURCH_TYPES = ['church', 'temple', 'chapel'];
const STALL_IDS = ['tp_stall', 'tp_tent_market', 'tp_tent_market_crates', 'tp_tent_market_bunting'];
const GRANARY_TYPES = ['granary', 'mill', 'warehouse'];
const _beat = { beat: 'ready', frame: -1, cycle: 0, u: 0, late: false };   // (TownWorld.drillBeat writes into it each frame)
const MALE = 'Clothing/Masculine, Thin';

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _hash32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/** Gold or white on the field, whichever stands out. */
function _chargeFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '#e8c547';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.55 ? '#2a1d12' : lum > 0.3 ? '#f2efe6' : '#e8c547';
}

const INK = '#2a1a0c', WICK = '#c99a55', WICK_HI = '#e2b872', WEAVE = '#8a5f2c', HOLLOW = '#24160a', WOOD = '#b48450', WOOD_LO = '#7d5530';

/** A wicker basket's mouth: an ellipse rimmed in wicker, nothing inside but its dark. */
function _mouth(ctx, x, y, rx, ry, s) {
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(x, y, rx + s, ry + s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = WICK_HI;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = HOLLOW;
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.3, Math.max(s, rx - s * 1.6), Math.max(s * 0.5, ry - s * 1.3), 0, 0, Math.PI * 2); ctx.fill();
}

/** An empty basket stood on the ground: its body tapering to the foot, woven in bands, the mouth on top. */
function _basket(ctx, bx, by, w, h, s) {
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.moveTo(bx - w / 2 - s, by - h); ctx.lineTo(bx + w / 2 + s, by - h); ctx.lineTo(bx + w / 2 - 2 * s, by + s); ctx.lineTo(bx - w / 2 + 2 * s, by + s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = WICK;
    ctx.beginPath(); ctx.moveTo(bx - w / 2, by - h); ctx.lineTo(bx + w / 2, by - h); ctx.lineTo(bx + w / 2 - 2.5 * s, by); ctx.lineTo(bx - w / 2 + 2.5 * s, by); ctx.closePath(); ctx.fill();
    ctx.fillStyle = WEAVE;
    for (let yy = by - h + 3 * s; yy < by - s; yy += 3 * s) ctx.fillRect(bx - w / 2 + 2 * s, yy, w - 4 * s, s);
    _mouth(ctx, bx, by - h, w / 2, 2.6 * s, s);
}

/**
 * Empty baskets and a crate on the ground, their foot at (x, y), `s` a 32nd
 * of a tile: k 0 a basket tipped on its side by an empty one, 1 two empty
 * baskets, 2 an open crate with its lid off and a basket beside it.
 */
function _drawEmpty(ctx, x, y, s, k) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y - s, 15 * s, 3.5 * s, 0, 0, Math.PI * 2); ctx.fill();
    if (k === 2) {
        // the crate: its front planks, the open top showing its empty dark, the lid leant on it
        const cx = x - 4 * s, w = 16 * s, h = 11 * s, d = 4 * s;
        ctx.fillStyle = INK;
        ctx.fillRect(cx - w / 2 - s, y - h - d - s, w + 2 * s, h + d + 2 * s);
        ctx.fillStyle = WOOD_LO;
        ctx.fillRect(cx - w / 2, y - h - d, w, d);
        ctx.fillStyle = HOLLOW;
        ctx.fillRect(cx - w / 2 + 1.5 * s, y - h - d + s, w - 3 * s, d - s);
        ctx.fillStyle = WOOD;
        ctx.fillRect(cx - w / 2, y - h, w, h);
        ctx.fillStyle = WOOD_LO;
        for (let i = 1; i < 3; i++) ctx.fillRect(cx - w / 2, y - h + i * (h / 3), w, s);
        ctx.fillRect(cx - w / 2 + s, y - h, 1.5 * s, h);
        ctx.fillRect(cx + w / 2 - 2.5 * s, y - h, 1.5 * s, h);
        // (the lid, leant against its side)
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.moveTo(cx - w / 2 - s, y - h - 2 * s); ctx.lineTo(cx - w / 2 - 8 * s, y + s); ctx.lineTo(cx - w / 2 - 3 * s, y + s); ctx.lineTo(cx - w / 2 + s, y - h + s); ctx.closePath(); ctx.fill();
        ctx.fillStyle = WOOD;
        ctx.beginPath(); ctx.moveTo(cx - w / 2 - 1.5 * s, y - h - 0.5 * s); ctx.lineTo(cx - w / 2 - 7 * s, y); ctx.lineTo(cx - w / 2 - 4 * s, y); ctx.lineTo(cx - w / 2, y - h + 0.5 * s); ctx.closePath(); ctx.fill();
        _basket(ctx, x + 9 * s, y, 9 * s, 7 * s, s);
        return;
    }
    if (k === 1) {
        _basket(ctx, x - 5 * s, y, 13 * s, 10 * s, s);
        _basket(ctx, x + 7 * s, y + s, 10 * s, 8 * s, s);
        return;
    }
    // tipped on its side, its mouth turned to us, a few straws spilled; an empty one stood by it
    _basket(ctx, x + 8 * s, y - s, 10 * s, 8 * s, s);
    const bx = x - 5 * s, by = y - 6 * s;
    ctx.fillStyle = INK;
    ctx.fillRect(bx - 9 * s, by - 6 * s, 10 * s, 12 * s);
    ctx.fillStyle = WICK;
    ctx.fillRect(bx - 8 * s, by - 5 * s, 9 * s, 10 * s);
    ctx.fillStyle = WEAVE;
    for (let xx = bx - 6 * s; xx < bx; xx += 3 * s) ctx.fillRect(xx, by - 5 * s, s, 10 * s);
    _mouth(ctx, bx + 2 * s, by, 3.4 * s, 6 * s, s);
    ctx.fillStyle = '#e3c66a';
    ctx.fillRect(bx + 5 * s, by + 5 * s, 4 * s, s);
    ctx.fillRect(bx + 7 * s, by + 3.5 * s, 3 * s, s);
}

export const InnerMapTownWorld = {
    _outer: null,
    _tick: 0,
    _clock: 0,
    _view: null,
    _sig: null,
    _viewAt: -1e9,
    _day: -1,
    _townKey: null,
    _figs: [],              // the npcs brought into town (npc._tw = { kind, key, i, ... })
    _respawn: new Map(),    // key → clock seconds before which a figure that left does not come back
    _props: [],             // [{ q, r, tag, cells: [[q, r, passableBefore]] }]
    _banners: [],           // [{ q, r, color, charge, i, tall }]
    _shutDoors: [],         // buildings boarded shut
    _famineStalls: [],      // [{ q, r }]
    _camp: null,            // { q, r } the muster camp's heart
    _presets: new Map(),    // layers signature → preset id
    _grumbleAt: 0,
    _voiceAt: 0,
    _grumbled: 0,
    _onStreet: 0,
    _approachDay: -1,
    _drillSlots: [],
    _sergeant: null,        // { q, r, facing } where the drill's sergeant stands
    _drillStep: false,      // every rank has room to step forward a pace
    _drillCall: '',         // the beat last called, and in which cycle
    _drillCycle: -1,
    _queue: [],             // the bread line's spots: [{ q, r, facing }], the head first
    _granaries: [],         // granaries barred in the famine: [building]
    _baskets: [],           // empty baskets and crates on the square: [{ q, r, k }]
    _train: [],             // the host's supply wagons on the map (InnerMapCarts convoys)
    _trainFrom: null,       // where the road comes onto the map, nearest the camp
    _trainSlots: [],        // where the wagons stand to unload
    _depot: null,           // the camp's stores, where the sacks are carried
    _trainNext: null,
    _trainQueue: 0,
    _trainLaunchAt: 0,
    _trainSeq: 0,
    _unloading: null,       // the wagon unloading now

    _outerTiles() {
        return InnerMap._insideBuilding && InnerMap._outerMapState ? InnerMap._outerMapState.tiles : InnerMap.tiles;
    },

    _outerNpcs() {
        return InnerMap._insideBuilding && InnerMap._outerMapState ? (InnerMap._outerMapState.npcs || []) : (InnerMap.npcs || []);
    },

    _reset() {
        this._outer = this._outerTiles();
        this._view = null;
        this._sig = null;
        this._viewAt = -1e9;
        this._day = -1;
        this._townKey = null;
        this._figs = [];
        this._respawn.clear();
        this._props = [];
        this._banners = [];
        this._shutDoors = [];
        this._famineStalls = [];
        this._camp = null;
        this._grumbled = 0;
        this._onStreet = 0;
        this._drillSlots = [];
        this._sergeant = null;
        this._drillStep = false;
        this._queue = [];
        this._granaries = [];
        this._baskets = [];
        this._train = [];
        this._trainFrom = null;
        this._trainSlots = [];
        this._depot = null;
        this._trainNext = null;
        this._trainQueue = 0;
        this._unloading = null;
        InnerMap._townWorld = null;
        InnerMap._shutDoors = null;
        InnerMap._townCry = null;
    },

    _bark(npc, text, secs = 3.6) {
        if (!npc || !text) return;
        const now = _now();
        npc._bark = { text, until: now + secs * 1000, from: now };
    },

    _hour() {
        return Number(InnerMap._sceneClock ? InnerMap._sceneClock() : InnerMap.timeOfDay) || 8;
    },

    // ──────────── EACH FRAME ────────────

    update(dt, game) {
        if (!InnerMap.active || !game || !game.world) return;
        if (this._outer !== this._outerTiles()) this._reset();
        const ref = InnerMap._currentWorldTileRef;
        const s = ref && ref.settlement;
        if (!s || !InnerMap.townArea || InnerMap._seatMap) { if (this._view) this._reset(); return; }
        this._clock += dt;
        if (!InnerMap._insideBuilding) this._onStreet += dt;
        // (the drill keeps time every frame: the thrust's frames are a fraction of a second)
        if (this._view && !InnerMap._insideBuilding) this._drillTime();
        this._tick -= dt;
        if (this._tick > 0) return;
        this._tick = 0.5;
        const world = game.world;
        const day = _num(world.day, 1);
        const townKey = `${s.q},${s.r}`;
        // (the view is read again each new day, on coming to a town, and every ten seconds)
        if (day !== this._day || townKey !== this._townKey || this._clock - this._viewAt > 10) {
            this._view = TownWorld.view(world, game.player, s, day);
            this._viewAt = this._clock;
            this._day = day;
            this._townKey = townKey;
            InnerMap._townCry = this._view ? this._view.news.map(n => n.text) : null;
        }
        const v = this._view;
        if (!v) return;
        if (InnerMap._insideBuilding) return;
        if (!InnerMap.townArea()) return;
        if (v.key !== this._sig) {
            this._sig = v.key;
            this._plan(world, s, v);
        }
        this._roster(game, s, v);
        this._trainTick(game, v);
        this._drive(game, s, v);
        this._grumble(game, v);
        this._approach(game, s, v, day);
        TownWorldSound.update(this);
    },

    // ──────────── THE PLAN (when what shows changes) ────────────

    _plan(world, s, v) {
        const tiles = this._outer;
        const A = InnerMap.townArea();
        // Who stays in, which stalls stand bare, which doors are shut (world/innerMap/townWorld.js)
        this._famineStalls = [];
        if (v.famine) {
            // (the square's stalls and the market's tents)
            for (const row of tiles) {
                for (const t of row) {
                    const id = t && t.customObject && !t._isInterior ? t.customObject.defId : null;
                    if (!id || !STALL_IDS.includes(id)) continue;
                    if (townHash('famstall', this._townKey, t.q, t.r) < v.famineStalls) this._famineStalls.push({ q: t.q, r: t.r, defId: id });
                }
            }
        }
        const blds = InnerMap._townBuildings ? InnerMap._townBuildings() : (InnerMap.buildings || []);
        // (a temple under the ban, crossed with planks; in a famine the bakery, no bread to sell, barred,
        // and the granary barred, a guard at its door)
        this._shutDoors = v.banned ? blds.filter(b => b && CHURCH_TYPES.includes(b.type)) : [];
        for (const b of v.famine ? blds.filter(x => x && x.type === 'bakery') : []) { this._shutDoors.push(b); }
        this._granaries = v.famine ? blds.filter(x => x && GRANARY_TYPES.includes(String(x.type).replace(/^player_/, ''))).slice(0, 2) : [];
        for (const b of this._granaries) this._shutDoors.push(b);
        InnerMap._shutDoors = this._shutDoors.length ? new Set(this._shutDoors.map(b => `${b.q},${b.r}`)) : null;
        InnerMap._townWorld = { stay: v.stay, famineStalls: this._famineStalls.length ? new Set(this._famineStalls.map(x => `${x.q},${x.r}`)) : null };
        // The camp (a host gathering here, or the siege lines' fires) outside the walls
        this._clearProps();
        this._camp = null;
        this._trainFrom = null;
        this._trainSlots = [];
        this._depot = null;
        if (v.muster) this._pitchCamp(tiles, A, v);
        if (v.siege) this._siegeFires(tiles, A, v);
        // The banners at the roads in and at the seat
        this._banners = this._plantBanners(tiles, A, blds, v);
        this._drillSlots = this._drillGrid(A, 12);
        // (the camp, the ranks and the line may stand elsewhere now: each figure finds its place again)
        for (const n of this._figs) if (n._tw) { n._tw.home = null; n._tw.haulCart = null; }
        // The famine's signs in every era: the bread line, the square's empty baskets
        this._queue = v.famine && v.breadLine ? this._breadLine(A, blds, v.breadLine) : [];
        this._baskets = v.famine && v.baskets ? this._basketSpots(A, blds, v.baskets) : [];
        this._grumbled = 0;
    },

    /** The door the hungry queue at: the bakery's, else the granary's, the market's; else the square's heart. */
    _breadLine(A, blds, n) {
        const pick = blds.find(b => b && b.type === 'bakery') || this._granaries[0] || blds.find(b => b && b.type === 'marketplace') || null;
        const door = pick && InnerMap._findPassableAdjacentTile ? InnerMap._findPassableAdjacentTile(pick.q, pick.r) : null;
        // (away from the door, the way it opens; round anything in the way)
        let dq = 0, dr = 1;
        if (door && pick) {
            const ddq = door.q - pick.q, ddr = door.r - pick.r;
            if (Math.abs(ddq) > Math.abs(ddr)) { dq = Math.sign(ddq); dr = 0; } else { dq = 0; dr = Math.sign(ddr) || 1; }
        }
        const start = door || this._near(A.center.q, A.center.r, 3);
        if (!start) return [];
        const out = [];
        const taken = new Set([`${start.q},${start.r}`]);
        // (no one queues in another building's doorway)
        for (const b of blds) { const d = b && InnerMap._findPassableAdjacentTile ? InnerMap._findPassableAdjacentTile(b.q, b.r) : null; if (d) taken.add(`${d.q},${d.r}`); }
        let cur = start;
        // (at a door barred in the famine the head of the line stands on its step, facing it)
        if (door && pick.type !== 'marketplace' && n > 0) out.push({ q: door.q, r: door.r, facing: InnerMapCharacters.getDirection(-dq, -dr) });
        for (let i = out.length; i < n; i++) {
            let next = null;
            for (const [sq, sr] of [[dq, dr], [dr, dq], [-dr, -dq]]) {
                const q = cur.q + sq, r = cur.r + sr;
                if (this._standable(q, r) && !taken.has(`${q},${r}`)) { next = { q, r }; break; }
            }
            if (!next) break;
            taken.add(`${next.q},${next.r}`);
            // (each faces the one before, the head the door)
            next.facing = InnerMapCharacters.getDirection(cur.q - next.q, cur.r - next.r);
            out.push(next);
            cur = next;
        }
        return out;
    },

    /** Empty baskets and crates about the square (drawn only), two apart, out of the doorways and the ranks. */
    _basketSpots(A, blds, n) {
        const sq = A.square && A.square.length ? A.square : (A.streets || []).filter(x => _dist(x, A.center) <= 5);
        const taken = new Set();
        for (const b of blds) { const d = b && InnerMap._findPassableAdjacentTile ? InnerMap._findPassableAdjacentTile(b.q, b.r) : null; if (d) taken.add(`${d.q},${d.r}`); }
        for (const x of this._queue) taken.add(`${x.q},${x.r}`);
        for (const x of this._drillSlots) { taken.add(`${x.q},${x.r}`); taken.add(`${x.q},${x.r + 1}`); }
        if (this._sergeant) taken.add(`${this._sergeant.q},${this._sergeant.r}`);
        const cells = sq.filter(x => this._standable(x.q, x.r) && !taken.has(`${x.q},${x.r}`))
            .sort((a, b) => townHash('basket', this._townKey, a.q, a.r) - townHash('basket', this._townKey, b.q, b.r));
        const out = [];
        for (const c of cells) {
            if (out.length >= n) break;
            if (out.some(o => _dist(o, c) < 2)) continue;
            out.push({ q: c.q, r: c.r, k: Math.floor(townHash('bk', this._townKey, c.q, c.r) * 3) });
        }
        return out;
    },

    _isFree(q, r) {
        const t = this._outer && this._outer[r] && this._outer[r][q];
        return !!(t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.customObjectPart && !t.building && !t.customBuilding && !t.customBuildingPart && !t.isWater && !t._lot);
    },

    _standable(q, r) {
        const t = this._outer && this._outer[r] && this._outer[r][q];
        return !!(t && t.subTerrain && t.subTerrain.passable && !t.customObject && !t.isWater && !t.building && !t.customBuilding);
    },

    /** The nearest standable cell to (q, r) within `ring` (not one in `taken`). */
    _near(q, r, ring = 3, taken = null) {
        for (let rad = 0; rad <= ring; rad++) {
            for (let dr = -rad; dr <= rad; dr++) {
                for (let dq = -rad; dq <= rad; dq++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const qq = q + dq, rr = r + dr;
                    if (!this._standable(qq, rr) || (taken && taken.has(`${qq},${rr}`))) continue;
                    return { q: qq, r: rr };
                }
            }
        }
        return null;
    },

    /** Outward from the town's centre through a gate: where the walls end and the fields begin. */
    _outside(A, g, extra) {
        const W = (this._outer[0] || []).length, H = this._outer.length;
        const box = this._outer._townWalls && this._outer._townWalls.box;
        let dx = g.q - A.center.q, dy = g.r - A.center.r;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        // Past the wall's line (or the town's reach) by `extra`
        let d = A.R + extra;
        if (box) {
            const tx = dx > 0 ? (box.q1 - A.center.q) / dx : dx < 0 ? (box.q0 - A.center.q) / dx : Infinity;
            const ty = dy > 0 ? (box.r1 - A.center.r) / dy : dy < 0 ? (box.r0 - A.center.r) / dy : Infinity;
            d = Math.max(d, Math.min(tx, ty) + extra);
        }
        const q = Math.round(Math.max(5, Math.min(W - 6, A.center.q + dx * d)));
        const r = Math.round(Math.max(5, Math.min(H - 6, A.center.r + dy * d)));
        return { q, r, dx, dy };
    },

    _putProp(id, q, r, tag) {
        const def = CustomObjects.getDef ? CustomObjects.getDef(id) : null;
        const tiles = this._outer;
        if (!def || !tiles) return false;
        const anchor = tiles[r] && tiles[r][q];
        if (!anchor || anchor.isWater || !(anchor.subTerrain && anchor.subTerrain.passable)) return false;
        // (what each of its cells was before, to give it back when the camp is struck)
        const before = [];
        const B = def.bounds || { minCol: 0, maxCol: 0, minRow: 0 };
        for (let rr = r + (B.minRow || 0); rr <= r; rr++) {
            for (let qq = q + (B.minCol || 0); qq <= q + (B.maxCol || 0); qq++) {
                const t = tiles[rr] && tiles[rr][qq];
                if (!t || t.isRoad || t._townSoil || t._plaza || t._lot) return false;
                if (t.subTerrain && !t.subTerrain.passable) return false;
                before.push([qq, rr, !!(t.subTerrain && t.subTerrain.passable)]);
            }
        }
        if (!TownProps.place(tiles, def, q, r)) return false;
        tiles[r][q].customObject[TAG] = tag;
        this._props.push({ q, r, tag, cells: before });
        return true;
    },

    _clearProps() {
        const tiles = this._outer;
        if (!tiles) return;
        // (also any left on this map from an earlier visit's plan)
        for (const row of tiles) {
            for (const t of row) {
                if (!t || !t.customObject || !t.customObject[TAG]) continue;
                if (!this._props.some(p => p.q === t.q && p.r === t.r)) this._props.push({ q: t.q, r: t.r, tag: t.customObject[TAG], cells: [] });
            }
        }
        for (const p of this._props) {
            const a = tiles[p.r] && tiles[p.r][p.q];
            if (a && a.customObject && a.customObject[TAG]) a.customObject = null;
            for (const [q, r, pass] of p.cells) {
                const t = tiles[r] && tiles[r][q];
                if (!t) continue;
                if (t.customObjectPart && t.customObjectPart.anchorQ === p.q && t.customObjectPart.anchorR === p.r) t.customObjectPart = null;
                if (pass && t.subTerrain) t.subTerrain.passable = true;
            }
        }
        this._props = [];
    },

    /** Open ground outside the town (beyond its walls or its reach): [{ q, r, free, d, a }], the best first. */
    _openGround(A, wq, wr, minFree) {
        const tiles = this._outer;
        const W = (tiles[0] || []).length, H = tiles.length;
        const box = tiles._townWalls && tiles._townWalls.box;
        const out = [];
        for (let r = 6; r < H - 6; r += 3) {
            for (let q = 6; q < W - 6; q += 3) {
                const d = Math.hypot(q - A.center.q, r - A.center.r);
                if (d < A.R * 0.95) continue;
                if (box && q >= box.q0 - 3 && q <= box.q1 + 3 && r >= box.r0 - 3 && r <= box.r1 + 4) continue;
                let free = 0;
                for (let dr = -wr; dr <= wr; dr++) {
                    for (let dq = -wq; dq <= wq; dq++) {
                        const t = tiles[r + dr] && tiles[r + dr][q + dq];
                        if (t && !t.isRoad && !t._townSoil && !t._fieldSoil && this._isFree(q + dq, r + dr)) free++;
                    }
                }
                if (free >= minFree) out.push({ q, r, free, d, a: Math.atan2(r - A.center.r, q - A.center.q) });
            }
        }
        return out;
    },

    /** The muster camp: a commander's pavilion, rows of tents, fires, the supply wagons' crates and barrels. */
    _pitchCamp(tiles, A, v) {
        const gates = A.gates || [];
        const gd = c => gates.reduce((m, g) => Math.min(m, Math.hypot(g.q - c.q, g.r - c.r)), Infinity);
        const sites = this._openGround(A, 6, 4, 70).sort((a, b) => (b.free - gd(b) * 0.6 - b.d * 0.2) - (a.free - gd(a) * 0.6 - a.d * 0.2));
        const at = sites[0];
        if (!at) return;
        this._camp = { q: at.q, r: at.r };
        // The pavilion at the head, two rows of tents, a fire between, the stores to the side
        const tents = v.muster.tents;
        const plan = [['tp_pavilion_banners', 0, -3]];
        for (let i = 0; i < tents; i++) plan.push([i % 2 ? 'tp_tent_canvas_open' : 'tp_tent_canvas', -5 + (i % 4) * 3 + (i >= 4 ? 1 : 0), i < 4 ? 0 : 3]);
        // (the stores: a pile of sacks the supply train's loads are carried to)
        plan.push(['tp_campfire', -2, 2], ['tp_campfire', 3, 2], ['tp_sacks', 6, -1]);
        this._depot = null;
        plan.forEach(([id, dq, dr], n) => {
            for (let k = 0; k < 6; k++) {
                const off = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 1]][k];
                if (this._putProp(id, at.q + dq + off[0], at.r + dr + off[1], `camp:${n}`)) {
                    if (id === 'tp_sacks') this._depot = this._near(at.q + dq + off[0], at.r + dr + off[1] + 1, 2);
                    break;
                }
            }
        });
        // (no room for the sacks' pile: they are carried to its place all the same)
        if (!this._depot) this._depot = this._near(at.q + 6, at.r, 3);
        // The supply train: in from the road at the map's edge nearest the camp, to stand by the stores
        this._trainFrom = this._edgeRoad(at);
        this._trainSlots = [];
        for (const [dq, dr] of [[10, -2], [10, 2], [13, 0]]) {
            const sp = this._near(at.q + dq, at.r + dr, 2);
            if (sp && !this._trainSlots.some(x => _dist(x, sp) < 3)) this._trainSlots.push(sp);
        }
        this._trainNext = null;
        this._trainQueue = 0;
    },

    /** Where a road (else open ground) comes onto the map nearest `at`, a few tiles in from the edge. */
    _edgeRoad(at) {
        const tiles = this._outer;
        const W = (tiles[0] || []).length, H = tiles.length, m = 3;
        let best = null, bs = Infinity;
        const look = (q, r) => {
            if (!this._standable(q, r)) return;
            const t = tiles[r][q];
            const sc = Math.hypot(q - at.q, r - at.r) - (t.isRoad ? 12 : 0);
            if (sc < bs) { bs = sc; best = { q, r }; }
        };
        for (let q = m; q < W - m; q++) { look(q, m); look(q, H - 1 - m); }
        for (let r = m; r < H - m; r++) { look(m, r); look(W - 1 - m, r); }
        return best;
    },

    /** The siege lines beyond the walls: a ring of fires, a tent by every other. */
    _siegeFires(tiles, A, v) {
        const n = v.siege.fires;
        const sites = this._openGround(A, 2, 1, 12);
        const used = [];
        for (let i = 0; i < n; i++) {
            // each fire its own sector round the town, the nearest open ground to the walls in it
            const a0 = -Math.PI + (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / n;
            const pick = sites.filter(x => x.a >= a0 && x.a < a1 && !used.some(u => _dist(u, x) < 6)).sort((a, b) => a.d - b.d)[0];
            if (!pick) continue;
            used.push(pick);
            if (!this._putProp('tp_campfire', pick.q, pick.r, `siege:${i}`)) continue;
            if (i % 2 === 0) this._putProp(i % 4 === 0 ? 'tp_tent_canvas' : 'tp_tent_canvas_open', pick.q + 2, pick.r, `siegeT:${i}`) || this._putProp('tp_tent_canvas', pick.q - 3, pick.r, `siegeT:${i}`);
        }
    },

    /** Poles either side of each road in, and before the seat's door: each crown's banner in turn. */
    _plantBanners(tiles, A, blds, v) {
        const out = [];
        const crowns = v.crowns || [];
        if (!crowns.length) return out;
        let i = 0;
        const put = (q, r, tall) => {
            const c = crowns[i % crowns.length];
            // (the crown's livery, as its soldiers wear it and its battles show it; its map colour otherwise)
            const liv = InnerMapBattle._realmLivery(c.kingdomId);
            const color = (liv && (TownWorld.config().liveryColours || {})[liv.shirt]) || c.color;
            out.push({ q, r, color, charge: _chargeFor(color), i: _hash32(String(c.kingdomId)) % 4, tall });
            i++;
        };
        const taken = new Set();
        for (const g of A.gates || []) {
            // across the road from each other, a step in from the gate
            const side = g.face === 0 || g.face === 2 ? [[-2, 0], [2, 0]] : [[0, -2], [0, 2]];
            i = 0;
            for (const [dq, dr] of side) {
                const sp = this._bannerSpot(g.q + dq, g.r + dr, taken);
                if (sp) put(sp.q, sp.r, true);
            }
        }
        const seat = blds.filter(b => b && SEAT_TYPES.includes(b.type)).sort((a, b) => SEAT_TYPES.indexOf(a.type) - SEAT_TYPES.indexOf(b.type))[0];
        if (seat && InnerMap._findPassableAdjacentTile) {
            const door = InnerMap._findPassableAdjacentTile(seat.q, seat.r);
            if (door) {
                i = 0;
                for (const dq of [-1, 1]) {
                    const sp = this._bannerSpot(door.q + dq, door.r, taken);
                    if (sp) put(sp.q, sp.r, false);
                }
            }
        }
        return out;
    },

    _bannerSpot(q, r, taken) {
        for (let rad = 0; rad <= 2; rad++) {
            for (let dr = -rad; dr <= rad; dr++) {
                for (let dq = -rad; dq <= rad; dq++) {
                    if (Math.max(Math.abs(dq), Math.abs(dr)) !== rad) continue;
                    const qq = q + dq, rr = r + dr;
                    const t = this._outer[rr] && this._outer[rr][qq];
                    if (!t || t.isRoad || !this._isFree(qq, rr) || taken.has(`${qq},${rr}`)) continue;
                    taken.add(`${qq},${rr}`);
                    return { q: qq, r: rr };
                }
            }
        }
        return null;
    },

    /** Ranks on the square: rows of four, two apart, from its heart (the square's paving, else its streets). */
    _drillGrid(A, n) {
        const out = [];
        const taken = new Set();
        const paved = (q, r) => {
            const t = this._outer[r] && this._outer[r][q];
            return !!(t && (t._plaza || t.isRoad) && this._standable(q, r));
        };
        const sq = (A.square && A.square.length ? A.square : [A.center]).slice().sort((a, b) => _dist(a, A.center) - _dist(b, A.center));
        const c = sq.find(x => paved(x.q, x.r)) || sq[0];
        for (let i = 0; i < n; i++) {
            const col = i % 4, row = Math.floor(i / 4);
            const q = c.q - 3 + col * 2, r = c.r + row * 2;
            if (paved(q, r) && !taken.has(`${q},${r}`)) { taken.add(`${q},${r}`); out.push({ q, r }); }
        }
        // (a cramped square: wherever on it there is room, two apart)
        for (const x of sq) {
            if (out.length >= n) break;
            if (!this._standable(x.q, x.r) || out.some(o => _dist(o, x) < 2)) continue;
            out.push({ q: x.q, r: x.r });
        }
        // (the ranks step a pace forward and back on the call, only if every man has the room)
        this._drillStep = out.length > 0 && out.every(o => this._standable(o.q, o.r + 1));
        // The sergeant off the ranks' flank, facing them
        const sg = this._near(c.q - 5, c.r + 2, 2, new Set(out.map(o => `${o.q},${o.r}`))) || this._near(c.q + 5, c.r + 2, 2);
        this._sergeant = sg ? { q: sg.q, r: sg.r, facing: sg.q < c.q ? InnerMapCharacters.DIR_RIGHT : InnerMapCharacters.DIR_LEFT } : null;
        return out;
    },

    // ──────────── THE FIGURES ────────────

    /** The figures today's view wants: [{ key, kind, i, type, layers|preset, name, role, kingdomId }]. */
    _wanted(world, s, v) {
        const out = [];
        const realm = v.realmName ? v.realmName.replace(/^.* of /, '') : 'the realm';
        const add = (kind, n, extra = {}) => { for (let i = 0; i < n; i++) out.push({ key: `${kind}:${i}`, kind, i, ...extra }); };
        if (v.kingdomId != null) {
            add('soldier', Math.min(10, v.billet), { kingdomId: v.kingdomId, role: TownWorld.name('soldier', { realm }) });
            if (v.conquered) add('garrison', Math.min(8, v.conquered.garrison), { kingdomId: v.kingdomId, role: TownWorld.name('garrison', { realm }) });
            if (v.muster && v.muster.men) add('muster', Math.min(10, v.muster.men), { kingdomId: v.kingdomId, role: TownWorld.name('soldier', { realm }) });
            add('wounded', Math.min(6, v.wounded), { kingdomId: v.kingdomId, role: TownWorld.name('wounded') });
        }
        if (v.holy) {
            add('crusader', Math.min(6, v.holy.crusaders), { role: TownWorld.name('crusader') });
            if (v.holy.preach) add('preacher', 1, { role: TownWorld.name('preacher'), title: 'Brother' });
        }
        if (v.inquisition) {
            add('inquisitor', 1, { name: v.inquisition.name, role: 'Inquisitor of the Holy Office', inqId: v.inquisition.id });
            add('clerk', 2, { role: TownWorld.name('clerk') });
        }
        add('beggar', Math.min(5, v.beggars), { role: TownWorld.name('beggar') });
        // The famine in every era: the bread line, a guard at the barred granary
        if (v.famine) {
            add('queue', Math.min(8, this._queue.length), { role: TownWorld.name('queue') });
            if (v.kingdomId != null) add('granary_guard', this._granaries.length, { kingdomId: v.kingdomId, role: TownWorld.name('granary_guard') });
        }
        return out;
    },

    _layersFor(w) {
        const looks = (TownWorld.config().looks) || {};
        const H = TownWorld.config().holy;
        if (w.kind === 'soldier' || w.kind === 'garrison' || w.kind === 'muster' || w.kind === 'granary_guard') {
            return InnerMapEscort.layersFor({ type: w.kind === 'garrison' || w.kind === 'granary_guard' ? 'foot' : (w.i % 3 === 2 ? 'militia' : 'foot'), realmGuard: w.kingdomId }, w.i);
        }
        if (w.kind === 'crusader') {
            // the white surcoat (the red cross is drawn over it: drawOverlay), the realm's arms otherwise
            const base = InnerMapEscort.layersFor({ type: 'foot', realmGuard: `cross:${w.i}` }, w.i);
            return base.map(l => (/\/Torso\//.test(l) ? `${MALE}/Torso/Shirt 07 - Buttoned Longsleeve Shirt/${H.surcoat || 'White'}` : /Shield 01 - Heater Shield\/Paint\//.test(l) ? 'Props/Shield 01 - Heater Shield/Paint/White' : l));
        }
        if (w.kind === 'wounded') {
            const base = InnerMapEscort.layersFor({ type: 'militia', realmGuard: w.kingdomId }, w.i).filter(l => !/^Props\/|Head Accessories/.test(l));
            if (w.i % 2 === 0) base.push('Maimed/Crutch - Right/Masculine');
            if (w.i % 3 === 1) base.push('Maimed/Blindfold/Masculine');
            return base;
        }
        return Array.isArray(looks[w.kind]) ? looks[w.kind].slice() : null;
    },

    /** The figure's look: a registered composite of its layers (or a stock preset while that loads). */
    _presetFor(w) {
        const layers = this._layersFor(w);
        if (!layers || !layers.length) return null;
        const sig = layers.join('|');
        let id = this._presets.get(sig);
        if (!id) {
            id = `tw:${_hash32(sig).toString(36)}`;
            this._presets.set(sig, id);
            try { InnerMapCharacters.registerPreset(id, layers); } catch (e) { /* drawn as its stand-in */ }
        }
        return id;
    },

    _fallbackPreset(w, id) {
        const type = w.kind === 'beggar' ? 'beggar' : w.kind === 'preacher' || w.kind === 'inquisitor' || w.kind === 'clerk' ? 'priest' : w.kind === 'messenger' || w.kind === 'petitioner' || w.kind === 'queue' || w.kind === 'teamster' ? 'villager' : 'guard';
        return InnerMapCharacters.getPresetForNPC(type, id) || null;
    },

    /** Spawn and retire figures to match what is wanted (those walking off stay till they are gone). */
    _roster(game, s, v) {
        const npcs = InnerMap.npcs;
        if (!Array.isArray(npcs) || !InnerMap._makeNpc) return;
        this._figs = this._figs.filter(n => n.state !== 'gone' && npcs.includes(n));
        const want = this._wanted(game.world, s, v);
        const keys = new Set(want.map(w => w.key));
        for (const n of this._figs) {
            if (n._tw.kind === 'messenger' || n._tw.kind === 'petitioner' || n._tw.kind === 'beggar_up' || n._tw.kind === 'teamster') continue;
            if (!keys.has(n._tw.key)) n._tw.leaving = true;
        }
        for (const w of want) {
            if (this._figs.some(n => n._tw.key === w.key && !n._tw.leaving)) continue;
            if (_num(this._respawn.get(w.key), -1) > this._clock) continue;
            this._spawn(w);
        }
    },

    _spawn(w, at = null) {
        const npcs = InnerMap.npcs;
        const A = InnerMap.townArea();
        const id = ID_BASE + (npcs.reduce((m, n) => Math.max(m, _num(n.id)), 0) % 100000) + 1;
        let x = _hash32(`${this._townKey}|${w.key}|${this._day}`);
        const rng = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
        const type = w.kind === 'beggar' || w.kind === 'beggar_up' ? 'beggar' : w.kind === 'preacher' || w.kind === 'inquisitor' || w.kind === 'clerk' ? 'priest' : w.kind === 'soldier' || w.kind === 'garrison' || w.kind === 'muster' || w.kind === 'granary_guard' ? 'guard' : 'villager';
        const npc = InnerMap._makeNpc(type, id, rng) || InnerMap._makeNpc('villager', id, rng);
        if (!npc) return null;
        // Where they come in: the crusaders and callers at a gate; the rest at their place
        const gates = A.gates || [];
        let start = at;
        if (!start && (w.kind === 'crusader' && !(this._view && this._view.holy && this._view.holy.musterHere))) {
            const g = gates.length ? gates[w.i % gates.length] : null;
            start = g ? this._near(g.q, g.r, 3) : null;
        }
        // (in the drill hours the billeted men are found at drill on the square)
        if (!start && w.kind === 'soldier' && this._view && TownWorld.inHours(this._hour(), this._view.drill)) start = this._drillSpot(w.i);
        if (!start) start = this._homeSpot(npc, w) || { q: npc.q, r: npc.r };
        npc.q = npc.prevQ = npc.targetQ = start.q;
        npc.r = npc.prevR = npc.targetR = start.r;
        npc.name = w.name || (w.title ? `${w.title} ${npc.name}` : npc.name);
        npc.roleTitle = w.role || w.name || npc.roleTitle;
        npc.state = 'idle';
        npc.idleTimer = 4;
        npc.path = null;
        npc.visitsLeft = 99;
        npc.preset = this._fallbackPreset(w, id);
        npc._twPreset = this._presetFor(w);
        npc._tw = { kind: w.kind, key: w.key, i: w.i, kingdomId: w.kingdomId, inqId: w.inqId, leg: 0, waitUntil: 0, home: null, born: this._clock, line: 0 };
        // (fighting one of them is assault on the realm's man, as on anyone: no special licence)
        npcs.push(npc);
        this._figs.push(npc);
        return npc;
    },

    /** The place a figure keeps when nothing else calls it. */
    _homeSpot(npc, w) {
        const A = InnerMap.townArea();
        const blds = InnerMap._townBuildings ? InnerMap._townBuildings() : [];
        const door = b => (b && InnerMap._findPassableAdjacentTile ? InnerMap._findPassableAdjacentTile(b.q, b.r) : null);
        const church = blds.find(b => CHURCH_TYPES.includes(b.type));
        const sq = A.square && A.square.length ? A.square.slice().sort((a, b) => _dist(a, A.center) - _dist(b, A.center)) : [A.center];
        const taken = new Set(this._figs.filter(n => n !== npc && n._tw && n._tw.home).map(n => `${n._tw.home.q},${n._tw.home.r}`));
        // (no one stands in a doorway)
        for (const b of blds) { const d = door(b); if (d) taken.add(`${d.q},${d.r}`); }
        let base = null, ring = 2;
        switch (w.kind) {
            case 'soldier': {
                const inns = blds.filter(b => INN_TYPES.includes(b.type));
                const houses = blds.filter(b => b.type === 'house').sort((a, b) => townHash('bil', this._townKey, a.q, a.r) - townHash('bil', this._townKey, b.q, b.r));
                const list = [...inns, ...houses];
                const b = list.length ? list[Math.floor(w.i / 2) % list.length] : null;
                if (b) npc._twBillet = b;
                base = door(b) || sq[0];
                break;
            }
            case 'garrison': {
                const gates = A.gates || [];
                const seat = blds.filter(b => SEAT_TYPES.includes(b.type))[0];
                if (w.i < gates.length * 1 || !seat) { const g = gates[w.i % Math.max(1, gates.length)]; base = g ? { q: g.q + (w.i % 2 ? 1 : -1), r: g.r } : sq[0]; } else base = door(seat) || sq[0];
                ring = 2;
                break;
            }
            case 'muster':
            case 'crusader': {
                // about the camp's fires (crusaders on the far side of them)
                // (beside the fires at (-2, 2) and (3, 2), never just before one: the flames would stand in them)
                const off = [[-3, 2], [-1, 2], [-4, 3], [2, 2], [4, 2], [5, 3], [-1, 4], [1, 3], [0, 1], [-5, 2]];
                const o = off[(w.i + (w.kind === 'crusader' ? 5 : 0)) % off.length];
                base = this._camp ? { q: this._camp.q + o[0], r: this._camp.r + o[1] } : sq[Math.min(sq.length - 1, 2 + w.i)];
                ring = 3;
                break;
            }
            case 'wounded': {
                // along the temple's front, either side of its door (never in the doorway)
                const d = door(church);
                base = d ? { q: d.q + (w.i % 2 ? 1 : -1) * (2 + Math.floor(w.i / 2)), r: d.r } : sq[0];
                ring = 2;
                break;
            }
            case 'preacher':
                base = sq[Math.min(sq.length - 1, 1)] || A.center;
                break;
            case 'inquisitor':
            case 'clerk': {
                const c = door(church);
                const mid = c ? { q: Math.round((c.q + A.center.q) / 2), r: Math.round((c.r + A.center.r) / 2) } : sq[0];
                base = w.kind === 'clerk' ? { q: mid.q + (w.i ? 1 : -1), r: mid.r } : mid;
                ring = 1;
                break;
            }
            case 'queue': {
                // (their place in the line: no ring, the line is the line)
                const q = this._queue[w.i];
                if (q) return { q: q.q, r: q.r };
                base = sq[0];
                break;
            }
            case 'granary_guard': {
                // beside the barred granary's door, not in it
                const d = door(this._granaries[w.i]);
                base = d ? { q: d.q + (w.i % 2 ? -1 : 1), r: d.r } : sq[0];
                ring = 1;
                break;
            }
            case 'beggar': {
                const market = blds.find(b => b.type === 'marketplace');
                const d = door(w.i % 2 ? market || church : church || market);
                base = d ? { q: d.q + (w.i % 2 ? -2 : 2), r: d.r + 1 } : sq[sq.length - 1];
                ring = 2;
                break;
            }
            default: base = sq[0];
        }
        const sp = base ? this._near(base.q, base.r, ring + 2, taken) : null;
        return sp;
    },

    // ──────────── WALKING THEM ────────────

    _goTo(npc, spot) {
        if (!spot || (npc.q === spot.q && npc.r === spot.r)) return false;
        if (npc.state === 'walking' && npc.path && npc.path.length) {
            const end = npc.path[npc.path.length - 1];
            if (end && end.q === spot.q && end.r === spot.r) return true;
        }
        if (npc.state === 'inside_building') return false;
        return InnerMap._walkTo ? InnerMap._walkTo(npc, spot) : false;
    },

    _at(npc, spot) { return !!spot && npc.q === spot.q && npc.r === spot.r && npc.state === 'idle'; },

    _drive(game, s, v) {
        const h = this._hour();
        const night = h >= 21 || h < 6;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const tokens = this._tokens(game, v);
        const A = InnerMap.townArea();
        const drill = TownWorld.inHours(h, v.drill);
        for (const npc of this._figs) {
            const tw = npc._tw;
            if (!tw || npc.state === 'gone' || npc._fight || npc._dialogFrozen || npc.state === 'unconscious' || npc.state === 'bound' || npc._carried) continue;
            // The look, once composited
            if (npc._twPreset && npc.preset !== npc._twPreset && InnerMapCharacters.getComposited(npc._twPreset)) npc.preset = npc._twPreset;
            if (!tw.home) tw.home = this._homeSpot(npc, tw);
            const near = _dist(npc, me) <= 10;
            // Leaving: out by the nearest gate, then gone
            if (tw.leaving) { this._leave(npc, A); continue; }
            switch (tw.kind) {
                case 'soldier': {
                    if (night && npc._twBillet) {
                        this._offDrill(npc);
                        if (npc.state !== 'inside_building' && InnerMap._goInto && npc.state !== 'walking') InnerMap._goInto(npc, npc._twBillet, 'home');
                        break;
                    }
                    const slot = drill ? this._drillSpot(tw.i) : null;
                    if (slot) {
                        // (to the ranks; there _drillTime keeps the beat, every frame)
                        if (!tw.drilling) {
                            if (!this._at(npc, slot) && npc.state !== 'walking') this._goTo(npc, slot);
                            if (this._at(npc, slot)) tw.drilling = true;
                        }
                        break;
                    }
                    this._offDrill(npc);
                    this._keep(npc, tw.home, { type: 'billet', icon: '🛡️', label: 'Billeted here', anim: 'idle', quiet: true }, near, 'billet', 26, tokens);
                    break;
                }
                case 'queue':
                    // In line at the barred door, facing the one ahead; the head now and then calls out
                    this._keep(npc, tw.home, { type: 'queue', icon: '🍞', label: 'Waiting for bread', anim: 'idle', quiet: true }, near && tw.i < 2, 'bread_line', 16, tokens);
                    if (this._at(npc, tw.home) && this._queue[tw.i]) npc.facing = this._queue[tw.i].facing;
                    break;
                case 'granary_guard':
                    this._keep(npc, tw.home, { type: 'post', icon: '🛡️', label: 'Guarding the granary', anim: 'ready', quiet: true }, near, 'granary_guard', 18, tokens);
                    if (this._at(npc, tw.home)) npc.facing = InnerMapCharacters.DIR_DOWN;
                    break;
                case 'teamster': {
                    // (the cart drives them: ui/innerMapCarts.js; once it is gone, so are they)
                    if (!npc._cartDriver) { tw.leaving = true; break; }
                    const c = this._train.find(x => x.id === npc._cartDriver);
                    if (c && c.phase === 'unload' && !tw.said && near) { tw.said = true; this._bark(npc, TownWorld.line('teamster', `${tw.key}`, tokens), 3.5); }
                    break;
                }
                case 'garrison':
                    this._keep(npc, tw.home, { type: 'post', icon: '🛡️', label: 'On guard for the new crown', anim: 'ready', quiet: true }, false);
                    break;
                case 'muster':
                    if (this._haul(npc, near, tokens)) break;
                    this._keep(npc, tw.home, { type: 'camp', icon: '⛺', label: 'With the host', anim: tw.i % 3 === 1 ? 'sitting' : 'idle', quiet: true }, near, 'muster', 20, tokens);
                    break;
                case 'crusader':
                    this._crusader(npc, A, v, near, tokens);
                    break;
                case 'preacher': {
                    const C = TownWorld.config().holy;
                    const preaching = TownWorld.inHours(h, C.preachHours);
                    this._keep(npc, preaching ? tw.home : (this._homeSpot(npc, { kind: 'wounded' }) || tw.home),
                        { type: 'preach', icon: '✝️', label: preaching ? 'Calling for the cross' : 'At prayer', anim: preaching ? 'emotes' : 'idle' }, preaching && _dist(npc, me) <= 12, 'preacher', 7, tokens);
                    break;
                }
                case 'inquisitor':
                    this._keep(npc, tw.home, { type: 'hearing', icon: '⚖️', label: 'The Holy Office sits', anim: 'idle' }, near, 'inquisitor', 11, tokens);
                    break;
                case 'clerk':
                    this._keep(npc, tw.home, { type: 'hearing', icon: '📜', label: 'Writing it down', anim: 'emotes', quiet: true }, near, 'clerk', 15, tokens);
                    break;
                case 'wounded':
                    this._keep(npc, tw.home, { type: 'wounded', icon: '🩸', label: 'Wounded', anim: 'sitting', quiet: true }, near, 'wounded', 22, tokens);
                    break;
                case 'beggar':
                    this._keep(npc, tw.home, { type: 'beg', icon: '🥣', label: 'Begging', anim: 'sitting', quiet: true }, near, 'famine_beggar', 14, tokens);
                    break;
                default:
                    this._approacher(game, npc, A, tokens);
            }
        }
    },

    /** Stand (or sit) at the spot; a line now and then while the player is near. */
    _keep(npc, spot, activity, talk, pool, every, tokens) {
        if (spot && !this._at(npc, spot)) {
            if (npc.state === 'idle') this._goTo(npc, spot);
            if (npc.state === 'walking') return;
        }
        if (npc.state !== 'idle') return;
        npc.facing = activity.anim === 'sitting' || activity.type === 'preach' || activity.type === 'hearing' ? InnerMapCharacters.DIR_DOWN : npc.facing;
        npc.activity = activity;
        if (talk && pool) this._say(npc, pool, every, tokens);
    },

    _say(npc, pool, every, tokens) {
        const tw = npc._tw;
        if (npc._bark && npc._bark.until > _now()) return;
        // (one of them speaks at a time)
        if (this._clock < this._voiceAt) return;
        if (this._clock - tw.line < every * (0.8 + townHash('ev', tw.key, Math.floor(this._clock / every)) * 0.5)) return;
        tw.line = this._clock;
        const text = TownWorld.line(pool, `${tw.key}|${Math.floor(this._clock)}`, tokens);
        if (!text) return;
        this._bark(npc, text);
        this._voiceAt = this._clock + 3.2;
    },

    _tokens(game, v) {
        const p = game.player || {};
        const foe = (v.siege && v.siege.name) || (v.threat && v.threat.name) || (v.muster && v.muster.foe) || (v.foes && v.foes[0] ? v.foes[0].name : 'the enemy');
        const t = {
            realm: v.realmName || 'the realm', foe, head: (v.holy && v.holy.preach && v.holy.preach.head) || 'the Church',
            target: (v.holy && (v.holy.target || (v.holy.preach && v.holy.preach.target))) || 'the infidel', muster: (v.holy && v.holy.muster) || 'the muster',
            old: v.conquered ? v.conquered.fromName : 'the old crown', new: v.conquered ? v.conquered.byName : (v.realmName || 'the crown'),
            title: p.gender === 'female' ? 'my lady' : 'my lord',
        };
        return t;
    },

    /** A crusader on his way: in at a gate, a stop in the square, out at another (at the muster: about the camp). */
    _crusader(npc, A, v, near, tokens) {
        const tw = npc._tw;
        if (v.holy && v.holy.musterHere) {
            this._keep(npc, tw.home, { type: 'camp', icon: '✝️', label: 'Under the cross', anim: 'idle', quiet: true }, near, 'crusader', 18, tokens);
            return;
        }
        const gates = A.gates || [];
        if (tw.leg === 0) {
            const sq = A.square && A.square.length ? A.square[(tw.i * 3) % A.square.length] : A.center;
            const spot = tw.stop || (tw.stop = this._near(sq.q, sq.r, 2) || sq);
            if (!this._at(npc, spot)) { if (npc.state === 'idle') this._goTo(npc, spot); return; }
            if (!tw.waitUntil) tw.waitUntil = this._clock + 25 + tw.i * 4;
            npc.activity = { type: 'pass', icon: '✝️', label: 'On the road to the muster', anim: 'idle', quiet: true };
            if (near) this._say(npc, 'crusader', 9, tokens);
            if (this._clock >= tw.waitUntil) { tw.leg = 1; npc.activity = null; }
            return;
        }
        // Out at a gate other than the one they came in by
        const g = gates.length ? gates[(tw.i + 1 + (gates.length > 2 ? 1 : 0)) % gates.length] : null;
        const out = tw.exit || (tw.exit = g ? this._near(g.q, g.r, 3) : null);
        if (!out || this._at(npc, out)) {
            npc.state = 'gone';
            this._respawn.set(tw.key, this._clock + 40 + tw.i * 15);
            return;
        }
        if (npc.state === 'idle') this._goTo(npc, out);
    },

    _leave(npc, A) {
        const gates = A.gates || [];
        const tw = npc._tw;
        let best = null;
        for (const g of gates) if (!best || _dist(g, npc) < _dist(best, npc)) best = g;
        const out = tw.exit || (tw.exit = best ? this._near(best.q, best.r, 3) : null);
        if (!out || this._at(npc, out) || this._clock - (tw.leftAt || (tw.leftAt = this._clock)) > 90) {
            npc.state = 'gone';
            return;
        }
        npc.activity = null;
        if (npc.state === 'idle') this._goTo(npc, out);
    },

    // ──────────── THE DRILL ────────────

    /** Soldier i's place at drill: the sergeant's (the first, when there is room for him), else his in the ranks. */
    _drillSpot(i) {
        if (this._sergeant && i === 0) return this._sergeant;
        return this._drillSlots[this._sergeant ? i - 1 : i] || null;
    },

    _offDrill(npc) {
        const tw = npc._tw;
        if (!tw || !tw.drilling) return;
        tw.drilling = false;
        npc._pose = null;
        if (npc.activity && npc.activity.type === 'drill') npc.activity = null;
    },

    /**
     * Every frame of the drill hours: the ranks keep the beat together
     * (TownWorld.drillBeat) — on guard; the thrust on the sergeant's call, its
     * halfslash frames held in turn (npc._pose); recover; a pace forward (and
     * back, the next time) on "Step!". The sergeant stands off their flank
     * and calls each beat while the player is near. Nothing allocated but a
     * step's path.
     */
    _drillTime() {
        const v = this._view;
        if (!v || !v.billet || !this._drillSlots.length || !TownWorld.inHours(this._hour(), v.drill)) return;
        TownWorld.drillBeat(this._clock, _beat);
        const fresh = _beat.beat !== this._drillCall || _beat.cycle !== this._drillCycle;
        this._drillCall = _beat.beat;
        this._drillCycle = _beat.cycle;
        const back = _beat.cycle % 2 === 1;
        // (where the ranks stand: a pace forward after an even cycle's step, back after an odd one's)
        const off = this._drillStep ? ((_beat.late ? !back : back) ? 1 : 0) : 0;
        const mq = InnerMap.playerInnerQ, mr = InnerMap.playerInnerR;
        for (let k = 0; k < this._figs.length; k++) {
            const npc = this._figs[k];
            const tw = npc._tw;
            if (!tw || tw.kind !== 'soldier' || !tw.drilling || tw.leaving) continue;
            if (npc._fight || npc._dialogFrozen || npc.state === 'unconscious' || npc.state === 'bound' || npc._carried || npc.state === 'gone') continue;
            const act = tw.act || (tw.act = { type: 'drill', icon: '⚔️', label: 'At drill', anim: 'ready', quiet: true });
            if (this._sergeant && tw.i === 0) {
                if (npc.state === 'idle') npc.facing = this._sergeant.facing;
                act.label = 'Drilling the men';
                act.anim = 'idle';
                npc._pose = null;
                npc.activity = act;
                if (fresh && Math.max(Math.abs(npc.q - mq), Math.abs(npc.r - mr)) <= 12) {
                    const calls = TownWorld.config().drillCalls || {};
                    const text = calls[_beat.beat === 'step' ? (back ? 'back' : 'step') : _beat.beat];
                    if (text && (_beat.beat !== 'ready' || !_beat.late)) this._bark(npc, text, 1.3);
                }
                continue;
            }
            const base = this._drillSlots[this._sergeant ? tw.i - 1 : tw.i];
            if (!base || npc.state === 'walking') continue;
            if (npc.q !== base.q || npc.r !== base.r + off) {
                if (npc.state === 'idle') { npc._pose = null; this._goTo(npc, { q: base.q, r: base.r + off }); }
                continue;
            }
            npc.facing = InnerMapCharacters.DIR_DOWN;
            const thrust = _beat.beat === 'thrust';
            act.anim = thrust ? 'halfslash' : 'ready';
            npc._pose = thrust ? _beat.frame : null;
            npc.activity = act;
        }
    },

    // ──────────── THE SUPPLY TRAIN ────────────

    /** On the half-second: the host's wagons on the map, the next train due, the wagon unloading now. */
    _trainTick(game, v) {
        if (!v.muster || !this._camp || !this._trainFrom || !this._trainSlots.length) { this._unloading = null; return; }
        const C = TownWorld.config().war.train;
        const carts = InnerMap.carts || [];
        this._train = this._train.filter(c => carts.includes(c));
        this._unloading = this._train.find(c => c.phase === 'unload') || null;
        if (this._trainNext == null) this._trainNext = this._clock + _num(C.firstAfter, 6);
        if (this._trainQueue > 0) {
            // (the next sets out once the last is well up the road: never on top of it)
            const from = this._trainFrom;
            const clear = this._train.every(c => c.phase !== 'in' || !c.driver || _dist(c.driver, from) >= 7);
            if (clear && this._clock >= this._trainLaunchAt) {
                this._launchWagon(C);
                this._trainQueue--;
                this._trainLaunchAt = this._clock + _num(C.gap, 7);
            }
            return;
        }
        if (TownWorld.trainDue(this._clock, this._trainNext, this._hour(), this._train.length, C)) {
            this._trainQueue = Math.max(1, Math.min(4, _num(C.wagons, 3)));
            this._trainLaunchAt = this._clock;
            this._trainNext = this._clock + _num(C.every, 80);
        }
    },

    /** A wagon of the train in from the road's end, its teamster at the horse's head. */
    _launchWagon(C) {
        const k = this._trainSeq++;
        const slot = this._trainSlots[k % this._trainSlots.length];
        const npc = this._spawn({ key: `teamster:${k}`, kind: 'teamster', i: k, role: TownWorld.name('teamster') }, this._trainFrom);
        if (!npc) return null;
        const c = InnerMapCarts.startConvoy({ at: this._trainFrom, to: slot, driver: npc, label: 'Bringing stores to the host', outLabel: 'Back down the road for more', unloadSecs: _num(C.unloadSecs, 32) });
        if (!c) { npc.state = 'gone'; return null; }
        this._train.push(c);
        return c;
    },

    /** A tile beside the wagon (no cart on it) for the i-th of its haulers. */
    _besideCart(c, i) {
        const out = [];
        for (let t = c.trail.length - 1; t >= 0; t--) {
            for (const [dq, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const q = c.trail[t].q + dq, r = c.trail[t].r + dr;
                if (this._standable(q, r) && !InnerMap.cartAt(q, r) && !out.some(o => o.q === q && o.r === r)) out.push({ q, r });
            }
        }
        return out.length ? out[i % out.length] : null;
    },

    /** While a wagon unloads, the first men of the host carry its sacks to the stores. → true while hauling. */
    _haul(npc, near, tokens) {
        const tw = npc._tw;
        const c = this._unloading;
        if (!c || tw.i >= _num(TownWorld.config().war.train.haulers, 2) || !this._depot) {
            if (tw.haul) { tw.haul = null; tw.haulCart = null; npc._carry = null; }
            return false;
        }
        if (tw.haulCart !== c.id) { tw.haul = 'to'; tw.haulCart = c.id; tw.haulAt = this._besideCart(c, tw.i); }
        const spot = tw.haul === 'to' ? tw.haulAt : this._depot;
        if (!spot) return false;
        const act = tw.haulAct || (tw.haulAct = { type: 'haul', icon: '📦', label: 'Unloading the wagons', anim: 'idle', quiet: true });
        npc.activity = act;
        // (at the wagon's side within a pace will do; a side they cannot reach, another)
        const there = tw.haul === 'to' ? npc.state === 'idle' && _dist(npc, spot) <= 1 : this._at(npc, spot);
        if (!there) {
            if (npc.state === 'idle' && !this._goTo(npc, spot) && tw.haul === 'to') tw.haulAt = this._besideCart(c, tw.i + (tw.haulTry = (tw.haulTry || 0) + 2));
            return true;
        }
        if (tw.haul === 'to') {
            npc._carry = { good: 'grain', qty: 1 };
            tw.haul = 'back';
            if (near) this._say(npc, 'hauler', 14, tokens);
        } else {
            npc._carry = null;
            tw.haul = 'to';
        }
        return true;
    },

    // ──────────── THE TOWN TALKS ────────────

    /** Townsfolk within earshot grumble: of the old crown, the hunger, the siege, the war, the ban. */
    _grumble(game, v) {
        const C = TownWorld.config().grumble;
        if (this._grumbled >= _num(C.perVisit, 8) || this._clock < this._grumbleAt) return;
        const pool = v.conquered ? 'grumble_conquered' : v.banned ? 'grumble_ban' : v.siege ? 'grumble_siege' : v.threat ? 'grumble_threat' : v.famine ? 'grumble_famine' : v.foes.length ? 'grumble_war' : null;
        const [lo, hi] = Array.isArray(C.every) ? C.every : [14, 24];
        this._grumbleAt = this._clock + lo + townHash('grumble', this._townKey, Math.floor(this._clock)) * (hi - lo);
        if (!pool) return;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const R = _num(C.radius, 9);
        const folk = (InnerMap.npcs || []).filter(n => n._person && !n._tw && n.state === 'idle' && n.type !== 'guard' && n.type !== 'child' && _dist(n, me) <= R && !(n._bark && n._bark.until > _now()));
        if (!folk.length) return;
        const who = folk[Math.floor(townHash('who', this._townKey, Math.floor(this._clock)) * folk.length) % folk.length];
        const text = TownWorld.line(pool, `${who.uid || who.id}|${this._grumbled}|${this._day}`, this._tokens(game, v));
        if (!text) return;
        this._bark(who, text, 4);
        this._grumbled++;
    },

    // ──────────── SOMEONE COMES UP TO YOU ────────────

    _approach(game, s, v, day) {
        const C = TownWorld.config().approach;
        if (this._approachDay === day || this._onStreet < _num(C.afterSecs, 12)) return;
        if (this._figs.some(n => n._tw && (n._tw.kind === 'messenger' || n._tw.kind === 'petitioner' || n._tw.kind === 'beggar_up'))) return;
        this._approachDay = day;
        const { player, world } = game;
        const cl = CourtLetters.state(player);
        const fresh = (cl.inbox || []).filter(l => l && l.day != null);
        const tile = world.getTile ? world.getTile(player.q, player.r) : null;
        const kind = TownWorld.approacher(day, this._townKey, {
            letterDay: cl.unread > 0 && fresh.length ? Math.max(...fresh.map(l => _num(l.day))) : null,
            petitions: Petitions.pending(player).length,
            holdsCourt: (() => { try { return Petitions.canHoldCourtAt(player, world, tile ? { ...tile, q: player.q, r: player.r } : null); } catch (e) { return false; } })(),
            gold: _num(player.gold), hardTimes: v.famine || !!v.siege || (s.type === 'city' || s.type === 'capital'),
        });
        if (!kind) return;
        const A = InnerMap.townArea();
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        // From a little way off, down the street
        const from = (A.streets || []).filter(x => { const d = _dist(x, me); return d >= 7 && d <= 12; })
            .sort((a, b) => townHash('from', day, a.q, a.r) - townHash('from', day, b.q, b.r))[0];
        const npc = this._spawn({ key: `${kind === 'beggar' ? 'beggar_up' : kind}:${day}`, kind: kind === 'beggar' ? 'beggar_up' : kind, i: 0, role: TownWorld.name(kind === 'beggar' ? 'beggar' : kind) }, from ? this._near(from.q, from.r, 2) : null);
        if (npc) npc._tw.until = this._clock + 90;
    },

    _approacher(game, npc, A, tokens) {
        const tw = npc._tw;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const C = TownWorld.config().approach;
        if (tw.done || this._clock > _num(tw.until, Infinity) || (tw.reachedAt && this._clock - tw.reachedAt > _num(C.waitSecs, 45))) { tw.leaving = true; return; }
        if (_dist(npc, me) <= 1 && npc.state === 'idle') {
            if (!tw.reachedAt) {
                tw.reachedAt = this._clock;
                const pool = tw.kind === 'beggar_up' ? 'beggar' : tw.kind;
                this._bark(npc, TownWorld.line(pool, `${tw.key}`, tokens), 5);
            }
            npc.facing = InnerMapCharacters.getDirection(me.q - npc.q, me.r - npc.r);
            npc.activity = { type: 'wait', icon: tw.kind === 'messenger' ? '✉️' : tw.kind === 'petitioner' ? '📜' : '🥣', label: 'Waiting on you', anim: 'idle' };
            return;
        }
        // (follow you a little while you walk)
        if (npc.state === 'idle' || (npc.state === 'walking' && this._clock - _num(tw.repath) > 2)) {
            tw.repath = this._clock;
            const side = me.q + (npc.q >= me.q ? 1 : -1);
            const sp = this._near(side, me.r, 1) || this._near(me.q, me.r + 1, 2);
            if (sp && !(sp.q === me.q && sp.r === me.r)) this._goTo(npc, sp);
        }
    },

    // ──────────── DRAWN ────────────

    collect(items, ctx, camera, T) {
        if (InnerMap._insideBuilding || !this._view || this._outer !== InnerMap.tiles) return;
        const ds = T * camera.zoom;
        const u = Math.max(1, Math.round(ds / 22));
        const now = _now() / 1000;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        // The crowns' banners at the roads in and the seat (the tournament's banner art)
        for (const b of this._banners) {
            const s0 = camera.worldToScreenFast(b.q * T + T / 2, b.r * T + T);
            const x = s0.x, y = s0.y - ds * 0.05;
            if (x < -ds * 2 || y < -ds * 3 || x > W + ds * 2 || y > H + ds * 3) continue;
            items.push({ sortY: (b.r + 1) * T - 1, zLayer: 2, sortX: b.q, draw: () => InnerMapTournament._drawBanner(ctx, x, y, ds, now, b.color, b.charge, b.tall, b.i) });
        }
        // A temple shut under the ban: planks across its doors; a bakery with no bread: barred
        for (const b of this._shutDoors) {
            const f = InnerMapPlague._doorFace(b, camera, T);
            if (!f || f.x < -ds || f.y < -ds || f.x > W + ds || f.y > H + ds) continue;
            const x = Math.round(f.x), y = Math.round(f.y);
            // (planks nailed across the doors themselves, and a bar at the step)
            const dy = Math.round(y - ds * 0.75);
            const u2 = Math.max(1, Math.round(u * 1.6));
            const barred = !CHURCH_TYPES.includes(b.type);
            items.push({ sortY: f.sortY + 0.5, zLayer: 2, draw: () => { if (!barred) PlagueArt.boards(ctx, x, dy, u2, 'x'); PlagueArt.boards(ctx, x, barred ? dy : y - u * 2, barred ? u2 : u, 'bar'); } });
        }
        // Stalls left bare in the famine, a cloth over the empty counter
        if (this._famineStalls.length) {
            for (const st of this._famineStalls) {
                const def = CustomObjects.getDef ? CustomObjects.getDef(st.defId || 'tp_stall') : null;
                const bd = def && def.bounds ? def.bounds : { minCol: 0, maxCol: 1, minRow: -1 };
                const w = (bd.maxCol - bd.minCol + 1) * ds;
                if (InnerMap._plagueStalls && InnerMap._plagueStalls.has(`${st.q},${st.r}`)) continue;
                const s0 = camera.worldToScreenFast((st.q + bd.minCol) * T, (st.r - 1) * T);
                const x = Math.round(s0.x), y = Math.round(s0.y);
                if (x < -w || y < -w || x > W + w || y > H + w) continue;
                items.push({ sortY: st.r * T + T - 0.2, zLayer: 2, draw: () => PlagueArt.stallCloth(ctx, x + u, y, w - 2 * u, ds * 1.05, u) });
            }
        }
        // The square's empty baskets and crates (every era: famine)
        for (const b of this._baskets) {
            const s0 = camera.worldToScreenFast(b.q * T + T / 2, b.r * T + T * 0.72);
            const x = Math.round(s0.x), y = Math.round(s0.y);
            if (x < -ds || y < -ds || x > W + ds || y > H + ds) continue;
            items.push({ sortY: b.r * T + T * 0.5, zLayer: 2, draw: () => _drawEmpty(ctx, x, y, ds / 21, b.k) });
        }
    },

    /**
     * Drawn over a figure after its body (innerMapLayers/entities.js): the
     * cross on a crusader's tabard, the preacher's cross-staff, the crier's
     * handbell. (sx, sy) the feet on screen; (cx, cy, cw, ch) the sprite's box.
     */
    drawOverlay(ctx, npc, cx, cy, cw, ch, dir, anim, now) {
        const tw = npc._tw;
        const u = Math.max(1, Math.round(cw / 34));
        if (tw && tw.kind === 'crusader') {
            ctx.fillStyle = TownWorld.config().holy.cross || '#b3262e';
            if (dir === InnerMapCharacters.DIR_LEFT || dir === InnerMapCharacters.DIR_RIGHT) {
                // side-on: the cross sewn on the shoulder of the surcoat, toward the back
                const side = dir === InnerMapCharacters.DIR_LEFT ? 1 : -1;
                const x = Math.round(cx + cw * (0.5 + side * 0.04)), y = Math.round(cy + ch * 0.6);
                ctx.fillRect(x - u, y - 2 * u, 2 * u, 5 * u);
                ctx.fillRect(x - 2 * u, y - u, 4 * u, u + 1);
                return;
            }
            const x = Math.round(cx + cw * 0.5), y = Math.round(cy + ch * 0.57);
            ctx.fillRect(x - u, y - 2 * u, 2 * u, 5 * u);
            ctx.fillRect(x - 2 * u, y - u, 4 * u, u + 1);
            return;
        }
        if (tw && tw.kind === 'preacher') {
            const side = dir === InnerMapCharacters.DIR_LEFT ? -1 : 1;
            const x = Math.round(cx + cw * (side > 0 ? 0.73 : 0.27));
            const top = Math.round(cy + ch * 0.18), foot = Math.round(cy + ch * 0.95);
            ctx.fillStyle = '#5a3b1e';
            ctx.fillRect(x - u, top, 2 * u, foot - top);
            ctx.fillRect(x - 4 * u, top + 3 * u, 8 * u, 2 * u);
            ctx.fillStyle = '#d9b44a';
            ctx.fillRect(x - u, top - 2 * u, 2 * u, 2 * u);
            return;
        }
        if (npc.activity && npc.activity.type === 'cry' && npc._crier) {
            // The handbell, rung over the head
            const swing = Math.sin(now * 9) * 0.5;
            const x = cx + cw * 0.74, y = cy + ch * 0.33;
            ctx.save();
            ctx.translate(Math.round(x), Math.round(y));
            ctx.rotate(swing);
            ctx.fillStyle = '#4a311b';
            ctx.fillRect(-u, -5 * u, 2 * u, 4 * u);
            ctx.fillStyle = '#d9b44a';
            ctx.beginPath();
            ctx.moveTo(-2 * u, -u); ctx.lineTo(2 * u, -u); ctx.lineTo(3 * u, 3 * u); ctx.lineTo(-3 * u, 3 * u); ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#8a6a22';
            ctx.fillRect(-u, 3 * u, 2 * u, u);
            ctx.restore();
        }
    },

    /** Does a figure want drawOverlay? (cheap: read per npc per frame) */
    wantsOverlay(npc) {
        return !!(npc && ((npc._tw && (npc._tw.kind === 'crusader' || npc._tw.kind === 'preacher')) || (npc._crier && npc.activity && npc.activity.type === 'cry')));
    },

    // ──────────── TALKING TO THEM ────────────

    /** Rows for the people under the click (from innerMapUI.js's People Here). */
    personItems(game, standing) {
        const out = [];
        for (const npc of standing || []) {
            const tw = npc._tw;
            if (npc._crier) {
                out.push({ type: 'action', action: 'tw_news', label: `Ask ${npc.name} for the News`, icon: '📯', desc: 'He cries again what the heralds have brought to the town', npc });
            }
            if (!tw) continue;
            if (tw.kind === 'preacher') {
                out.push({ type: 'action', action: 'tw_cross', label: 'Hear the Preacher Out', icon: '✝️', desc: 'The call to the holy war, and whether you may take the cross', npc });
            } else if (tw.kind === 'inquisitor' || tw.kind === 'clerk') {
                out.push({ type: 'action', action: 'tw_inq', label: 'Before the Holy Office', icon: '⚖️', desc: 'The inquisitor sitting here: host him, bribe him, hinder the hearing', npc });
            } else if (tw.kind === 'messenger') {
                out.push({ type: 'action', action: 'tw_letter', label: 'Take the Letter', icon: '✉️', desc: 'Read what has come for you', npc });
            } else if (tw.kind === 'petitioner') {
                out.push({ type: 'action', action: 'tw_petition', label: 'Hear the Petitioner', icon: '📜', desc: 'The petitions waiting on your judgement', npc });
            } else if (tw.kind === 'beggar_up' || tw.kind === 'beggar') {
                const can = _num(game.player && game.player.gold) >= 1;
                out.push({ type: can ? 'action' : 'disabled', action: 'tw_alms', label: 'Give a Coin', icon: '🪙', desc: can ? 'One gold for bread: it goes into the town\'s market' : 'Your purse is empty', npc });
            } else if (tw.kind === 'soldier' || tw.kind === 'garrison' || tw.kind === 'muster' || tw.kind === 'wounded' || tw.kind === 'crusader') {
                out.push({ type: 'action', action: 'tw_ask', label: `Ask the ${tw.kind === 'crusader' ? 'Crusader' : tw.kind === 'wounded' ? 'Wounded Man' : 'Soldier'} the News`, icon: '💬', desc: 'What the men say of the war', npc });
            }
        }
        return out;
    },

    /** Run tw_*. Returns true when it was ours. */
    handle(game, item) {
        if (!item || !/^tw_/.test(item.action || '')) return false;
        const npc = item.npc;
        const v = this._view || {};
        const tokens = this._tokens(game, v);
        const done = () => { if (npc && npc._tw) npc._tw.done = true; };
        switch (item.action) {
            case 'tw_news': {
                const news = (v.news || []).map(n => n.text);
                if (npc) this._bark(npc, news[0] || 'All is quiet, friend. No news cried this week.', 5);
                if (typeof game.ui.showCustomPanel === 'function') {
                    const rows = news.length ? news.map(t => ({ icon: '📯', name: esc(t), desc: '' })) : [{ icon: '🕊️', name: 'No great news has come to the town these days.', desc: '' }];
                    game.ui.showCustomPanel(`📯 The Crier of ${esc((InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement || {}).name || 'the Town')}`,
                        lede('<i>“Hear ye! Hear ye!”</i> He rings his bell and cries it all again for you.') + rowList(rows, 'The news cried here'));
                }
                break;
            }
            case 'tw_cross':
                if (npc) this._bark(npc, TownWorld.line('preacher', `${Math.floor(this._clock)}`, tokens), 5);
                ActionMenu.showChurch(game);
                break;
            case 'tw_inq':
                if (npc) this._bark(npc, TownWorld.line(npc._tw.kind === 'clerk' ? 'clerk' : 'inquisitor', `${Math.floor(this._clock)}`, tokens), 4);
                ActionMenu.showChurch(game);
                break;
            case 'tw_letter':
                done();
                ActionMenu.showLetters(game);
                break;
            case 'tw_petition': {
                done();
                const t = game.world.getTile(game.player.q, game.player.r);
                ActionMenu.showCourtPanel(game, t);
                break;
            }
            case 'tw_alms': {
                const p = game.player;
                if (_num(p.gold) < 1) break;
                p.gold = Math.round((_num(p.gold) - 1) * 100) / 100;
                // (the coin is spent on bread: into the town's market purse)
                const s = InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement;
                if (s) Economy.payTown(s, 1);
                if (npc) this._bark(npc, 'Bless you! Bless you!', 3);
                done();
                if (game.ui.updateStats) game.ui.updateStats(p, game.world);
                break;
            }
            case 'tw_ask': {
                const kind = npc && npc._tw ? npc._tw.kind : 'soldier';
                const pool = kind === 'wounded' ? 'wounded' : kind === 'crusader' ? 'crusader' : kind === 'muster' ? 'muster' : 'billet';
                if (npc) this._bark(npc, TownWorld.line(pool, `${npc._tw.key}|${Math.floor(this._clock)}`, tokens), 5);
                break;
            }
            default: break;
        }
        return true;
    },
};
