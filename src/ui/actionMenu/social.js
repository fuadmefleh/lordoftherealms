// ActionMenu — social methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, House, Schemes, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, InnerMapRenderer } from './_imports.js';

Object.assign(ActionMenu, {
    // ============================================
    // RELATIONSHIPS — Meet People, Courting, Family, Dynasty
    // ============================================
    /**
     * Show the Meet People menu — browse NPCs at this settlement
     */
    showMeetPeopleMenu(game, tile) {
        if (!tile.settlement) return;
        if (typeof Relationships === 'undefined') {
            game.ui.showNotification('Unavailable', 'Relationship system not loaded.', 'error');
            return;
        }

        const player = game.player;
        const npcs = Relationships.getNPCsAtSettlement(tile, game.world);
        const personalities = Relationships._getPersonalities();

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">👥 Meet People</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">People of <strong>${tile.settlement.name}</strong>. Open a character profile to interact, build relationships, and invite companions.</p>`;

        if (npcs.length === 0) {
            html += '<p style="color: #aaa;">Nobody interesting around right now.</p>';
        }

        for (const npc of npcs) {
            const rel = Relationships.getRelationship(player, npc.id);
            const relLabel = Relationships.getRelationLabel(rel.score);
            const personality = personalities[npc.personality] || { label: 'Unknown', icon: '❓' };
            const stage = rel.romantic ? Relationships.getCourtingStage(rel.affection, npc.isMarried && player.spouse === npc.id) : null;
            const level = Relationships.getRelationshipLevel(rel.score || 0);
            const inParty = Relationships.isInTravelParty(player, npc.id);

            const genderIcon = npc.gender === 'male' ? '♂️' : '♀️';
            const marriedTag = (player.spouse === npc.id) ? ' <span style="color: #ff69b4;">💍 Your Spouse</span>' : '';
            const partyTag = inParty ? ' <span style="color: #6cf;">🧭 Traveling With You</span>' : '';

            html += `<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid ${rel.score >= 30 ? '#4a4' : rel.score <= -30 ? '#a44' : '#666'};">`;
            html += `<div style="display: flex; justify-content: space-between; align-items: center;">`;
            html += `<div>`;
            html += `<strong>${npc.firstName} ${npc.dynasty}</strong> ${genderIcon}${marriedTag}${partyTag}`;
            html += `<div style="font-size: 11px; color: #aaa;">Age ${npc.age} · ${npc.occupation} · ${personality.icon} ${personality.label}</div>`;
            html += `<div style="font-size: 11px; color: #888;">${npc.appearance.hair} hair, ${npc.appearance.eyes} eyes, ${npc.appearance.build}</div>`;
            html += `</div>`;
            html += `<div style="text-align: right; font-size: 11px;">`;
            html += `<div>${relLabel.icon} ${relLabel.label} (${rel.score})</div>`;
            html += `<div style="color: #999;">${level.icon} ${level.label}</div>`;
            if (stage) {
                html += `<div style="color: #ff69b4;">${stage.icon} ${stage.label} (${rel.affection})</div>`;
            }
            html += `</div>`;
            html += `</div>`;

            html += `<div style="margin-top: 8px; display: flex; gap: 6px;">`;
            html += `<button onclick="window._openCharacterFromMeet('${npc.id}')" style="padding: 6px 10px; background: #445; border: none; border-radius: 4px; cursor: pointer; color: #dde; font-size: 11px;">📇 Character Profile</button>`;
            html += `</div>`;

            html += `</div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('Meet People', html);

        window._openCharacterFromMeet = (npcId) => {
            ActionMenu.showCharacterDataModal(game, tile, npcId, { returnTo: 'meet' });
        };
    },

    showCharacterDataModal(game, tile, npcId, options = {}) {
        if (typeof Relationships === 'undefined') return;

        const player = game.player;
        const npc = Relationships.getNPC(npcId);
        if (!npc || !npc.isAlive) {
            game.ui.showNotification('Unavailable', 'This character is no longer available.', 'warning');
            return;
        }

        const rel = Relationships.getRelationship(player, npcId);
        const relLabel = Relationships.getRelationLabel(rel.score || 0);
        const level = Relationships.getRelationshipLevel(rel.score || 0);
        const personalities = Relationships._getPersonalities();
        const personality = personalities[npc.personality] || { label: 'Unknown', icon: '❓' };
        const isSpouse = player.spouse === npcId;
        const stage = rel.romantic ? Relationships.getCourtingStage(rel.affection || 0, isSpouse) : null;
        const inParty = Relationships.isInTravelParty(player, npcId);

        const socialActions = Relationships.getSocialActionAvailability(player, npcId);
        const courtActions = Relationships.getCourtActionAvailability(player, npcId);

        const renderRelationshipActionButton = (action, kind) => {
            const unlocked = !!action.unlocked;
            const clickHandler = kind === 'social' ? '_characterSocialAction' : '_characterCourtAction';
            const goldText = action.cost ? `, ${action.cost}g` : '';
            const apText = action.apCost != null ? `, ${action.apCost} AP` : '';
            const baseStyle = kind === 'social'
                ? 'background: #446; color: #ccc;'
                : 'background: #644; color: #fcc;';

            if (unlocked) {
                return `<button onclick="window.${clickHandler}('${npcId}', '${action.id}')" style="padding: 4px 8px; ${baseStyle} border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">${action.icon} ${action.label}${goldText}${apText}</button>`;
            }

            const reason = (action.lockReason || 'Locked').replace(/"/g, '&quot;');
            return `<button title="${reason}" disabled style="padding: 4px 8px; background: #333; border: 1px solid #555; border-radius: 3px; color: #777; cursor: not-allowed; font-size: 11px;">🔒 ${action.label}</button>`;
        };

        let html = '<div style="max-height: 520px; overflow-y: auto;">';
        html += `<h4 style="margin-top: 0;">📇 ${npc.firstName} ${npc.dynasty}</h4>`;
        html += `<div style="font-size: 12px; color: #aaa;">Age ${npc.age} · ${npc.occupation} · ${personality.icon} ${personality.label}</div>`;
        html += `<div style="font-size: 11px; color: #888; margin-bottom: 6px;">${npc.appearance.hair} hair, ${npc.appearance.eyes} eyes, ${npc.appearance.build}</div>`;

        html += `<div style="background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px; margin-bottom: 8px;">`;
        html += `<div style="font-size: 12px; margin-bottom: 4px;">${relLabel.icon} ${relLabel.label} (${rel.score || 0}) · ${level.icon} ${level.label}</div>`;
        html += ActionMenu._renderRelationshipXPBar(rel.score || 0, false);
        html += `<div style="margin-top: 6px; font-size: 12px; color: #ff69b4;">Affection: ${rel.affection || 0}${stage ? ` · ${stage.icon} ${stage.label}` : ''}</div>`;
        html += ActionMenu._renderAffectionBar(rel.affection || 0);
        html += `</div>`;

        html += `<div style="background: rgba(90,140,200,0.12); padding: 8px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(90,140,200,0.35);">`;
        html += `<div style="font-size: 12px; margin-bottom: 6px; color: #9cd;">🧭 Travel Party</div>`;
        if (inParty) {
            html += `<div style="font-size: 11px; color: #bcd; margin-bottom: 6px;">${npc.firstName} is currently traveling with you.</div>`;
            html += `<button onclick="window._removePartyMember('${npcId}')" style="padding: 5px 10px; background: #355; border: none; border-radius: 4px; cursor: pointer; color: #cde; font-size: 11px;">👋 Ask to Leave Party</button>`;
        } else {
            html += `<div style="font-size: 11px; color: #bcd; margin-bottom: 6px;">Ask this character to join your travel party.</div>`;
            html += `<button onclick="window._inviteToTravelParty('${npcId}')" style="padding: 5px 10px; background: #357; border: none; border-radius: 4px; cursor: pointer; color: #def; font-size: 11px;">🤝 Invite to Travel</button>`;
        }
        html += `</div>`;

        html += `<div style="margin-bottom: 6px; font-size: 12px; color: #ccc;">🗣️ Social Actions</div>`;
        html += `<div style="display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap;">`;
        for (const action of socialActions) {
            html += renderRelationshipActionButton(action, 'social');
        }
        html += `</div>`;

        html += `<div style="margin-bottom: 6px; font-size: 12px; color: #fcc;">💕 Romantic Actions</div>`;
        html += `<div style="display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap;">`;
        for (const action of courtActions) {
            html += renderRelationshipActionButton(action, 'court');
        }
        html += `</div>`;

        const lockedActions = [...socialActions, ...courtActions].filter(action => !action.unlocked);
        if (lockedActions.length > 0) {
            const lockHints = lockedActions.slice(0, 4).map(action => `• ${action.label}: ${action.lockReason}`).join('<br>');
            html += `<div style="margin-top: 6px; font-size: 10px; color: #888;">${lockHints}</div>`;
        }

        const backLabel = options.returnTo === 'relationships'
            ? 'Back to Relationships'
            : options.returnTo === 'travel_party'
                ? 'Back to Travel Party'
                : 'Back to Meet People';
        html += `<button onclick="window._backFromCharacterModal()" style="margin-top: 10px; width: 100%; padding: 8px; background: #444; border: none; border-radius: 4px; cursor: pointer; color: #ccc; font-size: 11px;">← ${backLabel}</button>`;
        html += '</div>';

        game.ui.showCustomPanel(`Character: ${npc.firstName}`, html);

        window._backFromCharacterModal = () => {
            if (options.returnTo === 'relationships') {
                ActionMenu.showRelationshipsMenu(game, tile);
            } else if (options.returnTo === 'travel_party') {
                ActionMenu.showTravelPartyMenu(game, tile);
            } else {
                ActionMenu.showMeetPeopleMenu(game, tile);
            }
        };

        window._inviteToTravelParty = (targetNpcId) => {
            const result = Relationships.requestJoinTravelParty(player, targetNpcId, game.world);
            if (!result.success) {
                game.ui.showNotification('Cannot Invite', result.reason, 'warning');
                return;
            }

            if (result.accepted) {
                game.ui.showNotification('🧭 Joined Party', `${result.npc.firstName} agrees to travel with you.`, 'success');
            } else {
                game.ui.showNotification('🙅 Declined', result.reason, 'warning');
            }

            game.ui.updateStats(player, game.world);
            ActionMenu.showCharacterDataModal(game, tile, targetNpcId, options);
        };

        window._removePartyMember = (targetNpcId) => {
            const result = Relationships.removeFromTravelParty(player, targetNpcId);
            if (!result.success) {
                game.ui.showNotification('Cannot Remove', result.reason, 'warning');
                return;
            }
            game.ui.showNotification('👋 Left Party', `${result.npc ? result.npc.firstName : 'Companion'} is no longer traveling with you.`, 'info');
            game.ui.updateStats(player, game.world);
            ActionMenu.showCharacterDataModal(game, tile, targetNpcId, options);
        };

        window._characterSocialAction = (targetNpcId, actionId) => {
            const socialDefs = Relationships._getSocialActions();
            const actionDef = socialDefs[actionId] || {};
            const availability = Relationships.getSocialActionAvailability(player, targetNpcId)
                .find(item => item.id === actionId);
            if (availability && !availability.unlocked) {
                game.ui.showNotification('🔒 Action Locked', availability.lockReason || 'This interaction is not unlocked yet.', 'warning');
                return;
            }

            const apCost = actionDef.apCost != null ? actionDef.apCost : 1;
            if ((player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ Not Enough AP', `This interaction requires ${apCost} AP but you only have ${player.actionPoints || 0}.`, 'error');
                return;
            }
            player.actionPoints -= apCost;

            const socialResult = Relationships.performSocialAction(player, targetNpcId, actionId);
            const targetNpc = Relationships.getNPC(targetNpcId);
            if (targetNpc) targetNpc.lastInteraction = game.world?.day || 0;

            if (socialResult.success) {
                const sign = socialResult.gain >= 0 ? '+' : '';
                let msg = `${socialResult.npc.firstName}: ${sign}${socialResult.gain} relationship.`;
                if (socialResult.skillUp) msg += ' Diplomacy improved!';
                game.ui.showNotification(socialResult.gain >= 0 ? '😊 Social' : '😤 Conflict', msg, socialResult.gain >= 0 ? 'success' : 'warning');
            } else if (socialResult.failed) {
                game.ui.showNotification('😬 Awkward', socialResult.reason, 'warning');
            } else {
                game.ui.showNotification('Error', socialResult.reason, 'error');
            }

            game.ui.updateStats(player, game.world);
            ActionMenu.showCharacterDataModal(game, tile, targetNpcId, options);
        };

        window._characterCourtAction = (targetNpcId, actionId) => {
            const courtDefs = Relationships._getCourtActions();
            const actionDef = courtDefs[actionId] || {};
            const availability = Relationships.getCourtActionAvailability(player, targetNpcId)
                .find(item => item.id === actionId);
            if (availability && !availability.unlocked) {
                game.ui.showNotification('🔒 Action Locked', availability.lockReason || 'This romantic interaction is not unlocked yet.', 'warning');
                return;
            }

            const apCost = actionDef.apCost != null ? actionDef.apCost : 1;
            if ((player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ Not Enough AP', `This interaction requires ${apCost} AP but you only have ${player.actionPoints || 0}.`, 'error');
                return;
            }
            player.actionPoints -= apCost;

            const courtResult = Relationships.performCourtAction(player, targetNpcId, actionId);
            const targetNpc = Relationships.getNPC(targetNpcId);
            if (targetNpc) targetNpc.lastInteraction = game.world?.day || 0;

            if (courtResult.success) {
                if (courtResult.married) {
                    const marryResult = Relationships.marry(player, targetNpcId, game.world);
                    if (marryResult.success) {
                        ActionMenu._showMarriageCelebration(game, marryResult.npc);
                        return;
                    }
                }
                let msg = `${courtResult.npc.firstName}: +${courtResult.gain} affection (${courtResult.stage.icon} ${courtResult.stage.label}).`;
                if (courtResult.charismaUp) msg += ' Charisma improved!';
                game.ui.showNotification('💕 Romance', msg, 'success');
            } else if (courtResult.failed) {
                game.ui.showNotification('💔 Rejected', courtResult.reason, 'warning');
            } else {
                game.ui.showNotification('Error', courtResult.reason, 'error');
            }

            game.ui.updateStats(player, game.world);
            ActionMenu.showCharacterDataModal(game, tile, targetNpcId, options);
        };
    },

    showTravelPartyMenu(game, tile) {
        if (typeof Relationships === 'undefined') return;

        const player = game.player;
        Relationships.ensureTravelParty(player);
        const party = Relationships.getTravelPartyMembers(player);

        const knownCandidates = Object.entries(player.relationships || {})
            .map(([npcId, rel]) => ({ npcId, rel, npc: Relationships.getNPC(npcId) }))
            .filter(entry => entry.npc && entry.npc.isAlive && !Relationships.isInTravelParty(player, entry.npcId))
            .sort((a, b) => ((b.rel.score || 0) + (b.rel.affection || 0) * 0.5) - ((a.rel.score || 0) + (a.rel.affection || 0) * 0.5));

        let html = '<div style="max-height: 520px; overflow-y: auto;">';
        html += '<h4 style="margin-top: 0;">🧭 Travel Party</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary);">Manage companions who travel with you and invite trusted contacts.</p>';

        html += `<div style="background: rgba(90,140,200,0.12); border: 1px solid rgba(90,140,200,0.35); padding: 8px; border-radius: 6px; margin-bottom: 8px; font-size: 12px; color: #bcd;">`;
        html += `Active companions: <strong style="color: #def;">${party.length}</strong>`;
        html += `</div>`;

        if (party.length === 0) {
            html += '<div style="padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.03); color: #aaa; font-size: 12px; margin-bottom: 8px;">No one is currently traveling with you.</div>';
        } else {
            html += '<h5 style="margin: 6px 0; color: #6cf;">Current Party</h5>';
            for (const npc of party) {
                const rel = Relationships.getRelationship(player, npc.id);
                const relation = Relationships.getRelationLabel(rel.score || 0);
                html += `<div style="background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px; margin-bottom: 6px;">`;
                html += `<div style="display: flex; justify-content: space-between; align-items: center;">`;
                html += `<div style="font-size: 12px;">🧭 <strong>${npc.firstName} ${npc.dynasty}</strong> · ${relation.icon} ${relation.label} (${rel.score || 0})</div>`;
                html += `<div style="display: flex; gap: 6px;">`;
                html += `<button onclick="window._partyOpenProfile('${npc.id}')" style="padding: 3px 8px; background: #355; border: none; border-radius: 3px; color: #cde; cursor: pointer; font-size: 10px;">Profile</button>`;
                html += `<button onclick="window._partyRemove('${npc.id}')" style="padding: 3px 8px; background: #533; border: none; border-radius: 3px; color: #ecc; cursor: pointer; font-size: 10px;">Remove</button>`;
                html += `</div>`;
                html += `</div>`;
                html += `</div>`;
            }
        }

        html += '<h5 style="margin: 8px 0 6px; color: #9ab;">Invite Known People</h5>';
        if (knownCandidates.length === 0) {
            html += '<div style="padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.03); color: #888; font-size: 11px;">No eligible contacts to invite right now.</div>';
        } else {
            for (const entry of knownCandidates.slice(0, 12)) {
                const relation = Relationships.getRelationLabel(entry.rel.score || 0);
                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; font-size: 12px; background: rgba(255,255,255,0.03); border-radius: 4px; margin-bottom: 4px;">`;
                html += `<span>${relation.icon} <strong>${entry.npc.firstName}</strong> (${entry.rel.score || 0})</span>`;
                html += `<div style="display: flex; gap: 6px;">`;
                html += `<button onclick="window._partyInvite('${entry.npcId}')" style="padding: 3px 8px; background: #357; border: none; border-radius: 3px; color: #def; cursor: pointer; font-size: 10px;">Invite</button>`;
                html += `<button onclick="window._partyOpenProfile('${entry.npcId}')" style="padding: 3px 8px; background: #444; border: none; border-radius: 3px; color: #ddd; cursor: pointer; font-size: 10px;">Profile</button>`;
                html += `</div>`;
                html += `</div>`;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Travel Party', html);

        window._partyOpenProfile = (npcId) => {
            ActionMenu.showCharacterDataModal(game, tile, npcId, { returnTo: 'travel_party' });
        };

        window._partyRemove = (npcId) => {
            const result = Relationships.removeFromTravelParty(player, npcId);
            if (!result.success) {
                game.ui.showNotification('Cannot Remove', result.reason, 'warning');
                return;
            }
            game.ui.showNotification('👋 Left Party', `${result.npc ? result.npc.firstName : 'Companion'} is no longer traveling with you.`, 'info');
            ActionMenu.showTravelPartyMenu(game, tile);
        };

        window._partyInvite = (npcId) => {
            const result = Relationships.requestJoinTravelParty(player, npcId, game.world);
            if (!result.success) {
                game.ui.showNotification('Cannot Invite', result.reason, 'warning');
                return;
            }

            if (result.accepted) {
                game.ui.showNotification('🧭 Joined Party', `${result.npc.firstName} agrees to travel with you.`, 'success');
            } else {
                game.ui.showNotification('🙅 Declined', result.reason, 'warning');
            }
            ActionMenu.showTravelPartyMenu(game, tile);
        };
    },

    /**
     * Handle the "Tell Stories" social interaction — provides meaningful world knowledge
     */
    _handleTellStories(game, player, npcId, tile) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) {
            game.ui.showNotification('Error', 'NPC not found.', 'error');
            return;
        }

        // Small relationship gain for sharing stories
        const rel = Relationships.getRelationship(player, npcId);
        const relGain = Utils.randInt(1, 3);
        rel.score = Math.max(-100, Math.min(100, rel.score + relGain));
        rel.history.push({ day: game.world?.day || 0, action: 'tell_stories', result: 'success', gain: relGain });

        // Track interaction
        npc.lastInteraction = game.world?.day || 0;

        // ── Determine what the NPC knows based on occupation ──
        const occupationKnowledge = {
            farmer:     ['peoples', 'basics'],
            blacksmith: ['economy', 'military'],
            merchant:   ['economy', 'diplomacy'],
            innkeeper:  ['basics', 'peoples', 'ruler'],
            guard:      ['military', 'basics'],
            soldier:    ['military', 'diplomacy'],
            healer:     ['peoples', 'religion'],
            priest:     ['religion', 'peoples'],
            scholar:    ['ruler', 'diplomacy', 'religion', 'economy'],
            noble:      ['ruler', 'diplomacy', 'military'],
            hunter:     ['basics', 'peoples'],
            fisher:     ['basics', 'economy'],
            miner:      ['economy', 'basics'],
            weaver:     ['economy', 'peoples'],
            baker:      ['basics', 'peoples'],
            tailor:     ['economy', 'peoples'],
            carpenter:  ['economy', 'basics'],
        };

        const npcOccupation = (npc.occupation || 'farmer').toLowerCase();
        const knowledgeCategories = occupationKnowledge[npcOccupation]
            || ['basics', 'peoples']; // fallback

        // Build results
        const outcomes = [];

        // ── 1. Kingdom Knowledge (always attempt if NPC has a kingdom) ──
        const npcKingdom = npc.kingdomId;
        if (npcKingdom) {
            // Pick a category the NPC would know about based on occupation
            const category = Utils.randPick(knowledgeCategories);
            const learned = player.learnAboutKingdom(npcKingdom, category);
            const kingdom = game.world.getKingdom(npcKingdom);
            const kName = kingdom ? kingdom.name : 'the kingdom';

            if (learned.length > 0) {
                // Generate flavor text based on category
                const flavorTexts = {
                    basics:    [`${npc.firstName} tells you about daily life in ${kName} — its people, customs, and traditions.`,
                                `"Let me tell you about ${kName}," ${npc.firstName} says, describing the land and its ways.`],
                    ruler:     [`${npc.firstName} shares gossip about ${kName}'s ruler — their temperament, decisions, and court.`,
                                `"The ruler of ${kName}..." ${npc.firstName} leans in conspiratorially, sharing what they know.`],
                    peoples:   [`${npc.firstName} describes the various peoples who call ${kName} home — their origins and cultures.`,
                                `"Many folk live in ${kName}," ${npc.firstName} explains, describing the diverse communities.`],
                    religion:  [`${npc.firstName} speaks of the faiths practiced in ${kName} — the temples, the rituals, the devotions.`,
                                `"Faith runs deep in ${kName}," ${npc.firstName} tells you about the local beliefs.`],
                    military:  [`${npc.firstName} talks about ${kName}'s military strength — their soldiers, fortifications, and wars.`,
                                `"I've seen ${kName}'s army," ${npc.firstName} says, describing their forces in detail.`],
                    diplomacy: [`${npc.firstName} discusses ${kName}'s relations with neighboring realms — alliances, rivalries, treaties.`,
                                `"Politics is a tangled web," ${npc.firstName} explains ${kName}'s diplomatic standing.`],
                    economy:   [`${npc.firstName} shares insight into ${kName}'s trade and wealth — what they produce, what they need.`,
                                `"If you want to make coin in ${kName}," ${npc.firstName} explains the local economy.`],
                };
                const texts = flavorTexts[category] || [`${npc.firstName} tells you about ${kName}'s ${category}.`];
                outcomes.push({
                    icon: '🏰',
                    title: `Kingdom Intel: ${category.charAt(0).toUpperCase() + category.slice(1)}`,
                    text: Utils.randPick(texts),
                    type: 'kingdom',
                });
            } else {
                // Already know everything they could teach
                outcomes.push({
                    icon: '🏰',
                    title: 'Nothing New',
                    text: `${npc.firstName} talks about ${kName}, but you already know everything a ${npcOccupation} would about their ${knowledgeCategories.join(' and ')}.`,
                    type: 'known',
                });
            }
        }

        // ── 2. World Lore Discovery (40% chance, higher if NPC is scholar/priest/noble) ──
        const loreChance = ['scholar', 'priest', 'noble', 'innkeeper'].includes(npcOccupation) ? 0.6 : 0.35;
        if (typeof Peoples !== 'undefined' && Math.random() < loreChance) {
            const loreOpts = {};
            if (npcKingdom) loreOpts.kingdom = npcKingdom;
            const discovered = Peoples.discoverLore(player, game.world, loreOpts);
            if (discovered.length > 0) {
                const entry = discovered[0];
                const eraNames = { 0: 'the Dawn Age', 1: 'the Age of Expansion', 2: 'the Age of Conflict', 3: 'the Modern Era' };
                const era = entry.era !== undefined ? (eraNames[entry.era] || `Era ${entry.era}`) : 'ages past';
                outcomes.push({
                    icon: '📜',
                    title: 'Ancient Lore',
                    text: `${npc.firstName} recounts a tale from ${era}: "${entry.text}"`,
                    type: 'lore',
                    entry,
                });
            }
        }

        // ── 3. Occupation-specific tips (bonus effects) ──
        const tipRoll = Math.random();
        if (tipRoll < 0.25) {
            const tips = [];
            if (['merchant', 'innkeeper'].includes(npcOccupation) && player.skills) {
                player.skills.commerce = Math.min((player.skills.commerce || 1) + 1, 10);
                tips.push({ icon: '💰', title: 'Trade Wisdom', text: `${npc.firstName}'s merchant tales teach you something useful about trade. Commerce +1.` });
            } else if (['guard', 'soldier'].includes(npcOccupation) && player.skills) {
                player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
                tips.push({ icon: '⚔️', title: 'Battle Tales', text: `${npc.firstName}'s war stories sharpen your understanding of combat. Combat +1.` });
            } else if (['scholar', 'priest', 'healer'].includes(npcOccupation)) {
                player.intelligence = Math.min((player.intelligence || 5) + 1, 10);
                tips.push({ icon: '📚', title: 'Scholarly Insight', text: `${npc.firstName}'s deep knowledge expands your mind. Intelligence +1.` });
            } else if (['hunter', 'fisher'].includes(npcOccupation) && player.skills) {
                player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                tips.push({ icon: '🏹', title: 'Wilderness Lore', text: `${npc.firstName} teaches you about tracking and survival. Stealth +1.` });
            } else if (player.skills) {
                player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                tips.push({ icon: '🗣️', title: 'Social Grace', text: `The conversation itself teaches you about reading people. Diplomacy +1.` });
            }
            if (tips.length > 0) outcomes.push({ ...tips[0], type: 'tip' });
        }

        // ── 4. If nothing interesting happened at all, give a flavor fallback ──
        if (outcomes.length === 0 || (outcomes.length === 1 && outcomes[0].type === 'known')) {
            const fallbacks = [
                `${npc.firstName} rambles about the weather and local gossip. Nothing particularly useful, but it passes the time.`,
                `${npc.firstName} shares a long-winded story about their cousin's farm. You smile politely.`,
                `You trade stories for a while. ${npc.firstName} seems to enjoy the company more than the tales.`,
                `${npc.firstName} tells a tale you've heard before, but you listen anyway. They appreciate the courtesy.`,
            ];
            if (outcomes.length === 0) {
                outcomes.push({ icon: '💬', title: 'Pleasant Chat', text: Utils.randPick(fallbacks), type: 'fallback' });
            }
        }

        // ── Build the results panel ──
        let html = '<div style="max-height: 450px; overflow-y: auto;">';
        html += `<h4 style="margin-top: 0;">📖 Stories with ${npc.firstName}</h4>`;
        html += `<p style="font-size: 12px; color: var(--text-secondary);">You sit with ${npc.firstName} (${npc.occupation}) and exchange tales. +${relGain} relationship.</p>`;

        const typeColors = {
            kingdom: 'rgba(245,197,66,0.1)',
            lore: 'rgba(139,69,19,0.15)',
            tip: 'rgba(76,175,80,0.1)',
            known: 'rgba(255,255,255,0.03)',
            fallback: 'rgba(255,255,255,0.03)',
        };
        const borderColors = {
            kingdom: 'var(--gold)',
            lore: '#8b4513',
            tip: '#4caf50',
            known: '#555',
            fallback: '#555',
        };

        for (const outcome of outcomes) {
            html += `
                <div style="padding: 10px; margin-bottom: 8px; background: ${typeColors[outcome.type] || 'rgba(255,255,255,0.03)'};
                    border-left: 3px solid ${borderColors[outcome.type] || '#555'}; border-radius: 0 4px 4px 0;">
                    <div style="font-weight: bold; font-size: 12px; margin-bottom: 4px; color: ${borderColors[outcome.type] || '#ccc'};">
                        ${outcome.icon} ${outcome.title}
                    </div>
                    <div style="font-size: 12px; color: #ccc; line-height: 1.5;">${outcome.text}</div>
                </div>
            `;
        }

        html += `<button data-am-act="openTileMenu" data-am-args='["showMeetPeopleMenu", ${tile.q}, ${tile.r}]' 
                    style="width: 100%; margin-top: 8px; padding: 10px; background: rgba(255,255,255,0.08); 
                    border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; color: var(--text-secondary); 
                    font-family: var(--font-body);">Back to People</button>`;
        html += '</div>';

        game.ui.showCustomPanel('Stories', html);
        game.ui.updateStats(player, game.world);
    },

    /**
     * Show marriage celebration panel
     */
    _showMarriageCelebration(game, spouse) {
        let html = '<div style="text-align: center;">';
        html += '<h3 style="color: var(--gold); margin-top: 0;">💍 Just Married! 💍</h3>';
        html += `<p style="font-size: 16px;">You and <strong>${spouse.firstName} ${spouse.dynasty}</strong> are now wed!</p>`;
        html += '<p style="font-size: 40px;">👫💒🎉</p>';
        html += '<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin: 10px 0; font-size: 12px; text-align: left;">';
        html += '<div>+1 max stamina (companionship)</div>';
        html += '<div>+3 renown</div>';
        if (spouse.kingdomId) html += '<div>+5 reputation with spouse\'s kingdom</div>';
        html += '<div style="margin-top: 6px; color: #ff69b4;">You may now have children as time passes!</div>';
        html += '</div>';
        html += `<button data-am-act="closePanel" style="width: 100%; padding: 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">Begin Your New Life Together</button>`;
        html += '</div>';

        game.ui.showCustomPanel('Wedding', html);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show all relationships the player has built
     */
    showRelationshipsMenu(game, tile) {
        if (typeof Relationships === 'undefined') return;
        const player = game.player;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">💕 Your Relationships</h4>';

        // Spouse section
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) {
                const rel = Relationships.getRelationship(player, player.spouse);
                html += '<div style="background: rgba(255,105,180,0.15); padding: 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(255,105,180,0.3);">';
                html += `<div style="font-weight: bold; color: #ff69b4;">💍 Spouse: ${spouse.firstName} ${spouse.dynasty}</div>`;
                html += `<div style="font-size: 11px; color: #aaa;">Age ${spouse.age} · ${spouse.occupation} · Affection: ${rel.affection}/100 · Relation: ${rel.score || 0}</div>`;
                html += '<div style="margin-top: 4px;">';
                html += ActionMenu._renderAffectionBar(rel.affection);
                html += '</div>';
                html += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
                html += `<button onclick="window._divorceConfirm()" style="padding: 3px 8px; background: #633; border: none; border-radius: 3px; cursor: pointer; color: #c88; font-size: 10px; margin-top: 4px;">💔 Divorce</button>`;
                html += '</div>';
            }
        }

        // Children section
        if (player.children && player.children.length > 0) {
            html += '<div style="margin-bottom: 8px;">';
            html += '<h5 style="margin: 4px 0; color: var(--gold);">👶 Children</h5>';
            for (const child of player.children) {
                if (!child.isAlive) continue;
                const genderIcon = child.gender === 'male' ? '♂️' : '♀️';
                const isHeir = player.heir === child.id;
                const traitStr = child.traits?.length > 0
                    ? child.traits.map(t => `${t.icon}`).join(' ')
                    : '';
                html += `<div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 4px; margin-bottom: 4px; font-size: 12px; ${isHeir ? 'border-left: 3px solid var(--gold);' : ''}">`;
                html += `<strong>${child.firstName} ${child.dynasty}</strong> ${genderIcon} · Age ${child.age} ${traitStr}`;
                if (isHeir) html += ` <span style="color: var(--gold);">👑 Heir</span>`;
                html += `</div>`;
            }
            html += '</div>';
        }

        // Friends & Acquaintances
        const allRels = Object.entries(player.relationships || {});
        const friends = allRels.filter(([id, r]) => r.score >= 10).sort((a, b) => b[1].score - a[1].score);
        const rivals = allRels.filter(([id, r]) => r.score <= -10).sort((a, b) => a[1].score - b[1].score);
        const romanticInterests = allRels.filter(([id, r]) => r.romantic && id !== player.spouse).sort((a, b) => (b[1].affection || 0) - (a[1].affection || 0));
        const knownPeople = allRels
            .map(([npcId, rel]) => ({ npcId, rel, npc: Relationships.getNPC(npcId) }))
            .filter(entry => entry.npc && entry.npc.isAlive)
            .sort((a, b) => (b.rel.score || 0) - (a.rel.score || 0));
        const travelParty = Relationships.getTravelPartyMembers(player);

        if (travelParty.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #6cf;">🧭 Travel Party</h5>';
            for (const member of travelParty) {
                const rel = Relationships.getRelationship(player, member.id);
                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; font-size: 12px; background: rgba(90,140,200,0.10); border-radius: 4px; margin-bottom: 3px;">`;
                html += `<span>🧭 <strong>${member.firstName}</strong> (${rel.score || 0})</span>`;
                html += `<button onclick="window._openKnownCharacter('${member.id}')" style="padding: 3px 8px; background: #355; border: none; border-radius: 3px; cursor: pointer; color: #cde; font-size: 10px;">Profile</button>`;
                html += `</div>`;
            }
        }

        if (romanticInterests.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #ff69b4;">💕 Romantic Interests</h5>';
            for (const [npcId, rel] of romanticInterests) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive) continue;
                const stage = Relationships.getCourtingStage(rel.affection, false);
                html += `<div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,105,180,0.1); padding: 6px 8px; border-radius: 4px; margin-bottom: 4px; font-size: 12px;">`;
                html += `<span>${stage.icon} <strong>${npc.firstName}</strong> · ${stage.label} · Affection: ${rel.affection} · Score: ${rel.score || 0}</span>`;
                html += `<button onclick="window._openKnownCharacter('${npc.id}')" style="padding: 3px 8px; background: #544; border: none; border-radius: 3px; cursor: pointer; color: #fcc; font-size: 10px;">Profile</button>`;
                html += `</div>`;
                html += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
            }
        }

        if (friends.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #4a4;">😊 Friends</h5>';
            for (const [npcId, rel] of friends) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive || npcId === player.spouse) continue;
                const label = Relationships.getRelationLabel(rel.score);
                html += `<div style="padding: 4px 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">`;
                html += `<span>${label.icon} <strong>${npc.firstName}</strong> (${rel.score})</span>`;
                html += `<button onclick="window._openKnownCharacter('${npc.id}')" style="padding: 3px 8px; background: #353; border: none; border-radius: 3px; cursor: pointer; color: #cec; font-size: 10px;">Profile</button>`;
                html += `</div>`;
                html += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
            }
        }

        if (rivals.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #a44;">⚡ Rivals</h5>';
            for (const [npcId, rel] of rivals) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive) continue;
                const label = Relationships.getRelationLabel(rel.score);
                html += `<div style="padding: 4px 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">`;
                html += `<span>${label.icon} <strong>${npc.firstName}</strong> (${rel.score})</span>`;
                html += `<button onclick="window._openKnownCharacter('${npc.id}')" style="padding: 3px 8px; background: #533; border: none; border-radius: 3px; cursor: pointer; color: #ecc; font-size: 10px;">Profile</button>`;
                html += `</div>`;
                html += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
            }
        }

        if (knownPeople.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #9ab;">📇 People You Know</h5>';
            for (const entry of knownPeople.slice(0, 16)) {
                const relation = Relationships.getRelationLabel(entry.rel.score || 0);
                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 12px; background: rgba(255,255,255,0.03); border-radius: 4px; margin-bottom: 3px;">`;
                html += `<span>${relation.icon} <strong>${entry.npc.firstName}</strong> (${entry.rel.score || 0})</span>`;
                html += `<button onclick="window._openKnownCharacter('${entry.npcId}')" style="padding: 3px 8px; background: #444; border: none; border-radius: 3px; cursor: pointer; color: #ddd; font-size: 10px;">Character Profile</button>`;
                html += `</div>`;
            }
        }

        if (friends.length === 0 && rivals.length === 0 && romanticInterests.length === 0 && !player.spouse && knownPeople.length === 0 && travelParty.length === 0) {
            html += '<p style="color: #aaa; font-size: 12px;">You haven\'t formed any meaningful relationships yet. Visit settlements and meet people!</p>';
        }

        // Dynasty info
        if (player.dynasty) {
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 8px;">';
            html += `<div style="font-size: 11px; color: #888;">Dynasty: <strong style="color: var(--gold);">${player.dynasty.name}</strong> · Prestige: ${player.dynasty.prestige || 0}</div>`;
            html += `<div style="font-size: 11px; color: #888;">Age: ${player.age} · Max lifespan: ~${player.maxLifespan}</div>`;
            html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('Relationships', html);

        window._divorceConfirm = () => {
            game.ui.hideCustomPanel();
            let confirmHtml = '<div>';
            confirmHtml += '<h4 style="margin-top: 0; color: #f66;">💔 Divorce</h4>';
            confirmHtml += '<p style="font-size: 12px;">Are you sure you want to end your marriage? This will cost you karma and renown.</p>';
            confirmHtml += `<button onclick="window._doDivorce()" style="width: 100%; padding: 10px; background: #a33; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: #fff; margin-bottom: 6px;">Yes, Divorce</button>`;
            confirmHtml += `<button data-am-act="openTileMenu" data-am-args='["showRelationshipsMenu"]' style="width: 100%; padding: 8px; background: #555; border: none; border-radius: 4px; cursor: pointer; color: #ccc;">Cancel</button>`;
            confirmHtml += '</div>';
            game.ui.showCustomPanel('Confirm Divorce', confirmHtml);
        };

        window._doDivorce = () => {
            const result = Relationships.divorce(player, game.world);
            if (result.success) {
                const exName = result.exSpouse ? result.exSpouse.firstName : 'your spouse';
                game.ui.showNotification('💔 Divorced', `You and ${exName} have parted ways. -5 karma, -2 renown.`, 'warning');
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }
            game.ui.hideCustomPanel();
            game.ui.updateStats(player, game.world);
        };

        window._openKnownCharacter = (npcId) => {
            ActionMenu.showCharacterDataModal(game, tile, npcId, { returnTo: 'relationships' });
        };
    },

    _renderAffectionBar(affection) {
        const pct = Math.max(0, Math.min(100, affection));
        const color = pct >= 75 ? '#ff69b4' : pct >= 50 ? '#f0a' : pct >= 25 ? '#c80' : '#888';
        return `<div style="background: rgba(0,0,0,0.5); border-radius: 3px; height: 8px; width: 100%;">
            <div style="background: ${color}; height: 100%; width: ${pct}%; border-radius: 3px; transition: width 0.3s;"></div>
        </div>`;
    },

    _getRelationshipProgress(score) {
        const levels = (typeof Relationships !== 'undefined' && Relationships._getRelationshipLevels)
            ? Relationships._getRelationshipLevels()
            : [
                { id: 'stranger', label: 'Stranger', minScore: -100, icon: '👤' },
                { id: 'acquaintance', label: 'Acquaintance', minScore: 10, icon: '🤝' },
                { id: 'friend', label: 'Friend', minScore: 30, icon: '😊' },
                { id: 'close_friend', label: 'Close Friend', minScore: 60, icon: '💛' },
                { id: 'best_friend', label: 'Best Friend', minScore: 90, icon: '💜' },
            ];

        const sortedLevels = [...levels].sort((a, b) => (a.minScore ?? -100) - (b.minScore ?? -100));
        const currentLevel = (typeof Relationships !== 'undefined' && Relationships.getRelationshipLevel)
            ? Relationships.getRelationshipLevel(score)
            : sortedLevels[0];
        const nextLevel = sortedLevels.find(level => score < (level.minScore ?? -100));

        const startScore = currentLevel?.minScore ?? -100;
        const endScore = nextLevel?.minScore ?? 100;
        const range = Math.max(1, endScore - startScore);
        const pct = nextLevel
            ? Math.max(0, Math.min(100, ((score - startScore) / range) * 100))
            : 100;

        return {
            currentLevel,
            nextLevel,
            pct,
            remaining: nextLevel ? Math.max(0, (nextLevel.minScore ?? score) - score) : 0,
        };
    },

    _renderRelationshipXPBar(score, compact = false) {
        const progress = ActionMenu._getRelationshipProgress(score);
        const barHeight = compact ? 6 : 8;
        const marginTop = compact ? 4 : 6;
        const current = progress.currentLevel || { label: 'Stranger', icon: '👤' };

        let caption = '';
        if (progress.nextLevel) {
            caption = `${current.icon} ${current.label} → ${progress.nextLevel.icon} ${progress.nextLevel.label} (+${progress.remaining})`;
        } else {
            caption = `${current.icon} ${current.label} (Max)`;
        }

        return `
            <div style="margin-top: ${marginTop}px;">
                <div style="font-size: 10px; color: #999; margin-bottom: 2px;">${caption}</div>
                <div style="background: rgba(0,0,0,0.45); border-radius: 3px; height: ${barHeight}px; width: 100%;">
                    <div style="background: linear-gradient(90deg, #7f8c8d, #f1c40f); height: 100%; width: ${progress.pct}%; border-radius: 3px; transition: width 0.3s;"></div>
                </div>
            </div>
        `;
    },

    /**
     * Show dynasty management — view children, designate heir
     */
    showDynastyMenu(game, tile) {
        if (typeof Relationships === 'undefined') return;
        const player = game.player;
        const settings = Relationships._getHeirSettings();

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">👑 Dynasty & Heirs</h4>';

        // Dynasty info
        const house = player.house || null;
        html += '<div style="background: rgba(255,215,0,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid rgba(255,215,0,0.2);">';
        html += `<div style="font-weight: bold; color: var(--gold);">${house ? house.name : 'House ' + (player.dynasty?.name || player.name)}</div>`;
        if (house) {
            html += `<div style="font-size: 11px; color: #aaa;">Founded day ${house.foundedDay} · ⭐ Prestige: ${house.prestige || 0} · Generation ${house.generation || 1}</div>`;
        } else {
            html += `<div style="font-size: 11px; color: #aaa;">Founded day ${player.dynasty?.founded || 1} · Prestige: ${player.dynasty?.prestige || 0}</div>`;
        }
        html += `<div style="font-size: 11px; color: #aaa;">You: ${player.name}, age ${player.age} (max ~${player.maxLifespan})</div>`;
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) {
                html += `<div style="font-size: 11px; color: #ff69b4;">Spouse: ${spouse.firstName} ${spouse.dynasty}, age ${spouse.age}</div>`;
            }
        }
        html += '</div>';

        if (house) {
            html += `<button data-am-act="openTileMenu" data-am-args='["showHousePanel"${tile ? `, ${tile.q}, ${tile.r}` : ''}]' style="width:100%; padding:8px; margin-bottom:10px; background: var(--gold); border:none; border-radius:4px; cursor:pointer; font-weight:bold; color:#000;">🛡️ Manage ${house.name}</button>`;
        }

        // Children
        if (!player.children || player.children.length === 0) {
            html += '<p style="color: #aaa; font-size: 12px;">You have no children yet. Get married and time will tell!</p>';
        } else {
            html += '<h5 style="margin: 4px 0;">Children</h5>';

            for (const child of player.children) {
                if (!child.isAlive) continue;
                const isHeir = player.heir === child.id;
                const eligible = child.age >= settings.minAgeToPlay;
                const genderIcon = child.gender === 'male' ? '♂️' : '♀️';
                const traitStr = child.traits?.length > 0
                    ? child.traits.map(t => `<span title="${t.name}">${t.icon}</span>`).join(' ')
                    : '<span style="color:#888;">No traits</span>';

                html += `<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin-bottom: 6px; ${isHeir ? 'border: 1px solid var(--gold);' : ''}">`;
                html += `<div style="display: flex; justify-content: space-between; align-items: start;">`;
                html += `<div>`;
                html += `<strong>${child.firstName} ${child.dynasty}</strong> ${genderIcon}`;
                if (isHeir) html += ` <span style="color: var(--gold);">👑 Designated Heir</span>`;
                html += `<div style="font-size: 11px; color: #aaa;">Age ${child.age} · ${child.culture}</div>`;
                html += `<div style="font-size: 11px; margin-top: 2px;">Traits: ${traitStr}</div>`;
                html += `</div>`;
                html += `</div>`;

                // Stats
                html += `<div style="display: flex; gap: 8px; font-size: 11px; margin-top: 6px; flex-wrap: wrap; color: #bbb;">`;
                html += `<span>💪 ${child.strength || 5}</span>`;
                html += `<span>✨ ${child.charisma || 5}</span>`;
                html += `<span>🧠 ${child.intelligence || 5}</span>`;
                html += `<span>🙏 ${child.faith || 5}</span>`;
                html += `<span>🍀 ${child.luck || 5}</span>`;
                html += `</div>`;

                // Skills
                const skillLabels = { combat: '⚔️', commerce: '💰', leadership: '👑', diplomacy: '🤝', stealth: '🕵️', cartography: '🗺️' };
                const childSkills = child.skills || {};
                const hasSkills = Object.values(childSkills).some(v => v > 0);
                if (hasSkills) {
                    html += `<div style="display: flex; gap: 6px; font-size: 10px; margin-top: 3px; color: #999;">`;
                    for (const [sk, val] of Object.entries(childSkills)) {
                        if (val > 0) html += `<span>${skillLabels[sk] || sk} ${val}</span>`;
                    }
                    html += `</div>`;
                }

                // Actions
                html += `<div style="margin-top: 6px; display: flex; gap: 4px;">`;
                if (!isHeir) {
                    html += `<button onclick="window._designateHeir('${child.id}')" style="padding: 4px 10px; background: #664; border: none; border-radius: 3px; cursor: pointer; color: var(--gold); font-size: 11px;">👑 Designate Heir</button>`;
                }
                html += `</div>`;

                html += `</div>`;
            }
        }

        // Heir summary
        if (player.heir) {
            const heirChild = (player.children || []).find(c => c.id === player.heir);
            if (heirChild && heirChild.isAlive) {
                const eligible = heirChild.age >= settings.minAgeToPlay;
                html += `<div style="background: rgba(255,215,0,0.1); padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 12px;">`;
                html += `<div>Current heir: <strong style="color: var(--gold);">${heirChild.firstName}</strong> (age ${heirChild.age})</div>`;
                if (eligible) {
                    html += `<div style="color: #4a4;">✓ Eligible to succeed you</div>`;
                } else {
                    html += `<div style="color: #c80;">⏳ Must be ${settings.minAgeToPlay} to take over (currently ${heirChild.age})</div>`;
                }
                html += `<div style="color: #aaa; font-size: 11px; margin-top: 4px;">Inheritance: ${Math.round(settings.inheritanceGoldPercent * 100)}% gold, ${Math.round(settings.inheritanceRenownPercent * 100)}% renown</div>`;
                html += `</div>`;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Dynasty', html);

        window._designateHeir = (childId) => {
            const result = Relationships.designateHeir(player, childId);
            if (result.success) {
                game.ui.showNotification('👑 New Heir', `${result.heir.firstName} is now your designated heir.`, 'success');
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }
            game.ui.hideCustomPanel();
            ActionMenu.showDynastyMenu(game, tile);
        };
    },

    /**
     * The House panel — identity, Prestige, Ambition, offices, rivals, chronicle.
     */
    showHousePanel(game, tile) {
        const player = game.player;
        const house = player.house;
        if (!house) {
            game.ui.showNotification('House', 'Your House has not yet been founded.', 'info');
            return;
        }
        const roleDefs = House.roleDefs();

        let html = '<div>';
        html += `<div style="text-align:center; margin-bottom:8px;">
            <div style="font-size:28px;">${house.sigil?.icon || '🛡️'}</div>
            <div style="font-weight:bold; color:var(--gold); font-size:16px;">${house.name}</div>
            ${house.motto ? `<div style="font-style:italic; color:#bbb; font-size:12px;">&ldquo;${house.motto}&rdquo;</div>` : ''}
            <div style="font-size:11px; color:#aaa;">Generation ${house.generation} · Founded day ${house.foundedDay}</div>
            <div style="font-size:13px; color:var(--gold); margin-top:4px;">⭐ Prestige: ${house.prestige}</div>
        </div>`;
        html += `<button onclick="window._houseRename()" style="width:100%; padding:6px; margin-bottom:10px; background:#444; border:none; border-radius:4px; cursor:pointer; color:#ddd; font-size:12px;">✎ Rename &amp; Motto</button>`;

        // Ambition
        html += '<h5 style="margin:6px 0;">🏛️ Ambition</h5>';
        if (house.ambition) {
            const def = House._getAmbitionDef(house.ambition.id);
            html += '<div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px; font-size:12px;">';
            html += `<div style="color:var(--gold); font-weight:bold;">${def.name}</div>`;
            for (const ms of house.ambition.milestones) {
                const md = def.milestones.find(x => x.id === ms.id);
                html += `<div style="color:${ms.done ? '#7fd07f' : '#aaa'};">${ms.done ? '✓' : '○'} ${md ? md.label : ms.id}</div>`;
            }
            html += `<div style="color:${house.ambition.capstoneDone ? '#7fd07f' : '#e0b040'}; margin-top:2px;">${house.ambition.capstoneDone ? '★' : '☆'} ${def.capstone.label}</div>`;
            html += '</div>';
            if (house.ambition.capstoneDone) {
                html += `<button onclick="window._houseChooseAmbition()" style="width:100%; padding:6px; margin-top:6px; background:var(--gold); border:none; border-radius:4px; cursor:pointer; color:#000; font-weight:bold; font-size:12px;">Choose a New Ambition</button>`;
            }
        } else {
            html += `<button onclick="window._houseChooseAmbition()" style="width:100%; padding:8px; background:var(--gold); border:none; border-radius:4px; cursor:pointer; font-weight:bold; color:#000;">Choose an Ambition</button>`;
        }

        // Offices / roles
        html += '<h5 style="margin:10px 0 6px;">🏰 Offices</h5>';
        for (const roleId of House.ROLE_IDS) {
            const def = roleDefs[roleId];
            const memberId = house.roles[roleId];
            const member = memberId ? House._findMember(player, memberId) : null;
            const loyalty = memberId && house.roleLoyalty[memberId] != null ? house.roleLoyalty[memberId] : '?';
            html += '<div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.25); padding:6px 8px; border-radius:4px; margin-bottom:4px; font-size:12px;">';
            html += `<div><strong>${def.label}</strong> <span style="color:#888;">${def.blurb}</span><br>`;
            html += member
                ? `<span style="color:var(--gold);">${member.firstName}</span> <span style="color:#888;">(loyalty ${loyalty})</span>`
                : '<span style="color:#888;">Vacant</span>';
            html += '</div>';
            html += `<button onclick="window._houseAssignRole('${roleId}')" style="padding:4px 8px; background:#555; border:none; border-radius:3px; cursor:pointer; color:#ddd; font-size:11px;">Assign</button>`;
            html += '</div>';
        }

        // Rivals
        const rivalKeys = Object.keys(house.rivals || {});
        if (rivalKeys.length) {
            html += '<h5 style="margin:10px 0 6px;">⚔️ Rival Houses</h5>';
            for (const k of rivalKeys) {
                const r = house.rivals[k];
                const feud = r.feud || 0;
                const label = feud >= 60 ? 'Hostile' : feud >= 30 ? 'Wary' : 'Cool';
                const color = feud >= 60 ? '#e08080' : feud >= 30 ? '#e0b040' : '#88aabb';
                html += `<div style="display:flex; justify-content:space-between; font-size:12px; padding:3px 0;"><span>${r.name}</span><span style="color:${color};">${label} (${feud})</span></div>`;
            }
        }

        // Plots against the House — only revealed schemes are shown
        const plots = Schemes.known(player);
        html += '<h5 style="margin:10px 0 6px;">🗡️ Plots Against You</h5>';
        if (!plots.length) {
            html += '<div style="font-size:11px; color:#888;">No known plots. Spies, a Spymaster and counter-espionage missions help uncover schemes before they strike.</div>';
        }
        const plotBtn = (label, handler, enabled = true) => `<button ${enabled ? `onclick="${handler}"` : 'disabled'} style="flex:1; padding:4px 6px; background:${enabled ? '#7a3b3b' : '#444'}; border:none; border-radius:3px; cursor:${enabled ? 'pointer' : 'default'}; color:#eee; font-size:11px;">${label}</button>`;
        for (const s of plots) {
            const def = Schemes.TYPES[s.type];
            const days = Math.max(0, s.dueDay - game.world.day);
            const idleSpies = ((player.espionage && player.espionage.spies) || []).filter(sp => sp.status === 'idle').length;
            const goldCost = Schemes.bribeGoldCost(player, s);
            const presCost = Schemes.bribePrestigeCost(player, s);
            html += '<div style="background:rgba(120,30,30,0.25); padding:8px; border-radius:6px; margin-bottom:6px; font-size:12px;">';
            html += `<div style="display:flex; justify-content:space-between;"><strong>${def ? def.icon : '🗡️'} ${def ? def.name : s.type}</strong><span style="color:#e08080;">${days} day(s)</span></div>`;
            html += `<div style="color:#bbb; margin:2px 0 6px;">${Schemes.describe(s)}.${s.guarded ? ' <span style="color:#7fd07f;">Guarded.</span>' : ''}</div>`;
            html += '<div style="display:flex; gap:4px; flex-wrap:wrap;">';
            if (def && def.guard) {
                html += plotBtn(s.guarded ? 'Guarded' : `${def.guard.label} (${def.guard.cost}g, ${Math.round(def.guard.success * 100)}%)`,
                    `window._schemeAct('guard', ${s.id})`, !s.guarded && player.gold >= def.guard.cost);
            }
            html += plotBtn(s.spyTried ? 'Spy failed' : `🕵️ Send spy${idleSpies ? '' : ' (none idle)'}`, `window._schemeAct('spy', ${s.id})`, !s.spyTried && idleSpies > 0);
            html += plotBtn(`💰 Buy off (${goldCost}g)`, `window._schemeAct('gold', ${s.id})`, player.gold >= goldCost);
            html += plotBtn(`⭐ Buy off (${presCost})`, `window._schemeAct('prestige', ${s.id})`, house.prestige >= presCost);
            html += '</div></div>';
        }

        // Spend Prestige — what the House's standing can buy that gold can't
        const sinks = House._getSinks();
        const claim = Titles.getClaimableTitle(player, game.world);
        const here = tile && tile.settlement ? tile : game.world.getTile(player.q, player.r);
        const swayKingdomId = (here && here.settlement && here.settlement.kingdom) || player.allegiance || null;
        const swayKingdom = swayKingdomId ? game.world.getKingdom(swayKingdomId) : null;
        const sinkRow = (icon, title, cost, blurb, buttons, blocked) => {
            const affordable = house.prestige >= cost && !blocked;
            let row = `<div style="background:rgba(0,0,0,0.25); padding:8px; border-radius:6px; margin-bottom:6px; font-size:12px; ${affordable ? '' : 'opacity:0.65;'}">`;
            row += `<div style="display:flex; justify-content:space-between;"><strong>${icon} ${title}</strong><span style="color:var(--gold);">⭐ ${cost}</span></div>`;
            row += `<div style="color:#aaa; margin:2px 0 6px;">${blurb}</div>`;
            row += blocked ? `<div style="color:#e08080;">${blocked}</div>` : `<div style="display:flex; gap:6px;">${buttons}</div>`;
            return row + '</div>';
        };
        const sinkBtn = (label, handler) => `<button onclick="${handler}" style="flex:1; padding:5px 8px; background:var(--gold); border:none; border-radius:4px; cursor:pointer; color:#000; font-weight:bold; font-size:11px;">${label}</button>`;

        html += '<h5 style="margin:10px 0 6px;">⭐ Spend Prestige</h5>';
        html += sinkRow('📜', 'Press a Claim', sinks.pressClaim,
            claim.titleId
                ? `Take the office of <strong>${claim.title.name}</strong> — the House's name sets aside its reputation and renown requirements.`
                : 'Claim the next office up, setting aside its reputation and renown requirements.',
            sinkBtn(claim.titleId ? `Claim ${claim.title.name}` : 'Press Claim', 'window._housePressClaim()'),
            claim.titleId ? null : claim.reason);
        html += sinkRow('💍', 'Arrange a Prestigious Marriage', sinks.prestigiousMarriage,
            'A noble of this settlement, already fond of you, joins those you can court. Marrying a noble brings renown, standing with their kingdom and Prestige.',
            sinkBtn('Arrange a Match', 'window._houseNobleMatch()'),
            player.spouse ? 'You are already married.' : (!(here && here.settlement) ? 'Visit a settlement to arrange a match.' : null));
        html += sinkRow('🤝', 'Call in a Favor', sinks.callInFavor,
            'An allied House repays old debts.',
            sinkBtn(`💰 Gold (${House.FAVOR_GOLD_BASE + House.FAVOR_GOLD_PER_GENERATION * (house.generation || 1)}g)`, "window._houseFavor('gold')")
            + (swayKingdom ? sinkBtn(`👑 +${House.FAVOR_REPUTATION} rep · ${swayKingdom.name}`, "window._houseFavor('influence')") : ''),
            null);

        // Chronicle
        html += '<h5 style="margin:10px 0 6px;">📜 Chronicle</h5>';
        const recent = (house.history || []).slice(-6).reverse();
        html += '<div style="font-size:11px; color:#bbb; max-height:120px; overflow-y:auto;">';
        for (const h of recent) {
            html += `<div style="padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.05);">Day ${h.day}: ${h.text}</div>`;
        }
        html += '</div>';

        html += `<button data-am-act="openTileMenu" data-am-args='["showDynastyMenu"${tile ? `, ${tile.q}, ${tile.r}` : ''}]' style="width:100%; padding:8px; margin-top:10px; background:#555; border:none; border-radius:4px; cursor:pointer; color:#ccc;">← Back to Dynasty</button>`;
        html += '</div>';
        game.ui.showCustomPanel('House', html);

        // ── Handlers ──
        const afterSink = (title, result, okText) => {
            if (result.success) game.ui.showNotification(title, okText, 'success');
            else game.ui.showNotification(title, result.reason || 'Not possible right now.', 'error');
            game.ui.updateStats(player, game.world);
            ActionMenu.showHousePanel(game, tile);
        };
        window._schemeAct = (kind, id) => {
            let res;
            if (kind === 'guard') res = Schemes.guard(player, game.world, id);
            else if (kind === 'spy') res = Schemes.sendSpy(player, game.world, id);
            else res = Schemes.bribe(player, game.world, id, kind);
            if (!res.success) game.ui.showNotification('🗡️ Plot', res.reason || 'Not possible.', 'error');
            else if (kind === 'guard') game.ui.showNotification('🛡️ Guards Posted', `They hold with ${Math.round(res.chance * 100)}% odds.`, 'success');
            else if (kind === 'spy') game.ui.showNotification(res.foiled ? '🕵️ Plot Foiled' : '🕵️ Spy Failed',
                res.foiled ? `${res.spy} broke the scheme.` : `${res.spy} could not stop the plotters.`, res.foiled ? 'success' : 'error');
            else game.ui.showNotification('💰 Bought Off', 'The rival abandons the plot, and the feud cools.', 'success');
            game.ui.updateStats(player, game.world);
            ActionMenu.showHousePanel(game, tile);
        };
        window._housePressClaim = () => {
            const res = Titles.pressClaim(player, game.world);
            afterSink('📜 Claim Pressed', res, res.title ? `You are now ${res.title.name}.` : '');
        };
        window._houseNobleMatch = () => {
            const res = Relationships.arrangeNobleMatch(player, here, game.world);
            afterSink('💍 A Noble Match', res, res.npc ? `${res.npc.firstName} ${res.npc.dynasty} awaits your courtship in ${here.settlement.name}.` : '');
        };
        window._houseFavor = (kind) => {
            const res = House.callInFavor(player, game.world, { kind, kingdomId: swayKingdomId,
                chronicle: `${house.name} calls in a favor from an allied House.`, tags: ['favor'] });
            const text = res.gold ? `An allied House sends ${res.gold} gold.` : res.reputation ? `Your standing with ${swayKingdom ? swayKingdom.name : 'the kingdom'} rises by ${res.reputation}.` : '';
            afterSink('🤝 Favor Called In', res, text);
        };
        window._houseRename = () => {
            const cur = house.name.replace(/^House\s+/i, '');
            let h = `<div><h4 style="margin-top:0;">Name Your House</h4>
                <input id="houseNameInput" value="${cur.replace(/"/g, '&quot;')}" style="width:100%; padding:8px; margin-bottom:8px; background:#222; border:1px solid #555; border-radius:4px; color:#fff;" />
                <input id="houseMottoInput" value="${(house.motto || '').replace(/"/g, '&quot;')}" placeholder="Motto (optional)" style="width:100%; padding:8px; margin-bottom:8px; background:#222; border:1px solid #555; border-radius:4px; color:#fff;" />
                <button onclick="window._houseSaveName()" style="width:100%; padding:8px; background:var(--gold); border:none; border-radius:4px; cursor:pointer; color:#000; font-weight:bold;">Save</button></div>`;
            game.ui.showCustomPanel('House Name', h);
        };
        window._houseSaveName = () => {
            const nameEl = document.getElementById('houseNameInput');
            const mottoEl = document.getElementById('houseMottoInput');
            House.found(player, game.world, {
                name: nameEl && nameEl.value ? nameEl.value : house.name,
                motto: mottoEl ? mottoEl.value : '',
            });
            game.ui.hideCustomPanel();
            ActionMenu.showHousePanel(game, tile);
        };
        window._houseChooseAmbition = () => {
            let h = '<div><h4 style="margin-top:0;">Choose an Ambition</h4>';
            for (const a of House.ambitions()) {
                h += `<div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px; margin-bottom:6px;">
                    <div style="color:var(--gold); font-weight:bold;">${a.name}</div>
                    <div style="font-size:12px; color:#aaa;">${a.blurb}</div>
                    <button onclick="window._houseSetAmbition('${a.id}')" style="width:100%; padding:6px; margin-top:4px; background:var(--gold); border:none; border-radius:4px; cursor:pointer; color:#000; font-weight:bold;">Pursue</button></div>`;
            }
            h += '</div>';
            game.ui.showCustomPanel('Ambition', h);
        };
        window._houseSetAmbition = (id) => {
            House.chooseAmbition(house, id, game.world.day);
            const def = House._getAmbitionDef(id);
            game.ui.showNotification('🏛️ Ambition Set', `Your House now pursues ${def ? def.name : id}.`, 'success');
            game.ui.hideCustomPanel();
            ActionMenu.showHousePanel(game, tile);
        };
        window._houseAssignRole = (roleId) => {
            const kids = (player.children || []).filter(c => c.isAlive);
            if (!kids.length) {
                game.ui.showNotification('Offices', 'You have no family of age to appoint.', 'info');
                return;
            }
            let h = `<div><h4 style="margin-top:0;">Appoint ${roleDefs[roleId].label}</h4>`;
            for (const c of kids) {
                const skill = roleDefs[roleId].skill;
                h += `<button onclick="window._houseDoAssign('${roleId}','${c.id}')" style="display:block; width:100%; text-align:left; padding:8px; margin-bottom:4px; background:#444; border:none; border-radius:4px; cursor:pointer; color:#ddd;">${c.firstName} <span style="color:#888;">(${skill} ${(c.skills && c.skills[skill]) || 0})</span></button>`;
            }
            h += `<button onclick="window._houseDoClear('${roleId}')" style="width:100%; padding:6px; margin-top:4px; background:#633; border:none; border-radius:4px; cursor:pointer; color:#ecc;">Leave Vacant</button></div>`;
            game.ui.showCustomPanel('Appoint', h);
        };
        window._houseDoAssign = (roleId, childId) => {
            const res = House.assignRole(player, roleId, childId);
            if (!res.success) game.ui.showNotification('Error', res.reason, 'error');
            game.ui.hideCustomPanel();
            ActionMenu.showHousePanel(game, tile);
        };
        window._houseDoClear = (roleId) => {
            House.clearRole(player, roleId);
            game.ui.hideCustomPanel();
            ActionMenu.showHousePanel(game, tile);
        };
    },

    /**
     * Show death / succession screen when the player dies
     */
    showDeathScreen(game, cause) {
        if (typeof Relationships === 'undefined') return;
        const player = game.player;
        const eligibleHeirs = Relationships.getEligibleHeirs(player);

        let html = '<div style="text-align: center;">';

        if (cause === 'starvation') {
            html += '<h3 style="color: #a33; margin-top: 0;">💀 Starvation</h3>';
            html += `<p style="font-size: 14px;">${player.name} has perished from starvation after ${player.starvationDays || '?'} days without food, at the age of ${player.age}.</p>`;
            html += '<p style="font-size: 12px; color: #aaa; font-style: italic;">"Even the mightiest lord cannot defy hunger forever."</p>';
        } else {
            html += '<h3 style="color: #a33; margin-top: 0;">💀 Death Comes for All</h3>';
            html += `<p style="font-size: 14px;">${player.name} has died at the age of ${player.age}.</p>`;
        }

        const house = player.house || null;
        if (house) {
            html += `<p style="font-size: 12px; color: var(--gold);">${house.name} · Prestige: ${house.prestige || 0} · Generation ${house.generation || 1}</p>`;
        } else if (player.dynasty) {
            html += `<p style="font-size: 12px; color: var(--gold);">House ${player.dynasty.name} · Prestige: ${player.dynasty.prestige || 0}</p>`;
        }

        // Offer to spend Prestige to secure a smooth succession (avoid disputes).
        const secureCost = (typeof House !== 'undefined') ? House._getSinks().secureSuccession : 20;
        const canSecure = house && (house.prestige || 0) >= secureCost && eligibleHeirs.length > 0;
        if (canSecure) {
            html += `<label style="display:flex; align-items:center; justify-content:center; gap:6px; font-size:12px; color:#ddd; margin:8px 0;">
                <input type="checkbox" id="secureSuccessionChk" />
                Spend ${secureCost} Prestige to secure the succession
            </label>`;
        }

        if (eligibleHeirs.length > 0) {
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0; padding-top: 10px;">';
            html += '<h4>Choose Your Heir</h4>';
            html += '<p style="font-size: 12px; color: #aaa;">Continue your dynasty by taking control of one of your children.</p>';

            for (const heir of eligibleHeirs) {
                const genderIcon = heir.gender === 'male' ? '♂️' : '♀️';
                const isDesignated = player.heir === heir.id;
                const traitStr = heir.traits?.length > 0
                    ? heir.traits.map(t => `${t.icon} ${t.name}`).join(', ')
                    : 'None';

                html += `<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin-bottom: 6px; ${isDesignated ? 'border: 1px solid var(--gold);' : ''}">`;
                html += `<strong>${heir.firstName} ${heir.dynasty}</strong> ${genderIcon} · Age ${heir.age}`;
                if (isDesignated) html += ` <span style="color: var(--gold);">👑 Designated</span>`;
                html += `<div style="font-size: 11px; color: #aaa;">STR ${heir.strength} · CHA ${heir.charisma} · INT ${heir.intelligence} · Traits: ${traitStr}</div>`;
                html += `<button onclick="window._succeedAsHeir('${heir.id}')" style="width: 100%; padding: 8px; margin-top: 6px; background: ${isDesignated ? 'var(--gold)' : '#555'}; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: ${isDesignated ? '#000' : '#ccc'};">Play as ${heir.firstName}</button>`;
                html += `</div>`;
            }

            html += '</div>';
        } else {
            // No adult heir — offer a regency if an under-age child exists.
            const assess = (typeof House !== 'undefined') ? House.assessSuccession(player) : { hasMinorHeir: false, regent: null };
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0; padding-top: 10px;">';
            if (assess.hasMinorHeir && assess.regent) {
                const r = assess.regent;
                html += '<h4 style="color: var(--gold);">A Regency?</h4>';
                html += `<p style="font-size: 12px; color: #aaa;">No heir has come of age. You may install a regency to raise <strong>${r.firstName}</strong> (age ${r.age}) to the throne — but the House will emerge weaker, shedding holdings.</p>`;
                html += `<button onclick="window._succeedViaRegency('${r.id}')" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color:#000; margin-top: 6px;">Install Regency for ${r.firstName}</button>`;
                html += `<button onclick="location.reload();" style="width: 100%; padding: 8px; background: #a33; border: none; border-radius: 4px; cursor: pointer; color: #fff; margin-top: 6px;">Let the Dynasty End</button>`;
            } else {
                html += '<h4 style="color: #a33;">No Eligible Heirs</h4>';
                html += '<p style="font-size: 12px; color: #aaa;">Without an heir, your dynasty ends here.</p>';
                html += `<button onclick="location.reload();" style="width: 100%; padding: 12px; background: #a33; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: #fff; margin-top: 10px;">Start New Game</button>`;
            }
            html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('Death', html);

        const finishSuccession = (childId, extraOpts) => {
            const chk = document.getElementById('secureSuccessionChk');
            const opts = { secure: !!(chk && chk.checked), ...(extraOpts || {}) };
            const result = Relationships.succeedAsHeir(player, childId, game.world, opts);
            if (result.success) {
                // Clear death animation state
                InnerMapRenderer.clearDeathAnimation();
                game.player._isDead = false;

                game.ui.hideCustomPanel();

                const hr = result.house || {};
                let successHtml = '<div style="text-align: center;">';
                successHtml += '<h3 style="color: var(--gold); margin-top: 0;">👑 A New Chapter</h3>';
                successHtml += `<p style="font-size: 14px;">You are now <strong>${result.newName}</strong>, heir of ${result.oldName}.</p>`;
                successHtml += '<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin: 10px 0; font-size: 12px; text-align: left;">';
                successHtml += `<div>Age: ${result.heir.age}</div>`;
                successHtml += `<div>Inherited ${player.gold} gold (${Math.round(Relationships._getHeirSettings().inheritanceGoldPercent * 100)}%)</div>`;
                if (player.house) successHtml += `<div>${player.house.name} · Prestige ${player.house.prestige || 0} · Generation ${hr.generation || player.house.generation || 1}</div>`;
                if (hr.regency) successHtml += `<div style="color:#e0a030;">Ascended under a regency — a weaker start.</div>`;
                if (hr.disputed) {
                    successHtml += hr.secured
                        ? `<div style="color:#7fd07f;">A rival pressed a claim — quelled by spending Prestige.</div>`
                        : `<div style="color:#e08080;">A disputed succession fragmented the House's holdings.</div>`;
                }
                for (const loss of (hr.fragmented || [])) {
                    if (loss.type === 'title') successHtml += `<div style="color:#e08080;">Lost your office in the turmoil.</div>`;
                    if (loss.type === 'gold') successHtml += `<div style="color:#e08080;">Lost ${loss.amount} gold to rival claimants.</div>`;
                }
                successHtml += '</div>';
                successHtml += `<button data-am-act="closePanelAndRefresh" style="width: 100%; padding: 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">Begin Your Story</button>`;
                successHtml += '</div>';

                game.ui.showCustomPanel('New Heir', successHtml);
                game.ui.updateStats(player, game.world);
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }
        };

        window._succeedAsHeir = (childId) => finishSuccession(childId, {});
        window._succeedViaRegency = (childId) => finishSuccession(childId, { regency: true });
    },
});
