// npcDialog — crimes against people (systems/peopleCrimes.js) in talk:
//   - to one of the watch, in a town where you have hidden goods in someone's
//     house these last few days: "I saw them with stolen goods" — the tip-off
//     that sends the watch to search, and the trial after;
//   - to someone who carries your mark (a thief's brand, a lost hand): ask
//     about it, and hear what they make of you.
import { PeopleCrimes } from '../../systems/peopleCrimes.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { InnerMap } from '../../world/innerMap.js';
import { dialogState } from './shared.js';
import { _render } from './render.js';
import { _animateDispositionChange } from './choices.js';

function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.world || !game.player || !npc) return null;
    const wt = InnerMap.currentWorldTile || { q: game.player.q, r: game.player.r };
    return { game, npc, world: game.world, player: game.player, q: wt.q, r: wt.r };
}

function _asked(action) {
    return dialogState._lines.some(l => l._action === action);
}

function _say(c, action, said, reply, change = 0) {
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: action });
    dialogState._lines.push({ speaker: c.npc.name, icon: c.npc.icon, text: reply || '…', isNpc: true, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;
    if (change) _animateDispositionChange(NpcDisposition.adjustDisposition(c.npc, change, c.player));
    _render();
}

/** The choices for this conversation. */
export function _darkChoices() {
    const c = _ctx();
    if (!c) return [];
    const out = [];
    const day = c.world.day || 0;
    // The watch: tell them where to look
    if (/guard|watch/i.test(String(c.npc.type || ''))) {
        for (const f of PeopleCrimes.pendingFrames(c.player, c.q, c.r, day)) {
            const action = `pc_tip_${f.id}`;
            if (_asked(action)) continue;
            const odds = PeopleCrimes.convictOdds(c.player, c.world, f);
            out.push({
                icon: '👉', label: `I saw ${f.name} with stolen goods. Search their house.`, group: 'deal',
                tooltip: `The watch searches, finds what you hid, and ${f.name} stands trial in a few days: about ${Math.round(odds.chance * 100)}% they are convicted. Their kin will hold it against you; and lies have a way of coming out.`,
                onPick: () => {
                    const res = PeopleCrimes.tipOff(c.player, c.world, f.id);
                    _say(c, action, `I saw ${f.name} with stolen goods. Search their house.`, res.text, res.ok ? 2 : 0);
                },
            });
        }
    }
    // Someone who carries your mark
    const p = c.npc._person;
    const mark = PeopleCrimes.markOf(p);
    if (mark && !_asked('pc_mark')) {
        const ask = { maimed: 'What happened to your hand?', galley: 'Where did you get that mark?' }[mark.mark] || 'What happened to your face?';
        const reply = {
            maimed: 'You know very well what happened to it. You were there. You held the blade.',
            galley: 'The galley masters burned it there, the day you sold me to them. I pulled an oar for years. I counted every stroke.',
        }[mark.mark] || 'Ask yourself. It was your iron. Every soul in this town reads it when I pass.';
        out.push({
            icon: mark.mark === 'maimed' ? '🤕' : '🔥', label: ask, group: 'talk', tooltip: mark.text,
            onPick: () => _say(c, 'pc_mark', ask, reply, -3),
        });
    }
    return out;
}
