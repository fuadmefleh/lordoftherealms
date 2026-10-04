// UI — hexinfo methods.
import { UI } from './core.js';
import { Utils, ActionMenu, Religion, Economy, PlayerEconomy, PlayerReligion, Infrastructure, Peoples, CustomObjects, Characters, Culture, Quests, Technology, Banking, MarketDynamics, Taxation, Hex, SaveLoad, audioManager, NpcFamily, Relationships, Housing, WorldEvents, InnerMap, InnerMapRenderer, KingdomBonuses, KingdomStability } from './_imports.js';

Object.assign(UI.prototype, {
    /**
     * Show hex info panel when a tile is clicked
     */
    showHexInfo(tile, q, r) {
        const panel = document.getElementById('hexInfoPanel');
        const title = document.getElementById('hexInfoTitle');
        const body = document.getElementById('hexInfoBody');

        const isPlayerTile = !!this.game?.player && this.game.player.q === q && this.game.player.r === r;
        const isKnownTile = !!tile && (tile.explored || tile.visible || isPlayerTile);

        // Defensive backfill for older/mismatched states where visibility is present
        // but explored flag wasn't persisted.
        if (tile && tile.visible && !tile.explored) {
            tile.explored = true;
        }

        // Unexplored tiles: show only coordinates
        if (!isKnownTile) {
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
        // Fording an unbridged river costs the player extra stamina
        const riverPenalty = (typeof Infrastructure !== 'undefined' && Infrastructure.getRiverPenalty)
            ? Infrastructure.getRiverPenalty(tile, this.game?.player) : 0;

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
                <span class="info-value">${tile.terrain.moveCost === Infinity ? '∞' : tile.terrain.moveCost}${tile.infrastructure ? ` → ${typeof Infrastructure !== 'undefined' ? Infrastructure.getEffectiveMoveCost(tile) : tile.terrain.moveCost} (${tile.infrastructure.name})` : ''}${riverPenalty > 0 ? ` +${riverPenalty} (river)` : ''}</span>
            </div>
        `;

        // Timed world events reaching this tile (droughts, plagues, booms, ...)
        const tileEvents = WorldEvents.getEventsAt(this.game.world, tile);
        if (tileEvents.length > 0) {
            html += '<div class="info-row" style="flex-direction: column; align-items: flex-start; gap: 2px;">';
            html += '<span class="info-label">Active events</span>';
            for (const ev of tileEvents) {
                const where = ev.kingdomId ? ev.regionName : 'Realm-wide';
                html += `<span class="info-value" style="font-size: 12px;" title="${(ev.text || '').replace(/"/g, '&quot;')}">${ev.icon} ${ev.name} · ${where} · ${ev.daysLeft}d left</span>`;
                const effects = WorldEvents.describeEffects(ev);
                if (effects) html += `<span style="font-size: 10px; color: var(--text-secondary); padding-left: 18px;">${effects}</span>`;
            }
            html += '</div>';
        }

        // Show infrastructure info
        if (tile.infrastructure) {
            const infraStatus = tile.infrastructure.underConstruction
                ? ` <span style="color: #e0a040;">🔨 ${tile.infrastructure.constructionDaysLeft}d left</span>`
                : '';
            html += `
                <div class="info-section-title">Infrastructure</div>
                <div class="info-row">
                    <span class="info-label">${tile.infrastructure.icon} ${tile.infrastructure.name}${infraStatus}</span>
                </div>
            `;
            if (tile.infrastructure.productivityBonus > 0 && !tile.infrastructure.underConstruction) {
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
                <button data-ui-act="openActionMenu" style="width:100%; margin-top:8px; padding:8px; background:var(--gold); border:none; border-radius:4px; font-weight:bold; cursor:pointer; color:var(--text-primary);">
                    Open Actions
                </button>
            `;
        }

        if (tile.resource) {
            const resourceName = tile.resource.name || tile.resource.id || 'Unknown Resource';
            const resourceIcon = tile.resource.icon || '📦';
            html += `
                <div class="info-section-title">Resources</div>
                <div class="info-row">
                    <span class="info-label">${resourceIcon} ${resourceName}</span>
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
                    <span class="info-value" style="color:#ffffff !important; cursor: pointer; text-decoration: underline;" data-ui-act="showSettlementDetails" data-ui-args="[${q}, ${r}]">${tile.settlement.name}</span>
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
                <div class="info-row economic-row" data-ui-act="showEconomicBreakdown" data-ui-args='["${q},${r}"]' style="cursor:pointer; transition: background 0.2s; border-radius: 4px; padding: 4px;" title="Click for economic breakdown">
                    <span class="info-label">💰 Gold Production</span>
                    <span class="info-value">+${econ.production.gold}/day <i style="font-size:10px; opacity:0.6;">(details)</i></span>
                </div>
                <div class="info-row economic-row" data-ui-act="showEconomicBreakdown" data-ui-args='["${q},${r}"]' style="cursor:pointer; transition: background 0.2s; border-radius: 4px; padding: 4px;" title="Click for economic breakdown">
                    <span class="info-label">🌾 Food Production</span>
                    <span class="info-value">+${econ.production.food}/day <i style="font-size:10px; opacity:0.6;">(details)</i></span>
                </div>
                <div class="info-row economic-row" data-ui-act="showEconomicBreakdown" data-ui-args='["${q},${r}"]' style="cursor:pointer; transition: background 0.2s; border-radius: 4px; padding: 4px;" title="Click for economic breakdown">
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
                const constructionStatus = prop.underConstruction
                    ? `<div class="info-row"><span class="info-label">Status</span><span class="info-value" style="color:#e0a040;">🔨 Building (${prop.constructionDaysLeft}d left)</span></div>`
                    : '';
                html += `
                    <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; margin-bottom: 8px;${prop.underConstruction ? ' opacity: 0.7; border-left: 3px solid #e0a040;' : ''}">
                        <div class="info-row">
                            <span class="info-label">Building</span>
                            <span class="info-value" style="color:#ffffff !important;">${prop.icon} ${prop.name}</span>
                        </div>
                        ${constructionStatus}
                        ${!prop.underConstruction ? `<div class="info-row">
                            <span class="info-label">Level</span>
                            <span class="info-value">${prop.level}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Production</span>
                            <span class="info-value">${prop.productionRate}/day (${prop.produces})</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Storage</span>
                            <span class="info-value">${prop.storage}${this.game && this.game.player && prop.type !== 'tavern' ? ` / ${PlayerEconomy.getStorageCapacity(this.game.player, prop)}` : ''}</span>
                        </div>` : ''}
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
    },

    /**
     * Show hex info panel for an inner-map tile.
     * Mirrors the world-map showHexInfo() but with inner-tile details.
     */
    showInnerHexInfo(tile, q, r) {
        const panel = document.getElementById('hexInfoPanel');
        const title = document.getElementById('hexInfoTitle');
        const body  = document.getElementById('hexInfoBody');

        if (!tile) return;

        // Unexplored inner tile
        if (!tile.explored) {
            title.textContent = 'Unexplored';
            title.style.color = '#888888';
            body.innerHTML = `
                <div class="info-row">
                    <span class="info-label">Coordinates</span>
                    <span class="info-value">${q}, ${r}</span>
                </div>
                <div style="color:#666; font-style:italic; margin-top:8px; font-size:12px;">
                    This area has not been explored yet. Move closer to reveal it.
                </div>
            `;
            panel.classList.add('visible');
            this.showPanel('hexInfoPanel');
            return;
        }

        const terrain = tile.subTerrain;

        // ── Determine what the primary "object" on this tile is for the panel title ──
        let panelTitle = terrain.name;
        if (tile.building || tile.buildingInfo) panelTitle = tile.buildingInfo ? tile.buildingInfo.name : _innerBuildingReadableName(tile.building);
        title.textContent = panelTitle;
        title.style.color = (tile.building || tile.buildingInfo) ? 'var(--gold)' : '#ffffff';

        // Helper: turn a building sprite path into a readable name
        function _innerBuildingReadableName(spritePath) {
            if (!spritePath) return 'Building';
            const base = spritePath.split('/').pop().replace(/\.\w+$/, '');
            // Insert spaces before capitals, replace underscores, strip trailing digits
            return base
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/_/g, ' ')
                .replace(/\s*\d+$/, '')
                .replace(/\b\w/g, c => c.toUpperCase())
                .trim() || 'Building';
        }

        // Helper: object overlay info table
        const _OBJECT_INFO = {
            tree:     { icon: '🌲', label: 'Tree',          yields: 'Wood, Bark',          desc: 'A harvestable tree. Yields lumber and bark.' },
            rock:     { icon: '⛰️', label: 'Rock Formation', yields: 'Stone, Flint',        desc: 'Loose rocks or a stone outcrop. Yields stone and flint.' },
            plant:    { icon: '🌿', label: 'Wild Plant',     yields: 'Herbs, Fiber',         desc: 'Wild vegetation useful for medicine or rope.' },
            flower:   { icon: '🌸', label: 'Wildflowers',    yields: 'Dye, Reagents',        desc: 'Colourful flora with alchemical and dye uses.' },
            mushroom: { icon: '🍄', label: 'Mushrooms',      yields: 'Food, Alchemical Base', desc: 'Edible or toxic fungi used in potions.' },
        };

        const parentLabel = tile.parentTerrain
            ? tile.parentTerrain.charAt(0).toUpperCase() + tile.parentTerrain.slice(1).replace(/_/g, ' ')
            : 'Unknown';

        let html = '';

        // ── Custom object section ──
        if (typeof CustomObjects !== 'undefined' && CustomObjects.isLoaded()) {
            // Resolve anchor if this is a footprint part
            let objDefId = null;
            let anchorTile = tile;
            if (tile.customObject) {
                objDefId = tile.customObject.defId;
            } else if (tile.customObjectPart) {
                const anchor = InnerMap.getTile(tile.customObjectPart.anchorQ, tile.customObjectPart.anchorR);
                if (anchor && anchor.customObject) { objDefId = anchor.customObject.defId; anchorTile = anchor; }
            }
            if (objDefId) {
                const def = CustomObjects.getDef(objDefId);
                if (def) {
                    // Override panel title
                    panelTitle = def.name || objDefId;
                    title.textContent = panelTitle;
                    title.style.color = 'var(--gold)';

                    const _TYPE_ICONS = { rock: '⛰️', tree: '🌲', plant: '🌿', decoration: '✨', furniture: '🪑', building: '🏠', other: '📌' };
                    const typeIcon = _TYPE_ICONS[def.objectType] || '📦';
                    const bw = def.bounds ? (def.bounds.maxCol - def.bounds.minCol + 1) : 1;
                    const bh = def.bounds ? (def.bounds.maxRow - def.bounds.minRow + 1) : 1;

                    html += `<div class="info-section-title">${typeIcon} ${def.name || objDefId}</div>`;
                    html += `<div class="info-row"><span class="info-label">Type</span><span class="info-value">${(def.objectType || 'other').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span></div>`;
                    html += `<div class="info-row"><span class="info-label">Size</span><span class="info-value">${bw}×${bh} tiles</span></div>`;

                    if (def.animation && def.animation !== 'none') {
                        const _ANIM_LABELS = { combat_1h_slash: '⚔️ Chop / Slash', combat_1h_halfslash: '🪓 Half Swing', legacy_swing: '⛏️ Swing (Mine/Dig)', sitting: '🪑 Sit', idle: '🧍 Idle / Inspect', emotes: '🙏 Emote / Pray', climb: '🧗 Climb' };
                        html += `<div class="info-row"><span class="info-label">Interact</span><span class="info-value" style="color:#4FC3F7;">${_ANIM_LABELS[def.animation] || def.animation}</span></div>`;
                    }
                    if (def.resource) {
                        html += `<div class="info-row"><span class="info-label">Resource</span><span class="info-value" style="color:#81c784;">${(def.resource.type || '?').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} ×${def.resource.amount || 1}</span></div>`;
                    }
                    if (def.terrainBindings && def.terrainBindings.length) {
                        html += `<div class="info-row"><span class="info-label">Terrain</span><span class="info-value" style="font-size:11px; color:rgba(255,255,255,0.5);">${def.terrainBindings.map(t=>t.replace(/_/g,' ')).join(', ')}</span></div>`;
                    }
                }
            }
        }

        // ── Object overlay section (built-in tree, rock, plant, etc.) ──
        if (typeof InnerMapRenderer !== 'undefined' && typeof InnerMapRenderer._getObjectOverlay === 'function') {
            const overlay = InnerMapRenderer._getObjectOverlay(tile);
            if (overlay && overlay.type) {
                const oi = _OBJECT_INFO[overlay.type] || { icon: '🌱', label: overlay.type, yields: '—', desc: '' };
                html += `
                    <div class="info-section-title">${oi.icon} ${oi.label}</div>
                    <div class="info-row">
                        <span class="info-label">Yields</span>
                        <span class="info-value" style="color:#81c784;">${oi.yields}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-value" style="font-size:11px; color:rgba(255,255,255,0.45); font-style:italic;">${oi.desc}</span>
                    </div>
                `;
            }
        }

        // ── Building section ──
        if (tile.buildingInfo) {
            // Rich building data (player property or named structure)
            const bldg = tile.buildingInfo;
            html += `<div class="info-section-title">🏛️ ${bldg.name}</div>`;
            if (bldg.description) {
                html += `<div class="info-row"><span class="info-value" style="font-size:11px; color:rgba(255,255,255,0.45); font-style:italic;">${bldg.description}</span></div>`;
            }
            if (bldg.produces) {
                html += `<div class="info-row"><span class="info-label">Produces</span><span class="info-value" style="color:#81c784;">${bldg.produces}</span></div>`;
            }
            if (typeof InnerMap !== 'undefined') {
                const actions = InnerMap.getBuildingActions(bldg);
                if (actions.length > 0 && actions[0] !== 'closed') {
                    html += `<div class="info-row"><span class="info-label">Actions</span><span class="info-value" style="font-size:11px; color:#4FC3F7;">Right-click to interact</span></div>`;
                } else if (actions[0] === 'closed') {
                    html += `<div class="info-row"><span class="info-label">Status</span><span class="info-value" style="color:#e74c3c;">🚫 Closed</span></div>`;
                }
            }
        } else if (tile.building) {
            // Settlement building — derive name from sprite path
            const bName = _innerBuildingReadableName(tile.building);
            const hint = tile._buildingTypeHint;
            const typeDesc = hint === 'farm' ? 'Farm' : 'Settlement Building';
            html += `
                <div class="info-section-title">🏛️ ${bName}</div>
                <div class="info-row">
                    <span class="info-label">Type</span>
                    <span class="info-value">${typeDesc}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Access</span>
                    <span class="info-value" style="color:#e74c3c;">🚫 Impassable</span>
                </div>
            `;
        }

        // ── Terrain section ──
        html += `
            <div class="info-section-title">🗺️ Terrain</div>
            <div class="info-row">
                <span class="info-label">Ground</span>
                <span class="info-value">${terrain.icon || ''} ${terrain.name}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Region</span>
                <span class="info-value">${parentLabel}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Position</span>
                <span class="info-value" style="color:rgba(255,255,255,0.5); font-size:11px;">${q}, ${r}</span>
            </div>
        `;
        if (terrain.passable === false) {
            html += `<div class="info-row"><span class="info-label">Passable</span><span class="info-value" style="color:#e74c3c;">✘ No</span></div>`;
        }

        // ── NPCs on this tile ──
        if (typeof InnerMap !== 'undefined') {
            const npcsHere = InnerMap.getNPCsAt(q, r);
            if (npcsHere.length > 0) {
                html += `<div class="info-section-title">👥 People Here</div>`;
                for (const npc of npcsHere.slice(0, 5)) {
                    const typeDef = InnerMap.NPC_TYPES[npc.type] || {};
                    const stateLabel = npc.state === 'walking' ? '🚶 Walking'
                        : npc.state === 'at_building' ? `🏛️ ${npc.currentBuilding || 'At building'}`
                        : '💭 Idle';
                    html += `
                        <div class="info-row" style="padding-top:5px;">
                            <span class="info-label">${npc.icon} ${npc.name}</span>
                            <span class="info-value" style="color:rgba(255,255,255,0.45); font-size:10px;">${typeDef.name || npc.type}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label" style="font-size:10px; padding-left:18px; color:rgba(255,255,255,0.35);">Activity</span>
                            <span class="info-value" style="font-size:10px;">${stateLabel}</span>
                        </div>
                    `;
                }
                if (npcsHere.length > 5) {
                    html += `<div class="info-row"><span class="info-value" style="font-size:10px; color:rgba(255,255,255,0.35);">…and ${npcsHere.length - 5} more</span></div>`;
                }
            }
        }

        // ── Player standing here ──
        if (typeof InnerMap !== 'undefined' && InnerMap.playerInnerQ === q && InnerMap.playerInnerR === r) {
            html += `
                <div class="info-section-title">🧭 You Are Here</div>
            `;
        }

        // Exploration summary
        if (typeof InnerMap !== 'undefined') {
            const summary = InnerMap.getSummary();
            if (summary) {
                html += `
                    <div class="info-section-title">Exploration</div>
                    <div class="info-row">
                        <span class="info-label">Progress</span>
                        <span class="info-value">${summary.exploredPercent}%</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Discoveries</span>
                        <span class="info-value">${summary.discoveredEncounters} / ${summary.encounters}</span>
                    </div>
                `;
            }
        }

        body.innerHTML = html;
        this.showPanel('hexInfoPanel');
    },

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
    },

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
                ${KingdomBonuses.describeTradition(kingdom.cultureData.tradition).length ? `<div class="info-row">
                    <span class="info-label">Tradition bonuses</span>
                    <span class="info-value" style="font-size: 11px;">${KingdomBonuses.describeTradition(kingdom.cultureData.tradition).join(', ')}</span>
                </div>` : ''}
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
            ${typeof kingdom.stability === 'number' ? `<div class="info-row">
                <span class="info-label">Stability</span>
                <span class="info-value" style="color:${KingdomStability.color(kingdom.stability)};">🏛️ ${Math.round(kingdom.stability)}/100 · ${KingdomStability.label(kingdom.stability)}</span>
            </div>` : ''}
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
    },
});
