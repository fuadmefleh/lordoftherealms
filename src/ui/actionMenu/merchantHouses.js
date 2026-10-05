// ActionMenu — the Trading Company panel: charter and founding, posts and
// standing orders, the ledger and P&L, contracts, rival houses and
// investments. Logic lives in systems/merchantHouses.js; this presents it.
import { ActionMenu } from './_ref.js';
import { MerchantHouses, PlayerEconomy, Trading } from './_imports.js';

const BTN = 'padding: 4px 8px; margin: 3px 3px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DARK = BTN + 'background: #444; color: #eee;';
const BTN_RED = BTN + 'background: #7a2e2e; color: #fff;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 4px;';
const INPUT = 'width: 56px; background:#222; color:#eee; border:1px solid #555; border-radius:3px; padding:2px 4px; font-size:11px;';
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
        .map(([k, v]) => `<div style="display:flex; justify-content:space-between;"><span style="color:#bbb;">${_esc(k)}</span><span>${_g(v)}</span></div>`).join('')
        || '<div style="color:#777;">—</div>';
}

Object.assign(ActionMenu, {
    /** The Trading Company panel (tabs: ledger, posts, contracts, rivals, investments). */
    showTradingCompany(game, tile, tab = 'overview', message = null) {
        const player = game.player;
        const world = game.world;
        const c = MerchantHouses.company(player);
        let html = '<div style="max-height: 540px; overflow-y: auto; font-size: 12px;">';
        if (message) html += `<div style="${CARD} border-color: ${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;

        if (!c) {
            html += _companyFoundingHtml(player, world, tile);
        } else {
            html += `<div style="display:flex; justify-content:space-between; align-items:baseline;"><div><b style="font-size:14px;">${_esc(c.name)}</b> <span style="color:#999;">since day ${c.foundedDay}</span></div>`;
            html += `<div>💰 ${_g(c.capital)} · ⭐ ${Math.round(c.reputation)} rep · worth ${_g(MerchantHouses.companyValue(player))}</div></div>`;
            html += '<div style="margin:6px 0;">';
            for (const [id, label] of TABS) {
                html += `<button onclick="window._company.tab('${id}')" style="${id === tab ? BTN_GOLD : BTN_DARK}">${label}</button>`;
            }
            html += '</div>';
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

function _companyFoundingHtml(player, world, tile) {
    let html = `<div style="${CARD}">Trade is personal until you found a company: a chartered house with its own capital, ledger and reputation, factors running posts in towns, supply contracts from the realms, and rival houses to beat.</div>`;
    const charters = (player.merchant && player.merchant.charters) || [];
    html += `<div style="${HEAD}">Charters</div>`;
    if (charters.length) {
        for (const ch of charters) {
            const k = ch.kingdomId && world.getKingdom(ch.kingdomId);
            html += `<div>📜 ${_esc(k ? k.name : 'Your House')} — ${_esc(ch.source)} (day ${ch.day})</div>`;
        }
    } else if (MerchantHouses.officeCharter(player)) {
        html += '<div>🏅 Your royal office carries the right to charter a company.</div>';
    } else {
        html += '<div style="color:#aaa;">You hold no charter. Buy one from a crown, earn one at court (merchant venturers petition your holdings), or hold a royal office.</div>';
    }
    const can = MerchantHouses.canBuyCharter(player, world, tile);
    if (can.ok) html += `<button onclick="window._company.buyCharter()" style="${BTN_GOLD}">📜 Buy a charter from ${_esc(can.kingdom.name)} (${_g(can.cost)})</button>`;
    else if (can.cost) html += `<div style="color:#999; font-size:11px;">${_esc(can.reason)}</div>`;
    const min = MerchantHouses.config().found.minCapital;
    html += `<div style="${HEAD}">Found the Company</div>`;
    html += `<div>Name <input id="mhName" style="${INPUT} width:200px;" value="${_esc(MerchantHouses.defaultName(player))}"></div>`;
    html += `<div style="margin-top:4px;">Capital <input id="mhCapital" type="number" style="${INPUT} width:80px;" value="${Math.max(min, Math.min(3000, Math.floor((player.gold || 0) / 2)))}"> gold (at least ${min})</div>`;
    const f = MerchantHouses.canFound(player, world, min);
    html += f.ok ? `<button onclick="window._company.found()" style="${BTN_GOLD}">⚖️ Found the company</button>`
        : `<div style="color:#999; font-size:11px; margin-top:4px;">${_esc(f.reason)}</div>`;
    const rivals = MerchantHouses.ensureRivals(player, world);
    if (rivals.length) {
        html += `<div style="${HEAD}">The Great Houses</div>`;
        for (const r of rivals) html += `<div>${r.icon} <b>${_esc(r.name)}</b> <span style="color:#999;">— ${_esc(r.seat ? r.seat.name : '')}, ${_esc(r.specialty.join(', '))}</span></div>`;
    }
    return html;
}

function _companyLedgerHtml(player, world) {
    const c = MerchantHouses.company(player);
    const pnl = MerchantHouses.profitAndLoss(player);
    let html = `<div style="${CARD}">`;
    html += `<div>Move gold <input id="mhMove" type="number" style="${INPUT}" value="500"> `;
    html += `<button onclick="window._company.deposit()" style="${BTN_DARK}">⬆️ Pay in</button><button onclick="window._company.withdraw()" style="${BTN_DARK}">⬇️ Draw out</button></div>`;
    html += `<div style="font-size:11px; color:#999;">Purse ${_g(player.gold || 0)} · paid in ${_g(c.flows.paidIn || 0)} · drawn ${_g(c.flows.drawn || 0)} · factors keep ${_g(MerchantHouses.reserve(player))} back for wages</div></div>`;
    html += `<div style="${HEAD}">Profit &amp; Loss — net <span style="color:${pnl.net >= 0 ? '#7fd07f' : '#e08080'};">${_g(pnl.net)}</span></div>`;
    html += `<div style="display:flex; gap:16px;"><div style="flex:1;"><b>Income ${_g(pnl.income)}</b>${_pnlRows(pnl.incomeBy)}</div><div style="flex:1;"><b>Expenses ${_g(pnl.expenses)}</b>${_pnlRows(pnl.expensesBy)}</div></div>`;
    if (c.weeks.length) {
        html += `<div style="${HEAD}">Recent Weeks</div><table style="width:100%; font-size:11px;">`;
        html += '<tr style="color:#999;"><td>Day</td><td style="text-align:right;">In</td><td style="text-align:right;">Out</td><td style="text-align:right;">Capital</td></tr>';
        for (const w of c.weeks.slice(0, 8)) {
            html += `<tr><td>${w.day}</td><td style="text-align:right; color:#7fd07f;">${_g(w.income)}</td><td style="text-align:right; color:#e08080;">${_g(w.expenses)}</td><td style="text-align:right;">${_g(w.capital)}</td></tr>`;
        }
        html += '</table>';
    }
    const st = c.stats;
    html += `<div style="font-size:11px; color:#999; margin-top:6px;">Contracts ${st.contractsDone} done, ${st.contractsFailed} broken · robberies ${st.robberies} · convoys lost ${st.convoysLost}</div>`;
    const news = (player.merchant.news || []).slice(0, 10);
    if (news.length) {
        html += `<div style="${HEAD}">News of the Trade</div>`;
        for (const n of news) html += `<div style="color:#ccc;"><span style="color:#888; font-size:10px;">Day ${n.day}</span> ${n.icon} ${_esc(n.text)}</div>`;
    }
    html += `<div style="${HEAD}">Ledger</div>`;
    for (const e of c.ledger.slice(0, 20)) {
        const color = e.kind === 'income' ? '#7fd07f' : '#e08080';
        html += `<div style="display:flex; justify-content:space-between; font-size:11px;"><span><span style="color:#888;">${e.day}</span> ${_esc(e.text)}</span><span style="color:${color};">${e.kind === 'income' ? '+' : '−'}${_g(e.amount)}</span></div>`;
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
        html += `<div style="${CARD}"><b>Open a post at ${_esc(tile.settlement.name)}</b>`;
        if (!can.ok) html += `<div style="color:#999;">${_esc(can.reason)}</div>`;
        else {
            html += ` <span style="color:#999;">(${_g(can.cost)}${can.foreign ? ', foreign licence' : ''})</span>`;
            MerchantHouses.candidates(player, world, tile).forEach((f, i) => {
                const ref = MerchantHouses.reference(f);
                html += `<div style="margin-top:4px;">👤 <b>${_esc(f.name)}</b> — skill ${f.skill}, <span style="color:${ref.color};">${ref.label}</span>, ${f.wage}g/week `;
                html += `<button onclick="window._company.openPost(${i})" style="${BTN_GOLD}">Hire &amp; open</button></div>`;
            });
        }
        html += '</div>';
    }
    if (!c.posts.length) html += '<div style="color:#aaa;">No posts yet. Visit a town to open one.</div>';
    const goods = Object.values(PlayerEconomy.GOODS || {}).filter(g => g && g.basePrice > 0);
    for (const post of c.posts) {
        const atPost = player.q === post.q && player.r === post.r;
        const ptile = world.getTile(post.q, post.r);
        html += `<div style="${CARD}">`;
        html += `<div style="display:flex; justify-content:space-between;"><b>🏪 ${_esc(post.name)}</b><span style="color:#999;">stock ${MerchantHouses.stockTotal(post)}/${cfg.post.capacity}</span></div>`;
        if (post.factor) {
            const ref = MerchantHouses.reference(post.factor);
            html += `<div>👤 ${_esc(post.factor.name)} — skill ${post.factor.skill} (${MerchantHouses.factorVolume(post.factor)} units/week), <span style="color:${ref.color};">${ref.label}</span>, ${MerchantHouses.factorWage(post.factor)}g/week${post.factor.unpaid ? ` <span style="color:#e08080;">(unpaid ${post.factor.unpaid} wk)</span>` : ''}</div>`;
        } else {
            html += '<div style="color:#e08080;">No factor — the post is idle.</div>';
        }
        if (post.suspicion >= cfg.factor.suspicionShown) html += '<div style="color:#e0b060;">🧾 The accounts don\'t add up.</div>';
        const rivals = MerchantHouses.rivalsAt(player, post.q, post.r);
        if (rivals.length) html += `<div style="color:#e0b060; font-size:11px;">⚖️ Competing here: ${rivals.map(r => `${r.icon} ${_esc(r.name)}`).join(', ')}</div>`;
        const monos = Object.entries((ptile && ptile.settlement && ptile.settlement.monopolies) || {});
        if (monos.length) html += `<div style="font-size:11px; color:#bbb;">👑 ${monos.map(([g, m]) => `${_label(g)}: ${_esc(m.holderName || m.holder)}`).join(' · ')}</div>`;
        const stock = Object.entries(post.stock);
        html += `<div style="font-size:11px; margin-top:3px;">📦 ${stock.length ? stock.map(([g, q]) => `${_label(g)} ×${q}${atPost ? ` <a href="#" onclick="window._company.take('${post.id}','${g}');return false;" style="color:var(--gold);">take</a>` : ''}`).join(' · ') : 'empty'}</div>`;
        if (post.lastWeek && !post.lastWeek.idle) {
            html += `<div style="font-size:11px; color:#999;">Last week: sold ${_g(post.lastWeek.sales)}, bought ${_g(post.lastWeek.purchases)}${(post.lastWeek.blocked || []).length ? ` · barred by monopoly: ${post.lastWeek.blocked.map(_label).join(', ')}` : ''}</div>`;
        }
        // Standing orders
        html += '<table style="width:100%; font-size:11px; margin-top:4px;"><tr style="color:#999;"><td>Good</td><td>Buy ≤</td><td>×/wk</td><td>Sell ≥</td><td>×/wk</td><td>Keep</td><td>Now buy/sell</td><td></td></tr>';
        for (const o of post.orders) {
            const buy = ptile ? MerchantHouses.factorBuyUnit(player, world, ptile, o.good) : null;
            const sell = ptile ? MerchantHouses.factorSaleUnit(player, world, ptile, o.good) : 0;
            html += `<tr><td>${_label(o.good)}</td><td>${o.buyBelow}</td><td>${o.buyQty}</td><td>${o.sellAbove}</td><td>${o.sellQty}</td><td>${o.keep}</td><td style="color:#bbb;">${buy == null ? '—' : buy} / ${sell ? Math.round(sell * 10) / 10 : '—'}</td>`;
            html += `<td><a href="#" onclick="window._company.removeOrder('${post.id}','${o.good}');return false;" style="color:#e08080;">✕</a>`;
            html += ` <a href="#" title="Lobby for a monopoly" onclick="window._company.lobby('${post.id}','${o.good}');return false;" style="color:var(--gold);">👑</a></td></tr>`;
        }
        html += '</table>';
        if (post.orders.length < cfg.post.maxOrders) {
            const sold = new Set(ptile && ptile.settlement ? Trading.getAvailableGoods(ptile.settlement, ptile, world).map(g => g.id) : []);
            const opts = goods.filter(g => sold.has(g.id) || post.stock[g.id]).map(g => `<option value="${g.id}">${_esc(`${g.icon || ''} ${g.name}`)}${sold.has(g.id) ? '' : ' (stock)'}</option>`).join('');
            const inp = (k, v) => `<input id="mh_${k}_${post.id}" type="number" min="0" style="${INPUT}" value="${v}">`;
            html += `<div style="margin-top:4px; font-size:11px;">New order: <select id="mh_good_${post.id}" style="${INPUT} width:120px;">${opts}</select> buy ≤ ${inp('buyBelow', 10)} ×${inp('buyQty', 20)} sell ≥ ${inp('sellAbove', 15)} ×${inp('sellQty', 20)} keep ${inp('keep', 0)} `;
            html += `<button onclick="window._company.setOrder('${post.id}')" style="${BTN_GOLD}">Set</button></div>`;
        }
        // Convoys
        if (stock.length) {
            const targets = c.posts.filter(p => p !== post).map(p => `<option value="post:${p.id}">🏪 ${_esc(p.name)}</option>`)
                .concat(c.contracts.map(ct => `<option value="contract:${ct.id}">📜 ${_esc(ct.town)} (${_esc(ct.good)})</option>`)).join('');
            if (targets) {
                html += `<div style="margin-top:4px; font-size:11px;">Send <select id="mh_cvGood_${post.id}" style="${INPUT} width:110px;">${stock.map(([g]) => `<option value="${g}">${_esc(_label(g))}</option>`).join('')}</select>`;
                html += ` ×<input id="mh_cvQty_${post.id}" type="number" style="${INPUT}" value="20"> to <select id="mh_cvTo_${post.id}" style="${INPUT} width:130px;">${targets}</select>`;
                html += ` <button onclick="window._company.convoy('${post.id}')" style="${BTN_DARK}">🐫 Dispatch</button></div>`;
            }
        }
        html += '<div style="margin-top:4px;">';
        if (atPost) {
            const inv = Object.entries(player.inventory || {}).filter(([id, q]) => q > 0 && MerchantHouses._good(id));
            if (inv.length) {
                html += `<select id="mh_store_${post.id}" style="${INPUT} width:110px;">${inv.map(([id, q]) => `<option value="${id}">${_esc(_label(id))} (${q})</option>`).join('')}</select>`;
                html += ` ×<input id="mh_storeQty_${post.id}" type="number" style="${INPUT}" value="10"> <button onclick="window._company.store('${post.id}')" style="${BTN_DARK}">📥 Store</button>`;
            }
            html += `<input id="mh_take_${post.id}" type="hidden" value="9999">`;
            MerchantHouses.candidates(player, world, ptile).forEach((f, i) => {
                html += `<button onclick="window._company.replaceFactor('${post.id}', ${i})" style="${BTN_DARK}" title="skill ${f.skill}, ${MerchantHouses.reference(f).label}">👤 Hire ${_esc(f.name)} (skill ${f.skill})</button>`;
            });
        }
        html += `<button onclick="window._company.audit('${post.id}')" style="${BTN_DARK}">🧾 Audit (${cfg.factor.auditCost}g)</button>`;
        html += `<button onclick="window._company.closePost('${post.id}')" style="${BTN_RED}">Close post</button></div>`;
        html += '</div>';
    }
    for (const v of c.convoys) {
        html += `<div style="font-size:11px; color:#bbb;">${v.mode === 'ship' ? '⛵' : '🐫'} ${v.qty} ${_esc(_label(v.good))}: ${_esc(v.from)} → ${_esc(v.to)}, due day ${v.arriveDay}</div>`;
    }
    return html;
}

function _companyContractsHtml(player, world) {
    const c = MerchantHouses.company(player);
    let html = `<div style="${HEAD}">Your Contracts</div>`;
    if (!c.contracts.length) html += '<div style="color:#888;">None in hand.</div>';
    for (const ct of c.contracts) {
        const left = ct.deadline - world.day;
        html += `<div style="${CARD}">${ct.icon} <b>${_esc(ct.title)}</b> <span style="color:#999;">for ${_esc(ct.issuer)}</span>`;
        html += `<div>${ct.delivered}/${ct.qty} ${_esc(_label(ct.good))} to <b>${_esc(ct.town)}</b> (${ct.q}, ${ct.r}) · ${MerchantHouses.contractUnitPay(world, ct)}g each · <span style="color:${left < 5 ? '#e08080' : '#ccc'};">${left} days left</span></div>`;
        for (const o of MerchantHouses.deliveryOptions(player, world, ct.id)) {
            html += `<button onclick="window._company.deliver('${ct.id}','${o.from}','${o.shipId || ''}')" style="${BTN_GOLD}">Deliver ${Math.min(o.qty, ct.qty - ct.delivered)} ${_esc(o.label)}</button>`;
        }
        html += '</div>';
    }
    html += `<div style="${HEAD}">The Board</div>`;
    const board = MerchantHouses.board(player);
    if (!board.length) html += '<div style="color:#888;">No contracts posted this week.</div>';
    for (const ct of board) {
        html += `<div style="${CARD}">${ct.icon} <b>${_esc(ct.title)}</b> <span style="color:#999;">— ${_esc(ct.text)}</span>`;
        html += `<div>${ct.qty} ${_esc(_label(ct.good))} to ${_esc(ct.town)} by day ${ct.deadline} · ${ct.pay}g each (${_g(ct.pay * ct.qty)}) · +${ct.reputation} rep</div>`;
        const can = MerchantHouses.canAcceptContract(player, ct);
        html += can.ok ? `<button onclick="window._company.accept('${ct.id}')" style="${BTN_GOLD}">Take the contract</button>` : `<div style="color:#999;">${_esc(can.reason)}</div>`;
        html += '</div>';
    }
    return html;
}

function _companyRivalsHtml(player, world) {
    let html = '';
    for (const r of MerchantHouses.rivals(player)) {
        const active = r.status === 'active';
        html += `<div style="${CARD}${active ? '' : ' opacity:0.55;'}">`;
        html += `<div style="display:flex; justify-content:space-between;"><div>${r.icon} <b>${_esc(r.name)}</b> <span style="color:#999;">(${_esc(r.temperament)})</span></div>`;
        html += `<div>${active ? `💰 ${_g(r.capital)} · ⭐ ${Math.round(r.reputation)}` : `<span style="color:#e08080;">${r.status}</span>`}</div></div>`;
        if (!active) { html += '</div>'; continue; }
        html += `<div style="font-size:11px; color:#bbb;">Trades ${_esc(r.specialty.join(', '))} · posts: ${_esc(r.posts.map(p => p.name).join(', '))} · last week ${r.lastProfit >= 0 ? '+' : ''}${_g(r.lastProfit)}</div>`;
        html += `<div style="font-size:11px;">Rivalry <span style="color:${r.rivalry >= 50 ? '#e08080' : '#ccc'};">${Math.round(r.rivalry)}</span> · share ${Math.round(MerchantHouses.sharePrice(r))}g · you hold <b>${r.shares.player}</b>/100</div>`;
        html += `<button onclick="window._company.buyShares('${r.id}', 5)" style="${BTN_DARK}">Buy 5 shares</button>`;
        html += `<button onclick="window._company.buyShares('${r.id}', 20)" style="${BTN_DARK}">Buy 20</button>`;
        if (r.shares.player > 0) html += `<button onclick="window._company.sellShares('${r.id}', ${r.shares.player})" style="${BTN_DARK}">Sell all</button>`;
        if (r.shares.player >= 51) html += `<button onclick="window._company.buyOut('${r.id}')" style="${BTN_GOLD}">Buy out (${_g(MerchantHouses.buyOutCost(player, r))})</button>`;
        html += ` <input id="mh_war_${r.id}" type="number" style="${INPUT}" value="${MerchantHouses.config().rivals.priceWar.minSpend}"><button onclick="window._company.priceWar('${r.id}')" style="${BTN_RED}">⚔️ Price war</button>`;
        html += '</div>';
    }
    const monos = [];
    for (const s of world.getSettlementViews ? world.getSettlementViews() : []) {
        for (const [g, m] of Object.entries(s.monopolies || {})) monos.push(`${_esc(s.name)}: ${_esc(_label(g))} — ${_esc(m.holderName || m.holder)}${m.untilDay ? ` (to day ${m.untilDay})` : ''}`);
    }
    if (monos.length) html += `<div style="${HEAD}">Monopolies</div><div style="font-size:11px; color:#bbb;">${monos.join('<br>')}</div>`;
    return html;
}

function _companyInvestmentsHtml(player, world) {
    const c = MerchantHouses.company(player);
    const m = MerchantHouses.state(player);
    let html = `<div style="${HEAD}">Royal Ventures</div>`;
    if (!m.ventures.length) html += '<div style="color:#888;">No crown is selling shares in a venture just now.</div>';
    for (const v of m.ventures) {
        html += `<div style="${CARD}">${v.icon} <b>${_esc(v.name)}</b> <span style="color:#999;">— ${_esc(v.kingdom)}, offers close day ${v.openUntil}</span>`;
        html += `<div style="font-size:11px; color:#bbb;">${_esc(v.text)} About ${v.days} days; ${Math.round(v.success * 100)}% odds; ×${v.returnMult[0]}–${v.returnMult[1]} if it comes home. Up to ${_g(v.maxStake)}.</div>`;
        html += `<input id="mh_stake_${v.id}" type="number" style="${INPUT}" value="${MerchantHouses.config().ventures.minStake}"> <button onclick="window._company.invest('${v.id}')" style="${BTN_GOLD}">Stake</button></div>`;
    }
    html += `<div style="${HEAD}">Your Stakes</div>`;
    if (!c.investments.ventures.length) html += '<div style="color:#888;">None.</div>';
    for (const s of c.investments.ventures) html += `<div>${s.icon} ${_esc(s.name)} — ${_g(s.stake)}, due home about day ${s.resolveDay}</div>`;
    const held = MerchantHouses.activeRivals(player).filter(r => r.shares.player > 0);
    html += `<div style="${HEAD}">Shares in Other Houses</div>`;
    if (!held.length) html += '<div style="color:#888;">None (buy them on the Rivals tab).</div>';
    for (const r of held) html += `<div>${r.icon} ${_esc(r.name)}: ${r.shares.player} shares ≈ ${_g(r.shares.player * MerchantHouses.sharePrice(r))}</div>`;
    return html;
}
