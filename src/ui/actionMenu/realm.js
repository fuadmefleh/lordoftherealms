// ActionMenu — realm methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { Duels } from '../../systems/duels.js';
import { DuelPanel } from './duel.js';
import { DevotionPanel } from './devotion.js';
import { FeastPanel } from './feast.js';
import { BTN_GOLD, BTN_DARK, esc } from './uiKit.js';
import { Throne, PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, Festivals, PlayerEffects, Rivals } from './_imports.js';

const BOUT_NAMES = ['Opening bout', 'Semi-final', 'The final'];

/**
 * The lists: a three-bout bracket on the duel engine (systems/duels.js) —
 * named rivals nearby take places in the field, knights fill the rest. Each
 * bout is fought in the duel panel (or on instinct); the bracket ends at the
 * first loss, and Duels.settleTournament pays out prize, renown and harm.
 */
function _runTournament(game, tile, settlement, prizePool, baseRenown) {
    const player = game.player;
    const world = game.world;
    const mods = PlayerEffects.duelModifiers(player);
    const rivals = Rivals.entrantsNear(player, world, tile, 2);
    const entrants = rivals.map(r => Duels.fromRival(r, { archetype: Rivals.archetype(r.archetype) }));
    const field = Duels.tournamentField(settlement, entrants);
    const bouts = [];
    let me = Duels.fromPlayer(player, { mods });
    const armour = me.armour;
    const T = Duels.config().tournament;

    const nextFighter = () => {
        // Between bouts you get some wind and a little of your strength back
        const fresh = Duels.fromPlayer(player, { mods });
        const lost = me.maxHp - me.hp;
        fresh.hp = Math.max(1, Math.min(fresh.maxHp, Math.round(me.hp + lost * (T.boutRecovery || 0.5))));
        return fresh;
    };

    const record = (opp, result) => {
        bouts.push({ opponent: opp, result });
        if (opp.kind === 'rival' && opp.ref) Rivals.recordBout(player, world, opp.ref.id, result.playerWon);
        me = result.a;
    };

    const finish = () => {
        const out = Duels.settleTournament(player, { prizePool, bouts, armour, world });
        let h = '<div>';
        h += '<h4 style="margin-top: 0;">⚔️ Tournament Results</h4>';
        bouts.forEach((b, i) => {
            const r = b.result;
            const how = r.yielded === 'b' ? ' (they yielded)' : r.yielded === 'a' ? ' (you yielded)' : '';
            h += r.playerWon
                ? `<div style="color: #8f8;">✓ ${BOUT_NAMES[i]}: defeated ${esc(b.opponent.name)}${how}</div>`
                : `<div style="color: #f88;">✗ ${BOUT_NAMES[i]}: lost to ${esc(b.opponent.name)}${how}</div>`;
        });
        for (const w of out.wounds) h += `<div style="color: #e57373; margin-left: 12px;">${w.icon} ${esc(w.name)} (${esc(w.text)})</div>`;
        if (out.champion) {
            h += `<div style="color: var(--gold); font-weight: bold; margin-top: 8px;">🏆 GRAND CHAMPION! Won ${out.gold} gold! +${baseRenown + out.renown} total renown!</div>`;
        } else if (out.finalist) {
            h += `<div style="color: #ccc; margin-top: 8px;">🥈 Runner-up! Won ${out.gold} gold. +${baseRenown + out.renown} renown.</div>`;
        } else {
            h += `<div style="color: #888; margin-top: 8px;">Eliminated${out.wins ? ' in the semi-final' : ' in the opening bout'}. +${baseRenown + out.renown} renown for competing.</div>`;
        }
        if (out.skillUp) h += '<div style="color: #88f; margin-top: 4px;">Combat skill improved!</div>';
        if (out.harm > 0) h += `<div style="color: #f88; margin-top: 4px;">Bruises and cuts: -${out.harm} HP</div>`;
        h += `<button data-am-act="closePanelAndEndDay" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
        h += '</div>';
        game.ui.showCustomPanel('Tournament Results', h);
        game.ui.updateStats(player, world);
    };

    const afterBout = (opp, result) => {
        record(opp, result);
        if (!result.playerWon || bouts.length >= field.length) return finish();
        interlude();
    };

    const fight = () => {
        const i = bouts.length;
        const opp = field[i];
        DuelPanel.open(game, {
            a: i === 0 ? me : nextFighter(),
            b: opp,
            mode: 'tournament',
            title: `⚔️ ${BOUT_NAMES[i]}`,
            intro: `${settlement.name}'s lists — ${esc(opp.title || '')} ${esc(opp.name)}. Blunted steel; a fighter may yield.`,
            onFinish: (r) => afterBout(opp, r),
        });
    };

    const autoAll = () => {
        while (bouts.length < field.length) {
            const i = bouts.length;
            const opp = field[i];
            const r = Duels.autoResolve(i === 0 ? me : nextFighter(), opp, { mode: 'tournament', playerYieldAt: 0.15 });
            record(opp, r);
            if (!r.playerWon) break;
        }
        finish();
    };

    const interlude = () => {
        const i = bouts.length;
        let h = '<div>';
        h += `<h4 style="margin-top: 0;">🏟️ The Lists at ${esc(settlement.name)}</h4>`;
        if (i > 0) {
            const last = bouts[i - 1];
            h += `<div style="color: #8f8; margin-bottom: 6px;">✓ You beat ${esc(last.opponent.name)}.</div>`;
        }
        h += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">The bracket:</div>`;
        field.forEach((o, k) => {
            const T2 = Duels.temperament(o.temperament);
            const mark = k < i ? '✓' : k === i ? '▶' : '·';
            h += `<div style="font-size: 12px; ${k === i ? 'color: var(--gold);' : k < i ? 'color: #8f8;' : 'color: #ccc;'}">${mark} ${BOUT_NAMES[k]}: ${o.icon} ${esc(o.name)} <span style="color: var(--text-muted); font-size: 10px;">${esc(o.title || '')} · ${T2.icon || ''} ${esc(T2.label || '')}</span></div>`;
        });
        h += `<div style="font-size: 11px; color: var(--text-muted); margin: 6px 0;">🏆 Champion takes ${prizePool} gold; the runner-up ${Math.floor(prizePool * (T.runnerUpShare || 0.4))}.</div>`;
        h += `<button onclick="window._tourney.fight()" style="${BTN_GOLD} width: 100%; padding: 9px;">⚔️ Fight the ${BOUT_NAMES[i].toLowerCase()}</button>`;
        h += `<button onclick="window._tourney.auto()" style="${BTN_DARK} width: 100%; padding: 7px;">⚡ Fight the rest on instinct</button>`;
        h += '</div>';
        game.ui.showCustomPanel('Tournament', h);
    };

    window._tourney = { fight, auto: autoAll };
    interlude();
}

