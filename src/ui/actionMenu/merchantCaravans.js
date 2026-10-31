// ActionMenu — a merchant caravan or trading ship met on the road
// (systems/merchantCaravans.js): its house, route and cargo; buy from its
// cargo or sell it the goods it deals in, hire on as escort, or rob it (the
// fight goes through the shared attack panel, ActionMenu.performAttack).
import { ActionMenu } from './_ref.js';
import { MerchantCaravans, PlayerMilitary } from './_imports.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { ConversationScene } from '../conversationScene.js';


function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── The caravan as a conversation scene (ui/conversationScene.js) ──
// The ring shows how far along the road they are; the cargo is a submenu
// where a pick buys one (Shift for five). The trader* methods below do the
// dealing and report back through showTrader(game, unitId, message).

let _scene = null; // { unitId, scene, view: 'main' | 'buy' | 'sell', asked }

const GROUPS = { talk: 'Converse', deal: 'Dealings', escort: 'Escort', threat: 'Threats', wares: 'Their cargo', sell: 'Your packs' };

function _ringFor(u) {
    const pct = Math.round(MerchantCaravans.progress(u) * 100);
    const escorted = u.escort && u.escort.by === 'player';
    return {
        value: pct, icon: u.icon,
        label: pct < 10 ? 'Just set out' : pct < 40 ? 'On the road' : pct < 70 ? 'Halfway there' : pct < 95 ? 'Nearly there' : 'Arriving',
        color: escorted ? '#81c784' : u.danger ? '#ffb74d' : '#e0b070', shown: `${pct}%`,
    };
}

function _facts(u) {
    const house = u.house || {};
    const escorted = u.escort && u.escort.by === 'player';
    return `${escorted ? '<div class="npc-dialog-rel-badge" style="color:#81c784">🛡️ Under your escort</div>' : ''}
        <div class="npc-dialog-visits">${house.icon || '⚖️'} ${_esc(house.name || 'Free traders')}</div>
        <div class="npc-scene-stats">
            <span class="npc-scene-stat" title="Guards">🛡️<b>${u.strength}</b></span>
            <span class="npc-scene-stat" title="Their purse">💰<b>${Math.floor(u.purse || 0)}</b></span>
            <span class="npc-scene-stat" title="Cargo value">📦<b>~${u.value}</b></span>
        </div>
        ${u.danger ? '<div class="npc-dialog-family-tag" style="color:#ffb74d">⚠️ Their road runs near an outlaw lair</div>' : ''}`;
}

function _greeting(u, offers) {
    if (u.escort && u.escort.by === 'player') return `Good to see you close, guard. ${u.toName} isn't getting any nearer on its own.`;
    const goods = offers.slice(0, 2).map(o => o.name.toLowerCase()).join(' and ');
    const what = goods ? `${goods.charAt(0).toUpperCase()}${goods.slice(1)} out of ${u.fromName}` : `Empty wagons out of ${u.fromName}`;
    if (u.danger) return `*keeps one hand near a crossbow* Easy, friend. ${what}, bound for ${u.toName} — if the outlaws allow. Buying?`;
    return `Hail, traveller! ${what}, bound for ${u.toName}. Buying, or selling?`;
}

function _refresh(game) {
    const st = _scene;
    if (!st || !st.scene.isOpen) return;
    const u = MerchantCaravans.find(game.world, st.unitId);
    if (!u) { st.scene.npc('*The wagons roll on.*'); st.scene.leave(); return; }
    st.scene.setMood(_ringFor(u));
    const facts = st.scene.overlay.querySelector('.npc-dialog-facts');
    if (facts) facts.innerHTML = _facts(u);
    st.scene.afterSpoken(0, () => {
        if (st.view === 'buy' || st.view === 'sell') _waresChoices(game, u, st.view);
        else _mainChoices(game, u);
    });
}

