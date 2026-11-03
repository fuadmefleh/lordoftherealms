// OBJECT_ACTIONS registry — action defs with condition/onExecute handlers.
import { InnerMap } from '../../world/innerMap.js';
import { Hotbar } from '../hotbar.js';
import { PlayerInventory } from '../../player/inventory.js';
import { FOOD_ITEMS, HEAL_ITEMS, MODAL_STYLE, MODAL_HEADER_STYLE, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from './data.js';
import {
    _getPlayerFoods,
    _getCookableItems,
    _canCraftRecipe,
    _canWorkStation,
    _consumeIngredients,
    _giveResults,
    _advanceTime,
    _applyEffects,
    _btn,
    _removeModal,
    _showSleepModal,
    _calcSleepEnergy,
    _calcSleepHealth,
    _calcSleepComfort,
    _formatHour,
    _showEatModal,
    _showRecipeModal,
    _showFishModal,
    _showStoreModal,
    _showHealModal,
    _settlementTile,
} from './logic.js';
import { Devotion } from '../../systems/devotion.js';
import { Books } from '../../systems/books.js';
import { DevotionPanel } from '../actionMenu/devotion.js';
import { PlayerActions } from '../../player/playerActions.js';

/** Building types whose altar is a temple's (place 'temple' for devotion; a temple's shelf holds rare books). */
const TEMPLE_BUILDINGS = ['temple', 'church', 'cathedral', 'monastery', 'shrine', 'chapel'];

/**
 * Pray at an altar or meditate on a pew through the devotion model. Returns
 * the notification text; an omen, an offered vow or trouble at the shrine
 * open the devotion result panel instead.
 */
function _furnitureDevotion(game, kind) {
    const tile = _settlementTile(game) || (game.world && game.world.getTile ? game.world.getTile(game.player.q, game.player.r) : null);
    const inside = InnerMap._insideBuilding;
    const place = tile && tile.holySite ? 'holy' : (inside && TEMPLE_BUILDINGS.includes(inside.type)) ? 'temple' : 'altar';
    const res = Devotion.devote(game.player, game.world, { kind, place, tile });
    if (res.omen || res.vowOffers.length || res.fine || res.harm) {
        DevotionPanel.showResult(game, tile, res, { kind });
    }
    const bits = [];
    if (res.heal) bits.push(`+${res.heal} HP`);
    bits.push(res.karma ? `+${res.karma} karma` : 'no karma (enough for today)');
    if (res.faith) bits.push(`faith +${res.faith}`);
    if (res.intelligence) bits.push(`intelligence +${res.intelligence}`);
    const lead = kind === 'meditate' ? 'You meditate in silence.' : 'You offer a prayer.';
    return `${lead} ${bits.join(', ')}. ${res.notes[0] || ''}`.trim();
}

/** Whether the town the player stands in offers a world action (no guild, no mint, no counter to serve you). */
function _townOffers(game, type) {
    const tile = _settlementTile(game);
    if (!tile) return false;
    return (PlayerActions.getAvailableActions(game.player, tile, game.world) || []).some(a => a.type === type);
}

export const OBJECT_ACTIONS = {
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
        // Real books (systems/books.js, data/books.json): the open book, or one
        // the shelf holds; a few sittings each, the reward once on finishing
        onExecute: (game, objDef, anchorQ, anchorR) => {
            const tile = _settlementTile(game);
            const inside = InnerMap._insideBuilding;
            const r = Books.read(game.player, game.world, {
                shelfKey: `${tile ? `${tile.q},${tile.r}` : 'wilds'}:${inside ? inside.type : 'out'}:${anchorQ},${anchorR}`,
                settlementType: tile && tile.settlement ? tile.settlement.type : null,
                temple: !!(inside && TEMPLE_BUILDINGS.includes(inside.type)),
            });
            return r.text;
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
        // The devotion model (systems/devotion.js): faith, place, diminishing returns
        onExecute: (game) => _furnitureDevotion(game, 'pray'),
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
        onExecute: (game) => _furnitureDevotion(game, 'meditate'),
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
        condition: (game) => _canWorkStation(game, 'smelt'),
        conditionFail: 'You need ore to smelt (3 iron, 3 gold ore, 2 copper…).',
    },
    brew: {
        label: 'Brew Potion',
        icon: '🧪',
        desc: 'Brew healing potions from herbs',
        category: 'production',
        modal: 'brew',
        condition: (game) => _canWorkStation(game, 'brew'),
        conditionFail: 'You need at least 2 herbs to brew.',
    },
    tan: {
        label: 'Tan & Weave',
        icon: '🟫',
        desc: 'Tan hides into leather, weave flax and wool into cloth',
        category: 'production',
        modal: 'tan',
        condition: (game) => _canWorkStation(game, 'tan'),
        conditionFail: 'You need hides and salt, flax or wool.',
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
        icon: '🧺',
        desc: 'Draw water from the well',
        category: 'gathering',
        modal: null,
        effects: { hygiene: 10 },
        message: 'You draw fresh water from the well.',
        timeSkip: 0,
    },
    // ──────────── STORAGE ────────────
    look_inside: {
        label: 'Look Inside',
        icon: '🔍',
        desc: 'See what it holds, and take (or steal) it',
        category: 'storage',
        modal: 'contents',
    },
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

    // ──────────── LODGING ────────────
    rent_room: {
        label: 'Rent a Room',
        icon: '🛏️',
        desc: 'Pay the innkeeper for a bed (5 gold)',
        category: 'rest',
        modal: 'sleep',
        sleepCost: 5,
        condition: (game) => game.player.gold >= 5,
        conditionFail: "You can't afford a room (5 gold).",
    },
    // A guest house's, inn's, hotel's or roadhouse's furniture opens its rooms
    // and services (ui/actionMenu/lodging.js — the house is the one you're in)
    take_room: {
        label: 'Take a Room',
        icon: '🛏️',
        desc: 'A bunk, a room or a suite for the night',
        category: 'rest',
        panel: 'showLodgings',
    },
    lodging_desk: {
        label: 'Ask at the Desk',
        icon: '🛎️',
        desc: 'Rooms, meals, baths, laundry — and their prices',
        category: 'service',
        panel: 'showLodgings',
    },
    dine_here: {
        label: 'Order a Meal',
        icon: '🍲',
        desc: 'Supper, breakfast or the grand hall',
        category: 'service',
        panel: 'showLodgings',
    },
    bathe_here: {
        label: 'Bathe',
        icon: '🛁',
        desc: 'A hot bath, the laundry or the bathhouse',
        category: 'service',
        panel: 'showLodgings',
    },
    // ──────────── SETTLEMENT SERVICES ────────────
    // Furniture inside town buildings opens the same services as the world
    // action menu, run against the settlement the player is visiting.
    shop: {
        label: 'Browse Wares',
        icon: '🛒',
        desc: 'Buy and sell goods',
        category: 'service',
        service: 'trade',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    tavern_services: {
        label: 'Order & Hear Rumors',
        icon: '🍻',
        desc: "Talk to the barkeep about food, drink, and the local news",
        category: 'service',
        service: 'tavern',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    gamble: {
        label: 'Gamble',
        icon: '🎲',
        desc: 'Try your luck at dice and cards',
        category: 'service',
        service: 'gambling',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    notices: {
        label: 'Read Notices',
        icon: '📜',
        desc: 'Check the posted bounties',
        category: 'service',
        service: 'bounty_board',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    find_work: {
        label: 'Ask for Work',
        icon: '🧰',
        desc: 'Take on odd jobs for coin',
        category: 'service',
        service: 'odd_jobs',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    hire_troops: {
        label: 'Hire Troops',
        icon: '⚔️',
        desc: 'Recruit soldiers for your army',
        category: 'service',
        service: 'recruit',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    drill: {
        label: 'Train',
        icon: '🗡️',
        desc: 'Drill with the garrison to sharpen your combat skill',
        category: 'service',
        service: 'train_combat',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    // Building service panels (ui/actionMenu/services.js)
    hone_arms: {
        label: 'Hone Arms',
        icon: '⚔️',
        desc: "Have the smith sharpen your army's weapons",
        category: 'service',
        panel: 'showBlacksmithMenu',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    blessing: {
        label: 'Seek Blessing',
        icon: '✨',
        desc: 'Ask the priest to bless your journey',
        category: 'service',
        panel: 'showBlessingMenu',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    horse_trade: {
        label: 'Horse Trading',
        icon: '🐴',
        desc: 'Buy a riding horse or sell yours',
        category: 'service',
        panel: 'showStableMenu',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    physician: {
        label: 'Infirmary',
        icon: '⚕️',
        desc: 'Have your wounds and sickness treated',
        category: 'service',
        panel: 'showPhysicianMenu',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    settle_record: {
        label: 'Settle Your Record',
        icon: '🗂️',
        desc: 'Pay off fines for past crimes',
        category: 'service',
        panel: 'showGuardMenu',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    tribute: {
        label: 'Pay Tribute',
        icon: '💰',
        desc: 'Buy standing with the crown',
        category: 'service',
        panel: 'showTributeMenu',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    audience: {
        label: 'Seek Audience',
        icon: '🏛️',
        desc: "Petition the lord's court",
        category: 'service',
        panel: 'showAudienceMenu',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    give_alms: {
        label: 'Donate',
        icon: '💰',
        desc: 'Give gold to the faithful and the poor',
        category: 'service',
        service: 'donate',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
    // ──────────── THE TOWN'S TRADES AND OFFICES ────────────
    public_bath: {
        label: 'Hot Bath (2g)',
        icon: '🛁',
        desc: "An hour in the bathhouse's hot water",
        category: 'hygiene',
        effects: { hygiene: 60, comfort: 15, energy: 5 },
        cost: 2,
        message: 'You soak in the hot water until your fingers wrinkle.',
        timeSkip: 1,
        condition: (game) => (game.player.gold || 0) >= 2,
        conditionFail: 'A bath is 2 gold.',
    },
    guild_business: {
        label: 'Guild Business',
        icon: '⚒️',
        desc: 'Join, rise, contracts, loans and elections',
        category: 'service',
        service: 'guildhall',
        condition: (game) => _townOffers(game, 'guildhall'),
        conditionFail: 'No guild keeps its books here.',
    },
    banking: {
        label: 'Banking',
        icon: '🏦',
        desc: 'Deposits, loans, bonds and bills',
        category: 'service',
        service: 'bank',
        condition: (game) => _townOffers(game, 'bank'),
        conditionFail: 'No banking house keeps a desk in this town.',
    },
    post_letters: {
        label: 'Letters & Post',
        icon: '📮',
        desc: 'Send a letter; the courier houses',
        category: 'service',
        service: 'post_house',
        condition: (game) => _townOffers(game, 'post_house'),
        conditionFail: 'No courier keeps a station here.',
    },
    mint_business: {
        label: 'The Mint',
        icon: '💰',
        desc: 'Sell bullion; the coin of every realm',
        category: 'service',
        service: 'mint',
        condition: (game) => _townOffers(game, 'mint'),
        conditionFail: 'The mint is not striking for strangers.',
    },
    study_maps: {
        label: 'Maps & Charts',
        icon: '🗺️',
        desc: 'Study, buy and draw maps',
        category: 'service',
        service: 'cartography',
        condition: (game) => !!_settlementTile(game),
        conditionFail: 'Only available in a settlement.',
    },
};
