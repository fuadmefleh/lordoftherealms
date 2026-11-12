// ActionMenu — the Stewards panel: who runs each of your seats (holdings,
// the realm's demesne towns, your estates, the company), by what standing
// order, and how they are doing; appoint, set orders and works allowances,
// audit, reward, recall, punish; answer their proposals; read their dispatches.
// Logic lives in systems/stewards.js; this panel presents it in the action
// menu's voice (ui/actionMenu/uiKit.js).
//   showStewards(game, view?, seatId?)  view: null (all seats) | 'seat' | 'appoint' | 'orders' | 'reports'
//   stewardsAct(game, op, ...args)      every button's action
import { ActionMenu } from './_ref.js';
import { Stewards } from '../../systems/stewards.js';
import { esc, lede, chips, purse, sectionHead, card, rowList, price } from './uiKit.js';

const KIND_ICON = { holding: '🏰', province: '👑', estates: '🌾', company: '⚖️' };
const WHO_ICON = { family: '🧑', courtier: '👥', companion: '🗡️', townsfolk: '🏘️', steward: '📜' };
const tone = (v) => (v < 30 ? 'bad' : v < 50 ? 'warn' : 'good');
const skills = (o) => `stew ${o.stewardship} · mart ${o.martial} · intr ${o.intrigue}`;

