// ============================================
// UI — the Inventory window (top bar's Inventory, the I key, the Counsel)
// ============================================
// The packs as a grid of tiles — icon, count, name — under filters by kind
// (data/inventory.json), sorted by kind, name, quantity, worth or price each,
// with a search box and the packs' room as a bar. Picking a tile opens its
// card at the side (narrow windows: below): what it is, what it is worth, and
// what can be done with it — eat, use, wield or wear, enshrine, make an
// heirloom, put it on the hotbar, drop it. The street map's hotbar is shown
// across the top: drag a tile onto a slot (or pick the slot from the card),
// drag slot to slot to swap, ✕ or right-click to empty one. The layout is the
// player's and is saved with them (player/hotbarLayout.js).
//
// Above the packs, the Kit: what is worn in each slot (head, body, hands,
// legs, feet, main and off hand — systems/arms.js) with its grade, soundness
// and edge, and the harness's totals (what it stops, its weight and the
// breath that costs in a fight). Picking a slot lists the pieces carried that
// fit it, best first, and "Nothing"; picking one takes it up (a two-hander
// leaves no hand for a shield).
//
// What is listed and how it is filtered and sorted: ui/inventoryView.js (pure).

import { UI } from './core.js';
import { itemIcon } from '../icons.js';
import { goodInfoIcon } from '../goodInfo.js';
import { Arms } from '../../systems/arms.js';
import { Heirlooms } from '../../systems/heirlooms.js';
import { Crafting } from '../../player/crafting.js';
import { Grades } from '../../core/grades.js';
import { DataLoader } from '../../core/dataLoader.js';
import { MEAL_HUNGER } from '../../player/core/needs.js';
import { HotbarLayout, HOTBAR_SLOTS } from '../../player/hotbarLayout.js';
import { Hotbar, DND_ITEM, DND_SLOT, dndCarries, dndPayload } from '../hotbar.js';
import { catalogOf, buildEntries, filterSort, categoryCounts, defaultDir } from '../inventoryView.js';
import { rowList, sectionHead, card, price, esc } from '../actionMenu/uiKit.js';
import { PlayerInventory, PlayerEconomy, Treasures, InnerMap } from './_imports.js';
import { Utils } from '../../core/utils.js';
import { GroundGoods } from '../../systems/groundGoods.js';
import { InnerMapGroundGoods } from '../innerMapGroundGoods.js';

export const INVENTORY_TITLE = 'Inventory';

/**
 * The packs' weight: what is carried against what back, horse and cart can
 * bear (core/inventory.js), and the pace it leaves you.
 */
function loadHtml(player) {
    const L = PlayerInventory.loadSummary(player);
    if (!Number.isFinite(L.max)) return '';
    const pct = Math.min(100, Math.round(L.share * 100));
    const tone = L.load > L.hard ? 'full' : (L.over ? 'near' : '');
    const by = [`your back ${Math.round(L.back)}`].concat(L.carriers.map(c => `${c.icon} ${c.name} ${c.load}`)).join(' + ');
    const pace = L.over ? ` · <span style="color:#e08a5a">overburdened: ${Math.round(L.speed * 100)}% pace</span>` : '';
    const tip = `What you carry, by weight. Up to ${Math.round(L.max)} ${L.unit} you travel at your full pace; past it you are overburdened and slowed, and past ${Math.round(L.hard)} ${L.unit} you can pick up nothing more. Carried by: ${by}. A horse, a handcart or a horse cart (with a horse to draw it) carries more.`;
    return `<div class="inv-cap${tone ? ' inv-cap--' + tone : ''}" title="${esc(tip)}">
            <div class="inv-cap-label"><span>⚖️ Load</span><b>${Math.round(L.load)} / ${Math.round(L.max)}</b><small>${esc(L.unit)}${pace}</small></div>
            <div class="inv-cap-bar"><div class="inv-cap-fill" style="width:${pct}%"></div></div>
        </div>`;
}

/** Is a (non-locked, non-minigame) Inventory window the one open? */
function _inventoryOpen() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return false;
    const panel = document.getElementById('customPanel');
    const title = panel && panel.querySelector && panel.querySelector('.custom-panel-title');
    return !!(title && title.textContent.trim() === INVENTORY_TITLE);
}

function _catalog() {
    return catalogOf(DataLoader._gamedata && DataLoader._gamedata.inventory);
}

/** A good's name, icon and price: the market's book, else the arms catalogue. */
function _goodOf(id) {
    const g = (PlayerEconomy.GOODS || {})[String(id).toUpperCase()];
    if (g) return g;
    if (Arms.isArms(id)) return { name: Arms.nameOf(id), icon: Arms.iconOf(id), basePrice: Arms.basePrice(id) };
    return null;
}

function _ctx() {
    return {
        goodOf: _goodOf,
        isArms: (id) => Arms.isArms(id),
        isFood: (id) => Object.prototype.hasOwnProperty.call(MEAL_HUNGER, id),
        isTreasure: (id) => !!Treasures.info(id),
    };
}

const _args = (a) => esc(JSON.stringify(a));

/**
 * The window's HTML for `game` and the view state `st` = { category, sort,
 * dir, query, selected, pick } — exported for the render test.
 */
/** How many goods under each filter match the search (every good, with no search). */
function searchCounts(entries, query, catalog) {
    return categoryCounts(String(query || '').trim() ? filterSort(entries, { category: 'all', query }, catalog) : entries);
}

