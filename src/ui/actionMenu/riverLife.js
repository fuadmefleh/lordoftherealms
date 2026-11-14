// ActionMenu — the River & Water panel: your river boat (buy one from a river
// town's boatwrights, step aboard, go ashore, load and unload its hold, sell
// it back), the fishing rights to the water here (lease, extend; your leases
// elsewhere), your raw fish and how long they keep (salt them), and the
// spring floods up near you. Logic lives in systems/riverBoats.js and
// systems/riverLife.js; this panel presents it in the action menu's voice.
//   showRiverLife(game)          the panel
//   riverLifeAct(game, op, ...)  every button's action
import { ActionMenu } from './_ref.js';
import { RiverBoats } from '../../systems/riverBoats.js';
import { RiverLife } from '../../systems/riverLife.js';
import { PlayerEconomy } from '../../player/playerEconomy.js';
import { PlayerInventory } from '../../core/inventory.js';
import { Hex } from '../../core/hex.js';
import { esc, lede, chips, purse, rowList, price, card } from './uiKit.js';

const _good = (id) => {
    const g = (PlayerEconomy.GOODS || {})[String(id).toUpperCase()];
    return { name: (g && g.name) || String(id).replace(/_/g, ' '), icon: (g && g.icon) || '📦' };
};
const WATER = { river: 'the river', lake: 'the lake', sea: 'the shore' };

