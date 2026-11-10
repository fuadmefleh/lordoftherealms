// ActionMenu — the Household Guard: the escort a realm keeps for its lords
// and its crown, riding with the player. Who it is, what the crown pays and
// feeds it, its arms, morale and loyalty; send it home, ask for more men.
// Logic lives in player/realmEscort.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { RealmEscort } from '../../player/realmEscort.js';
import { BTN_GOLD, BTN_DARK, BTN_OFF, CARD, esc, bullets } from './uiKit.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px; color: var(--gold);';
const WHY = { title: 'the rank was lost', exile: 'exiled', turned: 'turned against the realm', fallen: 'fell to the last man or the realm fell', home: 'sent home', deserted: 'deserted, unpaid', another: 'another realm\'s men came', loyal: 'stood with the old crown', treason: 'broken with a coup' };

function _bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:3px 0;"><div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

function _btn(label, action, style, ok = true, title = '') {
    const a = esc(JSON.stringify([action]));
    return ok
        ? `<button data-am-act="guardAct" data-am-args="${a}" style="${style}" title="${esc(title)}">${label}</button>`
        : `<button style="${BTN_OFF}" disabled title="${esc(title)}">${label}</button>`;
}

Object.assign(ActionMenu, {
    /** The Household Guard (Dynasty menu, Army Command, a settlement's actions). */
    showHouseholdGuard(game, message = null) {
        const { player, world } = game;
        if (!player || !world) return;
        const v = RealmEscort.view(player, world);
        const g = v.guard;
        const R = v.rank || {};
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += `<div style="${CARD} border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;

        if (!g) {
            html += `<div style="${CARD}">`;
            html += '<div style="font-weight:bold;color:var(--gold);">🛡️ A guard of the realm\'s soldiers</div>';
            html += bullets([
                'A realm keeps a guard for its lords and its crown: a lord (a Lord\'s office, or estates in the realm) a few riders and men-at-arms, a great lord a company, the crown its Royal Guard.',
                'They are the realm\'s own soldiers, out of its army and armed from its armoury, and the crown pays and feeds them, not you. They ride and fight with you, and outlaws think twice.',
                'They go home if you lose your rank, are exiled or turn against the realm. If the treasury cannot pay them, they slip away.',
            ]);
            if (v.standing) {
                html += `<div style="margin-top:6px;">As ${esc(v.standing.why)}, ${esc(v.standing.kingdom.name)} would keep a <b>${esc(String(R.label || 'guard').toLowerCase())}</b> for you.</div>`;
                if (v.homeUntil > (world.day || 0)) html += `<div style="font-size:11px;color:#bbb;">You sent them home; the crown sends them again unasked on day ${v.homeUntil}.</div>`;
                html += v.ask.ok ? _btn(`🛡️ Ask ${esc(v.standing.kingdom.name)} for the guard (${v.ask.men} men)`, 'ask', BTN_GOLD + 'margin-top:6px;')
                    : `<div style="color:#e8a0a0;margin-top:6px;">${esc(v.ask.reason)}</div>`;
            } else html += `<div style="color:#e8a0a0;margin-top:6px;">${esc(v.ask.reason || 'You hold no rank in a realm.')}</div>`;
            html += '</div>';
        } else {
            const k = v.kingdom;
            html += `<div style="${CARD}">`;
            html += `<div style="display:flex;justify-content:space-between;"><b>🛡️ ${esc(R.label || 'Household guard')} of ${esc(g.kingdomName)}</b><span style="color:#aaa;">since day ${g.since}</span></div>`;
            html += `<div style="font-size:11px;color:#bbb;">${v.men} men of ${esc(g.kingdomName)}'s army ride with you, paid by the crown${v.standing ? ` (${esc(v.standing.why)})` : ''}.</div>`;
            const mc = g.morale >= 55 ? '#7fd07f' : g.morale >= 30 ? '#f5c542' : '#e06060';
            html += `<div style="font-size:11px;">Morale <span style="color:${mc};font-weight:bold;">${Math.round(g.morale)}</span></div>${_bar(g.morale, 100, mc)}`;
            html += `<div style="font-size:11px;">Loyalty to you <b>${Math.round(g.loyalty)}</b> <span style="color:#999;">(grows with service and victories)</span></div>${_bar(g.loyalty, 100, '#c9a54a')}`;
            html += `<div style="font-size:11px;color:#bbb;margin-top:4px;">Wages ${v.wage}g a day from ${esc(g.kingdomName)}'s treasury (${Math.floor((k && k.treasury) || 0)}g), into the men's pockets: ${Math.round(g.pockets)}g, spent in the towns where you lodge.</div>`;
            if (g.owed > 0.5) html += `<div style="font-size:11px;color:#e8a0a0;">The crown owes them ${Math.round(g.owed)}g${g.arrearsDays ? `, unpaid ${g.arrearsDays} days` : ''}. Unpaid past a week, they slip away.</div>`;
            html += `<div style="font-size:11px;color:#bbb;">Bread for ${v.supplyDays} days, bought by the crown from the granaries of the towns you pass.</div>`;
            html += '</div>';

            html += `<div style="${HEAD}">The companies</div>`;
            for (const u of v.units) {
                html += `<div style="font-size:11px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05);">${esc(u.icon || '⚔️')} <b>${esc(u.name)}</b> · ${u.strength} men · ${u.wage}g/day <span style="color:#999;">${u.kit ? `· ${esc(u.kit)}` : '· unarmed: the armoury was bare'}${u.ammo != null && u.ammo !== undefined && /bow/i.test(u.kit || '') ? ` · ${Math.floor(u.ammo)} arrows` : ''}</span></div>`;
            }
            const r = g.record || {};
            html += `<div style="font-size:11px;color:#999;margin-top:4px;">${r.battles || 0} battles (${r.won || 0} won) · ${r.fallen || 0} fallen · ${r.deserted || 0} deserted · ${Math.round(r.paid || 0)}g paid, ${Math.round(r.fed || 0)}g of bread</div>`;

            html += `<div style="${HEAD}">Orders</div>`;
            html += v.ask.ok ? _btn(`➕ Ask for more men (${v.ask.men} men, +${v.ask.wage}g a day to the crown${v.ask.cost ? `, −${v.ask.cost} standing` : ''})`, 'ask', BTN_GOLD + 'display:block;width:100%;margin-bottom:6px;')
                : `<div style="font-size:11px;color:#e8a0a0;margin-bottom:6px;">➕ ${esc(v.ask.reason)}</div>`;
            html += _btn('🏠 Send them home to the realm\'s army', 'home', BTN_DARK + 'display:block;width:100%;', true, 'They ride back with their arms. The crown will not send them again unasked for a while.');
            if (g.log && g.log.length) {
                html += `<div style="${HEAD}">Lately</div>`;
                for (const l of g.log.slice(0, 6)) html += `<div style="font-size:11px;color:#bbb;">Day ${l.day}: ${esc(l.text)}</div>`;
            }
        }
        if (v.past.length) {
            html += `<div style="${HEAD}">Guards before</div>`;
            for (const p of v.past.slice(0, 4)) {
                const r = p.record || {};
                html += `<div style="font-size:11px;color:#999;">🛡️ ${esc((RealmEscort.rankDef(p.rank) || {}).label || 'Guard')} of ${esc(p.kingdomName)}, day ${p.since}–${p.ended}: ${esc(WHY[p.why] || p.why)} · ${r.fallen || 0} fallen</div>`;
            }
        }
        html += '</div>';
        game.ui.showCustomPanel('🛡️ Household Guard', html);
    },

    guardAct(game, action) {
        const { player, world } = game;
        let res;
        if (action === 'ask') res = RealmEscort.ask(player, world);
        else if (action === 'home') res = RealmEscort.sendHome(player, world);
        else return;
        game.ui.updateStats(player, world);
        ActionMenu.showHouseholdGuard(game, { html: esc(res.message || res.reason || 'Done.'), color: res.success ? 'rgba(127,208,127,0.4)' : 'rgba(224,96,96,0.5)' });
    },
});
