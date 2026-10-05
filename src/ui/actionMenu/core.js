// ActionMenu — core methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerReligion, Gossip } from './_imports.js';

Object.assign(ActionMenu, {
    // ── Delegated-click helpers ──
    // Panel buttons use data-am-act="<method>" (routed by routeDelegatedClick
    // with the live game) because there is no global `game` for inline onclick.

    /** Close the custom panel. */
    closePanel(game) {
        game.ui.hideCustomPanel();
    },

    /** Close the custom panel and refresh the HUD. */
    closePanelAndRefresh(game) {
        game.ui.hideCustomPanel();
        game.ui.updateStats(game.player, game.world);
    },

    /** Close the custom panel and end the day. */
    closePanelAndEndDay(game) {
        game.ui.hideCustomPanel();
        game.endDay();
    },

    /**
     * Open a tile-based ActionMenu panel (`method(game, tile)`) for hex (q, r),
     * or the player's own hex when no coordinates are given.
     */
    openTileMenu(game, method, q = game.player.q, r = game.player.r) {
        game.ui.hideCustomPanel();
        if (typeof ActionMenu[method] === 'function') ActionMenu[method](game, game.world.getTile(q, r));
    },

    /** Post a colony signboard, then reopen the colony panel. */
    postSignboardAndManageColony(game, q, r) {
        ActionMenu.doPostSignboard(game, game.world.getTile(q, r));
        setTimeout(() => ActionMenu.showManageColonyMenu(game, game.world.getTile(q, r)), 200);
    },

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
     * Categorize actions into groups for the tabbed UI
     */
    _categorizeActions(actions) {
        const categories = {
            general:    { label: 'General',    icon: '🏕️', actions: [] },
            commerce:   { label: 'Commerce',   icon: '💰', actions: [] },
            social:     { label: 'Social',     icon: '🗣️', actions: [] },
            military:   { label: 'Military',   icon: '⚔️', actions: [] },
            building:   { label: 'Build',      icon: '🏗️', actions: [] },
            frontier:   { label: 'Frontier',   icon: '🧭', actions: [] },
            cartography:{ label: 'Maps',       icon: '🗺️', actions: [] },
            jail:       { label: 'Jail',       icon: '🔒', actions: [] },
            servitude:  { label: 'Servitude',  icon: '⛓️', actions: [] },
        };

        const mapping = {
            rest: 'general', eat_meal: 'general', seek_physician: 'general', explore_poi: 'general', delve: 'general', delve_resume: 'general', clear_trees: 'general', dig_treasure: 'general',
            forage: 'general', hunt: 'general', meditate: 'general', fish: 'general',
            trap_furs: 'general', ice_fish: 'general', planting_contract: 'commerce',
            prospect: 'general', tame_horse: 'general', craft_campfire: 'general',
            disembark: 'general', row_ashore: 'general', row_to_ship: 'general', ship_hold: 'commerce', port_market: 'commerce', explore_ocean: 'general', make_for_port: 'general', hunt_pirates: 'military', commit_piracy: 'military', explore_inner_map: 'general',
            trade: 'commerce', contract: 'commerce', ship_passage: 'commerce',
            collect_goods: 'commerce', manage_property: 'commerce', start_caravan: 'commerce',
            odd_jobs: 'commerce', bounty_board: 'commerce', busking: 'commerce', gambling: 'commerce',
            smuggle: 'commerce', pickpocket: 'commerce',
            tavern: 'social', talk_locals: 'social', preach: 'social', denounce_heresy: 'social',
            pilgrimage: 'social', miracle: 'social', donate: 'social',
            pledge_allegiance: 'social', renounce_allegiance: 'social',
            realm_wars: 'social', fund_restoration: 'social',
            form_kingdom: 'social', claims_crowns: 'social',
            host_feast: 'social', hold_tournament: 'social', host_festival: 'social',
            meet_people: 'social', view_relationships: 'social', manage_dynasty: 'social',
            recruit: 'military', attack_unit: 'military', attack_settlement: 'military', siege_camp: 'military',
            train_combat: 'military', reforge_artifact: 'military', capture_criminal: 'military',
            request_meeting: 'social',
            build_property: 'building', build_temple: 'building',
            build_cultural: 'building', upgrade_cultural: 'building', build_infrastructure: 'building',
            demolish_infrastructure: 'building',
            buy_house: 'building', manage_house: 'building',
            visit_shipyard: 'commerce', board_ship: 'commerce', manage_fleet: 'commerce',
            found_colony: 'frontier', send_pioneers: 'frontier',
            manage_colony: 'frontier', negotiate_indigenous: 'frontier',
            recruit_settlers: 'frontier', post_signboard: 'frontier', wait_here: 'frontier',
            cartography: 'cartography', map_trade: 'cartography',
            steal_map: 'cartography',
            jail_wait: 'jail', jail_bail: 'jail', jail_escape: 'jail',
            servitude_wait: 'servitude', servitude_escape: 'servitude',
            servitude_buy_freedom: 'servitude',
            seek_title: 'social', view_title_status: 'social', resign_title: 'social',
            collect_tax: 'social', request_bounty: 'social', capture_fugitive: 'social',
            bless_settlement: 'social', hold_council: 'social',
            espionage_menu: 'social', manage_spies: 'social',
            hold_court: 'social', manage_holding: 'frontier',
            rivals_here: 'social', hall_of_heroes: 'social',
            underworld: 'commerce',
        };

        for (const action of actions) {
            const cat = mapping[action.type] || 'general';
            categories[cat].actions.push(action);
        }

        // Return only categories that have actions, preserving order
        const ordered = ['general', 'commerce', 'social', 'military', 'building', 'frontier', 'cartography', 'jail', 'servitude'];
        return ordered
            .filter(key => categories[key].actions.length > 0)
            .map(key => ({ id: key, ...categories[key] }));
    },

    /**
     * Create the action menu UI — all categories visible, no scrolling
     */
    createMenu(game, tile, actions) {
        // Remove existing menu if any
        ActionMenu.close();

        const categories = ActionMenu._categorizeActions(actions);

        // If servitude/jail, show simple flat list (very few actions)
        const isSpecial = categories.length === 1 && (categories[0].id === 'servitude' || categories[0].id === 'jail');

        const menu = document.createElement('div');
        menu.id = 'actionMenu';
        menu.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(16, 20, 28, 0.97);
            backdrop-filter: blur(14px);
            border: 1px solid rgba(245, 197, 66, 0.35);
            border-radius: 12px;
            z-index: 1000;
            box-shadow: 0 12px 48px rgba(0,0,0,0.85), 0 0 0 1px rgba(245,197,66,0.08);
            overflow: hidden;
            font-family: var(--font-body);
            display: flex;
            flex-direction: column;
            max-width: 92vw;
            max-height: 90vh;
        `;

        // ── Header ──
        let locationInfo = '';
        if (tile.settlement) {
            locationInfo = `${tile.settlement.name} (${tile.settlement.type})`;
        } else if (tile.improvement) {
            locationInfo = tile.improvement.name;
        } else {
            locationInfo = tile.terrain.name || tile.terrain.id;
        }

        const ap = game.player.actionPoints != null ? game.player.actionPoints : 10;
        const maxAp = game.player.maxActionPoints || 10;

        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;
                border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(245,197,66,0.04); flex-shrink: 0;">
                <div>
                    <div style="font-family: var(--font-display); font-size: 14px; color: var(--gold); letter-spacing: 0.5px;">Actions</div>
                    <div style="font-size: 11px; color: var(--text-secondary); margin-top: 1px;">${locationInfo}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 11px; color: #f39c12; background: rgba(243,156,18,0.12); padding: 2px 8px; border-radius: 4px;">⚡ ${ap}/${maxAp} AP</span>
                    <button id="closeActionMenu" style="background: none; border: none; color: rgba(255,255,255,0.4);
                        font-size: 18px; cursor: pointer; padding: 4px 6px; line-height: 1;
                        transition: color 0.15s;"
                        onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">✕</button>
                </div>
            </div>
        `;

        if (isSpecial) {
            // Simple flat layout for jail/servitude — few actions
            html += `<div style="padding: 10px; display: grid; gap: 6px;">`;
            for (const action of categories[0].actions) {
                html += ActionMenu._renderActionButton(action);
            }
            html += `</div>`;
        } else {
            // ── Multi-column layout: all categories visible at once ──
            // Determine column count based on number of categories
            const colCount = categories.length <= 2 ? categories.length : categories.length <= 4 ? 2 : 3;

            html += `<div style="display: grid; grid-template-columns: repeat(${colCount}, 1fr); gap: 0;">`;

            for (const cat of categories) {
                html += `<div style="border-right: 1px solid rgba(255,255,255,0.04); border-bottom: 1px solid rgba(255,255,255,0.04);
                    display: flex; flex-direction: column;">`;

                // Category header
                html += `<div style="padding: 7px 10px; font-size: 11px; font-family: var(--font-display);
                    color: var(--gold); letter-spacing: 1px; text-transform: uppercase;
                    border-bottom: 1px solid rgba(245,197,66,0.12); background: rgba(245,197,66,0.03);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${cat.icon} ${cat.label}
                </div>`;

                // Action items — compact tile grid
                html += `<div style="padding: 6px; display: flex; flex-direction: column; gap: 3px; flex: 1;">`;
                for (const action of cat.actions) {
                    html += ActionMenu._renderActionTile(action);
                }
                html += `</div>`;

                html += `</div>`;
            }

            html += `</div>`;
        }

        menu.innerHTML = html;
        document.body.appendChild(menu);

        // ── Event listeners ──
        document.getElementById('closeActionMenu').addEventListener('click', () => ActionMenu.close());

        // Action buttons
        const buttons = menu.querySelectorAll('.action-menu-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const actionType = btn.getAttribute('data-action');
                const unitId = btn.getAttribute('data-unit-id');
                ActionMenu.handleAction(game, tile, actionType, unitId);
            });
        });

        // Tooltip system for action descriptions
        const tooltipEl = document.createElement('div');
        tooltipEl.id = 'actionTooltip';
        tooltipEl.style.cssText = `
            position: fixed; z-index: 1100; pointer-events: none;
            background: rgba(10, 14, 22, 0.96); border: 1px solid rgba(245,197,66,0.3);
            border-radius: 6px; padding: 8px 12px; max-width: 260px;
            font-size: 12px; color: var(--text-secondary); line-height: 1.4;
            box-shadow: 0 4px 16px rgba(0,0,0,0.7);
            display: none; transition: opacity 0.12s;
        `;
        document.body.appendChild(tooltipEl);

        buttons.forEach(btn => {
            btn.addEventListener('mouseenter', (e) => {
                const desc = btn.getAttribute('data-desc');
                if (!desc) return;
                tooltipEl.textContent = desc;
                tooltipEl.style.display = 'block';
                const rect = btn.getBoundingClientRect();
                // Position tooltip to the right of the button, or left if near edge
                let left = rect.right + 8;
                let top = rect.top;
                if (left + 270 > window.innerWidth) {
                    left = rect.left - 270;
                }
                if (top + 60 > window.innerHeight) {
                    top = window.innerHeight - 60;
                }
                tooltipEl.style.left = left + 'px';
                tooltipEl.style.top = top + 'px';
            });
            btn.addEventListener('mouseleave', () => {
                tooltipEl.style.display = 'none';
            });
        });
    },

    /**
     * Render a compact action tile — icon + name + AP badge, no description inline
     */
    _renderActionTile(action) {
        const apCost = ActionMenu.getAPCost(action.type);
        const perUseActions = { gambling: 2, smuggle: 2 };
        let apBadge = '';
        if (perUseActions[action.type]) {
            apBadge = `<span style="font-size: 9px; color: #f39c12; opacity: 0.8; margin-left: auto; flex-shrink: 0;">⚡${perUseActions[action.type]}/use</span>`;
        } else if (apCost > 0) {
            apBadge = `<span style="font-size: 9px; color: #f39c12; opacity: 0.8; margin-left: auto; flex-shrink: 0;">⚡${apCost}</span>`;
        } else {
            apBadge = `<span style="font-size: 9px; color: #27ae60; opacity: 0.7; margin-left: auto; flex-shrink: 0;">free</span>`;
        }
        return `
            <button class="action-menu-btn" data-action="${action.type}"${action.unitId ? ` data-unit-id="${action.unitId}"` : ''}
                data-desc="${(action.description || '').replace(/"/g, '&quot;')}"
                style="
                    display: flex; align-items: center; gap: 7px;
                    background: rgba(255,255,255,0.025);
                    border: 1px solid rgba(255,255,255,0.05);
                    padding: 6px 8px;
                    border-radius: 5px;
                    color: var(--text-primary);
                    cursor: pointer;
                    text-align: left;
                    transition: background 0.12s, border-color 0.12s;
                    font-family: var(--font-body);
                    white-space: nowrap;
                    min-width: 0;
                " onmouseover="this.style.background='rgba(245,197,66,0.12)';this.style.borderColor='rgba(245,197,66,0.3)'"
                   onmouseout="this.style.background='rgba(255,255,255,0.025)';this.style.borderColor='rgba(255,255,255,0.05)'">
                <span style="font-size: 16px; width: 22px; text-align: center; flex-shrink: 0;">${action.icon}</span>
                <span style="font-size: 12px; color: #ddd; overflow: hidden; text-overflow: ellipsis;">${action.label}</span>
                ${apBadge}
            </button>
        `;
    },

    /**
     * Render a single action button with icon, label, and description
     */
    _renderActionButton(action) {
        const apCost = ActionMenu.getAPCost(action.type);
        // Special display for actions that charge AP per-use inside their menus
        const perUseActions = { gambling: 2, smuggle: 2 };
        let apLabel = '';
        if (perUseActions[action.type]) {
            apLabel = `<span style="font-size: 10px; color: #f39c12; background: rgba(243,156,18,0.15); padding: 1px 5px; border-radius: 3px; white-space: nowrap;">⚡${perUseActions[action.type]}/use</span>`;
        } else if (apCost > 0) {
            apLabel = `<span style="font-size: 10px; color: #f39c12; background: rgba(243,156,18,0.15); padding: 1px 5px; border-radius: 3px; white-space: nowrap;">⚡${apCost}</span>`;
        }
        return `
            <button class="action-menu-btn" data-action="${action.type}"${action.unitId ? ` data-unit-id="${action.unitId}"` : ''} style="
                display: flex; align-items: center; gap: 10px;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.07);
                padding: 10px 12px;
                border-radius: 6px;
                color: var(--text-primary);
                cursor: pointer;
                text-align: left;
                transition: background 0.15s, border-color 0.15s, transform 0.1s;
                font-family: var(--font-body);
            " onmouseover="this.style.background='rgba(245,197,66,0.1)';this.style.borderColor='rgba(245,197,66,0.35)'"
               onmouseout="this.style.background='rgba(255,255,255,0.03)';this.style.borderColor='rgba(255,255,255,0.07)'">
                <span style="font-size: 22px; width: 30px; text-align: center; flex-shrink: 0;">${action.icon}</span>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 13px; font-weight: 600; color: #e0e0e0;">${action.label}</span>
                        ${apLabel}
                    </div>
                    <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${action.description || ''}</div>
                </div>
            </button>
        `;
    },

    /**
     * Action Point costs for each action type.
     * Actions cost AP to perform, limiting how much a player can do per day.
     * 0 = free (rest, viewing, jail/servitude actions)
     */
    AP_COSTS: {
        // Free actions (0 AP)
        rest: 0,
        eat_meal: 0,
        disembark: 0,
        explore_inner_map: 0,
        jail_wait: 0, jail_bail: 0, jail_escape: 0,
        servitude_wait: 0, servitude_escape: 0, servitude_buy_freedom: 0,
        view_relationships: 0, manage_dynasty: 0,
        manage_fleet: 0, manage_house: 0, manage_property: 0, manage_colony: 0,
        hold_court: 0, manage_holding: 0,
        seek_physician: 0, // treatment costs gold, not time
        underworld: 0, // jobs inside the panel cost their own AP

        // Light actions (1 AP)
        trade: 1, collect_goods: 1, donate: 1,
        pledge_allegiance: 1, renounce_allegiance: 1,
        realm_wars: 0, fund_restoration: 2,
        form_kingdom: 6, claims_crowns: 0,
        bounty_board: 1, talk_locals: 1, request_meeting: 1,
        buy_house: 1, meet_people: 0,

        // Moderate actions (2 AP)
        pickpocket: 2, gambling: 0, smuggle: 0, // gambling/smuggle cost 2 AP per use inside their menus
        recruit: 2, cartography: 2, map_trade: 2, steal_map: 2,
        craft_campfire: 2, negotiate_indigenous: 2, preach: 2, denounce_heresy: 2,

        // Half-day work (3 AP)
        forage: 3, busking: 3, meditate: 3,
        prospect: 3, tame_horse: 3, fish: 3, reforge_artifact: 3,

        // Full-day work (4 AP)
        odd_jobs: 4, hunt: 4, train_combat: 4,
        trap_furs: 4, ice_fish: 3, planting_contract: 4,
        dig_treasure: 4, explore_poi: 4, delve: 4, delve_resume: 0,

        // Major activities (5 AP)
        host_feast: 5, hold_tournament: 5, host_festival: 6, contract: 5,
        start_caravan: 5, ship_passage: 2, pilgrimage: 5,
        miracle: 5, tavern: 5,

        // Construction / Major operations (6 AP)
        build_property: 6, build_temple: 6, build_infrastructure: 6,
        build_cultural: 6, upgrade_cultural: 3, found_colony: 6, clear_trees: 6,
        demolish_infrastructure: 6, send_pioneers: 6,

        // Combat / Major ship operations (8 AP)
        attack_unit: 8, attack_settlement: 8, siege_camp: 0,
        board_ship: 8, visit_shipyard: 1, row_ashore: 4, row_to_ship: 4, ship_hold: 0, port_market: 0, explore_ocean: 6, make_for_port: 0, hunt_pirates: 10, commit_piracy: 10,

        // Title actions
        seek_title: 1, view_title_status: 0, resign_title: 1,
        collect_tax: 3, request_bounty: 1, capture_fugitive: 5, capture_criminal: 4,
        bless_settlement: 3, hold_council: 5,

        // Espionage actions
        espionage_menu: 0, manage_spies: 0,

        // Rival adventurers (each deed inside the panel pays its own AP)
        rivals_here: 0, hall_of_heroes: 0,
        rival_duel: 4, rival_race: 1, rival_sabotage: 2, rival_hire: 1, rival_team_up: 1,
    },

    /**
     * Get the AP cost for an action type
     */
    getAPCost(actionType) {
        const cost = ActionMenu.AP_COSTS[actionType];
        return cost != null ? cost : 2; // Default 2 AP for unknown actions
    },

    /**
     * Check if player has enough AP and deduct if so. Returns true if action can proceed.
     */
    spendAP(player, actionType, game) {
        const cost = ActionMenu.getAPCost(actionType);
        if (cost === 0) return true;
        if ((player.actionPoints || 0) < cost) {
            if (game) {
                game.ui.showNotification('⚡ Not Enough Action Points',
                    `This action requires ${cost} AP but you only have ${player.actionPoints || 0}. Rest to start a new day.`, 'error');
            }
            return false;
        }
        player.actionPoints -= cost;
        if (game) game.ui.updateStats(player, game.world);
        return true;
    },

    /**
     * Actions that open a sub-menu — AP is validated upfront but deducted only on confirm.
     */
    _pendingAP: null,

    DEFERRED_AP_ACTIONS: new Set([
        'trade', 'recruit', 'contract', 'reforge_artifact',
        'build_property', 'build_temple', 'build_infrastructure', 'build_cultural', 'upgrade_cultural',
        'start_caravan', 'tavern', 'miracle', 'ship_passage', 'terraform',
        'talk_locals', 'bounty_board', 'odd_jobs', 'busking',
        'donate', 'fund_restoration', 'form_kingdom', 'host_feast', 'hold_tournament', 'host_festival',
        'found_colony', 'send_pioneers', 'negotiate_indigenous', 'recruit_settlers',
        'cartography', 'map_trade',
        'attack_unit', 'attack_settlement',
        'request_meeting', 'buy_house', 'seek_title', 'visit_shipyard',
        'delve',
    ]),

    /**
     * Spend (commit) the deferred AP that was stored by handleAction.
     * Call this at the top of every sub-menu confirm handler.
     * Returns true if AP was successfully spent (or there was nothing pending), false if insufficient.
     */
    commitPendingAP(game) {
        if (ActionMenu._pendingAP === null) return true; // nothing pending, already paid or free
        const cost = ActionMenu._pendingAP;
        ActionMenu._pendingAP = null;
        if (cost === 0) return true;
        if ((game.player.actionPoints || 0) < cost) {
            game.ui.showNotification('⚡ Not Enough Action Points',
                `This action requires ${cost} AP but you only have ${game.player.actionPoints || 0}. Rest to start a new day.`, 'error');
            return false;
        }
        game.player.actionPoints -= cost;
        game.ui.updateStats(game.player, game.world);
        return true;
    },

    /**
     * Handle action selection
     */
    /** Services an outlaw is refused where they're banned or wanted. */
    OUTLAW_REFUSED_ACTIONS: new Set(['trade', 'tavern', 'gambling', 'bounty_board', 'odd_jobs', 'recruit', 'train_combat', 'contract', 'port_market']),

    /**
     * Tell the player they're turned away when gossip of their crimes has got
     * them banned here or the crown wants them. Returns true when refused.
     */
    refuseIfOutlawed(game, tile) {
        if (!tile || !tile.settlement) return false;
        const verdict = Gossip.refusesService(game.player, tile.q, tile.r, game.world);
        if (!verdict.refused) return false;
        game.ui.showNotification('🚫 Turned Away', `${verdict.reason} Visit the guard tower to settle your record.`, 'error');
        return true;
    },

    handleAction(game, tile, actionType, unitId) {
        ActionMenu.close();

        if (ActionMenu.OUTLAW_REFUSED_ACTIONS.has(actionType) && ActionMenu.refuseIfOutlawed(game, tile)) return;

        // Holy Sanctuary is a no-combat zone — for the player too
        if ((actionType === 'attack_unit' || actionType === 'attack_settlement') &&
            PlayerReligion.isInSanctuary(game.player, game.player.q, game.player.r, game.world.width)) {
            game.ui.showNotification('🕊️ Holy Sanctuary', 'You cannot start a fight within your own sanctuary.', 'error');
            return;
        }

        // For sub-menu actions: validate AP now but defer deduction until confirm
        if (ActionMenu.DEFERRED_AP_ACTIONS.has(actionType)) {
            const cost = ActionMenu.getAPCost(actionType);
            if (cost > 0 && (game.player.actionPoints || 0) < cost) {
                game.ui.showNotification('⚡ Not Enough Action Points',
                    `This action requires ${cost} AP but you only have ${game.player.actionPoints || 0}. Rest to start a new day.`, 'error');
                return;
            }
            ActionMenu._pendingAP = cost;
        } else {
            // Immediate actions: spend AP right now
            if (!ActionMenu.spendAP(game.player, actionType, game)) {
                return;
            }
        }

        // ── Apply need effects based on action type ──
        if (game.player.modifyNeed) {
            const p = game.player;
            switch (actionType) {
                case 'forage':      p.modifyNeed('energy', -8); p.modifyNeed('hygiene', -5); p.modifyNeed('fun', 5); break;
                case 'hunt':        p.modifyNeed('energy', -12); p.modifyNeed('hygiene', -8); p.modifyNeed('fun', 10); break;
                case 'trap_furs':   p.modifyNeed('energy', -12); p.modifyNeed('comfort', -8); break;
                case 'ice_fish':    p.modifyNeed('energy', -6); p.modifyNeed('comfort', -6); p.modifyNeed('fun', 8); break;
                case 'planting_contract': p.modifyNeed('energy', -10); p.modifyNeed('hygiene', -8); p.modifyNeed('social', 4); break;
                case 'fish':        p.modifyNeed('energy', -5); p.modifyNeed('fun', 12); p.modifyNeed('comfort', 5); break;
                case 'meditate':    p.modifyNeed('comfort', 15); p.modifyNeed('energy', 8); p.modifyNeed('fun', 3); break;
                case 'train_combat': p.modifyNeed('energy', -15); p.modifyNeed('hygiene', -10); p.modifyNeed('fun', 8); break;
                case 'meet_people': p.modifyNeed('social', 15); p.modifyNeed('fun', 5); break;
                case 'talk_locals': p.modifyNeed('social', 10); p.modifyNeed('fun', 3); break;
                case 'gambling':    p.modifyNeed('fun', 15); p.modifyNeed('social', 10); break;
                case 'busking':     p.modifyNeed('fun', 12); p.modifyNeed('social', 8); p.modifyNeed('energy', -5); break;
                case 'host_feast':  p.modifyNeed('social', 20); p.modifyNeed('fun', 15); p.modifyNeed('hunger', 25); break;
                case 'hold_tournament': p.modifyNeed('fun', 20); p.modifyNeed('social', 15); break;
                case 'host_festival':   p.modifyNeed('fun', 25); p.modifyNeed('social', 20); break;
                case 'preach':      p.modifyNeed('social', 8); p.modifyNeed('comfort', 5); break;
                case 'denounce_heresy': p.modifyNeed('social', 8); break;
                case 'pilgrimage':  p.modifyNeed('comfort', 15); p.modifyNeed('energy', -10); break;
                case 'donate':      p.modifyNeed('comfort', 8); break;
                case 'trade':       p.modifyNeed('social', 5); break;
                case 'tavern':      p.modifyNeed('social', 5); p.modifyNeed('comfort', 5); break;
                case 'explore_poi': p.modifyNeed('fun', 10); p.modifyNeed('energy', -5); break;
                case 'delve':       p.modifyNeed('fun', 12); p.modifyNeed('energy', -8); p.modifyNeed('hygiene', -6); break;
                case 'explore_inner_map': p.modifyNeed('fun', 5); break;
                case 'clear_trees': p.modifyNeed('energy', -10); p.modifyNeed('hygiene', -5); break;
                case 'pickpocket':  p.modifyNeed('fun', 5); p.modifyNeed('comfort', -8); break;
                case 'smuggle':     p.modifyNeed('fun', 5); p.modifyNeed('comfort', -5); break;
                case 'request_meeting': p.modifyNeed('social', 10); break;
                case 'prospect':    p.modifyNeed('energy', -8); p.modifyNeed('fun', 5); break;
                case 'tame_horse':  p.modifyNeed('fun', 10); p.modifyNeed('energy', -8); break;
                case 'craft_campfire': p.modifyNeed('comfort', 10); p.modifyNeed('fun', 3); break;
                case 'dig_treasure': p.modifyNeed('fun', 10); p.modifyNeed('energy', -8); p.modifyNeed('hygiene', -5); break;
                case 'odd_jobs':    p.modifyNeed('energy', -8); p.modifyNeed('social', 5); break;
            }
        }

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
            case 'reforge_artifact':
                ActionMenu.showReforgeArtifactMenu(game, tile);
                break;
            case 'preach':
                ActionMenu.preach(game, tile);
                break;
            case 'denounce_heresy':
                ActionMenu.denounceHeresy(game, tile);
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
            case 'seek_physician':
                ActionMenu.showPhysicianMenu(game, tile);
                break;
            case 'rest':
                // Making camp on purpose beats collapsing by the roadside
                if (!game.player._restTypeOverride) game.player._restTypeOverride = 'camp';
                game.endDay();
                break;
            case 'eat_meal': {
                const meal = game.player.eatMeal();
                if (meal.success) {
                    const name = meal.food.replace(/_/g, ' ');
                    game.ui.showNotification('🍖 A Good Meal',
                        `You eat some ${name} from your pack (+${meal.hunger} hunger).`, 'success');
                } else {
                    game.ui.showNotification('🍖 Nothing to Eat', meal.reason, 'error');
                }
                ActionMenu.close();
                game.ui.updateStats(game.player, game.world);
                break;
            }
            case 'explore_inner_map':
                ActionMenu.close();
                {
                    const targetQ = (tile && Number.isFinite(tile.q)) ? tile.q : game.player.q;
                    const targetR = (tile && Number.isFinite(tile.r)) ? tile.r : game.player.r;
                    Promise.resolve(game.enterInnerMap(targetQ, targetR)).catch((err) => {
                        console.error('[ActionMenu] Failed to enter inner map:', err);
                        if (game && game.ui && typeof game.ui.showNotification === 'function') {
                            game.ui.showNotification('Inner Map Error', 'Failed to enter the inner map. Check console for details.', 'error');
                        }
                    });
                }
                break;
            case 'disembark':
                ActionMenu.disembarkShip(game);
                break;
            case 'row_ashore':
                ActionMenu.showRowAshoreMenu(game);
                break;
            case 'row_to_ship':
                ActionMenu.rowToShip(game);
                break;
            case 'ship_hold':
                ActionMenu.showShipHoldMenu(game);
                break;
            case 'port_market':
                ActionMenu.showPortMarketMenu(game);
                break;
            case 'make_for_port':
                if (game.player.boardedShip) ActionMenu._showSailToMenu(game, tile, game.player.boardedShip);
                break;
            case 'explore_ocean':
            case 'hunt_pirates':
            case 'commit_piracy':
                ActionMenu.doSeaActivity(game, actionType);
                break;
            case 'miracle':
                ActionMenu.showMiracleMenu(game);
                break;
            case 'ship_passage':
                ActionMenu.showShipPassageMenu(game, tile);
                break;
            case 'manage_property':
                ActionMenu.showPropertyPicker(game, tile);
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
            case 'terraform':
                ActionMenu.showTerraformMenu(game, tile);
                break;
            case 'explore_poi':
                ActionMenu.explorePOI(game, tile);
                break;
            case 'delve':
            case 'delve_resume':
                ActionMenu.showDelvePanel(game, tile);
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
            case 'upgrade_cultural':
                ActionMenu.showUpgradeCulturalMenu(game, tile);
                break;
            case 'pilgrimage':
                ActionMenu.visitHolySite(game, tile);
                break;
            case 'jail_wait':
                game.endDay();
                break;
            case 'jail_bail':
                ActionMenu.postBail(game);
                break;
            case 'jail_escape':
                ActionMenu.attemptJailbreak(game);
                break;
            case 'servitude_wait':
                game.endDay();
                break;
            case 'servitude_escape':
                ActionMenu.attemptServitudeEscape(game);
                break;
            case 'servitude_buy_freedom':
                ActionMenu.buyFreedom(game);
                break;
            case 'found_colony':
                ActionMenu.showFoundColonyMenu(game, tile);
                break;
            case 'send_pioneers':
                ActionMenu.showSendPioneersMenu(game, tile);
                break;
            case 'manage_colony':
                ActionMenu.showManageColonyMenu(game, tile);
                break;
            case 'negotiate_indigenous':
                ActionMenu.showNegotiateIndigenousMenu(game, tile);
                break;
            case 'recruit_settlers':
                ActionMenu.showRecruitSettlersMenu(game, tile);
                break;
            case 'post_signboard':
                ActionMenu.doPostSignboard(game, tile);
                break;
            case 'wait_here':
                // Informational only — no action
                game.ui.showNotification('Settlement Status', `${tile.settlement.name} has ${tile.settlement.population} settlers. Visit other towns to recruit more!`, 'info');
                break;
            case 'cartography':
                ActionMenu.showCartographyMenu(game, tile);
                break;
            case 'map_trade':
                ActionMenu.showMapTradeMenu(game, tile);
                break;
            case 'steal_map':
                ActionMenu.attemptStealMap(game, tile);
                break;
            case 'dig_treasure':
                ActionMenu.digTreasure(game, tile);
                break;
            case 'odd_jobs':
                ActionMenu.showOddJobsMenu(game, tile);
                break;
            case 'bounty_board':
                ActionMenu.showBountyBoardMenu(game, tile);
                break;
            case 'busking':
                ActionMenu.showBuskingMenu(game, tile);
                break;
            case 'gambling':
                ActionMenu.showGamblingMenu(game, tile);
                break;
            case 'forage':
                ActionMenu.doForage(game, tile);
                break;
            case 'hunt':
                ActionMenu.doHunt(game, tile);
                break;
            case 'trap_furs':
                ActionMenu.doTrapFurs(game, tile);
                break;
            case 'ice_fish':
                ActionMenu.doIceFish(game, tile);
                break;
            case 'planting_contract':
                ActionMenu.doPlantingContract(game, tile);
                break;
            case 'donate':
                ActionMenu.showDonateMenu(game, tile);
                break;
            case 'pledge_allegiance':
                ActionMenu.doPledgeAllegiance(game, tile);
                break;
            case 'renounce_allegiance':
                ActionMenu.doRenounceAllegiance(game, tile);
                break;
            case 'realm_wars':
                ActionMenu.showRealmWarsMenu(game, tile);
                break;
            case 'fund_restoration':
                ActionMenu.showRestorationMenu(game, tile);
                break;
            case 'form_kingdom':
                ActionMenu.showFormKingdomMenu(game, tile);
                break;
            case 'claims_crowns':
                ActionMenu.showClaimsPanel(game, tile);
                break;
            case 'rivals_here':
                ActionMenu.showRivalsPanel(game, tile);
                break;
            case 'hall_of_heroes':
                ActionMenu.showHallOfHeroes(game, tile);
                break;
            case 'trading_company':
                ActionMenu.showTradingCompany(game, tile);
                break;
            case 'host_feast':
                ActionMenu.showHostFeastMenu(game, tile);
                break;
            case 'hold_tournament':
                ActionMenu.showTournamentMenu(game, tile);
                break;
            case 'host_festival':
                ActionMenu.showFestivalMenu(game, tile);
                break;
            case 'pickpocket':
                ActionMenu.doPickpocket(game, tile);
                break;
            case 'smuggle':
                ActionMenu.showSmuggleMenu(game, tile);
                break;
            case 'train_combat':
                ActionMenu.doTrainCombat(game, tile);
                break;
            case 'meditate':
                ActionMenu.doMeditate(game, tile);
                break;
            case 'fish':
                ActionMenu.doFish(game, tile);
                break;
            case 'prospect':
                ActionMenu.doProspect(game, tile);
                break;
            case 'tame_horse':
                ActionMenu.doTameHorse(game, tile);
                break;
            case 'craft_campfire':
                ActionMenu.doCraftCampfire(game, tile);
                break;
            case 'meet_people':
                ActionMenu.showMeetPeopleMenu(game, tile);
                break;
            case 'view_relationships':
                ActionMenu.showRelationshipsMenu(game, tile);
                break;
            case 'manage_dynasty':
                ActionMenu.showDynastyMenu(game, tile);
                break;
            case 'attack_unit':
                ActionMenu.showAttackConfirm(game, tile, actionType);
                break;
            case 'attack_settlement':
                ActionMenu.showSiegeConfirm(game, tile);
                break;
            case 'siege_camp':
                ActionMenu.showSiegePanel(game);
                break;
            case 'request_meeting':
                ActionMenu.showLordMeetingMenu(game, tile, { type: actionType, unitId });
                break;
            case 'buy_house':
                ActionMenu.showBuyHouseMenu(game, tile);
                break;
            case 'manage_house':
                ActionMenu.showManageHouseMenu(game, tile);
                break;
            case 'visit_shipyard':
                ActionMenu.showShipyardMenu(game, tile);
                break;
            case 'board_ship':
                ActionMenu.showBoardShipMenu(game, tile);
                break;
            case 'manage_fleet':
                ActionMenu.showFleetMenu(game, tile);
                break;

            // ── Title Actions ──
            case 'seek_title':
                ActionMenu.showSeekTitleMenu(game, tile);
                break;
            case 'view_title_status':
                ActionMenu.showTitleStatusPanel(game);
                break;
            case 'collect_tax':
                ActionMenu.doCollectTax(game, tile);
                break;
            case 'request_bounty':
                ActionMenu.doRequestBounty(game, tile);
                break;
            case 'capture_fugitive':
                ActionMenu.doCaptureFugitive(game, tile);
                break;
            case 'capture_criminal':
                ActionMenu.doCaptureCriminal(game, tile);
                break;
            case 'bless_settlement':
                ActionMenu.doBlessSettlement(game, tile);
                break;
            case 'hold_council':
                ActionMenu.doHoldCouncil(game, tile);
                break;
            case 'underworld':
                ActionMenu.showUnderworldPanel(game, tile);
                break;
            case 'hold_court':
                ActionMenu.showCourtPanel(game, tile);
                break;
            case 'manage_holding':
                ActionMenu.showHoldingPanel(game, tile);
                break;

            // ── Espionage Actions ──
            case 'espionage_menu':
                ActionMenu.showEspionageMenu(game, tile);
                break;
            case 'manage_spies':
                ActionMenu.showManageSpiesMenu(game, tile);
                break;
        }
    },
});
