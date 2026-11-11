// ============================================
// ERA WARDROBE — what people wear in each age of the world
// ============================================
//
// The world's CURRENT year (world.year) sets its era (data/eras.json: the
// Dawn of Man before 200, the early kingdoms to 500, the high kingdoms to
// 750, then the mature realms). Every character look is an LPC layer recipe
// (paths under assets/lpc/Characters, bottom to top); fit() runs the era's
// rules over it, so a townsman of the year 300 wears a plain tunic and
// leggings where one of 853 wears a buttoned shirt, a clansman of the Dawn a
// hide wrap with bare feet and a flint spear, and a guard of 400 an iron
// spangenhelm and a round shield instead of a bascinet and a heater.
//
// Choices among substitutes (and the dyes of the Dawn's hides) are made by a
// hash of who wears them (`seed`), never the RNG, so a person keeps their
// look until the era changes and no seeded stream shifts. The mature era has
// no rules: the default world (start year 853) looks exactly as it always did.
//
// Pure: reads data/eras.json through DataLoader (or the data passed in).

import { DataLoader } from '../core/dataLoader.js';

const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** FNV-1a over a string: the deterministic choice of substitutes. */
function _hash(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

const _reCache = new Map();
function _re(src) {
    let re = _reCache.get(src);
    if (!re) { re = new RegExp(src); _reCache.set(src, re); }
    return re;
}

export const EraWardrobe = {
    _hash,

    /** data/eras.json (the live gamedata, or `data` as given). */
    data(data = null) {
        if (_obj(data)) return data;
        const g = DataLoader._gamedata;
        return (g && _obj(g.eras)) || {};
    },

    /** The eras, oldest first. */
    list(data = null) {
        const l = EraWardrobe.data(data).eras;
        return Array.isArray(l) ? l.filter(e => _obj(e) && e.id) : [];
    },

    /** The era of a year: the first whose `before` lies past it (the last era otherwise). Null without data. */
    eraOf(year, data = null) {
        const list = EraWardrobe.list(data);
        if (!list.length) return null;
        const y = Number(year);
        if (Number.isFinite(y)) {
            for (const e of list) if (typeof e.before === 'number' && y < e.before) return e;
        }
        return list[list.length - 1];
    },

    /** The era's id for a year ('late' — the mature world — when unknown). */
    eraIdOf(year, data = null) {
        const e = EraWardrobe.eraOf(year, data);
        return e ? e.id : 'late';
    },

    /** Is this era's wardrobe today's (no rules, no dyes)? */
    isModern(era) {
        return !era || ((!Array.isArray(era.rules) || !era.rules.length) && !_obj(era.recolour));
    },

    /** How many looks an era makes of one recipe (variants of who wears it). */
    variants(data = null) {
        const n = Number(EraWardrobe.data(data).variants);
        return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
    },

    _byId(eraOrId, data) {
        if (_obj(eraOrId)) return eraOrId;
        return EraWardrobe.list(data).find(e => e.id === eraOrId) || null;
    },

    /** A rule's replacement path, with $n from the match and {in:list:value} resolved. */
    _expand(to, m, lists) {
        const s = String(to).replace(/\$(\d)/g, (_, i) => (m[+i] != null ? m[+i] : ''));
        return s.replace(/\{in:([^:}]+):([^}]*)\}/g, (_, list, v) => {
            const l = Array.isArray(lists[list]) ? lists[list] : [];
            return l.includes(v) || !l.length ? v : l[0];
        });
    },

    /**
     * Fit a layer recipe to an era: the era's rules rewrite it in order, then
     * its dyes recolour the cloth. `seed` names the wearer (a number or a
     * string) and makes the choices. A modern era (or none) returns the very
     * same array. The result has no repeated layer.
     */
    fit(layers, eraOrId, seed = 0, data = null) {
        if (!Array.isArray(layers)) return layers;
        const era = EraWardrobe._byId(eraOrId, data);
        if (EraWardrobe.isModern(era)) return layers;
        const lists = _obj(EraWardrobe.data(data).lists) || {};
        let cur = layers.slice();
        (era.rules || []).forEach((rule, ri) => {
            if (!_obj(rule) || !rule.match) return;
            const re = _re(rule.match);
            const next = [];
            for (const l of cur) {
                const m = re.exec(l);
                if (!m) { next.push(l); continue; }
                let to = rule.to;
                if (Array.isArray(rule.pick) && rule.pick.length) {
                    // (one choice per wearer and rule: a weapon's back and front frames stay one weapon)
                    to = rule.pick[_hash(`${seed}|${era.id}|${ri}`) % rule.pick.length];
                }
                if (to == null) continue;
                for (const t of (Array.isArray(to) ? to : [to])) if (t != null) next.push(EraWardrobe._expand(t, m, lists));
            }
            cur = next;
        });
        const rc = _obj(era.recolour);
        if (rc && rc.layers && Array.isArray(rc.palette) && rc.palette.length) {
            const re = _re(rc.layers);
            cur = cur.map(l => {
                if (!re.test(l)) return l;
                const i = l.lastIndexOf('/');
                const colour = l.slice(i + 1);
                if (rc.palette.includes(colour)) return l;
                return l.slice(0, i + 1) + rc.palette[_hash(`${seed}|${era.id}|dye|${colour}`) % rc.palette.length];
            });
        }
        return cur.filter((l, i) => cur.indexOf(l) === i);
    },

    /** fit() for a year rather than an era. */
    fitForYear(layers, year, seed = 0, data = null) {
        return EraWardrobe.fit(layers, EraWardrobe.eraOf(year, data), seed, data);
    },

    /** Does the era wear this one layer as it is (for the character creator's choices)? */
    allows(layer, eraOrId, data = null) {
        const era = EraWardrobe._byId(eraOrId, data);
        if (EraWardrobe.isModern(era)) return true;
        const out = EraWardrobe.fit([layer], era, 0, data);
        return out.length === 1 && out[0] === layer;
    },
};
