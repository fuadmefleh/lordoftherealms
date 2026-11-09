// ============================================
// InnerMap — town herbalists: the town's foragers at work on the map
// ============================================
// A share of the townsfolk are herbalists by trade (systems/practiceSkills.js
// craftTrades). In working hours (townLife.js 'work') one may walk out past the
// houses to a bush that gives something worth gathering — herbs (ferns, heather,
// lavender), berries (the berry bushes, brambles) or flowers (wild rose) — and
// cut from it with a sickle a while, leaving the bush standing: it is picked bare
// (customObject.pickedDay) and gives nothing more until regrowDays have passed.
// They carry their basket back: berries into the town's food store (as the
// harvest is, world/townProps.js storeHarvest), herbs and flowers to the
// apothecary, the temple or the market, into the town's goods. A few bushes a day
// on a map at most.
//
// Data: data/townLife.json "foraging". Draws only from Utils (seedable).

import { InnerMap } from './_ref.js';
import { Utils, CustomObjects, Townsfolk, PracticeSkills, TownProps } from './_imports.js';

const DEFAULTS = {
    share: 0.75,          // at work, the chance a herbalist goes out to gather instead
    maxPerDay: 6,         // bushes the town's herbalists gather from on one map in a day
    reach: 40,            // how far from home they go (tiles)
    townClear: 1,         // bushes within this of the town are left (gardens, hedges)
    regrowDays: 7,        // a picked bush gives again after this many days
    pickSeconds: [10, 18],// the spell at a bush
    gives: ['herbs', 'berries', 'flowers'],
    goodsPer: { herbs: 0.1, flowers: 0.05 },
    stores: {
        herbs: ['apothecary', 'herbalist', 'temple', 'church', 'marketplace', 'warehouse'],
        flowers: ['marketplace', 'temple', 'church', 'warehouse'],
        berries: ['granary', 'bakery', 'tavern', 'marketplace', 'warehouse'],
    },
    labels: { herbs: 'Gathering herbs', berries: 'Picking berries', flowers: 'Picking flowers' },
};

const _key = (q, r) => `${q},${r}`;
const _span = (range, rnd) => {
    const [a, b] = Array.isArray(range) ? range : [10, 18];
    return a + rnd() * (b - a);
};

