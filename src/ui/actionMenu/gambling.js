// ActionMenu — gambling methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { Traits } from '../../systems/traits.js';
import { PerformTasks } from '../mapTasks/performTasks.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader } from './_imports.js';

/** Busk an act in person on the street map; the crowd's score goes to the busking reward. */
function _buskInPerson(game, tile, crowdMultiplier, perfId) {
    const perf = ActionMenu._getBuskingData().find(p => p.id === perfId);
    PerformTasks.busk(game, {
        perfId,
        title: perf ? perf.name : 'Street Performance',
        icon: perf ? perf.icon : '🎭',
        stat: ActionMenu._getPlayerStat(game.player, perf ? perf.stat : 'charisma'),
        crowdMult: crowdMultiplier,
        onScore: (score) => ActionMenu._buskingReward(game, tile, crowdMultiplier, perfId, score),
        onAbandon: (score) => {
            if (score > 0) ActionMenu._buskingReward(game, tile, crowdMultiplier, perfId, score);
            else game.ui.showNotification('🎭 Packed up', 'You packed up before anyone paid. No coins in the hat.', 'warning');
        },
    });
}

Object.assign(ActionMenu, {
    /**
     * Show gambling menu — pick a minigame
     */
    showGamblingMenu(game, tile) {
        const gold = game.player.gold;
        // Check if player owns a tavern here
        const ownsTavern = tile.playerProperties && tile.playerProperties.some(p => p.type === 'tavern' && !p.underConstruction);
        const tavernTables = ownsTavern ? (tile.playerProperties.find(p => p.type === 'tavern')?.gamblingTables || 0) : 0;

        // Game catalogue comes from data/earlyJobs.json (gambling.games)
        const minigames = ActionMenu._getGamblingData();

        let html = '<div style="width: 100%; box-sizing: border-box;">';

        if (ownsTavern) {
            html += `<div style="padding: 10px 14px; margin-bottom: 12px; background: rgba(255,215,0,0.08); border: 1px solid rgba(255,215,0,0.3); border-radius: 6px; text-align: center;">
                <div style="font-size: 14px; color: var(--gold); font-weight: bold;">🍻 Your Tavern</div>
                <div style="font-size: 12px; color: var(--text-secondary);">House advantage! +5% luck bonus${tavernTables > 0 ? ` · ${tavernTables} table${tavernTables > 1 ? 's' : ''} (+${tavernTables * 2}% extra)` : ''} · No AP cost</div>
            </div>`;
        }

        html += '<h4 style="margin-top: 0; text-align: center;">🎲 Games of Chance</h4>';
        html += `<p style="font-size: 13px; color: var(--text-secondary); text-align: center; margin-bottom: 16px;">Your purse: <span style="color: var(--gold); font-weight: bold;">${gold} gold</span></p>`;

        for (const mg of minigames) {
            const canPlay = gold >= mg.minBet;
            html += `
                <button onclick="window._openMinigame('${mg.id}')" ${!canPlay ? 'disabled' : ''}
                    style="display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 16px; margin-bottom: 8px;
                           background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 4px solid ${mg.color || '#9b59b6'};
                           border-radius: 8px; cursor: ${canPlay ? 'pointer' : 'not-allowed'}; text-align: left;
                           color: var(--text-primary); transition: all 0.15s; ${!canPlay ? 'opacity: 0.4;' : ''}"
                    onmouseenter="if(!this.disabled) this.style.background='rgba(255,255,255,0.08)'"
                    onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                    <span style="font-size: 32px; line-height: 1;">${mg.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-family: var(--font-display); font-size: 15px; color: var(--gold); margin-bottom: 3px;">${mg.name}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.3;">${mg.description}</div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Min bet: ${mg.minBet}g</div>
                    </div>
                    <span style="font-size: 20px; color: var(--text-muted);">▶</span>
                </button>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('🎲 Gambling Den', html);

        window._openMinigame = (id) => {
            if (id === 'crown_anchor') ActionMenu._minigameCrownAnchor(game, tile);
            else if (id === 'dragons_flip') ActionMenu._minigameDragonsFlip(game, tile);
            else if (id === 'high_low') ActionMenu._minigameHighLow(game, tile);
            else if (id === 'poker') ActionMenu._minigamePoker(game, tile);
        };
    },

    // ── MINIGAME: Texas Hold'em Poker ──────────────────────────────────────────
    _minigamePoker(game, tile) {
        window._gambGame = game;
        window._gambTile = tile;

        // ── Deck utilities ────────────────────────────────────────────────────
        const SUITS = [
            { sym: '♠', color: '#ccc', name: 'Spades' },
            { sym: '♥', color: '#e74c3c', name: 'Hearts' },
            { sym: '♦', color: '#e74c3c', name: 'Diamonds' },
            { sym: '♣', color: '#ccc', name: 'Clubs' },
        ];
        const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        const RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

        const makeDeck = () => {
            const deck = [];
            for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
            // Fisher-Yates shuffle
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            return deck;
        };

        const cardHTML = (card, faceDown = false) => {
            if (faceDown) return `<div style="width:48px;height:68px;border-radius:6px;background:linear-gradient(135deg,#1a3a5c,#0d2137);border:2px solid rgba(255,255,255,0.15);display:inline-flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 3px 8px rgba(0,0,0,0.5);color:rgba(255,255,255,0.15);">🂠</div>`;
            return `<div style="width:48px;height:68px;border-radius:6px;background:rgba(255,255,255,0.96);border:2px solid rgba(255,255,255,0.2);display:inline-flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.5);gap:2px;">
                <div style="font-size:13px;font-weight:900;line-height:1;color:${card.suit.color};">${card.rank}</div>
                <div style="font-size:18px;line-height:1;color:${card.suit.color};">${card.suit.sym}</div>
            </div>`;
        };

        // ── Hand evaluator ────────────────────────────────────────────────────
        const evalHand = (cards) => {
            // Best 5-card hand from any subset of cards
            const vals = cards.map(c => RANK_VAL[c.rank]).sort((a,b) => b-a);
            const suits = cards.map(c => c.suit.name);
            const groups = {};
            for (const v of vals) groups[v] = (groups[v]||0)+1;
            const counts = Object.values(groups).sort((a,b) => b-a);
            const uniq = Object.keys(groups).map(Number).sort((a,b) => b-a);

            const isFlush = suits.every(s => s === suits[0]) && cards.length >= 5;
            const isStraight = (() => {
                const u = [...new Set(vals)].sort((a,b) => b-a);
                if (u.length < 5) return false;
                // Check regular straight
                for (let i = 0; i <= u.length - 5; i++) {
                    if (u[i] - u[i+4] === 4) return true;
                }
                // Wheel: A-2-3-4-5
                if (u[0] === 14 && u[u.length-1] === 2 && u[u.length-2] === 3 && u[u.length-3] === 4 && u[u.length-4] === 5) return true;
                return false;
            })();

            if (isFlush && isStraight && vals[0] === 14 && vals[1] === 13) return { rank: 9, name: 'Royal Flush',      score: 9000 + vals[0] };
            if (isFlush && isStraight)                                       return { rank: 8, name: 'Straight Flush',  score: 8000 + vals[0] };
            if (counts[0] === 4)                                             return { rank: 7, name: 'Four of a Kind',  score: 7000 + uniq.find(v => groups[v]===4)*10 };
            if (counts[0] === 3 && counts[1] === 2)                         return { rank: 6, name: 'Full House',      score: 6000 + uniq.find(v => groups[v]===3)*10 };
            if (isFlush)                                                     return { rank: 5, name: 'Flush',           score: 5000 + vals[0] };
            if (isStraight)                                                  return { rank: 4, name: 'Straight',        score: 4000 + vals[0] };
            if (counts[0] === 3)                                             return { rank: 3, name: 'Three of a Kind', score: 3000 + uniq.find(v => groups[v]===3)*10 };
            if (counts[0] === 2 && counts[1] === 2)                         return { rank: 2, name: 'Two Pair',        score: 2000 + uniq.filter(v => groups[v]===2).reduce((a,v)=>a+v,0) };
            if (counts[0] === 2)                                             return { rank: 1, name: 'Pair',            score: 1000 + uniq.find(v => groups[v]===2)*10 };
            return                                                                  { rank: 0, name: 'High Card',       score: vals[0] };
        };

        const handColor = (rank) => ['#aaa','#3498db','#3498db','#2ecc71','#2ecc71','#9b59b6','#e67e22','#e67e22','#e74c3c','#f1c40f'][rank] || '#aaa';

        // ── Dealer AI ─────────────────────────────────────────────────────────
        const dealerDecide = (dealerCards, community, pot, street) => {
            const hand = evalHand([...dealerCards, ...community]);
            if (street === 'preflop') return hand.rank >= 1 ? 'bet' : (Math.random() < 0.4 ? 'bet' : 'check');
            if (street === 'flop')   return hand.rank >= 2 ? 'bet' : (Math.random() < 0.25 ? 'bet' : 'check');
            if (street === 'turn')   return hand.rank >= 1 ? 'bet' : 'check';
            return hand.rank >= 1 ? 'bet' : 'check'; // river
        };

        // ── Game State ────────────────────────────────────────────────────────
        const pokerCfg = ActionMenu._getGamblingGame('poker');
        const maxBet = Math.min(pokerCfg.maxBet, game.player.gold);
        let deck, playerCards, dealerCards, community;
        let pot = 0, playerBet = 0, dealerBet = 0, currentAnte = 0;
        let street = 'ante'; // ante → preflop → flop → turn → river → showdown
        let statusMsg = '';
        let lastAction = '';
        let gameOver = false;

        const startHand = (ante) => {
            deck = makeDeck();
            playerCards = [deck.pop(), deck.pop()];
            dealerCards = [deck.pop(), deck.pop()];
            community = [];
            pot = ante * 2;
            playerBet = ante;
            dealerBet = ante;
            currentAnte = ante;
            game.player.gold -= ante;
            street = 'preflop';
            statusMsg = 'Pre-flop: Check, Bet more, or Fold.';
            lastAction = '';
            gameOver = false;
            ActionMenu._gamblingFinance(game, -ante);
            game.ui.updateStats(game.player, game.world);
            render();
        };

        // ── Advance streets ───────────────────────────────────────────────────
        const nextStreet = (playerAction) => {
            if (playerAction === 'fold') {
                // Dealer wins pot
                game.ui.updateStats(game.player, game.world);
                statusMsg = '😔 You folded. Dealer takes the pot.';
                street = 'folded';
                gameOver = true;
                render();
                return;
            }

            const betAmount = parseInt(document.getElementById('pokerBetInput')?.value || currentAnte);
            const dealerAction = dealerDecide(dealerCards, community, pot, street);

            if (playerAction === 'bet') {
                const extra = Math.max(1, betAmount);
                if (game.player.gold < extra) { game.ui.showNotification('Not enough gold!', '', 'error'); return; }
                game.player.gold -= extra;
                pot += extra;
                playerBet += extra;
                ActionMenu._gamblingFinance(game, -extra);
                if (dealerAction === 'bet') { pot += extra; dealerBet += extra; lastAction = `You bet ${extra}g. Dealer calls.`; }
                else { lastAction = `You bet ${extra}g. Dealer checks.`; }
            } else {
                // check
                if (dealerAction === 'bet') {
                    const dExtra = currentAnte;
                    pot += dExtra;
                    dealerBet += dExtra;
                    lastAction = `Dealer bets ${dExtra}g!`;
                    // Player must call or fold
                    street = street + '_facing_bet';
                    statusMsg = `Dealer bet ${dExtra}g — Call (${dExtra}g) or Fold?`;
                    render();
                    return;
                } else {
                    lastAction = 'Both check.';
                }
            }

            advanceStreet();
        };

        const callBet = () => {
            // Called when facing dealer bet
            const base = street.replace('_facing_bet','');
            const callAmt = currentAnte;
            if (game.player.gold < callAmt) { game.ui.showNotification('Not enough gold!', '', 'error'); return; }
            game.player.gold -= callAmt;
            pot += callAmt;
            playerBet += callAmt;
            ActionMenu._gamblingFinance(game, -callAmt);
            lastAction = `You call ${callAmt}g.`;
            street = base;
            advanceStreet();
        };

        const advanceStreet = () => {
            if (street === 'preflop') {
                community = [deck.pop(), deck.pop(), deck.pop()];
                street = 'flop';
                statusMsg = 'Flop dealt. Check, Bet, or Fold.';
            } else if (street === 'flop') {
                community.push(deck.pop());
                street = 'turn';
                statusMsg = 'Turn dealt. Check, Bet, or Fold.';
            } else if (street === 'turn') {
                community.push(deck.pop());
                street = 'river';
                statusMsg = 'River dealt. Final round — Check, Bet, or Fold.';
            } else if (street === 'river') {
                street = 'showdown';
                statusMsg = 'Showdown!';
                resolveShowdown();
                return;
            }
            game.ui.updateStats(game.player, game.world);
            render();
        };

        const resolveShowdown = () => {
            const playerHand = evalHand([...playerCards, ...community]);
            const dealerHand = evalHand([...dealerCards, ...community]);
            const luckBonus = ActionMenu._getTavernLuckBonus(tile);
            // Luck can swing borderline hands: if scores are within 50, luck may tip it
            const playerScore = playerHand.score + (Math.random() < luckBonus ? 30 : 0);

            if (playerScore > dealerHand.score) {
                game.player.gold += pot;
                ActionMenu._gamblingFinance(game, pot - playerBet);
                statusMsg = `🎉 You win! ${playerHand.name} beats ${dealerHand.name}. +${pot}g`;
            } else if (playerScore === dealerHand.score) {
                const half = Math.floor(pot / 2);
                game.player.gold += half; // ties go to house (floor)
                ActionMenu._gamblingFinance(game, half - playerBet);
                statusMsg = `🤝 Tie! ${playerHand.name} vs ${dealerHand.name}. +${half}g returned.`;
            } else {
                ActionMenu._gamblingFinance(game, -playerBet);
                statusMsg = `😞 Dealer wins. ${dealerHand.name} beats ${playerHand.name}.`;
            }
            gameOver = true;
            game.ui.updateStats(game.player, game.world);
            render();
        };

        // ── Render ────────────────────────────────────────────────────────────
        const render = () => {
            const gold = game.player.gold;
            const isFacingBet = street.endsWith('_facing_bet');

            let html = `<div style="width:100%;box-sizing:border-box;">`;

            // Header
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <button onclick="ActionMenu.showGamblingMenu(window._gambGame,window._gambTile)" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:13px;">← Back</button>
                <span style="color:var(--gold);font-weight:bold;">💰 ${gold}g</span>
            </div>`;
            html += `<h4 style="margin:0 0 2px;text-align:center;">🂡 Texas Hold'em</h4>`;
            if (pot > 0) html += `<div style="text-align:center;font-size:13px;color:var(--gold);margin-bottom:8px;">Pot: <b>${pot}g</b></div>`;

            if (street === 'ante') {
                // Ante selection screen
                html += `<p style="font-size:12px;color:var(--text-secondary);text-align:center;margin-bottom:14px;">Set your ante to start a hand. Both you and the dealer put the ante in the pot.</p>`;
                const anteMax = Math.min(pokerCfg.maxAnte ?? 200, Math.floor(gold / 2));
                html += `<div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:18px;">
                    <span style="font-size:12px;color:var(--text-secondary);">Ante:</span>
                    <input type="range" id="pokerAnte" min="${pokerCfg.minBet}" max="${anteMax}" value="${Math.min(20,anteMax)}"
                        oninput="document.getElementById('pokerAnteLabel').textContent=this.value"
                        style="width:160px;accent-color:#e74c3c;">
                    <span id="pokerAnteLabel" style="color:var(--gold);font-weight:bold;min-width:38px;">${Math.min(20,anteMax)}</span>g
                </div>`;
                html += `<button onclick="window._pokerDeal(parseInt(document.getElementById('pokerAnte').value))"
                    style="display:block;width:100%;padding:12px;background:linear-gradient(135deg,#c0392b,#e74c3c);color:white;border:none;
                           border-radius:8px;cursor:pointer;font-family:var(--font-display);font-size:15px;letter-spacing:1px;font-weight:bold;">
                    🂡 Deal Cards
                </button>`;
            } else {
                // ── Community cards ──
                html += `<div style="text-align:center;margin-bottom:10px;">`;
                html += `<div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px;">Community Cards</div>`;
                html += `<div style="display:flex;gap:6px;justify-content:center;align-items:center;min-height:76px;">`;
                for (let i = 0; i < 5; i++) {
                    if (i < community.length) {
                        html += cardHTML(community[i]);
                    } else {
                        html += `<div style="width:48px;height:68px;border-radius:6px;border:2px dashed rgba(255,255,255,0.1);display:inline-flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.1);font-size:20px;">?</div>`;
                    }
                }
                html += `</div></div>`;

                // ── Player hand ──
                const showDown = street === 'showdown' || street === 'folded';
                const playerHandResult = showDown ? evalHand([...playerCards, ...community]) : null;
                html += `<div style="display:flex;gap:16px;justify-content:space-around;margin-bottom:10px;">`;

                // Player
                html += `<div style="text-align:center;">
                    <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px;">Your Hand</div>
                    <div style="display:flex;gap:5px;justify-content:center;">${playerCards.map(c=>cardHTML(c)).join('')}</div>`;
                if (playerHandResult) html += `<div style="font-size:11px;margin-top:5px;color:${handColor(playerHandResult.rank)};font-weight:bold;">${playerHandResult.name}</div>`;
                html += `</div>`;

                // Dealer
                html += `<div style="text-align:center;">
                    <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px;">Dealer</div>
                    <div style="display:flex;gap:5px;justify-content:center;">`;
                if (showDown) {
                    const dealerHandResult = evalHand([...dealerCards, ...community]);
                    html += dealerCards.map(c=>cardHTML(c)).join('');
                    html += `</div><div style="font-size:11px;margin-top:5px;color:${handColor(dealerHandResult.rank)};font-weight:bold;">${dealerHandResult.name}</div>`;
                } else {
                    html += dealerCards.map(()=>cardHTML(null,true)).join('');
                    html += `</div>`;
                }
                html += `</div></div>`;

                // ── Status / last action ──
                if (lastAction) html += `<div style="font-size:11px;color:var(--text-muted);text-align:center;margin-bottom:6px;">${lastAction}</div>`;
                html += `<div style="font-size:13px;color:var(--text-secondary);text-align:center;margin-bottom:10px;">${statusMsg}</div>`;

                // ── Action buttons ──
                if (!gameOver && !isFacingBet) {
                    const betMax = Math.min(100, gold, pot);
                    html += `<div style="display:flex;align-items:center;gap:6px;justify-content:center;margin-bottom:10px;">
                        <span style="font-size:11px;color:var(--text-secondary);">Raise:</span>
                        <input type="range" id="pokerBetInput" min="${currentAnte}" max="${betMax}" value="${currentAnte}"
                            oninput="document.getElementById('pokerBetLabel').textContent=this.value"
                            style="width:120px;accent-color:#e74c3c;">
                        <span id="pokerBetLabel" style="color:var(--gold);font-weight:bold;min-width:32px;">${currentAnte}</span>g
                    </div>`;
                    html += `<div style="display:flex;gap:8px;justify-content:center;">
                        <button onclick="window._pokerAction('check')"
                            style="padding:10px 20px;background:rgba(52,152,219,0.15);border:2px solid #3498db;border-radius:8px;
                                   cursor:pointer;color:#3498db;font-size:13px;font-weight:bold;">✔ Check</button>
                        <button onclick="window._pokerAction('bet')"
                            style="padding:10px 20px;background:rgba(231,76,60,0.15);border:2px solid #e74c3c;border-radius:8px;
                                   cursor:pointer;color:#e74c3c;font-size:13px;font-weight:bold;">💰 Bet</button>
                        <button onclick="window._pokerAction('fold')"
                            style="padding:10px 18px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:8px;
                                   cursor:pointer;color:var(--text-secondary);font-size:13px;">✖ Fold</button>
                    </div>`;
                } else if (!gameOver && isFacingBet) {
                    html += `<div style="display:flex;gap:8px;justify-content:center;">
                        <button onclick="window._pokerCall()"
                            style="padding:10px 24px;background:rgba(46,204,113,0.15);border:2px solid #2ecc71;border-radius:8px;
                                   cursor:pointer;color:#2ecc71;font-size:13px;font-weight:bold;">📲 Call</button>
                        <button onclick="window._pokerAction('fold')"
                            style="padding:10px 18px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:8px;
                                   cursor:pointer;color:var(--text-secondary);font-size:13px;">✖ Fold</button>
                    </div>`;
                } else if (gameOver) {
                    html += `<button onclick="window._pokerNewHand()"
                        style="display:block;width:100%;padding:11px;margin-top:4px;background:linear-gradient(135deg,#c0392b,#e74c3c);color:white;border:none;
                               border-radius:8px;cursor:pointer;font-family:var(--font-display);font-size:14px;letter-spacing:1px;"
                        ${gold < 10 ? 'disabled style="opacity:0.4;"' : ''}>
                        ${gold >= 10 ? '🂡 New Hand' : 'Out of gold!'}
                    </button>`;
                    html += `<button data-am-act="closePanel"
                        style="display:block;width:100%;padding:9px;margin-top:6px;background:none;border:1px solid rgba(255,255,255,0.1);
                               border-radius:8px;cursor:pointer;color:var(--text-secondary);font-size:12px;">Leave Table</button>`;
                }
            }

            html += `</div>`;
            game.ui.showCustomPanel("🂡 Texas Hold'em", html);
        };

        // Expose methods referenced in HTML onclick
        window._pokerDeal = (ante) => {
            if (!ActionMenu._gamblingCheckAP(game, tile)) return;
            if (game.player.gold < ante * 1) { game.ui.showNotification('Not Enough Gold', `Need at least ${ante}g to ante.`, 'error'); return; }
            startHand(ante);
        };
        window._pokerAction = (action) => nextStreet(action);
        window._pokerCall = () => callBet();
        window._pokerNewHand = () => {
            street = 'ante';
            pot = 0; playerBet = 0; dealerBet = 0;
            statusMsg = '';
            gameOver = false;
            render();
        };

        render();
    },

    /**
     * Check AP and deduct for a gambling round. Returns false if can't play.
     */
    _gamblingCheckAP(game, tile) {
        // No AP cost at player's own tavern
        if (tile && tile.playerProperties && tile.playerProperties.some(p => p.type === 'tavern' && !p.underConstruction)) {
            return true;
        }
        const apCost = ActionMenu._getGamblingSettings().apCostPerRound ?? 2;
        if ((game.player.actionPoints || 0) < apCost) {
            game.ui.showNotification('⚡ No Action Points', `Each round costs ${apCost} AP. Rest to start a new day.`, 'error');
            return false;
        }
        game.player.actionPoints -= apCost;
        return true;
    },

    /**
     * Get the tavern luck bonus if player owns a tavern on this tile
     */
    _getTavernLuckBonus(tile) {
        if (!tile || !tile.playerProperties) return 0;
        const tavern = tile.playerProperties.find(p => p.type === 'tavern' && !p.underConstruction);
        if (!tavern) return 0;
        const cfg = ActionMenu._getGamblingSettings();
        const tableBonus = (tavern.gamblingTables || 0) * (cfg.tavernTableLuckBonus ?? 0.02);
        return (cfg.tavernLuckBonus ?? 0.05) + tableBonus; // 5% base + 2% per table by default
    },

    /**
     * Record gambling winnings/losses in finance tracker
     */
    _gamblingFinance(game, netGold) {
        // A stake laid down is a wager: it feeds the Gambler trait and breaks a vow against dice (systems/devotion.js)
        if (netGold < 0) Traits.recordDeed(game.player, 'gambling', 0.5);
        if (!game.player.financeToday) return;
        if (netGold > 0) {
            game.player.financeToday.income.gambling = (game.player.financeToday.income.gambling || 0) + netGold;
        } else if (netGold < 0) {
            game.player.financeToday.expenses = game.player.financeToday.expenses || {};
            game.player.financeToday.expenses.gambling = (game.player.financeToday.expenses.gambling || 0) + Math.abs(netGold);
        }
    },

    // ── MINIGAME 1: Crown & Anchor ──────────────────────────
    _minigameCrownAnchor(game, tile) {
        const gold = game.player.gold;
        const cfg = ActionMenu._getGamblingGame('crown_anchor');
        const maxBet = Math.min(cfg.maxBet, gold);
        const symbols = [
            { id: 'crown', icon: '👑', name: 'Crown' },
            { id: 'anchor', icon: '⚓', name: 'Anchor' },
            { id: 'heart', icon: '❤️', name: 'Heart' },
            { id: 'diamond', icon: '💎', name: 'Diamond' },
            { id: 'spade', icon: '♠️', name: 'Spade' },
            { id: 'club', icon: '♣️', name: 'Club' },
        ];

        let html = '<div style="width: 100%; box-sizing: border-box; text-align: center;">';
        html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <button onclick="ActionMenu.showGamblingMenu(window._gambGame, window._gambTile)" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px;">← Back</button>
                    <span style="color: var(--gold); font-weight: bold;">💰 ${gold}g</span>
                 </div>`;
        html += '<h4 style="margin: 0 0 4px;">🎲 Crown & Anchor</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">Pick a symbol and place your bet. Three dice are rolled — each match pays your bet!</p>';

        // Bet slider
        html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; justify-content: center;">
                    <span style="font-size: 12px; color: var(--text-secondary);">Bet:</span>
                    <input type="range" id="caBet" min="${cfg.minBet}" max="${maxBet}" value="${Math.min(25, maxBet)}" 
                           oninput="document.getElementById('caBetLabel').textContent = this.value"
                           style="width: 180px; accent-color: var(--gold);">
                    <span id="caBetLabel" style="color: var(--gold); font-weight: bold; min-width: 40px;">${Math.min(25, maxBet)}</span>g
                 </div>`;

        // Symbol grid
        html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Choose your symbol:</div>';
        html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">';
        for (const sym of symbols) {
            html += `<button onclick="window._caPickSymbol('${sym.id}')" id="caSym_${sym.id}"
                        style="padding: 12px 8px; background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.1);
                               border-radius: 8px; cursor: pointer; transition: all 0.15s; color: var(--text-primary);"
                        onmouseenter="this.style.borderColor='var(--gold)'" onmouseleave="if(!this.classList.contains('ca-selected')) this.style.borderColor='rgba(255,255,255,0.1)'">
                        <div style="font-size: 28px;">${sym.icon}</div>
                        <div style="font-size: 11px; margin-top: 4px;">${sym.name}</div>
                     </button>`;
        }
        html += '</div>';

        // Dice display area
        html += `<div id="caDiceArea" style="min-height: 80px; display: flex; justify-content: center; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <div style="font-size: 14px; color: var(--text-muted);">Pick a symbol and roll!</div>
                 </div>`;

        // Roll button
        html += `<button id="caRollBtn" onclick="window._caRoll()" disabled
                    style="padding: 10px 32px; background: #9b59b6; color: white; border: none; border-radius: 6px; cursor: pointer;
                           font-family: var(--font-display); font-size: 14px; letter-spacing: 1px; opacity: 0.5; transition: all 0.15s;">
                    🎲 Roll the Dice
                 </button>`;

        // Result area
        html += '<div id="caResult" style="margin-top: 12px; min-height: 24px;"></div>';
        html += '</div>';

        game.ui.showCustomPanel('🎲 Crown & Anchor', html);

        window._gambGame = game;
        window._gambTile = tile;
        let selectedSymbol = null;

        window._caPickSymbol = (symId) => {
            selectedSymbol = symId;
            // Visual selection
            for (const s of symbols) {
                const el = document.getElementById('caSym_' + s.id);
                if (el) {
                    if (s.id === symId) {
                        el.classList.add('ca-selected');
                        el.style.borderColor = 'var(--gold)';
                        el.style.background = 'rgba(245, 197, 66, 0.15)';
                    } else {
                        el.classList.remove('ca-selected');
                        el.style.borderColor = 'rgba(255,255,255,0.1)';
                        el.style.background = 'rgba(255,255,255,0.05)';
                    }
                }
            }
            const rollBtn = document.getElementById('caRollBtn');
            if (rollBtn) { rollBtn.disabled = false; rollBtn.style.opacity = '1'; }
        };

        window._caRoll = () => {
            if (!selectedSymbol) return;
            if (!ActionMenu._gamblingCheckAP(game, tile)) return;

            const bet = parseInt(document.getElementById('caBet')?.value || 25);
            if (bet > game.player.gold) {
                game.ui.showNotification('Not Enough', "You don't have enough gold!", 'error');
                return;
            }

            // Disable roll button during animation
            const rollBtn = document.getElementById('caRollBtn');
            if (rollBtn) { rollBtn.disabled = true; rollBtn.style.opacity = '0.5'; }

            // Roll 3 dice
            const luckBonus = Math.min((game.player.luck || 5) * 0.005, 0.05) + ActionMenu._getTavernLuckBonus(tile);
            const diceResults = [];
            for (let i = 0; i < 3; i++) {
                const r = Math.random();
                // Base 1/6 chance per die + slight luck bonus
                if (r < ((cfg.matchChance ?? 1/6) + luckBonus)) {
                    diceResults.push(selectedSymbol);
                } else {
                    const others = symbols.filter(s => s.id !== selectedSymbol);
                    diceResults.push(others[Math.floor(Math.random() * others.length)].id);
                }
            }

            const matches = diceResults.filter(d => d === selectedSymbol).length;
            const diceArea = document.getElementById('caDiceArea');
            const resultArea = document.getElementById('caResult');

            // Animate dice rolling
            let rollCount = 0;
            const rollInterval = setInterval(() => {
                const randomIcons = [0, 1, 2].map(() => symbols[Math.floor(Math.random() * symbols.length)]);
                if (diceArea) {
                    diceArea.innerHTML = randomIcons.map(s =>
                        `<div style="width: 64px; height: 64px; background: rgba(155,89,182,0.2); border: 2px solid #9b59b6; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px;">${s.icon}</div>`
                    ).join('');
                }
                rollCount++;
                if (rollCount >= 8) {
                    clearInterval(rollInterval);
                    // Show final results
                    const finalIcons = diceResults.map(id => symbols.find(s => s.id === id));
                    if (diceArea) {
                        diceArea.innerHTML = finalIcons.map(s => {
                            const isMatch = s.id === selectedSymbol;
                            return `<div style="width: 64px; height: 64px; background: ${isMatch ? 'rgba(46,204,113,0.2)' : 'rgba(255,255,255,0.05)'}; border: 2px solid ${isMatch ? '#2ecc71' : 'rgba(255,255,255,0.15)'}; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px; transition: all 0.3s;">${s.icon}</div>`;
                        }).join('');
                    }

                    // Calculate & apply result
                    if (matches === 0) {
                        game.player.gold -= bet;
                        ActionMenu._gamblingFinance(game, -bet);
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e74c3c; font-weight: bold; font-size: 14px;">No matches! Lost ${bet}g 💸</div>`;
                    } else {
                        const payout = Math.floor(bet * matches * (cfg.payoutPerMatch ?? 1)); // 1x per match, so 1 match = 1x, 2 = 2x, 3 = 3x
                        game.player.gold += payout; // net gain (doesn't deduct bet, matches pay bet each)
                        ActionMenu._gamblingFinance(game, payout);
                        const msg = matches === 3 ? '🎉 TRIPLE MATCH! Jackpot!' : matches === 2 ? '✨ Double match!' : '👍 One match!';
                        if (resultArea) resultArea.innerHTML = `<div style="color: #2ecc71; font-weight: bold; font-size: 14px;">${msg} Won ${payout}g!</div>`;
                    }
                    game.ui.updateStats(game.player, game.world);

                    // Re-enable after result
                    setTimeout(() => {
                        if (rollBtn && game.player.gold >= 5) { rollBtn.disabled = false; rollBtn.style.opacity = '1'; }
                        // Update gold display
                        const panel = document.getElementById('customPanel');
                        if (panel) {
                            const goldSpan = panel.querySelector('span[style*="font-weight: bold"]');
                            if (goldSpan && goldSpan.textContent.includes('g')) goldSpan.textContent = game.player.gold + 'g';
                        }
                    }, 600);
                }
            }, 100);
        };
    },

    // ── MINIGAME 2: Dragon's Flip ───────────────────────────
    _minigameDragonsFlip(game, tile) {
        const gold = game.player.gold;
        const cfg = ActionMenu._getGamblingGame('dragons_flip');
        const maxBet = Math.min(cfg.maxBet, gold);

        let html = '<div style="width: 100%; box-sizing: border-box; text-align: center;">';
        html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <button onclick="ActionMenu.showGamblingMenu(window._gambGame, window._gambTile)" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px;">← Back</button>
                    <span style="color: var(--gold); font-weight: bold;">💰 ${gold}g</span>
                 </div>`;
        html += '<h4 style="margin: 0 0 4px;">🐉 Dragon\'s Flip</h4>';
        html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">Call the coin — Dragon or Shield. Double or nothing!</p>';

        // Bet slider
        html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; justify-content: center;">
                    <span style="font-size: 12px; color: var(--text-secondary);">Bet:</span>
                    <input type="range" id="dfBet" min="${cfg.minBet}" max="${maxBet}" value="${Math.min(25, maxBet)}"
                           oninput="document.getElementById('dfBetLabel').textContent = this.value"
                           style="width: 180px; accent-color: var(--gold);">
                    <span id="dfBetLabel" style="color: var(--gold); font-weight: bold; min-width: 40px;">${Math.min(25, maxBet)}</span>g
                 </div>`;

        // Coin display
        html += `<div id="dfCoinArea" style="margin: 20px auto; width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(135deg, #c49a2a, #f5c542); display: flex; align-items: center; justify-content: center; font-size: 48px; box-shadow: 0 4px 20px rgba(245,197,66,0.3); transition: transform 0.1s;">
                    ❓
                 </div>`;

        // Choice buttons
        html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">Make your call:</div>';
        html += `<div style="display: flex; gap: 12px; justify-content: center; margin-bottom: 16px;">
                    <button onclick="window._dfFlip('dragon')" id="dfDragonBtn"
                        style="padding: 12px 28px; background: rgba(231,76,60,0.15); border: 2px solid #e74c3c;
                               border-radius: 8px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; font-size: 14px;"
                        onmouseenter="this.style.background='rgba(231,76,60,0.3)'" onmouseleave="this.style.background='rgba(231,76,60,0.15)'">
                        🐉 Dragon
                    </button>
                    <button onclick="window._dfFlip('shield')" id="dfShieldBtn"
                        style="padding: 12px 28px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; font-size: 14px;"
                        onmouseenter="this.style.background='rgba(52,152,219,0.3)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        🛡️ Shield
                    </button>
                 </div>`;

        // Result
        html += '<div id="dfResult" style="min-height: 24px; margin-top: 8px;"></div>';

        // Double or nothing option (hidden initially)
        html += '<div id="dfDoubleArea" style="display: none; margin-top: 12px;"></div>';

        html += '</div>';

        game.ui.showCustomPanel("🐉 Dragon's Flip", html);
        window._gambGame = game;
        window._gambTile = tile;
        let currentWinnings = 0;

        window._dfFlip = (call) => {
            if (!ActionMenu._gamblingCheckAP(game, tile)) return;

            const bet = parseInt(document.getElementById('dfBet')?.value || 25);
            if (bet > game.player.gold) {
                game.ui.showNotification('Not Enough', "You don't have enough gold!", 'error');
                return;
            }

            // Disable buttons during flip
            const dragonBtn = document.getElementById('dfDragonBtn');
            const shieldBtn = document.getElementById('dfShieldBtn');
            if (dragonBtn) dragonBtn.disabled = true;
            if (shieldBtn) shieldBtn.disabled = true;

            const coinArea = document.getElementById('dfCoinArea');
            const resultArea = document.getElementById('dfResult');
            const doubleArea = document.getElementById('dfDoubleArea');

            // Coin flip animation
            let flipCount = 0;
            const faces = ['🐉', '🛡️'];
            const flipInterval = setInterval(() => {
                if (coinArea) {
                    coinArea.textContent = faces[flipCount % 2];
                    coinArea.style.transform = `rotateY(${flipCount * 180}deg) scale(${1 + Math.sin(flipCount * 0.5) * 0.1})`;
                }
                flipCount++;
                if (flipCount >= 12) {
                    clearInterval(flipInterval);

                    // Determine result
                    const luckBonus = Math.min((game.player.luck || 5) * 0.008, 0.05) + ActionMenu._getTavernLuckBonus(tile);
                    const winChance = (cfg.winChance ?? 0.48) + luckBonus;
                    const result = Math.random() < winChance ? call : (call === 'dragon' ? 'shield' : 'dragon');
                    const won = result === call;
                    const resultIcon = result === 'dragon' ? '🐉' : '🛡️';
                    const resultName = result === 'dragon' ? 'Dragon' : 'Shield';

                    if (coinArea) {
                        coinArea.textContent = resultIcon;
                        coinArea.style.transform = 'rotateY(0deg) scale(1)';
                        coinArea.style.boxShadow = won
                            ? '0 4px 30px rgba(46,204,113,0.5)'
                            : '0 4px 30px rgba(231,76,60,0.5)';
                    }

                    if (won) {
                        const winAmount = Math.floor(bet * (cfg.payoutMultiplier ?? 2));
                        currentWinnings = winAmount;
                        game.player.gold += bet; // Net +bet (double minus the bet)
                        ActionMenu._gamblingFinance(game, bet);
                        if (resultArea) resultArea.innerHTML = `<div style="color: #2ecc71; font-weight: bold; font-size: 15px;">🎉 ${resultName}! You win ${winAmount}g!</div>`;

                        // Show double-or-nothing option
                        if (doubleArea) {
                            doubleArea.style.display = 'block';
                            doubleArea.innerHTML = `
                                <div style="padding: 12px; background: rgba(245,197,66,0.08); border: 1px solid var(--border-color); border-radius: 8px;">
                                    <div style="font-size: 13px; color: var(--gold); margin-bottom: 8px;">🔥 Double or Nothing? (${currentWinnings}g at stake)</div>
                                    <div style="display: flex; gap: 10px; justify-content: center;">
                                        <button onclick="window._dfDoubleOrNothing('dragon')" style="padding: 8px 20px; background: rgba(231,76,60,0.2); border: 1px solid #e74c3c; border-radius: 6px; cursor: pointer; color: var(--text-primary);">🐉 Dragon</button>
                                        <button onclick="window._dfDoubleOrNothing('shield')" style="padding: 8px 20px; background: rgba(52,152,219,0.2); border: 1px solid #3498db; border-radius: 6px; cursor: pointer; color: var(--text-primary);">🛡️ Shield</button>
                                        <button onclick="window._dfCashOut()" style="padding: 8px 20px; background: rgba(46,204,113,0.2); border: 1px solid #2ecc71; border-radius: 6px; cursor: pointer; color: #2ecc71; font-weight: bold;">💰 Cash Out</button>
                                    </div>
                                </div>`;
                        }
                    } else {
                        game.player.gold -= bet;
                        ActionMenu._gamblingFinance(game, -bet);
                        currentWinnings = 0;
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e74c3c; font-weight: bold; font-size: 15px;">💸 ${resultName}! You lose ${bet}g.</div>`;
                        if (doubleArea) doubleArea.style.display = 'none';

                        // Re-enable buttons
                        setTimeout(() => {
                            if (dragonBtn && game.player.gold >= 10) dragonBtn.disabled = false;
                            if (shieldBtn && game.player.gold >= 10) shieldBtn.disabled = false;
                        }, 600);
                    }

                    game.ui.updateStats(game.player, game.world);
                }
            }, 80);
        };

        window._dfDoubleOrNothing = (call) => {
            const coinArea = document.getElementById('dfCoinArea');
            const resultArea = document.getElementById('dfResult');
            const doubleArea = document.getElementById('dfDoubleArea');

            let flipCount = 0;
            const faces = ['🐉', '🛡️'];
            const flipInterval = setInterval(() => {
                if (coinArea) {
                    coinArea.textContent = faces[flipCount % 2];
                    coinArea.style.transform = `rotateY(${flipCount * 180}deg)`;
                }
                flipCount++;
                if (flipCount >= 10) {
                    clearInterval(flipInterval);

                    const luckBonus = Math.min((game.player.luck || 5) * 0.006, 0.04) + ActionMenu._getTavernLuckBonus(tile);
                    const result = Math.random() < ((cfg.doubleOrNothingWinChance ?? 0.46) + luckBonus) ? call : (call === 'dragon' ? 'shield' : 'dragon');
                    const won = result === call;
                    const resultIcon = result === 'dragon' ? '🐉' : '🛡️';

                    if (coinArea) {
                        coinArea.textContent = resultIcon;
                        coinArea.style.transform = 'rotateY(0deg)';
                    }

                    if (won) {
                        currentWinnings *= 2;
                        game.player.gold += currentWinnings / 2; // Double the previous winnings
                        ActionMenu._gamblingFinance(game, currentWinnings / 2);
                        if (resultArea) resultArea.innerHTML = `<div style="color: #2ecc71; font-weight: bold; font-size: 15px;">🔥 DOUBLED! Winnings: ${currentWinnings}g!</div>`;
                        // Update double-or-nothing display
                        if (doubleArea) {
                            doubleArea.innerHTML = `
                                <div style="padding: 12px; background: rgba(245,197,66,0.08); border: 1px solid var(--border-color); border-radius: 8px;">
                                    <div style="font-size: 13px; color: var(--gold); margin-bottom: 8px;">🔥🔥 Double again? (${currentWinnings}g at stake!)</div>
                                    <div style="display: flex; gap: 10px; justify-content: center;">
                                        <button onclick="window._dfDoubleOrNothing('dragon')" style="padding: 8px 20px; background: rgba(231,76,60,0.2); border: 1px solid #e74c3c; border-radius: 6px; cursor: pointer; color: var(--text-primary);">🐉 Dragon</button>
                                        <button onclick="window._dfDoubleOrNothing('shield')" style="padding: 8px 20px; background: rgba(52,152,219,0.2); border: 1px solid #3498db; border-radius: 6px; cursor: pointer; color: var(--text-primary);">🛡️ Shield</button>
                                        <button onclick="window._dfCashOut()" style="padding: 8px 20px; background: rgba(46,204,113,0.2); border: 1px solid #2ecc71; border-radius: 6px; cursor: pointer; color: #2ecc71; font-weight: bold;">💰 Cash Out</button>
                                    </div>
                                </div>`;
                        }
                    } else {
                        // Lose everything from double-or-nothing
                        game.player.gold -= currentWinnings / 2;
                        ActionMenu._gamblingFinance(game, -(currentWinnings / 2));
                        currentWinnings = 0;
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e74c3c; font-weight: bold; font-size: 15px;">💀 Bust! Lost it all on the double!</div>`;
                        if (doubleArea) doubleArea.style.display = 'none';
                        coinArea.style.boxShadow = '0 4px 30px rgba(231,76,60,0.5)';

                        // Re-enable main buttons
                        setTimeout(() => {
                            const dragonBtn = document.getElementById('dfDragonBtn');
                            const shieldBtn = document.getElementById('dfShieldBtn');
                            if (dragonBtn && game.player.gold >= 10) dragonBtn.disabled = false;
                            if (shieldBtn && game.player.gold >= 10) shieldBtn.disabled = false;
                        }, 600);
                    }
                    game.ui.updateStats(game.player, game.world);
                }
            }, 80);
        };

        window._dfCashOut = () => {
            game.ui.showNotification('💰 Cashed Out!', `You walk away with ${currentWinnings}g in your pocket.`, 'success');
            currentWinnings = 0;
            const doubleArea = document.getElementById('dfDoubleArea');
            if (doubleArea) doubleArea.style.display = 'none';
            const dragonBtn = document.getElementById('dfDragonBtn');
            const shieldBtn = document.getElementById('dfShieldBtn');
            if (dragonBtn) dragonBtn.disabled = false;
            if (shieldBtn) shieldBtn.disabled = false;
            const coinArea = document.getElementById('dfCoinArea');
            if (coinArea) { coinArea.textContent = '❓'; coinArea.style.boxShadow = '0 4px 20px rgba(245,197,66,0.3)'; }
            const resultArea = document.getElementById('dfResult');
            if (resultArea) resultArea.innerHTML = '';
        };
    },

    // ── MINIGAME 3: High-Low ────────────────────────────────
    _minigameHighLow(game, tile) {
        const gold = game.player.gold;
        const cfg = ActionMenu._getGamblingGame('high_low');
        const maxBet = Math.min(cfg.maxBet, gold);

        const cardValues = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        const cardSuits = ['♠', '♥', '♦', '♣'];
        const cardNumeric = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
        const suitColors = { '♠': '#aaa', '♥': '#e74c3c', '♦': '#3498db', '♣': '#2ecc71' };

        const drawCard = () => {
            const value = cardValues[Math.floor(Math.random() * cardValues.length)];
            const suit = cardSuits[Math.floor(Math.random() * cardSuits.length)];
            return { value, suit, numeric: cardNumeric[value] };
        };

        const renderCard = (card, faceDown = false) => {
            if (faceDown) {
                return `<div style="width: 80px; height: 110px; background: linear-gradient(135deg, #2c3e50, #34495e); border: 2px solid var(--border-bright); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 28px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">🂠</div>`;
            }
            const color = suitColors[card.suit] || '#aaa';
            return `<div style="width: 80px; height: 110px; background: linear-gradient(135deg, #1a1a2e, #16213e); border: 2px solid ${color}; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                        <div style="font-size: 24px; font-weight: bold; color: ${color}; font-family: var(--font-display);">${card.value}</div>
                        <div style="font-size: 20px; color: ${color};">${card.suit}</div>
                    </div>`;
        };

        let currentCard = drawCard();
        let revealedCard = null;
        let streak = 0;
        let bet = 0;
        let inRound = false;

        const renderHL = () => {
            let html = '<div style="width: 100%; box-sizing: border-box; text-align: center;">';
            html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <button onclick="ActionMenu.showGamblingMenu(window._gambGame, window._gambTile)" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px;">← Back</button>
                        <span style="color: var(--gold); font-weight: bold;">💰 ${Math.floor(game.player.gold)}g</span>
                     </div>`;
            html += '<h4 style="margin: 0 0 4px;">🃏 High-Low</h4>';
            html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">Guess if the next card is Higher or Lower. Keep your streak for bigger payouts!</p>';

            if (!inRound) {
                // Bet phase
                html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; justify-content: center;">
                            <span style="font-size: 12px; color: var(--text-secondary);">Bet:</span>
                            <input type="range" id="hlBet" min="${cfg.minBet}" max="${Math.min(cfg.maxBet, game.player.gold)}" value="${Math.min(20, game.player.gold)}"
                                   oninput="document.getElementById('hlBetLabel').textContent = this.value"
                                   style="width: 180px; accent-color: var(--gold);">
                            <span id="hlBetLabel" style="color: var(--gold); font-weight: bold; min-width: 40px;">${Math.min(20, game.player.gold)}</span>g
                         </div>`;

                html += `<div style="display: flex; justify-content: center; gap: 16px; margin-bottom: 16px;">
                            ${renderCard(currentCard)}
                            ${revealedCard ? renderCard(revealedCard) : renderCard(null, true)}
                         </div>`;

                html += `<button onclick="window._hlStartRound()" 
                            style="padding: 10px 32px; background: #2ecc71; color: white; border: none; border-radius: 6px; cursor: pointer;
                                   font-family: var(--font-display); font-size: 14px; letter-spacing: 1px;">
                            Deal & Start
                         </button>`;
            } else {
                // Playing phase
                const multiplier = 1 + streak * (cfg.streakBonus ?? 0.5);
                const potentialWin = Math.floor(bet * multiplier);

                html += `<div style="display: flex; justify-content: center; gap: 24px; margin-bottom: 8px;">
                            <div style="font-size: 12px; color: var(--text-secondary);">Streak: <span style="color: ${streak > 0 ? '#2ecc71' : 'var(--text-muted)'}; font-weight: bold;">${streak}</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">Multiplier: <span style="color: var(--gold); font-weight: bold;">${multiplier.toFixed(1)}x</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary);">Pot: <span style="color: #2ecc71; font-weight: bold;">${potentialWin}g</span></div>
                         </div>`;

                html += `<div style="display: flex; justify-content: center; gap: 16px; margin: 20px 0;">
                            ${renderCard(currentCard)}
                            ${revealedCard ? renderCard(revealedCard) : renderCard(null, true)}
                         </div>`;

                html += `<div style="display: flex; gap: 10px; justify-content: center; margin-bottom: 12px;">
                            <button onclick="window._hlGuess('higher')"
                                style="padding: 10px 24px; background: rgba(46,204,113,0.2); border: 2px solid #2ecc71;
                                       border-radius: 8px; cursor: pointer; color: var(--text-primary); font-size: 14px; transition: all 0.15s;"
                                onmouseenter="this.style.background='rgba(46,204,113,0.35)'" onmouseleave="this.style.background='rgba(46,204,113,0.2)'">
                                ⬆️ Higher
                            </button>
                            <button onclick="window._hlCashOut()"
                                style="padding: 10px 24px; background: rgba(245,197,66,0.15); border: 2px solid var(--gold);
                                       border-radius: 8px; cursor: pointer; color: var(--gold); font-weight: bold; font-size: 14px; transition: all 0.15s;"
                                onmouseenter="this.style.background='rgba(245,197,66,0.25)'" onmouseleave="this.style.background='rgba(245,197,66,0.15)'"
                                ${streak === 0 ? 'disabled style="opacity:0.4; pointer-events:none; padding: 10px 24px; background: rgba(245,197,66,0.15); border: 2px solid var(--gold); border-radius: 8px; color: var(--gold); font-weight: bold; font-size: 14px;"' : ''}>
                                💰 Cash Out (${potentialWin}g)
                            </button>
                            <button onclick="window._hlGuess('lower')"
                                style="padding: 10px 24px; background: rgba(231,76,60,0.2); border: 2px solid #e74c3c;
                                       border-radius: 8px; cursor: pointer; color: var(--text-primary); font-size: 14px; transition: all 0.15s;"
                                onmouseenter="this.style.background='rgba(231,76,60,0.35)'" onmouseleave="this.style.background='rgba(231,76,60,0.2)'">
                                ⬇️ Lower
                            </button>
                         </div>`;
            }

            html += '<div id="hlResult" style="min-height: 24px; margin-top: 8px;"></div>';
            html += '</div>';
            return html;
        };

        game.ui.showCustomPanel('🃏 High-Low', renderHL());
        window._gambGame = game;
        window._gambTile = tile;

        window._hlStartRound = () => {
            if (!ActionMenu._gamblingCheckAP(game, tile)) return;
            bet = parseInt(document.getElementById('hlBet')?.value || 20);
            if (bet > game.player.gold) {
                game.ui.showNotification('Not Enough', "You don't have enough gold!", 'error');
                return;
            }
            game.player.gold -= bet;
            game.ui.updateStats(game.player, game.world);
            currentCard = drawCard();
            revealedCard = null;
            streak = 0;
            inRound = true;
            game.ui.showCustomPanel('🃏 High-Low', renderHL());
        };

        window._hlGuess = (guess) => {
            const nextCard = drawCard();
            const oldCard = currentCard;

            // Determine winner
            let correct = false;
            if (guess === 'higher') correct = nextCard.numeric > oldCard.numeric;
            else correct = nextCard.numeric < oldCard.numeric;

            // Tie = push (re-draw, no penalty)
            if (nextCard.numeric === oldCard.numeric) {
                revealedCard = nextCard;
                game.ui.showCustomPanel('🃏 High-Low', renderHL());
                setTimeout(() => {
                    const res = document.getElementById('hlResult');
                    if (res) res.innerHTML = `<div style="color: var(--gold); font-size: 13px;">🤝 Tie! Same value — draw again.</div>`;
                }, 50);
                // After a brief pause, advance to next draw
                setTimeout(() => { revealedCard = null; currentCard = nextCard; game.ui.showCustomPanel('🃏 High-Low', renderHL()); }, 1500);
                return;
            }

            if (correct) {
                streak++;
                revealedCard = nextCard;
                game.ui.showCustomPanel('🃏 High-Low', renderHL());
                setTimeout(() => {
                    const res = document.getElementById('hlResult');
                    if (res) res.innerHTML = `<div style="color: #2ecc71; font-size: 13px;">✅ Correct! ${nextCard.value}${nextCard.suit} — Streak: ${streak}!</div>`;
                }, 50);
                // After a brief pause, shift the revealed card to become the current card
                setTimeout(() => { revealedCard = null; currentCard = nextCard; game.ui.showCustomPanel('🃏 High-Low', renderHL()); }, 1500);
            } else {
                // Lose
                ActionMenu._gamblingFinance(game, -bet);
                revealedCard = nextCard;
                inRound = false;
                game.ui.showCustomPanel('🃏 High-Low', renderHL());
                setTimeout(() => {
                    const res = document.getElementById('hlResult');
                    if (res) res.innerHTML = `<div style="color: #e74c3c; font-size: 14px; font-weight: bold;">❌ Wrong! It was ${nextCard.value}${nextCard.suit}. Lost ${bet}g! 💸</div>`;
                }, 50);
                // After showing the result, reset for next round
                setTimeout(() => { revealedCard = null; currentCard = drawCard(); game.ui.showCustomPanel('🃏 High-Low', renderHL()); }, 2000);
                game.ui.updateStats(game.player, game.world);
            }
        };

        window._hlCashOut = () => {
            if (streak === 0) return;
            const multiplier = 1 + streak * (cfg.streakBonus ?? 0.5);
            const winnings = Math.floor(bet * multiplier);
            game.player.gold += winnings;
            ActionMenu._gamblingFinance(game, winnings - bet);
            game.ui.showNotification('💰 Cashed Out!', `Streak of ${streak}! Won ${winnings}g (${multiplier.toFixed(1)}x)!`, 'success');
            inRound = false;
            streak = 0;
            revealedCard = null;
            currentCard = drawCard();
            game.ui.showCustomPanel('🃏 High-Low', renderHL());
            game.ui.updateStats(game.player, game.world);
        };
    },

    /**
     * Show busking / street performance menu
     */
    showBuskingMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        const performances = ActionMenu._getBuskingData();
        // Bigger places draw bigger crowds (data/earlyJobs.json busking.crowdSizeMultiplier)
        const crowdTable = (DataLoader.earlyJobs && DataLoader.earlyJobs.busking && DataLoader.earlyJobs.busking.crowdSizeMultiplier)
            || { village: 0.5, town: 1.0, city: 1.4, capital: 1.8 };
        const crowdMultiplier = crowdTable[settlement.type] ?? crowdTable.town ?? 1.0;

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🎭 Street Performance</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Pick a performance to entertain the crowd in ${settlement.name}.</p>`;
        html += `<p style="font-size: 11px; color: #aaa; margin-bottom: 12px;">Crowd size: <span style="color: var(--gold);">${crowdMultiplier >= 1.4 ? 'Large' : crowdMultiplier >= 1 ? 'Moderate' : 'Small'}</span> (${crowdMultiplier}x)</p>`;

        for (const perf of performances) {
            const statVal = ActionMenu._getPlayerStat(game.player, perf.stat);
            const statLabel = perf.stat.charAt(0).toUpperCase() + perf.stat.slice(1);

            html += `
                <button onclick="window._startBuskPerf('${perf.id}')"
                    style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 8px;
                           background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid #e67e22;
                           border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                    onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                    <span style="font-size: 28px;">${perf.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 13px;">${perf.name}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${perf.description}</div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${statLabel}: ${statVal}</div>
                    </div>
                    <div style="font-size: 12px; color: #e67e22; font-weight: 600;">▶ Perform</div>
                </button>
            `;
        }

        html += `<button data-am-act="closePanel"
            style="margin-top: 6px; padding: 8px 20px; background: none; border: 1px solid rgba(255,255,255,0.1);
                   border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">
            Cancel
        </button>`;
        html += '</div>';
        game.ui.showCustomPanel('Street Performance', html);

        window._startBuskPerf = (perfId) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            // The act is performed in person on the street map (ui/mapTasks/performTasks.js)
            switch (perfId) {
                case 'juggling': ActionMenu._buskJuggling(game, tile, crowdMultiplier); break;
                case 'singing': ActionMenu._buskSinging(game, tile, crowdMultiplier); break;
                case 'storytelling': ActionMenu._buskStorytelling(game, tile, crowdMultiplier); break;
                case 'fortune_telling': ActionMenu._buskFortuneTelling(game, tile, crowdMultiplier); break;
                case 'preaching': ActionMenu._buskPreaching(game, tile, crowdMultiplier); break;
            }
        };
    },

    /**
     * Common reward handler for all busking minigames.
     * scorePercent: 0-100 how well the player performed
     */
    _buskingReward(game, tile, crowdMultiplier, perfId, scorePercent) {
        const perf = ActionMenu._getBuskingData().find(p => p.id === perfId);
        if (!perf) return;

        const player = game.player;
        const statVal = ActionMenu._getPlayerStat(player, perf.stat);
        const basePay = perf.basePay.min + Math.floor(Math.random() * (perf.basePay.max - perf.basePay.min + 1));
        const qualityMult = 0.2 + (scorePercent / 100) * 1.3;
        const actualPay = Math.max(1, Math.floor(basePay * crowdMultiplier * qualityMult * (1 + statVal * 0.08)));

        player.gold += actualPay;
        if (scorePercent >= 40) player.renown += 1;

        if (perf.bonusKarma && scorePercent >= 25) {
            player.karma = (player.karma || 0) + 1;
        }

        if (!player.performancesGiven) player.performancesGiven = 0;
        player.performancesGiven++;

        // Diplomacy skill up chance — better performance = better chance
        if (player.skills && Math.random() < 0.1 + scorePercent * 0.002) {
            player.skills.diplomacy = Math.min(10, (player.skills.diplomacy || 1) + 0.1);
        }

        // Finance tracking
        if (player.financeToday) {
            player.financeToday.income.busking = (player.financeToday.income.busking || 0) + actualPay;
        }

        // Rating text
        const rating = scorePercent >= 90 ? 'Standing Ovation! 🌟' : scorePercent >= 70 ? 'Great Show! 👏' : scorePercent >= 50 ? 'Decent Performance 👍' : scorePercent >= 25 ? 'Rough Show 😐' : 'The crowd wandered off 😬';
        const ratingColor = scorePercent >= 90 ? '#f1c40f' : scorePercent >= 70 ? '#2ecc71' : scorePercent >= 50 ? '#3498db' : scorePercent >= 25 ? '#f39c12' : '#e74c3c';

        // Stars (0-5)
        const stars = Math.round(scorePercent / 20);
        let starsHtml = '';
        for (let i = 0; i < 5; i++) starsHtml += i < stars ? '⭐' : '☆';

        let html = '<div style="max-width: 450px; text-align: center;">';
        html += `<div style="font-size: 48px; margin: 16px 0;">${perf.icon}</div>`;
        html += `<div style="font-size: 18px; color: ${ratingColor}; font-weight: bold; margin-bottom: 6px;">${rating}</div>`;
        html += `<div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 10px;">${perf.name}</div>`;
        html += `<div style="margin-bottom: 12px; font-size: 20px; letter-spacing: 4px;">${starsHtml}</div>`;
        html += `<div style="font-size: 24px; color: var(--gold); font-weight: bold; margin: 8px 0;">+${actualPay} gold</div>`;
        if (scorePercent >= 40) html += `<div style="font-size: 12px; color: #9b59b6;">+1 Renown</div>`;
        if (perf.bonusKarma && scorePercent >= 25) html += `<div style="font-size: 12px; color: #2ecc71;">+1 Karma</div>`;

        html += `<button data-am-act="closePanel"
            style="padding: 10px 32px; margin-top: 16px; background: linear-gradient(135deg, var(--gold), #d4a030); color: #1a1a2e; border: none;
                   border-radius: 6px; cursor: pointer; font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;">
            Continue
        </button>`;
        html += '</div>';

        game.ui.showCustomPanel('🎭 Performance Complete', html);
        game.ui.updateStats(player, game.world);
        game.endDay();
    },

    // ── Busking acts: performed in person on the street map ──
    // The old busking minigames (catch, rhythm, word chain, cold reading,
    // sermon fervour) are gone: each act is now a task at a pitch in town
    // (ui/mapTasks/performTasks.js) whose crowd sets the score fed to
    // _buskingReward. These names stay as the entry points per act.
    _buskJuggling(game, tile, crowdMultiplier) { _buskInPerson(game, tile, crowdMultiplier, 'juggling'); },
    _buskSinging(game, tile, crowdMultiplier) { _buskInPerson(game, tile, crowdMultiplier, 'singing'); },
    _buskStorytelling(game, tile, crowdMultiplier) { _buskInPerson(game, tile, crowdMultiplier, 'storytelling'); },
    _buskFortuneTelling(game, tile, crowdMultiplier) { _buskInPerson(game, tile, crowdMultiplier, 'fortune_telling'); },
    _buskPreaching(game, tile, crowdMultiplier) { _buskInPerson(game, tile, crowdMultiplier, 'preaching'); },

    // ── Data helpers for early-game income ──
    _getJobData() {
        // Try to load from DataLoader if available
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.oddJobs) {
            return DataLoader.earlyJobs.oddJobs.settlement_jobs;
        }
        // Inline fallback
        return {
            village: [
                { id: 'farm_hand', name: 'Farm Hand', icon: '🌾', description: 'Help local farmers with planting and harvesting.', pay: { min: 10, max: 25 }, stat: 'strength', difficulty: 3 },
                { id: 'woodcutter', name: 'Woodcutter', icon: '🪓', description: 'Chop firewood for the village hearths.', pay: { min: 12, max: 22 }, stat: 'strength', difficulty: 3 },
                { id: 'shepherd', name: 'Shepherd', icon: '🐑', description: 'Watch over the village flock for the day.', pay: { min: 8, max: 15 }, stat: 'intelligence', difficulty: 2 },
                { id: 'herb_picker', name: 'Herb Picker', icon: '🌿', description: 'Gather medicinal herbs for the local healer.', pay: { min: 10, max: 20 }, stat: 'intelligence', difficulty: 3 },
            ],
            town: [
                { id: 'dock_worker', name: 'Dock Worker', icon: '📦', description: 'Load and unload merchant wagons at the market.', pay: { min: 18, max: 35 }, stat: 'strength', difficulty: 4 },
                { id: 'courier', name: 'Courier', icon: '📨', description: 'Deliver messages and parcels around town.', pay: { min: 15, max: 30 }, stat: 'stamina', difficulty: 3 },
                { id: 'tavern_bouncer', name: 'Tavern Bouncer', icon: '💪', description: 'Keep the peace at a rowdy tavern tonight.', pay: { min: 20, max: 45 }, stat: 'strength', difficulty: 5 },
                { id: 'rat_catcher', name: 'Rat Catcher', icon: '🐀', description: 'Clear vermin from cellars and granaries.', pay: { min: 15, max: 30 }, stat: 'stealth', difficulty: 3 },
                { id: 'scribe_assistant', name: "Scribe's Assistant", icon: '📝', description: 'Help copy documents and ledgers.', pay: { min: 22, max: 40 }, stat: 'intelligence', difficulty: 5 },
                { id: 'night_watch', name: 'Night Watch', icon: '🔦', description: 'Patrol the town walls through the night.', pay: { min: 18, max: 35 }, stat: 'combat', difficulty: 4 },
            ],
            capital: [
                { id: 'warehouse_guard', name: 'Warehouse Guard', icon: '🛡️', description: "Guard a merchant's warehouse for the day.", pay: { min: 30, max: 55 }, stat: 'combat', difficulty: 4 },
                { id: 'cargo_hauler', name: 'Cargo Hauler', icon: '🏋️', description: 'Move heavy goods between market districts.', pay: { min: 25, max: 50 }, stat: 'strength', difficulty: 5 },
                { id: 'arena_fighter', name: 'Arena Fighter', icon: '🗡️', description: 'Fight in exhibition matches for the crowd.', pay: { min: 40, max: 80 }, stat: 'combat', difficulty: 7 },
                { id: 'herald', name: 'Herald', icon: '📯', description: 'Read royal proclamations in the city square.', pay: { min: 25, max: 50 }, stat: 'charisma', difficulty: 5 },
                { id: 'tutor', name: 'Tutor', icon: '📖', description: "Teach a noble's children reading and arithmetic.", pay: { min: 30, max: 55 }, stat: 'intelligence', difficulty: 6 },
                { id: 'pit_fighter', name: 'Pit Fighter', icon: '⚔️', description: 'Bare-knuckle brawling in the underground pits.', pay: { min: 35, max: 75 }, stat: 'combat', difficulty: 7 },
            ],
        };
    },

    _getForageData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.foraging) {
            return DataLoader.earlyJobs.foraging;
        }
        return {
            terrain_mapping: {
                forest: 'forest', dense_forest: 'forest', woodland: 'forest',
                boreal_forest: 'forest', seasonal_forest: 'forest',
                temperate_rainforest: 'forest', tropical_rainforest: 'forest',
                plains: 'plains', grassland: 'plains', steppe: 'plains', savanna: 'plains',
                hills: 'hills', highlands: 'hills', mountain: 'hills',
                coast: 'coast', beach: 'coast',
                desert: 'desert', arid: 'desert', semi_arid: 'desert',
                swamp: 'swamp', marsh: 'swamp', wetland: 'swamp', mangrove: 'swamp', tropical_wetland: 'swamp',
            },
            loot_table: {
                forest: [
                    { item: 'herbs', name: 'Wild Herbs', icon: '🌿', chance: 0.40, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'berries', name: 'Wild Berries', icon: '🍇', chance: 0.35, qty: { min: 2, max: 5 }, sellPrice: 3 },
                    { item: 'mushrooms', name: 'Mushrooms', icon: '🍄', chance: 0.25, qty: { min: 1, max: 4 }, sellPrice: 4 },
                    { item: 'honey', name: 'Wild Honey', icon: '🍯', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 12 },
                    { item: 'truffles', name: 'Truffles', icon: '🟤', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 25 },
                ],
                plains: [
                    { item: 'herbs', name: 'Prairie Herbs', icon: '🌿', chance: 0.35, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'berries', name: 'Wild Berries', icon: '🍇', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 3 },
                    { item: 'flax', name: 'Wild Flax', icon: '🌾', chance: 0.20, qty: { min: 1, max: 3 }, sellPrice: 6 },
                    { item: 'feathers', name: 'Feathers', icon: '🦅', chance: 0.15, qty: { min: 2, max: 5 }, sellPrice: 4 },
                ],
                hills: [
                    { item: 'herbs', name: 'Mountain Herbs', icon: '🌿', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 7 },
                    { item: 'stone', name: 'Loose Stone', icon: '⛰️', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 3 },
                    { item: 'ore_scraps', name: 'Ore Scraps', icon: '⛰️', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 10 },
                    { item: 'fossils', name: 'Fossils', icon: '🦴', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 20 },
                ],
                coast: [
                    { item: 'shells', name: 'Shells', icon: '🐚', chance: 0.40, qty: { min: 2, max: 6 }, sellPrice: 2 },
                    { item: 'driftwood', name: 'Driftwood', icon: '🌲', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 4 },
                    { item: 'seaweed', name: 'Edible Seaweed', icon: '🌊', chance: 0.25, qty: { min: 2, max: 4 }, sellPrice: 3 },
                    { item: 'pearls', name: 'Pearls', icon: '🔮', chance: 0.03, qty: { min: 1, max: 1 }, sellPrice: 35 },
                    { item: 'ambergris', name: 'Ambergris', icon: '🟡', chance: 0.02, qty: { min: 1, max: 1 }, sellPrice: 50 },
                ],
                desert: [
                    { item: 'cactus_fruit', name: 'Cactus Fruit', icon: '🌵', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 6 },
                    { item: 'scorpion_venom', name: 'Scorpion Venom', icon: '🦂', chance: 0.10, qty: { min: 1, max: 1 }, sellPrice: 15 },
                    { item: 'desert_rose', name: 'Desert Rose', icon: '🌹', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 20 },
                ],
                swamp: [
                    { item: 'leeches', name: 'Medicinal Leeches', icon: '🐛', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 8 },
                    { item: 'mushrooms', name: 'Swamp Mushrooms', icon: '🍄', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'peat', name: 'Peat', icon: '🟫', chance: 0.20, qty: { min: 2, max: 4 }, sellPrice: 4 },
                    { item: 'rare_frog', name: 'Rare Frog', icon: '🐸', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 30 },
                ],
            },
        };
    },

    _getHuntData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.hunting) {
            return DataLoader.earlyJobs.hunting;
        }
        return {
            loot_table: {
                forest: [
                    { item: 'game_meat', name: 'Venison', icon: '🥩', chance: 0.35, qty: { min: 1, max: 3 }, sellPrice: 8 },
                    { item: 'pelts', name: 'Fur Pelts', icon: '🦊', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 12 },
                    { item: 'antlers', name: 'Antlers', icon: '🦌', chance: 0.15, qty: { min: 1, max: 1 }, sellPrice: 15 },
                    { item: 'bear_pelt', name: 'Bear Pelt', icon: '🐻', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 40 },
                ],
                plains: [
                    { item: 'game_meat', name: 'Game Meat', icon: '🥩', chance: 0.40, qty: { min: 1, max: 4 }, sellPrice: 6 },
                    { item: 'hides', name: 'Hides', icon: '🟤', chance: 0.35, qty: { min: 1, max: 2 }, sellPrice: 8 },
                    { item: 'feathers', name: 'Feathers', icon: '🦅', chance: 0.25, qty: { min: 2, max: 5 }, sellPrice: 4 },
                    { item: 'ivory', name: 'Ivory', icon: '🐘', chance: 0.03, qty: { min: 1, max: 1 }, sellPrice: 45 },
                ],
                hills: [
                    { item: 'game_meat', name: 'Mountain Goat', icon: '🥩', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 7 },
                    { item: 'pelts', name: 'Wolf Pelts', icon: '🐺', chance: 0.20, qty: { min: 1, max: 2 }, sellPrice: 14 },
                    { item: 'eagle_feathers', name: 'Eagle Feathers', icon: '🦅', chance: 0.10, qty: { min: 1, max: 2 }, sellPrice: 18 },
                ],
                coast: [
                    { item: 'fish', name: 'Fresh Fish', icon: '🐟', chance: 0.50, qty: { min: 2, max: 5 }, sellPrice: 4 },
                    { item: 'crabs', name: 'Crabs', icon: '🦀', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 6 },
                    { item: 'lobster', name: 'Lobster', icon: '🦞', chance: 0.10, qty: { min: 1, max: 1 }, sellPrice: 18 },
                ],
            },
        };
    },

    _getBountyData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.bountyBoard) {
            return DataLoader.earlyJobs.bountyBoard.templates;
        }
        return [
            { id: 'deliver_message', name: 'Deliver a Message', icon: '📨', description: 'Carry a sealed letter to {destination}.', type: 'delivery', pay: { min: 30, max: 80 }, daysLimit: 10, difficulty: 'easy' },
            { id: 'deliver_package', name: 'Deliver a Package', icon: '📦', description: 'Transport a fragile package safely to {destination}.', type: 'delivery', pay: { min: 50, max: 120 }, daysLimit: 12, difficulty: 'easy' },
            { id: 'scout_area', name: 'Scout the Wilds', icon: '🔭', description: 'Explore and map {count} tiles.', type: 'explore', pay: { min: 40, max: 90 }, exploreCount: 15, daysLimit: 8, difficulty: 'easy' },
            { id: 'clear_pests', name: 'Clear Pests', icon: '🐀', description: 'Drive out {pest} plaguing the {location}.', type: 'instant', pay: { min: 25, max: 60 }, stat: 'combat', difficulty: 'easy' },
            { id: 'wanted_thief', name: 'Catch a Thief', icon: '🏴‍☠️', description: 'A petty thief is hiding in the area.', type: 'instant', pay: { min: 50, max: 120 }, stat: 'stealth', difficulty: 'medium' },
            { id: 'escort_merchant', name: 'Escort Merchant', icon: '🛡️', description: 'Protect a merchant traveling to {destination}.', type: 'delivery', pay: { min: 80, max: 180 }, daysLimit: 14, difficulty: 'medium' },
        ];
    },

    /** Fallback gambling config, used only when data/earlyJobs.json has no gambling section. */
    DEFAULT_GAMBLING: {
        apCostPerRound: 2,
        tavernLuckBonus: 0.05,
        tavernTableLuckBonus: 0.02,
        games: [
            { id: 'crown_anchor', name: 'Crown & Anchor', icon: '🎲', color: '#9b59b6', description: 'Pick a symbol, roll 3 dice. The more matches, the bigger the payout!', minBet: 5, maxBet: 500, matchChance: 1 / 6, payoutPerMatch: 1 },
            { id: 'dragons_flip', name: "Dragon's Flip", icon: '🐉', color: '#e67e22', description: 'Call Dragon or Shield. Double or nothing — simple and deadly.', minBet: 10, maxBet: 500, winChance: 0.48, doubleOrNothingWinChance: 0.46, payoutMultiplier: 2 },
            { id: 'high_low', name: 'High-Low', icon: '🃏', color: '#2ecc71', description: 'Guess if the next card is higher or lower. Build streaks for bigger payouts!', minBet: 5, maxBet: 200, streakBonus: 0.5 },
            { id: 'poker', name: "Texas Hold'em", icon: '🂡', color: '#e74c3c', description: 'Two hole cards, five community cards. Outplay the dealer across four betting rounds!', minBet: 10, maxBet: 500, maxAnte: 200 },
        ],
    },

    /** Gambling settings (data/earlyJobs.json `gambling`), falling back to DEFAULT_GAMBLING. */
    _getGamblingSettings() {
        const data = (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.gambling) || null;
        return data ? { ...ActionMenu.DEFAULT_GAMBLING, ...data } : ActionMenu.DEFAULT_GAMBLING;
    },

    /** The list of gambling minigames offered at the gambling den. */
    _getGamblingData() {
        const games = ActionMenu._getGamblingSettings().games;
        return Array.isArray(games) && games.length > 0 ? games : ActionMenu.DEFAULT_GAMBLING.games;
    },

    /** One minigame's config by id, with per-field fallbacks to the defaults. */
    _getGamblingGame(id) {
        const fallback = ActionMenu.DEFAULT_GAMBLING.games.find(g => g.id === id) || {};
        const fromData = ActionMenu._getGamblingData().find(g => g.id === id) || {};
        return { ...fallback, ...fromData };
    },

    _getBuskingData() {
        if (typeof DataLoader !== 'undefined' && DataLoader.earlyJobs && DataLoader.earlyJobs.busking) {
            return DataLoader.earlyJobs.busking.performances;
        }
        return [
            { id: 'storytelling', name: 'Tell Tales', icon: '📖', description: 'Share stories of your travels and adventures.', stat: 'charisma', basePay: { min: 8, max: 25 } },
            { id: 'singing', name: 'Sing Ballads', icon: '🎵', description: 'Sing old songs and ballads in the market square.', stat: 'charisma', basePay: { min: 10, max: 30 } },
            { id: 'juggling', name: 'Juggle & Tricks', icon: '🤹', description: 'Perform acrobatics and sleight of hand.', stat: 'dexterity', basePay: { min: 8, max: 22 } },
            { id: 'fortune_telling', name: 'Read Fortunes', icon: '🔮', description: 'Tell fortunes and read palms. Mostly made up.', stat: 'intelligence', basePay: { min: 12, max: 35 } },
            { id: 'preaching', name: 'Street Preaching', icon: '📿', description: 'Preach fire and brimstone for donations.', stat: 'faith', basePay: { min: 6, max: 20 }, bonusKarma: true },
        ];
    },

    /**
     * Show a skip/play prompt before a minigame starts.
     * opts: { title, icon, description, baseRewardText, onSkip, onPlay, cancelable }
     */
    _showMinigamePrompt(game, opts) {
        let html = '<div style="text-align: center;">';
        html += `<div style="font-size: 48px; margin: 12px 0;">${opts.icon}</div>`;
        html += `<h4 style="margin: 0 0 6px;">${opts.title}</h4>`;
        if (opts.description) html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px;">${opts.description}</p>`;

        html += `<div style="display: flex; gap: 12px; margin-bottom: 12px;">`;

        // Play button
        html += `<button onclick="window._mgPlay()"
            style="flex: 1; padding: 16px 12px; background: rgba(46,204,113,0.1); border: 2px solid #2ecc71;
                   border-radius: 10px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; text-align: center;"
            onmouseenter="this.style.background='rgba(46,204,113,0.2)'" onmouseleave="this.style.background='rgba(46,204,113,0.1)'">
            <div style="font-size: 22px; margin-bottom: 4px;">🎮</div>
            <div style="font-weight: bold; font-size: 14px; color: #2ecc71;">Play Minigame</div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Earn bonus rewards</div>
        </button>`;

        // Skip button
        html += `<button onclick="window._mgSkip()"
            style="flex: 1; padding: 16px 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
                   border-radius: 10px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; text-align: center;"
            onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
            <div style="font-size: 22px; margin-bottom: 4px;">⏭️</div>
            <div style="font-weight: bold; font-size: 14px; color: var(--text-secondary);">Skip</div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Base reward only</div>
        </button>`;

        html += `</div>`;

        // Base reward preview
        if (opts.baseRewardText) {
            html += `<div style="padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; font-size: 11px; color: var(--text-muted);">
                <span style="color: var(--text-secondary);">Base reward:</span> ${opts.baseRewardText}
            </div>`;
        }

        if (opts.cancelable) {
            html += `<button data-am-act="closePanel"
                style="margin-top: 8px; padding: 6px 16px; background: none; border: 1px solid rgba(255,255,255,0.08);
                       border-radius: 6px; cursor: pointer; color: var(--text-muted); font-size: 11px;">Cancel</button>`;
        }

        html += '</div>';
        game.ui.showCustomPanel(opts.title, html);
        window._mgPlay = opts.onPlay;
        window._mgSkip = opts.onSkip;
    },

    /**
     * Get a player stat value with fallbacks for different stat names
     */
    _getPlayerStat(player, stat) {
        // Direct attribute
        if (player[stat] !== undefined) return player[stat];
        // Skill
        if (player.skills && player.skills[stat] !== undefined) return player.skills[stat];
        // Mappings for convenience
        const aliases = {
            stamina: 'maxStamina',
            dexterity: 'luck',
            combat: 'strength',
        };
        if (aliases[stat] && player[aliases[stat]] !== undefined) return player[aliases[stat]];
        if (aliases[stat] && player.skills && player.skills[aliases[stat]] !== undefined) return player.skills[aliases[stat]];
        return 5; // Default
    },
});
