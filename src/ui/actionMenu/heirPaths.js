// ActionMenu helpers — the years away (systems/heirPaths.js), in the action
// menu's voice (ui/actionMenu/uiKit.js). Plain functions, not ActionMenu
// members, used by the panels that own them:
//   heirPathsHtml(game, child)   a child's page (showChildPanel): choose a
//                                formative path and where, the path under
//                                way, a hostage's terms (pay, refuse,
//                                rescue), the friends made, what it carries
//                                into a reign
//   wardLeverageHtml(game)       Dynasty → Wards at Court: keep a ward as a
//                                hostage, ransom one back to their realm
//   rulerEducationHtml(player)   the ruler's own coming-of-age record
//                                (player.upbringingRecord), for the Dynasty card
// Logic lives in the system; these present it. Clicks go through
// window._heirPathsUI.
import { ActionMenu } from './_ref.js';
import { HeirPaths } from '../../systems/heirPaths.js';
import { Raising } from '../../systems/raising.js';
import { Court } from '../../systems/court.js';
import { esc, sectionHead, lede, card, rowList, price } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const MUTED = 'color:#9d937c; font-size:11px;';
// (the path being chosen on each child's page: kind id by child id; panel state only)
const _picked = {};

/** "the court of X" → "The court of X", where a name opens a row. */
function _cap(s) {
    const t = String(s || '');
    return t.charAt(0).toUpperCase() + t.slice(1);
}

function _bar(v, color) {
    const pct = Math.max(0, Math.min(100, Math.round(v || 0)));
    return `<div style="background:rgba(0,0,0,0.35); border-radius:3px; height:5px; margin:3px 0 6px;"><div style="width:${pct}%; height:5px; border-radius:3px; background:${color};"></div></div>`;
}

function _ui(game) {
    const player = game.player;
    const world = game.world;
    const child = (id) => ActionMenu.showChildPanel.bind(ActionMenu, game, id);
    const fail = (title, reason) => game.ui.showNotification(title, reason, 'error');
    const refresh = (id, html, color = null) => {
        game.ui.updateStats(player, world);
        child(id)({ html, color });
    };
    window._heirPathsUI = {
        pick: (id, kind) => {
            _picked[id] = _picked[id] === kind ? null : kind;
            child(id)();
        },
        begin: (id, kind, key) => {
            const res = HeirPaths.begin(player, world, id, kind, key);
            if (!res.success) return fail('🎓 The Years Away', res.reason);
            _picked[id] = null;
            const who = res.contacts.map(c => `${esc(c.name)} (${esc(c.label)})`).join(', ');
            refresh(id, `${esc(HeirPaths.kind(kind).icon)} ${esc(res.child.firstName)} leaves for ${esc(res.path.name)} until day ${res.path.until} (−${Utils.formatGold(res.cost.fee)}g).${who ? `<div style="${MUTED} margin-top:3px;">There: ${who}.</div>` : ''}`);
        },
        recall: (id) => {
            const res = HeirPaths.recall(player, world, id);
            if (!res.success) return fail('🎓 The Years Away', res.reason);
            refresh(id, `${esc(res.child.firstName)} is called home. The years away count for half.`);
        },
        pay: (id) => {
            const res = HeirPaths.payDemand(player, world, id);
            if (!res.success) return fail('⛓️ Hostage', res.reason);
            refresh(id, `🕊️ ${esc(res.child.firstName)} is ransomed (−${Utils.formatGold(res.cost)}g) and comes home.`);
        },
        refuse: (id) => {
            const res = HeirPaths.refuseDemand(player, world, id);
            if (!res.success) return fail('⛓️ Hostage', res.reason);
            refresh(id, `You refuse their terms. ${esc(res.child.firstName)} hears of it.`, 'rgba(224,150,96,0.5)');
        },
        rescue: (id) => {
            const res = HeirPaths.rescue(player, world, id);
            if (!res.success) return fail('🗡️ Rescue', res.reason);
            refresh(id, `🗡️ ${esc(res.text)}`, res.rescued ? null : 'rgba(224,96,96,0.5)');
        },
        wed: (id, npcId) => {
            const res = HeirPaths.wedContact(player, world, id, npcId);
            if (!res.success) return fail('💍 A Match', res.reason);
            refresh(id, `💍 ${esc(res.child.firstName)} weds ${esc(res.contact.name)}, ${esc(res.contact.label)}.`);
        },
        court: (id, npcId) => {
            const res = Court.invite(player, world, npcId);
            if (!res.success) return fail('🏰 Court', res.reason);
            refresh(id, `🏰 ${esc(res.reason)}`, res.accepted ? null : 'rgba(224,150,96,0.5)');
        },
        keepWard: (wardId) => {
            const res = HeirPaths.keepWard(player, world, wardId);
            if (!res.success) return fail('🎓 Wards', res.reason);
            ActionMenu.showHouseWards(game, { html: `⛓️ ${esc(res.ward.firstName)} will not go home: a hostage now, and leverage over ${esc(res.ward.kingdomName)}.`, color: 'rgba(224,150,96,0.5)' });
        },
        unkeepWard: (wardId) => {
            const res = HeirPaths.releaseKept(player, world, wardId);
            if (!res.success) return fail('🎓 Wards', res.reason);
            ActionMenu.showHouseWards(game, { html: `${esc(res.ward.firstName)} is a ward again, not a hostage.` });
        },
        ransomWard: (wardId) => {
            const res = HeirPaths.ransomWard(player, world, wardId);
            if (!res.success) return fail('🎓 Wards', res.reason);
            game.ui.updateStats(player, world);
            ActionMenu.showHouseWards(game, { html: `💰 ${esc(res.text)}`, color: 'rgba(224,150,96,0.5)' });
        },
    };
}

