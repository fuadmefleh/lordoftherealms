// npcDialog — blood feuds in talk (systems/bloodFeuds.js):
//   - to one of a family that owes your House blood: hear it from them, and
//     offer the blood price to their face (paid to the one who carries the feud);
//   - in a town you hold, to one of two feuding families: sit in judgement and
//     order the killers' kin to pay the bereaved their blood price.
import { BloodFeuds } from '../../systems/bloodFeuds.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { InnerMap } from '../../world/innerMap.js';
import { Utils } from '../../core/utils.js';
import { dialogState } from './shared.js';
import { _render } from './render.js';
import { _animateDispositionChange } from './choices.js';

function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.world || !game.player || !npc || !npc._person) return null;
    const wt = InnerMap.currentWorldTile || { q: game.player.q, r: game.player.r };
    const tile = game.world.getTile(wt.q, wt.r);
    return { game, npc, world: game.world, player: game.player, s: tile && tile.settlement };
}

function _asked(action) {
    return dialogState._lines.some(l => l._action === action);
}

function _say(c, action, said, reply, change = 0) {
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: action });
    dialogState._lines.push({ speaker: c.npc.name, icon: c.npc.icon, text: reply || '…', isNpc: true, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;
    if (change) _animateDispositionChange(NpcDisposition.adjustDisposition(c.npc, change, c.player));
    if (c.game.ui && typeof c.game.ui.updateStats === 'function') c.game.ui.updateStats(c.player, c.world);
    _render();
}

/** The choices for this conversation. */
export function _feudChoices() {
    const c = _ctx();
    if (!c) return [];
    const out = [];
    const f = BloodFeuds._familyFeud(c.world, c.npc);
    if (f) {
        const dead = BloodFeuds.unavenged(f)[0];
        if (!_asked('bf_ask')) {
            out.push({
                icon: '⚔️', label: 'Why do you look at me so?', group: 'talk',
                onPick: () => _say(c, 'bf_ask', 'Why do you look at me so?', `You know why. ${dead ? `${dead.name}'s` : 'Our'} blood is on your House. We have not forgotten, and we will not.`, -2),
            });
        }
        const q = BloodFeuds.wergildQuote(c.world, c.player, f.id);
        const action = `bf_wergild_${f.id}`;
        if (!_asked(action) && q.price) {
            const said = `Let there be an end to it. I offer the blood price${dead ? ` for ${dead.name}` : ''}: ${Utils.formatGold(q.price)} gold.`;
            out.push({
                icon: '💰', label: `Offer the blood price (${Utils.formatGold(q.price)}g)`, group: 'deal',
                tooltip: q.ok ? `Paid to ${q.bearer || q.payee}, before ${q.arbiter}. About ${Math.round(q.chance * 100)}% they take it.` : q.reason,
                onPick: () => {
                    const res = BloodFeuds.offerWergild(c.world, c.player, f.id);
                    if (!res.success) { _say(c, action, said, res.reason); return; }
                    _say(c, action, said, res.accepted ? `${res.text} …So be it. It is ended between us.` : res.text, res.accepted ? 8 : -4);
                },
            });
        }
    }
    // A feud between two families of a town you hold: sit in judgement
    if (c.s) {
        const p = c.npc._person;
        for (const j of BloodFeuds.judgeable(c.world, c.player, c.s)) {
            if (![j.payer.last, j.payee.last].includes(p.last)) continue;
            const action = `bf_judge_${j.feud.id}`;
            if (_asked(action)) continue;
            const said = `I will hear no more of this feud. The ${j.payer.name} will pay the ${j.payee.name} ${Utils.formatGold(j.price)} gold, and there's an end.`;
            out.push({
                icon: '⚖️', label: `Judge the feud of the ${j.payer.name} and the ${j.payee.name}`, group: 'deal',
                tooltip: `As their lord: the ${j.payer.name} pay ${Utils.formatGold(j.price)}g blood price to the ${j.payee.name}, a tenth to your purse.`,
                onPick: () => {
                    const res = BloodFeuds.arbitrate(c.world, c.player, j.feud.id);
                    _say(c, action, said, res.success ? `${res.text} …As my lord says.` : res.reason, res.success ? 3 : 0);
                },
            });
        }
    }
    return out;
}
