// ActionMenu — People You've Known (Journal): everyone the player has spoken
// with in the towns of the world, living, moved away or dead, with the story
// of their lives since, and the latest word of them. Logic lives in
// systems/townsfolk.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Townsfolk } from './_imports.js';
import { CARD } from './uiKit.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px;';
const WORD_ICON = { died: '🕯️', wed: '💍', born: '👶', left: '🧳', arrived: '🏘️' };
const SECTIONS = [
    { kind: 'here', title: 'Living', color: 'var(--gold)' },
    { kind: 'away', title: 'Moved Away', color: '#9ab' },
    { kind: 'dead', title: 'Departed', color: '#a88' },
];

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _feeling(mem) {
    const d = mem && typeof mem.disposition === 'number' ? mem.disposition : 50;
    if (d >= 80) return ['💙', 'devoted to you', '#4FC3F7'];
    if (d >= 60) return ['😊', 'fond of you', '#66BB6A'];
    if (d >= 40) return ['🙂', 'friendly', '#A5D6A7'];
    if (d >= 20) return ['😐', 'wary', '#FFD54F'];
    return ['😠', 'hostile', '#EF5350'];
}

function _card(a, world) {
    const p = a.person;
    const dead = a.status.kind === 'dead';
    const [icon, feel, color] = _feeling(p.mem);
    let html = `<div style="${CARD} ${dead ? 'opacity:0.75;' : ''}">`;
    html += '<div style="display:flex; justify-content:space-between; gap:8px;">';
    html += `<strong style="color:${dead ? '#bbb' : 'var(--gold)'}; font-size:13px;">${dead ? '🕯️ ' : ''}${_esc(Townsfolk.name(p))}</strong>`;
    html += `<span style="color:#999; font-size:11px; white-space:nowrap;">${_esc(a.town)}</span></div>`;
    html += `<div style="font-size:11px; color:#ccc;">${_esc(a.status.text.charAt(0).toUpperCase() + a.status.text.slice(1))}</div>`;
    const meta = [];
    if (a.spouse) meta.push(`💍 ${_esc(a.spouse)}`);
    if (a.kids.length) meta.push(`👪 ${_esc(a.kids.join(', '))}`);
    if (meta.length) html += `<div style="font-size:11px; color:#aaa; margin-top:2px;">${meta.join(' · ')}</div>`;
    const seen = p.seen ? `last spoke ${_esc(Townsfolk.when(p.seen.d, world))}${p.seen.role === 'child' ? `, as a child of ${p.seen.age}` : ''}` : '';
    html += `<div style="font-size:10px; color:#888; margin-top:2px;">${dead ? '' : `<span style="color:${color};">${icon} ${feel}</span> · `}spoken with ${p.mem.timesSpoken}×${seen ? ` · ${seen}` : ''}</div>`;
    if (a.lines.length) {
        html += `<details style="margin-top:4px;"><summary style="cursor:pointer; font-size:11px; color:#9ab;">Their story</summary>`;
        for (const line of a.lines) html += `<div style="font-size:11px; color:#bbb; padding:1px 0 1px 8px;">${_esc(line)}</div>`;
        html += '</details>';
    }
    html += '</div>';
    return html;
}

Object.assign(ActionMenu, {
    /** Journal → People You've Known: acquaintances across the world and the latest word of them. */
    showTownsfolkJournal(game) {
        const world = game.world;
        const known = Townsfolk.acquaintances(world);
        let html = '<div style="max-height: 540px; overflow-y: auto; font-size: 12px;">';
        html += '<p style="margin:0 0 6px; color:var(--text-secondary);">The people you have spoken with live on when you leave: they grow up, marry, raise children, move away and die. Word of them reaches you on the road.</p>';
        if (!known.length) {
            html += `<div style="${CARD} color:#999;">You haven't got to know anyone yet. Walk into a town and talk to its people.</div>`;
        } else {
            const word = Townsfolk.recentWord(world, 8);
            if (word.length) {
                html += `<div style="${HEAD} color:#e0b040;">Latest Word</div>`;
                for (const w of word) {
                    html += `<div style="font-size:11px; color:#ccc; padding:2px 0;">${WORD_ICON[w.kind] || '📜'} <span style="color:#888;">${_esc(w.town)}:</span> ${_esc(w.text)}</div>`;
                }
            }
            for (const sec of SECTIONS) {
                const group = known.filter(a => a.status.kind === sec.kind);
                if (!group.length) continue;
                html += `<div style="${HEAD} color:${sec.color};">${sec.title} (${group.length})</div>`;
                for (const a of group) html += _card(a, world);
            }
        }
        html += '</div>';
        game.ui.showCustomPanel('👥 People You\'ve Known', html);
    },
});
