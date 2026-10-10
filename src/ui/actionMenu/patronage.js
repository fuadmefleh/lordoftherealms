// ActionMenu — Patronage & Great Works: clients (hire from a town's salon,
// commission works, answer rival offers), Great Works (break ground, deliver
// each stage's goods and gold, follow the labour), the gallery (donate works)
// and the wonders of the world (the kingdoms' race). Logic lives in
// systems/patronage.js; this panel presents it. Buttons route through
// data-am-act → ActionMenu.patronageAct.
import { ActionMenu } from './_ref.js';
import { Patronage } from '../../systems/patronage.js';
import { Fashions } from '../../world/fashions.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, BTN_RED, CARD, panelTabs } from './uiKit.js';

const TABS = [['clients', '🎨 Clients'], ['works', '🏗️ Great Works'], ['gallery', '🖼️ Gallery'], ['world', '🌍 Wonders'], ['fashion', '👗 Fashion at Court']];

let _tab = 'clients';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin-top:3px;"><div style="width:${pct}%; height:100%; background:${color};"></div></div>`;
}

/** A button routed to ActionMenu.patronageAct(game, ...args). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="patronageAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function profName(id) {
    const p = Patronage.professions()[id];
    return p ? `${p.icon} ${p.name}` : id;
}

function clientCard(player, world, c, offers) {
    const D = Patronage.data();
    const tmp = (D.temperaments || {})[c.temperament] || {};
    const amb = (D.ambitions || {})[c.ambition] || {};
    const contentColor = c.content >= 60 ? '#7fd07f' : c.content >= 30 ? '#e8a040' : '#e74c3c';
    let html = `<div style="${CARD}">`;
    html += `<div style="display:flex; justify-content:space-between; gap:6px;"><b>${esc(c.name)}</b><span style="color:#aaa; font-size:11px;">${profName(c.profession)} · skill ${Math.floor(c.skill)} · ${c.stipend}g/week · ${c.worksDone || 0} work(s)</span></div>`;
    html += `<div style="font-size:11px; color:#bbb;">${esc(tmp.name || c.temperament)} (${esc(tmp.blurb || '')}) · wants ${esc((amb.name || c.ambition).toLowerCase())}: ${esc(amb.blurb || '')}</div>`;
    html += `<div style="font-size:11px;">Content <b style="color:${contentColor};">${Math.round(c.content)}</b>${c.unpaidWeeks ? ` · <span style="color:#e74c3c;">unpaid ${c.unpaidWeeks} week(s)</span>` : ''}${bar(c.content, 100, contentColor)}</div>`;
    const offer = offers.find(o => o.clientId === c.id);
    if (offer) {
        html += `<div style="color:#e8a040; font-size:11px; margin-top:4px;">🎭 ${esc(offer.rivalName)} courts ${esc(c.name)}: ${Math.max(0, offer.dueDay - world.day)} day(s) to answer.</div>`;
        html += act(`Match it (${offer.counter}g)`, ['offer', c.id, 'match'], BTN_GOLD, player.gold >= offer.counter);
        html += act('Let them go', ['offer', c.id, 'release'], BTN_RED);
    }
    if (c.task) {
        const w = Patronage.works()[c.task.workId] || {};
        html += `<div style="margin-top:4px;">${w.icon || ''} At work on a ${esc((w.name || '').toLowerCase())}: ${Math.max(0, Math.ceil(c.task.days - c.task.progress))} day(s) left${bar(c.task.progress, c.task.days, 'var(--gold)')}</div>`;
    } else if (c.assignedTo) {
        const p = Patronage.project(player, c.assignedTo);
        html += `<div style="margin-top:4px;">📐 Overseeing the ${esc(p ? Patronage.greatWork(p.workId).name : 'works')}${p ? ` at ${esc(p.name)}` : ''}.</div>`;
        html += act('Recall', ['assign', c.id, null], BTN_PLAIN);
    } else {
        html += `<div style="margin-top:4px; color:#e0b040; font-size:11px;">Idle ${c.idleDays || 0} day(s).</div>`;
        for (const workId of (Patronage.professions()[c.profession] || {}).works || []) {
            const w = Patronage.works()[workId];
            const quote = Patronage.quote(player, w.materials);
            const mats = quote.lines.map(l => `${l.need} ${l.id}${l.missing ? ` (${l.missing} bought)` : ''}`).join(', ');
            const days = Patronage.workDays(c, workId);
            html += act(`${w.icon} Commission a ${w.name.toLowerCase()} · ~${days}d${quote.buyCost ? ` · ${quote.buyCost}g` : ''}`, ['commission', c.id, workId], BTN_GOLD, player.gold >= quote.buyCost, mats);
        }
        if (c.profession === 'architect') {
            for (const p of Patronage.state(player).projects) {
                html += act(`📐 Oversee the ${Patronage.greatWork(p.workId).name} at ${p.name}`, ['assign', c.id, p.id], BTN_GOLD);
            }
        }
    }
    html += `<div>${act('Raise stipend (+20%)', ['raise', c.id], BTN_PLAIN)}${act('Dismiss', ['dismiss', c.id], BTN_RED)}</div>`;
    html += '</div>';
    return html;
}

function clientsTab(player, world, tile) {
    const st = Patronage.state(player);
    let html = '';
    if (!st.clients.length) html += '<div style="color:#aaa;">No one is in your service. Towns keep salons where artists, scholars, architects, physicians and chroniclers seek a patron.</div>';
    for (const c of st.clients) html += clientCard(player, world, c, st.offers);
    const salon = Patronage.salon(player, world, tile);
    if (tile && tile.settlement) {
        html += `<h5 style="margin:10px 0 4px;">🏛️ The salon of ${esc(tile.settlement.name)}</h5>`;
        if (!Patronage.hasSalon(tile)) html += '<div style="color:#999; font-size:11px;">Too small a place for a salon: try a town or a capital.</div>';
        else if (!salon.length) html += '<div style="color:#999; font-size:11px;">No one new this month.</div>';
        const full = st.clients.length >= Patronage.maxClients(player);
        for (const cand of salon) {
            const D = Patronage.data();
            const tmp = (D.temperaments || {})[cand.temperament] || {};
            const amb = (D.ambitions || {})[cand.ambition] || {};
            const fee = Patronage.hireFee(cand);
            html += `<div style="${CARD} padding:6px 8px;"><b>${esc(cand.name)}</b> <small style="color:#aaa;">${profName(cand.profession)} · skill ${cand.skill} · ${esc(tmp.name || '')} · wants ${esc((amb.name || '').toLowerCase())} · ${cand.stipend}g/week</small>`;
            html += `<div style="font-size:11px; color:#9fd59f;">${esc((Patronage.professions()[cand.profession] || {}).blurb || '')}</div>`;
            html += act(`Take into service (${fee}g)`, ['hire', cand.id], BTN_GOLD, !full && player.gold >= fee, full ? 'You keep as many clients as you can.' : '');
            html += '</div>';
        }
    }
    return html;
}

/** Set the court's fashion (systems/patronage.js setFashion → world/fashions.js). */
function fashionTab(player, world, tile) {
    const P = Fashions.config().playerSet;
    let html = `<div style="font-size:11px; color:#bbb;">A patron with standing at a royal court can set its fashion for a season: feasts, gifts and commissions that make the nobles and merchants want silks, spiced wine or jewels. It spreads from the capital to the towns around, and whoever has the goods sells them dear. It costs ${P.prestige} House Prestige and ${P.gold} gold (half with an artist or architect in your pay), needs standing ${P.minReputation} at that court (or its crown), and the court tolerates one of yours every ${P.cooldown} days.</div>`;
    const running = Fashions.active(world);
    if (running.length) {
        html += '<h5 style="margin:10px 0 4px;">In fashion now</h5>';
        for (const f of running) {
            const def = Fashions.def(f.id) || {};
            html += `<div style="font-size:11px;">${def.icon || '👗'} <b>${esc(def.name || f.id)}</b> from ${esc(f.place)}${f.by === 'player' ? ' (yours)' : ''}: ${Fashions.stage(f, world.day)}, ${Fashions.daysLeft(f, world.day)} days left</div>`;
        }
    }
    html += '<h5 style="margin:10px 0 4px;">Set a fashion here</h5>';
    for (const def of Fashions.config().list) {
        const q = Patronage.fashionQuote(player, world, tile, def.id);
        const goods = Fashions.goods({ id: def.id }).map(g => `${g.icon} ${g.name}${g.mult < 1 ? ' (less)' : ''}`).join(', ');
        html += `<div style="${CARD} padding:6px 8px;"><b>${def.icon || '👗'} ${esc(def.name)}</b> <small style="color:#aaa;">${esc(def.text || '')}</small>`;
        html += `<div style="font-size:11px; color:#9fd59f;">${esc(goods)}</div>`;
        html += act(`Set it (${q.prestige || P.prestige} Prestige, ${q.gold || P.gold}g)`, ['fashion', def.id], BTN_GOLD, q.ok, q.ok ? '' : q.reason);
        if (!q.ok && q.reason) html += `<div style="font-size:11px; color:#e0b040;">${esc(q.reason)}</div>`;
        html += '</div>';
    }
    return html;
}

