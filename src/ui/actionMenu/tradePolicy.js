// ActionMenu — Trade Policy: the crowns' tariffs, export bans, embargoes,
// treaties, trade wars and granaries (opened from the trade window, the Royal
// Court and the Counsel). Three tabs: the realm you stand in (its duties on
// each kind of goods, what it means for the goods you carry, smuggling past
// an embargo, a licence from its crown), every realm at a glance (with a
// treaty to broker between two of them), and — for a ruler — the crown's own
// policy. Logic lives in systems/tradePolicy.js; buttons route through
// data-am-act → ActionMenu.tradePolicyAct.
import { ActionMenu } from './_ref.js';
import { TradePolicy } from '../../systems/tradePolicy.js';
import { Throne } from '../../systems/throne.js';
import { BTN_GOLD, BTN_DIM, BTN_PLAIN, BTN_RED, CARD, panelTabs } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const TABS = [['here', '📍 This realm'], ['realms', '🗺️ All realms'], ['crown', '👑 Your crown']];

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pct = (v) => `${Math.round(v * 100)}%`;
const goodName = (id) => esc(String(id).replace(/_/g, ' '));

/** A button routed to ActionMenu.tradePolicyAct(game, ...args). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="tradePolicyAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/** One line on a realm's policy (for the trade window and the panels). */
export function policyLine(world, kingdom) {
    if (!kingdom) return '';
    const s = TradePolicy.summary(world, kingdom);
    const parts = [`${s.stance.icon} ${esc(s.stance.label)}`, `imports ${pct(s.avgImport)} on average`];
    const bans = s.cats.filter(c => c.banned);
    if (bans.length) parts.push(`<span style="color:#e67e22;">no ${bans.map(c => esc(c.label.toLowerCase())).join(', ')} may leave</span>`);
    if (s.embargo.length) parts.push(`<span style="color:#e74c3c;">embargo on ${s.embargo.map(e => esc(e.name)).join(', ')}</span>`);
    if (s.treaties.length) parts.push(`<span style="color:#2ecc71;">treaty with ${s.treaties.map(e => esc(e.name)).join(', ')}</span>`);
    if (s.retal.length) parts.push(`<span style="color:#e8a040;">trade war with ${s.retal.map(e => esc(e.name)).join(', ')}</span>`);
    if (s.crisis) parts.push('<span style="color:#e8a040;">treasury in crisis</span>');
    return parts.join(' · ');
}

function tariffTable(s, controls = null) {
    let html = '<div style="display:grid; grid-template-columns: 1fr 70px 70px auto; gap:4px 8px; align-items:center; margin-top:4px;">';
    html += `<span style="${NOTE}">Goods</span><span style="${NOTE}">Import</span><span style="${NOTE}">Export</span><span></span>`;
    for (const c of s.cats) {
        html += `<span>${c.icon} ${esc(c.label)}${c.lobby ? ` <small style="color:#b9a0e0;" title="Guilds lobby the crown to protect these goods">⚒️${c.lobby}</small>` : ''}</span>`;
        html += `<span>${pct(c.imp)}</span><span>${c.banned ? '<b style="color:#e67e22;">banned</b>' : pct(c.exp)}</span>`;
        html += `<span>${controls ? controls(c) : ''}</span>`;
    }
    return html + '</div>';
}

function hereTab(game) {
    const { player, world } = game;
    const tile = world.getTile(player.q, player.r);
    const s = tile && tile.settlement;
    const k = s && s.kingdom != null ? world.getKingdom(s.kingdom) : null;
    if (!k || k.isAlive === false) return `<div style="${NOTE}">No crown's customs men stand here: ${s ? `${esc(s.name)} is a free town` : 'you are out in the wilds'}. Goods change hands without duty.</div>`;
    const sum = TradePolicy.summary(world, k);
    let html = `<div style="${CARD}"><b>${esc(k.name)}</b> · ${policyLine(world, k)}`;
    html += tariffTable(sum);
    html += `<div style="${NOTE} margin-top:6px;">Duties raise the price of what crosses the border: less comes in, and the market here pays more for it. Caravans pay the import duty on their cargo as their toll. You pay it selling goods you bought in another realm.</div></div>`;
    // ── The goods you carry ──
    const rows = [];
    for (const [id, qty] of Object.entries(player.inventory || {})) {
        if (!(qty > 0) || id === 'gold') continue;
        const n = TradePolicy.goodNotice(player, world, s, id);
        if (!n || (!n.foreign && !n.banned)) continue;
        const bits = [];
        if (n.embargoed) {
            const sq = TradePolicy.smuggleQuote(player, world, tile, id);
            bits.push(`<span style="color:#e74c3c;">${n.embargoed} under embargo here</span>${sq.ok ? ` · ${sq.price}g each, ~${pct(sq.chance)} risk ${act('🕶️ Smuggle', ['smuggle', id], BTN_RED, (player.actionPoints || 0) >= 1, 'Run them past the watch (1 AP): a premium if it works; caught, the goods are taken, a fine, heat and maybe the cells')}` : ''}`);
        }
        if (n.foreign - n.embargoed > 0) bits.push(`${n.foreign - n.embargoed} bought abroad pay ${pct(n.dutyRate)} duty here`);
        if (n.banned) bits.push(`<span style="color:#e67e22;">${esc(k.name)} bans its export</span>`);
        rows.push(`${goodName(id)} (${qty}): ${bits.join(' · ')}`);
    }
    html += `<div style="${CARD}"><b>Your goods</b><div style="${NOTE}">${rows.length ? rows.join('<br>') : 'Nothing you carry pays duty or breaks a ban here.'}</div></div>`;
    // ── A licence ──
    const lq = TradePolicy.licenceQuote(player, world, k.id);
    const until = TradePolicy.hasLicence(player, world, k.id) ? TradePolicy.playerState(player).licences[k.id] : null;
    html += `<div style="${CARD}"><b>📜 A licence from the crown</b><div style="${NOTE}">A licensed merchant pays none of ${esc(k.name)}'s duties and may carry its goods out despite its export bans.${until ? ` <b style="color:#2ecc71;">Yours runs to day ${until}.</b>` : ''}</div>`;
    html += lq.ok ? act(`${until ? 'Extend' : 'Petition'} (${lq.cost}g, ${lq.days} days)`, ['licence', k.id], BTN_GOLD, (player.gold || 0) >= lq.cost) : `<div style="${NOTE}">${esc(lq.reason)}</div>`;
    html += '</div>';
    return html;
}

