// ActionMenu — the Crown's Treasury: a realm's budget (revenue and expense
// lines, yesterday and last week, the treasury's history as a sparkline), its
// tax levels, arrears and corruption (📒 Budget, for the realm you stand in or
// rule); every realm's purse compared (🏰 Realms); tax farms at auction where
// you stand, bidding, and your own farms' squeeze (📜 Tax farms); and for a
// ruler, the taxes, the army's pay, the court, auctions and sales (👑 Your
// purse). Logic lives in systems/fiscal.js and world/crownBooks.js; buttons
// route through data-am-act → ActionMenu.treasuryAct.
import { ActionMenu } from './_ref.js';
import { Fiscal } from '../../systems/fiscal.js';
import { CrownBooks } from '../../world/crownBooks.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, BTN_RED, CARD, panelTabs } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TH = 'text-align:left; padding:3px 6px; font-size:11px; color:var(--text-secondary); border-bottom:1px solid rgba(255,255,255,0.1);';
const TD = 'padding:3px 6px; border-bottom:1px solid rgba(255,255,255,0.05);';
const TABS = [['budget', '📒 Budget'], ['realms', '🏰 Realms'], ['farms', '📜 Tax farms'], ['crown', '👑 Your purse']];
const LABEL = {
    land: 'Land tax', poll: 'Hearth tax', excise: 'Excise', customs: 'Customs & tolls', demesne: 'Demesne & monopolies',
    seigniorage: 'Seigniorage', farms: 'Tax farms sold', levy: 'Extraordinary levy', sales: 'Offices & land sold',
    army: 'Army wages', court: 'Court & administration', works: 'Roads & works', debt: 'Debt service', dole: 'Dole & granaries',
    purse: 'The ruler\'s purse', loans: 'Borrowed', debase: 'Debasement', other: 'Other (events, tribute, temples, fleet)',
};

let _tab = 'budget';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="treasuryAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/** The treasury week by week (column 1 of the history rows). */
function sparkline(hist, col = 1, w = 120, h = 24) {
    const v = (hist || []).map(r => r[col]).filter(x => Number.isFinite(x));
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 1 - (x - lo) / span * (h - 2)).toFixed(1)}`).join(' ');
    const color = v[v.length - 1] >= v[0] ? '#8fd18f' : '#e08080';
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

const g0 = (v) => Math.round(v || 0).toLocaleString();
const lvl = (id) => { const L = Fiscal.config().levels[id] || {}; return `${L.icon || ''} ${L.label || id}`; };

function realmFor(game) {
    const { player, world } = game;
    const ruled = Fiscal.ruledKingdom(player, world);
    const here = Fiscal._realmHere(player, world);
    return { ruled, here, k: here || ruled };
}

function linesTable(b) {
    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Line</th><th style="${TH}">Yesterday</th><th style="${TH}">Last week</th></tr>`;
    const row = (l, sign) => {
        const d = b.last[l] || 0, w = b.week[l] || 0;
        if (Math.abs(d) < 0.5 && Math.abs(w) < 0.5) return '';
        const c = sign > 0 ? '#8fd18f' : '#e08080';
        return `<tr><td style="${TD}">${esc(LABEL[l] || l)}</td><td style="${TD} color:${c};">${sign > 0 ? '+' : '−'}${g0(Math.abs(d))}g</td><td style="${TD} color:${c};">${sign > 0 ? '+' : '−'}${g0(Math.abs(w))}g</td></tr>`;
    };
    html += `<tr><td colspan="3" style="${TD} font-weight:bold; color:var(--gold);">Revenue</td></tr>`;
    for (const l of CrownBooks.REVENUE_LINES) html += row(l, 1);
    html += `<tr><td style="${TD} font-weight:bold;">Total revenue</td><td style="${TD}">${g0(CrownBooks.revenue(b.last))}g</td><td style="${TD}">${g0(CrownBooks.revenue(b.week))}g</td></tr>`;
    html += `<tr><td colspan="3" style="${TD} font-weight:bold; color:#e08080;">Spending</td></tr>`;
    for (const l of CrownBooks.EXPENSE_LINES) html += row(l, -1);
    html += `<tr><td style="${TD} font-weight:bold;">Total spending</td><td style="${TD}">${g0(CrownBooks.expense(b.last))}g</td><td style="${TD}">${g0(CrownBooks.expense(b.week))}g</td></tr>`;
    for (const l of ['loans', 'debase', 'other']) {
        const d = b.last[l] || 0, w = b.week[l] || 0;
        if (Math.abs(d) < 0.5 && Math.abs(w) < 0.5) continue;
        html += `<tr><td style="${TD} ${NOTE}">${esc(LABEL[l])}</td><td style="${TD} ${NOTE}">${d >= 0 ? '+' : '−'}${g0(Math.abs(d))}g</td><td style="${TD} ${NOTE}">${w >= 0 ? '+' : '−'}${g0(Math.abs(w))}g</td></tr>`;
    }
    return html + '</table>';
}

