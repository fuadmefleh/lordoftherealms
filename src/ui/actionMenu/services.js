// ActionMenu — settlement building services (blacksmith, temple, stable,
// guard tower, town hall, manor). Logic lives in player/settlementServices.js;
// these panels present it and route to existing menus where one already exists.
import { ActionMenu } from './_ref.js';
import { DevotionPanel } from './devotion.js';
import { PlayerActions, SettlementServices, SERVICE_CONFIG, Relationships } from './_imports.js';
import { Ailments } from '../../systems/ailments.js';
import { TradeSkills } from '../../systems/tradeSkills.js';
import { lede, chips, purse, sectionHead, card, actRow, rowList, price } from './uiKit.js';
import { Names } from '../../core/names.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): a lede, then one row a
// service, its price at the right, greyed with its reason when out of reach
const NOTE = 'font-size: 11px; color: #9d937c; margin: 2px 0;';

/** Court actions an audience with the lord can lead to (all existing world actions). */
const AUDIENCE_ACTIONS = [
    'pledge_allegiance', 'renounce_allegiance', 'seek_title', 'view_title_status',
    'collect_tax', 'hold_council', 'form_kingdom', 'request_bounty',
    'host_feast', 'hold_tournament', 'host_festival', 'manage_house',
];

/** One service as a row running window._svc[handler](); greyed (with o.why) when not enabled. */
function _row(o, handler, enabled = true) {
    return actRow({ ...o, off: !enabled, attrs: enabled ? `onclick="window._svc.${handler}()"` : '' });
}

function _days(player, key) {
    return (player.blessings && player.blessings[key]) || 0;
}

