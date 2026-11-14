// ActionMenu — Landing Party (the action menu beside the coast, aboard or
// ashore beside an anchored ship): raids on coastal towns from the sea, beach
// runs past the customs house, a colony founded from the landing, and stores
// landed for a colony. Logic lives in systems/landings.js and
// player/coastalRaids.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Ships } from '../../systems/ships.js';
import { Landings } from '../../systems/landings.js';
import { CoastalRaids } from '../../player/coastalRaids.js';
import { esc, rowList, sectionHead, more, chips } from './uiKit.js';
import { Names } from '../../core/names.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): a section a kind of
// landing, one row a thing to do (greyed with its reason), its cost at the
// right. Clicks route through window._landing (set on each render).
const NOTE = 'font-size: 11px; color: var(--text-secondary); margin: 2px 0;';

function _pct(p) {
    return `${Math.round(p * 100)}%`;
}

function _label(id) {
    return String(id).replace(/_/g, ' ');
}

/** A row routed through window._landing.<call>. */
function _row(o, call, ok = true) {
    return { ...o, off: !ok, attrs: ok ? `onclick="window._landing.${call}"` : '' };
}

function _raidSection(game) {
    const { player, world } = game;
    const targets = CoastalRaids.targets(player, world);
    if (!targets.length) return '';
    const C = CoastalRaids.cfg();
    const ap = player.actionPoints || 0;
    let html = sectionHead('⚔️ Raid from the sea');
    html += `<div style="${NOTE}">Each ship's boats put ${C.troopsPerShip} soldiers ashore (your strongest first); war galleys bombard. Either way it costs karma and reputation, and the realm's coast stays on alarm for ${C.alarmDays} days.</div>`;
    for (const t of targets) {
        const q = CoastalRaids.quote(player, world, t.q, t.r);
        const s = t.settlement;
        const why = q.ok ? `Needs ${C.ap} AP` : esc(q.reason || '');
        const ok = q.ok && ap >= C.ap;
        const where = `${esc(s.type || 'town')}${t.kingdom ? `, ${esc(t.kingdom.name)}` : ', a free town'}`;
        const odds = `${q.troops || 0} of ${q.landed || 0} soldiers ashore · strength ${q.strength || 0} against about ${q.defense || '?'}${q.alarmed ? ' · <span style="color:#e08080;">the coast is on alarm</span>' : ''}`;
        html += rowList([
            _row({ icon: '💰', name: `Plunder ${esc(s.name)}`, desc: `${where} · ${odds}`, note: 'Gold and the best of the market to your hold, a boat-load a ship', why, side: `${C.ap} AP`, tone: 'bad' }, `raid(${t.q}, ${t.r}, 'plunder')`, ok),
            _row({ icon: '🔥', name: `Burn ${esc(s.name)}'s stores`, desc: 'Little gold, but the town goes hungry', why, side: `${C.ap} AP`, tone: 'bad' }, `raid(${t.q}, ${t.r}, 'burn')`, ok),
        ]);
    }
    return html;
}

function _runSection(game) {
    const { player, world } = game;
    if (player.boardedShip || !Landings._anchored(player).length) return '';
    let html = sectionHead('🌙 Run goods ashore');
    if (!Landings.onOpenCoast(player, world)) {
        return html + `<div style="${NOTE}">A port or jetty has a customs house. Run goods ashore on open coast.</div>`;
    }
    const watch = Landings.coastWatch(world, player.q, player.r);
    html += `<div style="${NOTE}">No customs house here: no duty and no embargo when sold. Contraband stays contraband. ` +
        `${watch ? `The coast watch of ${esc(Names.realm(watch.kingdom.name))}${watch.settlement ? ` (from ${esc(watch.settlement.name)})` : ''} patrols these shores.` : 'No realm watches this shore.'}</div>`;
    const opts = Landings.runOptions(player, world);
    const ap = player.actionPoints || 0;
    const R = Landings.config().run;
    const rows = [];
    for (const o of opts) {
        if (!o.ok && /no duty/.test(o.reason || '')) continue;
        rows.push(_row({
            icon: '⛵', name: `${esc(_label(o.goodId))} from the ${esc(o.shipName)}`,
            desc: o.ok ? `×${o.units} this trip · ${o.contraband ? 'contraband' : `${o.booked} booked`} · ${_pct(o.chance)} to be caught` : '',
            why: o.ok ? `Needs ${R.ap} AP` : esc(o.reason || ''), side: `${R.ap} AP`,
        }, `run('${esc(o.shipId)}', '${esc(o.goodId)}')`, o.ok && ap >= R.ap));
    }
    return html + (rows.length ? rowList(rows) : `<div style="${NOTE}">Nothing aboard owes duty or is forbidden here.</div>`);
}

