// ============================================
// INNER MAP HITCH — your horse in the shafts of your horse cart
// ============================================
// A horse cart of your own (the market good horse_cart: data/carts.json
// kinds.horsecart, sold at the woodworkers' stalls) stands beside you on every
// street map, as the handcart does (ui/innerMapCarts.js). It is too heavy to
// push by hand: with your grown horse walking with you (ui/innerMapPets.js;
// its species' streetHitch, data/animalCompanions.json) and the cart within
// reach, its menu offers "Hitch [Horse] to the Cart". Hitched, you sit up on
// the seat and drive: the horse walks in the shafts on your tile, the cart
// trailing behind on the path (the cart's train: systems/carts.js follow), at
// the horse's pace (Carts.pushSpeed reads cart.horse: hitch.speed, laden a
// little slower) — far quicker than a handcart pushed.
//
//   - riding and driving are exclusive (the ridden horse can't be hitched; the
//     hitched one can't be ridden: InnerMapPets._whyNotRide);
//   - you climb down of yourself, the horse left standing in the shafts, at a
//     door (going in), where the cart can't go (the water, deeper than a ford;
//     stairs), to fight, to climb, to set to a task, with your hands full,
//     knocked down — and by the menu ("Climb Down from the Cart");
//   - "Unhitch [Horse]": the horse out of the shafts, back in your file;
//   - a parked hitched cart stays where you left it, the horse in its shafts;
//     player.streetHitch ({ horse, driving }: saved, SaveLoad
//     EXTRA_PLAYER_FIELDS) brings it onto the next street map hitched, and
//     you on its seat if you drove off the edge of the last one.
//
// Drawn here (collect, from innerMapLayers/entities.js): the horse in harness
// ahead of the cart in its four facings, walking in step, and you on the seat
// (the player's own pass draws nothing while you drive). The cart itself is
// drawn by ui/innerMapCarts.js.
//
//   update(dt, game)                       after InnerMapCarts.update (ui/game/gameLoop.js)
//   menuItems(game, q, r) / handle(game, item)   through ui/innerMapUI.js (actions hitch_*)
//   driving()                              you sit up on the seat now
//   collect(items, ctx, camera, T, preset) the horse and the driver, depth-sorted

import { InnerMap } from '../world/innerMap.js';
import { Carts } from '../systems/carts.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { InnerMapCarts } from './innerMapCarts.js';
import { InnerMapPets } from './innerMapPets.js';
import { InnerMapCarry } from './innerMapCarry.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapBattle } from './innerMapBattle.js';
import { InnerMapAnimals } from './innerMapAnimals.js';
import { InnerMapCharacters } from './innerMapCharacters.js';

const T_PX = 32;
const STEP = [[0, -1], [-1, 0], [0, 1], [1, 0]];   // facing 0 up, 1 left, 2 down, 3 right
const FACE = ['up', 'left', 'down', 'right'];
const AROUND4 = [[0, 1], [1, 0], [-1, 0], [0, -1]];
const AROUND8 = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

