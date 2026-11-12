// ActionMenu — the Trading Company panel: charter and founding, posts and
// standing orders, the ledger and P&L, contracts, rival houses and
// investments. Logic lives in systems/merchantHouses.js; this presents it.
import { ActionMenu } from './_ref.js';
import { MerchantHouses, PlayerEconomy, Trading } from './_imports.js';
import { BTN_GOLD, BTN_DARK, BTN_RED, panelTabs, lede, chips, sectionHead, kv, card, rowList, price } from './uiKit.js';
import { RealmIntel } from '../../systems/realmIntel.js';
import { companyDiagnosisHtml } from './merchantLedger.js';

// The action menu's voice (uiKit): section heads, rows, soft cards; inputs dark with a hairline gold edge
const INPUT = 'width: 56px; background:rgba(0,0,0,0.3); color:#ece2c8; border:1px solid rgba(245,197,66,0.2); border-radius:5px; padding:3px 5px; font-size:11px;';
const MUTED = 'color:#9d937c;';
const GOOD = '#8fd18a';
const BAD = '#e0846a';
const WARN = '#f0b35a';
const TABS = [
    ['overview', '📒 Ledger'], ['posts', '🏪 Posts'], ['contracts', '📜 Contracts'], ['rivals', '⚖️ Rivals'], ['investments', '💰 Investments'],
];

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const _g = (n) => `${Math.round(n).toLocaleString()}g`;
const _val = (id) => {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    return el ? el.value : null;
};
const _label = (id) => MerchantHouses.goodName(id);

function _pnlRows(by) {
    return Object.entries(by || {}).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => kv(_esc(k), _g(v))).join('')
        || `<div style="${MUTED}">—</div>`;
}

