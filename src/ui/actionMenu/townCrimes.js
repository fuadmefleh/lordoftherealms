// ActionMenu — Foul Deeds (systems/townCrimes.js): acts against the town
// itself, from its Back Rooms. Poison its well, cry a false plague, burn its
// granary; hoard its grain while it goes hungry and sell it back dear, or to
// the crown at a premium. Each row says what it takes and the odds of being
// seen; a greyed row says why not. The town's hunt for the culprit, your
// lofts and your deeds are listed below. Buttons route through
// data-am-act → townCrimesAct.
import { ActionMenu } from './_ref.js';
import { TownCrimes } from '../../systems/townCrimes.js';
import { esc, lede, chips, card, rowList, sectionHead, purse, price } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const ACT_NAME = { well: 'poisoned the well', granary: 'burnt the granary', scare: 'cried a false plague' };

function hereTown(game) {
    const t = game.world.getTile(game.player.q, game.player.r);
    return (t && t.settlement) || null;
}

const pct = p => `${Math.round(p * 100)}%`;

function oddsNote(o) {
    return `Seen: ${pct(o.seen)}; of those who see, ${pct(o.named)} know your face`;
}

function row(o, args) {
    return { ...o, act: 'townCrimesAct', args };
}

Object.assign(ActionMenu, {
    showTownCrimes(game, message = null) {
        const { player, world } = game;
        const s = hereTown(game);
        if (!s) return;
        const v = TownCrimes.view(player, world, s);
        let html = '<div style="font-size:12px;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'bad' });
        html += lede(`What could be done to ${esc(s.name)} itself, by someone who wished it ill. Every deed is remembered by the town, whether or not it ever learns your name.`);
        html += chips([
            purse(player.gold),
            ['🌾', 'Granary', v.reserveDays == null ? 'none' : `${v.reserveDays} days`, v.reserveDays != null && v.reserveDays < 4 ? 'warn' : ''],
            ['🛒', 'Grain', `${v.grainStock} at ${v.grainPrice}g`],
            v.hungry ? { icon: '🥀', label: 'Hungry', value: esc(v.hungry), cls: 'warn' } : null,
            v.lean ? ['❄️', 'Lean weeks', ''] : null,
        ]);

        // The deeds
        const rows = [];
        const wellDesc = v.well.ok ? `Down it goes: ${esc(v.well.means.label)}. The flux takes the town for days.` : '';
        rows.push(row({
            icon: '🚰', name: 'Poison the well', desc: wellDesc, off: !v.well.ok, why: esc(v.well.why || ''),
            note: v.wellFoul ? `Foul now: ${v.wellFoul.struck || 0} sick${v.wellFoul.dead ? `, ${v.wellFoul.dead} dead` : ''}` : oddsNote(v.odds.well), tone: 'bad',
        }, ['well']));
        const S = TownCrimes.config().scare;
        rows.push(row({
            icon: '🐀', name: 'Cry a false plague',
            desc: `Pay the criers and beggars: traders keep away for a month, some folk flee, and the stalls go cheap. It may be found out.`,
            off: !v.scare.ok, why: esc(v.scare.why || ''), side: price(S.cost, player.gold >= S.cost),
            note: v.scareOn ? `The panic runs till day ${v.scareOn.until}${v.scareOn.fled ? `; ${v.scareOn.fled} have fled` : ''}` : oddsNote(v.odds.scare),
        }, ['scare']));
        rows.push(row({
            icon: '🔥', name: 'Burn the granary',
            desc: v.granary.ok ? `With ${esc(v.granary.tinder.label)}. ${v.lean ? 'In the lean weeks nearly all of it will go.' : 'More than half the store will go; worse in the lean weeks.'}` : '',
            off: !v.granary.ok, why: esc(v.granary.why || ''), note: oddsNote(v.odds.granary), tone: 'bad',
        }, ['granary']));
        html += rowList(rows, '🕯️ The deeds');

        // Grain
        const grain = [];
        const H = TownCrimes.config().hoard;
        for (const n of [20, 60]) {
            grain.push(row({
                icon: '🌾', name: `Buy ${n} measures of grain to hoard`, desc: `Off the market, into a rented loft (${H.loftFee}g a week). Legal — unless the crown forbids engrossing.`,
                off: !v.hoard.ok, why: esc(v.hoard.why || ''), side: price(v.grainPrice * n, player.gold >= v.grainPrice * n),
            }, ['hoard', n]));
        }
        if (v.loft && v.loft.grain >= 1) {
            const avg = v.loft.grain > 0 ? v.loft.paid / v.loft.grain : 0;
            const dear = v.hungry && avg > 0 && v.grainPrice >= avg * H.grudgeRatio;
            grain.push(row({
                icon: '💰', name: `Sell your ${Math.floor(v.loft.grain)} measures back to the market`, desc: `At ${v.grainPrice}g a measure now (they cost you about ${Math.round(avg)}g); the price falls as it fills.`,
                side: price(v.grainPrice * Math.floor(v.loft.grain)), tone: dear ? 'warn' : 'gold',
                note: dear ? 'A famine price: the town will remember whose loft it came from.' : null,
            }, ['sell', Math.floor(v.loft.grain)]));
        }
        const held = Math.floor(Number(player.inventory && player.inventory.grain) || 0) + Math.floor((v.loft && v.loft.grain) || 0);
        if (v.crown > 0) {
            grain.push(row({
                icon: '👑', name: 'Sell grain to the crown', desc: `The crown pays ${Math.round(v.crown * 100 - 100)}% over the market for bread for ${esc(s.name)}; the grain goes to the market cross.`,
                off: !(held > 0), why: 'You have no grain, in your packs or a loft here.', side: held > 0 ? price(Math.round(v.grainPrice * v.crown) * held) : '', tone: 'gold',
            }, ['crown', held]));
        }
        html += rowList(grain, '🌾 Grain in hungry times');
        if (v.banned) html += `<div style="${NOTE}">📜 The crown has forbidden engrossing in this realm: lofts are thrown open.</div>`;

        // The hunt, your lofts, your deeds
        if (v.hunt) {
            const h = v.hunt;
            html += card(`<div style="${NOTE}">Whoever ${ACT_NAME[h.act] || 'did it'} is hunted till day ${h.until}. ${h.named ? '<b>You have been named.</b> The watch will take you if you stay.' : h.seen ? `${esc(h.witness || 'Someone')} saw a figure, and may yet put a name to it.` : 'Nobody saw anything — yet.'}</div>`, { icon: '👁️', title: 'The town\'s hunt', tone: h.named ? 'bad' : 'warn' });
        }
        if (v.lofts.length) {
            html += sectionHead('🏚️ Your grain lofts');
            html += rowList(v.lofts.map(l => ({ icon: '🌾', name: esc(l.town), desc: `${Math.floor(l.grain)} measures, paid ${l.paid}g`, side: '' })));
        }
        if (v.deeds.length) {
            html += sectionHead('🗒️ What you have done');
            html += rowList(v.deeds.map(d => ({ icon: d.caught ? '⛓️' : '🤫', name: `${ACT_NAME[d.act] || d.act} at ${esc(d.town)}`, desc: `Day ${d.d}${d.caught ? ' — named for it' : d.seen ? ' — someone saw' : ' — unseen'}`, tone: d.caught ? 'bad' : null })));
        }
        html += '</div>';
        game.ui.showCustomPanel('🐀 Foul Deeds', html);
    },

    /** Every button: op, then its own arguments. */
    townCrimesAct(game, op, arg = null) {
        const { player, world } = game;
        const s = hereTown(game);
        if (!s) return;
        let res;
        switch (op) {
            case 'well': res = TownCrimes.poisonWell(player, world, s); break;
            case 'scare': res = TownCrimes.spreadScare(player, world, s); break;
            case 'granary': res = TownCrimes.burnGranary(player, world, s); break;
            case 'hoard': res = TownCrimes.hoardGrain(player, world, s, Number(arg) || 20); break;
            case 'sell': res = TownCrimes.sellHoard(player, world, s, Number(arg) || 1); break;
            case 'crown': res = TownCrimes.sellToCrown(player, world, s, Number(arg) || 1); break;
            default: return;
        }
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showTownCrimes(game, { ok: !!res.success, text: res.success ? res.text : res.reason });
    },
});
