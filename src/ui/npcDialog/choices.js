// npcDialog — choices functions.
import { InnerMap } from '../../world/innerMap.js';
import { ActionMenu } from '../actionMenu.js';
import { NpcFamily } from '../../systems/npcFamily.js';
import { Quests } from '../../systems/quests.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { Gossip } from '../../systems/gossip.js';
import { NpcKnowledge } from '../../systems/npcKnowledge.js';
import { House } from '../../systems/house.js';
import { GREETINGS, RETURNING_GREETINGS, RESPECTFUL_GREETINGS, HOSTILE_GREETINGS, RUMORS, FAREWELLS, THREAT_RESPONSES, THREAT_SUCCESS, FLATTER_RESPONSES, FLATTER_SUCCESS, TIME_COMMENTS, WEATHER_COMMENTS, NPC_QUEST_HOOKS, LOCATION_INFO, KINGDOM_INFO } from '../npcDialog.data.js';
import { dialogState } from './shared.js';
import { NpcDialog } from './index.js'; // call-time facade ref (ESM cycle-safe)
import { _mem, _dispositionLabel, _pick, _getTimeOfDay, _getWeather, _getSettlement, _getKingdom, _skillCheck, _getAttributeBonus, _getSkillTotal, _getPlayerTitle, _isPlayerRenowned, _getGreeting, _getRumor, _getFarewell, _getNews, _roadContext, _worldContext, _memoryLines } from './helpers.js';
import { _buildConversation, _render, _typewrite, _skipTypewrite, _renderChoices, _hasGiftableInventory, _syncTranscript, _showThinking, _renderChoiceList, _voiceLine } from './render.js';
import { NpcBrain } from '../../systems/npcBrain.js';
import { NpcChat } from '../../systems/npcChat.js';
import { renderTalkBox } from '../conversationScene.js';
import { NpcPortrait } from '../npcPortrait.js';
import { SocialSkills } from '../../systems/socialSkills.js';
import { IllnessPlayer } from '../../systems/illnessPlayer.js';
import { NpcMemory } from '../../systems/npcMemory.js';

/** The questions a disliked player can be refused, by rebuff topic. */
const ASK_TOPICS = {
    ask_rumor: 'news', ask_location: 'town', ask_kingdom: 'realm', ask_folk_news: 'folk',
    ask_family: 'family', ask_about_npc: 'people', ask_quest: 'work',
};

