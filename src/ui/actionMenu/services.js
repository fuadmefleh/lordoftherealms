// ActionMenu — settlement building services (blacksmith, temple, stable,
// guard tower, town hall, manor). Logic lives in player/settlementServices.js;
// these panels present it and route to existing menus where one already exists.
import { ActionMenu } from './_ref.js';
import { PlayerActions, SettlementServices, SERVICE_CONFIG } from './_imports.js';

const BTN = 'width: 100%; padding: 9px; margin-top: 6px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 10px 12px; margin: 10px 0;';

/** Court actions an audience with the lord can lead to (all existing world actions). */
const AUDIENCE_ACTIONS = [
    'pledge_allegiance', 'renounce_allegiance', 'seek_title', 'view_title_status',
    'collect_tax', 'hold_council', 'form_kingdom', 'request_bounty',
    'host_feast', 'hold_tournament', 'host_festival', 'manage_house',
];

function _button(label, handler, enabled = true) {
    return enabled
        ? `<button onclick="window._svc.${handler}()" style="${BTN_GOLD}">${label}</button>`
        : `<button disabled style="${BTN_DIM}">${label}</button>`;
}

function _days(player, key) {
    return (player.blessings && player.blessings[key]) || 0;
}

Object.assign(ActionMenu, {
    /** Run a service result: notify, refresh, and re-open the panel. */
    _serviceResult(game, title, result, reopen) {
        if (result.success) {
            game.ui.showNotification(title, result.message, 'success');
        } else {
            game.ui.showNotification(title, result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
        if (result.success && reopen) reopen();
    },

    // ──────────── BLACKSMITH ────────────
    showBlacksmithMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const cfg = SERVICE_CONFIG.honedArms;
        const cost = SettlementServices.honeArmsCost(player, settlement);
        const units = (player.army || []).length;
        const active = _days(player, cfg.key);

        let html = '<div>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">The forge roars. The smith eyes your gear with a professional frown.</p>`;
        html += `<div style="${CARD}">`;
        html += `<div style="font-weight: bold;">⚔️ Hone Your Company's Arms</div>`;
        html += `<div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">Sharpen blades and mend armour for every soldier: army strength +${Math.round(cfg.strengthBonus * 100)}% for ${cfg.days} days.</div>`;
        if (active > 0) html += `<div style="font-size: 12px; color: #5ddb6a;">Your arms are honed — ${active} day${active > 1 ? 's' : ''} left.</div>`;
        html += units > 0
            ? _button(`Hone ${units} soldier${units > 1 ? 's' : ''}' arms (${cost}g)`, 'hone', player.gold >= cost)
            : _button('You have no soldiers', 'hone', false);
        html += '</div>';
        html += _button('🛒 Browse weapons and tools', 'shop');
        html += '</div>';

        game.ui.showCustomPanel('⚒️ Blacksmith', html);
        window._svc = {
            hone: () => ActionMenu._serviceResult(game, '⚒️ Blacksmith', SettlementServices.honeArms(player, settlement),
                () => ActionMenu.showBlacksmithMenu(game, tile)),
            shop: () => { game.ui.hideCustomPanel(); ActionMenu.handleAction(game, tile, 'trade'); },
        };
    },

    // ──────────── TEMPLE ────────────
    showBlessingMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const cfg = SERVICE_CONFIG.blessing;
        const cost = SettlementServices.blessingCost(settlement);
        const active = _days(player, cfg.key);

        let html = '<div>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">Incense hangs in the air. A priest offers to bless travellers for a modest offering.</p>`;
        html += `<div style="${CARD}">`;
        html += `<div style="font-weight: bold;">✨ Blessing for the Road</div>`;
        html += `<div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">+${cfg.movementBonus} movement and +${cfg.healthRegen} healing each day for ${cfg.days} days, and +1 karma.</div>`;
        if (active > 0) html += `<div style="font-size: 12px; color: #5ddb6a;">You are blessed — ${active} day${active > 1 ? 's' : ''} left.</div>`;
        html += _button(`Make an offering (${cost}g)`, 'bless', player.gold >= cost);
        html += '</div></div>';

        game.ui.showCustomPanel('⛪ Temple', html);
        window._svc = {
            bless: () => ActionMenu._serviceResult(game, '✨ Blessing', SettlementServices.seekBlessing(player, settlement),
                () => ActionMenu.showBlessingMenu(game, tile)),
        };
    },

    // ──────────── STABLE ────────────
    showStableMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const cfg = SERVICE_CONFIG.mount;
        const price = SettlementServices.mountPrice(settlement);
        const tamed = (player.inventory && player.inventory.horse) || 0;
        const reopen = () => ActionMenu.showStableMenu(game, tile);

        let html = '<div>';
        html += `<div style="${CARD}">`;
        if (player.mount) {
            const resale = Math.round((player.mount.price || cfg.price) * cfg.resaleRate);
            html += `<div style="font-weight: bold;">🐴 Your mount: ${player.mount.name}</div>`;
            html += `<div style="font-size: 12px; color: #5ddb6a; margin: 4px 0;">+${cfg.movementBonus} movement each day.</div>`;
            html += _button(`Sell ${player.mount.name} (${resale}g)`, 'sellMount');
        } else {
            html += `<div style="font-weight: bold;">🐎 Riding Horse</div>`;
            html += `<div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">A mount carries you +${cfg.movementBonus} hexes further every day. You can ride one horse at a time.</div>`;
            html += _button(`Buy a riding horse (${price}g)`, 'buy', player.gold >= price);
            if (tamed > 0) html += _button(`Saddle a tamed horse (${cfg.saddleCost}g tack)`, 'saddle', player.gold >= cfg.saddleCost);
        }
        html += '</div>';
        if (tamed > 0) {
            html += `<div style="${CARD}">`;
            html += `<div style="font-size: 12px; color: var(--text-secondary);">The stable master will buy tamed horses for ${cfg.tamedHorseSale}g each.</div>`;
            html += _button(`Sell ${tamed} tamed horse${tamed > 1 ? 's' : ''} (${tamed * cfg.tamedHorseSale}g)`, 'sellTamed');
            html += '</div>';
        }
        html += '</div>';

        game.ui.showCustomPanel('🐴 Stable', html);
        const day = game.world ? game.world.day : 0;
        window._svc = {
            buy: () => ActionMenu._serviceResult(game, '🐴 Stable', SettlementServices.buyMount(player, settlement, day), reopen),
            saddle: () => ActionMenu._serviceResult(game, '🐴 Stable', SettlementServices.saddleTamedHorse(player, day), reopen),
            sellMount: () => ActionMenu._serviceResult(game, '🐴 Stable', SettlementServices.sellMount(player), reopen),
            sellTamed: () => ActionMenu._serviceResult(game, '🐴 Stable', SettlementServices.sellTamedHorses(player), reopen),
        };
    },

    // ──────────── GUARD TOWER ────────────
    showGuardMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const offenses = SettlementServices.offenseCount(player);
        const bounty = SettlementServices.bountyOwed(player, settlement);
        const warrant = SettlementServices.hasWarrant(player, settlement);
        const fine = SettlementServices.fineAmount(player, settlement) + bounty + (warrant ? SERVICE_CONFIG.fines.warrantFee : 0);

        let html = '<div>';
        if (offenses === 0 && bounty === 0 && !warrant) {
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">The guard captain checks the ledger and grunts. "Nothing on you. Keep it that way."</p>`;
            html += _button('📜 Check the bounty board', 'bounties');
        } else {
            const rec = player.criminalRecord || {};
            const lines = Object.entries(rec).filter(([, n]) => n > 0)
                .map(([crime, n]) => `${crime.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())} ×${n}`);
            if (bounty) lines.push(`Bounty on your head: ${bounty}g`);
            if (warrant) lines.push(`Royal warrant for your arrest (+${SERVICE_CONFIG.fines.warrantFee}g)`);
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">The captain taps the ledger. "${warrant ? "There's a warrant out for you. Pay up, or hang." : "You've a record, friend."}"</p>`;
            html += `<div style="${CARD}">`;
            html += `<div style="font-weight: bold;">🗂️ Your record</div>`;
            html += `<div style="font-size: 12px; color: #e86a6a; margin: 4px 0;">${lines.join(', ')}</div>`;
            html += `<div style="font-size: 12px; color: var(--text-secondary);">Settling wipes your record, pays off this crown's bounties and lifts its warrant, so merchants will deal with you again and the guards stand down.</div>`;
            html += _button(`Settle everything (${fine}g)`, 'pay', player.gold >= fine);
            html += '</div>';
        }
        html += '</div>';

        game.ui.showCustomPanel('🗼 Guard Tower', html);
        window._svc = {
            pay: () => ActionMenu._serviceResult(game, '🗼 Guards', SettlementServices.payFines(player, settlement),
                () => ActionMenu.showGuardMenu(game, tile)),
            bounties: () => { game.ui.hideCustomPanel(); ActionMenu.handleAction(game, tile, 'bounty_board'); },
        };
    },

    // ──────────── TOWN HALL ────────────
    showTributeMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const kingdom = settlement && settlement.kingdom ? game.world.getKingdom(settlement.kingdom) : null;
        const tiers = SERVICE_CONFIG.tribute.tiers;
        const rep = kingdom ? ((player.reputation && player.reputation[kingdom.id]) || 0) : 0;

        let html = '<div>';
        if (!kingdom) {
            html += `<p style="font-size: 12px; color: var(--text-secondary);">This settlement answers to no crown. There is no one to pay.</p>`;
        } else {
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">The tax clerk of ${kingdom.name} looks up hopefully. A voluntary contribution to the crown is always remembered.</p>`;
            html += `<div style="font-size: 12px; margin-bottom: 6px;">Your standing with ${kingdom.name}: <strong>${rep}</strong></div>`;
            tiers.forEach((amount, i) => {
                const gain = Math.floor(amount / SERVICE_CONFIG.tribute.goldPerReputation);
                html += _button(`Pay ${amount}g tribute (+${gain} reputation)`, `t${i}`, player.gold >= amount);
            });
        }
        html += '</div>';

        game.ui.showCustomPanel('💰 Tax Office', html);
        window._svc = {};
        tiers.forEach((amount, i) => {
            window._svc[`t${i}`] = () => ActionMenu._serviceResult(game, '💰 Tribute',
                SettlementServices.payTribute(player, settlement, amount),
                () => ActionMenu.showTributeMenu(game, tile));
        });
    },

    // ──────────── MANOR / AUDIENCE ────────────
    showAudienceMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const kingdom = settlement && settlement.kingdom ? game.world.getKingdom(settlement.kingdom) : null;
        const available = (PlayerActions.getAvailableActions(player, tile, game.world) || [])
            .filter(a => AUDIENCE_ACTIONS.includes(a.type));

        let html = '<div>';
        const ruler = kingdom && kingdom.ruler ? (kingdom.ruler.name || kingdom.ruler) : null;
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">`;
        html += kingdom
            ? `You are shown into the hall${ruler ? ` where the steward of ${ruler}` : ''} hears petitions on behalf of ${kingdom.name}.`
            : 'The hall is quiet. The local elders hear you out.';
        html += '</p>';
        if (available.length === 0) {
            html += `<div style="${CARD} font-size: 12px; color: var(--text-secondary);">There is nothing for you to petition here yet. Earn standing with the realm, and pledge yourself to it, to open the doors of office.</div>`;
        }
        available.forEach((a, i) => {
            html += `<button onclick="window._svc.a${i}()" style="${BTN} text-align: left; background: rgba(255,255,255,0.05); color: var(--text-primary, #e6e1d6); border: 1px solid rgba(245,197,66,0.25);">${a.icon || '•'} ${a.label}<div style="font-size: 11px; font-weight: normal; color: var(--text-secondary);">${a.description || ''}</div></button>`;
        });
        html += _button('💰 Pay tribute to the crown', 'tribute', !!kingdom);
        html += '</div>';

        game.ui.showCustomPanel('🏛️ Audience', html);
        window._svc = {
            tribute: () => ActionMenu.showTributeMenu(game, tile),
        };
        available.forEach((a, i) => {
            window._svc[`a${i}`] = () => { game.ui.hideCustomPanel(); ActionMenu.handleAction(game, tile, a.type, a.unitId); };
        });
    },
});
