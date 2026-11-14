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
import { RealmArms } from '../../world/realmArms.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, panelTabs, intelBadge, closedBooks, lede, bullets, chips, purse, sectionHead, card, rowList } from './uiKit.js';
import { RealmIntel } from '../../systems/realmIntel.js';
import { Mints } from '../../systems/mints.js';
import { Finance } from '../../systems/finance.js';
import { MoneySupply } from '../../world/moneySupply.js';
import { Coinage } from '../../world/coinage.js';
import { Causes } from '../../player/causes.js';
import { whyIcon, stabilityWhy } from '../whyPopover.js';
import { LINE_LABEL, lineTip, crownTaxGuide, taxControlNote, taxTip, levelEffectText, armyLevelText, courtLevelText } from './taxGuide.js';
import { Names } from '../../core/names.js';

// The action menu's voice (uiKit): muted notes, quiet tables — a head in the
// section-head style and hairline gold row rules
const NOTE = 'font-size: 11px; color: #9d937c;';
const TH = 'text-align:left; padding:3px 6px; font-size:10px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:#9d937c; border-bottom:1px solid rgba(245,197,66,0.14);';
const TD = 'padding:3px 6px; border-bottom:1px solid rgba(245,197,66,0.07);';
const GOOD = '#8fd18a';
const BAD = '#e0846a';
const WARN = '#f0b35a';
const TABS = [['budget', '📒 Budget'], ['realms', '🏰 Realms'], ['farms', '📜 Tax farms'], ['crown', '👑 Your crown']];
const LABEL = LINE_LABEL;

// (the household guards the crown keeps for its lords and itself: player/realmEscort.js)
LABEL.guard = 'Household guards';

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
    const color = v[v.length - 1] >= v[0] ? GOOD : BAD;
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
        const c = sign > 0 ? GOOD : BAD;
        const tip = lineTip(l);
        return `<tr${tip ? ` title="${esc(tip)}"` : ''}><td style="${TD}">${esc(LABEL[l] || l)}</td><td style="${TD} color:${c};">${sign > 0 ? '+' : '−'}${g0(Math.abs(d))}g</td><td style="${TD} color:${c};">${sign > 0 ? '+' : '−'}${g0(Math.abs(w))}g</td></tr>`;
    };
    html += `<tr><td colspan="3" style="${TD} padding-top:8px; font-size:10.5px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:#ffcf6a;">Revenue</td></tr>`;
    for (const l of CrownBooks.REVENUE_LINES) html += row(l, 1);
    html += `<tr><td style="${TD} font-weight:600; color:#ece2c8;">Total revenue</td><td style="${TD} font-weight:600; color:#ece2c8;">${g0(CrownBooks.revenue(b.last))}g</td><td style="${TD} font-weight:600; color:#ece2c8;">${g0(CrownBooks.revenue(b.week))}g</td></tr>`;
    html += `<tr><td colspan="3" style="${TD} padding-top:8px; font-size:10.5px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:${BAD};">Spending</td></tr>`;
    for (const l of CrownBooks.EXPENSE_LINES) html += row(l, -1);
    html += `<tr><td style="${TD} font-weight:600; color:#ece2c8;">Total spending</td><td style="${TD} font-weight:600; color:#ece2c8;">${g0(CrownBooks.expense(b.last))}g</td><td style="${TD} font-weight:600; color:#ece2c8;">${g0(CrownBooks.expense(b.week))}g</td></tr>`;
    for (const l of ['loans', 'debase', 'other']) {
        const d = b.last[l] || 0, w = b.week[l] || 0;
        if (Math.abs(d) < 0.5 && Math.abs(w) < 0.5) continue;
        const tip = lineTip(l);
        html += `<tr${tip ? ` title="${esc(tip)}"` : ''}><td style="${TD} ${NOTE}">${esc(LABEL[l])}</td><td style="${TD} ${NOTE}">${d >= 0 ? '+' : '−'}${g0(Math.abs(d))}g</td><td style="${TD} ${NOTE}">${w >= 0 ? '+' : '−'}${g0(Math.abs(w))}g</td></tr>`;
    }
    return html + '</table>';
}

