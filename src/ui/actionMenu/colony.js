// ActionMenu — colony methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader } from './_imports.js';

Object.assign(ActionMenu, {
    // ─────────────────────────────────────────────
    // CULTURAL BUILDINGS
    // ─────────────────────────────────────────────
    /**
     * Show build cultural building menu
     */
    showBuildCulturalMenu(game, tile) {
        if (typeof Culture === 'undefined') return;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Build Cultural Building</h4>';

        for (const [key, building] of Object.entries(Culture.BUILDING_TYPES)) {
            const canBuild = (() => {
                if (game.player.gold < building.cost) return 'Not enough gold';
                if (building.requiredSettlement && !tile.settlement) return 'Requires a settlement';
                if (building.requiredPopulation && tile.settlement && tile.settlement.population < building.requiredPopulation)
                    return `Needs ${building.requiredPopulation}+ population`;
                if (tile.culturalBuilding || tile.playerProperty || tile.religiousBuilding) return 'Tile occupied';
                return null;
            })();

            const disabled = canBuild ? 'opacity: 0.5; pointer-events: none;' : '';
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; ${disabled}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${building.icon}</span> <strong>${building.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${building.description}</div>
                            <div style="font-size: 12px;">
                                Influence: +${building.influencePerDay}/day | Radius: ${building.influenceRadius}
                                ${building.researchBonus ? ` | Research: +${Math.round(building.researchBonus * 100)}%` : ''}
                                ${building.moraleBonus ? ` | Morale: +${building.moraleBonus}` : ''}
                                ${building.renownPerDay ? ` | Renown: +${building.renownPerDay}/day` : ''}
                            </div>
                            <div style="font-size: 11px; color: var(--gold);">🏗️ ${building.constructionDays || 0} days</div>
                            ${canBuild ? `<div style="font-size: 11px; color: #e74c3c; margin-top: 4px;">${canBuild}</div>` : ''}
                        </div>
                        <button onclick="window._buildCultural('${key}')" 
                            style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; ${disabled}"
                            ${canBuild ? 'disabled' : ''}>${building.cost} gold</button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('📚 Cultural Buildings', html);

        window._buildCultural = (buildingType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = Culture.buildCulturalBuilding(game.player, buildingType, tile, game.world);
            if (result.success) {
                if (result.underConstruction) {
                    game.ui.showNotification('🏗️ Construction Started!', `${result.building.icon} ${result.building.name} is under construction — ${result.constructionDays} days to completion.`, 'info');
                } else {
                    game.ui.showNotification('Building Constructed!', `${result.building.icon} ${result.building.name} will spread knowledge and influence`, 'success');
                }
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Build', result.reason, 'error');
            }
        };
    },

    // ─────────────────────────────────────────────
    // PILGRIMAGE / HOLY SITES
    // ─────────────────────────────────────────────
    /**
     * Visit a holy site (pilgrimage)
     */
    visitHolySite(game, tile) {
        if (typeof Religion === 'undefined' || !tile.holySite) return;

        const site = tile.holySite;
        const faith = site.faithId ? Religion.FAITHS[site.faithId] : null;

        let html = '<div>';
        html += `
            <div style="text-align: center; padding: 16px 0;">
                <div style="font-size: 48px;">${site.icon}</div>
                <h3 style="margin: 8px 0; color: var(--gold);">${site.name}</h3>
                <p style="font-size: 13px; color: var(--text-secondary);">${site.description}</p>
                ${faith ? `<div style="margin-top: 8px; font-size: 12px;">${faith.icon} Associated with: <strong>${faith.name}</strong></div>` : ''}
                ${site.controller ? `<div style="margin-top: 4px; font-size: 12px;">Controlled by: <strong>${game.world.getKingdom(site.controller)?.name || 'Unknown'}</strong></div>` : '<div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">Unclaimed holy site</div>'}
            </div>
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-bottom: 12px;">
                <div style="font-size: 13px; margin-bottom: 8px;"><strong>Pilgrimage Rewards:</strong></div>
                <div style="font-size: 12px;">💰 Gold reward • ☯ Karma • ⭐ Renown • 🙏 Faith</div>
                ${site.bonusType === 'healing' ? '<div style="font-size: 12px; color: #27ae60; margin-top: 4px;">💚 Special: Healing waters restore health</div>' : ''}
            </div>
            <button onclick="window._completePilgrimage()" 
                style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">
                🙏 Complete Pilgrimage
            </button>
        `;
        html += '</div>';

        game.ui.showCustomPanel('⛲ Holy Site', html);

        window._completePilgrimage = () => {
            const result = Religion.completePilgrimage(game.player, tile, game.world);
            if (result.success) {
                game.ui.showNotification('Pilgrimage Complete!',
                    `${result.siteName}: +${result.goldReward} gold, +${result.karmaGained} karma, +${result.renownGained} renown${result.healed ? ', health restored!' : ''}`,
                    'success'
                );
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Complete', result.reason, 'error');
            }
        };
    },

    /**
     * Post bail to get out of jail
     */
    postBail(game) {
        const player = game.player;
        if (!player.jailState) return;
        const bail = player.jailState.bailCost;
        if (player.gold < bail) {
            game.ui.showNotification('Cannot Post Bail', `You need ${bail} gold (have ${player.gold}).`, 'error');
            return;
        }
        player.gold -= bail;
        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.bail = (player.financeToday.expenses.bail || 0) + bail;
        }
        const settlement = player.jailState.settlement;
        player.jailState = null;
        player.stamina = player.maxStamina;
        player.movementRemaining = player.maxStamina;
        game.ui.showNotification('💰 Bail Posted', `You paid ${bail} gold and were released from jail in ${settlement}.`, 'success');
        game.ui.updateStats(player, game.world);
    },

    /**
     * Attempt to escape from jail
     */
    attemptJailbreak(game) {
        const player = game.player;
        if (!player.jailState) return;
        const jail = player.jailState;
        const roll = Math.random();

        if (roll < (jail.escapeChance || 0.1)) {
            // Successful jailbreak
            const settlement = jail.settlement;
            player.jailState = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            player.karma = (player.karma || 0) - 2;
            // Stealth skill up
            if (player.skills) {
                player.skills.stealth = Math.min((player.skills.stealth || 1) + 0.5, 10);
            }
            // Major reputation hit — you're a fugitive
            const tile = game.world.getTile(player.q, player.r);
            if (tile?.settlement?.kingdom && player.reputation) {
                player.reputation[tile.settlement.kingdom] = (player.reputation[tile.settlement.kingdom] || 0) - 10;
            }
            game.ui.showNotification('🏃 Jailbreak!', `You escaped from jail in ${settlement}! -2 karma, -10 reputation.`, 'success');
        } else {
            // Failed jailbreak — more time
            const addedDays = Utils.randInt(2, 5);
            jail.daysRemaining += addedDays;
            jail.totalDays += addedDays;
            jail.escapeChance = Math.max(0.03, (jail.escapeChance || 0.1) - 0.02);
            player.health = Math.max(10, player.health - Utils.randInt(3, 10));
            game.ui.showNotification('❌ Jailbreak Failed', `The guards caught you! +${addedDays} days added to your sentence. You were roughed up.`, 'error');
        }
        game.ui.updateStats(player, game.world);
    },

    /**
     * Attempt to escape indentured servitude
     */
    attemptServitudeEscape(game) {
        const result = PlayerMilitary.attemptEscape(game.player);
        if (result.success) {
            game.ui.showNotification('Escaped!', result.message, 'success');
        } else {
            game.ui.showNotification('Escape Failed!', result.message, 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Buy freedom from indentured servitude
     */
    buyFreedom(game) {
        const result = PlayerMilitary.buyFreedom(game.player);
        if (result.success) {
            game.ui.showNotification('Freedom Bought!', result.message, 'success');
        } else {
            game.ui.showNotification('Cannot Buy Freedom', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    // ── RECRUIT SETTLERS MENU ──────────────────────────
    /**
     * Show the recruit settlers menu at a foreign settlement
     */
    showRecruitSettlersMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const sourcePop = tile.settlement.population;
        const maxRecruit = Math.max(1, Math.floor(sourcePop * 0.02));

        // Get player colonies that need settlers
        const colonies = (player.colonies || []).map(c => {
            const ct = world.getTile(c.q, c.r);
            if (!ct || !ct.settlement) return null;
            const pop = ct.settlement.population;
            const enRoute = ct.settlement.colony?.recruitment?.enRoute || 0;
            return { ...c, pop, enRoute, tile: ct };
        }).filter(c => c && c.pop < 50);

        if (colonies.length === 0) {
            game.ui.showNotification('No Colonies', 'You have no colonies that need settlers.', 'info');
            return;
        }

        let html = '<div style="max-width: 520px;">';
        html += '<h4 style="margin-top: 0;">📢 Recruit Settlers</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Convince people from <strong>${tile.settlement.name}</strong> (pop. ${sourcePop}) to move to your settlement.</p>`;
        html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">Max recruitable: ${maxRecruit} people (2% of population) | Cost: 2 AP per attempt</p>`;

        // Colony selection
        if (colonies.length > 1) {
            html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Send settlers to:</div>';
            html += '<div style="display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap;">';
            colonies.forEach((c, i) => {
                html += `<button onclick="window._selectTargetColony(${i})" id="colSel_${i}"
                    style="padding: 6px 12px; background: ${i === 0 ? 'rgba(245,197,66,0.15)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${i === 0 ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}; border-radius: 6px; cursor: pointer; color: var(--text-primary); font-size: 12px;">
                    ${c.name} (${c.pop} settlers${c.enRoute > 0 ? `, ${c.enRoute} en route` : ''})
                </button>`;
            });
            html += '</div>';
        } else {
            html += `<div style="padding: 8px 12px; background: rgba(245,197,66,0.08); border-radius: 6px; border-left: 3px solid var(--gold); margin-bottom: 16px; font-size: 12px;">
                        Destination: <strong style="color: var(--gold);">${colonies[0].name}</strong> (${colonies[0].pop} settlers${colonies[0].enRoute > 0 ? `, ${colonies[0].enRoute} en route` : ''})
                     </div>`;
        }

        // Recruitment methods
        const methods = [
            { id: 'persuade', name: 'Spread the Word', icon: '🗣️', desc: 'Persuade people with tales of opportunity. Free but limited by charisma.', costLabel: 'Free', color: '#2ecc71' },
            { id: 'hire', name: 'Hire Settlers', icon: '💰', desc: `Pay workers to relocate. ${maxRecruit * 15}g for ${maxRecruit} settlers.`, costLabel: `${maxRecruit * 15}g`, color: '#f5c542' },
            { id: 'promise', name: 'Promise Prosperity', icon: '✨', desc: 'Make grand promises of wealth and land. Effective but slightly dubious.', costLabel: 'Free (−1 karma)', color: '#9b59b6' },
        ];

        html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">How will you recruit?</div>';
        for (const m of methods) {
            const disabled = m.id === 'hire' && player.gold < maxRecruit * 15;
            html += `
                <button onclick="window._recruitSettlers('${m.id}')" ${disabled ? 'disabled' : ''}
                    style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 6px;
                           background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid ${m.color};
                           border-radius: 6px; cursor: ${disabled ? 'not-allowed' : 'pointer'}; text-align: left;
                           color: var(--text-primary); transition: all 0.15s; ${disabled ? 'opacity: 0.4;' : ''}"
                    onmouseenter="if(!this.disabled) this.style.background='rgba(255,255,255,0.08)'"
                    onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                    <span style="font-size: 24px;">${m.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 13px;">${m.name}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${m.desc}</div>
                    </div>
                    <span style="font-size: 12px; color: ${m.color}; font-weight: bold; white-space: nowrap;">${m.costLabel}</span>
                </button>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('📢 Recruit Settlers', html);

        let selectedColonyIdx = 0;

        window._selectTargetColony = (idx) => {
            selectedColonyIdx = idx;
            colonies.forEach((_, i) => {
                const btn = document.getElementById('colSel_' + i);
                if (btn) {
                    btn.style.background = i === idx ? 'rgba(245,197,66,0.15)' : 'rgba(255,255,255,0.05)';
                    btn.style.borderColor = i === idx ? 'var(--gold)' : 'rgba(255,255,255,0.1)';
                }
            });
        };

        window._recruitSettlers = (method) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const target = colonies[selectedColonyIdx];
            if (!target) return;

            const result = Colonization.recruitSettlers(player, tile, target.tile, world, maxRecruit, method);
            if (result.success) {
                game.ui.showNotification('📢 Settlers Recruited!',
                    `${result.recruited} people will head to ${result.colonyName}! (${result.enRoute} en route, ${result.goldSpent}g spent)`, 'success');
                game.ui.updateStats(game.player, game.world);
                // Refresh
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Recruit', result.reason, 'error');
            }
        };
    },

    /**
     * Post a signboard at player colony
     */
    doPostSignboard(game, tile) {
        const result = Colonization.postSignboard(game.player, tile);
        if (result.success) {
            game.ui.showNotification('🪧 Signboard Posted', `A signboard now advertises ${tile.settlement.name} to passing travelers.`, 'success');
        } else {
            game.ui.showNotification('Cannot Post', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show colony founding menu
     */
    showFoundColonyMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const q = player.q;
        const r = player.r;

        // Check for nearby indigenous
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, q, r, 3);
        let indigenousWarning = '';
        if (nearbyIndigenous.length > 0) {
            const names = nearbyIndigenous.map(i => i.tribeName).join(', ');
            indigenousWarning = `<p style="color:#e8a040;">⚠️ Nearby indigenous: ${names}</p>`;
        }

        // Distance from capital
        const capitalTile = world.getAllSettlements().find(s => s.kingdom === player.kingdom && s.type === 'capital');
        let distInfo = '';
        if (capitalTile) {
            const dist = Hex.wrappingDistance(q, r, capitalTile.q, capitalTile.r, world.width);
            const penalty = Colonization.getDistancePenalty(world, world.kingdoms.find(k => k.id === player.kingdom), q, r);
            distInfo = `<p>Distance from capital: <b>${dist}</b> hexes (loyalty penalty: <span style="color:${penalty > 15 ? '#ff6666' : '#aaffaa'}">-${penalty.toFixed(1)}</span>)</p>`;
        }

        // Policy options
        let policyHtml = '';
        for (const [id, policy] of Object.entries(Colonization.POLICIES)) {
            policyHtml += `
                <label style="display:block; margin:6px 0; cursor:pointer; padding:6px; border:1px solid #555; border-radius:4px;" 
                       onclick="document.querySelectorAll('.colony-policy-opt').forEach(e=>e.style.borderColor='#555');this.style.borderColor='#4CAF50';document.getElementById('selectedPolicy').value='${id}'">
                    <b>${policy.name}</b><br>
                    <small style="color:#aaa;">${policy.desc}</small><br>
                    <small>Expansion: +${(policy.expansionBonus * 100).toFixed(0)}% | Loyalty: +${policy.loyaltyBonus} | Production: +${(policy.productionBonus * 100).toFixed(0)}%</small>
                </label>`;
        }

        let html = `
            <div style="max-height:450px; overflow-y:auto;">
                <p>Establish a frontier colony here for <b>${Colonization.COLONY_COST} gold</b>.</p>
                <p>Your gold: <b>${player.gold.toFixed(0)}</b></p>
                ${distInfo}
                ${indigenousWarning}
                <hr style="border-color:#555;">
                <p><b>Colony Name:</b></p>
                <input type="text" id="colonyNameInput" value="${Kingdom.generateCityName('Imperial')}" 
                       style="width:100%; padding:4px; background:#333; color:#fff; border:1px solid #666; border-radius:4px;">
                <hr style="border-color:#555;">
                <p><b>Colonization Policy:</b></p>
                <input type="hidden" id="selectedPolicy" value="manifest_destiny">
                <div class="colony-policy-opt">${policyHtml}</div>
                <hr style="border-color:#555;">
                <button data-am-act="executeFoundColony" data-am-args='[${q}, ${r}]' 
                        style="width:100%; padding:8px; background:#4CAF50; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:14px;">
                    🏴 Found Colony (${Colonization.COLONY_COST}g)
                </button>
            </div>`;

        game.ui.showCustomPanel('Found Colony', html);
    },

    /**
     * Execute colony founding
     */
    executeFoundColony(game, q, r) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(q, r);
        const name = document.getElementById('colonyNameInput')?.value || 'New Colony';
        const policyId = document.getElementById('selectedPolicy')?.value || 'manifest_destiny';

        const result = Colonization.foundPlayerColony(player, tile, world, q, r, name, policyId);
        if (result.success) {
            game.ui.showNotification('Colony Founded!', `${name} has been established as your frontier colony!`, 'success');
            game.endDay();
        } else {
            game.ui.showNotification('Cannot Found Colony', result.reason || 'Requirements not met', 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show send pioneers menu — pick a target from map
     */
    showSendPioneersMenu(game, tile) {
        const player = game.player;
        const world = game.world;

        // Find suitable wilderness targets
        const targets = [];
        for (let attempt = 0; attempt < 100; attempt++) {
            const tq = Utils.randInt(0, world.width - 1);
            const tr = Utils.randInt(5, world.height - 6);
            const t = world.getTile(tq, tr);
            if (t && t.terrain.passable && !t.settlement) {
                const dist = Hex.wrappingDistance(player.q, player.r, tq, tr, world.width);
                if (dist > 8 && dist < 30) {
                    const score = Colonization.getWildernessScore(t, world, tq, tr);
                    if (score > 0) {
                        targets.push({ q: tq, r: tr, dist, score, terrain: t.terrain.name });
                    }
                }
            }
        }

        // Sort by score descending and take top 5
        targets.sort((a, b) => b.score - a.score);
        const best = targets.slice(0, 5);

        if (best.length === 0) {
            game.ui.showNotification('No Targets', 'No suitable wilderness for pioneers found nearby.', 'default');
            return;
        }

        let html = '<div style="max-height:400px; overflow-y:auto;">';
        html += '<p>Send a pioneering party to settle a distant region. Cost: <b>200 gold</b></p>';
        html += '<p>Choose a target region:</p>';

        for (const target of best) {
            const hasIndigenous = Colonization.getNearbyIndigenous(world, target.q, target.r, 2).length > 0;
            html += `
                <div style="padding:8px; margin:4px 0; border:1px solid #555; border-radius:4px; cursor:pointer;"
                     data-am-act="executeSendPioneers" data-am-args='[${target.q}, ${target.r}]'
                     onmouseover="this.style.borderColor='#4CAF50'" onmouseout="this.style.borderColor='#555'">
                    <b>${target.terrain}</b> — Distance: ${target.dist} hexes
                    ${hasIndigenous ? '<span style="color:#e8a040;"> ⚠️ Indigenous nearby</span>' : ''}
                    <br><small>Suitability: ${'⭐'.repeat(Math.min(5, Math.ceil(target.score / 2)))}</small>
                </div>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Send Pioneers', html);
    },

    /**
     * Execute sending pioneers
     */
    executeSendPioneers(game, targetQ, targetR) {
        const player = game.player;
        const world = game.world;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (player.gold < 200) {
            game.ui.showNotification('Not Enough Gold', 'You need 200 gold to send pioneers.', 'error');
            return;
        }

        const result = Colonization.sendPioneerParty(player, world, targetQ, targetR);
        if (result.success) {
            game.ui.showNotification('Pioneers Dispatched!', result.message || 'A pioneering party has set out to settle new lands!', 'success');
            game.ui.hideCustomPanel();
        } else {
            game.ui.showNotification('Cannot Send Pioneers', result.reason || 'Failed to dispatch pioneers.', 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show colony management menu
     */
    showManageColonyMenu(game, tile) {
        const colony = tile.settlement.colony;
        if (!colony) return;

        const world = game.world;
        const player = game.player;
        const capitalTile = world.getAllSettlements().find(s => s.kingdom === player.kingdom && s.type === 'capital');
        let dist = 0;
        if (capitalTile) {
            dist = Hex.wrappingDistance(tile.q, tile.r, capitalTile.q, capitalTile.r, world.width);
        }

        const policy = Colonization.POLICIES[colony.policy] || Colonization.POLICIES.manifest_destiny;
        const loyaltyColor = colony.loyalty > 60 ? '#4CAF50' : colony.loyalty > 30 ? '#e8a040' : '#ff4444';
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, tile.q, tile.r, 3);
        const rec = colony.recruitment || {};
        const isEmptyColony = tile.settlement.population < 10;
        const currentIncentive = Colonization.INCENTIVES[rec.incentive] || Colonization.INCENTIVES.none;

        let html = `
            <div style="max-height:550px; overflow-y:auto;">
                <h3 style="margin:0 0 10px;">Colony: ${tile.settlement.name}</h3>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Population</small><br>
                        <b>${tile.settlement.population}</b>${rec.enRoute ? ` <small style="color:#f5c542;">(+${rec.enRoute} en route)</small>` : ''}
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Loyalty</small><br>
                        <b style="color:${loyaltyColor}">${colony.loyalty.toFixed(1)}%</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Distance</small><br>
                        <b>${dist}</b> hexes
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Garrison</small><br>
                        <b>${colony.garrisonStrength}</b>
                    </div>
                </div>`;

        // ── Recruitment Status (shown when colony is young / small) ──
        if (isEmptyColony || rec.recruited > 0) {
            html += `
                <div style="padding:10px; background:rgba(245,197,66,0.06); border:1px solid rgba(245,197,66,0.2); border-radius:6px; margin-bottom:10px;">
                    <div style="font-weight:600; font-size:13px; color:var(--gold); margin-bottom:8px;">📢 Recruitment Status</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; font-size:12px;">
                        <div><small style="color:#aaa;">Recruited</small><br><b>${rec.recruited || 0}</b></div>
                        <div><small style="color:#aaa;">En Route</small><br><b style="color:#f5c542;">${rec.enRoute || 0}</b></div>
                        <div><small style="color:#aaa;">Reputation</small><br><b>${(rec.reputation || 0).toFixed(0)}</b></div>
                    </div>
                    <div style="margin-top:8px; display:flex; gap:6px; align-items:center; font-size:12px;">
                        <span>🪧 Signboard:</span>
                        ${rec.signboard
                            ? '<span style="color:#4CAF50;">✓ Posted</span>'
                            : `<button data-am-act="postSignboardAndManageColony" data-am-args='[${tile.q}, ${tile.r}]'
                                style="padding:3px 10px; background:rgba(245,197,66,0.15); border:1px solid var(--gold); border-radius:4px; cursor:pointer; color:var(--text-primary); font-size:11px;">
                                Post (20g)</button>`}
                    </div>
                    <div style="margin-top:8px; font-size:12px;">
                        <span>Current Incentive: <b>${currentIncentive.icon} ${currentIncentive.name}</b></span>
                        ${currentIncentive.dailyCost > 0 ? `<small style="color:#e8a040;"> (${currentIncentive.dailyCost}g/day)</small>` : ''}
                    </div>
                    <div style="display:flex; gap:4px; margin-top:6px; flex-wrap:wrap;">`;

            for (const [id, inc] of Object.entries(Colonization.INCENTIVES)) {
                if (id === 'none') continue;
                const active = rec.incentive === id;
                const setupCost = Number(inc.setupCost || 0);
                const dailyCost = Number(inc.dailyCost || 0);
                const attractionBonusPct = Number((inc.attractionBonus || 0) * 100).toFixed(0);
                html += `<button data-am-act="_setIncentiveFromManage" data-am-args='[${tile.q}, ${tile.r}, "${id}"]'
                    style="padding:4px 8px; font-size:11px; background:${active ? 'rgba(245,197,66,0.2)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${active ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}; border-radius:4px; cursor:pointer; color:var(--text-primary);"
                    title="${inc.desc || ''} (Setup: ${setupCost}g, Daily: ${dailyCost}g, +${attractionBonusPct}% attraction)">
                    ${inc.icon} ${inc.name}
                </button>`;
            }

            html += `<button data-am-act="_setIncentiveFromManage" data-am-args='[${tile.q}, ${tile.r}, "none"]'
                    style="padding:4px 8px; font-size:11px; background:${rec.incentive === 'none' || !rec.incentive ? 'rgba(245,197,66,0.2)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${rec.incentive === 'none' || !rec.incentive ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}; border-radius:4px; cursor:pointer; color:var(--text-primary);"
                    title="Remove incentives">
                    — None
                </button>`;

            html += `</div>
                </div>`;

            if (isEmptyColony) {
                html += `<div style="padding:8px; background:rgba(100,149,237,0.08); border:1px solid rgba(100,149,237,0.2); border-radius:6px; margin-bottom:10px; font-size:12px; color:var(--text-secondary);">
                    💡 <b>Tip:</b> Visit other settlements and use <em>Recruit Settlers</em> to attract people. Post a signboard and set incentives to draw settlers passively each day. Once you reach 10 settlers, the settlement will begin to grow on its own.
                </div>`;
            }
        }

        html += `
                <div style="padding:8px; background:#2a2a2a; border-radius:4px; margin-bottom:8px;">
                    <small style="color:#aaa;">Policy</small><br>
                    <b>${policy.name}</b> — <small>${policy.desc}</small>
                </div>

                <div style="padding:8px; background:#2a2a2a; border-radius:4px; margin-bottom:8px;">
                    <small style="color:#aaa;">Indigenous Relations</small><br>
                    <b style="color:${colony.indigenousRelation > 50 ? '#4CAF50' : colony.indigenousRelation > 0 ? '#e8a040' : '#ff4444'}">${colony.indigenousRelation.toFixed(0)}</b> / 100
                    ${nearbyIndigenous.length > 0 ? `<br><small>Nearby: ${nearbyIndigenous.map(i => `${i.tribeName} (${i.population})`).join(', ')}</small>` : '<br><small>No indigenous nearby</small>'}
                </div>

                <div style="padding:8px; background:#2a2a2a; border-radius:4px; margin-bottom:10px;">
                    <small style="color:#aaa;">Founded</small><br>
                    Day ${colony.foundedDay} (${Math.floor((world.day - colony.foundedDay) / 30)} months ago)
                </div>

                <hr style="border-color:#555;">
                <p><b>Colony Actions:</b></p>

                <button data-am-act="reinforceColony" data-am-args='[${tile.q}, ${tile.r}]' 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🛡️ Reinforce Garrison (+10, costs 100g)
                </button>

                <button data-am-act="sendGoldToColony" data-am-args='[${tile.q}, ${tile.r}]' 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    💰 Send Gold Aid (+15 loyalty, costs 150g)
                </button>

                <button data-am-act="changeColonyPolicy" data-am-args='[${tile.q}, ${tile.r}]' 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    📜 Change Policy
                </button>

                ${colony.loyalty < Colonization.REVOLT_LOYALTY + 10 ? `
                <div style="padding:8px; background:#4a2020; border:1px solid #ff4444; border-radius:4px; margin-top:8px;">
                    ⚠️ <b>Warning:</b> This colony is at risk of independence revolt!
                    ${colony.loyalty < Colonization.REVOLT_LOYALTY ? '<br>🔥 <b>REVOLT IMMINENT!</b>' : ''}
                </div>` : ''}
            </div>`;

        game.ui.showCustomPanel('Colony Management', html);
    },

    /**
     * Set incentive from manage colony panel and refresh
     */
    _setIncentiveFromManage(game, q, r, incentiveId) {
        const tile = game.world.getTile(q, r);
        if (!tile) return;
        const result = Colonization.setColonyIncentive(game.player, tile, incentiveId);
        if (result.success) {
            game.ui.showNotification('Incentive Updated', result.message || `Incentive set to ${incentiveId}.`, 'success');
        } else {
            game.ui.showNotification('Cannot Set Incentive', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showManageColonyMenu(game, tile);
    },

    /**
     * Reinforce colony garrison
     */
    reinforceColony(game, q, r) {
        const player = game.player;
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        if (player.gold < 100) {
            game.ui.showNotification('Not Enough Gold', 'Need 100 gold to reinforce.', 'error');
            return;
        }

        player.gold -= 100;
        tile.settlement.colony.garrisonStrength += 10;
        tile.settlement.colony.loyalty = Math.min(100, tile.settlement.colony.loyalty + 5);
        game.ui.showNotification('Garrison Reinforced', `${tile.settlement.name} garrison strengthened to ${tile.settlement.colony.garrisonStrength}.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Send gold to boost colony loyalty
     */
    sendGoldToColony(game, q, r) {
        const player = game.player;
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        if (player.gold < 150) {
            game.ui.showNotification('Not Enough Gold', 'Need 150 gold to send aid.', 'error');
            return;
        }

        player.gold -= 150;
        tile.settlement.colony.loyalty = Math.min(100, tile.settlement.colony.loyalty + 15);
        game.ui.showNotification('Aid Sent', `${tile.settlement.name} loyalty boosted to ${tile.settlement.colony.loyalty.toFixed(1)}%.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Change colony policy
     */
    changeColonyPolicy(game, q, r) {
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        let html = '<p>Select a new colonization policy for this colony:</p>';
        for (const [id, policy] of Object.entries(Colonization.POLICIES)) {
            const isCurrent = tile.settlement.colony.policy === id;
            html += `
                <div style="padding:8px; margin:4px 0; border:1px solid ${isCurrent ? '#4CAF50' : '#555'}; border-radius:4px; cursor:pointer; ${isCurrent ? 'background:#2a3a2a;' : ''}"
                     data-am-act="executeChangePolicy" data-am-args='[${q}, ${r}, "${id}"]'>
                    <b>${policy.name}</b> ${isCurrent ? '(current)' : ''}<br>
                    <small style="color:#aaa;">${policy.desc}</small><br>
                    <small>Expansion: +${(policy.expansionBonus * 100).toFixed(0)}% | Indigenous: ${policy.indigenousRelation > 0 ? '+' : ''}${policy.indigenousRelation} | Loyalty: +${policy.loyaltyBonus}</small>
                </div>`;
        }

        game.ui.showCustomPanel('Change Colony Policy', html);
    },

    /**
     * Execute policy change
     */
    executeChangePolicy(game, q, r, policyId) {
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        tile.settlement.colony.policy = policyId;
        const policy = Colonization.POLICIES[policyId];
        game.ui.showNotification('Policy Changed', `${tile.settlement.name} now follows ${policy.name} policy.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
    },

    /**
     * Show indigenous negotiation menu
     */
    showNegotiateIndigenousMenu(game, tile) {
        const indigenous = tile.indigenous;
        if (!indigenous) return;

        const player = game.player;
        const hostilityColor = indigenous.hostility > 60 ? '#ff4444' : indigenous.hostility > 30 ? '#e8a040' : '#4CAF50';
        const dispositionText = indigenous.hostility > 70 ? 'Hostile' : indigenous.hostility > 40 ? 'Wary' : indigenous.hostility > 20 ? 'Cautious' : 'Friendly';

        let html = `
            <div style="max-height:450px; overflow-y:auto;">
                <h3 style="margin:0 0 10px;">The ${indigenous.tribeName}</h3>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Population</small><br>
                        <b>${indigenous.population}</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Disposition</small><br>
                        <b style="color:${hostilityColor}">${dispositionText}</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Territory</small><br>
                        <b>${tile.terrain.name}</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Hostility</small><br>
                        <b style="color:${hostilityColor}">${indigenous.hostility.toFixed(0)}</b>
                    </div>
                </div>

                <hr style="border-color:#555;">
                <p><b>Diplomatic Options:</b></p>

                <button data-am-act="tradeWithIndigenous" data-am-args='[${tile.q}, ${tile.r}]' 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🤝 Trade Goods (costs 50g, reduces hostility)
                </button>

                <button data-am-act="giftToIndigenous" data-am-args='[${tile.q}, ${tile.r}]' 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🎁 Offer Tribute (costs 100g, greatly reduces hostility)
                </button>

                <button data-am-act="learnFromIndigenous" data-am-args='[${tile.q}, ${tile.r}]' 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    📖 Learn Local Knowledge (${indigenous.hostility < 40 ? 'Available' : 'Need friendly relations'})
                </button>

                ${indigenous.hostility > 50 ? `
                <div style="padding:8px; background:#4a2020; border:1px solid #ff4444; border-radius:4px; margin-top:8px;">
                    ⚠️ The ${indigenous.tribeName} are ${dispositionText.toLowerCase()} towards outsiders. 
                    Trade or tribute may improve relations.
                </div>` : `
                <div style="padding:8px; background:#2a3a2a; border:1px solid #4CAF50; border-radius:4px; margin-top:8px;">
                    The ${indigenous.tribeName} are ${dispositionText.toLowerCase()} and open to interaction.
                </div>`}
            </div>`;

        game.ui.showCustomPanel('Negotiate with Natives', html);
    },

    /**
     * Trade with indigenous
     */
    tradeWithIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (player.gold < 50) {
            game.ui.showNotification('Not Enough Gold', 'Need 50 gold to trade.', 'error');
            return;
        }

        player.gold -= 50;
        tile.indigenous.hostility = Math.max(0, tile.indigenous.hostility - 10);
        
        // Gain some bonus
        const bonus = Utils.randInt(1, 3);
        player.karma = (player.karma || 0) + bonus;
        
        game.ui.showNotification('Trade Successful', 
            `Traded with the ${tile.indigenous.tribeName}. Hostility reduced. Gained ${bonus} karma from cultural exchange.`, 'success');
        ActionMenu.showNegotiateIndigenousMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Offer tribute to indigenous
     */
    giftToIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (player.gold < 100) {
            game.ui.showNotification('Not Enough Gold', 'Need 100 gold for tribute.', 'error');
            return;
        }

        player.gold -= 100;
        tile.indigenous.hostility = Math.max(0, tile.indigenous.hostility - 25);
        player.renown = (player.renown || 0) + 5;
        
        game.ui.showNotification('Tribute Accepted', 
            `The ${tile.indigenous.tribeName} graciously accept your tribute. Relations greatly improved. +5 renown.`, 'success');
        ActionMenu.showNegotiateIndigenousMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Learn local knowledge from friendly indigenous
     */
    learnFromIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (tile.indigenous.hostility >= 40) {
            game.ui.showNotification('Too Hostile', 'The natives don\'t trust you enough to share their knowledge. Improve relations first.', 'error');
            return;
        }

        // Random benefit
        const benefits = [
            { text: 'terrain navigation', stat: 'speed', value: 0 },
            { text: 'local herbs and medicine', stat: 'karma', value: Utils.randInt(2, 5) },
            { text: 'ancient trade routes', stat: 'gold', value: Utils.randInt(20, 80) },
            { text: 'survival techniques', stat: 'renown', value: Utils.randInt(3, 8) },
        ];
        const benefit = Utils.randPick(benefits);
        
        if (benefit.stat === 'gold') player.gold += benefit.value;
        else if (benefit.stat === 'karma') player.karma = (player.karma || 0) + benefit.value;
        else if (benefit.stat === 'renown') player.renown = (player.renown || 0) + benefit.value;

        // Slight hostility increase from knowledge exchange
        tile.indigenous.hostility = Math.min(100, tile.indigenous.hostility + 5);

        game.ui.showNotification('Knowledge Gained', 
            `The ${tile.indigenous.tribeName} teach you about ${benefit.text}. ${benefit.value > 0 ? `+${benefit.value} ${benefit.stat}` : ''}`, 'success');
        game.ui.updateStats(game.player, game.world);
    },

    // ────────────────────────────────────────────
    //  CARTOGRAPHY
    // ────────────────────────────────────────────
    /**
     * Show main cartography menu
     */
    showCartographyMenu(game, tile) {
        const player = game.player;
        const skill = player.skills.cartography || 0;
        const skillDesc = Cartography.getSkillDescription(skill);
        const quality = Cartography.getQualityForSkill(skill);
        const qualityData = Cartography.QUALITY[quality];
        const mapCount = (player.maps || []).length;
        const exploredCount = Cartography.countExploredTiles(game.world);
        const totalTiles = game.world.width * game.world.height;

        let html = `
            <div style="max-height:500px; overflow-y:auto;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Cartography Skill</small><br>
                        <b>${skill.toFixed(1)}</b> / 10<br>
                        <small style="color:#f5c542;">${skillDesc}</small>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Map Quality</small><br>
                        <b>${qualityData.icon} ${qualityData.label}</b><br>
                        <small>Accuracy: ${(qualityData.accuracy * 100).toFixed(0)}%</small>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Maps Owned</small><br>
                        <b>${mapCount}</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Explored</small><br>
                        <b>${exploredCount}</b> / ${totalTiles} tiles
                    </div>
                </div>

                <hr style="border-color:#555;">
                <p><b>Create a Map:</b></p>

                <button data-am-act="createMap" data-am-args='["regional"]' 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    🗺️ <b>Regional Map</b> — Chart the surrounding area (radius 8)<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.regional.cost}g | Quality: ${qualityData.label}</small>
                </button>

                <button data-am-act="createMap" data-am-args='["survey"]' 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    📐 <b>Survey Map</b> — Detailed survey showing resources (radius 5)<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.survey.cost}g | Shows resources</small>
                </button>

                ${player.allegiance ? `
                <button data-am-act="createMap" data-am-args='["kingdom"]' 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    👑 <b>Kingdom Map</b> — Map your kingdom's territory<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.kingdom.cost}g | Shows borders</small>
                </button>` : ''}

                ${mapCount > 0 ? `
                <hr style="border-color:#555;">
                <p><b>Your Maps:</b></p>
                <button data-am-act="showMapCollection" 
                        style="width:100%; padding:8px; margin:3px 0; background:#3a5a3a; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    📚 View Map Collection (${mapCount} maps)
                </button>` : ''}

                ${skill >= 3 ? `
                <hr style="border-color:#555;">
                <p><b>Advanced:</b></p>
                <button data-am-act="showAddErrorsMenu" 
                        style="width:100%; padding:8px; margin:3px 0; background:#5a3a3a; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    ✏️ <b>Add Deliberate Errors</b> — Alter a map for deception/security<br>
                    <small style="color:#aaa;">Requires cartography skill 3+</small>
                </button>` : ''}
            </div>`;

        game.ui.showCustomPanel('🗺️ Cartography', html);
    },

    /**
     * Create a map
     */
    createMap(game, type) {
        const player = game.player;
        const world = game.world;
        const cost = Cartography.MAP_TYPES[type]?.cost || 30;

        if (player.gold < cost) {
            game.ui.showNotification('Not Enough Gold', `You need ${cost} gold to create this map.`, 'error');
            return;
        }
        if (!ActionMenu.commitPendingAP(game)) return;

        player.gold -= cost;
        if (!player.maps) player.maps = [];

        let map;
        switch (type) {
            case 'regional':
                map = Cartography.createRegionalMap(player, world);
                break;
            case 'survey':
                map = Cartography.createSurveyMap(player, world);
                break;
            case 'kingdom':
                if (!player.allegiance) {
                    game.ui.showNotification('No Kingdom', 'You must be pledged to a kingdom to map it.', 'error');
                    player.gold += cost;
                    return;
                }
                map = Cartography.createKingdomMap(player, world, player.allegiance);
                break;
            default:
                player.gold += cost;
                return;
        }

        if (!map) {
            player.gold += cost;
            game.ui.showNotification('Failed', 'Could not create map.', 'error');
            return;
        }

        player.maps.push(map);
        player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + Cartography.SKILL_GAIN_CREATE);

        // Also reveal those tiles for the player
        const result = Cartography.applyMap(player, map, world);

        game.ui.showNotification('Map Created!', 
            `${map.name} (${Cartography.QUALITY[map.quality].label} quality). Charted ${result.tilesRevealed} tiles.`, 'success');
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showCartographyMenu(game, world.getTile(player.q, player.r));
    },

    /**
     * Show map collection
     */
    showMapCollection(game) {
        const player = game.player;
        const maps = player.maps || [];

        if (maps.length === 0) {
            game.ui.showNotification('No Maps', 'You don\'t have any maps yet.', 'default');
            return;
        }

        let html = '<div style="max-height:500px; overflow-y:auto;">';

        for (let i = 0; i < maps.length; i++) {
            const map = maps[i];
            const qualityData = Cartography.QUALITY[map.quality] || Cartography.QUALITY.crude;
            const ageText = map.createdDay > 0 ? `Day ${map.createdDay}` : 'Ancient';

            let tags = '';
            if (map.isPropaganda) tags += '<span style="color:#ff6666; margin-left:4px;">[PROPAGANDA]</span>';
            if (map.isStolen) tags += '<span style="color:#e8a040; margin-left:4px;">[STOLEN]</span>';
            if (map.isAncient) tags += '<span style="color:#a0a0ff; margin-left:4px;">[ANCIENT]</span>';
            if (map.deliberateErrors.length > 0) tags += '<span style="color:#ff9999; margin-left:4px;">[ALTERED]</span>';

            html += `
                <div style="padding:10px; margin:4px 0; border:1px solid #555; border-radius:4px; background:#2a2a2a;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <b>${map.icon || '📜'} ${map.name}</b>${tags}<br>
                            <small style="color:#aaa;">${qualityData.label} | Accuracy: ${(map.accuracy * 100).toFixed(0)}% | By: ${map.createdBy} | ${ageText}</small>
                        </div>
                        <small style="color:#f5c542;">${map.value}g</small>
                    </div>
                    ${map.notes ? `<p style="font-style:italic; color:#aaa; margin:4px 0; font-size:12px;">${map.notes}</p>` : ''}
                    <div style="margin-top:6px; display:flex; gap:4px;">
                        <button data-am-act="readMap" data-am-args='[${i}]' 
                                style="flex:1; padding:4px 8px; background:#3a5a3a; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:12px;">
                            📖 Read
                        </button>
                        <button data-am-act="sellPlayerMap" data-am-args='[${i}]' 
                                style="flex:1; padding:4px 8px; background:#5a5a3a; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:12px;">
                            💰 Sell (${Math.floor(map.value * 0.7)}g)
                        </button>
                    </div>
                </div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('📚 Map Collection', html);
    },

    /**
     * Read/apply a map from collection
     */
    readMap(game, mapIndex) {
        const player = game.player;
        const maps = player.maps || [];
        if (mapIndex < 0 || mapIndex >= maps.length) return;

        const map = maps[mapIndex];
        const world = game.world;

        // Check for propaganda/errors detection
        let warningText = '';
        if ((map.isPropaganda || map.deliberateErrors.length > 0) && Cartography.canDetectErrors(player, map)) {
            warningText = map.isPropaganda
                ? ' ⚠️ You detect propaganda — some borders shown are false!'
                : ` ⚠️ You notice ${map.deliberateErrors.length} deliberate alteration(s) in this map!`;
        }

        const result = Cartography.applyMap(player, map, world);

        let msg = `Studied ${map.name}. Revealed ${result.tilesRevealed} tiles.`;
        if (warningText) msg += warningText;
        if (map.type === 'treasure' && map.treasureQ !== undefined) {
            msg += ` 💎 Treasure location marked on your map!`;
        }
        if (map.isAncient && map.sites && map.sites.length > 0) {
            msg += ` 📍 ${map.sites.length} ancient site(s) revealed!`;
        }

        game.ui.showNotification('Map Read', msg, 'success');
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showMapCollection(game);
    },

    /**
     * Sell a map from collection
     */
    sellPlayerMap(game, mapIndex) {
        const result = Cartography.sellMap(game.player, mapIndex);
        if (result.success) {
            game.ui.showNotification('Map Sold', `Sold ${result.mapName} for ${result.gold} gold.`, 'success');
            game.ui.updateStats(game.player, game.world);
            if ((game.player.maps || []).length > 0) {
                ActionMenu.showMapCollection(game);
            } else {
                game.ui.hideCustomPanel();
            }
        } else {
            game.ui.showNotification('Cannot Sell', result.reason, 'error');
        }
    },

    /**
     * Show add deliberate errors menu
     */
    showAddErrorsMenu(game) {
        const player = game.player;
        const maps = player.maps || [];
        const editableMaps = maps.filter(m => !m.isPropaganda && !m.isAncient && m.deliberateErrors.length < Cartography.MAX_DELIBERATE_ERRORS);

        if (editableMaps.length === 0) {
            game.ui.showNotification('No Maps', 'No maps available to alter.', 'default');
            return;
        }

        let html = '<div style="max-height:400px; overflow-y:auto;">';
        html += '<p>Add deliberate errors to a map for deception or security. Altered maps appear authentic but contain false information.</p>';

        for (let i = 0; i < maps.length; i++) {
            const map = maps[i];
            if (map.isPropaganda || map.isAncient || map.deliberateErrors.length >= Cartography.MAX_DELIBERATE_ERRORS) continue;

            html += `
                <div style="padding:8px; margin:4px 0; border:1px solid #555; border-radius:4px; cursor:pointer;"
                     data-am-act="executeAddErrors" data-am-args='[${i}]'
                     onmouseover="this.style.borderColor='#e8a040'" onmouseout="this.style.borderColor='#555'">
                    <b>${map.icon || '📜'} ${map.name}</b><br>
                    <small style="color:#aaa;">Current errors: ${map.deliberateErrors.length} / ${Cartography.MAX_DELIBERATE_ERRORS}</small>
                </div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('✏️ Alter Map', html);
    },

    /**
     * Execute adding errors to a map
     */
    executeAddErrors(game, mapIndex) {
        const player = game.player;
        const maps = player.maps || [];
        if (mapIndex < 0 || mapIndex >= maps.length) return;

        const map = maps[mapIndex];
        const errorsToAdd = Utils.randInt(1, 3);
        Cartography.addDeliberateErrors(map, errorsToAdd, game.world);

        game.ui.showNotification('Map Altered', 
            `Added ${errorsToAdd} deliberate error(s) to ${map.name}. Accuracy reduced to ${(map.accuracy * 100).toFixed(0)}%.`, 'info');
        ActionMenu.showCartographyMenu(game, game.world.getTile(player.q, player.r));
    },

    /**
     * Show map trade menu at a settlement
     */
    showMapTradeMenu(game, tile) {
        const player = game.player;
        const world = game.world;

        // Get settlement coordinates
        let tileQ = player.q;
        let tileR = player.r;

        // Create a tile-like object with q,r for the sales function
        const tileWithCoords = { ...tile, q: tileQ, r: tileR };
        const availableMaps = Cartography.getAvailableMapsForSale(tileWithCoords, world);

        let html = '<div style="max-height:500px; overflow-y:auto;">';
        html += `<p>Your gold: <b>${player.gold.toFixed(0)}</b></p>`;

        // Buy section
        html += '<h4 style="color:#f5c542; margin:8px 0 4px;">📥 Maps for Sale</h4>';
        if (availableMaps.length === 0) {
            html += '<p style="color:#aaa;">No maps available at this location.</p>';
        } else {
            for (let i = 0; i < availableMaps.length; i++) {
                const item = availableMaps[i];
                const map = item.map;
                const price = item.price;
                const qualityData = Cartography.QUALITY[map.quality] || Cartography.QUALITY.crude;
                const canAfford = player.gold >= price;

                let tags = '';
                if (map.isPropaganda) tags += '<span style="color:#ff6666; margin-left:4px;">[PROPAGANDA]</span>';
                if (map.isAncient) tags += '<span style="color:#a0a0ff; margin-left:4px;">[ANCIENT]</span>';

                // Store map data for purchase
                if (!window._mapTradeData) window._mapTradeData = [];
                window._mapTradeData[i] = item;

                html += `
                    <div style="padding:8px; margin:4px 0; border:1px solid ${canAfford ? '#555' : '#433'}; border-radius:4px; ${canAfford ? '' : 'opacity:0.6;'}">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <b>${map.icon || '📜'} ${map.name}</b>${tags}<br>
                                <small style="color:#aaa;">${qualityData.label} | Accuracy: ${(map.accuracy * 100).toFixed(0)}% | Radius: ${map.radius}</small>
                            </div>
                            <button data-am-act="buyMapFromTrade" data-am-args='[${i}, ${tileQ}, ${tileR}]' 
                                    style="padding:4px 12px; background:${canAfford ? '#3a5a3a' : '#444'}; color:#fff; border:none; border-radius:3px; cursor:${canAfford ? 'pointer' : 'default'}; white-space:nowrap;"
                                    ${canAfford ? '' : 'disabled'}>
                                Buy (${price}g)
                            </button>
                        </div>
                        ${map.notes ? `<small style="font-style:italic; color:#888;">${map.notes}</small>` : ''}
                    </div>`;
            }
        }

        // Sell section
        const playerMaps = player.maps || [];
        if (playerMaps.length > 0) {
            html += '<h4 style="color:#f5c542; margin:12px 0 4px;">📤 Sell Your Maps</h4>';
            for (let i = 0; i < playerMaps.length; i++) {
                const map = playerMaps[i];
                const sellPrice = Math.floor(map.value * 0.7);
                html += `
                    <div style="padding:6px; margin:3px 0; border:1px solid #555; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
                        <span>${map.icon || '📜'} ${map.name}</span>
                        <button data-am-act="sellMapFromTrade" data-am-args='[${i}, ${tileQ}, ${tileR}]' 
                                style="padding:3px 10px; background:#5a5a3a; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:12px;">
                            Sell (${sellPrice}g)
                        </button>
                    </div>`;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('📜 Map Trader', html);
    },

    /**
     * Buy a map from trade menu
     */
    buyMapFromTrade(game, index, tileQ, tileR) {
        const item = window._mapTradeData ? window._mapTradeData[index] : null;
        if (!item) {
            game.ui.showNotification('Error', 'Map no longer available.', 'error');
            return;
        }
        if (!ActionMenu.commitPendingAP(game)) return;

        const result = Cartography.buyMap(game.player, item.map, item.price);
        if (result.success) {
            // Auto-reveal the map area on the world
            Cartography.applyMap(game.player, item.map, game.world);
            game.ui.showNotification('Map Purchased!', `Acquired ${item.map.name}! The area has been revealed on your map.`, 'success');
            game.ui.updateStats(game.player, game.world);
            // Refresh the trade menu
            const tile = game.world.getTile(tileQ, tileR);
            if (tile) ActionMenu.showMapTradeMenu(game, tile);
        } else {
            game.ui.showNotification('Cannot Buy', result.reason, 'error');
        }
    },

    /**
     * Sell a map from trade menu
     */
    sellMapFromTrade(game, mapIndex, tileQ, tileR) {
        if (!ActionMenu.commitPendingAP(game)) return;
        const result = Cartography.sellMap(game.player, mapIndex);
        if (result.success) {
            game.ui.showNotification('Map Sold', `Sold ${result.mapName} for ${result.gold} gold.`, 'success');
            game.ui.updateStats(game.player, game.world);
            const tile = game.world.getTile(tileQ, tileR);
            if (tile) ActionMenu.showMapTradeMenu(game, tile);
        } else {
            game.ui.showNotification('Cannot Sell', result.reason, 'error');
        }
    },

    /**
     * Attempt to steal a map
     */
    attemptStealMap(game, tile) {
        const result = Cartography.attemptStealMap(game.player, game.world, tile);

        if (result.success) {
            // Auto-reveal the stolen map area on the world
            Cartography.applyMap(game.player, result.map, game.world);
            game.ui.showNotification('Map Stolen!', result.message + ' The area has been revealed on your map.', 'success');
        } else if (result.caught) {
            // Jail for map theft
            const player = game.player;
            const settlement = tile.settlement;
            if (settlement) {
                if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0, mapTheft: 0 };
                player.criminalRecord.mapTheft = (player.criminalRecord.mapTheft || 0) + 1;
                const offenses = player.criminalRecord.mapTheft;
                const jailDays = offenses === 1 ? 2 : offenses === 2 ? 5 : offenses === 3 ? 8 : 10 + (offenses - 4) * 3;
                const bailCost = jailDays * 25;
                player.karma = (player.karma || 0) - 2;
                player.jailState = {
                    daysRemaining: jailDays,
                    totalDays: jailDays,
                    offense: 'map theft',
                    offenseNumber: offenses,
                    settlement: settlement.name,
                    bailCost: bailCost,
                    escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
                };
                player.stamina = 0;
                player.movementRemaining = 0;
                game.ui.showNotification('🚔 Arrested!',
                    `${result.message} Sentenced to ${jailDays} days in jail (offense #${offenses}). -2 karma.`, 'error');
            } else {
                game.ui.showNotification('Caught!', result.message, 'error');
            }
        } else {
            game.ui.showNotification('Failed', result.message, 'default');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Dig for treasure
     */
    digTreasure(game, tile) {
        const result = Cartography.digTreasure(game.player, game.world, game.player.q, game.player.r);

        if (result.success) {
            game.ui.showNotification('Treasure Found!', 
                `You dug up ${result.gold} gold!${result.bonusText || ''}`, 'success');
            game.endDay();
        } else {
            game.ui.showNotification('Nothing Here', result.reason, 'default');
        }
        game.ui.updateStats(game.player, game.world);
    },
});
