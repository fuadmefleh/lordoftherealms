// ============================================
// INNER MAP — what the town remembers, up close
// ============================================
// The statues, cairns, grave mounds, memorial stones and ruins that a town's
// history leaves on its streets (world/townMarks.js lays them; systems/
// townMemory.js keeps the history). Clicking one reads its inscription;
// a cairn or mound can be honoured; any of them tells the town's history.

import { InnerMap } from '../world/innerMap.js';
import { TownMemory } from '../systems/townMemory.js';
import { lede, rowList } from './actionMenu/uiKit.js';

const KIND_ICON = { fire: '🔥', sack: '🏚️', statue: '🗿', cairn: '⛰️', mound: '⚱️', name: '📜', district: '🏘️' };
const KIND_TITLE = { fire: 'Fire', sack: 'Sacked', statue: 'A statue', cairn: 'A cairn', mound: 'A grave pit', name: 'The square renamed', district: 'A new quarter' };

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export const InnerMapMemory = {
    /** The town on this map, and where it lies. */
    _here() {
        const wt = InnerMap._currentWorldTileRef || null;
        const at = InnerMap.currentWorldTile || {};
        return { s: (wt && wt.settlement) || null, q: at.q, r: at.r };
    },

    /** The mark a memory prop or ruined building stands for: { s, m, q, r } or null. */
    markAt(game, id) {
        if (!id) return null;
        const h = InnerMapMemory._here();
        const m = TownMemory.find(game.world, h.s, id, h.q, h.r);
        return m ? { ...h, m } : null;
    },

    /** Menu entries for a memory prop (customObject.memory) or a ruin (building._mark). */
    menuItems(game, markId) {
        const at = InnerMapMemory.markAt(game, markId);
        if (!at) return [];
        const { s, m } = at;
        const out = [];
        const line = s ? TownMemory.inscription(s, m, game.world) : `Here lie the ${m.dead || 'many'} who fell in battle on this ground.`;
        out.push({ type: 'disabled', label: `📜 ${line.length > 90 ? `${line.slice(0, 88)}…` : line}`, desc: line });
        out.push({ type: 'action', action: 'memory_read', label: 'Read the Inscription', icon: '📜', desc: 'What is carved here, and what it remembers', markId });
        if (m.k === 'cairn' || m.k === 'mound') {
            out.push({ type: 'action', action: 'memory_respects', label: 'Pay Your Respects', icon: '🕯️', desc: 'Stand a while with your head bowed (karma; once a year)', markId });
        }
        if (s) out.push({ type: 'action', action: 'memory_history', label: `The History of ${s.name}`, icon: '🏛️', desc: 'Its fires, its sacks, its statues and its dead', markId });
        return out;
    },

    /** Run memory_*. Returns true when it was ours. */
    handle(game, item) {
        if (!item || !/^memory_/.test(item.action || '')) return false;
        const at = InnerMapMemory.markAt(game, item.markId);
        if (!at) return true;
        const { s, m, q, r } = at;
        if (item.action === 'memory_read') {
            const text = s ? TownMemory.inscription(s, m, game.world) : `Here lie the ${m.dead || 'many'} who fell in battle on this ground${m.victor ? `. ${m.victor} held the field` : ''}.`;
            game.ui.showNotification('📜 The Inscription', text, 'info');
        } else if (item.action === 'memory_respects') {
            const res = TownMemory.respects(game.player, game.world, s, m.id, q, r);
            game.ui.showNotification(res.ok ? '🕯️ Respects Paid' : '🕯️ Already Honoured', res.text, res.ok ? 'success' : 'info');
        } else if (item.action === 'memory_history' && s) {
            // (the panel kit's rows: ui/actionMenu/uiKit.js; each line names its own year)
            const lines = TownMemory.describe(s, game.world);
            const html = lines.length
                ? lede(`What ${_esc(s.name)} remembers, oldest first.`) + rowList(lines.map(l => ({ icon: KIND_ICON[l.kind] || '🏛️', name: KIND_TITLE[l.kind] || 'Remembered', desc: _esc(l.text), side: String(l.year) })))
                : lede(`${_esc(s.name)} has no history worth the telling yet.`);
            if (typeof game.ui.showCustomPanel === 'function') game.ui.showCustomPanel(`🏛️ The History of ${s.name}`, html);
            else game.ui.showNotification(`🏛️ ${s.name}`, TownMemory.history(s, game.world), 'info');
        }
        return true;
    },
};
