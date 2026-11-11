// ActionMenu — the barter table: a market before coin (world/barter.js).
// In a town that doesn't use coin yet the Market's Buy and Sell become one
// table: choose what you want from the stalls and what you offer for it;
// the bargain is struck when your offer's worth covers theirs (the town's
// supply-and-demand worth, the market's cut on top). Worths read as goods —
// "≈ 12 grain" — never as coin.
import { ActionMenu } from './_ref.js';
import { PlayerEconomy, SettlementMarket } from './_imports.js';
import { setMarketNav } from './trade.js';
import { lede, chips, actRow, rowList, card, sectionHead, BTN_GOLD, BTN_PLAIN, BTN_OFF, esc } from './uiKit.js';
import { Barter } from '../../world/barter.js';
import { SocialSkills } from '../../systems/socialSkills.js';
import { goodInfoIcon } from '../goodInfo.js';

const _good = (id) => PlayerEconomy.GOODS[String(id).toUpperCase()] || { id, name: id, icon: '📦' };
const _worth = (v) => `<span class="pk-price">~${Math.round(Number(v) || 0).toLocaleString('en-US')}<small> ⚖</small></span>`;

/** The haggling edge on the market's cut (systems/socialSkills.js), 0 without the skill */
function _edge(game, settlement) {
    try {
        return SocialSkills.has('haggling') ? Math.max(0, Number(SocialSkills.haggle(game.player, settlement).bonus) || 0) : 0;
    } catch {
        return 0;
    }
}

/** The basket for this town (cleared when the player is at another) */
function _basket(game, tile) {
    const ui = game.ui || {};
    const key = `${tile.q},${tile.r}`;
    if (!ui._barter || ui._barter.key !== key) ui._barter = { key, want: {}, offer: {} };
    return ui._barter;
}

function _tile(game) {
    return game.world.getTile(game.player.q, game.player.r);
}

