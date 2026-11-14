// ActionMenu — wars between kingdoms: follow them, broker peace, campaign for
// your liege, and fund the restoration of fallen realms. Logic lives in
// player/realmPolitics.js; these panels present it.
import { ActionMenu } from './_ref.js';
import { RealmPolitics, REALM_POLITICS, KingdomNavy } from './_imports.js';
import { lede, chips, rowList, card, price, purse, esc } from './uiKit.js';
import { RealmIntel } from '../../systems/realmIntel.js';

/** A realm's army or fleet as the player may know it (systems/realmIntel.js). */
function _force(player, world, k, band, value) {
    const knows = typeof player.knowsAbout !== 'function' || player.knowsAbout(k.id, 'military');
    const s = RealmIntel.seen(player, world, k, 'military', band, value || 0, knows);
    return s.exact ? s.text : s.text === 'unknown' ? 'unknown' : `${s.text} (rumour)`;
}


function _bar(gains, goal, color) {
    const pct = Math.min(100, Math.round((gains / Math.max(1, goal)) * 100));
    return `<div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:2px 0 4px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

function _spendAP(game, cost) {
    if ((game.player.actionPoints || 0) < cost) {
        game.ui.showNotification('⚡ Not Enough Action Points', `This needs ${cost} AP — rest to start a new day.`, 'error');
        return false;
    }
    game.player.actionPoints -= cost;
    return true;
}

Object.assign(ActionMenu, {
    /** AP for each realm-politics deed (taken when the deed is attempted). */
    REALM_POLITICS_AP: { broker: 2, campaign: 2, alliance: 2 },

    showRealmWarsMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const wars = RealmPolitics.activeWars(world);
        const truces = RealmPolitics.truces(world);
        const campaign = RealmPolitics.campaignOptions(player, world);
        const here = tile && tile.settlement ? tile.settlement.kingdom : null;

        const AP = ActionMenu.REALM_POLITICS_AP;
        const gold = player.gold || 0;
        const hasArmy = (player.army || []).length > 0;
        const league = player.coalitions && player.coalitions.active;
        let html = '<div style="font-size:12px;">';
        html += lede(wars.length
            ? `${wars.length === 1 ? 'A war burns' : `${wars.length} wars burn`} between the realms. Broker peace from a town of either side, fight for your liege, or bind friendly crowns together.`
            : 'The realms are at peace — for now.');
        html += chips([['⚔️', 'Wars', wars.length], ['🕊️', 'Truces', truces.length], purse(gold)]);
        html += rowList([
            { icon: '⚜️', name: 'Threats', desc: league ? `${esc(league.name)} is sworn against you` : 'How the realms regard you', act: 'showThreatsPanel', side: '›', tone: league ? 'bad' : '' },
            { icon: '🎖️', name: 'Army Command', desc: player.commission ? `Your host in the army of ${esc(player.commission.kingdomName)}` : 'Serve in a realm\'s army', act: 'showArmyCommand', side: '›' },
        ]);

        if (campaign) {
            const merit = Object.entries((player.politics && player.politics.merit) || {})
                .filter(([k]) => k.startsWith(campaign.liege.id + ':'))
                .reduce((sum, [, v]) => sum + v, 0);
            const rows = campaign.enemies.map(enemy => ({
                icon: '⚔️', name: `Ride against ${esc(enemy.name)}`,
                desc: `Their strength ≈${RealmPolitics.campaignStrength(enemy)} · up to ${REALM_POLITICS.campaign.wage}g a victory`,
                side: `${AP.campaign} AP`, off: !hasArmy, why: 'You have no army to ride with',
                attrs: `onclick="window._realm.campaign('${enemy.id}')"`,
            }));
            const serving = player.politics && player.politics.fleetService;
            const fleet = RealmPolitics.fleetServiceOptions(player, world);
            const liegeNavy = campaign.liege.navy;
            if (serving) {
                rows.push({ icon: '⛵', name: 'Recall your galleys', desc: `They sail with the fleet (+${RealmPolitics.fleetContribution(player)} strength, ${KingdomNavy.CONFIG.liegeService.wagePerGalley}g a day each) and escort none of your ships meanwhile`, attrs: 'onclick="window._realm.recallFleet()"' });
            } else if (fleet && liegeNavy && liegeNavy.ports) {
                rows.push({ icon: '⚓', name: 'Send your galleys to the fleet', desc: `Your ${fleet.galleys} galley${fleet.galleys === 1 ? '' : 's'} add ${fleet.contribution} to a fleet of ${liegeNavy.strength}; sea victories count as merit`, attrs: 'onclick="window._realm.lendFleet()"' });
            }
            html += card(`<div style="color:#cfc3a5; margin-bottom:4px;">Each victory pushes your liege toward the war goal and earns you a share of the tribute if your liege wins.</div>${rowList(rows)}`, {
                icon: '🛡️', title: `Your liege, ${esc(campaign.liege.name)}, is at war`, side: merit ? `🎖️ ${merit} won` : '', tone: 'gold',
            });
        }

        const navyLine = (k, foe) => {
            const n = k.navy;
            if (!n || !(n.ports || n.strength)) return `${esc(k.name)}: no fleet`;
            const held = n.blockades && n.blockades[foe.id] != null;
            return `${esc(k.name)}: fleet ${_force(player, world, k, 'fleet', n.strength)}${held ? ' <span style="color:#e67e22;">(ports blockaded)</span>' : ''}`;
        };
        for (const w of wars) {
            const involvesHere = here && (w.a.id === here || w.b.id === here);
            const chance = Math.round(RealmPolitics.brokerChance(player, w) * 100);
            const fee = REALM_POLITICS.broker.fee;
            let body = `<div>${esc(w.a.name)} — war goal ${w.aGains}/${w.aGoal} · army ${_force(player, world, w.a, 'military', w.a.military)}</div>${_bar(w.aGains, w.aGoal, w.a.color || '#c96')}`;
            body += `<div>${esc(w.b.name)} — war goal ${w.bGains}/${w.bGoal} · army ${_force(player, world, w.b, 'military', w.b.military)}</div>${_bar(w.bGains, w.bGoal, w.b.color || '#69c')}`;
            body += `<div style="color:#9d937c; font-size:11px;">⚓ ${navyLine(w.a, w.b)} · ${navyLine(w.b, w.a)}</div>`;
            body += rowList([{
                icon: '🕊️', name: 'Broker peace', desc: `~${chance}% they agree · ${AP.broker} AP`, side: price(fee, gold >= fee),
                off: !involvesHere, why: 'Go to a town of either realm to broker peace',
                attrs: `onclick="window._realm.broker('${w.a.id}','${w.b.id}')"`,
            }]);
            html += card(body, { icon: '⚔️', title: `${esc(w.a.name)} vs ${esc(w.b.name)}`, side: `day ${w.days}` });
        }

        // Forge alliances — envoys work from a town of one of the two crowns
        const alliances = here ? RealmPolitics.allianceCandidates(world, here) : [];
        if (alliances.length) {
            const A = REALM_POLITICS.alliance;
            html += rowList(alliances.map(pr => ({
                icon: '🤝', name: `${esc(pr.a.name)} & ${esc(pr.b.name)}`,
                desc: `Relations ${Math.round(pr.relations)} · ~${Math.round(RealmPolitics.allianceChance(player, pr.a, pr.b) * 100)}% an envoy binds them · ${AP.alliance} AP`,
                side: price(A.fee, gold >= A.fee), off: gold < A.fee, why: `Needs ${A.fee}g for the envoys`,
                attrs: `onclick="window._realm.ally('${pr.a.id}','${pr.b.id}')"`,
            })), `Forge an alliance (crowns on warm terms, ${A.minRelations}+)`);
        }

        if (truces.length) {
            html += rowList(truces.map(t => ({ icon: '🕊️', name: `${esc(t.a.name)} & ${esc(t.b.name)}`, side: `${t.daysLeft} days left` })), 'Truces');
        }

        const fallen = (world.kingdoms || []).filter(k => !k.isAlive && k.conqueredDay != null);
        if (fallen.length) {
            html += rowList(fallen.map(k => {
                const by = k.conqueredBy ? world.getKingdom(k.conqueredBy) : null;
                return { icon: '💀', name: esc(k.name), desc: `Conquered by ${by ? esc(by.name) : 'unknown'} · its old towns may rise again`, side: `day ${k.conqueredDay}` };
            }), 'Fallen realms');
        }
        html += '</div>';

        game.ui.showCustomPanel('⚔️ Wars of the Realm', html);
        const reopen = () => ActionMenu.showRealmWarsMenu(game, tile);
        window._realm = {
            broker: (aId, bId) => {
                if (!_spendAP(game, ActionMenu.REALM_POLITICS_AP.broker)) return;
                const res = RealmPolitics.brokerPeace(player, world, aId, bId);
                ActionMenu._realmResult(game, '🕊️ Mediation', res, reopen);
            },
            ally: (aId, bId) => {
                if (!_spendAP(game, ActionMenu.REALM_POLITICS_AP.alliance)) return;
                const res = RealmPolitics.brokerAlliance(player, world, aId, bId);
                ActionMenu._realmResult(game, '🤝 Alliance', res, reopen);
            },
            lendFleet: () => ActionMenu._realmResult(game, '⚓ Fleet Service', RealmPolitics.lendGalleys(player, world), reopen),
            recallFleet: () => ActionMenu._realmResult(game, '⚓ Fleet Service', RealmPolitics.recallGalleys(player, world), reopen),
            campaign: (enemyId) => {
                if (!_spendAP(game, ActionMenu.REALM_POLITICS_AP.campaign)) return;
                const battleTile = world.getTile(player.q, player.r);
                const res = RealmPolitics.joinCampaign(player, world, enemyId, { terrainId: battleTile && battleTile.terrain && battleTile.terrain.id });
                if (res.battle && res.battle.casualties && res.battle.casualties.length) {
                    res.message = `${res.message || ''} You lost ${res.battle.casualties.length} soldier(s).`;
                }
                ActionMenu._realmResult(game, '⚔️ Campaign', res, reopen);
            },
        };
    },

    showRestorationMenu(game, tile) {
        const player = game.player;
        const t = RealmPolitics.restorationTarget(player, game.world, tile);
        if (!t) {
            game.ui.showNotification('🔥 Restoration', 'No fallen crown has a claim here.', 'info');
            return;
        }
        const sworn = player.allegiance === t.occupier.id;
        const R = REALM_POLITICS.restoration;
        const gold = player.gold || 0;
        let html = '<div style="font-size:12px;">';
        html += lede(`${esc(tile.settlement.name)} once flew the banner of <b>${esc(t.fallen.name)}</b>, conquered by ${esc(t.occupier.name)}. Old loyalists whisper of a rising; they need gold for arms and bribes.`);
        html += chips([
            ['🎲', 'Chance', `${Math.round(t.chance * 100)}%`, t.unrest ? 'gold' : ''],
            t.unrest ? ['🔥', 'The occupier is restless', ''] : null,
            purse(gold),
        ]);
        html += rowList([{
            icon: '🔥', name: 'Fund the rising',
            desc: `Success restores ${esc(t.fallen.name)} here, at war with ${esc(t.occupier.name)}: +${R.renown} renown, +${R.reputationRestored} with the restored crown, ${R.reputationOccupier} with the occupier. Failure loses the gold, and the occupier may learn who paid.`,
            side: price(t.cost, gold >= t.cost),
            off: sworn || gold < t.cost,
            why: sworn ? `You are sworn to ${esc(t.occupier.name)}: funding rebels would be treason` : `Needs ${t.cost}g`,
            attrs: 'onclick="window._realm.fund()"',
        }]);
        html += '</div>';

        game.ui.showCustomPanel(`🔥 Restore ${t.fallen.name}`, html);
        window._realm = {
            fund: () => {
                if (!ActionMenu.commitPendingAP(game)) return;
                const res = RealmPolitics.fundRestoration(player, game.world, tile);
                ActionMenu._realmResult(game, '🔥 Restoration', res, null);
                if (res.success) game.ui.hideCustomPanel();
            },
        };
    },

    _realmResult(game, title, res, reopen) {
        if (!res.success) game.ui.showNotification(title, res.reason, 'error');
        else game.ui.showNotification(title, res.message, res.failed ? 'warning' : 'success');
        game.ui.updateStats(game.player, game.world);
        if (res.success && reopen) reopen();
    },
});
