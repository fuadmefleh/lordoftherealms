// npcDialog — the town's school (systems/townSchool.js): ask the priest or the
// schoolmaster how it fares, give to it, or pay for a poor child's schooling.
import { TownSchool } from '../../systems/townSchool.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { TownJobs } from '../../systems/townJobs.js';
import { dialogState } from './shared.js';
import { _render } from './render.js';
import { _animateDispositionChange } from './choices.js';

function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    const folk = npc && npc._folk;
    if (!game || !game.world || !npc || !npc._person || !folk) return null;
    const tile = game.world.getTile ? game.world.getTile(folk.q, folk.r) : null;
    const settlement = tile && tile.settlement;
    if (!settlement || !TownSchool.config().enabled) return null;
    return { game, npc, folk, p: npc._person, world: game.world, settlement, day: game.world.day || 1 };
}

const _asked = a => dialogState._lines.some(l => l._action === a);

function _say(action, said, text, change = 0, note = null) {
    const c = _ctx();
    if (!c) return;
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: action });
    dialogState._lines.push({ speaker: c.npc.name, icon: c.npc.icon, text, isNpc: true, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;
    if (change) _animateDispositionChange(change);
    if (note && c.game.ui && c.game.ui.showNotification) setTimeout(() => c.game.ui.showNotification(note[0], note[1], 'success'), 900);
    if (c.game.ui && c.game.ui.updateStats) c.game.ui.updateStats(c.game.player, c.game.world);
    _render();
}

/** Who teaches: the priest, or the schoolmaster on the book. */
function _isTeacher(c) {
    return c.p.role === 'priest' || c.p.teaches === 'schoolmaster';
}

/** The school's choices for the NPC in the dialog ([] when none fit). */
export function _schoolChoices() {
    const c = _ctx();
    if (!c) return [];
    const out = [];
    const player = c.game.player;
    if (_isTeacher(c) && !_asked('school_ask')) {
        out.push({
            icon: '📚', label: 'How fares the school?', group: 'talk', tooltip: 'Who comes to learn their letters, and what it costs.',
            onPick: () => {
                const v = TownSchool.view(c.world, c.settlement, c.folk, c.day);
                const n = Object.values(v.pupils).reduce((a, b) => a + b, 0);
                const parts = [];
                parts.push(n ? `We have ${n} at their letters: ${Object.entries(v.pupils).map(([k, m]) => `${m} at ${TownSchool.config().kinds[k].label}`).join(', ')}.` : 'Few children come to learn their letters. Their families need their hands.');
                if (v.master) parts.push(`${v.master} keeps the town school.`);
                if (v.literacy.known) parts.push(`Of the grown folk I taught or saw taught, ${Math.round(v.literacy.share * 100)} in a hundred can write.`);
                parts.push(v.fund > 0 ? `The school's fund holds ${Math.round(v.fund)} gold, and it keeps the poor ones at their slates.` : 'There is no fund: the poor pay what they can, the parish the rest.');
                _say('school_ask', 'How fares the school?', parts.join(' '), 1);
            },
        });
    }
    if (_isTeacher(c) && !_asked('school_give')) {
        for (const amt of [25, 100]) {
            out.push({
                icon: '🎓', label: `Let me give ${amt} gold to the school.`, group: 'deal',
                cls: (player.gold || 0) >= amt ? '' : 'npc-dialog-choice-muted',
                tooltip: 'Its fund pays for poor children\'s schooling: more of the town learns to read and write. The teacher and the parents think the better of you.',
                onPick: () => {
                    const r = TownSchool.donate(player, c.world, c.settlement, amt);
                    if (!r.success) { _say('school_give', `Let me give ${amt} gold to the school.`, r.reason); return; }
                    _say('school_give', `Let me give ${amt} gold to the school.`, `*takes the purse in both hands* God bless you. ${amt >= 100 ? 'This will keep a dozen children at their letters.' : 'Every coin is a child at a slate instead of a plough.'}`, 0,
                        ['🎓 A gift to the school', `${amt} gold to the school of ${c.settlement.name}. ${r.touched} families think the better of you.${r.prestige ? ` +${r.prestige} Prestige.` : ''}`]);
                },
            });
        }
    }
    // A poor child of school age, or their parent: pay for the schooling
    const kids = c.p.role === 'child' ? [c.p] : (c.p.kids || []).map(id => Townsfolk.get(c.folk, id)).filter(Boolean);
    const can = new Set(TownSchool.sponsorable(c.world, c.settlement, c.folk, c.day).map(k => k.id));
    const cost = TownSchool.config().patron.sponsorCost;
    for (const k of kids.filter(x => can.has(x.id)).slice(0, 2)) {
        if (_asked(`school_sponsor_${k.id}`)) continue;
        const who = k === c.p ? 'your' : `${k.first}'s`;
        out.push({
            icon: '🎓', label: `I'll pay for ${who} schooling (${cost} gold).`, group: 'deal',
            cls: (player.gold || 0) >= cost ? '' : 'npc-dialog-choice-muted',
            tooltip: `${k.first} goes to school instead of to work, and grows up able to read and write — and grateful to you.`,
            onPick: () => {
                const before = c.p.mem ? c.p.mem.disposition : 50;
                const r = TownSchool.sponsor(player, c.world, c.settlement, k);
                const said = `I'll pay for ${who} schooling.`;
                if (!r.success) { _say(`school_sponsor_${k.id}`, said, r.reason); return; }
                const text = k === c.p ? '*eyes wide* Me? To school? I\'ll learn every letter, I swear it!' : `*can't speak for a moment* ${k.first}, at school… You don't know what this means to us.`;
                _say(`school_sponsor_${k.id}`, said, text, (c.p.mem ? c.p.mem.disposition : 50) - before, ['🎓 A child at school', `${k.first} ${k.last} will go to school at your expense.`]);
            },
        });
    }
    // One the player schooled, grown and loyal: they offer to serve (systems/townJobs.js hires them)
    if (c.p.loyal === 'player' && Townsfolk.age(c.p, c.day) >= 16 && !(c.p.job && c.p.job.employer === 'player')) {
        // (their letters fit them for a clerk's desk: systems/townJobs.js clerk, minLiteracy)
        for (const kind of ['clerk', 'servant', 'guard']) {
            if (_asked('school_serve')) break;
            const T = TownJobs.offerTerms(player, c.world, c.folk, c.p, kind);
            if (!T || T.refuse) continue;
            out.push({
                icon: kind === 'clerk' ? '📜' : kind === 'guard' ? '🛡️' : '🏠', label: `You'd serve me? Then be my ${kind}, ${c.p.first} (${T.wage}g a week).`, group: 'deal',
                tooltip: `${c.p.first} owes you their schooling and offers to serve you. The first week's wage is paid in hand.`,
                onPick: () => {
                    const res = TownJobs.offerWork(player, c.world, c.settlement, c.p, kind);
                    _say('school_serve', `Then be my ${kind}.`, res.ok ? `I'd hoped you'd ask. I'll not fail you — not after what you did for me.` : res.text, 0,
                        res.ok ? ['🎓 Loyal service', `${Townsfolk.name(c.p)}, whom you schooled, is now your ${kind}.`] : null);
                },
            });
        }
    }
    return out;
}

