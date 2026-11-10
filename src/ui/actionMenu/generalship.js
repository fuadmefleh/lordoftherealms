// ActionMenu — Army Command: a commission in a realm's army. Seek one at a
// capital; command the host (battle, siege, raid, supply, the men, the
// lieutenants), follow the crown's orders, answer a rival at court, and — for
// a general the men would follow — turn the host on the crown. Logic lives in
// player/generalship.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Generalship } from '../../player/generalship.js';
import { RealmEscort } from '../../player/realmEscort.js';
import { NPCLords } from '../../world/npcLords.js';
import { BTN_GOLD, BTN_DARK, BTN_OFF, esc, bullets, lede, chips, sectionHead, card, actRow, rowList, kv } from './uiKit.js';
import { InnerMapBattle } from '../innerMapBattle.js';
import { ParentsGuard } from '../parentsGuard.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): cards for the commission's
// state, one row an order to give, greyed with its reason when it can't be given
const NOTE = 'font-size:11px; color:#9d937c; margin:2px 0;';
const AP = { battle: 2, assault: 2, besiege: 1, raid: 2, address: 1, expose: 1 };
const HOW = { resigned: 'resigned', dismissed: 'dismissed in disgrace', crowned: 'crowned', traitor: 'turned traitor', lapsed: 'lapsed', fallen: 'the realm fell' };

function _bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin:3px 0 5px;"><div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

function _btn(label, action, args, style, ok = true, title = '') {
    const a = esc(JSON.stringify([action, ...args]));
    return ok
        ? `<button data-am-act="armyAct" data-am-args="${a}" style="${style}" title="${esc(title)}">${label}</button>`
        : `<button style="${BTN_OFF}" disabled title="${esc(title)}">${label}</button>`;
}

/** One order as an action-menu row: data-am-act="armyAct" data-am-args=[action, ...args]. */
function _row(o, action, args = [], ok = true) {
    return actRow({ ...o, act: 'armyAct', args: [action, ...args], off: !ok });
}

function _pastHtml(past) {
    if (!past || !past.length) return '';
    return rowList(past.slice(0, 5).map(p => {
        const r = p.record || {};
        return actRow({
            icon: '🎖️', name: `${esc(p.rank)} of ${esc(p.kingdomName)}`,
            desc: `${r.battlesWon || 0} battles won, ${r.townsTaken || 0} towns taken, ${r.ordersDone || 0} orders carried out`,
            side: `day ${p.since}–${p.ended}: ${HOW[p.how] || esc(p.how)}`,
        });
    }), 'Past commissions');
}

