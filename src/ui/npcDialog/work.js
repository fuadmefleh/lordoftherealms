// npcDialog — a townsperson's work (systems/townJobs.js) and the church
// (systems/townWorship.js): ask what they do; offer them work in your service
// (a servant, a guard, a hand) where you keep a house or property in town, or
// let one of yours go; and with the priest: give to the church, pray, or
// shout down the sermon (a scandal).
import { TownJobs } from '../../systems/townJobs.js';
import { TownWorship } from '../../systems/townWorship.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { InnerMap } from '../../world/innerMap.js';
import { dialogState } from './shared.js';
import { _render } from './render.js';
import { _animateDispositionChange } from './choices.js';

function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.world || !npc || !npc._person || !npc._folk) return null;
    const tile = game.world.getTile && game.world.getTile(npc._folk.q, npc._folk.r);
    return { game, npc, folk: npc._folk, p: npc._person, world: game.world, player: game.player, settlement: tile && tile.settlement };
}

function _asked(action) {
    return dialogState._lines.some(l => l._action === action);
}

/** The player keeps a house or property in this town (on the map). */
function _hasPlace() {
    return (InnerMap.buildings || []).some(b => b && (b.isPlayerProperty || b.isPlayerOwned));
}

function _say(action, said, fn) {
    const c = _ctx();
    if (!c) return;
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: action });
    const res = fn(c) || { text: '…' };
    dialogState._lines.push({ speaker: c.npc.name, icon: c.npc.icon, text: res.text || '…', isNpc: true, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;
    if (res.change) _animateDispositionChange(NpcDisposition.adjustDisposition(c.npc, res.change, c.player));
    if (res.note && c.game.ui && c.game.ui.showNotification) setTimeout(() => c.game.ui.showNotification(res.note[0], res.note[1], 'info'), 900);
    _render();
}

/** The work and church choices for this conversation. */
export function _workChoices() {
    const c = _ctx();
    if (!c || !TownJobs.enabled()) return [];
    const out = [];
    const day = c.world.day || 1;
    const job = c.p.job;
    if (!_asked('work_ask') && c.npc.type !== 'traveler') {
        out.push({
            icon: '🔨', label: 'What\'s your work?', group: 'talk', tooltip: 'Their trade, their master, how long at it.',
            onPick: () => _say('work_ask', 'What\'s your work?', (k) => {
                const place = k.npc._work ? String(k.npc._work.name || k.npc._work.type || 'tavern').toLowerCase() : 'tavern';
                return { text: TownJobs.describe(k.folk, k.p, k.world, { town: k.settlement ? k.settlement.name : 'this town', place, settlement: k.settlement }), change: 1 };
            }),
        });
    }
    // Your own people
    if (job && job.employer === 'player' && !_asked('work_dismiss')) {
        out.push({
            icon: '🚪', label: 'I\'ll not need you any longer.', group: 'deal', tooltip: 'Let them go from your service.',
            onPick: () => _say('work_dismiss', 'I\'ll not need you any longer.', (k) => {
                TownJobs.dismiss(k.world, k.folk, k.p, 'dismissed');
                k.npc.job = k.p.job.id;
                return { text: 'As you wish. I\'ll find other work.', change: -3 };
            }),
        });
    } else if (job && _hasPlace() && !_asked('work_offer') && TownJobs.title(c.p)) {
        for (const kind of Object.keys(TownJobs.config().playerJobs.kinds || {})) {
            const T = TownJobs.offerTerms(c.player, c.world, c.folk, c.p, kind);
            if (!T || T.refuse) continue;
            const K = TownJobs.config().playerJobs.kinds[kind];
            out.push({
                icon: K.icon || '💼', label: `I could use ${/^[aeiou]/.test(K.name) ? 'an' : 'a'} ${K.name}. ${T.wage} gold a week.`, group: 'deal',
                tooltip: `${Math.round(T.chance * 100)}% they'll take it. They'd leave their own work and keep your house; paid weekly from your purse.`,
                onPick: () => _say('work_offer', `I could use a ${K.name}, at ${T.wage} gold a week.`, (k) => {
                    const r = TownJobs.offerWork(k.player, k.world, k.settlement, k.p, kind);
                    if (r.ok) { k.npc.job = k.p.job.id; k.npc.roleTitle = TownJobs.title(k.p); if (InnerMap._assignJobPlaces) InnerMap._assignJobPlaces(); }
                    return { text: r.text, change: r.ok ? 4 : 0, note: r.ok ? ['💼 Taken into service', `${k.p.first} ${k.p.last} is your ${K.name}: ${r.wage} gold a week.`] : null };
                }),
            });
        }
    }
    // The priest: give, pray, or — in the service — shout it down
    if (job && job.id === 'priest' && c.settlement) {
        const P = TownWorship.config().player || {};
        if (!_asked('church_give')) {
            for (const g of (P.donate || [5, 25]).slice(0, 3)) {
                if ((c.player.gold || 0) < g) continue;
                out.push({
                    icon: '🙏', label: `For the church: ${g} gold.`, group: 'deal', tooltip: 'Into the priest\'s hands, for the poor and the roof.',
                    onPick: () => _say('church_give', `Take this for the church — ${g} gold.`, (k) => {
                        const r = TownWorship.donate(k.player, k.world, k.settlement, g);
                        return { text: r.text, change: r.ok ? r.regard : 0 };
                    }),
                });
            }
        }
        if (!_asked('church_pray')) {
            out.push({
                icon: '🕯️', label: 'Will you pray with me?', group: 'talk', tooltip: 'A moment\'s peace.',
                onPick: () => _say('church_pray', 'Will you pray with me?', (k) => { TownWorship.pray(k.player); return { text: 'Gladly. Kneel with me… There. Go with the gods.', change: 2 }; }),
            });
        }
        const sv = InnerMap.serviceAt ? InnerMap.serviceAt(InnerMap._sceneClock ? InnerMap._sceneClock() : InnerMap.timeOfDay, day, false) : null;
        if (sv && sv.begun && InnerMap._insideBuilding && !_asked('church_disrupt')) {
            out.push({
                icon: '📢', label: 'Lies! All of it!', group: 'sway', cls: 'npc-dialog-choice-dark', tooltip: '⚠ Shout down the sermon: a scandal. The devout will hate you for it.',
                onPick: () => _say('church_disrupt', 'Lies! All of it! Your gods are deaf!', (k) => {
                    TownWorship.disrupt(k.player, k.world, k.settlement);
                    return { text: 'Out! Out of this holy place! The gods see you!', change: -30, note: ['📢 A scandal', 'You shouted down the sermon. The town will talk of nothing else.'] };
                }),
            });
        }
    }
    return out;
}
