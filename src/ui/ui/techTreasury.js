// UI — techTreasury methods.
import { UI } from './core.js';
import { Utils, ActionMenu, Religion, Economy, PlayerEconomy, PlayerReligion, Infrastructure, Peoples, CustomObjects, Characters, Culture, Quests, Technology, Banking, MarketDynamics, Taxation, Hex, SaveLoad, audioManager, NpcFamily, Relationships, Housing } from './_imports.js';

Object.assign(UI.prototype, {
    /**
     * Show Technology & Research Panel
     */
    showTechnologyPanel(player, world) {
        if (typeof Technology === 'undefined') {
            this.showNotification('Unavailable', 'Technology system not loaded', 'error');
            return;
        }

        Technology.initPlayer(player);

        const categories = Technology.getTechsByCategory();
        const researched = player.technology.researched;
        const implemented = player.technology.implemented;
        const current = player.technology.currentResearch;
        const currentCraft = player.technology.currentCrafting;

        // ── Header: Current Research & Crafting Status ──
        let statusHtml = '';

        if (current) {
            const tech = Technology.getTechByID(current.techId);
            const pct = Math.floor((current.progress / current.totalDays) * 100);
            const remaining = current.totalDays - current.progress;
            statusHtml += `
                <div style="background: rgba(156, 39, 176, 0.15); border: 1px solid rgba(156, 39, 176, 0.4); border-radius: 6px; padding: 14px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div>
                            <span style="font-size: 18px;">🔬</span>
                            <strong style="color: var(--gold); margin-left: 4px;">Researching: ${tech.name}</strong>
                            <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">${remaining} day${remaining !== 1 ? 's' : ''} remaining</span>
                        </div>
                        <button onclick="window.cancelResearch()" style="padding: 4px 12px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">Cancel</button>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 4px; height: 8px; overflow: hidden;">
                        <div style="background: linear-gradient(90deg, #9c27b0, #e040fb); height: 100%; width: ${pct}%;"></div>
                    </div>
                </div>
            `;
        }

        if (currentCraft) {
            const recipe = Technology.PARTS_CRAFTING[currentCraft.partsType];
            const craftPct = Math.floor((currentCraft.progress / currentCraft.totalDays) * 100);
            const craftRemaining = currentCraft.totalDays - currentCraft.progress;
            statusHtml += `
                <div style="background: rgba(255, 152, 0, 0.12); border: 1px solid rgba(255, 152, 0, 0.4); border-radius: 6px; padding: 14px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div>
                            <span style="font-size: 18px;">🔧</span>
                            <strong style="color: #ff9800; margin-left: 4px;">Crafting: ${recipe ? recipe.name : currentCraft.partsType}</strong>
                            <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">${craftRemaining} day${craftRemaining !== 1 ? 's' : ''} left — ${currentCraft.quantity} parts</span>
                        </div>
                        <button onclick="window.cancelCrafting()" style="padding: 4px 12px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">Cancel</button>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 4px; height: 8px; overflow: hidden;">
                        <div style="background: linear-gradient(90deg, #ff9800, #ffb74d); height: 100%; width: ${craftPct}%;"></div>
                    </div>
                </div>
            `;
        }

        if (!current && !currentCraft) {
            statusHtml += `
                <div style="background: rgba(255,255,255,0.04); border: 1px dashed rgba(255,255,255,0.15); border-radius: 6px; padding: 12px; margin-bottom: 8px; text-align: center; color: var(--text-secondary);">
                    No active research or crafting. Build a lab on a property to begin.
                </div>
            `;
        }

        // ── Labs Overview ──
        const labs = Technology.getPlayerLabs(player, world);
        let labsHtml = '<div style="margin-bottom: 12px;">';
        if (labs.length === 0) {
            labsHtml += '<div style="font-size: 12px; color: #e74c3c; padding: 6px 8px; background: rgba(231,76,60,0.08); border-radius: 4px;">⚠️ You have no labs. Build a lab on a Farm, Workshop, or Trading Post to research.</div>';
        } else {
            labsHtml += '<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px;">Your Labs</div>';
            labsHtml += '<div style="display: flex; gap: 6px; flex-wrap: wrap;">';
            for (const lab of labs) {
                const catNames = lab.config.categories.map(c => {
                    const cat = Object.values(Technology.CATEGORIES).find(cc => cc.id === c);
                    return cat ? cat.icon : c;
                }).join(' ');
                labsHtml += `<div style="padding: 4px 10px; background: rgba(156,39,176,0.1); border: 1px solid rgba(156,39,176,0.2); border-radius: 4px; font-size: 12px;">${lab.property.labIcon || '🔬'} ${lab.property.labName || lab.config.labName} ${catNames}</div>`;
            }
            labsHtml += '</div>';
        }
        labsHtml += '</div>';

        // ── Parts Inventory ──
        let partsHtml = '<div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">';
        for (const [cat, partsType] of Object.entries(Technology.CATEGORY_PARTS)) {
            const qty = (player.inventory && player.inventory[partsType]) || 0;
            const recipe = Technology.PARTS_CRAFTING[partsType];
            partsHtml += `<div style="padding: 4px 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; font-size: 12px;">${recipe ? recipe.icon : '🔧'} ${recipe ? recipe.name : partsType}: <strong>${qty}</strong></div>`;
        }
        partsHtml += '</div>';

        // ── Stats ──
        const statsHtml = `
            <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
                <div style="background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 4px; flex: 1; min-width: 80px; text-align: center;">
                    <div style="font-size: 11px; color: var(--text-secondary);">Researched</div>
                    <div style="font-weight: bold; color: #ce93d8;">${researched.length}</div>
                </div>
                <div style="background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 4px; flex: 1; min-width: 80px; text-align: center;">
                    <div style="font-size: 11px; color: var(--text-secondary);">Implemented</div>
                    <div style="font-weight: bold; color: #4caf50;">${implemented.length}</div>
                </div>
                <div style="background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 4px; flex: 1; min-width: 80px; text-align: center;">
                    <div style="font-size: 11px; color: var(--text-secondary);">Intelligence</div>
                    <div style="font-weight: bold;">${player.intelligence || 5}</div>
                </div>
                <div style="background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 4px; flex: 1; min-width: 80px; text-align: center;">
                    <div style="font-size: 11px; color: var(--text-secondary);">Gold</div>
                    <div style="font-weight: bold; color: var(--gold);">${Math.floor(player.gold)}</div>
                </div>
            </div>
        `;

        // ── Category Tabs ──
        const catKeys = Object.keys(Technology.CATEGORIES);
        let tabsHtml = '<div style="display: flex; gap: 2px; margin-bottom: 12px; flex-wrap: wrap;">';
        for (let i = 0; i < catKeys.length; i++) {
            const cat = Technology.CATEGORIES[catKeys[i]];
            const isActive = i === 0;
            const hasLab = Technology.hasLabForCategory(player, cat.id, world);
            tabsHtml += `<button data-ui-act="openTechTab" data-ui-args='["${cat.id}"]' data-ui-el="1" class="tech-tab-btn" style="flex:1; min-width: 70px; padding:6px 4px; background:${isActive ? 'rgba(255,255,255,0.1)' : 'none'}; border:none; color:${isActive ? 'var(--gold)' : hasLab ? 'var(--text-secondary)' : '#666'}; cursor:pointer; border-bottom:2px solid ${isActive ? cat.color : 'transparent'}; font-size: 11px; font-weight: ${isActive ? 'bold' : 'normal'};">${cat.icon} ${cat.name}${!hasLab ? ' 🔒' : ''}</button>`;
        }
        tabsHtml += '</div>';

        // ── Tech Lists by Category ──
        let techListsHtml = '';
        for (const catKey of catKeys) {
            const cat = Technology.CATEGORIES[catKey];
            const techs = categories[cat.id] || [];
            const isFirst = catKey === catKeys[0];
            const hasLab = Technology.hasLabForCategory(player, cat.id, world);
            const requiredPropType = Technology.getRequiredPropertyType(cat.id);
            const labConfig = Technology.LAB_CONFIG[requiredPropType];

            techListsHtml += `<div id="techTab_${cat.id}" class="tech-tab-content" style="display:${isFirst ? 'block' : 'none'};">`;

            if (!hasLab) {
                techListsHtml += `<div style="padding: 12px; background: rgba(231,76,60,0.08); border: 1px dashed rgba(231,76,60,0.3); border-radius: 6px; margin-bottom: 12px; color: var(--text-secondary); font-size: 13px;">
                    🔒 <strong>Lab Required</strong> — Build a <em>${labConfig ? labConfig.labName : 'lab'}</em> on a ${requiredPropType ? requiredPropType.replace(/_/g, ' ') : 'property'} to research ${cat.name} technologies.
                </div>`;
            }

            // Group by tier
            const tiers = {};
            for (const tech of techs) {
                if (!tiers[tech.tier]) tiers[tech.tier] = [];
                tiers[tech.tier].push(tech);
            }

            for (const [tier, tierTechs] of Object.entries(tiers)) {
                techListsHtml += `<div style="margin-bottom: 4px; font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px;">Tier ${tier}</div>`;

                for (const tech of tierTechs) {
                    const status = Technology.getTechStatus(player, tech.id);
                    const info = Technology.getResearchInfo(tech.id);
                    const canRes = Technology.canResearch(player, tech.id, world);
                    const canImpl = Technology.canImplement(player, tech.id);
                    const prereqsMet = tech.requires.every(r => researched.includes(r));

                    let statusIcon = '🔒';
                    let borderColor = 'rgba(255,255,255,0.08)';
                    let bgColor = 'rgba(255,255,255,0.02)';
                    let opacity = '0.5';
                    let statusLabel = '';

                    if (status === 'implemented') {
                        statusIcon = '✅';
                        borderColor = 'rgba(76, 175, 80, 0.4)';
                        bgColor = 'rgba(76, 175, 80, 0.08)';
                        opacity = '1';
                        statusLabel = '<span style="color: #4caf50; font-weight: bold; font-size: 11px;">ACTIVE</span>';
                    } else if (status === 'researched') {
                        statusIcon = '🔧';
                        borderColor = 'rgba(255, 152, 0, 0.4)';
                        bgColor = 'rgba(255, 152, 0, 0.08)';
                        opacity = '1';
                        statusLabel = '<span style="color: #ff9800; font-weight: bold; font-size: 11px;">NEEDS PARTS</span>';
                    } else if (status === 'in_progress') {
                        statusIcon = '⏳';
                        borderColor = 'rgba(156, 39, 176, 0.5)';
                        bgColor = 'rgba(156, 39, 176, 0.1)';
                        opacity = '1';
                        statusLabel = '<span style="color: #e040fb; font-weight: bold; font-size: 11px;">IN PROGRESS</span>';
                    } else if (canRes.can) {
                        statusIcon = '🔓';
                        borderColor = 'rgba(245, 197, 66, 0.4)';
                        bgColor = 'rgba(245, 197, 66, 0.06)';
                        opacity = '1';
                    } else if (prereqsMet) {
                        statusIcon = '🔓';
                        opacity = '0.7';
                    }

                    // Effects
                    let effectsHtml = '';
                    const e = tech.effects;
                    const effectParts = [];
                    if (e.farmProductionBonus) effectParts.push(`🌾+${Math.round(e.farmProductionBonus * 100)}%`);
                    if (e.pastureProductionBonus) effectParts.push(`🐑+${Math.round(e.pastureProductionBonus * 100)}%`);
                    if (e.mineProductionBonus) effectParts.push(`⛏️+${Math.round(e.mineProductionBonus * 100)}%`);
                    if (e.loggingProductionBonus) effectParts.push(`🪓+${Math.round(e.loggingProductionBonus * 100)}%`);
                    if (e.workshopProductionBonus) effectParts.push(`🔨+${Math.round(e.workshopProductionBonus * 100)}%`);
                    if (e.unitStrengthBonus) effectParts.push(`⚔️+${Math.round(e.unitStrengthBonus * 100)}%`);
                    if (e.tradeProfitBonus) effectParts.push(`💰+${Math.round(e.tradeProfitBonus * 100)}%`);
                    if (e.movementBonus) effectParts.push(`🏃+${e.movementBonus}`);
                    if (e.visionRadiusBonus) effectParts.push(`👁️+${e.visionRadiusBonus}`);
                    if (e.defenseBonus) effectParts.push(`🏰+${Math.round(e.defenseBonus * 100)}%`);
                    if (e.buildingCostReduction) effectParts.push(`🏗️-${Math.round(e.buildingCostReduction * 100)}%`);
                    if (e.unlockBuilding) effectParts.push(`🏠 ${e.unlockBuilding.replace(/_/g, ' ')}`);
                    if (e.unlockUnit) effectParts.push(`⚔️ ${e.unlockUnit.replace(/_/g, ' ')}`);
                    if (e.unlockInfrastructure) effectParts.push(`🛤️ ${e.unlockInfrastructure.replace(/_/g, ' ')}`);
                    if (e.unlockRecipe) effectParts.push(`📜 ${e.unlockRecipe.replace(/_/g, ' ')}`);
                    if (effectParts.length > 0) {
                        effectsHtml = `<div style="font-size: 11px; color: #81c784; margin-top: 3px;">${effectParts.join(' · ')}</div>`;
                    }

                    // Prerequisites
                    let prereqHtml = '';
                    if (tech.requires.length > 0) {
                        const prereqNames = tech.requires.map(r => {
                            const rt = Technology.getTechByID(r);
                            const done = researched.includes(r);
                            return `<span style="color: ${done ? '#4caf50' : '#e74c3c'};">${done ? '✓' : '✗'} ${rt ? rt.name : r}</span>`;
                        }).join(', ');
                        prereqHtml = `<div style="font-size: 11px; margin-top: 2px;">Requires: ${prereqNames}</div>`;
                    }

                    // Cost info
                    const materialsStr = Technology.formatMaterials(info.materials);
                    const costHtml = `<div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Research: ${info.gold}g${materialsStr ? ' + ' + materialsStr : ''} · ${info.days} days · ${info.partsToImplement} part${info.partsToImplement > 1 ? 's' : ''} to implement</div>`;

                    // Action button
                    let actionHtml = '';
                    if (status === 'implemented') {
                        actionHtml = statusLabel;
                    } else if (status === 'researched') {
                        if (canImpl.can) {
                            actionHtml = `<button onclick="window.implementTech('${tech.id}')" style="padding: 5px 10px; background: #ff9800; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; color: black;">Implement (${info.partsToImplement} parts)</button>`;
                        } else {
                            actionHtml = `<div style="font-size: 11px; color: #ff9800;">${canImpl.reason}</div>`;
                        }
                    } else if (status === 'in_progress') {
                        actionHtml = statusLabel;
                    } else if (canRes.can) {
                        actionHtml = `<button onclick="window.startResearch('${tech.id}')" style="padding: 5px 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">Research</button>`;
                    } else {
                        actionHtml = `<span style="font-size: 11px; color: #e74c3c;">${canRes.reason}</span>`;
                    }

                    techListsHtml += `
                        <div style="padding: 10px; margin-bottom: 6px; background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 6px; opacity: ${opacity};">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <div style="flex: 1;">
                                    <div>
                                        <span style="font-size: 16px;">${tech.icon}</span>
                                        <strong style="margin-left: 3px; font-size: 13px;">${tech.name}</strong>
                                        <span style="margin-left: 4px; font-size: 12px;">${statusIcon}</span>
                                    </div>
                                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${tech.description}</div>
                                    ${costHtml}
                                    ${effectsHtml}
                                    ${prereqHtml}
                                </div>
                                <div style="text-align: right; min-width: 85px; margin-left: 8px;">
                                    ${actionHtml}
                                </div>
                            </div>
                        </div>
                    `;
                }
            }

            techListsHtml += '</div>';
        }

        const html = statusHtml + labsHtml + partsHtml + statsHtml + tabsHtml + techListsHtml;
        this.showCustomPanel('🔬 Technology & Research', html);

        // Wire up global handlers
        window.startResearch = (techId) => {
            const result = Technology.startResearch(player, techId, world);
            if (result.success) {
                this.showNotification('Research Started', `${result.tech.name} — ${result.estimatedDays} days`, 'info');
                this.showTechnologyPanel(player, world);
                this.updateStats(player, world);
            } else {
                this.showNotification('Cannot Research', result.reason, 'error');
            }
        };

        window.cancelResearch = () => {
            const result = Technology.cancelResearch(player);
            if (result.success) {
                this.showNotification('Research Cancelled', `${result.tech.name} cancelled. Refund: ${result.refund} gold (materials lost)`, 'default');
                this.showTechnologyPanel(player, world);
                this.updateStats(player, world);
            }
        };

        window.cancelCrafting = () => {
            const result = Technology.cancelCrafting(player);
            if (result.success) {
                this.showNotification('Crafting Cancelled', `Refund: ${result.refund} gold (materials lost)`, 'default');
                this.showTechnologyPanel(player, world);
                this.updateStats(player, world);
            }
        };

        window.implementTech = (techId) => {
            const result = Technology.implementTech(player, techId);
            if (result.success) {
                this.showNotification('Tech Implemented!', `✅ ${result.tech.name} is now active!`, 'success');
                this.showTechnologyPanel(player, world);
                this.updateStats(player, world);
            } else {
                this.showNotification('Cannot Implement', result.reason, 'error');
            }
        };
    },

    /**
     * Open a tech tree category tab
     */
    openTechTab(tabId, btn) {
        // Hide all tech tab contents
        document.querySelectorAll('.tech-tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.tech-tab-btn').forEach(el => {
            el.style.background = 'none';
            el.style.color = 'var(--text-secondary)';
            el.style.borderBottom = '2px solid transparent';
            el.style.fontWeight = 'normal';
        });

        // Show selected tab
        const tabEl = document.getElementById('techTab_' + tabId);
        if (tabEl) tabEl.style.display = 'block';

        // Find category color
        const cat = Object.values(Technology.CATEGORIES).find(c => c.id === tabId);
        if (btn) {
            btn.style.background = 'rgba(255,255,255,0.1)';
            btn.style.color = 'var(--gold)';
            btn.style.borderBottom = `2px solid ${cat ? cat.color : 'var(--gold)'}`;
            btn.style.fontWeight = 'bold';
        }
    },

    /**
     * Show Treasury Panel: Market, Bank, Taxes
     */
    showTreasuryPanel(player, world) {
        // Prepare Market data - show local market prices
        const market = MarketDynamics.getMarketSummary(player.q, player.r, world);
        let marketHtml = `
            <div id="tabMarket" class="tab-content" style="display:block;">
                <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:4px; margin-bottom:15px;">
                    <div style="margin-bottom:10px; color:var(--text-secondary); font-style:italic;">Showing prices at: <span style="color:var(--gold);">${market.length > 0 && market[0].location ? market[0].location : 'Current Location'}</span></div>
                    <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap:10px; padding-bottom:5px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:5px; font-weight:bold; color:var(--text-secondary); font-size:12px;">
                        <div>Item</div>
                        <div style="text-align:right;">Price</div>
                        <div style="text-align:center;">Trend</div>
                        <div style="text-align:right;">Supply</div>
                        <div style="text-align:right;">Demand</div>
                    </div>
        `;

        for (const item of market) {
            let trendIcon = '➡️';
            let trendColor = '#95a5a6';
            if (item.trend === 'rising') { trendIcon = '↗️'; trendColor = '#2ecc71'; }
            else if (item.trend === 'falling') { trendIcon = '↘️'; trendColor = '#e74c3c'; }

            const priceColor = item.price > item.basePrice ? '#e74c3c' : (item.price < item.basePrice ? '#2ecc71' : 'var(--text-primary)');

            marketHtml += `
                <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap:10px; padding:8px 0; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; align-items:center;">
                        <span style="font-size:18px; margin-right:8px;">${item.icon || '📦'}</span>
                        <span style="color:var(--text-primary);">${item.name || item.id || 'Unknown Item'}</span>
                    </div>
                    <div style="text-align:right; font-weight:bold; color:${priceColor};">${item.price}g</div>
                    <div style="text-align:center; color:${trendColor};">${trendIcon}</div>
                    <div style="text-align:right; color:var(--text-secondary);">${item.supply}</div>
                    <div style="text-align:right; color:var(--text-secondary);">${item.demand}</div>
                </div>
            `;
        }
        marketHtml += '</div></div>';

        // Prepare Bank data - get all kingdoms
        const allLoans = [];
        let totalLoanCount = 0;
        if (player.loans) {
            for (const [kingdomId, loans] of Object.entries(player.loans)) {
                for (const loan of loans) {
                    allLoans.push({ ...loan, kingdomId });
                    totalLoanCount++;
                }
            }
        }

        let bankHtml = `
            <div id="tabBank" class="tab-content" style="display:none;">
                <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:4px; margin-bottom:15px;">
                    <h3 style="margin-top:0; color:var(--gold);">Royal Banks</h3>
                    <div style="color:var(--text-secondary); font-style:italic; margin-bottom:15px;">"Each kingdom maintains its own royal treasury and lending services."</div>
        `;

        if (allLoans.length > 0) {
            bankHtml += `<div class="info-section-title">Active Loans (${totalLoanCount} total)</div>`;
            for (const loan of allLoans) {
                const kingdom = world.getKingdom(loan.kingdomId);
                const kingdomName = kingdom ? kingdom.name : 'Unknown Kingdom';
                bankHtml += `
                    <div style="background:rgba(231, 76, 60, 0.1); border:1px solid rgba(231, 76, 60, 0.3); padding:10px; border-radius:4px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span style="font-weight:bold; color:#e74c3c;">${loan.totalOwed}g Owed</span>
                            <span style="color:var(--text-secondary);">${loan.remainingDays} days left</span>
                        </div>
                        <div style="font-size:11px; color:var(--text-secondary); margin-bottom:3px;">From: ${kingdomName}</div>
                        <div style="font-size:12px; color:var(--text-secondary);">Daily Payment: ${loan.dailyPayment}g</div>
                        <button data-ui-act="repayLoan" data-ui-args='["${loan.id}"]' style="margin-top:8px; width:100%; padding:6px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer;">Repay Full Amount (${loan.totalOwed}g)</button>
                    </div>
                `;
            }
        } else {
            bankHtml += `<div style="padding:10px; text-align:center; color:var(--text-secondary);">No active loans. You are debt free!</div>`;
        }

        bankHtml += `<div class="info-section-title" style="margin-top:15px;">Available Royal Banks</div>`;
        
        // Show loan options from each kingdom
        for (const kingdom of world.kingdoms) {
            const kingdomLoans = player.loans[kingdom.id] || [];
            const options = Banking.getLoanOptions(player, kingdom.id);
            
            bankHtml += `
                <div style="background:rgba(255,255,255,0.03); padding:12px; border-radius:4px; margin-bottom:10px;">
                    <div style="font-weight:bold; color:${kingdom.color}; margin-bottom:8px;">
                        ${kingdom.name} Royal Bank
                        <span style="font-size:11px; color:var(--text-secondary);">(${kingdomLoans.length}/3 loans)</span>
                    </div>
                    <div style="display:flex; gap:10px;">
            `;

            for (const opt of options) {
                const canTake = opt.available && kingdomLoans.length < 3;
                if (canTake) {
                    bankHtml += `
                        <div style="flex:1; background:rgba(255,255,255,0.05); padding:10px; border-radius:4px; text-align:center;">
                            <div style="font-weight:bold; color:var(--gold); margin-bottom:5px;">${opt.amount}g</div>
                            <div style="font-size:11px; color:#aaa; margin-bottom:8px;">${(opt.interestRate * 100).toFixed(0)}% Interest<br>${opt.duration} Days</div>
                            <button data-ui-act="takeLoan" data-ui-args='["${opt.id}", "${kingdom.id}"]' style="width:100%; padding:4px; font-size:12px; background:var(--gold); border:none; border-radius:3px; cursor:pointer;">Take Loan</button>
                        </div>
                    `;
                } else {
                    bankHtml += `
                        <div style="flex:1; background:rgba(255,255,255,0.02); padding:10px; border-radius:4px; text-align:center; opacity:0.5;">
                            <div style="font-weight:bold; color:var(--text-secondary); margin-bottom:5px;">${opt.amount}g</div>
                            <div style="font-size:11px; color:#aaa;">${!opt.available ? 'Requires more<br>collateral' : 'Max loans<br>reached'}</div>
                        </div>
                    `;
                }
            }

            bankHtml += `</div></div>`;
        }
        bankHtml += `</div></div>`;

        // Prepare Taxes data
        const currentRate = player.taxRate || 'moderate';
        const policy = Taxation.TAX_RATES[currentRate.toUpperCase()];
        const taxEstimate = Taxation.collectTaxes(player, world, { dryRun: true });
        const estimatedTax = taxEstimate.collected;
        const moodRows = taxEstimate.settlements.map(st => {
            const h = st.happiness;
            const face = h >= 70 ? '😊' : h >= 40 ? '😐' : '😠';
            const g = st.growthRate || 0;
            const growth = `<div style="font-size:10px; color:${g > 0 ? '#81c784' : g < 0 ? '#e57373' : 'var(--text-muted)'}; text-align:right;" title="Yearly growth from the tax policy; projection is 30 days out">📈 ${g > 0 ? '+' : ''}${Math.round(g * 100)}%/yr · pop ${st.population} → ~${st.projectedPopulation} next month · ~${st.projectedCollected}g/wk then</div>`;
            return `<div style="padding:3px 0;"><div style="display:flex; justify-content:space-between; font-size:12px;">
                <span>${st.name}${st.peoplesMood ? ` <span style="font-size:10px; color:${st.peoplesMood > 0 ? '#81c784' : '#e57373'};" title="Mood target shift from the peoples living there (their values, traits and harmony)">🏘️ ${st.peoplesMood > 0 ? '+' : ''}${st.peoplesMood}</span>` : ''}</span><span>${face} ${h}/100 · ~${st.collected}g/wk</span></div>${growth}</div>`;
        }).join('');
        const canSet = Taxation.canSetTaxes(player);

        let taxHtml = `
            <div id="tabTax" class="tab-content" style="display:none;">
                <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:4px; margin-bottom:15px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <div>
                            <div style="color:var(--text-secondary); font-size:12px;">Current Policy</div>
                            <div style="font-size:18px; font-weight:bold; color:var(--gold);">${policy.name}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="color:var(--text-secondary); font-size:12px;">Est. Weekly Revenue</div>
                            <div style="font-size:18px; font-weight:bold; color:#2ecc71;">~${estimatedTax}g</div>
                        </div>
                    </div>
                    
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:15px;">
                        <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:4px; text-align:center;">
                            <div style="font-size:24px;">😊</div>
                            <div style="font-weight:bold; margin:5px 0;">${policy.happinessBonus > 0 ? '+' : ''}${policy.happinessBonus}</div>
                            <div style="font-size:11px; color:var(--text-secondary);">Happiness</div>
                        </div>
                        <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:4px; text-align:center;">
                            <div style="font-size:24px;">📈</div>
                            <div style="font-weight:bold; margin:5px 0;">${policy.growthBonus > 0 ? '+' : ''}${(policy.growthBonus * 100).toFixed(0)}%</div>
                            <div style="font-size:11px; color:var(--text-secondary);">Growth</div>
                        </div>
                    </div>
                    
                    ${moodRows ? `<div class="info-section-title">Your Settlements</div>
                    <div style="margin-bottom:12px;">${moodRows}</div>
                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:12px;">Happy towns pay up to 25% more and conquered towns grow loyal; miserable ones pay less and turn against you.</div>` : ''}
                    <div class="info-section-title">Adjust Tax Rate</div>
                    ${canSet ? '' : '<div style="font-size:11px; color:#e67e22; margin-bottom:8px;">You need settlements of your own, or the office of King, Chancellor or Tax Collector, to set tax rates.</div>'}
                    <div style="display:flex; flex-direction:column; gap:5px;">
        `;

        for (const [key, rate] of Object.entries(Taxation.TAX_RATES)) {
            const isSelected = rate.id === currentRate;
            taxHtml += `
                <button data-ui-act="setTaxRate" data-ui-args='["${rate.id}"]' style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:${isSelected ? 'var(--gold)' : 'rgba(255,255,255,0.05)'}; color:${isSelected ? 'black' : 'var(--text-primary)'}; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    <span style="font-weight:bold;">${rate.name}</span>
                    <span style="font-size:12px; opacity:0.8;">Happ: ${rate.happinessBonus > 0 ? '+' : ''}${rate.happinessBonus} | Growth: ${rate.growthBonus > 0 ? '+' : ''}${(rate.growthBonus * 100).toFixed(0)}%/yr</span>
                </button>
            `;
        }
        taxHtml += `</div></div></div>`;

        // Prepare Routes data
        const routeGoods = PlayerEconomy.getRouteGoodsOptions(player).slice(0, 12);
        const settlements = world.getAllSettlements();
        const currentTile = world.getTile(player.q, player.r);
        const localSettlement = currentTile && currentTile.settlement ? { q: player.q, r: player.r, ...currentTile.settlement } : null;
        const destinationOptions = settlements.filter(s => {
            if (!localSettlement) return false;
            if (s.q === localSettlement.q && s.r === localSettlement.r) return false;
            const dist = Hex.wrappingDistance(localSettlement.q, localSettlement.r, s.q, s.r, world.width);
            return dist >= 2 && dist <= 20;
        });

        let routeHtml = `
            <div id="tabRoutes" class="tab-content" style="display:none;">
                <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:4px; margin-bottom:15px;">
                    <h3 style="margin-top:0; color:var(--gold);">Trade Caravans & Routes</h3>
                    <div style="color:var(--text-secondary); font-style:italic; margin-bottom:12px;">Persistent routes dispatch caravans automatically. Protection and road quality improve long-term prosperity.</div>
        `;

        if (!localSettlement) {
            routeHtml += `<div style="padding:10px; border-radius:4px; background:rgba(231,76,60,0.08); color:#e74c3c;">You must stand in a settlement to establish a route.</div>`;
        } else if (destinationOptions.length === 0) {
            routeHtml += `<div style="padding:10px; border-radius:4px; background:rgba(241,196,15,0.08); color:#f1c40f;">No valid destinations within 20 tiles from ${localSettlement.name}.</div>`;
        } else {
            routeHtml += `
                <div class="info-section-title">Establish New Route (${localSettlement.name})</div>
                <div style="display:grid; grid-template-columns: 2fr 2fr 1fr 1fr; gap:8px; margin-bottom:10px;">
                    <select id="treasuryRouteDestination" style="padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); color:var(--text-primary);">
                        ${destinationOptions.map(s => {
                            const dist = Hex.wrappingDistance(localSettlement.q, localSettlement.r, s.q, s.r, world.width);
                            return `<option value="${s.q},${s.r}">${s.name} (${dist} hex)</option>`;
                        }).join('')}
                    </select>
                    <select id="treasuryRouteGood" style="padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); color:var(--text-primary);">
                        ${routeGoods.length > 0 ? routeGoods.map(g => `<option value="${g.id}">${g.icon} ${g.name} (x${g.qty})</option>`).join('') : '<option value="">No goods in inventory</option>'}
                    </select>
                    <input id="treasuryRouteQty" type="number" min="1" max="999" value="5" style="padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); color:var(--text-primary);" />
                    <select id="treasuryRouteFreq" style="padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); color:var(--text-primary);">
                        <option value="2">Every 2 days</option>
                        <option value="3" selected>Every 3 days</option>
                        <option value="5">Every 5 days</option>
                    </select>
                </div>
                <div style="display:flex; gap:8px; margin-bottom:12px;">
                    <button data-ui-act="createTreasuryRoute" data-ui-args="[false]" style="flex:1; padding:8px; background:var(--gold); color:#111; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Establish Trade Route</button>
                    <button data-ui-act="createTreasuryRoute" data-ui-args="[true]" style="flex:1; padding:8px; background:#8b0000; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Establish Smuggling Route</button>
                </div>
            `;
        }

        const renderRouteCard = (route, isSmuggling) => {
            const nextText = route.activeCaravanId ? 'Caravan in transit' : (route.nextDispatchIn > 0 ? `Dispatch in ${route.nextDispatchIn} day(s)` : 'Ready to dispatch');
            const prosperityPct = Math.floor((route.prosperity || 0) * 16.67);
            const badge = isSmuggling ? '<span style="color:#e74c3c; font-size:11px;">SMUGGLING</span>' : '<span style="color:#2ecc71; font-size:11px;">LEGAL TRADE</span>';
            return `
                <div style="background:rgba(255,255,255,0.03); padding:10px; border-radius:4px; margin-bottom:8px; border:1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <strong>${route.fromName} → ${route.toName}</strong>
                        ${badge}
                    </div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">Cargo: ${route.goodId} x${route.quantity} • ${nextText}</div>
                    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-bottom:8px; font-size:11px;">
                        <div style="background:rgba(0,0,0,0.2); padding:6px; border-radius:3px; text-align:center;">Prosperity<br><span style="color:var(--gold); font-weight:bold;">${prosperityPct}%</span></div>
                        <div style="background:rgba(0,0,0,0.2); padding:6px; border-radius:3px; text-align:center;">Protection<br><span style="color:var(--gold); font-weight:bold;">${route.protection || 0}/5</span></div>
                        <div style="background:rgba(0,0,0,0.2); padding:6px; border-radius:3px; text-align:center;">Roads<br><span style="color:var(--gold); font-weight:bold;">${route.roadQuality || 0}/5</span></div>
                        <div style="background:rgba(0,0,0,0.2); padding:6px; border-radius:3px; text-align:center;">Runs<br><span style="color:var(--gold); font-weight:bold;">${route.successfulRuns || 0}/${route.totalRuns || 0}</span></div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button data-ui-act="upgradeTreasuryRouteProtection" data-ui-args='["${route.id}", ${isSmuggling ? 'true' : 'false'}]' style="flex:1; padding:6px; background:rgba(52,152,219,0.2); border:1px solid rgba(52,152,219,0.5); color:#7fb3ff; border-radius:3px; cursor:pointer;">+ Guard</button>
                        <button data-ui-act="upgradeTreasuryRouteRoads" data-ui-args='["${route.id}", ${isSmuggling ? 'true' : 'false'}]' style="flex:1; padding:6px; background:rgba(46,204,113,0.2); border:1px solid rgba(46,204,113,0.5); color:#7dffb4; border-radius:3px; cursor:pointer;">+ Roads</button>
                        <button data-ui-act="cancelTreasuryRoute" data-ui-args='["${route.id}", ${isSmuggling ? 'true' : 'false'}]' style="flex:1; padding:6px; background:rgba(231,76,60,0.2); border:1px solid rgba(231,76,60,0.5); color:#ff9a9a; border-radius:3px; cursor:pointer;">Cancel</button>
                    </div>
                </div>
            `;
        };

        routeHtml += `<div class="info-section-title">Legal Trade Routes</div>`;
        if (player.tradeRoutes && player.tradeRoutes.length > 0) {
            routeHtml += player.tradeRoutes.map(r => renderRouteCard(r, false)).join('');
        } else {
            routeHtml += `<div style="padding:8px; color:var(--text-secondary);">No legal routes established.</div>`;
        }

        routeHtml += `<div class="info-section-title" style="margin-top:10px;">Smuggling Routes</div>`;
        if (player.smugglingRoutes && player.smugglingRoutes.length > 0) {
            routeHtml += player.smugglingRoutes.map(r => renderRouteCard(r, true)).join('');
        } else {
            routeHtml += `<div style="padding:8px; color:var(--text-secondary);">No smuggling routes established.</div>`;
        }

        routeHtml += `</div></div>`;

        // Prepare Auctions data
        PlayerEconomy.ensureEconomyState(player);
        PlayerEconomy.ensureAuctionListings(player, world);
        const activeLots = player.auctions?.active || [];
        const wonLots = (player.auctions?.won || []).slice(-5).reverse();

        let auctionHtml = `
            <div id="tabAuctions" class="tab-content" style="display:none;">
                <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:4px; margin-bottom:15px;">
                    <h3 style="margin-top:0; color:var(--gold);">Auction House</h3>
                    <div style="color:var(--text-secondary); font-style:italic; margin-bottom:12px;">Bid on rare items, land rights, and artifacts. Auction listings rotate every few days.</div>
        `;

        if (activeLots.length > 0) {
            auctionHtml += `<div class="info-section-title">Live Lots</div>`;
            for (const lot of activeLots) {
                const nextBid = lot.currentBid + lot.minIncrement;
                const youLead = lot.topBidder === 'player';
                auctionHtml += `
                    <div style="background:rgba(255,255,255,0.03); padding:10px; border-radius:4px; margin-bottom:8px; border:1px solid rgba(255,255,255,0.08);">
                        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <strong>${lot.title}</strong>
                            <span style="font-size:11px; color:${lot.rarity === 'legendary' ? '#f39c12' : lot.rarity === 'epic' ? '#9b59b6' : '#3498db'};">${lot.rarity.toUpperCase()}</span>
                        </div>
                        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">${lot.description}</div>
                        <div style="font-size:12px; margin-bottom:6px;">Reward: <span style="color:var(--gold);">${lot.reward.label}</span></div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12px;">
                            <span>Current Bid: <strong style="color:var(--gold);">${lot.currentBid}g</strong></span>
                            <span style="color:var(--text-secondary);">Ends day ${lot.endsOnDay} ${youLead ? '• You lead' : ''}</span>
                        </div>
                        <button data-ui-act="placeTreasuryAuctionBid" data-ui-args='["${lot.id}"]' style="width:100%; padding:8px; background:${youLead ? 'rgba(255,255,255,0.1)' : 'var(--gold)'}; color:${youLead ? 'var(--text-primary)' : '#111'}; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">
                            ${youLead ? `Raise Bid (${nextBid}g)` : `Bid ${nextBid}g`}
                        </button>
                    </div>
                `;
            }
        } else {
            auctionHtml += `<div style="padding:10px; color:var(--text-secondary);">No live auction lots today. Advance time to refresh listings.</div>`;
        }

        auctionHtml += `<div class="info-section-title" style="margin-top:12px;">Recent Wins</div>`;
        if (wonLots.length > 0) {
            for (const won of wonLots) {
                auctionHtml += `<div style="padding:8px; border-radius:4px; background:rgba(46,204,113,0.08); margin-bottom:6px; font-size:12px;">${won.title} — ${won.reward} (${won.price}g)</div>`;
            }
        } else {
            auctionHtml += `<div style="padding:8px; color:var(--text-secondary);">No auction wins yet.</div>`;
        }

        auctionHtml += `</div></div>`;

        // Combine into simple tabs
        const html = `
            <div style="display:flex; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:15px;">
                <button data-ui-act="openTreasuryTab" data-ui-args='["tabMarket"]' data-ui-el="1" class="tab-btn active" style="flex:1; padding:10px; background:none; border:none; color:var(--text-primary); cursor:pointer; border-bottom:2px solid var(--gold); font-weight:bold;">Market</button>
                <button data-ui-act="openTreasuryTab" data-ui-args='["tabBank"]' data-ui-el="1" class="tab-btn" style="flex:1; padding:10px; background:none; border:none; color:var(--text-secondary); cursor:pointer;">Bank</button>
                <button data-ui-act="openTreasuryTab" data-ui-args='["tabTax"]' data-ui-el="1" class="tab-btn" style="flex:1; padding:10px; background:none; border:none; color:var(--text-secondary); cursor:pointer;">Taxes</button>
                <button data-ui-act="openTreasuryTab" data-ui-args='["tabRoutes"]' data-ui-el="1" class="tab-btn" style="flex:1; padding:10px; background:none; border:none; color:var(--text-secondary); cursor:pointer;">Routes</button>
                <button data-ui-act="openTreasuryTab" data-ui-args='["tabAuctions"]' data-ui-el="1" class="tab-btn" style="flex:1; padding:10px; background:none; border:none; color:var(--text-secondary); cursor:pointer;">Auctions</button>
            </div>
            
            ${marketHtml}
            ${bankHtml}
            ${taxHtml}
            ${routeHtml}
            ${auctionHtml}
        `;

        this.showCustomPanel('Royal Treasury', html);
    },

    /**
     * Switch tabs in treasury panel
     */
    openTreasuryTab(tabId, btn) {
        // Hide all tabs
        const tabs = document.getElementsByClassName('tab-content');
        for (let i = 0; i < tabs.length; i++) {
            tabs[i].style.display = 'none';
        }

        // Show selected tab
        document.getElementById(tabId).style.display = 'block';

        // Reset buttons
        const btns = document.getElementsByClassName('tab-btn');
        for (let i = 0; i < btns.length; i++) {
            btns[i].style.color = 'var(--text-secondary)';
            btns[i].style.borderBottom = 'none';
            btns[i].style.fontWeight = 'normal';
        }

        // Highlight active button
        btn.style.color = 'var(--text-primary)';
        btn.style.borderBottom = '2px solid var(--gold)';
        btn.style.fontWeight = 'bold';
    },

    /**
     * Take a loan (UI Action)
     */
    takeLoan(loanId, kingdomId) {
        const result = Banking.takeLoan(this.game.player, loanId, kingdomId);
        if (result.success) {
            const kingdom = this.game.world.getKingdom(kingdomId);
            const kingdomName = kingdom ? kingdom.name : 'a kingdom';
            this.showNotification('Loan Approved', `${result.loan.principal}g from ${kingdomName} added to Treasury`, 'success');
            // Refresh panel
            this.showTreasuryPanel(this.game.player, this.game.world);
            this.updateStats(this.game.player, this.game.world);
        } else {
            this.showNotification('Loan Denied', result.reason, 'error');
        }
    },

    /**
     * Repay a loan (UI Action)
     */
    repayLoan(loanId) {
        const result = Banking.repayLoan(this.game.player, loanId);
        if (result.success) {
            this.showNotification('Loan Repaid', `Debt cleared!`, 'success');
            // Refresh panel
            this.showTreasuryPanel(this.game.player, this.game.world);
            this.updateStats(this.game.player, this.game.world);
        } else {
            this.showNotification('Repayment Failed', result.reason, 'error');
        }
    },

    /**
     * Set Tax Rate (UI Action)
     */
    setTaxRate(rateId) {
        const result = Taxation.setTaxRate(this.game.player, rateId, this.game.world);
        if (result.success) {
            this.showNotification('Policy Updated', `Tax rate set to ${result.policy.name}`, 'info');
            // Refresh panel
            this.showTreasuryPanel(this.game.player, this.game.world);
        } else {
            this.showNotification('Update Failed', result.reason, 'error');
        }
    },

    createTreasuryRoute(isSmuggling = false) {
        const player = this.game.player;
        const world = this.game.world;
        const currentTile = world.getTile(player.q, player.r);

        if (!currentTile || !currentTile.settlement) {
            this.showNotification('Route Failed', 'You must be in a settlement to establish a route.', 'error');
            return;
        }

        const destEl = document.getElementById('treasuryRouteDestination');
        const goodEl = document.getElementById('treasuryRouteGood');
        const qtyEl = document.getElementById('treasuryRouteQty');
        const freqEl = document.getElementById('treasuryRouteFreq');

        if (!destEl || !goodEl || !qtyEl || !freqEl) {
            this.showNotification('Route Failed', 'Route form is unavailable.', 'error');
            return;
        }

        const [toQ, toR] = (destEl.value || '').split(',').map(v => parseInt(v, 10));
        const goodId = goodEl.value;
        const quantity = Math.max(1, parseInt(qtyEl.value, 10) || 1);
        const frequencyDays = Math.max(1, parseInt(freqEl.value, 10) || 3);

        const result = PlayerEconomy.createPersistentRoute(player, world, {
            isSmuggling,
            fromPos: { q: player.q, r: player.r },
            toPos: { q: toQ, r: toR },
            goodId,
            quantity,
            frequencyDays,
        });

        if (result.success) {
            this.showNotification(
                isSmuggling ? 'Smuggling Route Established' : 'Trade Route Established',
                `${result.route.fromName} → ${result.route.toName} (${result.creationCost}g chartered)`,
                'success'
            );
            this.showTreasuryPanel(player, world);
            this.updateStats(player, world);
        } else {
            this.showNotification('Route Failed', result.reason, 'error');
        }
    },

    upgradeTreasuryRouteProtection(routeId, isSmuggling = false) {
        const result = PlayerEconomy.upgradeRouteProtection(this.game.player, routeId, !!isSmuggling);
        if (result.success) {
            this.showNotification('Route Upgraded', `Protection increased for ${result.cost}g`, 'success');
            this.showTreasuryPanel(this.game.player, this.game.world);
            this.updateStats(this.game.player, this.game.world);
        } else {
            this.showNotification('Upgrade Failed', result.reason, 'error');
        }
    },

    upgradeTreasuryRouteRoads(routeId, isSmuggling = false) {
        const result = PlayerEconomy.upgradeRouteRoadQuality(this.game.player, routeId, !!isSmuggling);
        if (result.success) {
            this.showNotification('Route Upgraded', `Road quality improved for ${result.cost}g`, 'success');
            this.showTreasuryPanel(this.game.player, this.game.world);
            this.updateStats(this.game.player, this.game.world);
        } else {
            this.showNotification('Upgrade Failed', result.reason, 'error');
        }
    },

    cancelTreasuryRoute(routeId, isSmuggling = false) {
        const result = PlayerEconomy.cancelPersistentRoute(this.game.player, routeId, !!isSmuggling);
        if (result.success) {
            this.showNotification('Route Cancelled', `${result.route.fromName} → ${result.route.toName} removed`, 'default');
            this.showTreasuryPanel(this.game.player, this.game.world);
        } else {
            this.showNotification('Cancel Failed', result.reason, 'error');
        }
    },

    placeTreasuryAuctionBid(auctionId) {
        const result = PlayerEconomy.placeAuctionBid(this.game.player, auctionId, this.game.world);
        if (result.success) {
            this.showNotification('Bid Placed', `${result.bid}g bid on ${result.lot.title}`, 'success');
            this.showTreasuryPanel(this.game.player, this.game.world);
            this.updateStats(this.game.player, this.game.world);
        } else {
            this.showNotification('Bid Failed', result.reason, 'error');
        }
    },
});
