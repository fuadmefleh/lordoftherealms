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
     * Create the action menu UI
     */
    createMenu(game, tile, actions) {
        // Remove existing menu if any
        ActionMenu.close();

        const menu = document.createElement('div');
        menu.id = 'actionMenu';
        menu.className = 'action-menu';
        menu.style.cssText = `
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
            max-width: 500px;
            z-index: 1000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        `;

        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; font-family: var(--font-display); color: var(--gold);">Actions</h3>
                <button id="closeActionMenu" style="background: none; border: none; color: var(--text-primary); font-size: 20px; cursor: pointer;">✕</button>
            </div>
            <div style="display: grid; gap: 8px;">
        `;

        for (const action of actions) {
            html += `
                <button class="action-menu-btn" data-action="${action.type}" style="
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    padding: 12px;
                    border-radius: 4px;
                    color: var(--text-primary);
                    cursor: pointer;
                    text-align: left;
                    transition: all 0.2s;
                    font-family: var(--font-body);
                ">
                    <span style="font-size: 20px; margin-right: 8px;">${action.icon}</span>
                    <span>${action.label}</span>
                </button>
            `;
        }

        html += `</div>`;
        menu.innerHTML = html;
        document.body.appendChild(menu);

        // Add event listeners
        document.getElementById('closeActionMenu').addEventListener('click', () => ActionMenu.close());

        const buttons = menu.querySelectorAll('.action-menu-btn');
        buttons.forEach(btn => {
            btn.addEventListener('mouseover', () => {
                btn.style.background = 'rgba(245, 197, 66, 0.2)';
                btn.style.borderColor = 'var(--gold)';
            });
            btn.addEventListener('mouseout', () => {
                btn.style.background = 'rgba(255,255,255,0.05)';
                btn.style.borderColor = 'rgba(255,255,255,0.1)';
            });
            btn.addEventListener('click', () => {
                const actionType = btn.getAttribute('data-action');
                ActionMenu.handleAction(game, tile, actionType);
            });
        });
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
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <span>${good.icon} ${good.name}</span>
                    <span>${good.price} gold (${good.quantity} available)</span>
                    <button onclick="window.buyGood('${good.id}', ${good.price}, ${good.quantity})" style="padding: 4px 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">Buy</button>
                </div>
            `;
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
            if (rumors.length > 0) {
                ActionMenu._showRumorResults(game, rumors, tile);
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

        if (rumors.length > 0) {
            Tavern._storeRumors(game.player, rumors);
            ActionMenu._showRumorResults(game, rumors, tile);
        } else {
            game.ui.showNotification('Locals', 'The villagers don\'t have much to say today.', 'default');
        }
    },

    /**
     * Display rumor results from a tavern/locals interaction
     */
    _showRumorResults(game, rumors, tile) {
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
     * Close action menu
     */
    close() {
        const menu = document.getElementById('actionMenu');
        if (menu) menu.remove();
    },
};