export function inventoryPanelHtml(game, st = {}) {
    const player = game.player;
    const inv = player.inventory || {};
    const catalog = _catalog();
    const ctx = _ctx();
    const entries = buildEntries(inv, catalog, ctx);
    const counts = categoryCounts(entries);
    const category = st.category && (st.category === 'all' || counts[st.category]) ? st.category : 'all';
    const sort = st.sort || 'category';
    const dir = st.dir || defaultDir(sort);
    const list = filterSort(entries, { category, sort, dir, query: st.query }, catalog);
    const selected = entries.find(e => e.id === st.selected) || null;

    // ── The packs' room and worth ──
    const used = PlayerInventory.getUsedSlots(player);
    const cap = PlayerInventory.getCapacity(player);
    const pct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 100;
    const tone = used >= cap ? 'full' : (used >= cap * 0.8 ? 'near' : '');
    const worth = entries.reduce((s, e) => s + e.value, 0);
    let html = `<div class="inv">`;
    html += `<div class="inv-top">
        <div class="inv-cap${tone ? ' inv-cap--' + tone : ''}" title="Each kind of good takes a place in the packs; a stack can be as big as you like. A mount (+5), each house (+3) and Endurance add room.">
            <div class="inv-cap-label"><span>🎒 Packs</span><b>${used} / ${cap}</b><small>kinds of goods</small></div>
            <div class="inv-cap-bar"><div class="inv-cap-fill" style="width:${pct}%"></div></div>
        </div>
        ${loadHtml(player)}
        <div class="inv-worth" title="What everything carried would fetch at the usual price">Worth about ${price(worth)}</div>
    </div>`;

    // ── The House's heirlooms: not in the packs (they pass to the heir), but shown here ──
    const hl = Heirlooms.list(player);
    if (hl.length) {
        const where = { held: 'in hand', child: 'with a child', pawned: 'in pawn', stolen: 'stolen', lost: 'lost', sold: 'sold away', dowry: 'in dowry' };
        html += `<details class="inv-heirlooms" open><summary>🗝️ Heirlooms of the House <small>(${hl.length})</small></summary>${rowList(hl.map(h => ({
            icon: h.icon, name: esc(h.name), desc: `${esc(Heirlooms.tier(h).label)}${Heirlooms.describeBonus(h) ? ` · ${esc(Heirlooms.describeBonus(h))}` : ''}`,
            act: 'showHeirloom', args: [h.id], side: where[h.status] || h.status, tone: h.status === 'held' ? 'good' : (['stolen', 'lost', 'sold'].includes(h.status) ? 'bad' : ''),
        })))}</details>`;
    }

    // ── The kit worn ──
    html += kitHtml(player, st);

    // ── The hotbar ──
    html += hotbarStripHtml(player);

    // ── Search, filters, sort ──
    html += `<div class="inv-tools">
        <input id="invSearch" class="inv-search" type="search" placeholder="Search the packs…" value="${esc(st.query || '')}" autocomplete="off" spellcheck="false" aria-label="Search the packs">
        <div class="inv-sorts" role="group" aria-label="Sort by">${catalog.sorts.map(s => {
        const on = s.id === sort;
        const arrow = on ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
        return `<button type="button" class="inv-sort${on ? ' active' : ''}" data-ui-act="invSort" data-ui-args="${_args([s.id])}" title="Sort by ${esc(s.label.toLowerCase())}${on ? ' (click again to reverse)' : ''}">${esc(s.label)}${arrow}</button>`;
    }).join('')}</div>
    </div>`;
    // (the counts are of what the search matches: they change as it is typed — _invSearch)
    const shown = searchCounts(entries, st.query, catalog);
    const chipsHtml = [`<button type="button" class="inv-filter${category === 'all' ? ' active' : ''}" data-ui-act="invFilter" data-ui-args="${_args(['all'])}" data-inv-cat="all">All <b>${shown.all || 0}</b></button>`]
        .concat(catalog.categories.filter(c => counts[c.id]).map(c =>
            `<button type="button" class="inv-filter${category === c.id ? ' active' : ''}${shown[c.id] ? '' : ' inv-filter-none'}" data-ui-act="invFilter" data-ui-args="${_args([c.id])}" data-inv-cat="${esc(c.id)}">${c.icon} ${esc(c.label)} <b>${shown[c.id] || 0}</b></button>`));
    html += `<div class="inv-filters" role="group" aria-label="Show">${chipsHtml.join('')}</div>`;

    // ── The goods and the picked one's card ──
    html += `<div class="inv-body">`;
    html += `<div class="inv-list" id="invList">${inventoryGridHtml(game, list, st, entries.length)}</div>`;
    html += `<div class="inv-detail${selected ? ' has-item' : ''}" id="invDetail">${selected ? itemDetailHtml(game, selected, st) : _emptyDetail(entries.length)}</div>`;
    html += `</div></div>`;
    return html;
}

function _emptyDetail(n) {
    return n
        ? `<div class="inv-detail-empty">Pick something to see what it is and what you can do with it.<br><small>Drag a good onto a hotbar slot to keep it to hand on the street map.</small></div>`
        : `<div class="inv-detail-empty">Your packs are empty.</div>`;
}