function _note(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

export const InnerMapHitch = {
    _tiles: null,
    _lastGround: null,   // the last tile you drove over that the cart can take (the horse is left there)

    // ──────────── WHAT IS WHERE ────────────

    _cfg() { return Carts.config().hitch; },

    /** Your horse cart on the street map you are on (none indoors), or null. */
    cart() {
        return InnerMap.streetCarts().find(c => c.owner === 'player' && Carts.kind(c.kind).horse) || null;
    },

    /** Your horse cart on the street's list even from indoors. */
    _cartAny() {
        return (InnerMap.carts || []).find(c => c.owner === 'player' && Carts.kind(c.kind).horse) || null;
    },

    /** You sit up on the seat driving it now. */
    driving() {
        const c = InnerMapCarts.pushing;
        return !!(c && c.horse);
    },

    /** The horse's walking record (ui/innerMapPets.js) by its id, or null. */
    _horseRec(id) {
        return InnerMapPets._pets.find(p => p.a && p.a.id === id) || null;
    },

    /** Can this animal be put in the shafts at all (its species' streetHitch)? */
    _canDraw(a) {
        const sp = a && AnimalCompanions.species(a.species);
        return !!(sp && sp.streetHitch);
    },

    /** Is the horse still walking the streets with you, grown? */
    _horseWalks(game, id) {
        const a = InnerMapPets.walkers(game.player, game.world).find(x => x.id === id);
        return !!(a && this._canDraw(a) && !AnimalCompanions.isYoung(a, game.world));
    },

    /** Ground a horse and its cart can take: the cart's (world/innerMap/carts.js), and no water deeper than a ford. */
    _ground(q, r) {
        if (!InnerMap._cartGround(q, r)) return false;
        const t = InnerMap.tiles[r][q];
        return !(t._wet && !t._ford && !t._bridge && !t._pier && !t.isRoad);
    },

    /** The tile before the cart where its horse stands (its facing first, else any side free); the cart turned to face it. */
    _frontOf(c) {
        const body = c.trail[0];
        const ok = (q, r) => this._ground(q, r) && !InnerMap.cartAt(q, r);
        const [fq, fr] = STEP[c.facing] || STEP[2];
        let at = ok(body.q + fq, body.r + fr) ? { q: body.q + fq, r: body.r + fr } : null;
        if (!at) {
            for (const [dq, dr] of AROUND4) {
                if (ok(body.q + dq, body.r + dr)) { at = { q: body.q + dq, r: body.r + dr }; break; }
            }
        }
        if (at) c.facing = Carts.facingOf(body, at);
        return at;
    },

    /** The horse's tile when the cart stands: kept if still before it, else found again. */
    _standAt(c, prefer = null) {
        const body = c.trail[0];
        for (const t of [prefer, c.horseAt]) {
            if (t && _cheb(t, body) === 1 && Math.abs(t.q - body.q) + Math.abs(t.r - body.r) === 1 && this._ground(t.q, t.r)) {
                c.facing = Carts.facingOf(body, t);
                return { q: t.q, r: t.r };
            }
        }
        return this._frontOf(c);
    },

    // ──────────── RULES ────────────

    /** Why the horse can't be hitched to this cart now, or null. */
    whyNotHitch(game, c, m) {
        const a = m && m.a;
        if (!c) return 'You have no horse cart here.';
        if (!a || !this._canDraw(a)) return 'Only a horse goes in the shafts.';
        if (AnimalCompanions.isYoung(a, game.world)) return `${a.name} is a foal yet, too young for harness.`;
        if (c.horse) return 'There is a horse in the shafts already.';
        if (InnerMapPets.riding) return 'Get down from the saddle first.';
        if (InnerMapCarry.handsFull()) return 'Your hands are full: put down what you carry first.';
        if (InnerMapCarts.pushing) return 'Let go of the cart you are hauling first.';
        if (InnerMapCombat.playerKnockedOut && InnerMapCombat.playerKnockedOut()) return 'You can barely stand.';
        if (InnerMapBattle.active || InnerMapCombat._attackState) return 'Not in the middle of a fight.';
        if (InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming()) return 'Not in the water.';
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        if (!c.trail.some(t => _cheb(t, me) <= _num(this._cfg().reach, 1))) return 'Stand beside the cart first.';
        const hq = Math.round((m.x - T_PX / 2) / T_PX), hr = Math.round((m.y - T_PX / 2) / T_PX);
        if (m.stay && _cheb({ q: hq, r: hr }, c.trail[0]) > _num(this._cfg().horseReach, 4)) return `${a.name} is waiting off where you left it: call it over first.`;
        return null;
    },

    /** Why you can't sit up and drive now, or null. */
    _whyNotDrive(game, c) {
        if (!c || !c.horse) return 'No horse in the shafts.';
        if (InnerMapPets.riding) return 'Get down from the saddle first.';
        if (InnerMapCarry.handsFull()) return 'Your hands are full: put down what you carry first.';
        if (InnerMapCarts.pushing && InnerMapCarts.pushing !== c) return 'Let go of the cart you are hauling first.';
        if (InnerMapCombat.playerKnockedOut && InnerMapCombat.playerKnockedOut()) return 'You can barely stand.';
        if (InnerMapBattle.active || InnerMapCombat._attackState) return 'Not in the middle of a fight.';
        if (InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming()) return 'Not from the water.';
        return null;
    },

    // ──────────── HITCH, DRIVE, CLIMB DOWN, UNHITCH ────────────

    /** Back the horse into the shafts and buckle the harness; then up onto the seat. */
    hitch(game, c, m) {
        const why = this.whyNotHitch(game, c, m);
        if (why) { _note(game, '🐴 Not Now', why, 'warning'); return false; }
        const at = this._frontOf(c);
        if (!at) { _note(game, '🐴 No Room', 'There is no room before the cart for the horse: wheel it somewhere clearer.', 'warning'); return false; }
        c.horse = m.a.id;
        c.horseAt = at;
        c.parked = true;
        m.stay = null;
        game.player.streetHitch = { horse: m.a.id, driving: false };
        this._place(game, c);
        _note(game, `🐴 ${m.a.name} Hitched`, `You back ${m.a.name} into the shafts and buckle the harness.`, 'info');
        this.drive(game, c);
        return true;
    },

    /** Up onto the seat, the reins in hand: you take the horse's tile, the cart behind it. */
    drive(game, c = null) {
        c = c || this.cart();
        const why = this._whyNotDrive(game, c);
        if (why) { _note(game, '🐴 Not Now', why, 'warning'); return false; }
        if (InnerMapCarts.pushing === c) return true;
        const at = this._standAt(c);
        if (!at) { _note(game, '🐴 No Room', 'The horse has no room to stand before the cart.', 'warning'); return false; }
        if (InnerMap.cancelPlayerWalk) InnerMap.cancelPlayerWalk();
        InnerMap.playerInnerQ = at.q;
        InnerMap.playerInnerR = at.r;
        if (!InnerMapCarts.take(game, c, { hitched: true, quiet: true })) return false;
        c.horseAt = null;
        this._lastGround = { q: at.q, r: at.r };
        const st = game.player.streetHitch || (game.player.streetHitch = { horse: c.horse });
        st.horse = c.horse;
        st.driving = true;
        this._place(game, c);
        const m = this._horseRec(c.horse);
        _note(game, '🐴 On the Seat', `You climb up and take the reins. ${m ? m.a.name : 'The horse'} draws the cart at a brisk walk; you'll climb down of yourself at a door.`, 'info');
        return true;
    },

    /**
     * Down from the seat: the cart stands, the horse in its shafts where it stood (or the last
     * ground it could take). why: a word on it (null: quiet). opts.step false: you stay where you are
     * (you went off it yourself: into the water, at the door).
     */
    climbDown(game, why = null, opts = {}) {
        const c = InnerMapCarts.pushing;
        if (!c || !c.horse) return false;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const prefer = this._ground(me.q, me.r) ? me : this._lastGround;
        InnerMapCarts._release(game, { quiet: true });
        c.horseAt = this._standAt(c, prefer);
        if (game.player.streetHitch) game.player.streetHitch.driving = false;
        // (off the seat to the side, clear of the horse and the cart)
        if (opts.step !== false && c.horseAt && me.q === c.horseAt.q && me.r === c.horseAt.r) {
            const busy = (q, r) => (q === c.horseAt.q && r === c.horseAt.r) || InnerMap.cartAt(q, r);
            for (const from of [c.horseAt, c.trail[0]]) {
                const spot = AROUND8.map(([dq, dr]) => ({ q: from.q + dq, r: from.r + dr })).find(p => {
                    const t = InnerMap.tiles[p.r] && InnerMap.tiles[p.r][p.q];
                    return t && !busy(p.q, p.r) && InnerMap._playerMayEnter(t, p.q, p.r) && !(t.isWater || t._isDoor);
                });
                if (spot) { InnerMap.playerInnerQ = spot.q; InnerMap.playerInnerR = spot.r; break; }
            }
        }
        this._place(game, c);
        if (why) _note(game, '🐴 Climbed Down', why, 'info');
        return true;
    },

    /** The horse out of the shafts: it falls in behind you again. */
    unhitch(game, why = null) {
        const c = this._cartAny();
        if (this.driving()) this.climbDown(game, null);
        const name = c && c.horse ? (this._horseRec(c.horse) || { a: { name: 'The horse' } }).a.name : 'The horse';
        if (c) { c.horse = null; c.horseAt = null; c.parked = true; }
        if (game.player) game.player.streetHitch = null;
        InnerMapPets.hitched = null;
        InnerMapPets._hitchPos = null;
        _note(game, '🐴 Unhitched', why || `You unbuckle the harness and lead ${name} out of the shafts.`, 'info');
        return true;
    },

    // ──────────── EACH FRAME ────────────

    update(dt, game) {
        const player = game && game.player;
        if (!player) return;
        // Off the street map (crossing to the next, a load): the hitch is kept on the player
        if (!InnerMap.active) { InnerMapPets.hitched = null; InnerMapPets._hitchPos = null; return; }
        const st0 = player.streetHitch;
        if (InnerMap._insideBuilding) {
            // (gone in: the cart was left at the step — ui/innerMapCarts.js let go of it — the horse in its shafts)
            const c = this._cartAny();
            if (c && c.horse && st0 && st0.driving && InnerMapCarts.pushing !== c) this._parked(c, player);
            return;
        }
        if (InnerMap._deck || InnerMap._underwater) return;
        if (InnerMap.tiles !== this._tiles && InnerMapCarts._tiles === InnerMap.tiles) {
            this._tiles = InnerMap.tiles;
            this._newMap(game);
        } else if (InnerMapCarts._tiles === InnerMap.tiles && !this._cartAny() && Carts.on() && Carts.owns(player, 'horsecart')) {
            // (back on a map kept from before, or one bought while here: it stands beside you now)
            this._newMap(game);
        }
        const c = this.cart();
        if (!c || !c.horse) {
            InnerMapPets.hitched = null;
            InnerMapPets._hitchPos = null;
            if (c && st0) player.streetHitch = null;
            return;
        }
        let st = player.streetHitch;
        if (!st || st.horse !== c.horse) st = player.streetHitch = { horse: c.horse, driving: InnerMapCarts.pushing === c };
        // (the horse sent back to wait, sold, dead: out of the shafts)
        if (!this._horseWalks(game, c.horse)) {
            this.unhitch(game, 'Your horse is not with you: the cart stands unhitched.');
            return;
        }
        const driving = InnerMapCarts.pushing === c;
        if (st.driving && !driving) this._parked(c, player);
        else if (driving) {
            const why = this._mustClimbDown(game, c);
            if (why != null) this.climbDown(game, why || null, { step: false });
            else {
                this._lastGround = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
                // (someone laid on it or lifted off: the pace again)
                if (InnerMapCarts._baseSpeed != null) InnerMap._playerSpeed = InnerMapCarts._baseSpeed * Carts.pushSpeed(player, c);
            }
        }
        this._place(game, c);
    },

    /** Let go of elsewhere (indoors, knocked down, hands full): the horse stands where it last could. */
    _parked(c, player) {
        c.horseAt = this._standAt(c, this._lastGround);
        if (player.streetHitch) player.streetHitch.driving = false;
    },

    /** Must you climb down now? A word on why ('' quiet), or null to drive on. */
    _mustClimbDown(game, c) {
        const name = (this._horseRec(c.horse) || { a: { name: 'The horse' } }).a.name;
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        const t = InnerMap.tiles[r] && InnerMap.tiles[r][q];
        if (game.player.boardedShip || InnerMapPets.riding) return '';
        if (InnerMapBattle.active || InnerMapCombat._attackState) return `You jump down from the seat to fight, ${name} left in the shafts.`;
        const pos = InnerMap.getPlayerWorldPos();
        if (pos.climbing || InnerMap._climbRequest) return 'You climb down from the cart.';
        const ia = InnerMap._activeInteraction;
        if (ia && !ia.done) return 'You climb down from the cart to set to it.';
        if (!this._ground(q, r)) {
            if (t && t._isDoor) return `You leave the horse cart at the door, ${name} standing in the shafts.`;
            if (t && (t.isWater || t._wet || !t.subTerrain || !t.subTerrain.passable)) return `${name} won't take the cart into the water: you climb down and leave it on the bank.`;
            return 'The cart can\'t go there: you climb down and leave it standing.';
        }
        return null;
    },

    /** Where the horse is for ui/innerMapPets.js (its walking record follows; drawn here). */
    _place(game, c) {
        if (!c || !c.horse) { InnerMapPets.hitched = null; InnerMapPets._hitchPos = null; return; }
        InnerMapPets.hitched = c.horse;
        if (InnerMapCarts.pushing === c) {
            const pos = InnerMap.getPlayerWorldPos();
            const b = InnerMapCarts._bodyPos(c, T_PX);
            let face = c.facing;
            if (b.lead) {
                const dx = b.lead.x - b.x, dy = b.lead.y - b.y;
                if (Math.abs(dx) > 1 || Math.abs(dy) > 1) face = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 3 : 1) : (dy >= 0 ? 2 : 0);
            }
            InnerMapPets._hitchPos = { x: pos.x, y: pos.y, facing: FACE[face], moving: !!pos.walking };
            return;
        }
        const at = c.horseAt || (c.horseAt = this._standAt(c));
        if (!at) { InnerMapPets._hitchPos = null; return; }
        InnerMapPets._hitchPos = { x: at.q * T_PX + T_PX / 2, y: at.r * T_PX + T_PX / 2, facing: FACE[Carts.facingOf(c.trail[0], at)], moving: false };
    },

    /** A new street map: your horse cart beside you; hitched still, and you on its seat if you drove off the last one. */
    _newMap(game) {
        const player = game.player;
        this._lastGround = null;
        if (!Carts.on()) return;
        if (!Carts.owns(player, 'horsecart')) { player.streetHitch = null; return; }
        const st = player.streetHitch;
        const ok = st && st.horse && this._horseWalks(game, st.horse);
        if (st && !ok) player.streetHitch = null;
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        let c = this.cart();
        if (!c) {
            const spot = InnerMapCarts._freeBeside(me, ok && st.driving ? AROUND4 : [[1, 1], [-1, 1], [1, -1], [-1, -1], ...AROUND4])
                || InnerMapCarts._freeBeside(me, AROUND8);
            if (!spot) return;
            c = InnerMapCarts._add('horsecart', [spot], { owner: 'player', facing: 2 });
        }
        if (!ok) return;
        c.horse = st.horse;
        const body = c.trail[0];
        if (st.driving && Math.abs(body.q - me.q) + Math.abs(body.r - me.r) === 1 && this._ground(me.q, me.r)) {
            c.facing = Carts.facingOf(body, me);
            if (InnerMapCarts.take(game, c, { hitched: true, quiet: true })) {
                c.horseAt = null;
                this._lastGround = { ...me };
                this._place(game, c);
                return;
            }
        }
        st.driving = false;
        c.horseAt = this._frontOf(c);
        this._place(game, c);
    },

    // ──────────── THE MENU ────────────

    /** The menu's entries: your horse cart clicked (or your horse, or anywhere while you drive). */
    menuItems(game, q, r) {
        const out = [];
        if (!InnerMap.active || InnerMap._insideBuilding || !Carts.on() || !game || !game.player) return out;
        const c = this.cart();
        if (!c) return out;
        const onCart = c.trail.some(t => t.q === q && t.r === r) || (c.horseAt && c.horseAt.q === q && c.horseAt.r === r);
        const horses = InnerMapPets._pets.filter(m => m.a && this._canDraw(m.a));
        const onHorse = InnerMapPets.petsAt(q, r).some(m => horses.includes(m));
        const driving = InnerMapCarts.pushing === c;
        if (!driving && !onCart && !onHorse) return out;
        const hm = c.horse ? this._horseRec(c.horse) : null;
        const name = hm ? hm.a.name : 'your horse';
        if (driving) {
            out.push({ type: 'header', label: `🐴 Driving your horse cart (${name} in the shafts)${c.load ? ` — ${c.load.name} on it` : ''}` });
            out.push({ type: 'action', action: 'hitch_down', label: 'Climb Down from the Cart', icon: '🦶', desc: `Down from the seat: the cart stands here, ${name} in its shafts` });
            out.push({ type: 'action', action: 'hitch_off', label: `Unhitch ${name}`, icon: '🔓', desc: `Climb down and lead ${name} out of the shafts; it falls in behind you` });
            return out;
        }
        if (c.horse) {
            out.push({ type: 'header', label: `🐴 Your horse cart — ${name} in the shafts${c.load ? `, ${c.load.name} on it` : ''}` });
            const why = this._whyNotDrive(game, c);
            if (why) out.push({ type: 'disabled', label: `🐴 Drive — ${why}` });
            else out.push({ type: 'action', action: 'hitch_drive', label: 'Drive the Cart', icon: '🐴', desc: `Up onto the seat: ${name} draws it at a brisk walk (you climb down at doors)` });
            out.push({ type: 'action', action: 'hitch_off', label: `Unhitch ${name}`, icon: '🔓', desc: `Lead ${name} out of the shafts; it falls in behind you` });
            return out;
        }
        if (!horses.length) {
            if (onCart) out.push({ type: 'disabled', label: '🐴 A horse cart wants a horse: bring your horse along (Who Walks With You)' });
            return out;
        }
        for (const m of horses) {
            const why = this.whyNotHitch(game, c, m);
            if (why) out.push({ type: 'disabled', label: `🐴 Hitch ${m.a.name} — ${why}` });
            else out.push({ type: 'action', action: 'hitch_on', petId: m.a.id, label: `Hitch ${m.a.name} to the Cart`, icon: '🐴', desc: `Into the shafts, and you up on the seat: far quicker than a cart pushed by hand` });
        }
        return out;
    },

    /** A hitch order? (true when handled) */
    handle(game, item) {
        if (!item || !/^hitch_/.test(item.action || '')) return false;
        const c = this.cart();
        switch (item.action) {
            case 'hitch_on': {
                const m = this._horseRec(item.petId);
                if (!c || !m) return true;
                const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
                const act = () => { if (InnerMap.carts.includes(c)) this.hitch(game, c, m); };
                if (c.trail.some(t => _cheb(t, me) <= _num(this._cfg().reach, 1)) || !InnerMap.approachAndThen) { act(); return true; }
                const res = InnerMap.approachAndThen(c.trail[0].q, c.trail[0].r, act);
                if (res === 'unreachable') _note(game, 'Blocked', 'You can\'t reach the cart.', 'error');
                return true;
            }
            case 'hitch_drive': {
                if (!c) return true;
                const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
                const near = c.trail.some(t => _cheb(t, me) <= 1) || (c.horseAt && _cheb(c.horseAt, me) <= 1);
                if (near || !InnerMap.approachAndThen) { this.drive(game, c); return true; }
                const res = InnerMap.approachAndThen(c.trail[0].q, c.trail[0].r, () => this.drive(game, c));
                if (res === 'unreachable') _note(game, 'Blocked', 'You can\'t reach the cart.', 'error');
                return true;
            }
            case 'hitch_down': this.climbDown(game, 'You climb down from the seat; the horse stands in the shafts.'); return true;
            case 'hitch_off': this.unhitch(game); return true;
            default: return false;
        }
    },

    // ──────────── DRAWN ────────────

    /**
     * The horse in harness before the cart (walking in step while you drive), and you on the seat
     * (only the body above the cart's bed). The cart is ui/innerMapCarts.js's.
     */
    collect(items, ctx, camera, T, preset = null) {
        if (!InnerMap.active || InnerMap._insideBuilding) return;
        const c = this.cart();
        if (!c || !c.horse) return;
        const m = this._horseRec(c.horse);
        const sp = m && InnerMapPets.sprite(m.a);
        if (!sp) return;
        const H = this._cfg();
        const A = Carts.config().art.horsecart || {};
        const ds = T * camera.zoom;
        const driving = InnerMapCarts.pushing === c;
        const b = InnerMapCarts._bodyPos(c, T);
        let face = c.facing, hx, hy, moving = false;
        if (driving && b.lead) {
            const dx = b.lead.x - b.x, dy = b.lead.y - b.y;
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) face = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 3 : 1) : (dy >= 0 ? 2 : 0);
            hx = b.lead.x; hy = b.lead.y;
            moving = !!InnerMap.getPlayerWorldPos().walking;
        } else {
            const at = c.horseAt;
            if (!at) return;
            face = Carts.facingOf(c.trail[0], at);
            hx = at.q * T + T / 2; hy = at.r * T + T / 2;
        }
        const [fx, fy] = STEP[face];
        hx += fx * _num(H.horseAhead, 0.3) * T;
        hy += fy * _num(H.horseAhead, 0.3) * T;
        const W = ctx.canvas.width, Hh = ctx.canvas.height;
        const off = (sx, sy) => sx < -ds * 4 || sx > W + ds * 4 || sy < -ds * 4 || sy > Hh + ds * 4;
        const s0 = camera.worldToScreenFast(hx, hy);
        const sx = s0.x, sy = s0.y;
        const pace = Math.max(1, Carts.pushSpeed(null, c));
        if (!off(sx, sy)) {
            const pseudo = {
                id: m.a.id, facing: FACE[face], state: 'walk', moving, animT: m.t * pace, idleT: m.t, atkT: 9,
                hp: AnimalCompanions.hpOf(m.a), maxHp: AnimalCompanions.maxHp(m.a),
            };
            items.push({ sortY: hy + T / 2, zLayer: 2, sortX: hx / T, draw: () => {
                if (!InnerMapAnimals.drawAt(ctx, pseudo, sp, sx, sy + ds * 0.3, ds)) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(120,85,50,0.9)';
                    ctx.beginPath(); ctx.ellipse(sx, sy, ds * 0.4, ds * 0.22, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
            } });
        }
        // You on the seat: just after the cart in the depth sort, the bed hiding you below the hips
        if (!driving || !preset || !InnerMapCharacters.getComposited || !InnerMapCharacters.getComposited(preset)) return;
        const lead = _num(A.lead, 0.2), lift = _num(A.lift, 0.26);
        const wx = b.x + fx * lead * T, wy = b.y + fy * lead * T - (lift + _num(H.seatUp, 0.12)) * T;
        const ps = camera.worldToScreenFast(wx, wy);
        const px = ps.x, seatY = ps.y;
        if (off(px, seatY)) return;
        const maxR = Math.max(...c.trail.map(t => t.r));
        const sortY = Math.max(maxR * T + T / 2, b.y) + T / 2 - 0.5;
        const dir = face;
        items.push({ sortY, zLayer: 2, sortX: c.trail[0].q + 0.1, draw: () => {
            const cw = ds * 1.2, ch = ds * 1.8;
            const top = seatY - 42 * (ch / 64);
            ctx.save();
            ctx.beginPath();
            ctx.rect(px - cw, top - ds, cw * 2, seatY - top + ds + ds * 0.1);
            ctx.clip();
            InnerMapCharacters.drawCharacter(ctx, preset, 'ready', dir, performance.now() / 1000, px - cw / 2, top, cw, ch);
            ctx.restore();
        } });
    },
};
