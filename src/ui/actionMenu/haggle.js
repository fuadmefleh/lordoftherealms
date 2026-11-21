// ============================================================
// ActionMenu — Haggling face to face at a market stall
// ============================================================
// The keeper of a staffed stall on the street map (world/innerMap/stalls.js)
// will haggle: "Haggle over [good]" for their wares, "Offer [good] for sale"
// for yours they deal in. The exchange is player/haggling.js; this panel
// shows it in the panel kit's voice (lede, chips, card, actRow), says each of
// the keeper's lines over their head on the map (InnerMapReactions.bark), in
// their tongue where the player lacks the words (Cultures.hear), and lets an
// onlooker or two chime in.
//
// Opened from the keeper's dialog ("Let's haggle."), or the stall window's
// ⚖️ Haggle tab (ui/actionMenu/trade.js). Rows route through
// data-am-act="haggleAct".

import { ActionMenu } from './_ref.js';
import { PlayerEconomy, Utils } from './_imports.js';
import { lede, chips, purse, card, rowList, price, more, bullets, esc } from './uiKit.js';
import { Haggling } from '../../player/haggling.js';
import { MarketStalls } from '../../world/marketStalls.js';
import { Trading } from '../../player/playerEconomy.js';
import { Cultures } from '../../world/cultures.js';
import { Languages } from '../../systems/languages.js';
import { SocialSkills } from '../../systems/socialSkills.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapReactions } from '../innerMapReactions.js';

/** The haggle on the go: { stall, tile, session } (not saved: a haggle is a moment). */
let _h = null;

const MOVE_ICONS = {
    low: '⬇️', mid: '↘️', sellHigh: '⬆️', sellMid: '↗️', half: '🤝', flatter: '💬', flaw: '🔍',
    praise: '📣', scoff: '😤', accept: '✅', walk: '🚶',
};

function _hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

function _good(id) {
    return PlayerEconomy.GOODS[String(id || '').toUpperCase()] || null;
}

function _goodName(id) {
    const g = _good(id);
    return (g && g.name) || String(id).replace(/_/g, ' ');
}

function _tileOf(game) {
    return game && game.world && game.player ? game.world.getTile(game.player.q, game.player.r) : null;
}

function _hour() {
    if (typeof InnerMap._sceneClock === 'function') return InnerMap._sceneClock();
    const h = Number(InnerMap.timeOfDay);
    return Number.isFinite(h) ? h : 10;
}

function _ctx(game, h, goodId, side, qty) {
    return {
        player: game.player, world: game.world, settlement: h.tile.settlement, tile: h.tile,
        npc: h.stall.keeper, tradeId: h.stall.trade, goodId, side, qty, hour: _hour(),
    };
}

/** Say it over the keeper's head on the street map, as the player hears it. */
function _bark(npc, session, text, secs = 4.2) {
    if (!npc || !text) return;
    try { InnerMapReactions.bark(npc, Haggling.heard(session, text), secs); } catch { /* the map may be gone */ }
}

/** An onlooker near the stall pipes up (a hash of the haggle picks who and whether). */
function _crowd(session, key) {
    const keeper = _h && _h.stall && _h.stall.keeper;
    if (!keeper || !session) return;
    const C = Haggling.config().crowd || {};
    const reach = Number(C.reach) || 5;
    const roll = _hash(`${session.npcId}|${session.round}|${key}`) % 100;
    if (roll >= Math.round((Number(C.chance) || 0.6) * 100)) return;
    const near = (InnerMap.npcs || []).filter(n => n && n !== keeper && n.state !== 'inside_building' && !(n._bark && n._bark.until > ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()))
        && Math.abs(n.q - keeper.q) <= reach && Math.abs(n.r - keeper.r) <= reach);
    if (!near.length) return;
    const who = near[(session.round + key.length) % near.length];
    const line = Haggling.crowdLine(session, key);
    if (line) {
        try { InnerMapReactions.bark(who, line, 3); } catch { /* the map may be gone */ }
    }
}

function _patienceDots(session) {
    const n = Math.max(0, session.patience), max = Math.max(n, session.patience0);
    return '●'.repeat(n) + '○'.repeat(Math.max(0, max - n));
}

