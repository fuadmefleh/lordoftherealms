// ActionMenu — 🤝 Friends & Bonds: the friendships beyond romance
// (Relationships → Friends & Bonds). Each bond: who, what kind (friend,
// drinking companion, rival turned friend, mentor, protégé, old family
// friend, sworn kin), its strength, the deeds you share, and what you can do
// together — drink, give a gift, swear kinship, learn from them, ask them to
// vouch for you, repay a loan, take them into your service, or betray them.
// Below: the youths you are raising, the youths of this town you could take
// under your wing, and friends lost. Logic lives in systems/bonds.js.
import { ActionMenu } from './_ref.js';
import { Bonds } from '../../systems/bonds.js';
import { lede, chips, rowList, card, price, bullets, more, esc } from './uiKit.js';

function _bar(value, grievance = 0) {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    const col = pct >= 80 ? '#c79bff' : pct >= 55 ? '#f5c542' : pct >= 30 ? '#9fd89f' : '#a8a08a';
    const g = Math.max(0, Math.min(100, Math.round(grievance)));
    return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:4px 0 6px;position:relative;"><div style="width:${pct}%;height:100%;background:${col};"></div>${g ? `<div title="Grievance" style="position:absolute;right:0;top:0;width:${g}%;height:100%;background:rgba(192,83,58,0.45);"></div>` : ''}</div>`;
}

const WHERE = { party: 'travels with you', court: 'at your court', town: 'here in town' };

