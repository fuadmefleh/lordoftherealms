// ============================================
// ITEM HOTBAR — Quick-access inventory slots
// Lets the player assign items from their
// inventory to slots 1-7 and use/place them
// in the inner map with a single keypress.
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

const SLOT_COUNT = 7;

/**
 * Hotbar state — 7 item slots
 * Each slot: { itemId: string|null }
 */
const _slots = Array.from({ length: SLOT_COUNT }, () => ({ itemId: null }));

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
        if (_activeSlot < 0 || _activeSlot >= SLOT_COUNT) return null;
        return _slots[_activeSlot].itemId;
    },

    // ── Slot management ──

    /** Assign an item to a slot (0-based index). */
    setSlot(index, itemId) {
        if (index < 0 || index >= SLOT_COUNT) return;
        _slots[index].itemId = itemId;
        this._renderSlots();
    },

    /** Clear a slot. */
    clearSlot(index) {
        if (index < 0 || index >= SLOT_COUNT) return;
        _slots[index].itemId = null;
        if (_activeSlot === index) _activeSlot = -1;
        this._renderSlots();
    },

    /** Toggle selection on a slot (arms: take it up or put it away instead). */
    selectSlot(index) {
        if (index < 0 || index >= SLOT_COUNT) return;
        // If the slot is empty, ignore
        if (!_slots[index].itemId) return;
        if (Arms.isArms(_slots[index].itemId)) {
            this.equipItem(_slots[index].itemId);
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
     * Auto-populate hotbar slots from the player's inventory.
     * Keeps existing assignments if the item is still in inventory.
     */
    refresh() {
        if (!_game || !_game.player) return;
        const inv = _game.player.inventory || {};
        _shownStamp = PlayerInventory.stamp(_game.player);
        _shownInv = _game.player.inventory || null;
        const invKeys = Object.keys(inv).filter(k => inv[k] > 0);

        // Remove slots whose items are no longer in inventory
        for (let i = 0; i < SLOT_COUNT; i++) {
            if (_slots[i].itemId && !invKeys.includes(_slots[i].itemId)) {
                _slots[i].itemId = null;
                if (_activeSlot === i) _activeSlot = -1;
            }
        }

        // Fill empty slots with un-assigned inventory items
        const assigned = new Set(_slots.map(s => s.itemId).filter(Boolean));
        const unassigned = invKeys.filter(k => !assigned.has(k));
        let uIdx = 0;
        for (let i = 0; i < SLOT_COUNT && uIdx < unassigned.length; i++) {
            if (!_slots[i].itemId) {
                _slots[i].itemId = unassigned[uIdx++];
            }
        }

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
        if (_activeSlot >= 0 && _slots[_activeSlot] && _slots[_activeSlot].itemId === itemId) _activeSlot = -1;
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
        // Clicked on a river: into the water it goes, and off downstream (ui/innerMapRiverDrift.js;
        // the packs are emptied below)
        if (InnerMapRiverDrift.isRiverCell(q, r)) return InnerMapRiverDrift.throwItem(_game, itemId, q, r, { keep: true });

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

        slotEls.forEach((el, i) => {
            const slot = _slots[i];
            const itemId = slot ? slot.itemId : null;
            const qty = itemId ? (inv[itemId] || 0) : 0;
            const icon = _getItemIcon(itemId);
            const name = _getItemName(itemId);

            // Icon
            const iconEl = el.querySelector('.hotbar-icon');
            if (iconEl) {
                // a good with its own picture (ui/icons.js itemPicture) shows it, else its emoji
                const pic = itemId ? itemPicture(itemId) : null;
                if (pic) iconEl.innerHTML = `<img src="${pic}" alt="" style="width:80%;height:80%;object-fit:contain;vertical-align:middle;">`;
                else iconEl.textContent = itemId ? icon : '';
            }

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
                }
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
            if (num >= 1 && num <= SLOT_COUNT && _slots[num - 1].itemId) {
                e.preventDefault();
                e.stopPropagation();
                this.selectSlot(num - 1);
            }
        }, true); // Use capture phase so we can intercept before speed controls
    },

    /** Serialise hotbar slots for save data. */
    serialise() {
        return _slots.map(s => s.itemId);
    },

    /** Restore hotbar slots from save data. */
    deserialise(arr) {
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < SLOT_COUNT && i < arr.length; i++) {
            _slots[i].itemId = arr[i] || null;
        }
        _activeSlot = -1;
        _shownStamp = null;
        this._renderSlots();
    },
};
