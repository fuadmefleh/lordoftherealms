// ActionMenu — core methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { voice } from '../barterVoice.js';
import { pictureIcon } from '../icons.js';
import { DawnBirth } from '../../player/dawnBirth.js';
import { Parentage } from '../../player/parentage.js';
import { ParentsGuard } from '../parentsGuard.js';
import { Dawn } from '../../world/dawn.js';
import { Endurance } from '../../player/endurance.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerReligion, Gossip, OutlawLairs } from './_imports.js';

const _escHtml = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Paint the place card's backdrop: the live map around this hex, copied
 * from the game canvas as the menu opens (so it shows exactly what is there).
 */
function paintPlaceView(game, tile, view) {
    const r = game && game.renderer;
    if (!view || !r || !r.canvas || tile.q == null) return;
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.width = Math.round(w * dpr);
    view.height = Math.round(h * dpr);
    const pos = r.getHexPixelPos(tile.q, tile.r);
    const c = r.camera.worldToScreen(pos.x, pos.y);
    const s = r.hexSize * r.camera.zoom;
    // Crop about eight hexes wide, keeping the card's aspect, the hex a little right of centre
    const cw = Math.min(r.canvas.width, s * 15);
    const ch = cw * (h / w);
    const sx = Math.max(0, Math.min(r.canvas.width - cw, c.x - cw * 0.62));
    const sy = Math.max(0, Math.min(r.canvas.height - ch, c.y + 0.13 * s - ch / 2));
    try {
        // The world canvas's backing store is at the screen's pixel ratio (ui/hiDpi.js)
        const k = r.canvas.pixelRatio || 1;
        view.getContext('2d').drawImage(r.canvas, sx * k, sy * k, cw * k, ch * k, 0, 0, view.width, view.height);
        view.classList.add('painted');
    } catch (e) {
        // A tainted or unavailable canvas just leaves the plain card
    }
}

// ── The action menu as a town's districts ──
// The menu shows one district at a time behind a ribbon of wax seals, so a
// capital's forty-odd actions are never all on screen at once. Districts are a
// view over _categorizeActions: Social splits into the people's places (tavern,
// temple, lodging) and the hall of lords and realms.
const AMX_COURT_TYPES = new Set([
    'pledge_allegiance', 'renounce_allegiance', 'realm_wars', 'fund_restoration', 'form_kingdom',
    'claims_crowns', 'royal_court', 'request_meeting', 'meet_rival_house', 'seek_title',
    'view_title_status', 'resign_title', 'collect_tax', 'request_bounty', 'capture_fugitive',
    'hold_council', 'espionage_menu', 'manage_spies', 'hold_court', 'rivals_here', 'hall_of_heroes',
    'patronage', 'manage_dynasty', 'treasury', 'host_feast', 'hold_tournament', 'host_festival',
    'meet_courier',
]);
const AMX_DISTRICTS = {
    hearth:    { icon: '🏕️', label: 'Hearth', hint: 'Rest, food, body and the road' },
    market:    { icon: '⚖️', label: 'Market', hint: 'Trade, work, coin and property' },
    folk:      { icon: '🍺', label: 'Tavern & Temple', hint: 'People, faith, talk and a bed' },
    court:     { icon: '👑', label: 'Hall & Court', hint: 'Lords, titles, realms and intrigue' },
    arms:      { icon: '⚔️', label: 'Arms', hint: 'Soldiers, training and the sword' },
    works:     { icon: '🏗️', label: 'Works', hint: 'Build, raise and tear down' },
    frontier:  { icon: '🧭', label: 'Frontier', hint: 'Colonies, holdings and new land' },
    maps:      { icon: '🗺️', label: 'Maps', hint: 'Charting the land and trading maps' },
    jail:      { icon: '🔒', label: 'Jail', hint: 'Your cell, and the ways out of it' },
    servitude: { icon: '⛓️', label: 'Servitude', hint: 'Your bond, and the ways out of it' },
};
const AMX_ORDER = ['hearth', 'market', 'folk', 'court', 'arms', 'works', 'frontier', 'maps', 'jail', 'servitude'];
const AMX_FROM_CATEGORY = { general: 'hearth', commerce: 'market', military: 'arms', building: 'works', frontier: 'frontier', cartography: 'maps', jail: 'jail', servitude: 'servitude' };
// Each seal its own wax
const AMX_WAX = {
    athand: '#a8781c', hearth: '#8a3a22', market: '#2f6b45', folk: '#8a5a1c', court: '#5b3277',
    arms: '#7f1f1f', works: '#5e4630', frontier: '#24676a', maps: '#2c4f7c', jail: '#3d3d46', servitude: '#3d3d46',
};
// Submenus: inside a district with many actions, they gather into folders
// (open one, act, or go back). A district of a few actions stays one list.
const AMX_GROUP_MIN = 8;
const AMX_GROUPS = {
    hearth: [
        { id: 'rest', icon: '🛏️', label: 'Rest & Body', types: ['rest', 'pass_time', 'eat_meal', 'seek_physician', 'craft_campfire', 'meditate', 'wait_here'] },
        { id: 'gather', icon: '🧺', label: 'Gather & Hunt', types: ['forage', 'hunt', 'fish', 'trap_furs', 'ice_fish', 'clear_trees', 'prospect', 'tame_horse', 'dig_treasure'] },
        { id: 'explore', icon: '🔭', label: 'Explore', types: ['explore_poi', 'delve', 'delve_resume', 'explore_inner_map', 'explore_ocean'] },
        { id: 'sea', icon: '⛵', label: 'Ship & Shore', types: ['disembark', 'row_ashore', 'row_to_ship', 'make_for_port'] },
        { id: 'clan', icon: '🔥', label: 'The Clan', types: ['dawn_settle', 'dawn_instep'] },
    ],
    market: [
        { id: 'trade', icon: '⚖️', label: 'Buy & Sell', types: ['trade', 'port_market', 'livestock_market', 'meet_trader', 'furniture_maker', 'ship_hold', 'stolen_goods'] },
        { id: 'work', icon: '🔨', label: 'Work & Wages', types: ['odd_jobs', 'busking', 'bounty_board', 'commissions', 'planting_contract', 'putting_out', 'contract'] },
        { id: 'money', icon: '🏦', label: 'Money & Banking', types: ['bank', 'found_bank', 'underwriter', 'bourse', 'mint', 'trading_company', 'guildhall', 'post_house'] },
        { id: 'property', icon: '🏠', label: 'Property & Estates', types: ['collect_goods', 'manage_property', 'town_lots', 'estates', 'manage_lodging', 'graveyards', 'my_herds'] },
        { id: 'transport', icon: '🐫', label: 'Caravans & Ships', types: ['start_caravan', 'ship_passage', 'visit_shipyard', 'board_ship', 'manage_fleet', 'hire_sailors'] },
        { id: 'shady', icon: '🎲', label: 'Back Rooms', types: ['smuggle', 'pickpocket', 'gambling', 'underworld'] },
    ],
    folk: [
        { id: 'talk', icon: '🍺', label: 'Tavern & Talk', types: ['tavern', 'talk_locals', 'meet_people', 'view_relationships', 'languages', 'your_parents', 'lodging'] },
        { id: 'faith', icon: '⛪', label: 'Faith', types: ['preach', 'denounce_heresy', 'pilgrimage', 'miracle', 'donate', 'bless_settlement'] },
    ],
    court: [
        { id: 'realm', icon: '👑', label: 'Crown & Realm', types: ['pledge_allegiance', 'renounce_allegiance', 'realm_wars', 'form_kingdom', 'claims_crowns', 'royal_court', 'treasury', 'collect_tax', 'hold_council', 'hold_court'] },
        { id: 'titles', icon: '📜', label: 'Titles', types: ['seek_title', 'view_title_status', 'resign_title'] },
        { id: 'house', icon: '🏰', label: 'House & Rivals', types: ['manage_dynasty', 'rivals_here', 'meet_rival_house', 'request_meeting', 'hall_of_heroes', 'patronage', 'meet_courier'] },
        { id: 'feasts', icon: '🎉', label: 'Feasts & Works of Fame', types: ['host_feast', 'hold_tournament', 'host_festival', 'fund_restoration'] },
        { id: 'intrigue', icon: '🗝️', label: 'Intrigue & the Law', types: ['espionage_menu', 'manage_spies', 'request_bounty', 'capture_fugitive'] },
    ],
    arms: [
        { id: 'army', icon: '🛡️', label: 'The Army', types: ['recruit', 'army_command', 'train_combat', 'arms_armour', 'reforge_artifact'] },
        { id: 'fight', icon: '⚔️', label: 'Fight', types: ['attack_unit', 'attack_settlement', 'siege_camp', 'capture_criminal', 'outlaw_lair'] },
        { id: 'sea', icon: '⚓', label: 'At Sea', types: ['hunt_pirates', 'commit_piracy', 'raid_haven', 'landing_party', 'sea_rovers'] },
    ],
    works: [
        { id: 'build', icon: '🏗️', label: 'Build', types: ['build_property', 'build_temple', 'build_cultural', 'upgrade_cultural'] },
        { id: 'land', icon: '🛤️', label: 'Roads & Land', types: ['build_infrastructure', 'demolish_infrastructure', 'terraform', 'public_works'] },
        { id: 'home', icon: '🏡', label: 'Your Home', types: ['buy_house', 'manage_house'] },
    ],
};
/** A district's actions in its folders → [{ id, icon, label, actions }] (null: too few to fold). */
function _amxGroupsOf(d) {
    const defs = AMX_GROUPS[d.id];
    if (!defs || d.actions.length < AMX_GROUP_MIN) return null;
    const out = defs.map(g => ({ id: g.id, icon: g.icon, label: g.label, actions: [] }));
    const other = { id: 'other', icon: '📋', label: 'More', actions: [] };
    for (const a of d.actions) {
        const i = defs.findIndex(g => g.types.includes(a.type));
        (i >= 0 ? out[i] : other).actions.push(a);
    }
    if (other.actions.length) out.push(other);
    const full = out.filter(g => g.actions.length);
    return full.length >= 2 ? full : null;
}

