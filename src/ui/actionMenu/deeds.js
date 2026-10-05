// ActionMenu — Deeds & Records (Journal → Deeds & Records, or the Character
// Sheet): every counter the systems keep about the player, grouped by
// system, with the House's lifetime total and the current ruler's share.
// Logic lives in systems/deeds.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Deeds } from '../../systems/deeds.js';
import { Foraging, Hunting } from '../../player/foraging.js';

const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 6px 10px; margin: 6px 0;';
const HEAD = 'font-size: 12px; font-weight: bold; color: var(--gold); margin-bottom: 3px;';
const ROW = 'display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 1px 0;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmt(n) {
    return Math.round(n).toLocaleString('en-US');
}

function _craftLine(label, rank) {
    const next = rank.next ? ` · ${rank.next.at - rank.trips} more to ${_esc(rank.next.name)}` : ' · mastered';
    return `<div style="${ROW}"><span>${label}</span><span style="color:#ccc;">${rank.icon} ${_esc(rank.name)}${next}</span></div>`;
}

Object.assign(ActionMenu, {
    /** Journal → Deeds & Records. */
    showDeeds(game) {
        const player = game.player;
        const sections = Deeds.sections(player);
        const ruler = player.name || 'You';
        const gen = (player.house && player.house.generation) || 1;
        const counted = Deeds.reignBaseline(player) ? '' : ' (counted from the start of the House: this reign began before records were kept)';

        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px; min-width: 340px;">';
        html += `<div style="color:#aaa; font-size:11px; margin-bottom:6px;">Every deed the realm remembers. <b>House</b> is the lifetime total of your line; <b>Reign</b> is ${_esc(ruler)}'s share (generation ${gen})${counted}.</div>`;

        const quiet = [];
        for (const sec of sections) {
            if (sec.empty) { quiet.push(`${sec.icon} ${sec.title}`); continue; }
            html += `<div style="${CARD}">`;
            html += `<div style="${HEAD}">${sec.icon} ${_esc(sec.title)}</div>`;
            html += `<div style="${ROW} color:#888; font-size:10px;"><span></span><span style="display:flex; gap:12px;"><span style="width:56px; text-align:right;">House</span><span style="width:56px; text-align:right;">Reign</span></span></div>`;
            for (const r of sec.rows) {
                if (!r.lifetime && !r.current) continue;
                const reign = r.reign == null ? '<span style="color:#666;">now</span>' : _fmt(r.reign);
                html += `<div style="${ROW}"><span>${_esc(r.label)}</span><span style="display:flex; gap:12px;"><span style="width:56px; text-align:right; color:#ddd;">${_fmt(r.lifetime)}</span><span style="width:56px; text-align:right; color:${r.reign ? '#7fd07f' : '#888'};">${reign}</span></span></div>`;
            }
            if (sec.id === 'land') {
                html += _craftLine('🌿 Forager', Foraging.skill(player));
                html += _craftLine('🏹 Hunter', Hunting.skill(player));
            }
            html += '</div>';
        }
        if (quiet.length) html += `<div style="color:#777; font-size:11px; margin-top:6px;">No record yet: ${quiet.map(_esc).join(' · ')}</div>`;
        html += '</div>';
        game.ui.showCustomPanel('📖 Deeds & Records', html);
    },
});