Object.assign(InnerMap, {
    townForageConfig() {
        const d = (this.townLifeConfig().foraging) || {};
        return {
            ...DEFAULTS, ...d,
            goodsPer: { ...DEFAULTS.goodsPer, ...(d.goodsPer || {}) },
            stores: { ...DEFAULTS.stores, ...(d.stores || {}) },
            labels: { ...DEFAULTS.labels, ...(d.labels || {}) },
        };
    },

    /** Is this townsperson a herbalist by trade? (their person's craft, settled once) */
    _isTownHerbalist(npc) {
        if (!npc) return false;
        if (npc._herbalist === undefined) {
            let yes = false;
            if (npc._person && npc._folk && Townsfolk.skillWho && PracticeSkills.craftOf) {
                const who = Townsfolk.skillWho(npc._folk, npc._person, this.worldDay || 1, false, false);
                yes = PracticeSkills.craftOf(who) === 'herbalist';
            }
            npc._herbalist = yes;
        }
        return npc._herbalist;
    },

    /** Bushes the town's herbalists have gathered from on this map today. */
    _townForagedToday() {
        const t = this._townForage;
        const day = this._fellDay();
        return t && t.day === day && t.hex === this._fellHex ? t.n : 0;
    },

    /** What a bush gives a forager (its resource, when it is herbs, berries or flowers), else null. */
    _forageGood(def) {
        const res = def && def.resource;
        if (!def || def.objectType !== 'plant' || !res) return null;
        return (this.townForageConfig().gives || []).includes(res.type) ? res : null;
    },

    /** Has the bush (its customObject) grown back since it was last picked? */
    _bushReady(obj) {
        if (!obj || obj.pickedDay == null) return true;
        return this._fellDay() - obj.pickedDay >= (Number(this.townForageConfig().regrowDays) || 0);
    },

    /** A bush to gather from, out beyond the houses and near enough home: { q, r, def, trunk, res } or null. */
    _pickTownBush(npc) {
        const C = this.townForageConfig();
        const rnd = Utils.random;
        const base = npc._home || npc;
        const m = (this.townArea() || {}).margin || 8;
        const claimed = new Set((this.npcs || []).filter(o => o !== npc && o._forage).map(o => _key(o._forage.q, o._forage.r)));
        const found = [];
        const R = Math.max(4, C.reach | 0);
        for (let r = Math.max(m, base.r - R); r <= Math.min(this.height - m - 1, base.r + R); r++) {
            const row = this.tiles[r];
            if (!row) continue;
            for (let q = Math.max(m, base.q - R); q <= Math.min(this.width - m - 1, base.q + R); q++) {
                const t = row[q];
                const obj = t && t.customObject;
                if (!obj || t._isInterior || claimed.has(_key(q, r)) || !this._bushReady(obj)) continue;
                const def = CustomObjects.getDef(obj.defId);
                const res = this._forageGood(def);
                if (!res) continue;
                const trunk = this.trunkOf(q, r, def);
                if (this._nearTown(trunk.q, trunk.r, C.townClear)) continue;
                found.push({ q, r, def, trunk, res, d: Math.hypot(trunk.q - base.q, trunk.r - base.r) });
            }
        }
        if (!found.length) return null;
        found.sort((a, b) => a.d - b.d);
        const near = found.slice(0, 5);
        return near[Math.floor(rnd() * near.length)];
    },

    /** Off to gather: stand beside the bush, facing it. False if none will do. */
    _goToBush(npc) {
        const C = this.townForageConfig();
        if (this._townForagedToday() >= C.maxPerDay) return false;
        const bush = this._pickTownBush(npc);
        if (!bush) return false;
        const spot = this._standBy(npc, bush.trunk);
        if (!spot) return false;
        const face = spot.q < bush.trunk.q ? 3 : spot.q > bush.trunk.q ? 1 : 0;
        npc._forage = { q: bush.q, r: bush.r, defId: bush.def.id, good: bush.res.type };
        if (this._goStand(npc, spot, 'forage', face)) return true;
        npc._forage = null;
        return false;
    },

    /** At the bush: to work with the sickle a while. */
    _startForaging(npc) {
        const f = npc._forage;
        const t = f && this.getTile(f.q, f.r);
        if (!t || !t.customObject || t.customObject.defId !== f.defId || !this._bushReady(t.customObject)) { npc._forage = null; return; }
        const C = this.townForageConfig();
        npc.activity = { type: 'forage', icon: '🌿', label: C.labels[f.good] || 'Gathering', anim: 'halfslash', tool: 'sickle' };
        npc.idleTimer = _span(C.pickSeconds, Utils.random);
    },

    /** Done at the bush (or called away): what was gathered goes in the basket, and the bush is picked bare. */
    _leaveForage(npc) {
        const f = npc._forage;
        npc._forage = null;
        const working = npc.activity && npc.activity.type === 'forage';
        if (working) npc.activity = null;
        const t = f && this.getTile(f.q, f.r);
        const obj = t && t.customObject;
        // only one who stood and worked at it
        if (!working || !obj || obj.defId !== f.defId || !this._bushReady(obj) || Math.hypot(npc.q - f.q, npc.r - f.r) > 4) return;
        const def = CustomObjects.getDef(f.defId);
        const res = this._forageGood(def);
        if (!res) return;
        obj.pickedDay = this._fellDay();
        const day = this._fellDay();
        const tf = this._townForage;
        this._townForage = tf && tf.day === day && tf.hex === this._fellHex ? { ...tf, n: tf.n + 1 } : { day, hex: this._fellHex, n: 1 };
        npc._carry = { good: res.type, qty: Math.max(1, Math.round(Number(res.amount) || 1)) };
    },

    /** Gone indoors with the basket: berries into the food store, herbs and flowers into the town's goods. */
    _townForageDelivered(npc, bldg) {
        const c = npc._carry;
        const C = this.townForageConfig();
        if (!c || !bldg || !(C.stores[c.good] || []).includes(bldg.type)) return false;
        npc._carry = null;
        const ref = this._currentWorldTileRef;
        const settlement = ref && ref.settlement;
        if (c.good === 'berries') { TownProps.storeHarvest(settlement, 'berries', c.qty); return true; }
        const econ = settlement && settlement.economy;
        if (econ) econ.goods = (Number(econ.goods) || 0) + c.qty * (Number(C.goodsPer[c.good]) || 0);
        return true;
    },
});