/** The tiles for `list` (already filtered and sorted). */
export function inventoryGridHtml(game, list, st = {}, total = list.length) {
    if (!total) return `<p class="inv-none">Your packs are empty.</p>`;
    if (!list.length) return `<p class="inv-none">Nothing in the packs matches${st.query ? ` “${esc(st.query)}”` : ''}.</p>`;
    const player = game.player;
    const tiles = list.map(e => {
        const slot = HotbarLayout.indexOf(player, e.id);
        const worn = Arms.isArms(e.id) && Arms.isEquipped(player, e.id);
        const tier = Crafting.qualityTag(player, e.id) ? Crafting.bestTier(player, e.id) : null;
        const cls = `inv-tile${st.selected === e.id ? ' selected' : ''}${worn ? ' worn' : ''}`;
        const tip = `${e.name} ×${e.qty}${e.unitValue ? ` · ~${Utils.formatGold(e.unitValue)}g each` : ''}${worn ? ' · worn' : ''}${slot >= 0 ? ` · hotbar ${slot + 1}` : ''} — drag onto the hotbar`;
        return `<button type="button" class="${cls}" draggable="true" data-inv-item="${esc(e.id)}" data-ui-act="invSelect" data-ui-args="${_args([e.id])}" title="${esc(tip)}">`
            + `<span class="inv-tile-ico">${itemIcon(e.id, e.icon, 30)}</span>`
            + `<span class="inv-tile-qty">${e.qty > 1 ? `×${e.qty}` : ''}</span>`
            + (slot >= 0 ? `<span class="inv-tile-key" title="On the hotbar: key ${slot + 1}">${slot + 1}</span>` : '')
            + (tier ? `<span class="inv-tile-grade">${tier.icon || ''}</span>` : '')
            + `<span class="inv-tile-name">${esc(e.name)}</span>`
            + `</button>`;
    });
    return `<div class="inv-grid">${tiles.join('')}</div>`;
}

/** The kit's slots in the order a figure is read: head to foot, then the hands' arms. */
export const KIT_ORDER = ['head', 'body', 'hands', 'legs', 'feet', 'main', 'off'];

const _pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;

/** A piece's one line: what it does, and its weight. */
function _kitStat(s) {
    if (!s) return '';
    const parts = [];
    if (s.slot === 'main') {
        if (s.melee) parts.push(`⚔️ ${s.dmg.toFixed(1)} ${s.dtype || ''}`.trim(), `reach ${s.reach}`);
        else parts.push('missile weapon');
        if (s.hands >= 2) parts.push('two hands');
    } else if (s.slot === 'off') parts.push(`🛡️ guard +${s.block.toFixed(1)}`, `covers ${_pct(s.cover)}`);
    else parts.push(`stops ${_pct(s.prot)}`);
    parts.push(`${s.weight} kg`);
    return parts.join(' · ');
}

function _gradeTag(g) {
    const gr = Grades.get(g);
    return gr && gr.id !== 'common' ? ` <span style="color:${gr.color}">${gr.icon} ${esc(gr.name)}</span>` : '';
}

/**
 * The Kit: a tile a slot (what is worn, its grade, soundness and edge), the
 * harness's totals, and — for the slot picked (st.kitSlot) — the pieces
 * carried that fit it, best first, with "Nothing". Exported for the render test.
 */
export function kitHtml(player, st = {}) {
    const lo = Arms.loadout(player);
    const gear = Arms.personal(player);
    const D = Arms.config().duel || {};
    const over = Math.max(0, gear.weight - (Number(D.freeKg) || 0));
    const breath = Math.round(over * (Number(D.staminaPerKg) || 0));
    const twoHander = lo.main && lo.main.stats.hands >= 2 ? lo.main : null;
    const tiles = KIT_ORDER.map(slot => {
        const def = Arms.config().slots[slot] || { label: slot, icon: '⚔️' };
        const p = lo[slot];
        const on = st.kitSlot === slot;
        let what;
        if (p) {
            const worn = p.cond < 50 || (p.stats.edge != null && p.edge < 50);
            what = `<span class="inv-kit-ico">${itemIcon(p.id, esc(Arms.iconOf(p.id)), 24)}</span>`
                + `<span class="inv-kit-txt"><span class="inv-kit-name">${esc(p.stats.name)}${_gradeTag(p.grade)}</span>`
                + `<span class="inv-kit-cond${worn ? ' inv-kit-worn' : ''}">${Math.round(p.cond)}% sound${p.stats.edge != null ? ` · ${Math.round(p.edge)}% edge` : ''}</span></span>`;
        } else {
            const none = slot === 'off' && twoHander ? `Both hands on the ${esc(twoHander.stats.name.toLowerCase())}` : (slot === 'main' ? 'Bare hands' : 'Nothing');
            what = `<span class="inv-kit-ico inv-kit-empty">${def.icon}</span><span class="inv-kit-txt"><span class="inv-kit-name inv-kit-none">${none}</span></span>`;
        }
        const n = Arms.candidates(player, slot).length;
        const tip = `${def.label}: ${p ? p.stats.name : 'nothing worn'} — ${n ? `${n} kind${n > 1 ? 's' : ''} carried that fit; click to change` : 'you carry nothing that fits'}`;
        return `<button type="button" class="inv-kit-slot${on ? ' active' : ''}${p ? '' : ' bare'}" data-ui-act="invKitSlot" data-ui-args="${_args([slot])}" data-kit-slot="${esc(slot)}" title="${esc(tip)}">`
            + `<span class="inv-kit-label">${def.icon} ${esc(def.label)}</span>${what}</button>`;
    }).join('');
    const free = Number(D.freeKg) || 0;
    const totals = `<span title="The share of a blow your armour stops (all the pieces together)">🧥 Stops <b>${_pct(gear.armour)}</b></span>`
        + `<span title="By the blow: cut, point, blunt">cut <b>${_pct(gear.armourVs.cut)}</b> · point <b>${_pct(gear.armourVs.pierce)}</b> · blunt <b>${_pct(gear.armourVs.blunt)}</b></span>`
        + `<span title="All you wield and wear. Over ${free} kg it costs breath in a fight">⚖️ <b>${gear.weight} kg</b>${breath > 0 ? ` <span class="inv-kit-worn">(−${breath} breath)</span>` : ''}</span>`;
    let pick = '';
    const slot = KIT_ORDER.includes(st.kitSlot) ? st.kitSlot : null;
    if (slot) {
        const def = Arms.config().slots[slot] || { label: slot, icon: '⚔️' };
        const p = lo[slot];
        const blocked = slot === 'off' && twoHander ? `Your ${esc(twoHander.stats.name.toLowerCase())} takes both hands: wield a one-handed weapon first.` : '';
        const rows = Arms.candidates(player, slot).map(c => {
            const s = Arms.stats(c.id, c.grade);
            const here = !!p && p.id === c.id;
            const lost = slot === 'main' && s.hands >= 2 && lo.off ? ` · the ${esc(lo.off.stats.name.toLowerCase())} goes on your back` : '';
            return {
                icon: itemIcon(c.id, esc(Arms.iconOf(c.id)), 20),
                name: `${esc(s.name)}${_gradeTag(c.grade)}${c.count > 1 ? ` <span class="inv-kit-count">×${c.count}</span>` : ''}`,
                desc: esc(_kitStat(s)) + lost,
                side: here ? 'worn' : '', tone: here ? 'good' : null,
                off: !here && !!blocked, why: blocked,
                attrs: here ? '' : `data-ui-act="invKitEquip" data-ui-args="${_args([slot, c.id])}"`,
            };
        });
        if (!rows.length) rows.push({ icon: '⚒️', name: 'You carry nothing for it', desc: 'Forge it at an anvil, buy it at a market, or order it from a town&#39;s armourer.' });
        const bare = slot === 'main' ? 'Bare hands' : 'Nothing';
        rows.push(p
            ? { icon: '🎒', name: bare, desc: 'Put it back in the packs and leave the slot empty', attrs: `data-ui-act="invKitEquip" data-ui-args="${_args([slot, null])}"` }
            : { icon: '🎒', name: bare, desc: 'Nothing worn here', side: 'now', tone: 'good' });
        pick = `<div class="inv-kit-pick">${rowList(rows, `${def.icon} ${esc(def.label)} — what you could wear`)}</div>`;
    }
    return `<details class="inv-kit" open><summary>🛡️ Kit <small>${_pct(gear.armour)} stopped · ${gear.weight} kg</small></summary>`
        + `<div class="inv-kit-grid">${tiles}</div><div class="inv-kit-totals">${totals}</div>${pick}</details>`;
}

