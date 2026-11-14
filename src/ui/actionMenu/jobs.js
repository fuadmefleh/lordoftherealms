// ActionMenu — jobs methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { panelClosed, lede, chips, sectionHead, actRow, rowList, price, BTN_GOLD, BTN_PLAIN } from './uiKit.js';
import { InnerMap, PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerInventory, Seasons, SeasonalWork, OutlawLairs } from './_imports.js';
import { MinigameHost, startForge } from '../minigames/index.js';
import { Ailments } from '../../systems/ailments.js';
import { Wanted } from '../../systems/wanted.js';
import { Foraging, Hunting } from '../../player/foraging.js';
import { HuntingBow } from '../../player/huntingBow.js';
import { OddJobs } from '../../player/oddJobs.js';
import { PracticeSkills } from '../../systems/practiceSkills.js';
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

        const diffColors = { 2: '#8fd18a', 3: '#8fd18a', 4: '#f0b35a', 5: '#f0b35a', 6: '#e0846a', 7: '#e0846a' };

        // The action menu's voice (ui/actionMenu/uiKit.js): one row a job, the
        // pay and difficulty at the right
        let html = sectionHead('🔨 Available Work');
        html += lede(`Day labor available in ${settlement.name}. Complete the work task to earn your pay.`);

        const jobRows = todayJobs.map((job, i) => {
            const statVal = ActionMenu._getPlayerStat(game.player, job.stat);
            const payMult = Math.round(OddJobs.wageFactor(settlement, job.sector) * OddJobs.seasonFactor(game.world, settlement, job) * 100) / 100;
            const statLabel = job.stat.charAt(0).toUpperCase() + job.stat.slice(1);
            const dColor = diffColors[job.difficulty] || '#f0b35a';
            return {
                icon: job.icon,
                name: `${job.name}${job.seasonal ? ` <span style="font-size:10px; color:#8fd18a; font-weight:400;">${Seasons.ICONS[Seasons.seasonOf(game.world.day)] || ''} seasonal</span>` : ''}`,
                desc: job.description,
                note: `<span style="color:#9d937c;">${statLabel}: ${statVal} · Pay: ${Math.floor(job.pay.min * payMult)}-${Math.floor(job.pay.max * payMult)}g${payMult !== 1 ? ` (local wages ×${payMult})` : ''}</span>`,
                attrs: `onclick="window._startLabor(${i})"`,
                side: `<div style="color:#ffcf6a; font-weight:600;">▶ Work</div><div style="font-size:10px; color:${dColor}; margin-top:2px;">Diff: ${job.difficulty}/7</div>`,
            };
        });
        html += rowList(jobRows);

        html += `<button onclick="window._oddJobsCancel()" style="${BTN_PLAIN}">Cancel</button>`;
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
        html += `<div style="font-size: 44px; margin: 10px 0 6px;">${job.icon}</div>`;
        html += `<div style="font-family: var(--font-display); font-size: 18px; color: ${ratingColor}; font-weight: bold; margin-bottom: 4px;">${rating}</div>`;
        html += `<div class="pk-head" style="text-align:center; margin-top:0;">${job.name}</div>`;
        html += `<div style="margin-bottom: 10px; font-size: 20px; letter-spacing: 4px;">${starsHtml}</div>`;
        html += `<div style="display:flex; justify-content:center;">${chips([
            { icon: '💰', label: 'Earned', value: `+${actualPay} gold`, cls: 'gold' },
            scorePercent >= 40 ? { icon: '⭐', label: '', value: '<span style="color:#ce93d8;">+1 Renown</span>' } : null,
        ])}</div>`;
        const f = res.factors;
        const notes = [];
        if (f.wage !== 1) notes.push(`${f.wage > 1 ? 'hands are scarce' : 'hands are plentiful'} here (wages ×${f.wage})`);
        if (f.season !== 1) notes.push(`${f.season > 1 ? 'a bumper harvest' : 'a thin harvest'} (×${f.season})`);
        if (notes.length) html += `<div style="font-size: 11px; color: #9d937c;">${notes.join(' · ')}</div>`;
        for (const g of res.gains) {
            if (g.kind === 'practice') {
                // a practised skill: XP, and a level-up announced (systems/practiceSkills.js)
                const d = PracticeSkills.def(g.id) || {};
                html += `<div style="font-size: 12px; color: #8fd18a;">${d.icon || ''} ${d.name || g.id} +${g.by} xp</div>`;
                if (g.event) {
                    html += `<div style="font-size: 12px; color: #ffcf6a;">${g.event.text}</div>`;
                    game.ui.showNotification(`${g.event.icon} ${g.event.name} Improved`, g.event.text, 'success');
                }
                continue;
            }
            const name = g.id.charAt(0).toUpperCase() + g.id.slice(1);
            html += `<div style="font-size: 12px; color: #8fd18a;">${name} +${g.by}</div>`;
        }
        if (res.contribution) html += `<div style="font-size: 11px; color: #7db4ff;">The town was short of hands: your work brought ${res.contribution.qty} ${res.contribution.good} to its market.</div>`;

        html += `<button onclick="window._laborContinue()"
            style="${BTN_GOLD} margin: 12px 0 0; padding: 9px 32px; font-family: var(--font-display); font-size: 14px; letter-spacing: 1px;">
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
            html += `<div class="pk-head" style="text-align:center;">${job.icon} ${job.name}</div>`;
            html += `<p style="font-size: 12px; color: #cbbf9f; margin: 0 0 4px;">Memorize the sequence, then repeat it in order!</p>`;
            html += `<p style="font-size: 11px; color: #9d937c; margin: 0;">Round ${round + 1}/${maxRounds} · Sequence length: ${sequence.length}</p>`;

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
                    style="width: 64px; height: 64px; border-radius: 10px; border: 1px solid ${lit ? 'rgba(245,197,66,0.8)' : 'rgba(245,197,66,0.14)'};
                           background: ${lit ? 'rgba(245,197,66,0.2)' : 'rgba(255,255,255,0.03)'}; cursor: ${disabled ? 'default' : 'pointer'};
                           font-size: 24px; opacity: ${disabled && !lit ? 0.4 : 1}; transition: all 0.15s;
                           box-shadow: ${lit ? '0 0 15px rgba(245,197,66,0.3)' : 'none'}; margin: 0 auto;"
                    ${disabled ? 'disabled' : ''}
                    onmouseenter="if(!this.disabled)this.style.background='rgba(245,197,66,0.08)'"
                    onmouseleave="if(!this.disabled)this.style.background='rgba(255,255,255,0.03)'">${symbols[i]}</button>`;
            }
            html += '</div>';

            // Progress dots
            if (!showingSeq && !gameOver && sequence.length > 0) {
                html += '<div style="display: flex; justify-content: center; gap: 6px; margin-top: 6px;">';
                for (let i = 0; i < sequence.length; i++) {
                    const done = i < playerInput.length;
                    html += `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${done ? '#8fd18a' : 'rgba(255,255,255,0.12)'}; border: 1px solid ${done ? '#8fd18a' : 'rgba(245,197,66,0.2)'};"></div>`;
                }
                html += '</div>';
            }

            html += '</div>';
            return html;
        };

        const playSequence = () => {
            showingSeq = true;
            game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #ffcf6a;">👀 Watch the sequence...</span>'));

            let idx = 0;
            const playNext = () => {
                if (idx >= sequence.length) {
                    showingSeq = false;
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #8fd18a;">🖊️ Your turn! Repeat the sequence.</span>'));
                    return;
                }
                game.ui.showCustomPanel(`📋 ${job.name}`, render(sequence[idx], '<span style="color: #ffcf6a;">👀 Watch...</span>'));
                idx++;
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #ffcf6a;">👀 Watch...</span>'));
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

            game.ui.showCustomPanel(`📋 ${job.name}`, render(symbolIdx, '<span style="color: #9d937c;">...</span>'));

            if (playerInput[pos] !== sequence[pos]) {
                gameOver = true;
                const pct = Math.round((round / maxRounds) * 100);
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #e0846a;">❌ Wrong! You made an error.</span>'));
                    setTimeout(() => ActionMenu._laborReward(game, tile, job, Math.min(100, pct)), 1400);
                }, 350);
                return;
            }

            if (playerInput.length === sequence.length) {
                round++;
                if (round >= maxRounds) {
                    gameOver = true;
                    setTimeout(() => {
                        game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #8fd18a;">✨ Flawless! Every detail perfect!</span>'));
                        setTimeout(() => ActionMenu._laborReward(game, tile, job, 100), 1400);
                    }, 350);
                    return;
                }
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #8fd18a;">✅ Correct! Getting harder...</span>'));
                    setTimeout(() => startRound(), 1100);
                }, 350);
            } else {
                setTimeout(() => {
                    game.ui.showCustomPanel(`📋 ${job.name}`, render(-1, '<span style="color: #8fd18a;">Keep going...</span>'));
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
            html += `<div class="pk-head" style="text-align:center;">${job.icon} ${job.name}</div>`;
            html += `<p style="font-size: 12px; color: #cbbf9f; margin: 0 0 4px;">React to attacks! Click the correct defense!</p>`;
            html += `<p style="font-size: 11px; color: #9d937c; margin: 0;">Round ${round + 1}/${totalRounds} · Score: ${score}/${round}</p>`;

            // Timer bar
            html += `<div style="margin: 10px 0;">
                <div style="background: rgba(0,0,0,0.3); border-radius: 6px; height: 8px; overflow: hidden; border: 1px solid rgba(245,197,66,0.14);">
                    <div id="laborTimer" style="width: 100%; height: 100%; background: #8fd18a; transition: width ${timeLimit}ms linear; border-radius: 5px;"></div>
                </div>
            </div>`;

            // Attack display
            html += `<div class="pk-card pk-tone-bad" style="padding: 14px; margin: 12px 0; border-color: rgba(224,132,106,0.45);">
                <div style="font-size: 40px; margin-bottom: 6px;">${currentThreat.icon}</div>
                <div style="font-size: 15px; color: #e0846a; font-weight: bold;">${currentThreat.attack}</div>
            </div>`;

            // Defense buttons (2x2 grid)
            html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0;">';
            for (const t of threats) {
                const isCorrect = t.dir === currentThreat.dir;
                html += `<button onclick="window._laborBlock('${t.dir}')"
                    style="${BTN_PLAIN} margin: 0; padding: 11px; font-size: 13px; transition: all 0.1s;"
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
            const color = correct ? '#8fd18a' : '#e0846a';

            let html = '<div style="max-width: 480px; text-align: center;">';
            html += `<div style="font-size: 48px; margin: 24px 0;">${correct ? '🛡️' : '💥'}</div>`;
            html += `<div style="font-size: 20px; font-weight: bold; color: ${color}; margin-bottom: 6px;">${text}</div>`;
            html += `<div style="font-size: 13px; color: #9d937c;">Score: ${score}/${round + 1}</div>`;
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
            html += `<div class="pk-head" style="text-align:center;">${job.icon} ${job.name}</div>`;
            html += `<p style="font-size: 12px; color: #cbbf9f; margin: 0 0 4px;">Click the target before it escapes!</p>`;
            html += `<p style="font-size: 11px; color: #9d937c; margin: 0;">Caught: ${caught} · Missed: ${missed} · Remaining: ${totalTargets - spawned}</p>`;

            if (msg) {
                html += `<div style="font-size: 13px; margin: 8px 0; min-height: 20px;">${msg}</div>`;
            }

            // 3x3 grid of "holes"
            html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px auto; max-width: 300px;">';
            for (let i = 0; i < 9; i++) {
                const isActive = i === activeCell;
                html += `<button onclick="window._laborCatch(${i})"
                    style="width: 88px; height: 88px; border-radius: 12px; margin: 0 auto;
                           background: ${isActive ? 'rgba(245,197,66,0.14)' : 'rgba(255,255,255,0.03)'};
                           border: 1px solid ${isActive ? 'rgba(245,197,66,0.8)' : 'rgba(245,197,66,0.1)'};
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
                    game.ui.showCustomPanel(`🔍 ${job.name}`, render('<span style="color: #e0846a;">💨 It got away!</span>'));

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
            game.ui.showCustomPanel(`🔍 ${job.name}`, render('<span style="color: #8fd18a;">✅ Got it!</span>'));

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
            html += `<div class="pk-head" style="text-align:center;">${job.icon} ${job.name}</div>`;
            html += `<p style="font-size: 12px; color: #cbbf9f; margin: 0 0 4px;">Keep your pace in the <span style="color: #8fd18a;">green zone</span>! Use the buttons to adjust.</p>`;
            html += `<p style="font-size: 11px; color: #9d937c; margin: 0;">Progress: ${ticksDone}/${totalTicks} · In-zone: ${ticksInZone}</p>`;

            // Speed gauge (vertical-style bar rendered horizontally)
            html += `<div style="position: relative; height: 32px; background: rgba(0,0,0,0.3); border-radius: 16px; margin: 14px 0; overflow: hidden; border: 1px solid rgba(245,197,66,0.14);">`;
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
                    style="${BTN_PLAIN} margin: 0; padding: 10px 28px; font-size: 14px; transition: all 0.1s;"
                    onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                    🐢 Slow Down
                </button>
                <button onclick="window._laborSpeedUp()"
                    style="${BTN_GOLD} margin: 0; padding: 10px 28px; font-size: 14px; transition: all 0.1s;"
                    onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">
                    🐇 Speed Up
                </button>
            </div>`;

            // Overall progress bar
            html += `<div style="margin-top: 14px;">
                <div class="pk-head" style="text-align:center; margin-top:0;">Delivery progress</div>
                <div style="background: rgba(0,0,0,0.3); border-radius: 6px; height: 10px; overflow: hidden; border: 1px solid rgba(245,197,66,0.14);">
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
                    { text: '😪 Drone on about minor bureaucratic details', mood: -8 },
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
            const moodColor = crowdMood >= 70 ? '#8fd18a' : crowdMood >= 45 ? '#f0b35a' : '#e0846a';

            let html = '<div style="max-width: 500px; text-align: center;">';
            html += `<div class="pk-head" style="text-align:center;">${job.icon} ${job.name}</div>`;
            html += `<p style="font-size: 11px; color: #9d937c; margin: 0 0 10px;">Round ${round + 1}/${scenarios.length}</p>`;

            // Crowd mood bar
            html += `<div style="margin-bottom: 12px;">
                <div style="font-size: 11px; color: #9d937c; margin-bottom: 4px;">Crowd Approval: <span style="color: ${moodColor}; font-weight: 600;">${crowdMood}%</span></div>
                <div style="background: rgba(0,0,0,0.3); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(245,197,66,0.14);">
                    <div style="width: ${crowdMood}%; height: 100%; background: ${moodColor}; transition: width 0.4s; border-radius: 5px;"></div>
                </div>
            </div>`;

            html += `<div style="font-size: 20px; margin: 8px 0; opacity: 0.5; letter-spacing: 4px;">${sc.crowd}</div>`;
            html += `<div style="font-size: 13px; color: #ece2c8; margin: 12px 0; font-style: italic;">"${sc.prompt}"</div>`;

            if (feedbackMsg) {
                html += `<div style="font-size: 13px; margin: 10px 0; min-height: 20px;">${feedbackMsg}</div>`;
            }

            if (!locked) {
                // The choices as action-menu rows; a silver tongue (charisma 7+) sees the best ones marked
                html += '<div style="text-align: left;">' + rowList(sc.options.map((opt, i) => ({
                    name: opt.text,
                    attrs: `onclick="window._laborSpeakChoice(${i})"`,
                    side: showHint && opt.mood >= 18 ? '✦' : '',
                    tone: 'good',
                }))) + '</div>';
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

            const fb = change >= 18 ? '<span style="color: #8fd18a;">🎉 The crowd cheers!</span>'
                     : change >= 10 ? '<span style="color: #7db4ff;">👏 Nods of approval.</span>'
                     : change >= 0 ? '<span style="color: #f0b35a;">😐 A tepid response...</span>'
                     : '<span style="color: #e0846a;">😒 Groans from the crowd...</span>';

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
            game.ui.showNotification('❄️ Ice Fishing', 'Ice fishing needs a frozen river or lake in winter.', 'default');
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
        // Game is shot at range: no bow or no arrows, no hunt (snares and traps need neither)
        if (!_huntGearOk(game, player)) return;
        const combatSkill = player.skills?.combat || 1;
        const strStat = player.strength || 5;
        const luckStat = player.luck || 5;
        const lootTable = huntData.loot_table[category];
        const quick = () => _huntQuick(game, player, lootTable);
        if (!WildTaskRunner.inWorld(game)) { quick(); return; }

        WildTaskRunner.choose(game, {
            title: '🏹 Hunting',
            icon: '🏹',
            description: `Track and hunt wild game in this area. ${_gearLine(player)}`,
            baseText: 'A few arrows at a quarry: its usual yield if one strikes home',
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
     * sign, creep up on the beast and loose: each shot is judged by
     * the bow (player/huntingBow.js: every arrow loosed, hit, wound or miss).
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
     * the same bow rules (player/huntingBow.js); a kill lies where it fell, to be
     * butchered by hand for its own loot (data/animals.json species.loot, the
     * hunting table's entries), and leaves its herd one the less
     * (InnerMap.killAnimal → world.wildlife).
     */
    huntAnimal(game, animal) {
        const player = game.player;
        if (!player || !animal) return;
        if (!_huntGearOk(game, player)) return;
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

        // Show active bounties first. The action menu's voice (ui/actionMenu/uiKit.js):
        // the hunter's standing as the lede, then one row a bounty, its pay at the right
        let html = '<div style="max-height: 500px; overflow-y: auto;">';
        // Your own face on the board, if this realm wants you (systems/wanted.js)
        const poster = Wanted.posterAt(game.player, game.world, tile && tile.settlement);
        if (poster) {
            html += `<div class="pk-card pk-tone-bad" style="text-align:center;"><div style="font-family:var(--font-display); font-size:15px; letter-spacing:2px; color:#e0846a;">WANTED</div>`
                + `<div style="font-size:12px; color:#ece2c8; margin:3px 0;">by the crown of ${poster.realm}, for ${poster.charges}</div>`
                + `<div style="font-size:11px; color:#cbbf9f;">The likeness is not kind, but it is yours. Reward: <b style="color:#ffe08a;">${poster.bounty} gold</b>${poster.grave ? ', dead or alive' : ''}.</div></div>`;
        }
        if (typeof BountyHunting !== 'undefined') {
            const rank = BountyHunting.getRankInfo(game.player);
            const payPct = Math.round(rank.payBonus * 100);
            const perks = (rank.captureBonus > 0 ? ` · +${rank.captureBonus} capture` : '') +
                (payPct !== 0 ? ` · ${payPct > 0 ? '+' : ''}${payPct}% pay` : '') +
                (rank.botchPenalty > 0 ? ` <span style="color:#f0b35a;">(botched arrests: −${Math.round(rank.botchPenalty * 100)}%)</span>` : '');
            html += lede(`${rank.icon} <b style="color:#ece2c8;">${rank.title}</b> (rank ${rank.rank})${perks}`);
        }

        // Active bounties: a listing row each, its controls at the right
        if (game.player.activeBounties.length > 0) {
            const S = 'margin: 4px 0 0 4px; padding: 3px 10px; font-size: 11px;';
            const activeRows = game.player.activeBounties.map((b, i) => {
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
                    controls = `<button onclick="window._completeBounty(${i})" style="${BTN_GOLD} ${S}">✓ Complete</button>`;
                } else if (onCriminalTarget) {
                    controls = `<button onclick="window._attemptCriminalCapture(${i})" style="${BTN_GOLD} ${S}">⚔️ Capture</button>`;
                } else if (awaitingDecision) {
                    controls = `<button onclick="window._resolveCapturedBounty(${i}, 'turn_in')" style="${BTN_GOLD} ${S}">Turn In</button>`
                        + `<button onclick="window._resolveCapturedBounty(${i}, 'recruit')" style="${BTN_PLAIN} ${S}">Recruit</button>`;
                }

                return actRow({
                    icon: b.icon,
                    name: b.name,
                    desc: b.description,
                    note: [
                        locationHint ? `<span style="color:#7db4ff;">📍 ${locationHint}</span>` : '',
                        Number.isFinite(daysLeft) ? `<span style="color:${daysLeft <= 2 ? '#e0846a' : '#9d937c'};">⏳ ${daysLeft} days remaining</span>` : '',
                    ].filter(Boolean).join(' · '),
                    side: `<div>${price(b.actualPay)}</div>${controls ? `<div>${controls}</div>` : ''}`,
                });
            });
            html += rowList(activeRows, 'Active Bounties');
        }

        // Available bounties
        const maxBounties = 3;
        const offerRows = bounties.map((b, i) => {
            const alreadyAccepted = game.player.activeBounties.some(active => active.id && b.id && active.id === b.id);
            const canAccept = game.player.activeBounties.length < maxBounties && !alreadyAccepted;
            const difficultyLabel = typeof b.difficulty === 'number' ? `Lv ${b.difficulty}` : b.difficulty;
            const isHighDanger = (typeof b.difficulty === 'number' ? b.difficulty >= 7 : b.difficulty === 'medium');
            const dCol = isHighDanger ? '#f0b35a' : '#7db4ff';
            return {
                icon: b.icon,
                name: `${b.name} <span style="font-size:9.5px; letter-spacing:0.5px; padding:1px 6px; border-radius:3px; border:1px solid ${dCol}55; color:${dCol}; font-weight:600;">${difficultyLabel}</span>`,
                desc: b.description,
                note: [
                    b.targetBackstory ? `<span style="color:#b9b9d6;">📖 ${b.targetBackstory}</span>` : '',
                    // (an instant job, done on the spot, has no limit to show)
                    Number.isFinite(b.daysLimit) ? `<span style="color:#9d937c;">⏳ ${b.daysLimit} day limit</span>` : '',
                    canAccept ? '' : `<span style="color:#c98a6a;">${alreadyAccepted ? 'Already taken' : `You can only have ${maxBounties} active bounties`}</span>`,
                ].filter(Boolean).join(' · '),
                attrs: `onclick="window._acceptBounty(${i})"`,
                off: !canAccept,
                side: alreadyAccepted ? 'Taken' : price(b.actualPay),
                tone: 'gold',
            };
        });
        html += rowList(offerRows, 'Available Bounties');

        html += '</div>';
        game.ui.showCustomPanel('📋 Notice Board', html);

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
                const res = OddJobs.resolveInstantBounty(game.player, bounty, tile.settlement);
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

            // For other bounties, add to active list (the posting town pays on completion)
            if (tile && tile.settlement) { bounty.townQ = tile.q; bounty.townR = tile.r; }
            game.player.activeBounties.push(bounty);
            game.ui.showNotification('Bounty Accepted!', Number.isFinite(bounty.daysLimit) ? `${bounty.name} — ${bounty.daysLimit} days to complete.` : `${bounty.name} — see it done here.`, 'success');
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

            // The posting town pays out of its purse (as much as it holds)
            const postT = Number.isFinite(bounty.townQ) ? game.world.getTile(bounty.townQ, bounty.townR) : tile;
            const paid = OddJobs.payFromTown(game.player, postT && postT.settlement, bounty.actualPay);
            const owed = Math.max(0, Math.floor(bounty.actualPay || 0));
            bounty.actualPay = paid;
            game.player.renown += 3;
            if (!game.player.bountiesCompleted) game.player.bountiesCompleted = 0;
            game.player.bountiesCompleted++;

            if (game.player.financeToday) {
                game.player.financeToday.income.bounties = (game.player.financeToday.income.bounties || 0) + bounty.actualPay;
            }

            game.player.activeBounties.splice(idx, 1);
            game.ui.showNotification('Bounty Complete!', `${bounty.name} — earned ${paid} gold${paid < owed ? ` (the town's coffers held no more of the ${owed} posted)` : ''}!`, 'success');
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

        let html = '<div style="max-width: 520px;">';
        html += sectionHead(`${bounty.icon || '⛓️'} Captured: ${bounty.targetName}`);
        html += lede(`Crime: ${bounty.crime || 'Unknown offenses'}`);
        if (bounty.targetBackstory) html += `<div style="font-size: 12px; color: #b9b9d6; margin-bottom: 10px;">${bounty.targetBackstory}</div>`;
        html += rowList([
            {
                icon: '⚖️',
                name: 'Turn In',
                desc: `Receive ${bounty.actualPay}g and renown for delivering the criminal.`,
                attrs: `onclick="window._resolveCapturedTarget('turn_in')"`,
                side: price(bounty.actualPay),
                tone: 'gold',
            },
            {
                icon: '🗡️',
                name: 'Recruit',
                desc: `Gain a unique recruit (${bounty.recruitedUnit?.strength || '?'} strength) but take a minor karma penalty.`,
                attrs: `onclick="window._resolveCapturedTarget('recruit')"`,
                side: '<span style="color:#ce93d8;">Recruit</span>',
            },
        ], 'Decide their fate');
        html += '</div>';

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
    let html = '<div style="max-width: 440px;">';
    html += '<div style="font-size: 44px; margin: 8px 0; text-align: center;">🌿</div>';
    if (found.length > 0) {
        html += rowList(consolidate(trip.kept).map(item => ({
            icon: item.icon,
            name: `${item.name} x${item.foundQty}`,
            side: `~${item.foundQty * (item.sellPrice || 0)}g`,
        })), c.resultTitle || 'Foraging Haul');
        if (trip.lost.length) {
            html += `<div style="font-size: 11px; color: #f0b35a; margin-top: 4px;">Left behind (packs full): ${consolidate(trip.lost).map(i => `${i.icon} ${i.name} x${i.foundQty}`).join(', ')}</div>`;
        }
        html += chips([{ icon: '🎒', label: 'Into your packs — worth', value: `~${trip.value} gold at market`, cls: 'gold' }]);
    } else {
        html += `<div style="font-family: var(--font-display); font-size: 16px; color: #f0b35a; margin-bottom: 8px; text-align: center;">Slim Pickings</div>`;
        html += lede(c.empty || 'You searched but found nothing of value today.');
    }
    if (trip.rankUp) html += `<div style="margin-top: 6px; color: #8fd18a;">Your craft grows: ${trip.rankUp.icon} ${trip.rankUp.name}</div>`;
    html += `<button data-am-act="closePanelAndEndDay"
        style="${BTN_GOLD} display: block; width: 100%; margin: 12px 0 0; padding: 9px;">Continue</button>`;
    html += '</div>';
    game.ui.showCustomPanel('🌿 Foraging', html);
}

/** Can the player shoot (a bow and arrows: player/huntingBow.js)? Says plainly what is missing when not. */
function _huntGearOk(game, player) {
    const g = HuntingBow.gear(player);
    if (g.ok) return true;
    if (game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification('🏹 Hunting', g.reason, 'warning');
    return false;
}

/** "With your fine bow (82% sound) and 14 arrows." */
function _gearLine(player) {
    const w = HuntingBow.weapon(player);
    if (!w) return '';
    return `With your ${HuntingBow.weaponLabel(w)} (${HuntingBow.condition(player, w)}% sound) and ${HuntingBow.arrows(player)} arrows.`;
}

/** What the bow did on a quick hunt (broke, Archery level-ups) as notifications. */
function _bowNotes(game, r) {
    const ui = game && game.ui;
    if (!ui || typeof ui.showNotification !== 'function' || !r) return;
    for (const ev of r.levelUps || []) if (ev) ui.showNotification(`${ev.icon} ${ev.name} Improved`, ev.text, 'success');
    if (r.broke) ui.showNotification('🏹 Broken Bow', HuntingBow.say('broke', { bow: 'bow' }), 'warning');
}

/** The quick hunt: a few arrows at one quarry (player/huntingBow.js), its yield on a kill (player/foraging.js → Hunting). Takes the day. */
function _huntQuick(game, player, lootTable) {
    const prey = Hunting.pickPrey(lootTable, player) || lootTable[0];
    const shots = HuntingBow.quickShots(player, prey);
    if (!shots.ok) {
        game.ui.showNotification('🏹 Hunting', shots.reason, 'warning');
        return;
    }
    _bowNotes(game, shots);
    const arrowsLine = `${shots.shots} arrow${shots.shots === 1 ? '' : 's'} loosed${shots.recovered ? `, ${shots.recovered} recovered` : ''}.`;
    if (shots.fumble) {
        player.health = Math.max(1, (player.health || 1) - shots.fumble.damage);
        game.ui.showNotification('🤕 Hunting Mishap', `The string slipped and lashed your arm. -${shots.fumble.damage} HP`, 'warning');
    }
    if (!shots.killed) {
        Hunting.finishTrip(player, []); // a day in the field is still experience
        const name = String(prey.name || 'quarry').toLowerCase();
        game.ui.showNotification('🏹 Hunting', `${shots.wounded ? `You wounded the ${name}, but it got away.` : `The ${name} got away.`} ${arrowsLine}`, 'info');
        game.ui.hideCustomPanel();
        game.ui.updateStats(player, game.world);
        game.endDay();
        return;
    }
    const res = Hunting.quickHunt(player, lootTable, prey);
    const entry = res.entry;
    const label = `${entry.icon || '🥩'} ${entry.name || entry.item} x${res.qty}`;
    if (res.added) {
        game.ui.showNotification('🏹 Hunting', `Quick hunt — took ${label}. ${arrowsLine}`, 'success');
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
    const provoked = (out.result === 'shot' || out.result === 'missed' || out.wounded) ? 'shot' : out.result === 'fled' ? 'near' : null;
    InnerMap.releaseAnimal(a, out.result === 'abandoned' ? null : me, { provoked });
}

/**
 * How a hunt ended (the arrows were loosed on the map: player/huntingBow.js).
 * out: { result: 'shot' (the kill), animal?, shots, recovered } | { result:
 * 'missed', shots, fumble? } | { result: 'fled', wounded? } | { result:
 * 'abandoned' }. A kill of a beast on the map leaves its carcass to butcher
 * by hand (no loot now, and the day goes on); a kill of a quarry with no
 * body on the map banks Hunting.strikeLoot. A slip on a miss may injure.
 * Continue ends the day.
 */
function _huntOutcome(game, player, lootTable, out, p) {
    let kind = 'fled';
    let statusMsg = '';
    let totalLoot = [];
    let totalValue = 0;
    out = out || { result: 'fled' };
    const arrowsLine = out.shots ? ` ${out.shots} arrow${out.shots === 1 ? '' : 's'} loosed${out.recovered ? `, ${out.recovered} pulled back whole` : ''}.` : '';
    if (out.result === 'shot' && out.animal) {
        // The beast falls where it stood: butcher it, or carry it off (ui/innerMapAnimals.js)
        if (player.skills && Utils.random() < 0.25) player.skills.combat = Math.min(10, (player.skills.combat || 1) + 0.1);
        const words = (InnerMap.animalConfig ? InnerMap.animalConfig().words : null) || {};
        const line = String(words.huntKill || 'The {name} is down. Butcher it where it lies, or carry it off.').replace('{name}', p.preyName) + arrowsLine;
        if (game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(`${p.preyIcon || '🏹'} A Clean Kill`, line, 'success');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return 'success';
    }
    if (out.result === 'shot') {
        const trip = Hunting.finishTrip(player, Hunting.strikeLoot(lootTable, player));
        totalLoot = trip.kept.map(f => ({ ...f.entry, foundQty: f.qty }));
        totalValue = trip.value;
        if (trip.lost.length) statusMsg += ` No room for ${trip.lost.map(f => `${f.entry.name} x${f.qty}`).join(', ')} — left behind.`;
        if (trip.rankUp) statusMsg += ` Your craft grows: ${trip.rankUp.icon} ${trip.rankUp.name}.`;
        if (player.skills && Utils.random() < 0.25) {
            player.skills.combat = Math.min(10, (player.skills.combat || 1) + 0.1);
            statusMsg += ' Combat skill improved!';
        }
        statusMsg += arrowsLine;
        kind = 'success';
    } else if (out.result === 'missed' && out.fumble) {
        const dmg = out.fumble.damage;
        player.health = Math.max(1, player.health - dmg);
        kind = 'injured';
        statusMsg = `The string slipped and lashed your arm! -${dmg} HP.${arrowsLine}`;
        const wound = Ailments.maybeWound(player, game.world, 'hunt');
        if (wound) statusMsg += ` ${wound.icon} ${wound.name}.`;
        Hunting.finishTrip(player, []); // a hard lesson is still experience
    } else if (out.result === 'missed') {
        kind = 'missed';
        statusMsg = `Your arrows flew wide. The ${p.preyName} fled.${arrowsLine}`;
        Hunting.finishTrip(player, []);
    } else if (out.result === 'abandoned') {
        statusMsg = `You gave up the hunt and headed back.${arrowsLine}`;
    } else if (out.wounded) {
        statusMsg = `The wounded ${p.preyName} got away into the ${p.category}.${arrowsLine}`;
        Hunting.finishTrip(player, []);
    } else {
        statusMsg = `The ${p.preyName} got wind of you and bolted into the ${p.category}!${arrowsLine}`;
    }
    if (out.broke) statusMsg += ' Your bow broke.';

    let html = '<div style="max-width: 500px;">';
    if (kind === 'success') {
        html += `<div style="font-size: 44px; margin: 10px 0; text-align: center;">${p.preyIcon}</div>`;
        html += rowList(totalLoot.map(item => ({
            icon: item.icon,
            name: `${item.name} x${item.foundQty}`,
            side: `~${item.foundQty * (item.sellPrice || 0)}g`,
        })), '<span style="color:#8fd18a;">Successful Hunt!</span>');
        if (!totalLoot.length) html += sectionHead('<span style="color:#8fd18a;">Successful Hunt!</span>');
        html += chips([{ icon: '🎒', label: 'Into your packs — worth', value: `~${totalValue} gold at market`, cls: 'gold' }]);
        if (statusMsg) html += `<div style="font-size: 12px; color: #9d937c; margin-top: 6px;">${statusMsg}</div>`;
    } else {
        const head = { fled: [`💨`, '#f0b35a', `The ${p.preyName} escaped!`], injured: ['🤕', '#e0846a', 'Hunting Mishap!'], missed: ['🏹', '#cbbf9f', 'Missed!'] }[kind];
        html += `<div style="text-align: center;">`;
        html += `<div style="font-size: 44px; margin: 10px 0;">${head[0]}</div>`;
        html += `<div style="font-family: var(--font-display); font-size: 16px; color: ${head[1]}; font-weight: bold; margin-bottom: 8px;">${head[2]}</div>`;
        html += `</div>`;
        html += lede(statusMsg);
    }
    html += `<button data-am-act="closePanelAndEndDay"
        style="${BTN_GOLD} display: block; width: 100%; margin: 12px 0 0; padding: 9px;">Continue</button>`;
    html += '</div>';
    game.ui.showCustomPanel('🏹 Hunting', html);
    game.ui.updateStats(player, game.world);
    return kind;
}