function _landfallSection(game) {
    const { player, world } = game;
    if (player.boardedShip || !Landings._anchored(player).length) return '';
    const tile = world.getTile(player.q, player.r);
    if (tile && tile.settlement) return '';
    const L = Landings.config().landfall;
    const q = Landings.landfallQuote(player, world);
    const ok = q.ok && (player.actionPoints || 0) >= L.ap;
    return rowList([_row({
        icon: '🏕️', name: 'Found a landfall colony here',
        desc: `${L.supplies} founding stores off the hold and ${L.settlers} settlers from the ship. No quay: until a jetty is built, supplies come ashore a boat-load a day.`,
        why: q.ok ? `Needs ${L.ap} AP` : esc(q.reason || ''), side: `${q.cost}g · ${L.ap} AP`, tone: 'gold',
    }, 'landfall()', ok)], '🏕️ Found a colony');
}

function _supplySection(game) {
    const { player, world } = game;
    const q = Landings.supplyQuote(player, world);
    if (!q.ok) return '';
    const quay = !Ships.awaitsQuay(q.tile);
    let html = sectionHead(`📦 Land stores for ${esc(q.settlement.name)}`);
    html += `<div style="${NOTE}">Food to the colony's granary, every good to its market; a well-supplied colony draws settlers. ${quay ? 'The quay takes any amount.' : 'No quay yet: a boat-load a day.'}</div>`;
    const rows = [];
    for (const ship of q.ships) {
        const allowance = Ships.getFerryAllowance(ship, world, player.q, player.r);
        for (const [id, n] of Object.entries(ship.cargo || {})) {
            if (!(n > 0)) continue;
            rows.push(_row({ icon: '⛵', name: `Land the ${esc(_label(id))}`, desc: `From the ${esc(ship.name)}`, why: 'The boat has made all its trips today', side: `×${n}` }, `supply('${esc(ship.id)}', '${esc(id)}')`, allowance > 0));
        }
    }
    return html + (rows.length ? rowList(rows) : `<div style="${NOTE}">The hold is empty.</div>`);
}

Object.assign(ActionMenu, {
    /** The landing party: raids from the sea, beach runs, a landfall colony, stores for a colony. */
    showLandingParty(game) {
        const { player, world } = game;
        let html = '<div style="font-size:12px;">';
        html += chips([['⚡', 'AP', player.actionPoints || 0], ['⚔️', 'Soldiers', (player.army || []).length]]);
        const body = _raidSection(game) + _runSection(game) + _landfallSection(game) + _supplySection(game);
        html += body || `<div style="${NOTE}">Nothing to do from here: anchor a ship off open coast, or sail within reach of a coastal town.</div>`;
        const sum = Landings.summary(player, world);
        if (sum.alarms.length) {
            html += sectionHead('⚠️ Coasts on alarm') + sum.alarms.map(a => `<div style="${NOTE}">${esc(a.name)} watches its shores until day ${a.until}.</div>`).join('');
        }
        if (sum.log.length) {
            html += more('Lately', sum.log.slice().reverse().map(e => `<div style="${NOTE}">day ${e.day}: ${esc(e.text)}</div>`).join(''));
        }
        html += '</div>';
        game.ui.showCustomPanel('🛶 Landing Party', html);

        const after = (res, title) => {
            if (!res || res.success === false) {
                game.ui.showNotification(title, (res && (res.reason || res.message)) || 'It cannot be done.', 'error');
                return;
            }
            if (res.text) game.ui.showNotification(title, res.text, res.caught ? 'error' : 'success');
            game.ui.updateStats(player, world);
            ActionMenu.showLandingParty(game);
        };
        window._landing = {
            raid: (q, r, mode) => {
                const res = CoastalRaids.raid(player, world, q, r, mode);
                if (!res.success) return after(res, '⚔️ Raid');
                const goods = CoastalRaids.describeGoods(res.goods);
                const text = res.victory
                    ? `Your boats fell on the town${res.burned ? ' and put its stores to the torch' : ''}. ${res.plunder || 0}g taken${goods ? `, and ${goods} to the hold` : ''}. Soldiers lost: ${res.casualties || 0}.`
                    : `The garrison threw your landing back into the sea. Soldiers lost: ${res.casualties || 0}.`;
                game.ui.showNotification(res.victory ? '🔥 Raid from the Sea' : '⚔️ Landing Repelled', text, res.victory ? 'success' : 'error');
                game.ui.updateStats(player, world);
                ActionMenu.showLandingParty(game);
            },
            run: (shipId, goodId) => after(Landings.runAshore(player, world, shipId, goodId), '🌙 Beach Run'),
            landfall: () => {
                const res = Landings.foundLandfall(player, world);
                after(res, '🏕️ Landfall');
                if (res && res.success && typeof game.renderer?.markDirty === 'function') game.renderer.markDirty();
            },
            supply: (shipId, goodId) => after(Landings.supplyColony(player, world, shipId, goodId), '📦 Stores Landed'),
        };
    },
});
