// ActionMenu — social methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { Traits } from '../../systems/traits.js';
import { CompanionsPanel } from '../companionsPanel.js';
import { Upbringing } from '../../systems/upbringing.js';
import { HeirAgency } from '../../systems/heirAgency.js';
import { Demands } from '../../systems/demands.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { Court } from '../../systems/court.js';
import { Regency } from '../../systems/regency.js';
import { ConversationScene } from '../conversationScene.js';
import { NpcPortrait } from '../npcPortrait.js';
import { openPersonScene, personSprite } from './peopleScene.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DARK, BTN_OFF, BTN_RED, sectionHead, lede, chips, kv, card, actRow, rowList, price, esc } from './uiKit.js';
import { PlayerActions, PlayerEconomy, PlayerEffects, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, House, Schemes, RealmWars, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, InnerMapRenderer } from './_imports.js';

// The action menu's voice (ui/actionMenu/uiKit.js, styles.css "PANEL REVAMP")
const MUTED = 'font-size:11px; color:#9d937c;';
const TITLE = 'text-align:center; font-family:var(--font-display); font-size:18px; font-weight:600; letter-spacing:0.5px; color:#ffe9a8; margin:2px 0 10px;';
const QUOTE = 'font-size:12px; color:#9d937c; font-style:italic; text-align:center;';
const FIELD = 'display:block; width:100%; box-sizing:border-box; padding:7px 9px; margin-bottom:8px; background:rgba(0,0,0,0.35); border:1px solid rgba(245,197,66,0.18); border-radius:6px; color:#ece2c8; font-family:var(--font-body); font-size:12.5px;';