export function _handleChoice(action) {
    const npcType = dialogState._npc.type || 'villager';
    const mem = _mem(dialogState._npc);
    // Someone who dislikes the player tells them nothing — just to shove off (systems/npcKnowledge.js)
    const topic = ASK_TOPICS[action];
    const rebuff = topic ? NpcKnowledge.rebuff(dialogState._npc, mem, topic,
        `${dialogState._npc.uid || dialogState._npc.id}|${dialogState._game?.world?.day || 0}|${mem.rumorsTold}`) : null;

    // Build player line text
    const labelMap = {
        ask_rumor: 'What news do you have?',
        ask_location: 'Tell me about this place.',
        ask_kingdom: _getKingdom() ? `What do you know about ${_getKingdom().name}?` : 'What do you know about the kingdom?',
        ask_family: 'Tell me about your family.',
        ask_folk_news: 'What\'s become of folk here?',
        ask_about_npc: 'What do you think of the people here?',
        trade: 'Show me your wares.',
        ask_quest: 'Do you need any help?',
        accept_quest: 'I\'ll help you.',
        decline_quest: 'That\'s not for me.',
        give_gift: 'I have something for you.',
        flatter: 'You seem wise — tell me more.',
        threat: 'Watch your tongue.',
        persuade: 'I need your trust on something important.',
        bargain: 'Surely you can do better on the price?',
        ask_favour: 'Could I ask a favour of you?',
        repay_favour: 'Here\'s what I owe you.',
        farewell: 'Farewell.',
    };

    const playerText = labelMap[action] || action;
    dialogState._lines.push({ speaker: 'You', text: playerText, isNpc: false, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;

    // The player's words join the transcript; the NPC considers an answer
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (choicesEl) choicesEl.innerHTML = '';
    const typing = box.querySelector('.npc-dialog-text');
    const prev = dialogState._lines[dialogState._lines.length - 2];
    if (typing && prev && !dialogState._typewriteComplete) _skipTypewrite(typing, prev.text);
    _syncTranscript(box);
    const submenu = !rebuff && (action === 'ask_about_npc' || action === 'give_gift');
    if (!submenu) _showThinking(box);
    if (action === 'farewell' || action === 'trade') dialogState._overlay._closing = true;

    setTimeout(() => {
        if (!dialogState._active || !dialogState._overlay) return;
        let responseText;
        let shouldClose = false;
        let dispositionChange = 0;
        let skillGains = null;

        if (rebuff) {
            responseText = rebuff;
            dispositionChange = NpcKnowledge.config().rebuff.pester || 0;
        } else switch (action) {
            case 'ask_rumor': {
                responseText = _getNews(dialogState._npc);
                mem.rumorsTold++;
                dispositionChange = 2; // Sharing gossip builds minor rapport
                // Slight social need boost
                if (dialogState._game?.player?.modifyNeed) dialogState._game.player.modifyNeed('social', 3);
                break;
            }

            case 'ask_location': {
                // The real town: its buildings and keepers, its market, its guilds,
                // the outlaws and old places round about (systems/npcKnowledge.js)
                const settlement = _getSettlement();
                const game = dialogState._game;
                if (settlement && game?.world) {
                    const ans = NpcKnowledge.aboutTown(game.world, game.player, dialogState._npc, settlement, {
                        disposition: mem.disposition, buildings: InnerMap.buildings || [],
                        seed: `${dialogState._npc.uid || dialogState._npc.id}|town|${game.world.day}`,
                    });
                    responseText = ans.text;
                    const marked = ans.revealed.lairs.length + ans.revealed.sites.length;
                    if (marked && game.ui?.showNotification) {
                        setTimeout(() => game.ui.showNotification('🗺️ Local Knowledge', `${dialogState._npc?.name || 'They'} told you of ${marked === 1 ? 'a place' : `${marked} places`} nearby — now on your map.`, 'info'), 1200);
                    }
                } else if (game?.world && _roadContext(dialogState._npc)) {
                    // Out on the open road: the house, the land, where the road goes (systems/npcKnowledge.js)
                    const ans = NpcKnowledge.aboutRoad(game.world, game.player, dialogState._npc, {
                        ..._roadContext(dialogState._npc), disposition: mem.disposition,
                        seed: `${dialogState._npc.uid || dialogState._npc.id}|road|${game.world.day}`,
                    });
                    responseText = ans.text;
                    const marked = ans.revealed.lairs.length + ans.revealed.sites.length;
                    if (marked && game.ui?.showNotification) {
                        setTimeout(() => game.ui.showNotification('🗺️ Local Knowledge', `${dialogState._npc?.name || 'They'} told you of ${marked === 1 ? 'a place' : `${marked} places`} nearby — now on your map.`, 'info'), 1200);
                    }
                } else {
                    responseText = _pick(LOCATION_INFO[npcType] || LOCATION_INFO.villager);
                }
                dispositionChange = 1;
                break;
            }

            case 'ask_kingdom': {
                const kingdom = _getKingdom();
                if (kingdom) {
                    // What they truly know of the realm, by their station and their mood (systems/npcKnowledge.js)
                    const game = dialogState._game;
                    const ans = NpcKnowledge.aboutKingdom(game?.world, game?.player, dialogState._npc, kingdom, {
                        disposition: mem.disposition, settlement: _getSettlement(),
                        seed: `${dialogState._npc.uid || dialogState._npc.id}|realm|${game?.world?.day || 0}`,
                    });
                    responseText = ans.text;
                    // Only what they knew for certain adds to what the player knows
                    if (game?.player?.learnAboutKingdom) game.player.learnAboutKingdom(kingdom.id, ans.learned);
                    dispositionChange = 2;
                } else {
                    responseText = 'I\'m afraid I don\'t know much about the wider politics.';
                }
                break;
            }

            case 'ask_folk_news': {
                const news = Townsfolk.townNews(dialogState._npc._folk, dialogState._game?.world, 4, dialogState._npc._person);
                responseText = news.length
                    ? _pick(['Let me think...', 'Oh, much has happened.', 'Where to begin?']) + ' ' + news.join(' ')
                    : 'Nothing much changes here, truth be told.';
                dispositionChange = 2;
                if (dialogState._game?.player?.modifyNeed) dialogState._game.player.modifyNeed('social', 4);
                break;
            }

            case 'ask_family': {
                const allNpcs = InnerMap.npcs || [];
                // A townsperson's whole family, the living and the dead (systems/townsfolk.js)
                const story = Townsfolk.familyLines(dialogState._npc, dialogState._game?.world);
                // ...and the stories their family tells of yours (systems/npcMemory.js)
                const told = dialogState._game?.player ? NpcMemory.familyStories(dialogState._game.world, dialogState._npc, { about: dialogState._game.player, limit: 2 }).map(m => m.text).filter(Boolean) : [];
                if (story || told.length) {
                    responseText = [story, ...told].filter(Boolean).join(' ');
                    dispositionChange = 3;
                    if (dialogState._game?.player?.modifyNeed) dialogState._game.player.modifyNeed('social', 5);
                    break;
                }
                const familyParts = [];

                // Spouse
                if (dialogState._npc.spouseId != null) {
                    const spouse = allNpcs.find(n => n.id === dialogState._npc.spouseId);
                    if (spouse) {
                        const spouseTitle = spouse.gender === 'female' ? 'wife' : 'husband';
                        const typeName = (InnerMap.NPC_TYPES[spouse.type] || {}).name || spouse.type;
                        familyParts.push(`My ${spouseTitle} ${spouse.fullName || spouse.name} is a ${typeName.toLowerCase()} here.`);
                    }
                }

                // Children
                if (dialogState._npc.childIds && dialogState._npc.childIds.length > 0) {
                    const childNames = dialogState._npc.childIds
                        .map(id => allNpcs.find(n => n.id === id))
                        .filter(Boolean)
                        .map(c => c.name);
                    if (childNames.length === 1) {
                        familyParts.push(`My child ${childNames[0]} keeps me busy!`);
                    } else if (childNames.length > 1) {
                        familyParts.push(`I have ${childNames.length} children: ${childNames.join(' and ')}. They\'re a handful!`);
                    }
                }

                // Parents
                if (dialogState._npc.parentIds && dialogState._npc.parentIds.length > 0) {
                    const parents = dialogState._npc.parentIds
                        .map(id => allNpcs.find(n => n.id === id))
                        .filter(Boolean);
                    if (parents.length > 0) {
                        const parentNames = parents.map(p => p.name).join(' and ');
                        familyParts.push(`My ${parents.length > 1 ? 'parents are' : (parents[0].gender === 'female' ? 'mother is' : 'father is')} ${parentNames}.`);
                    }
                }

                // Siblings
                if (dialogState._npc.siblingIds && dialogState._npc.siblingIds.length > 0) {
                    const siblings = dialogState._npc.siblingIds
                        .map(id => allNpcs.find(n => n.id === id))
                        .filter(Boolean);
                    if (siblings.length > 0) {
                        const sibNames = siblings.map(s => s.name).join(' and ');
                        const sibTitle = siblings.length === 1
                            ? (siblings[0].gender === 'female' ? 'sister' : 'brother')
                            : 'siblings';
                        familyParts.push(`My ${sibTitle} ${sibNames} ${siblings.length === 1 ? 'lives' : 'live'} here too.`);
                    }
                }

                if (familyParts.length > 0) {
                    responseText = familyParts.join(' ');
                    // Add a personal touch
                    if (dialogState._npc.lastName) {
                        responseText = `We\'re the ${dialogState._npc.lastName} family. ` + responseText;
                    }
                } else {
                    responseText = 'I don\'t have much family to speak of. It\'s just me, I\'m afraid.';
                }
                dispositionChange = 3;
                if (dialogState._game?.player?.modifyNeed) dialogState._game.player.modifyNeed('social', 5);
                break;
            }

            case 'ask_about_npc': {
                _showAskAboutSubmenu();
                return; // Submenu handles the response
            }

            case 'trade': {
                responseText = 'Let me show you what I have...';
                shouldClose = 'trade';
                break;
            }

            case 'ask_quest': {
                const hooks = NPC_QUEST_HOOKS[npcType];
                if (hooks && hooks.length > 0) {
                    const hook = _pick(hooks);
                    responseText = hook.text;
                    mem.questOffered = true;
                    mem.pendingHook = hook;
                    dispositionChange = 3;
                } else {
                    responseText = 'I appreciate you asking, but I don\'t need anything right now.';
                }
                break;
            }

            case 'accept_quest': {
                const hook = mem.pendingHook;
                const game = dialogState._game;
                const npc = dialogState._npc;
                const result = game && game.player ? Quests.createNpcTask(game.player, hook, npc, game.world) : { success: false };
                if (!result.success && result.reason && result.reason.startsWith('Too many')) {
                    // Keep the offer open — the player can come back once they've room.
                    responseText = "You look stretched thin already. Come back when you've time for me.";
                    break;
                }
                mem.pendingHook = null;
                mem.questAccepted = true;
                responseText = 'Thank you! I knew I could count on someone like you.';
                // A concrete task: they say where to go (systems/npcTasks.js)
                const first = result.success && result.quest.objectives[0];
                if (first && result.quest.v === 2) {
                    const where = Quests.whereLine(first, game.player, game.world);
                    responseText += ` ${first.text}${where ? ` — ${where.split(' — ').pop()}` : ''}.`;
                    if (result.quest.giver && result.quest.giver.uid) responseText += ' Then come back to me.';
                }
                dispositionChange = 10;
                if (result.success && game?.ui?.showNotification) {
                    const q = result.quest;
                    setTimeout(() => {
                        game.ui.showNotification('📜 Task Accepted', `${q.title}: ${q.objectives[0].text}. Reward: ${Quests.describeRewards(q.rewards)}. Marked on your map and in the journal.`, 'success');
                    }, 800);
                }
                break;
            }

            case 'decline_quest': {
                mem.pendingHook = null;
                responseText = 'I understand. Not everyone can spare the time.';
                dispositionChange = -3;
                break;
            }

            case 'give_gift': {
                _showGiftSubmenu();
                return; // Don't add NPC response yet; submenu handles it
            }

            case 'flatter': {
                // Some warm to praise, some see through it; flattery wears thin with use
                const difficulty = NpcKnowledge.socialDifficulty(dialogState._npc, mem, 'flatter').difficulty;
                const success = _skillCheck('diplomacy', difficulty);
                mem.flattered = true;
                if (success) {
                    const pool = FLATTER_SUCCESS[npcType] || FLATTER_SUCCESS.villager;
                    const lineIndex = Math.floor(Math.random() * pool.length);
                    responseText = pool[lineIndex];
                    // Keep the promise in that line (once per NPC)
                    const game = dialogState._game;
                    const gift = NpcDisposition.flatterReward(
                        dialogState._npc, lineIndex,
                        { player: game?.player, world: game?.world, kingdom: _getKingdom(), type: FLATTER_SUCCESS[npcType] ? npcType : 'villager' });
                    if (gift && game?.ui?.showNotification) {
                        setTimeout(() => {
                            game.ui.showNotification('😊 Flattery Pays', gift.summary, 'success');
                            if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
                        }, 1500);
                    }
                    dispositionChange = 10;
                    skillGains = { diplomacy: 1 };
                    if (dialogState._game?.player?.modifyNeed) {
                        dialogState._game.player.modifyNeed('social', 10);
                        dialogState._game.player.modifyNeed('fun', 5);
                    }
                } else {
                    responseText = _pick(FLATTER_RESPONSES[npcType] || FLATTER_RESPONSES.villager);
                    dispositionChange = 3;
                    if (dialogState._game?.player?.modifyNeed) {
                        dialogState._game.player.modifyNeed('social', 5);
                    }
                }
                _showSkillCheckResult(success, 'Charm');
                if (!success && dialogState._game?.player) SocialSkills.trainBy(dialogState._game.player, 'persuasion', 'fail');
                break;
            }

            case 'threat': {
                const baseDifficulty = npcType === 'guard' || npcType === 'blacksmith_npc' ? 5 : npcType === 'noble' ? 4 : 2;
                // Someone you've already cowed folds more easily
                const difficulty = dialogState._npc ? NpcDisposition.threatDifficulty(dialogState._npc, baseDifficulty, dialogState._game?.player) : baseDifficulty;
                const success = _skillCheck('combat', difficulty);
                if (success) {
                    const pool = THREAT_SUCCESS[npcType] || THREAT_SUCCESS.villager;
                    responseText = _pick(pool);
                    dispositionChange = -15;
                    skillGains = { combat: 1 };
                } else {
                    responseText = _pick(THREAT_RESPONSES[npcType] || THREAT_RESPONSES.villager);
                    dispositionChange = -10;
                }
                // Concrete outcome: coin handed over, and maybe a report to the guard
                const game = dialogState._game;
                const threatNpc = dialogState._npc;
                const outcome = NpcDisposition.resolveThreat(threatNpc, game?.player, success);
                if (outcome.gold > 0) responseText += ` *hands over ${outcome.gold} gold*`;
                if (game?.ui?.showNotification) {
                    setTimeout(() => {
                        if (outcome.gold > 0) {
                            game.ui.showNotification('💪 Intimidation', `${threatNpc.name} hands over ${outcome.gold} gold. They'll fear you — and charge you more.`, 'success');
                            if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
                        } else if (success) {
                            game.ui.showNotification('💪 Intimidation', `${threatNpc.name} cowers${outcome.alreadyExtorted ? ', but has nothing left to give' : ''}.`, 'info');
                        }
                        if (outcome.reported && game.player && game.world) {
                            const wt = InnerMap.currentWorldTile || {};
                            Gossip.reportCrime(game.player, game.world, {
                                crimeType: 'assault',
                                victim: { name: threatNpc.name, type: threatNpc.type, icon: threatNpc.icon },
                                q: wt.q, r: wt.r,
                                scene: { npcs: InnerMap.npcs || [], q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR },
                            });
                            game.ui.showNotification('🚨 Reported!', `${threatNpc.name} ran to the guard about your threats. Word will spread.`, 'warning');
                        }
                    }, 1500);
                }
                // Karma hit regardless
                if (game?.player) {
                    game.player.karma = (game.player.karma || 0) - 2;
                    if (game.player.modifyNeed) game.player.modifyNeed('social', -5);
                }
                _showSkillCheckResult(success, 'Intimidate');
                break;
            }

            case 'persuade': {
                const difficulty = NpcKnowledge.socialDifficulty(dialogState._npc, mem, 'persuade').difficulty;
                const success = _skillCheck('diplomacy', difficulty);
                if (success) {
                    // Deep persuasion — the secret comes with something real
                    const game = dialogState._game;
                    const secret = NpcDisposition.persuadeSecret(dialogState._npc, {
                        player: game?.player, world: game?.world, kingdom: _getKingdom(),
                    });
                    responseText = `*leans close and whispers* ${secret.text}`;
                    const rewardText = secret.kind === 'cache' ? `+${secret.gold} gold`
                        : secret.kind === 'map' ? `${secret.tilesRevealed} map tiles revealed`
                        : secret.kind === 'treasure' ? 'Treasure map added to your collection'
                        : secret.kind === 'discount' ? `${Math.round(secret.discount * 100)}% off with ${dialogState._npc.name} from now on`
                        : 'Kingdom military & economy intel learned';
                    if (game?.ui?.showNotification) {
                        setTimeout(() => {
                            game.ui.showNotification('🤫 A Secret Shared', rewardText, 'success');
                            if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
                        }, 1500);
                    }
                    dispositionChange = 5;
                    skillGains = { diplomacy: 2 };
                    if (dialogState._game?.player?.modifyNeed) {
                        dialogState._game.player.modifyNeed('social', 8);
                        dialogState._game.player.modifyNeed('fun', 5);
                    }
                } else {
                    responseText = 'I... I\'m sorry, but I can\'t share that. It\'s not safe. Please don\'t ask again.';
                    dispositionChange = -3;
                }
                _showSkillCheckResult(success, 'Persuade');
                if (!success && dialogState._game?.player) SocialSkills.trainBy(dialogState._game.player, 'persuasion', 'fail');
                break;
            }

            case 'bargain': {
                const res = NpcKnowledge.bargain(dialogState._npc, mem, dialogState._game?.player);
                responseText = res.them > res.you + 1
                    ? `*narrows eyes* You haggle like a lamb, friend. ${Math.round(res.pct * 100)}% off, and that's my last word.`
                    : `*sighs* For you? Very well — ${Math.round(res.pct * 100)}% off, today only. Don't tell the others.`;
                _animateDispositionChange(-res.cost);
                break;
            }

            case 'ask_favour': {
                const game = dialogState._game;
                if (!game?.player || !game.world) { responseText = 'Not today, friend.'; break; }
                const res = NpcKnowledge.askFavour(game.world, game.player, dialogState._npc, mem, { settlement: _getSettlement() });
                responseText = res.text;
                _animateDispositionChange(-NpcKnowledge.config().favour.cost);
                if (game.ui?.showNotification) {
                    setTimeout(() => {
                        game.ui.showNotification('🙏 A Favour', res.summary, 'success');
                        if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
                    }, 1200);
                }
                break;
            }

            case 'repay_favour': {
                const game = dialogState._game;
                const res = game?.player ? NpcKnowledge.repay(game.player, mem, (game.world && game.world.day) || 0) : { success: false, reason: 'Not now.' };
                responseText = res.success ? res.text : `*shakes head* ${res.reason}`;
                if (res.success) {
                    _animateDispositionChange(res.warmth);
                    if (game.ui?.updateStats) game.ui.updateStats(game.player, game.world);
                }
                break;
            }

            case 'farewell': {
                responseText = _getFarewell(npcType);
                shouldClose = true;
                // Disposition boost for polite goodbye
                dispositionChange = 1;
                break;
            }

            default:
                responseText = 'Hmm...';
        }

        // Apply disposition change
        if (dispositionChange !== 0) {
            // Past gifts make goodwill grow faster; threats make it grow slower
            dispositionChange = NpcDisposition.adjustDisposition(dialogState._npc, dispositionChange, dialogState._game?.player);
            mem.lastAction = action;
            _animateDispositionChange(dispositionChange);

            // Social ripple — family members adjust their opinion of the player
            NpcFamily.applySocialRipple(dialogState._npc, dispositionChange, InnerMap.npcs || []);
        }

        // Apply skill gains
        if (skillGains && dialogState._game?.player?.skills) {
            for (const [skill, xp] of Object.entries(skillGains)) {
                // Diplomacy is Persuasion now: practice, in levels (systems/socialSkills.js; level-ups announced from the queue)
                if (skill === 'diplomacy' && SocialSkills.has('persuasion')) {
                    SocialSkills.trainBy(dialogState._game.player, 'persuasion', action === 'persuade' ? 'persuade' : 'charm');
                    continue;
                }
                dialogState._game.player.skills[skill] = (dialogState._game.player.skills[skill] || 0) + xp;
                if (dialogState._game?.ui?.showNotification) {
                    dialogState._game.ui.showNotification('📈 Skill Up', `${skill.charAt(0).toUpperCase() + skill.slice(1)} +${xp}`, 'success');
                }
            }
        }

        // Add NPC response — in their own voice when the AI brain is on (systems/npcBrain.js):
        // the game decides what they tell you, the model only says it; the thinking
        // dots stay up until its first words come (or a few seconds pass)
        const npcLine = { speaker: dialogState._npc.name, icon: dialogState._npc.icon, text: responseText, isNpc: true, _action: action };
        let shown = false;
        const show = () => {
            if (shown || !dialogState._active || !dialogState._overlay) return;
            shown = true;
            dialogState._lines.push(npcLine);
            dialogState._lineIndex = dialogState._lines.length - 1;
            _render();
        };
        if (responseText && NpcBrain.isEnabled()) {
            const wait = setTimeout(show, 3000);
            _voiceLine(npcLine, dialogState._npc, {
                topic: `reply:${action}`, asked: playerText, says: responseText,
                pending: () => !shown, onFirst: () => { clearTimeout(wait); show(); },
            });
        } else {
            show();
        }

        // Auto-close after farewell or trade redirect, once the line has been said
        if (shouldClose) {
            _afterSpoken(900, () => {
                const game = dialogState._game;
                const npc = dialogState._npc;
                NpcDialog.close();
                if (shouldClose === 'trade' && game) {
                    // A stall's keeper sells their stall's wares (world/innerMap/stalls.js)
                    const stall = npc && InnerMap.stallOfKeeper ? InnerMap.stallOfKeeper(npc) : null;
                    const here = stall && game.world ? game.world.getTile(game.player.q, game.player.r) : null;
                    if (here && here.settlement) {
                        ActionMenu.showTradeMenu(game, here, null, stall);
                    } else if (npc && npc.shopInventory && Object.keys(npc.shopInventory).length > 0) {
                        ActionMenu.showNpcTradeMenu(game, npc);
                    } else {
                        const worldTile = game.world ? game.world.getTile(game.player.q, game.player.r) : null;
                        if (worldTile) ActionMenu.showTradeMenu(game, worldTile);
                    }
                }
            }, () => shown);
        }
    }, 550);
}

/**
 * Say whatever you like (systems/npcChat.js, the AI brain): the townsperson
 * answers in their own words and may warm to you, sour, remember, or walk off.
 * Costs the chat's AP once; the choices give way to a box to type in until
 * Done talking.
 */
export function _startFreeTalk() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.player || !npc || !dialogState._overlay) return;
    const settlement = _getSettlement();
    const subject = NpcChat.townSubject(game.player, npc, {
        place: settlement && settlement.name, role: npc.roleTitle || npc.type,
        worldContext: _worldContext(npc), memories: _memoryLines(npc),
    });
    const can = NpcChat.canTalk(game.player, game.world, subject);
    if (!can.ok) { game.ui.showNotification('💬 Talk', can.reason, 'warning'); return; }
    const ap = NpcChat.config().apCost || 0;
    if ((game.player.actionPoints || 0) < ap) {
        game.ui.showNotification('💬 Talk', `You need ${ap} AP to sit and talk — you have ${game.player.actionPoints || 0}.`, 'warning');
        return;
    }
    game.player.actionPoints -= ap;
    if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
    const session = NpcChat.startSession(game.player, game.world, subject);
    // (what was just said in this dialog: the model picks up the thread, knowing who said what)
    for (const l of (dialogState._lines || []).slice(-6)) {
        const text = l && typeof l.text === 'string' ? l.text.replace(/<[^>]*>/g, '').trim() : '';
        if (text && (l.isNpc || l.speaker === 'You')) session.lines.push({ npc: !!l.isNpc, text, seeded: true });
    }
    dialogState._freeTalk = { subject, session };
    _renderChoices(dialogState._overlay.querySelector('.npc-dialog-box'));
}