Object.assign(ActionMenu, {
    /** The Trading Company panel (tabs: ledger, posts, contracts, rivals, investments). */
    showTradingCompany(game, tile, tab = 'overview', message = null) {
        const player = game.player;
        const world = game.world;
        const c = MerchantHouses.company(player);
        let html = '<div style="font-size: 12px;">';
        if (message) html += `<div class="pk-card" style="border-color: ${message.color || 'rgba(245,197,66,0.4)'}; color:#ece2c8;">${message.html}</div>`;

        if (!c) {
            html += _companyFoundingHtml(player, world, tile);
        } else {
            html += lede(`<b>${_esc(c.name)}</b>, trading since day ${c.foundedDay}.`);
            html += chips([
                { icon: '💰', label: 'Capital', value: _g(c.capital), cls: 'gold' },
                ['⭐', 'Rep', Math.round(c.reputation)],
                ['⚖️', 'Worth', _g(MerchantHouses.companyValue(player))],
            ]);
            html += panelTabs(game, {
                id: 'tradingCompany', title: '⚖️ Trading Company', tabs: TABS, active: tab,
                go: (id) => { ActionMenu.showTradingCompany(game, tile, id); },
                attrsFor: (id) => `onclick="window._company.tab('${id}')"`,
            });
            if (tab === 'posts') html += _companyPostsHtml(player, world, tile);
            else if (tab === 'contracts') html += _companyContractsHtml(player, world);
            else if (tab === 'rivals') html += _companyRivalsHtml(player, world);
            else if (tab === 'investments') html += _companyInvestmentsHtml(player, world);
            else html += _companyLedgerHtml(player, world);
        }
        html += '</div>';

        const refresh = (msg, nextTab = tab) => {
            game.ui.updateStats(player, world);
            ActionMenu.showTradingCompany(game, tile, nextTab, msg);
        };
        const ok = (text) => refresh({ html: _esc(text), color: 'rgba(127,208,127,0.4)' });
        const fail = (reason) => game.ui.showNotification('⚖️ Trading Company', reason, 'error');
        const run = (res, text) => (res.success ? ok(typeof text === 'function' ? text(res) : text) : fail(res.reason));

        window._company = {
            tab: (t) => refresh(null, t),
            buyCharter: () => run(MerchantHouses.buyCharter(player, world, tile), r => `${r.kingdom} seals your charter for ${r.cost} gold.`),
            found: () => {
                const res = MerchantHouses.found(player, world, { name: _val('mhName'), capital: Number(_val('mhCapital')) || null });
                if (!res.success) return fail(res.reason);
                refresh({ html: `📜 <b>${_esc(res.company.name)}</b> opens its ledger with ${_g(res.company.capital)}. Open a post in a town to put a factor to work.` }, 'posts');
            },
            deposit: () => run(MerchantHouses.deposit(player, world, Number(_val('mhMove'))), r => `${_g(r.amount)} paid into the company.`),
            withdraw: () => run(MerchantHouses.withdraw(player, world, Number(_val('mhMove'))), r => `${_g(r.amount)} drawn from the company.`),
            openPost: (i) => run(MerchantHouses.openPost(player, world, tile, i), r => `${r.post.factor.name} opens the company's post at ${r.post.name}.`),
            replaceFactor: (postId, i) => run(MerchantHouses.replaceFactor(player, world, postId, i), r => `${r.factor.name} takes over the post${r.dismissed ? `; ${r.dismissed} is shown the door` : ''}.`),
            closePost: (postId) => run(MerchantHouses.closePost(player, world, postId), r => `The post is closed; its stock fetched ${_g(r.earned)}.`),
            audit: (postId) => run(MerchantHouses.audit(player, world, postId), r => r.text),
            setOrder: (postId) => {
                const v = (k) => _val(`mh_${k}_${postId}`);
                run(MerchantHouses.setOrder(player, postId, {
                    good: v('good'), buyBelow: v('buyBelow'), buyQty: v('buyQty'), sellAbove: v('sellAbove'), sellQty: v('sellQty'), keep: v('keep'),
                }), r => `Standing order for ${_label(r.order.good)} set.`);
            },
            removeOrder: (postId, good) => run(MerchantHouses.removeOrder(player, postId, good), 'Order cancelled.'),
            take: (postId, good) => run(MerchantHouses.withdrawStock(player, world, postId, good, Number(_val(`mh_take_${postId}`)) || 9999), r => `You take ${r.qty} from the warehouse.`),
            store: (postId) => run(MerchantHouses.depositStock(player, world, postId, _val(`mh_store_${postId}`), Number(_val(`mh_storeQty_${postId}`)) || 0), r => `${r.qty} stored in the warehouse.`),
            lobby: (postId, good) => run(MerchantHouses.lobbyMonopoly(player, world, postId, good), r => r.text),
            convoy: (postId) => {
                const target = _val(`mh_cvTo_${postId}`) || '';
                const [kind, id] = target.split(':');
                const res = MerchantHouses.dispatchConvoy(player, world, postId, kind === 'contract' ? { contractId: id } : { postId: id },
                    _val(`mh_cvGood_${postId}`), Number(_val(`mh_cvQty_${postId}`)) || 0);
                run(res, r => `A ${r.convoy.mode} leaves with ${r.convoy.qty} ${_label(r.convoy.good)} for ${r.convoy.to}, due day ${r.convoy.arriveDay} (fee ${r.plan.fee}g, ${Math.round(r.plan.risk * 100)}% risk).`);
            },
            accept: (id) => run(MerchantHouses.acceptContract(player, world, id), r => `Contract taken: ${r.contract.title}.`),
            deliver: (id, from, shipId) => run(MerchantHouses.deliverContract(player, world, id, from, { shipId: shipId || undefined }),
                r => `${r.delivered} delivered${r.done ? ' — the contract is fulfilled!' : '.'}`),
            buyShares: (id, n) => run(MerchantHouses.buyShares(player, world, id, n), r => `Bought for ${_g(r.cost)}; you hold ${r.shares} shares.`),
            sellShares: (id, n) => run(MerchantHouses.sellShares(player, world, id, n), r => `Sold for ${_g(r.earned)}.`),
            buyOut: (id) => run(MerchantHouses.buyOut(player, world, id), r => `Bought out for ${_g(r.cost)}; its coffers bring ${_g(r.assets)}.`),
            priceWar: (id) => run(MerchantHouses.priceWar(player, world, id, Number(_val(`mh_war_${id}`)) || 0), r => r.text),
            invest: (id) => run(MerchantHouses.invest(player, world, id, Number(_val(`mh_stake_${id}`)) || 0), r => `Staked ${_g(r.stake)}.`),
        };

        game.ui.showCustomPanel('⚖️ Trading Company', html);
    },
});

