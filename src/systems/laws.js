// ============================================
// LAWS — the laws of each realm, and the ruler's hand on them
// ============================================
// Each realm keeps a law on each matter (data/laws.json): private prison
// camps, land for foreigners, how hard the watch punishes. Until a ruler
// sets one, a realm keeps its old custom (a hash of the realm, the same all
// game). The ruler of a realm may change its laws: it costs the treasury and
// a little stability (more for a hard law), and a law can't be changed again
// for a while. Kept on kingdom.laws = { [law]: option, changed: { [law]: day } }
// (saved with the realm, systems/saveLoad.js).
//
// Every law is read: privatePrisons by systems/knockout.js, foreignLand by
// systems/lots.js, punishment by systems/streetCrime.js. The panel is
// ui/actionMenu/laws.js.

import { DataLoader } from '../core/dataLoader.js';

const DEFAULTS = {
    changeCost: { treasury: 150, stability: 2 },
    cooldownDays: 30,
    laws: {
        privatePrisons: { name: 'Private Prisons', icon: '⛓️', desc: '', options: { forbidden: { label: 'Forbidden', share: 0.6, stability: 0 }, allowed: { label: 'Allowed', share: 0.4, stability: -3 } } },
        foreignLand: { name: 'Land for Foreigners', icon: '📜', desc: '', options: { open: { label: 'Open to all', share: 0.65, stability: 0 }, subjects: { label: 'Subjects only', share: 0.35, stability: 1 } } },
        punishment: { name: 'Punishment', icon: '⚖️', desc: '', options: { lenient: { label: 'Lenient', share: 0.25, fine: 0.6, jail: 0.6 }, standard: { label: 'Customary', share: 0.5, fine: 1, jail: 1 }, harsh: { label: 'Harsh', share: 0.25, fine: 1.6, jail: 1.6, stability: -2 } } },
    },
};

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

function _hash01(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 100000) / 100000;
}

function _kingdom(world, id) {
    if (!world || id == null) return null;
    if (typeof world.getKingdom === 'function') return world.getKingdom(id) || null;
    return (world.kingdoms || []).find(k => k && k.id === id) || null;
}

