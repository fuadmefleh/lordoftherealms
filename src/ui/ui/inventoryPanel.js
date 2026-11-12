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

export const INVENTORY_TITLE = 'Inventory';

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
        const tip = `${e.name} ×${e.qty}${e.unitValue ? ` · ~${e.unitValue}g each` : ''}${worn ? ' · worn' : ''}${slot >= 0 ? ` · hotbar ${slot + 1}` : ''} — drag onto the hotbar`;
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
        rows.push(worn
            ? { icon: '🎒', name: 'Put away', desc: `Worn (${esc(slotLabel)}): back into the packs`, attrs: `data-ui-act="equipArms" data-ui-args="${_args([id])}"` }
            : { icon: def.slot === 'main' ? '✋' : '🧥', name: def.slot === 'main' ? 'Wield' : 'Wear', desc: `Take it up (${esc(slotLabel)})`, attrs: `data-ui-act="equipArms" data-ui-args="${_args([id])}"` });
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
    // Drop: on the ground where you stand (the street map), as the hotbar places goods
    const canDrop = !!(InnerMap && InnerMap.active);
    const dropWhy = !canDrop ? 'Only on foot in a place (the street map) — there is ground to set it on' : (worn ? 'Put it away first' : null);
    rows.push(dropWhy
        ? { icon: '⬇️', name: e.qty > 1 ? 'Drop one' : 'Drop it', off: true, why: dropWhy }
        : { icon: '⬇️', name: e.qty > 1 ? 'Drop one' : 'Drop it', desc: 'Set it on the ground beside you', attrs: `data-ui-act="invDrop" data-ui-args="${_args([id, 1])}"` });
    if (e.qty > 1 && !dropWhy) rows.push({ icon: '⏬', name: 'Drop them all', desc: `All ${e.qty} on the ground beside you`, attrs: `data-ui-act="invDrop" data-ui-args="${_args([id, e.qty])}"` });
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
    return card(body) + rowList(rows) + pick;
}

/** Where to set a dropped good on the street map: the stack beside you of the same good, or a free tile near. */
function _dropSpot(itemId) {
    const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
    if (!Number.isFinite(pq) || !Number.isFinite(pr)) return null;
    const spots = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
    let free = null;
    for (const [dq, dr] of spots) {
        const t = InnerMap.getTile(pq + dq, pr + dr);
        if (!t || !t.subTerrain || t.subTerrain.passable === false || t._wet || t._sea) continue;
        if (t.building || t.buildingInfo || t.customObject || t.customObjectPart) continue;
        if (t.groundItem) {
            if (t.groundItem.itemId === itemId && t.groundItem.placedBy === 'player' && !t.groundItem.gold) return t;
            continue;
        }
        if (!free) free = t;
    }
    return free;
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

    invSelect(itemId) {
        const st = this._invState || {};
        st.selected = st.selected === itemId ? null : itemId;
        st.pick = null;
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

    /** Set `qty` of a good on the ground beside you (the street map only; picked up again from the tile's menu). */
    invDrop(itemId, qty = 1) {
        const player = this.game.player;
        const inv = player.inventory || {};
        const have = Number(inv[itemId]) || 0;
        const n = Math.max(1, Math.min(have, Math.floor(Number(qty) || 1)));
        if (!InnerMap.active) { this.showNotification('⬇️ Drop', 'There is no ground to set it on from here: walk into the place first.', 'error'); return; }
        if (!(have > 0)) { this.showNotification('⬇️ Drop', 'You have none of that left.', 'error'); return; }
        if (Arms.isArms(itemId) && Arms.isEquipped(player, itemId) && n >= have) { this.showNotification('⬇️ Drop', 'Put it away first.', 'error'); return; }
        const tile = _dropSpot(itemId);
        if (!tile) { this.showNotification('⬇️ Drop', 'There is no clear ground beside you to set it on.', 'error'); return; }
        const g = _goodOf(itemId) || {};
        const name = g.name || itemId.replace(/_/g, ' ');
        Grades.take(player, itemId, n);
        inv[itemId] = have - n;
        if (inv[itemId] <= 0) delete inv[itemId];
        if (tile.groundItem) tile.groundItem.quantity = (tile.groundItem.quantity || 1) + n;
        else tile.groundItem = { itemId, name, icon: g.icon || '📦', quantity: n, placedBy: 'player' };
        this.showNotification(`${g.icon || '📦'} Dropped`, `${n > 1 ? `${n} ${name}` : name} set down beside you. Pick ${n > 1 ? 'them' : 'it'} up from the ground's menu.`, 'info');
        this.updateStats(player, this.game.world);
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