// Quiet tables: a muted head in the section-head voice, hairline row rules
const TABLE = 'width:100%; font-size:11px; border-collapse:collapse; margin-top:4px;';
const THEAD = 'color:#9d937c; font-size:10px; text-transform:uppercase; letter-spacing:1px;';
const TR = 'border-top:1px solid rgba(245,197,66,0.07);';

function _companyFoundingHtml(player, world, tile) {
    let html = lede('Trade is personal until you found a company: a chartered house with its own capital, ledger and reputation, factors running posts in towns, supply contracts from the realms, and rival houses to beat.');
    const charters = (player.merchant && player.merchant.charters) || [];
    html += sectionHead('Charters');
    const rows = [];
    if (charters.length) {
        for (const ch of charters) {
            const k = ch.kingdomId && world.getKingdom(ch.kingdomId);
            rows.push({ icon: '📜', name: _esc(k ? k.name : 'Your House'), desc: _esc(ch.source), side: `day ${ch.day}` });
        }
    } else if (MerchantHouses.officeCharter(player)) {
        rows.push({ icon: '🏅', name: 'Your royal office carries the right to charter a company.' });
    } else {
        html += `<div style="${MUTED} font-size:12px; margin-bottom:6px;">You hold no charter. Buy one from a crown, earn one at court (merchant venturers petition your holdings), or hold a royal office.</div>`;
    }
    const can = MerchantHouses.canBuyCharter(player, world, tile);
    if (can.ok) rows.push({ icon: '📜', name: `Buy a charter from ${_esc(can.kingdom.name)}`, desc: 'The crown seals your right to found a company', side: price(can.cost, (player.gold || 0) >= can.cost), attrs: 'onclick="window._company.buyCharter()"' });
    else if (can.cost) rows.push({ icon: '📜', name: 'Buy a charter', off: true, why: _esc(can.reason), side: _g(can.cost) });
    html += rowList(rows);
    const min = MerchantHouses.config().found.minCapital;
    html += sectionHead('Found the Company');
    let form = `<div>Name <input id="mhName" style="${INPUT} width:200px;" value="${_esc(MerchantHouses.defaultName(player))}"></div>`;
    form += `<div style="margin-top:6px;">Capital <input id="mhCapital" type="number" style="${INPUT} width:80px;" value="${Math.max(min, Math.min(3000, Math.floor((player.gold || 0) / 2)))}"> gold <span style="${MUTED}">(at least ${min})</span></div>`;
    const f = MerchantHouses.canFound(player, world, min);
    form += f.ok ? `<div style="margin-top:6px;"><button onclick="window._company.found()" style="${BTN_GOLD}">⚖️ Found the company</button></div>`
        : `<div class="pk-row-why" style="margin-top:6px;">${_esc(f.reason)}</div>`;
    html += card(form);
    const rivals = MerchantHouses.ensureRivals(player, world);
    if (rivals.length) {
        html += rowList(rivals.map(r => ({ icon: r.icon, name: _esc(r.name), desc: `${_esc(r.seat ? r.seat.name : '')}, ${_esc(r.specialty.join(', '))}` })), 'The Great Houses');
    }
    return html;
}