/** The box to type in, in place of the choices, while talking freely. */
export function _renderFreeTalk(box, choicesEl) {
    const ft = dialogState._freeTalk;
    const npc = dialogState._npc;
    const game = dialogState._game;
    const live = () => dialogState._active && dialogState._overlay && dialogState._freeTalk === ft;
    renderTalkBox(choicesEl, {
        placeholder: `Say something to ${ft.subject.firstName}…`,
        isClosed: () => !live(),
        onSend: async (text) => {
            dialogState._lines.push({ speaker: 'You', text, isNpc: false, _action: 'free_talk' });
            dialogState._lineIndex = dialogState._lines.length - 1;
            const b = dialogState._overlay.querySelector('.npc-dialog-box');
            choicesEl.innerHTML = '';
            _syncTranscript(b);
            _showThinking(b);
            const before = _mem(npc).disposition;
            const res = await NpcChat.say(game.player, game.world, ft.subject, ft.session, text);
            if (!live()) return;
            const line = { speaker: npc.name, icon: npc.icon, text: res.ok ? res.say : `*${res.reason}*`, isNpc: true, _action: 'free_talk' };
            if (res.ok && res.notes.length) line.aside = res.notes.map(n => n.text).join(' · ');
            dialogState._lines.push(line);
            dialogState._lineIndex = dialogState._lines.length - 1;
            const delta = _mem(npc).disposition - before;
            if (delta) _animateDispositionChange(delta);
            if (res.ended || (res.ok && !NpcChat.canTalk(game.player, game.world, ft.subject).ok)) {
                // They walk away (or have talked enough for today)
                dialogState._freeTalk = null;
                if (res.ended) dialogState._overlay._closing = true;
                _render();
                if (res.ended) _afterSpoken(1100, () => NpcDialog.close());
                return;
            }
            _render();
        },
        onDone: () => {
            dialogState._freeTalk = null;
            _renderChoices(dialogState._overlay.querySelector('.npc-dialog-box'));
        },
    });
}