function realmsTab(game, pick = null) {
    const { player, world } = game;
    const alive = (world.kingdoms || []).filter(k => k && k.isAlive !== false);
    let html = '';
    for (const k of alive) {
        const s = TradePolicy.summary(world, k);
        const rev = s.revenue ? Math.round(s.revenue.last) : 0;
        html += `<div style="${CARD}"><b>${esc(k.name)}</b> <small style="color:#999;">${rev ? `customs ${rev}g last week` : ''}${s.granary && s.granary.grain >= 1 ? ` · granary ${Math.round(s.granary.grain)} grain` : ''}</small><div style="${NOTE}">${policyLine(world, k)}</div>`;
        if (pick && pick !== k.id) {
            const q = TradePolicy.brokerQuote(player, world, pick, k.id);
            html += q.ok ? act(`🤝 Broker a treaty with ${esc((world.getKingdom(pick) || {}).name)} (${q.cost}g)`, ['broker', pick, k.id]) : `<div style="${NOTE}">${esc(q.reason)}</div>`;
        } else if (!pick) {
            html += act('🤝 Broker a treaty…', ['pick', k.id], BTN_PLAIN, true, 'Bring this realm and another to sign a trade treaty: gifts to both courts, prestige for your House');
        }
        html += '</div>';
    }
    const news = TradePolicy.recent(world, 60).slice(0, 6);
    if (news.length) {
        const words = { embargo: 'embargoes', embargo_lifted: 'lifts its embargo on', treaty: 'signs a trade treaty with', treaty_broken: 'ends its treaty with', trade_war: 'raises duties against', trade_peace: 'eases its duties on', ban: 'bans the export of', ban_lifted: 'allows the export of', granary: 'opens its granaries' };
        html += `<div style="${CARD}"><b>Word on the roads</b><div style="${NOTE}">${news.map(n => `Day ${n.day}: ${esc(n.kingdom)} ${words[n.kind] || n.kind} ${esc(n.otherName || (n.good ? String(n.good).toLowerCase() : ''))}`).join('<br>')}</div></div>`;
    }
    return html;
}