/** What the street knows of a realm's purse: the posted taxes, the rumour of its chests, the troubles anyone can see. */
function publicBudget(game, k, b) {
    const { player } = game;
    const knows = typeof player.knowsAbout !== 'function' || player.knowsAbout(k.id, 'economy');
    let body = `<div style="${NOTE}">Posted taxes: land ${lvl(b.rates.land)} · hearth ${lvl(b.rates.poll)} · excise ${lvl(b.rates.excise)}</div>`;
    const seen = [b.arrearsDays > 0 ? 'soldiers grumbling of unpaid wages' : '', b.farms.length ? `tax farmers collecting in ${b.farms.map(f => esc(f.town)).join(', ')}` : ''].filter(Boolean);
    if (seen.length) body += `<div style="${NOTE}">In the streets: ${seen.join(' · ')}.</div>`;
    const html = card(body, { icon: '🏰', title: esc(k.name), side: knows ? `the talk is of <b>${esc(RealmIntel.band('treasury', b.treasury))}</b>` : '' });
    return html + closedBooks();
}

function budgetTab(game) {
    const { world, player } = game;
    const { k } = realmFor(game);
    if (!k) return `<div style="${NOTE}">Stand in a town of a realm to read its books, or rule one.</div>`;
    const b = Fiscal.budget(world, k);
    let html = lede('The crown\'s taxes come out of its towns\' purses, and its wages and upkeep go back into them: the treasury is what is left. Unpaid soldiers desert after a week; unpaid clerks help themselves.');
    // What every tax, level and line is (the posted rates are public: the guide shows them to anyone)
    html += crownTaxGuide(b);
    // The books themselves are for the ruler, the realm's officers and your spies (systems/realmIntel.js)
    const why = RealmIntel.whyLabel(player, world, k, 'books');
    if (!why) return html + publicBudget(game, k, b);
    html += sectionHead(`The books of ${esc(Names.realm(k.name))}`);
    html += chips([
        { icon: '💰', label: 'Treasury', value: `${g0(b.treasury)}g`, cls: 'gold' },
        sparkline(b.hist) || null,
        ['⏳', 'In hand', `${b.reserveDays} days of spending`],
        intelBadge(why) || null,
    ]);
    html += `<div class="pk-card"><span style="${NOTE}">Taxes: land ${lvl(b.rates.land)} · hearth ${lvl(b.rates.poll)} · excise ${lvl(b.rates.excise)} · army ${esc((Fiscal.config().army.levels[b.armyPay] || {}).label || b.armyPay)} · court ${esc((Fiscal.config().court.levels[b.courtLevel] || {}).label || b.courtLevel)}</span><br>`;
    html += `<span style="${NOTE}">The people's burden ${Math.round((b.burden || 0) * 100)}% (15% is the customary due) · stability ${b.stability >= 0 ? '+' : ''}${b.stability} from taxes and pay${whyIcon(stabilityWhy(Causes.stability(k, world)), 'The realm’s stability: why?')} · corruption ${Math.round(b.corruption * 100)}% · crown estates ${Math.round(b.demesne * 100)}% of the land's gold`;
    if (b.arrearsDays > 0) html += ` · <span style="color:${BAD};">soldiers unpaid ${b.arrearsDays} days (${g0(b.arrears.army)}g owed), the army at ${Math.round(b.armyFactor * 100)}%</span>`;
    if (b.deficitWeeks > 0) html += ` · <span style="color:${WARN};">${b.deficitWeeks} week(s) in deficit</span>`;
    // The armoury (world/realmArms.js): how well the army is armed, and what it lacks
    const arm = RealmArms.summary(k);
    if (arm) {
        const short = Object.entries(arm.deficits).filter(([, n]) => n > 0).map(([slot, n]) => `${n} ${{ main: 'weapons', ranged: 'bows', off: 'shields', head: 'helms', body: 'harness', ammo: 'arrows' }[slot] || slot}`);
        html += `<br><span style="color:#cbbf9f;">⚔️ The army fights at <b>${Math.round(arm.factor * 100)}%</b> of its worth by its arms${short.length ? ` · short of ${esc(short.join(', '))}` : ' · fully armed'} · ${g0(arm.stats.spent)}g spent on arms in all</span>`;
    }
    html += '</span></div>';
    html += sectionHead('Revenue and spending') + linesTable(b);
    const S = b.stats || {};
    const tally = [['revenue', 'taxes and dues taken', 'g'], ['expense', 'spent', 'g'], ['revolts', 'tax revolts', ''], ['farmsSold', 'tax farms sold', ''],
        ['officesSold', 'offices sold', ''], ['landSold', 'crown estates sold', ''], ['deserted', 'soldiers deserted', '']]
        .filter(([key]) => (S[key] || 0) > 0).map(([key, label, unit]) => `${g0(S[key])}${unit} ${label}`);
    if (tally.length) html += `<div style="${NOTE} margin-top:6px;">The crown's books, all told: ${tally.join(' · ')}.</div>`;
    if (b.farms.length) html += `<div style="${NOTE} margin-top:6px;">Farmed out: ${b.farms.map(f => `${esc(f.town)} (${esc(f.holderName)}, to day ${f.until})`).join(' · ')}</div>`;
    return html;
}

