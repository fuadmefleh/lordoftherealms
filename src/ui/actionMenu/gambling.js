// ActionMenu — gambling methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { Traits } from '../../systems/traits.js';
import { PerformTasks } from '../mapTasks/performTasks.js';
import { OddJobs } from '../../player/oddJobs.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader } from './_imports.js';
import { lede, chips, purse, sectionHead, rowList, card, kv, price, BTN_GOLD, BTN_PLAIN, BTN_DARK, BTN_OFF } from './uiKit.js';
import { BackRooms } from '../../systems/backRooms.js';
import { ParentsGuard } from '../parentsGuard.js';

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

/**
 * The top of a gambling table: ← Back to the den, and the purse as a chip.
 * goldId names the purse value so a table can refresh it in place.
 */
function _tableTop(gold, goldId = '') {
    return `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <button onclick="ActionMenu.showGamblingMenu(window._gambGame, window._gambTile)" style="${BTN_DARK} margin:0;">← Back</button>
        <span class="pk-chip gold">💰 Purse <b${goldId ? ` id="${goldId}"` : ''}>${gold}g</b></span>
    </div>`;
}

/** Crown & Anchor's symbol tiles: idle look (the selected tile lights gold). */
const CA_IDLE_BG = 'rgba(255,255,255,0.03)';
const CA_IDLE_EDGE = 'rgba(245,197,66,0.14)';

/** Dragon's Flip: the double-or-nothing offer after a win (call again, or cash out). */
function _dfDoubleBox(titleHtml) {
    const B = 'margin:0; padding: 7px 18px;';
    return card(`<div style="display: flex; gap: 10px; justify-content: center;">
            <button onclick="window._dfDoubleOrNothing('dragon')" style="${BTN_GOLD} ${B}">🐉 Dragon</button>
            <button onclick="window._dfDoubleOrNothing('shield')" style="${BTN_GOLD} ${B}">🛡️ Shield</button>
            <button onclick="window._dfCashOut()" style="${BTN_PLAIN} ${B} color:#8fd18a; border-color:rgba(143,209,138,0.5);">💰 Cash Out</button>
        </div>`, { title: titleHtml, tone: 'gold' });
}

/** A bet slider in the kit's quiet voice: label, range input, live value. */
function _betSlider(label, id, labelId, min, max, value, width = 180) {
    return `<div style="display:flex; align-items:center; gap:8px; justify-content:center; margin:6px 0 14px;">
        <span style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#9d937c;">${label}</span>
        <input type="range" id="${id}" min="${min}" max="${max}" value="${value}"
            oninput="document.getElementById('${labelId}').textContent = this.value"
            style="width:${width}px; accent-color:#ffcf6a;">
        <span style="color:#ffcf6a; font-weight:700; min-width:40px;"><span id="${labelId}">${value}</span>g</span>
    </div>`;
}