/** The hotbar's slots, for dropping goods on, dragging between and clearing. */
export function hotbarStripHtml(player) {
    const inv = player.inventory || {};
    const view = HotbarLayout.view(player, inv);
    const manual = HotbarLayout.ensure(player).manual;
    const slots = view.map(v => {
        const g = v.itemId ? (_goodOf(v.itemId) || {}) : null;
        const raw = v.itemId ? (g.name || v.itemId.replace(/_/g, ' ')) : '';
        const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
        const cls = `inv-hb-slot${v.itemId ? '' : ' empty'}${v.itemId && !v.ready ? ' kept' : ''}`;
        const tip = v.itemId
            ? (v.ready ? `${name} ×${v.qty} — key ${v.index + 1} on the street map. Drag to another slot to swap; right-click or ✕ to empty.` : `${name}: none left, the slot is kept for it. Right-click or ✕ to empty.`)
            : `Slot ${v.index + 1}: drag a good here`;
        return `<div class="${cls}" data-hb-slot="${v.index}"${v.itemId ? ' draggable="true"' : ''} title="${esc(tip)}">`
            + `<span class="inv-hb-key">${v.index + 1}</span>`
            + (v.itemId ? `<span class="inv-hb-ico">${itemIcon(v.itemId, g.icon || '📦', 26)}</span>` : '')
            + (v.itemId ? `<span class="inv-hb-qty">${v.ready ? `×${v.qty}` : '0'}</span>` : '')
            + (v.itemId ? `<button type="button" class="inv-hb-clear" data-ui-act="invHotbarClear" data-ui-args="${_args([v.index])}" title="Empty slot ${v.index + 1}" aria-label="Empty slot ${v.index + 1}">✕</button>` : '')
            + `</div>`;
    }).join('');
    const auto = manual
        ? `<button type="button" class="inv-hb-auto" data-ui-act="invHotbarAuto" title="Let the bar fill itself again from the packs">↺ Fill itself</button>`
        : `<span class="inv-hb-note" title="Until you arrange it, the bar fills itself from the packs">fills itself</span>`;
    return `<div class="inv-hb">
        <div class="inv-hb-head">${sectionHead('Hotbar')}<span class="inv-hb-hint">drag goods onto a slot · keys 1–${HOTBAR_SLOTS} on the street map</span>${auto}</div>
        <div class="inv-hb-slots">${slots}</div>
    </div>`;
}

