// ═══════════════════════════════════════════════════════════════
// OBJECT ACTIONS — Configurable actions for editor-authored objects
// ═══════════════════════════════════════════════════════════════
// Each custom object can have an `actions` array in its definition.
// Each entry is an action key from OBJECT_ACTIONS below.
// When the player right-clicks an object, matching actions appear
// in the context menu. Executing an action opens a themed modal
// or applies effects immediately.
// ═══════════════════════════════════════════════════════════════

import { InnerMap } from '../world/innerMap.js';
import { Hotbar } from './hotbar.js';

// ── Master action registry ──
// Each action defines its label, icon, description, category,
// required conditions, and an execute() function.
const OBJECT_ACTIONS = {
    // ──────────── REST & RECOVERY ────────────
    sleep: {
        label: 'Sleep',
        icon: '🛏️',
        desc: 'Rest and recover energy',
        category: 'rest',
        modal: 'sleep',
        condition: null, // always available
    },
    sit: {
        label: 'Sit Down',
        icon: '🪑',
        desc: 'Take a seat and relax',
        category: 'rest',
        modal: null, // instant
        effects: { comfort: 15, energy: 5, fun: 3 },
        message: 'You sit down and rest your legs.',
        timeSkip: 0,
    },
    warm: {
        label: 'Warm Up',
        icon: '🔥',
        desc: 'Warm yourself by the fire',
        category: 'rest',
        modal: null,
        effects: { comfort: 20, energy: 5, fun: 5 },
        message: 'The warmth of the fire soothes your weary body.',
        timeSkip: 1,
    },
    // ──────────── HYGIENE ────────────
    wash: {
        label: 'Wash',
        icon: '💧',
        desc: 'Clean yourself',
        category: 'hygiene',
        modal: null,
        effects: { hygiene: 35, comfort: 8 },
        message: 'You wash and feel refreshed.',
        timeSkip: 1,
    },
    bathe: {
        label: 'Bathe',
        icon: '🛁',
        desc: 'Take a long relaxing bath',
        category: 'hygiene',
        modal: null,
        effects: { hygiene: 60, comfort: 25, energy: 10, fun: 8 },
        message: 'You take a luxurious bath. All your worries melt away.',
        timeSkip: 2,
    },
    // ──────────── FOOD & DRINK ────────────
    eat: {
        label: 'Eat',
        icon: '🍽️',
        desc: 'Eat food from your inventory',
        category: 'food',
        modal: 'eat',
        condition: (game) => {
            const foods = _getPlayerFoods(game);
            return foods.length > 0;
        },
        conditionFail: 'You have no food in your inventory.',
    },
    drink: {
        label: 'Have a Drink',
        icon: '🍺',
        desc: 'Drink an ale (costs 2 gold)',
        category: 'food',
        modal: null,
        condition: (game) => game.player.gold >= 2,
        conditionFail: "You can't afford a drink (2 gold).",
        effects: { hunger: 10, fun: 15, social: 10, energy: -5 },
        cost: 2,
        message: 'You enjoy a refreshing ale. Cheers!',
        timeSkip: 1,
    },
    cook: {
        label: 'Cook',
        icon: '🍳',
        desc: 'Cook raw ingredients into meals',
        category: 'food',
        modal: 'cook',
        condition: (game) => {
            const ingredients = _getCookableItems(game);
            return ingredients.length > 0;
        },
        conditionFail: 'You have no ingredients to cook.',
    },
    // ──────────── ENTERTAINMENT ────────────
    read: {
        label: 'Read',
        icon: '📖',
        desc: 'Read and learn something new',
        category: 'entertainment',
        modal: null,
        effects: { fun: 20, comfort: 8, social: -3 },
        message: null, // dynamic message
        timeSkip: 2,
        onExecute: (game) => {
            const topics = [
                { text: 'You read about ancient battle tactics.', skill: 'strategy', xp: 5 },
                { text: 'You study a treatise on trade routes.', skill: 'trade', xp: 5 },
                { text: 'You read thrilling tales of adventure.', skill: null, xp: 0 },
                { text: 'You find notes on local flora and their medicinal uses.', skill: 'herbalism', xp: 5 },
                { text: 'You read about the history of these lands.', skill: 'lore', xp: 5 },
                { text: 'You study architectural diagrams.', skill: 'construction', xp: 5 },
                { text: 'You read poetry and feel inspired.', skill: null, xp: 0 },
                { text: 'You study a map and learn about nearby regions.', skill: 'cartography', xp: 5 },
            ];
            const topic = topics[Math.floor(Math.random() * topics.length)];
            if (topic.skill && topic.xp && game.player.skills) {
                game.player.skills[topic.skill] = (game.player.skills[topic.skill] || 0) + topic.xp;
            }
            return topic.text;
        },
    },
    play_instrument: {
        label: 'Play Music',
        icon: '🎵',
        desc: 'Play an instrument for fun',
        category: 'entertainment',
        modal: null,
        effects: { fun: 25, social: 12, comfort: 5, energy: -5 },
        message: 'You play a lively tune. Nearby people seem to enjoy it.',
        timeSkip: 1,
    },
    play_game: {
        label: 'Play Game',
        icon: '🎲',
        desc: 'Play a tabletop game',
        category: 'entertainment',
        modal: null,
        effects: { fun: 20, social: 15, comfort: 5 },
        message: 'You enjoy a round of dice. How entertaining!',
        timeSkip: 1,
    },
    pray: {
        label: 'Pray',
        icon: '🙏',
        desc: 'Pray at the shrine or altar',
        category: 'spiritual',
        modal: null,
        effects: { comfort: 18, fun: 5, social: -3 },
        message: 'You offer a prayer. A sense of peace washes over you.',
        timeSkip: 1,
        onExecute: (game) => {
            game.player.karma = (game.player.karma || 0) + 1;
            return null; // use default message
        },
    },
    meditate: {
        label: 'Meditate',
        icon: '🧘',
        desc: 'Meditate and clear your mind',
        category: 'spiritual',
        modal: null,
        effects: { comfort: 15, energy: 10, fun: 5 },
        message: 'You meditate in silence. Your mind feels clear and focused.',
        timeSkip: 2,
    },
    // ──────────── CRAFTING & PRODUCTION ────────────
    craft: {
        label: 'Craft',
        icon: '🔨',
        desc: 'Craft items at a workbench',
        category: 'production',
        modal: 'craft',
    },
    smelt: {
        label: 'Smelt Ore',
        icon: '⚒️',
        desc: 'Smelt raw ore into metal ingots',
        category: 'production',
        modal: 'smelt',
        condition: (game) => {
            const inv = game.player.inventory || {};
            return (inv.iron || 0) >= 3 || (inv.gold_ore || 0) >= 3;
        },
        conditionFail: 'You need at least 3 ore to smelt.',
    },
    brew: {
        label: 'Brew Potion',
        icon: '🧪',
        desc: 'Brew healing potions from herbs',
        category: 'production',
        modal: 'brew',
        condition: (game) => {
            const inv = game.player.inventory || {};
            return (inv.herbs || 0) >= 2;
        },
        conditionFail: 'You need at least 2 herbs to brew.',
    },
    tan: {
        label: 'Tan Leather',
        icon: '🟫',
        desc: 'Tan hides into usable leather',
        category: 'production',
        modal: null,
        condition: (game) => {
            const inv = game.player.inventory || {};
            return (inv.leather || 0) >= 2;
        },
        conditionFail: 'You need at least 2 raw hides.',
        effects: {},
        timeSkip: 2,
        onExecute: (game) => {
            game.player.inventory.leather -= 2;
            game.player.inventory.leather_armor = (game.player.inventory.leather_armor || 0) + 1;
            return 'You tan the hides. Gained 1 leather armor piece.';
        },
    },
    // ──────────── GATHERING ────────────
    fish: {
        label: 'Fish',
        icon: '🎣',
        desc: 'Cast a line and try your luck',
        category: 'gathering',
        modal: 'fish',
    },
    draw_water: {
        label: 'Draw Water',
        icon: '🪣',
        desc: 'Draw water from the well',
        category: 'gathering',
        modal: null,
        effects: { hygiene: 10 },
        message: 'You draw fresh water from the well.',
        timeSkip: 0,
    },
    // ──────────── STORAGE ────────────
    store: {
        label: 'Store Items',
        icon: '📦',
        desc: 'Store or retrieve items',
        category: 'storage',
        modal: 'store',
    },
    // ──────────── HEALING ────────────
    heal: {
        label: 'Heal',
        icon: '💊',
        desc: 'Use herbs or potions to heal',
        category: 'healing',
        modal: 'heal',
        condition: (game) => {
            const inv = game.player.inventory || {};
            return (inv.herbs || 0) >= 1 || (inv.healing_salve || 0) >= 1 || (inv.potion || 0) >= 1;
        },
        conditionFail: 'You have no healing items.',
    },
};

