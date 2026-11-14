// FeastPanel — plan a feast (guest list, menu, entertainment), see who came
// and what they made of it, and handle what happened: a brawl (the duel
// engine, or talk him down) or a betrothal suggested. Logic lives in
// systems/feasts.js; ActionMenu.showHostFeastMenu opens this.
import { ActionMenu } from './_ref.js';
import { Duels } from '../../systems/duels.js';
import { Feasts } from '../../systems/feasts.js';
import { DuelPanel } from './duel.js';
import { PlayerEffects } from './_imports.js';
import { esc, lede, chips, purse, card, rowList, sectionHead, price } from './uiKit.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): guests as checkboxes,
// menu and entertainment as rows (the chosen one lit gold), the bill as the
// last row. Clicks route through window._feast (set on each render).
const on = (call) => `onclick="window._feast.${call}"`;
const NOTE = 'font-size: 11px; color: var(--text-secondary); margin: 2px 0;';
const VERDICT = {
    honoured: ['😊', '#7fd07f', 'honoured'], content: ['🙂', '#ccc', 'content'], slighted: ['😒', '#e0a040', 'slighted'],
    insulted: ['😤', '#e07070', 'insulted'], uninvited: ['🚪', '#e07070', 'not invited — and noticed'], absent: ['✉️', '#888', 'sent regrets'],
};

function _goodsLine(course) {
    const parts = course.take.map(t => `${t.n} ${t.id.replace(/_/g, ' ')}${t.from === 'stores' ? ' (yours)' : ''}`);
    if (course.short) parts.push(`<span style="color: #e07070;">${course.short} short</span>`);
    return parts.join(', ') || '—';
}