/** The picked good's card: what it is, its worth, and what can be done with it. */
export function itemDetailHtml(game, e, st = {}) {
    const player = game.player;
    const id = e.id;
    const catalog = _catalog();
    const catDef = catalog.categories.find(c => c.id === e.category) || { label: '', icon: '' };
    const g = _goodOf(id) || {};
    const info = Treasures.info(id);
    const qHtml = Crafting.qualityHtml(player, id);
    const isArms = Arms.isArms(id);
    const worn = isArms && Arms.isEquipped(player, id);
    const slot = HotbarLayout.indexOf(player, id);

    let body = `<div class="inv-d-head">
        <span class="inv-d-ico">${itemIcon(id, e.icon, 44)}</span>
        <div class="inv-d-title">
            <div class="inv-d-name">${esc(e.name)}${goodInfoIcon(id)}</div>
            <div class="inv-d-sub">${catDef.icon} ${esc(catDef.label)} · ×${e.qty}${qHtml ? ` · ${qHtml}` : ''}</div>
        </div>
    </div>`;
    if (g.description) body += `<p class="inv-d-desc">${esc(g.description)}</p>`;
    const facts = [];
    if (e.unitValue) facts.push(`<span>Each <b>${price(e.unitValue)}</b></span>`, `<span>All <b>${price(e.value)}</b></span>`);
    if (isArms) {
        const def = Arms.item(id) || {};
        const slotLabel = (Arms.config().slots[def.slot] || {}).label || '';
        if (slotLabel) facts.push(`<span>${esc(slotLabel)}${worn ? ' · <b class="inv-good">worn</b>' : ''}</span>`);
        if (def.weight) facts.push(`<span>Weighs <b>${def.weight}</b></span>`);
    }
    if (Object.prototype.hasOwnProperty.call(MEAL_HUNGER, id)) facts.push(`<span>A meal: <b>+${MEAL_HUNGER[id]}</b> hunger</span>`);
    if (slot >= 0) facts.push(`<span>Hotbar <b>${slot + 1}</b></span>`);
    if (facts.length) body += `<div class="inv-d-facts">${facts.join('')}</div>`;
    const fx = info ? Treasures.describe(id) : [];
    if (fx.length) body += `<div class="inv-d-fx">${fx.map(l => `<div>${esc(l)}</div>`).join('')}</div>`;

    // ── What can be done with it ──
    const rows = [];
    if (Object.prototype.hasOwnProperty.call(MEAL_HUNGER, id)) {
        rows.push({ icon: '🍖', name: 'Eat one', desc: 'Have a meal of it now', side: `+${MEAL_HUNGER[id]}`, tone: 'good', attrs: `data-ui-act="invEat" data-ui-args="${_args([id])}"` });
    }
    if (info && info.consume) rows.push({ icon: '✋', name: 'Use', desc: fx.filter(l => /Use:/.test(l)).join(' · ') || 'Use it up', attrs: `data-ui-act="useTreasure" data-ui-args="${_args([id])}"` });
    if (isArms) {
        const def = Arms.item(id) || {};
        const slotLabel = ((Arms.config().slots[def.slot] || {}).label || '').toLowerCase();
        const cur = worn ? null : Arms.equipped(player, def.slot);
        const main = def.slot === 'off' ? Arms.equipped(player, 'main') : null;
        const blocked = main && main.stats.hands >= 2 ? `Your ${esc(main.stats.name.toLowerCase())} takes both hands` : '';
        const verb = def.slot === 'main' || def.slot === 'off' ? 'Equip' : 'Wear';
        rows.push(worn
            ? { icon: '🎒', name: 'Unequip', desc: `Worn (${esc(slotLabel)}): back into the packs`, attrs: `data-ui-act="equipArms" data-ui-args="${_args([id])}"` }
            : { icon: def.slot === 'main' ? '✋' : '🧥', name: verb, desc: `Take it up (${esc(slotLabel)})${cur ? ` in place of the ${esc(cur.stats.name.toLowerCase())}` : ''}`, off: !!blocked, why: blocked, attrs: `data-ui-act="equipArms" data-ui-args="${_args([id])}"` });
    }
    if (info && info.prestige > 0) {
        rows.push(player.house
            ? { icon: '🏛️', name: 'Enshrine', desc: 'Hang it in your hall for good', side: `+${info.prestige} Prestige`, tone: 'gold', attrs: `data-ui-act="dedicateTreasure" data-ui-args="${_args([id])}"` }
            : { icon: '🏛️', name: 'Enshrine', off: true, why: 'Only a House has a hall to hang it in' });
    }
    if (Heirlooms.eligible(player).some(x => x.itemId === id)) {
        rows.push({ icon: '🗝️', name: 'Make an heirloom', desc: 'Name it and hand it down the line', act: 'heirloomForge', args: [id] });
    }
    rows.push(slot >= 0
        ? { icon: '⌨️', name: 'Take off the hotbar', desc: `It is in slot ${slot + 1}`, attrs: `data-ui-act="invHotbarUnassign" data-ui-args="${_args([id])}"` }
        : { icon: '⌨️', name: 'Put on the hotbar', desc: 'Pick a slot below, or drag the tile onto one', attrs: `data-ui-act="invHotbarPick" data-ui-args="${_args([id])}"` });
    // Drop… and Throw away…: an amount picked below (systems/groundGoods.js — set down, the world keeps
    // it on this hex: on the street map beside you, on the world map at the roadside; thrown away, gone)
    const spare = GroundGoods.spare(player, id);
    const onStreet = !!(InnerMap && InnerMap.active);
    const keepWhy = spare > 0 ? null : (worn ? 'You are wearing it: put it away first' : 'None to spare');
    const where = onStreet ? 'on the ground beside you' : 'here at the roadside, for whoever comes by';
    rows.push(keepWhy
        ? { icon: '⬇️', name: 'Drop…', off: true, why: keepWhy }
        : { icon: '⬇️', name: 'Drop…', desc: `Set ${spare > 1 ? 'some or all' : 'it'} down ${where}${worn ? ' (the worn one stays on)' : ''}`, attrs: `data-ui-act="invAmount" data-ui-args="${_args([id, 'drop'])}"` });
    rows.push(keepWhy
        ? { icon: '🗑️', name: 'Throw away…', off: true, why: keepWhy }
        : { icon: '🗑️', name: 'Throw away…', desc: 'Break it, burn it, bury it: gone for good', attrs: `data-ui-act="invAmount" data-ui-args="${_args([id, 'toss'])}"` });
    rows.push({ icon: '🎁', name: 'Give', desc: 'Talk to someone and offer it as a gift' });

    let pick = '';
    if (st.pick === id || slot >= 0) {
        const view = HotbarLayout.view(player, player.inventory || {});
        pick = `<div class="inv-d-pick"><div class="inv-d-pick-head">${slot >= 0 ? 'Move to slot' : 'Put in slot'}</div><div class="inv-d-pick-slots">${view.map(v => {
            const other = v.itemId && v.itemId !== id ? (_goodOf(v.itemId) || {}).name || v.itemId : '';
            const here = v.itemId === id;
            return `<button type="button" class="inv-d-slot${here ? ' active' : ''}${other ? ' taken' : ''}" data-ui-act="invHotbarAssign" data-ui-args="${_args([id, v.index])}" title="${esc(here ? `In slot ${v.index + 1}` : (other ? `Slot ${v.index + 1}: ${other} (they swap)` : `Slot ${v.index + 1}: empty`))}">${v.index + 1}</button>`;
        }).join('')}</div></div>`;
    }
    return card(body) + rowList(rows) + _amountHtml(player, id, e, st) + pick;
}

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The amount chooser under the card (Drop… / Throw away…): 1, 5, 10, half, all or a number; a valuable stack thrown away asks again. */
function _amountHtml(player, id, e, st) {
    const a = st.amount;
    if (!a || a.id !== id) return '';
    const spare = GroundGoods.spare(player, id);
    if (!(spare > 0)) return '';
    const toss = a.mode === 'toss';
    const verb = toss ? 'Throw away' : 'Drop';
    const act = toss ? 'invToss' : 'invDrop';
    const warn = [];
    const caution = GroundGoods.caution(player, id);
    if (caution) warn.push(caution);
    if (Treasures.info(id)) warn.push('A treasure: there may be no other like it.');
    if (a.confirm && a.confirm.n > 0) {
        const n = a.confirm.n;
        return `<div class="inv-d-pick inv-d-amt"><div class="inv-d-pick-head">Throw away for good?</div>`
            + `<p class="inv-d-desc">${esc(`${n} ${e.name}`)} worth about <b>${price(GroundGoods.worth(player, id, n))}</b> — destroyed, not left for anyone.${warn.length ? ` ${esc(warn.join(' '))}` : ''}</p>`
            + `<div class="inv-d-amt-row"><button type="button" class="inv-d-slot inv-d-amt-danger" data-ui-act="invToss" data-ui-args="${_args([id, n, true])}">Yes, throw ${n} away</button>`
            + `<button type="button" class="inv-d-slot" data-ui-act="invAmount" data-ui-args="${_args([id, 'toss'])}">No</button></div></div>`;
    }
    const opts = [];
    const add = (label, n) => { if (n >= 1 && n <= spare && !opts.some(o => o.n === n)) opts.push({ label, n }); };
    add('1', 1); add('5', 5); add('10', 10); add(`Half (${Math.floor(spare / 2)})`, Math.floor(spare / 2)); add(`All (${spare})`, spare);
    return `<div class="inv-d-pick inv-d-amt"><div class="inv-d-pick-head">${verb} how many? <small>(of ${spare}${spare < e.qty ? ' to spare' : ''})</small></div>`
        + (warn.length ? `<p class="inv-d-desc inv-d-amt-warn">⚠️ ${esc(warn.join(' '))}</p>` : '')
        + `<div class="inv-d-amt-row">${opts.map(o => `<button type="button" class="inv-d-slot" data-ui-act="${act}" data-ui-args="${_args([id, o.n])}">${esc(o.label)}</button>`).join('')}</div>`
        + `<div class="inv-d-amt-row"><input type="number" id="invAmtN" class="inv-d-amt-n" min="1" max="${spare}" value="${Math.min(spare, Math.max(1, Math.floor(_num(a.n) || 1)))}" aria-label="How many">`
        + `<button type="button" class="inv-d-slot" data-ui-act="invAmountGo" data-ui-args="${_args([id, a.mode])}">${verb}</button>`
        + `<button type="button" class="inv-d-slot" data-ui-act="invAmount" data-ui-args="${_args([id, null])}">Cancel</button></div></div>`;
}

