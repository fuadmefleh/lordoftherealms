// ActionMenu — Schools & Letters: the town's letters (how many read and write,
// and how that has moved over the decades), its schools (the parish, the
// town school, the church's and the guild's money, the one you endowed), what
// its letters change (taxes, posters, rumour, trust, a new law), your own
// letters and lessons, your children's, and endowing a school here
// (systems/literacy.js, systems/townSchool.js). Opened from the town's action
// menu ('town_school') and the town info box. Buttons route through
// data-am-act → ActionMenu.schoolAct.
import { ActionMenu } from './_ref.js';
import { Literacy } from '../../systems/literacy.js';
import { TownSchool } from '../../systems/townSchool.js';
import { lede, chips, rowList, card, price, purse, more, esc } from './uiKit.js';

const pct = r => (r == null ? '—' : `${Math.round(r * 100)}`);
const fx = (f, good = true) => {
    const d = Math.round((f - 1) * 100);
    if (!d) return 'as anywhere';
    return `<span style="color:${(d > 0) === good ? '#9fd89f' : '#e0a080'};">${d > 0 ? '+' : ''}${d}%</span>`;
};

function _here(game) {
    const t = game.world.getTile(game.player.q, game.player.r);
    return (t && t.settlement) || null;
}

function _lettersCard(v) {
    let body = `<div style="font-size:12px;"><b>${pct(v.rate)} in 100</b> of the grown folk of ${esc(v.name)} can read and write${v.src === 'folk' ? ` (of the ${v.known} you could count)` : ' (by report)'}.</div>`;
    if (v.ago.length) body += `<div style="font-size:11px; color:var(--text-secondary);">${v.ago.map(a => `${a.years} years ago: ${pct(a.rate)}`).join(' · ')}</div>`;
    const e = v.effects;
    const rows = [
        { icon: '💰', name: 'Taxes', desc: 'The tax rolls are read and paid as posted', side: fx(e.tax) },
        { icon: '📜', name: 'A new law', desc: 'A posted law understood: the realm grumbles less at a change', side: fx(1 / Math.max(0.01, e.law)) },
        { icon: '🪧', name: 'The notice board', desc: 'The watch know a wanted face from the posters', side: fx(e.notices) },
        { icon: '🗣️', name: 'Word of mouth', desc: 'How much a tale changes in the telling', side: fx(e.oral, false) },
        { icon: '📰', name: 'Broadsheets', desc: 'How fast a written tale goes round', side: fx(e.written) },
        { icon: '🏦', name: 'Written receipts', desc: 'Trust in a bank\'s paper and a contract', side: e.trust ? `<span style="color:${e.trust > 0 ? '#9fd89f' : '#e0a080'};">${e.trust > 0 ? '+' : ''}${Math.round(e.trust * 100)}</span>` : 'as anywhere' },
    ];
    body += more('What its letters change here ▸', rowList(rows));
    return card(body, { icon: '📖', title: 'The town\'s letters', side: esc(v.type || '') });
}

function _schoolsCard(v) {
    const rows = [];
    const s = v.school;
    if (s) {
        const pupils = Object.entries(s.pupils || {}).map(([k, n]) => `${n} ${k === 'parish' ? 'at the parish school' : k === 'grammar' ? 'at the town school' : k === 'tutor' ? 'with tutors' : 'in the church\'s learning'}`).join(', ');
        rows.push({ icon: '⛪', name: 'The parish school', desc: s.priest ? `${esc(s.priest)} teaches letters and scripture` : 'No priest here: no parish school', side: s.priest ? 'open' : '—', tone: s.priest ? 'good' : '' });
        if (v.founded || v.endowed) rows.push({ icon: '🏫', name: 'The town school', desc: `${s.master ? `${esc(s.master)} is its master` : 'No master'}${v.endowed ? ' · endowed by you' : v.founded ? ` · founded by ${esc(v.founded.by)}` : ''}`, side: `fund ${v.fund}g`, tone: 'good' });
        if (v.church) rows.push({ icon: '✝️', name: 'The church\'s school', desc: `The church tithes for its pupils${v.church.given ? ` (${v.church.given}g so far)` : ''}`, side: 'yearly' });
        if (v.guild) rows.push({ icon: '⚒️', name: `${esc(v.guild.name)}'s money`, desc: `Keeps its apprentices at their letters${v.guild.given ? ` (${v.guild.given}g so far)` : ''}`, side: 'yearly' });
        if (pupils) rows.push({ icon: '🎒', name: 'Pupils this year', desc: pupils, side: '' });
    }
    return rowList(rows, '🏫 Schools');
}

