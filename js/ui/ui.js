// ============================================
// UI — User interface management
// ============================================

class UI {
    constructor(game) {
        this.game = game;
        this.activePanel = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Top bar buttons
        document.getElementById('btnCharacter').addEventListener('click', () => this.toggleCharacterPanel());
        document.getElementById('btnSettings').addEventListener('click', () => this.showNotification('Settings', 'Settings coming soon!', 'info'));
        document.getElementById('btnInventory').addEventListener('click', () => this.showInventoryPanel());
        document.getElementById('btnQuests').addEventListener('click', () => this.showQuestsPanel());
        const btnHistory = document.getElementById('btnHistory');
        if (btnHistory) {
            btnHistory.addEventListener('click', () => this.showHistoryPanel());
        }
        document.getElementById('btnTreasury').addEventListener('click', () => this.showTreasuryPanel(this.game.player, this.game.world));

        // Dynasties button
        const btnDynasties = document.getElementById('btnDynasties');
        if (btnDynasties) {
            btnDynasties.addEventListener('click', () => this.showDynastiesPanel());
        }

        // Intel Journal button
        const btnIntel = document.getElementById('btnIntel');
        if (btnIntel) {
            btnIntel.addEventListener('click', () => ActionMenu.showIntelJournal(this.game));
        }

        // Technology button
        const btnTech = document.getElementById('btnTechnology');
        if (btnTech) {
            btnTech.addEventListener('click', () => this.showTechnologyPanel(this.game.player, this.game.world));
        }

        // Religion & Culture button
        const btnReligion = document.getElementById('btnReligion');
        if (btnReligion) {
            btnReligion.addEventListener('click', () => this.showReligionCulturePanel(this.game.player, this.game.world));
        }

        // Peoples & Subcultures button
        const btnPeoples = document.getElementById('btnPeoples');
        if (btnPeoples) {
            btnPeoples.addEventListener('click', () => this.showPeoplesPanel());
        }

        // Global Control buttons
        document.getElementById('btnToggleResources').addEventListener('click', () => {
            const renderer = this.game.renderer;
            renderer.showResources = !renderer.showResources;
            const stateEl = document.getElementById('resourceToggleState');
            if (stateEl) {
                stateEl.textContent = renderer.showResources ? 'ON' : 'OFF';
                stateEl.classList.toggle('on', renderer.showResources);
            }
            this.showNotification('Display', `Resource Icons: ${renderer.showResources ? 'ON' : 'OFF'}`, 'info');
        });
        document.getElementById('btnToggleBorders').addEventListener('click', () => {
            const renderer = this.game.renderer;
            renderer.showTerritories = !renderer.showTerritories;
            const stateEl = document.getElementById('borderToggleState');
            if (stateEl) {
                stateEl.textContent = renderer.showTerritories ? 'ON' : 'OFF';
                stateEl.classList.toggle('on', renderer.showTerritories);
            }
            this.showNotification('Display', `Kingdom Borders: ${renderer.showTerritories ? 'ON' : 'OFF'}`, 'info');
        });

        // Map Modes button
        const btnMapModes = document.getElementById('btnMapModes');
        if (btnMapModes) {
            btnMapModes.addEventListener('click', () => this.showMapModeSelector());
        }

        document.getElementById('btnEndTurn').addEventListener('click', () => this.game.endDay());

        // --- Civ-style dropdown menu behavior ---
        this.setupCivDropdowns();

        // Gold stat click — show finance tracker
        const goldStat = document.getElementById('goldStat');
        if (goldStat) {
            goldStat.style.cursor = 'pointer';
            goldStat.addEventListener('click', () => this.showFinancesPanel(this.game.player, this.game.world));
        }

        // Panel close buttons
        document.getElementById('hexInfoClose').addEventListener('click', () => this.hidePanel('hexInfoPanel'));
        document.getElementById('kingdomClose').addEventListener('click', () => this.hidePanel('kingdomPanel'));
        document.getElementById('characterClose').addEventListener('click', () => this.hidePanel('characterPanel'));
    }