Object.assign(ActionMenu, {
    /**
     * Show gambling menu — pick a minigame
     */
    showGamblingMenu(game, tile) {
        // Your parents' rules at this door too (ui/parentsGuard.js)
        if (!ParentsGuard.ok(game, 'gambling', tile)) return;
        // Where the realm or the town forbids gaming, the tables are only to be
        // had in a back room behind some legitimate front (systems/backRooms.js)
        const gaming = tile.settlement ? BackRooms.status(game.world, tile.settlement) : { legal: true };
        if (!gaming.legal && !BackRooms.admitted(game.player, game.world, tile)) {
            ActionMenu.showBackRoomDoor(game, tile);
            return;
        }
        const underground = !gaming.legal;
        const inOwnRoom = underground && game.player._backRoom && game.player._backRoom.gameId === 'own';
        const gold = game.player.gold;
        // Check if player owns a tavern here (its house advantage holds in the open, or in its own back room)
        const ownsTavern = (!underground || inOwnRoom) && tile.playerProperties && tile.playerProperties.some(p => p.type === 'tavern' && !p.underConstruction);
        const tavernTables = ownsTavern ? (tile.playerProperties.find(p => p.type === 'tavern')?.gamblingTables || 0) : 0;

        // Game catalogue comes from data/earlyJobs.json (gambling.games)
        const minigames = ActionMenu._getGamblingData();

        // The action menu's voice (ui/actionMenu/uiKit.js): a lede and chips, then one
        // row a game — its minimum stake at the right, greyed when the purse is short
        let html = underground
            ? lede(`${gaming.why} Behind ${(BackRooms.games(game.world, tile).find(g => g.id === game.player._backRoom.gameId) || { front: 'the front' }).front}, the tables run all the same. Keep your voice down.`)
            : lede('Games of chance at the tables. Pick a game, lay your stake.');
        html += chips([
            purse(gold),
            ownsTavern ? { icon: '🍻', label: 'Your tavern', value: 'No AP cost', cls: 'gold' } : null,
        ]);

        if (ownsTavern) {
            html += card(`<div style="font-size:12px; color:#cbbf9f;">House advantage! +5% luck bonus${tavernTables > 0 ? ` · ${tavernTables} table${tavernTables > 1 ? 's' : ''} (+${tavernTables * 2}% extra)` : ''} · No AP cost</div>`,
                { icon: '🍻', title: 'Your Tavern', tone: 'gold' });
        }

        html += rowList(minigames.map(mg => {
            const canPlay = gold >= mg.minBet;
            return {
                icon: mg.icon,
                name: mg.name,
                desc: mg.description,
                attrs: `onclick="window._openMinigame('${mg.id}')"`,
                off: !canPlay,
                why: `Min bet: ${mg.minBet}g — your purse holds ${gold}g`,
                side: `Min bet: ${mg.minBet}g`,
                tone: canPlay ? 'gold' : '',
            };
        }), '🎲 Games of Chance');

        game.ui.showCustomPanel(underground ? '🎲 The Back Room' : '🎲 Gambling Den', html);

        window._openMinigame = (id) => {
            if (id === 'crown_anchor') ActionMenu._minigameCrownAnchor(game, tile);
            else if (id === 'dragons_flip') ActionMenu._minigameDragonsFlip(game, tile);
            else if (id === 'high_low') ActionMenu._minigameHighLow(game, tile);
            else if (id === 'poker') ActionMenu._minigamePoker(game, tile);
        };
    },

    /**
     * Where gaming is forbidden: the back-room games in town, each behind its
     * front, what the doorman wants, and tonight's chance of a raid.
     */
    showBackRoomDoor(game, tile) {
        const gaming = BackRooms.status(game.world, tile.settlement);
        const games = BackRooms.games(game.world, tile);
        let html = lede(`${gaming.why} No gaming house may open here: dice and cards go on behind closed doors, in the back of some honest business.`);
        html += chips([purse(game.player.gold)]);
        if (!games.length) {
            html += card('<div style="font-size:12px; color:#cbbf9f;">Nobody here will own to a game. Where a gang runs dens, there is a back room to be found; a tavern of yours could be fitted with one of its own.</div>', { icon: '🚪', title: 'No back room here' });
        } else {
            html += rowList(games.map(g => {
                const door = BackRooms.entry(game.player, game.world, tile, g);
                const risk = Math.round(BackRooms.raidChance(game.world, tile, g) * 100);
                const short = !door.free && game.player.gold < door.fee;
                return {
                    icon: g.kind === 'own' ? '🍻' : g.kind === 'gang' ? '🗝️' : '🚪',
                    name: g.name,
                    desc: `Behind ${g.front} · ${door.why}`,
                    note: `<span style="color:#f0b35a;">Raid risk tonight ~${risk}%: the stakes on the table and a fine</span>`,
                    act: 'backRoomEnter', args: [tile.q, tile.r, g.id],
                    off: short, why: `The doorman wants ${door.fee}g`,
                    side: door.free ? 'Walk in' : price(door.fee, !short),
                    tone: 'gold',
                };
            }), 'Back rooms');
        }
        game.ui.showCustomPanel('🚪 A Back Room', html);
    },

    /** Through the front and down the stair (data-am-act="backRoomEnter"). */
    backRoomEnter(game, q, r, gameId) {
        const tile = game.world.getTile(q, r);
        const res = BackRooms.enter(game.player, game.world, tile, gameId);
        if (!res.success) {
            game.ui.showNotification('🚪 Not Tonight', res.reason, 'error');
            return;
        }
        game.ui.updateStats(game.player, game.world);
        if (res.raided) {
            let html = lede(res.text);
            html += chips([['🎲', 'Stakes lost', `${res.lost}g`], ['⚖️', 'Fine', `${res.fine}g`], purse(game.player.gold)]);
            html += card('<div style="font-size:12px; color:#cbbf9f;">The watch has your name now: there is heat on you in this realm. The back room is shut for the night.</div>', { icon: '🚨', title: 'Raided', tone: 'bad' });
            game.ui.showCustomPanel('🚨 The Watch!', html);
            return;
        }
        ActionMenu.showGamblingMenu(game, tile);
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
            html += _tableTop(gold);
            html += sectionHead("🂡 Texas Hold'em");
            if (pot > 0) html += chips([{ icon: '💰', label: 'Pot', value: `${pot}g`, cls: 'gold' }]);

            if (street === 'ante') {
                // Ante selection screen
                html += lede('Set your ante to start a hand. Both you and the dealer put the ante in the pot.');
                const anteMax = Math.min(pokerCfg.maxAnte ?? 200, Math.floor(gold / 2));
                html += _betSlider('Ante', 'pokerAnte', 'pokerAnteLabel', pokerCfg.minBet, anteMax, Math.min(20, anteMax), 160);
                html += `<button onclick="window._pokerDeal(parseInt(document.getElementById('pokerAnte').value))"
                    style="${BTN_GOLD} display:block; width:100%; margin:0; padding:10px; font-family:var(--font-display); font-size:14px; letter-spacing:1px;">
                    🂡 Deal Cards
                </button>`;
            } else {
                // ── Community cards ──
                html += `<div style="text-align:center;margin-bottom:10px;">`;
                html += `<div class="pk-head" style="text-align:center;">Community Cards</div>`;
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
                    <div class="pk-head" style="text-align:center;">Your Hand</div>
                    <div style="display:flex;gap:5px;justify-content:center;">${playerCards.map(c=>cardHTML(c)).join('')}</div>`;
                if (playerHandResult) html += `<div style="font-size:11px;margin-top:5px;color:${handColor(playerHandResult.rank)};font-weight:bold;">${playerHandResult.name}</div>`;
                html += `</div>`;

                // Dealer
                html += `<div style="text-align:center;">
                    <div class="pk-head" style="text-align:center;">Dealer</div>
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
                if (lastAction) html += `<div style="font-size:11px;color:#9d937c;text-align:center;margin-bottom:6px;">${lastAction}</div>`;
                html += `<div style="font-size:13px;color:#ece2c8;text-align:center;margin-bottom:10px;">${statusMsg}</div>`;

                // ── Action buttons ──
                const PLAY = 'padding:8px 20px; margin:0; font-size:13px;';
                if (!gameOver && !isFacingBet) {
                    const betMax = Math.min(100, gold, pot);
                    html += _betSlider('Raise', 'pokerBetInput', 'pokerBetLabel', currentAnte, betMax, currentAnte, 120);
                    html += `<div style="display:flex;gap:8px;justify-content:center;">
                        <button onclick="window._pokerAction('check')" style="${BTN_PLAIN} ${PLAY}">✔ Check</button>
                        <button onclick="window._pokerAction('bet')" style="${BTN_GOLD} ${PLAY}">💰 Bet</button>
                        <button onclick="window._pokerAction('fold')" style="${BTN_DARK} ${PLAY}">✖ Fold</button>
                    </div>`;
                } else if (!gameOver && isFacingBet) {
                    html += `<div style="display:flex;gap:8px;justify-content:center;">
                        <button onclick="window._pokerCall()" style="${BTN_GOLD} ${PLAY}">📲 Call</button>
                        <button onclick="window._pokerAction('fold')" style="${BTN_DARK} ${PLAY}">✖ Fold</button>
                    </div>`;
                } else if (gameOver) {
                    html += `<button onclick="window._pokerNewHand()"
                        style="${gold >= 10 ? BTN_GOLD : BTN_OFF} display:block; width:100%; margin:4px 0 0; padding:10px; font-family:var(--font-display); font-size:14px; letter-spacing:1px;"
                        ${gold < 10 ? 'disabled' : ''}>
                        ${gold >= 10 ? '🂡 New Hand' : 'Out of gold!'}
                    </button>`;
                    html += `<button data-am-act="closePanel"
                        style="${BTN_DARK} display:block; width:100%; margin:6px 0 0; padding:8px;">Leave Table</button>`;
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
        html += _tableTop(gold, 'caPurse');
        html += sectionHead('🎲 Crown & Anchor');
        html += lede('Pick a symbol and place your bet. Three dice are rolled — each match pays your bet!');

        // Bet slider
        html += _betSlider('Bet', 'caBet', 'caBetLabel', cfg.minBet, maxBet, Math.min(25, maxBet));

        // Symbol grid
        html += sectionHead('Choose your symbol');
        html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">';
        for (const sym of symbols) {
            html += `<button onclick="window._caPickSymbol('${sym.id}')" id="caSym_${sym.id}"
                        style="padding: 10px 8px; background: ${CA_IDLE_BG}; border: 1px solid ${CA_IDLE_EDGE};
                               border-radius: 8px; cursor: pointer; transition: all 0.15s; color: #ece2c8;"
                        onmouseenter="this.style.borderColor='rgba(245,197,66,0.6)'" onmouseleave="if(!this.classList.contains('ca-selected')) this.style.borderColor='${CA_IDLE_EDGE}'">
                        <div style="font-size: 28px;">${sym.icon}</div>
                        <div style="font-size: 11px; margin-top: 4px; font-weight: 600;">${sym.name}</div>
                     </button>`;
        }
        html += '</div>';

        // Dice display area
        html += `<div id="caDiceArea" style="min-height: 80px; display: flex; justify-content: center; align-items: center; gap: 16px; margin-bottom: 16px;">
                    <div style="font-size: 13px; color: #9d937c;">Pick a symbol and roll!</div>
                 </div>`;

        // Roll button
        html += `<button id="caRollBtn" onclick="window._caRoll()" disabled
                    style="${BTN_GOLD} margin:0; padding: 9px 32px; font-family: var(--font-display); font-size: 14px; letter-spacing: 1px; opacity: 0.5; transition: all 0.15s;">
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
                        el.style.borderColor = 'rgba(245,197,66,0.7)';
                        el.style.background = 'rgba(245, 197, 66, 0.15)';
                    } else {
                        el.classList.remove('ca-selected');
                        el.style.borderColor = CA_IDLE_EDGE;
                        el.style.background = CA_IDLE_BG;
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
                        `<div style="width: 64px; height: 64px; background: rgba(245,197,66,0.08); border: 2px solid rgba(245,197,66,0.4); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px;">${s.icon}</div>`
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
                            return `<div style="width: 64px; height: 64px; background: ${isMatch ? 'rgba(143,209,138,0.16)' : 'rgba(255,255,255,0.04)'}; border: 2px solid ${isMatch ? '#8fd18a' : 'rgba(245,197,66,0.14)'}; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 28px; transition: all 0.3s;">${s.icon}</div>`;
                        }).join('');
                    }

                    // Calculate & apply result
                    if (matches === 0) {
                        game.player.gold -= bet;
                        ActionMenu._gamblingFinance(game, -bet);
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e0846a; font-weight: bold; font-size: 14px;">No matches! Lost ${bet}g 💸</div>`;
                    } else {
                        const payout = Math.floor(bet * matches * (cfg.payoutPerMatch ?? 1)); // 1x per match, so 1 match = 1x, 2 = 2x, 3 = 3x
                        game.player.gold += payout; // net gain (doesn't deduct bet, matches pay bet each)
                        ActionMenu._gamblingFinance(game, payout);
                        const msg = matches === 3 ? '🎉 TRIPLE MATCH! Jackpot!' : matches === 2 ? '✨ Double match!' : '👍 One match!';
                        if (resultArea) resultArea.innerHTML = `<div style="color: #8fd18a; font-weight: bold; font-size: 14px;">${msg} Won ${payout}g!</div>`;
                    }
                    game.ui.updateStats(game.player, game.world);

                    // Re-enable after result
                    setTimeout(() => {
                        if (rollBtn && game.player.gold >= 5) { rollBtn.disabled = false; rollBtn.style.opacity = '1'; }
                        // Update gold display (the purse chip, _tableTop)
                        const goldSpan = document.getElementById('caPurse');
                        if (goldSpan) goldSpan.textContent = game.player.gold + 'g';
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
        html += _tableTop(gold);
        html += sectionHead('🐉 Dragon\'s Flip');
        html += lede('Call the coin — Dragon or Shield. Double or nothing!');

        // Bet slider
        html += _betSlider('Bet', 'dfBet', 'dfBetLabel', cfg.minBet, maxBet, Math.min(25, maxBet));

        // Coin display
        html += `<div id="dfCoinArea" style="margin: 20px auto; width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(135deg, #c49a2a, #f5c542); display: flex; align-items: center; justify-content: center; font-size: 48px; box-shadow: 0 4px 20px rgba(245,197,66,0.3); transition: transform 0.1s;">
                    ❓
                 </div>`;

        // Choice buttons
        html += sectionHead('Make your call');
        html += `<div style="display: flex; gap: 12px; justify-content: center; margin-bottom: 16px;">
                    <button onclick="window._dfFlip('dragon')" id="dfDragonBtn" style="${BTN_GOLD} margin:0; padding: 10px 28px; font-size: 14px;">
                        🐉 Dragon
                    </button>
                    <button onclick="window._dfFlip('shield')" id="dfShieldBtn" style="${BTN_GOLD} margin:0; padding: 10px 28px; font-size: 14px;">
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
                        if (resultArea) resultArea.innerHTML = `<div style="color: #8fd18a; font-weight: bold; font-size: 15px;">🎉 ${resultName}! You win ${winAmount}g!</div>`;

                        // Show double-or-nothing option
                        if (doubleArea) {
                            doubleArea.style.display = 'block';
                            doubleArea.innerHTML = _dfDoubleBox(`🔥 Double or Nothing? (${currentWinnings}g at stake)`);
                        }
                    } else {
                        game.player.gold -= bet;
                        ActionMenu._gamblingFinance(game, -bet);
                        currentWinnings = 0;
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e0846a; font-weight: bold; font-size: 15px;">💸 ${resultName}! You lose ${bet}g.</div>`;
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
                        if (resultArea) resultArea.innerHTML = `<div style="color: #8fd18a; font-weight: bold; font-size: 15px;">🔥 DOUBLED! Winnings: ${currentWinnings}g!</div>`;
                        // Update double-or-nothing display
                        if (doubleArea) {
                            doubleArea.innerHTML = _dfDoubleBox(`🔥🔥 Double again? (${currentWinnings}g at stake!)`);
                        }
                    } else {
                        // Lose everything from double-or-nothing
                        game.player.gold -= currentWinnings / 2;
                        ActionMenu._gamblingFinance(game, -(currentWinnings / 2));
                        currentWinnings = 0;
                        if (resultArea) resultArea.innerHTML = `<div style="color: #e0846a; font-weight: bold; font-size: 15px;">💀 Bust! Lost it all on the double!</div>`;
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
            html += _tableTop(Math.floor(game.player.gold));
            html += sectionHead('🃏 High-Low');
            html += lede('Guess if the next card is Higher or Lower. Keep your streak for bigger payouts!');

            if (!inRound) {
                // Bet phase
                html += _betSlider('Bet', 'hlBet', 'hlBetLabel', cfg.minBet, Math.min(cfg.maxBet, game.player.gold), Math.min(20, game.player.gold));

                html += `<div style="display: flex; justify-content: center; gap: 16px; margin-bottom: 16px;">
                            ${renderCard(currentCard)}
                            ${revealedCard ? renderCard(revealedCard) : renderCard(null, true)}
                         </div>`;

                html += `<button onclick="window._hlStartRound()"
                            style="${BTN_GOLD} margin:0; padding: 9px 32px; font-family: var(--font-display); font-size: 14px; letter-spacing: 1px;">
                            Deal & Start
                         </button>`;
            } else {
                // Playing phase
                const multiplier = 1 + streak * (cfg.streakBonus ?? 0.5);
                const potentialWin = Math.floor(bet * multiplier);

                html += `<div style="display:flex; justify-content:center;">${chips([
                    { icon: '🔥', label: 'Streak', value: `<span style="color:${streak > 0 ? '#8fd18a' : '#9d937c'};">${streak}</span>` },
                    { icon: '✖', label: 'Multiplier', value: `${multiplier.toFixed(1)}x`, cls: 'gold' },
                    { icon: '💰', label: 'Pot', value: `<span style="color:#8fd18a;">${potentialWin}g</span>` },
                ])}</div>`;

                html += `<div style="display: flex; justify-content: center; gap: 16px; margin: 20px 0;">
                            ${renderCard(currentCard)}
                            ${revealedCard ? renderCard(revealedCard) : renderCard(null, true)}
                         </div>`;

                const G = 'margin:0; padding: 9px 22px; font-size: 14px;';
                html += `<div style="display: flex; gap: 10px; justify-content: center; margin-bottom: 12px;">
                            <button onclick="window._hlGuess('higher')" style="${BTN_PLAIN} ${G}">
                                ⬆️ Higher
                            </button>
                            <button onclick="window._hlCashOut()"
                                style="${streak === 0 ? BTN_OFF + ' pointer-events:none;' : BTN_GOLD} ${G}"
                                ${streak === 0 ? 'disabled' : ''}>
                                💰 Cash Out (${potentialWin}g)
                            </button>
                            <button onclick="window._hlGuess('lower')" style="${BTN_PLAIN} ${G}">
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
                    if (res) res.innerHTML = `<div style="color: #ffcf6a; font-size: 13px;">🤝 Tie! Same value — draw again.</div>`;
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
                    if (res) res.innerHTML = `<div style="color: #8fd18a; font-size: 13px;">✅ Correct! ${nextCard.value}${nextCard.suit} — Streak: ${streak}!</div>`;
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
                    if (res) res.innerHTML = `<div style="color: #e0846a; font-size: 14px; font-weight: bold;">❌ Wrong! It was ${nextCard.value}${nextCard.suit}. Lost ${bet}g! 💸</div>`;
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

        const crowdWord = crowdMultiplier >= 1.4 ? 'Large' : crowdMultiplier >= 1 ? 'Moderate' : 'Small';
        let html = sectionHead('🎭 Street Performance');
        html += lede(`Pick a performance to entertain the crowd in ${settlement.name}.`);
        html += chips([{ icon: '👥', label: 'Crowd size', value: `${crowdWord} (${crowdMultiplier}x)`, cls: 'gold' }]);

        html += rowList(performances.map(perf => {
            const statVal = ActionMenu._getPlayerStat(game.player, perf.stat);
            const statLabel = perf.stat.charAt(0).toUpperCase() + perf.stat.slice(1);
            return {
                icon: perf.icon,
                name: perf.name,
                desc: perf.description,
                note: `<span style="color:#9d937c;">${statLabel}: ${statVal}</span>`,
                attrs: `onclick="window._startBuskPerf('${perf.id}')"`,
                side: '▶ Perform',
                tone: 'gold',
            };
        }));

        html += `<button data-am-act="closePanel" style="${BTN_PLAIN}">Cancel</button>`;
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
        // The crowd's coins come out of the town's purse: a broke town tosses little
        const earned = Math.max(1, Math.floor(basePay * crowdMultiplier * qualityMult * (1 + statVal * 0.08)));
        const actualPay = OddJobs.payFromTown(player, tile && tile.settlement, earned);
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
        html += `<div style="font-size: 44px; margin: 10px 0 6px;">${perf.icon}</div>`;
        html += `<div style="font-family: var(--font-display); font-size: 18px; color: ${ratingColor}; font-weight: bold; margin-bottom: 4px;">${rating}</div>`;
        html += `<div class="pk-head" style="text-align:center; margin-top:0;">${perf.name}</div>`;
        html += `<div style="margin-bottom: 10px; font-size: 20px; letter-spacing: 4px;">${starsHtml}</div>`;
        html += `<div style="display:flex; justify-content:center;">${chips([
            { icon: '💰', label: 'Earned', value: `+${actualPay} gold`, cls: 'gold' },
            scorePercent >= 40 ? { icon: '⭐', label: '', value: '<span style="color:#ce93d8;">+1 Renown</span>' } : null,
            perf.bonusKarma && scorePercent >= 25 ? { icon: '🕊️', label: '', value: '<span style="color:#8fd18a;">+1 Karma</span>' } : null,
        ])}</div>`;

        html += `<button data-am-act="closePanel"
            style="${BTN_GOLD} margin: 12px 0 0; padding: 9px 32px; font-family: var(--font-display); font-size: 14px; letter-spacing: 1px;">
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
                { id: 'woodcutter', name: 'Woodcutter', icon: '🌲', description: 'Chop firewood for the village hearths.', pay: { min: 12, max: 22 }, stat: 'strength', difficulty: 3 },
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
                    { item: 'truffles', name: 'Truffles', icon: '🍄', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 25 },
                ],
                plains: [
                    { item: 'herbs', name: 'Prairie Herbs', icon: '🌿', chance: 0.35, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'berries', name: 'Wild Berries', icon: '🍇', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 3 },
                    { item: 'flax', name: 'Wild Flax', icon: '🌾', chance: 0.20, qty: { min: 1, max: 3 }, sellPrice: 6 },
                    { item: 'feather', name: 'Feathers', icon: '🦅', chance: 0.15, qty: { min: 2, max: 5 }, sellPrice: 4 },
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
                    { item: 'ambergris', name: 'Ambergris', icon: '💛', chance: 0.02, qty: { min: 1, max: 1 }, sellPrice: 50 },
                ],
                desert: [
                    { item: 'cactus_fruit', name: 'Cactus Fruit', icon: '🌵', chance: 0.30, qty: { min: 1, max: 2 }, sellPrice: 6 },
                    { item: 'scorpion_venom', name: 'Scorpion Venom', icon: '🦂', chance: 0.10, qty: { min: 1, max: 1 }, sellPrice: 15 },
                    { item: 'desert_rose', name: 'Desert Rose', icon: '🌹', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 20 },
                ],
                swamp: [
                    { item: 'leeches', name: 'Medicinal Leeches', icon: '🐛', chance: 0.30, qty: { min: 1, max: 3 }, sellPrice: 8 },
                    { item: 'mushrooms', name: 'Swamp Mushrooms', icon: '🍄', chance: 0.25, qty: { min: 1, max: 3 }, sellPrice: 5 },
                    { item: 'peat', name: 'Peat', icon: '🍂', chance: 0.20, qty: { min: 2, max: 4 }, sellPrice: 4 },
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
                    { item: 'antler', name: 'Antlers', icon: '🦌', chance: 0.15, qty: { min: 1, max: 1 }, sellPrice: 15 },
                    { item: 'bear_pelt', name: 'Bear Pelt', icon: '🐻', chance: 0.05, qty: { min: 1, max: 1 }, sellPrice: 40 },
                ],
                plains: [
                    { item: 'game_meat', name: 'Game Meat', icon: '🥩', chance: 0.40, qty: { min: 1, max: 4 }, sellPrice: 6 },
                    { item: 'hide', name: 'Hides', icon: '🐾', chance: 0.35, qty: { min: 1, max: 2 }, sellPrice: 8 },
                    { item: 'feather', name: 'Feathers', icon: '🦅', chance: 0.25, qty: { min: 2, max: 5 }, sellPrice: 4 },
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
        let html = sectionHead(`${opts.icon} ${opts.title}`);
        if (opts.description) html += lede(opts.description);

        html += rowList([
            { icon: '🎮', name: 'Play Minigame', desc: 'Earn bonus rewards', attrs: 'onclick="window._mgPlay()"', side: '▶ Play', tone: 'gold' },
            { icon: '⏭️', name: 'Skip', desc: 'Base reward only', attrs: 'onclick="window._mgSkip()"', side: 'Skip' },
        ]);

        // Base reward preview
        if (opts.baseRewardText) html += kv('Base reward', opts.baseRewardText);

        if (opts.cancelable) {
            html += `<button data-am-act="closePanel" style="${BTN_DARK} margin-top: 10px;">Cancel</button>`;
        }

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
