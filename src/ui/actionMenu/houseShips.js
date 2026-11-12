// ActionMenu — houseShips methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { beginVoyage } from './voyage.js';
import { Pirates } from '../../systems/pirates.js';
import { lede, bullets, chips, purse, sectionHead, kv, card, actRow, rowList, price, BTN_GOLD, BTN_PLAIN, BTN_DARK, BTN_RED } from './uiKit.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, InnerMap, KingdomNavy, Discovery } from './_imports.js';

// The action menu's voice (ui/actionMenu/uiKit.js): muted notes, the one
// full-width button a panel ends on, small stat tags inside a row, a thin bar
const MUTED = 'font-size:11px; color:#9d937c;';
const WIDE = 'display:block; width:100%; padding:8px 12px; margin:10px 0 0; font-size:13px;';

/** Small stat tags ([label, value] pairs), in spans so they can sit inside a row. */
function pills(items) {
    return `<span style="display:flex; flex-wrap:wrap; gap:4px; margin:3px 0;">${items.map(([label, value]) =>
        `<span class="pk-chip" style="font-size:10.5px; padding:0 7px;">${label} <b>${value}</b></span>`).join('')}</span>`;
}

/** A ship's condition as a thin bar. */
function condBar(pct, color) {
    return `<div style="height:5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; margin:2px 0 6px;"><div style="width:${pct}%; height:100%; background:${color};"></div></div>`;
}