function projectCard(player, world, p) {
    const def = Patronage.greatWork(p.workId);
    const stage = Patronage.stageDef(p) || {};
    let html = `<div style="${CARD}">`;
    html += `<div style="display:flex; justify-content:space-between;"><b>${def.icon} ${esc(def.name)}</b><span style="color:#aaa; font-size:11px;">${esc(p.name)} · stage ${p.stage + 1}/${def.stages.length}: ${esc(stage.name || '')}</span></div>`;
    if (p.status === 'supplying') {
        const present = player.q === p.q && player.r === p.r;
        const needs = Patronage.stageNeeds(player, p, present);
        const lines = needs.goods.map(g => `${g.delivered}/${g.need} ${g.id}${g.missing ? (g.have ? ` <span style="color:#9fd59f;">(${g.have} in your packs)</span>` : '') : ' ✓'}`).join(' · ');
        const buyCost = needs.goods.reduce((s, g) => s + Math.max(0, g.missing - g.have) * g.price, 0);
        html += `<div style="font-size:11px; margin-top:4px;">Wants: ${lines || 'no goods'} · ${needs.goldPaid ? 'gold paid ✓' : `${needs.gold}g for the masons`}</div>`;
        html += `<div style="font-size:10px; color:#999;">Then ${needs.days} days of labour at ${needs.labour}g a day.${present ? '' : ' Goods in your packs can only be delivered on site; anything else is bought for you at a markup.'}</div>`;
        const hasGoods = needs.goods.some(g => g.have > 0);
        html += act('Deliver from your packs', ['deliver', p.id, false], BTN_PLAIN, hasGoods || (!needs.goldPaid && player.gold >= needs.gold));
        html += act(`Buy the rest and deliver (${buyCost}g${needs.goldPaid ? '' : ` + ${needs.gold}g`})`, ['deliver', p.id, true], BTN_GOLD, player.gold >= buyCost + (needs.goldPaid ? 0 : needs.gold));
    } else {
        const cond = Patronage.conditions(player, world, p);
        html += `<div style="font-size:11px; margin-top:4px;">${Math.floor(p.progress)}/${stage.days} days of labour · ${stage.labour}g a day${bar(p.progress, stage.days, 'var(--gold)')}</div>`;
        if (cond.stall) html += `<div style="color:#e8a040; font-size:11px;">⏸️ Work stands still: ${esc(Patronage.STALL_TEXT[cond.stall])}.</div>`;
        else html += `<div style="color:#9fd59f; font-size:11px;">Pace ×${cond.speed.toFixed(2)}${cond.notes.length ? ` (${esc(cond.notes.join(', '))})` : ''}</div>`;
    }
    const arch = p.architectId ? Patronage.client(player, p.architectId) : null;
    html += `<div style="font-size:11px; color:#bbb;">${arch ? `📐 ${esc(arch.name)} oversees the works.` : 'No architect: one of yours would speed the labour.'}</div>`;
    html += `<div style="font-size:10px; color:#999;">Grants: ${esc(Patronage.effectText(def.effects))} · +${def.prestige} Prestige${def.unique ? ' · <b style="color:#e0b040;">unique in the world</b>' : ''}</div>`;
    if (def.unique) {
        for (const n of Patronage.race(world, p.workId)) {
            html += `<div style="color:#e8a040; font-size:11px;">⏳ ${esc(n.kingdom ? n.kingdom.name : 'A realm')} raises its own: ${Math.round(n.share * 100)}% built.</div>`;
        }
    }
    html += act('Abandon', ['abandon', p.id], BTN_RED);
    html += '</div>';
    return html;
}