function _companyLedgerHtml(player, world) {
    const c = MerchantHouses.company(player);
    const pnl = MerchantHouses.profitAndLoss(player);
    let body = `<div>Move gold <input id="mhMove" type="number" style="${INPUT}" value="500"> `;
    body += `<button onclick="window._company.deposit()" style="${BTN_DARK}">⬆️ Pay in</button><button onclick="window._company.withdraw()" style="${BTN_DARK}">⬇️ Draw out</button></div>`;
    body += `<div style="font-size:11px; ${MUTED} margin-top:4px;">Purse ${_g(player.gold || 0)} · paid in ${_g(c.flows.paidIn || 0)} · drawn ${_g(c.flows.drawn || 0)} · factors keep ${_g(MerchantHouses.reserve(player))} back for wages</div>`;
    let html = card(body, { icon: '💱', title: 'The Company Purse' });
    html += sectionHead(`Profit &amp; Loss — net <span style="color:${pnl.net >= 0 ? GOOD : BAD};">${_g(pnl.net)}</span>`);
    html += `<div style="display:flex; gap:16px;"><div style="flex:1;"><div style="font-weight:600; color:${GOOD}; margin-bottom:2px;">Income ${_g(pnl.income)}</div>${_pnlRows(pnl.incomeBy)}</div><div style="flex:1;"><div style="font-weight:600; color:${BAD}; margin-bottom:2px;">Expenses ${_g(pnl.expenses)}</div>${_pnlRows(pnl.expensesBy)}</div></div>`;
    html += companyDiagnosisHtml(player, world);
    if (c.weeks.length) {
        html += `${sectionHead('Recent Weeks')}<table style="${TABLE}">`;
        html += `<tr style="${THEAD}"><td>Day</td><td style="text-align:right;">In</td><td style="text-align:right;">Out</td><td style="text-align:right;">Capital</td></tr>`;
        for (const w of c.weeks.slice(0, 8)) {
            html += `<tr style="${TR}"><td>${w.day}</td><td style="text-align:right; color:${GOOD};">${_g(w.income)}</td><td style="text-align:right; color:${BAD};">${_g(w.expenses)}</td><td style="text-align:right;">${_g(w.capital)}</td></tr>`;
        }
        html += '</table>';
    }
    const st = c.stats;
    html += `<div style="font-size:11px; ${MUTED} margin-top:6px;">Contracts ${st.contractsDone} done, ${st.contractsFailed} broken · robberies ${st.robberies} · convoys lost ${st.convoysLost}</div>`;
    const news = (player.merchant.news || []).slice(0, 10);
    if (news.length) {
        html += rowList(news.map(n => ({ icon: n.icon, name: `<span style="font-weight:400; font-size:12px;">${_esc(n.text)}</span>`, side: `<span style="${MUTED} font-size:10.5px;">Day ${n.day}</span>` })), 'News of the Trade');
    }
    html += sectionHead('Ledger');
    for (const e of c.ledger.slice(0, 20)) {
        // (a memo line — stock thieves took — moves no coin)
        const color = e.kind === 'income' ? GOOD : e.kind === 'memo' ? WARN : BAD;
        const sign = e.kind === 'income' ? '+' : e.kind === 'memo' ? '' : '−';
        html += `<div class="pk-kv" style="font-size:11px;"><span><span style="color:#7d7564;">${e.day}</span> ${_esc(e.text)}</span><span style="color:${color};">${sign}${_g(e.amount)}${e.kind === 'memo' ? ' of stock' : ''}</span></div>`;
    }
    return html;
}

