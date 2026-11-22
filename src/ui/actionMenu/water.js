// ActionMenu — Water (player/thirst.js, systems/water.js): your thirst and the
// water in your skins; drink or fill them here; in a town, its wells — how
// many, which are foul and why, the water carriers when they all are, the
// well-diggers to clear them; a waterskin off the stalls; your ships' casks.
// Opened from the world map's 'water' action and the HUD's thirst bar;
// buttons route through data-am-act → waterAct.
import { ActionMenu } from './_ref.js';
import { Thirst } from '../../player/thirst.js';
import { Water } from '../../systems/water.js';
import { Trading } from '../../player/playerEconomy.js';
import { esc, lede, chips, card, rowList, price, purse } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function _when(n) {
    return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}

/** The town's wells as rows. */
function townHtml(game, s) {
    const { world, player } = game;
    const v = Water.view(world, s);
    const day = world.day || 0;
    const rows = [];
    rows.push({
        icon: v.ok ? '💧' : '🚱',
        name: `${v.wells} well${v.wells === 1 ? '' : 's'}${v.fresh ? `, and the ${v.fresh}` : ''}`,
        desc: v.dry ? 'Run dry in the drought: mud at the bottom of every one.'
            : v.fouled ? `${v.fouled === v.wells ? 'All foul' : `${v.fouled} foul, ${v.clean} running clean`}${!v.ok ? ' — nothing in the town is fit to drink.' : '.'}`
                : 'All running clean.',
        tone: v.ok ? (v.fouled ? 'warn' : 'good') : 'bad',
    });
    for (const c of v.causes) {
        rows.push({ icon: c.cause === 'drought' ? '🏜️' : c.cause === 'plague' ? '🐀' : '☠️', name: c.cause === 'drought' ? 'Dry' : `Foul with ${esc(Water.causeWord(c.cause))}`, desc: `${c.by ? `${esc(c.by)}'s doing. ` : ''}Clear ${_when(c.until - day)}.`, side: c.n > 1 ? `${c.n} wells` : '1 well' });
    }
    if (!v.ok && s.water && s.water.carried && s.water.carried.d >= day - 1) {
        rows.push({ icon: '🛒', name: 'Water carted in', desc: `From ${esc(s.water.carried.from || 'the next town')}: the town's purse pays the carriers every day the wells stay foul. People are leaving.` });
    }
    const q = Water.cleanQuote(world, s);
    if (q) {
        rows.push({
            icon: '🪣', name: 'Pay the well-diggers', desc: `They go down on ropes and haul the filth out: ${q.wells === 1 ? 'the well' : `${q.wells} wells`} clean in ${q.days} day${q.days === 1 ? '' : 's'}. The coin stays in ${esc(s.name)}.`,
            side: price(q.price, (player.gold || 0) >= q.price), off: (player.gold || 0) < q.price, why: `Needs ${Utils.formatGold(q.price)}g.`,
            act: 'waterAct', args: ['clean'],
        });
    }
    return rowList(rows, `🏘️ The water of ${esc(s.name)}`);
}

/** Your ships' water casks. */
function shipsHtml(game) {
    const ships = (game.player.ships || []).filter(Boolean);
    if (!ships.length) return '';
    return rowList(ships.slice(0, 6).map(sh => {
        const d = Math.floor(Water.shipWater(sh));
        return { icon: '⛵', name: esc(sh.name || 'Your ship'), desc: sh.status === 'docked' ? 'In port: her casks are filled free where the water is clean.' : `At sea: ${d} day${d === 1 ? '' : 's'} of water for her crew.`, side: `${d}/${Water.shipCap()} days`, tone: d <= 2 ? 'warn' : '' };
    }), '⛵ Water casks');
}

Object.assign(ActionMenu, {
    /** Water: thirst, the skins, the water here and the town's wells. */
    showWater(game, message = null) {
        const { world, player } = game;
        const t = world.getTile(player.q, player.r);
        const s = (t && t.settlement) || null;
        let html = '<div style="font-size:12px; max-height:560px; overflow-y:auto;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'bad' });
        if (!Thirst.on(player)) {
            html += lede('You give no thought to water: the needs are off.') + '</div>';
            game.ui.showCustomPanel('💧 Water', html);
            return;
        }
        const lvl = Thirst.level(player);
        const L = Thirst.label(player);
        const held = Thirst.held(player);
        const cap = Thirst.capacity(player);
        const src = Thirst.sourceHere(player, world);
        const w = Thirst.state(player);
        html += lede(lvl >= 70 ? 'You have drunk your fill.'
            : w.parched > 0 ? `${w.parched} day${w.parched === 1 ? '' : 's'} without water. You are dying of thirst.`
                : lvl < 30 ? 'Your tongue sticks to your teeth. Find water today.' : 'You could do with a drink.');
        html += chips([
            [L.icon, 'Thirst', `${lvl}% · ${L.label}`],
            ['🎒', 'Carried', cap ? `${held}/${cap} draughts` : 'no skin'],
            ['🌡️', 'Today', `${Thirst.drainMult(player, world)}× the thirst`],
            purse(player.gold),
        ]);
        const rows = [];
        if (src && !src.foul) {
            rows.push({ icon: '💧', name: `Drink from ${esc(src.label)}`, desc: 'Free. You drink your fill and fill your skins.', act: 'waterAct', args: ['drink'] });
            if (cap > held && src.kind !== 'ship') rows.push({ icon: '🎒', name: 'Fill your skins', desc: `${cap - held} draught${cap - held === 1 ? '' : 's'} of room.`, act: 'waterAct', args: ['fill'] });
        } else if (src && src.foul) {
            const p = Thirst.waterPrice();
            rows.push({ icon: '🛒', name: 'Buy carried water', desc: `The water carriers bring it from clean wells: ${Utils.formatGold(p)}g a draught, to the town.`, side: price(p * 3, (player.gold || 0) >= p), off: (player.gold || 0) < p, why: `A draught is ${Utils.formatGold(p)}g.`, act: 'waterAct', args: ['buy'] });
            if (!src.dry) rows.push({ icon: '🤢', name: 'Drink from the foul well anyway', desc: 'It slakes you. It may well give you the flux.', tone: 'bad', act: 'waterAct', args: ['anyway'] });
        }
        if (held >= 1) rows.push({ icon: '🎒', name: 'Drink from your skins', desc: `${held} draught${held === 1 ? '' : 's'} left.`, act: 'waterAct', args: ['skins'] });
        if (!src && !held) rows.push({ icon: '🏜️', name: 'No water here', desc: 'Find a river, a lake or a town. The sea is salt.' });
        html += rowList(rows, '💧 Here');
        // A waterskin off the stalls
        if (s) {
            let skin = null;
            try { skin = (Trading.getAvailableGoods(s, t, world) || []).find(g => g && g.id === Thirst.config().skin.good && g.quantity > 0) || null; } catch { skin = null; }
            if (skin) {
                const cost = Trading.buyCost(player, skin, 1, s);
                html += rowList([{ icon: '💧', name: `Buy ${cap ? 'another' : 'a'} waterskin`, desc: `${Thirst.config().skin.draughts} draughts more to carry: a day's drinking on the road.`, side: price(cost, (player.gold || 0) >= cost), off: (player.gold || 0) < cost, why: `Needs ${Utils.formatGold(cost)}g.`, act: 'waterAct', args: ['skin'] }], '🛍️ The stalls');
            }
            html += townHtml(game, s);
        }
        html += shipsHtml(game);
        html += `<div style="${NOTE} margin:6px 0;">You drink without thinking whenever you pass a river, a lake or a town with clean water, and from your skins when there is none. Thirst comes faster in heat, in the desert, on a long march and in a fight. A few days without water kill. A barrel in the pack holds ${Thirst.config().cask.draughts} draughts.</div>`;
        html += '</div>';
        game.ui.showCustomPanel('💧 Water', html);
    },

    /** The panel's buttons. */
    waterAct(game, op) {
        const { world, player } = game;
        const t = world.getTile(player.q, player.r);
        const s = (t && t.settlement) || null;
        let res;
        if (op === 'drink') res = Thirst.drinkHere(player, world);
        else if (op === 'anyway') res = Thirst.drinkHere(player, world, { anyway: true });
        else if (op === 'fill') res = Thirst.fillSkins(player, world);
        else if (op === 'skins') {
            const n = Thirst.drinkCarried(player, 100);
            res = n ? { success: true, text: `You drink ${n} draught${n === 1 ? '' : 's'} from your skins.` } : { success: false, reason: 'You are not thirsty enough to drink, or the skins are empty.' };
        } else if (op === 'buy') res = Thirst.buyWater(player, world, 3);
        else if (op === 'clean') res = s ? Water.clean(world, player, s) : { success: false, reason: 'There is no town here.' };
        else if (op === 'skin') {
            let g = null;
            try { g = s ? (Trading.getAvailableGoods(s, t, world) || []).find(x => x && x.id === Thirst.config().skin.good && x.quantity > 0) : null; } catch { g = null; }
            const r = g ? Trading.buyGoods(player, g, 1, s) : null;
            if (r && r.success) {
                Thirst.fillSkins(player, world);
                res = { success: true, text: 'You buy a waterskin and fill it.' };
            } else res = { success: false, reason: (r && r.reason) || 'No waterskins on the stalls.' };
        } else return;
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showWater(game, { ok: !!res.success, text: res.success ? res.text : res.reason });
    },
});