Object.assign(ActionMenu, {
    showRiverLife(game) {
        const player = game.player;
        const world = game.world;
        const q = player.q, r = player.r;
        const tile = world.getTile(q, r);
        const boat = RiverBoats.boat(player);
        const here = boat && (boat.aboard || (boat.q === q && boat.r === r));
        const flood = RiverLife.floodAt(world, q, r);
        let html = '<div>';

        const intro = boat && boat.aboard
            ? `You are aboard your ${esc(boat.name.toLowerCase())}. Pick a river hex on the map to go: <b>quick with the current, slow against it</b>; a town's mill weir and bridge take their toll as you pass.`
            : 'The river is a road, a larder and a living: a boat to carry your goods, rights to the fishing, salt to make the catch keep.';
        html += lede(intro);
        html += chips([purse(player.gold), boat ? { icon: '🛶', label: esc(boat.name), value: `${RiverBoats.cargoCount(boat)}/${RiverBoats.holdOf(boat)}` } : null, flood ? { icon: '🌊', label: 'In flood', value: `${Math.round(flood * 100)}%`, cls: 'bad' } : null]);
        if (flood) html += card('The river is over its banks here: brown water through the fields and the lanes by it, wrack coming down. Nets set now are lost or torn; boats run fast downstream and hard up it.', { title: 'The Flood', icon: '🌊', tone: 'bad' });

        // ── The boat ──
        if (boat) {
            const rows = [];
            const where = boat.aboard ? 'aboard' : (boat.q === q && boat.r === r ? 'moored here' : `moored ${esc(RiverLife._placeName(world, boat.q, boat.r))}`);
            rows.push({ icon: boat.aboard ? '🛶' : '⚓', name: esc(boat.name), desc: `${where} · hold ${RiverBoats.cargoCount(boat)} of ${RiverBoats.holdOf(boat)}${boat.tolls ? ` · ${boat.tolls}g in tolls paid` : ''}`, side: '' });
            if (boat.lastToll) {
                const t = boat.lastToll;
                rows.push({ icon: '🚧', name: `Last toll: ${esc(t.town)}`, desc: t.paid ? `${t.paid}g at the weir and bridge` : t.inKind ? `paid in kind: one ${esc(_good(t.inKind).name.toLowerCase())}` : 'waved through: you had nothing to pay with', side: '' });
            }
            if (boat.aboard) rows.push({ icon: '🏞️', name: 'Go ashore', desc: 'Tie up here and step onto the bank', act: 'riverLifeAct', args: ['ashore'], side: '›' });
            else if (here) rows.push({ icon: '🛶', name: 'Step aboard', desc: 'Travel the map by water from here', act: 'riverLifeAct', args: ['board'], side: '›' });
            if (!boat.aboard && here && tile && tile.settlement) {
                const v = RiverBoats.saleValue(world, player, q, r);
                rows.push({ icon: '💰', name: 'Sell the boat', desc: RiverBoats.cargoCount(boat) ? 'Unload the hold first' : 'To the boatwright, out of the town\'s purse', act: v > 0 && !RiverBoats.cargoCount(boat) ? 'riverLifeAct' : null, args: ['sell'], side: v > 0 ? price(v) : 'no coin', off: !(v > 0) || RiverBoats.cargoCount(boat) > 0 });
            }
            html += rowList(rows, 'Your boat');
            if (here) {
                const hold = Object.entries(boat.cargo || {}).filter(([, n]) => n > 0);
                html += rowList(hold.map(([g, n]) => ({ icon: _good(g).icon, name: esc(_good(g).name), desc: `${n} in the hold`, act: 'riverLifeAct', args: ['unload', g], side: 'Unload ›' })), 'In the hold');
                const free = RiverBoats.holdFree(boat);
                const packs = Object.entries(player.inventory || {}).filter(([g, n]) => n > 0 && g !== 'gold');
                if (free > 0 && packs.length) {
                    html += rowList(packs.map(([g, n]) => ({ icon: _good(g).icon, name: esc(_good(g).name), desc: `${n} in your packs`, act: 'riverLifeAct', args: ['load', g], side: `Load ${Math.min(n, free)} ›` })), `Load the hold (${free} free)`);
                }
            }
        }
        const offers = RiverBoats.offers(world, player, q, r);
        if (offers.length && !(boat && boat.aboard)) {
            html += rowList(offers.map(o => ({
                icon: o.icon || '🛶', name: esc(o.name), desc: `${esc(o.desc || '')} Hold ${o.hold}.`,
                act: o.ok || (boat && o.reason && o.reason.startsWith('You need')) ? 'riverLifeAct' : null, args: ['buy', o.id],
                side: price(o.price, o.ok), off: !o.ok && !(boat && o.reason && o.reason.startsWith('You need')), why: o.reason ? esc(o.reason) : '',
            })), boat ? 'The boatwrights (your boat taken in part-payment)' : 'The boatwrights');
        }

        // ── Fishing rights ──
        const water = RiverLife.waterAt(world, q, r);
        if (water) {
            const holder = RiverLife.holderOf(world, q, r);
            const lease = RiverLife.leaseAt(world, q, r);
            const day = world.day || 0;
            const rows = [];
            if (!holder) rows.push({ icon: '🎣', name: `Free water: ${WATER[water]}`, desc: 'Nobody holds the fishing here. Set your nets as you please (and keep an eye out for poachers).', side: '' });
            else {
                const fee = RiverLife.leaseFee(world, q, r);
                rows.push({
                    icon: lease ? '📜' : '🎣',
                    name: lease ? `You hold the fishing of ${WATER[water]}` : `The fishing of ${WATER[water]}: ${esc(holder.name)}'s`,
                    desc: lease ? `${lease.until - day + 1} days left. Your nets take more here, and the bailiff keeps poachers off.` : 'Lease it and your nets take more, the bailiff leaves them be, and fewer poachers come.',
                    act: player.gold >= fee ? 'riverLifeAct' : null, args: ['lease'], side: `${lease ? 'Extend' : 'Lease'} ${price(fee, player.gold >= fee)}`,
                    off: player.gold < fee, why: `The lease is ${fee}g for ${RiverLife.config().leaseDays} days.`,
                });
            }
            html += rowList(rows, 'Fishing rights');
        }
        const leases = RiverLife.leases(world).filter(l => !(l.q === q && l.r === r));
        if (leases.length) html += rowList(leases.map(l => ({ icon: '📜', name: `${esc(WATER[l.water] || 'the water')} ${esc(RiverLife._placeName(world, l.q, l.r))}`, desc: `held of ${esc(l.holder && l.holder.name)} · ${l.until - (world.day || 0) + 1} days left`, side: '' })), 'Your other leases');

        // ── The catch ──
        const fv = RiverLife.fishView(world, player);
        if (fv.packs.n > 0 || (fv.hold && fv.hold.n > 0)) {
            const rows = [];
            const left = (v) => (v.daysLeft <= 0 ? 'goes off tonight' : `the oldest keeps ${v.daysLeft} more day${v.daysLeft === 1 ? '' : 's'}`);
            const canSalt = (n) => n >= fv.saltPer && fv.salt > 0;
            if (fv.packs.n > 0) rows.push({ icon: '🐟', name: `${fv.packs.n} raw fish in your packs`, desc: `${left(fv.packs)} · salt cures ${fv.saltPer} to a measure`, act: canSalt(fv.packs.n) ? 'riverLifeAct' : null, args: ['salt', 'packs'], side: canSalt(fv.packs.n) ? 'Salt ›' : '', off: !canSalt(fv.packs.n), why: fv.salt > 0 ? `${left(fv.packs)} · ${fv.saltPer} fish to a salt` : `${left(fv.packs)} · you have no salt` });
            if (fv.hold && fv.hold.n > 0 && here) rows.push({ icon: '🛶', name: `${fv.hold.n} raw fish in the hold`, desc: left(fv.hold), act: canSalt(fv.hold.n) ? 'riverLifeAct' : null, args: ['salt', 'hold'], side: canSalt(fv.hold.n) ? 'Salt ›' : '', off: !canSalt(fv.hold.n), why: fv.salt > 0 ? left(fv.hold) : `${left(fv.hold)} · you have no salt` });
            html += rowList(rows, `The catch (${fv.salt} salt to hand)`);
        }

        // ── Floods near ──
        const floods = RiverLife.floodsNow(world).filter(f => world.width > 0 && Hex.wrappingOffsetDistance(q, r, f.q, f.r, world.width) <= 10 && !(f.q === q && f.r === r));
        if (floods.length) {
            const seen = new Set();
            const rows = [];
            for (const f of floods) {
                if (seen.has(f.place)) continue;
                seen.add(f.place);
                rows.push({ icon: '🌊', name: `In flood ${esc(f.place)}`, desc: `till about day ${f.until}`, side: `${Math.round(f.sev * 100)}%`, tone: 'warn' });
                if (rows.length >= 6) break;
            }
            html += rowList(rows, 'The spring floods near you');
        }
        html += '</div>';
        game.ui.showCustomPanel(boat && boat.aboard ? '🛶 Your Boat & the River' : '🎣 River & Water', html);
    },

    riverLifeAct(game, op, a = null) {
        const player = game.player;
        const world = game.world;
        const say = (res, title, ok = 'success', text = null) => {
            if (!res || res.ok === false) game.ui.showNotification(title, (res && res.reason) || 'Not possible.', 'error');
            else if (text) game.ui.showNotification(title, text, ok);
            if (game.ui.updateStats) game.ui.updateStats(player, world);
            return !!(res && res.ok !== false);
        };
        switch (op) {
            case 'buy': {
                const res = RiverBoats.buy(world, player, player.q, player.r, a);
                say(res, '🛶 A Boat', 'success', res.ok ? `The boatwright hands you the pole: your ${res.boat.name.toLowerCase()} is moored at the quay${res.traded ? ` (your old boat went for ${res.traded}g toward it)` : ''}.` : null);
                break;
            }
            case 'sell': {
                const res = RiverBoats.sell(world, player, player.q, player.r);
                say(res, '💰 Boat Sold', 'success', res.ok ? `The boatwright counts out ${res.gold}g.` : null);
                break;
            }
            case 'board': say(RiverBoats.board(world, player), '🛶 Aboard', 'success', 'You step aboard and push off from the bank. Pick a river hex on the map to go.'); break;
            case 'ashore': say(RiverBoats.ashore(world, player), '🏞️ Ashore', 'success', 'You tie up and step onto the bank. The boat waits for you here.'); break;
            case 'load': {
                const res = RiverBoats.load(player, a, Infinity);
                say(res, '📦 Loaded', 'success', res.ok ? `${res.n} ${_good(a).name.toLowerCase()} stowed in the hold.` : null);
                break;
            }
            case 'unload': {
                const res = RiverBoats.unload(player, a, Infinity, (p, g) => PlayerInventory.canAdd(p, g));
                say(res, '📦 Unloaded', 'success', res.ok ? `${res.n} ${_good(a).name.toLowerCase()} into your packs.` : null);
                break;
            }
            case 'lease': {
                const res = RiverLife.lease(world, player, player.q, player.r);
                say(res, '📜 Fishing Rights', 'success', res.ok ? `You pay ${res.fee}g to ${res.lease.holder.name}: the fishing here is yours till day ${res.lease.until}.` : null);
                break;
            }
            case 'salt': {
                const res = RiverLife.saltFish(world, player, a === 'hold' ? 'hold' : 'packs');
                say(res, '🧂 Salted', 'success', res.ok ? `${res.fish} fish split, packed down in ${res.salt} salt: they will keep for months.` : null);
                break;
            }
            default: break;
        }
        return ActionMenu.showRiverLife(game);
    },
});