/** A relationship's progress as a slim inline bar (spans: it sits inside a row's button). */
function _xpNote(score) {
    const progress = ActionMenu._getRelationshipProgress(score);
    const current = progress.currentLevel || { label: 'Stranger', icon: '👤' };
    const caption = progress.nextLevel
        ? `${current.icon} ${current.label} → ${progress.nextLevel.icon} ${progress.nextLevel.label} (+${progress.remaining})`
        : `${current.icon} ${current.label} (Max)`;
    return `<span style="display:flex; align-items:center; gap:6px; color:#9d937c; font-size:10px; margin-top:2px;">`
        + `<span style="flex:0 0 80px; height:4px; border-radius:2px; background:rgba(0,0,0,0.45); overflow:hidden;"><span style="display:block; height:100%; width:${progress.pct}%; background:linear-gradient(90deg, #7f8c8d, #f1c40f);"></span></span>${caption}</span>`;
}

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
        const npcs = Relationships.getNPCsAtSettlement(tile, game.world, game.player);
        const personalities = Relationships._getPersonalities();

        let html = '<div>';
        html += lede(`The people of <strong>${tile.settlement.name}</strong>. Pick someone to spend time with them: friendship, romance, or company on the road.`);
        if (npcs.length === 0) html += `<p style="${MUTED}">Nobody interesting around right now.</p>`;
        html += '<div class="people-cards">';
        for (const npc of npcs) {
            const rel = Relationships.getRelationship(player, npc.id);
            const relLabel = Relationships.getRelationLabel(rel.score || 0);
            const personality = personalities[npc.personality] || { label: 'Unknown', icon: '❓' };
            const isSpouse = player.spouse === npc.id;
            const stage = rel.romantic ? Relationships.getCourtingStage(rel.affection, isSpouse) : null;
            const mood = ConversationScene.moodFromStanding(rel.score || 0);
            const matter = Relationships.getMatter(player, npc.id);
            const tag = (isSpouse ? '<span class="ctx-person-new" style="color:#ff80ab;border-color:rgba(255,128,171,0.4)">Spouse</span>'
                : Relationships.isInTravelParty(player, npc.id) ? '<span class="ctx-person-new">Travelling</span>' : '')
                + (matter ? '<span class="ctx-person-new" style="color:#ffcc80;border-color:rgba(255,204,128,0.45)">💌 Wants a word</span>' : '');
            html += `<div class="ctx-person" data-npc="${npc.id}" style="--mood:${mood.color}; --rel:${mood.color}" title="Spend time with ${npc.firstName}">`
                + `<div class="ctx-person-portrait"><canvas width="72" height="72"></canvas><span class="ctx-person-emoji">${npc.gender === 'male' ? '👨' : '👩'}</span></div>`
                + '<div class="ctx-person-info">'
                + `<div class="ctx-person-name">${npc.firstName} ${npc.dynasty}${tag}</div>`
                + `<div class="ctx-person-role">${npc.occupation.charAt(0).toUpperCase()}${npc.occupation.slice(1)}, ${npc.age}<span class="ctx-person-doing">${personality.icon} ${personality.label}</span></div>`
                + `<div class="ctx-person-mood"><span class="ctx-person-mood-bar"><span style="width:${Math.max(4, mood.value)}%"></span></span>${relLabel.icon} ${relLabel.label}${stage ? ` · <span style="color:#f48fb1">${stage.icon} ${stage.label}</span>` : ''}</div>`
                + '</div>'
                + '<div class="ctx-person-actions"><button class="ctx-person-talk">💬 Talk</button></div>'
                + '</div>';
        }
        html += '</div></div>';
        game.ui.showCustomPanel('👥 Meet People', html);

        // Portraits and clicks: the whole card opens the conversation
        const body = document.querySelector('#customPanel .custom-panel-body') || document.getElementById('customPanel');
        if (!body) return;
        const cards = [...body.querySelectorAll('.people-cards .ctx-person')];
        const paint = () => {
            for (const card of cards) {
                const npc = npcs.find(n => String(n.id) === card.dataset.npc);
                const canvas = card.querySelector('canvas');
                const ok = npc && NpcPortrait.paint(canvas, personSprite(npc), 0);
                canvas.style.display = ok ? '' : 'none';
                card.querySelector('.ctx-person-emoji').style.display = ok ? 'none' : '';
            }
        };
        paint();
        NpcPortrait.ensureLoaded().then(paint);
        for (const card of cards) {
            card.addEventListener('click', () => ActionMenu.showCharacterDataModal(game, tile, card.dataset.npc, { returnTo: 'meet' }));
        }
    },

    /** A face-to-face scene with one of the townsfolk (peopleScene.js). */
    showCharacterDataModal(game, tile, npcId, options = {}) {
        if (typeof Relationships === 'undefined') return;
        game.ui.hideCustomPanel();
        openPersonScene(game, tile, npcId, options);
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

        let html = '<div>';
        html += lede('Manage companions who travel with you and invite trusted contacts.');
        html += chips([{ icon: '🧭', label: 'Active companions', value: party.length, cls: 'gold' }]);

        // Roster: approval, mood, values, gripes, quests, talk/gift/dismiss (ui/companionsPanel.js)
        html += CompanionsPanel.rosterHtml(game);

        html += sectionHead('Invite Known People');
        if (knownCandidates.length === 0) {
            html += `<div style="${MUTED} margin:0 2px 8px;">No eligible contacts to invite right now.</div>`;
        } else {
            html += rowList(knownCandidates.slice(0, 12).map(entry => {
                const relation = Relationships.getRelationLabel(entry.rel.score || 0);
                return actRow({
                    icon: relation.icon, name: entry.npc.firstName, desc: `${relation.label} · ${entry.rel.score || 0}`,
                    side: `<button onclick="window._partyInvite('${entry.npcId}')" style="${BTN_GOLD}">Invite</button>`
                        + `<button onclick="window._partyOpenProfile('${entry.npcId}')" style="${BTN_DARK}">Profile</button>`,
                });
            }));
        }

        html += '</div>';
        game.ui.showCustomPanel('Travel Party', html);

        CompanionsPanel.bind(game, () => ActionMenu.showTravelPartyMenu(game, tile));

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
        let html = '<div>';
        html += lede(`You sit with ${npc.firstName} (${npc.occupation}) and exchange tales.`);
        html += chips([{ icon: '🤝', label: 'Relationship', value: `+${relGain}`, cls: 'gold' }]);

        const titleColors = {
            kingdom: '#ffcf6a',
            lore: '#d7a36a',
            tip: '#8fd18a',
        };
        for (const outcome of outcomes) {
            const color = titleColors[outcome.type];
            html += card(`<div style="color:#ddd3bb; line-height:1.5;">${outcome.text}</div>`, {
                icon: outcome.icon,
                title: color ? `<span style="color:${color};">${outcome.title}</span>` : outcome.title,
            });
        }

        html += rowList([{ icon: '←', name: 'Back to People', act: 'openTileMenu', args: ['showMeetPeopleMenu', tile.q, tile.r] }]);
        html += '</div>';

        game.ui.showCustomPanel('Stories', html);
        game.ui.updateStats(player, game.world);
    },

    /**
     * Show marriage celebration panel
     */
    _showMarriageCelebration(game, spouse) {
        let html = '<div>';
        html += `<div style="${TITLE}">💍 Just Married! 💍</div>`;
        html += '<div style="text-align:center; font-size:40px; line-height:1.2; margin:0 0 8px;">👫💒🎉</div>';
        html += lede(`You and <strong>${spouse.firstName} ${spouse.dynasty}</strong> are now wed!`);
        html += rowList([
            { icon: '💪', name: '+1 max stamina', desc: 'companionship', tone: 'good' },
            { icon: '⭐', name: '+3 renown' },
            spouse.kingdomId ? { icon: '🏳️', name: '+5 reputation with spouse\'s kingdom' } : null,
            { icon: '👶', name: '<span style="color:#ff9ad5;">You may now have children as time passes!</span>' },
        ]);
        html += `<button data-am-act="closePanel" style="${BTN_GOLD} display:block; width:100%; padding:10px; font-size:14px;">Begin Your New Life Together</button>`;
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
        const liveChildren = (player.children || []).filter(c => c.isAlive);

        html += chips([
            player.spouse ? ['💍', 'Married', ''] : null,
            liveChildren.length ? ['👶', 'Children', liveChildren.length] : null,
            travelParty.length ? ['🧭', 'Travelling', travelParty.length] : null,
            ['😊', 'Friends', friends.length],
            rivals.length ? ['⚡', 'Rivals', rivals.length] : null,
            ['📇', 'Known', knownPeople.length],
        ]);

        // Unfinished business: matters people have brought to you (systems/relationships/matters.js)
        const matters = Relationships.openMatters(player);
        if (matters.length) {
            html += rowList(matters.map(m => {
                const left = Math.max(0, m.matter.expires - (game.world.day || 0));
                return {
                    icon: m.icon, name: `${m.npc.firstName} ${m.npc.dynasty} · ${m.title}`,
                    desc: `in ${m.npc.settlementName || 'town'} · Talk`,
                    attrs: `onclick="window._openMatter('${m.npc.id}')"`,
                    side: `${left} day${left === 1 ? '' : 's'} left`, tone: left <= 2 ? 'bad' : 'warn',
                };
            }), '💌 Unfinished Business');
        }
        window._openMatter = (npcId) => {
            const npc = Relationships.getNPC(npcId);
            const here = game.world.getTile(player.q, player.r);
            const near = here && here.settlement && here.settlement.name === npc.settlementName;
            if (!near && !Relationships.isInTravelParty(player, npcId) && player.spouse !== npcId && !Court.isMember(player, npcId)) {
                game.ui.showNotification('Not Here', `${npc.firstName} is in ${npc.settlementName}. Settle it face to face.`, 'warning');
                return;
            }
            ActionMenu.showCharacterDataModal(game, tile, npcId, { returnTo: 'relationships' });
        };

        // Spouse section
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) {
                const rel = Relationships.getRelationship(player, player.spouse);
                let body = `<div style="${MUTED}">Age ${spouse.age} · ${spouse.occupation} · Affection: ${rel.affection}/100 · Relation: ${rel.score || 0}</div>`;
                body += '<div style="margin-top:6px;">' + ActionMenu._renderAffectionBar(rel.affection) + '</div>';
                body += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
                body += `<div style="margin-top:6px;"><button onclick="window._divorceConfirm()" style="${BTN_RED}">💔 Divorce</button></div>`;
                html += card(body, { icon: '💍', title: `<span style="color:#ff9ad5;">Spouse: ${spouse.firstName} ${spouse.dynasty}</span>`, side: `♥ ${rel.affection}` });
            }
        }

        // Children section
        if (liveChildren.length > 0) {
            html += rowList(liveChildren.map(child => {
                const genderIcon = child.gender === 'male' ? '♂️' : '♀️';
                const isHeir = player.heir === child.id;
                const traitStr = child.traits?.length > 0 ? child.traits.map(t => `${t.icon}`).join(' ') : '';
                return {
                    icon: genderIcon, name: `${child.firstName} ${child.dynasty}`,
                    desc: `Age ${child.age}${traitStr ? ` · ${traitStr}` : ''}`,
                    side: isHeir ? '👑 Heir' : '', tone: isHeir ? 'gold' : '',
                };
            }), '👶 Children');
        }

        // One person you know: the whole row opens their profile
        const personRow = (npc, rel, icon, desc, side, tone) => ({
            icon, name: npc.firstName, desc, side, tone,
            note: _xpNote(rel.score || 0),
            attrs: `onclick="window._openKnownCharacter('${npc.id}')"`,
            title: `${npc.firstName}'s profile`,
        });

        if (travelParty.length > 0) {
            html += rowList(travelParty.map(member => {
                const rel = Relationships.getRelationship(player, member.id);
                const role = PlayerEffects.companionRole(member);
                return { ...personRow(member, rel, '🧭', `${member.occupation || 'traveller'}: ${role.text}`, `${rel.score || 0} · Profile ›`), note: '' };
            }), '🧭 Travel Party');
        }

        if (romanticInterests.length > 0) {
            const rows = [];
            for (const [npcId, rel] of romanticInterests) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive) continue;
                const stage = Relationships.getCourtingStage(rel.affection, false);
                rows.push(personRow(npc, rel, stage.icon, `<span style="color:#f48fb1;">${stage.label}</span> · Affection: ${rel.affection} · Score: ${rel.score || 0}`, 'Profile ›'));
            }
            html += rowList(rows, '💕 Romantic Interests');
        }

        if (friends.length > 0) {
            const rows = [];
            for (const [npcId, rel] of friends) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive || npcId === player.spouse) continue;
                const label = Relationships.getRelationLabel(rel.score);
                rows.push(personRow(npc, rel, label.icon, label.label, `${rel.score} · Profile ›`, 'good'));
            }
            html += rowList(rows, '😊 Friends');
        }

        if (rivals.length > 0) {
            const rows = [];
            for (const [npcId, rel] of rivals) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive) continue;
                const label = Relationships.getRelationLabel(rel.score);
                rows.push(personRow(npc, rel, label.icon, label.label, `${rel.score} · Profile ›`, 'bad'));
            }
            html += rowList(rows, '⚡ Rivals');
        }

        // The House's court (systems/court.js): invite those you know to live at court
        if (player.house && knownPeople.length > 0) {
            const courtN = Court.members(player).length;
            html += rowList([{
                icon: '🏰', name: 'Invite to Your Court',
                desc: `Retainers and courtiers for the House: offices, a regent, counsel · ${courtN} of ${Court.capacity(player)} seats filled`,
                act: 'showHouseCourt', args: ['invite'], side: '›', tone: 'gold',
            }]);
        }

        if (knownPeople.length > 0) {
            html += rowList(knownPeople.slice(0, 16).map(entry => {
                const relation = Relationships.getRelationLabel(entry.rel.score || 0);
                return { ...personRow(entry.npc, entry.rel, relation.icon, relation.label, `${entry.rel.score || 0} · Character Profile ›`), note: '' };
            }), '📇 People You Know');
        }

        if (friends.length === 0 && rivals.length === 0 && romanticInterests.length === 0 && !player.spouse && knownPeople.length === 0 && travelParty.length === 0) {
            html += lede('You haven\'t formed any meaningful relationships yet. Visit settlements and meet people!');
        }

        // Dynasty info
        if (player.dynasty) {
            html += sectionHead('Your Line');
            html += kv('Dynasty', `<span style="color:#ffcf6a;">${player.dynasty.name}</span>`);
            html += kv('Prestige', House.getPrestige(player));
            html += kv('Age', `${player.age} · Max lifespan: ~${player.maxLifespan}`);
        }

        html += '</div>';
        game.ui.showCustomPanel('Relationships', html);

        window._divorceConfirm = () => {
            game.ui.hideCustomPanel();
            let confirmHtml = '<div>';
            confirmHtml += lede('<span style="color:#e0846a;">💔 Divorce.</span> Are you sure you want to end your marriage? This will cost you karma and renown.');
            confirmHtml += rowList([
                { icon: '💔', name: 'Yes, Divorce', desc: 'Costs karma and renown', attrs: 'onclick="window._doDivorce()"', tone: 'bad', side: '−5 karma, −2 renown' },
                { icon: '←', name: 'Cancel', act: 'openTileMenu', args: ['showRelationshipsMenu'] },
            ]);
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
        const at = tile ? [tile.q, tile.r] : [];

        // Dynasty info
        const house = player.house || null;
        let who = `<div style="${MUTED}">${house
            ? `Founded day ${house.foundedDay} · ⭐ Prestige: ${house.prestige || 0} · Generation ${house.generation || 1}`
            : `Founded day ${player.dynasty?.founded || 1} · Prestige: ${House.getPrestige(player)}`}</div>`;
        who += `<div style="${MUTED}">You: ${player.name}, age ${player.age} (max ~${player.maxLifespan})</div>`;
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) who += `<div style="font-size:11px; color:#ff9ad5;">Spouse: ${spouse.firstName} ${spouse.dynasty}, age ${spouse.age}</div>`;
        }
        html += card(who, {
            icon: (house && house.sigil && house.sigil.icon) || '👑',
            title: house ? house.name : 'House ' + (player.dynasty?.name || player.name),
            side: `⭐ ${house ? (house.prestige || 0) : House.getPrestige(player)}`, tone: 'gold',
        });

        // The House's business: one row a page
        const nav = [];
        // A child's reign: the regent, and the choice at majority (systems/regency.js)
        if (player.regency && (player.regency.active || player.regency.ending)) {
            const rg = player.regency;
            nav.push(rg.ending
                ? { icon: '👑', name: 'Coming of Age', desc: 'Decide the regent\'s fate', act: 'showRegencyPanel', side: 'decide', tone: 'warn' }
                : { icon: '👑', name: `Regency — ${rg.regent.name}`, desc: `Loyalty ${rg.regent.loyalty}`, act: 'showRegencyPanel' });
        }
        if (house) nav.push({ icon: '🛡️', name: `Manage ${house.name}`, desc: 'Ambition, offices, demands, plots, Prestige', act: 'openTileMenu', args: ['showHousePanel', ...at], tone: 'gold', side: '›' });
        nav.push({ icon: '👑', name: 'Claims & Crowns', act: 'openTileMenu', args: ['showClaimsPanel', ...at] });
        {
            const unread = (player.letters && player.letters.unread) || 0;
            const open = (player.letters && player.letters.inbox && player.letters.inbox.length) || 0;
            nav.push({ icon: '✉️', name: 'Letters', desc: open ? `${open} open${unread ? `, ${unread} new` : ''}` : '', act: 'showLetters', side: unread ? `${unread} new` : '', tone: unread ? 'gold' : '' });
        }
        {
            // Directed opposition: the realms' regard, a league against you, rival agents (systems/coalitions.js)
            const league = player.coalitions && player.coalitions.active;
            nav.push({ icon: '⚜️', name: 'Threats', desc: league ? league.name : '', act: 'showThreatsPanel', side: league ? 'league' : '', tone: league ? 'bad' : '' });
        }
        {
            // A commission in a realm's army (ui/actionMenu/generalship.js)
            const cm = player.commission;
            nav.push({ icon: '🎖️', name: 'Army Command', desc: cm ? cm.kingdomName : '', act: 'showArmyCommand' });
            // The household guard a realm keeps for you (ui/actionMenu/realmEscort.js)
            const hg = player.realmEscort && player.realmEscort.guard;
            nav.push({ icon: '🛡️', name: 'Household Guard', desc: hg ? hg.kingdomName : '', act: 'showHouseholdGuard' });
        }
        nav.push({ icon: '📜', name: 'House Chronicle', act: 'showHouseChronicle' });
        // The Annals: the House's story as a book (ui/actionMenu/annals.js)
        nav.push({ icon: '📖', name: 'The Annals', act: 'showAnnals' });
        // The game's victory goal and its progress (ui/actionMenu/scenario.js)
        nav.push({ icon: '🏆', name: 'Ambition of this Life', act: 'showAmbitionPanel' });
        html += rowList(nav, 'The House');

        // Children
        if (!player.children || player.children.length === 0) {
            html += lede('You have no children yet. Get married and time will tell!');
        } else {
            html += sectionHead('Children');

            for (const child of player.children) {
                if (!child.isAlive) continue;
                const isHeir = player.heir === child.id;
                const genderIcon = child.gender === 'male' ? '♂️' : '♀️';
                const traitStr = child.traits?.length > 0
                    ? child.traits.map(t => `<span title="${t.name}">${t.icon}</span>`).join(' ')
                    : '<span style="color:#9d937c;">No traits</span>';

                let body = `<div style="${MUTED}">Age ${child.age} · ${child.culture}</div>`;
                body += `<div style="font-size: 11px; margin-top: 2px;">Born: ${traitStr}</div>`;
                body += `<div style="font-size: 11px; margin-top: 2px; color: #c9b27a;">${Upbringing.summary(player, child)}</div>`;
                const where = HeirAgency.status(player, game.world, child);
                if (where) body += `<div style="font-size: 11px; margin-top: 2px; color: #9cc8ff;">${where}</div>`;
                if (child.upbringing && child.upbringing.pending) body += `<div style="font-size: 11px; color: #f0b35a;">⚠️ A matter awaits your decision</div>`;

                // Stats and skills
                const skillLabels = { combat: '⚔️', commerce: '💰', leadership: '👑', diplomacy: '🤝', stealth: '🕵️', cartography: '🗺️' };
                const childSkills = child.skills || {};
                body += '<div class="pk-chips" style="margin:6px 0 4px;">';
                body += `<span class="pk-chip">💪 <b>${child.strength || 5}</b></span>`;
                body += `<span class="pk-chip">✨ <b>${child.charisma || 5}</b></span>`;
                body += `<span class="pk-chip">🧠 <b>${child.intelligence || 5}</b></span>`;
                body += `<span class="pk-chip">🙏 <b>${child.faith || 5}</b></span>`;
                body += `<span class="pk-chip">🍀 <b>${child.luck || 5}</b></span>`;
                for (const [sk, val] of Object.entries(childSkills)) {
                    if (val > 0) body += `<span class="pk-chip dim">${skillLabels[sk] || sk} <b>${val}</b></span>`;
                }
                body += '</div>';

                // Actions
                body += `<div><button data-am-act="showChildPanel" data-am-args='["${child.id}"]' style="${BTN_GOLD}">📖 ${child.upbringing && child.upbringing.comeOfAge ? 'Profile & Place' : 'Upbringing'}</button>`;
                if (!isHeir) body += `<button onclick="window._designateHeir('${child.id}')" style="${BTN_DARK}">👑 Designate Heir</button>`;
                body += '</div>';

                const block = card(body, { icon: genderIcon, title: `${child.firstName} ${child.dynasty}`, side: isHeir ? '👑 Designated Heir' : '', tone: isHeir ? 'gold' : '' });
                html += isHeir ? block.replace('<div class="pk-card', '<div style="border-color: rgba(245,197,66,0.45);" class="pk-card') : block;
            }
        }

        // Heir summary
        if (player.heir) {
            const heirChild = (player.children || []).find(c => c.id === player.heir);
            if (heirChild && heirChild.isAlive) {
                const eligible = heirChild.age >= settings.minAgeToPlay;
                html += sectionHead('Succession');
                html += kv('Current heir', `<span style="color:#ffcf6a;">${heirChild.firstName}</span> (age ${heirChild.age})`);
                html += kv('Ready', eligible
                    ? '<span style="color:#8fd18a;">✓ Eligible to succeed you</span>'
                    : `<span style="color:#f0b35a;">⏳ Must be ${settings.minAgeToPlay} to take over (currently ${heirChild.age})</span>`);
                html += kv('Inheritance', `${Math.round(settings.inheritanceGoldPercent * 100)}% gold, ${Math.round(settings.inheritanceRenownPercent * 100)}% renown`);
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
        html += '<div style="text-align:center; margin:2px 0 10px;">';
        html += `<div style="font-size:28px; line-height:1.2;">${house.sigil?.icon || '🛡️'}</div>`;
        html += `<div style="${TITLE} margin:0;">${house.name}</div>`;
        if (house.motto) html += `<div style="font-style:italic; color:#cbbf9f; font-size:12px;">&ldquo;${house.motto}&rdquo;</div>`;
        html += `<div style="margin-top:6px; display:flex; justify-content:center; align-items:center; gap:6px; flex-wrap:wrap;">${chips([
            ['🧬', 'Generation', house.generation],
            ['📅', 'Founded day', house.foundedDay],
            { icon: '⭐', label: 'Prestige', value: house.prestige, cls: 'gold' },
        ]).replace('class="pk-chips"', 'class="pk-chips" style="margin:0;"')}<button onclick="window._houseRename()" style="${BTN_PLAIN} margin:0;">✎ Rename &amp; Motto</button></div>`;
        html += '</div>';

        // Ambition
        html += sectionHead('🏛️ Ambition');
        if (house.ambition) {
            const def = House._getAmbitionDef(house.ambition.id);
            let body = '';
            for (const ms of house.ambition.milestones) {
                const md = def.milestones.find(x => x.id === ms.id);
                body += `<div style="color:${ms.done ? '#8fd18a' : '#9d937c'};">${ms.done ? '✓' : '○'} ${md ? md.label : ms.id}</div>`;
            }
            body += `<div style="color:${house.ambition.capstoneDone ? '#8fd18a' : '#f0b35a'}; margin-top:2px;">${house.ambition.capstoneDone ? '★' : '☆'} ${def.capstone.label}</div>`;
            html += card(body, { icon: '🏛️', title: def.name, side: house.ambition.capstoneDone ? 'fulfilled' : '', tone: 'good' });
            if (house.ambition.capstoneDone) {
                html += rowList([{ icon: '🏛️', name: 'Choose a New Ambition', attrs: 'onclick="window._houseChooseAmbition()"', side: '›', tone: 'gold' }]);
            }
        } else {
            html += rowList([{ icon: '🏛️', name: 'Choose an Ambition', desc: 'A goal for the House, with Prestige at its end', attrs: 'onclick="window._houseChooseAmbition()"', side: '›', tone: 'gold' }]);
        }
        // Honours won by fulfilled ambitions (each raises the House's fame everywhere — systems/fame.js)
        if (Array.isArray(house.honours) && house.honours.length) {
            html += `<div style="font-size:11px; color:#d8c27a; margin:4px 2px 8px;">🏅 Honours: ${house.honours.map(h => `${h.name} <span style="color:#9d937c;">(+${h.fame} fame)</span>`).join(' · ')}</div>`;
        }

        // Demands on the House: benevolences, forced loans, guild and rival tribute (systems/demands.js)
        const demands = Demands.open(player);
        const crownLoans = Demands.loans(player);
        if (demands.length || crownLoans.length) {
            html += sectionHead('📜 Demands Upon the House');
            const dBtn = (label, handler, enabled, style = BTN_DARK) => `<button ${enabled ? `onclick="${handler}"` : 'disabled'} style="${enabled ? style : BTN_OFF}">${label}</button>`;
            for (const d of demands) {
                let body = `<div style="color:#cbbf9f; margin:0 0 6px;">${d.text}</div><div>`;
                body += dBtn(`💰 Pay (${d.amount}g)`, `window._demandAct('pay', ${d.id})`, player.gold >= d.amount, BTN_GOLD);
                body += dBtn(d.negotiated ? 'Haggled' : `🗣️ Negotiate (${Math.round(Demands.negotiateChance(player) * 100)}%)`, `window._demandAct('negotiate', ${d.id})`, !d.negotiated);
                body += dBtn('✋ Refuse', `window._demandAct('refuse', ${d.id})`, true, BTN_RED);
                body += '</div>';
                html += card(body, { icon: d.icon, title: d.title, side: `${Math.max(0, d.dueDay - game.world.day)} day(s)`, tone: 'warn' });
            }
            html += rowList(crownLoans.map(l => ({
                icon: '👑', name: `Lent ${l.amount}g to ${l.from}`,
                desc: `due day ${l.dueDay}${l.defers ? ` (deferred ${l.defers}×)` : ''}`,
                side: price(l.amount),
            })));
        }

        // Townsfolk named in rival plots — confront them in their town (systems/schemes.js)
        const suspects = Schemes.suspects(player, game.world);
        const informants = Object.values(house.informants || {}).filter(i => i && i.untilDay >= game.world.day);
        if (suspects.length) {
            html += rowList(suspects.map(s => ({
                icon: '🗡️', name: `${s.name}, ${s.role} of ${s.town}`,
                desc: `Agent of ${s.rivalName}. Find them in town to accuse, turn or spare.`,
                side: s.status === 'plotting' ? 'plot in hand' : '', tone: 'bad',
            })), '🕵️ Suspects');
        }
        html += rowList(informants.map(i => ({
            icon: '👂', name: `${i.name} of ${i.town}`, desc: 'Informs for you',
            side: `until day ${i.untilDay}`, tone: 'good',
        })), suspects.length ? '' : '👂 Informants');

        // The court: those not of the blood who live at the House (systems/court.js)
        const courtView = Court.view(player);
        html += rowList([
            {
                icon: '👥', name: 'The Court',
                desc: courtView.length
                    ? courtView.slice(0, 4).map(c => esc(c.npc.firstName)).join(', ') + (courtView.length > 4 ? ` and ${courtView.length - 4} more` : '')
                    : 'No one lives at your court yet. Invite people you know.',
                note: `<span style="color:#9d937c;">${courtView.length} of ${Court.capacity(player)} seats · ${Court.dailyCost(player)}g a day in stipends${house.regentDesignate ? ' · a regent named' : ''}</span>`,
                act: 'showHouseCourt', side: 'Open ›', tone: 'gold',
            },
        ], '👥 The Court');

        // Offices / roles: the row appoints
        html += rowList(House.ROLE_IDS.map(roleId => {
            const def = roleDefs[roleId];
            const memberId = house.roles[roleId];
            const member = memberId ? House._findMember(player, memberId) : null;
            const lv = memberId ? House.officerLoyalty(player, memberId) : null;
            const loyalty = lv != null ? lv : '?';
            const courtier = member && House.isCourtier(player, memberId);
            return {
                icon: '🏰', name: def.label, desc: def.blurb,
                note: member ? `<span style="color:#ffcf6a;">${esc(member.firstName)}</span> <span style="color:#9d937c;">(${courtier ? 'courtier, ' : ''}loyalty ${loyalty})</span>` : '',
                attrs: `onclick="window._houseAssignRole('${roleId}')"`,
                side: member ? 'Assign ›' : '<span style="color:#9d937c;">Vacant</span><br><span style="font-size:10.5px; color:#9d937c;">Assign ›</span>',
            };
        }), '🏰 Offices');

        // Rivals
        const rivalKeys = Object.keys(house.rivals || {});
        if (rivalKeys.length) {
            const rows = rivalKeys.map(k => {
                const r = house.rivals[k];
                const feud = r.feud || 0;
                const label = feud >= 60 ? 'Hostile' : feud >= 30 ? 'Wary' : 'Cool';
                return {
                    icon: '⚔️', name: r.name,
                    desc: r.head ? `${RivalHouses.headName(r)}, ${r.head.age} · ${RivalHouses.doing(game.world, r)}` : '',
                    side: `${label} (${feud})`, tone: feud >= 60 ? 'bad' : feud >= 30 ? 'warn' : '',
                };
            });
            if (rivalKeys.some(k => house.rivals[k].head)) rows.push({ icon: '🏰', name: 'Rival Houses', desc: 'Their lords, purses and doings', act: 'showRivalHouses', side: '›' });
            html += rowList(rows, '⚔️ Rival Houses');
        }

        // Wars and ultimatums from kingdoms
        const wars = RealmWars.wars(player);
        const ultimatums = RealmWars.ultimatums(player);
        if (wars.length || ultimatums.length) {
            html += sectionHead('⚔️ Wars &amp; Ultimatums');
            const warBtn = (label, handler, enabled, style = BTN_RED) => `<button ${enabled ? `onclick="${handler}"` : 'disabled'} style="${enabled ? style : BTN_OFF}">${label}</button>`;
            for (const u of ultimatums) {
                const body = `<div style="color:#cbbf9f; margin:0 0 6px;">Demands ${u.tribute} gold, or it declares war.</div>`
                    + `<div>${warBtn(`💰 Pay tribute (${u.tribute}g)`, `window._warAct('tribute', '${u.kingdomId}')`, player.gold >= u.tribute, BTN_GOLD)}</div>`;
                html += card(body, { icon: '📜', title: u.name, side: `${Math.max(0, u.dueDay - game.world.day)} day(s)`, tone: 'warn' });
            }
            for (const w of wars) {
                const k = game.world.getKingdom(w.kingdomId);
                if (!k) continue;
                const peace = RealmWars.peacePrice(player, k);
                const canDemand = w.score >= RealmWars.CONFIG.enforcePeaceScore;
                let body = `<div style="color:#cbbf9f; margin:0 0 4px;">Day ${game.world.day - w.startDay} · hosts broken ${w.hostsDefeated} · holdings lost ${w.holdingsLost}</div>`;
                for (const h of w.hosts) {
                    const t = h.target;
                    body += `<div style="color:#e0846a; font-size:11px;">🚩 ${h.name} (str ${h.strength}) at (${h.q}, ${h.r}) → ${t.kind === 'colony' ? t.name : t.type} (${t.q}, ${t.r})</div>`;
                }
                body += '<div style="margin-top:6px;">';
                body += warBtn(`🕊️ Buy peace (${peace}g)`, `window._warAct('peace', '${w.kingdomId}')`, player.gold >= peace, BTN_DARK);
                body += warBtn(`👑 Demand peace (+${RealmWars.reparations(k)}g)`, `window._warAct('demand', '${w.kingdomId}')`, canDemand, BTN_GOLD);
                body += '</div>';
                html += card(body, { icon: '⚔️', title: `War with ${w.name}`, side: `Score ${w.score}`, tone: w.score >= 0 ? 'good' : 'bad' });
            }
        }

        // Plots against the House — only revealed schemes are shown
        const plots = Schemes.known(player);
        html += sectionHead('🗡️ Plots Against You');
        if (!plots.length) {
            html += `<div style="${MUTED} margin:0 2px 8px;">No known plots. Spies, a Spymaster and counter-espionage missions help uncover schemes before they strike.</div>`;
        }
        const plotBtn = (label, handler, enabled = true) => `<button ${enabled ? `onclick="${handler}"` : 'disabled'} style="${enabled ? BTN_DARK : BTN_OFF}">${label}</button>`;
        for (const s of plots) {
            const def = Schemes.TYPES[s.type];
            const days = Math.max(0, s.dueDay - game.world.day);
            const idleSpies = ((player.espionage && player.espionage.spies) || []).filter(sp => sp.status === 'idle').length;
            const goldCost = Schemes.bribeGoldCost(player, s);
            const presCost = Schemes.bribePrestigeCost(player, s);
            let body = `<div style="color:#cbbf9f; margin:0 0 6px;">${Schemes.describe(s)}.${s.guarded ? ' <span style="color:#8fd18a;">Guarded.</span>' : ''}</div><div>`;
            if (def && def.guard) {
                body += plotBtn(s.guarded ? 'Guarded' : `${def.guard.label} (${def.guard.cost}g, ${Math.round(def.guard.success * 100)}%)`,
                    `window._schemeAct('guard', ${s.id})`, !s.guarded && player.gold >= def.guard.cost);
            }
            body += plotBtn(s.spyTried ? 'Spy failed' : `🕵️ Send spy${idleSpies ? '' : ' (none idle)'}`, `window._schemeAct('spy', ${s.id})`, !s.spyTried && idleSpies > 0);
            body += plotBtn(`💰 Buy off (${goldCost}g)`, `window._schemeAct('gold', ${s.id})`, player.gold >= goldCost);
            body += plotBtn(`⭐ Buy off (${presCost})`, `window._schemeAct('prestige', ${s.id})`, house.prestige >= presCost);
            body += '</div>';
            html += card(body, { icon: def ? def.icon : '🗡️', title: def ? def.name : s.type, side: `${days} day(s)`, tone: 'bad' });
        }

        // Spend Prestige — what the House's standing can buy that gold can't
        const sinks = House._getSinks();
        const claim = Titles.getClaimableTitle(player, game.world);
        const here = tile && tile.settlement ? tile : game.world.getTile(player.q, player.r);
        const swayKingdomId = (here && here.settlement && here.settlement.kingdom) || player.allegiance || null;
        const swayKingdom = swayKingdomId ? game.world.getKingdom(swayKingdomId) : null;
        // One sink as a row: the whole row spends; greyed with the reason when blocked or short
        const sinkRow = (icon, name, cost, desc, handler, blocked) => {
            const short = house.prestige < cost;
            return {
                icon, name, desc, attrs: `onclick="${handler}"`,
                off: !!blocked || short,
                why: blocked || `Needs ⭐${cost} Prestige (you have ${house.prestige})`,
                side: `⭐ ${cost}`, tone: short ? 'bad' : 'gold',
            };
        };
        const favorGold = House.FAVOR_GOLD_BASE + House.FAVOR_GOLD_PER_GENERATION * (house.generation || 1);
        html += rowList([
            sinkRow('📜', claim.titleId ? `Press a Claim: ${claim.title.name}` : 'Press a Claim', sinks.pressClaim,
                claim.titleId
                    ? `Take the office of <strong>${claim.title.name}</strong> — the House's name sets aside its reputation and renown requirements.`
                    : 'Claim the next office up, setting aside its reputation and renown requirements.',
                'window._housePressClaim()', claim.titleId ? null : claim.reason),
            sinkRow('💍', 'Arrange a Prestigious Marriage', sinks.prestigiousMarriage,
                'A noble of this settlement, already fond of you, joins those you can court. Marrying a noble brings renown, standing with their kingdom and Prestige.',
                'window._houseNobleMatch()',
                player.spouse ? 'You are already married.' : (!(here && here.settlement) ? 'Visit a settlement to arrange a match.' : null)),
            sinkRow('🤝', `Call in a Favor: 💰 Gold (${favorGold}g)`, sinks.callInFavor,
                'An allied House repays old debts.', "window._houseFavor('gold')", null),
            swayKingdom ? sinkRow('🤝', `Call in a Favor: 👑 +${House.FAVOR_REPUTATION} rep · ${swayKingdom.name}`, sinks.callInFavor,
                'An allied House repays old debts.', "window._houseFavor('influence')", null) : null,
        ], '⭐ Spend Prestige');

        // Chronicle
        html += sectionHead('📜 Chronicle');
        const recent = (house.history || []).slice(-6).reverse();
        html += '<div style="font-size:11px; color:#cbbf9f; max-height:120px; overflow-y:auto; margin:0 2px 8px;">';
        for (const h of recent) {
            html += `<div style="padding:3px 0; border-bottom:1px solid rgba(245,197,66,0.07);"><span style="color:#9d937c;">Day ${h.day}:</span> ${h.text}</div>`;
        }
        html += '</div>';

        html += rowList([{ icon: '←', name: 'Back to Dynasty', act: 'openTileMenu', args: ['showDynastyMenu', ...(tile ? [tile.q, tile.r] : [])] }]);
        html += '</div>';
        game.ui.showCustomPanel('House', html);

        // ── Handlers ──
        const afterSink = (title, result, okText) => {
            if (result.success) game.ui.showNotification(title, okText, 'success');
            else game.ui.showNotification(title, result.reason || 'Not possible right now.', 'error');
            game.ui.updateStats(player, game.world);
            ActionMenu.showHousePanel(game, tile);
        };
        window._warAct = (kind, kingdomId) => {
            let res;
            if (kind === 'tribute') res = RealmWars.payTribute(player, game.world, kingdomId);
            else if (kind === 'peace') res = RealmWars.sueForPeace(player, game.world, kingdomId);
            else res = RealmWars.demandPeace(player, game.world, kingdomId);
            if (!res.success) game.ui.showNotification('⚔️ War', res.reason || 'Not possible.', 'error');
            else if (kind === 'tribute') game.ui.showNotification('📜 Tribute Paid', `War is averted, for now. −${res.cost} gold.`, 'success');
            else if (kind === 'peace') game.ui.showNotification('🕊️ Peace Bought', `The war is over. −${res.cost} gold.`, 'success');
            else game.ui.showNotification('👑 Victory', `The enemy sues for peace and pays ${res.gold} gold.`, 'success');
            game.ui.updateStats(player, game.world);
            ActionMenu.showHousePanel(game, tile);
        };
        window._demandAct = (kind, id) => {
            const res = Demands.answer(player, game.world, id, kind);
            if (!res.success) game.ui.showNotification('📜 Demand', res.reason || 'Not possible.', 'error');
            else game.ui.showNotification(kind === 'refuse' ? '✋ Refused' : kind === 'negotiate' && !res.paid ? '🗣️ No Bargain' : '💰 Paid', res.text, kind === 'refuse' ? 'warning' : 'success');
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
            let h = `<div>${sectionHead('Name Your House')}
                <input id="houseNameInput" value="${cur.replace(/"/g, '&quot;')}" style="${FIELD}" />
                <input id="houseMottoInput" value="${(house.motto || '').replace(/"/g, '&quot;')}" placeholder="Motto (optional)" style="${FIELD}" />
                <button onclick="window._houseSaveName()" style="${BTN_GOLD} display:block; width:100%; padding:8px;">Save</button></div>`;
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
            let h = '<div>';
            const open = House.ambitions(house);
            if (!open.length) h += lede('Your House has fulfilled every ambition open to it. Its name is written in the histories.');
            h += rowList(open.map(a => {
                const rw = a.reward || {};
                const rwText = [rw.prestige ? `${rw.prestige} Prestige` : '', rw.gold ? `${rw.gold} gold` : '', rw.renown ? `${rw.renown} renown` : '', rw.honour ? `honour: ${rw.honour.name}` : ''].filter(Boolean).join(' · ');
                return {
                    icon: '🏛️', name: a.name, desc: a.blurb,
                    note: rwText ? `<span style="color:#c9b77a;">Reward: ${rwText}</span>` : '',
                    attrs: `onclick="window._houseSetAmbition('${a.id}')"`,
                    side: `${a.tier > 1 ? `<span style="font-size:10px; color:#d8c27a;">Tier ${a.tier}</span><br>` : ''}Pursue ›`, tone: 'gold',
                };
            }), 'Choose an Ambition');
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
            // The heir must be of the blood; every other office may go to a courtier
            const courtiers = roleId === 'heir' ? [] : Court.view(player);
            if (!kids.length && !courtiers.length) {
                game.ui.showNotification('Offices', roleId === 'heir' ? 'You have no children to name your heir.' : 'You have no family of age and no one at court to appoint. Invite people to your court.', 'info');
                return;
            }
            const skill = roleDefs[roleId].skill;
            const held = (id) => {
                const r = Court.officeOf(player, id);
                return r && r !== roleId ? ` · now ${roleDefs[r].label}` : '';
            };
            let h = '<div>';
            h += rowList(kids.map(c => ({
                icon: c.gender === 'female' ? '👧' : '👦', name: esc(c.firstName), desc: `Of the blood, age ${c.age}${held(c.id)}`,
                attrs: `onclick="window._houseDoAssign('${roleId}','${c.id}')"`,
                side: `${skill} ${(c.skills && c.skills[skill]) || 0}`,
            })), kids.length ? `Appoint ${roleDefs[roleId].label}: Family` : '');
            h += rowList(courtiers.map(c => ({
                icon: '👥', name: esc(c.name), desc: `${esc(c.occupation)}, age ${c.age} · loyalty ${c.loyalty}${held(c.id)}`,
                attrs: `onclick="window._houseDoAssign('${roleId}','${c.id}')"`,
                side: `${skill} ${c.skills[skill] || 0}`,
            })), courtiers.length ? `Appoint ${roleDefs[roleId].label}: The Court` : '');
            h += rowList([{ icon: '∅', name: 'Leave Vacant', attrs: `onclick="window._houseDoClear('${roleId}')"`, tone: 'bad' }]);
            h += '</div>';
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
     * The House's court (systems/court.js): who lives there, their skills,
     * loyalty, stipend and office; invite those you know, name a
     * regent-designate. view: null (the roll) | 'invite' | 'member' | 'offer' | 'designate'.
     */
    showHouseCourt(game, view = null, npcId = null) {
        const player = game.player;
        const world = game.world;
        const house = player.house;
        if (!house) {
            game.ui.showNotification('Court', 'Your House has not yet been founded.', 'info');
            return;
        }
        Court.ensure(player);
        const roleDefs = House.roleDefs();
        const cap = Court.capacity(player);
        const rows = Court.view(player);
        const skillLine = (sk) => Court.SKILLS.map(k => `${k.slice(0, 4)} ${sk[k] || 0}`).join(' · ');
        const loyaltyTone = (v) => (v < 30 ? 'bad' : v < 50 ? 'warn' : 'good');
        const back = { icon: '←', name: 'Back to the Court', act: 'showHouseCourt' };
        let html = '<div>';

        if (view === 'member') {
            const c = rows.find(r => r.id === npcId);
            if (!c) return ActionMenu.showHouseCourt(game);
            const office = c.office ? roleDefs[c.office].label : null;
            let body = `<div style="color:#cbbf9f;">${esc(c.occupation)}, age ${c.age}${c.npc.settlementName ? ` · of ${esc(c.npc.settlementName)}` : ''} · at court since day ${c.since}</div>`;
            body += `<div style="margin-top:6px; color:#ece2c8;">${skillLine(c.skills)}</div>`;
            body += `<div style="margin-top:6px;">Loyalty <b>${c.loyalty}</b>${c.owed ? ` · <span style="color:#e0846a;">owed ${c.owed}g</span>` : ''} · their purse ${c.purse}g</div>`;
            html += card(body, { icon: '👥', title: esc(c.name), side: office ? `🏰 ${office}` : (c.regentDesignate ? '👑 Regent-designate' : ''), tone: loyaltyTone(c.loyalty) });
            const pay = c.stipend;
            const canRaise = (player.gold || 0) >= pay + 1;
            const designate = Regency.designateOptions(player, world).some(o => o.id === c.id);
            html += rowList([
                { icon: '💰', name: 'Raise their stipend', desc: `${pay}g → ${pay + 1}g a day (they think ${c.expected}g fair)`, attrs: `onclick="window._courtUI.stipend('${c.id}', 1)"`, side: price(pay + 1, canRaise), tone: 'gold' },
                pay > 0 ? { icon: '✂️', name: 'Cut their stipend', desc: `${pay}g → ${pay - 1}g a day. They will not thank you.`, attrs: `onclick="window._courtUI.stipend('${c.id}', -1)"`, side: price(pay - 1), tone: 'warn' } : null,
                { icon: '🏰', name: office ? `Office: ${office}` : 'Appoint to an office', desc: 'Steward, Marshal, Chancellor or Spymaster. The heir must be of the blood.', act: 'showHouseCourt', args: ['office', c.id], side: '›' },
                c.regentDesignate
                    ? { icon: '👑', name: 'Regent-designate', desc: 'Should you die leaving a child heir, they rule in the child\'s name. Click to unname them.', attrs: 'onclick="window._courtUI.designate(null)"', side: '✓', tone: 'gold' }
                    : { icon: '👑', name: 'Name as regent-designate', desc: 'To rule for a child heir should you die', off: !designate, why: 'They cannot be named regent now', attrs: `onclick="window._courtUI.designate('${c.id}')"`, side: '›' },
                { icon: '💬', name: 'Speak with them', attrs: `onclick="window._courtUI.talk('${c.id}')"`, side: '›' },
                { icon: '🚪', name: 'Dismiss from court', desc: c.owed ? `Pays the ${c.owed}g owed, if you can` : 'They go home, a little hurt', attrs: `onclick="window._courtUI.dismiss('${c.id}')"`, side: '›', tone: 'bad' },
                back,
            ]);
        } else if (view === 'office') {
            const c = rows.find(r => r.id === npcId);
            if (!c) return ActionMenu.showHouseCourt(game);
            html += lede(`An office for <strong>${esc(c.name)}</strong>. What they bring scales with their skill and their loyalty (${c.loyalty}).`);
            html += rowList(House.ROLE_IDS.filter(r => r !== 'heir').map(r => {
                const def = roleDefs[r];
                const holder = house.roles[r] ? House._findMember(player, house.roles[r]) : null;
                const mine = house.roles[r] === c.id;
                return {
                    icon: '🏰', name: def.label, desc: `${def.blurb} ${def.skill} ${c.skills[def.skill] || 0}`,
                    note: holder && !mine ? `<span style="color:#9d937c;">Now held by ${esc(holder.firstName)}</span>` : '',
                    attrs: mine ? `onclick="window._courtUI.clearOffice('${r}', '${c.id}')"` : `onclick="window._courtUI.office('${r}', '${c.id}')"`,
                    side: mine ? '✓ Held · vacate' : 'Appoint ›', tone: mine ? 'gold' : '',
                };
            }), 'Offices');
            html += rowList([{ icon: '←', name: `Back to ${esc(c.npc.firstName)}`, act: 'showHouseCourt', args: ['member', c.id] }]);
        } else if (view === 'invite') {
            html += lede(`Invite someone you know to live at the court of <strong>${esc(house.name)}</strong> for a daily stipend. Friendship, the House's Prestige and rank, and the stipend weigh with them; those bound elsewhere will not come.`);
            html += chips([{ icon: '👑', label: 'Seats', value: `${rows.length} / ${cap}`, cls: rows.length >= cap ? '' : 'gold' }, ['⭐', 'Prestige', house.prestige || 0]]);
            const pros = Court.prospects(player, world).slice(0, 16);
            if (!pros.length) html += lede('You know no one who could be asked. Meet people in the towns first.');
            html += rowList(pros.map(({ npc, rel, odds }) => {
                const label = Relationships.getRelationLabel(rel.score || 0);
                return {
                    icon: label.icon, name: `${esc(npc.firstName)} ${esc(npc.dynasty || '')}`,
                    desc: `${esc(npc.occupation || 'commoner')}, age ${npc.age} · ${label.label} (${rel.score || 0}) · asks ~${odds.expected}g a day`,
                    off: !odds.ok, why: odds.reason,
                    attrs: `onclick="window._courtUI.offer('${npc.id}')"`,
                    side: odds.ok ? `${Math.round(odds.chance * 100)}% ›` : '',
                };
            }), 'People You Know');
            html += rowList([back]);
        } else if (view === 'offer') {
            const npc = Relationships.getNPC(npcId);
            if (!npc) return ActionMenu.showHouseCourt(game, 'invite');
            const exp = Court.expectedStipend(npc);
            const tiers = [
                { icon: '💰', name: 'A modest stipend', pay: Math.max(1, exp - 1) },
                { icon: '💰', name: 'A fair stipend', pay: exp },
                { icon: '💎', name: 'A generous stipend', pay: Math.ceil(exp * 1.5) },
            ];
            html += lede(`What will you offer <strong>${esc(npc.firstName)}</strong> to live at your court? They think ${exp}g a day fair. A welcome purse of ${Court.config().joinDays} days' stipend is paid when they accept.`);
            html += rowList(tiers.map(t => {
                const o = Court.inviteOdds(player, world, npc.id, t.pay);
                const afford = (player.gold || 0) >= o.joinCost;
                return {
                    icon: t.icon, name: `${t.name}: ${t.pay}g a day`,
                    desc: o.ok ? `${Math.round(o.chance * 100)}% they accept · welcome purse ${o.joinCost}g` : '',
                    off: !o.ok || !afford, why: !o.ok ? o.reason : `The welcome purse is ${o.joinCost}g`,
                    attrs: `onclick="window._courtUI.invite('${npc.id}', ${t.pay})"`,
                    side: price(o.joinCost, afford), tone: 'gold',
                };
            }), `Invite ${esc(npc.firstName)}`);
            html += rowList([{ icon: '←', name: 'Back to the invitations', act: 'showHouseCourt', args: ['invite'] }]);
        } else if (view === 'designate') {
            const opts = Regency.designateOptions(player, world);
            html += lede('Should you die leaving a child heir, who rules in the child\'s name until they come of age? The one you name is offered first at your deathbed, and ruled by if you choose no other. Your spouse, a grown child or a courtier may be named.');
            html += rowList(opts.map(o => ({
                icon: o.kind === 'courtier' ? '👥' : o.kind === 'spouse' ? '💍' : '🧑', name: esc(o.name),
                desc: `${esc(o.blurb)} · loyalty ${o.loyalty}, ambition ${o.ambition}`,
                attrs: `onclick="window._courtUI.designate('${o.id}')"`,
                side: house.regentDesignate === o.id ? '✓ Named' : 'Name ›', tone: house.regentDesignate === o.id ? 'gold' : '',
            })), 'Regent-designate');
            if (!opts.length) html += lede('There is no one to name: no spouse, no grown child at home, no one at court.');
            if (house.regentDesignate) html += rowList([{ icon: '∅', name: 'Name no one', desc: 'The choice will be made at your death', attrs: 'onclick="window._courtUI.designate(null)"', tone: 'bad' }]);
            html += rowList([back]);
        } else {
            html += lede(`Those not of the blood who live at the court of <strong>${esc(house.name)}</strong>: retainers to hold its offices, counsel it, and rule for a child heir. Each is paid a stipend from your purse every day.`);
            html += chips([
                { icon: '👑', label: 'Seats', value: `${rows.length} / ${cap}`, cls: 'gold' },
                ['💰', 'Stipends', `${Court.dailyCost(player)}g/day`],
                ['⭐', 'Prestige', house.prestige || 0],
            ]);
            if (!rows.length) html += lede('No one lives at your court yet.');
            html += rowList(rows.map(c => ({
                icon: c.office ? '🏰' : c.regentDesignate ? '👑' : '👥',
                name: `${esc(c.name)}${c.office ? ` <span style="color:#d8c27a; font-size:11px;">${roleDefs[c.office].label}</span>` : ''}`,
                desc: `${esc(c.occupation)}, age ${c.age} · ${skillLine(c.skills)}`,
                note: `<span style="color:${c.loyalty < 30 ? '#e0846a' : c.loyalty < 50 ? '#f0b35a' : '#8fd18a'};">Loyalty ${c.loyalty}</span>${c.owed ? ` <span style="color:#e0846a;">· owed ${c.owed}g</span>` : ''}${c.regentDesignate ? ' <span style="color:#d8c27a;">· regent-designate</span>' : ''}`,
                act: 'showHouseCourt', args: ['member', c.id],
                side: `${c.stipend}g/day ›`, tone: loyaltyTone(c.loyalty),
            })), 'Members');
            const des = house.regentDesignate ? Regency.designateOptions(player, world).find(o => o.id === house.regentDesignate) : null;
            html += rowList([
                { icon: '✉️', name: 'Invite someone you know', desc: rows.length >= cap ? 'Your court is full: more Prestige or a higher rank makes room' : `${cap - rows.length} seat${cap - rows.length === 1 ? '' : 's'} free`, act: 'showHouseCourt', args: ['invite'], side: '›', tone: 'gold' },
                { icon: '👑', name: 'Regent-designate', desc: des ? `${esc(des.name)}, ${esc(des.blurb.replace(/, your named regent$/, ''))}` : 'No one named to rule for a child heir', act: 'showHouseCourt', args: ['designate'], side: '›' },
                { icon: '←', name: 'Back to the House', act: 'showHousePanel', side: '' },
            ], 'The Court\'s Business');
        }
        html += '</div>';
        game.ui.showCustomPanel('👥 The Court', html);

        const done = (res, title, then) => {
            if (!res || !res.success) game.ui.showNotification(title, (res && res.reason) || 'Not possible.', 'error');
            game.ui.updateStats(player, world);
            then();
        };
        window._courtUI = {
            offer: (id) => ActionMenu.showHouseCourt(game, 'offer', id),
            invite: (id, stipend) => {
                const res = Court.invite(player, world, id, { stipend });
                if (!res.success) return done(res, '👥 Court', () => ActionMenu.showHouseCourt(game, 'offer', id));
                game.ui.showNotification(res.accepted ? '👥 A New Courtier' : '🙅 Declined', res.reason, res.accepted ? 'success' : 'warning');
                game.ui.updateStats(player, world);
                if (res.accepted) ActionMenu.showHouseCourt(game, 'member', id);
                else ActionMenu.showHouseCourt(game, 'invite');
            },
            stipend: (id, step) => {
                const e = Court.entry(player, id);
                if (!e) return;
                done(Court.setStipend(player, id, e.stipend + step), '💰 Stipend', () => ActionMenu.showHouseCourt(game, 'member', id));
            },
            office: (roleId, id) => {
                const res = House.assignRole(player, roleId, id);
                if (res.success) game.ui.showNotification('🏰 Appointed', `${Relationships.getNPC(id).firstName} is your ${roleDefs[roleId].label}.`, 'success');
                done(res, '🏰 Office', () => ActionMenu.showHouseCourt(game, 'member', id));
            },
            clearOffice: (roleId, id) => {
                done({ success: House.clearRole(player, roleId) }, '🏰 Office', () => ActionMenu.showHouseCourt(game, 'member', id));
            },
            designate: (id) => {
                const res = Regency.designate(player, world, id);
                if (res.success) game.ui.showNotification('👑 Regent-designate', res.text, 'success');
                done(res, '👑 Regent-designate', () => ActionMenu.showHouseCourt(game, id && Court.isMember(player, id) ? 'member' : 'designate', id));
            },
            talk: (id) => ActionMenu.showCharacterDataModal(game, null, id, {}),
            dismiss: (id) => {
                const res = Court.dismiss(player, world, id);
                if (res.success) game.ui.showNotification('🚪 Dismissed', res.text, 'info');
                done(res, '🚪 Dismiss', () => ActionMenu.showHouseCourt(game, res.success ? null : 'member', id));
            },
        };
    },

    /**
     * Show death / succession screen when the player dies
     */
    showDeathScreen(game, cause) {
        if (typeof Relationships === 'undefined') return;
        const player = game.player;
        const eligibleHeirs = Relationships.getEligibleHeirs(player);

        let html = '<div>';
        const DEATH = `${TITLE} color:#e0846a;`;

        if (cause === 'starvation') {
            html += `<div style="${DEATH}">💀 Starvation</div>`;
            html += lede(`${player.name} has perished from starvation after ${player.starvationDays || '?'} days without food, at the age of ${player.age}.`);
            html += `<p style="${QUOTE}">"Even the mightiest lord cannot defy hunger forever."</p>`;
        } else if (cause === 'drowning') {
            // Spent or frozen in the water (player/swimming.js)
            html += `<div style="${DEATH}">🌊 Drowned</div>`;
            html += lede(`${player.name} went under and did not come up again, at the age of ${player.age}.`);
            html += `<p style="${QUOTE}">"The water keeps what it takes."</p>`;
        } else if (cause === 'illness' || cause === 'wounds') {
            // Death from a disease or festering wounds (systems/ailments.js)
            const dc = (player.ailments && player.ailments.deathCause) || {};
            const what = dc.name ? dc.name.toLowerCase() : (cause === 'wounds' ? 'your wounds' : 'sickness');
            html += `<div style="${DEATH}">${dc.icon || '💀'} ${cause === 'wounds' ? 'Taken by Wounds' : 'Taken by Sickness'}</div>`;
            html += lede(`${player.name} has died of ${what} at the age of ${player.age}.`);
            html += `<p style="${QUOTE}">"A sword spares some men. A fever spares fewer."</p>`;
        } else {
            html += `<div style="${DEATH}">💀 Death Comes for All</div>`;
            html += lede(`${player.name} has died at the age of ${player.age}.`);
        }

        const house = player.house || null;
        if (house) {
            html += chips([['🛡️', house.name, ''], { icon: '⭐', label: 'Prestige', value: house.prestige || 0, cls: 'gold' }, ['🧬', 'Generation', house.generation || 1]]);
        } else if (player.dynasty) {
            html += chips([['🛡️', `House ${player.dynasty.name}`, ''], { icon: '⭐', label: 'Prestige', value: House.getPrestige(player), cls: 'gold' }]);
        }

        // Offer to spend Prestige to secure a smooth succession (avoid disputes).
        const secureCost = (typeof House !== 'undefined') ? House._getSinks().secureSuccession : 20;
        const canSecure = house && (house.prestige || 0) >= secureCost && eligibleHeirs.length > 0;
        if (canSecure) {
            html += `<label class="pk-card" style="display:flex; align-items:center; gap:8px; font-size:12px; color:#ece2c8; cursor:pointer;">
                <input type="checkbox" id="secureSuccessionChk" />
                <span>Spend ${secureCost} Prestige to secure the succession</span>
            </label>`;
        }

        if (eligibleHeirs.length > 0) {
            html += sectionHead('Choose Your Heir');
            html += `<div style="${MUTED} margin:0 2px 8px;">Continue your dynasty by taking control of one of your ${eligibleHeirs.some(h => h.isSibling) ? 'children or siblings' : 'children'}.</div>`;

            for (const heir of eligibleHeirs) {
                const genderIcon = heir.gender === 'male' ? '♂️' : '♀️';
                const isDesignated = player.heir === heir.id;
                const traitStr = heir.traits?.length > 0
                    ? heir.traits.map(t => `${t.icon} ${t.name}`).join(', ')
                    : 'None';

                let body = '';
                if (heir.traits?.length > 0) body += `<div style="${MUTED}">Born: ${traitStr}</div>`;
                body += `<div style="text-align: left;">${ActionMenu._heirProfileHtml(player, heir)}</div>`;
                body += `<button onclick="window._succeedAsHeir('${heir.id}')" style="${isDesignated ? BTN_GOLD : BTN_PLAIN} display:block; width:100%; margin-top:8px; padding:8px;">Play as ${heir.firstName}</button>`;
                const block = card(body, {
                    icon: genderIcon, title: `${heir.firstName} ${heir.dynasty}`,
                    side: `Age ${heir.age}${heir.isSibling ? ' · sibling' : ''}${isDesignated ? ' · 👑 Designated' : ''}`, tone: isDesignated ? 'gold' : '',
                });
                html += isDesignated ? block.replace('<div class="pk-card', '<div style="border-color: rgba(245,197,66,0.45);" class="pk-card') : block;
            }

            // A designated heir still under age: a regency for them instead (systems/regency.js)
            const minorHeir = (player.children || []).find(c => c && c.isAlive && c.id === player.heir && c.age < Relationships._getHeirSettings().minAgeToPlay);
            if (minorHeir) {
                let body = ActionMenu._regencyChoiceHtml(game, minorHeir);
                body += `<button onclick="window._succeedViaRegency('${minorHeir.id}')" style="${BTN_GOLD} display:block; width:100%; margin-top:8px; padding:8px;">Play ${minorHeir.firstName} under a regency</button>`;
                html += card(body, { icon: '👑', title: `${minorHeir.firstName} ${minorHeir.dynasty}`, side: `Age ${minorHeir.age} · 👑 Designated`, tone: 'gold' });
            }
        } else {
            // No adult heir — offer a regency if an under-age child exists.
            const assess = (typeof House !== 'undefined') ? House.assessSuccession(player) : { hasMinorHeir: false, regent: null };
            if (assess.hasMinorHeir && assess.regent) {
                // The designated heir if they are among the minors, else the eldest
                const r = assess.minors.find(c => c.id === player.heir) || assess.regent;
                html += sectionHead('A Regency?');
                let body = `<div style="color:#cbbf9f;">No heir has come of age. You may install a regency to raise <strong>${r.firstName}</strong> (age ${r.age}) to the throne — but the House will emerge weaker, shedding holdings.</div>`;
                body += ActionMenu._regencyChoiceHtml(game, r);
                body += `<button onclick="window._succeedViaRegency('${r.id}')" style="${BTN_GOLD} display:block; width:100%; margin-top:8px; padding:9px;">Install Regency for ${r.firstName}</button>`;
                body += `<button onclick="window._endDynasty()" style="${BTN_RED} display:block; width:100%; margin-top:6px; padding:8px;">Let the Dynasty End</button>`;
                html += card(body, { icon: '👑', title: `${r.firstName}`, side: `Age ${r.age}`, tone: 'gold' });
            } else {
                html += `<div style="${TITLE} color:#e0846a; font-size:15px; margin-top:12px;">No Eligible Heirs</div>`;
                html += `<div style="${MUTED} text-align:center; margin:0 0 8px;">Without an heir, your dynasty ends here.</div>`;
                html += `<button onclick="window._endDynasty()" style="${BTN_RED} display:block; width:100%; padding:10px;">🕯️ Read the Epitaph</button>`;
            }
        }

        // Or go on another way: someone else in the world, or let the years pass (ui/actionMenu/afterlife.js)
        const waitFor = eligibleHeirs.length ? '' : (player.children || []).some(c => c.isAlive) ? ' until a child comes of age' : '';
        html += rowList([
            { icon: '🎭', name: 'A New Life', desc: 'Become someone else in the world', attrs: 'onclick="window._deathNewLife()"', side: '›' },
            { icon: '⏳', name: 'Let Time Pass', desc: `Watch the world turn${waitFor}, then jump back in`, attrs: 'onclick="window._deathLetTimePass()"', side: '›' },
            // Read back the life just ended before choosing (ui/actionMenu/annals.js)
            { icon: '📖', name: 'Read the Annals of your life', attrs: 'onclick="window._deathAnnals()"', side: '›' },
        ], 'Or Go On Another Way');
        html += '</div>';
        game.ui.showCustomPanel('Death', html, { locked: true });
        window._deathAnnals = () => ActionMenu.showAnnals(game, { locked: true, onBack: () => ActionMenu.showDeathScreen(game, cause), backLabel: '← Back to the deathbed' });
        window._deathNewLife = () => ActionMenu.showNewLife(game, 0, cause || 'old age');
        window._deathLetTimePass = () => ActionMenu.beginInterregnum(game, cause || 'old age');

        const finishSuccession = (childId, extraOpts) => {
            const chk = document.getElementById('secureSuccessionChk');
            const opts = { secure: !!(chk && chk.checked), cause: cause || 'old age', ...(extraOpts || {}) };
            const goldBefore = Math.floor(player.gold || 0);
            const result = Relationships.succeedAsHeir(player, childId, game.world, opts);
            if (result.success) {
                // Clear death animation state
                InnerMapRenderer.clearDeathAnimation();
                game.player._isDead = false;

                game.ui.hideCustomPanel();

                const hr = result.house || {};
                let successHtml = '<div>';
                successHtml += `<div style="${TITLE}">👑 A New Chapter</div>`;
                successHtml += lede(`You are now <strong>${result.newName}</strong>, heir of ${result.oldName}.`);
                // What the will passed on, then the purse after the succession's losses and costs
                const inheritPct = Relationships._getHeirSettings().inheritanceGoldPercent;
                const inherited = Math.floor(goldBefore * inheritPct);
                successHtml += kv('Age', result.heir.age);
                successHtml += kv('Inherited', `${inherited} of ${goldBefore} gold (${Math.round(inheritPct * 100)}%)`);
                if (Math.floor(player.gold) !== inherited) successHtml += kv('Purse after the succession', `${Math.floor(player.gold)} gold`);
                if (player.house) successHtml += kv(player.house.name, `Prestige ${player.house.prestige || 0} · Generation ${hr.generation || player.house.generation || 1}`);
                const notes = [];
                if (hr.regency) notes.push(`<div style="color:#f0b35a;">Ascended under a regency — a weaker start.</div>`);
                if (result.regency) notes.push(`<div style="color:#f0b35a;">👑 ${result.regency.regent.name} rules as regent until you come of age at ${result.regency.majorityAge}. Dynasty → Regency.</div>`);
                // The life the heir lived before the throne (systems/heirAgency.js)
                for (const l of ((result.heirRecord && result.heirRecord.lines) || [])) notes.push(`<div style="color:#8fd18a;">${l.icon} ${l.text}</div>`);
                if (hr.disputed) {
                    notes.push(hr.secured
                        ? `<div style="color:#8fd18a;">A rival pressed a claim — quelled by spending Prestige.</div>`
                        : `<div style="color:#e0846a;">A disputed succession fragmented the House's holdings.</div>`);
                }
                for (const loss of (hr.fragmented || [])) {
                    if (loss.type === 'title') notes.push(`<div style="color:#e0846a;">Lost your office in the turmoil.</div>`);
                    if (loss.type === 'gold') notes.push(`<div style="color:#e0846a;">Lost ${loss.amount} gold to rival claimants.</div>`);
                }
                // Traits aren't inherited — but the realm remembers the late ruler
                const echoNames = (result.traitEcho || []).map(e => Traits.TRAITS[e.id]).filter(Boolean).map(d => `${d.icon} ${d.name}`);
                const raised = (result.heirTraits || []).map(id => Traits.TRAITS[id]).filter(Boolean).map(d => `${d.icon} ${d.name}`);
                if (raised.length) notes.push(`<div style="color:#8fd18a;">Your upbringing made you ${raised.join(', ')}.</div>`);
                if (echoNames.length) notes.push(`<div style="color:#c9b27a;">The realm still remembers ${result.oldName} as ${echoNames.join(' and ')}. That reputation clings to your House for a while.</div>`);
                if (notes.length) successHtml += card(notes.join(''));
                successHtml += `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD} display:block; width:100%; margin-top:10px; padding:10px; font-size:14px;">Begin Your Story</button>`;
                successHtml += '</div>';

                game.ui.showCustomPanel('New Heir', successHtml);
                game.ui.updateStats(player, game.world);
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }
        };

        window._succeedAsHeir = (childId) => finishSuccession(childId, {});
        window._succeedViaRegency = (childId) => {
            const sel = document.getElementById('regentChoiceSel');
            finishSuccession(childId, { regency: true, regent: sel ? sel.value : null });
        };
        window._endDynasty = () => {
            game.ui.hideCustomPanel();
            ActionMenu.showEpitaph(game, cause || 'old age');
        };
    },
});