function _youCard(game, v, s) {
    const { player, world } = game;
    const rows = [];
    const lv = v.you.lv;
    rows.push({ icon: '✍️', name: 'Your letters', desc: lv == null ? 'Not yet reckoned' : v.you.canWrite ? 'You read and write your own letters' : v.you.canRead ? 'You read, haltingly; a scribe writes your letters (a fee each)' : 'You cannot read: books are closed to you, and letters are read to you', side: lv == null ? '' : `${Math.floor(lv)}/100` });
    if (s && s.folk) {
        const t = Literacy.lessonTerms(player, world, s);
        rows.push({ icon: '📚', name: 'Take a lesson', desc: t.teacher ? `${esc(t.teacher)} teaches grown pupils too` : '', side: price(t.fee, t.ok), off: !t.ok, why: esc(t.reason || ''), act: 'schoolAct', args: ['lesson'] });
    }
    for (const c of v.children) {
        rows.push({ icon: '🧒', name: esc(c.name), desc: `Age ${c.age}${c.tutor ? ' · tutored' : ''}${c.lit == null ? ' · not yet at letters' : ''}`, side: c.lit == null ? '' : `${c.lit}/100`, note: c.lit != null && c.lit < 50 && c.age >= 10 ? 'A tutor (Raising) or a learning focus would help' : '' });
    }
    return rowList(rows, '✍️ You and yours');
}

function _endowSection(game, s) {
    const { player, world } = game;
    const v = s.folk && s.folk.school;
    if (v && v.endowed && !v.endowed.closed) {
        const en = v.endowed;
        return rowList([
            { icon: '🏫', name: 'Your school', desc: `${en.wage}g wage and ${en.fund}g to the fund each month${en.missed ? ` · ${en.missed} month${en.missed === 1 ? '' : 's'} unpaid` : ''}${en.spent ? ` · ${en.spent}g so far` : ''}`, side: 'endowed', tone: en.missed ? 'warn' : 'good' },
            { icon: '🚪', name: 'Stop paying for it', desc: 'The school closes; its children go back to work', act: 'schoolAct', args: ['close'], tone: 'bad', side: '' },
        ], '🏛️ Your endowment');
    }
    const t = Literacy.endowTerms(player, world, s);
    if (v && v.founded && !t.ok) return '';
    const mats = t.materials ? Object.entries(t.materials.fromPacks).map(([id, n]) => `${n} ${id} from your packs`).concat(Object.entries(t.materials.toBuy).map(([id, n]) => `${n} ${id} bought here`)).join(', ') : '';
    const rows = [];
    const cands = (t.candidates || []).slice(0, 5);
    if (!cands.length) {
        rows.push({ icon: '🏫', name: `Endow a school in ${esc(s.name)}`, off: true, why: esc(t.reason || ''), side: price(t.total, false) });
    } else {
        for (const c of cands) {
            rows.push({
                icon: '🏫', name: `Endow a school with ${esc(c.name)} as master`,
                desc: `${esc(c.role)}, ${c.age}, letters ${c.lit} · ${mats || 'its planks and stone'} · then ${t.wage}g + ${t.fund}g a month`,
                title: 'More of the town sends its children to learn their letters, and more each year it stands.',
                side: price(t.total, t.ok), off: !t.ok, why: esc(t.reason || ''), act: 'schoolAct', args: ['endow', c.id],
            });
        }
    }
    return rowList(rows, '🏛️ Endow a school');
}

Object.assign(ActionMenu, {
    /** Schools & Letters for the town you stand in. */
    showSchool(game, message = null) {
        const { player, world } = game;
        const s = _here(game);
        let html = '<div style="font-size:12px;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'gold' : 'bad' });
        if (!s) {
            html += lede('There is no town here to keep a school.');
            html += _youCard(game, Literacy.view(player, world, null), null);
            game.ui.showCustomPanel('📖 Schools & Letters', html + '</div>');
            return;
        }
        const v = Literacy.view(player, world, s);
        html += lede(`Who can read in ${esc(s.name)}, who teaches them, and what it changes. Children taught at school grow into lettered folk; the rate moves with the decades.`);
        html += chips([purse(player.gold), ['📖', 'Letters', `${pct(v.rate)}/100`], ['🏫', 'Fund', `${v.fund}g`]]);
        html += _lettersCard(v);
        html += _schoolsCard(v);
        if (s.folk && v.school) {
            html += rowList([{ icon: '🪙', name: 'Give 20g to the school fund', desc: 'More children sent, the poor\'s fees paid; the teacher and the parents think the better of you', side: price(20, (player.gold || 0) >= 20), off: (player.gold || 0) < 20, why: 'You haven\'t 20g.', act: 'schoolAct', args: ['donate', 20] }]);
            html += _endowSection(game, s);
        }
        html += _youCard(game, v, s);
        html += '</div>';
        game.ui.showCustomPanel('📖 Schools & Letters', html);
    },

    /** Every button on the panel. */
    schoolAct(game, op, a = null) {
        const { player, world } = game;
        const s = _here(game);
        let res = { success: false, reason: 'There is no town here.' };
        if (s && op === 'lesson') res = Literacy.takeLesson(player, world, s);
        else if (s && op === 'endow') res = Literacy.endow(player, world, s, a);
        else if (s && op === 'close') res = Literacy.closeEndowment(player, world, s);
        else if (s && op === 'donate') {
            const r = TownSchool.donate(player, world, s, Number(a) || 0);
            res = r.success ? { success: true, text: `You give ${a}g to the school of ${s.name}. ${r.touched ? `${r.touched} of the town think the better of you.` : ''}` } : r;
        }
        if (res.success) game.ui.updateStats(player, world);
        ActionMenu.showSchool(game, { ok: !!res.success, text: res.success ? res.text : res.reason });
    },
});
