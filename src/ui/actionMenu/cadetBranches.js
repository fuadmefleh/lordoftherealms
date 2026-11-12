// ActionMenu — the House's cadet branches (systems/cadetBranches.js): each
// branch's head, seat, purse, loyalty and doings, with the player's hand by
// letter (a gift, an ask for gold or men, a summons), and sending a grown
// child off to found a branch (with a grant of gold and, if the House holds
// any, an estate). Reached from the House panel (Dynasty → House).
import { ActionMenu } from './_ref.js';
import { CadetBranches } from '../../systems/cadetBranches.js';
import { Inheritance } from '../../systems/inheritance.js';
import { lede, bullets, card, rowList, chips, price, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function loyaltyTone(v) {
    return v >= 60 ? 'good' : v >= 40 ? 'gold' : v >= 20 ? 'warn' : 'bad';
}

function branchCard(v) {
    let body = `<div style="${NOTE}"><b style="color:#d8c27a;">${esc(v.name)}</b> · ${v.depth > 1 && v.parent ? `a branch of ${esc(v.parent)}` : `founded by ${esc(v.founder)}${v.why === 'own' ? ', who left on their own' : ''}`} · seat at ${esc(v.seat || '—')} · ${esc(v.wealth)}${v.heads > 1 ? ` · ${v.heads} heads so far` : ''}</div>`;
    if (v.traits.length) body += `<div style="font-size:12px; margin-top:3px;">${v.traits.map(t => `${t.icon} ${esc(t.name)}`).join(' · ')}</div>`;
    const kids = v.children.map(c => `${esc(c.name)} (${c.age}${c.wed ? `, wed${c.wed !== 'wed' && c.wed !== 'another House' ? ` into ${esc(c.wed)}` : ''}` : ''})`);
    body += `<div style="font-size:12px; margin-top:3px;">${v.spouse ? `Married to ${esc(v.spouse)}` : 'Unmarried'}${kids.length ? ` · children: ${kids.join(', ')}` : ' · no children'}</div>`;
    const extras = [`🧭 ${esc(v.doing)}${v.where ? ` (near ${esc(v.where)})` : ''}`];
    if (v.estates.length) extras.push(`🌾 ${v.estates.map(esc).join(', ')}`);
    if (v.tribute) extras.push(`💰 ${v.tribute}g sent to you`);
    if (v.gifts) extras.push(`🎁 ${v.gifts}g given them`);
    if (v.levy) extras.push('🛡️ their men serve with you');
    body += `<div style="${NOTE} margin-top:3px;">${extras.join(' · ')}</div>`;
    if (v.log.length) body += `<div style="${NOTE} margin-top:4px;">${v.log.map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`;
    return card(body, {
        icon: v.estranged ? '💢' : '🌿', title: `${esc(v.head)}, ${v.age}`,
        side: `${v.label} (${v.loyalty})`, tone: loyaltyTone(v.loyalty),
    });
}

function actsFor(game, v) {
    const gold = Inheritance.coin(game.player);
    const G = CadetBranches.config().gift;
    const rows = (G.amounts || [100, 300, 1000]).map(n => ({
        icon: '🎁', name: `Send ${n} gold`, desc: 'A gift by courier: loyalty rises (less for a second gift soon after)',
        act: 'cadetAct', args: [v.id, 'gift', n], side: price(n, gold >= n), off: gold < n, why: 'You do not have the gold.',
    }));
    const wait = (k) => (v.waits[k] ? `asked lately: again in ${v.waits[k]} days` : '');
    rows.push({
        icon: '💰', name: 'Ask for gold', desc: `A share of their purse; costs loyalty${v.loyalty < v.needs.gold ? ' — they are unlikely to agree' : ''}`,
        act: 'cadetAct', args: [v.id, 'gold'], off: !!v.waits.gold, why: wait('gold'),
    });
    rows.push({
        icon: '🛡️', name: 'Call their men to arms', desc: `A levy to serve with you, paid by the branch; costs loyalty${v.loyalty < v.needs.men ? ' — they are unlikely to agree' : ''}`,
        act: 'cadetAct', args: [v.id, 'men'], off: !!v.waits.men || v.levy, why: v.levy ? 'Their men already serve with you.' : wait('men'),
    });
    rows.push({
        icon: '📜', name: 'Summon to your side', desc: `The head rides to the town nearest you and stays a few days: loyalty and Prestige${v.loyalty < v.needs.summon ? ' — they may refuse' : ''}`,
        act: 'cadetAct', args: [v.id, 'summon'], off: !!v.waits.summon, why: wait('summon'),
    });
    return rowList(rows);
}

Object.assign(ActionMenu, {
    /** Every cadet branch of the House, and the children who could found one. */
    showCadetBranches(game) {
        const { player, world } = game;
        const list = CadetBranches.heirLine(player);
        let html = '<div style="font-size:12px; max-height:var(--panel-max-h, 560px); overflow-y:auto; min-width:440px;">';
        html += lede('The younger lines of your House, out in the world: minor Houses of your blood.');
        html += bullets([
            'Each keeps its own purse, seat and retinue (🌿 on the map), trading and sitting at court as other Houses do.',
            'Their loyalty drifts with how you treat them: gifts and summons answered raise it; neglect, the generations and hard asks wear it down.',
            'A loyal branch sends tribute and, in war, men it pays itself. An estranged one speaks against you at court and may contest your succession.',
            'If your line runs out of heirs, the head of the nearest branch can take up the mantle.',
        ]);
        if (!list.length) html += card('<div style="color:#9d937c;">No branch of the House has been planted yet.</div>');
        for (const b of list) {
            const v = CadetBranches.view(player, world, b);
            html += branchCard(v);
            html += actsFor(game, v);
        }
        const kids = CadetBranches.candidates(player, world);
        if (kids.length) {
            html += rowList(kids.map(c => ({
                icon: c.gender === 'female' ? '♀️' : '♂️', name: `${esc(c.firstName)}, ${c.age}`,
                desc: `Send them out to found a branch${c.purse > 0 ? ` (their portion: ${Math.round(c.purse)}g)` : ''}`,
                act: 'showCadetFound', args: [c.id], side: '›',
            })), '🌱 Found a Branch');
        }
        html += '</div>';
        game.ui.showCustomPanel('🌿 Cadet Branches', html);
    },

    /** Send a child off: choose the grant (and an estate, if the House holds one). */
    showCadetFound(game, childId) {
        const { player, world } = game;
        const child = (player.children || []).find(c => c.id === childId);
        const why = CadetBranches.whyNot(player, world, childId);
        if (!child || why) {
            game.ui.showNotification('🌿 Cadet Branch', why || 'No such child.', 'warning');
            return;
        }
        const gold = Inheritance.coin(player);
        let html = '<div style="font-size:12px; min-width:400px;">';
        html += lede(`${esc(child.firstName)} would leave the household for good — no longer your heir's rival for the seat, but the head of a House of your blood, with a seat of their own.`);
        html += chips([['💰', 'Their portion', `${Math.round(child.purse || 0)}g`], ['👛', 'Your purse', `${Math.floor(gold)}g`]]);
        const grants = [0, 250, 500, 1000, 2500].filter(n => n === 0 || n <= gold);
        html += rowList(grants.map(n => ({
            icon: n ? '💰' : '🌱', name: n ? `With a grant of ${n} gold` : 'With their portion only',
            desc: n ? 'A larger start, and a warmer heart toward the main line' : 'They make their own way',
            act: 'cadetFound', args: [childId, n, null], side: n ? price(n, true) : '',
        })), 'Send them out');
        const estates = CadetBranches.grantableEstates(player, world);
        if (estates.length) {
            html += rowList(estates.slice(0, 6).map(e => ({
                icon: '🌾', name: `With the estate of ${esc(e.name)}`, desc: 'Its rents become the branch\'s (and their portion with it)',
                act: 'cadetFound', args: [childId, 0, e.id], side: '›',
            })), 'Or grant them land');
        }
        html += rowList([{ icon: '←', name: 'Back', act: 'showCadetBranches' }]);
        html += '</div>';
        game.ui.showCustomPanel('🌱 Found a Cadet Branch', html);
    },

    cadetFound(game, childId, grant = 0, estateId = null) {
        const res = CadetBranches.found(game.player, game.world, childId, { grant, estateId });
        game.ui.showNotification('🌿 A Cadet Branch', res.success ? res.text : res.reason, res.success ? 'success' : 'warning');
        if (game.updateUI) game.updateUI();
        ActionMenu.showCadetBranches(game);
    },

    /** A letter to a branch: gift, gold, men or a summons. */
    cadetAct(game, id, verb, arg = null) {
        const { player, world } = game;
        let res;
        if (verb === 'gift') res = CadetBranches.gift(player, world, id, arg);
        else if (verb === 'gold') res = CadetBranches.askGold(player, world, id);
        else if (verb === 'men') res = CadetBranches.askMen(player, world, id);
        else if (verb === 'summon') res = CadetBranches.summon(player, world, id);
        else return;
        game.ui.showNotification('🌿 Your Kin', res.success ? res.text : res.reason, res.success ? 'success' : 'warning');
        if (game.updateUI) game.updateUI();
        ActionMenu.showCadetBranches(game);
    },
});
