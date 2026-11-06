// ActionMenu — jobs methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { panelClosed } from './uiKit.js';
import { InnerMap, PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerInventory, Seasons, SeasonalWork, OutlawLairs } from './_imports.js';
import { MinigameHost, startForge } from '../minigames/index.js';
import { Ailments } from '../../systems/ailments.js';
import { Foraging, Hunting } from '../../player/foraging.js';
import { CombatSkills } from '../../systems/combatSkills.js';
import { OddJobs } from '../../player/oddJobs.js';
import { InnerMapTasks } from '../innerMapTasks.js';
import { MapTasks } from '../../systems/mapTasks.js';
import { startTrapping, startIceFishing } from './winterScenes.js';
import { WildTaskRunner } from '../mapTasks/wildTasks.js';
import { WildTasks as WildRules } from '../../systems/wildTasks.js';

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
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' || settlement.type === 'city' ? 'town' : 'village');

        // Get job list from data (or fallback)
        const jobData = ActionMenu._getJobData();
        const allJobs = jobData[tier] || jobData['village'];

        // Pick 3 random jobs for today, after the season's own work
        // (harvest hands in autumn, sowing in spring — data/earlyJobs.json)
        const oddJobs = (DataLoader && DataLoader.earlyJobs && DataLoader.earlyJobs.oddJobs) || null;
        const seasonalJobs = SeasonalWork.jobsFor(tier, game.world.day, oddJobs);
        const shuffled = [...allJobs].sort(() => Math.random() - 0.5);
        const todayJobs = [...seasonalJobs, ...shuffled.slice(0, 3)];

        const diffColors = { 2: '#2ecc71', 3: '#2ecc71', 4: '#f39c12', 5: '#e67e22', 6: '#e74c3c', 7: '#e74c3c' };

        let html = '<div>';
        html += '<h4 style="margin-top: 0;">🔨 Available Work</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Day labor available in ${settlement.name}. Complete the work task to earn your pay.</p>`;

        for (let i = 0; i < todayJobs.length; i++) {
            const job = todayJobs[i];
            const statVal = ActionMenu._getPlayerStat(game.player, job.stat);
            const payMult = Math.round(OddJobs.wageFactor(settlement, job.sector) * OddJobs.seasonFactor(game.world, settlement, job) * 100) / 100;
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
                        <div style="font-weight: 600; font-size: 13px;">${job.name}${job.seasonal ? ` <span style="font-size:10px; color:#2ecc71; font-weight:400;">${Seasons.ICONS[Seasons.seasonOf(game.world.day)] || ''} seasonal</span>` : ''}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${job.description}</div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${statLabel}: ${statVal} · Pay: ${Math.floor(job.pay.min * payMult)}-${Math.floor(job.pay.max * payMult)}g${payMult !== 1 ? ` (local wages ×${payMult})` : ''}</div>
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
            // The work is done in person on the street map (ui/innerMapTasks.js)
            ActionMenu._startLaborTask(game, tile, job);
        };
        window._startLaborMinigame = (idx) => {
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

    /** Do a day's labour as a task on the street map; its score is the pay. */
    _startLaborTask(game, tile, job) {
        const plan = MapTasks.jobPlan(job);
        InnerMapTasks.ensureStreet(game, () => {
            const ok = InnerMapTasks.start(game, {
                title: job.name,
                icon: job.icon,
                say: plan.say || job.description,
                plan,
                stat: ActionMenu._getPlayerStat(game.player, job.stat),
                onComplete: (score) => ActionMenu._laborReward(game, tile, job, score),
                onAbandon: (info) => {
                    // Walking off the job: paid for what was done, at half rate
                    const part = info.total ? Math.round(40 * info.done / info.total) : 0;
                    if (info.done > 0) ActionMenu._laborReward(game, tile, job, part);
                    else game.ui.showNotification('🔨 Walked off the job', `You gave up on the ${job.name.toLowerCase()} work. No pay.`, 'warning');
                },
            });
            if (!ok) ActionMenu._laborReward(game, tile, job, 40);
        });
    },

    /**
     * Common reward handler for all day labor minigames.
     * scorePercent: 0-100 how well the player performed the job
     */
    _laborReward(game, tile, job, scorePercent) {
        const player = game.player;
        // Pay by the town's going wage and the season, training, the town's
        // own gain where it is short of hands (player/oddJobs.js)
        const res = OddJobs.complete(player, game.world, tile.settlement, job, scorePercent);
        const actualPay = res.pay;

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
        const f = res.factors;
        const notes = [];
        if (f.wage !== 1) notes.push(`${f.wage > 1 ? 'hands are scarce' : 'hands are plentiful'} here (wages ×${f.wage})`);
        if (f.season !== 1) notes.push(`${f.season > 1 ? 'a bumper harvest' : 'a thin harvest'} (×${f.season})`);
        if (notes.length) html += `<div style="font-size: 11px; color: var(--text-secondary);">${notes.join(' · ')}</div>`;
        for (const g of res.gains) {
            const name = g.id.charAt(0).toUpperCase() + g.id.slice(1);
            html += `<div style="font-size: 12px; color: #2ecc71;">${name} +${g.by}</div>`;
        }
        if (res.contribution) html += `<div style="font-size: 11px; color: #7db4ff;">The town was short of hands: your work brought ${res.contribution.qty} ${res.contribution.good} to its market.</div>`;

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
        const symbols = ['📜', '📕', '🔑', '💎', '⚗️', '🦅', '📐', '🧪'];
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
            if (panelClosed()) { locked = true; clearInterval(intervalId); return; }

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

    // ── Seasonal work (player/seasonalWork.js) ──

    /**
     * Winter: run the traps for a day or lay a trap line; on a line already
     * set, empty / re-bait / take it up (ui/actionMenu/winterScenes.js).
     */
    doTrapFurs(game, tile) {
        if (!SeasonalWork.canTrapFurs(tile, game.world)) {
            game.ui.showNotification('🦊 Trapping', 'Trapping needs cold winter ground in the wilds.', 'default');
            return;
        }
        ActionMenu.showScene(game, 'trap_furs', startTrapping(game, tile));
    },

    /** Winter: fish through the ice — near the shore, or out where it is thin. */
    doIceFish(game, tile) {
        if (!SeasonalWork.canIceFish(tile, game.world)) {
            game.ui.showNotification('🧊 Ice Fishing', 'Ice fishing needs a frozen river or lake in winter.', 'default');
            return;
        }
        ActionMenu.showScene(game, 'ice_fishing', startIceFishing(game, tile));
    },

    /** Spring: sow a settlement's fields for a share of the harvest. Takes the day. */
    doPlantingContract(game, tile) {
        const res = SeasonalWork.signPlantingContract(game.player, tile.settlement, game.world);
        if (!res.success) {
            game.ui.showNotification('🌱 Planting', res.reason, 'default');
            return;
        }
        if (game.player.financeToday) {
            game.player.financeToday.income.jobs = (game.player.financeToday.income.jobs || 0) + res.advance;
        }
        game.ui.showNotification('🌱 Planting Contract', res.message, 'success');
        game.ui.updateStats(game.player, game.world);
        game.endDay();
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
        const quick = () => _forageQuick(game, tile, player, forageData);
        if (!WildTaskRunner.inWorld(game)) { quick(); return; }

        WildTaskRunner.choose(game, {
            title: '🌿 Foraging',
            icon: '🌿',
            description: 'Search the area for useful plants and materials.',
            baseText: '1 foraged find (its usual bundle)',
            onQuick: quick,
            onGo: () => { ActionMenu._doForageMinigame(game, tile, player, lootTable, intStat, luckStat); }
        });
    },

    /**
     * Forage in person on the inner map (ui/mapTasks/wildTasks.js): walk to
     * the patches player/foraging.js rolled, search near cover for the rest.
     * The finds go into the packs through Foraging.finishTrip as before.
     */
    _doForageMinigame(game, tile, player, lootTable) {
        WildTaskRunner.forage(game, { player, table: lootTable }, (found) => {
            if (found === null) { _forageQuick(game, tile, player, ActionMenu._getForageData()); return; }
            const trip = Foraging.finishTrip(player, found);
            _forageResult(game, found, trip);
            game.ui.updateStats(player, game.world);
        });
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
        const quick = () => _huntQuick(game, player, lootTable);
        if (!WildTaskRunner.inWorld(game)) { quick(); return; }

        WildTaskRunner.choose(game, {
            title: '🏹 Hunting',
            icon: '🏹',
            description: 'Track and hunt wild game in this area.',
            baseText: '1 quarry (its usual yield)',
            onQuick: quick,
            onGo: () => {
                // Pick a prey animal from the loot table (luck favours the rare beasts)
                const prey = Hunting.pickPrey(lootTable, player) || lootTable[0];
                const preyName = prey.name || 'Animal';
                const preyIcon = prey.icon || '🦌';
                ActionMenu._doHuntMinigame(game, tile, player, combatSkill, strStat, luckStat, lootTable, prey, preyName, preyIcon);
            }
        });
    },

    /**
     * Hunt in person on the inner map (ui/mapTasks/wildTasks.js): follow the
     * sign, creep up on the beast and loose. The shot's accuracy meets
     * Hunting.hitThreshold exactly as the old strike did.
     */
    _doHuntMinigame(game, tile, player, combatSkill, strStat, luckStat, lootTable, prey, preyName, preyIcon) {
        const category = (ActionMenu._getForageData().terrain_mapping || {})[tile.terrain.id] || tile.terrain.id;
        WildTaskRunner.hunt(game, { player, prey }, (out) => {
            if (out === null) { _huntQuick(game, player, lootTable); return; }
            const kind = _huntOutcome(game, player, lootTable, out, { preyName: WildTaskRunner.beastName(prey), preyIcon, category });
            _huntAnimalAfter(game, out, kind);
        });
    },

    /**
     * Hunt a deer you can see (the inner map's context menu, ui/innerMapAnimals.js):
     * no trail to follow — creep up on that very animal and loose, judged by
     * the same rules (Hunting.hitThreshold); a kill lies where it fell, to be
     * butchered by hand for its own loot (data/animals.json species.loot, the
     * hunting table's entries), and leaves its herd one the less
     * (InnerMap.killAnimal → world.wildlife).
     */
    huntAnimal(game, animal) {
        const player = game.player;
        if (!player || !animal) return;
        const sp = InnerMap.animalSpecies(animal.species) || {};
        const tables = ActionMenu._getHuntData().loot_table || {};
        const lootTable = WildRules.animalLoot(sp, tables);
        if (!lootTable.length) {
            game.ui.showNotification('🏹 Hunting', `There is nothing to take from a ${String(sp.name || 'beast').toLowerCase()}.`, 'default');
            return;
        }
        const worldTile = game.world && game.world.getTile ? game.world.getTile(player.q, player.r) : null;
        const tid = worldTile && worldTile.terrain ? worldTile.terrain.id : 'woods';
        const category = (ActionMenu._getForageData().terrain_mapping || {})[tid] || 'woods';
        const prey = { name: sp.name || 'Deer', icon: sp.icon || '🦌' };
        WildTaskRunner.hunt(game, { player, prey, animal }, (out) => {
            if (out === null) {
                game.ui.showNotification('🏹 Hunting', 'You cannot go after it just now.', 'default');
                return;
            }
            const kind = _huntOutcome(game, player, lootTable, out, { preyName: WildTaskRunner.animalName(animal), preyIcon: prey.icon, category });
            _huntAnimalAfter(game, out, kind);
        });
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
        if (typeof BountyHunting !== 'undefined') {
            const rank = BountyHunting.getRankInfo(game.player);
            const payPct = Math.round(rank.payBonus * 100);
            const perks = (rank.captureBonus > 0 ? ` · +${rank.captureBonus} capture` : '') +
                (payPct !== 0 ? ` · ${payPct > 0 ? '+' : ''}${payPct}% pay` : '') +
                (rank.botchPenalty > 0 ? ` <span style="color:#e67e22;">(botched arrests: −${Math.round(rank.botchPenalty * 100)}%)</span>` : '');
            html += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">${rank.icon} ${rank.title} (rank ${rank.rank})${perks}</div>`;
        }

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
                const locationHint = (b.type === 'criminal_hunt' || b.type === 'saga_beast' || b.type === 'lair_leader')
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

            if (bounty.type === 'saga_beast') {
                // A saga beast: tracked daily; defeat it in battle to claim (systems/sagas.js)
                game.player.activeBounties.push(bounty);
                game.ui.showNotification('Notice Taken', `${bounty.targetName} — last seen near (${bounty.targetQ}, ${bounty.targetR}). Bring an army.`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showBountyBoardMenu(game, tile);
                return;
            }

            if (bounty.type === 'lair_leader') {
                // An outlaw chief: the notice shows the lair; kill the chief to claim (systems/outlawLairs.js)
                game.player.activeBounties.push(bounty);
                const lair = OutlawLairs.reveal(game.player, bounty.lairId);
                game.ui.showNotification('Notice Taken', `${bounty.targetName} holds ${lair ? lair.name : 'a lair'} at (${bounty.targetQ}, ${bounty.targetR}). Storm it, or strike at the chief alone.`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showBountyBoardMenu(game, tile);
                return;
            }

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

            // For instant bounties, resolve immediately with a skill check (player/oddJobs.js)
            if (bounty.type === 'instant') {
                const res = OddJobs.resolveInstantBounty(game.player, bounty);
                if (res.success) {
                    game.ui.showNotification('Bounty Complete!', `${bounty.name} — earned ${res.pay} gold!`, 'success');
                } else {
                    game.ui.showNotification('Failed!', `${bounty.name} — you struggled and lost ${res.damage} health.`, 'error');
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
            if (resolution.promoted) {
                game.ui.showNotification(`${resolution.promoted.icon} ${resolution.promoted.title}`, `Your reputation as a hunter grows: +${resolution.promoted.captureBonus} capture power, +${Math.round(resolution.promoted.payBonus * 100)}% bounty pay.`, 'success');
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

// ── Foraging and hunting outcomes (shared by the quick path and the in-person task) ──

/** The quick forage: one find from the loot table (player/foraging.js). Takes the day. */
function _forageQuick(game, tile, player, forageData) {
    const res = Foraging.quickForage(player, tile, forageData);
    if (!res.success) {
        game.ui.showNotification('Nothing Found', res.reason, 'default');
        return;
    }
    const entry = res.entry;
    const label = `${entry.icon || '🌿'} ${entry.name || entry.item} x${res.qty}`;
    if (res.added) {
        game.ui.showNotification('🌿 Foraging', `Quick search — found ${label}.`, 'success');
    } else {
        game.ui.showNotification('🌿 Foraging', `You found ${label} but had to leave it. ${res.reason}`, 'warning');
    }
    if (res.rankUp) game.ui.showNotification('🌿 Foraging', `Your craft grows: ${res.rankUp.icon} ${res.rankUp.name}.`, 'success');
    game.ui.hideCustomPanel();
    game.ui.updateStats(player, game.world);
    game.endDay();
}

/** The haul panel after a forage: what went into the packs. Continue ends the day. */
function _forageResult(game, found, trip) {
    const c = WildRules.cfg('forage');
    const consolidate = (list) => {
        const totals = {};
        for (const f of list) {
            const key = f.entry.item;
            if (!totals[key]) totals[key] = { ...f.entry, foundQty: 0 };
            totals[key].foundQty += f.qty;
        }
        return Object.values(totals);
    };
    let html = '<div style="max-width: 440px; text-align: center;">';
    html += '<div style="font-size: 48px; margin: 8px 0;">🌿</div>';
    if (found.length > 0) {
        html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">${c.resultTitle || 'Foraging Haul'}</div>`;
        for (const item of consolidate(trip.kept)) {
            html += `<div style="padding: 6px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between;">
                <div>${item.icon} ${item.name} x${item.foundQty}</div>
                <div style="color: var(--text-secondary);">~${item.foundQty * (item.sellPrice || 0)}g</div>
            </div>`;
        }
        if (trip.lost.length) {
            html += `<div style="font-size: 11px; color: #e67e22; margin-top: 4px;">Left behind (packs full): ${consolidate(trip.lost).map(i => `${i.icon} ${i.name} x${i.foundQty}`).join(', ')}</div>`;
        }
        html += `<div style="margin-top: 8px; padding: 8px; background: rgba(245,197,66,0.1); border-radius: 4px; font-weight: bold; color: var(--gold);">Into your packs — worth ~${trip.value} gold at market</div>`;
    } else {
        html += `<div style="font-size: 16px; color: #f39c12; margin-bottom: 8px;">Slim Pickings</div>`;
        html += `<div style="color: var(--text-secondary);">${c.empty || 'You searched but found nothing of value today.'}</div>`;
    }
    if (trip.rankUp) html += `<div style="margin-top: 6px; color: #2ecc71;">Your craft grows: ${trip.rankUp.icon} ${trip.rankUp.name}</div>`;
    html += `<button data-am-act="closePanelAndEndDay"
        style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
    html += '</div>';
    game.ui.showCustomPanel('🌿 Foraging', html);
}

/** The quick hunt: one quarry (player/foraging.js → Hunting). Takes the day. */
function _huntQuick(game, player, lootTable) {
    const res = Hunting.quickHunt(player, lootTable);
    const entry = res.entry;
    const label = `${entry.icon || '🥩'} ${entry.name || entry.item} x${res.qty}`;
    if (res.added) {
        game.ui.showNotification('🏹 Hunting', `Quick hunt — took ${label}.`, 'success');
    } else {
        game.ui.showNotification('🏹 Hunting', `You took ${label} but had no room to carry it. ${res.reason}`, 'warning');
    }
    if (res.rankUp) game.ui.showNotification('🏹 Hunting', `Your craft grows: ${res.rankUp.icon} ${res.rankUp.name}.`, 'success');
    game.ui.hideCustomPanel();
    game.ui.updateStats(player, game.world);
    game.endDay();
}

/**
 * After a hunt of an animal on the map: a kill falls where it stood and lies
 * there, unbutchered — the player butchers it by hand, or carries it off
 * (ui/innerMapAnimals.js) — and is gone from its herd; one that lived goes
 * back to its own life — running, if it was put up, or turning on the hunter
 * if it is the kind (a missed bear, a wolf pack).
 */
function _huntAnimalAfter(game, out, kind) {
    const a = out && out.animal;
    if (!a) return;
    if (kind === 'success') { InnerMap.killAnimal(game.world, a); return; }
    const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
    const provoked = out.result === 'shot' ? 'shot' : out.result === 'fled' ? 'near' : null;
    InnerMap.releaseAnimal(a, out.result === 'abandoned' ? null : me, { provoked });
}

/**
 * The bow in your hands (systems/combatSkills.js Archery): your aim added to
 * the shot; a near miss within your Steady still strikes; a miss may be
 * followed by a second arrow (the gap half closed). Archery XP for the shot,
 * more if it struck; a level-up announced. → { accuracy, secondArrow }
 */
function _archeryShot(game, player, accuracy) {
    if (!CombatSkills.has('archery')) return { accuracy };
    const need = Hunting.hitThreshold(player);
    let acc = Math.min(100, Number(accuracy || 0) + CombatSkills.perk(player, 'archery', 'aim'));
    const steady = CombatSkills.perk(player, 'archery', 'steady');
    if (acc < need && steady > 0 && acc >= need - steady) acc = need;
    let second = false;
    if (acc < need) {
        const ch = CombatSkills.chance(player, 'archery', 'secondArrow');
        if (ch > 0 && Utils.random() < ch) {
            second = true;
            acc = Math.round(acc + (need - acc) / 2 + Utils.random() * 25);
        }
    }
    const hit = acc >= need;
    const xp = CombatSkills.xpFor('archery', 'shot', second ? 2 : 1) + (hit ? CombatSkills.xpFor('archery', 'hit') : 0);
    const ev = CombatSkills.train(player, 'archery', xp);
    const ui = game && game.ui;
    if (ui && typeof ui.showNotification === 'function') {
        if (second) ui.showNotification('🏹 Second Arrow', hit ? 'The first went wide; you nock again and the second flies true.' : 'You nock and loose again, but the second goes wide too.', hit ? 'success' : 'info');
        if (ev) ui.showNotification(`${ev.icon} ${ev.name} Improved`, ev.text, 'success');
    }
    return { accuracy: acc, secondArrow: second };
}

/**
 * How a hunt ended. out: { result: 'shot', accuracy, animal? } | { result: 'fled' |
 * 'abandoned' }. A shot is judged against Hunting.hitThreshold as before. A
 * hit on a beast on the map leaves its carcass to butcher by hand (no loot
 * now, and the day goes on); a hit on a quarry with no body on the map banks
 * Hunting.strikeLoot. A wild miss may injure. Continue ends the day.
 */
function _huntOutcome(game, player, lootTable, out, p) {
    let kind = 'fled';
    let statusMsg = '';
    let totalLoot = [];
    let totalValue = 0;
    if (out && out.result === 'shot') out = { ...out, ..._archeryShot(game, player, out.accuracy) };
    if (out.result === 'shot' && out.animal && out.accuracy >= Hunting.hitThreshold(player)) {
        // The beast falls where it stood: butcher it, or carry it off (ui/innerMapAnimals.js)
        if (player.skills && Utils.random() < 0.25) player.skills.combat = Math.min(10, (player.skills.combat || 1) + 0.1);
        const words = (InnerMap.animalConfig ? InnerMap.animalConfig().words : null) || {};
        const line = String(words.huntKill || 'The {name} is down. Butcher it where it lies, or carry it off.').replace('{name}', p.preyName);
        if (game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(`${p.preyIcon || '🏹'} A Clean Kill`, line, 'success');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return 'success';
    }
    if (out.result === 'shot') {
        const accuracy = out.accuracy;
        if (accuracy >= Hunting.hitThreshold(player)) {
            const trip = Hunting.finishTrip(player, Hunting.strikeLoot(lootTable, player));
            totalLoot = trip.kept.map(f => ({ ...f.entry, foundQty: f.qty }));
            totalValue = trip.value;
            if (trip.lost.length) statusMsg += ` No room for ${trip.lost.map(f => `${f.entry.name} x${f.qty}`).join(', ')} — left behind.`;
            if (trip.rankUp) statusMsg += ` Your craft grows: ${trip.rankUp.icon} ${trip.rankUp.name}.`;
            if (player.skills && Utils.random() < 0.25) {
                player.skills.combat = Math.min(10, (player.skills.combat || 1) + 0.1);
                statusMsg += ' Combat skill improved!';
            }
            kind = 'success';
        } else if (accuracy < 15 && Utils.random() < 0.2) {
            const dmg = Math.floor(Utils.random() * 12) + 5;
            player.health = Math.max(1, player.health - dmg);
            kind = 'injured';
            statusMsg = `Your arrow ricocheted! -${dmg} HP`;
            const wound = Ailments.maybeWound(player, game.world, 'hunt');
            if (wound) statusMsg += ` ${wound.icon} ${wound.name}.`;
            Hunting.finishTrip(player, []); // a hard lesson is still experience
        } else {
            kind = 'missed';
            statusMsg = `Your arrow flew wide. The ${p.preyName} fled.`;
            Hunting.finishTrip(player, []);
        }
    } else if (out.result === 'abandoned') {
        statusMsg = 'You gave up the hunt and headed back.';
    } else {
        statusMsg = `The ${p.preyName} got wind of you and bolted into the ${p.category}!`;
    }

    let html = '<div style="max-width: 500px; text-align: center;">';
    if (kind === 'success') {
        html += `<div style="font-size: 48px; margin: 12px 0;">${p.preyIcon}</div>`;
        html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Successful Hunt!</div>`;
        for (const item of totalLoot) {
            html += `<div style="padding: 6px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                <div>${item.icon} ${item.name} x${item.foundQty}</div>
                <div style="color: var(--text-secondary);">~${item.foundQty * (item.sellPrice || 0)}g</div>
            </div>`;
        }
        html += `<div style="margin-top: 8px; padding: 8px; background: rgba(245,197,66,0.1); border-radius: 4px; font-weight: bold; color: var(--gold);">Into your packs — worth ~${totalValue} gold at market</div>`;
        if (statusMsg) html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 6px;">${statusMsg}</div>`;
    } else {
        const head = { fled: [`💨`, '#f39c12', `The ${p.preyName} escaped!`], injured: ['🤕', '#e74c3c', 'Hunting Mishap!'], missed: ['🏹', 'var(--text-secondary)', 'Missed!'] }[kind];
        html += `<div style="font-size: 48px; margin: 12px 0;">${head[0]}</div>`;
        html += `<div style="font-size: 16px; color: ${head[1]}; font-weight: bold; margin-bottom: 8px;">${head[2]}</div>`;
        html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
    }
    html += `<button data-am-act="closePanelAndEndDay"
        style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
    html += '</div>';
    game.ui.showCustomPanel('🏹 Hunting', html);
    game.ui.updateStats(player, game.world);
    return kind;
}