function budgetTab(game) {
    const { world } = game;
    const { k } = realmFor(game);
    if (!k) return `<div style="${NOTE}">Stand in a town of a realm to read its books, or rule one.</div>`;
    const b = Fiscal.budget(world, k);
    let html = `<div style="${NOTE}">The crown's taxes come out of its towns' purses, and its wages and upkeep go back into them: the treasury is what is left. Land tax falls on the peasants' earnings (and swells with the harvest), the hearth tax on every working head (clergy and nobles are exempt), the excise on the artisans' work and the merchants' trade. Unpaid soldiers desert after a week; unpaid clerks help themselves.</div>`;
    html += `<div style="${CARD}"><b>${esc(k.name)}</b> · treasury <b>${g0(b.treasury)}g</b> ${sparkline(b.hist)} · ${b.reserveDays} days of spending in hand<br>`;
    html += `<span style="${NOTE}">Taxes: land ${lvl(b.rates.land)} · hearth ${lvl(b.rates.poll)} · excise ${lvl(b.rates.excise)} · army ${esc((Fiscal.config().army.levels[b.armyPay] || {}).label || b.armyPay)} · court ${esc((Fiscal.config().court.levels[b.courtLevel] || {}).label || b.courtLevel)}</span><br>`;
    html += `<span style="${NOTE}">The people's burden ${Math.round((b.burden || 0) * 100)}% (15% is the customary due) · stability ${b.stability >= 0 ? '+' : ''}${b.stability} · corruption ${Math.round(b.corruption * 100)}% · crown estates ${Math.round(b.demesne * 100)}% of the land's gold`;
    if (b.arrearsDays > 0) html += ` · <span style="color:#e08080;">soldiers unpaid ${b.arrearsDays} days (${g0(b.arrears.army)}g owed), the army at ${Math.round(b.armyFactor * 100)}%</span>`;
    if (b.deficitWeeks > 0) html += ` · <span style="color:#e8a040;">${b.deficitWeeks} week(s) in deficit</span>`;
    html += '</span></div>';
    html += linesTable(b);
    if (b.farms.length) html += `<div style="${NOTE} margin-top:6px;">Farmed out: ${b.farms.map(f => `${esc(f.town)} (${esc(f.holderName)}, to day ${f.until})`).join(' · ')}</div>`;
    return html;
}

function realmsTab(game) {
    const rows = Fiscal.realmTable(game.world);
    let html = `<div style="${NOTE}">Every realm's chests, last week's taxes and spending, its tax level and its treasury over the last year.</div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Realm</th><th style="${TH}">Treasury</th><th style="${TH}">Year</th><th style="${TH}">Week: in · out</th><th style="${TH}">Taxes</th><th style="${TH}">Troubles</th></tr>`;
    for (const r of rows) {
        const trouble = [r.arrearsDays > 0 ? `army unpaid ${r.arrearsDays}d` : '', r.corruption >= 0.1 ? `corrupt ${Math.round(r.corruption * 100)}%` : '', r.farms ? `${r.farms} farmed` : ''].filter(Boolean).join(' · ');
        html += `<tr><td style="${TD}">${esc(r.name)}</td><td style="${TD}">${g0(r.treasury)}g</td><td style="${TD}">${sparkline(r.hist, 1, 90, 20)}</td>`
            + `<td style="${TD}"><span style="color:#8fd18f;">${g0(r.rev)}</span> · <span style="color:#e08080;">${g0(r.exp)}</span></td><td style="${TD}">${lvl(r.level)}</td><td style="${TD} ${NOTE}">${esc(trouble) || '—'}</td></tr>`;
    }
    return html + '</table>';
}

