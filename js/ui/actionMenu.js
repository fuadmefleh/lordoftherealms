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
            trade: 'commerce', contract: 'commerce', ship_passage: 'commerce',
            collect_goods: 'commerce', manage_property: 'commerce', start_caravan: 'commerce',
            tavern: 'social', talk_locals: 'social', preach: 'social',
            pilgrimage: 'social', miracle: 'social',
            recruit: 'military', attack_unit: 'military', attack_settlement: 'military',
            request_meeting: 'social',
            build_property: 'building', build_temple: 'building',
            build_cultural: 'building', build_infrastructure: 'building',
            demolish_infrastructure: 'building',
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
                ActionMenu.handleAction(game, tile, actionType);
            });
        });
    },

    /**
     * Render a single action button with icon, label, and description
     */
    _renderActionButton(action) {
        return `
            <button class="action-menu-btn" data-action="${action.type}" style="
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
    handleAction(game, tile, actionType) {
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
            case 'attack_unit':
                ActionMenu.showAttackConfirm(game, tile, actionType);
                break;
            case 'attack_settlement':
                ActionMenu.showSiegeConfirm(game, tile);
                break;
            case 'request_meeting':
                ActionMenu.showLordMeetingMenu(game, tile, actionType);
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

    /**
     * Close action menu
     */
    close() {
        const menu = document.getElementById('actionMenu');
        if (menu) menu.remove();
    },
};