Object.assign(ActionMenu, {
    showBarterTable(game, tile = _tile(game)) {
        const s = tile && tile.settlement;
        if (!s) return;
        const world = game.world, player = game.player;
        SettlementMarket.ensure(s);
        const b = _basket(game, tile);
        const edge = _edge(game, s);
        const v = Barter.weigh(world, player, s, tile, b.want, b.offer, edge);
        const hint = (val) => Barter.inUnitsOf(world, s, tile, val);
        const cut = Math.round(Math.max(0, Barter.config().cut - edge * 2) * 100);

        // ── The bargain on the table ──
        const line = (side) => Object.entries(b[side]).filter(([, q]) => q > 0).map(([id, q]) => {
            const g = _good(id);
            const val = side === 'want' ? Barter.askValue(world, s, tile, id, q, edge) : Barter.offerValue(world, s, tile, id, q, edge);
            return actRow({ icon: g.icon, name: `${q} × ${g.name}`, desc: hint(val), side: _worth(val), act: 'barterDrop', args: [side, id], title: 'Take it off the table' });
        }).join('');
        const wantRows = line('want'), offerRows = line('offer');
        const ready = wantRows && offerRows && v.short <= 0.005;
        const balance = !wantRows || !offerRows
            ? '<span style="color:#9d937c;">Choose what you want and what you give.</span>'
            : v.short > 0.005
                ? `<span style="color:#e67e22;">They want about ${Math.ceil(v.short)} more (${hint(v.short)}).</span>`
                : `<span style="color:#8fd18a;">Your offer covers it${v.offer - v.ask >= 1 ? ` — about ${Math.floor(v.offer - v.ask)} over, and barter gives no change` : ''}.</span>`;
        const table = card(`
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div>${sectionHead(`You ask · ${_worth(v.ask)}`)}<div class="pk-rows">${wantRows || '<div style="font-size:12px;color:#9d937c;padding:6px 2px;">Nothing yet</div>'}</div></div>
                <div>${sectionHead(`You give · ${_worth(v.offer)}`)}<div class="pk-rows">${offerRows || '<div style="font-size:12px;color:#9d937c;padding:6px 2px;">Nothing yet</div>'}</div></div>
            </div>
            <div style="margin-top:8px;font-size:12px;">${balance}</div>
            <div style="margin-top:6px;">
                <button data-am-act="barterStrike" style="${ready ? BTN_GOLD : BTN_OFF}"${ready ? '' : ' disabled'}>🤝 Strike the bargain</button>
                <button data-am-act="barterClear" style="${BTN_PLAIN}">Clear the table</button>
            </div>`, { title: 'The bargain', icon: '⚖️' });

        // ── The stalls: what the town will part with ──
        const stalls = [];
        for (const id of SettlementMarket.config().goodIds) {
            const n = SettlementMarket.available(s, id) - (b.want[id] || 0);
            if (!(n > 0) || !(Barter.unitValue(id) > 0)) continue;
            const g = _good(id);
            const one = Barter.askValue(world, s, tile, id, 1, edge);
            stalls.push({ one, row: actRow({ icon: g.icon, name: `${g.name}${goodInfoIcon(id)}`, desc: `${n} on the stalls · ${hint(one)} each`, side: _worth(one), act: 'barterAsk', args: [id], title: 'Ask for some' }) });
        }
        stalls.sort((x, y) => x.one - y.one);

        // ── Your packs: what you can offer ──
        const packs = [];
        for (const t of Barter.tender(player)) {
            const n = t.qty - (b.offer[t.id] || 0);
            if (!(n > 0)) continue;
            const g = _good(t.id);
            const one = Barter.offerValue(world, s, tile, t.id, 1, edge);
            packs.push(actRow({ icon: g.icon, name: g.name, desc: `you carry ${n} · ${hint(one)} each${t.food ? ' · food' : ''}`, side: _worth(one), act: 'barterOffer', args: [t.id], title: 'Offer some' }));
        }

        const html = `
            ${lede(`No coin changes hands in ${esc(s.name || 'this village')}: goods are weighed against goods. Ask for what you want, offer what you carry; the traders take a cut of about ${cut}%.`)}
            ${chips([
                { icon: '🎒', label: 'Your goods', value: `~${Barter.purse(player).toLocaleString('en-US')}`, cls: 'gold' },
                { icon: '🏪', label: 'Barter here', value: `${Math.round(Number(s.market && s.market.trade && s.market.trade.bvLast) || 0)} / season` },
            ])}
            ${table}
            ${rowList(stalls.map(x => x.row), '🏪 On the stalls') || '<div class="pk-lede">The stalls are bare.</div>'}
            ${rowList(packs, '🎒 In your packs') || '<div class="pk-lede">You carry nothing they would take.</div>'}`;
        setMarketNav(game, tile, 'buy');
        game.ui.showCustomPanel(`⚖️ Barter — ${s.name || 'Market'}`, html);
    },

    barterAsk(game, goodId) {
        const tile = _tile(game);
        const s = tile && tile.settlement;
        if (!s) return;
        const b = _basket(game, tile);
        const max = SettlementMarket.available(s, goodId) - (b.want[goodId] || 0);
        if (!(max > 0)) return;
        ActionMenu.showQuantityInput(`Ask for ${_good(goodId).name}`, max, (qty) => {
            const q = Math.max(0, Math.min(max, Math.floor(Number(qty) || 0)));
            if (q > 0) b.want[goodId] = (b.want[goodId] || 0) + q;
            ActionMenu.showBarterTable(game, tile);
        });
    },

    barterOffer(game, goodId) {
        const tile = _tile(game);
        if (!tile || !tile.settlement) return;
        const b = _basket(game, tile);
        const have = Math.floor(Number(game.player.inventory && game.player.inventory[goodId]) || 0);
        const max = have - (b.offer[goodId] || 0);
        if (!(max > 0)) return;
        ActionMenu.showQuantityInput(`Offer ${_good(goodId).name}`, max, (qty) => {
            const q = Math.max(0, Math.min(max, Math.floor(Number(qty) || 0)));
            if (q > 0) b.offer[goodId] = (b.offer[goodId] || 0) + q;
            ActionMenu.showBarterTable(game, tile);
        });
    },

    barterDrop(game, side, goodId) {
        const tile = _tile(game);
        if (!tile) return;
        const b = _basket(game, tile);
        if (b[side]) delete b[side][goodId];
        ActionMenu.showBarterTable(game, tile);
    },

    barterClear(game) {
        const tile = _tile(game);
        if (!tile) return;
        const b = _basket(game, tile);
        b.want = {};
        b.offer = {};
        ActionMenu.showBarterTable(game, tile);
    },

    barterStrike(game) {
        const tile = _tile(game);
        const s = tile && tile.settlement;
        if (!s) return;
        const b = _basket(game, tile);
        if (typeof ActionMenu.commitPendingAP === 'function' && !ActionMenu.commitPendingAP(game)) return;
        const res = Barter.trade(game.world, game.player, s, tile, b.want, b.offer, _edge(game, s));
        if (!res.success) {
            game.ui.showNotification('No Bargain', res.reason, 'error');
            return;
        }
        const list = (o) => Object.entries(o).map(([id, q]) => `${q} ${_good(id).name}`).join(', ');
        game.ui.showNotification('🤝 Bargain Struck', `You gave ${list(res.gave)} for ${list(res.got)}.`, 'success');
        if (s.kingdom && typeof game.player.learnAboutKingdom === 'function') game.player.learnAboutKingdom(s.kingdom, 'economy');
        b.want = {};
        b.offer = {};
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showBarterTable(game, tile);
    },
});
