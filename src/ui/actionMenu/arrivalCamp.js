// ActionMenu — the Newcomers' Camp: who is camped outside a town, how their
// houses are coming on, what the camp does to the town, and the player's help
// (give food, coin or timber; pay the builders for every house: "Build them
// homes"). Logic lives in systems/arrivalCamps.js.
//
//   campCardHtml(game, settlement, q, r)   a card for the People panel (exported)
//   showArrivalCamp(game, q, r)            the panel (the player's own town when q/r are left out)
//   arrivalCampAct(game, op, value, q, r)  'food' | 'coin' | 'timber' (value: how much) | 'homes'
import { ActionMenu } from './_ref.js';
import { ArrivalCamps } from '../../systems/arrivalCamps.js';
import { rowList, lede, chips, esc, card, price } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

const _foods = (player) => ((player && player.constructor && player.constructor.FOOD_TYPES) || []);
const _have = (player, ids) => ids.reduce((t, id) => t + Math.max(0, Math.floor(Number(player && player.inventory && player.inventory[id]) || 0)), 0);

function _at(game, q, r) {
    const { world, player } = game;
    const qq = q != null ? q : player && player.q, rr = r != null ? r : player && player.r;
    const t = world && qq != null ? world.getTile(qq, rr) : null;
    const s = t && t.settlement;
    return s ? { s, q: qq, r: rr, here: !!player && player.q === qq && player.r === rr } : null;
}

/** One line of what the camp does to its town. */
function effectsLine(s, sum) {
    const bits = [];
    if (sum.sick > 1) bits.push(`🤒 sickness ×${sum.sick.toFixed(2)} under canvas${sum.food > 0 ? ' (fed: less)' : ''}`);
    if (sum.crime > 0) bits.push(`🗝️ thieving up in the town (+${Math.round(sum.crime * 100)}% crime)`);
    if (sum.mood < 0) bits.push(`😠 the town's mood ${sum.mood.toFixed(1)}`);
    return bits.length ? bits.join(' · ') : 'The town hardly notices them yet.';
}

/** The camp's card in the People panel (or '' with no camp). */
export function campCardHtml(game, settlement, q, r) {
    const sum = ArrivalCamps.summary(settlement);
    if (!sum) return '';
    const body = `<div>${sum.under} newcomers from ${esc(sum.from || 'afar')} under canvas (${sum.households} household${sum.households === 1 ? '' : 's'}); ${sum.housed} housed. ${sum.building} house${sum.building === 1 ? '' : 's'} going up${sum.waiting ? `, ${sum.waiting} waiting for timber` : ''}.</div>`
        + `<div style="${NOTE}">${effectsLine(settlement, sum)}</div>`
        + rowList([{ icon: '⛺', name: "The Newcomers' Camp", desc: 'how their houses come on; give food, coin or timber; pay the builders', act: 'showArrivalCamp', args: [q, r], side: '›' }]);
    return card(body, { title: "Newcomers' camp", icon: '⛺' });
}

