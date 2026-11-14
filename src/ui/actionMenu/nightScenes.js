// ActionMenu — the town after dark (systems/nightStreets.js; the street map's
// half ui/innerMapNight.js), three choice scenes:
//
//   curfew_challenge  a guard of the watch stops you out after the curfew
//                     bell: talk your way home, bribe, run, or pay the fine
//                     (walked away from: the fine).
//   smuggler_landing  smugglers landing contraband at a quiet shore: lend a
//                     hand for a cut, tell the watch, rob them, or leave them.
//   night_market      the back-alley market after dark: buy the gangs' stash
//                     and goods still cooling at the fence cheaply; sell to
//                     the fence. A stranger is turned away.
import { registerScene } from './choiceScenes.js';
import { InnerMap } from '../../world/innerMap.js';
import { NightStreets } from '../../systems/nightStreets.js';
import { Underworld } from '../../systems/underworld.js';
import { Gangs } from '../../systems/gangs.js';
import { InnerMapNight } from '../innerMapNight.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _label = id => {
    const s = String(id || '').replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
};

function _tile(game, st) {
    return game.world && typeof game.world.getTile === 'function' ? game.world.getTile(st.q, st.r) : null;
}

/** Off to the cells (the watch's jail map), as the watch stop does. */
function _toJail(game) {
    if (game.ui && typeof game.ui.hideCustomPanel === 'function') game.ui.hideCustomPanel();
    if (typeof game.enterJailMap === 'function') {
        game.enterJailMap().then(ok => {
            if (!ok && InnerMap.active && typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true });
        });
    } else if (InnerMap.active && typeof game.exitInnerMap === 'function') game.exitInnerMap();
    if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
}

const TONE = { let_go: 'success', bribed: 'success', fled: 'warning', fined: 'warning', jailed: 'error' };

function _answer(game, st, choice) {
    const tile = _tile(game, st);
    const s = tile && tile.settlement;
    if (!s) return { notification: null, out: null };
    const guard = (InnerMap.npcs || []).find(n => n && n.id === st.npcId) || null;
    const out = NightStreets.answerChallenge(game.player, game.world, s, choice, { guardName: st.guardName, guard, lit: st.lit, q: st.q, r: st.r });
    if (out.invalid) return { invalid: true, notification: { title: 'Not Possible', body: out.text, type: 'error' } };
    InnerMapNight.afterChallenge(game, st, out);
    return { out, notification: { title: '🔔 The Curfew', body: out.text, type: TONE[out.outcome] || 'info' } };
}

registerScene('curfew_challenge', {
    view(game, st) {
        const tile = _tile(game, st);
        const s = tile && tile.settlement;
        if (!s) return null;
        const cf = NightStreets.curfew(game.world, s);
        return {
            icon: '🔔',
            title: NightStreets.text('curfew_title') || 'Out After Curfew',
            text: NightStreets.text('curfew_text', { guard: st.guardName, from: NightStreets.bellHour(cf.from) }),
            lines: [cf.why, st.lit ? 'Your lantern is lit: they will see you run.' : 'Your lantern is shuttered: the dark is on your side if you run.'].filter(Boolean),
            options: NightStreets.challengeOptions(game.player, game.world, s, { lit: st.lit }),
        };
    },
    act(game, st, choice) {
        const res = _answer(game, st, choice);
        if (res.invalid) return res;
        if (res.out && res.out.jailed) return { notification: res.notification, after: _toJail };
        return { notification: res.notification };
    },
    abandon(game, st) {
        // (walking off from the watch: they take your name and the fine)
        const res = _answer(game, st, 'submit');
        if (res.out && res.out.jailed) setTimeout(() => _toJail(game), 0);
        return { notification: res.notification };
    },
});