function worksTab(player, world, tile) {
    const st = Patronage.state(player);
    let html = '';
    for (const p of st.projects) html += projectCard(player, world, p);
    const mine = Patronage.playerBuilt(world);
    if (mine.length) {
        html += '<h5 style="margin:10px 0 4px;">🏛️ Your Great Works</h5>';
        for (const b of mine) {
            const def = Patronage.greatWork(b.workId) || {};
            const held = !!Patronage.siteAt(player, world, b.q, b.r);
            html += `<div style="font-size:12px;">${b.icon} <b>${esc(b.name)}</b> at ${esc(b.settlementName)} (day ${b.day}): ${held ? `<span style="color:#9fd59f;">${esc(Patronage.effectText(def.effects))}</span>` : '<span style="color:#e74c3c;">the town is no longer yours, and its gifts with it</span>'}</div>`;
        }
    }
    const site = tile ? Patronage.siteAt(player, world, tile.q, tile.r) : null;
    html += '<h5 style="margin:10px 0 4px;">🧱 Break ground</h5>';
    if (!site) {
        const sites = Patronage.sites(player, world);
        html += `<div style="color:#999; font-size:11px;">Great Works rise in a town you rule or keep a house in${sites.length ? `: ${sites.map(s => esc(s.settlement.name)).join(', ')}` : '. You have none yet.'}</div>`;
        return html;
    }
    for (const [id, def] of Object.entries(Patronage.greatWorks())) {
        const can = Patronage.canFound(player, world, tile.q, tile.r, id);
        if (!can.ok && /already raised one|Already under construction/.test(can.reason || '')) continue;
        const gold = def.stages.reduce((s, x) => s + x.gold, 0);
        const days = def.stages.reduce((s, x) => s + x.days, 0);
        html += `<div style="${CARD} padding:6px 8px;"><div style="display:flex; justify-content:space-between;"><b>${def.icon} ${esc(def.name)}</b><span style="color:#aaa; font-size:11px;">${def.stages.length} stages · ~${days} days · ${gold}g + goods + wages</span></div>`;
        html += `<div style="font-size:11px; color:#bbb;">${esc(def.blurb || '')}</div>`;
        html += `<div style="font-size:11px; color:#9fd59f;">${esc(Patronage.effectText(def.effects))} · +${def.prestige} Prestige${def.unique ? ' · unique: first to finish claims it' : ''}</div>`;
        html += act(can.ok ? 'Break ground' : esc(can.reason), ['found', id], BTN_GOLD, can.ok);
        html += '</div>';
    }
    return html;
}

