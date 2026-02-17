// ============================================
// ACTION MENU — Player interaction menus
// ============================================

const ActionMenu = {
    /**
     * Show action menu at a location
     */
    show(game, tile) {
        const actions = PlayerActions.getAvailableActions(game.player, tile, game.world);

        if (actions.length === 0) {
            game.ui.showNotification('No Actions', 'No actions available here', 'default');
            return;
        }

        // Create action menu UI
        ActionMenu.createMenu(game, tile, actions);
    },

    /**
     * Categorize actions into groups for the tabbed UI
     */
    _categorizeActions(actions) {
        const categories = {
            general:    { label: 'General',    icon: '🏕️', actions: [] },
            commerce:   { label: 'Commerce',   icon: '💰', actions: [] },
            social:     { label: 'Social',     icon: '🗣️', actions: [] },
            military:   { label: 'Military',   icon: '⚔️', actions: [] },
            building:   { label: 'Build',      icon: '🏗️', actions: [] },
            frontier:   { label: 'Frontier',   icon: '🧭', actions: [] },
            cartography:{ label: 'Maps',       icon: '🗺️', actions: [] },
            servitude:  { label: 'Servitude',  icon: '⛓️', actions: [] },
        };

        const mapping = {
            rest: 'general', explore_poi: 'general', clear_trees: 'general', dig_treasure: 'general',
            forage: 'general', hunt: 'general', meditate: 'general', fish: 'general',
            prospect: 'general', tame_horse: 'general', craft_campfire: 'general',
            trade: 'commerce', contract: 'commerce', ship_passage: 'commerce',
            collect_goods: 'commerce', manage_property: 'commerce', start_caravan: 'commerce',
            odd_jobs: 'commerce', bounty_board: 'commerce', busking: 'commerce', gambling: 'commerce',
            smuggle: 'commerce', pickpocket: 'commerce',
            tavern: 'social', talk_locals: 'social', preach: 'social',
            pilgrimage: 'social', miracle: 'social', donate: 'social',
            pledge_allegiance: 'social', renounce_allegiance: 'social',
            host_feast: 'social', hold_tournament: 'social',
            meet_people: 'social', view_relationships: 'social', manage_dynasty: 'social',
            recruit: 'military', attack_unit: 'military', attack_settlement: 'military',
            train_combat: 'military',
            request_meeting: 'social',
            build_property: 'building', build_temple: 'building',
            build_cultural: 'building', build_infrastructure: 'building',
            demolish_infrastructure: 'building',
            buy_house: 'building', manage_house: 'building',
            visit_shipyard: 'commerce', board_ship: 'commerce', manage_fleet: 'commerce',
            found_colony: 'frontier', send_pioneers: 'frontier',
            manage_colony: 'frontier', negotiate_indigenous: 'frontier',
            cartography: 'cartography', map_trade: 'cartography',
            steal_map: 'cartography',
            servitude_wait: 'servitude', servitude_escape: 'servitude',
            servitude_buy_freedom: 'servitude',
        };

        for (const action of actions) {
            const cat = mapping[action.type] || 'general';
            categories[cat].actions.push(action);
        }

        // Return only categories that have actions, preserving order
        const ordered = ['general', 'commerce', 'social', 'military', 'building', 'frontier', 'cartography', 'servitude'];
        return ordered
            .filter(key => categories[key].actions.length > 0)
            .map(key => ({ id: key, ...categories[key] }));
    },

    /**
     * Create the action menu UI — categorized with tabs
     */
    createMenu(game, tile, actions) {
        // Remove existing menu if any
        ActionMenu.close();

        const categories = ActionMenu._categorizeActions(actions);

        // If servitude, show simple flat list (very few actions)
        const isServitude = categories.length === 1 && categories[0].id === 'servitude';

        const menu = document.createElement('div');
        menu.id = 'actionMenu';
        menu.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(16, 20, 28, 0.98);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(245, 197, 66, 0.4);
            border-radius: 10px;
            width: 550px;
            z-index: 1000;
            box-shadow: 0 12px 48px rgba(0,0,0,0.85), 0 0 0 1px rgba(245,197,66,0.1);
            overflow: hidden;
            font-family: var(--font-body);
            display: flex;
            flex-direction: column;
        `;

        // ── Header ──
        let locationInfo = '';
        if (tile.settlement) {
            locationInfo = `${tile.settlement.name} (${tile.settlement.type})`;
        } else if (tile.improvement) {
            locationInfo = tile.improvement.name;
        } else {
            locationInfo = tile.terrain.name || tile.terrain.id;
        }

        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 10px;
                border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(245,197,66,0.04); flex-shrink: 0;">
                <div>
                    <div style="font-family: var(--font-display); font-size: 15px; color: var(--gold); letter-spacing: 0.5px;">Actions</div>
                    <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${locationInfo}</div>
                </div>
                <button id="closeActionMenu" style="background: none; border: none; color: rgba(255,255,255,0.4);
                    font-size: 18px; cursor: pointer; padding: 4px 6px; line-height: 1;
                    transition: color 0.15s;"
                    onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">✕</button>
            </div>
        `;

        if (isServitude) {
            // Simple flat layout for servitude
            html += `<div style="padding: 12px; display: grid; gap: 6px;">`;
            for (const action of categories[0].actions) {
                html += ActionMenu._renderActionButton(action);
            }
            html += `</div>`;
        } else if (categories.length === 1) {
            // Single category — no need for tabs
            html += `<div style="padding: 12px; display: grid; gap: 6px; max-height: 400px; overflow-y: auto;">`;
            for (const action of categories[0].actions) {
                html += ActionMenu._renderActionButton(action);
            }
            html += `</div>`;
        } else {
            // ── Category tabs — wrap to fit ──
            html += `<div id="actionTabs" style="display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 6px 0;
                border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;">`;
            categories.forEach((cat, i) => {
                const isFirst = i === 0;
                html += `
                    <button class="action-tab" data-tab="${cat.id}" style="
                        padding: 5px 8px 7px;
                        font-size: 11px;
                        font-family: var(--font-body);
                        background: ${isFirst ? 'rgba(245,197,66,0.15)' : 'rgba(255,255,255,0.03)'};
                        border: 1px solid ${isFirst ? 'rgba(245,197,66,0.3)' : 'rgba(255,255,255,0.06)'};
                        border-bottom: none;
                        color: ${isFirst ? 'var(--gold)' : 'rgba(255,255,255,0.5)'};
                        cursor: pointer;
                        transition: all 0.15s;
                        white-space: nowrap;
                        border-radius: 5px 5px 0 0;
                    ">${cat.icon} ${cat.label}</button>
                `;
            });
            html += `</div>`;

            // ── Tab content panels — fixed height so menu doesn't resize ──
            html += `<div style="height: 300px; overflow: hidden; position: relative;">`;
            categories.forEach((cat, i) => {
                const isFirst = i === 0;
                html += `<div class="action-tab-content" data-tab="${cat.id}" style="
                    display: ${isFirst ? 'grid' : 'none'};
                    gap: 6px;
                    padding: 10px 12px 14px;
                    height: 100%;
                    box-sizing: border-box;
                    overflow-y: auto;
                    align-content: start;
                ">`;
                for (const action of cat.actions) {
                    html += ActionMenu._renderActionButton(action);
                }
                html += `</div>`;
            });
            html += `</div>`;
        }

        menu.innerHTML = html;
        document.body.appendChild(menu);

        // ── Event listeners ──
        document.getElementById('closeActionMenu').addEventListener('click', () => ActionMenu.close());

        // Tab switching
        const tabs = menu.querySelectorAll('.action-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.getAttribute('data-tab');
                // Update tab styles
                tabs.forEach(t => {
                    const isActive = t.getAttribute('data-tab') === tabId;
                    t.style.background = isActive ? 'rgba(245,197,66,0.15)' : 'rgba(255,255,255,0.03)';
                    t.style.border = isActive ? '1px solid rgba(245,197,66,0.3)' : '1px solid rgba(255,255,255,0.06)';
                    t.style.borderBottom = 'none';
                    t.style.color = isActive ? 'var(--gold)' : 'rgba(255,255,255,0.5)';
                });
                // Show/hide content
                const panels = menu.querySelectorAll('.action-tab-content');
                panels.forEach(p => {
                    p.style.display = p.getAttribute('data-tab') === tabId ? 'grid' : 'none';
                });
            });
        });

        // Action buttons
        const buttons = menu.querySelectorAll('.action-menu-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const actionType = btn.getAttribute('data-action');
                const unitId = btn.getAttribute('data-unit-id');
                ActionMenu.handleAction(game, tile, actionType, unitId);
            });
        });
    },

    /**
     * Render a single action button with icon, label, and description
     */
    _renderActionButton(action) {
        return `
            <button class="action-menu-btn" data-action="${action.type}"${action.unitId ? ` data-unit-id="${action.unitId}"` : ''} style="
                display: flex; align-items: center; gap: 10px;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.07);
                padding: 10px 12px;
                border-radius: 6px;
                color: var(--text-primary);
                cursor: pointer;
                text-align: left;
                transition: background 0.15s, border-color 0.15s, transform 0.1s;
                font-family: var(--font-body);
            " onmouseover="this.style.background='rgba(245,197,66,0.1)';this.style.borderColor='rgba(245,197,66,0.35)'"
               onmouseout="this.style.background='rgba(255,255,255,0.03)';this.style.borderColor='rgba(255,255,255,0.07)'">
                <span style="font-size: 22px; width: 30px; text-align: center; flex-shrink: 0;">${action.icon}</span>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 13px; font-weight: 600; color: #e0e0e0;">${action.label}</div>
                    <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${action.description || ''}</div>
                </div>
            </button>
        `;
    },

    /**
     * Handle action selection
     */
    handleAction(game, tile, actionType, unitId) {
        ActionMenu.close();

        switch (actionType) {
            case 'trade':
                ActionMenu.showTradeMenu(game, tile);
                break;
            case 'recruit':
                ActionMenu.showRecruitMenu(game, tile);
                break;
            case 'contract':
                ActionMenu.showContractMenu(game, tile);
                break;
            case 'preach':
                ActionMenu.preach(game, tile);
                break;
            case 'build_property':
                ActionMenu.showBuildPropertyMenu(game, tile);
                break;
            case 'build_temple':
                ActionMenu.showBuildTempleMenu(game, tile);
                break;
            case 'collect_goods':
                ActionMenu.collectGoods(game, tile);
                break;
            case 'start_caravan':
                ActionMenu.showCaravanMenu(game, tile);
                break;
            case 'rest':
                game.endDay();
                break;
            case 'miracle':
                ActionMenu.showMiracleMenu(game);
                break;
            case 'ship_passage':
                ActionMenu.showShipPassageMenu(game, tile);
                break;
            case 'manage_property':
                ActionMenu.showManagePropertyMenu(game, tile);
                break;
            case 'build_infrastructure':
                ActionMenu.showBuildInfrastructureMenu(game, tile);
                break;
            case 'demolish_infrastructure':
                ActionMenu.demolishInfrastructure(game, tile);
                break;
            case 'clear_trees':
                ActionMenu.clearTrees(game, tile);
                break;
            case 'explore_poi':
                ActionMenu.explorePOI(game, tile);
                break;
            case 'tavern':
                ActionMenu.showTavernMenu(game, tile);
                break;
            case 'talk_locals':
                ActionMenu.showTalkLocalsMenu(game, tile);
                break;
            case 'build_cultural':
                ActionMenu.showBuildCulturalMenu(game, tile);
                break;
            case 'pilgrimage':
                ActionMenu.visitHolySite(game, tile);
                break;
            case 'servitude_wait':
                game.endDay();
                break;
            case 'servitude_escape':
                ActionMenu.attemptServitudeEscape(game);
                break;
            case 'servitude_buy_freedom':
                ActionMenu.buyFreedom(game);
                break;
            case 'found_colony':
                ActionMenu.showFoundColonyMenu(game, tile);
                break;
            case 'send_pioneers':
                ActionMenu.showSendPioneersMenu(game, tile);
                break;
            case 'manage_colony':
                ActionMenu.showManageColonyMenu(game, tile);
                break;
            case 'negotiate_indigenous':
                ActionMenu.showNegotiateIndigenousMenu(game, tile);
                break;
            case 'cartography':
                ActionMenu.showCartographyMenu(game, tile);
                break;
            case 'map_trade':
                ActionMenu.showMapTradeMenu(game, tile);
                break;
            case 'steal_map':
                ActionMenu.attemptStealMap(game, tile);
                break;
            case 'dig_treasure':
                ActionMenu.digTreasure(game, tile);
                break;
            case 'odd_jobs':
                ActionMenu.showOddJobsMenu(game, tile);
                break;
            case 'bounty_board':
                ActionMenu.showBountyBoardMenu(game, tile);
                break;
            case 'busking':
                ActionMenu.showBuskingMenu(game, tile);
                break;
            case 'gambling':
                ActionMenu.showGamblingMenu(game, tile);
                break;
            case 'forage':
                ActionMenu.doForage(game, tile);
                break;
            case 'hunt':
                ActionMenu.doHunt(game, tile);
                break;
            case 'donate':
                ActionMenu.showDonateMenu(game, tile);
                break;
            case 'pledge_allegiance':
                ActionMenu.doPledgeAllegiance(game, tile);
                break;
            case 'renounce_allegiance':
                ActionMenu.doRenounceAllegiance(game, tile);
                break;
            case 'host_feast':
                ActionMenu.showHostFeastMenu(game, tile);
                break;
            case 'hold_tournament':
                ActionMenu.showTournamentMenu(game, tile);
                break;
            case 'pickpocket':
                ActionMenu.doPickpocket(game, tile);
                break;
            case 'smuggle':
                ActionMenu.showSmuggleMenu(game, tile);
                break;
            case 'train_combat':
                ActionMenu.doTrainCombat(game, tile);
                break;
            case 'meditate':
                ActionMenu.doMeditate(game, tile);
                break;
            case 'fish':
                ActionMenu.doFish(game, tile);
                break;
            case 'prospect':
                ActionMenu.doProspect(game, tile);
                break;
            case 'tame_horse':
                ActionMenu.doTameHorse(game, tile);
                break;
            case 'craft_campfire':
                ActionMenu.doCraftCampfire(game, tile);
                break;
            case 'meet_people':
                ActionMenu.showMeetPeopleMenu(game, tile);
                break;
            case 'view_relationships':
                ActionMenu.showRelationshipsMenu(game, tile);
                break;
            case 'manage_dynasty':
                ActionMenu.showDynastyMenu(game, tile);
                break;
            case 'attack_unit':
                ActionMenu.showAttackConfirm(game, tile, actionType);
                break;
            case 'attack_settlement':
                ActionMenu.showSiegeConfirm(game, tile);
                break;
            case 'request_meeting':
                ActionMenu.showLordMeetingMenu(game, tile, { type: actionType, unitId });
                break;
            case 'buy_house':
                ActionMenu.showBuyHouseMenu(game, tile);
                break;
            case 'manage_house':
                ActionMenu.showManageHouseMenu(game, tile);
                break;
            case 'visit_shipyard':
                ActionMenu.showShipyardMenu(game, tile);
                break;
            case 'board_ship':
                ActionMenu.showBoardShipMenu(game, tile);
                break;
            case 'manage_fleet':
                ActionMenu.showFleetMenu(game, tile);
                break;
        }
    },

    /**
     * Show ship passage menu
     */
    showShipPassageMenu(game, tile) {
        const settlements = game.world.getAllSettlements();
        const coastalSettlements = settlements.filter(s => {
            if (s.q === tile.q && s.r === tile.r) return false;
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = game.world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });
        });

        if (coastalSettlements.length === 0) {
            game.ui.showNotification('No Destinations', 'No other coastal settlements found!', 'default');
            return;
        }

        let html = '<div style="max-height: 400px; overflow-y: auto;">';
        html += '<h4 style="margin-top: 0;">Hire a Ship</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Travel across the seas to distant shores.</p>';

        for (const dest of coastalSettlements) {
            const dist = Hex.wrappingDistance(tile.q, tile.r, dest.q, dest.r, game.world.width);
            const cost = 100 + (dist * 5);
            const canAfford = game.player.gold >= cost;

            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center; ${!canAfford ? 'opacity: 0.6;' : ''}">
                    <div>
                        <div style="font-weight: bold; color: white;">${dest.name}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">Distance: ${dist} hexes</div>
                    </div>
                    <button onclick="window.payForPassage(${dest.q}, ${dest.r}, ${cost}, '${dest.name}')" 
                            ${!canAfford ? 'disabled' : ''} 
                            style="padding: 6px 14px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        ${cost} gold
                    </button>
                </div>
            `;
        }

        html += '</div>';

        game.ui.showCustomPanel('Coastal Travel', html);

        window.payForPassage = (q, r, cost, name) => {
            if (game.player.gold >= cost) {
                game.player.gold -= cost;
                game.player.q = q;
                game.player.r = r;
                game.player.isMoving = false;
                game.player.path = [];

                // Teleport and advance time
                game.endDay();

                // Reposition camera
                const pos = Hex.axialToPixel(q, r, game.renderer.hexSize);
                game.camera.centerOn(pos.x, pos.y);

                game.ui.showNotification('Safe Voyage', `You arrived at ${name}. The journey took one day.`, 'success');
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Insufficient Gold', 'You do not have enough gold for passage.', 'error');
            }
        };
    },

    /**
     * Collect goods from property
     */
    collectGoods(game, tile) {
        if (!tile.playerProperty || !tile.playerProperty.storage) return;

        const prop = tile.playerProperty;
        const amount = prop.storage;
        const good = prop.produces;

        if (!game.player.inventory) game.player.inventory = {};
        game.player.inventory[good] = (game.player.inventory[good] || 0) + amount;

        prop.storage = 0;

        const goodDef = PlayerEconomy.GOODS[good.toUpperCase()];
        const goodName = goodDef ? goodDef.name : good;

        game.ui.showNotification('Goods Collected', `Collected ${amount} ${goodName}`, 'success');
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show Manage Property Menu
     */
    showManagePropertyMenu(game, tile) {
        if (!tile.playerProperty) return;

        const prop = tile.playerProperty;
        const propType = PlayerEconomy.PROPERTY_TYPES[prop.type.toUpperCase()];
        const isWorkshop = prop.type === 'workshop';

        // Calculate upgrade info
        const isMaxLevel = prop.level >= 5;
        const upgradeCost = Math.floor(propType.cost * 0.5 * (prop.level + 1));
        const canAffordUpgrade = game.player.gold >= upgradeCost;

        // Calculate upkeep
        const upkeep = (prop.upkeep || 0) * prop.level;

        // Determine what is being produced and rate
        let productionText = 'Nothing selected';
        let prodRateText = '0';

        if (isWorkshop) {
            if (prop.activeRecipe) {
                const recipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                if (recipe) {
                    const outputGood = PlayerEconomy.GOODS[recipe.output.toUpperCase()];
                    productionText = `${outputGood ? outputGood.name : recipe.output}`;
                    // Rate is tricky for workshop, maybe just show base rate
                    prodRateText = `${prop.productionRate * prop.level}`;
                }
            }
        } else {
            // Standard prop
            const goodKey = (prop.produces || '').toUpperCase();
            const good = PlayerEconomy.GOODS[goodKey];
            productionText = good ? good.name : (prop.produces || 'Nothing');
            prodRateText = `${prop.productionRate * prop.level}`;
        }

        // Render menu
        let html = `<div style="padding: 8px;">`;

        // Header info
        html += `
            <div style="display:flex; align-items:center; gap:16px; margin-bottom:20px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:16px;">
                <div style="font-size:48px; border:2px solid var(--gold); border-radius:8px; padding:8px; background:rgba(0,0,0,0.3);">${prop.icon}</div>
                <div style="flex-grow:1;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <h3 style="margin:0; color:var(--gold); font-family:var(--font-display); font-size:24px;">${prop.name} <span style="font-size:16px; color:white; opacity:0.7;">Lvl ${prop.level}</span></h3>
                        <div style="background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:4px; font-size:12px;">Owned: ${prop.daysOwned} days</div>
                    </div>
                    <div style="color:var(--text-secondary); font-size:13px; margin-top:4px;">${propType.description}</div>
                </div>
            </div>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:24px;">
                <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:4px; letter-spacing:1px;">PRODUCTION</div>
                    <div style="font-size:18px; font-weight:bold; color:#2ecc71;">${productionText}</div>
                    <div style="font-size:12px; color:var(--text-secondary);">Rate: ${prodRateText}/day</div>
                </div>
                <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:4px; letter-spacing:1px;">UPKEEP</div>
                    <div style="font-size:24px; font-weight:bold; color:#e74c3c;">-${upkeep}g<span style="font-size:14px; color:var(--text-secondary);">/day</span></div>
                </div>
                <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:4px; letter-spacing:1px;">STORAGE (OUTPUT)</div>
                     <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:24px; font-weight:bold;">${prop.storage}</div>
                        <button onclick="window.collectPropertyGoods()" ${prop.storage <= 0 ? 'disabled' : ''} style="padding:6px 12px; background:var(--gold); border:none; border-radius:4px; cursor:pointer; font-weight:bold; opacity:${prop.storage <= 0 ? 0.5 : 1}">Collect</button>
                    </div>
                </div>
                 <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:4px; letter-spacing:1px;">AUTO-SELL (50% Value)</div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:14px; font-weight:bold; color:${prop.autoSell ? '#2ecc71' : '#95a5a6'};">${prop.autoSell ? 'ENABLED' : 'DISABLED'}</div>
                        <button onclick="window.toggleAutoSell()" style="padding:6px 12px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:4px; cursor:pointer;">${prop.autoSell ? 'Disable' : 'Enable'}</button>
                    </div>
                </div>
            </div>
        `;

        // Workshop Specific Section: Recipe Selector & Input
        if (isWorkshop) {
            html += `
            <div style="margin-bottom:24px; background:rgba(255,255,255,0.03); padding:16px; border-radius:8px; border:1px dashed rgba(255,255,255,0.1);">
                <h4 style="margin:0 0 12px 0; color:var(--gold); border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">Workshop Configuration</h4>
                
                <div style="margin-bottom:16px;">
                    <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">Active Recipe</div>
                    <select id="workshopRecipeSelector" onchange="window.selectRecipe(this.value)" style="width:100%; padding:8px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:4px;">
                        <option value="">-- Select Recipe --</option>
                        ${(() => {
                            const allRecipes = (typeof Technology !== 'undefined') ? Technology.getUnlockedRecipes(game.player) : PlayerEconomy.RECIPES;
                            return Object.values(allRecipes).map(r => `
                            <option value="${r.id.toUpperCase()}" ${prop.activeRecipe === r.id.toUpperCase() ? 'selected' : ''}>
                                ${r.name} (${r.inputQty} ${PlayerEconomy.GOODS[r.input.toUpperCase()]?.name} ➔ ${r.outputQty} ${PlayerEconomy.GOODS[r.output.toUpperCase()]?.name})
                            </option>
                        `).join('');
                        })()}
                    </select>
                </div>
            `;

            if (prop.activeRecipe) {
                const recipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                const inputGood = PlayerEconomy.GOODS[recipe.input.toUpperCase()];
                const playerHas = (game.player.inventory && game.player.inventory[recipe.input]) || 0;

                html += `
                <div style="display:flex; justify-content:space-between; items-center;">
                    <div>
                        <div style="font-size:12px; color:var(--text-secondary);">Input Storage (${inputGood.name})</div>
                        <div style="font-size:20px; font-weight:bold;">${prop.inputStorage || 0} <span style="font-size:12px; font-weight:normal; opacity:0.6;">stored</span></div>
                    </div>
                    <div>
                        <div style="font-size:12px; color:var(--text-secondary); text-align:right;">In Inventory: ${playerHas}</div>
                        <div style="display:flex; gap:8px; margin-top:4px;">
                             <button onclick="window.depositToWorkshop('${recipe.input}', 1)" ${playerHas < 1 ? 'disabled' : ''} style="padding:4px 8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; cursor:pointer;">+1</button>
                             <button onclick="window.depositToWorkshop('${recipe.input}', 10)" ${playerHas < 10 ? 'disabled' : ''} style="padding:4px 8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; cursor:pointer;">+10</button>
                             <button onclick="window.depositToWorkshop('${recipe.input}', 100)" ${playerHas < 100 ? 'disabled' : ''} style="padding:4px 8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; cursor:pointer;">+100</button>
                             <button onclick="window.depositToWorkshop('${recipe.input}', ${playerHas})" ${playerHas < 1 ? 'disabled' : ''} style="padding:4px 8px; background:var(--gold); border:1px solid var(--gold); color:black; font-weight:bold; cursor:pointer;">+All</button>
                        </div>
                    </div>
                </div>
                `;
            } else {
                html += `<div style="color:var(--text-secondary); font-style:italic;">Select a recipe to enable production.</div>`;
            }

            html += `</div>`;
        }

        // Upgrade Section
        const upgradeBtnLocked = isMaxLevel || !canAffordUpgrade;
        html += `
            <div style="margin-bottom:24px; background:linear-gradient(135deg, rgba(20,20,30,0.8) 0%, rgba(40,40,50,0.8) 100%); padding:20px; border-radius:8px; border:1px solid rgba(255,215,0,0.3); box-shadow:0 4px 12px rgba(0,0,0,0.2);">
                <h4 style="margin:0 0 12px 0; color:white; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">Expansion & Upgrades</h4>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:bold; color:var(--text-primary); font-size:16px;">Upgrade to Level ${prop.level + 1}</div>
                        <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">Increases production by 10% base value. Increases upkeep.</div>
                    </div>
                    <button onclick="window.upgradePropertyAction()" 
                        ${upgradeBtnLocked ? 'disabled' : ''}
                        style="padding:10px 20px; background:${isMaxLevel ? '#555' : 'var(--gold)'}; border:none; border-radius:4px; cursor:pointer; font-weight:bold; color:${isMaxLevel ? '#888' : 'var(--text-primary)'}; box-shadow:0 2px 4px rgba(0,0,0,0.2); min-width:120px; text-align:center;">
                        ${isMaxLevel ? 'MAX LEVEL' : `${upgradeCost} gold`}
                    </button>
                </div>
            </div>
        `;

        // Caravan Logistics Section
        html += `
            <div style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h4 style="margin:0;">Logistics Network</h4>
                    <span style="font-size:11px; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">Cost: 200g/caravan</span>
                </div>
                <p style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">Hire a caravan to transport your stored goods directly to a market for max profit.</p>
                <div id="caravanDestinations" style="display:grid; gap:8px; max-height:200px; overflow-y:auto; padding-right:4px;">
                    ${ActionMenu.getLogisticsDestinationsHtml(game, tile)}
                </div>
            </div>
        `;

        // Fishing Wharf Logic
        const isFishingWharf = prop.type === 'fishing_wharf';
        if (isFishingWharf) {
            html += `
            <div style="margin-bottom:24px; background:linear-gradient(135deg, rgba(10,30,50,0.8) 0%, rgba(30,50,80,0.8) 100%); padding:20px; border-radius:8px; border:1px solid rgba(135,206,250,0.3); box-shadow:0 4px 12px rgba(0,0,0,0.2);">
                <h4 style="margin:0 0 12px 0; color:#aaddff; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">Fishing Operations</h4>
                
                <div style="font-size:12px; color:#aaddff; margin-bottom:12px;">Active Boats: ${ActionMenu.countFishingBoats(game, tile)} / ${prop.level}</div>
                
                <div style="margin-bottom:8px; font-weight:bold; font-size:12px; color:var(--text-secondary);">Select Fishing Grounds:</div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; max-height:150px; overflow-y:auto; margin-bottom:12px;">
                    ${ActionMenu.getVariablesFishingGrounds(game, tile)}
                </div>
            </div>
            `;

            // Add helpers
            window.sendFishingBoat = (targetQ, targetR) => {
                const result = PlayerEconomy.sendFishingBoat(game.player, tile, targetQ, targetR, game.world);
                if (result.success) {
                    game.ui.showNotification('Boat Dispatched', 'A fishing boat is heading out.', 'success');
                    ActionMenu.showManagePropertyMenu(game, tile); // Refresh
                } else {
                    game.ui.showNotification('Cannot Dispatch', result.reason, 'error');
                }
            };
        }

        // ═══ RESEARCH LAB SECTION ═══
        if (typeof Technology !== 'undefined') {
            const labConfig = Technology.getLabConfig(prop.type);
            if (labConfig) {
                if (prop.hasLab) {
                    // Lab exists — show lab info, research status, crafting
                    const labCategories = labConfig.categories.map(c => {
                        const cat = Object.values(Technology.CATEGORIES).find(cc => cc.id === c);
                        return cat ? `${cat.icon} ${cat.name}` : c;
                    }).join(', ');

                    html += `
                    <div style="margin-bottom:24px; background:linear-gradient(135deg, rgba(100,50,180,0.15) 0%, rgba(60,30,100,0.2) 100%); padding:20px; border-radius:8px; border:1px solid rgba(156,39,176,0.3); box-shadow:0 4px 12px rgba(0,0,0,0.2);">
                        <h4 style="margin:0 0 12px 0; color:#ce93d8; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">${prop.labIcon || '🔬'} ${prop.labName || 'Research Lab'}</h4>
                        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">Research Categories: ${labCategories}</div>
                    `;

                    // Current research status
                    Technology.initPlayer(game.player);
                    const currentRes = game.player.technology.currentResearch;
                    if (currentRes) {
                        const resTech = Technology.getTechByID(currentRes.techId);
                        const pct = Math.floor((currentRes.progress / currentRes.totalDays) * 100);
                        const remaining = currentRes.totalDays - currentRes.progress;
                        html += `
                        <div style="background:rgba(0,0,0,0.3); padding:12px; border-radius:6px; margin-bottom:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <div><span style="font-size:16px;">${resTech.icon}</span> <strong style="color:var(--gold);">Researching: ${resTech.name}</strong></div>
                                <span style="color:var(--text-secondary); font-size:12px;">${remaining} day${remaining !== 1 ? 's' : ''} left</span>
                            </div>
                            <div style="background:rgba(0,0,0,0.4); border-radius:4px; height:6px; overflow:hidden;">
                                <div style="background:linear-gradient(90deg, #9c27b0, #e040fb); height:100%; width:${pct}%;"></div>
                            </div>
                            <div style="text-align:right; font-size:11px; color:var(--text-secondary); margin-top:3px;">${pct}%</div>
                        </div>`;
                    }

                    // Current crafting status
                    const currentCraft = game.player.technology.currentCrafting;
                    if (currentCraft) {
                        const craftRecipe = Technology.PARTS_CRAFTING[currentCraft.partsType];
                        const craftPct = Math.floor((currentCraft.progress / currentCraft.totalDays) * 100);
                        const craftRemaining = currentCraft.totalDays - currentCraft.progress;
                        html += `
                        <div style="background:rgba(0,0,0,0.3); padding:12px; border-radius:6px; margin-bottom:12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <div><span style="font-size:16px;">🔧</span> <strong style="color:#ff9800;">Crafting: ${craftRecipe ? craftRecipe.name : currentCraft.partsType}</strong></div>
                                <span style="color:var(--text-secondary); font-size:12px;">${craftRemaining} day${craftRemaining !== 1 ? 's' : ''} left</span>
                            </div>
                            <div style="background:rgba(0,0,0,0.4); border-radius:4px; height:6px; overflow:hidden;">
                                <div style="background:linear-gradient(90deg, #ff9800, #ffb74d); height:100%; width:${craftPct}%;"></div>
                            </div>
                            <div style="text-align:right; font-size:11px; color:var(--text-secondary); margin-top:3px;">${craftPct}% — produces ${currentCraft.quantity} parts</div>
                        </div>`;
                    }

                    // Craft Parts button
                    const craftCheck = Technology.canCraftParts(game.player, prop);
                    const partsType = Technology.CATEGORY_PARTS[labConfig.categories[0]];
                    const partsRecipe = Technology.PARTS_CRAFTING[partsType];
                    const partsInInv = (game.player.inventory && game.player.inventory[partsType]) || 0;

                    html += `
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <div>
                                <div style="font-size:13px; color:white;">${partsRecipe ? partsRecipe.icon : '🔧'} ${partsRecipe ? partsRecipe.name : 'Parts'} in inventory: <strong>${partsInInv}</strong></div>
                                <div style="font-size:11px; color:var(--text-secondary);">Cost: ${partsRecipe ? partsRecipe.gold + 'g + ' + Technology.formatMaterials(partsRecipe.materials) : '?'} → ${partsRecipe ? partsRecipe.quantity : '?'} parts (${partsRecipe ? partsRecipe.days : '?'} days)</div>
                            </div>
                            <button onclick="window.startCraftingParts()" ${!craftCheck.can ? 'disabled' : ''} style="padding:8px 14px; background:${craftCheck.can ? '#ff9800' : '#555'}; border:none; border-radius:4px; cursor:pointer; font-weight:bold; color:${craftCheck.can ? 'black' : '#888'};">
                                Craft Parts
                            </button>
                        </div>
                        ${!craftCheck.can && !currentCraft ? `<div style="font-size:11px; color:#e74c3c; margin-bottom:8px;">${craftCheck.reason}</div>` : ''}
                    </div>`;
                } else {
                    // Lab not built — show build lab section
                    const labCheck = Technology.canBuildLab(game.player, prop);
                    html += `
                    <div style="margin-bottom:24px; background:linear-gradient(135deg, rgba(60,30,100,0.15) 0%, rgba(40,20,60,0.2) 100%); padding:20px; border-radius:8px; border:1px dashed rgba(156,39,176,0.3);">
                        <h4 style="margin:0 0 8px 0; color:#ce93d8;">🔬 Build Research Lab</h4>
                        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">${labConfig.description}</div>
                        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">
                            Lab: <strong style="color:white;">${labConfig.labName}</strong><br>
                            Enables research in: ${labConfig.categories.map(c => { const cat = Object.values(Technology.CATEGORIES).find(cc => cc.id === c); return cat ? cat.name : c; }).join(', ')}<br>
                            Cost: <strong style="color:var(--gold);">${labConfig.labCost}g</strong> + ${Technology.formatMaterials(labConfig.labMaterials)}<br>
                            Adds ${labConfig.labUpkeep}g/day upkeep
                        </div>
                        <button onclick="window.buildLabAction()" ${!labCheck.can ? 'disabled' : ''} style="padding:10px 20px; width:100%; background:${labCheck.can ? 'var(--gold)' : '#555'}; border:none; border-radius:4px; cursor:pointer; font-weight:bold; color:${labCheck.can ? 'black' : '#888'};">
                            ${labCheck.can ? 'Build Lab' : labCheck.reason}
                        </button>
                    </div>`;
                }
            }
        }

        html += `</div>`;
        game.ui.showCustomPanel('Manage Property', html);

        // Bind window functions
        window.collectPropertyGoods = () => {
            ActionMenu.collectGoods(game, tile);
            ActionMenu.showManagePropertyMenu(game, tile); // Refresh
        };

        window.toggleAutoSell = () => {
            if (tile.playerProperty) {
                tile.playerProperty.autoSell = !tile.playerProperty.autoSell;
                game.ui.showNotification('Settings Updated', `Auto-sell ${tile.playerProperty.autoSell ? 'enabled' : 'disabled'}`, 'info');
                ActionMenu.showManagePropertyMenu(game, tile); // Refresh
            }
        };

        window.upgradePropertyAction = () => {
            const result = PlayerEconomy.upgradeProperty(game.player, tile);
            if (result.success) {
                game.ui.showNotification('Upgrade Complete!', `Property upgraded to Level ${result.level}`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile); // Refresh
            } else {
                game.ui.showNotification('Cannot Upgrade', result.reason, 'error');
            }
        };

        window.sendStorageCaravan = (q, r) => {
            const targetTile = game.world.getTile(q, r);
            if (!targetTile) return;

            let toObject = null;
            if (targetTile.settlement) {
                toObject = { ...targetTile.settlement, q: targetTile.q, r: targetTile.r, isPlayerProperty: false };
            } else if (targetTile.playerProperty) {
                toObject = {
                    type: targetTile.playerProperty.type,
                    name: targetTile.playerProperty.name,
                    q: targetTile.q,
                    r: targetTile.r,
                    isPlayerProperty: true
                };
            }

            if (!toObject) return;

            const result = PlayerEconomy.startStorageCaravan(game.player, tile, toObject, game.world);

            if (result.success) {
                game.ui.showNotification('Caravan Dispatched', `Transporting goods to ${toObject.name}`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile); // Refresh
            } else {
                game.ui.showNotification('Logistics Error', result.reason, 'error');
            }
        };

        window.selectRecipe = (recipeId) => {
            if (!recipeId) return;
            const result = PlayerEconomy.setWorkshopRecipe(tile, recipeId);
            if (result.success) {
                ActionMenu.showManagePropertyMenu(game, tile);
            }
        };

        window.depositToWorkshop = (goodId, amount) => {
            const result = PlayerEconomy.depositToWorkshop(game.player, tile, goodId, amount);
            if (result.success) {
                game.ui.showNotification('Deposited', `Added ${amount} ${goodId} to workshop`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile);
            } else {
                game.ui.showNotification('Deposit Failed', result.reason, 'error');
            }
        };

        // Lab & crafting handlers
        window.buildLabAction = () => {
            if (typeof Technology === 'undefined') return;
            const result = Technology.buildLab(game.player, tile.playerProperty);
            if (result.success) {
                // Increase upkeep
                const config = Technology.getLabConfig(tile.playerProperty.type);
                if (config) tile.playerProperty.upkeep = (tile.playerProperty.upkeep || 0) + config.labUpkeep;
                game.ui.showNotification('Lab Built!', `${result.labName} is now operational`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Build Lab', result.reason, 'error');
            }
        };

        window.startCraftingParts = () => {
            if (typeof Technology === 'undefined') return;
            const result = Technology.startCrafting(game.player, tile.playerProperty);
            if (result.success) {
                game.ui.showNotification('Crafting Started', `${result.recipe.name} — ${result.estimatedDays} days`, 'info');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Craft', result.reason, 'error');
            }
        };
    },

    /**
     * Helper to generate destination list for logistics
     */
    getLogisticsDestinationsHtml(game, tile) {
        if (!tile.playerProperty || tile.playerProperty.storage <= 0) {
            return '<div style="padding:16px; text-align:center; background:rgba(255,255,255,0.03); border-radius:4px; color:var(--text-secondary); font-style:italic; border:1px dashed rgba(255,255,255,0.1);">No goods in storage to transport.<br>wait for production or collect manually.</div>';
        }

        const settlements = game.world.getAllSettlements();
        let html = '';
        let count = 0;

        // Sort by distance
        settlements.sort((a, b) => {
            const da = Hex.wrappingDistance(tile.q, tile.r, a.q, a.r, game.world.width);
            const db = Hex.wrappingDistance(tile.q, tile.r, b.q, b.r, game.world.width);
            return da - db;
        });

        for (const s of settlements) {
            const dist = Hex.wrappingDistance(tile.q, tile.r, s.q, s.r, game.world.width);

            // Filter: max range 20, don't show current tile if it's a settlement
            if (dist > 0 && dist <= 20) {
                let multiplier = 1.0;
                if (s.type === 'capital') multiplier = 1.5;
                else if (s.type === 'city') multiplier = 1.2;

                const good = PlayerEconomy.GOODS[tile.playerProperty.produces.toUpperCase()];
                const basePrice = MarketDynamics.getPrice(good.id);
                const trend = MarketDynamics.getPriceTrend(good.id);

                let trendIcon = '➡️';
                let trendColor = '#999';
                if (trend === 'rising') { trendIcon = '↗️'; trendColor = '#2ecc71'; }
                else if (trend === 'falling') { trendIcon = '↘️'; trendColor = '#e74c3c'; }

                // Estimate value (base calculation + commerce skill)
                const commerceBonus = 1 + (game.player.skills.commerce * 0.05);
                const estValue = Math.floor(basePrice * (1 + dist * 0.05) * multiplier * tile.playerProperty.storage * commerceBonus);

                html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:4px; transition:background 0.2s;">
                        <div style="flex-grow:1;">
                            <div style="font-weight:bold; color:var(--text-primary);">${s.name} <span style="font-size:10px; opacity:0.6; font-weight:normal;">(${s.type})</span></div>
                            <div style="display:flex; gap:12px; margin-top:2px;">
                                <div style="font-size:10px; color:var(--text-secondary);">📏 ${dist} hexes</div>
                                <div style="font-size:10px; color:#2ecc71;">💰 ~${estValue}g</div>
                                <div style="font-size:10px; color:${trendColor};" title="Market Trend">${trendIcon} ${basePrice}g/unit</div>
                            </div>
                        </div>
                        <button onclick="window.sendStorageCaravan(${s.q}, ${s.r})" style="padding:6px 12px; font-size:11px; background:var(--gold); border:none; border-radius:3px; cursor:pointer; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                            Send
                        </button>
                    </div>
                `;
                count++;
            }
        }

        // Add Player Workshops to destinations
        const playerWorkshops = game.player.properties.filter(p => {
            const t = game.world.getTile(p.q, p.r);
            return t && t.playerProperty && t.playerProperty.type === 'workshop';
        });

        const producedGood = tile.playerProperty.produces;

        for (const ws of playerWorkshops) {
            // Don't ship to self
            if (ws.q === tile.q && ws.r === tile.r) continue;

            const wsTile = game.world.getTile(ws.q, ws.r);
            const wsProp = wsTile.playerProperty;

            // Check if workshop needs this good
            let needsGood = false;
            if (wsProp.activeRecipe) {
                const recipe = PlayerEconomy.RECIPES[wsProp.activeRecipe];
                if (recipe && recipe.input === producedGood) {
                    needsGood = true;
                }
            }

            if (needsGood) {
                const dist = Hex.wrappingDistance(tile.q, tile.r, ws.q, ws.r, game.world.width);
                if (dist > 0 && dist <= 20) {
                    html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.03); border:1px dashed rgba(100,200,255,0.3); border-radius:4px; transition:background 0.2s;">
                        <div style="flex-grow:1;">
                            <div style="font-weight:bold; color:#aaddff;">${ws.name} <span style="font-size:10px; opacity:0.6; font-weight:normal;">(Workshop)</span></div>
                            <div style="display:flex; gap:12px; margin-top:2px;">
                                <div style="font-size:10px; color:var(--text-secondary);">📏 ${dist} hexes</div>
                                <div style="font-size:10px; color:#aaddff;">📦 Internal Transfer</div>
                            </div>
                        </div>
                        <button onclick="window.sendStorageCaravan(${ws.q}, ${ws.r})" style="padding:6px 12px; font-size:11px; background:#3498db; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                            Transfer
                        </button>
                    </div>
                `;
                    count++;
                }
            }
        }

        if (count === 0) {
            return '<div style="padding:16px; text-align:center; color:var(--text-secondary);">No valid destinations within range (20 hexes).</div>';
        }

        return html;
    },

    /**
     * Show trade menu
     */
    showTradeMenu(game, tile) {
        const goods = Trading.getAvailableGoods(tile.settlement, tile);

        let html = '<div style="max-height: 400px; overflow-y: auto;">';
        html += '<h4 style="margin-top: 0;">Buy Goods</h4>';

        for (const good of goods) {
            if (good.quantity <= 0) {
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); opacity: 0.4;">
                        <span>${good.icon} ${good.name}</span>
                        <span style="color: #e74c3c;">Sold Out</span>
                    </div>
                `;
            } else {
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <span>${good.icon} ${good.name}</span>
                        <span>${good.price} gold (${good.quantity} available)</span>
                        <button onclick="window.buyGood('${good.id}', ${good.price}, ${good.quantity})" style="padding: 4px 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">Buy</button>
                    </div>
                `;
            }
        }

        // Sell goods section
        html += '<h4 style="margin-top: 16px;">Sell Goods</h4>';
        if (game.player.inventory && Object.keys(game.player.inventory).length > 0) {
            for (const [goodId, quantity] of Object.entries(game.player.inventory)) {
                if (quantity <= 0) continue;

                const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                if (!good) continue;

                // Calculate sell price (70% of base price locally)
                // Or better yet call Trading.calculatePrice? But sell price is usually lower.
                // Let's stick to what Trading.sellGoods does (70% of base).
                const basePrice = good.basePrice;
                const sellPrice = Math.floor(basePrice * 0.7); // Simple sell price

                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <span>${good.icon} ${good.name} (${quantity})</span>
                        <span>Sell for ${sellPrice} gold</span>
                        <button onclick="window.sellGood('${good.id}', ${sellPrice}, ${quantity})" style="padding: 4px 12px; background: #27ae60; border: none; border-radius: 4px; cursor: pointer;">Sell</button>
                    </div>
                `;
            }
        } else {
            html += '<p style="color: var(--text-secondary); font-size: 12px;">You have no goods to sell.</p>';
        }

        html += '</div>';

        game.ui.showCustomPanel('Trade', html);

        // Store for buy/sell function
        window.currentTile = tile;
        window.buyGood = (goodId, price, maxQty) => {
            ActionMenu.showQuantityInput(`Buy ${PlayerEconomy.GOODS[goodId.toUpperCase()]?.name || goodId}`, maxQty, (qty) => {
                const good = goods.find(g => g.id === goodId);
                if (good) {
                    const result = Trading.buyGoods(game.player, good, qty, tile.settlement);
                    if (result.success) {
                        game.ui.showNotification('Purchase Complete', `Bought ${qty}x ${good.name} for ${result.spent} gold`, 'success');
                        // Discover economy knowledge through trade
                        if (tile.settlement.kingdom) {
                            game.player.learnAboutKingdom(tile.settlement.kingdom, 'economy');
                        }
                        game.ui.updateStats(game.player, game.world);
                        ActionMenu.showTradeMenu(game, tile); // Refresh
                    } else {
                        game.ui.showNotification('Cannot Buy', result.reason, 'error');
                    }
                }
            });
        };

        window.sellGood = (goodId, price, maxQty) => {
            ActionMenu.showQuantityInput(`Sell ${PlayerEconomy.GOODS[goodId.toUpperCase()]?.name || goodId}`, maxQty, (qty) => {
                const result = Trading.sellGoods(game.player, goodId, qty);
                if (result.success) {
                    const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                    game.ui.showNotification('Sale Complete', `Sold ${qty}x ${good.name} for ${result.earned} gold`, 'success');
                    // Discover economy knowledge through trade
                    if (tile.settlement.kingdom) {
                        game.player.learnAboutKingdom(tile.settlement.kingdom, 'economy');
                    }
                    game.ui.updateStats(game.player, game.world);
                    ActionMenu.showTradeMenu(game, tile); // Refresh
                } else {
                    game.ui.showNotification('Cannot Sell', result.reason, 'error');
                }
            });
        };
    },

    /**
     * Show a quantity input modal
     */
    showQuantityInput(title, max, callback) {
        // Remove existing input if any
        const existing = document.getElementById('quantityInputModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'quantityInputModal';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(20, 24, 32, 0.98);
            backdrop-filter: blur(10px);
            border: 2px solid var(--gold);
            border-radius: 8px;
            padding: 20px;
            min-width: 300px;
            z-index: 2000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        modal.innerHTML = `
            <h3 style="margin: 0; color: var(--gold); font-family: var(--font-display);">${title}</h3>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <label style="color: var(--text-secondary); font-size: 14px;">Quantity: <span id="qtyDisplay" style="color: white; font-weight: bold;">1</span> / ${max}</label>
                <input type="range" id="qtyRange" min="1" max="${max}" value="1" style="width: 100%; accent-color: var(--gold);">
                <input type="number" id="qtyNumber" min="1" max="${max}" value="1" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 4px;">
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button id="qtyCancel" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: white; cursor: pointer;">Cancel</button>
                <button id="qtyConfirm" style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; color: var(--text-primary); font-weight: bold; cursor: pointer;">Confirm</button>
            </div>
        `;

        document.body.appendChild(modal);

        const range = document.getElementById('qtyRange');
        const number = document.getElementById('qtyNumber');
        const display = document.getElementById('qtyDisplay');
        const confirm = document.getElementById('qtyConfirm');
        const cancel = document.getElementById('qtyCancel');

        const updateVal = (val) => {
            let v = parseInt(val);
            if (isNaN(v)) v = 1;
            if (v < 1) v = 1;
            if (v > max) v = max;
            range.value = v;
            number.value = v;
            display.textContent = v;
        };

        range.addEventListener('input', (e) => updateVal(e.target.value));
        number.addEventListener('input', (e) => updateVal(e.target.value));

        confirm.addEventListener('click', () => {
            modal.remove();
            callback(parseInt(number.value));
        });

        cancel.addEventListener('click', () => {
            modal.remove();
        });
    },

    /**
     * Show recruit menu
     */
    showRecruitMenu(game, tile) {
        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Recruit Units</h4>';
        html += `<p style="color: var(--text-secondary); font-size: 12px;">Your army strength: ${PlayerMilitary.getArmyStrength(game.player)}</p>`;

        for (const [key, unit] of Object.entries(PlayerMilitary.UNIT_TYPES)) {
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${unit.icon}</span> <strong>${unit.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${unit.description}</div>
                            <div style="font-size: 12px;">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>
                        </div>
                        <button onclick="window.recruitUnit('${key}')" style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">${unit.cost} gold</button>
                    </div>
                </div>
            `;
        }

        // Tech-unlocked units
        if (typeof Technology !== 'undefined') {
            for (const [key, unit] of Object.entries(Technology.TECH_UNITS)) {
                if (!unit.requiredTech || !Technology.isImplemented(game.player, unit.requiredTech)) continue;

                html += `
                    <div style="padding: 12px; margin-bottom: 8px; background: rgba(156, 39, 176, 0.06); border: 1px solid rgba(156, 39, 176, 0.2); border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div><span style="font-size: 20px;">${unit.icon}</span> <strong>${unit.name}</strong> <span style="font-size: 10px; color: #ce93d8;">TECH</span></div>
                                <div style="font-size: 12px; color: var(--text-secondary);">${unit.description}</div>
                                <div style="font-size: 12px;">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>
                            </div>
                            <button onclick="window.recruitTechUnit('${key}')" style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">${unit.cost} gold</button>
                        </div>
                    </div>
                `;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Recruit', html);

        window.recruitUnit = (unitType) => {
            const result = PlayerMilitary.recruitUnit(game.player, unitType, tile.settlement);
            if (result.success) {
                game.ui.showNotification('Unit Recruited!', `${result.unit.name} joined your army`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showRecruitMenu(game, tile); // Refresh
            } else {
                game.ui.showNotification('Cannot Recruit', result.reason, 'error');
            }
        };

        window.recruitTechUnit = (unitKey) => {
            const unit = Technology.TECH_UNITS[unitKey];
            if (!unit) return;
            if (game.player.gold < unit.cost) {
                game.ui.showNotification('Cannot Recruit', `Need ${unit.cost} gold`, 'error');
                return;
            }

            game.player.gold -= unit.cost;
            if (!game.player.army) game.player.army = [];
            game.player.army.push({
                type: unit.id,
                name: unit.name,
                icon: unit.icon,
                strength: unit.strength,
                upkeep: unit.upkeep,
                experience: 0,
                level: 1,
            });

            game.player.skills.combat = Math.min(10, game.player.skills.combat + 0.3);
            game.ui.showNotification('Unit Recruited!', `${unit.name} joined your army`, 'success');
            game.ui.updateStats(game.player, game.world);
            ActionMenu.showRecruitMenu(game, tile);
        };
    },

    /**
     * Show contract menu
     */
    showContractMenu(game, tile) {
        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Mercenary Contracts</h4>';
        html += `<p style="color: var(--text-secondary); font-size: 12px;">Your army strength: ${PlayerMilitary.getArmyStrength(game.player)}</p>`;

        for (const [key, contract] of Object.entries(PlayerMilitary.CONTRACT_TYPES)) {
            const canAccept = PlayerMilitary.getArmyStrength(game.player) >= contract.minStrength;
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; ${!canAccept ? 'opacity: 0.5;' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${contract.icon}</span> <strong>${contract.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${contract.description}</div>
                            <div style="font-size: 12px;">Duration: ${contract.duration} days | Min Strength: ${contract.minStrength}</div>
                        </div>
                        <button onclick="window.acceptContract('${key}')" ${!canAccept ? 'disabled' : ''} style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">${contract.payment} gold</button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Contracts', html);

        window.acceptContract = (contractType) => {
            const result = PlayerMilitary.acceptContract(game.player, contractType, tile.settlement);
            if (result.success) {
                game.ui.showNotification('Contract Accepted!', `${result.contract.name} - ${result.contract.daysRemaining} days remaining`, 'success');
                ActionMenu.close();
            } else {
                game.ui.showNotification('Cannot Accept', result.reason, 'error');
            }
        };
    },

    /**
     * Preach at settlement
     */
    preach(game, tile) {
        const result = PlayerReligion.preach(game.player, tile.settlement, tile);
        if (result.success) {
            game.ui.showNotification('Preaching Success!', `+${result.followersGained} followers, +${result.karmaGained} karma`, 'success');
            game.ui.updateStats(game.player, game.world);
        } else {
            game.ui.showNotification('Cannot Preach', result.reason, 'error');
        }
    },

    /**
     * Show build property menu
     */
    showBuildPropertyMenu(game, tile) {
        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Build Property</h4>';

        for (const [key, prop] of Object.entries(PlayerEconomy.PROPERTY_TYPES)) {
            const check = PlayerEconomy.canBuildProperty(game.player, key, tile, game.world);

            // Determine resource display
            let productionText = '';
            if (prop.id === 'mine') {
                productionText = 'Produces resource located on tile';
                if (tile.resource) {
                    const r = PlayerEconomy.GOODS[tile.resource.id.toUpperCase()];
                    productionText = `Produces: ${r ? r.name : tile.resource.id}`;
                }
            } else if (prop.id === 'trading_post') {
                productionText = 'Attracts merchants';
            } else {
                const good = PlayerEconomy.GOODS[prop.produces ? prop.produces.toUpperCase() : 'GOODS'];
                productionText = `Produces: ${good ? good.name : prop.produces}`;
            }

            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; ${!check.canBuild ? 'opacity: 0.5;' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${prop.icon}</span> <strong>${prop.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${prop.description}</div>
                            <div style="font-size: 12px;">${productionText} | Rate: ~${prop.productionRate}/day</div>
                            ${!check.canBuild ? `<div style="font-size: 11px; color: #e74c3c;">${check.reason}</div>` : ''}
                        </div>
                        <button onclick="window.buildProperty('${key}')" ${!check.canBuild ? 'disabled' : ''} style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">${prop.cost} gold</button>
                    </div>
                </div>
            `;
        }

        // Show tech-unlocked buildings
        if (typeof Technology !== 'undefined') {
            const techBuildings = Technology.TECH_BUILDINGS;
            let hasTechSection = false;
            for (const [key, prop] of Object.entries(techBuildings)) {
                const isUnlocked = prop.requiredTech && Technology.isImplemented(game.player, prop.requiredTech);
                if (!isUnlocked) continue;

                if (!hasTechSection) {
                    html += '<div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);"><div style="font-size: 11px; color: var(--gold); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;">🔬 Tech-Unlocked Buildings</div>';
                    hasTechSection = true;
                }

                // Simple build check for tech buildings
                const canAfford = game.player.gold >= prop.cost;
                const alreadyBuilt = tile.playerProperties && tile.playerProperties.find(p => p.type === prop.id);
                let canBuild = canAfford && !alreadyBuilt;
                let reason = '';
                if (!canAfford) reason = `Need ${prop.cost} gold`;
                if (alreadyBuilt) reason = 'Already built here';
                if (prop.requiredTerrain && !prop.requiredTerrain.includes(tile.terrain.id)) {
                    canBuild = false;
                    reason = `Requires ${prop.requiredTerrain.join(' or ')} terrain`;
                }
                if (prop.requiredResource) {
                    if (!tile.resource || !prop.requiredResource.includes(tile.resource.id)) {
                        canBuild = false;
                        reason = `Requires ${prop.requiredResource.join(' or ')} resource`;
                    }
                }
                if (prop.requiredSettlement && !tile.settlement) {
                    canBuild = false;
                    reason = 'Requires a settlement';
                }

                const productionText = prop.produces ? `Produces: ${prop.produces}` : 'Special building';

                html += `
                    <div style="padding: 12px; margin-bottom: 8px; background: rgba(156, 39, 176, 0.06); border: 1px solid rgba(156, 39, 176, 0.2); border-radius: 4px; ${!canBuild ? 'opacity: 0.5;' : ''}">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div><span style="font-size: 20px;">${prop.icon}</span> <strong>${prop.name}</strong> <span style="font-size: 10px; color: #ce93d8;">TECH</span></div>
                                <div style="font-size: 12px; color: var(--text-secondary);">${prop.description}</div>
                                <div style="font-size: 12px;">${productionText} | Rate: ~${prop.productionRate}/day</div>
                                ${!canBuild && reason ? `<div style="font-size: 11px; color: #e74c3c;">${reason}</div>` : ''}
                            </div>
                            <button onclick="window.buildTechBuilding('${key}')" ${!canBuild ? 'disabled' : ''} style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">${prop.cost} gold</button>
                        </div>
                    </div>
                `;
            }
            if (hasTechSection) html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('Build Property', html);

        window.currentBuildTile = tile;
        window.buildProperty = (propType) => {
            const result = PlayerEconomy.buildProperty(game.player, propType, tile, game.world);
            if (result.success) {
                game.ui.showNotification('Property Built!', `${result.property.name} is now operational`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.close();
            } else {
                game.ui.showNotification('Cannot Build', result.reason, 'error');
            }
        };

        window.buildTechBuilding = (buildingKey) => {
            const building = Technology.TECH_BUILDINGS[buildingKey];
            if (!building) return;
            if (game.player.gold < building.cost) {
                game.ui.showNotification('Cannot Build', `Need ${building.cost} gold`, 'error');
                return;
            }

            game.player.gold -= building.cost;

            const newProperty = {
                type: building.id,
                name: building.name,
                icon: building.icon,
                produces: building.produces,
                productionRate: building.productionRate,
                upkeep: building.upkeep || 0,
                level: 1,
                daysOwned: 0,
                storage: 0,
                inputStorage: 0,
                activeRecipe: null,
                autoSell: false,
            };

            if (!tile.playerProperties) tile.playerProperties = [];
            tile.playerProperties.push(newProperty);
            tile.playerProperty = tile.playerProperties[0];

            if (!game.player.properties) game.player.properties = [];
            game.player.properties.push({
                q: tile.q, r: tile.r,
                type: building.id, name: building.name,
                produces: building.produces,
            });

            game.ui.showNotification('Building Constructed!', `${building.name} is operational`, 'success');
            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
        };
    },

    /**
     * Show build infrastructure menu (roads, bridges, irrigation)
     */
    showBuildInfrastructureMenu(game, tile) {
        if (typeof Infrastructure === 'undefined' || typeof Technology === 'undefined') {
            game.ui.showNotification('Unavailable', 'Infrastructure system not loaded', 'error');
            return;
        }

        const available = Infrastructure.getAvailableTypes(game.player, tile, game.world);

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Build Infrastructure</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Improve the land with roads, bridges, and irrigation.</p>';

        if (tile.infrastructure) {
            html += `<div style="padding: 8px; margin-bottom: 12px; background: rgba(255,255,255,0.08); border-radius: 4px; border-left: 3px solid var(--gold);">
                <span style="font-size: 16px;">${tile.infrastructure.icon}</span> Current: <strong>${tile.infrastructure.name}</strong>
            </div>`;
        }

        if (available.length === 0) {
            html += '<p style="color: var(--text-secondary);">No infrastructure can be built here. Research more technologies or try a different terrain.</p>';
        }

        for (const infra of available) {
            const isUpgrade = infra.upgradesFrom && tile.infrastructure && tile.infrastructure.id === infra.upgradesFrom;
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${infra.icon}</span> <strong>${infra.name}</strong>${isUpgrade ? ' <span style="color: var(--gold); font-size: 11px;">⬆ UPGRADE</span>' : ''}</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${infra.description}</div>
                        </div>
                        <button onclick="window.buildInfra('${infra.id.toUpperCase()}')" style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">${infra.actualCost} gold</button>
                    </div>
                </div>
            `;
        }

        // Show all locked types for awareness
        for (const [key, infra] of Object.entries(Infrastructure.TYPES)) {
            if (available.find(a => a.id === infra.id)) continue;
            const check = Infrastructure.canBuild(game.player, key, tile, game.world);
            if (!check.can) {
                html += `
                    <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.02); border-radius: 4px; opacity: 0.4;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div><span style="font-size: 20px;">${infra.icon}</span> <strong>${infra.name}</strong> 🔒</div>
                                <div style="font-size: 11px; color: #e74c3c;">${check.reason}</div>
                            </div>
                            <span style="color: var(--text-secondary); font-size: 12px;">${infra.cost} gold</span>
                        </div>
                    </div>
                `;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Build Infrastructure', html);

        window.buildInfra = (infraKey) => {
            const result = Infrastructure.build(game.player, infraKey, tile, game.world);
            if (result.success) {
                game.ui.showNotification('Infrastructure Built!', `${result.infrastructure.name} constructed for ${result.cost} gold`, 'success');
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
                // Recalculate reachable hexes
                game.renderer.reachableHexes = game.player.getReachableHexes(game.world);
            } else {
                game.ui.showNotification('Cannot Build', result.reason, 'error');
            }
        };
    },

    /**
     * Demolish infrastructure on a tile
     */
    demolishInfrastructure(game, tile) {
        if (typeof Infrastructure === 'undefined') return;

        const result = Infrastructure.demolish(game.player, tile);
        if (result.success) {
            game.ui.showNotification('Demolished', `${result.name} removed. Refund: ${result.refund} gold`, 'default');
            game.ui.updateStats(game.player, game.world);
            game.renderer.reachableHexes = game.player.getReachableHexes(game.world);
        } else {
            game.ui.showNotification('Cannot Demolish', result.reason, 'error');
        }
    },

    /**
     * Show build temple menu
     */
    showBuildTempleMenu(game, tile) {
        if (!game.player.religion) {
            const name = prompt('Found a religion! Enter religion name:');
            if (name) {
                const result = PlayerReligion.foundReligion(game.player, name);
                if (result.success) {
                    game.ui.showNotification('Religion Founded!', `${name} has been established`, 'success');
                    ActionMenu.showBuildTempleMenu(game, tile);
                } else {
                    game.ui.showNotification('Cannot Found Religion', result.reason, 'error');
                }
            }
            return;
        }

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Build Religious Building</h4>';

        for (const [key, building] of Object.entries(PlayerReligion.BUILDING_TYPES)) {
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${building.icon}</span> <strong>${building.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${building.description}</div>
                            <div style="font-size: 12px;">Faith: +${building.faithGain}/day | Radius: ${building.influenceRadius}</div>
                        </div>
                        <button onclick="window.buildTemple('${key}')" style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">${building.cost} gold</button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Build Temple', html);

        window.buildTemple = (buildingType) => {
            const result = PlayerReligion.buildReligiousBuilding(game.player, buildingType, tile, game.world);
            if (result.success) {
                game.ui.showNotification('Building Constructed!', `${result.building.name} will spread your faith`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.close();
            } else {
                game.ui.showNotification('Cannot Build', result.reason, 'error');
            }
        };
    },

    /**
     * Show miracle menu
     */
    showMiracleMenu(game) {
        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Perform Miracle</h4>';
        html += `<p style="color: var(--text-secondary); font-size: 12px;">Your karma: ${game.player.karma}</p>`;

        for (const [key, miracle] of Object.entries(PlayerReligion.MIRACLES)) {
            const canPerform = game.player.karma >= miracle.karmaCost;
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; ${!canPerform ? 'opacity: 0.5;' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${miracle.icon}</span> <strong>${miracle.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${miracle.description}</div>
                            <div style="font-size: 12px;">Effect: ${miracle.effect}</div>
                        </div>
                        <button onclick="window.performMiracle('${key}')" ${!canPerform ? 'disabled' : ''} style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">${miracle.karmaCost} karma</button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Miracles', html);

        window.performMiracle = (miracleType) => {
            const result = PlayerReligion.performMiracle(game.player, miracleType);
            if (result.success) {
                game.ui.showNotification('Miracle!', result.effect, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.close();
            } else {
                game.ui.showNotification('Cannot Perform', result.reason, 'error');
            }
        };
    },

    /**
     * Count active fishing boats for a wharf
     */
    countFishingBoats(game, tile) {
        return game.world.units.filter(u =>
            u.type === 'fishing_boat' &&
            u.sourceQ === tile.q &&
            u.sourceR === tile.r &&
            !u.destroyed
        ).length;
    },

    /**
     * Get HTML for fishing grounds list
     */
    getVariablesFishingGrounds(game, tile) {
        // Search radius 10 for water tiles
        const potentialspots = [];
        const radius = 10;

        // Scan area
        for (let q = tile.q - radius; q <= tile.q + radius; q++) {
            for (let r = tile.r - radius; r <= tile.r + radius; r++) {
                // Check dist
                if (Hex.distance(tile.q, tile.r, q, r) > radius) continue;

                // Wrap coords
                const wq = Hex.wrapQ(q, game.world.width);
                const t = game.world.getTile(wq, r);

                if (t && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(t.terrain.id)) {
                    // Found water
                    // Check if it has 'fishing_grounds' resource
                    // OR just assume all water can be fished? 
                    // User asked to add "Fishing Grounds" resource earlier.
                    // Let's check for t.resource.id === 'fishing_grounds'
                    // If user hasn't added resource gen logic yet, this might return nothing.
                    // Let's fallback to "Any Coastal Water" if no resources found.

                    let fullness = "Normal";
                    let type = "Water";
                    let isHotSpot = false;

                    if (t.resource && (t.resource.id === 'fishing_grounds' || t.resource.id === 'fish')) {
                        fullness = "Abundant";
                        type = "Fishing Ground";
                        isHotSpot = true;
                    } else if (t.terrain.id === 'deep_ocean') {
                        // Skip deep ocean for basic fishing? Or harder?
                        continue;
                    }

                    // Calculate distance
                    const dist = Hex.wrappingDistance(tile.q, tile.r, wq, r, game.world.width);

                    potentialspots.push({
                        q: wq, r: r,
                        dist,
                        type,
                        fullness,
                        isHotSpot
                    });
                }
            }
        }

        // Sort: Hotspots first, then distance
        potentialspots.sort((a, b) => {
            if (a.isHotSpot && !b.isHotSpot) return -1;
            if (!a.isHotSpot && b.isHotSpot) return 1;
            return a.dist - b.dist;
        });

        // Limit to top 10
        const topSpots = potentialspots.slice(0, 10);

        if (topSpots.length === 0) return '<div style="grid-column: span 2; color:var(--text-secondary); font-style:italic;">No fishing waters nearby.</div>';

        return topSpots.map(s => `
            <button onclick="window.sendFishingBoat(${s.q}, ${s.r})" style="
                display:flex; justify-content:space-between; align-items:center;
                padding:8px; background:rgba(0,0,0,0.3); border:1px solid ${s.isHotSpot ? '#ffd700' : 'rgba(255,255,255,0.1)'};
                border-radius:4px; cursor:pointer; text-align:left; color:white;
            ">
                <div>
                    <div style="font-weight:bold; font-size:11px; color:${s.isHotSpot ? '#ffd700' : 'white'};">${s.type}</div>
                    <div style="font-size:10px; color:var(--text-secondary);">${s.dist} hexes</div>
                </div>
                <div style="font-size:16px;">🎣</div>
            </button>
        `).join('');
    },

    /**
     * Explore a Point of Interest — gives varied rewards based on type
     */
    explorePOI(game, tile) {
        const poi = tile.improvement;
        if (!poi || poi.explored) {
            game.ui.showNotification('Already Explored', 'This place has already been thoroughly searched.', 'default');
            return;
        }

        poi.explored = true;
        const player = game.player;
        if (!player.inventory) player.inventory = {};

        // Reward tables per POI type
        const explorationResults = ActionMenu._generatePOIRewards(poi, player);

        // Apply rewards
        let rewardLines = [];
        for (const reward of explorationResults.rewards) {
            switch (reward.type) {
                case 'gold':
                    player.gold += reward.amount;
                    rewardLines.push(`<div style="color: #f1c40f;">💰 +${reward.amount} Gold</div>`);
                    break;
                case 'item':
                    player.inventory[reward.id] = (player.inventory[reward.id] || 0) + reward.amount;
                    rewardLines.push(`<div style="color: #3498db;">${reward.icon} +${reward.amount} ${reward.name}</div>`);
                    break;
                case 'karma':
                    player.karma += reward.amount;
                    rewardLines.push(`<div style="color: #9b59b6;">🙏 +${reward.amount} Karma</div>`);
                    break;
                case 'renown':
                    player.renown += reward.amount;
                    rewardLines.push(`<div style="color: #e67e22;">⭐ +${reward.amount} Renown</div>`);
                    break;
                case 'health':
                    player.health = Math.min(player.maxHealth, player.health + reward.amount);
                    rewardLines.push(`<div style="color: ${reward.amount > 0 ? '#27ae60' : '#e74c3c'};">${reward.amount > 0 ? '❤️' : '💔'} ${reward.amount > 0 ? '+' : ''}${reward.amount} Health</div>`);
                    break;
                case 'stamina':
                    player.stamina = Math.min(player.maxStamina, player.stamina + reward.amount);
                    rewardLines.push(`<div style="color: #2ecc71;">⚡ +${reward.amount} Stamina</div>`);
                    break;
            }
        }

        // Check for map loot (ancient maps placed by Cartography system)
        if (poi.loot && poi.loot.length > 0) {
            for (const lootItem of poi.loot) {
                if (lootItem.type && lootItem.tiles) {
                    // It's a map object — add to player's map collection
                    if (!player.maps) player.maps = [];
                    player.maps.push(lootItem);
                    rewardLines.push(`<div style="color: #e67e22;">🗺️ Found: ${lootItem.name}</div>`);
                }
            }
            poi.loot = []; // Clear loot after pickup
        }

        // Discover world history lore from POI exploration
        let discoveredLoreEntry = null;
        if (typeof Peoples !== 'undefined') {
            const loreOptions = {};
            // POI type determines what kind of lore you discover
            if (poi.type === 'ruins' || poi.type === 'monument') {
                loreOptions.eraRange = [0, 450]; // Ancient history
            } else if (poi.type === 'shrine') {
                loreOptions.type = 'tribal_origin'; // Tribal/spiritual origins
            }
            const kingdom = tile.kingdom || (tile.settlement && tile.settlement.kingdom) || null;
            if (kingdom) loreOptions.kingdom = kingdom;

            const discovered = Peoples.discoverLore(game.player, game.world, loreOptions);
            if (discovered.length > 0) discoveredLoreEntry = discovered[0];

            // Exploring POIs can reveal peoples and religion knowledge
            if (kingdom) {
                const poiCats = poi.type === 'shrine' ? ['religion'] : ['peoples', 'religion'];
                game.player.learnAboutKingdom(kingdom, poiCats);
            }
        }

        // Show exploration result panel
        let html = '<div style="max-height: 400px; overflow-y: auto;">';
        html += `<div style="text-align: center; margin-bottom: 12px;">`;
        html += `<div style="font-size: 48px; margin-bottom: 8px;">${poi.icon}</div>`;
        html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">${explorationResults.narrative}</div>`;
        html += `</div>`;

        html += `<div style="padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(245,197,66,0.3); border-radius: 6px; margin-bottom: 12px;">`;
        html += `<div style="font-weight: bold; color: var(--gold); margin-bottom: 8px;">Rewards Found:</div>`;
        html += `<div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px;">`;
        html += rewardLines.join('');
        html += `</div></div>`;

        if (explorationResults.lore) {
            html += `<div style="padding: 10px; background: rgba(155,89,182,0.1); border-left: 3px solid #9b59b6; border-radius: 0 4px 4px 0; font-size: 11px; color: var(--text-secondary); font-style: italic; margin-bottom: 12px;">`;
            html += `📜 ${explorationResults.lore}`;
            html += `</div>`;
        }

        // Show discovered lore from history
        if (discoveredLoreEntry) {
            html += `<div style="padding: 12px; background: rgba(155,89,182,0.15); border: 1px solid rgba(155,89,182,0.3); border-radius: 6px; margin-bottom: 12px;">`;
            html += `<div style="font-weight: bold; color: #9b59b6; margin-bottom: 6px;">📜 Historical Lore Discovered!</div>`;
            html += `<div style="color: var(--gold); font-size: 12px; margin-bottom: 4px;">Year ${discoveredLoreEntry.year}</div>`;
            html += `<div style="font-size: 12px; color: var(--text-primary); line-height: 1.4;">${discoveredLoreEntry.text}</div>`;
            html += `<div style="font-size: 10px; color: var(--text-secondary); margin-top: 6px; font-style: italic;">View in 📜 World History panel</div>`;
            html += `</div>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel()" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-family: var(--font-body); color: #1a1a2e;">Continue</button>`;
        html += '</div>';

        game.ui.showCustomPanel(`🔍 Exploring ${poi.name}`, html);
        game.ui.updateStats(player, game.world);

        // Costs a day
        game.endDay();
    },

    /**
     * Generate rewards for exploring a POI
     */
    _generatePOIRewards(poi, player) {
        const rewards = [];
        let narrative = '';
        let lore = '';

        switch (poi.type) {
            case 'ruins': {
                narrative = 'You carefully pick through the crumbling stonework. Beneath fallen pillars and ancient dust, you discover remnants of a forgotten age.';
                const roll = Math.random();
                // Always some gold
                rewards.push({ type: 'gold', amount: Utils.randInt(80, 300) });
                rewards.push({ type: 'renown', amount: Utils.randInt(3, 8) });

                if (roll < 0.3) {
                    // Jackpot — rare items
                    rewards.push({ type: 'item', id: 'gems', name: 'Gems', icon: '💎', amount: Utils.randInt(2, 5) });
                    rewards.push({ type: 'item', id: 'weapons', name: 'Ancient Weapons', icon: '⚔️', amount: Utils.randInt(1, 3) });
                    lore = 'Among the rubble you find an inscription: "Here fell the last defenders of the Old Kingdom. May their blades never rust."';
                } else if (roll < 0.6) {
                    // Moderate — some useful goods
                    rewards.push({ type: 'item', id: 'iron', name: 'Iron', icon: '⛏️', amount: Utils.randInt(5, 12) });
                    rewards.push({ type: 'item', id: 'tools', name: 'Tools', icon: '🔧', amount: Utils.randInt(2, 5) });
                    lore = 'The ruins were once a smithy or armory. Salvageable materials still remain in the storerooms.';
                } else {
                    // Common — basic loot
                    rewards.push({ type: 'item', id: 'wood', name: 'Wood', icon: '🌲', amount: Utils.randInt(5, 10) });
                    lore = 'These ruins have been picked clean by others before you, but the timber framing is still solid enough to salvage.';
                }
                break;
            }
            case 'shrine': {
                narrative = 'You kneel before the weathered shrine and offer a moment of quiet reflection. A warm energy seems to flow through you.';
                rewards.push({ type: 'karma', amount: Utils.randInt(5, 15) });
                rewards.push({ type: 'health', amount: Utils.randInt(10, 25) });

                if (Math.random() < 0.4) {
                    rewards.push({ type: 'gold', amount: Utils.randInt(20, 60) });
                    lore = 'Previous visitors left offerings at the base of the shrine. You take only what the spirits would permit.';
                } else {
                    rewards.push({ type: 'stamina', amount: Utils.randInt(5, 15) });
                    lore = 'The shrine bears the mark of an old faith. Its power is fading, but still present.';
                }
                break;
            }
            case 'cave': {
                narrative = 'You light a torch and venture into the dark mouth of the cave. Dripping water echoes off the stone walls as you delve deeper.';
                const roll = Math.random();

                if (roll < 0.25) {
                    // Rich mineral deposits
                    rewards.push({ type: 'item', id: 'iron', name: 'Iron Ore', icon: '⛏️', amount: Utils.randInt(8, 20) });
                    rewards.push({ type: 'item', id: 'gems', name: 'Gems', icon: '💎', amount: Utils.randInt(3, 8) });
                    rewards.push({ type: 'gold', amount: Utils.randInt(50, 150) });
                    lore = 'The cave opens into a natural cavern glittering with mineral veins. This was likely an old mine.';
                } else if (roll < 0.5) {
                    // Bandit stash
                    rewards.push({ type: 'gold', amount: Utils.randInt(150, 400) });
                    rewards.push({ type: 'item', id: 'weapons', name: 'Weapons', icon: '⚔️', amount: Utils.randInt(2, 5) });
                    lore = 'Deep within, you find a hidden cache — a bandit\'s stash, long abandoned. Their bones lie nearby.';
                } else if (roll < 0.75) {
                    // Some danger
                    rewards.push({ type: 'item', id: 'iron', name: 'Iron Ore', icon: '⛏️', amount: Utils.randInt(3, 8) });
                    rewards.push({ type: 'health', amount: -Utils.randInt(5, 15) });
                    rewards.push({ type: 'gold', amount: Utils.randInt(30, 80) });
                    narrative = 'You venture into the cave but disturb a nest of creatures! You fight them off but take some wounds before finding a small cache.';
                    lore = 'Claw marks line the walls. Whatever lived here was territorial.';
                } else {
                    rewards.push({ type: 'gold', amount: Utils.randInt(40, 100) });
                    rewards.push({ type: 'item', id: 'wood', name: 'Wood', icon: '🌲', amount: Utils.randInt(3, 6) });
                    lore = 'The cave is shallow and unremarkable, but you gather some supplies from old camp remains inside.';
                }
                break;
            }
            case 'oasis': {
                narrative = 'The oasis is a welcome sight. Clear water and date palms offer respite from the harsh surroundings.';
                rewards.push({ type: 'stamina', amount: Utils.randInt(10, 25) });
                rewards.push({ type: 'health', amount: Utils.randInt(10, 20) });

                if (Math.random() < 0.5) {
                    rewards.push({ type: 'item', id: 'spices', name: 'Spices', icon: '🌶️', amount: Utils.randInt(3, 8) });
                    lore = 'Wild herbs and rare spices grow around the water\'s edge — valuable to any merchant.';
                } else {
                    rewards.push({ type: 'gold', amount: Utils.randInt(30, 80) });
                    rewards.push({ type: 'item', id: 'horses', name: 'Horses', icon: '🐴', amount: Utils.randInt(1, 2) });
                    lore = 'A trader\'s caravan was abandoned nearby. You salvage what you can.';
                }
                break;
            }
            case 'monument': {
                narrative = 'You study the towering monument, tracing the carvings etched into ancient stone. The craftsmanship is extraordinary.';
                rewards.push({ type: 'renown', amount: Utils.randInt(8, 20) });
                rewards.push({ type: 'gold', amount: Utils.randInt(30, 100) });

                if (Math.random() < 0.35) {
                    rewards.push({ type: 'item', id: 'luxuries', name: 'Luxuries', icon: '👑', amount: Utils.randInt(1, 4) });
                    lore = 'At the base of the monument, hidden behind a loose stone, you find offerings of gold and finery left by ancient pilgrims.';
                } else {
                    rewards.push({ type: 'karma', amount: Utils.randInt(3, 8) });
                    lore = 'The inscription reads: "To those who seek greatness — the world remembers those who walk its roads."';
                }
                break;
            }
            default: {
                narrative = 'You search the area thoroughly.';
                rewards.push({ type: 'gold', amount: Utils.randInt(20, 80) });
                break;
            }
        }

        return { rewards, narrative, lore };
    },

    /**
     * Clear trees from a forest tile — gives wood, converts to grassland
     */
    clearTrees(game, tile) {
        // Wood yield based on forest density
        const woodYields = {
            'woodland': 5,
            'seasonal_forest': 8,
            'boreal_forest': 8,
            'forest': 10,
            'dense_forest': 15,
            'temperate_rainforest': 12,
            'tropical_rainforest': 12,
        };
        const woodAmount = woodYields[tile.terrain.id] || 8;

        // Add wood to player inventory
        if (!game.player.inventory) game.player.inventory = {};
        game.player.inventory.wood = (game.player.inventory.wood || 0) + woodAmount;

        // Change terrain to grassland
        tile.terrain = Terrain.TYPES.GRASSLAND;

        // Remove any forest-specific resource
        if (tile.resource && ['wood', 'timber'].includes(tile.resource.id)) {
            tile.resource = null;
        }

        game.ui.showNotification('Trees Cleared', `+${woodAmount} 🌲 Wood — the land is now open grassland.`, 'success');
        game.ui.updateStats(game.player, game.world);

        // Advance the day (it takes effort)
        game.endDay();
    },

    /**
     * Show tavern menu — full options in a city tavern
     */
    showTavernMenu(game, tile) {
        const options = Tavern.getTavernOptions(game.player, tile, game.world);

        let html = '<div style="max-height: 450px; overflow-y: auto;">';
        html += '<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0; margin-bottom: 14px;">The tavern is smoky and loud. You might learn something useful here — for a price.</p>';

        for (const opt of options) {
            const costLabel = opt.cost > 0 ? `${opt.cost}g` : 'Free';
            html += `
                <button onclick="window.tavernAction('${opt.id}')"
                    ${!opt.available ? 'disabled' : ''}
                    style="display: flex; align-items: center; gap: 10px; width: 100%;
                        padding: 12px; margin-bottom: 8px;
                        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 4px; cursor: ${opt.available ? 'pointer' : 'default'};
                        text-align: left; color: ${opt.available ? 'white' : '#666'};
                        font-family: var(--font-body); transition: all 0.2s;"
                    onmouseover="this.style.background='rgba(245,197,66,0.15)'; this.style.borderColor='var(--gold)'"
                    onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                    <span style="font-size: 22px;">${opt.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: bold; font-size: 13px;">${opt.label}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">${opt.description}</div>
                    </div>
                    <span style="font-weight: bold; color: ${opt.cost > 0 ? 'var(--gold)' : '#27ae60'}; font-size: 12px;">${costLabel}</span>
                </button>
            `;
        }

        // View intel journal link
        html += `
            <div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;">
                <button onclick="window.showIntelJournal()"
                    style="width: 100%; padding: 10px; background: rgba(52,152,219,0.15); border: 1px solid rgba(52,152,219,0.4);
                    border-radius: 4px; cursor: pointer; color: #3498db; font-family: var(--font-body); font-weight: bold;">
                    📖 View Intel Journal (${game.player.intel ? game.player.intel.rumors.length : 0} entries)
                </button>
            </div>
        `;

        html += '</div>';
        game.ui.showCustomPanel(`🍺 Tavern — ${tile.settlement.name}`, html);

        window.tavernAction = (actionId) => {
            const rumors = Tavern.handleAction(actionId, game.player, tile, game.world);
            // Check if any rumor signals to open the map trade panel
            const mapTradeRumor = rumors.find(r => r.openMapTrade);
            if (mapTradeRumor) {
                ActionMenu.showMapTradeMenu(game, tile);
                return;
            }

            // Discover kingdom knowledge from tavern — wider range of categories
            const tavernKingdomId = tile.kingdom || (tile.settlement && tile.settlement.kingdom);
            if (tavernKingdomId) {
                const tavernCat = Utils.randPick(['ruler', 'peoples', 'religion', 'military', 'diplomacy', 'economy']);
                const learned = game.player.learnAboutKingdom(tavernKingdomId, tavernCat);
                if (learned.length > 0) {
                    const k = game.world.getKingdom(tavernKingdomId);
                    const catNames = learned.join(', ');
                    game.ui.showNotification('Knowledge Gained', `Tavern gossip revealed ${k ? k.name + "'s" : 'the kingdom\'s'} ${catNames}.`, 'info');
                }
            }

            // 25% chance to discover world history lore when buying drinks
            let discoveredLoreEntry = null;
            if (actionId === 'buy_drinks' && typeof Peoples !== 'undefined' && Math.random() < 0.25) {
                const kingdom = tile.kingdom || (tile.settlement && tile.settlement.kingdom) || null;
                const discovered = Peoples.discoverLore(game.player, game.world, { kingdom });
                if (discovered.length > 0) discoveredLoreEntry = discovered[0];
            }

            if (rumors.length > 0 || discoveredLoreEntry) {
                ActionMenu._showRumorResults(game, rumors, tile, discoveredLoreEntry);
            } else {
                game.ui.showNotification('Tavern', 'You didn\'t learn anything new.', 'default');
            }
        };

        window.showIntelJournal = () => {
            ActionMenu.showIntelJournal(game);
        };
    },

    /**
     * Show talk to locals menu — cheaper, limited options in villages
     */
    showTalkLocalsMenu(game, tile) {
        // Talking to locals is free but gives less reliable info
        const rumors = [];
        const numRumors = Utils.randInt(1, 2);

        for (let i = 0; i < numRumors; i++) {
            const rumorType = Utils.randPick(['local_rumor', 'price_hint', 'kingdom_gossip', 'war_rumor']);
            const rumor = Tavern._generateRumor(rumorType, tile, game.world, Tavern.RELIABILITY.LOCAL_TALK);
            if (rumor) rumors.push(rumor);
        }

        // Check notice board automatically
        const boardRumors = Tavern._checkRumorBoard(game.player, tile, game.world);
        rumors.push(...boardRumors);

        // Discover kingdom knowledge from talking to locals — random category
        const localKingdomId = tile.kingdom || (tile.settlement && tile.settlement.kingdom);
        if (localKingdomId) {
            const randomCat = Utils.randPick(['ruler', 'peoples', 'religion']);
            const learned = game.player.learnAboutKingdom(localKingdomId, randomCat);
            if (learned.length > 0) {
                const k = game.world.getKingdom(localKingdomId);
                const catNames = learned.join(', ');
                game.ui.showNotification('Knowledge Gained', `The locals told you about ${k ? k.name + "'s" : 'the kingdom\'s'} ${catNames}.`, 'info');
            }
        }

        // 30% chance to discover a piece of world history from local stories
        let discoveredLoreEntry = null;
        if (typeof Peoples !== 'undefined' && Math.random() < 0.3) {
            const kingdom = tile.kingdom || (tile.settlement && tile.settlement.kingdom) || null;
            const discovered = Peoples.discoverLore(game.player, game.world, { kingdom });
            if (discovered.length > 0) discoveredLoreEntry = discovered[0];
        }

        if (rumors.length > 0 || discoveredLoreEntry) {
            if (rumors.length > 0) Tavern._storeRumors(game.player, rumors);
            ActionMenu._showRumorResults(game, rumors, tile, discoveredLoreEntry);
        } else {
            game.ui.showNotification('Locals', 'The villagers don\'t have much to say today.', 'default');
        }
    },

    /**
     * Display rumor results from a tavern/locals interaction
     */
    _showRumorResults(game, rumors, tile, discoveredLoreEntry) {
        let html = '<div style="max-height: 450px; overflow-y: auto;">';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">You learned ${rumors.length} piece${rumors.length > 1 ? 's' : ''} of information:</p>`;

        for (const rumor of rumors) {
            const freshness = Tavern.getFreshness(rumor, game.world.day);
            const relColor = rumor.reliability.color;
            html += `
                <div style="padding: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.04);
                    border-left: 3px solid ${relColor}; border-radius: 0 4px 4px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-weight: bold; font-size: 13px; color: white;">
                            ${rumor.icon} ${rumor.title}
                        </span>
                        <span style="font-size: 10px; padding: 2px 6px; border-radius: 3px;
                            background: rgba(255,255,255,0.08); color: ${relColor};">
                            ${rumor.reliability.label}
                        </span>
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary); white-space: pre-line;">${rumor.text}</div>
                </div>
            `;
        }

        // Show discovered lore entry if any
        if (discoveredLoreEntry) {
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(155,89,182,0.1);
                    border-left: 3px solid #9b59b6; border-radius: 0 4px 4px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-weight: bold; font-size: 13px; color: #9b59b6;">
                            📜 Historical Lore Discovered!
                        </span>
                        <span style="font-size: 10px; padding: 2px 6px; border-radius: 3px;
                            background: rgba(155,89,182,0.2); color: #9b59b6;">
                            Year ${discoveredLoreEntry.year}
                        </span>
                    </div>
                    <div style="font-size: 12px; color: var(--text-primary); line-height: 1.4;">${discoveredLoreEntry.text}</div>
                    <div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px; font-style: italic;">
                        View in 📜 World History panel
                    </div>
                </div>
            `;
        }

        html += `
            <div style="margin-top: 12px; display: flex; gap: 8px;">
                <button onclick="game.ui.hideCustomPanel()"
                    style="flex: 1; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px; cursor: pointer; color: white; font-family: var(--font-body);">
                    Done
                </button>
                <button onclick="window.showIntelJournal()"
                    style="flex: 1; padding: 8px; background: rgba(52,152,219,0.15); border: 1px solid rgba(52,152,219,0.4);
                    border-radius: 4px; cursor: pointer; color: #3498db; font-family: var(--font-body);">
                    📖 View All Intel
                </button>
            </div>
        `;

        html += '</div>';
        game.ui.showCustomPanel('🗨️ Intelligence Gathered', html);

        window.showIntelJournal = () => {
            ActionMenu.showIntelJournal(game);
        };
    },

    /**
     * Show the full Intel Journal — all gathered intelligence organized by category
     */
    showIntelJournal(game) {
        const player = game.player;
        const byCategory = Tavern.getIntelByCategory(player);
        const currentDay = game.world.day;
        const informants = (player.intel && player.intel.informants) || [];

        const categoryLabels = {
            [Tavern.CATEGORIES.MARKET_PRICES]: { label: '💰 Market Prices', order: 1 },
            [Tavern.CATEGORIES.CHARACTER_LOCATION]: { label: '👑 Characters & Rulers', order: 2 },
            [Tavern.CATEGORIES.KINGDOM_AFFAIRS]: { label: '🏰 Kingdom Affairs', order: 3 },
            [Tavern.CATEGORIES.MILITARY]: { label: '⚔️ Military', order: 4 },
            [Tavern.CATEGORIES.TRADE_OPPORTUNITIES]: { label: '📊 Trade Opportunities', order: 5 },
            [Tavern.CATEGORIES.RUMORS_GOSSIP]: { label: '🗨️ Rumors & Gossip', order: 6 },
        };

        let html = '<div style="max-height: 500px; overflow-y: auto;">';

        // Informants section
        if (informants.length > 0) {
            html += `<div style="margin-bottom: 14px; padding: 10px; background: rgba(52,152,219,0.1); border: 1px solid rgba(52,152,219,0.3); border-radius: 4px;">`;
            html += `<div style="font-weight: bold; color: #3498db; margin-bottom: 6px;">🕵️ Active Informants (${informants.length})</div>`;
            for (const inf of informants) {
                const days = currentDay - inf.hiredDay;
                html += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 2px;">
                    • ${inf.settlementName} — ${days} days active, ${inf.upkeep}g/day upkeep</div>`;
            }
            html += `</div>`;
        }

        // Summary bar
        const totalRumors = player.intel ? player.intel.rumors.length : 0;
        html += `<div style="display: flex; gap: 8px; margin-bottom: 14px; font-size: 11px; color: var(--text-secondary);">
            <span>📋 ${totalRumors} entries</span>
            <span>•</span>
            <span>Expires after ${Tavern.INTEL_DECAY_DAYS} days</span>
        </div>`;

        if (totalRumors === 0) {
            html += `<div style="text-align: center; padding: 30px; color: var(--text-secondary);">
                <div style="font-size: 32px; margin-bottom: 8px;">📖</div>
                <div>Your journal is empty.</div>
                <div style="font-size: 12px; margin-top: 4px;">Visit taverns or talk to locals to gather intelligence.</div>
            </div>`;
        } else {
            // Category tabs
            const categories = Object.entries(byCategory)
                .sort((a, b) => (categoryLabels[a[0]]?.order || 99) - (categoryLabels[b[0]]?.order || 99));

            for (const [catKey, rumors] of categories) {
                const catInfo = categoryLabels[catKey] || { label: catKey, order: 99 };
                html += `
                    <div style="margin-bottom: 16px;">
                        <div style="font-weight: bold; font-size: 13px; color: var(--gold); margin-bottom: 8px;
                            border-bottom: 1px solid rgba(245,197,66,0.3); padding-bottom: 4px;">
                            ${catInfo.label} (${rumors.length})
                        </div>
                `;

                for (const rumor of rumors) {
                    const freshness = Tavern.getFreshness(rumor, currentDay);
                    const age = currentDay - rumor.day;
                    const ageLabel = age === 0 ? 'Today' : age === 1 ? 'Yesterday' : `${age} days ago`;

                    html += `
                        <div style="padding: 8px; margin-bottom: 6px; background: rgba(255,255,255,0.03);
                            border-left: 3px solid ${rumor.reliability.color}; border-radius: 0 4px 4px 0;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                                <span style="font-weight: bold; font-size: 12px; color: white;">
                                    ${rumor.icon} ${rumor.title}
                                </span>
                                <div style="display: flex; gap: 6px; align-items: center;">
                                    <span style="font-size: 9px; padding: 1px 5px; border-radius: 3px;
                                        background: ${freshness.color}22; color: ${freshness.color};">${freshness.label}</span>
                                    <span style="font-size: 9px; padding: 1px 5px; border-radius: 3px;
                                        background: ${rumor.reliability.color}22; color: ${rumor.reliability.color};">${rumor.reliability.label}</span>
                                </div>
                            </div>
                            <div style="font-size: 11px; color: var(--text-secondary); white-space: pre-line;">${rumor.text}</div>
                            <div style="font-size: 10px; color: #555; margin-top: 3px;">
                                📍 ${rumor.source} • ${ageLabel}
                            </div>
                        </div>
                    `;
                }

                html += '</div>';
            }
        }

        html += `
            <div style="margin-top: 8px;">
                <button onclick="game.ui.hideCustomPanel()"
                    style="width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px; cursor: pointer; color: white; font-family: var(--font-body);">
                    Close
                </button>
            </div>
        `;

        html += '</div>';
        game.ui.showCustomPanel('📖 Intel Journal', html);
    },

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
            const result = Culture.buildCulturalBuilding(game.player, buildingType, tile, game.world);
            if (result.success) {
                game.ui.showNotification('Building Constructed!', `${result.building.icon} ${result.building.name} will spread knowledge and influence`, 'success');
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
                <button onclick="ActionMenu.executeFoundColony(game, ${q}, ${r})" 
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
                     onclick="ActionMenu.executeSendPioneers(game, ${target.q}, ${target.r})"
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
        const capitalTile = world.getAllSettlements().find(s => s.kingdom === game.player.kingdom && s.type === 'capital');
        let dist = 0;
        if (capitalTile) {
            dist = Hex.wrappingDistance(tile.q, tile.r, capitalTile.q, capitalTile.r, world.width);
        }

        const policy = Colonization.POLICIES[colony.policy] || Colonization.POLICIES.manifest_destiny;
        const loyaltyColor = colony.loyalty > 60 ? '#4CAF50' : colony.loyalty > 30 ? '#e8a040' : '#ff4444';
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, tile.q, tile.r, 3);

        let html = `
            <div style="max-height:500px; overflow-y:auto;">
                <h3 style="margin:0 0 10px;">Colony: ${tile.settlement.name}</h3>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Population</small><br>
                        <b>${tile.settlement.population}</b>
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
                </div>

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

                <button onclick="ActionMenu.reinforceColony(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🛡️ Reinforce Garrison (+10, costs 100g)
                </button>

                <button onclick="ActionMenu.sendGoldToColony(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    💰 Send Gold Aid (+15 loyalty, costs 150g)
                </button>

                <button onclick="ActionMenu.changeColonyPolicy(game, ${tile.q}, ${tile.r})" 
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
                     onclick="ActionMenu.executeChangePolicy(game, ${q}, ${r}, '${id}')">
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

                <button onclick="ActionMenu.tradeWithIndigenous(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🤝 Trade Goods (costs 50g, reduces hostility)
                </button>

                <button onclick="ActionMenu.giftToIndigenous(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🎁 Offer Tribute (costs 100g, greatly reduces hostility)
                </button>

                <button onclick="ActionMenu.learnFromIndigenous(game, ${tile.q}, ${tile.r})" 
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

                <button onclick="ActionMenu.createMap(game, 'regional')" 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    🗺️ <b>Regional Map</b> — Chart the surrounding area (radius 8)<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.regional.cost}g | Quality: ${qualityData.label}</small>
                </button>

                <button onclick="ActionMenu.createMap(game, 'survey')" 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    📐 <b>Survey Map</b> — Detailed survey showing resources (radius 5)<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.survey.cost}g | Shows resources</small>
                </button>

                ${player.allegiance ? `
                <button onclick="ActionMenu.createMap(game, 'kingdom')" 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    👑 <b>Kingdom Map</b> — Map your kingdom's territory<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.kingdom.cost}g | Shows borders</small>
                </button>` : ''}

                ${mapCount > 0 ? `
                <hr style="border-color:#555;">
                <p><b>Your Maps:</b></p>
                <button onclick="ActionMenu.showMapCollection(game)" 
                        style="width:100%; padding:8px; margin:3px 0; background:#3a5a3a; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    📚 View Map Collection (${mapCount} maps)
                </button>` : ''}

                ${skill >= 3 ? `
                <hr style="border-color:#555;">
                <p><b>Advanced:</b></p>
                <button onclick="ActionMenu.showAddErrorsMenu(game)" 
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
                        <button onclick="ActionMenu.readMap(game, ${i})" 
                                style="flex:1; padding:4px 8px; background:#3a5a3a; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:12px;">
                            📖 Read
                        </button>
                        <button onclick="ActionMenu.sellPlayerMap(game, ${i})" 
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
                     onclick="ActionMenu.executeAddErrors(game, ${i})"
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
                            <button onclick="ActionMenu.buyMapFromTrade(game, ${i}, ${tileQ}, ${tileR})" 
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
                        <button onclick="ActionMenu.sellMapFromTrade(game, ${i}, ${tileQ}, ${tileR})" 
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
            game.ui.showNotification('Caught!', result.message, 'error');
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

    /**
     * Show siege confirmation panel for attacking a settlement
     */
    showSiegeConfirm(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) {
            game.ui.showNotification('No Settlement', 'There is no settlement here to attack.', 'default');
            return;
        }

        const playerStrength = PlayerMilitary.getArmyStrength(game.player);
        const garrisonStrength = PlayerMilitary.getSettlementDefense(settlement, game.world);
        const ratio = playerStrength / Math.max(1, garrisonStrength);

        // Odds assessment
        let oddsLabel, oddsColor;
        if (ratio >= 2.0) { oddsLabel = 'Overwhelming Advantage'; oddsColor = '#2ecc71'; }
        else if (ratio >= 1.3) { oddsLabel = 'Favorable Odds'; oddsColor = '#27ae60'; }
        else if (ratio >= 0.8) { oddsLabel = 'Even Fight'; oddsColor = '#f1c40f'; }
        else if (ratio >= 0.5) { oddsLabel = 'Risky — Outmatched'; oddsColor = '#e67e22'; }
        else { oddsLabel = 'Suicidal — Heavily Outmatched'; oddsColor = '#e74c3c'; }

        const kingdom = settlement.kingdom ? game.world.getKingdom(settlement.kingdom) : null;
        const typeIcon = settlement.type === 'capital' ? '🏰' : settlement.type === 'city' ? '🏙️' : settlement.type === 'town' ? '🏘️' : '🏠';

        let html = '<div style="max-height: 500px; overflow-y: auto;">';

        // Settlement info
        html += `
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 48px; margin-bottom: 8px;">${typeIcon}</div>
                <h3 style="color: var(--gold); margin: 4px 0;">${settlement.name}</h3>
                <div style="color: var(--text-secondary); font-size: 12px;">
                    ${settlement.type.charAt(0).toUpperCase() + settlement.type.slice(1)}
                    ${kingdom ? ` — ${kingdom.name}` : ' — Independent'}
                </div>
            </div>
        `;

        // Strength comparison
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <div style="text-align: center; flex: 1;">
                        <div style="color: #4fc3f7; font-size: 11px; margin-bottom: 4px;">YOUR ARMY</div>
                        <div style="font-size: 24px; font-weight: bold; color: #4fc3f7;">${playerStrength}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">${game.player.army.length} units</div>
                    </div>
                    <div style="display: flex; align-items: center; color: var(--text-secondary); font-size: 24px;">⚔️</div>
                    <div style="text-align: center; flex: 1;">
                        <div style="color: #e74c3c; font-size: 11px; margin-bottom: 4px;">GARRISON</div>
                        <div style="font-size: 24px; font-weight: bold; color: #e74c3c;">${garrisonStrength}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">Pop: ${Utils.formatNumber(settlement.population)}</div>
                    </div>
                </div>
                <div style="text-align: center; padding: 6px; background: rgba(0,0,0,0.3); border-radius: 4px;">
                    <span style="color: ${oddsColor}; font-weight: bold; font-size: 13px;">${oddsLabel}</span>
                </div>
            </div>
        `;

        // Warnings
        html += `<div style="padding: 10px; background: rgba(231,76,60,0.1); border-left: 3px solid #e74c3c; border-radius: 0 4px 4px 0; margin-bottom: 12px; font-size: 12px;">`;
        html += `<div style="color: #e74c3c; font-weight: bold; margin-bottom: 4px;">⚠️ Consequences of Attack</div>`;
        html += `<div style="color: var(--text-secondary); line-height: 1.5;">`;
        html += `• Massive karma penalty (-10)<br>`;
        html += `• Reputation with <strong>ALL</strong> kingdoms drops<br>`;
        if (settlement.kingdom) {
            html += `• Reputation with ${kingdom ? kingdom.name : 'defender'} drops by -50<br>`;
        }
        html += `• Settlement population suffers (-30%)<br>`;
        if (settlement.type === 'capital') {
            html += `• <span style="color: #e74c3c; font-weight: bold;">This is a CAPITAL — expect maximum resistance!</span><br>`;
        }
        html += `</div></div>`;

        // Buttons
        html += `
            <div style="display: flex; gap: 8px;">
                <button onclick="game.ui.hideCustomPanel()" style="
                    flex: 1; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px; cursor: pointer; color: white; font-family: var(--font-body); font-size: 13px;">
                    Retreat
                </button>
                <button onclick="ActionMenu.performSiege(window.game)" style="
                    flex: 1; padding: 10px; background: rgba(231,76,60,0.3); border: 1px solid rgba(231,76,60,0.6);
                    border-radius: 6px; cursor: pointer; color: #ff6666; font-weight: bold; font-family: var(--font-body); font-size: 13px;">
                    ⚔️ ATTACK
                </button>
            </div>
        `;

        html += '</div>';
        game.ui.showCustomPanel(`🏰 Siege — ${settlement.name}`, html);
    },

    /**
     * Execute siege attack against a settlement
     */
    performSiege(game) {
        game.ui.hideCustomPanel();

        const tile = game.world.getTile(game.player.q, game.player.r);
        if (!tile || !tile.settlement) {
            game.ui.showNotification('Error', 'No settlement here to attack.', 'error');
            return;
        }

        const settlement = tile.settlement;
        const result = PlayerMilitary.attackSettlement(game.player, settlement, tile, game.world);

        if (!result.success && result.reason) {
            game.ui.showNotification('Cannot Attack', result.reason, 'error');
            return;
        }

        let html = '<div style="padding: 10px;">';

        if (result.victory) {
            // Victory panel
            html += `<div style="text-align: center; margin-bottom: 12px;">
                <span style="font-size: 48px;">🏆</span>
                <h3 style="color: #66ff66; margin: 5px 0;">Settlement Conquered!</h3>
                <p style="color: #aaa;">You have taken ${settlement.name}!</p>
            </div>`;

            html += `<div style="background: rgba(46,204,113,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px;">`;
            html += `<div style="font-weight: bold; color: var(--gold); margin-bottom: 6px;">Battle Results</div>`;
            html += `<div style="font-size: 13px; line-height: 1.6;">`;
            html += `<div>💰 Gold plundered: <strong style="color: #ffd700;">${result.plunder}</strong></div>`;
            html += `<div>👑 New owner: <strong style="color: #4fc3f7;">${result.newOwner}</strong></div>`;
            if (result.renownChange > 0) {
                html += `<div>⭐ Renown: <strong style="color: #e67e22;">+${result.renownChange}</strong></div>`;
            }
            if (result.casualties > 0) {
                html += `<div style="color: #ff9800;">⚠️ Soldiers lost: ${result.casualties}</div>`;
            }
            html += `</div></div>`;

            if (result.capitalCaptured) {
                html += `<div style="padding: 8px; background: rgba(155,89,182,0.15); border: 1px solid rgba(155,89,182,0.3); border-radius: 4px; margin-bottom: 10px; font-size: 12px; color: #bb86fc;">
                    👑 You have captured their <strong>capital city</strong>!
                    ${result.kingdomDestroyed ? '<br>💀 <strong>The entire kingdom has fallen!</strong>' : '<br>The kingdom will relocate its capital.'}
                </div>`;
            }

            html += `<div style="font-size: 11px; color: #ff6666; padding: 6px; background: rgba(231,76,60,0.1); border-radius: 4px;">
                😈 Karma: ${result.karmaChange} | Reputation with all kingdoms damaged
            </div>`;
        } else {
            // Defeat panel
            html += `<div style="text-align: center; margin-bottom: 12px;">
                <span style="font-size: 48px;">💀</span>
                <h3 style="color: #ff6666; margin: 5px 0;">Siege Failed!</h3>
                <p style="color: #aaa;">The defenders of ${settlement.name} repelled your assault!</p>
            </div>`;

            html += `<div style="background: rgba(231,76,60,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px;">`;
            html += `<div style="font-size: 13px; line-height: 1.6;">`;
            html += `<div style="color: #ff9800;">⚠️ Soldiers lost: ${result.casualties}</div>`;
            html += `<div style="color: #ff6666;">😈 Karma: ${result.karmaChange}</div>`;
            if (result.captured) {
                html += `<div style="color: #ff6666; margin-top: 4px;">⛓️ You have been captured into indentured servitude for ${result.servitudeDays} days!</div>`;
                html += `<div style="color: #ffd700;">💰 ${result.goldConfiscated} gold confiscated.</div>`;
            }
            html += `</div></div>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width: 100%; padding: 10px; margin-top: 10px;
            background: #444; border: 1px solid #666; border-radius: 6px;
            color: #eee; cursor: pointer; font-size: 14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel(result.victory ? '⚔️ Victory!' : '⚔️ Defeat', html);
        game.ui.updateStats(game.player, game.world);
        game.endDay();
    },

    /**
     * Show attack confirmation for a world unit
     */
    showAttackConfirm(game, tile, actionType) {
        // Find units on this tile
        const unitsOnTile = game.world.units.filter(u => u.q === game.player.q && u.r === game.player.r && !u.destroyed);
        if (unitsOnTile.length === 0) {
            game.ui.showNotification('No Target', 'There are no units here to attack.', 'default');
            return;
        }

        let html = '<div style="padding:10px;">';
        html += '<p style="margin-bottom:10px;color:#ccc;">Choose a target to engage in combat:</p>';

        for (const unit of unitsOnTile) {
            const dangerColor = unit.strength > PlayerMilitary.getArmyStrength(game.player) ? '#ff6666' : '#66ff66';
            html += `<button onclick="ActionMenu.performAttack(window.game, '${unit.id}')" style="
                display:flex; align-items:center; gap:10px; width:100%; padding:10px;
                margin-bottom:8px; background:#2a2a2a; border:1px solid #555;
                border-radius:6px; cursor:pointer; color:#eee; text-align:left;
            ">
                <span style="font-size:28px;">${unit.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold;">${unit.name}</div>
                    <div style="font-size:12px; color:#aaa;">Population: ${unit.population} | Strength: <span style="color:${dangerColor}">${unit.strength}</span></div>
                    <div style="font-size:11px; color:#888;">${unit.type === 'caravan' || unit.type === 'ship' || unit.type === 'fishing_boat' ? '⚠️ Attacking traders hurts your karma' : unit.type === 'patrol' ? '⚠️ Attacking patrols angers kingdoms' : '💀 Hostile unit'}</div>
                </div>
            </button>`;
        }

        const playerStr = PlayerMilitary.getArmyStrength(game.player);
        html += `<div style="margin-top:8px; padding:8px; background:#1a1a2e; border-radius:4px; font-size:12px; color:#aaa;">
            Your army strength: <strong style="color:#4fc3f7;">${playerStr}</strong> (${game.player.army.length} units)
        </div>`;
        html += '</div>';

        game.ui.showCustomPanel('⚔️ Attack Unit', html);
    },

    /**
     * Execute attack against a world unit
     */
    performAttack(game, unitId) {
        game.ui.hideCustomPanel();

        const unit = game.world.units.find(u => u.id === unitId && !u.destroyed);
        if (!unit) {
            game.ui.showNotification('Target Gone', 'The unit is no longer here.', 'default');
            return;
        }

        const result = PlayerMilitary.attackUnit(game.player, unit, game.world);

        let html = '<div style="padding:10px;">';

        if (result.noArmy) {
            html += '<p style="color:#ff6666;">You have no army to fight with! Recruit soldiers first.</p>';
        } else if (result.victory) {
            html += `<div style="text-align:center; margin-bottom:10px;">
                <span style="font-size:48px;">🏆</span>
                <h3 style="color:#66ff66; margin:5px 0;">Victory!</h3>
                <p style="color:#aaa;">You defeated the ${result.enemyName}!</p>
            </div>`;
            html += `<div style="background:#1a2e1a; padding:8px; border-radius:4px; margin-bottom:8px;">`;
            html += `<div>💰 Gold looted: <strong style="color:#ffd700;">${result.loot}</strong></div>`;
            if (result.inventoryLoot && Object.keys(result.inventoryLoot).length > 0) {
                html += `<div style="margin-top:4px;">📦 Supplies captured:</div>`;
                for (const [item, qty] of Object.entries(result.inventoryLoot)) {
                    html += `<div style="margin-left:12px; color:#aaa;">• ${item}: ${qty}</div>`;
                }
            }
            html += `</div>`;
            if (result.casualties > 0) {
                html += `<div style="color:#ff9800;">⚠️ You lost ${result.casualties} soldier${result.casualties > 1 ? 's' : ''} in the battle.</div>`;
            }
            if (result.karmaChange < 0) {
                html += `<div style="color:#ff6666;">😈 Karma: ${result.karmaChange}</div>`;
            }
            if (result.renownChange > 0) {
                html += `<div style="color:#4fc3f7;">⭐ Renown +${result.renownChange}</div>`;
            }
        } else {
            html += `<div style="text-align:center; margin-bottom:10px;">
                <span style="font-size:48px;">💀</span>
                <h3 style="color:#ff6666;">Defeat!</h3>
                <p style="color:#aaa;">The ${result.enemyName} overpowered you!</p>
            </div>`;
            html += `<div style="background:#2e1a1a; padding:8px; border-radius:4px; margin-bottom:8px;">`;
            html += `<div style="color:#ff9800;">Lost ${result.casualties} soldier${result.casualties > 1 ? 's' : ''}.</div>`;
            if (result.captured) {
                html += `<div style="color:#ff6666; margin-top:4px;">⛓️ You have been captured into indentured servitude for ${result.servitudeDays} days!</div>`;
                html += `<div style="color:#ffd700;">💰 ${result.goldConfiscated} gold confiscated.</div>`;
            }
            html += `</div>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel(result.victory ? '⚔️ Victory!' : '⚔️ Defeat', html);
        game.ui.updateStats(game.player, game.world);
        game.endDay();
    },

    /**
     * Show lord meeting menu — diplomatic audience with an NPC lord
     */
    showLordMeetingMenu(game, tile, actionType) {
        const player = game.player;
        const world = game.world;

        // Find the lord party unit from the action
        const lordUnit = world.units.find(u => u.type === 'lord_party' && u.id === actionType.unitId && !u.destroyed);
        if (!lordUnit) {
            game.ui.showCustomPanel('👑 Meeting', '<div style="padding:15px; color:#aaa;">The lord has already departed.</div>');
            return;
        }

        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) {
            game.ui.showCustomPanel('👑 Meeting', '<div style="padding:15px; color:#aaa;">This kingdom has no ruler.</div>');
            return;
        }

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;
        const isAllegianceKingdom = player.allegiance === kingdom.id;

        // Determine disposition label and color
        let dispositionLabel, dispositionColor;
        if (totalDisposition >= 50) { dispositionLabel = 'Warm & Welcoming'; dispositionColor = '#4caf50'; }
        else if (totalDisposition >= 20) { dispositionLabel = 'Favorable'; dispositionColor = '#8bc34a'; }
        else if (totalDisposition >= -10) { dispositionLabel = 'Neutral'; dispositionColor = '#ffd54f'; }
        else if (totalDisposition >= -40) { dispositionLabel = 'Cool'; dispositionColor = '#ff9800'; }
        else { dispositionLabel = 'Hostile'; dispositionColor = '#f44336'; }

        // Lord trait descriptions
        const traitNames = lord.traits.map(t => t.name).join(', ') || 'Unremarkable';

        let html = `<div style="padding:15px; max-height:500px; overflow-y:auto;">`;

        // Lord portrait and info
        html += `<div style="text-align:center; margin-bottom:12px;">
            <span style="font-size:48px;">👑</span>
            <h3 style="color:#ffd700; margin:5px 0;">${lord.name}</h3>
            <div style="color:#aaa;">Ruler of <span style="color:#4fc3f7;">${kingdom.name}</span></div>
            <div style="color:#888; font-size:12px;">Age ${lord.age} • ${traitNames}</div>
        </div>`;

        // Stats bar
        html += `<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; margin-bottom:12px; font-size:11px; text-align:center;">
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">⚔️ Martial: ${lord.martial}</div>
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">🗣️ Diplomacy: ${lord.diplomacy}</div>
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">📊 Steward: ${lord.stewardship}</div>
        </div>`;

        // Disposition
        html += `<div style="background:#1a1a2e; padding:8px; border-radius:6px; margin-bottom:12px; text-align:center;">
            <div style="color:#aaa; font-size:11px;">Disposition towards you</div>
            <div style="color:${dispositionColor}; font-size:16px; font-weight:bold;">${dispositionLabel}</div>
            <div style="color:#666; font-size:10px;">Opinion: ${opinion >= 0 ? '+' : ''}${opinion} | Reputation: ${reputation >= 0 ? '+' : ''}${reputation}</div>
        </div>`;

        // Diplomatic options
        html += `<div style="font-weight:bold; color:#ccc; margin-bottom:8px;">Diplomatic Options:</div>`;

        // 1. Improve Relations (always available)
        html += this._meetingOptionButton(
            '🤝', 'Improve Relations',
            'Offer a gift of gold to improve standing',
            `ActionMenu.meetingImproveRelations(game, '${lordUnit.id}')`,
            player.gold >= 50,
            player.gold < 50 ? 'Need at least 50 gold' : null
        );

        // 2. Request Trade Agreement (neutral+ required)
        html += this._meetingOptionButton(
            '⚖️', 'Request Trade Agreement',
            `Better prices in ${kingdom.name} settlements`,
            `ActionMenu.meetingRequestTrade(game, '${lordUnit.id}')`,
            totalDisposition >= -10,
            totalDisposition < -10 ? 'Disposition too low' : null
        );

        // 3. Pledge Allegiance (neutral+ required, not already pledged)
        if (!isAllegianceKingdom) {
            html += this._meetingOptionButton(
                '🏳️', `Pledge to ${kingdom.name}`,
                'Swear fealty — become a vassal of this kingdom',
                `ActionMenu.meetingPledgeAllegiance(game, '${lordUnit.id}')`,
                totalDisposition >= 0,
                totalDisposition < 0 ? 'Must be on neutral terms or better' : null
            );
        } else {
            html += this._meetingOptionButton(
                '🏳️', 'Renounce Allegiance',
                `Leave the service of ${kingdom.name}`,
                `ActionMenu.meetingRenounceAllegiance(game, '${lordUnit.id}')`,
                true, null
            );
        }

        // 4. Request Military Aid (favorable+ required, must be allied/vassal)
        if (isAllegianceKingdom && player.army && player.army.length > 0) {
            html += this._meetingOptionButton(
                '⚔️', 'Request Military Aid',
                'Ask for soldiers to bolster your army',
                `ActionMenu.meetingRequestAid(game, '${lordUnit.id}')`,
                totalDisposition >= 20,
                totalDisposition < 20 ? 'Need favorable disposition' : null
            );
        }

        // 5. Ask about the Realm (always available if not hostile)
        html += this._meetingOptionButton(
            '📜', 'Ask about the Realm',
            `Learn about ${kingdom.name}'s peoples, religion, and history`,
            `ActionMenu.meetingAskAboutRealm(game, '${lordUnit.id}')`,
            totalDisposition >= -40,
            totalDisposition < -40 ? 'Lord refuses to speak with you' : null
        );

        // 6. Demand Tribute (only if powerful army)
        const armyStrength = player.army ? player.army.reduce((s, u) => s + (u.strength || 1), 0) : 0;
        if (armyStrength >= 30) {
            html += this._meetingOptionButton(
                '💰', 'Demand Tribute',
                'Threaten the lord into paying tribute (risky)',
                `ActionMenu.meetingDemandTribute(game, '${lordUnit.id}')`,
                true, null
            );
        }

        // Close button
        html += `<button onclick="game.ui.hideCustomPanel();" style="
            width:100%; padding:10px; margin-top:12px;
            background:#333; border:1px solid #555; border-radius:6px;
            color:#aaa; cursor:pointer; font-size:14px;
        ">Take Your Leave</button>`;

        html += `</div>`;
        game.ui.showCustomPanel('👑 Royal Audience', html);
    },

    /** Helper to create meeting option buttons */
    _meetingOptionButton(icon, label, description, onclick, enabled, disabledReason) {
        const opacity = enabled ? '1' : '0.4';
        const cursor = enabled ? 'cursor:pointer;' : 'cursor:not-allowed;';
        const clickAttr = enabled ? `onclick="${onclick}"` : '';
        return `<button ${clickAttr} style="
            display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; margin-bottom:6px;
            background:#1a2a1a; border:1px solid #333; border-radius:6px;
            color:#ddd; font-size:13px; text-align:left; ${cursor} opacity:${opacity};
        ">
            <span style="font-size:20px;">${icon}</span>
            <div>
                <div style="font-weight:bold;">${label}</div>
                <div style="color:#888; font-size:11px;">${description}${disabledReason ? ' — <span style=color:#ff6666>' + disabledReason + '</span>' : ''}</div>
            </div>
        </button>`;
    },

    /**
     * Meeting action: Improve Relations — gift gold
     */
    meetingImproveRelations(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        // Gift tiers
        const giftAmount = Math.min(player.gold, Math.max(50, Math.floor(player.gold * 0.1)));
        player.gold -= giftAmount;

        // Reputation boost scales with gift
        const repBoost = Math.floor(giftAmount / 10);
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + repBoost;

        const lord = kingdom.lord;
        const newOpinion = NPCLords.getLordOpinion(lord, player) + (player.reputation[kingdom.id] || 0);

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">🤝</span>
            <h3 style="color:#4caf50;">Gift Accepted</h3>
            <p style="color:#aaa;">You present ${lord.name} with a gift of <span style="color:#ffd700;">${giftAmount} gold</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#4caf50;">📈 Reputation +${repBoost}</div>
            </div>`;

        // Trait-based flavor text
        if (lord.traits.some(t => t.id === 'greedy')) {
            html += `<p style="color:#ffd700; font-style:italic;">"Most generous... I shall remember this kindness."</p>`;
        } else if (lord.traits.some(t => t.id === 'honorable')) {
            html += `<p style="color:#4fc3f7; font-style:italic;">"I accept your gift in the spirit of friendship."</p>`;
        } else if (lord.traits.some(t => t.id === 'cruel')) {
            html += `<p style="color:#ff9800; font-style:italic;">"A wise tribute. See that it continues."</p>`;
        } else {
            html += `<p style="color:#aaa; font-style:italic;">"Thank you, traveler. You are welcome in our lands."</p>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('🤝 Diplomacy', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Request Trade Agreement
     */
    meetingRequestTrade(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;

        // Success chance based on disposition + lord diplomacy
        const baseChance = 0.3 + (totalDisposition / 200) + (lord.diplomacy / 40);
        const success = Math.random() < Math.min(0.9, Math.max(0.1, baseChance));

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            // Grant trade bonus — stored on player
            if (!player.tradeAgreements) player.tradeAgreements = {};
            player.tradeAgreements[kingdom.id] = { kingdom: kingdom.name, expires: world.day + 90 };

            // Small reputation boost
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + 5;

            html += `<span style="font-size:42px;">⚖️</span>
                <h3 style="color:#4caf50;">Agreement Reached!</h3>
                <p style="color:#aaa;">${lord.name} agrees to favorable trade terms.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#4caf50;">📈 10% better prices in ${kingdom.name} for 90 days</div>
                    <div style="color:#4fc3f7;">📈 Reputation +5</div>
                </div>`;
        } else {
            html += `<span style="font-size:42px;">❌</span>
                <h3 style="color:#ff9800;">Declined</h3>
                <p style="color:#aaa;">${lord.name} is not interested in a trade agreement at this time.</p>`;

            if (lord.traits.some(t => t.id === 'cautious')) {
                html += `<p style="color:#ff9800; font-style:italic;">"I must consider the risks more carefully."</p>`;
            } else {
                html += `<p style="color:#aaa; font-style:italic;">"Perhaps another time, traveler."</p>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel();" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('⚖️ Trade Negotiation', html);
    },

    /**
     * Meeting action: Pledge Allegiance
     */
    meetingPledgeAllegiance(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        const lord = kingdom.lord;

        // Set allegiance
        const oldAllegiance = player.allegiance;
        player.allegiance = kingdom.id;

        // Big reputation boost
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + 20;

        // If they were pledged elsewhere, that kingdom dislikes it
        if (oldAllegiance && oldAllegiance !== kingdom.id) {
            player.reputation[oldAllegiance] = (player.reputation[oldAllegiance] || 0) - 15;
        }

        player.renown = (player.renown || 0) + 5;

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">🏳️</span>
            <h3 style="color:#4fc3f7;">Allegiance Sworn</h3>
            <p style="color:#aaa;">You kneel before ${lord.name} and swear fealty to <span style="color:#ffd700;">${kingdom.name}</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#4caf50;">📈 Reputation +20 with ${kingdom.name}</div>
                <div style="color:#4fc3f7;">⭐ Renown +5</div>`;
        if (oldAllegiance && oldAllegiance !== kingdom.id) {
            const oldKingdom = world.getKingdom(oldAllegiance);
            if (oldKingdom) {
                html += `<div style="color:#ff6666;">📉 Reputation -15 with ${oldKingdom.name}</div>`;
            }
        }
        html += `</div>`;

        if (lord.traits.some(t => t.id === 'honorable')) {
            html += `<p style="color:#4fc3f7; font-style:italic;">"Rise, friend. Your service honors us both."</p>`;
        } else if (lord.traits.some(t => t.id === 'ambitious')) {
            html += `<p style="color:#ffd700; font-style:italic;">"Good. Together we shall build an empire."</p>`;
        } else {
            html += `<p style="color:#aaa; font-style:italic;">"Welcome to our cause. Serve loyally and you will be rewarded."</p>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('🏳️ Oath of Fealty', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Renounce Allegiance
     */
    meetingRenounceAllegiance(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        const lord = kingdom.lord;
        player.allegiance = null;

        // Reputation hit
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 25;

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">💔</span>
            <h3 style="color:#ff6666;">Allegiance Renounced</h3>
            <p style="color:#aaa;">You declare your independence from <span style="color:#ffd700;">${kingdom.name}</span>.</p>
            <div style="background:#2e1a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#ff6666;">📉 Reputation -25 with ${kingdom.name}</div>
            </div>`;

        if (lord.traits.some(t => t.id === 'cruel')) {
            html += `<p style="color:#f44336; font-style:italic;">"You dare betray me? You will regret this."</p>`;
        } else {
            html += `<p style="color:#ff9800; font-style:italic;">"So be it. Leave, and do not expect our welcome again."</p>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('💔 Renunciation', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Request Military Aid
     */
    meetingRequestAid(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        const lord = kingdom.lord;
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisp = NPCLords.getLordOpinion(lord, player) + reputation;

        // Success chance scales with disposition and lord's martial
        const baseChance = 0.2 + (totalDisp / 150) + (lord.martial / 50);
        const success = Math.random() < Math.min(0.8, Math.max(0.05, baseChance));

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            // Grant soldiers
            const soldierCount = Utils.randInt(3, 8 + Math.floor(lord.martial / 2));
            const soldierStrength = Utils.randInt(2, 4);
            for (let i = 0; i < soldierCount; i++) {
                player.army.push({
                    type: `${kingdom.name} Levy`,
                    strength: soldierStrength,
                    morale: 70 + Utils.randInt(0, 20),
                    upkeep: 1,
                });
            }

            // Small reputation cost (they gave you troops)
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 5;

            html += `<span style="font-size:42px;">⚔️</span>
                <h3 style="color:#4caf50;">Aid Granted!</h3>
                <p style="color:#aaa;">${lord.name} assigns ${soldierCount} soldiers to your command.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#4caf50;">+${soldierCount} ${kingdom.name} Levy (Str ${soldierStrength} each)</div>
                    <div style="color:#ff9800;">📉 Reputation -5 (favor spent)</div>
                </div>`;
        } else {
            html += `<span style="font-size:42px;">❌</span>
                <h3 style="color:#ff9800;">Request Denied</h3>
                <p style="color:#aaa;">${lord.name} cannot spare troops at this time.</p>`;

            if (lord.traits.some(t => t.id === 'cautious')) {
                html += `<p style="color:#ff9800; font-style:italic;">"Our own borders require protection. I cannot risk it."</p>`;
            } else {
                html += `<p style="color:#aaa; font-style:italic;">"I sympathize, but my duty is to my own people first."</p>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('⚔️ Military Aid', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Demand Tribute
     */
    meetingDemandTribute(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        const lord = kingdom.lord;
        const armyStrength = player.army ? player.army.reduce((s, u) => s + (u.strength || 1), 0) : 0;

        // Success depends on army strength vs kingdom military + lord bravery
        const lordResistance = (kingdom.military || 10) + (lord.martial * 3) + (lord.traits.some(t => t.id === 'brave') ? 20 : 0);
        const ratio = armyStrength / Math.max(1, lordResistance);
        const success = Math.random() < Math.min(0.85, ratio * 0.5);

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            const tributeGold = Utils.randInt(50, 200 + Math.floor(kingdom.treasury * 0.1));
            player.gold += tributeGold;
            kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - tributeGold);

            // Major reputation hit
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 30;
            player.karma = (player.karma || 0) - 5;

            html += `<span style="font-size:42px;">💰</span>
                <h3 style="color:#ffd700;">Tribute Paid!</h3>
                <p style="color:#aaa;">${lord.name} grudgingly hands over gold to avoid conflict.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#ffd700;">+${tributeGold} gold</div>
                    <div style="color:#ff6666;">📉 Reputation -30 with ${kingdom.name}</div>
                    <div style="color:#ff6666;">📉 Karma -5</div>
                </div>`;

            if (lord.traits.some(t => t.id === 'cruel')) {
                html += `<p style="color:#f44336; font-style:italic;">"You will pay for this humiliation... in time."</p>`;
            } else {
                html += `<p style="color:#ff9800; font-style:italic;">"Take it and be gone, brigand."</p>`;
            }
        } else {
            // Lord refuses — possible fight with escort
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 15;
            player.karma = (player.karma || 0) - 3;

            html += `<span style="font-size:42px;">⚔️</span>
                <h3 style="color:#f44336;">Refused!</h3>
                <p style="color:#aaa;">${lord.name} orders their guards to drive you away!</p>
                <div style="background:#2e1a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#ff6666;">📉 Reputation -15 with ${kingdom.name}</div>
                    <div style="color:#ff6666;">📉 Karma -3</div>
                </div>`;

            if (lord.traits.some(t => t.id === 'brave')) {
                html += `<p style="color:#4fc3f7; font-style:italic;">"You think I fear you? Guards! Remove this fool!"</p>`;
            } else {
                html += `<p style="color:#ff9800; font-style:italic;">"I... I will not be intimidated! Guards!"</p>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('💰 Tribute Demand', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Ask about the Realm — discover peoples, religion, and lore
     */
    meetingAskAboutRealm(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        // Meeting a lord and asking about their realm reveals ALL knowledge
        const learned = player.learnAboutKingdom(kingdom.id, ['basics', 'ruler', 'peoples', 'religion', 'military', 'diplomacy', 'economy']);
        if (learned.length > 0) {
            game.ui.showNotification('Knowledge Gained', `${kingdom.lord.name} has revealed much about ${kingdom.name}: ${learned.join(', ')}.`, 'info');
        }

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;

        // More info revealed at higher disposition
        const detailLevel = totalDisposition >= 50 ? 'full' : totalDisposition >= 10 ? 'good' : 'basic';

        let html = `<div style="padding:15px; max-height:550px; overflow-y:auto;">`;
        html += `<div style="text-align:center; margin-bottom:12px;">
            <span style="font-size:42px;">📜</span>
            <h3 style="color:#ffd700;">Tales of ${kingdom.name}</h3>
            <div style="color:#888; font-size:12px;">${lord.name} speaks of their realm</div>
        </div>`;

        // ── 1. The Peoples ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #4fc3f7;">`;
        html += `<div style="color:#4fc3f7; font-weight:bold; margin-bottom:6px;">🏛️ The Peoples of ${kingdom.name}</div>`;

        if (typeof Peoples !== 'undefined') {
            const tribes = Peoples.getTribesForCulture(kingdom.culture);
            if (tribes.length > 0) {
                html += `<div style="color:#aaa; font-size:12px; margin-bottom:6px;">"Our realm was founded by the union of ancient peoples..."</div>`;
                for (const tribe of tribes) {
                    html += `<div style="background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-bottom:4px;">`;
                    html += `<div style="color:#fff; font-size:13px;">${tribe.icon} <strong>${tribe.name}</strong></div>`;
                    html += `<div style="color:#888; font-size:11px;">Origin: ${tribe.origin} | Traits: ${tribe.traits.join(', ')}</div>`;
                    if (detailLevel !== 'basic') {
                        html += `<div style="color:#aaa; font-size:11px; font-style:italic; margin-top:2px;">"${tribe.proverb}"</div>`;
                    }
                    if (detailLevel === 'full') {
                        html += `<div style="color:#ffd700; font-size:10px; margin-top:2px;">🎨 ${tribe.artForms.join(', ')} | 🍲 ${tribe.cuisine.slice(0, 2).join(', ')}</div>`;
                    }
                    html += `</div>`;
                }
            } else {
                html += `<div style="color:#aaa; font-size:12px;">"Our people are of the <strong>${kingdom.culture}</strong> tradition."</div>`;
            }
        } else {
            html += `<div style="color:#aaa; font-size:12px;">"We are a proud <strong>${kingdom.culture}</strong> people."</div>`;
        }
        html += `</div>`;

        // ── 2. Religion ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #e6c84c;">`;
        html += `<div style="color:#e6c84c; font-weight:bold; margin-bottom:6px;">🙏 Faith of the Realm</div>`;

        if (kingdom.religion && typeof Religion !== 'undefined') {
            const faith = Religion.FAITHS ? Religion.FAITHS[kingdom.religion.faithId] : null;
            const faithIcon = faith ? faith.icon : '🙏';
            html += `<div style="color:#aaa; font-size:12px;">"We follow the ways of <span style='color:#ffd700;'>${faithIcon} ${kingdom.religion.name}</span>."</div>`;
            html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:6px; font-size:11px;">`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🕊️ Piety: ${Math.floor(kingdom.religion.piety)}/100</div>`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">⚖️ Unity: ${Math.floor(kingdom.religion.unity)}/100</div>`;
            html += `</div>`;
            if (detailLevel !== 'basic') {
                const holySiteCount = kingdom.religion.holySites ? kingdom.religion.holySites.length : 0;
                html += `<div style="color:#888; font-size:11px; margin-top:4px;">⛪ ${holySiteCount} holy site${holySiteCount !== 1 ? 's' : ''} under our protection.</div>`;
            }
            if (detailLevel === 'full' && kingdom.religion.heresies && kingdom.religion.heresies.length > 0) {
                html += `<div style="color:#e74c3c; font-size:11px; margin-top:4px;">⚠️ Heresies trouble the realm: ${kingdom.religion.heresies.map(h => h.name).join(', ')}</div>`;
            }
        } else {
            html += `<div style="color:#aaa; font-size:12px;">"Our people follow the old traditions, without a formal church."</div>`;
        }
        html += `</div>`;

        // ── 3. Kingdom Strength ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #4caf50;">`;
        html += `<div style="color:#4caf50; font-weight:bold; margin-bottom:6px;">⚔️ Strength of the Realm</div>`;

        const settlements = world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
        const totalPop = settlements.reduce((sum, s) => sum + s.population, 0);
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px;">`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🏘️ Settlements: ${settlements.length}</div>`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">👥 Population: ${Utils.formatNumber(totalPop)}</div>`;
        if (detailLevel !== 'basic') {
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🗺️ Territory: ${kingdom.territory ? kingdom.territory.length : 0} tiles</div>`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🛡️ Military: ${kingdom.military || 0}</div>`;
        }
        if (detailLevel === 'full') {
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">💰 Treasury: ~${Utils.formatNumber(Math.round((kingdom.treasury || 0) / 100) * 100)}</div>`;
            const wars = kingdom.wars || [];
            const allies = kingdom.allies || [];
            if (wars.length > 0) {
                const warNames = wars.map(wId => world.getKingdom(wId)?.name || 'Unknown').join(', ');
                html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#e74c3c;">⚔️ At war with: ${warNames}</div>`;
            }
            if (allies.length > 0) {
                const allyNames = allies.map(aId => world.getKingdom(aId)?.name || 'Unknown').join(', ');
                html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#4caf50;">🤝 Allies: ${allyNames}</div>`;
            }
        }
        html += `</div></div>`;

        // ── 4. Diplomacy with Other Kingdoms ──
        if (detailLevel !== 'basic') {
            const otherKingdoms = world.kingdoms.filter(k => k.id !== kingdom.id && k.isAlive);
            if (otherKingdoms.length > 0) {
                html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #9c27b0;">`;
                html += `<div style="color:#9c27b0; font-weight:bold; margin-bottom:6px;">🌍 Relations with Neighbors</div>`;
                for (const other of otherKingdoms) {
                    const rel = kingdom.relations[other.id] || 0;
                    const atWar = kingdom.wars && kingdom.wars.includes(other.id);
                    let relText, relColor;
                    if (atWar) { relText = '⚔️ At War'; relColor = '#e74c3c'; }
                    else if (rel > 50) { relText = '🤝 Allied'; relColor = '#4caf50'; }
                    else if (rel > 0) { relText = '😐 Neutral'; relColor = '#95a5a6'; }
                    else if (rel > -50) { relText = '😠 Tense'; relColor = '#e67e22'; }
                    else { relText = '💢 Hostile'; relColor = '#e74c3c'; }

                    html += `<div style="display:flex; justify-content:space-between; padding:2px 0; font-size:11px;">`;
                    html += `<span style="color:#aaa;"><span style="color:${other.color};">●</span> ${other.name}</span>`;
                    html += `<span style="color:${relColor};">${relText}</span>`;
                    html += `</div>`;
                }
                html += `</div>`;
            }
        }

        // ── 5. Discover World History Lore ──
        let discoveredEntries = [];
        if (typeof Peoples !== 'undefined') {
            // Lords share more lore at higher disposition: 1-3 entries
            const loreCount = detailLevel === 'full' ? 3 : detailLevel === 'good' ? 2 : 1;
            discoveredEntries = Peoples.discoverLore(player, world, {
                kingdom: kingdom.id,
                count: loreCount
            });
        }

        if (discoveredEntries.length > 0) {
            html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #ff9800;">`;
            html += `<div style="color:#ff9800; font-weight:bold; margin-bottom:6px;">📖 Histories Revealed (${discoveredEntries.length})</div>`;
            html += `<div style="color:#888; font-size:11px; margin-bottom:6px;">"Let me share some tales of our past..."</div>`;
            for (const entry of discoveredEntries) {
                html += `<div style="background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-bottom:4px;">`;
                html += `<div style="color:#ffd700; font-size:10px;">Year ${entry.year}</div>`;
                html += `<div style="color:#ddd; font-size:12px; line-height:1.4;">${entry.text}</div>`;
                html += `</div>`;
            }
            html += `<div style="color:#666; font-size:10px; font-style:italic; margin-top:4px;">View all in 📜 World History panel</div>`;
            html += `</div>`;
        }

        // Reputation boost for asking (small)
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + 2;

        // Flavor quote based on lord traits
        html += `<div style="text-align:center; padding:8px; color:#888; font-style:italic; font-size:12px;">`;
        if (lord.traits.some(t => t.id === 'pious')) {
            html += `"All that we are, we owe to the divine. Remember that, traveler."`;
        } else if (lord.traits.some(t => t.id === 'ambitious')) {
            html += `"Know that ${kingdom.name} grows stronger each day. We are destined for greatness."`;
        } else if (lord.traits.some(t => t.id === 'honorable')) {
            html += `"We are a people of honor. This you will see, should you travel our lands."`;
        } else if (lord.traits.some(t => t.id === 'cunning')) {
            html += `"Knowledge is the truest weapon. Use what I've told you wisely."`;
        } else {
            html += `"Now you know something of us. May it serve you well."`;
        }
        html += `</div>`;

        html += `<div style="display:flex; gap:8px;">`;
        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            flex:1; padding:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button>`;
        html += `</div></div>`;

        game.ui.showCustomPanel(`📜 The Realm of ${kingdom.name}`, html);
        game.ui.updateStats(player, world);
    },

    // ============================================================
    // EARLY-GAME INCOME SYSTEMS
    // ============================================================

    /**
     * Show available odd jobs at this settlement
     */
    showOddJobsMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        // Determine settlement tier
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' ? 'town' : 'village');

        // Get job list from data (or fallback)
        const jobData = ActionMenu._getJobData();
        const allJobs = jobData[tier] || jobData['village'];

        // Pick 3 random jobs for today
        const shuffled = [...allJobs].sort(() => Math.random() - 0.5);
        const todayJobs = shuffled.slice(0, 3);

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🔨 Available Work</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Day labor available in ${settlement.name}. Working takes the rest of the day.</p>`;

        for (const job of todayJobs) {
            const statValue = ActionMenu._getPlayerStat(game.player, job.stat);
            const bonus = Math.floor(statValue * 1.5);
            const basePay = Math.floor(Math.random() * (job.pay.max - job.pay.min + 1)) + job.pay.min;
            const totalPay = basePay + bonus;
            const statLabel = job.stat.charAt(0).toUpperCase() + job.stat.slice(1);

            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid var(--gold);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div><span style="font-size: 18px;">${job.icon}</span> <strong>${job.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">${job.description}</div>
                            <div style="font-size: 11px; color: #aaa;">💪 ${statLabel} bonus: +${bonus}g</div>
                        </div>
                        <button onclick="window._doOddJob('${job.id}', ${totalPay})"
                                style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; white-space: nowrap; min-width: 80px;">
                            ${totalPay} gold
                        </button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Day Labor', html);

        window._doOddJob = (jobId, pay) => {
            game.player.gold += pay;
            game.player.renown += 1;

            // Track for quests
            if (!game.player.jobsCompleted) game.player.jobsCompleted = 0;
            game.player.jobsCompleted++;

            // Skill up depending on job
            const job = allJobs.find(j => j.id === jobId);
            if (job && game.player.skills[job.stat] !== undefined) {
                const skillGain = Math.random() < 0.3 ? 0.1 : 0;
                if (skillGain) game.player.skills[job.stat] = Math.min(10, game.player.skills[job.stat] + skillGain);
            }

            // Finance tracking
            if (game.player.financeToday) {
                game.player.financeToday.income.jobs = (game.player.financeToday.income.jobs || 0) + pay;
            }

            game.ui.showNotification('Job Complete!', `Earned ${pay} gold as a ${job ? job.name : 'worker'}`, 'success');
            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
            game.endDay();
        };
    },

    /**
     * Perform foraging on wilderness tiles
     */
    doForage(game, tile) {
        const terrainId = tile.terrain.id;
        const forageData = ActionMenu._getForageData();

        // Map terrain to forage category
        const mapping = forageData.terrain_mapping;
        const category = mapping[terrainId];

        if (!category || !forageData.loot_table[category]) {
            game.ui.showNotification('Nothing Found', 'This terrain has nothing worth gathering.', 'default');
            return;
        }

        const lootTable = forageData.loot_table[category];
        const found = [];
        let totalValue = 0;

        // Intelligence bonus → more finds
        const intBonus = 1 + (game.player.intelligence || 5) * 0.05;

        for (const entry of lootTable) {
            if (Math.random() < entry.chance * intBonus) {
                const qty = Math.floor(Math.random() * (entry.qty.max - entry.qty.min + 1)) + entry.qty.min;
                found.push({ ...entry, foundQty: qty });
                totalValue += qty * entry.sellPrice;
            }
        }

        if (found.length === 0) {
            game.ui.showNotification('Slim Pickings', 'You searched but found nothing of value today.', 'default');
            game.endDay();
            return;
        }

        // Award gold directly (selling foraged goods)
        game.player.gold += totalValue;
        game.player.renown += found.length > 2 ? 1 : 0;

        if (!game.player.foragingTrips) game.player.foragingTrips = 0;
        game.player.foragingTrips++;

        // Finance tracking
        if (game.player.financeToday) {
            game.player.financeToday.income.foraging = (game.player.financeToday.income.foraging || 0) + totalValue;
        }

        let resultHtml = '<div>';
        resultHtml += '<h4 style="margin-top: 0;">🌿 Foraging Results</h4>';
        resultHtml += `<p style="font-size: 12px; color: var(--text-secondary);">You spent the day scouring the ${category} for useful materials.</p>`;

        for (const item of found) {
            resultHtml += `
                <div style="padding: 8px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <div><span style="font-size: 16px;">${item.icon}</span> ${item.name} x${item.foundQty}</div>
                    <div style="color: var(--gold); font-weight: bold;">${item.foundQty * item.sellPrice}g</div>
                </div>
            `;
        }

        resultHtml += `<div style="margin-top: 12px; padding: 10px; background: rgba(245,197,66,0.1); border-radius: 4px; text-align: center; font-weight: bold; color: var(--gold);">Total: ${totalValue} gold</div>`;
        resultHtml += `<button onclick="game.ui.hideCustomPanel(); game.endDay();" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
        resultHtml += '</div>';

        game.ui.showCustomPanel('Foraging', resultHtml);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Hunt wild game on wilderness tiles
     */
    doHunt(game, tile) {
        const terrainId = tile.terrain.id;
        const huntData = ActionMenu._getHuntData();

        // Map terrain to hunt category using forage mapping
        const mapping = ActionMenu._getForageData().terrain_mapping;
        const category = mapping[terrainId];

        if (!category || !huntData.loot_table[category]) {
            game.ui.showNotification('No Game', 'There is nothing to hunt in this terrain.', 'default');
            return;
        }

        const lootTable = huntData.loot_table[category];
        const found = [];
        let totalValue = 0;

        // Combat skill bonus → better odds
        const combatBonus = 1 + ((game.player.skills?.combat || 1) * 0.08);
        // Strength bonus
        const strBonus = 1 + ((game.player.strength || 5) * 0.03);
        const totalBonus = combatBonus * strBonus;

        // Chance of injury while hunting
        const injuryChance = 0.15 - ((game.player.skills?.combat || 1) * 0.01);
        let injured = false;
        let healthLost = 0;

        for (const entry of lootTable) {
            if (Math.random() < entry.chance * totalBonus) {
                const qty = Math.floor(Math.random() * (entry.qty.max - entry.qty.min + 1)) + entry.qty.min;
                found.push({ ...entry, foundQty: qty });
                totalValue += qty * entry.sellPrice;
            }
        }

        // Check for hunting injury
        if (Math.random() < Math.max(0.02, injuryChance)) {
            injured = true;
            healthLost = Math.floor(Math.random() * 15) + 5;
            game.player.health = Math.max(1, game.player.health - healthLost);
        }

        if (found.length === 0 && !injured) {
            game.ui.showNotification('Empty Handed', 'The game eluded you today. Better luck tomorrow.', 'default');
            game.endDay();
            return;
        }

        game.player.gold += totalValue;

        if (!game.player.huntingTrips) game.player.huntingTrips = 0;
        game.player.huntingTrips++;

        // Slight combat skill up
        if (game.player.skills && Math.random() < 0.25) {
            game.player.skills.combat = Math.min(10, (game.player.skills.combat || 1) + 0.1);
        }

        // Finance tracking
        if (game.player.financeToday) {
            game.player.financeToday.income.hunting = (game.player.financeToday.income.hunting || 0) + totalValue;
        }

        let resultHtml = '<div>';
        resultHtml += '<h4 style="margin-top: 0;">🏹 Hunting Results</h4>';
        resultHtml += `<p style="font-size: 12px; color: var(--text-secondary);">You tracked game through the ${category}.</p>`;

        if (injured) {
            resultHtml += `<div style="padding: 8px 12px; margin-bottom: 8px; background: rgba(231,76,60,0.15); border-radius: 4px; color: #e74c3c;">⚠️ You were injured during the hunt! Lost ${healthLost} health.</div>`;
        }

        for (const item of found) {
            resultHtml += `
                <div style="padding: 8px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <div><span style="font-size: 16px;">${item.icon}</span> ${item.name} x${item.foundQty}</div>
                    <div style="color: var(--gold); font-weight: bold;">${item.foundQty * item.sellPrice}g</div>
                </div>
            `;
        }

        if (found.length > 0) {
            resultHtml += `<div style="margin-top: 12px; padding: 10px; background: rgba(245,197,66,0.1); border-radius: 4px; text-align: center; font-weight: bold; color: var(--gold);">Total: ${totalValue} gold</div>`;
        } else {
            resultHtml += `<div style="padding: 10px; color: #aaa; text-align: center;">No game caught today.</div>`;
        }

        resultHtml += `<button onclick="game.ui.hideCustomPanel(); game.endDay();" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
        resultHtml += '</div>';

        game.ui.showCustomPanel('Hunting', resultHtml);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show the bounty board at a settlement
     */
    showBountyBoardMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        // Initialize player bounties if needed
        if (!game.player.activeBounties) game.player.activeBounties = [];

        // Generate 2-4 bounties for this settlement
        const bountyTemplates = ActionMenu._getBountyData();
        const numBounties = Math.floor(Math.random() * 3) + 2;
        const shuffled = [...bountyTemplates].sort(() => Math.random() - 0.5).slice(0, numBounties);

        // Find nearby settlements for delivery bounties
        const nearbySettlements = [];
        if (game.world.getAllSettlements) {
            const allS = game.world.getAllSettlements();
            for (const s of allS) {
                if (s.q === tile.q && s.r === tile.r) continue;
                const dist = Hex.wrappingDistance ? Hex.wrappingDistance(tile.q, tile.r, s.q, s.r, game.world.width) :
                    Hex.distance(tile.q, tile.r, s.q, s.r);
                if (dist <= 20) nearbySettlements.push({ ...s, dist });
            }
        }

        const bounties = shuffled.map(template => {
            const pay = Math.floor(Math.random() * (template.pay.max - template.pay.min + 1)) + template.pay.min;
            const bounty = { ...template, actualPay: pay, fromSettlement: settlement.name, fromQ: tile.q, fromR: tile.r };

            // Fill in destination for delivery bounties
            if (template.type === 'delivery' && nearbySettlements.length > 0) {
                const dest = nearbySettlements[Math.floor(Math.random() * nearbySettlements.length)];
                bounty.description = template.description.replace('{destination}', dest.name);
                bounty.destQ = dest.q;
                bounty.destR = dest.r;
                bounty.destName = dest.name;
            } else if (template.type === 'delivery') {
                bounty.description = template.description.replace('{destination}', 'a nearby settlement');
                bounty.destQ = tile.q;
                bounty.destR = tile.r;
                bounty.destName = settlement.name;
            }

            // Fill in explore bounties
            if (template.type === 'explore') {
                bounty.description = template.description.replace('{count}', template.exploreCount || 15);
                bounty.tilesNeeded = template.exploreCount || 15;
                bounty.tilesExploredAtStart = 0; // Will be set on accept
            }

            // Fill in gather bounties
            if (template.type === 'gather') {
                const resources = ['wood', 'herbs', 'stone', 'grain'];
                const res = resources[Math.floor(Math.random() * resources.length)];
                const qty = Math.floor(Math.random() * 5) + 3;
                bounty.description = template.description.replace('{qty}', qty).replace('{resource}', res);
                bounty.resourceNeeded = res;
                bounty.qtyNeeded = qty;
            }

            // Fill in instant bounties
            if (template.type === 'instant') {
                bounty.description = template.description
                    .replace('{pest}', ['rats', 'wolves', 'boars', 'snakes'][Math.floor(Math.random() * 4)])
                    .replace('{location}', ['granary', 'cellar', 'farmsteads', 'market stalls'][Math.floor(Math.random() * 4)]);
            }

            return bounty;
        });

        // Show active bounties first
        let html = '<div style="max-height: 500px; overflow-y: auto;">';
        html += '<h4 style="margin-top: 0;">📋 Notice Board</h4>';

        // Active bounties
        if (game.player.activeBounties.length > 0) {
            html += '<div style="margin-bottom: 12px; padding: 8px; background: rgba(46,204,113,0.08); border: 1px solid rgba(46,204,113,0.3); border-radius: 6px;">';
            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #2ecc71; margin-bottom: 6px;">Active Bounties</div>';
            for (let i = 0; i < game.player.activeBounties.length; i++) {
                const b = game.player.activeBounties[i];
                const daysLeft = b.daysLimit - (b.daysElapsed || 0);
                const isHere = (b.type === 'delivery' && game.player.q === b.destQ && game.player.r === b.destR) ||
                               (b.type === 'instant' && game.player.q === b.fromQ && game.player.r === b.fromR);
                html += `
                    <div style="padding: 8px; margin-bottom: 4px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                        <div><span style="font-size: 14px;">${b.icon}</span> <strong>${b.name}</strong> — <span style="color: var(--gold);">${b.actualPay}g</span></div>
                        <div style="font-size: 11px; color: #aaa;">${b.description}</div>
                        <div style="font-size: 11px; color: ${daysLeft <= 2 ? '#e74c3c' : '#aaa'};">⏳ ${daysLeft} days remaining</div>
                        ${isHere ? `<button onclick="window._completeBounty(${i})" style="margin-top: 4px; padding: 4px 12px; background: #2ecc71; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">✓ Complete</button>` : ''}
                    </div>
                `;
            }
            html += '</div>';
        }

        // Available bounties
        html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin-bottom: 8px;">Available Bounties</div>';

        for (let i = 0; i < bounties.length; i++) {
            const b = bounties[i];
            const maxBounties = 3;
            const canAccept = game.player.activeBounties.length < maxBounties;

            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid ${b.difficulty === 'medium' ? '#f39c12' : '#3498db'}; ${!canAccept ? 'opacity: 0.5;' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div><span style="font-size: 16px;">${b.icon}</span> <strong>${b.name}</strong> <span style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${b.difficulty === 'medium' ? 'rgba(243,156,18,0.2)' : 'rgba(52,152,219,0.2)'}; color: ${b.difficulty === 'medium' ? '#f39c12' : '#3498db'};">${b.difficulty}</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">${b.description}</div>
                            <div style="font-size: 11px; color: #aaa;">⏳ ${b.daysLimit} day limit</div>
                        </div>
                        <button onclick="window._acceptBounty(${i})" ${!canAccept ? 'disabled' : ''}
                                style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; min-width: 80px;">
                            ${b.actualPay}g
                        </button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Notice Board', html);

        window._acceptBounty = (idx) => {
            const bounty = bounties[idx];
            if (!bounty) return;
            if (game.player.activeBounties.length >= 3) {
                game.ui.showNotification('Too Many', 'You can only have 3 active bounties. Complete some first.', 'error');
                return;
            }

            bounty.daysElapsed = 0;

            // For instant bounties, resolve immediately with skill check
            if (bounty.type === 'instant') {
                const stat = bounty.stat || 'combat';
                const statVal = ActionMenu._getPlayerStat(game.player, stat);
                const roll = Math.random() * 10;
                const success = roll < statVal + 3;

                if (success) {
                    game.player.gold += bounty.actualPay;
                    game.player.renown += 2;
                    if (game.player.financeToday) {
                        game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + bounty.actualPay;
                    }
                    game.ui.showNotification('Bounty Complete!', `${bounty.name} — earned ${bounty.actualPay} gold!`, 'success');
                } else {
                    const dmg = Math.floor(Math.random() * 10) + 5;
                    game.player.health = Math.max(1, game.player.health - dmg);
                    game.ui.showNotification('Failed!', `${bounty.name} — you struggled and lost ${dmg} health.`, 'error');
                }
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
                game.endDay();
                return;
            }

            // For other bounties, add to active list
            game.player.activeBounties.push(bounty);
            game.ui.showNotification('Bounty Accepted!', `${bounty.name} — ${bounty.daysLimit} days to complete.`, 'success');
            game.ui.hideCustomPanel();
            ActionMenu.showBountyBoardMenu(game, tile); // Refresh
        };

        window._completeBounty = (idx) => {
            const bounty = game.player.activeBounties[idx];
            if (!bounty) return;

            game.player.gold += bounty.actualPay;
            game.player.renown += 3;
            if (!game.player.bountiesCompleted) game.player.bountiesCompleted = 0;
            game.player.bountiesCompleted++;

            if (game.player.financeToday) {
                game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + bounty.actualPay;
            }

            game.player.activeBounties.splice(idx, 1);
            game.ui.showNotification('Bounty Complete!', `${bounty.name} — earned ${bounty.actualPay} gold!`, 'success');
            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
        };
    },

    /**
     * Show gambling menu
     */
    showGamblingMenu(game, tile) {
        const games = ActionMenu._getGamblingData();

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🎲 Games of Chance</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Your gold: <span style="color: var(--gold); font-weight: bold;">${game.player.gold}</span></p>`;

        for (const g of games) {
            const canPlay = game.player.gold >= g.minBet;
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid #9b59b6; ${!canPlay ? 'opacity: 0.5;' : ''}">
                    <div><span style="font-size: 18px;">${g.icon}</span> <strong>${g.name}</strong></div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">${g.description}</div>
                    <div style="font-size: 11px; color: #aaa; margin-bottom: 8px;">Bet: ${g.minBet}–${Math.min(g.maxBet, game.player.gold)} gold | Payout: ${g.payoutMultiplier}x</div>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <input type="range" id="bet_${g.id}" min="${g.minBet}" max="${Math.min(g.maxBet, game.player.gold)}" value="${g.minBet}"
                               oninput="document.getElementById('betLabel_${g.id}').textContent = this.value"
                               style="flex: 1; accent-color: var(--gold);" ${!canPlay ? 'disabled' : ''}>
                        <span id="betLabel_${g.id}" style="color: var(--gold); font-weight: bold; min-width: 40px; text-align: right;">${g.minBet}</span>g
                        <button onclick="window._playGamble('${g.id}')" ${!canPlay ? 'disabled' : ''}
                                style="padding: 6px 16px; background: #9b59b6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                            Bet!
                        </button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Gambling', html);

        window._playGamble = (gameId) => {
            const gameInfo = games.find(g => g.id === gameId);
            if (!gameInfo) return;

            const betInput = document.getElementById(`bet_${gameId}`);
            const bet = parseInt(betInput?.value || gameInfo.minBet);

            if (bet > game.player.gold) {
                game.ui.showNotification('Not Enough', 'You don\'t have enough gold!', 'error');
                return;
            }

            // Luck bonus
            const luckBonus = (game.player.luck || 5) * 0.01;
            const winChance = gameInfo.houseEdge + luckBonus;

            const roll = Math.random();
            const won = roll < winChance;

            if (won) {
                const winnings = Math.floor(bet * gameInfo.payoutMultiplier);
                game.player.gold += winnings - bet; // Net gain
                if (game.player.financeToday) {
                    game.player.financeToday.income.gambling = (game.player.financeToday.income.gambling || 0) + (winnings - bet);
                }
                game.ui.showNotification('🎉 You Win!', `Won ${winnings} gold on ${gameInfo.name}!`, 'success');
            } else {
                game.player.gold -= bet;
                if (game.player.financeToday) {
                    game.player.financeToday.expenses = game.player.financeToday.expenses || {};
                    game.player.financeToday.expenses.gambling = (game.player.financeToday.expenses.gambling || 0) + bet;
                }
                game.ui.showNotification('💸 You Lose!', `Lost ${bet} gold on ${gameInfo.name}.`, 'error');
            }

            game.ui.updateStats(game.player, game.world);

            // Refresh the menu with updated gold
            game.ui.hideCustomPanel();
            ActionMenu.showGamblingMenu(game, tile);
        };
    },

    /**
     * Show busking / street performance menu
     */
    showBuskingMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        const performances = ActionMenu._getBuskingData();
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' ? 'town' : 'village');
        const crowdMultiplier = { village: 0.5, town: 1.0, capital: 1.8 }[tier] || 1.0;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🎭 Street Performance</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Perform for coins in ${settlement.name}. Bigger crowds at larger settlements.</p>`;
        html += `<p style="font-size: 11px; color: #aaa; margin-bottom: 12px;">Crowd size: <span style="color: var(--gold);">${tier === 'capital' ? 'Large' : tier === 'town' ? 'Moderate' : 'Small'}</span> (${crowdMultiplier}x)</p>`;

        for (const perf of performances) {
            const statVal = ActionMenu._getPlayerStat(game.player, perf.stat);
            const basePay = Math.floor(Math.random() * (perf.basePay.max - perf.basePay.min + 1)) + perf.basePay.min;
            const totalPay = Math.floor(basePay * crowdMultiplier * (1 + statVal * 0.1));
            const statLabel = perf.stat.charAt(0).toUpperCase() + perf.stat.slice(1);

            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid #e67e22;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div><span style="font-size: 18px;">${perf.icon}</span> <strong>${perf.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">${perf.description}</div>
                            <div style="font-size: 11px; color: #aaa;">Based on: ${statLabel} (${statVal})</div>
                        </div>
                        <button onclick="window._doBusk('${perf.id}', ${totalPay}, ${perf.bonusKarma || false})"
                                style="padding: 8px 16px; background: #e67e22; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; min-width: 80px;">
                            ~${totalPay}g
                        </button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Street Performance', html);

        window._doBusk = (perfId, estimatedPay, bonusKarma) => {
            // Add some variance (±30%)
            const variance = 0.7 + Math.random() * 0.6;
            const actualPay = Math.max(1, Math.floor(estimatedPay * variance));

            game.player.gold += actualPay;
            game.player.renown += 1;

            if (bonusKarma) {
                game.player.karma = (game.player.karma || 0) + 1;
            }

            if (!game.player.performancesGiven) game.player.performancesGiven = 0;
            game.player.performancesGiven++;

            // Charisma skill up chance
            if (game.player.skills && Math.random() < 0.2) {
                game.player.skills.diplomacy = Math.min(10, (game.player.skills.diplomacy || 1) + 0.1);
            }

            // Finance tracking
            if (game.player.financeToday) {
                game.player.financeToday.income.busking = (game.player.financeToday.income.busking || 0) + actualPay;
            }

            const perf = performances.find(p => p.id === perfId);
            const name = perf ? perf.name : 'Performance';

            // Random crowd reaction
            const reactions = [
                `The crowd loved your ${name.toLowerCase()}! `,
                `A few coins tossed your way. Not bad! `,
                `An old woman was moved to tears. `,
                `A merchant pressed extra coins into your hand. `,
                `Children gathered, laughing and clapping. `,
            ];
            const reaction = reactions[Math.floor(Math.random() * reactions.length)];

            game.ui.showNotification('Performance Complete!', `${reaction}Earned ${actualPay} gold.`, 'success');
            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
            game.endDay();
        };
    },

    // ── Data helpers for early-game income ──

    _getJobData() {
        // Try to load from DataLoader if available
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.oddJobs) {
            return DataLoader.earlyJobs.oddJobs.settlement_jobs;
        }
        // Inline fallback
        return {
            village: [
                { id: 'farm_hand', name: 'Farm Hand', icon: '🌾', description: 'Help local farmers with planting and harvesting.', pay: { min: 10, max: 25 }, stat: 'strength', difficulty: 3 },
                { id: 'woodcutter', name: 'Woodcutter', icon: '🪓', description: 'Chop firewood for the village hearths.', pay: { min: 12, max: 22 }, stat: 'strength', difficulty: 3 },
                { id: 'shepherd', name: 'Shepherd', icon: '🐑', description: 'Watch over the village flock for the day.', pay: { min: 8, max: 15 }, stat: 'intelligence', difficulty: 2 },
                { id: 'herb_picker', name: 'Herb Picker', icon: '🌿', description: 'Gather medicinal herbs for the local healer.', pay: { min: 10, max: 20 }, stat: 'intelligence', difficulty: 3 },
            ],
            town: [
                { id: 'dock_worker', name: 'Dock Worker', icon: '📦', description: 'Load and unload merchant wagons at the market.', pay: { min: 18, max: 35 }, stat: 'strength', difficulty: 4 },
                { id: 'courier', name: 'Courier', icon: '📨', description: 'Deliver messages and parcels around town.', pay: { min: 15, max: 30 }, stat: 'stamina', difficulty: 3 },
                { id: 'tavern_bouncer', name: 'Tavern Bouncer', icon: '💪', description: 'Keep the peace at a rowdy tavern tonight.', pay: { min: 20, max: 45 }, stat: 'strength', difficulty: 5 },
                { id: 'rat_catcher', name: 'Rat Catcher', icon: '🐀', description: 'Clear vermin from cellars and granaries.', pay: { min: 15, max: 30 }, stat: 'stealth', difficulty: 3 },
                { id: 'scribe_assistant', name: "Scribe's Assistant", icon: '📝', description: 'Help copy documents and ledgers.', pay: { min: 22, max: 40 }, stat: 'intelligence', difficulty: 5 },
                { id: 'night_watch', name: 'Night Watch', icon: '🔦', description: 'Patrol the town walls through the night.', pay: { min: 18, max: 35 }, stat: 'combat', difficulty: 4 },
            ],
            capital: [
                { id: 'warehouse_guard', name: 'Warehouse Guard', icon: '🛡️', description: "Guard a merchant's warehouse for the day.", pay: { min: 30, max: 55 }, stat: 'combat', difficulty: 4 },
                { id: 'cargo_hauler', name: 'Cargo Hauler', icon: '🏋️', description: 'Move heavy goods between market districts.', pay: { min: 25, max: 50 }, stat: 'strength', difficulty: 5 },
                { id: 'arena_fighter', name: 'Arena Fighter', icon: '🗡️', description: 'Fight in exhibition matches for the crowd.', pay: { min: 40, max: 80 }, stat: 'combat', difficulty: 7 },
                { id: 'herald', name: 'Herald', icon: '📯', description: 'Read royal proclamations in the city square.', pay: { min: 25, max: 50 }, stat: 'charisma', difficulty: 5 },
                { id: 'tutor', name: 'Tutor', icon: '📖', description: "Teach a noble's children reading and arithmetic.", pay: { min: 30, max: 55 }, stat: 'intelligence', difficulty: 6 },
                { id: 'pit_fighter', name: 'Pit Fighter', icon: '⚔️', description: 'Bare-knuckle brawling in the underground pits.', pay: { min: 35, max: 75 }, stat: 'combat', difficulty: 7 },
            ],
        };
    },

    _getForageData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.foraging) {
            return DataLoader.earlyJobs.foraging;
        }
        return {
            terrain_mapping: {
                forest: 'forest', dense_forest: 'forest', woodland: 'forest',
                boreal_forest: 'forest', seasonal_forest: 'forest',
                temperate_rainforest: 'forest', tropical_rainforest: 'forest',
                plains: 'plains', grassland: 'plains', steppe: 'plains', savanna: 'plains',
                hills: 'hills', highlands: 'hills', mountain: 'hills',
                coast: 'coast', beach: 'coast',
                desert: 'desert', arid: 'desert', semi_arid: 'desert',
                swamp: 'swamp', marsh: 'swamp', wetland: 'swamp', mangrove: 'swamp', tropical_wetland: 'swamp',
            },
            loot_table: {
                forest: [
                    { item: 'herbs', name: 'Wild Herbs', icon: '🌿', chance: 0.40, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'berries', name: 'Wild Berries', icon: '🫐', chance: 0.35, qty: { min: 2, max: 5 }, sellPrice: 3 },
                    { item: 'mushrooms', name: 'Mushrooms', icon: '🍄', chance: 0.25, qty: { min: 1, max: 4 }, sellPrice: 4 },
                    { item: 'honey', name: 'Wild Honey', icon: '🍯', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 12 },
                    { item: 'truffles', name: 'Truffles', icon: '🟤', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 25 },
                ],
                plains: [
                    { item: 'herbs', name: 'Prairie Herbs', icon: '🌿', chance: 0.35, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'berries', name: 'Wild Berries', icon: '🫐', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 3 },
                    { item: 'flax', name: 'Wild Flax', icon: '🌾', chance: 0.20, qty: { min: 1, max: 3 }, sellPrice: 6 },
                    { item: 'feathers', name: 'Feathers', icon: '🪶', chance: 0.15, qty: { min: 2, max: 5 }, sellPrice: 4 },
                ],
                hills: [
                    { item: 'herbs', name: 'Mountain Herbs', icon: '🌿', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 7 },
                    { item: 'stone', name: 'Loose Stone', icon: '🪨', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 3 },
                    { item: 'ore_scraps', name: 'Ore Scraps', icon: '⛰️', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 10 },
                    { item: 'fossils', name: 'Fossils', icon: '🦴', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 20 },
                ],
                coast: [
                    { item: 'shells', name: 'Shells', icon: '🐚', chance: 0.40, qty: { min: 2, max: 6 }, sellPrice: 2 },
                    { item: 'driftwood', name: 'Driftwood', icon: '🪵', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 4 },
                    { item: 'seaweed', name: 'Edible Seaweed', icon: '🌊', chance: 0.25, qty: { min: 2, max: 4 }, sellPrice: 3 },
                    { item: 'pearls', name: 'Pearls', icon: '🔮', chance: 0.03, qty: { min: 1, max: 1 }, sellPrice: 35 },
                    { item: 'ambergris', name: 'Ambergris', icon: '🟡', chance: 0.02, qty: { min: 1, max: 1 }, sellPrice: 50 },
                ],
                desert: [
                    { item: 'cactus_fruit', name: 'Cactus Fruit', icon: '🌵', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 6 },
                    { item: 'scorpion_venom', name: 'Scorpion Venom', icon: '🦂', chance: 0.10, qty: { min: 1, max: 1 }, sellPrice: 15 },
                    { item: 'desert_rose', name: 'Desert Rose', icon: '🌹', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 20 },
                ],
                swamp: [
                    { item: 'leeches', name: 'Medicinal Leeches', icon: '🪱', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 8 },
                    { item: 'mushrooms', name: 'Swamp Mushrooms', icon: '🍄', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'peat', name: 'Peat', icon: '🟫', chance: 0.20, qty: { min: 2, max: 4 }, sellPrice: 4 },
                    { item: 'rare_frog', name: 'Rare Frog', icon: '🐸', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 30 },
                ],
            },
        };
    },

    _getHuntData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.hunting) {
            return DataLoader.earlyJobs.hunting;
        }
        return {
            loot_table: {
                forest: [
                    { item: 'game_meat', name: 'Venison', icon: '🥩', chance: 0.35, qty: { min: 1, max: 3 }, sellPrice: 8 },
                    { item: 'pelts', name: 'Fur Pelts', icon: '🦊', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 12 },
                    { item: 'antlers', name: 'Antlers', icon: '🦌', chance: 0.15, qty: { min: 1, max: 1 }, sellPrice: 15 },
                    { item: 'bear_pelt', name: 'Bear Pelt', icon: '🐻', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 40 },
                ],
                plains: [
                    { item: 'game_meat', name: 'Game Meat', icon: '🥩', chance: 0.40, qty: { min: 1, max: 4 }, sellPrice: 6 },
                    { item: 'hides', name: 'Hides', icon: '🟤', chance: 0.35, qty: { min: 1, max: 2 }, sellPrice: 8 },
                    { item: 'feathers', name: 'Feathers', icon: '🪶', chance: 0.25, qty: { min: 2, max: 5 }, sellPrice: 4 },
                    { item: 'ivory', name: 'Ivory', icon: '🦣', chance: 0.03, qty: { min: 1, max: 1 }, sellPrice: 45 },
                ],
                hills: [
                    { item: 'game_meat', name: 'Mountain Goat', icon: '🥩', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 7 },
                    { item: 'pelts', name: 'Wolf Pelts', icon: '🐺', chance: 0.20, qty: { min: 1, max: 2 }, sellPrice: 14 },
                    { item: 'eagle_feathers', name: 'Eagle Feathers', icon: '🦅', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 18 },
                ],
                coast: [
                    { item: 'fish', name: 'Fresh Fish', icon: '🐟', chance: 0.50, qty: { min: 2, max: 5 }, sellPrice: 4 },
                    { item: 'crabs', name: 'Crabs', icon: '🦀', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 6 },
                    { item: 'lobster', name: 'Lobster', icon: '🦞', chance: 0.10, qty: { min: 1, max: 1 }, sellPrice: 18 },
                ],
            },
        };
    },

    _getBountyData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.bountyBoard) {
            return DataLoader.earlyJobs.bountyBoard.templates;
        }
        return [
            { id: 'deliver_message', name: 'Deliver a Message', icon: '📨', description: 'Carry a sealed letter to {destination}.', type: 'delivery', pay: { min: 30, max: 80 }, daysLimit: 10, difficulty: 'easy' },
            { id: 'deliver_package', name: 'Deliver a Package', icon: '📦', description: 'Transport a fragile package safely to {destination}.', type: 'delivery', pay: { min: 50, max: 120 }, daysLimit: 12, difficulty: 'easy' },
            { id: 'scout_area', name: 'Scout the Wilds', icon: '🔭', description: 'Explore and map {count} tiles.', type: 'explore', pay: { min: 40, max: 90 }, exploreCount: 15, daysLimit: 8, difficulty: 'easy' },
            { id: 'clear_pests', name: 'Clear Pests', icon: '🐀', description: 'Drive out {pest} plaguing the {location}.', type: 'instant', pay: { min: 25, max: 60 }, stat: 'combat', difficulty: 'easy' },
            { id: 'wanted_thief', name: 'Catch a Thief', icon: '🏴‍☠️', description: 'A petty thief is hiding in the area.', type: 'instant', pay: { min: 50, max: 120 }, stat: 'stealth', difficulty: 'medium' },
            { id: 'escort_merchant', name: 'Escort Merchant', icon: '🛡️', description: 'Protect a merchant traveling to {destination}.', type: 'delivery', pay: { min: 80, max: 180 }, daysLimit: 14, difficulty: 'medium' },
        ];
    },

    _getGamblingData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.gambling) {
            return DataLoader.earlyJobs.gambling.games;
        }
        return [
            { id: 'dice_roll', name: 'Crown & Anchor', icon: '🎲', description: 'Roll dice against the house. Match crowns to win.', minBet: 5, maxBet: 200, houseEdge: 0.45, payoutMultiplier: 2.0 },
            { id: 'coin_flip', name: "Dragon's Flip", icon: '🪙', description: 'Call the coin — dragon or shield. Double or nothing.', minBet: 10, maxBet: 500, houseEdge: 0.48, payoutMultiplier: 2.0 },
            { id: 'high_low', name: 'High-Low', icon: '📊', description: 'Guess if the next card is higher or lower.', minBet: 5, maxBet: 100, houseEdge: 0.42, payoutMultiplier: 1.8, streakBonus: 0.5 },
        ];
    },

    _getBuskingData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.busking) {
            return DataLoader.earlyJobs.busking.performances;
        }
        return [
            { id: 'storytelling', name: 'Tell Tales', icon: '📖', description: 'Share stories of your travels and adventures.', stat: 'charisma', basePay: { min: 8, max: 25 } },
            { id: 'singing', name: 'Sing Ballads', icon: '🎵', description: 'Sing old songs and ballads in the market square.', stat: 'charisma', basePay: { min: 10, max: 30 } },
            { id: 'juggling', name: 'Juggle & Tricks', icon: '🤹', description: 'Perform acrobatics and sleight of hand.', stat: 'dexterity', basePay: { min: 8, max: 22 } },
            { id: 'fortune_telling', name: 'Read Fortunes', icon: '🔮', description: 'Tell fortunes and read palms. Mostly made up.', stat: 'intelligence', basePay: { min: 12, max: 35 } },
            { id: 'preaching', name: 'Street Preaching', icon: '📿', description: 'Preach fire and brimstone for donations.', stat: 'faith', basePay: { min: 6, max: 20 }, bonusKarma: true },
        ];
    },

    /**
     * Get a player stat value with fallbacks for different stat names
     */
    _getPlayerStat(player, stat) {
        // Direct attribute
        if (player[stat] !== undefined) return player[stat];
        // Skill
        if (player.skills && player.skills[stat] !== undefined) return player.skills[stat];
        // Mappings for convenience
        const aliases = {
            stamina: 'maxStamina',
            dexterity: 'luck',
            combat: 'strength',
        };
        if (aliases[stat] && player[aliases[stat]] !== undefined) return player[aliases[stat]];
        if (aliases[stat] && player.skills && player.skills[aliases[stat]] !== undefined) return player.skills[aliases[stat]];
        return 5; // Default
    },

    // ============================================
    // NEW ACTIONS — Donate, Allegiance, Feast, Tournament
    //               Pickpocket, Smuggle, Train, Meditate
    //               Fish, Prospect, Tame Horse, Campfire
    // ============================================

    /**
     * Show donation menu — give gold for karma + reputation
     */
    showDonateMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const maxDonate = Math.min(player.gold, 500);
        const kingdomId = settlement ? settlement.kingdom : null;
        const kingdomName = kingdomId ? (game.world.getKingdom(kingdomId)?.name || 'this realm') : 'the people';

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🪙 Make a Donation</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Donate gold to the people of <strong>${settlement ? settlement.name : 'this land'}</strong>. This earns you karma and reputation with ${kingdomName}.</p>`;
        html += `<p style="font-size: 12px; color: var(--gold);">Your gold: ${player.gold}</p>`;
        html += `<div style="margin: 12px 0;">`;
        html += `<label style="font-size: 12px;">Amount to donate:</label><br>`;
        html += `<input type="range" id="donateAmount" min="10" max="${maxDonate}" value="${Math.min(50, maxDonate)}" oninput="document.getElementById('donateLabel').textContent = this.value" style="width: 100%;">`;
        html += `<span id="donateLabel" style="color: var(--gold); font-weight: bold;">${Math.min(50, maxDonate)}</span> gold`;
        html += `</div>`;
        html += `<button onclick="window._doDonate()" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Donate</button>`;
        html += '</div>';

        game.ui.showCustomPanel('Donation', html);

        window._doDonate = () => {
            const amount = parseInt(document.getElementById('donateAmount')?.value || 10);
            if (amount > player.gold) {
                game.ui.showNotification('Not Enough', 'You can\'t afford that donation!', 'error');
                return;
            }

            player.gold -= amount;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.donation = (player.financeToday.expenses.donation || 0) + amount;
            }

            // Karma scales with amount
            const karmaGain = Math.floor(amount / 10) + 1;
            player.karma = (player.karma || 0) + karmaGain;

            // Reputation gain
            if (kingdomId && player.reputation) {
                player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + Math.floor(amount / 15) + 1;
            }

            // Renown for large donations
            let renownGain = 0;
            if (amount >= 100) {
                renownGain = Math.floor(amount / 50);
                player.renown = (player.renown || 0) + renownGain;
            }

            // Charisma might improve
            let charismaUp = false;
            if (amount >= 50 && Math.random() < 0.15) {
                player.charisma = (player.charisma || 5) + 1;
                charismaUp = true;
            }

            let msg = `You donated ${amount} gold. +${karmaGain} karma.`;
            if (kingdomId) msg += ` Reputation with ${kingdomName} improved.`;
            if (renownGain > 0) msg += ` +${renownGain} renown!`;
            if (charismaUp) msg += ' Your generosity has improved your charisma!';

            game.ui.showNotification('🪙 Donation', msg, 'success');
            game.ui.hideCustomPanel();
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Pledge allegiance to the kingdom controlling this settlement
     */
    doPledgeAllegiance(game, tile) {
        const settlement = tile.settlement;
        if (!settlement || !settlement.kingdom) {
            game.ui.showNotification('No Kingdom', 'This settlement has no kingdom to pledge to.', 'error');
            return;
        }

        const result = game.player.pledgeAllegiance(settlement.kingdom, game.world);
        if (result.success) {
            const kingdom = result.kingdom;
            // Reputation bonus on pledge
            if (game.player.reputation) {
                game.player.reputation[settlement.kingdom] = (game.player.reputation[settlement.kingdom] || 0) + 5;
            }
            game.ui.showNotification('⚔️ Allegiance Pledged',
                `You have sworn allegiance to ${kingdom.name}. You are now a citizen of the realm. +5 reputation.`, 'success');
            game.ui.updateStats(game.player, game.world);
        } else {
            game.ui.showNotification('Cannot Pledge', result.reason, 'error');
        }
    },

    /**
     * Renounce allegiance to current kingdom
     */
    doRenounceAllegiance(game, tile) {
        const player = game.player;
        if (!player.allegiance) {
            game.ui.showNotification('No Allegiance', 'You aren\'t pledged to any kingdom.', 'error');
            return;
        }

        const oldKingdomId = player.allegiance;
        const result = player.breakAllegiance(game.world);

        if (result.success) {
            // Reputation penalty
            if (player.reputation && oldKingdomId) {
                player.reputation[oldKingdomId] = (player.reputation[oldKingdomId] || 0) - 15;
            }
            // Karma hit
            player.karma = (player.karma || 0) - 3;

            const name = result.oldKingdom ? result.oldKingdom.name : 'your kingdom';
            game.ui.showNotification('💔 Allegiance Broken',
                `You have renounced your allegiance to ${name}. -15 reputation, -3 karma. You are once again a free wanderer.`, 'warning');
            game.ui.updateStats(player, game.world);
        } else {
            game.ui.showNotification('Error', result.reason, 'error');
        }
    },

    /**
     * Host a feast at a settlement — costs gold, gains renown + reputation + diplomacy
     */
    showHostFeastMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const tier = settlement.type === 'capital' ? 'grand' : (settlement.type === 'town' ? 'fine' : 'modest');
        const costs = { modest: 200, fine: 400, grand: 800 };
        const cost = costs[tier];

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🍖 Host a Feast</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Host a ${tier} feast in <strong>${settlement.name}</strong>. The locals will remember your generosity.</p>`;
        html += `<div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px;">`;
        html += `<div>💰 Cost: <span style="color: var(--gold);">${cost} gold</span></div>`;
        html += `<div>📈 Expected: +renown, +reputation, +diplomacy skill</div>`;
        html += `<div>⏰ Takes the rest of the day</div>`;
        html += `</div>`;

        if (player.gold >= cost) {
            html += `<button onclick="window._doFeast(${cost}, '${tier}')" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Host the Feast (${cost}g)</button>`;
        } else {
            html += `<p style="color: #ff6666; font-size: 12px;">You need ${cost} gold to host this feast.</p>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Host Feast', html);

        window._doFeast = (feastCost, feastTier) => {
            if (player.gold < feastCost) {
                game.ui.showNotification('Not Enough Gold', 'You can\'t afford this feast!', 'error');
                return;
            }

            player.gold -= feastCost;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.feast = (player.financeToday.expenses.feast || 0) + feastCost;
            }

            // Renown
            const renownGain = { modest: 3, fine: 6, grand: 12 }[feastTier] || 3;
            player.renown = (player.renown || 0) + renownGain;

            // Karma
            const karmaGain = { modest: 2, fine: 4, grand: 7 }[feastTier] || 2;
            player.karma = (player.karma || 0) + karmaGain;

            // Reputation
            const kingdomId = settlement.kingdom;
            if (kingdomId && player.reputation) {
                const repGain = { modest: 3, fine: 6, grand: 10 }[feastTier] || 3;
                player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + repGain;
            }

            // Diplomacy skill up chance
            let diplomacyUp = false;
            const skillChance = { modest: 0.15, fine: 0.25, grand: 0.4 }[feastTier] || 0.15;
            if (Math.random() < skillChance && player.skills) {
                player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                diplomacyUp = true;
            }

            // Charisma up chance
            let charismaUp = false;
            if (Math.random() < 0.2) {
                player.charisma = (player.charisma || 5) + 1;
                charismaUp = true;
            }

            let msg = `You hosted a ${feastTier} feast! +${renownGain} renown, +${karmaGain} karma.`;
            if (diplomacyUp) msg += ' Diplomacy skill improved!';
            if (charismaUp) msg += ' Your charisma grew!';

            game.ui.hideCustomPanel();
            game.ui.showNotification('🍖 Feast Complete', msg, 'success');
            game.ui.updateStats(player, game.world);
            game.endDay();
        };
    },

    /**
     * Hold a tournament — combat competition for gold and renown
     */
    showTournamentMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const entryFee = settlement.type === 'capital' ? 300 : 200;
        const prizePool = entryFee * 4;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">⚔️ Hold a Tournament</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Organize a fighting tournament in ${settlement.name}! Champions from across the land will compete.</p>`;
        html += `<div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px;">`;
        html += `<div>💰 Entry/Organization cost: <span style="color: var(--gold);">${entryFee} gold</span></div>`;
        html += `<div>🏆 Prize pool: <span style="color: var(--gold);">${prizePool} gold</span></div>`;
        html += `<div>⚔️ Your combat skill: ${player.skills?.combat || 1} | Strength: ${player.strength || 5}</div>`;
        html += `<div>⏰ Takes the rest of the day</div>`;
        html += `</div>`;
        html += `<p style="font-size: 11px; color: #aaa;">You may compete yourself, or simply host and watch.</p>`;

        if (player.gold >= entryFee) {
            html += `<button onclick="window._doTournament(true)" style="width: 100%; padding: 10px; background: #c97d32; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 6px;">Compete (${entryFee}g)</button>`;
            html += `<button onclick="window._doTournament(false)" style="width: 100%; padding: 8px; background: #555; border: none; border-radius: 4px; cursor: pointer; color: #ccc;">Just Host & Spectate (${Math.floor(entryFee * 0.6)}g)</button>`;
        } else {
            html += `<p style="color: #ff6666; font-size: 12px;">You need ${entryFee} gold to organize a tournament.</p>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Tournament', html);

        window._doTournament = (compete) => {
            const cost = compete ? entryFee : Math.floor(entryFee * 0.6);
            if (player.gold < cost) {
                game.ui.showNotification('Not Enough Gold', 'You can\'t afford to host this!', 'error');
                return;
            }

            player.gold -= cost;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.tournament = (player.financeToday.expenses.tournament || 0) + cost;
            }

            let resultHtml = '<div>';
            const renownGain = compete ? 5 : 3;
            player.renown = (player.renown || 0) + renownGain;

            if (compete) {
                // Combat rounds — player vs 3 opponents
                const combatSkill = (player.skills?.combat || 1);
                const strengthBonus = ((player.strength || 5) - 5) * 0.05;
                const playerPower = combatSkill * 2 + strengthBonus + (Math.random() * 5);

                const opponents = [
                    { name: 'Local Champion', power: 4 + Math.random() * 6 },
                    { name: 'Traveling Knight', power: 6 + Math.random() * 7 },
                    { name: 'Arena Veteran', power: 8 + Math.random() * 8 },
                ];

                let wins = 0;
                let healthLost = 0;
                resultHtml += '<h4 style="margin-top: 0;">⚔️ Tournament Results</h4>';

                for (const opp of opponents) {
                    const won = playerPower + Math.random() * 3 > opp.power;
                    if (won) {
                        wins++;
                        resultHtml += `<div style="color: #8f8;">✓ Defeated ${opp.name}!</div>`;
                    } else {
                        const dmg = Math.floor(Math.random() * 10) + 5;
                        healthLost += dmg;
                        resultHtml += `<div style="color: #f88;">✗ Lost to ${opp.name} (-${dmg} HP)</div>`;
                    }
                }

                player.health = Math.max(1, player.health - healthLost);

                if (wins === 3) {
                    // Grand champion!
                    const winnings = prizePool;
                    player.gold += winnings;
                    if (player.financeToday) {
                        player.financeToday.income.tournament = (player.financeToday.income.tournament || 0) + winnings;
                    }
                    player.renown += 5; // Bonus renown
                    resultHtml += `<div style="color: var(--gold); font-weight: bold; margin-top: 8px;">🏆 GRAND CHAMPION! Won ${winnings} gold! +${renownGain + 5} total renown!</div>`;
                } else if (wins >= 2) {
                    const winnings = Math.floor(prizePool * 0.4);
                    player.gold += winnings;
                    if (player.financeToday) {
                        player.financeToday.income.tournament = (player.financeToday.income.tournament || 0) + winnings;
                    }
                    resultHtml += `<div style="color: #ccc; margin-top: 8px;">🥈 Runner-up! Won ${winnings} gold. +${renownGain} renown.</div>`;
                } else {
                    resultHtml += `<div style="color: #888; margin-top: 8px;">Eliminated early. +${renownGain} renown for participating.</div>`;
                }

                // Combat skill up chance
                if (Math.random() < 0.2 + wins * 0.1 && player.skills) {
                    player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
                    resultHtml += `<div style="color: #88f; margin-top: 4px;">Combat skill improved!</div>`;
                }

                if (healthLost > 0) {
                    resultHtml += `<div style="color: #f88; margin-top: 4px;">Total injuries: -${healthLost} HP</div>`;
                }
            } else {
                // Just hosting
                resultHtml += '<h4 style="margin-top: 0;">🏟️ Tournament Hosted</h4>';
                resultHtml += `<div>The tournament was a great success! The crowd cheered and the fighters put on a great show.</div>`;
                resultHtml += `<div style="color: var(--gold); margin-top: 8px;">+${renownGain} renown for hosting.</div>`;

                // Hosting chance for diplomacy
                if (Math.random() < 0.25 && player.skills) {
                    player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                    resultHtml += `<div style="color: #88f; margin-top: 4px;">Diplomacy improved from managing the event!</div>`;
                }
            }

            resultHtml += `<button onclick="game.ui.hideCustomPanel(); game.endDay();" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            resultHtml += '</div>';

            game.ui.showCustomPanel('Tournament Results', resultHtml);
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Pickpocket — risky stealth-based gold gain
     */
    doPickpocket(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const stealthSkill = player.skills?.stealth || 1;
        const luckBonus = ((player.luck || 5) - 5) * 0.03;
        const successChance = 0.3 + stealthSkill * 0.07 + luckBonus;

        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' ? 'town' : 'village');
        const maxGold = { village: 20, town: 40, capital: 80 }[tier];

        const roll = Math.random();

        if (roll < successChance) {
            // Success
            const stolen = Math.floor(Math.random() * maxGold) + 5;
            player.gold += stolen;
            if (player.financeToday) {
                player.financeToday.income.theft = (player.financeToday.income.theft || 0) + stolen;
            }
            player.karma = (player.karma || 0) - 1;

            // Stealth skill up chance
            let skillUp = false;
            if (Math.random() < 0.2 && player.skills) {
                player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                skillUp = true;
            }

            let msg = `You deftly lifted ${stolen} gold from an unsuspecting mark. -1 karma.`;
            if (skillUp) msg += ' Stealth skill improved!';
            game.ui.showNotification('🤫 Pickpocket Success', msg, 'success');
        } else if (roll < successChance + 0.3) {
            // Noticed but escaped
            game.ui.showNotification('😬 Close Call', 'You were spotted reaching for a purse and had to flee! No gold gained.', 'warning');
        } else {
            // Caught!
            const fine = Math.floor(Math.random() * 30) + 10;
            const actualFine = Math.min(fine, player.gold);
            player.gold -= actualFine;
            player.karma = (player.karma || 0) - 3;

            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.fines = (player.financeToday.expenses.fines || 0) + actualFine;
            }

            // Reputation loss
            const kingdomId = settlement.kingdom;
            if (kingdomId && player.reputation) {
                player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 5;
            }

            game.ui.showNotification('🚔 Caught!',
                `You were caught pickpocketing! Fined ${actualFine} gold. -3 karma, -5 reputation.`, 'error');
        }

        game.ui.updateStats(player, game.world);
    },

    /**
     * Smuggle goods — sell inventory items at premium but risk getting caught
     */
    showSmuggleMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        // Find sellable goods in inventory
        const goods = [];
        const excludeItems = ['bread']; // Basic items not smuggle-worthy
        for (const [item, qty] of Object.entries(player.inventory || {})) {
            if (qty > 0 && !excludeItems.includes(item)) {
                goods.push({ item, qty });
            }
        }

        if (goods.length === 0) {
            game.ui.showNotification('No Goods', 'You have nothing worth smuggling!', 'default');
            return;
        }

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🏴‍☠️ Black Market Smuggling</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Sell goods at a premium through shady channels in ${settlement.name}. Higher profit, but getting caught means trouble.</p>`;
        html += `<p style="font-size: 11px; color: #aaa;">Stealth: ${player.skills?.stealth || 1} | Higher stealth = safer deals</p>`;

        const basePrices = {
            herbs: 8, pelts: 12, meat: 6, berries: 4, mushrooms: 5,
            hide: 15, antler: 20, feather: 10, fish: 5, ore: 25,
            gems: 80, stone: 8, horse: 120, wood: 3
        };

        for (const g of goods) {
            const basePrice = basePrices[g.item] || 10;
            const smugglePrice = Math.floor(basePrice * 2.5); // 2.5x premium
            html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">`;
            html += `<span>${g.item} (x${g.qty})</span>`;
            html += `<span style="color: var(--gold);">${smugglePrice}g each</span>`;
            html += `<button onclick="window._doSmuggle('${g.item}', ${smugglePrice})" style="padding: 4px 10px; background: #8b0000; border: none; border-radius: 3px; cursor: pointer; color: #fff; font-size: 11px;">Sell 1</button>`;
            html += `</div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('Smuggling', html);

        window._doSmuggle = (itemName, price) => {
            if (!player.inventory[itemName] || player.inventory[itemName] <= 0) {
                game.ui.showNotification('No Stock', 'You don\'t have any more of that!', 'error');
                return;
            }

            const stealthSkill = player.skills?.stealth || 1;
            const successChance = 0.5 + stealthSkill * 0.06;

            if (Math.random() < successChance) {
                // Successful smuggle
                player.inventory[itemName]--;
                if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                player.gold += price;
                if (player.financeToday) {
                    player.financeToday.income.smuggling = (player.financeToday.income.smuggling || 0) + price;
                }
                player.karma = (player.karma || 0) - 1;

                // Stealth skill up
                if (Math.random() < 0.15 && player.skills) {
                    player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                }

                game.ui.showNotification('🏴‍☠️ Deal Done', `Sold ${itemName} for ${price} gold on the black market.`, 'success');
            } else {
                // Caught
                player.inventory[itemName]--;
                if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                const fine = Math.floor(price * 0.5);
                const actualFine = Math.min(fine, player.gold);
                player.gold -= actualFine;
                player.karma = (player.karma || 0) - 3;

                if (player.financeToday) {
                    player.financeToday.expenses = player.financeToday.expenses || {};
                    player.financeToday.expenses.fines = (player.financeToday.expenses.fines || 0) + actualFine;
                }

                const kingdomId = settlement.kingdom;
                if (kingdomId && player.reputation) {
                    player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 8;
                }

                game.ui.showNotification('🚔 Busted!',
                    `Caught smuggling ${itemName}! Goods confiscated, fined ${actualFine}g. -3 karma, -8 reputation.`, 'error');
            }

            game.ui.updateStats(player, game.world);
            game.ui.hideCustomPanel();
            // Refresh menu if player has remaining goods
            const remaining = Object.entries(player.inventory || {}).filter(([k, v]) => v > 0 && k !== 'bread');
            if (remaining.length > 0) {
                ActionMenu.showSmuggleMenu(game, tile);
            }
        };
    },

    /**
     * Train combat at a settlement — costs gold, improves combat skill
     */
    doTrainCombat(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const cost = settlement.type === 'capital' ? 75 : 50;
        if (player.gold < cost) {
            game.ui.showNotification('Not Enough Gold', `Training costs ${cost} gold.`, 'error');
            return;
        }

        player.gold -= cost;
        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.training = (player.financeToday.expenses.training || 0) + cost;
        }

        let resultMsg = `You spent the day training at ${settlement.name}. `;

        // Combat skill — good chance with training
        const combatChance = settlement.type === 'capital' ? 0.45 : 0.3;
        if (Math.random() < combatChance && player.skills) {
            player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
            resultMsg += 'Combat skill improved! ';
        } else {
            resultMsg += 'Good practice but no breakthrough. ';
        }

        // Strength improvement chance
        if (Math.random() < 0.15) {
            player.strength = (player.strength || 5) + 1;
            resultMsg += 'Strength increased! ';
        }

        // Army XP if player has troops
        if (player.army && player.army.length > 0) {
            const xpGain = settlement.type === 'capital' ? 15 : 10;
            for (const unit of player.army) {
                unit.experience = (unit.experience || 0) + xpGain;
            }
            resultMsg += `Army gained ${xpGain} XP from drills.`;
        }

        game.ui.showNotification('⚔️ Combat Training', resultMsg, 'success');
        game.ui.updateStats(player, game.world);
        game.endDay();
    },

    /**
     * Meditate — restore health, gain karma, faith bonus at holy sites
     */
    doMeditate(game, tile) {
        const player = game.player;
        const isHolySite = !!tile.holySite;

        // Health restoration
        const baseHeal = 10;
        const faithBonus = ((player.faith || 5) - 3) * 2;
        const heal = Math.max(5, baseHeal + faithBonus + (isHolySite ? 15 : 0));
        player.health = Math.min(player.maxHealth || 100, player.health + heal);

        // Karma gain
        const karmaGain = isHolySite ? 5 : 2;
        player.karma = (player.karma || 0) + karmaGain;

        let resultMsg = `You meditated peacefully. +${heal} HP, +${karmaGain} karma.`;

        // Faith attribute growth chance
        if (Math.random() < (isHolySite ? 0.35 : 0.1)) {
            player.faith = (player.faith || 5) + 1;
            resultMsg += ' Your faith deepened.';
        }

        // Intelligence growth (small chance)
        if (Math.random() < 0.1) {
            player.intelligence = (player.intelligence || 5) + 1;
            resultMsg += ' Your mind feels sharper.';
        }

        if (isHolySite) {
            resultMsg += ' The holy site amplified your meditation!';
        }

        game.ui.showNotification('🧘 Meditation', resultMsg, 'success');
        game.ui.updateStats(player, game.world);
        game.endDay();
    },

    /**
     * Fish at a water-adjacent tile — yields food items
     */
    doFish(game, tile) {
        const player = game.player;
        const luckStat = player.luck || 5;
        const intStat = player.intelligence || 5;
        const skillBonus = 1 + luckStat * 0.05 + intStat * 0.03;

        const catches = [];
        // 2-4 attempts per session
        const attempts = 2 + Math.floor(Math.random() * 3);

        for (let i = 0; i < attempts; i++) {
            const roll = Math.random() * skillBonus;
            if (roll > 0.4) {
                // Caught something!
                const rareRoll = Math.random();
                if (rareRoll < 0.05 * (luckStat / 5)) {
                    catches.push({ name: 'golden_fish', label: 'Golden Fish', icon: '✨🐟', value: 50, qty: 1 });
                } else if (rareRoll < 0.2) {
                    catches.push({ name: 'large_fish', label: 'Large Fish', icon: '🐟', value: 8, qty: 1 });
                } else {
                    catches.push({ name: 'fish', label: 'Fish', icon: '🐟', value: 5, qty: Math.floor(Math.random() * 2) + 1 });
                }
            }
        }

        // Consolidate catches
        const totals = {};
        for (const c of catches) {
            if (!totals[c.name]) totals[c.name] = { ...c, qty: 0 };
            totals[c.name].qty += c.qty;
        }

        let resultHtml = '<div>';
        resultHtml += '<h4 style="margin-top: 0;">🎣 Fishing Results</h4>';

        if (Object.keys(totals).length === 0) {
            resultHtml += '<p style="color: #aaa;">Nothing was biting today. Better luck next time!</p>';
        } else {
            let totalValue = 0;
            for (const [key, item] of Object.entries(totals)) {
                player.inventory = player.inventory || {};
                player.inventory[key] = (player.inventory[key] || 0) + item.qty;
                totalValue += item.value * item.qty;
                resultHtml += `<div style="padding: 4px 0;">${item.icon} ${item.label} x${item.qty} <span style="color: var(--gold);">(~${item.value}g each)</span></div>`;
            }
            resultHtml += `<div style="margin-top: 8px; color: var(--gold);">Total catch value: ~${totalValue} gold</div>`;
        }

        // Small luck increase chance
        if (Math.random() < 0.08) {
            player.luck = (player.luck || 5) + 1;
            resultHtml += '<div style="color: #88f; margin-top: 4px;">Your patience improved your luck!</div>';
        }

        resultHtml += `<button onclick="game.ui.hideCustomPanel(); game.endDay();" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
        resultHtml += '</div>';

        game.ui.showCustomPanel('Fishing', resultHtml);
        game.ui.updateStats(player, game.world);
    },

    /**
     * Prospect for minerals on hills/highlands/mountain tiles
     */
    doProspect(game, tile) {
        const player = game.player;
        const terrainId = tile.terrain?.id || '';
        const strengthStat = player.strength || 5;
        const luckStat = player.luck || 5;

        const difficultyMod = {
            hills: 1.0, highlands: 1.2, mountain: 1.5, volcanic_mountain: 1.8
        }[terrainId] || 1.0;

        const skillBonus = 1 + strengthStat * 0.04 + luckStat * 0.06;
        const finds = [];

        // Prospecting tries
        const tries = 2 + Math.floor(Math.random() * 2);

        for (let i = 0; i < tries; i++) {
            const roll = Math.random() * skillBonus;
            if (roll > 0.5 / difficultyMod) {
                const typeRoll = Math.random();
                if (typeRoll < 0.05 * (luckStat / 5)) {
                    finds.push({ name: 'gems', label: 'Gemstones', icon: '💎', value: 80, qty: 1 });
                } else if (typeRoll < 0.3) {
                    finds.push({ name: 'ore', label: 'Iron Ore', icon: '⛏️', value: 25, qty: Math.floor(Math.random() * 2) + 1 });
                } else {
                    finds.push({ name: 'stone', label: 'Stone', icon: '🪨', value: 8, qty: Math.floor(Math.random() * 3) + 1 });
                }
            }
        }

        // Consolidate
        const totals = {};
        for (const f of finds) {
            if (!totals[f.name]) totals[f.name] = { ...f, qty: 0 };
            totals[f.name].qty += f.qty;
        }

        let healthCost = Math.floor(Math.random() * 8) + 3;
        player.health = Math.max(1, player.health - healthCost);

        let resultHtml = '<div>';
        resultHtml += '<h4 style="margin-top: 0;">⛏️ Prospecting Results</h4>';

        if (Object.keys(totals).length === 0) {
            resultHtml += '<p style="color: #aaa;">You dug around but found nothing valuable.</p>';
        } else {
            let totalValue = 0;
            for (const [key, item] of Object.entries(totals)) {
                player.inventory = player.inventory || {};
                player.inventory[key] = (player.inventory[key] || 0) + item.qty;
                totalValue += item.value * item.qty;
                resultHtml += `<div style="padding: 4px 0;">${item.icon} ${item.label} x${item.qty} <span style="color: var(--gold);">(~${item.value}g each)</span></div>`;
            }
            resultHtml += `<div style="margin-top: 8px; color: var(--gold);">Total find value: ~${totalValue} gold</div>`;
        }

        resultHtml += `<div style="color: #f88; margin-top: 4px;">Hard work cost ${healthCost} HP.</div>`;

        // Strength increase chance
        if (Math.random() < 0.12) {
            player.strength = (player.strength || 5) + 1;
            resultHtml += '<div style="color: #88f; margin-top: 4px;">The hard labor strengthened you!</div>';
        }

        resultHtml += `<button onclick="game.ui.hideCustomPanel(); game.endDay();" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
        resultHtml += '</div>';

        game.ui.showCustomPanel('Prospecting', resultHtml);
        game.ui.updateStats(player, game.world);
    },

    /**
     * Tame a wild horse — requires horse resource on tile
     */
    doTameHorse(game, tile) {
        const player = game.player;
        const strengthStat = player.strength || 5;
        const luckStat = player.luck || 5;

        const baseChance = 0.25;
        const bonus = strengthStat * 0.04 + luckStat * 0.03;
        const successChance = Math.min(0.8, baseChance + bonus);

        let resultHtml = '<div>';
        resultHtml += '<h4 style="margin-top: 0;">🐴 Taming a Wild Horse</h4>';

        const roll = Math.random();

        if (roll < successChance) {
            // Success!
            player.inventory = player.inventory || {};
            player.inventory.horse = (player.inventory.horse || 0) + 1;

            // Stamina bonus
            const staminaBonus = 2;
            player.maxStamina = (player.maxStamina || 10) + staminaBonus;

            resultHtml += '<div style="color: #8f8; font-size: 14px;">🐴 You successfully tamed the wild horse!</div>';
            resultHtml += `<div style="margin-top: 8px;">+1 Horse added to inventory</div>`;
            resultHtml += `<div style="color: var(--gold);">+${staminaBonus} max stamina from having a mount!</div>`;

            // Strength growth
            if (Math.random() < 0.2) {
                player.strength = (player.strength || 5) + 1;
                resultHtml += '<div style="color: #88f; margin-top: 4px;">The struggle strengthened you!</div>';
            }
        } else if (roll < successChance + 0.3) {
            // Failed but unharmed
            resultHtml += '<div style="color: #ccc;">The horse bolted before you could get a grip. Maybe next time.</div>';
        } else {
            // Failed and injured
            const dmg = Math.floor(Math.random() * 12) + 5;
            player.health = Math.max(1, player.health - dmg);
            resultHtml += `<div style="color: #f88;">The horse kicked you in the struggle! -${dmg} HP</div>`;
        }

        resultHtml += `<button onclick="game.ui.hideCustomPanel(); game.endDay();" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
        resultHtml += '</div>';

        game.ui.showCustomPanel('Horse Taming', resultHtml);
        game.ui.updateStats(player, game.world);
    },

    /**
     * Craft a campfire — uses 2 wood, gives health bonus on rest, can cook fish
     */
    doCraftCampfire(game, tile) {
        const player = game.player;

        if (!player.inventory?.wood || player.inventory.wood < 2) {
            game.ui.showNotification('No Wood', 'You need at least 2 wood to build a campfire.', 'error');
            return;
        }

        player.inventory.wood -= 2;
        if (player.inventory.wood <= 0) delete player.inventory.wood;

        // Immediate health bonus
        const healAmount = 15;
        player.health = Math.min(player.maxHealth || 100, player.health + healAmount);

        let resultMsg = `You built a warm campfire. +${healAmount} HP from the warmth.`;

        // Cook fish if available
        if (player.inventory.fish && player.inventory.fish > 0) {
            const fishCount = Math.min(player.inventory.fish, 3); // Cook up to 3
            player.inventory.fish -= fishCount;
            if (player.inventory.fish <= 0) delete player.inventory.fish;
            player.inventory.cooked_fish = (player.inventory.cooked_fish || 0) + fishCount;

            const extraHeal = fishCount * 5;
            player.health = Math.min(player.maxHealth || 100, player.health + extraHeal);
            resultMsg += ` Cooked ${fishCount} fish (+${extraHeal} HP).`;
        }

        // Cook raw meat if available
        if (player.inventory.meat && player.inventory.meat > 0) {
            const meatCount = Math.min(player.inventory.meat, 3);
            player.inventory.meat -= meatCount;
            if (player.inventory.meat <= 0) delete player.inventory.meat;
            player.inventory.cooked_meat = (player.inventory.cooked_meat || 0) + meatCount;

            const extraHeal = meatCount * 7;
            player.health = Math.min(player.maxHealth || 100, player.health + extraHeal);
            resultMsg += ` Cooked ${meatCount} meat (+${extraHeal} HP).`;
        }

        // Small intelligence gain from the craft
        if (Math.random() < 0.08) {
            player.intelligence = (player.intelligence || 5) + 1;
            resultMsg += ' Your practical skills sharpened your mind.';
        }

        game.ui.showNotification('🔥 Campfire', resultMsg, 'success');
        game.ui.updateStats(player, game.world);
    },

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
        html += `<p style="font-size: 12px; color: var(--text-secondary);">People of <strong>${tile.settlement.name}</strong>. Get to know them, befriend them, or perhaps find love.</p>`;

        if (npcs.length === 0) {
            html += '<p style="color: #aaa;">Nobody interesting around right now.</p>';
        }

        for (const npc of npcs) {
            const rel = Relationships.getRelationship(player, npc.id);
            const relLabel = Relationships.getRelationLabel(rel.score);
            const personality = personalities[npc.personality] || { label: 'Unknown', icon: '❓' };
            const stage = rel.romantic ? Relationships.getCourtingStage(rel.affection, npc.isMarried && player.spouse === npc.id) : null;

            const genderIcon = npc.gender === 'male' ? '♂️' : '♀️';
            const marriedTag = (player.spouse === npc.id) ? ' <span style="color: #ff69b4;">💍 Your Spouse</span>' : '';

            html += `<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid ${rel.score >= 30 ? '#4a4' : rel.score <= -30 ? '#a44' : '#666'};">`;
            html += `<div style="display: flex; justify-content: space-between; align-items: center;">`;
            html += `<div>`;
            html += `<strong>${npc.firstName} ${npc.dynasty}</strong> ${genderIcon}${marriedTag}`;
            html += `<div style="font-size: 11px; color: #aaa;">Age ${npc.age} · ${npc.occupation} · ${personality.icon} ${personality.label}</div>`;
            html += `<div style="font-size: 11px; color: #888;">${npc.appearance.hair} hair, ${npc.appearance.eyes} eyes, ${npc.appearance.build}</div>`;
            html += `</div>`;
            html += `<div style="text-align: right; font-size: 11px;">`;
            html += `<div>${relLabel.icon} ${relLabel.label} (${rel.score})</div>`;
            if (stage) {
                html += `<div style="color: #ff69b4;">${stage.icon} ${stage.label} (${rel.affection})</div>`;
            }
            html += `</div>`;
            html += `</div>`;

            // Action buttons
            html += `<div style="display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap;">`;
            html += `<button onclick="window._socialAction('${npc.id}', 'befriend')" style="padding: 4px 8px; background: #446; border: none; border-radius: 3px; cursor: pointer; color: #ccc; font-size: 11px;">😊 Chat</button>`;
            html += `<button onclick="window._socialAction('${npc.id}', 'share_meal')" style="padding: 4px 8px; background: #446; border: none; border-radius: 3px; cursor: pointer; color: #ccc; font-size: 11px;">🍞 Share Meal (10g)</button>`;
            html += `<button onclick="window._socialAction('${npc.id}', 'tell_stories')" style="padding: 4px 8px; background: #446; border: none; border-radius: 3px; cursor: pointer; color: #ccc; font-size: 11px;">📖 Stories</button>`;

            // Romantic options (only for opposite gender or freely, depends on game design — keeping it open)
            if (!player.spouse || player.spouse === npc.id) {
                html += `<button onclick="window._courtAction('${npc.id}', 'compliment')" style="padding: 4px 8px; background: #644; border: none; border-radius: 3px; cursor: pointer; color: #fcc; font-size: 11px;">✨ Flirt</button>`;
                if (rel.affection >= 15) {
                    html += `<button onclick="window._courtAction('${npc.id}', 'gift')" style="padding: 4px 8px; background: #644; border: none; border-radius: 3px; cursor: pointer; color: #fcc; font-size: 11px;">🎁 Gift (25g)</button>`;
                }
                if (rel.affection >= 30) {
                    html += `<button onclick="window._courtAction('${npc.id}', 'serenade')" style="padding: 4px 8px; background: #644; border: none; border-radius: 3px; cursor: pointer; color: #fcc; font-size: 11px;">🎵 Serenade</button>`;
                }
                if (rel.affection >= 50) {
                    html += `<button onclick="window._courtAction('${npc.id}', 'romantic_dinner')" style="padding: 4px 8px; background: #844; border: none; border-radius: 3px; cursor: pointer; color: #fcc; font-size: 11px;">🍷 Dinner (50g)</button>`;
                }
                if (rel.affection >= 70 && !player.spouse) {
                    html += `<button onclick="window._courtAction('${npc.id}', 'propose')" style="padding: 4px 8px; background: #a44; border: none; border-radius: 3px; cursor: pointer; color: #fff; font-size: 11px; font-weight: bold;">💍 Propose (100g)</button>`;
                }
            }

            // Negative options
            html += `<button onclick="window._socialAction('${npc.id}', 'insult')" style="padding: 4px 8px; background: #433; border: none; border-radius: 3px; cursor: pointer; color: #c88; font-size: 11px;">😤 Insult</button>`;
            html += `<button onclick="window._socialAction('${npc.id}', 'challenge')" style="padding: 4px 8px; background: #433; border: none; border-radius: 3px; cursor: pointer; color: #c88; font-size: 11px;">🗡️ Duel</button>`;

            html += `</div>`;
            html += `</div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('Meet People', html);

        // Social action handler
        window._socialAction = (npcId, actionId) => {
            const result = Relationships.performSocialAction(player, npcId, actionId);
            const npc = Relationships.getNPC(npcId);
            if (npc) npc.lastInteraction = game.world?.day || 0;

            if (result.success) {
                const sign = result.gain >= 0 ? '+' : '';
                let msg = `${result.npc.firstName}: ${sign}${result.gain} relationship.`;
                if (result.skillUp) msg += ' Diplomacy improved!';
                const type = result.gain >= 0 ? 'success' : 'warning';
                game.ui.showNotification(result.gain >= 0 ? '😊 Social' : '😤 Conflict', msg, type);
            } else if (result.failed) {
                game.ui.showNotification('😬 Awkward', result.reason, 'warning');
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }

            game.ui.updateStats(player, game.world);
            game.ui.hideCustomPanel();
            ActionMenu.showMeetPeopleMenu(game, tile);
        };

        // Court action handler
        window._courtAction = (npcId, actionId) => {
            const result = Relationships.performCourtAction(player, npcId, actionId);
            const npc = Relationships.getNPC(npcId);
            if (npc) npc.lastInteraction = game.world?.day || 0;

            if (result.success) {
                if (result.married) {
                    // Marriage!
                    const marryResult = Relationships.marry(player, npcId, game.world);
                    if (marryResult.success) {
                        game.ui.hideCustomPanel();
                        ActionMenu._showMarriageCelebration(game, marryResult.npc);
                        return;
                    }
                }
                let msg = `${result.npc.firstName}: +${result.gain} affection (${result.stage.icon} ${result.stage.label}).`;
                if (result.charismaUp) msg += ' Charisma improved!';
                game.ui.showNotification('💕 Romance', msg, 'success');
            } else if (result.failed) {
                game.ui.showNotification('💔 Rejected', result.reason, 'warning');
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }

            game.ui.updateStats(player, game.world);
            game.ui.hideCustomPanel();
            ActionMenu.showMeetPeopleMenu(game, tile);
        };
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
        html += `<button onclick="game.ui.hideCustomPanel();" style="width: 100%; padding: 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">Begin Your New Life Together</button>`;
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
        const personalities = Relationships._getPersonalities();

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">💕 Your Relationships</h4>';

        // Spouse section
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) {
                const rel = Relationships.getRelationship(player, player.spouse);
                html += '<div style="background: rgba(255,105,180,0.15); padding: 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(255,105,180,0.3);">';
                html += `<div style="font-weight: bold; color: #ff69b4;">💍 Spouse: ${spouse.firstName} ${spouse.dynasty}</div>`;
                html += `<div style="font-size: 11px; color: #aaa;">Age ${spouse.age} · ${spouse.occupation} · Affection: ${rel.affection}/100</div>`;
                html += '<div style="margin-top: 4px;">';
                html += ActionMenu._renderAffectionBar(rel.affection);
                html += '</div>';
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

        if (romanticInterests.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #ff69b4;">💕 Romantic Interests</h5>';
            for (const [npcId, rel] of romanticInterests) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive) continue;
                const stage = Relationships.getCourtingStage(rel.affection, false);
                html += `<div style="background: rgba(255,105,180,0.1); padding: 5px 8px; border-radius: 4px; margin-bottom: 3px; font-size: 12px;">`;
                html += `${stage.icon} <strong>${npc.firstName}</strong> · ${stage.label} · Affection: ${rel.affection}`;
                html += `</div>`;
            }
        }

        if (friends.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #4a4;">😊 Friends</h5>';
            for (const [npcId, rel] of friends) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive || npcId === player.spouse) continue;
                const label = Relationships.getRelationLabel(rel.score);
                html += `<div style="padding: 3px 8px; font-size: 12px;">${label.icon} <strong>${npc.firstName}</strong> (${rel.score})</div>`;
            }
        }

        if (rivals.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #a44;">⚡ Rivals</h5>';
            for (const [npcId, rel] of rivals) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive) continue;
                const label = Relationships.getRelationLabel(rel.score);
                html += `<div style="padding: 3px 8px; font-size: 12px;">${label.icon} <strong>${npc.firstName}</strong> (${rel.score})</div>`;
            }
        }

        if (friends.length === 0 && rivals.length === 0 && romanticInterests.length === 0 && !player.spouse) {
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
            confirmHtml += `<button onclick="game.ui.hideCustomPanel(); ActionMenu.showRelationshipsMenu(game, game.world.getTile(game.player.q, game.player.r));" style="width: 100%; padding: 8px; background: #555; border: none; border-radius: 4px; cursor: pointer; color: #ccc;">Cancel</button>`;
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
    },

    _renderAffectionBar(affection) {
        const pct = Math.max(0, Math.min(100, affection));
        const color = pct >= 75 ? '#ff69b4' : pct >= 50 ? '#f0a' : pct >= 25 ? '#c80' : '#888';
        return `<div style="background: rgba(0,0,0,0.5); border-radius: 3px; height: 8px; width: 100%;">
            <div style="background: ${color}; height: 100%; width: ${pct}%; border-radius: 3px; transition: width 0.3s;"></div>
        </div>`;
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
        html += '<div style="background: rgba(255,215,0,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid rgba(255,215,0,0.2);">';
        html += `<div style="font-weight: bold; color: var(--gold);">House ${player.dynasty?.name || player.name}</div>`;
        html += `<div style="font-size: 11px; color: #aaa;">Founded day ${player.dynasty?.founded || 1} · Prestige: ${player.dynasty?.prestige || 0}</div>`;
        html += `<div style="font-size: 11px; color: #aaa;">You: ${player.name}, age ${player.age} (max ~${player.maxLifespan})</div>`;
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) {
                html += `<div style="font-size: 11px; color: #ff69b4;">Spouse: ${spouse.firstName} ${spouse.dynasty}, age ${spouse.age}</div>`;
            }
        }
        html += '</div>';

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
                const skillLabels = { combat: '⚔️', commerce: '💰', leadership: '👑', diplomacy: '🤝', stealth: '🥷', cartography: '🗺️' };
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
     * Show death / succession screen when the player dies
     */
    showDeathScreen(game) {
        if (typeof Relationships === 'undefined') return;
        const player = game.player;
        const eligibleHeirs = Relationships.getEligibleHeirs(player);

        let html = '<div style="text-align: center;">';
        html += '<h3 style="color: #a33; margin-top: 0;">💀 Death Comes for All</h3>';
        html += `<p style="font-size: 14px;">${player.name} has died at the age of ${player.age}.</p>`;

        if (player.dynasty) {
            html += `<p style="font-size: 12px; color: var(--gold);">House ${player.dynasty.name} · Prestige: ${player.dynasty.prestige || 0}</p>`;
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
            // No heirs — game over
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0; padding-top: 10px;">';
            html += '<h4 style="color: #a33;">No Eligible Heirs</h4>';
            html += '<p style="font-size: 12px; color: #aaa;">Without an heir of age, your dynasty ends here.</p>';
            html += `<button onclick="location.reload();" style="width: 100%; padding: 12px; background: #a33; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: #fff; margin-top: 10px;">Start New Game</button>`;
            html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('Death', html);

        window._succeedAsHeir = (childId) => {
            const result = Relationships.succeedAsHeir(player, childId, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();

                let successHtml = '<div style="text-align: center;">';
                successHtml += '<h3 style="color: var(--gold); margin-top: 0;">👑 A New Chapter</h3>';
                successHtml += `<p style="font-size: 14px;">You are now <strong>${result.newName}</strong>, heir of ${result.oldName}.</p>`;
                successHtml += '<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin: 10px 0; font-size: 12px; text-align: left;">';
                successHtml += `<div>Age: ${result.heir.age}</div>`;
                successHtml += `<div>Inherited ${player.gold} gold (${Math.round(Relationships._getHeirSettings().inheritanceGoldPercent * 100)}%)</div>`;
                successHtml += `<div>Dynasty prestige: ${player.dynasty?.prestige || 0}</div>`;
                successHtml += '</div>';
                successHtml += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="width: 100%; padding: 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">Begin Your Story</button>`;
                successHtml += '</div>';

                game.ui.showCustomPanel('New Heir', successHtml);
                game.ui.updateStats(player, game.world);
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }
        };
    },

    // ══════════════════════════════════════════════════════════
    // HOUSING SYSTEM
    // ══════════════════════════════════════════════════════════

    showBuyHouseMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const available = Housing.getAvailableHouses(settlement.type);
        const npcHouses = Housing.getNpcHouses(tile);

        let html = '<div style="max-height:450px;overflow-y:auto;">';
        html += '<h4 style="margin-top:0;">🏠 Buy a House</h4>';
        html += `<p style="font-size:12px;color:var(--text-secondary);">Purchase a home in ${settlement.name}. Owning property grants renown and local influence.</p>`;

        // NPC-owned houses (flavor)
        if (npcHouses.length > 0) {
            html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;padding:4px 6px;background:rgba(255,255,255,0.03);border-radius:4px;">';
            html += `<em>Notable residents: `;
            html += npcHouses.map(h => {
                const ht = Housing.getHouseType(h.typeId);
                return `${h.owner} (${ht ? ht.name : 'house'})`;
            }).join(', ');
            html += '</em></div>';
        }

        // Available house types
        for (const ht of available) {
            const cost = Housing._getSettlementPrice(ht.baseCost, settlement);
            const canAfford = player.gold >= cost;
            const meetsRenown = (player.renown || 0) >= ht.requiredRenown;
            const canBuy = canAfford && meetsRenown;

            html += `<div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:8px;background:rgba(255,255,255,0.02);">`;
            html += `<div style="font-weight:bold;margin-bottom:4px;">${ht.icon} ${ht.name}</div>`;
            html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">${ht.description}</div>`;
            html += '<div style="font-size:11px;display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">';
            html += `<span>💰 ${cost}g</span>`;
            html += `<span>🏆 +${ht.renownBonus} renown</span>`;
            html += `<span>🤝 +${ht.reputationBonus} rep</span>`;
            if (ht.staminaBonus) html += `<span>⚡ +${ht.staminaBonus} stamina</span>`;
            html += `<span>❤️ +${ht.healthRegenBonus} health/day</span>`;
            html += `<span>🔧 ${ht.maxUpgradeSlots} upgrade slots</span>`;
            if (ht.requiredRenown > 0) html += `<span>📜 Requires ${ht.requiredRenown} renown</span>`;
            html += `<span>🪙 ${ht.maintenanceCost}g/day upkeep</span>`;
            html += '</div>';

            if (!meetsRenown) {
                html += `<div style="font-size:11px;color:#e74c3c;">Need ${ht.requiredRenown} renown (you have ${player.renown || 0})</div>`;
            } else if (!canAfford) {
                html += `<div style="font-size:11px;color:#e74c3c;">Not enough gold (need ${cost}g)</div>`;
            } else {
                html += `<button onclick="window._buyHouse('${ht.id}', ${cost})" style="width:100%;margin-top:4px;">Buy for ${cost}g</button>`;
            }
            html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('Real Estate', html);

        window._buyHouse = (typeId, cost) => {
            const result = Housing.buyHouse(player, tile.q, tile.r, typeId, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('🏠 New Home!', result.message, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            } else {
                game.ui.showNotification('Cannot Buy', result.message, 'error');
            }
        };
    },

    showManageHouseMenu(game, tile) {
        const player = game.player;
        const house = Housing.getHouseAt(player, tile.q, tile.r);
        if (!house) return;

        const ht = Housing.getHouseType(house.typeId);
        if (!ht) return;

        const value = Housing.getHouseValue(house);
        const salePrice = Math.floor(value * Housing._getSellPenalty());
        const influence = Housing.getInfluence(player);

        let html = '<div style="max-height:450px;overflow-y:auto;">';
        html += `<h4 style="margin-top:0;">${ht.icon} ${ht.name} — ${house.settlementName}</h4>`;

        // Status bar
        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px;margin-bottom:10px;padding:6px;background:rgba(255,255,255,0.03);border-radius:4px;">';
        html += `<span>🔧 Condition: ${house.condition}%</span>`;
        html += `<span>💰 Value: ~${value}g</span>`;
        html += `<span>🪙 Upkeep: ${ht.maintenanceCost}g/day</span>`;
        html += `<span>👑 Influence: ${influence}</span>`;
        html += `<span>📦 Upgrades: ${house.upgrades.length}/${ht.maxUpgradeSlots}</span>`;
        html += '</div>';

        // Installed upgrades
        if (house.upgrades.length > 0) {
            html += '<div style="margin-bottom:10px;">';
            html += '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;">Installed Upgrades</div>';
            for (const uid of house.upgrades) {
                const u = Housing.getUpgrade(uid);
                if (!u) continue;
                html += `<div style="font-size:11px;padding:2px 0;">${u.icon} ${u.name} — <span style="color:var(--text-secondary)">${u.description}</span></div>`;
            }
            html += '</div>';
        }

        // Available upgrades
        const availUpgrades = Housing.getAvailableUpgrades(house.typeId, house.upgrades);
        if (availUpgrades.length > 0 && house.upgrades.length < ht.maxUpgradeSlots) {
            html += '<div style="margin-bottom:10px;">';
            html += '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;">Available Upgrades</div>';
            for (const u of availUpgrades) {
                const canAfford = player.gold >= u.cost;
                html += `<div style="border:1px solid var(--border);border-radius:4px;padding:6px;margin-bottom:4px;background:rgba(255,255,255,0.02);">`;
                html += `<div style="font-size:12px;font-weight:bold;">${u.icon} ${u.name} — ${u.cost}g</div>`;
                html += `<div style="font-size:11px;color:var(--text-secondary);margin:2px 0 4px;">${u.description}</div>`;
                // Show effects
                const effects = u.effects || {};
                const effectParts = [];
                if (effects.healthRegenBonus) effectParts.push(`+${effects.healthRegenBonus} health/day`);
                if (effects.renownBonus) effectParts.push(`+${effects.renownBonus} renown`);
                if (effects.reputationBonus) effectParts.push(`+${effects.reputationBonus} reputation`);
                if (effects.strengthBonus) effectParts.push(`+${effects.strengthBonus} strength`);
                if (effects.charismaBonus) effectParts.push(`+${effects.charismaBonus} charisma`);
                if (effects.intelligenceBonus) effectParts.push(`+${effects.intelligenceBonus} intelligence`);
                if (effects.faithBonus) effectParts.push(`+${effects.faithBonus} faith`);
                if (effects.commerceSkillBonus) effectParts.push(`+${effects.commerceSkillBonus} commerce`);
                if (effects.combatSkillBonus) effectParts.push(`+${effects.combatSkillBonus} combat`);
                if (effects.leadershipSkillBonus) effectParts.push(`+${effects.leadershipSkillBonus} leadership`);
                if (effects.diplomacySkillBonus) effectParts.push(`+${effects.diplomacySkillBonus} diplomacy`);
                if (effects.movementBonus) effectParts.push(`+${effects.movementBonus} movement`);
                if (effects.visibilityBonus) effectParts.push(`+${effects.visibilityBonus} visibility`);
                if (effects.defenseBonus) effectParts.push(`+${effects.defenseBonus} defense`);
                if (effects.karmaPerDay) effectParts.push(`+${effects.karmaPerDay} karma/day`);
                if (effects.maintenanceReduction) effectParts.push(`-${Math.round(effects.maintenanceReduction * 100)}% upkeep`);
                if (effectParts.length > 0) {
                    html += `<div style="font-size:10px;color:#27ae60;margin-bottom:4px;">${effectParts.join(' · ')}</div>`;
                }
                if (canAfford) {
                    html += `<button onclick="window._installUpgrade('${u.id}')" style="width:100%;font-size:11px;">Install — ${u.cost}g</button>`;
                } else {
                    html += `<div style="font-size:11px;color:#e74c3c;">Need ${u.cost}g</div>`;
                }
                html += '</div>';
            }
            html += '</div>';
        }

        // Actions row
        html += '<div style="display:flex;gap:6px;margin-top:8px;">';
        if (house.condition < 100) {
            const ht2 = Housing.getHouseType(house.typeId);
            const damagePercent = (100 - house.condition) / 100;
            const repairCost = Math.max(5, Math.floor((ht2 ? ht2.baseCost : 200) * 0.1 * damagePercent));
            html += `<button onclick="window._repairHouse()" style="flex:1;">🔧 Repair (${repairCost}g)</button>`;
        }
        html += `<button onclick="window._sellHouseConfirm()" style="flex:1;background:#8b0000;">🏷️ Sell (~${salePrice}g)</button>`;
        html += '</div>';
        html += '</div>';

        game.ui.showCustomPanel(`${ht.icon} Your ${ht.name}`, html);

        window._installUpgrade = (upgradeId) => {
            const result = Housing.installUpgrade(player, tile.q, tile.r, upgradeId);
            if (result.success) {
                game.ui.showNotification('🔧 Upgraded!', result.message, 'success');
                game.ui.updateStats(player, game.world);
                ActionMenu.showManageHouseMenu(game, tile); // refresh
            } else {
                game.ui.showNotification('Cannot Upgrade', result.message, 'error');
            }
        };

        window._repairHouse = () => {
            const result = Housing.repairHouse(player, tile.q, tile.r);
            if (result.success) {
                game.ui.showNotification('🔧 Repaired!', result.message, 'success');
                game.ui.updateStats(player, game.world);
                ActionMenu.showManageHouseMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Repair', result.message, 'error');
            }
        };

        window._sellHouseConfirm = () => {
            let confirmHtml = '<div>';
            confirmHtml += `<p>Are you sure you want to sell your ${ht.name} in ${house.settlementName}?</p>`;
            confirmHtml += `<p style="font-size:12px;color:var(--text-secondary);">You'll receive approximately <strong>${salePrice}g</strong> (${Math.round(Housing._getSellPenalty() * 100)}% of value).</p>`;
            confirmHtml += '<div style="display:flex;gap:6px;margin-top:10px;">';
            confirmHtml += `<button onclick="window._doSellHouse()" style="flex:1;background:#8b0000;">Confirm Sale</button>`;
            confirmHtml += `<button onclick="ActionMenu.showManageHouseMenu(window._game, window._tile)" style="flex:1;">Cancel</button>`;
            confirmHtml += '</div></div>';
            game.ui.showCustomPanel('Sell Property', confirmHtml);
        };
        window._game = game;
        window._tile = tile;

        window._doSellHouse = () => {
            const result = Housing.sellHouse(player, tile.q, tile.r);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('🏷️ Sold!', result.message, 'success');
                game.ui.updateStats(player, game.world);
            } else {
                game.ui.showNotification('Error', result.message, 'error');
            }
        };
    },

    // ══════════════════════════════════════════════════════════
    // SHIP SYSTEM
    // ══════════════════════════════════════════════════════════

    showShipyardMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const usedShips = Ships.getUsedShipsForSale(tile);
        const buildable = Ships._getShipTypes();
        const playerShipsHere = Ships.getShipsAt(player, tile.q, tile.r);

        let html = '<div style="max-height:500px;overflow-y:auto;">';
        html += '<h4 style="margin-top:0;">⚓ Shipyard</h4>';
        html += `<p style="font-size:12px;color:var(--text-secondary);">Buy a used vessel, commission a new ship, or manage your fleet at ${settlement.name}.</p>`;

        // Tab-like sections
        html += '<div style="display:flex;gap:4px;margin-bottom:10px;">';
        html += '<button onclick="window._shipTab(\'used\')" style="flex:1;font-size:11px;">🏷️ Used Ships</button>';
        html += '<button onclick="window._shipTab(\'build\')" style="flex:1;font-size:11px;">🔨 Build New</button>';
        if (playerShipsHere.length > 0) {
            html += '<button onclick="window._shipTab(\'docked\')" style="flex:1;font-size:11px;">⚓ My Ships ('+playerShipsHere.length+')</button>';
        }
        html += '</div>';

        // Used ships
        html += '<div id="shipTabUsed">';
        if (usedShips.length === 0) {
            html += '<p style="font-size:12px;color:var(--text-secondary);text-align:center;">No used ships available here today.</p>';
        }
        for (let i = 0; i < usedShips.length; i++) {
            const s = usedShips[i];
            const st = Ships.getShipType(s.typeId);
            if (!st) continue;
            const canAfford = player.gold >= s.price;
            html += `<div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.02);">`;
            html += `<div style="font-weight:bold;">${st.icon} ${s.name} <span style="font-size:11px;color:var(--text-secondary);">(${st.name})</span></div>`;
            html += `<div style="font-size:11px;color:var(--text-secondary);margin:2px 0;">"${s.description}"</div>`;
            html += '<div style="font-size:11px;display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;">';
            html += `<span>🔧 ${s.condition}% condition</span>`;
            html += `<span>⚓ Speed ${st.speed}</span>`;
            html += `<span>📦 Cargo ${st.cargoCapacity}</span>`;
            html += `<span>⚔️ ${st.combatStrength} strength</span>`;
            html += `<span>👥 Crew ${st.crewRequired}</span>`;
            html += '</div>';
            html += `<div style="font-size:12px;font-weight:bold;margin:4px 0;">💰 ${s.price}g</div>`;
            if (canAfford) {
                html += `<button onclick="window._buyUsedShip(${i})" style="width:100%;font-size:11px;">Buy Ship</button>`;
            } else {
                html += `<div style="font-size:11px;color:#e74c3c;">Not enough gold</div>`;
            }
            html += '</div>';
        }
        html += '</div>';

        // Build new
        html += '<div id="shipTabBuild" style="display:none;">';
        for (const st of buildable) {
            const buildCost = Ships._getSettlementBuildCost(st.baseCost, settlement);
            const canAfford = player.gold >= buildCost;
            html += `<div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.02);">`;
            html += `<div style="font-weight:bold;">${st.icon} ${st.name}</div>`;
            html += `<div style="font-size:11px;color:var(--text-secondary);margin:2px 0;">${st.description}</div>`;
            html += '<div style="font-size:11px;display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;">';
            html += `<span>⚓ Speed ${st.speed}</span>`;
            html += `<span>📦 Cargo ${st.cargoCapacity}</span>`;
            html += `<span>⚔️ ${st.combatStrength} strength</span>`;
            html += `<span>👥 Crew ${st.crewRequired}</span>`;
            html += `<span>🪙 ${st.dailyUpkeep}g/day upkeep</span>`;
            html += `<span>🏗️ ${st.buildDays} days to build</span>`;
            if (st.customizations && st.customizations.length > 0) {
                html += `<span>🔧 ${st.customizations.length} customizations</span>`;
            }
            html += '</div>';
            html += `<div style="font-size:12px;font-weight:bold;margin:4px 0;">💰 ${buildCost}g</div>`;
            if (canAfford) {
                html += `<button onclick="window._showBuildOptions('${st.id}', ${buildCost})" style="width:100%;font-size:11px;">Commission Build</button>`;
            } else {
                html += `<div style="font-size:11px;color:#e74c3c;">Need ${buildCost}g</div>`;
            }
            html += '</div>';
        }
        html += '</div>';

        // Docked ships
        html += '<div id="shipTabDocked" style="display:none;">';
        if (playerShipsHere.length === 0) {
            html += '<p style="font-size:12px;color:var(--text-secondary);text-align:center;">No ships docked here.</p>';
        }
        for (const ship of playerShipsHere) {
            const st = Ships.getShipType(ship.typeId);
            if (!st) continue;
            html += `<div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.02);">`;
            html += `<div style="font-weight:bold;">${st.icon} ${ship.name}</div>`;
            html += '<div style="font-size:11px;display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;">';
            html += `<span>🔧 ${ship.condition}%</span>`;
            html += `<span>⚓ Speed ${st.speed}</span>`;
            if (ship.customizations && ship.customizations.length > 0) {
                html += `<span>🔧 ${ship.customizations.length} mods</span>`;
            }
            html += '</div>';
            html += '<div style="display:flex;gap:4px;margin-top:4px;">';
            html += `<button onclick="window._manageShip('${ship.id}')" style="flex:1;font-size:11px;">⚙️ Manage</button>`;
            html += `<button onclick="window._moveShipMenu('${ship.id}')" style="flex:1;font-size:11px;">🧭 Move</button>`;
            html += '</div>';
            html += '</div>';
        }
        html += '</div>';

        html += '</div>';
        game.ui.showCustomPanel('⚓ Shipyard', html);

        window._shipTab = (tab) => {
            document.getElementById('shipTabUsed').style.display = tab === 'used' ? 'block' : 'none';
            document.getElementById('shipTabBuild').style.display = tab === 'build' ? 'block' : 'none';
            const dockedEl = document.getElementById('shipTabDocked');
            if (dockedEl) dockedEl.style.display = tab === 'docked' ? 'block' : 'none';
        };

        window._buyUsedShip = (index) => {
            const result = Ships.buyUsedShip(player, tile.q, tile.r, index);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('⛵ Ship Purchased!', result.message, 'success');
                game.ui.updateStats(player, game.world);
            } else {
                game.ui.showNotification('Cannot Buy', result.message, 'error');
            }
        };

        window._showBuildOptions = (typeId, cost) => {
            ActionMenu._showShipBuildConfig(game, tile, typeId, cost);
        };

        window._manageShip = (shipId) => {
            ActionMenu._showShipManagePanel(game, tile, shipId);
        };

        window._moveShipMenu = (shipId) => {
            ActionMenu._showMoveShipMenu(game, tile, shipId);
        };
    },

    _showShipBuildConfig(game, tile, typeId, baseCost) {
        const player = game.player;
        const st = Ships.getShipType(typeId);
        if (!st) return;

        const availCustom = Ships.getAvailableCustomizations(typeId);
        let html = '<div style="max-height:450px;overflow-y:auto;">';
        html += `<h4 style="margin-top:0;">🔨 Commission: ${st.icon} ${st.name}</h4>`;
        html += `<p style="font-size:12px;color:var(--text-secondary);">Base cost: ${baseCost}g · Build time: ${st.buildDays} days</p>`;

        // Ship name input
        html += '<div style="margin-bottom:8px;">';
        html += '<label style="font-size:11px;display:block;margin-bottom:2px;">Ship Name:</label>';
        html += `<input id="shipNameInput" type="text" value="${Ships._generateShipName()}" style="width:100%;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;" />`;
        html += '</div>';

        // Customizations
        if (availCustom.length > 0) {
            html += '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;">Customizations (optional):</div>';
            for (const c of availCustom) {
                html += `<div style="border:1px solid var(--border);border-radius:4px;padding:6px;margin-bottom:4px;background:rgba(255,255,255,0.02);">`;
                html += `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">`;
                html += `<input type="checkbox" class="shipCustomCheck" value="${c.id}" data-cost="${c.cost}" />`;
                html += `<span style="font-size:12px;">${c.icon} ${c.name} (+${c.cost}g)</span>`;
                html += '</label>';
                html += `<div style="font-size:10px;color:var(--text-secondary);margin-left:22px;">${c.description}</div>`;
                // Effects
                const efParts = [];
                if (c.effects.speedBonus) efParts.push(`+${c.effects.speedBonus} speed`);
                if (c.effects.cargoBonus) efParts.push(`+${c.effects.cargoBonus} cargo`);
                if (c.effects.combatBonus) efParts.push(`+${c.effects.combatBonus} combat`);
                if (c.effects.armorBonus) efParts.push(`+${c.effects.armorBonus} armor`);
                if (c.effects.crewBonus) efParts.push(`+${c.effects.crewBonus} crew`);
                if (c.effects.stealthBonus) efParts.push(`stealth +${c.effects.stealthBonus}`);
                if (c.effects.explorationBonus) efParts.push(`exploration +${c.effects.explorationBonus}`);
                if (efParts.length) html += `<div style="font-size:10px;color:#27ae60;margin-left:22px;">${efParts.join(' · ')}</div>`;
                html += '</div>';
            }
        }

        html += `<div id="buildTotalCost" style="font-size:13px;font-weight:bold;margin:8px 0;">Total: ${baseCost}g</div>`;
        html += `<button onclick="window._commissionShip('${typeId}', ${baseCost})" style="width:100%;">🔨 Commission Ship</button>`;
        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="width:100%;margin-top:4px;background:var(--bg-secondary);">← Back</button>`;
        html += '</div>';
        game.ui.showCustomPanel('Commission Ship', html);
        window._game = game;
        window._tile = tile;

        // Update total on checkbox change
        setTimeout(() => {
            document.querySelectorAll('.shipCustomCheck').forEach(cb => {
                cb.addEventListener('change', () => {
                    let total = baseCost;
                    document.querySelectorAll('.shipCustomCheck:checked').forEach(checked => {
                        total += parseInt(checked.dataset.cost) || 0;
                    });
                    document.getElementById('buildTotalCost').textContent = `Total: ${total}g`;
                });
            });
        }, 50);

        window._commissionShip = (stId, bCost) => {
            const name = document.getElementById('shipNameInput').value.trim() || Ships._generateShipName();
            const customs = [];
            document.querySelectorAll('.shipCustomCheck:checked').forEach(cb => customs.push(cb.value));
            const result = Ships.commissionShip(player, tile.q, tile.r, stId, name, customs, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('🔨 Ship Commissioned!', result.message, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            } else {
                game.ui.showNotification('Cannot Build', result.message, 'error');
            }
        };
    },

    _showShipManagePanel(game, tile, shipId) {
        const player = game.player;
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return;
        const st = Ships.getShipType(ship.typeId);
        if (!st) return;

        const value = Ships.getShipValue(ship);
        const salePrice = Math.floor(value * 0.5);

        let html = '<div style="max-height:450px;overflow-y:auto;">';
        html += `<h4 style="margin-top:0;">${st.icon} ${ship.name}</h4>`;
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">${st.name}</div>`;

        // Stats
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;margin-bottom:8px;padding:6px;background:rgba(255,255,255,0.03);border-radius:4px;">';
        html += `<span>🔧 Condition: ${ship.condition}%</span>`;
        html += `<span>⚓ Speed: ${st.speed}</span>`;
        html += `<span>📦 Cargo: ${st.cargoCapacity}</span>`;
        html += `<span>⚔️ Strength: ${st.combatStrength}</span>`;
        html += `<span>👥 Crew: ${st.crewRequired}</span>`;
        html += `<span>🪙 Upkeep: ${st.dailyUpkeep}g/day</span>`;
        if (ship.status === 'building') html += `<span>🏗️ Under construction (${ship.buildDaysLeft} days left)</span>`;
        if (ship.status === 'moving') html += `<span>🧭 En route to ${ship.destinationName || 'destination'}</span>`;
        html += '</div>';

        // Customizations installed
        if (ship.customizations && ship.customizations.length > 0) {
            html += '<div style="margin-bottom:8px;">';
            html += '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;">Customizations</div>';
            for (const cid of ship.customizations) {
                const c = Ships.getCustomization(cid);
                if (!c) continue;
                html += `<div style="font-size:11px;padding:1px 0;">${c.icon} ${c.name}</div>`;
            }
            html += '</div>';
        }

        // Cargo manifest
        if (ship.cargo && Object.keys(ship.cargo).length > 0) {
            html += '<div style="margin-bottom:8px;">';
            html += '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;">Cargo</div>';
            for (const [item, qty] of Object.entries(ship.cargo)) {
                html += `<div style="font-size:11px;padding:1px 0;">${item}: ${qty}</div>`;
            }
            html += '</div>';
        }

        // Action buttons
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;">';
        if (ship.condition < 100 && ship.status === 'docked') {
            const repCost = Ships.getRepairCost(ship);
            html += `<button onclick="window._repairShip('${ship.id}')" style="flex:1;font-size:11px;">🔧 Repair (${repCost}g)</button>`;
        }
        if (ship.status === 'docked') {
            html += `<button onclick="window._renameShip('${ship.id}')" style="flex:1;font-size:11px;">✏️ Rename</button>`;
            html += `<button onclick="window._sellShipConfirm('${ship.id}', ${salePrice})" style="flex:1;font-size:11px;background:#8b0000;">🏷️ Sell (~${salePrice}g)</button>`;
        }
        html += '</div>';
        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="width:100%;margin-top:4px;background:var(--bg-secondary);font-size:11px;">← Back to Shipyard</button>`;
        html += '</div>';

        game.ui.showCustomPanel(`${st.icon} ${ship.name}`, html);
        window._game = game;
        window._tile = tile;

        window._repairShip = (sid) => {
            const result = Ships.repairShip(player, sid);
            if (result.success) {
                game.ui.showNotification('🔧 Repaired!', result.message, 'success');
                game.ui.updateStats(player, game.world);
                ActionMenu._showShipManagePanel(game, tile, sid);
            } else {
                game.ui.showNotification('Error', result.message, 'error');
            }
        };

        window._renameShip = (sid) => {
            let renameHtml = '<div>';
            renameHtml += '<label style="font-size:12px;">New name:</label>';
            renameHtml += `<input id="renameShipInput" type="text" value="${ship.name}" style="width:100%;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;margin:4px 0;" />`;
            renameHtml += `<button onclick="window._doRenameShip('${sid}')" style="width:100%;">Confirm</button>`;
            renameHtml += '</div>';
            game.ui.showCustomPanel('Rename Ship', renameHtml);
        };

        window._doRenameShip = (sid) => {
            const newName = document.getElementById('renameShipInput').value.trim();
            if (newName) {
                const s = Ships.getShipById(player, sid);
                if (s) s.name = newName;
            }
            ActionMenu._showShipManagePanel(game, tile, sid);
        };

        window._sellShipConfirm = (sid, price) => {
            let cHtml = '<div>';
            cHtml += `<p>Sell ${ship.name} for approximately ${price}g?</p>`;
            cHtml += '<div style="display:flex;gap:6px;">';
            cHtml += `<button onclick="window._doSellShip('${sid}')" style="flex:1;background:#8b0000;">Confirm</button>`;
            cHtml += `<button onclick="ActionMenu._showShipManagePanel(window._game, window._tile, '${sid}')" style="flex:1;">Cancel</button>`;
            cHtml += '</div></div>';
            game.ui.showCustomPanel('Sell Ship', cHtml);
        };

        window._doSellShip = (sid) => {
            const result = Ships.sellShip(player, sid);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('🏷️ Ship Sold!', result.message, 'success');
                game.ui.updateStats(player, game.world);
            } else {
                game.ui.showNotification('Error', result.message, 'error');
            }
        };
    },

    _showMoveShipMenu(game, tile, shipId) {
        const player = game.player;
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return;
        const st = Ships.getShipType(ship.typeId);

        // Find coastal settlements the ship can move to
        const allSettlements = game.world.getAllSettlements();
        const coastalDests = allSettlements.filter(s => {
            if (s.q === tile.q && s.r === tile.r) return false;
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = game.world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });
        });

        let html = '<div style="max-height:400px;overflow-y:auto;">';
        html += `<h4 style="margin-top:0;">🧭 Move ${ship.name}</h4>`;
        html += '<p style="font-size:12px;color:var(--text-secondary);">Choose a destination port. Your ship will travel there over time.</p>';

        if (coastalDests.length === 0) {
            html += '<p style="text-align:center;color:var(--text-secondary);">No reachable ports found.</p>';
        }
        for (const dest of coastalDests) {
            const dist = Hex.distance(tile.q, tile.r, dest.q, dest.r);
            const travelDays = Math.max(1, Math.ceil(dist / (st ? st.speed : 4)));
            html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px solid var(--border);">`;
            html += `<div>`;
            html += `<div style="font-size:12px;font-weight:bold;">${dest.name} (${dest.type})</div>`;
            html += `<div style="font-size:10px;color:var(--text-secondary);">${dist} hexes · ~${travelDays} days</div>`;
            html += '</div>';
            html += `<button onclick="window._sendShipTo('${ship.id}', ${dest.q}, ${dest.r}, '${dest.name.replace(/'/g, "\\'")}')" style="font-size:11px;">Send</button>`;
            html += '</div>';
        }

        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="width:100%;margin-top:8px;background:var(--bg-secondary);font-size:11px;">← Back</button>`;
        html += '</div>';
        game.ui.showCustomPanel('Move Ship', html);
        window._game = game;
        window._tile = tile;

        window._sendShipTo = (sid, dq, dr, dname) => {
            const result = Ships.moveShip(player, sid, dq, dr, dname, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('🧭 Ship Dispatched!', result.message, 'info');
                game.ui.updateStats(player, game.world);
            } else {
                game.ui.showNotification('Error', result.message, 'error');
            }
        };
    },

    showBoardShipMenu(game, tile) {
        const player = game.player;
        const dockedShips = Ships.getShipsAt(player, tile.q, tile.r);

        let html = '<div style="max-height:450px;overflow-y:auto;">';
        html += '<h4 style="margin-top:0;">🚢 Board a Ship</h4>';
        html += '<p style="font-size:12px;color:var(--text-secondary);">Board one of your ships and set sail. You can travel, explore, trade, or seek combat on the seas.</p>';

        for (const ship of dockedShips) {
            if (ship.status !== 'docked') continue;
            const st = Ships.getShipType(ship.typeId);
            if (!st) continue;
            html += `<div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.02);">`;
            html += `<div style="font-weight:bold;">${st.icon} ${ship.name}</div>`;
            html += '<div style="font-size:11px;display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;">';
            html += `<span>🔧 ${ship.condition}%</span><span>⚓ Speed ${st.speed}</span><span>⚔️ ${st.combatStrength} str</span>`;
            html += '</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">';
            html += `<button onclick="window._sailTo('${ship.id}')" style="flex:1;font-size:11px;">🧭 Sail to Port</button>`;
            html += `<button onclick="window._explore('${ship.id}')" style="flex:1;font-size:11px;">🔭 Explore Seas</button>`;
            html += `<button onclick="window._huntPirates('${ship.id}')" style="flex:1;font-size:11px;">⚔️ Hunt Pirates</button>`;
            html += `<button onclick="window._piracy('${ship.id}')" style="flex:1;font-size:11px;">🏴‍☠️ Piracy</button>`;
            html += `<button onclick="window._seaTrade('${ship.id}')" style="flex:1;font-size:11px;">💰 Sea Trade</button>`;
            html += '</div>';
            html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('🚢 Board Ship', html);

        window._sailTo = (shipId) => {
            ActionMenu._showSailToMenu(game, tile, shipId);
        };

        window._explore = (shipId) => {
            const result = Ships.exploreOcean(player, shipId, game.world);
            game.ui.hideCustomPanel();
            if (result.success) {
                game.ui.showNotification(result.icon || '🔭', result.title, result.type || 'info');
                if (result.moved) {
                    game.camera.centerOn(player.q, player.r);
                }
            } else {
                game.ui.showNotification('Error', result.message, 'error');
            }
            game.ui.updateStats(player, game.world);
            game.endDay();
        };

        window._huntPirates = (shipId) => {
            const result = Ships.huntPirates(player, shipId, game.world);
            game.ui.hideCustomPanel();
            game.ui.showNotification(result.icon || '⚔️', result.title || 'Pirate Hunt', result.type || 'info');
            game.ui.updateStats(player, game.world);
            game.endDay();
        };

        window._piracy = (shipId) => {
            const result = Ships.commitPiracy(player, shipId, game.world);
            game.ui.hideCustomPanel();
            game.ui.showNotification(result.icon || '🏴‍☠️', result.title || 'Piracy', result.type || 'info');
            game.ui.updateStats(player, game.world);
            game.endDay();
        };

        window._seaTrade = (shipId) => {
            const result = Ships.doSeaTrade(player, shipId, game.world);
            game.ui.hideCustomPanel();
            game.ui.showNotification(result.icon || '💰', result.title || 'Sea Trade', result.type || 'info');
            game.ui.updateStats(player, game.world);
            game.endDay();
        };
    },

    _showSailToMenu(game, tile, shipId) {
        const player = game.player;
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return;
        const st = Ships.getShipType(ship.typeId);

        const allSettlements = game.world.getAllSettlements();
        const coastalDests = allSettlements.filter(s => {
            if (s.q === tile.q && s.r === tile.r) return false;
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = game.world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });
        });

        let html = '<div style="max-height:400px;overflow-y:auto;">';
        html += `<h4 style="margin-top:0;">🧭 Sail ${ship.name} to...</h4>`;

        for (const dest of coastalDests) {
            const dist = Hex.distance(tile.q, tile.r, dest.q, dest.r);
            const speed = st ? st.speed : 4;
            const travelDays = Math.max(1, Math.ceil(dist / speed));
            const fuelCost = travelDays * (st ? st.dailyUpkeep : 5);
            html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px solid var(--border);">`;
            html += `<div><div style="font-size:12px;font-weight:bold;">${dest.name}</div>`;
            html += `<div style="font-size:10px;color:var(--text-secondary);">~${travelDays} days · ${fuelCost}g travel costs</div></div>`;
            html += `<button onclick="window._doSailTo('${ship.id}', ${dest.q}, ${dest.r}, '${dest.name.replace(/'/g, "\\'")}')" style="font-size:11px;">Sail</button>`;
            html += '</div>';
        }

        html += `<button onclick="ActionMenu.showBoardShipMenu(window._game, window._tile)" style="width:100%;margin-top:8px;background:var(--bg-secondary);font-size:11px;">← Back</button>`;
        html += '</div>';
        game.ui.showCustomPanel('Set Sail', html);
        window._game = game;
        window._tile = tile;

        window._doSailTo = (sid, dq, dr, dname) => {
            const result = Ships.sailPlayerTo(player, sid, dq, dr, dname, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('⛵ Arrived!', result.message, 'success');
                game.camera.centerOn(player.q, player.r);
                game.ui.updateStats(player, game.world);
                game.endDay();
            } else {
                game.ui.showNotification('Error', result.message, 'error');
            }
        };
    },

    showFleetMenu(game, tile) {
        const player = game.player;
        const allShips = player.ships || [];

        let html = '<div style="max-height:450px;overflow-y:auto;">';
        html += '<h4 style="margin-top:0;">⚓ Your Fleet</h4>';

        if (allShips.length === 0) {
            html += '<p style="font-size:12px;color:var(--text-secondary);text-align:center;">You do not own any ships.</p>';
        }

        for (const ship of allShips) {
            const st = Ships.getShipType(ship.typeId);
            if (!st) continue;
            const statusIcon = ship.status === 'docked' ? '⚓' : ship.status === 'building' ? '🏗️' : ship.status === 'moving' ? '🧭' : '⚓';
            html += `<div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.02);">`;
            html += `<div style="font-weight:bold;">${st.icon} ${ship.name} <span style="font-size:10px;color:var(--text-secondary);">${statusIcon} ${ship.status}</span></div>`;
            html += '<div style="font-size:11px;display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;">';
            html += `<span>📍 ${ship.dockedAt || ship.destinationName || 'Unknown'}</span>`;
            html += `<span>🔧 ${ship.condition}%</span>`;
            if (ship.status === 'building') html += `<span>🏗️ ${ship.buildDaysLeft} days left</span>`;
            if (ship.status === 'moving') html += `<span>🧭 ${ship.travelDaysLeft || '?'} days ETA</span>`;
            html += '</div>';
            html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('⚓ Fleet Overview', html);
    },

    /**
     * Close action menu
     */
    close() {
        const menu = document.getElementById('actionMenu');
        if (menu) menu.remove();
    },
};
