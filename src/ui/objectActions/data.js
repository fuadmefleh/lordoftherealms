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
    // From your own hens and milkers (systems/livestock.js)
    eggs:        { label: 'Eggs',          icon: '🥚', hunger: 8, energy: 4 },
    milk:        { label: 'Milk',          icon: '🥛', hunger: 6, energy: 6, comfort: 3 },
    herbs:       { label: 'Herbs',         icon: '🌿', hunger: 5, energy: 3 },
    cooked_meal: { label: 'Cooked Meal',   icon: '🍲', hunger: 45, energy: 15, fun: 10, comfort: 8 },
    wine:        { label: 'Wine',          icon: '🍷', hunger: 5, fun: 15, social: 10, energy: -8 },
    tea:         { label: 'Tea',           icon: '🍵', hunger: 5, energy: 12, comfort: 10 },
    salt:        { label: 'Salt',          icon: '🧂', hunger: 3 },
    exotic_spices: { label: 'Exotic Spices', icon: '🌶️', hunger: 5, fun: 5 },
    // (made goods: their grade scales what they give — core/grades.js, Crafting.consume)
    meat_pie:    { label: 'Meat Pie',      icon: '🥧', hunger: 35, energy: 10, comfort: 6 },
    honey_cake:  { label: 'Honey Cake',    icon: '🍰', hunger: 18, energy: 12, fun: 8 },
    sausage:     { label: 'Sausage',       icon: '🌭', hunger: 26, energy: 8 },
    jam:         { label: 'Fruit Preserve', icon: '🍓', hunger: 12, energy: 10, fun: 6 },
    pickles:     { label: 'Pickles',       icon: '🥒', hunger: 14, energy: 4 },
    vegetables:  { label: 'Vegetables',    icon: '🥬', hunger: 14, energy: 4 },
    // From the water's floor (player/diving.js)
    mussels:     { label: 'Mussels',       icon: '🐚', hunger: 10, energy: 3 },
    oysters:     { label: 'Oysters',       icon: '🐚', hunger: 10, energy: 3, fun: 3 },
    crayfish:    { label: 'Crayfish',      icon: '🦐', hunger: 10, energy: 3 },
    beer:        { label: 'Ale',           icon: '🍺', hunger: 6, fun: 10, social: 8, energy: -5 },
    mead:        { label: 'Mead',          icon: '🍶', hunger: 6, fun: 14, social: 10, energy: -5 },
    cider:       { label: 'Cider',         icon: '🍏', hunger: 5, fun: 10, social: 8, energy: -4 },
};

// Recipes live in data/crafting.json (player/crafting.js: Crafting.recipes(station)).

export const HEAL_ITEMS = {
    herbs:         { label: 'Herbs',         icon: '🌿', heal: 10, cost: 1 },
    healing_salve: { label: 'Healing Salve', icon: '💊', heal: 30, cost: 1 },
    potion:        { label: 'Healing Potion', icon: '❤️', heal: 50, cost: 1 },
    elixir:        { label: 'Elixir',         icon: '⚡', heal: 40, cost: 1, energy: 30 },
    poultice:      { label: 'Poultice',       icon: '💊', heal: 18, cost: 1 },
    tonic:         { label: 'Herbal Tonic',   icon: '🍶', heal: 25, cost: 1, energy: 20 },
};

