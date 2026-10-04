// npcDialog — choices functions.
import { InnerMap } from '../../world/innerMap.js';
import { ActionMenu } from '../actionMenu.js';
import { NpcFamily } from '../../systems/npcFamily.js';
import { Quests } from '../../systems/quests.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { Gossip } from '../../systems/gossip.js';
import { GREETINGS, RETURNING_GREETINGS, RESPECTFUL_GREETINGS, HOSTILE_GREETINGS, RUMORS, FAREWELLS, THREAT_RESPONSES, THREAT_SUCCESS, FLATTER_RESPONSES, FLATTER_SUCCESS, TIME_COMMENTS, WEATHER_COMMENTS, NPC_QUEST_HOOKS, LOCATION_INFO, KINGDOM_INFO } from '../npcDialog.data.js';
import { dialogState } from './shared.js';
import { NpcDialog } from './index.js'; // call-time facade ref (ESM cycle-safe)
import { _mem, _dispositionLabel, _pick, _getTimeOfDay, _getWeather, _getSettlement, _getKingdom, _skillCheck, _getAttributeBonus, _getSkillTotal, _getPlayerTitle, _isPlayerRenowned, _getGreeting, _getRumor, _getFarewell } from './helpers.js';
import { _buildConversation, _render, _typewrite, _skipTypewrite, _renderChoices, _hasGiftableInventory } from './render.js';

