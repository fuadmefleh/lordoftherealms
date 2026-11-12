// ============================================
// InnerMap — town courting: sweethearts keep each other's company
// ============================================
// Over world/innerMap/townLife.js (who goes where each hour): a townsperson
// courting someone (systems/romance.js — courting, in love or promised)
// walks out with them of an evening to a spot on the square, takes them to
// the tavern at midday or of an evening, or goes to the market for flowers
// and brings them over. The heartbroken mope at the well instead of working.
// Folk claimed by a wedding (ui/innerMapCourting.js stages it) stand where
// they were put till it is over.
//
// What they say to each other (and the ♥ over a pair) is the street map's
// business: ui/innerMapCourting.js. Draws only from Utils (seedable).
// Odds: data/romance.json → onMap.

import { InnerMap } from './_ref.js';
import { Utils } from './_imports.js';
import { Romance } from '../../systems/romance.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

Object.assign(InnerMap, {
    /** This person's sweetheart walking this map (outdoors with them), or null. */
    _sweetheartOnMap(npc, otherPid) {
        if (otherPid == null) return null;
        return (this.npcs || []).find(n => n !== npc && n._person && n._person.id === otherPid && n._folk === npc._folk && n.state !== 'gone') || null;
    },

    /** Free to be drawn away from what they are about. */
    _freeForCourting(n) {
        return !!n && n.state === 'idle' && !n._dialogFrozen && !n._fight && !n._behindCounter && !n._seatOn && !n._carry
            && !n._field && !n._vending && !n._wedding && !n.departing && n.type !== 'guard' && n._awaiting == null;
    },

    /**
     * The hour's pick for someone in love (or heartbroken): true when it took
     * them somewhere (townLife then leaves them be), false to carry on as usual.
     */
    _courtPick(npc, period) {
        const p = npc && npc._person;
        const folk = npc && npc._folk;
        if (!p || !folk || !folk.romance || npc.type === 'child' || npc.type === 'guard') return false;
        // Claimed by a wedding: stand where they were put
        if (npc._wedding) {
            npc.state = 'idle';
            npc.idleTimer = 4;
            return true;
        }
        const A = this.townArea();
        if (!A || period === 'night' || period === 'dawn') { npc._courtGift = null; return false; }
        const M = Romance.config().onMap || {};
        const rnd = Utils.random;
        const day = this.worldDay || 1;

        // A broken heart: off to the well to sigh, instead of to work
        const mood = Romance.mood(folk, p, day);
        if (mood && mood.k === 'broken' && rnd() < _num(M.mopeChance, 0.35)) {
            const spot = A.square && A.square.length ? A.square[Math.floor(rnd() * A.square.length)] : this.townSpot(rnd, A.center, 6);
            npc._moping = true;
            return this._goStand(npc, spot, 'mope');
        }
        npc._moping = false;

        const c = Romance.courtOf(folk, p.id);
        if (!c || Romance.stageIndex(c.st) < 2) { npc._courtGift = null; return false; }
        const other = this._sweetheartOnMap(npc, Romance.partnerId(c, p.id));

        // Flowers from the market, carried over to them
        if (npc._courtGift === 'buy') {
            npc._courtGift = other && other.state !== 'inside_building' ? 'give' : null;
            if (npc._courtGift && this._goStand(npc, this._findPassableAdjacentTile(other.q, other.r), 'court')) {
                npc._courtWith = other.id;
                if (other.state === 'idle') other.idleTimer = Math.max(other.idleTimer || 0, 10);
                return true;
            }
            npc._courtGift = null;
        }
        if (!other) return false;
        if ((period === 'morning' || period === 'midday') && c.a === p.id && rnd() < _num(M.giftChance, 0.25)) {
            npc._courtGift = 'buy';
            if (this._doActivity(npc, 'market', period)) return true;
            npc._courtGift = null;
        }

        // Walking out together of an evening
        if (period === 'evening' && rnd() < _num(M.eveningTogether, 0.55) && this._freeForCourting(other)) {
            const spot = this.townSpot(rnd, A.center, 9);
            const by = spot ? this._findPassableAdjacentTile(spot.q, spot.r) : null;
            if (spot && by && !(by.q === spot.q && by.r === spot.r)) {
                if (this._sceneClear) this._sceneClear(other);
                other._activity = null;
                npc._courtWith = other.id;
                other._courtWith = npc.id;
                const faceTo = (dq, dr) => (Math.abs(dq) >= Math.abs(dr) ? (dq >= 0 ? 3 : 1) : (dr >= 0 ? 2 : 0));
                this._goStand(other, by, 'court', faceTo(spot.q - by.q, spot.r - by.r));
                return this._goStand(npc, spot, 'court', faceTo(by.q - spot.q, by.r - spot.r));
            }
        }

        // Sitting together at the tavern
        if ((period === 'midday' || period === 'evening') && rnd() < _num(M.middayTavern, 0.18) && this._freeForCourting(other)) {
            const taverns = this._townBuildings().filter(b => b.type === 'tavern' || b.type === 'inn');
            if (taverns.length) {
                const b = taverns[Math.floor(rnd() * taverns.length)];
                if (this._goInto(npc, b, 'tavern')) {
                    if (this._sceneClear) this._sceneClear(other);
                    this._goInto(other, b, 'tavern');
                    return true;
                }
            }
        }
        return false;
    },
});
