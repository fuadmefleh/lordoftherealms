// ActionMenu — 🪑 Succession & Retirement (House → Succession & Retirement):
// step down for a child while alive (the rightful heir, or another at a
// cost; a child under a regent — the old ruler themself, if you like), the
// court's pressure and demand to step down, and the rulers who stepped down
// living on: their pension, residence, counsel, honours, gifts and plots.
// Logic lives in systems/abdication.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Abdication } from '../../systems/abdication.js';
import { Counsel } from '../../systems/counsel.js';
import { lede, chips, sectionHead, rowList, card, price, bullets, kv, esc, BTN_GOLD } from './uiKit.js';

const _tone = (v) => (v >= 60 ? 'good' : v >= 35 ? 'warn' : 'bad');

function _elderCard(v, player, cfg) {
    const e = v.e;
    let body = chips([
        [v.residence.icon, v.residence.label, ''],
        ['🎂', 'Age', v.age],
        { icon: '🤝', label: 'Respect', value: e.respect, cls: e.respect < 35 ? 'bad' : '' },
        ['🔥', 'Ambition', e.ambition],
        ['💰', 'Purse', `${v.purse}g`],
        v.favourite ? ['💛', 'Favourite', esc(v.favourite)] : null,
    ].filter(Boolean));
    const lines = [];
    lines.push(`Stepped down after ${e.reignYears} years${e.how === 'forced' ? ', made to by the court' : e.how === 'counselled' ? ', at the court’s urging' : ''}${e.passedOver ? ', passing over the rightful heir' : ''}.`);
    lines.push(`Pension ${e.pension}g a day${e.owed ? ` — <span style="color:#e0846a;">${Math.round(e.owed)}g owed</span>` : ''}; paid ${Math.round(e.paid)}g in all.`);
    if (v.regent) lines.push('Rules as regent in your name.');
    if (e.shadow) lines.push('<span style="color:#e0846a;">Their people hold the seals and skim the treasury.</span>');
    else if (e.rumoured) lines.push('<span style="color:#f0b35a;">It is whispered that they mean to rule again from behind your seat.</span>');
    if (e.skimmed > 0) lines.push(`They have taken ${Math.round(e.skimmed)}g from the treasury.`);
    body += bullets(lines);
    const id = e.npcId;
    const rows = [
        { icon: '🗣️', name: 'Seek their counsel', desc: e.residence === 'court' ? 'They hear things at court, and know the craft of the seat' : 'They know the craft of the seat', act: 'abdicationAct', args: ['counsel', id], off: v.counselIn > 0, why: `Ask again in ${v.counselIn} days` },
        { icon: '⭐', name: 'Honour them before the court', desc: 'Respect up, ambition down', side: `${cfg.honourPrestige} ⭐`, act: 'abdicationAct', args: ['honour', id] },
        { icon: '🎁', name: 'A gift of gold', desc: 'From the House purse into theirs', side: price(cfg.giftGold, (player.gold || 0) >= cfg.giftGold), act: 'abdicationAct', args: ['gift', id] },
    ];
    const choices = Array.isArray(cfg.pensionChoices) ? cfg.pensionChoices : [0, 2, 4, 8, 15];
    const pension = choices.filter(g => g !== e.pension).map(g => ({
        icon: g > e.pension ? '⬆️' : '⬇️', name: `Pension of ${g}g a day`, desc: g < e.pension ? 'They will not forget it' : 'They will remember it kindly',
        act: 'abdicationAct', args: ['pension', id, g], tone: g < e.pension ? 'bad' : 'good',
    }));
    const moves = Object.entries(Abdication.RESIDENCE).filter(([k]) => k !== e.residence).map(([k, r]) => ({
        icon: r.icon, name: k === 'monastery' ? 'Send them to a monastery' : k === 'estate' ? 'Retire them to an estate' : 'Bring them back to court',
        desc: k === 'monastery' && (e.rumoured || e.shadow) ? 'The plot exposed: it ends, and part of what they took comes back' : r.blurb,
        side: k === 'monastery' && !(e.respect >= 60 && !e.rumoured && !e.shadow) ? `${e.rumoured || e.shadow ? cfg.exposePrestige : cfg.accusePrestige} ⭐` : '',
        act: 'abdicationAct', args: ['move', id, k], tone: k === 'monastery' && (e.rumoured || e.shadow) ? 'gold' : '',
    }));
    body += rowList(rows) + rowList(pension, 'The pension') + rowList(moves, 'Where they live');
    return card(body, { icon: '👴', title: esc(e.name), side: e.shadow ? 'behind the seat' : '', tone: e.shadow ? 'bad' : _tone(e.respect) });
}

