// ActionMenu — Army Command: a commission in a realm's army. Seek one at a
// capital; command the host (battle, siege, raid, supply, the men, the
// lieutenants), follow the crown's orders, answer a rival at court, and — for
// a general the men would follow — turn the host on the crown. Logic lives in
// player/generalship.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Generalship } from '../../player/generalship.js';
import { RealmEscort } from '../../player/realmEscort.js';
import { NPCLords } from '../../world/npcLords.js';
import { BTN_GOLD, BTN_DARK, BTN_RED, BTN_OFF, CARD, esc, bullets } from './uiKit.js';
import { InnerMapBattle } from '../innerMapBattle.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px; color: var(--gold);';
const AP = { battle: 2, assault: 2, besiege: 1, raid: 2, address: 1, expose: 1 };
const HOW = { resigned: 'resigned', dismissed: 'dismissed in disgrace', crowned: 'crowned', traitor: 'turned traitor', lapsed: 'lapsed', fallen: 'the realm fell' };

function _bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:3px 0;"><div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

function _btn(label, action, args, style, ok = true, title = '') {
    const a = esc(JSON.stringify([action, ...args]));
    return ok
        ? `<button data-am-act="armyAct" data-am-args="${a}" style="${style}" title="${esc(title)}">${label}</button>`
        : `<button style="${BTN_OFF}" disabled title="${esc(title)}">${label}</button>`;
}

function _pastHtml(past) {
    if (!past || !past.length) return '';
    let html = `<div style="${HEAD}">Past commissions</div>`;
    for (const p of past.slice(0, 5)) {
        const r = p.record || {};
        html += `<div style="font-size:11px;color:#bbb;padding:2px 0;">🎖️ ${esc(p.rank)} of ${esc(p.kingdomName)}, day ${p.since}–${p.ended}: ${HOW[p.how] || esc(p.how)} · ${r.battlesWon || 0} battles won, ${r.townsTaken || 0} towns taken, ${r.ordersDone || 0} orders carried out</div>`;
    }
    return html;
}

