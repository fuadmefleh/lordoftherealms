// ActionMenu — Your Parents (player/parentage.js): the parents' rules over a
// child of the house (what is forbidden, what is lifted, the consequence of
// each), trust and regard, the allowance, grounding and leave, the duties
// (chores in the family trade, lessons, church) done from here, asking leave,
// running away, and the family. And the parents picker of the "Born to a
// Family" origin: real couples of the world, or "whoever's child".
// Built with the action menu's kit (ui/actionMenu/uiKit.js).
import { ActionMenu } from './_ref.js';
import { lede, chips, purse, sectionHead, rowList, card, esc } from './uiKit.js';
import { Parentage } from '../../player/parentage.js';

const TITLE = 'Your Parents';

function _refresh(game) {
    if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
}

function _status(player, rule) {
    const s = Parentage.ruleStatus(player, rule.id);
    if (s === 'lifted') return { tone: 'good', note: 'Lifted: they trust you with it now.' };
    if (s === 'permitted') return { tone: 'good', note: 'You have their leave.' };
    return { tone: null, note: null };
}

Object.assign(ActionMenu, {
    /** The parents panel (or the family's, once their rule is over). */
    showParents(game, msg = null) {
        const { player, world } = game;
        const pa = Parentage.state(player);
        if (!pa) { game.ui.showNotification('🏡 Family', 'You have no parents ruling your days.', 'info'); return; }
        if (pa.pending) { ActionMenu.showParentPicker(game); return; }
        const day = world.day || 0;
        const st = Parentage.station(pa.station) || {};
        const T = Parentage.temperOf(pa);
        const regard = Parentage.regard(player);
        let html = '';
        if (msg) html += card(esc(msg), { tone: 'gold' });
        if (pa.active) {
            const come = (Parentage.data().comeOfAge || 16);
            html += lede(`You are ${player.age}, ${Parentage._childWord(player)} of ${esc(Parentage.parentsLine(player).replace(/^your /, '').replace(/ and your /, ' and '))} in <b>${esc(pa.home.name)}</b>${pa.sentTo ? ' (sent to live with family)' : ''}. Until you are ${come} their word is law: they are <b>${esc(T.label)}</b>, and they let you do more as you earn their trust.`);
            const grounded = Parentage.grounded(player, world);
            const leave = pa.leave && pa.leave.until >= day;
            html += chips([
                { icon: '🤝', label: 'Trust', value: Math.round(pa.trust), cls: pa.trust >= 60 ? 'gold' : '' },
                { icon: '❤️', label: 'Regard', value: regard },
                { icon: '💰', label: 'Allowance', value: pa.cut ? 'stopped' : `${st.allowance || 0}g/wk`, cls: pa.cut ? 'dim' : '' },
                { icon: '🧭', label: 'Leash', value: `${Parentage.roamRadius(player, world)} lg` },
                grounded ? { icon: '🔒', label: 'Grounded', value: `${pa.grounded.until - day + 1}d`, cls: 'dim' } : null,
                leave ? { icon: '🎒', label: 'On leave', value: `${pa.leave.until - day + 1}d`, cls: 'gold' } : null,
                { icon: '🏦', label: 'Household', value: `${Parentage.savings(world, player).toLocaleString('en-US')}g` },
                purse(player.gold),
            ]);

            // Duties
            const atHome = player.q === pa.home.q && player.r === pa.home.r;
            const duties = Parentage.dutiesDue(player, world).map(d => {
                const def = Parentage.dutyDef(player, d.duty) || {};
                const off = !atHome || d.doneToday || (player.actionPoints || 0) < d.ap;
                const why = !atHome ? `Your duties are at home, in ${esc(pa.home.name)}.` : d.doneToday ? 'Done today.' : `Needs ${d.ap} AP.`;
                const when = !d.active ? 'No longer asked of you' : d.overdue ? 'Overdue: they will notice tonight' : d.dueIn === 0 ? 'Due today' : `Due in ${d.dueIn} day${d.dueIn === 1 ? '' : 's'}`;
                return { icon: d.icon, name: esc(d.label), desc: esc(def.desc || ''), note: when, off, why, act: 'parentsAct', args: ['duty', d.duty], side: `${d.ap} AP`, tone: d.overdue && d.active ? 'warn' : null };
            });
            html += rowList(duties, 'Your duties');

            // The rules
            const rules = Parentage.rules(player).map(r => {
                const s = _status(player, r);
                const desc = String(r.desc || '').replace('{radius}', Parentage.roamRadius(player, world)).replace('{every}', r.every || '');
                const conseq = s.note ? s.note : `If they find out: ${esc(Parentage.consequence(player, r.id))}${r.lift != null ? ` · lifted at trust ${r.lift}` : ''}`;
                return { icon: r.icon, name: esc(r.name), desc: esc(desc), note: conseq, tone: s.tone };
            });
            html += rowList(rules, 'Their rules');

            // Asking leave
            const P = Parentage.data().permissions || {};
            const asks = Object.entries(P).map(([id, p]) => {
                const o = Parentage.askOdds(player, world, id);
                return { icon: p.icon, name: esc(p.name), desc: esc(p.desc), off: !o.can, why: esc(o.reason || ''), act: 'parentsAct', args: ['ask', id], side: o.can ? `${Math.round(o.chance * 100)}%` : '' };
            });
            html += rowList(asks, 'Ask them');
            html += rowList([{ icon: '🏃', name: 'Run away from home', desc: 'Leave tonight without their blessing. You are free, and disowned: no allowance, no inheritance, their regard in ruins.', act: 'parentsAct', args: ['runaway'], tone: 'warn' }], 'Or');
        } else {
            const how = { age: 'You came of age', blessed: 'You went out into the world with their blessing', ran: 'You ran away from home', disowned: 'They disowned you', orphaned: 'Your parents are gone', gone: 'You are head of the House now' }[pa.ended && pa.ended.how] || 'Their rule is over';
            html += lede(`${how}${pa.ended ? ` (day ${pa.ended.day})` : ''}. ${pa.disinherited ? 'You will inherit nothing of theirs.' : ''}`);
            html += chips([{ icon: '❤️', label: 'Their regard', value: regard }, purse(player.gold)]);
        }

        // The family
        const fam = Parentage.kin(player, world).map(k => ({
            icon: k.alive ? '👤' : '🕯️', name: `${esc(k.name)} <span style="opacity:.7">· your ${esc(k.role)}</span>`,
            desc: `${k.alive ? `Age ${k.age}` : 'Dead'} · ${esc(k.town || '')}`, side: k.alive ? `${k.score > 0 ? '+' : ''}${k.score}` : '',
        }));
        html += rowList(fam, 'Your family');

        if (pa.log && pa.log.length) {
            html += sectionHead('Lately');
            html += card(pa.log.slice(0, 6).map(l => `<div style="font-size:11.5px;margin:2px 0;"><span style="opacity:.6">Day ${l.d}</span> · ${esc(l.text)}</div>`).join(''));
        }
        game.ui.showCustomPanel(pa.active ? TITLE : 'Your Family', html);
    },

    /** The Born-to-a-Family picker: real couples of the world, or whoever's child. */
    showParentPicker(game, reroll = 0) {
        const { player, world } = game;
        const pa = Parentage.state(player);
        if (!pa || !pa.pending) { ActionMenu.showParents(game); return; }
        const list = Parentage.couples(world, { age: pa.age, reroll });
        let html = lede(`Whose child are you? Each of these is a real couple of the world, at home in their town. You are born to them, ${pa.age} years old, with their name, their tongue and their faith, and you live under their rules until you come of age.`);
        const rows = list.map(c => {
            const kids = c.kids ? ` · ${c.kids} child${c.kids === 1 ? '' : 'ren'} already` : '';
            const extra = c.guild ? ` · master of the ${esc(c.guild.name)}` : c.estates ? ` · ${esc(c.estates.name)}, ${c.estates.count} estate${c.estates.count === 1 ? '' : 's'}` : c.line ? ` · you would be ${Parentage._ordinal(c.line)} in line` : '';
            return {
                icon: c.icon,
                name: `${esc(c.name)} <span style="opacity:.75">· ${esc(c.town)}${c.kingdom ? `, ${esc(c.kingdom)}` : ''}</span>`,
                desc: `${esc(c.father.first)} ${esc(c.father.last || '')} (${c.father.age}, ${esc(c.father.title)}) and ${esc(c.mother.first)} ${esc(c.mother.last || '')} (${c.mother.age}, ${esc(c.mother.title)})${kids}${extra}`,
                note: esc(c.means),
                act: 'parentsAct', args: ['pick', c.key, reroll],
                side: `${c.purse}g`,
            };
        });
        html += rowList(rows, 'Families');
        html += rowList([
            { icon: '🎲', name: 'Random: whoever\'s child', desc: 'Let fate choose. Most people are born to farmers and labourers; a few to lords.', act: 'parentsAct', args: ['random', reroll] },
            { icon: '🔄', name: 'Other families', desc: 'Look at other couples across the world.', act: 'parentsAct', args: ['reroll', reroll + 1] },
        ], 'Or');
        game.ui.showCustomPanel('Born to a Family', html);
    },

    /** The panels' buttons. */
    parentsAct(game, what, a, b) {
        const { player, world } = game;
        const pa = Parentage.state(player);
        if (!pa) return;
        if (what === 'reroll') { ActionMenu.showParentPicker(game, a || 0); return; }
        if (what === 'pick' || what === 'random') {
            if (!pa.pending) { ActionMenu.showParents(game); return; }
            const reroll = what === 'pick' ? (b || 0) : (a || 0);
            const c = what === 'pick'
                ? Parentage.couples(world, { age: pa.age, reroll }).find(x => x.key === a)
                : Parentage.randomCouple(world, { age: pa.age, reroll, salt: world.day });
            const res = c ? Parentage.bornTo(player, world, c, { age: pa.age }) : { success: false, reason: 'They are no longer there.' };
            if (!res.success) { game.ui.showNotification('🏡 Born to a Family', res.reason, 'error'); return; }
            if (game.renderer && game.camera) {
                const pos = game.renderer.getHexPixelPos(player.q, player.r);
                game.camera.centerOn(pos.x, pos.y);
            }
            _refresh(game);
            game.ui.showNotification(`🏡 Welcome, ${player.name}`, res.line, 'info');
            ActionMenu.showParents(game, res.line);
            return;
        }
        if (what === 'duty') {
            const res = Parentage.doDuty(player, world, a);
            if (!res.success) { game.ui.showNotification('🏡 Your Parents', res.reason, 'error'); return; }
            _refresh(game);
            ActionMenu.showParents(game, res.text);
            return;
        }
        if (what === 'ask') {
            const res = Parentage.ask(player, world, a);
            if (!res.success) { game.ui.showNotification('🏡 Your Parents', res.reason, 'error'); return; }
            _refresh(game);
            ActionMenu.showParents(game, res.text);
            return;
        }
        if (what === 'runaway') {
            if (b !== 'yes' && a !== 'yes') {
                const html = lede('Run away? You keep what you carry. Your parents will not forgive it: you are disowned, no allowance, no inheritance, and their regard is gone.')
                    + rowList([
                        { icon: '🏃', name: 'Yes, go tonight', act: 'parentsAct', args: ['runaway', 'yes'], tone: 'warn' },
                        { icon: '🏡', name: 'No, stay', act: 'showParents' },
                    ]);
                game.ui.showCustomPanel(TITLE, html);
                return;
            }
            const res = Parentage.runAway(player, world);
            if (!res.success) { game.ui.showNotification('🏡 Your Parents', res.reason, 'error'); return; }
            _refresh(game);
            ActionMenu.showParents(game, res.text);
        }
    },
});