function galleryTab(player, world, tile) {
    const st = Patronage.state(player);
    if (!st.gallery.length && !st.works.length) return '<div style="color:#aaa;">Your clients have made nothing yet.</div>';
    let html = '';
    const kept = st.gallery.filter(g => !g.donatedTo);
    if (kept.length) {
        html += `<h5 style="margin:6px 0 4px;">In your gallery</h5><div style="font-size:10px; color:#999;">Donate a work to the town you stand in: a town you rule grows happier; elsewhere its realm thinks better of you.</div>`;
        for (const g of kept) {
            const w = Patronage.works()[g.kind] || {};
            html += `<div style="${CARD} padding:6px 8px;">${w.icon || '🖼️'} <b>"${esc(g.title)}"</b> <small style="color:#aaa;">${esc(g.by)}, ${g.quality}, day ${g.day}</small><br>`;
            html += act(tile && tile.settlement ? `Donate to ${tile.settlement.name}` : 'Donate (stand in a town)', ['donate', g.uid], BTN_GOLD, !!(tile && tile.settlement));
            html += '</div>';
        }
    }
    const recent = st.works.slice(-12).reverse();
    if (recent.length) {
        html += '<h5 style="margin:10px 0 4px;">Commissions</h5><div style="font-size:11px; color:#bbb;">';
        for (const r of recent) {
            const w = Patronage.works()[r.kind] || {};
            const donated = (st.gallery.find(g => g.uid === r.uid) || {}).donatedTo;
            html += `<div>${w.icon || ''} "${esc(r.title)}" by ${esc(r.by)} (${r.quality}, day ${r.day})${donated ? ` · hangs in ${esc(donated.name)}` : ''}</div>`;
        }
        html += '</div>';
    }
    return html;
}

