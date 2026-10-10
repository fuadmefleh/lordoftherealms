// ActionMenu — The Steward's Counsel: what deserves the player's attention
// right now (threats, opportunities, goals), read from every system by
// systems/counsel.js. Opened from the "Counsel" top tab (ui/ui/hud.js),
// which also carries the threat-count badge; the morning brief (the top
// three items as one notification on a new day) is shown by ui/game/endDay.js
// unless the "Steward's Morning Brief" setting is off.
// Buttons route through data-am-act="counselGo" data-am-args='["itemId", "panel"|"map"]'.
import { ActionMenu } from './_ref.js';
import { Counsel } from '../../systems/counsel.js';

const CARD = 'background:rgba(0,0,0,0.3);padding:8px 10px;border-radius:8px;margin-bottom:8px;';
const MUTED = 'color:var(--text-secondary);font-size:11px;';
const BTN = 'padding:3px 8px;margin-left:4px;border-radius:6px;cursor:pointer;font-family:var(--font-body);font-size:11px;color:#eee;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.25);white-space:nowrap;';
const SEV_COLOR = { critical: '#ff6b5b', warning: '#f5b342', notice: '#8fc4ff', info: '#9a9a9a' };
const GROUPS = [
    { key: 'threats', title: 'Threats', icon: '⚠️', empty: 'Nothing threatens you today.' },
    { key: 'opportunities', title: 'Opportunities', icon: '✨', empty: 'No opportunity stands out.' },
    { key: 'goals', title: 'Goals', icon: '🎯', empty: 'No goal in reach.' },
];
const SHOWN_PER_GROUP = 8;

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const _here = (game) => game.world.getTile(game.player.q, game.player.r);

/**
 * Action-hook panel ids (data/counsel.json rules → "panel") → how to open
 * them. `settlement: true` panels need the player standing in a settlement;
 * elsewhere the Steward points at the map instead.
 */