function _companyPostsHtml(player, world, tile) {
    const c = MerchantHouses.company(player);
    const cfg = MerchantHouses.config();
    let html = '';
    const here = tile && tile.settlement ? MerchantHouses.postAt(player, tile.q, tile.r) : null;
    if (tile && tile.settlement && !here) {
        const can = MerchantHouses.canOpenPost(player, world, tile);
        html += sectionHead(`Open a post at ${_esc(tile.settlement.name)}`);
        if (!can.ok) html += `<div class="pk-row-why" style="margin-bottom:6px;">${_esc(can.reason)}</div>`;
        else {
            html += `<div style="${MUTED} font-size:11px;">${_g(can.cost)}${can.foreign ? ', foreign licence' : ''}</div>`;
            html += rowList(MerchantHouses.candidates(player, world, tile).map((f, i) => {
                const ref = MerchantHouses.reference(f);
                return {
                    icon: '👤',
                    name: _esc(f.name),
                    desc: `skill ${f.skill}, <span style="color:${ref.color};">${ref.label}</span>, ${f.wage}g/week`,
                    attrs: `onclick="window._company.openPost(${i})"`,
                    side: 'Hire &amp; open ›',
                    tone: 'gold',
                };
            }));
        }
    }
    if (!c.posts.length) html += `<div style="${MUTED} font-size:12px;">No posts yet. Visit a town to open one.</div>`;
    const goods = Object.values(PlayerEconomy.GOODS || {}).filter(g => g && g.basePrice > 0);
    if (c.posts.length) html += sectionHead('Your Posts');
    for (const post of c.posts) {
        const atPost = player.q === post.q && player.r === post.r;
        const ptile = world.getTile(post.q, post.r);
        let body = '';
        if (post.factor) {
            const ref = MerchantHouses.reference(post.factor);
            body += `<div>👤 ${_esc(post.factor.name)} — skill ${post.factor.skill} (${MerchantHouses.factorVolume(post.factor)} units/week), <span style="color:${ref.color};">${ref.label}</span>, ${MerchantHouses.factorWage(post.factor)}g/week + ${Math.round((cfg.factor.commission || 0) * 100)}% of sales${post.factor.unpaid ? ` <span style="color:${BAD};">(unpaid ${post.factor.unpaid} wk)</span>` : ''}</div>`;
        } else {
            body += `<div style="color:${BAD};">No factor — the post is idle.</div>`;
        }
        if (post.suspicion >= cfg.factor.suspicionShown) body += `<div style="color:${WARN};">🧾 The accounts don't add up.</div>`;
        const rivals = MerchantHouses.rivalsAt(player, post.q, post.r);
        if (rivals.length) body += `<div style="color:${WARN}; font-size:11px;">⚖️ Competing here: ${rivals.map(r => `${r.icon} ${_esc(r.name)}`).join(', ')}</div>`;
        const monos = Object.entries((ptile && ptile.settlement && ptile.settlement.monopolies) || {});
        if (monos.length) body += `<div style="font-size:11px; color:#b9ae94;">👑 ${monos.map(([g, m]) => `${_label(g)}: ${_esc(m.holderName || m.holder)}`).join(' · ')}</div>`;
        const stock = Object.entries(post.stock);
        body += `<div style="font-size:11px; margin-top:3px;">📦 ${stock.length ? stock.map(([g, q]) => `${_label(g)} ×${q}${atPost ? ` <a href="#" onclick="window._company.take('${post.id}','${g}');return false;" style="color:var(--gold);">take</a>` : ''}`).join(' · ') : 'empty'}</div>`;
        if (post.lastWeek && !post.lastWeek.idle) {
            body += `<div style="font-size:11px; ${MUTED}">Last week: sold ${_g(post.lastWeek.sales)}, bought ${_g(post.lastWeek.purchases)}${(post.lastWeek.blocked || []).length ? ` · barred by monopoly: ${post.lastWeek.blocked.map(_label).join(', ')}` : ''}</div>`;
        }
        // Standing orders
        body += `<table style="${TABLE} margin-top:6px;"><tr style="${THEAD}"><td>Good</td><td>Buy ≤</td><td>×/wk</td><td>Sell ≥</td><td>×/wk</td><td>Keep</td><td>Now buy/sell</td><td></td></tr>`;
        for (const o of post.orders) {
            const buy = ptile ? MerchantHouses.factorBuyUnit(player, world, ptile, o.good) : null;
            const sell = ptile ? MerchantHouses.factorSaleUnit(player, world, ptile, o.good) : 0;
            body += `<tr style="${TR}"><td>${_label(o.good)}</td><td>${o.buyBelow}</td><td>${o.buyQty}</td><td>${o.sellAbove}</td><td>${o.sellQty}</td><td>${o.keep}</td><td style="color:#b9ae94;">${buy == null ? '—' : buy} / ${sell ? Math.round(sell * 10) / 10 : '—'}</td>`;
            body += `<td><a href="#" onclick="window._company.removeOrder('${post.id}','${o.good}');return false;" style="color:${BAD};">✕</a>`;
            body += ` <a href="#" title="Lobby for a monopoly" onclick="window._company.lobby('${post.id}','${o.good}');return false;" style="color:var(--gold);">👑</a></td></tr>`;
        }
        body += '</table>';
        if (post.orders.length < cfg.post.maxOrders) {
            const sold = new Set(ptile && ptile.settlement ? Trading.getAvailableGoods(ptile.settlement, ptile, world).map(g => g.id) : []);
            const opts = goods.filter(g => sold.has(g.id) || post.stock[g.id]).map(g => `<option value="${g.id}">${_esc(`${g.icon || ''} ${g.name}`)}${sold.has(g.id) ? '' : ' (stock)'}</option>`).join('');
            const inp = (k, v) => `<input id="mh_${k}_${post.id}" type="number" min="0" style="${INPUT}" value="${v}">`;
            body += `<div style="margin-top:6px; font-size:11px;"><span style="${MUTED}">New order:</span> <select id="mh_good_${post.id}" style="${INPUT} width:120px;">${opts}</select> buy ≤ ${inp('buyBelow', 10)} ×${inp('buyQty', 20)} sell ≥ ${inp('sellAbove', 15)} ×${inp('sellQty', 20)} keep ${inp('keep', 0)} `;
            body += `<button onclick="window._company.setOrder('${post.id}')" style="${BTN_GOLD}">Set</button></div>`;
        }
        // Convoys
        if (stock.length) {
            const targets = c.posts.filter(p => p !== post).map(p => `<option value="post:${p.id}">🏪 ${_esc(p.name)}</option>`)
                .concat(c.contracts.map(ct => `<option value="contract:${ct.id}">📜 ${_esc(ct.town)} (${_esc(ct.good)})</option>`)).join('');
            if (targets) {
                body += `<div style="margin-top:4px; font-size:11px;"><span style="${MUTED}">Send</span> <select id="mh_cvGood_${post.id}" style="${INPUT} width:110px;">${stock.map(([g]) => `<option value="${g}">${_esc(_label(g))}</option>`).join('')}</select>`;
                body += ` ×<input id="mh_cvQty_${post.id}" type="number" style="${INPUT}" value="20"> to <select id="mh_cvTo_${post.id}" style="${INPUT} width:130px;">${targets}</select>`;
                body += ` <button onclick="window._company.convoy('${post.id}')" style="${BTN_DARK}">🐫 Dispatch</button></div>`;
            }
        }
        body += '<div style="margin-top:6px;">';
        if (atPost) {
            const inv = Object.entries(player.inventory || {}).filter(([id, q]) => q > 0 && MerchantHouses._good(id));
            if (inv.length) {
                body += `<select id="mh_store_${post.id}" style="${INPUT} width:110px;">${inv.map(([id, q]) => `<option value="${id}">${_esc(_label(id))} (${q})</option>`).join('')}</select>`;
                body += ` ×<input id="mh_storeQty_${post.id}" type="number" style="${INPUT}" value="10"> <button onclick="window._company.store('${post.id}')" style="${BTN_DARK}">📥 Store</button>`;
            }
            body += `<input id="mh_take_${post.id}" type="hidden" value="9999">`;
            MerchantHouses.candidates(player, world, ptile).forEach((f, i) => {
                body += `<button onclick="window._company.replaceFactor('${post.id}', ${i})" style="${BTN_DARK}" title="skill ${f.skill}, ${MerchantHouses.reference(f).label}">👤 Hire ${_esc(f.name)} (skill ${f.skill})</button>`;
            });
        }
        body += `<button onclick="window._company.audit('${post.id}')" style="${BTN_DARK}">🧾 Audit (${cfg.factor.auditCost}g)</button>`;
        body += `<button onclick="window._company.closePost('${post.id}')" style="${BTN_RED}">Close post</button></div>`;
        html += card(body, { icon: '🏪', title: _esc(post.name), side: `stock ${MerchantHouses.stockTotal(post)}/${cfg.post.capacity}` });
    }
    if (c.convoys.length) {
        html += rowList(c.convoys.map(v => ({
            icon: v.mode === 'ship' ? '⛵' : '🐫',
            name: `${v.qty} ${_esc(_label(v.good))}`,
            desc: `${_esc(v.from)} → ${_esc(v.to)}`,
            side: `due day ${v.arriveDay}`,
        })), 'On the Road');
    }
    return html;
}

