// ActionMenu — court-office duty scenes (ui/actionMenu/choiceScenes.js).
//
// 'tax_round': the tax collector at a settlement chooses how to collect —
// fair, squeeze, spare the poor, or skim (systems/titles.js). The fee is
// rolled once when the scene opens; walking away collects fairly (the action
// points are already spent). The crown's share goes into the kingdom's
// treasury out of the town's purse (Titles._payCrown).
import { registerScene } from './choiceScenes.js';
import { Titles } from '../../systems/titles.js';

const MODE_TEXT = {
    fair: { icon: '⚖️', label: 'Collect fairly', hint: 'The levy as the rolls have it. The crown is content; the town grumbles as it always does.' },
    squeeze: { icon: '🗜️', label: 'Squeeze them', hint: 'Bailiffs at every door. More for the crown and for you, but the town turns sullen and remembers — later collections here yield less.' },
    spare: { icon: '🕊️', label: 'Spare the poor', hint: 'Let the poorest off. Less gold, but the town warms to you (+karma, +renown).' },
    skim: { icon: '🤫', label: 'Skim the take', hint: 'Keep your fee and pocket more besides. The month\'s audit may find the hole in the books.' },
};

function _tile(game, st) {
    return game.world.getTile(st.q, st.r);
}

function _collect(game, st, mode) {
    const tile = _tile(game, st);
    const res = Titles.collectTaxAtSettlement(game.player, tile, game.world, mode, st.assessment);
    if (!res.success) return { notification: { title: '❌ Cannot Collect', body: res.reason, type: 'error' } };
    const parts = [`You collected ${res.levy} gold for the crown from ${res.settlement} and kept your fee of ${res.fee} gold.`];
    if (res.crown < res.levy) parts.push(res.crown > 0 ? `Only ${res.crown} gold reached the royal treasury.` : 'Not a coin of it reached the royal treasury.');
    if (res.skim) parts.push(`A further ${res.skim} gold went into your own purse.`);
    if (res.riot) parts.push(`The town had had enough: a crowd drove your bailiffs off and you took a beating (−${res.riot.healthLost} health). Only half the fee was saved.`);
    if (mode === 'squeeze') parts.push(`${res.settlement} will not forget it (grudge ${res.resentment}).`);
    if (mode === 'spare') parts.push(`The poor of ${res.settlement} bless your name.`);
    parts.push(`Mood here: ${res.happiness}. Settlements this month: ${res.count}.`);
    return {
        notification: { title: res.riot ? '🔥 Tax Riot!' : '💰 Taxes Collected', body: parts.join(' '), type: res.riot ? 'warning' : (mode === 'skim' || mode === 'squeeze' ? 'warning' : 'success') },
    };
}

registerScene('tax_round', {
    view(game, st) {
        const tile = _tile(game, st);
        if (!tile || !tile.settlement || !st.assessment) return null;
        const a = st.assessment;
        const options = Titles.taxOptions(game.player, a).map(o => {
            const t = MODE_TEXT[o.id] || { icon: '•', label: o.id, hint: '' };
            const gold = o.skim ? `${o.fee}g fee + ${o.skim}g skimmed` : `${o.fee}g fee`;
            return {
                id: o.id, icon: t.icon, label: t.label, hint: `${t.hint} Crown's levy ${o.levy}g.${o.happiness ? ` Mood ${o.happiness > 0 ? '+' : ''}${o.happiness}.` : ''}`,
                cost: gold, chance: o.riotChance > 0 ? 1 - o.riotChance : null, isDefault: o.id === 'fair',
            };
        });
        const lines = [];
        if (a.resentment > 0) lines.push(`${a.settlement} still resents the last hard collection (grudge ${a.resentment}): the take is smaller, and squeezing again may start a riot.`);
        if (a.mult < 0.95) lines.push('A sullen town pays less than its rolls say.');
        return {
            icon: '📜', title: `Tax Day in ${a.settlement}`, panelTitle: '📜 Tax Collection',
            stats: [`Mood ${a.happiness}`, `Grudge ${a.resentment}`, `💰 ${Math.floor(game.player.gold || 0)} gold`],
            text: 'The rolls are open and the townsfolk line up at the tax-house. How will you collect?',
            lines, options,
            footer: 'Walk away and your clerks collect fairly in your name.',
        };
    },
    act(game, st, choice) {
        if (!MODE_TEXT[choice]) return { invalid: true };
        return _collect(game, st, choice);
    },
    abandon(game, st) {
        return _collect(game, st, 'fair');
    },
});

/** Open the tax-round scene at a settlement (null when nothing can be collected). */
export function startTaxRound(game, tile) {
    const assessment = Titles.taxAssessment(game.player, tile, game.world);
    if (!assessment) return null;
    return { q: tile.q, r: tile.r, assessment };
}
