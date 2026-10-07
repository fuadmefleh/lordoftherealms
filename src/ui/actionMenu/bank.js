// ActionMenu — Banks, Credit & Coin: the banking house panel (deposit and
// withdraw, loans with their terms, royal bonds, the credit report, the
// realms' coin, and the crown's purse for a ruling player). Logic lives in
// systems/finance.js; this panel presents it. Buttons route through
// data-am-act → ActionMenu.bankAct.
import { ActionMenu } from './_ref.js';
import { Finance } from '../../systems/finance.js';
import { Bills } from '../../systems/bills.js';
import { Underworld } from '../../systems/underworld.js';

const BTN = 'padding: 5px 9px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const BTN_RED = BTN + 'background: #7a3030; color: #eee;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const TABS = [['accounts', '🏦 Accounts'], ['loans', '📜 Loans'], ['bills', '✉️ Bills'], ['bonds', '👑 Royal Bonds'], ['credit', '📊 Credit'], ['coin', '💱 Coin']];

let _tab = 'accounts';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pct(v, digits = 1) {
    return `${(v * 100).toFixed(digits)}%`;
}

function bar(value, max, color) {
    const p = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin-top:3px;"><div style="width:${p}%; height:100%; background:${color};"></div></div>`;
}

/** A button routed to ActionMenu.bankAct(game, ...args). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="bankAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function kname(world, id) {
    const k = world.getKingdom ? world.getKingdom(id) : null;
    return k ? k.name : 'a realm';
}

function bankLine(world, b, day) {
    const status = b.status !== 'open' ? '<span style="color:#e06060;">failed</span>'
        : Finance.inPanic(b, day) ? '<span style="color:#e0a040;">a run on the house</span>'
            : `reserves ${Math.round(Finance.reserveRatio(b) * 100)}%`;
    return `<b>${esc(b.name)}</b> · ${esc(b.seat)}, ${esc(kname(world, b.kingdomId))} · ${status}`;
}

function accountsTab(player, world, here) {
    const st = Finance.state(player);
    const day = world.day || 0;
    let html = '<div style="font-size:11px; color:#999;">Deposits earn a slow, safe interest, compounded daily, and the house lends them on. If a house fails, its receivers pay back only part.</div>';
    for (const b of here) {
        const acct = st.accounts[b.id];
        const bal = Math.floor(acct ? acct.balance : 0);
        html += `<div style="${CARD}">${bankLine(world, b, day)}<div style="font-size:12px; margin-top:4px;">Your deposit: <b>${bal}g</b>${acct ? ` · interest earned ${Math.floor(acct.interest)}g` : ''} · pays <b>${pct(Finance.depositApr(b))}</b> a year</div>`;
        html += '<div>';
        for (const amt of [100, 500, 1000, 5000]) html += act(`Deposit ${amt}g`, ['deposit', b.id, amt], BTN_GOLD, player.gold >= amt);
        html += '</div><div>';
        for (const amt of [100, 500, 1000]) html += act(`Withdraw ${amt}g`, ['withdraw', b.id, amt], BTN_PLAIN, bal >= amt);
        html += act('Withdraw all', ['withdraw', b.id, null], BTN_PLAIN, bal > 0);
        html += '</div></div>';
    }
    const elsewhere = Object.entries(st.accounts).filter(([id]) => !here.some(b => b.id === id));
    if (elsewhere.length) {
        html += '<h5 style="margin:10px 0 4px;">Deposits elsewhere</h5>';
        for (const [id, a] of elsewhere) {
            const b = Finance.bank(player, id);
            if (b) html += `<div style="font-size:12px;">${bankLine(world, b, day)} · <b>${Math.floor(a.balance)}g</b></div>`;
        }
    }
    return html;
}

function loansTab(player, world, here) {
    const st = Finance.state(player);
    let html = '';
    if (st.loans.length) {
        html += '<h5 style="margin:6px 0 4px;">Your loans</h5>';
        for (const l of st.loans) {
            const over = l.overdue > 0 ? ` · <span style="color:#e06060;">${l.overdue} days overdue</span>` : '';
            html += `<div style="${CARD}"><b>${Math.ceil(l.totalOwed)}g owed</b> to ${esc(l.lender || 'your creditors')} · ${l.dailyPayment}g a day · ${l.remainingDays} days left${over}`;
            html += `<div>${act(`Repay in full (${Math.ceil(l.totalOwed)}g)`, ['repay', l.id], BTN_RED, player.gold >= Math.ceil(l.totalOwed))}</div></div>`;
        }
    } else {
        html += '<div style="color:#aaa; font-size:12px;">You owe nothing.</div>';
    }
    for (const [id, owed] of Object.entries(st.blacklist)) {
        const b = Finance.bank(player, id);
        html += `<div style="${CARD} border-color:rgba(224,96,96,0.4);">💀 Written off as a defaulter: <b>${Math.ceil(owed)}g</b> to ${esc(b ? b.name : 'the exchequer')}. ${act(`Make good (${Math.ceil(owed)}g)`, ['settle', id], BTN_RED, player.gold >= owed)}</div>`;
    }
    const D = Finance.cfg('default');
    html += `<div style="font-size:11px; color:#999; margin-top:6px;">Miss a day and a late fee is added. ${D.bailiffsAt || 7} days overdue: bailiffs take goods. ${D.seizeAt || 14}: deposits, properties, ships and company funds are seized. ${D.declareAt || 30}: you are declared a defaulter (reputation, Prestige, a bounty or the debtors' prison for large debts).</div>`;
    for (const b of here) {
        html += `<div style="${CARD}">${bankLine(world, b, world.day || 0)}`;
        for (const o of Finance.loanOffers(player, world, b.id)) {
            html += `<div style="font-size:12px; margin-top:5px;"><b>${esc(o.name)}</b>: ${o.amount}g for ${o.duration} days at ${pct(o.rate)} → ${o.totalOwed}g (${o.dailyPayment}g a day) `;
            html += act('Borrow', ['borrow', b.id, o.id], BTN_GOLD, o.available, o.reason || '');
            if (!o.available && o.reason) html += `<span style="font-size:11px; color:#a88;"> ${esc(o.reason)}</span>`;
            html += '</div>';
        }
        html += '</div>';
    }
    return html;
}

function billsTab(player, world, here) {
    const C = Bills.config();
    const day = world.day || 0;
    let html = `<div style="font-size:11px; color:#999;">Robbers take a share of any gold you carry. Pay it in here and carry a bill of exchange instead, payable at another house's seat or branches. The fee rises with the distance. A stolen bill can be stopped at the paying house before a forger cashes it (a few days); a bill on a failed house falls on the house that drew it.</div>`;
    const held = Bills.held(player);
    if (held.length) {
        html += '<h5 style="margin:10px 0 4px;">Your bills</h5>';
        for (const b of held) {
            const payer = Bills.payer(player, b);
            const canHere = payer && here.some(x => x.id === payer.id);
            const when = day < b.payableFrom ? `payable from day ${b.payableFrom}` : day > b.validUntil ? '<span style="color:#e0a040;">overdue: protest fee</span>' : `good until day ${b.validUntil}`;
            html += `<div style="font-size:12px; margin-top:4px;">✉️ <b>${b.amount}g</b> on ${esc(b.payName)} (${esc(b.payAt)}) · ${when}${b.protested ? ` · falls on ${esc(b.fromName)}` : ''}`;
            if (b.status === 'stolen') html += ` · <span style="color:#e06060;">STOLEN: a forger cashes it about day ${b.cashDay}</span> ${act('Stop it', ['stopBill', b.id], BTN_RED, canHere)}`;
            else html += ` ${act('Present', ['presentBill', b.id], BTN_GOLD, canHere && day >= b.payableFrom)}`;
            html += '</div>';
        }
    }
    for (const from of here) {
        html += `<div style="${CARD}"><b>Draw a bill at ${esc(from.name)}</b>`;
        for (const to of Bills.payees(player, from.id)) {
            const t = Bills.terms(player, world, from.id, to.id, 1000);
            html += `<div style="font-size:12px; margin-top:4px;">On ${esc(to.name)} (${esc(to.seat)}): fee ${(t.rate * 100).toFixed(1)}% (min ${C.minFee}g), payable after ${t.usance} day(s) `;
            for (const amt of [500, 2000, 5000]) {
                const tt = Bills.terms(player, world, from.id, to.id, amt);
                html += act(`${amt}g (+${tt.fee}g)`, ['drawBill', from.id, to.id, amt], BTN_GOLD, player.gold >= amt + tt.fee);
            }
            html += '</div>';
        }
        html += '</div>';
    }
    const g = Underworld.ensure(player).guild;
    if (g && g.member && g.rank >= C.forgery.minRank && here.length) {
        html += `<div style="${CARD} border-color:rgba(224,96,96,0.4);">🗝️ The guild's forger can draw a bill on a house here (${Math.round(C.forgery.fee * 100)}% up front). Clerks hold bills to the light.<div>`;
        for (const amt of [500, 1500]) html += act(`Forge ${amt}g on ${esc(here[0].name)}`, ['forgeBill', here[0].id, amt], BTN_RED);
        html += '</div></div>';
    }
    return html;
}

function bondsTab(player, world) {
    const st = Finance.state(player);
    const D = Finance.cfg('bonds');
    let html = `<div style="font-size:11px; color:#999;">Lend to a crown: interest every ${D.couponEvery || 7} days, the principal at maturity, the crown's favour (reputation) and Prestige for your House. A crown in trouble may miss payments, or repudiate its debts.</div>`;
    if (st.bonds.length) {
        html += '<h5 style="margin:10px 0 4px;">Your bonds</h5>';
        for (const b of st.bonds) {
            html += `<div style="font-size:12px;">${esc(b.kingdomName || kname(world, b.kingdomId))}: <b>${Math.floor(b.principal)}g</b> at ${pct(b.apr)} · matures day ${b.maturity} · ${Math.floor(b.coupons)}g paid${b.missed ? ` · <span style="color:#e0a040;">${b.missed} missed</span>` : ''} ${act('Sell', ['sellBond', b.id], BTN_PLAIN)}</div>`;
        }
    }
    html += '<h5 style="margin:10px 0 4px;">Crowns borrowing</h5>';
    const terms = D.terms || [120, 240];
    for (const o of Finance.bondOffers(player, world)) {
        const r = Finance.realmReport(world, o.kingdom);
        html += `<div style="${CARD}"><b style="color:${o.kingdom.color || 'inherit'};">${esc(o.kingdom.name)}</b> · ${pct(o.apr)} a year · debt ${Math.round(r.ratio * 100)}% of capacity · coin ${Math.round(r.purity * 100)}%${r.defaults ? ` · ${r.defaults} default(s)` : ''}${o.held ? ` · you hold ${o.held}g` : ''}<div>`;
        for (const amt of [500, 1000, 5000]) {
            for (const t of terms) html += act(`${amt}g / ${t}d`, ['bond', o.kingdomId, amt, t], BTN_GOLD, player.gold >= amt && amt <= o.room);
        }
        html += '</div></div>';
    }
    return html;
}

function creditTab(player, world) {
    const rep = Finance.creditReport(player, world);
    const col = rep.collateral;
    let html = `<div style="${CARD}"><div style="font-size:20px; font-weight:bold;">${rep.score} <span style="font-size:13px; color:var(--text-secondary);">${esc(rep.label)}</span></div>${bar(rep.score - 300, 550, rep.score >= 670 ? '#5cb85c' : rep.score >= 580 ? '#d0b040' : '#d05050')}`;
    html += `<div style="font-size:12px; margin-top:6px;">Borrowing limit <b>${rep.limit}g</b> · owed ${rep.debt}g · available <b>${rep.available}g</b></div></div>`;
    html += '<h5 style="margin:10px 0 4px;">What the houses see</h5>';
    for (const p of rep.parts) html += `<div style="font-size:12px;">${esc(p.label)}: <span style="color:${p.value >= 0 ? '#8fd18f' : '#e08080'};">${p.value >= 0 ? '+' : ''}${p.value}</span></div>`;
    html += '<h5 style="margin:10px 0 4px;">Collateral</h5>';
    html += `<div style="font-size:12px;">Properties ${Math.round(col.properties)}g · ships ${Math.round(col.ships)}g · company ${Math.round(col.company)}g · holdings ${Math.round(col.holdings)}g · deposits ${col.deposits}g · <b>total ${col.total}g</b></div>`;
    const st = Finance.state(player);
    html += `<div style="font-size:11px; color:#999; margin-top:6px;">Loans repaid ${st.credit.repaid} · payments missed ${st.credit.missed} · defaults ${st.credit.defaults}${st.credit.settled ? ` · debts made good ${st.credit.settled}` : ''}</div>`;
    return html;
}

function coinTab(player, world) {
    let html = '<div style="font-size:11px; color:#999;">Each realm strikes its own coin. A crown in trouble may clip it: gold for the mint now, dearer prices in every market of the realm after.</div>';
    for (const k of (world.kingdoms || []).filter(x => x && x.isAlive !== false)) {
        const r = Finance.realmReport(world, k);
        html += `<div style="font-size:12px; margin-top:4px;"><b style="color:${k.color || 'inherit'};">${esc(k.name)}</b>: coin ${Math.round(r.purity * 100)}% silver${r.priceMult > 1 ? ` (prices +${Math.round((r.priceMult - 1) * 100)}%)` : ''} · trust ${r.trust} · crown debt ${r.debt}g${r.levy ? ' · <span style="color:#e0a040;">war levy</span>' : ''}${r.defaults ? ` · ${r.defaults} default(s)` : ''}</div>`;
    }
    const ruled = Finance.ruledKingdom(player, world);
    if (ruled) {
        const r = Finance.realmReport(world, ruled);
        html += `<h5 style="margin:12px 0 4px;">👑 The crown's purse (${esc(ruled.name)})</h5>`;
        html += `<div style="font-size:12px;">Treasury ${Math.floor(ruled.treasury || 0)}g · income ≈${r.income}g a day · debt ${r.debt}g (${Math.round(r.ratio * 100)}% of capacity)</div><div>`;
        for (const amt of [5000, 20000]) html += act(`Borrow ${amt}g for the crown`, ['royalBorrow', amt], BTN_GOLD);
        html += act('Debase the coin', ['royalDebase'], BTN_RED, r.purity > 0.55, 'Gold for the mint now; prices rise and stability falls');
        html += act('Repudiate the debts', ['royalDefault'], BTN_RED, r.debt > 0, 'The lenders lose; your realm loses stability and credit');
        html += '</div>';
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The banking house panel (from a town with a house or branch, the Counsel, or anywhere). */
    showBank(game, tile = null) {
        const player = game.player;
        const world = game.world;
        const t = tile || world.getTile(player.q, player.r);
        const here = Finance.banksAt(player, world, t);
        const s = Finance.summary(player, world);
        let html = '<div style="font-size:12px; max-height:620px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">Credit <b>${s.score}</b> (${esc(s.label)}) · deposits ${s.deposits}g · owed ${s.debt}g (${s.dailyDue}g a day) · bonds ${s.bonds}g · gold ${Math.floor(player.gold)}</p>`;
        if (!here.length) {
            const open = Finance.openBanks(player);
            html += `<div style="font-size:11px; color:#c9a;">No banking house serves this place: deposits, loans and bonds are arranged at ${open.length ? open.map(b => `${esc(b.name)} (${esc(b.seat)})`).join(', ') : 'a house in a great city'} or its branches in their realm's cities. You can still repay a loan from here.</div>`;
        }
        html += '<div style="margin:6px 0;">';
        for (const [id, label] of TABS) html += act(label, ['tab', id], _tab === id ? BTN_GOLD : BTN_PLAIN);
        html += '</div>';
        if (_tab === 'loans') html += loansTab(player, world, here);
        else if (_tab === 'bonds') html += here.length ? bondsTab(player, world) : '<div style="color:#aaa;">Royal bonds are sold through a banking house.</div>';
        else if (_tab === 'credit') html += creditTab(player, world);
        else if (_tab === 'bills') html += billsTab(player, world, here);
        else if (_tab === 'coin') html += coinTab(player, world);
        else html += accountsTab(player, world, here);
        html += '</div>';
        game.ui.showCustomPanel('🏦 Banks, Credit & Coin', html);
    },

    /** Every button on the panel: op + its arguments. */
    bankAct(game, op, a = null, b = null, c = null) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        switch (op) {
            case 'tab': _tab = a || 'accounts'; break;
            case 'deposit': res = Finance.deposit(player, world, a, b); break;
            case 'withdraw': res = Finance.withdraw(player, world, a, b); break;
            case 'borrow': res = Finance.takeLoan(player, world, a, b); break;
            case 'repay': res = Finance.repayLoan(player, world, a); break;
            case 'settle': res = Finance.settleDefault(player, world, a); break;
            case 'bond': res = Finance.buyBond(player, world, a, b, c); break;
            case 'sellBond': res = Finance.sellBond(player, world, a); break;
            case 'royalBorrow': res = Finance.royalBorrow(player, world, a); break;
            case 'royalDebase': res = Finance.royalDebase(player, world); break;
            case 'royalDefault': res = Finance.royalDefault(player, world); break;
            case 'drawBill': res = Bills.draw(player, world, a, b, c); break;
            case 'presentBill': res = Bills.present(player, world, a); break;
            case 'stopBill': res = Bills.stop(player, world, a); break;
            case 'forgeBill': res = Bills.forge(player, world, a, b); break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('🏦 Banking', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showBank(game, tile);
    },
});
