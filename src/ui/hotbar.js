// ============================================
// ITEM HOTBAR — Quick-access inventory slots
// Lets the player assign items from their
// inventory to slots 1-7 and use/place them
// in the inner map with a single keypress.
// The layout lives on the player and is saved
// with them (player/hotbarLayout.js); goods are
// dragged onto a slot from the Inventory window
// (ui/ui/inventoryPanel.js) or from slot to slot,
// and a right-click empties a slot.
// A weapon, shield or piece of armour is not
// placed: clicking it (or its key) takes it up
// in its slot, or puts it away when worn
// (systems/arms.js toggleEquip); the worn ones
// are marked on the bar.
// ============================================

import { InnerMap } from '../world/innerMap.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { Crafting } from '../player/crafting.js';
import { PlayerInventory } from '../core/inventory.js';
import { Arms } from '../systems/arms.js';
import { itemPicture } from './icons.js';
import { InnerMapRiverDrift } from './innerMapRiverDrift.js';
import { HotbarLayout, HOTBAR_SLOTS } from '../player/hotbarLayout.js';

const SLOT_COUNT = HOTBAR_SLOTS;

/** Drag-and-drop payload types: a good from the Inventory window, or a slot of the bar. */
export const DND_ITEM = 'application/x-realms-item';
export const DND_SLOT = 'application/x-realms-slot';

/** The slots as [{ itemId }] read from the player's layout (player/hotbarLayout.js). */
function _slotsOf() {
    const player = _game && _game.player;
    return HotbarLayout.slots(player).map(itemId => ({ itemId }));
}

let _activeSlot = -1;   // -1 = none selected
let _game = null;
let _bound = false;
// What the slots were last drawn from (PlayerInventory.stamp) and from which packs —
// sync() redraws only when either differs
let _shownStamp = null;
let _shownInv = null;

// ── Item icon lookup ──
function _getItemIcon(itemId) {
    if (!itemId) return '';
    const goods = PlayerEconomy.GOODS || {};
    const entry = goods[itemId.toUpperCase()];
    if (entry && entry.icon) return entry.icon;
    // Fallback icons for common types
    const fallback = {
        wood: '🌲', stone: '⛰️', iron: '⚒️', bread: '🍞', grain: '🌾',
        fish: '🐟', wool: '🐑', tools: '🔧', weapons: '⚔️', gold_ore: '💰',
        gems: '💎', horses: '🐴', beer: '🍺', liquor: '🥃', spices: '🧂',
        flour: '🥡', textiles: '🧵', clothes: '👕', firewood: '🔥',
        preserved_fish: '🍥', luxuries: '💍',
    };
    return fallback[itemId] || '📦';
}

