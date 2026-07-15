// ActionMenu — jobs methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader } from './_imports.js';
import { MinigameHost, startForge } from '../minigames/index.js';

Object.assign(ActionMenu, {
    // ============================================================
    // EARLY-GAME INCOME SYSTEMS
    // ============================================================
    /**
     * Show available odd jobs at this settlement
     */
    showOddJobsMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        // Determine settlement tier
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' ? 'town' : 'village');

        // Get job list from data (or fallback)
        const jobData = ActionMenu._getJobData();
        const allJobs = jobData[tier] || jobData['village'];

        // Pick 3 random jobs for today
        const shuffled = [...allJobs].sort(() => Math.random() - 0.5);
        const todayJobs = shuffled.slice(0, 3);

        const diffColors = { 2: '#2ecc71', 3: '#2ecc71', 4: '#f39c12', 5: '#e67e22', 6: '#e74c3c', 7: '#e74c3c' };

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🔨 Available Work</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Day labor available in ${settlement.name}. Complete the work task to earn your pay.</p>`;

        for (let i = 0; i < todayJobs.length; i++) {
            const job = todayJobs[i];
            const statVal = ActionMenu._getPlayerStat(game.player, job.stat);
            const statLabel = job.stat.charAt(0).toUpperCase() + job.stat.slice(1);
            const dColor = diffColors[job.difficulty] || '#f39c12';

            html += `
                <button onclick="window._startLabor(${i})"
                    style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 8px;
                           background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid var(--gold);
                           border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                    onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                    <span style="font-size: 28px;">${job.icon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 13px;">${job.name}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${job.description}</div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${statLabel}: ${statVal} · Pay: ${job.pay.min}-${job.pay.max}g</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 12px; color: #e67e22; font-weight: 600;">▶ Work</div>
                        <div style="font-size: 10px; color: ${dColor}; margin-top: 2px;">Diff: ${job.difficulty}/7</div>
                    </div>
                </button>
            `;
        }

        html += `<button onclick="window._oddJobsCancel()"
            style="margin-top: 6px; padding: 8px 20px; background: none; border: 1px solid rgba(255,255,255,0.1);
                   border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">
            Cancel
        </button>`;
        html += '</div>';
        game.ui.showCustomPanel('Day Labor', html);

        window._oddJobsCancel = () => game.ui.hideCustomPanel();

        window._startLabor = (idx) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const job = todayJobs[idx];
            ActionMenu._showMinigamePrompt(game, {
                title: `🔨 ${job.name}`,
                icon: job.icon,
                description: job.description,
                baseRewardText: `~${job.pay.min}g (mediocre performance)`,
                onSkip: () => {
                    // Feed 40% score = mediocre base performance
                    ActionMenu._laborReward(game, tile, job, 40);
                },
                onPlay: () => {
                    switch (job.stat) {
                        case 'strength':     ActionMenu._laborStrength(game, tile, job); break;
                        case 'intelligence': ActionMenu._laborIntelligence(game, tile, job); break;
                        case 'combat':       ActionMenu._laborCombat(game, tile, job); break;
                        case 'stealth':      ActionMenu._laborStealth(game, tile, job); break;
                        case 'stamina':      ActionMenu._laborStamina(game, tile, job); break;
                        case 'charisma':     ActionMenu._laborCharisma(game, tile, job); break;
                        default:             ActionMenu._laborStrength(game, tile, job); break;
                    }
                }
            });
        };
    },

    /**
     * Common reward handler for all day labor minigames.
     * scorePercent: 0-100 how well the player performed the job
     */
    _laborReward(game, tile, job, scorePercent) {
        const player = game.player;
        const statVal = ActionMenu._getPlayerStat(player, job.stat);
        const basePay = job.pay.min + Math.floor(Math.random() * (job.pay.max - job.pay.min + 1));
        const qualityMult = 0.3 + (scorePercent / 100) * 1.0;
        const statBonus = Math.floor(statVal * 1.5);
        const actualPay = Math.max(1, Math.floor((basePay + statBonus) * qualityMult));

        player.gold += actualPay;
        if (scorePercent >= 40) player.renown += 1;

        // Track for quests
        if (!player.jobsCompleted) player.jobsCompleted = 0;
        player.jobsCompleted++;

        // Skill up — better performance = better chance
        if (player.skills && player.skills[job.stat] !== undefined) {
            const skillChance = 0.15 + scorePercent * 0.002;
            if (Math.random() < skillChance) {
                player.skills[job.stat] = Math.min(10, player.skills[job.stat] + 0.1);
            }
        }

        // Finance tracking
        if (player.financeToday) {
            player.financeToday.income.jobs = (player.financeToday.income.jobs || 0) + actualPay;
        }

        // Rating
        const rating = scorePercent >= 90 ? 'Masterful Work! 🌟' : scorePercent >= 70 ? 'Great Job! 👏' : scorePercent >= 50 ? 'Decent Work 👍' : scorePercent >= 25 ? 'Sloppy Work 😐' : 'Barely Finished 😬';
        const ratingColor = scorePercent >= 90 ? '#f1c40f' : scorePercent >= 70 ? '#2ecc71' : scorePercent >= 50 ? '#3498db' : scorePercent >= 25 ? '#f39c12' : '#e74c3c';
        const stars = Math.round(scorePercent / 20);
        let starsHtml = '';
        for (let i = 0; i < 5; i++) starsHtml += i < stars ? '⭐' : '☆';

        let html = '<div style="max-width: 450px; text-align: center;">';
        html += `<div style="font-size: 48px; margin: 16px 0;">${job.icon}</div>`;
        html += `<div style="font-size: 18px; color: ${ratingColor}; font-weight: bold; margin-bottom: 6px;">${rating}</div>`;
        html += `<div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 10px;">${job.name}</div>`;
        html += `<div style="margin-bottom: 12px; font-size: 20px; letter-spacing: 4px;">${starsHtml}</div>`;
        html += `<div style="font-size: 24px; color: var(--gold); font-weight: bold; margin: 8px 0;">+${actualPay} gold</div>`;
        if (scorePercent >= 40) html += `<div style="font-size: 12px; color: #9b59b6;">+1 Renown</div>`;

        html += `<button onclick="window._laborContinue()"
            style="padding: 10px 32px; margin-top: 16px; background: linear-gradient(135deg, var(--gold), #d4a030); color: #1a1a2e; border: none;
                   border-radius: 6px; cursor: pointer; font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;">
            Continue
        </button>`;
        html += '</div>';

        game.ui.showCustomPanel('🔨 Work Complete', html);
        window._laborContinue = () => game.ui.hideCustomPanel();
        game.ui.updateStats(player, game.world);
        game.endDay();
    },

    // ── Labor Minigame: Strength — "The Forge" (canvas smithing game) ──
    // Thin delegate: runs the polished Forge game on a MinigameHost and feeds its
    // 0–100 score into the unchanged reward pipeline. The old inline power-bar was
    // replaced by src/ui/minigames/forge/ (see the design spec).
    _laborStrength(game, tile, job) {
        const strength = ActionMenu._getPlayerStat(game.player, 'strength');
        const host = new MinigameHost(game, { title: `🔥 ${job.name}`, height: 380 });
        startForge(host, {
            strength,
            onComplete: (scorePercent) => {
                host.close();
                ActionMenu._laborReward(game, tile, job, scorePercent);
            },
        });
    },

    // ── Labor Minigame: Intelligence — Symbol sequence memory ──
    _laborIntelligence(game, tile, job) {
        const intel = ActionMenu._getPlayerStat(game.player, 'intelligence');
        const symbols = ['📜', '📕', '🔑', '💎', '⚗️', '🪶', '📐', '🧪'];
        let round = 0;
        const maxRounds = 4;
        let sequence = [];
        let playerInput = [];
        let showingSeq = false;
        let gameOver = false;

        // Start with 3 symbols, grow each round. Intel gives longer view time
        const viewTime = 500 + intel * 40;

        const render = (highlightIdx = -1, msg = '') => {
            let html = '<div style="max-width: 480px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Memorize the sequence, then repeat it in order!</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Round ${round + 1}/${maxRounds} · Sequence length: ${sequence.length}</p>`;

            if (msg) {
                html += `<div style="font-size: 13px; margin: 14px 0; min-height: 22px;">${msg}</div>`;
            } else {
                html += '<div style="min-height: 22px; margin: 14px 0;"></div>';
            }

            // Symbol buttons (4x2 grid)
            html += '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px auto; max-width: 320px;">';
            for (let i = 0; i < symbols.length; i++) {
                const lit = highlightIdx === i;
                const disabled = showingSeq || gameOver;
                html += `<button onclick="window._laborMemPick(${i})"
                    style="width: 64px; height: 64px; border-radius: 10px; border: 2px solid ${lit ? 'var(--gold)' : 'rgba(255,255,255,0.1)'};
                           background: ${lit ? 'rgba(245,197,66,0.2)' : 'rgba(255,255,255,0.04)'}; cursor: ${disabled ? 'default' : 'pointer'};
                           font-size: 24px; opacity: ${disabled && !lit ? 0.4 : 1}; transition: all 0.15s;
                           box-shadow: ${lit ? '0 0 15px rgba(245,197,66,0.3)' : 'none'}; margin: 0 auto;"
                    ${disabled ? 'disabled' : ''}
                    onmouseenter="if(!this.disabled)this.style.background='rgba(255,255,255,0.08)'"
                    onmouseleave="if(!this.disabled)this.style.background='rgba(255,255,255,0.04)'">${symbols[i]}</button>`;
            }
            html += '</div>';

            // Progress dots
            if (!showingSeq && !gameOver && sequence.length > 0) {
                html += '<div style="display: flex; justify-content: center; gap: 6px; margin-top: 6px;">';
                for (let i = 0; i < sequence.length; i++) {
                    const done = i < playerInput.length;
                    html += `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${done ? '#2ecc71' : 'rgba(255,255,255,0.15)'}; border: 1px solid ${done ? '#2ecc71' : 'rgba(255,255,255,0.2)'};"></div>`;
                }
                html += '</div>';
            }

            html += '</div>';
            return html;
        };

        const playSequence = () => {
            showingSeq = true;
            game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: var(--gold);">👀 Watch the sequence...</span>'));

            let idx = 0;
            const playNext = () => {
                if (idx >= sequence.length) {
                    showingSeq = false;
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #2ecc71;">🖊️ Your turn! Repeat the sequence.</span>'));
                    return;
                }
                game.ui.showCustomPanel(`📋 ${job.name}`, render(sequence[idx], '<span style="color: var(--gold);">👀 Watch...</span>'));
                idx++;
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: var(--gold);">👀 Watch...</span>'));
                    setTimeout(playNext, 200);
                }, viewTime);
            };
            setTimeout(playNext, 500);
        };

        const startRound = () => {
            // Add symbols: 3 first round, then +1 each round
            const toAdd = round === 0 ? 3 : 1;
            for (let i = 0; i < toAdd; i++) {
                sequence.push(Math.floor(Math.random() * symbols.length));
            }
            playerInput = [];
            playSequence();
        };

        window._laborMemPick = (symbolIdx) => {
            if (showingSeq || gameOver) return;

            playerInput.push(symbolIdx);
            const pos = playerInput.length - 1;

            game.ui.showCustomPanel(`📋 ${job.name}`, render(symbolIdx, '<span style="color: var(--text-muted);">...</span>'));

            if (playerInput[pos] !== sequence[pos]) {
                gameOver = true;
                const pct = Math.round((round / maxRounds) * 100);
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #e74c3c;">❌ Wrong! You made an error.</span>'));
                    setTimeout(() => ActionMenu._laborReward(game, tile, job, Math.min(100, pct)), 1400);
                }, 350);
                return;
            }

            if (playerInput.length === sequence.length) {
                round++;
                if (round >= maxRounds) {
                    gameOver = true;
                    setTimeout(() => {
                        game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #2ecc71;">✨ Flawless! Every detail perfect!</span>'));
                        setTimeout(() => ActionMenu._laborReward(game, tile, job, 100), 1400);
                    }, 350);
                    return;
                }
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #2ecc71;">✅ Correct! Getting harder...</span>'));
                    setTimeout(() => startRound(), 1100);
                }, 350);
            } else {
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #2ecc71;">Keep going...</span>'));
                }, 200);
            }
        };

        startRound();
    },

    // ── Labor Minigame: Combat — Reaction block & strike ──
    _laborCombat(game, tile, job) {
        const combat = ActionMenu._getPlayerStat(game.player, 'combat');
        const totalRounds = 8;
        let round = 0;
        let score = 0;
        let locked = false;
        let timerId = null;

        const threats = [
            { dir: 'left',  icon: '⬅️', attack: '🗡️ Slash from the left!',  block: '🛡️ Block Left' },
            { dir: 'right', icon: '➡️', attack: '🗡️ Slash from the right!', block: '🛡️ Block Right' },
            { dir: 'up',    icon: '⬆️', attack: '⚔️ Overhead strike!',      block: '🛡️ Block High' },
            { dir: 'down',  icon: '⬇️', attack: '🦵 Low sweep!',            block: '🛡️ Duck Low' },
        ];

        let currentThreat = null;

        const startRound = () => {
            locked = false;
            currentThreat = threats[Math.floor(Math.random() * threats.length)];
            // Timer gets shorter as rounds progress. Combat skill gives more time.
            const timeLimit = Math.max(800, 2200 - round * 150 + combat * 50);

            let html = '<div style="max-width: 480px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">React to attacks! Click the correct defense!</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Round ${round + 1}/${totalRounds} · Score: ${score}/${round}</p>`;

            // Timer bar
            html += `<div style="margin: 10px 0;">
                <div style="background: rgba(255,255,255,0.08); border-radius: 6px; height: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                    <div id="laborTimer" style="width: 100%; height: 100%; background: #2ecc71; transition: width ${timeLimit}ms linear; border-radius: 5px;"></div>
                </div>
            </div>`;

            // Attack display
            html += `<div style="background: rgba(231,76,60,0.1); border: 2px solid rgba(231,76,60,0.4); border-radius: 12px; padding: 16px; margin: 12px 0;">
                <div style="font-size: 40px; margin-bottom: 6px;">${currentThreat.icon}</div>
                <div style="font-size: 15px; color: #e74c3c; font-weight: bold;">${currentThreat.attack}</div>
            </div>`;

            // Defense buttons (2x2 grid)
            html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;">';
            for (const t of threats) {
                const isCorrect = t.dir === currentThreat.dir;
                html += `<button onclick="window._laborBlock('${t.dir}')"
                    style="padding: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
                           border-radius: 8px; cursor: pointer; color: var(--text-primary); font-size: 13px; font-weight: 500;
                           transition: all 0.1s;"
                    onmouseenter="this.style.background='rgba(255,255,255,0.1)'"
                    onmouseleave="this.style.background='rgba(255,255,255,0.04)'"
                    onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                    ${t.icon} ${t.block}
                </button>`;
            }
            html += '</div>';
            html += '</div>';
            game.ui.showCustomPanel(`⚔️ ${job.name}`, html);

            // Start timer animation
            setTimeout(() => {
                const bar = document.getElementById('laborTimer');
                if (bar) bar.style.width = '0%';
            }, 30);

            // Time out
            timerId = setTimeout(() => {
                if (!locked) {
                    locked = true;
                    showRoundResult(false, '⏰ Too slow!');
                }
            }, timeLimit);
        };

        const showRoundResult = (correct, text) => {
            if (correct) score++;
            const color = correct ? '#2ecc71' : '#e74c3c';

            let html = '<div style="max-width: 480px; text-align: center;">';
            html += `<div style="font-size: 48px; margin: 24px 0;">${correct ? '🛡️' : '💥'}</div>`;
            html += `<div style="font-size: 20px; font-weight: bold; color: ${color}; margin-bottom: 6px;">${text}</div>`;
            html += `<div style="font-size: 13px; color: var(--text-secondary);">Score: ${score}/${round + 1}</div>`;
            html += '</div>';
            game.ui.showCustomPanel(`⚔️ ${job.name}`, html);

            round++;
            if (round < totalRounds) {
                setTimeout(() => startRound(), 900);
            } else {
                const pct = Math.round((score / totalRounds) * 100);
                setTimeout(() => ActionMenu._laborReward(game, tile, job, pct), 1100);
            }
        };

        window._laborBlock = (dir) => {
            if (locked) return;
            locked = true;
            clearTimeout(timerId);

            if (dir === currentThreat.dir) {
                showRoundResult(true, '🛡️ Perfect Block!');
            } else {
                showRoundResult(false, '💥 Wrong defense!');
            }
        };

        startRound();
    },

    // ── Labor Minigame: Stealth — Catch the target (whack-a-mole) ──
    _laborStealth(game, tile, job) {
        const stealth = ActionMenu._getPlayerStat(game.player, 'stealth');
        const totalTargets = 8;
        let caught = 0;
        let missed = 0;
        let spawned = 0;
        let locked = false;
        let activeCell = -1;
        let hideTimer = null;
        let gameOver = false;

        const targets = ['🐀', '🐀', '🐁', '🐀', '🕷️', '🐀', '🐁', '🐀'];

        const render = (msg = '') => {
            let html = '<div style="max-width: 420px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Click the target before it escapes!</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Caught: ${caught} · Missed: ${missed} · Remaining: ${totalTargets - spawned}</p>`;

            if (msg) {
                html += `<div style="font-size: 13px; margin: 8px 0; min-height: 20px;">${msg}</div>`;
            }

            // 3x3 grid of "holes"
            html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px auto; max-width: 300px;">';
            for (let i = 0; i < 9; i++) {
                const isActive = i === activeCell;
                html += `<button onclick="window._laborCatch(${i})"
                    style="width: 88px; height: 88px; border-radius: 12px; margin: 0 auto;
                           background: ${isActive ? 'rgba(231,76,60,0.15)' : 'rgba(255,255,255,0.03)'};
                           border: 2px solid ${isActive ? '#e74c3c' : 'rgba(255,255,255,0.06)'};
                           cursor: ${isActive ? 'pointer' : 'default'}; font-size: ${isActive ? '36px' : '20px'};
                           transition: all 0.15s; display: flex; align-items: center; justify-content: center;
                           ${isActive ? 'animation: hlBob 0.5s ease-in-out infinite alternate;' : ''}"
                    ${isActive ? '' : 'disabled'}>${isActive ? targets[spawned] || '🐀' : '<span style="opacity: 0.15;">🕳️</span>'}</button>`;
            }
            html += '</div>';
            html += '</div>';
            return html;
        };

        const spawnTarget = () => {
            if (gameOver || spawned >= totalTargets) return;

            // Pick random empty cell
            activeCell = Math.floor(Math.random() * 9);
            locked = false;
            game.ui.showCustomPanel(`🔍 ${job.name}`, render());

            // Auto-hide timer — stealth gives more time
            const hideTime = Math.max(600, 1500 - spawned * 80 + stealth * 60);
            hideTimer = setTimeout(() => {
                if (!locked && !gameOver) {
                    locked = true;
                    missed++;
                    activeCell = -1;
                    spawned++;
                    game.ui.showCustomPanel(`🔍 ${job.name}`, render('<span style="color: #e74c3c;">💨 It got away!</span>'));

                    if (spawned >= totalTargets) {
                        finishGame();
                    } else {
                        setTimeout(() => spawnTarget(), 500);
                    }
                }
            }, hideTime);
        };

        const finishGame = () => {
            gameOver = true;
            const pct = Math.round((caught / totalTargets) * 100);
            setTimeout(() => ActionMenu._laborReward(game, tile, job, pct), 1200);
        };

        window._laborCatch = (cell) => {
            if (locked || gameOver || cell !== activeCell) return;
            locked = true;
            clearTimeout(hideTimer);

            caught++;
            spawned++;
            activeCell = -1;
            game.ui.showCustomPanel(`🔍 ${job.name}`, render('<span style="color: #2ecc71;">✅ Got it!</span>'));

            if (spawned >= totalTargets) {
                finishGame();
            } else {
                setTimeout(() => spawnTarget(), 600);
            }
        };

        spawnTarget();
    },

    // ── Labor Minigame: Stamina — Pacing endurance run ──
    _laborStamina(game, tile, job) {
        const stamina = ActionMenu._getPlayerStat(game.player, 'stamina');
        let speed = 50; // 0-100 scale, ideal zone is 40-65
        let ticksInZone = 0;
        const totalTicks = 25;
        let ticksDone = 0;
        let locked = false;
        let intervalId = null;

        const idealMin = 35;
        const idealMax = 65;

        // Speed drifts randomly. Stamina reduces drift magnitude.
        const driftRate = 3.5 - stamina * 0.15;

        const render = () => {
            const inZone = speed >= idealMin && speed <= idealMax;
            const speedColor = speed > 80 ? '#e74c3c' : speed > idealMax ? '#f39c12' : speed >= idealMin ? '#2ecc71' : speed > 15 ? '#f39c12' : '#e74c3c';
            const speedLabel = speed > 80 ? 'Exhausting!' : speed > idealMax ? 'Too Fast' : speed >= idealMin ? 'Good Pace' : speed > 15 ? 'Too Slow' : 'Crawling!';
            const pct = Math.round((ticksInZone / totalTicks) * 100);

            let html = '<div style="max-width: 450px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Keep your pace in the <span style="color: #2ecc71;">green zone</span>! Use the buttons to adjust.</p>`;
            html += `<p style="font-size: 11px; color: var(--text-muted);">Progress: ${ticksDone}/${totalTicks} · In-zone: ${ticksInZone}</p>`;

            // Speed gauge (vertical-style bar rendered horizontally)
            html += `<div style="position: relative; height: 32px; background: rgba(255,255,255,0.06); border-radius: 16px; margin: 14px 0; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">`;
            // Red zones
            html += `<div style="position: absolute; left: 0; width: ${idealMin}%; height: 100%; background: rgba(231,76,60,0.12);"></div>`;
            html += `<div style="position: absolute; right: 0; width: ${100 - idealMax}%; height: 100%; background: rgba(231,76,60,0.12);"></div>`;
            // Green zone
            html += `<div style="position: absolute; left: ${idealMin}%; width: ${idealMax - idealMin}%; height: 100%; background: rgba(46,204,113,0.2); border-left: 2px solid #2ecc71; border-right: 2px solid #2ecc71;"></div>`;
            // Speed marker
            html += `<div id="laborSpeedMark" style="position: absolute; left: ${speed}%; top: 2px; bottom: 2px; width: 6px; background: ${speedColor}; border-radius: 3px; transform: translateX(-50%); box-shadow: 0 0 10px ${speedColor}; transition: left 0.3s;"></div>`;
            html += `</div>`;

            // Status
            html += `<div style="font-size: 14px; color: ${speedColor}; font-weight: bold; margin-bottom: 10px;">${speedLabel}</div>`;

            // Runner animation
            html += `<div style="font-size: 32px; margin: 4px 0; ${inZone ? '' : 'opacity: 0.5;'}">${speed > idealMax ? '🏃💨' : speed >= idealMin ? '🏃' : '🚶'}</div>`;

            // Buttons
            html += `<div style="display: flex; gap: 12px; justify-content: center; margin-top: 12px;">
                <button onclick="window._laborSlowDown()"
                    style="padding: 12px 28px; background: rgba(52,152,219,0.15); border: 1px solid #3498db;
                           border-radius: 8px; cursor: pointer; color: #3498db; font-size: 14px; font-weight: bold; transition: all 0.1s;"
                    onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                    🐢 Slow Down
                </button>
                <button onclick="window._laborSpeedUp()"
                    style="padding: 12px 28px; background: rgba(231,76,60,0.15); border: 1px solid #e74c3c;
                           border-radius: 8px; cursor: pointer; color: #e74c3c; font-size: 14px; font-weight: bold; transition: all 0.1s;"
                    onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                    🐇 Speed Up
                </button>
            </div>`;

            // Overall progress bar
            html += `<div style="margin-top: 14px;">
                <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 3px;">Delivery progress</div>
                <div style="background: rgba(255,255,255,0.08); border-radius: 6px; height: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="width: ${(ticksDone / totalTicks) * 100}%; height: 100%; background: var(--gold); transition: width 0.3s; border-radius: 5px;"></div>
                </div>
            </div>`;

            html += '</div>';
            return html;
        };

        window._laborSlowDown = () => {
            speed = Math.max(0, speed - 12);
        };

        window._laborSpeedUp = () => {
            speed = Math.min(100, speed + 12);
        };

        game.ui.showCustomPanel(`🏃 ${job.name}`, render());

        intervalId = setInterval(() => {
            if (locked) return;

            // Random drift
            const drift = (Math.random() - 0.45) * driftRate * 2;
            speed = Math.max(0, Math.min(100, speed + drift));

            // Check zone
            if (speed >= idealMin && speed <= idealMax) {
                ticksInZone++;
            }
            ticksDone++;

            game.ui.showCustomPanel(`🏃 ${job.name}`, render());

            if (ticksDone >= totalTicks) {
                locked = true;
                clearInterval(intervalId);
                const pct = Math.round((ticksInZone / totalTicks) * 100);
                setTimeout(() => ActionMenu._laborReward(game, tile, job, pct), 1000);
            }
        }, 800);
    },

    // ── Labor Minigame: Charisma — Public speaking / crowd engagement ──
    _laborCharisma(game, tile, job) {
        const charisma = ActionMenu._getPlayerStat(game.player, 'charisma');
        let round = 0;
        let crowdMood = 50;
        let locked = false;

        const scenarios = [
            {
                prompt: 'You step up to the podium. The crowd awaits your opening words.',
                crowd: '👤 👥 👤 🧑',
                options: [
                    { text: '📢 Project your voice with authority and warmth', mood: 18 },
                    { text: '📜 Read directly from the prepared script', mood: 8 },
                    { text: '🗣️ Wing it — improvise with confidence', mood: -3, max: 25 },
                ]
            },
            {
                prompt: 'A heckler shouts from the back: "Get on with it!"',
                crowd: '👤 👥 😤 👤 🧑',
                options: [
                    { text: '😄 Make a witty joke at the heckler\'s expense', mood: 20 },
                    { text: '🤚 Ignore them and continue with dignity', mood: 12 },
                    { text: '😡 Shout back angrily', mood: -10 },
                ]
            },
            {
                prompt: 'The crowd is engaged. Time for the main message.',
                crowd: '👤 👥 👤 👥 🧑 👤',
                options: [
                    { text: '🎭 Use dramatic gestures and a powerful cadence', mood: 20 },
                    { text: '📖 Present the facts clearly and concisely', mood: 14 },
                    { text: '🥱 Drone on about minor bureaucratic details', mood: -8 },
                ]
            },
            {
                prompt: 'Time to wrap up. The crowd waits for your closing.',
                crowd: '👤 👥 👤 👥 👤 👥 🧑',
                options: [
                    { text: '🙏 End with an inspiring call to action', mood: 18 },
                    { text: '✊ Raise your fist and shout the realm\'s motto', mood: 12 },
                    { text: '📋 Read a long list of legal disclaimers', mood: -5 },
                ]
            },
        ];

        // Shuffle options per scenario
        scenarios.forEach(s => {
            for (let i = s.options.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [s.options[i], s.options[j]] = [s.options[j], s.options[i]];
            }
        });

        // Charisma hint: highlight best option
        const showHint = charisma >= 7;

        const render = (feedbackMsg = '') => {
            const sc = scenarios[round];
            const moodColor = crowdMood >= 70 ? '#2ecc71' : crowdMood >= 45 ? '#f39c12' : '#e74c3c';

            let html = '<div style="max-width: 500px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">${job.icon} ${job.name}</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">Round ${round + 1}/${scenarios.length}</p>`;

            // Crowd mood bar
            html += `<div style="margin-bottom: 12px;">
                <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Crowd Approval: <span style="color: ${moodColor};">${crowdMood}%</span></div>
                <div style="background: rgba(255,255,255,0.08); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="width: ${crowdMood}%; height: 100%; background: ${moodColor}; transition: width 0.4s; border-radius: 5px;"></div>
                </div>
            </div>`;

            html += `<div style="font-size: 20px; margin: 8px 0; opacity: 0.5; letter-spacing: 4px;">${sc.crowd}</div>`;
            html += `<div style="font-size: 13px; color: var(--text-primary); margin: 12px 0; font-style: italic;">"${sc.prompt}"</div>`;

            if (feedbackMsg) {
                html += `<div style="font-size: 13px; margin: 10px 0; min-height: 20px;">${feedbackMsg}</div>`;
            }

            if (!locked) {
                for (let i = 0; i < sc.options.length; i++) {
                    const opt = sc.options[i];
                    const isBest = opt.mood >= 18;
                    const hintBorder = showHint && isBest ? 'border-left: 3px solid rgba(46,204,113,0.4);' : 'border-left: 3px solid transparent;';
                    html += `<button onclick="window._laborSpeakChoice(${i})"
                        style="display: block; width: 100%; padding: 10px 14px; margin-bottom: 6px;
                               background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); ${hintBorder}
                               border-radius: 6px; cursor: pointer; text-align: left; color: var(--text-primary);
                               font-size: 13px; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                        ${opt.text}
                    </button>`;
                }
            }

            html += '</div>';
            return html;
        };

        const showRound = () => {
            locked = false;
            game.ui.showCustomPanel(`📯 ${job.name}`, render());
        };

        window._laborSpeakChoice = (idx) => {
            if (locked || round >= scenarios.length) return;
            locked = true;

            const opt = scenarios[round].options[idx];
            let change = opt.mood;
            // Risky options that can go high
            if (opt.max && Math.random() < 0.5) change = Math.floor(Math.random() * (opt.max - opt.mood + 1)) + opt.mood;
            crowdMood = Math.max(0, Math.min(100, crowdMood + change));

            const fb = change >= 18 ? '<span style="color: #2ecc71;">🎉 The crowd cheers!</span>'
                     : change >= 10 ? '<span style="color: #3498db;">👏 Nods of approval.</span>'
                     : change >= 0 ? '<span style="color: #f39c12;">😐 A tepid response...</span>'
                     : '<span style="color: #e74c3c;">😒 Groans from the crowd...</span>';

            game.ui.showCustomPanel(`📯 ${job.name}`, render(fb));

            round++;
            if (round < scenarios.length) {
                setTimeout(() => showRound(), 1400);
            } else {
                setTimeout(() => ActionMenu._laborReward(game, tile, job, crowdMood), 1400);
            }
        };

        showRound();
    },

    /**
     * Perform foraging on wilderness tiles
     */
    doForage(game, tile) {
        const terrainId = tile.terrain.id;
        const forageData = ActionMenu._getForageData();
        const mapping = forageData.terrain_mapping;
        const category = mapping[terrainId];

        if (!category || !forageData.loot_table[category]) {
            game.ui.showNotification('Nothing Found', 'This terrain has nothing worth gathering.', 'default');
            return;
        }

        const player = game.player;
        const lootTable = forageData.loot_table[category];
        const intStat = player.intelligence || 5;
        const luckStat = player.luck || 5;

        ActionMenu._showMinigamePrompt(game, {
            title: '🌿 Foraging',
            icon: '🌿',
            description: 'Search the area for useful plants and materials.',
            baseRewardText: '1 random foraged item',
            onSkip: () => {
                // Base reward: 1 random item from loot table
                const intBonus = 1 + intStat * 0.05;
                let entry = null;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const roll = Math.random();
                    let cumChance = 0;
                    for (const e of lootTable) {
                        cumChance += e.chance * intBonus * 0.6;
                        if (roll < cumChance) { entry = e; break; }
                    }
                    if (entry) break;
                }
                if (!entry) entry = lootTable[0];
                const sellPrice = entry.sell || 5;
                player.inventory = player.inventory || {};
                player.inventory[entry.item] = (player.inventory[entry.item] || 0) + 1;
                game.ui.showNotification('🌿 Foraging', `Quick search — found ${entry.icon || '🌿'} ${entry.name || entry.item} (~${sellPrice}g).`, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doForageMinigame(game, tile, player, lootTable, intStat, luckStat); }
        });
    },

    _doForageMinigame(game, tile, player, lootTable, intStat, luckStat) {
        const terrainId = tile.terrain.id;

        // ── Foraging Minigame: Search patches ──
        const GRID_SIZE = 4;
        let grid = [];
        let searchesLeft = 4 + Math.floor(intStat / 3);
        let found = [];
        let totalValue = 0;
        let phase = 'searching'; // searching → result
        let statusMsg = '';
        let revealedHints = [];

        // Place loot items randomly. Each cell is: { type, entry, searched, hinted }
        const generateGrid = () => {
            grid = [];
            for (let y = 0; y < GRID_SIZE; y++) {
                const row = [];
                for (let x = 0; x < GRID_SIZE; x++) {
                    // Each cell has a chance of holding an item from the loot table
                    const roll = Math.random();
                    let cumChance = 0;
                    let entry = null;
                    const intBonus = 1 + intStat * 0.05;
                    for (const e of lootTable) {
                        cumChance += e.chance * intBonus * 0.6;
                        if (roll < cumChance) { entry = e; break; }
                    }
                    row.push({
                        entry,
                        searched: false,
                        hinted: false,
                        nearbyCount: 0, // filled in after generation
                    });
                }
                grid.push(row);
            }
            // Calculate "nearby" hints — count loot in adjacent cells
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    let count = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const ny = y + dy, nx = x + dx;
                            if (ny >= 0 && ny < GRID_SIZE && nx >= 0 && nx < GRID_SIZE && grid[ny][nx].entry) {
                                count++;
                            }
                        }
                    }
                    grid[y][x].nearbyCount = count;
                }
            }
        };
        generateGrid();

        // Terrain icons for flavor
        const terrainIcons = {
            'forest': ['🌲', '🌳', '🌿', '🍄'],
            'plains': ['🌾', '🌱', '⛰️', '🌻'],
            'swamp': ['🌊', '🌿', '🍂', '🐸'],
            'desert': ['🏜️', '🌵', '⛰️', '☀️'],
            'mountains': ['⛰️', '⛰️', '🌿', '❄️'],
            'coast': ['🐚', '🌊', '⛰️', '🌿'],
        };
        const icons = terrainIcons[category] || ['🌿', '🍂', '⛰️', '🌱'];

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">🌿 Foraging</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Terrain: ${category} | Intelligence: ${intStat} | Luck: ${luckStat}</p>`;

            if (phase === 'searching') {
                html += `<div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px;">
                    <span>🔍 Searches left: <span style="color: var(--gold); font-weight: bold;">${searchesLeft}</span></span>
                    <span>💰 Found: <span style="color: var(--gold);">${totalValue}g</span></span>
                </div>`;

                // Grid
                html += '<div style="display: grid; grid-template-columns: repeat(' + GRID_SIZE + ', 1fr); gap: 3px; margin-bottom: 10px;">';
                for (let y = 0; y < GRID_SIZE; y++) {
                    for (let x = 0; x < GRID_SIZE; x++) {
                        const cell = grid[y][x];
                        if (cell.searched) {
                            if (cell.entry) {
                                // Found item
                                html += `<div style="width: 100%; height: 64px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;
                                    background: rgba(46,204,113,0.15); border: 1px solid rgba(46,204,113,0.3); font-size: 22px;">
                                    ${cell.entry.icon}
                                    <span style="font-size: 9px; color: #2ecc71;">${cell.entry.name}</span>
                                </div>`;
                            } else {
                                // Empty — show nearby hint
                                const hintColor = cell.nearbyCount > 0 ? 'rgba(243,156,18,0.7)' : 'rgba(255,255,255,0.2)';
                                html += `<div style="width: 100%; height: 64px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;
                                    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
                                    <span style="font-size: 16px; color: ${hintColor};">${cell.nearbyCount > 0 ? cell.nearbyCount : '·'}</span>
                                    <span style="font-size: 8px; color: var(--text-muted);">${cell.nearbyCount > 0 ? 'nearby' : 'empty'}</span>
                                </div>`;
                            }
                        } else {
                            // Unsearched — clickable
                            const bgIcon = icons[Math.floor((y * GRID_SIZE + x) % icons.length)];
                            html += `<button onclick="window._forageSearch(${x},${y})"
                                style="width: 100%; height: 64px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
                                background: rgba(46,139,87,0.08); border: 1px solid rgba(255,255,255,0.08); cursor: pointer;
                                font-size: 22px; transition: all 0.15s;"
                                onmouseenter="this.style.background='rgba(46,139,87,0.18)'; this.style.borderColor='var(--gold)'"
                                onmouseleave="this.style.background='rgba(46,139,87,0.08)'; this.style.borderColor='rgba(255,255,255,0.08)'">
                                ${bgIcon}
                            </button>`;
                        }
                    }
                }
                html += '</div>';

                if (statusMsg) html += `<div style="margin-bottom: 8px; font-size: 12px;">${statusMsg}</div>`;

                html += `<div style="display: flex; gap: 8px; justify-content: center;">
                    <button onclick="window._forageFinish()"
                        style="padding: 8px 20px; background: var(--gold); border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">
                        Done Foraging
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Search patches for resources! Numbers show nearby items.</div>`;

            } else {
                // Results
                html += `<div style="font-size: 48px; margin: 8px 0;">🌿</div>`;
                if (found.length > 0) {
                    html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Foraging Haul</div>`;
                    // Consolidate
                    const totals = {};
                    for (const f of found) {
                        const key = f.entry.name;
                        if (!totals[key]) totals[key] = { ...f.entry, foundQty: 0 };
                        totals[key].foundQty += f.qty;
                    }
                    for (const item of Object.values(totals)) {
                        html += `<div style="padding: 6px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between;">
                            <div>${item.icon} ${item.name} x${item.foundQty}</div>
                            <div style="color: var(--gold);">${item.foundQty * item.sellPrice}g</div>
                        </div>`;
                    }
                    html += `<div style="margin-top: 8px; padding: 8px; background: rgba(245,197,66,0.1); border-radius: 4px; font-weight: bold; color: var(--gold);">Total: ${totalValue} gold</div>`;
                } else {
                    html += `<div style="font-size: 16px; color: #f39c12; margin-bottom: 8px;">Slim Pickings</div>`;
                    html += `<div style="color: var(--text-secondary);">You searched but found nothing of value today.</div>`;
                }
                html += `<button onclick="window._forageContinue()"
                    style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🌿 Foraging', html);
            window._forageContinue = () => { game.ui.hideCustomPanel(); game.endDay(); };
        };

        render();

        window._forageSearch = (x, y) => {
            if (phase !== 'searching' || searchesLeft <= 0) return;
            const cell = grid[y][x];
            if (cell.searched) return;

            cell.searched = true;
            searchesLeft--;

            if (cell.entry) {
                const intBonus = 1 + intStat * 0.05;
                const qty = Math.floor(Math.random() * (cell.entry.qty.max - cell.entry.qty.min + 1)) + cell.entry.qty.min;
                found.push({ entry: cell.entry, qty });
                const value = qty * cell.entry.sellPrice;
                totalValue += value;
                statusMsg = `<span style="color: #2ecc71;">Found ${cell.entry.icon} ${cell.entry.name} x${qty}! (+${value}g)</span>`;
            } else {
                if (cell.nearbyCount > 0) {
                    statusMsg = `<span style="color: #f39c12;">Nothing here, but ${cell.nearbyCount} item${cell.nearbyCount > 1 ? 's' : ''} nearby...</span>`;
                } else {
                    statusMsg = `<span style="color: var(--text-muted);">Nothing in this area.</span>`;
                }
            }

            if (searchesLeft <= 0) {
                // Auto-finish
                finishForaging();
                return;
            }
            render();
        };

        const finishForaging = () => {
            phase = 'result';
            if (found.length > 0) {
                player.gold += totalValue;
                player.renown += found.length > 2 ? 1 : 0;
                if (!player.foragingTrips) player.foragingTrips = 0;
                player.foragingTrips++;
                if (player.financeToday) {
                    player.financeToday.income.foraging = (player.financeToday.income.foraging || 0) + totalValue;
                }
            }
            render();
            game.ui.updateStats(player, game.world);
        };

        window._forageFinish = () => {
            finishForaging();
        };
    },

    /**
     * Hunt wild game on wilderness tiles
     */
    doHunt(game, tile) {
        const terrainId = tile.terrain.id;
        const huntData = ActionMenu._getHuntData();
        const mapping = ActionMenu._getForageData().terrain_mapping;
        const category = mapping[terrainId];

        if (!category || !huntData.loot_table[category]) {
            game.ui.showNotification('No Game', 'There is nothing to hunt in this terrain.', 'default');
            return;
        }

        const player = game.player;
        const combatSkill = player.skills?.combat || 1;
        const strStat = player.strength || 5;
        const luckStat = player.luck || 5;
        const lootTable = huntData.loot_table[category];

        ActionMenu._showMinigamePrompt(game, {
            title: '🏹 Hunting',
            icon: '🏹',
            description: 'Track and hunt wild game in this area.',
            baseRewardText: '1 basic game item',
            onSkip: () => {
                // Base reward: 1 item from loot table (basic game)
                const entry = lootTable[0] || { item: 'meat', name: 'Venison', icon: '🥩', sell: 8 };
                player.inventory = player.inventory || {};
                player.inventory[entry.item] = (player.inventory[entry.item] || 0) + 1;
                const sellPrice = entry.sell || 8;
                game.ui.showNotification('🏹 Hunting', `Quick hunt — caught ${entry.icon || '🥩'} ${entry.name || entry.item} (~${sellPrice}g).`, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => {
                // Pick a prey animal from the loot table
                const preyPool = lootTable.filter(e => e.chance > 0);
                const prey = preyPool[Math.floor(Math.random() * preyPool.length)];
                const preyName = prey.name || 'Animal';
                const preyIcon = prey.icon || '🦌';
                ActionMenu._doHuntMinigame(game, tile, player, combatSkill, strStat, luckStat, lootTable, prey, preyName, preyIcon);
            }
        });
    },

    _doHuntMinigame(game, tile, player, combatSkill, strStat, luckStat, lootTable, prey, preyName, preyIcon) {
        // ── Hunt minigame: 3 phases — Track → Stalk → Strike ──
        let phase = 'track';   // track → stalk → strike → result
        let trackProgress = 0; // 0-100
        let stalkDistance = 5;  // tiles away, get to 0
        let alertLevel = 0;    // 0-100, animal flees at 100
        let strikeWindow = false;
        let strikeTimer = null;
        let huntResult = null;  // 'success' | 'fled' | 'injured'
        let statusMsg = '';
        let trackClues = [];
        let trackRound = 0;
        const maxTrackRounds = 5;
        let stalkInterval = null;
        let totalLoot = [];
        let totalValue = 0;

        const cleanup = () => {
            if (strikeTimer) clearTimeout(strikeTimer);
            if (stalkInterval) clearInterval(stalkInterval);
        };

        // Generate tracking clues
        const clueTypes = [
            { icon: '🐾', label: 'Fresh tracks', correct: true },
            { icon: '💩', label: 'Droppings (recent)', correct: true },
            { icon: '🌿', label: 'Broken branches', correct: true },
            { icon: '🍃', label: 'Disturbed foliage', correct: true },
            { icon: '🪶', label: 'Shed fur/feathers', correct: true },
            { icon: '❌', label: 'Old tracks (cold)', correct: false },
            { icon: '🌫️', label: 'Wind-blown trail', correct: false },
            { icon: '💧', label: 'Rain-washed prints', correct: false },
            { icon: '⛰️', label: 'Rocky ground (no tracks)', correct: false },
        ];

        const generateClueChoices = () => {
            const correct = clueTypes.filter(c => c.correct);
            const wrong = clueTypes.filter(c => !c.correct);
            const pick = [
                correct[Math.floor(Math.random() * correct.length)],
                correct[Math.floor(Math.random() * correct.length)],
                wrong[Math.floor(Math.random() * wrong.length)],
            ];
            // Shuffle
            for (let i = pick.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pick[i], pick[j]] = [pick[j], pick[i]];
            }
            return pick;
        };

        const render = () => {
            let html = '<div style="max-width: 500px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">🏹 Hunting — ${preyIcon} ${preyName}</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px;">Terrain: ${category} | Combat: ${combatSkill} | Strength: ${strStat}</p>`;

            if (phase === 'track') {
                // ── Tracking phase: pick the right clue ──
                html += `<div style="margin-bottom: 10px;">
                    <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px;">Phase 1: Track the ${preyName}</div>
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Tracking Progress</span>
                        <span style="color: #2ecc71;">${Math.round(trackProgress)}% (Round ${trackRound}/${maxTrackRounds})</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${trackProgress}%; height: 100%; background: #2ecc71; transition: width 0.3s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                if (statusMsg) {
                    html += `<div style="margin-bottom: 10px; font-size: 12px;">${statusMsg}</div>`;
                }

                if (trackRound < maxTrackRounds && trackProgress < 100) {
                    html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Which clue leads to the ${preyName}?</div>`;
                    const choices = generateClueChoices();
                    trackClues = choices;
                    for (let i = 0; i < choices.length; i++) {
                        const c = choices[i];
                        html += `<button onclick="window._huntTrack(${i})"
                            style="display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; margin-bottom: 6px;
                                   background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
                                   border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                            onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                            <span style="font-size: 20px;">${c.icon}</span>
                            <span style="font-size: 13px;">${c.label}</span>
                        </button>`;
                    }
                }

                html += `<button onclick="window._huntAbort()"
                    style="margin-top: 6px; padding: 6px 18px; background: none; border: 1px solid rgba(255,255,255,0.08);
                           border-radius: 6px; cursor: pointer; color: var(--text-muted); font-size: 11px;">Give Up</button>`;

            } else if (phase === 'stalk') {
                // ── Stalking phase: approach without alerting ──
                html += `<div style="margin-bottom: 10px;">
                    <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Phase 2: Stalk the ${preyName}</div>
                </div>`;

                // Distance display
                html += `<div style="position: relative; height: 80px; background: rgba(0,0,0,0.2); border-radius: 10px; overflow: hidden; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.08);">`;
                // Prey on right
                const preyX = 75 + stalkDistance * 3;
                html += `<div style="position: absolute; top: 50%; right: ${Math.min(85, 15 + stalkDistance * 12)}%; transform: translateY(-50%); font-size: 28px; transition: right 0.3s;">${preyIcon}</div>`;
                // Player on left
                html += `<div style="position: absolute; top: 50%; left: 10%; transform: translateY(-50%); font-size: 24px;">🏹</div>`;
                // Distance indicator
                html += `<div style="position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 10px; color: var(--text-muted);">${stalkDistance} paces away</div>`;
                html += `</div>`;

                // Alert level
                const alertColor = alertLevel < 40 ? '#2ecc71' : alertLevel < 70 ? '#f39c12' : '#e74c3c';
                const alertLabel = alertLevel < 40 ? '🤫 Unaware' : alertLevel < 70 ? '👂 Alert' : '⚠️ Spooked!';
                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Animal Alertness</span>
                        <span style="color: ${alertColor}; font-weight: 600;">${alertLabel} ${Math.round(alertLevel)}%</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${alertLevel}%; height: 100%; background: ${alertColor}; transition: width 0.25s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                if (statusMsg) {
                    html += `<div style="margin-bottom: 8px; font-size: 12px;">${statusMsg}</div>`;
                }

                html += `<div style="display: flex; gap: 8px; justify-content: center;">
                    <button onclick="window._huntCreep()"
                        style="padding: 10px 20px; background: rgba(46,204,113,0.15); border: 1px solid #2ecc71;
                               border-radius: 8px; cursor: pointer; color: #2ecc71; font-size: 13px; font-weight: bold; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                        🤫 Creep Closer
                    </button>
                    <button onclick="window._huntWait()"
                        style="padding: 10px 20px; background: rgba(52,152,219,0.15); border: 1px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: #3498db; font-size: 13px; font-weight: bold; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        ⏳ Wait (calm it)
                    </button>
                    ${stalkDistance <= 2 ? `<button onclick="window._huntShoot()"
                        style="padding: 10px 24px; background: rgba(243,156,18,0.2); border: 2px solid #f39c12;
                               border-radius: 8px; cursor: pointer; color: #f39c12; font-size: 13px; font-weight: bold; transition: all 0.15s;
                               box-shadow: 0 0 12px rgba(243,156,18,0.2);"
                        onmouseenter="this.style.background='rgba(243,156,18,0.3)'" onmouseleave="this.style.background='rgba(243,156,18,0.2)'">
                        🏹 Take the Shot!
                    </button>` : ''}
                </div>`;
                if (stalkDistance > 2) {
                    html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Get within 2 paces to take a shot.</div>`;
                }

            } else if (phase === 'strike') {
                // ── Strike phase: timed accuracy click ──
                html += `<div style="margin-bottom: 10px;">
                    <div style="font-size: 13px; color: var(--gold); font-weight: bold; margin-bottom: 8px;">Phase 3: Take the Shot!</div>
                </div>`;

                html += `<div style="position: relative; height: 60px; background: rgba(0,0,0,0.3); border-radius: 10px; overflow: hidden; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.1);">`;
                // Moving target zone
                html += `<div id="huntTarget" style="position: absolute; top: 10px; bottom: 10px; width: 50px; background: rgba(46,204,113,0.25); border: 2px solid #2ecc71; border-radius: 6px; transition: left 0.08s;"></div>`;
                // Center crosshair
                html += `<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 24px; opacity: 0.8;">🎯</div>`;
                html += `</div>`;

                html += `<button onclick="window._huntFire()"
                    style="padding: 14px 48px; background: linear-gradient(135deg, #e74c3c, #c0392b); color: white; border: none; border-radius: 10px; cursor: pointer;
                           font-family: var(--font-display); font-size: 16px; letter-spacing: 1px; box-shadow: 0 0 20px rgba(231,76,60,0.4);">
                    🏹 FIRE!
                </button>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Click when the green zone is centered on the crosshair!</div>`;

            } else if (phase === 'result') {
                if (huntResult === 'success') {
                    html += `<div style="font-size: 48px; margin: 12px 0;">${preyIcon}</div>`;
                    html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Successful Hunt!</div>`;
                    for (const item of totalLoot) {
                        html += `<div style="padding: 6px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <div>${item.icon} ${item.name} x${item.foundQty}</div>
                            <div style="color: var(--gold);">${item.foundQty * item.sellPrice}g</div>
                        </div>`;
                    }
                    html += `<div style="margin-top: 8px; padding: 8px; background: rgba(245,197,66,0.1); border-radius: 4px; font-weight: bold; color: var(--gold);">Total: ${totalValue} gold</div>`;
                    if (statusMsg) html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 6px;">${statusMsg}</div>`;
                } else if (huntResult === 'fled') {
                    html += `<div style="font-size: 48px; margin: 12px 0;">💨</div>`;
                    html += `<div style="font-size: 16px; color: #f39c12; font-weight: bold; margin-bottom: 8px;">The ${preyName} escaped!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
                } else if (huntResult === 'injured') {
                    html += `<div style="font-size: 48px; margin: 12px 0;">🤕</div>`;
                    html += `<div style="font-size: 16px; color: #e74c3c; font-weight: bold; margin-bottom: 8px;">Hunting Mishap!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
                } else {
                    html += `<div style="font-size: 48px; margin: 12px 0;">🏹</div>`;
                    html += `<div style="font-size: 16px; color: var(--text-secondary); font-weight: bold; margin-bottom: 8px;">Missed!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
                }
                html += `<button onclick="window._huntContinue()"
                    style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🏹 Hunting', html);
            window._huntContinue = () => { game.ui.hideCustomPanel(); game.endDay(); };
        };

        render();

        // ── Track: pick the right clue ──
        window._huntTrack = (idx) => {
            if (phase !== 'track') return;
            trackRound++;
            const chosen = trackClues[idx];
            if (chosen && chosen.correct) {
                const gain = 20 + combatSkill * 2 + Math.random() * 10;
                trackProgress = Math.min(100, trackProgress + gain);
                statusMsg = `<span style="color: #2ecc71;">✓ ${chosen.label} — you're on the trail!</span>`;
            } else {
                trackProgress = Math.max(0, trackProgress - 5);
                statusMsg = `<span style="color: #e74c3c;">✗ ${chosen ? chosen.label : 'Nothing'} — wrong direction, lost time.</span>`;
            }

            if (trackProgress >= 100 || trackRound >= maxTrackRounds) {
                if (trackProgress >= 60) {
                    phase = 'stalk';
                    stalkDistance = trackProgress >= 90 ? 3 : 5;
                    alertLevel = trackProgress >= 90 ? 5 : 15;
                    statusMsg = `<span style="color: #2ecc71;">You found the ${preyName}! Approach carefully...</span>`;
                } else {
                    phase = 'result';
                    huntResult = 'fled';
                    statusMsg = `You couldn't pick up the trail. The ${preyName} is long gone.`;
                }
            }
            render();
        };

        // ── Stalk: creep closer ──
        window._huntCreep = () => {
            if (phase !== 'stalk') return;
            stalkDistance = Math.max(0, stalkDistance - 1);
            const noiseChance = 0.35 - combatSkill * 0.02;
            const alertGain = Math.random() < noiseChance ? (15 + Math.random() * 15) : (3 + Math.random() * 5);
            alertLevel = Math.min(100, alertLevel + alertGain);

            if (alertGain > 12) {
                statusMsg = '<span style="color: #f39c12;">⚠️ A twig snapped underfoot!</span>';
            } else {
                statusMsg = '<span style="color: #2ecc71;">You inch closer silently...</span>';
            }

            if (alertLevel >= 100) {
                cleanup();
                phase = 'result';
                huntResult = 'fled';
                statusMsg = `The ${preyName} spotted you and bolted into the ${category}!`;
            }
            render();
        };

        // ── Stalk: wait to reduce alertness ──
        window._huntWait = () => {
            if (phase !== 'stalk') return;
            const reduction = 10 + combatSkill * 2 + Math.random() * 8;
            alertLevel = Math.max(0, alertLevel - reduction);
            statusMsg = '<span style="color: #3498db;">You hold still and wait... the animal calms down.</span>';
            render();
        };

        // ── Stalk → Strike: take the shot ──
        window._huntShoot = () => {
            if (phase !== 'stalk' || stalkDistance > 2) return;
            phase = 'strike';
            statusMsg = '';
            render();

            // Animate the target zone moving back and forth
            let targetPos = 0;
            let targetDir = 1;
            const speed = 3 + (combatSkill < 3 ? 2 : 0); // faster for low skill
            stalkInterval = setInterval(() => {
                targetPos += targetDir * speed;
                if (targetPos > 80 || targetPos < 0) targetDir *= -1;
                const el = document.getElementById('huntTarget');
                if (el) el.style.left = targetPos + '%';
            }, 50);
        };

        // ── Strike: fire the arrow ──
        window._huntFire = () => {
            if (phase !== 'strike') return;
            cleanup();
            // Check accuracy: target center should be near 50%
            const el = document.getElementById('huntTarget');
            let accuracy = 0;
            if (el) {
                const pos = parseFloat(el.style.left) || 0;
                const center = pos + 25; // target is 50px wide
                accuracy = 100 - Math.abs(center - 50) * 2;
            } else {
                accuracy = 40 + Math.random() * 30;
            }

            const hitThreshold = 35 - combatSkill * 2 - strStat;
            if (accuracy >= hitThreshold) {
                // Hit!
                const combatBonus = 1 + combatSkill * 0.08;
                const strBonus = 1 + strStat * 0.03;
                const totalBonus = combatBonus * strBonus;

                for (const entry of lootTable) {
                    if (Math.random() < entry.chance * totalBonus * 1.3) {
                        const qty = Math.floor(Math.random() * (entry.qty.max - entry.qty.min + 1)) + entry.qty.min;
                        totalLoot.push({ ...entry, foundQty: qty });
                        totalValue += qty * entry.sellPrice;
                    }
                }
                if (totalLoot.length === 0) {
                    // At least give one item
                    const fallback = lootTable[0];
                    totalLoot.push({ ...fallback, foundQty: 1 });
                    totalValue += fallback.sellPrice;
                }

                player.gold += totalValue;
                if (!player.huntingTrips) player.huntingTrips = 0;
                player.huntingTrips++;
                if (player.financeToday) {
                    player.financeToday.income.hunting = (player.financeToday.income.hunting || 0) + totalValue;
                }

                let extra = '';
                if (player.skills && Math.random() < 0.25) {
                    player.skills.combat = Math.min(10, (player.skills.combat || 1) + 0.1);
                    extra = ' Combat skill improved!';
                }

                huntResult = 'success';
                statusMsg = extra;
                phase = 'result';
            } else if (accuracy < 15 && Math.random() < 0.2) {
                // Bad miss + injury
                const dmg = Math.floor(Math.random() * 12) + 5;
                player.health = Math.max(1, player.health - dmg);
                huntResult = 'injured';
                statusMsg = `Your arrow ricocheted! -${dmg} HP`;
                phase = 'result';
            } else {
                huntResult = 'missed';
                statusMsg = `Your arrow flew wide. The ${preyName} fled.`;
                phase = 'result';
            }
            render();
            game.ui.updateStats(player, game.world);
        };

        // ── Abort ──
        window._huntAbort = () => {
            cleanup();
            phase = 'result';
            huntResult = 'fled';
            statusMsg = 'You gave up the hunt and headed back.';
            render();
        };
    },

    /**
     * Show the bounty board at a settlement
     */
    showBountyBoardMenu(game, tile) {
        const settlement = tile.settlement;
        if (!settlement) return;

        // Initialize player bounties if needed
        if (!game.player.activeBounties) game.player.activeBounties = [];
        if (typeof BountyHunting !== 'undefined') {
            BountyHunting.initialize(game.player);
        }

        // Generate 2-4 bounties for this settlement
        const bountyTemplates = ActionMenu._getBountyData();
        const numBounties = Math.floor(Math.random() * 3) + 2;
        const shuffled = [...bountyTemplates].sort(() => Math.random() - 0.5).slice(0, numBounties);

        // Find nearby settlements for delivery bounties
        const nearbySettlements = [];
        if (game.world.getAllSettlements) {
            const allS = game.world.getAllSettlements();
            for (const s of allS) {
                if (s.q === tile.q && s.r === tile.r) continue;
                const dist = Hex.wrappingDistance ? Hex.wrappingDistance(tile.q, tile.r, s.q, s.r, game.world.width) :
                    Hex.distance(tile.q, tile.r, s.q, s.r);
                if (dist <= 20) nearbySettlements.push({ ...s, dist });
            }
        }

        const basicBounties = shuffled.map(template => {
            const pay = Math.floor(Math.random() * (template.pay.max - template.pay.min + 1)) + template.pay.min;
            const bounty = { ...template, actualPay: pay, fromSettlement: settlement.name, fromQ: tile.q, fromR: tile.r };

            // Fill in destination for delivery bounties
            if (template.type === 'delivery' && nearbySettlements.length > 0) {
                const dest = nearbySettlements[Math.floor(Math.random() * nearbySettlements.length)];
                bounty.description = template.description.replace('{destination}', dest.name);
                bounty.destQ = dest.q;
                bounty.destR = dest.r;
                bounty.destName = dest.name;
            } else if (template.type === 'delivery') {
                bounty.description = template.description.replace('{destination}', 'a nearby settlement');
                bounty.destQ = tile.q;
                bounty.destR = tile.r;
                bounty.destName = settlement.name;
            }

            // Fill in explore bounties
            if (template.type === 'explore') {
                bounty.description = template.description.replace('{count}', template.exploreCount || 15);
                bounty.tilesNeeded = template.exploreCount || 15;
                bounty.tilesExploredAtStart = 0; // Will be set on accept
            }

            // Fill in gather bounties
            if (template.type === 'gather') {
                const resources = ['wood', 'herbs', 'stone', 'grain'];
                const res = resources[Math.floor(Math.random() * resources.length)];
                const qty = Math.floor(Math.random() * 5) + 3;
                bounty.description = template.description.replace('{qty}', qty).replace('{resource}', res);
                bounty.resourceNeeded = res;
                bounty.qtyNeeded = qty;
            }

            // Fill in instant bounties
            if (template.type === 'instant') {
                bounty.description = template.description
                    .replace('{pest}', ['rats', 'wolves', 'boars', 'snakes'][Math.floor(Math.random() * 4)])
                    .replace('{location}', ['granary', 'cellar', 'farmsteads', 'market stalls'][Math.floor(Math.random() * 4)]);
            }

            return bounty;
        });

        const bounties = (typeof BountyHunting !== 'undefined')
            ? BountyHunting.generateBoardOffers(game.player, game.world, tile, basicBounties)
            : basicBounties;

        // Show active bounties first
        let html = '<div style="max-height: 500px; overflow-y: auto;">';
        html += '<h4 style="margin-top: 0;">📋 Notice Board</h4>';

        // Active bounties
        if (game.player.activeBounties.length > 0) {
            html += '<div style="margin-bottom: 12px; padding: 8px; background: rgba(46,204,113,0.08); border: 1px solid rgba(46,204,113,0.3); border-radius: 6px;">';
            html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #2ecc71; margin-bottom: 6px;">Active Bounties</div>';
            for (let i = 0; i < game.player.activeBounties.length; i++) {
                const b = game.player.activeBounties[i];
                const daysLeft = b.daysLimit - (b.daysElapsed || 0);
                const isDeliveryComplete = b.type === 'delivery' && game.player.q === b.destQ && game.player.r === b.destR;
                const isInstantComplete = b.type === 'instant' && game.player.q === b.fromQ && game.player.r === b.fromR;
                const onCriminalTarget = b.type === 'criminal_hunt' && b.status === 'active' && game.player.q === b.targetQ && game.player.r === b.targetR;
                const awaitingDecision = b.type === 'criminal_hunt' && b.status === 'captured_pending_decision';
                const locationHint = b.type === 'criminal_hunt'
                    ? `Last seen near (${b.targetQ}, ${b.targetR})`
                    : (b.destName ? `Destination: ${b.destName}` : '');

                let controls = '';
                if (isDeliveryComplete || isInstantComplete) {
                    controls = `<button onclick="window._completeBounty(${i})" style="margin-top: 4px; padding: 4px 12px; background: #2ecc71; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">✓ Complete</button>`;
                } else if (onCriminalTarget) {
                    controls = `<button onclick="window._attemptCriminalCapture(${i})" style="margin-top: 4px; padding: 4px 12px; background: #e67e22; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">⚔️ Capture</button>`;
                } else if (awaitingDecision) {
                    controls = `
                        <div style="display:flex; gap:6px; margin-top:6px;">
                            <button onclick="window._resolveCapturedBounty(${i}, 'turn_in')" style="padding: 4px 10px; background: #2ecc71; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Turn In</button>
                            <button onclick="window._resolveCapturedBounty(${i}, 'recruit')" style="padding: 4px 10px; background: #9b59b6; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color:#fff;">Recruit</button>
                        </div>
                    `;
                }

                html += `
                    <div style="padding: 8px; margin-bottom: 4px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                        <div><span style="font-size: 14px;">${b.icon}</span> <strong>${b.name}</strong> — <span style="color: var(--gold);">${b.actualPay}g</span></div>
                        <div style="font-size: 11px; color: #aaa;">${b.description}</div>
                        ${locationHint ? `<div style="font-size: 11px; color: #7db4ff;">📍 ${locationHint}</div>` : ''}
                        <div style="font-size: 11px; color: ${daysLeft <= 2 ? '#e74c3c' : '#aaa'};">⏳ ${daysLeft} days remaining</div>
                        ${controls}
                    </div>
                `;
            }
            html += '</div>';
        }

        // Available bounties
        html += '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin-bottom: 8px;">Available Bounties</div>';

        for (let i = 0; i < bounties.length; i++) {
            const b = bounties[i];
            const maxBounties = 3;
            const alreadyAccepted = game.player.activeBounties.some(active => active.id && b.id && active.id === b.id);
            const canAccept = game.player.activeBounties.length < maxBounties && !alreadyAccepted;
            const difficultyLabel = typeof b.difficulty === 'number' ? `Lv ${b.difficulty}` : b.difficulty;
            const isHighDanger = (typeof b.difficulty === 'number' ? b.difficulty >= 7 : b.difficulty === 'medium');

            html += `
                <div style="padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid ${isHighDanger ? '#f39c12' : '#3498db'}; ${!canAccept ? 'opacity: 0.5;' : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div><span style="font-size: 16px;">${b.icon}</span> <strong>${b.name}</strong> <span style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${isHighDanger ? 'rgba(243,156,18,0.2)' : 'rgba(52,152,219,0.2)'}; color: ${isHighDanger ? '#f39c12' : '#3498db'};">${difficultyLabel}</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin: 4px 0;">${b.description}</div>
                            ${b.targetBackstory ? `<div style="font-size: 11px; color: #b9b9d6;">📖 ${b.targetBackstory}</div>` : ''}
                            <div style="font-size: 11px; color: #aaa;">⏳ ${b.daysLimit} day limit</div>
                        </div>
                        <button onclick="window._acceptBounty(${i})" ${!canAccept ? 'disabled' : ''}
                                style="padding: 8px 16px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; min-width: 80px;">
                            ${alreadyAccepted ? 'Taken' : `${b.actualPay}g`}
                        </button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        game.ui.showCustomPanel('Notice Board', html);

        window._acceptBounty = (idx) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const bounty = bounties[idx];
            if (!bounty) return;
            if (game.player.activeBounties.length >= 3) {
                game.ui.showNotification('Too Many', 'You can only have 3 active bounties. Complete some first.', 'error');
                return;
            }

            bounty.daysElapsed = 0;
            bounty.status = bounty.status || 'active';

            if (bounty.type === 'criminal_hunt') {
                game.player.activeBounties.push(bounty);
                if (game.player.bountyHunter && Array.isArray(game.player.bountyHunter.boardOffers) && bounty.id) {
                    game.player.bountyHunter.boardOffers = game.player.bountyHunter.boardOffers.filter(entry => entry.id !== bounty.id);
                }
                game.ui.showNotification('Bounty Accepted!', `${bounty.targetName} marked for capture. Last seen near (${bounty.targetQ}, ${bounty.targetR}).`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showBountyBoardMenu(game, tile);
                return;
            }

            // For instant bounties, resolve immediately with skill check
            if (bounty.type === 'instant') {
                const stat = bounty.stat || 'combat';
                const statVal = ActionMenu._getPlayerStat(game.player, stat);
                const roll = Math.random() * 10;
                const success = roll < statVal + 3;

                if (success) {
                    game.player.gold += bounty.actualPay;
                    game.player.renown += 2;
                    if (game.player.financeToday) {
                        game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + bounty.actualPay;
                    }
                    game.ui.showNotification('Bounty Complete!', `${bounty.name} — earned ${bounty.actualPay} gold!`, 'success');
                } else {
                    const dmg = Math.floor(Math.random() * 10) + 5;
                    game.player.health = Math.max(1, game.player.health - dmg);
                    game.ui.showNotification('Failed!', `${bounty.name} — you struggled and lost ${dmg} health.`, 'error');
                }
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
                game.endDay();
                return;
            }

            // For other bounties, add to active list
            game.player.activeBounties.push(bounty);
            game.ui.showNotification('Bounty Accepted!', `${bounty.name} — ${bounty.daysLimit} days to complete.`, 'success');
            game.ui.hideCustomPanel();
            ActionMenu.showBountyBoardMenu(game, tile); // Refresh
        };

        window._attemptCriminalCapture = (idx) => {
            const bounty = game.player.activeBounties[idx];
            if (!bounty || bounty.type !== 'criminal_hunt') return;
            if (typeof BountyHunting === 'undefined') return;

            if (bounty.status === 'captured_pending_decision') {
                ActionMenu._showCapturedBountyDecision(game, bounty, () => ActionMenu.showBountyBoardMenu(game, tile));
                return;
            }

            if (!(game.player.q === bounty.targetQ && game.player.r === bounty.targetR)) {
                game.ui.showNotification('Not Here', `${bounty.targetName} is no longer at this location.`, 'error');
                return;
            }

            const capture = BountyHunting.attemptCapture(game.player, bounty, game.world);
            if (!capture.success) {
                game.ui.showNotification('Escape!', capture.reason || 'The target escaped.', 'error');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showBountyBoardMenu(game, tile);
                return;
            }

            game.ui.showNotification('Target Captured!', `${bounty.targetName} is in your custody. Decide their fate.`, 'success');
            ActionMenu._showCapturedBountyDecision(game, bounty, () => ActionMenu.showBountyBoardMenu(game, tile));
        };

        window._resolveCapturedBounty = (idx, choice) => {
            const bounty = game.player.activeBounties[idx];
            if (!bounty || bounty.type !== 'criminal_hunt' || typeof BountyHunting === 'undefined') return;

            const resolution = BountyHunting.resolveCapturedTarget(game.player, bounty, choice);
            if (!resolution.success) {
                game.ui.showNotification('Unable', resolution.reason || 'Could not resolve bounty.', 'error');
                return;
            }

            if (resolution.turnedIn) {
                if (game.player.financeToday) {
                    game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + (resolution.pay || 0);
                }
                game.ui.showNotification('Bounty Turned In', `${bounty.targetName} delivered to authorities for ${resolution.pay}g.`, 'success');
            } else if (resolution.recruited) {
                game.ui.showNotification('Target Recruited', `${bounty.targetName} has joined your ranks.`, 'success');
            }

            game.ui.updateStats(game.player, game.world);
            ActionMenu.showBountyBoardMenu(game, tile);
        };

        window._completeBounty = (idx) => {
            const bounty = game.player.activeBounties[idx];
            if (!bounty) return;

            game.player.gold += bounty.actualPay;
            game.player.renown += 3;
            if (!game.player.bountiesCompleted) game.player.bountiesCompleted = 0;
            game.player.bountiesCompleted++;

            if (game.player.financeToday) {
                game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + bounty.actualPay;
            }

            game.player.activeBounties.splice(idx, 1);
            game.ui.showNotification('Bounty Complete!', `${bounty.name} — earned ${bounty.actualPay} gold!`, 'success');
            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
        };
    },

    doCaptureCriminal(game, tile) {
        if (typeof BountyHunting === 'undefined') {
            game.ui.showNotification('Unavailable', 'Bounty hunting system is unavailable.', 'error');
            return;
        }

        BountyHunting.initialize(game.player);

        const pending = (game.player.activeBounties || []).find(b => b.type === 'criminal_hunt' && b.status === 'captured_pending_decision');
        if (pending) {
            ActionMenu._showCapturedBountyDecision(game, pending);
            return;
        }

        const target = BountyHunting.getBountyTargetAtPlayer(game.player);
        if (!target) {
            game.ui.showNotification('No Target', 'No active criminal target is at your current location.', 'error');
            return;
        }

        const capture = BountyHunting.attemptCapture(game.player, target, game.world);
        if (!capture.success) {
            game.ui.showNotification('Escape!', capture.reason || 'The target escaped.', 'error');
            game.ui.updateStats(game.player, game.world);
            return;
        }

        game.ui.showNotification('Target Captured!', `${target.targetName} is now in your custody.`, 'success');
        ActionMenu._showCapturedBountyDecision(game, target);
    },

    _showCapturedBountyDecision(game, bounty, onDone = null) {
        if (!bounty || bounty.status !== 'captured_pending_decision') {
            game.ui.showNotification('Unavailable', 'No captured criminal awaits judgment.', 'error');
            return;
        }

        const html = `
            <div style="max-width: 520px;">
                <h3 style="margin-top: 0; color: #f5c542;">${bounty.icon || '⛓️'} Captured: ${bounty.targetName}</h3>
                <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Crime: ${bounty.crime || 'Unknown offenses'}</div>
                <div style="font-size: 12px; color: #b9b9d6; margin-bottom: 12px;">${bounty.targetBackstory || ''}</div>

                <div style="padding: 10px; background: rgba(46, 204, 113, 0.08); border: 1px solid rgba(46, 204, 113, 0.35); border-radius: 6px; margin-bottom: 10px;">
                    <strong>Turn In</strong>
                    <div style="font-size: 12px; color: #bfc9d4; margin-top: 4px;">Receive ${bounty.actualPay}g and renown for delivering the criminal.</div>
                </div>

                <div style="padding: 10px; background: rgba(155, 89, 182, 0.1); border: 1px solid rgba(155, 89, 182, 0.35); border-radius: 6px; margin-bottom: 12px;">
                    <strong>Recruit</strong>
                    <div style="font-size: 12px; color: #d7c8e4; margin-top: 4px;">Gain a unique recruit (${bounty.recruitedUnit?.strength || '?'} strength) but take a minor karma penalty.</div>
                </div>

                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button onclick="window._resolveCapturedTarget('turn_in')" style="padding: 8px 14px; border: none; border-radius: 5px; background: #2ecc71; font-weight: bold; cursor: pointer;">Turn In</button>
                    <button onclick="window._resolveCapturedTarget('recruit')" style="padding: 8px 14px; border: none; border-radius: 5px; background: #9b59b6; color:#fff; font-weight: bold; cursor: pointer;">Recruit</button>
                </div>
            </div>
        `;

        game.ui.showCustomPanel('Captured Criminal', html);

        window._resolveCapturedTarget = (choice) => {
            const resolution = BountyHunting.resolveCapturedTarget(game.player, bounty, choice);
            if (!resolution.success) {
                game.ui.showNotification('Unable', resolution.reason || 'Could not resolve bounty.', 'error');
                return;
            }

            if (resolution.turnedIn) {
                if (game.player.financeToday) {
                    game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + (resolution.pay || 0);
                }
                game.ui.showNotification('Bounty Turned In', `${bounty.targetName} delivered for ${resolution.pay} gold.`, 'success');
            } else if (resolution.recruited) {
                game.ui.showNotification('Recruit Joined', `${bounty.targetName} joins your army as a hardened outlaw.`, 'success');
            }

            game.ui.updateStats(game.player, game.world);
            game.ui.hideCustomPanel();
            if (typeof onDone === 'function') onDone();
        };
    },
});
