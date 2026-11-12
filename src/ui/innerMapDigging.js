// ============================================
// INNER MAP DIGGING — holes, filled earth and graves on the street map
// ============================================
// Digging changes the ground itself: the tile turns to bare earth (the grass
// is stripped and re-edged), a hole is dug into it (impassable, the spoil
// heaped beside it), and it can be filled in again or made a grave.
//
//   dig    — any bare outdoor ground: a hole (and sometimes something in it)
//   fill   — a hole: turned earth again, walkable
//   bury   — a hole with a body in it, next to it or carried: a burial mound,
//            plain earth with no name on it, settling into the ground
//   mark   — a burial mound: raise a grave marker (one carried, or a cross
//            carved from wood carried) and it is a named grave
//   exhume — a grave or mound: dug OPEN — the earth heaped beside it, the body
//            still lying in it, its grave goods out, the marker left standing.
//            An open grave is still the grave (never a hole to dig again):
//            take the body out, lay one in, fill it in again (its earth then
//            shows disturbed a while), or pull up its marker (only ever on
//            purpose). Seen at it, the street takes it for desecration.
//   stash  — a hole (or an open grave): put things from the packs in it; fill
//            it in and they are buried (a cache, world/burials.js, saved), dug
//            up again by whoever digs there — you, someone who watched you, or
//            now and then someone digging by chance. In with a body: grave goods.
//
// No digging into a grave in any state, the churchyard, a marker's tile, a
// road, a bridge or pier, a doorway or the tile in front of one, under anyone
// standing there. A hole left open caves in after a while; turned earth fades.
//
// Burials are kept on the world (world/burials.js, world.burials[hex], saved),
// the tile's _dug the record itself; world/innerMap/graves.js lays them.
//
// The work takes time at the spot (InnerMapDigging.update, from the game
// loop): the player walks beside the tile, faces it and swings; walking off
// stops it. Tuning and wording live in data/digging.json.
//
// What lies on a tile is kept on the tile (tile._dug = { kind, name, day }),
// so it lasts as long as the town's street map does. Ground features are
// drawn under the sprites (renderGround, from the depth-sorted pass).

import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { drawTilledSoil } from './tilledSoil.js';
import { Endurance } from '../player/endurance.js';
import { Carrying } from '../systems/carrying.js';
import { InnerMapDowned } from './innerMapDowned.js';
import { Burials, DUG_GROUND } from '../world/burials.js';
import { GraveArt } from '../world/graveArt.js';
import { GraveBook } from '../world/graveBook.js';
import { CustomObjects } from '../world/customObjects.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { SocialSkills } from '../systems/socialSkills.js';
import { Arms } from '../systems/arms.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapScavengers } from './innerMapScavengers.js';
import { rowList, lede, esc, BTN_PLAIN } from './actionMenu/uiKit.js';

const DEFAULTS = {
    seconds: { dig: 5, fill: 3, bury: 4, exhume: 5, refill: 3 },
    toolSpeed: 0.6,
    tools: ['tools'],
    needs: { energy: -6, hygiene: -6 },
    carrySpeed: 0.6,
    finds: [],
    text: {},
};

const GROUND = DUG_GROUND;

const VERB = { dig: 'Digging', fill: 'Filling in', bury: 'Burying', exhume: 'Digging up', mark: 'Raising the marker', refill: 'Filling in the grave' };

/** A good's name and icon, for the stash picker and the finds. */
function _goodOf(itemId) {
    if (itemId === 'gold') return { name: 'Gold', icon: '💰' };
    if (Arms.isArms(itemId)) return { name: Arms.nameOf(itemId), icon: Arms.iconOf(itemId) || '🗡️' };
    const g = (PlayerEconomy.GOODS || {})[String(itemId).toUpperCase()];
    return {
        name: (g && g.name) || String(itemId).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        icon: (g && g.icon) || '📦',
    };
}
const _nameOf = id => _goodOf(id).name.toLowerCase();

function _cheb(aq, ar, bq, br) {
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br));
}

