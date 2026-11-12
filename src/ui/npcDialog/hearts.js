// npcDialog — matters of the heart among the townsfolk (systems/romance.js):
// ask who is sweet on whom, carry a love letter, put in a good word, or
// meddle with a tale. A suitor who resents the player for courting their
// sweetheart says so.
import { Romance } from '../../systems/romance.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { Languages } from '../../systems/languages.js';
import { dialogState } from './shared.js';
import { _render } from './render.js';
import { _animateDispositionChange, _showSkillCheckResult } from './choices.js';
import { _getSkillTotal } from './helpers.js';

function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.world || !npc || !npc._person || !npc._folk || npc.type === 'child') return null;
    return { game, npc, folk: npc._folk, p: npc._person, world: game.world };
}

function _asked(action) {
    return dialogState._lines.some(l => l._action === action);
}

/** The good word's odds: the player's persuasion (0.35 … 0.95). */
function _wordChance() {
    const total = _getSkillTotal('diplomacy') || 0;
    return Math.max(0.35, Math.min(0.95, 0.35 + total * 0.06));
}

/** The heart's choices for the NPC in the dialog ([] when none fit). */
export function _heartChoices() {
    const c = _ctx();
    if (!c || !c.folk.romance) return [];
    // (gossip and go-betweens want words: not by pointing and gesture — systems/languages.js)
    const tongue = dialogState._tongue;
    if (tongue && tongue.via !== 'translator' && tongue.level && Languages.dialogChoices(tongue.level.id)) return [];
    const out = [];
    if (!_asked('ask_hearts')) {
        out.push({
            icon: '💞', label: 'Who\'s sweet on whom around here?', group: 'talk',
            tooltip: 'Courtships, sweethearts and broken hearts in town.',
            onPick: () => _say('ask_hearts', 'Who\'s sweet on whom around here?', () => {
                const resent = Romance.resentLine(c.folk, c.p, c.world);
                const text = Romance.gossipFor(c.folk, c.p, c.world);
                return { text: resent ? `${resent} ${text}` : text, change: resent ? 0 : 1 };
            }),
        });
    }
    const o = Romance.offers(c.folk, c.p, c.world);
    if (!o) return out;
    const name = o.other.first;
    if (o.ops.includes('deliver') && !_asked('hearts_deliver')) {
        out.push({
            icon: '💌', label: `I bring a letter from ${name}.`, cls: 'npc-dialog-choice-urgent', group: 'deal',
            tooltip: `The match warms; both of them think the better of you.`,
            onPick: () => _say('hearts_deliver', `I bring a letter from ${name}.`, () => {
                const r = Romance.deliver(c.folk, c.p, c.world);
                return r ? { text: r.line, change: r.regard, note: ['💌 Love letter delivered', `${name}'s letter reached ${c.p.first}. The match warms.`] } : null;
            }),
        });
    } else if (o.ops.includes('carry') && !_asked('hearts_carry')) {
        out.push({
            icon: '💌', label: `Shall I carry word to ${name} for you?`, group: 'deal',
            tooltip: `They give you a love letter for ${name} (in town). Deliver it within ${Romance.config().player.tokenDays} days.`,
            onPick: () => _say('hearts_carry', `Shall I carry word to ${name} for you?`, () => {
                const r = Romance.carry(c.folk, c.p, c.world);
                return r ? { text: r.line, change: 2, note: ['💌 A love letter', `Carry ${c.p.first}'s letter to ${name}, and say it came from no one else.`] } : null;
            }),
        });
    }
    if (o.ops.includes('goodWord') && !_asked('hearts_word')) {
        const pct = Math.round(_wordChance() * 100);
        out.push({
            icon: '💬', check: 'Charm', label: `${name} speaks very warmly of you, you know.`, group: 'deal', chance: pct,
            tooltip: `Put in a good word for ${name}: ${pct}% it lands, and the match warms.`,
            onPick: () => _say('hearts_word', `${name} speaks very warmly of you, you know.`, () => {
                const r = Romance.goodWord(c.folk, c.p, c.world, _wordChance());
                if (!r) return null;
                _showSkillCheckResult(r.ok, 'Charm');
                return { text: r.line, change: r.regard };
            }),
        });
    }
    if (o.ops.includes('meddle') && !_asked('hearts_meddle')) {
        out.push({
            icon: '🐍', label: `I hear ${name} has a wandering eye.`, cls: 'npc-dialog-choice-dark', group: 'deal',
            tooltip: `Sow doubt: the match cools and may break. ⚠ If it's traced to you, both of them will hate you for it.`,
            onPick: () => _say('hearts_meddle', `I hear ${name} has a wandering eye.`, () => {
                const r = Romance.meddle(c.folk, c.p, c.world);
                if (!r) return null;
                const note = r.broke ? ['💔 A match broken', `${c.p.first} and ${name} are finished.${r.caught ? ' And they know it was you.' : ''}`] : null;
                return { text: r.line, change: r.regard, note };
            }),
        });
    }
    return out;
}

/** The player says `said`; the NPC answers with what `fn` returns ({ text, change, note }). */
function _say(action, said, fn) {
    const c = _ctx();
    if (!c) return;
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: action });
    const res = fn() || { text: '*shrugs* I don\'t know what you mean.' };
    dialogState._lines.push({ speaker: c.npc.name, icon: c.npc.icon, text: res.text || '...', isNpc: true, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;
    if (res.change) {
        const gained = NpcDisposition.adjustDisposition(c.npc, res.change, c.game.player);
        _animateDispositionChange(gained);
    }
    if (c.game.player && c.game.player.modifyNeed) c.game.player.modifyNeed('social', 3);
    if (res.note && c.game.ui && c.game.ui.showNotification) {
        setTimeout(() => c.game.ui.showNotification(res.note[0], res.note[1], 'info'), 900);
    }
    _render();
}