function _mainChoices(game, u) {
    const st = _scene;
    if (!st) return;
    const scene = st.scene;
    const { player, world } = game;
    const offers = MerchantCaravans.offers(u);
    const list = [];

    if (!st.asked) {
        list.push({
            icon: '🛤️', label: 'How has the road been?', group: 'talk',
            tooltip: 'Hear of the way behind them: tolls, danger, how far is left.',
            onPick: () => {
                st.asked = true;
                scene.exchange('How has the road been?', () => {
                    const pct = Math.round(MerchantCaravans.progress(u) * 100);
                    let line = pct < 30 ? 'Barely begun. ' : pct > 75 ? 'Nearly there, gods willing. ' : 'Long enough. ';
                    line += u.tollsPaid
                        ? `We have paid ${u.tollsPaid} gold in tolls so far — every lord with a bridge wants his cut.`
                        : 'No tolls yet, which is a small miracle.';
                    if (u.danger) line += ' And there are outlaws in the hills ahead. We all know it.';
                    scene.npc(line);
                    scene.note('📒 What their goods fetch at both ends is in your price book', 'info');
                    _refresh(game);
                });
            },
        });
    }
    list.push({
        icon: '📦', label: 'Show me your wares.', group: 'deal',
        extra: `<span class="npc-dialog-price">${offers.length} goods</span>`,
        tooltip: offers.length ? `Buy from their cargo: ${offers.map(o => o.name).join(', ')}.` : 'They have nothing left to sell.',
        disabled: !offers.length, disabledReason: 'their wagons are empty',
        onPick: () => {
            st.view = 'buy';
            scene.clearChoices();
            scene.player('Show me your wares.');
            scene.npc('*throws back the canvas* Take a look.');
            _refresh(game);
        },
    });
    const sellable = offers.filter(o => Math.floor((player.inventory && player.inventory[o.id]) || 0) > 0);
    list.push({
        icon: '🤝', label: 'I have goods you might want.', group: 'deal',
        tooltip: sellable.length ? `Sell them what they deal in: ${sellable.map(o => o.name).join(', ')}.` : 'You carry nothing they deal in.',
        disabled: !sellable.length, disabledReason: 'you carry nothing they deal in',
        onPick: () => {
            st.view = 'sell';
            scene.clearChoices();
            scene.player('I have goods you might want.');
            scene.npc('Do you now? Let me see.');
            _refresh(game);
        },
    });

    if (u.escort && u.escort.by === 'player') {
        list.push({
            icon: '🏳️', label: 'I am leaving your service.', group: 'escort', cls: 'npc-dialog-choice-muted',
            tooltip: 'Walk away from the escort contract — unpaid.',
            onPick: () => { scene.player('I am leaving your service.'); ActionMenu.traderQuitEscort(game, u.id); },
        });
    } else {
        const can = MerchantCaravans.canEscort(player, world, u);
        list.push({
            icon: '🛡️', label: 'I will ride as your escort.', group: 'escort',
            extra: `<span class="npc-dialog-price is-good">${u.escortPay}g</span>`,
            tooltip: `Guard them to ${u.toName}; ${u.escortPay} gold on arrival. Stay within ${MerchantCaravans.config().escort.range} hexes to fight off ambushes.`,
            disabled: !can.ok, disabledReason: can.reason || 'not now',
            onPick: () => { scene.player(`I will ride as your escort to ${u.toName}.`); ActionMenu.traderEscort(game, u.id); },
        });
    }

    const army = PlayerMilitary.getArmyStrength ? PlayerMilitary.getArmyStrength(player) : 0;
    list.push({
        icon: '🗡️', label: 'Your cargo, or your lives.', group: 'threat', cls: 'npc-dialog-choice-dark',
        extra: `<span class="npc-dialog-price ${army > u.strength ? 'is-good' : 'is-up'}">${army} vs ${u.strength}</span>`,
        tooltip: 'Rob them. The goods are hot (only a fence will take them), the realm wants you, and the town waiting on this cargo goes without.',
        onPick: () => {
            scene.clearChoices();
            scene.player('*draws steel* Your cargo, or your lives.');
            scene.npc('*shouts* Guards! To the wagons!');
            scene.seal('Ambush', 'To arms', false);
            scene.afterSpoken(700, () => { scene.close(); ActionMenu.traderRob(game, u.id); });
        },
    });

    list.push({
        icon: '👋', label: 'Safe travels.', group: 'leave',
        onPick: () => {
            scene.clearChoices();
            scene.player('Safe travels.');
            scene.npc(u.danger ? 'Pray we need none of your luck.' : 'And to you. Mind the ruts.');
            scene.leave();
        },
    });
    scene.choices(list, { titles: GROUPS, hint: 'Deal with the caravan — press 1–9, or Esc to move on.' });
}

