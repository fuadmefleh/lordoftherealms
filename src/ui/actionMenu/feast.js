// FeastPanel — plan a feast (guest list, menu, entertainment), see who came
// and what they made of it, and handle what happened: a brawl (the duel
// engine, or talk him down) or a betrothal suggested. Logic lives in
// systems/feasts.js; ActionMenu.showHostFeastMenu opens this.
import { ActionMenu } from './_ref.js';
import { Duels } from '../../systems/duels.js';
import { Feasts } from '../../systems/feasts.js';
import { DuelPanel } from './duel.js';
import { PlayerEffects } from './_imports.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, CARD, esc } from './uiKit.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px; color: var(--text-secondary);';
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
        h += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">A feast in the hall at <strong>${esc(plan.settlement.name)}</strong>. Who sits at your table matters as much as what is on it.</p>`;
        if (plan.cooldownLeft > 0) h += `<div style="${NOTE} color: #e07070;">Your stewards need ${plan.cooldownLeft} more day${plan.cooldownLeft === 1 ? '' : 's'} before another feast.</div>`;
        if (plan.townMult < 1) h += `<div style="${NOTE} color: #e0a040;">${esc(plan.settlement.name)} feasted with you lately; it will make less of this one.</div>`;

        h += `<div style="${HEAD}">Guests (${st.guests.length}/${plan.maxGuests})</div>`;
        if (!plan.guests.length) h += `<div style="${NOTE}">No lord is near, and you know no one of note in this town yet. The townsfolk will come anyway.</div>`;
        plan.guests.forEach((g, i) => {
            const on = st.guests.includes(g.id);
            const can = g.available !== false && (on || st.guests.length < plan.maxGuests);
            const regard = g.kind === 'lord' ? ` · regard ${g.regard >= 0 ? '+' : ''}${g.regard}` : '';
            const traits = g.traits && g.traits.length ? ` · ${esc(g.traits.join(', '))}` : '';
            h += `<label style="display: block; font-size: 12px; margin: 3px 0; ${can ? '' : 'opacity: 0.5;'}"><input type="checkbox" ${on ? 'checked' : ''} ${can ? '' : 'disabled'} onchange="window._feast.guest(${i})"> ${g.kind === 'lord' ? '👑' : '🧑'} <strong>${esc(g.name)}</strong> <span style="color: var(--text-muted);">${esc(g.title)}${regard}${traits}${g.reason ? ` · ${esc(g.reason)}` : ''}</span></label>`;
        });

        h += `<div style="${HEAD}">Menu</div>`;
        for (const m of plan.menus) {
            const on = menu && m.id === menu.id;
            h += `<div style="${CARD}${on ? ' border-color: var(--gold);' : ''} padding: 6px 8px;">`;
            h += `<div>${m.icon} <strong>${esc(m.label)}</strong> — <span style="color: var(--gold);">${m.cost}g at market</span>${m.short ? ' <span style="color: #e07070;">(the market cannot supply it)</span>' : ''}</div>`;
            for (const c of m.courses) h += `<div style="${NOTE}">${esc(c.label)}: ${_goodsLine(c)}</div>`;
            if (!on) h += `<button onclick="window._feast.menu('${m.id}')" style="${BTN_PLAIN}">Choose</button>`;
            h += '</div>';
        }

        h += `<div style="${HEAD}">Entertainment</div>`;
        for (const e of plan.entertainment) {
            const on = e.id === ent.id;
            h += `<button onclick="window._feast.ent('${e.id}')" style="${on ? BTN_GOLD : BTN_PLAIN}">${e.icon} ${esc(e.label)}${e.cost ? ` (${e.cost}g)` : ''}</button>`;
        }

        const ok = plan.cooldownLeft === 0 && menu && menu.short === 0 && (player.gold || 0) >= bill;
        h += `<div style="margin-top: 12px;">`;
        h += ok
            ? `<button onclick="window._feast.host()" style="${BTN_GOLD} width: 100%; padding: 10px;">🍖 Hold the feast (${bill}g, the rest of the day)</button>`
            : `<button disabled style="${BTN_OFF} width: 100%; padding: 10px;">🍖 Hold the feast (${bill}g)</button>`;
        h += '</div></div>';
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
        h += `<div style="${CARD}"><strong>${esc(r.menu)}</strong>, ${esc(r.entertainment || 'conversation')} — ${r.spent} gold spent${r.fromStores ? `, ${r.fromStores} portions from your own stores` : ''}.`;
        h += `<div style="font-size: 12px; margin-top: 4px;">⭐ +${r.renown} renown · ☯️ +${r.karma} karma · 😊 town mood +${r.happiness}${r.reputation ? ` · reputation +${r.reputation}` : ''}</div>`;
        for (const n of r.notes) h += `<div style="${NOTE}">${esc(n)}</div>`;
        h += '</div>';
        if (r.guests.length) {
            h += `<div style="${HEAD}">The guests</div>`;
            for (const g of r.guests) {
                const v = VERDICT[g.verdict] || VERDICT.content;
                h += `<div style="font-size: 12px; margin: 2px 0;">${v[0]} <strong>${esc(g.name)}</strong> <span style="color: ${v[1]};">${v[2]}</span>${g.delta ? ` <span style="color: var(--text-muted);">(${g.delta > 0 ? '+' : ''}${g.delta})</span>` : ''}</div>`;
            }
        }
        let follow = null;
        if (r.incidents.length) {
            h += `<div style="${HEAD}">During the evening</div>`;
            for (const inc of r.incidents) {
                h += `<div style="${CARD}">${inc.icon} ${esc(inc.text)}${inc.renown ? ` <span style="color: var(--gold);">(+${inc.renown} renown)</span>` : ''}</div>`;
                if (inc.followUp) follow = inc.followUp;
            }
        }
        if (follow === 'brawl') {
            h += `<button onclick="window._feast.fight()" style="${BTN_GOLD}">👊 Fight him</button><button onclick="window._feast.calm()" style="${BTN_PLAIN}">🗣️ Talk him down</button>`;
        } else if (follow === 'betrothal') {
            for (const c of Feasts.eligibleChildren(player)) h += `<button onclick="window._feast.betroth(${c.id})" style="${BTN_GOLD}">💍 Promise ${esc(c.name)}</button>`;
            h += `<button data-am-act="closePanelAndEndDay" style="${BTN_PLAIN}">Politely decline</button>`;
        }
        if (follow !== 'brawl') h += `<button data-am-act="closePanelAndEndDay" style="${BTN_GOLD} width: 100%; padding: 9px; margin-top: 8px;">Continue</button>`;
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