export const MODAL_STYLE = `
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(13, 17, 23, 0.97);
    backdrop-filter: blur(12px);
    border: 2px solid var(--gold, #f5c542);
    border-radius: 10px;
    padding: 0; min-width: 360px; max-width: 480px; max-height: calc(80vh / var(--ui-zoom));
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
    anvil:     ['craft', 'forge_arms'],
    forge:     ['smelt'],
    stall:     ['shop'],
    scales:    ['shop'],
    altar:     ['pray', 'give_alms'],
    pew:       ['attend_service', 'sit', 'meditate'],
    statue:    ['pray'],
    well:      ['draw_water', 'wash'],
    bucket:    ['wash'],
    desk:      ['sit', 'read'],
    shelf:     ['shop'],
    cauldron:  ['cook'],
    tub:       ['wash'],
    oven:      ['cook'],
    lectern:   ['read'],
};

export const BUILDING_FURNITURE_ACTIONS = {
    tavern: {
        bar:   ['drink', 'tavern_services', 'gamble'],
        table: ['listen_bard', 'sit', 'eat', 'gamble'],
        bed:   ['rent_room'],
    },
    // Houses of hospitality (systems/hospitality.js): the beds are let, not slept in free
    guest_house: { bed: ['take_room'], bar: ['lodging_desk'], table: ['sit', 'dine_here'], bucket: ['bathe_here'], fireplace: ['warm'] },
    inn:         { bed: ['take_room'], bar: ['lodging_desk', 'drink'], table: ['listen_bard', 'sit', 'dine_here'], bucket: ['bathe_here'], fireplace: ['warm'] },
    hotel:       { bed: ['take_room'], bar: ['lodging_desk'], table: ['sit', 'dine_here'], bucket: ['bathe_here'], fireplace: ['warm'] },
    roadhouse:   { bed: ['take_room'], bar: ['lodging_desk', 'drink'], table: ['listen_bard', 'sit', 'dine_here'], barrel: ['drink'], fireplace: ['warm'] },
    town_hall: {
        table:  ['notices', 'find_work', 'tribute'],
        throne: ['audience', 'find_work'],
    },
    manor: {
        throne: ['audience'],
        table:  ['sit', 'eat'],
    },
    stable: {
        stall:  ['horse_trade', 'tan'],
        barrel: ['wash'],
    },
    guard_tower: {
        table: ['settle_record', 'notices'],
        rack:  ['drill'],
    },
    church: { altar: ['pray', 'give_alms', 'blessing', 'physician'] },
    barracks: {
        rack:  ['hire_troops', 'drill'],
        table: ['sit', 'notices'],
    },
    marketplace: { crate: ['shop'], stall: ['shop', 'furniture_maker'] },
    granary:     { crate: ['shop'] },
    warehouse:   { crate: ['store'], chest: ['store'] },
    blacksmith:  { anvil: ['craft', 'forge_arms', 'hone_arms', 'shop'], rack: ['hone_arms', 'shop'] },
    temple:      { altar: ['pray', 'give_alms', 'blessing', 'physician'], statue: ['pray', 'blessing'], chest: ['give_alms'] },
    // The town's trades and offices: their counters open the town's panels
    guildhall:   { table: ['guild_business', 'find_work'], desk: ['guild_business'], throne: ['guild_business'], chest: ['guild_business'], rack: ['guild_business'] },
    bank:        { bar: ['banking'], desk: ['banking'], chest: ['banking'], scales: ['banking'], bookshelf: ['banking'] },
    post_house:  { bar: ['post_letters'], desk: ['post_letters'], shelf: ['post_letters'], sack: ['post_letters'] },
    apothecary:  { bar: ['physician', 'shop'], shelf: ['shop'], cauldron: ['physician'], bed: ['physician'] },
    bathhouse:   { tub: ['public_bath'], bar: ['public_bath'], bucket: ['wash'], pew: ['sit'], fireplace: ['warm'] },
    library:     { bookshelf: ['read'], lectern: ['read'], desk: ['study_maps', 'read'] },
    bakery:      { oven: ['shop'], bar: ['shop'], shelf: ['shop'], table: ['shop', 'eat'] },
    mill:        { millstone: ['find_work'], sack: ['shop'], scales: ['shop'] },
    jail:        { table: ['settle_record', 'notices'], desk: ['settle_record', 'notices'], cell: ['settle_record'] },
    mint:        { press: ['mint_business'], chest: ['mint_business'], scales: ['mint_business'], desk: ['mint_business'], forge: ['mint_business'] },
    chapel:      { altar: ['pray', 'give_alms', 'blessing'], statue: ['pray'] },
};

/**
 * Furniture that belongs to whoever lives there — usable only in buildings the
 * player owns, unless the building's own entry above says otherwise.
 */
export const PRIVATE_FURNITURE = new Set(['bed', 'chest']);

/** Name patterns for recognising editor-placed furniture (shared with interior NPCs). */
export const FURNITURE_NAME_PATTERNS = InnerMap.FURNITURE_NAME_PATTERNS;