Object.assign(ActionMenu, {
    showStewards(game, view = null, seatId = null) {
        const player = game.player;
        const world = game.world;
        const v = Stewards.view(player, world);
        const seat = seatId ? v.seats.find(s => s.id === seatId) : null;
        const back = { icon: '←', name: 'Back to all seats', act: 'showStewards' };
        let html = '<div>';

        if (view === 'seat' && seat && seat.office) {
            const o = seat.office;
            const order = Stewards.order(o.orders);
            let body = `<div style="color:#cbbf9f;">${esc(o.kind)} · in office since day ${o.since}${o.servedLords ? ` · has served ${o.servedLords + 1} heads of the House` : ''}${o.kin ? ' · kin by marriage' : ''}</div>`;
            body += `<div style="margin-top:6px; color:#ece2c8;">${skills(o)} · ${esc(o.ambition)} · ${o.oath === 'house' ? 'sworn to the House' : 'loyal to you, not the House'}</div>`;
            body += `<div style="margin-top:6px;">Loyalty <b>${o.loyalty}</b> · power in ${esc(seat.place)} <b>${o.power}</b> · ${o.caught ? '<span style="color:#e0846a;">caught with a hand in the chest</span>' : `reputation: ${esc(o.reference.label)}`}${o.wage ? ` · ${o.wage}g a day` : ''}</div>`;
            if (o.suspicion) body += '<div style="margin-top:4px; color:#f0b35a;">In town they say the steward lives well beyond the wage.</div>';
            if (o.bribe) body += `<div style="margin-top:4px; color:#e0846a;">In the pay of ${esc(o.bribe)}.</div>`;
            if (o.defiant) body += '<div style="margin-top:4px; color:#e0846a;">Defies you: the dues are withheld.</div>';
            body += `<div style="margin-top:4px; color:#9d937c;">Good deeds ${o.excels} · complaints ${o.abuses} · income about ${seat.income}g a week</div>`;
            html += card(body, { icon: WHO_ICON[o.kind] || '👤', title: `${esc(seat.title)} ${esc(o.name)}`, side: esc(seat.place), tone: tone(o.loyalty) });
            const rows = [
                { icon: order.icon || '⚖️', name: `Standing order: ${esc(order.name)}`, desc: 'Change what they put first', act: 'showStewards', args: ['orders', seat.id], side: '›', tone: 'gold' },
            ];
            if (seat.kind === 'holding') {
                rows.push({ icon: '🏗️', name: `Works allowance: ${o.allowance}g a season`, desc: o.allowance ? `${o.spent}g spent this season on the order's works (from your purse)` : 'They may start no works without your gold', act: 'stewardsAct', args: ['allowance', seat.id], side: 'Change ›' });
            }
            rows.push(
                { icon: '🔎', name: 'Audit the books', desc: o.auditReady ? `${Math.round(o.auditChance * 100)}% to find a hand in the chest, if there is one. The honest resent it.` : 'Audited too recently', off: !o.auditReady || (player.gold || 0) < o.auditCost, why: !o.auditReady ? 'Audited too recently' : `The auditors want ${o.auditCost}g`, act: 'stewardsAct', args: ['audit', seat.id], side: price(o.auditCost, (player.gold || 0) >= o.auditCost) },
                { icon: '💰', name: 'Send a purse', desc: 'Gold from your purse into theirs: loyalty, and a little less temptation', act: 'stewardsAct', args: ['reward', seat.id, 'gold'], side: price(Math.max(20, (o.wage || 2) * 10), (player.gold || 0) >= Math.max(20, (o.wage || 2) * 10)) },
                { icon: '🎖️', name: 'Honour them before the court', desc: 'Costs House Prestige; loyalty, and standing in their seat', act: 'stewardsAct', args: ['reward', seat.id, 'honour'], side: '4 ⭐' },
                { icon: '⚖️', name: 'Fine them', desc: o.caught ? 'Take back everything they took. Kept on, sullen and afraid.' : 'Nothing is proven: your other stewards will call it tyranny', act: 'stewardsAct', args: ['punish', seat.id, 'fine'], side: '›', tone: o.caught ? 'warn' : 'bad' },
                { icon: '⛓️', name: 'Strip them of office in disgrace', desc: o.caught ? 'Justice seen to be done' : 'Without proof, a tyrant\'s act', act: 'stewardsAct', args: ['punish', seat.id, 'disgrace'], side: '›', tone: 'bad' },
                { icon: '🚪', name: 'Recall them', desc: o.power >= 60 && o.loyalty < 30 ? 'Strong and disloyal: they may refuse' : 'They step down', act: 'stewardsAct', args: ['recall', seat.id], side: '›', tone: 'bad' },
                back,
            );
            html += rowList(rows);
        } else if (view === 'orders' && seat && seat.office) {
            html += lede(`What should <strong>${esc(seat.office.name)}</strong> put first in ${esc(seat.place)}? The effect grows with their skill.`);
            html += rowList(Object.entries(Stewards.orders(seat.kind)).map(([id, o]) => ({
                icon: o.icon || '⚖️', name: esc(o.name), desc: esc(o.desc || ''),
                act: 'stewardsAct', args: ['order', seat.id, id],
                side: seat.office.orders === id ? '✓' : '›', tone: seat.office.orders === id ? 'gold' : '',
            })), 'Standing orders');
            html += rowList([{ icon: '←', name: 'Back', act: 'showStewards', args: ['seat', seat.id] }]);
        } else if (view === 'appoint' && seat) {
            const list = Stewards.candidates(player, world, seat.id).slice(0, 12);
            html += lede(`Who will be ${esc(seat.title.toLowerCase())} of <strong>${esc(seat.place)}</strong>? What people say of their honesty is talk, not truth.`);
            if (!list.length) html += lede('No one is free to take it. Courtiers, grown children, companions and the townsfolk of the place may serve.');
            html += rowList(list.map(c => ({
                icon: WHO_ICON[c.kind] || '👤', name: esc(c.name),
                desc: `${esc(c.blurb || c.kind)} · ${skills(c)}`,
                note: `<span style="color:${c.reference.tone === 'good' ? '#8fd18a' : c.reference.tone === 'warn' ? '#f0b35a' : '#e0846a'};">${esc(c.reference.label)}</span> <span style="color:#9d937c;">· ${Stewards.ambitionLabel(c.ambition)} · loyalty ~${c.loyalty}${c.wage ? ` · ${c.wage}g a day` : ''}</span>`,
                act: 'stewardsAct', args: ['appoint', seat.id, c.key], side: 'Appoint ›', tone: 'gold',
            })), 'Candidates');
            html += rowList([back]);
        } else if (view === 'reports') {
            html += lede('The seasons\' dispatches from your stewards. A crooked one\'s account is rosier than the truth.');
            for (const r of v.reports) html += card(r.lines.map(l => `<div style="margin:3px 0;">${esc(l)}</div>`).join(''), { icon: '📜', title: `Day ${r.day}` });
            if (!v.reports.length) html += lede('No dispatches yet: they come once a season.');
            if (v.log.length) html += sectionHead('Of late') + v.log.map(l => `<div style="font-size:11px; color:#bbb; padding:2px 0;">Day ${l.day}: ${esc(l.text)}</div>`).join('');
            html += rowList([back]);
        } else {
            const vacant = v.seats.filter(s => !s.office);
            html += lede('Your holdings, your estates, the company and the realm\'s demesne towns, each run by someone you name, by the standing order you set. They may serve you well, or they may not.');
            html += chips([purse(player.gold), ['🏛️', 'Offices', `${v.filled} / ${v.seats.length}`], ['🔎', 'Caught', v.stats.caught], ['💰', 'Recovered', `${v.stats.recovered}g`]]);
            for (const p of v.pending) {
                html += card(`<div>${esc(p.officeName)} of ${esc(p.place)} asks for the hand of <b>${esc(p.childName)}</b>. Bound to the House by marriage they would serve it better, and stand higher. (${p.daysLeft} days to answer)</div>`
                    + rowList([
                        { icon: '💍', name: 'Give your consent', act: 'stewardsAct', args: ['answer', p.id, true], side: '›', tone: 'gold' },
                        { icon: '✋', name: 'Refuse them', desc: 'They will take it hard', act: 'stewardsAct', args: ['answer', p.id, false], side: '›', tone: 'bad' },
                    ]), { icon: '💍', title: 'A proposal' });
            }
            if (!v.seats.length) html += lede('You have no seats to put a steward over yet: holdings, estates, a trading company or a crown.');
            html += rowList(v.seats.map(s => {
                const o = s.office;
                const order = o ? Stewards.order(o.orders) : null;
                const state = [];
                if (s.unrest != null) state.push(`unrest ${s.unrest}`);
                if (s.happiness != null) state.push(`mood ${s.happiness}`);
                if (s.rebellion) state.push('<span style="color:#e0846a;">in revolt</span>');
                return o ? {
                    icon: KIND_ICON[s.kind], name: `${esc(s.place)} <span style="color:#d8c27a; font-size:11px;">${esc(s.title)} ${esc(o.name)}</span>`,
                    desc: `${order.icon || ''} ${esc(order.name)} · ~${s.income}g a week${state.length ? ` · ${state.join(' · ')}` : ''}`,
                    note: `<span style="color:${o.loyalty < 30 ? '#e0846a' : o.loyalty < 50 ? '#f0b35a' : '#8fd18a'};">Loyalty ${o.loyalty}</span>${o.caught ? ' <span style="color:#e0846a;">· caught</span>' : ''}${o.suspicion ? ' <span style="color:#f0b35a;">· talk in town</span>' : ''}${o.power >= 50 ? ` <span style="color:#f0b35a;">· power ${o.power}</span>` : ''}${o.defiant ? ' <span style="color:#e0846a;">· defiant</span>' : ''}`,
                    act: 'showStewards', args: ['seat', s.id], side: '›', tone: tone(o.loyalty),
                } : {
                    icon: KIND_ICON[s.kind], name: `${esc(s.place)} <span style="color:#9d937c; font-size:11px;">no ${esc(s.title.toLowerCase())}</span>`,
                    desc: s.kind === 'holding' ? 'Ungoverned: it drifts while you are away' : 'No one runs it for you',
                    act: 'showStewards', args: ['appoint', s.id], side: 'Appoint ›', tone: 'warn',
                };
            }), 'Seats');
            html += rowList([
                vacant.length ? { icon: '✍️', name: `Fill every vacant seat (${vacant.length})`, desc: 'The best-suited of those free, by skill and good name', act: 'stewardsAct', args: ['fill'], side: '›', tone: 'gold' } : null,
                v.filled ? { icon: '💰', name: 'Every steward: maximise revenue', act: 'stewardsAct', args: ['all', 'revenue'], side: '›' } : null,
                v.filled ? { icon: '🕊️', name: 'Every steward: keep the peace', act: 'stewardsAct', args: ['all', 'peace'], side: '›' } : null,
                { icon: '📜', name: 'Dispatches and recent news', desc: v.reports.length ? `Last from day ${v.reports[0].day}` : 'None yet', act: 'showStewards', args: ['reports'], side: '›' },
            ], 'For every seat');
        }
        html += '</div>';
        game.ui.showCustomPanel('🏛️ Stewards', html);
    },

    stewardsAct(game, op, a = null, b = null) {
        const player = game.player;
        const world = game.world;
        const say = (res, title, ok = 'success') => {
            if (!res || res.success === false) game.ui.showNotification(title, (res && res.reason) || 'Not possible.', 'error');
            else if (res.text) game.ui.showNotification(title, res.text, res.found || res.refused ? 'warning' : ok);
            if (game.ui.updateStats) game.ui.updateStats(player, world);
        };
        switch (op) {
            case 'appoint': say(Stewards.appoint(player, world, a, b), '🏛️ Appointed'); return ActionMenu.showStewards(game, 'seat', a);
            case 'order': say(Stewards.setOrders(player, world, a, b), '📜 Orders'); return ActionMenu.showStewards(game, 'seat', a);
            case 'allowance': {
                const steps = Stewards.config().allowanceSteps;
                const seat = Stewards.seat(player, world, a);
                const office = Stewards.office(player, seat);
                const cur = office && office.st ? office.st.allowance || 0 : 0;
                const next = steps[(steps.indexOf(cur) + 1) % steps.length] || 0;
                say(Stewards.setAllowance(player, world, a, next), '🏗️ Allowance');
                return ActionMenu.showStewards(game, 'seat', a);
            }
            case 'audit': say(Stewards.audit(player, world, a), '🔎 Audit'); return ActionMenu.showStewards(game, 'seat', a);
            case 'reward': say(Stewards.reward(player, world, a, b), '🎖️ Reward'); return ActionMenu.showStewards(game, 'seat', a);
            case 'punish': {
                const res = Stewards.punish(player, world, a, b);
                say(res, '⚖️ Punishment', 'warning');
                return ActionMenu.showStewards(game, b === 'disgrace' ? null : 'seat', b === 'disgrace' ? null : a);
            }
            case 'recall': say(Stewards.recall(player, world, a), '🚪 Recalled', 'info'); return ActionMenu.showStewards(game);
            case 'answer': say(Stewards.answer(player, world, a, b), '💍 Your answer'); return ActionMenu.showStewards(game);
            case 'fill': {
                const r = Stewards.fillVacant(player, world);
                game.ui.showNotification('✍️ Seats filled', r.filled ? r.results.map(x => x.text).join(' ') : 'No one free to take them.', r.filled ? 'success' : 'info');
                return ActionMenu.showStewards(game);
            }
            case 'all': {
                const n = Stewards.setAllOrders(player, world, a);
                game.ui.showNotification('📜 Orders', `${n} steward${n === 1 ? '' : 's'} given the order: ${Stewards.order(a).name.toLowerCase()}.`, 'info');
                return ActionMenu.showStewards(game);
            }
            default: return ActionMenu.showStewards(game);
        }
    },
});
