// ActionMenu — Deeds & Records (Journal → Deeds & Records, or the Character
// Sheet): every counter the systems keep about the player, grouped by
// system, with the House's lifetime total and the current ruler's share.
// Logic lives in systems/deeds.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Deeds } from '../../systems/deeds.js';
import { Achievements } from '../../systems/achievements.js';
import { Heralds } from '../../systems/heralds.js';
import { LlmProse } from '../../systems/llmProse.js';
import { Foraging, Hunting } from '../../player/foraging.js';
import { Crafting } from '../../player/crafting.js';
import { lede, more, card } from './uiKit.js';

const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 6px 10px; margin: 6px 0;';
const ROW = 'display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 1px 0;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmt(n) {
    return Math.round(n).toLocaleString('en-US');
}

function _craftLine(label, rank) {
    // (the rank follows the practised skill's level: player/foraging.js)
    const next = rank.next ? ` · ${_esc(rank.next.name)} at level ${rank.next.level}` : ' · mastered';
    return `<div style="${ROW}"><span>${label}</span><span style="color:#ccc;">${rank.icon} ${_esc(rank.name)} (level ${rank.practice})${next}</span></div>`;
}

/**
 * The chronicler's reckoning of the record (systems/llmProse.js): the
 * greatest tallies handed to the court scribe; shown once written (the
 * tables are the record itself, so with the model off nothing is added).
 */
function _deedsProse(game, sections, ruler, gen) {
    try {
        const rows = [];
        for (const sec of sections) {
            if (sec.empty) continue;
            for (const r of sec.rows) if (r.lifetime > 0 && !r.current) rows.push(r);
        }
        if (!rows.length) return '';
        rows.sort((a, b) => b.lifetime - a.lifetime);
        const top = rows.slice(0, 12);
        const house = (game.player.house && game.player.house.name) || null;
        const facts = {
            house, ruler, generation: gen,
            houseTotals: top.map(r => `${r.label}: ${Math.round(r.lifetime)}`),
            thisReign: top.filter(r => r.reign > 0).map(r => `${r.label}: ${Math.round(r.reign)}`),
        };
        const fallback = `The record of ${house || ruler} counts ${top.slice(0, 4).map(r => `${r.label.toLowerCase()} ${Math.round(r.lifetime)}`).join(', ')}.`;
        const hid = (game.player.house && (game.player.house.id || game.player.house.name)) || 'house';
        const key = `deeds:${hid}:g${gen}`;
        LlmProse.write(game.world, { kind: 'deeds', key, facts, fallback });
        const writ = LlmProse.written(game.world, key);
        // (the day's heralds' digest, when the scribe has cried it whole: systems/heralds.js)
        const dig = Heralds.digest(game.world, game.player);
        let html = '';
        if (writ) html += `<div style="${CARD} font-family: Georgia, serif; font-style: italic; color: #e8dcc0;">✒️ ${_esc(writ)}</div>`;
        if (dig && dig.written) html += `<div style="${CARD} font-family: Georgia, serif; color: #d8cfb8;">📯 <b>The heralds, day ${_fmt(dig.day)}:</b> ${_esc(dig.text)}</div>`;
        return html;
    } catch (e) {
        return '';
    }
}