/** The stall window's tabs, with Haggle lit (the same bar as ui/actionMenu/trade.js's). */
function _nav(game, stall, tile) {
    if (!game.ui || typeof game.ui.setPanelNav !== 'function') return;
    const ST = MarketStalls.trade(stall.trade);
    const first = String((stall.keeper && stall.keeper.name) || '').split(' ')[0];
    game.ui.setPanelNav({
        id: 'stall', title: `${(ST && ST.icon) || '🏪'} ${stall.name || MarketStalls.stallName(stall.trade)}`, active: 'haggle',
        items: [
            { key: 'buy', label: '🛒 Buy', run: () => ActionMenu.showTradeMenu(game, tile, 'buy', stall) },
            { key: 'sell', label: `💰 Sell${first ? ` to ${first}` : ''}`, run: () => ActionMenu.showTradeMenu(game, tile, 'sell', stall) },
            { key: 'market', label: '🏪 The Market', title: `Every stall of ${(tile.settlement && tile.settlement.name) || 'the town'}`, run: () => ActionMenu.showTradeMenu(game, tile, 'buy') },
            { key: 'haggle', label: '⚖️ Haggle', run: () => ActionMenu.showHaggle(game, stall) },
        ],
    });
}

function _tongueNote(t) {
    if (!t || !t.lang || t.share >= 0.999 && t.via !== 'translator') return '';
    const lang = Cultures.languageName(t.lang);
    if (t.via === 'translator') return ` Your interpreter puts your words into ${esc(lang)}: it works, but loses something in the telling.`;
    if (!t.words) return ` You haven't the words in ${esc(lang)}: prices on your fingers, and a foreigner's price.`;
    return ` Your ${esc(lang)} is halting: you catch most of what they say.`;
}

