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
            rest: 'general', explore_poi: 'general', clear_trees: 'general', dig_treasure: 'general',
            forage: 'general', hunt: 'general', meditate: 'general', fish: 'general',
            prospect: 'general', tame_horse: 'general', craft_campfire: 'general',
            disembark: 'general', explore_inner_map: 'general',
            trade: 'commerce', contract: 'commerce', ship_passage: 'commerce',
            collect_goods: 'commerce', manage_property: 'commerce', start_caravan: 'commerce',
            odd_jobs: 'commerce', bounty_board: 'commerce', busking: 'commerce', gambling: 'commerce',
            smuggle: 'commerce', pickpocket: 'commerce',
            tavern: 'social', talk_locals: 'social', preach: 'social',
            pilgrimage: 'social', miracle: 'social', donate: 'social',
            pledge_allegiance: 'social', renounce_allegiance: 'social',
            form_kingdom: 'social',
            host_feast: 'social', hold_tournament: 'social', host_festival: 'social',
            meet_people: 'social', view_relationships: 'social', manage_dynasty: 'social',
            recruit: 'military', attack_unit: 'military', attack_settlement: 'military',
            train_combat: 'military', reforge_artifact: 'military', capture_criminal: 'military',
            request_meeting: 'social',
            build_property: 'building', build_temple: 'building',
            build_cultural: 'building', build_infrastructure: 'building',
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
        disembark: 0,
        jail_wait: 0, jail_bail: 0, jail_escape: 0,
        servitude_wait: 0, servitude_escape: 0, servitude_buy_freedom: 0,
        view_relationships: 0, manage_dynasty: 0,
        manage_fleet: 0, manage_house: 0, manage_property: 0, manage_colony: 0,

        // Light actions (1 AP)
        trade: 1, collect_goods: 1, donate: 1,
        pledge_allegiance: 1, renounce_allegiance: 1,
        form_kingdom: 6,
        bounty_board: 1, talk_locals: 1, request_meeting: 1,
        buy_house: 1, meet_people: 0,

        // Moderate actions (2 AP)
        pickpocket: 2, gambling: 0, smuggle: 0, // gambling/smuggle cost 2 AP per use inside their menus
        recruit: 2, cartography: 2, map_trade: 2, steal_map: 2,
        craft_campfire: 2, negotiate_indigenous: 2, preach: 2,

        // Half-day work (3 AP)
        forage: 3, busking: 3, meditate: 3,
        prospect: 3, tame_horse: 3, fish: 3, reforge_artifact: 3,

        // Full-day work (4 AP)
        odd_jobs: 4, hunt: 4, train_combat: 4,
        dig_treasure: 4, explore_poi: 4,

        // Major activities (5 AP)
        host_feast: 5, hold_tournament: 5, host_festival: 6, contract: 5,
        start_caravan: 5, ship_passage: 2, pilgrimage: 5,
        miracle: 5, tavern: 5,

        // Construction / Major operations (6 AP)
        build_property: 6, build_temple: 6, build_infrastructure: 6,
        build_cultural: 6, found_colony: 6, clear_trees: 6,
        demolish_infrastructure: 6, send_pioneers: 6,

        // Combat / Major ship operations (8 AP)
        attack_unit: 8, attack_settlement: 8,
        board_ship: 8, visit_shipyard: 1,

        // Title actions
        seek_title: 1, view_title_status: 0, resign_title: 1,
        collect_tax: 3, request_bounty: 1, capture_fugitive: 5, capture_criminal: 4,
        bless_settlement: 3, hold_council: 5,

        // Espionage actions
        espionage_menu: 0, manage_spies: 0,
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
        'build_property', 'build_temple', 'build_infrastructure', 'build_cultural',
        'start_caravan', 'tavern', 'miracle', 'ship_passage', 'terraform',
        'talk_locals', 'bounty_board', 'odd_jobs', 'busking',
        'donate', 'form_kingdom', 'host_feast', 'hold_tournament', 'host_festival',
        'found_colony', 'send_pioneers', 'negotiate_indigenous', 'recruit_settlers',
        'cartography', 'map_trade',
        'attack_unit', 'attack_settlement',
        'request_meeting', 'buy_house', 'seek_title', 'visit_shipyard',
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
    handleAction(game, tile, actionType, unitId) {
        ActionMenu.close();

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
            case 'explore_inner_map':
                ActionMenu.close();
                game.enterInnerMap(game.player.q, game.player.r);
                break;
            case 'disembark':
                ActionMenu.disembarkShip(game);
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
            case 'tavern':
                ActionMenu.showTavernMenu(game, tile);
                break;
            case 'talk_locals':
                ActionMenu.showTalkLocalsMenu(game, tile);
                break;
            case 'build_cultural':
                ActionMenu.showBuildCulturalMenu(game, tile);
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
            case 'donate':
                ActionMenu.showDonateMenu(game, tile);
                break;
            case 'pledge_allegiance':
                ActionMenu.doPledgeAllegiance(game, tile);
                break;
            case 'renounce_allegiance':
                ActionMenu.doRenounceAllegiance(game, tile);
                break;
            case 'form_kingdom':
                ActionMenu.showFormKingdomMenu(game, tile);
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

            // ── Espionage Actions ──
            case 'espionage_menu':
                ActionMenu.showEspionageMenu(game, tile);
                break;
            case 'manage_spies':
                ActionMenu.showManageSpiesMenu(game, tile);
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
                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:4px; letter-spacing:1px;">${prop.type === 'tavern' ? 'TOTAL EARNINGS' : 'STORAGE (OUTPUT)'}</div>
                     <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:24px; font-weight:bold;">${prop.type === 'tavern' ? (prop.storage || 0) + 'g' : prop.storage}</div>
                        ${prop.type !== 'tavern' ? `<button onclick="window.collectPropertyGoods()" ${prop.storage <= 0 ? 'disabled' : ''} style="padding:6px 12px; background:var(--gold); border:none; border-radius:4px; cursor:pointer; font-weight:bold; opacity:${prop.storage <= 0 ? 0.5 : 1}">Collect</button>` : ''}
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
                        ${(() => {
                            const allRecipes = (typeof Technology !== 'undefined') ? Technology.getUnlockedRecipes(game.player) : PlayerEconomy.RECIPES;
                            return Object.values(allRecipes).map(r => `
                            <option value="${r.id.toUpperCase()}" ${prop.activeRecipe === r.id.toUpperCase() ? 'selected' : ''}>
                                ${r.name} (${r.inputQty} ${PlayerEconomy.GOODS[r.input.toUpperCase()]?.name} ➔ ${r.outputQty} ${PlayerEconomy.GOODS[r.output.toUpperCase()]?.name})
                            </option>
                        `).join('');
                        })()}
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
            <div style="margin-bottom:24px; background:linear-gradient(135deg, rgba(139,69,19,0.15) 0%, rgba(80,40,10,0.2) 100%); padding:20px; border-radius:8px; border:1px solid rgba(255,215,0,0.3); box-shadow:0 4px 12px rgba(0,0,0,0.2);">
                <h4 style="margin:0 0 12px 0; color:#f4a460; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">🍻 Tavern Operations</h4>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:14px;">
                    <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px;">
                        <div style="font-size:11px; color:var(--text-secondary); margin-bottom:3px;">TODAY'S INCOME</div>
                        <div style="font-size:22px; font-weight:bold; color:#2ecc71;">${todayIncome}g</div>
                    </div>
                    <div style="background:rgba(0,0,0,0.3); padding:10px; border-radius:6px;">
                        <div style="font-size:11px; color:var(--text-secondary); margin-bottom:3px;">GAMBLING TABLES</div>
                        <div style="font-size:22px; font-weight:bold; color:var(--gold);">${tables} / ${maxTables}</div>
                    </div>
                </div>

                <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">Stock your tavern with beer and liquor to boost daily income. Each table adds +15% income.</div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:14px;">
                    <div style="background:rgba(0,0,0,0.25); padding:10px; border-radius:6px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <div style="font-size:12px;">🍺 Beer Stock: <strong>${beerStock}</strong></div>
                            <span style="font-size:10px; color:var(--text-muted);">-2/day</span>
                        </div>
                        <div style="font-size:11px; color:var(--text-secondary); margin-bottom:6px;">+30% income when stocked</div>
                        <div style="display:flex; gap:4px;">
                            <button onclick="window.stockTavern('beer', 5)" ${playerBeer < 5 ? 'disabled' : ''} style="flex:1; padding:4px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:3px; cursor:pointer; font-size:11px;">+5</button>
                            <button onclick="window.stockTavern('beer', 20)" ${playerBeer < 20 ? 'disabled' : ''} style="flex:1; padding:4px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:3px; cursor:pointer; font-size:11px;">+20</button>
                            <button onclick="window.stockTavern('beer', ${playerBeer})" ${playerBeer < 1 ? 'disabled' : ''} style="flex:1; padding:4px; background:var(--gold); border:none; color:black; border-radius:3px; cursor:pointer; font-size:11px; font-weight:bold;">All</button>
                        </div>
                        <div style="font-size:10px; color:var(--text-muted); margin-top:3px;">You have: ${playerBeer} beer</div>
                    </div>
                    <div style="background:rgba(0,0,0,0.25); padding:10px; border-radius:6px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <div style="font-size:12px;">🥃 Liquor Stock: <strong>${liquorStock}</strong></div>
                            <span style="font-size:10px; color:var(--text-muted);">-1/day</span>
                        </div>
                        <div style="font-size:11px; color:var(--text-secondary); margin-bottom:6px;">+20% income when stocked</div>
                        <div style="display:flex; gap:4px;">
                            <button onclick="window.stockTavern('liquor', 5)" ${playerLiquor < 5 ? 'disabled' : ''} style="flex:1; padding:4px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:3px; cursor:pointer; font-size:11px;">+5</button>
                            <button onclick="window.stockTavern('liquor', 10)" ${playerLiquor < 10 ? 'disabled' : ''} style="flex:1; padding:4px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:3px; cursor:pointer; font-size:11px;">+10</button>
                            <button onclick="window.stockTavern('liquor', ${playerLiquor})" ${playerLiquor < 1 ? 'disabled' : ''} style="flex:1; padding:4px; background:var(--gold); border:none; color:black; border-radius:3px; cursor:pointer; font-size:11px; font-weight:bold;">All</button>
                        </div>
                        <div style="font-size:10px; color:var(--text-muted); margin-top:3px;">You have: ${playerLiquor} liquor</div>
                    </div>
                </div>

                <button onclick="window.buyGamblingTable()" ${!canBuyTable ? 'disabled' : ''} 
                    style="width:100%; padding:10px; background:${canBuyTable ? 'var(--gold)' : '#555'}; border:none; border-radius:4px; cursor:pointer; font-weight:bold; color:${canBuyTable ? 'black' : '#888'}; font-size:13px;">
                    ${tables >= maxTables ? '🎲 Max Tables (upgrade to add more)' : `🎲 Add Gambling Table — ${tableCost}g`}
                </button>
            </div>
            `;
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
                            <button onclick="window.startCraftingParts()" ${!craftCheck.can ? 'disabled' : ''} style="padding:8px 14px; background:${craftCheck.can ? '#ff9800' : '#555'}; border:none; border-radius:4px; cursor:pointer; font-weight:bold; color:${craftCheck.can ? 'black' : '#888'};">
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
                        <button onclick="window.buildLabAction()" ${!labCheck.can ? 'disabled' : ''} style="padding:10px 20px; width:100%; background:${labCheck.can ? 'var(--gold)' : '#555'}; border:none; border-radius:4px; cursor:pointer; font-weight:bold; color:${labCheck.can ? 'black' : '#888'};">
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
            if (good.quantity <= 0) {
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); opacity: 0.4;">
                        <span>${good.icon} ${good.name}</span>
                        <span style="color: #e74c3c;">Sold Out</span>
                    </div>
                `;
            } else {
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <span>${good.icon} ${good.name}</span>
                        <span>${good.price} gold (${good.quantity} available)</span>
                        <button onclick="window.buyGood('${good.id}', ${good.price}, ${good.quantity})" style="padding: 4px 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">Buy</button>
                    </div>
                `;
            }
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
                    if (!ActionMenu.commitPendingAP(game)) return;
                    const result = Trading.buyGoods(game.player, good, qty, tile.settlement);
                    if (result.success) {
                        game.ui.showNotification('Purchase Complete', `Bought ${qty}x ${good.name} for ${result.spent} gold`, 'success');
                        // Discover economy knowledge through trade
                        if (tile.settlement.kingdom) {
                            game.player.learnAboutKingdom(tile.settlement.kingdom, 'economy');
                        }
                        // Trade Envoy — foreign trade counts as a mission
                        if (typeof Titles !== 'undefined' && game.player.currentTitle === 'trade_envoy' &&
                            tile.settlement.kingdom && tile.settlement.kingdom !== game.player.allegiance) {
                            const tradeResult = Titles.recordTradeMission(game.player);
                            if (tradeResult) {
                                game.ui.showNotification('📦 Trade Mission!', `Envoy duty complete (+${tradeResult.gold} gold bonus). Missions: ${tradeResult.count}`, 'success');
                            }
                        }
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
                if (!ActionMenu.commitPendingAP(game)) return;
                const result = Trading.sellGoods(game.player, goodId, qty);
                if (result.success) {
                    const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                    game.ui.showNotification('Sale Complete', `Sold ${qty}x ${good.name} for ${result.earned} gold`, 'success');
                    // Discover economy knowledge through trade
                    if (tile.settlement.kingdom) {
                        game.player.learnAboutKingdom(tile.settlement.kingdom, 'economy');
                    }
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

        for (const [key, unit] of Object.entries(PlayerMilitary.UNIT_TYPES)) {
            const avail = PlayerMilitary.isUnitAvailable(unit, settlement);
            if (avail.available) {
                html += `
                    <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div><span style="font-size: 20px;">${unit.icon}</span> <strong>${unit.name}</strong></div>
                                <div style="font-size: 12px; color: var(--text-secondary);">${unit.description}</div>
                                <div style="font-size: 12px;">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>
                            </div>
                            <button onclick="window.recruitUnit('${key}')" ${remaining <= 0 ? 'disabled' : ''} style="padding: 8px 16px; background: ${remaining > 0 ? 'var(--gold)' : '#555'}; border: none; border-radius: 4px; cursor: ${remaining > 0 ? 'pointer' : 'not-allowed'};">${unit.cost} gold</button>
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
                                <div style="font-size: 12px; color: var(--text-secondary);">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>
                            </div>
                            <span style="color: var(--text-secondary); font-size: 12px;">${unit.cost} gold</span>
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
                                    <div style="font-size: 12px;">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>
                                </div>
                                <button onclick="window.recruitTechUnit('${key}')" ${remaining <= 0 ? 'disabled' : ''} style="padding: 8px 16px; background: ${remaining > 0 ? 'var(--gold)' : '#555'}; border: none; border-radius: 4px; cursor: ${remaining > 0 ? 'pointer' : 'not-allowed'};">${unit.cost} gold</button>
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
                                    <div style="font-size: 12px; color: var(--text-secondary);">Strength: ${unit.strength} | Upkeep: ${unit.upkeep} gold/day</div>
                                </div>
                                <span style="color: var(--text-secondary); font-size: 12px;">${unit.cost} gold</span>
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

            if (game.player.gold < unit.cost) {
                game.ui.showNotification('Cannot Recruit', `Need ${unit.cost} gold`, 'error');
                return;
            }

            game.player.gold -= unit.cost;
            game.player._recruitedThisTurn = (game.player._recruitedThisTurn || 0) + 1;
            if (!game.player.army) game.player.army = [];
            game.player.army.push({
                type: unit.id,
                name: unit.name,
                icon: unit.icon,
                strength: unit.strength,
                upkeep: unit.upkeep,
                experience: 0,
                level: 1,
            });

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
        html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">';

        for (const [key, prop] of Object.entries(PlayerEconomy.PROPERTY_TYPES)) {
            const check = PlayerEconomy.canBuildProperty(game.player, key, tile, game.world);

            // Determine resource display
            let productionText = '';
            if (prop.id === 'mine') {
                productionText = tile.resource ? (PlayerEconomy.GOODS[tile.resource.id.toUpperCase()]?.name || tile.resource.id) : 'Tile resource';
            } else if (prop.id === 'trading_post') {
                productionText = 'Merchants';
            } else if (prop.id === 'tavern') {
                productionText = 'Gold (patrons)';
            } else {
                const good = PlayerEconomy.GOODS[prop.produces ? prop.produces.toUpperCase() : 'GOODS'];
                productionText = good ? good.name : (prop.produces || 'Recipes');
            }

            html += `
                <div style="padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; ${!check.canBuild ? 'opacity: 0.5;' : ''} display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
                            <span style="font-size: 18px;">${prop.icon}</span>
                            <strong style="font-size: 13px;">${prop.name}</strong>
                        </div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 3px;">${prop.description}</div>
                        <div style="font-size: 11px;">📦 ${productionText}${prop.id === 'tavern' ? ' · ~15-35g' : prop.id === 'trading_post' ? '' : ` · ${prop.productionRate}/day`}</div>
                        <div style="font-size: 11px; color: var(--gold);">🏗️ ${prop.constructionDays || 0} days</div>
                        ${!check.canBuild ? `<div style="font-size: 10px; color: #e74c3c; margin-top: 2px;">${check.reason}</div>` : ''}
                    </div>
                    <button onclick="window.buildProperty('${key}')" ${!check.canBuild ? 'disabled' : ''} style="margin-top: 5px; width: 100%; padding: 4px 0; background: var(--gold); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;">Build · ${prop.cost}g</button>
                </div>
            `;
        }

        html += '</div>'; // close grid

        // Show tech-unlocked buildings
        if (typeof Technology !== 'undefined') {
            const techBuildings = Technology.TECH_BUILDINGS;
            let techCards = '';
            let hasTechSection = false;
            for (const [key, prop] of Object.entries(techBuildings)) {
                const isUnlocked = prop.requiredTech && Technology.isImplemented(game.player, prop.requiredTech);
                if (!isUnlocked) continue;
                hasTechSection = true;

                // Simple build check for tech buildings
                const canAfford = game.player.gold >= prop.cost;
                const alreadyBuilt = tile.playerProperties && tile.playerProperties.find(p => p.type === prop.id);
                let canBuild = canAfford && !alreadyBuilt;
                let reason = '';
                if (!canAfford) reason = `Need ${prop.cost} gold`;
                if (alreadyBuilt) reason = 'Already built here';
                if (prop.requiredTerrain && !prop.requiredTerrain.includes(tile.terrain.id)) {
                    canBuild = false;
                    reason = `Requires ${prop.requiredTerrain.join(' or ')}`;
                }
                if (prop.requiredResource) {
                    if (!tile.resource || !prop.requiredResource.includes(tile.resource.id)) {
                        canBuild = false;
                        reason = `Requires ${prop.requiredResource.join(' or ')}`;
                    }
                }
                if (prop.requiredSettlement && !tile.settlement) {
                    canBuild = false;
                    reason = 'Requires settlement';
                }

                const productionText = prop.produces ? prop.produces : 'Special';

                techCards += `
                    <div style="padding: 8px; background: rgba(156, 39, 176, 0.06); border: 1px solid rgba(156, 39, 176, 0.2); border-radius: 4px; ${!canBuild ? 'opacity: 0.5;' : ''} display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
                                <span style="font-size: 18px;">${prop.icon}</span>
                                <strong style="font-size: 13px;">${prop.name}</strong>
                                <span style="font-size: 9px; color: #ce93d8; margin-left: auto;">TECH</span>
                            </div>
                            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 3px;">${prop.description}</div>
                            <div style="font-size: 11px;">📦 ${productionText} · ${prop.productionRate}/day</div>
                            <div style="font-size: 11px; color: var(--gold);">🏗️ ${prop.constructionDays || 0} days</div>
                            ${!canBuild && reason ? `<div style="font-size: 10px; color: #e74c3c; margin-top: 2px;">${reason}</div>` : ''}
                        </div>
                        <button onclick="window.buildTechBuilding('${key}')" ${!canBuild ? 'disabled' : ''} style="margin-top: 5px; width: 100%; padding: 4px 0; background: var(--gold); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;">Build · ${prop.cost}g</button>
                    </div>
                `;
            }
            if (hasTechSection) {
                html += '<div style="margin-top: 10px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">';
                html += '<div style="font-size: 10px; color: var(--gold); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">🔬 Tech-Unlocked</div>';
                html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">';
                html += techCards;
                html += '</div></div>';
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Build Property', html);

        window.currentBuildTile = tile;
        window.buildProperty = (propType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerEconomy.buildProperty(game.player, propType, tile, game.world);
            if (result.success) {
                if (result.underConstruction) {
                    game.ui.showNotification('🏗️ Construction Started!', `${result.property.name} is under construction — ${result.constructionDays} days to completion.`, 'info');
                } else {
                    game.ui.showNotification('Property Built!', `${result.property.name} is now operational`, 'success');
                }
                game.ui.updateStats(game.player, game.world);
                ActionMenu.close();
            } else {
                game.ui.showNotification('Cannot Build', result.reason, 'error');
            }
        };

        window.buildTechBuilding = (buildingKey) => {
            const building = Technology.TECH_BUILDINGS[buildingKey];
            if (!building) return;
            if (!ActionMenu.commitPendingAP(game)) return;
            if (game.player.gold < building.cost) {
                game.ui.showNotification('Cannot Build', `Need ${building.cost} gold`, 'error');
                return;
            }

            game.player.gold -= building.cost;

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
                underConstruction: (building.constructionDays || 0) > 0,
                constructionDaysLeft: building.constructionDays || 0,
                constructionDaysTotal: building.constructionDays || 0,
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

            // Place property on inner map
            if (typeof InnerMap !== 'undefined') {
                InnerMap.placePropertyOnInnerMap(tile, newProperty, tile.q, tile.r);
            }

            game.ui.showNotification('🏗️ Construction Started!', `${building.name} is under construction — ${building.constructionDays || 0} days to completion.`, 'info');
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
        html += '<h4 style="margin-top: 0;">Build Infrastructure</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Improve the land with roads, bridges, and irrigation.</p>';

        if (tile.infrastructure) {
            const constructionNote = tile.infrastructure.underConstruction
                ? ` <span style="color: #e0a040; font-size: 11px;">🔨 Under construction (${tile.infrastructure.constructionDaysLeft} day${tile.infrastructure.constructionDaysLeft > 1 ? 's' : ''} left)</span>`
                : '';
            html += `<div style="padding: 8px; margin-bottom: 12px; background: rgba(255,255,255,0.08); border-radius: 4px; border-left: 3px solid var(--gold);">
                <span style="font-size: 16px;">${tile.infrastructure.icon}</span> Current: <strong>${tile.infrastructure.name}</strong>${constructionNote}
            </div>`;
        }

        if (available.length === 0) {
            html += '<p style="color: var(--text-secondary);">No infrastructure can be built here. Research more technologies or try a different terrain.</p>';
        }

        for (const infra of available) {
            const isUpgrade = infra.upgradesFrom && tile.infrastructure && tile.infrastructure.id === infra.upgradesFrom;
            const buildDays = infra.buildTime || 0;
            const buildTimeLabel = buildDays > 0 ? `<span style="font-size: 11px; color: #e0a040;">⏱ ${buildDays} day${buildDays > 1 ? 's' : ''}</span>` : '<span style="font-size: 11px; color: #4CAF50;">⚡ Instant</span>';
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${infra.icon}</span> <strong>${infra.name}</strong>${isUpgrade ? ' <span style="color: var(--gold); font-size: 11px;">⬆ UPGRADE</span>' : ''} ${buildTimeLabel}</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${infra.description}</div>
                        </div>
                        <button onclick="window.buildInfra('${infra.id.toUpperCase()}')" style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">${infra.actualCost} gold</button>
                    </div>
                </div>
            `;
        }

        // Show all locked types for awareness
        for (const [key, infra] of Object.entries(Infrastructure.TYPES)) {
            if (available.find(a => a.id === infra.id)) continue;
            const check = Infrastructure.canBuild(game.player, key, tile, game.world);
            if (!check.can) {
                html += `
                    <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.02); border-radius: 4px; opacity: 0.4;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div><span style="font-size: 20px;">${infra.icon}</span> <strong>${infra.name}</strong> 🔒</div>
                                <div style="font-size: 11px; color: #e74c3c;">${check.reason}</div>
                            </div>
                            <span style="color: var(--text-secondary); font-size: 12px;">${infra.cost} gold</span>
                        </div>
                    </div>
                `;
            }
        }

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

        const result = Infrastructure.demolish(game.player, tile);
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

        const allTenets = [
            { id: 'Peace',       icon: '☮️', desc: 'Seek harmony, avoid violence' },
            { id: 'Charity',     icon: '🤲', desc: 'Give to the poor and needy' },
            { id: 'Wisdom',      icon: '📖', desc: 'Pursue knowledge and truth' },
            { id: 'Justice',     icon: '⚖️', desc: 'Uphold law and punish the wicked' },
            { id: 'Valor',       icon: '⚔️', desc: 'Fight bravely for the righteous' },
            { id: 'Humility',    icon: '🙇', desc: 'Live simply, reject vanity' },
            { id: 'Prosperity',  icon: '🌾', desc: 'Bless the industrious with abundance' },
            { id: 'Nature',      icon: '🌿', desc: 'Revere the natural world' },
            { id: 'Sovereignty', icon: '👑', desc: 'Divine right of the faithful to rule' },
            { id: 'Mysticism',   icon: '🔮', desc: 'Seek the hidden mysteries of the cosmos' },
        ];

        let selectedTenets = ['Peace', 'Charity', 'Wisdom']; // defaults
        let religionName = '';

        const render = () => {
            let html = '<div style="max-width: 500px; text-align: left;">';
            html += '<h4 style="margin: 0 0 6px; text-align: center;">⛪ Found a Religion</h4>';
            html += `<p style="font-size: 12px; color: var(--text-secondary); text-align: center; margin-bottom: 16px;">
                        Establish a new faith and spread it across the land.<br>
                        <span style="color: var(--gold);">Requires: 10 karma (you have ${karma})</span>
                     </p>`;

            if (karma < 10) {
                html += `<div style="text-align: center; padding: 24px; color: var(--text-muted);">
                    <div style="font-size: 36px; margin-bottom: 8px;">🙏</div>
                    <div style="font-size: 14px; color: #e74c3c;">You need at least 10 karma to found a religion.</div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Current karma: ${karma}</div>
                    <button onclick="game.ui.hideCustomPanel();"
                        style="margin-top: 16px; padding: 8px 24px; background: none; border: 1px solid rgba(255,255,255,0.1);
                               border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">Close</button>
                </div></div>`;
                return html;
            }

            // Name input
            html += `<div style="margin-bottom: 16px;">
                <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Religion Name</label>
                <input id="frNameInput" type="text" maxlength="30" placeholder="e.g. The Order of Light"
                    value="${religionName.replace(/"/g, '&quot;')}"
                    oninput="window._frUpdateName(this.value)"
                    style="width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
                           border-radius: 8px; color: var(--text-primary); font-size: 14px; font-family: var(--font-display);
                           outline: none; box-sizing: border-box; transition: border-color 0.2s;"
                    onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='rgba(255,255,255,0.12)'">
            </div>`;

            // Tenets selection
            html += `<div style="margin-bottom: 16px;">
                <label style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 6px;">
                    Choose 3 Tenets <span style="color: var(--text-muted);">(${selectedTenets.length}/3 selected)</span>
                </label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">`;

            for (const tenet of allTenets) {
                const isSelected = selectedTenets.includes(tenet.id);
                const borderCol = isSelected ? 'var(--gold)' : 'rgba(255,255,255,0.08)';
                const bgCol = isSelected ? 'rgba(245,197,66,0.1)' : 'rgba(255,255,255,0.03)';
                const checkmark = isSelected ? '✓ ' : '';
                html += `<button onclick="window._frToggleTenet('${tenet.id}')"
                    style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; text-align: left;
                           background: ${bgCol}; border: 1px solid ${borderCol}; border-radius: 8px;
                           cursor: pointer; color: var(--text-primary); transition: all 0.15s;"
                    onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background='${bgCol}'">
                    <span style="font-size: 18px; flex-shrink: 0;">${tenet.icon}</span>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 12px; font-weight: 600; color: ${isSelected ? 'var(--gold)' : 'var(--text-primary)'};">${checkmark}${tenet.id}</div>
                        <div style="font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${tenet.desc}</div>
                    </div>
                </button>`;
            }

            html += '</div></div>';

            // Preview
            if (religionName.trim()) {
                const tenetList = selectedTenets.length > 0 ? selectedTenets.join(', ') : 'None';
                html += `<div style="padding: 10px 12px; background: rgba(245,197,66,0.05); border: 1px solid rgba(245,197,66,0.15); border-radius: 8px; margin-bottom: 16px;">
                    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Preview</div>
                    <div style="font-size: 15px; font-family: var(--font-display); color: var(--gold);">⛪ ${religionName.trim()}</div>
                    <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Tenets: ${tenetList}</div>
                </div>`;
            }

            // Action buttons
            const canFound = religionName.trim().length > 0 && selectedTenets.length === 3;
            html += `<div style="display: flex; gap: 10px; justify-content: center;">
                <button onclick="game.ui.hideCustomPanel();"
                    style="padding: 10px 24px; background: none; border: 1px solid rgba(255,255,255,0.1);
                           border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 13px;">
                    Cancel
                </button>
                <button onclick="window._frConfirm()" ${canFound ? '' : 'disabled'}
                    style="padding: 10px 28px; background: ${canFound ? 'linear-gradient(135deg, var(--gold), #d4a030)' : 'rgba(255,255,255,0.05)'};
                           color: ${canFound ? '#1a1a2e' : 'var(--text-muted)'}; border: none; border-radius: 6px;
                           cursor: ${canFound ? 'pointer' : 'not-allowed'}; font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;
                           transition: all 0.15s;"
                    ${canFound ? 'onmouseenter="this.style.transform=\'scale(1.03)\'" onmouseleave="this.style.transform=\'scale(1)\'"' : ''}>
                    ⛪ Found Religion
                </button>
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

            const result = PlayerReligion.foundReligion(game.player, name, selectedTenets);
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
        html += '<h4 style="margin-top: 0;">Build Religious Building</h4>';

        for (const [key, building] of Object.entries(PlayerReligion.BUILDING_TYPES)) {
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${building.icon}</span> <strong>${building.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${building.description}</div>
                            <div style="font-size: 12px;">Faith: +${building.faithGain}/day | Radius: ${building.influenceRadius}</div>
                            <div style="font-size: 11px; color: var(--gold);">🏗️ Build time: ${building.constructionDays || 0} days</div>
                        </div>
                        <button onclick="window.buildTemple('${key}')" style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer;">${building.cost} gold</button>
                    </div>
                </div>
            `;
        }

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
            if (!ActionMenu.commitPendingAP(game)) return;
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

        poi.explored = true;
        const player = game.player;
        if (!player.inventory) player.inventory = {};

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
                case 'item':
                    player.inventory[reward.id] = (player.inventory[reward.id] || 0) + reward.amount;
                    rewardLines.push(`<div style="color: #3498db;">${reward.icon} +${reward.amount} ${reward.name}</div>`);
                    break;
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
                    player.stamina = Math.min(player.maxStamina, player.stamina + reward.amount);
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

        html += `<button onclick="game.ui.hideCustomPanel()" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-family: var(--font-body); color: #1a1a2e;">Continue</button>`;
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
        if (!game.player.inventory) game.player.inventory = {};
        game.player.inventory.wood = (game.player.inventory.wood || 0) + woodAmount;

        // Change terrain to grassland
        tile.terrain = Terrain.TYPES.GRASSLAND;

        // Remove any forest-specific resource
        if (tile.resource && ['wood', 'timber'].includes(tile.resource.id)) {
            tile.resource = null;
        }

        game.ui.showNotification('Trees Cleared', `+${woodAmount} 🌲 Wood — the land is now open grassland.`, 'success');
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
        html += `
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 48px; margin-bottom: 8px;">⛰️ → 🌿</div>
                <div style="font-size: 14px; color: var(--text-secondary);">Flatten <strong style="color: white;">${terrainName}</strong> into <strong style="color: #88aa55;">Grassland</strong></div>
            </div>

            <div style="background: rgba(255,255,255,0.05); padding: 14px; border-radius: 6px; margin-bottom: 12px;">
                <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Your workers will level the terrain, removing rocky outcrops and evening the land for farming or building.</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px;">
                        <div style="font-size: 11px; color: var(--text-muted);">COST</div>
                        <div style="font-size: 16px; font-weight: bold; color: ${canAfford ? 'var(--gold)' : '#e74c3c'};">${cost}g</div>
                        <div style="font-size: 10px; color: var(--text-muted);">You have: ${game.player.gold}g</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px;">
                        <div style="font-size: 11px; color: var(--text-muted);">AP COST</div>
                        <div style="font-size: 16px; font-weight: bold; color: ${hasAP ? '#3498db' : '#e74c3c'};">${apCost} AP</div>
                        <div style="font-size: 10px; color: var(--text-muted);">You have: ${game.player.actionPoints || 0} AP</div>
                    </div>
                </div>
            </div>

            <div style="background: rgba(46,204,113,0.1); padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid rgba(46,204,113,0.2);">
                <div style="font-size: 12px; color: #2ecc71;">📦 You'll recover ~${stoneYield} stone from the excavation</div>
            </div>

            ${hasResource ? `<div style="background: rgba(231,76,60,0.1); padding: 10px; border-radius: 6px; margin-bottom: 12px; border: 1px solid rgba(231,76,60,0.2);">
                <div style="font-size: 12px; color: #e74c3c;">${resourceWarning}</div>
            </div>` : ''}

            <div style="font-size: 11px; color: var(--text-muted); text-align: center; margin-bottom: 12px;">Mountains and highlands cannot be terraformed.</div>

            <button id="terraformBtn" onclick="window.doTerraform(${stoneYield})" ${!canTerraform ? 'disabled' : ''}
                style="width: 100%; padding: 12px; background: ${canTerraform ? 'var(--gold)' : '#555'}; border: none; border-radius: 6px; 
                       cursor: ${canTerraform ? 'pointer' : 'not-allowed'}; font-weight: bold; font-size: 14px; 
                       color: ${canTerraform ? 'black' : '#888'};">
                ${!canAfford ? 'Not Enough Gold' : !hasAP ? 'Not Enough AP' : '⛏️ Terraform — Flatten Hills'}
            </button>
        `;
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
            if (!game.player.inventory) game.player.inventory = {};
            game.player.inventory.stone = (game.player.inventory.stone || 0) + stoneAmount;

            // Remove resource if present
            if (tile.resource) {
                tile.resource = null;
            }

            // Change terrain to grassland
            tile.terrain = Terrain.TYPES.GRASSLAND;

            // Update elevation to match (grassland level)
            tile.elevation = Math.min(tile.elevation, 0.50);

            game.ui.showNotification('⛏️ Land Terraformed!', `The hills have been flattened to grassland. +${stoneAmount} stone recovered.`, 'success');
            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
            game.endDay();
        };
    },

    /**
     * Show tavern menu — full options in a city tavern
     */
    showTavernMenu(game, tile) {
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
                <button onclick="game.ui.hideCustomPanel()"
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
                <button onclick="game.ui.hideCustomPanel()"
                    style="width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px; cursor: pointer; color: white; font-family: var(--font-body);">
                    Close
                </button>
            </div>
        `;

        html += '</div>';
        game.ui.showCustomPanel('📖 Intel Journal', html);
    },

    // ─────────────────────────────────────────────
    // CULTURAL BUILDINGS
    // ─────────────────────────────────────────────

    /**
     * Show build cultural building menu
     */
    showBuildCulturalMenu(game, tile) {
        if (typeof Culture === 'undefined') return;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">Build Cultural Building</h4>';

        for (const [key, building] of Object.entries(Culture.BUILDING_TYPES)) {
            const canBuild = (() => {
                if (game.player.gold < building.cost) return 'Not enough gold';
                if (building.requiredSettlement && !tile.settlement) return 'Requires a settlement';
                if (building.requiredPopulation && tile.settlement && tile.settlement.population < building.requiredPopulation)
                    return `Needs ${building.requiredPopulation}+ population`;
                if (tile.culturalBuilding || tile.playerProperty || tile.religiousBuilding) return 'Tile occupied';
                return null;
            })();

            const disabled = canBuild ? 'opacity: 0.5; pointer-events: none;' : '';
            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; ${disabled}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div><span style="font-size: 20px;">${building.icon}</span> <strong>${building.name}</strong></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${building.description}</div>
                            <div style="font-size: 12px;">
                                Influence: +${building.influencePerDay}/day | Radius: ${building.influenceRadius}
                                ${building.researchBonus ? ` | Research: +${Math.round(building.researchBonus * 100)}%` : ''}
                                ${building.moraleBonus ? ` | Morale: +${building.moraleBonus}` : ''}
                                ${building.renownPerDay ? ` | Renown: +${building.renownPerDay}/day` : ''}
                            </div>
                            <div style="font-size: 11px; color: var(--gold);">🏗️ ${building.constructionDays || 0} days</div>
                            ${canBuild ? `<div style="font-size: 11px; color: #e74c3c; margin-top: 4px;">${canBuild}</div>` : ''}
                        </div>
                        <button onclick="window._buildCultural('${key}')" 
                            style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; ${disabled}"
                            ${canBuild ? 'disabled' : ''}>${building.cost} gold</button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('📚 Cultural Buildings', html);

        window._buildCultural = (buildingType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = Culture.buildCulturalBuilding(game.player, buildingType, tile, game.world);
            if (result.success) {
                if (result.underConstruction) {
                    game.ui.showNotification('🏗️ Construction Started!', `${result.building.icon} ${result.building.name} is under construction — ${result.constructionDays} days to completion.`, 'info');
                } else {
                    game.ui.showNotification('Building Constructed!', `${result.building.icon} ${result.building.name} will spread knowledge and influence`, 'success');
                }
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Build', result.reason, 'error');
            }
        };
    },

    // ─────────────────────────────────────────────
    // PILGRIMAGE / HOLY SITES
    // ─────────────────────────────────────────────

    /**
     * Visit a holy site (pilgrimage)
     */
    visitHolySite(game, tile) {
        if (typeof Religion === 'undefined' || !tile.holySite) return;

        const site = tile.holySite;
        const faith = site.faithId ? Religion.FAITHS[site.faithId] : null;

        let html = '<div>';
        html += `
            <div style="text-align: center; padding: 16px 0;">
                <div style="font-size: 48px;">${site.icon}</div>
                <h3 style="margin: 8px 0; color: var(--gold);">${site.name}</h3>
                <p style="font-size: 13px; color: var(--text-secondary);">${site.description}</p>
                ${faith ? `<div style="margin-top: 8px; font-size: 12px;">${faith.icon} Associated with: <strong>${faith.name}</strong></div>` : ''}
                ${site.controller ? `<div style="margin-top: 4px; font-size: 12px;">Controlled by: <strong>${game.world.getKingdom(site.controller)?.name || 'Unknown'}</strong></div>` : '<div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">Unclaimed holy site</div>'}
            </div>
            <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-bottom: 12px;">
                <div style="font-size: 13px; margin-bottom: 8px;"><strong>Pilgrimage Rewards:</strong></div>
                <div style="font-size: 12px;">💰 Gold reward • ☯ Karma • ⭐ Renown • 🙏 Faith</div>
                ${site.bonusType === 'healing' ? '<div style="font-size: 12px; color: #27ae60; margin-top: 4px;">💚 Special: Healing waters restore health</div>' : ''}
            </div>
            <button onclick="window._completePilgrimage()" 
                style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold;">
                🙏 Complete Pilgrimage
            </button>
        `;
        html += '</div>';

        game.ui.showCustomPanel('⛲ Holy Site', html);

        window._completePilgrimage = () => {
            const result = Religion.completePilgrimage(game.player, tile, game.world);
            if (result.success) {
                game.ui.showNotification('Pilgrimage Complete!',
                    `${result.siteName}: +${result.goldReward} gold, +${result.karmaGained} karma, +${result.renownGained} renown${result.healed ? ', health restored!' : ''}`,
                    'success'
                );
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Complete', result.reason, 'error');
            }
        };
    },

    /**
     * Post bail to get out of jail
     */
    postBail(game) {
        const player = game.player;
        if (!player.jailState) return;
        const bail = player.jailState.bailCost;
        if (player.gold < bail) {
            game.ui.showNotification('Cannot Post Bail', `You need ${bail} gold (have ${player.gold}).`, 'error');
            return;
        }
        player.gold -= bail;
        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.bail = (player.financeToday.expenses.bail || 0) + bail;
        }
        const settlement = player.jailState.settlement;
        player.jailState = null;
        player.stamina = player.maxStamina;
        player.movementRemaining = player.maxStamina;
        game.ui.showNotification('💰 Bail Posted', `You paid ${bail} gold and were released from jail in ${settlement}.`, 'success');
        game.ui.updateStats(player, game.world);
    },

    /**
     * Attempt to escape from jail
     */
    attemptJailbreak(game) {
        const player = game.player;
        if (!player.jailState) return;
        const jail = player.jailState;
        const roll = Math.random();

        if (roll < (jail.escapeChance || 0.1)) {
            // Successful jailbreak
            const settlement = jail.settlement;
            player.jailState = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            player.karma = (player.karma || 0) - 2;
            // Stealth skill up
            if (player.skills) {
                player.skills.stealth = Math.min((player.skills.stealth || 1) + 0.5, 10);
            }
            // Major reputation hit — you're a fugitive
            const tile = game.world.getTile(player.q, player.r);
            if (tile?.settlement?.kingdom && player.reputation) {
                player.reputation[tile.settlement.kingdom] = (player.reputation[tile.settlement.kingdom] || 0) - 10;
            }
            game.ui.showNotification('🏃 Jailbreak!', `You escaped from jail in ${settlement}! -2 karma, -10 reputation.`, 'success');
        } else {
            // Failed jailbreak — more time
            const addedDays = Utils.randInt(2, 5);
            jail.daysRemaining += addedDays;
            jail.totalDays += addedDays;
            jail.escapeChance = Math.max(0.03, (jail.escapeChance || 0.1) - 0.02);
            player.health = Math.max(10, player.health - Utils.randInt(3, 10));
            game.ui.showNotification('❌ Jailbreak Failed', `The guards caught you! +${addedDays} days added to your sentence. You were roughed up.`, 'error');
        }
        game.ui.updateStats(player, game.world);
    },

    /**
     * Attempt to escape indentured servitude
     */
    attemptServitudeEscape(game) {
        const result = PlayerMilitary.attemptEscape(game.player);
        if (result.success) {
            game.ui.showNotification('Escaped!', result.message, 'success');
        } else {
            game.ui.showNotification('Escape Failed!', result.message, 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Buy freedom from indentured servitude
     */
    buyFreedom(game) {
        const result = PlayerMilitary.buyFreedom(game.player);
        if (result.success) {
            game.ui.showNotification('Freedom Bought!', result.message, 'success');
        } else {
            game.ui.showNotification('Cannot Buy Freedom', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    // ── RECRUIT SETTLERS MENU ──────────────────────────

    /**
     * Show the recruit settlers menu at a foreign settlement
     */
    showRecruitSettlersMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const sourcePop = tile.settlement.population;
        const maxRecruit = Math.max(1, Math.floor(sourcePop * 0.02));

        // Get player colonies that need settlers
        const colonies = (player.colonies || []).map(c => {
            const ct = world.getTile(c.q, c.r);
            if (!ct || !ct.settlement) return null;
            const pop = ct.settlement.population;
            const enRoute = ct.settlement.colony?.recruitment?.enRoute || 0;
            return { ...c, pop, enRoute, tile: ct };
        }).filter(c => c && c.pop < 50);

        if (colonies.length === 0) {
            game.ui.showNotification('No Colonies', 'You have no colonies that need settlers.', 'info');
            return;
        }

        let html = '<div style="max-width: 520px;">';
        html += '<h4 style="margin-top: 0;">📢 Recruit Settlers</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Convince people from <strong>${tile.settlement.name}</strong> (pop. ${sourcePop}) to move to your settlement.</p>`;
        html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">Max recruitable: ${maxRecruit} people (2% of population) | Cost: 2 AP per attempt</p>`;

        // Colony selection
        if (colonies.length > 1) {
            html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Send settlers to:</div>';
            html += '<div style="display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap;">';
            colonies.forEach((c, i) => {
                html += `<button onclick="window._selectTargetColony(${i})" id="colSel_${i}"
                    style="padding: 6px 12px; background: ${i === 0 ? 'rgba(245,197,66,0.15)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${i === 0 ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}; border-radius: 6px; cursor: pointer; color: var(--text-primary); font-size: 12px;">
                    ${c.name} (${c.pop} settlers${c.enRoute > 0 ? `, ${c.enRoute} en route` : ''})
                </button>`;
            });
            html += '</div>';
        } else {
            html += `<div style="padding: 8px 12px; background: rgba(245,197,66,0.08); border-radius: 6px; border-left: 3px solid var(--gold); margin-bottom: 16px; font-size: 12px;">
                        Destination: <strong style="color: var(--gold);">${colonies[0].name}</strong> (${colonies[0].pop} settlers${colonies[0].enRoute > 0 ? `, ${colonies[0].enRoute} en route` : ''})
                     </div>`;
        }

        // Recruitment methods
        const methods = [
            { id: 'persuade', name: 'Spread the Word', icon: '🗣️', desc: 'Persuade people with tales of opportunity. Free but limited by charisma.', costLabel: 'Free', color: '#2ecc71' },
            { id: 'hire', name: 'Hire Settlers', icon: '💰', desc: `Pay workers to relocate. ${maxRecruit * 15}g for ${maxRecruit} settlers.`, costLabel: `${maxRecruit * 15}g`, color: '#f5c542' },
            { id: 'promise', name: 'Promise Prosperity', icon: '✨', desc: 'Make grand promises of wealth and land. Effective but slightly dubious.', costLabel: 'Free (−1 karma)', color: '#9b59b6' },
        ];

        html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">How will you recruit?</div>';
        for (const m of methods) {
            const disabled = m.id === 'hire' && player.gold < maxRecruit * 15;
            html += `
                <button onclick="window._recruitSettlers('${m.id}')" ${disabled ? 'disabled' : ''}
                    style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 6px;
                           background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid ${m.color};
                           border-radius: 6px; cursor: ${disabled ? 'not-allowed' : 'pointer'}; text-align: left;
                           color: var(--text-primary); transition: all 0.15s; ${disabled ? 'opacity: 0.4;' : ''}"
                    onmouseenter="if(!this.disabled) this.style.background='rgba(255,255,255,0.08)'"
                    onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                    <span style="font-size: 24px;">${m.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 13px;">${m.name}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${m.desc}</div>
                    </div>
                    <span style="font-size: 12px; color: ${m.color}; font-weight: bold; white-space: nowrap;">${m.costLabel}</span>
                </button>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('📢 Recruit Settlers', html);

        let selectedColonyIdx = 0;

        window._selectTargetColony = (idx) => {
            selectedColonyIdx = idx;
            colonies.forEach((_, i) => {
                const btn = document.getElementById('colSel_' + i);
                if (btn) {
                    btn.style.background = i === idx ? 'rgba(245,197,66,0.15)' : 'rgba(255,255,255,0.05)';
                    btn.style.borderColor = i === idx ? 'var(--gold)' : 'rgba(255,255,255,0.1)';
                }
            });
        };

        window._recruitSettlers = (method) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const target = colonies[selectedColonyIdx];
            if (!target) return;

            const result = Colonization.recruitSettlers(player, tile, target.tile, world, maxRecruit, method);
            if (result.success) {
                game.ui.showNotification('📢 Settlers Recruited!',
                    `${result.recruited} people will head to ${result.colonyName}! (${result.enRoute} en route, ${result.goldSpent}g spent)`, 'success');
                game.ui.updateStats(game.player, game.world);
                // Refresh
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Recruit', result.reason, 'error');
            }
        };
    },

    /**
     * Post a signboard at player colony
     */
    doPostSignboard(game, tile) {
        const result = Colonization.postSignboard(game.player, tile);
        if (result.success) {
            game.ui.showNotification('🪧 Signboard Posted', `A signboard now advertises ${tile.settlement.name} to passing travelers.`, 'success');
        } else {
            game.ui.showNotification('Cannot Post', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show colony founding menu
     */
    showFoundColonyMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const q = player.q;
        const r = player.r;

        // Check for nearby indigenous
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, q, r, 3);
        let indigenousWarning = '';
        if (nearbyIndigenous.length > 0) {
            const names = nearbyIndigenous.map(i => i.tribeName).join(', ');
            indigenousWarning = `<p style="color:#e8a040;">⚠️ Nearby indigenous: ${names}</p>`;
        }

        // Distance from capital
        const capitalTile = world.getAllSettlements().find(s => s.kingdom === player.kingdom && s.type === 'capital');
        let distInfo = '';
        if (capitalTile) {
            const dist = Hex.wrappingDistance(q, r, capitalTile.q, capitalTile.r, world.width);
            const penalty = Colonization.getDistancePenalty(world, world.kingdoms.find(k => k.id === player.kingdom), q, r);
            distInfo = `<p>Distance from capital: <b>${dist}</b> hexes (loyalty penalty: <span style="color:${penalty > 15 ? '#ff6666' : '#aaffaa'}">-${penalty.toFixed(1)}</span>)</p>`;
        }

        // Policy options
        let policyHtml = '';
        for (const [id, policy] of Object.entries(Colonization.POLICIES)) {
            policyHtml += `
                <label style="display:block; margin:6px 0; cursor:pointer; padding:6px; border:1px solid #555; border-radius:4px;" 
                       onclick="document.querySelectorAll('.colony-policy-opt').forEach(e=>e.style.borderColor='#555');this.style.borderColor='#4CAF50';document.getElementById('selectedPolicy').value='${id}'">
                    <b>${policy.name}</b><br>
                    <small style="color:#aaa;">${policy.desc}</small><br>
                    <small>Expansion: +${(policy.expansionBonus * 100).toFixed(0)}% | Loyalty: +${policy.loyaltyBonus} | Production: +${(policy.productionBonus * 100).toFixed(0)}%</small>
                </label>`;
        }

        let html = `
            <div style="max-height:450px; overflow-y:auto;">
                <p>Establish a frontier colony here for <b>${Colonization.COLONY_COST} gold</b>.</p>
                <p>Your gold: <b>${player.gold.toFixed(0)}</b></p>
                ${distInfo}
                ${indigenousWarning}
                <hr style="border-color:#555;">
                <p><b>Colony Name:</b></p>
                <input type="text" id="colonyNameInput" value="${Kingdom.generateCityName('Imperial')}" 
                       style="width:100%; padding:4px; background:#333; color:#fff; border:1px solid #666; border-radius:4px;">
                <hr style="border-color:#555;">
                <p><b>Colonization Policy:</b></p>
                <input type="hidden" id="selectedPolicy" value="manifest_destiny">
                <div class="colony-policy-opt">${policyHtml}</div>
                <hr style="border-color:#555;">
                <button onclick="ActionMenu.executeFoundColony(game, ${q}, ${r})" 
                        style="width:100%; padding:8px; background:#4CAF50; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:14px;">
                    🏴 Found Colony (${Colonization.COLONY_COST}g)
                </button>
            </div>`;

        game.ui.showCustomPanel('Found Colony', html);
    },

    /**
     * Execute colony founding
     */
    executeFoundColony(game, q, r) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(q, r);
        const name = document.getElementById('colonyNameInput')?.value || 'New Colony';
        const policyId = document.getElementById('selectedPolicy')?.value || 'manifest_destiny';

        const result = Colonization.foundPlayerColony(player, tile, world, q, r, name, policyId);
        if (result.success) {
            game.ui.showNotification('Colony Founded!', `${name} has been established as your frontier colony!`, 'success');
            game.endDay();
        } else {
            game.ui.showNotification('Cannot Found Colony', result.reason || 'Requirements not met', 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show send pioneers menu — pick a target from map
     */
    showSendPioneersMenu(game, tile) {
        const player = game.player;
        const world = game.world;

        // Find suitable wilderness targets
        const targets = [];
        for (let attempt = 0; attempt < 100; attempt++) {
            const tq = Utils.randInt(0, world.width - 1);
            const tr = Utils.randInt(5, world.height - 6);
            const t = world.getTile(tq, tr);
            if (t && t.terrain.passable && !t.settlement) {
                const dist = Hex.wrappingDistance(player.q, player.r, tq, tr, world.width);
                if (dist > 8 && dist < 30) {
                    const score = Colonization.getWildernessScore(t, world, tq, tr);
                    if (score > 0) {
                        targets.push({ q: tq, r: tr, dist, score, terrain: t.terrain.name });
                    }
                }
            }
        }

        // Sort by score descending and take top 5
        targets.sort((a, b) => b.score - a.score);
        const best = targets.slice(0, 5);

        if (best.length === 0) {
            game.ui.showNotification('No Targets', 'No suitable wilderness for pioneers found nearby.', 'default');
            return;
        }

        let html = '<div style="max-height:400px; overflow-y:auto;">';
        html += '<p>Send a pioneering party to settle a distant region. Cost: <b>200 gold</b></p>';
        html += '<p>Choose a target region:</p>';

        for (const target of best) {
            const hasIndigenous = Colonization.getNearbyIndigenous(world, target.q, target.r, 2).length > 0;
            html += `
                <div style="padding:8px; margin:4px 0; border:1px solid #555; border-radius:4px; cursor:pointer;"
                     onclick="ActionMenu.executeSendPioneers(game, ${target.q}, ${target.r})"
                     onmouseover="this.style.borderColor='#4CAF50'" onmouseout="this.style.borderColor='#555'">
                    <b>${target.terrain}</b> — Distance: ${target.dist} hexes
                    ${hasIndigenous ? '<span style="color:#e8a040;"> ⚠️ Indigenous nearby</span>' : ''}
                    <br><small>Suitability: ${'⭐'.repeat(Math.min(5, Math.ceil(target.score / 2)))}</small>
                </div>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Send Pioneers', html);
    },

    /**
     * Execute sending pioneers
     */
    executeSendPioneers(game, targetQ, targetR) {
        const player = game.player;
        const world = game.world;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (player.gold < 200) {
            game.ui.showNotification('Not Enough Gold', 'You need 200 gold to send pioneers.', 'error');
            return;
        }

        const result = Colonization.sendPioneerParty(player, world, targetQ, targetR);
        if (result.success) {
            game.ui.showNotification('Pioneers Dispatched!', result.message || 'A pioneering party has set out to settle new lands!', 'success');
            game.ui.hideCustomPanel();
        } else {
            game.ui.showNotification('Cannot Send Pioneers', result.reason || 'Failed to dispatch pioneers.', 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show colony management menu
     */
    showManageColonyMenu(game, tile) {
        const colony = tile.settlement.colony;
        if (!colony) return;

        const world = game.world;
        const player = game.player;
        const capitalTile = world.getAllSettlements().find(s => s.kingdom === player.kingdom && s.type === 'capital');
        let dist = 0;
        if (capitalTile) {
            dist = Hex.wrappingDistance(tile.q, tile.r, capitalTile.q, capitalTile.r, world.width);
        }

        const policy = Colonization.POLICIES[colony.policy] || Colonization.POLICIES.manifest_destiny;
        const loyaltyColor = colony.loyalty > 60 ? '#4CAF50' : colony.loyalty > 30 ? '#e8a040' : '#ff4444';
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, tile.q, tile.r, 3);
        const rec = colony.recruitment || {};
        const isEmptyColony = tile.settlement.population < 10;
        const currentIncentive = Colonization.INCENTIVES[rec.incentive] || Colonization.INCENTIVES.none;

        let html = `
            <div style="max-height:550px; overflow-y:auto;">
                <h3 style="margin:0 0 10px;">Colony: ${tile.settlement.name}</h3>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Population</small><br>
                        <b>${tile.settlement.population}</b>${rec.enRoute ? ` <small style="color:#f5c542;">(+${rec.enRoute} en route)</small>` : ''}
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Loyalty</small><br>
                        <b style="color:${loyaltyColor}">${colony.loyalty.toFixed(1)}%</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Distance</small><br>
                        <b>${dist}</b> hexes
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Garrison</small><br>
                        <b>${colony.garrisonStrength}</b>
                    </div>
                </div>`;

        // ── Recruitment Status (shown when colony is young / small) ──
        if (isEmptyColony || rec.recruited > 0) {
            html += `
                <div style="padding:10px; background:rgba(245,197,66,0.06); border:1px solid rgba(245,197,66,0.2); border-radius:6px; margin-bottom:10px;">
                    <div style="font-weight:600; font-size:13px; color:var(--gold); margin-bottom:8px;">📢 Recruitment Status</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; font-size:12px;">
                        <div><small style="color:#aaa;">Recruited</small><br><b>${rec.recruited || 0}</b></div>
                        <div><small style="color:#aaa;">En Route</small><br><b style="color:#f5c542;">${rec.enRoute || 0}</b></div>
                        <div><small style="color:#aaa;">Reputation</small><br><b>${(rec.reputation || 0).toFixed(0)}</b></div>
                    </div>
                    <div style="margin-top:8px; display:flex; gap:6px; align-items:center; font-size:12px;">
                        <span>🪧 Signboard:</span>
                        ${rec.signboard
                            ? '<span style="color:#4CAF50;">✓ Posted</span>'
                            : `<button onclick="ActionMenu.doPostSignboard(game, game.world.getTile(${tile.q}, ${tile.r})); setTimeout(() => ActionMenu.showManageColonyMenu(game, game.world.getTile(${tile.q}, ${tile.r})), 200);"
                                style="padding:3px 10px; background:rgba(245,197,66,0.15); border:1px solid var(--gold); border-radius:4px; cursor:pointer; color:var(--text-primary); font-size:11px;">
                                Post (20g)</button>`}
                    </div>
                    <div style="margin-top:8px; font-size:12px;">
                        <span>Current Incentive: <b>${currentIncentive.icon} ${currentIncentive.name}</b></span>
                        ${currentIncentive.dailyCost > 0 ? `<small style="color:#e8a040;"> (${currentIncentive.dailyCost}g/day)</small>` : ''}
                    </div>
                    <div style="display:flex; gap:4px; margin-top:6px; flex-wrap:wrap;">`;

            for (const [id, inc] of Object.entries(Colonization.INCENTIVES)) {
                if (id === 'none') continue;
                const active = rec.incentive === id;
                const setupCost = Number(inc.setupCost || 0);
                const dailyCost = Number(inc.dailyCost || 0);
                const attractionBonusPct = Number((inc.attractionBonus || 0) * 100).toFixed(0);
                html += `<button onclick="ActionMenu._setIncentiveFromManage(game, ${tile.q}, ${tile.r}, '${id}')"
                    style="padding:4px 8px; font-size:11px; background:${active ? 'rgba(245,197,66,0.2)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${active ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}; border-radius:4px; cursor:pointer; color:var(--text-primary);"
                    title="${inc.desc || ''} (Setup: ${setupCost}g, Daily: ${dailyCost}g, +${attractionBonusPct}% attraction)">
                    ${inc.icon} ${inc.name}
                </button>`;
            }

            html += `<button onclick="ActionMenu._setIncentiveFromManage(game, ${tile.q}, ${tile.r}, 'none')"
                    style="padding:4px 8px; font-size:11px; background:${rec.incentive === 'none' || !rec.incentive ? 'rgba(245,197,66,0.2)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${rec.incentive === 'none' || !rec.incentive ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}; border-radius:4px; cursor:pointer; color:var(--text-primary);"
                    title="Remove incentives">
                    — None
                </button>`;

            html += `</div>
                </div>`;

            if (isEmptyColony) {
                html += `<div style="padding:8px; background:rgba(100,149,237,0.08); border:1px solid rgba(100,149,237,0.2); border-radius:6px; margin-bottom:10px; font-size:12px; color:var(--text-secondary);">
                    💡 <b>Tip:</b> Visit other settlements and use <em>Recruit Settlers</em> to attract people. Post a signboard and set incentives to draw settlers passively each day. Once you reach 10 settlers, the settlement will begin to grow on its own.
                </div>`;
            }
        }

        html += `
                <div style="padding:8px; background:#2a2a2a; border-radius:4px; margin-bottom:8px;">
                    <small style="color:#aaa;">Policy</small><br>
                    <b>${policy.name}</b> — <small>${policy.desc}</small>
                </div>

                <div style="padding:8px; background:#2a2a2a; border-radius:4px; margin-bottom:8px;">
                    <small style="color:#aaa;">Indigenous Relations</small><br>
                    <b style="color:${colony.indigenousRelation > 50 ? '#4CAF50' : colony.indigenousRelation > 0 ? '#e8a040' : '#ff4444'}">${colony.indigenousRelation.toFixed(0)}</b> / 100
                    ${nearbyIndigenous.length > 0 ? `<br><small>Nearby: ${nearbyIndigenous.map(i => `${i.tribeName} (${i.population})`).join(', ')}</small>` : '<br><small>No indigenous nearby</small>'}
                </div>

                <div style="padding:8px; background:#2a2a2a; border-radius:4px; margin-bottom:10px;">
                    <small style="color:#aaa;">Founded</small><br>
                    Day ${colony.foundedDay} (${Math.floor((world.day - colony.foundedDay) / 30)} months ago)
                </div>

                <hr style="border-color:#555;">
                <p><b>Colony Actions:</b></p>

                <button onclick="ActionMenu.reinforceColony(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🛡️ Reinforce Garrison (+10, costs 100g)
                </button>

                <button onclick="ActionMenu.sendGoldToColony(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    💰 Send Gold Aid (+15 loyalty, costs 150g)
                </button>

                <button onclick="ActionMenu.changeColonyPolicy(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    📜 Change Policy
                </button>

                ${colony.loyalty < Colonization.REVOLT_LOYALTY + 10 ? `
                <div style="padding:8px; background:#4a2020; border:1px solid #ff4444; border-radius:4px; margin-top:8px;">
                    ⚠️ <b>Warning:</b> This colony is at risk of independence revolt!
                    ${colony.loyalty < Colonization.REVOLT_LOYALTY ? '<br>🔥 <b>REVOLT IMMINENT!</b>' : ''}
                </div>` : ''}
            </div>`;

        game.ui.showCustomPanel('Colony Management', html);
    },

    /**
     * Set incentive from manage colony panel and refresh
     */
    _setIncentiveFromManage(game, q, r, incentiveId) {
        const tile = game.world.getTile(q, r);
        if (!tile) return;
        const result = Colonization.setColonyIncentive(game.player, tile, incentiveId);
        if (result.success) {
            game.ui.showNotification('Incentive Updated', result.message || `Incentive set to ${incentiveId}.`, 'success');
        } else {
            game.ui.showNotification('Cannot Set Incentive', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showManageColonyMenu(game, tile);
    },

    /**
     * Reinforce colony garrison
     */
    reinforceColony(game, q, r) {
        const player = game.player;
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        if (player.gold < 100) {
            game.ui.showNotification('Not Enough Gold', 'Need 100 gold to reinforce.', 'error');
            return;
        }

        player.gold -= 100;
        tile.settlement.colony.garrisonStrength += 10;
        tile.settlement.colony.loyalty = Math.min(100, tile.settlement.colony.loyalty + 5);
        game.ui.showNotification('Garrison Reinforced', `${tile.settlement.name} garrison strengthened to ${tile.settlement.colony.garrisonStrength}.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Send gold to boost colony loyalty
     */
    sendGoldToColony(game, q, r) {
        const player = game.player;
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        if (player.gold < 150) {
            game.ui.showNotification('Not Enough Gold', 'Need 150 gold to send aid.', 'error');
            return;
        }

        player.gold -= 150;
        tile.settlement.colony.loyalty = Math.min(100, tile.settlement.colony.loyalty + 15);
        game.ui.showNotification('Aid Sent', `${tile.settlement.name} loyalty boosted to ${tile.settlement.colony.loyalty.toFixed(1)}%.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Change colony policy
     */
    changeColonyPolicy(game, q, r) {
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        let html = '<p>Select a new colonization policy for this colony:</p>';
        for (const [id, policy] of Object.entries(Colonization.POLICIES)) {
            const isCurrent = tile.settlement.colony.policy === id;
            html += `
                <div style="padding:8px; margin:4px 0; border:1px solid ${isCurrent ? '#4CAF50' : '#555'}; border-radius:4px; cursor:pointer; ${isCurrent ? 'background:#2a3a2a;' : ''}"
                     onclick="ActionMenu.executeChangePolicy(game, ${q}, ${r}, '${id}')">
                    <b>${policy.name}</b> ${isCurrent ? '(current)' : ''}<br>
                    <small style="color:#aaa;">${policy.desc}</small><br>
                    <small>Expansion: +${(policy.expansionBonus * 100).toFixed(0)}% | Indigenous: ${policy.indigenousRelation > 0 ? '+' : ''}${policy.indigenousRelation} | Loyalty: +${policy.loyaltyBonus}</small>
                </div>`;
        }

        game.ui.showCustomPanel('Change Colony Policy', html);
    },

    /**
     * Execute policy change
     */
    executeChangePolicy(game, q, r, policyId) {
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        tile.settlement.colony.policy = policyId;
        const policy = Colonization.POLICIES[policyId];
        game.ui.showNotification('Policy Changed', `${tile.settlement.name} now follows ${policy.name} policy.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
    },

    /**
     * Show indigenous negotiation menu
     */
    showNegotiateIndigenousMenu(game, tile) {
        const indigenous = tile.indigenous;
        if (!indigenous) return;

        const player = game.player;
        const hostilityColor = indigenous.hostility > 60 ? '#ff4444' : indigenous.hostility > 30 ? '#e8a040' : '#4CAF50';
        const dispositionText = indigenous.hostility > 70 ? 'Hostile' : indigenous.hostility > 40 ? 'Wary' : indigenous.hostility > 20 ? 'Cautious' : 'Friendly';

        let html = `
            <div style="max-height:450px; overflow-y:auto;">
                <h3 style="margin:0 0 10px;">The ${indigenous.tribeName}</h3>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Population</small><br>
                        <b>${indigenous.population}</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Disposition</small><br>
                        <b style="color:${hostilityColor}">${dispositionText}</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Territory</small><br>
                        <b>${tile.terrain.name}</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Hostility</small><br>
                        <b style="color:${hostilityColor}">${indigenous.hostility.toFixed(0)}</b>
                    </div>
                </div>

                <hr style="border-color:#555;">
                <p><b>Diplomatic Options:</b></p>

                <button onclick="ActionMenu.tradeWithIndigenous(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🤝 Trade Goods (costs 50g, reduces hostility)
                </button>

                <button onclick="ActionMenu.giftToIndigenous(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    🎁 Offer Tribute (costs 100g, greatly reduces hostility)
                </button>

                <button onclick="ActionMenu.learnFromIndigenous(game, ${tile.q}, ${tile.r})" 
                        style="width:100%; padding:6px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    📖 Learn Local Knowledge (${indigenous.hostility < 40 ? 'Available' : 'Need friendly relations'})
                </button>

                ${indigenous.hostility > 50 ? `
                <div style="padding:8px; background:#4a2020; border:1px solid #ff4444; border-radius:4px; margin-top:8px;">
                    ⚠️ The ${indigenous.tribeName} are ${dispositionText.toLowerCase()} towards outsiders. 
                    Trade or tribute may improve relations.
                </div>` : `
                <div style="padding:8px; background:#2a3a2a; border:1px solid #4CAF50; border-radius:4px; margin-top:8px;">
                    The ${indigenous.tribeName} are ${dispositionText.toLowerCase()} and open to interaction.
                </div>`}
            </div>`;

        game.ui.showCustomPanel('Negotiate with Natives', html);
    },

    /**
     * Trade with indigenous
     */
    tradeWithIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (player.gold < 50) {
            game.ui.showNotification('Not Enough Gold', 'Need 50 gold to trade.', 'error');
            return;
        }

        player.gold -= 50;
        tile.indigenous.hostility = Math.max(0, tile.indigenous.hostility - 10);
        
        // Gain some bonus
        const bonus = Utils.randInt(1, 3);
        player.karma = (player.karma || 0) + bonus;
        
        game.ui.showNotification('Trade Successful', 
            `Traded with the ${tile.indigenous.tribeName}. Hostility reduced. Gained ${bonus} karma from cultural exchange.`, 'success');
        ActionMenu.showNegotiateIndigenousMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Offer tribute to indigenous
     */
    giftToIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (player.gold < 100) {
            game.ui.showNotification('Not Enough Gold', 'Need 100 gold for tribute.', 'error');
            return;
        }

        player.gold -= 100;
        tile.indigenous.hostility = Math.max(0, tile.indigenous.hostility - 25);
        player.renown = (player.renown || 0) + 5;
        
        game.ui.showNotification('Tribute Accepted', 
            `The ${tile.indigenous.tribeName} graciously accept your tribute. Relations greatly improved. +5 renown.`, 'success');
        ActionMenu.showNegotiateIndigenousMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Learn local knowledge from friendly indigenous
     */
    learnFromIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (tile.indigenous.hostility >= 40) {
            game.ui.showNotification('Too Hostile', 'The natives don\'t trust you enough to share their knowledge. Improve relations first.', 'error');
            return;
        }

        // Random benefit
        const benefits = [
            { text: 'terrain navigation', stat: 'speed', value: 0 },
            { text: 'local herbs and medicine', stat: 'karma', value: Utils.randInt(2, 5) },
            { text: 'ancient trade routes', stat: 'gold', value: Utils.randInt(20, 80) },
            { text: 'survival techniques', stat: 'renown', value: Utils.randInt(3, 8) },
        ];
        const benefit = Utils.randPick(benefits);
        
        if (benefit.stat === 'gold') player.gold += benefit.value;
        else if (benefit.stat === 'karma') player.karma = (player.karma || 0) + benefit.value;
        else if (benefit.stat === 'renown') player.renown = (player.renown || 0) + benefit.value;

        // Slight hostility increase from knowledge exchange
        tile.indigenous.hostility = Math.min(100, tile.indigenous.hostility + 5);

        game.ui.showNotification('Knowledge Gained', 
            `The ${tile.indigenous.tribeName} teach you about ${benefit.text}. ${benefit.value > 0 ? `+${benefit.value} ${benefit.stat}` : ''}`, 'success');
        game.ui.updateStats(game.player, game.world);
    },


    // ────────────────────────────────────────────
    //  CARTOGRAPHY
    // ────────────────────────────────────────────

    /**
     * Show main cartography menu
     */
    showCartographyMenu(game, tile) {
        const player = game.player;
        const skill = player.skills.cartography || 0;
        const skillDesc = Cartography.getSkillDescription(skill);
        const quality = Cartography.getQualityForSkill(skill);
        const qualityData = Cartography.QUALITY[quality];
        const mapCount = (player.maps || []).length;
        const exploredCount = Cartography.countExploredTiles(game.world);
        const totalTiles = game.world.width * game.world.height;

        let html = `
            <div style="max-height:500px; overflow-y:auto;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Cartography Skill</small><br>
                        <b>${skill.toFixed(1)}</b> / 10<br>
                        <small style="color:#f5c542;">${skillDesc}</small>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Map Quality</small><br>
                        <b>${qualityData.icon} ${qualityData.label}</b><br>
                        <small>Accuracy: ${(qualityData.accuracy * 100).toFixed(0)}%</small>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Maps Owned</small><br>
                        <b>${mapCount}</b>
                    </div>
                    <div style="padding:8px; background:#2a2a2a; border-radius:4px;">
                        <small style="color:#aaa;">Explored</small><br>
                        <b>${exploredCount}</b> / ${totalTiles} tiles
                    </div>
                </div>

                <hr style="border-color:#555;">
                <p><b>Create a Map:</b></p>

                <button onclick="ActionMenu.createMap(game, 'regional')" 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    🗺️ <b>Regional Map</b> — Chart the surrounding area (radius 8)<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.regional.cost}g | Quality: ${qualityData.label}</small>
                </button>

                <button onclick="ActionMenu.createMap(game, 'survey')" 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    📐 <b>Survey Map</b> — Detailed survey showing resources (radius 5)<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.survey.cost}g | Shows resources</small>
                </button>

                ${player.allegiance ? `
                <button onclick="ActionMenu.createMap(game, 'kingdom')" 
                        style="width:100%; padding:8px; margin:3px 0; background:#555; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    👑 <b>Kingdom Map</b> — Map your kingdom's territory<br>
                    <small style="color:#aaa;">Cost: ${Cartography.MAP_TYPES.kingdom.cost}g | Shows borders</small>
                </button>` : ''}

                ${mapCount > 0 ? `
                <hr style="border-color:#555;">
                <p><b>Your Maps:</b></p>
                <button onclick="ActionMenu.showMapCollection(game)" 
                        style="width:100%; padding:8px; margin:3px 0; background:#3a5a3a; color:#fff; border:none; border-radius:4px; cursor:pointer;">
                    📚 View Map Collection (${mapCount} maps)
                </button>` : ''}

                ${skill >= 3 ? `
                <hr style="border-color:#555;">
                <p><b>Advanced:</b></p>
                <button onclick="ActionMenu.showAddErrorsMenu(game)" 
                        style="width:100%; padding:8px; margin:3px 0; background:#5a3a3a; color:#fff; border:none; border-radius:4px; cursor:pointer; text-align:left;">
                    ✏️ <b>Add Deliberate Errors</b> — Alter a map for deception/security<br>
                    <small style="color:#aaa;">Requires cartography skill 3+</small>
                </button>` : ''}
            </div>`;

        game.ui.showCustomPanel('🗺️ Cartography', html);
    },

    /**
     * Create a map
     */
    createMap(game, type) {
        const player = game.player;
        const world = game.world;
        const cost = Cartography.MAP_TYPES[type]?.cost || 30;

        if (player.gold < cost) {
            game.ui.showNotification('Not Enough Gold', `You need ${cost} gold to create this map.`, 'error');
            return;
        }
        if (!ActionMenu.commitPendingAP(game)) return;

        player.gold -= cost;
        if (!player.maps) player.maps = [];

        let map;
        switch (type) {
            case 'regional':
                map = Cartography.createRegionalMap(player, world);
                break;
            case 'survey':
                map = Cartography.createSurveyMap(player, world);
                break;
            case 'kingdom':
                if (!player.allegiance) {
                    game.ui.showNotification('No Kingdom', 'You must be pledged to a kingdom to map it.', 'error');
                    player.gold += cost;
                    return;
                }
                map = Cartography.createKingdomMap(player, world, player.allegiance);
                break;
            default:
                player.gold += cost;
                return;
        }

        if (!map) {
            player.gold += cost;
            game.ui.showNotification('Failed', 'Could not create map.', 'error');
            return;
        }

        player.maps.push(map);
        player.skills.cartography = Math.min(10, (player.skills.cartography || 0) + Cartography.SKILL_GAIN_CREATE);

        // Also reveal those tiles for the player
        const result = Cartography.applyMap(player, map, world);

        game.ui.showNotification('Map Created!', 
            `${map.name} (${Cartography.QUALITY[map.quality].label} quality). Charted ${result.tilesRevealed} tiles.`, 'success');
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showCartographyMenu(game, world.getTile(player.q, player.r));
    },

    /**
     * Show map collection
     */
    showMapCollection(game) {
        const player = game.player;
        const maps = player.maps || [];

        if (maps.length === 0) {
            game.ui.showNotification('No Maps', 'You don\'t have any maps yet.', 'default');
            return;
        }

        let html = '<div style="max-height:500px; overflow-y:auto;">';

        for (let i = 0; i < maps.length; i++) {
            const map = maps[i];
            const qualityData = Cartography.QUALITY[map.quality] || Cartography.QUALITY.crude;
            const ageText = map.createdDay > 0 ? `Day ${map.createdDay}` : 'Ancient';

            let tags = '';
            if (map.isPropaganda) tags += '<span style="color:#ff6666; margin-left:4px;">[PROPAGANDA]</span>';
            if (map.isStolen) tags += '<span style="color:#e8a040; margin-left:4px;">[STOLEN]</span>';
            if (map.isAncient) tags += '<span style="color:#a0a0ff; margin-left:4px;">[ANCIENT]</span>';
            if (map.deliberateErrors.length > 0) tags += '<span style="color:#ff9999; margin-left:4px;">[ALTERED]</span>';

            html += `
                <div style="padding:10px; margin:4px 0; border:1px solid #555; border-radius:4px; background:#2a2a2a;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <b>${map.icon || '📜'} ${map.name}</b>${tags}<br>
                            <small style="color:#aaa;">${qualityData.label} | Accuracy: ${(map.accuracy * 100).toFixed(0)}% | By: ${map.createdBy} | ${ageText}</small>
                        </div>
                        <small style="color:#f5c542;">${map.value}g</small>
                    </div>
                    ${map.notes ? `<p style="font-style:italic; color:#aaa; margin:4px 0; font-size:12px;">${map.notes}</p>` : ''}
                    <div style="margin-top:6px; display:flex; gap:4px;">
                        <button onclick="ActionMenu.readMap(game, ${i})" 
                                style="flex:1; padding:4px 8px; background:#3a5a3a; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:12px;">
                            📖 Read
                        </button>
                        <button onclick="ActionMenu.sellPlayerMap(game, ${i})" 
                                style="flex:1; padding:4px 8px; background:#5a5a3a; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:12px;">
                            💰 Sell (${Math.floor(map.value * 0.7)}g)
                        </button>
                    </div>
                </div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('📚 Map Collection', html);
    },

    /**
     * Read/apply a map from collection
     */
    readMap(game, mapIndex) {
        const player = game.player;
        const maps = player.maps || [];
        if (mapIndex < 0 || mapIndex >= maps.length) return;

        const map = maps[mapIndex];
        const world = game.world;

        // Check for propaganda/errors detection
        let warningText = '';
        if ((map.isPropaganda || map.deliberateErrors.length > 0) && Cartography.canDetectErrors(player, map)) {
            warningText = map.isPropaganda
                ? ' ⚠️ You detect propaganda — some borders shown are false!'
                : ` ⚠️ You notice ${map.deliberateErrors.length} deliberate alteration(s) in this map!`;
        }

        const result = Cartography.applyMap(player, map, world);

        let msg = `Studied ${map.name}. Revealed ${result.tilesRevealed} tiles.`;
        if (warningText) msg += warningText;
        if (map.type === 'treasure' && map.treasureQ !== undefined) {
            msg += ` 💎 Treasure location marked on your map!`;
        }
        if (map.isAncient && map.sites && map.sites.length > 0) {
            msg += ` 📍 ${map.sites.length} ancient site(s) revealed!`;
        }

        game.ui.showNotification('Map Read', msg, 'success');
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showMapCollection(game);
    },

    /**
     * Sell a map from collection
     */
    sellPlayerMap(game, mapIndex) {
        const result = Cartography.sellMap(game.player, mapIndex);
        if (result.success) {
            game.ui.showNotification('Map Sold', `Sold ${result.mapName} for ${result.gold} gold.`, 'success');
            game.ui.updateStats(game.player, game.world);
            if ((game.player.maps || []).length > 0) {
                ActionMenu.showMapCollection(game);
            } else {
                game.ui.hideCustomPanel();
            }
        } else {
            game.ui.showNotification('Cannot Sell', result.reason, 'error');
        }
    },

    /**
     * Show add deliberate errors menu
     */
    showAddErrorsMenu(game) {
        const player = game.player;
        const maps = player.maps || [];
        const editableMaps = maps.filter(m => !m.isPropaganda && !m.isAncient && m.deliberateErrors.length < Cartography.MAX_DELIBERATE_ERRORS);

        if (editableMaps.length === 0) {
            game.ui.showNotification('No Maps', 'No maps available to alter.', 'default');
            return;
        }

        let html = '<div style="max-height:400px; overflow-y:auto;">';
        html += '<p>Add deliberate errors to a map for deception or security. Altered maps appear authentic but contain false information.</p>';

        for (let i = 0; i < maps.length; i++) {
            const map = maps[i];
            if (map.isPropaganda || map.isAncient || map.deliberateErrors.length >= Cartography.MAX_DELIBERATE_ERRORS) continue;

            html += `
                <div style="padding:8px; margin:4px 0; border:1px solid #555; border-radius:4px; cursor:pointer;"
                     onclick="ActionMenu.executeAddErrors(game, ${i})"
                     onmouseover="this.style.borderColor='#e8a040'" onmouseout="this.style.borderColor='#555'">
                    <b>${map.icon || '📜'} ${map.name}</b><br>
                    <small style="color:#aaa;">Current errors: ${map.deliberateErrors.length} / ${Cartography.MAX_DELIBERATE_ERRORS}</small>
                </div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('✏️ Alter Map', html);
    },

    /**
     * Execute adding errors to a map
     */
    executeAddErrors(game, mapIndex) {
        const player = game.player;
        const maps = player.maps || [];
        if (mapIndex < 0 || mapIndex >= maps.length) return;

        const map = maps[mapIndex];
        const errorsToAdd = Utils.randInt(1, 3);
        Cartography.addDeliberateErrors(map, errorsToAdd, game.world);

        game.ui.showNotification('Map Altered', 
            `Added ${errorsToAdd} deliberate error(s) to ${map.name}. Accuracy reduced to ${(map.accuracy * 100).toFixed(0)}%.`, 'info');
        ActionMenu.showCartographyMenu(game, game.world.getTile(player.q, player.r));
    },

    /**
     * Show map trade menu at a settlement
     */
    showMapTradeMenu(game, tile) {
        const player = game.player;
        const world = game.world;

        // Get settlement coordinates
        let tileQ = player.q;
        let tileR = player.r;

        // Create a tile-like object with q,r for the sales function
        const tileWithCoords = { ...tile, q: tileQ, r: tileR };
        const availableMaps = Cartography.getAvailableMapsForSale(tileWithCoords, world);

        let html = '<div style="max-height:500px; overflow-y:auto;">';
        html += `<p>Your gold: <b>${player.gold.toFixed(0)}</b></p>`;

        // Buy section
        html += '<h4 style="color:#f5c542; margin:8px 0 4px;">📥 Maps for Sale</h4>';
        if (availableMaps.length === 0) {
            html += '<p style="color:#aaa;">No maps available at this location.</p>';
        } else {
            for (let i = 0; i < availableMaps.length; i++) {
                const item = availableMaps[i];
                const map = item.map;
                const price = item.price;
                const qualityData = Cartography.QUALITY[map.quality] || Cartography.QUALITY.crude;
                const canAfford = player.gold >= price;

                let tags = '';
                if (map.isPropaganda) tags += '<span style="color:#ff6666; margin-left:4px;">[PROPAGANDA]</span>';
                if (map.isAncient) tags += '<span style="color:#a0a0ff; margin-left:4px;">[ANCIENT]</span>';

                // Store map data for purchase
                if (!window._mapTradeData) window._mapTradeData = [];
                window._mapTradeData[i] = item;

                html += `
                    <div style="padding:8px; margin:4px 0; border:1px solid ${canAfford ? '#555' : '#433'}; border-radius:4px; ${canAfford ? '' : 'opacity:0.6;'}">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <b>${map.icon || '📜'} ${map.name}</b>${tags}<br>
                                <small style="color:#aaa;">${qualityData.label} | Accuracy: ${(map.accuracy * 100).toFixed(0)}% | Radius: ${map.radius}</small>
                            </div>
                            <button onclick="ActionMenu.buyMapFromTrade(game, ${i}, ${tileQ}, ${tileR})" 
                                    style="padding:4px 12px; background:${canAfford ? '#3a5a3a' : '#444'}; color:#fff; border:none; border-radius:3px; cursor:${canAfford ? 'pointer' : 'default'}; white-space:nowrap;"
                                    ${canAfford ? '' : 'disabled'}>
                                Buy (${price}g)
                            </button>
                        </div>
                        ${map.notes ? `<small style="font-style:italic; color:#888;">${map.notes}</small>` : ''}
                    </div>`;
            }
        }

        // Sell section
        const playerMaps = player.maps || [];
        if (playerMaps.length > 0) {
            html += '<h4 style="color:#f5c542; margin:12px 0 4px;">📤 Sell Your Maps</h4>';
            for (let i = 0; i < playerMaps.length; i++) {
                const map = playerMaps[i];
                const sellPrice = Math.floor(map.value * 0.7);
                html += `
                    <div style="padding:6px; margin:3px 0; border:1px solid #555; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
                        <span>${map.icon || '📜'} ${map.name}</span>
                        <button onclick="ActionMenu.sellMapFromTrade(game, ${i}, ${tileQ}, ${tileR})" 
                                style="padding:3px 10px; background:#5a5a3a; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:12px;">
                            Sell (${sellPrice}g)
                        </button>
                    </div>`;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('📜 Map Trader', html);
    },

    /**
     * Buy a map from trade menu
     */
    buyMapFromTrade(game, index, tileQ, tileR) {
        const item = window._mapTradeData ? window._mapTradeData[index] : null;
        if (!item) {
            game.ui.showNotification('Error', 'Map no longer available.', 'error');
            return;
        }
        if (!ActionMenu.commitPendingAP(game)) return;

        const result = Cartography.buyMap(game.player, item.map, item.price);
        if (result.success) {
            // Auto-reveal the map area on the world
            Cartography.applyMap(game.player, item.map, game.world);
            game.ui.showNotification('Map Purchased!', `Acquired ${item.map.name}! The area has been revealed on your map.`, 'success');
            game.ui.updateStats(game.player, game.world);
            // Refresh the trade menu
            const tile = game.world.getTile(tileQ, tileR);
            if (tile) ActionMenu.showMapTradeMenu(game, tile);
        } else {
            game.ui.showNotification('Cannot Buy', result.reason, 'error');
        }
    },

    /**
     * Sell a map from trade menu
     */
    sellMapFromTrade(game, mapIndex, tileQ, tileR) {
        if (!ActionMenu.commitPendingAP(game)) return;
        const result = Cartography.sellMap(game.player, mapIndex);
        if (result.success) {
            game.ui.showNotification('Map Sold', `Sold ${result.mapName} for ${result.gold} gold.`, 'success');
            game.ui.updateStats(game.player, game.world);
            const tile = game.world.getTile(tileQ, tileR);
            if (tile) ActionMenu.showMapTradeMenu(game, tile);
        } else {
            game.ui.showNotification('Cannot Sell', result.reason, 'error');
        }
    },

    /**
     * Attempt to steal a map
     */
    attemptStealMap(game, tile) {
        const result = Cartography.attemptStealMap(game.player, game.world, tile);

        if (result.success) {
            // Auto-reveal the stolen map area on the world
            Cartography.applyMap(game.player, result.map, game.world);
            game.ui.showNotification('Map Stolen!', result.message + ' The area has been revealed on your map.', 'success');
        } else if (result.caught) {
            // Jail for map theft
            const player = game.player;
            const settlement = tile.settlement;
            if (settlement) {
                if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0, mapTheft: 0 };
                player.criminalRecord.mapTheft = (player.criminalRecord.mapTheft || 0) + 1;
                const offenses = player.criminalRecord.mapTheft;
                const jailDays = offenses === 1 ? 2 : offenses === 2 ? 5 : offenses === 3 ? 8 : 10 + (offenses - 4) * 3;
                const bailCost = jailDays * 25;
                player.karma = (player.karma || 0) - 2;
                player.jailState = {
                    daysRemaining: jailDays,
                    totalDays: jailDays,
                    offense: 'map theft',
                    offenseNumber: offenses,
                    settlement: settlement.name,
                    bailCost: bailCost,
                    escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
                };
                player.stamina = 0;
                player.movementRemaining = 0;
                game.ui.showNotification('🚔 Arrested!',
                    `${result.message} Sentenced to ${jailDays} days in jail (offense #${offenses}). -2 karma.`, 'error');
            } else {
                game.ui.showNotification('Caught!', result.message, 'error');
            }
        } else {
            game.ui.showNotification('Failed', result.message, 'default');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Dig for treasure
     */
    digTreasure(game, tile) {
        const result = Cartography.digTreasure(game.player, game.world, game.player.q, game.player.r);

        if (result.success) {
            game.ui.showNotification('Treasure Found!', 
                `You dug up ${result.gold} gold!${result.bonusText || ''}`, 'success');
            game.endDay();
        } else {
            game.ui.showNotification('Nothing Here', result.reason, 'default');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show siege confirmation panel for attacking a settlement
     */
    showSiegeConfirm(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) {
            game.ui.showNotification('No Settlement', 'There is no settlement here to attack.', 'default');
            return;
        }

        const playerStrength = PlayerMilitary.getArmyStrength(game.player);
        const garrisonStrength = PlayerMilitary.getSettlementDefense(settlement, game.world);
        const ratio = playerStrength / Math.max(1, garrisonStrength);

        // Odds assessment
        let oddsLabel, oddsColor;
        if (ratio >= 2.0) { oddsLabel = 'Overwhelming Advantage'; oddsColor = '#2ecc71'; }
        else if (ratio >= 1.3) { oddsLabel = 'Favorable Odds'; oddsColor = '#27ae60'; }
        else if (ratio >= 0.8) { oddsLabel = 'Even Fight'; oddsColor = '#f1c40f'; }
        else if (ratio >= 0.5) { oddsLabel = 'Risky — Outmatched'; oddsColor = '#e67e22'; }
        else { oddsLabel = 'Suicidal — Heavily Outmatched'; oddsColor = '#e74c3c'; }

        const kingdom = settlement.kingdom ? game.world.getKingdom(settlement.kingdom) : null;
        const typeIcon = settlement.type === 'capital' ? '🏰' : settlement.type === 'city' ? '🏙️' : settlement.type === 'town' ? '🏘️' : '🏠';

        let html = '<div style="max-height: 500px; overflow-y: auto;">';

        // Settlement info
        html += `
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 48px; margin-bottom: 8px;">${typeIcon}</div>
                <h3 style="color: var(--gold); margin: 4px 0;">${settlement.name}</h3>
                <div style="color: var(--text-secondary); font-size: 12px;">
                    ${settlement.type.charAt(0).toUpperCase() + settlement.type.slice(1)}
                    ${kingdom ? ` — ${kingdom.name}` : ' — Independent'}
                </div>
            </div>
        `;

        // Strength comparison
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <div style="text-align: center; flex: 1;">
                        <div style="color: #4fc3f7; font-size: 11px; margin-bottom: 4px;">YOUR ARMY</div>
                        <div style="font-size: 24px; font-weight: bold; color: #4fc3f7;">${playerStrength}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">${game.player.army.length} units</div>
                    </div>
                    <div style="display: flex; align-items: center; color: var(--text-secondary); font-size: 24px;">⚔️</div>
                    <div style="text-align: center; flex: 1;">
                        <div style="color: #e74c3c; font-size: 11px; margin-bottom: 4px;">GARRISON</div>
                        <div style="font-size: 24px; font-weight: bold; color: #e74c3c;">${garrisonStrength}</div>
                        <div style="font-size: 11px; color: var(--text-secondary);">Pop: ${Utils.formatNumber(settlement.population)}</div>
                    </div>
                </div>
                <div style="text-align: center; padding: 6px; background: rgba(0,0,0,0.3); border-radius: 4px;">
                    <span style="color: ${oddsColor}; font-weight: bold; font-size: 13px;">${oddsLabel}</span>
                </div>
            </div>
        `;

        // Warnings
        html += `<div style="padding: 10px; background: rgba(231,76,60,0.1); border-left: 3px solid #e74c3c; border-radius: 0 4px 4px 0; margin-bottom: 12px; font-size: 12px;">`;
        html += `<div style="color: #e74c3c; font-weight: bold; margin-bottom: 4px;">⚠️ Consequences of Attack</div>`;
        html += `<div style="color: var(--text-secondary); line-height: 1.5;">`;
        html += `• Massive karma penalty (-10)<br>`;
        html += `• Reputation with <strong>ALL</strong> kingdoms drops<br>`;
        if (settlement.kingdom) {
            html += `• Reputation with ${kingdom ? kingdom.name : 'defender'} drops by -50<br>`;
        }
        html += `• Settlement population suffers (-30%)<br>`;
        if (settlement.type === 'capital') {
            html += `• <span style="color: #e74c3c; font-weight: bold;">This is a CAPITAL — expect maximum resistance!</span><br>`;
        }
        html += `</div></div>`;

        // Buttons
        html += `
            <div style="display: flex; gap: 8px;">
                <button onclick="game.ui.hideCustomPanel()" style="
                    flex: 1; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px; cursor: pointer; color: white; font-family: var(--font-body); font-size: 13px;">
                    Retreat
                </button>
                <button onclick="ActionMenu.performSiege(window.game)" style="
                    flex: 1; padding: 10px; background: rgba(231,76,60,0.3); border: 1px solid rgba(231,76,60,0.6);
                    border-radius: 6px; cursor: pointer; color: #ff6666; font-weight: bold; font-family: var(--font-body); font-size: 13px;">
                    ⚔️ ATTACK
                </button>
            </div>
        `;

        html += '</div>';
        game.ui.showCustomPanel(`🏰 Siege — ${settlement.name}`, html);
    },

    /**
     * Execute siege attack against a settlement
     */
    performSiege(game) {
        game.ui.hideCustomPanel();
        if (!ActionMenu.commitPendingAP(game)) return;

        const tile = game.world.getTile(game.player.q, game.player.r);
        if (!tile || !tile.settlement) {
            game.ui.showNotification('Error', 'No settlement here to attack.', 'error');
            return;
        }

        const settlement = tile.settlement;
        const result = PlayerMilitary.attackSettlement(game.player, settlement, tile, game.world);

        if (!result.success && result.reason) {
            game.ui.showNotification('Cannot Attack', result.reason, 'error');
            return;
        }

        let html = '<div style="padding: 10px;">';

        if (result.victory) {
            // Victory panel
            html += `<div style="text-align: center; margin-bottom: 12px;">
                <span style="font-size: 48px;">🏆</span>
                <h3 style="color: #66ff66; margin: 5px 0;">Settlement Conquered!</h3>
                <p style="color: #aaa;">You have taken ${settlement.name}!</p>
            </div>`;

            html += `<div style="background: rgba(46,204,113,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px;">`;
            html += `<div style="font-weight: bold; color: var(--gold); margin-bottom: 6px;">Battle Results</div>`;
            html += `<div style="font-size: 13px; line-height: 1.6;">`;
            html += `<div>💰 Gold plundered: <strong style="color: #ffd700;">${result.plunder}</strong></div>`;
            html += `<div>👑 New owner: <strong style="color: #4fc3f7;">${result.newOwner}</strong></div>`;
            if (result.renownChange > 0) {
                html += `<div>⭐ Renown: <strong style="color: #e67e22;">+${result.renownChange}</strong></div>`;
            }
            if (result.casualties > 0) {
                html += `<div style="color: #ff9800;">⚠️ Soldiers lost: ${result.casualties}</div>`;
            }
            html += `</div></div>`;

            if (result.capitalCaptured) {
                html += `<div style="padding: 8px; background: rgba(155,89,182,0.15); border: 1px solid rgba(155,89,182,0.3); border-radius: 4px; margin-bottom: 10px; font-size: 12px; color: #bb86fc;">
                    👑 You have captured their <strong>capital city</strong>!
                    ${result.kingdomDestroyed ? '<br>💀 <strong>The entire kingdom has fallen!</strong>' : '<br>The kingdom will relocate its capital.'}
                </div>`;
            }

            html += `<div style="font-size: 11px; color: #ff6666; padding: 6px; background: rgba(231,76,60,0.1); border-radius: 4px;">
                😈 Karma: ${result.karmaChange} | Reputation with all kingdoms damaged
            </div>`;

            if (result.tactics) {
                const terrain = result.tactics.terrainId || 'mixed ground';
                html += `<div style="margin-top:8px; font-size:11px; color:var(--text-secondary); padding:6px; background:rgba(79,195,247,0.08); border-radius:4px;">`;
                html += `📐 Tactical: counters x${result.tactics.playerCounterMult} • terrain x${result.tactics.playerTerrainMult} (${terrain}) • morale ${result.tactics.playerMorale}`;
                if (result.tactics.moraleBreak === 'enemy') html += `<br>😨 Defender morale broke and they fled.`;
                html += `</div>`;
            }
        } else {
            // Defeat panel
            html += `<div style="text-align: center; margin-bottom: 12px;">
                <span style="font-size: 48px;">💀</span>
                <h3 style="color: #ff6666; margin: 5px 0;">Siege Failed!</h3>
                <p style="color: #aaa;">The defenders of ${settlement.name} repelled your assault!</p>
            </div>`;

            html += `<div style="background: rgba(231,76,60,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px;">`;
            html += `<div style="font-size: 13px; line-height: 1.6;">`;
            html += `<div style="color: #ff9800;">⚠️ Soldiers lost: ${result.casualties}</div>`;
            html += `<div style="color: #ff6666;">😈 Karma: ${result.karmaChange}</div>`;
            if (result.captured) {
                html += `<div style="color: #ff6666; margin-top: 4px;">⛓️ You have been captured into indentured servitude for ${result.servitudeDays} days!</div>`;
                html += `<div style="color: #ffd700;">💰 ${result.goldConfiscated} gold confiscated.</div>`;
            }
            html += `</div></div>`;

            if (result.tactics) {
                const terrain = result.tactics.terrainId || 'mixed ground';
                html += `<div style="margin-top:8px; font-size:11px; color:var(--text-secondary); padding:6px; background:rgba(79,195,247,0.08); border-radius:4px;">`;
                html += `📐 Tactical: counters x${result.tactics.playerCounterMult} • terrain x${result.tactics.playerTerrainMult} (${terrain}) • morale ${result.tactics.playerMorale}`;
                if (result.tactics.moraleBreak === 'player') html += `<br>😨 Your line broke and fled under pressure.`;
                html += `</div>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width: 100%; padding: 10px; margin-top: 10px;
            background: #444; border: 1px solid #666; border-radius: 6px;
            color: #eee; cursor: pointer; font-size: 14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel(result.victory ? '⚔️ Victory!' : '⚔️ Defeat', html);
        game.ui.updateStats(game.player, game.world);
        game.endDay();
    },

    /**
     * Show attack confirmation for a world unit
     */
    showAttackConfirm(game, tile, actionType) {
        // Find units on this tile
        const unitsOnTile = game.world.units.filter(u => u.q === game.player.q && u.r === game.player.r && !u.destroyed);
        if (unitsOnTile.length === 0) {
            game.ui.showNotification('No Target', 'There are no units here to attack.', 'default');
            return;
        }

        let html = '<div style="padding:10px;">';
        html += '<p style="margin-bottom:10px;color:#ccc;">Choose a target to engage in combat:</p>';

        for (const unit of unitsOnTile) {
            const dangerColor = unit.strength > PlayerMilitary.getArmyStrength(game.player) ? '#ff6666' : '#66ff66';
            html += `<button onclick="ActionMenu.performAttack(window.game, '${unit.id}')" style="
                display:flex; align-items:center; gap:10px; width:100%; padding:10px;
                margin-bottom:8px; background:#2a2a2a; border:1px solid #555;
                border-radius:6px; cursor:pointer; color:#eee; text-align:left;
            ">
                <span style="font-size:28px;">${unit.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold;">${unit.name}</div>
                    <div style="font-size:12px; color:#aaa;">Population: ${unit.population} | Strength: <span style="color:${dangerColor}">${unit.strength}</span></div>
                    <div style="font-size:11px; color:#888;">${unit.type === 'caravan' || unit.type === 'ship' || unit.type === 'fishing_boat' ? '⚠️ Attacking traders hurts your karma' : unit.type === 'patrol' ? '⚠️ Attacking patrols angers kingdoms' : '💀 Hostile unit'}</div>
                </div>
            </button>`;
        }

        const playerStr = PlayerMilitary.getArmyStrength(game.player);
        html += `<div style="margin-top:8px; padding:8px; background:#1a1a2e; border-radius:4px; font-size:12px; color:#aaa;">
            Your army strength: <strong style="color:#4fc3f7;">${playerStr}</strong> (${game.player.army.length} units)
        </div>`;
        html += '</div>';

        game.ui.showCustomPanel('⚔️ Attack Unit', html);
    },

    /**
     * Execute attack against a world unit
     */
    performAttack(game, unitId) {
        game.ui.hideCustomPanel();
        if (!ActionMenu.commitPendingAP(game)) return;

        const unit = game.world.units.find(u => u.id === unitId && !u.destroyed);
        if (!unit) {
            game.ui.showNotification('Target Gone', 'The unit is no longer here.', 'default');
            return;
        }

        const result = PlayerMilitary.attackUnit(game.player, unit, game.world);

        let html = '<div style="padding:10px;">';

        if (result.noArmy) {
            html += '<p style="color:#ff6666;">You have no army to fight with! Recruit soldiers first.</p>';
        } else if (result.victory) {
            html += `<div style="text-align:center; margin-bottom:10px;">
                <span style="font-size:48px;">🏆</span>
                <h3 style="color:#66ff66; margin:5px 0;">Victory!</h3>
                <p style="color:#aaa;">You defeated the ${result.enemyName}!</p>
            </div>`;
            html += `<div style="background:#1a2e1a; padding:8px; border-radius:4px; margin-bottom:8px;">`;
            html += `<div>💰 Gold looted: <strong style="color:#ffd700;">${result.loot}</strong></div>`;
            if (result.inventoryLoot && Object.keys(result.inventoryLoot).length > 0) {
                html += `<div style="margin-top:4px;">📦 Supplies captured:</div>`;
                for (const [item, qty] of Object.entries(result.inventoryLoot)) {
                    html += `<div style="margin-left:12px; color:#aaa;">• ${item}: ${qty}</div>`;
                }
            }
            html += `</div>`;
            if (result.casualties > 0) {
                html += `<div style="color:#ff9800;">⚠️ You lost ${result.casualties} soldier${result.casualties > 1 ? 's' : ''} in the battle.</div>`;
            }
            if (result.karmaChange < 0) {
                html += `<div style="color:#ff6666;">😈 Karma: ${result.karmaChange}</div>`;
            }
            if (result.renownChange > 0) {
                html += `<div style="color:#4fc3f7;">⭐ Renown +${result.renownChange}</div>`;
            }

            if (result.tactics) {
                const terrain = result.tactics.terrainId || 'mixed ground';
                html += `<div style="margin-top:8px; font-size:11px; color:var(--text-secondary); padding:6px; background:rgba(79,195,247,0.08); border-radius:4px;">`;
                html += `📐 Tactical: counters x${result.tactics.playerCounterMult} • terrain x${result.tactics.playerTerrainMult} (${terrain}) • morale ${result.tactics.playerMorale}`;
                if (result.tactics.moraleBreak === 'enemy') html += `<br>😨 Enemy morale broke and they fled.`;
                html += `</div>`;
            }
        } else {
            html += `<div style="text-align:center; margin-bottom:10px;">
                <span style="font-size:48px;">💀</span>
                <h3 style="color:#ff6666;">Defeat!</h3>
                <p style="color:#aaa;">The ${result.enemyName} overpowered you!</p>
            </div>`;
            html += `<div style="background:#2e1a1a; padding:8px; border-radius:4px; margin-bottom:8px;">`;
            html += `<div style="color:#ff9800;">Lost ${result.casualties} soldier${result.casualties > 1 ? 's' : ''}.</div>`;
            if (result.captured) {
                html += `<div style="color:#ff6666; margin-top:4px;">⛓️ You have been captured into indentured servitude for ${result.servitudeDays} days!</div>`;
                html += `<div style="color:#ffd700;">💰 ${result.goldConfiscated} gold confiscated.</div>`;
            }
            html += `</div>`;

            if (result.tactics) {
                const terrain = result.tactics.terrainId || 'mixed ground';
                html += `<div style="margin-top:8px; font-size:11px; color:var(--text-secondary); padding:6px; background:rgba(79,195,247,0.08); border-radius:4px;">`;
                html += `📐 Tactical: counters x${result.tactics.playerCounterMult} • terrain x${result.tactics.playerTerrainMult} (${terrain}) • morale ${result.tactics.playerMorale}`;
                if (result.tactics.moraleBreak === 'player') html += `<br>😨 Your force broke and fled.`;
                html += `</div>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel(result.victory ? '⚔️ Victory!' : '⚔️ Defeat', html);
        game.ui.updateStats(game.player, game.world);
        game.endDay();
    },

    /**
     * Show lord meeting menu — diplomatic audience with an NPC lord
     */
    showLordMeetingMenu(game, tile, actionType) {
        const player = game.player;
        const world = game.world;

        // Find the lord party unit from the action
        const lordUnit = world.units.find(u => u.type === 'lord_party' && u.id === actionType.unitId && !u.destroyed);
        if (!lordUnit) {
            game.ui.showCustomPanel('👑 Meeting', '<div style="padding:15px; color:#aaa;">The lord has already departed.</div>');
            return;
        }

        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) {
            game.ui.showCustomPanel('👑 Meeting', '<div style="padding:15px; color:#aaa;">This kingdom has no ruler.</div>');
            return;
        }

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;
        const isAllegianceKingdom = player.allegiance === kingdom.id;

        // Determine disposition label and color
        let dispositionLabel, dispositionColor;
        if (totalDisposition >= 50) { dispositionLabel = 'Warm & Welcoming'; dispositionColor = '#4caf50'; }
        else if (totalDisposition >= 20) { dispositionLabel = 'Favorable'; dispositionColor = '#8bc34a'; }
        else if (totalDisposition >= -10) { dispositionLabel = 'Neutral'; dispositionColor = '#ffd54f'; }
        else if (totalDisposition >= -40) { dispositionLabel = 'Cool'; dispositionColor = '#ff9800'; }
        else { dispositionLabel = 'Hostile'; dispositionColor = '#f44336'; }

        // Lord trait descriptions
        const traitNames = lord.traits.map(t => t.name).join(', ') || 'Unremarkable';

        let html = `<div style="padding:15px; max-height:500px; overflow-y:auto;">`;

        // Lord portrait and info
        html += `<div style="text-align:center; margin-bottom:12px;">
            <span style="font-size:48px;">👑</span>
            <h3 style="color:#ffd700; margin:5px 0;">${lord.name}</h3>
            <div style="color:#aaa;">Ruler of <span style="color:#4fc3f7;">${kingdom.name}</span></div>
            <div style="color:#888; font-size:12px;">Age ${lord.age} • ${traitNames}</div>
        </div>`;

        // Stats bar
        html += `<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; margin-bottom:12px; font-size:11px; text-align:center;">
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">⚔️ Martial: ${lord.martial}</div>
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">🗣️ Diplomacy: ${lord.diplomacy}</div>
            <div style="background:#1a1a2e; padding:4px; border-radius:4px;">📊 Steward: ${lord.stewardship}</div>
        </div>`;

        // Disposition
        html += `<div style="background:#1a1a2e; padding:8px; border-radius:6px; margin-bottom:12px; text-align:center;">
            <div style="color:#aaa; font-size:11px;">Disposition towards you</div>
            <div style="color:${dispositionColor}; font-size:16px; font-weight:bold;">${dispositionLabel}</div>
            <div style="color:#666; font-size:10px;">Opinion: ${opinion >= 0 ? '+' : ''}${opinion} | Reputation: ${reputation >= 0 ? '+' : ''}${reputation}</div>
        </div>`;

        // Diplomatic options
        html += `<div style="font-weight:bold; color:#ccc; margin-bottom:8px;">Diplomatic Options:</div>`;

        // 1. Improve Relations (always available)
        html += this._meetingOptionButton(
            '🤝', 'Improve Relations',
            'Offer a gift of gold to improve standing',
            `ActionMenu.meetingImproveRelations(game, '${lordUnit.id}')`,
            player.gold >= 50,
            player.gold < 50 ? 'Need at least 50 gold' : null
        );

        // 2. Request Trade Agreement (neutral+ required)
        html += this._meetingOptionButton(
            '⚖️', 'Request Trade Agreement',
            `Better prices in ${kingdom.name} settlements`,
            `ActionMenu.meetingRequestTrade(game, '${lordUnit.id}')`,
            totalDisposition >= -10,
            totalDisposition < -10 ? 'Disposition too low' : null
        );

        // 3. Pledge Allegiance (neutral+ required, not already pledged)
        if (!isAllegianceKingdom) {
            html += this._meetingOptionButton(
                '🏳️', `Pledge to ${kingdom.name}`,
                'Swear fealty — become a vassal of this kingdom',
                `ActionMenu.meetingPledgeAllegiance(game, '${lordUnit.id}')`,
                totalDisposition >= 0,
                totalDisposition < 0 ? 'Must be on neutral terms or better' : null
            );
        } else {
            html += this._meetingOptionButton(
                '🏳️', 'Renounce Allegiance',
                `Leave the service of ${kingdom.name}`,
                `ActionMenu.meetingRenounceAllegiance(game, '${lordUnit.id}')`,
                true, null
            );
        }

        // 4. Request Military Aid (favorable+ required, must be allied/vassal)
        if (isAllegianceKingdom && player.army && player.army.length > 0) {
            html += this._meetingOptionButton(
                '⚔️', 'Request Military Aid',
                'Ask for soldiers to bolster your army',
                `ActionMenu.meetingRequestAid(game, '${lordUnit.id}')`,
                totalDisposition >= 20,
                totalDisposition < 20 ? 'Need favorable disposition' : null
            );
        }

        // 5. Ask about the Realm (always available if not hostile)
        html += this._meetingOptionButton(
            '📜', 'Ask about the Realm',
            `Learn about ${kingdom.name}'s peoples, religion, and history`,
            `ActionMenu.meetingAskAboutRealm(game, '${lordUnit.id}')`,
            totalDisposition >= -40,
            totalDisposition < -40 ? 'Lord refuses to speak with you' : null
        );

        // 6. Demand Tribute (only if powerful army)
        const armyStrength = player.army ? player.army.reduce((s, u) => s + (u.strength || 1), 0) : 0;
        if (armyStrength >= 30) {
            html += this._meetingOptionButton(
                '💰', 'Demand Tribute',
                'Threaten the lord into paying tribute (risky)',
                `ActionMenu.meetingDemandTribute(game, '${lordUnit.id}')`,
                true, null
            );
        }

        // 7. Request Royal Office (must be pledged to this kingdom, no title yet)
        if (typeof Titles !== 'undefined' && isAllegianceKingdom && !player.currentTitle) {
            html += this._meetingOptionButton(
                '🏅', 'Request Royal Office',
                'Ask to be appointed to a political title',
                `ActionMenu.meetingRequestTitle(game, '${lordUnit.id}')`,
                totalDisposition >= 10,
                totalDisposition < 10 ? 'Need favorable disposition (10+)' : null
            );
        }

        // Close button
        html += `<button onclick="game.ui.hideCustomPanel();" style="
            width:100%; padding:10px; margin-top:12px;
            background:#333; border:1px solid #555; border-radius:6px;
            color:#aaa; cursor:pointer; font-size:14px;
        ">Take Your Leave</button>`;

        html += `</div>`;
        game.ui.showCustomPanel('👑 Royal Audience', html);
    },

    /** Helper to create meeting option buttons */
    _meetingOptionButton(icon, label, description, onclick, enabled, disabledReason) {
        const opacity = enabled ? '1' : '0.4';
        const cursor = enabled ? 'cursor:pointer;' : 'cursor:not-allowed;';
        const clickAttr = enabled ? `onclick="${onclick}"` : '';
        return `<button ${clickAttr} style="
            display:flex; align-items:center; gap:10px; width:100%; padding:8px 10px; margin-bottom:6px;
            background:#1a2a1a; border:1px solid #333; border-radius:6px;
            color:#ddd; font-size:13px; text-align:left; ${cursor} opacity:${opacity};
        ">
            <span style="font-size:20px;">${icon}</span>
            <div>
                <div style="font-weight:bold;">${label}</div>
                <div style="color:#888; font-size:11px;">${description}${disabledReason ? ' — <span style=color:#ff6666>' + disabledReason + '</span>' : ''}</div>
            </div>
        </button>`;
    },

    /**
     * Meeting action: Improve Relations — gift gold
     */
    meetingImproveRelations(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        // Gift tiers
        const giftAmount = Math.min(player.gold, Math.max(50, Math.floor(player.gold * 0.1)));
        player.gold -= giftAmount;

        // Reputation boost scales with gift
        const repBoost = Math.floor(giftAmount / 10);
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + repBoost;

        const lord = kingdom.lord;
        const newOpinion = NPCLords.getLordOpinion(lord, player) + (player.reputation[kingdom.id] || 0);

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">🤝</span>
            <h3 style="color:#4caf50;">Gift Accepted</h3>
            <p style="color:#aaa;">You present ${lord.name} with a gift of <span style="color:#ffd700;">${giftAmount} gold</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#4caf50;">📈 Reputation +${repBoost}</div>
            </div>`;

        // Trait-based flavor text
        if (lord.traits.some(t => t.id === 'greedy')) {
            html += `<p style="color:#ffd700; font-style:italic;">"Most generous... I shall remember this kindness."</p>`;
        } else if (lord.traits.some(t => t.id === 'honorable')) {
            html += `<p style="color:#4fc3f7; font-style:italic;">"I accept your gift in the spirit of friendship."</p>`;
        } else if (lord.traits.some(t => t.id === 'cruel')) {
            html += `<p style="color:#ff9800; font-style:italic;">"A wise tribute. See that it continues."</p>`;
        } else {
            html += `<p style="color:#aaa; font-style:italic;">"Thank you, traveler. You are welcome in our lands."</p>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('🤝 Diplomacy', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Request Trade Agreement
     */
    meetingRequestTrade(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;

        // Success chance based on disposition + lord diplomacy
        const baseChance = 0.3 + (totalDisposition / 200) + (lord.diplomacy / 40);
        const success = Math.random() < Math.min(0.9, Math.max(0.1, baseChance));

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            // Grant trade bonus — stored on player
            if (!player.tradeAgreements) player.tradeAgreements = {};
            player.tradeAgreements[kingdom.id] = { kingdom: kingdom.name, expires: world.day + 90 };

            // Small reputation boost
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + 5;

            html += `<span style="font-size:42px;">⚖️</span>
                <h3 style="color:#4caf50;">Agreement Reached!</h3>
                <p style="color:#aaa;">${lord.name} agrees to favorable trade terms.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#4caf50;">📈 10% better prices in ${kingdom.name} for 90 days</div>
                    <div style="color:#4fc3f7;">📈 Reputation +5</div>
                </div>`;
        } else {
            html += `<span style="font-size:42px;">❌</span>
                <h3 style="color:#ff9800;">Declined</h3>
                <p style="color:#aaa;">${lord.name} is not interested in a trade agreement at this time.</p>`;

            if (lord.traits.some(t => t.id === 'cautious')) {
                html += `<p style="color:#ff9800; font-style:italic;">"I must consider the risks more carefully."</p>`;
            } else {
                html += `<p style="color:#aaa; font-style:italic;">"Perhaps another time, traveler."</p>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel();" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('⚖️ Trade Negotiation', html);
    },

    /**
     * Meeting action: Pledge Allegiance
     */
    meetingPledgeAllegiance(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const lord = kingdom.lord;

        // Set allegiance
        const oldAllegiance = player.allegiance;
        player.allegiance = kingdom.id;
        player.kingdomTitle = 'citizen';
        player.title = `Citizen of ${kingdom.name}`;

        // Initialize title fields
        if (typeof Titles !== 'undefined') Titles.initialize(player);

        // Big reputation boost
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + 20;

        // If they were pledged elsewhere, that kingdom dislikes it
        if (oldAllegiance && oldAllegiance !== kingdom.id) {
            player.reputation[oldAllegiance] = (player.reputation[oldAllegiance] || 0) - 15;
        }

        player.renown = (player.renown || 0) + 5;

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">🏳️</span>
            <h3 style="color:#4fc3f7;">Allegiance Sworn</h3>
            <p style="color:#aaa;">You kneel before ${lord.name} and swear fealty to <span style="color:#ffd700;">${kingdom.name}</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#4caf50;">📈 Reputation +20 with ${kingdom.name}</div>
                <div style="color:#4fc3f7;">⭐ Renown +5</div>`;
        if (oldAllegiance && oldAllegiance !== kingdom.id) {
            const oldKingdom = world.getKingdom(oldAllegiance);
            if (oldKingdom) {
                html += `<div style="color:#ff6666;">📉 Reputation -15 with ${oldKingdom.name}</div>`;
            }
        }
        html += `</div>`;

        if (lord.traits.some(t => t.id === 'honorable')) {
            html += `<p style="color:#4fc3f7; font-style:italic;">"Rise, friend. Your service honors us both."</p>`;
        } else if (lord.traits.some(t => t.id === 'ambitious')) {
            html += `<p style="color:#ffd700; font-style:italic;">"Good. Together we shall build an empire."</p>`;
        } else {
            html += `<p style="color:#aaa; font-style:italic;">"Welcome to our cause. Serve loyally and you will be rewarded."</p>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('🏳️ Oath of Fealty', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Renounce Allegiance
     */
    meetingRenounceAllegiance(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const lord = kingdom.lord;

        // Strip any active title first
        if (typeof Titles !== 'undefined' && player.currentTitle) {
            Titles.resign(player, world);
        }

        player.allegiance = null;
        player.kingdomTitle = null;
        player.title = 'Wanderer';

        // Reputation hit
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 25;

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">💔</span>
            <h3 style="color:#ff6666;">Allegiance Renounced</h3>
            <p style="color:#aaa;">You declare your independence from <span style="color:#ffd700;">${kingdom.name}</span>.</p>
            <div style="background:#2e1a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#ff6666;">📉 Reputation -25 with ${kingdom.name}</div>
            </div>`;

        if (lord.traits.some(t => t.id === 'cruel')) {
            html += `<p style="color:#f44336; font-style:italic;">"You dare betray me? You will regret this."</p>`;
        } else {
            html += `<p style="color:#ff9800; font-style:italic;">"So be it. Leave, and do not expect our welcome again."</p>`;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('💔 Renunciation', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Request Royal Office
     */
    meetingRequestTitle(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (typeof Titles === 'undefined') return;
        Titles.initialize(player);

        const lord = kingdom.lord;
        const tile = world.getTile(player.q, player.r);

        // Get available titles the player qualifies for
        const allTitles = Titles.getTitleDefinitions();
        const qualifying = [];
        for (const [id, def] of Object.entries(allTitles)) {
            const check = Titles.meetsRequirements(player, id, world);
            if (check.meets) qualifying.push({ id, ...def });
        }

        let html = `<div style="padding:15px;">
            <div style="text-align:center; margin-bottom:12px;">
                <span style="font-size:36px;">🏅</span>
                <h3 style="color:#ffd700;">Request Royal Office</h3>
                <p style="color:#aaa;">${lord.name} considers your request...</p>
            </div>`;

        if (qualifying.length === 0) {
            html += `<div style="background:#2e1a1a; padding:12px; border-radius:6px; text-align:center;">
                <p style="color:#ff9800; font-style:italic;">"You have not yet proven yourself worthy of any office. Gain more reputation and skill, then return."</p>
            </div>`;
        } else {
            html += `<p style="color:#aaa; font-size:12px; text-align:center; margin-bottom:10px;">The lord considers you for the following offices:</p>`;
            for (const t of qualifying) {
                html += `<div style="border:1px solid #4a6a4a; border-radius:8px; padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.02);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <span style="font-size:18px;">${t.icon || '🏅'}</span>
                            <span style="font-weight:bold; color:#ffd700; margin-left:6px;">${t.name}</span>
                        </div>
                        <span style="font-size:11px; color:#888;">💰 ${t.salary} gold/day</span>
                    </div>
                    <div style="font-size:12px; color:#aaa; margin:4px 0;">${t.description}</div>
                    <button onclick="ActionMenu._appointTitle(game, '${t.id}')" style="
                        width:100%; padding:6px; margin-top:4px;
                        background:#2a4a2a; border:1px solid #4a6a4a; border-radius:4px;
                        color:#4caf50; cursor:pointer; font-size:12px;
                    ">Accept this Office</button>
                </div>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel();" style="
            width:100%; padding:8px; margin-top:6px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:13px;
        ">Decline</button></div>`;

        game.ui.showCustomPanel('🏅 Royal Appointment', html);
    },

    /**
     * Meeting action: Request Military Aid
     */
    meetingRequestAid(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const lord = kingdom.lord;
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisp = NPCLords.getLordOpinion(lord, player) + reputation;

        // Success chance scales with disposition and lord's martial
        const baseChance = 0.2 + (totalDisp / 150) + (lord.martial / 50);
        const success = Math.random() < Math.min(0.8, Math.max(0.05, baseChance));

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            // Grant soldiers
            const soldierCount = Utils.randInt(3, 8 + Math.floor(lord.martial / 2));
            const soldierStrength = Utils.randInt(2, 4);
            for (let i = 0; i < soldierCount; i++) {
                player.army.push({
                    type: `${kingdom.name} Levy`,
                    strength: soldierStrength,
                    morale: 70 + Utils.randInt(0, 20),
                    upkeep: 1,
                });
            }

            // Small reputation cost (they gave you troops)
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 5;

            html += `<span style="font-size:42px;">⚔️</span>
                <h3 style="color:#4caf50;">Aid Granted!</h3>
                <p style="color:#aaa;">${lord.name} assigns ${soldierCount} soldiers to your command.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#4caf50;">+${soldierCount} ${kingdom.name} Levy (Str ${soldierStrength} each)</div>
                    <div style="color:#ff9800;">📉 Reputation -5 (favor spent)</div>
                </div>`;
        } else {
            html += `<span style="font-size:42px;">❌</span>
                <h3 style="color:#ff9800;">Request Denied</h3>
                <p style="color:#aaa;">${lord.name} cannot spare troops at this time.</p>`;

            if (lord.traits.some(t => t.id === 'cautious')) {
                html += `<p style="color:#ff9800; font-style:italic;">"Our own borders require protection. I cannot risk it."</p>`;
            } else {
                html += `<p style="color:#aaa; font-style:italic;">"I sympathize, but my duty is to my own people first."</p>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('⚔️ Military Aid', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Demand Tribute
     */
    meetingDemandTribute(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        const lord = kingdom.lord;
        const armyStrength = player.army ? player.army.reduce((s, u) => s + (u.strength || 1), 0) : 0;

        // Success depends on army strength vs kingdom military + lord bravery
        const lordResistance = (kingdom.military || 10) + (lord.martial * 3) + (lord.traits.some(t => t.id === 'brave') ? 20 : 0);
        const ratio = armyStrength / Math.max(1, lordResistance);
        const success = Math.random() < Math.min(0.85, ratio * 0.5);

        let html = `<div style="padding:15px; text-align:center;">`;

        if (success) {
            const tributeGold = Utils.randInt(50, 200 + Math.floor(kingdom.treasury * 0.1));
            player.gold += tributeGold;
            kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - tributeGold);

            // Major reputation hit
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 30;
            player.karma = (player.karma || 0) - 5;

            html += `<span style="font-size:42px;">💰</span>
                <h3 style="color:#ffd700;">Tribute Paid!</h3>
                <p style="color:#aaa;">${lord.name} grudgingly hands over gold to avoid conflict.</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#ffd700;">+${tributeGold} gold</div>
                    <div style="color:#ff6666;">📉 Reputation -30 with ${kingdom.name}</div>
                    <div style="color:#ff6666;">📉 Karma -5</div>
                </div>`;

            if (lord.traits.some(t => t.id === 'cruel')) {
                html += `<p style="color:#f44336; font-style:italic;">"You will pay for this humiliation... in time."</p>`;
            } else {
                html += `<p style="color:#ff9800; font-style:italic;">"Take it and be gone, brigand."</p>`;
            }
        } else {
            // Lord refuses — possible fight with escort
            if (!player.reputation) player.reputation = {};
            player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) - 15;
            player.karma = (player.karma || 0) - 3;

            html += `<span style="font-size:42px;">⚔️</span>
                <h3 style="color:#f44336;">Refused!</h3>
                <p style="color:#aaa;">${lord.name} orders their guards to drive you away!</p>
                <div style="background:#2e1a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#ff6666;">📉 Reputation -15 with ${kingdom.name}</div>
                    <div style="color:#ff6666;">📉 Karma -3</div>
                </div>`;

            if (lord.traits.some(t => t.id === 'brave')) {
                html += `<p style="color:#4fc3f7; font-style:italic;">"You think I fear you? Guards! Remove this fool!"</p>`;
            } else {
                html += `<p style="color:#ff9800; font-style:italic;">"I... I will not be intimidated! Guards!"</p>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            width:100%; padding:10px; margin-top:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button></div>`;

        game.ui.showCustomPanel('💰 Tribute Demand', html);
        game.ui.updateStats(player, world);
    },

    /**
     * Meeting action: Ask about the Realm — discover peoples, religion, and lore
     */
    meetingAskAboutRealm(game, lordUnitId) {
        const player = game.player;
        const world = game.world;
        const lordUnit = world.units.find(u => u.id === lordUnitId);
        if (!lordUnit) return;
        const kingdom = world.getKingdom(lordUnit.kingdomId);
        if (!kingdom || !kingdom.lord) return;

        // Meeting a lord and asking about their realm reveals ALL knowledge
        const learned = player.learnAboutKingdom(kingdom.id, ['basics', 'ruler', 'peoples', 'religion', 'military', 'diplomacy', 'economy']);
        if (learned.length > 0) {
            game.ui.showNotification('Knowledge Gained', `${kingdom.lord.name} has revealed much about ${kingdom.name}: ${learned.join(', ')}.`, 'info');
        }

        const lord = kingdom.lord;
        const opinion = NPCLords.getLordOpinion(lord, player);
        const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
        const totalDisposition = opinion + reputation;

        // More info revealed at higher disposition
        const detailLevel = totalDisposition >= 50 ? 'full' : totalDisposition >= 10 ? 'good' : 'basic';

        let html = `<div style="padding:15px; max-height:550px; overflow-y:auto;">`;
        html += `<div style="text-align:center; margin-bottom:12px;">
            <span style="font-size:42px;">📜</span>
            <h3 style="color:#ffd700;">Tales of ${kingdom.name}</h3>
            <div style="color:#888; font-size:12px;">${lord.name} speaks of their realm</div>
        </div>`;

        // ── 1. The Peoples ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #4fc3f7;">`;
        html += `<div style="color:#4fc3f7; font-weight:bold; margin-bottom:6px;">🏛️ The Peoples of ${kingdom.name}</div>`;

        if (typeof Peoples !== 'undefined') {
            const tribes = Peoples.getTribesForCulture(kingdom.culture);
            if (tribes.length > 0) {
                html += `<div style="color:#aaa; font-size:12px; margin-bottom:6px;">"Our realm was founded by the union of ancient peoples..."</div>`;
                for (const tribe of tribes) {
                    html += `<div style="background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-bottom:4px;">`;
                    html += `<div style="color:#fff; font-size:13px;">${tribe.icon} <strong>${tribe.name}</strong></div>`;
                    html += `<div style="color:#888; font-size:11px;">Origin: ${tribe.origin} | Traits: ${tribe.traits.join(', ')}</div>`;
                    if (detailLevel !== 'basic') {
                        html += `<div style="color:#aaa; font-size:11px; font-style:italic; margin-top:2px;">"${tribe.proverb}"</div>`;
                    }
                    if (detailLevel === 'full') {
                        html += `<div style="color:#ffd700; font-size:10px; margin-top:2px;">🎨 ${tribe.artForms.join(', ')} | 🍲 ${tribe.cuisine.slice(0, 2).join(', ')}</div>`;
                    }
                    html += `</div>`;
                }
            } else {
                html += `<div style="color:#aaa; font-size:12px;">"Our people are of the <strong>${kingdom.culture}</strong> tradition."</div>`;
            }
        } else {
            html += `<div style="color:#aaa; font-size:12px;">"We are a proud <strong>${kingdom.culture}</strong> people."</div>`;
        }
        html += `</div>`;

        // ── 2. Religion ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #e6c84c;">`;
        html += `<div style="color:#e6c84c; font-weight:bold; margin-bottom:6px;">🙏 Faith of the Realm</div>`;

        if (kingdom.religion && typeof Religion !== 'undefined') {
            const faith = Religion.FAITHS ? Religion.FAITHS[kingdom.religion.faithId] : null;
            const faithIcon = faith ? faith.icon : '🙏';
            html += `<div style="color:#aaa; font-size:12px;">"We follow the ways of <span style='color:#ffd700;'>${faithIcon} ${kingdom.religion.name}</span>."</div>`;
            html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:6px; font-size:11px;">`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🕊️ Piety: ${Math.floor(kingdom.religion.piety)}/100</div>`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">⚖️ Unity: ${Math.floor(kingdom.religion.unity)}/100</div>`;
            html += `</div>`;
            if (detailLevel !== 'basic') {
                const holySiteCount = kingdom.religion.holySites ? kingdom.religion.holySites.length : 0;
                html += `<div style="color:#888; font-size:11px; margin-top:4px;">⛪ ${holySiteCount} holy site${holySiteCount !== 1 ? 's' : ''} under our protection.</div>`;
            }
            if (detailLevel === 'full' && kingdom.religion.heresies && kingdom.religion.heresies.length > 0) {
                html += `<div style="color:#e74c3c; font-size:11px; margin-top:4px;">⚠️ Heresies trouble the realm: ${kingdom.religion.heresies.map(h => h.name).join(', ')}</div>`;
            }
        } else {
            html += `<div style="color:#aaa; font-size:12px;">"Our people follow the old traditions, without a formal church."</div>`;
        }
        html += `</div>`;

        // ── 3. Kingdom Strength ──
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #4caf50;">`;
        html += `<div style="color:#4caf50; font-weight:bold; margin-bottom:6px;">⚔️ Strength of the Realm</div>`;

        const settlements = world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
        const totalPop = settlements.reduce((sum, s) => sum + s.population, 0);
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px;">`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🏘️ Settlements: ${settlements.length}</div>`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">👥 Population: ${Utils.formatNumber(totalPop)}</div>`;
        if (detailLevel !== 'basic') {
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🗺️ Territory: ${kingdom.territory ? kingdom.territory.length : 0} tiles</div>`;
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🛡️ Military: ${kingdom.military || 0}</div>`;
        }
        if (detailLevel === 'full') {
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">💰 Treasury: ~${Utils.formatNumber(Math.round((kingdom.treasury || 0) / 100) * 100)}</div>`;
            const wars = kingdom.wars || [];
            const allies = kingdom.allies || [];
            if (wars.length > 0) {
                const warNames = wars.map(wId => world.getKingdom(wId)?.name || 'Unknown').join(', ');
                html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#e74c3c;">⚔️ At war with: ${warNames}</div>`;
            }
            if (allies.length > 0) {
                const allyNames = allies.map(aId => world.getKingdom(aId)?.name || 'Unknown').join(', ');
                html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#4caf50;">🤝 Allies: ${allyNames}</div>`;
            }
        }
        html += `</div></div>`;

        // ── 4. Diplomacy with Other Kingdoms ──
        if (detailLevel !== 'basic') {
            const otherKingdoms = world.kingdoms.filter(k => k.id !== kingdom.id && k.isAlive);
            if (otherKingdoms.length > 0) {
                html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #9c27b0;">`;
                html += `<div style="color:#9c27b0; font-weight:bold; margin-bottom:6px;">🌍 Relations with Neighbors</div>`;
                for (const other of otherKingdoms) {
                    const rel = kingdom.relations[other.id] || 0;
                    const atWar = kingdom.wars && kingdom.wars.includes(other.id);
                    let relText, relColor;
                    if (atWar) { relText = '⚔️ At War'; relColor = '#e74c3c'; }
                    else if (rel > 50) { relText = '🤝 Allied'; relColor = '#4caf50'; }
                    else if (rel > 0) { relText = '😐 Neutral'; relColor = '#95a5a6'; }
                    else if (rel > -50) { relText = '😠 Tense'; relColor = '#e67e22'; }
                    else { relText = '💢 Hostile'; relColor = '#e74c3c'; }

                    html += `<div style="display:flex; justify-content:space-between; padding:2px 0; font-size:11px;">`;
                    html += `<span style="color:#aaa;"><span style="color:${other.color};">●</span> ${other.name}</span>`;
                    html += `<span style="color:${relColor};">${relText}</span>`;
                    html += `</div>`;
                }
                html += `</div>`;
            }
        }

        // ── 5. Discover World History Lore ──
        let discoveredEntries = [];
        if (typeof Peoples !== 'undefined') {
            // Lords share more lore at higher disposition: 1-3 entries
            const loreCount = detailLevel === 'full' ? 3 : detailLevel === 'good' ? 2 : 1;
            discoveredEntries = Peoples.discoverLore(player, world, {
                kingdom: kingdom.id,
                count: loreCount
            });
        }

        if (discoveredEntries.length > 0) {
            html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #ff9800;">`;
            html += `<div style="color:#ff9800; font-weight:bold; margin-bottom:6px;">📖 Histories Revealed (${discoveredEntries.length})</div>`;
            html += `<div style="color:#888; font-size:11px; margin-bottom:6px;">"Let me share some tales of our past..."</div>`;
            for (const entry of discoveredEntries) {
                html += `<div style="background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-bottom:4px;">`;
                html += `<div style="color:#ffd700; font-size:10px;">Year ${entry.year}</div>`;
                html += `<div style="color:#ddd; font-size:12px; line-height:1.4;">${entry.text}</div>`;
                html += `</div>`;
            }
            html += `<div style="color:#666; font-size:10px; font-style:italic; margin-top:4px;">View all in 📜 World History panel</div>`;
            html += `</div>`;
        }

        // Reputation boost for asking (small)
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdom.id] = (player.reputation[kingdom.id] || 0) + 2;

        // Flavor quote based on lord traits
        html += `<div style="text-align:center; padding:8px; color:#888; font-style:italic; font-size:12px;">`;
        if (lord.traits.some(t => t.id === 'pious')) {
            html += `"All that we are, we owe to the divine. Remember that, traveler."`;
        } else if (lord.traits.some(t => t.id === 'ambitious')) {
            html += `"Know that ${kingdom.name} grows stronger each day. We are destined for greatness."`;
        } else if (lord.traits.some(t => t.id === 'honorable')) {
            html += `"We are a people of honor. This you will see, should you travel our lands."`;
        } else if (lord.traits.some(t => t.id === 'cunning')) {
            html += `"Knowledge is the truest weapon. Use what I've told you wisely."`;
        } else {
            html += `"Now you know something of us. May it serve you well."`;
        }
        html += `</div>`;

        html += `<div style="display:flex; gap:8px;">`;
        html += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
            flex:1; padding:10px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:14px;
        ">Continue</button>`;
        html += `</div></div>`;

        game.ui.showCustomPanel(`📜 The Realm of ${kingdom.name}`, html);
        game.ui.updateStats(player, world);
    },

    // ============================================================
    // EARLY-GAME INCOME SYSTEMS
    // ============================================================

    /**
     * Show available odd jobs at this settlement
     */
    showOddJobsMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        // Determine settlement tier
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' ? 'town' : 'village');

        // Get job list from data (or fallback)
        const jobData = ActionMenu._getJobData();
        const allJobs = jobData[tier] || jobData['village'];

        // Pick 3 random jobs for today
        const shuffled = [...allJobs].sort(() => Math.random() - 0.5);
        const todayJobs = shuffled.slice(0, 3);

        const diffColors = { 2: '#2ecc71', 3: '#2ecc71', 4: '#f39c12', 5: '#e67e22', 6: '#e74c3c', 7: '#e74c3c' };

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🔨 Available Work</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Day labor available in ${settlement.name}. Complete the work task to earn your pay.</p>`;

        for (let i = 0; i < todayJobs.length; i++) {
            const job = todayJobs[i];
            const statVal = ActionMenu._getPlayerStat(game.player, job.stat);
            const statLabel = job.stat.charAt(0).toUpperCase() + job.stat.slice(1);
            const dColor = diffColors[job.difficulty] || '#f39c12';

            html += `
                <button onclick="window._startLabor(${i})"
                    style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 8px;
                           background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid var(--gold);
                           border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                    onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                    <span style="font-size: 28px;">${job.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 13px;">${job.name}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${job.description}</div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${statLabel}: ${statVal} · Pay: ${job.pay.min}-${job.pay.max}g</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 12px; color: #e67e22; font-weight: 600;">▶ Work</div>
                        <div style="font-size: 10px; color: ${dColor}; margin-top: 2px;">Diff: ${job.difficulty}/7</div>
                    </div>
                </button>
            `;
        }

        html += `<button onclick="game.ui.hideCustomPanel();"
            style="margin-top: 6px; padding: 8px 20px; background: none; border: 1px solid rgba(255,255,255,0.1);
                   border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">
            Cancel
        </button>`;
        html += '</div>';
        game.ui.showCustomPanel('Day Labor', html);

        window._startLabor = (idx) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const job = todayJobs[idx];
            ActionMenu._showMinigamePrompt(game, {
                title: `🔨 ${job.name}`,
                icon: job.icon,
                description: job.description,
                baseRewardText: `~${job.pay.min}g (mediocre performance)`,
                onSkip: () => {
                    // Feed 40% score = mediocre base performance
                    ActionMenu._laborReward(game, tile, job, 40);
                },
                onPlay: () => {
                    switch (job.stat) {
                        case 'strength':     ActionMenu._laborStrength(game, tile, job); break;
                        case 'intelligence': ActionMenu._laborIntelligence(game, tile, job); break;
                        case 'combat':       ActionMenu._laborCombat(game, tile, job); break;
                        case 'stealth':      ActionMenu._laborStealth(game, tile, job); break;
                        case 'stamina':      ActionMenu._laborStamina(game, tile, job); break;
                        case 'charisma':     ActionMenu._laborCharisma(game, tile, job); break;
                        default:             ActionMenu._laborStrength(game, tile, job); break;
                    }
                }
            });
        };
    },

    /**
     * Common reward handler for all day labor minigames.
     * scorePercent: 0-100 how well the player performed the job
     */
    _laborReward(game, tile, job, scorePercent) {
        const player = game.player;
        const statVal = ActionMenu._getPlayerStat(player, job.stat);
        const basePay = job.pay.min + Math.floor(Math.random() * (job.pay.max - job.pay.min + 1));
        const qualityMult = 0.3 + (scorePercent / 100) * 1.0;
        const statBonus = Math.floor(statVal * 1.5);
        const actualPay = Math.max(1, Math.floor((basePay + statBonus) * qualityMult));

        player.gold += actualPay;
        if (scorePercent >= 40) player.renown += 1;

        // Track for quests
        if (!player.jobsCompleted) player.jobsCompleted = 0;
        player.jobsCompleted++;

        // Skill up — better performance = better chance
        if (player.skills && player.skills[job.stat] !== undefined) {
            const skillChance = 0.15 + scorePercent * 0.002;
            if (Math.random() < skillChance) {
                player.skills[job.stat] = Math.min(10, player.skills[job.stat] + 0.1);
            }
        }

        // Finance tracking
        if (player.financeToday) {
            player.financeToday.income.jobs = (player.financeToday.income.jobs || 0) + actualPay;
        }

        // Rating
        const rating = scorePercent >= 90 ? 'Masterful Work! 🌟' : scorePercent >= 70 ? 'Great Job! 👏' : scorePercent >= 50 ? 'Decent Work 👍' : scorePercent >= 25 ? 'Sloppy Work 😐' : 'Barely Finished 😬';
        const ratingColor = scorePercent >= 90 ? '#f1c40f' : scorePercent >= 70 ? '#2ecc71' : scorePercent >= 50 ? '#3498db' : scorePercent >= 25 ? '#f39c12' : '#e74c3c';
        const stars = Math.round(scorePercent / 20);
        let starsHtml = '';
        for (let i = 0; i < 5; i++) starsHtml += i < stars ? '⭐' : '☆';

        let html = '<div style="max-width: 450px; text-align: center;">';
        html += `<div style="font-size: 48px; margin: 16px 0;">${job.icon}</div>`;
        html += `<div style="font-size: 18px; color: ${ratingColor}; font-weight: bold; margin-bottom: 6px;">${rating}</div>`;
        html += `<div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 10px;">${job.name}</div>`;
        html += `<div style="margin-bottom: 12px; font-size: 20px; letter-spacing: 4px;">${starsHtml}</div>`;
        html += `<div style="font-size: 24px; color: var(--gold); font-weight: bold; margin: 8px 0;">+${actualPay} gold</div>`;
        if (scorePercent >= 40) html += `<div style="font-size: 12px; color: #9b59b6;">+1 Renown</div>`;

        html += `<button onclick="game.ui.hideCustomPanel();"
            style="padding: 10px 32px; margin-top: 16px; background: linear-gradient(135deg, var(--gold), #d4a030); color: #1a1a2e; border: none;
                   border-radius: 6px; cursor: pointer; font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;">
            Continue
        </button>`;
        html += '</div>';

        game.ui.showCustomPanel('🔨 Work Complete', html);
        game.ui.updateStats(player, game.world);
        game.endDay();
    },

    // ── Labor Minigame: Strength — Power bar timing strikes ──
    _laborStrength(game, tile, job) {
        const str = ActionMenu._getPlayerStat(game.player, 'strength');
        const totalRounds = 6;
        let round = 0;
        let score = 0;
        let position = 0;
        let direction = 1;
        let intervalId = null;
        let locked = false;

        // Green zone size scales with strength
        const greenSize = Math.min(38, 16 + str * 2);
        const greenStart = 50 - greenSize / 2;
        const greenEnd = 50 + greenSize / 2;

        const workActions = ['⛏️ Swing!', '🪓 Chop!', '🔨 Hammer!', '💪 Lift!', '⚒️ Strike!', '🏗️ Heave!'];

        const startRound = () => {
            position = 0;
            direction = 1;
            locked = false;
            const speed = 1.0 + round * 0.3 + (job.difficulty || 3) * 0.15;

            let html = '<div style="max-width: 450px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Hit the power bar in the <span style="color: #2ecc71;">green zone</span>!</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Round ${round + 1}/${totalRounds} · Score: ${score}/${round * 10}</p>`;

            // Work animation
            html += `<div style="font-size: 48px; margin: 10px 0; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">${job.icon}</div>`;

            // Power bar
            html += `<div style="position: relative; height: 28px; background: rgba(255,255,255,0.06); border-radius: 14px; margin: 14px 0; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">`;
            // Red zones on edges
            html += `<div style="position: absolute; left: 0; width: ${greenStart}%; height: 100%; background: rgba(231,76,60,0.15);"></div>`;
            html += `<div style="position: absolute; right: 0; width: ${100 - greenEnd}%; height: 100%; background: rgba(231,76,60,0.15);"></div>`;
            // Green zone
            html += `<div style="position: absolute; left: ${greenStart}%; width: ${greenSize}%; height: 100%; background: rgba(46,204,113,0.25); border-left: 2px solid #2ecc71; border-right: 2px solid #2ecc71;"></div>`;
            // Perfect center line
            html += `<div style="position: absolute; left: 50%; width: 2px; height: 100%; background: rgba(241,196,15,0.5); transform: translateX(-50%);"></div>`;
            // Cursor
            html += `<div id="laborCursor" style="position: absolute; left: 0%; top: 0; width: 4px; height: 100%; background: var(--gold); box-shadow: 0 0 10px rgba(245,197,66,0.6);"></div>`;
            html += `</div>`;

            html += `<button onclick="window._laborStrike()"
                style="padding: 14px 52px; background: linear-gradient(135deg, rgba(245,197,66,0.3), rgba(245,197,66,0.15));
                       border: 2px solid var(--gold); border-radius: 8px; cursor: pointer; color: var(--gold);
                       font-size: 16px; font-weight: bold; letter-spacing: 1px; transition: all 0.1s;"
                onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                ${workActions[round % workActions.length]}
            </button>`;
            html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Gets faster each round!</div>`;
            html += '</div>';
            game.ui.showCustomPanel(`🔨 ${job.name}`, html);

            intervalId = setInterval(() => {
                position += direction * speed;
                if (position >= 100) { position = 100; direction = -1; }
                if (position <= 0) { position = 0; direction = 1; }
                const cursor = document.getElementById('laborCursor');
                if (cursor) cursor.style.left = position + '%';
            }, 20);
        };

        window._laborStrike = () => {
            if (locked) return;
            locked = true;
            clearInterval(intervalId);

            let roundScore = 0, text = '', color = '';
            if (position >= greenStart && position <= greenEnd) {
                const dist = Math.abs(position - 50) / (greenSize / 2);
                if (dist < 0.3) { roundScore = 10; text = '⚡ PERFECT STRIKE!'; color = '#f1c40f'; }
                else { roundScore = 6; text = '💪 Good effort!'; color = '#2ecc71'; }
            } else {
                const dist = Math.min(Math.abs(position - greenStart), Math.abs(position - greenEnd));
                if (dist < 10) { roundScore = 3; text = '😤 Glancing blow...'; color = '#f39c12'; }
                else { roundScore = 0; text = '❌ Missed!'; color = '#e74c3c'; }
            }
            score += roundScore;

            let html = '<div style="max-width: 450px; text-align: center;">';
            html += `<div style="font-size: 52px; margin: 24px 0;">${job.icon}</div>`;
            html += `<div style="font-size: 22px; font-weight: bold; color: ${color}; margin-bottom: 6px;">${text}</div>`;
            html += `<div style="font-size: 13px; color: var(--text-secondary);">+${roundScore} points</div>`;
            html += '</div>';
            game.ui.showCustomPanel(`🔨 ${job.name}`, html);

            round++;
            if (round < totalRounds) {
                setTimeout(() => startRound(), 900);
            } else {
                const pct = Math.round((score / (totalRounds * 10)) * 100);
                setTimeout(() => ActionMenu._laborReward(game, tile, job, pct), 1100);
            }
        };

        startRound();
    },

    // ── Labor Minigame: Intelligence — Symbol sequence memory ──
    _laborIntelligence(game, tile, job) {
        const intel = ActionMenu._getPlayerStat(game.player, 'intelligence');
        const symbols = ['📜', '📕', '🔑', '💎', '⚗️', '🪶', '📐', '🧪'];
        let round = 0;
        const maxRounds = 4;
        let sequence = [];
        let playerInput = [];
        let showingSeq = false;
        let gameOver = false;

        // Start with 3 symbols, grow each round. Intel gives longer view time
        const viewTime = 500 + intel * 40;

        const render = (highlightIdx = -1, msg = '') => {
            let html = '<div style="max-width: 480px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Memorize the sequence, then repeat it in order!</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Round ${round + 1}/${maxRounds} · Sequence length: ${sequence.length}</p>`;

            if (msg) {
                html += `<div style="font-size: 13px; margin: 14px 0; min-height: 22px;">${msg}</div>`;
            } else {
                html += '<div style="min-height: 22px; margin: 14px 0;"></div>';
            }

            // Symbol buttons (4x2 grid)
            html += '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px auto; max-width: 320px;">';
            for (let i = 0; i < symbols.length; i++) {
                const lit = highlightIdx === i;
                const disabled = showingSeq || gameOver;
                html += `<button onclick="window._laborMemPick(${i})"
                    style="width: 64px; height: 64px; border-radius: 10px; border: 2px solid ${lit ? 'var(--gold)' : 'rgba(255,255,255,0.1)'};
                           background: ${lit ? 'rgba(245,197,66,0.2)' : 'rgba(255,255,255,0.04)'}; cursor: ${disabled ? 'default' : 'pointer'};
                           font-size: 24px; opacity: ${disabled && !lit ? 0.4 : 1}; transition: all 0.15s;
                           box-shadow: ${lit ? '0 0 15px rgba(245,197,66,0.3)' : 'none'}; margin: 0 auto;"
                    ${disabled ? 'disabled' : ''}
                    onmouseenter="if(!this.disabled)this.style.background='rgba(255,255,255,0.08)'"
                    onmouseleave="if(!this.disabled)this.style.background='rgba(255,255,255,0.04)'">${symbols[i]}</button>`;
            }
            html += '</div>';

            // Progress dots
            if (!showingSeq && !gameOver && sequence.length > 0) {
                html += '<div style="display: flex; justify-content: center; gap: 6px; margin-top: 6px;">';
                for (let i = 0; i < sequence.length; i++) {
                    const done = i < playerInput.length;
                    html += `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${done ? '#2ecc71' : 'rgba(255,255,255,0.15)'}; border: 1px solid ${done ? '#2ecc71' : 'rgba(255,255,255,0.2)'};"></div>`;
                }
                html += '</div>';
            }

            html += '</div>';
            return html;
        };

        const playSequence = () => {
            showingSeq = true;
            game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: var(--gold);">👀 Watch the sequence...</span>'));

            let idx = 0;
            const playNext = () => {
                if (idx >= sequence.length) {
                    showingSeq = false;
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #2ecc71;">🖊️ Your turn! Repeat the sequence.</span>'));
                    return;
                }
                game.ui.showCustomPanel(`📋 ${job.name}`, render(sequence[idx], '<span style="color: var(--gold);">👀 Watch...</span>'));
                idx++;
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: var(--gold);">👀 Watch...</span>'));
                    setTimeout(playNext, 200);
                }, viewTime);
            };
            setTimeout(playNext, 500);
        };

        const startRound = () => {
            // Add symbols: 3 first round, then +1 each round
            const toAdd = round === 0 ? 3 : 1;
            for (let i = 0; i < toAdd; i++) {
                sequence.push(Math.floor(Math.random() * symbols.length));
            }
            playerInput = [];
            playSequence();
        };

        window._laborMemPick = (symbolIdx) => {
            if (showingSeq || gameOver) return;

            playerInput.push(symbolIdx);
            const pos = playerInput.length - 1;

            game.ui.showCustomPanel(`📋 ${job.name}`, render(symbolIdx, '<span style="color: var(--text-muted);">...</span>'));

            if (playerInput[pos] !== sequence[pos]) {
                gameOver = true;
                const pct = Math.round((round / maxRounds) * 100);
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #e74c3c;">❌ Wrong! You made an error.</span>'));
                    setTimeout(() => ActionMenu._laborReward(game, tile, job, Math.min(100, pct)), 1400);
                }, 350);
                return;
            }

            if (playerInput.length === sequence.length) {
                round++;
                if (round >= maxRounds) {
                    gameOver = true;
                    setTimeout(() => {
                        game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #2ecc71;">✨ Flawless! Every detail perfect!</span>'));
                        setTimeout(() => ActionMenu._laborReward(game, tile, job, 100), 1400);
                    }, 350);
                    return;
                }
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #2ecc71;">✅ Correct! Getting harder...</span>'));
                    setTimeout(() => startRound(), 1100);
                }, 350);
            } else {
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #2ecc71;">Keep going...</span>'));
                }, 200);
            }
        };

        startRound();
    },

    // ── Labor Minigame: Combat — Reaction block & strike ──
    _laborCombat(game, tile, job) {
        const combat = ActionMenu._getPlayerStat(game.player, 'combat');
        const totalRounds = 8;
        let round = 0;
        let score = 0;
        let locked = false;
        let timerId = null;

        const threats = [
            { dir: 'left',  icon: '⬅️', attack: '🗡️ Slash from the left!',  block: '🛡️ Block Left' },
            { dir: 'right', icon: '➡️', attack: '🗡️ Slash from the right!', block: '🛡️ Block Right' },
            { dir: 'up',    icon: '⬆️', attack: '⚔️ Overhead strike!',      block: '🛡️ Block High' },
            { dir: 'down',  icon: '⬇️', attack: '🦵 Low sweep!',            block: '🛡️ Duck Low' },
        ];

        let currentThreat = null;

        const startRound = () => {
            locked = false;
            currentThreat = threats[Math.floor(Math.random() * threats.length)];
            // Timer gets shorter as rounds progress. Combat skill gives more time.
            const timeLimit = Math.max(800, 2200 - round * 150 + combat * 50);

            let html = '<div style="max-width: 480px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">React to attacks! Click the correct defense!</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Round ${round + 1}/${totalRounds} · Score: ${score}/${round}</p>`;

            // Timer bar
            html += `<div style="margin: 10px 0;">
                <div style="background: rgba(255,255,255,0.08); border-radius: 6px; height: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                    <div id="laborTimer" style="width: 100%; height: 100%; background: #2ecc71; transition: width ${timeLimit}ms linear; border-radius: 5px;"></div>
                </div>
            </div>`;

            // Attack display
            html += `<div style="background: rgba(231,76,60,0.1); border: 2px solid rgba(231,76,60,0.4); border-radius: 12px; padding: 16px; margin: 12px 0;">
                <div style="font-size: 40px; margin-bottom: 6px;">${currentThreat.icon}</div>
                <div style="font-size: 15px; color: #e74c3c; font-weight: bold;">${currentThreat.attack}</div>
            </div>`;

            // Defense buttons (2x2 grid)
            html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;">';
            for (const t of threats) {
                const isCorrect = t.dir === currentThreat.dir;
                html += `<button onclick="window._laborBlock('${t.dir}')"
                    style="padding: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
                           border-radius: 8px; cursor: pointer; color: var(--text-primary); font-size: 13px; font-weight: 500;
                           transition: all 0.1s;"
                    onmouseenter="this.style.background='rgba(255,255,255,0.1)'"
                    onmouseleave="this.style.background='rgba(255,255,255,0.04)'"
                    onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                    ${t.icon} ${t.block}
                </button>`;
            }
            html += '</div>';
            html += '</div>';
            game.ui.showCustomPanel(`⚔️ ${job.name}`, html);

            // Start timer animation
            setTimeout(() => {
                const bar = document.getElementById('laborTimer');
                if (bar) bar.style.width = '0%';
            }, 30);

            // Time out
            timerId = setTimeout(() => {
                if (!locked) {
                    locked = true;
                    showRoundResult(false, '⏰ Too slow!');
                }
            }, timeLimit);
        };

        const showRoundResult = (correct, text) => {
            if (correct) score++;
            const color = correct ? '#2ecc71' : '#e74c3c';

            let html = '<div style="max-width: 480px; text-align: center;">';
            html += `<div style="font-size: 48px; margin: 24px 0;">${correct ? '🛡️' : '💥'}</div>`;
            html += `<div style="font-size: 20px; font-weight: bold; color: ${color}; margin-bottom: 6px;">${text}</div>`;
            html += `<div style="font-size: 13px; color: var(--text-secondary);">Score: ${score}/${round + 1}</div>`;
            html += '</div>';
            game.ui.showCustomPanel(`⚔️ ${job.name}`, html);

            round++;
            if (round < totalRounds) {
                setTimeout(() => startRound(), 900);
            } else {
                const pct = Math.round((score / totalRounds) * 100);
                setTimeout(() => ActionMenu._laborReward(game, tile, job, pct), 1100);
            }
        };

        window._laborBlock = (dir) => {
            if (locked) return;
            locked = true;
            clearTimeout(timerId);

            if (dir === currentThreat.dir) {
                showRoundResult(true, '🛡️ Perfect Block!');
            } else {
                showRoundResult(false, '💥 Wrong defense!');
            }
        };

        startRound();
    },

    // ── Labor Minigame: Stealth — Catch the target (whack-a-mole) ──
    _laborStealth(game, tile, job) {
        const stealth = ActionMenu._getPlayerStat(game.player, 'stealth');
        const totalTargets = 8;
        let caught = 0;
        let missed = 0;
        let spawned = 0;
        let locked = false;
        let activeCell = -1;
        let hideTimer = null;
        let gameOver = false;

        const targets = ['🐀', '🐀', '🐁', '🐀', '🕷️', '🐀', '🐁', '🐀'];

        const render = (msg = '') => {
            let html = '<div style="max-width: 420px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Click the target before it escapes!</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Caught: ${caught} · Missed: ${missed} · Remaining: ${totalTargets - spawned}</p>`;

            if (msg) {
                html += `<div style="font-size: 13px; margin: 8px 0; min-height: 20px;">${msg}</div>`;
            }

            // 3x3 grid of "holes"
            html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px auto; max-width: 300px;">';
            for (let i = 0; i < 9; i++) {
                const isActive = i === activeCell;
                html += `<button onclick="window._laborCatch(${i})"
                    style="width: 88px; height: 88px; border-radius: 12px; margin: 0 auto;
                           background: ${isActive ? 'rgba(231,76,60,0.15)' : 'rgba(255,255,255,0.03)'};
                           border: 2px solid ${isActive ? '#e74c3c' : 'rgba(255,255,255,0.06)'};
                           cursor: ${isActive ? 'pointer' : 'default'}; font-size: ${isActive ? '36px' : '20px'};
                           transition: all 0.15s; display: flex; align-items: center; justify-content: center;
                           ${isActive ? 'animation: hlBob 0.5s ease-in-out infinite alternate;' : ''}"
                    ${isActive ? '' : 'disabled'}>${isActive ? targets[spawned] || '🐀' : '<span style="opacity: 0.15;">🕳️</span>'}</button>`;
            }
            html += '</div>';
            html += '</div>';
            return html;
        };

        const spawnTarget = () => {
            if (gameOver || spawned >= totalTargets) return;

            // Pick random empty cell
            activeCell = Math.floor(Math.random() * 9);
            locked = false;
            game.ui.showCustomPanel(`🔍 ${job.name}`, render());

            // Auto-hide timer — stealth gives more time
            const hideTime = Math.max(600, 1500 - spawned * 80 + stealth * 60);
            hideTimer = setTimeout(() => {
                if (!locked && !gameOver) {
                    locked = true;
                    missed++;
                    activeCell = -1;
                    spawned++;
                    game.ui.showCustomPanel(`🔍 ${job.name}`, render('<span style="color: #e74c3c;">💨 It got away!</span>'));

                    if (spawned >= totalTargets) {
                        finishGame();
                    } else {
                        setTimeout(() => spawnTarget(), 500);
                    }
                }
            }, hideTime);
        };

        const finishGame = () => {
            gameOver = true;
            const pct = Math.round((caught / totalTargets) * 100);
            setTimeout(() => ActionMenu._laborReward(game, tile, job, pct), 1200);
        };

        window._laborCatch = (cell) => {
            if (locked || gameOver || cell !== activeCell) return;
            locked = true;
            clearTimeout(hideTimer);

            caught++;
            spawned++;
            activeCell = -1;
            game.ui.showCustomPanel(`🔍 ${job.name}`, render('<span style="color: #2ecc71;">✅ Got it!</span>'));

            if (spawned >= totalTargets) {
                finishGame();
            } else {
                setTimeout(() => spawnTarget(), 600);
            }
        };

        spawnTarget();
    },

    // ── Labor Minigame: Stamina — Pacing endurance run ──
    _laborStamina(game, tile, job) {
        const stamina = ActionMenu._getPlayerStat(game.player, 'stamina');
        let speed = 50; // 0-100 scale, ideal zone is 40-65
        let ticksInZone = 0;
        const totalTicks = 25;
        let ticksDone = 0;
        let locked = false;
        let intervalId = null;

        const idealMin = 35;
        const idealMax = 65;

        // Speed drifts randomly. Stamina reduces drift magnitude.
        const driftRate = 3.5 - stamina * 0.15;

        const render = () => {
            const inZone = speed >= idealMin && speed <= idealMax;
            const speedColor = speed > 80 ? '#e74c3c' : speed > idealMax ? '#f39c12' : speed >= idealMin ? '#2ecc71' : speed > 15 ? '#f39c12' : '#e74c3c';
            const speedLabel = speed > 80 ? 'Exhausting!' : speed > idealMax ? 'Too Fast' : speed >= idealMin ? 'Good Pace' : speed > 15 ? 'Too Slow' : 'Crawling!';
            const pct = Math.round((ticksInZone / totalTicks) * 100);

            let html = '<div style="max-width: 450px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Keep your pace in the <span style="color: #2ecc71;">green zone</span>! Use the buttons to adjust.</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Progress: ${ticksDone}/${totalTicks} · In-zone: ${ticksInZone}</p>`;

            // Speed gauge (vertical-style bar rendered horizontally)
            html += `<div style="position: relative; height: 32px; background: rgba(255,255,255,0.06); border-radius: 16px; margin: 14px 0; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">`;
            // Red zones
            html += `<div style="position: absolute; left: 0; width: ${idealMin}%; height: 100%; background: rgba(231,76,60,0.12);"></div>`;
            html += `<div style="position: absolute; right: 0; width: ${100 - idealMax}%; height: 100%; background: rgba(231,76,60,0.12);"></div>`;
            // Green zone
            html += `<div style="position: absolute; left: ${idealMin}%; width: ${idealMax - idealMin}%; height: 100%; background: rgba(46,204,113,0.2); border-left: 2px solid #2ecc71; border-right: 2px solid #2ecc71;"></div>`;
            // Speed marker
            html += `<div id="laborSpeedMark" style="position: absolute; left: ${speed}%; top: 2px; bottom: 2px; width: 6px; background: ${speedColor}; border-radius: 3px; transform: translateX(-50%); box-shadow: 0 0 10px ${speedColor}; transition: left 0.3s;"></div>`;
            html += `</div>`;

            // Status
            html += `<div style="font-size: 14px; color: ${speedColor}; font-weight: bold; margin-bottom: 10px;">${speedLabel}</div>`;

            // Runner animation
            html += `<div style="font-size: 32px; margin: 4px 0; ${inZone ? '' : 'opacity: 0.5;'}">${speed > idealMax ? '🏃💨' : speed >= idealMin ? '🏃' : '🚶'}</div>`;

            // Buttons
            html += `<div style="display: flex; gap: 12px; justify-content: center; margin-top: 12px;">
                <button onclick="window._laborSlowDown()"
                    style="padding: 12px 28px; background: rgba(52,152,219,0.15); border: 1px solid #3498db;
                           border-radius: 8px; cursor: pointer; color: #3498db; font-size: 14px; font-weight: bold; transition: all 0.1s;"
                    onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                    🐢 Slow Down
                </button>
                <button onclick="window._laborSpeedUp()"
                    style="padding: 12px 28px; background: rgba(231,76,60,0.15); border: 1px solid #e74c3c;
                           border-radius: 8px; cursor: pointer; color: #e74c3c; font-size: 14px; font-weight: bold; transition: all 0.1s;"
                    onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                    🐇 Speed Up
                </button>
            </div>`;

            // Overall progress bar
            html += `<div style="margin-top: 14px;">
                <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 3px;">Delivery progress</div>
                <div style="background: rgba(255,255,255,0.08); border-radius: 6px; height: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="width: ${(ticksDone / totalTicks) * 100}%; height: 100%; background: var(--gold); transition: width 0.3s; border-radius: 5px;"></div>
                </div>
            </div>`;

            html += '</div>';
            return html;
        };

        window._laborSlowDown = () => {
            speed = Math.max(0, speed - 12);
        };

        window._laborSpeedUp = () => {
            speed = Math.min(100, speed + 12);
        };

        game.ui.showCustomPanel(`🏃 ${job.name}`, render());

        intervalId = setInterval(() => {
            if (locked) return;

            // Random drift
            const drift = (Math.random() - 0.45) * driftRate * 2;
            speed = Math.max(0, Math.min(100, speed + drift));

            // Check zone
            if (speed >= idealMin && speed <= idealMax) {
                ticksInZone++;
            }
            ticksDone++;

            game.ui.showCustomPanel(`🏃 ${job.name}`, render());

            if (ticksDone >= totalTicks) {
                locked = true;
                clearInterval(intervalId);
                const pct = Math.round((ticksInZone / totalTicks) * 100);
                setTimeout(() => ActionMenu._laborReward(game, tile, job, pct), 1000);
            }
        }, 800);
    },

    // ── Labor Minigame: Charisma — Public speaking / crowd engagement ──
    _laborCharisma(game, tile, job) {
        const charisma = ActionMenu._getPlayerStat(game.player, 'charisma');
        let round = 0;
        let crowdMood = 50;
        let locked = false;

        const scenarios = [
            {
                prompt: 'You step up to the podium. The crowd awaits your opening words.',
                crowd: '👤 👥 👤 🧑',
                options: [
                    { text: '📢 Project your voice with authority and warmth', mood: 18 },
                    { text: '📜 Read directly from the prepared script', mood: 8 },
                    { text: '🗣️ Wing it — improvise with confidence', mood: -3, max: 25 },
                ]
            },
            {
                prompt: 'A heckler shouts from the back: "Get on with it!"',
                crowd: '👤 👥 😤 👤 🧑',
                options: [
                    { text: '😄 Make a witty joke at the heckler\'s expense', mood: 20 },
                    { text: '🤚 Ignore them and continue with dignity', mood: 12 },
                    { text: '😡 Shout back angrily', mood: -10 },
                ]
            },
            {
                prompt: 'The crowd is engaged. Time for the main message.',
                crowd: '👤 👥 👤 👥 🧑 👤',
                options: [
                    { text: '🎭 Use dramatic gestures and a powerful cadence', mood: 20 },
                    { text: '📖 Present the facts clearly and concisely', mood: 14 },
                    { text: '🥱 Drone on about minor bureaucratic details', mood: -8 },
                ]
            },
            {
                prompt: 'Time to wrap up. The crowd waits for your closing.',
                crowd: '👤 👥 👤 👥 👤 👥 🧑',
                options: [
                    { text: '🙏 End with an inspiring call to action', mood: 18 },
                    { text: '✊ Raise your fist and shout the realm\'s motto', mood: 12 },
                    { text: '📋 Read a long list of legal disclaimers', mood: -5 },
                ]
            },
        ];

        // Shuffle options per scenario
        scenarios.forEach(s => {
            for (let i = s.options.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [s.options[i], s.options[j]] = [s.options[j], s.options[i]];
            }
        });

        // Charisma hint: highlight best option
        const showHint = charisma >= 7;

        const render = (feedbackMsg = '') => {
            const sc = scenarios[round];
            const moodColor = crowdMood >= 70 ? '#2ecc71' : crowdMood >= 45 ? '#f39c12' : '#e74c3c';

            let html = '<div style="max-width: 500px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">Round ${round + 1}/${scenarios.length}</p>`;

            // Crowd mood bar
            html += `<div style="margin-bottom: 12px;">
                <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Crowd Approval: <span style="color: ${moodColor};">${crowdMood}%</span></div>
                <div style="background: rgba(255,255,255,0.08); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="width: ${crowdMood}%; height: 100%; background: ${moodColor}; transition: width 0.4s; border-radius: 5px;"></div>
                </div>
            </div>`;

            html += `<div style="font-size: 20px; margin: 8px 0; opacity: 0.5; letter-spacing: 4px;">${sc.crowd}</div>`;
            html += `<div style="font-size: 13px; color: var(--text-primary); margin: 12px 0; font-style: italic;">"${sc.prompt}"</div>`;

            if (feedbackMsg) {
                html += `<div style="font-size: 13px; margin: 10px 0; min-height: 20px;">${feedbackMsg}</div>`;
            }

            if (!locked) {
                for (let i = 0; i < sc.options.length; i++) {
                    const opt = sc.options[i];
                    const isBest = opt.mood >= 18;
                    const hintBorder = showHint && isBest ? 'border-left: 3px solid rgba(46,204,113,0.4);' : 'border-left: 3px solid transparent;';
                    html += `<button onclick="window._laborSpeakChoice(${i})"
                        style="display: block; width: 100%; padding: 10px 14px; margin-bottom: 6px;
                               background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); ${hintBorder}
                               border-radius: 6px; cursor: pointer; text-align: left; color: var(--text-primary);
                               font-size: 13px; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                        ${opt.text}
                    </button>`;
                }
            }

            html += '</div>';
            return html;
        };

        const showRound = () => {
            locked = false;
            game.ui.showCustomPanel(`📯 ${job.name}`, render());
        };

        window._laborSpeakChoice = (idx) => {
            if (locked || round >= scenarios.length) return;
            locked = true;

            const opt = scenarios[round].options[idx];
            let change = opt.mood;
            // Risky options that can go high
            if (opt.max && Math.random() < 0.5) change = Math.floor(Math.random() * (opt.max - opt.mood + 1)) + opt.mood;
            crowdMood = Math.max(0, Math.min(100, crowdMood + change));

            const fb = change >= 18 ? '<span style="color: #2ecc71;">🎉 The crowd cheers!</span>'
                     : change >= 10 ? '<span style="color: #3498db;">👏 Nods of approval.</span>'
                     : change >= 0 ? '<span style="color: #f39c12;">😐 A tepid response...</span>'
                     : '<span style="color: #e74c3c;">😒 Groans from the crowd...</span>';

            game.ui.showCustomPanel(`📯 ${job.name}`, render(fb));

            round++;
            if (round < scenarios.length) {
                setTimeout(() => showRound(), 1400);
            } else {
                setTimeout(() => ActionMenu._laborReward(game, tile, job, crowdMood), 1400);
            }
        };

        showRound();
    },

    /**
     * Perform foraging on wilderness tiles
     */
    doForage(game, tile) {
        const terrainId = tile.terrain.id;
        const forageData = ActionMenu._getForageData();
        const mapping = forageData.terrain_mapping;
        const category = mapping[terrainId];

        if (!category || !forageData.loot_table[category]) {
            game.ui.showNotification('Nothing Found', 'This terrain has nothing worth gathering.', 'default');
            return;
        }

        const player = game.player;
        const lootTable = forageData.loot_table[category];
        const intStat = player.intelligence || 5;
        const luckStat = player.luck || 5;

        ActionMenu._showMinigamePrompt(game, {
            title: '🌿 Foraging',
            icon: '🌿',
            description: 'Search the area for useful plants and materials.',
            baseRewardText: '1 random foraged item',
            onSkip: () => {
                // Base reward: 1 random item from loot table
                const intBonus = 1 + intStat * 0.05;
                let entry = null;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const roll = Math.random();
                    let cumChance = 0;
                    for (const e of lootTable) {
                        cumChance += e.chance * intBonus * 0.6;
                        if (roll < cumChance) { entry = e; break; }
                    }
                    if (entry) break;
                }
                if (!entry) entry = lootTable[0];
                const sellPrice = entry.sell || 5;
                player.inventory = player.inventory || {};
                player.inventory[entry.item] = (player.inventory[entry.item] || 0) + 1;
                game.ui.showNotification('🌿 Foraging', `Quick search — found ${entry.icon || '🌿'} ${entry.name || entry.item} (~${sellPrice}g).`, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doForageMinigame(game, tile, player, lootTable, intStat, luckStat); }
        });
    },

    _doForageMinigame(game, tile, player, lootTable, intStat, luckStat) {
        const terrainId = tile.terrain.id;

        // ── Foraging Minigame: Search patches ──
        const GRID_SIZE = 4;
        let grid = [];
        let searchesLeft = 4 + Math.floor(intStat / 3);
        let found = [];
        let totalValue = 0;
        let phase = 'searching'; // searching → result
        let statusMsg = '';
        let revealedHints = [];

        // Place loot items randomly. Each cell is: { type, entry, searched, hinted }
        const generateGrid = () => {
            grid = [];
            for (let y = 0; y < GRID_SIZE; y++) {
                const row = [];
                for (let x = 0; x < GRID_SIZE; x++) {
                    // Each cell has a chance of holding an item from the loot table
                    const roll = Math.random();
                    let cumChance = 0;
                    let entry = null;
                    const intBonus = 1 + intStat * 0.05;
                    for (const e of lootTable) {
                        cumChance += e.chance * intBonus * 0.6;
                        if (roll < cumChance) { entry = e; break; }
                    }
                    row.push({
                        entry,
                        searched: false,
                        hinted: false,
                        nearbyCount: 0, // filled in after generation
                    });
                }
                grid.push(row);
            }
            // Calculate "nearby" hints — count loot in adjacent cells
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    let count = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const ny = y + dy, nx = x + dx;
                            if (ny >= 0 && ny < GRID_SIZE && nx >= 0 && nx < GRID_SIZE && grid[ny][nx].entry) {
                                count++;
                            }
                        }
                    }
                    grid[y][x].nearbyCount = count;
                }
            }
        };
        generateGrid();

        // Terrain icons for flavor
        const terrainIcons = {
            'forest': ['🌲', '🌳', '🌿', '🍄'],
            'plains': ['🌾', '🌱', '⛰️', '🌻'],
            'swamp': ['🌊', '🌿', '🍂', '🐸'],
            'desert': ['🏜️', '🌵', '⛰️', '☀️'],
            'mountains': ['⛰️', '⛰️', '🌿', '❄️'],
            'coast': ['🐚', '🌊', '⛰️', '🌿'],
        };
        const icons = terrainIcons[category] || ['🌿', '🍂', '⛰️', '🌱'];

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">🌿 Foraging</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Terrain: ${category} | Intelligence: ${intStat} | Luck: ${luckStat}</p>`;

            if (phase === 'searching') {
                html += `<div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px;">
                    <span>🔍 Searches left: <span style="color: var(--gold); font-weight: bold;">${searchesLeft}</span></span>
                    <span>💰 Found: <span style="color: var(--gold);">${totalValue}g</span></span>
                </div>`;

                // Grid
                html += '<div style="display: grid; grid-template-columns: repeat(' + GRID_SIZE + ', 1fr); gap: 3px; margin-bottom: 10px;">';
                for (let y = 0; y < GRID_SIZE; y++) {
                    for (let x = 0; x < GRID_SIZE; x++) {
                        const cell = grid[y][x];
                        if (cell.searched) {
                            if (cell.entry) {
                                // Found item
                                html += `<div style="width: 100%; height: 64px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;
                                    background: rgba(46,204,113,0.15); border: 1px solid rgba(46,204,113,0.3); font-size: 22px;">
                                    ${cell.entry.icon}
                                    <span style="font-size: 9px; color: #2ecc71;">${cell.entry.name}</span>
                                </div>`;
                            } else {
                                // Empty — show nearby hint
                                const hintColor = cell.nearbyCount > 0 ? 'rgba(243,156,18,0.7)' : 'rgba(255,255,255,0.2)';
                                html += `<div style="width: 100%; height: 64px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;
                                    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
                                    <span style="font-size: 16px; color: ${hintColor};">${cell.nearbyCount > 0 ? cell.nearbyCount : '·'}</span>
                                    <span style="font-size: 8px; color: var(--text-muted);">${cell.nearbyCount > 0 ? 'nearby' : 'empty'}</span>
                                </div>`;
                            }
                        } else {
                            // Unsearched — clickable
                            const bgIcon = icons[Math.floor((y * GRID_SIZE + x) % icons.length)];
                            html += `<button onclick="window._forageSearch(${x},${y})"
                                style="width: 100%; height: 64px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
                                background: rgba(46,139,87,0.08); border: 1px solid rgba(255,255,255,0.08); cursor: pointer;
                                font-size: 22px; transition: all 0.15s;"
                                onmouseenter="this.style.background='rgba(46,139,87,0.18)'; this.style.borderColor='var(--gold)'"
                                onmouseleave="this.style.background='rgba(46,139,87,0.08)'; this.style.borderColor='rgba(255,255,255,0.08)'">
                                ${bgIcon}
                            </button>`;
                        }
                    }
                }
                html += '</div>';

                if (statusMsg) html += `<div style="margin-bottom: 8px; font-size: 12px;">${statusMsg}</div>`;

                html += `<div style="display: flex; gap: 8px; justify-content: center;">
                    <button onclick="window._forageFinish()"
                        style="padding: 8px 20px; background: var(--gold); border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">
                        Done Foraging
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Search patches for resources! Numbers show nearby items.</div>`;

            } else {
                // Results
                html += `<div style="font-size: 48px; margin: 8px 0;">🌿</div>`;
                if (found.length > 0) {
                    html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Foraging Haul</div>`;
                    // Consolidate
                    const totals = {};
                    for (const f of found) {
                        const key = f.entry.name;
                        if (!totals[key]) totals[key] = { ...f.entry, foundQty: 0 };
                        totals[key].foundQty += f.qty;
                    }
                    for (const item of Object.values(totals)) {
                        html += `<div style="padding: 6px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between;">
                            <div>${item.icon} ${item.name} x${item.foundQty}</div>
                            <div style="color: var(--gold);">${item.foundQty * item.sellPrice}g</div>
                        </div>`;
                    }
                    html += `<div style="margin-top: 8px; padding: 8px; background: rgba(245,197,66,0.1); border-radius: 4px; font-weight: bold; color: var(--gold);">Total: ${totalValue} gold</div>`;
                } else {
                    html += `<div style="font-size: 16px; color: #f39c12; margin-bottom: 8px;">Slim Pickings</div>`;
                    html += `<div style="color: var(--text-secondary);">You searched but found nothing of value today.</div>`;
                }
                html += `<button onclick="game.ui.hideCustomPanel(); game.endDay();"
                    style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🌿 Foraging', html);
        };

        render();

        window._forageSearch = (x, y) => {
            if (phase !== 'searching' || searchesLeft <= 0) return;
            const cell = grid[y][x];
            if (cell.searched) return;

            cell.searched = true;
            searchesLeft--;

            if (cell.entry) {
                const intBonus = 1 + intStat * 0.05;
                const qty = Math.floor(Math.random() * (cell.entry.qty.max - cell.entry.qty.min + 1)) + cell.entry.qty.min;
                found.push({ entry: cell.entry, qty });
                const value = qty * cell.entry.sellPrice;
                totalValue += value;
                statusMsg = `<span style="color: #2ecc71;">Found ${cell.entry.icon} ${cell.entry.name} x${qty}! (+${value}g)</span>`;
            } else {
                if (cell.nearbyCount > 0) {
                    statusMsg = `<span style="color: #f39c12;">Nothing here, but ${cell.nearbyCount} item${cell.nearbyCount > 1 ? 's' : ''} nearby...</span>`;
                } else {
                    statusMsg = `<span style="color: var(--text-muted);">Nothing in this area.</span>`;
                }
            }

            if (searchesLeft <= 0) {
                // Auto-finish
                finishForaging();
                return;
            }
            render();
        };

        const finishForaging = () => {
            phase = 'result';
            if (found.length > 0) {
                player.gold += totalValue;
                player.renown += found.length > 2 ? 1 : 0;
                if (!player.foragingTrips) player.foragingTrips = 0;
                player.foragingTrips++;
                if (player.financeToday) {
                    player.financeToday.income.foraging = (player.financeToday.income.foraging || 0) + totalValue;
                }
            }
            render();
            game.ui.updateStats(player, game.world);
        };

        window._forageFinish = () => {
            finishForaging();
        };
    },

    /**
     * Hunt wild game on wilderness tiles
     */
    doHunt(game, tile) {
        const terrainId = tile.terrain.id;
        const huntData = ActionMenu._getHuntData();
        const mapping = ActionMenu._getForageData().terrain_mapping;
        const category = mapping[terrainId];

        if (!category || !huntData.loot_table[category]) {
            game.ui.showNotification('No Game', 'There is nothing to hunt in this terrain.', 'default');
            return;
        }

        const player = game.player;
        const combatSkill = player.skills?.combat || 1;
        const strStat = player.strength || 5;
        const luckStat = player.luck || 5;
        const lootTable = huntData.loot_table[category];

        ActionMenu._showMinigamePrompt(game, {
            title: '🏹 Hunting',
            icon: '🏹',
            description: 'Track and hunt wild game in this area.',
            baseRewardText: '1 basic game item',
            onSkip: () => {
                // Base reward: 1 item from loot table (basic game)
                const entry = lootTable[0] || { item: 'meat', name: 'Venison', icon: '🥩', sell: 8 };
                player.inventory = player.inventory || {};
                player.inventory[entry.item] = (player.inventory[entry.item] || 0) + 1;
                const sellPrice = entry.sell || 8;
                game.ui.showNotification('🏹 Hunting', `Quick hunt — caught ${entry.icon || '🥩'} ${entry.name || entry.item} (~${sellPrice}g).`, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => {
                // Pick a prey animal from the loot table
                const preyPool = lootTable.filter(e => e.chance > 0);
                const prey = preyPool[Math.floor(Math.random() * preyPool.length)];
                const preyName = prey.name || 'Animal';
                const preyIcon = prey.icon || '🦌';
                ActionMenu._doHuntMinigame(game, tile, player, combatSkill, strStat, luckStat, lootTable, prey, preyName, preyIcon);
            }
        });
    },

    _doHuntMinigame(game, tile, player, combatSkill, strStat, luckStat, lootTable, prey, preyName, preyIcon) {
        // ── Hunt minigame: 3 phases — Track → Stalk → Strike ──
        let phase = 'track';   // track → stalk → strike → result
        let trackProgress = 0; // 0-100
        let stalkDistance = 5;  // tiles away, get to 0
        let alertLevel = 0;    // 0-100, animal flees at 100
        let strikeWindow = false;
        let strikeTimer = null;
        let huntResult = null;  // 'success' | 'fled' | 'injured'
        let statusMsg = '';
        let trackClues = [];
        let trackRound = 0;
        const maxTrackRounds = 5;
        let stalkInterval = null;
        let totalLoot = [];
        let totalValue = 0;

        const cleanup = () => {
            if (strikeTimer) clearTimeout(strikeTimer);
            if (stalkInterval) clearInterval(stalkInterval);
        };

        // Generate tracking clues
        const clueTypes = [
            { icon: '🐾', label: 'Fresh tracks', correct: true },
            { icon: '💩', label: 'Droppings (recent)', correct: true },
            { icon: '🌿', label: 'Broken branches', correct: true },
            { icon: '🍃', label: 'Disturbed foliage', correct: true },
            { icon: '🪶', label: 'Shed fur/feathers', correct: true },
            { icon: '❌', label: 'Old tracks (cold)', correct: false },
            { icon: '🌫️', label: 'Wind-blown trail', correct: false },
            { icon: '💧', label: 'Rain-washed prints', correct: false },
            { icon: '⛰️', label: 'Rocky ground (no tracks)', correct: false },
        ];

        const generateClueChoices = () => {
            const correct = clueTypes.filter(c => c.correct);
            const wrong = clueTypes.filter(c => !c.correct);
            const pick = [
                correct[Math.floor(Math.random() * correct.length)],
                correct[Math.floor(Math.random() * correct.length)],
                wrong[Math.floor(Math.random() * wrong.length)],
            ];
            // Shuffle
            for (let i = pick.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pick[i], pick[j]] = [pick[j], pick[i]];
            }
            return pick;
        };

        const render = () => {
            let html = '<div style="max-width: 500px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">🏹 Hunting — ${preyIcon} ${preyName}</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px;">Terrain: ${category} | Combat: ${combatSkill} | Strength: ${strStat}</p>`;

            if (phase === 'track') {
                // ── Tracking phase: pick the right clue ──
                html += `<div style="margin-bottom: 10px;">
                    <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px;">Phase 1: Track the ${preyName}</div>
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Tracking Progress</span>
                        <span style="color: #2ecc71;">${Math.round(trackProgress)}% (Round ${trackRound}/${maxTrackRounds})</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${trackProgress}%; height: 100%; background: #2ecc71; transition: width 0.3s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                if (statusMsg) {
                    html += `<div style="margin-bottom: 10px; font-size: 12px;">${statusMsg}</div>`;
                }

                if (trackRound < maxTrackRounds && trackProgress < 100) {
                    html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Which clue leads to the ${preyName}?</div>`;
                    const choices = generateClueChoices();
                    trackClues = choices;
                    for (let i = 0; i < choices.length; i++) {
                        const c = choices[i];
                        html += `<button onclick="window._huntTrack(${i})"
                            style="display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; margin-bottom: 6px;
                                   background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
                                   border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                            onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                            <span style="font-size: 20px;">${c.icon}</span>
                            <span style="font-size: 13px;">${c.label}</span>
                        </button>`;
                    }
                }

                html += `<button onclick="window._huntAbort()"
                    style="margin-top: 6px; padding: 6px 18px; background: none; border: 1px solid rgba(255,255,255,0.08);
                           border-radius: 6px; cursor: pointer; color: var(--text-muted); font-size: 11px;">Give Up</button>`;

            } else if (phase === 'stalk') {
                // ── Stalking phase: approach without alerting ──
                html += `<div style="margin-bottom: 10px;">
                    <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Phase 2: Stalk the ${preyName}</div>
                </div>`;

                // Distance display
                html += `<div style="position: relative; height: 80px; background: rgba(0,0,0,0.2); border-radius: 10px; overflow: hidden; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.08);">`;
                // Prey on right
                const preyX = 75 + stalkDistance * 3;
                html += `<div style="position: absolute; top: 50%; right: ${Math.min(85, 15 + stalkDistance * 12)}%; transform: translateY(-50%); font-size: 28px; transition: right 0.3s;">${preyIcon}</div>`;
                // Player on left
                html += `<div style="position: absolute; top: 50%; left: 10%; transform: translateY(-50%); font-size: 24px;">🏹</div>`;
                // Distance indicator
                html += `<div style="position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 10px; color: var(--text-muted);">${stalkDistance} paces away</div>`;
                html += `</div>`;

                // Alert level
                const alertColor = alertLevel < 40 ? '#2ecc71' : alertLevel < 70 ? '#f39c12' : '#e74c3c';
                const alertLabel = alertLevel < 40 ? '🤫 Unaware' : alertLevel < 70 ? '👂 Alert' : '⚠️ Spooked!';
                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Animal Alertness</span>
                        <span style="color: ${alertColor}; font-weight: 600;">${alertLabel} ${Math.round(alertLevel)}%</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${alertLevel}%; height: 100%; background: ${alertColor}; transition: width 0.25s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                if (statusMsg) {
                    html += `<div style="margin-bottom: 8px; font-size: 12px;">${statusMsg}</div>`;
                }

                html += `<div style="display: flex; gap: 8px; justify-content: center;">
                    <button onclick="window._huntCreep()"
                        style="padding: 10px 20px; background: rgba(46,204,113,0.15); border: 1px solid #2ecc71;
                               border-radius: 8px; cursor: pointer; color: #2ecc71; font-size: 13px; font-weight: bold; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                        🤫 Creep Closer
                    </button>
                    <button onclick="window._huntWait()"
                        style="padding: 10px 20px; background: rgba(52,152,219,0.15); border: 1px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: #3498db; font-size: 13px; font-weight: bold; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        ⏳ Wait (calm it)
                    </button>
                    ${stalkDistance <= 2 ? `<button onclick="window._huntShoot()"
                        style="padding: 10px 24px; background: rgba(243,156,18,0.2); border: 2px solid #f39c12;
                               border-radius: 8px; cursor: pointer; color: #f39c12; font-size: 13px; font-weight: bold; transition: all 0.15s;
                               box-shadow: 0 0 12px rgba(243,156,18,0.2);"
                        onmouseenter="this.style.background='rgba(243,156,18,0.3)'" onmouseleave="this.style.background='rgba(243,156,18,0.2)'">
                        🏹 Take the Shot!
                    </button>` : ''}
                </div>`;
                if (stalkDistance > 2) {
                    html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Get within 2 paces to take a shot.</div>`;
                }

            } else if (phase === 'strike') {
                // ── Strike phase: timed accuracy click ──
                html += `<div style="margin-bottom: 10px;">
                    <div style="font-size: 13px; color: var(--gold); font-weight: bold; margin-bottom: 8px;">Phase 3: Take the Shot!</div>
                </div>`;

                html += `<div style="position: relative; height: 60px; background: rgba(0,0,0,0.3); border-radius: 10px; overflow: hidden; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.1);">`;
                // Moving target zone
                html += `<div id="huntTarget" style="position: absolute; top: 10px; bottom: 10px; width: 50px; background: rgba(46,204,113,0.25); border: 2px solid #2ecc71; border-radius: 6px; transition: left 0.08s;"></div>`;
                // Center crosshair
                html += `<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 24px; opacity: 0.8;">🎯</div>`;
                html += `</div>`;

                html += `<button onclick="window._huntFire()"
                    style="padding: 14px 48px; background: linear-gradient(135deg, #e74c3c, #c0392b); color: white; border: none; border-radius: 10px; cursor: pointer;
                           font-family: var(--font-display); font-size: 16px; letter-spacing: 1px; box-shadow: 0 0 20px rgba(231,76,60,0.4);">
                    🏹 FIRE!
                </button>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Click when the green zone is centered on the crosshair!</div>`;

            } else if (phase === 'result') {
                if (huntResult === 'success') {
                    html += `<div style="font-size: 48px; margin: 12px 0;">${preyIcon}</div>`;
                    html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Successful Hunt!</div>`;
                    for (const item of totalLoot) {
                        html += `<div style="padding: 6px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <div>${item.icon} ${item.name} x${item.foundQty}</div>
                            <div style="color: var(--gold);">${item.foundQty * item.sellPrice}g</div>
                        </div>`;
                    }
                    html += `<div style="margin-top: 8px; padding: 8px; background: rgba(245,197,66,0.1); border-radius: 4px; font-weight: bold; color: var(--gold);">Total: ${totalValue} gold</div>`;
                    if (statusMsg) html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 6px;">${statusMsg}</div>`;
                } else if (huntResult === 'fled') {
                    html += `<div style="font-size: 48px; margin: 12px 0;">💨</div>`;
                    html += `<div style="font-size: 16px; color: #f39c12; font-weight: bold; margin-bottom: 8px;">The ${preyName} escaped!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
                } else if (huntResult === 'injured') {
                    html += `<div style="font-size: 48px; margin: 12px 0;">🤕</div>`;
                    html += `<div style="font-size: 16px; color: #e74c3c; font-weight: bold; margin-bottom: 8px;">Hunting Mishap!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
                } else {
                    html += `<div style="font-size: 48px; margin: 12px 0;">🏹</div>`;
                    html += `<div style="font-size: 16px; color: var(--text-secondary); font-weight: bold; margin-bottom: 8px;">Missed!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
                }
                html += `<button onclick="game.ui.hideCustomPanel(); game.endDay();"
                    style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🏹 Hunting', html);
        };

        render();

        // ── Track: pick the right clue ──
        window._huntTrack = (idx) => {
            if (phase !== 'track') return;
            trackRound++;
            const chosen = trackClues[idx];
            if (chosen && chosen.correct) {
                const gain = 20 + combatSkill * 2 + Math.random() * 10;
                trackProgress = Math.min(100, trackProgress + gain);
                statusMsg = `<span style="color: #2ecc71;">✓ ${chosen.label} — you're on the trail!</span>`;
            } else {
                trackProgress = Math.max(0, trackProgress - 5);
                statusMsg = `<span style="color: #e74c3c;">✗ ${chosen ? chosen.label : 'Nothing'} — wrong direction, lost time.</span>`;
            }

            if (trackProgress >= 100 || trackRound >= maxTrackRounds) {
                if (trackProgress >= 60) {
                    phase = 'stalk';
                    stalkDistance = trackProgress >= 90 ? 3 : 5;
                    alertLevel = trackProgress >= 90 ? 5 : 15;
                    statusMsg = `<span style="color: #2ecc71;">You found the ${preyName}! Approach carefully...</span>`;
                } else {
                    phase = 'result';
                    huntResult = 'fled';
                    statusMsg = `You couldn't pick up the trail. The ${preyName} is long gone.`;
                }
            }
            render();
        };

        // ── Stalk: creep closer ──
        window._huntCreep = () => {
            if (phase !== 'stalk') return;
            stalkDistance = Math.max(0, stalkDistance - 1);
            const noiseChance = 0.35 - combatSkill * 0.02;
            const alertGain = Math.random() < noiseChance ? (15 + Math.random() * 15) : (3 + Math.random() * 5);
            alertLevel = Math.min(100, alertLevel + alertGain);

            if (alertGain > 12) {
                statusMsg = '<span style="color: #f39c12;">⚠️ A twig snapped underfoot!</span>';
            } else {
                statusMsg = '<span style="color: #2ecc71;">You inch closer silently...</span>';
            }

            if (alertLevel >= 100) {
                cleanup();
                phase = 'result';
                huntResult = 'fled';
                statusMsg = `The ${preyName} spotted you and bolted into the ${category}!`;
            }
            render();
        };

        // ── Stalk: wait to reduce alertness ──
        window._huntWait = () => {
            if (phase !== 'stalk') return;
            const reduction = 10 + combatSkill * 2 + Math.random() * 8;
            alertLevel = Math.max(0, alertLevel - reduction);
            statusMsg = '<span style="color: #3498db;">You hold still and wait... the animal calms down.</span>';
            render();
        };

        // ── Stalk → Strike: take the shot ──
        window._huntShoot = () => {
            if (phase !== 'stalk' || stalkDistance > 2) return;
            phase = 'strike';
            statusMsg = '';
            render();

            // Animate the target zone moving back and forth
            let targetPos = 0;
            let targetDir = 1;
            const speed = 3 + (combatSkill < 3 ? 2 : 0); // faster for low skill
            stalkInterval = setInterval(() => {
                targetPos += targetDir * speed;
                if (targetPos > 80 || targetPos < 0) targetDir *= -1;
                const el = document.getElementById('huntTarget');
                if (el) el.style.left = targetPos + '%';
            }, 50);
        };

        // ── Strike: fire the arrow ──
        window._huntFire = () => {
            if (phase !== 'strike') return;
            cleanup();
            // Check accuracy: target center should be near 50%
            const el = document.getElementById('huntTarget');
            let accuracy = 0;
            if (el) {
                const pos = parseFloat(el.style.left) || 0;
                const center = pos + 25; // target is 50px wide
                accuracy = 100 - Math.abs(center - 50) * 2;
            } else {
                accuracy = 40 + Math.random() * 30;
            }

            const hitThreshold = 35 - combatSkill * 2 - strStat;
            if (accuracy >= hitThreshold) {
                // Hit!
                const combatBonus = 1 + combatSkill * 0.08;
                const strBonus = 1 + strStat * 0.03;
                const totalBonus = combatBonus * strBonus;

                for (const entry of lootTable) {
                    if (Math.random() < entry.chance * totalBonus * 1.3) {
                        const qty = Math.floor(Math.random() * (entry.qty.max - entry.qty.min + 1)) + entry.qty.min;
                        totalLoot.push({ ...entry, foundQty: qty });
                        totalValue += qty * entry.sellPrice;
                    }
                }
                if (totalLoot.length === 0) {
                    // At least give one item
                    const fallback = lootTable[0];
                    totalLoot.push({ ...fallback, foundQty: 1 });
                    totalValue += fallback.sellPrice;
                }

                player.gold += totalValue;
                if (!player.huntingTrips) player.huntingTrips = 0;
                player.huntingTrips++;
                if (player.financeToday) {
                    player.financeToday.income.hunting = (player.financeToday.income.hunting || 0) + totalValue;
                }

                let extra = '';
                if (player.skills && Math.random() < 0.25) {
                    player.skills.combat = Math.min(10, (player.skills.combat || 1) + 0.1);
                    extra = ' Combat skill improved!';
                }

                huntResult = 'success';
                statusMsg = extra;
                phase = 'result';
            } else if (accuracy < 15 && Math.random() < 0.2) {
                // Bad miss + injury
                const dmg = Math.floor(Math.random() * 12) + 5;
                player.health = Math.max(1, player.health - dmg);
                huntResult = 'injured';
                statusMsg = `Your arrow ricocheted! -${dmg} HP`;
                phase = 'result';
            } else {
                huntResult = 'missed';
                statusMsg = `Your arrow flew wide. The ${preyName} fled.`;
                phase = 'result';
            }
            render();
            game.ui.updateStats(player, game.world);
        };

        // ── Abort ──
        window._huntAbort = () => {
            cleanup();
            phase = 'result';
            huntResult = 'fled';
            statusMsg = 'You gave up the hunt and headed back.';
            render();
        };
    },

    /**
     * Show the bounty board at a settlement
     */
    showBountyBoardMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        // Initialize player bounties if needed
        if (!game.player.activeBounties) game.player.activeBounties = [];
        if (typeof BountyHunting !== 'undefined') {
            BountyHunting.initialize(game.player);
        }

        // Generate 2-4 bounties for this settlement
        const bountyTemplates = ActionMenu._getBountyData();
        const numBounties = Math.floor(Math.random() * 3) + 2;
        const shuffled = [...bountyTemplates].sort(() => Math.random() - 0.5).slice(0, numBounties);

        // Find nearby settlements for delivery bounties
        const nearbySettlements = [];
        if (game.world.getAllSettlements) {
            const allS = game.world.getAllSettlements();
            for (const s of allS) {
                if (s.q === tile.q && s.r === tile.r) continue;
                const dist = Hex.wrappingDistance ? Hex.wrappingDistance(tile.q, tile.r, s.q, s.r, game.world.width) :
                    Hex.distance(tile.q, tile.r, s.q, s.r);
                if (dist <= 20) nearbySettlements.push({ ...s, dist });
            }
        }

        const basicBounties = shuffled.map(template => {
            const pay = Math.floor(Math.random() * (template.pay.max - template.pay.min + 1)) + template.pay.min;
            const bounty = { ...template, actualPay: pay, fromSettlement: settlement.name, fromQ: tile.q, fromR: tile.r };

            // Fill in destination for delivery bounties
            if (template.type === 'delivery' && nearbySettlements.length > 0) {
                const dest = nearbySettlements[Math.floor(Math.random() * nearbySettlements.length)];
                bounty.description = template.description.replace('{destination}', dest.name);
                bounty.destQ = dest.q;
                bounty.destR = dest.r;
                bounty.destName = dest.name;
            } else if (template.type === 'delivery') {
                bounty.description = template.description.replace('{destination}', 'a nearby settlement');
                bounty.destQ = tile.q;
                bounty.destR = tile.r;
                bounty.destName = settlement.name;
            }

            // Fill in explore bounties
            if (template.type === 'explore') {
                bounty.description = template.description.replace('{count}', template.exploreCount || 15);
                bounty.tilesNeeded = template.exploreCount || 15;
                bounty.tilesExploredAtStart = 0; // Will be set on accept
            }

            // Fill in gather bounties
            if (template.type === 'gather') {
                const resources = ['wood', 'herbs', 'stone', 'grain'];
                const res = resources[Math.floor(Math.random() * resources.length)];
                const qty = Math.floor(Math.random() * 5) + 3;
                bounty.description = template.description.replace('{qty}', qty).replace('{resource}', res);
                bounty.resourceNeeded = res;
                bounty.qtyNeeded = qty;
            }

            // Fill in instant bounties
            if (template.type === 'instant') {
                bounty.description = template.description
                    .replace('{pest}', ['rats', 'wolves', 'boars', 'snakes'][Math.floor(Math.random() * 4)])
                    .replace('{location}', ['granary', 'cellar', 'farmsteads', 'market stalls'][Math.floor(Math.random() * 4)]);
            }

            return bounty;
        });

        const bounties = (typeof BountyHunting !== 'undefined')
            ? BountyHunting.generateBoardOffers(game.player, game.world, tile, basicBounties)
            : basicBounties;

        // Show active bounties first
        let html = '<div style="max-height: 500px; overflow-y: auto;">';
        html += '<h4 style="margin-top: 0;">📋 Notice Board</h4>';

        // Active bounties
        if (game.player.activeBounties.length > 0) {
            html += '<div style="margin-bottom: 12px; padding: 8px; background: rgba(46,204,113,0.08); border: 1px solid rgba(46,204,113,0.3); border-radius: 6px;">';
            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #2ecc71; margin-bottom: 6px;">Active Bounties</div>';
            for (let i = 0; i < game.player.activeBounties.length; i++) {
                const b = game.player.activeBounties[i];
                const daysLeft = b.daysLimit - (b.daysElapsed || 0);
                const isDeliveryComplete = b.type === 'delivery' && game.player.q === b.destQ && game.player.r === b.destR;
                const isInstantComplete = b.type === 'instant' && game.player.q === b.fromQ && game.player.r === b.fromR;
                const onCriminalTarget = b.type === 'criminal_hunt' && b.status === 'active' && game.player.q === b.targetQ && game.player.r === b.targetR;
                const awaitingDecision = b.type === 'criminal_hunt' && b.status === 'captured_pending_decision';
                const locationHint = b.type === 'criminal_hunt'
                    ? `Last seen near (${b.targetQ}, ${b.targetR})`
                    : (b.destName ? `Destination: ${b.destName}` : '');

                let controls = '';
                if (isDeliveryComplete || isInstantComplete) {
                    controls = `<button onclick="window._completeBounty(${i})" style="margin-top: 4px; padding: 4px 12px; background: #2ecc71; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">✓ Complete</button>`;
                } else if (onCriminalTarget) {
                    controls = `<button onclick="window._attemptCriminalCapture(${i})" style="margin-top: 4px; padding: 4px 12px; background: #e67e22; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">⚔️ Capture</button>`;
                } else if (awaitingDecision) {
                    controls = `
                        <div style="display:flex; gap:6px; margin-top:6px;">
                            <button onclick="window._resolveCapturedBounty(${i}, 'turn_in')" style="padding: 4px 10px; background: #2ecc71; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Turn In</button>
                            <button onclick="window._resolveCapturedBounty(${i}, 'recruit')" style="padding: 4px 10px; background: #9b59b6; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color:#fff;">Recruit</button>
                        </div>
                    `;
                }

                html += `
                    <div style="padding: 8px; margin-bottom: 4px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                        <div><span style="font-size: 14px;">${b.icon}</span> <strong>${b.name}</strong> — <span style="color: var(--gold);">${b.actualPay}g</span></div>
                        <div style="font-size: 11px; color: #aaa;">${b.description}</div>
                        ${locationHint ? `<div style="font-size: 11px; color: #7db4ff;">📍 ${locationHint}</div>` : ''}
                        <div style="font-size: 11px; color: ${daysLeft <= 2 ? '#e74c3c' : '#aaa'};">⏳ ${daysLeft} days remaining</div>
                        ${controls}
                    </div>
                `;
            }
            html += '</div>';
        }

        // Available bounties
        html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin-bottom: 8px;">Available Bounties</div>';

        for (let i = 0; i < bounties.length; i++) {
            const b = bounties[i];
            const maxBounties = 3;
            const alreadyAccepted = game.player.activeBounties.some(active => active.id && b.id && active.id === b.id);
            const canAccept = game.player.activeBounties.length < maxBounties && !alreadyAccepted;
            const difficultyLabel = typeof b.difficulty === 'number' ? `Lv ${b.difficulty}` : b.difficulty;
            const isHighDanger = (typeof b.difficulty === 'number' ? b.difficulty >= 7 : b.difficulty === 'medium');

            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid ${isHighDanger ? '#f39c12' : '#3498db'}; ${!canAccept ? 'opacity: 0.5;' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div><span style="font-size: 16px;">${b.icon}</span> <strong>${b.name}</strong> <span style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${isHighDanger ? 'rgba(243,156,18,0.2)' : 'rgba(52,152,219,0.2)'}; color: ${isHighDanger ? '#f39c12' : '#3498db'};">${difficultyLabel}</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">${b.description}</div>
                            ${b.targetBackstory ? `<div style="font-size: 11px; color: #b9b9d6;">📖 ${b.targetBackstory}</div>` : ''}
                            <div style="font-size: 11px; color: #aaa;">⏳ ${b.daysLimit} day limit</div>
                        </div>
                        <button onclick="window._acceptBounty(${i})" ${!canAccept ? 'disabled' : ''}
                                style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; min-width: 80px;">
                            ${alreadyAccepted ? 'Taken' : `${b.actualPay}g`}
                        </button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Notice Board', html);

        window._acceptBounty = (idx) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const bounty = bounties[idx];
            if (!bounty) return;
            if (game.player.activeBounties.length >= 3) {
                game.ui.showNotification('Too Many', 'You can only have 3 active bounties. Complete some first.', 'error');
                return;
            }

            bounty.daysElapsed = 0;
            bounty.status = bounty.status || 'active';

            if (bounty.type === 'criminal_hunt') {
                game.player.activeBounties.push(bounty);
                if (game.player.bountyHunter && Array.isArray(game.player.bountyHunter.boardOffers) && bounty.id) {
                    game.player.bountyHunter.boardOffers = game.player.bountyHunter.boardOffers.filter(entry => entry.id !== bounty.id);
                }
                game.ui.showNotification('Bounty Accepted!', `${bounty.targetName} marked for capture. Last seen near (${bounty.targetQ}, ${bounty.targetR}).`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showBountyBoardMenu(game, tile);
                return;
            }

            // For instant bounties, resolve immediately with skill check
            if (bounty.type === 'instant') {
                const stat = bounty.stat || 'combat';
                const statVal = ActionMenu._getPlayerStat(game.player, stat);
                const roll = Math.random() * 10;
                const success = roll < statVal + 3;

                if (success) {
                    game.player.gold += bounty.actualPay;
                    game.player.renown += 2;
                    if (game.player.financeToday) {
                        game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + bounty.actualPay;
                    }
                    game.ui.showNotification('Bounty Complete!', `${bounty.name} — earned ${bounty.actualPay} gold!`, 'success');
                } else {
                    const dmg = Math.floor(Math.random() * 10) + 5;
                    game.player.health = Math.max(1, game.player.health - dmg);
                    game.ui.showNotification('Failed!', `${bounty.name} — you struggled and lost ${dmg} health.`, 'error');
                }
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
                game.endDay();
                return;
            }

            // For other bounties, add to active list
            game.player.activeBounties.push(bounty);
            game.ui.showNotification('Bounty Accepted!', `${bounty.name} — ${bounty.daysLimit} days to complete.`, 'success');
            game.ui.hideCustomPanel();
            ActionMenu.showBountyBoardMenu(game, tile); // Refresh
        };

        window._attemptCriminalCapture = (idx) => {
            const bounty = game.player.activeBounties[idx];
            if (!bounty || bounty.type !== 'criminal_hunt') return;
            if (typeof BountyHunting === 'undefined') return;

            if (bounty.status === 'captured_pending_decision') {
                ActionMenu._showCapturedBountyDecision(game, bounty, () => ActionMenu.showBountyBoardMenu(game, tile));
                return;
            }

            if (!(game.player.q === bounty.targetQ && game.player.r === bounty.targetR)) {
                game.ui.showNotification('Not Here', `${bounty.targetName} is no longer at this location.`, 'error');
                return;
            }

            const capture = BountyHunting.attemptCapture(game.player, bounty, game.world);
            if (!capture.success) {
                game.ui.showNotification('Escape!', capture.reason || 'The target escaped.', 'error');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showBountyBoardMenu(game, tile);
                return;
            }

            game.ui.showNotification('Target Captured!', `${bounty.targetName} is in your custody. Decide their fate.`, 'success');
            ActionMenu._showCapturedBountyDecision(game, bounty, () => ActionMenu.showBountyBoardMenu(game, tile));
        };

        window._resolveCapturedBounty = (idx, choice) => {
            const bounty = game.player.activeBounties[idx];
            if (!bounty || bounty.type !== 'criminal_hunt' || typeof BountyHunting === 'undefined') return;

            const resolution = BountyHunting.resolveCapturedTarget(game.player, bounty, choice);
            if (!resolution.success) {
                game.ui.showNotification('Unable', resolution.reason || 'Could not resolve bounty.', 'error');
                return;
            }

            if (resolution.turnedIn) {
                if (game.player.financeToday) {
                    game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + (resolution.pay || 0);
                }
                game.ui.showNotification('Bounty Turned In', `${bounty.targetName} delivered to authorities for ${resolution.pay}g.`, 'success');
            } else if (resolution.recruited) {
                game.ui.showNotification('Target Recruited', `${bounty.targetName} has joined your ranks.`, 'success');
            }

            game.ui.updateStats(game.player, game.world);
            ActionMenu.showBountyBoardMenu(game, tile);
        };

        window._completeBounty = (idx) => {
            const bounty = game.player.activeBounties[idx];
            if (!bounty) return;

            game.player.gold += bounty.actualPay;
            game.player.renown += 3;
            if (!game.player.bountiesCompleted) game.player.bountiesCompleted = 0;
            game.player.bountiesCompleted++;

            if (game.player.financeToday) {
                game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + bounty.actualPay;
            }

            game.player.activeBounties.splice(idx, 1);
            game.ui.showNotification('Bounty Complete!', `${bounty.name} — earned ${bounty.actualPay} gold!`, 'success');
            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
        };
    },

    doCaptureCriminal(game, tile) {
        if (typeof BountyHunting === 'undefined') {
            game.ui.showNotification('Unavailable', 'Bounty hunting system is unavailable.', 'error');
            return;
        }

        BountyHunting.initialize(game.player);

        const pending = (game.player.activeBounties || []).find(b => b.type === 'criminal_hunt' && b.status === 'captured_pending_decision');
        if (pending) {
            ActionMenu._showCapturedBountyDecision(game, pending);
            return;
        }

        const target = BountyHunting.getBountyTargetAtPlayer(game.player);
        if (!target) {
            game.ui.showNotification('No Target', 'No active criminal target is at your current location.', 'error');
            return;
        }

        const capture = BountyHunting.attemptCapture(game.player, target, game.world);
        if (!capture.success) {
            game.ui.showNotification('Escape!', capture.reason || 'The target escaped.', 'error');
            game.ui.updateStats(game.player, game.world);
            return;
        }

        game.ui.showNotification('Target Captured!', `${target.targetName} is now in your custody.`, 'success');
        ActionMenu._showCapturedBountyDecision(game, target);
    },

    _showCapturedBountyDecision(game, bounty, onDone = null) {
        if (!bounty || bounty.status !== 'captured_pending_decision') {
            game.ui.showNotification('Unavailable', 'No captured criminal awaits judgment.', 'error');
            return;
        }

        const html = `
            <div style="max-width: 520px;">
                <h3 style="margin-top: 0; color: #f5c542;">${bounty.icon || '⛓️'} Captured: ${bounty.targetName}</h3>
                <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Crime: ${bounty.crime || 'Unknown offenses'}</div>
                <div style="font-size: 12px; color: #b9b9d6; margin-bottom: 12px;">${bounty.targetBackstory || ''}</div>

                <div style="padding: 10px; background: rgba(46, 204, 113, 0.08); border: 1px solid rgba(46, 204, 113, 0.35); border-radius: 6px; margin-bottom: 10px;">
                    <strong>Turn In</strong>
                    <div style="font-size: 12px; color: #bfc9d4; margin-top: 4px;">Receive ${bounty.actualPay}g and renown for delivering the criminal.</div>
                </div>

                <div style="padding: 10px; background: rgba(155, 89, 182, 0.1); border: 1px solid rgba(155, 89, 182, 0.35); border-radius: 6px; margin-bottom: 12px;">
                    <strong>Recruit</strong>
                    <div style="font-size: 12px; color: #d7c8e4; margin-top: 4px;">Gain a unique recruit (${bounty.recruitedUnit?.strength || '?'} strength) but take a minor karma penalty.</div>
                </div>

                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button onclick="window._resolveCapturedTarget('turn_in')" style="padding: 8px 14px; border: none; border-radius: 5px; background: #2ecc71; font-weight: bold; cursor: pointer;">Turn In</button>
                    <button onclick="window._resolveCapturedTarget('recruit')" style="padding: 8px 14px; border: none; border-radius: 5px; background: #9b59b6; color:#fff; font-weight: bold; cursor: pointer;">Recruit</button>
                </div>
            </div>
        `;

        game.ui.showCustomPanel('Captured Criminal', html);

        window._resolveCapturedTarget = (choice) => {
            const resolution = BountyHunting.resolveCapturedTarget(game.player, bounty, choice);
            if (!resolution.success) {
                game.ui.showNotification('Unable', resolution.reason || 'Could not resolve bounty.', 'error');
                return;
            }

            if (resolution.turnedIn) {
                if (game.player.financeToday) {
                    game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + (resolution.pay || 0);
                }
                game.ui.showNotification('Bounty Turned In', `${bounty.targetName} delivered for ${resolution.pay} gold.`, 'success');
            } else if (resolution.recruited) {
                game.ui.showNotification('Recruit Joined', `${bounty.targetName} joins your army as a hardened outlaw.`, 'success');
            }

            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
            if (typeof onDone === 'function') onDone();
        };
    },

    /**
     * Show gambling menu — pick a minigame
     */
    showGamblingMenu(game, tile) {
        const gold = game.player.gold;
        // Check if player owns a tavern here
        const ownsTavern = tile.playerProperties && tile.playerProperties.some(p => p.type === 'tavern' && !p.underConstruction);
        const tavernTables = ownsTavern ? (tile.playerProperties.find(p => p.type === 'tavern')?.gamblingTables || 0) : 0;

        const minigames = [
            { id: 'crown_anchor', name: 'Crown & Anchor', icon: '🎲', desc: 'Pick a symbol, roll 3 dice. The more matches, the bigger the payout!', minBet: 5, color: '#9b59b6' },
            { id: 'dragons_flip', name: "Dragon's Flip", icon: '🐉', desc: 'Call Dragon or Shield. Double or nothing — simple and deadly.', minBet: 10, color: '#e67e22' },
            { id: 'high_low', name: 'High-Low', icon: '🃏', desc: 'Guess if the next card is higher or lower. Build streaks for bigger payouts!', minBet: 5, color: '#2ecc71' },
        ];

        let html = '<div style="width: 100%; box-sizing: border-box;">';

        if (ownsTavern) {
            html += `<div style="padding: 10px 14px; margin-bottom: 12px; background: rgba(255,215,0,0.08); border: 1px solid rgba(255,215,0,0.3); border-radius: 6px; text-align: center;">
                <div style="font-size: 14px; color: var(--gold); font-weight: bold;">🍻 Your Tavern</div>
                <div style="font-size: 12px; color: var(--text-secondary);">House advantage! +5% luck bonus${tavernTables > 0 ? ` · ${tavernTables} table${tavernTables > 1 ? 's' : ''} (+${tavernTables * 2}% extra)` : ''} · No AP cost</div>
            </div>`;
        }

        html += '<h4 style="margin-top: 0; text-align: center;">🎲 Games of Chance</h4>';
        html += `<p style="font-size: 13px; color: var(--text-secondary); text-align: center; margin-bottom: 16px;">Your purse: <span style="color: var(--gold); font-weight: bold;">${gold} gold</span></p>`;

        for (const mg of minigames) {
            const canPlay = gold >= mg.minBet;
            html += `
                <button onclick="window._openMinigame('${mg.id}')" ${!canPlay ? 'disabled' : ''}
                    style="display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 16px; margin-bottom: 8px;
                           background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 4px solid ${mg.color};
                           border-radius: 8px; cursor: ${canPlay ? 'pointer' : 'not-allowed'}; text-align: left;
                           color: var(--text-primary); transition: all 0.15s; ${!canPlay ? 'opacity: 0.4;' : ''}"
                    onmouseenter="if(!this.disabled) this.style.background='rgba(255,255,255,0.08)'"
                    onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                    <span style="font-size: 32px; line-height: 1;">${mg.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-family: var(--font-display); font-size: 15px; color: var(--gold); margin-bottom: 3px;">${mg.name}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.3;">${mg.desc}</div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Min bet: ${mg.minBet}g</div>
                    </div>
                    <span style="font-size: 20px; color: var(--text-muted);">▶</span>
                </button>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('🎲 Gambling Den', html);

        window._openMinigame = (id) => {
            if (id === 'crown_anchor') ActionMenu._minigameCrownAnchor(game, tile);
            else if (id === 'dragons_flip') ActionMenu._minigameDragonsFlip(game, tile);
            else if (id === 'high_low') ActionMenu._minigameHighLow(game, tile);
        };
    },

    /**
     * Check AP and deduct for a gambling round. Returns false if can't play.
     */
    _gamblingCheckAP(game, tile) {
        // No AP cost at player's own tavern
        if (tile && tile.playerProperties && tile.playerProperties.some(p => p.type === 'tavern' && !p.underConstruction)) {
            return true;
        }
        const apCost = 2;
        if ((game.player.actionPoints || 0) < apCost) {
            game.ui.showNotification('⚡ No Action Points', `Each round costs ${apCost} AP. Rest to start a new day.`, 'error');
            return false;
        }
        game.player.actionPoints -= apCost;
        return true;
    },

    /**
     * Get the tavern luck bonus if player owns a tavern on this tile
     */
    _getTavernLuckBonus(tile) {
        if (!tile || !tile.playerProperties) return 0;
        const tavern = tile.playerProperties.find(p => p.type === 'tavern' && !p.underConstruction);
        if (!tavern) return 0;
        const tableBonus = (tavern.gamblingTables || 0) * 0.02;
        return 0.05 + tableBonus; // 5% base + 2% per table
    },

    /**
     * Record gambling winnings/losses in finance tracker
     */
    _gamblingFinance(game, netGold) {
        if (!game.player.financeToday) return;
        if (netGold > 0) {
            game.player.financeToday.income.gambling = (game.player.financeToday.income.gambling || 0) + netGold;
        } else if (netGold < 0) {
            game.player.financeToday.expenses = game.player.financeToday.expenses || {};
            game.player.financeToday.expenses.gambling = (game.player.financeToday.expenses.gambling || 0) + Math.abs(netGold);
        }
    },

    // ── MINIGAME 1: Crown & Anchor ──────────────────────────
    _minigameCrownAnchor(game, tile) {
        const gold = game.player.gold;
        const maxBet = Math.min(500, gold);
        const symbols = [
            { id: 'crown', icon: '👑', name: 'Crown' },
            { id: 'anchor', icon: '⚓', name: 'Anchor' },
            { id: 'heart', icon: '❤️', name: 'Heart' },
            { id: 'diamond', icon: '💎', name: 'Diamond' },
            { id: 'spade', icon: '♠️', name: 'Spade' },
            { id: 'club', icon: '♣️', name: 'Club' },
        ];

        let html = '<div style="width: 100%; box-sizing: border-box; text-align: center;">';
        html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <button onclick="ActionMenu.showGamblingMenu(window._gambGame, window._gambTile)" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px;">← Back</button>
                    <span style="color: var(--gold); font-weight: bold;">💰 ${gold}g</span>
                 </div>`;
        html += '<h4 style="margin: 0 0 4px;">🎲 Crown & Anchor</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">Pick a symbol and place your bet. Three dice are rolled — each match pays your bet!</p>';

        // Bet slider
        html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; justify-content: center;">
                    <span style="font-size: 12px; color: var(--text-secondary);">Bet:</span>
                    <input type="range" id="caBet" min="5" max="${maxBet}" value="${Math.min(25, maxBet)}" 
                           oninput="document.getElementById('caBetLabel').textContent = this.value"
                           style="width: 180px; accent-color: var(--gold);">
                    <span id="caBetLabel" style="color: var(--gold); font-weight: bold; min-width: 40px;">${Math.min(25, maxBet)}</span>g
                 </div>`;

        // Symbol grid
        html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Choose your symbol:</div>';
        html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">';
        for (const sym of symbols) {
            html += `<button onclick="window._caPickSymbol('${sym.id}')" id="caSym_${sym.id}"
                        style="padding: 12px 8px; background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.1);
                               border-radius: 8px; cursor: pointer; transition: all 0.15s; color: var(--text-primary);"
                        onmouseenter="this.style.borderColor='var(--gold)'" onmouseleave="if(!this.classList.contains('ca-selected')) this.style.borderColor='rgba(255,255,255,0.1)'">
                        <div style="font-size: 28px;">${sym.icon}</div>
                        <div style="font-size: 11px; margin-top: 4px;">${sym.name}</div>
                     </button>`;
        }
        html += '</div>';

        // Dice display area
        html += `<div id="caDiceArea" style="min-height: 80px; display: flex; justify-content: center; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <div style="font-size: 14px; color: var(--text-muted);">Pick a symbol and roll!</div>
                 </div>`;

        // Roll button
        html += `<button id="caRollBtn" onclick="window._caRoll()" disabled
                    style="padding: 10px 32px; background: #9b59b6; color: white; border: none; border-radius: 6px; cursor: pointer;
                           font-family: var(--font-display); font-size: 14px; letter-spacing: 1px; opacity: 0.5; transition: all 0.15s;">
                    🎲 Roll the Dice
                 </button>`;

        // Result area
        html += '<div id="caResult" style="margin-top: 12px; min-height: 24px;"></div>';
        html += '</div>';

        game.ui.showCustomPanel('🎲 Crown & Anchor', html);

        window._gambGame = game;
        window._gambTile = tile;
        let selectedSymbol = null;

        window._caPickSymbol = (symId) => {
            selectedSymbol = symId;
            // Visual selection
            for (const s of symbols) {
                const el = document.getElementById('caSym_' + s.id);
                if (el) {
                    if (s.id === symId) {
                        el.classList.add('ca-selected');
                        el.style.borderColor = 'var(--gold)';
                        el.style.background = 'rgba(245, 197, 66, 0.15)';
                    } else {
                        el.classList.remove('ca-selected');
                        el.style.borderColor = 'rgba(255,255,255,0.1)';
                        el.style.background = 'rgba(255,255,255,0.05)';
                    }
                }
            }
            const rollBtn = document.getElementById('caRollBtn');
            if (rollBtn) { rollBtn.disabled = false; rollBtn.style.opacity = '1'; }
        };

        window._caRoll = () => {
            if (!selectedSymbol) return;
            if (!ActionMenu._gamblingCheckAP(game, tile)) return;

            const bet = parseInt(document.getElementById('caBet')?.value || 25);
            if (bet > game.player.gold) {
                game.ui.showNotification('Not Enough', "You don't have enough gold!", 'error');
                return;
            }

            // Disable roll button during animation
            const rollBtn = document.getElementById('caRollBtn');
            if (rollBtn) { rollBtn.disabled = true; rollBtn.style.opacity = '0.5'; }

            // Roll 3 dice
            const luckBonus = Math.min((game.player.luck || 5) * 0.005, 0.05) + ActionMenu._getTavernLuckBonus(tile);
            const diceResults = [];
            for (let i = 0; i < 3; i++) {
                const r = Math.random();
                // Base 1/6 chance per die + slight luck bonus
                if (r < (1/6 + luckBonus)) {
                    diceResults.push(selectedSymbol);
                } else {
                    const others = symbols.filter(s => s.id !== selectedSymbol);
                    diceResults.push(others[Math.floor(Math.random() * others.length)].id);
                }
            }

            const matches = diceResults.filter(d => d === selectedSymbol).length;
            const diceArea = document.getElementById('caDiceArea');
            const resultArea = document.getElementById('caResult');

            // Animate dice rolling
            let rollCount = 0;
            const rollInterval = setInterval(() => {
                const randomIcons = [0, 1, 2].map(() => symbols[Math.floor(Math.random() * symbols.length)]);
                if (diceArea) {
                    diceArea.innerHTML = randomIcons.map(s =>
                        `<div style="width: 64px; height: 64px; background: rgba(155,89,182,0.2); border: 2px solid #9b59b6; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px;">${s.icon}</div>`
                    ).join('');
                }
                rollCount++;
                if (rollCount >= 8) {
                    clearInterval(rollInterval);
                    // Show final results
                    const finalIcons = diceResults.map(id => symbols.find(s => s.id === id));
                    if (diceArea) {
                        diceArea.innerHTML = finalIcons.map(s => {
                            const isMatch = s.id === selectedSymbol;
                            return `<div style="width: 64px; height: 64px; background: ${isMatch ? 'rgba(46,204,113,0.2)' : 'rgba(255,255,255,0.05)'}; border: 2px solid ${isMatch ? '#2ecc71' : 'rgba(255,255,255,0.15)'}; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px; transition: all 0.3s;">${s.icon}</div>`;
                        }).join('');
                    }

                    // Calculate & apply result
                    if (matches === 0) {
                        game.player.gold -= bet;
                        ActionMenu._gamblingFinance(game, -bet);
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e74c3c; font-weight: bold; font-size: 14px;">No matches! Lost ${bet}g 💸</div>`;
                    } else {
                        const payout = bet * matches; // 1x per match, so 1 match = 1x, 2 = 2x, 3 = 3x
                        game.player.gold += payout; // net gain (doesn't deduct bet, matches pay bet each)
                        ActionMenu._gamblingFinance(game, payout);
                        const msg = matches === 3 ? '🎉 TRIPLE MATCH! Jackpot!' : matches === 2 ? '✨ Double match!' : '👍 One match!';
                        if (resultArea) resultArea.innerHTML = `<div style="color: #2ecc71; font-weight: bold; font-size: 14px;">${msg} Won ${payout}g!</div>`;
                    }
                    game.ui.updateStats(game.player, game.world);

                    // Re-enable after result
                    setTimeout(() => {
                        if (rollBtn && game.player.gold >= 5) { rollBtn.disabled = false; rollBtn.style.opacity = '1'; }
                        // Update gold display
                        const panel = document.getElementById('customPanel');
                        if (panel) {
                            const goldSpan = panel.querySelector('span[style*="font-weight: bold"]');
                            if (goldSpan && goldSpan.textContent.includes('g')) goldSpan.textContent = game.player.gold + 'g';
                        }
                    }, 600);
                }
            }, 100);
        };
    },

    // ── MINIGAME 2: Dragon's Flip ───────────────────────────
    _minigameDragonsFlip(game, tile) {
        const gold = game.player.gold;
        const maxBet = Math.min(500, gold);

        let html = '<div style="width: 100%; box-sizing: border-box; text-align: center;">';
        html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <button onclick="ActionMenu.showGamblingMenu(window._gambGame, window._gambTile)" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px;">← Back</button>
                    <span style="color: var(--gold); font-weight: bold;">💰 ${gold}g</span>
                 </div>`;
        html += '<h4 style="margin: 0 0 4px;">🐉 Dragon\'s Flip</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">Call the coin — Dragon or Shield. Double or nothing!</p>';

        // Bet slider
        html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; justify-content: center;">
                    <span style="font-size: 12px; color: var(--text-secondary);">Bet:</span>
                    <input type="range" id="dfBet" min="10" max="${maxBet}" value="${Math.min(25, maxBet)}"
                           oninput="document.getElementById('dfBetLabel').textContent = this.value"
                           style="width: 180px; accent-color: var(--gold);">
                    <span id="dfBetLabel" style="color: var(--gold); font-weight: bold; min-width: 40px;">${Math.min(25, maxBet)}</span>g
                 </div>`;

        // Coin display
        html += `<div id="dfCoinArea" style="margin: 20px auto; width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(135deg, #c49a2a, #f5c542); display: flex; align-items: center; justify-content: center; font-size: 48px; box-shadow: 0 4px 20px rgba(245,197,66,0.3); transition: transform 0.1s;">
                    ❓
                 </div>`;

        // Choice buttons
        html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">Make your call:</div>';
        html += `<div style="display: flex; gap: 12px; justify-content: center; margin-bottom: 16px;">
                    <button onclick="window._dfFlip('dragon')" id="dfDragonBtn"
                        style="padding: 12px 28px; background: rgba(231,76,60,0.15); border: 2px solid #e74c3c;
                               border-radius: 8px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; font-size: 14px;"
                        onmouseenter="this.style.background='rgba(231,76,60,0.3)'" onmouseleave="this.style.background='rgba(231,76,60,0.15)'">
                        🐉 Dragon
                    </button>
                    <button onclick="window._dfFlip('shield')" id="dfShieldBtn"
                        style="padding: 12px 28px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; font-size: 14px;"
                        onmouseenter="this.style.background='rgba(52,152,219,0.3)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        🛡️ Shield
                    </button>
                 </div>`;

        // Result
        html += '<div id="dfResult" style="min-height: 24px; margin-top: 8px;"></div>';

        // Double or nothing option (hidden initially)
        html += '<div id="dfDoubleArea" style="display: none; margin-top: 12px;"></div>';

        html += '</div>';

        game.ui.showCustomPanel("🐉 Dragon's Flip", html);
        window._gambGame = game;
        window._gambTile = tile;
        let currentWinnings = 0;

        window._dfFlip = (call) => {
            if (!ActionMenu._gamblingCheckAP(game, tile)) return;

            const bet = parseInt(document.getElementById('dfBet')?.value || 25);
            if (bet > game.player.gold) {
                game.ui.showNotification('Not Enough', "You don't have enough gold!", 'error');
                return;
            }

            // Disable buttons during flip
            const dragonBtn = document.getElementById('dfDragonBtn');
            const shieldBtn = document.getElementById('dfShieldBtn');
            if (dragonBtn) dragonBtn.disabled = true;
            if (shieldBtn) shieldBtn.disabled = true;

            const coinArea = document.getElementById('dfCoinArea');
            const resultArea = document.getElementById('dfResult');
            const doubleArea = document.getElementById('dfDoubleArea');

            // Coin flip animation
            let flipCount = 0;
            const faces = ['🐉', '🛡️'];
            const flipInterval = setInterval(() => {
                if (coinArea) {
                    coinArea.textContent = faces[flipCount % 2];
                    coinArea.style.transform = `rotateY(${flipCount * 180}deg) scale(${1 + Math.sin(flipCount * 0.5) * 0.1})`;
                }
                flipCount++;
                if (flipCount >= 12) {
                    clearInterval(flipInterval);

                    // Determine result
                    const luckBonus = Math.min((game.player.luck || 5) * 0.008, 0.05) + ActionMenu._getTavernLuckBonus(tile);
                    const winChance = 0.48 + luckBonus;
                    const result = Math.random() < winChance ? call : (call === 'dragon' ? 'shield' : 'dragon');
                    const won = result === call;
                    const resultIcon = result === 'dragon' ? '🐉' : '🛡️';
                    const resultName = result === 'dragon' ? 'Dragon' : 'Shield';

                    if (coinArea) {
                        coinArea.textContent = resultIcon;
                        coinArea.style.transform = 'rotateY(0deg) scale(1)';
                        coinArea.style.boxShadow = won
                            ? '0 4px 30px rgba(46,204,113,0.5)'
                            : '0 4px 30px rgba(231,76,60,0.5)';
                    }

                    if (won) {
                        const winAmount = bet * 2;
                        currentWinnings = winAmount;
                        game.player.gold += bet; // Net +bet (double minus the bet)
                        ActionMenu._gamblingFinance(game, bet);
                        if (resultArea) resultArea.innerHTML = `<div style="color: #2ecc71; font-weight: bold; font-size: 15px;">🎉 ${resultName}! You win ${winAmount}g!</div>`;

                        // Show double-or-nothing option
                        if (doubleArea) {
                            doubleArea.style.display = 'block';
                            doubleArea.innerHTML = `
                                <div style="padding: 12px; background: rgba(245,197,66,0.08); border: 1px solid var(--border-color); border-radius: 8px;">
                                    <div style="font-size: 13px; color: var(--gold); margin-bottom: 8px;">🔥 Double or Nothing? (${currentWinnings}g at stake)</div>
                                    <div style="display: flex; gap: 10px; justify-content: center;">
                                        <button onclick="window._dfDoubleOrNothing('dragon')" style="padding: 8px 20px; background: rgba(231,76,60,0.2); border: 1px solid #e74c3c; border-radius: 6px; cursor: pointer; color: var(--text-primary);">🐉 Dragon</button>
                                        <button onclick="window._dfDoubleOrNothing('shield')" style="padding: 8px 20px; background: rgba(52,152,219,0.2); border: 1px solid #3498db; border-radius: 6px; cursor: pointer; color: var(--text-primary);">🛡️ Shield</button>
                                        <button onclick="window._dfCashOut()" style="padding: 8px 20px; background: rgba(46,204,113,0.2); border: 1px solid #2ecc71; border-radius: 6px; cursor: pointer; color: #2ecc71; font-weight: bold;">💰 Cash Out</button>
                                    </div>
                                </div>`;
                        }
                    } else {
                        game.player.gold -= bet;
                        ActionMenu._gamblingFinance(game, -bet);
                        currentWinnings = 0;
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e74c3c; font-weight: bold; font-size: 15px;">💸 ${resultName}! You lose ${bet}g.</div>`;
                        if (doubleArea) doubleArea.style.display = 'none';

                        // Re-enable buttons
                        setTimeout(() => {
                            if (dragonBtn && game.player.gold >= 10) dragonBtn.disabled = false;
                            if (shieldBtn && game.player.gold >= 10) shieldBtn.disabled = false;
                        }, 600);
                    }

                    game.ui.updateStats(game.player, game.world);
                }
            }, 80);
        };

        window._dfDoubleOrNothing = (call) => {
            const coinArea = document.getElementById('dfCoinArea');
            const resultArea = document.getElementById('dfResult');
            const doubleArea = document.getElementById('dfDoubleArea');

            let flipCount = 0;
            const faces = ['🐉', '🛡️'];
            const flipInterval = setInterval(() => {
                if (coinArea) {
                    coinArea.textContent = faces[flipCount % 2];
                    coinArea.style.transform = `rotateY(${flipCount * 180}deg)`;
                }
                flipCount++;
                if (flipCount >= 10) {
                    clearInterval(flipInterval);

                    const luckBonus = Math.min((game.player.luck || 5) * 0.006, 0.04) + ActionMenu._getTavernLuckBonus(tile);
                    const result = Math.random() < (0.46 + luckBonus) ? call : (call === 'dragon' ? 'shield' : 'dragon');
                    const won = result === call;
                    const resultIcon = result === 'dragon' ? '🐉' : '🛡️';

                    if (coinArea) {
                        coinArea.textContent = resultIcon;
                        coinArea.style.transform = 'rotateY(0deg)';
                    }

                    if (won) {
                        currentWinnings *= 2;
                        game.player.gold += currentWinnings / 2; // Double the previous winnings
                        ActionMenu._gamblingFinance(game, currentWinnings / 2);
                        if (resultArea) resultArea.innerHTML = `<div style="color: #2ecc71; font-weight: bold; font-size: 15px;">🔥 DOUBLED! Winnings: ${currentWinnings}g!</div>`;
                        // Update double-or-nothing display
                        if (doubleArea) {
                            doubleArea.innerHTML = `
                                <div style="padding: 12px; background: rgba(245,197,66,0.08); border: 1px solid var(--border-color); border-radius: 8px;">
                                    <div style="font-size: 13px; color: var(--gold); margin-bottom: 8px;">🔥🔥 Double again? (${currentWinnings}g at stake!)</div>
                                    <div style="display: flex; gap: 10px; justify-content: center;">
                                        <button onclick="window._dfDoubleOrNothing('dragon')" style="padding: 8px 20px; background: rgba(231,76,60,0.2); border: 1px solid #e74c3c; border-radius: 6px; cursor: pointer; color: var(--text-primary);">🐉 Dragon</button>
                                        <button onclick="window._dfDoubleOrNothing('shield')" style="padding: 8px 20px; background: rgba(52,152,219,0.2); border: 1px solid #3498db; border-radius: 6px; cursor: pointer; color: var(--text-primary);">🛡️ Shield</button>
                                        <button onclick="window._dfCashOut()" style="padding: 8px 20px; background: rgba(46,204,113,0.2); border: 1px solid #2ecc71; border-radius: 6px; cursor: pointer; color: #2ecc71; font-weight: bold;">💰 Cash Out</button>
                                    </div>
                                </div>`;
                        }
                    } else {
                        // Lose everything from double-or-nothing
                        game.player.gold -= currentWinnings / 2;
                        ActionMenu._gamblingFinance(game, -(currentWinnings / 2));
                        currentWinnings = 0;
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e74c3c; font-weight: bold; font-size: 15px;">💀 Bust! Lost it all on the double!</div>`;
                        if (doubleArea) doubleArea.style.display = 'none';
                        coinArea.style.boxShadow = '0 4px 30px rgba(231,76,60,0.5)';

                        // Re-enable main buttons
                        setTimeout(() => {
                            const dragonBtn = document.getElementById('dfDragonBtn');
                            const shieldBtn = document.getElementById('dfShieldBtn');
                            if (dragonBtn && game.player.gold >= 10) dragonBtn.disabled = false;
                            if (shieldBtn && game.player.gold >= 10) shieldBtn.disabled = false;
                        }, 600);
                    }
                    game.ui.updateStats(game.player, game.world);
                }
            }, 80);
        };

        window._dfCashOut = () => {
            game.ui.showNotification('💰 Cashed Out!', `You walk away with ${currentWinnings}g in your pocket.`, 'success');
            currentWinnings = 0;
            const doubleArea = document.getElementById('dfDoubleArea');
            if (doubleArea) doubleArea.style.display = 'none';
            const dragonBtn = document.getElementById('dfDragonBtn');
            const shieldBtn = document.getElementById('dfShieldBtn');
            if (dragonBtn) dragonBtn.disabled = false;
            if (shieldBtn) shieldBtn.disabled = false;
            const coinArea = document.getElementById('dfCoinArea');
            if (coinArea) { coinArea.textContent = '❓'; coinArea.style.boxShadow = '0 4px 20px rgba(245,197,66,0.3)'; }
            const resultArea = document.getElementById('dfResult');
            if (resultArea) resultArea.innerHTML = '';
        };
    },

    // ── MINIGAME 3: High-Low ────────────────────────────────
    _minigameHighLow(game, tile) {
        const gold = game.player.gold;
        const maxBet = Math.min(200, gold);

        const cardValues = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        const cardSuits = ['♠', '♥', '♦', '♣'];
        const cardNumeric = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
        const suitColors = { '♠': '#aaa', '♥': '#e74c3c', '♦': '#3498db', '♣': '#2ecc71' };

        const drawCard = () => {
            const value = cardValues[Math.floor(Math.random() * cardValues.length)];
            const suit = cardSuits[Math.floor(Math.random() * cardSuits.length)];
            return { value, suit, numeric: cardNumeric[value] };
        };

        const renderCard = (card, faceDown = false) => {
            if (faceDown) {
                return `<div style="width: 80px; height: 110px; background: linear-gradient(135deg, #2c3e50, #34495e); border: 2px solid var(--border-bright); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">🂠</div>`;
            }
            const color = suitColors[card.suit] || '#aaa';
            return `<div style="width: 80px; height: 110px; background: linear-gradient(135deg, #1a1a2e, #16213e); border: 2px solid ${color}; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                        <div style="font-size: 24px; font-weight: bold; color: ${color}; font-family: var(--font-display);">${card.value}</div>
                        <div style="font-size: 20px; color: ${color};">${card.suit}</div>
                    </div>`;
        };

        let currentCard = drawCard();
        let revealedCard = null;
        let streak = 0;
        let bet = 0;
        let inRound = false;

        const renderHL = () => {
            let html = '<div style="width: 100%; box-sizing: border-box; text-align: center;">';
            html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <button onclick="ActionMenu.showGamblingMenu(window._gambGame, window._gambTile)" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px;">← Back</button>
                        <span style="color: var(--gold); font-weight: bold;">💰 ${game.player.gold}g</span>
                     </div>`;
            html += '<h4 style="margin: 0 0 4px;">🃏 High-Low</h4>';
            html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">Guess if the next card is Higher or Lower. Keep your streak for bigger payouts!</p>';

            if (!inRound) {
                // Bet phase
                html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; justify-content: center;">
                            <span style="font-size: 12px; color: var(--text-secondary);">Bet:</span>
                            <input type="range" id="hlBet" min="5" max="${Math.min(200, game.player.gold)}" value="${Math.min(20, game.player.gold)}"
                                   oninput="document.getElementById('hlBetLabel').textContent = this.value"
                                   style="width: 180px; accent-color: var(--gold);">
                            <span id="hlBetLabel" style="color: var(--gold); font-weight: bold; min-width: 40px;">${Math.min(20, game.player.gold)}</span>g
                         </div>`;

                html += `<div style="display: flex; justify-content: center; gap: 16px; margin-bottom: 16px;">
                            ${renderCard(currentCard)}
                            ${revealedCard ? renderCard(revealedCard) : renderCard(null, true)}
                         </div>`;

                html += `<button onclick="window._hlStartRound()" 
                            style="padding: 10px 32px; background: #2ecc71; color: white; border: none; border-radius: 6px; cursor: pointer;
                                   font-family: var(--font-display); font-size: 14px; letter-spacing: 1px;">
                            Deal & Start
                         </button>`;
            } else {
                // Playing phase
                const multiplier = 1 + streak * 0.5;
                const potentialWin = Math.floor(bet * multiplier);

                html += `<div style="display: flex; justify-content: center; gap: 24px; margin-bottom: 8px;">
                            <div style="font-size: 12px; color: var(--text-secondary);">Streak: <span style="color: ${streak > 0 ? '#2ecc71' : 'var(--text-muted)'}; font-weight: bold;">${streak}</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">Multiplier: <span style="color: var(--gold); font-weight: bold;">${multiplier.toFixed(1)}x</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">Pot: <span style="color: #2ecc71; font-weight: bold;">${potentialWin}g</span></div>
                         </div>`;

                html += `<div style="display: flex; justify-content: center; gap: 16px; margin: 20px 0;">
                            ${renderCard(currentCard)}
                            ${revealedCard ? renderCard(revealedCard) : renderCard(null, true)}
                         </div>`;

                html += `<div style="display: flex; gap: 10px; justify-content: center; margin-bottom: 12px;">
                            <button onclick="window._hlGuess('higher')"
                                style="padding: 10px 24px; background: rgba(46,204,113,0.2); border: 2px solid #2ecc71;
                                       border-radius: 8px; cursor: pointer; color: var(--text-primary); font-size: 14px; transition: all 0.15s;"
                                onmouseenter="this.style.background='rgba(46,204,113,0.35)'" onmouseleave="this.style.background='rgba(46,204,113,0.2)'">
                                ⬆️ Higher
                            </button>
                            <button onclick="window._hlCashOut()"
                                style="padding: 10px 24px; background: rgba(245,197,66,0.15); border: 2px solid var(--gold);
                                       border-radius: 8px; cursor: pointer; color: var(--gold); font-weight: bold; font-size: 14px; transition: all 0.15s;"
                                onmouseenter="this.style.background='rgba(245,197,66,0.25)'" onmouseleave="this.style.background='rgba(245,197,66,0.15)'"
                                ${streak === 0 ? 'disabled style="opacity:0.4; pointer-events:none; padding: 10px 24px; background: rgba(245,197,66,0.15); border: 2px solid var(--gold); border-radius: 8px; color: var(--gold); font-weight: bold; font-size: 14px;"' : ''}>
                                💰 Cash Out (${potentialWin}g)
                            </button>
                            <button onclick="window._hlGuess('lower')"
                                style="padding: 10px 24px; background: rgba(231,76,60,0.2); border: 2px solid #e74c3c;
                                       border-radius: 8px; cursor: pointer; color: var(--text-primary); font-size: 14px; transition: all 0.15s;"
                                onmouseenter="this.style.background='rgba(231,76,60,0.35)'" onmouseleave="this.style.background='rgba(231,76,60,0.2)'">
                                ⬇️ Lower
                            </button>
                         </div>`;
            }

            html += '<div id="hlResult" style="min-height: 24px; margin-top: 8px;"></div>';
            html += '</div>';
            return html;
        };

        game.ui.showCustomPanel('🃏 High-Low', renderHL());
        window._gambGame = game;
        window._gambTile = tile;

        window._hlStartRound = () => {
            if (!ActionMenu._gamblingCheckAP(game, tile)) return;
            bet = parseInt(document.getElementById('hlBet')?.value || 20);
            if (bet > game.player.gold) {
                game.ui.showNotification('Not Enough', "You don't have enough gold!", 'error');
                return;
            }
            game.player.gold -= bet;
            game.ui.updateStats(game.player, game.world);
            currentCard = drawCard();
            revealedCard = null;
            streak = 0;
            inRound = true;
            game.ui.showCustomPanel('🃏 High-Low', renderHL());
        };

        window._hlGuess = (guess) => {
            const nextCard = drawCard();
            const oldCard = currentCard;

            // Determine winner
            let correct = false;
            if (guess === 'higher') correct = nextCard.numeric > oldCard.numeric;
            else correct = nextCard.numeric < oldCard.numeric;

            // Tie = push (re-draw, no penalty)
            if (nextCard.numeric === oldCard.numeric) {
                revealedCard = nextCard;
                game.ui.showCustomPanel('🃏 High-Low', renderHL());
                setTimeout(() => {
                    const res = document.getElementById('hlResult');
                    if (res) res.innerHTML = `<div style="color: var(--gold); font-size: 13px;">🤝 Tie! Same value — draw again.</div>`;
                }, 50);
                // After a brief pause, advance to next draw
                setTimeout(() => { revealedCard = null; currentCard = nextCard; game.ui.showCustomPanel('🃏 High-Low', renderHL()); }, 1500);
                return;
            }

            if (correct) {
                streak++;
                revealedCard = nextCard;
                game.ui.showCustomPanel('🃏 High-Low', renderHL());
                setTimeout(() => {
                    const res = document.getElementById('hlResult');
                    if (res) res.innerHTML = `<div style="color: #2ecc71; font-size: 13px;">✅ Correct! ${nextCard.value}${nextCard.suit} — Streak: ${streak}!</div>`;
                }, 50);
                // After a brief pause, shift the revealed card to become the current card
                setTimeout(() => { revealedCard = null; currentCard = nextCard; game.ui.showCustomPanel('🃏 High-Low', renderHL()); }, 1500);
            } else {
                // Lose
                ActionMenu._gamblingFinance(game, -bet);
                revealedCard = nextCard;
                inRound = false;
                game.ui.showCustomPanel('🃏 High-Low', renderHL());
                setTimeout(() => {
                    const res = document.getElementById('hlResult');
                    if (res) res.innerHTML = `<div style="color: #e74c3c; font-size: 14px; font-weight: bold;">❌ Wrong! It was ${nextCard.value}${nextCard.suit}. Lost ${bet}g! 💸</div>`;
                }, 50);
                // After showing the result, reset for next round
                setTimeout(() => { revealedCard = null; currentCard = drawCard(); game.ui.showCustomPanel('🃏 High-Low', renderHL()); }, 2000);
                game.ui.updateStats(game.player, game.world);
            }
        };

        window._hlCashOut = () => {
            if (streak === 0) return;
            const multiplier = 1 + streak * 0.5;
            const winnings = Math.floor(bet * multiplier);
            game.player.gold += winnings;
            ActionMenu._gamblingFinance(game, winnings - bet);
            game.ui.showNotification('💰 Cashed Out!', `Streak of ${streak}! Won ${winnings}g (${multiplier.toFixed(1)}x)!`, 'success');
            inRound = false;
            streak = 0;
            revealedCard = null;
            currentCard = drawCard();
            game.ui.showCustomPanel('🃏 High-Low', renderHL());
            game.ui.updateStats(game.player, game.world);
        };
    },

    /**
     * Show busking / street performance menu
     */
    showBuskingMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        const performances = ActionMenu._getBuskingData();
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' ? 'town' : 'village');
        const crowdMultiplier = { village: 0.5, town: 1.0, capital: 1.8 }[tier] || 1.0;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🎭 Street Performance</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Pick a performance to entertain the crowd in ${settlement.name}.</p>`;
        html += `<p style="font-size: 11px; color: #aaa; margin-bottom: 12px;">Crowd size: <span style="color: var(--gold);">${tier === 'capital' ? 'Large' : tier === 'town' ? 'Moderate' : 'Small'}</span> (${crowdMultiplier}x)</p>`;

        for (const perf of performances) {
            const statVal = ActionMenu._getPlayerStat(game.player, perf.stat);
            const statLabel = perf.stat.charAt(0).toUpperCase() + perf.stat.slice(1);

            html += `
                <button onclick="window._startBuskPerf('${perf.id}')"
                    style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 8px;
                           background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid #e67e22;
                           border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                    onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                    <span style="font-size: 28px;">${perf.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 13px;">${perf.name}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${perf.description}</div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${statLabel}: ${statVal}</div>
                    </div>
                    <div style="font-size: 12px; color: #e67e22; font-weight: 600;">▶ Play</div>
                </button>
            `;
        }

        html += `<button onclick="game.ui.hideCustomPanel();"
            style="margin-top: 6px; padding: 8px 20px; background: none; border: 1px solid rgba(255,255,255,0.1);
                   border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">
            Cancel
        </button>`;
        html += '</div>';
        game.ui.showCustomPanel('Street Performance', html);

        window._startBuskPerf = (perfId) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const perf = performances.find(p => p.id === perfId);
            ActionMenu._showMinigamePrompt(game, {
                title: `🎭 ${perf ? perf.name : perfId}`,
                icon: perf ? perf.icon : '🎭',
                description: perf ? perf.description : 'Perform for the crowd.',
                baseRewardText: `~${perf ? perf.basePay.min : 5}g (average show)`,
                onSkip: () => {
                    // Feed 40% score = mediocre performance
                    ActionMenu._buskingReward(game, tile, crowdMultiplier, perfId, 40);
                },
                onPlay: () => {
                    switch (perfId) {
                        case 'juggling': ActionMenu._buskJuggling(game, tile, crowdMultiplier); break;
                        case 'singing': ActionMenu._buskSinging(game, tile, crowdMultiplier); break;
                        case 'storytelling': ActionMenu._buskStorytelling(game, tile, crowdMultiplier); break;
                        case 'fortune_telling': ActionMenu._buskFortuneTelling(game, tile, crowdMultiplier); break;
                        case 'preaching': ActionMenu._buskPreaching(game, tile, crowdMultiplier); break;
                    }
                }
            });
        };
    },

    /**
     * Common reward handler for all busking minigames.
     * scorePercent: 0-100 how well the player performed
     */
    _buskingReward(game, tile, crowdMultiplier, perfId, scorePercent) {
        const perf = ActionMenu._getBuskingData().find(p => p.id === perfId);
        if (!perf) return;

        const player = game.player;
        const statVal = ActionMenu._getPlayerStat(player, perf.stat);
        const basePay = perf.basePay.min + Math.floor(Math.random() * (perf.basePay.max - perf.basePay.min + 1));
        const qualityMult = 0.2 + (scorePercent / 100) * 1.3;
        const actualPay = Math.max(1, Math.floor(basePay * crowdMultiplier * qualityMult * (1 + statVal * 0.08)));

        player.gold += actualPay;
        if (scorePercent >= 40) player.renown += 1;

        if (perf.bonusKarma && scorePercent >= 25) {
            player.karma = (player.karma || 0) + 1;
        }

        if (!player.performancesGiven) player.performancesGiven = 0;
        player.performancesGiven++;

        // Diplomacy skill up chance — better performance = better chance
        if (player.skills && Math.random() < 0.1 + scorePercent * 0.002) {
            player.skills.diplomacy = Math.min(10, (player.skills.diplomacy || 1) + 0.1);
        }

        // Finance tracking
        if (player.financeToday) {
            player.financeToday.income.busking = (player.financeToday.income.busking || 0) + actualPay;
        }

        // Rating text
        const rating = scorePercent >= 90 ? 'Standing Ovation! 🌟' : scorePercent >= 70 ? 'Great Show! 👏' : scorePercent >= 50 ? 'Decent Performance 👍' : scorePercent >= 25 ? 'Rough Show 😐' : 'The crowd wandered off 😬';
        const ratingColor = scorePercent >= 90 ? '#f1c40f' : scorePercent >= 70 ? '#2ecc71' : scorePercent >= 50 ? '#3498db' : scorePercent >= 25 ? '#f39c12' : '#e74c3c';

        // Stars (0-5)
        const stars = Math.round(scorePercent / 20);
        let starsHtml = '';
        for (let i = 0; i < 5; i++) starsHtml += i < stars ? '⭐' : '☆';

        let html = '<div style="max-width: 450px; text-align: center;">';
        html += `<div style="font-size: 48px; margin: 16px 0;">${perf.icon}</div>`;
        html += `<div style="font-size: 18px; color: ${ratingColor}; font-weight: bold; margin-bottom: 6px;">${rating}</div>`;
        html += `<div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 10px;">${perf.name}</div>`;
        html += `<div style="margin-bottom: 12px; font-size: 20px; letter-spacing: 4px;">${starsHtml}</div>`;
        html += `<div style="font-size: 24px; color: var(--gold); font-weight: bold; margin: 8px 0;">+${actualPay} gold</div>`;
        if (scorePercent >= 40) html += `<div style="font-size: 12px; color: #9b59b6;">+1 Renown</div>`;
        if (perf.bonusKarma && scorePercent >= 25) html += `<div style="font-size: 12px; color: #2ecc71;">+1 Karma</div>`;

        html += `<button onclick="game.ui.hideCustomPanel();"
            style="padding: 10px 32px; margin-top: 16px; background: linear-gradient(135deg, var(--gold), #d4a030); color: #1a1a2e; border: none;
                   border-radius: 6px; cursor: pointer; font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;">
            Continue
        </button>`;
        html += '</div>';

        game.ui.showCustomPanel('🎭 Performance Complete', html);
        game.ui.updateStats(player, game.world);
        game.endDay();
    },

    // ── Busking Minigame: Juggling — Falling object catch game ──
    _buskJuggling(game, tile, crowdMultiplier) {
        const dex = ActionMenu._getPlayerStat(game.player, 'dexterity');
        const COLS = 5;
        const totalItems = 10;
        let itemsDropped = 0;
        let score = 0;
        let handPos = 2; // 0-4, which column the hand is in
        let fallingItems = []; // { col, y, icon, speed }
        let gameInterval = null;
        let spawnTimer = 0;
        let gameOver = false;

        const objects = ['🍎', '🍊', '🥚', '⚽', '💎', '🔥', '🌟', '🎪', '🏀', '🎾'];

        const cleanup = () => { if (gameInterval) { clearInterval(gameInterval); gameInterval = null; } };

        const render = () => {
            let html = '<div style="max-width: 400px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">🤹 Juggle & Tricks</h4>';
            html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">Catch: ${score}/${itemsDropped} · Remaining: ${totalItems - itemsDropped}</p>`;

            // Score bar
            const pct = itemsDropped > 0 ? Math.round((score / itemsDropped) * 100) : 100;
            const barCol = pct >= 70 ? '#2ecc71' : pct >= 40 ? '#f39c12' : '#e74c3c';
            html += `<div style="margin-bottom: 8px;">
                <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 8px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${barCol}; border-radius: 5px; transition: width 0.2s;"></div>
                </div>
            </div>`;

            // Play field — 5 columns x 6 rows
            const ROWS = 6;
            html += `<div style="position: relative; display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: 2px;
                       background: rgba(0,0,0,0.2); border-radius: 10px; padding: 4px; border: 1px solid rgba(255,255,255,0.08);
                       min-height: ${ROWS * 48}px;">`;

            // Render cells
            for (let y = 0; y < ROWS; y++) {
                for (let x = 0; x < COLS; x++) {
                    const isHandRow = y === ROWS - 1;
                    const isHand = isHandRow && x === handPos;
                    const fallingHere = fallingItems.find(f => f.col === x && Math.floor(f.y) === y);

                    let cellBg = 'rgba(255,255,255,0.02)';
                    let content = '';
                    if (isHand) {
                        cellBg = 'rgba(243,156,18,0.15)';
                        content = '🤲';
                    } else if (fallingHere) {
                        content = fallingHere.icon;
                    }
                    if (isHandRow && !isHand) {
                        cellBg = 'rgba(255,255,255,0.01)';
                    }

                    html += `<div style="height: 46px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                        background: ${cellBg}; font-size: ${isHand ? 24 : 22}px; transition: all 0.1s;">
                        ${content}
                    </div>`;
                }
            }
            html += '</div>';

            // Controls
            html += `<div style="display: flex; gap: 10px; justify-content: center; margin-top: 10px;">
                <button onclick="window._juggleMove(-1)"
                    style="padding: 12px 28px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                           border-radius: 8px; cursor: pointer; color: #3498db; font-size: 18px; font-weight: bold; user-select: none;"
                    onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                    ← Left
                </button>
                <button onclick="window._juggleMove(1)"
                    style="padding: 12px 28px; background: rgba(46,204,113,0.15); border: 2px solid #2ecc71;
                           border-radius: 8px; cursor: pointer; color: #2ecc71; font-size: 18px; font-weight: bold; user-select: none;"
                    onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                    Right →
                </button>
            </div>`;
            html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Move to catch falling objects!</div>`;
            html += '</div>';
            game.ui.showCustomPanel('🤹 Juggling', html);
        };

        render();

        // Game loop
        gameInterval = setInterval(() => {
            if (gameOver) return;

            // Spawn new item
            spawnTimer++;
            const spawnRate = Math.max(4, 10 - Math.floor(itemsDropped / 3)); // Spawn faster over time
            if (spawnTimer >= spawnRate && itemsDropped < totalItems) {
                spawnTimer = 0;
                const col = Math.floor(Math.random() * COLS);
                const speed = 0.6 + Math.random() * 0.3 + itemsDropped * 0.04; // Faster over time
                fallingItems.push({ col, y: 0, icon: objects[itemsDropped % objects.length], speed });
                itemsDropped++;
            }

            // Move items down
            for (let i = fallingItems.length - 1; i >= 0; i--) {
                const item = fallingItems[i];
                item.y += item.speed;

                // Check if reached bottom row (y >= 5)
                if (item.y >= 5) {
                    if (item.col === handPos) {
                        score++;
                    }
                    fallingItems.splice(i, 1);
                }
            }

            // Check game over
            if (itemsDropped >= totalItems && fallingItems.length === 0) {
                gameOver = true;
                cleanup();
                const pct = Math.round((score / totalItems) * 100);
                setTimeout(() => ActionMenu._buskingReward(game, tile, crowdMultiplier, 'juggling', pct), 400);
                return;
            }

            render();
        }, 250);

        window._juggleMove = (dir) => {
            if (gameOver) return;
            handPos = Math.max(0, Math.min(COLS - 1, handPos + dir));
            render();
        };

        // Keyboard support
        const keyHandler = (e) => {
            if (gameOver) { document.removeEventListener('keydown', keyHandler); return; }
            if (e.key === 'ArrowLeft' || e.key === 'a') { window._juggleMove(-1); }
            else if (e.key === 'ArrowRight' || e.key === 'd') { window._juggleMove(1); }
        };
        document.addEventListener('keydown', keyHandler);
    },

    // ── Busking Minigame: Singing — Pitch matching slider game ──
    _buskSinging(game, tile, crowdMultiplier) {
        const charisma = ActionMenu._getPlayerStat(game.player, 'charisma');
        const totalBeats = 12;
        let currentBeat = 0;
        let score = 0;
        let playerPitch = 50; // 0-100
        let targetPitch = 50; // 0-100 — drifts each beat
        let gameInterval = null;
        let gameOver = false;
        let lastResult = '';
        let crowdMood = 50;

        const noteIcons = ['🎵', '🎶', '🎼', '♪', '♫', '🎤'];

        const cleanup = () => { if (gameInterval) { clearInterval(gameInterval); gameInterval = null; } };

        const render = () => {
            let html = '<div style="max-width: 420px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">🎵 Sing Ballads</h4>';
            html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">Match your pitch to the glowing note! Beat ${currentBeat}/${totalBeats}</p>`;

            // Crowd mood bar
            const moodColor = crowdMood >= 60 ? '#2ecc71' : crowdMood >= 35 ? '#f39c12' : '#e74c3c';
            html += `<div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                    <span style="color: var(--text-muted);">Crowd Mood</span>
                    <span style="color: ${moodColor};">${Math.round(crowdMood)}%</span>
                </div>
                <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="width: ${crowdMood}%; height: 100%; background: ${moodColor}; transition: width 0.3s; border-radius: 5px;"></div>
                </div>
            </div>`;

            if (!gameOver) {
                // Pitch visualization — vertical bar with target and player markers
                html += `<div style="position: relative; height: 200px; width: 80px; margin: 0 auto 12px; background: rgba(0,0,0,0.2); border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);">`;
                // Target pitch zone (golden glow)
                const targetY = 100 - targetPitch;
                const tolerance = 8 + charisma;
                html += `<div style="position: absolute; left: 0; right: 0; top: ${Math.max(0, targetY - tolerance)}%; height: ${tolerance * 2}%;
                    background: rgba(243,156,18,0.15); border-top: 2px solid rgba(243,156,18,0.4); border-bottom: 2px solid rgba(243,156,18,0.4);"></div>`;
                // Target note
                html += `<div style="position: absolute; left: 50%; top: ${targetY}%; transform: translate(-50%, -50%); font-size: 20px;
                    opacity: 0.8; text-shadow: 0 0 10px rgba(243,156,18,0.6);">${noteIcons[currentBeat % noteIcons.length]}</div>`;
                // Player pitch marker
                const playerY = 100 - playerPitch;
                const diff = Math.abs(playerPitch - targetPitch);
                const markerColor = diff <= tolerance ? '#2ecc71' : diff <= tolerance * 2 ? '#f39c12' : '#e74c3c';
                html += `<div style="position: absolute; left: 50%; top: ${playerY}%; transform: translate(-50%, -50%);
                    font-size: 24px; filter: drop-shadow(0 0 8px ${markerColor}); transition: top 0.15s;">🎤</div>`;
                // Scale labels
                html += `<div style="position: absolute; right: -28px; top: 5%; font-size: 9px; color: var(--text-muted);">High</div>`;
                html += `<div style="position: absolute; right: -24px; bottom: 5%; font-size: 9px; color: var(--text-muted);">Low</div>`;
                html += '</div>';

                if (lastResult) html += `<div style="font-size: 13px; margin-bottom: 8px;">${lastResult}</div>`;

                // Pitch controls
                html += `<div style="display: flex; gap: 10px; justify-content: center;">
                    <button onmousedown="window._singPitch(1)" ontouchstart="window._singPitch(1)"
                        style="padding: 12px 28px; background: rgba(155,89,182,0.15); border: 2px solid #9b59b6;
                               border-radius: 8px; cursor: pointer; color: #9b59b6; font-size: 16px; font-weight: bold; user-select: none;"
                        onmouseenter="this.style.background='rgba(155,89,182,0.25)'" onmouseleave="this.style.background='rgba(155,89,182,0.15)'">
                        🔼 Higher
                    </button>
                    <button onmousedown="window._singPitch(-1)" ontouchstart="window._singPitch(-1)"
                        style="padding: 12px 28px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: #3498db; font-size: 16px; font-weight: bold; user-select: none;"
                        onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        🔽 Lower
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Adjust your pitch to match the golden note!</div>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🎵 Singing', html);
        };

        render();

        // Game loop — target pitch drifts, score is checked each beat
        gameInterval = setInterval(() => {
            if (gameOver) return;

            const tolerance = 8 + charisma;
            const diff = Math.abs(playerPitch - targetPitch);

            if (diff <= tolerance) {
                const quality = diff <= tolerance * 0.4 ? 'perfect' : 'good';
                if (quality === 'perfect') {
                    score += 10;
                    crowdMood = Math.min(100, crowdMood + 5);
                    lastResult = '<span style="color: #f1c40f;">✨ Perfect pitch!</span>';
                } else {
                    score += 6;
                    crowdMood = Math.min(100, crowdMood + 2);
                    lastResult = '<span style="color: #2ecc71;">🎵 Good!</span>';
                }
            } else if (diff <= tolerance * 2.5) {
                score += 2;
                lastResult = '<span style="color: #f39c12;">~ Close...</span>';
            } else {
                crowdMood = Math.max(0, crowdMood - 4);
                lastResult = '<span style="color: #e74c3c;">🔇 Off-key!</span>';
            }

            currentBeat++;

            // Drift target pitch
            const drift = (Math.random() - 0.5) * 25;
            targetPitch = Math.max(10, Math.min(90, targetPitch + drift));

            if (currentBeat >= totalBeats) {
                gameOver = true;
                cleanup();
                const pct = Math.min(100, Math.round(crowdMood));
                setTimeout(() => ActionMenu._buskingReward(game, tile, crowdMultiplier, 'singing', pct), 800);
                return;
            }

            render();
        }, 1200);

        window._singPitch = (dir) => {
            if (gameOver) return;
            const step = 8 + charisma * 0.5;
            playerPitch = Math.max(0, Math.min(100, playerPitch + dir * step));
            render();
        };
    },

    // ── Busking Minigame: Storytelling — Word chain story building ──
    _buskStorytelling(game, tile, crowdMultiplier) {
        const charisma = ActionMenu._getPlayerStat(game.player, 'charisma');
        let crowdMood = 40;
        let round = 0;
        const totalRounds = 5;
        let storyWords = [];
        let timeLeft = 100;
        let timerInterval = null;
        let currentChoices = [];
        let locked = false;

        // Word pools by story phase (opening, rising, climax, falling, ending)
        const wordPools = [
            { phase: 'Opening', icon: '📜', words: [
                { text: 'long ago', mood: 6, dramatic: false },
                { text: 'dark forest', mood: 8, dramatic: true },
                { text: 'brave hero', mood: 7, dramatic: false },
                { text: 'ancient curse', mood: 10, dramatic: true },
                { text: 'quiet village', mood: 4, dramatic: false },
                { text: 'mysterious stranger', mood: 9, dramatic: true },
            ]},
            { phase: 'Rising', icon: '📈', words: [
                { text: 'dangerous quest', mood: 9, dramatic: true },
                { text: 'hidden treasure', mood: 8, dramatic: true },
                { text: 'loyal companion', mood: 6, dramatic: false },
                { text: 'treacherous path', mood: 10, dramatic: true },
                { text: 'gathering supplies', mood: 3, dramatic: false },
                { text: 'wise old sage', mood: 7, dramatic: false },
            ]},
            { phase: 'Climax', icon: '⚔️', words: [
                { text: 'fierce battle', mood: 12, dramatic: true },
                { text: 'terrible betrayal', mood: 11, dramatic: true },
                { text: 'dragon awakened', mood: 14, dramatic: true },
                { text: 'clever trick', mood: 8, dramatic: false },
                { text: 'magic sword', mood: 10, dramatic: true },
                { text: 'wrote a letter', mood: -4, dramatic: false },
            ]},
            { phase: 'Falling', icon: '💫', words: [
                { text: 'costly sacrifice', mood: 10, dramatic: true },
                { text: 'unexpected ally', mood: 9, dramatic: true },
                { text: 'shattered crown', mood: 11, dramatic: true },
                { text: 'peaceful dawn', mood: 7, dramatic: false },
                { text: 'bittersweet', mood: 8, dramatic: false },
                { text: 'tax policy', mood: -6, dramatic: false },
            ]},
            { phase: 'Ending', icon: '🌅', words: [
                { text: 'happily ever after', mood: 8, dramatic: false },
                { text: 'legend lives on', mood: 12, dramatic: true },
                { text: 'to be continued...', mood: 10, dramatic: true },
                { text: 'the end', mood: 5, dramatic: false },
                { text: 'moral of the story', mood: 4, dramatic: false },
                { text: 'crowd roars!', mood: 14, dramatic: true },
            ]},
        ];

        // Build dramatic bonus: picking dramatic words in sequence gives bonus
        let dramaticStreak = 0;

        const generateChoices = () => {
            const pool = wordPools[round].words;
            // Pick 3 random unique words
            const shuffled = [...pool].sort(() => Math.random() - 0.5);
            currentChoices = shuffled.slice(0, 3);
        };

        const cleanup = () => { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } };

        const render = (feedback = '') => {
            const moodColor = crowdMood >= 65 ? '#2ecc71' : crowdMood >= 40 ? '#f39c12' : '#e74c3c';
            const phaseData = wordPools[round] || wordPools[wordPools.length - 1];

            let html = '<div style="max-width: 480px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">📖 Tell Tales</h4>';
            html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">${phaseData.icon} ${phaseData.phase} (${round + 1}/${totalRounds})</p>`;

            // Crowd mood
            html += `<div style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                    <span style="color: var(--text-muted);">Crowd Engagement</span>
                    <span style="color: ${moodColor};">${Math.round(crowdMood)}%</span>
                </div>
                <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="width: ${crowdMood}%; height: 100%; background: ${moodColor}; transition: width 0.3s; border-radius: 5px;"></div>
                </div>
            </div>`;

            // Timer bar
            const timerColor = timeLeft > 50 ? '#2ecc71' : timeLeft > 25 ? '#f39c12' : '#e74c3c';
            html += `<div style="margin-bottom: 10px;">
                <div style="background: rgba(255,255,255,0.06); border-radius: 4px; height: 6px; overflow: hidden;">
                    <div style="width: ${timeLeft}%; height: 100%; background: ${timerColor}; transition: width 0.2s; border-radius: 3px;"></div>
                </div>
                <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">⏱️ Time to choose</div>
            </div>`;

            // Story so far
            if (storyWords.length > 0) {
                html += `<div style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.06);">
                    <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 4px;">Your story so far:</div>
                    <div style="font-size: 13px; font-style: italic; color: var(--text-primary);">
                        "${storyWords.map((w, i) => `<span style="color: ${w.dramatic ? '#f1c40f' : 'var(--text-secondary)'};">${w.text}</span>`).join(' ... ')}"
                    </div>
                </div>`;
            }

            if (feedback) {
                html += `<div style="font-size: 13px; margin-bottom: 8px;">${feedback}</div>`;
            }

            // Dramatic streak bonus
            if (dramaticStreak >= 2) {
                html += `<div style="font-size: 11px; color: #f1c40f; margin-bottom: 6px;">🔥 Dramatic streak x${dramaticStreak}!</div>`;
            }

            // Word choices
            if (!locked && round < totalRounds) {
                html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Choose the next part of your tale:</div>`;
                for (let i = 0; i < currentChoices.length; i++) {
                    const w = currentChoices[i];
                    const hintGlow = charisma >= 7 && w.mood >= 10 ? 'border-left: 3px solid rgba(243,156,18,0.4);' : 'border-left: 3px solid transparent;';
                    html += `<button onclick="window._storyPick(${i})"
                        style="display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; margin-bottom: 6px;
                               background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); ${hintGlow}
                               border-radius: 8px; cursor: pointer; color: var(--text-primary); font-size: 14px; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                        <span style="font-size: 10px; color: ${w.dramatic ? '#f1c40f' : 'var(--text-muted)'};">${w.dramatic ? '⭐' : '📝'}</span>
                        <span>"...${w.text}..."</span>
                    </button>`;
                }
            }

            html += '</div>';
            game.ui.showCustomPanel('📖 Storytelling', html);
        };

        const startRound = () => {
            locked = false;
            timeLeft = 100;
            generateChoices();
            render();

            cleanup();
            timerInterval = setInterval(() => {
                timeLeft -= 4;
                if (timeLeft <= 0) {
                    cleanup();
                    // Timeout — pick worst option automatically
                    locked = true;
                    crowdMood = Math.max(0, crowdMood - 5);
                    dramaticStreak = 0;
                    storyWords.push({ text: '...um...', dramatic: false });
                    round++;
                    if (round < totalRounds) {
                        const fb = '<span style="color: #e74c3c;">😬 You froze! The crowd gets restless...</span>';
                        render(fb);
                        setTimeout(() => startRound(), 1500);
                    } else {
                        setTimeout(() => ActionMenu._buskingReward(game, tile, crowdMultiplier, 'storytelling', Math.round(crowdMood)), 1200);
                    }
                    return;
                }
                render();
            }, 350);
        };

        window._storyPick = (idx) => {
            if (locked || round >= totalRounds) return;
            locked = true;
            cleanup();

            const chosen = currentChoices[idx];
            storyWords.push(chosen);

            let moodGain = chosen.mood;

            // Dramatic streak bonus
            if (chosen.dramatic) {
                dramaticStreak++;
                if (dramaticStreak >= 2) moodGain += dramaticStreak * 2;
            } else {
                dramaticStreak = 0;
            }

            // Time bonus — faster choices impress the crowd
            if (timeLeft > 70) moodGain += 3;

            crowdMood = Math.max(0, Math.min(100, crowdMood + moodGain));

            const fb = moodGain >= 12 ? '<span style="color: #2ecc71;">🎉 The crowd gasps in awe!</span>'
                     : moodGain >= 7 ? '<span style="color: #3498db;">👏 They lean in closer.</span>'
                     : moodGain >= 3 ? '<span style="color: #f39c12;">🤔 They nod along.</span>'
                     : '<span style="color: #e74c3c;">😒 A few people wander off...</span>';

            round++;
            render(fb);

            if (round < totalRounds) {
                setTimeout(() => startRound(), 1500);
            } else {
                setTimeout(() => ActionMenu._buskingReward(game, tile, crowdMultiplier, 'storytelling', Math.round(crowdMood)), 1500);
            }
        };

        startRound();
    },

    // ── Busking Minigame: Fortune Telling — Cold reading deduction ──
    _buskFortuneTelling(game, tile, crowdMultiplier) {
        const intel = ActionMenu._getPlayerStat(game.player, 'intelligence');
        let clientIdx = 0;
        let score = 0;
        let locked = false;

        const clients = [
            {
                icon: '👩‍🌾', name: 'A weathered farmwife',
                clues: ['Calloused hands from hard labour', 'A worried crease between her brows', 'She clutches a small pouch tightly'],
                options: [
                    { text: '🌾 "I see a bountiful harvest ahead — your toil will be rewarded."', correct: true },
                    { text: '💍 "A great romance awaits you across the sea."', correct: false },
                    { text: '⚔️ "You will find glory in battle soon."', correct: false },
                ],
            },
            {
                icon: '🤵', name: 'A well-dressed merchant',
                clues: ['Fine silk clothes but worn at the cuffs', 'He glances nervously toward the harbour', 'Ink-stained fingers from ledger work'],
                options: [
                    { text: '🏠 "A family reunion brings you great peace."', correct: false },
                    { text: '📦 "A shipment you await will arrive safely — and profitably."', correct: true },
                    { text: '🐎 "You will win a great horse race."', correct: false },
                ],
            },
            {
                icon: '👧', name: 'A shy young woman',
                clues: ['She twists a ring on her finger nervously', 'A faint blush when she mentions "someone"', 'She keeps looking back toward the town square'],
                options: [
                    { text: '⚗️ "You will discover a hidden treasure in the woods."', correct: false },
                    { text: '💕 "The one you think of... feels the same. Be brave."', correct: true },
                    { text: '📖 "A great scholarly achievement awaits you."', correct: false },
                ],
            },
            {
                icon: '👴', name: 'A grizzled old soldier',
                clues: ['A long scar across his cheek', 'He walks with a limp but stands tall', 'His eyes are distant, lost in memory'],
                options: [
                    { text: '🛡️ "An old comrade seeks you out — a reunion is near."', correct: true },
                    { text: '💰 "You will stumble upon a forgotten treasure."', correct: false },
                    { text: '🌹 "A passionate love affair awaits!"', correct: false },
                ],
            },
        ];

        // Pick 3 random clients
        const shuffled = [...clients].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, 3);

        // Randomize option order per client
        selected.forEach(c => {
            for (let i = c.options.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [c.options[i], c.options[j]] = [c.options[j], c.options[i]];
            }
        });

        // Intelligence bonus: highlight a clue
        const showHint = intel >= 6;

        const render = (feedbackMsg = '') => {
            const client = selected[clientIdx];

            let html = '<div style="max-width: 500px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">🔮 Read Fortunes</h4>';
            html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">Client ${clientIdx + 1}/${selected.length} · Score: ${score}/${clientIdx}</p>`;

            // Client
            html += `<div style="font-size: 48px; margin: 8px 0;">${client.icon}</div>`;
            html += `<div style="font-size: 14px; color: var(--text-primary); font-weight: 600; margin-bottom: 10px;">${client.name}</div>`;

            // Clues
            html += `<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 10px; margin-bottom: 14px; text-align: left;">`;
            html += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">🔍 You observe:</div>`;
            for (let i = 0; i < client.clues.length; i++) {
                const isKeyClue = i === 0 && showHint;
                html += `<div style="font-size: 12px; color: ${isKeyClue ? '#2ecc71' : 'var(--text-secondary)'}; padding: 3px 0; ${isKeyClue ? 'font-weight: 600;' : ''}">${isKeyClue ? '💡' : '•'} ${client.clues[i]}</div>`;
            }
            html += '</div>';

            if (feedbackMsg) {
                html += `<div style="font-size: 13px; margin: 10px 0;">${feedbackMsg}</div>`;
            }

            // Fortune options
            if (!locked) {
                for (let i = 0; i < client.options.length; i++) {
                    const opt = client.options[i];
                    html += `<button onclick="window._buskFortuneChoice(${i})"
                        style="display: block; width: 100%; padding: 10px 14px; margin-bottom: 6px;
                               background: rgba(148,103,189,0.06); border: 1px solid rgba(148,103,189,0.15);
                               border-radius: 6px; cursor: pointer; text-align: left; color: var(--text-primary);
                               font-size: 13px; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(148,103,189,0.15)'" onmouseleave="this.style.background='rgba(148,103,189,0.06)'">
                        ${opt.text}
                    </button>`;
                }
            }

            html += '</div>';
            return html;
        };

        const showClient = () => {
            locked = false;
            game.ui.showCustomPanel('🔮 Fortune Telling', render());
        };

        window._buskFortuneChoice = (idx) => {
            if (locked || clientIdx >= selected.length) return;
            locked = true;

            const opt = selected[clientIdx].options[idx];
            if (opt.correct) {
                score++;
            }

            const fb = opt.correct
                ? '<span style="color: #2ecc71;">✨ Their eyes widen — "How did you know?!" The crowd gasps.</span>'
                : '<span style="color: #e74c3c;">😕 They look confused. "That... doesn\'t sound right." The crowd murmurs.</span>';

            game.ui.showCustomPanel('🔮 Fortune Telling', render(fb));

            clientIdx++;
            if (clientIdx < selected.length) {
                setTimeout(() => showClient(), 1800);
            } else {
                const pct = Math.round((score / selected.length) * 100);
                setTimeout(() => ActionMenu._buskingReward(game, tile, crowdMultiplier, 'fortune_telling', pct), 1800);
            }
        };

        showClient();
    },

    // ── Busking Minigame: Preaching — Sermon fervor management ──
    _buskPreaching(game, tile, crowdMultiplier) {
        const faith = ActionMenu._getPlayerStat(game.player, 'faith');
        let round = 0;
        const totalRounds = 4;
        let fervor = 30;
        let locked = false;

        const sermonRounds = [
            {
                prompt: 'You step onto a crate and address the passing crowd. How do you open?',
                options: [
                    { text: '🙏 Offer a gentle blessing and warm greeting', min: 8, max: 15, label: 'Safe' },
                    { text: '🔥 "REPENT! The end times are upon us!"', min: -5, max: 30, label: 'Risky' },
                    { text: '📖 Quote an obscure but profound scripture', min: 5, max: 20, label: 'Moderate' },
                ],
            },
            {
                prompt: 'A few people stop to listen. What is your message?',
                options: [
                    { text: '❤️ Speak of love, compassion, and community', min: 10, max: 18, label: 'Safe' },
                    { text: '⚡ Warn of divine judgment upon the wicked', min: -10, max: 35, label: 'Risky' },
                    { text: '🌟 Tell a parable about a humble shepherd', min: 8, max: 22, label: 'Moderate' },
                ],
            },
            {
                prompt: 'The crowd grows. Someone challenges you: "Prove your faith!"',
                options: [
                    { text: '🤝 Respond humbly: "Faith is shown through deeds"', min: 10, max: 16, label: 'Safe' },
                    { text: '😤 "You DARE question the divine word?!"', min: -15, max: 40, label: 'Risky' },
                    { text: '🎭 Kneel in prayer and let the silence speak', min: 5, max: 25, label: 'Moderate' },
                ],
            },
            {
                prompt: 'Time for your closing words. The crowd awaits your final message.',
                options: [
                    { text: '🕊️ End with a peaceful benediction', min: 8, max: 15, label: 'Safe' },
                    { text: '🔔 Build to a thunderous crescendo: "BELIEVE!"', min: -10, max: 35, label: 'Risky' },
                    { text: '💫 Share a personal testimony of your faith journey', min: 8, max: 22, label: 'Moderate' },
                ],
            },
        ];

        // Randomize option order per round
        sermonRounds.forEach(s => {
            for (let i = s.options.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [s.options[i], s.options[j]] = [s.options[j], s.options[i]];
            }
        });

        // Faith bonus: narrow risky ranges (less downside)
        if (faith >= 5) {
            sermonRounds.forEach(s => {
                s.options.forEach(o => {
                    if (o.min < 0) o.min = Math.floor(o.min * (1 - faith * 0.06));
                });
            });
        }

        const render = (feedbackMsg = '') => {
            const sr = sermonRounds[round];
            const fvColor = fervor >= 70 ? '#2ecc71' : fervor >= 40 ? '#f39c12' : '#e74c3c';
            const fvLabel = fervor >= 80 ? 'Zealous!' : fervor >= 60 ? 'Enraptured' : fervor >= 40 ? 'Attentive' : fervor >= 20 ? 'Skeptical' : 'Hostile';

            let html = '<div style="max-width: 500px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">📿 Street Preaching</h4>';
            html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">Round ${round + 1}/${totalRounds}</p>`;

            // Fervor meter
            html += `<div style="margin-bottom: 14px;">
                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Fervor: <span style="color: ${fvColor}; font-weight: bold;">${fervor}% — ${fvLabel}</span></div>
                <div style="background: rgba(255,255,255,0.08); border-radius: 6px; height: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); position: relative;">
                    <div style="position: absolute; left: 70%; width: 2px; height: 100%; background: rgba(46,204,113,0.5);"></div>
                    <div style="width: ${Math.min(100, fervor)}%; height: 100%; background: ${fvColor}; transition: width 0.4s; border-radius: 5px;"></div>
                </div>
                <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px; text-align: right;">Goal: 70%+</div>
            </div>`;

            // Crowd
            const crowdSize = Math.min(7, 2 + round);
            let crowdIcons = '';
            for (let i = 0; i < crowdSize; i++) crowdIcons += ['👤', '👥', '🧑', '👩', '👨'][i % 5] + ' ';
            html += `<div style="font-size: 18px; margin: 6px 0; opacity: 0.5; letter-spacing: 3px;">${crowdIcons}</div>`;

            // Prompt
            html += `<div style="font-size: 13px; color: var(--text-primary); margin: 12px 0; font-style: italic;">"${sr.prompt}"</div>`;

            if (feedbackMsg) {
                html += `<div style="font-size: 13px; margin: 10px 0;">${feedbackMsg}</div>`;
            }

            // Options
            if (!locked) {
                for (let i = 0; i < sr.options.length; i++) {
                    const opt = sr.options[i];
                    const labelColor = opt.label === 'Safe' ? '#2ecc71' : opt.label === 'Risky' ? '#e74c3c' : '#f39c12';
                    html += `<button onclick="window._buskSermonChoice(${i})"
                        style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 14px; margin-bottom: 6px;
                               background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
                               border-radius: 6px; cursor: pointer; text-align: left; color: var(--text-primary);
                               font-size: 13px; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                        <span style="flex: 1;">${opt.text}</span>
                        <span style="font-size: 10px; color: ${labelColor}; margin-left: 8px; white-space: nowrap;">${opt.label}</span>
                    </button>`;
                }
            }

            html += '</div>';
            return html;
        };

        const showRound = () => {
            locked = false;
            game.ui.showCustomPanel('📿 Preaching', render());
        };

        window._buskSermonChoice = (idx) => {
            if (locked || round >= totalRounds) return;
            locked = true;

            const opt = sermonRounds[round].options[idx];
            const change = opt.min + Math.floor(Math.random() * (opt.max - opt.min + 1));
            fervor = Math.max(0, Math.min(100, fervor + change));

            let fb;
            if (change >= 20) fb = '<span style="color: #2ecc71;">🔥 The crowd is MOVED! They hang on your every word!</span>';
            else if (change >= 10) fb = '<span style="color: #2ecc71;">👏 Your words resonate. Heads nod in agreement.</span>';
            else if (change >= 0) fb = '<span style="color: #f39c12;">😐 A tepid response... a few polite nods.</span>';
            else if (change >= -10) fb = '<span style="color: #e74c3c;">😒 Some in the crowd scoff and turn away.</span>';
            else fb = '<span style="color: #e74c3c;">🍅 "Heretic!" someone shouts. You\'re losing them badly!</span>';

            game.ui.showCustomPanel('📿 Preaching', render(fb));

            round++;
            if (round < totalRounds) {
                setTimeout(() => showRound(), 1500);
            } else {
                setTimeout(() => ActionMenu._buskingReward(game, tile, crowdMultiplier, 'preaching', Math.min(100, fervor)), 1500);
            }
        };

        showRound();
    },

    // ── Data helpers for early-game income ──

    _getJobData() {
        // Try to load from DataLoader if available
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.oddJobs) {
            return DataLoader.earlyJobs.oddJobs.settlement_jobs;
        }
        // Inline fallback
        return {
            village: [
                { id: 'farm_hand', name: 'Farm Hand', icon: '🌾', description: 'Help local farmers with planting and harvesting.', pay: { min: 10, max: 25 }, stat: 'strength', difficulty: 3 },
                { id: 'woodcutter', name: 'Woodcutter', icon: '🪓', description: 'Chop firewood for the village hearths.', pay: { min: 12, max: 22 }, stat: 'strength', difficulty: 3 },
                { id: 'shepherd', name: 'Shepherd', icon: '🐑', description: 'Watch over the village flock for the day.', pay: { min: 8, max: 15 }, stat: 'intelligence', difficulty: 2 },
                { id: 'herb_picker', name: 'Herb Picker', icon: '🌿', description: 'Gather medicinal herbs for the local healer.', pay: { min: 10, max: 20 }, stat: 'intelligence', difficulty: 3 },
            ],
            town: [
                { id: 'dock_worker', name: 'Dock Worker', icon: '📦', description: 'Load and unload merchant wagons at the market.', pay: { min: 18, max: 35 }, stat: 'strength', difficulty: 4 },
                { id: 'courier', name: 'Courier', icon: '📨', description: 'Deliver messages and parcels around town.', pay: { min: 15, max: 30 }, stat: 'stamina', difficulty: 3 },
                { id: 'tavern_bouncer', name: 'Tavern Bouncer', icon: '💪', description: 'Keep the peace at a rowdy tavern tonight.', pay: { min: 20, max: 45 }, stat: 'strength', difficulty: 5 },
                { id: 'rat_catcher', name: 'Rat Catcher', icon: '🐀', description: 'Clear vermin from cellars and granaries.', pay: { min: 15, max: 30 }, stat: 'stealth', difficulty: 3 },
                { id: 'scribe_assistant', name: "Scribe's Assistant", icon: '📝', description: 'Help copy documents and ledgers.', pay: { min: 22, max: 40 }, stat: 'intelligence', difficulty: 5 },
                { id: 'night_watch', name: 'Night Watch', icon: '🔦', description: 'Patrol the town walls through the night.', pay: { min: 18, max: 35 }, stat: 'combat', difficulty: 4 },
            ],
            capital: [
                { id: 'warehouse_guard', name: 'Warehouse Guard', icon: '🛡️', description: "Guard a merchant's warehouse for the day.", pay: { min: 30, max: 55 }, stat: 'combat', difficulty: 4 },
                { id: 'cargo_hauler', name: 'Cargo Hauler', icon: '🏋️', description: 'Move heavy goods between market districts.', pay: { min: 25, max: 50 }, stat: 'strength', difficulty: 5 },
                { id: 'arena_fighter', name: 'Arena Fighter', icon: '🗡️', description: 'Fight in exhibition matches for the crowd.', pay: { min: 40, max: 80 }, stat: 'combat', difficulty: 7 },
                { id: 'herald', name: 'Herald', icon: '📯', description: 'Read royal proclamations in the city square.', pay: { min: 25, max: 50 }, stat: 'charisma', difficulty: 5 },
                { id: 'tutor', name: 'Tutor', icon: '📖', description: "Teach a noble's children reading and arithmetic.", pay: { min: 30, max: 55 }, stat: 'intelligence', difficulty: 6 },
                { id: 'pit_fighter', name: 'Pit Fighter', icon: '⚔️', description: 'Bare-knuckle brawling in the underground pits.', pay: { min: 35, max: 75 }, stat: 'combat', difficulty: 7 },
            ],
        };
    },

    _getForageData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.foraging) {
            return DataLoader.earlyJobs.foraging;
        }
        return {
            terrain_mapping: {
                forest: 'forest', dense_forest: 'forest', woodland: 'forest',
                boreal_forest: 'forest', seasonal_forest: 'forest',
                temperate_rainforest: 'forest', tropical_rainforest: 'forest',
                plains: 'plains', grassland: 'plains', steppe: 'plains', savanna: 'plains',
                hills: 'hills', highlands: 'hills', mountain: 'hills',
                coast: 'coast', beach: 'coast',
                desert: 'desert', arid: 'desert', semi_arid: 'desert',
                swamp: 'swamp', marsh: 'swamp', wetland: 'swamp', mangrove: 'swamp', tropical_wetland: 'swamp',
            },
            loot_table: {
                forest: [
                    { item: 'herbs', name: 'Wild Herbs', icon: '🌿', chance: 0.40, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'berries', name: 'Wild Berries', icon: '🫐', chance: 0.35, qty: { min: 2, max: 5 }, sellPrice: 3 },
                    { item: 'mushrooms', name: 'Mushrooms', icon: '🍄', chance: 0.25, qty: { min: 1, max: 4 }, sellPrice: 4 },
                    { item: 'honey', name: 'Wild Honey', icon: '🍯', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 12 },
                    { item: 'truffles', name: 'Truffles', icon: '🟤', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 25 },
                ],
                plains: [
                    { item: 'herbs', name: 'Prairie Herbs', icon: '🌿', chance: 0.35, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'berries', name: 'Wild Berries', icon: '🫐', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 3 },
                    { item: 'flax', name: 'Wild Flax', icon: '🌾', chance: 0.20, qty: { min: 1, max: 3 }, sellPrice: 6 },
                    { item: 'feathers', name: 'Feathers', icon: '🪶', chance: 0.15, qty: { min: 2, max: 5 }, sellPrice: 4 },
                ],
                hills: [
                    { item: 'herbs', name: 'Mountain Herbs', icon: '🌿', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 7 },
                    { item: 'stone', name: 'Loose Stone', icon: '⛰️', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 3 },
                    { item: 'ore_scraps', name: 'Ore Scraps', icon: '⛰️', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 10 },
                    { item: 'fossils', name: 'Fossils', icon: '🦴', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 20 },
                ],
                coast: [
                    { item: 'shells', name: 'Shells', icon: '🐚', chance: 0.40, qty: { min: 2, max: 6 }, sellPrice: 2 },
                    { item: 'driftwood', name: 'Driftwood', icon: '🪵', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 4 },
                    { item: 'seaweed', name: 'Edible Seaweed', icon: '🌊', chance: 0.25, qty: { min: 2, max: 4 }, sellPrice: 3 },
                    { item: 'pearls', name: 'Pearls', icon: '🔮', chance: 0.03, qty: { min: 1, max: 1 }, sellPrice: 35 },
                    { item: 'ambergris', name: 'Ambergris', icon: '🟡', chance: 0.02, qty: { min: 1, max: 1 }, sellPrice: 50 },
                ],
                desert: [
                    { item: 'cactus_fruit', name: 'Cactus Fruit', icon: '🌵', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 6 },
                    { item: 'scorpion_venom', name: 'Scorpion Venom', icon: '🦂', chance: 0.10, qty: { min: 1, max: 1 }, sellPrice: 15 },
                    { item: 'desert_rose', name: 'Desert Rose', icon: '🌹', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 20 },
                ],
                swamp: [
                    { item: 'leeches', name: 'Medicinal Leeches', icon: '🪱', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 8 },
                    { item: 'mushrooms', name: 'Swamp Mushrooms', icon: '🍄', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'peat', name: 'Peat', icon: '🟫', chance: 0.20, qty: { min: 2, max: 4 }, sellPrice: 4 },
                    { item: 'rare_frog', name: 'Rare Frog', icon: '🐸', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 30 },
                ],
            },
        };
    },

    _getHuntData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.hunting) {
            return DataLoader.earlyJobs.hunting;
        }
        return {
            loot_table: {
                forest: [
                    { item: 'game_meat', name: 'Venison', icon: '🥩', chance: 0.35, qty: { min: 1, max: 3 }, sellPrice: 8 },
                    { item: 'pelts', name: 'Fur Pelts', icon: '🦊', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 12 },
                    { item: 'antlers', name: 'Antlers', icon: '🦌', chance: 0.15, qty: { min: 1, max: 1 }, sellPrice: 15 },
                    { item: 'bear_pelt', name: 'Bear Pelt', icon: '🐻', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 40 },
                ],
                plains: [
                    { item: 'game_meat', name: 'Game Meat', icon: '🥩', chance: 0.40, qty: { min: 1, max: 4 }, sellPrice: 6 },
                    { item: 'hides', name: 'Hides', icon: '🟤', chance: 0.35, qty: { min: 1, max: 2 }, sellPrice: 8 },
                    { item: 'feathers', name: 'Feathers', icon: '🪶', chance: 0.25, qty: { min: 2, max: 5 }, sellPrice: 4 },
                    { item: 'ivory', name: 'Ivory', icon: '🦣', chance: 0.03, qty: { min: 1, max: 1 }, sellPrice: 45 },
                ],
                hills: [
                    { item: 'game_meat', name: 'Mountain Goat', icon: '🥩', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 7 },
                    { item: 'pelts', name: 'Wolf Pelts', icon: '🐺', chance: 0.20, qty: { min: 1, max: 2 }, sellPrice: 14 },
                    { item: 'eagle_feathers', name: 'Eagle Feathers', icon: '🦅', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 18 },
                ],
                coast: [
                    { item: 'fish', name: 'Fresh Fish', icon: '🐟', chance: 0.50, qty: { min: 2, max: 5 }, sellPrice: 4 },
                    { item: 'crabs', name: 'Crabs', icon: '🦀', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 6 },
                    { item: 'lobster', name: 'Lobster', icon: '🦞', chance: 0.10, qty: { min: 1, max: 1 }, sellPrice: 18 },
                ],
            },
        };
    },

    _getBountyData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.bountyBoard) {
            return DataLoader.earlyJobs.bountyBoard.templates;
        }
        return [
            { id: 'deliver_message', name: 'Deliver a Message', icon: '📨', description: 'Carry a sealed letter to {destination}.', type: 'delivery', pay: { min: 30, max: 80 }, daysLimit: 10, difficulty: 'easy' },
            { id: 'deliver_package', name: 'Deliver a Package', icon: '📦', description: 'Transport a fragile package safely to {destination}.', type: 'delivery', pay: { min: 50, max: 120 }, daysLimit: 12, difficulty: 'easy' },
            { id: 'scout_area', name: 'Scout the Wilds', icon: '🔭', description: 'Explore and map {count} tiles.', type: 'explore', pay: { min: 40, max: 90 }, exploreCount: 15, daysLimit: 8, difficulty: 'easy' },
            { id: 'clear_pests', name: 'Clear Pests', icon: '🐀', description: 'Drive out {pest} plaguing the {location}.', type: 'instant', pay: { min: 25, max: 60 }, stat: 'combat', difficulty: 'easy' },
            { id: 'wanted_thief', name: 'Catch a Thief', icon: '🏴‍☠️', description: 'A petty thief is hiding in the area.', type: 'instant', pay: { min: 50, max: 120 }, stat: 'stealth', difficulty: 'medium' },
            { id: 'escort_merchant', name: 'Escort Merchant', icon: '🛡️', description: 'Protect a merchant traveling to {destination}.', type: 'delivery', pay: { min: 80, max: 180 }, daysLimit: 14, difficulty: 'medium' },
        ];
    },

    _getGamblingData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.gambling) {
            return DataLoader.earlyJobs.gambling.games;
        }
        return [
            { id: 'dice_roll', name: 'Crown & Anchor', icon: '🎲', description: 'Roll dice against the house. Match crowns to win.', minBet: 5, maxBet: 200, houseEdge: 0.45, payoutMultiplier: 2.0 },
            { id: 'coin_flip', name: "Dragon's Flip", icon: '🐉', description: 'Call the coin — dragon or shield. Double or nothing.', minBet: 10, maxBet: 500, houseEdge: 0.48, payoutMultiplier: 2.0 },
            { id: 'high_low', name: 'High-Low', icon: '📊', description: 'Guess if the next card is higher or lower.', minBet: 5, maxBet: 100, houseEdge: 0.42, payoutMultiplier: 1.8, streakBonus: 0.5 },
        ];
    },

    _getBuskingData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.busking) {
            return DataLoader.earlyJobs.busking.performances;
        }
        return [
            { id: 'storytelling', name: 'Tell Tales', icon: '📖', description: 'Share stories of your travels and adventures.', stat: 'charisma', basePay: { min: 8, max: 25 } },
            { id: 'singing', name: 'Sing Ballads', icon: '🎵', description: 'Sing old songs and ballads in the market square.', stat: 'charisma', basePay: { min: 10, max: 30 } },
            { id: 'juggling', name: 'Juggle & Tricks', icon: '🤹', description: 'Perform acrobatics and sleight of hand.', stat: 'dexterity', basePay: { min: 8, max: 22 } },
            { id: 'fortune_telling', name: 'Read Fortunes', icon: '🔮', description: 'Tell fortunes and read palms. Mostly made up.', stat: 'intelligence', basePay: { min: 12, max: 35 } },
            { id: 'preaching', name: 'Street Preaching', icon: '📿', description: 'Preach fire and brimstone for donations.', stat: 'faith', basePay: { min: 6, max: 20 }, bonusKarma: true },
        ];
    },

    /**
     * Show a skip/play prompt before a minigame starts.
     * opts: { title, icon, description, baseRewardText, onSkip, onPlay, cancelable }
     */
    _showMinigamePrompt(game, opts) {
        let html = '<div style="text-align: center;">';
        html += `<div style="font-size: 48px; margin: 12px 0;">${opts.icon}</div>`;
        html += `<h4 style="margin: 0 0 6px;">${opts.title}</h4>`;
        if (opts.description) html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">${opts.description}</p>`;

        html += `<div style="display: flex; gap: 12px; margin-bottom: 12px;">`;

        // Play button
        html += `<button onclick="window._mgPlay()"
            style="flex: 1; padding: 16px 12px; background: rgba(46,204,113,0.1); border: 2px solid #2ecc71;
                   border-radius: 10px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; text-align: center;"
            onmouseenter="this.style.background='rgba(46,204,113,0.2)'" onmouseleave="this.style.background='rgba(46,204,113,0.1)'">
            <div style="font-size: 22px; margin-bottom: 4px;">🎮</div>
            <div style="font-weight: bold; font-size: 14px; color: #2ecc71;">Play Minigame</div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Earn bonus rewards</div>
        </button>`;

        // Skip button
        html += `<button onclick="window._mgSkip()"
            style="flex: 1; padding: 16px 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
                   border-radius: 10px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; text-align: center;"
            onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
            <div style="font-size: 22px; margin-bottom: 4px;">⏭️</div>
            <div style="font-weight: bold; font-size: 14px; color: var(--text-secondary);">Skip</div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Base reward only</div>
        </button>`;

        html += `</div>`;

        // Base reward preview
        if (opts.baseRewardText) {
            html += `<div style="padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; font-size: 11px; color: var(--text-muted);">
                <span style="color: var(--text-secondary);">Base reward:</span> ${opts.baseRewardText}
            </div>`;
        }

        if (opts.cancelable) {
            html += `<button onclick="game.ui.hideCustomPanel();"
                style="margin-top: 8px; padding: 6px 16px; background: none; border: 1px solid rgba(255,255,255,0.08);
                       border-radius: 6px; cursor: pointer; color: var(--text-muted); font-size: 11px;">Cancel</button>`;
        }

        html += '</div>';
        game.ui.showCustomPanel(opts.title, html);
        window._mgPlay = opts.onPlay;
        window._mgSkip = opts.onSkip;
    },

    /**
     * Get a player stat value with fallbacks for different stat names
     */
    _getPlayerStat(player, stat) {
        // Direct attribute
        if (player[stat] !== undefined) return player[stat];
        // Skill
        if (player.skills && player.skills[stat] !== undefined) return player.skills[stat];
        // Mappings for convenience
        const aliases = {
            stamina: 'maxStamina',
            dexterity: 'luck',
            combat: 'strength',
        };
        if (aliases[stat] && player[aliases[stat]] !== undefined) return player[aliases[stat]];
        if (aliases[stat] && player.skills && player.skills[aliases[stat]] !== undefined) return player.skills[aliases[stat]];
        return 5; // Default
    },

    // ============================================
    // NEW ACTIONS — Donate, Allegiance, Feast, Tournament
    //               Pickpocket, Smuggle, Train, Meditate
    //               Fish, Prospect, Tame Horse, Campfire
    // ============================================

    /**
     * Show donation menu — give gold for karma + reputation
     */
    showDonateMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const maxDonate = Math.min(player.gold, 500);
        const kingdomId = settlement ? settlement.kingdom : null;
        const kingdomName = kingdomId ? (game.world.getKingdom(kingdomId)?.name || 'this realm') : 'the people';

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">💰 Make a Donation</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Donate gold to the people of <strong>${settlement ? settlement.name : 'this land'}</strong>. This earns you karma and reputation with ${kingdomName}.</p>`;
        html += `<p style="font-size: 12px; color: var(--gold);">Your gold: ${player.gold}</p>`;
        html += `<div style="margin: 12px 0;">`;
        html += `<label style="font-size: 12px;">Amount to donate:</label><br>`;
        html += `<input type="range" id="donateAmount" min="10" max="${maxDonate}" value="${Math.min(50, maxDonate)}" oninput="document.getElementById('donateLabel').textContent = this.value" style="width: 100%;">`;
        html += `<span id="donateLabel" style="color: var(--gold); font-weight: bold;">${Math.min(50, maxDonate)}</span> gold`;
        html += `</div>`;
        html += `<button onclick="window._doDonate()" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Donate</button>`;
        html += '</div>';

        game.ui.showCustomPanel('Donation', html);

        window._doDonate = () => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const amount = parseInt(document.getElementById('donateAmount')?.value || 10);
            if (amount > player.gold) {
                game.ui.showNotification('Not Enough', 'You can\'t afford that donation!', 'error');
                return;
            }

            player.gold -= amount;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.donation = (player.financeToday.expenses.donation || 0) + amount;
            }

            // Karma scales with amount
            const karmaGain = Math.floor(amount / 10) + 1;
            player.karma = (player.karma || 0) + karmaGain;

            // Reputation gain
            if (kingdomId && player.reputation) {
                player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + Math.floor(amount / 15) + 1;
            }

            // Renown for large donations
            let renownGain = 0;
            if (amount >= 100) {
                renownGain = Math.floor(amount / 50);
                player.renown = (player.renown || 0) + renownGain;
            }

            // Charisma might improve
            let charismaUp = false;
            if (amount >= 50 && Math.random() < 0.15) {
                player.charisma = (player.charisma || 5) + 1;
                charismaUp = true;
            }

            let msg = `You donated ${amount} gold. +${karmaGain} karma.`;
            if (kingdomId) msg += ` Reputation with ${kingdomName} improved.`;
            if (renownGain > 0) msg += ` +${renownGain} renown!`;
            if (charismaUp) msg += ' Your generosity has improved your charisma!';

            game.ui.showNotification('💰 Donation', msg, 'success');
            game.ui.hideCustomPanel();
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Pledge allegiance to the kingdom controlling this settlement
     */
    doPledgeAllegiance(game, tile) {
        const settlement = tile.settlement;
        if (!settlement || !settlement.kingdom) {
            game.ui.showNotification('No Kingdom', 'This settlement has no kingdom to pledge to.', 'error');
            return;
        }

        const result = game.player.pledgeAllegiance(settlement.kingdom, game.world);
        if (result.success) {
            const kingdom = result.kingdom;
            // Reputation bonus on pledge
            if (game.player.reputation) {
                game.player.reputation[settlement.kingdom] = (game.player.reputation[settlement.kingdom] || 0) + 5;
            }
            game.ui.showNotification('⚔️ Allegiance Pledged',
                `You have sworn allegiance to ${kingdom.name}. You are now a citizen of the realm. +5 reputation.`, 'success');
            game.ui.updateStats(game.player, game.world);
        } else {
            game.ui.showNotification('Cannot Pledge', result.reason, 'error');
        }
    },

    /**
     * Renounce allegiance to current kingdom
     */
    doRenounceAllegiance(game, tile) {
        const player = game.player;
        if (!player.allegiance) {
            game.ui.showNotification('No Allegiance', 'You aren\'t pledged to any kingdom.', 'error');
            return;
        }

        const oldKingdomId = player.allegiance;
        const result = player.breakAllegiance(game.world);

        if (result.success) {
            // Reputation penalty
            if (player.reputation && oldKingdomId) {
                player.reputation[oldKingdomId] = (player.reputation[oldKingdomId] || 0) - 15;
            }
            // Karma hit
            player.karma = (player.karma || 0) - 3;

            const name = result.oldKingdom ? result.oldKingdom.name : 'your kingdom';
            game.ui.showNotification('💔 Allegiance Broken',
                `You have renounced your allegiance to ${name}. -15 reputation, -3 karma. You are once again a free wanderer.`, 'warning');
            game.ui.updateStats(player, game.world);
        } else {
            game.ui.showNotification('Error', result.reason, 'error');
        }
    },

    _getPlayerSettlementTiles(player, world) {
        const settlements = [];
        const seen = new Set();

        const addSettlement = (q, r) => {
            const key = `${q},${r}`;
            if (seen.has(key)) return;

            const tile = world.getTile(q, r);
            if (!tile || !tile.settlement) return;

            const listedInColonies = (player.colonies || []).some(c => c.q === q && c.r === r);
            const markedPlayerColony = !!tile.settlement.colony?.isPlayerColony;
            if (!listedInColonies && !markedPlayerColony) return;

            seen.add(key);
            settlements.push({ q, r, tile, settlement: tile.settlement });
        };

        for (const colony of (player.colonies || [])) {
            addSettlement(colony.q, colony.r);
        }

        const allSettlements = world.getAllSettlements();
        for (const settlement of allSettlements) {
            const settlementTile = world.getTile(settlement.q, settlement.r);
            if (settlementTile?.settlement?.colony?.isPlayerColony) {
                addSettlement(settlement.q, settlement.r);
            }
        }

        return settlements;
    },

    showFormKingdomMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const controlledSettlements = ActionMenu._getPlayerSettlementTiles(player, world);
        const activeSettlement = controlledSettlements.find(s => s.q === tile.q && s.r === tile.r) || controlledSettlements[0];
        const suggestedName = `Kingdom of ${activeSettlement?.settlement?.name || 'New Dawn'}`;

        let html = `
            <div>
                <h4 style="margin: 0 0 10px;">👑 Proclaim a New Kingdom</h4>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 10px;">
                    You will unite <b>${controlledSettlements.length}</b> settlements under a new crown.
                </p>
                <p style="font-size: 12px; margin: 0 0 6px;"><b>Kingdom Name</b></p>
                <input id="newKingdomNameInput" type="text" maxlength="48" value="${suggestedName.replace(/"/g, '&quot;')}"
                    style="width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid #555; background: #222; color: #fff; margin-bottom: 10px;" />
                <div style="display:flex; gap:8px;">
                    <button onclick="window._confirmFormKingdom()"
                        style="flex:1; padding: 10px; background: #c89b3c; border: none; border-radius: 6px; color: #111; font-weight: 700; cursor: pointer;">
                        Found Kingdom
                    </button>
                    <button onclick="game.ui.hideCustomPanel();"
                        style="padding: 10px 12px; background: #444; border: none; border-radius: 6px; color: #ddd; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        game.ui.showCustomPanel('Form Kingdom', html);

        window._confirmFormKingdom = () => {
            const chosenName = document.getElementById('newKingdomNameInput')?.value || '';
            if (!ActionMenu.commitPendingAP(game)) return;
            game.ui.hideCustomPanel();
            ActionMenu.doFormKingdom(game, tile, chosenName);
        };
    },

    doFormKingdom(game, tile, customName) {
        const player = game.player;
        const world = game.world;
        const controlledSettlements = ActionMenu._getPlayerSettlementTiles(player, world);

        if (controlledSettlements.length < 3) {
            game.ui.showNotification('Cannot Form Kingdom', `You need at least 3 settlements. You currently control ${controlledSettlements.length}.`, 'error');
            return;
        }

        const currentKingdom = player.allegiance ? world.getKingdom(player.allegiance) : null;
        if (currentKingdom && currentKingdom.createdByPlayer) {
            game.ui.showNotification('Already Sovereign', `You already rule ${currentKingdom.name}.`, 'info');
            return;
        }

        const activeSettlement = controlledSettlements.find(s => s.q === tile.q && s.r === tile.r) || controlledSettlements[0];
        const usedIds = new Set(world.kingdoms.map(k => k.id));
        let idIndex = 1;
        let kingdomId = `player_kingdom_${idIndex}`;
        while (usedIds.has(kingdomId)) {
            idIndex++;
            kingdomId = `player_kingdom_${idIndex}`;
        }

        const palette = ['#c0392b', '#1f7a8c', '#8e44ad', '#2c3e50', '#16a085', '#d35400', '#7f8c8d', '#6d4c41', '#3949ab', '#8d6e63'];
        const usedColors = new Set(world.kingdoms.map(k => (k.color || '').toLowerCase()));
        const color = palette.find(c => !usedColors.has(c.toLowerCase())) || `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        const previousAllegiance = player.allegiance || null;
        const culture = activeSettlement.settlement.culture
            || (previousAllegiance ? (world.getKingdom(previousAllegiance)?.culture || 'Imperial') : 'Imperial');
        const normalizedCustomName = String(customName || '').trim().replace(/\s+/g, ' ');
        const kingdomName = normalizedCustomName.length >= 3
            ? normalizedCustomName.slice(0, 48)
            : `Kingdom of ${activeSettlement.settlement.name}`;
        const rulerName = player.name ? `${player.name} the Founder` : Kingdom.generateRulerName(culture);

        const newKingdom = Kingdom.create({
            id: kingdomId,
            name: kingdomName,
            ruler: rulerName,
            color,
            colorLight: `rgba(${r}, ${g}, ${b}, 0.2)`,
            culture,
            description: 'A realm forged by player ambition and frontier settlements.',
            preferredTerrain: ['plains', 'grassland', 'hills'],
            traits: ['orderly', 'mercantile'],
        });

        newKingdom.createdByPlayer = true;
        newKingdom.foundedDay = world.day;
        newKingdom.capital = { q: activeSettlement.q, r: activeSettlement.r };
        newKingdom.colonization = {
            policy: 'coexistence',
            colonies: [],
            pioneersActive: 0,
        };

        let totalPopulation = 0;
        const territorySeen = new Set();
        const addTerritory = (q, r) => {
            const t = world.getTile(q, r);
            if (!t || !t.terrain.passable) return;
            const key = `${q},${r}`;
            if (territorySeen.has(key)) return;
            territorySeen.add(key);
            newKingdom.territory.push({ q, r });
        };

        const controlledSet = new Set(controlledSettlements.map(s => `${s.q},${s.r}`));

        for (const entry of controlledSettlements) {
            const settlementTile = entry.tile;
            const settlement = settlementTile.settlement;
            const settlementKey = `${entry.q},${entry.r}`;

            settlement.kingdom = kingdomId;
            settlementTile.kingdom = kingdomId;
            if (settlement.colony) {
                settlement.colony.motherKingdom = kingdomId;
                newKingdom.colonization.colonies.push({ q: entry.q, r: entry.r, name: settlement.name });
            }

            totalPopulation += settlement.population || 0;
            addTerritory(entry.q, entry.r);

            const neighboring = Hex.neighbors(entry.q, entry.r);
            for (const n of neighboring) {
                const nt = world.getTile(n.q, n.r);
                if (!nt || !nt.terrain.passable) continue;

                const nKey = `${n.q},${n.r}`;
                const isControlledSettlement = controlledSet.has(nKey);
                if (nt.kingdom && nt.kingdom !== previousAllegiance && !isControlledSettlement) continue;

                nt.kingdom = kingdomId;
                addTerritory(n.q, n.r);
            }

            if (settlementKey === `${activeSettlement.q},${activeSettlement.r}`) {
                settlement.type = 'capital';
                settlement.level = Math.max(settlement.level || 1, 3);
            }
        }

        newKingdom.population = totalPopulation;
        newKingdom.military = Math.max(80, Math.floor(totalPopulation * 0.07));
        newKingdom.treasury = Math.max(800, Math.floor((player.gold || 0) * 0.2));

        for (const kingdom of world.kingdoms) {
            if (!kingdom.relations) kingdom.relations = {};
            const relationToNew = (kingdom.id === previousAllegiance) ? -35 : Utils.randInt(-10, 10);
            const relationFromNew = (kingdom.id === previousAllegiance) ? -45 : Utils.randInt(-8, 12);
            kingdom.relations[kingdomId] = relationToNew;
            newKingdom.relations[kingdom.id] = relationFromNew;
        }

        world.kingdoms.push(newKingdom);

        player.allegiance = kingdomId;
        player.kingdomTitle = 'king';
        player.currentTitle = null;
        player.titleProgress = {};
        player.title = `King of ${kingdomName}`;
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + 25;

        let msg = `You have founded ${kingdomName} and claimed ${controlledSettlements.length} settlements.`;
        if (previousAllegiance && previousAllegiance !== kingdomId) {
            player.reputation[previousAllegiance] = (player.reputation[previousAllegiance] || 0) - 25;
            player.karma = (player.karma || 0) - 3;
            const oldName = world.getKingdom(previousAllegiance)?.name || 'your former liege';
            msg += ` Relations with ${oldName} have worsened.`;
        }

        game.ui.showNotification('👑 Kingdom Founded', msg, 'success');
        game.ui.updateStats(player, world);
    },

    /**
     * Host a feast at a settlement — costs gold, gains renown + reputation + diplomacy
     */
    showHostFeastMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const tier = settlement.type === 'capital' ? 'grand' : (settlement.type === 'town' ? 'fine' : 'modest');
        const costs = { modest: 200, fine: 400, grand: 800 };
        const cost = costs[tier];

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🍖 Host a Feast</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Host a ${tier} feast in <strong>${settlement.name}</strong>. The locals will remember your generosity.</p>`;
        html += `<div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px;">`;
        html += `<div>💰 Cost: <span style="color: var(--gold);">${cost} gold</span></div>`;
        html += `<div>📈 Expected: +renown, +reputation, +diplomacy skill</div>`;
        html += `<div>⏰ Takes the rest of the day</div>`;
        html += `</div>`;

        if (player.gold >= cost) {
            html += `<button onclick="window._doFeast(${cost}, '${tier}')" style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Host the Feast (${cost}g)</button>`;
        } else {
            html += `<p style="color: #ff6666; font-size: 12px;">You need ${cost} gold to host this feast.</p>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Host Feast', html);

        window._doFeast = (feastCost, feastTier) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            if (player.gold < feastCost) {
                game.ui.showNotification('Not Enough Gold', 'You can\'t afford this feast!', 'error');
                return;
            }

            player.gold -= feastCost;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.feast = (player.financeToday.expenses.feast || 0) + feastCost;
            }

            // Renown
            const renownGain = { modest: 3, fine: 6, grand: 12 }[feastTier] || 3;
            player.renown = (player.renown || 0) + renownGain;

            // Karma
            const karmaGain = { modest: 2, fine: 4, grand: 7 }[feastTier] || 2;
            player.karma = (player.karma || 0) + karmaGain;

            // Reputation
            const kingdomId = settlement.kingdom;
            if (kingdomId && player.reputation) {
                const repGain = { modest: 3, fine: 6, grand: 10 }[feastTier] || 3;
                player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + repGain;
            }

            // Diplomacy skill up chance
            let diplomacyUp = false;
            const skillChance = { modest: 0.15, fine: 0.25, grand: 0.4 }[feastTier] || 0.15;
            if (Math.random() < skillChance && player.skills) {
                player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                diplomacyUp = true;
            }

            // Charisma up chance
            let charismaUp = false;
            if (Math.random() < 0.2) {
                player.charisma = (player.charisma || 5) + 1;
                charismaUp = true;
            }

            let msg = `You hosted a ${feastTier} feast! +${renownGain} renown, +${karmaGain} karma.`;
            if (diplomacyUp) msg += ' Diplomacy skill improved!';
            if (charismaUp) msg += ' Your charisma grew!';

            game.ui.hideCustomPanel();
            game.ui.showNotification('🍖 Feast Complete', msg, 'success');
            game.ui.updateStats(player, game.world);
            game.endDay();
        };
    },

    /**
     * Hold a tournament — combat competition for gold and renown
     */
    showTournamentMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const entryFee = settlement.type === 'capital' ? 300 : 200;
        const prizePool = entryFee * 4;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">⚔️ Hold a Tournament</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Organize a fighting tournament in ${settlement.name}! Champions from across the land will compete.</p>`;
        html += `<div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px;">`;
        html += `<div>💰 Entry/Organization cost: <span style="color: var(--gold);">${entryFee} gold</span></div>`;
        html += `<div>🏆 Prize pool: <span style="color: var(--gold);">${prizePool} gold</span></div>`;
        html += `<div>⚔️ Your combat skill: ${player.skills?.combat || 1} | Strength: ${player.strength || 5}</div>`;
        html += `<div>⏰ Takes the rest of the day</div>`;
        html += `</div>`;
        html += `<p style="font-size: 11px; color: #aaa;">You may compete yourself, or simply host and watch.</p>`;

        if (player.gold >= entryFee) {
            html += `<button onclick="window._doTournament(true)" style="width: 100%; padding: 10px; background: #c97d32; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 6px;">Compete (${entryFee}g)</button>`;
            html += `<button onclick="window._doTournament(false)" style="width: 100%; padding: 8px; background: #555; border: none; border-radius: 4px; cursor: pointer; color: #ccc;">Just Host & Spectate (${Math.floor(entryFee * 0.6)}g)</button>`;
        } else {
            html += `<p style="color: #ff6666; font-size: 12px;">You need ${entryFee} gold to organize a tournament.</p>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Tournament', html);

        window._doTournament = (compete) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const cost = compete ? entryFee : Math.floor(entryFee * 0.6);
            if (player.gold < cost) {
                game.ui.showNotification('Not Enough Gold', 'You can\'t afford to host this!', 'error');
                return;
            }

            player.gold -= cost;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.tournament = (player.financeToday.expenses.tournament || 0) + cost;
            }

            let resultHtml = '<div>';
            const renownGain = compete ? 5 : 3;
            player.renown = (player.renown || 0) + renownGain;

            if (compete) {
                // Combat rounds — player vs 3 opponents
                const combatSkill = (player.skills?.combat || 1);
                const strengthBonus = ((player.strength || 5) - 5) * 0.05;
                const playerPower = combatSkill * 2 + strengthBonus + (Math.random() * 5);

                const opponents = [
                    { name: 'Local Champion', power: 4 + Math.random() * 6 },
                    { name: 'Traveling Knight', power: 6 + Math.random() * 7 },
                    { name: 'Arena Veteran', power: 8 + Math.random() * 8 },
                ];

                let wins = 0;
                let healthLost = 0;
                resultHtml += '<h4 style="margin-top: 0;">⚔️ Tournament Results</h4>';

                for (const opp of opponents) {
                    const won = playerPower + Math.random() * 3 > opp.power;
                    if (won) {
                        wins++;
                        resultHtml += `<div style="color: #8f8;">✓ Defeated ${opp.name}!</div>`;
                    } else {
                        const dmg = Math.floor(Math.random() * 10) + 5;
                        healthLost += dmg;
                        resultHtml += `<div style="color: #f88;">✗ Lost to ${opp.name} (-${dmg} HP)</div>`;
                    }
                }

                player.health = Math.max(1, player.health - healthLost);

                if (wins === 3) {
                    // Grand champion!
                    const winnings = prizePool;
                    player.gold += winnings;
                    if (player.financeToday) {
                        player.financeToday.income.tournament = (player.financeToday.income.tournament || 0) + winnings;
                    }
                    player.renown += 5; // Bonus renown
                    resultHtml += `<div style="color: var(--gold); font-weight: bold; margin-top: 8px;">🏆 GRAND CHAMPION! Won ${winnings} gold! +${renownGain + 5} total renown!</div>`;
                } else if (wins >= 2) {
                    const winnings = Math.floor(prizePool * 0.4);
                    player.gold += winnings;
                    if (player.financeToday) {
                        player.financeToday.income.tournament = (player.financeToday.income.tournament || 0) + winnings;
                    }
                    resultHtml += `<div style="color: #ccc; margin-top: 8px;">🥈 Runner-up! Won ${winnings} gold. +${renownGain} renown.</div>`;
                } else {
                    resultHtml += `<div style="color: #888; margin-top: 8px;">Eliminated early. +${renownGain} renown for participating.</div>`;
                }

                // Combat skill up chance
                if (Math.random() < 0.2 + wins * 0.1 && player.skills) {
                    player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
                    resultHtml += `<div style="color: #88f; margin-top: 4px;">Combat skill improved!</div>`;
                }

                if (healthLost > 0) {
                    resultHtml += `<div style="color: #f88; margin-top: 4px;">Total injuries: -${healthLost} HP</div>`;
                }
            } else {
                // Just hosting
                resultHtml += '<h4 style="margin-top: 0;">🏟️ Tournament Hosted</h4>';
                resultHtml += `<div>The tournament was a great success! The crowd cheered and the fighters put on a great show.</div>`;
                resultHtml += `<div style="color: var(--gold); margin-top: 8px;">+${renownGain} renown for hosting.</div>`;

                // Hosting chance for diplomacy
                if (Math.random() < 0.25 && player.skills) {
                    player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                    resultHtml += `<div style="color: #88f; margin-top: 4px;">Diplomacy improved from managing the event!</div>`;
                }
            }

            resultHtml += `<button onclick="game.ui.hideCustomPanel(); game.endDay();" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            resultHtml += '</div>';

            game.ui.showCustomPanel('Tournament Results', resultHtml);
            game.ui.updateStats(player, game.world);
        };
    },

    showFestivalMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        if (typeof Festivals === 'undefined') {
            game.ui.showNotification('Unavailable', 'Festival system is unavailable.', 'error');
            return;
        }

        Festivals.initialize(player);
        const gate = Festivals.canHostFestival(player, game.world, tile);
        if (!gate.ok) {
            game.ui.showNotification('Cannot Host Festival', gate.reason, 'warning');
            return;
        }

        let selectedTier = 'modest';
        let selectedStance = 'diplomatic';
        const theme = Festivals.getSeasonTheme(game.world);
        let selectedContest = theme.recommendedContest;

        const render = () => {
            const options = Festivals.getBudgetOptions();
            const currentTier = options.find(o => o.id === selectedTier) || options[0];
            const canAfford = (player.gold || 0) >= currentTier.cost;

            let html = '<div style="max-width: 580px;">';
            html += `<h4 style="margin-top: 0;">${theme.icon} ${theme.name}</h4>`;
            html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">${game.world.season} festival season in ${settlement.name}. Recommended contest: <strong>${Festivals.CONTESTS[theme.recommendedContest].label}</strong>.</div>`;

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin-bottom: 6px;">Festival Scale</div>';
            for (const option of options) {
                const active = selectedTier === option.id;
                html += `
                    <button onclick="window._setFestivalTier('${option.id}')" style="width: 100%; text-align: left; margin-bottom: 6px; padding: 9px; border-radius: 6px; border: 1px solid ${active ? 'rgba(245,197,66,0.65)' : 'rgba(255,255,255,0.12)'}; background: ${active ? 'rgba(245,197,66,0.12)' : 'rgba(255,255,255,0.04)'}; color: #ddd; cursor: pointer;">
                        <div style="display:flex; justify-content: space-between;"><strong>${option.label}</strong><span style="color: var(--gold);">${option.cost}g</span></div>
                        <div style="font-size: 11px; color:#aaa; margin-top: 3px;">+${option.renown} base renown · +${Math.round(option.morale * 100)}% morale for ${option.moraleDays} days</div>
                    </button>
                `;
            }

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 6px;">Guest Policy</div>';
            const diplomaticActive = selectedStance === 'diplomatic';
            const securityActive = selectedStance === 'security';
            html += `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">
                    <button onclick="window._setFestivalStance('diplomatic')" style="padding: 8px; border-radius: 6px; border: 1px solid ${diplomaticActive ? 'rgba(52,152,219,0.7)' : 'rgba(255,255,255,0.12)'}; background: ${diplomaticActive ? 'rgba(52,152,219,0.2)' : 'rgba(255,255,255,0.04)'}; color:#dce8f5; cursor:pointer;">
                        🤝 Diplomatic Reception
                    </button>
                    <button onclick="window._setFestivalStance('security')" style="padding: 8px; border-radius: 6px; border: 1px solid ${securityActive ? 'rgba(231,76,60,0.7)' : 'rgba(255,255,255,0.12)'}; background: ${securityActive ? 'rgba(231,76,60,0.2)' : 'rgba(255,255,255,0.04)'}; color:#f5dfdf; cursor:pointer;">
                        🛡️ Tight Security
                    </button>
                </div>
            `;

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 6px;">Seasonal Contest</div>';
            for (const contest of Object.values(Festivals.CONTESTS)) {
                const active = selectedContest === contest.id;
                const recommended = theme.recommendedContest === contest.id;
                html += `
                    <button onclick="window._setFestivalContest('${contest.id}')" style="width: 100%; text-align: left; margin-bottom: 6px; padding: 8px; border-radius: 6px; border: 1px solid ${active ? 'rgba(46,204,113,0.65)' : 'rgba(255,255,255,0.12)'}; background: ${active ? 'rgba(46,204,113,0.16)' : 'rgba(255,255,255,0.04)'}; color:#ddd; cursor:pointer;">
                        ${contest.icon} <strong>${contest.label}</strong> ${recommended ? '<span style="font-size:10px; color:#2ecc71;">(Season Favored)</span>' : ''}
                    </button>
                `;
            }

            html += `<div style="font-size: 12px; color: ${canAfford ? '#bbb' : '#ff7878'}; margin: 8px 0;">Cost: ${currentTier.cost} gold · Your gold: ${player.gold}</div>`;
            html += `<button onclick="window._beginFestival()" ${!canAfford ? 'disabled' : ''} style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Begin Festival</button>`;
            html += '</div>';

            game.ui.showCustomPanel('Festival Planning', html);
        };

        window._setFestivalTier = (tierId) => { selectedTier = tierId; render(); };
        window._setFestivalStance = (stance) => { selectedStance = stance; render(); };
        window._setFestivalContest = (contest) => { selectedContest = contest; render(); };

        const finalizeFestival = (contestScore) => {
            const result = Festivals.hostFestival(player, game.world, tile, {
                tier: selectedTier,
                stance: selectedStance,
                contest: selectedContest,
                contestScore,
            });

            if (!result.success) {
                game.ui.showNotification('Festival Failed', result.reason, 'error');
                render();
                return;
            }

            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.festival = (player.financeToday.expenses.festival || 0) + result.tier.cost;
                if (result.contestPrize > 0) {
                    player.financeToday.income = player.financeToday.income || {};
                    player.financeToday.income.festival = (player.financeToday.income.festival || 0) + result.contestPrize;
                }
            }

            let summary = '<div style="max-width: 560px;">';
            summary += `<h4 style="margin-top: 0;">${result.seasonTheme.icon} Festival Completed</h4>`;
            summary += `<div style="margin-bottom: 8px;">${result.contestResult.text}</div>`;
            summary += `<div style="font-size: 12px; color: #ddd; margin-bottom: 8px;">+${result.renownGain} renown · Morale boost ${Math.round(result.moraleBoost * 100)}% for ${result.moraleDays} days</div>`;
            summary += `<div style="font-size: 11px; color: #aaa; margin-bottom: 10px;">Contest prize: ${result.contestPrize}g</div>`;

            if (result.reputations.length > 0) {
                summary += '<div style="font-size: 11px; text-transform: uppercase; color: #3498db; letter-spacing: 1px; margin-bottom: 4px;">Diplomatic Outcomes</div>';
                for (const row of result.reputations) {
                    summary += `<div style="font-size: 12px; color:#b8d9f5;">🤝 ${row.rival}: +${row.repGain} reputation</div>`;
                }
            }

            if (result.sabotage.length > 0) {
                summary += '<div style="font-size: 11px; text-transform: uppercase; color: #e67e22; letter-spacing: 1px; margin: 8px 0 4px;">Sabotage Attempts</div>';
                for (const row of result.sabotage) {
                    summary += row.caught
                        ? `<div style="font-size: 12px; color:#f3c998;">🛡️ Agents from ${row.rival} were caught before causing damage.</div>`
                        : `<div style="font-size: 12px; color:#f0b7aa;">⚠️ Operatives from ${row.rival} caused losses: -${row.goldLost}g.</div>`;
                }
            }

            summary += '<button onclick="game.ui.hideCustomPanel(); game.endDay();" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Continue</button>';
            summary += '</div>';

            game.ui.showCustomPanel('Festival Results', summary);
            game.ui.updateStats(player, game.world);
        };

        window._beginFestival = () => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const tier = Festivals.BUDGET_TIERS[selectedTier] || Festivals.BUDGET_TIERS.modest;
            if (player.gold < tier.cost) {
                game.ui.showNotification('Not Enough Gold', `You need ${tier.cost} gold to host this festival.`, 'error');
                return;
            }

            if (selectedContest === 'jousting') {
                ActionMenu._runJoustingFestivalMinigame(game, finalizeFestival);
            } else {
                ActionMenu._runArcheryFestivalMinigame(game, finalizeFestival);
            }
        };

        render();
    },

    _runJoustingFestivalMinigame(game, onDone) {
        const lanes = ['Left', 'Center', 'Right'];
        const icons = { Left: '⬅️', Center: '⬆️', Right: '➡️' };
        const sequence = [Utils.randPick(lanes), Utils.randPick(lanes), Utils.randPick(lanes)];
        const picks = [];

        const showSequence = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🐎 Jousting Lists</h4>';
            html += '<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Memorize the charge pattern, then repeat it correctly.</div>';
            html += `<div style="font-size: 28px; letter-spacing: 8px; text-align:center; margin: 12px 0;">${sequence.map(s => icons[s]).join('')}</div>`;
            html += '<button onclick="window._startJoustInput()" style="width:100%; padding:10px; background:#c97d32; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">I Memorized It</button>';
            html += '</div>';
            game.ui.showCustomPanel('Jousting Contest', html);
        };

        const showInput = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🐎 Repeat the Pattern</h4>';
            html += `<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Step ${picks.length + 1}/3</div>`;
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">';
            for (const lane of lanes) {
                html += `<button onclick="window._pickJoustLane('${lane}')" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">${icons[lane]} ${lane}</button>`;
            }
            html += '</div>';
            html += '</div>';
            game.ui.showCustomPanel('Jousting Contest', html);
        };

        window._startJoustInput = () => showInput();
        window._pickJoustLane = (lane) => {
            picks.push(lane);
            if (picks.length < 3) {
                showInput();
                return;
            }

            let matches = 0;
            for (let i = 0; i < sequence.length; i++) {
                if (picks[i] === sequence[i]) matches++;
            }
            onDone(matches);
        };

        showSequence();
    },

    _runArcheryFestivalMinigame(game, onDone) {
        const drifts = [Utils.randPick([-1, 0, 1]), Utils.randPick([-1, 0, 1]), Utils.randPick([-1, 0, 1])];
        let shot = 0;
        let hits = 0;

        const windLabel = (val) => val === 0 ? 'Calm' : (val < 0 ? 'Wind Left' : 'Wind Right');
        const windIcon = (val) => val === 0 ? '⬆️' : (val < 0 ? '⬅️' : '➡️');

        const render = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🏹 Archery Contest</h4>';
            html += `<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Shot ${shot + 1}/3 — compensate for wind.</div>`;
            html += `<div style="font-size: 18px; margin: 8px 0; text-align:center;">${windIcon(drifts[shot])} ${windLabel(drifts[shot])}</div>`;
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">';
            html += '<button onclick="window._pickArchery(-1)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Left</button>';
            html += '<button onclick="window._pickArchery(0)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Center</button>';
            html += '<button onclick="window._pickArchery(1)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Right</button>';
            html += '</div>';
            html += '</div>';
            game.ui.showCustomPanel('Archery Contest', html);
        };

        window._pickArchery = (aim) => {
            if (aim + drifts[shot] === 0) hits++;
            shot++;

            if (shot >= drifts.length) {
                onDone(hits);
                return;
            }

            render();
        };

        render();
    },

    /**
     * Pickpocket — pocket puzzle minigame
     * Search a grid of hidden tiles to find the purse while avoiding noisy items.
     * The target periodically glances around — freeze or get caught!
     */
    doPickpocket(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const stealthSkill = player.skills?.stealth || 1;
        const luckStat = player.luck || 5;
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' ? 'town' : 'village');

        // ── Target generation ──
        const targetPool = [
            { type: 'peasant',    icon: '👨‍🌾', name: 'Farmer',         gold: [3, 12],   awareness: 0.2, tier: ['village','town','capital'] },
            { type: 'merchant',   icon: '🧑‍💼', name: 'Merchant',       gold: [10, 35],  awareness: 0.45, tier: ['town','capital'] },
            { type: 'noble',      icon: '🤴',  name: 'Minor Noble',    gold: [25, 60],  awareness: 0.6,  tier: ['town','capital'] },
            { type: 'drunk',      icon: '🍺',  name: 'Drunkard',       gold: [2, 10],   awareness: 0.1,  tier: ['village','town','capital'] },
            { type: 'traveler',   icon: '🧳',  name: 'Traveler',       gold: [8, 25],   awareness: 0.35, tier: ['village','town','capital'] },
            { type: 'guard',      icon: '💂',  name: 'Off-Duty Guard', gold: [15, 30],  awareness: 0.7,  tier: ['town','capital'] },
            { type: 'priest',     icon: '⛪',  name: 'Priest',         gold: [5, 20],   awareness: 0.25, tier: ['village','town','capital'] },
            { type: 'aristocrat', icon: '👸',  name: 'Aristocrat',     gold: [40, 80],  awareness: 0.75, tier: ['capital'] },
        ];

        const available = targetPool.filter(t => t.tier.includes(tier));
        const targets = [];
        const copy = [...available];
        for (let i = 0; i < Math.min(3, copy.length); i++) {
            const idx = Math.floor(Math.random() * copy.length);
            const t = copy.splice(idx, 1)[0];
            const goldAmount = t.gold[0] + Math.floor(Math.random() * (t.gold[1] - t.gold[0] + 1));
            const diff = t.awareness < 0.3 ? 'Easy' : t.awareness < 0.5 ? 'Medium' : t.awareness < 0.7 ? 'Hard' : 'Risky';
            const diffColor = t.awareness < 0.3 ? '#2ecc71' : t.awareness < 0.5 ? '#f39c12' : t.awareness < 0.7 ? '#e67e22' : '#e74c3c';
            targets.push({ ...t, goldAmount, diff, diffColor });
        }

        // ── Grid tile types ──
        // 💰 purse (win), 💲 coins (bonus gold), 🔑 keys (noise +susp), 🔔 bell (big noise),
        // 📜 map (reveals neighbors), 🕳️ empty pocket, 🧵 lint (nothing)
        const TILE_TYPES = {
            purse:  { icon: '💰', label: 'Purse!', color: '#f5c542', susp: 0 },
            coins:  { icon: '💲', label: 'Loose coins', color: '#f39c12', susp: 3 },
            keys:   { icon: '🔑', label: 'Keys — jingle!', color: '#e67e22', susp: 18 },
            bell:   { icon: '🔔', label: 'Bell — CLANG!', color: '#e74c3c', susp: 30 },
            map:    { icon: '📜', label: 'Note — reveals area', color: '#3498db', susp: 2 },
            empty:  { icon: '🕳️', label: 'Empty pocket', color: '#555', susp: 1 },
            lint:   { icon: '🧵', label: 'Just lint...', color: '#666', susp: 1 },
        };

        // ── Game state ──
        let phase = 'select'; // select → puzzle → result
        let selectedTarget = null;
        let grid = [];        // 2D array of { type, revealed, hinted, row, col }
        let gridRows = 0, gridCols = 0;
        let suspicionLevel = 0;
        let caught = false;
        let escaped = false;
        let stolenGold = 0;
        let bonusGold = 0;
        let statusMsg = '';
        let frozen = false;        // target is looking — don't click!
        let freezeWarning = false; // flash warning before freeze
        let glanceInterval = null;
        let glanceTimeout = null;
        let suspInterval = null;
        let tilesFlipped = 0;
        let foundPurse = false;
        let clickLocked = false;   // brief lock after each flip

        const cleanup = () => {
            if (glanceInterval) clearInterval(glanceInterval);
            if (glanceTimeout) clearTimeout(glanceTimeout);
            if (suspInterval) clearInterval(suspInterval);
        };

        // ── Build grid ──
        const buildGrid = (target) => {
            // Grid size scales with difficulty
            const aw = target.awareness;
            if (aw >= 0.7) { gridRows = 5; gridCols = 4; }
            else if (aw >= 0.45) { gridRows = 4; gridCols = 4; }
            else if (aw >= 0.25) { gridRows = 4; gridCols = 3; }
            else { gridRows = 3; gridCols = 3; }

            const total = gridRows * gridCols;
            const contents = [];
            contents.push('purse');  // always 1 purse

            // Scale hazards with awareness
            const numKeys = aw >= 0.6 ? 3 : aw >= 0.35 ? 2 : 1;
            const numBells = aw >= 0.7 ? 2 : aw >= 0.45 ? 1 : 0;
            const numCoins = 1 + Math.floor(Math.random() * 2);
            const numMaps = Math.random() < 0.4 ? 1 : 0;

            for (let i = 0; i < numKeys; i++) contents.push('keys');
            for (let i = 0; i < numBells; i++) contents.push('bell');
            for (let i = 0; i < numCoins; i++) contents.push('coins');
            for (let i = 0; i < numMaps; i++) contents.push('map');

            // Fill remaining with empties/lint
            while (contents.length < total) {
                contents.push(Math.random() < 0.5 ? 'empty' : 'lint');
            }

            // Shuffle (Fisher-Yates)
            for (let i = contents.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [contents[i], contents[j]] = [contents[j], contents[i]];
            }

            grid = [];
            for (let r = 0; r < gridRows; r++) {
                const row = [];
                for (let c = 0; c < gridCols; c++) {
                    row.push({ type: contents[r * gridCols + c], revealed: false, hinted: false, row: r, col: c });
                }
                grid.push(row);
            }

            // Stealth hints — reveal some safe tiles (empties/lint)
            const hints = Math.min(stealthSkill, Math.floor(total * 0.3));
            const safeTiles = [];
            for (let r = 0; r < gridRows; r++) {
                for (let c = 0; c < gridCols; c++) {
                    const t = grid[r][c];
                    if (t.type === 'empty' || t.type === 'lint') safeTiles.push(t);
                }
            }
            // Shuffle safe tiles
            for (let i = safeTiles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [safeTiles[i], safeTiles[j]] = [safeTiles[j], safeTiles[i]];
            }
            for (let i = 0; i < Math.min(hints, safeTiles.length); i++) {
                safeTiles[i].hinted = true;
            }

            // Luck bonus — hint one hazard tile
            if (luckStat >= 7) {
                const hazards = [];
                for (let r = 0; r < gridRows; r++) {
                    for (let c = 0; c < gridCols; c++) {
                        if (grid[r][c].type === 'keys' || grid[r][c].type === 'bell') hazards.push(grid[r][c]);
                    }
                }
                if (hazards.length > 0) {
                    hazards[Math.floor(Math.random() * hazards.length)].hinted = true;
                }
            }
        };

        // ── Reveal neighbors (map tile) ──
        const revealNeighbors = (row, col) => {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = row + dr, nc = col + dc;
                    if (nr >= 0 && nr < gridRows && nc >= 0 && nc < gridCols) {
                        grid[nr][nc].hinted = true;
                    }
                }
            }
        };

        // ── Start glance cycle ──
        const startGlanceCycle = () => {
            const scheduleGlance = () => {
                // Time between glances — shorter for more aware targets
                const baseDelay = 4500 - selectedTarget.awareness * 2500;
                const delay = baseDelay + Math.random() * 2000;
                glanceInterval = setTimeout(() => {
                    if (phase !== 'puzzle') return;
                    // Warning flash
                    freezeWarning = true;
                    statusMsg = '<span style="color: #f39c12; font-weight: bold;">⚠️ They\'re turning around — DON\'T TOUCH!</span>';
                    render();

                    // After 0.8s warning, freeze starts
                    glanceTimeout = setTimeout(() => {
                        if (phase !== 'puzzle') return;
                        frozen = true;
                        freezeWarning = false;
                        statusMsg = '<span style="color: #e74c3c; font-weight: bold;">👁️ They\'re looking! FREEZE!</span>';
                        render();

                        // Freeze lasts 1.2-2s
                        const freezeDur = 1200 + Math.random() * 800;
                        glanceTimeout = setTimeout(() => {
                            if (phase !== 'puzzle') return;
                            frozen = false;
                            statusMsg = '<span style="color: #2ecc71;">They looked away. Continue searching...</span>';
                            render();
                            scheduleGlance();
                        }, freezeDur);
                    }, 800);
                }, delay);
            };
            scheduleGlance();
        };

        // ── Render ──
        const render = () => {
            let html = '<div style="max-width: 520px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">🤏 Pickpocket</h4>';

            if (phase === 'select') {
                html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Stealth: ${stealthSkill} | Luck: ${luckStat} | ${settlement.name} (${tier})</p>`;
                html += '<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">Choose your mark from the crowd:</div>';

                for (let i = 0; i < targets.length; i++) {
                    const t = targets[i];
                    const gridSize = t.awareness >= 0.7 ? '5×4' : t.awareness >= 0.45 ? '4×4' : t.awareness >= 0.25 ? '4×3' : '3×3';
                    html += `<button onclick="window._ppSelectTarget(${i})"
                        style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 8px;
                               background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid ${t.diffColor};
                               border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                        <span style="font-size: 28px;">${t.icon}</span>
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 13px;">${t.name}</div>
                            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                                ${gridSize} pockets to search — find the purse!
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 12px; color: ${t.diffColor}; font-weight: bold;">${t.diff}</div>
                            <div style="font-size: 10px; color: var(--text-muted);">~${t.goldAmount}g</div>
                        </div>
                    </button>`;
                }

                html += `<button onclick="game.ui.hideCustomPanel();"
                    style="margin-top: 6px; padding: 8px 20px; background: none; border: 1px solid rgba(255,255,255,0.1);
                           border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">
                    Nevermind
                </button>`;

            } else if (phase === 'puzzle') {
                // ── Target + status ──
                const targetDir = frozen ? '👁️' : freezeWarning ? '⚠️' : '😶';
                html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 24px;">${selectedTarget.icon}</span>
                                <span style="font-size: 18px;">${targetDir}</span>
                            </div>
                            <span style="font-size: 11px; color: var(--text-muted);">Tiles flipped: ${tilesFlipped}</span>
                         </div>`;

                // Suspicion bar
                const barColor = suspicionLevel < 35 ? '#2ecc71' : suspicionLevel < 60 ? '#f39c12' : suspicionLevel < 80 ? '#e67e22' : '#e74c3c';
                const suspLabel = suspicionLevel < 35 ? '🤫 Unnoticed' : suspicionLevel < 60 ? '🤨 Curious...' : suspicionLevel < 80 ? '😠 Suspicious!' : '🚨 Alert!';
                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Suspicion</span>
                        <span style="color: ${barColor}; font-weight: 600;">${suspLabel} ${Math.round(suspicionLevel)}%</span>
                    </div>
                    <div style="position: relative; height: 16px; background: rgba(255,255,255,0.06); border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="position: absolute; left: 0; width: ${suspicionLevel}%; height: 100%; background: ${barColor}; transition: width 0.25s; border-radius: 7px;"></div>
                    </div>
                </div>`;

                // Status message
                if (statusMsg) {
                    html += `<div style="margin-bottom: 8px; font-size: 12px; min-height: 20px;">${statusMsg}</div>`;
                }

                // ── The Grid ──
                const borderGlow = frozen ? 'border-color: #e74c3c; box-shadow: inset 0 0 30px rgba(231,76,60,0.15);'
                                 : freezeWarning ? 'border-color: #f39c12; box-shadow: inset 0 0 20px rgba(243,156,18,0.1);'
                                 : 'border-color: rgba(255,255,255,0.08);';
                html += `<div style="display: inline-block; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 12px; border: 2px solid transparent; ${borderGlow} transition: all 0.3s; margin-bottom: 10px;">`;
                html += `<div style="display: grid; grid-template-columns: repeat(${gridCols}, 1fr); gap: 6px;">`;

                for (let r = 0; r < gridRows; r++) {
                    for (let c = 0; c < gridCols; c++) {
                        const cell = grid[r][c];
                        const tileInfo = TILE_TYPES[cell.type];

                        if (cell.revealed) {
                            // Revealed tile
                            html += `<div style="width: 52px; height: 52px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;
                                        background: rgba(255,255,255,0.04); border: 1px solid ${tileInfo.color}40;
                                        ${cell.type === 'purse' ? 'box-shadow: 0 0 12px rgba(245,197,66,0.3); background: rgba(245,197,66,0.08);' : ''}">
                                <span style="font-size: 20px;">${tileInfo.icon}</span>
                                <span style="font-size: 7px; color: ${tileInfo.color}; margin-top: 1px; opacity: 0.8;">${cell.type === 'empty' || cell.type === 'lint' ? '' : tileInfo.label.split(' ')[0]}</span>
                            </div>`;
                        } else if (cell.hinted) {
                            // Hinted tile — shows a subtle marking
                            const hintBorder = (cell.type === 'keys' || cell.type === 'bell') ? '#e74c3c' : '#2ecc71';
                            const hintIcon = (cell.type === 'keys' || cell.type === 'bell') ? '⚠' : '✓';
                            html += `<button onclick="window._ppFlip(${r},${c})"
                                style="width: 52px; height: 52px; border-radius: 8px; cursor: pointer; position: relative;
                                       background: rgba(255,255,255,0.06); border: 1px dashed ${hintBorder}50;
                                       color: var(--text-primary); transition: all 0.15s; display: flex; align-items: center; justify-content: center;"
                                onmouseenter="this.style.background='rgba(255,255,255,0.12)'" onmouseleave="this.style.background='rgba(255,255,255,0.06)'">
                                <span style="font-size: 12px; opacity: 0.3;">${hintIcon}</span>
                            </button>`;
                        } else {
                            // Hidden tile
                            html += `<button onclick="window._ppFlip(${r},${c})"
                                style="width: 52px; height: 52px; border-radius: 8px; cursor: pointer;
                                       background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
                                       border: 1px solid rgba(255,255,255,0.08);
                                       color: var(--text-primary); transition: all 0.15s; display: flex; align-items: center; justify-content: center;"
                                onmouseenter="this.style.background='rgba(255,255,255,0.12)'; this.style.borderColor='rgba(245,197,66,0.3)'"
                                onmouseleave="this.style.background='linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))'; this.style.borderColor='rgba(255,255,255,0.08)'">
                                <span style="font-size: 16px; opacity: 0.2;">?</span>
                            </button>`;
                        }
                    }
                }

                html += '</div></div>'; // end grid

                // Legend
                html += `<div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 6px;">
                    <span style="font-size: 10px; color: var(--text-muted);">💰 Purse = Win</span>
                    <span style="font-size: 10px; color: var(--text-muted);">💲 Coins = Bonus</span>
                    <span style="font-size: 10px; color: var(--text-muted);">🔑 Keys = Noise!</span>
                    <span style="font-size: 10px; color: var(--text-muted);">🔔 Bell = Loud!</span>
                    <span style="font-size: 10px; color: var(--text-muted);">📜 Note = Reveals</span>
                </div>`;
                html += `<div style="display: flex; gap: 10px; justify-content: center; margin-top: 4px;">
                    <span style="font-size: 10px; color: #2ecc71;">✓ = Stealth hint (safe)</span>
                    <span style="font-size: 10px; color: #e74c3c;">⚠ = Danger hint (avoid!)</span>
                </div>`;

                // Abort button
                html += `<button onclick="window._ppAbort()"
                    style="margin-top: 10px; padding: 6px 18px; background: none; border: 1px solid rgba(255,255,255,0.08);
                           border-radius: 6px; cursor: pointer; color: var(--text-muted); font-size: 11px;">
                    🚶 Walk Away
                </button>`;

            } else if (phase === 'result') {
                if (caught) {
                    html += `<div style="font-size: 48px; margin: 16px 0;">🚔</div>`;
                    html += `<div style="font-size: 16px; color: #e74c3c; font-weight: bold; margin-bottom: 8px;">CAUGHT!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">${statusMsg}</div>`;
                } else if (escaped) {
                    html += `<div style="font-size: 48px; margin: 16px 0;">😰</div>`;
                    html += `<div style="font-size: 16px; color: #f39c12; font-weight: bold; margin-bottom: 8px;">Close Call!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">${statusMsg}</div>`;
                } else {
                    html += `<div style="font-size: 48px; margin: 16px 0;">💰</div>`;
                    html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Success!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">${statusMsg}</div>`;
                    const totalGold = stolenGold + bonusGold;
                    html += `<div style="font-size: 20px; color: var(--gold); font-weight: bold; margin: 8px 0;">+${totalGold} gold</div>`;
                    if (bonusGold > 0) {
                        html += `<div style="font-size: 11px; color: var(--text-secondary);">(${stolenGold}g purse + ${bonusGold}g loose coins)</div>`;
                    }
                }

                html += `<button onclick="game.ui.hideCustomPanel();"
                            style="padding: 10px 32px; margin-top: 12px; background: linear-gradient(135deg, var(--gold), #d4a030); color: #1a1a2e; border: none;
                                   border-radius: 6px; cursor: pointer; font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;">
                            Continue
                         </button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🤏 Pickpocket', html);
        };

        render();

        // ── Select target ──
        window._ppSelectTarget = (idx) => {
            selectedTarget = targets[idx];

            ActionMenu._showMinigamePrompt(game, {
                title: '🤏 Pickpocket ' + selectedTarget.name,
                icon: selectedTarget.icon,
                description: `Attempt to steal from ${selectedTarget.name}. ${selectedTarget.diff} difficulty.`,
                baseRewardText: `Simple roll (~${Math.floor((0.5 + (player.skills?.stealth || 1) * 0.06 - selectedTarget.awareness * 0.3) * 100)}% success, ~${selectedTarget.goldAmount}g)`,
                onSkip: () => {
                    // Simple stealth roll
                    const stealthSkill = player.skills?.stealth || 1;
                    const successChance = Math.max(0.1, 0.5 + stealthSkill * 0.06 - selectedTarget.awareness * 0.3);
                    if (Math.random() < successChance) {
                        const stolen = selectedTarget.goldAmount;
                        player.gold += stolen;
                        player.karma = (player.karma || 0) - 1;
                        if (Math.random() < 0.2 && player.skills) {
                            player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 1);
                        }
                        game.ui.showNotification('🤏 Pickpocket', `Swiped ${stolen}g from the ${selectedTarget.name}. -1 karma.`, 'success');
                    } else {
                        // Caught — apply penalties
                        ActionMenu._ppDoCaught(game, tile, player, settlement, selectedTarget);
                    }
                    game.ui.updateStats(player, game.world);
                    game.ui.hideCustomPanel();
                    game.endDay();
                },
                onPlay: () => {
                    phase = 'puzzle';
                    suspicionLevel = 0;
                    tilesFlipped = 0;
                    bonusGold = 0;
                    foundPurse = false;
                    buildGrid(selectedTarget);
                    statusMsg = '<span style="color: var(--text-muted);">Search the pockets carefully — find the 💰 purse!</span>';
                    render();

                    // Passive suspicion tick
                    suspInterval = setInterval(() => {
                        if (phase !== 'puzzle') { clearInterval(suspInterval); return; }
                        const passiveRate = 0.8 + selectedTarget.awareness * 1.5;
                        suspicionLevel = Math.min(100, suspicionLevel + passiveRate);
                        if (suspicionLevel >= 100) {
                            clearInterval(suspInterval);
                            cleanup();
                            caught = true;
                            phase = 'result';
                            statusMsg = `The ${selectedTarget.name} felt your hand and called the guards!`;
                            ActionMenu._ppDoCaught(game, tile, player, settlement, selectedTarget);
                            render();
                        }
                    }, 1200);

                    // Start glance cycle
                    startGlanceCycle();
                }
            });
        };

        // ── Flip a tile ──
        window._ppFlip = (r, c) => {
            if (phase !== 'puzzle' || clickLocked) return;
            const cell = grid[r][c];
            if (cell.revealed) return;

            // Clicking during freeze = big suspicion spike
            if (frozen) {
                suspicionLevel = Math.min(100, suspicionLevel + 25 + selectedTarget.awareness * 15);
                statusMsg = '<span style="color: #e74c3c; font-weight: bold;">🚨 They felt your hand moving! Huge suspicion spike!</span>';
                if (suspicionLevel >= 100) {
                    cleanup();
                    caught = true;
                    phase = 'result';
                    statusMsg = `Caught red-handed! The ${selectedTarget.name} grabbed your wrist!`;
                    ActionMenu._ppDoCaught(game, tile, player, settlement, selectedTarget);
                    render();
                    return;
                }
                render();
                return;
            }

            // Clicking during warning = moderate spike
            if (freezeWarning) {
                suspicionLevel = Math.min(100, suspicionLevel + 10 + selectedTarget.awareness * 8);
                statusMsg = '<span style="color: #f39c12;">⚠️ Risky move while they\'re turning!</span>';
            }

            // Reveal the tile
            cell.revealed = true;
            tilesFlipped++;
            clickLocked = true;
            setTimeout(() => { clickLocked = false; }, 300);

            const tileInfo = TILE_TYPES[cell.type];
            // Add suspicion from tile type
            const suspGain = tileInfo.susp * (1 - stealthSkill * 0.04);
            suspicionLevel = Math.min(100, suspicionLevel + Math.max(0.5, suspGain));

            switch (cell.type) {
                case 'purse':
                    // WIN!
                    cleanup();
                    foundPurse = true;
                    stolenGold = selectedTarget.goldAmount;
                    player.gold += stolenGold + bonusGold;
                    if (player.financeToday) {
                        player.financeToday.income.theft = (player.financeToday.income.theft || 0) + stolenGold + bonusGold;
                    }
                    player.karma = (player.karma || 0) - 1;

                    let skillUpMsg = '';
                    if (Math.random() < 0.2 && player.skills) {
                        player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                        skillUpMsg = ' Your stealth skill improved!';
                    }

                    // Efficiency bonus
                    const efficiency = Math.max(0, gridRows * gridCols - tilesFlipped);
                    const effMsg = efficiency > (gridRows * gridCols * 0.6) ? ' Masterful work — barely disturbed a thing!' : '';

                    statusMsg = `Found it in ${tilesFlipped} moves! Deftly lifted the purse from the ${selectedTarget.name}. -1 karma.${skillUpMsg}${effMsg}`;
                    phase = 'result';
                    render();
                    game.ui.updateStats(player, game.world);
                    return;

                case 'coins':
                    const coinAmt = 1 + Math.floor(Math.random() * 4);
                    bonusGold += coinAmt;
                    statusMsg = `<span style="color: #f39c12;">💲 Found ${coinAmt} loose coins! Keep searching for the purse...</span>`;
                    break;

                case 'keys':
                    statusMsg = '<span style="color: #e67e22;">🔑 Keys jingle loudly! Suspicion rose.</span>';
                    break;

                case 'bell':
                    statusMsg = '<span style="color: #e74c3c;">🔔 A bell rings out! Heavy suspicion!</span>';
                    break;

                case 'map':
                    revealNeighbors(r, c);
                    statusMsg = '<span style="color: #3498db;">📜 A note — you glimpse the nearby pocket contents!</span>';
                    break;

                case 'empty':
                case 'lint':
                    statusMsg = `<span style="color: #666;">${tileInfo.icon} ${tileInfo.label} — nothing here.</span>`;
                    break;
            }

            // Check if caught from this flip
            if (suspicionLevel >= 100) {
                cleanup();
                caught = true;
                phase = 'result';
                statusMsg = `The noise gave you away! The ${selectedTarget.name} caught you!`;
                ActionMenu._ppDoCaught(game, tile, player, settlement, selectedTarget);
                render();
                return;
            }

            render();
        };

        // ── Walk away ──
        window._ppAbort = () => {
            cleanup();
            escaped = true;
            phase = 'result';
            if (bonusGold > 0) {
                player.gold += bonusGold;
                if (player.financeToday) {
                    player.financeToday.income.theft = (player.financeToday.income.theft || 0) + bonusGold;
                }
                player.karma = (player.karma || 0) - 1;
                statusMsg = `You pocketed ${bonusGold}g in loose coins and melted back into the crowd.`;
            } else {
                statusMsg = 'You thought better of it and melted back into the crowd.';
            }
            render();
        };
    },

    /**
     * Handle getting caught pickpocketing — fines, jail, reputation
     */
    _ppDoCaught(game, tile, player, settlement, target) {
        const fine = Math.floor(Math.random() * 30) + 10;
        const actualFine = Math.min(fine, player.gold);
        player.gold -= actualFine;
        player.karma = (player.karma || 0) - 3;

        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.fines = (player.financeToday.expenses.fines || 0) + actualFine;
        }

        const kingdomId = settlement.kingdom;
        if (kingdomId && player.reputation) {
            player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 5;
        }

        if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
        player.criminalRecord.pickpocket = (player.criminalRecord.pickpocket || 0) + 1;
        const offenses = player.criminalRecord.pickpocket;
        const jailDays = offenses === 1 ? 2 : offenses === 2 ? 4 : offenses === 3 ? 7 : 10 + (offenses - 4) * 3;
        const bailCost = jailDays * 25;
        player.jailState = {
            daysRemaining: jailDays,
            totalDays: jailDays,
            offense: 'pickpocketing',
            offenseNumber: offenses,
            settlement: settlement.name,
            bailCost: bailCost,
            escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
        };
        player.stamina = 0;
        player.movementRemaining = 0;

        game.ui.showNotification('🚔 Arrested!',
            `Caught pickpocketing the ${target.name}! Fined ${actualFine}g, sentenced to ${jailDays} days in jail (offense #${offenses}). -3 karma, -5 reputation.`, 'error');
        game.ui.updateStats(player, game.world);
    },

    /**
     * Smuggle goods — sell inventory items at premium but risk getting caught
     */
    showSmuggleMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        // Find sellable goods in inventory
        const goods = [];
        const excludeItems = ['bread'];
        for (const [item, qty] of Object.entries(player.inventory || {})) {
            if (qty > 0 && !excludeItems.includes(item)) {
                goods.push({ item, qty });
            }
        }

        if (goods.length === 0) {
            game.ui.showNotification('No Goods', 'You have nothing worth smuggling!', 'default');
            return;
        }

        const basePrices = {
            herbs: 8, pelts: 12, meat: 6, berries: 4, mushrooms: 5,
            hide: 15, antler: 20, feather: 10, fish: 5, ore: 25,
            gems: 80, stone: 8, horse: 120, wood: 3
        };

        // Step 1: Choose item to smuggle
        let html = '<div style="max-width: 420px;">';
        html += '<h4 style="margin-top: 0;">🏴‍☠️ Black Market Smuggling</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Sell goods at a premium through shady channels in ${settlement.name}. Sneak past guards to make the deal.</p>`;
        html += `<p style="font-size: 11px; color: #aaa;">Stealth: ${player.skills?.stealth || 1} | AP: ${player.actionPoints || 0} (costs 2 per deal)</p>`;

        for (const g of goods) {
            const basePrice = basePrices[g.item] || 10;
            const smugglePrice = Math.floor(basePrice * 2.5);
            html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">`;
            html += `<span>${g.item} (x${g.qty})</span>`;
            html += `<span style="color: var(--gold);">${smugglePrice}g each</span>`;
            html += `<button onclick="window._startSmuggleRun('${g.item}', ${smugglePrice})" style="padding: 4px 10px; background: #8b0000; border: none; border-radius: 3px; cursor: pointer; color: #fff; font-size: 11px;">Smuggle 1</button>`;
            html += `</div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('Smuggling', html);

        window._startSmuggleRun = (itemName, price) => {
            if (!player.inventory[itemName] || player.inventory[itemName] <= 0) {
                game.ui.showNotification('No Stock', 'You don\'t have any more of that!', 'error');
                return;
            }
            const apCost = 2;
            if ((player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ No Action Points', `Each smuggling deal costs ${apCost} AP.`, 'error');
                return;
            }
            player.actionPoints -= apCost;

            const stealthSkill = player.skills?.stealth || 1;

            ActionMenu._showMinigamePrompt(game, {
                title: '🏴‍☠️ Smuggle ' + itemName,
                icon: '🏴‍☠️',
                description: `Sneak past guards to sell ${itemName} for ${price}g.`,
                baseRewardText: `~${Math.floor(50 + stealthSkill * 6)}% success chance (simple roll)`,
                onSkip: () => {
                    // Old instant-roll mechanic
                    const successChance = 0.5 + stealthSkill * 0.06;
                    if (Math.random() < successChance) {
                        player.inventory[itemName]--;
                        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                        player.gold += price;
                        if (player.financeToday) {
                            player.financeToday.income.smuggling = (player.financeToday.income.smuggling || 0) + price;
                        }
                        player.karma = (player.karma || 0) - 1;
                        if (Math.random() < 0.15 && player.skills) {
                            player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                        }
                        game.ui.showNotification('🏴‍☠️ Deal Done', `Sold ${itemName} for ${price}g on the black market.`, 'success');
                    } else {
                        player.inventory[itemName]--;
                        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                        const fine = Math.floor(price * 0.5);
                        const actualFine = Math.min(fine, player.gold);
                        player.gold -= actualFine;
                        player.karma = (player.karma || 0) - 3;
                        if (player.financeToday) {
                            player.financeToday.expenses = player.financeToday.expenses || {};
                            player.financeToday.expenses.fines = (player.financeToday.expenses.fines || 0) + actualFine;
                        }
                        const kingdomId = settlement.kingdom;
                        if (kingdomId && player.reputation) {
                            player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 8;
                        }
                        if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
                        player.criminalRecord.smuggling = (player.criminalRecord.smuggling || 0) + 1;
                        const offenses = player.criminalRecord.smuggling;
                        const jailDays = offenses === 1 ? 3 : offenses === 2 ? 6 : offenses === 3 ? 10 : 14 + (offenses - 4) * 4;
                        const bailCost = jailDays * 30;
                        player.jailState = {
                            daysRemaining: jailDays, totalDays: jailDays, offense: 'smuggling',
                            offenseNumber: offenses, settlement: settlement.name, bailCost: bailCost,
                            escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
                        };
                        player.stamina = 0;
                        player.movementRemaining = 0;
                        game.ui.showNotification('🚔 Arrested!',
                            `Caught smuggling ${itemName}! Fined ${actualFine}g, sentenced to ${jailDays} days. -3 karma, -8 rep.`, 'error');
                    }
                    game.ui.updateStats(player, game.world);
                    game.ui.hideCustomPanel();
                    const remaining = Object.entries(player.inventory || {}).filter(([k, v]) => v > 0 && k !== 'bread');
                    if (remaining.length > 0) ActionMenu.showSmuggleMenu(game, tile);
                },
                onPlay: () => { ActionMenu._doSmuggleMinigame(game, tile, player, settlement, itemName, price, stealthSkill); }
            });
        };
    },

    _doSmuggleMinigame(game, tile, player, settlement, itemName, price, stealthSkill) {
            // ── Smuggling Minigame: Sneak past patrol lanes ──
            const LANES = 5; // number of patrol lanes to cross
            let currentLane = 0;
            let suspicion = 0; // 0-100, caught at 100
            let phase = 'sneaking'; // sneaking → result
            let statusMsg = '';
            let smuggleTimer = null;
            let resultSuccess = false;

            // Generate guard patrols per lane
            const lanes = [];
            for (let i = 0; i < LANES; i++) {
                const guardCount = 1 + Math.floor(i * 0.6);
                const speed = 1.5 + i * 0.4 - stealthSkill * 0.08;
                const guards = [];
                for (let g = 0; g < guardCount; g++) {
                    guards.push({
                        pos: Math.random() * 100,
                        speed: speed * (0.8 + Math.random() * 0.4),
                        dir: Math.random() > 0.5 ? 1 : -1,
                        width: 22 - stealthSkill * 0.8, // vision cone width
                    });
                }
                lanes.push({
                    guards,
                    label: ['Alley Entrance', 'Market Square', 'Guard Post', 'Noble District', 'Black Market'][i],
                    passed: false,
                    waiting: i === 0 // first lane is active
                });
            }

            // Animate guards
            const updateGuards = () => {
                for (const lane of lanes) {
                    for (const g of lane.guards) {
                        g.pos += g.speed * g.dir;
                        if (g.pos >= 100 || g.pos <= 0) {
                            g.dir *= -1;
                            g.pos = Math.max(0, Math.min(100, g.pos));
                        }
                    }
                }
            };

            // Check if safe to cross
            const isLaneSafe = (laneIdx) => {
                const lane = lanes[laneIdx];
                const playerZone = 50; // player crosses through middle
                for (const g of lane.guards) {
                    const left = g.pos - g.width / 2;
                    const right = g.pos + g.width / 2;
                    if (playerZone >= left && playerZone <= right) return false;
                }
                return true;
            };

            const renderSmuggle = () => {
                let h = '<div style="max-width: 440px; text-align: center;">';
                h += `<h4 style="margin: 0 0 4px;">🏴‍☠️ Smuggle ${itemName}</h4>`;

                if (phase === 'sneaking') {
                    // Suspicion bar
                    h += `<div style="margin-bottom: 8px;">
                        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px;">👁️ Suspicion</div>
                        <div style="background: rgba(255,255,255,0.06); border-radius: 4px; height: 10px; overflow: hidden;">
                            <div style="width: ${suspicion}%; height: 100%; background: ${suspicion > 70 ? '#e74c3c' : suspicion > 40 ? '#f39c12' : '#2ecc71'}; border-radius: 3px; transition: width 0.2s;"></div>
                        </div>
                    </div>`;

                    h += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">Lanes passed: ${currentLane}/${LANES}</div>`;

                    // Render each lane
                    for (let i = 0; i < LANES; i++) {
                        const lane = lanes[i];
                        const isCurrent = i === currentLane;
                        const isPassed = lane.passed;

                        h += `<div style="position: relative; height: 36px; margin-bottom: 3px; border-radius: 6px; overflow: hidden;
                            background: ${isPassed ? 'rgba(46,204,113,0.08)' : isCurrent ? 'rgba(243,156,18,0.08)' : 'rgba(255,255,255,0.03)'};
                            border: ${isCurrent ? '2px solid var(--gold)' : '1px solid rgba(255,255,255,0.06)'};">`;

                        // Lane label
                        h += `<div style="position: absolute; left: 6px; top: 50%; transform: translateY(-50%); font-size: 9px; color: var(--text-muted); z-index: 2;">
                            ${isPassed ? '✅' : ''} ${lane.label}
                        </div>`;

                        if (!isPassed) {
                            // Draw guards as red zones
                            for (const g of lane.guards) {
                                const left = Math.max(0, g.pos - g.width / 2);
                                const w = g.width;
                                h += `<div style="position: absolute; left: ${left}%; width: ${w}%; top: 0; bottom: 0;
                                    background: rgba(231,76,60,${isCurrent ? '0.4' : '0.15'}); border-radius: 3px; transition: left 0.1s;">
                                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 12px;">👮</div>
                                </div>`;
                            }

                            // Player crossing zone indicator (fixed at center)
                            if (isCurrent) {
                                h += `<div style="position: absolute; left: 48%; width: 4%; top: 0; bottom: 0;
                                    background: rgba(46,204,113,0.5); border-radius: 2px;"></div>`;
                            }
                        }

                        h += `</div>`;
                    }

                    if (statusMsg) h += `<div style="margin-top: 6px; font-size: 12px;">${statusMsg}</div>`;

                    h += `<div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px;">
                        <button onclick="window._smuggleSneak()"
                            style="padding: 10px 28px; background: rgba(46,204,113,0.15); border: 2px solid #2ecc71;
                                   border-radius: 8px; cursor: pointer; color: #2ecc71; font-size: 14px; font-weight: bold;"
                            onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                            🏃 Sneak Past!
                        </button>
                        <button onclick="window._smuggleAbort()"
                            style="padding: 10px 16px; background: none; border: 1px solid rgba(255,255,255,0.1);
                                   border-radius: 8px; cursor: pointer; color: var(--text-muted); font-size: 12px;">
                            Abort
                        </button>
                    </div>`;
                    h += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Watch the guards patrol. Click SNEAK when the path is clear!</div>`;

                } else {
                    // Result
                    if (smuggleTimer) { clearInterval(smuggleTimer); smuggleTimer = null; }

                    if (resultSuccess) {
                        h += `<div style="font-size: 48px; margin: 12px 0;">🏴‍☠️</div>`;
                        h += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Deal Complete!</div>`;
                        h += `<div style="padding: 8px 12px; background: rgba(245,197,66,0.1); border-radius: 4px; margin-bottom: 8px;">
                            <span style="color: var(--gold); font-size: 16px; font-weight: bold;">+${price}g</span>
                            <span style="color: var(--text-secondary); font-size: 12px;"> for ${itemName}</span>
                        </div>`;
                        h += `<div style="font-size: 12px; color: var(--text-secondary);">Slipped through ${LANES} guard patrols undetected.</div>`;
                    } else {
                        h += `<div style="font-size: 48px; margin: 12px 0;">🚔</div>`;
                        h += `<div style="font-size: 16px; color: #e74c3c; font-weight: bold; margin-bottom: 8px;">Caught!</div>`;
                        h += `<div style="color: var(--text-secondary); font-size: 12px;">${statusMsg}</div>`;
                    }

                    h += `<button onclick="window._smuggleDone()"
                        style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
                }

                h += '</div>';
                game.ui.showCustomPanel('🏴‍☠️ Smuggling', h);
            };

            // Start patrol animation
            smuggleTimer = setInterval(() => {
                if (phase !== 'sneaking') { clearInterval(smuggleTimer); return; }
                updateGuards();
                // Passive suspicion decay
                suspicion = Math.max(0, suspicion - 0.1);
                renderSmuggle();
            }, 150);

            window._smuggleSneak = () => {
                if (phase !== 'sneaking') return;

                if (isLaneSafe(currentLane)) {
                    // Successful sneak
                    lanes[currentLane].passed = true;
                    currentLane++;
                    statusMsg = `<span style="color: #2ecc71;">✅ Slipped past!</span>`;

                    if (currentLane >= LANES) {
                        // All lanes cleared — success!
                        phase = 'result';
                        resultSuccess = true;

                        player.inventory[itemName]--;
                        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                        player.gold += price;
                        if (player.financeToday) {
                            player.financeToday.income.smuggling = (player.financeToday.income.smuggling || 0) + price;
                        }
                        player.karma = (player.karma || 0) - 1;

                        if (Math.random() < 0.15 && player.skills) {
                            player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                        }
                    }
                } else {
                    // Spotted!
                    const spotPenalty = 25 - stealthSkill * 1.5;
                    suspicion += Math.max(8, spotPenalty);
                    statusMsg = `<span style="color: #e74c3c;">👁️ Guard spotted you! +${Math.floor(spotPenalty)} suspicion</span>`;

                    if (suspicion >= 100) {
                        // Caught!
                        phase = 'result';
                        resultSuccess = false;

                        player.inventory[itemName]--;
                        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                        const fine = Math.floor(price * 0.5);
                        const actualFine = Math.min(fine, player.gold);
                        player.gold -= actualFine;
                        player.karma = (player.karma || 0) - 3;

                        if (player.financeToday) {
                            player.financeToday.expenses = player.financeToday.expenses || {};
                            player.financeToday.expenses.fines = (player.financeToday.expenses.fines || 0) + actualFine;
                        }

                        const kingdomId = settlement.kingdom;
                        if (kingdomId && player.reputation) {
                            player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 8;
                        }

                        if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
                        player.criminalRecord.smuggling = (player.criminalRecord.smuggling || 0) + 1;
                        const offenses = player.criminalRecord.smuggling;
                        const jailDays = offenses === 1 ? 3 : offenses === 2 ? 6 : offenses === 3 ? 10 : 14 + (offenses - 4) * 4;
                        const bailCost = jailDays * 30;
                        player.jailState = {
                            daysRemaining: jailDays,
                            totalDays: jailDays,
                            offense: 'smuggling',
                            offenseNumber: offenses,
                            settlement: settlement.name,
                            bailCost: bailCost,
                            escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
                        };
                        player.stamina = 0;
                        player.movementRemaining = 0;

                        statusMsg = `Caught smuggling ${itemName}! Fined ${actualFine}g, sentenced to ${jailDays} days in jail (offense #${offenses}). -3 karma, -8 rep.`;
                    }
                }
                renderSmuggle();
                game.ui.updateStats(player, game.world);
            };

            window._smuggleAbort = () => {
                if (smuggleTimer) { clearInterval(smuggleTimer); smuggleTimer = null; }
                game.ui.hideCustomPanel();
                // Refund AP since they didn't complete
                player.actionPoints += apCost;
                game.ui.updateStats(player, game.world);
                ActionMenu.showSmuggleMenu(game, tile);
            };

            window._smuggleDone = () => {
                if (smuggleTimer) { clearInterval(smuggleTimer); smuggleTimer = null; }
                game.ui.hideCustomPanel();
                game.ui.updateStats(player, game.world);
                const remaining = Object.entries(player.inventory || {}).filter(([k, v]) => v > 0 && k !== 'bread');
                if (remaining.length > 0 && resultSuccess) {
                    ActionMenu.showSmuggleMenu(game, tile);
                }
            };

            renderSmuggle();
    },

    /**
     * Train combat at a settlement — costs gold, improves combat skill
     */
    doTrainCombat(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const cost = settlement.type === 'capital' ? 75 : 50;
        if (player.gold < cost) {
            game.ui.showNotification('Not Enough Gold', `Training costs ${cost} gold.`, 'error');
            return;
        }

        player.gold -= cost;
        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.training = (player.financeToday.expenses.training || 0) + cost;
        }

        ActionMenu._showMinigamePrompt(game, {
            title: '⚔️ Combat Training',
            icon: '⚔️',
            description: `Spar with a trainer in ${settlement.name}. (Paid ${cost}g)`,
            baseRewardText: '15% chance combat skill +1',
            onSkip: () => {
                // Base reward: small chance of stat growth
                let msg = `Trained with the ${settlement.type === 'capital' ? 'Royal Swordmaster' : 'Militia Sergeant'}.`;
                if (Math.random() < 0.15) {
                    player.skills = player.skills || {};
                    player.skills.combat = Math.min(10, (player.skills.combat || 1) + 1);
                    msg += ' ⚔️ Combat skill improved!';
                }
                if (player.army && player.army.length > 0) {
                    const xp = 8;
                    for (const unit of player.army) unit.experience = (unit.experience || 0) + xp;
                    msg += ` Army gained ${xp} XP.`;
                }
                game.ui.showNotification('⚔️ Training', msg, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doTrainCombatMinigame(game, tile, player, settlement, cost); }
        });
    },

    _doTrainCombatMinigame(game, tile, player, settlement, cost) {
        // ── Combat Training Minigame: Sparring duel ──
        const combatSkill = player.skills?.combat || 1;
        const isCapital = settlement.type === 'capital';
        const opponentName = isCapital ? 'Royal Swordmaster' : 'Militia Sergeant';
        const opponentIcon = isCapital ? '🗡️' : '⚔️';
        const rounds = 5;
        let currentRound = 0;
        let playerScore = 0;
        let opponentScore = 0;
        let phase = 'ready'; // ready → choose → clash → result
        let playerChoice = null;
        let opponentChoice = null;
        let clashResult = '';
        let statusMsg = '';
        let sparInterval = null;
        let timeLeft = 0;

        const moves = [
            { id: 'slash',  icon: '⚔️',  label: 'Slash',  beats: 'thrust' },
            { id: 'thrust', icon: '🗡️',  label: 'Thrust', beats: 'block' },
            { id: 'block',  icon: '🛡️',  label: 'Block',  beats: 'slash' },
        ];

        const getMove = (id) => moves.find(m => m.id === id);

        const cleanup = () => {
            if (sparInterval) { clearInterval(sparInterval); sparInterval = null; }
        };

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">⚔️ Combat Training</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px;">${settlement.name} — Sparring with ${opponentIcon} ${opponentName} (paid ${cost}g)</p>`;

            if (phase === 'ready' || phase === 'choose') {
                // Scoreboard
                html += `<div style="display: flex; justify-content: space-around; margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                    <div>
                        <div style="font-size: 11px; color: var(--text-muted);">You</div>
                        <div style="font-size: 28px; color: #2ecc71; font-weight: bold;">${playerScore}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; color: var(--text-muted);">Round</div>
                        <div style="font-size: 20px; color: var(--text-primary); font-weight: bold;">${currentRound + 1}/${rounds}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; color: var(--text-muted);">${opponentName}</div>
                        <div style="font-size: 28px; color: #e74c3c; font-weight: bold;">${opponentScore}</div>
                    </div>
                </div>`;

                if (phase === 'choose') {
                    // Timer bar
                    html += `<div style="margin-bottom: 8px;">
                        <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 8px; overflow: hidden;">
                            <div style="width: ${timeLeft}%; height: 100%; background: ${timeLeft < 30 ? '#e74c3c' : '#f39c12'}; transition: width 0.1s; border-radius: 5px;"></div>
                        </div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Choose your move!</div>
                    </div>`;
                }

                html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Choose your technique:</div>`;
                html += `<div style="display: flex; gap: 10px; justify-content: center;">`;
                for (const m of moves) {
                    const beatsMove = getMove(m.beats);
                    html += `<button onclick="window._sparMove('${m.id}')"
                        style="flex: 1; padding: 16px 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
                               border-radius: 10px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; text-align: center;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.1)'; this.style.borderColor='var(--gold)'"
                        onmouseleave="this.style.background='rgba(255,255,255,0.04)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                        <div style="font-size: 28px; margin-bottom: 4px;">${m.icon}</div>
                        <div style="font-size: 13px; font-weight: bold;">${m.label}</div>
                        <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">beats ${beatsMove.label}</div>
                    </button>`;
                }
                html += `</div>`;

                if (statusMsg) html += `<div style="margin-top: 10px; font-size: 12px;">${statusMsg}</div>`;

            } else if (phase === 'clash') {
                const pm = getMove(playerChoice);
                const om = getMove(opponentChoice);
                html += `<div style="display: flex; justify-content: space-around; align-items: center; margin: 16px 0;">
                    <div>
                        <div style="font-size: 48px;">${pm.icon}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Your ${pm.label}</div>
                    </div>
                    <div style="font-size: 24px; color: var(--gold);">⚡</div>
                    <div>
                        <div style="font-size: 48px;">${om.icon}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${opponentName}'s ${om.label}</div>
                    </div>
                </div>`;
                html += `<div style="font-size: 16px; font-weight: bold; margin-bottom: 12px;">${clashResult}</div>`;

                // Scoreboard
                html += `<div style="display: flex; justify-content: space-around; margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                    <div style="font-size: 24px; color: #2ecc71; font-weight: bold;">${playerScore}</div>
                    <div style="font-size: 14px; color: var(--text-muted);">Round ${currentRound}/${rounds}</div>
                    <div style="font-size: 24px; color: #e74c3c; font-weight: bold;">${opponentScore}</div>
                </div>`;

                if (currentRound < rounds) {
                    html += `<button onclick="window._sparNext()"
                        style="padding: 10px 32px; background: rgba(255,255,255,0.08); border: 1px solid var(--gold); border-radius: 8px;
                               cursor: pointer; color: var(--gold); font-weight: bold; font-size: 13px;">Next Round →</button>`;
                } else {
                    html += `<button onclick="window._sparFinish()"
                        style="padding: 10px 32px; background: var(--gold); border: none; border-radius: 8px;
                               cursor: pointer; font-weight: bold; font-size: 13px;">See Results</button>`;
                }

            } else if (phase === 'result') {
                const won = playerScore > opponentScore;
                const tied = playerScore === opponentScore;
                html += `<div style="font-size: 48px; margin: 8px 0;">${won ? '🏆' : tied ? '🤝' : '😤'}</div>`;
                html += `<div style="font-size: 18px; color: ${won ? '#2ecc71' : tied ? '#f39c12' : '#e74c3c'}; font-weight: bold; margin-bottom: 4px;">
                    ${won ? 'Victory!' : tied ? 'Draw!' : 'Defeated!'}
                </div>`;
                html += `<div style="font-size: 14px; margin-bottom: 8px;">${playerScore} - ${opponentScore}</div>`;

                if (statusMsg) html += `<div style="font-size: 12px; color: var(--text-secondary); white-space: pre-line; margin-bottom: 8px;">${statusMsg}</div>`;

                html += `<button onclick="game.ui.hideCustomPanel(); game.endDay();"
                    style="width: 100%; margin-top: 8px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('⚔️ Combat Training', html);
        };

        // Start first round
        phase = 'choose';
        timeLeft = 100;
        render();

        // Timer for each round
        const startTimer = () => {
            timeLeft = 100;
            cleanup();
            sparInterval = setInterval(() => {
                timeLeft -= 5;
                if (timeLeft <= 0) {
                    // Auto-pick random move
                    cleanup();
                    const autoMove = moves[Math.floor(Math.random() * moves.length)];
                    resolveClash(autoMove.id);
                }
                // Light re-render of just the timer would be complex, so we re-render
                if (timeLeft > 0 && phase === 'choose') render();
            }, 200);
        };
        startTimer();

        const resolveClash = (pMoveId) => {
            cleanup();
            playerChoice = pMoveId;
            // Opponent AI — slightly favors beating the player's last move at higher levels
            const opMoves = moves.map(m => m.id);
            opponentChoice = opMoves[Math.floor(Math.random() * opMoves.length)];

            const pm = getMove(playerChoice);
            const om = getMove(opponentChoice);

            if (pm.beats === om.id) {
                playerScore++;
                clashResult = `<span style="color: #2ecc71;">Your ${pm.label} beats ${om.label}! Hit!</span>`;
            } else if (om.beats === pm.id) {
                opponentScore++;
                clashResult = `<span style="color: #e74c3c;">${om.label} beats your ${pm.label}! Counter-hit!</span>`;
            } else {
                clashResult = `<span style="color: #f39c12;">Both ${pm.label} — Clash! No point.</span>`;
            }

            currentRound++;
            phase = 'clash';
            render();
        };

        window._sparMove = (moveId) => {
            if (phase !== 'choose') return;
            resolveClash(moveId);
        };

        window._sparNext = () => {
            if (currentRound >= rounds) return;
            phase = 'choose';
            statusMsg = '';
            render();
            startTimer();
        };

        window._sparFinish = () => {
            cleanup();
            phase = 'result';
            let msgs = [];

            const won = playerScore > opponentScore;
            const tied = playerScore === opponentScore;

            // Combat skill — high chance if won, lower if lost
            const combatChance = won ? (isCapital ? 0.65 : 0.45) :
                                 tied ? (isCapital ? 0.35 : 0.20) :
                                        (isCapital ? 0.20 : 0.10);
            if (Math.random() < combatChance && player.skills) {
                player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
                msgs.push('⚔️ Combat skill improved!');
            } else {
                msgs.push(won ? 'Good fight, but no skill breakthrough.' : 'A humbling lesson.');
            }

            // Strength improvement
            if (Math.random() < (won ? 0.20 : 0.10)) {
                player.strength = (player.strength || 5) + 1;
                msgs.push('💪 Strength increased!');
            }

            // Army XP if player has troops
            if (player.army && player.army.length > 0) {
                const xpGain = isCapital ? 15 : 10;
                const bonus = won ? 5 : 0;
                for (const unit of player.army) {
                    unit.experience = (unit.experience || 0) + xpGain + bonus;
                }
                msgs.push(`🎖️ Army gained ${xpGain + bonus} XP from drills.`);
            }

            statusMsg = msgs.join('\n');
            render();
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Meditate — restore health, gain karma, faith bonus at holy sites
     */
    doMeditate(game, tile) {
        const player = game.player;
        const isHolySite = !!tile.holySite;
        const faithStat = player.faith || 5;
        const intStat = player.intelligence || 5;

        const baseHeal = Math.max(5, 10 + ((faithStat - 3) * 2) + (isHolySite ? 15 : 0));
        const baseKarma = isHolySite ? 5 : 2;

        ActionMenu._showMinigamePrompt(game, {
            title: '🧘 Meditation',
            icon: '🧘',
            description: `Meditate peacefully${isHolySite ? ' at this holy site' : ''}.`,
            baseRewardText: `+${baseHeal} HP, +${baseKarma} karma`,
            onSkip: () => {
                // Base reward: simple instant heal + karma (original pre-minigame behavior)
                player.health = Math.min(player.maxHealth || 100, player.health + baseHeal);
                player.karma = (player.karma || 0) + baseKarma;
                let msg = `Meditated peacefully. +${baseHeal} HP, +${baseKarma} karma.`;
                if (Math.random() < (isHolySite ? 0.35 : 0.1)) {
                    player.faith = (player.faith || 5) + 1;
                    msg += ' Your faith deepened.';
                }
                if (Math.random() < 0.1) {
                    player.intelligence = (player.intelligence || 5) + 1;
                    msg += ' Your mind feels sharper.';
                }
                if (isHolySite) msg += ' The holy site amplified your meditation!';
                game.ui.showNotification('🧘 Meditation', msg, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doMeditateMinigame(game, tile, player, isHolySite, faithStat, intStat); }
        });
    },

    _doMeditateMinigame(game, tile, player, isHolySite, faithStat, intStat) {
        // ── Meditation Minigame: Breathing Focus ──
        // A pulsing circle breathes in and out. Player must click/press at the peak of each breath.
        // Accuracy determines meditation quality.
        const totalBreaths = 8;
        let currentBreath = 0;
        let focusScore = 0; // 0 to totalBreaths (perfect clicks)
        let phase = 'meditating'; // meditating → result
        let breathPhase = 0; // 0 to 2*PI per cycle
        let breathSpeed = 0.04 + (isHolySite ? 0 : 0.01); // holy sites = slightly easier
        let lastClickResult = '';
        let canClick = true;
        let medTimer = null;
        let breathSize = 0; // 0-100, pulsing
        let peakZone = 12 + faithStat * 1.5 + intStat * 0.5; // tolerance window (higher faith = wider sweet spot)
        let distractions = [];
        let distractionTimer = 0;

        // Distraction messages that appear to break focus
        const distractionTexts = [
            '💭 Your mind wanders to gold...',
            '💭 Memories of battle surface...',
            '💭 A bug lands on your nose...',
            '💭 You hear distant laughter...',
            '💭 Your stomach growls...',
            '💭 An itch demands attention...',
            '💭 You think about tomorrow...',
            '💭 Was that a wolf howl?',
        ];

        const render = () => {
            let html = '<div style="max-width: 360px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">🧘 Meditation${isHolySite ? ' (Holy Site)' : ''}</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Faith: ${faithStat} | Intelligence: ${intStat}</p>`;

            if (phase === 'meditating') {
                // Progress
                html += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Breath ${Math.min(currentBreath + 1, totalBreaths)} of ${totalBreaths}</div>`;

                // Focus score dots
                html += '<div style="display: flex; gap: 4px; justify-content: center; margin-bottom: 12px;">';
                for (let i = 0; i < totalBreaths; i++) {
                    let dotColor = 'rgba(255,255,255,0.1)';
                    if (i < currentBreath) {
                        // Check if this breath was scored
                        dotColor = i < focusScore + (currentBreath - focusScore) ? '#2ecc71' : '#e74c3c';
                    }
                    // Actually need to track per-breath results
                    html += `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${i === currentBreath ? 'var(--gold)' : dotColor};"></div>`;
                }
                html += '</div>';

                // Breathing circle
                const circleSize = 40 + breathSize * 1.2; // 40px to 160px
                const isNearPeak = breathSize > (100 - peakZone);
                const circleColor = isNearPeak ? 'rgba(46,204,113,0.3)' : 'rgba(52,152,219,0.15)';
                const borderColor = isNearPeak ? '#2ecc71' : '#3498db';

                html += `<div style="display: flex; align-items: center; justify-content: center; height: 180px;">
                    <div style="width: ${circleSize}px; height: ${circleSize}px; border-radius: 50%;
                        background: ${circleColor}; border: 3px solid ${borderColor};
                        display: flex; align-items: center; justify-content: center; transition: all 0.05s;
                        box-shadow: 0 0 ${breathSize * 0.4}px ${borderColor}40;">
                        <span style="font-size: ${20 + breathSize * 0.2}px;">${breathSize > 50 ? '🌕' : '🌑'}</span>
                    </div>
                </div>`;

                // Vertical indicator bar
                html += `<div style="position: relative; height: 16px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 8px; overflow: hidden;">
                    <div style="position: absolute; right: 0; width: ${peakZone}%; top: 0; bottom: 0; background: rgba(46,204,113,0.15); border-radius: 0 8px 8px 0;"></div>
                    <div style="position: absolute; left: ${breathSize}%; top: 2px; bottom: 2px; width: 4px; background: ${isNearPeak ? '#2ecc71' : '#3498db'}; border-radius: 2px; transition: left 0.05s;"></div>
                </div>`;

                // Distractions
                if (distractions.length > 0) {
                    const latest = distractions[distractions.length - 1];
                    html += `<div style="font-size: 12px; color: #e67e22; font-style: italic; margin-bottom: 4px; opacity: ${Math.max(0, 1 - latest.age * 0.03)};">${latest.text}</div>`;
                }

                if (lastClickResult) {
                    html += `<div style="font-size: 14px; margin-bottom: 6px;">${lastClickResult}</div>`;
                }

                html += `<button onclick="window._meditateBreath()"
                    style="padding: 14px 40px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                           border-radius: 50%; cursor: pointer; color: #3498db; font-size: 14px; font-weight: bold;
                           width: 80px; height: 80px; transition: all 0.15s;"
                    onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                    🧘<br><span style="font-size: 10px;">Exhale</span>
                </button>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Click when the circle is at its fullest. Breathe with the rhythm.</div>`;

            } else {
                // Results
                const scorePercent = focusScore / totalBreaths;
                const baseHeal = 10;
                const faithBonus = (faithStat - 3) * 2;
                const perfBonus = Math.floor(scorePercent * 15);
                const heal = Math.max(5, baseHeal + faithBonus + perfBonus + (isHolySite ? 15 : 0));
                player.health = Math.min(player.maxHealth || 100, player.health + heal);

                const karmaGain = (isHolySite ? 5 : 2) + (scorePercent >= 0.75 ? 2 : 0);
                player.karma = (player.karma || 0) + karmaGain;

                let bonusMsg = '';
                if (Math.random() < (isHolySite ? 0.35 : 0.1) + scorePercent * 0.1) {
                    player.faith = (player.faith || 5) + 1;
                    bonusMsg += ' 🙏 Your faith deepened.';
                }
                if (Math.random() < 0.1 + scorePercent * 0.08) {
                    player.intelligence = (player.intelligence || 5) + 1;
                    bonusMsg += ' 🧠 Your mind feels sharper.';
                }

                const grade = scorePercent >= 0.9 ? 'Perfect Serenity' : scorePercent >= 0.7 ? 'Deep Focus' : scorePercent >= 0.5 ? 'Calm Meditation' : scorePercent >= 0.3 ? 'Distracted Mind' : 'Restless Thoughts';
                const gradeColor = scorePercent >= 0.7 ? '#2ecc71' : scorePercent >= 0.4 ? '#f39c12' : '#e74c3c';

                html += `<div style="font-size: 48px; margin: 12px 0;">🧘</div>`;
                html += `<div style="font-size: 18px; color: ${gradeColor}; font-weight: bold; margin-bottom: 8px;">${grade}</div>`;
                html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Focused breaths: ${focusScore}/${totalBreaths}</div>`;

                html += `<div style="text-align: left; padding: 8px 12px; background: rgba(255,255,255,0.04); border-radius: 6px; margin-bottom: 8px;">`;
                html += `<div style="margin-bottom: 4px;">❤️ Healed: <span style="color: #2ecc71;">+${heal} HP</span></div>`;
                html += `<div style="margin-bottom: 4px;">☯️ Karma: <span style="color: #3498db;">+${karmaGain}</span></div>`;
                if (bonusMsg) html += `<div style="color: #f5c542;">${bonusMsg.trim()}</div>`;
                if (isHolySite) html += `<div style="color: #9b59b6; margin-top: 4px;">✨ Holy site amplified your meditation!</div>`;
                html += `</div>`;

                html += `<button onclick="game.ui.hideCustomPanel(); game.endDay();"
                    style="width: 100%; margin-top: 8px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🧘 Meditation', html);
        };

        // Track per-breath results
        const breathResults = [];

        // Animation loop
        medTimer = setInterval(() => {
            if (phase !== 'meditating') { clearInterval(medTimer); return; }

            breathPhase += breathSpeed;
            breathSize = Math.abs(Math.sin(breathPhase)) * 100;

            // Spawn distractions occasionally
            distractionTimer++;
            if (distractionTimer > 40 && Math.random() < 0.04 && !isHolySite) {
                distractions.push({
                    text: distractionTexts[Math.floor(Math.random() * distractionTexts.length)],
                    age: 0
                });
                // Distractions slightly speed up breathing
                breathSpeed = Math.min(0.07, breathSpeed + 0.003);
            }
            for (const d of distractions) d.age++;

            render();
        }, 50);

        // Keyboard support
        const keyHandler = (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                window._meditateBreath();
            }
        };
        document.addEventListener('keydown', keyHandler);

        window._meditateBreath = () => {
            if (phase !== 'meditating' || !canClick) return;

            canClick = false;
            setTimeout(() => { canClick = true; }, 300); // debounce

            const isNearPeak = breathSize > (100 - peakZone);

            if (isNearPeak) {
                focusScore++;
                breathResults.push(true);
                lastClickResult = `<span style="color: #2ecc71;">✨ Perfect breath!</span>`;
            } else if (breathSize > (100 - peakZone * 2)) {
                // Close but not perfect — partial credit
                focusScore += 0.5;
                breathResults.push(true);
                lastClickResult = `<span style="color: #f39c12;">~ Close enough</span>`;
            } else {
                breathResults.push(false);
                lastClickResult = `<span style="color: #e74c3c;">✗ Out of rhythm</span>`;
            }

            currentBreath++;
            if (currentBreath >= totalBreaths) {
                phase = 'result';
                focusScore = Math.round(focusScore);
                clearInterval(medTimer);
                document.removeEventListener('keydown', keyHandler);
            }

            render();
        };

        render();
    },

    /**
     * Fish at a water-adjacent tile — yields food items
     */
    doFish(game, tile) {
        const player = game.player;
        const luckStat = player.luck || 5;
        const intStat = player.intelligence || 5;
        const strStat = player.strength || 5;
        const skillBonus = 1 + luckStat * 0.05 + intStat * 0.03;

        // Determine fishing spot quality
        const nearbyTiles = Hex.neighbors(tile.q, tile.r).map(n => game.world.getTile(n.q, n.r)).filter(Boolean);
        const deepWater = nearbyTiles.some(t => ['ocean', 'deep_ocean', 'sea'].includes(t.terrain.id));
        const isCoast = ['coast', 'beach'].includes(tile.terrain.id);

        const depths = [];
        depths.push({ id: 'shallow', label: '🏖️ Shallows', desc: 'Easy catches, smaller fish', color: '#1abc9c' });
        if (isCoast || deepWater) depths.push({ id: 'mid', label: '🌊 Mid Waters', desc: 'Moderate fish, decent value', color: '#3498db' });
        if (deepWater) depths.push({ id: 'deep', label: '🌀 Deep Waters', desc: 'Rare fish, bigger fight', color: '#2c3e50' });

        // Fish table by depth
        const fishByDepth = {
            shallow: [
                { name: 'fish', label: 'Common Fish', icon: '🐟', value: 5, rarity: 'common', color: '#aaa', fight: 2 },
                { name: 'small_fish', label: 'Small Fry', icon: '🐠', value: 2, rarity: 'common', color: '#aaa', fight: 1 },
                { name: 'seaweed', label: 'Seaweed', icon: '🌿', value: 1, rarity: 'junk', color: '#666', fight: 0 },
                { name: 'boot', label: 'Old Boot', icon: '👢', value: 0, rarity: 'junk', color: '#666', fight: 0 },
                { name: 'golden_fish', label: 'Golden Fish', icon: '✨🐟', value: 50, rarity: 'legendary', color: '#f5c542', fight: 5 },
            ],
            mid: [
                { name: 'fish', label: 'Common Fish', icon: '🐟', value: 5, rarity: 'common', color: '#aaa', fight: 2 },
                { name: 'large_fish', label: 'Large Cod', icon: '🐟', value: 8, rarity: 'uncommon', color: '#3498db', fight: 3 },
                { name: 'crab', label: 'Crab', icon: '🦀', value: 12, rarity: 'uncommon', color: '#3498db', fight: 3 },
                { name: 'seaweed', label: 'Seaweed', icon: '🌿', value: 1, rarity: 'junk', color: '#666', fight: 0 },
                { name: 'golden_fish', label: 'Golden Fish', icon: '✨🐟', value: 50, rarity: 'legendary', color: '#f5c542', fight: 6 },
            ],
            deep: [
                { name: 'large_fish', label: 'Large Cod', icon: '🐟', value: 8, rarity: 'uncommon', color: '#3498db', fight: 3 },
                { name: 'crab', label: 'Crab', icon: '🦀', value: 12, rarity: 'uncommon', color: '#3498db', fight: 3 },
                { name: 'swordfish', label: 'Swordfish', icon: '🗡️🐟', value: 25, rarity: 'rare', color: '#9b59b6', fight: 6 },
                { name: 'lobster', label: 'Lobster', icon: '🦞', value: 20, rarity: 'rare', color: '#9b59b6', fight: 5 },
                { name: 'golden_fish', label: 'Golden Fish', icon: '✨🐟', value: 50, rarity: 'legendary', color: '#f5c542', fight: 8 },
            ],
        };

        // Weights by rarity (luck boosts rare/legendary)
        const rarityWeights = {
            junk: 15,
            common: 40,
            uncommon: 25,
            rare: 10 + luckStat * 0.5,
            legendary: 2 + luckStat * 0.4,
        };

        const rollFish = (depth) => {
            const table = fishByDepth[depth] || fishByDepth.shallow;
            const weighted = table.map(f => ({ ...f, w: rarityWeights[f.rarity] || 10 }));
            const total = weighted.reduce((s, f) => s + f.w, 0);
            let r = Math.random() * total;
            for (const f of weighted) {
                r -= f.w;
                if (r <= 0) return { ...f };
            }
            return { ...weighted[0] };
        };

        // ── Game State ──
        let phase = 'depth';    // depth → cast → wait → strike → reel → caught → result
        let chosenDepth = null;
        let castCount = 0;
        const maxCasts = 3 + Math.floor(Math.random() * 2);
        const catches = [];
        let waitTimer = null;
        let biteWindowTimer = null;
        let currentFish = null;

        // Reel mini-game state
        let tension = 50;           // 0-100; ideal is 30-70
        let reelProgress = 0;       // 0-100; reach 100 to land fish
        let fishFightDir = 1;       // fish pulls tension up or down
        let reelInterval = null;
        let reelActionTimeout = null;
        let reeling = false;

        const cleanup = () => {
            if (waitTimer) clearTimeout(waitTimer);
            if (biteWindowTimer) clearTimeout(biteWindowTimer);
            if (reelInterval) clearInterval(reelInterval);
            if (reelActionTimeout) clearTimeout(reelActionTimeout);
        };

        // ── Render ──
        const render = (statusMsg = '') => {
            let html = '<div style="max-width: 500px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">🎣 Fishing</h4>';

            if (phase === 'depth') {
                html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">Choose where to cast your line.</p>';
                for (const d of depths) {
                    html += `<button onclick="window._fishPickDepth('${d.id}')"
                        style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 8px;
                               background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid ${d.color};
                               border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                        <span style="font-size: 24px;">${d.label.split(' ')[0]}</span>
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 13px;">${d.label}</div>
                            <div style="font-size: 11px; color: var(--text-secondary);">${d.desc}</div>
                        </div>
                        <div style="font-size: 12px; color: ${d.color}; font-weight: 600;">▶</div>
                    </button>`;
                }
                html += `<button onclick="game.ui.hideCustomPanel();"
                    style="margin-top: 6px; padding: 8px 20px; background: none; border: 1px solid rgba(255,255,255,0.1);
                           border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">Cancel</button>`;
                html += '</div>';
                return html;
            }

            // Header info
            const depthInfo = depths.find(d => d.id === chosenDepth) || depths[0];
            html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 12px; color: var(--text-secondary);">📍 <span style="color: ${depthInfo.color};">${depthInfo.label}</span></span>
                        <span style="font-size: 12px; color: var(--text-secondary);">Cast ${castCount}/${maxCasts}</span>
                     </div>`;

            // ── Water scene ──
            const waterBg = chosenDepth === 'deep' ? '#0a1628, #0d1e35, #102a47'
                          : chosenDepth === 'mid' ? '#0d2137, #1a4a6b, #1e5577'
                          : '#143a52, #1e5577, #2d7da0';
            html += `<div style="position: relative; height: 150px; background: linear-gradient(180deg, ${waterBg}); border-radius: 10px; overflow: hidden; margin-bottom: 12px; border: 1px solid rgba(100,180,255,0.15);">`;

            // Wave effect
            html += `<div style="position: absolute; top: 0; left: 0; right: 0; height: 20px; background: linear-gradient(180deg, rgba(255,255,255,0.05), transparent);"></div>`;

            if (phase === 'wait') {
                // Bobber on water
                html += `<style>@keyframes fishBob { 0% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, 6px); } 100% { transform: translate(-50%, 0); } }</style>`;
                html += `<div style="position: absolute; top: 30px; left: 50%; font-size: 14px; animation: fishBob 2.5s ease-in-out infinite;">🎣</div>`;
                html += `<div style="position: absolute; top: 8px; left: 50%; width: 1px; height: 24px; background: rgba(255,255,255,0.2); transform: translateX(-50%);"></div>`;
                // Random bubbles
                const bubbles = Math.floor(Math.random() * 4);
                for (let i = 0; i < bubbles; i++) {
                    const bx = 20 + Math.random() * 60;
                    const by = 50 + Math.random() * 40;
                    html += `<div style="position: absolute; left: ${bx}%; top: ${by}%; font-size: 8px; opacity: 0.3;">○</div>`;
                }
            }

            if (phase === 'strike') {
                html += `<style>@keyframes fishBite { 0% { transform: translate(-50%, 0) rotate(-5deg); } 50% { transform: translate(-50%, 12px) rotate(5deg); } 100% { transform: translate(-50%, 0) rotate(-5deg); } }</style>`;
                html += `<div style="position: absolute; top: 25px; left: 50%; font-size: 18px; animation: fishBite 0.2s ease-in-out infinite;">🎣</div>`;
                html += `<div style="position: absolute; top: 10px; left: 50%; width: 2px; height: 18px; background: #f5c542; transform: translateX(-50%);"></div>`;
                // Splash effect
                html += `<div style="position: absolute; top: 40px; left: 42%; font-size: 10px; opacity: 0.6;">💦</div>`;
                html += `<div style="position: absolute; top: 38px; left: 55%; font-size: 8px; opacity: 0.5;">💦</div>`;
            }

            if (phase === 'reel') {
                // Show fish icon fighting
                const fishY = 60 + (1 - reelProgress / 100) * 60;
                const fishShake = Math.random() > 0.5 ? 'rotate(5deg)' : 'rotate(-5deg)';
                html += `<div style="position: absolute; top: 8px; left: 50%; width: 2px; height: ${fishY - 5}px; background: ${tension > 80 ? '#e74c3c' : tension > 60 ? '#f39c12' : '#2ecc71'}; transform: translateX(-50%); transition: height 0.2s;"></div>`;
                html += `<div style="position: absolute; top: ${fishY}px; left: 50%; transform: translate(-50%, 0) ${fishShake}; font-size: 22px; transition: top 0.3s;">${currentFish.icon}</div>`;
                // Surface indicator
                html += `<div style="position: absolute; top: 55px; left: 20%; right: 20%; height: 1px; background: rgba(255,255,255,0.1);"></div>`;
                html += `<div style="position: absolute; top: 48px; left: 20%; font-size: 9px; color: rgba(255,255,255,0.3);">surface ↑</div>`;
            }

            if (phase === 'caught') {
                html += `<div style="position: absolute; top: 30px; left: 50%; transform: translate(-50%, 0); font-size: 36px;">${currentFish.icon}</div>`;
                html += `<div style="position: absolute; top: 75px; left: 50%; transform: translateX(-50%); font-size: 10px; color: rgba(255,255,255,0.4);">💦 💦 💦</div>`;
            }

            if (phase === 'cast' || phase === 'result') {
                html += `<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 28px; opacity: 0.3;">🌊</div>`;
            }

            html += '</div>'; // end water scene

            // Status
            if (statusMsg) {
                html += `<div style="margin-bottom: 10px; font-size: 13px; min-height: 22px;">${statusMsg}</div>`;
            }

            // ── Phase UI ──
            if (phase === 'cast') {
                if (castCount >= maxCasts) {
                    phase = 'result';
                    return render('');
                }
                html += `<button onclick="window._fishCast()"
                    style="padding: 12px 40px; background: linear-gradient(135deg, ${depthInfo.color}, ${depthInfo.color}cc); color: white; border: none; border-radius: 8px; cursor: pointer;
                           font-family: var(--font-display); font-size: 15px; letter-spacing: 1px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); transition: all 0.15s;"
                    onmouseenter="this.style.transform='scale(1.05)'" onmouseleave="this.style.transform='scale(1)'">
                    🎣 Cast Line
                </button>`;

            } else if (phase === 'wait') {
                html += `<div style="font-size: 13px; color: var(--text-secondary);">
                    <span style="display: inline-block; animation: fishBob 1.5s ease-in-out infinite;">Waiting for a bite...</span>
                </div>`;

            } else if (phase === 'strike') {
                html += `<button onclick="window._fishStrike()"
                    style="padding: 16px 56px; background: linear-gradient(135deg, #f39c12, #e67e22); color: white; border: none; border-radius: 10px; cursor: pointer;
                           font-family: var(--font-display); font-size: 18px; letter-spacing: 1px; box-shadow: 0 0 25px rgba(243,156,18,0.5);
                           animation: fishBite 0.2s ease-in-out infinite;">
                    ⚡ STRIKE!
                </button>`;

            } else if (phase === 'reel') {
                // ── Tension meter ──
                const tensionColor = tension > 85 ? '#e74c3c' : tension > 70 ? '#f39c12' : tension < 15 ? '#3498db' : tension < 30 ? '#2ecc71' : '#2ecc71';
                const tensionLabel = tension > 85 ? '🔥 SNAP DANGER!' : tension > 70 ? '⚠️ High tension' : tension < 15 ? '⚠️ Too loose!' : tension < 30 ? '🎯 Careful...' : '✅ Good';
                const tensionLabelColor = tension > 85 ? '#e74c3c' : tension > 70 ? '#f39c12' : tension < 15 ? '#3498db' : '#2ecc71';

                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Line Tension</span>
                        <span style="color: ${tensionLabelColor}; font-weight: 600;">${tensionLabel}</span>
                    </div>
                    <div style="position: relative; height: 20px; background: rgba(255,255,255,0.06); border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <!-- Safe zone markers -->
                        <div style="position: absolute; left: 30%; width: 40%; height: 100%; background: rgba(46,204,113,0.12); border-left: 1px dashed rgba(46,204,113,0.3); border-right: 1px dashed rgba(46,204,113,0.3);"></div>
                        <!-- Danger zones -->
                        <div style="position: absolute; left: 0; width: 15%; height: 100%; background: rgba(52,152,219,0.1);"></div>
                        <div style="position: absolute; right: 0; width: 15%; height: 100%; background: rgba(231,76,60,0.1);"></div>
                        <!-- Tension marker -->
                        <div style="position: absolute; left: ${tension}%; top: 2px; bottom: 2px; width: 6px; background: ${tensionColor}; border-radius: 3px; transform: translateX(-50%); box-shadow: 0 0 8px ${tensionColor}; transition: left 0.15s;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); margin-top: 2px;">
                        <span>Too loose</span>
                        <span style="color: rgba(46,204,113,0.6);">Sweet spot</span>
                        <span>Line breaks!</span>
                    </div>
                </div>`;

                // ── Progress bar ──
                const progColor = reelProgress > 70 ? '#2ecc71' : reelProgress > 40 ? '#f39c12' : '#3498db';
                html += `<div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Reel Progress</span>
                        <span style="color: ${progColor};">${Math.round(reelProgress)}%</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${reelProgress}%; height: 100%; background: ${progColor}; transition: width 0.2s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                // ── Reel / Slack buttons ──
                html += `<div style="display: flex; gap: 10px; justify-content: center;">
                    <button onmousedown="window._fishSlack()" ontouchstart="window._fishSlack()"
                        style="padding: 12px 24px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: #3498db; font-size: 14px; font-weight: bold; transition: all 0.1s; user-select: none;"
                        onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        🔽 Give Slack
                    </button>
                    <button onmousedown="window._fishReelIn()" ontouchstart="window._fishReelIn()"
                        style="padding: 12px 28px; background: rgba(46,204,113,0.15); border: 2px solid #2ecc71;
                               border-radius: 8px; cursor: pointer; color: #2ecc71; font-size: 14px; font-weight: bold; transition: all 0.1s; user-select: none;"
                        onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                        🔼 Reel In!
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Reel to land the fish — but keep tension in the green zone!</div>`;

            } else if (phase === 'caught') {
                const rarityGlow = currentFish.rarity === 'legendary' ? 'text-shadow: 0 0 15px #f5c542;' : currentFish.rarity === 'rare' ? 'text-shadow: 0 0 10px #9b59b6;' : '';
                html += `<div style="font-size: 16px; color: ${currentFish.color}; font-weight: bold; ${rarityGlow} margin-bottom: 4px;">🎉 Caught: ${currentFish.icon} ${currentFish.label}!</div>`;
                html += `<div style="font-size: 13px; color: var(--text-secondary);">${currentFish.rarity === 'legendary' ? '★ Legendary catch!' : currentFish.rarity === 'rare' ? '◆ Rare find!' : currentFish.rarity === 'junk' ? 'Well... it\'s something.' : 'A decent catch.'}</div>`;
                html += `<div style="font-size: 12px; color: var(--gold); margin-top: 4px;">${currentFish.value > 0 ? `Worth ~${currentFish.value}g` : 'Worthless'}</div>`;

            } else if (phase === 'result') {
                html += ActionMenu._renderFishingResults(catches, player);
            }

            // Catch tally
            if (catches.length > 0 && phase !== 'result') {
                html += `<div style="margin-top: 14px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Today's catch:</div>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;">`;
                for (const c of catches) {
                    html += `<span style="font-size: 11px; padding: 2px 8px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 2px solid ${c.color};">${c.icon} ${c.label}</span>`;
                }
                html += '</div></div>';
            }

            html += '</div>';
            return html;
        };

        game.ui.showCustomPanel('🎣 Fishing', render());

        // ── Depth selection ──
        window._fishPickDepth = (depthId) => {
            chosenDepth = depthId;

            ActionMenu._showMinigamePrompt(game, {
                title: '🎣 Fishing',
                icon: '🎣',
                description: `Cast your line into the ${depthId === 'deep' ? 'deep waters' : depthId === 'mid' ? 'mid waters' : 'shallows'}.`,
                baseRewardText: '1-2 basic catches',
                onSkip: () => {
                    // Base reward: 1-2 simple fish rolls
                    const catches = 1 + (Math.random() < 0.4 ? 1 : 0);
                    let totalVal = 0;
                    let msg = 'Quick fishing trip — ';
                    const items = [];
                    for (let i = 0; i < catches; i++) {
                        const fish = rollFish(depthId);
                        if (fish && fish.name && fish.value > 0) {
                            player.inventory = player.inventory || {};
                            player.inventory[fish.name] = (player.inventory[fish.name] || 0) + 1;
                            totalVal += fish.value;
                            items.push(`${fish.icon} ${fish.label}`);
                        }
                    }
                    if (items.length > 0) {
                        msg += `caught ${items.join(', ')} (~${totalVal}g).`;
                    } else {
                        msg += 'nothing biting today.';
                    }
                    if (Math.random() < 0.08) {
                        player.luck = (player.luck || 5) + 1;
                        msg += ' 🍀 Luck increased!';
                    }
                    game.ui.showNotification('🎣 Fishing', msg, items.length > 0 ? 'success' : 'default');
                    game.ui.updateStats(player, game.world);
                    game.endDay();
                },
                onPlay: () => {
                    phase = 'cast';
                    game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: var(--text-muted);">Ready to cast!</span>'));
                }
            });
        };

        // ── Cast ──
        window._fishCast = () => {
            if (castCount >= maxCasts) return;
            castCount++;
            phase = 'wait';
            game.ui.showCustomPanel('🎣 Fishing', render(''));

            // Wait for bite: 1.5-4 seconds
            const waitTime = 1500 + Math.random() * 2500;
            waitTimer = setTimeout(() => {
                // Bite chance
                const biteChance = 0.65 + luckStat * 0.03;
                if (Math.random() > biteChance) {
                    phase = 'cast';
                    game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: var(--text-muted);">Nothing biting... the waters are quiet.</span>'));
                    return;
                }

                phase = 'strike';
                currentFish = rollFish(chosenDepth);
                game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: #f5c542; font-weight: bold;">🔔 Something\'s on the line!</span>'));

                // Strike window — 1.8 seconds (luck extends slightly)
                const strikeWindow = 1400 + luckStat * 50;
                biteWindowTimer = setTimeout(() => {
                    if (phase === 'strike') {
                        phase = 'cast';
                        currentFish = null;
                        game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: #e74c3c;">❌ Too slow! The fish got away.</span>'));
                    }
                }, strikeWindow);
            }, waitTime);
        };

        // ── Strike ──
        window._fishStrike = () => {
            if (phase !== 'strike') return;
            clearTimeout(biteWindowTimer);

            // Junk goes straight to caught
            if (currentFish.rarity === 'junk') {
                catches.push(currentFish);
                phase = 'caught';
                game.ui.showCustomPanel('🎣 Fishing', render(''));
                setTimeout(() => {
                    phase = 'cast';
                    currentFish = null;
                    game.ui.showCustomPanel('🎣 Fishing', render(''));
                }, 1500);
                return;
            }

            // Start reel phase
            phase = 'reel';
            tension = 50;
            reelProgress = 0;
            reeling = false;

            const fishFight = currentFish.fight || 3;

            game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: #2ecc71;">🎣 Hooked! Reel it in — manage your line tension!</span>'));

            // Fish AI: fights by changing tension + pulling back progress
            reelInterval = setInterval(() => {
                if (phase !== 'reel') { clearInterval(reelInterval); return; }

                // Fish erratically fights: pushes tension around
                if (Math.random() < 0.6) {
                    fishFightDir = Math.random() < 0.5 ? 1 : -1;
                }
                const fightStrength = fishFight * (0.5 + Math.random() * 0.8);
                tension += fishFightDir * fightStrength;

                // Fish pulls back progress slightly
                const pullBack = fishFight * 0.3 * Math.random();
                reelProgress = Math.max(0, reelProgress - pullBack);

                // Natural tension drift toward center
                tension += (50 - tension) * 0.02;

                tension = Math.max(0, Math.min(100, tension));

                // ── Check fail conditions ──
                if (tension >= 95) {
                    // Line snaps!
                    clearInterval(reelInterval);
                    phase = 'cast';
                    const msg = `<span style="color: #e74c3c;">💥 The line snapped! The ${currentFish.label} got away!</span>`;
                    currentFish = null;
                    game.ui.showCustomPanel('🎣 Fishing', render(msg));
                    return;
                }
                if (tension <= 5 && reelProgress < 30) {
                    // Line too loose — fish spits the hook
                    clearInterval(reelInterval);
                    phase = 'cast';
                    const msg = `<span style="color: #3498db;">💨 Too much slack! The ${currentFish.label} spit the hook!</span>`;
                    currentFish = null;
                    game.ui.showCustomPanel('🎣 Fishing', render(msg));
                    return;
                }

                // ── Check win ──
                if (reelProgress >= 100) {
                    clearInterval(reelInterval);
                    catches.push(currentFish);
                    phase = 'caught';
                    game.ui.showCustomPanel('🎣 Fishing', render(''));
                    setTimeout(() => {
                        phase = 'cast';
                        currentFish = null;
                        game.ui.showCustomPanel('🎣 Fishing', render(''));
                    }, 1800);
                    return;
                }

                game.ui.showCustomPanel('🎣 Fishing', render(''));
            }, 350);
        };

        // ── Check win/fail inline (called after player input) ──
        const checkReelResult = () => {
            if (phase !== 'reel') return;
            if (reelProgress >= 100) {
                clearInterval(reelInterval);
                catches.push(currentFish);
                phase = 'caught';
                game.ui.showCustomPanel('🎣 Fishing', render(''));
                setTimeout(() => {
                    phase = 'cast';
                    currentFish = null;
                    game.ui.showCustomPanel('🎣 Fishing', render(''));
                }, 1800);
            }
        };

        // ── Reel In ──
        window._fishReelIn = () => {
            if (phase !== 'reel') return;
            // Reeling adds progress but increases tension
            const strBonus = 1 + strStat * 0.08;
            reelProgress = Math.min(100, reelProgress + 3.5 * strBonus);
            tension = Math.min(100, tension + 6 + (currentFish.fight || 3) * 0.8);
            checkReelResult();
        };

        // ── Give Slack ──
        window._fishSlack = () => {
            if (phase !== 'reel') return;
            // Reduces tension but fish pulls back progress
            tension = Math.max(0, tension - 12);
            reelProgress = Math.max(0, reelProgress - 2);
        };
    },

    /**
     * Render final fishing results and add to inventory
     */
    _renderFishingResults(catches, player) {
        let html = '<div style="text-align: left; padding: 8px;">';
        html += '<h4 style="margin: 0 0 12px; text-align: center;">🎣 Day\'s Catch</h4>';

        if (catches.length === 0) {
            html += '<p style="color: var(--text-muted); text-align: center;">Nothing caught today. The fish outsmarted you!</p>';
        } else {
            // Consolidate
            const totals = {};
            for (const c of catches) {
                if (!totals[c.name]) totals[c.name] = { ...c, qty: 0 };
                totals[c.name].qty++;
            }

            let totalValue = 0;
            for (const [key, item] of Object.entries(totals)) {
                player.inventory = player.inventory || {};
                player.inventory[key] = (player.inventory[key] || 0) + item.qty;
                totalValue += item.value * item.qty;
                const rarityLabel = item.rarity === 'legendary' ? ' ★' : item.rarity === 'rare' ? ' ◆' : '';
                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.03); border-radius: 4px; border-left: 3px solid ${item.color};">
                            <span>${item.icon} ${item.label}${rarityLabel} <span style="color: var(--text-muted);">×${item.qty}</span></span>
                            <span style="color: var(--gold); font-weight: bold;">${item.value > 0 ? `${item.value * item.qty}g` : '—'}</span>
                         </div>`;
            }

            html += `<div style="text-align: center; margin-top: 12px; padding: 8px; background: rgba(245,197,66,0.08); border-radius: 6px; border: 1px solid rgba(245,197,66,0.15);">
                        <span style="color: var(--gold); font-size: 14px; font-weight: bold;">Total value: ${totalValue} gold</span>
                     </div>`;
        }

        // Luck chance
        if (Math.random() < 0.08) {
            player.luck = (player.luck || 5) + 1;
            html += '<div style="color: #88f; margin-top: 8px; text-align: center; font-size: 12px;">🍀 Your patience improved your luck!</div>';
        }

        html += `<button onclick="game.ui.hideCustomPanel(); game.endDay();"
                    style="width: 100%; margin-top: 14px; padding: 12px; background: linear-gradient(135deg, var(--gold), #d4a030); color: #1a1a2e; border: none; border-radius: 6px; cursor: pointer;
                           font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;">
                    Done Fishing
                 </button>`;
        html += '</div>';
        return html;
    },

    /**
     * Prospect for minerals on hills/highlands/mountain tiles
     */
    doProspect(game, tile) {
        const player = game.player;
        const terrainId = tile.terrain?.id || '';
        const strengthStat = player.strength || 5;
        const luckStat = player.luck || 5;

        const difficultyMod = {
            hills: 1.0, highlands: 1.2, mountain: 1.5, volcanic_mountain: 1.8
        }[terrainId] || 1.0;

        ActionMenu._showMinigamePrompt(game, {
            title: '⛏️ Prospecting',
            icon: '⛏️',
            description: 'Drill into the earth to find valuable minerals.',
            baseRewardText: '1 basic mineral (stone or ore)',
            onSkip: () => {
                // Base reward: 1 basic mineral
                const roll = Math.random();
                let type, label, icon, value;
                if (roll < 0.55) { type = 'stone'; label = 'Stone'; icon = '⛰️'; value = 8; }
                else if (roll < 0.85) { type = 'ore'; label = 'Iron Ore'; icon = '⛏️'; value = 25; }
                else if (roll < 0.95) { type = 'fossil'; label = 'Fossil'; icon = '🦴'; value = 35; }
                else { type = 'crystal'; label = 'Crystal'; icon = '🔮'; value = 50; }
                player.inventory = player.inventory || {};
                player.inventory[type] = (player.inventory[type] || 0) + 1;
                const hpCost = 2;
                player.health = Math.max(1, player.health - hpCost);
                if (Math.random() < 0.12) { player.strength = (player.strength || 5) + 1; }
                game.ui.showNotification('⛏️ Prospecting', `Quick dig — found ${icon} ${label} (~${value}g). -${hpCost} HP.`, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doProspectMinigame(game, tile, player, terrainId, strengthStat, luckStat, difficultyMod); }
        });
    },

    _doProspectMinigame(game, tile, player, terrainId, strengthStat, luckStat, difficultyMod) {
        // ── Prospecting Minigame: Depth Drilling with vein scanner ──
        const maxDepth = 8;
        let currentDepth = 0;
        let drillHP = 100; // drill durability
        let stamina = 100; // player stamina for drilling
        let finds = [];
        let totalValue = 0;
        let phase = 'drilling'; // drilling → result
        let statusMsg = '';
        let healthCost = 0;
        let scanResult = '';
        let scansLeft = 2 + Math.floor(luckStat / 3);

        const itemData = {
            gems:    { label: 'Gemstones', icon: '💎', value: 80 },
            ore:     { label: 'Iron Ore',  icon: '⛏️', value: 25 },
            stone:   { label: 'Stone',     icon: '⛰️', value: 8 },
            fossil:  { label: 'Fossil',    icon: '🦴', value: 35 },
            crystal: { label: 'Crystal',   icon: '🔮', value: 50 },
        };

        // Generate what's at each depth
        const layers = [];
        for (let d = 0; d < maxDepth; d++) {
            const depthBonus = d * 0.06 * (luckStat / 5);
            const roll = Math.random();
            let type = 'rock';
            if (roll < 0.03 + depthBonus * 0.5) type = 'gems';
            else if (roll < 0.10 + depthBonus * 1.5) type = 'crystal';
            else if (roll < 0.22 + depthBonus * 2) type = 'ore';
            else if (roll < 0.35 + depthBonus) type = 'fossil';
            else if (roll < 0.55 + depthBonus) type = 'stone';
            // Add hazards at deeper levels
            const hasHazard = d >= 3 && Math.random() < 0.2 + d * 0.05;
            layers.push({ type, hasHazard, extracted: false });
        }

        const getLayerColor = (type) => {
            switch(type) {
                case 'gems': return '#9b59b6';
                case 'crystal': return '#8e44ad';
                case 'ore': return '#3498db';
                case 'fossil': return '#f39c12';
                case 'stone': return '#95a5a6';
                default: return '#8b6914';
            }
        };

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">⛏️ Prospecting</h4>';
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Terrain: ${terrainId} (x${difficultyMod}) | Str: ${strengthStat} | Luck: ${luckStat}</p>`;

            if (phase === 'drilling') {
                // Status bars
                html += `<div style="display: flex; gap: 12px; margin-bottom: 10px;">
                    <div style="flex: 1;">
                        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px;">⛏️ Drill HP</div>
                        <div style="background: rgba(255,255,255,0.06); border-radius: 4px; height: 10px; overflow: hidden;">
                            <div style="width: ${drillHP}%; height: 100%; background: ${drillHP > 30 ? '#3498db' : '#e74c3c'}; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px;">💪 Stamina</div>
                        <div style="background: rgba(255,255,255,0.06); border-radius: 4px; height: 10px; overflow: hidden;">
                            <div style="width: ${stamina}%; height: 100%; background: ${stamina > 30 ? '#2ecc71' : '#e74c3c'}; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                    </div>
                </div>`;

                html += `<div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 8px;">
                    <span>💰 Found: <span style="color: var(--gold);">${totalValue}g</span></span>
                    <span>🔍 Scans: ${scansLeft}</span>
                </div>`;

                // Depth column — vertical drill shaft
                html += '<div style="display: flex; gap: 6px; align-items: stretch;">';

                // Depth labels
                html += '<div style="display: flex; flex-direction: column; gap: 2px; margin-right: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    html += `<div style="height: 42px; display: flex; align-items: center; font-size: 9px; color: var(--text-muted);">
                        ${d + 1}m
                    </div>`;
                }
                html += '</div>';

                // Shaft
                html += '<div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    const layer = layers[d];
                    const isCurrent = d === currentDepth;
                    const isPast = d < currentDepth;
                    const darkness = 0.06 + d * 0.03;

                    if (isPast) {
                        // Already drilled through
                        const col = layer.extracted ? 'rgba(46,204,113,0.1)' : 'rgba(255,255,255,0.02)';
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: ${col}; border: 1px solid rgba(255,255,255,0.04); font-size: 12px; color: var(--text-muted);">
                            ${layer.extracted ? (itemData[layer.type]?.icon || '✓') : '▪️'} ${layer.extracted ? itemData[layer.type]?.label || '' : 'empty'}
                        </div>`;
                    } else if (isCurrent) {
                        // Current depth — drill head
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: rgba(243,156,18,0.15); border: 2px solid var(--gold); font-size: 18px;
                            box-shadow: 0 0 12px rgba(243,156,18,0.2);">
                            ⛏️ <span style="font-size: 11px; margin-left: 6px; color: var(--gold);">DRILL HERE</span>
                        </div>`;
                    } else {
                        // Future depth — hidden
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: rgba(139,90,43,${darkness}); border: 1px solid rgba(255,255,255,0.04); font-size: 14px; color: rgba(255,255,255,0.15);">
                            ???
                        </div>`;
                    }
                }
                html += '</div>';

                // Scan results sidebar
                html += '<div style="width: 80px; display: flex; flex-direction: column; gap: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    const layer = layers[d];
                    if (layer.scanned) {
                        const col = getLayerColor(layer.type);
                        html += `<div style="height: 42px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                            background: rgba(${col === '#9b59b6' ? '155,89,182' : col === '#3498db' ? '52,152,219' : col === '#f39c12' ? '243,156,18' : col === '#95a5a6' ? '149,165,166' : '142,68,173'},0.15);
                            border: 1px solid ${col}40; font-size: 9px; color: ${col};">
                            ${layer.hasHazard ? '⚠️' : ''} ${itemData[layer.type]?.icon || '⛰️'}
                        </div>`;
                    } else {
                        html += `<div style="height: 42px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                            background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); font-size: 9px; color: var(--text-muted);">
                            ?
                        </div>`;
                    }
                }
                html += '</div>';

                html += '</div>';

                if (statusMsg) html += `<div style="margin-top: 8px; font-size: 12px;">${statusMsg}</div>`;
                if (scanResult) html += `<div style="margin-top: 4px; font-size: 11px; color: var(--text-muted);">${scanResult}</div>`;

                // Action buttons
                html += `<div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px;">
                    <button onclick="window._prospectDrill()"
                        style="padding: 10px 24px; background: rgba(243,156,18,0.15); border: 2px solid var(--gold);
                               border-radius: 8px; cursor: pointer; color: var(--gold); font-size: 13px; font-weight: bold; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(243,156,18,0.25)'" onmouseleave="this.style.background='rgba(243,156,18,0.15)'">
                        ⛏️ Drill Down
                    </button>
                    <button onclick="window._prospectScan()" ${scansLeft <= 0 ? 'disabled' : ''}
                        style="padding: 10px 20px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: #3498db; font-size: 13px; font-weight: bold; transition: all 0.15s;
                               ${scansLeft <= 0 ? 'opacity: 0.4; cursor: default;' : ''}"
                        onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        🔍 Scan (${scansLeft})
                    </button>
                    <button onclick="window._prospectStop()"
                        style="padding: 10px 16px; background: none; border: 1px solid rgba(255,255,255,0.1);
                               border-radius: 8px; cursor: pointer; color: var(--text-muted); font-size: 12px;">
                        Stop
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Drill deeper for rare minerals! Scan to see what's ahead.</div>`;

            } else {
                // Results
                html += `<div style="font-size: 48px; margin: 8px 0;">⛏️</div>`;
                if (finds.length > 0) {
                    html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Prospecting Haul</div>`;
                    const totals = {};
                    for (const f of finds) {
                        if (!totals[f.type]) totals[f.type] = { ...itemData[f.type], qty: 0 };
                        totals[f.type].qty++;
                    }
                    for (const [key, item] of Object.entries(totals)) {
                        player.inventory = player.inventory || {};
                        player.inventory[key] = (player.inventory[key] || 0) + item.qty;
                        html += `<div style="padding: 6px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between;">
                            <div>${item.icon} ${item.label} x${item.qty}</div>
                            <div style="color: var(--gold);">${item.value * item.qty}g</div>
                        </div>`;
                    }
                    html += `<div style="margin-top: 8px; padding: 8px; background: rgba(245,197,66,0.1); border-radius: 4px; font-weight: bold; color: var(--gold);">Total Value: ~${totalValue} gold</div>`;
                } else {
                    html += `<div style="font-size: 16px; color: #f39c12; margin-bottom: 8px;">Slim Pickings</div>`;
                    html += `<div style="color: var(--text-secondary);">Nothing valuable found.</div>`;
                }
                html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Reached depth: ${currentDepth}m</div>`;
                if (healthCost > 0) html += `<div style="color: #f88; margin-top: 4px;">Hard work cost ${healthCost} HP.</div>`;
                if (statusMsg) html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${statusMsg}</div>`;
                html += `<button onclick="game.ui.hideCustomPanel(); game.endDay();"
                    style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('⛏️ Prospecting', html);
        };

        render();

        window._prospectDrill = () => {
            if (phase !== 'drilling' || currentDepth >= maxDepth) return;

            const layer = layers[currentDepth];
            const staminaCost = 8 + currentDepth * 2 + Math.floor(difficultyMod * 3);
            const drillDmg = 5 + currentDepth * 3 + (layer.hasHazard ? 15 : 0);

            stamina = Math.max(0, stamina - staminaCost + strengthStat * 0.8);
            drillHP = Math.max(0, drillHP - drillDmg);

            // Health cost
            const hpCost = currentDepth >= 4 ? 2 : 1;
            healthCost += hpCost;
            player.health = Math.max(1, player.health - hpCost);

            // Extract any mineral
            if (layer.type !== 'rock') {
                layer.extracted = true;
                const data = itemData[layer.type];
                finds.push({ type: layer.type });
                totalValue += data.value;
                statusMsg = `<span style="color: #2ecc71;">Found ${data.icon} ${data.label}!</span>`;
            } else {
                statusMsg = `<span style="color: var(--text-muted);">Just rock...</span>`;
            }

            if (layer.hasHazard) {
                const extraDmg = Math.floor(Math.random() * 6) + 3;
                healthCost += extraDmg;
                player.health = Math.max(1, player.health - extraDmg);
                statusMsg += ` <span style="color: #e74c3c;">⚠️ Cave-in! -${extraDmg} HP</span>`;
            }

            currentDepth++;

            // Check end conditions
            if (stamina <= 0 || drillHP <= 0 || currentDepth >= maxDepth) {
                phase = 'result';
                if (stamina <= 0) statusMsg = 'Too exhausted to continue.';
                else if (drillHP <= 0) statusMsg = 'Your pick broke!';
                else statusMsg = 'You reached the bottom of the shaft!';

                if (Math.random() < 0.12) {
                    player.strength = (player.strength || 5) + 1;
                    statusMsg += ' 💪 The hard labor strengthened you!';
                }
            }

            render();
            game.ui.updateStats(player, game.world);
        };

        window._prospectScan = () => {
            if (phase !== 'drilling' || scansLeft <= 0) return;
            scansLeft--;

            // Reveal 2-3 upcoming layers
            const scanRange = 2 + (luckStat >= 7 ? 1 : 0);
            let scannedInfo = [];
            for (let d = currentDepth; d < Math.min(maxDepth, currentDepth + scanRange); d++) {
                layers[d].scanned = true;
                const data = itemData[layers[d].type];
                if (data) scannedInfo.push(`${data.icon} ${data.label} at ${d + 1}m`);
                else scannedInfo.push(`⛰️ Rock at ${d + 1}m`);
                if (layers[d].hasHazard) scannedInfo[scannedInfo.length - 1] += ' ⚠️';
            }
            scanResult = `🔍 Scan: ${scannedInfo.join(', ')}`;
            render();
        };

        window._prospectStop = () => {
            phase = 'result';
            if (Math.random() < 0.12) {
                player.strength = (player.strength || 5) + 1;
                statusMsg = '💪 The hard labor strengthened you!';
            }
            render();
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Tame a wild horse — requires horse resource on tile
     */
    doTameHorse(game, tile) {
        const player = game.player;
        const strengthStat = player.strength || 5;
        const luckStat = player.luck || 5;

        ActionMenu._showMinigamePrompt(game, {
            title: '🐴 Tame Horse',
            icon: '🐴',
            description: 'Approach and calm a wild horse to tame it.',
            baseRewardText: '~40% chance of success',
            onSkip: () => {
                // Base reward: simple chance roll
                const chance = 0.35 + luckStat * 0.02 + strengthStat * 0.01;
                if (Math.random() < chance) {
                    player.inventory = player.inventory || {};
                    player.inventory.horse = (player.inventory.horse || 0) + 1;
                    player.maxStamina = (player.maxStamina || 20) + 2;
                    if (Math.random() < 0.2) player.strength = (player.strength || 5) + 1;
                    game.ui.showNotification('🐴 Horse Tamed!', 'You patiently calmed the horse. +1 Horse, +2 Max Stamina.', 'success');
                } else {
                    game.ui.showNotification('🐴 Horse Fled', 'The horse bolted before you could approach.', 'default');
                }
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doTameHorseMinigame(game, tile, player, strengthStat, luckStat); }
        });
    },

    _doTameHorseMinigame(game, tile, player, strengthStat, luckStat) {
        // ── Horse Taming Minigame: Calm & Hold ──
        let calmness = 50;   // 0-100, need to keep in sweet spot (40-70) and hold
        let holdTimer = 0;   // seconds held in calm zone — need 3 to succeed
        const holdTarget = 3.0;
        let phase = 'taming'; // taming → result
        let tameResult = null; // 'success' | 'bolted' | 'kicked'
        let statusMsg = '';
        let gameInterval = null;
        let horseMood = 'nervous'; // nervous | calm | panicked
        let horseAction = '';
        let actionCooldown = 0;

        const cleanup = () => {
            if (gameInterval) { clearInterval(gameInterval); gameInterval = null; }
        };

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">🐴 Taming a Wild Horse</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px;">Strength: ${strengthStat} | Luck: ${luckStat}</p>`;

            if (phase === 'taming') {
                // Horse visual
                const horseAnim = horseMood === 'panicked' ? '🐎💨' : horseMood === 'calm' ? '🐴✨' : '🐴';
                html += `<div style="font-size: 48px; margin: 8px 0; transition: all 0.3s;">${horseAnim}</div>`;
                if (horseAction) html += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">${horseAction}</div>`;

                // Calmness meter with sweet-spot zone
                const calmnessColor = (calmness >= 40 && calmness <= 70) ? '#2ecc71' : calmness > 85 ? '#3498db' : '#e74c3c';
                const moodLabel = horseMood === 'panicked' ? '😱 Panicking!' : horseMood === 'calm' ? '😌 Calm' : '😰 Nervous';
                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Horse Calmness</span>
                        <span style="color: ${calmnessColor}; font-weight: 600;">${moodLabel}</span>
                    </div>
                    <div style="position: relative; height: 22px; background: rgba(255,255,255,0.06); border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <!-- Sweet zone -->
                        <div style="position: absolute; left: 40%; width: 30%; height: 100%; background: rgba(46,204,113,0.12); border-left: 2px dashed rgba(46,204,113,0.4); border-right: 2px dashed rgba(46,204,113,0.4);"></div>
                        <!-- Calmness marker -->
                        <div style="position: absolute; left: ${calmness}%; top: 2px; bottom: 2px; width: 8px; background: ${calmnessColor}; border-radius: 4px; transform: translateX(-50%); box-shadow: 0 0 8px ${calmnessColor}; transition: left 0.15s;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); margin-top: 2px;">
                        <span>Wild</span>
                        <span style="color: rgba(46,204,113,0.6);">Sweet spot</span>
                        <span>Sleepy</span>
                    </div>
                </div>`;

                // Hold progress
                const holdPct = Math.min(100, (holdTimer / holdTarget) * 100);
                html += `<div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Trust (hold in sweet spot)</span>
                        <span style="color: var(--gold);">${holdPct.toFixed(0)}%</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${holdPct}%; height: 100%; background: var(--gold); transition: width 0.2s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                // Control buttons
                html += `<div style="display: flex; gap: 10px; justify-content: center;">
                    <button onmousedown="window._tameCalm()" ontouchstart="window._tameCalm()"
                        style="padding: 14px 24px; background: rgba(46,204,113,0.15); border: 2px solid #2ecc71;
                               border-radius: 10px; cursor: pointer; color: #2ecc71; font-size: 14px; font-weight: bold; user-select: none; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                        🤲 Soothe
                    </button>
                    <button onmousedown="window._tameFeed()" ontouchstart="window._tameFeed()"
                        style="padding: 14px 24px; background: rgba(243,156,18,0.15); border: 2px solid #f39c12;
                               border-radius: 10px; cursor: pointer; color: #f39c12; font-size: 14px; font-weight: bold; user-select: none; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(243,156,18,0.25)'" onmouseleave="this.style.background='rgba(243,156,18,0.15)'">
                        🥕 Offer Food
                    </button>
                    <button onmousedown="window._tameGrip()" ontouchstart="window._tameGrip()"
                        style="padding: 14px 24px; background: rgba(155,89,182,0.15); border: 2px solid #9b59b6;
                               border-radius: 10px; cursor: pointer; color: #9b59b6; font-size: 14px; font-weight: bold; user-select: none; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(155,89,182,0.25)'" onmouseleave="this.style.background='rgba(155,89,182,0.15)'">
                        ✊ Firm Grip
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Keep the horse in the green sweet spot and build trust!</div>`;

            } else {
                // Results
                if (tameResult === 'success') {
                    html += `<div style="font-size: 56px; margin: 12px 0;">🐴✨</div>`;
                    html += `<div style="font-size: 18px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Horse Tamed!</div>`;
                    html += `<div style="padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-bottom: 6px;">🐴 +1 Horse added to inventory</div>`;
                    html += `<div style="padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">⚡ +2 Max Stamina (mount bonus)</div>`;
                    if (statusMsg) html += `<div style="font-size: 12px; color: #88f; margin-top: 6px;">${statusMsg}</div>`;
                } else if (tameResult === 'bolted') {
                    html += `<div style="font-size: 56px; margin: 12px 0;">🐎💨</div>`;
                    html += `<div style="font-size: 18px; color: #f39c12; font-weight: bold; margin-bottom: 8px;">The Horse Bolted!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">It broke free and disappeared into the wild.</div>`;
                } else if (tameResult === 'kicked') {
                    html += `<div style="font-size: 56px; margin: 12px 0;">🦵💥</div>`;
                    html += `<div style="font-size: 18px; color: #e74c3c; font-weight: bold; margin-bottom: 8px;">Kicked!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
                }
                html += `<button onclick="game.ui.hideCustomPanel(); game.endDay();"
                    style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🐴 Horse Taming', html);
        };

        render();

        // Game loop — horse naturally gets restless
        gameInterval = setInterval(() => {
            if (phase !== 'taming') return;

            // Horse naturally drifts (gets nervous)
            const drift = (Math.random() - 0.45) * (8 - strengthStat * 0.3);
            calmness = Math.max(0, Math.min(100, calmness + drift));

            // Random horse actions
            actionCooldown--;
            if (actionCooldown <= 0 && Math.random() < 0.25) {
                const actions = [
                    { text: 'The horse snorts nervously...', effect: -8 },
                    { text: 'The horse stamps its hooves!', effect: -12 },
                    { text: 'The horse nickers softly...', effect: 5 },
                    { text: 'The horse tosses its mane!', effect: -6 },
                    { text: 'The horse whinnies!', effect: -10 },
                ];
                const action = actions[Math.floor(Math.random() * actions.length)];
                horseAction = action.text;
                calmness = Math.max(0, Math.min(100, calmness + action.effect));
                actionCooldown = 3;
            }

            // Update mood
            horseMood = calmness < 20 ? 'panicked' : calmness >= 40 && calmness <= 70 ? 'calm' : 'nervous';

            // In sweet spot? Build hold timer
            if (calmness >= 40 && calmness <= 70) {
                holdTimer += 0.3;
            } else {
                holdTimer = Math.max(0, holdTimer - 0.1);
            }

            // Win condition
            if (holdTimer >= holdTarget) {
                cleanup();
                phase = 'result';
                tameResult = 'success';
                player.inventory = player.inventory || {};
                player.inventory.horse = (player.inventory.horse || 0) + 1;
                player.maxStamina = (player.maxStamina || 10) + 2;
                if (Math.random() < 0.2) {
                    player.strength = (player.strength || 5) + 1;
                    statusMsg = '💪 The struggle strengthened you!';
                }
            }

            // Lose condition — too wild
            if (calmness <= 0) {
                cleanup();
                phase = 'result';
                if (Math.random() < 0.4) {
                    const dmg = Math.floor(Math.random() * 12) + 5;
                    player.health = Math.max(1, player.health - dmg);
                    tameResult = 'kicked';
                    statusMsg = `The panicked horse kicked you! -${dmg} HP`;
                } else {
                    tameResult = 'bolted';
                }
            }

            render();
        }, 300);

        // ── Player actions ──
        window._tameCalm = () => {
            if (phase !== 'taming') return;
            // Soothe — gently increase calmness
            calmness = Math.min(100, calmness + (3 + strengthStat * 0.3));
            horseAction = 'You speak softly and stroke its neck...';
            render();
        };

        window._tameFeed = () => {
            if (phase !== 'taming') return;
            // Feed — bigger calm boost but with cooldown risk
            const feedBonus = 8 + luckStat * 0.5;
            if (Math.random() < 0.7) {
                calmness = Math.min(100, calmness + feedBonus);
                horseAction = '🥕 The horse cautiously takes the food...';
            } else {
                calmness = Math.max(0, calmness - 5);
                horseAction = 'The horse snaps at your hand! Just missed!';
            }
            render();
        };

        window._tameGrip = () => {
            if (phase !== 'taming') return;
            // Firm grip — stops drift temporarily but may spook
            if (calmness < 30) {
                // Risky when panicked
                calmness = Math.max(0, calmness - 10);
                horseAction = 'The horse rears up! Too forceful!';
            } else {
                calmness = Math.max(0, Math.min(100, calmness + (Math.random() < 0.5 ? 2 : -3)));
                holdTimer += 0.4;
                horseAction = '✊ You hold firm... the horse settles slightly.';
            }
            render();
        };
    },

    /**
     * Craft a campfire — uses 2 wood, gives health bonus on rest, can cook fish
     */
    doCraftCampfire(game, tile) {
        const player = game.player;

        if (!player.inventory?.wood || player.inventory.wood < 2) {
            game.ui.showNotification('No Wood', 'You need at least 2 wood to build a campfire.', 'error');
            return;
        }

        player.inventory.wood -= 2;
        if (player.inventory.wood <= 0) delete player.inventory.wood;

        // Immediate health bonus
        const healAmount = 15;
        player.health = Math.min(player.maxHealth || 100, player.health + healAmount);

        let resultMsg = `You built a warm campfire. +${healAmount} HP from the warmth.`;

        // Cook fish if available
        if (player.inventory.fish && player.inventory.fish > 0) {
            const fishCount = Math.min(player.inventory.fish, 3); // Cook up to 3
            player.inventory.fish -= fishCount;
            if (player.inventory.fish <= 0) delete player.inventory.fish;
            player.inventory.cooked_fish = (player.inventory.cooked_fish || 0) + fishCount;

            const extraHeal = fishCount * 5;
            player.health = Math.min(player.maxHealth || 100, player.health + extraHeal);
            resultMsg += ` Cooked ${fishCount} fish (+${extraHeal} HP).`;
        }

        // Cook raw meat if available
        if (player.inventory.meat && player.inventory.meat > 0) {
            const meatCount = Math.min(player.inventory.meat, 3);
            player.inventory.meat -= meatCount;
            if (player.inventory.meat <= 0) delete player.inventory.meat;
            player.inventory.cooked_meat = (player.inventory.cooked_meat || 0) + meatCount;

            const extraHeal = meatCount * 7;
            player.health = Math.min(player.maxHealth || 100, player.health + extraHeal);
            resultMsg += ` Cooked ${meatCount} meat (+${extraHeal} HP).`;
        }

        // Small intelligence gain from the craft
        if (Math.random() < 0.08) {
            player.intelligence = (player.intelligence || 5) + 1;
            resultMsg += ' Your practical skills sharpened your mind.';
        }

        game.ui.showNotification('🔥 Campfire', resultMsg, 'success');
        game.ui.updateStats(player, game.world);
    },

    // ============================================
    // RELATIONSHIPS — Meet People, Courting, Family, Dynasty
    // ============================================

    /**
     * Show the Meet People menu — browse NPCs at this settlement
     */
    showMeetPeopleMenu(game, tile) {
        if (!tile.settlement) return;
        if (typeof Relationships === 'undefined') {
            game.ui.showNotification('Unavailable', 'Relationship system not loaded.', 'error');
            return;
        }

        const player = game.player;
        const npcs = Relationships.getNPCsAtSettlement(tile, game.world);
        const personalities = Relationships._getPersonalities();

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">👥 Meet People</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">People of <strong>${tile.settlement.name}</strong>. Open a character profile to interact, build relationships, and invite companions.</p>`;

        if (npcs.length === 0) {
            html += '<p style="color: #aaa;">Nobody interesting around right now.</p>';
        }

        for (const npc of npcs) {
            const rel = Relationships.getRelationship(player, npc.id);
            const relLabel = Relationships.getRelationLabel(rel.score);
            const personality = personalities[npc.personality] || { label: 'Unknown', icon: '❓' };
            const stage = rel.romantic ? Relationships.getCourtingStage(rel.affection, npc.isMarried && player.spouse === npc.id) : null;
            const level = Relationships.getRelationshipLevel(rel.score || 0);
            const inParty = Relationships.isInTravelParty(player, npc.id);

            const genderIcon = npc.gender === 'male' ? '♂️' : '♀️';
            const marriedTag = (player.spouse === npc.id) ? ' <span style="color: #ff69b4;">💍 Your Spouse</span>' : '';
            const partyTag = inParty ? ' <span style="color: #6cf;">🧭 Traveling With You</span>' : '';

            html += `<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid ${rel.score >= 30 ? '#4a4' : rel.score <= -30 ? '#a44' : '#666'};">`;
            html += `<div style="display: flex; justify-content: space-between; align-items: center;">`;
            html += `<div>`;
            html += `<strong>${npc.firstName} ${npc.dynasty}</strong> ${genderIcon}${marriedTag}${partyTag}`;
            html += `<div style="font-size: 11px; color: #aaa;">Age ${npc.age} · ${npc.occupation} · ${personality.icon} ${personality.label}</div>`;
            html += `<div style="font-size: 11px; color: #888;">${npc.appearance.hair} hair, ${npc.appearance.eyes} eyes, ${npc.appearance.build}</div>`;
            html += `</div>`;
            html += `<div style="text-align: right; font-size: 11px;">`;
            html += `<div>${relLabel.icon} ${relLabel.label} (${rel.score})</div>`;
            html += `<div style="color: #999;">${level.icon} ${level.label}</div>`;
            if (stage) {
                html += `<div style="color: #ff69b4;">${stage.icon} ${stage.label} (${rel.affection})</div>`;
            }
            html += `</div>`;
            html += `</div>`;

            html += `<div style="margin-top: 8px; display: flex; gap: 6px;">`;
            html += `<button onclick="window._openCharacterFromMeet('${npc.id}')" style="padding: 6px 10px; background: #445; border: none; border-radius: 4px; cursor: pointer; color: #dde; font-size: 11px;">📇 Character Profile</button>`;
            html += `</div>`;

            html += `</div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('Meet People', html);

        window._openCharacterFromMeet = (npcId) => {
            ActionMenu.showCharacterDataModal(game, tile, npcId, { returnTo: 'meet' });
        };
    },

    showCharacterDataModal(game, tile, npcId, options = {}) {
        if (typeof Relationships === 'undefined') return;

        const player = game.player;
        const npc = Relationships.getNPC(npcId);
        if (!npc || !npc.isAlive) {
            game.ui.showNotification('Unavailable', 'This character is no longer available.', 'warning');
            return;
        }

        const rel = Relationships.getRelationship(player, npcId);
        const relLabel = Relationships.getRelationLabel(rel.score || 0);
        const level = Relationships.getRelationshipLevel(rel.score || 0);
        const personalities = Relationships._getPersonalities();
        const personality = personalities[npc.personality] || { label: 'Unknown', icon: '❓' };
        const isSpouse = player.spouse === npcId;
        const stage = rel.romantic ? Relationships.getCourtingStage(rel.affection || 0, isSpouse) : null;
        const inParty = Relationships.isInTravelParty(player, npcId);

        const socialActions = Relationships.getSocialActionAvailability(player, npcId);
        const courtActions = Relationships.getCourtActionAvailability(player, npcId);

        const renderRelationshipActionButton = (action, kind) => {
            const unlocked = !!action.unlocked;
            const clickHandler = kind === 'social' ? '_characterSocialAction' : '_characterCourtAction';
            const goldText = action.cost ? `, ${action.cost}g` : '';
            const apText = action.apCost != null ? `, ${action.apCost} AP` : '';
            const baseStyle = kind === 'social'
                ? 'background: #446; color: #ccc;'
                : 'background: #644; color: #fcc;';

            if (unlocked) {
                return `<button onclick="window.${clickHandler}('${npcId}', '${action.id}')" style="padding: 4px 8px; ${baseStyle} border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">${action.icon} ${action.label}${goldText}${apText}</button>`;
            }

            const reason = (action.lockReason || 'Locked').replace(/"/g, '&quot;');
            return `<button title="${reason}" disabled style="padding: 4px 8px; background: #333; border: 1px solid #555; border-radius: 3px; color: #777; cursor: not-allowed; font-size: 11px;">🔒 ${action.label}</button>`;
        };

        let html = '<div style="max-height: 520px; overflow-y: auto;">';
        html += `<h4 style="margin-top: 0;">📇 ${npc.firstName} ${npc.dynasty}</h4>`;
        html += `<div style="font-size: 12px; color: #aaa;">Age ${npc.age} · ${npc.occupation} · ${personality.icon} ${personality.label}</div>`;
        html += `<div style="font-size: 11px; color: #888; margin-bottom: 6px;">${npc.appearance.hair} hair, ${npc.appearance.eyes} eyes, ${npc.appearance.build}</div>`;

        html += `<div style="background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px; margin-bottom: 8px;">`;
        html += `<div style="font-size: 12px; margin-bottom: 4px;">${relLabel.icon} ${relLabel.label} (${rel.score || 0}) · ${level.icon} ${level.label}</div>`;
        html += ActionMenu._renderRelationshipXPBar(rel.score || 0, false);
        html += `<div style="margin-top: 6px; font-size: 12px; color: #ff69b4;">Affection: ${rel.affection || 0}${stage ? ` · ${stage.icon} ${stage.label}` : ''}</div>`;
        html += ActionMenu._renderAffectionBar(rel.affection || 0);
        html += `</div>`;

        html += `<div style="background: rgba(90,140,200,0.12); padding: 8px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(90,140,200,0.35);">`;
        html += `<div style="font-size: 12px; margin-bottom: 6px; color: #9cd;">🧭 Travel Party</div>`;
        if (inParty) {
            html += `<div style="font-size: 11px; color: #bcd; margin-bottom: 6px;">${npc.firstName} is currently traveling with you.</div>`;
            html += `<button onclick="window._removePartyMember('${npcId}')" style="padding: 5px 10px; background: #355; border: none; border-radius: 4px; cursor: pointer; color: #cde; font-size: 11px;">👋 Ask to Leave Party</button>`;
        } else {
            html += `<div style="font-size: 11px; color: #bcd; margin-bottom: 6px;">Ask this character to join your travel party.</div>`;
            html += `<button onclick="window._inviteToTravelParty('${npcId}')" style="padding: 5px 10px; background: #357; border: none; border-radius: 4px; cursor: pointer; color: #def; font-size: 11px;">🤝 Invite to Travel</button>`;
        }
        html += `</div>`;

        html += `<div style="margin-bottom: 6px; font-size: 12px; color: #ccc;">🗣️ Social Actions</div>`;
        html += `<div style="display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap;">`;
        for (const action of socialActions) {
            html += renderRelationshipActionButton(action, 'social');
        }
        html += `</div>`;

        html += `<div style="margin-bottom: 6px; font-size: 12px; color: #fcc;">💕 Romantic Actions</div>`;
        html += `<div style="display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap;">`;
        for (const action of courtActions) {
            html += renderRelationshipActionButton(action, 'court');
        }
        html += `</div>`;

        const lockedActions = [...socialActions, ...courtActions].filter(action => !action.unlocked);
        if (lockedActions.length > 0) {
            const lockHints = lockedActions.slice(0, 4).map(action => `• ${action.label}: ${action.lockReason}`).join('<br>');
            html += `<div style="margin-top: 6px; font-size: 10px; color: #888;">${lockHints}</div>`;
        }

        const backLabel = options.returnTo === 'relationships'
            ? 'Back to Relationships'
            : options.returnTo === 'travel_party'
                ? 'Back to Travel Party'
                : 'Back to Meet People';
        html += `<button onclick="window._backFromCharacterModal()" style="margin-top: 10px; width: 100%; padding: 8px; background: #444; border: none; border-radius: 4px; cursor: pointer; color: #ccc; font-size: 11px;">← ${backLabel}</button>`;
        html += '</div>';

        game.ui.showCustomPanel(`Character: ${npc.firstName}`, html);

        window._backFromCharacterModal = () => {
            if (options.returnTo === 'relationships') {
                ActionMenu.showRelationshipsMenu(game, tile);
            } else if (options.returnTo === 'travel_party') {
                ActionMenu.showTravelPartyMenu(game, tile);
            } else {
                ActionMenu.showMeetPeopleMenu(game, tile);
            }
        };

        window._inviteToTravelParty = (targetNpcId) => {
            const result = Relationships.requestJoinTravelParty(player, targetNpcId, game.world);
            if (!result.success) {
                game.ui.showNotification('Cannot Invite', result.reason, 'warning');
                return;
            }

            if (result.accepted) {
                game.ui.showNotification('🧭 Joined Party', `${result.npc.firstName} agrees to travel with you.`, 'success');
            } else {
                game.ui.showNotification('🙅 Declined', result.reason, 'warning');
            }

            game.ui.updateStats(player, game.world);
            ActionMenu.showCharacterDataModal(game, tile, targetNpcId, options);
        };

        window._removePartyMember = (targetNpcId) => {
            const result = Relationships.removeFromTravelParty(player, targetNpcId);
            if (!result.success) {
                game.ui.showNotification('Cannot Remove', result.reason, 'warning');
                return;
            }
            game.ui.showNotification('👋 Left Party', `${result.npc ? result.npc.firstName : 'Companion'} is no longer traveling with you.`, 'info');
            game.ui.updateStats(player, game.world);
            ActionMenu.showCharacterDataModal(game, tile, targetNpcId, options);
        };

        window._characterSocialAction = (targetNpcId, actionId) => {
            const socialDefs = Relationships._getSocialActions();
            const actionDef = socialDefs[actionId] || {};
            const availability = Relationships.getSocialActionAvailability(player, targetNpcId)
                .find(item => item.id === actionId);
            if (availability && !availability.unlocked) {
                game.ui.showNotification('🔒 Action Locked', availability.lockReason || 'This interaction is not unlocked yet.', 'warning');
                return;
            }

            const apCost = actionDef.apCost != null ? actionDef.apCost : 1;
            if ((player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ Not Enough AP', `This interaction requires ${apCost} AP but you only have ${player.actionPoints || 0}.`, 'error');
                return;
            }
            player.actionPoints -= apCost;

            const socialResult = Relationships.performSocialAction(player, targetNpcId, actionId);
            const targetNpc = Relationships.getNPC(targetNpcId);
            if (targetNpc) targetNpc.lastInteraction = game.world?.day || 0;

            if (socialResult.success) {
                const sign = socialResult.gain >= 0 ? '+' : '';
                let msg = `${socialResult.npc.firstName}: ${sign}${socialResult.gain} relationship.`;
                if (socialResult.skillUp) msg += ' Diplomacy improved!';
                game.ui.showNotification(socialResult.gain >= 0 ? '😊 Social' : '😤 Conflict', msg, socialResult.gain >= 0 ? 'success' : 'warning');
            } else if (socialResult.failed) {
                game.ui.showNotification('😬 Awkward', socialResult.reason, 'warning');
            } else {
                game.ui.showNotification('Error', socialResult.reason, 'error');
            }

            game.ui.updateStats(player, game.world);
            ActionMenu.showCharacterDataModal(game, tile, targetNpcId, options);
        };

        window._characterCourtAction = (targetNpcId, actionId) => {
            const courtDefs = Relationships._getCourtActions();
            const actionDef = courtDefs[actionId] || {};
            const availability = Relationships.getCourtActionAvailability(player, targetNpcId)
                .find(item => item.id === actionId);
            if (availability && !availability.unlocked) {
                game.ui.showNotification('🔒 Action Locked', availability.lockReason || 'This romantic interaction is not unlocked yet.', 'warning');
                return;
            }

            const apCost = actionDef.apCost != null ? actionDef.apCost : 1;
            if ((player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ Not Enough AP', `This interaction requires ${apCost} AP but you only have ${player.actionPoints || 0}.`, 'error');
                return;
            }
            player.actionPoints -= apCost;

            const courtResult = Relationships.performCourtAction(player, targetNpcId, actionId);
            const targetNpc = Relationships.getNPC(targetNpcId);
            if (targetNpc) targetNpc.lastInteraction = game.world?.day || 0;

            if (courtResult.success) {
                if (courtResult.married) {
                    const marryResult = Relationships.marry(player, targetNpcId, game.world);
                    if (marryResult.success) {
                        ActionMenu._showMarriageCelebration(game, marryResult.npc);
                        return;
                    }
                }
                let msg = `${courtResult.npc.firstName}: +${courtResult.gain} affection (${courtResult.stage.icon} ${courtResult.stage.label}).`;
                if (courtResult.charismaUp) msg += ' Charisma improved!';
                game.ui.showNotification('💕 Romance', msg, 'success');
            } else if (courtResult.failed) {
                game.ui.showNotification('💔 Rejected', courtResult.reason, 'warning');
            } else {
                game.ui.showNotification('Error', courtResult.reason, 'error');
            }

            game.ui.updateStats(player, game.world);
            ActionMenu.showCharacterDataModal(game, tile, targetNpcId, options);
        };
    },

    showTravelPartyMenu(game, tile) {
        if (typeof Relationships === 'undefined') return;

        const player = game.player;
        Relationships.ensureTravelParty(player);
        const party = Relationships.getTravelPartyMembers(player);

        const knownCandidates = Object.entries(player.relationships || {})
            .map(([npcId, rel]) => ({ npcId, rel, npc: Relationships.getNPC(npcId) }))
            .filter(entry => entry.npc && entry.npc.isAlive && !Relationships.isInTravelParty(player, entry.npcId))
            .sort((a, b) => ((b.rel.score || 0) + (b.rel.affection || 0) * 0.5) - ((a.rel.score || 0) + (a.rel.affection || 0) * 0.5));

        let html = '<div style="max-height: 520px; overflow-y: auto;">';
        html += '<h4 style="margin-top: 0;">🧭 Travel Party</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary);">Manage companions who travel with you and invite trusted contacts.</p>';

        html += `<div style="background: rgba(90,140,200,0.12); border: 1px solid rgba(90,140,200,0.35); padding: 8px; border-radius: 6px; margin-bottom: 8px; font-size: 12px; color: #bcd;">`;
        html += `Active companions: <strong style="color: #def;">${party.length}</strong>`;
        html += `</div>`;

        if (party.length === 0) {
            html += '<div style="padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.03); color: #aaa; font-size: 12px; margin-bottom: 8px;">No one is currently traveling with you.</div>';
        } else {
            html += '<h5 style="margin: 6px 0; color: #6cf;">Current Party</h5>';
            for (const npc of party) {
                const rel = Relationships.getRelationship(player, npc.id);
                const relation = Relationships.getRelationLabel(rel.score || 0);
                html += `<div style="background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px; margin-bottom: 6px;">`;
                html += `<div style="display: flex; justify-content: space-between; align-items: center;">`;
                html += `<div style="font-size: 12px;">🧭 <strong>${npc.firstName} ${npc.dynasty}</strong> · ${relation.icon} ${relation.label} (${rel.score || 0})</div>`;
                html += `<div style="display: flex; gap: 6px;">`;
                html += `<button onclick="window._partyOpenProfile('${npc.id}')" style="padding: 3px 8px; background: #355; border: none; border-radius: 3px; color: #cde; cursor: pointer; font-size: 10px;">Profile</button>`;
                html += `<button onclick="window._partyRemove('${npc.id}')" style="padding: 3px 8px; background: #533; border: none; border-radius: 3px; color: #ecc; cursor: pointer; font-size: 10px;">Remove</button>`;
                html += `</div>`;
                html += `</div>`;
                html += `</div>`;
            }
        }

        html += '<h5 style="margin: 8px 0 6px; color: #9ab;">Invite Known People</h5>';
        if (knownCandidates.length === 0) {
            html += '<div style="padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.03); color: #888; font-size: 11px;">No eligible contacts to invite right now.</div>';
        } else {
            for (const entry of knownCandidates.slice(0, 12)) {
                const relation = Relationships.getRelationLabel(entry.rel.score || 0);
                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; font-size: 12px; background: rgba(255,255,255,0.03); border-radius: 4px; margin-bottom: 4px;">`;
                html += `<span>${relation.icon} <strong>${entry.npc.firstName}</strong> (${entry.rel.score || 0})</span>`;
                html += `<div style="display: flex; gap: 6px;">`;
                html += `<button onclick="window._partyInvite('${entry.npcId}')" style="padding: 3px 8px; background: #357; border: none; border-radius: 3px; color: #def; cursor: pointer; font-size: 10px;">Invite</button>`;
                html += `<button onclick="window._partyOpenProfile('${entry.npcId}')" style="padding: 3px 8px; background: #444; border: none; border-radius: 3px; color: #ddd; cursor: pointer; font-size: 10px;">Profile</button>`;
                html += `</div>`;
                html += `</div>`;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Travel Party', html);

        window._partyOpenProfile = (npcId) => {
            ActionMenu.showCharacterDataModal(game, tile, npcId, { returnTo: 'travel_party' });
        };

        window._partyRemove = (npcId) => {
            const result = Relationships.removeFromTravelParty(player, npcId);
            if (!result.success) {
                game.ui.showNotification('Cannot Remove', result.reason, 'warning');
                return;
            }
            game.ui.showNotification('👋 Left Party', `${result.npc ? result.npc.firstName : 'Companion'} is no longer traveling with you.`, 'info');
            ActionMenu.showTravelPartyMenu(game, tile);
        };

        window._partyInvite = (npcId) => {
            const result = Relationships.requestJoinTravelParty(player, npcId, game.world);
            if (!result.success) {
                game.ui.showNotification('Cannot Invite', result.reason, 'warning');
                return;
            }

            if (result.accepted) {
                game.ui.showNotification('🧭 Joined Party', `${result.npc.firstName} agrees to travel with you.`, 'success');
            } else {
                game.ui.showNotification('🙅 Declined', result.reason, 'warning');
            }
            ActionMenu.showTravelPartyMenu(game, tile);
        };
    },

    /**
     * Handle the "Tell Stories" social interaction — provides meaningful world knowledge
     */
    _handleTellStories(game, player, npcId, tile) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) {
            game.ui.showNotification('Error', 'NPC not found.', 'error');
            return;
        }

        // Small relationship gain for sharing stories
        const rel = Relationships.getRelationship(player, npcId);
        const relGain = Utils.randInt(1, 3);
        rel.score = Math.max(-100, Math.min(100, rel.score + relGain));
        rel.history.push({ day: game.world?.day || 0, action: 'tell_stories', result: 'success', gain: relGain });

        // Track interaction
        npc.lastInteraction = game.world?.day || 0;

        // ── Determine what the NPC knows based on occupation ──
        const occupationKnowledge = {
            farmer:     ['peoples', 'basics'],
            blacksmith: ['economy', 'military'],
            merchant:   ['economy', 'diplomacy'],
            innkeeper:  ['basics', 'peoples', 'ruler'],
            guard:      ['military', 'basics'],
            soldier:    ['military', 'diplomacy'],
            healer:     ['peoples', 'religion'],
            priest:     ['religion', 'peoples'],
            scholar:    ['ruler', 'diplomacy', 'religion', 'economy'],
            noble:      ['ruler', 'diplomacy', 'military'],
            hunter:     ['basics', 'peoples'],
            fisher:     ['basics', 'economy'],
            miner:      ['economy', 'basics'],
            weaver:     ['economy', 'peoples'],
            baker:      ['basics', 'peoples'],
            tailor:     ['economy', 'peoples'],
            carpenter:  ['economy', 'basics'],
        };

        const npcOccupation = (npc.occupation || 'farmer').toLowerCase();
        const knowledgeCategories = occupationKnowledge[npcOccupation]
            || ['basics', 'peoples']; // fallback

        // Build results
        const outcomes = [];

        // ── 1. Kingdom Knowledge (always attempt if NPC has a kingdom) ──
        const npcKingdom = npc.kingdomId;
        if (npcKingdom) {
            // Pick a category the NPC would know about based on occupation
            const category = Utils.randPick(knowledgeCategories);
            const learned = player.learnAboutKingdom(npcKingdom, category);
            const kingdom = game.world.getKingdom(npcKingdom);
            const kName = kingdom ? kingdom.name : 'the kingdom';

            if (learned.length > 0) {
                // Generate flavor text based on category
                const flavorTexts = {
                    basics:    [`${npc.firstName} tells you about daily life in ${kName} — its people, customs, and traditions.`,
                                `"Let me tell you about ${kName}," ${npc.firstName} says, describing the land and its ways.`],
                    ruler:     [`${npc.firstName} shares gossip about ${kName}'s ruler — their temperament, decisions, and court.`,
                                `"The ruler of ${kName}..." ${npc.firstName} leans in conspiratorially, sharing what they know.`],
                    peoples:   [`${npc.firstName} describes the various peoples who call ${kName} home — their origins and cultures.`,
                                `"Many folk live in ${kName}," ${npc.firstName} explains, describing the diverse communities.`],
                    religion:  [`${npc.firstName} speaks of the faiths practiced in ${kName} — the temples, the rituals, the devotions.`,
                                `"Faith runs deep in ${kName}," ${npc.firstName} tells you about the local beliefs.`],
                    military:  [`${npc.firstName} talks about ${kName}'s military strength — their soldiers, fortifications, and wars.`,
                                `"I've seen ${kName}'s army," ${npc.firstName} says, describing their forces in detail.`],
                    diplomacy: [`${npc.firstName} discusses ${kName}'s relations with neighboring realms — alliances, rivalries, treaties.`,
                                `"Politics is a tangled web," ${npc.firstName} explains ${kName}'s diplomatic standing.`],
                    economy:   [`${npc.firstName} shares insight into ${kName}'s trade and wealth — what they produce, what they need.`,
                                `"If you want to make coin in ${kName}," ${npc.firstName} explains the local economy.`],
                };
                const texts = flavorTexts[category] || [`${npc.firstName} tells you about ${kName}'s ${category}.`];
                outcomes.push({
                    icon: '🏰',
                    title: `Kingdom Intel: ${category.charAt(0).toUpperCase() + category.slice(1)}`,
                    text: Utils.randPick(texts),
                    type: 'kingdom',
                });
            } else {
                // Already know everything they could teach
                outcomes.push({
                    icon: '🏰',
                    title: 'Nothing New',
                    text: `${npc.firstName} talks about ${kName}, but you already know everything a ${npcOccupation} would about their ${knowledgeCategories.join(' and ')}.`,
                    type: 'known',
                });
            }
        }

        // ── 2. World Lore Discovery (40% chance, higher if NPC is scholar/priest/noble) ──
        const loreChance = ['scholar', 'priest', 'noble', 'innkeeper'].includes(npcOccupation) ? 0.6 : 0.35;
        if (typeof Peoples !== 'undefined' && Math.random() < loreChance) {
            const loreOpts = {};
            if (npcKingdom) loreOpts.kingdom = npcKingdom;
            const discovered = Peoples.discoverLore(player, game.world, loreOpts);
            if (discovered.length > 0) {
                const entry = discovered[0];
                const eraNames = { 0: 'the Dawn Age', 1: 'the Age of Expansion', 2: 'the Age of Conflict', 3: 'the Modern Era' };
                const era = entry.era !== undefined ? (eraNames[entry.era] || `Era ${entry.era}`) : 'ages past';
                outcomes.push({
                    icon: '📜',
                    title: 'Ancient Lore',
                    text: `${npc.firstName} recounts a tale from ${era}: "${entry.text}"`,
                    type: 'lore',
                    entry,
                });
            }
        }

        // ── 3. Occupation-specific tips (bonus effects) ──
        const tipRoll = Math.random();
        if (tipRoll < 0.25) {
            const tips = [];
            if (['merchant', 'innkeeper'].includes(npcOccupation) && player.skills) {
                player.skills.commerce = Math.min((player.skills.commerce || 1) + 1, 10);
                tips.push({ icon: '💰', title: 'Trade Wisdom', text: `${npc.firstName}'s merchant tales teach you something useful about trade. Commerce +1.` });
            } else if (['guard', 'soldier'].includes(npcOccupation) && player.skills) {
                player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
                tips.push({ icon: '⚔️', title: 'Battle Tales', text: `${npc.firstName}'s war stories sharpen your understanding of combat. Combat +1.` });
            } else if (['scholar', 'priest', 'healer'].includes(npcOccupation)) {
                player.intelligence = Math.min((player.intelligence || 5) + 1, 10);
                tips.push({ icon: '📚', title: 'Scholarly Insight', text: `${npc.firstName}'s deep knowledge expands your mind. Intelligence +1.` });
            } else if (['hunter', 'fisher'].includes(npcOccupation) && player.skills) {
                player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                tips.push({ icon: '🏹', title: 'Wilderness Lore', text: `${npc.firstName} teaches you about tracking and survival. Stealth +1.` });
            } else if (player.skills) {
                player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                tips.push({ icon: '🗣️', title: 'Social Grace', text: `The conversation itself teaches you about reading people. Diplomacy +1.` });
            }
            if (tips.length > 0) outcomes.push({ ...tips[0], type: 'tip' });
        }

        // ── 4. If nothing interesting happened at all, give a flavor fallback ──
        if (outcomes.length === 0 || (outcomes.length === 1 && outcomes[0].type === 'known')) {
            const fallbacks = [
                `${npc.firstName} rambles about the weather and local gossip. Nothing particularly useful, but it passes the time.`,
                `${npc.firstName} shares a long-winded story about their cousin's farm. You smile politely.`,
                `You trade stories for a while. ${npc.firstName} seems to enjoy the company more than the tales.`,
                `${npc.firstName} tells a tale you've heard before, but you listen anyway. They appreciate the courtesy.`,
            ];
            if (outcomes.length === 0) {
                outcomes.push({ icon: '💬', title: 'Pleasant Chat', text: Utils.randPick(fallbacks), type: 'fallback' });
            }
        }

        // ── Build the results panel ──
        let html = '<div style="max-height: 450px; overflow-y: auto;">';
        html += `<h4 style="margin-top: 0;">📖 Stories with ${npc.firstName}</h4>`;
        html += `<p style="font-size: 12px; color: var(--text-secondary);">You sit with ${npc.firstName} (${npc.occupation}) and exchange tales. +${relGain} relationship.</p>`;

        const typeColors = {
            kingdom: 'rgba(245,197,66,0.1)',
            lore: 'rgba(139,69,19,0.15)',
            tip: 'rgba(76,175,80,0.1)',
            known: 'rgba(255,255,255,0.03)',
            fallback: 'rgba(255,255,255,0.03)',
        };
        const borderColors = {
            kingdom: 'var(--gold)',
            lore: '#8b4513',
            tip: '#4caf50',
            known: '#555',
            fallback: '#555',
        };

        for (const outcome of outcomes) {
            html += `
                <div style="padding: 10px; margin-bottom: 8px; background: ${typeColors[outcome.type] || 'rgba(255,255,255,0.03)'};
                    border-left: 3px solid ${borderColors[outcome.type] || '#555'}; border-radius: 0 4px 4px 0;">
                    <div style="font-weight: bold; font-size: 12px; margin-bottom: 4px; color: ${borderColors[outcome.type] || '#ccc'};">
                        ${outcome.icon} ${outcome.title}
                    </div>
                    <div style="font-size: 12px; color: #ccc; line-height: 1.5;">${outcome.text}</div>
                </div>
            `;
        }

        html += `<button onclick="game.ui.hideCustomPanel(); ActionMenu.showMeetPeopleMenu(game, game.world.getTile(${tile.q}, ${tile.r}));" 
                    style="width: 100%; margin-top: 8px; padding: 10px; background: rgba(255,255,255,0.08); 
                    border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; color: var(--text-secondary); 
                    font-family: var(--font-body);">Back to People</button>`;
        html += '</div>';

        game.ui.showCustomPanel('Stories', html);
        game.ui.updateStats(player, game.world);
    },

    /**
     * Show marriage celebration panel
     */
    _showMarriageCelebration(game, spouse) {
        let html = '<div style="text-align: center;">';
        html += '<h3 style="color: var(--gold); margin-top: 0;">💍 Just Married! 💍</h3>';
        html += `<p style="font-size: 16px;">You and <strong>${spouse.firstName} ${spouse.dynasty}</strong> are now wed!</p>`;
        html += '<p style="font-size: 40px;">👫💒🎉</p>';
        html += '<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin: 10px 0; font-size: 12px; text-align: left;">';
        html += '<div>+1 max stamina (companionship)</div>';
        html += '<div>+3 renown</div>';
        if (spouse.kingdomId) html += '<div>+5 reputation with spouse\'s kingdom</div>';
        html += '<div style="margin-top: 6px; color: #ff69b4;">You may now have children as time passes!</div>';
        html += '</div>';
        html += `<button onclick="game.ui.hideCustomPanel();" style="width: 100%; padding: 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">Begin Your New Life Together</button>`;
        html += '</div>';

        game.ui.showCustomPanel('Wedding', html);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show all relationships the player has built
     */
    showRelationshipsMenu(game, tile) {
        if (typeof Relationships === 'undefined') return;
        const player = game.player;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">💕 Your Relationships</h4>';

        // Spouse section
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) {
                const rel = Relationships.getRelationship(player, player.spouse);
                html += '<div style="background: rgba(255,105,180,0.15); padding: 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(255,105,180,0.3);">';
                html += `<div style="font-weight: bold; color: #ff69b4;">💍 Spouse: ${spouse.firstName} ${spouse.dynasty}</div>`;
                html += `<div style="font-size: 11px; color: #aaa;">Age ${spouse.age} · ${spouse.occupation} · Affection: ${rel.affection}/100 · Relation: ${rel.score || 0}</div>`;
                html += '<div style="margin-top: 4px;">';
                html += ActionMenu._renderAffectionBar(rel.affection);
                html += '</div>';
                html += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
                html += `<button onclick="window._divorceConfirm()" style="padding: 3px 8px; background: #633; border: none; border-radius: 3px; cursor: pointer; color: #c88; font-size: 10px; margin-top: 4px;">💔 Divorce</button>`;
                html += '</div>';
            }
        }

        // Children section
        if (player.children && player.children.length > 0) {
            html += '<div style="margin-bottom: 8px;">';
            html += '<h5 style="margin: 4px 0; color: var(--gold);">👶 Children</h5>';
            for (const child of player.children) {
                if (!child.isAlive) continue;
                const genderIcon = child.gender === 'male' ? '♂️' : '♀️';
                const isHeir = player.heir === child.id;
                const traitStr = child.traits?.length > 0
                    ? child.traits.map(t => `${t.icon}`).join(' ')
                    : '';
                html += `<div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 4px; margin-bottom: 4px; font-size: 12px; ${isHeir ? 'border-left: 3px solid var(--gold);' : ''}">`;
                html += `<strong>${child.firstName} ${child.dynasty}</strong> ${genderIcon} · Age ${child.age} ${traitStr}`;
                if (isHeir) html += ` <span style="color: var(--gold);">👑 Heir</span>`;
                html += `</div>`;
            }
            html += '</div>';
        }

        // Friends & Acquaintances
        const allRels = Object.entries(player.relationships || {});
        const friends = allRels.filter(([id, r]) => r.score >= 10).sort((a, b) => b[1].score - a[1].score);
        const rivals = allRels.filter(([id, r]) => r.score <= -10).sort((a, b) => a[1].score - b[1].score);
        const romanticInterests = allRels.filter(([id, r]) => r.romantic && id !== player.spouse).sort((a, b) => (b[1].affection || 0) - (a[1].affection || 0));
        const knownPeople = allRels
            .map(([npcId, rel]) => ({ npcId, rel, npc: Relationships.getNPC(npcId) }))
            .filter(entry => entry.npc && entry.npc.isAlive)
            .sort((a, b) => (b.rel.score || 0) - (a.rel.score || 0));
        const travelParty = Relationships.getTravelPartyMembers(player);

        if (travelParty.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #6cf;">🧭 Travel Party</h5>';
            for (const member of travelParty) {
                const rel = Relationships.getRelationship(player, member.id);
                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; font-size: 12px; background: rgba(90,140,200,0.10); border-radius: 4px; margin-bottom: 3px;">`;
                html += `<span>🧭 <strong>${member.firstName}</strong> (${rel.score || 0})</span>`;
                html += `<button onclick="window._openKnownCharacter('${member.id}')" style="padding: 3px 8px; background: #355; border: none; border-radius: 3px; cursor: pointer; color: #cde; font-size: 10px;">Profile</button>`;
                html += `</div>`;
            }
        }

        if (romanticInterests.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #ff69b4;">💕 Romantic Interests</h5>';
            for (const [npcId, rel] of romanticInterests) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive) continue;
                const stage = Relationships.getCourtingStage(rel.affection, false);
                html += `<div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,105,180,0.1); padding: 6px 8px; border-radius: 4px; margin-bottom: 4px; font-size: 12px;">`;
                html += `<span>${stage.icon} <strong>${npc.firstName}</strong> · ${stage.label} · Affection: ${rel.affection} · Score: ${rel.score || 0}</span>`;
                html += `<button onclick="window._openKnownCharacter('${npc.id}')" style="padding: 3px 8px; background: #544; border: none; border-radius: 3px; cursor: pointer; color: #fcc; font-size: 10px;">Profile</button>`;
                html += `</div>`;
                html += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
            }
        }

        if (friends.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #4a4;">😊 Friends</h5>';
            for (const [npcId, rel] of friends) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive || npcId === player.spouse) continue;
                const label = Relationships.getRelationLabel(rel.score);
                html += `<div style="padding: 4px 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">`;
                html += `<span>${label.icon} <strong>${npc.firstName}</strong> (${rel.score})</span>`;
                html += `<button onclick="window._openKnownCharacter('${npc.id}')" style="padding: 3px 8px; background: #353; border: none; border-radius: 3px; cursor: pointer; color: #cec; font-size: 10px;">Profile</button>`;
                html += `</div>`;
                html += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
            }
        }

        if (rivals.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #a44;">⚡ Rivals</h5>';
            for (const [npcId, rel] of rivals) {
                const npc = Relationships.getNPC(npcId);
                if (!npc || !npc.isAlive) continue;
                const label = Relationships.getRelationLabel(rel.score);
                html += `<div style="padding: 4px 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">`;
                html += `<span>${label.icon} <strong>${npc.firstName}</strong> (${rel.score})</span>`;
                html += `<button onclick="window._openKnownCharacter('${npc.id}')" style="padding: 3px 8px; background: #533; border: none; border-radius: 3px; cursor: pointer; color: #ecc; font-size: 10px;">Profile</button>`;
                html += `</div>`;
                html += ActionMenu._renderRelationshipXPBar(rel.score || 0, true);
            }
        }

        if (knownPeople.length > 0) {
            html += '<h5 style="margin: 8px 0 4px; color: #9ab;">📇 People You Know</h5>';
            for (const entry of knownPeople.slice(0, 16)) {
                const relation = Relationships.getRelationLabel(entry.rel.score || 0);
                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 12px; background: rgba(255,255,255,0.03); border-radius: 4px; margin-bottom: 3px;">`;
                html += `<span>${relation.icon} <strong>${entry.npc.firstName}</strong> (${entry.rel.score || 0})</span>`;
                html += `<button onclick="window._openKnownCharacter('${entry.npcId}')" style="padding: 3px 8px; background: #444; border: none; border-radius: 3px; cursor: pointer; color: #ddd; font-size: 10px;">Character Profile</button>`;
                html += `</div>`;
            }
        }

        if (friends.length === 0 && rivals.length === 0 && romanticInterests.length === 0 && !player.spouse && knownPeople.length === 0 && travelParty.length === 0) {
            html += '<p style="color: #aaa; font-size: 12px;">You haven\'t formed any meaningful relationships yet. Visit settlements and meet people!</p>';
        }

        // Dynasty info
        if (player.dynasty) {
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 8px;">';
            html += `<div style="font-size: 11px; color: #888;">Dynasty: <strong style="color: var(--gold);">${player.dynasty.name}</strong> · Prestige: ${player.dynasty.prestige || 0}</div>`;
            html += `<div style="font-size: 11px; color: #888;">Age: ${player.age} · Max lifespan: ~${player.maxLifespan}</div>`;
            html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('Relationships', html);

        window._divorceConfirm = () => {
            game.ui.hideCustomPanel();
            let confirmHtml = '<div>';
            confirmHtml += '<h4 style="margin-top: 0; color: #f66;">💔 Divorce</h4>';
            confirmHtml += '<p style="font-size: 12px;">Are you sure you want to end your marriage? This will cost you karma and renown.</p>';
            confirmHtml += `<button onclick="window._doDivorce()" style="width: 100%; padding: 10px; background: #a33; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: #fff; margin-bottom: 6px;">Yes, Divorce</button>`;
            confirmHtml += `<button onclick="game.ui.hideCustomPanel(); ActionMenu.showRelationshipsMenu(game, game.world.getTile(game.player.q, game.player.r));" style="width: 100%; padding: 8px; background: #555; border: none; border-radius: 4px; cursor: pointer; color: #ccc;">Cancel</button>`;
            confirmHtml += '</div>';
            game.ui.showCustomPanel('Confirm Divorce', confirmHtml);
        };

        window._doDivorce = () => {
            const result = Relationships.divorce(player, game.world);
            if (result.success) {
                const exName = result.exSpouse ? result.exSpouse.firstName : 'your spouse';
                game.ui.showNotification('💔 Divorced', `You and ${exName} have parted ways. -5 karma, -2 renown.`, 'warning');
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }
            game.ui.hideCustomPanel();
            game.ui.updateStats(player, game.world);
        };

        window._openKnownCharacter = (npcId) => {
            ActionMenu.showCharacterDataModal(game, tile, npcId, { returnTo: 'relationships' });
        };
    },

    _renderAffectionBar(affection) {
        const pct = Math.max(0, Math.min(100, affection));
        const color = pct >= 75 ? '#ff69b4' : pct >= 50 ? '#f0a' : pct >= 25 ? '#c80' : '#888';
        return `<div style="background: rgba(0,0,0,0.5); border-radius: 3px; height: 8px; width: 100%;">
            <div style="background: ${color}; height: 100%; width: ${pct}%; border-radius: 3px; transition: width 0.3s;"></div>
        </div>`;
    },

    _getRelationshipProgress(score) {
        const levels = (typeof Relationships !== 'undefined' && Relationships._getRelationshipLevels)
            ? Relationships._getRelationshipLevels()
            : [
                { id: 'stranger', label: 'Stranger', minScore: -100, icon: '👤' },
                { id: 'acquaintance', label: 'Acquaintance', minScore: 10, icon: '🤝' },
                { id: 'friend', label: 'Friend', minScore: 30, icon: '😊' },
                { id: 'close_friend', label: 'Close Friend', minScore: 60, icon: '💛' },
                { id: 'best_friend', label: 'Best Friend', minScore: 90, icon: '💜' },
            ];

        const sortedLevels = [...levels].sort((a, b) => (a.minScore ?? -100) - (b.minScore ?? -100));
        const currentLevel = (typeof Relationships !== 'undefined' && Relationships.getRelationshipLevel)
            ? Relationships.getRelationshipLevel(score)
            : sortedLevels[0];
        const nextLevel = sortedLevels.find(level => score < (level.minScore ?? -100));

        const startScore = currentLevel?.minScore ?? -100;
        const endScore = nextLevel?.minScore ?? 100;
        const range = Math.max(1, endScore - startScore);
        const pct = nextLevel
            ? Math.max(0, Math.min(100, ((score - startScore) / range) * 100))
            : 100;

        return {
            currentLevel,
            nextLevel,
            pct,
            remaining: nextLevel ? Math.max(0, (nextLevel.minScore ?? score) - score) : 0,
        };
    },

    _renderRelationshipXPBar(score, compact = false) {
        const progress = ActionMenu._getRelationshipProgress(score);
        const barHeight = compact ? 6 : 8;
        const marginTop = compact ? 4 : 6;
        const current = progress.currentLevel || { label: 'Stranger', icon: '👤' };

        let caption = '';
        if (progress.nextLevel) {
            caption = `${current.icon} ${current.label} → ${progress.nextLevel.icon} ${progress.nextLevel.label} (+${progress.remaining})`;
        } else {
            caption = `${current.icon} ${current.label} (Max)`;
        }

        return `
            <div style="margin-top: ${marginTop}px;">
                <div style="font-size: 10px; color: #999; margin-bottom: 2px;">${caption}</div>
                <div style="background: rgba(0,0,0,0.45); border-radius: 3px; height: ${barHeight}px; width: 100%;">
                    <div style="background: linear-gradient(90deg, #7f8c8d, #f1c40f); height: 100%; width: ${progress.pct}%; border-radius: 3px; transition: width 0.3s;"></div>
                </div>
            </div>
        `;
    },

    /**
     * Show dynasty management — view children, designate heir
     */
    showDynastyMenu(game, tile) {
        if (typeof Relationships === 'undefined') return;
        const player = game.player;
        const settings = Relationships._getHeirSettings();

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">👑 Dynasty & Heirs</h4>';

        // Dynasty info
        html += '<div style="background: rgba(255,215,0,0.1); padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid rgba(255,215,0,0.2);">';
        html += `<div style="font-weight: bold; color: var(--gold);">House ${player.dynasty?.name || player.name}</div>`;
        html += `<div style="font-size: 11px; color: #aaa;">Founded day ${player.dynasty?.founded || 1} · Prestige: ${player.dynasty?.prestige || 0}</div>`;
        html += `<div style="font-size: 11px; color: #aaa;">You: ${player.name}, age ${player.age} (max ~${player.maxLifespan})</div>`;
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) {
                html += `<div style="font-size: 11px; color: #ff69b4;">Spouse: ${spouse.firstName} ${spouse.dynasty}, age ${spouse.age}</div>`;
            }
        }
        html += '</div>';

        // Children
        if (!player.children || player.children.length === 0) {
            html += '<p style="color: #aaa; font-size: 12px;">You have no children yet. Get married and time will tell!</p>';
        } else {
            html += '<h5 style="margin: 4px 0;">Children</h5>';

            for (const child of player.children) {
                if (!child.isAlive) continue;
                const isHeir = player.heir === child.id;
                const eligible = child.age >= settings.minAgeToPlay;
                const genderIcon = child.gender === 'male' ? '♂️' : '♀️';
                const traitStr = child.traits?.length > 0
                    ? child.traits.map(t => `<span title="${t.name}">${t.icon}</span>`).join(' ')
                    : '<span style="color:#888;">No traits</span>';

                html += `<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin-bottom: 6px; ${isHeir ? 'border: 1px solid var(--gold);' : ''}">`;
                html += `<div style="display: flex; justify-content: space-between; align-items: start;">`;
                html += `<div>`;
                html += `<strong>${child.firstName} ${child.dynasty}</strong> ${genderIcon}`;
                if (isHeir) html += ` <span style="color: var(--gold);">👑 Designated Heir</span>`;
                html += `<div style="font-size: 11px; color: #aaa;">Age ${child.age} · ${child.culture}</div>`;
                html += `<div style="font-size: 11px; margin-top: 2px;">Traits: ${traitStr}</div>`;
                html += `</div>`;
                html += `</div>`;

                // Stats
                html += `<div style="display: flex; gap: 8px; font-size: 11px; margin-top: 6px; flex-wrap: wrap; color: #bbb;">`;
                html += `<span>💪 ${child.strength || 5}</span>`;
                html += `<span>✨ ${child.charisma || 5}</span>`;
                html += `<span>🧠 ${child.intelligence || 5}</span>`;
                html += `<span>🙏 ${child.faith || 5}</span>`;
                html += `<span>🍀 ${child.luck || 5}</span>`;
                html += `</div>`;

                // Skills
                const skillLabels = { combat: '⚔️', commerce: '💰', leadership: '👑', diplomacy: '🤝', stealth: '🥷', cartography: '🗺️' };
                const childSkills = child.skills || {};
                const hasSkills = Object.values(childSkills).some(v => v > 0);
                if (hasSkills) {
                    html += `<div style="display: flex; gap: 6px; font-size: 10px; margin-top: 3px; color: #999;">`;
                    for (const [sk, val] of Object.entries(childSkills)) {
                        if (val > 0) html += `<span>${skillLabels[sk] || sk} ${val}</span>`;
                    }
                    html += `</div>`;
                }

                // Actions
                html += `<div style="margin-top: 6px; display: flex; gap: 4px;">`;
                if (!isHeir) {
                    html += `<button onclick="window._designateHeir('${child.id}')" style="padding: 4px 10px; background: #664; border: none; border-radius: 3px; cursor: pointer; color: var(--gold); font-size: 11px;">👑 Designate Heir</button>`;
                }
                html += `</div>`;

                html += `</div>`;
            }
        }

        // Heir summary
        if (player.heir) {
            const heirChild = (player.children || []).find(c => c.id === player.heir);
            if (heirChild && heirChild.isAlive) {
                const eligible = heirChild.age >= settings.minAgeToPlay;
                html += `<div style="background: rgba(255,215,0,0.1); padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 12px;">`;
                html += `<div>Current heir: <strong style="color: var(--gold);">${heirChild.firstName}</strong> (age ${heirChild.age})</div>`;
                if (eligible) {
                    html += `<div style="color: #4a4;">✓ Eligible to succeed you</div>`;
                } else {
                    html += `<div style="color: #c80;">⏳ Must be ${settings.minAgeToPlay} to take over (currently ${heirChild.age})</div>`;
                }
                html += `<div style="color: #aaa; font-size: 11px; margin-top: 4px;">Inheritance: ${Math.round(settings.inheritanceGoldPercent * 100)}% gold, ${Math.round(settings.inheritanceRenownPercent * 100)}% renown</div>`;
                html += `</div>`;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('Dynasty', html);

        window._designateHeir = (childId) => {
            const result = Relationships.designateHeir(player, childId);
            if (result.success) {
                game.ui.showNotification('👑 New Heir', `${result.heir.firstName} is now your designated heir.`, 'success');
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }
            game.ui.hideCustomPanel();
            ActionMenu.showDynastyMenu(game, tile);
        };
    },

    /**
     * Show death / succession screen when the player dies
     */
    showDeathScreen(game, cause) {
        if (typeof Relationships === 'undefined') return;
        const player = game.player;
        const eligibleHeirs = Relationships.getEligibleHeirs(player);

        let html = '<div style="text-align: center;">';

        if (cause === 'starvation') {
            html += '<h3 style="color: #a33; margin-top: 0;">💀 Starvation</h3>';
            html += `<p style="font-size: 14px;">${player.name} has perished from starvation after ${player.starvationDays || '?'} days without food, at the age of ${player.age}.</p>`;
            html += '<p style="font-size: 12px; color: #aaa; font-style: italic;">"Even the mightiest lord cannot defy hunger forever."</p>';
        } else {
            html += '<h3 style="color: #a33; margin-top: 0;">💀 Death Comes for All</h3>';
            html += `<p style="font-size: 14px;">${player.name} has died at the age of ${player.age}.</p>`;
        }

        if (player.dynasty) {
            html += `<p style="font-size: 12px; color: var(--gold);">House ${player.dynasty.name} · Prestige: ${player.dynasty.prestige || 0}</p>`;
        }

        if (eligibleHeirs.length > 0) {
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0; padding-top: 10px;">';
            html += '<h4>Choose Your Heir</h4>';
            html += '<p style="font-size: 12px; color: #aaa;">Continue your dynasty by taking control of one of your children.</p>';

            for (const heir of eligibleHeirs) {
                const genderIcon = heir.gender === 'male' ? '♂️' : '♀️';
                const isDesignated = player.heir === heir.id;
                const traitStr = heir.traits?.length > 0
                    ? heir.traits.map(t => `${t.icon} ${t.name}`).join(', ')
                    : 'None';

                html += `<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin-bottom: 6px; ${isDesignated ? 'border: 1px solid var(--gold);' : ''}">`;
                html += `<strong>${heir.firstName} ${heir.dynasty}</strong> ${genderIcon} · Age ${heir.age}`;
                if (isDesignated) html += ` <span style="color: var(--gold);">👑 Designated</span>`;
                html += `<div style="font-size: 11px; color: #aaa;">STR ${heir.strength} · CHA ${heir.charisma} · INT ${heir.intelligence} · Traits: ${traitStr}</div>`;
                html += `<button onclick="window._succeedAsHeir('${heir.id}')" style="width: 100%; padding: 8px; margin-top: 6px; background: ${isDesignated ? 'var(--gold)' : '#555'}; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: ${isDesignated ? '#000' : '#ccc'};">Play as ${heir.firstName}</button>`;
                html += `</div>`;
            }

            html += '</div>';
        } else {
            // No heirs — game over
            html += '<div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0; padding-top: 10px;">';
            html += '<h4 style="color: #a33;">No Eligible Heirs</h4>';
            html += '<p style="font-size: 12px; color: #aaa;">Without an heir of age, your dynasty ends here.</p>';
            html += `<button onclick="location.reload();" style="width: 100%; padding: 12px; background: #a33; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: #fff; margin-top: 10px;">Start New Game</button>`;
            html += '</div>';
        }

        html += '</div>';
        game.ui.showCustomPanel('Death', html);

        window._succeedAsHeir = (childId) => {
            const result = Relationships.succeedAsHeir(player, childId, game.world);
            if (result.success) {
                game.ui.hideCustomPanel();

                let successHtml = '<div style="text-align: center;">';
                successHtml += '<h3 style="color: var(--gold); margin-top: 0;">👑 A New Chapter</h3>';
                successHtml += `<p style="font-size: 14px;">You are now <strong>${result.newName}</strong>, heir of ${result.oldName}.</p>`;
                successHtml += '<div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; margin: 10px 0; font-size: 12px; text-align: left;">';
                successHtml += `<div>Age: ${result.heir.age}</div>`;
                successHtml += `<div>Inherited ${player.gold} gold (${Math.round(Relationships._getHeirSettings().inheritanceGoldPercent * 100)}%)</div>`;
                successHtml += `<div>Dynasty prestige: ${player.dynasty?.prestige || 0}</div>`;
                successHtml += '</div>';
                successHtml += `<button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="width: 100%; padding: 12px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">Begin Your Story</button>`;
                successHtml += '</div>';

                game.ui.showCustomPanel('New Heir', successHtml);
                game.ui.updateStats(player, game.world);
            } else {
                game.ui.showNotification('Error', result.reason, 'error');
            }
        };
    },

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
            const condition = Math.max(0, Math.min(100, Number(ship.condition || 0)));
            const conditionColor = condition >= 70 ? '#5cb85c' : condition >= 40 ? '#f0ad4e' : '#d9534f';
            html += '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.02);">';
            html += `<div style="font-weight:bold;">${st.icon} ${ship.name}</div>`;
            html += `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;margin:6px 0 8px;">`;
            html += `<div style="width:${condition}%;height:100%;background:${conditionColor};"></div>`;
            html += '</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;font-size:11px;">';
            html += statPill('🔧', `${condition}%`);
            html += statPill('⚓', st.speed);
            html += statPill('📦', st.cargoCapacity);
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
            const result = Ships.buyUsedShip(player, tile.q, tile.r, index);
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
        html += statPill('⚓ Speed', st.speed);
        html += statPill('📦 Cargo', st.cargoCapacity);
        html += statPill('⚔️ Str', st.combatStrength);
        html += statPill('👥 Crew', st.crewRequired);
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

    _showMoveShipMenu(game, tile, shipId) {
        const player = game.player;
        const ship = Ships.getShipById(player, shipId);
        if (!ship) return;
        const st = Ships.getShipType(ship.typeId);
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
        html += `<div style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);">⚓ Speed ${st ? st.speed : 4}</div>`;
        html += '</div>';

        if (coastalDests.length === 0) {
            html += '<div style="padding:14px;border:1px dashed var(--border);border-radius:8px;text-align:center;font-size:12px;color:var(--text-secondary);">No reachable ports found.</div>';
        }
        for (const dest of coastalDests) {
            const dist = Hex.distance(tile.q, tile.r, dest.q, dest.r);
            const travelDays = Math.max(1, Math.ceil(dist / (st ? st.speed : 4)));
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
            html += statPill('⚓', st.speed);
            html += statPill('⚔️', st.combatStrength);
            html += statPill('📦', st.cargoCapacity);
            html += statPill('👥', st.crewRequired);
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
        
        const ship = Ships.getShipById(player, player.boardedShip);
        if (!ship) {
            game.ui.showNotification('Error', 'Ship not found.', 'error');
            return;
        }
        
        // Check if we're on land
        const tile = game.world.getTile(player.q, player.r);
        if (!tile.terrain.passable) {
            game.ui.showNotification('Cannot Disembark', 'You must be on land or a beach to disembark.', 'error');
            return;
        }
        
        // Disembark
        player.boardedShip = null;
        ship.status = 'docked';
        ship.q = player.q;
        ship.r = player.r;
        
        game.ui.showNotification('🚶', `You disembark from the ${ship.name} and return to dry land.`, 'success');
        game.ui.updateStats(player, game.world);
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
                game.camera.centerOn(player.q, player.r);
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

    // ════════════════════════════════════════════════════
    //  TITLE SYSTEM — Seek, View, Resign, Duty Actions
    // ════════════════════════════════════════════════════

    /**
     * Show the "Seek Royal Office" panel listing available titles
     */
    showSeekTitleMenu(game, tile) {
        const player = game.player;
        const world = game.world;

        if (typeof Titles === 'undefined') return;
        Titles.initialize(player);

        const kingdom = world.getKingdom(player.allegiance);
        const available = Titles.getAvailableTitles(player, tile, world);

        let html = `<div style="padding:10px;">
            <div style="text-align:center; margin-bottom:12px;">
                <span style="font-size:36px;">🏅</span>
                <div style="color:#ccc; font-size:12px; margin-top:4px;">Seek appointment to a political office in <span style="color:#ffd700;">${kingdom?.name || 'the realm'}</span></div>
            </div>`;

        if (available.length === 0) {
            html += `<div style="color:#888; text-align:center; padding:20px;">No titles available. Increase your reputation and renown.</div>`;
        } else {
            for (const t of available) {
                const reqColor = t.meetsRequirements ? '#4caf50' : '#ff6666';
                const reqText = t.meetsRequirements ? '✓ Qualified' : `✗ ${t.reason}`;
                html += `<div style="border:1px solid ${t.meetsRequirements ? '#4a6a4a' : '#4a3a3a'}; border-radius:8px; padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.02);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <span style="font-size:20px;">${t.icon || '🏅'}</span>
                            <span style="font-weight:bold; color:#ffd700; margin-left:6px;">${t.name}</span>
                            <span style="font-size:10px; color:#888; margin-left:6px;">Rank ${t.rank}</span>
                        </div>
                        <div style="font-size:11px; color:${reqColor};">${reqText}</div>
                    </div>
                    <div style="font-size:12px; color:#aaa; margin:6px 0;">${t.description}</div>
                    <div style="display:flex; gap:12px; font-size:11px; color:#888; margin-bottom:6px;">
                        <span>💰 ${t.salary} gold/day</span>
                        <span>📋 ${t.duties.type.replace(/_/g, ' ')}</span>
                    </div>`;

                if (t.meetsRequirements) {
                    html += `<button onclick="ActionMenu._appointTitle(game, '${t.id}')" style="
                        width:100%; padding:6px; margin-top:4px;
                        background:#2a4a2a; border:1px solid #4a6a4a; border-radius:4px;
                        color:#4caf50; cursor:pointer; font-size:12px;
                    ">Accept Appointment</button>`;
                } else {
                    // Show requirements
                    const reqs = t.requirements;
                    let reqList = [];
                    if (reqs.reputation) reqList.push(`Rep: ${reqs.reputation}`);
                    if (reqs.renown) reqList.push(`Renown: ${reqs.renown}`);
                    if (reqs.skills) for (const [s, v] of Object.entries(reqs.skills)) reqList.push(`${s}: ${v}`);
                    if (reqs.attributes) for (const [a, v] of Object.entries(reqs.attributes)) reqList.push(`${a}: ${v}`);
                    html += `<div style="font-size:10px; color:#666; margin-top:4px;">Requires: ${reqList.join(' · ')}</div>`;
                }

                html += `</div>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel();" style="
            width:100%; padding:8px; margin-top:6px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:13px;
        ">Close</button></div>`;

        game.ui.showCustomPanel('🏅 Royal Offices', html);
    },

    /**
     * Internal — appoint player to a title
     */
    _appointTitle(game, titleId) {
        const player = game.player;
        const world = game.world;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (typeof Titles === 'undefined') return;
        Titles.initialize(player);

        const result = Titles.appoint(player, titleId, world);
        if (!result.success) {
            game.ui.showNotification('❌ Cannot Accept', result.reason, 'error');
            game.ui.hideCustomPanel();
            return;
        }

        const title = result.title;
        const kingdom = world.getKingdom(player.allegiance);

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:48px;">${title.icon || '🏅'}</span>
            <h3 style="color:#ffd700;">Title Bestowed!</h3>
            <p style="color:#aaa;">You have been appointed <span style="color:#ffd700;">${title.name}</span> of <span style="color:#4fc3f7;">${kingdom?.name || 'the realm'}</span>.</p>
            <div style="background:#1a2a1a; padding:10px; border-radius:6px; margin:12px 0;">
                <div style="color:#4caf50;">💰 Daily salary: ${title.salary} gold</div>
                <div style="color:#4fc3f7; margin-top:4px;">📋 Duty: ${title.duties.type.replace(/_/g, ' ')}</div>
                <div style="color:#aaa; margin-top:4px; font-size:12px;">Complete your duties within ${title.duties.deadlineDays} days or face penalties!</div>
            </div>
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Accept Your Duties</button>
        </div>`;

        game.ui.showCustomPanel(`${title.icon || '🏅'} ${title.name}`, html);
    },

    /**
     * Show title status / duty progress panel
     */
    showTitleStatusPanel(game) {
        const player = game.player;
        if (typeof Titles === 'undefined' || !player.currentTitle) return;

        const progress = Titles.getDutyProgress(player);
        if (!progress) return;

        const title = progress.title;
        const kingdom = game.world.getKingdom(player.allegiance);
        const pct = progress.required > 0 ? Math.min(100, Math.round((progress.count / progress.required) * 100)) : 0;
        const barColor = progress.passed ? '#4caf50' : pct >= 50 ? '#ff9800' : '#f44336';

        let html = `<div style="padding:12px;">
            <div style="text-align:center; margin-bottom:12px;">
                <span style="font-size:36px;">${title.icon || '🏅'}</span>
                <div style="font-family:var(--font-display); font-size:18px; color:#ffd700;">${title.name}</div>
                <div style="font-size:12px; color:#888;">${kingdom?.name || 'the realm'}</div>
            </div>

            <div class="info-section-title">Duty Progress</div>
            <div style="margin:8px 0;">
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#aaa;">
                    <span>${progress.progress}</span>
                    <span>${pct}%</span>
                </div>
                <div style="width:100%; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; margin-top:4px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:4px; transition:width 0.3s;"></div>
                </div>
            </div>

            <div class="info-row">
                <span class="info-label">⏰ Days Left</span>
                <span class="info-value" style="color:${progress.daysLeft <= 5 ? '#f44336' : '#aaa'};">${progress.daysLeft}</span>
            </div>
            <div class="info-row">
                <span class="info-label">💰 Daily Salary</span>
                <span class="info-value" style="color:#ffd700;">${title.salary} gold</span>
            </div>
            <div class="info-row">
                <span class="info-label">📅 Appointed</span>
                <span class="info-value">Day ${player.titleAppointedDay || '?'}</span>
            </div>`;

        // Show active fugitive info for jailer
        if (player.currentTitle === 'jailer' && player.activeFugitive) {
            const fug = player.activeFugitive;
            html += `
                <div class="info-section-title">Active Bounty</div>
                <div style="border:1px solid #6a4a2a; border-radius:6px; padding:8px; background:rgba(255,150,0,0.05);">
                    <div style="font-weight:bold; color:#ff9800;">${fug.name}</div>
                    <div style="font-size:11px; color:#aaa;">${fug.crime || 'Wanted for crimes'}</div>
                    <div style="font-size:11px; color:#888; margin-top:4px;">
                        📍 Last seen: (${fug.q}, ${fug.r}) · ⏰ ${fug.daysRemaining} days left · ⚔️ Difficulty: ${fug.difficulty}
                    </div>
                </div>`;
        }

        // Perks
        html += `<div class="info-section-title" style="margin-top:10px;">Perks</div>`;
        for (const [key, val] of Object.entries(title.perks)) {
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
            const display = typeof val === 'object' ? `${val.min}-${val.max}` : val;
            html += `<div class="info-row"><span class="info-label" style="font-size:11px;">${label}</span><span class="info-value" style="font-size:11px;">${display}</span></div>`;
        }

        // Resign button
        html += `<div style="margin-top:12px; display:flex; gap:8px;">
            <button onclick="game.ui.hideCustomPanel();" style="
                flex:1; padding:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:13px;
            ">Close</button>
            <button onclick="ActionMenu._resignTitle(game);" style="
                flex:1; padding:8px;
                background:#4a2a2a; border:1px solid #6a3a3a; border-radius:6px;
                color:#ff6666; cursor:pointer; font-size:13px;
            ">Resign Office</button>
        </div></div>`;

        game.ui.showCustomPanel(`${title.icon || '🏅'} ${title.name}`, html);
    },

    /**
     * Internal — resign from title
     */
    _resignTitle(game) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.resign(player, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ Error', result.reason, 'error');
            return;
        }

        game.ui.hideCustomPanel();
        game.ui.showNotification('🏅 Title Resigned',
            `You have resigned from the office of ${result.name}. Your reputation has decreased.`, 'warning');
        game.ui.updateStats(player, game.world);
    },

    /**
     * Tax Collector — collect taxes at settlement
     */
    doCollectTax(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.collectTaxAtSettlement(player, tile, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ Cannot Collect', result.reason, 'error');
            return;
        }

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">💰</span>
            <h3 style="color:#ffd700;">Taxes Collected!</h3>
            <p style="color:#aaa;">You collected <span style="color:#ffd700;">${result.gold} gold</span> in taxes from <span style="color:#4fc3f7;">${result.settlement}</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#4caf50;">Settlements this month: ${result.count}</div>
            </div>
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Continue</button>
        </div>`;

        game.ui.showCustomPanel('📜 Tax Collection', html);
    },

    /**
     * Jailer — request a bounty target
     */
    doRequestBounty(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.spawnFugitive(player, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ No Bounty', result.reason, 'error');
            return;
        }

        const fug = result.fugitive;
        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">🔍</span>
            <h3 style="color:#ff9800;">Bounty Assigned!</h3>
            <div style="border:1px solid #6a4a2a; border-radius:8px; padding:12px; margin:10px 0; background:rgba(255,150,0,0.05);">
                <div style="font-size:18px; font-weight:bold; color:#ffd700;">${fug.name}</div>
                <div style="font-size:12px; color:#ff6666; margin:4px 0;">${fug.crime || 'Wanted for crimes against the realm'}</div>
                <div style="font-size:12px; color:#aaa;">${fug.description || ''}</div>
                <div style="display:flex; justify-content:center; gap:16px; margin-top:8px; font-size:12px;">
                    <span style="color:#888;">⚔️ Difficulty: ${fug.difficulty}</span>
                    <span style="color:#888;">⏰ ${fug.daysRemaining} days</span>
                    <span style="color:#888;">📍 Last seen: (${fug.q}, ${fug.r})</span>
                </div>
            </div>
            <p style="color:#aaa; font-size:12px;">Travel to the fugitive's location and capture them before time runs out!</p>
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Begin the Hunt</button>
        </div>`;

        game.ui.showCustomPanel('🔒 Jailer\'s Bounty', html);
    },

    /**
     * Jailer — attempt to capture fugitive
     */
    doCaptureFugitive(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.captureFugitive(player, game.world);
        let html;

        if (result.success) {
            html = `<div style="padding:15px; text-align:center;">
                <span style="font-size:42px;">⛓️</span>
                <h3 style="color:#4caf50;">Fugitive Captured!</h3>
                <p style="color:#aaa;">You have captured <span style="color:#ffd700;">${result.fugitive.name}</span>!</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#ffd700;">💰 Bounty: ${result.gold} gold</div>
                    <div style="color:#4caf50;">Total captures: ${result.captureCount}</div>
                </div>
                <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                    width:100%; padding:10px; margin-top:8px;
                    background:#444; border:1px solid #666; border-radius:6px;
                    color:#eee; cursor:pointer; font-size:14px;
                ">Continue</button>
            </div>`;
        } else if (result.escaped) {
            html = `<div style="padding:15px; text-align:center;">
                <span style="font-size:42px;">💨</span>
                <h3 style="color:#ff9800;">Fugitive Escaped!</h3>
                <p style="color:#aaa;">${result.reason}</p>
                <button onclick="game.ui.hideCustomPanel();" style="
                    width:100%; padding:10px; margin-top:8px;
                    background:#444; border:1px solid #666; border-radius:6px;
                    color:#eee; cursor:pointer; font-size:14px;
                ">Continue Pursuit</button>
            </div>`;
        } else {
            game.ui.showNotification('❌ Cannot Capture', result.reason, 'error');
            return;
        }

        game.ui.showCustomPanel('🔒 Fugitive Hunt', html);
    },

    /**
     * Court Chaplain — bless a settlement
     */
    doBlessSettlement(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.blessSettlement(player, tile, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ Cannot Bless', result.reason, 'error');
            return;
        }

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">✨</span>
            <h3 style="color:#9c27b0;">Settlement Blessed!</h3>
            <p style="color:#aaa;">You have given a holy blessing to <span style="color:#4fc3f7;">${result.settlement}</span>.</p>
            <div style="background:#1a1a2a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#9c27b0;">☯ Karma +2</div>
                <div style="color:#4fc3f7;">⭐ Renown +1</div>
                <div style="color:#4caf50;">Settlements blessed: ${result.count}</div>
            </div>
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Continue</button>
        </div>`;

        game.ui.showCustomPanel('✨ Holy Blessing', html);
    },

    /**
     * Chancellor — hold council
     */
    doHoldCouncil(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.holdCouncil(player, tile, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ Cannot Hold Council', result.reason, 'error');
            return;
        }

        let councilResult = null;
        if (typeof Councils !== 'undefined') {
            Councils.initializePlayer(player);
            councilResult = Councils.conveneCouncil(player, game.world);
            if (!councilResult.success) {
                game.ui.showNotification('Council Chamber', councilResult.reason, 'warning');
            }
        }

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">👑</span>
            <h3 style="color:#ffd700;">Council Held!</h3>
            <p style="color:#aaa;">You convened the royal council at <span style="color:#4fc3f7;">${result.settlement}</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#ffd700;">⭐ Renown +5</div>
                <div style="color:#4caf50;">📈 Reputation +3</div>
                ${councilResult && councilResult.success ? `<div style="color:#4fc3f7;">🗳️ Session active until day ${councilResult.sessionUntilDay}</div>` : ''}
            </div>
            <p style="color:#888; font-size:12px; font-style:italic;">The lords and ladies of the realm attended your council. Your authority is recognized.</p>
            ${typeof Councils !== 'undefined' ? `<button onclick="ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r))" style="
                width:100%; padding:10px; margin-top:8px;
                background:#1f4d7a; border:1px solid #357ab8; border-radius:6px;
                color:#fff; cursor:pointer; font-size:14px;
            ">Open Council Chamber</button>` : ''}
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Continue</button>
        </div>`;

        game.ui.showCustomPanel('👑 Royal Council', html);
    },

    /**
     * Show council & parliament chamber
     */
    showCouncilMenu(game, tile) {
        if (typeof Councils === 'undefined') {
            game.ui.showNotification('Unavailable', 'Council system not loaded.', 'error');
            return;
        }

        const player = game.player;
        Councils.initializePlayer(player);
        const summary = Councils.getSummary(player, game.world);

        if (!summary.canGovern) {
            game.ui.showCustomPanel('🏛️ Council Chamber', `
                <div style="padding:15px; color:#ccc;">
                    <p style="margin-top:0;">You need political authority to govern the realm.</p>
                    <div style="background:#2a1f1f; border:1px solid #5c3b3b; border-radius:6px; padding:10px; color:#ffb3b3;">
                        Required office: <strong>King, Chancellor, or Treasurer</strong> while pledged to a kingdom.
                    </div>
                </div>
            `);
            return;
        }

        const day = game.world.day;
        const canConveneIn = Math.max(0, (summary.lastConveneDay + Councils.CONVENE_COOLDOWN_DAYS) - day);
        const sessionText = summary.sessionActive
            ? `In session until day ${summary.activeSessionUntilDay}`
            : 'No active session';

        let html = '<div style="max-height:540px; overflow-y:auto; padding:12px;">';
        html += `<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:10px;">
            <div style="background:#1a2a1a; border:1px solid #2f6f3f; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:11px; color:#8bc34a;">Approval</div>
                <div style="font-size:20px; color:#c8e6c9;">${summary.approval}%</div>
            </div>
            <div style="background:#1a1f2a; border:1px solid #2f4f7f; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:11px; color:#64b5f6;">Session</div>
                <div style="font-size:12px; color:#bbdefb; margin-top:4px;">${sessionText}</div>
            </div>
            <div style="background:#2a2116; border:1px solid #7a5a2b; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:11px; color:#ffcc80;">War Mandate</div>
                <div style="font-size:12px; color:#ffe0b2; margin-top:4px;">${summary.warMandateUntilDay >= day ? `Active to day ${summary.warMandateUntilDay}` : 'None'}</div>
            </div>
        </div>`;

        html += `<button onclick="ActionMenu.councilConvene(game)" style="width:100%; margin-bottom:10px; padding:10px; border-radius:6px; border:1px solid #3f6ca5; background:#244b78; color:#fff; cursor:pointer;">
            🏛️ Convene Council ${canConveneIn > 0 ? `(available in ${canConveneIn}d)` : ''}
        </button>`;

        html += '<div style="font-weight:bold; color:#ddd; margin:6px 0;">Factions</div>';
        for (const faction of summary.factions) {
            html += `<div style="background:#1a1a1a; border:1px solid #333; border-radius:6px; padding:8px; margin-bottom:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <div style="color:#eee;">${faction.icon} ${faction.name}</div>
                    <div style="font-size:11px; color:#aaa;">Support ${faction.support}% • Influence ${faction.influence}</div>
                </div>
                <div style="height:6px; background:#333; border-radius:3px; overflow:hidden; margin-bottom:6px;">
                    <div style="height:100%; width:${Math.max(0, Math.min(100, faction.support))}%; background:${faction.support >= 55 ? '#4caf50' : faction.support >= 40 ? '#ffb74d' : '#ef5350'};"></div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button onclick="ActionMenu.councilManageFaction(game, '${faction.id}', 'manage')" style="flex:1; padding:7px; border-radius:4px; border:1px solid #456a4a; background:#1e3a22; color:#dcedc8; cursor:pointer;">🤝 Manage (80g)</button>
                    <button onclick="ActionMenu.councilManageFaction(game, '${faction.id}', 'suppress')" style="flex:1; padding:7px; border-radius:4px; border:1px solid #7a3b3b; background:#3a1f1f; color:#ffcdd2; cursor:pointer;">🛡️ Suppress</button>
                </div>
                ${faction.suppressed ? `<div style="margin-top:5px; font-size:11px; color:#ffb3b3;">Suppressed until day ${faction.suppressedUntilDay}</div>` : ''}
            </div>`;
        }

        html += '<div style="font-weight:bold; color:#ddd; margin:10px 0 6px;">Votes & Decrees</div>';

        if (typeof Taxation !== 'undefined' && Taxation.TAX_RATES) {
            const currentPolicy = Taxation.TAX_RATES[(player.taxRate || 'moderate').toUpperCase()] || Taxation.TAX_RATES.MODERATE;
            const higherRates = Object.values(Taxation.TAX_RATES).filter(rate => rate.rate > currentPolicy.rate).sort((a, b) => a.rate - b.rate);
            html += '<div style="margin-bottom:8px; color:#bbb; font-size:12px;">Tax Increase Votes</div>';
            if (higherRates.length === 0) {
                html += '<div style="font-size:11px; color:#999; margin-bottom:8px;">Tax rate is already at maximum.</div>';
            } else {
                for (const rate of higherRates) {
                    html += `<button onclick="ActionMenu.councilVoteTax(game, '${rate.id}')" style="width:100%; margin-bottom:6px; padding:8px; border-radius:4px; border:1px solid #755b2a; background:#3a2e18; color:#ffe0b2; cursor:pointer;">🗳️ Vote for ${rate.name}</button>`;
                }
            }
            if (summary.taxIncreaseApproval && summary.taxIncreaseApproval.expiresDay >= day) {
                html += `<div style="font-size:11px; color:#9ad1ff; margin:4px 0 8px;">Approved tax increase up to <strong>${summary.taxIncreaseApproval.rateId}</strong> until day ${summary.taxIncreaseApproval.expiresDay}.</div>`;
            }
        }

        const targets = Councils.getAvailableWarTargets(player, game.world);
        html += '<div style="margin-top:6px; margin-bottom:8px; color:#bbb; font-size:12px;">War Motions</div>';
        if (!summary.canDeclareWar) {
            html += '<div style="font-size:11px; color:#999;">Only King or Chancellor can initiate war votes.</div>';
        } else if (!targets.length) {
            html += '<div style="font-size:11px; color:#999;">No valid war targets at this time.</div>';
        } else {
            for (const target of targets) {
                const hasMandate = Councils.hasWarMandate(player, game.world, target.id);
                html += `<div style="display:flex; gap:6px; margin-bottom:6px;">
                    <button onclick="ActionMenu.councilVoteWar(game, '${target.id}')" style="flex:1; padding:8px; border-radius:4px; border:1px solid #7d4f2b; background:#3d2618; color:#ffccbc; cursor:pointer;">🗳️ Vote War: ${target.name}</button>
                    <button onclick="ActionMenu.councilDeclareWar(game, '${target.id}')" style="padding:8px 10px; border-radius:4px; border:1px solid ${hasMandate ? '#8b2d2d' : '#555'}; background:${hasMandate ? '#4a1e1e' : '#222'}; color:${hasMandate ? '#ffcdd2' : '#888'}; cursor:${hasMandate ? 'pointer' : 'not-allowed'};" ${hasMandate ? '' : 'disabled'}>⚔️ Declare</button>
                </div>`;
            }
        }

        if (summary.history && summary.history.length) {
            html += '<div style="font-weight:bold; color:#ddd; margin:10px 0 6px;">Recent Proceedings</div>';
            for (const item of summary.history.slice(0, 5)) {
                html += `<div style="font-size:11px; color:${item.passed ? '#9ccc65' : '#ef9a9a'}; margin-bottom:4px;">Day ${item.day}: ${item.text}</div>`;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('🏛️ Council Chamber', html);
    },

    councilConvene(game) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.conveneCouncil(game.player, game.world);
        if (result.success) {
            game.ui.showNotification('Council Convened', `Session active until day ${result.sessionUntilDay}. Approval +${result.approvalGain}.`, 'success');
        } else {
            game.ui.showNotification('Council Chamber', result.reason, 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    councilVoteTax(game, rateId) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.callVote(game.player, game.world, 'tax_increase', { newRate: rateId });
        if (!result.success) {
            game.ui.showNotification('Vote Failed', result.reason, 'error');
        } else {
            game.ui.showNotification(result.passed ? 'Tax Motion Passed' : 'Tax Motion Rejected', result.summaryText, result.passed ? 'success' : 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    councilVoteWar(game, targetKingdomId) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.callVote(game.player, game.world, 'war_declaration', { targetKingdomId });
        if (!result.success) {
            game.ui.showNotification('Vote Failed', result.reason, 'error');
        } else {
            game.ui.showNotification(result.passed ? 'War Mandate Passed' : 'War Mandate Rejected', result.summaryText, result.passed ? 'success' : 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    councilDeclareWar(game, targetKingdomId) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.declareWar(game.player, game.world, targetKingdomId);
        if (!result.success) {
            game.ui.showNotification('Declaration Blocked', result.reason, 'error');
        } else {
            game.ui.showNotification('⚔️ War Declared', `${result.kingdom} is now at war with ${result.target}.`, 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    councilManageFaction(game, factionId, mode) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.manageFaction(game.player, game.world, factionId, mode);
        if (!result.success) {
            game.ui.showNotification('Faction Action Failed', result.reason, 'error');
        } else {
            const actionName = mode === 'manage' ? 'Negotiation' : 'Suppression';
            game.ui.showNotification(actionName, `${result.faction}: support ${result.support}% • approval ${result.approval}%`, mode === 'manage' ? 'success' : 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Close action menu
     */
    close() {
        const menu = document.getElementById('actionMenu');
        if (menu) menu.remove();
        const tooltip = document.getElementById('actionTooltip');
        if (tooltip) tooltip.remove();
    },

    // ═══════════════════════════════════════════════════
    //  ESPIONAGE UI
    // ═══════════════════════════════════════════════════

    /**
     * Show the main espionage hub — recruit spies, assign missions
     */
    showEspionageMenu(game, tile) {
        if (typeof Espionage === 'undefined') return;
        Espionage.initPlayer(game.player);

        const summary = Espionage.getMissionSummary(game.player);
        const config = Espionage._getConfig();

        let html = '<div style="max-height:520px; overflow-y:auto;">';
        html += '<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:14px;">Your shadow network operates from the tavern back rooms. Recruit agents and assign them to covert missions.</p>';

        // ── Summary Bar ──
        html += `<div style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
            <div style="flex:1; min-width:80px; background:rgba(155,89,182,0.12); border:1px solid rgba(155,89,182,0.3); border-radius:4px; padding:8px; text-align:center;">
                <div style="font-size:18px;">🕵️</div>
                <div style="font-size:11px; color:#9b59b6;">${summary.totalSpies}/${config.maxSpies} Spies</div>
            </div>
            <div style="flex:1; min-width:80px; background:rgba(52,152,219,0.12); border:1px solid rgba(52,152,219,0.3); border-radius:4px; padding:8px; text-align:center;">
                <div style="font-size:18px;">📋</div>
                <div style="font-size:11px; color:#3498db;">${summary.activeMissions}/${config.maxActiveMissions} Missions</div>
            </div>
            <div style="flex:1; min-width:80px; background:rgba(241,196,15,0.12); border:1px solid rgba(241,196,15,0.3); border-radius:4px; padding:8px; text-align:center;">
                <div style="font-size:18px;">💰</div>
                <div style="font-size:11px; color:#f1c40f;">${summary.dailyUpkeep}g/day</div>
            </div>
            <div style="flex:1; min-width:80px; background:rgba(46,204,113,0.12); border:1px solid rgba(46,204,113,0.3); border-radius:4px; padding:8px; text-align:center;">
                <div style="font-size:18px;">✅</div>
                <div style="font-size:11px; color:#2ecc71;">${summary.completedMissions} Done</div>
            </div>
        </div>`;

        // ── Active Rebellions ──
        if (game.player.espionage.rebellions.length > 0) {
            html += '<div style="margin-bottom:12px; padding:8px; background:rgba(231,76,60,0.1); border:1px solid rgba(231,76,60,0.3); border-radius:4px;">';
            html += '<div style="font-weight:bold; font-size:12px; color:#e74c3c; margin-bottom:4px;">🔥 Active Rebellions</div>';
            for (const reb of game.player.espionage.rebellions) {
                const kingdom = game.world.getKingdom(reb.kingdomId);
                html += `<div style="font-size:11px; color:var(--text-secondary);">
                    ${kingdom ? kingdom.name : reb.kingdomId} — ${reb.severity} (${reb.daysRemaining || reb.duration}d remaining)
                </div>`;
            }
            html += '</div>';
        }

        // ── Menu Buttons ──
        const menuOptions = [
            { id: 'recruit', icon: '🎯', label: 'Recruit New Spy', desc: `Hire an agent (${config.baseRecruitCost}+ gold)`, available: summary.totalSpies < config.maxSpies },
            { id: 'roster', icon: '📜', label: 'Spy Roster', desc: `View and manage your ${summary.totalSpies} agents`, available: summary.totalSpies > 0 },
            { id: 'assign', icon: '📋', label: 'Assign Mission', desc: `Send a spy on a covert operation`, available: summary.idleSpies > 0 },
            { id: 'missions', icon: '⏳', label: 'Active Missions', desc: `${summary.activeMissions} mission(s) in progress`, available: summary.activeMissions > 0 },
        ];

        for (const opt of menuOptions) {
            html += `<button onclick="window._espionageAction('${opt.id}')"
                ${!opt.available ? 'disabled' : ''}
                style="display:flex; align-items:center; gap:10px; width:100%;
                    padding:12px; margin-bottom:8px;
                    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                    border-radius:4px; cursor:${opt.available ? 'pointer' : 'default'};
                    text-align:left; color:${opt.available ? 'white' : '#666'};
                    font-family:var(--font-body); transition:all 0.2s;"
                onmouseover="if(!this.disabled){this.style.background='rgba(155,89,182,0.15)'; this.style.borderColor='#9b59b6'}"
                onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                <span style="font-size:22px;">${opt.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:13px;">${opt.label}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${opt.desc}</div>
                </div>
            </button>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('🕵️ Espionage Network', html);

        window._espionageAction = (action) => {
            switch (action) {
                case 'recruit': ActionMenu._showSpyRecruitMenu(game, tile); break;
                case 'roster': ActionMenu.showManageSpiesMenu(game, tile); break;
                case 'assign': ActionMenu._showAssignMissionMenu(game, tile); break;
                case 'missions': ActionMenu._showActiveMissionsMenu(game, tile); break;
            }
        };
    },

    /**
     * Show spy recruitment candidates
     */
    _showSpyRecruitMenu(game, tile) {
        const candidates = Espionage.getRecruitCandidates(game.player, game.world);
        const spySkills = Espionage._getData()?.spySkills || {};
        const traits = Espionage._getSpyTraits();

        let html = '<div style="max-height:480px; overflow-y:auto;">';
        html += '<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Shadowy figures in the tavern are willing to work for you — for the right price.</p>';

        for (const spy of candidates) {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            const traitLabels = (spy.traits || []).map(tid => {
                const t = traits.find(tr => tr.id === tid);
                return t ? `<span title="${t.description}" style="cursor:help;">${t.icon} ${t.name}</span>` : tid;
            }).join(', ');

            html += `<div style="padding:12px; margin-bottom:10px; background:rgba(255,255,255,0.04);
                border:1px solid rgba(155,89,182,0.25); border-radius:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <div>
                        <span style="font-weight:bold; font-size:14px; color:white;">${spy.name}</span>
                        <span style="font-size:11px; color:#9b59b6; margin-left:6px;">${levelTitle.icon} ${levelTitle.title}</span>
                    </div>
                    <span style="font-weight:bold; color:var(--gold); font-size:13px;">${spy.recruitCost}g</span>
                </div>

                <div style="display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                    ${Object.entries(spy.skills).map(([k, v]) => {
                        const sk = spySkills[k] || {};
                        return `<span style="font-size:10px; padding:2px 6px; background:rgba(255,255,255,0.08); border-radius:3px; color:var(--text-secondary);">${sk.icon || '⬤'} ${sk.name || k}: ${v}</span>`;
                    }).join('')}
                </div>

                <div style="font-size:11px; color:var(--text-secondary); margin-bottom:6px;">Traits: ${traitLabels || 'None'}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-bottom:8px;">🔄 Upkeep: ${spy.upkeep}g/day &nbsp; ❤️ Loyalty: ${Math.floor(spy.loyalty)}%</div>

                <button onclick="window._recruitSpy(${spy.id})"
                    ${game.player.gold < spy.recruitCost ? 'disabled' : ''}
                    style="width:100%; padding:8px; background:rgba(155,89,182,0.25); border:1px solid rgba(155,89,182,0.5);
                    border-radius:4px; cursor:${game.player.gold >= spy.recruitCost ? 'pointer' : 'default'};
                    color:${game.player.gold >= spy.recruitCost ? 'white' : '#666'}; font-family:var(--font-body); font-weight:bold;">
                    ${game.player.gold >= spy.recruitCost ? '🎯 Recruit' : '❌ Not Enough Gold'}
                </button>
            </div>`;
        }

        html += `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back</button>`;
        html += '</div>';

        game.ui.showCustomPanel('🎯 Recruit Spy', html);

        window._espGame = game;
        window._espTile = tile;
        window._recruitSpy = (spyId) => {
            const spy = candidates.find(c => c.id === spyId);
            if (!spy) return;
            const result = Espionage.recruitSpy(game.player, spy, game.world);
            if (result.success) {
                game.ui.showNotification('🕵️ Spy Recruited!', `${spy.name} has joined your network. (-${result.cost}g)`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showEspionageMenu(game, tile);
            } else {
                game.ui.showNotification('❌ Recruitment Failed', result.reason, 'error');
            }
        };
    },

    /**
     * Show spy roster and management
     */
    showManageSpiesMenu(game, tile) {
        if (typeof Espionage === 'undefined') return;
        Espionage.initPlayer(game.player);

        const spies = game.player.espionage.spies;
        const spySkills = Espionage._getData()?.spySkills || {};
        const traits = Espionage._getSpyTraits();

        let html = '<div style="max-height:480px; overflow-y:auto;">';

        if (spies.length === 0) {
            html += '<p style="color:var(--text-secondary); text-align:center; padding:20px;">No spies recruited yet. Visit a city tavern to recruit agents.</p>';
        }

        for (const spy of spies) {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            const config = Espionage._getConfig();
            const xpNeeded = spy.level * config.levelUpThreshold;
            const xpPct = Math.min(100, Math.floor((spy.experience / xpNeeded) * 100));

            const statusColors = { idle: '#2ecc71', on_mission: '#3498db', captured: '#e74c3c', dead: '#666' };
            const statusLabels = { idle: '✅ Idle', on_mission: '📋 On Mission', captured: '🔒 Captured', dead: '💀 Dead' };

            const traitLabels = (spy.traits || []).map(tid => {
                const t = traits.find(tr => tr.id === tid);
                return t ? `<span title="${t.description}" style="cursor:help;">${t.icon} ${t.name}</span>` : tid;
            }).join(', ');

            // Find active mission if on one
            let missionInfo = '';
            if (spy.status === 'on_mission') {
                const mission = game.player.espionage.activeMissions.find(m => m.spyId === spy.id);
                if (mission) {
                    const mDef = Espionage._getMissions()[mission.type];
                    const pct = Math.floor((mission.progress / mission.duration) * 100);
                    const kingdom = game.world.getKingdom(mission.targetKingdom);
                    missionInfo = `<div style="margin-top:6px; padding:6px; background:rgba(52,152,219,0.1); border-radius:3px; font-size:11px;">
                        ${mDef ? mDef.icon : '📋'} ${mDef ? mDef.name : mission.type} → ${kingdom ? kingdom.name : '?'}
                        <div style="margin-top:4px; background:#333; border-radius:2px; height:6px;">
                            <div style="width:${pct}%; background:#3498db; height:100%; border-radius:2px;"></div>
                        </div>
                        <span style="color:#3498db;">${pct}% (${mission.duration - mission.progress}d left)</span>
                    </div>`;
                }
            }

            html += `<div style="padding:12px; margin-bottom:10px; background:rgba(255,255,255,0.04);
                border-left:3px solid ${statusColors[spy.status] || '#666'}; border-radius:0 6px 6px 0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div>
                        <span style="font-weight:bold; font-size:14px; color:white;">${spy.name}</span>
                        <span style="font-size:11px; color:#9b59b6; margin-left:6px;">${levelTitle.icon} Lv${spy.level}</span>
                    </div>
                    <span style="font-size:11px; color:${statusColors[spy.status] || '#666'};">${statusLabels[spy.status] || spy.status}</span>
                </div>

                <div style="display:flex; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
                    ${Object.entries(spy.skills).map(([k, v]) => {
                        const sk = spySkills[k] || {};
                        return `<span style="font-size:10px; padding:2px 6px; background:rgba(255,255,255,0.08); border-radius:3px; color:var(--text-secondary);">${sk.icon || '⬤'} ${v}</span>`;
                    }).join('')}
                </div>

                <div style="font-size:11px; color:var(--text-secondary);">Traits: ${traitLabels || 'None'}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
                    ❤️ Loyalty: <span style="color:${spy.loyalty > 50 ? '#2ecc71' : spy.loyalty > 25 ? '#f39c12' : '#e74c3c'};">${Math.floor(spy.loyalty)}%</span>
                    &nbsp; 💰 ${spy.upkeep}g/day &nbsp; ⭐ ${spy.missionsCompleted} missions
                </div>

                <!-- XP Bar -->
                <div style="margin-top:4px; font-size:10px; color:var(--text-secondary);">
                    XP: ${spy.experience}/${xpNeeded}
                    <div style="background:#333; border-radius:2px; height:4px; margin-top:2px;">
                        <div style="width:${xpPct}%; background:#9b59b6; height:100%; border-radius:2px;"></div>
                    </div>
                </div>

                ${missionInfo}

                <div style="display:flex; gap:6px; margin-top:8px;">
                    ${spy.status === 'idle' ? `
                        <button onclick="window._assignSpyMission(${spy.id})" style="flex:1; padding:6px; background:rgba(52,152,219,0.2); border:1px solid rgba(52,152,219,0.4); border-radius:3px; color:#3498db; cursor:pointer; font-size:11px; font-family:var(--font-body);">📋 Assign Mission</button>
                        <button onclick="window._dismissSpy(${spy.id})" style="padding:6px 10px; background:rgba(231,76,60,0.15); border:1px solid rgba(231,76,60,0.3); border-radius:3px; color:#e74c3c; cursor:pointer; font-size:11px; font-family:var(--font-body);">🗑️</button>
                    ` : spy.status === 'on_mission' ? `
                        <button onclick="window._recallSpy(${spy.id})" style="flex:1; padding:6px; background:rgba(241,196,15,0.15); border:1px solid rgba(241,196,15,0.3); border-radius:3px; color:#f1c40f; cursor:pointer; font-size:11px; font-family:var(--font-body);">↩️ Recall Spy</button>
                    ` : ''}
                </div>
            </div>`;
        }

        html += `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back</button>`;
        html += '</div>';

        game.ui.showCustomPanel('📜 Spy Roster', html);

        window._espGame = game;
        window._espTile = tile;

        window._assignSpyMission = (spyId) => {
            ActionMenu._showAssignMissionForSpy(game, tile, spyId);
        };

        window._dismissSpy = (spyId) => {
            const result = Espionage.dismissSpy(game.player, spyId);
            if (result.success) {
                game.ui.showNotification('🕵️ Spy Dismissed', `${result.spy.name} has been released from service.`, 'info');
                ActionMenu.showManageSpiesMenu(game, tile);
            } else {
                game.ui.showNotification('❌ Cannot Dismiss', result.reason, 'error');
            }
        };

        window._recallSpy = (spyId) => {
            const result = Espionage.recallSpy(game.player, spyId);
            if (result.success) {
                game.ui.showNotification('↩️ Spy Recalled', `${result.spy.name} has been recalled. Loyalty: -5.`, 'warning');
                ActionMenu.showManageSpiesMenu(game, tile);
            } else {
                game.ui.showNotification('❌ Cannot Recall', result.reason, 'error');
            }
        };
    },

    /**
     * Show mission assignment — select a spy first
     */
    _showAssignMissionMenu(game, tile) {
        Espionage.initPlayer(game.player);
        const idleSpies = game.player.espionage.spies.filter(s => s.status === 'idle');

        let html = '<div style="max-height:450px; overflow-y:auto;">';
        html += '<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Select an agent to send on a mission.</p>';

        for (const spy of idleSpies) {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            html += `<button onclick="window._selectSpyForMission(${spy.id})"
                style="display:flex; align-items:center; gap:10px; width:100%;
                    padding:12px; margin-bottom:8px;
                    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                    border-radius:4px; cursor:pointer; text-align:left; color:white;
                    font-family:var(--font-body); transition:all 0.2s;"
                onmouseover="this.style.background='rgba(155,89,182,0.15)'; this.style.borderColor='#9b59b6'"
                onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                <span style="font-size:22px;">🕵️</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:13px;">${spy.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${levelTitle.icon} Level ${spy.level} • ❤️ ${Math.floor(spy.loyalty)}%</div>
                </div>
            </button>`;
        }

        html += `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back</button>`;
        html += '</div>';

        game.ui.showCustomPanel('📋 Select Agent', html);

        window._espGame = game;
        window._espTile = tile;
        window._selectSpyForMission = (spyId) => {
            ActionMenu._showAssignMissionForSpy(game, tile, spyId);
        };
    },

    /**
     * Show available missions for a specific spy
     */
    _showAssignMissionForSpy(game, tile, spyId) {
        const spy = Espionage.getSpyById(game.player, spyId);
        if (!spy) return;

        const missions = Espionage.getAvailableMissions(spy);

        let html = '<div style="max-height:480px; overflow-y:auto;">';
        html += `<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Assign <strong style="color:white;">${spy.name}</strong> (Level ${spy.level}) to a mission.</p>`;

        for (const mission of missions) {
            const locked = !mission.unlocked;
            html += `<button onclick="${locked ? '' : `window._selectMissionTarget('${mission.id}', ${spyId})`}"
                ${locked ? 'disabled' : ''}
                style="display:flex; align-items:center; gap:10px; width:100%;
                    padding:12px; margin-bottom:8px;
                    background:rgba(255,255,255,0.05); border:1px solid ${locked ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)'};
                    border-radius:4px; cursor:${locked ? 'default' : 'pointer'};
                    text-align:left; color:${locked ? '#666' : 'white'};
                    font-family:var(--font-body); transition:all 0.2s;"
                ${locked ? '' : `onmouseover="this.style.background='rgba(155,89,182,0.15)'; this.style.borderColor='#9b59b6'"
                onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'"`}>
                <span style="font-size:22px;">${locked ? '🔒' : mission.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:13px;">${mission.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${locked ? mission.lockReason : mission.description}</div>
                    ${!locked ? `<div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">
                        ⏱️ ${mission.baseDuration}d • 💰 ${mission.goldCost}g • ⚡ ${mission.apCost} AP • ⚠️ ${Math.floor((mission.failChance || 0) * 100)}% fail
                    </div>` : ''}
                </div>
            </button>`;
        }

        html += `<button onclick="ActionMenu.showManageSpiesMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back to Roster</button>`;
        html += '</div>';

        game.ui.showCustomPanel(`📋 Missions for ${spy.name}`, html);

        window._espGame = game;
        window._espTile = tile;
        window._selectMissionTarget = (missionType, sid) => {
            ActionMenu._showMissionTargetSelect(game, tile, sid, missionType);
        };
    },

    /**
     * Show target kingdom selection for a mission
     */
    _showMissionTargetSelect(game, tile, spyId, missionType) {
        const targets = Espionage.getTargetKingdoms(game.player, game.world, missionType);
        const mDef = Espionage._getMissions()[missionType];

        if (targets.length === 0) {
            game.ui.showNotification('❌ No Targets', 'No valid target kingdoms found for this mission.', 'error');
            return;
        }

        let html = '<div style="max-height:420px; overflow-y:auto;">';
        html += `<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Select a target for <strong style="color:white;">${mDef ? mDef.name : missionType}</strong>.</p>`;

        if (mDef && mDef.consequences) {
            html += `<div style="padding:6px; margin-bottom:10px; background:rgba(231,76,60,0.1); border:1px solid rgba(231,76,60,0.2); border-radius:4px; font-size:11px; color:#e74c3c;">
                ⚠️ Warning: ${mDef.consequences.diplomaticPenalty ? `Diplomatic penalty: ${mDef.consequences.diplomaticPenalty}` : ''} ${mDef.consequences.warChanceIncrease ? `War risk: +${Math.floor(mDef.consequences.warChanceIncrease * 100)}%` : ''} ${mDef.consequences.karmaPenalty ? `Karma: ${mDef.consequences.karmaPenalty}` : ''}
            </div>`;
        }

        for (const target of targets) {
            html += `<button onclick="window._confirmMission('${missionType}', ${spyId}, '${target.id}')"
                style="display:flex; align-items:center; gap:10px; width:100%;
                    padding:12px; margin-bottom:8px;
                    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                    border-radius:4px; cursor:pointer; text-align:left; color:white;
                    font-family:var(--font-body); transition:all 0.2s;"
                onmouseover="this.style.background='rgba(155,89,182,0.15)'; this.style.borderColor='#9b59b6'"
                onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                <span style="font-size:22px; width:28px; height:28px; border-radius:50%; background:${target.color || '#555'}; display:flex; align-items:center; justify-content:center;">👑</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:13px;">${target.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">⚔️ Military: ${target.military} • 💰 Treasury: ${target.treasury} • 🗺️ Territory: ${target.territory}</div>
                </div>
            </button>`;
        }

        html += `<button onclick="ActionMenu._showAssignMissionForSpy(window._espGame, window._espTile, ${spyId})" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back to Missions</button>`;
        html += '</div>';

        game.ui.showCustomPanel(`🎯 Select Target`, html);

        window._espGame = game;
        window._espTile = tile;
        window._confirmMission = (mt, sid, targetId) => {
            // Check AP cost
            const missionDef = Espionage._getMissions()[mt];
            const apCost = missionDef ? missionDef.apCost || 3 : 3;
            if ((game.player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ Not Enough AP', `This mission requires ${apCost} AP but you only have ${game.player.actionPoints || 0}.`, 'error');
                return;
            }
            game.player.actionPoints -= apCost;

            const result = Espionage.assignMission(game.player, sid, mt, targetId, game.world);
            if (result.success) {
                const targetK = game.world.getKingdom(targetId);
                game.ui.showNotification('📋 Mission Assigned',
                    `${result.spy.name} has been sent to ${targetK ? targetK.name : 'the target'}. (-${result.cost}g, ${result.mission.duration}d)`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showEspionageMenu(game, tile);
            } else {
                game.player.actionPoints += apCost; // Refund AP
                game.ui.showNotification('❌ Mission Failed', result.reason, 'error');
            }
        };
    },

    /**
     * Show active missions with progress
     */
    _showActiveMissionsMenu(game, tile) {
        Espionage.initPlayer(game.player);
        const missions = game.player.espionage.activeMissions;

        let html = '<div style="max-height:450px; overflow-y:auto;">';
        html += '<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Active covert operations in progress.</p>';

        if (missions.length === 0) {
            html += '<p style="color:var(--text-secondary); text-align:center; padding:20px;">No active missions.</p>';
        }

        for (const mission of missions) {
            const spy = Espionage.getSpyById(game.player, mission.spyId);
            const mDef = Espionage._getMissions()[mission.type];
            const kingdom = game.world.getKingdom(mission.targetKingdom);
            const pct = Math.floor((mission.progress / mission.duration) * 100);
            const daysLeft = mission.duration - mission.progress;

            html += `<div style="padding:12px; margin-bottom:10px; background:rgba(255,255,255,0.04);
                border-left:3px solid #3498db; border-radius:0 6px 6px 0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-weight:bold; font-size:13px; color:white;">
                        ${mDef ? mDef.icon : '📋'} ${mDef ? mDef.name : mission.type}
                    </span>
                    <span style="font-size:11px; color:#3498db;">${daysLeft}d remaining</span>
                </div>
                <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">
                    🕵️ ${spy ? spy.name : 'Unknown'} → 👑 ${kingdom ? kingdom.name : 'Unknown'}
                </div>
                <div style="background:#333; border-radius:3px; height:8px; margin-bottom:4px;">
                    <div style="width:${pct}%; background:linear-gradient(90deg, #9b59b6, #3498db); height:100%; border-radius:3px; transition:width 0.3s;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-secondary);">
                    <span>${pct}% complete</span>
                    <span>Difficulty: ${Math.floor(mission.difficulty * 100)}%</span>
                </div>
            </div>`;
        }

        html += `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back</button>`;
        html += '</div>';

        game.ui.showCustomPanel('⏳ Active Missions', html);

        window._espGame = game;
        window._espTile = tile;
    },
};
