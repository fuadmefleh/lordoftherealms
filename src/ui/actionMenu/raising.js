// ActionMenu — the heirs you raise (systems/raising.js):
//   _raisingHtml        a child's page (showChildPanel): the bond, time
//                       together, and — once grown — the coming-of-age summary
//   _raisingTutorRows   tutor rows for real people (courtiers, people you
//                       know, the townsfolk where you stand), paid wages
//   showHouseWards      Dynasty → Wards at Court: the wards the House keeps,
//                       and the realms that would send one
// Logic lives in the system; these panels present it in the action menu's
// voice (ui/actionMenu/uiKit.js).
import { ActionMenu } from './_ref.js';
import { Raising } from '../../systems/raising.js';
import { Upbringing } from '../../systems/upbringing.js';
import { esc, sectionHead, lede, card, rowList, price, chips } from './uiKit.js';

const MUTED = 'color:#9d937c; font-size:11px;';
const GAIN_ICONS = {
    strength: '💪', charisma: '✨', intelligence: '🧠', faith: '🙏', luck: '🍀',
    combat: '⚔️', commerce: '💰', leadership: '👑', diplomacy: '🤝', stealth: '🕵️', cartography: '🗺️',
};

function _bar(v, color) {
    const pct = Math.max(0, Math.min(100, Math.round(v || 0)));
    return `<div style="background:rgba(0,0,0,0.35); border-radius:3px; height:5px; margin:3px 0 6px;"><div style="width:${pct}%; height:5px; border-radius:3px; background:${color};"></div></div>`;
}

function _gains(g) {
    const parts = Object.entries(g || {}).filter(([, v]) => v).map(([k, v]) => `${GAIN_ICONS[k] || k} ${v > 0 ? '+' : ''}${v}`);
    return parts.join(' · ');
}

function _bondColor(v) {
    return v >= 70 ? '#e07a9a' : v >= 45 ? '#d6b46a' : v > 25 ? '#8aa0b8' : '#7a6f88';
}

