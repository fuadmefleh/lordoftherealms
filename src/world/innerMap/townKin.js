// ============================================
// InnerMap — the young and the old about town
// ============================================
// Over world/innerMap/townLife.js (who goes where each hour):
//
//   - on a school day's morning the town's pupils (systems/townSchool.js)
//     walk to their school — the church or chapel for the parish school,
//     the library (else the church) for the town school — and go in; the
//     teacher goes too (inside, the church's scene seats them on the pews
//     facing the front: world/innerMap/townScenes.js). A tutored child stays
//     home; a truant plays by the water or the square instead;
//   - children play (tag about the square, by the well), do chores (water
//     from the well, the hens by the barn), and go home at mealtimes;
//   - the old (65+) sit in the sun on the square instead of working.
//
// What they say is the street map's business (ui/innerMapKin.js). Draws only
// from Utils (seedable). Data: data/townFamily.json → onMap,
// data/townSchool.json.

import { InnerMap } from './_ref.js';
import { Utils } from './_imports.js';
import { TownFamily } from '../../systems/townFamily.js';
import { TownSchool } from '../../systems/townSchool.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

Object.assign(InnerMap, {
    /** The school building on this map for a kind of schooling, or null. */
    _schoolBuilding(kind) {
        const types = TownSchool.buildingsFor(kind);
        const blds = this._townBuildings ? this._townBuildings() : (this.buildings || []);
        for (const t of types) {
            const b = blds.find(x => x && x.type === t && !x.isPlayerOwned);
            if (b) return b;
        }
        return null;
    },

    /** Someone teaching this morning: the priest (parish) or the schoolmaster (town school). */
    _teachesNow(npc, folk, day) {
        const p = npc._person;
        if (!p) return null;
        if (p.teaches === 'schoolmaster') return 'grammar';
        if (p.role === 'priest' && TownSchool.priest(folk) === p) return 'parish';
        return null;
    },

    /**
     * The hour's pick for the young and the old: true when it took them
     * somewhere (townLife then leaves them be), false to carry on as usual.
     */
    _kinPick(npc, period) {
        const p = npc && npc._person;
        const folk = npc && npc._folk;
        if (!p || !folk || npc.type === 'guard') return false;
        // (claimed by a wedding or a christening: world/innerMap/townCourting.js holds them)
        if (npc._wedding) return false;
        const A = this.townArea();
        if (!A) return false;
        const day = this.worldDay || 1;
        const hour = _num(this.timeOfDay, 12);
        const rnd = Utils.random;
        const M = TownFamily.config().onMap || {};
        const settlement = this._currentWorldTileRef && this._currentWorldTileRef.settlement;
        // (the world, for the school's hashed rolls: set each frame by ui/innerMapKin.js)
        const world = this._kinWorld || null;
        npc._truant = false;
        npc._pupil = null;

        // School: pupils and their teacher into the schoolroom
        const S = TownSchool.config();
        if (S.enabled && TownSchool.schoolDay(day) && hour >= S.hours[0] && hour < S.hours[1] - 0.5) {
            const teach = this._teachesNow(npc, folk, day);
            if (teach) {
                const b = this._schoolBuilding(teach);
                const pupils = (this.npcs || []).some(n => n._person && n.type === 'child' && TownSchool.kindFor(world, settlement, folk, n._person, day) === teach);
                if (b && pupils && this._goInto(npc, b, 'school')) { npc._teaching = teach; return true; }
            }
            if (npc.type === 'child') {
                const cls = TownSchool.inClass(world, settlement, folk, p, day, hour);
                if (cls && cls.kind === 'tutor') { npc._pupil = 'tutor'; return this._goHome(npc, 'school'); }
                if (cls && !cls.truant) {
                    const b = this._schoolBuilding(cls.kind);
                    if (b && this._goInto(npc, b, 'school')) { npc._pupil = cls.kind; return true; }
                }
                if (cls && cls.truant) {
                    npc._truant = true;
                    return this._kidPlay(npc, A, rnd);
                }
            }
        }
        npc._teaching = null;

        // Children: play, chores, home at mealtimes
        if (npc.type === 'child') {
            if ((period === 'midday' || period === 'evening') && npc._home && rnd() < _num(M.homeAtMeals, 0.6)) return this._goHome(npc, 'home');
            if (period === 'night' || period === 'dawn') return false;
            if (rnd() < _num(M.choreChance, 0.25) && this._kidChore(npc, A, rnd)) return true;
            if (rnd() < _num(M.playChance, 0.5)) return this._kidPlay(npc, A, rnd);
            return false;
        }

        // The old sit in the sun on the square
        if (_num(npc.age) >= _num(M.elderAge, 65) && period !== 'night' && period !== 'dawn' && rnd() < _num(M.elderRest, 0.45)) {
            const spot = A.square && A.square.length ? A.square[Math.floor(rnd() * A.square.length)] : this.townSpot(rnd, A.center, 5);
            if (this._goStand(npc, spot, 'rest')) { npc._resting = true; return true; }
        }
        npc._resting = false;
        return false;
    },

    /** Off to play: tag near another child, or about the square and the well. */
    _kidPlay(npc, A, rnd) {
        const mates = (this.npcs || []).filter(n => n !== npc && n.type === 'child' && n.state !== 'inside_building' && Math.max(Math.abs(n.q - npc.q), Math.abs(n.r - npc.r)) <= 14);
        const mate = mates.length ? mates[Math.floor(rnd() * mates.length)] : null;
        const base = mate ? { q: mate.q, r: mate.r } : (npc._truant ? null : A.center);
        const spot = this.townSpot(rnd, base, mate ? 2 : 6);
        npc._playing = true;
        return this._goStand(npc, spot, 'play');
    },

    /** A chore: water from the well, the hens by the barn or the house. */
    _kidChore(npc, A, rnd) {
        const blds = this._townBuildings ? this._townBuildings() : [];
        const barn = blds.find(b => b.type === 'barn' || b.type === 'farm');
        if (barn && rnd() < 0.4) {
            const at = this._findPassableAdjacentTile(barn.q, barn.r);
            npc._chore = 'hens';
            return this._goStand(npc, at, 'chore');
        }
        const well = A.square && A.square.length ? A.square[0] : A.center;
        npc._chore = 'water';
        return this._goStand(npc, this.townSpot(rnd, well, 2), 'chore');
    },
});