/** Which of your ships a hold/market panel shows: a small toggle each, the shown one lit. */
function shipPicker(ships, ship, call) {
    return `<div style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;">${ships.map(s =>
        `<button onclick="${call(s)}" style="${s.id === ship.id ? BTN_GOLD : BTN_DARK}">⛵ ${s.name}</button>`).join('')}</div>`;
}

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

        let html = chips([purse(player.gold), ['⭐', 'Renown', player.renown || 0]]);
        html += lede(`Purchase a home in ${settlement.name}. Owning property grants renown and local influence:`);
        html += bullets(['better prices with this town\'s merchants;', 'a stronger hand when negotiating with lords.']);

        // NPC-owned houses (flavor)
        if (npcHouses.length > 0) {
            html += `<div style="${MUTED} margin-bottom:8px;"><em>Notable residents: `;
            html += npcHouses.map(h => {
                const ht = Housing.getHouseType(h.typeId);
                return `${h.owner} (${ht ? ht.name : 'house'})`;
            }).join(', ');
            html += '</em></div>';
        }

        // Available house types: one row each, the price at the right
        html += rowList(available.map(ht => {
            const cost = Housing._getSettlementPrice(ht.baseCost, settlement);
            const canAfford = player.gold >= cost;
            const meetsRenown = (player.renown || 0) >= ht.requiredRenown;
            const canBuy = canAfford && meetsRenown;
            const facts = [`🏆 +${ht.renownBonus} renown`, `🤝 +${ht.reputationBonus} rep`];
            if (ht.staminaBonus) facts.push(`⚡ +${ht.staminaBonus} stamina`);
            facts.push(`❤️ +${ht.healthRegenBonus} health/day`, `🔧 ${ht.maxUpgradeSlots} upgrade slots`);
            if (ht.requiredRenown > 0) facts.push(`📜 Requires ${ht.requiredRenown} renown`);
            facts.push(`💰 ${ht.maintenanceCost}g/day upkeep`);
            const why = !meetsRenown ? `Need ${ht.requiredRenown} renown (you have ${player.renown || 0})` : `Not enough gold (need ${cost}g)`;
            return {
                icon: ht.icon, name: ht.name, desc: ht.description,
                note: `<span style="color:#9d937c;">${facts.join(' · ')}</span>${canBuy ? '' : `<br><span style="color:#c98a6a;">${why}</span>`}`,
                off: !canBuy, attrs: `onclick="window._buyHouse('${ht.id}', ${cost})"`,
                side: price(cost, canAfford), title: canBuy ? `Buy for ${cost}g` : '',
            };
        }), '🏠 Buy a House');
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

        let html = lede(`${ht.icon} <b>${ht.name}</b> — ${house.settlementName}`);

        // Status chips
        html += chips([
            { icon: '🔧', label: 'Condition:', value: `${house.condition}%`, cls: house.condition < 50 ? '' : 'gold' },
            ['💰', 'Value:', `~${value}g`],
            ['💰', 'Upkeep:', `${ht.maintenanceCost}g/day`],
            `<span title="Better prices here (+${(Housing.getLocalTradeBonus(player, { q: tile.q, r: tile.r, name: house.settlementName }) * 100).toFixed(1)}%) and +${(Housing.getNegotiationBonus(player) * 100).toFixed(0)}% when negotiating with lords">👑 Influence: <b>${influence}</b></span>`,
            ['📦', 'Upgrades:', `${house.upgrades.length}/${ht.maxUpgradeSlots}`],
        ]);

        // Installed upgrades
        if (house.upgrades.length > 0) {
            html += rowList(house.upgrades.map(uid => {
                const u = Housing.getUpgrade(uid);
                return u ? { icon: u.icon, name: u.name, desc: u.description, side: '✓', tone: 'good' } : null;
            }), 'Installed Upgrades');
        }

        // Available upgrades
        const availUpgrades = Housing.getAvailableUpgrades(house.typeId, house.upgrades);
        if (availUpgrades.length > 0 && house.upgrades.length < ht.maxUpgradeSlots) {
            html += rowList(availUpgrades.map(u => {
                const canAfford = player.gold >= u.cost;
                // Show effects
                const effects = u.effects || {};
                const effectParts = [];
                if (effects.healthRegenBonus) effectParts.push(`+${effects.healthRegenBonus} health/day`);
                if (effects.renownBonus) effectParts.push(`+${effects.renownBonus} renown`);
                if (effects.reputationBonus) effectParts.push(`+${effects.reputationBonus} reputation`);
                if (effects.strengthBonus) effectParts.push(`+${effects.strengthBonus} strength`);
                if (effects.charismaBonus) effectParts.push(`+${effects.charismaBonus} charisma`);
                if (effects.influenceBonus) effectParts.push(`+${effects.influenceBonus} influence`);
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
                return {
                    icon: u.icon, name: u.name, desc: u.description,
                    note: [effectParts.join(' · '), canAfford ? '' : `<span style="color:#c98a6a;">Need ${u.cost}g</span>`].filter(Boolean).join('<br>'),
                    off: !canAfford, attrs: `onclick="window._installUpgrade('${u.id}')"`,
                    side: price(u.cost, canAfford), title: canAfford ? `Install — ${u.cost}g` : '',
                };
            }), 'Available Upgrades');
        }

        // Actions
        const acts = [];
        if (house.condition < 100) {
            const ht2 = Housing.getHouseType(house.typeId);
            const damagePercent = (100 - house.condition) / 100;
            const repairCost = Math.max(5, Math.floor((ht2 ? ht2.baseCost : 200) * 0.1 * damagePercent));
            acts.push({ icon: '🔧', name: 'Repair', desc: `Mend the house to full condition (${house.condition}% now)`, attrs: 'onclick="window._repairHouse()"', side: price(repairCost, player.gold >= repairCost) });
        }
        acts.push({ icon: '🏷️', name: 'Sell', desc: `Put the ${ht.name} up for sale`, attrs: 'onclick="window._sellHouseConfirm()"', side: `~${salePrice}g`, tone: 'bad' });
        html += rowList(acts, 'The house');

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
            let confirmHtml = lede(`Are you sure you want to sell your ${ht.name} in ${house.settlementName}?`);
            confirmHtml += `<div style="font-size:12px; color:#cbbf9f;">You'll receive approximately <strong style="color:#ffcf6a;">${salePrice}g</strong> (${Math.round(Housing._getSellPenalty() * 100)}% of value).</div>`;
            confirmHtml += '<div style="display:flex;gap:6px;margin-top:10px;">';
            confirmHtml += `<button onclick="window._doSellHouse()" style="${BTN_RED} flex:1; margin:0;">Confirm Sale</button>`;
            confirmHtml += `<button onclick="ActionMenu.showManageHouseMenu(window._game, window._tile)" style="${BTN_PLAIN} flex:1; margin:0;">Cancel</button>`;
            confirmHtml += '</div>';
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

        const usedShips = Ships.getUsedShipsForSale(tile, game.world);
        const buildable = Ships._getShipTypes();
        const playerShipsHere = Ships.getShipsAt(player, tile.q, tile.r);

        const btnTab = BTN_PLAIN;

        let html = lede(`<b>${settlement.name} Shipyard</b>. Buy a used vessel, commission a new ship, or manage your docked fleet.`);
        html += chips([
            purse(player.gold),
            ['🏷️', 'Used', usedShips.length],
            ['🔨', 'Build Types', buildable.length],
            ['⚓', 'Docked', playerShipsHere.length],
        ]);

        // Used / Build / My Ships are the window's tab bar; the tab shown survives re-renders
        const shipTabs = [['used', '🏷️ Used Ships'], ['build', '🔨 Build New']];
        if (playerShipsHere.length > 0) shipTabs.push(['docked', `⚓ My Ships (${playerShipsHere.length})`]);
        const ui = game.ui || {};
        const shipTab = shipTabs.some(([k]) => k === ui._shipyardTab) ? ui._shipyardTab : 'used';
        if (typeof ui.setPanelNav === 'function') {
            ui.setPanelNav({
                id: 'shipyard', title: `⚓ ${settlement.name} Shipyard`, active: shipTab,
                items: shipTabs.map(([key, label]) => ({ key, label, inPlace: true, run: () => window._shipTab(key) })),
            });
        }

        html += '<div id="shipTabUsed">';
        if (usedShips.length === 0) {
            html += `<div style="${MUTED} padding:8px 0;">No used ships available here today.</div>`;
        }
        const usedRows = [];
        for (let i = 0; i < usedShips.length; i++) {
            const s = usedShips[i];
            const st = Ships.getShipType(s.typeId);
            if (!st) continue;
            const canAfford = player.gold >= s.price;
            const conditionColor = s.condition >= 70 ? '#8fd18a' : s.condition >= 40 ? '#f0b35a' : '#e0846a';
            usedRows.push({
                icon: st.icon, name: `${s.name} <span style="font-size:11px; font-weight:400; color:#9d937c;">${st.name}</span>`,
                desc: `"${s.description}"`,
                note: pills([['🔧', `<span style="color:${conditionColor}">${s.condition}%</span>`], ['⚓', st.speed], ['📦', st.cargoCapacity], ['⚔️', st.combatStrength], ['👥', `${st.crewRequired} crew needed`]])
                    + (canAfford ? '' : '<span style="color:#c98a6a;">Not enough gold</span>'),
                off: !canAfford, attrs: `onclick="window._buyUsedShip(${i})"`,
                side: price(s.price, canAfford), title: canAfford ? 'Buy Used Ship' : '',
            });
        }
        html += rowList(usedRows);
        html += '</div>';

        html += '<div id="shipTabBuild" style="display:none;">';
        const buildRows = [];
        for (const st of buildable) {
            const buildCost = Ships._getSettlementBuildCost(st.baseCost, settlement);
            // The shipwrights must know the craft (world/shipcraft.js), or you must
            const craft = Ships.canBuild(player, game.world, settlement, st);
            const canAfford = player.gold >= buildCost && craft.ok;
            const p = [['⚓', st.speed], ['📦', st.cargoCapacity], ['⚔️', st.combatStrength],
                ['👥', `${st.crewRequired} crew (${st.crewRequired * Ships._getCrewSettings().wagePerSailorPerDay}g/day wages)`],
                ['💰/day', `${st.dailyUpkeep}g`], ['🏗️ Days', st.buildDays]];
            if (st.customizations && st.customizations.length > 0) p.push(['🔧 Mods', st.customizations.length]);
            const why = !craft.ok
                ? `🔒 The shipwrights here don't know how: needs ${craft.names}. Research it yourself (Technology), or find a realm whose shipwrights do.`
                : `Need ${buildCost}g`;
            buildRows.push({
                icon: st.icon, name: st.name, desc: st.description,
                note: pills(p) + (canAfford ? '' : `<span style="color:#c98a6a;">${why}</span>`),
                off: !canAfford, attrs: `onclick="window._showBuildOptions('${st.id}', ${buildCost})"`,
                side: price(buildCost, player.gold >= buildCost), title: canAfford ? 'Commission Build' : '',
            });
        }
        html += rowList(buildRows);
        html += '</div>';

        html += '<div id="shipTabDocked" style="display:none;">';
        if (playerShipsHere.length === 0) {
            html += `<div style="${MUTED} padding:8px 0;">No ships docked here.</div>`;
        }
        for (const ship of playerShipsHere) {
            const st = Ships.getShipType(ship.typeId);
            if (!st) continue;
            const eff = Ships.getShipEffectiveStats(ship);
            const condition = Math.max(0, Math.min(100, Number(ship.condition || 0)));
            const conditionColor = condition >= 70 ? '#8fd18a' : condition >= 40 ? '#f0b35a' : '#e0846a';
            const crewHere = Ships.getCrew(ship);
            const p = [['🔧', `${condition}%`], ['⚓', eff.speed], ['📦', eff.cargoCapacity]];
            if (ship.customizations && ship.customizations.length > 0) p.push(['🔧 Mods', ship.customizations.length]);
            p.push(['👥', `<span style="color:${crewHere >= eff.crewRequired ? '#8fd18a' : crewHere >= Ships.getMinCrew(ship) ? '#f0b35a' : '#e0846a'}">${crewHere}/${eff.crewRequired} crew</span>`]);
            let body = condBar(condition, conditionColor) + pills(p);
            body += '<div style="margin-top:6px;">';
            if (crewHere < eff.crewRequired && Ships.isPortTile(game.world, ship.q, ship.r)) {
                body += `<button onclick="window._hireSailorsHere()" style="${BTN_GOLD}">👥 Hire Sailors</button>`;
            }
            body += `<button onclick="window._manageShip('${ship.id}')" style="${BTN_PLAIN}">⚙️ Manage</button>`;
            body += `<button onclick="window._moveShipMenu('${ship.id}')" style="${BTN_PLAIN}">🧭 Move</button>`;
            body += '</div>';
            html += card(body, { icon: st.icon, title: ship.name, side: st.name });
        }
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
            ui._shipyardTab = tab;
            setShipTab(tab);
        };

        setShipTab(shipTab);

        window._buyUsedShip = (index) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = Ships.buyUsedShip(player, game.world, tile.q, tile.r, index);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('⛵ Ship Purchased!', result.message, 'success');
                game.ui.updateStats(player, game.world);
                // She comes without a crew: straight to the docks' hiring hall
                if (Ships.shortHandedAt(player, game.world, tile.q, tile.r).length) ActionMenu.showHireSailorsMenu(game, tile);
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

        window._hireSailorsHere = () => ActionMenu.showHireSailorsMenu(game, tile);

        window._moveShipMenu = (shipId) => {
            ActionMenu._showMoveShipMenu(game, tile, shipId);
        };
    },

    _showShipBuildConfig(game, tile, typeId, baseCost) {
        const player = game.player;
        const st = Ships.getShipType(typeId);
        if (!st) return;

        const availCustom = Ships.getAvailableCustomizations(typeId);
        let html = lede(`🔨 Commission ${st.icon} <b>${st.name}</b>. Configure the vessel before starting construction.`);
        html += chips([
            purse(player.gold),
            ['', 'Base', `${baseCost}g`],
            ['', 'Build', `${st.buildDays}d`],
            ['', 'Upkeep', `${st.dailyUpkeep}g/day`],
            ['⚓', '', st.speed],
            ['📦', '', st.cargoCapacity],
        ]);

        html += '<div style="margin-bottom:10px;">';
        html += sectionHead('Ship Name');
        html += `<input id="shipNameInput" type="text" value="${Ships._generateShipName()}" style="width:100%;box-sizing:border-box;padding:6px 8px;background:rgba(0,0,0,0.3);border:1px solid rgba(245,197,66,0.2);color:#ece2c8;border-radius:6px;" />`;
        html += '</div>';

        if (availCustom.length > 0) {
            html += sectionHead('Optional Customizations');
            html += '<div class="pk-rows">';
            for (const c of availCustom) {
                const efParts = [];
                if (c.effects.speedBonus) efParts.push(`+${c.effects.speedBonus} speed`);
                if (c.effects.cargoBonus) efParts.push(`+${c.effects.cargoBonus} cargo`);
                if (c.effects.combatBonus) efParts.push(`+${c.effects.combatBonus} combat`);
                if (c.effects.armorBonus) efParts.push(`+${c.effects.armorBonus} armor`);
                if (c.effects.crewBonus) efParts.push(`+${c.effects.crewBonus} crew`);
                if (c.effects.stealthBonus) efParts.push(`stealth ${c.effects.stealthBonus >= 0 ? '+' : ''}${c.effects.stealthBonus}`);
                if (c.effects.explorationBonus) efParts.push(`exploration +${c.effects.explorationBonus}`);
                if (c.effects.captureBonus) efParts.push(`${Math.round(c.effects.captureBonus * 100)}% prize capture`);
                if (c.effects.fishingBonus) efParts.push(`+${c.effects.fishingBonus} fishing casts`);
                if (c.effects.renownBonus) efParts.push(`+${c.effects.renownBonus} renown`);
                if (c.effects.charismaBonus) efParts.push(`+${c.effects.charismaBonus} charisma`);
                // A row that is a label: the whole row ticks its box
                html += `<label class="pk-row pk-row--act" style="cursor:pointer;">`
                    + `<span class="pk-row-ico"><input type="checkbox" class="shipCustomCheck" value="${c.id}" data-cost="${c.cost}" /></span>`
                    + `<span class="pk-row-txt"><span class="pk-row-name">${c.icon} ${c.name}</span><span class="pk-row-desc">${c.description}</span>${efParts.length ? `<span class="pk-row-note">${efParts.join(' · ')}</span>` : ''}</span>`
                    + `<span class="pk-row-side"><span class="pk-price">+${c.cost}<small>g</small></span></span>`
                    + '</label>';
            }
            html += '</div>';
        }

        html += bullets([`👥 New ships come without a crew: hire ${st.crewRequired} sailors at a port (${Ships._getCrewSettings().hireCostPerSailor}g each to sign on, ${Ships._getCrewSettings().wagePerSailorPerDay}g a day in wages).`]);
        html += `<div id="buildTotalCost" class="pk-card" style="font-size:13px; font-weight:600; color:#ffcf6a;">Total: ${baseCost}g</div>`;
        html += `<button onclick="window._commissionShip('${typeId}', ${baseCost})" style="${BTN_GOLD}${WIDE}">🔨 Commission Ship</button>`;
        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="${BTN_PLAIN}${WIDE}">← Back to Shipyard</button>`;
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

        const condition = Math.max(0, Math.min(100, Number(ship.condition || 0)));
        const conditionColor = condition >= 70 ? '#8fd18a' : condition >= 40 ? '#f0b35a' : '#e0846a';

        let html = lede(`${st.icon} <b>${ship.name}</b> · ${st.name}`);
        const crew = Ships.getCrew(ship);
        const crewColor = crew >= eff.crewRequired ? '#8fd18a' : crew >= Ships.getMinCrew(ship) ? '#f0b35a' : '#e0846a';
        const morale = Ships.getMorale(ship);
        const foodDays = Ships.getProvisionDays(ship);
        html += chips([
            { icon: '', label: '≈', value: `${salePrice}g sale`, cls: 'gold' },
            ['⚓', 'Speed', eff.speed],
            ['📦', 'Cargo', eff.cargoCapacity],
            ['⚔️', 'Str', eff.combatStrength],
            ['👥', 'Crew', `<span style="color:${crewColor}">${crew}/${eff.crewRequired}</span>`],
            ['🙂', 'Morale', morale],
            ['💰/day', '', `${st.dailyUpkeep}g + ${Ships.getDailyWages(ship)}g wages`],
            ['🍞', 'Provisions', foodDays === Infinity ? '—' : `${foodDays} days`],
            ship.status === 'building' ? ['🏗️', '', `${ship.buildDaysLeft}d left`] : null,
            ship.status === 'moving' ? ['🧭', '', ship.destinationName || 'en route'] : null,
        ]);
        html += condBar(condition, conditionColor);
        html += `<div style="font-size:11px;color:${conditionColor};margin-bottom:8px;">Condition: ${condition}%</div>`;

        // Customizations installed
        if (ship.customizations && ship.customizations.length > 0) {
            html += rowList(ship.customizations.map(cid => {
                const c = Ships.getCustomization(cid);
                return c ? { icon: c.icon, name: c.name, side: '✓', tone: 'good' } : null;
            }), 'Customizations');
        }

        if (ship.cargo && Object.keys(ship.cargo).length > 0) {
            html += sectionHead('Cargo');
            for (const [item, qty] of Object.entries(ship.cargo)) html += kv(item, qty);
        }

        // Crew: what a short-handed ship loses, and hiring at this port
        const crewOpen = Math.max(0, eff.crewRequired - crew);
        let crewBody = '';
        if (crew < Ships.getMinCrew(ship)) {
            crewBody += `<div style="color:#e0846a;">Needs at least ${Ships.getMinCrew(ship)} sailors to leave port.</div>`;
        }
        if (crewOpen > 0) {
            crewBody += `<div>Short-handed: ${Math.round(Ships.getCrewSpeedFactor(ship) * 100)}% speed, ${Math.round(Ships.getCrewCombatFactor(ship) * 100)}% fighting strength, fewer fish in the nets.</div>`;
        }
        crewBody += `<div>Wages ${Ships._getCrewSettings().wagePerSailorPerDay}g per sailor a day. Storms, defeats and missed wages sap morale; below ${Ships._getCrewSettings().desertionMorale} sailors desert.</div>`;
        crewBody += `<div>Away from port the crew eats from the hold: ${Math.round(Ships.getDailyRations(ship) * 10) / 10} provisions a day. A hungry crew loses heart, then scurvy comes aboard.</div>`;
        html += card(`<div style="font-size:11px; color:#cbbf9f;">${crewBody}</div>`, { icon: '👥', title: 'Crew', side: `<span style="color:${crewColor}">${crew}/${eff.crewRequired}</span>` });

        // What can be done with her: one row an action
        const acts = [];
        if (ship.status === 'docked' && crewOpen > 0 && Ships.isPortTile(game.world, ship.q, ship.r)) {
            const hire = Ships.getHireCost(crewOpen);
            acts.push({ icon: '👥', name: `Hire ${crewOpen} sailors`, desc: 'Fill her empty berths', attrs: `onclick="window._hireCrew('${ship.id}')"`, side: price(hire, player.gold >= hire) });
        }
        if (ship.status === 'docked' && crew > 0) {
            acts.push({ icon: '👋', name: 'Pay off 1 sailor', desc: 'One fewer mouth and wage', attrs: `onclick="window._dismissCrew('${ship.id}')"` });
        }
        const victual = ship.status === 'docked' && Ships.isPortTile(game.world, ship.q, ship.r) ? Ships.provisionsNeeded(ship, 10, { player }) : 0;
        if (victual > 0) {
            const unit = Ships.provisionPrice(game.world, ship.q, ship.r);
            acts.push({ icon: '🍞', name: 'Provision for 10 days', desc: `${victual} × ${unit}g`, attrs: `onclick="window._provisionShip('${ship.id}', ${victual})"`, side: price(victual * unit, player.gold >= victual * unit) });
        }
        if (ship.condition < 100 && ship.status === 'docked') {
            const repCost = Ships.getRepairCost(ship);
            acts.push({ icon: '🔧', name: 'Repair', desc: `Mend her hull (${condition}% now)`, attrs: `onclick="window._repairShip('${ship.id}')"`, side: price(repCost, player.gold >= repCost) });
        }
        if (ship.status === 'docked') {
            if (availableUpgrades.length > 0) {
                acts.push({ icon: '⬆️', name: 'Upgrade', desc: 'Install additional upgrades while docked', attrs: `onclick="window._upgradeShipMenu('${ship.id}')"`, side: `${availableUpgrades.length}`, tone: 'gold' });
            }
            acts.push({ icon: '✏️', name: 'Rename', desc: 'Give her a new name', attrs: `onclick="window._renameShip('${ship.id}')"` });
            acts.push({ icon: '🏷️', name: 'Sell', desc: 'Sell her at the yard', attrs: `onclick="window._sellShipConfirm('${ship.id}', ${salePrice})"`, side: `~${salePrice}g`, tone: 'bad' });
        }
        html += rowList(acts, 'Orders');
        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="${BTN_PLAIN}${WIDE}">← Back to Shipyard</button>`;

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

        window._hireCrew = (sid) => {
            const result = Ships.hireCrew(player, game.world, sid);
            game.ui.showNotification(result.success ? '👥 Crew Hired' : 'Cannot Hire', result.message, result.success ? 'success' : 'error');
            if (result.success) {
                game.ui.updateStats(player, game.world);
                ActionMenu._showShipManagePanel(game, tile, sid);
            }
        };

        window._provisionShip = (sid, units) => {
            const result = Ships.buyProvisions(player, game.world, sid, units);
            game.ui.showNotification(result.success ? '🍞 Provisioned' : 'Provisions', result.message, result.success ? 'success' : 'error');
            if (result.success) {
                game.ui.updateStats(player, game.world);
                ActionMenu._showShipManagePanel(game, tile, sid);
            }
        };

        window._dismissCrew = (sid) => {
            const result = Ships.dismissCrew(player, sid, 1);
            game.ui.showNotification(result.success ? '👋 Crew Paid Off' : 'Error', result.message, result.success ? 'info' : 'error');
            if (result.success) ActionMenu._showShipManagePanel(game, tile, sid);
        };

        window._renameShip = (sid) => {
            let renameHtml = sectionHead('✏️ Rename Ship');
            renameHtml += '<label style="font-size:12px; color:#cbbf9f;">New name:</label>';
            renameHtml += `<input id="renameShipInput" type="text" value="${ship.name}" style="width:100%;box-sizing:border-box;padding:6px 8px;background:rgba(0,0,0,0.3);border:1px solid rgba(245,197,66,0.2);color:#ece2c8;border-radius:6px;margin:6px 0;" />`;
            renameHtml += `<button onclick="window._doRenameShip('${sid}')" style="${BTN_GOLD}${WIDE}">Confirm Rename</button>`;
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
            let cHtml = sectionHead('🏷️ Sell Ship');
            cHtml += lede(`Sell <b>${ship.name}</b> for approximately <b>${price}g</b>?`);
            cHtml += '<div style="display:flex;gap:6px;margin-top:10px;">';
            cHtml += `<button onclick="window._doSellShip('${sid}')" style="${BTN_RED} flex:1; margin:0;">Confirm</button>`;
            cHtml += `<button onclick="ActionMenu._showShipManagePanel(window._game, window._tile, '${sid}')" style="${BTN_PLAIN} flex:1; margin:0;">Cancel</button>`;
            cHtml += '</div>';
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
        let html = lede(`⬆️ Upgrade ${st.icon} <b>${ship.name}</b>. Install additional upgrades while docked.`);
        html += chips([purse(player.gold)]);

        if (upgrades.length === 0) {
            html += `<div style="${MUTED} padding:8px 0;">No upgrades available for this ship.</div>`;
        } else {
            html += '<div class="pk-rows">';
            for (const c of upgrades) {
                const efParts = [];
                if (c.effects.speedBonus) efParts.push(`+${c.effects.speedBonus} speed`);
                if (c.effects.cargoBonus) efParts.push(`+${c.effects.cargoBonus} cargo`);
                if (c.effects.combatBonus) efParts.push(`+${c.effects.combatBonus} combat`);
                if (c.effects.armorBonus) efParts.push(`+${c.effects.armorBonus} armor`);
                if (c.effects.crewBonus) efParts.push(`+${c.effects.crewBonus} crew`);
                if (c.effects.stealthBonus) efParts.push(`stealth ${c.effects.stealthBonus >= 0 ? '+' : ''}${c.effects.stealthBonus}`);
                if (c.effects.explorationBonus) efParts.push(`explore +${c.effects.explorationBonus}`);
                if (c.effects.captureBonus) efParts.push(`${Math.round(c.effects.captureBonus * 100)}% prize capture`);
                if (c.effects.fishingBonus) efParts.push(`+${c.effects.fishingBonus} fishing casts`);
                if (c.effects.renownBonus) efParts.push(`+${c.effects.renownBonus} renown`);
                if (c.effects.charismaBonus) efParts.push(`+${c.effects.charismaBonus} charisma`);
                // A row that is a label: the whole row ticks its box
                html += `<label class="pk-row pk-row--act" style="cursor:pointer;">`
                    + `<span class="pk-row-ico"><input type="checkbox" class="shipUpgradeCheck" value="${c.id}" data-cost="${c.cost}" /></span>`
                    + `<span class="pk-row-txt"><span class="pk-row-name">${c.icon} ${c.name}</span><span class="pk-row-desc">${c.description}</span>${efParts.length ? `<span class="pk-row-note">${efParts.join(' · ')}</span>` : ''}</span>`
                    + `<span class="pk-row-side"><span class="pk-price">+${c.cost}<small>g</small></span></span>`
                    + '</label>';
            }
            html += '</div>';
        }

        html += `<div id="shipUpgradeTotal" class="pk-card" style="font-size:13px; font-weight:600; color:#ffcf6a;">Total: 0g</div>`;
        html += `<button onclick="window._confirmShipUpgrade('${ship.id}')" style="${BTN_GOLD}${WIDE}">Install Upgrades</button>`;
        html += `<button onclick="ActionMenu._showShipManagePanel(window._game, window._tile, '${ship.id}')" style="${BTN_PLAIN}${WIDE}">← Back to Ship</button>`;

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
        const sailSpeed = Ships.getSailingSpeed(game.player, ship);


        // Find coastal settlements the ship can move to
        const allSettlements = game.world.getAllSettlements();
        const coastalDests = allSettlements.filter(s => {
            if (s.q === tile.q && s.r === tile.r) return false;
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = game.world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });
        });

        let html = lede(`🧭 Move <b>${ship.name}</b>. Choose a destination port; travel time depends on ship speed.`);
        html += chips([['⚓', 'Speed', sailSpeed]]);

        if (coastalDests.length === 0) {
            html += `<div style="${MUTED} padding:8px 0;">No reachable ports found.</div>`;
        }
        html += rowList(coastalDests.map(dest => {
            const dist = Hex.distance(tile.q, tile.r, dest.q, dest.r);
            const travelDays = Math.max(1, Math.ceil(dist / sailSpeed));
            return {
                icon: '⚓', name: `${dest.name} (${dest.type})`, desc: `${dist} hexes · ~${travelDays} days`,
                attrs: `onclick="window._sendShipTo('${ship.id}', ${dest.q}, ${dest.r}, '${dest.name.replace(/'/g, "\\'")}')"`,
                side: 'Send Ship', tone: 'gold',
            };
        }), 'Ports');

        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="${BTN_PLAIN}${WIDE}">← Back to Shipyard</button>`;
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

    /**
     * The docks' hiring hall: every ship of yours lying here short of hands,
     * what each still needs, and a button to sign them on (Ships.hireCrew).
     */
    showHireSailorsMenu(game, tile) {
        const player = game.player;
        const crewCfg = Ships._getCrewSettings();
        const rows = Ships.shortHandedAt(player, game.world, tile.q, tile.r);

        let html = chips([purse(player.gold), ['', 'To sign on', `${crewCfg.hireCostPerSailor}g each`], ['', 'Wages', `${crewCfg.wagePerSailorPerDay}g a day`]]);
        html += bullets([
            `Sailors sign on for ${crewCfg.hireCostPerSailor}g each and draw ${crewCfg.wagePerSailorPerDay}g a day in wages.`,
            'A ship needs at least part of its crew to leave port; short-handed she sails slower and fights weaker.',
        ]);
        if (!rows.length) {
            html += `<div style="${MUTED} padding:8px 0;">Every ship of yours docked here is fully crewed.</div>`;
        }
        const shipRows = [];
        for (const { ship, open, cost } of rows) {
            const st = Ships.getShipType(ship.typeId) || {};
            const need = Ships.getShipEffectiveStats(ship).crewRequired;
            const crew = Ships.getCrew(ship);
            const canSail = crew >= Ships.getMinCrew(ship);
            const affordable = Math.min(open, Math.floor((player.gold || 0) / Math.max(1, crewCfg.hireCostPerSailor)));
            let hire;
            if (affordable >= open) {
                hire = `<button onclick="window._hireSailors('${ship.id}')" style="${BTN_GOLD}">Hire ${open} sailors (${cost}g)</button>`;
            } else if (affordable > 0) {
                hire = `<button onclick="window._hireSailors('${ship.id}')" style="${BTN_GOLD}">Hire ${affordable} of ${open} (${Ships.getHireCost(affordable)}g, all you can afford)</button>`;
            } else {
                hire = `<span style="font-size:11px; color:#c98a6a; margin-right:6px;">Not enough gold: ${crewCfg.hireCostPerSailor}g per sailor.</span>`;
            }
            shipRows.push(actRow({
                icon: st.icon || '⛵', name: ship.name,
                desc: `${canSail ? 'Can sail, but short-handed.' : `Needs ${Ships.getMinCrew(ship)} to leave port.`} ${open} berth${open === 1 ? '' : 's'} empty · wages afterwards ${need * crewCfg.wagePerSailorPerDay}g/day`,
                note: `<span style="display:block; margin-top:3px;">${hire}<button onclick="window._hireSailorsManage('${ship.id}')" style="${BTN_PLAIN}">⚙️ Ship</button></span>`,
                side: `<span style="color:${canSail ? '#f0b35a' : '#e0846a'};">${crew}/${need} crew</span>`,
            }));
        }
        html += rowList(shipRows, '👥 Hire Sailors');
        game.ui.showCustomPanel('👥 Hire Sailors', html);

        window._hireSailors = (sid) => {
            const result = Ships.hireCrew(player, game.world, sid);
            game.ui.showNotification(result.success ? '👥 Crew Hired' : 'Cannot Hire', result.message, result.success ? 'success' : 'error');
            if (result.success) {
                game.ui.updateStats(player, game.world);
                ActionMenu.showHireSailorsMenu(game, tile);
            }
        };
        window._hireSailorsManage = (sid) => ActionMenu._showShipManagePanel(game, tile, sid);
    },

    showBoardShipMenu(game, tile) {
        const player = game.player;
        const dockedShips = Ships.getShipsAt(player, tile.q, tile.r);

        let html = lede('🚢 Board a ship to sail across the waters.');
        html += chips([['⚓', 'Docked', dockedShips.filter(s => s.status === 'docked').length]]);

        let shown = 0;
        for (const ship of dockedShips) {
            if (ship.status !== 'docked') continue;
            const st = Ships.getShipType(ship.typeId);
            if (!st) continue;
            const eff = Ships.getShipEffectiveStats(ship);
            shown++;
            const condition = Math.max(0, Math.min(100, Number(ship.condition || 0)));
            const conditionColor = condition >= 70 ? '#8fd18a' : condition >= 40 ? '#f0b35a' : '#e0846a';
            const boardFood = Ships.getProvisionDays(ship);
            let body = condBar(condition, conditionColor);
            body += pills([['⚓', eff.speed], ['⚔️', eff.combatStrength], ['📦', eff.cargoCapacity], ['👥', `${Ships.getCrew(ship)}/${eff.crewRequired}`], ['🙂', Ships.getMorale(ship)], ['🍞', boardFood === Infinity ? '—' : `${boardFood}d`]]);
            const noCrew = Ships.crewSailReason(ship);
            if (noCrew) {
                body += `<div style="font-size:11px;color:#c98a6a;margin-top:4px;">${noCrew}</div>`;
            } else {
                if (Ships.getCrewRatio(ship) < 1) {
                    body += `<div style="font-size:11px;color:#f0b35a;margin-top:4px;">Short-handed: sails slower and fights worse.</div>`;
                }
                body += rowList([
                    { icon: '🧭', name: 'Voyage to a Port', desc: 'Set a course; the days at sea pass on the way', attrs: `onclick="ActionMenu._showSailToMenu(window._game, window._tile, '${ship.id}')"`, side: '›', tone: 'gold' },
                    { icon: '⛵', name: 'Board & Take the Helm', desc: 'Sail her yourself, hex by hex', attrs: `onclick="window._boardShip('${ship.id}')"`, side: '›', tone: 'gold' },
                ]);
            }
            html += card(body, { icon: st.icon, title: ship.name, side: `<span style="color:${conditionColor};">${condition}%</span>` });
        }

        if (shown === 0) {
            html += `<div style="${MUTED} padding:8px 0;">No docked ships are ready to board at this port.</div>`;
        }

        html += `<button onclick="ActionMenu.showShipyardMenu(window._game, window._tile)" style="${BTN_PLAIN}${WIDE}">← Back to Shipyard</button>`;
        game.ui.showCustomPanel('🚢 Board Ship', html);
        window._game = game;
        window._tile = tile;

        window._boardShip = (shipId) => {
            // Board the ship (needs a skeleton crew)
            const boarded = Ships.boardShip(player, shipId, game.world);
            if (!boarded.success) {
                game.ui.showNotification('Cannot Sail', boarded.message, 'error');
                return;
            }
            const ship = boarded.ship;

            game.ui.hideCustomPanel();
            game.ui.showNotification('⛵', `You board the ${ship.name}. You can now sail across water tiles!`, 'success');
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Explore, hunt pirates or turn pirate from the boarded ship — each a
     * choice scene in phases (systems/pirates.js, ui/actionMenu/seaScenes.js);
     * raid a known pirate haven beside the ship; or read the Sea Rovers log.
     */
    doSeaActivity(game, activity) {
        const player = game.player;
        if (activity === 'sea_rovers') {
            ActionMenu.showScene(game, 'sea', { kind: 'log' });
            return;
        }
        if (!player.boardedShip) {
            game.ui.showNotification('Not at Sea', 'You need to be aboard your ship on open water.', 'error');
            return;
        }
        if (activity === 'raid_haven') {
            const raid = Pirates.startHavenRaid(player, game.world);
            if (!raid) {
                game.ui.showNotification('No Haven', 'There is no pirate haven you know of beside your ship.', 'error');
                return;
            }
            ActionMenu.showScene(game, 'sea', raid);
            return;
        }
        const run = { explore_ocean: 'explore', hunt_pirates: 'hunt', commit_piracy: 'prey' }[activity];
        if (!run) {
            game.ui.showNotification('At Sea', 'Nothing to do here.', 'error');
            return;
        }
        const res = Pirates.start(player, game.world, run);
        if (res.success === false) {
            game.ui.showNotification('At Sea', res.message, 'error');
            return;
        }
        if (res.state) {
            ActionMenu.showScene(game, 'sea', res.state);
            return;
        }
        // Empty seas, or an uncharted place found (systems/discovery.js)
        const n = res.notification;
        if (n) game.ui.showNotification(n.title, n.body, n.type);
        for (const x of (res.notices || []).filter(x => !x.title.startsWith('Discovery'))) game.ui.showNotification(`${x.icon} ${x.title}`, x.text, x.type);
        game.ui.updateStats(player, game.world);
    },

    /**
     * Port market: buy trade goods into a docked ship's hold and sell them.
     * Ports export some goods cheaply and import others at a premium.
     */
    showPortMarketMenu(game, shipId = null) {
        const player = game.player;
        const world = game.world;
        const ships = Ships.getShipsWithHoldAccess(player).filter(s => s.status === 'docked');
        if (ships.length === 0 || !Ships.isPortTile(world, player.q, player.r)) {
            game.ui.showNotification('No Ship in Port', 'Dock one of your ships at this port to trade by sea.', 'error');
            return;
        }
        const ship = ships.find(s => s.id === shipId) || ships[0];
        const stats = Ships.getShipEffectiveStats(ship);
        const market = Ships.getPortMarket(world, player.q, player.r);
        const blockade = Ships.getPortBlockade(world, player.q, player.r);
        const daysToDrift = Ships.PORT_PRICE_PERIOD - ((world.day || 0) % Ships.PORT_PRICE_PERIOD);
        const esc = (id) => String(id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const btn = BTN_DARK;
        const roleTag = {
            export: '<span style="color:#8fd18a;">exports — cheap</span>',
            import: '<span style="color:#ffcf6a;">imports — pays well</span>',
            local: '<span style="color:#9d937c;">local market</span>',
        };

        let html = '';
        if (ships.length > 1) html += shipPicker(ships, ship, s => `ActionMenu.showPortMarketMenu(window._game, '${esc(s.id)}')`);
        html += chips([purse(player.gold), ['📦', 'Hold', `${Ships.getCargoUsed(ship)} / ${stats.cargoCapacity}`], ['⏳', 'Prices change in', `${daysToDrift} day(s)`]]);
        html += lede('Buy where a good is exported, sell where it is imported.');
        if (blockade) {
            const by = blockade.blockaders.map(k => k.name).join(' and ');
            html += blockade.closed
                ? `<div style="font-size:12px;color:#f0b35a;margin-bottom:8px;">⚓ The harbour is closed: ${by} blockades the ports of ${blockade.kingdom.name}. No merchant will trade until the blockade is broken.</div>`
                : `<div style="font-size:11px;color:#f0b35a;margin-bottom:8px;">⚓ ${by} blockades the ports of ${blockade.kingdom.name}: goods are dear and buyers pay little.</div>`;
        }
        html += rowList(market.map(e => {
            const held = (ship.cargo && ship.cargo[e.id]) || 0;
            let buttons = '';
            if (e.buy !== null) {
                buttons += `<button onclick="window._portBuy('${esc(e.id)}', 1)" style="${btn}">Buy 1</button>`;
                buttons += `<button onclick="window._portBuy('${esc(e.id)}', 9999)" style="${btn}">Fill</button>`;
            }
            if (held > 0) buttons += `<button onclick="window._portSell('${esc(e.id)}', ${held})" style="${BTN_GOLD}">Sell all</button>`;
            return actRow({
                icon: e.icon, name: `${e.name} <span style="font-size:10px;font-weight:400;">${roleTag[e.role]}</span>`,
                desc: `${e.buy !== null ? `Buy ${e.buy}g · ` : ''}Sell ${e.sell}g · In hold: ${held}`,
                side: buttons,
            });
        }), 'Goods');
        game.ui.showCustomPanel('⚓ Port Market', html);
        window._game = game;

        const after = (result) => {
            if (!result.success) game.ui.showNotification('Port Market', result.message, 'error');
            game.ui.updateStats(player, world);
            ActionMenu.showPortMarketMenu(game, ship.id);
        };
        window._portBuy = (id, qty) => after(Ships.buyTradeGood(player, world, ship.id, id, qty));
        window._portSell = (id, qty) => after(Ships.sellTradeGood(player, world, ship.id, id, qty));
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
        game.recenterCamera();
    },

    /** Describe what cargo came ashore and what had to stay aboard. */
    _landingCargoText(result) {
        const { cargo, isPort } = result;
        let text = '';
        if (cargo.total > 0) {
            const items = Object.entries(cargo.moved).map(([id, n]) => `${n} ${id.replace(/_/g, ' ')}`).join(', ');
            text += ` Brought ashore: ${items}.`;
        }
        if (cargo.packsFull) {
            text += ` Your packs are full — ${Object.keys(cargo.leftAboard).map(id => id.replace(/_/g, ' ')).join(', ')} stays in the hold.`;
        } else if (cargo.remaining > 0 && !isPort) {
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
        let html = lede(`The ${ship.name} drops anchor here while you row ashore.`);
        html += bullets([`Without a dock or port, only ${Ships.LANDING_BOAT_CAPACITY} cargo fits in the boat.`]);
        html += rowList(targets.map(t => {
            const isPort = Ships.hasDock(game.world, t.q, t.r);
            const dockLabel = t.settlement ? '⚓ Port' : '⚓ Jetty';
            const name = t.settlement ? t.settlement.name : (t.terrain.name || t.terrain.id);
            return {
                icon: t.terrain.icon || '🏝️', name,
                desc: `(${t.q}, ${t.r}) · ${isPort ? `${dockLabel} — unload everything` : 'Open shore — boat-load only'}`,
                attrs: `onclick="window._rowAshore(${t.q}, ${t.r})"`, side: 'Row', tone: 'gold',
            };
        }), 'Landings');
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
        const btn = BTN_DARK;
        const row = (label, qty, buttons) => actRow({
            name: `${label} <span style="color:#9d937c; font-weight:400;">×${qty}</span>`,
            side: buttons,
        });

        let html = '';
        if (ships.length > 1) html += shipPicker(ships, ship, s => `ActionMenu.showShipHoldMenu(window._game, '${esc(s.id)}')`);
        html += chips([
            ['📦', 'Hold', `${Ships.getCargoUsed(ship)} / ${stats.cargoCapacity}`],
            allowance === Infinity ? '⚓ Port — no limit on transfers.' : `🚣 Boat trips left today: <b>${allowance}</b> cargo (no dock here).`,
        ]);

        const hold = Object.entries(ship.cargo || {}).filter(([, n]) => n > 0);
        html += sectionHead(`⛵ In the ${ship.name}'s hold`);
        if (hold.length === 0) html += `<div style="${MUTED} margin-bottom:6px;">The hold is empty.</div>`;
        html += rowList(hold.map(([id, n]) => row(goodName(id), n,
            `<button onclick="window._shipHoldUnload('${esc(id)}', 1)" style="${btn}">Unload 1</button>` +
            `<button onclick="window._shipHoldUnload('${esc(id)}', ${n})" style="${btn}">Unload all</button>`)));

        const pack = Object.entries(player.inventory || {}).filter(([, n]) => n > 0);
        html += sectionHead('🎒 Your pack');
        if (pack.length === 0) html += `<div style="${MUTED}">You carry nothing to load.</div>`;
        html += rowList(pack.map(([id, n]) => row(goodName(id), n,
            `<button onclick="window._shipHoldLoad('${esc(id)}', 1)" style="${btn}">Load 1</button>` +
            `<button onclick="window._shipHoldLoad('${esc(id)}', ${n})" style="${btn}">Load all</button>`)));
        game.ui.showCustomPanel("📦 Ship's Hold", html);
        window._game = game;

        const after = (result) => {
            if (!result.success) game.ui.showNotification("Ship's Hold", result.message, 'error');
            else if (result.cargo && result.cargo.packsFull) game.ui.showNotification("Ship's Hold", 'Your packs are full — sell or drop something to make room.', 'warning');
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


        // Ports this ship can reach by sea, nearest first (from the helm: where you are now)
        const atHelm = player.boardedShip === ship.id;
        const fromQ = atHelm ? player.q : ship.q;
        const fromR = atHelm ? player.r : ship.r;
        const routes = Ships.seaRoutes(game.world, fromQ, fromR).slice(0, 24);
        const speed = Ships.getSailingSpeed(player, ship);
        const food = Ships.getProvisionDays(ship);
        const price = Ships.provisionPrice(game.world, ship.q, ship.r);
        const perDay = Ships.getDailyRations(ship);
        const st = Ships.getShipType(ship.typeId);
        const costPerDay = (st ? st.dailyUpkeep : 5) + Ships.getDailyWages(ship);

        let html = lede(`🧭 Voyage in <b>${ship.name}</b>. Each day at sea is a day: ${costPerDay}g upkeep and wages, ${Math.round(perDay * 10) / 10} provisions eaten, and whatever the sea sends.`);
        html += chips([['⚓', '', `${speed}/day`], ['🍞', '', food === Infinity ? '—' : `${food}d`]]);

        if (routes.length === 0) {
            html += `<div style="${MUTED} padding:8px 0;">No port can be reached by sea from here.</div>`;
        }

        // Expeditions: into open sea, or after a rumour or a chart (systems/discovery.js)
        const expeditions = Discovery.expeditionTargets(player, game.world, ship);
        const spare = Discovery.config().expedition.victualDays;
        if (expeditions.length) {
            html += rowList(expeditions.map(ex => {
                const days = Ships.voyageDays(player, ship, ex.leagues);
                const need = Ships.provisionsNeeded(ship, days * 2 + spare, { player });
                return {
                    icon: '🗺️', name: `Toward ${ex.name}`,
                    desc: `${ex.leagues} leagues · ~${days} day${days === 1 ? '' : 's'} out, as many back`,
                    attrs: `onclick="window._doExpedition('${ship.id}', '${ex.id}', ${need > 0 ? days * 2 + spare : 0})"`,
                    side: need > 0 ? `🍞 Victual & Sail (${need * price}g)` : 'Sail', tone: 'gold',
                };
            }), '🗺️ Expeditions — end at sea, you at the helm');
        }

        const routeRows = [];
        for (const dest of routes) {
            const days = Ships.voyageDays(player, ship, dest.distance);
            const short = food !== Infinity && food < days + 1;
            const need = Ships.provisionsNeeded(ship, days + 2, { player });
            const safeName = dest.name.replace(/'/g, "\\'");
            const o = {
                icon: '⚓', name: `${dest.name} <span style="font-weight:400;color:#9d937c;">(${dest.type})</span>`,
                desc: `${dest.distance} leagues by sea · ~${days} day${days === 1 ? '' : 's'} · ~${days * costPerDay}g on the way`,
                note: short ? `<span style="color:#c98a6a;">Provisions for ${food} day${food === 1 ? '' : 's'} — victual first or the crew goes hungry.</span>` : '',
            };
            const sail = `window._doSailTo('${ship.id}', ${dest.q}, ${dest.r}, '${safeName}', 0)`;
            if (short && need > 0) {
                // Two ways to go: buttons at the right, the row itself not clickable
                o.side = `<button onclick="window._doSailTo('${ship.id}', ${dest.q}, ${dest.r}, '${safeName}', ${days + 2})" style="${BTN_GOLD}" title="${need} provisions at ${price}g">🍞 Victual & Sail (${need * price}g)</button>`
                    + `<button onclick="${sail}" style="${BTN_PLAIN}">Sail</button>`;
            } else {
                o.attrs = `onclick="${sail}"`;
                o.side = 'Sail';
                o.tone = 'gold';
            }
            routeRows.push(o);
        }
        html += rowList(routeRows, 'Ports');

        html += `<button onclick="ActionMenu.showBoardShipMenu(window._game, window._tile)" style="${BTN_PLAIN}${WIDE}">← Back to Board Ship</button>`;
        game.ui.showCustomPanel('Set Sail', html);
        window._game = game;
        window._tile = tile;

        window._doSailTo = (sid, dq, dr, dname, victualDays) => {
            game.ui.hideCustomPanel();
            beginVoyage(game, sid, dq, dr, dname, victualDays);
        };
        window._doExpedition = (sid, targetId, victualDays) => {
            game.ui.hideCustomPanel();
            beginVoyage(game, sid, null, null, null, victualDays, () => Discovery.startExpedition(player, game.world, sid, targetId));
        };
    },

    showFleetMenu(game, tile) {
        const player = game.player;
        const allShips = player.ships || [];

        let html = '';

        if (allShips.length === 0) {
            html += lede('You do not own any ships.');
        }
        const escort = Ships.getEscortStrength(player);
        if (escort > 0) {
            html += chips([['⛵', 'War galleys escorting', Ships.getSquadron(player).length], ['⚔️', 'In every sea fight', `+${escort} strength`, 'gold']]);
        }

        html += rowList(allShips.map(ship => {
            const st = Ships.getShipType(ship.typeId);
            if (!st) return null;
            const statusIcon = ship.status === 'docked' ? '⚓' : ship.status === 'building' ? '🏗️' : ship.status === 'moving' ? '🧭' : '⚓';
            const fleetFood = Ships.getProvisionDays(ship);
            const facts = [
                `📍 ${ship.dockedAt || ship.destinationName || 'Unknown'}`,
                `🔧 ${ship.condition}%`,
                `👥 ${Ships.getCrew(ship)}/${Ships.getShipEffectiveStats(ship).crewRequired}`,
                `🙂 ${Ships.getMorale(ship)}`,
                `🍞 ${fleetFood === Infinity ? '—' : `${fleetFood}d`}`,
            ];
            if (ship.voyage) facts.push(`🧭 → ${ship.voyage.destName}`);
            if (ship.status === 'building') facts.push(`🏗️ ${ship.buildDaysLeft} days left`);
            if (ship.status === 'moving') facts.push(`🧭 ${ship.travelDaysLeft || '?'} days ETA`);
            return { icon: st.icon, name: ship.name, desc: facts.join(' · '), side: `${statusIcon} ${ship.status}` };
        }), '⚓ Your Fleet');
        game.ui.showCustomPanel('⚓ Fleet Overview', html);
    },
});