function farmsTab(game) {
    const { player, world } = game;
    const { here, ruled } = realmFor(game);
    const F = Fiscal.config().farms;
    let html = `<div style="${NOTE}">A crown short of money sells the taxes of a town for ${F.term} days to the highest bidder, who collects them in its place. Collect gently and you barely clear your stake; press hard and you grow rich, hated, and may be driven out by a tax revolt. The new masters of a conquered town do not honour your farm.</div>`;
    const lots = here ? Fiscal.lots(world, here.id) : [];
    html += `<h5 style="margin:8px 0 4px;">Taxes at auction${here ? ` in ${esc(here.name)}` : ''}</h5>`;
    if (!here) html += `<div style="${NOTE}">Stand in a town of a realm to bid for its taxes.</div>`;
    else if (!lots.length) html += `<div style="${NOTE}">The crown of ${esc(here.name)} sells no taxes now.</div>`;
    for (const lot of lots) {
        const min = Fiscal.minBid(lot);
        const own = ruled && ruled.id === lot.kid;
        html += `<div style="${CARD}"><b>${esc(lot.town)}</b>: reckoned at ${g0(lot.est)}g over ${F.term} days · closes day ${lot.closes}<br><span style="${NOTE}">${lot.bank ? `${esc(lot.bank.name)} bids ${g0(lot.bank.bid)}g` : 'No house has bid'}${lot.player ? ` · your bid ${g0(lot.player.bid)}g (${esc(lot.player.squeeze)})` : ''} · least bid ${g0(min)}g</span><br>`;
        if (!own) for (const sq of Object.keys(F.squeeze || {})) html += act(`Bid ${g0(min)}g · ${esc(F.squeeze[sq].label)}`, ['bid', lot.id, sq], BTN_GOLD, player.gold >= min - (lot.player ? lot.player.bid : 0), esc(F.squeeze[sq].blurb || ''));
        html += '</div>';
    }
    const mine = Fiscal.playerFarms(world);
    html += '<h5 style="margin:10px 0 4px;">Your tax farms</h5>';
    if (!mine.length) html += `<div style="${NOTE}">You farm no taxes.</div>`;
    for (const f of mine) {
        html += `<div style="${CARD}"><b>${esc(f.town)}</b> (${esc(f.kingdom)}) · paid ${g0(f.paid)}g · collected ${g0(f.collected)}g (collectors ${g0(f.cost)}g) · to day ${f.until} · ${esc((F.squeeze[f.squeezeId] || {}).label || f.squeezeId)}<br>`;
        for (const sq of Object.keys(F.squeeze || {})) html += act(esc(F.squeeze[sq].label), ['squeeze', f.id, sq], sq === f.squeezeId ? BTN_GOLD : BTN_PLAIN, sq !== f.squeezeId);
        html += '</div>';
    }
    return html;
}

