// ActionMenu — the Harbour panel: the harbourmaster and his berths, the dues
// your ships have paid and what you owe, your ships on the slip (stage by
// stage), careening and the dry dock (hull repair over days, the ship out of
// service), the fishing boats and the catch, the quay's work, and the ferries
// (across the strait from here; the river ferry near the town). Logic lives in
// systems/ports.js and world/ferries.js; this panel presents it in the action
// menu's voice.
//   showHarbour(game)          the panel
//   harbourAct(game, op, ...)  every button's action
import { ActionMenu } from './_ref.js';
import { Ports } from '../../systems/ports.js';
import { Ships } from '../../systems/ships.js';
import { Ferries } from '../../world/ferries.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { esc, lede, chips, purse, rowList, price, card } from './uiKit.js';
import { DayClock } from '../game/dayClock.js';

const _goodName = (id) => {
    const g = SettlementMarket.good(id);
    return (g && g.name) || String(id).replace(/_/g, ' ');
};
const _hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:00`;

Object.assign(ActionMenu, {
    showHarbour(game) {
        const player = game.player;
        const world = game.world;
        const q = player.q, r = player.r;
        const s = Ports.portAt(world, q, r);
        if (!s) {
            game.ui.showNotification('⚓ No Harbour', 'There is no harbour here.', 'error');
            return;
        }
        const master = Ports.master(world, s);
        const book = Ports.state(s);
        const berths = Ports.berths(world, player, q, r);
        const hour = (() => { try { return DayClock.now(); } catch (e) { return 12; } })();
        let html = '<div>';
        html += lede(`<b>${esc(master.name)}</b> keeps the harbour of ${esc(s.name)}: who ties up where, the dues on every ship that comes in, the lighters when the berths are full. Shipwrights work the slip and the careening beach; the fishing boats go out at first light.`);
        html += chips([
            purse(player.gold),
            berths ? { icon: '⚓', label: 'Berths', value: `${Math.max(0, berths.total - Math.max(0, berths.free))}/${berths.total}`, cls: berths.free <= 0 ? 'bad' : '' } : null,
            book.owed > 0 ? { icon: '📜', label: 'Owed', value: `${Math.round(book.owed)}g`, cls: 'bad' } : null,
            book.dues > 0 ? { icon: '💰', label: 'Dues paid here', value: `${Math.round(book.dues)}g` } : null,
        ]);
        if (book.owed > 0) {
            html += rowList([{ icon: '📜', name: `Pay the ${Math.round(book.owed)}g you owe`, desc: `${esc(master.name)} has it in his book against your ships`, act: player.gold >= 1 ? 'harbourAct' : null, args: ['payOwed'], side: price(Math.round(book.owed), player.gold >= book.owed), off: !(player.gold >= 1), why: 'You have no coin to pay with.' }], 'The harbourmaster\'s book');
        }

        // ── The berths ──
        if (berths) {
            const rows = [];
            rows.push({ icon: '⛵', name: `${berths.town} of the town's own ship${berths.town === 1 ? '' : 's'}`, desc: 'moored at the pier', side: '' });
            if (berths.traders) rows.push({ icon: '🚢', name: `${berths.traders} trading ship${berths.traders === 1 ? '' : 's'} in`, desc: 'loading and unloading at the quay', side: '' });
            if (berths.yours) rows.push({ icon: '⚓', name: `${berths.yours} of yours`, desc: 'in harbour, on the slip or hauled down', side: '' });
            rows.push({ icon: berths.free > 0 ? '✅' : '🔴', name: berths.free > 0 ? `${berths.free} berth${berths.free === 1 ? '' : 's'} free` : 'Every berth taken', desc: berths.free > 0 ? 'a ship of yours coming in ties up at the quay' : 'a ship of yours coming in lies in the roads: the lighters cost half as much again', side: '' });
            html += rowList(rows, `The berths (${berths.total})`);
        }

        // ── Your ships here ──
        const mine = (player.ships || []).filter(x => x && x.q === q && x.r === r);
        if (mine.length) {
            const rows = [];
            for (const ship of mine) {
                const st = Ships.getShipType(ship.typeId);
                const icon = (st && st.icon) || '⛵';
                if (ship.status === 'building') {
                    const at = Ports.stageOf(ship);
                    const used = Object.entries(ship.yardUsed || {}).map(([g, n]) => `${Math.round(n)} ${_goodName(g).toLowerCase()}`).join(', ');
                    rows.push({
                        icon: '🔨', name: `${esc(ship.name)} on the slip`,
                        desc: `${at ? esc(at.stage.name) : 'building'} · ${ship.buildDaysLeft} day${ship.buildDaysLeft === 1 ? '' : 's'} to launch${ship.yardWaiting ? ` · <b>waiting for ${esc(_goodName(ship.yardWaiting).toLowerCase())}</b>` : ''}`,
                        note: used ? `Into her so far: ${esc(used)}` : '',
                        side: at ? `${Math.round(at.progress * 100)}%` : '', tone: ship.yardWaiting ? 'warn' : '',
                    });
                    continue;
                }
                if (ship.status === 'careened') {
                    const c = ship.careen || {};
                    rows.push({ icon: '🛠️', name: `${esc(ship.name)} — ${c.kind === 'dock' ? 'in the dry dock' : 'hauled down on the beach'}`, desc: `out of service · hull ${Math.round(ship.condition)}% · afloat in ${c.left} day${c.left === 1 ? '' : 's'}`, side: '' });
                    continue;
                }
                if (ship.status !== 'docked') continue;
                const dmg = 100 - Math.round(ship.condition || 100);
                rows.push({ icon, name: esc(ship.name), desc: `${esc((st && st.name) || 'ship')} · hull ${Math.round(ship.condition || 100)}%${ship.duesOwed ? ` · ${Math.round(ship.duesOwed.amount)}g dues owed` : ''}`, side: '' });
                if (dmg >= 1) {
                    for (const o of Ports.careenOptions(world, player, ship)) {
                        rows.push({
                            icon: o.kind === 'dock' ? '🏗️' : '🏖️', name: `${o.kind === 'dock' ? 'Into the dry dock' : 'Careen her on the beach'}`,
                            desc: `${o.days} day${o.days === 1 ? '' : 's'} out of service, hull to 100% (the yard's quick repair: ${Ships.getRepairCost(ship)}g)`,
                            act: o.ok ? 'harbourAct' : null, args: ['careen', ship.id, o.kind], side: price(o.cost, player.gold >= o.cost), off: !o.ok, why: o.reason ? esc(o.reason) : '',
                        });
                    }
                }
            }
            html += rowList(rows, 'Your ships here');
        }

        // ── The slip (the town's own hull) ──
        const slip = Ports.slipAt(world, player, q, r).filter(x => x.kind === 'town');
        if (slip.length) {
            html += rowList(slip.map(x => ({ icon: '🌲', name: esc(x.name), desc: `${esc(x.stage.name)} — the town's shipwrights at work`, side: `${Math.round(x.progress * 100)}%` })), 'On the slip');
        }

        // ── The fishing boats ──
        const fl = Ports.fleet(world, q, r);
        if (fl && fl.boats > 0) {
            const F = Ports.config().fishing;
            const out = !fl.kept && hour >= F.out[0] && hour < F.back[1];
            const catchDay = Ports.catchPerDay(s);
            const why = fl.kept === 'ice' ? 'the harbour is frozen in' : fl.kept ? `a ${fl.kept} keeps them in` : out ? 'out on the water' : hour < F.out[0] ? `they go out about ${_hh(F.out[0])}` : 'in, the catch landed';
            html += rowList([
                { icon: '🎣', name: `${fl.boats} fishing boat${fl.boats === 1 ? '' : 's'}${fl.fishers != null ? ` (${fl.fishers} fisher${fl.fishers === 1 ? '' : 's'})` : ''}`, desc: `${why}; back between ${_hh(F.back[0])} and ${_hh(F.back[1])}`, side: fl.kept ? '⛈️' : out ? '⛵' : '⚓', tone: fl.kept ? 'warn' : '' },
                catchDay > 0 ? { icon: '🐟', name: `About ${Math.round(catchDay * 10) / 10} fish landed a day`, desc: 'into the market (a day the boats stay in, only what the shore gives)', side: '' } : null,
            ], 'The fishing boats');
        }

        // ── The quay ──
        const work = Ports.dockWork(world, player, q, r);
        if (work && (work.yours > 0 || work.trade > 0)) {
            html += rowList([
                work.yours > 0 ? { icon: '📦', name: `${Math.round(work.yours)} crates of yours over the quay`, desc: 'the dockers carry them between your hold and the warehouses', side: '' } : null,
                work.trade > 0 ? { icon: '🚚', name: `${work.trade} loads of the town's trade`, desc: 'in and out at the last market turn', side: '' } : null,
            ], 'The quay');
        }

        // ── Ferries ──
        const straits = Ports.straitOffers(world, player);
        if (straits.length) {
            html += rowList(straits.map(o => ({
                icon: '⛴️', name: `Across the strait to ${esc(o.to.name)}`,
                desc: `${esc(o.ferry.ferryman)}'s ferry, sailing at ${_hh(o.ferry.hours[0])} · ${o.ferry.dist} hexes of sea · the crossing takes the day`,
                act: o.ok ? 'harbourAct' : null, args: ['strait', o.ferry.id], side: price(o.fare, o.ok), off: !o.ok, why: o.reason ? esc(o.reason) : '',
            })), 'The strait ferry');
        }
        const rivers = Ferries.riverFerries(world).filter(f => f.town.q === q && f.town.r === r);
        if (rivers.length) {
            html += rowList(rivers.map(f => ({
                icon: '⛴️', name: `${esc(f.ferryman)}'s ferry over the great river`,
                desc: `sails at ${f.hours.map(_hh).join(', ')} · walk onto its hex to cross for the fare, not a wade`,
                side: price(f.fare, player.gold >= f.fare),
            })), 'The river ferry');
        }
        html += '</div>';
        game.ui.showCustomPanel(`⚓ The Harbour of ${esc(s.name)}`, html);
    },

    harbourAct(game, op, a = null, b = null) {
        const player = game.player;
        const world = game.world;
        const say = (res, title, text) => {
            if (!res || res.ok === false) game.ui.showNotification(title, (res && res.reason) || 'Not possible.', 'error');
            else if (text) game.ui.showNotification(title, text, 'success');
            if (game.ui.updateStats) game.ui.updateStats(player, world);
            return !!(res && res.ok !== false);
        };
        switch (op) {
            case 'payOwed': {
                const res = Ports.payOwed(world, player, player.q, player.r);
                say(res, '⚓ Dues Paid', res.ok ? `You pay the harbourmaster ${res.paid}g${res.left > 0 ? ` (${res.left}g still owed)` : ''}.` : null);
                break;
            }
            case 'careen': {
                const ship = Ships.getShipById(player, a);
                const res = Ports.careen(world, player, a, b || 'beach');
                say(res, '🛠️ Hauled Down', res.ok ? `The shipwrights ${res.kind === 'dock' ? 'float the ' + (ship ? ship.name : 'ship') + ' into the dry dock and pump it dry' : 'warp the ' + (ship ? ship.name : 'ship') + ' onto the beach at high water and heel her over'}: ${res.days} day${res.days === 1 ? '' : 's'} of scraping, caulking and new planks, for ${res.cost}g.` : null);
                break;
            }
            case 'strait': {
                const res = Ports.takeStrait(world, player, a);
                if (say(res, '⛴️ Across the Strait', res.ok ? `You pay ${res.fare}g and spend the day on the ferry's deck. You come ashore at ${res.to.name}.` : null)) {
                    if (typeof player.revealArea === 'function') player.revealArea(world, 4);
                    if (typeof player.updateVisibility === 'function') player.updateVisibility(world, 4);
                    if (typeof game.recenterCamera === 'function') game.recenterCamera();
                    if (game.renderer && typeof player.getReachableHexes === 'function') game.renderer.reachableHexes = player.getReachableHexes(world);
                    game.ui.hideCustomPanel();
                    return null;
                }
                break;
            }
            default: break;
        }
        return ActionMenu.showHarbour(game);
    },
});