// ── Food items recognized by the eat action ──
const FOOD_ITEMS = {
    bread:       { label: 'Bread',        icon: '🍞', hunger: 25, energy: 5 },
    grain:       { label: 'Grain',         icon: '🌾', hunger: 15, energy: 3 },
    fruit:       { label: 'Fruit',         icon: '🍎', hunger: 20, energy: 8, fun: 3 },
    berries:     { label: 'Berries',       icon: '🫐', hunger: 12, energy: 5, fun: 2 },
    mushrooms:   { label: 'Mushrooms',     icon: '🍄', hunger: 15, energy: 3 },
    fish:        { label: 'Fish',          icon: '🐟', hunger: 20, energy: 5 },
    dried_meat:  { label: 'Dried Meat',    icon: '🥩', hunger: 30, energy: 10 },
    cheese:      { label: 'Cheese',        icon: '🧀', hunger: 22, energy: 5, fun: 5 },
    honey:       { label: 'Honey',         icon: '🍯', hunger: 10, energy: 15, fun: 5 },
    herbs:       { label: 'Herbs',         icon: '🌿', hunger: 5, energy: 3 },
    cooked_meal: { label: 'Cooked Meal',   icon: '🍲', hunger: 45, energy: 15, fun: 10, comfort: 8 },
    wine:        { label: 'Wine',          icon: '🍷', hunger: 5, fun: 15, social: 10, energy: -8 },
    tea:         { label: 'Tea',           icon: '🍵', hunger: 5, energy: 12, comfort: 10 },
    salt:        { label: 'Salt',          icon: '🧂', hunger: 3 },
    exotic_spices: { label: 'Exotic Spices', icon: '🌶️', hunger: 5, fun: 5 },
};