/**
 * A task choice (render.js _taskChoices): hand a task in to its giver, carry
 * something to the person it names, or get something from them — asked,
 * bought, or lifted (a stealth check).
 */
export function _taskChoice(opt, how) {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game?.player || !npc) return;
    const quest = opt.quest;
    const o = opt.obj;
    const box = dialogState._overlay && dialogState._overlay.querySelector('.npc-dialog-box');
    const item = quest.carrying || o.item || quest.item || 'it';
    const said = opt.kind === 'return'
        ? (quest.person ? `I found ${quest.person.name}.` : quest.carrying ? `I've brought back ${quest.carrying}.` : 'It\'s done, as you asked.')
        : how === 'steal' ? `*reaches for ${item}*` : how === 'bribe' ? 'Name your price — 80 gold?' : opt.kind === 'deliver' || opt.kind === 'proxy' ? `I bring ${item} from ${quest.giver?.name || 'a friend'}.` : `I've come for ${item}.`;
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: 'task' });
    dialogState._lineIndex = dialogState._lines.length - 1;
    if (box) {
        const choicesEl = box.querySelector('.npc-dialog-choices');
        if (choicesEl) choicesEl.innerHTML = '';
        _syncTranscript(box);
        _showThinking(box);
    }

    setTimeout(() => {
        if (!dialogState._active) return;
        let text;
        let change = 0;
        if (opt.kind === 'return') {
            const res = Quests.handInNpcTask(game.player, game.world, quest.id);
            if (res.success) {
                text = res.line || 'Thank you. I won\'t forget this.';
                change = NpcDisposition.adjustDisposition(npc, res.disposition, game.player);
                NpcFamily.applySocialRipple(npc, change, InnerMap.npcs || []);
                House.recordPlayerDeed(game.player, game.world, 'quest', { reason: `quest: ${quest.title}` });
                if (game.ui?.showNotification) {
                    setTimeout(() => {
                        game.ui.showNotification('Quest Complete!', `${quest.title} — Rewards: ${Quests.describeRewards(quest.rewards)}`, 'success');
                        if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
                    }, 900);
                }
            } else {
                text = `Not yet, I think. ${res.reason || ''}`.trim();
            }
        } else {
            let stole = false;
            if (how === 'steal') stole = _skillCheck('stealth', 5);
            const res = Quests.talkToTask(game.player, game.world, quest.id, how, stole);
            if (res.success) {
                text = res.line || (how === 'steal' ? `*doesn't notice a thing* (You have ${item}.)` : `*hands over ${item}*`);
                if (opt.kind === 'proxy') text = `${o.person}? I know them — I'll see it reaches them.`;
                if (opt.kind === 'proxy_fetch') text = `${o.person} left this with me for whoever came asking. *hands over ${item}*`;
                change = NpcDisposition.adjustDisposition(npc, opt.kind === 'deliver' || opt.kind === 'proxy' ? 5 : how === 'bribe' ? 2 : 0, game.player);
                if (how === 'steal') _showSkillCheckResult(true, 'Stealth');
                if (res.carrying) text += ` (Take ${res.carrying} back to ${quest.giver?.name || 'them'}.)`;
                else if (res.done && game.ui?.showNotification) game.ui.showNotification('Quest Complete!', quest.title, 'success');
                if (game.ui?.updateStats) game.ui.updateStats(game.player, game.world);
            } else if (res.caught) {
                text = '*grabs your wrist* Thief! Get out before I call the watch!';
                change = NpcDisposition.adjustDisposition(npc, -30, game.player);
                _mem(npc).wronged = true;
                _showSkillCheckResult(false, 'Stealth');
            } else {
                text = res.line || res.reason || 'I can\'t help you with that.';
            }
        }
        if (change) _animateDispositionChange(change);
        dialogState._lines.push({ speaker: npc.name, icon: npc.icon, text, isNpc: true, _action: 'task' });
        dialogState._lineIndex = dialogState._lines.length - 1;
        _render();
    }, 550);
}