function _companyContractsHtml(player, world) {
    const c = MerchantHouses.company(player);
    let html = sectionHead('Your Contracts');
    if (!c.contracts.length) html += `<div style="${MUTED} font-size:12px;">None in hand.</div>`;
    for (const ct of c.contracts) {
        const left = ct.deadline - world.day;
        let body = `<div style="${MUTED} font-size:11px;">for ${_esc(ct.issuer)}</div>`;
        body += `<div>${ct.delivered}/${ct.qty} ${_esc(_label(ct.good))} to <b>${_esc(ct.town)}</b> (${ct.q}, ${ct.r}) · ${MerchantHouses.contractUnitPay(world, ct)}g each</div>`;
        const opts = MerchantHouses.deliveryOptions(player, world, ct.id);
        if (opts.length) {
            body += '<div style="margin-top:4px;">';
            for (const o of opts) {
                body += `<button onclick="window._company.deliver('${ct.id}','${o.from}','${o.shipId || ''}')" style="${BTN_GOLD}">Deliver ${Math.min(o.qty, ct.qty - ct.delivered)} ${_esc(o.label)}</button>`;
            }
            body += '</div>';
        }
        html += card(body, { icon: ct.icon, title: _esc(ct.title), side: `<span style="color:${left < 5 ? BAD : '#cbbf9f'};">${left} days left</span>` });
    }
    const board = MerchantHouses.board(player);
    html += sectionHead('The Board');
    if (!board.length) html += `<div style="${MUTED} font-size:12px;">No contracts posted this week.</div>`;
    html += rowList(board.map(ct => {
        const can = MerchantHouses.canAcceptContract(player, ct);
        return {
            icon: ct.icon,
            name: _esc(ct.title),
            desc: _esc(ct.text),
            why: _esc(can.reason),
            note: `<span style="color:#b9ae94;">${ct.qty} ${_esc(_label(ct.good))} to ${_esc(ct.town)} by day ${ct.deadline} · ${ct.pay}g each (${_g(ct.pay * ct.qty)}) · +${ct.reputation} rep</span>`,
            off: !can.ok,
            attrs: `onclick="window._company.accept('${ct.id}')" title="Take the contract"`,
            side: _g(ct.pay * ct.qty),
            tone: 'gold',
        };
    }));
    return html;
}