Object.assign(ActionMenu, {
    /** The camp at a town: its people, their houses, its weight on the town, and the player's help when they stand there. */
    showArrivalCamp(game, q = null, r = null) {
        const at = _at(game, q, r);
        const s = at && at.s;
        const sum = s ? ArrivalCamps.summary(s) : null;
        if (!sum) {
            game.ui.showCustomPanel("⛺ The Newcomers' Camp", `<div style="font-size:12px;">${lede(s ? `No one is camped outside ${esc(s.name)} now.` : 'There is no town here.')}</div>`);
            return;
        }
        const { player, world } = game;
        const day = Number.isFinite(world.day) ? world.day : 0;
        let html = lede(`${sum.n} newcomers from ${esc(sum.from || 'afar')} came to ${esc(s.name)} with nowhere to live, and have camped on its outskirts for ${Math.max(0, day - sum.since)} days. The town grants them building lots a few households a week; each household builds its house with its own hands, or hires the town's carpenters and masons if it can pay.`);
        const feedDays = sum.food > 0 ? Math.max(1, Math.round(sum.food / Math.max(0.1, sum.under * (ArrivalCamps.aidConfig().eat || 0.5)))) : 0;
        html += chips([
            ['⛺', 'Under canvas', `${sum.under} (${sum.households} household${sum.households === 1 ? '' : 's'})`],
            ['🏡', 'Housed', `${sum.housed}`],
            ['🔨', 'Going up', `${sum.building}${sum.building ? ` (${sum.hired} hired, ${sum.own} by hand)` : ''}`],
            ...(sum.waiting ? [['🌲', 'Waiting for timber', `${sum.waiting}`]] : []),
            ['🍞', 'Fed', feedDays ? `${feedDays} day${feedDays === 1 ? '' : 's'}` : 'on their own'],
            ...(sum.fund > 0 ? [['💰', "Builders' fund", `${Utils.formatGold(sum.fund)}g`]] : []),
        ]);
        const st = Object.entries(sum.stores || {}).filter(([, n]) => n > 0);
        if (st.length) html += `<div style="${NOTE}">Given to build with: ${st.map(([g, n]) => `${n} ${esc(g)}`).join(', ')}.</div>`;
        if (sum.street) html += `<div style="${NOTE}">The newest street laid out for them: ${esc(sum.street)}.</div>`;
        html += `<div style="${NOTE} margin-top:4px;">${effectsLine(s, sum)}</div>`;
        if (!at.here) {
            html += `<div style="${NOTE} margin-top:6px;">Go to ${esc(s.name)} to help them.</div>`;
            game.ui.showCustomPanel(`⛺ The Camp at ${esc(s.name)}`, `<div style="font-size:12px; max-height:620px; overflow-y:auto;">${html}</div>`);
            return;
        }
        // ── What the player can give ──
        const foods = _foods(player);
        const food = _have(player, foods);
        const timberIds = ArrivalCamps.aidConfig().timber || [];
        const timber = _have(player, timberIds);
        const gold = Number(player.gold) || 0;
        const rows = [];
        const foodN = Math.min(food, Math.max(10, Math.ceil(sum.under * (ArrivalCamps.aidConfig().eat || 0.5) * 3)));
        rows.push(food > 0
            ? { icon: '🍞', name: `Give food (${foodN})`, desc: 'from your pack: fed, they fall sick less and steal less', act: 'arrivalCampAct', args: ['food', foodN, at.q, at.r], side: `${food} carried` }
            : { icon: '🍞', name: 'Give food', off: true, why: 'You carry no food.' });
        for (const n of [10, 50]) {
            rows.push({ icon: '💰', name: `Give ${n}g`, desc: 'into their purses: for timber and builders\' wages', act: gold >= n ? 'arrivalCampAct' : null, args: ['coin', n, at.q, at.r], side: price(n, gold >= n), off: gold < n, why: gold < n ? `You have ${Utils.formatGold(gold)}g.` : null });
        }
        rows.push(timber > 0
            ? { icon: '🌲', name: `Give timber and stone (${Math.min(timber, 20)})`, desc: 'planks, wood or stone from your pack: built with, nothing for them to buy', act: 'arrivalCampAct', args: ['timber', Math.min(timber, 20), at.q, at.r], side: `${timber} carried` }
            : { icon: '🌲', name: 'Give timber and stone', off: true, why: 'You carry no planks, wood or stone.' });
        const est = ArrivalCamps.buildHomesCost(s);
        if (est && est.cost > 0) {
            rows.push({ icon: '🏗️', name: 'Build them homes', desc: `pay the town's builders and the timber for every house still to come (${est.houses}): built in half the time, twice the lots a week; what is not spent comes back`, act: gold >= est.cost ? 'arrivalCampAct' : null, args: ['homes', 0, at.q, at.r], side: price(est.cost, gold >= est.cost), off: gold < est.cost, why: gold < est.cost ? `Builders and timber come to ${Utils.formatGold(est.cost)}g; you have ${Utils.formatGold(gold)}g.` : null, tone: 'gold' });
        } else if (sum.fund > 0) {
            rows.push({ icon: '🏗️', name: 'Build them homes', off: true, why: 'Paid for: the builders are at it.' });
        }
        html += rowList(rows, 'Help them');
        if (sum.aid > 0) html += `<div style="${NOTE}">You have given the camp about ${Math.round(sum.aid)}g's worth. The town remembers it.</div>`;
        game.ui.showCustomPanel(`⛺ The Camp at ${esc(s.name)}`, `<div style="font-size:12px; max-height:620px; overflow-y:auto;">${html}</div>`);
    },

    /** Give to the camp, or pay for their homes; then the panel again. */
    arrivalCampAct(game, op, value = 0, q = null, r = null) {
        const { player, world } = game;
        let res;
        if (op === 'homes') res = ArrivalCamps.buildHomes(player, world);
        else res = ArrivalCamps.give(player, world, op, value, _foods(player));
        const title = op === 'homes' ? '🏗️ Build Them Homes' : op === 'food' ? '🍞 Food for the Camp' : op === 'coin' ? '💰 Coin for the Camp' : '🌲 Timber for the Camp';
        if (res && res.success) game.ui.showNotification(title, res.text, 'success');
        else game.ui.showNotification(title, (res && res.reason) || 'It cannot be done.', 'warning');
        if (typeof game.updateUI === 'function') game.updateUI();
        ActionMenu.showArrivalCamp(game, q, r);
    },
});