Object.assign(ActionMenu, {
    /** A keeper who sent you off today: they say so, and the stall stays shut to you. → true when refused. */
    haggleRefusal(game, stall) {
        const npc = stall && stall.keeper;
        if (!npc || !Haggling.spurned(npc, game.world)) return false;
        const line = Haggling.line('spurned', npc, { goodId: '', qty: 1 }, {});
        try { InnerMapReactions.bark(npc, line, 3.5); } catch { /* no map */ }
        game.ui.showNotification('🚫 No Deal', `${npc.name || 'The keeper'} won't deal with you again today: you haggled them past their patience.`, 'warning');
        return true;
    },

    /**
     * The haggling panel for a stall (`stall` from InnerMap.stallAt / stallOfKeeper):
     * the goods to haggle over, or the haggle under way with this keeper.
     */
    showHaggle(game, stall = null) {
        const tile = _tileOf(game);
        const st = stall || (_h && _h.stall);
        if (!st || !tile || !tile.settlement || !MarketStalls.trade(st.trade)) {
            game.ui.showNotification('⚖️ Haggle', 'There is no stall here to haggle at.', 'info');
            return;
        }
        if (!st.keeper) {
            game.ui.showNotification('⚖️ Haggle', 'Nobody is minding the stall.', 'info');
            return;
        }
        if (ActionMenu.haggleRefusal(game, st)) return;
        // (a new stall, or the last haggle done: back to the goods)
        if (!_h || _h.stall.key !== st.key || _h.stall.keeper !== st.keeper) _h = { stall: st, tile, session: null };
        _h.tile = tile;
        if (_h.session && !_h.session.over) return ActionMenu._haggleSession(game);
        _h.session = null;
        ActionMenu._hagglePicker(game);
    },

    /** The keeper's wares to haggle over, and the player's goods of their trade to offer. */
    _hagglePicker(game) {
        const { stall, tile } = _h;
        const s = tile.settlement;
        const keeper = stall.keeper;
        const ST = MarketStalls.trade(stall.trade);
        const tongue = Haggling.tongue(game.player, game.world, s);
        const late = Haggling.lateness(_hour());
        let html = lede(`<b>${esc(keeper.name || 'The keeper')}</b> keeps the ${esc((ST && ST.stall) || 'stall')}. Name your price for their wares, or for yours: every round tries their patience, and push too hard and they won't deal with you today.${_tongueNote(tongue)}`);
        html += chips([
            purse(game.player.gold || 0),
            SocialSkills.has('haggling') ? ['⚖️', 'Haggling', SocialSkills.level(game.player, 'haggling')] : null,
            late > 0 ? ['🌇', 'Market closing', 'they sell cheaper'] : null,
        ]);
        const wares = Trading.stallGoods(s, tile, game.world, stall.trade)
            .filter(e => (e.lots ? e.lots.common : e.quantity) > 0)
            .map(e => ({
                icon: e.icon || '📦', name: `Haggle over ${esc(e.name || _goodName(e.id))}`,
                desc: `${Math.floor(e.lots ? e.lots.common : e.quantity)} on the stall · the market asks ${Utils.formatGold(e.price)}g each`,
                side: price(e.price, (game.player.gold || 0) >= e.price), act: 'haggleAct', args: ['pick', 'buy', e.id],
            }));
        html += rowList(wares, 'Their wares') || card('Nothing on the stall today.');
        const inv = game.player.inventory || {};
        const yours = Object.keys(inv).filter(id => inv[id] > 0 && MarketStalls.accepts(stall.trade, id) && _good(id))
            .map(id => ({
                icon: _good(id).icon || '📦', name: `Offer ${esc(_goodName(id))} for sale`,
                desc: `You carry ${Math.floor(inv[id])}`, act: 'haggleAct', args: ['pick', 'sell', id],
            }));
        if (yours.length) html += rowList(yours, 'Yours to sell');
        html += rowList([{ icon: '🏪', name: 'Back to the stall', desc: 'Buy and sell at the stall\'s own prices', act: 'haggleAct', args: ['stall'] }]);
        _nav(game, stall, tile);
        game.ui.showCustomPanel(`⚖️ Haggle — ${esc(keeper.name || 'the keeper')}`, html);
    },

    /** The haggle under way: what they said, the price, their patience, your moves. */
    _haggleSession(game) {
        const { stall, tile, session } = _h;
        const keeper = stall.keeper;
        const buy = session.side === 'buy';
        const name = _goodName(session.goodId);
        const lastKeeper = [...session.log].reverse().find(l => l.who === 'keeper');
        const said = lastKeeper ? Haggling.heard(session, lastKeeper.text) : '';
        let html = lede(`<b>${esc(keeper.name || 'The keeper')}</b>: “${esc(said)}”`);
        html += chips([
            ['🏷️', 'Market price', `${Utils.formatGold(session.list)}g`],
            [buy ? '🗣️' : '🪧', buy ? 'They ask' : 'They offer', `${Utils.formatGold(session.ask)}g`, 'gold'],
            ['⏳', 'Patience', _patienceDots(session)],
            purse(game.player.gold || 0),
        ]);
        // The exchange so far
        const log = session.log.slice(-8).map(l => (l.who === 'you'
            ? `<div style="color:#d8ccaf;"><b>You:</b> ${esc(l.text)}</div>`
            : `<div style="color:#ffe08a;"><b>${esc(String(keeper.name || 'Keeper').split(' ')[0])}:</b> ${esc(Haggling.heard(session, l.text))}</div>`)).join('');
        html += card(log, { title: `${session.qty} ${esc(name.toLowerCase())}`, icon: buy ? '🛒' : '💰', side: buy ? 'buying' : 'selling' });

        if (session.over) {
            const outcome = session.over === 'deal'
                ? (buy ? `You paid ${Utils.formatGold(session.price)}g for ${session.qty} ${esc(name.toLowerCase())} (the market asked ${Utils.formatGold(session.list)}g).`
                    : `You got ${Utils.formatGold(session.price)}g for ${session.qty} ${esc(name.toLowerCase())} (the market would pay ${Utils.formatGold(session.list)}g).`)
                    + (session.mood === 'warm' ? ' They are pleased with it.' : session.mood === 'grudging' ? ' They are sour about it.' : '')
                : session.over === 'refused' ? `${esc(keeper.name || 'They')} won't deal with you again today.`
                    : session.over === 'walked' ? 'You walked away.' : 'No deal.';
            html += card(outcome, { tone: session.over === 'deal' ? 'good' : session.over === 'refused' ? 'bad' : '' });
            const rows = [];
            if (session.over !== 'refused') rows.push({ icon: '⚖️', name: 'Haggle over something else', act: 'haggleAct', args: ['picker'] });
            if (session.over !== 'refused') rows.push({ icon: '🏪', name: 'Back to the stall', act: 'haggleAct', args: ['stall'] });
            rows.push({ icon: '↩️', name: 'Done', act: 'haggleAct', args: ['close'] });
            html += rowList(rows);
        } else {
            const rows = Haggling.moves(session).map(m => ({
                icon: MOVE_ICONS[m.id] || '•', name: m.label,
                desc: m.offer != null && m.id !== 'accept' ? `${buy ? 'Offer' : 'Ask'} ${Utils.formatGold(m.offer)}g for the lot` : (m.id === 'accept' ? 'Shake on their price' : (m.id === 'walk' ? 'They may call you back' : '')),
                side: m.offer != null ? price(m.offer, !buy || (game.player.gold || 0) >= m.offer) : '',
                off: !!m.off, why: m.why, act: 'haggleAct', args: ['move', m.id],
            }));
            html += rowList(rows, 'Your move');
        }
        const why = (session.factors || []).map(f => `${esc(f.label)} ${f.pct > 0 ? '+' : ''}${f.pct}%`);
        html += more('Why this price', bullets(why));
        _nav(game, stall, tile);
        game.ui.showCustomPanel(`⚖️ Haggle — ${esc(keeper.name || 'the keeper')}`, html);
    },

    /** Rows of the haggle panel: ['pick', side, goodId] | ['move', id] | ['picker'] | ['stall'] | ['close']. */
    haggleAct(game, op, a, b) {
        if (!_h) return;
        const { stall } = _h;
        if (op === 'close') { _h = null; if (game.ui.hideCustomPanel) game.ui.hideCustomPanel(); return; }
        if (op === 'stall') {
            const tile = _h.tile;
            _h.session = null;
            ActionMenu.showTradeMenu(game, tile, null, stall);
            return;
        }
        if (op === 'picker') { _h.session = null; ActionMenu.showHaggle(game, stall); return; }
        if (op === 'pick') {
            const side = a === 'sell' ? 'sell' : 'buy';
            const goodId = b;
            let max;
            if (side === 'buy') {
                const e = Trading.stallGoods(_h.tile.settlement, _h.tile, game.world, stall.trade).find(x => x.id === goodId);
                max = e ? Math.floor(e.lots ? e.lots.common : e.quantity) : 0;
            } else {
                max = Math.floor((game.player.inventory || {})[goodId] || 0);
            }
            if (max <= 0) { game.ui.showNotification('⚖️ Haggle', 'There are none to haggle over.', 'info'); return; }
            const title = side === 'buy' ? `Haggle over ${_goodName(goodId)}` : `Offer ${_goodName(goodId)} for sale`;
            ActionMenu.showQuantityInput(title, max, (qty) => ActionMenu._haggleBegin(game, goodId, side, qty));
            return;
        }
        if (op === 'move' && _h.session) {
            const session = _h.session;
            const r = Haggling.respond(session, a, _ctx(game, _h, session.goodId, session.side, session.qty));
            if (r.error) { game.ui.showNotification('⚖️ Haggle', r.error, 'info'); return; }
            if (r.reason) game.ui.showNotification(session.side === 'buy' ? 'Cannot Buy' : 'Cannot Sell', r.reason, 'error');
            _bark(stall.keeper, session, r.reply);
            if (r.tactic) _crowd(session, r.tactic.move);
            if (r.over === 'deal') {
                const name = _goodName(session.goodId);
                game.ui.showNotification(session.side === 'buy' ? '⚖️ Bought' : '⚖️ Sold',
                    `${session.side === 'buy' ? 'Bought' : 'Sold'} ${session.qty}x ${name} for ${Utils.formatGold(session.price)} gold (haggled from ${Utils.formatGold(session.ask0)}).`, 'success');
                if (_h.tile.settlement && _h.tile.settlement.kingdom && typeof game.player.learnAboutKingdom === 'function') game.player.learnAboutKingdom(_h.tile.settlement.kingdom, 'economy');
                _crowd(session, 'deal');
            } else if (r.over === 'refused') {
                _crowd(session, 'refused');
            }
            if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
            ActionMenu._haggleSession(game);
        }
    },

    /** Open the haggle over `qty` of a good: the keeper names their price. */
    _haggleBegin(game, goodId, side, qty) {
        if (!_h) return;
        if (!ActionMenu.commitPendingAP(game)) return;
        const ctx = _ctx(game, _h, goodId, side, qty);
        const res = Haggling.start(ctx);
        if (!res.ok) {
            if (res.reply) _bark(_h.stall.keeper, null, res.reply);
            game.ui.showNotification('⚖️ Haggle', res.reason, 'warning');
            return;
        }
        _h.session = res.session;
        // (talking in their tongue teaches a little of it: systems/languages.js)
        if (res.session.tongue && res.session.tongue.lang) {
            try { Languages.noteTalk(game.player, game.world, res.session.tongue.lang); } catch { /* never blocks a haggle */ }
        }
        _bark(_h.stall.keeper, res.session, res.reply);
        ActionMenu._haggleSession(game);
    },
});