function _companyRivalsHtml(player, world) {
    let html = sectionHead('Rival Houses');
    for (const r of MerchantHouses.rivals(player)) {
        const active = r.status === 'active';
        // A rival house's books are for its shareholders; the rest know its name and its posts
        const holder = (r.shares && r.shares.player) > 0;
        const side = active ? `💰 ${holder ? _g(r.capital) : _esc(RealmIntel.band('capital', r.capital))} · ⭐ ${Math.round(r.reputation)}` : `<span style="color:${BAD};">${r.status}</span>`;
        const title = `${_esc(r.name)} <span style="${MUTED} font-weight:400; font-size:12px;">(${_esc(r.temperament)})</span>`;
        if (!active) {
            html += `<div style="opacity:0.55;">${card('', { icon: r.icon, title, side })}</div>`;
            continue;
        }
        let body = `<div style="font-size:11px; color:#b9ae94;">Trades ${_esc(r.specialty.join(', '))} · posts: ${_esc(r.posts.map(p => p.name).join(', '))}${holder ? ` · last week ${r.lastProfit >= 0 ? '+' : ''}${_g(r.lastProfit)}` : ''}</div>`;
        body += `<div style="font-size:11px;">Rivalry <span style="color:${r.rivalry >= 50 ? BAD : '#cbbf9f'};">${Math.round(r.rivalry)}</span> · share ${Math.round(MerchantHouses.sharePrice(r))}g · you hold <b>${r.shares.player}</b>/100</div>`;
        body += '<div style="margin-top:4px;">';
        body += `<button onclick="window._company.buyShares('${r.id}', 5)" style="${BTN_DARK}">Buy 5 shares</button>`;
        body += `<button onclick="window._company.buyShares('${r.id}', 20)" style="${BTN_DARK}">Buy 20</button>`;
        if (r.shares.player > 0) body += `<button onclick="window._company.sellShares('${r.id}', ${r.shares.player})" style="${BTN_DARK}">Sell all</button>`;
        if (r.shares.player >= 51) body += `<button onclick="window._company.buyOut('${r.id}')" style="${BTN_GOLD}">Buy out (${_g(MerchantHouses.buyOutCost(player, r))})</button>`;
        body += ` <input id="mh_war_${r.id}" type="number" style="${INPUT}" value="${MerchantHouses.config().rivals.priceWar.minSpend}"><button onclick="window._company.priceWar('${r.id}')" style="${BTN_RED}">⚔️ Price war</button>`;
        body += '</div>';
        html += card(body, { icon: r.icon, title, side });
    }
    const monos = [];
    for (const s of world.getSettlementViews ? world.getSettlementViews() : []) {
        for (const [g, m] of Object.entries(s.monopolies || {})) monos.push(`${_esc(s.name)}: ${_esc(_label(g))} — ${_esc(m.holderName || m.holder)}${m.untilDay ? ` (to day ${m.untilDay})` : ''}`);
    }
    if (monos.length) html += `${sectionHead('Monopolies')}<div style="font-size:11px; color:#b9ae94;">${monos.join('<br>')}</div>`;
    return html;
}