Object.assign(ActionMenu, {
    /** Journal → Deeds & Records. */
    showDeeds(game) {
        const player = game.player;
        const sections = Deeds.sections(player, game.world);
        const ruler = player.name || 'You';
        const gen = (player.house && player.house.generation) || 1;
        const counted = Deeds.reignBaseline(player) ? '' : ' (counted from the start of the House: this reign began before records were kept)';

        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px; min-width: 340px;">';
        html += lede(`Every deed the realm remembers. <b>House</b> is the lifetime total of your line; <b>Reign</b> is ${_esc(ruler)}'s share (generation ${gen})${counted}.`);
        html += _deedsProse(game, sections, ruler, gen);

        const quiet = [];
        for (const sec of sections) {
            if (sec.empty) { quiet.push(`${sec.icon} ${sec.title}`); continue; }
            let body = '';
            for (const r of sec.rows) {
                if (!r.lifetime && !r.current) continue;
                const reign = r.reign == null ? '<span style="color:#666;">now</span>' : _fmt(r.reign);
                body += `<div style="${ROW}"><span>${_esc(r.label)}</span><span style="display:flex; gap:12px;"><span style="width:56px; text-align:right; color:#ddd;">${_fmt(r.lifetime)}</span><span style="width:56px; text-align:right; color:${r.reign ? '#7fd07f' : '#888'};">${reign}</span></span></div>`;
            }
            if (sec.id === 'heralds') {
                // What the heralds cried lately — the toast is gone, the news isn't
                // (only news that has reached the player, including any the daily throttle kept quiet)
                const cried = Heralds.recent(player, 40).filter(x => x.delivered).slice(0, 5);
                body += more(`Lately cried (${cried.length})`, cried.map(p => `<div style="font-size:11px; color:#aab; padding:1px 0;">Day ${_fmt(p.day || 0)}: ${_esc(p.text)}</div>`).join(''));
            }
            if (sec.id === 'wilds') {
                // The wilds journal (player/wilds.js): the last encounters and how they went
                const journal = ((player.wilds && player.wilds.journal) || []).slice(-8).reverse();
                body += more(`Wilds journal (${journal.length})`, journal.map(j => {
                    const how = j.passed === false ? '<span style="color:#e08080;">went wrong</span>' : '<span style="color:#7fd07f;">done</span>';
                    return `<div style="font-size:11px; color:#aab; padding:1px 0;" title="${_esc(j.text || '')}">Day ${_fmt(j.day || 0)}: ${_esc(j.icon || '')} ${_esc(j.name || 'An encounter')} — ${_esc(j.choice || '')} (${how})</div>`;
                }).join(''));
            }
            if (sec.id === 'crafting') {
                const rank = Crafting.rank(player);
                const next = rank.next ? ` · ${Math.max(0, Math.ceil(rank.next.at - rank.xp))} xp to ${_esc(rank.next.name)}` : ' · mastered';
                body += `<div style="${ROW}"><span>🔨 Crafter</span><span style="color:#ccc;">${rank.icon} ${_esc(rank.name)}${next}</span></div>`;
                // Each craft skill the player has worked at (data/craftGrades.json skills, 0..10)
                for (const sk of Crafting.skillList(player)) {
                    body += `<div style="${ROW}"><span>${sk.icon} ${_esc(sk.name)}</span><span style="color:#ccc;">${sk.level.toFixed(1)} · ${_esc(sk.title)}</span></div>`;
                }
            }
            if (sec.id === 'land') {
                body += _craftLine('🌿 Forager', Foraging.skill(player));
                body += _craftLine('🏹 Hunter', Hunting.skill(player));
            }
            html += card(body, { icon: sec.icon, title: _esc(sec.title), side: '<span style="display:flex; gap:12px; font-size:10px; color:#888;"><span style="width:56px; text-align:right;">House</span><span style="width:56px; text-align:right;">Reign</span></span>' });
        }
        // The empty ledgers fold away: a chip each, behind one line
        if (quiet.length) html += more(`${quiet.length} kinds of deed with no record yet`, `<div class="pk-chips">${quiet.map(q => `<span class="pk-chip dim">${_esc(q)}</span>`).join('')}</div>`);

        // Achievements, by tier (systems/achievements.js)
        const ach = Achievements.listing(player);
        let achBody = '';
        for (const t of ach.tiers) {
            const won = t.items.filter(i => i.unlocked);
            achBody += more(`<span style="text-transform:capitalize;">${_esc(t.tier)}</span> · ${won.length}/${t.items.length}`, won.map(i => `<div style="${ROW}"><span>${i.icon} ${_esc(i.name)} <span style="color:#888;">— ${_esc(i.description)}</span></span><span style="color:#888;">${i.day != null ? `day ${_fmt(i.day)}` : ''}</span></div>`).join(''));
        }
        // The quests finished, by name
        const done = (player.quests && player.quests.completed) || [];
        if (done.length) achBody += more(`📜 Quests completed · ${done.length}`, `<div style="font-size:11px; color:#aaa;">${done.slice(-30).map(q => _esc(q.title || q.id)).join(' · ')}</div>`);
        html += card(achBody, { icon: '🏆', title: 'Achievements', side: `${ach.progress.unlocked}/${ach.progress.total} (${ach.progress.percentage}%)`, tone: 'gold' });
        html += '</div>';
        game.ui.showCustomPanel('📖 Deeds & Records', html);
    },
});
