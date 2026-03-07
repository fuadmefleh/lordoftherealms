// ============================================
// ITEM HOTBAR — Quick-access inventory slots
// Lets the player assign items from their
// inventory to slots 1-7 and use/place them
// in the inner map with a single keypress.
// ============================================

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { PlayerEconomy } from '../player/playerEconomy.js';

const SLOT_COUNT = 7;

/**
 * Hotbar state — 7 item slots
 * Each slot: { itemId: string|null }
 */
const _slots = Array.from({ length: SLOT_COUNT }, () => ({ itemId: null }));

let _activeSlot = -1;   // -1 = none selected
let _game = null;
let _bound = false;

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

    /** Toggle selection on a slot. */
    selectSlot(index) {
        if (index < 0 || index >= SLOT_COUNT) return;
        // If the slot is empty, ignore
        if (!_slots[index].itemId) return;
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
            if (iconEl) iconEl.textContent = itemId ? icon : '';

            // Quantity
            const qtyEl = el.querySelector('.hotbar-qty');
            if (qtyEl) qtyEl.textContent = qty > 0 ? `×${qty}` : '';

            // Active state
            el.classList.toggle('active', _activeSlot === i);
            el.classList.toggle('empty', !itemId || qty <= 0);

            // Tooltip
            let tooltipEl = el.querySelector('.hotbar-tooltip');
            if (itemId && qty > 0) {
                if (!tooltipEl) {
                    tooltipEl = document.createElement('span');
                    tooltipEl.className = 'hotbar-tooltip';
                    el.appendChild(tooltipEl);
                }
                tooltipEl.textContent = `${name} (${qty})`;
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

            const num = parseInt(e.key, 10);
            if (num >= 1 && num <= SLOT_COUNT) {
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
        this._renderSlots();
    },
};