/** Run `fn` `pause` ms after the current line has finished typing (if the dialog is still open). */
function _afterSpoken(pause, fn, ready = null) {
    const overlay = dialogState._overlay;
    const wait = () => {
        if (!dialogState._active || dialogState._overlay !== overlay) return;
        // (a voiced line not yet on the transcript: wait for it too)
        if (!dialogState._typewriteComplete || (ready && !ready())) { setTimeout(wait, 100); return; }
        setTimeout(() => { if (dialogState._active && dialogState._overlay === overlay) fn(); }, pause);
    };
    wait();
}

/** Leave a submenu: the player takes it back and the usual choices return. */
function _backFromSubmenu(box) {
    dialogState._lines.push({ speaker: 'You', text: 'Never mind.', isNpc: false, _action: 'never_mind' });
    for (let i = dialogState._lines.length - 1; i >= 0; i--) {
        if (dialogState._lines[i].isNpc) { dialogState._lineIndex = i; break; }
    }
    _syncTranscript(box);
    _renderChoices(box);
}

export function _showGiftSubmenu() {
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;

    const npcType = dialogState._npc.type || 'villager';
    const playerGold = dialogState._game?.player?.gold || 0;
    const choices = [];

    // Gold gift options
    const warmth = { 5: 'a little', 25: 'noticeably', 100: 'greatly' };
    for (const amount of [5, 25, 100]) {
        if (playerGold < amount) continue;
        choices.push({
            icon: '💰', label: `${amount} gold`, group: 'gift', cls: 'npc-dialog-gift',
            extra: `<span class="npc-dialog-coin-stack" style="--n:${amount >= 100 ? 3 : amount >= 25 ? 2 : 1}"></span>`,
            tooltip: `Warms them ${warmth[amount]}${npcType === 'beggar' ? ' — and twice as much for one so poor' : ''}. You have ${playerGold} gold.`,
            onPick: () => _giveGoldGift(amount),
        });
    }

    // Inventory item gifts
    if (dialogState._game?.player?.inventory) {
        const items = Object.entries(dialogState._game.player.inventory).filter(([, qty]) => qty > 0);
        // (for the sick, medicine and food first: systems/illnessPlayer.js)
        if (IllnessPlayer.greetLine(dialogState._npc, dialogState._game?.world)) {
            const rank = id => ({ medicine: 0, food: 1 }[IllnessPlayer.giftKind(id)] ?? 2);
            items.sort((a, b) => rank(a[0]) - rank(b[0]));
        }
        for (const [itemId, qty] of items.slice(0, 6)) {
            const displayName = itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            choices.push({
                icon: '📦', label: displayName, group: 'goods', cls: 'npc-dialog-gift',
                extra: `<span class="npc-dialog-qty">×${qty}</span>`,
                tooltip: `Give one ${displayName}. You have ${qty}.`,
                onPick: () => _giveItemGift(itemId),
            });
        }
    }

    const back = () => _backFromSubmenu(box);
    choices.push({ icon: '↩️', label: 'Never mind.', group: 'leave', onPick: back });
    _renderChoiceList(choicesEl, choices, { back, hint: `What will you give ${dialogState._npc.name}?` });
}