// ── Cooking recipes ──
const COOK_RECIPES = [
    { id: 'cooked_meal', label: 'Cooked Meal', icon: '🍲', ingredients: { grain: 1, dried_meat: 1 }, result: { cooked_meal: 1 }, desc: 'A hearty meal' },
    { id: 'cooked_fish', label: 'Grilled Fish', icon: '🐟', ingredients: { fish: 1 }, result: { cooked_meal: 1 }, desc: 'Freshly grilled fish' },
    { id: 'fruit_salad', label: 'Fruit Salad', icon: '🥗', ingredients: { fruit: 2 }, result: { cooked_meal: 1 }, desc: 'A refreshing fruit salad' },
    { id: 'mushroom_stew', label: 'Mushroom Stew', icon: '🍲', ingredients: { mushrooms: 2, herbs: 1 }, result: { cooked_meal: 2 }, desc: 'A rich mushroom stew' },
    { id: 'herbal_tea', label: 'Herbal Tea', icon: '🍵', ingredients: { herbs: 1 }, result: { tea: 2 }, desc: 'Soothing herbal tea' },
    { id: 'bread_bake', label: 'Bake Bread', icon: '🍞', ingredients: { grain: 2 }, result: { bread: 2 }, desc: 'Fresh-baked bread' },
    { id: 'spiced_wine', label: 'Spiced Wine', icon: '🍷', ingredients: { wine: 1, exotic_spices: 1 }, result: { wine: 2 }, desc: 'Rich spiced wine' },
    { id: 'honey_cake', label: 'Honey Cake', icon: '🍰', ingredients: { grain: 1, honey: 1 }, result: { cooked_meal: 2 }, desc: 'Sweet honey cakes' },
];

// ── Crafting recipes ──
const CRAFT_RECIPES = [
    { id: 'arrows_craft', label: 'Arrows (×10)', icon: '🏹', ingredients: { wood: 2, iron: 1 }, result: { arrows: 10 }, desc: 'A bundle of iron-tipped arrows' },
    { id: 'shield_craft', label: 'Wooden Shield', icon: '🛡️', ingredients: { wood: 5, iron: 2 }, result: { shield: 1 }, desc: 'A sturdy wooden shield' },
    { id: 'bow_craft', label: 'Hunting Bow', icon: '🏹', ingredients: { wood: 4 }, result: { bow: 1 }, desc: 'A simple hunting bow' },
    { id: 'leather_armor_craft', label: 'Leather Armor', icon: '🦺', ingredients: { leather: 5, iron: 1 }, result: { leather_armor: 1 }, desc: 'Light protective armor' },
    { id: 'rope_craft', label: 'Rope', icon: '🪢', ingredients: { herbs: 3 }, result: { rope: 2 }, desc: 'Strong hemp rope' },
    { id: 'candles_craft', label: 'Candles', icon: '🕯️', ingredients: { honey: 1 }, result: { candles: 3 }, desc: 'Beeswax candles' },
    { id: 'pottery_craft', label: 'Pottery', icon: '🏺', ingredients: { clay: 3 }, result: { pottery: 1 }, desc: 'A decorative pot' },
    { id: 'lantern_craft', label: 'Lantern', icon: '🏮', ingredients: { iron: 2, candles: 1 }, result: { lantern: 1 }, desc: 'An iron lantern' },
    { id: 'healing_salve_craft', label: 'Healing Salve', icon: '🩹', ingredients: { herbs: 3, honey: 1 }, result: { healing_salve: 1 }, desc: 'Soothes wounds and speeds recovery' },
    { id: 'amulet_craft', label: 'Amulet', icon: '🔮', ingredients: { gems: 1, iron: 1 }, result: { amulet: 1 }, desc: 'A mystical protective amulet' },
    { id: 'dyes_craft', label: 'Dyes', icon: '🎨', ingredients: { flowers: 3 }, result: { dyes: 2 }, desc: 'Vibrant fabric dyes' },
    { id: 'incense_craft', label: 'Incense', icon: '🪔', ingredients: { herbs: 2, resin: 1 }, result: { incense: 2 }, desc: 'Fragrant incense sticks' },
];

// ── Smelting recipes ──
const SMELT_RECIPES = [
    { id: 'iron_ingot', label: 'Iron Ingot', icon: '🔩', ingredients: { iron: 3 }, result: { iron_ingot: 1 }, desc: 'A refined iron ingot' },
    { id: 'gold_bar', label: 'Gold Bar', icon: '🥇', ingredients: { gold_ore: 3 }, result: { gold_bar: 1 }, desc: 'A gleaming gold bar' },
];

