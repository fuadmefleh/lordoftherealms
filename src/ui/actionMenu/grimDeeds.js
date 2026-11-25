// ActionMenu — dark deeds of war and the castle.
//   showGrimDeeds   "Behind the Castle Walls": the companies that broke and await
//                   your word (decimate them, or let it go: player/decimation.js),
//                   the steel and the hatred in your ranks; those you could wall
//                   up alive in the cellars of the seat you stand in, the secrets
//                   you keep and the ghosts in the walls here and in your seats
//                   (a priest's rite, or break the wall open: systems/immurement.js);
//                   the flayed skins you hung on gates and over judges' chairs and
//                   the dread they keep your stewards in (systems/flaying.js).
//                   Reached from the town's action list ('grim_deeds', Intrigue &
//                   the Law), the army's ('decimate'), and the Scaffold's
//                   condemned (a 'wall them up' row).
//   grimDeedsAct    a row: decimate, spare, immure, lay, break.
import { ActionMenu } from './_ref.js';
import { Decimation } from '../../player/decimation.js';
import { Immurement } from '../../systems/immurement.js';
import { Flaying } from '../../systems/flaying.js';
import { Gibbets } from '../../systems/gibbets.js';
import { lede, chips, card, rowList, price, esc } from './uiKit.js';

Object.assign(ActionMenu, {
    /** Behind the Castle Walls. */
    showGrimDeeds(game, flash = '') {
        const { player, world } = game;
        const day = Number.isFinite(world.day) ? world.day : 0;
        const dst = player.decimation ? Decimation.state(player) : null;
        const pending = Decimation.pending(player, world);
        const dread = Flaying.stewardDread(player, world);
        let html = lede('What is done where no crowd watches: in the ranks after a rout, in the cellars of a castle, in the hall of justice. It is remembered all the same.');
        html += chips([
            dst && dst.steelDays > 0 ? ['🎲', 'Steel in the ranks', `${dst.steelDays} days`] : null,
            dst && dst.hate > 0 ? ['😠', 'The men\'s hatred', Math.round(dst.hate)] : null,
            ['🩸', 'Your stewards\' dread', `${Math.round(dread * 100)}%`],
            ['🧱', 'Walled up', player.immurement ? Immurement.state(player).stats.walled : 0],
        ]);
        if (flash) html += card(esc(flash), { icon: '🧱', title: 'Done' });

        // The companies that broke
        for (const b of pending) {
            const n = Decimation.toll(player, b);
            html += rowList([
                { icon: '🎲', name: 'Draw lots: decimate them', desc: esc(`Every tenth man beaten to death by his comrades: ${b.kind === 'host' ? `about ${n} men of the host` : `${n} compan${n === 1 ? 'y' : 'ies'}`}. They will not run again soon; they will hate you for it, and some will slip away.`), tone: 'bad', act: 'grimDeedsAct', args: ['decimate', b.id] },
                { icon: '🕊️', name: 'Let it go', desc: 'The men who ran will fight again, or run again', tone: 'good', act: 'grimDeedsAct', args: ['spare', b.id] },
            ], `🏃 ${b.kind === 'host' ? 'The host' : 'Your army'} broke before ${esc(b.foe)} · day ${b.day}`);
        }

        // Walling up, at the seat where you stand
        const seats = Immurement.seats(player, world);
        const here = seats.find(s => s.here) || null;
        const targets = Immurement.targets(player, world);
        if (targets.length) {
            if (here) {
                html += rowList(targets.map(t => ({
                    icon: t.icon, name: esc(`Wall up ${t.name} in ${here.walls}`), desc: esc(`${t.desc}. Unseen, no crowd, no chronicle; the masons paid to forget. The servants will talk in the end, and the house will be haunted for generations.`),
                    tone: 'bad', act: 'grimDeedsAct', args: ['immure', t.kind, t.id],
                })), `🧱 The cellars of ${esc(here.name)}`);
            } else {
                html += card(esc(seats.length ? `To wall anyone up you must stand in one of your seats: ${seats.slice(0, 4).map(s => s.name).join(', ')}.` : 'You hold no castle or manor of your own to wall anyone up in.'), { icon: '🧱' });
            }
        }

        // The secrets you keep
        const mine = Immurement.mine(player, world);
        if (mine.secrets.length) {
            html += rowList(mine.secrets.slice(-8).reverse().map(s => ({
                icon: s.revealed ? '🗣️' : '🤫', name: esc(`${s.name}, in the walls of ${s.town}`), desc: esc(`Since day ${s.day} · ${s.revealed ? `the servants talked (day ${s.revealedDay})` : 'no one has spoken of it yet'}`), tone: s.revealed ? 'bad' : '',
            })), '🤫 What the walls keep');
        }

        // The ghosts where you stand, and in your seats
        const ghostsHere = Immurement.ghosts(world.getTile ? (world.getTile(player.q, player.r) || {}).settlement : null);
        const L = Immurement.config().lay;
        const B = Immurement.config().breakWall;
        if (ghostsHere.length) {
            const rows = [];
            for (const h of ghostsHere) {
                rows.push({ icon: '👻', name: esc(`${h.name}${h.known || (h.by && h.by.kind === 'player' && h.by.name === (player.name || 'the lord')) ? '' : ', some say'}`), desc: esc(`Walled up by ${h.by ? h.by.name : 'a lord long dead'} · ${h.strength >= 0.7 ? 'walks most nights' : h.strength >= 0.35 ? 'heard now and then' : 'a cold draught, a sigh'}`) });
                rows.push({ icon: '🕯️', name: 'Have a priest lay the ghost', desc: 'Quieter for years; the priest will ask whose spirit it is', side: price(L.cost, (player.gold || 0) >= L.cost), act: 'grimDeedsAct', args: ['lay', h.id], tone: 'good' });
                rows.push({ icon: '🔨', name: 'Break open the wall and bury the bones', desc: 'The haunting ends. Everyone will know what was there', side: price(B.cost, (player.gold || 0) >= B.cost), act: 'grimDeedsAct', args: ['break', h.id] });
            }
            html += rowList(rows, '👻 The ghosts in these walls');
        }
        const far = mine.ghosts.filter(x => !(x.s.q === player.q && x.s.r === player.r));
        if (far.length) {
            html += rowList(far.map(({ s, h }) => ({ icon: '👻', name: esc(`${h.name} in ${s.name}`), desc: esc(`Your servants there lose heart; guests do not stay · ${Math.round(h.strength * 100)}% of its first strength`) })), '👻 Your haunted houses');
        }

        // The skins
        const skins = Flaying.skins(player, world, day);
        if (skins.length) {
            html += rowList(skins.map(({ s, d, stage }) => {
                const k = Gibbets.kind(d.kind) || {};
                return { icon: k.icon || '🩸', name: esc(`${d.name}: ${k.short || d.kind}`), desc: esc(`${s.name} · ${stage.label} · up ${day - (d.day || 0)} days`), note: esc(d.kind === 'chair' ? 'Whoever sits in judgement there sits on the last' : 'Every carter lowers his eyes passing under it') };
            }), '🩸 The flayed');
        }
        if (dread > 0) html += card(esc(`Your stewards and governors keep at least ${Math.round(dread * 100)}% of their fear of being found out: they steal that much less.`), { icon: '🩸' });
        if (!pending.length && !targets.length && !mine.secrets.length && !ghostsHere.length && !skins.length) {
            html += card('Nothing waits here. A rout, a traitor or a wife in disgrace on the scaffold\'s list, a haunted house, a flayed skin: they come here.', { icon: '🧱' });
        }
        game.ui.showCustomPanel('🧱 Behind the Castle Walls', html);
    },

    /** A row of Behind the Castle Walls. */
    grimDeedsAct(game, what, a, b) {
        const { player, world } = game;
        let r = null;
        if (what === 'decimate') r = Decimation.decimate(player, world, a);
        else if (what === 'spare') r = Decimation.spare(player, world, a);
        else if (what === 'immure') r = Immurement.wallUp(player, world, a, b);
        else if (what === 'lay') r = Immurement.layGhost(player, world, a);
        else if (what === 'break') r = Immurement.breakWall(player, world, a);
        if (!r || !r.success) { game.ui.showNotification('🧱 Behind the Walls', (r && r.reason) || 'It cannot be done.', 'error'); return; }
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showGrimDeeds(game, r.text);
    },
});
