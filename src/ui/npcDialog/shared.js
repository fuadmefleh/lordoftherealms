// npcDialog shared state + data (mutable bcState object + tables).
import { InnerMap } from '../../world/innerMap.js';
import { ActionMenu } from '../actionMenu.js';
import { NpcFamily } from '../../systems/npcFamily.js';
import { GREETINGS, RETURNING_GREETINGS, RESPECTFUL_GREETINGS, HOSTILE_GREETINGS, RUMORS, FAREWELLS, THREAT_RESPONSES, THREAT_SUCCESS, FLATTER_RESPONSES, FLATTER_SUCCESS, TIME_COMMENTS, WEATHER_COMMENTS, NPC_QUEST_HOOKS, LOCATION_INFO, KINGDOM_INFO } from '../npcDialog.data.js';

export const dialogState = {
    _active: false,
    _game: null,
    _npc: null,
    _lines: [],
    _lineIndex: 0,
    _overlay: null,
    _typewriteTimer: null,
    _typewriteComplete: false,
};