// Actions that charge their AP per use inside their own menus
const AMX_PER_USE = { gambling: 2, smuggle: 2 };
// Pins and recent actions are a per-player-of-this-browser convenience, not game state
const AMX_PIN_KEY = 'lotr_actionmenu_pins';
const AMX_RECENT_KEY = 'lotr_actionmenu_recent';
const _amxKey = (a) => (a.unitId ? `${a.type}#${a.unitId}` : a.type);
function _amxLoad(key) {
    try {
        const v = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
    } catch (e) {
        return [];
    }
}
function _amxSave(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* storage unavailable: pins last this menu only */ }
}

/** The districts with actions here, in seal order. */
function _amxDistricts(actions, tile, game) {
    const byId = {};
    for (const cat of ActionMenu._categorizeActions(actions)) {
        for (const a of cat.actions) {
            const id = cat.id === 'social' ? (AMX_COURT_TYPES.has(a.type) ? 'court' : 'folk') : (AMX_FROM_CATEGORY[cat.id] || 'hearth');
            (byId[id] = byId[id] || []).push(a);
        }
    }
    const atSea = !!(game.player.boardedShip && tile.terrain && !tile.terrain.passable);
    const hearth = tile.settlement ? 'Hearth' : atSea ? 'Ship & Sea' : 'Camp & Wilds';
    return AMX_ORDER.filter(id => byId[id]).map(id => ({
        id, ...AMX_DISTRICTS[id], label: id === 'hearth' ? hearth : AMX_DISTRICTS[id].label, actions: byId[id],
    }));
}

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
        game._fieldBattleDone = null; // a battle's report read and put away
        game.ui.updateStats(game.player, game.world);
        // Clear of a band on the road: the journey it interrupted goes on (ui/game/combat.js)
        if (game._encounterHeld && typeof game._resumeHeldJourney === 'function') game._resumeHeldJourney();
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
            rest: 'general', pass_time: 'general', eat_meal: 'general', seek_physician: 'general', explore_poi: 'general', delve: 'general', delve_resume: 'general', clear_trees: 'general', dig_treasure: 'general',
            forage: 'general', hunt: 'general', meditate: 'general', fish: 'general',
            trap_furs: 'general', ice_fish: 'general', planting_contract: 'commerce',
            prospect: 'general', tame_horse: 'general', craft_campfire: 'general', languages: 'social', dawn_settle: 'general', dawn_instep: 'general', your_parents: 'social', commissions: 'commerce',
            disembark: 'general', row_ashore: 'general', row_to_ship: 'general', ship_hold: 'commerce', port_market: 'commerce', explore_ocean: 'general', make_for_port: 'general', hunt_pirates: 'military', commit_piracy: 'military', raid_haven: 'military', landing_party: 'military', explore_inner_map: 'general',
            trade: 'commerce', contract: 'commerce', ship_passage: 'commerce',
            collect_goods: 'commerce', manage_property: 'commerce', start_caravan: 'commerce',
            odd_jobs: 'commerce', bounty_board: 'commerce', busking: 'commerce', gambling: 'commerce',
            smuggle: 'commerce', pickpocket: 'commerce', stolen_goods: 'social',
            tavern: 'social', talk_locals: 'social', lodging: 'social', manage_lodging: 'commerce', town_lots: 'commerce', graveyards: 'commerce', town_sickness: 'social', livestock_market: 'commerce', my_herds: 'commerce', furniture_maker: 'commerce', preach: 'social', denounce_heresy: 'social',
            pilgrimage: 'social', miracle: 'social', donate: 'social',
            pledge_allegiance: 'social', renounce_allegiance: 'social',
            realm_wars: 'social', fund_restoration: 'social',
            form_kingdom: 'social', claims_crowns: 'social', royal_court: 'social',
            host_feast: 'social', hold_tournament: 'social', host_festival: 'social',
            meet_people: 'social', view_relationships: 'social', manage_dynasty: 'social',
            recruit: 'military', attack_unit: 'military', attack_settlement: 'military', siege_camp: 'military',
            train_combat: 'military', reforge_artifact: 'military', capture_criminal: 'military',
            request_meeting: 'social', meet_rival_house: 'social',
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
            jail_wait: 'jail', jail_bail: 'jail', jail_escape: 'jail', jail_cell: 'jail',
            servitude_wait: 'servitude', servitude_escape: 'servitude',
            servitude_buy_freedom: 'servitude',
            seek_title: 'social', view_title_status: 'social', resign_title: 'social',
            collect_tax: 'social', request_bounty: 'social', capture_fugitive: 'social',
            bless_settlement: 'social', hold_council: 'social',
            espionage_menu: 'social', manage_spies: 'social',
            hold_court: 'social', manage_holding: 'frontier',
            rivals_here: 'social', hall_of_heroes: 'social', patronage: 'social',
            bank: 'commerce', found_bank: 'commerce',
            underworld: 'commerce',
            guildhall: 'commerce',
            post_house: 'commerce',
            // (these used to fall through to General, swelling it to half the list)
            arms_armour: 'military', army_command: 'military', outlaw_lair: 'military', sea_rovers: 'military',
            hire_sailors: 'commerce', trading_company: 'commerce', underwriter: 'commerce', bourse: 'commerce',
            mint: 'commerce', estates: 'commerce', putting_out: 'commerce', meet_trader: 'commerce',
            treasury: 'social', meet_courier: 'social',
            public_works: 'building', terraform: 'building',
            chart_tile: 'cartography',
        };

        for (const action of actions) {
            // (a type mapped to a category that doesn't exist files under General, not a crash)
            const cat = categories[mapping[action.type]] ? mapping[action.type] : 'general';
            categories[cat].actions.push(action);
        }

        // Return only categories that have actions, preserving order
        const ordered = ['general', 'commerce', 'social', 'military', 'building', 'frontier', 'cartography', 'jail', 'servitude'];
        return ordered
            .filter(key => categories[key].actions.length > 0)
            .map(key => ({ id: key, ...categories[key] }));
    },

    /**
     * Create the action menu UI: the place card, a ribbon of district seals
     * (At Hand, Hearth, Market, Tavern & Temple, Hall & Court, Arms, Works,
     * Frontier, Maps), one district's actions at a time in a scrolling list,
     * a search across them all, and a note on the action under the pointer.
     */
    createMenu(game, tile, actions) {
        // Remove existing menu if any
        ActionMenu.close();

        const districts = _amxDistricts(actions, tile, game);
        const ap = game.player.actionPoints != null ? game.player.actionPoints : 10;
        const maxAp = game.player.maxActionPoints || 10;
        const state = { pins: _amxLoad(AMX_PIN_KEY), recent: _amxLoad(AMX_RECENT_KEY), ap };
        const total = districts.reduce((n, d) => n + d.actions.length, 0);
        // A short list (jail, servitude, a bare hex) is shown whole, without seals
        const flat = total <= 8 || districts.length === 1;

        const menu = document.createElement('div');
        menu.id = 'actionMenu';
        menu.className = 'amx' + (flat ? ' amx-flat' : '');

        // ── Header: a place card — the map itself around this hex, the place named over it ──
        let placeName, placeKind;
        if (tile.settlement) {
            placeName = tile.settlement.name;
            placeKind = tile.settlement.type;
        } else if (tile.improvement) {
            placeName = tile.improvement.name;
            placeKind = 'landmark';
        } else {
            placeName = tile.terrain.name || tile.terrain.id;
            placeKind = tile.terrain && !tile.terrain.passable ? (game.player.boardedShip ? 'at sea' : 'the waters') : 'wilds';
        }
        const kingdom = tile.kingdom && game.world.getKingdom ? game.world.getKingdom(tile.kingdom) : null;
        const placeSub = [tile.settlement || tile.improvement ? (tile.terrain.name || tile.terrain.id) : null,
            kingdom ? kingdom.name : 'Unclaimed lands'].filter(Boolean).join(' · ');
        // A hot button on the place card for walking into the hex on foot (Explore Interior / Go on Deck),
        // so it isn't buried in a district's list
        const quick = actions.find(a => a && a.type === 'explore_inner_map' && !a.disabled) || null;
        const apPips = maxAp <= 14
            ? `<span class="amx-ap-pips" aria-hidden="true">${'◆'.repeat(Math.max(0, Math.min(ap, maxAp)))}<i>${'◆'.repeat(Math.max(0, maxAp - Math.max(0, ap)))}</i></span>`
            : '';

        let html = `
            <div class="am-place">
                <canvas class="am-place-view"></canvas>
                <div class="am-place-shade"></div>
                <div class="am-place-text">
                    <div class="am-place-kicker">Actions · ${_escHtml(placeKind)}</div>
                    <div class="am-place-name">${_escHtml(placeName)}</div>
                    <div class="am-place-sub">${_escHtml(placeSub)}</div>
                </div>
                <div class="am-place-side">
                    <span class="am-place-ap" title="Action points left today: ${ap} of ${maxAp}">${apPips}<b>${ap}</b>/${maxAp} AP</span>
                    ${quick ? `<button class="action-menu-btn amx-quick" data-action="${quick.type}" title="${_escHtml(quick.description || quick.label)} (free)">${quick.icon || '🗺️'} ${_escHtml(quick.type === 'explore_inner_map' && quick.label === 'Explore Interior' ? 'Explore' : quick.label)}</button>` : ''}
                    <button id="closeActionMenu" class="am-place-close" title="Close (Esc)">✕</button>
                </div>
            </div>
        `;

        // ── The seals: one per district, At Hand first ──
        if (!flat) {
            html += '<div class="amx-seals" role="tablist" aria-label="Districts">';
            html += `<button class="amx-seal" data-dist="athand" role="tab" style="--wax:${AMX_WAX.athand}" title="At Hand: what needs you, your pinned actions and your recent ones">
                <span class="amx-wax">⭐<i class="amx-count" data-count="athand"></i></span><span class="amx-seal-name">At Hand</span></button>`;
            for (const d of districts) {
                html += `<button class="amx-seal" data-dist="${d.id}" role="tab" style="--wax:${AMX_WAX[d.id] || AMX_WAX.hearth}" title="${_escHtml(d.label)}: ${_escHtml(d.hint || '')}">
                    <span class="amx-wax">${d.icon}<i class="amx-count">${d.actions.length}</i></span><span class="amx-seal-name">${_escHtml(d.label)}</span></button>`;
            }
            html += '</div>';
        }

        // ── Caption: the district's name and what it holds, and the search ──
        html += `
            <div class="amx-cap">
                <div class="amx-cap-text"><span class="amx-cap-title"></span><span class="amx-cap-hint"></span></div>
                <label class="amx-search" title="Type anywhere to search every action here">
                    <span aria-hidden="true">🔍</span>
                    <input type="text" class="amx-search-input" placeholder="Seek an action…" autocomplete="off" spellcheck="false" aria-label="Search actions">
                </label>
            </div>
        `;

        // ── The list: At Hand, then every district (only one shows at a time) ──
        html += '<div class="amx-list" role="tabpanel">';
        html += '<div class="amx-sec" data-sec="athand"></div>';
        for (const d of districts) {
            html += `<div class="amx-sec" data-sec="${d.id}"><div class="amx-sec-head">${d.icon} ${_escHtml(d.label)}</div>`;
            const groups = flat ? null : _amxGroupsOf(d);
            if (!groups) {
                for (const a of d.actions) html += ActionMenu._renderActionTile(a, { dist: d, ap, pins: state.pins });
            } else {
                // The folders, then each folder's actions (one open at a time; all at once while searching)
                html += '<div class="amx-folders">';
                for (const g of groups) {
                    const names = g.actions.slice(0, 3).map(a => _escHtml(a.label)).join(' · ') + (g.actions.length > 3 ? ' …' : '');
                    html += `<button class="amx-dir amx-folder" data-grp="${g.id}" style="--wax:${AMX_WAX[d.id] || AMX_WAX.hearth}">
                        <span class="amx-dir-wax">${g.icon}</span>
                        <span class="amx-txt"><span class="amx-name">${_escHtml(g.label)}</span><span class="amx-desc">${names}</span></span>
                        <span class="amx-dir-n">${g.actions.length} ›</span></button>`;
                }
                html += '</div>';
                for (const g of groups) {
                    html += `<div class="amx-grp" data-grp="${g.id}" hidden>`
                        + `<button class="amx-back" type="button" title="Back to ${_escHtml(d.label)} (Backspace)">‹ ${_escHtml(d.label)} <span class="amx-back-sep">/</span> ${g.icon} ${_escHtml(g.label)}</button>`;
                    for (const a of g.actions) html += ActionMenu._renderActionTile(a, { dist: d, ap, pins: state.pins });
                    html += '</div>';
                }
            }
            html += '</div>';
        }
        html += '<div class="amx-empty" hidden>Nothing by that name here. Try another word, or clear the search.</div>';
        html += '</div>';

        const HINT = flat ? '<span class="amx-note-hint">Type to search · ↑ ↓ to choose · Enter to act</span>'
            : '<span class="amx-note-hint">Type to search · ↑ ↓ to choose · Enter to act · ← → between districts · ☆ pins an action to At Hand</span>';
        html += `<div class="amx-note" aria-live="polite">${HINT}</div>`;

        // (costs told as goods' worth where the player deals in kind: ui/barterVoice.js)
        menu.innerHTML = voice(game, html);
        document.body.appendChild(menu);
        paintPlaceView(game, tile, menu.querySelector('.am-place-view'));

        const list = menu.querySelector('.amx-list');
        const note = menu.querySelector('.amx-note');
        const search = menu.querySelector('.amx-search-input');
        const capTitle = menu.querySelector('.amx-cap-title');
        const capHint = menu.querySelector('.amx-cap-hint');
        const empty = menu.querySelector('.amx-empty');
        const byKey = new Map();
        for (const d of districts) for (const a of d.actions) if (!byKey.has(_amxKey(a))) byKey.set(_amxKey(a), { action: a, dist: d });

        // At Hand: what needs you now, your pins, your recent actions (only those here)
        const buildAtHand = () => {
            const seen = new Set();
            const groups = [];
            const take = (title, keys) => {
                const rows = [];
                for (const k of keys) {
                    if (seen.has(k) || !byKey.has(k)) continue;
                    seen.add(k);
                    const { action, dist } = byKey.get(k);
                    rows.push(ActionMenu._renderActionTile(action, { dist, ap, pins: state.pins, showDistrict: true }));
                }
                if (rows.length) groups.push(`<div class="amx-sec-head amx-sub">${title}</div>${rows.join('')}`);
                return rows.length;
            };
            const needs = [...byKey.values()].filter(v => v.action.notice && !v.action.disabled).map(v => _amxKey(v.action));
            if (ap <= 0 && byKey.has('rest')) needs.push('rest');
            const n = take('Needs you', needs) + take('Pinned', state.pins) + take('Recent', state.recent.slice(0, 5));
            const sec = list.querySelector('[data-sec="athand"]');
            // Under them, the place at a glance: each district and the first of what it holds
            let dir = `<div class="amx-sec-head amx-sub">${n ? 'Elsewhere here' : 'Here'}</div>`;
            for (const d of districts) {
                const names = d.actions.slice(0, 3).map(a => _escHtml(a.label)).join(' · ') + (d.actions.length > 3 ? ' …' : '');
                dir += `<button class="amx-dir" data-goto="${d.id}" style="--wax:${AMX_WAX[d.id] || AMX_WAX.hearth}">
                    <span class="amx-dir-wax">${d.icon}</span>
                    <span class="amx-txt"><span class="amx-name">${_escHtml(d.label)}</span><span class="amx-desc">${names}</span></span>
                    <span class="amx-dir-n">${d.actions.length} ›</span></button>`;
            }
            sec.innerHTML = (groups.join('') || '<div class="amx-athand-empty">Nothing presses. Pin an action with ☆ and it waits here; what you do gathers here too.</div>') + dir;
            const c = menu.querySelector('[data-count="athand"]');
            if (c) { c.textContent = n || ''; c.classList.toggle('amx-urgent', needs.some(k => byKey.has(k))); }
            return n;
        };

        const sealOf = (id) => menu.querySelector(`.amx-seal[data-dist="${id}"]`);
        const distById = Object.fromEntries(districts.map(d => [d.id, d]));
        let current = null;

        const apply = () => {
            const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
            const searching = words.length > 0;
            menu.classList.toggle('amx-searching', searching);
            let shown = 0;
            for (const sec of list.querySelectorAll('.amx-sec')) {
                const id = sec.getAttribute('data-sec');
                const folders = sec.querySelector('.amx-folders');
                const grps = [...sec.querySelectorAll('.amx-grp')];
                if (searching || flat) {
                    if (id === 'athand') { sec.hidden = true; continue; }
                    let n = 0;
                    for (const row of sec.querySelectorAll('.amx-row')) {
                        const hay = row.getAttribute('data-q') || '';
                        const ok = words.every(w => hay.includes(w));
                        row.hidden = !ok;
                        if (ok) n++;
                    }
                    // Searching sees through the folders: every match, folders and back-links put away
                    if (folders) folders.hidden = true;
                    for (const g of grps) {
                        g.hidden = !g.querySelector('.amx-row:not([hidden])');
                        const back = g.querySelector('.amx-back');
                        if (back) back.hidden = true;
                    }
                    sec.hidden = n === 0;
                    shown += n;
                } else {
                    sec.hidden = id !== current;
                    for (const row of sec.querySelectorAll('.amx-row')) row.hidden = false;
                    if (folders) {
                        const open = openGroup[id] || null;
                        folders.hidden = !!open;
                        for (const g of grps) {
                            g.hidden = g.getAttribute('data-grp') !== open;
                            const back = g.querySelector('.amx-back');
                            if (back) back.hidden = false;
                        }
                    }
                    if (!sec.hidden) shown = 1;
                }
            }
            empty.hidden = !(searching && shown === 0);
            for (const s of menu.querySelectorAll('.amx-seal')) {
                const on = !searching && s.getAttribute('data-dist') === current;
                s.classList.toggle('on', on);
                s.setAttribute('aria-selected', on ? 'true' : 'false');
            }
            if (searching) {
                capTitle.textContent = 'Search';
                capHint.textContent = shown ? `${shown} action${shown === 1 ? '' : 's'} here` : '';
            } else if (flat) {
                capTitle.textContent = 'What you can do';
                capHint.textContent = `${total} action${total === 1 ? '' : 's'} here`;
            } else if (current === 'athand') {
                capTitle.textContent = 'At Hand';
                capHint.textContent = 'What needs you, your pinned and your recent actions';
            } else {
                const d = distById[current];
                capTitle.textContent = d ? d.label : '';
                capHint.textContent = d ? d.hint || '' : '';
            }
        };

        // The folder open in each district (null: the folders themselves)
        const openGroup = {};
        const openFolder = (grp) => {
            openGroup[current] = grp;
            apply();
            list.scrollTop = 0;
            const sec = list.querySelector(`.amx-sec[data-sec="${current}"]`);
            const first = grp && sec && sec.querySelector(`.amx-grp[data-grp="${grp}"] .amx-main:not([disabled])`);
            const folder = !grp && sec && sec.querySelector('.amx-folder');
            const f = first || folder;
            if (f && f.focus) f.focus();
        };

        const select = (id) => {
            current = id;
            openGroup[id] = null;
            if (search.value) search.value = '';
            apply();
            list.scrollTop = 0;
            const s = sealOf(id);
            if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        };

        const atHandCount = buildAtHand();
        if (!flat) {
            const preferred = atHandCount > 0 ? 'athand' : (tile.settlement && distById.market ? 'market' : districts[0].id);
            select(preferred);
        } else {
            apply();
        }

        // A narrow window: the seal ribbon scrolls sideways (the wheel too), its edges fading
        const ribbon = menu.querySelector('.amx-seals');
        if (ribbon) {
            ribbon.classList.toggle('amx-seals-more', ribbon.scrollWidth > ribbon.clientWidth + 1);
            ribbon.addEventListener('wheel', (e) => {
                if (ribbon.scrollWidth <= ribbon.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
                ribbon.scrollLeft += e.deltaY;
                e.preventDefault();
            }, { passive: false });
        }

        const setPin = (key, on) => {
            state.pins = state.pins.filter(k => k !== key);
            if (on) state.pins.unshift(key);
            state.pins = state.pins.slice(0, 24);
            _amxSave(AMX_PIN_KEY, state.pins);
            for (const b of menu.querySelectorAll(`.amx-pin[data-pin="${CSS.escape(key)}"]`)) {
                b.classList.toggle('on', on);
                b.textContent = on ? '★' : '☆';
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
                b.title = on ? 'Unpin from At Hand' : 'Pin to At Hand';
            }
            buildAtHand();
            apply();
        };

        // ── The note: the whole of the action under the pointer or the keyboard ──
        const describe = (row) => {
            if (!row) { note.innerHTML = HINT; return; }
            const btn = row.querySelector('.amx-main');
            note.innerHTML = btn ? voice(game, btn.getAttribute('data-note') || HINT) : HINT;
        };

        // ── Events ──
        menu.addEventListener('click', (e) => {
            const pin = e.target.closest('.amx-pin');
            if (pin) { setPin(pin.getAttribute('data-pin'), !pin.classList.contains('on')); return; }
            const folder = e.target.closest('.amx-folder');
            if (folder) { openFolder(folder.getAttribute('data-grp')); return; }
            if (e.target.closest('.amx-back')) { openFolder(null); return; }
            const dirRow = e.target.closest('.amx-dir');
            if (dirRow) { select(dirRow.getAttribute('data-goto')); return; }
            const seal = e.target.closest('.amx-seal');
            if (seal) { select(seal.getAttribute('data-dist')); return; }
            if (e.target.closest('#closeActionMenu')) { ActionMenu.close(); return; }
            const btn = e.target.closest('.action-menu-btn');
            if (btn && !btn.disabled) {
                const key = btn.getAttribute('data-key');
                if (key) _amxSave(AMX_RECENT_KEY, [key, ...state.recent.filter(k => k !== key)].slice(0, 8));
                ActionMenu.handleAction(game, tile, btn.getAttribute('data-action'), btn.getAttribute('data-unit-id'));
            }
        });
        list.addEventListener('mouseover', (e) => describe(e.target.closest('.amx-row')));
        list.addEventListener('focusin', (e) => describe(e.target.closest('.amx-row')));
        list.addEventListener('mouseleave', () => {
            const f = document.activeElement && document.activeElement.closest && document.activeElement.closest('.amx-row');
            describe(f && menu.contains(f) ? f : null);
        });
        search.addEventListener('input', () => { apply(); list.scrollTop = 0; });

        const visibleButtons = () => [...list.querySelectorAll('.amx-main, .amx-dir, .amx-back')].filter(b => b.offsetParent !== null);
        menu.addEventListener('keydown', (e) => {
            const inSearch = e.target === search;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const btns = visibleButtons();
                if (!btns.length) return;
                const i = btns.indexOf(e.target.closest ? e.target.closest('.amx-main, .amx-dir, .amx-back') : null);
                let next;
                if (e.key === 'ArrowDown') next = inSearch || i < 0 ? btns[0] : btns[Math.min(btns.length - 1, i + 1)];
                else if (i <= 0) { search.focus(); e.preventDefault(); return; } else next = btns[i - 1];
                next.focus();
                next.scrollIntoView({ block: 'nearest' });
                e.preventDefault();
            } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inSearch && !flat) {
                const ids = [...menu.querySelectorAll('.amx-seal')].map(s => s.getAttribute('data-dist'));
                const i = Math.max(0, ids.indexOf(current));
                select(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]);
                const s = sealOf(current);
                if (s) s.focus();
                e.preventDefault();
            } else if (e.key === 'Backspace' && !inSearch && !flat && openGroup[current]) {
                // Back out of a folder to its district's folders
                openFolder(null);
                e.preventDefault();
            } else if (e.key === 'Enter' && inSearch) {
                const first = visibleButtons().find(b => !b.disabled);
                if (first) first.click();
                e.preventDefault();
            } else if (e.key === 'Escape' && inSearch) {
                // (the game's own Escape skips text fields: clear the search, then close)
                if (search.value) { search.value = ''; apply(); } else ActionMenu.close();
                e.preventDefault();
                e.stopPropagation();
            }
        });

        // Type anywhere: a letter while the menu is open goes to the search, not to the map's hotkeys
        const onKey = (e) => {
            if (!menu.isConnected) { window.removeEventListener('keydown', onKey, true); return; }
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const t = e.target;
            const tag = t && t.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
            if (e.key === '/') { search.focus(); e.preventDefault(); e.stopPropagation(); return; }
            if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
                search.focus();
                e.stopPropagation();
            }
        };
        window.addEventListener('keydown', onKey, true);
        menu._amxCleanup = () => window.removeEventListener('keydown', onKey, true);
    },

    /**
     * One action as a row of the menu's list: its icon, name and a line of what
     * it does (or why not now, or what needs you), its cost in AP pips, and a
     * pin. `opts`: { dist, ap, pins, showDistrict }.
     */
    _renderActionTile(action, opts = {}) {
        const ap = opts.ap != null ? opts.ap : Infinity;
        const key = _amxKey(action);
        const perUse = AMX_PER_USE[action.type];
        const cost = perUse || ActionMenu.getAPCost(action.type);
        const short = !action.disabled && cost > 0 && cost > ap;
        let costHtml;
        if (cost === 0) costHtml = '<span class="amx-free">free</span>';
        else {
            const pips = cost <= 4 ? '◆'.repeat(cost) : `◆<b>${cost}</b>`;
            costHtml = `<span class="amx-pips${short ? ' amx-short' : ''}" title="${cost} action point${cost === 1 ? '' : 's'}${perUse ? ' each time' : ''}">${pips}${perUse ? '<small>/use</small>' : ''}</span>`;
        }
        const desc = action.description || '';
        const why = action.disabled ? (action.reason || desc) : '';
        let line;
        if (action.disabled) line = `<span class="amx-desc amx-why">🔒 ${_escHtml(why)}</span>`;
        else if (action.notice) line = `<span class="amx-desc amx-notice">● ${_escHtml(action.notice)}</span>`;
        else line = `<span class="amx-desc">${_escHtml(desc)}</span>`;
        const where = opts.showDistrict && opts.dist ? `<span class="amx-where">${_escHtml(opts.dist.label)}</span>` : '';
        const costText = cost === 0 ? 'Free' : `${cost} AP${perUse ? ' each time' : ''}`;
        const noteText = `<b>${_escHtml(action.label)}</b> <span class="amx-note-cost">${costText}${short ? ` · you have ${ap} left today` : ''}</span> — ${_escHtml(action.disabled ? why : [action.notice, desc].filter(Boolean).join('. '))}`;
        const pinned = (opts.pins || []).includes(key);
        const hay = `${action.label} ${desc} ${action.notice || ''} ${opts.dist ? opts.dist.label : ''} ${action.type.replace(/_/g, ' ')}`.toLowerCase();
        return `
            <div class="amx-row${action.disabled ? ' amx-off' : ''}${short ? ' amx-dim' : ''}" data-q="${_escHtml(hay)}">
                <button class="action-menu-btn amx-main${action.disabled ? ' action-menu-btn-off' : ''}" data-action="${_escHtml(action.type)}"${action.unitId ? ` data-unit-id="${_escHtml(action.unitId)}"` : ''}
                    data-key="${_escHtml(key)}" data-desc="${_escHtml(desc)}" data-note="${_escHtml(noteText)}"${action.disabled ? ` disabled title="${_escHtml(why)}"` : ''}>
                    <span class="amx-ico">${pictureIcon(action.icon, 20)}</span>
                    <span class="amx-txt"><span class="amx-name">${_escHtml(action.label)}${where}</span>${line}</span>
                    <span class="amx-cost">${costHtml}</span>
                </button>
                <button class="amx-pin${pinned ? ' on' : ''}" data-pin="${_escHtml(key)}" aria-pressed="${pinned ? 'true' : 'false'}" title="${pinned ? 'Unpin from At Hand' : 'Pin to At Hand'}">${pinned ? '★' : '☆'}</button>
            </div>
        `;
    },

    /** A single action row (kept for callers of the old full-width button). */
    _renderActionButton(action, opts) {
        return ActionMenu._renderActionTile(action, opts);
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
        arms_armour: 0,
        your_parents: 0,
        dawn_instep: 0,
        disembark: 0,
        explore_inner_map: 0,
        jail_wait: 0, jail_bail: 0, jail_escape: 0, jail_cell: 0,
        servitude_wait: 0, servitude_escape: 0, servitude_buy_freedom: 0,
        view_relationships: 0, manage_dynasty: 0,
        manage_fleet: 0, manage_house: 0, manage_property: 0, manage_colony: 0,
        hold_court: 0, manage_holding: 0, patronage: 0, bank: 0, found_bank: 0,
        seek_physician: 0, // treatment costs gold, not time
        underworld: 0, // jobs inside the panel cost their own AP
        guildhall: 0,
        post_house: 0, // the Post House panel; letters cost postage, not time

        // Light actions (1 AP)
        trade: 1, collect_goods: 1, donate: 1,
        pledge_allegiance: 1, renounce_allegiance: 1,
        realm_wars: 0, fund_restoration: 2,
        form_kingdom: 6, claims_crowns: 0, royal_court: 0,
        bounty_board: 1, talk_locals: 1, request_meeting: 1, meet_rival_house: 1,
        buy_house: 1, meet_people: 0,

        // Moderate actions (2 AP)
        pickpocket: 2, gambling: 0, smuggle: 0, stolen_goods: 0, // gambling/smuggle cost 2 AP per use inside their menus
        recruit: 2, cartography: 2, chart_tile: 1, wash_clothes: 3, bathe: 2, map_trade: 2, steal_map: 2,
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
        board_ship: 8, visit_shipyard: 1, row_ashore: 4, row_to_ship: 4, ship_hold: 0, port_market: 0, explore_ocean: 6, make_for_port: 0, hunt_pirates: 10, commit_piracy: 10, raid_haven: 10, landing_party: 0, sea_rovers: 0,

        // Title actions
        seek_title: 1, view_title_status: 0, resign_title: 1,
        collect_tax: 3, request_bounty: 1, capture_fugitive: 5, capture_criminal: 4,
        bless_settlement: 3, hold_council: 5,

        // Espionage actions
        espionage_menu: 0, manage_spies: 0,

        // Rival adventurers (each deed inside the panel pays its own AP)
        rivals_here: 0, hall_of_heroes: 0,

        // Outlaw lairs (the panel is free; each deed inside pays its own AP)
        meet_trader: 0, meet_courier: 0,
        // Lodgings (rooms and services are paid in gold, not time)
        lodging: 0, manage_lodging: 0, town_lots: 0, graveyards: 0, town_sickness: 0, livestock_market: 0, my_herds: 0, furniture_maker: 0,
        outlaw_lair: 0, lair_scout: 3, lair_assault: 8, lair_strike: 4, lair_parley: 1,
        rival_duel: 4, rival_race: 1, rival_sabotage: 2, rival_hire: 1, rival_team_up: 1,
    },

    /**
     * Get the AP cost for an action type
     */
    getAPCost(actionType) {
        // Scrubbing clothes by hand: tuned in data/hospitality.json clothes.washByHandAP
        if (actionType === 'wash_clothes') {
            const C = DataLoader._gamedata && DataLoader._gamedata.hospitality && DataLoader._gamedata.hospitality.clothes;
            if (C && Number.isFinite(C.washByHandAP)) return Math.max(0, C.washByHandAP);
        }
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
        'request_meeting', 'meet_rival_house', 'buy_house', 'seek_title', 'visit_shipyard',
        'delve',
        // Choice scenes charge their AP on the first real choice (ui/actionMenu/treasureScenes.js)
        'steal_map', 'dig_treasure',
    ]),

    /**
     * Spend (commit) the deferred AP that was stored by handleAction.
     * Call this at the top of every sub-menu confirm handler.
     * Returns true if AP was successfully spent (or there was nothing pending), false if insufficient.
     */
    commitPendingAP(game) {
        if (ActionMenu._pendingAP === null) return true; // nothing pending, already paid or free
        const cost = ActionMenu._pendingAP;
        if (cost === 0) { ActionMenu._pendingAP = null; return true; }
        if ((game.player.actionPoints || 0) < cost) {
            // Keep the cost pending: clearing it here made the sub-menu's
            // next confirm free after a refusal
            game.ui.showNotification('⚡ Not Enough Action Points',
                `This action requires ${cost} AP but you only have ${game.player.actionPoints || 0}. Rest to start a new day.`, 'error');
            return false;
        }
        ActionMenu._pendingAP = null;
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

        // Your parents' rules (player/parentage.js): grounded is refused; a forbidden thing
        // done anyway is defiance, and they may hear of it
        // (ui/parentsGuard.js: the same check every other door to these things makes, so
        // the panel this opens doesn't ask again the same day)
        if (!ParentsGuard.ok(game, actionType, tile)) return;

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
            // (labour's energy: less for the hardy, and it builds Endurance — player/endurance.js)
            switch (actionType) {
                case 'forage':      Endurance.labour(p, 8); p.modifyNeed('hygiene', -5); p.modifyNeed('fun', 5); break;
                case 'hunt':        Endurance.labour(p, 12); p.modifyNeed('hygiene', -8); p.modifyNeed('fun', 10); break;
                case 'trap_furs':   Endurance.labour(p, 12); p.modifyNeed('comfort', -8); break;
                case 'ice_fish':    Endurance.labour(p, 6); p.modifyNeed('comfort', -6); p.modifyNeed('fun', 8); break;
                case 'planting_contract': Endurance.labour(p, 10); p.modifyNeed('hygiene', -8); p.modifyNeed('social', 4); break;
                case 'fish':        Endurance.labour(p, 5); p.modifyNeed('fun', 12); p.modifyNeed('comfort', 5); break;
                case 'meditate':    p.modifyNeed('comfort', 15); p.modifyNeed('energy', 8); p.modifyNeed('fun', 3); break;
                case 'train_combat': Endurance.labour(p, 15); p.modifyNeed('hygiene', -10); p.modifyNeed('fun', 8); break;
                case 'meet_people': p.modifyNeed('social', 15); p.modifyNeed('fun', 5); break;
                case 'talk_locals': p.modifyNeed('social', 10); p.modifyNeed('fun', 3); break;
                case 'gambling':    p.modifyNeed('fun', 15); p.modifyNeed('social', 10); break;
                case 'busking':     p.modifyNeed('fun', 12); p.modifyNeed('social', 8); Endurance.labour(p, 5); break;
                case 'host_feast':  p.modifyNeed('social', 20); p.modifyNeed('fun', 15); p.modifyNeed('hunger', 25); break;
                case 'hold_tournament': p.modifyNeed('fun', 20); p.modifyNeed('social', 15); break;
                case 'host_festival':   p.modifyNeed('fun', 25); p.modifyNeed('social', 20); break;
                case 'preach':      p.modifyNeed('social', 8); p.modifyNeed('comfort', 5); break;
                case 'denounce_heresy': p.modifyNeed('social', 8); break;
                case 'pilgrimage':  p.modifyNeed('comfort', 15); Endurance.labour(p, 10); break;
                case 'donate':      p.modifyNeed('comfort', 8); break;
                case 'trade':       p.modifyNeed('social', 5); break;
                case 'tavern':      p.modifyNeed('social', 5); p.modifyNeed('comfort', 5); break;
                case 'explore_poi': p.modifyNeed('fun', 10); Endurance.labour(p, 5); break;
                case 'delve':       p.modifyNeed('fun', 12); Endurance.labour(p, 8); p.modifyNeed('hygiene', -6); break;
                case 'explore_inner_map': p.modifyNeed('fun', 5); break;
                case 'clear_trees': Endurance.labour(p, 10); p.modifyNeed('hygiene', -5); break;
                case 'pickpocket':  p.modifyNeed('fun', 5); p.modifyNeed('comfort', -8); break;
                case 'smuggle':     p.modifyNeed('fun', 5); p.modifyNeed('comfort', -5); break;
                case 'request_meeting': p.modifyNeed('social', 10); break;
                case 'prospect':    Endurance.labour(p, 8); p.modifyNeed('fun', 5); break;
                case 'tame_horse':  p.modifyNeed('fun', 10); Endurance.labour(p, 8); break;
                case 'craft_campfire': p.modifyNeed('comfort', 10); p.modifyNeed('fun', 3); break;
                case 'dig_treasure': p.modifyNeed('fun', 10); Endurance.labour(p, 8); p.modifyNeed('hygiene', -5); break;
                case 'odd_jobs':    Endurance.labour(p, 8); p.modifyNeed('social', 5); break;
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
            case 'pass_time':
                // Wait a day, three, a week … (ui/actionMenu/timeSkip.js; each day the real End Turn)
                ActionMenu.showWaitMenu(game);
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
            case 'landing_party':
                ActionMenu.showLandingParty(game);
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
            case 'raid_haven':
            case 'sea_rovers':
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
            case 'meet_trader':
                ActionMenu.showTrader(game, unitId);
                break;
            case 'meet_courier':
                ActionMenu.showRider(game, unitId);
                break;
            case 'meet_rival_house':
                ActionMenu.showRivalHead(game, unitId);
                break;
            case 'outlaw_lair': {
                const lair = OutlawLairs.lairNear(game.player, game.world, tile.q, tile.r, 1);
                ActionMenu.showOutlawLairs(game, lair ? lair.id : null);
                break;
            }
            case 'tavern':
                ActionMenu.showTavernMenu(game, tile);
                break;
            case 'lodging':
                ActionMenu.showLodgings(game, tile, unitId || null);
                break;
            case 'manage_lodging':
                ActionMenu.lodgingAct(game, 'tab', unitId, 'run');
                break;
            case 'town_sickness':
                ActionMenu.showSickness(game);
                break;
            case 'graveyards':
                ActionMenu.showGraveyards(game);
                break;
            case 'town_lots':
                ActionMenu.showTownLots(game);
                break;
            case 'livestock_market':
                ActionMenu.showLivestockMarket(game);
                break;
            case 'my_herds':
                ActionMenu.showHerds(game);
                break;
            case 'furniture_maker':
                ActionMenu.showFurnitureShop(game);
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
            case 'jail_cell':
                ActionMenu.attemptJailbreak(game, 'cell');
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
            case 'wash_clothes':
                ActionMenu.doWashClothes(game);
                break;
            case 'bathe':
                ActionMenu.doBathe(game);
                break;
            case 'chart_tile':
                ActionMenu.doChartTile(game);
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
            case 'army_command':
                ActionMenu.showArmyCommand(game);
                break;
            case 'household_guard':
                ActionMenu.showHouseholdGuard(game);
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
            case 'royal_court':
                ActionMenu.showRoyalCourt(game, tile);
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
            case 'patronage':
                ActionMenu.showPatronage(game, tile);
                break;
            case 'bank':
                ActionMenu.showBank(game, tile);
                break;
            case 'found_bank':
                ActionMenu.showBank(game, tile, 'house');
                break;
            case 'underwriter':
                ActionMenu.showUnderwriter(game, tile);
                break;
            case 'bourse':
                ActionMenu.showBourse(game);
                break;
            case 'public_works':
                ActionMenu.showPublicWorks(game, tile);
                break;
            case 'mint':
                ActionMenu.showMint(game, tile);
                break;
            case 'treasury':
                ActionMenu.showTreasury(game);
                break;
            case 'estates':
                ActionMenu.showEstates(game, tile, 'here');
                break;
            case 'putting_out':
                ActionMenu.showPuttingOut(game, tile);
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
            case 'stolen_goods':
                ActionMenu.showScene(game, 'stolen_goods', { q: tile.q, r: tile.r });
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
            case 'languages':
                ActionMenu.showLanguages(game);
                break;
            case 'commissions':
                ActionMenu.showCommissions(game);
                break;
            case 'arms_armour':
                ActionMenu.showArms(game);
                break;
            case 'your_parents':
                // Under your parents' roof (player/parentage.js; ui/actionMenu/parents.js)
                if (Parentage.state(game.player) && Parentage.state(game.player).pending) ActionMenu.showParentPicker(game);
                else ActionMenu.showParents(game);
                break;
            case 'dawn_instep': {
                // The Dawn of Man: the clan walks with you hex for hex, or at its own pace (world/dawn.js keepStep)
                const p = game.player;
                p.dawnInStep = !p.dawnInStep;
                const clan = Dawn.kinClan(game.world, p);
                const beside = clan && Hex.wrappingOffsetDistance(clan.q, clan.r, p.q, p.r, game.world.width) <= 1;
                if (p.dawnInStep && beside) { clan.q = p.q; clan.r = p.r; }
                game.ui.showNotification(p.dawnInStep ? '👣 In step' : '🐾 At their own pace',
                    p.dawnInStep ? (beside ? 'Your clan walks with you now, hex for hex, wherever they can follow on foot.' : 'Your clan will fall in step as soon as you are beside them.')
                        : 'Your clan follows at its own pace again, two hexes a day, within a few leagues of you.', 'info');
                break;
            }
            case 'dawn_settle': {
                // The Dawn of Man: the clan makes camp for good (player/dawnBirth.js)
                const res = DawnBirth.settleHere(game.player, game.world);
                game.ui.showNotification(res.success ? '🔥 A village is founded' : '🔥 Not here', res.success ? res.text : res.reason, res.success ? 'success' : 'error');
                if (res.success) {
                    if (typeof game.world.invalidateSettlements === 'function') game.world.invalidateSettlements();
                    if (game.minimap && game.minimap.invalidate) game.minimap.invalidate();
                }
                game.ui.updateStats(game.player, game.world);
                break;
            }
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
            case 'hire_sailors':
                ActionMenu.showHireSailorsMenu(game, tile);
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
            case 'guildhall':
                ActionMenu.showGuildhall(game, tile);
                break;
            case 'post_house':
                ActionMenu.lettersAct(game, 'tab', 'post');
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