export function _giveGoldGift(amount) {
    if (!dialogState._game?.player || dialogState._game.player.gold < amount) return;
    dialogState._game.player.gold -= amount;

    const npcType = dialogState._npc.type || 'villager';

    // Disposition boost scaled by amount
    let boost = amount >= 100 ? 15 : amount >= 25 ? 8 : 4;
    // Beggars appreciate gold more
    if (npcType === 'beggar') boost *= 2;
    // Nobles care less about small amounts
    if (npcType === 'noble' && amount < 25) boost = Math.ceil(boost / 2);

    // Earlier gifts make each new one count for more; then record this one
    boost = NpcDisposition.adjustDisposition(dialogState._npc, boost, dialogState._game?.player);
    const giftResult = NpcDisposition.recordGift(dialogState._npc, dialogState._game?.player);
    // Remembered for years (systems/npcMemory.js)
    NpcMemory.onGift(dialogState._game?.world, dialogState._game?.player, dialogState._npc, { gold: amount });

    // Karma boost
    if (dialogState._game.player) dialogState._game.player.karma = (dialogState._game.player.karma || 0) + 1;

    // Response
    const responses = {
        merchant: amount >= 25 ? 'Most generous! You\'ll find my prices very favorable now.' : 'Every coin helps. Thank you!',
        guard:    amount >= 25 ? '*pockets gold discreetly* I\'ll make sure the patrols stay clear of your business.' : 'Don\'t try to bribe a guard! ...but I\'ll let it slide this once.',
        farmer:   'This means the world to me and my family. You have a kind heart.',
        priest:   'This contribution will be put to good use. The gods bless your generosity.',
        blacksmith_npc: amount >= 25 ? 'Generous! I\'ll remember this when you need something forged.' : 'Appreciated! I\'ll keep this in mind.',
        villager: '*eyes widen* For me? You\'re too kind!',
        child:    '*gasps* GOLD?! Wait till I show mama!',
        noble:    amount >= 100 ? 'A gesture befitting your character. I shall remember this.' : 'A modest gift, but the intent is noted.',
        traveler: 'Trail coin! This\'ll keep me fed for a week. Thank you, friend.',
        beggar:   '*breaks down crying* Thank you... thank you so much. I can eat tonight!',
    };

    let responseText = responses[npcType] || 'Thank you for your generosity!';
    if (giftResult.forgiven) responseText += ' ...Very well. I suppose I can put your threats behind us.';

    dialogState._lines.push({ speaker: 'You', text: `*gives ${amount} gold*`, isNpc: false, _action: 'give_gift' });
    dialogState._lines.push({ speaker: dialogState._npc.name, icon: dialogState._npc.icon, text: responseText, isNpc: true, _action: 'give_gift' });
    dialogState._lineIndex = dialogState._lines.length - 1;

    _animateDispositionChange(boost);
    _render();

    if (dialogState._game?.player?.modifyNeed) {
        dialogState._game.player.modifyNeed('social', 8);
    }
}