export function _handleChoice(action) {
    const npcType = dialogState._npc.type || 'villager';
    const mem = _mem(dialogState._npc);

    // Build player line text
    const labelMap = {
        ask_rumor: 'What news do you have?',
        ask_location: 'Tell me about this place.',
        ask_kingdom: _getKingdom() ? `What do you know about ${_getKingdom().name}?` : 'What do you know about the kingdom?',
        ask_family: 'Tell me about your family.',
        ask_about_npc: 'What do you think of the people here?',
        trade: 'Show me your wares.',
        ask_quest: 'Do you need any help?',
        give_gift: 'I have something for you.',
        flatter: 'You seem wise — tell me more.',
        threat: 'Watch your tongue.',
        persuade: 'I need your trust on something important.',
        farewell: 'Farewell.',
    };

    const playerText = labelMap[action] || action;
    dialogState._lines.push({ speaker: 'You', text: playerText, isNpc: false, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;

    // Show player line briefly
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (choicesEl) choicesEl.innerHTML = '';

    const speakerEl = box.querySelector('.npc-dialog-speaker');
    const textEl = box.querySelector('.npc-dialog-text');
    if (speakerEl) { speakerEl.textContent = '🧑 You'; speakerEl.style.color = '#4FC3F7'; }
    if (textEl) { _skipTypewrite(textEl, ''); textEl.textContent = playerText; }

    setTimeout(() => {
        let responseText;
        let shouldClose = false;
        let dispositionChange = 0;
        let skillGains = null;

        switch (action) {
            case 'ask_rumor': {
                responseText = _getRumor(npcType);
                mem.rumorsTold++;
                dispositionChange = 2; // Sharing gossip builds minor rapport
                // Slight social need boost
                if (dialogState._game?.player?.modifyNeed) dialogState._game.player.modifyNeed('social', 3);
                break;
            }

            case 'ask_location': {
                const pool = LOCATION_INFO[npcType] || LOCATION_INFO.villager;
                responseText = _pick(pool);
                // Add settlement-specific info if available
                const settlement = _getSettlement();
                if (settlement) {
                    responseText += ` This is ${settlement.name}, a ${settlement.type || 'settlement'} with about ${settlement.population || '??'} souls.`;
                }
                dispositionChange = 1;
                break;
            }

            case 'ask_kingdom': {
                const kingdom = _getKingdom();
                if (kingdom) {
                    const pool = KINGDOM_INFO[npcType] || KINGDOM_INFO.villager;
                    let template = _pick(pool);
                    // Fill in template
                    template = template
                        .replace(/\{kingdom\}/g, kingdom.name || 'the realm')
                        .replace(/\{ruler\}/g, kingdom.ruler?.name || 'the ruler')
                        .replace(/\{quality\}/g, _pick(['fair', 'decent', 'troubled', 'prosperous', 'uncertain']))
                        .replace(/\{tariff\}/g, _pick(['high', 'moderate', 'low', 'outrageous']))
                        .replace(/\{resource\}/g, _pick(['grain', 'iron', 'timber', 'wool', 'fish']))
                        .replace(/\{strength\}/g, _pick(['formidable', 'modest', 'fearsome', 'growing', 'declining']))
                        .replace(/\{activity\}/g, _pick(['active', 'lax', 'doubled', 'reduced']))
                        .replace(/\{stance\}/g, _pick(['friendly', 'neutral', 'suspicious', 'hostile']))
                        .replace(/\{crop\}/g, _pick(['wheat', 'barley', 'corn', 'grapes']))
                        .replace(/\{religion\}/g, _pick(['the old gods', 'the divine light', 'the earth spirits', 'many faiths']))
                        .replace(/\{hospitality\}/g, _pick(['welcoming', 'wary of strangers', 'generous', 'cold']))
                        .replace(/\{landmark\}/g, _pick(['ancient ruins', 'a grand temple', 'towering mountains', 'vast forests']));
                    responseText = template;
                    // Grant kingdom knowledge
                    if (dialogState._game?.player?.learnAboutKingdom) {
                        const categories = npcType === 'noble' ? ['basics', 'ruler', 'diplomacy'] :
                            npcType === 'guard' ? ['basics', 'military'] :
                            npcType === 'merchant' ? ['basics', 'economy'] :
                            npcType === 'priest' ? ['basics', 'religion'] :
                            ['basics'];
                        dialogState._game.player.learnAboutKingdom(kingdom.id, categories);
                    }
                    dispositionChange = 2;
                } else {
                    responseText = 'I\'m afraid I don\'t know much about the wider politics.';
                }
                break;
            }

            case 'ask_family': {
                const allNpcs = InnerMap.npcs || [];
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
                const result = game && game.player ? Quests.createNpcTask(game.player, hook, npc) : { success: false };
                if (!result.success && result.reason && result.reason.startsWith('Too many')) {
                    // Keep the offer open — the player can come back once they've room.
                    responseText = "You look stretched thin already. Come back when you've time for me.";
                    break;
                }
                mem.pendingHook = null;
                mem.questAccepted = true;
                responseText = 'Thank you! I knew I could count on someone like you.';
                dispositionChange = 10;
                if (result.success && game?.ui?.showNotification) {
                    const q = result.quest;
                    setTimeout(() => {
                        game.ui.showNotification('📜 Task Accepted', `${q.title}: ${q.objectives[0].text}. Reward: ${Quests.describeRewards(q.rewards)}.`, 'success');
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
                const difficulty = 3;
                const success = _skillCheck('diplomacy', difficulty);
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
                const difficulty = 5;
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
                dialogState._game.player.skills[skill] = (dialogState._game.player.skills[skill] || 0) + xp;
                if (dialogState._game?.ui?.showNotification) {
                    dialogState._game.ui.showNotification('📈 Skill Up', `${skill.charAt(0).toUpperCase() + skill.slice(1)} +${xp}`, 'success');
                }
            }
        }

        // Add NPC response
        const npcLine = { speaker: dialogState._npc.name, icon: dialogState._npc.icon, text: responseText, isNpc: true, _action: action };
        dialogState._lines.push(npcLine);
        dialogState._lineIndex = dialogState._lines.length - 1;
        _render();

        // Auto-close after farewell or trade redirect
        if (shouldClose) {
            setTimeout(() => {
                const game = dialogState._game;
                const npc = dialogState._npc;
                NpcDialog.close();
                if (shouldClose === 'trade' && game) {
                    if (npc && npc.shopInventory && Object.keys(npc.shopInventory).length > 0) {
                        ActionMenu.showNpcTradeMenu(game, npc);
                    } else {
                        const worldTile = game.world ? game.world.getTile(game.player.q, game.player.r) : null;
                        if (worldTile) ActionMenu.showTradeMenu(game, worldTile);
                    }
                }
            }, 1800);
        }
    }, 500);
}

export function _showGiftSubmenu() {
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    choicesEl.innerHTML = '';

    const mem = _mem(dialogState._npc);

    // Gold gift options
    const goldAmounts = [5, 25, 100];
    const playerGold = dialogState._game?.player?.gold || 0;

    for (const amount of goldAmounts) {
        if (playerGold >= amount) {
            const btn = document.createElement('button');
            btn.className = 'npc-dialog-choice npc-dialog-gift';
            btn.innerHTML = `<span class="npc-dialog-choice-icon">💰</span> Give ${amount} gold`;
            btn.addEventListener('click', () => _giveGoldGift(amount));
            choicesEl.appendChild(btn);
        }
    }

    // Inventory item gifts
    if (dialogState._game?.player?.inventory) {
        const items = Object.entries(dialogState._game.player.inventory).filter(([, qty]) => qty > 0);
        for (const [itemId, qty] of items.slice(0, 4)) { // Show up to 4 items
            const btn = document.createElement('button');
            btn.className = 'npc-dialog-choice npc-dialog-gift';
            const displayName = itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            btn.innerHTML = `<span class="npc-dialog-choice-icon">📦</span> Give ${displayName} (×${qty})`;
            btn.addEventListener('click', () => _giveItemGift(itemId));
            choicesEl.appendChild(btn);
        }
    }

    // Cancel
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'npc-dialog-choice';
    cancelBtn.innerHTML = `<span class="npc-dialog-choice-icon">↩️</span> Never mind.`;
    cancelBtn.addEventListener('click', () => {
        // Re-render normal choices
        dialogState._lineIndex = dialogState._lines.length - 1;
        // Go back to last NPC line
        for (let i = dialogState._lines.length - 1; i >= 0; i--) {
            if (dialogState._lines[i].isNpc) { dialogState._lineIndex = i; break; }
        }
        _renderChoices(box);
    });
    choicesEl.appendChild(cancelBtn);
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

    boost = NpcDisposition.adjustDisposition(dialogState._npc, boost, dialogState._game?.player);
    const giftResult = NpcDisposition.recordGift(dialogState._npc, dialogState._game?.player);
    if (dialogState._game.player) dialogState._game.player.karma = (dialogState._game.player.karma || 0) + 1;

    const responses = {
        beggar:   `*clutches the ${displayName}* You... you\'re saving my life.`,
        merchant: `${displayName}? I can certainly find a use for this. Thank you!`,
        child:    `*eyes go wide* For ME?! Thank you thank you thank you!`,
    };
    let responseText = responses[npcType] || `*accepts the ${displayName}* How thoughtful of you. Thank you.`;
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
    choicesEl.innerHTML = '';

    const knownNpcs = NpcFamily.getKnownNpcs(dialogState._npc, InnerMap.npcs || []);

    // Show each known NPC as a button
    for (const entry of knownNpcs.slice(0, 6)) { // Max 6 options
        const other = entry.npc;
        const bondLabel = entry.familyBond
            ? NpcFamily.getFamilyBondLabel(dialogState._npc, other)
            : null;

        const opinionLabel = NpcFamily.getOpinionLabel(entry.score);

        const btn = document.createElement('button');
        btn.className = 'npc-dialog-choice npc-dialog-ask-about';

        let label = other.fullName || other.name;
        if (bondLabel) label += ` (${bondLabel})`;

        btn.innerHTML = `<span class="npc-dialog-choice-icon">${opinionLabel.icon}</span> `
            + `<span class="npc-dialog-ask-name">${label}</span>`
            + `<span class="npc-dialog-ask-opinion" style="color:${opinionLabel.color}">${opinionLabel.label}</span>`;

        btn.title = `${dialogState._npc.name}'s opinion: ${opinionLabel.label} (${entry.score})`;

        btn.addEventListener('click', () => {
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
        });
        choicesEl.appendChild(btn);
    }

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'npc-dialog-choice';
    cancelBtn.innerHTML = `<span class="npc-dialog-choice-icon">↩️</span> Never mind.`;
    cancelBtn.addEventListener('click', () => {
        for (let i = dialogState._lines.length - 1; i >= 0; i--) {
            if (dialogState._lines[i].isNpc) { dialogState._lineIndex = i; break; }
        }
        _renderChoices(box);
    });
    choicesEl.appendChild(cancelBtn);
}

export function _showSkillCheckResult(success, skillName) {
    if (!dialogState._overlay) return;
    const flash = document.createElement('div');
    flash.className = `npc-dialog-skill-result ${success ? 'npc-dialog-skill-success' : 'npc-dialog-skill-fail'}`;
    flash.textContent = success ? `✓ ${skillName} Success!` : `✗ ${skillName} Failed`;
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    if (box) {
        box.appendChild(flash);
        setTimeout(() => flash.remove(), 2000);
    }
}

export function _animateDispositionChange(amount) {
    if (!dialogState._overlay) return;
    const bar = dialogState._overlay.querySelector('.npc-dialog-disposition-fill');
    const label = dialogState._overlay.querySelector('.npc-dialog-disposition-label');
    if (!bar || !label) return;

    const mem = _mem(dialogState._npc);
    const disp = _dispositionLabel(mem.disposition);

    // Animate bar
    bar.style.width = `${mem.disposition}%`;
    bar.style.background = disp.color;

    // Update label
    label.textContent = `${disp.icon} ${disp.text}`;
    label.style.color = disp.color;

    // Flash the change amount
    const change = document.createElement('span');
    change.className = 'npc-dialog-disp-change';
    change.textContent = amount > 0 ? `+${amount}` : `${amount}`;
    change.style.color = amount > 0 ? '#66BB6A' : '#EF5350';
    label.parentElement.appendChild(change);
    setTimeout(() => change.remove(), 1500);
}

export function _updateDispositionBar() {
    if (!dialogState._overlay || !dialogState._npc) return;
    const mem = _mem(dialogState._npc);
    const disp = _dispositionLabel(mem.disposition);
    const bar = dialogState._overlay.querySelector('.npc-dialog-disposition-fill');
    const label = dialogState._overlay.querySelector('.npc-dialog-disposition-label');
    if (bar) {
        bar.style.width = `${mem.disposition}%`;
        bar.style.background = disp.color;
    }
    if (label) {
        label.textContent = `${disp.icon} ${disp.text}`;
        label.style.color = disp.color;
    }
}

export function _createOverlay() {
    const mem = _mem(dialogState._npc);
    const disp = _dispositionLabel(mem.disposition);
    const typeName = (InnerMap.NPC_TYPES[dialogState._npc.type] || {}).name || dialogState._npc.type;

    // Family info for header
    const familyTag = NpcFamily.getFamilyTagline(dialogState._npc, InnerMap.npcs || []);
    const displayName = dialogState._npc.fullName || dialogState._npc.name;

    // Relationship level from combined score
    const playerStatus = dialogState._game?.player
        ? NpcFamily.getPlayerNpcStatus(dialogState._game.player, dialogState._npc)
        : null;
    const relLevel = playerStatus?.level;

    const overlay = document.createElement('div');
    overlay.id = 'npcDialogOverlay';

    overlay.innerHTML = `
        <div class="npc-dialog-backdrop"></div>
        <div class="npc-dialog-box">
            <div class="npc-dialog-header">
                <div class="npc-dialog-portrait">
                    <span class="npc-dialog-portrait-icon">${dialogState._npc.icon}</span>
                </div>
                <div class="npc-dialog-header-info">
                    <div class="npc-dialog-name">${displayName}</div>
                    <div class="npc-dialog-title">${typeName}${dialogState._npc.age ? `, Age ${dialogState._npc.age}` : ''}${dialogState._npc.gender ? ` · ${dialogState._npc.gender === 'female' ? '♀' : '♂'}` : ''}</div>
                    ${familyTag ? `<div class="npc-dialog-family-tag">${familyTag}</div>` : ''}
                    <div class="npc-dialog-meta">
                        ${relLevel ? `<span class="npc-dialog-rel-badge" style="color:${relLevel.color}" title="Relationship: ${relLevel.label}">${relLevel.icon} ${relLevel.label}</span>` : ''}
                        ${mem.timesSpoken > 1 ? `<span class="npc-dialog-visits" title="Times spoken">🗣️ ×${mem.timesSpoken}</span>` : ''}
                        ${dialogState._npc.personalityTraits?.length > 0 ? `<span class="npc-dialog-traits" title="Personality">${dialogState._npc.personalityTraits.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')}</span>` : ''}
                    </div>
                </div>
                <button class="npc-dialog-close" title="End conversation">✕</button>
            </div>
            <div class="npc-dialog-disposition-bar-container">
                <div class="npc-dialog-disposition-track">
                    <div class="npc-dialog-disposition-fill" style="width:${mem.disposition}%;background:${disp.color};"></div>
                </div>
                <div class="npc-dialog-disposition-label" style="color:${disp.color};">${disp.icon} ${disp.text}</div>
            </div>
            <div class="npc-dialog-body">
                <div class="npc-dialog-speaker"></div>
                <div class="npc-dialog-text"></div>
            </div>
            <div class="npc-dialog-choices"></div>
        </div>
    `;

    // Close button
    overlay.querySelector('.npc-dialog-close').addEventListener('click', () => NpcDialog.close());

    // Clicking backdrop closes
    overlay.querySelector('.npc-dialog-backdrop').addEventListener('click', () => NpcDialog.close());

    // Click on dialog body to skip typewriter
    const body = overlay.querySelector('.npc-dialog-body');
    if (body) {
        body.style.cursor = 'pointer';
        body.addEventListener('click', () => {
            if (!dialogState._typewriteComplete) {
                const textEl = overlay.querySelector('.npc-dialog-text');
                const line = dialogState._lines[dialogState._lineIndex];
                if (textEl && line) _skipTypewrite(textEl, line.text);
            }
        });
    }

    // ESC key closes, Space/Enter skips typewriter
    overlay._escHandler = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); NpcDialog.close(); }
        if ((e.key === ' ' || e.key === 'Enter') && !dialogState._typewriteComplete) {
            e.preventDefault();
            e.stopPropagation();
            const textEl = overlay.querySelector('.npc-dialog-text');
            const line = dialogState._lines[dialogState._lineIndex];
            if (textEl && line) _skipTypewrite(textEl, line.text);
        }
    };
    window.addEventListener('keydown', overlay._escHandler, true);

    document.body.appendChild(overlay);
    return overlay;
}
