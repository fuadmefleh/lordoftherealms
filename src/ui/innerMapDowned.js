// ============================================
// INNER MAP DOWNED — what can be done to someone on the ground
// ============================================
// The street map's half of systems/downed.js. Someone knocked out
// (ui/innerMapCombat.js) is Unconscious — or Bleeding out, after a hard blow —
// until they come round; tied up and awake they are Bound. The menu on them
// (menuItems / handle):
//
//   Look at them (their state) · Pick up / Drag (ui/innerMapCarry.js) ·
//   Go through their pockets (a crime if seen) · Bind (rope) / Untie ·
//   Gag (cloth) / Ungag · Rouse (a slap; a douse of drink) · Tend the wound
//   (a poultice or cloth) · Finish them (murder) · Bury them alive
//
// A bound person awake can't flee or fight: they plead, threaten, or call for
// help — heard, the street comes (the watch to arrest, a passer-by to untie).
//
// Buried alive (buryAlive): the mound is their grave on the world's record
// (world/burials.js, buriedAlive), muffled cries and the earth stirring for a
// window (renderMounds; a sound), then silence — they die there, the true
// cause on the town's roll (Townsfolk.slay), their kin's grief (onNpcHarmed),
// a murder on the player's record (seen at the burial, or unseen after).
// Dug out in time (the player's spade — InnerMapDigging exhume — or a
// passer-by who heard), they live, in terror, and tell of it.
//
// Saves: a burial of the living left unsettled (a save in the window) settles
// as a death on load (settleAll, from resumeGame); the live part (the cries,
// the window) is never written.

import { InnerMap } from '../world/innerMap.js';
import { Burials } from '../world/burials.js';
import { Downed } from '../systems/downed.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { audioManager } from '../systems/audio.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCarry } from './innerMapCarry.js';
import { InnerMapDigging } from './innerMapDigging.js';
import { ActionMenu } from './actionMenu.js';

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
function _note(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}
const _cheb = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));
const _nice = (id) => String(id || '').replace(/_/g, ' ');
const _day = (game) => (game && game.world && game.world.day) || 0;

/** Use one of an item from the pack. */
function _use(game, id) {
    const inv = game && game.player && game.player.inventory;
    if (!inv || !id || !(inv[id] > 0)) return false;
    inv[id] -= 1;
    if (inv[id] <= 1e-9) delete inv[id];
    if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
    return true;
}