function _getItemName(itemId) {
    if (!itemId) return '';
    const goods = PlayerEconomy.GOODS || {};
    const entry = goods[itemId.toUpperCase()];
    if (entry && entry.name) return entry.name;
    return itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Does this drag carry a good or a slot of ours? */
export function dndCarries(e) {
    const types = e && e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    const list = Array.from(types);
    return list.includes(DND_ITEM) || list.includes(DND_SLOT);
}

/** What a drop carries: { itemId } from the Inventory window or { fromSlot } from the bar. */
export function dndPayload(e) {
    const dt = e && e.dataTransfer;
    if (!dt) return {};
    const slot = dt.getData(DND_SLOT);
    if (slot !== '' && slot != null) return { fromSlot: parseInt(slot, 10) };
    const itemId = dt.getData(DND_ITEM);
    return itemId ? { itemId } : {};
}

export const Hotbar = {

    /** Initialise hotbar — call once after Game is ready. */
    init(game) {
        _game = game;
        if (!_bound) {
            _bound = true;
            this._bindInput();
        }
        this.refresh();
    },

    /** Show the hotbar DOM element. */
    show() {
        const el = document.getElementById('itemHotbar');
        if (el) el.classList.remove('hidden');
        this.refresh();
    },

    /** Hide the hotbar DOM element. */
    hide() {
        const el = document.getElementById('itemHotbar');
        if (el) el.classList.add('hidden');
        _activeSlot = -1;
        this._renderSlots();
    },

    /** Whether the hotbar is currently visible. */
    get visible() {
        const el = document.getElementById('itemHotbar');
        return el && !el.classList.contains('hidden');
    },

    /** Currently selected slot index (0-based), or -1. */
    get activeSlot() { return _activeSlot; },

    /** The itemId in the currently selected slot, or null. */
    get activeItemId() {
        if (_activeSlot < 0 || _activeSlot >= SLOT_COUNT || !_game || !_game.player) return null;
        return HotbarLayout.itemAt(_game.player, _activeSlot);
    },

    // ── Slot management ──

    /**
     * Point the bar at a game without showing it (the Inventory window arranges
     * the layout on the world map too) and redraw it if it is up.
     */
    attach(game) {
        if (game) _game = game;
        this._renderSlots();
    },

    /** Assign an item to a slot (0-based index); a good already on the bar moves here. */
    setSlot(index, itemId) {
        if (index < 0 || index >= SLOT_COUNT || !_game || !_game.player) return;
        if (!itemId) { this.clearSlot(index); return; }
        HotbarLayout.assign(_game.player, index, itemId);
        _activeSlot = -1;
        this._renderSlots();
    },

    /** Clear a slot. */
    clearSlot(index) {
        if (index < 0 || index >= SLOT_COUNT || !_game || !_game.player) return;
        HotbarLayout.clear(_game.player, index);
        if (_activeSlot === index) _activeSlot = -1;
        this._renderSlots();
    },

    /** Swap two slots (one dragged onto the other). */
    moveSlot(from, to) {
        if (!_game || !_game.player) return;
        if (HotbarLayout.move(_game.player, from, to)) {
            if (_activeSlot === from) _activeSlot = to;
            else if (_activeSlot === to) _activeSlot = from;
            this._renderSlots();
        }
    },

    /**
     * Something dropped on slot `index`: a good from the Inventory window
     * ({ itemId }) or another slot ({ fromSlot }). → true when the layout changed
     */
    dropOn(index, { itemId = null, fromSlot = null } = {}) {
        if (!_game || !_game.player) return false;
        const from = fromSlot == null ? NaN : Number(fromSlot);
        if (Number.isInteger(from)) {
            const before = HotbarLayout.slots(_game.player).join('|');
            this.moveSlot(from, index);
            return HotbarLayout.slots(_game.player).join('|') !== before;
        }
        if (itemId) {
            const changed = HotbarLayout.assign(_game.player, index, itemId);
            _activeSlot = -1;
            this._renderSlots();
            return changed;
        }
        return false;
    },

    /** Toggle selection on a slot (arms: take it up or put it away instead). */
    selectSlot(index) {
        if (index < 0 || index >= SLOT_COUNT || !_game || !_game.player) return;
        const itemId = HotbarLayout.itemAt(_game.player, index);
        // If the slot is empty — or its good has run out — ignore
        if (!itemId || !((_game.player.inventory || {})[itemId] > 0)) return;
        if (Arms.isArms(itemId)) {
            this.equipItem(itemId);
            return;
        }
        // If already selected, deselect
        if (_activeSlot === index) {
            _activeSlot = -1;
        } else {
            _activeSlot = index;
        }
        this._renderSlots();
    },

    /**
     * Bring the bar up to date with the packs. Until the player arranges it by
     * hand the layout fills itself (goods used up leave, new goods take the
     * empty slots); a hand-arranged one keeps its slots, a good that ran out
     * drawn empty (player/hotbarLayout.js reconcile).
     */
    refresh() {
        if (!_game || !_game.player) return;
        const inv = _game.player.inventory || {};
        _shownStamp = PlayerInventory.stamp(_game.player);
        _shownInv = _game.player.inventory || null;
        HotbarLayout.reconcile(_game.player, inv);
        this._renderSlots();
    },

    /**
     * Keep the bar true to the packs: called by the game loop every frame
     * (ui/game/gameLoop.js). Whatever road the goods took into or out of
     * `player.inventory` — harvest, forage, felling, mining, butchery, a
     * dug-up find, the livestock pen, a grave — the fingerprint changes and
     * the slots are redrawn; otherwise it costs one short string. Returns
     * whether it redrew.
     */
    sync(game) {
        if (game) _game = game;
        if (!_game || !_game.player || !this.visible) return false;
        const inv = _game.player.inventory || null;
        if (inv === _shownInv && PlayerInventory.stamp(_game.player) === _shownStamp) return false;
        this.refresh();
        return true;
    },

    /**
     * Take up a weapon, shield or piece of armour from the bar in its slot
     * (a two-hander clears the shield), or put it away when it is the one
     * worn — with a word on what happened. → the Arms.toggleEquip result
     */
    equipItem(itemId) {
        if (!_game || !_game.player || !Arms.isArms(itemId)) return null;
        const player = _game.player;
        const res = Arms.toggleEquip(player, itemId);
        const ui = _game.ui;
        if (ui && typeof ui.showNotification === 'function') {
            const slotIcon = (Arms.config().slots[res.slot] || {}).icon || '⚔️';
            ui.showNotification(res.success ? `${slotIcon} ${res.label || 'Arms'}` : '⚔️ Arms & Armour',
                res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
        }
        if (ui && typeof ui.updateStats === 'function') ui.updateStats(player, _game.world);
        if (_activeSlot >= 0 && HotbarLayout.itemAt(player, _activeSlot) === itemId) _activeSlot = -1;
        this._renderSlots();
        return res;
    },

    /**
     * Use the active hotbar item at the given inner-map tile.
     * Returns true if the item was consumed.
     */
    useActiveItem(q, r) {
        const itemId = this.activeItemId;
        if (!itemId || !_game || !_game.player) return false;

        const inv = _game.player.inventory || {};
        if (!inv[itemId] || inv[itemId] <= 0) {
            _game.ui.showNotification('No Items', `You don't have any ${_getItemName(itemId)} left.`, 'error');
            this.refresh();
            return false;
        }

        // Check tile is passable and nearby
        const tile = InnerMap.getTile(q, r);
        if (!tile) return false;

        // Place / use the item on the tile
        // For now: drop the item, creating a resource node on the tile
        const placed = this._placeItem(itemId, q, r, tile);
        if (!placed) return false;

        // Deduct from inventory
        inv[itemId]--;
        if (inv[itemId] <= 0) delete inv[itemId];

        // Update HUD
        if (_game.ui) _game.ui.updateStats(_game.player, _game.world);
        this.refresh();

        return true;
    },

    /**
     * Place an item on an inner-map tile.
     * Different item types have different placement effects.
     */
    _placeItem(itemId, q, r, tile) {
        // Clicked on a river, or water too deep to stand in: into it it goes — off downstream, or
        // afloat where it lands (ui/innerMapRiverDrift.js; the packs are emptied below)
        if (InnerMapRiverDrift.isThrowCell(q, r)) return InnerMapRiverDrift.throwItem(_game, itemId, q, r, { keep: true });

        // Don't place on impassable tiles
        if (tile.subTerrain && tile.subTerrain.passable === false) {
            _game.ui.showNotification('Blocked', 'Cannot place items on impassable terrain.', 'error');
            return false;
        }

        // Don't place on tiles with buildings
        if (tile.building || tile.buildingInfo) {
            _game.ui.showNotification('Blocked', 'Cannot place items on buildings.', 'error');
            return false;
        }

        // Don't place on tiles that already have a custom object
        if (tile.customObject || tile.customObjectPart) {
            _game.ui.showNotification('Occupied', 'There is already an object here.', 'error');
            return false;
        }

        // Don't place on the player's tile
        if (q === InnerMap.playerInnerQ && r === InnerMap.playerInnerR) {
            _game.ui.showNotification('Blocked', 'You are standing here! Move first.', 'error');
            return false;
        }

        const name = _getItemName(itemId);
        const icon = _getItemIcon(itemId);

        // Create a ground item marker on the tile
        tile.groundItem = {
            itemId,
            name,
            icon,
            quantity: 1,
            placedBy: 'player',
        };

        _game.ui.showNotification(`${icon} Placed`, `Dropped ${name} at (${q}, ${r}).`, 'info');
        return true;
    },

    // ── Rendering ──

    /** Re-render all slot DOM elements. */
    _renderSlots() {
        const container = document.getElementById('itemHotbar');
        if (!container) return;

        const inv = (_game && _game.player) ? (_game.player.inventory || {}) : {};
        const slotEls = container.querySelectorAll('.hotbar-slot');
        const slots = _slotsOf();
        // A selected good that ran out is no longer in hand
        if (_activeSlot >= 0 && !(slots[_activeSlot] && slots[_activeSlot].itemId && inv[slots[_activeSlot].itemId] > 0)) _activeSlot = -1;

        slotEls.forEach((el, i) => {
            const slot = slots[i];
            const itemId = slot ? slot.itemId : null;
            const qty = itemId ? (inv[itemId] || 0) : 0;
            const icon = _getItemIcon(itemId);
            const name = _getItemName(itemId);

            // Icon
            const iconEl = el.querySelector('.hotbar-icon');
            if (iconEl) {
                // a good with its own picture (ui/icons.js itemPicture) shows it, else its emoji
                const pic = itemId ? itemPicture(itemId) : null;
                if (pic) iconEl.innerHTML = `<img src="${pic}" alt="" draggable="false" style="width:80%;height:80%;object-fit:contain;vertical-align:middle;">`;
                else iconEl.textContent = itemId ? icon : '';
            }
            // A filled slot can be dragged onto another; one whose good ran out is greyed but kept
            el.draggable = !!itemId;
            el.classList.toggle('kept', !!itemId && qty <= 0);

            // Quantity
            const qtyEl = el.querySelector('.hotbar-qty');
            if (qtyEl) qtyEl.textContent = qty > 0 ? `×${qty}` : '';

            // Active state; arms worn in their slot are marked
            const worn = !!itemId && qty > 0 && Arms.isArms(itemId) && Arms.isEquipped(_game.player, itemId);
            el.classList.toggle('active', _activeSlot === i);
            el.classList.toggle('equipped', worn);
            el.classList.toggle('empty', !itemId || qty <= 0);

            // Tooltip
            let tooltipEl = el.querySelector('.hotbar-tooltip');
            if (itemId && qty > 0) {
                if (!tooltipEl) {
                    tooltipEl = document.createElement('span');
                    tooltipEl.className = 'hotbar-tooltip';
                    el.appendChild(tooltipEl);
                }
                const qTag = Crafting.qualityTag(_game.player, itemId);
                const arm = Arms.isArms(itemId) ? (Arms.config().slots[Arms.item(itemId).slot] || {}).label : null;
                const how = arm ? (worn ? ` · worn (${arm.toLowerCase()}): click to put away` : ` · click to take up (${arm.toLowerCase()})`) : '';
                tooltipEl.textContent = `${name}${qTag ? ` · ${qTag}` : ''} (${qty})${how}`;
            } else if (itemId) {
                if (!tooltipEl) {
                    tooltipEl = document.createElement('span');
                    tooltipEl.className = 'hotbar-tooltip';
                    el.appendChild(tooltipEl);
                }
                tooltipEl.textContent = `${name}: none left · kept here (right-click to clear)`;
            } else if (tooltipEl) {
                tooltipEl.textContent = '';
            }
        });
    },

    // ── Input binding ──

    _bindInput() {
        // Click on slot
        const container = document.getElementById('itemHotbar');
        if (container) {
            container.addEventListener('click', (e) => {
                const slotEl = e.target.closest('.hotbar-slot');
                if (!slotEl) return;
                const idx = parseInt(slotEl.dataset.slot, 10) - 1; // data-slot is 1-based
                if (Number.isFinite(idx)) {
                    this.selectSlot(idx);
                }
            });

            // Right-click on slot to remove assignment
            container.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const slotEl = e.target.closest('.hotbar-slot');
                if (!slotEl) return;
                const idx = parseInt(slotEl.dataset.slot, 10) - 1;
                if (Number.isFinite(idx)) {
                    this.clearSlot(idx);
                    if (_game && _game.ui && typeof _game.ui.refreshInventoryPanel === 'function') _game.ui.refreshInventoryPanel();
                }
            });

            // Drag a slot onto another to swap them; drop a good from the Inventory window on a slot
            container.addEventListener('dragstart', (e) => {
                const slotEl = e.target.closest && e.target.closest('.hotbar-slot');
                if (!slotEl || !e.dataTransfer || !_game || !_game.player) return;
                const idx = parseInt(slotEl.dataset.slot, 10) - 1;
                const itemId = HotbarLayout.itemAt(_game.player, idx);
                if (!itemId) { e.preventDefault(); return; }
                e.dataTransfer.setData(DND_SLOT, String(idx));
                e.dataTransfer.setData('text/plain', itemId);
                e.dataTransfer.effectAllowed = 'move';
            });
            container.addEventListener('dragover', (e) => {
                const slotEl = e.target.closest && e.target.closest('.hotbar-slot');
                if (!slotEl || !dndCarries(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                slotEl.classList.add('drop-target');
            });
            container.addEventListener('dragleave', (e) => {
                const slotEl = e.target.closest && e.target.closest('.hotbar-slot');
                if (slotEl && !slotEl.contains(e.relatedTarget)) slotEl.classList.remove('drop-target');
            });
            container.addEventListener('drop', (e) => {
                const slotEl = e.target.closest && e.target.closest('.hotbar-slot');
                container.querySelectorAll('.hotbar-slot.drop-target').forEach(s => s.classList.remove('drop-target'));
                if (!slotEl || !dndCarries(e)) return;
                e.preventDefault();
                const idx = parseInt(slotEl.dataset.slot, 10) - 1;
                this.dropOn(idx, dndPayload(e));
                // The Inventory window shows the bar too: keep it in step
                if (_game && _game.ui && typeof _game.ui.refreshInventoryPanel === 'function') _game.ui.refreshInventoryPanel();
            });
        }

        // Keyboard: 1-7 select hotbar slots when in inner map
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            // Only handle hotbar keys when inner map is active & hotbar visible
            if (!InnerMap.active || !this.visible) return;
            // A conversation owns the number keys (its choices)
            if (document.getElementById('npcDialogOverlay')) return;

            // Only claim the key when the slot holds an item, so empty slots
            // leave 1/2/3 free for the speed shortcuts.
            const num = parseInt(e.key, 10);
            const held = num >= 1 && num <= SLOT_COUNT && _game && _game.player
                ? HotbarLayout.itemAt(_game.player, num - 1) : null;
            if (held && (_game.player.inventory || {})[held] > 0) {
                e.preventDefault();
                e.stopPropagation();
                this.selectSlot(num - 1);
            }
        }, true); // Use capture phase so we can intercept before speed controls
    },

    /** The slots as an array of itemIds (the layout itself is saved with the player: player.hotbar). */
    serialise() {
        return HotbarLayout.slots(_game && _game.player);
    },

    /** Lay the slots out from an array of itemIds (a hand-made layout). */
    deserialise(arr) {
        if (!Array.isArray(arr) || !_game || !_game.player) return;
        _game.player.hotbar = { slots: arr.slice(0, SLOT_COUNT), manual: true };
        HotbarLayout.ensure(_game.player);
        _activeSlot = -1;
        _shownStamp = null;
        this._renderSlots();
    },
};