function realmsTab(game) {
    const { player, world } = game;
    const rows = Fiscal.realmTable(world);
    let html = lede('Every realm’s posted taxes, and its chests as far as you can know them: the figures for a realm whose books are open to you (🔓), the talk of the street for the rest.');
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:6px;"><tr><th style="${TH}">Realm</th><th style="${TH}">Treasury</th><th style="${TH}">Year</th><th style="${TH}">Week: in · out</th><th style="${TH}" title="The posted level of the land, hearth and excise taxes (the 📒 Budget tab explains each)">Taxes</th><th style="${TH}">Troubles</th></tr>`;
    for (const r of rows) {
        const why = RealmIntel.whyLabel(player, world, r.id, 'books');
        const knows = typeof player.knowsAbout !== 'function' || player.knowsAbout(r.id, 'economy');
        if (why) {
            const trouble = [r.arrearsDays > 0 ? `army unpaid ${r.arrearsDays}d` : '', r.corruption >= 0.1 ? `corrupt ${Math.round(r.corruption * 100)}%` : '', r.farms ? `${r.farms} farmed` : ''].filter(Boolean).join(' · ');
            html += `<tr><td style="${TD}">${esc(r.name)} ${intelBadge(why)}</td><td style="${TD}">${g0(r.treasury)}g</td><td style="${TD}">${sparkline(r.hist, 1, 90, 20)}</td>`
                + `<td style="${TD}"><span style="color:${GOOD};">${g0(r.rev)}</span> · <span style="color:${BAD};">${g0(r.exp)}</span></td><td style="${TD}">${lvl(r.level)}</td><td style="${TD} ${NOTE}">${esc(trouble) || '—'}</td></tr>`;
        } else {
            const trouble = [r.arrearsDays > 0 ? 'army grumbling unpaid' : '', r.farms ? `${r.farms} farmed` : ''].filter(Boolean).join(' · ');
            html += `<tr><td style="${TD}">${esc(r.name)}</td><td style="${TD} ${NOTE}">${knows ? esc(RealmIntel.band('treasury', r.treasury)) : '🔒 unknown'}</td><td style="${TD} ${NOTE}">—</td>`
                + `<td style="${TD} ${NOTE}">—</td><td style="${TD}">${lvl(r.level)}</td><td style="${TD} ${NOTE}">${esc(trouble) || '—'}</td></tr>`;
        }
    }
    return html + '</table>';
}

