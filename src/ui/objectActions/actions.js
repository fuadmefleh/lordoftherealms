// OBJECT_ACTIONS registry — action defs with condition/onExecute handlers.
import { InnerMap } from '../../world/innerMap.js';
import { Hotbar } from '../hotbar.js';
import { PlayerInventory } from '../../player/inventory.js';
import { FOOD_ITEMS, COOK_RECIPES, CRAFT_RECIPES, SMELT_RECIPES, BREW_RECIPES, HEAL_ITEMS, MODAL_STYLE, MODAL_HEADER_STYLE, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from './data.js';
import {
    _getPlayerFoods,
    _getCookableItems,
    _canCraftRecipe,
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
        onExecute: (game) => {
            // Each topic trains a skill the game actually checks (all capped at 10).
            const topics = [
                { text: 'You read about ancient battle tactics.', skill: 'leadership', xp: 0.2 },
                { text: 'You study a treatise on trade routes.', skill: 'commerce', xp: 0.2 },
                { text: 'You read thrilling tales of adventure.', skill: null, xp: 0 },
                { text: 'You read a chronicle of duels and sieges.', skill: 'combat', xp: 0.2 },
                { text: 'You read the letters of a famous envoy.', skill: 'diplomacy', xp: 0.2 },
                { text: "You find a primer on thieves' cant tucked between the pages.", skill: 'stealth', xp: 0.2 },
                { text: 'You read poetry and feel inspired.', skill: null, xp: 0 },
                { text: 'You study a map and learn about nearby regions.', skill: 'cartography', xp: 0.2 },
            ];
            const topic = topics[Math.floor(Math.random() * topics.length)];
            if (topic.skill && topic.xp && game.player.skills) {
                const before = game.player.skills[topic.skill] || 0;
                game.player.skills[topic.skill] = Math.min(10, Math.round((before + topic.xp) * 100) / 100);
                if (game.player.skills[topic.skill] > before) {
                    const name = topic.skill.charAt(0).toUpperCase() + topic.skill.slice(1);
                    return `${topic.text} (${name} +${topic.xp})`;
                }
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
            if (!PlayerInventory.addItem(game.player, 'leather_armor', 1).success) {
                // No room for the armor — keep the hides rather than destroy them
                game.player.inventory.leather += 2;
                return `You set the hides aside untouched. ${PlayerInventory.fullMessage(game.player)}`;
            }
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
        icon: '🧺',
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
};
