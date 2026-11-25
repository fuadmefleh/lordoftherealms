// InnerMapPort — the harbour and the river at work on the street map: where
// things stand, worked out once per map from its cells, and who is where at
// this hour (drawn by ui/innerMapLayers/portLife.js; the state is
// systems/ports.js, systems/barges.js and world/ferries.js).
//
//   The slip     a strip of open shore near the pier: your ship building
//                here (or the town's own hull) at her stage — keel, frames,
//                planking, deck, masts (Ports.slipAt)
//   The beach    across the pier from it: a ship of yours careened, heeled
//                over on her side with the shores propping her
//   The quay     the pier's foot: the harbourmaster at his post, crates
//                stacked by the cargo moved (Ports.dockWork; more while a hold
//                of yours is being loaded or unloaded before your eyes),
//                dockers carrying them between the pier and the warehouses
//                while ships are in, fish baskets in the afternoon
//   The boats    the fishing boats (Ports.fleet) moored by the pier, rowed
//                out at dawn to the edge of the map, back in the afternoon;
//                kept in by a storm or the ice
//   The river    on a river map: a fisherman's punt or two by day; a barge
//                (Barges) going through this hex, poled along the river's
//                course; the ferry (Ferries.at) crossing on its rope at the
//                hours of its timetable
//
// Cosmetic: nothing here changes the game. Places by a hash of the hex (no
// RNG drawn); positions from the hour (DayClock).

import { InnerMap } from '../world/innerMap.js';
import { Hex } from '../core/hex.js';
import { Ports } from '../systems/ports.js';
import { Barges } from '../systems/barges.js';
import { Ships } from '../systems/ships.js';
import { Ferries } from '../world/ferries.js';
import { DayClock } from './game/dayClock.js';
import { InnerMapRiverDrift } from './innerMapRiverDrift.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { Townsfolk } from '../systems/townsfolk.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

function _h(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
}

const _lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
const _smooth = (f) => f * f * (3 - 2 * f);