function farmsTab(game) {
    const { player, world } = game;
    const { here, ruled } = realmFor(game);
    const F = Fiscal.config().farms;
    let html = lede(`A crown short of money sells the taxes of a town for ${F.term} days to the highest bidder, who collects them in its place.`);
    html += bullets([
        'Collect gently and you barely clear your stake.',
        'Press hard and you grow rich, hated, and may be driven out by a tax revolt.',
        'The new masters of a conquered town do not honour your farm.',
    ]);
    const lots = here ? Fiscal.lots(world, here.id) : [];
    html += sectionHead(`Taxes at auction${here ? ` in ${esc(here.name)}` : ''}`);
    if (!here) html += `<div style="${NOTE}">Stand in a town of a realm to bid for its taxes.</div>`;
    else if (!lots.length) html += `<div style="${NOTE}">The crown of ${esc(here.name)} sells no taxes now.</div>`;
    for (const lot of lots) {
        const min = Fiscal.minBid(lot);
        const own = ruled && ruled.id === lot.kid;
        let body = `<div style="${NOTE}">Reckoned at ${g0(lot.est)}g over ${F.term} days · ${lot.bank ? `${esc(lot.bank.name)} bids ${g0(lot.bank.bid)}g` : 'No house has bid'}${lot.player ? ` · your bid ${g0(lot.player.bid)}g (${esc(lot.player.squeeze)})` : ''} · least bid ${g0(min)}g</div>`;
        if (!own) {
            body += '<div style="margin-top:4px;">';
            for (const sq of Object.keys(F.squeeze || {})) body += act(`Bid ${g0(min)}g · ${esc(F.squeeze[sq].label)}`, ['bid', lot.id, sq], BTN_GOLD, player.gold >= min - (lot.player ? lot.player.bid : 0), esc(F.squeeze[sq].blurb || ''));
            body += '</div>';
        }
        html += card(body, { icon: '📜', title: esc(lot.town), side: `closes day ${lot.closes}` });
    }
    const mine = Fiscal.playerFarms(world);
    html += sectionHead('Your tax farms');
    if (!mine.length) html += `<div style="${NOTE}">You farm no taxes.</div>`;
    for (const f of mine) {
        let body = `<div style="${NOTE}">Paid ${g0(f.paid)}g · collected ${g0(f.collected)}g (collectors ${g0(f.cost)}g) · to day ${f.until} · ${esc((F.squeeze[f.squeezeId] || {}).label || f.squeezeId)}</div><div style="margin-top:4px;">`;
        for (const sq of Object.keys(F.squeeze || {})) body += act(esc(F.squeeze[sq].label), ['squeeze', f.id, sq], sq === f.squeezeId ? BTN_GOLD : BTN_PLAIN, sq !== f.squeezeId);
        html += card(body + '</div>', { icon: '🌾', title: `${esc(f.town)} <span style="${NOTE}">(${esc(f.kingdom)})</span>` });
    }
    return html;
}

/**
 * The realm's coin, for its ruler: what the mint strikes, what is in hand, the
 * clipping, the prices and the people's trust; debase, recoin, and whether the
 * treasurers may do either (systems/mints.js, systems/finance.js).
 */
