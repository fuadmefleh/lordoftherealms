// ActionMenu — dark counsel (systems/kinCrimes.js): what a ruler can do to
// their own blood. Reached from a child's page (Dynasty → a child → Dark
// counsel) and the House panel. A hunting accident or poison for an heir or
// a sibling, the cloister, a declaration of unfitness, disinheritance into a
// bitter cadet branch, a match forced for a bride-price or an alliance — and
// the household's suspicion of each deed, which may yet come out.
import { ActionMenu } from './_ref.js';
import { KinCrimes } from '../../systems/kinCrimes.js';
import { Raising } from '../../systems/raising.js';
import { Heirs } from '../../systems/heirs.js';
import { Inheritance } from '../../systems/inheritance.js';
import { Names } from '../../core/names.js';
import { lede, chips, card, rowList, price, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const KIND = { murder: '🗡️ Murder', attempt: '🗡️ An attempt', unfit: '💊 Declared unfit', cloister: '⛪ The cloister' };

function deedRows(player) {
    return KinCrimes.deeds(player).slice(0, 10).map(d => ({
        icon: d.exposed ? '☠️' : '🤫', name: `${KIND[d.kind] || d.kind}: ${esc(d.target)}`,
        desc: `Day ${d.day}${d.ruler ? `, by ${esc(d.ruler)}` : ''}${d.suspects.length ? ` · suspected by ${d.suspects.map(esc).join(', ')}` : ''}`,
        side: d.exposed ? 'Known' : `${esc(d.label)}${d.lifted ? '' : ` (${d.suspicion})`}`,
        tone: d.exposed ? 'bad' : d.suspicion >= 35 ? 'warn' : '',
    }));
}

function stainChip(player) {
    const st = KinCrimes.state(player);
    const s = Math.round((st && st.stain) || 0);
    return { icon: '☠️', label: 'Stain', value: s, cls: s >= 20 ? 'bad' : '' };
}

Object.assign(ActionMenu, {
    /** Dark counsel: for one child of the House, or (no id) the whole family. */
    showKinCrimes(game, childId = null) {
        const { player, world } = game;
        const child = childId ? (player.children || []).find(c => c && c.id === childId && c.isAlive !== false) : null;
        let html = '<div style="font-size:12px; max-height:var(--panel-max-h, 560px); overflow-y:auto; min-width:420px;">';
        if (!child) {
            html += lede('Counsel no one should hear. Households have eyes, and the realm a long memory: a deed found out stains the House for generations.');
            html += chips([{ icon: '⭐', label: 'Prestige', value: Math.round((player.house && player.house.prestige) || 0), cls: 'gold' }, stainChip(player)]);
            const kin = (player.children || []).filter(c => c && c.isAlive !== false);
            html += rowList(kin.map(c => {
                const v = KinCrimes.viewChild(player, c);
                return {
                    icon: c.isSibling ? '👥' : (c.gender === 'female' ? '👧' : '👦'), name: `${esc(c.firstName)}, ${c.age}`,
                    desc: `${c.isSibling ? 'Your sibling' : player.heir === c.id ? 'Your heir' : 'Your child'}${v.unfit ? ' · declared unfit' : ''}${v.forced ? ' · wed against their will' : ''}${v.grievance ? ` · grievance ${v.grievance}` : ''}`,
                    act: 'showKinCrimes', args: [c.id], side: '›',
                };
            }), '🌑 Your Blood');
            if (!kin.length) html += card('<div style="color:#9d937c;">No kin of the House left at home.</div>');
            const deeds = deedRows(player);
            if (deeds.length) html += rowList(deeds, '🤫 What Was Done');
            const st = KinCrimes.state(player);
            const cl = (st && st.cloistered) || [];
            if (cl.length) {
                html += rowList(cl.slice(-6).reverse().map(r => ({
                    icon: '⛪', name: esc(r.name), desc: `At the abbey of ${esc(r.place)} since day ${r.day}${r.bitter ? ', unwilling' : ', by vocation'}`,
                    side: r.died != null ? 'Dead' : r.fled != null ? 'Fled' : `Age ${r.age}`, tone: r.fled != null ? 'bad' : '',
                })), '⛪ Given to the Church');
            }
            html += '</div>';
            game.ui.showCustomPanel('🌑 Dark Counsel', html);
            return;
        }

        const v = KinCrimes.viewChild(player, child);
        const bond = Math.round(Raising.bond(child));
        const who = child.isSibling ? 'your sibling' : player.heir === child.id ? 'your heir' : 'your child';
        html += lede(`What could be done about ${esc(child.firstName)}, ${who}. Whatever is chosen here, someone may have seen.`);
        html += chips([
            { icon: '❤️', label: 'Bond', value: `${bond}${v.grievance ? ` (at most ${100 - v.grievance})` : ''}` },
            v.grievance ? { icon: '💢', label: 'Grievance', value: v.grievance, cls: 'bad' } : null,
            stainChip(player),
            { icon: '💰', label: 'Their portion', value: `${Math.round(child.purse || 0)}g` },
        ]);
        const why = (act, arg) => KinCrimes.whyNot(player, world, child.id, act, arg);
        const M = KinCrimes.config().murder.methods;
        const deadly = Object.entries(M).map(([id, m]) => ({
            icon: m.icon || '🗡️', name: esc(m.name || id),
            desc: `${esc(m.desc || '')}${child.isSibling ? ' — their portion comes to you' : ''}. Suspicion starts near ${m.suspicion}; it may fail.`,
            act: 'kinCrimeAct', args: [child.id, 'murder', id], tone: 'bad', off: !!why('murder', id), why: why('murder', id) || '',
        }));
        if (child.isSibling) {
            html += rowList(deadly, '🗡️ For the Inheritance');
        } else {
            const C = KinCrimes.config();
            const gold = Inheritance.coin(player);
            html += rowList([
                ...deadly,
                {
                    icon: '⛪', name: 'Give them to the Church', desc: `Out of the household and the line for good; an endowment to the abbey, and their portion with them. Unwilling, they will not forget.`,
                    act: 'kinCrimeAct', args: [child.id, 'cloister'], side: price(C.cloister.endowment, gold >= C.cloister.endowment), off: !!why('cloister'), why: why('cloister') || '',
                },
                v.unfit
                    ? { icon: '💊', name: 'Declare them fit after all', desc: 'They may inherit again; a little Prestige for the physicians\' error. The grievance stays.', act: 'kinCrimeAct', args: [child.id, 'restore'], off: !!why('restore'), why: why('restore') || '' }
                    : { icon: '💊', name: 'Declare them sickly and unfit', desc: 'They can never take the seat. A hale child makes the court doubt it.', act: 'kinCrimeAct', args: [child.id, 'unfit'], tone: 'warn', off: !!why('unfit'), why: why('unfit') || '' },
            ], '🌑 Remove from the Succession');
            const dis = why('disinherit');
            html += rowList([
                { icon: '🚪', name: 'Disinherit and cast out', desc: 'They found a cadet branch with their portion — estranged, and holding a grudge for generations', act: 'kinCrimeAct', args: [child.id, 'disinherit', false], tone: 'warn', off: !!dis, why: dis || '' },
                { icon: '💰', name: 'Cast out with nothing', desc: `Seize their portion (${Math.round(child.purse || 0)}g) first: a deeper grudge`, act: 'kinCrimeAct', args: [child.id, 'disinherit', true], tone: 'bad', off: !!dis, why: dis || '' },
            ], '🚪 Cast Out');
            const fm = why('forced');
            html += rowList([{ icon: '💍', name: 'Wed them against their will', desc: 'For a bride-price, or an alliance. They never forgive it; if they inherit, it shapes their rule.', act: 'showKinMatch', args: [child.id], side: '›', off: !!fm, why: fm || '' }], '💍 A Match Forced');
        }
        html += rowList([
            { icon: '←', name: `Back to ${esc(child.firstName)}`, act: 'showChildPanel', args: [child.id] },
            { icon: '🌑', name: 'All dark counsel', act: 'showKinCrimes', side: '›' },
        ]);
        html += '</div>';
        game.ui.showCustomPanel(`🌑 ${child.firstName}`, html);
    },

    /** Choose the realm a child is wed into against their will. */
    showKinMatch(game, childId) {
        const { player, world } = game;
        const child = (player.children || []).find(c => c && c.id === childId);
        const why = KinCrimes.whyNot(player, world, childId, 'forced');
        if (!child || why) {
            game.ui.showNotification('💍 A Forced Match', why || 'No such child.', 'warning');
            return;
        }
        const F = KinCrimes.config().forced;
        let html = '<div style="font-size:12px; max-height:var(--panel-max-h, 560px); overflow-y:auto; min-width:420px;">';
        html += lede(`${esc(child.firstName)} will be wed where you choose, to whom you choose. A realm with coin pays a bride-price out of its treasury; any realm will take the bond of blood.`);
        const realms = Heirs.kingdoms(player, world).slice(0, 10);
        html += rowList(realms.map(k => {
            const p = KinCrimes.bridePrice(player, world, k);
            return {
                icon: '💰', name: `Sell the match to ${esc(Names.realm(k.name))}`, desc: `A bride-price from its treasury, +${F.priceReputation} standing`,
                act: 'kinCrimeAct', args: [childId, 'forced', k.id, 'price'], side: p ? price(p, true) : '', off: !p, why: `${esc(Names.realm(k.name, true))} has no coin to spare.`, tone: 'warn',
            };
        }), '💰 For a Bride-Price');
        html += rowList(realms.map(k => ({
            icon: '🤝', name: `Bind ${esc(Names.realm(k.name))} by blood`, desc: `No dowry asked: +${F.allianceReputation} standing and a little Prestige`,
            act: 'kinCrimeAct', args: [childId, 'forced', k.id, 'alliance'], side: '›',
        })), '🤝 For an Alliance');
        if (!realms.length) html += card('<div style="color:#9d937c;">No realm to wed into.</div>');
        html += rowList([{ icon: '←', name: 'Back', act: 'showKinCrimes', args: [childId] }]);
        html += '</div>';
        game.ui.showCustomPanel(`💍 ${child.firstName}`, html);
    },

    /** Carry out a deed of the dark counsel. */
    kinCrimeAct(game, childId, verb, arg = null, arg2 = null) {
        const { player, world } = game;
        const child = (player.children || []).find(c => c && c.id === childId);
        const name = child ? child.firstName : 'They';
        let res;
        if (verb === 'murder') res = KinCrimes.murder(player, world, childId, arg);
        else if (verb === 'cloister') res = KinCrimes.cloister(player, world, childId);
        else if (verb === 'unfit') res = KinCrimes.declareUnfit(player, world, childId);
        else if (verb === 'restore') res = KinCrimes.restoreFit(player, world, childId);
        else if (verb === 'disinherit') res = KinCrimes.disinherit(player, world, childId, { seize: !!arg });
        else if (verb === 'forced') res = KinCrimes.forceMatch(player, world, childId, arg, arg2 || 'price');
        else return;
        if (!res.success) {
            game.ui.showNotification('🌑 Dark Counsel', res.reason, 'warning');
            return;
        }
        let text = res.text;
        if (res.witnesses && res.witnesses.length) text += ` ${res.witnesses.join(' and ')} ${res.witnesses.length === 1 ? 'looks' : 'look'} at you strangely since.`;
        if (res.portion) text += ` Their portion of ${res.portion}g comes to you.`;
        if (res.price) text += ` ${res.price}g is paid into your purse.`;
        const type = verb === 'murder' ? (res.died ? 'warning' : 'error') : 'info';
        game.ui.showNotification(verb === 'murder' ? (res.died ? '🕯️ A Death in the Family' : `🗡️ ${name} Survives`) : '🌑 Dark Counsel', text, type);
        if (game.updateUI) game.updateUI();
        const still = (player.children || []).some(c => c && c.id === childId && c.isAlive !== false);
        ActionMenu.showKinCrimes(game, still ? childId : null);
    },
});
