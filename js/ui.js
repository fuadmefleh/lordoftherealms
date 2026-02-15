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

        // Global Control buttons
        document.getElementById('btnToggleResources').addEventListener('click', () => {
            const renderer = this.game.renderer;
            renderer.showResources = !renderer.showResources;
            this.showNotification('Display', `Resource Icons: ${renderer.showResources ? 'ON' : 'OFF'}`, 'info');
        });
        document.getElementById('btnEndTurn').addEventListener('click', () => this.game.endDay());

        // Panel close buttons
        document.getElementById('hexInfoClose').addEventListener('click', () => this.hidePanel('hexInfoPanel'));
        document.getElementById('kingdomClose').addEventListener('click', () => this.hidePanel('kingdomPanel'));
        document.getElementById('characterClose').addEventListener('click', () => this.hidePanel('characterPanel'));
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

        title.textContent = tile.terrain.name;

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
                <span class="info-value">${tile.terrain.icon} ${tile.terrain.name}</span>
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
                <span class="info-value">${tile.terrain.moveCost === Infinity ? '∞' : tile.terrain.moveCost}</span>
            </div>
        `;

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
                        <span class="info-value">
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

            html += `
                <div class="info-section-title">Settlement</div>
                <div class="info-row">
                    <span class="info-label">Name</span>
                    <span class="info-value">${tile.settlement.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Type</span>
                    <span class="info-value">${tile.settlement.type}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Population</span>
                    <span class="info-value">${Utils.formatNumber(tile.settlement.population)}</span>
                </div>
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

        if (tile.improvement) {
            html += `
                <div class="info-section-title">Point of Interest</div>
                <div class="info-row">
                    <span class="info-label">${tile.improvement.icon} ${tile.improvement.name}</span>
                </div>
            `;
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

        title.innerHTML = `<span class="kingdom-dot" style="color:${kingdom.color}; background:${kingdom.color}"></span> ${kingdom.name}`;

        let relationsHtml = '';
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

        let warsHtml = '';
        if (kingdom.wars && kingdom.wars.length > 0) {
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
        if (kingdom.allies && kingdom.allies.length > 0) {
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

        // Lord information
        let lordHtml = '';
        if (kingdom.lord) {
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

        body.innerHTML = `
            <div class="info-row">
                <span class="info-label">Ruler</span>
                <span class="info-value">${kingdom.ruler}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Culture</span>
                <span class="info-value">${kingdom.culture}</span>
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
            <div class="info-row">
                <span class="info-label">Military</span>
                <span class="info-value">⚔️ ${Utils.formatNumber(kingdom.military || 0)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Treasury</span>
                <span class="info-value">💰 ${Utils.formatNumber(kingdom.treasury)}</span>
            </div>
            <p style="margin-top:12px; color: var(--text-secondary); font-size: 12px; font-style: italic;">
                "${kingdom.description}"
            </p>
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

            <div class="info-section-title">Skills</div>
            ${skillsHtml}
        `;

        this.showPanel('characterPanel');
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
        if (existing) existing.remove();

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
            max-width: 600px;
            max-height: 80vh;
            z-index: 1000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            overflow: hidden;
        `;

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <h3 style="margin: 0; font-family: var(--font-display); color: var(--gold);">${title}</h3>
                <button id="closeCustomPanel" style="background: none; border: none; color: var(--text-primary); font-size: 20px; cursor: pointer;">✕</button>
            </div>
            <div style="padding: 16px; overflow-y: auto; max-height: calc(80vh - 60px);">
                ${htmlContent}
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('closeCustomPanel').addEventListener('click', () => {
            panel.remove();
        });
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
                const item = PlayerEconomy.GOODS[itemId.toUpperCase()];
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
}
