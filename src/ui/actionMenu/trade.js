// ActionMenu — trade methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerInventory, NpcDisposition } from './_imports.js';

Object.assign(ActionMenu, {
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
            const cost = 15 + (dist * 2);
            const travelDays = Math.max(1, Math.ceil(dist / 10));
            const canAfford = game.player.gold >= cost;

            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center; ${!canAfford ? 'opacity: 0.6;' : ''}">
                    <div>
                        <div style="font-weight: bold; color: white;">${dest.name}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">Distance: ${dist} hexes · ${travelDays} day${travelDays > 1 ? 's' : ''} at sea</div>
                    </div>
                    <button onclick="window.payForPassage(${dest.q}, ${dest.r}, ${cost}, '${dest.name}', ${travelDays})" 
                            ${!canAfford ? 'disabled' : ''} 
                            style="padding: 6px 14px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        ${cost} gold
                    </button>
                </div>
            `;
        }

        html += '</div>';

        game.ui.showCustomPanel('Coastal Travel', html);

        window.payForPassage = (q, r, cost, name, travelDays) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            if (game.player.gold >= cost) {
                game.player.gold -= cost;
                game.player.q = q;
                game.player.r = r;
                game.player.isMoving = false;
                game.player.path = [];

                // Advance time based on travel distance — chain endDay calls
                game.ui.hideCustomPanel();
                let daysProcessed = 0;

                const processNextDay = () => {
                    daysProcessed++;
                    // Force-bypass confirm modal for sea travel
                    game._endDayConfirmed = true;
                    game.endDay();

                    if (daysProcessed < travelDays && game.player.health > 0) {
                        // Wait for the current endDay's setTimeout to finish, then queue next
                        const waitForTurn = setInterval(() => {
                            if (!game.isProcessingTurn) {
                                clearInterval(waitForTurn);
                                processNextDay();
                            }
                        }, 60);
                    } else {
                        // All days processed — show arrival
                        const waitDone = setInterval(() => {
                            if (!game.isProcessingTurn) {
                                clearInterval(waitDone);
                                const pos = Hex.axialToPixel(q, r, game.renderer.hexSize);
                                game.camera.centerOn(pos.x, pos.y);
                                game.ui.showNotification('Safe Voyage', `You arrived at ${name}. The journey took ${travelDays} day${travelDays > 1 ? 's' : ''}.`, 'success');
                                game.ui.updateStats(game.player, game.world);
                            }
                        }, 60);
                    }
                };

                processNextDay();
            } else {
                game.ui.showNotification('Insufficient Gold', 'You do not have enough gold for passage.', 'error');
            }
        };
    },

    /**
     * Collect stored goods from every property on this tile
     */
    collectGoods(game, tile) {
        if (!game.player.inventory) game.player.inventory = {};
        const parts = [];
        let full = false;
        for (const prop of PlayerEconomy.getPropertiesAt(tile)) {
            // Taverns pay out directly; their storage only tallies earnings
            if (!prop.produces || prop.produces === 'gold' || !(prop.storage > 0)) continue;
            const good = prop.produces;
            // No room for a new kind of good — it waits in the property's storage
            if (!PlayerInventory.addItem(game.player, good, prop.storage).success) { full = true; continue; }
            const goodDef = PlayerEconomy.GOODS[good.toUpperCase()];
            parts.push(`${prop.storage} ${goodDef ? goodDef.name : good}`);
            prop.storage = 0;
        }
        if (full) game.ui.showNotification('🎒 Packs Full', `Some goods stay in storage. ${PlayerInventory.fullMessage(game.player)}`, 'warning');
        if (parts.length === 0) return;

        game.ui.showNotification('Goods Collected', `Collected ${parts.join(', ')}`, 'success');
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Pick which of the player's properties on this tile to manage. A tile can
     * hold one of each property type; the chosen one becomes the tile's
     * focused `playerProperty`, which the manage menu (and its refreshes) use.
     */
    showPropertyPicker(game, tile) {
        const props = PlayerEconomy.getPropertiesAt(tile);
        if (props.length <= 1) {
            ActionMenu.showManagePropertyMenu(game, tile);
            return;
        }
        let html = '<div style="display:flex;flex-direction:column;gap:6px;">';
        props.forEach((p, i) => {
            const status = p.underConstruction
                ? `🏗️ ${p.constructionDaysLeft} day(s) left`
                : `Lv ${p.level} · ${p.storage > 0 && p.produces !== 'gold' ? `${p.storage} ${p.produces} stored` : 'running'}`;
            html += `<button onclick="window._pickProperty(${i})" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:rgba(255,255,255,0.03);color:var(--text-primary);cursor:pointer;text-align:left;">`;
            html += `<span style="font-size:13px;font-weight:600;">${p.icon || '🏠'} ${p.name}</span>`;
            html += `<span style="font-size:11px;color:var(--text-muted);">${status}</span></button>`;
        });
        html += '</div>';
        game.ui.showCustomPanel('🛠️ Your Properties Here', html);
        window._pickProperty = (i) => {
            tile.playerProperty = props[i];
            ActionMenu.showManagePropertyMenu(game, tile);
        };
    },

    /**
     * Show Manage Property Menu
     */
    showManagePropertyMenu(game, tile) {
        if (!tile.playerProperty) return;

        const prop = tile.playerProperty;
        const propType = PlayerEconomy.getPropertyDef(prop.type);
        const isWorkshop = PlayerEconomy.isRecipeBuilding(prop.type);

        // Calculate upgrade info
        const isMaxLevel = prop.level >= 5;
        const upgradeCost = Math.floor(propType.cost * 0.5 * (prop.level + 1));
        const canAffordUpgrade = game.player.gold >= upgradeCost;

        // Calculate upkeep
        const upkeep = PlayerEconomy.getPropertyUpkeep(game.player, prop);

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
        } else if (prop.type === 'tavern') {
            productionText = 'Gold (patrons)';
            prodRateText = `~${prop.todayIncome || '15-35'}`;
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
        `;

        // If under construction, show only the construction banner and sell button — no management
        if (prop.underConstruction) {
            const pct = prop.constructionDaysTotal > 0 ? ((prop.constructionDaysTotal - prop.constructionDaysLeft) / prop.constructionDaysTotal * 100) : 100;
            const barColor = pct > 66 ? '#2ecc71' : pct > 33 ? '#f39c12' : '#e74c3c';
            html += `
                <div style="padding: 14px; margin-bottom: 16px; background: rgba(245,197,66,0.08); border: 1px solid rgba(245,197,66,0.2); border-radius: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <span style="font-size: 24px;">🏗️</span>
                        <div>
                            <div style="font-weight: bold; color: var(--gold); font-size: 14px;">Under Construction</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${prop.constructionDaysLeft} day${prop.constructionDaysLeft !== 1 ? 's' : ''} remaining</div>
                        </div>
                    </div>
                    <div style="background: rgba(255,255,255,0.08); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${pct}%; height: 100%; background: ${barColor}; border-radius: 5px; transition: width 0.3s;"></div>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; text-align: center;">${pct.toFixed(0)}% complete — no production or upkeep until finished</div>
                </div>
                <button onclick="window.sellPropertyAction()" style="width:100%; padding:10px; background:#c0392b; border:none; border-radius:4px; cursor:pointer; color:white; font-weight:bold; margin-top:8px;">
                    Sell Property (Refund: ${Math.floor(propType.cost * 0.25)}g)
                </button>
            `;
            html += `</div>`;
            game.ui.showCustomPanel('Manage Property', html);

            window.sellPropertyAction = () => {
                const result = PlayerEconomy.sellProperty(game.player, tile, game.world);
                if (result.success) {
                    game.ui.showNotification('Property Sold', `${result.name} sold for ${result.refund} gold`, 'success');
                    game.ui.updateStats(game.player, game.world);
                    game.ui.hideCustomPanel();
                } else {
                    game.ui.showNotification('Cannot Sell', result.reason || 'Error', 'error');
                }
            };
            return;
        }

        // ── Operational property management below ──
        html += `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:20px;">
                <div style="background:rgba(46,204,113,0.06); padding:12px; border-radius:6px; border:1px solid rgba(46,204,113,0.15);">
                    <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; letter-spacing:1px; text-transform:uppercase;">Production</div>
                    <div style="font-size:16px; font-weight:bold; color:#2ecc71;">${productionText}</div>
                    <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">Rate: ${prodRateText}/day</div>
                </div>
                <div style="background:rgba(231,76,60,0.06); padding:12px; border-radius:6px; border:1px solid rgba(231,76,60,0.15);">
                    <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; letter-spacing:1px; text-transform:uppercase;">Upkeep</div>
                    <div style="font-size:20px; font-weight:bold; color:#e74c3c;">-${upkeep}g<span style="font-size:12px; color:var(--text-secondary);">/day</span></div>
                    ${PlayerEconomy.getAdministrationMultiplier(game.player) > 1 ? `<div style="font-size:10px; color:var(--text-muted);">incl. +${Math.round((PlayerEconomy.getAdministrationMultiplier(game.player) - 1) * 100)}% admin overhead (${(game.player.properties || []).length} properties)</div>` : ''}
                </div>
                <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; letter-spacing:1px; text-transform:uppercase;">${prop.type === 'tavern' ? 'Total Earnings' : 'Storage (Output)'}</div>
                     <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:20px; font-weight:bold; color:var(--text-primary);">${prop.type === 'tavern' ? (prop.storage || 0) + 'g' : `${prop.storage}<span style="font-size:12px; color:var(--text-secondary);"> / ${PlayerEconomy.getStorageCapacity(game.player, prop)}</span>`}${prop.type !== 'tavern' && prop.wastedToday > 0 ? `<div style="font-size:10px; color:#e74c3c;">Full — ${prop.wastedToday} lost today</div>` : ''}</div>
                        ${prop.type !== 'tavern' ? `<button onclick="window.collectPropertyGoods()" ${prop.storage <= 0 ? 'disabled' : ''} style="padding:5px 14px; background:${prop.storage > 0 ? 'var(--accent-green)' : 'rgba(255,255,255,0.08)'}; border:none; border-radius:4px; cursor:pointer; font-weight:600; font-size:12px; color:${prop.storage > 0 ? 'white' : 'var(--text-muted)'}; transition:all 0.15s;">Collect</button>` : ''}
                    </div>
                </div>
                 <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:6px; border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; letter-spacing:1px; text-transform:uppercase;">Auto-Sell (50% Value)</div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:13px; font-weight:bold; color:${prop.autoSell ? '#2ecc71' : '#95a5a6'};">${prop.autoSell ? 'ENABLED' : 'DISABLED'}</div>
                        <button onclick="window.toggleAutoSell()" style="padding:5px 14px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:var(--text-primary); border-radius:4px; cursor:pointer; font-size:12px; font-weight:600; transition:all 0.15s;">${prop.autoSell ? 'Disable' : 'Enable'}</button>
                    </div>
                </div>
            </div>
        `;

        // Workshop Specific Section: Recipe Selector & Input
        if (isWorkshop) {
            const propType = PlayerEconomy.getPropertyDef(prop.type) || {};
            const retoolingBaseCost = propType.recipeChangeCost || 150;
            const retoolingCost = Math.floor(retoolingBaseCost * prop.level);
            const isRetooling = prop.retooling && prop.retoolingDaysLeft > 0;

            html += `
            <div style="margin-bottom:20px; background:rgba(255,255,255,0.03); padding:16px; border-radius:8px; border:1px solid ${isRetooling ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.08)'};">
                <h4 style="margin:0 0 12px 0; color:var(--gold); font-size:14px; font-weight:600; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:8px; font-family:var(--font-display);">Production Configuration</h4>
            `;

            // Show retooling status banner
            if (isRetooling) {
                html += `
                <div style="background:rgba(245,166,35,0.12); border:1px solid rgba(245,166,35,0.3); border-radius:6px; padding:10px 14px; margin-bottom:14px; display:flex; align-items:center; gap:10px;">
                    <span style="font-size:20px;">🔧</span>
                    <div>
                        <div style="color:#f5a623; font-weight:600; font-size:13px;">Retooling in Progress</div>
                        <div style="color:var(--text-muted); font-size:11px; margin-top:2px;">${prop.retoolingDaysLeft} day${prop.retoolingDaysLeft !== 1 ? 's' : ''} remaining — no production during retooling</div>
                    </div>
                </div>
                `;
            }

            html += `
                <div style="margin-bottom:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Active Recipe</div>
                        ${prop.activeRecipe ? `<div style="font-size:10px; color:var(--text-muted);">Change cost: <span style="color:var(--gold); font-weight:600;">${retoolingCost}g</span></div>` : ''}
                    </div>
                    <select id="workshopRecipeSelector" onchange="window.selectRecipe(this.value)" ${isRetooling ? 'disabled' : ''} style="width:100%; padding:8px 32px 8px 10px; background:rgba(245,197,66,0.06); border:1px solid var(--border-color); color:var(--gold); border-radius:var(--radius-sm); font-family:var(--font-body); font-size:13px; font-weight:600; outline:none; cursor:pointer; -webkit-appearance:none; -moz-appearance:none; appearance:none; background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23f5c542' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\"); background-repeat:no-repeat; background-position:right 8px center; background-size:12px; transition:all var(--transition-fast);">
                        <option value="" style="background:#0c1220; color:var(--text-primary);">-- Select Recipe --</option>
                        ${(() => {
                            const allRecipes = (typeof Technology !== 'undefined') ? Technology.getUnlockedRecipes(game.player) : PlayerEconomy.RECIPES;
                            const allowed = propType && propType.allowedRecipes ? propType.allowedRecipes : null;
                            return Object.values(allRecipes).filter(r => !allowed || allowed.includes(r.id.toUpperCase())).map(r => `
                            <option value="${r.id.toUpperCase()}" ${prop.activeRecipe === r.id.toUpperCase() ? 'selected' : ''} style="background:#0c1220; color:var(--text-primary); padding:6px 10px;">
                                ${r.name} (${r.inputQty} ${PlayerEconomy.GOODS[r.input.toUpperCase()]?.name} ➔ ${r.outputQty} ${PlayerEconomy.GOODS[r.output.toUpperCase()]?.name})
                            </option>
                        `).join('');
                        })()}
                    </select>
                </div>
            `;

            if (isRetooling) {
                // During retooling, show muted input section
                html += `<div style="color:var(--text-muted); font-style:italic; font-size:12px;">Workshop is being retooled. Deposits disabled until retooling completes.</div>`;
            } else if (prop.activeRecipe) {
                const recipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                const inputGood = PlayerEconomy.GOODS[recipe.input.toUpperCase()];
                const playerHas = (game.player.inventory && game.player.inventory[recipe.input]) || 0;

                html += `
                <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:16px;">
                    <div>
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Input Storage (${inputGood.name})</div>
                        <div style="font-size:18px; font-weight:bold; color:var(--text-primary); margin-top:2px;">${prop.inputStorage || 0} <span style="font-size:11px; font-weight:normal; color:var(--text-muted);">stored</span></div>
                    </div>
                    <div>
                        <div style="font-size:11px; color:var(--text-muted); text-align:right; margin-bottom:6px;">In Inventory: <span style="color:var(--text-primary); font-weight:600;">${playerHas}</span></div>
                        <div style="display:flex; gap:6px;">
                             <button onclick="window.depositToWorkshop('${recipe.input}', 1)" ${playerHas < 1 ? 'disabled' : ''} style="padding:5px 10px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:var(--text-primary); border-radius:var(--radius-sm); cursor:pointer; font-size:12px; font-weight:600; transition:all 0.15s;">+1</button>
                             <button onclick="window.depositToWorkshop('${recipe.input}', 10)" ${playerHas < 10 ? 'disabled' : ''} style="padding:5px 10px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:var(--text-primary); border-radius:var(--radius-sm); cursor:pointer; font-size:12px; font-weight:600; transition:all 0.15s;">+10</button>
                             <button onclick="window.depositToWorkshop('${recipe.input}', 100)" ${playerHas < 100 ? 'disabled' : ''} style="padding:5px 10px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:var(--text-primary); border-radius:var(--radius-sm); cursor:pointer; font-size:12px; font-weight:600; transition:all 0.15s;">+100</button>
                             <button onclick="window.depositToWorkshop('${recipe.input}', ${playerHas})" ${playerHas < 1 ? 'disabled' : ''} style="padding:5px 10px; background:var(--accent-green); border:none; color:white; font-weight:bold; border-radius:var(--radius-sm); cursor:pointer; font-size:12px; transition:all 0.15s;">+All</button>
                        </div>
                    </div>
                </div>
                `;
            } else {
                html += `<div style="color:var(--text-secondary); font-style:italic;">Select a recipe to enable production.</div>`;
            }

            html += `</div>`;
        }

        // Tavern-specific management section
        const isTavern = prop.type === 'tavern';
        if (isTavern) {
            const beerStock = prop.beerStock || 0;
            const liquorStock = prop.liquorStock || 0;
            const tables = prop.gamblingTables || 0;
            const tableCost = 150 + tables * 100;
            const maxTables = prop.level + 1;
            const canBuyTable = game.player.gold >= tableCost && tables < maxTables;
            const playerBeer = (game.player.inventory && game.player.inventory.beer) || 0;
            const playerLiquor = (game.player.inventory && game.player.inventory.liquor) || 0;
            const todayIncome = prop.todayIncome || 0;

            html += `
            <div style="margin-bottom:20px; background:linear-gradient(135deg, rgba(139,69,19,0.12) 0%, rgba(80,40,10,0.15) 100%); padding:16px; border-radius:8px; border:1px solid rgba(255,215,0,0.15);">
                <h4 style="margin:0 0 12px 0; color:#f4a460; font-size:14px; font-weight:600; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:8px; font-family:var(--font-display);">🍻 Tavern Operations</h4>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:14px;">
                    <div style="background:rgba(0,0,0,0.25); padding:10px; border-radius:6px;">
                        <div style="font-size:10px; color:var(--text-muted); margin-bottom:3px; text-transform:uppercase; letter-spacing:0.5px;">Today's Income</div>
                        <div style="font-size:20px; font-weight:bold; color:#2ecc71;">${todayIncome}g</div>
                    </div>
                    <div style="background:rgba(0,0,0,0.25); padding:10px; border-radius:6px;">
                        <div style="font-size:10px; color:var(--text-muted); margin-bottom:3px; text-transform:uppercase; letter-spacing:0.5px;">Gambling Tables</div>
                        <div style="font-size:20px; font-weight:bold; color:var(--gold);">${tables} / ${maxTables}</div>
                    </div>
                </div>

                <div style="font-size:11px; color:var(--text-secondary); margin-bottom:10px;">Stock your tavern with beer and liquor to boost daily income. Each table adds +15% income.</div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:14px;">
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <div style="font-size:12px; color:var(--text-primary);">🍺 Beer: <strong>${beerStock}</strong></div>
                            <span style="font-size:10px; color:var(--text-muted);">-2/day</span>
                        </div>
                        <div style="font-size:10px; color:var(--text-secondary); margin-bottom:6px;">+30% income when stocked</div>
                        <div style="display:flex; gap:4px;">
                            <button onclick="window.stockTavern('beer', 5)" ${playerBeer < 5 ? 'disabled' : ''} style="flex:1; padding:4px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:var(--text-primary); border-radius:3px; cursor:pointer; font-size:11px; font-weight:600;">+5</button>
                            <button onclick="window.stockTavern('beer', 20)" ${playerBeer < 20 ? 'disabled' : ''} style="flex:1; padding:4px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:var(--text-primary); border-radius:3px; cursor:pointer; font-size:11px; font-weight:600;">+20</button>
                            <button onclick="window.stockTavern('beer', ${playerBeer})" ${playerBeer < 1 ? 'disabled' : ''} style="flex:1; padding:4px; background:var(--accent-green); border:none; color:white; border-radius:3px; cursor:pointer; font-size:11px; font-weight:bold;">All</button>
                        </div>
                        <div style="font-size:10px; color:var(--text-muted); margin-top:3px;">You have: ${playerBeer} beer</div>
                    </div>
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <div style="font-size:12px; color:var(--text-primary);">🥃 Liquor: <strong>${liquorStock}</strong></div>
                            <span style="font-size:10px; color:var(--text-muted);">-1/day</span>
                        </div>
                        <div style="font-size:10px; color:var(--text-secondary); margin-bottom:6px;">+20% income when stocked</div>
                        <div style="display:flex; gap:4px;">
                            <button onclick="window.stockTavern('liquor', 5)" ${playerLiquor < 5 ? 'disabled' : ''} style="flex:1; padding:4px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:var(--text-primary); border-radius:3px; cursor:pointer; font-size:11px; font-weight:600;">+5</button>
                            <button onclick="window.stockTavern('liquor', 10)" ${playerLiquor < 10 ? 'disabled' : ''} style="flex:1; padding:4px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:var(--text-primary); border-radius:3px; cursor:pointer; font-size:11px; font-weight:600;">+10</button>
                            <button onclick="window.stockTavern('liquor', ${playerLiquor})" ${playerLiquor < 1 ? 'disabled' : ''} style="flex:1; padding:4px; background:var(--accent-green); border:none; color:white; border-radius:3px; cursor:pointer; font-size:11px; font-weight:bold;">All</button>
                        </div>
                        <div style="font-size:10px; color:var(--text-muted); margin-top:3px;">You have: ${playerLiquor} liquor</div>
                    </div>
                </div>

                <button onclick="window.buyGamblingTable()" ${!canBuyTable ? 'disabled' : ''} 
                    style="width:100%; padding:9px; background:${canBuyTable ? 'linear-gradient(135deg, var(--gold-dark), var(--gold))' : 'rgba(255,255,255,0.06)'}; border:${canBuyTable ? 'none' : '1px solid rgba(255,255,255,0.1)'}; border-radius:var(--radius-sm); cursor:${canBuyTable ? 'pointer' : 'not-allowed'}; font-weight:bold; color:${canBuyTable ? '#1a1207' : 'var(--text-muted)'}; font-size:13px; box-shadow:${canBuyTable ? '0 2px 8px rgba(245,197,66,0.3)' : 'none'}; transition:all 0.15s;">
                    ${tables >= maxTables ? '🎲 Max Tables (upgrade to add more)' : `🎲 Add Gambling Table — ${tableCost}g`}
                </button>
            </div>
            `;
        }

        // Upgrade Section
        const upgradeBtnLocked = isMaxLevel || !canAffordUpgrade;
        html += `
            <div style="margin-bottom:20px; background:rgba(255,255,255,0.03); padding:16px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                <h4 style="margin:0 0 12px 0; color:var(--text-primary); font-size:14px; font-weight:600; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:8px; font-family:var(--font-display);">Expansion & Upgrades</h4>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:600; color:var(--text-primary); font-size:14px;">Upgrade to Level ${prop.level + 1}</div>
                        <div style="font-size:11px; color:var(--text-secondary); margin-top:4px;">Increases production by 10% base value. Increases upkeep.</div>
                    </div>
                    <button onclick="window.upgradePropertyAction()" 
                        ${upgradeBtnLocked ? 'disabled' : ''}
                        style="padding:8px 18px; background:${isMaxLevel ? 'rgba(255,255,255,0.06)' : canAffordUpgrade ? 'linear-gradient(135deg, var(--gold-dark), var(--gold))' : 'rgba(255,255,255,0.06)'}; border:${isMaxLevel || !canAffordUpgrade ? '1px solid rgba(255,255,255,0.1)' : 'none'}; border-radius:var(--radius-sm); cursor:${upgradeBtnLocked ? 'not-allowed' : 'pointer'}; font-weight:bold; color:${isMaxLevel || !canAffordUpgrade ? 'var(--text-muted)' : '#1a1207'}; box-shadow:${upgradeBtnLocked ? 'none' : '0 2px 8px rgba(245,197,66,0.3)'}; min-width:110px; text-align:center; font-size:13px; transition:all 0.15s;">
                        ${isMaxLevel ? 'MAX LEVEL' : `${upgradeCost} gold`}
                    </button>
                </div>
            </div>
        `;

        // Caravan Logistics Section
        html += `
            <div style="margin-bottom:16px; background:rgba(255,255,255,0.03); padding:16px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h4 style="margin:0; font-size:14px; font-weight:600; font-family:var(--font-display); color:var(--text-primary);">Logistics Network</h4>
                    <span style="font-size:10px; background:rgba(245,197,66,0.1); color:var(--gold); padding:3px 8px; border-radius:var(--radius-sm); border:1px solid rgba(245,197,66,0.15); font-weight:600;">Cost: 200g/caravan</span>
                </div>
                <p style="font-size:11px; color:var(--text-secondary); margin:0 0 12px 0;">Hire a caravan to transport your stored goods directly to a market for max profit.</p>
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
                            <button onclick="window.startCraftingParts()" ${!craftCheck.can ? 'disabled' : ''} style="padding:8px 14px; background:${craftCheck.can ? 'linear-gradient(135deg, #e68a00, #ff9800)' : 'rgba(255,255,255,0.06)'}; border:${craftCheck.can ? 'none' : '1px solid rgba(255,255,255,0.1)'}; border-radius:var(--radius-sm); cursor:${craftCheck.can ? 'pointer' : 'not-allowed'}; font-weight:bold; color:${craftCheck.can ? '#1a1207' : 'var(--text-muted)'}; font-size:13px; transition:all 0.15s;">
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
                        <button onclick="window.buildLabAction()" ${!labCheck.can ? 'disabled' : ''} style="padding:10px 20px; width:100%; background:${labCheck.can ? 'linear-gradient(135deg, var(--gold-dark), var(--gold))' : 'rgba(255,255,255,0.06)'}; border:${labCheck.can ? 'none' : '1px solid rgba(255,255,255,0.1)'}; border-radius:var(--radius-sm); cursor:${labCheck.can ? 'pointer' : 'not-allowed'}; font-weight:bold; color:${labCheck.can ? '#1a1207' : 'var(--text-muted)'}; font-size:13px; transition:all 0.15s;">
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

        window.sendStorageCaravan = (q, r, propertyType = null) => {
            const targetTile = game.world.getTile(q, r);
            if (!targetTile) return;

            // A named property type means an internal transfer to that building,
            // even when it stands inside a settlement
            const targetProp = propertyType ? PlayerEconomy.findPropertyAt(targetTile, propertyType) : null;
            let toObject = null;
            if (targetProp) {
                toObject = {
                    type: targetProp.type,
                    name: targetProp.name,
                    q: targetTile.q,
                    r: targetTile.r,
                    isPlayerProperty: true
                };
            } else if (targetTile.settlement) {
                toObject = { ...targetTile.settlement, q: targetTile.q, r: targetTile.r, isPlayerProperty: false };
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
            const prop = tile.playerProperty;
            const isChange = prop && prop.activeRecipe && prop.activeRecipe !== recipeId;

            if (isChange) {
                const propType = PlayerEconomy.getPropertyDef(prop.type) || {};
                const baseCost = propType.recipeChangeCost || 150;
                const retoolingCost = Math.floor(baseCost * prop.level);
                const retoolingDays = propType.retoolingDays || 2;
                const oldRecipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                const newRecipe = PlayerEconomy.RECIPES[recipeId];

                // Show confirmation dialog
                const inputReturn = (prop.inputStorage > 0 && oldRecipe)
                    ? `\n• ${prop.inputStorage} ${oldRecipe.input} returned to inventory`
                    : '';
                const msg = `Retool workshop to produce ${newRecipe ? newRecipe.name : recipeId}?\n\n• Cost: ${retoolingCost} gold\n• Downtime: ${retoolingDays} days (no production)${inputReturn}`;
                if (!confirm(msg)) {
                    // Reset dropdown to current value
                    const sel = document.getElementById('workshopRecipeSelector');
                    if (sel) sel.value = prop.activeRecipe;
                    return;
                }
            }

            const result = PlayerEconomy.setWorkshopRecipe(tile, recipeId, game.player);
            if (result.success) {
                if (result.wasChange) {
                    game.ui.showNotification('Workshop Retooled', 'Retooling in progress...', 'info');
                    game.ui.updateStats(game.player, game.world);
                }
                ActionMenu.showManagePropertyMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Change Recipe', result.reason, 'error');
                // Reset dropdown
                const sel = document.getElementById('workshopRecipeSelector');
                if (sel && prop) sel.value = prop.activeRecipe || '';
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

        // Tavern handlers
        window.stockTavern = (goodType, amount) => {
            if (!tile.playerProperty || tile.playerProperty.type !== 'tavern') return;
            const inv = game.player.inventory || {};
            const has = inv[goodType] || 0;
            const actual = Math.min(amount, has);
            if (actual <= 0) return;
            inv[goodType] = has - actual;
            if (goodType === 'beer') {
                tile.playerProperty.beerStock = (tile.playerProperty.beerStock || 0) + actual;
            } else if (goodType === 'liquor') {
                tile.playerProperty.liquorStock = (tile.playerProperty.liquorStock || 0) + actual;
            }
            game.ui.showNotification('Tavern Stocked', `Added ${actual} ${goodType} to the tavern`, 'success');
            game.ui.updateStats(game.player, game.world);
            ActionMenu.showManagePropertyMenu(game, tile);
        };

        window.buyGamblingTable = () => {
            if (!tile.playerProperty || tile.playerProperty.type !== 'tavern') return;
            const tables = tile.playerProperty.gamblingTables || 0;
            const maxTables = tile.playerProperty.level + 1;
            if (tables >= maxTables) {
                game.ui.showNotification('Max Tables', 'Upgrade your tavern to add more tables', 'error');
                return;
            }
            const cost = 150 + tables * 100;
            if (game.player.gold < cost) {
                game.ui.showNotification('Not Enough Gold', `Need ${cost} gold`, 'error');
                return;
            }
            game.player.gold -= cost;
            tile.playerProperty.gamblingTables = tables + 1;
            game.ui.showNotification('🎲 Table Added!', `Gambling table installed! (${tables + 1}/${maxTables}) — +15% daily income`, 'success');
            game.ui.updateStats(game.player, game.world);
            ActionMenu.showManagePropertyMenu(game, tile);
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
                        <button onclick="window.sendStorageCaravan(${s.q}, ${s.r})" style="padding:6px 12px; font-size:11px; background:linear-gradient(135deg, var(--gold-dark), var(--gold)); border:none; border-radius:3px; cursor:pointer; font-weight:bold; color:#1a1207; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                            Send
                        </button>
                    </div>
                `;
                count++;
            }
        }

        // Add the player's processing buildings (workshops, mills, bakeries, ...)
        const playerWorkshops = game.player.properties.filter(p => {
            const t = game.world.getTile(p.q, p.r);
            return PlayerEconomy.isRecipeBuilding(p.type) && PlayerEconomy.findPropertyAt(t, p.type);
        });

        const producedGood = tile.playerProperty.produces;

        for (const ws of playerWorkshops) {
            // Don't ship to self
            if (ws.q === tile.q && ws.r === tile.r) continue;

            const wsTile = game.world.getTile(ws.q, ws.r);
            const wsProp = PlayerEconomy.findPropertyAt(wsTile, ws.type);

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
                            <div style="font-weight:bold; color:#aaddff;">${wsProp.icon || ''} ${wsProp.name}</div>
                            <div style="display:flex; gap:12px; margin-top:2px;">
                                <div style="font-size:10px; color:var(--text-secondary);">📏 ${dist} hexes</div>
                                <div style="font-size:10px; color:#aaddff;">📦 Internal Transfer</div>
                            </div>
                        </div>
                        <button onclick="window.sendStorageCaravan(${ws.q}, ${ws.r}, '${ws.type}')" style="padding:6px 12px; font-size:11px; background:#3498db; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
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
        const goods = Trading.getAvailableGoods(tile.settlement, tile, game.world);
        const playerGold = game.player.gold || 0;
        const settlementName = tile.settlement?.name || 'Market';
        const settlementType = tile.settlement?.type || 'village';

        // ── Categorise goods ──
        const CATEGORIES = {
            food:      { label: 'Food & Drink', icon: '🍞', keys: new Set(['grain','flour','bread','fish','preserved_fish','beer','liquor','meat','berries','mushrooms','small_fish','large_fish','crab','swordfish','lobster','golden_fish','cheese','dried_meat','honey','salt','tea','wine']) },
            materials: { label: 'Materials',     icon: '⛏️', keys: new Set(['wood','firewood','stone','iron','ore','wool','hide','pelts','rope','candles','dyes','incense','pottery','lantern','arrows','compass']) },
            crafted:   { label: 'Crafted Goods', icon: '🔧', keys: new Set(['tools','weapons','textiles','clothes','agri_parts','industry_parts','military_parts','infra_parts','commerce_parts','leather_armor','shield','bow']) },
            luxury:    { label: 'Luxury & Rare', icon: '💎', keys: new Set(['luxuries','gems','gold_ore','spices','exotic_spices','silk','perfume','horses','horse','herbs','antler','feather','healing_salve','potion','elixir','treasure_map','ancient_coin','rare_book','amulet','enchanted_ring']) },
        };
        function getCat(id) {
            for (const [cat, def] of Object.entries(CATEGORIES)) { if (def.keys.has(id)) return cat; }
            return 'materials';
        }
        const grouped = {};
        for (const g of goods) {
            const cat = getCat(g.id);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(g);
        }

        // ── Build sell list from player inventory ──
        const sellItems = [];
        if (game.player.inventory) {
            for (const [goodId, quantity] of Object.entries(game.player.inventory)) {
                if (quantity <= 0) continue;
                const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                if (!good) continue;
                const sellPrice = Math.floor(good.basePrice * 0.7);
                sellItems.push({ ...good, quantity, sellPrice });
            }
        }

        // ── Render HTML ──
        let html = `
        <style>
            .trade-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
            .trade-purse { display:flex; align-items:center; gap:6px; font-size:15px; font-weight:700; color:var(--gold); font-family:var(--font-display); }
            .trade-tabs { display:flex; gap:0; border-bottom:2px solid rgba(245,197,66,0.15); margin-bottom:12px; }
            .trade-tab { padding:7px 16px; font-size:12px; font-weight:600; color:rgba(255,255,255,0.45); background:none; border:none;
                         border-bottom:2px solid transparent; cursor:pointer; font-family:var(--font-display); letter-spacing:0.5px;
                         transition:all .15s; margin-bottom:-2px; }
            .trade-tab:hover { color:rgba(255,255,255,0.7); }
            .trade-tab.active { color:var(--gold); border-bottom-color:var(--gold); }
            .trade-section { display:none; }
            .trade-section.active { display:block; }
            .trade-cat { margin-bottom:14px; }
            .trade-cat-header { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; color:rgba(255,255,255,0.35);
                                text-transform:uppercase; letter-spacing:1px; padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.06); margin-bottom:6px; }
            .trade-row { display:grid; grid-template-columns:36px 1fr auto auto; gap:8px; align-items:center; padding:6px 8px;
                         border-radius:6px; transition:background .12s; }
            .trade-row:hover { background:rgba(245,197,66,0.06); }
            .trade-row.sold-out { opacity:0.35; pointer-events:none; }
            .trade-icon { font-size:22px; text-align:center; }
            .trade-name { font-size:13px; font-weight:600; color:var(--text-primary); }
            .trade-meta { font-size:11px; color:var(--text-secondary); }
            .trade-price { font-size:13px; font-weight:700; color:var(--gold); white-space:nowrap; text-align:right; min-width:70px; }
            .trade-price .trade-qty { font-weight:400; font-size:11px; color:rgba(255,255,255,0.4); display:block; }
            .trade-btn { padding:4px 14px; border:none; border-radius:5px; font-size:12px; font-weight:700; cursor:pointer;
                         font-family:var(--font-body); transition:all .15s; white-space:nowrap; }
            .trade-btn-buy { background:linear-gradient(180deg,rgba(245,197,66,0.9),rgba(200,155,30,0.95)); color:#1a1a2e; }
            .trade-btn-buy:hover { background:linear-gradient(180deg,rgba(255,210,80,1),rgba(220,170,40,1)); transform:scale(1.04); }
            .trade-btn-sell { background:linear-gradient(180deg,rgba(46,204,113,0.85),rgba(39,174,96,0.9)); color:#fff; }
            .trade-btn-sell:hover { background:linear-gradient(180deg,rgba(56,220,130,1),rgba(46,200,110,1)); transform:scale(1.04); }
            .trade-sold-out { font-size:11px; color:rgba(231,76,60,0.7); font-weight:600; white-space:nowrap; }
            .trade-empty { text-align:center; padding:20px; color:var(--text-secondary); font-size:13px; }
            .trade-settlement-badge { font-size:11px; color:rgba(255,255,255,0.35); font-weight:400; }
        </style>

        <div class="trade-header">
            <div>
                <span style="font-size:13px;color:var(--text-secondary);">Trading at</span>
                <span style="font-size:14px;font-weight:700;color:var(--text-primary);margin-left:4px;">${settlementName}</span>
                <span class="trade-settlement-badge">(${settlementType})</span>
            </div>
            <div class="trade-purse">💰 ${playerGold.toLocaleString()} gold</div>
        </div>

        <div class="trade-tabs">
            <button class="trade-tab active" data-trade-tab="buy">🛒 Buy</button>
            <button class="trade-tab" data-trade-tab="sell">💰 Sell</button>
        </div>

        <!-- BUY SECTION -->
        <div class="trade-section active" data-trade-section="buy">`;

        const catOrder = ['food','materials','crafted','luxury'];
        let hasBuyGoods = false;
        for (const cat of catOrder) {
            const items = grouped[cat];
            if (!items || items.length === 0) continue;
            hasBuyGoods = true;
            const def = CATEGORIES[cat];
            html += `<div class="trade-cat">
                <div class="trade-cat-header">${def.icon} ${def.label}</div>`;
            for (const good of items) {
                const isSoldOut = good.quantity <= 0;
                const canAfford = playerGold >= good.price;
                html += `<div class="trade-row ${isSoldOut ? 'sold-out' : ''}">
                    <span class="trade-icon">${good.icon}</span>
                    <div>
                        <div class="trade-name">${good.name}</div>
                    </div>
                    <div class="trade-price">${isSoldOut ? '' : good.price + ' 💰'}
                        <span class="trade-qty">${isSoldOut ? '' : good.quantity + ' avail.'}</span>
                    </div>
                    <div>${isSoldOut
                        ? '<span class="trade-sold-out">Sold Out</span>'
                        : `<button class="trade-btn trade-btn-buy ${canAfford ? '' : 'trade-btn-disabled'}" onclick="window._tradeBuy('${good.id}', ${good.price}, ${good.quantity})">Buy</button>`
                    }</div>
                </div>`;
            }
            html += '</div>';
        }
        if (!hasBuyGoods) {
            html += '<div class="trade-empty">No goods available at this market.</div>';
        }

        html += `</div>

        <!-- SELL SECTION -->
        <div class="trade-section" data-trade-section="sell">`;

        if (sellItems.length > 0) {
            for (const item of sellItems) {
                html += `<div class="trade-row">
                    <span class="trade-icon">${item.icon}</span>
                    <div>
                        <div class="trade-name">${item.name}</div>
                        <div class="trade-meta">You have: ${item.quantity}</div>
                    </div>
                    <div class="trade-price" style="color:#2ecc71;">${item.sellPrice} 💰
                        <span class="trade-qty">per unit</span>
                    </div>
                    <div>
                        <button class="trade-btn trade-btn-sell" onclick="window._tradeSell('${item.id}', ${item.sellPrice}, ${item.quantity})">Sell</button>
                    </div>
                </div>`;
            }
        } else {
            html += '<div class="trade-empty">You have no goods to sell.</div>';
        }

        html += '</div>';

        game.ui.showCustomPanel(`🏪 Trade — ${settlementName}`, html);

        // ── Tab switching ──
        setTimeout(() => {
            const tabs = document.querySelectorAll('[data-trade-tab]');
            const sections = document.querySelectorAll('[data-trade-section]');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    tabs.forEach(t => t.classList.remove('active'));
                    sections.forEach(s => s.classList.remove('active'));
                    tab.classList.add('active');
                    const target = tab.getAttribute('data-trade-tab');
                    const sec = document.querySelector(`[data-trade-section="${target}"]`);
                    if (sec) sec.classList.add('active');
                });
            });
        }, 50);

        // ── Buy / Sell handlers ──
        window.currentTile = tile;
        window._tradeBuy = (goodId, price, maxQty) => {
            ActionMenu.showQuantityInput(`Buy ${PlayerEconomy.GOODS[goodId.toUpperCase()]?.name || goodId}`, maxQty, (qty) => {
                const good = goods.find(g => g.id === goodId);
                if (good) {
                    if (!ActionMenu.commitPendingAP(game)) return;
                    const result = Trading.buyGoods(game.player, good, qty, tile.settlement);
                    if (result.success) {
                        game.ui.showNotification('Purchase Complete', `Bought ${qty}x ${good.name} for ${result.spent} gold`, 'success');
                        if (tile.settlement.kingdom) {
                            game.player.learnAboutKingdom(tile.settlement.kingdom, 'economy');
                        }
                        if (typeof Titles !== 'undefined' && game.player.currentTitle === 'trade_envoy' &&
                            tile.settlement.kingdom && tile.settlement.kingdom !== game.player.allegiance) {
                            const tradeResult = Titles.recordTradeMission(game.player);
                            if (tradeResult) {
                                game.ui.showNotification('📦 Trade Mission!', `Envoy duty complete (+${tradeResult.gold} gold bonus). Missions: ${tradeResult.count}`, 'success');
                            }
                        }
                        game.ui.updateStats(game.player, game.world);
                        ActionMenu.showTradeMenu(game, tile);
                    } else {
                        game.ui.showNotification('Cannot Buy', result.reason, 'error');
                    }
                }
            });
        };

        window._tradeSell = (goodId, price, maxQty) => {
            ActionMenu.showQuantityInput(`Sell ${PlayerEconomy.GOODS[goodId.toUpperCase()]?.name || goodId}`, maxQty, (qty) => {
                if (!ActionMenu.commitPendingAP(game)) return;
                const result = Trading.sellGoods(game.player, goodId, qty, tile.settlement);
                if (result.success) {
                    const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                    game.ui.showNotification('Sale Complete', `Sold ${qty}x ${good.name} for ${result.earned} gold`, 'success');
                    if (tile.settlement.kingdom) {
                        game.player.learnAboutKingdom(tile.settlement.kingdom, 'economy');
                    }
                    game.ui.updateStats(game.player, game.world);
                    ActionMenu.showTradeMenu(game, tile);
                } else {
                    game.ui.showNotification('Cannot Sell', result.reason, 'error');
                }
            });
        };
    },

    /**
     * Show NPC personal trade menu (merchants, travelers, blacksmiths)
     * Uses the NPC's shopInventory instead of the settlement market.
     */
    showNpcTradeMenu(game, npc) {
        if (!npc || !npc.shopInventory) {
            game.ui.showNotification('No Goods', `${npc?.name || 'This person'} has nothing to trade.`, 'info');
            return;
        }

        // Disposition & personality set this trader's prices (both ways)
        const priceMods = NpcDisposition.getPriceModifiers(npc);
        if (priceMods.refuses) {
            game.ui.showNotification('🚫 No Deal', priceMods.refuseReason, 'warning');
            return;
        }

        const playerGold = game.player.gold || 0;
        const npcName = npc.name || 'Trader';
        const npcIcon = npc.icon || '🧑';
        const npcType = npc.type || 'merchant';

        const TYPE_LABELS = {
            merchant: 'Merchant',
            traveler: 'Traveling Trader',
            blacksmith_npc: 'Blacksmith',
        };
        const typeLabel = TYPE_LABELS[npcType] || 'Trader';

        // Build goods list from NPC inventory
        const CATEGORIES = {
            food:      { label: 'Food & Drink',   icon: '🍞', keys: new Set(['grain','flour','bread','fish','preserved_fish','beer','liquor','meat','berries','mushrooms','cheese','dried_meat','honey','salt','tea','wine']) },
            materials: { label: 'Materials',       icon: '⛏️', keys: new Set(['wood','firewood','stone','iron','ore','wool','hide','pelts','rope','candles','dyes','incense','pottery','lantern','arrows','compass']) },
            crafted:   { label: 'Equipment',       icon: '⚔️', keys: new Set(['tools','weapons','textiles','clothes','leather_armor','shield','bow','agri_parts','industry_parts','military_parts','infra_parts','commerce_parts']) },
            rare:      { label: 'Exotic & Rare',   icon: '✨', keys: new Set(['luxuries','gems','gold_ore','spices','exotic_spices','silk','perfume','horses','horse','herbs','antler','feather','healing_salve','potion','elixir','treasure_map','ancient_coin','rare_book','amulet','enchanted_ring']) },
        };
        function getCat(id) {
            for (const [cat, def] of Object.entries(CATEGORIES)) { if (def.keys.has(id)) return cat; }
            return 'materials';
        }

        // Resolve inventory items
        const shopGoods = [];
        for (const [itemId, data] of Object.entries(npc.shopInventory)) {
            const goodDef = PlayerEconomy.GOODS[itemId.toUpperCase()] || Object.values(PlayerEconomy.GOODS).find(g => g.id === itemId);
            if (!goodDef || data.qty <= 0) continue;
            const price = NpcDisposition.buyPrice(npc, goodDef.basePrice * (data.markup || 1));
            shopGoods.push({ ...goodDef, quantity: data.qty, price, _itemId: itemId });
        }

        // Group by category
        const grouped = {};
        for (const g of shopGoods) {
            const cat = getCat(g.id);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(g);
        }

        // Build sell list from player inventory
        const sellItems = [];
        if (game.player.inventory) {
            for (const [goodId, quantity] of Object.entries(game.player.inventory)) {
                if (quantity <= 0) continue;
                const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                if (!good) continue;
                const sellPrice = NpcDisposition.sellPrice(npc, good.basePrice * 0.65);
                sellItems.push({ ...good, quantity, sellPrice });
            }
        }

        // ── Render ──
        let html = `
        <style>
            .npc-trade-header { display:flex; align-items:center; gap:12px; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid rgba(245,197,66,0.12); }
            .npc-trade-portrait { font-size:36px; width:48px; height:48px; display:flex; align-items:center; justify-content:center;
                background:rgba(245,197,66,0.08); border:1px solid rgba(245,197,66,0.2); border-radius:10px; }
            .npc-trade-info { flex:1; }
            .npc-trade-name { font-size:16px; font-weight:700; color:var(--text-primary); font-family:var(--font-display); }
            .npc-trade-type { font-size:11px; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:1px; }
            .npc-trade-purse { font-size:15px; font-weight:700; color:var(--gold); font-family:var(--font-display); white-space:nowrap; }
            .npc-trade-tabs { display:flex; gap:0; border-bottom:2px solid rgba(245,197,66,0.15); margin-bottom:12px; }
            .npc-trade-tab { padding:7px 16px; font-size:12px; font-weight:600; color:rgba(255,255,255,0.45); background:none; border:none;
                             border-bottom:2px solid transparent; cursor:pointer; font-family:var(--font-display); letter-spacing:0.5px;
                             transition:all .15s; margin-bottom:-2px; }
            .npc-trade-tab:hover { color:rgba(255,255,255,0.7); }
            .npc-trade-tab.active { color:var(--gold); border-bottom-color:var(--gold); }
            .npc-trade-section { display:none; }
            .npc-trade-section.active { display:block; }
            .npc-cat { margin-bottom:14px; }
            .npc-cat-hdr { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; color:rgba(255,255,255,0.35);
                           text-transform:uppercase; letter-spacing:1px; padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.06); margin-bottom:6px; }
            .npc-row { display:grid; grid-template-columns:36px 1fr auto auto; gap:8px; align-items:center; padding:6px 8px; border-radius:6px; transition:background .12s; }
            .npc-row:hover { background:rgba(245,197,66,0.06); }
            .npc-row.out { opacity:0.35; pointer-events:none; }
            .npc-ico { font-size:22px; text-align:center; }
            .npc-gname { font-size:13px; font-weight:600; color:var(--text-primary); }
            .npc-gmeta { font-size:11px; color:var(--text-secondary); }
            .npc-gprice { font-size:13px; font-weight:700; color:var(--gold); white-space:nowrap; text-align:right; min-width:65px; }
            .npc-gprice .npc-qty { font-weight:400; font-size:11px; color:rgba(255,255,255,0.4); display:block; }
            .npc-btn { padding:4px 14px; border:none; border-radius:5px; font-size:12px; font-weight:700; cursor:pointer; font-family:var(--font-body); transition:all .15s; white-space:nowrap; }
            .npc-btn-buy { background:linear-gradient(180deg,rgba(245,197,66,0.9),rgba(200,155,30,0.95)); color:#1a1a2e; }
            .npc-btn-buy:hover { background:linear-gradient(180deg,rgba(255,210,80,1),rgba(220,170,40,1)); transform:scale(1.04); }
            .npc-btn-sell { background:linear-gradient(180deg,rgba(46,204,113,0.85),rgba(39,174,96,0.9)); color:#fff; }
            .npc-btn-sell:hover { background:linear-gradient(180deg,rgba(56,220,130,1),rgba(46,200,110,1)); transform:scale(1.04); }
            .npc-empty { text-align:center; padding:20px; color:var(--text-secondary); font-size:13px; }
        </style>

        <div class="npc-trade-header">
            <div class="npc-trade-portrait">${npcIcon}</div>
            <div class="npc-trade-info">
                <div class="npc-trade-name">${npcName}</div>
                <div class="npc-trade-type">${typeLabel}</div>
            </div>
            <div class="npc-trade-purse">💰 ${playerGold.toLocaleString()}</div>
        </div>
        ${priceMods.reasons.length > 0 ? `<div style="font-size:11px; margin:-6px 0 10px; color:${priceMods.pct > 0 ? '#ff8a65' : priceMods.pct < 0 ? '#66bb6a' : 'var(--text-secondary)'};"
            title="Disposition and personality change what this trader charges and pays">
            🏷️ Prices ${priceMods.pct > 0 ? '+' : ''}${priceMods.pct}% · ${priceMods.reasons.map(r => `${r.label} ${r.pct > 0 ? '+' : ''}${r.pct}%`).join(', ')}
        </div>` : ''}

        <div class="npc-trade-tabs">
            <button class="npc-trade-tab active" data-npc-tab="buy">🛒 Buy</button>
            <button class="npc-trade-tab" data-npc-tab="sell">💰 Sell to ${npcName}</button>
        </div>

        <div class="npc-trade-section active" data-npc-section="buy">`;

        const catOrder = ['food','materials','crafted','rare'];
        let hasGoods = false;
        for (const cat of catOrder) {
            const items = grouped[cat];
            if (!items || items.length === 0) continue;
            hasGoods = true;
            const def = CATEGORIES[cat];
            html += `<div class="npc-cat"><div class="npc-cat-hdr">${def.icon} ${def.label}</div>`;
            for (const good of items) {
                const canAfford = playerGold >= good.price;
                html += `<div class="npc-row">
                    <span class="npc-ico">${good.icon}</span>
                    <div><div class="npc-gname">${good.name}</div></div>
                    <div class="npc-gprice">${good.price} 💰<span class="npc-qty">${good.quantity} avail.</span></div>
                    <div><button class="npc-btn npc-btn-buy" onclick="window._npcBuy('${good._itemId}',${good.price},${good.quantity})">Buy</button></div>
                </div>`;
            }
            html += '</div>';
        }
        if (!hasGoods) html += '<div class="npc-empty">This trader has nothing left to sell.</div>';

        html += `</div><div class="npc-trade-section" data-npc-section="sell">`;

        if (sellItems.length > 0) {
            for (const item of sellItems) {
                html += `<div class="npc-row">
                    <span class="npc-ico">${item.icon}</span>
                    <div>
                        <div class="npc-gname">${item.name}</div>
                        <div class="npc-gmeta">You have: ${item.quantity}</div>
                    </div>
                    <div class="npc-gprice" style="color:#2ecc71;">${item.sellPrice} 💰<span class="npc-qty">per unit</span></div>
                    <div><button class="npc-btn npc-btn-sell" onclick="window._npcSell('${item.id}',${item.sellPrice},${item.quantity})">Sell</button></div>
                </div>`;
            }
        } else {
            html += '<div class="npc-empty">You have no goods to sell.</div>';
        }

        html += '</div>';

        game.ui.showCustomPanel(`${npcIcon} ${npcName} — ${typeLabel}`, html);

        // Tab switching
        setTimeout(() => {
            const tabs = document.querySelectorAll('[data-npc-tab]');
            const sections = document.querySelectorAll('[data-npc-section]');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    tabs.forEach(t => t.classList.remove('active'));
                    sections.forEach(s => s.classList.remove('active'));
                    tab.classList.add('active');
                    const sec = document.querySelector(`[data-npc-section="${tab.getAttribute('data-npc-tab')}"]`);
                    if (sec) sec.classList.add('active');
                });
            });
        }, 50);

        // Buy handler — deducts from NPC's shopInventory
        window._npcBuy = (itemId, price, maxQty) => {
            const goodDef = PlayerEconomy.GOODS[itemId.toUpperCase()] || Object.values(PlayerEconomy.GOODS).find(g => g.id === itemId);
            const displayName = goodDef ? goodDef.name : itemId;
            ActionMenu.showQuantityInput(`Buy ${displayName}`, maxQty, (qty) => {
                const totalCost = price * qty;
                if (game.player.gold < totalCost) {
                    game.ui.showNotification('Not Enough Gold', `You need ${totalCost} gold but only have ${game.player.gold}.`, 'error');
                    return;
                }
                if (!PlayerInventory.canAdd(game.player, itemId)) {
                    game.ui.showNotification('🎒 Inventory Full', PlayerInventory.fullMessage(game.player), 'error');
                    return;
                }
                // Deduct gold, add to player inventory, reduce NPC stock
                game.player.gold -= totalCost;
                PlayerInventory.addItem(game.player, itemId, qty);
                npc.shopInventory[itemId].qty -= qty;
                if (npc.shopInventory[itemId].qty <= 0) delete npc.shopInventory[itemId];
                game.ui.showNotification('Purchase Complete', `Bought ${qty}x ${displayName} for ${totalCost} gold`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showNpcTradeMenu(game, npc);
            });
        };

        // Sell handler — gives gold to player, NPC absorbs item
        window._npcSell = (goodId, sellPrice, maxQty) => {
            const goodDef = PlayerEconomy.GOODS[goodId.toUpperCase()];
            const displayName = goodDef ? goodDef.name : goodId;
            ActionMenu.showQuantityInput(`Sell ${displayName}`, maxQty, (qty) => {
                const totalEarned = sellPrice * qty;
                // Remove from player inventory
                if (!game.player.inventory || (game.player.inventory[goodId] || 0) < qty) {
                    game.ui.showNotification('Cannot Sell', 'You don\'t have enough of this item.', 'error');
                    return;
                }
                game.player.inventory[goodId] -= qty;
                if (game.player.inventory[goodId] <= 0) delete game.player.inventory[goodId];
                game.player.gold += totalEarned;
                game.ui.showNotification('Sale Complete', `Sold ${qty}x ${displayName} for ${totalEarned} gold`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showNpcTradeMenu(game, npc);
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
        const settlement = tile.settlement;
        const capacity = PlayerMilitary.getRecruitmentCapacity(settlement);
        const recruited = game.player._recruitedThisTurn || 0;
        const remaining = Math.max(0, capacity - recruited);

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Recruit Units</h4>';
        html += `<p style="color: var(--text-secondary); font-size: 12px;">Your army strength: ${PlayerMilitary.getArmyStrength(game.player)}</p>`;
        html += `<div style="padding: 6px 10px; margin-bottom: 12px; background: rgba(255,255,255,0.06); border-radius: 4px; font-size: 12px;">
            <span style="color: var(--text-secondary);">${settlement.name}</span> — 
            <strong>${settlement.type}</strong> (pop: ${settlement.population.toLocaleString()}) — 
            Recruits available: <strong style="color: ${remaining > 0 ? '#4CAF50' : '#e74c3c'};">${remaining}/${capacity}</strong>
        </div>`;
        const peoplesRecruit = Peoples.recruitModifiers(settlement);
        if (Math.abs(peoplesRecruit.martial) >= 0.005) {
            const pct = Math.round(peoplesRecruit.martial * 100);
            const costPct = Math.round((1 - peoplesRecruit.costMult) * 100);
            html += `<div style="padding: 4px 10px; margin: -8px 0 12px; font-size: 11px; color: ${pct > 0 ? '#81c784' : '#e57373'};" title="From the values, traits and status of the peoples living here">⚔️ Martial peoples: ${pct > 0 ? '+' : ''}${pct}% recruits, ${costPct >= 0 ? '−' : '+'}${Math.abs(costPct)}% recruit cost</div>`;
        }

        for (const [key, unit] of Object.entries(PlayerMilitary.UNIT_TYPES)) {
            const avail = PlayerMilitary.isUnitAvailable(unit, settlement);
            if (avail.available) {
                html += `
                    <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div><span style="font-size: 20px;">${unit.icon}</span> <strong>${unit.name}</strong></div>
                                <div style="font-size: 12px; color: var(--text-secondary);">${unit.description}</div>
                                <div style="font-size: 12px;">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>${PlayerMilitary.describeUnitTraits(unit) ? `<div style="font-size: 11px; color: #ce93d8;">✨ ${PlayerMilitary.describeUnitTraits(unit)}</div>` : ''}
                            </div>
                            <button onclick="window.recruitUnit('${key}')" ${remaining <= 0 ? 'disabled' : ''} style="padding: 8px 16px; background: ${remaining > 0 ? 'var(--gold)' : '#555'}; border: none; border-radius: 4px; cursor: ${remaining > 0 ? 'pointer' : 'not-allowed'};">${PlayerMilitary.getRecruitCost(game.player, unit, tile.settlement)} gold</button>
                        </div>
                    </div>
                `;
            } else {
                html += `
                    <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.02); border-radius: 4px; opacity: 0.4;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div><span style="font-size: 20px;">${unit.icon}</span> <strong>${unit.name}</strong> \ud83d\udd12</div>
                                <div style="font-size: 11px; color: #e74c3c;">${avail.reason}</div>
                                <div style="font-size: 12px; color: var(--text-secondary);">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>${PlayerMilitary.describeUnitTraits(unit) ? `<div style="font-size: 11px; color: #ce93d8;">✨ ${PlayerMilitary.describeUnitTraits(unit)}</div>` : ''}
                            </div>
                            <span style="color: var(--text-secondary); font-size: 12px;">${PlayerMilitary.getRecruitCost(game.player, unit, tile.settlement)} gold</span>
                        </div>
                    </div>
                `;
            }
        }

        // Tech-unlocked units
        if (typeof Technology !== 'undefined') {
            for (const [key, unit] of Object.entries(Technology.TECH_UNITS)) {
                if (!unit.requiredTech || !Technology.isImplemented(game.player, unit.requiredTech)) continue;

                const techAvail = PlayerMilitary.isTechUnitAvailable(unit, settlement);
                if (techAvail.available) {
                    html += `
                        <div style="padding: 12px; margin-bottom: 8px; background: rgba(156, 39, 176, 0.06); border: 1px solid rgba(156, 39, 176, 0.2); border-radius: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div><span style="font-size: 20px;">${unit.icon}</span> <strong>${unit.name}</strong> <span style="font-size: 10px; color: #ce93d8;">TECH</span></div>
                                    <div style="font-size: 12px; color: var(--text-secondary);">${unit.description}</div>
                                    <div style="font-size: 12px;">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>${PlayerMilitary.describeUnitTraits(unit) ? `<div style="font-size: 11px; color: #ce93d8;">✨ ${PlayerMilitary.describeUnitTraits(unit)}</div>` : ''}
                                </div>
                                <button onclick="window.recruitTechUnit('${key}')" ${remaining <= 0 ? 'disabled' : ''} style="padding: 8px 16px; background: ${remaining > 0 ? 'var(--gold)' : '#555'}; border: none; border-radius: 4px; cursor: ${remaining > 0 ? 'pointer' : 'not-allowed'};">${PlayerMilitary.getRecruitCost(game.player, unit, tile.settlement)} gold</button>
                            </div>
                        </div>
                    `;
                } else {
                    html += `
                        <div style="padding: 12px; margin-bottom: 8px; background: rgba(156, 39, 176, 0.02); border-radius: 4px; opacity: 0.4;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div><span style="font-size: 20px;">${unit.icon}</span> <strong>${unit.name}</strong> <span style="font-size: 10px; color: #ce93d8;">TECH</span> \ud83d\udd12</div>
                                    <div style="font-size: 11px; color: #e74c3c;">${techAvail.reason}</div>
                                    <div style="font-size: 12px; color: var(--text-secondary);">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>${PlayerMilitary.describeUnitTraits(unit) ? `<div style="font-size: 11px; color: #ce93d8;">✨ ${PlayerMilitary.describeUnitTraits(unit)}</div>` : ''}
                                </div>
                                <span style="color: var(--text-secondary); font-size: 12px;">${PlayerMilitary.getRecruitCost(game.player, unit, tile.settlement)} gold</span>
                            </div>
                        </div>
                    `;
                }
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Recruit', html);

        window.recruitUnit = (unitType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
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
            if (!ActionMenu.commitPendingAP(game)) return;
            const unit = Technology.TECH_UNITS[unitKey];
            if (!unit) return;

            // Check settlement availability
            const techAvail = PlayerMilitary.isTechUnitAvailable(unit, tile.settlement);
            if (!techAvail.available) {
                game.ui.showNotification('Cannot Recruit', techAvail.reason, 'error');
                return;
            }

            // Check recruitment capacity
            const cap = PlayerMilitary.getRecruitmentCapacity(tile.settlement);
            const rec = game.player._recruitedThisTurn || 0;
            if (rec >= cap) {
                game.ui.showNotification('Cannot Recruit', `This settlement can only supply ${cap} recruit${cap > 1 ? 's' : ''} right now`, 'error');
                return;
            }

            const techCost = PlayerMilitary.getRecruitCost(game.player, unit, tile.settlement);
            if (game.player.gold < techCost) {
                game.ui.showNotification('Cannot Recruit', `Need ${techCost} gold`, 'error');
                return;
            }

            game.player.gold -= techCost;
            game.player._recruitedThisTurn = (game.player._recruitedThisTurn || 0) + 1;
            if (!game.player.army) game.player.army = [];
            game.player.army.push(PlayerMilitary.makeArmyUnit(unit));

            game.player.skills.combat = Math.min(10, game.player.skills.combat + 0.3);
            game.ui.showNotification('Unit Recruited!', `${unit.name} joined your army`, 'success');
            game.ui.updateStats(game.player, game.world);
            ActionMenu.showRecruitMenu(game, tile);
        };
    },

    /**
     * Show legendary artifact reforging menu
     */
    showReforgeArtifactMenu(game, tile) {
        if (typeof LegendaryArtifacts === 'undefined') {
            game.ui.showNotification('Unavailable', 'Legendary artifact system is not loaded.', 'error');
            return;
        }

        LegendaryArtifacts.initialize(game.player);
        const artifactProgress = LegendaryArtifacts.getProgress(game.player);

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Legendary Artifacts</h4>';
        html += '<p style="color: var(--text-secondary); font-size: 12px;">Artifacts are reforged from fragments recovered at ruins, caves, and monuments.</p>';

        if (artifactProgress.length === 0) {
            html += '<div style="color: var(--text-secondary); font-size: 12px;">No artifact records found.</div>';
        } else {
            for (const artifact of artifactProgress) {
                const canReforge = artifact.isForgeable;
                const status = artifact.isForged
                    ? 'Reforged'
                    : `${artifact.fragmentsOwned}/${artifact.fragmentsRequired} Fragments`;
                const statusColor = artifact.isForged ? '#2ecc71' : canReforge ? '#f1c40f' : 'var(--text-secondary)';

                html += `
                    <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; ${artifact.isForged ? 'opacity: 0.75;' : ''}">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                            <div>
                                <div><span style="font-size: 20px;">${artifact.icon}</span> <strong>${artifact.name}</strong></div>
                                <div style="font-size: 12px; color: var(--text-secondary);">${artifact.description}</div>
                                ${artifact.passiveText ? `<div style="font-size: 11px; color: #e6b35c; margin-top: 3px;">✦ ${artifact.passiveText}${artifact.isForged ? '' : ' (once reforged)'}</div>` : ''}
                                <div style="font-size: 11px; color: ${statusColor}; margin-top: 3px;">${status}</div>
                            </div>
                            <button onclick="window.reforgeArtifact('${artifact.id}')" ${(!canReforge || artifact.isForged) ? 'disabled' : ''}
                                style="padding: 8px 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; min-width: 92px;">
                                Reforge
                            </button>
                        </div>
                    </div>
                `;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Artifact Forge', html);

        window.reforgeArtifact = (artifactId) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = LegendaryArtifacts.reforgeArtifact(game.player, artifactId);
            if (result.success) {
                const artifact = result.artifact;
                game.ui.showNotification('Artifact Reforged!', `${artifact.icon} ${artifact.name} has been restored to glory.`, 'success');
                if (typeof Quests !== 'undefined') {
                    Quests.generateAvailableQuests(game.player);
                }
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showReforgeArtifactMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Reforge', result.reason, 'error');
            }
        };
    },

    /**
     * Show contract menu
     */
    showContractMenu(game, tile) {
        const armyStrength = PlayerMilitary.getArmyStrength(game.player);
        const offers = PlayerMilitary.getMercenaryOffers(game.player, tile, game.world);
        const activeCompanies = game.player.mercenaryCompanies || [];

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Mercenary Contracts</h4>';
        html += `<p style="color: var(--text-secondary); font-size: 12px;">Your army strength: ${armyStrength}</p>`;

        html += '<div style="margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">';
        html += '<div style="font-size: 11px; color: var(--gold); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Famous Companies for Hire</div>';

        if (offers.length === 0) {
            html += '<div style="font-size: 12px; color: var(--text-secondary); padding: 8px; background: rgba(255,255,255,0.04); border-radius: 4px;">No companies are recruiting here today.</div>';
        } else {
            for (const offer of offers) {
                const totalUnits = (offer.roster || []).reduce((sum, row) => sum + row.count, 0);
                const rosterText = (offer.roster || []).map(row => `${row.count}x ${row.type}`).join(', ');
                const canHire = game.player.gold >= offer.hireCost;
                html += `
                    <div style="padding: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; ${!canHire ? 'opacity: 0.65;' : ''}">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                            <div>
                                <div><span style="font-size: 20px;">${offer.icon}</span> <strong>${offer.name}</strong></div>
                                <div style="font-size: 12px; color: var(--text-secondary);">${offer.reputation}</div>
                                <div style="font-size: 11px; margin-top: 3px;">Roster: ${totalUnits} units (${rosterText})</div>
                                <div style="font-size: 11px; color: var(--text-secondary);">Loyalty: ${Math.floor(offer.loyalty)} | Daily Wage: ${offer.dailyWage}g | Contract: ${offer.duration} days</div>
                            </div>
                            <button onclick="window.hireMercCompany('${offer.offerId}')" ${!canHire ? 'disabled' : ''} style="padding: 8px 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; min-width: 90px;">Hire (${offer.hireCost}g)</button>
                        </div>
                    </div>
                `;
            }
        }
        html += '</div>';

        html += '<div style="margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">';
        html += '<div style="font-size: 11px; color: var(--gold); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Active Hired Companies</div>';

        if (activeCompanies.length === 0) {
            html += '<div style="font-size: 12px; color: var(--text-secondary); padding: 8px; background: rgba(255,255,255,0.04); border-radius: 4px;">You have no hired companies.</div>';
        } else {
            for (const company of activeCompanies) {
                const loyalty = Math.floor(company.loyalty || 0);
                const loyaltyColor = loyalty >= 65 ? '#2ecc71' : loyalty >= 45 ? '#f39c12' : '#e74c3c';
                html += `
                    <div style="padding: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; gap: 10px; align-items: center;">
                            <div>
                                <div><span style="font-size: 20px;">${company.icon || '⚔️'}</span> <strong>${company.name}</strong></div>
                                <div style="font-size: 11px; color: var(--text-secondary);">${company.reputation || 'Professional mercenary company'}</div>
                                <div style="font-size: 11px; color: ${loyaltyColor};">Loyalty: ${loyalty} | Wage: ${company.dailyWage}g/day | Days Left: ${company.daysRemaining}</div>
                            </div>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end;">
                                <button onclick="window.payMercBonus('${company.id}')" style="padding: 6px 10px; background: rgba(46, 204, 113, 0.85); border: none; border-radius: 4px; cursor: pointer;">+ Loyalty (120g)</button>
                                <button onclick="window.dismissMercCompany('${company.id}')" style="padding: 6px 10px; background: rgba(231, 76, 60, 0.85); border: none; border-radius: 4px; cursor: pointer; color: #fff;">Dismiss</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
        html += '</div>';

        html += '<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px;">Low loyalty companies can defect if rival kingdoms outbid you.</div>';

        html += '<div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px; margin-top: 6px;">';
        html += '<div style="font-size: 11px; color: var(--gold); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">Take Mercenary Work</div>';

        for (const [key, contract] of Object.entries(PlayerMilitary.CONTRACT_TYPES)) {
            const canAccept = armyStrength >= contract.minStrength;
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

        html += '</div>';
        game.ui.showCustomPanel('Contracts', html);

        window.hireMercCompany = (offerId) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerMilitary.hireMercenaryCompany(game.player, tile, offerId, game.world);
            if (result.success) {
                const company = result.company;
                game.ui.showNotification('Mercenaries Hired!', `${company.icon} ${company.name} joined your banner`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showContractMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Hire', result.reason, 'error');
            }
        };

        window.payMercBonus = (companyId) => {
            const result = PlayerMilitary.payMercenaryBonus(game.player, companyId, 120);
            if (result.success) {
                game.ui.showNotification('Bonus Paid', `+${result.loyaltyGain} loyalty to ${result.company.name}`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showContractMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Pay Bonus', result.reason, 'error');
            }
        };

        window.dismissMercCompany = (companyId) => {
            const result = PlayerMilitary.dismissMercenaryCompany(game.player, companyId);
            if (result.success) {
                game.ui.showNotification('Company Dismissed', `${result.company.name} was released (${result.unitsRemoved} units left)`, 'default');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showContractMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Dismiss', result.reason, 'error');
            }
        };

        window.acceptContract = (contractType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerMilitary.acceptContract(game.player, contractType, tile.settlement);
            if (result.success) {
                game.ui.showNotification('Contract Accepted!', `${result.contract.name} - ${result.contract.daysRemaining} days remaining`, 'success');
                ActionMenu.close();
            } else {
                game.ui.showNotification('Cannot Accept', result.reason, 'error');
            }
        };
    },
});
