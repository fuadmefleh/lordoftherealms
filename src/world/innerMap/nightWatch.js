// InnerMap — the curfew on the streets.
//
// When the town keeps a curfew (systems/nightStreets.js decides; the street
// map's UI, ui/innerMapNight.js, sets this._curfew = { from, to, extraWatch,
// patrol } on the map, or null), from the bell till dawn townsfolk go home
// and stay in, more of the day watch turns out for the night, and the watch
// walks its beat rather than standing at its posts. Read by world/innerMap/
// townLife.js (_townPickActivity, _townStayInside, _guardOnDuty).

import { InnerMap } from './_ref.js';
import { Utils } from './_imports.js';

Object.assign(InnerMap, {
    /** Is the curfew on at this hour? */
    _curfewNow(hour = this.timeOfDay) {
        const c = this._curfew;
        if (!c || !this.active) return false;
        const h = ((Number(hour) % 24) + 24) % 24;
        const from = Number(c.from), to = Number(c.to);
        return from > to ? (h >= from || h < to) : (h >= from && h < to);
    },

    /** Under the curfew, a townsperson out on the street goes home (not the watch, nor one leaving town). */
    _curfewSendsHome(npc) {
        if (!npc || npc.type === 'guard' || npc.departing || npc._thief || npc._nightFolk || !this._curfewNow()) return false;
        return !!npc._home;
    },

    /** Under the curfew, one at home stays in: how much longer (seconds), else 0. */
    _curfewStay(npc) {
        if (!npc || npc.type === 'guard' || npc.departing || npc._nightFolk || !this._curfewNow()) return 0;
        const home = npc._home;
        if (!home || npc._insideBuildingQ !== home.q || npc._insideBuildingR !== home.r) return 0;
        return 30 + Utils.random() * 30;
    },

    /** Under the curfew, a share of the day watch turns out for the night too. */
    _curfewWatch(npc, period) {
        const c = this._curfew;
        if (!c || period !== 'night' || npc._nightWatch || !this._curfewNow()) return false;
        const share = Number(c.extraWatch) || 0;
        return ((Number(npc.id) || 0) * 0.618) % 1 < share;
    },

    /** Under the curfew the watch walks its beat (with lanterns) more than it stands at posts. */
    _curfewPostShare(base) {
        if (!this._curfewNow()) return base;
        const p = this._curfew && Number(this._curfew.patrol);
        return Number.isFinite(p) ? Math.max(0, 1 - p) : base;
    },
});