function _fill(line, vars) {
    return String(line || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

const _cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const InnerMapDigging = {
    // { kind, q, r, t, total, corpse, then, game }
    _job: null,
    _baseSpeed: null,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.digging;
        const c = { ...DEFAULTS, ...(src || {}) };
        c.seconds = { ...DEFAULTS.seconds, ...((src && src.seconds) || {}) };
        c.text = { ...DEFAULTS.text, ...((src && src.text) || {}) };
        return c;
    },

    /** What has been dug at a tile: { kind:'hole'|'filled'|'grave', name?, day } or null. */
    dugAt(q, r) {
        const t = InnerMap.getTile(q, r);
        return (t && t._dug) || null;
    },

    /** Bare outdoor ground a hole can go in (not a road, a doorway, a building, a grave or a thing). */
    canDig(tile) {
        if (!tile || tile._isInterior || InnerMap._insideBuilding) return false;
        if (tile._dug && tile._dug.kind !== 'filled') return false;
        // A grave in any state — the churchyard (its plots, paths and rail), a burial ground's plot,
        // a burial of the player's however settled, the marker at its head — is dug only by its own
        // grave actions (ui/innerMapGraves.js, the burial menu), never as a new hole
        if (tile._grave || tile._plotRef || tile._plotHead || tile._burialOf) return false;
        if (InnerMap.burialAt && InnerMap.burialAt(tile.q, tile.r)) return false;
        if (!tile.subTerrain || !tile.subTerrain.passable || tile.subTerrain.id === 'grave') return false;
        // (no hole or grave in the shallows, a ford, a beach's wash; nor through a bridge, a pier or a deck)
        if (tile._wet || tile._sea || tile._shallow || tile._ford || /water/.test(tile.subTerrain.id || '')) return false;
        if (tile._bridge || tile._pier || tile._deck) return false;
        if (tile.isRoad || tile._doorMarker || tile.building || tile.customBuilding || tile.customBuildingPart) return false;
        if (tile.customObject || tile.customObjectPart || tile.groundItem) return false;
        // Not across a doorway's step: the tile in front of a door stays clear
        for (const [dq, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const n = InnerMap.getTile(tile.q + dq, tile.r + dr);
            if (n && n._doorMarker) return false;
        }
        if (InnerMap.playerInnerQ === tile.q && InnerMap.playerInnerR === tile.r && InnerMap._playerWalking) return false;
        // Not under anyone's feet
        if ((InnerMap.npcs || []).some(n => n && n.q === tile.q && n.r === tile.r && n.state !== 'gone' && n.state !== 'inside_building')) return false;
        return true;
    },

    /** A hole on or next to (q, r), nearest first. */
    holeNear(q, r) {
        let best = null;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dq = -1; dq <= 1; dq++) {
                const d = this.dugAt(q + dq, r + dr);
                if (d && d.kind === 'hole' && (!best || Math.abs(dq) + Math.abs(dr) < best.n)) best = { q: q + dq, r: r + dr, n: Math.abs(dq) + Math.abs(dr) };
            }
        }
        return best ? { q: best.q, r: best.r } : null;
    },

    /** The nearest diggable tile beside (q, r) (a grave dug next to a body). */
    diggableNear(q, r) {
        let best = null;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dq = -1; dq <= 1; dq++) {
                if (!dq && !dr) continue;
                const t = InnerMap.getTile(q + dq, r + dr);
                if (!this.canDig(t)) continue;
                if (t.q === InnerMap.playerInnerQ && t.r === InnerMap.playerInnerR) continue;
                const n = Math.abs(dq) + Math.abs(dr) + _cheb(t.q, t.r, InnerMap.playerInnerQ, InnerMap.playerInnerR) * 0.01;
                if (!best || n < best.n) best = { q: t.q, r: t.r, n };
            }
        }
        return best ? { q: best.q, r: best.r } : null;
    },

    /** Is the player at work? (for the swing animation) */
    isWorking() {
        return !!(this._job && this._job.t != null);
    },

    /** The tile being worked, for the player to face. */
    workTile() {
        return this._job ? { q: this._job.q, r: this._job.r } : null;
    },

    /**
     * Go and do some ground work at (q, r): walk beside it (never onto it),
     * then work there for the configured time.
     * @param {object} game
     * @param {'dig'|'fill'|'bury'|'exhume'} kind
     * @param {number} q
     * @param {number} r
     * @param {object} [opts] { corpse, then: { kind, corpse } }
     */
    start(game, kind, q, r, opts = {}) {
        this.cancel();
        if (InnerMapCombat._attackState) InnerMapCombat.cancelAttack();
        // (other ground work — tilling, sowing, harvesting (ui/innerMapFarming.js) — brings its own
        // time, label, needs and what to do when done: opts.seconds, opts.verb, opts.needs, opts.onDone;
        // opts.onTile: work on something lying on the ground (a carcass) may be done standing on it)
        const total = Number(opts.seconds) > 0 ? Number(opts.seconds) : this._seconds(game, kind);
        // (the map it is on: walking there and then leaving the map drops the work, never done on another)
        const job = { kind, q, r, t: null, total, corpse: opts.corpse || null, then: opts.then || null, game, onDone: opts.onDone || null, verb: opts.verb || null, needs: opts.needs || null, key: InnerMapCombat._mapKey() };
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const near = _cheb(pq, pr, q, r);
        if (near === 1 || (opts.onTile && near === 0 && !InnerMap._playerWalking)) {
            this._begin(job);
            return 'now';
        }
        // Stand beside the spot: the nearest open tile next to it
        let spot = null;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dq = -1; dq <= 1; dq++) {
                if (!dq && !dr) continue;
                const t = InnerMap.getTile(q + dq, r + dr);
                if (!t || !t.subTerrain || !t.subTerrain.passable || t.building || t.customObject || t.customObjectPart) continue;
                const n = _cheb(t.q, t.r, pq, pr) + (dq && dr ? 0.5 : 0);
                if (!spot || n < spot.n) spot = { q: t.q, r: t.r, n };
            }
        }
        if (!spot) return 'unreachable';
        InnerMap.cancelPlayerWalk();
        const walk = InnerMap.movePlayerTo(spot.q, spot.r);
        if (!walk || !walk.started) return 'unreachable';
        this._job = job;
        InnerMap._pendingAction = { q, r, run: () => { if (this._job === job && this._sameMap(job)) this._begin(job); } };
        return 'walking';
    },

    cancel() {
        this._job = null;
    },

    /** Is the player still on the map (and outdoors) where the work was set? */
    _sameMap(job) {
        return !!(job && InnerMap.active && !InnerMap._insideBuilding && job.key === InnerMapCombat._mapKey());
    },

    _seconds(game, kind) {
        const C = this.config();
        const base = Number(C.seconds[kind]) || 4;
        const inv = (game && game.player && game.player.inventory) || {};
        const tooled = (C.tools || []).some(id => (inv[id] || 0) > 0);
        return tooled ? base * (Number(C.toolSpeed) || 1) : base;
    },

    _begin(job) {
        job.t = 0;
        this._job = job;
        job.startQ = InnerMap.playerInnerQ;
        job.startR = InnerMap.playerInnerR;
    },

    /** Each frame, from the game loop. */
    update(deltaTime, game) {
        this._updateCarry(game);
        // Grave robbers at night, looters over the fallen (ui/innerMapScavengers.js)
        InnerMapScavengers.update(deltaTime, game || (this._job && this._job.game));
        const job = this._job;
        if (!job) return;
        // Left the map (or went indoors) on the way there or at the work: it is dropped
        if (!this._sameMap(job)) { this.cancel(); return; }
        if (job.t == null) return;
        // Walking away stops the work
        if (InnerMap._playerWalking || InnerMap.playerInnerQ !== job.startQ || InnerMap.playerInnerR !== job.startR) {
            this.cancel();
            return;
        }
        job.t += deltaTime;
        if (job.t < job.total) return;
        this._job = null;
        this._finish(job, game || job.game);
    },

    /** How far along the work is (0-1), for the progress ring. */
    progress() {
        const j = this._job;
        return j && j.t != null ? Math.min(1, j.t / j.total) : 0;
    },

    _note(game, title, body, kind = 'info') {
        if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
    },

    _finish(job, game) {
        const C = this.config();
        const tile = InnerMap.getTile(job.q, job.r);
        if (!tile) return;
        const day = (game && game.world && game.world.day) || 0;
        const player = game && game.player;
        if (typeof job.onDone === 'function') {
            if (player && typeof player.modifyNeed === 'function') {
                for (const [need, v] of Object.entries(job.needs || {})) {
                    // Hard work: the hardy tire less, and it builds Endurance (player/endurance.js)
                    if (need === 'energy' && v < 0) Endurance.labour(player, -v);
                    else player.modifyNeed(need, v);
                }
            }
            job.onDone(game, tile);
            return;
        }
        if (player && typeof player.modifyNeed === 'function') {
            for (const [need, v] of Object.entries(C.needs || {})) {
                if (need === 'energy' && v < 0) Endurance.labour(player, -v);
                else player.modifyNeed(need, v);
            }
        }
        const world = game && game.world;
        const hex = InnerMap._burialHex();
        if (job.kind === 'dig') {
            if (!this.canDig(tile)) { this._note(game, '⛏️ Not there', 'You can\'t dig there now.', 'warning'); return; }
            this.setGround(tile, 'hole', { day });
            // Something buried here before: it comes up into the hole (world/burials.js caches)
            const cache = Burials.digUpCache(world, hex, job.q, job.r);
            if (cache && cache.cache) {
                const { taken, left } = Burials.takeAll(cache.cache, player);
                if (!left) Burials.dropCache(world, hex, job.q, job.r);
                const got = Burials.isEmpty(taken) ? '' : ` You take ${Burials.describe(taken, _nameOf)}.`;
                const stays = left ? ` ${_cap(Burials.describe(left, _nameOf))} still lie${Object.keys(left.items || {}).length + (left.gold ? 1 : 0) === 1 ? 's' : ''} in the hole: your packs are full.` : '';
                this._note(game, '⛏️ Unearthed', `Your spade strikes what was buried here.${got}${stays}`, 'success');
                if (game && game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
            } else if (cache && cache.taken) {
                const by = cache.taken.by;
                const knew = (cache.seen || []).some(w => w.name === by);
                const T = C.text;
                this._note(game, '⛏️ Gone', _fill(T.cacheGone || 'The earth here has been dug over before you. Whatever was buried here is gone.', {}) + (knew ? ' ' + _fill(T.cacheGoneSeen || 'You remember {name} watching you bury it.', { name: by }) : ''), 'warning');
            } else {
                const found = this._rollFind(game);
                this._note(game, '⛏️ A hole', found || C.text.dig || 'You dig a hole.', found ? 'success' : 'info');
            }
            if (job.then && job.then.kind === 'bury' && job.then.corpse) {
                this.start(game, 'bury', job.q, job.r, { corpse: job.then.corpse });
            }
        } else if (job.kind === 'fill') {
            if (!tile._dug || tile._dug.kind !== 'hole') return;
            // A body lying in the hole is buried by filling it
            const body = InnerMapCombat.corpsesHere().find(c => c.q === job.q && c.r === job.r && c !== InnerMapCombat._carrying);
            if (body) { this._buryBody(game, tile, body, day); return; }
            // What was put in it is buried: a cache, on the world's record (and who saw it go in)
            const seen = this._watchers(job.q, job.r, player);
            const cache = Burials.closeCache(world, hex, job.q, job.r, day, seen.map(w => ({ id: StreetCrime.npcKey(w.npc), name: w.npc.name })));
            this.setGround(tile, 'filled', { day });
            if (cache) {
                const who = seen.length ? ' ' + _fill(C.text.cacheSeen || '{names} saw you do it.', { names: seen.slice(0, 3).map(w => w.npc.name).join(', ') }) : '';
                this._note(game, '⬛ Buried', _fill(C.text.cache || 'You bury {what} and fill the hole in over it.', { what: Burials.describe(cache, _nameOf) }) + who, seen.length ? 'warning' : 'info');
            } else {
                this._note(game, '⬛ Filled in', C.text.fill || 'You fill the hole in.');
            }
        } else if (job.kind === 'bury') {
            const dug = tile._dug;
            const intoGrave = dug && dug.kind === 'grave' && Burials.isOpen(dug) && !dug.body;
            if (!dug || (dug.kind !== 'hole' && !intoGrave)) return;
            const body = job.corpse && InnerMapCombat._corpses.includes(job.corpse) ? job.corpse : this._bodyIn(job.q, job.r);
            if (!body) { this._note(game, '🕳️ Nothing to bury', 'There is no body to lay in it.'); return; }
            if (intoGrave) this._reburyBody(game, tile, dug, body, day);
            else this._buryBody(game, tile, body, day);
        } else if (job.kind === 'exhume') {
            const g = tile._dug;
            if (!g || g.kind !== 'grave' || Burials.isOpen(g)) return;
            // Someone still breathing down there: dug out alive (ui/innerMapDowned.js)
            const live = InnerMapDowned.liveAt(job.q, job.r);
            if (live) { InnerMapDowned.rescue(game, live, null); return; }
            // Dug open (world/burials.js): the body lies in it, the grave goods come out, the marker stays
            const goods = Burials.openGrave(g, day, false);
            let got = '';
            if (goods) {
                const { taken, left } = Burials.takeAll(goods, player);
                if (left) g.goods = left;
                if (!Burials.isEmpty(taken)) got = ` You take what was buried with them: ${Burials.describe(taken, _nameOf)}.`;
                if (left) got += ' The rest lies in the grave: your packs are full.';
            }
            InnerMap.layBurial(job.q, job.r, g, day);
            const name = g.name || 'someone';
            this._note(game, '⛏️ Dug up', _fill(C.text.exhume || 'You dig down to {name}: the grave lies open.', { name }) + got, 'warning');
            this._desecrate(game, job.q, job.r, name);
            if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        } else if (job.kind === 'refill') {
            const g = tile._dug;
            if (!g || g.kind !== 'grave' || !Burials.isOpen(g)) return;
            this._refillGrave(game, tile, g, day);
        }
    },

    /** Fill an open grave of the player's in: intact again (disturbed), or — nothing left to it — only a hole filled. */
    _refillGrave(game, tile, g, day) {
        const world = game && game.world;
        const hex = InnerMap._burialHex();
        if (!g.body && !Burials.markerNow(g, day)) {
            // No one in it and nothing over it: only a hole filled in — over whatever was put in it (a cache)
            const goods = g.goods && !Burials.isEmpty(g.goods) ? Burials.contents(g.goods) : null;
            Burials.unbury(world, hex, tile.q, tile.r);
            InnerMap.clearBurialMarker(tile.q, tile.r);
            this.setGround(tile, 'filled', { day });
            if (goods) {
                const c = Burials.openCache(world, hex, tile.q, tile.r, day);
                c.gold = (c.gold || 0) + goods.gold;
                for (const [id, n] of Object.entries(goods.items)) c.items[id] = (c.items[id] || 0) + n;
                const seen = this._watchers(tile.q, tile.r, game.player);
                Burials.closeCache(world, hex, tile.q, tile.r, day, seen.map(w => ({ id: StreetCrime.npcKey(w.npc), name: w.npc.name })));
            }
            this._note(game, '⬛ Filled in', goods ? `You fill the empty grave in over ${Burials.describe(goods, _nameOf)}.` : 'You fill the empty grave in. There is nothing to show anyone lay there.');
            return;
        }
        Burials.refillGrave(g, day);
        InnerMap.layBurial(tile.q, tile.r, g, day);
        this._note(game, '⚰️ Filled in', g.body ? `You shovel the earth back over ${g.name || 'them'}. It will show disturbed for a while.` : 'You fill the empty grave in under its marker.');
    },

    /** Lay a body in an open, empty grave and fill it in over them. */
    _reburyBody(game, tile, g, body, day) {
        if (InnerMapCombat._carrying === body) this.drop();
        InnerMapCombat.removeBody(body);
        // (in with what was put in the grave already: its goods stay with it)
        Burials.layBody(g, body, day);
        Burials.refillGrave(g, day);
        InnerMap.layBurial(tile.q, tile.r, g, day);
        this._note(game, '⚰️ Buried', _fill(this.config().text.bury || 'You bury {name}.', { name: body.name }), 'info');
    },

    /** Who watches the spot (q, r) from the street (StreetCrime's sight, cut by Stealth): [{ npc, seen }]. */
    _watchers(q, r, player = null) {
        if (!InnerMap.active || InnerMap._insideBuilding) return [];
        let cut = 0;
        try { cut = player ? SocialSkills.perk(player, 'stealth', 'sight') || 0 : 0; } catch { cut = 0; }
        return StreetCrime.selectWitnesses(InnerMap.npcs || [], { q, r, indoors: false, sightCut: cut }, null)
            .filter(w => w.seen && w.npc && !w.npc._asleep && w.npc.state !== 'unconscious');
    },

    /**
     * Seen at a grave with a spade (dug open, its marker pulled up): desecration — the street takes it
     * as it takes the smashing of the town's things (InnerMapReactions.onViolence 'vandalism': the
     * witnesses' memory, the rumour, the watch). Only in a town. → the reaction, or null (unseen).
     */
    _desecrate(game, q, r, name) {
        if (!game || !game.player || !InnerMap._graveSettlement || !InnerMap._graveSettlement()) return null;
        if (!this._watchers(q, r, game.player).length) return null;
        const hex = InnerMap._burialHex();
        const victim = { id: `grave:${hex}|${q},${r}|${(game.world && game.world.day) || 0}`, name: `the grave of ${name || 'the dead'}`, type: 'property', q, r };
        return InnerMapReactions.onViolence(game, victim, 'vandalism');
    },

    /** Lay a body in the hole: a plain, unmarked mound of earth (on the world's record, world/burials.js). */
    _buryBody(game, tile, body, day) {
        const C = this.config();
        if (InnerMapCombat._carrying === body) this.drop();
        InnerMapCombat.removeBody(body);
        // What was put in the hole goes in with them: grave goods
        const world = game && game.world;
        const hex = InnerMap._burialHex();
        const c = Burials.cacheAt(world, hex, tile.q, tile.r);
        const goods = c && !Burials.isEmpty(c) ? Burials.contents(c) : null;
        const g = Burials.bury(world, hex, tile.q, tile.r, body, day, InnerMap._graveSettlement(), goods);
        if (g && c) Burials.dropCache(world, hex, tile.q, tile.r);
        if (g) InnerMap.layBurial(tile.q, tile.r, g, day);
        else this.setGround(tile, 'grave', { day, name: body.name, body: Burials.plainBody(body) });
        const with_ = g && g.goods ? ` With them: ${Burials.describe(g.goods, _nameOf)}.` : '';
        this._note(game, '⚰️ Buried', _fill(C.text.bury || 'You bury {name}.', { name: body.name }) + with_, 'info');
    },

    // ══════════════════════════════════════════════
    // WHAT GOES IN A HOLE (or an open grave)
    // ══════════════════════════════════════════════

    /** What lies in the hole or open grave at (q, r): its contents ({ items, gold }), or null. */
    contentsAt(game, q, r) {
        const t = InnerMap.getTile(q, r);
        const d = t && t._dug;
        if (!d) return null;
        if (d.kind === 'grave') return Burials.isOpen(d) ? d.goods || null : null;
        if (d.kind !== 'hole') return null;
        const c = Burials.cacheAt(game && game.world, InnerMap._burialHex(), q, r);
        return c && c.open ? c : null;
    },

    /** Can things be put in at (q, r)? An open hole, or an open grave — not one with water in it. */
    canStash(q, r) {
        const t = InnerMap.getTile(q, r);
        const d = t && t._dug;
        if (!d || InnerMap._insideBuilding) return false;
        if (t._wet || t._sea || t._shallow) return false;
        return d.kind === 'hole' || (d.kind === 'grave' && Burials.isOpen(d));
    },

    /** What the packs hold that could go in: [{ itemId, qty, name, icon }] (gold first; not what is worn). */
    stashables(player) {
        const out = [];
        if (!player) return out;
        if (Math.floor(Number(player.gold) || 0) > 0) out.push({ itemId: 'gold', qty: Math.floor(player.gold), ..._goodOf('gold') });
        const inv = player.inventory || {};
        for (const id of Object.keys(inv)) {
            if (id === 'gold' || !(inv[id] > 0)) continue;
            if (Arms.isArms(id) && Arms.isEquipped(player, id) && inv[id] <= 1) continue;
            out.push({ itemId: id, qty: inv[id], ..._goodOf(id) });
        }
        return out;
    },

    /**
     * Put qty of itemId (or 'gold') from the packs into the hole or open grave at
     * (q, r). The player must stand by it. → how many went in.
     */
    stash(game, q, r, itemId, qty) {
        const player = game && game.player;
        if (!player || !this.canStash(q, r)) return 0;
        if (_cheb(InnerMap.playerInnerQ, InnerMap.playerInnerR, q, r) > 1) return 0;
        const t = InnerMap.getTile(q, r);
        const day = (game.world && game.world.day) || 0;
        let c;
        if (t._dug.kind === 'grave') {
            if (!t._dug.goods) t._dug.goods = { items: {}, gold: 0 };
            c = t._dug.goods;
        } else {
            c = Burials.openCache(game.world, InnerMap._burialHex(), q, r, day);
        }
        const n = Burials.putIn(c, player, itemId, qty);
        if (n && game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return n;
    },

    /** Take back everything in the hole or open grave at (q, r) that the packs have room for. */
    unstash(game, q, r) {
        const player = game && game.player;
        const c = this.contentsAt(game, q, r);
        if (!player || !c) return null;
        const t = InnerMap.getTile(q, r);
        const { taken, left } = Burials.takeAll(c, player);
        if (!left && t._dug.kind === 'grave') delete t._dug.goods;
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return { taken, left };
    },

    /** The packs, to pick what goes into the hole (or open grave) at (q, r): a stack, some of it, or gold. */
    showStashPicker(game, q, r, msg = '') {
        if (!game || !game.ui || typeof game.ui.showCustomPanel !== 'function') return;
        const goods = this.stashables(game.player);
        const inHole = this.contentsAt(game, q, r);
        const grave = (InnerMap.getTile(q, r) || {})._dug;
        const where = grave && grave.kind === 'grave' ? 'the grave' : 'the hole';
        const rows = goods.slice(0, 40).map(g => {
            const some = g.itemId === 'gold' ? Math.min(g.qty, 10) : 1;
            const id = esc(g.itemId);
            const btn = (n, label) => `<button type="button" style="${BTN_PLAIN} margin-left:4px;" onclick="event.stopPropagation(); window.__holeStash && window.__holeStash('${id}', ${n})">${label}</button>`;
            return {
                icon: g.icon, name: esc(g.name), desc: `You carry ${g.qty}${g.itemId === 'gold' ? 'g' : ''}`,
                side: (g.qty > some ? btn(some, g.itemId === 'gold' ? `${some}g` : '1') : '') + btn(g.qty, g.qty > some ? 'All' : (g.itemId === 'gold' ? `${g.qty}g` : 'Put in')),
            };
        });
        window.__holeStash = (itemId, n) => {
            const put = this.stash(game, q, r, itemId, n);
            const name = _goodOf(itemId).name;
            this.showStashPicker(game, q, r, put ? `In it goes: ${itemId === 'gold' ? `${put} gold` : `${put} ${name}`}.` : 'You need to stand beside it.');
        };
        const now = inHole && !Burials.isEmpty(inHole) ? `<div style="font-size:11px; color:var(--text-secondary); margin:4px 0;">In ${where} now: ${esc(Burials.describe(inHole, _nameOf))}.</div>` : '';
        const note = msg ? `<div style="font-size:11px; color:#9fd89f; margin:4px 0;">${esc(msg)}</div>` : '';
        const body = rows.length ? rowList(rows) : '<div style="font-size:11px; color:var(--text-secondary);">Your packs are empty.</div>';
        game.ui.showCustomPanel(`🕳️ Put Something in ${where === 'the grave' ? 'the Grave' : 'the Hole'}`,
            `<div>${lede(`Pick what goes into ${where}. Fill it in and it is buried: dig here again to get it back. Anyone who watches you do it may come back for it.`)}${note}${now}${body}</div>`);
    },

    /**
     * Raise a grave marker on the burial at (q, r): walk beside it and set it
     * (choice from Burials.markerOptions: one from the pack, or a cross carved).
     */
    raiseMarker(game, q, r, choice) {
        if (!choice) return 'none';
        const secs = Number(choice.seconds) > 0 ? Number(choice.seconds) : 3;
        return this.start(game, 'mark', q, r, {
            seconds: secs,
            verb: choice.how === 'carve' ? 'Carving a cross' : VERB.mark,
            needs: {},
            onDone: (g) => this._raiseMarker(g, q, r, choice, (g.world && g.world.day) || 0),
        });
    },

    _raiseMarker(game, q, r, choice, day) {
        const world = game && game.world;
        const head = InnerMap.burialHeadFree(q, r);
        const res = Burials.placeMarker(world, game && game.player, InnerMap._burialHex(), q, r, choice, day, head);
        if (!res.success) { this._note(game, '⚰️ No marker', res.reason, 'error'); return res; }
        InnerMap.layBurial(q, r, res.grave, day);
        this._note(game, '⚰️ A grave', res.text, 'success');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, world);
        return res;
    },

    /** A body lying in the hole at (q, r), next to it, or carried by the player standing beside it. */
    _bodyIn(q, r) {
        const here = InnerMapCombat.corpsesHere();
        return here.find(c => c.q === q && c.r === r)
            || (InnerMapCombat._carrying && here.includes(InnerMapCombat._carrying) ? InnerMapCombat._carrying : null)
            || here.find(c => _cheb(c.q, c.r, q, r) <= 1)
            || null;
    },

    _rollFind(game) {
        const C = this.config();
        for (const f of C.finds || []) {
            if (Utils.random() >= (Number(f.chance) || 0)) continue;
            let gold = 0;
            if (Array.isArray(f.gold) && game && game.player) {
                gold = Utils.randInt(f.gold[0], f.gold[1]);
                game.player.gold = (game.player.gold || 0) + gold;
                if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
            }
            return _fill(f.text, { gold });
        }
        return null;
    },

    /** Lift the body out of an open grave of the player's: it lies beside the pit, to carry off or lay back. */
    takeBodyOut(game, q, r) {
        const g = this.dugAt(q, r);
        if (!g || g.kind !== 'grave' || !Burials.isOpen(g) || !g.body) return null;
        const day = (game && game.world && game.world.day) || 0;
        const body = Burials.takeBody(g);
        // (beside the pit, on open ground: the nearest passable tile to the player)
        let spot = null;
        for (const [dq, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const t = InnerMap.getTile(q + dq, r + dr);
            if (!t || !t.subTerrain || !t.subTerrain.passable || t.building || t.customObject || t.customObjectPart) continue;
            const n = _cheb(t.q, t.r, InnerMap.playerInnerQ, InnerMap.playerInnerR);
            if (!spot || n < spot.n) spot = { q: t.q, r: t.r, n };
        }
        const b = InnerMapCombat.restoreBody({ ...body, name: body.name || g.name || 'someone' }, spot ? spot.q : q, spot ? spot.r : r, day);
        InnerMap.layBurial(q, r, g, day);
        this._note(game, '⚰️ Lifted out', `You haul ${b.name} up out of the grave.`, 'warning');
        return b;
    },

    /** Pull up the marker over a burial of the player's (only ever on purpose): it goes back to the pack. */
    pullMarker(game, q, r) {
        const g = this.dugAt(q, r);
        const day = (game && game.world && game.world.day) || 0;
        if (!g || g.kind !== 'grave' || !Burials.markerNow(g, day)) return null;
        const item = Burials.takeMarker(g, game && game.player, day);
        InnerMap.clearBurialMarker(q, r);
        InnerMap.layBurial(q, r, g, day);
        this._note(game, '⚰️ Pulled up', item ? `You pull up the marker and keep it (${_nameOf(item)}).` : 'You pull up the old marker. It is past any use.', 'info');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        return item;
    },

    /** A word over a grave. */
    payRespects(game, q, r) {
        const d = this.dugAt(q, r);
        if (!d || d.kind !== 'grave') return;
        // (a grave with a marker, or a bare mound only you know is a grave)
        const day = (game && game.world && game.world.day) || 0;
        const marked = Burials.isLegible(d, day);
        const T = this.config().text;
        const lines = (marked ? T.respects : T.respectsMound || T.respects) || [];
        const years = GraveBook.yearsBetween(d.day, day);
        const line = lines.length ? lines[Math.floor(Utils.random() * lines.length)] : 'You stand a while by the grave.';
        this._note(game, marked ? '🕯️ A Grave' : '🕯️ A Burial Mound', _fill(line, { name: d.name || 'someone', years: `${years} year${years === 1 ? '' : 's'}` }));
    },

    /** Read a marked grave of the player's own (as a churchyard grave reads). */
    readGrave(game, q, r) {
        const d = this.dugAt(q, r);
        if (!d || d.kind !== 'grave') return;
        const day = (game && game.world && game.world.day) || 0;
        const m = Burials.markerNow(d, day);
        const title = m ? (GraveBook.markerDef(m) || {}).name || 'A Grave' : 'A Burial Mound';
        this._note(game, `⚰️ ${title}`, Burials.readLines(d, game && game.world, day).join(' '));
    },

    /**
     * Change a tile's ground: bare earth (the grass stripped and re-edged
     * around it) with a hole, turned earth or a grave on it.
     */
    setGround(tile, kind, extra = {}) {
        const g = GROUND[kind];
        if (!tile || !g) return;
        // (the ground as it was before the spade: a burial mound left long enough grows back over to it, world/burials.js)
        if (!tile._dug && !tile._undug) tile._undug = { baseTerrain: tile.baseTerrain, subTerrain: tile.subTerrain ? { ...tile.subTerrain } : null, terrainDetail: tile.terrainDetail || null, tilled: !!tile._tilled };
        tile._dug = { kind, ...extra };
        // (the ground stays as it was — grass and all — and the turned soil is drawn over it, ragged-edged
        // (_soilPatch): no square of bare dirt. Tilled soil likewise keeps the ground under it.)
        const was = tile._undug;
        if (was && was.baseTerrain) { tile.baseTerrain = was.baseTerrain; tile.terrainDetail = was.terrainDetail || null; }
        tile._tilled = true;
        tile._cachedFill = null;
        tile._cachedOverlay = undefined;
        // (a burial is a nameless mound until a marker is raised over it: world/burials.js)
        tile.subTerrain = { ...g, name: kind === 'grave' ? Burials.label(tile._dug, extra.day || 0) || 'Burial Mound' : g.name };
        if (InnerMap.tiles) InnerMap._refreshGrassLayer(InnerMap.tiles);
    },

    // ══════════════════════════════════════════════
    // CARRYING A BODY
    // ══════════════════════════════════════════════

    /** Pick up a body: it comes along with the player (who walks slower). */
    carry(body) {
        if (!body) return;
        InnerMapCombat._carrying = body;
        body.moved = true;
        if (this._baseSpeed == null) this._baseSpeed = InnerMap._playerSpeed;
        InnerMap._playerSpeed = this._baseSpeed * (Number(this.config().carrySpeed) || 1);
    },

    /** Put the carried body down where the player stands. */
    drop() {
        const body = InnerMapCombat._carrying;
        InnerMapCombat._carrying = null;
        if (this._baseSpeed != null) { InnerMap._playerSpeed = this._baseSpeed; this._baseSpeed = null; }
        if (body) { body.q = InnerMap.playerInnerQ; body.r = InnerMap.playerInnerR; }
        return body;
    },

    _updateCarry() {
        const body = InnerMapCombat._carrying;
        if (!body) return;
        // Leaving the town for the world map (or the body gone): it is left behind
        if (!InnerMap.active || !InnerMapCombat._corpses.includes(body)) {
            this.drop();
            return;
        }
        // Through a door (into a building, up its stairs, back out to the street): the body comes too,
        // as the living carried do (ui/innerMapCarry.js) — it lies on the map the player is on
        const key = InnerMapCombat._mapKey();
        if (body.key !== key) {
            body.key = key;
            body.q = InnerMap.playerInnerQ;
            body.r = InnerMap.playerInnerR;
            return;
        }
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        // A fresh body bleeds on the ground behind it, a drop every few steps (systems/carrying.js)
        if ((body.q !== q || body.r !== r) && Carrying.drips(body, typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())) InnerMapCombat.dripBlood(body, body.q, body.r);
        body.q = q;
        body.r = r;
    },

    // ══════════════════════════════════════════════
    // RENDER — the ground features, under the sprites
    // ══════════════════════════════════════════════

    renderGround(ctx, camera, range, T) {
        if (!InnerMap.tiles || InnerMap._insideBuilding) return;
        const ds = T * camera.zoom;
        const { qMin, qMax, rMin, rMax } = range;
        for (let r = Math.max(0, rMin); r <= Math.min(InnerMap.height - 1, rMax); r++) {
            const row = InnerMap.tiles[r];
            if (!row) continue;
            for (let q = Math.max(0, qMin); q <= Math.min(InnerMap.width - 1, qMax); q++) {
                const tile = row[q];
                if (!tile || !tile.visible) continue;
                const kind = tile._dug ? tile._dug.kind : (tile.subTerrain && tile.subTerrain.id === 'tilled_soil' ? 'tilled' : null);
                if (!kind) continue;
                const s = camera.worldToScreenFast(q * T, r * T);
                // (a burial of the player's: its mound and, wanting a standing one, its marker)
                if (kind === 'grave') this._drawBurial(ctx, tile._dug, s.x, s.y, ds, q, r);
                else if (kind === 'filled') {
                    // Turned earth fades back into the ground (world/burials.js ground.filledFadeDays)
                    const a = this._filledAlpha(tile._dug);
                    if (a <= 0.02) continue;
                    ctx.save();
                    ctx.globalAlpha *= a;
                    this._drawFeature(ctx, kind, s.x, s.y, ds, q, r);
                    ctx.restore();
                } else this._drawFeature(ctx, kind, s.x, s.y, ds, q, r);
            }
        }
        // A grave robber's lantern (ui/innerMapScavengers.js)
        InnerMapScavengers.render(ctx, camera, T);
        // The work under way: a ring filling round the spot
        const job = this._job;
        if (job && job.t != null) {
            const s = camera.worldToScreenFast(job.q * T + T / 2, job.r * T + T / 2);
            ctx.save();
            ctx.lineWidth = Math.max(2, ds * 0.07);
            ctx.strokeStyle = 'rgba(0,0,0,0.45)';
            ctx.beginPath();
            ctx.arc(s.x, s.y, ds * 0.42, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = '#f5c542';
            ctx.beginPath();
            ctx.arc(s.x, s.y, ds * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.progress());
            ctx.stroke();
            ctx.restore();
        }
    },

    /** How strongly turned earth still shows (1 fresh, 0 grown back over). */
    _filledAlpha(d) {
        const day = InnerMap._burialDay ? InnerMap._burialDay() : (InnerMap.worldDay || 0);
        const fade = Math.max(1, Number(Burials.config().ground.filledFadeDays) || 40);
        if (!d || d.day == null) return 1;
        return Math.max(0, Math.min(1, 1 - (day - d.day) / fade));
    },

    /** Is (q, r) tilled ground? */
    isTilledAt(q, r) {
        const t = InnerMap.getTile(q, r);
        return !!(t && ((t._dug && t._dug.kind === 'tilled') || (t.subTerrain && t.subTerrain.id === 'tilled_soil')));
    },

    /** Draw tilled ground at (q, r) ('dry' | 'wet', for watered ground), ragged-edged over the ground (ui/tilledSoil.js). */
    drawTilled(ctx, q, r, x, y, ds, which = 'dry') {
        return drawTilledSoil(ctx, (dq, dr) => this.isTilledAt(q + dq, r + dr), q, r, x, y, ds, which);
    },

    /** A grave sprite (world/graveArt.js), loaded, or null. */
    _graveImg(id) {
        if (!GraveArt.hasArt(id)) return null;
        const img = CustomObjects.getImage(GraveArt.path(id));
        return img && img.complete && img.naturalWidth ? img : null;
    },

    /**
     * A burial: the churchyard's fresh mound of turned earth (its painted art,
     * centred on the tile, fading as it settles), and its marker drawn at the
     * mound's head when none stands on the tile above (world/innerMap/graves.js).
     */
    _drawBurial(ctx, g, x, y, ds, q, r) {
        const day = InnerMap._burialDay ? InnerMap._burialDay() : (InnerMap.worldDay || 0);
        const P = Number(GraveBook.config().artTile) || 128;
        const smooth = ctx.imageSmoothingEnabled;
        ctx.save();
        ctx.globalAlpha = Burials.moundAlpha(g, day);
        const mound = this._graveImg('grave_mound');
        // Fresh (burial.freshDays): bare, dark, damp turned earth with its clods — the churchyard's
        // grassed mound, flowers and all, only once it has weathered (a grave dug and put back is fresh again)
        const fresh = Burials.isFresh(g, day);
        if (Burials.isOpen(g)) {
            // Dug open: the pit, the earth heaped beside it, whoever lies in it showing
            this._openPit(ctx, x, y, ds, q, r, !!g.body);
        } else if (fresh) {
            this._freshMound(ctx, x + ds / 2, y + ds / 2, ds, q, r);
        } else if (mound) {
            const w = mound.naturalWidth * ds / P, h = mound.naturalHeight * ds / P;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(mound, Math.floor(x + (ds - w) / 2), Math.floor(y + (ds - h) / 2), w, h);
        } else {
            // (the art still loading) a low heap of turned earth
            const cx = x + ds / 2, cy = y + ds / 2;
            const grad = ctx.createLinearGradient(cx - ds * 0.3, cy, cx + ds * 0.3, cy);
            grad.addColorStop(0, '#5e4229');
            grad.addColorStop(0.45, '#8a6845');
            grad.addColorStop(1, '#4e361f');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.ellipse(cx, cy, ds * 0.28, ds * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        const m = Burials.markerNow(g, day);
        const head = InnerMap.getTile(q, r - 1);
        const standing = head && head._burialOf && head._burialOf.q === q && head._burialOf.r === r && head.customObject;
        if (m && !standing) {
            const img = this._graveImg(m);
            if (img) {
                // set into the head of the mound, a little smaller than a stone in the churchyard
                const k = 0.7;
                const w = img.naturalWidth * ds / P * k, h = img.naturalHeight * ds / P * k;
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(img, Math.floor(x + (ds - w) / 2), Math.floor(y + ds * 0.35 - h), w, h);
            } else {
                this._drawFeature(ctx, 'grave', x, y, ds, q, r);
            }
        }
        ctx.imageSmoothingEnabled = smooth;
    },

    /** An open grave: the long pit (the churchyard's open-grave art, else drawn), its spoil heaped beside, the body in its shroud. */
    _openPit(ctx, x, y, ds, q, r, body) {
        const cx = x + ds / 2, cy = y + ds / 2;
        const img = this._graveImg('grave_open');
        if (img) {
            const P = Number(GraveBook.config().artTile) || 128;
            const w = img.naturalWidth * ds / P, h = img.naturalHeight * ds / P;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(img, Math.floor(x + (ds - w) / 2), Math.floor(y + (ds - h) / 2), w, h);
        } else {
            this._drawFeature(ctx, 'hole', x, y, ds, q, r);
        }
        if (!body) return;
        // the shroud, pale in the dark of the pit
        ctx.fillStyle = 'rgba(214, 204, 180, 0.85)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + ds * 0.03, ds * 0.11, ds * 0.27, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(120, 104, 80, 0.6)';
        ctx.beginPath();
        ctx.ellipse(cx, cy - ds * 0.17, ds * 0.07, ds * 0.06, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90, 76, 56, 0.6)';
        ctx.lineWidth = Math.max(1, ds * 0.015);
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(cx - ds * 0.09, cy - ds * 0.05 + i * ds * 0.1);
            ctx.lineTo(cx + ds * 0.09, cy - ds * 0.03 + i * ds * 0.1);
            ctx.stroke();
        }
    },

    /**
     * Turned soil over the ground: a ragged-edged patch (a hash of the tile shapes it), darker at its
     * heart, crumbs of earth scattered round its rim — so a dug spot blends into the grass about it.
     */
    _soilPatch(ctx, cx, cy, ds, q, r, rad = 0.48) {
        const h = (i) => ((((q * 73856093) ^ (r * 19349663) ^ (i * 83492791)) >>> 0) % 1000) / 1000;
        const n = 16;
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const a = (i % n) / n * Math.PI * 2;
            const k = rad * (0.82 + 0.3 * h(i % n));
            const px = cx + Math.cos(a) * ds * k, py = cy + Math.sin(a) * ds * k * 0.92;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, ds * 0.05, cx, cy, ds * rad * 1.1);
        grad.addColorStop(0, '#4a3220');
        grad.addColorStop(0.75, '#5e4129');
        grad.addColorStop(1, 'rgba(94, 65, 41, 0.75)');
        ctx.fillStyle = grad;
        ctx.fill();
        // crumbs thrown out over the grass
        for (let i = 0; i < 10; i++) {
            const a = h(i + 40) * Math.PI * 2, d = ds * rad * (0.95 + 0.35 * h(i + 60));
            const s = Math.max(1.5, ds * (0.025 + 0.03 * h(i + 80)));
            ctx.fillStyle = i % 2 ? '#5a3d26' : '#3f2a19';
            ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.92, s, s * 0.8);
        }
        ctx.restore();
    },

    /**
     * A fresh grave: a long low heap of dark, damp, freshly turned earth on its soil patch —
     * lumpy, clods of earth on it and round it, a wet sheen here and there. No grass, no flowers.
     */
    _freshMound(ctx, cx, cy, ds, q, r) {
        const h = (i) => ((((q * 2654435761) ^ (r * 40503) ^ (i * 2246822519)) >>> 0) % 1000) / 1000;
        this._soilPatch(ctx, cx, cy + ds * 0.04, ds, q, r, 0.5);
        ctx.save();
        // its shadow, then the heap: a long rounded hump lying along the tile
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.ellipse(cx + ds * 0.03, cy + ds * 0.1, ds * 0.32, ds * 0.44, 0, 0, Math.PI * 2);
        ctx.fill();
        const n = 18;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const a = (i % n) / n * Math.PI * 2;
            const k = 0.92 + 0.12 * h(i % n);
            const px = cx + Math.cos(a) * ds * 0.29 * k, py = cy + Math.sin(a) * ds * 0.42 * k;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        const g = ctx.createLinearGradient(cx - ds * 0.3, cy - ds * 0.3, cx + ds * 0.3, cy + ds * 0.3);
        g.addColorStop(0, '#6b4a2e');
        g.addColorStop(0.4, '#55391f');
        g.addColorStop(1, '#2f1f12');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(25, 15, 8, 0.6)';
        ctx.lineWidth = Math.max(1, ds * 0.02);
        ctx.stroke();
        // the ridge along its top, and the spade's cuts across it
        ctx.strokeStyle = 'rgba(140, 105, 70, 0.35)';
        ctx.lineWidth = Math.max(1, ds * 0.025);
        ctx.beginPath();
        ctx.moveTo(cx - ds * 0.04, cy - ds * 0.34);
        ctx.quadraticCurveTo(cx - ds * 0.07, cy, cx - ds * 0.03, cy + ds * 0.32);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(20, 12, 6, 0.45)';
        for (let i = 0; i < 4; i++) {
            const yy = cy - ds * 0.24 + i * ds * 0.15;
            ctx.beginPath();
            ctx.moveTo(cx - ds * 0.2, yy + ds * 0.02);
            ctx.lineTo(cx + ds * 0.18, yy - ds * 0.02 + h(i + 5) * ds * 0.03);
            ctx.stroke();
        }
        // clods, lit on top; a wet sheen
        for (let i = 0; i < 12; i++) {
            const a = h(i + 20) * Math.PI * 2, d = h(i + 30);
            const x = cx + Math.cos(a) * ds * 0.24 * d, y = cy + Math.sin(a) * ds * 0.36 * d;
            const s = Math.max(2, ds * (0.04 + 0.04 * h(i + 50)));
            ctx.fillStyle = i % 3 ? '#3b2716' : '#62452a';
            ctx.fillRect(Math.round(x), Math.round(y), s, s * 0.85);
            ctx.fillStyle = 'rgba(160, 125, 90, 0.35)';
            ctx.fillRect(Math.round(x), Math.round(y), s, Math.max(1, s * 0.3));
        }
        ctx.fillStyle = 'rgba(200, 210, 220, 0.12)';
        ctx.beginPath();
        ctx.ellipse(cx - ds * 0.1, cy - ds * 0.12, ds * 0.06, ds * 0.03, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },

    _drawFeature(ctx, kind, x, y, ds, q, r) {
        const cx = x + ds / 2, cy = y + ds / 2;
        const jitter = (((q * 7919) ^ (r * 104729)) >>> 0) % 7 / 7;
        ctx.save();
        // Holes, filled earth: their turned soil, ragged-edged over the ground (no square of dirt)
        if (kind === 'hole' || kind === 'filled') this._soilPatch(ctx, cx, cy, ds, q, r, kind === 'hole' ? 0.5 : 0.44);
        if (kind === 'hole') {
            // The spoil heap, then the dark pit
            ctx.fillStyle = '#7a5a3a';
            ctx.beginPath();
            ctx.ellipse(cx + ds * 0.3, cy + ds * 0.3, ds * 0.22, ds * 0.14, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#5a3f26';
            ctx.beginPath();
            ctx.ellipse(cx, cy, ds * 0.42, ds * 0.34, 0, 0, Math.PI * 2);
            ctx.fill();
            const g = ctx.createRadialGradient(cx, cy + ds * 0.04, ds * 0.04, cx, cy, ds * 0.34);
            g.addColorStop(0, '#0d0805');
            g.addColorStop(1, '#2a1b10');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(cx, cy + ds * 0.03, ds * 0.34, ds * 0.26, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (kind === 'tilled' && this.drawTilled(ctx, q, r, x, y, ds)) {
            // Ploughed ground, from the plowed-soil sheet, its edges by the ground tilled round it
        } else if (kind === 'tilled') {
            // (the sheet still loading) dark turned soil in furrows
            const sz = Math.ceil(ds) + 1;
            ctx.fillStyle = 'rgba(78, 52, 30, 0.55)';
            ctx.fillRect(x, y, sz, sz);
            const rows = 4;
            for (let i = 0; i < rows; i++) {
                const fy = y + (i + 0.5) * sz / rows;
                ctx.fillStyle = 'rgba(40, 24, 12, 0.6)';
                ctx.fillRect(x + sz * 0.06, fy, sz * 0.88, Math.max(1, sz * 0.07));
                ctx.fillStyle = 'rgba(150, 112, 74, 0.45)';
                ctx.fillRect(x + sz * 0.06, fy - Math.max(1, sz * 0.05), sz * 0.88, Math.max(1, sz * 0.04));
            }
        } else if (kind === 'filled') {
            ctx.fillStyle = 'rgba(70, 48, 28, 0.55)';
            ctx.beginPath();
            ctx.ellipse(cx, cy, ds * 0.4, ds * 0.32, jitter, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(40, 26, 14, 0.5)';
            for (let i = 0; i < 4; i++) {
                const a = jitter * 6 + i * 1.7;
                ctx.fillRect(cx + Math.cos(a) * ds * 0.2, cy + Math.sin(a) * ds * 0.15, ds * 0.06, ds * 0.05);
            }
        } else if (kind === 'grave') {
            // A raised mound with a wooden marker at its head
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.ellipse(cx, cy + ds * 0.1, ds * 0.36, ds * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
            const g = ctx.createLinearGradient(cx - ds * 0.3, cy, cx + ds * 0.3, cy);
            g.addColorStop(0, '#5e4229');
            g.addColorStop(0.45, '#8a6845');
            g.addColorStop(1, '#4e361f');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(cx, cy + ds * 0.06, ds * 0.3, ds * 0.4, 0, 0, Math.PI * 2);
            ctx.fill();
            const w = Math.max(2, ds * 0.07);
            ctx.fillStyle = '#6b4a2b';
            ctx.strokeStyle = '#2b1a0c';
            ctx.lineWidth = Math.max(1, ds * 0.02);
            ctx.fillRect(cx - w / 2, cy - ds * 0.62, w, ds * 0.42);
            ctx.strokeRect(cx - w / 2, cy - ds * 0.62, w, ds * 0.42);
            ctx.fillRect(cx - ds * 0.14, cy - ds * 0.52, ds * 0.28, w);
            ctx.strokeRect(cx - ds * 0.14, cy - ds * 0.52, ds * 0.28, w);
        }
        ctx.restore();
    },

    /** The player's swing while working, facing the spot (null when not at work). */
    playerAnim() {
        const job = this._job;
        if (!job || job.t == null) return null;
        const dq = job.q - InnerMap.playerInnerQ;
        const dr = job.r - InnerMap.playerInnerR;
        return { anim: 'slash', direction: InnerMapCharacters.getDirection(dq, dr) };
    },

    /** What the work is called, for the HUD line. */
    label() {
        const j = this._job;
        return j && j.t != null ? j.verb || VERB[j.kind] || 'Working' : null;
    },
};
