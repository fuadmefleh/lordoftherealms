// ActionMenu — profane crimes (systems/profaneCrimes.js): the crypt of a
// rival House at its seat (shown inside Graveyards & the Dead), and the trade
// in relics — lift one from the temple, forge a fake, sell to the temple here
// (shown inside the Devotions journal). Buttons route through data-am-act →
// profaneAct. The witch accusation lives in the npc dialog
// (ui/npcDialog/witchcraft.js).
import { ActionMenu } from './_ref.js';
import { ProfaneCrimes } from '../../systems/profaneCrimes.js';
import { DevotionPanel } from './devotion.js';
import { InnerMap } from '../../world/innerMap.js';
import { esc, card, rowList, sectionHead } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const pct = (p) => `${Math.round(p * 100)}%`;

function row(o, args) {
    return { ...o, act: 'profaneAct', args };
}

function hereTown(game) {
    const t = game.world.getTile(game.player.q, game.player.r);
    return (t && t.settlement) || null;
}

Object.assign(ActionMenu, {
    /** The crypt of each rival House whose seat this is (a card for the Graveyards panel), or ''. */
    _profaneCryptHtml(game) {
        const { player, world } = game;
        let html = '';
        for (const rival of ProfaneCrimes.rivalsHere(player, world)) {
            const v = ProfaneCrimes.cryptView(player, world, rival);
            const facts = [`${v.bones} of their dead lie here`, `${v.goods} grave goods beside them`];
            if (v.profaned) facts.push(v.profaned.known ? `<span style="color:#e08080;">they know it was you — their feud never falls below ${v.profaned.floor}</span>` : '<span style="color:#e0a080;">broken once; they do not know whose hand</span>');
            html += card(`<div style="${NOTE}">${facts.join(' · ')}</div>`, { icon: '⚰️', title: `The crypt of ${esc(v.house)}`, side: v.head ? `${esc(v.head)} heads the House` : '', tone: v.profaned ? 'warn' : null });
            const rows = [
                row({
                    icon: '🕯️', name: 'Rob the crypt by night', desc: `The grave goods laid with their dead. ${pct(v.seenRob)} you are seen. Your own faith will know.`,
                    off: !v.canRob, why: 'Nothing is left beside their dead to take.', tone: 'bad',
                }, ['rob', v.kingdomId]),
                row({
                    icon: '💀', name: 'Scatter the bones of their fathers', desc: `The deepest insult a House can be done: they never forget it. ${pct(v.seenScatter)} you are seen.`,
                    off: !v.canScatter, why: 'Their dead are already scattered.', tone: 'bad',
                }, ['scatter', v.kingdomId]),
            ];
            if (v.rebury) {
                rows.push(row({
                    icon: '🙏', name: 'Bring their bones back and pay a requiem', desc: `${v.rebury.owed} sets of bones and the priest's fee: the grudge's floor halves`,
                    off: !v.rebury.ok, why: `You need ${v.rebury.owed} sets of bones (you carry ${v.rebury.have}) and ${v.rebury.cost}g.`, side: `${v.rebury.cost}g`, tone: 'gold',
                }, ['rebury', v.kingdomId]));
            }
            html += rowList(rows);
        }
        return html;
    },

    /** Relics: what you carry, and the temple here (a section for the Devotions journal). */
    _relicTradeHtml(game, tile) {
        const { player, world } = game;
        const s = (tile && tile.settlement) || hereTown(game);
        const t = s ? ProfaneCrimes.templeOf(world, s) : null;
        const carried = ProfaneCrimes.relics(player);
        const house = ProfaneCrimes.houseRelics(player);
        if (!t && !carried.length) return '';
        let html = sectionHead('Relics');
        const rows = [];
        if (t) {
            const R = ProfaneCrimes.reliquary(world, s);
            rows.push(row({
                icon: '⚱️', name: `Lift a relic from the temple of ${esc(s.name)}`, desc: `${R.stock} in the reliquary of ${esc(t.faith)}. ${pct(ProfaneCrimes.stealChance(player))} a sexton sees you.`,
                off: R.stock <= 0, why: 'The reliquary stands empty.', tone: 'bad',
            }, ['steal']));
            const F = ProfaneCrimes.config().relics.fake;
            const bones = Math.floor(Number(player.inventory && player.inventory.bones) || 0);
            const ok = bones >= F.bones && (player.gold || 0) >= F.gold;
            rows.push(row({
                icon: '📦', name: 'Forge a relic', desc: `${F.bones} sets of charnel bones in a gilt box. Your hand makes it ${pct(ProfaneCrimes.fakeQuality(player))} convincing.`,
                off: !ok, why: `You need ${F.bones} sets of bones (you carry ${bones}) and ${F.gold}g for the box.`, side: `${F.gold}g`,
            }, ['forge']));
        }
        for (const r of carried) {
            const price = t ? ProfaneCrimes.relicPrice(world, s, r) : 0;
            const home = t && !r.fake && r.faithId === t.faithId;
            rows.push(row({
                icon: r.fake ? '📦' : '📿', name: `${home ? 'Return' : 'Sell'} ${esc(r.name)}`,
                desc: r.fake ? `Your fake (${pct(r.quality || 0)} convincing). Found out, the temple wants it back and more.` : home ? 'Its own priests: a finder\'s thanks, and their regard.' : `Taken from ${esc(r.from || 'somewhere')}. Sold to another god's priests.`,
                off: !t, why: `${esc(r.name)}: a temple would buy it.`, side: t ? `~${home ? Math.round(price / 2) : price}g` : '', tone: 'gold',
            }, ['sell', r.id]));
        }
        if (t) {
            for (const h of house) {
                rows.push(row({
                    icon: h.icon || '📿', name: `Sell ${esc(h.name)}, the House's relic`, desc: 'An heirloom of your House, gone to a temple: it could be bought back, dearly.',
                    side: `~${ProfaneCrimes.relicPrice(world, s, { faithId: null })}g`, tone: 'bad',
                }, ['sell', h.id]));
            }
        }
        html += rowList(rows);
        const st = ProfaneCrimes.state(player);
        const live = st.sold.filter(x => x.exposed == null && x.safe == null);
        if (live.length) html += `<div style="${NOTE}">Fakes still in temples: ${live.map(x => `${esc(x.name)} at ${esc(x.town)}`).join(', ')}.</div>`;
        return html;
    },

    /** Every profane button: op, then its arguments. */
    profaneAct(game, op, ...args) {
        const { player, world } = game;
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        let res;
        switch (op) {
            case 'rob': res = ProfaneCrimes.desecrate(player, world, args[0], 'rob'); break;
            case 'scatter': res = ProfaneCrimes.desecrate(player, world, args[0], 'scatter'); break;
            case 'rebury': res = ProfaneCrimes.rebury(player, world, args[0]); break;
            case 'steal': res = ProfaneCrimes.stealRelic(player, world, s); break;
            case 'forge': res = ProfaneCrimes.forgeRelic(player, world, s); break;
            case 'sell': res = ProfaneCrimes.sellRelic(player, world, s, args[0]); break;
            default: return;
        }
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        const msg = { ok: !!res.success, text: res.success ? res.text : res.reason };
        if (['rob', 'scatter', 'rebury'].includes(op)) {
            if (InnerMap.active && InnerMap.refreshGraves) InnerMap.refreshGraves(world);
            ActionMenu.showGraveyards(game, msg);
            return;
        }
        if (game.ui.showNotification) game.ui.showNotification(res.success ? '📿 Relics' : '📿 Relics', msg.text, res.success ? 'info' : 'warning');
        DevotionPanel.showJournal(game, tile);
    },
});
