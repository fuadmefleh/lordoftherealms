// ActionMenu — wars between kingdoms: follow them, broker peace, campaign for
// your liege, and fund the restoration of fallen realms. Logic lives in
// player/realmPolitics.js; these panels present it.
import { ActionMenu } from './_ref.js';
import { RealmPolitics, REALM_POLITICS } from './_imports.js';

const BTN = 'padding: 6px 10px; margin: 4px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';

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

        let html = '<div style="font-size:12px;">';

        if (campaign) {
            html += `<div style="${CARD}border-color:rgba(245,197,66,0.4);">`;
            html += `<div style="font-weight:bold;color:var(--gold);">🛡️ Your liege, ${campaign.liege.name}, is at war</div>`;
            html += `<div style="color:var(--text-secondary);margin:4px 0;">Ride out against the enemy (${ActionMenu.REALM_POLITICS_AP.campaign} AP). Each victory pushes your liege toward its war goal, pays ${REALM_POLITICS.campaign.wage}g, and earns you a share of the tribute if your liege wins.</div>`;
            for (const enemy of campaign.enemies) {
                const strength = RealmPolitics.campaignStrength(enemy);
                html += `<button onclick="window._realm.campaign('${enemy.id}')" style="${(player.army || []).length ? BTN_GOLD : BTN_DIM}" ${(player.army || []).length ? '' : 'disabled'}>⚔️ Fight ${enemy.name} (≈${strength} strength)</button>`;
            }
            const merit = Object.entries((player.politics && player.politics.merit) || {})
                .filter(([k]) => k.startsWith(campaign.liege.id + ':'))
                .reduce((sum, [, v]) => sum + v, 0);
            if (merit) html += `<div style="margin-top:6px;color:#8fd88f;">🎖️ Victories this war: ${merit}</div>`;
            html += '</div>';
        }

        if (wars.length === 0) {
            html += '<p style="color:var(--text-secondary);">The realms are at peace — for now.</p>';
        }
        for (const w of wars) {
            const involvesHere = here && (w.a.id === here || w.b.id === here);
            const chance = Math.round(RealmPolitics.brokerChance(player, w) * 100);
            html += `<div style="${CARD}">`;
            html += `<div style="font-weight:bold;">⚔️ ${w.a.name} vs ${w.b.name} <span style="color:var(--text-secondary);font-weight:normal;">· day ${w.days}</span></div>`;
            html += `<div style="margin-top:4px;">${w.a.name} — war goal ${w.aGains}/${w.aGoal} · army ${w.a.military || 0}</div>${_bar(w.aGains, w.aGoal, w.a.color || '#c96')}`;
            html += `<div>${w.b.name} — war goal ${w.bGains}/${w.bGoal} · army ${w.b.military || 0}</div>${_bar(w.bGains, w.bGoal, w.b.color || '#69c')}`;
            if (involvesHere) {
                html += `<button onclick="window._realm.broker('${w.a.id}','${w.b.id}')" style="${BTN_GOLD}">🕊️ Broker peace (${REALM_POLITICS.broker.fee}g, ${ActionMenu.REALM_POLITICS_AP.broker} AP, ~${chance}%)</button>`;
            } else {
                html += `<div style="color:var(--text-secondary);font-size:11px;">Visit a town of either realm to broker peace.</div>`;
            }
            html += '</div>';
        }

        // Forge alliances — envoys work from a town of one of the two crowns
        const alliances = here ? RealmPolitics.allianceCandidates(world, here) : [];
        if (alliances.length) {
            const A = REALM_POLITICS.alliance;
            html += '<h5 style="margin:10px 0 4px;color:#8fd88f;">🤝 Forge an alliance</h5>';
            html += `<div style="color:var(--text-secondary);font-size:11px;">Crowns already on warm terms (${A.minRelations}+) can be bound into an alliance by a persuasive envoy.</div>`;
            for (const p of alliances) {
                const chance = Math.round(RealmPolitics.allianceChance(player, p.a, p.b) * 100);
                html += `<div style="${CARD}">`;
                html += `<div style="font-weight:bold;">${p.a.name} & ${p.b.name} <span style="color:var(--text-secondary);font-weight:normal;">· relations ${Math.round(p.relations)}</span></div>`;
                html += `<button onclick="window._realm.ally('${p.a.id}','${p.b.id}')" style="${player.gold >= A.fee ? BTN_GOLD : BTN_DIM}" ${player.gold >= A.fee ? '' : 'disabled'}>🤝 Broker alliance (${A.fee}g, ${ActionMenu.REALM_POLITICS_AP.alliance} AP, ~${chance}%)</button>`;
                html += '</div>';
            }
        }

        if (truces.length) {
            html += '<h5 style="margin:10px 0 4px;color:#9bc;">🕊️ Truces</h5>';
            for (const t of truces) {
                html += `<div style="color:var(--text-secondary);">${t.a.name} & ${t.b.name} — ${t.daysLeft} days left</div>`;
            }
        }

        const fallen = (world.kingdoms || []).filter(k => !k.isAlive && k.conqueredDay != null);
        if (fallen.length) {
            html += '<h5 style="margin:10px 0 4px;color:#e88;">💀 Fallen realms</h5>';
            for (const k of fallen) {
                const by = k.conqueredBy ? world.getKingdom(k.conqueredBy) : null;
                html += `<div style="color:var(--text-secondary);">${k.name} — conquered by ${by ? by.name : 'unknown'} on day ${k.conqueredDay}. Its old towns may rise again.</div>`;
            }
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
        let html = '<div style="font-size:12px;">';
        html += `<p style="margin-top:0;color:var(--text-secondary);">${tile.settlement.name} once flew the banner of <strong>${t.fallen.name}</strong>, conquered by ${t.occupier.name}. Old loyalists whisper of a rising — they need gold for arms and bribes.</p>`;
        html += `<div style="${CARD}">`;
        html += `<div>💰 Cost: <strong>${t.cost}g</strong></div>`;
        html += `<div>🎲 Chance: <strong>${Math.round(t.chance * 100)}%</strong>${t.unrest ? ' <span style="color:#8fd88f;">(the occupier\'s realm is restless)</span>' : ''}</div>`;
        html += `<div style="color:var(--text-secondary);margin-top:4px;">Success restores ${t.fallen.name} here, at war with ${t.occupier.name}: +${REALM_POLITICS.restoration.renown} renown and +${REALM_POLITICS.restoration.reputationRestored} reputation with the restored crown, ${REALM_POLITICS.restoration.reputationOccupier} with ${t.occupier.name}. Failure loses the gold, and the occupier may learn who paid.</div>`;
        if (sworn) {
            html += `<div style="color:#e88;margin-top:6px;">You are sworn to ${t.occupier.name} — funding rebels would be treason.</div>`;
        } else {
            html += `<button onclick="window._realm.fund()" style="${player.gold >= t.cost ? BTN_GOLD : BTN_DIM}" ${player.gold >= t.cost ? '' : 'disabled'}>🔥 Fund the rising (${t.cost}g)</button>`;
        }
        html += '</div></div>';

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
