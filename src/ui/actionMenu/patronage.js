// ActionMenu — Patronage & Great Works: clients (hire from a town's salon,
// commission works, answer rival offers), Great Works (break ground, deliver
// each stage's goods and gold, follow the labour), the gallery (donate works)
// and the wonders of the world (the kingdoms' race). Logic lives in
// systems/patronage.js; this panel presents it in the action menu's voice
// (ui/actionMenu/uiKit.js). Buttons and rows route through
// data-am-act → ActionMenu.patronageAct.
import { ActionMenu } from './_ref.js';
import { Patronage } from '../../systems/patronage.js';
import { Fashions } from '../../world/fashions.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, BTN_RED, panelTabs, chips, purse, sectionHead, card, actRow, rowList, price } from './uiKit.js';

const TABS = [['clients', '🎨 Clients'], ['works', '🏗️ Great Works'], ['gallery', '🖼️ Gallery'], ['world', '🌍 Wonders'], ['fashion', '👗 Fashion at Court']];
const MUTED = 'font-size:11px; color:#9d937c;';

let _tab = 'clients';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** A thin progress bar; spans (display:block) so it can sit inside a row's text. */
function bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<span style="display:block; height:5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; margin-top:3px;"><span style="display:block; width:${pct}%; height:100%; background:${color};"></span></span>`;
}

/** A button routed to ActionMenu.patronageAct(game, ...args). */
function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_OFF}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="patronageAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/**
 * A row routed to ActionMenu.patronageAct(game, ...args). When not `ok` it is
 * greyed, keeps its description and adds `why` under it in the warm red-brown.
 */
function row(o, args, ok = true) {
    const note = !ok && o.why ? [o.note, `<span style="color:#c98a6a;">${o.why}</span>`].filter(Boolean).join('<br>') : o.note;
    return actRow({ ...o, why: '', note, act: 'patronageAct', args, off: !ok });
}

function profName(id) {
    const p = Patronage.professions()[id];
    return p ? `${p.icon} ${p.name}` : id;
}

function clientCard(player, world, c, offers) {
    const D = Patronage.data();
    const tmp = (D.temperaments || {})[c.temperament] || {};
    const amb = (D.ambitions || {})[c.ambition] || {};
    const contentColor = c.content >= 60 ? '#8fd18a' : c.content >= 30 ? '#f0b35a' : '#e0846a';
    let html = `<div style="${MUTED}">${esc(tmp.name || c.temperament)} (${esc(tmp.blurb || '')}) · wants ${esc((amb.name || c.ambition).toLowerCase())}: ${esc(amb.blurb || '')}</div>`;
    html += `<div style="font-size:11px; margin-top:3px;">Content <b style="color:${contentColor};">${Math.round(c.content)}</b>${c.unpaidWeeks ? ` · <span style="color:#e0846a;">unpaid ${c.unpaidWeeks} week(s)</span>` : ''}${bar(c.content, 100, contentColor)}</div>`;
    const offer = offers.find(o => o.clientId === c.id);
    if (offer) {
        html += `<div style="color:#f0b35a; font-size:11px; margin-top:4px;">🎭 ${esc(offer.rivalName)} courts ${esc(c.name)}: ${Math.max(0, offer.dueDay - world.day)} day(s) to answer.</div>`;
        html += act(`Match it (${offer.counter}g)`, ['offer', c.id, 'match'], BTN_GOLD, player.gold >= offer.counter);
        html += act('Let them go', ['offer', c.id, 'release'], BTN_RED);
    }
    if (c.task) {
        const w = Patronage.works()[c.task.workId] || {};
        html += `<div style="margin-top:4px;">${w.icon || ''} At work on a ${esc((w.name || '').toLowerCase())}: ${Math.max(0, Math.ceil(c.task.days - c.task.progress))} day(s) left${bar(c.task.progress, c.task.days, '#ffcf6a')}</div>`;
    } else if (c.assignedTo) {
        const p = Patronage.project(player, c.assignedTo);
        html += `<div style="margin-top:4px;">📐 Overseeing the ${esc(p ? Patronage.greatWork(p.workId).name : 'works')}${p ? ` at ${esc(p.name)}` : ''}.</div>`;
        html += act('Recall', ['assign', c.id, null], BTN_PLAIN);
    } else {
        html += `<div style="margin-top:4px; color:#f0b35a; font-size:11px;">Idle ${c.idleDays || 0} day(s).</div>`;
        const rows = [];
        for (const workId of (Patronage.professions()[c.profession] || {}).works || []) {
            const w = Patronage.works()[workId];
            const quote = Patronage.quote(player, w.materials);
            const mats = quote.lines.map(l => `${l.need} ${l.id}${l.missing ? ` (${l.missing} bought)` : ''}`).join(', ');
            const days = Patronage.workDays(c, workId);
            const ok = player.gold >= quote.buyCost;
            rows.push(row({
                icon: w.icon, name: `Commission a ${esc(w.name.toLowerCase())}`,
                desc: `~${days}d${mats ? ` · ${esc(mats)}` : ''}`,
                why: 'Not enough gold',
                side: quote.buyCost ? price(quote.buyCost, ok) : '', title: mats,
            }, ['commission', c.id, workId], ok));
        }
        if (c.profession === 'architect') {
            for (const p of Patronage.state(player).projects) {
                rows.push(row({ icon: '📐', name: `Oversee the ${esc(Patronage.greatWork(p.workId).name)} at ${esc(p.name)}` }, ['assign', c.id, p.id]));
            }
        }
        html += rowList(rows);
    }
    html += `<div>${act('Raise stipend (+20%)', ['raise', c.id], BTN_PLAIN)}${act('Dismiss', ['dismiss', c.id], BTN_RED)}</div>`;
    return card(html, {
        title: esc(c.name),
        side: `${profName(c.profession)} · skill ${Math.floor(c.skill)} · ${c.stipend}g/week · ${c.worksDone || 0} work(s)`,
    });
}

function clientsTab(player, world, tile) {
    const st = Patronage.state(player);
    let html = '';
    if (!st.clients.length) html += `<div style="${MUTED} margin-bottom:8px;">No one is in your service. Towns keep salons where artists, scholars, architects, physicians and chroniclers seek a patron.</div>`;
    for (const c of st.clients) html += clientCard(player, world, c, st.offers);
    const salon = Patronage.salon(player, world, tile);
    if (tile && tile.settlement) {
        html += sectionHead(`🏛️ The salon of ${esc(tile.settlement.name)}`);
        if (!Patronage.hasSalon(tile)) html += `<div style="${MUTED}">Too small a place for a salon: try a town or a capital.</div>`;
        else if (!salon.length) html += `<div style="${MUTED}">No one new this month.</div>`;
        const full = st.clients.length >= Patronage.maxClients(player);
        const rows = [];
        for (const cand of salon) {
            const D = Patronage.data();
            const tmp = (D.temperaments || {})[cand.temperament] || {};
            const amb = (D.ambitions || {})[cand.ambition] || {};
            const fee = Patronage.hireFee(cand);
            const ok = !full && player.gold >= fee;
            rows.push(row({
                icon: (Patronage.professions()[cand.profession] || {}).icon || '🎨',
                name: `${esc(cand.name)} <span style="font-size:11px; font-weight:400; color:#9d937c;">· Take into service</span>`,
                desc: `${profName(cand.profession)} · skill ${cand.skill} · ${esc(tmp.name || '')} · wants ${esc((amb.name || '').toLowerCase())} · ${cand.stipend}g/week`,
                why: full ? 'You keep as many clients as you can.' : 'Not enough gold',
                note: esc((Patronage.professions()[cand.profession] || {}).blurb || ''),
                side: price(fee, player.gold >= fee),
                title: full ? 'You keep as many clients as you can.' : '',
            }, ['hire', cand.id], ok));
        }
        html += rowList(rows);
    }
    return html;
}

/** Set the court's fashion (systems/patronage.js setFashion → world/fashions.js). */
function fashionTab(player, world, tile) {
    const P = Fashions.config().playerSet;
    let html = `<p class="pk-lede">A patron with standing at a royal court can set its fashion for a season: feasts, gifts and commissions that make the nobles and merchants want silks, spiced wine or jewels. It spreads from the capital to the towns around, and whoever has the goods sells them dear. It costs ${P.prestige} House Prestige and ${P.gold} gold (half with an artist or architect in your pay), needs standing ${P.minReputation} at that court (or its crown), and the court tolerates one of yours every ${P.cooldown} days.</p>`;
    const running = Fashions.active(world);
    if (running.length) {
        html += rowList(running.map(f => {
            const def = Fashions.def(f.id) || {};
            return {
                icon: def.icon || '👗', name: `${esc(def.name || f.id)}${f.by === 'player' ? ' (yours)' : ''}`,
                desc: `from ${esc(f.place)}: ${Fashions.stage(f, world.day)}`,
                side: `${Fashions.daysLeft(f, world.day)} days left`, tone: f.by === 'player' ? 'gold' : '',
            };
        }), 'In fashion now');
    }
    const rows = [];
    for (const def of Fashions.config().list) {
        const q = Patronage.fashionQuote(player, world, tile, def.id);
        const goods = Fashions.goods({ id: def.id }).map(g => `${g.icon} ${g.name}${g.mult < 1 ? ' (less)' : ''}`).join(', ');
        rows.push(row({
            icon: def.icon || '👗', name: esc(def.name),
            desc: esc(def.text || ''),
            note: esc(goods), why: esc(q.reason || ''),
            side: `${q.prestige || P.prestige} Prestige · ${q.gold || P.gold}g`, tone: 'gold',
            title: q.ok ? '' : q.reason,
        }, ['fashion', def.id], q.ok));
    }
    html += rowList(rows, 'Set a fashion here');
    return html;
}

function projectCard(player, world, p) {
    const def = Patronage.greatWork(p.workId);
    const stage = Patronage.stageDef(p) || {};
    let html = '';
    if (p.status === 'supplying') {
        const present = player.q === p.q && player.r === p.r;
        const needs = Patronage.stageNeeds(player, p, present);
        const lines = needs.goods.map(g => `${g.delivered}/${g.need} ${g.id}${g.missing ? (g.have ? ` <span style="color:#8fd18a;">(${g.have} in your packs)</span>` : '') : ' ✓'}`).join(' · ');
        const buyCost = needs.goods.reduce((s, g) => s + Math.max(0, g.missing - g.have) * g.price, 0);
        html += `<div style="font-size:11px;">Wants: ${lines || 'no goods'} · ${needs.goldPaid ? 'gold paid ✓' : `${needs.gold}g for the masons`}</div>`;
        html += `<div style="${MUTED}">Then ${needs.days} days of labour at ${needs.labour}g a day.${present ? '' : ' Goods in your packs can only be delivered on site; anything else is bought for you at a markup.'}</div>`;
        const hasGoods = needs.goods.some(g => g.have > 0);
        html += act('Deliver from your packs', ['deliver', p.id, false], BTN_PLAIN, hasGoods || (!needs.goldPaid && player.gold >= needs.gold));
        html += act(`Buy the rest and deliver (${buyCost}g${needs.goldPaid ? '' : ` + ${needs.gold}g`})`, ['deliver', p.id, true], BTN_GOLD, player.gold >= buyCost + (needs.goldPaid ? 0 : needs.gold));
    } else {
        const cond = Patronage.conditions(player, world, p);
        html += `<div style="font-size:11px;">${Math.floor(p.progress)}/${stage.days} days of labour · ${stage.labour}g a day${bar(p.progress, stage.days, '#ffcf6a')}</div>`;
        if (cond.stall) html += `<div style="color:#f0b35a; font-size:11px;">⏸️ Work stands still: ${esc(Patronage.STALL_TEXT[cond.stall])}.</div>`;
        else html += `<div style="color:#8fd18a; font-size:11px;">Pace ×${cond.speed.toFixed(2)}${cond.notes.length ? ` (${esc(cond.notes.join(', '))})` : ''}</div>`;
    }
    const arch = p.architectId ? Patronage.client(player, p.architectId) : null;
    html += `<div style="font-size:11px; color:#cbbf9f; margin-top:3px;">${arch ? `📐 ${esc(arch.name)} oversees the works.` : 'No architect: one of yours would speed the labour.'}</div>`;
    html += `<div style="${MUTED}">Grants: ${esc(Patronage.effectText(def.effects))} · +${def.prestige} Prestige${def.unique ? ' · <b style="color:#ffcf6a;">unique in the world</b>' : ''}</div>`;
    if (def.unique) {
        for (const n of Patronage.race(world, p.workId)) {
            html += `<div style="color:#f0b35a; font-size:11px;">⏳ ${esc(n.kingdom ? n.kingdom.name : 'A realm')} raises its own: ${Math.round(n.share * 100)}% built.</div>`;
        }
    }
    html += act('Abandon', ['abandon', p.id], BTN_RED);
    return card(html, { icon: def.icon, title: esc(def.name), side: `${esc(p.name)} · stage ${p.stage + 1}/${def.stages.length}: ${esc(stage.name || '')}` });
}

function worksTab(player, world, tile) {
    const st = Patronage.state(player);
    let html = '';
    for (const p of st.projects) html += projectCard(player, world, p);
    const mine = Patronage.playerBuilt(world);
    if (mine.length) {
        html += rowList(mine.map(b => {
            const def = Patronage.greatWork(b.workId) || {};
            const held = !!Patronage.siteAt(player, world, b.q, b.r);
            return {
                icon: b.icon, name: esc(b.name), desc: `at ${esc(b.settlementName)} (day ${b.day})`,
                note: held ? esc(Patronage.effectText(def.effects)) : '<span style="color:#e0846a;">the town is no longer yours, and its gifts with it</span>',
            };
        }), '🏛️ Your Great Works');
    }
    const site = tile ? Patronage.siteAt(player, world, tile.q, tile.r) : null;
    html += sectionHead('🧱 Break ground');
    if (!site) {
        const sites = Patronage.sites(player, world);
        html += `<div style="${MUTED}">Great Works rise in a town you rule or keep a house in${sites.length ? `: ${sites.map(s => esc(s.settlement.name)).join(', ')}` : '. You have none yet.'}</div>`;
        return html;
    }
    const rows = [];
    for (const [id, def] of Object.entries(Patronage.greatWorks())) {
        const can = Patronage.canFound(player, world, tile.q, tile.r, id);
        if (!can.ok && /already raised one|Already under construction/.test(can.reason || '')) continue;
        const gold = def.stages.reduce((s, x) => s + x.gold, 0);
        const days = def.stages.reduce((s, x) => s + x.days, 0);
        rows.push(row({
            icon: def.icon, name: `${esc(def.name)} <span style="font-size:11px; font-weight:400; color:#9d937c;">· ${can.ok ? 'Break ground' : `${def.stages.length} stages`}</span>`,
            desc: esc(def.blurb || ''),
            note: `${esc(Patronage.effectText(def.effects))} · +${def.prestige} Prestige${def.unique ? ' · unique: first to finish claims it' : ''}`,
            why: esc(can.reason || ''),
            side: `<span style="display:block;">${def.stages.length} stages · ~${days} days</span><span style="display:block; font-size:11px; color:#9d937c;">${gold}g + goods + wages</span>`,
            tone: 'gold',
        }, ['found', id], can.ok));
    }
    html += rowList(rows);
    return html;
}

function galleryTab(player, world, tile) {
    const st = Patronage.state(player);
    if (!st.gallery.length && !st.works.length) return `<div style="${MUTED}">Your clients have made nothing yet.</div>`;
    let html = '';
    const kept = st.gallery.filter(g => !g.donatedTo);
    if (kept.length) {
        html += sectionHead('In your gallery');
        html += `<div style="${MUTED} margin-bottom:4px;">Donate a work to the town you stand in: a town you rule grows happier; elsewhere its realm thinks better of you.</div>`;
        const inTown = !!(tile && tile.settlement);
        html += rowList(kept.map(g => {
            const w = Patronage.works()[g.kind] || {};
            return row({
                icon: w.icon || '🖼️', name: `"${esc(g.title)}"`, desc: `${esc(g.by)}, ${g.quality}, day ${g.day}`,
                why: 'Donate (stand in a town)',
                side: inTown ? `Donate to ${esc(tile.settlement.name)}` : '', tone: 'gold',
            }, ['donate', g.uid], inTown);
        }));
    }
    const recent = st.works.slice(-12).reverse();
    if (recent.length) {
        html += rowList(recent.map(r => {
            const w = Patronage.works()[r.kind] || {};
            const donated = (st.gallery.find(g => g.uid === r.uid) || {}).donatedTo;
            return { icon: w.icon || '', name: `"${esc(r.title)}"`, desc: `by ${esc(r.by)} (${r.quality}, day ${r.day})`, side: donated ? `hangs in ${esc(donated.name)}` : '' };
        }), 'Commissions');
    }
    return html;
}

function worldTab(player, world) {
    let html = '<p class="pk-lede">Kingdoms raise wonders at their capitals out of their treasuries. A unique work belongs to whoever finishes it first.</p>';
    const built = Patronage.built(world);
    html += sectionHead('Standing');
    if (!built.length) html += `<div style="${MUTED}">No wonder stands yet.</div>`;
    html += rowList(built.map(b => {
        const k = b.kingdomId != null && world.getKingdom ? world.getKingdom(b.kingdomId) : null;
        return {
            icon: b.icon, name: esc(b.name), desc: `at ${esc(b.settlementName)} · day ${b.day}`,
            side: b.owner === 'player' ? 'yours' : esc(k ? k.name : 'a realm'), tone: b.owner === 'player' ? 'gold' : '',
        };
    }));
    const rising = Patronage.npcProjects(world);
    if (rising.length) {
        html += rowList(rising.map(n => {
            const def = Patronage.greatWork(n.workId) || {};
            const k = world.getKingdom ? world.getKingdom(n.kingdomId) : null;
            return {
                icon: def.icon || '🏗️', name: `${esc(def.name)}${def.unique ? ' <span style="color:#ffcf6a; font-size:11px; font-weight:400;">· unique</span>' : ''}`,
                desc: esc(k ? k.name : 'a realm'), note: bar(n.progress, n.days, '#8a7dd8'),
                side: `${Math.round(100 * n.progress / Math.max(1, n.days))}% built`,
            };
        }), 'Rising');
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
        html += chips([
            { icon: '🎨', label: 'Clients', value: `${s.clients}/${s.max}`, cls: s.clients < s.max ? 'gold' : '' },
            ['📜', 'Stipends', `${s.weekly}g a week`],
            ['🏗️', 'Great Works rising', s.projects],
            ['🏛️', 'Raised', s.built],
            ['💸', 'Spent on patronage', `${s.spent}g`],
            purse(player.gold),
        ]);
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