Object.assign(ActionMenu, {
    /** Army Command (Dynasty menu, Wars of the Realm, a capital's actions). */
    showArmyCommand(game, message = null) {
        const player = game.player;
        const world = game.world;
        if (!player || !world) return;
        const v = Generalship.view(player, world);
        const c = v.commission;
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += `<div style="${CARD} border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;
        // The realm's household guard riding with you: not the host, not your own (ui/actionMenu/realmEscort.js)
        const hg = RealmEscort.hudLine(player);
        if (hg) html += `<button data-am-act="showHouseholdGuard" style="${BTN_DARK} display:block; width:100%; text-align:left; margin-bottom:8px;">🛡️ ${esc(hg)}</button>`;

        if (!c) {
            const tile = world.getTile(player.q, player.r);
            const can = Generalship.canSeek(player, world, tile);
            html += `<div style="${CARD}">`;
            html += '<div style="font-weight:bold;color:var(--gold);">🎖️ A commission in a realm\'s army</div>';
            html += bullets([
                'Granted at a realm\'s capital to a known soldier (combat and leadership, some renown, the crown\'s trust). You swear to the crown.',
                'You command a share of the realm\'s own army: Captain 5%, Commander 10%, General 18%, Marshal 28%. Its dead are the realm\'s dead.',
                'Wages come weekly from the crown\'s treasury, if it has the coin. At war the host eats grain from the realm\'s granaries, the crown paying the towns.',
                'Victories and orders carried out earn merit and favour, and promotion; defeats, failed orders and a rival\'s whispers cost them. A crown can come to fear its general.',
            ]);
            if (can.kingdom && can.ok) html += _btn(`🎖️ Seek a commission in the army of ${esc(can.kingdom.name)}`, 'seek', [], BTN_GOLD);
            else html += `<div style="color:#e8a0a0;margin-top:6px;">${esc(can.reason || 'Seek a commission at a realm\'s capital.')}</div>`;
            html += '</div>';
            html += _pastHtml(v.past);
            html += '</div>';
            game.ui.showCustomPanel('🎖️ Army Command', html);
            return;
        }

        const k = v.kingdom;
        const rd = v.rank;
        const gold = player.gold || 0;
        // ── The commission ──
        html += `<div style="${CARD}">`;
        html += `<div style="display:flex;justify-content:space-between;"><b>${rd.icon || '🎖️'} ${esc(rd.name)} of ${esc(c.kingdomName)}</b><span style="color:#aaa;">since day ${c.since}</span></div>`;
        html += `<div style="font-size:11px;color:#bbb;">Merit ${Math.round(c.merit)}${v.next ? ` / ${v.next.merit} for ${esc(v.next.name)} (favour ${v.next.minFavour} needed)` : ' · the highest rank'}</div>`;
        html += _bar(c.merit, v.next ? v.next.merit : c.merit, '#c9a54a');
        const fc = c.favour >= 50 ? '#7fd07f' : c.favour >= 25 ? '#f5c542' : '#e06060';
        html += `<div style="font-size:11px;">The crown's favour <span style="color:${fc};font-weight:bold;">${Math.round(c.favour)}</span> · its fear of you <span style="color:${v.fear >= 70 ? '#e06060' : '#bbb'};">${v.fear}</span></div>`;
        html += _bar(c.favour, 100, fc);
        html += `<div style="font-size:11px;color:#bbb;">Wage ${rd.wage}g a day from ${esc(c.kingdomName)}'s treasury (${Math.round(k && k.treasury || 0)}g)${c.owed > 0 ? ` · owed ${Math.round(c.owed)}g` : ''} · paid weekly</div>`;
        html += '</div>';

        // ── The host ──
        html += `<div style="${HEAD}">The host</div><div style="${CARD}">`;
        html += `<div><b>${c.men}</b> of the realm's ${Math.round(k && k.military || 0)} soldiers${(player.army || []).length ? `, and your own retinue of ${player.army.length}` : ''} · quality ×${v.quality} · power ${v.power}</div>`;
        const mc = c.morale >= 60 ? '#7fd07f' : c.morale >= 35 ? '#f5c542' : '#e06060';
        html += `<div style="font-size:11px;">Morale <span style="color:${mc};">${Math.round(c.morale)}</span> · veterancy ${Math.round(c.veterancy * 100)}% · supplies ${v.supplyDays} days${v.consuming ? '' : ' (in garrison: fed by the realm)'}</div>`;
        html += _bar(c.morale, 100, mc);
        if (v.mult > 1) html += `<div style="font-size:11px;color:#8fd88f;">At the front: the realm's armies fight ×${v.mult} with you there.</div>`;
        html += _btn(`📣 Address the men (${AP.address} AP)`, 'address', [], BTN_DARK);
        for (const amt of [50, 200]) html += _btn(`💰 Share ${amt}g`, 'spoils', [amt], BTN_DARK, gold >= amt, 'Coin from your purse to the men: they spend it in the realm\'s towns.');
        if (v.supplyTown) {
            html += _btn(`🌾 Requisition from ${esc(v.supplyTown.name)} (the crown pays)`, 'supply', [false], BTN_GOLD);
            html += _btn('🌾 …pay yourself', 'supply', [true], BTN_DARK);
        } else if (v.consuming) {
            html += `<div style="font-size:11px;color:#e8a0a0;">No town of ${esc(c.kingdomName)} within reach of your wagons.</div>`;
        }
        html += '</div>';

        // ── Lieutenants ──
        const T = (Generalship.config().lieutenants || {}).traits || {};
        html += `<div style="${HEAD}">Lieutenants (${c.lieutenants.length}/${rd.lieutenants})</div>`;
        for (const lt of c.lieutenants) {
            const lc = lt.loyalty >= 60 ? '#7fd07f' : lt.loyalty >= 40 ? '#f5c542' : '#e06060';
            html += `<div style="padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.06);">${esc(lt.name)} — skill ${lt.skill}, ${esc((T[lt.trait] || {}).label || lt.trait)}, loyalty <span style="color:${lc};">${Math.round(lt.loyalty)}</span> ${_btn('Dismiss', 'dismissLt', [lt.id], BTN_DARK)}</div>`;
        }
        if (c.lieutenants.length < rd.lieutenants) html += _btn('⬆️ Raise an officer from the ranks', 'appoint', [], BTN_DARK);

        // ── Orders ──
        html += `<div style="${HEAD}">The crown's orders</div><div style="${CARD}">`;
        if (c.order) {
            const o = c.order;
            html += `<div>📜 ${esc(o.text)}</div><div style="font-size:11px;color:#bbb;">Progress ${o.progress || 0}/${o.need} · due day ${o.due} (${Math.max(0, o.due - (world.day || 0))} days)</div>`;
        } else {
            html += `<div style="color:#bbb;">No orders. The crown will send more by day ${c.nextOrderDay}.</div>`;
        }
        html += '</div>';

        // ── War ──
        html += `<div style="${HEAD}">War</div><div style="${CARD}">`;
        if (!v.enemies.length) {
            html += `<div style="color:#bbb;">${esc(c.kingdomName)} is at peace. The host keeps the marches.</div>`;
        } else {
            html += `<div>At war with ${v.enemies.map(e => `<b>${esc(e.name)}</b>`).join(', ')}.</div>`;
            if (c.siege) {
                const sg = c.siege;
                html += `<div style="margin-top:6px;">🏰 Besieging <b>${esc(sg.name)}</b> (${esc(sg.kingdomName)}): ${sg.garrison} defenders · day ${(world.day || 0) - sg.since} of the siege</div>`;
                html += _bar(sg.progress, 100, '#c96a4a');
                html += _btn(`⚔️ Storm the walls (${AP.assault} AP)`, 'assault', [], BTN_RED);
                html += _btn(c.siegePolicy === 'sack' ? '🔥 Will sack it (change to spare)' : '🕊️ Will spare it (change to sack)', 'policy', [c.siegePolicy === 'sack' ? 'spare' : 'sack'], BTN_DARK);
                html += _btn('Lift the siege', 'lift', [], BTN_DARK);
            } else {
                for (const f of v.front) {
                    html += _btn(`⚔️ Give battle to ${esc(f.name)}'s army (≈${f.force} men, ${Math.round(f.odds * 100)}%, ${AP.battle} AP)`, 'battle', [f.id], BTN_GOLD);
                }
                if (!v.front.length) html += '<div style="font-size:11px;color:#bbb;">March within 3 hexes of the enemy\'s land to give battle.</div>';
                if (v.nearTown) {
                    html += _btn(`🏰 Besiege ${esc(v.nearTown.name)} and spare it (${AP.besiege} AP)`, 'besiege', ['spare'], BTN_GOLD);
                    html += _btn(`🔥 Besiege ${esc(v.nearTown.name)} to sack it`, 'besiege', ['sack'], BTN_RED);
                    html += _btn(`🔥 Raid ${esc(v.nearTown.name)} (${AP.raid} AP)`, 'raid', [], BTN_RED);
                }
            }
        }
        html += '</div>';

        // ── The court ──
        html += `<div style="${HEAD}">The court</div><div style="${CARD}">`;
        if (c.rival) {
            const rv = c.rival;
            const traits = (rv.traits || []).map(t => t && t.name).filter(Boolean).join(', ');
            const opinion = Array.isArray(rv.traits) ? Math.round(NPCLords.getLordOpinion(rv, player, world)) : null;
            html += `<div>🗣️ <b>${esc(rv.name)}</b>${rv.house ? ` of ${esc(rv.house)}${rv.estates ? ` (${rv.estates} estate${rv.estates > 1 ? 's' : ''})` : ''}` : ''} — your rival at court, influence ${Math.round(rv.influence)}.</div>`;
            html += `<div style="font-size:11px;color:#bbb;">${traits ? `${esc(traits)}. ` : ''}${rv.persona ? `He ${esc(rv.persona.words)}.` : ''}${opinion != null ? ` His opinion of you: ${opinion}.` : ''}${rv.foiled ? ` You have foiled him ${rv.foiled} time${rv.foiled > 1 ? 's' : ''}.` : ''}</div>`;
            const sc = rv.scheme;
            if (sc) {
                const left = Math.max(0, (sc.due || 0) - (world.day || 0));
                html += `<div style="margin-top:4px;color:#e8c070;">🕵️ He ${esc(sc.text)} It bites in ${left} day${left === 1 ? '' : 's'} (day ${sc.due})${sc.blunted ? ', blunted by your friends at court' : ''}.</div>`;
            } else if ((rv.quietUntil || -1) > (world.day || 0)) {
                html += `<div style="font-size:11px;color:#9fd89f;">He holds his tongue (bought) until day ${rv.quietUntil}.</div>`;
            }
            const cost = (Generalship.config().court || {}).answerGold || 80;
            html += _btn(`🎁 Answer at court (${cost}g to the courtiers)`, 'answer', [], BTN_DARK, gold >= cost);
            if (sc) html += _btn(`🔎 Expose his scheme (${Math.round(Generalship.exposeOdds(player, c) * 100)}%, ${AP.expose} AP)`, 'expose', [], BTN_GOLD, true, 'Lay it bare before the crown: foiled and shamed if you can prove it; you look petty if you cannot.');
            const price = Generalship.buyOffPrice(c);
            if (price != null) html += _btn(`💰 Buy his silence (${price}g to his House)`, 'buyOff', [], BTN_DARK, gold >= price, 'He drops his scheme and keeps quiet for a month.');
            else html += '<div style="font-size:11px;color:#999;">He is too proud to be bought.</div>';
        }
        const co = v.coup;
        if (co && co.ok) {
            html += `<div style="margin-top:6px;color:#e8a0a0;">👑 Your men would follow you against ${esc(k && k.ruler || 'the crown')}: about ${Math.round(co.chance * 100)}% (${co.rebels} against ${co.loyalists}).${co.betrayers.length ? ` ${co.betrayers.map(esc).join(', ')} might betray you.` : ''}</div>`;
            html += _btn('👑 Turn the host on the crown', 'coup', [], BTN_RED, true, 'Crowned if it works; exiled and hunted if it fails.');
        } else if (co && c.rank >= 2) {
            html += `<div style="font-size:11px;color:#999;margin-top:4px;">A coup: ${esc(co.reason)}</div>`;
        }
        html += _btn('Resign your commission', 'resign', [], BTN_DARK);
        html += '</div>';

        // ── Record ──
        const r = c.record;
        html += `<div style="font-size:11px;color:#999;">Battles won ${r.battlesWon}, lost ${r.battlesLost} · towns taken ${r.townsTaken} · raids ${r.raids} · orders ${r.ordersDone} done, ${r.ordersFailed} failed · the realm's battles with you at the front ${r.realmWon} won, ${r.realmLost} lost · wages ${Math.round(r.wages)}g, plunder ${Math.round(r.plunder)}g</div>`;
        if (c.log && c.log.length) html += `<div style="font-size:11px;color:#888;margin-top:4px;">${c.log.slice(0, 6).map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`;
        html += _pastHtml(v.past);
        html += '</div>';
        game.ui.showCustomPanel('🎖️ Army Command', html);
    },

    /** Army Command's buttons (data-am-act="armyAct"). */
    armyAct(game, action, ...args) {
        const player = game.player;
        const world = game.world;
        const ap = AP[action] || 0;
        if (ap && (player.actionPoints || 0) < ap) {
            game.ui.showNotification('⚡ Not Enough Action Points', `This needs ${ap} AP — rest to start a new day.`, 'error');
            return;
        }
        // Giving battle, storming the walls, falling on a town: on the ground yourself
        // (ui/innerMapBattle.js), or the captains' one roll
        const CHOICE = {
            battle: ['⚔️ Give Battle', 'The host drawn up on the ground where the armies meet: march, hold, charge, loose, sound the retreat.'],
            assault: ['⚔️ Storm the Walls', 'Fought in the town\'s own streets: its defenders hold them, your host comes on from outside the walls.'],
            raid: ['🔥 Raid', 'Fought in the place itself: its defenders in the streets, your host from the fields around it.'],
        };
        if (CHOICE[action] && args[args.length - 1] !== 'captains') {
            const [title, blurb] = CHOICE[action];
            game.ui.showCustomPanel(title, `<div style="padding:4px 2px;">
                ${_btn('⚔️ Take the field — command the host yourself', 'field', [action, ...args], BTN_GOLD + 'display:block;width:100%;text-align:left;padding:9px 10px;')}
                <div style="font-size:11px;color:#999;margin:2px 0 8px;">${blurb}</div>
                ${_btn('🎲 Let the captains fight it', action, [...args, 'captains'], BTN_DARK + 'display:block;width:100%;text-align:left;padding:8px 10px;')}
                <div style="font-size:11px;color:#999;margin-top:2px;">Settled at once on the odds.</div></div>`);
            return;
        }
        if (action === 'field') {
            const [kind, ...rest] = args;
            const c = Generalship.state(player);
            const day = Number(world.day) || 0;
            const minMen = Number((Generalship.config().host || {}).minMen) || 10;
            let prep;
            if (kind === 'assault') prep = Generalship.assaultSpec(player, world);
            else if (kind === 'raid') prep = Generalship.raidSpec(player, world);
            else {
                const why = !c ? 'You hold no commission.' : c.siege ? `Your host is tied down before ${c.siege.name}.`
                    : c.lastBattleDay === day ? 'The host fought today. It needs a night to re-form.'
                        : (Number(c.men) || 0) < minMen ? 'Your host is too few to give battle.' : null;
                prep = why ? { reason: why } : Generalship.prepareBattle(player, world, 'field', { enemyId: rest[0] });
            }
            if (!prep || !prep.spec) {
                game.ui.showNotification('🎖️ Army Command', (prep && prep.reason) || 'That cannot be done.', 'error');
                return;
            }
            const cost = AP[kind] || AP.battle;
            if ((player.actionPoints || 0) < cost) {
                game.ui.showNotification('⚡ Not Enough Action Points', `This needs ${cost} AP — rest to start a new day.`, 'error');
                return;
            }
            player.actionPoints -= cost;
            // The outcome fought (or the captains' roll when there is no ground) → the Generalship path
            const settle = (outcome) => kind === 'assault' ? Generalship.assault(player, world, { outcome })
                : kind === 'raid' ? Generalship.raid(player, world, { outcome })
                    : Generalship.settleBattle(player, world, prep.spec, outcome);
            const report = (r, withdrew = false) => {
                game.ui.updateStats(player, world);
                const msg = withdrew ? `You sounded the retreat. ${r.message || ''}` : (r.message || r.reason);
                ActionMenu.showArmyCommand(game, { html: esc(msg || 'The battle is over.'), color: r.victory ? 'rgba(127,208,127,0.4)' : 'rgba(224,96,96,0.5)' });
            };
            InnerMapBattle.openHost(game, prep.spec, {
                onDone: (outcome) => report(settle(outcome), !!(outcome && outcome.withdrew)),
            }).then((ok) => {
                if (!ok) report(settle(Generalship.autoResolve(prep.spec)));
            });
            return;
        }
        const argv = args[args.length - 1] === 'captains' ? args.slice(0, -1) : args;
        let res;
        if (action === 'seek') res = Generalship.seek(player, world, world.getTile(player.q, player.r));
        else if (action === 'battle') res = Generalship.giveBattle(player, world, argv[0]);
        else if (action === 'besiege') res = Generalship.besiege(player, world, argv[0]);
        else if (action === 'assault') res = Generalship.assault(player, world);
        else if (action === 'policy') res = Generalship.setSiegePolicy(player, argv[0]);
        else if (action === 'lift') res = Generalship.liftSiege(player, world);
        else if (action === 'raid') res = Generalship.raid(player, world);
        else if (action === 'supply') res = Generalship.requisition(player, world, { ownPurse: !!argv[0] });
        else if (action === 'address') res = Generalship.addressTroops(player, world);
        else if (action === 'spoils') res = Generalship.shareSpoils(player, world, argv[0]);
        else if (action === 'appoint') res = Generalship.appointLieutenant(player, world);
        else if (action === 'dismissLt') res = Generalship.dismissLieutenant(player, world, argv[0]);
        else if (action === 'answer') res = Generalship.answerRival(player, world);
        else if (action === 'expose') res = Generalship.exposeScheme(player, world);
        else if (action === 'buyOff') res = Generalship.buyOffRival(player, world);
        else if (action === 'coup') res = Generalship.stageCoup(player, world);
        else if (action === 'resign') res = Generalship.resign(player, world);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('🎖️ Army Command', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        if (ap) player.actionPoints -= ap;
        game.ui.updateStats(player, world);
        const bad = res.victory === false || res.failed;
        ActionMenu.showArmyCommand(game, { html: esc(res.message || 'Done.'), color: bad ? 'rgba(224,96,96,0.5)' : 'rgba(127,208,127,0.4)' });
    },
});