registerScene('smuggler_landing', {
    view(game, st) {
        const plan = InnerMapNight.landing();
        if (!plan || plan.key !== st.key || NightStreets.landingDone(game.player, plan)) return null;
        const tile = _tile(game, st);
        const land = (InnerMapNight._landing && InnerMapNight._landing.mode) === 'land';
        const vars = { shore: plan.shore || 'shore', crew: plan.crew, units: plan.units, good: _label(plan.good).toLowerCase(), from: plan.from, gang: plan.gangName };
        const kingdom = tile && tile.settlement && game.world.getKingdom ? game.world.getKingdom(tile.settlement.kingdom) : null;
        const status = Underworld.contrabandStatus(kingdom, plan.good);
        return {
            icon: '⛵',
            title: NightStreets.text('landing_title', vars) || 'Smugglers',
            text: NightStreets.text(land ? 'landing_text_land' : 'landing_text', vars),
            lines: [status === 'illegal' ? `${_label(plan.good)} is forbidden here: only the black market will take it.` : `${_label(plan.good)} pays a tariff here: run in untaxed, it sells for more.`],
            options: NightStreets.landingOptions(game.player, game.world, tile, plan),
        };
    },
    act(game, st, choice) {
        const plan = InnerMapNight.landing();
        const tile = _tile(game, st);
        if (choice === 'leave' || !plan || !tile) return { after: g => g.ui.hideCustomPanel() };
        const fn = { join: NightStreets.joinLanding, inform: NightStreets.informLanding, rob: NightStreets.robLanding }[choice];
        if (!fn) return { after: g => g.ui.hideCustomPanel() };
        const res = fn(game.player, game.world, tile, plan);
        if (!res.success) return { invalid: true, notification: { title: 'Not Possible', body: res.reason, type: 'error' } };
        InnerMapNight.landingResolved();
        // The work of the night takes its hours
        if (res.hours && typeof InnerMap.passHours === 'function') InnerMap.passHours(res.hours);
        const notification = { title: { join: '📦 The Landing', inform: '🛡️ The Watch', rob: '🗡️ The Landing' }[choice], body: res.text, type: res.raided || res.beaten ? 'warning' : 'success' };
        if (res.jailed) return { notification, after: _toJail };
        return { notification };
    },
});

registerScene('night_market', {
    view(game, st) {
        const tile = _tile(game, st);
        if (!tile || !tile.settlement) return null;
        const player = game.player;
        const world = game.world;
        const can = NightStreets.canEnterMarket(player, world, tile, InnerMap.timeOfDay);
        const title = NightStreets.text('market_title') || 'The Night Market';
        const leave = { id: 'leave', icon: '↩', label: 'Leave', chance: null, odds: false, isDefault: true };
        if (!can.ok) return { icon: '🏮', title, text: can.reason, options: [leave] };
        const options = [];
        for (const w of NightStreets.marketWares(player, world, tile)) {
            options.push({
                id: `buy:${w.good}:${w.hot ? 1 : 0}`, icon: w.hot ? '🔥' : '📦',
                label: `Buy ${_label(w.good).toLowerCase()}${w.hot ? ' (stolen)' : ''}`, cost: `${w.price}g`,
                hint: `${w.qty} to be had${w.hot ? ': still hot, only a fence will take it back for a while' : ''}.`,
                chance: null, odds: false, can: _num(player.gold) >= w.price, reason: `You need ${w.price} gold`,
            });
        }
        const day = _num(world.day);
        const goods = Object.entries(player.inventory || {}).filter(([id, q]) => id !== 'gold' && q > 0)
            .map(([id, q]) => ({ id, q, hot: Underworld.hotQty(player, id, day) }))
            .sort((a, b) => b.hot - a.hot || Underworld.fencePrice(player, b.id, world, tile) - Underworld.fencePrice(player, a.id, world, tile))
            .slice(0, 8);
        for (const g of goods) {
            const price = Underworld.fencePrice(player, g.id, world, tile);
            options.push({ id: `sell:${g.id}`, icon: g.hot ? '🔥' : '🪙', label: `Sell ${_label(g.id).toLowerCase()} to the fence`, cost: `${price}g`, hint: `You carry ${g.q}${g.hot ? `, ${g.hot} of them hot` : ''}. No questions asked.`, chance: null, odds: false });
        }
        options.push(leave);
        const buyer = Gangs.buyer(player, world, tile);
        return {
            icon: '🏮', title,
            text: NightStreets.text('market_text', { where: st.where || 'a warehouse', fence: st.fence || NightStreets.fenceName(world, tile) }),
            stats: [`Your purse: ${Math.floor(_num(player.gold))}g`, buyer ? `The fence's purse: ${Math.floor(_num(buyer.purse))}g` : null].filter(Boolean),
            options,
        };
    },
    act(game, st, choice) {
        if (choice === 'leave') return { after: g => g.ui.hideCustomPanel() };
        const tile = _tile(game, st);
        const [what, good, hot] = String(choice).split(':');
        const res = what === 'buy'
            ? NightStreets.buyFromMarket(game.player, game.world, tile, good, hot === '1', 1)
            : NightStreets.sellAtMarket(game.player, game.world, tile, good, 1);
        if (!res || !res.success) return { invalid: true, notification: { title: 'The Night Market', body: (res && res.reason) || 'No deal.', type: 'error' } };
        return { state: st, notification: { title: '🏮 The Night Market', body: res.text, type: 'success' }, notify: true };
    },
});