export const InnerMapPort = {
    _scene: null,
    _sceneTiles: null,
    _sceneHex: null,
    /** What is drawn this frame: { slip, careened, boats, dockers, crates, baskets, master, punts, barges, ferry } */
    view: null,
    _cargoSeen: null,
    _burstUntil: 0,
    // (the systems' answers, asked again each quarter hour of the game's clock — not every frame)
    _memoKey: null,
    _memoBox: null,

    _memo(name, fn) {
        if (!(name in this._memoBox)) this._memoBox[name] = fn();
        return this._memoBox[name];
    },

    _hex() {
        const at = InnerMap.currentWorldTile;
        return at && Number.isFinite(at.q) ? { q: at.q, r: at.r } : null;
    },

    // ── Where things stand (once per map) ──

    _cell(tiles, q, r) {
        return tiles[r] && tiles[r][q];
    },

    _dry(t) {
        if (!t || t._wet || t._sea || t._pier || t._deck || t._bridge) return false;
        if (t.building || t.customBuilding || t.customBuildingPart || t._lot || t.customObject || t.customObjectPart) return false;
        return !(t.subTerrain && t.subTerrain.passable === false);
    },

    _seaCell(t) {
        return !!(t && t._sea && !t._pier && !t._deck);
    },

    /** The harbour's places on this map, from its cells. */
    scene(tiles) {
        if (!tiles || !tiles.length) return null;
        if (this._sceneTiles === tiles) return this._scene;
        this._sceneTiles = tiles;
        const H = tiles.length, W = tiles[0].length;
        let tip = null, side = null;
        const pier = [];
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                const t = tiles[r][q];
                if (!t) continue;
                if (t._pierTip) { tip = { q, r }; side = t._pierTip; }
                if (t._pier) pier.push({ q, r });
            }
        }
        const out = { W, H, tip: null, base: null, side: null, slip: null, beach: null, post: null, store: null, moorings: [], sea: null };
        if (tip && pier.length && DIRS[side]) {
            const [dx, dy] = DIRS[side];
            // the pier's foot: its cell furthest back from the tip along its line
            let base = tip, bestD = -1;
            for (const p of pier) {
                const d = (tip.q - p.q) * dx + (tip.r - p.r) * dy;
                const off = Math.abs((p.q - tip.q) * dy) + Math.abs((p.r - tip.r) * dx);
                if (off === 0 && d > bestD) { bestD = d; base = p; }
            }
            out.tip = tip; out.base = base; out.side = side;
            // the harbourmaster's post: dry ground at the pier's foot, a step to the side
            const px = -dy, py = dx; // across the pier
            const land = { q: base.q - dx, r: base.r - dy };
            for (const k of [2, -2, 3, -3, 1, -1]) {
                const c = { q: land.q + px * k, r: land.r + py * k };
                if (this._dry(this._cell(tiles, c.q, c.r))) { out.post = c; break; }
            }
            // where the crates go: inland from the foot, the first dry cell some way up
            for (let k = 4; k <= 12; k++) {
                const c = { q: base.q - dx * k, r: base.r - dy * k };
                if (this._dry(this._cell(tiles, c.q, c.r))) { out.store = c; if (k >= 6) break; }
            }
            if (!out.store) out.store = land;
            // the boats' moorings: open water beside the pier
            const len = Math.max(1, bestD);
            for (let i = 2; i < len && out.moorings.length < 6; i += 3) {
                for (const k of [3, -3]) {
                    const c = { q: tip.q - dx * i + px * k, r: tip.r - dy * i + py * k };
                    if (this._seaCell(this._cell(tiles, c.q, c.r))) out.moorings.push(c);
                }
            }
            // far out: where the boats go to fish (toward the map's edge)
            let far = { ...tip };
            for (let k = 1; k < 60; k++) {
                const c = { q: tip.q + dx * k, r: tip.r + dy * k };
                if (c.q < 3 || c.r < 3 || c.q > W - 4 || c.r > H - 4) break;
                if (this._seaCell(this._cell(tiles, c.q, c.r))) far = c;
            }
            out.sea = far;
            // the slip and the careening beach: open shore along the water, either side of the pier
            const shore = (sign) => {
                for (let k = 9; k <= 30; k++) {
                    const c = { q: base.q + px * k * sign, r: base.r + py * k * sign };
                    // walk back from the water to the first dry cell of the shore here
                    for (let j = -3; j <= 6; j++) {
                        const x = c.q - dx * j, y = c.r - dy * j;
                        const t = this._cell(tiles, x, y);
                        const wet = this._cell(tiles, x + dx, y + dy);
                        if (!this._dry(t) || !(wet && (wet._sea || wet._wet))) continue;
                        // room for a hull: dry along the shore and a little inland
                        let ok = true;
                        for (let a = -3; a <= 3 && ok; a++) {
                            for (let b = 0; b <= 2 && ok; b++) {
                                if (!this._dry(this._cell(tiles, x + px * a - dx * b, y + py * a - dy * b))) ok = false;
                            }
                        }
                        if (ok) return { q: x, r: y };
                    }
                }
                return null;
            };
            const flip = _h(`slip:${tip.q},${tip.r}`) < 0.5 ? 1 : -1;
            out.slip = shore(flip);
            out.beach = shore(-flip);
            out.along = { x: px, y: py };
            out.out = { x: dx, y: dy };
        }
        this._scene = out;
        return out;
    },

    // ── Who is where this hour ──

    update(game) {
        this.view = null;
        if (!game || !game.world || !InnerMap.active || InnerMap._insideBuilding || InnerMap._underwater) return;
        const hex = this._hex();
        if (!hex) return;
        const world = game.world, player = game.player;
        const tiles = InnerMap.tiles;
        if (this._sceneHex !== `${hex.q},${hex.r}` || this._sceneTiles !== tiles) {
            this._sceneHex = `${hex.q},${hex.r}`;
            this._cargoSeen = null;
        }
        const hour = (() => { try { return DayClock.now(); } catch (e) { return 12; } })();
        const day = _num(world.day);
        const mk = `${hex.q},${hex.r}:${day}:${Math.floor(hour * 4)}`;
        if (this._memoKey !== mk) { this._memoKey = mk; this._memoBox = {}; }
        const view = { hour, slip: [], careened: [], boats: [], dockers: [], crates: 0, baskets: 0, master: null, punts: [], barges: [], ferry: null };
        const s = this._memo('port', () => Ports.portAt(world, hex.q, hex.r));
        const sc = s ? this.scene(tiles) : null;
        if (s && sc && sc.tip) this._harbour(world, player, s, sc, hex, hour, day, view);
        this._river(world, hex, hour, day, view);
        this.view = view;
    },

    /**
     * The harbourmaster as one of the street's own people (InnerMap.npcs): the
     * townsperson Ports.master names — already walking the town, or brought
     * out when the roster left him off the map — with the harbourmaster's
     * look, keeping his post at the pier's foot by day (townLife's _doorPost)
     * and going home at night. Clicking him talks to him (ui/npcDialog/harbour.js:
     * dues, berths, ships, hands, the ferry). → the NPC, or null
     */
    _keepMaster(world, s, sc, hex, m, onDuty) {
        const npcs = InnerMap.npcs;
        if (!Array.isArray(npcs) || !sc.post || !m) return null;
        const pid = m.person ? m.person.id : null;
        const mine = (n) => n && (pid != null ? (n._person && n._person.id === pid) : n._harbourmasterOf === `${hex.q},${hex.r}`);
        // (a new harbourmaster — the old one dead or gone — hands the post over)
        for (const n of npcs) {
            if (n && n.harbourmaster && !mine(n)) { n.harbourmaster = false; n._doorPost = null; n.preset = null; n._hmLook = false; }
        }
        const dead = (n) => n.state === 'dead' || n.state === 'gone';
        let npc = npcs.find(n => mine(n) && !dead(n)) || null;
        if (!npc) {
            if (npcs.some(n => mine(n))) return null; // (lying dead in the street: no one keeps the post today)
            // A hash-seeded rng (nothing drawn from the game's RNG for a picture's sake)
            let seed = Math.floor(_h(`hm:${hex.q},${hex.r}:${pid}`) * 4294967295) || 1;
            const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
            const id = npcs.reduce((x, n) => Math.max(x, n && Number.isFinite(n.id) ? n.id : -1), -1) + 1;
            npc = typeof InnerMap._makeNpc === 'function' ? InnerMap._makeNpc('merchant', id, rng) : null;
            if (!npc) return null;
            if (m.person && s.folk) Townsfolk.dress(npc, m.person, s.folk, world);
            else { npc.name = m.name.split(' ')[0]; npc.fullName = m.name; npc.gender = 'male'; npc._harbourmasterOf = `${hex.q},${hex.r}`; }
            if (!InnerMap.NPC_TYPES || !InnerMap.NPC_TYPES[npc.type]) npc.type = 'merchant';
            npc.q = npc.prevQ = npc.targetQ = sc.post.q;
            npc.r = npc.prevR = npc.targetR = sc.post.r;
            npc.path = null;
            npc.state = 'idle';
            npc.facing = 2;
            npc.idleTimer = 20 + rng() * 20;
            npcs.push(npc);
        } else if (!npc.harbourmaster && onDuty && npc.state !== 'dialog' && !npc._fight && !npc._carried && !npc._downed && npc.state !== 'unconscious') {
            // (first seen at this hour: already at his post, not walking there from across town)
            npc.q = npc.prevQ = npc.targetQ = sc.post.q;
            npc.r = npc.prevR = npc.targetR = sc.post.r;
            npc.path = null;
            npc.moveProgress = 0;
            npc.state = 'idle';
            npc.currentBuilding = null;
            npc.facing = 2;
            npc.idleTimer = 20;
        }
        // the harbourmaster's coat and hat (data/innerMapRenderer.json npcAppearanceMap.harbourmaster)
        if (!npc._hmLook) {
            try {
                const look = InnerMapCharacters.isReady() ? InnerMapCharacters.getPresetForNPC('harbourmaster', npc.id, npc.gender) : null;
                if (look) { npc.preset = look; npc._hmLook = true; }
            } catch (e) { /* (the sprites not loaded yet: asked again next frame) */ }
        }
        npc.harbourmaster = true;
        npc.roleTitle = npc.gender === 'female' ? 'harbourmistress' : 'harbourmaster';
        npc._doorPost = onDuty ? { q: sc.post.q, r: sc.post.r, face: 2 } : null;
        return npc;
    },

    _harbour(world, player, s, sc, hex, hour, day, view) {
        const T = { x: sc.tip.q + 0.5, y: sc.tip.r + 0.5 };
        const B = { x: sc.base.q + 0.5, y: sc.base.r + 0.5 };
        // ── The slip ──
        if (sc.slip) {
            for (const x of this._memo('slip', () => Ports.slipAt(world, player, hex.q, hex.r, day)).slice(0, 1)) {
                view.slip.push({ x: sc.slip.q + 0.5, y: sc.slip.r + 0.5, along: sc.along, out: sc.out, index: x.index, within: x.within, progress: x.progress, name: x.name, waiting: x.waiting, typeId: x.typeId, working: hour >= 6 && hour < 18 && !x.waiting });
            }
        }
        // ── The careening beach ──
        const mine = (player && player.ships ? player.ships : []).filter(x => x && x.q === hex.q && x.r === hex.r);
        if (sc.beach) {
            for (const ship of mine.filter(x => x.status === 'careened').slice(0, 1)) {
                view.careened.push({ x: sc.beach.q + 0.5, y: sc.beach.r + 0.5, along: sc.along, out: sc.out, name: ship.name, dock: ship.careen && ship.careen.kind === 'dock', working: hour >= 6 && hour < 18, typeId: ship.typeId });
            }
        }
        // ── The harbourmaster ──
        if (sc.post) {
            const m = this._memo('master', () => Ports.master(world, s, day));
            const onDuty = hour >= 6 && hour < 20;
            const npc = this._keepMaster(world, s, sc, hex, m, onDuty);
            if (onDuty) view.master = { x: sc.post.q + 0.5, y: sc.post.r + 0.5, name: m ? m.name : 'the harbourmaster', id: m ? m.id : `hm${hex.q},${hex.r}`, gender: m && m.person ? m.person.gender : null, npc };
        }
        // ── The quay: crates, dockers ──
        const work = this._memo('work', () => Ports.dockWork(world, player, hex.q, hex.r)) || { yours: 0, trade: 0, ships: 0 };
        // (a hold of yours loaded or unloaded before your eyes: a burst of work on the quay)
        const held = mine.filter(x => x.status === 'docked').reduce((a, x) => a + Ships.getCargoUsed(x), 0);
        const now = performance.now() / 1000;
        if (this._cargoSeen != null && held !== this._cargoSeen) {
            Ports.noteCargo(world, hex.q, hex.r, Math.abs(held - this._cargoSeen));
            this._burstUntil = now + 40;
        }
        this._cargoSeen = held;
        const shipsIn = work.ships + 1 + (s.type === 'city' || s.type === 'capital' ? 1 : 0);
        view.crates = Math.min(9, Math.round(work.yours / 4 + work.trade / 25));
        const day0 = hour >= 6 && hour < 19;
        const n = !day0 ? 0 : Math.min(7, Math.max(work.trade > 0 || work.yours > 0 ? 2 : 1, Math.round(shipsIn + work.trade / 30) + (now < this._burstUntil ? 3 : 0)));
        const store = { x: sc.store.q + 0.5, y: sc.store.r + 0.5 };
        for (let i = 0; i < n; i++) {
            // each docker on his round: from a ship's side on the pier to the store and back
            const ph = (now / (9 + i * 1.7) + _h(`dk${i}`)) % 1;
            const end = _lerp(B, T, 0.35 + 0.5 * _h(`dkp${i}`));
            const go = ph < 0.5;
            const f = _smooth(go ? ph * 2 : (1 - ph) * 2);
            const p = _lerp(store, end, f);
            // (half carry ashore — unloading — half carry out to the ships)
            const ashore = i % 2 === 0;
            view.dockers.push({ x: p.x + sc.along.x * ((i % 3) - 1) * 0.6, y: p.y + sc.along.y * ((i % 3) - 1) * 0.6, carry: ashore ? !go : go, i, walk: now * 6 + i,
                // (which way he faces: out along the pier, or back to the store)
                fx: go ? end.x - store.x : store.x - end.x, fy: go ? end.y - store.y : store.y - end.y, seed: Math.floor(_h(`dks${hex.q},${hex.r},${i}`) * 99991) });
        }
        // ── The fishing boats ──
        const fl = this._memo('fleet', () => Ports.fleet(world, hex.q, hex.r, day));
        if (fl && fl.boats > 0 && sc.sea) {
            const F = Ports.config().fishing;
            const sea = { x: sc.sea.q + 0.5, y: sc.sea.r + 0.5 };
            for (let i = 0; i < Math.min(fl.boats, Math.max(1, sc.moorings.length)); i++) {
                const m = sc.moorings[i] ? { x: sc.moorings[i].q + 0.5, y: sc.moorings[i].r + 0.5 } : _lerp(B, T, 0.5);
                const k = fl.boats > 1 ? i / (fl.boats - 1) : 0.5;
                const leave = F.out[0] + (F.out[1] - F.out[0]) * k;
                const back = F.back[0] + (F.back[1] - F.back[0]) * (1 - k);
                // fishing ground: spread along the far water
                const g = { x: sea.x + sc.along.x * (i - fl.boats / 2) * 3, y: sea.y + sc.along.y * (i - fl.boats / 2) * 3 };
                const mouth = { x: T.x + sc.out.x * 2 + sc.along.x * (i % 2 ? 2 : -2), y: T.y + sc.out.y * 2 + sc.along.y * (i % 2 ? 2 : -2) };
                let pos = m, heading = 0, sail = false, fish = false;
                if (!fl.kept && hour >= leave && hour < back + 1.2) {
                    if (hour < leave + 1) {
                        const f = _smooth(hour - leave);
                        pos = f < 0.3 ? _lerp(m, mouth, f / 0.3) : _lerp(mouth, g, (f - 0.3) / 0.7);
                        heading = 1; sail = f > 0.3;
                    } else if (hour < back) {
                        pos = { x: g.x + Math.sin(hour * 3 + i) * 0.8, y: g.y + Math.cos(hour * 2.3 + i) * 0.5 };
                        fish = true;
                    } else {
                        const f = _smooth((hour - back) / 1.2);
                        pos = f < 0.7 ? _lerp(g, mouth, f / 0.7) : _lerp(mouth, m, (f - 0.7) / 0.3);
                        heading = -1; sail = f < 0.7;
                    }
                }
                view.boats.push({ x: pos.x, y: pos.y, dir: sc.out, heading, sail, fish, i });
            }
            // the catch on the quay in the afternoon
            if (hour >= F.back[0] && hour < 20 && !fl.kept) view.baskets = Math.min(6, fl.boats + 1);
            view.kept = fl.kept;
        }
        view.quay = { x: B.x - sc.out.x * 1.5, y: B.y - sc.out.y * 1.5, along: sc.along };
    },

    // ── The river: punts, barges, the ferry ──

    _river(world, hex, hour, day, view) {
        const course = InnerMapRiverDrift.course ? InnerMapRiverDrift.course(InnerMap.tiles) : null;
        const run = course && course.runs && course.runs[0];
        if (!run || !(run.hi > run.lo + 6)) return;
        const at = (k) => {
            const p = InnerMapRiverDrift._at(run, k);
            return { x: p[0] + 0.5, y: p[1] + 0.5, fx: p[2], fy: p[3] };
        };
        const len = run.hi - run.lo;
        const wt = world.getTile(hex.q, hex.r);
        // ── A fisherman's punt or two, by day ──
        if (hour >= 6 && hour < 18 && wt && wt.hasRiver) {
            const n = wt.settlement ? 2 : (_h(`punt:${hex.q},${hex.r},${day}`) < 0.5 ? 1 : 0);
            for (let i = 0; i < n; i++) {
                const k = run.lo + len * (0.2 + 0.6 * _h(`pk${i}:${hex.q},${hex.r}`));
                const p = at(k);
                view.punts.push({ x: p.x + Math.sin(hour + i) * 0.2, y: p.y, fx: p.fx, fy: p.fy, i });
            }
        }
        // ── The barges going through this hex ──
        const t = day + hour / 24;
        for (const b of Barges.list(world)) {
            const pos = Barges.positionAt(b, t);
            if (!pos || pos.q !== hex.q || pos.r !== hex.r) continue;
            // downstream when the next hex is the one this hex's river runs into
            let down = true;
            if (wt && Number.isInteger(wt.riverDir)) {
                const n = Hex.neighbors(hex.q, hex.r)[wt.riverDir];
                const W = world.width || 0;
                down = !!n && (W ? Hex.wrapQ(n.q, W) === Hex.wrapQ(pos.nq, W) : n.q === pos.nq) && n.r === pos.nr;
            }
            const k = run.lo + len * (down ? pos.f : 1 - pos.f);
            const p = at(k);
            view.barges.push({ x: p.x, y: p.y, fx: down ? p.fx : -p.fx, fy: down ? p.fy : -p.fy, good: b.good, qty: b.qty, to: b.to.name });
            if (view.barges.length >= 2) break;
        }
        // ── The ferry across ──
        const ferry = this._memo('ferry', () => Ferries.at(world, hex.q, hex.r));
        if (ferry) {
            const mid = at(run.lo + len * 0.5);
            const bank = (sign) => {
                // perpendicular to the flow, out to the first dry cell
                const nx = -mid.fy * sign, ny = mid.fx * sign;
                for (let d = 1; d < 14; d++) {
                    const x = Math.floor(mid.x + nx * d), y = Math.floor(mid.y + ny * d);
                    const c = this._cell(InnerMap.tiles, x, y);
                    if (c && !c._wet) return { x: mid.x + nx * (d - 0.5), y: mid.y + ny * (d - 0.5) };
                }
                return { x: mid.x + nx * 3, y: mid.y + ny * 3 };
            };
            const a = bank(1), b = bank(-1);
            // each sailing: over in the first half hour, back in the second
            let f = 0;
            for (const s of ferry.hours) {
                if (hour >= s && hour < s + 0.5) { f = _smooth((hour - s) / 0.5); break; }
                if (hour >= s + 0.5 && hour < s + 1) { f = 1 - _smooth((hour - s - 0.5) / 0.5); break; }
            }
            const next = Ferries.nextSailing(ferry, hour);
            view.ferry = { a, b, pos: _lerp(a, b, f), fx: mid.fx, fy: mid.fy, ferryman: ferry.ferryman, fare: ferry.fare, next: next.tomorrow ? null : next.hour };
        }
    },
};