export const InnerMapDowned = {
    // Those under the earth still breathing: { g, npc, hex, q, r, key, at, until, awake, nextCry, bark, rescuer, witnessed }
    _live: [],
    _lastKey: null,
    _callAt: new Map(),

    reset() {
        this._live = [];
        this._lastKey = null;
        this._callAt.clear();
    },

    // ──────────── THE MENU ────────────

    /** Entries for a downed NPC (unconscious, bleeding, bound). */
    menuItems(game, npc) {
        const out = [];
        if (!npc || !Downed.isDown(npc)) return out;
        const inv = (game && game.player && game.player.inventory) || {};
        const st = Downed.stateOf(npc);
        out.push({ type: 'action', action: 'downed_look', label: 'Look at Them', icon: '👁️', desc: Downed.label(npc), npc });
        if (st === 'bleeding') {
            const t = Downed.tendItem(inv);
            out.push(t ? { type: 'action', action: 'downed_tend', label: 'Bind the Wound', icon: '🩹', desc: `Stop the bleeding (uses 1 ${_nice(t)})`, npc, item: t }
                : { type: 'disabled', label: 'Bind the Wound: you have no poultice or cloth' });
        }
        if (!npc._bound) {
            const b = Downed.bindItem(inv);
            out.push(b ? { type: 'action', action: 'downed_bind', label: 'Tie Them Up', icon: '🪢', desc: `Hands and feet (uses 1 ${_nice(b)}). They won't run or fight when they wake.`, npc, item: b }
                : { type: 'disabled', label: 'Tie Them Up: you have no rope' });
        } else {
            out.push({ type: 'action', action: 'downed_untie', label: 'Untie Them', icon: '✂️', desc: st === 'bound' ? 'Let them go' : 'Cut the rope off them', npc });
        }
        if (!npc._gagged) {
            const g = Downed.gagItem(inv);
            if (g) out.push({ type: 'action', action: 'downed_gag', label: 'Gag Them', icon: '🤐', desc: `Stop their mouth (uses 1 ${_nice(g)}): no calling for help`, npc, item: g });
            else out.push({ type: 'disabled', label: 'Gag Them: you have no cloth' });
        } else out.push({ type: 'action', action: 'downed_ungag', label: 'Take the Gag Out', icon: '😮', desc: 'Let them speak', npc });
        if (st === 'unconscious' || st === 'bleeding') {
            out.push({ type: 'action', action: 'downed_slap', label: 'Slap Them Awake', icon: '🖐️', desc: 'Bring them round in a few moments', npc });
            const d = Downed.douseItem(inv);
            if (d) out.push({ type: 'action', action: 'downed_douse', label: `Douse Them (${_nice(d)})`, icon: '💦', desc: 'Bring them round at once', npc, item: d });
        }
        if (!InnerMapCarry.handsFull()) out.push({ type: 'action', action: 'downed_drag', label: 'Drag Them', icon: '🦶', desc: 'Haul them along the ground by the heels (slower than carrying, no lift)', npc });
        // Bury them as they are: in a hole beside them, or dig one
        const hole = InnerMapDigging.holeNear(npc.q, npc.r);
        if (hole) out.push({ type: 'action', action: 'downed_bury', label: 'Bury Them Alive', icon: '⚰️', desc: 'Roll them into the hole and fill it in over them. A grave crime.', npc, holeQ: hole.q, holeR: hole.r });
        else {
            const spot = InnerMapDigging.diggableNear(npc.q, npc.r);
            if (spot) out.push({ type: 'action', action: 'downed_dig_bury', label: 'Dig a Hole and Bury Them Alive', icon: '⛏️', desc: 'Dig beside them, then bury them living. A grave crime.', npc, holeQ: spot.q, holeR: spot.r });
        }
        return out;
    },

    /** Entries on a hole when the player carries (or drags) someone living. */
    holeItems(game, q, r) {
        const npc = InnerMapCarry.person;
        if (!npc) return [];
        return [{ type: 'action', action: 'downed_bury', label: `Bury ${npc.name} Alive`, icon: '⚰️', desc: 'Lay them in the hole and fill it in over them. A grave crime.', npc, holeQ: q, holeR: r }];
    },

    /** Handle a downed order. Returns true when it was one. */
    handle(game, item) {
        if (!/^downed_/.test(item.action || '')) return false;
        const npc = item.npc;
        if (!npc) return true;
        const near = () => InnerMapCarry.person === npc || _cheb(npc.q, npc.r, InnerMap.playerInnerQ, InnerMap.playerInnerR) <= 1;
        const act = (fn) => {
            if (near()) { fn(); return; }
            const res = InnerMap.approachAndThen(npc.q, npc.r, () => { if (Downed.isDown(npc) || item.action === 'downed_look') fn(); });
            if (res === 'unreachable') _note(game, 'Blocked', `You can't reach ${npc.name}.`, 'error');
        };
        switch (item.action) {
            case 'downed_look': this.look(game, npc); return true;
            case 'downed_tend': act(() => this.tend(game, npc, item.item)); return true;
            case 'downed_bind': act(() => this.bind(game, npc, item.item)); return true;
            case 'downed_untie': act(() => this.untie(game, npc)); return true;
            case 'downed_gag': act(() => this.gag(game, npc, item.item)); return true;
            case 'downed_ungag': act(() => { npc._gagged = false; _note(game, '😮 Ungagged', `You pull the gag out of ${npc.name}'s mouth.`); }); return true;
            case 'downed_slap': act(() => this.rouse(game, npc, 'slap')); return true;
            case 'downed_douse': act(() => this.rouse(game, npc, 'douse', item.item)); return true;
            case 'downed_drag': act(() => InnerMapCarry.pickUp(game, npc, { drag: true })); return true;
            case 'downed_bury': this.startBury(game, npc, item.holeQ, item.holeR, false); return true;
            case 'downed_dig_bury': this.startBury(game, npc, item.holeQ, item.holeR, true); return true;
            default: return true;
        }
    },

    look(game, npc) {
        const st = Downed.stateOf(npc);
        const now = _now();
        const parts = [`${npc.name}: ${Downed.label(npc) || 'on their feet'}.`];
        if (st === 'bleeding') parts.push(`Blood pools under them; at this rate they have perhaps ${Math.max(5, Math.round((npc._bleed.until - now) / 1000))} seconds.`);
        else if (st === 'unconscious') parts.push(npc._ko && npc._ko.until - now < 15000 ? 'They are stirring.' : 'Out cold.');
        if (st === 'bound') parts.push(npc._gagged ? 'Tied hand and foot, a gag in their mouth.' : 'Tied hand and foot.');
        _note(game, `👁️ ${npc.name}`, parts.join(' '), st === 'bleeding' ? 'warning' : 'info');
    },

    tend(game, npc, id) {
        if (!npc._bleed) return;
        if (!_use(game, id)) { _note(game, '🩹 Nothing to bind it with', 'You have no poultice or cloth.', 'warning'); return; }
        npc._bleed = null;
        _note(game, '🩹 The bleeding stops', `You bind ${npc.name}'s wound with ${_nice(id)}. They will live.`, 'success');
    },

    bind(game, npc, id) {
        if (npc._bound) return;
        if (!_use(game, id)) { _note(game, '🪢 No rope', 'You have no rope.', 'warning'); return; }
        npc._bound = true;
        _note(game, '🪢 Tied up', `You tie ${npc.name} hand and foot. When they wake, they won't get far.`, 'info');
    },

    untie(game, npc) {
        if (!npc._bound) return;
        npc._bound = false;
        npc._gagged = false;
        if (npc.state === 'bound') {
            npc.state = InnerMap._insideBuilding ? 'inside_building' : 'idle';
            npc.idleTimer = 1;
            npc._broke = true;
            InnerMapReactions.bark(npc, Downed.line('rescued', `${npc.id}|untie`) || '...', 3.5);
            InnerMapReactions._flee(npc, { indoors: !!InnerMap._insideBuilding });
        }
        _note(game, '✂️ Untied', `You untie ${npc.name}.`, 'info');
    },

    gag(game, npc, id) {
        if (npc._gagged) return;
        if (!_use(game, id)) { _note(game, '🤐 Nothing to gag them with', 'You have no cloth.', 'warning'); return; }
        npc._gagged = true;
        _note(game, '🤐 Gagged', `You stuff ${_nice(id)} into ${npc.name}'s mouth and tie it.`, 'info');
    },

    rouse(game, npc, how, id) {
        if (npc.state !== 'unconscious' || !npc._ko) return;
        if (how === 'douse' && !_use(game, id)) return;
        npc._ko.until = Downed.rouse(npc._ko, how, _now());
        _note(game, how === 'douse' ? '💦 Doused' : '🖐️ Slapped', `${npc.name} groans and stirs.`, 'info');
    },

    // ──────────── KNOCKOUT, WAKING, BLEEDING ────────────

    /** Just knocked out: a hard blow may leave them bleeding out (their blood pooling under them). */
    onKnockedOut(npc, game, overkill = 0) {
        npc._bleed = Downed.rollBleed(_now(), overkill);
        if (npc._bleed) {
            InnerMapCombat._blood.push({ q: npc.q, r: npc.r, key: InnerMapCombat._mapKey(), at: _now(), day: _day(game), size: 0.85, name: npc.name, drip: false, victim: npc });
            _note(game, '🩸 Bleeding out', `${npc.name} is bleeding badly. Bind the wound, or they will die where they lie.`, 'warning');
        }
    },

    /** They come round tied up: no running, no fighting — they lie there and plead, threaten or call out. */
    wokeBound(npc) {
        npc.state = 'bound';
        npc._ko = null;
        npc.path = null;
        npc.moveProgress = 0;
        npc.idleTimer = 9999;
        this._callAt.set(npc.id, _now() + 1500);
    },

    /** Each frame, from the game loop. */
    update(deltaTime, game) {
        const now = _now();
        const key = InnerMap.active ? InnerMapCombat._mapKey() : null;
        // Bleeding out, and the bound awake (on the map the player is on)
        for (const npc of (InnerMap.active ? InnerMap.npcs || [] : []).slice()) {
            if (npc.state === 'unconscious' && Downed.bledOut(npc, now)) { this._bleedOut(game, npc); continue; }
            if (npc.state === 'bound') this._boundTick(game, npc, now);
        }
        // Those under the earth
        for (const lb of this._live.slice()) this._liveTick(game, lb, now, key);
        this._lastKey = key;
    },

    _bleedOut(game, npc) {
        if (InnerMapCarry.person === npc) InnerMapCarry.putDown(game);
        npc._bleed = null;
        npc._deathCause = 'bled to death';
        npc.state = 'idle';
        npc._ko = null;
        InnerMapCombat._killNPC(npc, game);
        _note(game, '🩸 Bled to death', `${npc.name} has bled to death.`, 'warning');
    },

    _boundTick(game, npc, now) {
        npc.path = null;
        npc.moveProgress = 0;
        npc.idleTimer = 9999;
        const C = Downed.config().boundCall;
        const next = this._callAt.get(npc.id) || 0;
        if (now < next) return;
        this._callAt.set(npc.id, now + (Number(C.callSeconds) || 7) * 1000);
        const said = Downed.boundLine(npc, `${Math.floor(now / 1000)}`);
        if (said.line) InnerMapReactions.bark(npc, said.line, 3.5);
        if (!said.heard || !game || !game.player || npc._calledOut) return;
        // Heard: the street comes — the watch for whoever did it, a passer-by to untie them
        const hear = Number(C.hearRadius) || 9;
        // (indoors, everyone in the room hears; out on the street, not those indoors)
        const by = (InnerMap.npcs || []).filter(n => n !== npc && !Downed.stateOf(n) && n.state !== 'gone' && (InnerMap._insideBuilding || n.state !== 'inside_building') && _cheb(n.q, n.r, npc.q, npc.r) <= hear);
        if (!by.length) return;
        npc._calledOut = true;
        // (who tied them up: whoever the street finds by them — a crime, as a beating is)
        InnerMapReactions.onViolence(game, npc, 'assault');
        const helper = by.filter(n => n.type !== 'guard').sort((a, b) => _cheb(a.q, a.r, npc.q, npc.r) - _cheb(b.q, b.r, npc.q, npc.r))[0];
        if (helper) {
            InnerMapReactions.bark(helper, Downed.line('hearCry', `${helper.id}|bound`) || 'Hold on!', 3);
            InnerMapReactions._approach(helper, { q: npc.q, r: npc.r }, 8);
            npc._helper = { id: helper.id, at: now };
        }
    },

    // ──────────── BURIED ALIVE ────────────

    /** Bury a downed person living: into the hole beside them (or dig one first). */
    startBury(game, npc, hq, hr, dig) {
        if (!npc || !Downed.isDown(npc)) return;
        const bury = () => {
            InnerMapDigging.start(game, 'bury', hq, hr, {
                verb: 'Burying', onDone: (g2, tile) => this.buryAlive(g2 || game, npc, tile),
            });
        };
        if (!dig) { bury(); return; }
        const res = InnerMapDigging.start(game, 'dig', hq, hr, {
            verb: 'Digging', onDone: (g2, tile) => {
                if (!InnerMapDigging.canDig(tile)) return;
                InnerMapDigging.setGround(tile, 'hole', { day: _day(game) });
                bury();
            },
        });
        if (res === 'unreachable') _note(game, 'Blocked', 'You can\'t reach that spot.', 'error');
    },

    /** The earth goes in over someone living: the grave on the record, the cries begin. */
    buryAlive(game, npc, tile) {
        if (!tile || !tile._dug || tile._dug.kind !== 'hole' || !Downed.isDown(npc)) return null;
        const carried = InnerMapCarry.person === npc;
        if (!carried && _cheb(npc.q, npc.r, tile.q, tile.r) > 1) { _note(game, '⚰️ Too far', `${npc.name} isn't by the hole.`, 'warning'); return null; }
        const day = _day(game), now = _now();
        if (carried) InnerMapCarry.letGo();
        // The street sees it done (the scene is the hole): horror, and a murder on the record
        npc.q = tile.q; npc.r = tile.r;
        // (seen: a murder on the record now, the street in horror; unseen: only if they die down there — _die)
        const sight = game && game.player ? StreetCrime.selectWitnesses(InnerMap.npcs || [], { q: tile.q, r: tile.r, indoors: !!InnerMap._insideBuilding }, npc) : [];
        const seen = sight.some(w => w.seen) ? InnerMapReactions.onViolence(game, npc, 'murder') : null;
        const witnessed = !!(seen && seen.witnesses && seen.witnesses.some(w => w.seen));
        for (const w of (seen && seen.witnesses) || []) {
            if (w.seen && w.role !== 'guard') InnerMapReactions.bark(w.npc, Downed.line('horror', `${w.npc.id}|${day}`) || '!', 4);
        }
        // Off the street, into the ground
        for (const list of [InnerMap.npcs, InnerMap._outerMapState && InnerMap._outerMapState.npcs]) {
            const i = list ? list.indexOf(npc) : -1;
            if (i >= 0) list.splice(i, 1);
        }
        const hex = InnerMap._burialHex();
        const g = Burials.bury(game && game.world, hex, tile.q, tile.r, { name: npc.name, type: npc.type, icon: npc.icon, preset: npc.preset, _npc: npc, day }, day, InnerMap._graveSettlement());
        if (g) {
            g.buriedAlive = true;
            InnerMap.layBurial(tile.q, tile.r, g, day);
        } else InnerMapDigging.setGround(tile, 'grave', { day, name: npc.name, buriedAlive: true });
        const lb = { g: g || tile._dug, npc, hex, q: tile.q, r: tile.r, key: InnerMapCombat._mapKey(), witnessed, ...Downed.liveBurial(npc, now) };
        this._live.push(lb);
        _note(game, '⚰️ Buried alive', `You shovel the earth in over ${npc.name}. ${lb.awake ? 'They are screaming.' : 'They have not woken — yet.'}`, 'warning');
        return lb;
    },

    /** The live burial under (q, r) on this map, if any. */
    liveAt(q, r) {
        const key = InnerMap.active ? InnerMapCombat._mapKey() : null;
        return this._live.find(l => l.key === key && l.q === q && l.r === r) || null;
    },

    _liveTick(game, lb, now, key) {
        const here = lb.key === key;
        // The player has left the town (not just stepped indoors): it ends one way or the other
        const sameTown = key && lb.key && key.split('|')[0] === lb.key.split('|')[0];
        if (!InnerMap.active || !sameTown) {
            if (Downed.offMapRescue(lb)) this.rescue(game, lb, null, true);
            else this._die(game, lb);
            return;
        }
        if (!Downed.stillAlive(lb, now)) { this._die(game, lb); return; }
        // They come round down there (their knockout ran out)
        const ko = lb.npc._ko;
        if (!lb.awake && ko && now >= ko.until) { Downed.wakeUnderEarth(lb, now); lb.npc._ko = null; }
        if (!here) return;
        const line = Downed.cry(lb, now, `${lb.npc.id}`);
        if (line) {
            lb.bark = { text: line, until: now + 2500 };
            // (a bubble over the mound, as a line said over a place: world/innerMap/townScenes.js)
            if (InnerMap._sceneSpot) InnerMap._sceneSpot(lb.q, lb.r + 0.4, line, 2.5);
            try { audioManager.playSFX('muffled_cry'); } catch { /* sound is best-effort */ }
            this._hearCry(game, lb);
        }
        // A passer-by digging them out
        const R = lb.rescuer;
        if (R) {
            const n = (InnerMap.npcs || []).find(x => x.id === R.id);
            if (!n || Downed.stateOf(n) || n.state === 'gone') { lb.rescuer = null; return; }
            if (_cheb(n.q, n.r, lb.q, lb.r) <= 1) {
                n.path = null; n.idleTimer = 3; if (n.state === 'walking') n.state = 'idle';
                if (R.start == null) R.start = now;
                if (now - R.start >= (Number(Downed.config().buryAlive.rescueSeconds) || 10) * 1000) this.rescue(game, lb, n, false);
            }
        }
    },

    /** Someone within earshot of the cries: they may go and dig. */
    _hearCry(game, lb) {
        if (lb.rescuer) return;
        const A = Downed.config().buryAlive;
        const hear = Number(A.hearRadius) || 8;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        for (const n of InnerMap.npcs || []) {
            if (Downed.stateOf(n) || n.state === 'gone' || n.state === 'inside_building' || n._dialogFrozen) continue;
            if (_cheb(n.q, n.r, lb.q, lb.r) > hear) continue;
            if (!Downed.rescueRoll()) continue;
            lb.rescuer = { id: n.id, start: null };
            InnerMapReactions.bark(n, Downed.line('hearCry', `${n.id}|${lb.q},${lb.r}`) || 'Dig!', 3.5);
            InnerMapReactions._approach(n, { q: lb.q, r: lb.r }, (Number(A.rescueSeconds) || 10) + 15);
            _note(game, '👂 Heard', `${n.name} has heard the cries under the earth${_cheb(pq, pr, lb.q, lb.r) <= 3 ? ' — and seen you by the mound' : ''}, and is coming to dig.`, 'warning');
            return;
        }
    },

    /** Silence under the mound: they die there, the true cause on every record that keeps the dead. */
    _die(game, lb) {
        this._live.splice(this._live.indexOf(lb), 1);
        const day = _day(game), npc = lb.npc;
        const A = Downed.config().buryAlive;
        Downed.settleBurial(lb.g, 'died', day);
        if (lb.g && lb.g.body) lb.g.body.cause = A.cause;
        const player = game && game.player;
        // The town's roll and annals: the true cause (or a vanishing, if no one saw)
        if (npc._person && npc._folk) {
            Townsfolk.slay(npc._folk, npc._person, day, lb.witnessed ? `${A.cause} by ${(player && player.name) || 'a stranger'}` : A.cause);
            Townsfolk.record(npc._folk, game && game.world, day, { k: 'died', a: npc._person.id, x: lb.witnessed ? A.cause : 'went missing' });
        }
        // Their kin grieve, and hate the one who did it (on the street, and on the roll)
        NpcDisposition.onNpcHarmed(npc, (InnerMap.active ? InnerMap.npcs : []) || [], 'murder');
        // An unseen killing still weighs (heat, karma); a seen one was recorded at the graveside
        if (!lb.witnessed && player && game.world) {
            const hex = String(lb.hex || '').split(',').map(Number);
            StreetCrime.record(player, game.world, { crime: 'murder', victim: npc, witnesses: [], q: hex[0], r: hex[1], scene: { q: lb.q, r: lb.r, indoors: false }, onMap: [] });
        }
        if (lb.key === (InnerMap.active ? InnerMapCombat._mapKey() : null)) _note(game, '⚰️ Silence', `The cries under the earth have stopped. ${npc.name} is dead.`, 'warning');
    },

    /**
     * Dug out alive: by the player (by: null), a passer-by (by: npc), or someone who heard after the
     * player left (offMap). They live — in terror, and they tell of it.
     */
    rescue(game, lb, by, offMap = false) {
        const i = this._live.indexOf(lb);
        if (i < 0) return null;
        this._live.splice(i, 1);
        const day = _day(game), npc = lb.npc, player = game && game.player;
        const A = Downed.config().buryAlive;
        Downed.settleBurial(lb.g, 'rescued', day);
        Burials.unbury(game && game.world, lb.hex, lb.q, lb.r);
        // Terrified, and they hate (or fear) the one who did it
        npc._bound = by ? false : npc._bound;
        npc._gagged = by ? false : npc._gagged;
        npc._ko = null;
        npc._bleed = null;
        npc.mood = 'fear';
        npc._broke = true;
        NpcDisposition.adjustDisposition(npc, Number(A.rescuedDisposition) || -70, player);
        const vuid = StreetCrime.npcKey(npc);
        StreetCrime.remember(npc, { k: 'murder', v: npc.name, vu: vuid, d: day, town: null, rel: 'victim', mood: 'fear', seen: true, buried: true }, 0, player);
        // Seen at the graveside: a murder on the record — they lived, so it is the attempt, a grave assault
        const inc = npc._incidentId != null && player ? StreetCrime._incident(player, npc._incidentId) : null;
        if (inc && inc.k === 'murder') { inc.k = 'assault'; inc.buriedAlive = true; npc._crime = 'assault'; }
        // (a watch scene already open on it says so now: no 'lies dead' over someone standing there)
        const sc = game && game._scene;
        if (inc && sc && sc.kind === 'street_watch' && sc.state && sc.state.incidentId === inc.id) ActionMenu.showScene(game);
        // They report it (unless it was already on the record from the graveside)
        if (player && game.world && !lb.witnessed) {
            const hex = String(lb.hex || '').split(',').map(Number);
            const witnesses = [{ npc, seen: true, role: 'bystander', mood: 'fear' }];
            if (by) witnesses.push({ npc: by, seen: true, role: 'bystander', mood: 'anger' });
            StreetCrime.record(player, game.world, { crime: 'assault', victim: npc, witnesses, q: hex[0], r: hex[1], scene: { q: lb.q, r: lb.r, indoors: false }, onMap: [] });
        }
        if (offMap) return lb;
        // Up out of the earth, beside an open hole
        const tile = InnerMap.getTile(lb.q, lb.r);
        if (tile) {
            if (InnerMap.clearBurialMarker) InnerMap.clearBurialMarker(lb.q, lb.r);
            InnerMapDigging.setGround(tile, 'hole', { day });
        }
        const spot = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dq, dr]) => InnerMap.getTile(lb.q + dq, lb.r + dr)).find(t => t && t.subTerrain && t.subTerrain.passable) || tile;
        npc.q = npc.prevQ = npc.targetQ = spot ? spot.q : lb.q;
        npc.r = npc.prevR = npc.targetR = spot ? spot.r : lb.r;
        npc.path = null;
        npc.moveProgress = 0;
        npc._lyingIn = null;
        if (InnerMap.npcs && !InnerMap.npcs.includes(npc)) InnerMap.npcs.push(npc);
        if (npc._bound) { this.wokeBound(npc); }
        else {
            npc.state = 'idle';
            npc.idleTimer = 2;
            InnerMapReactions._flee(npc, { indoors: false });
        }
        InnerMapReactions.bark(npc, Downed.line('rescued', `${npc.id}|${day}`) || '*gasping*', 4);
        _note(game, '⛏️ Dug out alive', by ? `${by.name} has dug ${npc.name} out of the earth, alive. They will tell everyone what was done to them.` : `You dig ${npc.name} out of the earth, alive, choking on the dirt. They stare at you in terror.`, by ? 'error' : 'warning');
        return lb;
    },

    /** On loading a game: anyone left under the earth when it was saved died there. */
    settleAll(world) {
        this.reset();
        const all = world && world.burials;
        if (!all) return 0;
        let n = 0;
        for (const [hex, rec] of Object.entries(all)) {
            for (const g of Object.values(rec || {})) {
                if (!Downed.unresolved(g)) continue;
                Downed.settleBurial(g, 'died', g.day);
                n++;
                // The roll: they did not come home
                const [q, r] = hex.split(',').map(Number);
                const t = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
                const folk = t && t.settlement && t.settlement.folk;
                const p = folk && g.pid != null ? Townsfolk.get(folk, g.pid) : null;
                if (p) Townsfolk.slay(folk, p, g.day, Downed.config().buryAlive.cause);
            }
        }
        return n;
    },

    // ──────────── DRAWING ────────────

    /** The mounds that still breathe: the earth stirring, a muffled cry over them. */
    renderMounds(ctx, camera, T) {
        if (!this._live.length || !InnerMap.active) return;
        const key = InnerMapCombat._mapKey(), now = _now(), ds = T * camera.zoom;
        for (const lb of this._live) {
            if (lb.key !== key) continue;
            const s = camera.worldToScreenFast(lb.q * T + T / 2, lb.r * T + T / 2);
            const sx = s.x, sy = s.y;
            const k = Downed.stir(lb, now);
            if (k > 0) {
                ctx.save();
                // the mound heaving: clods of earth thrown up and falling back, a crack opening over them
                const cl = Math.max(3, Math.round(ds * 0.075));
                for (let i = 0; i < 9; i++) {
                    const ph = now / 1000 * (2.6 + i * 0.55) + i * 1.9;
                    const up = Math.max(0, Math.sin(ph)) * ds * 0.16 * k;
                    const x = sx + Math.cos(i * 2.4) * ds * 0.17, y = sy + Math.sin(i * 1.7) * ds * 0.3 - up;
                    ctx.fillStyle = 'rgba(0,0,0,0.25)';
                    ctx.fillRect(Math.round(x), Math.round(y + up + cl * 0.6), cl, Math.max(1, Math.round(cl * 0.35)));
                    ctx.fillStyle = i % 3 === 0 ? '#4a3220' : i % 3 === 1 ? '#7a5838' : '#93704a';
                    ctx.fillRect(Math.round(x), Math.round(y), cl, cl);
                    ctx.fillStyle = 'rgba(255,235,200,0.25)';
                    ctx.fillRect(Math.round(x), Math.round(y), cl, Math.max(1, Math.round(cl * 0.3)));
                }
                ctx.strokeStyle = `rgba(30, 18, 8, ${0.35 + 0.4 * k})`;
                ctx.lineWidth = Math.max(1.5, ds * 0.03);
                ctx.beginPath();
                ctx.moveTo(sx - ds * 0.08, sy - ds * 0.25);
                ctx.lineTo(sx + ds * 0.04, sy - ds * 0.05);
                ctx.lineTo(sx - ds * 0.05, sy + ds * 0.12);
                ctx.lineTo(sx + ds * 0.06, sy + ds * 0.3);
                ctx.stroke();
                ctx.restore();
            }
        }
    },
};
