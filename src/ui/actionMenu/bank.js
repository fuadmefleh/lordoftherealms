// ActionMenu — Banks & Credit: the banking house panel (deposit and withdraw,
// loans with their terms and the credit report, bills, royal bonds, your own
// banking house, and a ruling player's crown borrowing). The realms' coin is
// the Mint's panel (mints.js); debasing is the Crown's Treasury's. Logic lives in
// systems/finance.js; this panel presents it. Buttons route through
// data-am-act → ActionMenu.bankAct.
import { ActionMenu } from './_ref.js';
import { Finance } from '../../systems/finance.js';
import { Bills } from '../../systems/bills.js';
import { Underworld } from '../../systems/underworld.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, BTN_RED, panelTabs, lede, bullets, chips, purse, sectionHead, kv, card, more, rowList, price } from './uiKit.js';
import { Mints } from '../../systems/mints.js';

// (Credit sits on the Loans tab, beside what it buys; the realms' coin is the
// Mint's panel; a ruler's crown borrowing gets a tab of its own)
const TABS = [['house', '🏛️ Your House'], ['accounts', '🏦 Accounts'], ['loans', '📜 Loans & credit'], ['bills', '✉️ Bills'], ['bonds', '👑 Royal Bonds']];
const CROWN_TAB = ['crown', '🏰 Crown debts'];

let _tab = 'accounts';

// The action menu's voice (uiKit): the palette's muted, good, warn and bad
const NOTE = 'font-size: 11px; color: #9d937c;';
const GOOD = '#8fd18a';
const WARN = '#f0b35a';
const BAD = '#e0846a';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pct(v, digits = 1) {
    return `${(v * 100).toFixed(digits)}%`;
}

