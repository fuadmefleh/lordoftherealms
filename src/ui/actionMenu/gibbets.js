// ActionMenu — the dead on show and war trophies (systems/gibbets.js).
//   showGibbets   "The Dead & Trophies": the bodies in your hands (show them at a
//                 seat — the head over the gate, the gibbet at the crossroads, the
//                 gallows — give them back, bury them, take a trophy off a great
//                 one), the dead you have on show and how far they have gone, the
//                 dead on show where you stand (cut them down), your war trophies
//                 and their realms' envoys. Reached from Intrigue & the Law
//                 ('gibbets'), the Scaffold, and the street map's displays.
//   gibbetsAct    a row: place, show, trophy, return, bury, down, tprice, tpeace,
//                 tgift, trefuse.
import { ActionMenu } from './_ref.js';
import { Gibbets } from '../../systems/gibbets.js';
import { lede, chips, card, rowList, price, esc } from './uiKit.js';

// The seat chosen for each body while the panel is open
const _placeSel = {};

const STAGE_ICON = { fresh: '🩸', rotting: '☠️', bones: '🦴' };

Object.assign(ActionMenu, {
    /** The Dead & Trophies. */
    showGibbets(game, flash = '') {
        const { player, world } = game;
        const st = Gibbets.state(player);
        const day = Number.isFinite(world.day) ? world.day : 0;
        const bodies = Gibbets.bodies(player, world);
        const mine = Gibbets.all(world, day).filter(x => x.d.by && x.d.by.kind === 'player');
        const trophies = Gibbets.trophies(player);
        let html = lede('A head over the gate is a sermon that preaches itself every day. Thieves keep to their beds and the commons to their fields while it stands; the town sours, the kin remember, and the priests mutter about the dead belonging to God.');
        html += chips([
            ['💀', 'On show', mine.length],
            ['⚰️', 'Bodies in hand', bodies.length],
            ['🏆', 'Trophies', trophies.filter(h => h.status === 'held').length],
            ['🪓', 'Cut down', st.stats.takenDown || 0],
        ]);
        if (flash) html += card(esc(flash), { icon: '💀', title: 'Done' });

        // The bodies in your hands
        for (const b of bodies) {
            const places = Gibbets.places(player, world, b);
            const sel = places.find(p => p.key === _placeSel[b.id]) || places[0] || null;
            const rows = [];
            if (places.length > 1) {
                for (const p of places.slice(0, 4)) {
                    rows.push({ icon: p.here ? '📍' : '🏛️', name: esc(p.name), desc: esc(p.here ? 'Your seat · you are here' : 'Your seat'), side: sel && sel.key === p.key ? 'Chosen' : '', tone: sel && sel.key === p.key ? 'gold' : '', act: 'gibbetsAct', args: ['place', b.id, p.key] });
                }
            }
            for (const o of Gibbets.displayOptions(player, world, b)) {
                rows.push({ icon: o.icon, name: esc(sel ? `${o.label}, at ${sel.name}` : o.label), desc: esc(o.desc), off: !o.ok, why: esc(o.why), tone: 'bad', act: 'gibbetsAct', args: ['show', b.id, o.id] });
            }
            if (b.great) {
                for (const o of Gibbets.trophyOptions(player, world, b)) {
                    rows.push({ icon: o.icon, name: esc(`Take a trophy: ${o.label.toLowerCase()}`), desc: esc(o.desc), off: !o.ok, why: esc(o.why), tone: 'gold', act: 'gibbetsAct', args: ['trophy', b.id, o.id] });
                }
            }
            rows.push({ icon: '🕊️', name: 'Give the body back to the kin', desc: 'They bury their own: their thanks, the feud eased', tone: 'good', act: 'gibbetsAct', args: ['return', b.id] });
            rows.push({ icon: '⚰️', name: 'Bury it', desc: 'Outside the churchyard wall, unmarked', act: 'gibbetsAct', args: ['bury', b.id] });
            html += rowList(rows, `⚰️ ${esc(b.name)}: ${esc(b.how || 'dead')} · ${Math.max(0, (b.until || day) - day)} days before it must go in the ground`);
        }
        if (!bodies.length) html += card('No bodies wait on your word. The scaffold\'s dead, a rising\'s leader hanged, an enemy commander cut down in the field or a rival slain in the lists come here.', { icon: '⚰️' });

        // Yours on show
        if (mine.length) {
            html += rowList(mine.map(({ s, d, stage }) => {
                const k = Gibbets.kind(d.kind) || {};
                return {
                    icon: STAGE_ICON[stage.id] || '💀', name: esc(`${d.name}: ${k.short || d.kind}`), desc: esc(`${s.name} · ${stage.label} · up ${day - (d.day || 0)} days`),
                    note: esc(`Thieves there ×${Gibbets.deterrence(s, day).toFixed(2)} · the commons' fear −${Gibbets.revoltDread(world, s, day)}`),
                    side: s.q === player.q && s.r === player.r ? 'Cut down' : '', act: s.q === player.q && s.r === player.r ? 'gibbetsAct' : null, args: ['down', d.id],
                };
            }), '💀 Your dead on show');
        }
        // On show where you stand (any lord's)
        const here = Gibbets.standingAt(world, player.q, player.r, day).filter(d => !(d.by && d.by.kind === 'player'));
        if (here.length) {
            html += rowList(here.map(d => {
                const k = Gibbets.kind(d.kind) || {};
                return { icon: STAGE_ICON[d.stage.id] || '💀', name: esc(`${d.name}: ${k.short || d.kind}`), desc: esc(`Set up by ${d.by ? d.by.name : 'the crown'} · ${d.stage.label}`), side: 'Cut down', tone: 'bad', note: 'The crown\'s men will want to know who did it', act: 'gibbetsAct', args: ['down', d.id] };
            }), '🏘️ The dead on show here');
        }

        // Trophies
        if (trophies.length) {
            const rows = [];
            for (const h of trophies) {
                const t = h.trophy;
                rows.push({ icon: h.icon || '🏆', name: esc(h.name), desc: esc(`Of ${t.of}${t.realm ? `, ${t.realm}` : ''} · ${h.status === 'held' ? 'in your hall' : h.status}${Gibbets.trophyDread(player, t.kingdomId) > 0 && h.status === 'held' ? ` · their towns fear you (+${Math.round(Gibbets.trophyDread(player, t.kingdomId) * 100)}% to siege terms)` : ''}`) });
                if (h.status !== 'held') continue;
                const pr = t.demand ? t.demand.price : Gibbets.trophyPrice(world, h);
                if (t.demand) rows.push({ icon: '📜', name: esc(`Their envoys wait: ${t.realm || 'his realm'} would pay`), desc: 'Give it back for their price, or send them away', side: price(pr, true), act: 'gibbetsAct', args: ['tprice', h.id], tone: 'gold' });
                else if (pr > 0) rows.push({ icon: '💰', name: 'Sell it back to his realm', desc: esc(`${t.realm || 'His realm'}'s treasury would pay`), side: price(pr, true), act: 'gibbetsAct', args: ['tprice', h.id] });
                if (Gibbets._atWar(player, t.kingdomId)) rows.push({ icon: '🤝', name: 'Give it back as a term of peace', desc: 'The war with them ends', act: 'gibbetsAct', args: ['tpeace', h.id], tone: 'good' });
                rows.push({ icon: '🕊️', name: 'Give it back for nothing', desc: 'Amends: their court will remember it', act: 'gibbetsAct', args: ['tgift', h.id], tone: 'good' });
                if (t.demand) rows.push({ icon: '✋', name: 'Send the envoys away', desc: 'Their hatred grows', act: 'gibbetsAct', args: ['trefuse', h.id], tone: 'bad' });
            }
            html += rowList(rows, '🏆 War trophies');
        }
        if (st.log.length) {
            html += rowList(st.log.slice(0, 8).map(l => ({ icon: '📜', name: esc(l.text), desc: esc(`Day ${l.day}`) })), '📜 What was done with the dead');
        }
        game.ui.showCustomPanel('💀 The Dead & Trophies', html);
    },

    /** A row of The Dead & Trophies. */
    gibbetsAct(game, what, a, b) {
        const { player, world } = game;
        let r = null;
        if (what === 'place') { _placeSel[a] = b; ActionMenu.showGibbets(game); return; }
        if (what === 'show') r = Gibbets.display(player, world, a, b, _placeSel[a] || null);
        else if (what === 'trophy') r = Gibbets.takeTrophy(player, world, a, b);
        else if (what === 'return') r = Gibbets.returnBody(player, world, a);
        else if (what === 'bury') r = Gibbets.bury(player, world, a);
        else if (what === 'down') r = Gibbets.takeDown(player, world, player.q, player.r, a);
        else if (what === 'tprice') r = Gibbets.returnTrophy(player, world, a, 'price');
        else if (what === 'tpeace') r = Gibbets.returnTrophy(player, world, a, 'peace');
        else if (what === 'tgift') r = Gibbets.returnTrophy(player, world, a, 'gift');
        else if (what === 'trefuse') r = Gibbets.refuseDemand(player, world, a);
        if (!r || !r.success) { game.ui.showNotification('💀 The Dead', (r && r.reason) || 'It cannot be done.', 'error'); return; }
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showGibbets(game, r.text);
    },
});