function crownTab(game) {
    const { world } = game;
    const { ruled } = realmFor(game);
    if (!ruled) return `<div style="${NOTE}">Only a ruler sets the taxes.</div>`;
    const b = Fiscal.budget(world, ruled);
    const C = Fiscal.config();
    let html = `<div style="${NOTE}">Set each tax, the army's pay and the court. Heavy taxes fill the chests and drive the poor to lighter realms; light ones starve the army. The burden here is what the people feel (welfare, migration, tax revolts); the stability term is the realm's.</div>`;
    for (const tax of ['land', 'poll', 'excise']) {
        html += `<div style="margin-top:6px;"><b>${esc(LABEL[tax])}</b>: `;
        for (const id of CrownBooks.LEVELS) html += act(lvl(id), ['rate', tax, id], b.rates[tax] === id ? BTN_GOLD : BTN_PLAIN, b.rates[tax] !== id, (C.levels[id] || {}).blurb || '');
        html += '</div>';
    }
    html += '<div style="margin-top:6px;"><b>Army pay</b>: ';
    for (const [id, L] of Object.entries(C.army.levels)) html += act(esc(L.label), ['army', id], b.armyPay === id ? BTN_GOLD : BTN_PLAIN, b.armyPay !== id, L.blurb || '');
    html += '</div><div style="margin-top:6px;"><b>Court</b>: ';
    for (const [id, L] of Object.entries(C.court.levels)) html += act(esc(L.label), ['court', id], b.courtLevel === id ? BTN_GOLD : BTN_PLAIN, b.courtLevel !== id, L.blurb || '');
    html += '</div>';
    html += `<div style="${CARD}">Burden ${Math.round((b.burden || 0) * 100)}% · stability ${b.stability >= 0 ? '+' : ''}${b.stability} · last week +${g0(CrownBooks.revenue(b.week))}g / −${g0(CrownBooks.expense(b.week))}g · ${b.reserveDays} days in hand</div>`;
    html += `<div style="${CARD}"><b>Raise money</b><br><span style="${NOTE}">Sell offices (gold now, corruption for years) or crown land (gold now, the crown's rents less for ever). Borrow and debase from the Bank and the Mint.</span><br>`;
    html += act('📜 Sell offices', ['sale', 'offices'], BTN_RED) + act('🌾 Sell crown land', ['sale', 'land'], BTN_RED, b.demesne > (C.demesne.min || 0.05) + 1e-9) + '</div>';
    html += `<div style="${CARD}"><b>Farm out a town's taxes</b><br><span style="${NOTE}">A house pays a lump now and collects the town's taxes (harder than your own men) for ${C.farms.term} days.</span><br>`;
    const towns = (world.getSettlementViews ? world.getSettlementViews() : []).filter(s => s && s.kingdom === ruled.id && !(ruled.capital && ruled.capital.q === s.q && ruled.capital.r === s.r));
    const open = Fiscal.lots(world, ruled.id).length > 0;
    for (const s of towns.slice(0, 12)) {
        const tile = world.getTile(s.q, s.r);
        const farmed = tile && tile.settlement && tile.settlement.taxFarm;
        html += act(`${esc(s.name)}${farmed ? ' (farmed)' : ''}`, ['farmOut', `${s.q},${s.r}`], BTN_PLAIN, !open && !farmed);
    }
    return html + '</div>';
}

Object.assign(ActionMenu, {
    /** The Crown's Treasury: budgets, every realm's purse, tax farms, a ruler's taxes. */
    showTreasury(game, tab = null) {
        if (tab) _tab = tab;
        const { player } = game;
        if (!Fiscal.enabled()) {
            game.ui.showCustomPanel('🧾 The Treasury', `<div style="${NOTE}">The crowns keep no books.</div>`);
            return;
        }
        let html = '<div style="font-size:12px;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">Gold ${Math.floor(player.gold)}</p>`;
        html += panelTabs(game, {
            id: 'treasury', title: '🧾 The Crown\'s Treasury', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showTreasury(game); },
            attrsFor: (k) => `data-am-act="treasuryAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (_tab === 'realms') html += realmsTab(game);
        else if (_tab === 'farms') html += farmsTab(game);
        else if (_tab === 'crown') html += crownTab(game);
        else html += budgetTab(game);
        html += '</div>';
        game.ui.showCustomPanel('🧾 The Crown\'s Treasury', html);
    },

    treasuryAct(game, op, a = null, b = null) {
        const { player, world } = game;
        let res = null;
        switch (op) {
            case 'tab': _tab = a || 'budget'; break;
            case 'bid': res = Fiscal.bid(player, world, a, b); break;
            case 'squeeze': res = Fiscal.setSqueeze(player, world, a, b); break;
            case 'rate': res = Fiscal.setRate(player, world, a, b); break;
            case 'army': res = Fiscal.setArmyPay(player, world, a); break;
            case 'court': res = Fiscal.setCourt(player, world, a); break;
            case 'sale': res = Fiscal.royalSale(player, world, a); break;
            case 'farmOut': res = Fiscal.royalFarm(player, world, a); break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('🧾 The Treasury', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showTreasury(game);
    },
});