Object.assign(ActionMenu, {
    /** Run a service result: notify, refresh, and re-open the panel. */
    _serviceResult(game, title, result, reopen) {
        if (result.success) {
            game.ui.showNotification(title, result.message, 'success');
            // a practised skill that rose doing it (systems/practiceSkills.js)
            if (result.levelUp) game.ui.showNotification(`${result.levelUp.icon} ${result.levelUp.name} Improved`, result.levelUp.text, 'success');
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
        const hone = SettlementServices.honeArmsDays(settlement, game.world);
        html += lede(`The forge roars. ${hone.smith ? `${hone.smith.name}, the best hand at the anvil here (Smithing ${hone.smith.level}, ${hone.smith.levelName}),` : 'The smith'} eyes your gear with a professional frown.`);
        html += chips([
            purse(player.gold),
            ['⚔️', 'Soldiers', units],
            active > 0 ? { icon: '⚔️', label: 'Honed', value: `${active} day${active > 1 ? 's' : ''} left` } : null,
        ]);
        const desc = `Sharpen blades and mend armour for every soldier: army strength +${Math.round(cfg.strengthBonus * 100)}% for ${hone.days} days.`;
        html += rowList([
            _row({
                icon: '⚔️', name: units > 0 ? `Hone ${units} soldier${units > 1 ? 's' : ''}' arms` : 'Hone Your Company\'s Arms',
                desc, why: units > 0 ? `${desc} Your purse is short.` : 'You have no soldiers',
                note: active > 0 ? `Your arms are honed — ${active} day${active > 1 ? 's' : ''} left.` : '',
                side: units > 0 ? price(cost, player.gold >= cost) : '',
            }, 'hone', units > 0 && player.gold >= cost),
            _row({ icon: '🛒', name: 'Browse weapons and tools', desc: 'The smith\'s wares' }, 'shop'),
        ], 'The forge');
        html += '</div>';

        game.ui.showCustomPanel('⚒️ Blacksmith', html);
        window._svc = {
            hone: () => ActionMenu._serviceResult(game, '⚒️ Blacksmith', SettlementServices.honeArms(player, settlement, game.world),
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
        html += lede('Incense hangs in the air. A priest offers to bless travellers for a modest offering.');
        html += chips([
            purse(player.gold),
            active > 0 ? { icon: '✨', label: 'Blessed', value: `${active} day${active > 1 ? 's' : ''} left` } : null,
        ]);
        const rows = [_row({
            icon: '✨', name: 'Blessing for the Road',
            desc: `+${cfg.movementBonus} movement and +${cfg.healthRegen} healing each day for ${cfg.days} days, and +1 karma. Make an offering.`,
            why: `Make an offering of ${cost}g — your purse is short.`,
            note: active > 0 ? `You are blessed — ${active} day${active > 1 ? 's' : ''} left.` : '',
            side: price(cost, player.gold >= cost),
        }, 'bless', player.gold >= cost)];
        // Healing rites for the sick (systems/ailments.js) — the priests tend fevers, not wounds
        const rites = Ailments.treatmentOptions(player, game.world, settlement, true).filter(o => o.kind === 'disease');
        html += rowList(rows, 'The priests');
        if (rites.length) {
            html += sectionHead('🕯️ Healing Rites');
            html += `<div style="${NOTE}">The priests pray over the sick and dose them with temple remedies. Your faith counts (${Math.round(Ailments.templeQuality(player) * 100)}% care).${(((Ailments.cfg().treatment || {}).temple || {}).karma || 0) > 0 ? ` +${Ailments.cfg().treatment.temple.karma} karma.` : ''}</div>`;
            html += rowList(rites.map((o, i) => _row({
                icon: o.icon, name: `Tend your ${o.name.toLowerCase()}`, why: o.reason || 'Out of reach',
                side: price(o.cost, (player.gold || 0) >= o.cost),
            }, `rite${i}`, o.can)));
        }
        // Prayer, alms, vows and pilgrimages, the soul's redemption (ui/actionMenu/devotion.js)
        html += DevotionPanel.templeCardHtml(game, tile);
        html += '</div>';

        game.ui.showCustomPanel('⛪ Temple', html);
        DevotionPanel.bindTemple(game, tile);
        const reopen = () => ActionMenu.showBlessingMenu(game, tile);
        window._svc = {
            bless: () => ActionMenu._serviceResult(game, '✨ Blessing', SettlementServices.seekBlessing(player, settlement), reopen),
        };
        rites.forEach((o, i) => {
            window._svc[`rite${i}`] = () => ActionMenu._serviceResult(game, '🕯️ Healing Rites',
                Ailments.treat(player, game.world, settlement, o.key, true), reopen);
        });
    },

    // ──────────── PHYSICIAN / HERBALIST ────────────
    /**
     * Treat wounds and sickness (systems/ailments.js). A village has only a
     * herbalist; towns and cities have physicians, better with your medicine
     * techs (Herbalism, Surgery, Plague Prevention, Hospital).
     */
    showPhysicianMenu(game, tile) {
        const player = game.player;
        const settlement = tile && tile.settlement;
        if (!settlement) {
            game.ui.showNotification('⚕️ Physician', 'There is no one here to treat you.', 'info');
            return;
        }
        const reopen = () => ActionMenu.showPhysicianMenu(game, tile);
        const who = settlement.type === 'village' ? 'herbalist' : 'physician';
        const options = Ailments.treatmentOptions(player, game.world, settlement, false);
        const info = Ailments.describe(player, game.world);
        const sickParty = Ailments.sickCompanions(player);

        let html = '<div>';
        html += lede(who === 'herbalist'
            ? 'The village herbalist clears a bench among drying bundles of herbs.'
            : `The ${settlement.type}'s physician washes his hands and looks you over.`);
        // Who treats here, and how good they are (Medicine, systems/tradeSkills.js)
        const doc = TradeSkills.physician(settlement, game.world);
        html += chips([
            { icon: '⚕️', label: doc.name ? `${doc.name}, ${doc.role}` : `The ${who}`, value: `Medicine ${doc.level} (${doc.levelName})` },
            purse(player.gold),
        ]);
        html += `<div style="font-size: 11px; color: #8fb98a; margin-bottom: 6px;">${doc.level > doc.typical ? 'Better than most here. ' : doc.level < doc.typical ? 'Not the best of healers. ' : ''}Watching them work teaches you a little.</div>`;
        if (!options.length && !sickParty.length) {
            html += card(`<div style="font-size: 12px; color: #cbbf9f; font-style: italic;">"You're as sound as a bell. Come back when something hurts."</div>`);
        }
        html += rowList(options.map((o, i) => {
            const d = info.find(x => x.key === o.key) || {};
            const when = `${d.timeText || ''}${d.note ? ` — ${d.note}` : ''}`;
            const desc = `${d.effects ? `<span style="color: #e0846a;">${d.effects}</span> · ` : ''}${when}`;
            return _row({
                icon: o.icon, name: o.name, desc,
                why: `${desc}${desc ? ' — ' : ''}${o.reason || ''}`,
                note: `Treatment quality here: ${Math.round(o.quality * 100)}%`,
                side: o.can ? `Treat ${price(o.cost, true)}` : price(o.cost, false),
            }, `t${i}`, o.can);
        }), options.length ? 'What ails you' : '');
        html += rowList(sickParty.map((s, i) => {
            let name = 'A companion';
            try { const npc = Relationships.getNPC(s.npcId); if (npc) name = npc.firstName; } catch (e) { /* unknown */ }
            const cost = Ailments.companionTreatmentCost(player, settlement, s.npcId);
            const ok = (player.gold || 0) >= cost;
            return _row({
                icon: '🤒', name: `${name} — ${s.disease}`, desc: `Have ${name} nursed back to health`,
                why: `Have ${name} nursed back to health — your purse is short`, side: price(cost, ok),
            }, `c${i}`, ok);
        }), sickParty.length ? 'Your party' : '');
        html += `<div style="${NOTE} margin-top: 6px;">Resting at an inn or in your own house, a healer in your party and remedies from your pack (herbs, salves, potions, holy water — use them from the Character panel) all help you mend.</div>`;
        html += '</div>';

        game.ui.showCustomPanel(who === 'herbalist' ? '🌿 Herbalist' : '⚕️ Physician', html);
        window._svc = {};
        options.forEach((o, i) => {
            window._svc[`t${i}`] = () => ActionMenu._serviceResult(game, '⚕️ Treatment',
                Ailments.treat(player, game.world, settlement, o.key, false), reopen);
        });
        sickParty.forEach((s, i) => {
            window._svc[`c${i}`] = () => ActionMenu._serviceResult(game, '⚕️ Treatment',
                Ailments.treatCompanion(player, settlement, s.npcId), reopen);
        });
    },

    // ──────────── STABLE ────────────
    showStableMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        const cfg = SERVICE_CONFIG.mount;
        const cost = SettlementServices.mountPrice(settlement);
        const tamed = (player.inventory && player.inventory.horse) || 0;
        const reopen = () => ActionMenu.showStableMenu(game, tile);

        let html = '<div>';
        html += chips([
            purse(player.gold),
            player.mount ? { icon: '🐴', label: 'Your mount', value: player.mount.name } : null,
            tamed > 0 ? ['🐎', 'Tamed horses', tamed] : null,
        ]);
        const rows = [];
        if (player.mount) {
            const resale = Math.round((player.mount.price || cfg.price) * cfg.resaleRate);
            rows.push(actRow({ icon: '🐴', name: `Your mount: ${player.mount.name}`, desc: `<span style="color: #8fd18a;">+${cfg.movementBonus} movement each day.</span>` }));
            rows.push(_row({ icon: '💰', name: `Sell ${player.mount.name}`, side: `+${resale}g`, tone: 'good' }, 'sellMount'));
        } else {
            const desc = `A mount carries you +${cfg.movementBonus} hexes further every day. You can ride one horse at a time.`;
            rows.push(_row({ icon: '🐎', name: 'Buy a riding horse', desc, why: `${desc} Your purse is short.`, side: price(cost, player.gold >= cost) }, 'buy', player.gold >= cost));
            if (tamed > 0) rows.push(_row({ icon: '🏇', name: 'Saddle a tamed horse', desc: `${cfg.saddleCost}g tack`, why: `${cfg.saddleCost}g tack — your purse is short`, side: price(cfg.saddleCost, player.gold >= cfg.saddleCost) }, 'saddle', player.gold >= cfg.saddleCost));
        }
        if (tamed > 0) {
            rows.push(_row({
                icon: '🐎', name: `Sell ${tamed} tamed horse${tamed > 1 ? 's' : ''}`,
                desc: `The stable master will buy tamed horses for ${cfg.tamedHorseSale}g each.`,
                side: `+${tamed * cfg.tamedHorseSale}g`, tone: 'good',
            }, 'sellTamed'));
        }
        html += rowList(rows, player.mount ? 'Your mount' : 'Riding Horse');
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
            html += lede('The guard captain checks the ledger and grunts. "Nothing on you. Keep it that way."');
            html += rowList([_row({ icon: '📜', name: 'Check the bounty board', desc: 'Work for those who keep the peace' }, 'bounties')]);
        } else {
            const rec = player.criminalRecord || {};
            const lines = Object.entries(rec).filter(([, n]) => n > 0)
                .map(([crime, n]) => `${crime.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())} ×${n}`);
            if (bounty) lines.push(`Bounty on your head: ${bounty}g`);
            if (warrant) lines.push(`Royal warrant for your arrest (+${SERVICE_CONFIG.fines.warrantFee}g)`);
            html += lede(`The captain taps the ledger. "${warrant ? "There's a warrant out for you. Pay up, or hang." : "You've a record, friend."}"`);
            html += chips([purse(player.gold), { icon: '⚖️', label: 'Owed', value: `<span style="color: #e0846a;">${fine}g</span>` }]);
            html += card(`<div style="font-size: 12px; color: #e0846a;">${lines.join(', ')}</div>`, { icon: '🗂️', title: 'Your record', tone: 'bad' });
            const desc = 'Settling wipes your record, pays off this crown\'s bounties and lifts its warrant, so merchants will deal with you again and the guards stand down.';
            html += rowList([_row({ icon: '⚖️', name: 'Settle everything', desc, why: `${desc} Your purse is short.`, side: price(fine, player.gold >= fine) }, 'pay', player.gold >= fine)]);
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
            html += lede('This settlement answers to no crown. There is no one to pay.');
        } else {
            html += lede(`The tax clerk of ${Names.realm(kingdom.name)} looks up hopefully. A voluntary contribution to the crown is always remembered.`);
            html += chips([{ icon: '👑', label: `Your standing with ${Names.realm(kingdom.name)}`, value: rep, cls: 'gold' }, purse(player.gold)]);
            html += rowList(tiers.map((amount, i) => {
                const gain = Math.floor(amount / SERVICE_CONFIG.tribute.goldPerReputation);
                return _row({
                    icon: '💰', name: `Pay ${amount}g tribute`, desc: `+${gain} reputation`,
                    why: `+${gain} reputation — your purse is short`, side: price(amount, player.gold >= amount),
                }, `t${i}`, player.gold >= amount);
            }), 'Tribute');
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
        html += lede(kingdom
            ? `You are shown into the hall${ruler ? ` where the steward of ${ruler}` : ''} hears petitions on behalf of ${Names.realm(kingdom.name)}.`
            : 'The hall is quiet. The local elders hear you out.');
        if (available.length === 0) {
            html += card('<div style="font-size: 12px; color: #cbbf9f;">There is nothing for you to petition here yet. Earn standing with the realm, and pledge yourself to it, to open the doors of office.</div>');
        }
        const rows = available.map((a, i) => _row({ icon: a.icon || '•', name: a.label, desc: a.description || '' }, `a${i}`));
        rows.push(_row({ icon: '💰', name: 'Pay tribute to the crown', why: 'This settlement answers to no crown.' }, 'tribute', !!kingdom));
        html += rowList(rows, 'Petitions');
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