    /**
     * Setup Civ-style dropdown menus for the top bar
     */
    setupCivDropdowns() {
        const menuPairs = [
            { btn: 'civMapBtn', dropdown: 'civMapDropdown' },
            { btn: 'civEmpireBtn', dropdown: 'civEmpireDropdown' },
            { btn: 'civJournalBtn', dropdown: 'civJournalDropdown' },
        ];

        // Toggle dropdown on button click
        menuPairs.forEach(({ btn, dropdown }) => {
            const btnEl = document.getElementById(btn);
            const dropEl = document.getElementById(dropdown);
            if (!btnEl || !dropEl) return;

            btnEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = dropEl.classList.contains('open');
                // Close all dropdowns first
                this.closeAllCivDropdowns(menuPairs);
                // Toggle the clicked one
                if (!isOpen) {
                    dropEl.classList.add('open');
                    btnEl.classList.add('active');
                }
            });
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            this.closeAllCivDropdowns(menuPairs);
        });

        // Prevent dropdown clicks from closing (except for action items)
        document.querySelectorAll('.civ-dropdown').forEach(dd => {
            dd.addEventListener('click', (e) => {
                // Close dropdown after clicking an action item (not toggle items)
                const item = e.target.closest('.civ-dropdown-item');
                if (item) {
                    // Don't auto-close for toggle items (resources/borders)
                    const hasToggle = item.querySelector('.civ-dd-toggle');
                    if (!hasToggle) {
                        this.closeAllCivDropdowns(menuPairs);
                    }
                }
                e.stopPropagation();
            });
        });
    }

    /**
     * Close all Civ-style dropdown menus
     */
    closeAllCivDropdowns(menuPairs) {
        menuPairs.forEach(({ btn, dropdown }) => {
            const btnEl = document.getElementById(btn);
            const dropEl = document.getElementById(dropdown);
            if (btnEl) btnEl.classList.remove('active');
            if (dropEl) dropEl.classList.remove('open');
        });
    }

    /**
     * Open action menu at player's current location
     */
    openActionMenu() {
        const tile = this.game.world.getTile(this.game.player.q, this.game.player.r);
        if (tile) {
            ActionMenu.show(this.game, tile);
        }
    }

    /**
     * Update top bar stats display
     */
    updateStats(player, world) {
        document.getElementById('goldValue').textContent = Utils.formatNumber(player.gold);
        document.getElementById('karmaValue').textContent = player.karma;
        document.getElementById('renownValue').textContent = player.renown;

        // Add movement points display
        const movementDisplay = document.getElementById('movementValue');
        if (movementDisplay) {
            movementDisplay.textContent = `${Math.floor(player.movementRemaining)}/${player.maxStamina}`;
        }

        // Update food display
        const foodDisplay = document.getElementById('foodValue');
        if (foodDisplay) {
            const foodCount = player.getFoodCount ? player.getFoodCount() : 0;
            foodDisplay.textContent = foodCount;
            foodDisplay.style.color = foodCount === 0 ? '#e74c3c' : foodCount < 10 ? '#f39c12' : '';
        }

        // Show servitude status if active
        let servitudeEl = document.getElementById('servitudeDisplay');
        if (player.indenturedServitude) {
            if (!servitudeEl) {
                servitudeEl = document.createElement('div');
                servitudeEl.id = 'servitudeDisplay';
                servitudeEl.style.cssText = 'color: #e74c3c; font-weight: bold; font-size: 12px; text-align: center; padding: 4px 8px; background: rgba(231,76,60,0.15); border-radius: 4px; margin-top: 4px;';
                const topBar = document.getElementById('topBar');
                if (topBar) topBar.appendChild(servitudeEl);
            }
            servitudeEl.textContent = `⛓️ Indentured Servitude — ${player.indenturedServitude.daysRemaining} days remain`;
            servitudeEl.style.display = 'block';
        } else if (servitudeEl) {
            servitudeEl.style.display = 'none';
        }

        const dayInSeason = ((world.day - 1) % 30) + 1;
        document.getElementById('turnDisplay').textContent =
            `Day ${dayInSeason} — ${world.season}, Year ${world.year}`;
    }

    /**
     * Show hex info panel when a tile is clicked
     */
    showHexInfo(tile, q, r) {
        const panel = document.getElementById('hexInfoPanel');
        const title = document.getElementById('hexInfoTitle');
        const body = document.getElementById('hexInfoBody');

        // Unexplored tiles: show only coordinates
        if (!tile.explored) {
            title.textContent = 'Unexplored';
            title.style.color = '#888888';
            body.innerHTML = `
                <div class="info-row">
                    <span class="info-label">Coordinates</span>
                    <span class="info-value">${q}, ${r}</span>
                </div>
                <div style="color:#666; font-style:italic; margin-top:8px; font-size:12px;">
                    This area has not been explored yet. Travel nearby or acquire maps to reveal it.
                </div>
            `;
            panel.classList.add('visible');
            return;
        }

        title.textContent = tile.terrain.name;
        title.style.color = '#ffffff';

        // Calculate Temperature & Weather
        const temp = this.game.world.weather.getTemperature(q, r);
        const weather = this.game.world.weather.getWeather(q, r);
        const tempColor = temp.celsius > 30 ? '#e74c3c' : temp.celsius < 0 ? '#3498db' : '#f1c40f';

        // Weather Icon mapping
        const weatherIcons = {
            'clear': '☀️',
            'cloudy': '☁️',
            'rain': '🌧️',
            'storm': '⛈️',
            'snow': '❄️',
            'none': '❓'
        };
        const weatherLabel = weather.type.charAt(0).toUpperCase() + weather.type.slice(1);
        const weatherIcon = weatherIcons[weather.type] || '❓';

        // Calculate Elevation String
        let elevStr = 'Sea Level';
        if (tile.elevation < 0.2) elevStr = 'Abyssal Depth';
        else if (tile.elevation < 0.4) elevStr = 'Deep Water';
        else if (tile.elevation < 0.42) elevStr = 'Shallow Water';
        else if (tile.elevation < 0.5) elevStr = 'Lowlands';
        else if (tile.elevation < 0.7) elevStr = 'Highlands';
        else if (tile.elevation < 0.85) elevStr = 'Mountainous';
        else elevStr = 'Peak';

        const elevPct = Math.round(tile.elevation * 100);

        let html = `
            <div class="info-row">
                <span class="info-label">Terrain</span>
                <span class="info-value" style="color:#ffffff !important;">${tile.terrain.icon} ${tile.terrain.name}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Coordinates</span>
                <span class="info-value">${q}, ${r}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Conditions</span>
                <span class="info-value" style="color:${tempColor}">
                    ${weatherIcon} ${weatherLabel} (${temp.celsius}°C / ${temp.fahrenheit}°F)
                </span>
            </div>
            <div class="info-row">
                <span class="info-label">Elevation</span>
                <span class="info-value">${elevStr} (${elevPct}%)</span>
            </div>
            <div class="info-row">
                <span class="info-label">Movement Cost</span>
                <span class="info-value">${tile.terrain.moveCost === Infinity ? '∞' : tile.terrain.moveCost}${tile.infrastructure ? ` → ${typeof Infrastructure !== 'undefined' ? Infrastructure.getEffectiveMoveCost(tile) : tile.terrain.moveCost} (${tile.infrastructure.name})` : ''}</span>
            </div>
        `;

        // Show infrastructure info
        if (tile.infrastructure) {
            html += `
                <div class="info-section-title">Infrastructure</div>
                <div class="info-row">
                    <span class="info-label">${tile.infrastructure.icon} ${tile.infrastructure.name}</span>
                </div>
            `;
            if (tile.infrastructure.productivityBonus > 0) {
                html += `
                    <div class="info-row">
                        <span class="info-label">Farm Bonus</span>
                        <span class="info-value" style="color: #4FC3F7;">+${Math.round(tile.infrastructure.productivityBonus * 100)}%</span>
                    </div>
                `;
            }
        }

        // Add Actions button if player is here
        if (this.game.player.q === q && this.game.player.r === r) {
            html += `
                <button onclick="window.game.ui.openActionMenu()" style="width:100%; margin-top:8px; padding:8px; background:var(--gold); border:none; border-radius:4px; font-weight:bold; cursor:pointer; color:var(--text-primary);">
                    Open Actions
                </button>
            `;
        }

        if (tile.resource) {
            html += `
                <div class="info-section-title">Resources</div>
                <div class="info-row">
                    <span class="info-label">${tile.resource.icon} ${tile.resource.name}</span>
                </div>
            `;
        }

        if (tile.kingdom) {
            const kingdom = this.game.world.getKingdom(tile.kingdom);
            if (kingdom) {
                html += `
                    <div class="info-section-title">Territory</div>
                    <div class="info-row">
                        <span class="info-label">Kingdom</span>
                        <span class="info-value" style="color:#ffffff !important;">
                            <span class="kingdom-dot" style="color:${kingdom.color}; background:${kingdom.color}"></span>
                            ${kingdom.name}
                        </span>
                    </div>
                `;
            }
        }

        if (tile.settlement) {
            // Get economic summary
            const econ = Economy.getSummary(tile.settlement, tile, this.game.world);
            const kId = tile.settlement.kingdom;
            const knowsEcon = kId ? this.game.player.knowsAbout(kId, 'economy') : false;
            const knowsPeoples = kId ? this.game.player.knowsAbout(kId, 'peoples') : false;

            html += `
                <div class="info-section-title">Settlement</div>
                <div class="info-row">
                    <span class="info-label">Name</span>
                    <span class="info-value" style="color:#ffffff !important; cursor: pointer; text-decoration: underline;" onclick="window.game.ui.showSettlementDetails(${q}, ${r})">${tile.settlement.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Type</span>
                    <span class="info-value">${tile.settlement.type}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Population</span>
                    <span class="info-value">${Utils.formatNumber(tile.settlement.population)}</span>
                </div>
            `;

            if (knowsEcon) {
                html += `
                <div class="info-section-title">Economy</div>
                <div class="info-row economic-row" onclick="window.game.ui.showEconomicBreakdown('${q},${r}')" style="cursor:pointer; transition: background 0.2s; border-radius: 4px; padding: 4px;" title="Click for economic breakdown">
                    <span class="info-label">💰 Gold Production</span>
                    <span class="info-value">+${econ.production.gold}/day <i style="font-size:10px; opacity:0.6;">(details)</i></span>
                </div>
                <div class="info-row economic-row" onclick="window.game.ui.showEconomicBreakdown('${q},${r}')" style="cursor:pointer; transition: background 0.2s; border-radius: 4px; padding: 4px;" title="Click for economic breakdown">
                    <span class="info-label">🌾 Food Production</span>
                    <span class="info-value">+${econ.production.food}/day <i style="font-size:10px; opacity:0.6;">(details)</i></span>
                </div>
                <div class="info-row economic-row" onclick="window.game.ui.showEconomicBreakdown('${q},${r}')" style="cursor:pointer; transition: background 0.2s; border-radius: 4px; padding: 4px;" title="Click for economic breakdown">
                    <span class="info-label">📦 Goods Production</span>
                    <span class="info-value">+${econ.production.goods}/day <i style="font-size:10px; opacity:0.6;">(details)</i></span>
                </div>
                <div class="info-row">
                    <span class="info-label">Trade Routes</span>
                    <span class="info-value">${econ.tradeRoutes}</span>
                </div>
            `;
            }

            // Cultural demographics
            if (knowsPeoples && typeof Peoples !== 'undefined' && tile.settlement.demographics) {
                html += Peoples.buildDemographicsHTML(tile.settlement);
            }
        }

        if (tile.playerProperties && tile.playerProperties.length > 0) {
            html += `<div class="info-section-title">Properties (${tile.playerProperties.length})</div>`;

            for (const prop of tile.playerProperties) {
                html += `
                    <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; margin-bottom: 8px;">
                        <div class="info-row">
                            <span class="info-label">Building</span>
                            <span class="info-value" style="color:#ffffff !important;">${prop.icon} ${prop.name}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Level</span>
                            <span class="info-value">${prop.level}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Production</span>
                            <span class="info-value">${prop.productionRate}/day (${prop.produces})</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Storage</span>
                            <span class="info-value">${prop.storage}</span>
                        </div>
                    </div>
                `;
            }
        }

        if (tile.religiousBuilding) {
            const building = tile.religiousBuilding;
            html += `
                <div class="info-section-title">Religious Building</div>
                <div class="info-row">
                    <span class="info-label">Name</span>
                    <span class="info-value" style="color:#ffffff !important;">${building.icon} ${building.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Religion</span>
                    <span class="info-value" style="color:var(--gold);">${building.religion}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Faith Gain</span>
                    <span class="info-value">+${building.faithGain}/day</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Followers</span>
                    <span class="info-value">${Utils.formatNumber(building.followers)}</span>
                </div>
            `;
        }

        if (tile.holySite) {
            const site = tile.holySite;
            const faith = site.faithId && typeof Religion !== 'undefined' ? Religion.FAITHS[site.faithId] : null;
            html += `
                <div class="info-section-title">⛲ Holy Site</div>
                <div class="info-row">
                    <span class="info-label">Name</span>
                    <span class="info-value" style="color:var(--gold);">${site.icon} ${site.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Description</span>
                    <span class="info-value" style="font-size:11px;">${site.description}</span>
                </div>
                ${faith ? `<div class="info-row"><span class="info-label">Faith</span><span class="info-value">${faith.icon} ${faith.name}</span></div>` : ''}
                ${site.controller ? `<div class="info-row"><span class="info-label">Controller</span><span class="info-value">${this.game.world.getKingdom(site.controller)?.name || 'Unknown'}</span></div>` : '<div class="info-row"><span class="info-label">Status</span><span class="info-value" style="color:#f39c12;">Unclaimed</span></div>'}
                <div class="info-row">
                    <span class="info-label">Pilgrims</span>
                    <span class="info-value">${Utils.formatNumber(site.pilgrimCount || 0)}</span>
                </div>
            `;
        }

        if (tile.culturalBuilding) {
            const building = tile.culturalBuilding;
            html += `
                <div class="info-section-title">📚 Cultural Building</div>
                <div class="info-row">
                    <span class="info-label">Name</span>
                    <span class="info-value" style="color:#ffffff !important;">${building.icon} ${building.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Influence</span>
                    <span class="info-value">+${building.influencePerDay}/day (radius ${building.influenceRadius})</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Scholarship</span>
                    <span class="info-value">+${building.scholarshipBonus}</span>
                </div>
                ${building.researchBonus ? `<div class="info-row"><span class="info-label">Research Bonus</span><span class="info-value">+${Math.round(building.researchBonus * 100)}%</span></div>` : ''}
                ${building.incomeBonus ? `<div class="info-row"><span class="info-label">Income</span><span class="info-value">+${building.incomeBonus}/day</span></div>` : ''}
            `;
        }

        if (tile.improvement) {
            html += `
                <div class="info-section-title">Point of Interest</div>
                <div class="info-row">
                    <span class="info-value" style="color:#ffffff !important;">${tile.improvement.icon} ${tile.improvement.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Discovered</span>
                    <span class="info-value">${tile.improvement.founded ? `Year ${tile.improvement.founded} (${this.game.world.year - tile.improvement.founded} years ago)` : 'Unknown'}</span>
                </div>
            `;
        }

        // Add units on this tile
        const units = this.game.world.units.filter(u => u.q === q && u.r === r);
        if (units.length > 0) {
            html += `<div class="info-section-title">Units</div>`;
            for (const unit of units) {
                // Format inventory string
                let invStr = '';
                if (unit.inventory && Object.keys(unit.inventory).length > 0) {
                    const items = Object.entries(unit.inventory)
                        .map(([item, qty]) => `${qty} ${item.charAt(0).toUpperCase() + item.slice(1)}`)
                        .join(', ');
                    invStr = `<div style="font-size:11px; color:var(--text-secondary); margin-left:22px;">📦 Carrying: ${items}</div>`;
                }

                // Format destination string
                let destStr = '';
                if (unit.targetQ !== null && unit.targetR !== null) {
                    let destName = `(${unit.targetQ}, ${unit.targetR})`;
                    // Try to find a settlement at target coordinates
                    const targetTile = this.game.world.getTile(unit.targetQ, unit.targetR);
                    if (targetTile && targetTile.settlement) {
                        destName = targetTile.settlement.name;
                    }
                    destStr = `<div style="font-size:11px; color:var(--text-secondary); margin-left:22px;">📍 Heading to: <span style="color:#ffffff !important;">${destName}</span></div>`;
                }

                // Format origin string
                let originStr = '';
                if (unit.sourceQ !== undefined && unit.sourceR !== undefined) {
                    let originName = `(${unit.sourceQ}, ${unit.sourceR})`;
                    // Try to find a settlement at source coordinates
                    const sourceTile = this.game.world.getTile(unit.sourceQ, unit.sourceR);
                    if (sourceTile && sourceTile.settlement) {
                        originName = sourceTile.settlement.name;
                    }
                    originStr = `<div style="font-size:11px; color:var(--text-secondary); margin-left:22px;">🚩 Coming from: <span style="color:#ffffff !important;">${originName}</span></div>`;
                }

                html += `
                    <div class="info-row" style="flex-direction:column; align-items:flex-start; height:auto; padding:4px 0;">
                        <div style="display:flex; justify-content:space-between; width:100%;">
                            <span class="info-label">${unit.icon} ${unit.name}</span>
                            <span class="info-value" style="font-size:11px;">👫 ${unit.population} | ⚔️ ${unit.strength}</span>
                        </div>
                        ${invStr}
                        ${originStr}
                        ${destStr}
                    </div>
                `;
            }
        }

        body.innerHTML = html;
        this.showPanel('hexInfoPanel');
    }

    /**
     * Show detailed economic breakdown for a settlement
     */
    showEconomicBreakdown(coordStr) {
        const [q, r] = coordStr.split(',').map(Number);
        const tile = this.game.world.getTile(q, r);
        if (!tile || !tile.settlement) return;

        const settlement = tile.settlement;
        const econ = Economy.getSummary(settlement, tile, this.game.world);
        const breakdown = econ.production.breakdown;

        let itemsHtml = '';
        for (const [itemId, amount] of Object.entries(breakdown.items)) {
            const good = PlayerEconomy.GOODS[itemId.toUpperCase()];
            const name = good ? `${good.icon} ${good.name}` : itemId.charAt(0).toUpperCase() + itemId.slice(1);
            itemsHtml += `
                <div class="info-row" style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span class="info-label">${name}</span>
                    <span class="info-value" style="color:var(--gold); font-weight:600;">+${amount}/day</span>
                </div>
            `;
        }

        const html = `
            <div style="margin-bottom: 20px; text-align:center; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,215,0,0.1);">
                <div style="font-size: 14px; color: var(--text-secondary);">Production for</div>
                <div style="font-family: var(--font-display); font-size: 24px; color: var(--gold);">${settlement.name}</div>
                <div style="font-size: 12px; color: var(--text-secondary); opacity: 0.8;">Population: ${Utils.formatNumber(settlement.population)}</div>
            </div>

            <div class="info-section-title">Common Output</div>
            <div class="info-row" style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <span class="info-label">💰 Base Gold</span>
                <span class="info-value" style="color:#f1c40f; font-weight:600;">+${breakdown.gold}/day</span>
            </div>
            <div class="info-row" style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <span class="info-label">🌾 Total Food</span>
                <span class="info-value" style="color:#2ecc71; font-weight:600;">+${breakdown.food}/day</span>
            </div>

            <div class="info-section-title" style="margin-top:20px;">Detailed Goods Production</div>
            ${itemsHtml}
            
            <div style="margin-top: 24px; font-size: 11px; color: var(--text-secondary); font-style: italic; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 4px;">
                Production varies based on settlement type, population size, and access to natural resources within a 2-tile radius. 
                Larger cities have significantly higher base output and generic goods generation.
            </div>
        `;

        this.showCustomPanel('Economic Breakdown', html);
    }

    /**
     * Show kingdom info panel
     */
    showKingdomInfo(kingdom) {
        const panel = document.getElementById('kingdomPanel');
        const title = document.getElementById('kingdomTitle');
        const body = document.getElementById('kingdomBody');
        const player = this.game.player;
        const knows = (cat) => player.knowsAbout(kingdom.id, cat);

        title.innerHTML = `<span class="kingdom-dot" style="color:${kingdom.color}; background:${kingdom.color}"></span> ${kingdom.name}`;

        let relationsHtml = '';
        if (knows('diplomacy')) {
        for (const k of this.game.world.kingdoms) {
            if (k.id === kingdom.id) continue;
            const rel = kingdom.relations[k.id] || 0;
            const relColor = rel > 20 ? '#27ae60' : rel < -20 ? '#c0392b' : '#9a8e7e';
            const relLabel = rel > 20 ? 'Friendly' : rel < -20 ? 'Hostile' : 'Neutral';
            relationsHtml += `
                <div class="info-row">
                    <span class="info-label">
                        <span class="kingdom-dot" style="color:${k.color}; background:${k.color}"></span>
                        ${k.name.replace('Kingdom of ', '').replace('Khanate of ', '').replace('Theocracy of ', '').replace('Republic of ', '')}
                    </span>
                    <span class="info-value" style="color:${relColor}">${relLabel} (${rel > 0 ? '+' : ''}${rel})</span>
                </div>
            `;
        }
        } else {
            relationsHtml = '<div style="color:#666; font-size:12px; font-style:italic;">You know nothing of their diplomatic ties.</div>';
        }

        let warsHtml = '';
        if (knows('military') && kingdom.wars && kingdom.wars.length > 0) {
            for (const enemyId of kingdom.wars) {
                const enemy = this.game.world.getKingdom(enemyId);
                if (enemy) {
                    warsHtml += `
                        <div class="info-row">
                            <span class="info-label">
                                <span class="kingdom-dot" style="color:${enemy.color}; background:${enemy.color}"></span>
                                ${enemy.name.replace('Kingdom of ', '').replace('Khanate of ', '').replace('Theocracy of ', '').replace('Republic of ', '')}
                            </span>
                            <span class="info-value" style="color:#c0392b">⚔️ At War</span>
                        </div>
                    `;
                }
            }
        }

        let alliesHtml = '';
        if (knows('diplomacy') && kingdom.allies && kingdom.allies.length > 0) {
            for (const allyId of kingdom.allies) {
                const ally = this.game.world.getKingdom(allyId);
                if (ally) {
                    alliesHtml += `
                        <div class="info-row">
                            <span class="info-label">
                                <span class="kingdom-dot" style="color:${ally.color}; background:${ally.color}"></span>
                                ${ally.name.replace('Kingdom of ', '').replace('Khanate of ', '').replace('Theocracy of ', '').replace('Republic of ', '')}
                            </span>
                            <span class="info-value" style="color:#27ae60">🤝 Allied</span>
                        </div>
                    `;
                }
            }
        }

        // Lord information — enhanced with Character system data
        let lordHtml = '';
        if (!knows('ruler')) {
            lordHtml = '<div class="info-section-title">👑 Ruler</div><div style="color:#666; font-size:12px; font-style:italic;">You know little of their ruler. Visit their lands or speak with travelers to learn more.</div>';
        } else if (kingdom.characterData) {
            const cd = kingdom.characterData;
            const ruler = cd.ruler;
            if (ruler && ruler.isAlive) {
                const traitBadges = ruler.traits.map(t => {
                    const colorMap = { positive: '#27ae60', negative: '#c0392b', neutral: '#f1c40f' };
                    const color = colorMap[t.category] || '#9a8e7e';
                    return `<span style="background:${color}22; color:${color}; padding:1px 6px; border-radius:4px; font-size:11px; margin-right:3px;" title="${t.description}">${t.icon || ''} ${t.name}</span>`;
                }).join('');

                const skillBar = (label, val) => {
                    const pct = (val / 20) * 100;
                    return `<div class="info-row">
                        <span class="info-label">${label}</span>
                        <span class="info-value" style="display:flex;align-items:center;gap:6px;">
                            <div style="width:60px;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
                                <div style="width:${pct}%;height:100%;background:var(--gold);border-radius:3px;"></div>
                            </div>
                            <span>${val}</span>
                        </span>
                    </div>`;
                };

                lordHtml = `
                    <div class="info-section-title">👑 Ruler</div>
                    <div class="info-row">
                        <span class="info-label">Name</span>
                        <span class="info-value">${Characters.getFullName(ruler)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Age</span>
                        <span class="info-value">${ruler.age} years ${ruler.isIll ? '🤒' : ''}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Health</span>
                        <span class="info-value">${ruler.health}%</span>
                    </div>
                    <div style="margin:6px 0;">${traitBadges}</div>
                    ${skillBar('⚔️ Martial', ruler.skills.martial)}
                    ${skillBar('🗣️ Diplomacy', ruler.skills.diplomacy)}
                    ${skillBar('💰 Stewardship', ruler.skills.stewardship)}
                    ${skillBar('🗝️ Intrigue', ruler.skills.intrigue)}
                    ${skillBar('📖 Learning', ruler.skills.learning)}
                `;

                // Dynasty info
                if (cd.dynasty) {
                    lordHtml += `
                        <div class="info-section-title">🏰 Dynasty: ${cd.dynasty.name}</div>
                        <div class="info-row">
                            <span class="info-label">Prestige</span>
                            <span class="info-value">⭐ ${cd.dynasty.prestige}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Rulers in Line</span>
                            <span class="info-value">${cd.dynasty.bloodline.length}</span>
                        </div>
                    `;
                }

                // Spouse
                if (cd.spouse && cd.spouse.isAlive) {
                    lordHtml += `
                        <div class="info-section-title">💒 Consort</div>
                        <div class="info-row">
                            <span class="info-label">Name</span>
                            <span class="info-value">${Characters.getFullName(cd.spouse)}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Age</span>
                            <span class="info-value">${cd.spouse.age} years</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Culture</span>
                            <span class="info-value">${cd.spouse.culture}${cd.spouse.culture !== kingdom.culture ? ' (Foreign)' : ''}</span>
                        </div>
                    `;
                }

                // Children (heirs)
                if (cd.children && cd.children.length > 0) {
                    const livingChildren = cd.children.filter(c => c.isAlive);
                    if (livingChildren.length > 0) {
                        lordHtml += `<div class="info-section-title">👨‍👧‍👦 Heirs (${livingChildren.length})</div>`;
                        for (const child of livingChildren.sort((a, b) => b.age - a.age)) {
                            const isEligible = child.age >= 16;
                            lordHtml += `
                                <div class="info-row">
                                    <span class="info-label">${Characters.getFullName(child)}</span>
                                    <span class="info-value">${child.age}y ${child.gender === 'male' ? '♂' : '♀'} ${isEligible ? '✅' : '👶'}</span>
                                </div>
                            `;
                        }
                    }
                }

                // Advisors
                if (cd.advisors) {
                    lordHtml += `<div class="info-section-title">📋 Royal Council</div>`;
                    for (const [roleId, advisor] of Object.entries(cd.advisors)) {
                        if (!advisor) continue;
                        const role = Characters.ADVISOR_ROLES[roleId];
                        const loyaltyColor = advisor.loyalty > 60 ? '#27ae60' : advisor.loyalty > 30 ? '#f39c12' : '#c0392b';
                        lordHtml += `
                            <div class="info-row">
                                <span class="info-label">${role.icon} ${role.name}</span>
                                <span class="info-value">${Characters.getFullName(advisor)}</span>
                            </div>
                            <div class="info-row" style="padding-left:20px;">
                                <span class="info-label" style="font-size:11px">Skill ${advisor.skills[role.primarySkill]}/20</span>
                                <span class="info-value" style="color:${loyaltyColor}; font-size:11px">Loyalty: ${advisor.loyalty}%</span>
                            </div>
                        `;
                    }
                }
            }
        } else if (kingdom.lord) {
            const lord = kingdom.lord;
            const traitNames = lord.traits.map(t => t.name).join(', ');
            lordHtml = `
                <div class="info-section-title">Lord</div>
                <div class="info-row">
                    <span class="info-label">Age</span>
                    <span class="info-value">${lord.age} years</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Traits</span>
                    <span class="info-value">${traitNames || 'None'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Ambition</span>
                    <span class="info-value">${lord.ambition}/10</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Martial</span>
                    <span class="info-value">${lord.martial}/10</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Diplomacy</span>
                    <span class="info-value">${lord.diplomacy}/10</span>
                </div>
            `;
        }

        // Religion & Culture info for the kingdom
        let religionHtml = '';
        if (knows('religion') && kingdom.religion && typeof Religion !== 'undefined') {
            const faith = Religion.FAITHS[kingdom.religion.faithId];
            religionHtml = `
                <div class="info-section-title">Religion</div>
                <div class="info-row">
                    <span class="info-label">Faith</span>
                    <span class="info-value" style="color:var(--gold);">${faith ? faith.icon : ''} ${kingdom.religion.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Piety</span>
                    <span class="info-value">${Math.floor(kingdom.religion.piety)}/100</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Unity</span>
                    <span class="info-value">${Math.floor(kingdom.religion.unity)}/100</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Holy Sites</span>
                    <span class="info-value">${kingdom.religion.holySites ? kingdom.religion.holySites.length : 0}</span>
                </div>
                ${kingdom.religion.pilgrimIncome > 0 ? `<div class="info-row"><span class="info-label">Pilgrim Income</span><span class="info-value">+${kingdom.religion.pilgrimIncome}/day</span></div>` : ''}
                ${kingdom.religion.heresies && kingdom.religion.heresies.length > 0 ? `<div class="info-row"><span class="info-label">⚠️ Heresies</span><span class="info-value" style="color:#e74c3c;">${kingdom.religion.heresies.map(h => h.name).join(', ')}</span></div>` : ''}
            `;
        }

        let cultureHtml = '';
        if (knows('peoples') && kingdom.cultureData && typeof Culture !== 'undefined') {
            cultureHtml = `
                <div class="info-section-title">Cultural</div>
                <div class="info-row">
                    <span class="info-label">Tradition</span>
                    <span class="info-value">${kingdom.cultureData.tradition ? kingdom.cultureData.tradition.icon + ' ' + kingdom.cultureData.tradition.name : kingdom.culture}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Influence</span>
                    <span class="info-value">${Math.floor(kingdom.cultureData.influence)}/100</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Scholarship</span>
                    <span class="info-value">${Math.floor(kingdom.cultureData.scholarship)}/100</span>
                </div>
            `;
        }

        body.innerHTML = `
            <div class="info-row">
                <span class="info-label">Ruler</span>
                <span class="info-value">${knows('ruler') ? kingdom.ruler : '<span style="color:#666;">Unknown</span>'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Culture</span>
                <span class="info-value">${knows('peoples') ? kingdom.culture : '<span style="color:#666;">Unknown</span>'}</span>
            </div>
            ${lordHtml}
            <div class="info-section-title">Kingdom Stats</div>
            <div class="info-row">
                <span class="info-label">Territory</span>
                <span class="info-value">${kingdom.territory.length} tiles</span>
            </div>
            <div class="info-row">
                <span class="info-label">Population</span>
                <span class="info-value">${Utils.formatNumber(kingdom.population || 0)}</span>
            </div>
            ${knows('military') ? `<div class="info-row">
                <span class="info-label">Military</span>
                <span class="info-value">⚔️ ${Utils.formatNumber(kingdom.military || 0)}</span>
            </div>` : `<div class="info-row">
                <span class="info-label">Military</span>
                <span class="info-value" style="color:#666;">Unknown</span>
            </div>`}
            ${knows('economy') ? `<div class="info-row">
                <span class="info-label">Treasury</span>
                <span class="info-value">💰 ${Utils.formatNumber(kingdom.treasury)}</span>
            </div>` : `<div class="info-row">
                <span class="info-label">Treasury</span>
                <span class="info-value" style="color:#666;">Unknown</span>
            </div>`}
            <p style="margin-top:12px; color: var(--text-secondary); font-size: 12px; font-style: italic;">
                "${kingdom.description}"
            </p>
            ${religionHtml}
            ${cultureHtml}
            ${warsHtml ? `<div class="info-section-title">Active Wars</div>${warsHtml}` : ''}
            ${alliesHtml ? `<div class="info-section-title">Allies</div>${alliesHtml}` : ''}
            <div class="info-section-title">Relations</div>
            ${relationsHtml}
            <div class="info-section-title">Your Reputation</div>
            <div class="info-row">
                <span class="info-label">Standing</span>
                <span class="info-value">${this.game.player.reputation[kingdom.id] || 0}</span>
            </div>
        `;

        this.showPanel('kingdomPanel');
    }

    /**
     * Toggle character panel
     */
    toggleCharacterPanel() {
        const panel = document.getElementById('characterPanel');
        if (panel.classList.contains('hidden')) {
            this.showCharacterPanel();
        } else {
            this.hidePanel('characterPanel');
        }
    }

    /**
     * Show character panel
     */
    showCharacterPanel() {
        const player = this.game.player;
        const body = document.getElementById('characterBody');

        let skillsHtml = '';
        for (const [skill, level] of Object.entries(player.skills)) {
            const barWidth = (level / 10) * 100;
            skillsHtml += `
                <div class="info-row">
                    <span class="info-label">${skill.charAt(0).toUpperCase() + skill.slice(1)}</span>
                    <span class="info-value">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div style="width:60px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                                <div style="width:${barWidth}%; height:100%; background:var(--gold); border-radius:3px;"></div>
                            </div>
                            <span>${level}</span>
                        </div>
                    </span>
                </div>
            `;
        }

        body.innerHTML = `
            <div style="text-align:center; margin-bottom:16px;">
                <div style="font-size:48px; margin-bottom:8px;">👤</div>
                <div style="font-family:var(--font-display); font-size:20px; color:var(--gold);">${player.name}</div>
                <div style="font-size:12px; color:var(--text-secondary);">${player.title}</div>
            </div>

            <div class="info-section-title">Vitals</div>
            <div class="info-row">
                <span class="info-label">❤️ Health</span>
                <span class="info-value">${player.health} / ${player.maxHealth}</span>
            </div>
            <div class="info-row">
                <span class="info-label">⚡ Stamina</span>
                <span class="info-value">${player.movementRemaining} / ${player.maxStamina}</span>
            </div>
            <div class="info-row">
                <span class="info-label">💰 Gold</span>
                <span class="info-value">${Utils.formatNumber(player.gold)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">☯ Karma</span>
                <span class="info-value">${player.karma}</span>
            </div>
            <div class="info-row">
                <span class="info-label">⭐ Renown</span>
                <span class="info-value">${player.renown}</span>
            </div>

            <div class="info-section-title">Attributes</div>
            <div class="info-row">
                <span class="info-label">💪 Strength</span>
                <span class="info-value">${player.strength}</span>
            </div>
            <div class="info-row">
                <span class="info-label">💬 Charisma</span>
                <span class="info-value">${player.charisma}</span>
            </div>
            <div class="info-row">
                <span class="info-label">🧠 Intelligence</span>
                <span class="info-value">${player.intelligence}</span>
            </div>
            <div class="info-row">
                <span class="info-label">🙏 Faith</span>
                <span class="info-value">${player.faith}</span>
            </div>
            <div class="info-row">
                <span class="info-label">🍀 Luck</span>
                <span class="info-value">${player.luck}</span>
            </div>
            ${player.soulSoldCount ? `
            <div class="info-row" style="color: #e74c3c;">
                <span class="info-label">🔥 Soul</span>
                <span class="info-value">Sold ×${player.soulSoldCount}</span>
            </div>` : ''}
            ${player.indenturedServitude ? `
            <div class="info-row" style="color: #e67e22;">
                <span class="info-label">⛓️ Servitude</span>
                <span class="info-value">${player.indenturedServitude.daysRemaining} days under ${player.indenturedServitude.captor}</span>
            </div>` : ''}

            <div class="info-section-title">Skills</div>
            ${skillsHtml}
        `;

        this.showPanel('characterPanel');
    }

    /**
     * Show the Dynasties & Characters overview panel
     */
    showDynastiesPanel() {
        if (!this.game.world || typeof Characters === 'undefined') return;

        const player = this.game.player;
        let html = '';

        for (const kingdom of this.game.world.kingdoms) {
            if (!kingdom.isAlive) continue;
            const cd = kingdom.characterData;
            if (!cd) continue;

            const ruler = cd.ruler;
            if (!ruler || !ruler.isAlive) continue;

            // Gate behind ruler knowledge
            if (!player.knowsAbout(kingdom.id, 'ruler')) {
                html += `
                    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${kingdom.color};border-radius:6px;padding:12px;margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <span style="font-family:var(--font-display);color:var(--gold);font-size:14px;">
                                ${kingdom.name}
                            </span>
                        </div>
                        <div style="color: #95a5a6; font-style: italic; font-size: 12px;">You know nothing of this kingdom's ruling dynasty. Visit their settlements, speak with locals, or meet their lord to learn more.</div>
                    </div>
                `;
                continue;
            }

            // Trait badges
            const traitBadges = ruler.traits.map(t => {
                const colorMap = { positive: '#27ae60', negative: '#c0392b', neutral: '#f1c40f' };
                const col = colorMap[t.category] || '#9a8e7e';
                return `<span style="background:${col}22;color:${col};padding:1px 5px;border-radius:3px;font-size:10px;" title="${t.description}">${t.icon||''} ${t.name}</span>`;
            }).join(' ');

            // Heirs count
            const livingHeirs = cd.children ? cd.children.filter(c => c.isAlive && c.age >= 16).length : 0;
            const totalChildren = cd.children ? cd.children.filter(c => c.isAlive).length : 0;

            // Advisor summary
            let advisorSummary = '';
            if (cd.advisors) {
                const advisorLines = Object.entries(cd.advisors).map(([roleId, adv]) => {
                    if (!adv) return '';
                    const role = Characters.ADVISOR_ROLES[roleId];
                    const loyColor = adv.loyalty > 60 ? '#27ae60' : adv.loyalty > 30 ? '#f39c12' : '#c0392b';
                    return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;">
                        <span>${role.icon} ${role.name}: ${Characters.getFullName(adv)}</span>
                        <span style="color:${loyColor}">${adv.loyalty}%</span>
                    </div>`;
                }).join('');
                advisorSummary = advisorLines;
            }

            // Kingdom bonuses from characters
            let bonusHtml = '';
            if (kingdom.characterBonuses) {
                const b = kingdom.characterBonuses;
                const bonusList = [];
                if (b.military) bonusList.push(`⚔️ Military ${b.military > 0 ? '+' : ''}${(b.military * 100).toFixed(0)}%`);
                if (b.treasury) bonusList.push(`💰 Treasury ${b.treasury > 0 ? '+' : ''}${(b.treasury * 100).toFixed(0)}%`);
                if (b.diplomacy) bonusList.push(`🗣️ Diplomacy ${b.diplomacy > 0 ? '+' : ''}${(b.diplomacy * 100).toFixed(0)}%`);
                if (b.stability) bonusList.push(`🏛️ Stability ${b.stability > 0 ? '+' : ''}${(b.stability * 100).toFixed(0)}%`);
                if (bonusList.length > 0) {
                    bonusHtml = `<div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">${bonusList.join(' · ')}</div>`;
                }
            }

            html += `
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${kingdom.color};border-radius:6px;padding:12px;margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-family:var(--font-display);color:var(--gold);font-size:14px;">
                            ${kingdom.name}
                        </span>
                        <span style="font-size:11px;color:var(--text-secondary);">
                            Dynasty: ${cd.dynasty.name} (⭐${cd.dynasty.prestige})
                        </span>
                    </div>
                    <div style="font-size:12px;margin-bottom:4px;">
                        👑 <strong>${Characters.getDisplayName(ruler, kingdom)}</strong>, Age ${ruler.age} ${ruler.isIll ? '🤒' : ''}
                    </div>
                    <div style="margin-bottom:4px;">${traitBadges}</div>
                    ${cd.spouse && cd.spouse.isAlive ? `<div style="font-size:11px;color:var(--text-secondary);">💒 Consort: ${Characters.getFullName(cd.spouse)} (${cd.spouse.culture}${cd.spouse.culture !== kingdom.culture ? ' — Foreign' : ''})</div>` : ''}
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
                        👨‍👧‍👦 Children: ${totalChildren} (${livingHeirs} eligible heirs)
                    </div>
                    ${bonusHtml}
                    <div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">
                        ${advisorSummary}
                    </div>
                </div>
            `;
        }

        if (!html) {
            html = '<p style="color:var(--text-secondary);">No kingdoms with dynasty data available.</p>';
        }

        this.showCustomPanel('👑 Dynasties & Characters', html);
    }

    /**
     * Show a panel by ID
     */
    showPanel(panelId) {
        document.getElementById(panelId).classList.remove('hidden');
    }

    /**
     * Hide a panel by ID
     */
    hidePanel(panelId) {
        document.getElementById(panelId).classList.add('hidden');
    }

    /**
     * Show a custom panel with dynamic content
     */
    showCustomPanel(title, htmlContent) {
        // Remove existing custom panel if any
        const existing = document.getElementById('customPanel');
        if (existing) {
            // If panel exists, just update the content body to prevent "blips"
            const contentBody = existing.querySelector('.custom-panel-body');
            if (contentBody) {
                contentBody.innerHTML = htmlContent;
            }
            const titleEl = existing.querySelector('.custom-panel-title');
            if (titleEl) {
                titleEl.textContent = title;
            }
            return; // Done update
        }

        const panel = document.createElement('div');
        panel.id = 'customPanel';
        panel.className = 'modal-panel';
        panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(20, 24, 32, 0.98);
            backdrop-filter: blur(10px);
            border: 2px solid var(--gold);
            border-radius: 8px;
            padding: 0;
            min-width: 400px;
            max-width: 700px;
            max-height: 80vh;
            z-index: 1000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            overflow: hidden;
            display: flex;
            flex-direction: column; 
        `;

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <h3 class="custom-panel-title" style="margin: 0; font-family: var(--font-display); color: var(--gold);">${title}</h3>
                <button id="closeCustomPanel" style="background: none; border: none; color: var(--text-primary); font-size: 20px; cursor: pointer;">✕</button>
            </div>
            <div class="custom-panel-body" style="padding: 16px; overflow-y: auto; max-height: calc(80vh - 60px);">
                ${htmlContent}
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('closeCustomPanel').addEventListener('click', () => {
            this.hideCustomPanel();
        });
    }

    /**
     * Hide the custom panel
     */
    hideCustomPanel() {
        const panel = document.getElementById('customPanel');
        if (panel) panel.remove();
    }

    /**
     * Show the finances tracking modal
     */
    showFinancesPanel(player, world) {
        if (!player) return;

        const history = player.financeHistory || [];
        const recent = history.slice(-30); // Last 30 days

        // ── Summary stats ──
        let totalIncome = 0, totalExpenses = 0;
        const incomeByType = {};
        const expenseByType = {};
        for (const entry of recent) {
            totalIncome += entry.totalIncome || 0;
            totalExpenses += entry.totalExpenses || 0;
            for (const [k, v] of Object.entries(entry.income || {})) {
                incomeByType[k] = (incomeByType[k] || 0) + v;
            }
            for (const [k, v] of Object.entries(entry.expenses || {})) {
                expenseByType[k] = (expenseByType[k] || 0) + v;
            }
        }
        const netChange = totalIncome - totalExpenses;
        const avgDaily = recent.length > 0 ? Math.round(netChange / recent.length) : 0;

        // Label mapping for nice display
        const labels = {
            faith: '🙏 Faith Income',
            culture: '📚 Cultural Income',
            caravans: '🚚 Caravan Profits',
            contracts: '📜 Contract Pay',
            taxes: '🏛️ Tax Collection',
            armyUpkeep: '⚔️ Army Upkeep',
            loanPayments: '🏦 Loan Payments',
            informants: '🕵️ Informant Upkeep',
            propertyUpkeep: '🏗️ Property Upkeep',
        };

        let html = '<div style="max-height: 500px; overflow-y: auto;">';

        // ── Current Balance ──
        html += `
            <div style="text-align: center; margin-bottom: 16px; padding: 16px; background: rgba(255,255,255,0.04); border-radius: 8px;">
                <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px;">Current Balance</div>
                <div style="font-size: 32px; font-weight: bold; color: var(--gold); font-family: var(--font-display);">💰 ${Utils.formatNumber(player.gold)}</div>
                <div style="font-size: 13px; color: ${avgDaily >= 0 ? '#27ae60' : '#e74c3c'}; margin-top: 4px;">
                    ${avgDaily >= 0 ? '▲' : '▼'} ${avgDaily >= 0 ? '+' : ''}${avgDaily} gold/day avg (last ${recent.length} days)
                </div>
            </div>
        `;

        // ── Summary cards row ──
        html += `
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                <div style="flex: 1; padding: 12px; background: rgba(39,174,96,0.1); border: 1px solid rgba(39,174,96,0.3); border-radius: 6px; text-align: center;">
                    <div style="font-size: 11px; color: #27ae60; text-transform: uppercase;">Income (${recent.length}d)</div>
                    <div style="font-size: 20px; font-weight: bold; color: #27ae60;">+${Utils.formatNumber(totalIncome)}</div>
                </div>
                <div style="flex: 1; padding: 12px; background: rgba(231,76,60,0.1); border: 1px solid rgba(231,76,60,0.3); border-radius: 6px; text-align: center;">
                    <div style="font-size: 11px; color: #e74c3c; text-transform: uppercase;">Expenses (${recent.length}d)</div>
                    <div style="font-size: 20px; font-weight: bold; color: #e74c3c;">-${Utils.formatNumber(totalExpenses)}</div>
                </div>
                <div style="flex: 1; padding: 12px; background: rgba(${netChange >= 0 ? '39,174,96' : '231,76,60'},0.1); border: 1px solid rgba(${netChange >= 0 ? '39,174,96' : '231,76,60'},0.3); border-radius: 6px; text-align: center;">
                    <div style="font-size: 11px; color: ${netChange >= 0 ? '#27ae60' : '#e74c3c'}; text-transform: uppercase;">Net (${recent.length}d)</div>
                    <div style="font-size: 20px; font-weight: bold; color: ${netChange >= 0 ? '#27ae60' : '#e74c3c'};">${netChange >= 0 ? '+' : ''}${Utils.formatNumber(netChange)}</div>
                </div>
            </div>
        `;

        // ── Income breakdown ──
        const incomeKeys = Object.keys(incomeByType).sort((a, b) => incomeByType[b] - incomeByType[a]);
        if (incomeKeys.length > 0) {
            html += `<div style="margin-bottom: 16px;">`;
            html += `<div style="font-weight: bold; color: #27ae60; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(39,174,96,0.3); padding-bottom: 4px;">Income Sources</div>`;
            for (const k of incomeKeys) {
                const pct = totalIncome > 0 ? Math.round(incomeByType[k] / totalIncome * 100) : 0;
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px;">
                        <span style="color: var(--text-secondary);">${labels[k] || k}</span>
                        <span style="display: flex; align-items: center; gap: 8px;">
                            <span style="width: 60px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; display: inline-block; overflow: hidden;">
                                <span style="display: block; width: ${pct}%; height: 100%; background: #27ae60; border-radius: 3px;"></span>
                            </span>
                            <span style="color: #27ae60; font-weight: bold; min-width: 60px; text-align: right;">+${Utils.formatNumber(incomeByType[k])}</span>
                        </span>
                    </div>
                `;
            }
            html += `</div>`;
        }

        // ── Expense breakdown ──
        const expenseKeys = Object.keys(expenseByType).sort((a, b) => expenseByType[b] - expenseByType[a]);
        if (expenseKeys.length > 0) {
            html += `<div style="margin-bottom: 16px;">`;
            html += `<div style="font-weight: bold; color: #e74c3c; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(231,76,60,0.3); padding-bottom: 4px;">Expense Sources</div>`;
            for (const k of expenseKeys) {
                const pct = totalExpenses > 0 ? Math.round(expenseByType[k] / totalExpenses * 100) : 0;
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px;">
                        <span style="color: var(--text-secondary);">${labels[k] || k}</span>
                        <span style="display: flex; align-items: center; gap: 8px;">
                            <span style="width: 60px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; display: inline-block; overflow: hidden;">
                                <span style="display: block; width: ${pct}%; height: 100%; background: #e74c3c; border-radius: 3px;"></span>
                            </span>
                            <span style="color: #e74c3c; font-weight: bold; min-width: 60px; text-align: right;">-${Utils.formatNumber(expenseByType[k])}</span>
                        </span>
                    </div>
                `;
            }
            html += `</div>`;
        }

        // ── Gold history chart (ASCII-style bar chart) ──
        if (recent.length > 1) {
            html += `<div style="margin-bottom: 8px;">`;
            html += `<div style="font-weight: bold; color: var(--gold); font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(245,197,66,0.3); padding-bottom: 4px;">Gold Over Time (last ${recent.length} days)</div>`;

            const goldValues = recent.map(e => e.goldEnd);
            const maxGold = Math.max(...goldValues, 1);
            const minGold = Math.min(...goldValues, 0);
            const range = maxGold - minGold || 1;

            html += `<div style="display: flex; align-items: flex-end; gap: 1px; height: 80px; padding: 4px 0;">`;
            for (let i = 0; i < recent.length; i++) {
                const entry = recent[i];
                const heightPct = Math.max(2, ((entry.goldEnd - minGold) / range) * 100);
                const color = entry.netChange >= 0 ? '#27ae60' : '#e74c3c';
                const barWidth = Math.max(3, Math.floor(360 / recent.length) - 1);
                html += `<div title="Day ${entry.day}: ${Utils.formatNumber(entry.goldEnd)}g (${entry.netChange >= 0 ? '+' : ''}${entry.netChange})" 
                    style="width: ${barWidth}px; height: ${heightPct}%; background: ${color}; border-radius: 2px 2px 0 0; min-height: 2px; cursor: help; opacity: 0.8;"></div>`;
            }
            html += `</div>`;
            html += `<div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary); margin-top: 2px;">
                <span>${Utils.formatNumber(minGold)}g</span>
                <span>${Utils.formatNumber(maxGold)}g</span>
            </div>`;
            html += `</div>`;
        }

        // ── Recent daily log ──
        if (recent.length > 0) {
            html += `<div>`;
            html += `<div style="font-weight: bold; color: white; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px;">Daily Log</div>`;
            const lastDays = recent.slice(-10).reverse(); // Show last 10 entries, newest first
            for (const entry of lastDays) {
                const dayInSeason = ((entry.day - 1) % 30) + 1;
                const incomeStr = entry.totalIncome > 0 ? `<span style="color: #27ae60;">+${entry.totalIncome}</span>` : '';
                const expenseStr = entry.totalExpenses > 0 ? `<span style="color: #e74c3c;">-${entry.totalExpenses}</span>` : '';
                const netColor = entry.netChange >= 0 ? '#27ae60' : '#e74c3c';
                html += `
                    <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.04);">
                        <span style="color: var(--text-secondary); min-width: 110px;">Day ${dayInSeason}, ${entry.season} Y${entry.year}</span>
                        <span style="display: flex; gap: 12px;">
                            ${incomeStr}
                            ${expenseStr}
                            <span style="color: ${netColor}; font-weight: bold; min-width: 50px; text-align: right;">= ${entry.netChange >= 0 ? '+' : ''}${entry.netChange}</span>
                            <span style="color: var(--gold); min-width: 65px; text-align: right;">${Utils.formatNumber(entry.goldEnd)}g</span>
                        </span>
                    </div>
                `;
            }
            html += `</div>`;
        }

        if (recent.length === 0) {
            html += `<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No financial data yet. End a day to start tracking.</p>`;
        }

        html += '</div>';

        this.showCustomPanel('💰 Finances', html);
    }

    /**
     * Show inventory panel
     */
    showInventoryPanel() {
        const player = this.game.player;

        let inventoryHtml = '<p style="color: var(--text-secondary);">Your inventory is empty.</p>';

        if (player.inventory && Object.keys(player.inventory).length > 0) {
            inventoryHtml = '<div style="display: grid; gap: 8px;">';
            for (const [itemId, quantity] of Object.entries(player.inventory)) {
                // Try to find the item in PlayerEconomy.GOODS
                const item = PlayerEconomy.GOODS ? PlayerEconomy.GOODS[itemId.toUpperCase()] : null;
                if (item && quantity > 0) {
                    inventoryHtml += `
                        <div style="display: flex; justify-content: space-between; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                            <span>${item.icon} ${item.name}</span>
                            <span style="color: var(--gold);">×${quantity}</span>
                        </div>
                    `;
                }
            }
            inventoryHtml += '</div>';
        }

        this.showCustomPanel('Inventory', inventoryHtml);
    }

    /**
     * Show quests panel
     */
    showQuestsPanel() {
        const player = this.game.player;

        if (!player.quests) {
            this.showCustomPanel('Quests', '<p style="color: var(--text-secondary);">No quests available.</p>');
            return;
        }

        let html = '';

        // Active quests
        html += '<h4 style="margin-top: 0; color:var(--text-primary); border-bottom: 2px solid var(--gold); padding-bottom: 8px;">Active Quests</h4>';
        if (player.quests.active && player.quests.active.length > 0) {
            for (const quest of player.quests.active) {
                const progress = Quests.getProgressSummary(quest);
                html += `
                    <div style="margin-bottom: 16px; padding: 16px; background: rgba(20, 20, 30, 0.6); border: 1px solid rgba(255, 215, 0, 0.3); border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                            <div style="font-family: var(--font-display); font-size: 18px; color: var(--gold);">${quest.title}</div>
                            <div style="font-size: 12px; background: rgba(255,215,0,0.1); padding: 4px 8px; border-radius: 12px; color: var(--gold);">Active</div>
                        </div>
                        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 12px; font-style: italic;">${quest.description}</div>
                        
                        <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                            <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">Objectives:</div>
                            ${quest.objectives.map(obj => `
                                <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: 4px; color: ${obj.completed ? '#2ecc71' : 'var(--text-secondary)'};">
                                    <span style="font-size: 16px;">${obj.completed ? '✅' : '⭕'}</span> 
                                    <span>${obj.text} (${obj.current}/${obj.target})</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        } else {
            html += '<p style="color: var(--text-secondary); font-style: italic;">No active quests at the moment.</p>';
        }

        // Available quests
        html += '<h4 style="margin-top: 24px; color:var(--text-primary); border-bottom: 2px solid var(--text-secondary); padding-bottom: 8px;">Available Quests</h4>';
        if (player.quests.available && player.quests.available.length > 0) {
            for (const quest of player.quests.available) {
                const rewards = JSON.stringify(quest.rewards).replace(/{|}|"/g, '').replace(/,/g, ', ');
                html += `
                    <div style="margin-bottom: 12px; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;">
                        <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">${quest.title}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">${quest.description}</div>
                        <div style="display: flex; gap: 8px; font-size: 11px;">
                            <span style="background: rgba(255,215,0,0.1); padding: 2px 6px; border-radius: 4px; color: var(--gold);">Rewards: ${rewards}</span>
                        </div>
                    </div>
                `;
            }
        } else {
            html += '<p style="color: var(--text-secondary); font-style: italic;">No new quests available.</p>';
        }

        // Completed quests
        if (player.quests.completed && player.quests.completed.length > 0) {
            html += `<h4 style="margin-top: 24px; color:var(--text-primary); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">Completed (${player.quests.completed.length})</h4>`;
            html += '<div style="font-size: 13px; color: var(--text-secondary);">Check your achievements panel for history of completed quests.</div>';
        }

        this.showCustomPanel('Quest Journal', html);
    }

    /**
     * Show a notification toast
     */
    showNotification(title, message, type = 'default') {
        const area = document.getElementById('notificationArea');
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;
        notif.innerHTML = `
            <div class="notif-title">${title}</div>
            <div>${message}</div>
        `;
        area.appendChild(notif);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            notif.style.animation = 'notifOut 0.3s ease forwards';
            setTimeout(() => notif.remove(), 300);
        }, 4000);
    }

    /**
     * Hide title screen
     */
    hideTitleScreen() {
        const titleScreen = document.getElementById('titleScreen');
        titleScreen.style.transition = 'opacity 0.8s ease';
        titleScreen.style.opacity = '0';
        setTimeout(() => {
            titleScreen.classList.add('hidden');
        }, 800);
    }

    /**
     * Show Religion & Culture overview panel
     */
    showReligionCulturePanel(player, world) {
        let html = '<div style="max-width: 650px;">';

        // ── PLAYER RELIGION ──
        html += '<div class="info-section-title">🙏 Your Religion</div>';
        if (player.religion) {
            html += `
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                    <div style="font-size: 18px; color: var(--gold); font-family: var(--font-display);">${player.religion.name}</div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Tenets: ${player.religion.tenets.join(', ')}</div>
                    <div style="display: flex; gap: 16px; margin-top: 8px; font-size: 13px;">
                        <span>👥 ${Utils.formatNumber(player.religion.followers)} followers</span>
                        <span>📿 ${player.religion.influence} influence</span>
                        <span>🏛️ ${player.religion.buildings.length} buildings</span>
                        <span>💰 +${PlayerReligion.getFaithIncome(player)}/day</span>
                    </div>
                </div>
            `;
        } else {
            html += '<p style="color: var(--text-secondary); font-size: 13px;">You have not founded a religion yet. Build a temple to get started (requires 10 karma).</p>';
        }

        // ── PLAYER CULTURAL BUILDINGS ──
        html += '<div class="info-section-title">📚 Your Cultural Buildings</div>';
        if (player.culturalBuildings && player.culturalBuildings.length > 0) {
            for (const bRef of player.culturalBuildings) {
                const tile = world.getTile(bRef.q, bRef.r);
                if (!tile || !tile.culturalBuilding) continue;
                const b = tile.culturalBuilding;
                html += `
                    <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="font-size: 16px;">${b.icon}</span> <strong>${b.name}</strong>
                            <span style="font-size: 11px; color: var(--text-secondary);"> at (${bRef.q}, ${bRef.r})</span>
                        </div>
                        <div style="font-size: 12px;">
                            Influence +${b.influencePerDay} | Scholar +${b.scholarshipBonus}
                            ${b.researchBonus ? ` | Research +${Math.round(b.researchBonus * 100)}%` : ''}
                        </div>
                    </div>
                `;
            }
            const totalInfluence = typeof Culture !== 'undefined' ? Culture.getInfluence(player, world) : 0;
            html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Total cultural influence: ${totalInfluence}</div>`;
        } else {
            html += '<p style="color: var(--text-secondary); font-size: 13px;">No cultural buildings yet. Visit settlements to build libraries, theaters, or universities.</p>';
        }

        // ── WORLD RELIGIONS ── (gated behind religion knowledge)
        if (typeof Religion !== 'undefined') {
            html += '<div class="info-section-title" style="margin-top: 16px;">☀️ World Religions</div>';

            // Active faiths — only show faiths the player knows about via kingdom knowledge or own faith
            const activeFaiths = Object.values(Religion.FAITHS).filter(f => !f.extinct);
            const knownActiveFaiths = activeFaiths.filter(faith => {
                // Always show player's own faith
                if (player.religion && player.religion.faithId === faith.id) return true;
                // Show if the player knows the religion of any kingdom that practices this faith
                return world.kingdoms.some(k => k.isAlive && k.religion && k.religion.faithId === faith.id && player.knowsAbout(k.id, 'religion'));
            });

            if (knownActiveFaiths.length > 0) {
                html += '<div style="font-size: 13px; color: var(--gold); margin-bottom: 6px;">Active Faiths</div>';
                for (const faith of knownActiveFaiths) {
                    const kingdoms = world.kingdoms.filter(k => k.isAlive && k.religion && k.religion.faithId === faith.id && player.knowsAbout(k.id, 'religion'));
                    html += `
                        <div style="padding: 10px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 3px solid ${faith.holyColor};">
                            <div style="display: flex; justify-content: space-between;">
                                <div><span style="font-size: 18px;">${faith.icon}</span> <strong>${faith.name}</strong></div>
                                <span style="font-size: 11px; color: var(--text-secondary);">Founded yr ${faith.founded}</span>
                            </div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${faith.description}</div>
                            <div style="font-size: 11px; margin-top: 4px;">Tenets: ${faith.tenets.join(', ')}</div>
                            ${kingdoms.length > 0 ? `<div style="font-size: 11px; margin-top: 2px;">Practised by: ${kingdoms.map(k => k.name).join(', ')}</div>` : ''}
                        </div>
                    `;
                }
            }

            if (knownActiveFaiths.length < activeFaiths.length) {
                const unknownCount = activeFaiths.length - knownActiveFaiths.length;
                html += `<div style="color: #95a5a6; font-style: italic; font-size: 12px; margin-bottom: 8px;">There ${unknownCount === 1 ? 'is' : 'are'} ${unknownCount} other faith${unknownCount === 1 ? '' : 's'} in the world you have yet to learn about.</div>`;
            }

            // Extinct faiths — only show ones the player has discovered
            const extinctFaiths = Object.values(Religion.FAITHS).filter(f => f.extinct);
            const discoveredExtinct = extinctFaiths.filter(f => player.discoveredExtinctFaiths && player.discoveredExtinctFaiths.has(f.id));
            const undiscoveredExtinctCount = extinctFaiths.length - discoveredExtinct.length;

            if (discoveredExtinct.length > 0 || undiscoveredExtinctCount > 0) {
                html += '<div style="font-size: 13px; color: #95a5a6; margin: 12px 0 6px;">Extinct Faiths</div>';
                for (const faith of discoveredExtinct) {
                    html += `
                        <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.03); border-radius: 4px; border-left: 3px solid #555; opacity: 0.7;">
                            <div><span style="font-size: 16px;">${faith.icon}</span> <strong>${faith.name}</strong> <span style="font-size: 11px; color: #777;">(${faith.founded} – ${faith.extinctYear})</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${faith.description}</div>
                        </div>
                    `;
                }
                if (undiscoveredExtinctCount > 0) {
                    html += `<div style="color: #95a5a6; font-style: italic; font-size: 12px; margin-bottom: 8px;">There ${undiscoveredExtinctCount === 1 ? 'is' : 'are'} ${undiscoveredExtinctCount} forgotten faith${undiscoveredExtinctCount === 1 ? '' : 's'} lost to history. Explore ancient holy sites, study ruins, or seek knowledge in taverns to uncover them.</div>`;
                }
            }

            // ── HOLY SITES ── (only show ones the player has discovered via exploration)
            const holySites = [];
            const discoveredHS = player.discoveredHolySites || new Set();
            for (let r = 0; r < world.height; r++) {
                for (let q = 0; q < world.width; q++) {
                    const tile = world.getTile(q, r);
                    if (tile && tile.holySite) {
                        // Only show if the player has explored this tile or discovered via other means
                        if (discoveredHS.has(`${q},${r}`)) {
                            holySites.push({ q, r, site: tile.holySite });
                        }
                    }
                }
            }
            // Count total holy sites for hint
            let totalHolySites = 0;
            for (let r = 0; r < world.height; r++) {
                for (let q = 0; q < world.width; q++) {
                    const tile = world.getTile(q, r);
                    if (tile && tile.holySite) totalHolySites++;
                }
            }
            const undiscoveredSiteCount = totalHolySites - holySites.length;

            if (holySites.length > 0 || undiscoveredSiteCount > 0) {
                html += '<div class="info-section-title" style="margin-top: 16px;">⛲ Holy Sites</div>';
                for (const hs of holySites) {
                    const controller = hs.site.controller ? world.getKingdom(hs.site.controller) : null;
                    html += `
                        <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <span style="font-size: 16px;">${hs.site.icon}</span> <strong>${hs.site.name}</strong>
                                <span style="font-size: 11px; color: var(--text-secondary);"> (${hs.q}, ${hs.r})</span>
                            </div>
                            <div style="font-size: 12px;">
                                ${controller ? `<span style="color: ${controller.color};">${controller.name}</span>` : '<span style="color: #f39c12;">Unclaimed</span>'}
                                | 🧑‍🤝‍🧑 ${Utils.formatNumber(hs.site.pilgrimCount || 0)} pilgrims
                            </div>
                        </div>
                    `;
                }
                if (undiscoveredSiteCount > 0) {
                    html += `<div style="color: #95a5a6; font-style: italic; font-size: 12px; margin-top: 4px;">Rumors suggest ${undiscoveredSiteCount} more holy site${undiscoveredSiteCount === 1 ? ' exists' : 's exist'} in unexplored lands.</div>`;
                }
            }
        }

        // ── KINGDOM CULTURAL DATA ── (gated behind religion knowledge per kingdom)
        if (typeof Culture !== 'undefined') {
            html += '<div class="info-section-title" style="margin-top: 16px;">🎭 Kingdom Cultures</div>';
            let anyKnown = false;
            for (const kingdom of world.kingdoms) {
                if (!kingdom.isAlive || !kingdom.cultureData) continue;
                if (!player.knowsAbout(kingdom.id, 'religion')) continue;
                anyKnown = true;
                html += `
                    <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span class="kingdom-dot" style="color:${kingdom.color}; background:${kingdom.color}"></span>
                            <strong>${kingdom.name}</strong>
                            <span style="font-size: 12px; color: var(--text-secondary);"> – ${kingdom.cultureData.tradition.name}</span>
                        </div>
                        <div style="font-size: 12px;">
                            📖 ${Math.floor(kingdom.cultureData.scholarship)} | 🌐 ${Math.floor(kingdom.cultureData.influence)}
                            ${kingdom.religion ? ` | ${kingdom.religion.icon} ${Math.floor(kingdom.religion.piety)} piety` : ''}
                        </div>
                    </div>
                `;
            }
            if (!anyKnown) {
                html += `<div style="color: #95a5a6; font-style: italic; font-size: 12px;">You have not yet learned about the cultural traditions of any kingdom. Visit settlements and speak with locals to discover them.</div>`;
            }
        }

        html += '</div>';
        this.showCustomPanel('🙏 Religion & Culture', html);
    }

    /**
     * Show world history panel
     */
    showHistoryPanel() {
        // Use merged history if Peoples system is available (includes tribal history)
        let mergedHistory;
        if (typeof Peoples !== 'undefined') {
            mergedHistory = Peoples.getMergedHistory(this.game.world);
        } else {
            mergedHistory = (this.game.world.history || []).map(e => ({ ...e, source: 'world' }));
        }

        if (!mergedHistory || mergedHistory.length === 0) {
            this.showCustomPanel('World History', '<p style="color: var(--text-secondary);">No known history recorded.</p>');
            return;
        }

        // Use the rich Peoples history display if available — gated by discovered lore
        if (typeof Peoples !== 'undefined') {
            const discoveredLore = this.game.player.discoveredLore || new Set();
            const html = Peoples.buildTribalHistoryHTML(this.game.world, discoveredLore);
            this.showCustomPanel('📜 History of the Peoples', html);
            return;
        }

        // Fallback: simple timeline
        const sortedHistory = [...mergedHistory].sort((a, b) => a.year - b.year);

        let html = '<div class="history-timeline" style="position: relative; padding-left: 20px;">';
        html += '<div style="position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.1);"></div>';

        for (const event of sortedHistory) {
            html += `
                <div class="history-event" style="margin-bottom: 20px; position: relative;">
                    <div style="position: absolute; left: -20px; top: 4px; width: 14px; height: 14px; background: var(--gold); border-radius: 50%; box-shadow: 0 0 10px var(--gold);"></div>
                    <div style="font-family: var(--font-display); color: var(--gold); font-size: 18px; margin-bottom: 4px;">Year ${event.year}</div>
                    <div style="color: var(--text-primary); line-height: 1.5; font-size: 14px;">${event.text}</div>
                </div>
            `;
        }

        html += '</div>';
        this.showCustomPanel('World History', html);
    }

    /**
     * Show settlement details modal
     */
    showSettlementDetails(q, r) {
        const tile = this.game.world.getTile(q, r);
        if (!tile || !tile.settlement) {
            this.showNotification('Error', 'No settlement found at this location', 'error');
            return;
        }

        const settlement = tile.settlement;
        const kingdom = settlement.kingdom ? this.game.world.getKingdom(settlement.kingdom) : null;
        const econ = Economy.getSummary(settlement, tile, this.game.world);

        // Find the lord of this settlement (for now, use kingdom lord)
        const lord = kingdom && kingdom.lord ? kingdom.lord : null;

        let html = `
            <div style="max-width: 600px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 48px; margin-bottom: 8px;">${settlement.type === 'capital' ? '🏰' : settlement.type === 'town' ? '🏘️' : '🏠'}</div>
                    <h2 style="margin: 0; color: var(--gold); font-family: var(--font-display);">${settlement.name}</h2>
                    <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">${settlement.type.charAt(0).toUpperCase() + settlement.type.slice(1)}</div>
                </div>

                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-row">
                        <span class="info-label">Population</span>
                        <span class="info-value">${Utils.formatNumber(settlement.population)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Founded</span>
                        <span class="info-value">${settlement.founded ? `Year ${settlement.founded} (${this.game.world.year - settlement.founded} years ago)` : 'Ancient times'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Coordinates</span>
                        <span class="info-value">${q}, ${r}</span>
                    </div>
                </div>
        `;

        const player = this.game.player;
        const knows = (cat) => kingdom ? player.knowsAbout(kingdom.id, cat) : false;

        // Kingdom and Lord Information
        if (kingdom) {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-section-title">Allegiance</div>
                    <div class="info-row">
                        <span class="info-label">Kingdom</span>
                        <span class="info-value" style="cursor: pointer; text-decoration: underline; color: ${kingdom.color};" onclick="window.game.ui.showKingdomDetails('${kingdom.id}')">
                            <span class="kingdom-dot" style="color:${kingdom.color}; background:${kingdom.color}"></span>
                            ${kingdom.name}
                        </span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Ruler</span>
                        <span class="info-value">${knows('ruler') ? kingdom.ruler : '<span style="color:#95a5a6;font-style:italic;">Unknown</span>'}</span>
                    </div>
            `;

            if (knows('ruler') && lord) {
                const traitNames = lord.traits.map(t => t.name).join(', ');
                html += `
                    <div class="info-row">
                        <span class="info-label">Lord</span>
                        <span class="info-value">${lord.name}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Age</span>
                        <span class="info-value">${lord.age} years</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Traits</span>
                        <span class="info-value">${traitNames || 'None'}</span>
                    </div>
                `;
            }

            html += `</div>`;
        } else {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-section-title">Allegiance</div>
                    <div class="info-row">
                        <span class="info-label">Status</span>
                        <span class="info-value" style="color: #95a5a6;">Independent</span>
                    </div>
                </div>
            `;
        }

        // Economy — gated behind knowledge
        if (knows('economy')) {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px;">
                    <div class="info-section-title">Economy</div>
                    <div class="info-row">
                        <span class="info-label">💰 Gold Production</span>
                        <span class="info-value" style="color: #f1c40f;">+${econ.production.gold}/day</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">🌾 Food Production</span>
                        <span class="info-value" style="color: #2ecc71;">+${econ.production.food}/day</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">📦 Goods Production</span>
                        <span class="info-value" style="color: #3498db;">+${econ.production.goods}/day</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Trade Routes</span>
                        <span class="info-value">${econ.tradeRoutes}</span>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px;">
                    <div class="info-section-title">Economy</div>
                    <div style="color: #95a5a6; font-style: italic; padding: 8px 0;">You don't know enough about this settlement's economy. Try trading here or asking locals.</div>
                </div>
            `;
        }

        // Cultural Demographics — gated behind knowledge
        if (typeof Peoples !== 'undefined' && settlement.demographics) {
            if (knows('peoples')) {
                html += `
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-top: 16px;">
                `;
                html += Peoples.buildDemographicsHTML(settlement);
                html += `</div>`;
            } else {
                html += `
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-top: 16px;">
                        <div class="info-section-title">Demographics</div>
                        <div style="color: #95a5a6; font-style: italic; padding: 8px 0;">You know little of the peoples who dwell here. Speak with locals or visit the tavern to learn more.</div>
                    </div>
                `;
            }
        }

        html += '</div>';

        this.showCustomPanel(`${settlement.name}`, html);
    }

    /**
     * Show kingdom details modal
     */
    showKingdomDetails(kingdomId) {
        const kingdom = this.game.world.getKingdom(kingdomId);
        if (!kingdom) {
            this.showNotification('Error', 'Kingdom not found', 'error');
            return;
        }

        const lord = kingdom.lord;
        const player = this.game.player;
        const knows = (cat) => player.knowsAbout(kingdom.id, cat);
        const unknownBox = (label) => `<div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <div class="info-section-title">${label}</div>
            <div style="color:#666; font-size:12px; font-style:italic;">You haven't discovered this yet. Talk to locals, visit taverns, or meet their lord to learn more.</div>
        </div>`;

        // Count settlements
        const settlements = this.game.world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
        const capitals = settlements.filter(s => s.type === 'capital');
        const towns = settlements.filter(s => s.type === 'town');
        const villages = settlements.filter(s => s.type === 'village');

        // Calculate total population
        const totalPopulation = settlements.reduce((sum, s) => sum + s.population, 0);

        let html = `
            <div style="max-width: 700px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 64px; margin-bottom: 8px;">👑</div>
                    <h2 style="margin: 0; color: ${kingdom.color}; font-family: var(--font-display);">${kingdom.name}</h2>
                    <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">${knows('peoples') ? kingdom.culture + ' Culture' : 'Culture unknown'}</div>
                </div>

                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-row">
                        <span class="info-label">Ruler</span>
                        <span class="info-value" style="color: var(--gold);">${knows('ruler') ? kingdom.ruler : '<span style=color:#666>Unknown</span>'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Status</span>
                        <span class="info-value" style="color: ${kingdom.isAlive ? '#2ecc71' : '#e74c3c'};">${kingdom.isAlive ? 'Active' : 'Fallen'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Founded</span>
                        <span class="info-value">Year ${kingdom.foundedDay || 1}</span>
                    </div>
                </div>
        `;

        // Lord Details
        if (!knows('ruler')) {
            html += unknownBox('Lord of the Realm');
        } else if (lord) {
            const traitNames = lord.traits.map(t => t.name).join(', ');
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-section-title">Lord of the Realm</div>
                    <div class="info-row">
                        <span class="info-label">Name</span>
                        <span class="info-value">${lord.name}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Age</span>
                        <span class="info-value">${lord.age} years</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Traits</span>
                        <span class="info-value">${traitNames || 'None'}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;">
                        <div class="info-row" style="margin: 0;">
                            <span class="info-label">⚔️ Martial</span>
                            <span class="info-value">${lord.martial}/10</span>
                        </div>
                        <div class="info-row" style="margin: 0;">
                            <span class="info-label">🤝 Diplomacy</span>
                            <span class="info-value">${lord.diplomacy}/10</span>
                        </div>
                        <div class="info-row" style="margin: 0;">
                            <span class="info-label">📊 Stewardship</span>
                            <span class="info-value">${lord.stewardship}/10</span>
                        </div>
                        <div class="info-row" style="margin: 0;">
                            <span class="info-label">🎯 Ambition</span>
                            <span class="info-value">${lord.ambition}/10</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // Territory and Population
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div class="info-section-title">Territory</div>
                <div class="info-row">
                    <span class="info-label">Total Population</span>
                    <span class="info-value">${Utils.formatNumber(totalPopulation)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Settlements</span>
                    <span class="info-value">${settlements.length} (${capitals.length} capital, ${towns.length} towns, ${villages.length} villages)</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Territory Tiles</span>
                    <span class="info-value">${kingdom.territory ? kingdom.territory.length : 0}</span>
                </div>
            </div>
        `;

        // Diplomacy
        if (knows('diplomacy')) {
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div class="info-section-title">Diplomacy</div>
        `;

        const otherKingdoms = this.game.world.kingdoms.filter(k => k.id !== kingdom.id && k.isAlive);
        if (otherKingdoms.length > 0) {
            for (const other of otherKingdoms) {
                const relation = kingdom.relations[other.id] || 0;
                const atWar = kingdom.wars && kingdom.wars.includes(other.id);
                let relationText = '';
                let relationColor = '';

                if (atWar) {
                    relationText = '⚔️ At War';
                    relationColor = '#e74c3c';
                } else if (relation > 50) {
                    relationText = '🤝 Friendly';
                    relationColor = '#2ecc71';
                } else if (relation > 0) {
                    relationText = '😐 Neutral';
                    relationColor = '#95a5a6';
                } else if (relation > -50) {
                    relationText = '😠 Unfriendly';
                    relationColor = '#e67e22';
                } else {
                    relationText = '💢 Hostile';
                    relationColor = '#e74c3c';
                }

                html += `
                    <div class="info-row">
                        <span class="info-label">
                            <span class="kingdom-dot" style="color:${other.color}; background:${other.color}"></span>
                            ${other.name}
                        </span>
                        <span class="info-value" style="color: ${relationColor};">${relationText} (${relation})</span>
                    </div>
                `;
            }
        } else {
            html += `<div style="color: var(--text-secondary); font-style: italic;">No other kingdoms</div>`;
        }

        html += `</div>`;
        } else {
            html += unknownBox('Diplomacy');
        }
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div class="info-section-title">About</div>
                <p style="color: var(--text-secondary); line-height: 1.6; margin: 0;">${kingdom.description}</p>
            </div>
        `;

        // Constituent Peoples
        if (knows('peoples') && typeof Peoples !== 'undefined') {
            const kingdomTribes = Peoples.getTribesForCulture(kingdom.culture);
            if (kingdomTribes.length > 0) {
                html += `
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                        <div class="info-section-title">Constituent Peoples</div>
                        <p style="color: var(--text-secondary); font-size: 12px; line-height: 1.4; margin: 0 0 12px 0;">
                            This realm was forged from the union of ancient tribes, each bringing their own heritage to the kingdom.
                        </p>
                `;
                for (const tribe of kingdomTribes) {
                    html += `
                        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid ${tribe.color};">
                            <div style="color: #fff; font-size: 14px; margin-bottom: 4px;">${tribe.icon} <strong>${tribe.name}</strong></div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">Origin: ${tribe.origin} | Traits: ${tribe.traits.join(', ')}</div>
                            <div style="color: var(--text-secondary); font-size: 11px; font-style: italic;">${tribe.proverb}</div>
                            <div style="color: var(--gold); font-size: 11px; margin-top: 4px;">🎨 ${tribe.artForms.join(', ')} &nbsp;|&nbsp; 🍲 ${tribe.cuisine.slice(0, 2).join(', ')}</div>
                        </div>
                    `;
                }
                html += `</div>`;
            }
        }

        html += '</div>';

        this.showCustomPanel(kingdom.name, html);
    }

    /**
     * Show Peoples & Subcultures panel — a dedicated view of the multicultural world.
     */
    showPeoplesPanel() {
        if (typeof Peoples === 'undefined') {
            this.showNotification('Unavailable', 'Peoples system not loaded', 'error');
            return;
        }

        let html = `<div style="max-width: 700px;">`;

        // Header
        html += `
            <div style="text-align: center; margin-bottom: 20px;">
                <div style="font-size: 48px; margin-bottom: 8px;">🏛️</div>
                <h2 style="margin: 0; color: var(--gold); font-family: var(--font-display);">Peoples of the Realm</h2>
                <p style="color: var(--text-secondary); margin: 8px 0 0 0; font-size: 13px; line-height: 1.5;">
                    Every kingdom is a tapestry of ancient tribal peoples — each with their own customs, cuisine, art, and ancestral memories. 
                    Click a settlement to see its unique demographic composition.
                </p>
            </div>
        `;

        const player = this.game.player;

        // Show each kingdom's constituent peoples — gated behind knowledge
        for (const kingdom of this.game.world.kingdoms) {
            if (!kingdom.isAlive) continue;

            const tribes = Peoples.getTribesForCulture(kingdom.culture);
            if (tribes.length === 0) continue;

            const knowsPeoples = player.knowsAbout(kingdom.id, 'peoples');

            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid ${kingdom.color};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div>
                            <span style="color: ${kingdom.color}; font-family: var(--font-display); font-size: 16px;">${kingdom.name}</span>
                            <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">${knowsPeoples ? kingdom.culture + ' Culture' : 'Culture unknown'}</span>
                        </div>
                    </div>
            `;

            if (knowsPeoples) {
                for (const tribe of tribes) {
                    html += `
                        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <span style="color: #fff; font-size: 14px;">${tribe.icon} <strong>${tribe.name}</strong></span>
                                <span style="color: var(--text-secondary); font-size: 11px;">${tribe.origin}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">
                                Traits: <span style="color: #fff;">${tribe.traits.join(', ')}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">
                                🎨 <span style="color: #fff;">${tribe.artForms.join(', ')}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">
                                🍲 <span style="color: #fff;">${tribe.cuisine.join(', ')}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">
                                🎉 <span style="color: #fff;">${tribe.customs.join(', ')}</span>
                            </div>
                            <div style="color: var(--gold); font-size: 11px; font-style: italic; margin-bottom: 4px;">
                                📜 ${tribe.proverb}
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; font-style: italic; line-height: 1.4;">
                                ${tribe.ancestralMemory}
                            </div>
                        </div>
                    `;
                }
            } else {
                html += `<div style="color: #95a5a6; font-style: italic; padding: 8px 0;">You know nothing of the peoples of ${kingdom.name}. Visit their settlements, speak with locals, or ask their lord to learn more.</div>`;
            }

            html += `</div>`;
        }

        // Most diverse settlements — only show known kingdoms
        const allSettlements = this.game.world.getAllSettlements()
            .filter(s => s.demographics && s.demographics.length > 0 && s.kingdom && player.knowsAbout(s.kingdom, 'peoples'))
            .sort((a, b) => (b.demographics ? b.demographics.length : 0) - (a.demographics ? a.demographics.length : 0))
            .slice(0, 5);

        if (allSettlements.length > 0) {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-section-title">🌍 Most Diverse Settlements</div>
            `;

            for (const s of allSettlements) {
                const tile = this.game.world.getTile(s.q, s.r);
                const settlement = tile ? tile.settlement : s;
                const harmony = settlement.culturalHarmony || 50;
                const harmonyDisplay = Peoples.getHarmonyDisplay(harmony);
                const numPeoples = settlement.demographics ? settlement.demographics.length : 0;
                const tribeIcons = settlement.demographics
                    ? settlement.demographics.map(d => d.tribe.icon).join(' ')
                    : '';

                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;" onclick="window.game.ui.showSettlementDetails(${s.q}, ${s.r})">
                        <div>
                            <span style="color: #fff; font-size: 13px;">${s.name || settlement.name}</span>
                            <span style="color: var(--text-secondary); font-size: 11px; margin-left: 8px;">${numPeoples} peoples</span>
                            <span style="font-size: 11px; margin-left: 4px;">${tribeIcons}</span>
                        </div>
                        <span style="color: ${harmonyDisplay.color}; font-size: 11px;">${harmonyDisplay.icon} ${harmonyDisplay.label}</span>
                    </div>
                `;
            }

            html += `</div>`;
        }

        html += `</div>`;
        this.showCustomPanel('🏛️ Peoples & Subcultures', html);
    }

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
            tabsHtml += `<button onclick="window.game.ui.openTechTab('${cat.id}', this)" class="tech-tab-btn" style="flex:1; min-width: 70px; padding:6px 4px; background:${isActive ? 'rgba(255,255,255,0.1)' : 'none'}; border:none; color:${isActive ? 'var(--gold)' : hasLab ? 'var(--text-secondary)' : '#666'}; cursor:pointer; border-bottom:2px solid ${isActive ? cat.color : 'transparent'}; font-size: 11px; font-weight: ${isActive ? 'bold' : 'normal'};">${cat.icon} ${cat.name}${!hasLab ? ' 🔒' : ''}</button>`;
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
    }

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
    }

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
                        <span style="font-size:18px; margin-right:8px;">${item.icon}</span>
                        <span style="color:var(--text-primary);">${item.name}</span>
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
                        <button onclick="window.game.ui.repayLoan('${loan.id}')" style="margin-top:8px; width:100%; padding:6px; background:#e74c3c; color:white; border:none; border-radius:3px; cursor:pointer;">Repay Full Amount (${loan.totalOwed}g)</button>
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
                            <button onclick="window.game.ui.takeLoan('${opt.id}', '${kingdom.id}')" style="width:100%; padding:4px; font-size:12px; background:var(--gold); border:none; border-radius:3px; cursor:pointer;">Take Loan</button>
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
        const estimatedTax = Taxation.collectTaxes({ ...player }, world).collected; // Dry run roughly

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
                    
                    <div class="info-section-title">Adjust Tax Rate</div>
                    <div style="display:flex; flex-direction:column; gap:5px;">
        `;

        for (const [key, rate] of Object.entries(Taxation.TAX_RATES)) {
            const isSelected = rate.id === currentRate;
            taxHtml += `
                <button onclick="window.game.ui.setTaxRate('${rate.id}')" style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:${isSelected ? 'var(--gold)' : 'rgba(255,255,255,0.05)'}; color:${isSelected ? 'black' : 'var(--text-primary)'}; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    <span style="font-weight:bold;">${rate.name}</span>
                    <span style="font-size:12px; opacity:0.8;">Happ: ${rate.happinessBonus > 0 ? '+' : ''}${rate.happinessBonus} | Growth: ${rate.growthBonus > 0 ? '+' : ''}${(rate.growthBonus * 100).toFixed(0)}%</span>
                </button>
            `;
        }
        taxHtml += `</div></div></div>`;

        // Combine into simple tabs
        const html = `
            <div style="display:flex; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:15px;">
                <button onclick="window.game.ui.openTreasuryTab('tabMarket', this)" class="tab-btn active" style="flex:1; padding:10px; background:none; border:none; color:var(--text-primary); cursor:pointer; border-bottom:2px solid var(--gold); font-weight:bold;">Global Market</button>
                <button onclick="window.game.ui.openTreasuryTab('tabBank', this)" class="tab-btn" style="flex:1; padding:10px; background:none; border:none; color:var(--text-secondary); cursor:pointer;">Royal Bank</button>
                <button onclick="window.game.ui.openTreasuryTab('tabTax', this)" class="tab-btn" style="flex:1; padding:10px; background:none; border:none; color:var(--text-secondary); cursor:pointer;">Treasury</button>
            </div>
            
            ${marketHtml}
            ${bankHtml}
            ${taxHtml}
        `;

        this.showCustomPanel('Royal Treasury', html);
    }

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
    }

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
    }

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
    }

    /**
     * Set Tax Rate (UI Action)
     */
    setTaxRate(rateId) {
        const result = Taxation.setTaxRate(this.game.player, rateId);
        if (result.success) {
            this.showNotification('Policy Updated', `Tax rate set to ${result.policy.name}`, 'info');
            // Refresh panel
            this.showTreasuryPanel(this.game.player, this.game.world);
        } else {
            this.showNotification('Update Failed', result.reason, 'error');
        }
    }

    // ============================================
    // MAP MODES & DATA VISUALIZATION
    // ============================================

    /**
     * Toggle the map mode selector dropdown
     */
    showMapModeSelector() {
        const existing = document.getElementById('mapModeDropdown');
        if (existing) {
            existing.remove();
            return;
        }

        const modes = [
            { id: 'normal',    icon: '🗺️', label: 'Normal',    desc: 'Default terrain view' },
            { id: 'political', icon: '🏰', label: 'Political',  desc: 'Kingdom territories' },
            { id: 'religion',  icon: '🙏', label: 'Religion',   desc: 'Faith distribution' },
            { id: 'wealth',    icon: '💰', label: 'Wealth',     desc: 'Economic output' },
            { id: 'military',  icon: '⚔️', label: 'Military',  desc: 'Army strength' },
            { id: 'trade',     icon: '🐪', label: 'Trade',      desc: 'Routes & resources' },
            { id: 'culture',   icon: '🎭', label: 'Culture',    desc: 'Cultural influence' },
        ];

        const currentMode = this.game.renderer.mapMode;

        const dropdown = document.createElement('div');
        dropdown.id = 'mapModeDropdown';
        dropdown.style.cssText = `
            position: fixed;
            top: 52px;
            right: 10px;
            background: rgba(12, 18, 32, 0.96);
            backdrop-filter: blur(12px);
            border: 1px solid var(--gold);
            border-radius: 8px;
            padding: 8px 0;
            z-index: 500;
            min-width: 200px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.7);
        `;

        let html = `<div style="padding: 4px 14px 8px; font-family: var(--font-display); color: var(--gold); font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 4px;">Map Mode</div>`;

        for (const m of modes) {
            const active = m.id === currentMode;
            html += `<div class="map-mode-option${active ? ' active' : ''}" data-mode="${m.id}" style="
                display: flex; align-items: center; gap: 10px; padding: 8px 14px; cursor: pointer;
                background: ${active ? 'rgba(245,197,66,0.12)' : 'transparent'};
                border-left: 3px solid ${active ? 'var(--gold)' : 'transparent'};
                transition: background 0.15s;
            ">
                <span style="font-size: 18px;">${m.icon}</span>
                <div>
                    <div style="color: ${active ? 'var(--gold)' : 'var(--text-primary)'}; font-size: 13px; font-weight: ${active ? 'bold' : 'normal'};">${m.label}</div>
                    <div style="color: var(--text-secondary); font-size: 11px;">${m.desc}</div>
                </div>
            </div>`;
        }

        // Extra buttons for data panels
        html += `<div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; padding-top: 4px;">`;
        html += `<div class="map-mode-option" data-action="graphs" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;">
            <span style="font-size:18px;">📊</span>
            <div>
                <div style="color:var(--text-primary);font-size:13px;">Economic Trends</div>
                <div style="color:var(--text-secondary);font-size:11px;">Graphs & kingdom stats</div>
            </div>
        </div>`;
        html += `<div class="map-mode-option" data-action="eventlog" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;">
            <span style="font-size:18px;">📜</span>
            <div>
                <div style="color:var(--text-primary);font-size:13px;">Event Log</div>
                <div style="color:var(--text-secondary);font-size:11px;">Major world events</div>
            </div>
        </div>`;
        html += `<div class="map-mode-option" data-action="compare" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;">
            <span style="font-size:18px;">⚖️</span>
            <div>
                <div style="color:var(--text-primary);font-size:13px;">Kingdom Comparison</div>
                <div style="color:var(--text-secondary);font-size:11px;">Side-by-side analysis</div>
            </div>
        </div>`;
        html += `</div>`;

        dropdown.innerHTML = html;
        document.body.appendChild(dropdown);

        // Event handlers
        dropdown.querySelectorAll('.map-mode-option').forEach(el => {
            el.addEventListener('mouseenter', () => el.style.background = 'rgba(245,197,66,0.08)');
            el.addEventListener('mouseleave', () => {
                const isActive = el.dataset.mode === currentMode;
                el.style.background = isActive ? 'rgba(245,197,66,0.12)' : 'transparent';
            });

            el.addEventListener('click', () => {
                if (el.dataset.mode) {
                    this.setMapMode(el.dataset.mode);
                } else if (el.dataset.action === 'graphs') {
                    this.showEconomicTrends();
                } else if (el.dataset.action === 'eventlog') {
                    this.showEventLog();
                } else if (el.dataset.action === 'compare') {
                    this.showKingdomComparison();
                }
                dropdown.remove();
            });
        });

        // Close on click outside
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!dropdown.contains(e.target) && e.target.id !== 'btnMapModes') {
                    dropdown.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 10);
    }

    /**
     * Set the active map mode
     */
    setMapMode(mode) {
        this.game.renderer.mapMode = mode;
        // Force minimap redraw
        if (this.game.minimap) this.game.minimap.invalidate();

        const labels = {
            normal: 'Normal', political: 'Political', religion: 'Religion',
            wealth: 'Wealth', military: 'Military', trade: 'Trade Routes', culture: 'Culture'
        };
        this.showNotification('Map Mode', `${labels[mode] || mode} view active`, 'info');

        // Update button indicator
        const btn = document.getElementById('btnMapModes');
        if (btn) {
            btn.style.borderBottom = mode !== 'normal' ? '2px solid var(--gold)' : 'none';
        }
    }

    /**
     * Show economic trends with canvas-drawn sparkline graphs
     */
    showEconomicTrends() {
        const world = this.game.world;
        const player = this.game.player;

        // Collect kingdom economic data
        const kingdoms = world.kingdoms.filter(k => k.isAlive);

        // Build kingdom summary table
        let kingdomRows = '';
        for (const k of kingdoms) {
            const popStr = Utils.formatNumber(k.population);
            const milStr = Utils.formatNumber(k.military);
            const treasuryStr = Utils.formatNumber(k.treasury);
            const territories = k.territory.length;
            const faithName = k.religion ? (Religion.FAITHS[k.religion.faithId]?.name || 'Unknown') : 'None';
            const cultureInf = k.cultureData ? Math.round(k.cultureData.influence) : 0;

            kingdomRows += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${k.color};margin-right:6px;"></span>${k.name}</td>
                <td style="padding:8px;text-align:right;">${popStr}</td>
                <td style="padding:8px;text-align:right;color:#e74c3c;">${milStr}</td>
                <td style="padding:8px;text-align:right;color:#f5c542;">${treasuryStr}</td>
                <td style="padding:8px;text-align:right;">${territories}</td>
                <td style="padding:8px;text-align:right;">${cultureInf}%</td>
            </tr>`;
        }

        // Player finance sparkline
        const history = player.financeHistory || [];
        let sparklineHtml = '';
        if (history.length > 1) {
            sparklineHtml = `
                <div style="margin-top:16px;">
                    <div class="info-section-title">Your Financial Trends (Last ${history.length} days)</div>
                    <canvas id="financeSparkline" width="520" height="160" style="width:100%;height:160px;border-radius:6px;background:rgba(0,0,0,0.3);margin-top:8px;"></canvas>
                    <div style="display:flex;gap:16px;margin-top:6px;font-size:11px;">
                        <span style="color:#27ae60;">● Gold Balance</span>
                        <span style="color:#3498db;">● Daily Income</span>
                        <span style="color:#e74c3c;">● Daily Expenses</span>
                    </div>
                </div>`;
        }

        // Market price trends
        let marketHtml = '';
        if (typeof MarketDynamics !== 'undefined') {
            const summary = MarketDynamics.getMarketSummary(player.q, player.r, world);
            if (summary && summary.prices) {
                let priceRows = '';
                for (const [goodId, data] of Object.entries(summary.prices)) {
                    const trendIcon = data.trend === 'rising' ? '📈' : data.trend === 'falling' ? '📉' : '➡️';
                    const trendColor = data.trend === 'rising' ? '#e74c3c' : data.trend === 'falling' ? '#27ae60' : 'var(--text-secondary)';
                    priceRows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                        <td style="padding:6px;">${goodId}</td>
                        <td style="padding:6px;text-align:right;color:var(--gold);">${Math.round(data.price || data.currentPrice || 0)}</td>
                        <td style="padding:6px;text-align:right;color:${trendColor};">${trendIcon} ${data.trend || 'stable'}</td>
                    </tr>`;
                }
                if (priceRows) {
                    marketHtml = `
                        <div style="margin-top:16px;">
                            <div class="info-section-title">Market Prices Near You</div>
                            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">
                                <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.15);">
                                    <th style="text-align:left;padding:6px;color:var(--text-secondary);">Good</th>
                                    <th style="text-align:right;padding:6px;color:var(--text-secondary);">Price</th>
                                    <th style="text-align:right;padding:6px;color:var(--text-secondary);">Trend</th>
                                </tr></thead>
                                <tbody>${priceRows}</tbody>
                            </table>
                        </div>`;
                }
            }
        }

        const html = `
            <div class="info-section-title">Kingdom Economic Overview</div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">
                    <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.15);">
                        <th style="text-align:left;padding:8px;color:var(--text-secondary);">Kingdom</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Pop.</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Military</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Treasury</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Tiles</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Culture</th>
                    </tr></thead>
                    <tbody>${kingdomRows}</tbody>
                </table>
            </div>
            ${sparklineHtml}
            ${marketHtml}
        `;

        this.showCustomPanel('📊 Economic Trends', html);

        // Draw sparkline after DOM is ready
        if (history.length > 1) {
            setTimeout(() => this.drawFinanceSparkline(history), 50);
        }
    }

    /**
     * Draw finance sparkline chart on a canvas element
     */
    drawFinanceSparkline(history) {
        const canvas = document.getElementById('financeSparkline');
        if (!canvas) return;

        // Set high-DPI resolution
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const pad = { top: 10, right: 10, bottom: 24, left: 50 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;

        // Extract data series
        const goldData = history.map(d => d.gold);
        const incomeData = history.map(d => d.totalIncome || 0);
        const expenseData = history.map(d => d.totalExpenses || 0);

        const allValues = [...goldData, ...incomeData, ...expenseData];
        const maxVal = Math.max(...allValues, 1);
        const minVal = Math.min(...allValues, 0);
        const range = maxVal - minVal || 1;

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (plotH * i / 4);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();

            // Labels
            const val = maxVal - (range * i / 4);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(val), pad.left - 6, y + 4);
        }

        // X-axis labels
        const step = Math.max(1, Math.floor(history.length / 6));
        for (let i = 0; i < history.length; i += step) {
            const x = pad.left + (plotW * i / (history.length - 1));
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`D${history[i].day || i + 1}`, x, h - 6);
        }

        // Helper: draw line
        const drawLine = (data, color, lineWidth = 2) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            for (let i = 0; i < data.length; i++) {
                const x = pad.left + (plotW * i / Math.max(1, data.length - 1));
                const y = pad.top + plotH - (plotH * (data[i] - minVal) / range);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        };

        drawLine(goldData, '#27ae60', 2.5);
        drawLine(incomeData, '#3498db', 1.5);
        drawLine(expenseData, '#e74c3c', 1.5);
    }

    /**
     * Show detailed event log panel
     */
    showEventLog() {
        const world = this.game.world;
        const events = world.events || [];
        const history = world.history || [];

        // Combine and sort
        const allEvents = [];

        // Current game events
        for (const ev of events) {
            allEvents.push({
                day: ev.day || world.day,
                year: ev.year || world.year,
                category: ev.category || 'GENERAL',
                text: ev.text || ev.description || JSON.stringify(ev),
                kingdom: ev.kingdom || null,
                impact: ev.impact || null,
            });
        }

        // Historical events
        for (const h of history) {
            allEvents.push({
                day: 0,
                year: h.year || 0,
                category: 'HISTORY',
                text: h.text || '',
                kingdom: h.kingdom || null,
                impact: null,
            });
        }

        // Sort: recent first
        allEvents.sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year;
            return (b.day || 0) - (a.day || 0);
        });

        // Category colors
        const catColors = {
            POLITICAL: '#3498db',
            ECONOMIC: '#f5c542',
            MILITARY: '#e74c3c',
            NATURAL: '#27ae60',
            RELIGIOUS: '#8e44ad',
            HISTORY: '#7f8c8d',
            GENERAL: '#95a5a6',
        };

        const catIcons = {
            POLITICAL: '👑',
            ECONOMIC: '💰',
            MILITARY: '⚔️',
            NATURAL: '🌿',
            RELIGIOUS: '🙏',
            HISTORY: '📖',
            GENERAL: '📌',
        };

        // Filter tabs
        let filterHtml = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">`;
        filterHtml += `<button class="event-log-filter active" data-cat="ALL" style="padding:4px 10px;border-radius:12px;border:1px solid var(--gold);background:rgba(245,197,66,0.15);color:var(--gold);cursor:pointer;font-size:11px;">All</button>`;
        for (const [cat, color] of Object.entries(catColors)) {
            filterHtml += `<button class="event-log-filter" data-cat="${cat}" style="padding:4px 10px;border-radius:12px;border:1px solid ${color};background:transparent;color:${color};cursor:pointer;font-size:11px;">${catIcons[cat] || ''} ${cat[0] + cat.slice(1).toLowerCase()}</button>`;
        }
        filterHtml += `</div>`;

        // Event entries
        let eventsHtml = `<div id="eventLogEntries">`;
        if (allEvents.length === 0) {
            eventsHtml += `<p style="color:var(--text-secondary);text-align:center;padding:20px;">No events recorded yet.</p>`;
        } else {
            const maxShow = Math.min(allEvents.length, 150);
            for (let i = 0; i < maxShow; i++) {
                const ev = allEvents[i];
                const cat = (ev.category || 'GENERAL').toUpperCase();
                const color = catColors[cat] || '#95a5a6';
                const icon = catIcons[cat] || '📌';
                const timeStr = ev.year > 0 ? (ev.day > 0 ? `Day ${((ev.day - 1) % 30) + 1}, Year ${ev.year}` : `Year ${ev.year}`) : '';

                let impactHtml = '';
                if (ev.impact) {
                    const impacts = typeof ev.impact === 'object' ? ev.impact : {};
                    const parts = [];
                    for (const [k, v] of Object.entries(impacts)) {
                        if (typeof v === 'number') {
                            parts.push(`<span style="color:${v >= 0 ? '#27ae60' : '#e74c3c'};font-size:10px;">${k}: ${v >= 0 ? '+' : ''}${v}</span>`);
                        }
                    }
                    if (parts.length) impactHtml = `<div style="margin-top:3px;">${parts.join(' · ')}</div>`;
                }

                eventsHtml += `<div class="event-log-entry" data-category="${cat}" style="
                    padding: 8px 12px; margin-bottom: 4px; border-radius: 6px;
                    border-left: 3px solid ${color}; background: rgba(255,255,255,0.02);
                ">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:13px;">${icon} ${ev.text}</span>
                        <span style="color:var(--text-secondary);font-size:10px;white-space:nowrap;margin-left:8px;">${timeStr}</span>
                    </div>
                    ${impactHtml}
                </div>`;
            }
            if (allEvents.length > maxShow) {
                eventsHtml += `<p style="color:var(--text-secondary);text-align:center;font-size:11px;padding:8px;">... and ${allEvents.length - maxShow} more events</p>`;
            }
        }
        eventsHtml += `</div>`;

        const html = `
            <div style="margin-bottom:8px;color:var(--text-secondary);font-size:12px;">
                ${allEvents.length} events recorded · ${history.length} historical · ${events.length} current game
            </div>
            ${filterHtml}
            ${eventsHtml}
        `;

        this.showCustomPanel('📜 World Event Log', html);

        // Wire filter buttons
        setTimeout(() => {
            document.querySelectorAll('.event-log-filter').forEach(btn => {
                btn.addEventListener('click', () => {
                    // Toggle active
                    document.querySelectorAll('.event-log-filter').forEach(b => {
                        b.classList.remove('active');
                        b.style.background = 'transparent';
                    });
                    btn.classList.add('active');
                    btn.style.background = 'rgba(245,197,66,0.15)';

                    const cat = btn.dataset.cat;
                    document.querySelectorAll('.event-log-entry').forEach(entry => {
                        if (cat === 'ALL' || entry.dataset.category === cat) {
                            entry.style.display = 'block';
                        } else {
                            entry.style.display = 'none';
                        }
                    });
                });
            });
        }, 50);
    }

    /**
     * Show kingdom comparison panel with bar charts
     */
    showKingdomComparison() {
        const world = this.game.world;
        const kingdoms = world.kingdoms.filter(k => k.isAlive);

        if (kingdoms.length === 0) {
            this.showCustomPanel('⚖️ Kingdom Comparison', '<p style="color:var(--text-secondary);">No living kingdoms to compare.</p>');
            return;
        }

        // Gather data for comparison
        const metrics = [
            { key: 'population', label: 'Population', icon: '👥', format: v => Utils.formatNumber(v) },
            { key: 'military', label: 'Military Strength', icon: '⚔️', format: v => Utils.formatNumber(v) },
            { key: 'treasury', label: 'Treasury', icon: '💰', format: v => Utils.formatNumber(v) },
            { key: 'territory', label: 'Territory Size', icon: '🏴', format: v => v },
            { key: 'settlements', label: 'Settlements', icon: '🏘️', format: v => v },
            { key: 'piety', label: 'Piety', icon: '🙏', format: v => Math.round(v) },
            { key: 'culture', label: 'Cultural Influence', icon: '🎭', format: v => Math.round(v) + '%' },
            { key: 'scholarship', label: 'Scholarship', icon: '📚', format: v => Math.round(v) },
        ];

        // Build data
        const data = kingdoms.map(k => {
            // Count settlements
            let settlementCount = 0;
            for (const t of k.territory) {
                const tile = world.getTile(t.q, t.r);
                if (tile && tile.settlement) settlementCount++;
            }

            return {
                kingdom: k,
                population: k.population,
                military: k.military,
                treasury: k.treasury,
                territory: k.territory.length,
                settlements: settlementCount,
                piety: k.religion ? (k.religion.piety || 0) : 0,
                culture: k.cultureData ? (k.cultureData.influence || 0) : 0,
                scholarship: k.cultureData ? (k.cultureData.scholarship || 0) : 0,
            };
        });

        let html = '';

        // Radar-style summary with bar charts per metric
        for (const metric of metrics) {
            const values = data.map(d => d[metric.key]);
            const maxVal = Math.max(...values, 1);

            html += `<div style="margin-bottom:16px;">
                <div class="info-section-title" style="font-size:12px;">${metric.icon} ${metric.label}</div>`;

            for (let i = 0; i < data.length; i++) {
                const d = data[i];
                const k = d.kingdom;
                const val = d[metric.key];
                const pct = Math.round((val / maxVal) * 100);

                html += `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                    <span style="width:100px;font-size:11px;color:var(--text-secondary);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${k.name}">${k.name.split(' ').pop()}</span>
                    <div style="flex:1;height:18px;background:rgba(255,255,255,0.05);border-radius:9px;overflow:hidden;position:relative;">
                        <div style="height:100%;width:${pct}%;background:${k.color};border-radius:9px;transition:width 0.3s;"></div>
                    </div>
                    <span style="width:60px;font-size:11px;color:var(--text-primary);text-align:right;">${metric.format(val)}</span>
                </div>`;
            }

            html += `</div>`;
        }

        // Diplomatic relations matrix
        html += `<div style="margin-top:16px;">
            <div class="info-section-title" style="font-size:12px;">🤝 Diplomatic Relations</div>
            <div style="overflow-x:auto;margin-top:8px;">
                <table style="border-collapse:collapse;font-size:11px;width:100%;">
                    <thead><tr>
                        <th style="padding:4px;"></th>`;

        for (const k of kingdoms) {
            html += `<th style="padding:4px;color:${k.color};text-align:center;font-size:10px;" title="${k.name}">${k.name.split(' ').pop().substring(0, 5)}</th>`;
        }
        html += `</tr></thead><tbody>`;

        for (const k1 of kingdoms) {
            html += `<tr><td style="padding:4px;color:${k1.color};font-size:10px;" title="${k1.name}">${k1.name.split(' ').pop().substring(0, 7)}</td>`;
            for (const k2 of kingdoms) {
                if (k1.id === k2.id) {
                    html += `<td style="padding:4px;text-align:center;color:var(--text-secondary);">—</td>`;
                } else {
                    const rel = k1.relations ? (k1.relations[k2.id] || 0) : 0;
                    const relColor = rel > 30 ? '#27ae60' : rel < -30 ? '#e74c3c' : '#f5c542';
                    const atWar = k1.wars && k1.wars.includes(k2.id);
                    const allied = k1.allies && k1.allies.includes(k2.id);
                    let relText = rel.toString();
                    if (atWar) relText = '⚔️';
                    if (allied) relText = '🤝';
                    html += `<td style="padding:4px;text-align:center;color:${relColor};font-size:10px;" title="${k1.name} → ${k2.name}: ${rel}">${relText}</td>`;
                }
            }
            html += `</tr>`;
        }
        html += `</tbody></table></div></div>`;

        // Power ranking
        html += `<div style="margin-top:16px;">
            <div class="info-section-title" style="font-size:12px;">🏆 Power Ranking</div>`;

        const ranked = [...data].sort((a, b) => {
            const scoreA = a.population * 0.3 + a.military * 2 + a.treasury * 0.5 + a.territory * 10;
            const scoreB = b.population * 0.3 + b.military * 2 + b.treasury * 0.5 + b.territory * 10;
            return scoreB - scoreA;
        });

        for (let i = 0; i < ranked.length; i++) {
            const d = ranked[i];
            const k = d.kingdom;
            const score = Math.round(d.population * 0.3 + d.military * 2 + d.treasury * 0.5 + d.territory * 10);
            const medals = ['🥇', '🥈', '🥉', '4th', '5th'];

            html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:16px;min-width:24px;text-align:center;">${medals[i] || (i+1)+'th'}</span>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${k.color};"></span>
                <span style="flex:1;color:var(--text-primary);font-size:12px;">${k.name}</span>
                <span style="color:var(--gold);font-size:12px;font-weight:bold;">${Utils.formatNumber(score)} pts</span>
            </div>`;
        }
        html += `</div>`;

        this.showCustomPanel('⚖️ Kingdom Comparison', html);
    }
}
