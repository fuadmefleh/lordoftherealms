// ActionMenu — ⛪ The Church (Dynasty → Against you → The Church): the see of
// your faith and its head, the holy wars called and fought (answer a call for
// your crown, take the cross, your vow's road), the bans on you and the ways
// out of them (penance, payment, a counter-pope), a holy war against your
// realm and the terms the see may hear (a penance, a town or the holy site
// yielded, the see's rite, submission, tolerance), the inquisitor in your town
// (host, bribe, obstruct, expel; a summons to answer) and those abroad; and,
// for a High Priest, the head's own acts: call a holy war, cast out or pardon a
// ruler, send an inquisitor. Logic: systems/holyWars.js, systems/inquisition.js.
import { ActionMenu } from './_ref.js';
import { HolyWars } from '../../systems/holyWars.js';
import { Inquisition } from '../../systems/inquisition.js';
import { Religion } from '../../systems/religion.js';
import { lede, chips, rowList, card, price, esc } from './uiKit.js';
import { Utils } from '../../core/utils.js';
import { Names } from '../../core/names.js';

const CASUS = { holySite: ['⛪', 'A holy site'], heretic: ['🔥', 'Heresy'], excommunicate: ['🔔', 'A ruler cast out'], infidel: ['⚔️', 'The infidel'] };
const VERDICT = { acquitted: 'acquitted', penance: 'a penance', confiscated: 'goods seized', relapsed: 'handed to the secular arm', recanted: 'recanted', fled: 'fled' };

function _realmName(world, id, cap = false) {
    const k = world && world.getKingdom ? world.getKingdom(id) : null;
    return k ? Names.realm(k.name, cap) : (cap ? 'A fallen realm' : 'a fallen realm');
}

function _faithName(id) {
    const f = Religion.FAITHS[id];
    return f ? `${f.icon || ''} ${f.name}`.trim() : 'the faith';
}

