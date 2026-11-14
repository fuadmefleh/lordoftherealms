// ActionMenu — a hard hand with people (systems/peopleCrimes.js), on the Lots &
// Town Houses panel (ui/actionMenu/townLots.js): a tenant in arrears put in
// the stocks (their kin pay what they can), the winter warning on putting a
// tenant out, and "In your cellars": the captives you keep in a property of
// yours in town — fed or starved, let go, or sold to the galley masters when
// the town is a harbour and you stand in it. Buttons route through
// data-am-act → peopleCrimeAct, which redraws the Lots panel with the word.
import { ActionMenu } from './_ref.js';
import { PeopleCrimes } from '../../systems/peopleCrimes.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { esc, card, rowList, price } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

/** Extra rows for one of your houses with a tenant: the stocks for arrears. */
export function landlordRows(game, v) {
    if (!v || !v.tenant) return [];
    const rows = [];
    const st = game.player.peopleCrimes;
    const inStocks = st && Array.isArray(st.stocks) && st.stocks.some(x => x.q === v.q && x.r === v.r && x.ref === v.ref);
    const winter = PeopleCrimes.isWinter(game.world.day);
    if (inStocks) rows.push({ icon: '🔒', name: 'In the Stocks', desc: `${esc(v.tenant)} sits in the square for the debt`, off: true, why: `${esc(v.tenant)} is in the stocks already` });
    else if (v.owed > 0) {
        rows.push({
            icon: '🔒', name: 'Put Them in the Stocks', tone: 'bad', act: 'peopleCrimeAct', args: ['stocks', v.q, v.r, v.ref],
            desc: `For the ${v.owed}g they owe: their kin pay what they can. The town will remember a hard landlord${winter ? '; in this cold, the stocks can kill' : ''}.`,
        });
    } else rows.push({ icon: '🔒', name: 'Put Them in the Stocks', off: true, why: 'They owe you nothing: there is no debt to put them in the stocks for' });
    return rows;
}

/** The evict row's word in winter: the household goes into the snow. */
export function evictNote(game) {
    return PeopleCrimes.isWinter(game.world.day) ? ' It is winter: the household goes out into the snow, and the old and the young may not see the spring.' : '';
}

/** "In your cellars": the captives you keep. */
export function captivesHtml(game) {
    const { world, player } = game;
    const view = PeopleCrimes.view(player, world);
    if (!view.captives.length) return '';
    let html = '';
    for (const c of view.captives) {
        const here = player.q === c.q && player.r === c.r;
        const { p } = PeopleCrimes.personAt(world, c.q, c.r, c.pid);
        const age = p ? Math.floor(Townsfolk.age(p, world.day)) : null;
        const fed = c.fed && !c.dead;
        const state = c.dead ? 'Dead' : fed ? 'Fed' : `Starving (${c.hunger} day${c.hunger === 1 ? '' : 's'})`;
        const cost = PeopleCrimes.config().captive.feedCost || 2;
        const rows = [];
        if (!c.dead) {
            if (c.fed) rows.push({ icon: '🍞', name: 'Stop Feeding Them', tone: 'bad', act: 'peopleCrimeAct', args: ['starve', c.id], desc: 'No more bread goes down. They will die in the dark — and a starving cellar stinks.' });
            else rows.push({ icon: '🍞', name: 'Feed Them', act: 'peopleCrimeAct', args: ['feed', c.id], desc: `Bread and water bought in ${esc(c.town || 'the town')}`, side: `${price(cost)}/day` });
            rows.push({ icon: '🔓', name: 'Let Them Go', act: 'peopleCrimeAct', args: ['release', c.id], desc: 'They run home, and they will tell everyone what you did' });
            if (!c.harbour) rows.push({ icon: '⛓️', name: 'Sell to the Galleys', off: true, why: 'No galley master puts in here: only at a harbour town' });
            else if (!here) rows.push({ icon: '⛓️', name: 'Sell to the Galleys', off: true, why: `You must be in ${esc(c.town || 'the town')} to hand them over` });
            else rows.push({ icon: '⛓️', name: 'Sell to the Galleys', tone: 'bad', act: 'peopleCrimeAct', args: ['sell', c.id], desc: 'The galley master takes them aboard before dawn', side: price(p ? PeopleCrimes.bondagePrice(world, c.q, c.r, p) : 0) });
        }
        const body = `<div style="${NOTE}">${esc(c.town || 'town')}${here ? ' (here)' : ''} · in the cellar of your ${esc(c.place || 'house')} for ${c.days} day${c.days === 1 ? '' : 's'}${age != null ? ` · aged ${age}` : ''}</div>${rowList(rows)}`;
        html += card(body, { icon: '⛓️', title: esc(c.name), side: `<span style="color:${fed ? '#ccc' : '#e08080'};">${state}</span>`, tone: c.dead ? 'bad' : null });
    }
    return `<div style="margin-top:8px;">${card(`<div style="${NOTE}">Townsfolk you keep locked away. Each day their kin search, and the cellar may be found.</div>`, { icon: '🕯️', title: 'In Your Cellars' })}${html}</div>`;
}

Object.assign(ActionMenu, {
    /** The buttons above: op, then a holding (q, r, ref) or a captive's id. */
    peopleCrimeAct(game, op, a, b, c) {
        const { world, player } = game;
        let res;
        switch (op) {
            case 'stocks': res = PeopleCrimes.stockDebtor(player, world, a, b, c); break;
            case 'feed': res = PeopleCrimes.setFed(player, a, true); break;
            case 'starve': res = PeopleCrimes.setFed(player, a, false); break;
            case 'release': res = PeopleCrimes.release(player, world, a); break;
            case 'sell': {
                const cap = PeopleCrimes.captives(player).find(x => x.id === a);
                res = cap ? PeopleCrimes.sellToGalleys(player, world, { q: cap.q, r: cap.r, pid: cap.pid, captiveId: cap.id, night: true }) : { ok: false, text: 'No such captive.' };
                break;
            }
            default: return;
        }
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showTownLots(game, { ok: !!res.ok, text: res.text });
    },
});
