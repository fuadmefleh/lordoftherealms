// ActionMenu — build methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { DevotionPanel } from './devotion.js';
import { Hospitality } from '../../systems/hospitality.js';
import { SettlementSize } from '../../core/settlementSize.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerReligion, InnerMap, PlayerInventory } from './_imports.js';
import { Wilds } from '../../player/wilds.js';
import { InnerMapLots } from '../innerMapLots.js';
import { Lots } from '../../systems/lots.js';
import { showWildsEncounter } from '../wildsEncounter.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, lede, chips, purse, sectionHead, kv, card, actRow, rowList, price } from './uiKit.js';
import { ParentsGuard } from '../parentsGuard.js';
import { worksCard } from './worksUI.js';

/** The lot chosen on this town's map to build on (ui/innerMapLots.js lot_build), or null. */
function _pendingLotFor(tile) {
    const here = InnerMap.active && InnerMap.currentWorldTile && tile
        && InnerMap.currentWorldTile.q === tile.q && InnerMap.currentWorldTile.r === tile.r;
    return here ? InnerMap._pendingLot || null : null;
}

Object.assign(ActionMenu, {
    /**
     * Preach at settlement
     */
    preach(game, tile) {
        const result = PlayerReligion.preach(game.player, tile.settlement, tile, game.world);
        if (result.success) {
            const tired = result.saturation >= 0.3 ? ' The crowd has heard you before and thins.' : '';
            const weak = result.weakBonus >= 0.15 ? ' Faith runs thin here: they listen hungrily.' : '';
            game.ui.showNotification('Preaching Success!', `+${result.followersGained} followers, +${result.karmaGained} karma${result.alms ? `, +${result.alms}g alms` : ''}.${weak}${tired}`, 'success');
            if (result.clergy) game.ui.showNotification(result.clergy.bannedUntil ? '⛔ Preaching Banned' : '⛪ The Clergy Object', result.clergy.message, 'error');
            game.ui.updateStats(game.player, game.world);
        } else {
            game.ui.showNotification('Cannot Preach', result.reason, 'error');
        }
    },

    /**
     * Preach against the heresy troubling this settlement's kingdom
     */
    denounceHeresy(game, tile) {
        const result = PlayerReligion.denounceHeresy(game.player, tile.settlement, game.world);
        if (result.success) {
            game.ui.showNotification(result.suppressed ? '🔥 Heresy Suppressed!' : '🔥 Heresy Denounced', result.message, 'success');
            game.ui.updateStats(game.player, game.world);
        } else {
            game.ui.showNotification('Cannot Denounce', result.reason, 'error');
        }
    },

    /** Build-menu category tabs, in display order. */
    BUILD_CATEGORIES: [
        { id: 'all', label: 'All', icon: '📋' },
        { id: 'farming', label: 'Farming', icon: '🌾' },
        { id: 'resources', label: 'Resources', icon: '⛏️' },
        { id: 'food', label: 'Food & Drink', icon: '🍞' },
        { id: 'crafts', label: 'Crafts', icon: '🔨' },
        { id: 'commerce', label: 'Commerce', icon: '💰' },
        { id: 'hospitality', label: 'Hospitality', icon: '🛏️' },
        { id: 'tech', label: 'Tech', icon: '🔬' },
    ],

    /**
     * Can a tech-unlocked building go on this tile? Same shape as
     * PlayerEconomy.canBuildProperty: { canBuild, reason }.
     */
    _canBuildTechBuilding(game, tile, prop) {
        if (!(prop.requiredTech && Technology.isImplemented(game.player, prop.requiredTech))) {
            return { canBuild: false, reason: 'Not researched' };
        }
        if (tile.playerProperties && tile.playerProperties.find(p => p.type === prop.id)) {
            return { canBuild: false, reason: 'Already built here' };
        }
        if (prop.requiredTerrain && !prop.requiredTerrain.includes(tile.terrain.id)) {
            return { canBuild: false, reason: `Requires ${prop.requiredTerrain.join(' or ')}` };
        }
        if (prop.requiredResource && (!tile.resource || !prop.requiredResource.includes(tile.resource.id))) {
            return { canBuild: false, reason: `Requires ${prop.requiredResource.join(' or ')}` };
        }
        if (prop.requiredSettlement && !tile.settlement) {
            return { canBuild: false, reason: 'Requires settlement' };
        }
        const size = SettlementSize.meets(prop, tile.settlement);
        if (!size.ok) return { canBuild: false, reason: size.reason };
        const cost = PlayerEconomy.getBuildCost(game.player, prop, tile, game.world);
        if (game.player.gold < cost) return { canBuild: false, reason: `Need ${cost} gold (have ${Math.floor(game.player.gold)})` };
        return { canBuild: true };
    },

    /** "stone, timber" — the resources near a hex that supply a bonus kind. */
    _resourceSourceNames(world, q, r, kind) {
        const ids = [];
        for (const s of Economy.resourceBonuses(world, q, r).sources) {
            const b = Economy.RESOURCE_BONUSES[s.id] || {};
            if (b[kind] > 1 && !ids.includes(s.id)) ids.push(s.id);
        }
        const res = Terrain.RESOURCES || {};
        return ids.map(id => (res[id.toUpperCase()] ? res[id.toUpperCase()].name : id).toLowerCase()).join(', ') || 'resources';
    },

    /** One-line note on the local construction discount, or ''. */
    _constructionHint(world, tile) {
        const mods = Economy.constructionModifiers(world, tile.q, tile.r);
        if (!(mods.bonus > 0)) return '';
        const costPct = Math.round((1 - mods.cost) * 100);
        const timePct = Math.round((1 - mods.time) * 100);
        return `🧱 ${ActionMenu._resourceSourceNames(world, tile.q, tile.r, 'construction')} at hand: −${costPct}% build cost, −${timePct}% build time`;
    },

    /** One-line "what it makes" text for a build-menu row. */
    _buildOutputText(prop, tile) {
        const goodName = (id) => {
            const g = PlayerEconomy.GOODS[String(id).toUpperCase()];
            return g ? `${g.icon || ''} ${g.name}` : id;
        };
        if (prop.allowedRecipes || prop.recipeBased) {
            if (!prop.allowedRecipes) return 'Any recipe';
            return prop.allowedRecipes.map(r => {
                const recipe = PlayerEconomy.RECIPES[r];
                return recipe ? `${goodName(recipe.input)} → ${goodName(recipe.output)}` : r;
            }).join(' · ');
        }
        if (prop.id === 'mine') return tile.resource ? goodName(tile.resource.id) : 'Tile resource';
        if (prop.id === 'tavern') return '💰 Gold from patrons';
        if (Hospitality.isKind(prop.id)) return '🛏️ Guests from the travellers';
        if (prop.id === 'trading_post') return '🐪 Attracts merchants';
        if (!prop.produces) return 'Special';
        return `${goodName(prop.produces)}${prop.productionRate ? ` · ${prop.productionRate}/day` : ''}`;
    },

    /**
     * Show build property menu: search, category tabs, and a compact list
     * with what this tile can take first.
     */
    showBuildPropertyMenu(game, tile) {
        const player = game.player;
        const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

        const rows = Object.entries(PlayerEconomy.PROPERTY_TYPES).map(([key, prop]) => ({
            key, prop, tech: false,
            category: prop.category || (PlayerEconomy.isRecipeBuilding(prop.id) ? 'crafts' : 'resources'),
            check: PlayerEconomy.canBuildProperty(player, key, tile, game.world),
        }));
        for (const [key, prop] of Object.entries(Technology.TECH_BUILDINGS || {})) {
            if (!(prop.requiredTech && Technology.isImplemented(player, prop.requiredTech))) continue;
            rows.push({ key, prop, tech: true, category: 'tech', check: ActionMenu._canBuildTechBuilding(game, tile, prop) });
        }
        // Buildable first, then cheapest
        rows.sort((a, b) => (b.check.canBuild - a.check.canBuild)
            || (PlayerEconomy.getBuildCost(player, a.prop, tile, game.world) - PlayerEconomy.getBuildCost(player, b.prop, tile, game.world)));
        const constructionHint = ActionMenu._constructionHint(game.world, tile);

        const state = window._buildMenuState || (window._buildMenuState = { cat: 'all', onlyBuildable: true, query: '' });
        const buildableCount = rows.filter(r => r.check.canBuild).length;

        let html = '<div class="bp-menu">';
        // Search, tabs and filter stay pinned while the list scrolls with the panel
        html += '<div style="position: sticky; top: 0; z-index: 2; background: rgb(17, 18, 24); padding-bottom: 2px;">';
        html += chips([
            purse(player.gold),
            { icon: '🏗️', label: 'Can build here', value: `${buildableCount} of ${rows.length}`, cls: buildableCount ? 'gold' : 'dim' },
            tile.hasRiver ? ['🌊', 'River tile', '(mills +50%)'] : null,
        ]);
        if (constructionHint) html += `<div style="font-size: 11px; color: #8fd18a; margin: -4px 0 8px;" title="Stone and timber within 2 hexes">${constructionHint}</div>`;
        html += `<input id="bpSearch" type="text" placeholder="Search by name or product… (e.g. flour, wool, forest)" value="${esc(state.query)}" oninput="window._bpFilter()" style="width: 100%; box-sizing: border-box; padding: 7px 10px; margin-bottom: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(245,197,66,0.22); border-radius: 6px; color: #ece2c8; font-size: 13px;">`;
        html += '<div class="panel-subtabs">';
        for (const c of ActionMenu.BUILD_CATEGORIES) {
            const n = c.id === 'all' ? rows.length : rows.filter(r => r.category === c.id).length;
            if (n === 0) continue;
            html += `<button class="panel-subtab bp-tab${state.cat === c.id ? ' active' : ''}" data-cat="${c.id}" onclick="window._bpTab('${c.id}')">${c.icon} ${c.label} <span style="opacity: 0.6;">${n}</span></button>`;
        }
        html += '</div>';
        html += `<label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #9d937c; margin-bottom: 6px; cursor: pointer;"><input id="bpOnlyBuildable" type="checkbox" ${state.onlyBuildable ? 'checked' : ''} onchange="window._bpFilter()"> Only show what I can build here</label>`;
        html += '</div>';

        html += '<div id="bpList" class="pk-rows">';
        for (const r of rows) {
            const { prop, check } = r;
            const cost = PlayerEconomy.getBuildCost(player, prop, tile, game.world);
            const buildDays = PlayerEconomy.getConstructionDays(prop, tile, game.world);
            const output = ActionMenu._buildOutputText(prop, tile);
            const haystack = `${prop.name} ${output} ${prop.description || ''} ${(prop.requiredTerrain || []).join(' ')}`.toLowerCase();
            const action = r.tech ? `window.buildTechBuilding('${r.key}')` : `window.buildProperty('${r.key}')`;
            let riverHint = prop.riverBonus && tile.hasRiver ? ' <span style="color: #6ec6ff; font-weight: 400; font-size: 11px;">🌊 +50% here</span>' : '';
            // Coal-fired forges, herds for ranches, oil for chandlers
            const resBonus = Economy.propertyResourceBonus(game.world, tile, prop.id);
            if (resBonus.bonus > 0) riverHint += ` <span style="color: #8fd18a; font-weight: 400; font-size: 11px;" title="${esc(resBonus.label)}">${(Terrain.RESOURCES[resBonus.resource.toUpperCase()] || {}).icon || ''} +${Math.round(resBonus.bonus * 100)}% here</span>`;
            // One action-menu row a property; the filter reads its data-* (window._bpFilter)
            html += actRow({
                icon: prop.icon,
                name: `${prop.name}${r.tech ? ' <span style="font-size: 9.5px; letter-spacing: 1px; color: #ce93d8;">TECH</span>' : ''}${riverHint}`,
                desc: output, note: check.canBuild ? '' : output,
                off: !check.canBuild, why: esc(check.reason || ''),
                attrs: `onclick="${action}"`,
                title: prop.description || '',
                side: `${price(cost, player.gold >= cost)}<br><small style="color:#9d937c;">🏗️ ${buildDays}d · 🔧 ${prop.upkeep || 0}g/d</small>`,
            }).replace('class="pk-row', `data-cat="${r.category}" data-ok="${check.canBuild ? 1 : 0}" data-text="${esc(haystack)}" class="bp-row pk-row`);
        }
        html += '<div id="bpEmpty" style="display: none; padding: 16px; text-align: center; font-size: 12px; color: #9d937c;"></div>';
        html += '</div></div>';
        game.ui.showCustomPanel('Build Property', html);

        // Filtering happens in place (no re-render) so typing stays smooth
        window._bpFilter = () => {
            const search = document.getElementById('bpSearch');
            const only = document.getElementById('bpOnlyBuildable');
            state.query = search ? search.value : '';
            state.onlyBuildable = !!(only && only.checked);
            const q = state.query.trim().toLowerCase();
            let shown = 0;
            let hiddenUnbuildable = 0;
            for (const row of document.querySelectorAll('#bpList .bp-row')) {
                const catOk = state.cat === 'all' || row.dataset.cat === state.cat;
                const textOk = !q || row.dataset.text.includes(q);
                const okHere = row.dataset.ok === '1';
                // A search shows every match (with why it can't be built here)
                const hideUnbuildable = state.onlyBuildable && !q;
                const visible = catOk && textOk && (okHere || !hideUnbuildable);
                if (catOk && textOk && !okHere && hideUnbuildable) hiddenUnbuildable++;
                row.style.display = visible ? '' : 'none';
                if (visible) shown++;
            }
            for (const tab of document.querySelectorAll('.bp-menu .bp-tab')) {
                tab.classList.toggle('active', tab.dataset.cat === state.cat);
            }
            const empty = document.getElementById('bpEmpty');
            if (empty) {
                empty.style.display = shown === 0 ? 'block' : 'none';
                empty.textContent = hiddenUnbuildable > 0
                    ? `Nothing here can be built on this tile — untick "Only show what I can build here" to see ${hiddenUnbuildable} more.`
                    : 'No properties match.';
            }
        };
        window._bpTab = (cat) => {
            state.cat = cat;
            window._bpFilter();
        };
        window._bpFilter();

        window.currentBuildTile = tile;
        window.buildProperty = (propType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerEconomy.buildProperty(game.player, propType, tile, game.world, { lotId: _pendingLotFor(tile) });
            InnerMap._pendingLot = null;
            if (result.success) {
                // In town it stands on its lot, a building of its kind (ui/innerMapLots.js, world/innerMap/lots.js)
                if (result.lotId) InnerMapLots.afterBuild(game, tile, result.property);
                const lotNote = result.lotId && result.lotPrice > 0 ? ` A building lot was bought for it (${result.lotPrice}g).` : '';
                if (result.underConstruction) {
                    game.ui.showNotification('🏗️ Construction Started!', `${result.property.name} is under construction — ${result.constructionDays} days to completion.${lotNote}`, 'info');
                } else {
                    game.ui.showNotification('Property Built!', `${result.property.name} is now operational`, 'success');
                }
                game.ui.updateStats(game.player, game.world);
                ActionMenu.close();
                // (the Build Property panel too: it would stand open on a stale purse)
                if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Build', result.reason, 'error');
            }
        };

        window.buildTechBuilding = (buildingKey) => {
            const building = Technology.TECH_BUILDINGS[buildingKey];
            if (!building) return;
            const techCheck = ActionMenu._canBuildTechBuilding(game, tile, building);
            if (!techCheck.canBuild) {
                game.ui.showNotification('Cannot Build', techCheck.reason, 'error');
                return;
            }
            if (!ActionMenu.commitPendingAP(game)) return;
            const buildCost = PlayerEconomy.getBuildCost(game.player, building, tile, game.world);
            const techBuildDays = PlayerEconomy.getConstructionDays(building, tile, game.world);
            // In town it stands on a building lot (systems/lots.js)
            const lot = tile.settlement ? Lots.lotForProperty(game.player, tile.settlement, { lotId: _pendingLotFor(tile) }) : null;
            InnerMap._pendingLot = null;
            if (lot && !lot.ok) { game.ui.showNotification('Cannot Build', lot.reason, 'error'); return; }
            if (lot && (game.player.gold || 0) < buildCost + (lot.price || 0)) {
                game.ui.showNotification('Cannot Build', `Needs ${buildCost}g to build and ${lot.price}g for a building lot`, 'error');
                return;
            }

            game.player.gold -= buildCost;

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
                underConstruction: techBuildDays > 0,
                constructionDaysLeft: techBuildDays,
                constructionDaysTotal: techBuildDays,
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

            // Its lot in town, then its place on the town map
            if (lot) Lots.claimLotForProperty(game.player, game.world, tile.settlement, newProperty, { lotId: lot.lotId });
            if (typeof InnerMap !== 'undefined') {
                InnerMap.placePropertyOnInnerMap(tile, newProperty, tile.q, tile.r);
            }

            game.ui.showNotification('🏗️ Construction Started!', `${building.name} is under construction — ${techBuildDays} days to completion.`, 'info');
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
        html += lede('Improve the land with roads, bridges, irrigation and jetties.');
        html += chips([purse(game.player.gold)]);
        const infraHint = ActionMenu._constructionHint(game.world, tile);
        if (infraHint) html += `<div style="font-size: 11px; color: #8fd18a; margin: -4px 0 8px;" title="Stone and timber within 2 hexes">${infraHint}</div>`;

        if (tile.infrastructure) {
            const building = !!tile.infrastructure.underConstruction;
            html += rowList([{ icon: tile.infrastructure.icon, name: `Current: ${tile.infrastructure.name}`, desc: building ? '🔨 Under construction' : 'Standing on this tile', side: building ? '🔨' : '✓', tone: building ? 'warn' : 'good' }]);
            // progress, ETA and hired crews (ui/actionMenu/worksUI.js, systems/construction.js)
            if (building) html += worksCard(game, tile.infrastructure, tile.q, tile.r, () => ActionMenu.showBuildInfrastructureMenu(game, tile));
        }

        if (available.length === 0) {
            html += rowList([{ icon: '🚧', name: 'Nothing more to build here', desc: 'Research more technologies, or try another tile.', off: true }]);
        }

        const rows = [];
        for (const infra of available) {
            const isUpgrade = infra.upgradesFrom && tile.infrastructure && tile.infrastructure.id === infra.upgradesFrom;
            const buildDays = infra.actualDays != null ? infra.actualDays : (infra.buildTime || 0);
            const buildTimeLabel = buildDays > 0 ? `<span style="color: #f0b35a;" title="Work-days: winter, rain and snow slow the work; hired crews speed it">⏱ ${buildDays} work-day${buildDays > 1 ? 's' : ''}</span>` : '<span style="color: #8fd18a;">⚡ Instant</span>';
            rows.push({
                icon: infra.icon, name: `${infra.name}${isUpgrade ? ' <span style="color: #ffcf6a; font-size: 10px; letter-spacing: 1px;">⬆ UPGRADE</span>' : ''}`,
                desc: infra.description,
                attrs: `onclick="window.buildInfra('${infra.id.toUpperCase()}')"`,
                side: `${price(infra.actualCost, game.player.gold >= infra.actualCost)}<br><small>${buildTimeLabel}</small>`,
            });
        }
        html += rowList(rows, 'Build Infrastructure');

        // Show all locked types for awareness
        const locked = [];
        for (const [key, infra] of Object.entries(Infrastructure.TYPES)) {
            if (available.find(a => a.id === infra.id)) continue;
            const check = Infrastructure.canBuild(game.player, key, tile, game.world);
            if (!check.can) locked.push({ icon: infra.icon, name: `${infra.name} 🔒`, off: true, why: check.reason, side: `${infra.cost} gold` });
        }
        html += rowList(locked, 'Not here');

        html += '</div>';
        game.ui.showCustomPanel('Build Infrastructure', html);

        window.buildInfra = (infraKey) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = Infrastructure.build(game.player, infraKey, tile, game.world);
            if (result.success) {
                if (result.buildDays > 0) {
                    // Track for construction tick
                    if (!game.player.infrastructureUnderConstruction) game.player.infrastructureUnderConstruction = [];
                    game.player.infrastructureUnderConstruction.push({ q: tile.q, r: tile.r });
                    game.ui.showNotification('🏗️ Construction Started!', `${result.infrastructure.name} will be ready in ${result.buildDays} day${result.buildDays > 1 ? 's' : ''}. Cost: ${result.cost} gold`, 'info');
                } else {
                    game.ui.showNotification('Infrastructure Built!', `${result.infrastructure.name} constructed for ${result.cost} gold`, 'success');
                }
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

        const result = Infrastructure.demolish(game.player, tile, game.world);
        if (result.success) {
            game.ui.showNotification('Demolished', `${result.name} removed. Refund: ${result.refund} gold`, 'default');
            game.ui.updateStats(game.player, game.world);
            game.renderer.reachableHexes = game.player.getReachableHexes(game.world);
        } else {
            game.ui.showNotification('Cannot Demolish', result.reason, 'error');
        }
    },

    /**
     * Found Religion modal — name your faith and choose tenets
     */
    _showFoundReligionModal(game, tile) {
        const player = game.player;
        const karma = player.karma || 0;

        // Tenets and what they do come from data/religion.json → playerTenets
        const allTenets = PlayerReligion.getTenetOptions();

        let selectedTenets = ['Peace', 'Charity', 'Wisdom']; // defaults
        let religionName = '';

        const render = () => {
            let html = '<div style="max-width: 500px; text-align: left;">';
            html += lede('⛪ <b>Found a Religion.</b> Establish a new faith and spread it across the land.');
            html += chips([['☯️', 'Requires', '10 karma'], { icon: '', label: 'You have', value: karma, cls: karma >= 10 ? 'gold' : '' }]);

            if (karma < 10) {
                html += card(`<div style="text-align: center; padding: 10px 0;">
                    <div style="font-size: 32px; margin-bottom: 6px;">🙏</div>
                    <div style="font-size: 13px; color: #e0846a;">You need at least 10 karma to found a religion.</div>
                    <div style="font-size: 12px; color: #9d937c; margin-top: 4px;">Current karma: ${karma}</div>
                    <button data-am-act="closePanel" style="${BTN_PLAIN} margin-top: 12px;">Close</button>
                </div>`);
                html += '</div>';
                return html;
            }

            // Name input
            html += sectionHead('Religion Name');
            html += `<input id="frNameInput" type="text" maxlength="30" placeholder="e.g. The Order of Light"
                    value="${religionName.replace(/"/g, '&quot;')}"
                    oninput="window._frUpdateName(this.value)"
                    style="width: 100%; padding: 9px 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(245,197,66,0.22);
                           border-radius: 6px; color: #ece2c8; font-size: 14px; font-family: var(--font-display);
                           outline: none; box-sizing: border-box; transition: border-color 0.2s; margin-bottom: 4px;"
                    onfocus="this.style.borderColor='rgba(245,197,66,0.6)'" onblur="this.style.borderColor='rgba(245,197,66,0.22)'">`;

            // Tenets selection
            html += rowList(allTenets.map(tenet => {
                const isSelected = selectedTenets.includes(tenet.id);
                return {
                    icon: tenet.icon, name: `${isSelected ? '✓ ' : ''}${tenet.id}`, desc: tenet.desc, note: tenet.summary || '',
                    attrs: `onclick="window._frToggleTenet('${tenet.id}')"`,
                    title: `${tenet.desc}${tenet.summary ? ` — ${tenet.summary}` : ''}`,
                    side: isSelected ? 'chosen' : '', tone: isSelected ? 'gold' : '',
                };
            }), `Choose 3 Tenets <span style="color: #9d937c; letter-spacing: 0; text-transform: none;">(${selectedTenets.length}/3 selected)</span>`);

            // Preview
            if (religionName.trim()) {
                const tenetList = selectedTenets.length > 0 ? selectedTenets.join(', ') : 'None';
                html += card(`<div style="font-size: 11px; color: #9d937c;">Tenets: ${tenetList}</div>`, { icon: '⛪', title: religionName.trim(), side: 'Preview' });
            }

            // Action buttons
            const canFound = religionName.trim().length > 0 && selectedTenets.length === 3;
            html += `<div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;">
                <button data-am-act="closePanel" style="${BTN_PLAIN}">Cancel</button>
                <button onclick="window._frConfirm()" ${canFound ? '' : 'disabled'} style="${canFound ? BTN_GOLD : BTN_OFF}">⛪ Found Religion</button>
            </div>`;

            html += '</div>';
            return html;
        };

        game.ui.showCustomPanel('⛪ Found Religion', render());

        // Focus the name input after render
        setTimeout(() => {
            const inp = document.getElementById('frNameInput');
            if (inp) inp.focus();
        }, 100);

        window._frUpdateName = (val) => {
            religionName = val;
            game.ui.showCustomPanel('⛪ Found Religion', render());
            // Restore cursor position in input
            setTimeout(() => {
                const inp = document.getElementById('frNameInput');
                if (inp) { inp.focus(); inp.setSelectionRange(val.length, val.length); }
            }, 0);
        };

        window._frToggleTenet = (tenetId) => {
            const idx = selectedTenets.indexOf(tenetId);
            if (idx >= 0) {
                selectedTenets.splice(idx, 1);
            } else if (selectedTenets.length < 3) {
                selectedTenets.push(tenetId);
            }
            game.ui.showCustomPanel('⛪ Found Religion', render());
        };

        window._frConfirm = () => {
            const name = religionName.trim();
            if (!name || selectedTenets.length !== 3) return;
            if (!ActionMenu.commitPendingAP(game)) return;

            const result = PlayerReligion.foundReligion(game.player, name, selectedTenets, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();
                game.ui.showNotification('Religion Founded!', `${name} has been established with tenets: ${selectedTenets.join(', ')}`, 'success');
                game.ui.updateStats(game.player, game.world);
                // Proceed to temple building menu
                ActionMenu.showBuildTempleMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Found Religion', result.reason, 'error');
            }
        };
    },

    /**
     * Show build temple menu
     */
    showBuildTempleMenu(game, tile) {
        if (!game.player.religion) {
            ActionMenu._showFoundReligionModal(game, tile);
            return;
        }

        let html = '<div>';
        html += lede(`Raise a house of <b>${game.player.religion.name || 'your faith'}</b>: it wins followers in the land around it.`);
        html += chips([purse(game.player.gold)]);
        const rows = [];
        for (const [key, building] of Object.entries(PlayerReligion.BUILDING_TYPES)) {
            const extras = [
                building.karmaBonus ? `+${building.karmaBonus} karma/day` : '',
                building.incomeBonus ? `~${Math.floor(building.incomeBonus * 0.1)}–${Math.floor(building.incomeBonus * 0.3)} pilgrim gold/day` : '',
                building.renownPerDay ? `+${building.renownPerDay} renown/day` : '',
                building.scholarshipBonus ? `+${building.scholarshipBonus * 2}% research speed` : '',
            ].filter(Boolean).join(' | ');
            rows.push({
                icon: building.icon, name: building.name, desc: building.description,
                note: `Faith: +${building.faithGain} followers/day, ×${PlayerReligion.faithMultiplier(building).toFixed(2)} conversion | Radius: ${building.influenceRadius}${extras ? `<br>${extras}` : ''}`,
                attrs: `onclick="window.buildTemple('${key}')"`,
                side: `${price(building.cost, game.player.gold >= building.cost)}<br><small style="color:#9d937c;">🏗️ ${building.constructionDays || 0} days</small>`,
                title: `Build time: ${building.constructionDays || 0} days`,
            });
        }
        html += rowList(rows, 'Build Religious Building');
        html += '</div>';
        game.ui.showCustomPanel('Build Temple', html);

        window.buildTemple = (buildingType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerReligion.buildReligiousBuilding(game.player, buildingType, tile, game.world);
            if (result.success) {
                if (result.underConstruction) {
                    game.ui.showNotification('🏗️ Construction Started!', `${result.building.name} is under construction — ${result.constructionDays} days to completion.`, 'info');
                } else {
                    game.ui.showNotification('Building Constructed!', `${result.building.name} will spread your faith`, 'success');
                }
                game.ui.updateStats(game.player, game.world);
                ActionMenu.close();
                // (the Build Property panel too: it would stand open on a stale purse)
                if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
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
        html += lede('Call on heaven: each miracle spends your karma.');
        html += chips([{ icon: '☯️', label: 'Your karma', value: game.player.karma, cls: 'gold' }]);
        const rows = [];
        for (const [key, miracle] of Object.entries(PlayerReligion.MIRACLES)) {
            // Targeted miracles say what they would strike, or why they can't
            const check = PlayerReligion.checkMiracleTarget(game.player, miracle.id, game.world);
            const cost = PlayerReligion.miracleCost(game.player, miracle); // Mysticism tenet
            const canPerform = game.player.karma >= cost && check.ok;
            let targetLine = '';
            if (!check.ok) {
                // the reason shows in place of the description
            } else if (miracle.id === 'smite') {
                targetLine = `Target: ${check.target.icon || ''} ${check.target.name} (strength ${check.target.strength})`;
            } else if (miracle.id === 'plague') {
                targetLine = `Target: ${check.target.settlement.name} (pop. ${check.target.settlement.population})`;
            } else if (miracle.id === 'resurrection') {
                targetLine = `Returns: ${check.target.icon || ''} ${check.target.name} (${game.player.fallenUnits.length} fallen remembered)`;
            } else if (miracle.id === 'sanctuary' && game.player.sanctuary) {
                targetLine = `Current sanctuary: ${game.player.sanctuary.days} days left (recasting moves it here)`;
            }
            rows.push({
                icon: miracle.icon, name: miracle.name, desc: miracle.description,
                note: `Effect: ${miracle.effect}${targetLine ? `<br><span style="color:#ffcf6a;">${targetLine}</span>` : ''}`,
                attrs: `onclick="window.performMiracle('${key}')"`, off: !canPerform,
                why: !check.ok ? check.reason : `Not enough karma · ${miracle.description}`,
                side: `<span style="color:${game.player.karma >= cost ? '#ffcf6a' : '#c0533a'}; font-weight:700;">${cost} karma</span>${cost !== miracle.karmaCost ? ` <s style="opacity:0.6;">${miracle.karmaCost}</s>` : ''}`,
            });
        }
        html += rowList(rows, 'Perform Miracle');
        html += '</div>';
        game.ui.showCustomPanel('Miracles', html);

        window.performMiracle = (miracleType) => {
            // Check the target first so a miracle with nothing to strike costs no AP
            const miracle = PlayerReligion.MIRACLES[miracleType];
            const check = miracle ? PlayerReligion.checkMiracleTarget(game.player, miracle.id, game.world) : { ok: true };
            if (!check.ok) {
                game.ui.showNotification('Cannot Perform', check.reason, 'error');
                return;
            }
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerReligion.performMiracle(game.player, miracleType, game.world);
            if (result.success) {
                game.ui.showNotification('Miracle!', result.effect, 'success');
                // Revelation / Smite change what the map shows
                game.minimap?.invalidate();
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

        // Shrines, oases, monuments and wrecks hold an encounter with choices
        // (player/wilds.js, data/innerMap.json → poiEncounters)
        const encId = Wilds.poiEncounterId(game.world, tile);
        if (encId) {
            const player = game.player;
            showWildsEncounter(game, {
                title: poi.name,
                ctx: { id: encId, wq: tile.q, wr: tile.r, terrain: tile.terrain && tile.terrain.id, poi: { type: poi.type, name: poi.name } },
                canLeave: false,
                extraLines: () => {
                    if (poi.type === 'ruins') Quests.track(player, 'ruins_explored');
                    return Wilds.finishPoi(player, game.world, tile).lines;
                },
                doneLabel: 'Make camp (end the day)',
                onClose: (res) => {
                    game.ui.updateStats(player, game.world);
                    if (res) game.endDay();
                },
            });
            return;
        }

        poi.explored = true;
        const player = game.player;
        if (!player.inventory) player.inventory = {};
        if (poi.type === 'ruins') Quests.track(player, 'ruins_explored');

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
                case 'item': {
                    const added = PlayerInventory.addItem(player, reward.id, reward.amount);
                    if (added.success) {
                        rewardLines.push(`<div style="color: #3498db;">${reward.icon} +${reward.amount} ${reward.name}</div>`);
                    } else {
                        rewardLines.push(`<div style="color: #e67e22;">${reward.icon} ${reward.amount} ${reward.name} left behind — your packs are full</div>`);
                    }
                    break;
                }
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
                    // Extra travel today (stamina itself refills each morning)
                    player.movementRemaining = (player.movementRemaining || 0) + reward.amount;
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

        // Legendary artifacts & fragments
        let artifactDiscovery = null;
        if (typeof LegendaryArtifacts !== 'undefined') {
            artifactDiscovery = LegendaryArtifacts.discoverFromPOI(player, game.world, tile, poi);
            if (artifactDiscovery && artifactDiscovery.found) {
                if (artifactDiscovery.type === 'artifact') {
                    rewardLines.push(`<div style="color: #f39c12;">${artifactDiscovery.artifact.icon} ${artifactDiscovery.artifact.name} recovered intact!</div>`);
                } else if (artifactDiscovery.type === 'fragment') {
                    rewardLines.push(`<div style="color: #c0392b;">🧩 ${artifactDiscovery.artifact.name} Fragment (${artifactDiscovery.fragmentsOwned}/${artifactDiscovery.fragmentsRequired})</div>`);
                }
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

        if (artifactDiscovery && artifactDiscovery.found && artifactDiscovery.lore) {
            html += `<div style="padding: 10px; background: rgba(192,57,43,0.12); border-left: 3px solid #c0392b; border-radius: 0 4px 4px 0; font-size: 11px; color: var(--text-secondary); font-style: italic; margin-bottom: 12px;">`;
            html += `🧩 ${artifactDiscovery.lore}`;
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

        html += `<button data-am-act="closePanel" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-family: var(--font-body); color: #1a1a2e;">Continue</button>`;
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
        const woodAdd = PlayerInventory.addItem(game.player, 'wood', woodAmount);

        // Change terrain to grassland
        tile.terrain = Terrain.TYPES.GRASSLAND;
        tile.terraformed = true; // saved (SaveLoad.serializeTiles)

        // Remove any forest-specific resource
        if (tile.resource && ['wood', 'timber'].includes(tile.resource.id)) {
            tile.resource = null;
        }

        if (woodAdd.success) {
            game.ui.showNotification('Trees Cleared', `+${woodAmount} 🌲 Wood — the land is now open grassland.`, 'success');
        } else {
            game.ui.showNotification('Trees Cleared', `The land is now open grassland, but the wood was left behind. ${woodAdd.reason}`, 'warning');
        }
        game.ui.updateStats(game.player, game.world);

        // Advance the day (it takes effort)
        game.endDay();
    },

    /**
     * Show terraform menu — flatten hills to grassland
     */
    showTerraformMenu(game, tile) {
        const terrainName = tile.terrain.name;
        const cost = 300;
        const apCost = 8;
        const canAfford = game.player.gold >= cost;
        const hasAP = (game.player.actionPoints || 0) >= apCost;
        const canTerraform = canAfford && hasAP;

        // Check for resources that would be lost
        const hasResource = tile.resource != null;
        const resourceWarning = hasResource ? `⚠️ The ${tile.resource.name || tile.resource.id} resource on this tile will be removed.` : '';

        // Yield stone from flattening hills
        const stoneYield = 8 + Math.floor(Math.random() * 5);

        let html = '<div style="max-width: 420px;">';
        html += lede(`⛰️ → 🌿 Flatten <strong>${terrainName}</strong> into <strong style="color: #8fd18a;">Grassland</strong>. Your workers will level the terrain, removing rocky outcrops and evening the land for farming or building.`);
        html += chips([
            { icon: '💰', label: 'Cost', value: `<span style="color:${canAfford ? '#ffcf6a' : '#e0846a'};">${cost}g</span>` },
            { icon: '⏳', label: 'AP cost', value: `<span style="color:${hasAP ? '#9fc4f0' : '#e0846a'};">${apCost} AP</span>` },
            ['📦', 'Stone', `~${stoneYield}`],
        ]);
        html += kv('You have', `${Math.floor(game.player.gold)}g · ${game.player.actionPoints || 0} AP`);
        html += `<div style="font-size: 12px; color: #8fd18a; margin: 6px 0;">📦 You'll recover ~${stoneYield} stone from the excavation</div>`;
        if (hasResource) html += `<div style="font-size: 12px; color: #e0846a; margin: 6px 0;">${resourceWarning}</div>`;
        html += '<div style="font-size: 11px; color: #9d937c; margin: 6px 0 10px;">Mountains and highlands cannot be terraformed.</div>';
        html += rowList([{
            icon: '⛏️', name: 'Terraform — Flatten Hills', desc: `${cost}g and ${apCost} AP · ends the day`,
            attrs: `id="terraformBtn" onclick="window.doTerraform(${stoneYield})"`,
            off: !canTerraform, why: !canAfford ? 'Not Enough Gold' : 'Not Enough AP',
            side: price(cost, canAfford), tone: 'gold',
        }]);
        html += '</div>';
        game.ui.showCustomPanel('⛏️ Terraform Land', html);

        window.doTerraform = (stoneAmount) => {
            // Terraform manages its own AP internally — just clear the deferred pending
            ActionMenu._pendingAP = null;
            if (game.player.gold < cost) {
                game.ui.showNotification('Cannot Terraform', `Need ${cost} gold`, 'error');
                return;
            }
            if ((game.player.actionPoints || 0) < apCost) {
                game.ui.showNotification('Cannot Terraform', `Need ${apCost} AP`, 'error');
                return;
            }

            // Deduct costs
            game.player.gold -= cost;
            game.player.actionPoints -= apCost;

            // Add stone to inventory
            const stoneAdd = PlayerInventory.addItem(game.player, 'stone', stoneAmount);

            // Remove resource if present
            if (tile.resource) {
                tile.resource = null;
            }

            // Change terrain to grassland
            tile.terrain = Terrain.TYPES.GRASSLAND;
            tile.terraformed = true; // saved (SaveLoad.serializeTiles)

            // Update elevation to match (grassland level)
            tile.elevation = Math.min(tile.elevation, 0.50);

            if (stoneAdd.success) {
                game.ui.showNotification('⛏️ Land Terraformed!', `The hills have been flattened to grassland. +${stoneAmount} stone recovered.`, 'success');
            } else {
                game.ui.showNotification('⛏️ Land Terraformed!', `The hills have been flattened to grassland, but the stone was left behind. ${stoneAdd.reason}`, 'warning');
            }
            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
            game.endDay();
        };
    },

    /**
     * Show tavern menu — full options in a city tavern
     */
    showTavernMenu(game, tile) {
        // Your parents' rules at this door too (ui/parentsGuard.js)
        if (!ParentsGuard.ok(game, 'tavern', tile)) return;
        // One visit per tavern per day counts toward tavern quests
        const visitKey = `${game.world.day}:${tile.q},${tile.r}`;
        if (game.player._lastTavernVisit !== visitKey) {
            game.player._lastTavernVisit = visitKey;
            Quests.track(game.player, 'taverns_visited');
        }
        // Distinct taverns, for the Tavern Crawler achievement
        const tavernKey = `${tile.q},${tile.r}`;
        if (!game.player.visitedTaverns) game.player.visitedTaverns = [];
        if (!game.player.visitedTaverns.includes(tavernKey)) game.player.visitedTaverns.push(tavernKey);
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
            if (!ActionMenu.commitPendingAP(game)) return;
            const rumors = Tavern.handleAction(actionId, game.player, tile, game.world);
            // Check if any rumor signals to open the map trade panel
            const mapTradeRumor = rumors.find(r => r.openMapTrade);
            if (mapTradeRumor) {
                ActionMenu.showMapTradeMenu(game, tile);
                return;
            }
            // The guild contact opens the underworld panel
            if (rumors.some(r => r.openUnderworld)) {
                ActionMenu.showUnderworldPanel(game, tile);
                return;
            }
            // The whispering corner opens the scandals panel (ui/actionMenu/whispers.js)
            if (rumors.some(r => r.openWhispers)) {
                ActionMenu.showWhispersPanel(game, tile);
                return;
            }
            // The dice tables are the gambling den; the stranger is the soul pact (ui/actionMenu/devotion.js)
            if (rumors.some(r => r.openGambling)) {
                ActionMenu.showGamblingMenu(game, tile);
                return;
            }
            if (rumors.some(r => r.openSoulPact)) {
                DevotionPanel.showSoulPact(game, tile);
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

                // Spymaster intel gathering — foreign territory taverns count as intel
                if (typeof Titles !== 'undefined' && game.player.currentTitle === 'spymaster' && tavernKingdomId !== game.player.allegiance) {
                    const intelResult = Titles.recordIntelGathered(game.player);
                    if (intelResult) {
                        game.ui.showNotification('🕵️ Intel Gathered', `Spymaster duty: Intelligence gathered (+${intelResult.gold} gold). Total: ${intelResult.count}`, 'success');
                    }
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
        if (!ActionMenu.commitPendingAP(game)) return;
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
                <button data-am-act="closePanel"
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
                <button data-am-act="closePanel"
                    style="width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px; cursor: pointer; color: white; font-family: var(--font-body);">
                    Close
                </button>
            </div>
        `;

        html += '</div>';
        game.ui.showCustomPanel('📖 Intel Journal', html);
    },
});
