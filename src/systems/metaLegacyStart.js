// ============================================
// META LEGACY START — what the Hall of Houses gives a new game
// ============================================
// Applied once at game start (ui/game/gameSetup.js, after Scenarios.apply and
// before Barter.beginPlayer), from the New Game sheet's Legacy choices:
//   choice = { lineage: entryId | null, boon: unlockId | null, origin: legacyOriginId | null }
// Every choice is checked against what the Hall has earned (systems/metaLegacy.js);
// an unearned one is ignored. All of it is modest, by design:
//   - Legacy start (data/metaLegacy.json origins): a small purse (scaled by
//     the difficulty's startGold knob), a little Prestige, a skill point or
//     two, a few goods. Its `base` origin is what Scenarios.apply ran.
//   - Inheritance (a boon): a named heirloom of the new House (Heirlooms.create;
//     the past House's own, by name, when the lineage kept one of its kind),
//     a good or two (PlayerInventory), a trait (Traits.grantTraits), a little renown.
//   - Lineage: the new world remembers the old House — a line of lore in the
//     House chronicle and world.run.legacy.lineage, a little Prestige, one
//     realm's old grudge (house.rivals, the same shape the origins use) and,
//     for a line that wore a crown with the ancestral-claim unlock, a weak
//     'blood' claim on another realm's throne (Throne.grantClaim).
// Realms are drawn with the seeded RNG (Utils). Returns { lines, welcome }.

import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Difficulty } from '../core/difficulty.js';
import { House } from './house.js';
import { Throne } from './throne.js';
import { Traits } from './traits.js';
import { Heirlooms } from './heirlooms.js';
import { MetaLegacy } from './metaLegacy.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : m));
}

function _realms(world) {
    return ((world && world.kingdoms) || []).filter(k => k && k.isAlive);
}

