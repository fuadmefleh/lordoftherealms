// ActionMenu — the dark deeds of war (systems/atrocities.js): salt a town's
// fields, take hostages and hang them when the ultimatum runs out, fling the
// dead over the walls, put a surrendered town to the sword. Opened from the
// siege panel ("Darker means…"), a siege result ("What becomes of the
// town…") and the town's action list ('dark_deeds'). Rows route through
// data-am-act="atrocityAct" with the deed's id.
import { ActionMenu } from './_ref.js';
import { Atrocities } from '../../systems/atrocities.js';
import { Sieges } from '../../systems/sieges.js';
import { lede, chips, card, rowList, esc } from './uiKit.js';

function _panel(game, flash = '') {
    const { player, world } = game;
    const tile = Atrocities.tileFor(player, world);
    const s = tile && tile.settlement;
    const inf = Atrocities.infamy(player);
    const st = Atrocities.state(player);
    let html = lede(s
        ? `What you do to ${esc(s.name)} will be told in every hall for a generation. Towns remember; lords remember longer.`
        : 'There is no town here to do anything to.');
    html += chips([
        [inf.icon, 'Your name', esc(inf.label || 'unremarked')],
        ['⚔️', 'Cruelty', inf.butcher],
        ['💔', 'Broken faith', inf.perfidy, inf.refuses ? 'bad' : ''],
        { icon: '💰', label: 'AP', value: player.actionPoints || 0 },
    ]);
    if (inf.refuses) html += card('Towns that face you know what you did to one that surrendered: none will open its gates to you, and they fight to the last man.', { icon: '⚔️', title: 'No quarter expected', tone: 'bad' });
    if (flash) html += card(esc(flash), { icon: '📜', title: 'Done' });
    const h = st.hostages;
    if (h) {
        const left = (h.deadline || 0) - (world.day || 0);
        html += card(`${h.count} folk of ${esc(h.name)} in your camp. ${h.hollow ? 'The deadline is long past: your threat rang hollow.' : left > 0 ? `The ultimatum runs ${left} more day(s).` : 'The ultimatum has run out.'}`, { icon: '⛓️', title: 'Hostages' });
    }
    const opts = s ? Atrocities.options(player, world, tile) : [];
    html += rowList(opts.map(o => ({
        icon: o.icon, name: esc(o.name), desc: esc(o.desc), why: esc(o.why), off: !o.ok,
        side: o.ap ? `${o.ap} AP` : '', tone: o.ok ? 'bad' : '', act: 'atrocityAct', args: [o.id],
    })), 'Deeds');
    if (s && !opts.length) html += card('Nothing of the kind can be done here: besiege a town, or take one.', { icon: '🛡️' });
    if (Sieges.active(player)) html += '<button data-am-act="showSiegePanel" style="width:100%;padding:8px;margin-top:10px;background:#444;border:1px solid #666;border-radius:6px;color:#eee;cursor:pointer;">Back to the siege</button>';
    return html;
}

Object.assign(ActionMenu, {
    /** The dark deeds panel for the town besieged, or the one where the player stands. */
    showAtrocities(game, flash = '') {
        game.ui.showCustomPanel('💀 Dark Deeds of War', _panel(game, flash));
    },

    /** A row of the panel: the deed's id (Atrocities.act). */
    atrocityAct(game, id) {
        const r = Atrocities.act(game.player, game.world, id);
        if (!r || r.success === false) {
            game.ui.showNotification('💀 Dark Deeds', (r && r.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showAtrocities(game, r.message || '');
    },
});