export const COUNSEL_PANELS = {
    holdingSieges: { label: 'Sieges', open: (g) => ActionMenu.showHoldingSiegesPanel(g) },
    royalCourt: { label: 'Court', open: (g) => ActionMenu.showRoyalCourt(g, _here(g), 'council') },
    royalFactions: { label: 'Factions', open: (g) => ActionMenu.showRoyalCourt(g, _here(g), 'vassals') },
    royalEdicts: { label: 'Edicts', open: (g) => ActionMenu.showRoyalCourt(g, _here(g), 'edicts') },
    royalVassals: { label: 'Vassals', open: (g) => ActionMenu.showRoyalCourt(g, _here(g), 'vassals') },
    realmWars: { label: 'Wars', open: (g) => ActionMenu.showRealmWarsMenu(g, _here(g)) },
    physician: { label: 'Physician', settlement: true, open: (g) => ActionMenu.showPhysicianMenu(g, _here(g)) },
    petitions: { label: 'Petitions', open: (g) => ActionMenu.showCourtPanel(g, _here(g)) },
    underworld: { label: 'Underworld', settlement: true, open: (g) => ActionMenu.showUnderworldPanel(g, _here(g)) },
    travelParty: { label: 'Party', open: (g) => ActionMenu.showTravelPartyMenu(g, _here(g)) },
    mercenaries: { label: 'Contracts', settlement: true, open: (g) => ActionMenu.showContractMenu(g, _here(g)) },
    fleet: { label: 'Fleet', open: (g) => ActionMenu.showFleetMenu(g, _here(g)) },
    rivals: { label: 'Rivals', open: (g) => ActionMenu.showRivalsPanel(g, _here(g)) },
    sagas: { label: 'Sagas', open: (g) => ActionMenu.showSagasJournal(g) },
    discoveries: { label: 'Discoveries', open: (g) => ActionMenu.showDiscoveries(g) },
    outlawLairs: { label: 'Outlaws', open: (g) => ActionMenu.showOutlawLairs(g) },
    claims: { label: 'Claims', open: (g) => ActionMenu.showClaimsPanel(g, _here(g)) },
    company: { label: 'Company', open: (g) => ActionMenu.showTradingCompany(g, _here(g)) },
    bounties: { label: 'Bounties', settlement: true, open: (g) => ActionMenu.showBountyBoardMenu(g, _here(g)) },
    house: { label: 'House', open: (g) => ActionMenu.showHousePanel(g, _here(g)) },
    patronage: { label: 'Patronage', open: (g) => ActionMenu.showPatronage(g, _here(g)) },
    bank: { label: 'Bank', open: (g) => ActionMenu.showBank(g, _here(g)) },
    underwriter: { label: 'Underwriters', open: (g) => ActionMenu.showUnderwriter(g, _here(g)) },
    bourse: { label: 'Bourse', open: (g) => ActionMenu.showBourse(g) },
    mint: { label: 'The Mint', open: (g) => ActionMenu.showMint(g) },
    estates: { label: 'Estates', open: (g, item) => ActionMenu.showEstates(g, item && item.action.q !== null ? g.world.getTile(item.action.q, item.action.r) : _here(g)) },
    puttingOut: { label: 'Putting-out', open: (g, item) => ActionMenu.showPuttingOut(g, item && item.action.q !== null ? g.world.getTile(item.action.q, item.action.r) : _here(g)) },
    merchantPrince: { label: 'Market', open: (g) => ActionMenu.showMerchantPrince(g, _here(g), 'ledger') },
    mpWarehouse: { label: 'Store-room', open: (g) => ActionMenu.showMerchantPrince(g, _here(g), 'warehouse') },
    mpContracts: { label: 'Contracts', open: (g) => ActionMenu.showMerchantPrince(g, _here(g), 'contracts') },
    guilds: { label: 'Guildhall', open: (g) => ActionMenu.showGuildhall(g, _here(g)) },
    tradePolicy: { label: 'Trade Policy', open: (g) => ActionMenu.showTradePolicy(g) },
    economy: { label: 'Economy', open: (g) => ActionMenu.showEconomy(g) },
    child: { label: 'Heir', open: (g, item) => ActionMenu.showChildPanel(g, item.action.arg) },
    tournament: { label: 'Tournament', settlement: true, open: (g) => ActionMenu.showTournamentMenu(g, _here(g)) },
    hinterland: { label: 'Hinterland', open: (g, item) => ActionMenu.showHinterland(g, item && item.action.q !== null ? g.world.getTile(item.action.q, item.action.r) : _here(g)) },
    harvests: { label: 'Harvests', open: (g) => ActionMenu.showHarvests(g, _here(g)) },
    publicWorks: { label: 'Public Works', open: (g, item) => ActionMenu.showPublicWorks(g, item && item.action.q !== null ? g.world.getTile(item.action.q, item.action.r) : _here(g)) },
    townPeople: { label: 'People', open: (g, item) => ActionMenu.showTownPeople(g, item && item.action.q !== null ? g.world.getTile(item.action.q, item.action.r) : _here(g)) },
    holding: { label: 'Holding', open: (g, item) => ActionMenu.showHoldingPanel(g, item && item.action.q !== null ? g.world.getTile(item.action.q, item.action.r) : _here(g)) },
    deeds: { label: 'Records', open: (g) => ActionMenu.showDeeds(g) },
    quests: { label: 'Quests', open: (g) => g.ui.showQuestsPanel() },
    character: { label: 'Character', open: (g) => g.ui.showCharacterPanel() },
    inventory: { label: 'Inventory', open: (g) => g.ui.showInventoryPanel() },
    treasury: { label: 'Treasury', open: (g) => g.ui.showTreasuryPanel(g.player, g.world) },
};

function _focus(game, q, r) {
    if (!game.renderer || !game.camera || typeof game.renderer.getHexPixelPos !== 'function') return;
    const pos = game.renderer.getHexPixelPos(q, r);
    if (pos && game.camera.centerOn) game.camera.centerOn(pos.x, pos.y);
}

function _itemRow(item) {
    const color = SEV_COLOR[item.severity] || SEV_COLOR.info;
    const panel = item.action.panel && COUNSEL_PANELS[item.action.panel];
    const hasHex = item.action.q !== null && item.action.r !== null;
    let btns = '';
    if (panel) btns += `<button data-am-act="counselGo" data-am-args='${_esc(JSON.stringify([item.id, 'panel']))}' style="${BTN}">${_esc(panel.label)} ›</button>`;
    if (hasHex) btns += `<button data-am-act="counselGo" data-am-args='${_esc(JSON.stringify([item.id, 'map']))}' style="${BTN}" title="Show on the map">📍</button>`;
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06);">`
        + `<span style="width:4px;align-self:stretch;border-radius:2px;background:${color};"></span>`
        + `<span style="font-size:14px;">${_esc(item.icon)}</span>`
        + `<span style="flex:1;font-size:12px;color:#ddd;">${_esc(item.text)}</span>`
        + `<span style="display:flex;">${btns}</span></div>`;
}