// ── Brew recipes ──
const BREW_RECIPES = [
    { id: 'healing_potion', label: 'Healing Potion', icon: '❤️', ingredients: { herbs: 2 }, result: { potion: 1 }, desc: 'Restores health when consumed' },
    { id: 'energy_elixir', label: 'Energy Elixir', icon: '⚡', ingredients: { herbs: 3, honey: 1 }, result: { elixir: 1 }, desc: 'A burst of energy' },
    { id: 'antidote', label: 'Antidote', icon: '🟢', ingredients: { herbs: 2, mushrooms: 1 }, result: { potion: 1 }, desc: 'Cures poisons and ailments' },
];

// ── Healing items ──
const HEAL_ITEMS = {
    herbs:         { label: 'Herbs',         icon: '🌿', heal: 10, cost: 1 },
    healing_salve: { label: 'Healing Salve', icon: '🩹', heal: 30, cost: 1 },
    potion:        { label: 'Healing Potion', icon: '❤️', heal: 50, cost: 1 },
    elixir:        { label: 'Elixir',         icon: '⚡', heal: 40, cost: 1, energy: 30 },
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function _getPlayerFoods(game) {
    const inv = game.player.inventory || {};
    const foods = [];
    for (const [id, def] of Object.entries(FOOD_ITEMS)) {
        const qty = inv[id] || 0;
        if (qty > 0) foods.push({ id, qty, ...def });
    }
    return foods;
}

function _getCookableItems(game) {
    const inv = game.player.inventory || {};
    return COOK_RECIPES.filter(r => {
        for (const [item, amt] of Object.entries(r.ingredients)) {
            if ((inv[item] || 0) < amt) return false;
        }
        return true;
    });
}

function _canCraftRecipe(game, recipe) {
    const inv = game.player.inventory || {};
    for (const [item, amt] of Object.entries(recipe.ingredients)) {
        if ((inv[item] || 0) < amt) return false;
    }
    return true;
}

function _consumeIngredients(game, ingredients) {
    if (!game.player.inventory) game.player.inventory = {};
    for (const [item, amt] of Object.entries(ingredients)) {
        game.player.inventory[item] = Math.max(0, (game.player.inventory[item] || 0) - amt);
        if (game.player.inventory[item] <= 0) delete game.player.inventory[item];
    }
}

function _giveResults(game, results) {
    if (!game.player.inventory) game.player.inventory = {};
    for (const [item, amt] of Object.entries(results)) {
        game.player.inventory[item] = (game.player.inventory[item] || 0) + amt;
    }
}

function _advanceTime(hours) {
    InnerMap.timeOfDay += hours;
    // Handle day rollover
    while (InnerMap.timeOfDay >= 24) {
        InnerMap.timeOfDay -= 24;
        if (typeof InnerMap.endDay === 'function') {
            InnerMap.endDay();
        }
    }
    // Reset accumulator so the next partial hour starts fresh
    InnerMap._timeAccumulator = 0;
}

function _applyEffects(game, effects) {
    if (!effects || !game.player.modifyNeed) return;
    for (const [need, amount] of Object.entries(effects)) {
        game.player.modifyNeed(need, amount);
    }
}

// ═══════════════════════════════════════════════════════════════
// MODAL STYLES (dark theme, consistent with game UI)
// ═══════════════════════════════════════════════════════════════

const MODAL_STYLE = `
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(13, 17, 23, 0.97);
    backdrop-filter: blur(12px);
    border: 2px solid var(--gold, #f5c542);
    border-radius: 10px;
    padding: 0; min-width: 360px; max-width: 480px; max-height: 80vh;
    z-index: 2000;
    box-shadow: 0 12px 48px rgba(0,0,0,0.85);
    display: flex; flex-direction: column;
    font-family: var(--font-body, 'Inter', sans-serif);
    color: #e6e1d6;
    overflow: hidden;
`;

const MODAL_HEADER_STYLE = `
    padding: 16px 20px 12px;
    border-bottom: 1px solid rgba(245,197,66,0.2);
    display: flex; align-items: center; gap: 10px;
`;

const MODAL_BODY_STYLE = `
    padding: 16px 20px;
    overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 12px;
`;

const MODAL_FOOTER_STYLE = `
    padding: 12px 20px 16px;
    border-top: 1px solid rgba(255,255,255,0.08);
    display: flex; justify-content: flex-end; gap: 8px;
`;

function _btn(label, primary = false, onclick = '') {
    const bg = primary
        ? 'background:var(--gold, #f5c542);color:#1a1a2e;font-weight:700;'
        : 'background:rgba(255,255,255,0.08);color:#ccc;';
    return `<button onclick="${onclick}" style="${bg}border:none;border-radius:6px;padding:8px 18px;cursor:pointer;font-size:13px;font-family:inherit;transition:filter .15s" onmouseenter="this.style.filter='brightness(1.15)'" onmouseleave="this.style.filter=''">${label}</button>`;
}

function _removeModal(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// ═══════════════════════════════════════════════════════════════
// MODAL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

function _showSleepModal(game, objDef) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    const currentHour = Math.floor(InnerMap.timeOfDay || 8);
    const maxHours = Math.max(1, 24 - currentHour);
    const suggestedHours = Math.min(8, maxHours);

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">🛏️</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Sleep</div>
                <div style="font-size:11px;color:#999">Rest to recover energy and health</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:13px;color:#aaa;white-space:nowrap">Hours:</span>
                <input type="range" id="sleepHoursRange" min="1" max="${maxHours}" value="${suggestedHours}" style="flex:1;accent-color:var(--gold,#f5c542)">
                <span id="sleepHoursLabel" style="font-size:18px;font-weight:700;color:var(--gold,#f5c542);min-width:32px;text-align:center">${suggestedHours}</span>
            </div>
            <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;font-size:12px;line-height:1.7">
                <div>⏰ Current time: <strong>${_formatHour(currentHour)}</strong></div>
                <div id="sleepWakeTime">🌅 Wake at: <strong>${_formatHour(currentHour + suggestedHours)}</strong></div>
                <div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px">
                    <div>💤 Energy restored: <span style="color:#5ddb6a" id="sleepEnergyPreview">+${_calcSleepEnergy(suggestedHours)}</span></div>
                    <div>❤️ Health restored: <span style="color:#e86a6a" id="sleepHealthPreview">+${_calcSleepHealth(suggestedHours)}</span></div>
                    <div>🛋️ Comfort: <span style="color:#6ab8db" id="sleepComfortPreview">+${_calcSleepComfort(suggestedHours)}</span></div>
                </div>
            </div>
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `document.getElementById('${id}').remove()`)}
            ${_btn('💤 Sleep', true, `window._execSleep()`)}
        </div>
    `;
    document.body.appendChild(modal);

    // Wire up slider
    const slider = document.getElementById('sleepHoursRange');
    slider.addEventListener('input', () => {
        const h = parseInt(slider.value);
        document.getElementById('sleepHoursLabel').textContent = h;
        document.getElementById('sleepWakeTime').innerHTML = `🌅 Wake at: <strong>${_formatHour(currentHour + h)}</strong>`;
        document.getElementById('sleepEnergyPreview').textContent = `+${_calcSleepEnergy(h)}`;
        document.getElementById('sleepHealthPreview').textContent = `+${_calcSleepHealth(h)}`;
        document.getElementById('sleepComfortPreview').textContent = `+${_calcSleepComfort(h)}`;
    });

    window._execSleep = () => {
        const hours = parseInt(document.getElementById('sleepHoursRange').value);
        _removeModal(id);
        _advanceTime(hours);
        if (game.player.modifyNeed) {
            game.player.modifyNeed('energy', _calcSleepEnergy(hours));
            game.player.modifyNeed('comfort', _calcSleepComfort(hours));
        }
        const hpGain = _calcSleepHealth(hours);
        if (hpGain > 0) {
            game.player.health = Math.min(game.player.maxHealth || 100, (game.player.health || 100) + hpGain);
        }
        game.ui.showNotification('💤 Slept', `You slept for ${hours} hours and feel refreshed.`, 'success');
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        delete window._execSleep;
    };
}

function _calcSleepEnergy(hours) { return Math.round(hours * 8 + 5); }
function _calcSleepHealth(hours) { return Math.round(hours * 2); }
function _calcSleepComfort(hours) { return Math.round(hours * 4 + 5); }

function _formatHour(h) {
    h = ((h % 24) + 24) % 24;
    if (h === 0) return '12:00 AM';
    if (h < 12) return `${h}:00 AM`;
    if (h === 12) return '12:00 PM';
    return `${h - 12}:00 PM`;
}

// ── Eat Modal ──
function _showEatModal(game, objDef) {
    _removeModal('objActionModal');
    const foods = _getPlayerFoods(game);
    if (!foods.length) { game.ui.showNotification('🍽️ No Food', 'You have nothing to eat.', 'error'); return; }

    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    let foodListHtml = foods.map((f, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;transition:background .15s"
             onmouseenter="this.style.background='rgba(245,197,66,0.1)'"
             onmouseleave="this.style.background='rgba(255,255,255,0.03)'"
             onclick="window._execEat('${f.id}')">
            <span style="font-size:22px">${f.icon}</span>
            <div style="flex:1">
                <div style="font-size:13px;font-weight:600">${f.label} <span style="color:#888;font-weight:400">×${f.qty}</span></div>
                <div style="font-size:11px;color:#888">🍖 +${f.hunger} hunger${f.energy ? ` · ⚡ +${f.energy} energy` : ''}${f.fun ? ` · 🎉 +${f.fun} fun` : ''}</div>
            </div>
        </div>
    `).join('');

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">🍽️</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Eat</div>
                <div style="font-size:11px;color:#999">Choose something to eat</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            ${foodListHtml}
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `document.getElementById('${id}').remove()`)}
        </div>
    `;
    document.body.appendChild(modal);

    window._execEat = (foodId) => {
        const def = FOOD_ITEMS[foodId];
        if (!def) return;
        const inv = game.player.inventory || {};
        if ((inv[foodId] || 0) <= 0) return;
        inv[foodId]--;
        if (inv[foodId] <= 0) delete inv[foodId];
        if (game.player.modifyNeed) {
            if (def.hunger) game.player.modifyNeed('hunger', def.hunger);
            if (def.energy) game.player.modifyNeed('energy', def.energy);
            if (def.fun) game.player.modifyNeed('fun', def.fun);
            if (def.social) game.player.modifyNeed('social', def.social);
            if (def.comfort) game.player.modifyNeed('comfort', def.comfort);
        }
        _removeModal(id);
        game.ui.showNotification(`${def.icon} Ate ${def.label}`, `Mmm, delicious! Hunger restored.`, 'success');
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        delete window._execEat;
    };
}

// ── Recipe Modal (shared for cook, craft, smelt, brew) ──
function _showRecipeModal(game, objDef, title, icon, recipes) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    let recipeHtml = recipes.map((r, i) => {
        const canMake = _canCraftRecipe(game, r);
        const opacity = canMake ? '1' : '0.4';
        const cursor = canMake ? 'cursor:pointer;' : 'cursor:not-allowed;';
        const ingredientStr = Object.entries(r.ingredients).map(([k, v]) => {
            const has = (game.player.inventory || {})[k] || 0;
            const color = has >= v ? '#5ddb6a' : '#e86a6a';
            return `<span style="color:${color}">${k.replace(/_/g, ' ')} ${has}/${v}</span>`;
        }).join(' · ');
        const resultStr = Object.entries(r.result).map(([k, v]) => `${v}× ${k.replace(/_/g, ' ')}`).join(', ');
        return `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;opacity:${opacity};${cursor}transition:background .15s"
                 ${canMake ? `onmouseenter="this.style.background='rgba(245,197,66,0.1)'" onmouseleave="this.style.background='rgba(255,255,255,0.03)'" onclick="window._execRecipe(${i})"` : ''}>
                <span style="font-size:22px">${r.icon}</span>
                <div style="flex:1">
                    <div style="font-size:13px;font-weight:600">${r.label}</div>
                    <div style="font-size:11px;color:#888">${r.desc}</div>
                    <div style="font-size:10px;margin-top:2px">Needs: ${ingredientStr}</div>
                    <div style="font-size:10px;color:#6ab8db">Yields: ${resultStr}</div>
                </div>
            </div>
        `;
    }).join('');

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">${icon}</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">${title}</div>
                <div style="font-size:11px;color:#999">Select a recipe to produce</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            ${recipeHtml || '<div style="color:#888;font-size:13px;text-align:center;padding:20px">No recipes available with your current materials.</div>'}
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `document.getElementById('${id}').remove()`)}
        </div>
    `;
    document.body.appendChild(modal);

    window._execRecipe = (idx) => {
        const recipe = recipes[idx];
        if (!recipe || !_canCraftRecipe(game, recipe)) return;
        _consumeIngredients(game, recipe.ingredients);
        _giveResults(game, recipe.result);
        _advanceTime(1);
        _removeModal(id);
        const resultStr = Object.entries(recipe.result).map(([k, v]) => `${v}× ${k.replace(/_/g, ' ')}`).join(', ');
        game.ui.showNotification(`${recipe.icon} ${recipe.label}`, `Produced ${resultStr}!`, 'success');
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        delete window._execRecipe;
    };
}