Object.assign(ActionMenu, {
    /** The Friends & Bonds panel. message: { html, tone } shown on top. */
    showBondsPanel(game, message = null) {
        const player = game.player;
        const world = game.world;
        if (!player || !world) return;
        const v = Bonds.view(player, world);
        const gold = Number(player.gold) || 0;
        let html = '<div style="font-size:12px; max-height:560px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });

        html += lede(v.bonds.length
            ? 'Friendship is built of things done together — a drink, a fight, a long road, a hand when it was needed — and lost to silence. Friends stand by you; friends can also turn.'
            : 'You have no true friends yet. Anyone you come to know well (a friend in Relationships) becomes one: drink with them, travel with them, stand by them.');
        const sworn = v.bonds.filter(x => x.b.sworn).length;
        html += chips([
            ['🤝', 'Bonds', v.bonds.length],
            sworn ? ['🩸', 'Sworn kin', sworn, 'gold'] : null,
            v.aid.names.length ? ['⚔️', 'Would fight beside you', esc(v.aid.names.join(', ')), 'good'] : null,
            v.proteges.filter(p => !p.pr.grown).length ? ['🌱', 'Protégés', v.proteges.filter(p => !p.pr.grown).length] : null,
        ]);

        for (const x of v.bonds) {
            const b = x.b;
            const a = x.acts;
            let body = '';
            const since = Math.max(0, (world.day || 0) - (b.formed || 0));
            const seen = x.where ? `<span style="color:#9fd89f;">${WHERE[x.where]}</span>` : `in ${esc((x.npc && x.npc.settlementName) || 'parts unknown')} · last seen ${x.apart} day${x.apart === 1 ? '' : 's'} ago`;
            body += `<div style="color:#cfc3a5;">${x.npc ? `${esc(x.npc.occupation || 'townsperson')}, ${x.npc.age}` : ''} · friends ${since} day${since === 1 ? '' : 's'} · ${seen}</div>`;
            body += _bar(b.strength, b.grievance);
            body += chips([
                ['💞', 'Bond', Math.round(b.strength)],
                b.grievance >= 5 ? ['😠', 'Grievance', Math.round(b.grievance), 'bad'] : null,
                b.sworn ? ['🩸', 'Sworn', `${esc(b.sworn.place)}, day ${b.sworn.day}`, 'gold'] : null,
                b.swornTo ? ['🏛️', 'Sworn kin to', esc(b.swornTo)] : null,
                b.mentor && !b.mentor.done ? ['📜', 'Teaching you', `${esc(b.mentor.name)} (to ${b.mentor.level})`, 'good'] : null,
                b.mentor && b.mentor.done ? ['📜', 'Taught you', esc(b.mentor.name)] : null,
                b.protegeSkill ? ['🌱', 'Your protégé', esc(b.protegeSkill)] : null,
                b.owed ? ['💸', 'You owe', `${b.owed.amount}g${b.owed.late ? ' (late)' : ` by day ${b.owed.due}`}`, b.owed.late ? 'bad' : 'warn'] : null,
            ]);
            const hist = (b.history || []).slice(0, 8).map(h => `${esc(h.t)}${h.n > 1 ? ` ×${h.n}` : ''} <span style="color:#8f8a7e;">(day ${h.d})</span>`);
            if (hist.length) body += more(`Shared history (${hist.length})`, bullets(hist));

            const rows = [];
            rows.push(a.drink.ok
                ? { icon: '🍺', name: 'Drink together', desc: 'An evening at the inn', side: price(a.drink.cost, gold >= a.drink.cost), act: 'bondsAct', args: ['drink', b.npcId] }
                : { icon: '🍺', name: 'Drink together', off: true, why: esc(a.drink.reason) });
            rows.push(a.gift.ok
                ? { icon: '🎁', name: 'Give a gift', desc: 'Something chosen for them', side: price(a.gift.cost, gold >= a.gift.cost), act: 'bondsAct', args: ['gift', b.npcId] }
                : { icon: '🎁', name: 'Give a gift', off: true, why: esc(a.gift.reason) });
            if (!b.sworn) {
                rows.push(a.oath.ok
                    ? { icon: '🩸', name: 'Swear kinship', desc: `Before ${esc(a.oath.place)} (${Math.round(a.oath.chance * 100)}% they swear)`, side: price(a.oath.cost, gold >= a.oath.cost), act: 'bondsAct', args: ['oath', b.npcId], tone: 'gold' }
                    : { icon: '🩸', name: 'Swear kinship', off: true, why: esc(a.oath.reason) });
            }
            if (b.kind !== 'protege') {
                rows.push(a.mentor.ok
                    ? { icon: '📜', name: 'Ask them to teach you', desc: `${esc(a.mentor.skill.icon)} ${esc(a.mentor.skill.name)} — they are level ${a.mentor.skill.level}; keep company to learn`, act: 'bondsAct', args: ['mentor', b.npcId] }
                    : { icon: '📜', name: 'Ask them to teach you', off: true, why: esc(a.mentor.reason) });
            }
            rows.push(a.vouch.ok
                ? { icon: '🗣️', name: 'Ask them to vouch for you', desc: 'Their word before their realm', side: `+${a.vouch.gain} rep`, act: 'bondsAct', args: ['vouch', b.npcId] }
                : { icon: '🗣️', name: 'Ask them to vouch for you', off: true, why: esc(a.vouch.reason) });
            if (b.owed) {
                rows.push(a.repay.ok
                    ? { icon: '💸', name: 'Repay what they lent', side: price(a.repay.cost, true), act: 'bondsAct', args: ['repay', b.npcId], tone: b.owed.late ? 'bad' : '' }
                    : { icon: '💸', name: 'Repay what they lent', off: true, why: esc(a.repay.reason) });
            }
            rows.push(a.service.ok
                ? { icon: a.service.court ? '🏰' : '🧭', name: a.service.court ? 'Offer a place at your court' : 'Ask them to take the road with you', desc: 'Into your service, out of friendship', act: 'bondsAct', args: ['service', b.npcId] }
                : { icon: '🏰', name: 'Take into your service', off: true, why: esc(a.service.reason) });
            rows.push({ icon: '🗡️', name: 'Betray them', desc: 'Sell their confidences for an informer\'s fee', side: `${a.betray.fee}g`, act: 'bondsAct', args: ['betrayAsk', b.npcId], tone: 'bad' });
            body += rowList(rows);
            html += card(body, { icon: x.icon, title: esc(b.name), side: esc(x.label), tone: b.sworn ? 'gold' : b.grievance >= 40 ? 'bad' : b.strength >= 55 ? 'good' : '' });
        }

        // The youths you are raising
        const raising = v.proteges.filter(p => !p.pr.grown);
        if (raising.length) {
            html += rowList(raising.map(p => ({
                icon: '🌱', name: esc(p.pr.name), desc: `${p.age != null ? `age ${p.age}, ` : ''}in ${esc(p.pr.town)} · learning ${esc(p.pr.skillName)} · ${p.pr.taught} days taught${p.here ? ' · <span style="color:#9fd89f;">you are here: a lesson today</span>' : ''}`,
                side: p.left ? `${p.left} days to go` : 'nearly grown', tone: p.here ? 'good' : '',
            })), 'Your protégés');
        }
        if (v.candidates.length) {
            const P = Bonds.config().protege;
            const teach = v.teach;
            html += rowList(v.candidates.map(c => ({
                icon: c.gender === 'female' ? '👧' : '👦', name: esc(c.name), desc: `age ${c.age} · you would teach them ${esc(teach ? teach.name : 'what you know')}`,
                side: price(P.cost, gold >= P.cost), act: 'bondsAct', args: ['protege', c.uid],
            })), 'Take a youth of this town under your wing');
        }

        if (v.past.length) {
            const HOW = { died: ['🕯️', 'died'], drifted: ['🍂', 'drifted apart'], betrayed: ['🗡️', 'you betrayed them'], betrayed_you: ['💔', 'betrayed you'], parted: ['·', 'another life'], turned: ['💔', 'turned on you'] };
            html += rowList(v.past.slice(0, 12).map(p => {
                const [ic, word] = HOW[p.ended.how] || ['·', p.ended.how];
                return { icon: ic, name: esc(p.name), desc: `${esc(Bonds.kindDef(p.kind).label)}${p.sworn ? ' · sworn kin' : ''}`, side: `${esc(word)} · day ${p.ended.day}`, tone: p.ended.how === 'betrayed' || p.ended.how === 'betrayed_you' ? 'bad' : '' };
            }), 'Friends lost');
        }
        html += '</div>';
        game.ui.showCustomPanel('🤝 Friends & Bonds', html);
    },

    /** The panel's rows (data-am-act="bondsAct"). */
    bondsAct(game, action, id) {
        const player = game.player;
        const world = game.world;
        if (action === 'betrayAsk') {
            const b = Bonds.get(player, id);
            if (!b) return;
            const fee = Bonds._acts(player, world, b).betray.fee;
            let html = lede(`<span style="color:#e0846a;">🗡️ Betray ${esc(b.name)}?</span> Their confidences are worth about ${fee} gold to the right ears. They will know who told, and so will their family and their town. ${b.sworn ? 'You swore an oath of kinship; breaking it is remembered for generations.' : ''}`);
            html += rowList([
                { icon: '🗡️', name: 'Sell them out', desc: 'A grudge, a rumour, a friend lost', side: `+${fee}g`, act: 'bondsAct', args: ['betray', id], tone: 'bad' },
                { icon: '←', name: 'No — keep faith', act: 'showBondsPanel' },
            ]);
            game.ui.showCustomPanel('🤝 Friends & Bonds', html);
            return;
        }
        const fns = {
            drink: Bonds.drinkWith, gift: Bonds.giveGift, oath: Bonds.swearOath, mentor: Bonds.askMentor, vouch: Bonds.askVouch,
            repay: Bonds.repay, service: Bonds.takeIntoService, betray: Bonds.betray, protege: Bonds.takeProtege,
        };
        const fn = fns[action];
        if (!fn) return;
        const res = fn(player, world, id);
        if (!res || !res.success) {
            game.ui.showNotification('🤝 Friends & Bonds', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        const tone = action === 'betray' || res.sworn === false ? 'bad' : 'good';
        ActionMenu.showBondsPanel(game, { html: esc(res.text || 'Done.'), tone });
    },
});
