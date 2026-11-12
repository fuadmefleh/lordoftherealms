// ============================================
// INNER MAP SCAVENGERS — grave robbers at night, looters over the fallen
// ============================================
// The street-map half of systems/scavengers.js:
//
//   - A GRAVE ROBBER: on a night the town's plan says a grave is robbed
//     (Scavengers.plan — the same answer the off-map day would give, so the
//     player's presence never adds or loses one), the robber (the townsperson
//     the plan names, if they are about; else someone come in from the dark)
//     walks to the grave, a lantern in hand, and digs (the slash swing) for
//     digSeconds. Then Scavengers.commit: the grave dug OPEN (marker kept),
//     its goods gone. Whoever saw it (the player too) — the watch takes them.
//     The player can shout for the watch or go at them (Seize Them: they run,
//     the grave unrobbed); their menu says what they are about.
//   - LOOTERS: by someone lying in the street (dead, senseless, bound) an
//     opportunist (Scavengers.looterKind) walks over, kneels a few seconds
//     ("Nobody'll miss this.") and goes through their things; kin and friends
//     take them for safekeeping. Seen, it is the looter's crime
//     (StreetCrime.recordNpcCrime); a guard who sees it takes them, and the
//     things go back. The player knocked out (ui/innerMapCombat.js) may come
//     round robbed: whileOut.
//
// Each frame from InnerMapDigging.update; drawn from InnerMapDigging.renderGround.
// Chances are Scavengers' hashes (no shared RNG).

import { InnerMap } from '../world/innerMap.js';
import { GraveBook } from '../world/graveBook.js';
import { Burials } from '../world/burials.js';
import { Scavengers } from '../systems/scavengers.js';
import { Graveyards } from '../systems/graveyards.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Duels } from '../systems/duels.js';
import { Downed } from '../systems/downed.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapDowned } from './innerMapDowned.js';
import { InnerMapBrawls } from './innerMapBrawls.js';

const _cheb = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A hash in [0, 1) (picks among lines and people; no shared RNG). */
function _frac(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}
const _pick = (arr, seed) => (Array.isArray(arr) && arr.length ? arr[Math.floor(_frac(seed) * arr.length) % arr.length] : null);

function _note(game, title, text, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, kind);
}

/** Is this NPC free to be drawn into something (not down, not busy, not gone)? */
function _free(n) {
    return !!n && !Downed.isDown(n) && n.state !== 'gone' && n.state !== 'inside_building' && n.state !== 'leaving_building'
        && !n._dialogFrozen && !n._carried && !n._asleep && !n._scav && !n._graveRobber;
}

