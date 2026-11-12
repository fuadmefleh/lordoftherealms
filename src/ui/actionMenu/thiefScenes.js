// ActionMenu — thieves (systems/npcTheft.js), two choice scenes:
//
//   catch_thief   on the street map, the player sees a burglar at a door or
//                 feels a cutpurse's hand: seize them, shout for the watch,
//                 fight, or let it be (ui/innerMapThieves.js does the deed).
//   stolen_goods  in a town where something of the player's was stolen
//                 (the settlement action 'Stolen Goods'): what was taken, the
//                 clues, and what to do — tell the watch, or face the thief.
import { registerScene } from './choiceScenes.js';
import { NpcTheft } from '../../systems/npcTheft.js';
import { InnerMapThieves } from '../innerMapThieves.js';

registerScene('catch_thief', {
    view(game, st) {
        return InnerMapThieves.view(game, st);
    },
    act(game, st, choice) {
        return InnerMapThieves.act(game, st, choice) || {};
    },
    abandon(game, st) {
        return InnerMapThieves.letBe(game, st);
    },
});

registerScene('stolen_goods', {
    view(game, st) {
        const player = game.player;
        const open = NpcTheft.openCases(player, st.q, st.r);
        if (!open.length) return null;
        const lines = [];
        const options = [];
        for (const e of open) {
            const what = NpcTheft.describe(e) || 'nothing that you can find';
            const when = `${Math.max(0, (game.world.day || 0) - e.d)} days ago`;
            const head = e.k === 'pickpocket' ? `Your purse, cut ${when}: ${what}.` : `${e.siteName || 'Your house'}, robbed ${when}: ${what}.`;
            lines.push(e.status === 'held' ? `${head} The watch holds it for you.` : head);
            for (const c of e.clues || []) lines.push(`  · ${c.text}`);
            if (e.status !== 'open') continue;
            const who = NpcTheft.suspect(e);
            if (!e.reported) options.push({ id: `report:${e.id}`, icon: '🛡️', label: `Tell the watch${who ? ` it was ${who}` : ''}`, hint: 'They look harder for the thief and the goods.', chance: null, odds: false });
            if (NpcTheft.canConfront(player, game.world, e)) {
                options.push({ id: `confront:${e.id}`, icon: '🗣️', label: `Confront ${who}`, hint: 'Face them with it: they may hand it back, or deny it to your face.', chance: NpcTheft.confrontChance(player, game.world, e) });
            }
        }
        options.push({ id: 'leave', icon: '↩', label: 'Leave it', chance: null, odds: false, isDefault: true });
        return { icon: '🔎', title: 'Stolen Goods', text: 'What thieves have taken from you here, and what is known of it.', lines, options };
    },
    act(game, st, choice) {
        if (choice === 'leave') return {};
        const [what, id] = String(choice).split(':');
        const res = what === 'confront' ? NpcTheft.confront(game.player, game.world, Number(id)) : NpcTheft.report(game.player, game.world, Number(id));
        const notification = { title: what === 'confront' ? '🗣️ Confronted' : '🛡️ The Watch', body: res.text, type: res.ok ? 'success' : 'warning' };
        return NpcTheft.openCases(game.player, st.q, st.r).length ? { state: st, notification, notify: true } : { notification };
    },
});
