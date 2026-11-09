// ActionMenu — Livestock: the town's livestock market (buy beasts by the
// head to keep at a place of yours, sell yours kept nearby, buy a horse to
// ride away) and Your Herds (every place you keep beasts: the head by kind,
// sex and age, room, fodder, sickness, the store of eggs, milk and wool, the
// property a herd works for; collect, slaughter at the yard, saddle a horse,
// stable your mount). Logic lives in systems/livestock.js; buttons route
// through data-am-act → livestockAct / herdAct. Opened from the world action
// menu ('livestock_market', 'my_herds'), a property's panel, and one of your
// beasts on the inner map ('herd_panel').
import { ActionMenu } from './_ref.js';
import { Livestock } from '../../systems/livestock.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, BTN_RED, CARD, esc, lede, bullets, chips, purse, sectionHead } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

/** Where bought beasts go: the place chosen on the market panel (a place key). */
let _dest = null;

function act(method, label, args, style = BTN_PLAIN, title = '') {
    return `<button data-am-act="${method}" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function off(label, why) {
    return `<button disabled style="${BTN_OFF}" title="${esc(why)}">${label}</button>`;
}

function message(m) {
    if (!m) return '';
    return `<div style="${CARD} border-color:${m.ok ? 'rgba(159,216,159,0.5)' : 'rgba(224,128,128,0.5)'};">${esc(m.text)}</div>`;
}

const lower = (s) => String(s || '').toLowerCase();

/** "18 ewes, 3 rams, 5 lambs (1 sick)" */
function countLine(id, c) {
    const sp = Livestock.species(id) || {};
    const parts = [];
    const pl = (word, n) => Livestock.plural(word, n);
    if (c.adultsF) parts.push(`${c.adultsF} ${pl(sp.femaleName || 'female', c.adultsF)}`);
    if (c.adultsM) parts.push(`${c.adultsM} ${pl(sp.maleName || 'male', c.adultsM)}`);
    if (c.young) parts.push(`${c.young} ${pl(sp.youngName || 'young', c.young)}`);
    return `${sp.icon || '🐾'} <b>${esc(c.total === 1 ? sp.name : (sp.plural || sp.name))}</b>: ${parts.join(', ')}${c.sick ? ` <span style="color:#e0a080;">(${c.sick} sick)</span>` : ''}`;
}

function storeLine(store) {
    const parts = Object.entries(store || {}).filter(([, n]) => n > 0).map(([g, n]) => {
        const good = Livestock.good(g);
        return `${good.icon || ''} ${Math.floor(n)} ${esc(lower(good.name))}`;
    });
    return parts.join(', ');
}

/** The settlement where the player stands, and its tile. */
function here(game) {
    const { world, player } = game;
    const tile = world && world.getTile ? world.getTile(player.q, player.r) : null;
    return { tile, s: tile && tile.settlement };
}

Object.assign(ActionMenu, {
    /** The town's livestock market: what it sells and at what price, where they go, and your beasts nearby to sell. */
    showLivestockMarket(game, msg = null) {
        const { world, player } = game;
        const { tile, s } = here(game);
        if (!s) { game.ui.showNotification('No Market', 'There is no livestock market here.', 'error'); return; }
        const pens = Livestock.market(world, s, tile);
        const places = Livestock.places(world, player);
        if (!places.some(p => p.key === _dest)) {
            const near = places.filter(p => p.q === s.q && p.r === s.r && !p.building);
            _dest = (near[0] || places.find(p => !p.building) || places[0] || {}).key || null;
        }
        const dest = places.find(p => p.key === _dest) || null;
        let html = '<div style="font-size:12px;">';
        html += message(msg);
        html += lede(`The pens at the edge of ${esc(s.name || 'town')}: beasts sold by the head, dearer as the pens empty, cheaper in the autumn cull.`);
        html += chips([purse(player.gold), player.mount ? { icon: '🐴', label: 'Riding', value: esc(player.mount.name) } : null]);

        // Where they go
        html += sectionHead('Keep them at');
        if (!places.length) {
            html += `<div style="${NOTE}">You have nowhere to keep beasts yet. A few hens fit a town house or lot; sheep, goats and cattle want a Pasture, Dairy, Cattle Ranch, farm or estate; a horse a ranch, inn or home of your own.</div>`;
        } else {
            html += '<div>';
            for (const p of places) {
                const herd = Livestock.herd(player, p.key);
                const used = Livestock.used(herd);
                const far = Livestock._hexes(s, p);
                const label = `${esc(p.name)} <span style="font-weight:normal; opacity:0.8;">${used}/${p.capacity}${far ? ` · ${far} hex${far === 1 ? '' : 'es'}` : ''}</span>`;
                html += p.key === _dest ? `<button style="${BTN_GOLD}">${label}</button>` : act('livestockAct', label, ['dest', p.key], BTN_PLAIN, p.building ? 'Still being built' : `Room for ${p.capacity - used} more (a hen takes 1, a pig 3, a cow 6, a horse 8)`);
            }
            html += '</div>';
        }

        // The pens
        html += sectionHead('For sale');
        if (!pens.length) html += `<div style="${NOTE}">No beasts for sale here.</div>`;
        for (const m of pens) {
            const sp = Livestock.species(m.id) || {};
            html += `<div style="${CARD}">`;
            html += `<div style="display:flex; justify-content:space-between; gap:8px; align-items:baseline;"><div style="font-weight:bold; color:var(--gold);">${m.icon} ${esc(m.name)}</div>`
                + `<div style="${NOTE}">${m.stock} in the pens · <b style="color:var(--text-primary);">${m.price}g</b> a head · they buy at ~${m.sellPrice}g</div></div>`;
            html += `<div style="${NOTE} margin-top:2px;">${esc(describe(m.id))}</div>`;
            const btns = [];
            const buy = (n, sex, label) => {
                if (m.stock < n) return off(label, m.stock ? `Only ${m.stock} left` : 'The pens are empty');
                const chk = Livestock.canKeep(world, player, dest, m.id, n);
                if (!chk.ok) return off(label, chk.reason);
                const cost = Livestock.buyCost(world, s, m.id, n, tile);
                const fee = Livestock.droveFee(m.id, n, Livestock._hexes(s, dest));
                const tip = `${cost}g${fee ? ` + ${fee}g to a drover` : ''}, kept at ${dest.name}`;
                return act('livestockAct', `${label} (${cost + fee}g)`, ['buy', m.id, n, sex], player.gold >= cost + fee ? BTN_GOLD : BTN_PLAIN, tip);
            };
            btns.push(buy(1, 'f', `Buy a ${lower(sp.femaleName || sp.name)}`));
            btns.push(buy(1, 'm', `Buy a ${lower(sp.maleName || sp.name)}`));
            if (m.size !== 'large') btns.push(buy(5, null, 'Buy 5'));
            else btns.push(buy(2, null, 'Buy a pair'));
            if (m.id === 'horse') {
                const price = Livestock.buyCost(world, s, 'horse', 1, tile);
                btns.push(player.mount ? off('Buy one to ride', `You already ride ${player.mount.name}`) : m.stock < 1 ? off('Buy one to ride', 'The pens are empty')
                    : act('livestockAct', `🏇 Buy one to ride (${price}g)`, ['ride'], BTN_GOLD, 'Your mount: more movement each day and room in your packs'));
            }
            html += `<div style="margin-top:4px;">${btns.join('')}</div></div>`;
        }

        // Your beasts nearby, to sell
        const near = Livestock.herdsNear(world, player, s);
        if (near.length) {
            html += sectionHead('Sell yours (kept here or next door)');
            for (const herd of near) {
                const pl = places.find(p => p.key === herd.key);
                html += `<div style="${CARD}"><div style="font-weight:bold;">${esc(pl ? pl.name : 'Your beasts')}</div>`;
                for (const [id, c] of Object.entries(Livestock.counts(herd))) {
                    const sp = Livestock.species(id) || {};
                    html += `<div style="margin-top:3px;">${countLine(id, c)}</div><div>`;
                    html += act('livestockAct', `Sell one`, ['sell', herd.key, id, 1], BTN_PLAIN, 'Spare males, the old and the sick go first');
                    if (c.total >= 5) html += act('livestockAct', 'Sell 5', ['sell', herd.key, id, 5], BTN_PLAIN);
                    if (c.total > 1) html += act('livestockAct', `Sell all ${c.total}`, ['sell', herd.key, id, c.total], BTN_RED, `Every ${lower(sp.name)} kept there`);
                    html += '</div>';
                }
                html += '</div>';
            }
        }
        html += `<div style="margin-top:8px;">${act('livestockAct', '🐑 Your Herds', ['herds'])}</div>`;
        html += '</div>';
        game.ui.showCustomPanel(`🐄 Livestock Market — ${s.name || 'Town'}`, html);
    },

    /** The market's buttons: op, then its arguments. */
    livestockAct(game, op, ...args) {
        const { world, player } = game;
        const { tile, s } = here(game);
        let res = null;
        switch (op) {
            case 'dest': _dest = args[0]; break;
            case 'buy': res = Livestock.buy(world, player, s, args[0], args[1], _dest, { sex: args[2] || null, tile }); break;
            case 'ride': res = Livestock.buy(world, player, s, 'horse', 1, null, { ride: true, tile }); break;
            case 'sell': res = Livestock.sell(world, player, s, args[0], args[1], args[2], { tile }); break;
            case 'herds': ActionMenu.showHerds(game); return;
            default: return;
        }
        if (res && res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showLivestockMarket(game, res ? { ok: !!res.success, text: res.success ? res.text : res.reason } : null);
    },

    /** Every place you keep beasts: the head, room, fodder, the store, and what can be done there. */
    showHerds(game, msg = null) {
        const { world, player } = game;
        const view = Livestock.view(world, player);
        let html = '<div style="font-size:12px;">';
        html += message(msg);
        if (!view.length) {
            html += lede('You keep no beasts of your own.') + bullets([
                'Buy them by the head at a town’s Livestock Market (Commerce, in town).',
                'Keep them where they suit: hens and ducks in a town house or lot; pigs, goats and sheep on a farm, orchard or estate; cattle and horses on a Pasture, Dairy, Ranch or estate.',
                'A Pasture, Dairy, Cattle Ranch or Horse Ranch comes with a founding herd: its output follows the head kept there.',
                'Feed them in winter (and all year in town), keep a male with the females for young, collect the eggs, milk and wool.',
            ]);
        } else {
            const heads = view.reduce((n, v) => n + v.herd.animals.length, 0);
            const feed = view.reduce((n, v) => n + v.feed, 0);
            html += chips([purse(player.gold), { icon: '🐾', label: 'Head', value: heads }, { icon: '🌾', label: 'Fodder', value: `${Math.round(feed * 10) / 10}g a day` },
                player.mount ? { icon: '🐴', label: 'Riding', value: esc(player.mount.name) } : null]);
            const mine = view.filter(v => v.q === player.q && v.r === player.r);
            const away = view.filter(v => !(v.q === player.q && v.r === player.r));
            for (const v of mine.concat(away)) html += herdCard(game, v, v.q === player.q && v.r === player.r);
        }
        // Your mount, to turn out at a place that keeps horses here
        if (player.mount) {
            const spots = Livestock.places(world, player).filter(p => p.q === player.q && p.r === player.r && p.species.includes('horse'));
            if (spots.length) {
                html += sectionHead(`Your mount, ${esc(player.mount.name)}`);
                for (const p of spots) {
                    const chk = Livestock.canKeep(world, player, p, 'horse', 1);
                    html += chk.ok ? act('herdAct', `Turn ${esc(player.mount.name)} out at ${esc(p.name)}`, ['stable', p.key], BTN_PLAIN, 'It joins the herd there (and may breed); saddle a horse there to ride again')
                        : off(`Turn out at ${esc(p.name)}`, chk.reason);
                }
            }
        }
        html += '</div>';
        game.ui.showCustomPanel('🐑 Your Herds', html);
    },

    /** The herds panel's buttons: op, the herd's key, and its argument. */
    herdAct(game, op, key, arg) {
        const { world, player } = game;
        let res;
        switch (op) {
            case 'collect': res = Livestock.collect(world, player, key); break;
            case 'slaughter': res = Livestock.slaughter(world, player, key, arg); break;
            case 'ride': res = Livestock.ride(world, player, key); break;
            case 'stable': res = Livestock.stableMount(world, player, key); break;
            default: return;
        }
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showHerds(game, { ok: !!res.success, text: res.success ? res.text : res.reason });
    },
});

/** One line on what a beast gives. */
function describe(id) {
    const sp = Livestock.species(id) || {};
    const gives = (sp.products || []).map(p => lower(Livestock.good(p.good).name));
    const meat = (sp.slaughter || []).map(e => lower(e.name || Livestock.good(e.good).name));
    const bits = [];
    if (gives.length) bits.push(`gives ${[...new Set(gives)].join(' and ')}`);
    if (sp.draft) bits.push('pulls the plough (a farm’s harvest)');
    if (sp.manure) bits.push('its muck feeds a farm’s fields');
    if (id === 'horse') bits.push('rides');
    if (meat.length) bits.push(`slaughtered: ${[...new Set(meat)].join(', ')}`);
    bits.push(`room ${Livestock.space(id)}`);
    bits.push(`fodder ${sp.feed}g a day when it can’t graze`);
    return bits.join(' · ');
}

function herdCard(game, v, isHere) {
    const { player } = game;
    let html = `<div style="${CARD}">`;
    html += `<div style="display:flex; justify-content:space-between; gap:8px; align-items:baseline;"><div style="font-weight:bold; color:var(--gold);">${esc(v.name)}${isHere ? ' <span style="font-weight:normal; color:#aaa;">(here)</span>' : ''}</div>`
        + `<div style="${NOTE}">room ${v.used}/${v.capacity} · fodder ${v.feed}g a day</div></div>`;
    if (v.hungry) html += `<div style="color:#e08080; font-size:11px;">⚠️ Hungry ${v.hungry} day${v.hungry === 1 ? '' : 's'}: no fodder paid — they give nothing and weaken.</div>`;
    if (v.works) {
        const pct = Math.round(v.works.factor * 100);
        html += `<div style="${NOTE}">Works for the property: <b style="color:${pct >= 100 ? '#9fd89f' : '#e0a080'};">${pct}%</b> of its ${esc(lower(Livestock.good(v.works.produces || '').name))} (target ${v.works.target} head)</div>`;
    }
    if (v.draft && v.draft > 1) html += `<div style="${NOTE}">Horses and muck lift the harvest +${Math.round((v.draft - 1) * 100)}%.</div>`;
    for (const [id, c] of Object.entries(v.counts)) {
        html += `<div style="margin-top:4px;">${countLine(id, c)}</div>`;
        if (isHere) {
            const sp = Livestock.species(id) || {};
            let row = act('herdAct', `🔪 Slaughter one`, ['slaughter', v.key, id], BTN_PLAIN, `${(sp.slaughter || []).map(e => e.name).join(', ')} into your packs`);
            if (id === 'horse') {
                row += player.mount ? off('🏇 Ride one', `You already ride ${player.mount.name}`) : act('herdAct', '🏇 Ride one', ['ride', v.key], BTN_GOLD, 'Saddle a grown horse as your mount');
            }
            html += `<div>${row}</div>`;
        }
    }
    const store = storeLine(v.store);
    if (store) {
        html += `<div style="margin-top:4px;">📦 In store: ${store} `;
        html += isHere ? act('herdAct', 'Collect', ['collect', v.key], BTN_GOLD) : `<span style="${NOTE}">(collect when you are there)</span>`;
        html += '</div>';
    }
    if (!isHere) html += `<div style="${NOTE} margin-top:3px;">Go there to collect, slaughter or ride; sell them at the market of the town nearest.</div>`;
    html += '</div>';
    return html;
}