Object.assign(UI.prototype, {
    /** The Inventory window (opens at its last filter, sort and pick). */
    showInventoryPanel() {
        if (!this.game || !this.game.player) return;
        const st = this._invState || (this._invState = { category: 'all', sort: 'category', dir: null, query: '', selected: null, pick: null });
        // The pick gone from the packs (eaten, sold): nothing picked
        if (st.selected && !((this.game.player.inventory || {})[st.selected] > 0)) { st.selected = null; st.pick = null; }
        // (a bar that lays itself out shows what it will hold)
        HotbarLayout.reconcile(this.game.player, this.game.player.inventory || {});
        Hotbar.attach(this.game);
        this.showCustomPanel(INVENTORY_TITLE, inventoryPanelHtml(this.game, st));
        this._bindInventoryPanel();
    },

    /** The I key and the top bar: open the Inventory, or close it when it is the window up. */
    toggleInventoryPanel() {
        if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
            const panel = document.getElementById('customPanel');
            // A locked panel (the death screen) or a game in progress keeps the window
            if (panel && (panel._locked || (panel.querySelector && panel.querySelector('#mgRoot')))) return;
        }
        if (_inventoryOpen()) this.hideCustomPanel();
        else this.showInventoryPanel();
    },

    /** Redraw the Inventory window if it is the one up (the hotbar changed under it). */
    refreshInventoryPanel() {
        if (_inventoryOpen()) this.showInventoryPanel();
    },

    /** Open (or close) a kit slot's list of the pieces that fit it. */
    invKitSlot(slot) {
        const st = this._invState || (this._invState = {});
        st.kitSlot = st.kitSlot === slot ? null : slot;
        this.showInventoryPanel();
    },

    /** Take up `itemId` in `slot` from the kit's list, or (null) leave the slot empty. */
    invKitEquip(slot, itemId = null) {
        const player = this.game.player;
        const r = itemId ? Arms.equip(player, itemId) : Arms.unequip(player, slot);
        const def = Arms.config().slots[slot] || {};
        this.showNotification(`${def.icon || '⚔️'} ${def.label || 'Kit'}`, r.success ? r.text : (r.reason || 'Not possible.'), r.success ? 'success' : 'error');
        if (r.success && this._invState) this._invState.kitSlot = null;
        this.updateStats(player, this.game.world);
        Hotbar.refresh();
        this.showInventoryPanel();
    },

    invSelect(itemId) {
        const st = this._invState || {};
        st.selected = st.selected === itemId ? null : itemId;
        st.pick = null;
        st.amount = null;
        this.showInventoryPanel();
    },

    invFilter(category) {
        if (!this._invState) return;
        this._invState.category = category || 'all';
        this.showInventoryPanel();
    },

    /** Sort by `sort`; the same sort again reverses it. */
    invSort(sort) {
        const st = this._invState;
        if (!st) return;
        if (st.sort === sort) st.dir = (st.dir || defaultDir(sort)) === 'asc' ? 'desc' : 'asc';
        else { st.sort = sort; st.dir = null; }
        this.showInventoryPanel();
    },

    /** Only the tiles redrawn as the search is typed (the box keeps its focus). */
    _invSearch(query) {
        const st = this._invState;
        if (!st || typeof document === 'undefined') return;
        st.query = String(query || '');
        const el = document.getElementById('invList');
        if (!el) return;
        const catalog = _catalog();
        const entries = buildEntries(this.game.player.inventory || {}, catalog, _ctx());
        el.innerHTML = inventoryGridHtml(this.game, filterSort(entries, { category: st.category, sort: st.sort, dir: st.dir || defaultDir(st.sort), query: st.query }, catalog), st, entries.length);
        // The filters' counts follow the search
        const shown = searchCounts(entries, st.query, catalog);
        for (const chip of document.querySelectorAll('.inv-filter[data-inv-cat]')) {
            const b = chip.querySelector('b');
            const n = shown[chip.getAttribute('data-inv-cat')] || 0;
            if (b) b.textContent = String(n);
            chip.classList.toggle('inv-filter-none', !n);
        }
    },

    /** Show the slot picker on the picked good's card. */
    invHotbarPick(itemId) {
        const st = this._invState || {};
        st.selected = itemId;
        st.pick = itemId;
        this.showInventoryPanel();
    },

    invHotbarAssign(itemId, index) {
        Hotbar.attach(this.game);
        Hotbar.setSlot(index, itemId);
        if (this._invState) this._invState.pick = null;
        this.showInventoryPanel();
    },

    invHotbarClear(index) {
        Hotbar.attach(this.game);
        Hotbar.clearSlot(index);
        this.showInventoryPanel();
    },

    invHotbarUnassign(itemId) {
        const i = HotbarLayout.indexOf(this.game.player, itemId);
        if (i >= 0) this.invHotbarClear(i);
    },

    /** Hand the bar back to filling itself from the packs. */
    invHotbarAuto() {
        HotbarLayout.reset(this.game.player, this.game.player.inventory || {});
        Hotbar.attach(this.game);
        this.showInventoryPanel();
    },

    /** Eat one of this food now (player.eatMeal). */
    invEat(itemId) {
        const player = this.game.player;
        const meal = typeof player.eatMeal === 'function' ? player.eatMeal(itemId) : { success: false, reason: 'You cannot eat now.' };
        if (meal.success) this.showNotification('🍖 A Good Meal', `You eat some ${String(meal.food).replace(/_/g, ' ')} from your pack (+${meal.hunger} hunger).`, 'success');
        else this.showNotification('🍖 Nothing to Eat', meal.reason, 'error');
        this.updateStats(player, this.game.world);
        Hotbar.refresh();
        this.showInventoryPanel();
    },

    /** Open (mode 'drop' | 'toss') or close (null) the amount chooser on a good's card. */
    invAmount(itemId, mode = null) {
        const st = this._invState || (this._invState = {});
        st.selected = itemId;
        st.amount = mode ? { id: itemId, mode } : null;
        this.showInventoryPanel();
    },

    /** The chooser's number box: drop or throw away that many. */
    invAmountGo(itemId, mode) {
        const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('invAmtN') : null;
        const n = Math.floor(Number(el && el.value) || 0);
        if (!(n > 0)) { this.showNotification('🎒 How Many?', 'Put a number in the box first.', 'error'); return; }
        if (mode === 'toss') this.invToss(itemId, n);
        else this.invDrop(itemId, n);
    },

    /**
     * Set `qty` of a good down: on the street map beside you, on the world map
     * at the roadside of this hex. Either way the world keeps it (systems/groundGoods.js).
     */
    invDrop(itemId, qty = 1) {
        const game = this.game;
        const player = game.player;
        const spare = GroundGoods.spare(player, itemId);
        const n = Math.max(1, Math.min(spare || 1, Math.floor(Number(qty) || 1)));
        const g = _goodOf(itemId) || {};
        const name = g.name || itemId.replace(/_/g, ' ');
        const what = n > 1 ? `${n} ${name}` : name;
        let res;
        if (InnerMap.active) {
            res = InnerMapGroundGoods.dropAt(game, itemId, n);
            if (res.ok) this.showNotification(`${g.icon || '📦'} Dropped`, `${what} set down beside you. Pick ${n > 1 ? 'them' : 'it'} up from the ground's menu — or someone else will.`, 'info');
        } else {
            res = GroundGoods.drop(game.world, player, itemId, n, { q: player.q, r: player.r, day: game.world.day });
            if (res.ok) this.showNotification(`${g.icon || '📦'} Left at the Roadside`, `${what} left here. Pick ${n > 1 ? 'them' : 'it'} up again from Goods Left Here while ${n > 1 ? 'they lie' : 'it lies'} there.`, 'info');
        }
        if (!res.ok) { this.showNotification('⬇️ Drop', res.reason || 'You cannot set it down here.', 'error'); return; }
        if (this._invState) this._invState.amount = null;
        this.updateStats(player, game.world);
        Hotbar.refresh();
        this.showInventoryPanel();
    },

    /** Throw away `qty` of a good: destroyed, gone for good (a valuable stack asks first). */
    invToss(itemId, qty = 1, confirmed = false) {
        const game = this.game;
        const player = game.player;
        const spare = GroundGoods.spare(player, itemId);
        const n = Math.max(1, Math.min(spare || 1, Math.floor(Number(qty) || 1)));
        const st = this._invState || (this._invState = {});
        const valuable = GroundGoods.worth(player, itemId, n) >= (Number(GroundGoods.config().confirmValue) || 40) || !!Treasures.info(itemId) || !!GroundGoods.caution(player, itemId);
        if (valuable && !confirmed) {
            st.selected = itemId;
            st.amount = { id: itemId, mode: 'toss', confirm: { n } };
            this.showInventoryPanel();
            return;
        }
        const res = GroundGoods.throwAway(game.world, player, itemId, n);
        if (!res.ok) { this.showNotification('🗑️ Throw Away', res.reason, 'error'); return; }
        const g = _goodOf(itemId) || {};
        const name = g.name || itemId.replace(/_/g, ' ');
        this.showNotification('🗑️ Thrown Away', `${n > 1 ? `${n} ${name}` : name}: broken up and gone for good.`, 'info');
        st.amount = null;
        this.updateStats(player, game.world);
        Hotbar.refresh();
        this.showInventoryPanel();
    },

    /** Wire the window's search box, and (once) drag-and-drop between the tiles and the hotbar. */
    _bindInventoryPanel() {
        if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
        const search = document.getElementById('invSearch');
        if (search && !search._invBound) {
            search._invBound = true;
            search.addEventListener('input', () => this._invSearch(search.value));
            search.addEventListener('keydown', (e) => {
                // (the game's own keys skip text fields: Escape clears the box, then closes the window)
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (search.value) { search.value = ''; this._invSearch(''); } else this.hideCustomPanel();
                }
            });
        }
        if (UI._invDndBound || typeof document.addEventListener !== 'function') return;
        UI._invDndBound = true;
        const ui = this;
        const inPanel = (el) => el && el.closest && el.closest('#customPanel');
        document.addEventListener('dragstart', (e) => {
            const t = e.target;
            if (!inPanel(t) || !e.dataTransfer) return;
            const tile = t.closest('[data-inv-item]');
            const slot = t.closest('[data-hb-slot]');
            if (tile) {
                e.dataTransfer.setData(DND_ITEM, tile.dataset.invItem);
                e.dataTransfer.setData('text/plain', tile.dataset.invItem);
                e.dataTransfer.effectAllowed = 'copyMove';
            } else if (slot) {
                const idx = parseInt(slot.dataset.hbSlot, 10);
                const itemId = HotbarLayout.itemAt(ui.game && ui.game.player, idx);
                if (!itemId) { e.preventDefault(); return; }
                e.dataTransfer.setData(DND_SLOT, String(idx));
                e.dataTransfer.setData('text/plain', itemId);
                e.dataTransfer.effectAllowed = 'move';
            } else return;
            document.body.classList.add('inv-dragging');
        });
        document.addEventListener('dragend', () => {
            document.body.classList.remove('inv-dragging');
            document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        });
        document.addEventListener('dragover', (e) => {
            const slot = inPanel(e.target) && e.target.closest('[data-hb-slot]');
            if (!slot || !dndCarries(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            slot.classList.add('drop-target');
        });
        document.addEventListener('dragleave', (e) => {
            const slot = inPanel(e.target) && e.target.closest('[data-hb-slot]');
            if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('drop-target');
        });
        document.addEventListener('drop', (e) => {
            const slot = inPanel(e.target) && e.target.closest('[data-hb-slot]');
            if (!slot || !dndCarries(e)) return;
            e.preventDefault();
            Hotbar.attach(ui.game);
            Hotbar.dropOn(parseInt(slot.dataset.hbSlot, 10), dndPayload(e));
            ui.showInventoryPanel();
        });
        // Right-click a slot of the window's hotbar to empty it
        document.addEventListener('contextmenu', (e) => {
            const slot = inPanel(e.target) && e.target.closest('[data-hb-slot]');
            if (!slot) return;
            e.preventDefault();
            ui.invHotbarClear(parseInt(slot.dataset.hbSlot, 10));
        });
    },
});