export const Laws = {
    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.laws) || {};
        return { ...DEFAULTS, ...d, changeCost: { ...DEFAULTS.changeCost, ...(_obj(d.changeCost) || {}) }, laws: _obj(d.laws) || DEFAULTS.laws };
    },

    /** The laws, in order: [{ id, name, icon, desc, options: [{ id, label, desc, ... }] }]. */
    list() {
        return Object.entries(Laws.config().laws).map(([id, L]) => ({
            id, name: L.name || id, icon: L.icon || '📜', desc: L.desc || '',
            options: Object.entries(L.options || {}).map(([oid, o]) => ({ id: oid, ...o })),
        }));
    },

    law(id) { return Laws.list().find(l => l.id === id) || null; },

    /** A realm's old custom on a law (before any ruler set it): a hash of the realm. */
    custom(kingdom, lawId) {
        const L = Laws.law(lawId);
        if (!L || !L.options.length) return null;
        const u = _hash01(`${kingdom && kingdom.id}|${(kingdom && kingdom.name) || ''}|${lawId}`);
        let acc = 0;
        for (const o of L.options) { acc += _num(o.share, 1 / L.options.length); if (u < acc) return o.id; }
        return L.options[L.options.length - 1].id;
    },

    /** The option a realm holds on a law (its set law, else its custom). */
    value(world, kingdomId, lawId) {
        const k = _kingdom(world, kingdomId);
        if (!k) return null;
        const set = k.laws && k.laws[lawId];
        // (A plain true/false law reads as allowed/forbidden)
        if (typeof set === 'boolean') return set ? 'allowed' : 'forbidden';
        const L = Laws.law(lawId);
        if (set && L && L.options.some(o => o.id === set)) return set;
        return Laws.custom(k, lawId);
    },

    /** The option record a realm holds on a law. */
    option(world, kingdomId, lawId) {
        const L = Laws.law(lawId);
        const v = Laws.value(world, kingdomId, lawId);
        return (L && L.options.find(o => o.id === v)) || null;
    },

    /** Every law of a realm: [{ law, option, set (by a ruler) }]. */
    of(world, kingdomId) {
        const k = _kingdom(world, kingdomId);
        if (!k) return [];
        return Laws.list().map(law => ({ law, option: Laws.option(world, kingdomId, law.id), set: !!(k.laws && k.laws[law.id] != null) }));
    },

    // ──────────── WHAT THE LAWS SAY ────────────

    /** May private citizens keep prison camps in this realm? */
    privatePrisons(world, kingdomId) {
        return kingdomId != null && Laws.value(world, kingdomId, 'privatePrisons') === 'allowed';
    },

    /** Is the player sworn to the realm (or its ruler)? */
    isSubject(player, kingdomId) {
        if (!player || kingdomId == null) return false;
        const ruling = player.throne && player.throne.ruling;
        return player.allegiance === kingdomId || !!(ruling && ruling.kingdomId === kingdomId);
    },

    /** May this player hold land (buy or rent a lot or a house) in the realm? → { ok, reason } */
    mayHoldLand(world, player, kingdomId) {
        if (kingdomId == null) return { ok: true };
        if (Laws.value(world, kingdomId, 'foreignLand') !== 'subjects' || Laws.isSubject(player, kingdomId)) return { ok: true };
        const k = _kingdom(world, kingdomId);
        return { ok: false, reason: `The law of ${(k && k.name) || 'this realm'} lets only its own subjects hold land here. Swear yourself to the crown first.` };
    },

    /** How the watch punishes here: { fine, jail } multipliers. */
    punishment(world, kingdomId) {
        const o = kingdomId != null ? Laws.option(world, kingdomId, 'punishment') : null;
        return { fine: _num(o && o.fine, 1), jail: _num(o && o.jail, 1) };
    },

    // ──────────── THE RULER'S HAND ────────────

    /** The realm the player rules, or null. */
    ruled(player, world) {
        const ruling = player && player.throne && player.throne.ruling;
        return ruling && ruling.kingdomId != null ? _kingdom(world, ruling.kingdomId) : null;
    },

    /** Can the player set this law to this option now? → { ok, reason, cost, stability, readyDay } */
    canEnact(player, world, lawId, optionId) {
        const k = Laws.ruled(player, world);
        if (!k) return { ok: false, reason: 'Only the ruler of a realm may change its laws.' };
        const L = Laws.law(lawId);
        const o = L && L.options.find(x => x.id === optionId);
        if (!o) return { ok: false, reason: 'No such law.' };
        if (Laws.value(world, k.id, lawId) === optionId) return { ok: false, reason: 'That is already the law.' };
        const C = Laws.config();
        const cost = Math.round(_num(C.changeCost.treasury, 150));
        // The upheaval of any change, and more for a hard law (a law the people like costs nothing extra)
        const stability = Math.round(_num(C.changeCost.stability, 2) + Math.max(0, -_num(o.stability)));
        const last = k.laws && k.laws.changed && k.laws.changed[lawId];
        const readyDay = last != null ? _num(last) + _num(C.cooldownDays, 30) : 0;
        const day = _num(world && world.day);
        if (day < readyDay) return { ok: false, reason: `The law was changed lately; the realm won't stand another change until day ${readyDay}.`, cost, stability, readyDay };
        if (_num(k.treasury) < cost) return { ok: false, reason: `Proclaiming a new law costs the crown ${cost}g; the treasury holds ${Math.floor(_num(k.treasury))}g.`, cost, stability, readyDay };
        return { ok: true, cost, stability, readyDay };
    },

    /** The ruler proclaims a law. → { success, text|reason } */
    enact(player, world, lawId, optionId) {
        const can = Laws.canEnact(player, world, lawId, optionId);
        if (!can.ok) return { success: false, reason: can.reason };
        const k = Laws.ruled(player, world);
        const L = Laws.law(lawId);
        const o = L.options.find(x => x.id === optionId);
        const day = _num(world && world.day);
        if (!k.laws || typeof k.laws !== 'object') k.laws = {};
        if (!k.laws.changed || typeof k.laws.changed !== 'object') k.laws.changed = {};
        const was = Laws.option(world, k.id, lawId);
        k.laws[lawId] = optionId;
        k.laws.changed[lawId] = day;
        k.treasury = _num(k.treasury) - can.cost;
        k.stability = Math.max(0, Math.min(100, _num(k.stability, 50) - can.stability));
        if (!Array.isArray(k.laws.history)) k.laws.history = [];
        k.laws.history.push({ day, law: lawId, from: was ? was.id : null, to: optionId });
        if (k.laws.history.length > 30) k.laws.history.splice(0, k.laws.history.length - 30);
        return { success: true, text: `By your proclamation, ${L.name.toLowerCase()} in ${k.name}: ${o.label.toLowerCase()}${was ? ` (was ${was.label.toLowerCase()})` : ''}. ${can.cost}g from the treasury; stability −${can.stability}.` };
    },
};