export function _giveItemGift(itemId) {
    if (!dialogState._game?.player?.inventory || !dialogState._game.player.inventory[itemId]) return;
    dialogState._game.player.inventory[itemId]--;
    if (dialogState._game.player.inventory[itemId] <= 0) delete dialogState._game.player.inventory[itemId];

    const npcType = dialogState._npc.type || 'villager';

    const displayName = itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Item-specific disposition boosts
    let boost = 5;
    if (itemId === 'bread' || itemId === 'food') boost = npcType === 'beggar' ? 15 : 6;
    if (itemId === 'ale' || itemId === 'wine') boost = npcType === 'traveler' ? 10 : 6;
    // Medicine or food for the sick: their care the better, now and then the fever breaks (systems/illnessPlayer.js)
    const nursed = IllnessPlayer.giveToSick(dialogState._npc, itemId, dialogState._game?.world, dialogState._game?.player);
    if (nursed) boost = Math.max(boost, nursed.boost);

    boost = NpcDisposition.adjustDisposition(dialogState._npc, boost, dialogState._game?.player);
    const giftResult = NpcDisposition.recordGift(dialogState._npc, dialogState._game?.player);
    NpcMemory.onGift(dialogState._game?.world, dialogState._game?.player, dialogState._npc, { healed: !!nursed });
    if (dialogState._game.player) dialogState._game.player.karma = (dialogState._game.player.karma || 0) + 1;

    const responses = {
        beggar:   `*clutches the ${displayName}* You... you\'re saving my life.`,
        merchant: `${displayName}? I can certainly find a use for this. Thank you!`,
        child:    `*eyes go wide* For ME?! Thank you thank you thank you!`,
    };
    let responseText = responses[npcType] || `*accepts the ${displayName}* How thoughtful of you. Thank you.`;
    if (nursed) responseText = nursed.text;
    if (giftResult.forgiven) responseText += ' ...All right. Let\'s forget about those threats.';

    dialogState._lines.push({ speaker: 'You', text: `*gives ${displayName}*`, isNpc: false, _action: 'give_gift' });
    dialogState._lines.push({ speaker: dialogState._npc.name, icon: dialogState._npc.icon, text: responseText, isNpc: true, _action: 'give_gift' });
    dialogState._lineIndex = dialogState._lines.length - 1;

    _animateDispositionChange(boost);
    _render();

    if (dialogState._game?.player?.modifyNeed) dialogState._game.player.modifyNeed('social', 5);
}

export function _showAskAboutSubmenu() {
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;

    const knownNpcs = NpcFamily.getKnownNpcs(dialogState._npc, InnerMap.npcs || []);
    const choices = [];

    for (const entry of knownNpcs.slice(0, 8)) {
        const other = entry.npc;
        const bondLabel = entry.familyBond
            ? NpcFamily.getFamilyBondLabel(dialogState._npc, other)
            : null;
        const opinionLabel = NpcFamily.getOpinionLabel(entry.score);

        let label = other.fullName || other.name;
        if (bondLabel) label += ` <span class="npc-dialog-bond">${bondLabel}</span>`;

        choices.push({
            icon: other.icon || '👤', label, group: 'people', cls: 'npc-dialog-ask-about',
            extra: `<span class="npc-dialog-ask-opinion" style="color:${opinionLabel.color}">${opinionLabel.icon} ${opinionLabel.label}</span>`,
            tooltip: `${dialogState._npc.name} thinks of ${other.name}: ${opinionLabel.label} (${entry.score}).`,
            onPick: () => _askAbout(entry),
        });
    }

    const back = () => _backFromSubmenu(box);
    choices.push({ icon: '↩️', label: 'Never mind.', group: 'leave', onPick: back });
    _renderChoiceList(choicesEl, choices, { back, hint: 'Who do you want to hear about?' });
}

function _askAbout(entry) {
    const other = entry.npc;
    const gossip = NpcFamily.getGossipAbout(dialogState._npc, other);

    // Family bond gives extra flavor
    let fullResponse = gossip;
    if (entry.familyBond) {
        const familyPrefix = entry.familyBond === 'spouse'
            ? `That\'s my ${other.gender === 'female' ? 'wife' : 'husband'}! `
            : entry.familyBond === 'child'
            ? `That\'s my ${other.gender === 'female' ? 'daughter' : 'son'}. `
            : entry.familyBond === 'parent'
            ? `That\'s my ${other.gender === 'female' ? 'mother' : 'father'}. `
            : entry.familyBond === 'sibling'
            ? `That\'s my ${other.gender === 'female' ? 'sister' : 'brother'}. `
            : '';
        fullResponse = familyPrefix + gossip;
    }

    dialogState._lines.push({
        speaker: 'You', text: `What can you tell me about ${other.name}?`,
        isNpc: false, _action: 'ask_about_npc',
    });
    dialogState._lines.push({
        speaker: dialogState._npc.name, icon: dialogState._npc.icon, text: fullResponse,
        isNpc: true, _action: 'ask_about_npc',
    });
    dialogState._lineIndex = dialogState._lines.length - 1;

    // Small disposition boost for showing interest
    const gain = NpcDisposition.adjustDisposition(dialogState._npc, 2);
    _animateDispositionChange(gain);

    // Social need boost
    if (dialogState._game?.player?.modifyNeed) dialogState._game.player.modifyNeed('social', 4);

    // Apply social ripple
    NpcFamily.applySocialRipple(dialogState._npc, 2, InnerMap.npcs || []);

    _render();
}

// What the seal reads for each skill check
const SEAL_WORDS = {
    Stealth: ['Unseen', 'Caught'],
    Charm: ['Charmed', 'Unmoved'],
    Intimidate: ['Cowed', 'Defied'],
    Persuade: ['Convinced', 'Refused'],
};

export function _showSkillCheckResult(success, skillName) {
    if (!dialogState._overlay) return;
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    if (!box) return;
    const words = SEAL_WORDS[skillName] || ['Success', 'Failed'];
    const seal = document.createElement('div');
    seal.className = `npc-dialog-skill-result ${success ? 'npc-dialog-skill-success' : 'npc-dialog-skill-fail'}`;
    seal.innerHTML = `<span class="npc-dialog-seal-skill">${skillName}</span>`
        + `<span class="npc-dialog-seal-word">${success ? words[0] : words[1]}</span>`;
    box.appendChild(seal);
    box.classList.remove('npc-dialog-shake', 'npc-dialog-glow');
    void box.offsetWidth; // restart the animation
    box.classList.add(success ? 'npc-dialog-glow' : 'npc-dialog-shake');
    setTimeout(() => seal.remove(), 2200);
}

// Circumference of the mood ring (r = 54 in a 120 viewBox)
const RING_C = 2 * Math.PI * 54;

function _paintMood(disposition) {
    const overlay = dialogState._overlay;
    if (!overlay) return null;
    const disp = _dispositionLabel(disposition);
    overlay.style.setProperty('--mood', disp.color);
    const ring = overlay.querySelector('.npc-dialog-disposition-fill');
    if (ring) ring.style.strokeDashoffset = `${RING_C * (1 - Math.max(0, Math.min(100, disposition)) / 100)}`;
    const label = overlay.querySelector('.npc-dialog-disposition-label');
    if (label) label.innerHTML = `${disp.icon} ${disp.text}`;
    const value = overlay.querySelector('.npc-dialog-disposition-value');
    if (value) value.textContent = `${Math.round(disposition)}`;
    return disp;
}

