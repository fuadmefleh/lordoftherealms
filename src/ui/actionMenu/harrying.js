// ActionMenu — harrying the countryside (player/harrying.js, systems/harrying.js):
// at a village or town of a realm you are at war with, with soldiers at your
// back — torch it, fire its crops and its mill, drive off its herds, scatter or
// slaughter its peasants. Opened from the town's action list ('harry').
// Rows route through data-am-act="harryAct" with the deed's id.
import { ActionMenu } from './_ref.js';
import { PlayerHarrying } from '../../player/harrying.js';
import { Harrying } from '../../systems/harrying.js';
import { Atrocities } from '../../systems/atrocities.js';
import { lede, chips, card, rowList, esc } from './uiKit.js';

function _realmName(world, kid) {
    const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
    return k ? k.name : 'the realm';
}

function _panel(game, flash = null) {
    const { player, world } = game;
    const tile = world.getTile(player.q, player.r);
    const s = tile && tile.settlement;
    if (!s) return lede('There is no village or town here to harry.');
    const day = world.day || 0;
    const inf = Atrocities.infamy(player);
    const k = world.getKingdom ? world.getKingdom(s.kingdom) : null;
    let html = lede(`The fields and farms of ${esc(s.name)} feed ${esc(_realmName(world, s.kingdom))}: its bread, its rents, its taxes. Burn them and the realm goes hungry, its lords go poor — and its army must come out to stop you.`);
    const levy = PlayerHarrying.resistance(player, world, s);
    const hosts = Harrying.state(world).hosts.filter(h => String(h.kid) === String(s.kingdom));
    html += chips([
        { icon: '👥', label: 'People', value: Math.round(s.population || 0) },
        { icon: '🛡️', label: 'Levy', value: levy || 'none', cls: levy ? 'bad' : '' },
        { icon: '⚔️', label: 'Your name', value: esc(inf.label || 'unremarked') },
        { icon: '⌛', label: 'AP', value: player.actionPoints || 0 },
    ]);
    if (flash) html += card(esc(flash.text), { icon: flash.icon || '🔥', title: flash.title || 'Done', tone: flash.tone || '' });
    const h = s.harried;
    if (h && Harrying.active(s, day)) {
        const bits = [];
        if (h.burn && h.burn.left > 0) bits.push(`${Math.round(h.burn.left * 100)}% of it still in ashes`);
        if (h.fields) bits.push('its fields burnt');
        if (h.mill) bits.push('its mill a shell');
        if (h.herds) bits.push('its pens near empty');
        if (h.dead) bits.push(`${h.dead} dead`);
        if (h.fled) bits.push(`${h.fled} fled`);
        if (bits.length) html += card(`${esc(s.name)} has been harried${h.by ? ` by ${esc(h.by)}` : ''}: ${bits.join(', ')}.`, { icon: '🔥', title: 'Scarred', tone: 'warn' });
    }
    if (hosts.length) html += card(`${esc(hosts[0].name)} (${hosts[0].strength} men) is out after you. It follows while you are in its land, for ${Math.max(0, hosts[0].until - day)} more day(s).`, { icon: '🚩', title: 'Pursued', tone: 'bad' });
    else if (k && (k.military || 0) >= Harrying.config().pursuit.minMilitary) html += card(`${esc(k.name)} has men to spare (${Math.round(k.military)}): harry its land and it will send a host after you.`, { icon: '🚩', title: 'The realm will answer' });
    const opts = PlayerHarrying.options(player, world, tile);
    if (levy) html += card(`The first harrying here today meets the village levy (${levy} strength). Beaten off, the deed is not done.`, { icon: '🛡️' });
    html += rowList(opts.map(o => ({
        icon: o.icon, name: esc(o.name), desc: esc(o.desc), why: esc(o.why), off: !o.ok,
        side: `${o.ap} AP`, tone: o.ok ? (o.id === 'slaughter' ? 'bad' : 'warn') : '', act: 'harryAct', args: [o.id],
    })), 'Orders');
    html += card('Each deed costs you karma and the realm\'s regard; its lord remembers, and the towns talk. Putting the peasants to the sword is an atrocity every realm will hear of.', { icon: '⚖️' });
    return html;
}

Object.assign(ActionMenu, {
    /** The harrying panel for the town where the player stands. */
    showHarrying(game, flash = null) {
        game.ui.showCustomPanel('🔥 Harry the Countryside', _panel(game, flash));
    },

    /** A row of the panel: the deed's id (PlayerHarrying.act). */
    harryAct(game, id) {
        const r = PlayerHarrying.act(game.player, game.world, id);
        if (!r || r.success === false) {
            game.ui.showNotification('🔥 Harrying', (r && r.reason) || 'That cannot be done.', 'error');
            return;
        }
        let text = r.message || '';
        if (r.battle && r.battle.casualties > 0) text += ` You lost ${r.battle.casualties} soldier(s) to the levy.`;
        const flash = r.resisted
            ? { icon: '🛡️', title: 'Driven Off', text, tone: 'bad' }
            : { icon: PlayerHarrying.ROWS[id] ? PlayerHarrying.ROWS[id].icon : '🔥', title: 'Done', text, tone: id === 'slaughter' ? 'bad' : 'warn' };
        if (r.pursuit) game.ui.showNotification('🚩 A Host Rides Out', `${r.pursuit.name} (${r.pursuit.strength} men) leaves ${r.pursuit.from} after you.`, 'warning');
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showHarrying(game, flash);
    },
});