function _waresChoices(game, u, view) {
    const st = _scene;
    if (!st) return;
    const scene = st.scene;
    const player = game.player;
    const list = [];
    for (const o of MerchantCaravans.offers(u)) {
        const held = Math.floor((player.inventory && player.inventory[o.id]) || 0);
        if (view === 'buy') {
            const ok = o.qty >= 1 && (player.gold || 0) >= o.buy;
            list.push({
                icon: o.icon, label: `${_esc(o.name)} <span class="npc-dialog-bond">×${o.qty}${held ? ` · you have ${held}` : ''}</span>`,
                group: 'wares',
                extra: `<span class="npc-dialog-price">${o.buy}g</span>`,
                tooltip: `Buy one for ${o.buy} gold — Shift for five (${o.buy * 5}g).`,
                disabled: !ok, disabledReason: o.qty < 1 ? 'sold out' : 'not enough gold',
                onPick: (meta) => ActionMenu.traderBuy(game, u.id, o.id,
                    meta.shift && o.qty >= 5 && (player.gold || 0) >= o.buy * 5 ? 5 : 1),
            });
        } else if (held > 0) {
            list.push({
                icon: o.icon, label: `${_esc(o.name)} <span class="npc-dialog-bond">you have ${held}</span>`,
                group: 'sell',
                extra: `<span class="npc-dialog-price is-good">${o.sell}g</span>`,
                tooltip: `Sell one for ${o.sell} gold — Shift for five.`,
                disabled: (u.purse || 0) < o.sell, disabledReason: 'the merchant cannot pay',
                onPick: (meta) => ActionMenu.traderSell(game, u.id, o.id, meta.shift && held >= 5 ? 5 : 1),
            });
        }
    }
    const back = () => {
        st.view = 'main';
        scene.clearChoices();
        scene.player('That is all.');
        _refresh(game);
    };
    list.push({ icon: '↩️', label: 'That is all.', group: 'leave', onPick: back });
    const hint = view === 'buy'
        ? 'Prices run from where they bought toward where they sell. Shift buys five.'
        : 'They only buy what they deal in. Shift sells five.';
    scene.choices(list, { titles: GROUPS, back, hint });
}

function _openScene(game, u) {
    const house = u.house || {};
    const state = { unitId: u.id, view: 'main', asked: false, scene: null };
    state.scene = ConversationScene.open({
        variant: 'caravan',
        name: u.name,
        subtitle: `${house.icon || '⚖️'} ${_esc(house.name || 'Free traders')}`,
        where: `${_esc(u.fromName)} → ${_esc(u.toName)}`,
        icon: u.icon, badge: u.icon,
        sprite: { type: 'merchant', id: ConversationScene.seedOf(u.id) },
        mood: _ringFor(u),
        moodTitle: 'How far along the road they are',
        facts: _facts(u),
        greeting: _greeting(u, MerchantCaravans.offers(u)),
        onClose: () => {
            if (_scene === state) _scene = null;
            game.ui.updateStats(game.player, game.world);
        },
    });
    _scene = state;
}

Object.assign(ActionMenu, {
    /**
     * Hail a trader: a conversation scene with the caravan master. Called again
     * with a message (from the trader* acts) it reports the deal and refreshes.
     */
    showTrader(game, unitId, message = null) {
        const { player, world } = game;
        const u = MerchantCaravans.find(world, unitId);
        const open = _scene && _scene.scene.isOpen && _scene.unitId === unitId;
        if (!u) {
            if (open) { _scene.scene.npc('*The wagons roll on.*'); _scene.scene.leave(); }
            else game.ui.showNotification('On the Road', 'The trader has moved on.', 'info');
            return;
        }
        if (!open) {
            // Hailing a trader: it tells what its goods were worth at both ends (the price book)
            PriceKnowledge.learnFromTrader(player, world, u);
            _openScene(game, u);
        }
        if (message) _scene.scene.note(_esc(message.text), message.ok ? 'good' : 'bad');
        _refresh(game);
    },

    traderBuy(game, unitId, goodId, qty) {
        const r = MerchantCaravans.buy(game.player, game.world, unitId, goodId, qty);
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showTrader(game, unitId, r.success ? { ok: true, text: `Bought ${r.qty} for ${r.cost} gold.` } : { ok: false, text: r.reason });
    },

    traderSell(game, unitId, goodId, qty) {
        const r = MerchantCaravans.sell(game.player, game.world, unitId, goodId, qty);
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showTrader(game, unitId, r.success ? { ok: true, text: `Sold ${r.qty} for ${r.pay} gold.` } : { ok: false, text: r.reason });
    },

    traderEscort(game, unitId) {
        const r = MerchantCaravans.hireEscort(game.player, game.world, unitId);
        ActionMenu.showTrader(game, unitId, r.success
            ? { ok: true, text: `Hired. Bring them safe to ${r.to} and you are paid ${r.pay} gold.` }
            : { ok: false, text: r.reason });
    },

    traderQuitEscort(game, unitId) {
        MerchantCaravans.quitEscort(game.player, game.world, unitId);
        ActionMenu.showTrader(game, unitId, { ok: false, text: 'You leave their service, unpaid.' });
    },

    /** Rob the trader: the shared attack (PlayerMilitary.attackUnit → MerchantCaravans.onRobbed). */
    traderRob(game, unitId) {
        ActionMenu._pendingAP = ActionMenu.getAPCost('attack_unit');
        ActionMenu.performAttack(game, unitId);
    },
});