export const InnerMapScavengers = {
    _robber: null,      // { npc, plan, spot, stand, phase: 'go'|'dig'|'leave', t, key, day, spawned, told }
    _tried: null,       // the map|day whose plan has been looked at
    _scanT: 0,

    reset() {
        this._robber = null;
        this._tried = null;
        this._scanT = 0;
    },

    update(dt, game) {
        if (!game || !game.world || !InnerMap.active || InnerMap._insideBuilding) return;
        try {
            this._updateRobber(dt, game);
            this._updateLooters(dt, game);
        } catch (e) { /* a scavenger never stops the game */ }
    },

    // ══════════════════════════════════════════════
    // THE GRAVE ROBBER
    // ══════════════════════════════════════════════

    _updateRobber(dt, game) {
        const s = InnerMap._graveSettlement && InnerMap._graveSettlement();
        const key = InnerMapCombat._mapKey();
        const day = _num(game.world.day);
        let R = this._robber;
        if (R && (R.key !== key || !InnerMap.npcs.includes(R.npc))) { this._release(R); this._robber = R = null; }
        if (!R) {
            if (!s || !Scavengers.isNight(InnerMap.timeOfDay)) return;
            const tag = `${key}|${day}`;
            if (this._tried === tag) return;
            this._tried = tag;
            const plan = Scavengers.plan(game.world, s, day, game.player);
            if (plan) this._robber = this._begin(game, s, plan, key, day);
            return;
        }
        const npc = R.npc;
        const C = Scavengers.config().graveRobbers;
        if (R.phase === 'go') {
            if (_cheb(npc.q, npc.r, R.stand.q, R.stand.r) === 0 || (_cheb(npc.q, npc.r, R.spot.q, R.spot.r) <= 1 && npc.state !== 'walking')) {
                R.phase = 'dig';
                R.t = 0;
                npc.path = null;
                npc.state = 'idle';
                npc._dialogFrozen = true;
                npc.activity = { type: 'dig', anim: 'slash' };
                npc.facing = InnerMapCharacters.getDirection(R.spot.q - npc.q, R.spot.r - npc.r);
                InnerMapReactions.bark(npc, _pick(Scavengers.config().looters.barks.robber, `${npc.id}|${day}`) || '…', 3);
                // The player near enough to see the lantern
                if (!R.told && _cheb(InnerMap.playerInnerQ, InnerMap.playerInnerR, npc.q, npc.r) <= 9) {
                    R.told = true;
                    _note(game, '🏮 A Lantern Among the Graves', `${npc.name} is digging at a grave in the dark.`, 'warning');
                }
            } else if (npc.state !== 'walking' && (R.t += dt) > 3) {
                R.t = 0;
                if (!this._walk(npc, R.stand) && ++R.tries > 4) { this._release(R); this._robber = null; }
            }
            return;
        }
        if (R.phase === 'dig') {
            npc.activity = { type: 'dig', anim: 'slash' };
            R.t += dt;
            if (!R.told && _cheb(InnerMap.playerInnerQ, InnerMap.playerInnerR, npc.q, npc.r) <= 9) {
                R.told = true;
                _note(game, '🏮 A Lantern Among the Graves', `${npc.name} is digging at a grave in the dark.`, 'warning');
            }
            // (as long as the digging takes them: a spade quicker than bare hands, a cache than a grave)
            if (R.robSecs == null) R.robSecs = Scavengers.robSeconds(R.plan);
            if (R.t < R.robSecs) return;
            this._finishRobbery(game, s, R, day);
            return;
        }
        if (R.phase === 'leave' && (R.t += dt) > 25) {
            if (R.spawned) this._removeNpc(npc);
            this._robber = null;
        }
    },

    _begin(game, s, plan, key, day) {
        const cells = (gid, i) => {
            const ground = Graveyards.ground(s, gid);
            return ground ? (InnerMap.groundCells(s, ground) || [])[i] || null : null;
        };
        const spot = Scavengers.spotOf(plan.target, cells);
        if (!spot) return null;
        const stand = this._standBeside(spot);
        if (!stand) return null;
        // The robber the plan names, if they are about; else someone come in from the dark
        let npc = plan.robber.pid != null ? (InnerMap.npcs || []).find(n => n._person && n._person.id === plan.robber.pid && _free(n)) : null;
        let spawned = false;
        if (!npc) {
            const seed = _frac(`robber|${key}|${day}`);
            let k = 0;
            const rng = () => _frac(`robber|${key}|${day}|${k++}|${seed}`);
            npc = InnerMap._makeNpc && InnerMap._makeNpc('villager', 90000 + Math.floor(seed * 9999), rng);
            if (!npc) return null;
            if (plan.robber.kind !== 'townsfolk') npc.roleTitle = plan.robber.kind === 'snatcher' ? 'Body-snatcher' : 'Outlaw';
            if (plan.robber.kind === 'townsfolk') npc.name = String(plan.robber.name).split(' ')[0] || npc.name;
            InnerMap.npcs.push(npc);
            spawned = true;
        }
        npc._graveRobber = true;
        // (whatever they were hauling — a sack, a load of logs — set down: a spade, not the load, in their hands)
        if (npc._carry) { npc._carryLaid = npc._carry; npc._carry = null; }
        const R = { npc, plan, spot, stand, phase: 'go', t: 0, tries: 0, key, day, spawned, told: false };
        if (!this._walk(npc, stand)) { npc.q = npc.prevQ = stand.q; npc.r = npc.prevR = stand.r; }
        return R;
    },

    /** An open tile beside the spot to stand and dig from. */
    _standBeside(spot) {
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [0, -1]]) {
            const t = InnerMap.getTile(spot.q + dq, spot.r + dr);
            if (t && t.subTerrain && t.subTerrain.passable && !t.building && !t.customObject && !t.customObjectPart && !t._dug) return { q: t.q, r: t.r };
        }
        return null;
    },

    _walk(npc, at) {
        if (_cheb(npc.q, npc.r, at.q, at.r) === 0) return true;
        const path = InnerMap._findPath ? InnerMap._findPath(npc.q, npc.r, at.q, at.r) : null;
        if (!path || path.length < 2) return false;
        npc.path = path.slice(1);
        npc.pathIndex = 0;
        npc.moveProgress = 0;
        npc.prevQ = npc.q;
        npc.prevR = npc.r;
        npc.state = 'walking';
        npc.departing = false;
        npc._targetBuilding = null;
        return true;
    },

    /** Who sees (q, r) besides the doer (StreetCrime's sight), and does the player: { seen: [npc], guards, player }. */
    _sight(q, r, doer, victim = null) {
        const w = StreetCrime.selectWitnesses(InnerMap.npcs || [], { q, r, indoors: false }, victim || doer)
            .filter(x => x.seen && x.npc !== doer && x.npc !== victim && !Downed.isDown(x.npc) && !x.npc._asleep);
        const player = !InnerMapCombat.playerKnockedOut() && _cheb(InnerMap.playerInnerQ, InnerMap.playerInnerR, q, r) <= _num(StreetCrime.config().sight.radius, 7);
        return { seen: w.map(x => x.npc), guards: w.filter(x => x.npc.type === 'guard').length, player };
    },

    _finishRobbery(game, s, R, day) {
        const npc = R.npc;
        npc._dialogFrozen = false;
        npc.activity = null;
        const sight = this._sight(R.spot.q, R.spot.r, npc);
        const caught = sight.guards > 0;
        const seenBy = sight.seen.map(n => n.name);
        if (sight.player) seenBy.unshift('you');
        // Someone buried alive under that mound: the robber digs them out by chance (ui/innerMapDowned.js)
        const live = R.plan.target.kind === 'burial' ? InnerMapDowned.liveAt(R.spot.q, R.spot.r) : null;
        if (live) InnerMapDowned.rescue(game, live, npc, false);
        // Caught by the watch, they may fight it: whether they were taken is known only when that fight ends
        // (one who beats the guard and runs is not on the record as caught: ui/innerMapBrawls.js onEnd)
        if (caught && !live) {
            this._robber = null;
            const tiles = InnerMap.tiles;
            const onEnd = (taken) => this._settleRobbery(game, s, R, day, { caught: !!taken, seenBy, witnesses: sight.seen, seen: sight.player, ran: !taken, tiles });
            if (InnerMapBrawls.resistArrest(game, npc, { onEnd })) return;
        }
        this._settleRobbery(game, s, R, day, { caught, seenBy, witnesses: sight.seen, seen: sight.player, live: !!live });
        if (caught) {
            this._robber = null;
            InnerMapReactions.bark(npc, 'No — wait!', 2.5);
            this._removeNpc(npc);
            return;
        }
        R.phase = 'leave';
        R.t = 0;
        npc._graveRobber = false;
        if (npc._carryLaid) { npc._carry = npc._carryLaid; npc._carryLaid = null; }
        InnerMapReactions._flee(npc, { indoors: false });
    },

    /** The robbery on the record (caught or not), and the map shows it. → Scavengers.commit's result, or null. */
    _settleRobbery(game, s, R, day, o) {
        const caught = !!o.caught;
        const res = o.live ? null : Scavengers.commit(game.world, s, R.plan, day, { caught, seenBy: o.seenBy, witnesses: o.witnesses });
        // The map shows it: the grave dug open, its marker still over it (not if the player has gone in or away meanwhile)
        const t = R.plan.target;
        const onMap = !(o.tiles && o.tiles !== InnerMap.tiles);
        if (t.kind === 'plot' && InnerMap.refreshGraves) { if (onMap) InnerMap.refreshGraves(game.world); }
        else if (t.kind === 'burial') {
            const g = Burials.at(game.world, t.hex, t.q, t.r);
            if (g && onMap) InnerMap.layBurial(t.q, t.r, g, day);
        } else if (t.kind === 'cache') {
            // (dug up before your eyes: an empty hole, and nothing left on the record to find)
            Burials.dropCache(game.world, t.hex, t.q, t.r);
            const tile = onMap ? InnerMap.getTile(t.q, t.r) : null;
            if (tile && (!tile._dug || tile._dug.kind === 'filled') && InnerMap._digGround) {
                InnerMap._digGround(tile, 'hole', { day });
                if (InnerMap.tiles) InnerMap._refreshGrassLayer(InnerMap.tiles);
            }
        }
        if (res && (o.seen || caught)) _note(game, caught ? '🛡️ The Watch' : '🌒 Grave Robber', res.text, caught ? 'info' : 'warning');
        if (res && o.ran && o.seen) _note(game, '🌒 Grave Robber', `${R.npc.name} beat the guard off and ran for it.`, 'warning');
        return res;
    },

    _release(R) {
        if (!R || !R.npc) return;
        R.npc._dialogFrozen = false;
        R.npc._graveRobber = false;
        R.npc.activity = null;
        if (R.npc._carryLaid) { R.npc._carry = R.npc._carryLaid; R.npc._carryLaid = null; }
    },

    _removeNpc(npc) {
        const i = (InnerMap.npcs || []).indexOf(npc);
        if (i >= 0) InnerMap.npcs.splice(i, 1);
    },

    /** Menu entries for a robber or looter at work. */
    menuItems(game, npcs) {
        const out = [];
        for (const n of npcs || []) {
            const R = this._robber;
            if (R && R.npc === n && R.phase !== 'leave') {
                out.push({ type: 'header', label: `🏮 ${n.name} — robbing a grave` });
                out.push({ type: 'action', action: 'scav_alarm', label: 'Shout for the Watch', icon: '📣', desc: 'Raise the alarm: they run, the grave is left', npc: n });
                out.push({ type: 'action', action: 'scav_seize', label: 'Seize Them', icon: '✋', desc: 'Go at them: they drop the spade and run', npc: n });
            } else if (n._scav && n._scav.phase === 'kneel' && Scavengers.isTheft(n._scav.kind)) {
                out.push({ type: 'header', label: `🖐️ ${n.name} — going through someone's things` });
                out.push({ type: 'action', action: 'scav_alarm', label: 'Shout for the Watch', icon: '📣', desc: 'Raise the alarm: they leave it and run', npc: n });
            }
        }
        return out;
    },

    /** Run a scav_ menu action → true when handled. */
    handle(game, item) {
        const n = item && item.npc;
        if (!n || !/^scav_/.test(item.action || '')) return false;
        const R = this._robber;
        const s = InnerMap._graveSettlement && InnerMap._graveSettlement();
        const day = _num(game.world && game.world.day);
        const foil = (how) => {
            if (R && R.npc === n) {
                this._release(R);
                const g = s && GraveBook.of(s);
                if (g) g.robbedNight = day;
                StreetCrime.recordNpcCrime(game.world, s, { k: 'graveRobbing', by: n.name, byKey: StreetCrime.npcKey(n), byPid: n._person ? n._person.id : null, victim: 'a grave', d: day, seenBy: ['you'], caught: false });
                R.phase = 'leave';
                R.t = 0;
            } else if (n._scav) {
                this._drop(n);
            }
            InnerMapReactions.bark(n, how === 'alarm' ? 'Not me!' : 'Get off!', 2.5);
            InnerMapReactions._flee(n, { indoors: false });
            _note(game, how === 'alarm' ? '📣 The Alarm' : '✋ Seized', `${n.name} drops what they were at and runs${how === 'alarm' ? ' as you shout for the watch' : ''}. Folk will hear of it.`, 'info');
        };
        if (item.action === 'scav_alarm') { foil('alarm'); return true; }
        if (item.action === 'scav_seize') {
            const res = InnerMap.approachAndThen(n.q, n.r, () => foil('seize'));
            if (res === 'unreachable') foil('seize');
            return true;
        }
        return false;
    },

    // ══════════════════════════════════════════════
    // LOOTERS
    // ══════════════════════════════════════════════

    /** The fallen on this map a looter could go to: [{ ref, q, r, name, npc, body }]. */
    _victims() {
        const out = [];
        for (const c of InnerMapCombat.corpsesHere()) {
            if (c.searched || c._lootedBy || c === InnerMapCombat._carrying) continue;
            out.push({ ref: c, q: c.q, r: c.r, name: c.name, npc: c._npc || null, body: true, key: `b|${c.name}|${c.at}` });
        }
        for (const n of InnerMap.npcs || []) {
            if (!(n.state === 'unconscious' || n.state === 'bound') || n._koSearched || n._lootedBy || n._carried) continue;
            out.push({ ref: n, q: n.q, r: n.r, name: n.name, npc: n, body: false, key: `n|${StreetCrime.npcKey(n)}` });
        }
        return out;
    },

    _updateLooters(dt, game) {
        const L = Scavengers.config().looters;
        if (!L.enabled) return;
        const day = _num(game.world.day);
        // The ones at it
        for (const n of InnerMap.npcs || []) {
            const job = n._scav;
            if (!job) continue;
            const v = job.victim;
            const gone = v.body ? !InnerMapCombat._corpses.includes(v.ref) || v.ref.searched : !Downed.isDown(v.ref) || v.ref._koSearched || v.ref._carried;
            if (gone || Downed.isDown(n)) { this._drop(n); continue; }
            if (job.phase === 'go') {
                if (_cheb(n.q, n.r, v.ref.q, v.ref.r) <= 1 && n.state !== 'walking') {
                    job.phase = 'kneel';
                    job.t = 0;
                    n.path = null;
                    n.state = 'idle';
                    n._dialogFrozen = true;
                    n.activity = { type: 'loot', anim: 'sitting' };
                    n.facing = InnerMapCharacters.getDirection(v.ref.q - n.q, v.ref.r - n.r);
                    const pool = job.kind === 'kin' ? L.barks.kin : L.barks.loot;
                    InnerMapReactions.bark(n, _pick(pool, `${n.id}|${v.key}`) || '…', 3);
                } else if (n.state !== 'walking' && (job.t += dt) > 4) {
                    job.t = 0;
                    if (++job.tries > 3) this._drop(n);
                    else this._walkBeside(n, v.ref);
                }
                continue;
            }
            if (job.phase === 'kneel') {
                n.activity = { type: 'loot', anim: 'sitting' };
                if ((job.t += dt) < _num(L.kneelSeconds, 4)) continue;
                this._loot(game, n, job, day);
            }
        }
        // Every few seconds: who goes to the fallen
        if ((this._scanT += dt) < _num(L.scanSeconds, 2)) return;
        this._scanT = 0;
        const taken = new Set((InnerMap.npcs || []).filter(n => n._scav).map(n => n._scav.victim.key));
        for (const v of this._victims()) {
            if (taken.has(v.key)) continue;
            const near = (InnerMap.npcs || []).filter(n => _free(n) && n !== v.ref && _cheb(n.q, n.r, v.q, v.r) <= _num(L.radius, 7))
                .sort((a, b) => _cheb(a.q, a.r, v.q, v.r) - _cheb(b.q, b.r, v.q, v.r)).slice(0, 3);
            for (const n of near) {
                const rel = v.npc ? StreetCrime.relationTo(n, v.npc) : null;
                const kind = Scavengers.looterKind(n, rel);
                if (kind === 'watch' || kind === 'honest') {
                    // The watch and honest folk call for help over the living fallen (once)
                    if (!v.body && !v.ref._alarmed && kind === 'honest' && _frac(`alarm|${StreetCrime.npcKey(n)}|${v.key}|${day}`) < 0.3) {
                        v.ref._alarmed = true;
                        InnerMapReactions.bark(n, _pick(L.barks.alarm, `${n.id}|${v.key}`) || 'Help!', 3);
                    }
                    continue;
                }
                if (!Scavengers.willLoot(kind, `${StreetCrime.npcKey(n)}|${v.key}|${day}`)) continue;
                n._scav = { kind, victim: v, phase: 'go', t: 0, tries: 0 };
                this._walkBeside(n, v.ref);
                taken.add(v.key);
                break;
            }
        }
    },

    _walkBeside(n, at) {
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const t = InnerMap.getTile(at.q + dq, at.r + dr);
            if (t && t.subTerrain && t.subTerrain.passable && !t.building && !t.customObject && this._walk(n, { q: t.q, r: t.r })) return true;
        }
        return false;
    },

    _drop(n) {
        n._scav = null;
        n._dialogFrozen = false;
        n.activity = null;
    },

    /** The looting itself: what the fallen had goes to the looter (or back, if the watch saw). */
    _loot(game, n, job, day) {
        const v = job.victim;
        const s = InnerMap._graveSettlement && InnerMap._graveSettlement();
        const theft = Scavengers.isTheft(job.kind);
        // What they had: their purse, then what they carried (as the player searching them takes it)
        const victimNpc = v.npc || v.ref;
        let gold = 0;
        if (victimNpc && victimNpc._person && victimNpc._folk) gold = Townsfolk.takePurse(victimNpc._folk, victimNpc._person, game.world, Duels.purseRange(victimNpc.type));
        else if (victimNpc) {
            if (typeof victimNpc._purse !== 'number') victimNpc._purse = Math.floor(_frac(`purse|${v.key}`) * 12);
            gold = victimNpc._purse;
            victimNpc._purse = 0;
        }
        const inv = {};
        for (const it of (victimNpc ? Duels.brawlSpoils(victimNpc) : [])) inv[it.id] = _num(inv[it.id]) + _num(it.qty, 1);
        const took = Scavengers.pickLoot(inv, gold, `${StreetCrime.npcKey(n)}|${v.key}`);
        if (v.body) v.ref.searched = true; else v.ref._koSearched = true;
        const sight = theft ? this._sight(v.ref.q, v.ref.r, n, v.ref) : { seen: [], guards: 0, player: false };
        // Tied up but awake: they watch it done to them, and remember who
        if (theft && !v.body && v.ref.state === 'bound' && !v.ref._ko) sight.seen.push(v.ref);
        const caught = theft && sight.guards > 0;
        // Caught by the watch, they may fight it: the record waits on how that ends (beat the guard and ran: not caught)
        if (caught && InnerMapBrawls.resistArrest(game, n, { onEnd: (taken) => this._lootSettled(game, n, v, victimNpc, took, sight, theft, s, day, !!taken) })) {
            this._drop(n);
            return;
        }
        this._lootSettled(game, n, v, victimNpc, took, sight, theft, s, day, caught);
        this._drop(n);
        if (caught) {
            InnerMapReactions.bark(n, 'I was only looking!', 2.5);
            this._removeNpc(n);
        } else if (theft) InnerMapReactions._flee(n, { indoors: false });
    },

    /** What the looting comes to: back to the fallen if the watch took the looter, else fenced (or kept, by kin); the record. */
    _lootSettled(game, n, v, victimNpc, took, sight, theft, s, day, caught) {
        const rec = { by: n.name, byKey: StreetCrime.npcKey(n), gold: took.gold, items: took.items, d: day, kin: !theft, seen: sight.seen.length > 0 || sight.player, caught };
        v.ref._lootedBy = rec;
        if (caught) {
            // The watch takes them: the things go back to the fallen
            if (v.body) v.ref.searched = false; else v.ref._koSearched = false;
            if (victimNpc && victimNpc._person) victimNpc._person.purse = _num(victimNpc._person.purse) + took.gold;
            else if (victimNpc) victimNpc._purse = took.gold;
        } else if (theft) {
            // Fenced: the goods into the town's market, the coin into the looter's purse
            if (s) Scavengers.fence(s, { pid: n._person ? n._person.id : null }, took);
            if (!n._person) n._purse = _num(n._purse) + took.gold;
        } else {
            // Kin: kept safe for them
            n._kept = { from: v.name, gold: took.gold, items: took.items, d: day };
        }
        if (theft && (sight.seen.length || sight.player)) {
            const seenBy = sight.seen.map(x => x.name);
            if (sight.player) seenBy.unshift('you');
            StreetCrime.recordNpcCrime(game.world, s, {
                k: 'loot', by: n.name, byKey: StreetCrime.npcKey(n), byPid: n._person ? n._person.id : null,
                victim: v.name, vuid: v.npc ? StreetCrime.npcKey(v.npc) : null, d: day, seenBy, witnesses: sight.seen, caught,
            });
            if (sight.player) _note(game, caught ? '🛡️ The Watch' : '🖐️ A Looter', caught ? `The watch caught ${n.name} going through ${v.name}'s things.` : `${n.name} is going through ${v.name}'s things.`, 'warning');
        }
    },

    /**
     * The player knocked out and left lying there: someone near may go through
     * their things before they come round. → the line to tell them, or ''.
     */
    whileOut(game, attacker = null) {
        const player = game && game.player;
        if (!player || !InnerMap.active) return '';
        const L = Scavengers.config().looters;
        if (!L.enabled) return '';
        const day = _num(game.world && game.world.day);
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const near = (InnerMap.npcs || []).filter(n => n !== attacker && !Downed.isDown(n) && n.state !== 'gone' && n.state !== 'inside_building' && _cheb(n.q, n.r, pq, pr) <= _num(L.radius, 7))
            .sort((a, b) => _cheb(a.q, a.r, pq, pr) - _cheb(b.q, b.r, pq, pr));
        let looter = null, kind = null;
        for (const n of near.slice(0, 4)) {
            const k = Scavengers.looterKind(n, null);
            if (k === 'watch' || k === 'honest') continue;
            if (Scavengers.willLoot(k, `${StreetCrime.npcKey(n)}|player|${day}|${Math.floor(_num(player.gold))}`)) { looter = n; kind = k; break; }
        }
        if (!looter) return '';
        const sight = this._sight(pq, pr, looter, null);
        const caught = sight.guards > 0;
        const s = InnerMap._graveSettlement && InnerMap._graveSettlement();
        const seenBy = sight.seen.map(n => n.name);
        if (caught) {
            player.lootedWhileOut = { by: looter.name, caught: true, gold: 0, items: {}, d: day, seen: seenBy };
        } else {
            const took = Scavengers.lootPlayer(player, looter, day, { seenBy });
            if (s) Scavengers.fence(s, { pid: looter._person ? looter._person.id : null }, took);
            if (!looter._person) looter._purse = _num(looter._purse) + took.gold;
        }
        if (seenBy.length || caught) {
            StreetCrime.recordNpcCrime(game.world, s, { k: 'loot', by: looter.name, byKey: StreetCrime.npcKey(looter), byPid: looter._person ? looter._person.id : null, victim: player.name || 'you', vuid: 'player', d: day, seenBy, witnesses: sight.seen, caught });
        }
        if (caught) this._removeNpc(looter);
        else InnerMapReactions._flee(looter, { indoors: kind === 'kin' });
        return Scavengers.wakeLine(player);
    },

    // ══════════════════════════════════════════════
    // RENDER — the robber's lantern
    // ══════════════════════════════════════════════

    render(ctx, camera, T) {
        const R = this._robber;
        if (!R || !R.npc || !InnerMap.active || InnerMap._insideBuilding || R.key !== InnerMapCombat._mapKey()) return;
        const n = R.npc;
        const ds = T * camera.zoom;
        const s = camera.worldToScreenFast(n.q * T + T / 2, n.r * T + T / 2);
        const flick = 0.9 + 0.1 * Math.sin(Date.now() / 90 + n.id);
        ctx.save();
        const g = ctx.createRadialGradient(s.x, s.y, ds * 0.1, s.x, s.y, ds * 2.4 * flick);
        g.addColorStop(0, 'rgba(255, 196, 92, 0.38)');
        g.addColorStop(1, 'rgba(255, 170, 60, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, ds * 2.4 * flick, 0, Math.PI * 2);
        ctx.fill();
        // the lantern set down beside them: a cap and a ring to carry it by, the glass lit within
        const lx = s.x + ds * 0.4, ly = s.y + ds * 0.3;
        const w = ds * 0.17, h = ds * 0.24;
        ctx.strokeStyle = '#2b1d10';
        ctx.lineWidth = Math.max(1, ds * 0.025);
        ctx.beginPath();
        ctx.arc(lx, ly - h - ds * 0.04, ds * 0.045, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = '#2b1d10';
        ctx.beginPath();
        ctx.moveTo(lx - w * 0.62, ly - h + ds * 0.02);
        ctx.lineTo(lx, ly - h - ds * 0.05);
        ctx.lineTo(lx + w * 0.62, ly - h + ds * 0.02);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(lx - w / 2, ly - h + ds * 0.02, w, h - ds * 0.02);
        ctx.fillRect(lx - w * 0.6, ly - ds * 0.03, w * 1.2, ds * 0.04);
        ctx.fillStyle = `rgba(255, 214, 120, ${0.9 * flick})`;
        ctx.fillRect(lx - w * 0.32, ly - h + ds * 0.05, w * 0.64, h - ds * 0.1);
        ctx.restore();
    },
};