function _companyInvestmentsHtml(player, world) {
    const c = MerchantHouses.company(player);
    const m = MerchantHouses.state(player);
    let html = sectionHead('Royal Ventures');
    if (!m.ventures.length) html += `<div style="${MUTED} font-size:12px;">No crown is selling shares in a venture just now.</div>`;
    for (const v of m.ventures) {
        let body = `<div style="font-size:11px; color:#b9ae94;">${_esc(v.text)} About ${v.days} days; ${Math.round(v.success * 100)}% odds; ×${v.returnMult[0]}–${v.returnMult[1]} if it comes home. Up to ${_g(v.maxStake)}.</div>`;
        body += `<div style="margin-top:4px;"><input id="mh_stake_${v.id}" type="number" style="${INPUT}" value="${MerchantHouses.config().ventures.minStake}"> <button onclick="window._company.invest('${v.id}')" style="${BTN_GOLD}">Stake</button></div>`;
        html += card(body, { icon: v.icon, title: _esc(v.name), side: `${_esc(v.kingdom)}, offers close day ${v.openUntil}` });
    }
    html += sectionHead('Your Stakes');
    if (!c.investments.ventures.length) html += `<div style="${MUTED} font-size:12px;">None.</div>`;
    html += rowList(c.investments.ventures.map(s => ({ icon: s.icon, name: _esc(s.name), desc: `due home about day ${s.resolveDay}`, side: _g(s.stake), tone: 'gold' })));
    const held = MerchantHouses.activeRivals(player).filter(r => r.shares.player > 0);
    html += sectionHead('Shares in Other Houses');
    if (!held.length) html += `<div style="${MUTED} font-size:12px;">None (buy them on the Rivals tab).</div>`;
    html += rowList(held.map(r => ({ icon: r.icon, name: _esc(r.name), desc: `${r.shares.player} shares`, side: `≈ ${_g(r.shares.player * MerchantHouses.sharePrice(r))}`, tone: 'gold' })));
    return html;
}