function worldTab(player, world) {
    let html = '<div style="font-size:11px; color:#999;">Kingdoms raise wonders at their capitals out of their treasuries. A unique work belongs to whoever finishes it first.</div>';
    const built = Patronage.built(world);
    html += '<h5 style="margin:10px 0 4px;">Standing</h5>';
    if (!built.length) html += '<div style="color:#aaa;">No wonder stands yet.</div>';
    for (const b of built) {
        const k = b.kingdomId != null && world.getKingdom ? world.getKingdom(b.kingdomId) : null;
        html += `<div style="font-size:12px;">${b.icon} <b>${esc(b.name)}</b> at ${esc(b.settlementName)} · ${b.owner === 'player' ? 'yours' : esc(k ? k.name : 'a realm')} · day ${b.day}</div>`;
    }
    const rising = Patronage.npcProjects(world);
    if (rising.length) {
        html += '<h5 style="margin:10px 0 4px;">Rising</h5>';
        for (const n of rising) {
            const def = Patronage.greatWork(n.workId) || {};
            const k = world.getKingdom ? world.getKingdom(n.kingdomId) : null;
            html += `<div style="font-size:12px;">${def.icon || '🏗️'} ${esc(def.name)} · ${esc(k ? k.name : 'a realm')} · ${Math.round(100 * n.progress / Math.max(1, n.days))}% built${def.unique ? ' · <span style="color:#e0b040;">unique</span>' : ''}${bar(n.progress, n.days, '#8a7dd8')}</div>`;
        }
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The Patronage & Great Works panel (from a town, the Counsel, or anywhere). */
    showPatronage(game, tile = null) {
        const player = game.player;
        const world = game.world;
        const here = tile || world.getTile(player.q, player.r);
        const s = Patronage.summary(player, world);
        let html = '<div style="font-size:12px;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">Clients <b>${s.clients}/${s.max}</b> · stipends ${s.weekly}g a week · Great Works rising ${s.projects}, raised ${s.built} · ${s.spent}g spent on patronage · gold ${Math.floor(player.gold)}</p>`;
        html += panelTabs(game, {
            id: 'patronage', title: '🎨 Patronage & Great Works', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showPatronage(game, here); },
            attrsFor: (k) => `data-am-act="patronageAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (_tab === 'works') html += worksTab(player, world, here);
        else if (_tab === 'gallery') html += galleryTab(player, world, here);
        else if (_tab === 'world') html += worldTab(player, world);
        else if (_tab === 'fashion') html += fashionTab(player, world, here);
        else html += clientsTab(player, world, here);
        html += '</div>';
        game.ui.showCustomPanel('🎨 Patronage & Great Works', html);
    },

    /** Every button on the panel: op + its arguments. */
    patronageAct(game, op, a = null, b = null) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(player.q, player.r);
        let res = null;
        let title = '🎨 Patronage';
        switch (op) {
            case 'tab': _tab = a || 'clients'; break;
            case 'hire': res = Patronage.hire(player, world, tile, a); break;
            case 'dismiss': res = Patronage.dismiss(player, world, a); break;
            case 'raise': res = Patronage.raise(player, world, a); break;
            case 'commission': res = Patronage.commission(player, world, a, b); break;
            case 'assign': res = Patronage.assignArchitect(player, world, a, b); break;
            case 'offer': res = Patronage.answerOffer(player, world, a, b); break;
            case 'donate': res = Patronage.donate(player, world, tile, a); title = '🖼️ Donation'; break;
            case 'found': res = Patronage.found(player, world, tile.q, tile.r, a); title = '🏗️ Great Work'; break;
            case 'deliver': res = Patronage.deliver(player, world, a, { buyMissing: !!b }); title = '🧱 Delivery'; break;
            case 'abandon': res = Patronage.abandon(player, world, a); title = '🏗️ Great Work'; break;
            case 'fashion': res = Patronage.setFashion(player, world, tile, a); title = '👗 The Fashion at Court'; break;
            default: return;
        }
        if (res) {
            game.ui.showNotification(title, res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            if (res.success && op === 'found') _tab = 'works';
            game.ui.updateStats(player, world);
        }
        ActionMenu.showPatronage(game, tile);
    },
});