function coinSection(game, ruled) {
    const { world, player } = game;
    if (!Mints.enabled()) return '';
    const fn = MoneySupply.fineness(world, ruled);
    const R = MoneySupply.realm(world, ruled.id);
    const trust = R ? Math.round(R.trust != null ? R.trust : 100) : Coinage.trust(ruled, world.day, world);
    const pct = Math.round((Coinage.purityFactor(ruled, world) - 1) * 100);
    const full = Math.round((Coinage.purityFactor(ruled) - 1) * 100);
    let html = sectionHead('The coin');
    html += chips([
        ['🏛️', 'Mint strikes', `${Math.round(fn.standard * 100)}%`],
        ['💰', 'In hand', `${Math.round(fn.circulating * 100)}%`],
        ['✂️', 'Clipped', `${Math.round(fn.clip * 100)}%`],
        { icon: '📈', label: 'Prices', value: `<span style="color:${pct > 0 ? BAD : GOOD};">${pct > 0 ? '+' : ''}${pct}%</span>` },
        { icon: '🤝', label: 'Trust', value: `<span style="color:${trust < 60 ? BAD : trust < 85 ? WARN : GOOD};">${trust}</span>` },
    ]);
    const notes = [];
    if (fn.lag > 0.005) notes.push(`The old, finer coin is still coming in to be restruck: prices will rise toward +${full}% as it does, and your chests gain the extra pieces.`);
    if (fn.lag < -0.005) notes.push('The new, finer coin is still mixing in: prices ease as it does.');
    if (fn.clip > 0.005) notes.push(`Clippers have shaved ${Math.round(fn.clip * 100)}% off the pieces; past ${Math.round(MoneySupply.config().clip.tolerance * 100)}% it shows in the prices. Only a recoinage ends it.`);
    if (R && R.restruck > 0) notes.push(`Restriking has brought the crown ${g0(R.restruck)}g in all.`);
    html += `<div style="${NOTE} margin-bottom:4px;">${notes.length ? notes.join(' ') : 'Full weight, sound coin: the people trust it, and the changers at your borders take little.'}</div>`;
    const G = Finance.cfg('coinage');
    const step = Number(G.debaseStep) || 0.1, floor = Number(G.floor) || 0.5;
    const canDebase = fn.standard - step >= floor - 1e-9;
    const q = Mints.recoinQuote(world, ruled);
    const leave = Mints.treasurersCoin(player, world);
    html += rowList([
        { icon: '⚖️', name: `Debase to ${Math.round((fn.standard - step) * 100)}% silver`, desc: 'Gold now from your own chests and the first coin brought in, more each week as the rest is restruck; prices rise as it spreads, trust and stability fall', off: !canDebase, why: 'The coin is as base as it can be made', act: 'treasuryAct', args: ['coin', 'debase'], tone: 'bad', side: canDebase ? 'Debase ›' : '' },
        { icon: '🔨', name: 'Proclaim a recoinage', desc: q.ok ? `Call in ${g0(q.called)}g of town coin and strike it anew at full weight: the crown makes up the silver (${g0(q.cost)}g), the towns hold less coin and prices ease` : 'Call in the coin and strike it anew at full weight', off: !q.ok || (Number(ruled.treasury) || 0) < q.cost, why: q.ok ? `The treasury needs ${g0(q.cost)}g` : q.reason, act: 'treasuryAct', args: ['coin', 'recoin'], side: q.ok ? `${g0(q.cost)}g ›` : '' },
        { icon: '📒', name: leave ? 'Forbid the treasurers the coin' : 'Leave the coin to the treasurers', desc: leave ? 'They may now debase when the chests run dry and recoin when they are full again' : 'As it is, only you debase or recoin; allow it and they will in a crisis and once it passes', act: 'treasuryAct', args: ['coin', 'leave', leave ? 0 : 1], side: leave ? 'Forbid ›' : 'Allow ›' },
    ]);
    // The mint's charge (moved here from the Mint's old "Your coin" tab: one place for a ruler's coin)
    const rec = MoneySupply.ensureRealm(world, ruled);
    const P = Mints.config().mint.policies || {};
    html += rowList(Object.entries(P).map(([id, p]) => {
        const on = rec.mint.policy === id;
        return {
            icon: on ? '✅' : '⚖️', name: `Seigniorage: ${esc(p.label)}`,
            desc: `the mint keeps ${Math.round((p.seigniorage || 0) * 100)}% of each piece · draws ×${p.draw} the bullion (a greedy mint sends sellers elsewhere)`,
            act: on ? null : 'treasuryAct', args: ['coin', 'policy', id], side: on ? 'current' : 'Set ›', tone: on ? 'gold' : '',
        };
    }));
    return html;
}