export const FeastPanel = {
    show(game, tile, sel = null) {
        const player = game.player;
        const world = game.world;
        const plan = Feasts.plan(player, world, tile);
        if (!plan) return;
        const st = sel || { guests: plan.guests.filter(g => g.local && g.available !== false).map(g => g.id), menu: (plan.menus.find(m => m.can) || plan.menus[0] || {}).id, ent: 'none' };
        const menu = plan.menus.find(m => m.id === st.menu) || plan.menus[0];
        const ent = plan.entertainment.find(e => e.id === st.ent) || plan.entertainment[0] || { cost: 0 };
        const bill = (menu ? menu.cost : 0) + (ent.cost || 0);

        let h = '<div>';
        h += lede(`A feast in the hall at <strong>${esc(plan.settlement.name)}</strong>. Who sits at your table matters as much as what is on it.`);
        h += chips([{ icon: '🧾', label: 'The bill', value: `${bill}g`, cls: (player.gold || 0) >= bill ? 'gold' : 'dim' }, purse(player.gold)]);
        if (plan.cooldownLeft > 0) h += `<div style="${NOTE} color: #e07070;">Your stewards need ${plan.cooldownLeft} more day${plan.cooldownLeft === 1 ? '' : 's'} before another feast.</div>`;
        if (plan.townMult < 1) h += `<div style="${NOTE} color: #e0a040;">${esc(plan.settlement.name)} feasted with you lately; it will make less of this one.</div>`;

        h += sectionHead(`Guests (${st.guests.length}/${plan.maxGuests})`);
        if (!plan.guests.length) h += `<div style="${NOTE}">No lord is near, and you know no one of note in this town yet. The townsfolk will come anyway.</div>`;
        plan.guests.forEach((g, i) => {
            const on = st.guests.includes(g.id);
            const can = g.available !== false && (on || st.guests.length < plan.maxGuests);
            const regard = g.kind === 'lord' ? ` · regard ${g.regard >= 0 ? '+' : ''}${g.regard}` : '';
            const traits = g.traits && g.traits.length ? ` · ${esc(g.traits.join(', '))}` : '';
            h += `<label style="display: block; font-size: 12px; margin: 3px 0; ${can ? '' : 'opacity: 0.5;'}"><input type="checkbox" ${on ? 'checked' : ''} ${can ? '' : 'disabled'} onchange="window._feast.guest(${i})"> ${g.kind === 'lord' ? '👑' : '🧑'} <strong>${esc(g.name)}</strong> <span style="color: var(--text-muted);">${esc(g.title)}${regard}${traits}${g.reason ? ` · ${esc(g.reason)}` : ''}</span></label>`;
        });

        const courses = (m) => m.courses.map(c => `${esc(c.label)}: ${_goodsLine(c)}`).join('<br>');
        h += rowList(plan.menus.map(m => {
            const chosen = menu && m.id === menu.id;
            return {
                icon: m.icon, name: `${esc(m.label)}${chosen ? ' <span style="color:var(--gold); font-weight:normal;">✓ chosen</span>' : ''}`,
                desc: courses(m), off: !!m.short && !chosen, why: `The market cannot supply it.<br>${courses(m)}`,
                side: price(m.cost, (player.gold || 0) >= m.cost), tone: chosen ? 'gold' : null,
                attrs: chosen ? '' : on(`menu('${m.id}')`),
            };
        }), 'Menu');

        h += rowList(plan.entertainment.map(e => {
            const chosen = e.id === ent.id;
            return {
                icon: e.icon, name: `${esc(e.label)}${chosen ? ' <span style="color:var(--gold); font-weight:normal;">✓ chosen</span>' : ''}`,
                side: e.cost ? price(e.cost, (player.gold || 0) >= e.cost) : 'free', tone: chosen ? 'gold' : null,
                attrs: chosen ? '' : on(`ent('${e.id}')`),
            };
        }), 'Entertainment');

        const ok = plan.cooldownLeft === 0 && menu && menu.short === 0 && (player.gold || 0) >= bill;
        const why = plan.cooldownLeft > 0 ? 'Your stewards are not ready yet.' : !menu || menu.short ? 'The market cannot supply that menu.' : 'Your purse is short.';
        h += rowList([{ icon: '🍖', name: 'Hold the feast', desc: 'Takes the rest of the day', why, off: !ok, side: price(bill, (player.gold || 0) >= bill), tone: 'gold', attrs: ok ? on('host()') : '' }]);
        h += '</div>';
        game.ui.showCustomPanel('🍖 Plan a Feast', h);

        const redraw = () => FeastPanel.show(game, tile, st);
        window._feast = {
            guest: (i) => {
                const g = plan.guests[i];
                if (!g) return;
                st.guests = st.guests.includes(g.id) ? st.guests.filter(x => x !== g.id) : [...st.guests, g.id];
                redraw();
            },
            menu: (id) => { st.menu = id; redraw(); },
            ent: (id) => { st.ent = id; redraw(); },
            host: () => {
                if (!ActionMenu.commitPendingAP(game)) return;
                const r = Feasts.host(player, world, tile, { guests: st.guests, menu: st.menu, entertainment: st.ent });
                if (!r.success) { game.ui.showNotification('🍖 Feast', r.reason, 'error'); return; }
                FeastPanel.showResult(game, tile, r);
            },
        };
    },

    showResult(game, tile, r) {
        const player = game.player;
        const world = game.world;
        let h = '<div>';
        h += lede(`<strong>${esc(r.menu)}</strong>, ${esc(r.entertainment || 'conversation')}: ${r.spent} gold spent${r.fromStores ? `, ${r.fromStores} portions from your own stores` : ''}.`);
        h += chips([['⭐', 'Renown', `+${r.renown}`], ['☯️', 'Karma', `+${r.karma}`], ['😊', 'Town mood', `+${r.happiness}`], r.reputation ? ['🤝', 'Reputation', `+${r.reputation}`] : null]);
        for (const n of r.notes) h += `<div style="${NOTE}">${esc(n)}</div>`;
        if (r.guests.length) {
            h += sectionHead('The guests');
            for (const g of r.guests) {
                const v = VERDICT[g.verdict] || VERDICT.content;
                h += `<div style="font-size: 12px; margin: 2px 0;">${v[0]} <strong>${esc(g.name)}</strong> <span style="color: ${v[1]};">${v[2]}</span>${g.delta ? ` <span style="color: var(--text-muted);">(${g.delta > 0 ? '+' : ''}${g.delta})</span>` : ''}</div>`;
            }
        }
        let follow = null;
        if (r.incidents.length) {
            h += sectionHead('During the evening');
            for (const inc of r.incidents) {
                h += card(`${inc.icon} ${esc(inc.text)}${inc.renown ? ` <span style="color: var(--gold);">(+${inc.renown} renown)</span>` : ''}`);
                if (inc.followUp) follow = inc.followUp;
            }
        }
        if (follow === 'brawl') {
            h += rowList([
                { icon: '👊', name: 'Fight him', desc: 'Fists and benches, before your guests', tone: 'gold', attrs: on('fight()') },
                { icon: '🗣️', name: 'Talk him down', desc: 'Calm words and a full cup', attrs: on('calm()') },
            ], 'What will you do?');
        } else if (follow === 'betrothal') {
            h += rowList([
                ...Feasts.eligibleChildren(player).map(c => ({ icon: '💍', name: `Promise ${esc(c.name)}`, tone: 'gold', attrs: on(`betroth(${c.id})`) })),
                { icon: '🙇', name: 'Politely decline', desc: 'The evening ends', act: 'closePanelAndEndDay' },
            ], 'A match is suggested');
        } else {
            h += rowList([{ icon: '➡️', name: 'Continue', desc: 'The evening ends', act: 'closePanelAndEndDay', tone: 'gold' }]);
        }
        h += '</div>';
        game.ui.showCustomPanel('🍖 The Feast', h);
        game.ui.updateStats(player, world);

        const done = (res) => {
            game.ui.showNotification('🍺 The Brawl', res.success ? `${res.text} (${res.renown >= 0 ? '+' : ''}${res.renown} renown)` : res.reason, res.success ? 'info' : 'error');
            game.ui.updateStats(player, world);
            game.ui.hideCustomPanel();
            game.endDay();
        };
        window._feast = Object.assign(window._feast || {}, {
            calm: () => done(Feasts.settleBrawl(player, world, 'calm')),
            fight: () => {
                const me = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player) });
                const foe = Duels.fromProfile(Feasts.brawlerProfile(player, world));
                DuelPanel.open(game, {
                    a: me, b: foe, mode: 'spar', title: '🍺 A Brawl at the Feast',
                    intro: 'Fists and benches, before your own guests.',
                    onFinish: (res) => done(Feasts.settleBrawl(player, world, res.playerWon ? 'won' : 'lost')),
                });
            },
            betroth: (childId) => {
                const res = Feasts.acceptBetrothal(player, world, childId);
                game.ui.showNotification('💍 Betrothal', res.success ? `${res.child.firstName} is promised to ${res.spouse.name}.` : res.reason, res.success ? 'success' : 'error');
                if (res.success) { game.ui.hideCustomPanel(); game.endDay(); }
            },
        });
    },
};