Object.assign(ActionMenu, {
    /** The Church panel. message: { html, tone } shown on top. */
    showChurch(game, message = null) {
        const player = game.player;
        const world = game.world;
        if (!player || !world) return;
        const v = HolyWars.view(world, player);
        const iv = Inquisition.view(world, player);
        const day = world.day || 0;
        let html = '<div style="font-size:12px; max-height:560px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede(v.see
            ? `${esc(HolyWars.headLabel(v.see))} keeps the see of ${esc(_faithName(v.see.faithId))}${v.see.rite !== 'orthodox' ? ' (the reformed rite)' : ''} at ${esc(v.see.town || 'the holy city')}. The head of the faith calls the faithful to holy wars, sends inquisitors into the realms and casts out rulers who defy him.`
            : 'You keep no faith with a see to speak for it. The heads of the world\'s faiths call holy wars, send their inquisitors and cast out rulers all the same.');

        // A crusader's honour
        if (v.knight) {
            html += card(chips([
                ['✝️', 'Title', esc(HolyWars.styleOf(player)), 'gold'],
                ['⚔️', 'Won in', esc(v.knight.last || v.knight.war || 'a holy war')],
                ['🛡️', 'Crusades served', String(Math.max(Number(v.p.crusades) || 0, Number(v.knight.wars) || 1))],
            ]) + '<div style="color:#cfc3a5;">The faithful rulers remember the crusader; the realms you rode against remember too.</div>', { icon: '✝️', title: esc(v.knight.title || HolyWars.knightTitle()), tone: 'gold' });
        }

        // A summons to answer
        if (iv.summons) {
            const sm = iv.summons;
            const there = player.q === sm.q && player.r === sm.r;
            const inq = Inquisition.get(world, sm.inqId);
            const odds = inq ? Inquisition.guiltOdds(player, world, inq) : 0.5;
            const rows = there
                ? [
                    { icon: '⚖️', name: 'Stand before the hearing', desc: `${Math.round(odds * 100)}% he finds you suspect: a penance, your goods seized, or — an obstinate heretic — the secular arm`, act: 'churchAct', args: ['answer', 'stand'] },
                    { icon: '🙇', name: 'Recant', desc: 'Abjure your errors on your knees: a penance and the town\'s scorn, but no verdict', act: 'churchAct', args: ['answer', 'recant'] },
                ]
                : [{ icon: '⚖️', name: 'Answer the summons', off: true, why: `Go to ${esc(sm.town)} by day ${sm.due}. If you do not come, the crown posts a warrant for heresy.` }];
            html += card(rowList(rows), { icon: '📜', title: `Summoned by ${esc(sm.name)}`, side: `day ${sm.due}`, tone: 'bad' });
        }

        // The bans on you
        for (const b of v.bans) {
            const opts = HolyWars.absolutionOptions(player, world, b.see.key, b.who);
            const rows = opts.map(o => {
                const name = o.how === 'penance' ? `Do penance at ${esc(b.see.town)}` : o.how === 'pay' ? 'Send a gift to the see' : `Turn to ${esc(o.other)}`;
                const desc = o.how === 'penance' ? `Barefoot before ${esc(HolyWars.headLabel(b.see))}: alms and ${o.prestige} Prestige of shame`
                    : o.how === 'pay' ? (o.fromTreasury ? 'From the crown\'s chests first, then your purse' : 'From your purse')
                        : 'A schism split the faith: the other rite calls the ban void (the old rite\'s faithful will not)';
                return o.ok ? { icon: o.how === 'penance' ? '🙇' : o.how === 'pay' ? '💰' : '⛪', name, desc, side: o.cost ? price(o.cost, true) : '', act: 'churchAct', args: ['absolve', b.see.key, b.who, o.how] }
                    : { icon: o.how === 'penance' ? '🙇' : '💰', name, off: true, why: esc(o.reason || 'Not now.'), side: o.cost ? price(o.cost, false) : '' };
            });
            const body = `<div style="color:#cfc3a5; margin-bottom:6px;">Cast out on day ${b.ban.since}${b.ban.reason ? ` for ${esc(b.ban.reason)}` : ''}. ${b.who === 'player' ? 'The clergy will not know you; the faithful realms think the less of you each week.' : 'Your lords\' oaths loosen and the faithful crowns turn from you.'}</div>${rowList(rows, 'The ways back')}`;
            html += card(body, { icon: '🔔', title: b.who === 'player' ? 'You are excommunicated' : `${esc(_realmName(world, b.who, true))} lies under the ban`, side: esc(_faithName(b.see.faithId)), tone: 'bad' });
        }

        // Holy wars against your realm, and the terms the see might hear (HolyWars.terms)
        const TERM_ICON = { indemnity: '💰', yieldSite: '⛪', yield: '🏰', rite: '📿', submit: '🙇', tolerate: '🕯️' };
        for (const { war: w, terms, state } of v.against) {
            const body = chips([
                ['⚔️', 'Crusaders', `${w.members.length} crown${w.members.length === 1 ? '' : 's'}`, 'bad'],
                ['🏰', 'Towns lost', `${w.gained.length} / ${HolyWars.townsToWin(w)}`, w.gained.length ? 'bad' : ''],
                ['🔥', 'Their resolve', `${Math.round(state.resolve)}`],
                ['⏳', 'Sworn until', `day ${w.until}`],
            ]) + `<div style="color:#cfc3a5; margin-bottom:6px;">${esc((CASUS[w.casus] || [])[1] || 'A holy war')}. The crusaders will not hear envoys: the war is sworn. ${esc(w.head)} may hear terms — dearer while they win, cheaper as their resolve and the term run out.</div>`
                + rowList(terms.map(o => (o.ok
                    ? { icon: TERM_ICON[o.how] || '🕊️', name: esc(o.label), desc: `${esc(o.desc)} · ~${Math.round(o.chance * 100)}% the see accepts`, side: o.cost ? price(o.cost, true) : '', act: 'churchAct', args: ['terms', w.id, o.how] }
                    : { icon: TERM_ICON[o.how] || '🕊️', name: esc(o.label), off: true, why: esc(o.reason || 'Not now.'), side: o.cost ? price(o.cost, false) : '' })), 'Terms to offer the see');
            html += card(body, { icon: '⚔️', title: esc(w.name.charAt(0).toUpperCase() + w.name.slice(1)), side: w.phase === 'call' ? `called · by day ${w.answerBy}` : 'at war', tone: 'bad' });
        }

        // Calls to your crown
        if (v.invitations.length) {
            html += rowList(v.invitations.flatMap(w => [
                { icon: '✝️', name: `Answer the call: ${esc(w.name)}`, desc: `${esc((CASUS[w.casus] || [])[1] || 'A holy war')} · sworn until day ${w.until}; your realm goes to war at once`, side: `by day ${w.answerBy}`, tone: 'gold', act: 'churchAct', args: ['answer_call', w.id, 1] },
                { icon: '✋', name: 'Refuse the call', desc: 'Your realm\'s piety, its lords\' regard and the see\'s patience suffer', act: 'churchAct', args: ['answer_call', w.id, 0] },
            ]), 'The Church calls your crown');
        }

        // The cross
        if (v.cross) {
            const c = v.cross;
            const C = HolyWars.config().cross;
            const body = chips([
                ['📍', 'Muster', esc(c.muster.town)],
                c.arrived == null ? ['⏳', 'Reach it by', `day ${c.by}`, day > c.by - 10 ? 'bad' : ''] : ['⚔️', 'Served', `${c.served} / ${C.serveDays} days`, 'gold'],
                ['🛡️', 'Your lands', 'under the Church'],
            ]) + `<div style="color:#cfc3a5;">${c.arrived == null ? `Reach the muster within ${C.musterRange} hexes, then serve within ${C.frontRange} hexes of the foe's towns or the muster.` : 'Stay near the front: every day there counts toward your vow. Fulfilled, the Church grants you remission of your sins.'}</div>`;
            html += card(body, { icon: '✝️', title: `Under the cross against ${esc(Names.realm(c.targetName))}`, tone: 'gold' });
        } else if (v.crossOptions.length) {
            html += rowList(v.crossOptions.map(o => (o.ok
                ? { icon: '✝️', name: `Take the cross: ${esc(o.war.name)}`, desc: 'Muster, serve at the front, and win remission of your sins; the crowns of the faith keep your lands meanwhile', act: 'churchAct', args: ['cross', o.war.id] }
                : { icon: '✝️', name: `Take the cross: ${esc(o.war.name)}`, off: true, why: esc(o.reason) })), 'The cross');
        }

        // The inquisitor in town
        if (iv.here) {
            const inq = iv.here;
            const sus = iv.suspicion;
            let body = chips([
                ['🔥', 'Zeal', `${Math.round(inq.zeal * 100)}%`, inq.zeal >= 0.7 ? 'bad' : ''],
                ['💰', 'Greed', `${Math.round(inq.greed * 100)}%`],
                ['👁️', 'Your suspicion', `${sus.value}`, sus.value >= 50 ? 'bad' : sus.value >= 30 ? 'warn' : 'good'],
                ['⚖️', 'Tried here', String(inq.tally.tried)],
            ]);
            if (sus.parts.length) body += `<div style="color:#9d937c; margin-bottom:4px;">${sus.parts.map(p => `${esc(p.label)} ${p.value > 0 ? '+' : ''}${p.value}`).join(' · ')}</div>`;
            const L = { host: ['🍷', 'Host him and his clerks', 'His favour for a year: your name off his roll'], bribe: ['💰', 'Bribe him', 'A greedy man rides on; a zealot writes your name in his book'], obstruct: ['🕯️', 'Obstruct the hearing', 'Warn the accused, hide them: fewer burn, the hearing ends sooner — if no informer sees you'], expel: ['🚪', 'Expel him', 'Your lands are yours: the see will not forget it'] };
            body += rowList(iv.options.map(o => (o.ok
                ? { icon: L[o.act][0], name: L[o.act][1], desc: L[o.act][2], side: o.cost ? price(o.cost, true) : '', act: 'churchAct', args: ['inq', inq.id, o.act] }
                : { icon: L[o.act][0], name: L[o.act][1], off: true, why: esc(o.reason || 'Not now.'), side: o.cost ? price(o.cost, false) : '' })));
            html += card(body, { icon: '📜', title: `${esc(inq.name)}, inquisitor of ${esc(_faithName(inq.faithId))}`, side: inq.phase === 'hearing' ? `hearing until day ${inq.hearingEnd}` : 'resting', tone: 'warn' });
        }

        // The head's own acts (a High Priest)
        if (v.headed) {
            const see = v.headed;
            const targets = HolyWars.targets(world, see);
            const busy = v.wars.some(w => w.seeKey === see.key);
            const rows = targets.slice(0, 6).map(t => (busy
                ? { icon: (CASUS[t.casus] || ['⚔️'])[0], name: `Call a holy war on ${esc(Names.realm(t.k.name))}`, off: true, why: 'Your see already wages a holy war.' }
                : { icon: (CASUS[t.casus] || ['⚔️'])[0], name: `Call a holy war on ${esc(Names.realm(t.k.name))}`, desc: esc((CASUS[t.casus] || [])[1] || ''), act: 'churchAct', args: ['proclaim', t.k.id] }));
            for (const k of HolyWars.flock(world, see.key)) {
                if (v.mine && k.id === v.mine.id) continue;
                const banned = !!see.bans[k.id];
                rows.push({ icon: banned ? '🕊️' : '🔔', name: `${banned ? 'Lift the ban on' : 'Cast out'} the ruler of ${esc(Names.realm(k.name))}`, desc: banned ? 'Take him back into the faith' : `The see's grievance: ${Math.round(see.grievance[k.id] || 0)}`, act: 'churchAct', args: ['ban', k.id, banned ? 1 : 0] });
                if (!Inquisition.state(world).list.some(i => i.kingdomId === k.id) && Inquisition.law(world, k.id).admit) rows.push({ icon: '📜', name: `Send an inquisitor to ${esc(Names.realm(k.name))}`, desc: 'He rides the realm town to town, trying its people', side: price(Inquisition.config().spawn.commission, (player.gold || 0) >= Inquisition.config().spawn.commission), act: 'churchAct', args: ['send', k.id] });
            }
            html += rowList(rows, `As head of ${esc(_faithName(see.faithId))}`);
        }

        // The holy wars of the world
        if (v.wars.length) {
            html += rowList(v.wars.map(w => ({
                icon: (CASUS[w.casus] || ['✝️'])[0], name: esc(w.name.charAt(0).toUpperCase() + w.name.slice(1)),
                desc: esc(`${HolyWars.headLabel(HolyWars.see(world, w.seeKey)) || w.head} · ${w.members.length} crown${w.members.length === 1 ? '' : 's'} at war${w.gained.length ? ` · taken: ${w.gained.slice(0, 3).join(', ')}` : ''}`),
                side: w.phase === 'call' ? `called · by day ${w.answerBy}` : `until day ${w.until}`, tone: w.phase === 'call' ? 'gold' : 'warn',
            })), 'Holy wars');
        }

        // Inquisitors abroad
        const abroad = iv.list.filter(i => !iv.here || i.id !== iv.here.id);
        if (abroad.length) {
            html += rowList(abroad.map(i => ({
                icon: '📜', name: `${esc(i.name)} in ${esc(_realmName(world, i.kingdomId))}`,
                desc: esc(`${i.phase === 'travel' ? `riding to ${i.dest ? i.dest.town : 'the next town'}` : i.phase === 'hearing' ? `a hearing at ${i.town}` : `at ${i.town}`} · ${i.tally.tried} tried, ${i.tally.burned} burned`),
                side: `${Math.round(i.zeal * 100)}% zeal`,
            })), 'Inquisitors abroad');
        }

        // The sees
        if (v.sees.length) {
            html += rowList(v.sees.map(s => ({
                icon: (Religion.FAITHS[s.faithId] || {}).icon || '⛪', name: esc(HolyWars.headLabel(s)),
                desc: esc(`${_faithName(s.faithId)}${s.rite !== 'orthodox' ? ' (reformed)' : ''} · seat at ${s.town || '—'} · ${Object.keys(s.bans).length} under the ban`),
                side: s.head && s.head.player ? 'you' : `${Utils.formatGold(Math.round(s.coffers || 0))}g`,
            })), 'The sees of the faiths');
        }

        // The record
        const rec = [];
        for (const h of v.past.slice(0, 5)) rec.push({ icon: h.outcome === 'victory' ? '✝️' : h.outcome === 'terms' ? '🕊️' : '🏳️', name: esc(h.name.charAt(0).toUpperCase() + h.name.slice(1)), desc: esc(`${h.outcome === 'terms' ? `on terms: ${(h.terms && h.terms.what) || 'peace made'}` : h.outcome}${h.gained.length ? ` · ${h.gained.slice(0, 3).join(', ')} taken` : ''}`), side: `day ${h.to}` });
        for (const r of iv.p.record.slice(0, 3)) rec.push({ icon: '⚖️', name: `Before ${esc(r.inq)} at ${esc(r.town)}`, desc: esc(VERDICT[r.verdict] || r.verdict), side: `day ${r.day}` });
        for (const x of v.p.past.slice(0, 3)) rec.push({ icon: x.how === 'broken' ? '💔' : '✝️', name: esc(x.name), desc: x.how === 'fulfilled' ? 'Vow fulfilled' : x.how === 'broken' ? 'Vow broken' : 'Released from the vow', side: `day ${x.done}` });
        if (rec.length) html += rowList(rec, 'On record');
        html += '</div>';
        game.ui.showCustomPanel('⛪ The Church', html);
    },

    /** The panel's rows (data-am-act="churchAct"). */
    churchAct(game, action, a = null, b = null, c = null) {
        const player = game.player;
        const world = game.world;
        let res;
        if (action === 'answer') res = Inquisition.answerSummons(player, world, a);
        else if (action === 'absolve') res = HolyWars.seekAbsolution(player, world, a, b, c);
        else if (action === 'terms') res = HolyWars.offerTerms(player, world, Number(a), b);
        else if (action === 'answer_call') res = HolyWars.answer(player, world, Number(a), !!Number(b));
        else if (action === 'cross') res = HolyWars.takeCross(player, world, Number(a));
        else if (action === 'inq') res = Inquisition.act(player, world, Number(a), b);
        else if (action === 'proclaim') res = HolyWars.proclaimHolyWar(player, world, a);
        else if (action === 'ban') res = HolyWars.pronounceBan(player, world, a, !!Number(b));
        else if (action === 'send') res = Inquisition.send(player, world, a);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('⛪ The Church', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        const bad = res.accepted === false || res.caught || res.verdict === 'relapsed' || res.verdict === 'confiscated';
        ActionMenu.showChurch(game, { html: esc(res.text || 'Done.'), tone: bad ? 'bad' : 'good' });
    },
});
