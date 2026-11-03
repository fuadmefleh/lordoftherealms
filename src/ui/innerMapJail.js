// ============================================
// INNER MAP JAIL — doing time on the jail map
// ============================================
// The UI half of world/innerMap/jail.js. Each thing in the cell is one of the
// prison's doings (player/prison.js), right-clicked on the map:
//
//   - the straw pallet: sleep (serve the day);
//   - the loose flagstone: dig the tunnel (with tools), or crawl out of it;
//   - the cell door: call the guard (bribes), labour in the yard, plan the
//     break-out, post bail — or the whole prison panel;
//   - a cellmate: talk, share food, or (the smuggler, a friend) ask for tools;
//   - the gaoler: a bribe; other prisoners: a word through the bars.
//
// Each frame (update) it watches the sentence: served, bailed or released,
// the cell door swings open and the player walks out; escaped, they're out
// over the wall and off the town map.

import { InnerMap } from '../world/innerMap.js';
import { Prison } from '../player/prison.js';
import { ActionMenu } from './actionMenu.js';
import { InnerMapReactions } from './innerMapReactions.js';

const _day = (game) => (game && game.world && game.world.day) || 0;

function _pick(arr) {
    return Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length) % arr.length] : null;
}

export const InnerMapJail = {
    /**
     * The menu entries for a tile of the jail map (replacing the usual ones).
     * @returns {Array} menu items (header / action / disabled)
     */
    menuItems(game, tile, q, r, npcsHere) {
        const items = [];
        const player = game && game.player;
        const jail = player && player.jailState;
        const pr = jail ? Prison.state(player, game.world) : null;
        const sep = () => { if (items.length) items.push({ type: 'separator' }); };
        const kind = tile && tile._jailKind;
        const locked = InnerMap.jailLocked();

        if (!jail || !locked) {
            // Free in the gaol — a visitor, or let out and on the way: the door, and a word through the bars
            if (kind === 'exit' || kind === 'open_door') {
                items.push({ type: 'header', label: '🚪 The Way Out' });
                items.push({ type: 'action', action: 'exit_building', label: 'Leave the Gaol', icon: '🚪', desc: 'Out into the street' });
            }
            for (const npc of npcsHere || []) {
                if (npc._prisoner || npc._cellmateId) {
                    sep();
                    items.push({ type: 'header', label: `⛓️ ${npc.name}, a Prisoner` });
                    items.push({ type: 'action', action: 'jailmap_hail', label: 'Speak Through the Bars', icon: '🗣️', desc: 'A word with them', npc });
                } else if (npc._gaoler) {
                    sep();
                    items.push({ type: 'header', label: `💂 ${npc.name}, the Gaoler` });
                    items.push({ type: 'action', action: 'jailmap_gaoler', label: 'Speak with Him', icon: '🗣️', desc: 'The keeper of the cells', npc });
                }
            }
            if (items.length) return items;
            return InnerMap._jail && InnerMap._jail.visitor
                ? [{ type: 'header', label: '⛓️ The Gaol' }, { type: 'disabled', label: 'Prisoners behind the bars, the gaoler at his desk. The door out is behind you.' }]
                : [{ type: 'header', label: '🔓 Free to Go' }, { type: 'disabled', label: 'Your cell door stands open. Walk out by the gaol door.' }];
        }
        const triedTonight = !Prison.canBreakToday(player, game.world);

        if (kind === 'bed') {
            sep();
            items.push({ type: 'header', label: '🛏️ Your Straw Pallet' });
            items.push({ type: 'action', action: 'jailmap_sleep', label: 'Sleep — Serve the Day', icon: '💤', desc: `${jail.daysRemaining} day(s) left` });
        }
        if (kind === 'stone') {
            sep();
            items.push({ type: 'header', label: `🧱 The Loose Flagstone${pr.tunnel > 0 ? ` (tunnel ${pr.tunnel}%)` : ''}` });
            if (pr.tunnel >= 100) {
                items.push(triedTonight
                    ? { type: 'disabled', label: 'The guards are wary tonight. Wait for another night.' }
                    : { type: 'action', action: 'jailmap_break', label: 'Crawl Out Through the Tunnel', icon: '🕳️', desc: 'The work of many nights' });
            } else if (pr.tools > 0) {
                items.push({ type: 'action', action: 'jailmap_dig', label: 'Dig Beneath It', icon: '⛏️', desc: 'Takes the day. A search or a snitch may find it.' });
            } else {
                items.push({ type: 'disabled', label: 'It shifts under your foot — but you\'d need tools to dig.' });
            }
        }
        if (kind === 'door' || kind === 'bars') {
            sep();
            items.push({ type: 'header', label: '🔒 Your Cell Door' });
            items.push({ type: 'action', action: 'jailmap_bribe', label: 'Call the Guard Over', icon: '💰', desc: 'A bribe: look away tonight, tools, lost papers' });
            items.push({ type: 'action', action: 'jailmap_work', label: 'Ask to Labour in the Yard', icon: '🧱', desc: 'Takes the day; counts double against your sentence' });
            items.push(triedTonight
                ? { type: 'disabled', label: 'The guards are wary after tonight\'s attempt.' }
                : { type: 'action', action: 'jailmap_break', label: 'Plan the Break-Out', icon: '🏃', desc: 'Rush the guard or slip out at the change of the watch' });
            if (jail.bailCost) items.push({ type: 'action', action: 'jailmap_bail', label: `Post Bail (${jail.bailCost} gold)`, icon: '💰', desc: (player.gold || 0) >= jail.bailCost ? 'Walk out today' : 'You haven\'t the coin' });
            items.push({ type: 'action', action: 'jailmap_panel', label: 'Think It All Over', icon: '📜', desc: 'Everything at once: the prison panel' });
        }
        for (const npc of npcsHere || []) {
            if (npc._cellmateId) {
                const m = pr.cellmates.find(c => c.id === npc._cellmateId);
                if (!m) continue;
                const def = Prison.archetype(m.archetype) || {};
                sep();
                items.push({ type: 'header', label: `${def.icon || '👤'} ${m.name} — ${def.label || 'Prisoner'}${m.friend ? ' (a friend)' : ` (${m.rapport}/${def.friendAt || 2})`}` });
                const why = m.sold ? 'Will not speak to you' : m.talkedDay === _day(game) ? 'You have spoken today' : '';
                if (why) items.push({ type: 'disabled', label: `${m.name}: ${why}.` });
                else {
                    items.push({ type: 'action', action: 'jailmap_talk', label: `Talk with ${m.name}`, icon: '🗣️', desc: `${Math.round(Prison.talkChance(player) * 100)}% to win them over a little`, mateId: m.id, npc });
                    if (Prison._food(player)) items.push({ type: 'action', action: 'jailmap_food', label: `Share Food with ${m.name}`, icon: '🍞', desc: 'A sure way to a prisoner\'s heart', mateId: m.id, npc });
                }
                if (m.archetype === 'smuggler' && m.friend) items.push({ type: 'action', action: 'jailmap_mates', label: `Ask ${m.name} for Tools`, icon: '🔧', desc: 'Brought in tomorrow, baked into the bread' });
            } else if (npc._gaoler) {
                sep();
                items.push({ type: 'header', label: `💂 ${npc.name}, the Gaoler` });
                items.push({ type: 'action', action: 'jailmap_bribe', label: 'Offer Him Coin', icon: '💰', desc: 'Guards are paid little and drink much' });
            } else if (npc._prisoner) {
                sep();
                items.push({ type: 'header', label: `⛓️ ${npc.name}, a Prisoner` });
                items.push({ type: 'action', action: 'jailmap_hail', label: 'Call Through the Bars', icon: '🗣️', desc: 'A word with the next cell', npc });
            }
        }
        if (!items.length) {
            items.push({ type: 'header', label: '🔒 The Jail' });
            items.push({ type: 'disabled', label: 'Your pallet, the flagstone, the cell door, your cellmates — right-click them.' });
        }
        return items;
    },

    /** Run a jail-map action. Returns true when handled. */
    handle(game, item) {
        const a = item && item.action;
        if (!a || !a.startsWith('jailmap_')) return false;
        const player = game.player;
        const world = game.world;
        // A word through the bars, or with the gaoler: anyone may
        if (a === 'jailmap_hail' || a === 'jailmap_gaoler') {
            const C = InnerMap.jailConfig();
            const line = _pick(a === 'jailmap_gaoler' ? C.gaolerLines : C.prisonerLines);
            if (item.npc && line) InnerMapReactions.bark(item.npc, line, 3.5);
            return true;
        }
        if (!player.jailState) return true;
        const note = (title, body, type = 'info') => {
            game.ui.showNotification(title, body, type);
            if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        };
        const scene = (phase) => ActionMenu.showScene(game, 'prison', { phase });
        switch (a) {
            case 'jailmap_sleep':
                note('🔒 Another Day', `You lie down on the damp straw. ${(Prison.state(player, world).cellmates || []).length} men snore around you.`);
                game.endDay();
                return true;
            case 'jailmap_dig': {
                const r = Prison.dig(player, world);
                if (!r.success) { note('Not Possible', r.reason, 'error'); return true; }
                note('⛏️ The Tunnel', r.text);
                game.endDay();
                return true;
            }
            case 'jailmap_work': {
                const r = Prison.work(player, world);
                if (!r.success) { note('Not Possible', r.reason, 'error'); return true; }
                note('🧱 The Yard', r.text);
                game.endDay();
                return true;
            }
            case 'jailmap_talk': case 'jailmap_food': {
                const r = Prison.talk(player, world, item.mateId, a === 'jailmap_food' ? 'food' : 'talk');
                if (!r.success) { note('Not Possible', r.reason, 'error'); return true; }
                if (item.npc) InnerMapReactions.bark(item.npc, r.became ? '*grins* You\'re all right.' : r.ok ? _pick(['Heh. Go on.', 'Is that right?', 'Same as me, then.']) : _pick(['Hm.', '*turns to the wall*', 'Leave me be.']), 3);
                note(r.became ? '🤝 A Friend Inside' : '🗣️ A Word in the Cell', r.text || 'You pass the time.', r.became ? 'success' : 'info');
                return true;
            }
            case 'jailmap_hail': {
                const line = _pick(InnerMap.jailConfig().prisonerLines);
                if (item.npc && line) InnerMapReactions.bark(item.npc, line, 3.5);
                return true;
            }
            case 'jailmap_bribe': scene('bribe'); return true;
            case 'jailmap_break': scene('break'); return true;
            case 'jailmap_mates': scene('mates'); return true;
            case 'jailmap_bail': {
                const r = Prison.postBail(player, world);
                note(r.success ? '💰 Bail Posted' : 'Not Possible', r.success ? r.text : r.reason, r.success ? 'success' : 'error');
                return true;
            }
            case 'jailmap_panel': scene('cell'); return true;
            default: return false;
        }
    },

    /**
     * Each frame on the jail map: once the sentence is over, open the door —
     * or, after an escape, get the player out of town.
     */
    update(game) {
        if (!InnerMap.active || !InnerMap.inJail()) return;
        const player = game && game.player;
        if (!player) return;
        const jail = InnerMap._jail;
        // The gaoler grumbles now and then
        const now = Date.now();
        if (!jail._nextGrumble || now > jail._nextGrumble) {
            jail._nextGrumble = now + 25000 + Math.random() * 20000;
            const g = (InnerMap.npcs || []).find(n => n._gaoler);
            const line = _pick(InnerMap.jailConfig().gaolerLines);
            if (g && line && jail._nextGrumble > 0 && jail._grumbled) InnerMapReactions.bark(g, line, 3.5);
            jail._grumbled = true;
        }
        if (!jail.locked || player.jailState) return;
        const how = player.lastJailRelease && player.lastJailRelease.how;
        if (how === 'escaped') {
            // Over the wall and away: off the town map before the watch comes round
            InnerMap.unlockJail();
            if (typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true });
            game.ui.showNotification('🏃 Over the Wall', 'You are out of the jail and away from the town before the alarm is raised. Keep moving.', 'warning');
            return;
        }
        InnerMap.unlockJail();
        const g = (InnerMap.npcs || []).find(n => n._gaoler);
        if (g) InnerMapReactions.bark(g, 'Off you go, then. Don\'t come back.', 4);
        game.ui.showNotification('🔓 Released', 'The gaoler turns the key: your cell door stands open. Walk out by the jail door.', 'success');
        if (typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        if (typeof game._updateBuildingExitButton === 'function') game._updateBuildingExitButton();
    },
};