Object.assign(ActionMenu, {
    /** The bond, time together, and the coming-of-age summary on a child's page. */
    _raisingHtml(game, child) {
        const player = game.player;
        const world = game.world;
        if (!child || child.isAlive === false) return '';
        const up = Upbringing.ensure(child);
        const r = Raising.ensure(child);
        let html = '';

        // The coming-of-age summary
        const s = up.comeOfAge ? Raising.comingOfAgeSummary(player, world, child) : null;
        if (s) {
            let body = `<div style="color:#ece2c8;">${esc(s.text)}</div>`;
            const g = _gains(s.gains);
            if (g) body += `<div style="${MUTED} margin-top:4px;">Since age ${s.fromAge}: ${g}</div>`;
            html += card(body, { icon: s.gradeIcon, title: `Coming of Age — ${esc(s.grade)}`, side: `❤️ ${esc(s.bondLabel)}`, tone: 'gold' });
            return html;
        }

        // The bond and time together
        const bond = Math.round(r.bond);
        const st = Raising.timeStatus(player, world, child);
        html += sectionHead('Time Together');
        html += `<div style="font-size:11px; color:#cbbf9f;">❤️ Bond with you: <b>${esc(Raising.bondLabel(bond))}</b> (${bond}) · ${st.left} of ${Raising.config().timesPerYear} days left this year · ${r.timeCount} spent in all</div>`;
        html += _bar(bond, _bondColor(bond));
        html += lede('A close child takes more of your character, comes of age gentler, and is welcomed as your heir. A child left alone for a year drifts away.');
        if (!st.ok) {
            html += `<div style="${MUTED} margin:0 2px 6px;">${esc(st.reason)}</div>`;
        } else {
            html += rowList(Raising.activitiesFor(player, world, child).map(a => {
                const bondTxt = `${a.bond > 0 ? '+' : ''}${a.bond} ❤️`;
                const f = a.parentFactor !== 1 ? ` · your teaching ×${a.parentFactor.toFixed(2)}` : '';
                return {
                    icon: a.icon, name: esc(a.name), desc: `${esc(a.blurb || '')}${f}`,
                    off: !a.fits, why: esc(a.why || ''),
                    attrs: `onclick="window._raisingUI.time('${esc(child.id)}','${esc(a.id)}')"`,
                    side: bondTxt, tone: a.bond < 0 ? 'bad' : (a.bond >= 9 ? 'good' : ''),
                };
            }));
        }

        window._raisingUI = Object.assign(window._raisingUI || {}, {
            time: (id, actId) => {
                const res = Raising.spendTime(player, world, id, actId);
                if (!res.success) return game.ui.showNotification('👪 Time Together', res.reason, 'error');
                const g = _gains(res.gains);
                game.ui.updateStats(player, world);
                ActionMenu.showChildPanel(game, id, {
                    html: `${res.activity.icon} ${esc(res.text)}<div style="${MUTED} margin-top:3px;">❤️ ${res.bondDelta > 0 ? '+' : ''}${res.bondDelta}${g ? ` · ${g}` : ''}</div>`,
                    color: res.hurt ? 'rgba(224,150,96,0.5)' : null,
                });
            },
        });
        return html;
    },

    /** Tutor rows for real people (shown with the masters for hire). */
    _raisingTutorRows(game, child) {
        const player = game.player;
        const world = game.world;
        const cur = Upbringing.ensure(child).tutor;
        // (the one already teaching is not offered again)
        const list = Raising.tutorCandidates(player, world, child.id).filter(c => !(cur && cur.npcId && cur.npcId === c.npcId));
        const focus = Upbringing.ensure(child).focus;
        window._raisingUI = Object.assign(window._raisingUI || {}, {
            hire: (id, npcId, folkUid) => {
                const res = Raising.hireTutor(player, world, id, npcId ? { npcId } : { folkUid });
                if (!res.success) return game.ui.showNotification('👨‍🏫 Tutor', res.reason, 'error');
                game.ui.updateStats(player, world);
                ActionMenu.showChildPanel(game, id, { html: `${res.tutor.icon} ${esc(res.tutor.name)} takes up ${esc(res.child.firstName)}'s lessons for ${res.tutor.wage}g a month (paid into their own purse).` });
            },
        });
        return list.map(c => {
            const subj = c.focus ? (Upbringing.focus(c.focus) || {}).name || c.focus : 'All subjects';
            const match = focus && c.focus === focus;
            const who = c.kind === 'courtier' ? 'courtier' : c.kind === 'townsfolk' ? `${esc(c.role || c.occupation || '')} of ${esc(c.town || 'this town')}` : `${esc(c.occupation || 'acquaintance')}`;
            const temper = c.traits.length ? ` · ${c.traits.slice(0, 3).map(esc).join(', ')}` : '';
            const ok = (player.gold || 0) >= c.wage;
            const args = c.npcId ? `'${esc(child.id)}','${esc(c.npcId)}',null` : `'${esc(child.id)}',null,'${esc(c.folkUid)}'`;
            return {
                icon: c.kind === 'courtier' ? '🎓' : '👨‍🏫', name: `${esc(c.name)}${match ? ' ✓' : ''}`,
                desc: `${who} · ${esc(subj)} · ×${c.quality.toFixed(2)}${temper}`,
                off: !ok, why: `Not enough gold · ${esc(subj)} · ×${c.quality.toFixed(2)}`,
                attrs: `onclick="window._raisingUI.hire(${args})"`,
                side: `${price(c.wage, ok)}<small>/mo</small>`, tone: match ? 'gold' : '',
            };
        });
    },

    /** Dynasty → Wards at Court. */
    showHouseWards(game, message = null) {
        const player = game.player;
        const world = game.world;
        if (!player.house) {
            game.ui.showNotification('House', 'Your House has not yet been founded.', 'info');
            return;
        }
        const W = Raising.config().wards;
        const wards = Raising.wards(player);
        const seats = Raising.wardSeats(player);
        let html = '<div style="font-size: 12px;">';
        if (message) html += `<div class="pk-card" style="border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#ece2c8;">${message.html}</div>`;
        html += chips([['🎓', 'Wards', `${wards.length}/${seats}`], ['💰', 'Fee', `${W.fee}g/mo`], ['⏳', 'Stay', `${W.years} yrs`]]);
        html += lede(`A realm that trusts your House may send a child of its court to be raised at yours. Its treasury pays ${W.fee}g a month for their keep, your standing there grows, and your own children raised beside them make a friend of that court. At war, the ward is a hostage in your keeping.`);

        html += sectionHead('At Your Court');
        if (!wards.length) {
            html += `<div style="${MUTED} margin:0 2px 6px;">No wards live at your court.</div>`;
        } else {
            html += rowList(wards.map(w => ({
                icon: w.held ? '⛓️' : (w.gender === 'female' ? '👧' : '👦'),
                name: `${esc(w.firstName)}${w.dynasty ? ' ' + esc(w.dynasty) : ''} of ${esc(w.kingdomName)}`,
                desc: `Age ${Raising.wardAge(world, w)}${w.royalId ? ' · of the royal blood' : ''} · ${w.held ? 'held as a hostage in the war' : `goes home on day ${w.until}`} · ${w.feesPaid || 0}g paid for their keep`,
                attrs: `onclick="window._raisingUI.sendHome('${esc(w.id)}')"`,
                side: w.held ? `Free (+${W.warReturnReputation} rep)` : `Send home (${W.sendHomeReputation} rep)`, tone: w.held ? 'good' : 'warn',
            })));
        }

        html += sectionHead('Realms That Might Send a Ward');
        html += rowList(Raising.wardOffers(player, world).map(o => ({
            icon: '🏰', name: esc(o.kingdom.name), desc: `standing ${o.rep}`,
            off: !o.ok, why: esc(o.reason || ''),
            attrs: `onclick="window._raisingUI.takeWard('${esc(o.kingdom.id)}')"`,
            side: `+${o.fee}g/mo`,
        })));

        const hist = (player.house.wardHistory || []).slice().reverse();
        if (hist.length) {
            html += rowList(hist.map(h => ({ icon: h.how === 'died' ? '🕯️' : '🎓', name: esc(h.name), desc: `of ${esc(h.kingdomName)} · day ${h.from}–${h.to}`, side: esc(h.how) })), 'Wards of Years Past');
        }
        html += rowList([{ icon: '←', name: 'Back to Dynasty', act: 'openTileMenu', args: ['showDynastyMenu'] }]);
        html += '</div>';

        window._raisingUI = Object.assign(window._raisingUI || {}, {
            takeWard: (kid) => {
                const res = Raising.takeWard(player, world, kid);
                if (!res.success) return game.ui.showNotification('🎓 Wards', res.reason, 'error');
                ActionMenu.showHouseWards(game, { html: `🎓 ${esc(res.ward.firstName)} of ${esc(res.ward.kingdomName)}, aged ${res.ward.age}, arrives to be raised at your court.` });
            },
            sendHome: (wardId) => {
                const res = Raising.sendWardHome(player, world, wardId);
                if (!res.success) return game.ui.showNotification('🎓 Wards', res.reason, 'error');
                ActionMenu.showHouseWards(game, { html: esc(res.text), color: res.reputation < 0 ? 'rgba(224,150,96,0.5)' : null });
            },
        });
        game.ui.showCustomPanel('🎓 Wards at Court', html);
    },
});