function crownTab(game) {
    const { player, world } = game;
    const k = Throne.ruledKingdom(player, world);
    if (!k) return `<div style="${NOTE}">You wear no crown. Those who do set the duties, bans and embargoes you trade under.</div>`;
    const s = TradePolicy.summary(world, k);
    const levels = TradePolicy.config().ruler.levels;
    let html = `<div style="${CARD}"><b>👑 The trade of ${esc(k.name)}</b><div style="${NOTE}">${policyLine(world, k)}</div>`;
    html += `<div style="${NOTE}">Customs: ${Math.round(s.revenue ? s.revenue.last : 0)}g last week, ${Math.round(s.revenue ? s.revenue.total : 0)}g in all. Cut duties and the Guild Coalition cheers; raise them on goods your guilds make (⚒️) and they cheer louder — but your neighbours answer duty with duty.</div>`;
    html += tariffTable(s, (c) => {
        const step = (side, dir) => {
            const cur = side === 'imp' ? c.imp : c.exp;
            const i = levels.reduce((b, l, j) => (Math.abs(l - cur) < Math.abs(levels[b] - cur) ? j : b), 0);
            const to = levels[Math.max(0, Math.min(levels.length - 1, i + dir))];
            return act(`${side === 'imp' ? 'In' : 'Out'}${dir > 0 ? '+' : '−'}`, ['tariff', side, c.id, to], BTN_PLAIN, to !== cur);
        };
        return step('imp', 1) + step('imp', -1) + step('exp', 1) + step('exp', -1) + act(c.banned ? 'Allow out' : 'Ban out', ['ban', c.id], c.banned ? BTN_PLAIN : BTN_RED);
    });
    html += '</div>';
    // ── Neighbours ──
    html += `<div style="${CARD}"><b>Neighbours</b>`;
    for (const o of (world.kingdoms || []).filter(x => x && x !== k && x.isAlive !== false)) {
        const embargo = !!(k.tradePolicy && k.tradePolicy.embargo && k.tradePolicy.embargo[o.id]);
        const treaty = TradePolicy.hasTreaty(k, o);
        const rel = Math.round((o.relations && o.relations[k.id]) || 0);
        const theirs = TradePolicy.avgImport(o, k.id);
        html += `<div style="margin-top:6px;">${esc(o.name)} <small style="color:#999;">relations ${rel} · their duty on your goods ${pct(theirs)}</small><br>`;
        html += embargo ? act('Lift embargo', ['embargo', o.id, false], BTN_PLAIN) : act('⛔ Embargo', ['embargo', o.id, true], BTN_RED);
        if (treaty) html += act('End treaty', ['cancelTreaty', o.id], BTN_PLAIN);
        else {
            const q = TradePolicy.treatyQuote(player, world, o.id);
            html += act('🤝 Propose treaty', ['treaty', o.id], BTN_GOLD, q.ok, q.ok ? '' : q.reason);
        }
        html += '</div>';
    }
    html += '</div>';
    // ── The granary ──
    const g = s.granary || {};
    html += `<div style="${CARD}"><b>🌾 The royal granaries</b><div style="${NOTE}">${Math.round(g.grain || 0)} grain in store · bought ${Math.round(g.bought || 0)} for ${Math.round(g.spent || 0)}g · released ${Math.round(g.released || 0)} to hungry towns. The granaries buy grain where it is cheap and feed the towns that go hungry.</div>`;
    html += act(g.on ? 'Stop buying' : 'Fill the granaries', ['granary', !g.on], g.on ? BTN_PLAIN : BTN_GOLD);
    html += '</div>';
    return html;
}

Object.assign(ActionMenu, {
    /** The Trade Policy panel: `tab` is 'here', 'realms' or 'crown'; `pick` a realm chosen to broker a treaty for. */
    showTradePolicy(game, tab = null, pick = null) {
        const ruler = !!Throne.ruledKingdom(game.player, game.world);
        const t = tab || (ruler ? 'crown' : 'here');
        let html = '<div style="font-size:12px;">';
        html += panelTabs(game, {
            id: 'tradePolicy', title: '⚖️ Trade Policy', tabs: TABS.filter(([id]) => id !== 'crown' || ruler), active: t,
            go: (k) => { ActionMenu.showTradePolicy(game, k); },
            attrsFor: (k) => `data-am-act="showTradePolicy" data-am-args='${esc(JSON.stringify([k]))}'`,
        });
        html += t === 'realms' ? realmsTab(game, pick) : t === 'crown' ? crownTab(game) : hereTab(game);
        html += '</div>';
        game.ui.showCustomPanel('⚖️ Trade Policy', html);
    },

    /** Every button on the panel: op + its arguments. */
    tradePolicyAct(game, op, a = null, b = null, c = null) {
        const { player, world } = game;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        let tab = 'here';
        switch (op) {
            case 'pick': ActionMenu.showTradePolicy(game, 'realms', a); return;
            case 'smuggle': res = TradePolicy.smuggle(player, world, tile, a); break;
            case 'licence': res = TradePolicy.petitionLicence(player, world, a); break;
            case 'broker': res = TradePolicy.brokerTreaty(player, world, a, b); tab = 'realms'; break;
            case 'tariff': res = TradePolicy.setTariff(player, world, a, b, c); tab = 'crown'; break;
            case 'ban': res = TradePolicy.toggleBan(player, world, a); tab = 'crown'; break;
            case 'embargo': res = TradePolicy.setEmbargo(player, world, a, b); tab = 'crown'; break;
            case 'treaty': res = TradePolicy.proposeTreaty(player, world, a); tab = 'crown'; break;
            case 'cancelTreaty': res = TradePolicy.cancelTreaty(player, world, a); tab = 'crown'; break;
            case 'granary': res = TradePolicy.setGranary(player, world, a); tab = 'crown'; break;
            default: return;
        }
        if (res) {
            const text = res.text || res.message || (res.success ? 'Done.' : res.reason || 'Not possible.');
            const bad = !res.success || res.caught;
            game.ui.showNotification('⚖️ Trade Policy', text, bad ? 'error' : 'success');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showTradePolicy(game, tab);
    },
});