function bar(value, max, color) {
    const p = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:6px; background:rgba(0,0,0,0.35); border-radius:3px; overflow:hidden; margin:3px 0 4px;"><div style="width:${p}%; height:100%; background:${color};"></div></div>`;
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

/** A house's standing: a failure or a run is in every street; its reserves are its own books, shown to its depositors and its owner (player given). */
function bankStatus(b, day, player = null) {
    const own = player && Finance.ownBank(player);
    const insider = !player || (own && own.id === b.id) || !!Finance.state(player).accounts[b.id];
    return b.status !== 'open' ? `<span style="color:${BAD};">failed</span>`
        : Finance.inPanic(b, day) ? `<span style="color:${WARN};">a run on the house</span>`
            : insider ? `reserves ${Math.round(Finance.reserveRatio(b) * 100)}%` : 'open for business';
}

/** A house's line (inline): name · seat, realm · status. */
function bankLine(world, b, day, player = null) {
    return `<b>${esc(b.name)}</b> · ${esc(b.seat)}, ${esc(kname(world, b.kingdomId))} · ${bankStatus(b, day, player)}`;
}

/** A house as a card: its name, its seat under it, its standing at the right. */
function bankCard(world, b, day, player, body = '') {
    return card(`<div style="${NOTE}">${esc(b.seat)}, ${esc(kname(world, b.kingdomId))}</div>${body}`, { icon: '🏦', title: esc(b.name), side: bankStatus(b, day, player) });
}

/** A row of buttons under a card's text. */
const btnRow = (html) => (html ? `<div style="margin-top:4px;">${html}</div>` : '');

function accountsTab(player, world, here) {
    const st = Finance.state(player);
    const day = world.day || 0;
    let html = lede('Deposits earn a slow, safe interest, compounded daily, and the house lends them on. If a house fails, its receivers pay back only part.');
    for (const b of here) {
        if (b.owner === 'player') {
            html += bankCard(world, b, day, player, `<div style="${NOTE}"><i>your own house: see 🏛️ Your House</i></div>`);
            continue;
        }
        const acct = st.accounts[b.id];
        const bal = Math.floor(acct ? acct.balance : 0);
        let body = `<div style="margin-top:4px;">Your deposit: <b style="color:#ffcf6a;">${bal}g</b>${acct ? ` · interest earned ${Math.floor(acct.interest)}g` : ''} · pays <b>${pct(Finance.depositApr(b))}</b> a year</div>`;
        let dep = '';
        for (const amt of [100, 500, 1000, 5000]) dep += act(`Deposit ${amt}g`, ['deposit', b.id, amt], BTN_GOLD, player.gold >= amt);
        let wd = '';
        for (const amt of [100, 500, 1000]) wd += act(`Withdraw ${amt}g`, ['withdraw', b.id, amt], BTN_PLAIN, bal >= amt);
        wd += act('Withdraw all', ['withdraw', b.id, null], BTN_PLAIN, bal > 0);
        body += btnRow(dep) + `<div>${wd}</div>`;
        html += bankCard(world, b, day, player, body);
    }
    const elsewhere = Object.entries(st.accounts).filter(([id]) => !here.some(b => b.id === id));
    if (elsewhere.length) {
        const rows = [];
        for (const [id, a] of elsewhere) {
            const b = Finance.bank(player, id);
            if (b) rows.push({ icon: '🏦', name: esc(b.name), desc: `${esc(b.seat)}, ${esc(kname(world, b.kingdomId))} · ${bankStatus(b, day, player)}`, side: `${Math.floor(a.balance)}g`, tone: 'gold' });
        }
        html += rowList(rows, 'Deposits elsewhere');
    }
    return html;
}

function loansTab(player, world, here) {
    const st = Finance.state(player);
    let html = creditHtml(player, world);
    if (st.loans.length) {
        html += rowList(st.loans.map(l => {
            const owed = Math.ceil(l.totalOwed);
            const over = l.overdue > 0 ? ` · <span style="color:${BAD};">${l.overdue} days overdue</span>` : '';
            const desc = `to ${esc(l.lender || 'your creditors')} · ${l.dailyPayment}g a day · ${l.remainingDays} days left${over}`;
            return {
                icon: '📜',
                name: `${owed}g owed`,
                desc,
                off: player.gold < owed,
                why: `${desc} · not enough gold to repay in full`,
                act: 'bankAct',
                args: ['repay', l.id],
                side: `Repay in full (${owed}g)`,
                tone: 'bad',
            };
        }), 'Your loans');
    } else {
        html += `<div style="${NOTE} font-size:12px;">You owe nothing.</div>`;
    }
    const bad = [];
    for (const [id, owed] of Object.entries(st.blacklist)) {
        const b = Finance.bank(player, id);
        bad.push({
            icon: '💀',
            name: `Written off as a defaulter: ${Math.ceil(owed)}g`,
            desc: `to ${esc(b ? b.name : 'the exchequer')}`,
            off: player.gold < owed,
            why: `to ${esc(b ? b.name : 'the exchequer')} · not enough gold to make it good`,
            act: 'bankAct',
            args: ['settle', id],
            side: `Make good (${Math.ceil(owed)}g)`,
            tone: 'bad',
        });
    }
    html += rowList(bad);
    const D = Finance.cfg('default');
    html += `<div style="${NOTE} margin-top:6px;">Miss a day and a late fee is added. ${D.bailiffsAt || 7} days overdue: bailiffs take goods. ${D.seizeAt || 14}: deposits, properties, ships and company funds are seized. ${D.declareAt || 30}: you are declared a defaulter (reputation, Prestige, a bounty or the debtors' prison for large debts).</div>`;
    for (const b of here) {
        html += sectionHead(`Borrow from ${esc(b.name)}`);
        html += `<div style="${NOTE}">${bankLine(world, b, world.day || 0, player)}</div>`;
        html += rowList(Finance.loanOffers(player, world, b.id).map(o => {
            const desc = `${o.amount}g for ${o.duration} days at ${pct(o.rate)} → ${o.totalOwed}g (${o.dailyPayment}g a day)`;
            return {
                icon: '💰',
                name: esc(o.name),
                desc,
                off: !o.available,
                why: o.reason ? `${desc} · ${esc(o.reason)}` : desc,
                act: 'bankAct',
                args: ['borrow', b.id, o.id],
                title: o.reason || '',
                side: `Borrow ${o.amount}g`,
                tone: 'gold',
            };
        }));
    }
    return html;
}

function billsTab(player, world, here) {
    const C = Bills.config();
    const day = world.day || 0;
    let html = lede('Robbers take a share of any gold you carry. Pay it in here and carry a <b>bill of exchange</b> instead, payable at another house\'s seat or branches.');
    html += bullets([
        'The fee rises with the distance.',
        'A stolen bill can be stopped at the paying house before a forger cashes it (a few days).',
        'A bill on a failed house falls on the house that drew it.',
    ]);
    const held = Bills.held(player);
    if (held.length) {
        html += rowList(held.map(b => {
            const payer = Bills.payer(player, b);
            const canHere = payer && here.some(x => x.id === payer.id);
            const when = day < b.payableFrom ? `payable from day ${b.payableFrom}` : day > b.validUntil ? `<span style="color:${WARN};">overdue: protest fee</span>` : `good until day ${b.validUntil}`;
            const stolen = b.status === 'stolen';
            return {
                icon: '✉️',
                name: `${b.amount}g on ${esc(b.payName)} <span style="font-weight:400; color:#9d937c;">(${esc(b.payAt)})</span>`,
                desc: `${when}${b.protested ? ` · falls on ${esc(b.fromName)}` : ''}`,
                note: stolen ? `<span style="color:${BAD};">STOLEN: a forger cashes it about day ${b.cashDay}</span>` : '',
                side: stolen ? act('Stop it', ['stopBill', b.id], BTN_RED, canHere) : act('Present', ['presentBill', b.id], BTN_GOLD, canHere && day >= b.payableFrom),
            };
        }), 'Your bills');
    }
    for (const from of here) {
        html += sectionHead(`Draw a bill at ${esc(from.name)}`);
        html += rowList(Bills.payees(player, from.id).map(to => {
            const t = Bills.terms(player, world, from.id, to.id, 1000);
            let side = '';
            for (const amt of [500, 2000, 5000]) {
                const tt = Bills.terms(player, world, from.id, to.id, amt);
                side += act(`${amt}g (+${tt.fee}g)`, ['drawBill', from.id, to.id, amt], BTN_GOLD, player.gold >= amt + tt.fee);
            }
            return {
                icon: '🏦',
                name: `On ${esc(to.name)} <span style="font-weight:400; color:#9d937c;">(${esc(to.seat)})</span>`,
                desc: `fee ${(t.rate * 100).toFixed(1)}% (min ${C.minFee}g), payable after ${t.usance} day(s)`,
                side,
            };
        }));
    }
    const g = Underworld.ensure(player).guild;
    if (g && g.member && g.rank >= C.forgery.minRank && here.length) {
        let btns = '';
        for (const amt of [500, 1500]) btns += act(`Forge ${amt}g on ${esc(here[0].name)}`, ['forgeBill', here[0].id, amt], BTN_RED);
        html += card(`<div style="${NOTE}">The guild's forger can draw a bill on a house here (${Math.round(C.forgery.fee * 100)}% up front). Clerks hold bills to the light.</div>${btnRow(btns)}`, { icon: '🗝️', title: 'The guild\'s forger', tone: 'bad' });
    }
    return html;
}

function bondsTab(player, world) {
    const st = Finance.state(player);
    const D = Finance.cfg('bonds');
    let html = lede(`Lend to a crown: interest every ${D.couponEvery || 7} days, the principal at maturity, the crown's favour (reputation) and Prestige for your House. A crown in trouble may miss payments, or repudiate its debts.`);
    if (st.bonds.length) {
        html += rowList(st.bonds.map(b => ({
            icon: '👑',
            name: `${esc(b.kingdomName || kname(world, b.kingdomId))}: ${Math.floor(b.principal)}g`,
            desc: `at ${pct(b.apr)} · matures day ${b.maturity} · ${Math.floor(b.coupons)}g paid${b.missed ? ` · <span style="color:${WARN};">${b.missed} missed</span>` : ''}`,
            act: 'bankAct',
            args: ['sellBond', b.id],
            side: 'Sell ›',
        })), 'Your bonds');
    }
    html += sectionHead('Crowns borrowing');
    const terms = D.terms || [120, 240];
    for (const o of Finance.bondOffers(player, world)) {
        const r = Finance.realmReport(world, o.kingdom);
        let btns = '';
        for (const amt of [500, 1000, 5000]) {
            for (const t of terms) btns += act(`${amt}g / ${t}d`, ['bond', o.kingdomId, amt, t], BTN_GOLD, player.gold >= amt && amt <= o.room);
        }
        const body = `<div style="${NOTE}">debt ${Math.round(r.ratio * 100)}% of capacity · coin ${Math.round(r.purity * 100)}%${r.defaults ? ` · ${r.defaults} default(s)` : ''}${o.held ? ` · you hold ${o.held}g` : ''}</div>${btnRow(btns)}`;
        html += card(body, { icon: '👑', title: `<span style="color:${o.kingdom.color || 'inherit'};">${esc(o.kingdom.name)}</span>`, side: `${pct(o.apr)} a year`, tone: 'gold' });
    }
    return html;
}

/** Your credit as the houses see it: the score and what you may borrow up front, the reckoning folded away. */
function creditHtml(player, world) {
    const rep = Finance.creditReport(player, world);
    const col = rep.collateral;
    const st = Finance.state(player);
    let body = `<div style="display:flex; align-items:baseline; gap:8px;"><span style="font-size:18px; font-weight:700; color:#ece2c8;">${rep.score}</span><span style="color:#9d937c;">${esc(rep.label)}</span></div>${bar(rep.score - 300, 550, rep.score >= 670 ? GOOD : rep.score >= 580 ? WARN : BAD)}`;
    body += `<div>Borrowing limit <b>${rep.limit}g</b> · owed ${rep.debt}g · available <b style="color:#ffcf6a;">${rep.available}g</b></div>`;
    let detail = sectionHead('What the houses see');
    for (const p of rep.parts) detail += kv(esc(p.label), `<span style="color:${p.value >= 0 ? GOOD : BAD};">${p.value >= 0 ? '+' : ''}${p.value}</span>`);
    detail += sectionHead('Collateral');
    detail += kv('Properties', `${Math.round(col.properties)}g`) + kv('Ships', `${Math.round(col.ships)}g`) + kv('Company', `${Math.round(col.company)}g`)
        + kv('Holdings', `${Math.round(col.holdings)}g`) + kv('Deposits', `${col.deposits}g`) + kv('<b>Total</b>', `<b style="color:#ffcf6a;">${col.total}g</b>`);
    detail += `<div style="${NOTE} margin-top:6px;">Loans repaid ${st.credit.repaid} · payments missed ${st.credit.missed} · defaults ${st.credit.defaults}${st.credit.settled ? ` · debts made good ${st.credit.settled}` : ''}</div>`;
    body += more('Why this score: the reckoning and your collateral', detail);
    return card(body, { icon: '📊', title: 'Your credit' });
}

/** A ruling player's crown as a borrower: its purse, loans from the houses, repudiation. */
function crownTab(player, world) {
    const ruled = Finance.ruledKingdom(player, world);
    if (!ruled) return lede('Only a ruler borrows for a crown.');
    const r = Finance.realmReport(world, ruled);
    let html = lede(`The crown of ${esc(ruled.name)} borrows from the banking houses at the crown's rate. Its taxes and coin are run from the Crown's Treasury.`);
    html += chips([
        { icon: '💰', label: 'Treasury', value: `${Math.floor(ruled.treasury || 0)}g`, cls: 'gold' },
        ['📈', 'Income', `≈${r.income}g a day`],
        ['📜', 'Debt', `${r.debt}g (${Math.round(r.ratio * 100)}% of capacity)`],
    ]);
    const rows = [5000, 20000].map(amt => ({ icon: '🏦', name: `Borrow ${amt}g for the crown`, desc: 'From the banking houses, at the crown\'s rate', act: 'bankAct', args: ['royalBorrow', amt], side: `+${amt}g`, tone: 'gold' }));
    // (debasement lives with the coin on the Treasury; here only while the mints are off)
    if (!Mints.enabled()) rows.push({ icon: '⚖️', name: 'Debase the coin', desc: 'Gold for the mint now; prices rise and stability falls', off: !(r.purity > 0.55), why: 'The coin is already too base to clip further', act: 'bankAct', args: ['royalDebase'], tone: 'bad', side: '›' });
    rows.push({ icon: '⚠️', name: 'Repudiate the debts', desc: 'The lenders lose; your realm loses stability and credit', off: !(r.debt > 0), why: 'The crown owes nothing', act: 'bankAct', args: ['royalDefault'], tone: 'bad', side: '›' });
    rows.push({ icon: '🧾', name: 'The Crown\'s Treasury', desc: 'Taxes, the army\'s pay, the court and the coin', act: 'bankAct', args: ['treasury'], side: '›' });
    return html + rowList(rows);
}

function money(v) {
    return `${Math.round(v).toLocaleString()}g`;
}

function signed(v) {
    const r = Math.round(v);
    return `<span style="color:${r >= 0 ? GOOD : BAD};">${r >= 0 ? '+' : '−'}${Math.abs(r).toLocaleString()}g</span>`;
}

function charterHtml(player, world) {
    const terms = Finance.charterTerms(player, world);
    let html = lede('Charter a banking house of your own: the townsfolk bring you their savings and you pay them interest.');
    html += bullets([
        'Lend the coin on to merchants (and, if you like, to crowns) at a better rate, and keep the difference.',
        'Lend too much and a panic can empty the vault.',
        'A house that cannot pay its depositors fails, and your stake goes with it.',
    ]);
    if (!terms.ok) return html + `<div class="pk-row-why" style="font-size:12px;">${esc(terms.reason)}</div>`;
    html += lede(`<b>A charter from ${esc(terms.kingdom)}</b> for a house seated in <b>${esc(terms.seat)}</b>: a fee of <b>${money(terms.fee)}</b> to the crown, and capital paid into the vault (at least ${money(terms.minCapital)}).`);
    html += rowList(terms.capitalOptions.map(cap => {
        const total = cap + terms.fee;
        const ok = player.gold >= total;
        return {
            icon: '🏛️',
            name: `Charter with ${money(cap)} capital`,
            desc: `${money(cap)} into the vault and ${money(terms.fee)} to the crown`,
            off: !ok,
            why: `You need ${money(total)}`,
            act: 'bankAct',
            args: ['foundBank', cap],
            side: price(total, ok),
        };
    }), 'Found the house');
    return html;
}

function houseTab(player, world) {
    const book = Finance.ownBook(player, world);
    if (!book) return charterHtml(player, world);
    const b = book.bank;
    const policies = Finance.cfg('playerBank').policies || {};
    const ratioPct = Math.round(book.ratio * 100);
    const ratioColor = book.ratio >= 1.2 ? GOOD : book.ratio >= 0.6 ? WARN : BAD;
    let html = lede(`<b>${esc(b.name)}</b> · ${esc(b.seat)}, ${esc(kname(world, b.kingdomId))}${book.panic ? ` · <span style="color:${BAD};">a run on the house!</span>` : ''}`);
    html += chips([
        { icon: '💰', label: 'Equity (your stake)', value: money(book.equity), cls: 'gold' },
        ['🏦', 'Vault', `${money(book.vault)} <span style="font-weight:400; color:${ratioColor};">(${ratioPct}%)</span>`],
        ['👥', 'Deposits', money(book.deposits)],
        ['📜', 'Lent', money(book.loanBook)],
    ]);
    let body = kv('Equity (your stake)', `${money(book.equity)} <span style="${NOTE}">· paid in ${money(book.paidIn)} · drawn so far ${money(book.drawn)}</span>`);
    body += kv('Vault', `${money(book.vault)} <span style="${NOTE}">against a reserve of ${money(book.need)}</span> (<span style="color:${ratioColor};">${ratioPct}%</span>)`);
    body += bar(book.vault, Math.max(book.need * 2, 1), ratioColor);
    body += kv('Townsfolk\'s deposits', `${money(book.deposits)} <span style="${NOTE}">at ${pct(book.depositApr)} a year · trust ${Math.round(book.trust * 100)}% (${esc(b.seat)}, ${Math.round(book.seatPopulation).toLocaleString()} souls)</span>`);
    body += kv('Lent to merchants', `${money(book.loanBook)} <span style="${NOTE}">at ${pct(book.policyDef.apr || 0)}</span>${book.crownLoans ? ` · owed by crowns <b>${money(book.crownLoans)}</b>` : ''}`);
    html += card(body);

    html += sectionHead('📒 The last 30 days');
    html += kv('Interest from merchants', signed(book.interest30)) + kv('Interest paid to depositors', signed(-book.paidOut30))
        + kv('Bad debts', signed(-book.losses30)) + kv('Clerks and strongroom', signed(-book.costs30))
        + kv('<b>Profit</b>', `<b>${signed(book.profit30)}</b>`) + kv('Since the charter', signed(book.profitAll));
    html += `<div style="${NOTE} margin-top:2px;">What the crowns repay goes straight into the vault.</div>`;

    html += rowList(Object.entries(policies).map(([id, p]) => {
        const on = book.policy === id;
        return {
            icon: on ? '✅' : '⚖️',
            name: `${esc(p.label || id)}${on ? ' <span style="font-weight:400; font-style:italic; color:#9d937c;">· current</span>' : ''}`,
            desc: `lends ${Math.round((p.lend || 0) * 100)}% of its coin at ${pct(p.apr || 0)}${p.crowns ? ', crowns too' : ', no crowns'}`,
            note: p.text ? `<span style="color:#b9ae94;">${esc(p.text)}</span>` : '',
            act: on ? null : 'bankAct',
            args: ['bankPolicy', id],
            title: on ? '' : `Adopt ${p.label || id}`,
            side: on ? 'current' : `Adopt ${esc(p.label || id)}`,
            tone: on ? 'good' : 'gold',
        };
    }), '⚖️ Lending policy');

    html += sectionHead('🔑 The owner\'s desk');
    if (!book.atSeat) {
        html += `<div class="pk-row-why" style="font-size:11px;">Coin goes in and out of the strongroom in ${esc(b.seat)}: travel there to put money in, draw it out, or wind the house up. The policy can be changed by letter from anywhere.</div>`;
        return html;
    }
    let put = '';
    for (const amt of [1000, 5000, 20000]) put += act(`Put in ${money(amt)}`, ['bankPutIn', amt], BTN_GOLD, player.gold >= amt);
    let draw = '';
    for (const amt of [1000, 5000]) draw += act(`Draw ${money(amt)}`, ['bankDraw', amt], BTN_PLAIN, book.drawable >= amt && !book.panic);
    draw += act(`Draw all spare (${money(book.drawable)})`, ['bankDraw', null], BTN_PLAIN, book.drawable > 0 && !book.panic, 'Everything above the reserve the depositors need');
    html += card(`<div>${put}</div><div>${draw}</div>`, { icon: '🔑', title: 'The strongroom' });
    html += rowList([{
        icon: '⚠️',
        name: 'Wind up the house',
        desc: 'Pay off the depositors, call in the loans at a loss, sell the crowns\' debts, and take what is left',
        off: !!book.panic,
        why: 'Not while there is a run on the house',
        act: 'bankAct',
        args: ['bankWindUp'],
        tone: 'bad',
        side: '›',
    }]);
    return html;
}

Object.assign(ActionMenu, {
    /** The banking house panel (from a town with a house or branch, the Counsel, or anywhere). */
    showBank(game, tile = null, tab = null) {
        if (tab) _tab = tab;
        const player = game.player;
        const world = game.world;
        // Old tab keys: the credit report is on Loans; the realms' coin is the Mint's
        if (_tab === 'credit') _tab = 'loans';
        if (_tab === 'coin') { _tab = 'accounts'; ActionMenu.showMint(game, tile); return; }
        const ruler = !!Finance.ruledKingdom(player, world);
        if (_tab === 'crown' && !ruler) _tab = 'accounts';
        const t = tile || world.getTile(player.q, player.r);
        const here = Finance.banksAt(player, world, t);
        const s = Finance.summary(player, world);
        let html = '<div style="font-size:12px;">';
        html += chips([
            purse(player.gold),
            ['📈', 'Credit', `${s.score} <span style="font-weight:400; color:#9d937c;">(${esc(s.label)})</span>`],
            ['🏦', 'Deposits', `${s.deposits}g`],
            ['📜', 'Owed', s.debt ? `${s.debt}g · ${s.dailyDue}g/day` : '0g'],
            ['👑', 'Bonds', `${s.bonds}g`],
        ]);
        if (!here.length && _tab !== 'house') {
            const open = Finance.openBanks(player);
            html += `<div class="pk-row-why" style="font-size:11px; margin-bottom:6px;">No banking house serves this place: deposits, loans and bonds are arranged at ${open.length ? open.map(b => `${esc(b.name)} (${esc(b.seat)})`).join(', ') : 'a house in a great city'} or its branches in their realm's cities. You can still repay a loan from here.</div>`;
        }
        html += panelTabs(game, {
            id: 'bank', title: '🏦 Banks & Credit', tabs: ruler ? [...TABS, CROWN_TAB] : TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showBank(game, t); },
            attrsFor: (k) => `data-am-act="bankAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (_tab === 'house') html += houseTab(player, world);
        else if (_tab === 'loans') html += loansTab(player, world, here);
        else if (_tab === 'bonds') html += here.length ? bondsTab(player, world) : lede('Royal bonds are sold through a banking house.');
        else if (_tab === 'bills') html += billsTab(player, world, here);
        else if (_tab === 'crown') html += crownTab(player, world);
        else html += accountsTab(player, world, here);
        html += '</div>';
        game.ui.showCustomPanel('🏦 Banks & Credit', html);
    },

    /** Every button on the panel: op + its arguments. */
    bankAct(game, op, a = null, b = null, c = null) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        switch (op) {
            case 'tab': _tab = a || 'accounts'; break;
            case 'treasury': ActionMenu.showTreasury(game, 'crown'); return;
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
            case 'foundBank': res = Finance.foundBank(player, world, a); break;
            case 'bankPolicy': res = Finance.setBankPolicy(player, a); break;
            case 'bankPutIn': res = Finance.injectCapital(player, world, a); break;
            case 'bankDraw': res = Finance.drawFromBank(player, world, a); break;
            case 'bankWindUp': res = Finance.windUpBank(player, world); break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('🏦 Banking', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showBank(game, tile);
    },
});
