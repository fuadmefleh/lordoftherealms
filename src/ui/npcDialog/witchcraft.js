// npcDialog — crying witch on a healer or an old woman (systems/profaneCrimes.js):
// before the priest (a trial, a bribe for him) or to the street (a mob).
import { ProfaneCrimes } from '../../systems/profaneCrimes.js';
import { InnerMap } from '../../world/innerMap.js';
import { dialogState } from './shared.js';
import { _render, _syncTranscript, _renderChoices, _renderChoiceList } from './render.js';

function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.player || !game.world || !npc || !npc._person || !npc._folk) return null;
    const t = game.world.getTile(game.player.q, game.player.r);
    const s = t && t.settlement;
    if (!s) return null;
    if (!ProfaneCrimes.accusable(game.world, npc._folk, npc._person).ok) return null;
    return { game, npc, s, folk: npc._folk, p: npc._person };
}

/** The opening choice, or [] when no one would believe it of this person. */
export function _witchChoices() {
    const c = _ctx();
    if (!c) return [];
    return [{
        icon: '🔥', label: 'I know what you are. Witch.', cls: 'npc-dialog-choice-dark', group: 'deal',
        tooltip: 'Cry witch on her: a trial or a mob. Condemned, she dies and what she owns is seized. Her kin will never forget it.',
        onPick: () => _open(c),
    }];
}

function _open(c) {
    const box = dialogState._overlay && dialogState._overlay.querySelector('.npc-dialog-box');
    if (!box) return;
    const { game, npc, s, folk, p } = c;
    dialogState._lines.push({ speaker: 'You', text: 'I know what you are. Witch.', isNpc: false, _action: 'witch' });
    dialogState._lines.push({ speaker: npc.name, icon: npc.icon, isNpc: true, _action: 'witch', text: '*goes white* What are you saying? I have done nothing but tend the sick. Don\'t — please, not that word, not here.' });
    dialogState._lineIndex = dialogState._lines.length - 1;
    _syncTranscript(box);
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    const W = ProfaneCrimes.config().witch;
    const fair = ProfaneCrimes.trialChance(game.player, game.world, s, folk, p);
    const bought = ProfaneCrimes.trialChance(game.player, game.world, s, folk, p, { bribe: true });
    const rich = (game.player.gold || 0) >= W.trial.bribeGold;
    const back = () => { _renderChoices(box); };
    const choices = [
        { icon: '⚖️', label: 'Before the priest, I name you a witch.', group: 'deal', cls: 'npc-dialog-choice-dark',
            tooltip: `A trial: ${Math.round(fair * 100)}% the town finds against her. Condemned, she burns; you take a share of her purse and her land. Acquitted, you are the false accuser.`,
            onPick: () => _resolve(c, 'trial', false) },
        { icon: '💰', label: `Before the priest — and a word in his ear (${W.trial.bribeGold} gold).`, group: 'deal',
            cls: rich ? 'npc-dialog-choice-dark' : 'npc-dialog-choice-muted',
            tooltip: `The priest is paid: ${Math.round(bought * 100)}% the town finds against her.`,
            onPick: () => (rich ? _resolve(c, 'trial', true) : null) },
        { icon: '🔥', label: 'Witch! (to the street)', group: 'deal', cls: 'npc-dialog-choice-dark',
            tooltip: 'A mob: she dies for certain. You get only part of her purse, none of her land, and everyone knows who started it.',
            onPick: () => _resolve(c, 'mob', false) },
        { icon: '↩️', label: 'Never mind.', group: 'leave', onPick: back },
    ];
    _renderChoiceList(choicesEl, choices, { back, hint: `${npc.name} of ${s.name}` });
}

function _resolve(c, how, bribe) {
    const { game, npc, s, folk, p } = c;
    const res = ProfaneCrimes.accuseWitch(game.player, game.world, s, folk, p, how, { bribe });
    const reply = !res.success ? res.reason
        : res.outcome === 'acquitted' ? '*stands before the priest, and walks out free, and looks at you once*'
            : '*is dragged away screaming that she never did, never once*';
    dialogState._lines.push({ speaker: npc.name, icon: npc.icon, isNpc: true, _action: 'witch', text: reply });
    dialogState._lineIndex = dialogState._lines.length - 1;
    // condemned: she is taken off the street now, not when the town map next rebuilds
    if (res.success && res.outcome !== 'acquitted') {
        const i = (InnerMap.npcs || []).indexOf(npc);
        if (i >= 0) InnerMap.npcs.splice(i, 1);
    }
    if (res.success && game.ui) {
        game.ui.showNotification(res.outcome === 'acquitted' ? '⚖️ Acquitted' : '🔥 A Witch Burned', res.text, res.outcome === 'acquitted' ? 'warning' : 'info');
        if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
    }
    _render();
}
