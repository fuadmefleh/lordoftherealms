// npcDialog — helpers functions.
import { InnerMap } from '../../world/innerMap.js';
import { ActionMenu } from '../actionMenu.js';
import { NpcFamily } from '../../systems/npcFamily.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { GREETINGS, RETURNING_GREETINGS, RESPECTFUL_GREETINGS, HOSTILE_GREETINGS, RUMORS, FAREWELLS, THREAT_RESPONSES, THREAT_SUCCESS, FLATTER_RESPONSES, FLATTER_SUCCESS, TIME_COMMENTS, WEATHER_COMMENTS, NPC_QUEST_HOOKS, LOCATION_INFO, KINGDOM_INFO } from '../npcDialog.data.js';
import { dialogState } from './shared.js';
import { _buildConversation, _render, _typewrite, _skipTypewrite, _renderChoices, _hasGiftableInventory } from './render.js';
import { _handleChoice, _showGiftSubmenu, _giveGoldGift, _giveItemGift, _showAskAboutSubmenu, _showSkillCheckResult, _animateDispositionChange, _updateDispositionBar, _createOverlay } from './choices.js';
import { Traits } from '../../systems/traits.js';

export function _mem(npc) {
    return NpcDisposition.getMemory(npc);
}

export function _dispositionLabel(d) {
    if (d >= 90) return { text: 'Devoted', color: '#4FC3F7', icon: '💙' };
    if (d >= 75) return { text: 'Friendly', color: '#66BB6A', icon: '😊' };
    if (d >= 55) return { text: 'Warm', color: '#A5D6A7', icon: '🙂' };
    if (d >= 40) return { text: 'Neutral', color: '#FFD54F', icon: '😐' };
    if (d >= 25) return { text: 'Wary', color: '#FF8A65', icon: '😒' };
    if (d >= 10) return { text: 'Unfriendly', color: '#EF5350', icon: '😠' };
    return { text: 'Hostile', color: '#D32F2F', icon: '🤬' };
}

export function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function _getTimeOfDay() {
    const h = InnerMap.timeOfDay || 8;
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 21) return 'evening';
    return 'night';
}

export function _getWeather() {
    if (InnerMap.weather) return InnerMap.weather.type || 'clear';
    return 'clear';
}

export function _getSettlement() {
    if (!dialogState._game || !dialogState._game.world || !dialogState._game.player) return null;
    const tile = dialogState._game.world.getTile(dialogState._game.player.q, dialogState._game.player.r);
    return tile?.settlement || null;
}

export function _getKingdom() {
    const settlement = _getSettlement();
    if (!settlement || !settlement.kingdom || !dialogState._game.world) return null;
    return dialogState._game.world.kingdoms?.find(k => k.id === settlement.kingdom) || null;
}

export function _skillCheck(skillName, difficulty) {
    if (!dialogState._game?.player) return false;
    const skillVal = dialogState._game.player.skills?.[skillName] || 0;
    const attrBonus = _getAttributeBonus(skillName);
    const total = skillVal + attrBonus;
    // Guaranteed pass if total >= difficulty, otherwise proportional chance
    if (total >= difficulty) return true;
    return Math.random() < (total / difficulty);
}

export function _getAttributeBonus(skillName) {
    if (!dialogState._game?.player) return 0;
    switch (skillName) {
        case 'diplomacy': return Math.floor((dialogState._game.player.charisma || 5) / 3);
        case 'combat': return Math.floor((dialogState._game.player.strength || 5) / 3);
        case 'stealth': return Math.floor((dialogState._game.player.luck || 5) / 4);
        case 'commerce': return Math.floor((dialogState._game.player.intelligence || 5) / 3);
        default: return 0;
    }
}

export function _getSkillTotal(skillName) {
    if (!dialogState._game?.player) return 0;
    return (dialogState._game.player.skills?.[skillName] || 0) + _getAttributeBonus(skillName);
}

export function _getPlayerTitle() {
    if (!dialogState._game?.player) return '';
    if (dialogState._game.player.kingdomTitle) return dialogState._game.player.kingdomTitle;
    if (dialogState._game.player.title && dialogState._game.player.title !== 'Nobody') return dialogState._game.player.title;
    return '';
}

export function _isPlayerRenowned() {
    if (!dialogState._game?.player) return false;
    return (dialogState._game.player.renown || 0) >= 20 || !!_getPlayerTitle();
}

export function _getGreeting(npc) {
    const type = npc.type || 'villager';
    const mem = _mem(npc);

    // Someone who saw you harm their kin or friend remembers it
    const grudge = NpcDisposition.grudgeLine(npc);
    if (grudge && mem.disposition < 40) return grudge;

    // A threatened NPC is afraid of you (or refuses to talk at all)
    const fear = NpcDisposition.threatReaction(npc);
    if (fear) return fear.text;

    // Word of who you have become travels ahead of you (earned traits)
    const traitLine = Traits.greetingLine(dialogState._game?.player, Math.random(), Math.random());
    if (traitLine) return traitLine;

    // Check for family reaction first — if player treated a relative well/poorly
    const familyReaction = NpcFamily.getFamilyReactionLine(npc, InnerMap.npcs || []);
    if (familyReaction && Math.random() < 0.6) {
        return familyReaction;
    }

    // Pick pool based on disposition and memory
    let pool;
    if (mem.disposition < 20) {
        pool = HOSTILE_GREETINGS[type] || HOSTILE_GREETINGS.villager;
    } else if (_isPlayerRenowned() && mem.disposition >= 50) {
        pool = RESPECTFUL_GREETINGS[type] || RESPECTFUL_GREETINGS.villager;
    } else if (mem.timesSpoken > 1 && mem.disposition >= 40) {
        pool = RETURNING_GREETINGS[type] || RETURNING_GREETINGS.villager;
    } else {
        pool = GREETINGS[type] || GREETINGS.villager;
    }

    let greeting = _pick(pool);

    // Sometimes add a family mention (20% chance for NPCs with families)
    if (Math.random() < 0.2 && mem.timesSpoken > 0) {
        const familyComment = NpcFamily.getFamilyComment(npc, InnerMap.npcs || []);
        if (familyComment) {
            greeting += ' ' + familyComment;
            return greeting;
        }
    }

    // Occasionally add a time-of-day or weather comment
    const tod = _getTimeOfDay();
    const weather = _getWeather();
    if (Math.random() < 0.4 && TIME_COMMENTS[tod]) {
        greeting += ' ' + _pick(TIME_COMMENTS[tod]);
    } else if (Math.random() < 0.3 && weather !== 'clear' && WEATHER_COMMENTS[weather]) {
        greeting += ' ' + _pick(WEATHER_COMMENTS[weather]);
    }

    return greeting;
}

export function _getRumor(type) { return _pick(RUMORS[type] || RUMORS.villager); }

export function _getFarewell(type) { return _pick(FAREWELLS[type] || FAREWELLS.villager); }
