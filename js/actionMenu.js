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
                        ${Object.values(PlayerEconomy.RECIPES).map(r => `
                            <option value="${r.id.toUpperCase()}" ${prop.activeRecipe === r.id.toUpperCase() ? 'selected' : ''}>
                                ${r.name} (${r.inputQty} ${PlayerEconomy.GOODS[r.input.toUpperCase()]?.name} ➔ ${r.outputQty} ${PlayerEconomy.GOODS[r.output.toUpperCase()]?.name})
                            </option>
                        `).join('')}
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
                const basePrice = good ? good.basePrice : 10;

                // Estimate value
                const estValue = Math.floor(basePrice * (1 + dist * 0.05) * multiplier * tile.playerProperty.storage);

                html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:4px; transition:background 0.2s;">
                        <div style="flex-grow:1;">
                            <div style="font-weight:bold; color:var(--text-primary);">${s.name} <span style="font-size:10px; opacity:0.6; font-weight:normal;">(${s.type})</span></div>
                            <div style="display:flex; gap:12px; margin-top:2px;">
                                <div style="font-size:10px; color:var(--text-secondary);">📏 ${dist} hexes</div>
                                <div style="font-size:10px; color:#2ecc71;">💰 ~${estValue}g profit</div>
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
     * Close action menu
     */
    close() {
        const menu = document.getElementById('actionMenu');
        if (menu) menu.remove();
    },
};
