// ActionMenu — houseShips methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader } from './_imports.js';

Object.assign(ActionMenu, {
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
            html += `<span>💰 ${ht.maintenanceCost}g/day upkeep</span>`;
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
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = Housing.buyHouse(player, tile.q, tile.r, typeId, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('🏠 New Home!', result.message, 'success');
                game.ui.updateStats(player, game.world);
                // Refresh inner map building ownership so house is immediately marked as Yours
                if (typeof InnerMap !== 'undefined' && InnerMap.active && InnerMap.buildings) {
                    // Clear previous player-owned flags to avoid duplicate '(Yours)' labels
                    for (const b of InnerMap.buildings) {
                        if (b.isPlayerOwned) {
                            b.isPlayerOwned = false;
                            if (b.name && b.name.includes(' (Yours)')) {
                                b.name = b.name.replace(' (Yours)', '');
                            }
                        }
                    }
                    InnerMap._assignBuildingOwners(player);
                }
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
        html += `<span>💰 Upkeep: ${ht.maintenanceCost}g/day</span>`;
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

        const statPill = (label, value) =>
            `<span style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);">${label} ${value}</span>`;
        const btnBase = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
        const btnPrimary = `${btnBase}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
        const btnSecondary = `${btnBase}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;
        const btnDanger = `${btnBase}border:1px solid rgba(255,120,120,0.4);background:linear-gradient(180deg,#7f1d1d,#5c1212);color:#ffd6d6;`;
        const btnTab = `${btnSecondary}padding:6px 8px;`;

        let html = '<div style="max-height:520px;overflow-y:auto;">';
        html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">`;
        html += `<div><h4 style="margin:0;">⚓ ${settlement.name} Shipyard</h4>`;
        html += `<p style="font-size:12px;color:var(--text-secondary);margin:4px 0 0;">Buy a used vessel, commission a new ship, or manage your docked fleet.</p></div>`;
        html += `<div style="font-size:12px;color:var(--gold);white-space:nowrap;background:rgba(245,197,66,0.12);padding:4px 8px;border-radius:6px;">💰 ${player.gold}g</div>`;
        html += `</div>`;

        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">`;
        html += statPill('🏷️ Used', usedShips.length);
        html += statPill('🔨 Build Types', buildable.length);
        html += statPill('⚓ Docked', playerShipsHere.length);
        html += `</div>`;

        html += '<div style="display:flex;gap:6px;margin-bottom:10px;">';
        html += `<button id="shipTabBtn_used" onclick="window._shipTab('used')" style="flex:1;${btnTab}">🏷️ Used Ships</button>`;
        html += `<button id="shipTabBtn_build" onclick="window._shipTab('build')" style="flex:1;${btnTab}">🔨 Build New</button>`;
        if (playerShipsHere.length > 0) {
            html += `<button id="shipTabBtn_docked" onclick="window._shipTab('docked')" style="flex:1;${btnTab}">⚓ My Ships (${playerShipsHere.length})</button>`;
        }
        html += '</div>';

        html += '<div id="shipTabUsed">';
        if (usedShips.length === 0) {
            html += '<div style="padding:14px;border:1px dashed var(--border);border-radius:8px;text-align:center;font-size:12px;color:var(--text-secondary);">No used ships available here today.</div>';
        }
        for (let i = 0; i < usedShips.length; i++) {
            const s = usedShips[i];
            const st = Ships.getShipType(s.typeId);
            if (!st) continue;
            const canAfford = player.gold >= s.price;
            const conditionColor = s.condition >= 70 ? '#5cb85c' : s.condition >= 40 ? '#f0ad4e' : '#d9534f';
            html += '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.02);">';
            html += `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">`;
            html += `<div style="font-weight:bold;">${st.icon} ${s.name}<div style="font-size:11px;color:var(--text-secondary);font-weight:normal;">${st.name}</div></div>`;
            html += `<div style="font-size:12px;font-weight:bold;color:${canAfford ? 'var(--gold)' : '#ff8a80'};">${s.price}g</div>`;
            html += '</div>';
            html += `<div style="font-size:11px;color:var(--text-secondary);margin:4px 0 6px;">"${s.description}"</div>`;
            html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;">`;
            html += statPill('🔧', `<span style="color:${conditionColor}">${s.condition}%</span>`);
            html += statPill('⚓', st.speed);
            html += statPill('📦', st.cargoCapacity);
            html += statPill('⚔️', st.combatStrength);
            html += statPill('👥', st.crewRequired);
            html += '</div>';
            if (canAfford) {
                html += `<button onclick="window._buyUsedShip(${i})" style="width:100%;${btnPrimary}">Buy Used Ship</button>`;
            } else {
                html += `<div style="font-size:11px;color:#e74c3c;">Not enough gold</div>`;
            }
            html += '</div>';
        }
        html += '</div>';

        html += '<div id="shipTabBuild" style="display:none;">';
        for (const st of buildable) {
            const buildCost = Ships._getSettlementBuildCost(st.baseCost, settlement);
            const canAfford = player.gold >= buildCost;
            html += '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.02);">';
            html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">`;
            html += `<div style="font-weight:bold;">${st.icon} ${st.name}</div>`;
            html += `<div style="font-size:12px;font-weight:bold;color:${canAfford ? 'var(--gold)' : '#ff8a80'};">${buildCost}g</div>`;
            html += '</div>';
            html += `<div style="font-size:11px;color:var(--text-secondary);margin:4px 0 6px;">${st.description}</div>`;
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;">';
            html += statPill('⚓', st.speed);
            html += statPill('📦', st.cargoCapacity);
            html += statPill('⚔️', st.combatStrength);
            html += statPill('👥', st.crewRequired);
            html += statPill('💰/day', `${st.dailyUpkeep}g`);
            html += statPill('🏗️ Days', st.buildDays);
            if (st.customizations && st.customizations.length > 0) {
                html += statPill('🔧 Mods', st.customizations.length);
            }
            html += '</div>';
            if (canAfford) {
                html += `<button onclick="window._showBuildOptions('${st.id}', ${buildCost})" style="width:100%;${btnPrimary}">Commission Build</button>`;
            } else {
                html += `<div style="font-size:11px;color:#e74c3c;">Need ${buildCost}g</div>`;
            }
            html += '</div>';
        }
        html += '</div>';

        html += '<div id="shipTabDocked" style="display:none;">';
        if (playerShipsHere.length === 0) {
            html += '<div style="padding:14px;border:1px dashed var(--border);border-radius:8px;text-align:center;font-size:12px;color:var(--text-secondary);">No ships docked here.</div>';
        }
        for (const ship of playerShipsHere) {
            const st = Ships.getShipType(ship.typeId);
            if (!st) continue;
            const eff = Ships.getShipEffectiveStats(ship);
            const condition = Math.max(0, Math.min(100, Number(ship.condition || 0)));
            const conditionColor = condition >= 70 ? '#5cb85c' : condition >= 40 ? '#f0ad4e' : '#d9534f';
            html += '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.02);">';
            html += `<div style="font-weight:bold;">${st.icon} ${ship.name}</div>`;
            html += `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;margin:6px 0 8px;">`;
            html += `<div style="width:${condition}%;height:100%;background:${conditionColor};"></div>`;
            html += '</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;font-size:11px;">';
            html += statPill('🔧', `${condition}%`);
            html += statPill('⚓', eff.speed);
            html += statPill('📦', eff.cargoCapacity);
            if (ship.customizations && ship.customizations.length > 0) {
                html += statPill('🔧 Mods', ship.customizations.length);
            }
            html += '</div>';
            html += '<div style="display:flex;gap:6px;">';
            html += `<button onclick="window._manageShip('${ship.id}')" style="flex:1;${btnSecondary}">⚙️ Manage</button>`;
            html += `<button onclick="window._moveShipMenu('${ship.id}')" style="flex:1;${btnSecondary}">🧭 Move</button>`;
            html += '</div></div>';
        }
        html += '</div>';

        html += '</div>';
        game.ui.showCustomPanel('⚓ Shipyard', html);

        const setShipTab = (tab) => {
            const usedEl = document.getElementById('shipTabUsed');
            const buildEl = document.getElementById('shipTabBuild');
            const dockedEl = document.getElementById('shipTabDocked');
            const usedBtn = document.getElementById('shipTabBtn_used');
            const buildBtn = document.getElementById('shipTabBtn_build');
            const dockedBtn = document.getElementById('shipTabBtn_docked');

            if (usedEl) usedEl.style.display = tab === 'used' ? 'block' : 'none';
            if (buildEl) buildEl.style.display = tab === 'build' ? 'block' : 'none';
            if (dockedEl) dockedEl.style.display = tab === 'docked' ? 'block' : 'none';

            const buttons = [usedBtn, buildBtn, dockedBtn].filter(Boolean);
            for (const btn of buttons) {
                btn.style.cssText = `flex:1;${btnTab}`;
            }

            const activeBtn = tab === 'used' ? usedBtn : tab === 'build' ? buildBtn : dockedBtn;
            if (activeBtn) {
                activeBtn.style.background = 'linear-gradient(180deg, rgba(245,197,66,0.24), rgba(217,169,42,0.18))';
                activeBtn.style.border = '1px solid rgba(245,197,66,0.55)';
                activeBtn.style.color = '#f6e0a0';
            }
        };

        window._shipTab = (tab) => {
            setShipTab(tab);
        };

        setShipTab('used');

        window._buyUsedShip = (index) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = Ships.buyUsedShip(player, game.world, tile.q, tile.r, index);
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
        const statPill = (label, value) =>
            `<span style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);">${label} ${value}</span>`;
        const btnBase = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
        const btnPrimary = `${btnBase}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
        const btnSecondary = `${btnBase}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;

        let html = '<div style="max-height:460px;overflow-y:auto;">';
        html += `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px;">`;
        html += `<div><h4 style="margin:0;">🔨 Commission ${st.icon} ${st.name}</h4>`;
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">Configure the vessel before starting construction.</div></div>`;
        html += `<div style="font-size:12px;color:var(--gold);white-space:nowrap;background:rgba(245,197,66,0.12);padding:4px 8px;border-radius:6px;">💰 ${player.gold}g</div>`;
        html += '</div>';

        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">';
        html += statPill('Base', `${baseCost}g`);
        html += statPill('Build', `${st.buildDays}d`);
        html += statPill('Upkeep', `${st.dailyUpkeep}g/day`);
        html += statPill('⚓', st.speed);
        html += statPill('📦', st.cargoCapacity);
        html += '</div>';

        html += '<div style="margin-bottom:10px;">';
        html += '<label style="font-size:11px;display:block;margin-bottom:4px;"><b>Ship Name</b></label>';
        html += `<input id="shipNameInput" type="text" value="${Ships._generateShipName()}" style="width:100%;box-sizing:border-box;padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-primary);border-radius:6px;" />`;
        html += '</div>';

        if (availCustom.length > 0) {
            html += '<div style="font-size:12px;font-weight:bold;margin-bottom:6px;">Optional Customizations</div>';
            for (const c of availCustom) {
                html += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.02);">`;
                html += `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">`;
                html += `<input type="checkbox" class="shipCustomCheck" value="${c.id}" data-cost="${c.cost}" />`;
                html += `<span style="font-size:12px;"><b>${c.icon} ${c.name}</b> <span style="color:var(--gold);">(+${c.cost}g)</span></span>`;
                html += '</label>';
                html += `<div style="font-size:10px;color:var(--text-secondary);margin-left:22px;margin-top:2px;">${c.description}</div>`;
                const efParts = [];
                if (c.effects.speedBonus) efParts.push(`+${c.effects.speedBonus} speed`);
                if (c.effects.cargoBonus) efParts.push(`+${c.effects.cargoBonus} cargo`);
                if (c.effects.combatBonus) efParts.push(`+${c.effects.combatBonus} combat`);
                if (c.effects.armorBonus) efParts.push(`+${c.effects.armorBonus} armor`);
                if (c.effects.crewBonus) efParts.push(`+${c.effects.crewBonus} crew`);
                if (c.effects.stealthBonus) efParts.push(`stealth +${c.effects.stealthBonus}`);
                if (c.effects.explorationBonus) efParts.push(`exploration +${c.effects.explorationBonus}`);
                if (efParts.length) html += `<div style="font-size:10px;color:#5cb85c;margin-left:22px;margin-top:2px;">${efParts.join(' · ')}</div>`;
                html += '</div>';
            }
        }

        html += `<div id="buildTotalCost" style="font-size:13px;font-weight:bold;margin:10px 0 8px;padding:8px;border-radius:6px;background:rgba(245,197,66,0.08);border:1px solid rgba(245,197,66,0.25);">Total: ${baseCost}g</div>`;
        html += `<button onclick="window._commissionShip('${typeId}', ${baseCost})" style="width:100%;${btnPrimary}">🔨 Commission Ship</button>`;
        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="width:100%;margin-top:6px;${btnSecondary}">← Back to Shipyard</button>`;
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
            if (!ActionMenu.commitPendingAP(game)) return;
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
        const eff = Ships.getShipEffectiveStats(ship);
        const availableUpgrades = Ships.getUpgradeableCustomizations(ship);

        const value = Ships.getShipValue(ship);
        const salePrice = Math.floor(value * 0.5);

        const statPill = (label, value) =>
            `<span style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);">${label} ${value}</span>`;
        const condition = Math.max(0, Math.min(100, Number(ship.condition || 0)));
        const conditionColor = condition >= 70 ? '#5cb85c' : condition >= 40 ? '#f0ad4e' : '#d9534f';
        const btnBase = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
        const btnPrimary = `${btnBase}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
        const btnSecondary = `${btnBase}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;
        const btnDanger = `${btnBase}border:1px solid rgba(255,120,120,0.4);background:linear-gradient(180deg,#7f1d1d,#5c1212);color:#ffd6d6;`;

        let html = '<div style="max-height:460px;overflow-y:auto;">';
        html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">`;
        html += `<div><h4 style="margin:0;">${st.icon} ${ship.name}</h4><div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">${st.name}</div></div>`;
        html += `<div style="font-size:12px;color:var(--gold);white-space:nowrap;background:rgba(245,197,66,0.12);padding:4px 8px;border-radius:6px;">≈ ${salePrice}g sale</div>`;
        html += '</div>';

        html += `<div style="height:7px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;margin:0 0 8px;">`;
        html += `<div style="width:${condition}%;height:100%;background:${conditionColor};"></div>`;
        html += '</div>';
        html += `<div style="font-size:11px;color:${conditionColor};margin-bottom:8px;">Condition: ${condition}%</div>`;

        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
        html += statPill('⚓ Speed', eff.speed);
        html += statPill('📦 Cargo', eff.cargoCapacity);
        html += statPill('⚔️ Str', eff.combatStrength);
        html += statPill('👥 Crew', eff.crewRequired);
        html += statPill('💰/day', `${st.dailyUpkeep}g`);
        if (ship.status === 'building') html += statPill('🏗️', `${ship.buildDaysLeft}d left`);
        if (ship.status === 'moving') html += statPill('🧭', ship.destinationName || 'en route');
        html += '</div>';

        // Customizations installed
        if (ship.customizations && ship.customizations.length > 0) {
            html += '<div style="margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);">';
            html += '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;">Customizations</div>';
            for (const cid of ship.customizations) {
                const c = Ships.getCustomization(cid);
                if (!c) continue;
                html += `<div style="font-size:11px;padding:1px 0;">${c.icon} ${c.name}</div>`;
            }
            html += '</div>';
        }

        if (ship.cargo && Object.keys(ship.cargo).length > 0) {
            html += '<div style="margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);">';
            html += '<div style="font-size:12px;font-weight:bold;margin-bottom:4px;">Cargo</div>';
            for (const [item, qty] of Object.entries(ship.cargo)) {
                html += `<div style="font-size:11px;padding:1px 0;">${item}: ${qty}</div>`;
            }
            html += '</div>';
        }

        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">';
        if (ship.condition < 100 && ship.status === 'docked') {
            const repCost = Ships.getRepairCost(ship);
            html += `<button onclick="window._repairShip('${ship.id}')" style="flex:1;${btnPrimary}">🔧 Repair (${repCost}g)</button>`;
        }
        if (ship.status === 'docked') {
            if (availableUpgrades.length > 0) {
                html += `<button onclick="window._upgradeShipMenu('${ship.id}')" style="flex:1;${btnPrimary}">⬆️ Upgrade (${availableUpgrades.length})</button>`;
            }
            html += `<button onclick="window._renameShip('${ship.id}')" style="flex:1;${btnSecondary}">✏️ Rename</button>`;
            html += `<button onclick="window._sellShipConfirm('${ship.id}', ${salePrice})" style="flex:1;${btnDanger}">🏷️ Sell (~${salePrice}g)</button>`;
        }
        html += '</div>';
        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="width:100%;margin-top:6px;${btnSecondary}">← Back to Shipyard</button>`;
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
            const renameBtnPrimary = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;';
            let renameHtml = '<div>';
            renameHtml += '<h4 style="margin-top:0;margin-bottom:8px;">✏️ Rename Ship</h4>';
            renameHtml += '<label style="font-size:12px;">New name:</label>';
            renameHtml += `<input id="renameShipInput" type="text" value="${ship.name}" style="width:100%;box-sizing:border-box;padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border);color:var(--text-primary);border-radius:6px;margin:6px 0;" />`;
            renameHtml += `<button onclick="window._doRenameShip('${sid}')" style="width:100%;${renameBtnPrimary}">Confirm Rename</button>`;
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

        window._upgradeShipMenu = (sid) => {
            ActionMenu._showShipUpgradePanel(game, tile, sid);
        };

        window._sellShipConfirm = (sid, price) => {
            const sellBtnDanger = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;border:1px solid rgba(255,120,120,0.4);background:linear-gradient(180deg,#7f1d1d,#5c1212);color:#ffd6d6;';
            const sellBtnSecondary = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);';
            let cHtml = '<div>';
            cHtml += `<h4 style="margin-top:0;margin-bottom:8px;">🏷️ Sell Ship</h4>`;
            cHtml += `<p style="font-size:12px;color:var(--text-secondary);">Sell <b>${ship.name}</b> for approximately <b>${price}g</b>?</p>`;
            cHtml += '<div style="display:flex;gap:6px;margin-top:10px;">';
            cHtml += `<button onclick="window._doSellShip('${sid}')" style="flex:1;${sellBtnDanger}">Confirm</button>`;
            cHtml += `<button onclick="ActionMenu._showShipManagePanel(window._game, window._tile, '${sid}')" style="flex:1;${sellBtnSecondary}">Cancel</button>`;
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

    _showShipUpgradePanel(game, tile, shipId) {
        const player = game.player;
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return;
        const st = Ships.getShipType(ship.typeId);
        if (!st) return;

        const upgrades = Ships.getUpgradeableCustomizations(ship);
        const btnBase = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
        const btnPrimary = `${btnBase}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
        const btnSecondary = `${btnBase}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;

        let html = '<div style="max-height:460px;overflow-y:auto;">';
        html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">`;
        html += `<div><h4 style="margin:0;">⬆️ Upgrade ${st.icon} ${ship.name}</h4><div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">Install additional upgrades while docked.</div></div>`;
        html += `<div style="font-size:12px;color:var(--gold);white-space:nowrap;background:rgba(245,197,66,0.12);padding:4px 8px;border-radius:6px;">💰 ${player.gold}g</div>`;
        html += '</div>';

        if (upgrades.length === 0) {
            html += '<div style="padding:14px;border:1px dashed var(--border);border-radius:8px;text-align:center;font-size:12px;color:var(--text-secondary);">No upgrades available for this ship.</div>';
        } else {
            for (const c of upgrades) {
                html += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.02);">`;
                html += `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">`;
                html += `<input type="checkbox" class="shipUpgradeCheck" value="${c.id}" data-cost="${c.cost}" />`;
                html += `<span style="font-size:12px;"><b>${c.icon} ${c.name}</b> <span style="color:var(--gold);">(+${c.cost}g)</span></span>`;
                html += '</label>';
                html += `<div style="font-size:10px;color:var(--text-secondary);margin-left:22px;margin-top:2px;">${c.description}</div>`;
                const efParts = [];
                if (c.effects.speedBonus) efParts.push(`+${c.effects.speedBonus} speed`);
                if (c.effects.cargoBonus) efParts.push(`+${c.effects.cargoBonus} cargo`);
                if (c.effects.combatBonus) efParts.push(`+${c.effects.combatBonus} combat`);
                if (c.effects.armorBonus) efParts.push(`+${c.effects.armorBonus} armor`);
                if (c.effects.crewBonus) efParts.push(`+${c.effects.crewBonus} crew`);
                if (c.effects.stealthBonus) efParts.push(`stealth ${c.effects.stealthBonus >= 0 ? '+' : ''}${c.effects.stealthBonus}`);
                if (c.effects.explorationBonus) efParts.push(`explore +${c.effects.explorationBonus}`);
                if (efParts.length) html += `<div style="font-size:10px;color:#5cb85c;margin-left:22px;margin-top:2px;">${efParts.join(' · ')}</div>`;
                html += '</div>';
            }
        }

        html += `<div id="shipUpgradeTotal" style="font-size:13px;font-weight:bold;margin:10px 0 8px;padding:8px;border-radius:6px;background:rgba(245,197,66,0.08);border:1px solid rgba(245,197,66,0.25);">Total: 0g</div>`;
        html += `<button onclick="window._confirmShipUpgrade('${ship.id}')" style="width:100%;${btnPrimary}">Install Upgrades</button>`;
        html += `<button onclick="ActionMenu._showShipManagePanel(window._game, window._tile, '${ship.id}')" style="width:100%;margin-top:6px;${btnSecondary}">← Back to Ship</button>`;
        html += '</div>';

        game.ui.showCustomPanel('Ship Upgrades', html);
        window._game = game;
        window._tile = tile;

        setTimeout(() => {
            document.querySelectorAll('.shipUpgradeCheck').forEach(cb => {
                cb.addEventListener('change', () => {
                    let total = 0;
                    document.querySelectorAll('.shipUpgradeCheck:checked').forEach(checked => {
                        total += parseInt(checked.dataset.cost, 10) || 0;
                    });
                    const totalEl = document.getElementById('shipUpgradeTotal');
                    if (totalEl) totalEl.textContent = `Total: ${total}g`;
                });
            });
        }, 50);

        window._confirmShipUpgrade = (sid) => {
            const selected = [];
            document.querySelectorAll('.shipUpgradeCheck:checked').forEach(cb => selected.push(cb.value));
            const result = Ships.upgradeShip(player, sid, selected);
            if (result.success) {
                game.ui.showNotification('⬆️ Ship Upgraded!', result.message, 'success');
                game.ui.updateStats(player, game.world);
                ActionMenu._showShipManagePanel(game, tile, sid);
            } else {
                game.ui.showNotification('Cannot Upgrade', result.message, 'error');
            }
        };
    },

    _showMoveShipMenu(game, tile, shipId) {
        const player = game.player;
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return;
        const st = Ships.getShipType(ship.typeId);
        const eff = Ships.getShipEffectiveStats(ship);
        const btnBase = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
        const btnPrimary = `${btnBase}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
        const btnSecondary = `${btnBase}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;

        // Find coastal settlements the ship can move to
        const allSettlements = game.world.getAllSettlements();
        const coastalDests = allSettlements.filter(s => {
            if (s.q === tile.q && s.r === tile.r) return false;
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = game.world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });
        });

        let html = '<div style="max-height:430px;overflow-y:auto;">';
        html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">`;
        html += `<div><h4 style="margin:0;">🧭 Move ${ship.name}</h4><div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">Choose a destination port; travel time depends on ship speed.</div></div>`;
        html += `<div style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);">⚓ Speed ${eff.speed}</div>`;
        html += '</div>';

        if (coastalDests.length === 0) {
            html += '<div style="padding:14px;border:1px dashed var(--border);border-radius:8px;text-align:center;font-size:12px;color:var(--text-secondary);">No reachable ports found.</div>';
        }
        for (const dest of coastalDests) {
            const dist = Hex.distance(tile.q, tile.r, dest.q, dest.r);
            const travelDays = Math.max(1, Math.ceil(dist / eff.speed));
            html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:6px;">`;
            html += `<div><div style="font-size:12px;font-weight:bold;">${dest.name} (${dest.type})</div>`;
            html += `<div style="font-size:10px;color:var(--text-secondary);">${dist} hexes · ~${travelDays} days</div></div>`;
            html += `<button onclick="window._sendShipTo('${ship.id}', ${dest.q}, ${dest.r}, '${dest.name.replace(/'/g, "\\'")}')" style="${btnPrimary}">Send Ship</button>`;
            html += '</div>';
        }

        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="width:100%;margin-top:8px;${btnSecondary}">← Back to Shipyard</button>`;
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

        const statPill = (label, value) =>
            `<span style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);">${label} ${value}</span>`;
        const btnBase = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
        const btnPrimary = `${btnBase}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
        const btnSecondary = `${btnBase}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;

        let html = '<div style="max-height:460px;overflow-y:auto;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">';
        html += '<div><h4 style="margin:0;">🚢 Board a Ship</h4>';
        html += '<div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">Board a ship to sail across the waters.</div></div>';
        html += `<div style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);">⚓ Docked ${dockedShips.filter(s => s.status === 'docked').length}</div>`;
        html += '</div>';

        let shown = 0;
        for (const ship of dockedShips) {
            if (ship.status !== 'docked') continue;
            const st = Ships.getShipType(ship.typeId);
            if (!st) continue;
            const eff = Ships.getShipEffectiveStats(ship);
            shown++;
            const condition = Math.max(0, Math.min(100, Number(ship.condition || 0)));
            const conditionColor = condition >= 70 ? '#5cb85c' : condition >= 40 ? '#f0ad4e' : '#d9534f';
            html += `<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.02);">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">`;
            html += `<div style="font-weight:bold;">${st.icon} ${ship.name}</div>`;
            html += `<div style="font-size:11px;color:${conditionColor};">${condition}%</div>`;
            html += '</div>';
            html += `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;margin:6px 0 8px;">`;
            html += `<div style="width:${condition}%;height:100%;background:${conditionColor};"></div>`;
            html += '</div>';
            html += '<div style="font-size:11px;display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;">';
            html += statPill('⚓', eff.speed);
            html += statPill('⚔️', eff.combatStrength);
            html += statPill('📦', eff.cargoCapacity);
            html += statPill('👥', eff.crewRequired);
            html += '</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">';
            html += `<button onclick="window._boardShip('${ship.id}')" style="width:100%;${btnPrimary}">⛵ Board & Set Sail</button>`;
            html += '</div>';
            html += '</div>';
        }

        if (shown === 0) {
            html += '<div style="padding:14px;border:1px dashed var(--border);border-radius:8px;text-align:center;font-size:12px;color:var(--text-secondary);">No docked ships are ready to board at this port.</div>';
        }

        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="width:100%;margin-top:8px;${btnSecondary}">← Back to Shipyard</button>`;

        html += '</div>';
        game.ui.showCustomPanel('🚢 Board Ship', html);
        window._game = game;
        window._tile = tile;

        window._boardShip = (shipId) => {
            const ship = Ships.getShipById(player, shipId);
            if (!ship) {
                game.ui.showNotification('Error', 'Ship not found.', 'error');
                return;
            }
            
            // Board the ship
            player.boardedShip = shipId;
            ship.status = 'at_sea';
            
            game.ui.hideCustomPanel();
            game.ui.showNotification('⛵', `You board the ${ship.name}. You can now sail across water tiles!`, 'success');
            game.ui.updateStats(player, game.world);
        };

        window._seaTrade = (shipId) => {
            const result = Ships.doSeaTrade(player, shipId, game.world);
            game.ui.hideCustomPanel();
            game.ui.showNotification(result.icon || '💰', result.title || 'Sea Trade', result.type || 'info');
            game.ui.updateStats(player, game.world);
            game.endDay();
        };
    },

    disembarkShip(game) {
        const player = game.player;
        if (!player.boardedShip) {
            game.ui.showNotification('Error', 'You are not on a ship.', 'error');
            return;
        }
        const result = Ships.disembark(player, game.world);
        if (!result.success) {
            game.ui.showNotification('Cannot Disembark', result.message, 'error');
            return;
        }
        game.ui.showNotification('🚶', `You disembark from the ${result.ship.name} and return to dry land.` +
            ActionMenu._landingCargoText(result), 'success');
        game.ui.updateStats(player, game.world);
    },

    /** Recentre the world camera on the player (camera works in pixels, not hexes). */
    _centerCameraOnPlayer(game) {
        const pos = game.renderer.getHexPixelPos(game.player.q, game.player.r);
        game.camera.centerOn(pos.x, pos.y);
    },

    /** Describe what cargo came ashore and what had to stay aboard. */
    _landingCargoText(result) {
        const { cargo, isPort } = result;
        let text = '';
        if (cargo.total > 0) {
            const items = Object.entries(cargo.moved).map(([id, n]) => `${n} ${id.replace(/_/g, ' ')}`).join(', ');
            text += ` Brought ashore: ${items}.`;
        }
        if (cargo.remaining > 0 && !isPort) {
            text += ` ${cargo.remaining} cargo stays aboard — without a dock the boat ferries only ${Ships.LANDING_BOAT_CAPACITY} a day (use Ship's Hold).`;
        }
        return text;
    },

    /** Pick an adjacent land hex to row the ship's boat to. */
    showRowAshoreMenu(game) {
        const player = game.player;
        const ship = Ships.getShipById(player, player.boardedShip);
        if (!ship) {
            game.ui.showNotification('Error', 'You are not on a ship.', 'error');
            return;
        }
        const targets = Ships.getRowAshoreTargets(game.world, player.q, player.r);
        if (targets.length === 0) {
            game.ui.showNotification('No Shore', 'There is no walkable land next to your ship.', 'error');
            return;
        }
        const btn = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;';

        let html = '<div style="max-height:430px;overflow-y:auto;">';
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">The ${ship.name} drops anchor here while you row ashore. ` +
            `Without a dock or port, only ${Ships.LANDING_BOAT_CAPACITY} cargo fits in the boat.</div>`;
        for (const t of targets) {
            const isPort = Ships.isPortTile(game.world, t.q, t.r);
            const name = t.settlement ? t.settlement.name : (t.terrain.name || t.terrain.id);
            html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:6px;">';
            html += `<div><div style="font-size:12px;font-weight:bold;">${t.terrain.icon || ''} ${name}</div>`;
            html += `<div style="font-size:10px;color:var(--text-secondary);">(${t.q}, ${t.r}) · ${isPort ? '⚓ Port — unload everything' : 'Open shore — boat-load only'}</div></div>`;
            html += `<button onclick="window._rowAshore(${t.q}, ${t.r})" style="${btn}">Row</button>`;
            html += '</div>';
        }
        html += '</div>';
        game.ui.showCustomPanel('🚣 Row Ashore', html);

        window._rowAshore = (q, r) => {
            const result = Ships.rowAshore(player, game.world, q, r);
            if (!result.success) {
                game.ui.showNotification('Cannot Row Ashore', result.message, 'error');
                return;
            }
            game.ui.hideCustomPanel();
            game.ui.showNotification('🚣 Ashore', `You row ashore. The ${result.ship.name} waits at anchor.` +
                ActionMenu._landingCargoText(result), 'success');
            ActionMenu._centerCameraOnPlayer(game);
            game.ui.updateStats(player, game.world);
        };
    },

    /** Row back out to an anchored ship next to the player. */
    rowToShip(game) {
        const player = game.player;
        const ship = Ships.getAnchoredShipsNear(player, player.q, player.r)[0];
        if (!ship) {
            game.ui.showNotification('No Ship', 'None of your ships is anchored nearby.', 'error');
            return;
        }
        const result = Ships.rowToShip(player, ship.id);
        if (!result.success) {
            game.ui.showNotification('Cannot Board', result.message, 'error');
            return;
        }
        game.ui.showNotification('⛵', `You row out and climb aboard the ${ship.name}.`, 'success');
        ActionMenu._centerCameraOnPlayer(game);
        game.ui.updateStats(player, game.world);
    },

    /**
     * Move goods between the player's pack and the hold of a ship docked on
     * their hex or anchored next to them.
     */
    showShipHoldMenu(game, shipId = null) {
        const player = game.player;
        const world = game.world;
        const ships = Ships.getShipsWithHoldAccess(player);
        if (ships.length === 0) {
            game.ui.showNotification('No Ship', 'None of your ships is docked here or anchored nearby.', 'error');
            return;
        }
        const ship = ships.find(s => s.id === shipId) || ships[0];
        const stats = Ships.getShipEffectiveStats(ship);
        const allowance = Ships.getFerryAllowance(ship, world, player.q, player.r);
        const goodName = (id) => {
            const g = (PlayerEconomy.GOODS || {})[id.toUpperCase()];
            return g ? `${g.icon || ''} ${g.name}` : id.replace(/_/g, ' ');
        };
        const esc = (id) => String(id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const btn = 'padding:4px 8px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);';
        const row = (label, qty, buttons) =>
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:4px;">' +
            `<div style="font-size:12px;">${label} <span style="color:var(--text-secondary);">×${qty}</span></div><div style="display:flex;gap:4px;">${buttons}</div></div>`;

        let html = '<div style="max-height:460px;overflow-y:auto;">';
        if (ships.length > 1) {
            html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">';
            for (const s of ships) {
                const active = s.id === ship.id ? 'border-color:rgba(245,197,66,0.7);' : '';
                html += `<button onclick="ActionMenu.showShipHoldMenu(window._game, '${esc(s.id)}')" style="${btn}${active}">⛵ ${s.name}</button>`;
            }
            html += '</div>';
        }
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">Hold: ${Ships.getCargoUsed(ship)} / ${stats.cargoCapacity} · ` +
            (allowance === Infinity ? '⚓ Port — no limit on transfers.' : `🚣 Boat trips left today: ${allowance} cargo (no dock here).`) + '</div>';

        html += `<h4 style="margin:6px 0;">⛵ In the ${ship.name}'s hold</h4>`;
        const hold = Object.entries(ship.cargo || {}).filter(([, n]) => n > 0);
        if (hold.length === 0) html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">The hold is empty.</div>';
        for (const [id, n] of hold) {
            html += row(goodName(id), n,
                `<button onclick="window._shipHoldUnload('${esc(id)}', 1)" style="${btn}">Unload 1</button>` +
                `<button onclick="window._shipHoldUnload('${esc(id)}', ${n})" style="${btn}">Unload all</button>`);
        }

        html += '<h4 style="margin:10px 0 6px;">🎒 Your pack</h4>';
        const pack = Object.entries(player.inventory || {}).filter(([, n]) => n > 0);
        if (pack.length === 0) html += '<div style="font-size:11px;color:var(--text-secondary);">You carry nothing to load.</div>';
        for (const [id, n] of pack) {
            html += row(goodName(id), n,
                `<button onclick="window._shipHoldLoad('${esc(id)}', 1)" style="${btn}">Load 1</button>` +
                `<button onclick="window._shipHoldLoad('${esc(id)}', ${n})" style="${btn}">Load all</button>`);
        }
        html += '</div>';
        game.ui.showCustomPanel("📦 Ship's Hold", html);
        window._game = game;

        const after = (result) => {
            if (!result.success) game.ui.showNotification("Ship's Hold", result.message, 'error');
            game.ui.updateStats(player, world);
            ActionMenu.showShipHoldMenu(game, ship.id);
        };
        window._shipHoldLoad = (id, qty) => after(Ships.loadCargo(player, world, ship.id, id, qty));
        window._shipHoldUnload = (id, qty) => after(Ships.unloadToPlayer(player, world, ship.id, id, qty));
    },

    _showSailToMenu(game, tile, shipId) {
        const player = game.player;
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return;
        const st = Ships.getShipType(ship.typeId);
        const btnBase = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
        const btnPrimary = `${btnBase}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
        const btnSecondary = `${btnBase}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;

        const allSettlements = game.world.getAllSettlements();
        const coastalDests = allSettlements.filter(s => {
            if (s.q === tile.q && s.r === tile.r) return false;
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = game.world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });
        });

        let html = '<div style="max-height:430px;overflow-y:auto;">';
        html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">`;
        html += `<div><h4 style="margin:0;">🧭 Sail ${ship.name}</h4><div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">Pick a destination port and pay travel upkeep.</div></div>`;
        html += `<div style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);">⚓ Speed ${st ? st.speed : 4}</div>`;
        html += '</div>';

        if (coastalDests.length === 0) {
            html += '<div style="padding:14px;border:1px dashed var(--border);border-radius:8px;text-align:center;font-size:12px;color:var(--text-secondary);">No coastal destinations found.</div>';
        }

        for (const dest of coastalDests) {
            const dist = Hex.distance(tile.q, tile.r, dest.q, dest.r);
            const speed = st ? st.speed : 4;
            const travelDays = Math.max(1, Math.ceil(dist / speed));
            const fuelCost = travelDays * (st ? st.dailyUpkeep : 5);
            const canAfford = (player.gold || 0) >= fuelCost;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:6px;">`;
            html += `<div><div style="font-size:12px;font-weight:bold;">${dest.name}</div>`;
            html += `<div style="font-size:10px;color:var(--text-secondary);">${dist} hexes · ~${travelDays} days · ${fuelCost}g travel upkeep</div></div>`;
            html += `<button onclick="window._doSailTo('${ship.id}', ${dest.q}, ${dest.r}, '${dest.name.replace(/'/g, "\\'")}')" style="${canAfford ? btnPrimary : `${btnSecondary}opacity:0.5;cursor:not-allowed;`}" ${!canAfford ? 'disabled' : ''}>Sail</button>`;
            html += '</div>';
        }

        html += `<button onclick="ActionMenu.showBoardShipMenu(window._game, window._tile)" style="width:100%;margin-top:8px;${btnSecondary}">← Back to Board Ship</button>`;
        html += '</div>';
        game.ui.showCustomPanel('Set Sail', html);
        window._game = game;
        window._tile = tile;

        window._doSailTo = (sid, dq, dr, dname) => {
            const result = Ships.sailPlayerTo(player, sid, dq, dr, dname, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('⛵ Arrived!', result.message, 'success');
                ActionMenu._centerCameraOnPlayer(game);
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
});