/** Refresh the threat-count badge on the Counsel top tab (called from updateStats). */
export function updateCounselBadge(game) {
    if (typeof document === 'undefined' || !game || !game.player) return;
    const el = document.getElementById('counselBadge');
    if (!el) return;
    let n = 0;
    let worst = 'info';
    try {
        const s = Counsel.scan(game.player, game.world);
        n = s.threats.length;
        if (n) worst = s.threats[0].severity;
    } catch (e) {
        n = 0;
    }
    el.textContent = n > 9 ? '9+' : String(n);
    el.style.display = n > 0 ? 'inline-block' : 'none';
    el.style.background = worst === 'critical' ? '#c0392b' : '#b7791f';
}

/** The morning brief: one notification with the top three items (new days only). */
export function showMorningBrief(game) {
    if (!game || !game.ui || game.ui._morningBrief === false) return;
    let top = [];
    try {
        top = Counsel.brief(game.player, game.world);
    } catch (e) {
        top = [];
    }
    if (!top.length) return;
    // showNotification renders HTML: escape each line, one per row
    const text = top.map(i => `${_esc(i.icon)} ${_esc(i.text)}`).join('<br>');
    const worst = top.some(i => i.severity === 'critical') ? 'warning' : 'info';
    game.ui.showNotification('🗝️ The Steward\'s Brief', text, worst);
}

Object.assign(ActionMenu, {
    /** The Counsel panel: the top items per group, each with a button to act. */
    showCounsel(game) {
        const s = Counsel.scan(game.player, game.world, { fresh: true });
        let html = '<div style="max-height:560px;overflow-y:auto;min-width:380px;">';
        html += `<div style="${MUTED} margin-bottom:8px;">Your steward weighs every matter of the realm and household, and sets the most pressing before you.</div>`;
        for (const g of GROUPS) {
            const list = s[g.key] || [];
            html += `<div style="${CARD}"><div style="font-weight:bold;color:var(--gold);font-size:13px;margin-bottom:4px;">${g.icon} ${g.title}${list.length ? ` <span style="${MUTED}">(${list.length})</span>` : ''}</div>`;
            if (!list.length) html += `<div style="${MUTED}">${g.empty}</div>`;
            for (const item of list.slice(0, SHOWN_PER_GROUP)) html += _itemRow(item);
            if (list.length > SHOWN_PER_GROUP) html += `<div style="${MUTED} margin-top:4px;">…and ${list.length - SHOWN_PER_GROUP} lesser matters.</div>`;
            html += '</div>';
        }
        html += '</div>';
        game.ui.showCustomPanel('🗝️ The Steward\'s Counsel', html);
    },

    /** A Counsel button: open the item's panel, or focus its hex on the map. */
    counselGo(game, itemId, mode = 'panel') {
        const s = Counsel.scan(game.player, game.world);
        const item = s.items.find(i => i.id === itemId);
        if (!item) {
            game.ui.showNotification('🗝️ Counsel', 'That matter has passed.', 'info');
            ActionMenu.showCounsel(game);
            return;
        }
        const { q, r } = item.action;
        const hasHex = q !== null && r !== null;
        const panel = item.action.panel && COUNSEL_PANELS[item.action.panel];
        if (mode === 'map' || !panel) {
            if (hasHex) {
                if (typeof ActionMenu.closePanel === 'function') ActionMenu.closePanel(game);
                _focus(game, q, r);
            }
            return;
        }
        const here = _here(game);
        if (panel.settlement && !(here && here.settlement)) {
            game.ui.showNotification('🗝️ Counsel', hasHex ? 'That is dealt with in a town. The Steward marks the place on your map.' : 'That is dealt with in a town.', 'info');
            if (hasHex) _focus(game, q, r);
            return;
        }
        try {
            panel.open(game, item);
        } catch (e) {
            console.warn('[Counsel] panel failed', item.action.panel, e);
            if (hasHex) _focus(game, q, r);
        }
    },
});