Object.assign(ActionMenu, {
    /** Army Command (Dynasty menu, Wars of the Realm, a capital's actions). */
    showArmyCommand(game, message = null) {
        // Your parents' rules at this door too (ui/parentsGuard.js)
        if (!ParentsGuard.ok(game, 'army_command', null)) return;
        const player = game.player;
        const world = game.world;
        if (!player || !world) return;
        const v = Generalship.view(player, world);
        const c = v.commission;
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += `<div class="pk-card" style="border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#ece2c8;">${message.html}</div>`;
        // The realm's household guard riding with you: not the host, not your own (ui/actionMenu/realmEscort.js)
        const hg = RealmEscort.hudLine(player);
        if (hg) html += rowList([{ icon: '🛡️', name: esc(hg), desc: 'The realm\'s household guard riding with you', act: 'showHouseholdGuard' }]);

        if (!c) {
            const tile = world.getTile(player.q, player.r);
            const can = Generalship.canSeek(player, world, tile);
            html += card(bullets([
                'Granted at a realm\'s capital to a known soldier (combat and leadership, some renown, the crown\'s trust). You swear to the crown.',
                'You command a share of the realm\'s own army: Captain 5%, Commander 10%, General 18%, Marshal 28%. Its dead are the realm\'s dead.',
                'Wages come weekly from the crown\'s treasury, if it has the coin. At war the host eats grain from the realm\'s granaries, the crown paying the towns.',
                'Victories and orders carried out earn merit and favour, and promotion; defeats, failed orders and a rival\'s whispers cost them. A crown can come to fear its general.',
            ]), { icon: '🎖️', title: 'A commission in a realm\'s army' });
            const ok = !!(can.kingdom && can.ok);
            html += rowList([_row({
                icon: '🎖️', name: ok ? `Seek a commission in the army of ${esc(can.kingdom.name)}` : 'Seek a commission',
                why: esc(can.reason || 'Seek a commission at a realm\'s capital.'), tone: 'gold',
            }, 'seek', [], ok)]);
            html += _pastHtml(v.past);
            html += '</div>';
            game.ui.showCustomPanel('🎖️ Army Command', html);
            return;
        }

        const k = v.kingdom;
        const rd = v.rank;
        const gold = player.gold || 0;
        // ── The commission ──
        const fc = c.favour >= 50 ? '#8fd18a' : c.favour >= 25 ? '#ffcf6a' : '#e0846a';
        let com = `<div style="${NOTE}">Merit ${Math.round(c.merit)}${v.next ? ` / ${v.next.merit} for ${esc(v.next.name)} (favour ${v.next.minFavour} needed)` : ' · the highest rank'}</div>`;
        com += _bar(c.merit, v.next ? v.next.merit : c.merit, '#c9a54a');
        com += `<div style="font-size:11px; color:#cbbf9f;">The crown's favour <span style="color:${fc};font-weight:bold;">${Math.round(c.favour)}</span> · its fear of you <span style="color:${v.fear >= 70 ? '#e0846a' : '#cbbf9f'};">${v.fear}</span></div>`;
        com += _bar(c.favour, 100, fc);
        com += `<div style="${NOTE}">Wage ${rd.wage}g a day from ${esc(c.kingdomName)}'s treasury (${Math.round(k && k.treasury || 0)}g)${c.owed > 0 ? ` · owed ${Math.round(c.owed)}g` : ''} · paid weekly</div>`;
        html += card(com, { icon: rd.icon || '🎖️', title: `${esc(rd.name)} of ${esc(c.kingdomName)}`, side: `since day ${c.since}` });

        // ── The host ──
        html += sectionHead('The host');
        const mc = c.morale >= 60 ? '#8fd18a' : c.morale >= 35 ? '#ffcf6a' : '#e0846a';
        html += lede(`<b>${c.men}</b> of the realm's ${Math.round(k && k.military || 0)} soldiers${(player.army || []).length ? `, and your own retinue of ${player.army.length}` : ''} · quality ×${v.quality} · power ${v.power}`);
        html += chips([
            { icon: '🔥', label: 'Morale', value: `<span style="color:${mc};">${Math.round(c.morale)}</span>` },
            ['🎖️', 'Veterancy', `${Math.round(c.veterancy * 100)}%`],
            ['🌾', 'Supplies', `${v.supplyDays} days`],
        ]);
        html += _bar(c.morale, 100, mc);
        if (!v.consuming) html += `<div style="${NOTE}">(in garrison: fed by the realm)</div>`;
        if (v.mult > 1) html += `<div style="font-size:11px;color:#8fd18a;">At the front: the realm's armies fight ×${v.mult} with you there.</div>`;
        const hostRows = [_row({ icon: '📣', name: 'Address the men', side: `${AP.address} AP` }, 'address')];
        for (const amt of [50, 200]) {
            hostRows.push(_row({
                icon: '💰', name: `Share ${amt}g`, desc: 'Coin from your purse to the men: they spend it in the realm\'s towns.',
                title: 'Coin from your purse to the men: they spend it in the realm\'s towns.',
                why: 'Coin from your purse to the men — your purse is short', side: `${amt}g`, tone: gold >= amt ? 'gold' : 'bad',
            }, 'spoils', [amt], gold >= amt));
        }
        html += rowList(hostRows);
        if (v.supplyTown) {
            // Two ways to pay for one requisition: a row for it, the payer as its buttons
            html += rowList([actRow({
                icon: '🌾', name: `Requisition from ${esc(v.supplyTown.name)}`, desc: 'Grain for the wagons',
                side: _btn('the crown pays', 'supply', [false], BTN_GOLD) + _btn('…pay yourself', 'supply', [true], BTN_DARK),
            })]);
        } else if (v.consuming) {
            html += `<div style="font-size:11px;color:#c98a6a;">No town of ${esc(c.kingdomName)} within reach of your wagons.</div>`;
        }

        // ── Lieutenants ──
        const T = (Generalship.config().lieutenants || {}).traits || {};
        const ltRows = c.lieutenants.map(lt => {
            const lc = lt.loyalty >= 60 ? '#8fd18a' : lt.loyalty >= 40 ? '#ffcf6a' : '#e0846a';
            return actRow({
                icon: '🎖️', name: esc(lt.name),
                desc: `skill ${lt.skill}, ${esc((T[lt.trait] || {}).label || lt.trait)}, loyalty <span style="color:${lc};">${Math.round(lt.loyalty)}</span>`,
                side: _btn('Dismiss', 'dismissLt', [lt.id], BTN_DARK),
            });
        });
        if (c.lieutenants.length < rd.lieutenants) ltRows.push(_row({ icon: '⬆️', name: 'Raise an officer from the ranks' }, 'appoint'));
        html += rowList(ltRows, `Lieutenants (${c.lieutenants.length}/${rd.lieutenants})`) || sectionHead(`Lieutenants (${c.lieutenants.length}/${rd.lieutenants})`);

        // ── Orders ──
        html += sectionHead('The crown\'s orders');
        if (c.order) {
            const o = c.order;
            const left = Math.max(0, o.due - (world.day || 0));
            html += rowList([actRow({
                icon: '📜', name: esc(o.text), desc: `Progress ${o.progress || 0}/${o.need} · due day ${o.due} (${left} days)`,
                side: `${o.progress || 0}/${o.need}`, tone: left <= 3 ? 'warn' : 'gold',
            })]);
        } else {
            html += `<div style="${NOTE}">No orders. The crown will send more by day ${c.nextOrderDay}.</div>`;
        }

        // ── War ──
        html += sectionHead('War');
        if (!v.enemies.length) {
            html += `<div style="${NOTE}">${esc(c.kingdomName)} is at peace. The host keeps the marches.</div>`;
        } else {
            html += lede(`At war with ${v.enemies.map(e => `<b>${esc(e.name)}</b>`).join(', ')}.`);
            if (c.siege) {
                const sg = c.siege;
                html += card(_bar(sg.progress, 100, '#c96a4a'), {
                    icon: '🏰', title: `Besieging ${esc(sg.name)} (${esc(sg.kingdomName)})`,
                    side: `${sg.garrison} defenders · day ${(world.day || 0) - sg.since} of the siege`,
                });
                html += rowList([
                    _row({ icon: '⚔️', name: 'Storm the walls', side: `${AP.assault} AP`, tone: 'bad' }, 'assault'),
                    _row({ icon: c.siegePolicy === 'sack' ? '🔥' : '🕊️', name: c.siegePolicy === 'sack' ? 'Will sack it' : 'Will spare it', desc: c.siegePolicy === 'sack' ? 'change to spare' : 'change to sack', side: c.siegePolicy }, 'policy', [c.siegePolicy === 'sack' ? 'spare' : 'sack']),
                    _row({ icon: '🏳️', name: 'Lift the siege' }, 'lift'),
                ]);
            } else {
                const warRows = v.front.map(f => _row({
                    icon: '⚔️', name: `Give battle to ${esc(f.name)}'s army`, desc: `≈${f.force} men`,
                    side: `${Math.round(f.odds * 100)}% · ${AP.battle} AP`, tone: f.odds >= 0.5 ? 'good' : 'warn',
                }, 'battle', [f.id]));
                if (v.nearTown) {
                    const n = esc(v.nearTown.name);
                    warRows.push(_row({ icon: '🏰', name: `Besiege ${n} and spare it`, side: `${AP.besiege} AP`, tone: 'gold' }, 'besiege', ['spare']));
                    warRows.push(_row({ icon: '🔥', name: `Besiege ${n} to sack it`, side: `${AP.besiege} AP`, tone: 'bad' }, 'besiege', ['sack']));
                    warRows.push(_row({ icon: '🔥', name: `Raid ${n}`, side: `${AP.raid} AP`, tone: 'bad' }, 'raid'));
                }
                html += rowList(warRows);
                if (!v.front.length) html += `<div style="${NOTE}">March within 3 hexes of the enemy's land to give battle.</div>`;
            }
        }

        // ── The court ──
        html += sectionHead('The court');
        const courtRows = [];
        if (c.rival) {
            const rv = c.rival;
            const traits = (rv.traits || []).map(t => t && t.name).filter(Boolean).join(', ');
            const opinion = Array.isArray(rv.traits) ? Math.round(NPCLords.getLordOpinion(rv, player, world)) : null;
            const of = (t) => Generalship.ofRival(rv, t);
            let rb = `<div style="${NOTE}">${traits ? `${esc(traits)}. ` : ''}${rv.persona ? of(`He ${esc(rv.persona.words)}.`) : ''}${opinion != null ? of(` His opinion of you: ${opinion}.`) : ''}${rv.foiled ? of(` You have foiled him ${rv.foiled} time${rv.foiled > 1 ? 's' : ''}.`) : ''}</div>`;
            const sc = rv.scheme;
            if (sc) {
                const left = Math.max(0, (sc.due || 0) - (world.day || 0));
                rb += `<div style="margin-top:4px;color:#f0b35a;">🕵️ ${of('He')} ${esc(sc.text)} It bites in ${left} day${left === 1 ? '' : 's'} (day ${sc.due})${sc.blunted ? ', blunted by your friends at court' : ''}.</div>`;
            } else if ((rv.quietUntil || -1) > (world.day || 0)) {
                rb += `<div style="font-size:11px;color:#8fd18a;">${of('He holds his tongue')} (bought) until day ${rv.quietUntil}.</div>`;
            }
            html += card(rb, {
                icon: '🗣️', title: `${esc(rv.name)}${rv.house ? ` of ${esc(rv.house)}${rv.estates ? ` (${rv.estates} estate${rv.estates > 1 ? 's' : ''})` : ''}` : ''}`,
                side: `your rival at court, influence ${Math.round(rv.influence)}`, tone: sc ? 'warn' : null,
            });
            const cost = (Generalship.config().court || {}).answerGold || 80;
            courtRows.push(_row({ icon: '🎁', name: 'Answer at court', desc: `${cost}g to the courtiers`, why: `${cost}g to the courtiers — your purse is short`, side: `${cost}g`, tone: gold >= cost ? 'gold' : 'bad' }, 'answer', [], gold >= cost));
            if (sc) {
                const t = 'Lay it bare before the crown: foiled and shamed if you can prove it; you look petty if you cannot.';
                courtRows.push(_row({ icon: '🔎', name: of('Expose his scheme'), desc: t, title: t, side: `${Math.round(Generalship.exposeOdds(player, c) * 100)}% · ${AP.expose} AP`, tone: 'gold' }, 'expose'));
            }
            const price = Generalship.buyOffPrice(c);
            if (price != null) {
                const t = of('He drops his scheme and keeps quiet for a month.');
                courtRows.push(_row({ icon: '💰', name: of('Buy his silence'), desc: `${price}g to his House. ${t}`, why: `${price}g to his House — your purse is short`, title: t, side: `${price}g`, tone: gold >= price ? 'gold' : 'bad' }, 'buyOff', [], gold >= price));
            } else {
                courtRows.push(actRow({ icon: '💰', name: of('Buy his silence'), off: true, why: of(rv.persona && rv.persona.manner === 'proud' ? 'He is too proud to be bought.' : 'He is too honourable to be bought.') }));
            }
        }
        const co = v.coup;
        if (co && co.ok) {
            courtRows.push(_row({
                icon: '👑', name: 'Turn the host on the crown',
                desc: `<span style="color:#e0846a;">Your men would follow you against ${esc(k && k.ruler || 'the crown')}: about ${Math.round(co.chance * 100)}% (${co.rebels} against ${co.loyalists}).${co.betrayers.length ? ` ${co.betrayers.map(esc).join(', ')} might betray you.` : ''}</span>`,
                title: 'Crowned if it works; exiled and hunted if it fails.', side: `${Math.round(co.chance * 100)}%`, tone: 'bad',
            }, 'coup'));
        } else if (co && c.rank >= 2) {
            courtRows.push(actRow({ icon: '👑', name: 'A coup', off: true, why: esc(co.reason) }));
        }
        courtRows.push(_row({ icon: '📜', name: 'Resign your commission' }, 'resign'));
        html += rowList(courtRows);

        // ── Record ──
        const r = c.record;
        html += sectionHead('Record');
        html += `<div style="font-size:11px;">${[
            kv('Battles', `won ${r.battlesWon}, lost ${r.battlesLost}`),
            kv('Towns taken · raids', `${r.townsTaken} · ${r.raids}`),
            kv('Orders', `${r.ordersDone} done, ${r.ordersFailed} failed`),
            kv('The realm\'s battles with you at the front', `${r.realmWon} won, ${r.realmLost} lost`),
            kv('Wages · plunder', `${Math.round(r.wages)}g · ${Math.round(r.plunder)}g`),
        ].join('')}</div>`;
        if (c.log && c.log.length) html += `<div style="font-size:11px;color:#9d937c;margin-top:6px;">${c.log.slice(0, 6).map(e => `Day ${e.day}: ${esc(e.text)}`).join('<br>')}</div>`;
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
        // A coup or a resignation is not undone: asked once more before it is done
        const STAKES = {
            coup: ['👑 Turn the Host on the Crown?', () => {
                const co = Generalship.view(player, world).coup || {};
                return `About ${Math.round((co.chance || 0) * 100)}% that the men follow you and the crown falls. If it fails, half your host is cut down, you are exiled from ${esc((Generalship.state(player) || {}).kingdomName || 'the realm')} and it declares war on you.`;
            }, '👑 Give the word'],
            resign: ['Resign Your Commission?', () => 'You give up your rank, your host and your wages. Reputation −3 with the realm.', 'Resign'],
        };
        if (STAKES[action] && args[args.length - 1] !== 'sure') {
            const [title, text, yes] = STAKES[action];
            game.ui.showCustomPanel(title, `<div style="font-size:12px;">${lede(text())}${rowList([
                _row({ icon: action === 'coup' ? '👑' : '📜', name: yes.replace(/^👑 /, ''), side: 'no going back', tone: 'bad' }, action, [...args, 'sure']),
                { icon: '↩️', name: 'Not now', act: 'showArmyCommand' },
            ])}</div>`);
            return;
        }
        if (args[args.length - 1] === 'sure') args = args.slice(0, -1);
        if (CHOICE[action] && args[args.length - 1] !== 'captains') {
            const [title, blurb] = CHOICE[action];
            game.ui.showCustomPanel(title, rowList([
                _row({ icon: '⚔️', name: 'Take the field — command the host yourself', desc: blurb, tone: 'gold' }, 'field', [action, ...args]),
                _row({ icon: '🎲', name: 'Let the captains fight it', desc: 'Settled at once on the odds.' }, action, [...args, 'captains']),
            ]));
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