export function _animateDispositionChange(amount) {
    if (!dialogState._overlay || !amount) return;
    const mem = _mem(dialogState._npc);
    _paintMood(mem.disposition);

    // Float the change off the portrait and pulse the ring
    const portrait = dialogState._overlay.querySelector('.npc-dialog-portrait');
    if (!portrait) return;
    const change = document.createElement('span');
    change.className = `npc-dialog-disp-change ${amount > 0 ? 'is-up' : 'is-down'}`;
    change.textContent = amount > 0 ? `+${amount}` : `${amount}`;
    portrait.appendChild(change);
    portrait.classList.remove('pulse-up', 'pulse-down');
    void portrait.offsetWidth;
    portrait.classList.add(amount > 0 ? 'pulse-up' : 'pulse-down');
    setTimeout(() => change.remove(), 1600);
}

export function _updateDispositionBar() {
    if (!dialogState._overlay || !dialogState._npc) return;
    _paintMood(_mem(dialogState._npc).disposition);
}

function _cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

export function _createOverlay() {
    const npc = dialogState._npc;
    const mem = _mem(npc);
    const disp = _dispositionLabel(mem.disposition);
    const typeName = (InnerMap.NPC_TYPES[npc.type] || {}).name || npc.type;

    // Family info for the side panel
    const familyTag = NpcFamily.getFamilyTagline(npc, InnerMap.npcs || []);
    const displayName = npc.fullName || npc.name;

    // Relationship level from combined score
    const playerStatus = dialogState._game?.player
        ? NpcFamily.getPlayerNpcStatus(dialogState._game.player, npc)
        : null;
    const relLevel = playerStatus?.level;

    const role = npc.roleTitle ? _cap(npc.roleTitle) : typeName;
    const subtitle = [
        role,
        npc.age != null ? `age ${npc.age}` : '',
        npc.gender ? (npc.gender === 'female' ? '♀' : '♂') : '',
    ].filter(Boolean).join(' · ');
    const settlement = _getSettlement();
    const where = [settlement?.name, _cap(_getTimeOfDay())].filter(Boolean).join(' · ');
    const traits = (npc.personalityTraits || []).map(t => `<span class="npc-dialog-trait">${_cap(t)}</span>`).join('');
    const met = mem.timesSpoken > 1 ? `Spoken ${mem.timesSpoken} times` : 'First meeting';

    const overlay = document.createElement('div');
    overlay.id = 'npcDialogOverlay';
    overlay.style.setProperty('--mood', disp.color);

    overlay.innerHTML = `
        <div class="npc-dialog-backdrop"></div>
        <div class="npc-dialog-letterbox top"></div>
        <div class="npc-dialog-letterbox bottom"></div>
        <div class="npc-dialog-box">
            <aside class="npc-dialog-side">
                <div class="npc-dialog-portrait">
                    <svg class="npc-dialog-ring" viewBox="0 0 120 120" aria-hidden="true">
                        <circle class="npc-dialog-ring-track" cx="60" cy="60" r="54"></circle>
                        <circle class="npc-dialog-disposition-fill" cx="60" cy="60" r="54"
                            stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"></circle>
                    </svg>
                    <div class="npc-dialog-portrait-frame">
                        <canvas class="npc-dialog-portrait-canvas" width="144" height="144"></canvas>
                        <span class="npc-dialog-portrait-icon">${npc.icon}</span>
                    </div>
                    <span class="npc-dialog-portrait-badge" title="${typeName}">${npc.icon}</span>
                </div>
                <div class="npc-dialog-mood" title="How ${npc.name} feels about you">
                    <span class="npc-dialog-disposition-label">${disp.icon} ${disp.text}</span>
                    <span class="npc-dialog-disposition-value">${mem.disposition}</span>
                </div>
                <div class="npc-dialog-facts">
                    ${relLevel ? `<div class="npc-dialog-rel-badge" style="color:${relLevel.color}" title="Relationship">${relLevel.icon} ${relLevel.label}</div>` : ''}
                    <div class="npc-dialog-visits">🗣️ ${met}</div>
                    ${familyTag ? `<div class="npc-dialog-family-tag" title="${familyTag}">${familyTag}</div>` : ''}
                    ${traits ? `<div class="npc-dialog-traits">${traits}</div>` : ''}
                </div>
            </aside>
            <section class="npc-dialog-main">
                <header class="npc-dialog-header">
                    <div class="npc-dialog-header-info">
                        <div class="npc-dialog-name">${displayName}</div>
                        <div class="npc-dialog-title">${subtitle}${where ? `<span class="npc-dialog-where">${where}</span>` : ''}</div>
                    </div>
                    <button class="npc-dialog-close" title="End conversation (Esc)">✕</button>
                </header>
                <div class="npc-dialog-body npc-dialog-transcript"></div>
                <div class="npc-dialog-choices"></div>
                <div class="npc-dialog-hint"></div>
            </section>
        </div>
    `;

    // Close button and backdrop end the conversation at once
    overlay.querySelector('.npc-dialog-close').addEventListener('click', () => NpcDialog.close());
    overlay.querySelector('.npc-dialog-backdrop').addEventListener('click', () => NpcDialog.close());

    const skip = () => {
        if (dialogState._typewriteComplete) return false;
        const textEl = overlay.querySelector('.npc-dialog-text');
        const line = dialogState._lines[dialogState._lineIndex];
        if (textEl && line) _skipTypewrite(textEl, line.text);
        return true;
    };
    overlay.querySelector('.npc-dialog-transcript').addEventListener('click', skip);

    // Keys: 1–9 choose, Esc backs out / says farewell / leaves, Space & Enter hurry the speaker
    overlay._escHandler = (e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        // Typing (free talk's box): the keys are the player's words, not the dialog's
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (overlay._back) overlay._back();
            else if (overlay._escChoice && !overlay._closing) overlay._escChoice();
            else NpcDialog.close();
            return;
        }
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            skip();
            return;
        }
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9) {
            e.preventDefault();
            e.stopPropagation();
            const fn = overlay._hotkeys && overlay._hotkeys[n];
            if (fn) fn();
        }
    };
    window.addEventListener('keydown', overlay._escHandler, true);

    document.body.appendChild(overlay);

    // The NPC's own sprite, breathing; the emoji stands in until it loads
    NpcPortrait.mount(overlay.querySelector('.npc-dialog-portrait-canvas'), npc,
        overlay.querySelector('.npc-dialog-portrait-icon'));
    // Sweep the mood ring up to where it stands
    requestAnimationFrame(() => _paintMood(mem.disposition));
    return overlay;
}
