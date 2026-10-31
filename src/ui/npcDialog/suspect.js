// npcDialog — confronting a townsperson named in a rival House's plot (systems/schemes.js).
import { Schemes } from '../../systems/schemes.js';
import { dialogState } from './shared.js';
import { _render, _syncTranscript, _renderChoices, _renderChoiceList } from './render.js';
import { _animateDispositionChange } from './choices.js';

/** The open suspect record for the NPC in the dialog, or null. */
export function _currentSuspect() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.player || !npc || !npc._person || !npc._folk) return null;
    return Schemes.suspectFor(game.player, game.world, npc._folk, npc._person);
}

/** The opening choice for a suspect, or [] when this NPC is not one. */
export function _suspectChoices() {
    const s = _currentSuspect();
    if (!s) return [];
    return [{
        icon: '🗡️', label: `I know you've been working for ${s.rivalName}.`, cls: 'npc-dialog-choice-urgent', group: 'deal',
        tooltip: s.status === 'plotting' ? 'They are the agent of a plot against your House still in hand.' : 'They did a rival House\'s work against you.',
        onPick: () => _openConfrontation(s),
    }];
}

function _openConfrontation(s) {
    const box = dialogState._overlay && dialogState._overlay.querySelector('.npc-dialog-box');
    if (!box) return;
    const npc = dialogState._npc;
    const player = dialogState._game.player;
    dialogState._lines.push({ speaker: 'You', text: `I know you've been working for ${s.rivalName}.`, isNpc: false, _action: 'confront' });
    dialogState._lines.push({
        speaker: npc.name, icon: npc.icon, isNpc: true, _action: 'confront',
        text: s.status === 'plotting'
            ? `*goes pale* I... they paid me. I've a family to feed. Please — what are you going to do?`
            : `*won't meet your eye* It was only coin. I didn't know it would go so far.`,
    });
    dialogState._lineIndex = dialogState._lines.length - 1;
    _syncTranscript(box);
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    const cost = Schemes.turnCost(player, s);
    const back = () => { _renderChoices(box); };
    const choices = [
        { icon: '⚖️', label: 'Before all the town, I name you a traitor.', group: 'deal', cls: 'npc-dialog-choice-dark',
            tooltip: `They are driven out of town${s.status === 'plotting' ? ' and the plot is broken' : ''}. +reputation here; ${s.rivalName}'s feud grows; their kin turn on you.`,
            onPick: () => _resolve(s, 'accuse') },
        { icon: '💰', label: `Work for me now, and I'll pay you (${cost} gold).`, group: 'deal',
            tooltip: `${s.status === 'plotting' ? 'They feed the plotters false word: the plot fails. ' : ''}For months they warn you of ${s.rivalName}'s plots.`,
            cls: player.gold >= cost ? '' : 'npc-dialog-choice-muted',
            onPick: () => (player.gold >= cost ? _resolve(s, 'turn') : null) },
        { icon: '🕊️', label: 'Go. And don\'t let me see you at it again.', group: 'deal',
            tooltip: `Mercy: +karma, a friend for life, and the rival's grudge cools.${s.status === 'plotting' ? ' The plot goes on without them.' : ''}`,
            onPick: () => _resolve(s, 'release') },
        { icon: '↩️', label: 'I\'ll think on it.', group: 'leave', onPick: back },
    ];
    _renderChoiceList(choicesEl, choices, { back, hint: `${s.name} — ${s.role} of ${s.town}` });
}

function _resolve(s, choice) {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !npc) return;
    const before = npc._dialogMemory && typeof npc._dialogMemory.disposition === 'number' ? npc._dialogMemory.disposition : 50;
    const res = Schemes.confront(game.player, game.world, s.id, choice);
    const reply = !res.success ? res.reason
        : choice === 'accuse' ? '*is dragged away by the watch, cursing your name*'
            : choice === 'turn' ? '*pockets the coin* I\'ll be your ears. They\'ll never know.'
                : '*falls to their knees* Thank you. Thank you. I\'ll not forget this.';
    dialogState._lines.push({ speaker: npc.name, icon: npc.icon, isNpc: true, _action: 'confront', text: reply });
    dialogState._lineIndex = dialogState._lines.length - 1;
    const after = npc._dialogMemory && typeof npc._dialogMemory.disposition === 'number' ? npc._dialogMemory.disposition : before;
    if (after !== before) _animateDispositionChange(after - before);
    if (res.success && game.ui) {
        game.ui.showNotification(choice === 'accuse' ? '⚖️ Traitor Named' : choice === 'turn' ? '🕵️ Informant' : '🕊️ Mercy', res.text, 'success');
        if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
    }
    _render();
}
