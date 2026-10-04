// Object-action data tables (pure data).
import { InnerMap } from '../../world/innerMap.js';
import { Hotbar } from '../hotbar.js';

export const FOOD_ITEMS = {
    bread:       { label: 'Bread',        icon: '🍞', hunger: 25, energy: 5 },
    grain:       { label: 'Grain',         icon: '🌾', hunger: 15, energy: 3 },
    fruit:       { label: 'Fruit',         icon: '🍎', hunger: 20, energy: 8, fun: 3 },
    berries:     { label: 'Berries',       icon: '🍇', hunger: 12, energy: 5, fun: 2 },
    mushrooms:   { label: 'Mushrooms',     icon: '🍄', hunger: 15, energy: 3 },
    fish:        { label: 'Fish',          icon: '🐟', hunger: 20, energy: 5 },
    cooked_fish: { label: 'Cooked Fish',   icon: '🍣', hunger: 30, energy: 8, comfort: 4 },
    cooked_meat: { label: 'Cooked Meat',   icon: '🍖', hunger: 40, energy: 12, comfort: 5 },
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

export const COOK_RECIPES = [
    { id: 'cooked_meal', label: 'Cooked Meal', icon: '🍲', ingredients: { grain: 1, dried_meat: 1 }, result: { cooked_meal: 1 }, desc: 'A hearty meal' },
    { id: 'cooked_fish', label: 'Grilled Fish', icon: '🐟', ingredients: { fish: 1 }, result: { cooked_meal: 1 }, desc: 'Freshly grilled fish' },
    { id: 'fruit_salad', label: 'Fruit Salad', icon: '🥗', ingredients: { fruit: 2 }, result: { cooked_meal: 1 }, desc: 'A refreshing fruit salad' },
    { id: 'mushroom_stew', label: 'Mushroom Stew', icon: '🍲', ingredients: { mushrooms: 2, herbs: 1 }, result: { cooked_meal: 2 }, desc: 'A rich mushroom stew' },
    { id: 'herbal_tea', label: 'Herbal Tea', icon: '🍵', ingredients: { herbs: 1 }, result: { tea: 2 }, desc: 'Soothing herbal tea' },
    { id: 'bread_bake', label: 'Bake Bread', icon: '🍞', ingredients: { grain: 2 }, result: { bread: 2 }, desc: 'Fresh-baked bread' },
    { id: 'spiced_wine', label: 'Spiced Wine', icon: '🍷', ingredients: { wine: 1, exotic_spices: 1 }, result: { wine: 2 }, desc: 'Rich spiced wine' },
    { id: 'honey_cake', label: 'Honey Cake', icon: '🍰', ingredients: { grain: 1, honey: 1 }, result: { cooked_meal: 2 }, desc: 'Sweet honey cakes' },
];

export const CRAFT_RECIPES = [
    { id: 'weapons_forge', label: 'Forge Weapons', icon: '⚔️', ingredients: { iron_ingot: 1, wood: 1 }, result: { weapons: 2 }, desc: 'Ingot-forged blades, fit for an army' },
    { id: 'tools_forge', label: 'Forge Tools', icon: '🔧', ingredients: { iron_ingot: 1 }, result: { tools: 3 }, desc: 'Hammers, saws and ploughshares' },
    { id: 'ring_craft', label: 'Gold Ring', icon: '💍', ingredients: { gold_bar: 1, gems: 1 }, result: { luxuries: 3 }, desc: 'Fine jewellery for the luxury trade' },
    { id: 'arrows_craft', label: 'Arrows (×10)', icon: '🏹', ingredients: { wood: 2, iron: 1 }, result: { arrows: 10 }, desc: 'A bundle of iron-tipped arrows' },
    { id: 'shield_craft', label: 'Wooden Shield', icon: '🛡️', ingredients: { wood: 5, iron: 2 }, result: { shield: 1 }, desc: 'A sturdy wooden shield' },
    { id: 'bow_craft', label: 'Hunting Bow', icon: '🏹', ingredients: { wood: 4 }, result: { bow: 1 }, desc: 'A simple hunting bow' },
    { id: 'leather_armor_craft', label: 'Leather Armor', icon: '🦺', ingredients: { leather: 5, iron: 1 }, result: { leather_armor: 1 }, desc: 'Light protective armor' },
    { id: 'rope_craft', label: 'Rope', icon: '🧶', ingredients: { herbs: 3 }, result: { rope: 2 }, desc: 'Strong hemp rope' },
    { id: 'candles_craft', label: 'Candles', icon: '🕯️', ingredients: { honey: 1 }, result: { candles: 3 }, desc: 'Beeswax candles' },
    { id: 'pottery_craft', label: 'Pottery', icon: '🏺', ingredients: { clay: 3 }, result: { pottery: 1 }, desc: 'A decorative pot' },
    { id: 'lantern_craft', label: 'Lantern', icon: '🏮', ingredients: { iron: 2, candles: 1 }, result: { lantern: 1 }, desc: 'An iron lantern' },
    { id: 'healing_salve_craft', label: 'Healing Salve', icon: '🩹', ingredients: { herbs: 3, honey: 1 }, result: { healing_salve: 1 }, desc: 'Soothes wounds and speeds recovery' },
    { id: 'amulet_craft', label: 'Amulet', icon: '🔮', ingredients: { gems: 1, iron: 1 }, result: { amulet: 1 }, desc: 'A mystical protective amulet' },
    { id: 'dyes_craft', label: 'Dyes', icon: '🎨', ingredients: { flowers: 3 }, result: { dyes: 2 }, desc: 'Vibrant fabric dyes' },
    { id: 'incense_craft', label: 'Incense', icon: '🪔', ingredients: { herbs: 2, resin: 1 }, result: { incense: 2 }, desc: 'Fragrant incense sticks' },
];

export const SMELT_RECIPES = [
    { id: 'iron_ingot', label: 'Iron Ingot', icon: '🔩', ingredients: { iron: 3 }, result: { iron_ingot: 1 }, desc: 'A refined iron ingot' },
    { id: 'gold_bar', label: 'Gold Bar', icon: '🥇', ingredients: { gold_ore: 3 }, result: { gold_bar: 1 }, desc: 'A gleaming gold bar' },
    { id: 'coal_iron_ingot', label: 'Iron Ingot (coal-fired)', icon: '⚫', ingredients: { iron: 2, coal: 1 }, result: { iron_ingot: 1 }, desc: 'Coal burns hotter: an ingot from less iron' },
];

export const BREW_RECIPES = [
    { id: 'healing_potion', label: 'Healing Potion', icon: '❤️', ingredients: { herbs: 2 }, result: { potion: 1 }, desc: 'Restores health when consumed' },
    { id: 'energy_elixir', label: 'Energy Elixir', icon: '⚡', ingredients: { herbs: 3, honey: 1 }, result: { elixir: 1 }, desc: 'A burst of energy' },
    { id: 'antidote', label: 'Antidote', icon: '🟢', ingredients: { herbs: 2, mushrooms: 1 }, result: { potion: 1 }, desc: 'Cures poisons and ailments' },
];

export const HEAL_ITEMS = {
    herbs:         { label: 'Herbs',         icon: '🌿', heal: 10, cost: 1 },
    healing_salve: { label: 'Healing Salve', icon: '🩹', heal: 30, cost: 1 },
    potion:        { label: 'Healing Potion', icon: '❤️', heal: 50, cost: 1 },
    elixir:        { label: 'Elixir',         icon: '⚡', heal: 40, cost: 1, energy: 30 },
};

export const MODAL_STYLE = `
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

export const MODAL_HEADER_STYLE = `
    padding: 16px 20px 12px;
    border-bottom: 1px solid rgba(245,197,66,0.2);
    display: flex; align-items: center; gap: 10px;
`;

export const MODAL_BODY_STYLE = `
    padding: 16px 20px;
    overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 12px;
`;

export const MODAL_FOOTER_STYLE = `
    padding: 12px 20px 16px;
    border-top: 1px solid rgba(255,255,255,0.08);
    display: flex; justify-content: flex-end; gap: 8px;
`;

// ──────────── INTERIOR FURNITURE ────────────
// What the player can *do* with each furniture type found inside buildings.
// Values are OBJECT_ACTIONS keys. A building-type entry replaces the default
// list for that furniture type (e.g. a tavern bed is rented, not slept in free).
export const FURNITURE_ACTIONS = {
    table:     ['sit', 'eat', 'play_game'],
    bookshelf: ['read'],
    chest:     ['store'],
    bar:       ['drink'],
    barrel:    ['drink'],
    fireplace: ['warm', 'cook'],
    bed:       ['sleep'],
    rack:      ['shop'],
    anvil:     ['craft'],
    forge:     ['smelt'],
    stall:     ['shop'],
    scales:    ['shop'],
    altar:     ['pray', 'give_alms'],
    pew:       ['sit', 'meditate'],
    statue:    ['pray'],
    well:      ['draw_water', 'wash'],
    bucket:    ['wash'],
};

export const BUILDING_FURNITURE_ACTIONS = {
    tavern: {
        bar:   ['drink', 'tavern_services', 'gamble'],
        table: ['sit', 'eat', 'gamble'],
        bed:   ['rent_room'],
    },
    town_hall: {
        table:  ['notices', 'find_work', 'tribute'],
        throne: ['audience', 'find_work'],
    },
    manor: {
        throne: ['audience'],
        table:  ['sit', 'eat'],
    },
    stable: {
        stall:  ['horse_trade'],
        barrel: ['wash'],
    },
    guard_tower: {
        table: ['settle_record', 'notices'],
        rack:  ['drill'],
    },
    church: { altar: ['pray', 'give_alms', 'blessing'] },
    barracks: {
        rack:  ['hire_troops', 'drill'],
        table: ['sit', 'notices'],
    },
    marketplace: { crate: ['shop'] },
    granary:     { crate: ['shop'] },
    warehouse:   { crate: ['store'], chest: ['store'] },
    blacksmith:  { anvil: ['craft', 'hone_arms', 'shop'], rack: ['hone_arms', 'shop'] },
    temple:      { altar: ['pray', 'give_alms', 'blessing'], statue: ['pray', 'blessing'], chest: ['give_alms'] },
};

/**
 * Furniture that belongs to whoever lives there — usable only in buildings the
 * player owns, unless the building's own entry above says otherwise.
 */
export const PRIVATE_FURNITURE = new Set(['bed', 'chest']);

/** Name patterns for recognising editor-placed furniture (shared with interior NPCs). */
export const FURNITURE_NAME_PATTERNS = InnerMap.FURNITURE_NAME_PATTERNS;