// ── Fish Modal ──
function _showFishModal(game, objDef) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">🎣</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Fishing</div>
                <div style="font-size:11px;color:#999">Cast your line and wait for a bite</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            <div style="text-align:center;padding:10px">
                <div id="fishStatus" style="font-size:15px;margin-bottom:12px">🌊 Casting your line...</div>
                <div style="width:100%;height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden">
                    <div id="fishBar" style="height:100%;width:0%;background:var(--gold,#f5c542);border-radius:4px;transition:width 0.3s"></div>
                </div>
                <div id="fishTimer" style="font-size:11px;color:#888;margin-top:6px">Waiting...</div>
            </div>
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `window._cancelFishing()`)}
        </div>
    `;
    document.body.appendChild(modal);

    const totalTime = 3000 + Math.random() * 4000; // 3-7 seconds
    const luck = (game.player.luck || 5) / 10;
    const startTime = Date.now();
    let cancelled = false;

    const fishStatuses = [
        '🌊 Casting your line...',
        '🎣 Waiting patiently...',
        '🐟 Something nibbles...',
        '🎯 A tug on the line!',
    ];

    const timer = setInterval(() => {
        if (cancelled) { clearInterval(timer); return; }
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / totalTime) * 100);
        const bar = document.getElementById('fishBar');
        const status = document.getElementById('fishStatus');
        const timerEl = document.getElementById('fishTimer');
        if (bar) bar.style.width = progress + '%';
        if (status) {
            const idx = Math.min(fishStatuses.length - 1, Math.floor(progress / 25));
            status.textContent = fishStatuses[idx];
        }
        if (timerEl) timerEl.textContent = `${Math.ceil((totalTime - elapsed) / 1000)}s remaining...`;

        if (elapsed >= totalTime) {
            clearInterval(timer);
            _removeModal(id);
            _advanceTime(1);

            // Determine catch
            const catchRoll = Math.random() + luck * 0.3;
            if (catchRoll > 0.35) {
                const catchAmount = 1 + Math.floor(Math.random() * 3);
                if (!game.player.inventory) game.player.inventory = {};
                game.player.inventory.fish = (game.player.inventory.fish || 0) + catchAmount;
                game.ui.showNotification('🐟 Caught!', `You caught ${catchAmount} fish!`, 'success');
                if (game.player.modifyNeed) {
                    game.player.modifyNeed('fun', 12);
                    game.player.modifyNeed('comfort', -3);
                }
            } else {
                game.ui.showNotification('🎣 Nothing', 'The fish got away this time.', 'info');
                if (game.player.modifyNeed) {
                    game.player.modifyNeed('fun', -5);
                }
            }
            game.ui.updateStats(game.player, game.world);
            Hotbar.refresh();
        }
    }, 100);

    window._cancelFishing = () => {
        cancelled = true;
        clearInterval(timer);
        _removeModal(id);
        delete window._cancelFishing;
    };
}

// ── Store Modal ──
function _showStoreModal(game, objDef, anchorQ, anchorR) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE + 'min-width:420px;max-width:520px;';

    // Get or create storage for this object
    const tile = InnerMap.getTile(anchorQ, anchorR);
    if (!tile || !tile.customObject) { game.ui.showNotification('📦 Error', 'Cannot access storage.', 'error'); return; }
    if (!tile.customObject._storage) tile.customObject._storage = {};
    const storage = tile.customObject._storage;
    const inv = game.player.inventory || {};

    function renderContent() {
        const playerItems = Object.entries(inv).filter(([, v]) => v > 0);
        const storedItems = Object.entries(storage).filter(([, v]) => v > 0);

        let html = `
            <div style="${MODAL_HEADER_STYLE}">
                <span style="font-size:28px">📦</span>
                <div>
                    <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Storage</div>
                    <div style="font-size:11px;color:#999">${objDef ? objDef.name : 'Container'}</div>
                </div>
            </div>
            <div style="${MODAL_BODY_STYLE}">
                <div style="display:flex;gap:12px;flex-wrap:wrap">
                    <div style="flex:1;min-width:180px">
                        <div style="font-size:12px;font-weight:600;color:var(--gold,#f5c542);margin-bottom:6px">📦 Stored Items</div>
                        ${storedItems.length ? storedItems.map(([k, v]) => `
                            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:3px;font-size:12px">
                                <span>${k.replace(/_/g, ' ')} ×${v}</span>
                                <button onclick="window._storageAction('take','${k}')" style="background:rgba(93,219,106,0.2);color:#5ddb6a;border:none;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px">Take</button>
                            </div>
                        `).join('') : '<div style="font-size:11px;color:#666;padding:8px">Empty</div>'}
                    </div>
                    <div style="flex:1;min-width:180px">
                        <div style="font-size:12px;font-weight:600;color:#6ab8db;margin-bottom:6px">🎒 Your Items</div>
                        ${playerItems.length ? playerItems.map(([k, v]) => `
                            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:3px;font-size:12px">
                                <span>${k.replace(/_/g, ' ')} ×${v}</span>
                                <button onclick="window._storageAction('store','${k}')" style="background:rgba(106,184,219,0.2);color:#6ab8db;border:none;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px">Store</button>
                            </div>
                        `).join('') : '<div style="font-size:11px;color:#666;padding:8px">No items</div>'}
                    </div>
                </div>
            </div>
            <div style="${MODAL_FOOTER_STYLE}">
                ${_btn('Close', false, `document.getElementById('${id}').remove()`)}
            </div>
        `;
        modal.innerHTML = html;
    }

    renderContent();
    document.body.appendChild(modal);

    window._storageAction = (action, itemId) => {
        if (action === 'store') {
            if ((inv[itemId] || 0) <= 0) return;
            inv[itemId]--;
            if (inv[itemId] <= 0) delete inv[itemId];
            storage[itemId] = (storage[itemId] || 0) + 1;
        } else if (action === 'take') {
            if ((storage[itemId] || 0) <= 0) return;
            storage[itemId]--;
            if (storage[itemId] <= 0) delete storage[itemId];
            if (!game.player.inventory) game.player.inventory = {};
            game.player.inventory[itemId] = (game.player.inventory[itemId] || 0) + 1;
        }
        renderContent();
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
    };
}

// ── Heal Modal ──
function _showHealModal(game, objDef) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    const inv = game.player.inventory || {};
    const healItems = Object.entries(HEAL_ITEMS)
        .filter(([itemId]) => (inv[itemId] || 0) > 0)
        .map(([itemId, def]) => ({ itemId, qty: inv[itemId], ...def }));

    const currentHp = game.player.health || 100;
    const maxHp = game.player.maxHealth || 100;

    let listHtml = healItems.map(h => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;transition:background .15s"
             onmouseenter="this.style.background='rgba(232,106,106,0.1)'"
             onmouseleave="this.style.background='rgba(255,255,255,0.03)'"
             onclick="window._execHeal('${h.itemId}')">
            <span style="font-size:22px">${h.icon}</span>
            <div style="flex:1">
                <div style="font-size:13px;font-weight:600">${h.label} <span style="color:#888;font-weight:400">×${h.qty}</span></div>
                <div style="font-size:11px;color:#888">❤️ +${h.heal} HP${h.energy ? ` · ⚡ +${h.energy} energy` : ''}</div>
            </div>
        </div>
    `).join('');

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">💊</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Heal</div>
                <div style="font-size:11px;color:#999">HP: ${currentHp}/${maxHp}</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            ${listHtml || '<div style="color:#888;font-size:13px;text-align:center;padding:20px">No healing items available.</div>'}
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `document.getElementById('${id}').remove()`)}
        </div>
    `;
    document.body.appendChild(modal);

    window._execHeal = (itemId) => {
        const def = HEAL_ITEMS[itemId];
        if (!def || (inv[itemId] || 0) <= 0) return;
        inv[itemId]--;
        if (inv[itemId] <= 0) delete inv[itemId];
        game.player.health = Math.min(maxHp, currentHp + def.heal);
        if (def.energy && game.player.modifyNeed) game.player.modifyNeed('energy', def.energy);
        _removeModal(id);
        game.ui.showNotification(`${def.icon} Healed`, `Restored ${def.heal} HP!`, 'success');
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        delete window._execHeal;
    };
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export const ObjectActions = {

    /** Get the action registry (for editor UI to enumerate) */
    getAll() { return OBJECT_ACTIONS; },

    /** Get a specific action definition */
    get(actionKey) { return OBJECT_ACTIONS[actionKey] || null; },

    /** Get actions available for an object def */
    getActionsForObject(objDef) {
        if (!objDef || !objDef.actions || !Array.isArray(objDef.actions)) return [];
        return objDef.actions
            .map(key => {
                const def = OBJECT_ACTIONS[key];
                if (!def) return null;
                return { key, ...def };
            })
            .filter(Boolean);
    },

    /**
     * Build context menu items for an object's actions.
     * Returns an array of menu item objects for innerMapUI.
     */
    buildMenuItems(game, objDef, objAnchorQ, objAnchorR) {
        const actions = this.getActionsForObject(objDef);
        if (!actions.length) return [];

        const items = [];
        for (const action of actions) {
            // Check condition
            let disabled = false;
            let disabledReason = '';
            if (action.condition && typeof action.condition === 'function') {
                if (!action.condition(game)) {
                    disabled = true;
                    disabledReason = action.conditionFail || 'Not available';
                }
            }

            if (disabled) {
                items.push({
                    type: 'disabled',
                    label: `${action.icon} ${action.label}`,
                    desc: disabledReason,
                });
            } else {
                items.push({
                    type: 'action',
                    action: `obj_action_${action.key}`,
                    label: action.label,
                    icon: action.icon,
                    desc: action.desc,
                    customObjDef: objDef,
                    objAnchorQ,
                    objAnchorR,
                    _objectActionKey: action.key,
                });
            }
        }
        return items;
    },

    /**
     * Execute an object action.
     * Called from the context menu handler.
     */
    execute(game, actionKey, objDef, anchorQ, anchorR) {
        const actionDef = OBJECT_ACTIONS[actionKey];
        if (!actionDef) {
            game.ui.showNotification('❓ Unknown', `Unknown action: ${actionKey}`, 'error');
            return;
        }

        // Check condition
        if (actionDef.condition && typeof actionDef.condition === 'function') {
            if (!actionDef.condition(game)) {
                game.ui.showNotification(`${actionDef.icon} ${actionDef.label}`, actionDef.conditionFail || 'Not available right now.', 'error');
                return;
            }
        }

        // Modal actions
        if (actionDef.modal) {
            switch (actionDef.modal) {
                case 'sleep': _showSleepModal(game, objDef); return;
                case 'eat':   _showEatModal(game, objDef); return;
                case 'cook':  _showRecipeModal(game, objDef, 'Cook', '🍳', COOK_RECIPES); return;
                case 'craft': _showRecipeModal(game, objDef, 'Craft', '🔨', CRAFT_RECIPES); return;
                case 'smelt': _showRecipeModal(game, objDef, 'Smelt', '⚒️', SMELT_RECIPES); return;
                case 'brew':  _showRecipeModal(game, objDef, 'Brew Potion', '🧪', BREW_RECIPES); return;
                case 'fish':  _showFishModal(game, objDef); return;
                case 'store': _showStoreModal(game, objDef, anchorQ, anchorR); return;
                case 'heal':  _showHealModal(game, objDef); return;
            }
        }

        // Instant actions — apply effects, run callback, show message
        let message = actionDef.message;

        // Run custom onExecute if present
        if (actionDef.onExecute && typeof actionDef.onExecute === 'function') {
            const result = actionDef.onExecute(game);
            if (result) message = result;
        }

        // Apply need effects
        if (actionDef.effects) {
            _applyEffects(game, actionDef.effects);
        }

        // Apply gold cost
        if (actionDef.cost) {
            game.player.gold -= actionDef.cost;
        }

        // Advance time
        if (actionDef.timeSkip) {
            _advanceTime(actionDef.timeSkip);
        }

        // Show notification
        if (message) {
            game.ui.showNotification(`${actionDef.icon} ${actionDef.label}`, message, 'success');
        }

        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
    },
};