export const MetaLegacyStart = {
    /**
     * A boon's heirloom (systems/heirlooms.js): of its kind, named as the past
     * House's own when the lineage kept one of that kind (fromLineage).
     */
    _heirloom(player, world, spec, entry) {
        const kind = (spec && spec.kind) || 'relic';
        const old = entry && spec.fromLineage
            ? (entry.heirlooms || []).find(h => h.kind === kind) || null
            : null;
        return Heirlooms.create(player, world, {
            kind, origin: 'legacy', name: old ? old.name : undefined,
            text: entry ? `Handed down from ${entry.house}` : 'Handed down from forebears long gone',
        });
    },

    /** Goods and traits a boon or legacy start hands over. Returns lines told. */
    _give(player, spec, world = null, entry = null) {
        const out = [];
        if (_obj(spec.heirloom) && world) MetaLegacyStart._heirloom(player, world, spec.heirloom, entry);
        const items = _obj(spec.items) || {};
        for (const [id, qty] of Object.entries(items)) {
            const n = Math.max(0, Math.floor(_num(qty)));
            if (n > 0) PlayerInventory.addItem(player, id, n, { force: true });
        }
        if (Array.isArray(spec.traits) && spec.traits.length) Traits.grantTraits(player, spec.traits);
        if (_num(spec.renown)) player.renown = _num(player.renown) + _num(spec.renown);
        if (_obj(spec.skills)) {
            if (!player.skills) player.skills = {};
            for (const [k, v] of Object.entries(spec.skills)) player.skills[k] = _num(player.skills[k]) + _num(v);
        }
        if (spec.text) out.push(String(spec.text));
        return out;
    },

    /** The lineage: lore, a grudge, maybe a claim. */
    _lineage(player, world, entry, allowClaim, vars) {
        const cfg = MetaLegacy.config().lineage;
        const house = player.house;
        const realms = _realms(world);
        const lineage = {
            entryId: entry.id, house: entry.house, rank: entry.rank || '', peak: entry.peak || [],
            years: _num(entry.years), generations: _num(entry.generations, 1), cause: entry.cause || '',
            score: _num(entry.score), crowns: _num(entry.crowns), rivalKingdom: null, claimKingdom: null, lore: '',
        };
        const realm = realms.length ? Utils.randPick(realms) : null;
        Object.assign(vars, {
            house: entry.house, rank: entry.rank || 'a House of note',
            peak: (entry.peak && entry.peak[0]) || 'lands and name', years: Math.round(_num(entry.years)),
            cause: entry.cause || 'time', realm: realm ? realm.name : 'the old lands',
        });
        const lines = [];
        const lore = (cfg.loreLines || []).length ? _fill(Utils.randPick(cfg.loreLines), vars) : '';
        lineage.lore = lore;
        if (lore) lines.push(lore);
        if (house) {
            House._chronicle(house, world, `${house.name} descends from ${entry.house}. ${lore}`.trim(), ['lineage', 'founding']);
            if (_num(cfg.prestige)) House.award(house, _num(cfg.prestige), `descended from ${entry.house}`, _num(world && world.day));
            // An old grudge: one realm remembers the name (the same shape the origins' rivals take)
            if (realm && _num(cfg.rivalFeud) > 0) {
                house.rivals = house.rivals || {};
                const prev = house.rivals[realm.id];
                house.rivals[realm.id] = {
                    ...(prev || {}),
                    kingdomId: realm.id,
                    name: (prev && prev.name) || `${realm.name}, old foes of ${entry.house}`,
                    feud: Math.max(_num(prev && prev.feud), _num(cfg.rivalFeud)),
                    lastActedDay: _num(world && world.day),
                };
                lineage.rivalKingdom = realm.id;
                if ((cfg.rivalLines || []).length) lines.push(_fill(Utils.randPick(cfg.rivalLines), vars));
            }
        }
        // A crowned line's weak claim, on a realm other than the one that bears the grudge
        const crowned = _num(entry.crowns) > 0 || (entry.peak || []).some(t => /^Crown of /.test(t));
        if (allowClaim && crowned && _num(cfg.claimStrength) > 0) {
            const others = realms.filter(k => !realm || k.id !== realm.id);
            const k = others.length ? Utils.randPick(others) : null;
            if (k) {
                const strength = Throne.grantClaim(player, world, k.id, 'blood', _num(cfg.claimStrength));
                if (strength > 0) {
                    lineage.claimKingdom = k.id;
                    lines.push(`Through ${entry.house} you hold an old claim on the throne of ${k.name}.`);
                }
            }
        }
        return { lineage, lines };
    },

    /**
     * Apply the Hall's gifts to a new game. `profile` defaults to the stored
     * one. Writes world.run.legacy. Returns { lines, welcome, applied }.
     */
    apply(player, world, choice = {}, profile = null) {
        const out = { lines: [], welcome: null, applied: { lineage: null, boon: null, origin: null } };
        if (!player || !world) return out;
        const p = profile || MetaLegacy.load();
        const run = MetaLegacy.ensureRun(world);
        const open = MetaLegacy.lineageOpen(p);
        const vars = { name: player.name };

        // A legacy start
        const lo = choice && choice.origin ? MetaLegacy.legacyOrigins(p).find(o => o.id === choice.origin) : null;
        // Lineage: chosen, or the latest House for a start that is a lineage by nature
        const pool = MetaLegacy.lineages(p);
        let entry = choice && choice.lineage ? pool.find(e => e.id === choice.lineage) || null : null;
        if (entry && !open.lineage && !(lo && lo.lineage)) entry = null;
        if (!entry && lo && lo.lineage) entry = pool[0] || null;
        if (entry) {
            const res = MetaLegacyStart._lineage(player, world, entry, open.claim, vars);
            out.lines.push(...res.lines);
            out.applied.lineage = res.lineage;
        }

        if (lo) {
            if (lo.gold != null) player.gold = Math.max(0, Math.round(_num(lo.gold) * Difficulty.mult(player, 'startGold')));
            if (_num(lo.prestige) && player.house) House.award(player.house, _num(lo.prestige), lo.name || 'a legacy start', _num(world.day));
            MetaLegacyStart._give(player, lo, world, entry);
            if (lo.welcome) out.welcome = _fill(lo.welcome, { house: entry ? entry.house : 'an old House', ...vars });
            out.applied.origin = lo.id;
        }

        // The Inheritance: one boon
        const boon = choice && choice.boon ? MetaLegacy.boons(p).find(b => b.id === choice.boon) : null;
        if (boon) {
            out.lines.push(...MetaLegacyStart._give(player, boon.boon, world, entry));
            out.applied.boon = boon.id;
        }

        run.legacy = out.applied;
        return out;
    },
};
