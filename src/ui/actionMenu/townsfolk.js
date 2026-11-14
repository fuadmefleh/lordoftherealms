// ActionMenu — People You've Known (Journal): everyone the player has spoken
// with in the towns of the world, living, moved away or dead, with the story
// of their lives since, and the latest word of them. Logic lives in
// systems/townsfolk.js; this panel presents it.
// The action menu's voice (uiKit.js): one row a person (name over what they are
// doing now, the town at the right), their story folded away under the row.
import { ActionMenu } from './_ref.js';
import { Townsfolk } from './_imports.js';
import { lede, chips, rowList, more, esc } from './uiKit.js';

const WORD_ICON = { died: '🕯️', wed: '💍', born: '👶', left: '🧳', arrived: '🏘️' };
const SECTIONS = [
    { kind: 'here', title: 'Living' },
    { kind: 'away', title: 'Moved away' },
    { kind: 'dead', title: 'Departed' },
];
const MUTED = 'font-size:11px; color:#a99a78;';

function _feeling(mem) {
    const d = mem && typeof mem.disposition === 'number' ? mem.disposition : 50;
    if (d >= 80) return ['💙', 'devoted to you', 'good'];
    if (d >= 60) return ['😊', 'fond of you', 'good'];
    if (d >= 40) return ['🙂', 'friendly', ''];
    if (d >= 20) return ['😐', 'wary', 'warn'];
    return ['😠', 'hostile', 'bad'];
}

function _row(a, world) {
    const p = a.person;
    const dead = a.status.kind === 'dead';
    const [icon, feel, tone] = _feeling(p.mem);
    const meta = [];
    if (a.spouse) meta.push(`💍 ${esc(a.spouse)}`);
    if (a.kids.length) meta.push(`👪 ${esc(a.kids.join(', '))}`);
    // The generations: grandparents, grandchildren, orphans taken in, with child (systems/townFamily.js)
    if (a.family) meta.push(`🌳 ${esc(a.family)}`);
    const seen = p.seen ? `last spoke ${esc(Townsfolk.when(p.seen.d, world))}${p.seen.role === 'child' ? `, as a child of ${p.seen.age}` : ''}` : '';
    meta.push(`spoken with ${p.mem.timesSpoken}×${seen ? `, ${seen}` : ''}`);
    const story = a.lines.length ? more('Their story', a.lines.map(l => `<div style="${MUTED} padding:1px 0 1px 8px;">${esc(l)}</div>`).join('')) : '';
    return {
        icon: dead ? '🕯️' : icon,
        name: `${esc(Townsfolk.name(p))}${dead ? '' : ` <span style="${MUTED}">· ${feel}</span>`}`,
        desc: esc(a.status.text.charAt(0).toUpperCase() + a.status.text.slice(1)),
        note: `<span style="${MUTED}">${meta.join(' · ')}</span>${story}`,
        side: `<span style="${MUTED}">${esc(a.town)}</span>`,
        tone: dead ? '' : tone,
    };
}

Object.assign(ActionMenu, {
    /** Journal → People You've Known: acquaintances across the world and the latest word of them. */
    showTownsfolkJournal(game) {
        const world = game.world;
        const known = Townsfolk.acquaintances(world);
        let html = '<div style="max-height: 540px; overflow-y: auto; font-size: 12px;">';
        html += lede('The people you have spoken with live on when you leave: they grow up, marry, move away and die. Word of them reaches you on the road.');
        if (!known.length) {
            html += lede("You haven't got to know anyone yet. Walk into a town and talk to its people.");
        } else {
            const counts = SECTIONS.map(s => [s.title, known.filter(a => a.status.kind === s.kind).length]);
            html += chips(counts.filter(c => c[1]).map(([label, n]) => ['', label, n]));
            const word = Townsfolk.recentWord(world, 8);
            if (word.length) {
                html += rowList(word.map(w => ({ icon: WORD_ICON[w.kind] || '📜', name: esc(w.text), side: `<span style="${MUTED}">${esc(w.town)}</span>` })), 'Latest word');
            }
            for (const sec of SECTIONS) {
                const group = known.filter(a => a.status.kind === sec.kind);
                if (!group.length) continue;
                const rows = group.map(a => _row(a, world));
                // The departed fold away: the living come first
                html += sec.kind === 'dead' ? more(`${sec.title} (${group.length})`, rowList(rows)) : rowList(rows, `${sec.title} (${group.length})`);
            }
        }
        html += '</div>';
        game.ui.showCustomPanel('👥 People You\'ve Known', html);
    },
});
