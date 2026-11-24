// ActionMenu — the fate of prisoners (player/prisonerFates.js).
//
//   'captives' scene   after a won battle: the oath-breakers found among the
//                      captives, then the men of rank (ransom / dungeon /
//                      share), then the men (service, oath, release, cut them
//                      down, blind, impale; outlaws: hang...). Opened from the
//                      battle report (showCaptivesScene) or the panel below.
//                      Walked away from: the captains settle it at day's end.
//   showCaptives       "🛡️ Prisoners of War": the column awaiting your word,
//                      ransom talks (price, counter-offer, press, sell to a
//                      crown hostile to his), your men in their hands (buy them
//                      back), turncoats in your army, oaths sworn and broken,
//                      your stakes rotting, the record. Reached from Intrigue &
//                      the Law ('captives') and The Dungeon.
//   captivesAct        a row of that panel.
import { ActionMenu } from './_ref.js';
import { registerScene } from './choiceScenes.js';
import { PrisonerFates } from '../../player/prisonerFates.js';
import { Interrogation } from '../../systems/interrogation.js';
import { WarStakes } from '../../world/warStakes.js';
import { Utils } from '../../core/utils.js';
import { lede, chips, card, rowList, price, esc } from './uiKit.js';

const STAGE_WORD = { asked: 'Their answer is on the road', agreed: 'Agreed: the coin is coming', offered: 'They offer less', refused: 'They will not pay', broken: 'They defaulted' };

registerScene('captives', {
    view(game) {
        return PrisonerFates.view(game.player, game.world);
    },
    act(game, state, choice) {
        const out = PrisonerFates.act(game.player, game.world, state, choice);
        if (out.invalid) return out;
        if (out.state) return { state: out.state };
        return { notification: out.notification, log: out.log || [] };
    },
    abandon() {
        // (left open: the column waits, and the captains settle it at the day's end)
        return null;
    },
});

function _talkRows(game) {
    const { player, world } = game;
    const rows = [];
    for (const w of Interrogation.state(player).pows) {
        if (!w || w.condemned) continue;
        const t = w.talks;
        const head = `${esc(w.name)} of ${esc(w.realm)}`;
        if (!t || ['refused', 'broken'].includes(t.stage)) {
            const fair = PrisonerFates.askFor(world, w, 'fair');
            rows.push({ icon: '💰', name: `Ask a fair ransom for ${head}`, desc: `${t ? `${STAGE_WORD[t.stage]} before. ` : ''}A herald rides to their crown`, side: price(fair, true), act: 'captivesAct', args: ['talks', w.id, 'fair'] });
            rows.push({ icon: '💰', name: `Ask a high ransom for ${head}`, desc: 'More than they would like: expect a counter-offer', side: price(PrisonerFates.askFor(world, w, 'high'), true), act: 'captivesAct', args: ['talks', w.id, 'high'] });
            rows.push({ icon: '💰', name: `Ask a ruinous ransom for ${head}`, desc: 'A price to bleed their treasury, or none at all', side: price(PrisonerFates.askFor(world, w, 'ruinous'), true), act: 'captivesAct', args: ['talks', w.id, 'ruinous'], tone: 'warn' });
            for (const b of PrisonerFates.buyers(player, world, w).slice(0, 2)) {
                rows.push({ icon: '⚖️', name: `Sell ${esc(w.name)} to ${esc(b.realm)}`, desc: `${b.atWar ? 'At war with his realm' : 'No friend of his realm'}: out of its treasury. ${esc(w.realm)} will not forget it`, side: price(b.price, true), act: 'captivesAct', args: ['sell', w.id, b.kingdomId], tone: 'bad' });
            }
            continue;
        }
        if (t.stage === 'offered') {
            rows.push({ icon: '🤝', name: `Take ${esc(w.realm)}'s offer for ${esc(w.name)}`, desc: `You asked ${Utils.formatGold(t.ask)}; they will pay this. Answer by day ${t.due}`, side: price(t.offer, true), act: 'captivesAct', args: ['accept', w.id], tone: 'gold' });
            rows.push({ icon: '📜', name: 'Press for more', desc: `Round ${(t.rounds || 0) + 1}: ask a little less than before, and try their patience`, act: 'captivesAct', args: ['press', w.id] });
            continue;
        }
        rows.push({ icon: '⏳', name: head, desc: `${STAGE_WORD[t.stage] || t.stage}${t.stage === 'asked' ? ` (by day ${t.replyDay})` : ''}${t.paid ? ` · ${Utils.formatGold(t.paid)} paid` : ''}`, side: price(t.ask, true) });
    }
    return rows;
}