/** The years-away section of a child's page. */
export function heirPathsHtml(game, child) {
    const player = game.player;
    const world = game.world;
    if (!child || child.isAlive === false) return '';
    _ui(game);
    const up = HeirPaths.ensure(child);
    const id = esc(child.id);
    const gold = player.gold || 0;
    let html = '';
    const holder = HeirPaths.holder(player, world, child);

    // A hostage: the holder's terms, a rescue, the turning
    if (holder) {
        const H = HeirPaths.config().hostage;
        const held = holder.held;
        const who = esc(HeirPaths._holderName(player, world, child));
        let body = `<div style="color:#ece2c8;">${esc(child.firstName)} is held by ${who} since day ${held.day}.</div>`;
        const turn = Math.round(up.turn || 0);
        body += `<div style="${MUTED} margin-top:4px;">${up.turned ? '🐍 Turned against you' : `Turning: ${turn} of ${H.turnAt} — a close bond slows it, refusing their terms speeds it`}</div>`;
        if (!up.turned) body += _bar(turn / Math.max(1, H.turnAt) * 100, '#c0533a');
        html += card(body, { icon: '⛓️', title: `${esc(child.firstName)} Held`, tone: 'bad' });
        const rows = [];
        if (held.demand) {
            const ok = gold >= held.demand.amount;
            rows.push({ icon: '💰', name: 'Meet their terms', desc: `Paid into ${held.rival ? 'their House\'s purse' : 'their crown\'s chests'} · ${esc(child.firstName)} comes home · by day ${held.demand.due}`, off: !ok, why: 'Not enough gold', attrs: `onclick="window._heirPathsUI.pay('${id}')"`, side: price(held.demand.amount, ok), tone: 'gold' });
            rows.push({ icon: '✋', name: 'Refuse their terms', desc: `${H.refusedReputation} standing · the price rises · ${esc(child.firstName)} turns faster`, attrs: `onclick="window._heirPathsUI.refuse('${id}')"`, side: 'refuse', tone: 'warn' });
        } else {
            rows.push({ icon: '⏳', name: 'Awaiting their terms', desc: 'A demand will come by letter soon.' });
        }
        const odds = HeirPaths.rescueOdds(player);
        const okR = gold >= odds.cost;
        rows.push({ icon: '🗡️', name: 'Hire blades to bring them home', desc: `${Math.round(odds.chance * 100)}% (your stealth and spymaster) · failure: ${H.rescueFailRep} standing, a wound, or worse`, off: !okR, why: 'Not enough gold', attrs: `onclick="window._heirPathsUI.rescue('${id}')"`, side: price(odds.cost, okR), tone: 'bad' });
        html += rowList(rows);
        html += lede(`A ransom can also be sent by letter (Letters → Post, to ${held.rival ? 'the head of that House' : 'that court'}).`);
    }

    // Under way
    const p = up.path;
    if (p && p.active && !holder) {
        const def = HeirPaths.kind(p.kind) || {};
        const span = Math.max(1, p.until - p.since);
        const done = Math.max(0, Math.min(1, ((world.day || 0) - p.since) / span));
        let body = `<div style="color:#ece2c8;">${esc(def.blurb || '')}</div>`;
        body += `<div style="${MUTED} margin-top:4px;">Since day ${p.since} · home by day ${p.until} · ${p.months || 0} months · ${Utils.formatGold(p.paid || 0)}g paid${def.yearly ? ` · board ${Utils.formatGold(def.yearly)}g a year` : ''}</div>`;
        body += _bar(done * 100, '#d6b46a');
        html += card(body, { icon: def.icon, title: `${esc(def.name)} — ${esc(p.name)}`, side: esc(p.where || ''), tone: 'gold' });
        html += rowList([{ icon: '🏠', name: `Call ${esc(child.firstName)} home`, desc: 'Before their time: the path counts for half', attrs: `onclick="window._heirPathsUI.recall('${id}')"`, side: 'recall', tone: 'warn' }]);
    }

    // Choosing a path
    const barred = HeirPaths.barred(player, world, child);
    if (!barred) {
        html += sectionHead('The Years Away');
        html += lede(`Send ${esc(child.firstName)} away to be made: years at another court, a guild, the church, the schools or abroad. Each costs a fee and yearly board paid to them, and brings home skills, character, letters or a tongue, and friends who remember.`);
        const kinds = HeirPaths.kinds();
        const pick = _picked[child.id] || null;
        html += rowList(Object.entries(kinds).map(([kid, def]) => {
            const c = HeirPaths.cost(kid, child, world);
            return {
                icon: def.icon, name: `${esc(def.name)}${pick === kid ? ' ▾' : ''}`, desc: esc(def.blurb || ''),
                attrs: `onclick="window._heirPathsUI.pick('${id}','${esc(kid)}')"`,
                side: `${price(c.fee, gold >= c.fee)}<small> +${Utils.formatGold(c.yearly)}g/yr · ${c.years} yr</small>`, tone: pick === kid ? 'gold' : '',
            };
        }));
        if (pick && kinds[pick]) {
            const venues = HeirPaths.venues(player, world, pick, child);
            const c = HeirPaths.cost(pick, child, world);
            if (!venues.length) {
                html += `<div style="${MUTED} margin:0 2px 6px;">There is nowhere in the known world to take ${esc(child.firstName)} as ${esc(HeirPaths._article(kinds[pick].name))} just now.</div>`;
            } else {
                html += rowList(venues.map(v => {
                    const why = HeirPaths._venueBarred(player, world, v);
                    return {
                        icon: kinds[pick].icon, name: esc(_cap(v.name)), desc: `${esc(v.where || '')} · ${esc(v.note || '')}${v.quality !== 1 ? ` · ×${v.quality.toFixed(2)}` : ''}`,
                        off: !!why || gold < c.fee, why: esc(why || 'Not enough gold'),
                        attrs: `onclick="window._heirPathsUI.begin('${id}','${esc(pick)}','${esc(v.key)}')"`,
                        side: price(c.fee, gold >= c.fee),
                    };
                }), `Where to send ${esc(child.firstName)}`);
            }
        }
    }

    // The record and the friends
    if (up.pathRecord.length) {
        html += rowList(up.pathRecord.map(r => ({
            icon: r.icon, name: `${esc(r.name)} — ${esc(r.venue)}`,
            desc: `day ${r.from}–${r.to}${r.language ? ' · learned the tongue' : ''}`,
            side: r.how === 'completed' ? 'completed' : esc(r.how), tone: r.how === 'completed' ? 'good' : 'warn',
        })), 'The Years Away');
    }
    const friends = HeirPaths.contacts(player, child);
    if (friends.length) {
        const grown = !!up.comeOfAge;
        const unwed = grown && !up.spouse;
        html += rowList(friends.map(c => {
            const regard = Math.round(c.regard || c.growing || 0);
            const npc = c.npc;
            const canWed = unwed && npc.gender !== child.gender && !npc.isMarried && (npc.age || 0) >= 16 && regard >= 30;
            const atCourt = Court.isMember(player, c.npcId);
            const row = {
                icon: c.rival ? '⚔️' : (npc.gender === 'female' ? '👩' : '👨'), name: esc(c.name),
                desc: `${esc(c.label)} · ${esc(npc.occupation || '')}${c.kingdomName ? ` of ${esc(c.kingdomName)}` : ''} · age ${npc.age || '?'}${atCourt ? ' · at your court' : ''}`,
                side: `❤️ ${regard}`,
            };
            if (canWed) Object.assign(row, { attrs: `onclick="window._heirPathsUI.wed('${id}','${esc(c.npcId)}')"`, side: '💍 Wed', tone: 'gold' });
            else if (grown && !atCourt && player.house && player.relationships && player.relationships[c.npcId]) Object.assign(row, { attrs: `onclick="window._heirPathsUI.court('${id}','${esc(c.npcId)}')"`, side: '🏰 Invite', tone: '' });
            return row;
        }), 'Friends From the Years Away');
    }
    // What the years away carry into a reign
    const plan = HeirPaths.payoffLines(player, world, child);
    if (plan.lines.length) {
        html += card(plan.lines.map(l => `<div style="color:#ece2c8;">${l.icon} ${esc(l.text)}</div>`).join(''), {
            icon: '👑', title: `The years away, should ${esc(child.firstName)} inherit`,
            side: plan.prestige ? `⭐${plan.prestige > 0 ? '+' : ''}${plan.prestige}` : '',
        });
    }
    return html;
}