Object.assign(ActionMenu, {
    /** The Succession & Retirement panel. step: { pick, regent } while choosing. */
    showAbdication(game, message = null, step = null) {
        const player = game.player;
        const world = game.world;
        if (!player || !world) return;
        const v = Abdication.view(player, world);
        const cfg = v.cfg;
        let html = '<div style="font-size:12px; max-height:560px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede('You may set down the seat while you live. You go on as the heir you choose; the old ruler lives on — at court, on an estate or in a monastery — on a pension from the House, and remembers how they were treated.');

        // The court's demand
        if (v.demand) {
            let body = `<div style="color:#e0b9a8; margin-bottom:4px;">${esc((v.demand.reasons || []).slice(0, 3).join('; '))}.</div>`;
            body += kv('Days to answer', v.demandDays);
            const heir = v.successors.find(s => s.rightful);
            body += rowList([
                heir ? { icon: '🪑', name: `Step down for ${esc(heir.name)}`, desc: 'With grace: kinder to you than being deposed', act: 'abdicationAct', args: ['pick', heir.id], tone: 'gold' } : null,
                { icon: '⭐', name: 'Face the lords down', desc: 'Hold the seat', side: `${cfg.pressure.holdPrestige} ⭐`, act: 'abdicationAct', args: ['hold', 'prestige'] },
                { icon: '💰', name: 'Buy the court’s loyalty', desc: 'Into your courtiers’ purses', side: price(cfg.pressure.holdGold, (player.gold || 0) >= cfg.pressure.holdGold), act: 'abdicationAct', args: ['hold', 'gold'] },
            ]);
            html += card(body, { icon: '⚔️', title: 'The lords demand you step down', side: `${v.demandDays} day(s)`, tone: 'bad' });
        } else if (v.pressure.score > 0) {
            html += sectionHead(`🪑 The court’s mood — pressure ${v.pressure.score}`);
            html += bullets(v.pressure.reasons.map(r => `${esc(r.text)} <span style="color:#9d937c;">(+${r.weight})</span>`));
            if (v.pressure.score >= v.counselAt) html += `<div style="color:#f0b35a; margin:2px 2px 8px;">At ${v.demandAt} for some weeks, the lords will demand that you step down.</div>`;
        }

        // The rulers who stepped down
        const living = v.elders.filter(x => x.e.alive);
        if (living.length) {
            html += sectionHead('👴 Those Who Stepped Down');
            for (const x of living) html += _elderCard(x, player, cfg);
        }
        const dead = v.elders.filter(x => !x.e.alive && x.e.died);
        if (dead.length) {
            html += rowList(dead.map(x => ({ icon: '🕯️', name: esc(x.e.name), desc: `Stepped down day ${x.e.abdicatedDay}; died of ${esc(x.e.died.cause)}, aged ${x.e.died.age}` })), 'In Memory');
        }

        // Stepping down
        html += sectionHead('🪑 Step Down');
        if (v.blocked) {
            html += `<div style="color:#9d937c; margin:0 2px 8px;">${esc(v.blocked)}</div>`;
        } else if (!step || !step.pick) {
            html += rowList(v.successors.map(s => ({
                icon: s.minor ? '🧒' : '👑', name: esc(s.name), desc: `${s.age} years${s.rightful ? ' · the rightful heir' : ''}${s.minor ? ' · reigns under a regent' : ''}${s.passOver ? ' · passes over the rightful heir: a claim nursed' : ''}`,
                side: s.prestige ? `${s.prestige} ⭐` : 'Choose ›', act: 'abdicationAct', args: ['pick', s.id], tone: s.rightful ? 'gold' : s.passOver ? 'warn' : '',
            })));
        } else {
            const s = v.successors.find(x => x.id === step.pick);
            if (!s) {
                html += rowList([{ icon: '↩', name: 'Choose again', act: 'abdicationAct', args: ['back'] }]);
            } else if (s.minor && !step.regent) {
                html += `<div style="color:#cbbf9f; margin:0 2px 6px;">${esc(s.name)} is ${s.age}: who rules in their name until they come of age?</div>`;
                html += rowList(v.regentOptions.map(r => ({ icon: r.id === 'elder' ? '👴' : '👤', name: esc(r.name), desc: esc(r.blurb || ''), act: 'abdicationAct', args: ['regent', s.id, r.id], tone: r.id === 'elder' ? 'gold' : '' })));
                html += rowList([{ icon: '↩', name: 'Choose another child', act: 'abdicationAct', args: ['back'] }]);
            } else {
                const endow = Math.min(cfg.endowmentMax, Math.floor((player.gold || 0) * cfg.endowmentShare));
                html += `<div style="color:#cbbf9f; margin:0 2px 6px;">You will go on as <strong>${esc(s.name)}</strong>${step.regent ? ', under a regent' : ''}. You take ${endow}g into retirement and a pension of ${cfg.pension}g a day. Where will you live?</div>`;
                html += rowList(Object.entries(Abdication.RESIDENCE).map(([k, r]) => ({
                    icon: r.icon, name: `Step down — ${r.label.toLowerCase()}`, desc: r.blurb, act: 'abdicationAct', args: ['do', s.id, step.regent || null, k], tone: 'gold',
                })));
                html += rowList([{ icon: '↩', name: 'Choose another child', act: 'abdicationAct', args: ['back'] }]);
            }
        }
        if (v.record.length) {
            html += rowList(v.record.map(r => ({ icon: r.how === 'forced' ? '⚔️' : '🪑', name: `${esc(r.name)} → ${esc(r.to)}`, desc: `Day ${r.day}${r.how === 'forced' ? ' · deposed' : r.how === 'counselled' ? ' · at the court’s urging' : ''}${r.passedOver ? ' · the rightful heir passed over' : ''}${r.minor ? ' · under a regent' : ''}` })), 'Past Abdications');
        }
        html += '</div>';
        game.ui.showCustomPanel('🪑 Succession & Retirement', html);
    },

    /** The panel's rows (data-am-act="abdicationAct"). */
    abdicationAct(game, action, a = null, b = null, c = null) {
        const player = game.player;
        const world = game.world;
        if (action === 'pick') return ActionMenu.showAbdication(game, null, { pick: a });
        if (action === 'regent') return ActionMenu.showAbdication(game, null, { pick: a, regent: b });
        if (action === 'back') return ActionMenu.showAbdication(game);
        let res;
        if (action === 'do') {
            res = Abdication.abdicate(player, world, { childId: a, regent: b, residence: c, secure: true });
            if (!res.success) {
                game.ui.showNotification('🪑 Step Down', res.reason || 'That cannot be done.', 'error');
                return;
            }
            Counsel.invalidate(player);
            const sc = res.succession || {};
            let html = '<div>';
            html += lede(`You are now <strong>${esc(player.name)}</strong>. ${esc(res.text)}`);
            const notes = [];
            if (sc.regency) notes.push(`👑 ${esc(sc.regency.regent.name)} rules as regent until you come of age at ${sc.regency.majorityAge}.`);
            for (const l of ((sc.heirRecord && sc.heirRecord.lines) || [])) notes.push(`${l.icon} ${esc(l.text)}`);
            const hr = sc.house || {};
            if (hr.disputed) notes.push(hr.secured ? 'A claim was pressed — quelled with Prestige.' : 'A disputed succession cost the House some of its holdings.');
            if (notes.length) html += card(bullets(notes));
            html += `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD} display:block; width:100%; margin-top:10px; padding:10px;">Begin Your Story</button>`;
            html += '</div>';
            game.ui.hideCustomPanel();
            game.ui.showCustomPanel('👑 A New Chapter', html);
            game.ui.updateStats(player, world);
            return;
        }
        if (action === 'hold') res = Abdication.holdSeat(player, world, a);
        else if (action === 'counsel') res = Abdication.counsel(player, world, a);
        else if (action === 'honour') res = Abdication.honour(player, world, a);
        else if (action === 'gift') res = Abdication.gift(player, world, a);
        else if (action === 'pension') res = Abdication.setPension(player, world, a, b);
        else if (action === 'move') res = Abdication.setResidence(player, world, a, b);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('🪑 Succession & Retirement', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        Counsel.invalidate(player);
        game.ui.updateStats(player, world);
        ActionMenu.showAbdication(game, { html: esc(res.text || 'Done.'), tone: 'good' });
    },
});
