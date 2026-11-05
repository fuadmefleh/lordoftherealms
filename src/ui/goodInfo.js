// ============================================
// A good's ⓘ: hover it to read what the thing is
// ============================================
// goodInfoIcon(id) is a small "i" to set beside a good's name in any panel
// built as an HTML string (the market, your packs, a chest, a crafting
// table). Hovering it (or clicking or tapping it) opens a card: the good's
// description (data/playerEconomy.json GOODS), what it is worth, what it is
// made from and what it goes into (the workshops' recipes there, and the
// crafting stations' in data/crafting.json). It rides on the "Why?"
// popover (ui/whyPopover.js): the card's text is carried on the element.

import { PlayerEconomy } from '../player/playerEconomy.js';
import { DataLoader } from '../core/dataLoader.js';
import { whyIcon } from './whyPopover.js';

const _goods = () => PlayerEconomy.GOODS || {};

/** The good with this id (or a readable stand-in for an unknown one). */
export function goodDef(id) {
    const key = String(id || '');
    const g = _goods()[key.toUpperCase()] || Object.values(_goods()).find(x => x.id === key);
    return g || { id: key, name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: '📦' };
}

const _name = (id) => { const g = goodDef(id); return `${g.icon || ''} ${g.name}`.trim(); };

function _craftRecipes() {
    const c = (DataLoader.get && DataLoader.get('crafting')) || (DataLoader._gamedata && DataLoader._gamedata.crafting) || {};
    return Array.isArray(c.recipes) ? c.recipes : [];
}

/** How the good is made, and what it goes into: { from: [text], into: [text] }. */
export function goodUses(id) {
    const from = [], into = [];
    // (the recipe's name only where it says more than the good's)
    const how = (label, out) => (label && label.toLowerCase() !== goodDef(out).name.toLowerCase() ? ` (${label})` : '');
    for (const r of Object.values(PlayerEconomy.RECIPES || {})) {
        if (r.output === id && r.input) from.push(`${r.inputQty || 1} ${_name(r.input)}${how(r.name, id)}`);
        if (r.input === id && r.output) into.push(_name(r.output));
    }
    for (const r of _craftRecipes()) {
        const needs = r.ingredients || {};
        const makes = r.result || {};
        if (makes[id]) from.push(`${Object.entries(needs).map(([k, n]) => `${n} ${_name(k)}`).join(' + ')}${how(r.label, id)}`);
        if (needs[id]) {
            for (const out of Object.keys(makes)) if (out !== id) into.push(_name(out));
        }
    }
    const uniq = (a) => [...new Set(a)];
    return { from: uniq(from), into: uniq(into) };
}

/** The card's contents for a good (the popover payload; see whyPopover.js). */
export function goodInfo(id, extra = {}) {
    const g = goodDef(id);
    const rows = [];
    if (g.basePrice != null) rows.push(['Worth about', `${g.basePrice}g each`, '']);
    if (extra.rows) rows.push(...extra.rows);
    const { from, into } = goodUses(g.id);
    const notes = [];
    const list = (label, items) => {
        if (!items.length) return;
        const shown = items.slice(0, 5);
        notes.push(`${label}: ${shown.join(' · ')}${items.length > shown.length ? ` · and ${items.length - shown.length} more` : ''}`);
    };
    list('Made from', from);
    list('Used to make', into);
    if (g.treasure) notes.push('A treasure: kept, shown off, or enshrined.');
    return {
        title: `${g.icon || ''} ${g.name}`.trim(),
        value: g.description || 'No one has much to say about it.',
        rows,
        notes,
        foot: extra.foot || null,
    };
}

/** The "i" beside a good's name: hover (or click) it for the good's card. */
export function goodInfoIcon(id, extra) {
    return whyIcon(goodInfo(id, extra), 'About this', { hover: true, glyph: 'i', cls: 'good-i' });
}