Object.assign(ActionMenu, {
    // ============================================
    // NEW ACTIONS — Donate, Allegiance, Feast, Tournament
    //               Pickpocket, Smuggle, Train, Meditate
    //               Fish, Prospect, Tame Horse, Campfire
    // ============================================
    /**
     * Alms: choose who receives it — the temple, the poor, a guild you belong
     * to, a named townsperson in need (systems/devotion.js; ui/actionMenu/devotion.js)
     */
    showDonateMenu(game, tile) {
        DevotionPanel.showDonate(game, tile);
    },

    /**
     * Pledge allegiance to the kingdom controlling this settlement
     */
    doPledgeAllegiance(game, tile) {
        const settlement = tile.settlement;
        if (!settlement || !settlement.kingdom) {
            game.ui.showNotification('No Kingdom', 'This settlement has no kingdom to pledge to.', 'error');
            return;
        }

        const oldAllegiance = game.player.allegiance;
        const result = game.player.pledgeAllegiance(settlement.kingdom, game.world);
        if (result.success) {
            const kingdom = result.kingdom;
            // Reputation bonus on pledge
            if (game.player.reputation) {
                game.player.reputation[settlement.kingdom] = (game.player.reputation[settlement.kingdom] || 0) + 5;
            }
            // Deserting another crown costs standing there (softened by Diplomacy Mastery)
            let desertion = '';
            if (oldAllegiance && oldAllegiance !== settlement.kingdom && game.player.reputation) {
                const penalty = Math.round(15 * Technology.getAllianceCostMultiplier(game.player));
                game.player.reputation[oldAllegiance] = (game.player.reputation[oldAllegiance] || 0) - penalty;
                const old = game.world.getKingdom(oldAllegiance);
                desertion = ` ${old ? old.name : 'Your former realm'} resents the desertion (−${penalty} reputation).`;
            }
            game.ui.showNotification('⚔️ Allegiance Pledged',
                `You have sworn allegiance to ${kingdom.name}. You are now a citizen of the realm. +5 reputation.${desertion}`, 'success');
            game.ui.updateStats(game.player, game.world);
        } else {
            game.ui.showNotification('Cannot Pledge', result.reason, 'error');
        }
    },

    /**
     * Renounce allegiance to current kingdom
     */
    doRenounceAllegiance(game, tile) {
        const player = game.player;
        if (!player.allegiance) {
            game.ui.showNotification('No Allegiance', 'You aren\'t pledged to any kingdom.', 'error');
            return;
        }

        const oldKingdomId = player.allegiance;
        const result = player.breakAllegiance(game.world);

        if (result.success) {
            // Reputation penalty
            if (player.reputation && oldKingdomId) {
                player.reputation[oldKingdomId] = (player.reputation[oldKingdomId] || 0) - 15;
            }
            // Karma hit
            player.karma = (player.karma || 0) - 3;

            const name = result.oldKingdom ? result.oldKingdom.name : 'your kingdom';
            game.ui.showNotification('💔 Allegiance Broken',
                `You have renounced your allegiance to ${name}. -15 reputation, -3 karma. You are once again a free wanderer.`, 'warning');
            game.ui.updateStats(player, game.world);
        } else {
            game.ui.showNotification('Error', result.reason, 'error');
        }
    },

    _getPlayerSettlementTiles(player, world) {
        const settlements = [];
        const seen = new Set();

        const addSettlement = (q, r) => {
            const key = `${q},${r}`;
            if (seen.has(key)) return;

            const tile = world.getTile(q, r);
            if (!tile || !tile.settlement) return;

            const listedInColonies = (player.colonies || []).some(c => c.q === q && c.r === r);
            const markedPlayerColony = !!tile.settlement.colony?.isPlayerColony;
            if (!listedInColonies && !markedPlayerColony) return;

            seen.add(key);
            settlements.push({ q, r, tile, settlement: tile.settlement });
        };

        for (const colony of (player.colonies || [])) {
            addSettlement(colony.q, colony.r);
        }

        const allSettlements = world.getAllSettlements();
        for (const settlement of allSettlements) {
            const settlementTile = world.getTile(settlement.q, settlement.r);
            if (settlementTile?.settlement?.colony?.isPlayerColony) {
                addSettlement(settlement.q, settlement.r);
            }
        }

        return settlements;
    },

    showFormKingdomMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const controlledSettlements = ActionMenu._getPlayerSettlementTiles(player, world);
        const activeSettlement = controlledSettlements.find(s => s.q === tile.q && s.r === tile.r) || controlledSettlements[0];
        const suggestedName = `Kingdom of ${activeSettlement?.settlement?.name || 'New Dawn'}`;

        const status = Throne.foundingStatus(player, world);
        const blocked = status.ok ? '' : `<p style="font-size: 12px; color: #ff6666; margin: 0 0 10px;">${status.reasons.join(' ')}</p>`;
        let html = `
            <div>
                <h4 style="margin: 0 0 10px;">👑 Proclaim a New Kingdom</h4>
                ${blocked}
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 10px;">Costs ${status.cost} Prestige. You will rule it: set its taxes, war stance and faith, and conduct its diplomacy from Claims & Crowns.</p>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 10px;">
                    You will unite <b>${controlledSettlements.length}</b> settlements under a new crown.
                </p>
                <p style="font-size: 12px; margin: 0 0 6px;"><b>Kingdom Name</b></p>
                <input id="newKingdomNameInput" type="text" maxlength="48" value="${suggestedName.replace(/"/g, '&quot;')}"
                    style="width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid #555; background: #222; color: #fff; margin-bottom: 10px;" />
                <div style="display:flex; gap:8px;">
                    <button onclick="window._confirmFormKingdom()"
                        style="flex:1; padding: 10px; background: #c89b3c; border: none; border-radius: 6px; color: #111; font-weight: 700; cursor: pointer;">
                        Found Kingdom
                    </button>
                    <button data-am-act="closePanel"
                        style="padding: 10px 12px; background: #444; border: none; border-radius: 6px; color: #ddd; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        game.ui.showCustomPanel('Form Kingdom', html);

        window._confirmFormKingdom = () => {
            const chosenName = document.getElementById('newKingdomNameInput')?.value || '';
            if (!ActionMenu.commitPendingAP(game)) return;
            game.ui.hideCustomPanel();
            ActionMenu.doFormKingdom(game, tile, chosenName);
        };
    },

    doFormKingdom(game, tile, customName) {
        // The founding itself lives in systems/throne.js (a real kingdom the
        // simulation treats normally, with a court, faith and fleet)
        const res = Throne.foundKingdom(game.player, game.world, { name: customName, seat: tile ? { q: tile.q, r: tile.r } : null });
        if (!res.success) {
            game.ui.showNotification('Cannot Form Kingdom', res.reason, 'error');
            return;
        }
        game.ui.showNotification('👑 Kingdom Founded', res.message, 'success');
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Host a feast: plan guests, menu and entertainment (systems/feasts.js; ui/actionMenu/feast.js)
     */
    showHostFeastMenu(game, tile) {
        if (!tile || !tile.settlement) return;
        FeastPanel.show(game, tile);
    },

    /**
     * Hold a tournament — combat competition for gold and renown
     */
    showTournamentMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const entryFee = settlement.type === 'capital' ? 300 : 200;
        // The champion takes three times the fee; the lists are called once a
        // season-tenth (TOURNAMENT_COOLDOWN days), not every day (docs/economy-balance.md)
        const prizePool = entryFee * 3;
        const TOURNAMENT_COOLDOWN = 10;
        const day = (game.world && game.world.day) || 0;
        const sinceLast = typeof player.lastTournamentDay === 'number' ? day - player.lastTournamentDay : Infinity;
        const cooling = sinceLast < TOURNAMENT_COOLDOWN ? TOURNAMENT_COOLDOWN - sinceLast : 0;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">⚔️ Hold a Tournament</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Organize a fighting tournament in ${settlement.name}! Champions from across the land will compete.</p>`;
        html += `<div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px;">`;
        html += `<div>💰 Entry/Organization cost: <span style="color: var(--gold);">${entryFee} gold</span></div>`;
        html += `<div>🏆 Prize pool: <span style="color: var(--gold);">${prizePool} gold</span></div>`;
        html += `<div>⚔️ Your combat skill: ${Math.round((player.skills?.combat || 1) * 10) / 10} | Strength: ${Math.round((player.strength || 5) * 10) / 10}</div>`;
        html += `<div>⏰ Takes the rest of the day</div>`;
        html += `</div>`;
        html += `<p style="font-size: 11px; color: #aaa;">You may compete yourself, or simply host and watch.</p>`;

        if (cooling > 0) {
            html += `<p style="color: #ff6666; font-size: 12px;">The knights are still mending from your last tournament. Call the lists again in ${cooling} day${cooling === 1 ? '' : 's'}.</p>`;
        } else if (player.gold >= entryFee) {
            html += `<button onclick="window._doTournament(true)" style="width: 100%; padding: 10px; background: #c97d32; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 6px;">Compete (${entryFee}g)</button>`;
            html += `<button onclick="window._doTournament(false)" style="width: 100%; padding: 8px; background: #555; border: none; border-radius: 4px; cursor: pointer; color: #ccc;">Just Host & Spectate (${Math.floor(entryFee * 0.6)}g)</button>`;
        } else {
            html += `<p style="color: #ff6666; font-size: 12px;">You need ${entryFee} gold to organize a tournament.</p>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('Tournament', html);

        window._doTournament = (compete) => {
            if (cooling > 0) return;
            if (!ActionMenu.commitPendingAP(game)) return;
            const cost = compete ? entryFee : Math.floor(entryFee * 0.6);
            if (player.gold < cost) {
                game.ui.showNotification('Not Enough Gold', 'You can\'t afford to host this!', 'error');
                return;
            }

            player.gold -= cost;
            player.lastTournamentDay = day;
            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.tournament = (player.financeToday.expenses.tournament || 0) + cost;
            }

            let resultHtml = '<div>';
            const renownGain = compete ? 5 : 3;
            player.renown = (player.renown || 0) + renownGain;

            if (compete) {
                _runTournament(game, tile, settlement, prizePool, renownGain);
                return;
            } else {
                // Just hosting
                resultHtml += '<h4 style="margin-top: 0;">🏟️ Tournament Hosted</h4>';
                resultHtml += `<div>The tournament was a great success! The crowd cheered and the fighters put on a great show.</div>`;
                resultHtml += `<div style="color: var(--gold); margin-top: 8px;">+${renownGain} renown for hosting.</div>`;

                // Hosting chance for diplomacy
                if (Math.random() < 0.25 && player.skills) {
                    player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                    resultHtml += `<div style="color: #88f; margin-top: 4px;">Diplomacy improved from managing the event!</div>`;
                }
            }

            resultHtml += `<button data-am-act="closePanelAndEndDay" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            resultHtml += '</div>';

            game.ui.showCustomPanel('Tournament Results', resultHtml);
            game.ui.updateStats(player, game.world);
        };
    },

    showFestivalMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        if (typeof Festivals === 'undefined') {
            game.ui.showNotification('Unavailable', 'Festival system is unavailable.', 'error');
            return;
        }

        Festivals.initialize(player);
        const gate = Festivals.canHostFestival(player, game.world, tile);
        if (!gate.ok) {
            game.ui.showNotification('Cannot Host Festival', gate.reason, 'warning');
            return;
        }

        let selectedTier = 'modest';
        let selectedStance = 'diplomatic';
        const theme = Festivals.getSeasonTheme(game.world);
        let selectedContest = theme.recommendedContest;

        const render = () => {
            const options = Festivals.getBudgetOptions();
            const currentTier = options.find(o => o.id === selectedTier) || options[0];
            const canAfford = (player.gold || 0) >= currentTier.cost;

            let html = '<div style="max-width: 580px;">';
            html += `<h4 style="margin-top: 0;">${theme.icon} ${theme.name}</h4>`;
            html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">${game.world.season} festival season in ${settlement.name}. Recommended contest: <strong>${Festivals.CONTESTS[theme.recommendedContest].label}</strong>.</div>`;
            {
                const fame = Festivals.getReputation(player);
                const fs = player.festivals;
                const novelty = Festivals.noveltyMultiplier(player, settlement.name);
                const perks = [];
                if (fame.hostBonus) perks.push(`+${fame.hostBonus} renown`);
                if (fame.extraEnvoys) perks.push(`+${fame.extraEnvoys} envoy${fame.extraEnvoys > 1 ? 's' : ''}`);
                if (fame.contestVeteran) perks.push(`+${fame.contestVeteran.toFixed(1)} contest power`);
                if (fame.vigilance) perks.push(`−${Math.round(fame.vigilance * 100)}% sabotage`);
                if (fame.envoyGoodwill) perks.push(`+${fame.envoyGoodwill} envoy goodwill`);
                html += `<div style="font-size: 11px; color: #c9b27a; margin-bottom: 10px;">🎪 Record: ${fs.hosted} hosted · ${fs.successfulContests} podiums · ${fs.diplomacyEvents} envoys feted${perks.length ? ` — ${perks.join(', ')}` : ''}${novelty < 1 ? `<br><span style="color:#e67e22;">${settlement.name} has seen your festivals lately: renown ×${novelty.toFixed(1)}. Try another town.</span>` : ''}</div>`;
            }

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin-bottom: 6px;">Festival Scale</div>';
            for (const option of options) {
                const active = selectedTier === option.id;
                html += `
                    <button onclick="window._setFestivalTier('${option.id}')" style="width: 100%; text-align: left; margin-bottom: 6px; padding: 9px; border-radius: 6px; border: 1px solid ${active ? 'rgba(245,197,66,0.65)' : 'rgba(255,255,255,0.12)'}; background: ${active ? 'rgba(245,197,66,0.12)' : 'rgba(255,255,255,0.04)'}; color: #ddd; cursor: pointer;">
                        <div style="display:flex; justify-content: space-between;"><strong>${option.label}</strong><span style="color: var(--gold);">${option.cost}g</span></div>
                        <div style="font-size: 11px; color:#aaa; margin-top: 3px;">+${option.renown} base renown · +${Math.round(option.morale * 100)}% morale for ${option.moraleDays} days</div>
                    </button>
                `;
            }

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 6px;">Guest Policy</div>';
            const diplomaticActive = selectedStance === 'diplomatic';
            const securityActive = selectedStance === 'security';
            html += `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">
                    <button onclick="window._setFestivalStance('diplomatic')" style="padding: 8px; border-radius: 6px; border: 1px solid ${diplomaticActive ? 'rgba(52,152,219,0.7)' : 'rgba(255,255,255,0.12)'}; background: ${diplomaticActive ? 'rgba(52,152,219,0.2)' : 'rgba(255,255,255,0.04)'}; color:#dce8f5; cursor:pointer;">
                        🤝 Diplomatic Reception
                    </button>
                    <button onclick="window._setFestivalStance('security')" style="padding: 8px; border-radius: 6px; border: 1px solid ${securityActive ? 'rgba(231,76,60,0.7)' : 'rgba(255,255,255,0.12)'}; background: ${securityActive ? 'rgba(231,76,60,0.2)' : 'rgba(255,255,255,0.04)'}; color:#f5dfdf; cursor:pointer;">
                        🛡️ Tight Security
                    </button>
                </div>
            `;

            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 6px;">Seasonal Contest</div>';
            for (const contest of Object.values(Festivals.CONTESTS)) {
                const active = selectedContest === contest.id;
                const recommended = theme.recommendedContest === contest.id;
                html += `
                    <button onclick="window._setFestivalContest('${contest.id}')" style="width: 100%; text-align: left; margin-bottom: 6px; padding: 8px; border-radius: 6px; border: 1px solid ${active ? 'rgba(46,204,113,0.65)' : 'rgba(255,255,255,0.12)'}; background: ${active ? 'rgba(46,204,113,0.16)' : 'rgba(255,255,255,0.04)'}; color:#ddd; cursor:pointer;">
                        ${contest.icon} <strong>${contest.label}</strong> ${recommended ? '<span style="font-size:10px; color:#2ecc71;">(Season Favored)</span>' : ''}
                    </button>
                `;
            }

            html += `<div style="font-size: 12px; color: ${canAfford ? '#bbb' : '#ff7878'}; margin: 8px 0;">Cost: ${currentTier.cost} gold · Your gold: ${Math.floor(player.gold)}</div>`;
            html += `<button onclick="window._beginFestival()" ${!canAfford ? 'disabled' : ''} style="width: 100%; padding: 10px; background: var(--gold); border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Begin Festival</button>`;
            html += '</div>';

            game.ui.showCustomPanel('Festival Planning', html);
        };

        window._setFestivalTier = (tierId) => { selectedTier = tierId; render(); };
        window._setFestivalStance = (stance) => { selectedStance = stance; render(); };
        window._setFestivalContest = (contest) => { selectedContest = contest; render(); };

        const finalizeFestival = (contestScore) => {
            const result = Festivals.hostFestival(player, game.world, tile, {
                tier: selectedTier,
                stance: selectedStance,
                contest: selectedContest,
                contestScore,
            });

            if (!result.success) {
                game.ui.showNotification('Festival Failed', result.reason, 'error');
                render();
                return;
            }

            if (player.financeToday) {
                player.financeToday.expenses = player.financeToday.expenses || {};
                player.financeToday.expenses.festival = (player.financeToday.expenses.festival || 0) + result.tier.cost;
                if (result.contestPrize > 0) {
                    player.financeToday.income = player.financeToday.income || {};
                    player.financeToday.income.festival = (player.financeToday.income.festival || 0) + result.contestPrize;
                }
            }

            let summary = '<div style="max-width: 560px;">';
            summary += `<h4 style="margin-top: 0;">${result.seasonTheme.icon} Festival Completed</h4>`;
            summary += `<div style="margin-bottom: 8px;">${result.contestResult.text}</div>`;
            summary += `<div style="font-size: 12px; color: #ddd; margin-bottom: 8px;">+${result.renownGain} renown · Morale boost ${Math.round(result.moraleBoost * 100)}% for ${result.moraleDays} days</div>`;
            summary += `<div style="font-size: 11px; color: #aaa; margin-bottom: 10px;">Contest prize: ${result.contestPrize}g</div>`;
            const lc = result.localCustoms;
            if (lc && (lc.custom || lc.sentimentGain)) {
                summary += `<div style="font-size: 12px; color: #c5e1a5; margin-bottom: 10px;">🎊 ${lc.custom ? `The locals fold in their ${lc.custom}` : 'The local peoples join in'}${lc.renownBonus ? ` (+${lc.renownBonus} renown)` : ''} · every people here +${lc.sentimentGain} mood</div>`;
            }

            // Rival adventurers nearby enter the contest by name (systems/rivals.js)
            const rivalRows = Rivals.festivalContest(player, game.world, tile, result.contestResult.tier, result.contest && result.contest.id);
            if (rivalRows.length > 0) {
                summary += '<div style="font-size: 11px; text-transform: uppercase; color: var(--gold); letter-spacing: 1px; margin-bottom: 4px;">Rival Contestants</div>';
                for (const row of rivalRows) {
                    summary += row.beatPlayer
                        ? `<div style="font-size: 12px; color:#f0b7aa;">${row.icon} ${row.name} outshone you in the ${row.contest}.</div>`
                        : `<div style="font-size: 12px; color:#c5e1a5;">${row.icon} You bested ${row.name} in the ${row.contest} (+1 renown).</div>`;
                }
            }

            if (result.reputations.length > 0) {
                summary += '<div style="font-size: 11px; text-transform: uppercase; color: #3498db; letter-spacing: 1px; margin-bottom: 4px;">Diplomatic Outcomes</div>';
                for (const row of result.reputations) {
                    summary += `<div style="font-size: 12px; color:#b8d9f5;">🤝 ${row.rival}: +${row.repGain} reputation${row.relationGain ? `, +${row.relationGain} relations with your realm` : ''}</div>`;
                }
            }

            if (result.sabotage.length > 0) {
                summary += '<div style="font-size: 11px; text-transform: uppercase; color: #e67e22; letter-spacing: 1px; margin: 8px 0 4px;">Sabotage Attempts</div>';
                for (const row of result.sabotage) {
                    summary += row.caught
                        ? `<div style="font-size: 12px; color:#f3c998;">🛡️ Agents from ${row.rival} were caught before causing damage.</div>`
                        : `<div style="font-size: 12px; color:#f0b7aa;">⚠️ Operatives from ${row.rival} caused losses: -${row.goldLost}g.</div>`;
                }
            }

            summary += '<button data-am-act="closePanelAndEndDay" style="width: 100%; margin-top: 10px; padding: 10px; background: var(--gold); border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Continue</button>';
            summary += '</div>';

            game.ui.showCustomPanel('Festival Results', summary);
            game.ui.updateStats(player, game.world);
        };

        window._beginFestival = () => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const tier = Festivals.BUDGET_TIERS[selectedTier] || Festivals.BUDGET_TIERS.modest;
            if (player.gold < tier.cost) {
                game.ui.showNotification('Not Enough Gold', `You need ${tier.cost} gold to host this festival.`, 'error');
                return;
            }

            if (selectedContest === 'jousting') {
                ActionMenu._runJoustingFestivalMinigame(game, finalizeFestival);
            } else {
                ActionMenu._runArcheryFestivalMinigame(game, finalizeFestival);
            }
        };

        render();
    },

    _runJoustingFestivalMinigame(game, onDone) {
        const lanes = ['Left', 'Center', 'Right'];
        const icons = { Left: '⬅️', Center: '⬆️', Right: '➡️' };
        const sequence = [Utils.randPick(lanes), Utils.randPick(lanes), Utils.randPick(lanes)];
        const picks = [];

        const showSequence = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🐎 Jousting Lists</h4>';
            html += '<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Memorize the charge pattern, then repeat it correctly.</div>';
            html += `<div style="font-size: 28px; letter-spacing: 8px; text-align:center; margin: 12px 0;">${sequence.map(s => icons[s]).join('')}</div>`;
            html += '<button onclick="window._startJoustInput()" style="width:100%; padding:10px; background:#c97d32; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">I Memorized It</button>';
            html += '</div>';
            game.ui.showCustomPanel('Jousting Contest', html);
        };

        const showInput = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🐎 Repeat the Pattern</h4>';
            html += `<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Step ${picks.length + 1}/3</div>`;
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">';
            for (const lane of lanes) {
                html += `<button onclick="window._pickJoustLane('${lane}')" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">${icons[lane]} ${lane}</button>`;
            }
            html += '</div>';
            html += '</div>';
            game.ui.showCustomPanel('Jousting Contest', html);
        };

        window._startJoustInput = () => showInput();
        window._pickJoustLane = (lane) => {
            picks.push(lane);
            if (picks.length < 3) {
                showInput();
                return;
            }

            let matches = 0;
            for (let i = 0; i < sequence.length; i++) {
                if (picks[i] === sequence[i]) matches++;
            }
            onDone(matches);
        };

        showSequence();
    },

    _runArcheryFestivalMinigame(game, onDone) {
        const drifts = [Utils.randPick([-1, 0, 1]), Utils.randPick([-1, 0, 1]), Utils.randPick([-1, 0, 1])];
        let shot = 0;
        let hits = 0;

        const windLabel = (val) => val === 0 ? 'Calm' : (val < 0 ? 'Wind Left' : 'Wind Right');
        const windIcon = (val) => val === 0 ? '⬆️' : (val < 0 ? '⬅️' : '➡️');

        const render = () => {
            let html = '<div style="max-width: 460px;">';
            html += '<h4 style="margin-top: 0;">🏹 Archery Contest</h4>';
            html += `<div style="font-size: 12px; color:#bbb; margin-bottom: 8px;">Shot ${shot + 1}/3 — compensate for wind.</div>`;
            html += `<div style="font-size: 18px; margin: 8px 0; text-align:center;">${windIcon(drifts[shot])} ${windLabel(drifts[shot])}</div>`;
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">';
            html += '<button onclick="window._pickArchery(-1)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Left</button>';
            html += '<button onclick="window._pickArchery(0)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Center</button>';
            html += '<button onclick="window._pickArchery(1)" style="padding: 10px; border-radius: 6px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#ddd; cursor:pointer;">Aim Right</button>';
            html += '</div>';
            html += '</div>';
            game.ui.showCustomPanel('Archery Contest', html);
        };

        window._pickArchery = (aim) => {
            if (aim + drifts[shot] === 0) hits++;
            shot++;

            if (shot >= drifts.length) {
                onDone(hits);
                return;
            }

            render();
        };

        render();
    },
});