/** Wards kept or held as leverage (Dynasty → Wards at Court). */
export function wardLeverageHtml(game) {
    const player = game.player;
    const world = game.world;
    const wards = Raising.wards(player);
    if (!wards.length) return '';
    _ui(game);
    const L = HeirPaths.config().wardLeverage;
    const RW = Raising._rivalWardCfg();
    const rows = [];
    for (const w of wards) {
        const id = esc(w.id);
        const name = esc(w.firstName);
        if (w.held || w.kept) {
            const amt = HeirPaths.wardRansom(world, w);
            const offer = w.offer && w.offer.until >= (world.day || 0);
            rows.push({
                icon: '💰', name: `Ransom ${name} to ${esc(w.kingdomName)}`,
                desc: w.rivalId != null
                    ? `${offer ? `Their offer stands until day ${w.offer.until} · ` : ''}from their House's purse into yours · feud +${RW.ransomFeud == null ? 15 : RW.ransomFeud} · they will remember it`
                    : `${offer ? `Their offer stands until day ${w.offer.until} · ` : ''}from their crown into your purse · ${w.held ? L.ransomWarReputation : L.ransomPeaceReputation} standing · they will remember it`,
                attrs: `onclick="window._heirPathsUI.ransomWard('${id}')"`, side: `+${price(amt)}`, tone: 'gold',
            });
            if (w.kept) rows.push({ icon: '🔓', name: `Let ${name} be a ward again`, desc: 'They go home at the end of their term', attrs: `onclick="window._heirPathsUI.unkeepWard('${id}')"`, side: 'release' });
        } else {
            rows.push({
                icon: '⛓️', name: `Keep ${name} as a hostage`,
                desc: w.rivalId != null
                    ? `Leverage over ${esc(w.kingdomName)}: no fee, feud +${RW.keepFeud == null ? 10 : RW.keepFeud} now and +${RW.keepMonthlyFeud == null ? 2 : RW.keepMonthlyFeud} a month; they may spirit the child away`
                    : `Leverage over ${esc(w.kingdomName)}: no fee, ${L.keepReputation} standing now and ${L.keepMonthlyReputation} a month; they may spirit the child away`,
                attrs: `onclick="window._heirPathsUI.keepWard('${id}')"`, side: 'keep', tone: 'bad',
            });
        }
    }
    return rowList(rows, 'Wards as Leverage');
}

/** The ruler's own coming-of-age record, if they were raised by the House. */
export function rulerEducationHtml(player) {
    const r = player && player.upbringingRecord;
    if (!r || !r.text) return '';
    // (r.text is the coming-of-age summary told to the old head, "You spent no days together":
    // the ruler's own line keeps to the grade, the training and the years away; the whole in the tooltip)
    const head = `${r.grade ? _cap(r.grade) : ''}${r.focus ? ` (${r.focus})` : ''}`.trim();
    // ("Adelaide went as a page..." → "You went as a page...": the record is the ruler's own)
    const shaped = r.shaped && r.name && String(r.shaped).startsWith(`${r.name} `) ? `You${String(r.shaped).slice(String(r.name).length)}` : (r.shaped || '');
    const line = [head ? `${head}.` : '', shaped].filter(Boolean).join(' ');
    return `<div style="${MUTED} margin-top:4px;" title="${esc(r.text)}">${esc(r.gradeIcon || '🎓')} Your own upbringing: ${esc(line || r.text)}</div>`;
}
