// ============================================
// InnerMap — town sickness: the sick abed, the healer's round, a frightened town
// ============================================
// Over world/innerMap/townLife.js (who goes where each hour), from the
// townsperson's own sickness (systems/illness.js keeps it on the person:
// p.ill = { k, on, end, sv }; read here as plain data, data/illness.json for
// which share of each sickness is laid up):
//
//   - the sick laid up go home and stay in bed, day and night (`_sickAbed`:
//     townLife keeps them in, world/innerMap/floors.js lays them in bed);
//   - the town's healer (flagged by ui/innerMapSickness.js, which also lists
//     the houses the sick lie in: `_sickHomes`) goes round them house to house;
//   - in an epidemic (settlement.sickness.epi) the healthy keep indoors more;
//   - mourners at the church door (ui/innerMapSickness.js stages them) stand
//     where they were put till it is over.
//
// The coughs, the pale look, the barks and the marked doors are the street
// map's business: ui/innerMapSickness.js. Draws only from Utils (seedable).

import { InnerMap } from './_ref.js';
import { Utils, DataLoader } from './_imports.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _def(k) {
    const d = DataLoader._gamedata && DataLoader._gamedata.illness;
    return d && d.illnesses ? d.illnesses[k] || null : null;
}

Object.assign(InnerMap, {
    /**
     * Laid up by their sickness: true when it has them abed and (unless
     * `anywhere`) they are in at home.
     */
    _sickAbed(npc, anywhere = false) {
        const p = npc && npc._person;
        const c = p && p.ill;
        if (!c || p.died != null || npc.departing) return false;
        const day = this.worldDay || 1;
        if (day < _num(c.on) || day >= _num(c.end, Infinity)) return false;
        const d = _def(c.k);
        if (!d || !(_num(c.sv) >= 1 - _num(d.abed, 0.5))) return false;
        const home = npc._home;
        if (!home) return false;
        if (anywhere) return true;
        return npc.state === 'inside_building' && npc._insideBuildingQ === home.q && npc._insideBuildingR === home.r;
    },

    /**
     * The hour's pick for the sick, the healer and a frightened town: true
     * when it took them somewhere (townLife then leaves them be).
     */
    _sickPick(npc, period) {
        if (!npc || !npc._person || !this.townArea()) return false;
        // Mourners at the church door stay till the burial is over (ui/innerMapSickness.js)
        if (npc._mourning) {
            npc.state = 'idle';
            npc.idleTimer = 4;
            return true;
        }
        if (this._sickAbed(npc, true)) return this._goHome(npc, 'sleep');
        const rnd = Utils.random;
        // The healer's round: house to house where the sick lie
        const homes = this._sickHomes || [];
        if (npc._healer && homes.length && period !== 'night' && period !== 'dawn' && rnd() < 0.8) {
            npc._roundIx = (_num(npc._roundIx, -1) + 1) % homes.length;
            const b = homes[npc._roundIx];
            if (b && !(npc._home && b.q === npc._home.q && b.r === npc._home.r) && this._goInto(npc, b, 'tend')) return true;
        }
        // A stall left under a cloth for the plague (ui/innerMapPlague.js lists them): its keeper stays home
        const st = npc._stall;
        if (st && this._plagueStalls && this._plagueStalls.has(`${st.q},${st.r}`) && npc._home && period !== 'night') return this._goHome(npc, 'home');
        // An epidemic: the healthy keep to their houses more — the worse it is, the emptier the streets
        // (ui/innerMapPlague.js sets _plagueStay from systems/plague.js: 0 with no plague)
        const s = this._currentWorldTileRef && this._currentWorldTileRef.settlement;
        const sk = s && s.sickness;
        const stay = Math.max(0.35, _num(this._plagueStay));
        if (sk && (sk.epi || _num(this._plagueStay) > 0) && !sk.abs && npc.type !== 'guard' && period !== 'night' && npc._home && rnd() < stay) return this._goHome(npc, 'home');
        return false;
    },
});