Object.assign(ActionMenu, {
    /** The column awaiting your word, as a choice scene. */
    showCaptivesScene(game) {
        if (!PrisonerFates.pending(game.player)) { ActionMenu.showCaptives(game); return; }
        ActionMenu.showScene(game, 'captives', { log: [] });
    },

    /** Prisoners of War: everything the fate of prisoners keeps. */
    showCaptives(game, flash = '') {
        const { player, world } = game;
        const st = PrisonerFates.state(player);
        const day = (world && world.day) || 0;
        let html = lede('What you do with the men who yield to you is remembered: by their realm, by every court, by the faiths, by your own lords, and by the next army that faces you.');
        html += chips([
            ['⛓️', 'Columns taken', st.stats.columns],
            ['💰', 'Ransoms', Utils.formatGold(st.stats.ransomGold)],
            ['🕊️', 'Sworn', st.stats.sworn],
            ['⚔️', 'Cut down', st.stats.slain + st.stats.hanged],
            ['👁️', 'Blinded', st.stats.blinded],
            ['☠️', 'Impaled', st.stats.impaled],
        ]);
        if (flash) html += card(esc(flash), { icon: '🛡️', title: 'Prisoners of war' });
        const col = st.pending;
        if (col) {
            html += rowList([{ icon: '⛓️', name: `Decide the fate of ${col.men} ${col.outlaw ? `of the ${esc(col.name)}` : `men of ${esc(col.realm)}`}`, desc: 'They kneel and wait for your word', side: '›', act: 'showCaptivesScene', tone: 'gold' }], '⛓️ Awaiting your word');
        }
        const talks = _talkRows(game);
        if (talks.length) html += rowList(talks, '💰 Men of rank in your dungeon');
        const held = st.held.filter(h => h.fate === 'ransom' || h.fate === 'release');
        if (held.length) {
            html += rowList(held.map(h => h.fate === 'ransom'
                ? { icon: '⛓️', name: `Buy back ${h.units} compan${h.units === 1 ? 'y' : 'ies'} from ${esc(h.realm)}`, desc: `Out of your purse into their treasury, by day ${h.due}, or they serve ${esc(h.realm)}`, side: price(h.ask, (player.gold || 0) >= h.ask), off: (player.gold || 0) < h.ask, why: `You need ${Utils.formatGold(h.ask)} gold.`, act: 'captivesAct', args: ['buyBack', h.id], tone: 'gold' }
                : { icon: '🕊️', name: `${h.units} compan${h.units === 1 ? 'y' : 'ies'} held by ${esc(h.realm)}`, desc: `Coming home, unransomed, by day ${h.returnDay}` }), '🛡️ Your men in their hands');
        }
        const turned = PrisonerFates.turncoats(player);
        if (turned.length) {
            html += rowList(turned.map(u => ({ icon: '🛡️', name: esc(u.name), desc: `${u.turncoat.outlaw ? 'Outlaws' : `Men of ${esc(u.turncoat.realm)}`} in your pay since day ${u.turncoat.day}`, side: `loyalty ${Math.round(u.turncoat.loyalty)}`, tone: u.turncoat.loyalty < 35 ? 'bad' : '' })), '🏃 Turncoats in your army');
        }
        if (st.oaths.length) {
            html += rowList(st.oaths.slice(0, 8).map(o => ({ icon: o.broken ? '💔' : '🕊️', name: `${o.men} men of ${esc(o.realm)}`, desc: `Sworn on day ${o.day}${o.broken ? `; ${o.broken} broke it and came against you` : ''}`, side: o.until > day ? `bound till day ${o.until}` : 'free of it', tone: o.broken ? 'bad' : 'good' })), '🕊️ Oaths sworn to you');
        }
        const stakes = WarStakes.stakes(world).filter(s => s.byPlayer);
        if (stakes.length) {
            html += rowList(stakes.map(s => {
                const f = WarStakes.fresh(s, day);
                return { icon: '☠️', name: `${s.men} ${s.realm === 'outlaws' ? 'outlaws' : `men of ${esc(s.realm)}`}`, desc: `On stakes along ${esc(s.place || 'the road')} since day ${s.day}`, side: f > 0.6 ? 'fresh' : f > 0 ? 'rotting' : 'bones', tone: f > 0 ? 'bad' : '' };
            }), '☠️ Your stakes');
        }
        const cols = WarStakes.columns(world).filter(c => c.byPlayer);
        if (cols.length) html += rowList(cols.map(c => ({ icon: '👁️', name: `${c.men} blinded men of ${esc(c.realm)}`, desc: `Walking home, led by ${esc(c.leader || 'the one-eyed')}`, side: 'on the road' })), '👁️ On the road home');
        if (st.history.length) html += rowList(st.history.slice(0, 8).map(h => ({ icon: '·', name: esc(h.text), desc: `day ${h.day}` })), '📜 The record');
        if (!col && !talks.length && !held.length && !turned.length && !st.oaths.length && !stakes.length && !st.history.length) {
            html += card('No one has yielded to you yet. Beat a band of men in the field and their fate will be yours to decide.', { icon: '🛡️' });
        }
        game.ui.showCustomPanel('🛡️ Prisoners of War', html);
    },

    /** A row of Prisoners of War. */
    captivesAct(game, what, a, b) {
        const { player, world } = game;
        let r;
        if (what === 'talks') r = PrisonerFates.openTalks(player, world, a, b);
        else if (what === 'accept') r = PrisonerFates.acceptOffer(player, world, a);
        else if (what === 'press') r = PrisonerFates.press(player, world, a);
        else if (what === 'sell') r = PrisonerFates.sell(player, world, a, b);
        else if (what === 'buyBack') r = PrisonerFates.buyBack(player, world, a);
        else r = { success: false, reason: 'No such thing.' };
        if (!r || !r.success) { game.ui.showNotification('🛡️ Prisoners of War', (r && r.reason) || 'It cannot be done.', 'error'); return; }
        game.ui.updateStats(player, world);
        ActionMenu.showCaptives(game, r.text);
    },
});