function crownTab(game) {
    const { world, player } = game;
    const { ruled } = realmFor(game);
    if (!ruled) return `<div style="${NOTE}">Only a ruler sets the taxes.</div>`;
    const b = Fiscal.budget(world, ruled);
    const C = Fiscal.config();
    let html = lede('Set each tax, the army\'s pay and the court. Heavy taxes fill the chests and drive the poor to lighter realms; light ones starve the army.');
    html += chips([
        ['⚖️', 'Burden', `${Math.round((b.burden || 0) * 100)}%`],
        ['🏛️', 'Stability', `${b.stability >= 0 ? '+' : ''}${b.stability}`],
        { icon: '💰', label: 'Last week', value: `<span style="color:${GOOD};">+${g0(CrownBooks.revenue(b.week))}g</span> / <span style="color:${BAD};">−${g0(CrownBooks.expense(b.week))}g</span>` },
        ['⏳', 'In hand', `${b.reserveDays} days`],
    ]);
    html += `<div style="${NOTE} margin-bottom:8px;">The <b>burden</b> is what the people feel (welfare, migration, tax revolts); <b>stability</b> is the realm's.</div>`;
    const tipOf = (blurb, fx) => [blurb, fx].filter(Boolean).join(' ');
    html += sectionHead('Taxes, pay and court');
    // Levers the ruler has not set are kept by the treasurers' review (Fiscal._review)
    const held = Fiscal.held(player, world);
    const keeper = (on, args, what) => on
        ? ` ${act('📒 Leave to the treasurers', args, BTN_PLAIN, true, `You set the ${what} yourself. Hand it back and the treasurers raise or lower it with the chests every few weeks.`)}`
        : ` <span style="${NOTE}" title="Set it yourself and they leave it to you.">· kept by your treasurers</span>`;
    html += `<div style="${NOTE} margin-bottom:4px;">Taxes${keeper(held.tax, ['rate', 'all', 'auto'], 'taxes')}</div>`;
    for (const tax of ['land', 'poll', 'excise']) {
        html += `<div class="pk-card"><b title="${esc(taxTip(tax))}" style="cursor:help; color:#ffe9a8;">${esc(LABEL[tax])}</b> <span style="${NOTE}">now ${lvl(b.rates[tax])} · ${esc(levelEffectText(tax, b.rates[tax]))}</span>${taxControlNote(tax)}`;
        html += '<div>';
        for (const id of CrownBooks.LEVELS) html += act(lvl(id), ['rate', tax, id], b.rates[tax] === id ? BTN_GOLD : BTN_PLAIN, b.rates[tax] !== id, tipOf((C.levels[id] || {}).blurb, levelEffectText(tax, id)));
        html += '</div></div>';
    }
    html += `<div class="pk-card"><b style="color:#ffe9a8;">Army pay</b> <span style="${NOTE}">now ${esc((C.army.levels[b.armyPay] || {}).label || b.armyPay)} · ${esc(armyLevelText(b.armyPay))}</span>${keeper(held.army, ['army', 'auto'], "army's pay")}<br>`;
    for (const [id, L] of Object.entries(C.army.levels)) html += act(esc(L.label), ['army', id], b.armyPay === id ? BTN_GOLD : BTN_PLAIN, b.armyPay !== id, tipOf(L.blurb, armyLevelText(id)));
    html += `</div><div class="pk-card"><b style="color:#ffe9a8;">Court</b> <span style="${NOTE}">now ${esc((C.court.levels[b.courtLevel] || {}).label || b.courtLevel)} · ${esc(courtLevelText(b.courtLevel))}</span>${keeper(held.court, ['court', 'auto'], 'court')}<br>`;
    for (const [id, L] of Object.entries(C.court.levels)) html += act(esc(L.label), ['court', id], b.courtLevel === id ? BTN_GOLD : BTN_PLAIN, b.courtLevel !== id, tipOf(L.blurb, courtLevelText(id)));
    html += '</div>';
    html += crownTaxGuide(b);
    html += sectionHead('Raise money');
    const landLeft = b.demesne > (C.demesne.min || 0.05) + 1e-9;
    html += rowList([
        { icon: '📜', name: 'Sell offices', desc: 'Gold now, corruption for years', act: 'treasuryAct', args: ['sale', 'offices'], tone: 'bad', side: 'Sell ›' },
        { icon: '🌾', name: 'Sell crown land', desc: 'Gold now, the crown\'s rents less for ever', why: 'The crown has no estates left to sell', off: !landLeft, act: 'treasuryAct', args: ['sale', 'land'], tone: 'bad', side: landLeft ? 'Sell ›' : '' },
        { icon: '🏦', name: 'Borrow for the crown', desc: 'From the banking houses at the crown\'s rate, or repudiate its debts', act: 'treasuryAct', args: ['bank'], side: '›' },
    ]);
    html += coinSection(game, ruled);
    html += sectionHead('Farm out a town\'s taxes');
    html += `<div style="${NOTE} margin-bottom:4px;">A house pays a lump now and collects the town's taxes (harder than your own men) for ${C.farms.term} days.</div>`;
    const towns = (world.getSettlementViews ? world.getSettlementViews() : []).filter(s => s && s.kingdom === ruled.id && !(ruled.capital && ruled.capital.q === s.q && ruled.capital.r === s.r));
    const open = Fiscal.lots(world, ruled.id).length > 0;
    html += rowList(towns.slice(0, 12).map(s => {
        const tile = world.getTile(s.q, s.r);
        const farmed = tile && tile.settlement && tile.settlement.taxFarm;
        return {
            icon: '🏘️',
            name: `${esc(s.name)}${farmed ? ' (farmed)' : ''}`,
            desc: 'Put its taxes up for auction',
            off: !!(open || farmed),
            why: farmed ? 'Its taxes are already farmed out' : 'An auction is already open in your realm',
            act: 'treasuryAct',
            args: ['farmOut', `${s.q},${s.r}`],
            side: farmed || open ? '' : 'Auction ›',
        };
    }));
    return html;
}

