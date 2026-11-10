// ActionMenu — realm methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { Duels } from '../../systems/duels.js';
import { DuelPanel } from './duel.js';
import { DevotionPanel } from './devotion.js';
import { FeastPanel } from './feast.js';
import { BTN_GOLD, BTN_PLAIN, esc, lede, chips, purse, sectionHead, kv, card, actRow, rowList, price } from './uiKit.js';
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
        const renown = baseRenown + out.renown;
        if (out.champion) {
            h += lede(`<b style="color:#ffcf6a;">🏆 GRAND CHAMPION! Won ${out.gold} gold! +${renown} total renown!</b>`);
        } else if (out.finalist) {
            h += lede(`🥈 <b>Runner-up!</b> Won ${out.gold} gold. +${renown} renown.`);
        } else {
            h += lede(`Eliminated${out.wins ? ' in the semi-final' : ' in the opening bout'}. +${renown} renown for competing.`);
        }
        h += chips([
            { icon: '💰', label: 'Prize', value: `${out.gold}g`, cls: 'gold' },
            ['⭐', 'Renown', `+${renown}`],
            out.harm > 0 ? ['🤕', 'Hurt', `<span style="color:#e0846a;">-${out.harm} HP</span>`] : null,
        ]);
        h += rowList(bouts.map((b, i) => {
            const r = b.result;
            const how = r.yielded === 'b' ? ' (they yielded)' : r.yielded === 'a' ? ' (you yielded)' : '';
            return r.playerWon
                ? { icon: '✓', name: BOUT_NAMES[i], desc: `defeated ${esc(b.opponent.name)}${how}`, side: 'won', tone: 'good' }
                : { icon: '✗', name: BOUT_NAMES[i], desc: `lost to ${esc(b.opponent.name)}${how}`, side: 'lost', tone: 'bad' };
        }), '⚔️ Tournament Results');
        for (const w of out.wounds) h += `<div style="color: #e0846a; margin-left: 12px;">${w.icon} ${esc(w.name)} (${esc(w.text)})</div>`;
        if (out.skillUp) h += '<div style="color: #9fb4f0; margin-top: 4px;">Combat skill improved!</div>';
        if (out.harm > 0) h += `<div style="color: #e0846a; margin-top: 4px;">Bruises and cuts: -${out.harm} HP</div>`;
        h += `<div style="margin-top: 10px;">${actRow({ icon: '➡️', name: 'Continue', desc: 'Leave the lists', act: 'closePanelAndEndDay', tone: 'gold' })}</div>`;
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
        h += lede(`🏟️ <b>The Lists at ${esc(settlement.name)}</b>${i > 0 ? ` · <span style="color:#8fd18a;">✓ You beat ${esc(bouts[i - 1].opponent.name)}.</span>` : ''}`);
        h += chips([
            { icon: '🏆', label: 'Champion takes', value: `${prizePool}g`, cls: 'gold' },
            ['🥈', 'Runner-up', `${Math.floor(prizePool * (T.runnerUpShare || 0.4))}g`],
        ]);
        h += rowList(field.map((o, k) => {
            const T2 = Duels.temperament(o.temperament);
            const mark = k < i ? '✓' : k === i ? '▶' : '·';
            return {
                icon: o.icon, name: `${mark} ${BOUT_NAMES[k]}: ${esc(o.name)}`,
                desc: `${esc(o.title || '')} · ${T2.icon || ''} ${esc(T2.label || '')}`,
                side: k < i ? 'won' : k === i ? 'next' : '', tone: k < i ? 'good' : k === i ? 'gold' : '',
            };
        }), 'The bracket:');
        h += `<div style="font-size: 11px; color: #9d937c; margin: -4px 0 6px;">🏆 Champion takes ${prizePool} gold; the runner-up ${Math.floor(prizePool * (T.runnerUpShare || 0.4))}.</div>`;
        h += rowList([
            { icon: '⚔️', name: `Fight the ${BOUT_NAMES[i].toLowerCase()}`, desc: 'Blunted steel, in the duel panel', attrs: 'onclick="window._tourney.fight()"', tone: 'gold', side: '›' },
            { icon: '⚡', name: 'Fight the rest on instinct', desc: 'Settled at once', attrs: 'onclick="window._tourney.auto()"', side: '›' },
        ]);
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
        const blocked = status.ok ? '' : `<p style="font-size: 12px; color: #c98a6a; margin: 0 0 10px;">${status.reasons.join(' ')}</p>`;
        let html = '<div>';
        html += lede(`👑 <b>Proclaim a New Kingdom.</b> You will rule it: set its taxes, war stance and faith, and conduct its diplomacy from Claims & Crowns.`);
        html += chips([
            { icon: '✨', label: 'Costs', value: `${status.cost} Prestige`, cls: 'gold' },
            ['🏘️', 'Settlements', controlledSettlements.length],
        ]);
        html += blocked;
        html += `<p style="font-size: 12px; color: #9d937c; margin: 0 0 10px;">You will unite <b style="color:#ece2c8;">${controlledSettlements.length}</b> settlements under a new crown.</p>`;
        html += card(`
                <input id="newKingdomNameInput" type="text" maxlength="48" value="${suggestedName.replace(/"/g, '&quot;')}"
                    style="width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(245,197,66,0.22); background: rgba(0,0,0,0.3); color: #ece2c8; font-size: 13px; margin-bottom: 10px;" />
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button data-am-act="closePanel" style="${BTN_PLAIN}">Cancel</button>
                    <button onclick="window._confirmFormKingdom()" style="${BTN_GOLD}">👑 Found Kingdom</button>
                </div>`, { title: 'Kingdom Name' });
        html += '</div>';

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
        html += lede(`⚔️ <b>Hold a Tournament.</b> Organize a fighting tournament in ${settlement.name}! Champions from across the land will compete.`);
        html += chips([
            { icon: '🏆', label: 'Prize pool', value: `${prizePool}g`, cls: 'gold' },
            ['⚔️', 'Combat', Math.round((player.skills?.combat || 1) * 10) / 10],
            ['💪', 'Strength', Math.round((player.strength || 5) * 10) / 10],
            purse(player.gold),
        ]);
        html += kv('💰 Entry/Organization cost', `<span style="color:#ffcf6a;">${entryFee} gold</span>`);
        html += kv('⏰ Time', 'Takes the rest of the day');
        html += sectionHead('You may compete yourself, or simply host and watch');
        const hostFee = Math.floor(entryFee * 0.6);
        const why = cooling > 0
            ? `The knights are still mending from your last tournament. Call the lists again in ${cooling} day${cooling === 1 ? '' : 's'}.`
            : `You need ${entryFee} gold to organize a tournament.`;
        const open = cooling <= 0 && player.gold >= entryFee;
        html += rowList([
            { icon: '⚔️', name: 'Compete', desc: 'Ride in the lists yourself: three bouts for the prize', attrs: 'onclick="window._doTournament(true)"', off: !open, why, side: price(entryFee, player.gold >= entryFee) },
            { icon: '🏟️', name: 'Just Host & Spectate', desc: 'Pay for the lists and watch from the stands', attrs: 'onclick="window._doTournament(false)"', off: !open, why, side: price(hostFee, player.gold >= hostFee) },
        ]);
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
                resultHtml += lede('🏟️ <b>Tournament Hosted.</b> The tournament was a great success! The crowd cheered and the fighters put on a great show.');
                resultHtml += `<div style="color: #ffcf6a; margin-top: 4px;">+${renownGain} renown for hosting.</div>`;

                // Hosting chance for diplomacy
                if (Math.random() < 0.25 && player.skills) {
                    player.skills.diplomacy = Math.min((player.skills.diplomacy || 1) + 1, 10);
                    resultHtml += `<div style="color: #9fb4f0; margin-top: 4px;">Diplomacy improved from managing the event!</div>`;
                }
            }

            resultHtml += `<div style="margin-top: 10px;">${actRow({ icon: '➡️', name: 'Continue', desc: 'Leave the stands', act: 'closePanelAndEndDay', tone: 'gold' })}</div>`;
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
            html += lede(`${theme.icon} <b>${theme.name}.</b> ${game.world.season} festival season in ${settlement.name}. Recommended contest: <strong>${Festivals.CONTESTS[theme.recommendedContest].label}</strong>.`);
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
                html += chips([
                    ['🎪', 'Hosted', fs.hosted],
                    ['🏅', 'Podiums', fs.successfulContests],
                    ['🤝', 'Envoys feted', fs.diplomacyEvents],
                    purse(player.gold),
                ]);
                if (perks.length) html += `<div style="font-size: 11px; color: #c9b27a; margin: -4px 0 8px;">🎪 Record: ${fs.hosted} hosted · ${fs.successfulContests} podiums · ${fs.diplomacyEvents} envoys feted — ${perks.join(', ')}</div>`;
                if (novelty < 1) html += `<div style="font-size: 11px; color: #f0b35a; margin: -4px 0 8px;">${settlement.name} has seen your festivals lately: renown ×${novelty.toFixed(1)}. Try another town.</div>`;
            }

            // A chosen option: the gold bar and a check, the side column lit
            const pick = (on) => (on ? '<span style="color:#ffcf6a;">✓ chosen</span>' : '');
            html += rowList(options.map(option => {
                const active = selectedTier === option.id;
                return {
                    icon: active ? '✅' : '🎪', name: option.label,
                    desc: `+${option.renown} base renown · +${Math.round(option.morale * 100)}% morale for ${option.moraleDays} days`,
                    attrs: `onclick="window._setFestivalTier('${option.id}')"`,
                    side: `${active ? pick(true) + ' ' : ''}${price(option.cost, (player.gold || 0) >= option.cost)}`,
                };
            }), 'Festival Scale');

            html += rowList([
                { icon: '🤝', name: 'Diplomatic Reception', desc: 'More goodwill from envoys; saboteurs slip in more easily', attrs: 'onclick="window._setFestivalStance(\'diplomatic\')"', side: pick(selectedStance === 'diplomatic') },
                { icon: '🛡️', name: 'Tight Security', desc: 'Fewer saboteurs, and some caught; envoys less warmed', attrs: 'onclick="window._setFestivalStance(\'security\')"', side: pick(selectedStance === 'security') },
            ], 'Guest Policy');

            html += rowList(Object.values(Festivals.CONTESTS).map(contest => {
                const active = selectedContest === contest.id;
                const recommended = theme.recommendedContest === contest.id;
                return {
                    icon: contest.icon, name: `${contest.label}${recommended ? ' <span style="font-size:10px; color:#8fd18a; font-weight:400;">(Season Favored)</span>' : ''}`,
                    attrs: `onclick="window._setFestivalContest('${contest.id}')"`,
                    side: pick(active),
                };
            }), 'Seasonal Contest');

            html += `<div style="font-size: 12px; color: ${canAfford ? '#9d937c' : '#e0846a'}; margin: 8px 0;">Cost: ${currentTier.cost} gold · Your gold: ${Math.floor(player.gold)}</div>`;
            html += rowList([{
                icon: currentTier.icon || theme.icon, name: 'Begin Festival', desc: `${currentTier.label} · takes the day`,
                attrs: 'onclick="window._beginFestival()"', off: !canAfford, why: `You need ${currentTier.cost} gold to host this festival.`,
                side: price(currentTier.cost, canAfford), tone: 'gold',
            }]);
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
            summary += lede(`${result.seasonTheme.icon} <b>Festival Completed.</b> ${result.contestResult.text}`);
            summary += chips([
                { icon: '⭐', label: 'Renown', value: `+${result.renownGain}`, cls: 'gold' },
                ['🎉', 'Morale boost', `${Math.round(result.moraleBoost * 100)}% for ${result.moraleDays} days`],
                ['🏅', 'Contest prize', `${result.contestPrize}g`],
            ]);
            const lc = result.localCustoms;
            if (lc && (lc.custom || lc.sentimentGain)) {
                summary += `<div style="font-size: 12px; color: #8fd18a; margin-bottom: 10px;">🎊 ${lc.custom ? `The locals fold in their ${lc.custom}` : 'The local peoples join in'}${lc.renownBonus ? ` (+${lc.renownBonus} renown)` : ''} · every people here +${lc.sentimentGain} mood</div>`;
            }

            // Rival adventurers nearby enter the contest by name (systems/rivals.js)
            const rivalRows = Rivals.festivalContest(player, game.world, tile, result.contestResult.tier, result.contest && result.contest.id);
            if (rivalRows.length > 0) {
                summary += rowList(rivalRows.map(row => (row.beatPlayer
                    ? { icon: row.icon, name: row.name, desc: `${row.name} outshone you in the ${row.contest}.`, side: 'lost', tone: 'bad' }
                    : { icon: row.icon, name: row.name, desc: `You bested ${row.name} in the ${row.contest} (+1 renown).`, side: '+1 renown', tone: 'good' })), 'Rival Contestants');
            }

            if (result.reputations.length > 0) {
                summary += rowList(result.reputations.map(row => ({
                    icon: '🤝', name: row.rival,
                    desc: `+${row.repGain} reputation${row.relationGain ? `, +${row.relationGain} relations with your realm` : ''}`,
                    side: `+${row.repGain}`, tone: 'good',
                })), 'Diplomatic Outcomes');
            }

            if (result.sabotage.length > 0) {
                summary += rowList(result.sabotage.map(row => (row.caught
                    ? { icon: '🛡️', name: row.rival, desc: `Agents from ${row.rival} were caught before causing damage.`, side: 'caught', tone: 'good' }
                    : { icon: '⚠️', name: row.rival, desc: `Operatives from ${row.rival} caused losses: -${row.goldLost}g.`, side: `-${row.goldLost}g`, tone: 'bad' })), 'Sabotage Attempts');
            }

            summary += `<div style="margin-top: 10px;">${actRow({ icon: '➡️', name: 'Continue', desc: 'The revels end', act: 'closePanelAndEndDay', tone: 'gold' })}</div>`;
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
            html += lede('🐎 <b>Jousting Lists.</b> Memorize the charge pattern, then repeat it correctly.');
            html += card(`<div style="font-size: 28px; letter-spacing: 8px; text-align:center; margin: 6px 0;">${sequence.map(s => icons[s]).join('')}</div>`);
            html += rowList([{ icon: '💭', name: 'I Memorized It', desc: 'Hide the pattern and ride', attrs: 'onclick="window._startJoustInput()"', tone: 'gold', side: '›' }]);
            html += '</div>';
            game.ui.showCustomPanel('Jousting Contest', html);
        };

        const showInput = () => {
            let html = '<div style="max-width: 460px;">';
            html += lede('🐎 <b>Repeat the Pattern.</b>');
            html += chips([['🎯', 'Step', `${picks.length + 1}/3`]]);
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">';
            for (const lane of lanes) {
                html += `<button onclick="window._pickJoustLane('${lane}')" style="${BTN_PLAIN} margin:0; padding: 10px;">${icons[lane]} ${lane}</button>`;
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
            html += lede(`🏹 <b>Archery Contest.</b> Shot ${shot + 1}/3 — compensate for wind.`);
            html += card(`<div style="font-size: 18px; margin: 2px 0; text-align:center;">${windIcon(drifts[shot])} ${windLabel(drifts[shot])}</div>`);
            const aim = `${BTN_PLAIN} margin:0; padding: 10px;`;
            html += '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">';
            html += `<button onclick="window._pickArchery(-1)" style="${aim}">Aim Left</button>`;
            html += `<button onclick="window._pickArchery(0)" style="${aim}">Aim Center</button>`;
            html += `<button onclick="window._pickArchery(1)" style="${aim}">Aim Right</button>`;
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