Object.assign(ActionMenu, {
    /** The Crown's Treasury: budgets, every realm's purse, tax farms, a ruler's taxes. */
    showTreasury(game, tab = null) {
        if (tab) _tab = tab;
        const { player } = game;
        if (!Fiscal.enabled()) {
            game.ui.showCustomPanel('🧾 The Treasury', lede('The crowns keep no books.'));
            return;
        }
        let html = '<div style="font-size:12px;">';
        html += chips([purse(player.gold)]);
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
            case 'bank': ActionMenu.showBank(game, null, 'crown'); return;
            case 'bid': res = Fiscal.bid(player, world, a, b); break;
            case 'squeeze': res = Fiscal.setSqueeze(player, world, a, b); break;
            case 'rate': res = Fiscal.setRate(player, world, a, b); break;
            case 'army': res = Fiscal.setArmyPay(player, world, a); break;
            case 'court': res = Fiscal.setCourt(player, world, a); break;
            case 'sale': res = Fiscal.royalSale(player, world, a); break;
            case 'farmOut': res = Fiscal.royalFarm(player, world, a); break;
            case 'coin':
                if (a === 'debase') res = Mints.royalDebase(player, world);
                else if (a === 'recoin') res = Mints.royalRecoin(player, world);
                else if (a === 'leave') res = Mints.setTreasurersCoin(player, world, !!b);
                else if (a === 'policy') res = Mints.setPolicy(player, world, b);
                break;
            default: return;
        }
        if (res) {
            game.ui.showNotification('🧾 The Treasury', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showTreasury(game);
    },
});
