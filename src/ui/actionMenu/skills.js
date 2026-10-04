// ActionMenu — skills methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerInventory } from './_imports.js';

Object.assign(ActionMenu, {
    /**
     * Pickpocket — pocket puzzle minigame
     * Search a grid of hidden tiles to find the purse while avoiding noisy items.
     * The target periodically glances around — freeze or get caught!
     */
    doPickpocket(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const stealthSkill = player.skills?.stealth || 1;
        const luckStat = player.luck || 5;
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' ? 'town' : 'village');

        // ── Target generation ──
        const targetPool = [
            { type: 'peasant',    icon: '👨‍🌾', name: 'Farmer',         gold: [3, 12],   awareness: 0.2, tier: ['village','town','capital'] },
            { type: 'merchant',   icon: '🧑‍💼', name: 'Merchant',       gold: [10, 35],  awareness: 0.45, tier: ['town','capital'] },
            { type: 'noble',      icon: '🤴',  name: 'Minor Noble',    gold: [25, 60],  awareness: 0.6,  tier: ['town','capital'] },
            { type: 'drunk',      icon: '🍺',  name: 'Drunkard',       gold: [2, 10],   awareness: 0.1,  tier: ['village','town','capital'] },
            { type: 'traveler',   icon: '🧳',  name: 'Traveler',       gold: [8, 25],   awareness: 0.35, tier: ['village','town','capital'] },
            { type: 'guard',      icon: '💂',  name: 'Off-Duty Guard', gold: [15, 30],  awareness: 0.7,  tier: ['town','capital'] },
            { type: 'priest',     icon: '⛪',  name: 'Priest',         gold: [5, 20],   awareness: 0.25, tier: ['village','town','capital'] },
            { type: 'aristocrat', icon: '👸',  name: 'Aristocrat',     gold: [40, 80],  awareness: 0.75, tier: ['capital'] },
        ];

        const available = targetPool.filter(t => t.tier.includes(tier));
        const targets = [];
        const copy = [...available];
        for (let i = 0; i < Math.min(3, copy.length); i++) {
            const idx = Math.floor(Math.random() * copy.length);
            const t = copy.splice(idx, 1)[0];
            const goldAmount = t.gold[0] + Math.floor(Math.random() * (t.gold[1] - t.gold[0] + 1));
            const diff = t.awareness < 0.3 ? 'Easy' : t.awareness < 0.5 ? 'Medium' : t.awareness < 0.7 ? 'Hard' : 'Risky';
            const diffColor = t.awareness < 0.3 ? '#2ecc71' : t.awareness < 0.5 ? '#f39c12' : t.awareness < 0.7 ? '#e67e22' : '#e74c3c';
            targets.push({ ...t, goldAmount, diff, diffColor });
        }

        // ── Grid tile types ──
        // 💰 purse (win), 💲 coins (bonus gold), 🔑 keys (noise +susp), 🔔 bell (big noise),
        // 📜 map (reveals neighbors), 🕳️ empty pocket, 🧵 lint (nothing)
        const TILE_TYPES = {
            purse:  { icon: '💰', label: 'Purse!', color: '#f5c542', susp: 0 },
            coins:  { icon: '💲', label: 'Loose coins', color: '#f39c12', susp: 3 },
            keys:   { icon: '🔑', label: 'Keys — jingle!', color: '#e67e22', susp: 18 },
            bell:   { icon: '🔔', label: 'Bell — CLANG!', color: '#e74c3c', susp: 30 },
            map:    { icon: '📜', label: 'Note — reveals area', color: '#3498db', susp: 2 },
            empty:  { icon: '🕳️', label: 'Empty pocket', color: '#555', susp: 1 },
            lint:   { icon: '🧵', label: 'Just lint...', color: '#666', susp: 1 },
        };

        // ── Game state ──
        let phase = 'select'; // select → puzzle → result
        let selectedTarget = null;
        let grid = [];        // 2D array of { type, revealed, hinted, row, col }
        let gridRows = 0, gridCols = 0;
        let suspicionLevel = 0;
        let caught = false;
        let escaped = false;
        let stolenGold = 0;
        let bonusGold = 0;
        let statusMsg = '';
        let frozen = false;        // target is looking — don't click!
        let freezeWarning = false; // flash warning before freeze
        let glanceInterval = null;
        let glanceTimeout = null;
        let suspInterval = null;
        let tilesFlipped = 0;
        let foundPurse = false;
        let clickLocked = false;   // brief lock after each flip

        const cleanup = () => {
            if (glanceInterval) clearInterval(glanceInterval);
            if (glanceTimeout) clearTimeout(glanceTimeout);
            if (suspInterval) clearInterval(suspInterval);
        };

        // ── Build grid ──
        const buildGrid = (target) => {
            // Grid size scales with difficulty
            const aw = target.awareness;
            if (aw >= 0.7) { gridRows = 5; gridCols = 4; }
            else if (aw >= 0.45) { gridRows = 4; gridCols = 4; }
            else if (aw >= 0.25) { gridRows = 4; gridCols = 3; }
            else { gridRows = 3; gridCols = 3; }

            const total = gridRows * gridCols;
            const contents = [];
            contents.push('purse');  // always 1 purse

            // Scale hazards with awareness
            const numKeys = aw >= 0.6 ? 3 : aw >= 0.35 ? 2 : 1;
            const numBells = aw >= 0.7 ? 2 : aw >= 0.45 ? 1 : 0;
            const numCoins = 1 + Math.floor(Math.random() * 2);
            const numMaps = Math.random() < 0.4 ? 1 : 0;

            for (let i = 0; i < numKeys; i++) contents.push('keys');
            for (let i = 0; i < numBells; i++) contents.push('bell');
            for (let i = 0; i < numCoins; i++) contents.push('coins');
            for (let i = 0; i < numMaps; i++) contents.push('map');

            // Fill remaining with empties/lint
            while (contents.length < total) {
                contents.push(Math.random() < 0.5 ? 'empty' : 'lint');
            }

            // Shuffle (Fisher-Yates)
            for (let i = contents.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [contents[i], contents[j]] = [contents[j], contents[i]];
            }

            grid = [];
            for (let r = 0; r < gridRows; r++) {
                const row = [];
                for (let c = 0; c < gridCols; c++) {
                    row.push({ type: contents[r * gridCols + c], revealed: false, hinted: false, row: r, col: c });
                }
                grid.push(row);
            }

            // Stealth hints — reveal some safe tiles (empties/lint)
            const hints = Math.min(stealthSkill, Math.floor(total * 0.3));
            const safeTiles = [];
            for (let r = 0; r < gridRows; r++) {
                for (let c = 0; c < gridCols; c++) {
                    const t = grid[r][c];
                    if (t.type === 'empty' || t.type === 'lint') safeTiles.push(t);
                }
            }
            // Shuffle safe tiles
            for (let i = safeTiles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [safeTiles[i], safeTiles[j]] = [safeTiles[j], safeTiles[i]];
            }
            for (let i = 0; i < Math.min(hints, safeTiles.length); i++) {
                safeTiles[i].hinted = true;
            }

            // Luck bonus — hint one hazard tile
            if (luckStat >= 7) {
                const hazards = [];
                for (let r = 0; r < gridRows; r++) {
                    for (let c = 0; c < gridCols; c++) {
                        if (grid[r][c].type === 'keys' || grid[r][c].type === 'bell') hazards.push(grid[r][c]);
                    }
                }
                if (hazards.length > 0) {
                    hazards[Math.floor(Math.random() * hazards.length)].hinted = true;
                }
            }
        };

        // ── Reveal neighbors (map tile) ──
        const revealNeighbors = (row, col) => {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = row + dr, nc = col + dc;
                    if (nr >= 0 && nr < gridRows && nc >= 0 && nc < gridCols) {
                        grid[nr][nc].hinted = true;
                    }
                }
            }
        };

        // ── Start glance cycle ──
        const startGlanceCycle = () => {
            const scheduleGlance = () => {
                // Time between glances — shorter for more aware targets
                const baseDelay = 4500 - selectedTarget.awareness * 2500;
                const delay = baseDelay + Math.random() * 2000;
                glanceInterval = setTimeout(() => {
                    if (phase !== 'puzzle') return;
                    // Warning flash
                    freezeWarning = true;
                    statusMsg = '<span style="color: #f39c12; font-weight: bold;">⚠️ They\'re turning around — DON\'T TOUCH!</span>';
                    render();

                    // After 0.8s warning, freeze starts
                    glanceTimeout = setTimeout(() => {
                        if (phase !== 'puzzle') return;
                        frozen = true;
                        freezeWarning = false;
                        statusMsg = '<span style="color: #e74c3c; font-weight: bold;">👁️ They\'re looking! FREEZE!</span>';
                        render();

                        // Freeze lasts 1.2-2s
                        const freezeDur = 1200 + Math.random() * 800;
                        glanceTimeout = setTimeout(() => {
                            if (phase !== 'puzzle') return;
                            frozen = false;
                            statusMsg = '<span style="color: #2ecc71;">They looked away. Continue searching...</span>';
                            render();
                            scheduleGlance();
                        }, freezeDur);
                    }, 800);
                }, delay);
            };
            scheduleGlance();
        };

        // ── Render ──
        const render = () => {
            let html = '<div style="max-width: 520px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">🤏 Pickpocket</h4>';

            if (phase === 'select') {
                html += `<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Stealth: ${stealthSkill} | Luck: ${luckStat} | ${settlement.name} (${tier})</p>`;
                html += '<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">Choose your mark from the crowd:</div>';

                for (let i = 0; i < targets.length; i++) {
                    const t = targets[i];
                    const gridSize = t.awareness >= 0.7 ? '5×4' : t.awareness >= 0.45 ? '4×4' : t.awareness >= 0.25 ? '4×3' : '3×3';
                    html += `<button onclick="window._ppSelectTarget(${i})"
                        style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 8px;
                               background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid ${t.diffColor};
                               border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                        <span style="font-size: 28px;">${t.icon}</span>
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 13px;">${t.name}</div>
                            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
                                ${gridSize} pockets to search — find the purse!
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 12px; color: ${t.diffColor}; font-weight: bold;">${t.diff}</div>
                            <div style="font-size: 10px; color: var(--text-muted);">~${t.goldAmount}g</div>
                        </div>
                    </button>`;
                }

                html += `<button data-am-act="closePanel"
                    style="margin-top: 6px; padding: 8px 20px; background: none; border: 1px solid rgba(255,255,255,0.1);
                           border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">
                    Nevermind
                </button>`;

            } else if (phase === 'puzzle') {
                // ── Target + status ──
                const targetDir = frozen ? '👁️' : freezeWarning ? '⚠️' : '😶';
                html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 24px;">${selectedTarget.icon}</span>
                                <span style="font-size: 18px;">${targetDir}</span>
                            </div>
                            <span style="font-size: 11px; color: var(--text-muted);">Tiles flipped: ${tilesFlipped}</span>
                         </div>`;

                // Suspicion bar
                const barColor = suspicionLevel < 35 ? '#2ecc71' : suspicionLevel < 60 ? '#f39c12' : suspicionLevel < 80 ? '#e67e22' : '#e74c3c';
                const suspLabel = suspicionLevel < 35 ? '🤫 Unnoticed' : suspicionLevel < 60 ? '🤨 Curious...' : suspicionLevel < 80 ? '😠 Suspicious!' : '🚨 Alert!';
                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Suspicion</span>
                        <span style="color: ${barColor}; font-weight: 600;">${suspLabel} ${Math.round(suspicionLevel)}%</span>
                    </div>
                    <div style="position: relative; height: 16px; background: rgba(255,255,255,0.06); border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="position: absolute; left: 0; width: ${suspicionLevel}%; height: 100%; background: ${barColor}; transition: width 0.25s; border-radius: 7px;"></div>
                    </div>
                </div>`;

                // Status message
                if (statusMsg) {
                    html += `<div style="margin-bottom: 8px; font-size: 12px; min-height: 20px;">${statusMsg}</div>`;
                }

                // ── The Grid ──
                const borderGlow = frozen ? 'border-color: #e74c3c; box-shadow: inset 0 0 30px rgba(231,76,60,0.15);'
                                 : freezeWarning ? 'border-color: #f39c12; box-shadow: inset 0 0 20px rgba(243,156,18,0.1);'
                                 : 'border-color: rgba(255,255,255,0.08);';
                html += `<div style="display: inline-block; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 12px; border: 2px solid transparent; ${borderGlow} transition: all 0.3s; margin-bottom: 10px;">`;
                html += `<div style="display: grid; grid-template-columns: repeat(${gridCols}, 1fr); gap: 6px;">`;

                for (let r = 0; r < gridRows; r++) {
                    for (let c = 0; c < gridCols; c++) {
                        const cell = grid[r][c];
                        const tileInfo = TILE_TYPES[cell.type];

                        if (cell.revealed) {
                            // Revealed tile
                            html += `<div style="width: 52px; height: 52px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;
                                        background: rgba(255,255,255,0.04); border: 1px solid ${tileInfo.color}40;
                                        ${cell.type === 'purse' ? 'box-shadow: 0 0 12px rgba(245,197,66,0.3); background: rgba(245,197,66,0.08);' : ''}">
                                <span style="font-size: 20px;">${tileInfo.icon}</span>
                                <span style="font-size: 7px; color: ${tileInfo.color}; margin-top: 1px; opacity: 0.8;">${cell.type === 'empty' || cell.type === 'lint' ? '' : tileInfo.label.split(' ')[0]}</span>
                            </div>`;
                        } else if (cell.hinted) {
                            // Hinted tile — shows a subtle marking
                            const hintBorder = (cell.type === 'keys' || cell.type === 'bell') ? '#e74c3c' : '#2ecc71';
                            const hintIcon = (cell.type === 'keys' || cell.type === 'bell') ? '⚠' : '✓';
                            html += `<button onclick="window._ppFlip(${r},${c})"
                                style="width: 52px; height: 52px; border-radius: 8px; cursor: pointer; position: relative;
                                       background: rgba(255,255,255,0.06); border: 1px dashed ${hintBorder}50;
                                       color: var(--text-primary); transition: all 0.15s; display: flex; align-items: center; justify-content: center;"
                                onmouseenter="this.style.background='rgba(255,255,255,0.12)'" onmouseleave="this.style.background='rgba(255,255,255,0.06)'">
                                <span style="font-size: 12px; opacity: 0.3;">${hintIcon}</span>
                            </button>`;
                        } else {
                            // Hidden tile
                            html += `<button onclick="window._ppFlip(${r},${c})"
                                style="width: 52px; height: 52px; border-radius: 8px; cursor: pointer;
                                       background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
                                       border: 1px solid rgba(255,255,255,0.08);
                                       color: var(--text-primary); transition: all 0.15s; display: flex; align-items: center; justify-content: center;"
                                onmouseenter="this.style.background='rgba(255,255,255,0.12)'; this.style.borderColor='rgba(245,197,66,0.3)'"
                                onmouseleave="this.style.background='linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))'; this.style.borderColor='rgba(255,255,255,0.08)'">
                                <span style="font-size: 16px; opacity: 0.2;">?</span>
                            </button>`;
                        }
                    }
                }

                html += '</div></div>'; // end grid

                // Legend
                html += `<div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 6px;">
                    <span style="font-size: 10px; color: var(--text-muted);">💰 Purse = Win</span>
                    <span style="font-size: 10px; color: var(--text-muted);">💲 Coins = Bonus</span>
                    <span style="font-size: 10px; color: var(--text-muted);">🔑 Keys = Noise!</span>
                    <span style="font-size: 10px; color: var(--text-muted);">🔔 Bell = Loud!</span>
                    <span style="font-size: 10px; color: var(--text-muted);">📜 Note = Reveals</span>
                </div>`;
                html += `<div style="display: flex; gap: 10px; justify-content: center; margin-top: 4px;">
                    <span style="font-size: 10px; color: #2ecc71;">✓ = Stealth hint (safe)</span>
                    <span style="font-size: 10px; color: #e74c3c;">⚠ = Danger hint (avoid!)</span>
                </div>`;

                // Abort button
                html += `<button onclick="window._ppAbort()"
                    style="margin-top: 10px; padding: 6px 18px; background: none; border: 1px solid rgba(255,255,255,0.08);
                           border-radius: 6px; cursor: pointer; color: var(--text-muted); font-size: 11px;">
                    🚶 Walk Away
                </button>`;

            } else if (phase === 'result') {
                if (caught) {
                    html += `<div style="font-size: 48px; margin: 16px 0;">🚔</div>`;
                    html += `<div style="font-size: 16px; color: #e74c3c; font-weight: bold; margin-bottom: 8px;">CAUGHT!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">${statusMsg}</div>`;
                } else if (escaped) {
                    html += `<div style="font-size: 48px; margin: 16px 0;">😰</div>`;
                    html += `<div style="font-size: 16px; color: #f39c12; font-weight: bold; margin-bottom: 8px;">Close Call!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">${statusMsg}</div>`;
                } else {
                    html += `<div style="font-size: 48px; margin: 16px 0;">💰</div>`;
                    html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Success!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">${statusMsg}</div>`;
                    const totalGold = stolenGold + bonusGold;
                    html += `<div style="font-size: 20px; color: var(--gold); font-weight: bold; margin: 8px 0;">+${totalGold} gold</div>`;
                    if (bonusGold > 0) {
                        html += `<div style="font-size: 11px; color: var(--text-secondary);">(${stolenGold}g purse + ${bonusGold}g loose coins)</div>`;
                    }
                }

                html += `<button data-am-act="closePanel"
                            style="padding: 10px 32px; margin-top: 12px; background: linear-gradient(135deg, var(--gold), #d4a030); color: #1a1a2e; border: none;
                                   border-radius: 6px; cursor: pointer; font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;">
                            Continue
                         </button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🤏 Pickpocket', html);
        };

        render();

        // ── Select target ──
        window._ppSelectTarget = (idx) => {
            selectedTarget = targets[idx];

            ActionMenu._showMinigamePrompt(game, {
                title: '🤏 Pickpocket ' + selectedTarget.name,
                icon: selectedTarget.icon,
                description: `Attempt to steal from ${selectedTarget.name}. ${selectedTarget.diff} difficulty.`,
                baseRewardText: `Simple roll (~${Math.floor((0.5 + (player.skills?.stealth || 1) * 0.06 - selectedTarget.awareness * 0.3) * 100)}% success, ~${selectedTarget.goldAmount}g)`,
                onSkip: () => {
                    // Simple stealth roll
                    const stealthSkill = player.skills?.stealth || 1;
                    const successChance = Math.max(0.1, 0.5 + stealthSkill * 0.06 - selectedTarget.awareness * 0.3);
                    if (Math.random() < successChance) {
                        const stolen = selectedTarget.goldAmount;
                        player.gold += stolen;
                        player.karma = (player.karma || 0) - 1;
                        if (Math.random() < 0.2 && player.skills) {
                            player.skills.stealth = Math.min(10, (player.skills.stealth || 1) + 1);
                        }
                        game.ui.showNotification('🤏 Pickpocket', `Swiped ${stolen}g from the ${selectedTarget.name}. -1 karma.`, 'success');
                    } else {
                        // Caught — apply penalties
                        ActionMenu._ppDoCaught(game, tile, player, settlement, selectedTarget);
                    }
                    game.ui.updateStats(player, game.world);
                    game.ui.hideCustomPanel();
                    game.endDay();
                },
                onPlay: () => {
                    phase = 'puzzle';
                    suspicionLevel = 0;
                    tilesFlipped = 0;
                    bonusGold = 0;
                    foundPurse = false;
                    buildGrid(selectedTarget);
                    statusMsg = '<span style="color: var(--text-muted);">Search the pockets carefully — find the 💰 purse!</span>';
                    render();

                    // Passive suspicion tick
                    suspInterval = setInterval(() => {
                        if (phase !== 'puzzle') { clearInterval(suspInterval); return; }
                        const passiveRate = 0.8 + selectedTarget.awareness * 1.5;
                        suspicionLevel = Math.min(100, suspicionLevel + passiveRate);
                        if (suspicionLevel >= 100) {
                            clearInterval(suspInterval);
                            cleanup();
                            caught = true;
                            phase = 'result';
                            statusMsg = `The ${selectedTarget.name} felt your hand and called the guards!`;
                            ActionMenu._ppDoCaught(game, tile, player, settlement, selectedTarget);
                            render();
                        }
                    }, 1200);

                    // Start glance cycle
                    startGlanceCycle();
                }
            });
        };

        // ── Flip a tile ──
        window._ppFlip = (r, c) => {
            if (phase !== 'puzzle' || clickLocked) return;
            const cell = grid[r][c];
            if (cell.revealed) return;

            // Clicking during freeze = big suspicion spike
            if (frozen) {
                suspicionLevel = Math.min(100, suspicionLevel + 25 + selectedTarget.awareness * 15);
                statusMsg = '<span style="color: #e74c3c; font-weight: bold;">🚨 They felt your hand moving! Huge suspicion spike!</span>';
                if (suspicionLevel >= 100) {
                    cleanup();
                    caught = true;
                    phase = 'result';
                    statusMsg = `Caught red-handed! The ${selectedTarget.name} grabbed your wrist!`;
                    ActionMenu._ppDoCaught(game, tile, player, settlement, selectedTarget);
                    render();
                    return;
                }
                render();
                return;
            }

            // Clicking during warning = moderate spike
            if (freezeWarning) {
                suspicionLevel = Math.min(100, suspicionLevel + 10 + selectedTarget.awareness * 8);
                statusMsg = '<span style="color: #f39c12;">⚠️ Risky move while they\'re turning!</span>';
            }

            // Reveal the tile
            cell.revealed = true;
            tilesFlipped++;
            clickLocked = true;
            setTimeout(() => { clickLocked = false; }, 300);

            const tileInfo = TILE_TYPES[cell.type];
            // Add suspicion from tile type
            const suspGain = tileInfo.susp * (1 - stealthSkill * 0.04);
            suspicionLevel = Math.min(100, suspicionLevel + Math.max(0.5, suspGain));

            switch (cell.type) {
                case 'purse':
                    // WIN!
                    cleanup();
                    foundPurse = true;
                    stolenGold = selectedTarget.goldAmount;
                    player.gold += stolenGold + bonusGold;
                    if (player.financeToday) {
                        player.financeToday.income.theft = (player.financeToday.income.theft || 0) + stolenGold + bonusGold;
                    }
                    player.karma = (player.karma || 0) - 1;

                    let skillUpMsg = '';
                    if (Math.random() < 0.2 && player.skills) {
                        player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                        skillUpMsg = ' Your stealth skill improved!';
                    }

                    // Efficiency bonus
                    const efficiency = Math.max(0, gridRows * gridCols - tilesFlipped);
                    const effMsg = efficiency > (gridRows * gridCols * 0.6) ? ' Masterful work — barely disturbed a thing!' : '';

                    statusMsg = `Found it in ${tilesFlipped} moves! Deftly lifted the purse from the ${selectedTarget.name}. -1 karma.${skillUpMsg}${effMsg}`;
                    phase = 'result';
                    render();
                    game.ui.updateStats(player, game.world);
                    return;

                case 'coins':
                    const coinAmt = 1 + Math.floor(Math.random() * 4);
                    bonusGold += coinAmt;
                    statusMsg = `<span style="color: #f39c12;">💲 Found ${coinAmt} loose coins! Keep searching for the purse...</span>`;
                    break;

                case 'keys':
                    statusMsg = '<span style="color: #e67e22;">🔑 Keys jingle loudly! Suspicion rose.</span>';
                    break;

                case 'bell':
                    statusMsg = '<span style="color: #e74c3c;">🔔 A bell rings out! Heavy suspicion!</span>';
                    break;

                case 'map':
                    revealNeighbors(r, c);
                    statusMsg = '<span style="color: #3498db;">📜 A note — you glimpse the nearby pocket contents!</span>';
                    break;

                case 'empty':
                case 'lint':
                    statusMsg = `<span style="color: #666;">${tileInfo.icon} ${tileInfo.label} — nothing here.</span>`;
                    break;
            }

            // Check if caught from this flip
            if (suspicionLevel >= 100) {
                cleanup();
                caught = true;
                phase = 'result';
                statusMsg = `The noise gave you away! The ${selectedTarget.name} caught you!`;
                ActionMenu._ppDoCaught(game, tile, player, settlement, selectedTarget);
                render();
                return;
            }

            render();
        };

        // ── Walk away ──
        window._ppAbort = () => {
            cleanup();
            escaped = true;
            phase = 'result';
            if (bonusGold > 0) {
                player.gold += bonusGold;
                if (player.financeToday) {
                    player.financeToday.income.theft = (player.financeToday.income.theft || 0) + bonusGold;
                }
                player.karma = (player.karma || 0) - 1;
                statusMsg = `You pocketed ${bonusGold}g in loose coins and melted back into the crowd.`;
            } else {
                statusMsg = 'You thought better of it and melted back into the crowd.';
            }
            render();
        };
    },

    /**
     * Handle getting caught pickpocketing — fines, jail, reputation
     */
    _ppDoCaught(game, tile, player, settlement, target) {
        const fine = Math.floor(Math.random() * 30) + 10;
        const actualFine = Math.min(fine, player.gold);
        player.gold -= actualFine;
        player.karma = (player.karma || 0) - 3;

        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.fines = (player.financeToday.expenses.fines || 0) + actualFine;
        }

        const kingdomId = settlement.kingdom;
        if (kingdomId && player.reputation) {
            player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 5;
        }

        if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
        player.criminalRecord.pickpocket = (player.criminalRecord.pickpocket || 0) + 1;
        const offenses = player.criminalRecord.pickpocket;
        const jailDays = offenses === 1 ? 2 : offenses === 2 ? 4 : offenses === 3 ? 7 : 10 + (offenses - 4) * 3;
        const bailCost = jailDays * 25;
        player.jailState = {
            daysRemaining: jailDays,
            totalDays: jailDays,
            offense: 'pickpocketing',
            offenseNumber: offenses,
            settlement: settlement.name,
            bailCost: bailCost,
            escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
        };
        player.stamina = 0;
        player.movementRemaining = 0;

        game.ui.showNotification('🚔 Arrested!',
            `Caught pickpocketing the ${target.name}! Fined ${actualFine}g, sentenced to ${jailDays} days in jail (offense #${offenses}). -3 karma, -5 reputation.`, 'error');
        game.ui.updateStats(player, game.world);
    },

    /**
     * Smuggle goods — sell inventory items at premium but risk getting caught
     */
    showSmuggleMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        // Find sellable goods in inventory
        const goods = [];
        const excludeItems = ['bread'];
        for (const [item, qty] of Object.entries(player.inventory || {})) {
            if (qty > 0 && !excludeItems.includes(item)) {
                goods.push({ item, qty });
            }
        }

        if (goods.length === 0) {
            game.ui.showNotification('No Goods', 'You have nothing worth smuggling!', 'default');
            return;
        }

        const basePrices = {
            herbs: 8, pelts: 12, meat: 6, berries: 4, mushrooms: 5,
            hide: 15, antler: 20, feather: 10, fish: 5, ore: 25,
            gems: 80, stone: 8, horse: 120, wood: 3
        };

        // Step 1: Choose item to smuggle
        let html = '<div style="max-width: 420px;">';
        html += '<h4 style="margin-top: 0;">🏴‍☠️ Black Market Smuggling</h4>';
        html += `<p style="font-size: 12px; color: var(--text-secondary);">Sell goods at a premium through shady channels in ${settlement.name}. Sneak past guards to make the deal.</p>`;
        html += `<p style="font-size: 11px; color: #aaa;">Stealth: ${player.skills?.stealth || 1} | AP: ${player.actionPoints || 0} (costs 2 per deal)</p>`;

        for (const g of goods) {
            const basePrice = basePrices[g.item] || 10;
            const smugglePrice = Math.floor(basePrice * 2.5);
            html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">`;
            html += `<span>${g.item} (x${g.qty})</span>`;
            html += `<span style="color: var(--gold);">${smugglePrice}g each</span>`;
            html += `<button onclick="window._startSmuggleRun('${g.item}', ${smugglePrice})" style="padding: 4px 10px; background: #8b0000; border: none; border-radius: 3px; cursor: pointer; color: #fff; font-size: 11px;">Smuggle 1</button>`;
            html += `</div>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('Smuggling', html);

        window._startSmuggleRun = (itemName, price) => {
            if (!player.inventory[itemName] || player.inventory[itemName] <= 0) {
                game.ui.showNotification('No Stock', 'You don\'t have any more of that!', 'error');
                return;
            }
            const apCost = 2;
            if ((player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ No Action Points', `Each smuggling deal costs ${apCost} AP.`, 'error');
                return;
            }
            player.actionPoints -= apCost;

            const stealthSkill = player.skills?.stealth || 1;

            ActionMenu._showMinigamePrompt(game, {
                title: '🏴‍☠️ Smuggle ' + itemName,
                icon: '🏴‍☠️',
                description: `Sneak past guards to sell ${itemName} for ${price}g.`,
                baseRewardText: `~${Math.floor(50 + stealthSkill * 6)}% success chance (simple roll)`,
                onSkip: () => {
                    // Old instant-roll mechanic
                    const successChance = 0.5 + stealthSkill * 0.06;
                    if (Math.random() < successChance) {
                        player.inventory[itemName]--;
                        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                        player.gold += price;
                        if (player.financeToday) {
                            player.financeToday.income.smuggling = (player.financeToday.income.smuggling || 0) + price;
                        }
                        player.karma = (player.karma || 0) - 1;
                        if (Math.random() < 0.15 && player.skills) {
                            player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                        }
                        game.ui.showNotification('🏴‍☠️ Deal Done', `Sold ${itemName} for ${price}g on the black market.`, 'success');
                    } else {
                        player.inventory[itemName]--;
                        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                        const fine = Math.floor(price * 0.5);
                        const actualFine = Math.min(fine, player.gold);
                        player.gold -= actualFine;
                        player.karma = (player.karma || 0) - 3;
                        if (player.financeToday) {
                            player.financeToday.expenses = player.financeToday.expenses || {};
                            player.financeToday.expenses.fines = (player.financeToday.expenses.fines || 0) + actualFine;
                        }
                        const kingdomId = settlement.kingdom;
                        if (kingdomId && player.reputation) {
                            player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 8;
                        }
                        if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
                        player.criminalRecord.smuggling = (player.criminalRecord.smuggling || 0) + 1;
                        const offenses = player.criminalRecord.smuggling;
                        const jailDays = offenses === 1 ? 3 : offenses === 2 ? 6 : offenses === 3 ? 10 : 14 + (offenses - 4) * 4;
                        const bailCost = jailDays * 30;
                        player.jailState = {
                            daysRemaining: jailDays, totalDays: jailDays, offense: 'smuggling',
                            offenseNumber: offenses, settlement: settlement.name, bailCost: bailCost,
                            escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
                        };
                        player.stamina = 0;
                        player.movementRemaining = 0;
                        game.ui.showNotification('🚔 Arrested!',
                            `Caught smuggling ${itemName}! Fined ${actualFine}g, sentenced to ${jailDays} days. -3 karma, -8 rep.`, 'error');
                    }
                    game.ui.updateStats(player, game.world);
                    game.ui.hideCustomPanel();
                    const remaining = Object.entries(player.inventory || {}).filter(([k, v]) => v > 0 && k !== 'bread');
                    if (remaining.length > 0) ActionMenu.showSmuggleMenu(game, tile);
                },
                onPlay: () => { ActionMenu._doSmuggleMinigame(game, tile, player, settlement, itemName, price, stealthSkill); }
            });
        };
    },

    _doSmuggleMinigame(game, tile, player, settlement, itemName, price, stealthSkill) {
            // ── Smuggling Minigame: Sneak past patrol lanes ──
            const LANES = 5; // number of patrol lanes to cross
            let currentLane = 0;
            let suspicion = 0; // 0-100, caught at 100
            let phase = 'sneaking'; // sneaking → result
            let statusMsg = '';
            let smuggleTimer = null;
            let resultSuccess = false;

            // Generate guard patrols per lane
            const lanes = [];
            for (let i = 0; i < LANES; i++) {
                const guardCount = 1 + Math.floor(i * 0.6);
                const speed = 1.5 + i * 0.4 - stealthSkill * 0.08;
                const guards = [];
                for (let g = 0; g < guardCount; g++) {
                    guards.push({
                        pos: Math.random() * 100,
                        speed: speed * (0.8 + Math.random() * 0.4),
                        dir: Math.random() > 0.5 ? 1 : -1,
                        width: 22 - stealthSkill * 0.8, // vision cone width
                    });
                }
                lanes.push({
                    guards,
                    label: ['Alley Entrance', 'Market Square', 'Guard Post', 'Noble District', 'Black Market'][i],
                    passed: false,
                    waiting: i === 0 // first lane is active
                });
            }

            // Animate guards
            const updateGuards = () => {
                for (const lane of lanes) {
                    for (const g of lane.guards) {
                        g.pos += g.speed * g.dir;
                        if (g.pos >= 100 || g.pos <= 0) {
                            g.dir *= -1;
                            g.pos = Math.max(0, Math.min(100, g.pos));
                        }
                    }
                }
            };

            // Check if safe to cross
            const isLaneSafe = (laneIdx) => {
                const lane = lanes[laneIdx];
                const playerZone = 50; // player crosses through middle
                for (const g of lane.guards) {
                    const left = g.pos - g.width / 2;
                    const right = g.pos + g.width / 2;
                    if (playerZone >= left && playerZone <= right) return false;
                }
                return true;
            };

            const renderSmuggle = () => {
                let h = '<div style="max-width: 440px; text-align: center;">';
                h += `<h4 style="margin: 0 0 4px;">🏴‍☠️ Smuggle ${itemName}</h4>`;

                if (phase === 'sneaking') {
                    // Suspicion bar
                    h += `<div style="margin-bottom: 8px;">
                        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px;">👁️ Suspicion</div>
                        <div style="background: rgba(255,255,255,0.06); border-radius: 4px; height: 10px; overflow: hidden;">
                            <div style="width: ${suspicion}%; height: 100%; background: ${suspicion > 70 ? '#e74c3c' : suspicion > 40 ? '#f39c12' : '#2ecc71'}; border-radius: 3px; transition: width 0.2s;"></div>
                        </div>
                    </div>`;

                    h += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">Lanes passed: ${currentLane}/${LANES}</div>`;

                    // Render each lane
                    for (let i = 0; i < LANES; i++) {
                        const lane = lanes[i];
                        const isCurrent = i === currentLane;
                        const isPassed = lane.passed;

                        h += `<div style="position: relative; height: 36px; margin-bottom: 3px; border-radius: 6px; overflow: hidden;
                            background: ${isPassed ? 'rgba(46,204,113,0.08)' : isCurrent ? 'rgba(243,156,18,0.08)' : 'rgba(255,255,255,0.03)'};
                            border: ${isCurrent ? '2px solid var(--gold)' : '1px solid rgba(255,255,255,0.06)'};">`;

                        // Lane label
                        h += `<div style="position: absolute; left: 6px; top: 50%; transform: translateY(-50%); font-size: 9px; color: var(--text-muted); z-index: 2;">
                            ${isPassed ? '✅' : ''} ${lane.label}
                        </div>`;

                        if (!isPassed) {
                            // Draw guards as red zones
                            for (const g of lane.guards) {
                                const left = Math.max(0, g.pos - g.width / 2);
                                const w = g.width;
                                h += `<div style="position: absolute; left: ${left}%; width: ${w}%; top: 0; bottom: 0;
                                    background: rgba(231,76,60,${isCurrent ? '0.4' : '0.15'}); border-radius: 3px; transition: left 0.1s;">
                                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 12px;">👮</div>
                                </div>`;
                            }

                            // Player crossing zone indicator (fixed at center)
                            if (isCurrent) {
                                h += `<div style="position: absolute; left: 48%; width: 4%; top: 0; bottom: 0;
                                    background: rgba(46,204,113,0.5); border-radius: 2px;"></div>`;
                            }
                        }

                        h += `</div>`;
                    }

                    if (statusMsg) h += `<div style="margin-top: 6px; font-size: 12px;">${statusMsg}</div>`;

                    h += `<div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px;">
                        <button onclick="window._smuggleSneak()"
                            style="padding: 10px 28px; background: rgba(46,204,113,0.15); border: 2px solid #2ecc71;
                                   border-radius: 8px; cursor: pointer; color: #2ecc71; font-size: 14px; font-weight: bold;"
                            onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                            🏃 Sneak Past!
                        </button>
                        <button onclick="window._smuggleAbort()"
                            style="padding: 10px 16px; background: none; border: 1px solid rgba(255,255,255,0.1);
                                   border-radius: 8px; cursor: pointer; color: var(--text-muted); font-size: 12px;">
                            Abort
                        </button>
                    </div>`;
                    h += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Watch the guards patrol. Click SNEAK when the path is clear!</div>`;

                } else {
                    // Result
                    if (smuggleTimer) { clearInterval(smuggleTimer); smuggleTimer = null; }

                    if (resultSuccess) {
                        h += `<div style="font-size: 48px; margin: 12px 0;">🏴‍☠️</div>`;
                        h += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Deal Complete!</div>`;
                        h += `<div style="padding: 8px 12px; background: rgba(245,197,66,0.1); border-radius: 4px; margin-bottom: 8px;">
                            <span style="color: var(--gold); font-size: 16px; font-weight: bold;">+${price}g</span>
                            <span style="color: var(--text-secondary); font-size: 12px;"> for ${itemName}</span>
                        </div>`;
                        h += `<div style="font-size: 12px; color: var(--text-secondary);">Slipped through ${LANES} guard patrols undetected.</div>`;
                    } else {
                        h += `<div style="font-size: 48px; margin: 12px 0;">🚔</div>`;
                        h += `<div style="font-size: 16px; color: #e74c3c; font-weight: bold; margin-bottom: 8px;">Caught!</div>`;
                        h += `<div style="color: var(--text-secondary); font-size: 12px;">${statusMsg}</div>`;
                    }

                    h += `<button onclick="window._smuggleDone()"
                        style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
                }

                h += '</div>';
                game.ui.showCustomPanel('🏴‍☠️ Smuggling', h);
            };

            // Start patrol animation
            smuggleTimer = setInterval(() => {
                if (phase !== 'sneaking') { clearInterval(smuggleTimer); return; }
                updateGuards();
                // Passive suspicion decay
                suspicion = Math.max(0, suspicion - 0.1);
                renderSmuggle();
            }, 150);

            window._smuggleSneak = () => {
                if (phase !== 'sneaking') return;

                if (isLaneSafe(currentLane)) {
                    // Successful sneak
                    lanes[currentLane].passed = true;
                    currentLane++;
                    statusMsg = `<span style="color: #2ecc71;">✅ Slipped past!</span>`;

                    if (currentLane >= LANES) {
                        // All lanes cleared — success!
                        phase = 'result';
                        resultSuccess = true;

                        player.inventory[itemName]--;
                        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                        player.gold += price;
                        if (player.financeToday) {
                            player.financeToday.income.smuggling = (player.financeToday.income.smuggling || 0) + price;
                        }
                        player.karma = (player.karma || 0) - 1;

                        if (Math.random() < 0.15 && player.skills) {
                            player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
                        }
                    }
                } else {
                    // Spotted!
                    const spotPenalty = 25 - stealthSkill * 1.5;
                    suspicion += Math.max(8, spotPenalty);
                    statusMsg = `<span style="color: #e74c3c;">👁️ Guard spotted you! +${Math.floor(spotPenalty)} suspicion</span>`;

                    if (suspicion >= 100) {
                        // Caught!
                        phase = 'result';
                        resultSuccess = false;

                        player.inventory[itemName]--;
                        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
                        const fine = Math.floor(price * 0.5);
                        const actualFine = Math.min(fine, player.gold);
                        player.gold -= actualFine;
                        player.karma = (player.karma || 0) - 3;

                        if (player.financeToday) {
                            player.financeToday.expenses = player.financeToday.expenses || {};
                            player.financeToday.expenses.fines = (player.financeToday.expenses.fines || 0) + actualFine;
                        }

                        const kingdomId = settlement.kingdom;
                        if (kingdomId && player.reputation) {
                            player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 8;
                        }

                        if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
                        player.criminalRecord.smuggling = (player.criminalRecord.smuggling || 0) + 1;
                        const offenses = player.criminalRecord.smuggling;
                        const jailDays = offenses === 1 ? 3 : offenses === 2 ? 6 : offenses === 3 ? 10 : 14 + (offenses - 4) * 4;
                        const bailCost = jailDays * 30;
                        player.jailState = {
                            daysRemaining: jailDays,
                            totalDays: jailDays,
                            offense: 'smuggling',
                            offenseNumber: offenses,
                            settlement: settlement.name,
                            bailCost: bailCost,
                            escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
                        };
                        player.stamina = 0;
                        player.movementRemaining = 0;

                        statusMsg = `Caught smuggling ${itemName}! Fined ${actualFine}g, sentenced to ${jailDays} days in jail (offense #${offenses}). -3 karma, -8 rep.`;
                    }
                }
                renderSmuggle();
                game.ui.updateStats(player, game.world);
            };

            window._smuggleAbort = () => {
                if (smuggleTimer) { clearInterval(smuggleTimer); smuggleTimer = null; }
                game.ui.hideCustomPanel();
                // Refund the 2 AP the run cost, since they didn't complete it
                player.actionPoints += 2;
                game.ui.updateStats(player, game.world);
                ActionMenu.showSmuggleMenu(game, tile);
            };

            window._smuggleDone = () => {
                if (smuggleTimer) { clearInterval(smuggleTimer); smuggleTimer = null; }
                game.ui.hideCustomPanel();
                game.ui.updateStats(player, game.world);
                const remaining = Object.entries(player.inventory || {}).filter(([k, v]) => v > 0 && k !== 'bread');
                if (remaining.length > 0 && resultSuccess) {
                    ActionMenu.showSmuggleMenu(game, tile);
                }
            };

            renderSmuggle();
    },

    /**
     * Train combat at a settlement — costs gold, improves combat skill
     */
    doTrainCombat(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        const cost = settlement.type === 'capital' ? 75 : 50;
        if (player.gold < cost) {
            game.ui.showNotification('Not Enough Gold', `Training costs ${cost} gold.`, 'error');
            return;
        }

        player.gold -= cost;
        if (player.financeToday) {
            player.financeToday.expenses = player.financeToday.expenses || {};
            player.financeToday.expenses.training = (player.financeToday.expenses.training || 0) + cost;
        }

        ActionMenu._showMinigamePrompt(game, {
            title: '⚔️ Combat Training',
            icon: '⚔️',
            description: `Spar with a trainer in ${settlement.name}. (Paid ${cost}g)`,
            baseRewardText: '15% chance combat skill +1',
            onSkip: () => {
                // Base reward: small chance of stat growth
                let msg = `Trained with the ${settlement.type === 'capital' ? 'Royal Swordmaster' : 'Militia Sergeant'}.`;
                if (Math.random() < 0.15) {
                    player.skills = player.skills || {};
                    player.skills.combat = Math.min(10, (player.skills.combat || 1) + 1);
                    msg += ' ⚔️ Combat skill improved!';
                }
                if (player.army && player.army.length > 0) {
                    const xp = 8;
                    for (const unit of player.army) unit.experience = (unit.experience || 0) + xp;
                    msg += ` Army gained ${xp} XP.`;
                }
                game.ui.showNotification('⚔️ Training', msg, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doTrainCombatMinigame(game, tile, player, settlement, cost); }
        });
    },

    _doTrainCombatMinigame(game, tile, player, settlement, cost) {
        // ── Combat Training Minigame: Sparring duel ──
        const combatSkill = player.skills?.combat || 1;
        const isCapital = settlement.type === 'capital';
        const opponentName = isCapital ? 'Royal Swordmaster' : 'Militia Sergeant';
        const opponentIcon = isCapital ? '🗡️' : '⚔️';
        const rounds = 5;
        let currentRound = 0;
        let playerScore = 0;
        let opponentScore = 0;
        let phase = 'ready'; // ready → choose → clash → result
        let playerChoice = null;
        let opponentChoice = null;
        let clashResult = '';
        let statusMsg = '';
        let sparInterval = null;
        let timeLeft = 0;

        const moves = [
            { id: 'slash',  icon: '⚔️',  label: 'Slash',  beats: 'thrust' },
            { id: 'thrust', icon: '🗡️',  label: 'Thrust', beats: 'block' },
            { id: 'block',  icon: '🛡️',  label: 'Block',  beats: 'slash' },
        ];

        const getMove = (id) => moves.find(m => m.id === id);

        const cleanup = () => {
            if (sparInterval) { clearInterval(sparInterval); sparInterval = null; }
        };

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">⚔️ Combat Training</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px;">${settlement.name} — Sparring with ${opponentIcon} ${opponentName} (paid ${cost}g)</p>`;

            if (phase === 'ready' || phase === 'choose') {
                // Scoreboard
                html += `<div style="display: flex; justify-content: space-around; margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                    <div>
                        <div style="font-size: 11px; color: var(--text-muted);">You</div>
                        <div style="font-size: 28px; color: #2ecc71; font-weight: bold;">${playerScore}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; color: var(--text-muted);">Round</div>
                        <div style="font-size: 20px; color: var(--text-primary); font-weight: bold;">${currentRound + 1}/${rounds}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; color: var(--text-muted);">${opponentName}</div>
                        <div style="font-size: 28px; color: #e74c3c; font-weight: bold;">${opponentScore}</div>
                    </div>
                </div>`;

                if (phase === 'choose') {
                    // Timer bar
                    html += `<div style="margin-bottom: 8px;">
                        <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 8px; overflow: hidden;">
                            <div style="width: ${timeLeft}%; height: 100%; background: ${timeLeft < 30 ? '#e74c3c' : '#f39c12'}; transition: width 0.1s; border-radius: 5px;"></div>
                        </div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Choose your move!</div>
                    </div>`;
                }

                html += `<div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Choose your technique:</div>`;
                html += `<div style="display: flex; gap: 10px; justify-content: center;">`;
                for (const m of moves) {
                    const beatsMove = getMove(m.beats);
                    html += `<button onclick="window._sparMove('${m.id}')"
                        style="flex: 1; padding: 16px 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
                               border-radius: 10px; cursor: pointer; color: var(--text-primary); transition: all 0.15s; text-align: center;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.1)'; this.style.borderColor='var(--gold)'"
                        onmouseleave="this.style.background='rgba(255,255,255,0.04)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                        <div style="font-size: 28px; margin-bottom: 4px;">${m.icon}</div>
                        <div style="font-size: 13px; font-weight: bold;">${m.label}</div>
                        <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">beats ${beatsMove.label}</div>
                    </button>`;
                }
                html += `</div>`;

                if (statusMsg) html += `<div style="margin-top: 10px; font-size: 12px;">${statusMsg}</div>`;

            } else if (phase === 'clash') {
                const pm = getMove(playerChoice);
                const om = getMove(opponentChoice);
                html += `<div style="display: flex; justify-content: space-around; align-items: center; margin: 16px 0;">
                    <div>
                        <div style="font-size: 48px;">${pm.icon}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Your ${pm.label}</div>
                    </div>
                    <div style="font-size: 24px; color: var(--gold);">⚡</div>
                    <div>
                        <div style="font-size: 48px;">${om.icon}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${opponentName}'s ${om.label}</div>
                    </div>
                </div>`;
                html += `<div style="font-size: 16px; font-weight: bold; margin-bottom: 12px;">${clashResult}</div>`;

                // Scoreboard
                html += `<div style="display: flex; justify-content: space-around; margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                    <div style="font-size: 24px; color: #2ecc71; font-weight: bold;">${playerScore}</div>
                    <div style="font-size: 14px; color: var(--text-muted);">Round ${currentRound}/${rounds}</div>
                    <div style="font-size: 24px; color: #e74c3c; font-weight: bold;">${opponentScore}</div>
                </div>`;

                if (currentRound < rounds) {
                    html += `<button onclick="window._sparNext()"
                        style="padding: 10px 32px; background: rgba(255,255,255,0.08); border: 1px solid var(--gold); border-radius: 8px;
                               cursor: pointer; color: var(--gold); font-weight: bold; font-size: 13px;">Next Round →</button>`;
                } else {
                    html += `<button onclick="window._sparFinish()"
                        style="padding: 10px 32px; background: var(--gold); border: none; border-radius: 8px;
                               cursor: pointer; font-weight: bold; font-size: 13px;">See Results</button>`;
                }

            } else if (phase === 'result') {
                const won = playerScore > opponentScore;
                const tied = playerScore === opponentScore;
                html += `<div style="font-size: 48px; margin: 8px 0;">${won ? '🏆' : tied ? '🤝' : '😤'}</div>`;
                html += `<div style="font-size: 18px; color: ${won ? '#2ecc71' : tied ? '#f39c12' : '#e74c3c'}; font-weight: bold; margin-bottom: 4px;">
                    ${won ? 'Victory!' : tied ? 'Draw!' : 'Defeated!'}
                </div>`;
                html += `<div style="font-size: 14px; margin-bottom: 8px;">${playerScore} - ${opponentScore}</div>`;

                if (statusMsg) html += `<div style="font-size: 12px; color: var(--text-secondary); white-space: pre-line; margin-bottom: 8px;">${statusMsg}</div>`;

                html += `<button data-am-act="closePanelAndEndDay"
                    style="width: 100%; margin-top: 8px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('⚔️ Combat Training', html);
        };

        // Start first round
        phase = 'choose';
        timeLeft = 100;
        render();

        // Timer for each round
        const startTimer = () => {
            timeLeft = 100;
            cleanup();
            sparInterval = setInterval(() => {
                timeLeft -= 5;
                if (timeLeft <= 0) {
                    // Auto-pick random move
                    cleanup();
                    const autoMove = moves[Math.floor(Math.random() * moves.length)];
                    resolveClash(autoMove.id);
                }
                // Light re-render of just the timer would be complex, so we re-render
                if (timeLeft > 0 && phase === 'choose') render();
            }, 200);
        };
        startTimer();

        const resolveClash = (pMoveId) => {
            cleanup();
            playerChoice = pMoveId;
            // Opponent AI — slightly favors beating the player's last move at higher levels
            const opMoves = moves.map(m => m.id);
            opponentChoice = opMoves[Math.floor(Math.random() * opMoves.length)];

            const pm = getMove(playerChoice);
            const om = getMove(opponentChoice);

            if (pm.beats === om.id) {
                playerScore++;
                clashResult = `<span style="color: #2ecc71;">Your ${pm.label} beats ${om.label}! Hit!</span>`;
            } else if (om.beats === pm.id) {
                opponentScore++;
                clashResult = `<span style="color: #e74c3c;">${om.label} beats your ${pm.label}! Counter-hit!</span>`;
            } else {
                clashResult = `<span style="color: #f39c12;">Both ${pm.label} — Clash! No point.</span>`;
            }

            currentRound++;
            phase = 'clash';
            render();
        };

        window._sparMove = (moveId) => {
            if (phase !== 'choose') return;
            resolveClash(moveId);
        };

        window._sparNext = () => {
            if (currentRound >= rounds) return;
            phase = 'choose';
            statusMsg = '';
            render();
            startTimer();
        };

        window._sparFinish = () => {
            cleanup();
            phase = 'result';
            let msgs = [];

            const won = playerScore > opponentScore;
            const tied = playerScore === opponentScore;

            // Combat skill — high chance if won, lower if lost
            const combatChance = won ? (isCapital ? 0.65 : 0.45) :
                                 tied ? (isCapital ? 0.35 : 0.20) :
                                        (isCapital ? 0.20 : 0.10);
            if (Math.random() < combatChance && player.skills) {
                player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
                msgs.push('⚔️ Combat skill improved!');
            } else {
                msgs.push(won ? 'Good fight, but no skill breakthrough.' : 'A humbling lesson.');
            }

            // Strength improvement
            if (Math.random() < (won ? 0.20 : 0.10)) {
                player.strength = (player.strength || 5) + 1;
                msgs.push('💪 Strength increased!');
            }

            // Army XP if player has troops
            if (player.army && player.army.length > 0) {
                const xpGain = isCapital ? 15 : 10;
                const bonus = won ? 5 : 0;
                for (const unit of player.army) {
                    unit.experience = (unit.experience || 0) + xpGain + bonus;
                }
                msgs.push(`🎖️ Army gained ${xpGain + bonus} XP from drills.`);
            }

            statusMsg = msgs.join('\n');
            render();
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Meditate — restore health, gain karma, faith bonus at holy sites
     */
    doMeditate(game, tile) {
        const player = game.player;
        const isHolySite = !!tile.holySite;
        const faithStat = player.faith || 5;
        const intStat = player.intelligence || 5;

        const baseHeal = Math.max(5, 10 + ((faithStat - 3) * 2) + (isHolySite ? 15 : 0));
        const baseKarma = isHolySite ? 5 : 2;

        ActionMenu._showMinigamePrompt(game, {
            title: '🧘 Meditation',
            icon: '🧘',
            description: `Meditate peacefully${isHolySite ? ' at this holy site' : ''}.`,
            baseRewardText: `+${baseHeal} HP, +${baseKarma} karma`,
            onSkip: () => {
                // Base reward: simple instant heal + karma (original pre-minigame behavior)
                player.health = Math.min(player.maxHealth || 100, player.health + baseHeal);
                player.karma = (player.karma || 0) + baseKarma;
                let msg = `Meditated peacefully. +${baseHeal} HP, +${baseKarma} karma.`;
                if (Math.random() < (isHolySite ? 0.35 : 0.1)) {
                    player.faith = (player.faith || 5) + 1;
                    msg += ' Your faith deepened.';
                }
                if (Math.random() < 0.1) {
                    player.intelligence = (player.intelligence || 5) + 1;
                    msg += ' Your mind feels sharper.';
                }
                if (isHolySite) msg += ' The holy site amplified your meditation!';
                game.ui.showNotification('🧘 Meditation', msg, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doMeditateMinigame(game, tile, player, isHolySite, faithStat, intStat); }
        });
    },

    _doMeditateMinigame(game, tile, player, isHolySite, faithStat, intStat) {
        // ── Meditation Minigame: Breathing Focus ──
        // A pulsing circle breathes in and out. Player must click/press at the peak of each breath.
        // Accuracy determines meditation quality.
        const totalBreaths = 8;
        let currentBreath = 0;
        let focusScore = 0; // 0 to totalBreaths (perfect clicks)
        let phase = 'meditating'; // meditating → result
        let breathPhase = 0; // 0 to 2*PI per cycle
        let breathSpeed = 0.04 + (isHolySite ? 0 : 0.01); // holy sites = slightly easier
        let lastClickResult = '';
        let canClick = true;
        let medTimer = null;
        let breathSize = 0; // 0-100, pulsing
        let peakZone = 12 + faithStat * 1.5 + intStat * 0.5; // tolerance window (higher faith = wider sweet spot)
        let distractions = [];
        let distractionTimer = 0;

        // Distraction messages that appear to break focus
        const distractionTexts = [
            '💭 Your mind wanders to gold...',
            '💭 Memories of battle surface...',
            '💭 A bug lands on your nose...',
            '💭 You hear distant laughter...',
            '💭 Your stomach growls...',
            '💭 An itch demands attention...',
            '💭 You think about tomorrow...',
            '💭 Was that a wolf howl?',
        ];

        const render = () => {
            let html = '<div style="max-width: 360px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">🧘 Meditation${isHolySite ? ' (Holy Site)' : ''}</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Faith: ${faithStat} | Intelligence: ${intStat}</p>`;

            if (phase === 'meditating') {
                // Progress
                html += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Breath ${Math.min(currentBreath + 1, totalBreaths)} of ${totalBreaths}</div>`;

                // Focus score dots
                html += '<div style="display: flex; gap: 4px; justify-content: center; margin-bottom: 12px;">';
                for (let i = 0; i < totalBreaths; i++) {
                    let dotColor = 'rgba(255,255,255,0.1)';
                    if (i < currentBreath) {
                        // Check if this breath was scored
                        dotColor = i < focusScore + (currentBreath - focusScore) ? '#2ecc71' : '#e74c3c';
                    }
                    // Actually need to track per-breath results
                    html += `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${i === currentBreath ? 'var(--gold)' : dotColor};"></div>`;
                }
                html += '</div>';

                // Breathing circle
                const circleSize = 40 + breathSize * 1.2; // 40px to 160px
                const isNearPeak = breathSize > (100 - peakZone);
                const circleColor = isNearPeak ? 'rgba(46,204,113,0.3)' : 'rgba(52,152,219,0.15)';
                const borderColor = isNearPeak ? '#2ecc71' : '#3498db';

                html += `<div style="display: flex; align-items: center; justify-content: center; height: 180px;">
                    <div style="width: ${circleSize}px; height: ${circleSize}px; border-radius: 50%;
                        background: ${circleColor}; border: 3px solid ${borderColor};
                        display: flex; align-items: center; justify-content: center; transition: all 0.05s;
                        box-shadow: 0 0 ${breathSize * 0.4}px ${borderColor}40;">
                        <span style="font-size: ${20 + breathSize * 0.2}px;">${breathSize > 50 ? '🌕' : '🌑'}</span>
                    </div>
                </div>`;

                // Vertical indicator bar
                html += `<div style="position: relative; height: 16px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 8px; overflow: hidden;">
                    <div style="position: absolute; right: 0; width: ${peakZone}%; top: 0; bottom: 0; background: rgba(46,204,113,0.15); border-radius: 0 8px 8px 0;"></div>
                    <div style="position: absolute; left: ${breathSize}%; top: 2px; bottom: 2px; width: 4px; background: ${isNearPeak ? '#2ecc71' : '#3498db'}; border-radius: 2px; transition: left 0.05s;"></div>
                </div>`;

                // Distractions
                if (distractions.length > 0) {
                    const latest = distractions[distractions.length - 1];
                    html += `<div style="font-size: 12px; color: #e67e22; font-style: italic; margin-bottom: 4px; opacity: ${Math.max(0, 1 - latest.age * 0.03)};">${latest.text}</div>`;
                }

                if (lastClickResult) {
                    html += `<div style="font-size: 14px; margin-bottom: 6px;">${lastClickResult}</div>`;
                }

                html += `<button onclick="window._meditateBreath()"
                    style="padding: 14px 40px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                           border-radius: 50%; cursor: pointer; color: #3498db; font-size: 14px; font-weight: bold;
                           width: 80px; height: 80px; transition: all 0.15s;"
                    onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                    🧘<br><span style="font-size: 10px;">Exhale</span>
                </button>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Click when the circle is at its fullest. Breathe with the rhythm.</div>`;

            } else {
                // Results
                const scorePercent = focusScore / totalBreaths;
                const baseHeal = 10;
                const faithBonus = (faithStat - 3) * 2;
                const perfBonus = Math.floor(scorePercent * 15);
                const heal = Math.max(5, baseHeal + faithBonus + perfBonus + (isHolySite ? 15 : 0));
                player.health = Math.min(player.maxHealth || 100, player.health + heal);

                const karmaGain = (isHolySite ? 5 : 2) + (scorePercent >= 0.75 ? 2 : 0);
                player.karma = (player.karma || 0) + karmaGain;

                let bonusMsg = '';
                if (Math.random() < (isHolySite ? 0.35 : 0.1) + scorePercent * 0.1) {
                    player.faith = (player.faith || 5) + 1;
                    bonusMsg += ' 🙏 Your faith deepened.';
                }
                if (Math.random() < 0.1 + scorePercent * 0.08) {
                    player.intelligence = (player.intelligence || 5) + 1;
                    bonusMsg += ' 🧠 Your mind feels sharper.';
                }

                const grade = scorePercent >= 0.9 ? 'Perfect Serenity' : scorePercent >= 0.7 ? 'Deep Focus' : scorePercent >= 0.5 ? 'Calm Meditation' : scorePercent >= 0.3 ? 'Distracted Mind' : 'Restless Thoughts';
                const gradeColor = scorePercent >= 0.7 ? '#2ecc71' : scorePercent >= 0.4 ? '#f39c12' : '#e74c3c';

                html += `<div style="font-size: 48px; margin: 12px 0;">🧘</div>`;
                html += `<div style="font-size: 18px; color: ${gradeColor}; font-weight: bold; margin-bottom: 8px;">${grade}</div>`;
                html += `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Focused breaths: ${focusScore}/${totalBreaths}</div>`;

                html += `<div style="text-align: left; padding: 8px 12px; background: rgba(255,255,255,0.04); border-radius: 6px; margin-bottom: 8px;">`;
                html += `<div style="margin-bottom: 4px;">❤️ Healed: <span style="color: #2ecc71;">+${heal} HP</span></div>`;
                html += `<div style="margin-bottom: 4px;">☯️ Karma: <span style="color: #3498db;">+${karmaGain}</span></div>`;
                if (bonusMsg) html += `<div style="color: #f5c542;">${bonusMsg.trim()}</div>`;
                if (isHolySite) html += `<div style="color: #9b59b6; margin-top: 4px;">✨ Holy site amplified your meditation!</div>`;
                html += `</div>`;

                html += `<button data-am-act="closePanelAndEndDay"
                    style="width: 100%; margin-top: 8px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🧘 Meditation', html);
        };

        // Track per-breath results
        const breathResults = [];

        // Animation loop
        medTimer = setInterval(() => {
            if (phase !== 'meditating') { clearInterval(medTimer); return; }

            breathPhase += breathSpeed;
            breathSize = Math.abs(Math.sin(breathPhase)) * 100;

            // Spawn distractions occasionally
            distractionTimer++;
            if (distractionTimer > 40 && Math.random() < 0.04 && !isHolySite) {
                distractions.push({
                    text: distractionTexts[Math.floor(Math.random() * distractionTexts.length)],
                    age: 0
                });
                // Distractions slightly speed up breathing
                breathSpeed = Math.min(0.07, breathSpeed + 0.003);
            }
            for (const d of distractions) d.age++;

            render();
        }, 50);

        // Keyboard support
        const keyHandler = (e) => {
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                window._meditateBreath();
            }
        };
        document.addEventListener('keydown', keyHandler);

        window._meditateBreath = () => {
            if (phase !== 'meditating' || !canClick) return;

            canClick = false;
            setTimeout(() => { canClick = true; }, 300); // debounce

            const isNearPeak = breathSize > (100 - peakZone);

            if (isNearPeak) {
                focusScore++;
                breathResults.push(true);
                lastClickResult = `<span style="color: #2ecc71;">✨ Perfect breath!</span>`;
            } else if (breathSize > (100 - peakZone * 2)) {
                // Close but not perfect — partial credit
                focusScore += 0.5;
                breathResults.push(true);
                lastClickResult = `<span style="color: #f39c12;">~ Close enough</span>`;
            } else {
                breathResults.push(false);
                lastClickResult = `<span style="color: #e74c3c;">✗ Out of rhythm</span>`;
            }

            currentBreath++;
            if (currentBreath >= totalBreaths) {
                phase = 'result';
                focusScore = Math.round(focusScore);
                clearInterval(medTimer);
                document.removeEventListener('keydown', keyHandler);
            }

            render();
        };

        render();
    },

    /**
     * Fish at a water-adjacent tile — yields food items
     */
    doFish(game, tile) {
        const player = game.player;
        const luckStat = player.luck || 5;
        const intStat = player.intelligence || 5;
        const strStat = player.strength || 5;
        const skillBonus = 1 + luckStat * 0.05 + intStat * 0.03;

        // Determine fishing spot quality
        const nearbyTiles = Hex.neighbors(tile.q, tile.r).map(n => game.world.getTile(n.q, n.r)).filter(Boolean);
        // Deep-Sea Nets on one of your ships moored alongside: extra casts and
        // the nets reach deep water from any shore
        const netBonus = Ships.getFishingBonus(player, tile.q, tile.r, game.world);
        const deepWater = netBonus > 0 || nearbyTiles.some(t => ['ocean', 'deep_ocean', 'sea'].includes(t.terrain.id));
        const isCoast = ['coast', 'beach'].includes(tile.terrain.id);

        const depths = [];
        depths.push({ id: 'shallow', label: '🏖️ Shallows', desc: 'Easy catches, smaller fish', color: '#1abc9c' });
        if (isCoast || deepWater) depths.push({ id: 'mid', label: '🌊 Mid Waters', desc: 'Moderate fish, decent value', color: '#3498db' });
        if (deepWater) depths.push({ id: 'deep', label: '🌀 Deep Waters', desc: 'Rare fish, bigger fight', color: '#2c3e50' });

        // Fish table by depth
        const fishByDepth = {
            shallow: [
                { name: 'fish', label: 'Common Fish', icon: '🐟', value: 5, rarity: 'common', color: '#aaa', fight: 2 },
                { name: 'small_fish', label: 'Small Fry', icon: '🐠', value: 2, rarity: 'common', color: '#aaa', fight: 1 },
                { name: 'seaweed', label: 'Seaweed', icon: '🌿', value: 1, rarity: 'junk', color: '#666', fight: 0 },
                { name: 'boot', label: 'Old Boot', icon: '👢', value: 0, rarity: 'junk', color: '#666', fight: 0 },
                { name: 'golden_fish', label: 'Golden Fish', icon: '✨🐟', value: 50, rarity: 'legendary', color: '#f5c542', fight: 5 },
            ],
            mid: [
                { name: 'fish', label: 'Common Fish', icon: '🐟', value: 5, rarity: 'common', color: '#aaa', fight: 2 },
                { name: 'large_fish', label: 'Large Cod', icon: '🐟', value: 8, rarity: 'uncommon', color: '#3498db', fight: 3 },
                { name: 'crab', label: 'Crab', icon: '🦀', value: 12, rarity: 'uncommon', color: '#3498db', fight: 3 },
                { name: 'seaweed', label: 'Seaweed', icon: '🌿', value: 1, rarity: 'junk', color: '#666', fight: 0 },
                { name: 'golden_fish', label: 'Golden Fish', icon: '✨🐟', value: 50, rarity: 'legendary', color: '#f5c542', fight: 6 },
            ],
            deep: [
                { name: 'large_fish', label: 'Large Cod', icon: '🐟', value: 8, rarity: 'uncommon', color: '#3498db', fight: 3 },
                { name: 'crab', label: 'Crab', icon: '🦀', value: 12, rarity: 'uncommon', color: '#3498db', fight: 3 },
                { name: 'swordfish', label: 'Swordfish', icon: '🗡️🐟', value: 25, rarity: 'rare', color: '#9b59b6', fight: 6 },
                { name: 'lobster', label: 'Lobster', icon: '🦞', value: 20, rarity: 'rare', color: '#9b59b6', fight: 5 },
                { name: 'golden_fish', label: 'Golden Fish', icon: '✨🐟', value: 50, rarity: 'legendary', color: '#f5c542', fight: 8 },
            ],
        };

        // Weights by rarity (luck boosts rare/legendary)
        const rarityWeights = {
            junk: 15,
            common: 40,
            uncommon: 25,
            rare: 10 + luckStat * 0.5,
            legendary: 2 + luckStat * 0.4,
        };

        const rollFish = (depth) => {
            const table = fishByDepth[depth] || fishByDepth.shallow;
            const weighted = table.map(f => ({ ...f, w: rarityWeights[f.rarity] || 10 }));
            const total = weighted.reduce((s, f) => s + f.w, 0);
            let r = Math.random() * total;
            for (const f of weighted) {
                r -= f.w;
                if (r <= 0) return { ...f };
            }
            return { ...weighted[0] };
        };

        // ── Game State ──
        let phase = 'depth';    // depth → cast → wait → strike → reel → caught → result
        let chosenDepth = null;
        let castCount = 0;
        const maxCasts = 3 + Math.floor(Math.random() * 2) + netBonus;
        const catches = [];
        let waitTimer = null;
        let biteWindowTimer = null;
        let currentFish = null;

        // Reel mini-game state
        let tension = 50;           // 0-100; ideal is 30-70
        let reelProgress = 0;       // 0-100; reach 100 to land fish
        let fishFightDir = 1;       // fish pulls tension up or down
        let reelInterval = null;
        let reelActionTimeout = null;
        let reeling = false;

        const cleanup = () => {
            if (waitTimer) clearTimeout(waitTimer);
            if (biteWindowTimer) clearTimeout(biteWindowTimer);
            if (reelInterval) clearInterval(reelInterval);
            if (reelActionTimeout) clearTimeout(reelActionTimeout);
        };

        // ── Render ──
        const render = (statusMsg = '') => {
            let html = '<div style="max-width: 500px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">🎣 Fishing</h4>';

            if (phase === 'depth') {
                html += '<p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">Choose where to cast your line.</p>';
                for (const d of depths) {
                    html += `<button onclick="window._fishPickDepth('${d.id}')"
                        style="display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; margin-bottom: 8px;
                               background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid ${d.color};
                               border-radius: 8px; cursor: pointer; text-align: left; color: var(--text-primary); transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
                        <span style="font-size: 24px;">${d.label.split(' ')[0]}</span>
                        <div style="flex: 1;">
                            <div style="font-weight: 600; font-size: 13px;">${d.label}</div>
                            <div style="font-size: 11px; color: var(--text-secondary);">${d.desc}</div>
                        </div>
                        <div style="font-size: 12px; color: ${d.color}; font-weight: 600;">▶</div>
                    </button>`;
                }
                html += `<button data-am-act="closePanel"
                    style="margin-top: 6px; padding: 8px 20px; background: none; border: 1px solid rgba(255,255,255,0.1);
                           border-radius: 6px; cursor: pointer; color: var(--text-secondary); font-size: 12px;">Cancel</button>`;
                html += '</div>';
                return html;
            }

            // Header info
            const depthInfo = depths.find(d => d.id === chosenDepth) || depths[0];
            html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 12px; color: var(--text-secondary);">📍 <span style="color: ${depthInfo.color};">${depthInfo.label}</span></span>
                        <span style="font-size: 12px; color: var(--text-secondary);">Cast ${castCount}/${maxCasts}</span>
                     </div>`;

            // ── Water scene ──
            const waterBg = chosenDepth === 'deep' ? '#0a1628, #0d1e35, #102a47'
                          : chosenDepth === 'mid' ? '#0d2137, #1a4a6b, #1e5577'
                          : '#143a52, #1e5577, #2d7da0';
            html += `<div style="position: relative; height: 150px; background: linear-gradient(180deg, ${waterBg}); border-radius: 10px; overflow: hidden; margin-bottom: 12px; border: 1px solid rgba(100,180,255,0.15);">`;

            // Wave effect
            html += `<div style="position: absolute; top: 0; left: 0; right: 0; height: 20px; background: linear-gradient(180deg, rgba(255,255,255,0.05), transparent);"></div>`;

            if (phase === 'wait') {
                // Bobber on water
                html += `<style>@keyframes fishBob { 0% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, 6px); } 100% { transform: translate(-50%, 0); } }</style>`;
                html += `<div style="position: absolute; top: 30px; left: 50%; font-size: 14px; animation: fishBob 2.5s ease-in-out infinite;">🎣</div>`;
                html += `<div style="position: absolute; top: 8px; left: 50%; width: 1px; height: 24px; background: rgba(255,255,255,0.2); transform: translateX(-50%);"></div>`;
                // Random bubbles
                const bubbles = Math.floor(Math.random() * 4);
                for (let i = 0; i < bubbles; i++) {
                    const bx = 20 + Math.random() * 60;
                    const by = 50 + Math.random() * 40;
                    html += `<div style="position: absolute; left: ${bx}%; top: ${by}%; font-size: 8px; opacity: 0.3;">○</div>`;
                }
            }

            if (phase === 'strike') {
                html += `<style>@keyframes fishBite { 0% { transform: translate(-50%, 0) rotate(-5deg); } 50% { transform: translate(-50%, 12px) rotate(5deg); } 100% { transform: translate(-50%, 0) rotate(-5deg); } }</style>`;
                html += `<div style="position: absolute; top: 25px; left: 50%; font-size: 18px; animation: fishBite 0.2s ease-in-out infinite;">🎣</div>`;
                html += `<div style="position: absolute; top: 10px; left: 50%; width: 2px; height: 18px; background: #f5c542; transform: translateX(-50%);"></div>`;
                // Splash effect
                html += `<div style="position: absolute; top: 40px; left: 42%; font-size: 10px; opacity: 0.6;">💦</div>`;
                html += `<div style="position: absolute; top: 38px; left: 55%; font-size: 8px; opacity: 0.5;">💦</div>`;
            }

            if (phase === 'reel') {
                // Show fish icon fighting
                const fishY = 60 + (1 - reelProgress / 100) * 60;
                const fishShake = Math.random() > 0.5 ? 'rotate(5deg)' : 'rotate(-5deg)';
                html += `<div style="position: absolute; top: 8px; left: 50%; width: 2px; height: ${fishY - 5}px; background: ${tension > 80 ? '#e74c3c' : tension > 60 ? '#f39c12' : '#2ecc71'}; transform: translateX(-50%); transition: height 0.2s;"></div>`;
                html += `<div style="position: absolute; top: ${fishY}px; left: 50%; transform: translate(-50%, 0) ${fishShake}; font-size: 22px; transition: top 0.3s;">${currentFish.icon}</div>`;
                // Surface indicator
                html += `<div style="position: absolute; top: 55px; left: 20%; right: 20%; height: 1px; background: rgba(255,255,255,0.1);"></div>`;
                html += `<div style="position: absolute; top: 48px; left: 20%; font-size: 9px; color: rgba(255,255,255,0.3);">surface ↑</div>`;
            }

            if (phase === 'caught') {
                html += `<div style="position: absolute; top: 30px; left: 50%; transform: translate(-50%, 0); font-size: 36px;">${currentFish.icon}</div>`;
                html += `<div style="position: absolute; top: 75px; left: 50%; transform: translateX(-50%); font-size: 10px; color: rgba(255,255,255,0.4);">💦 💦 💦</div>`;
            }

            if (phase === 'cast' || phase === 'result') {
                html += `<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 28px; opacity: 0.3;">🌊</div>`;
            }

            html += '</div>'; // end water scene

            // Status
            if (statusMsg) {
                html += `<div style="margin-bottom: 10px; font-size: 13px; min-height: 22px;">${statusMsg}</div>`;
            }

            // ── Phase UI ──
            if (phase === 'cast') {
                if (castCount >= maxCasts) {
                    phase = 'result';
                    return render('');
                }
                html += `<button onclick="window._fishCast()"
                    style="padding: 12px 40px; background: linear-gradient(135deg, ${depthInfo.color}, ${depthInfo.color}cc); color: white; border: none; border-radius: 8px; cursor: pointer;
                           font-family: var(--font-display); font-size: 15px; letter-spacing: 1px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); transition: all 0.15s;"
                    onmouseenter="this.style.transform='scale(1.05)'" onmouseleave="this.style.transform='scale(1)'">
                    🎣 Cast Line
                </button>`;

            } else if (phase === 'wait') {
                html += `<div style="font-size: 13px; color: var(--text-secondary);">
                    <span style="display: inline-block; animation: fishBob 1.5s ease-in-out infinite;">Waiting for a bite...</span>
                </div>`;

            } else if (phase === 'strike') {
                html += `<button onclick="window._fishStrike()"
                    style="padding: 16px 56px; background: linear-gradient(135deg, #f39c12, #e67e22); color: white; border: none; border-radius: 10px; cursor: pointer;
                           font-family: var(--font-display); font-size: 18px; letter-spacing: 1px; box-shadow: 0 0 25px rgba(243,156,18,0.5);
                           animation: fishBite 0.2s ease-in-out infinite;">
                    ⚡ STRIKE!
                </button>`;

            } else if (phase === 'reel') {
                // ── Tension meter ──
                const tensionColor = tension > 85 ? '#e74c3c' : tension > 70 ? '#f39c12' : tension < 15 ? '#3498db' : tension < 30 ? '#2ecc71' : '#2ecc71';
                const tensionLabel = tension > 85 ? '🔥 SNAP DANGER!' : tension > 70 ? '⚠️ High tension' : tension < 15 ? '⚠️ Too loose!' : tension < 30 ? '🎯 Careful...' : '✅ Good';
                const tensionLabelColor = tension > 85 ? '#e74c3c' : tension > 70 ? '#f39c12' : tension < 15 ? '#3498db' : '#2ecc71';

                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Line Tension</span>
                        <span style="color: ${tensionLabelColor}; font-weight: 600;">${tensionLabel}</span>
                    </div>
                    <div style="position: relative; height: 20px; background: rgba(255,255,255,0.06); border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <!-- Safe zone markers -->
                        <div style="position: absolute; left: 30%; width: 40%; height: 100%; background: rgba(46,204,113,0.12); border-left: 1px dashed rgba(46,204,113,0.3); border-right: 1px dashed rgba(46,204,113,0.3);"></div>
                        <!-- Danger zones -->
                        <div style="position: absolute; left: 0; width: 15%; height: 100%; background: rgba(52,152,219,0.1);"></div>
                        <div style="position: absolute; right: 0; width: 15%; height: 100%; background: rgba(231,76,60,0.1);"></div>
                        <!-- Tension marker -->
                        <div style="position: absolute; left: ${tension}%; top: 2px; bottom: 2px; width: 6px; background: ${tensionColor}; border-radius: 3px; transform: translateX(-50%); box-shadow: 0 0 8px ${tensionColor}; transition: left 0.15s;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); margin-top: 2px;">
                        <span>Too loose</span>
                        <span style="color: rgba(46,204,113,0.6);">Sweet spot</span>
                        <span>Line breaks!</span>
                    </div>
                </div>`;

                // ── Progress bar ──
                const progColor = reelProgress > 70 ? '#2ecc71' : reelProgress > 40 ? '#f39c12' : '#3498db';
                html += `<div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Reel Progress</span>
                        <span style="color: ${progColor};">${Math.round(reelProgress)}%</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${reelProgress}%; height: 100%; background: ${progColor}; transition: width 0.2s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                // ── Reel / Slack buttons ──
                html += `<div style="display: flex; gap: 10px; justify-content: center;">
                    <button onmousedown="window._fishSlack()" ontouchstart="window._fishSlack()"
                        style="padding: 12px 24px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: #3498db; font-size: 14px; font-weight: bold; transition: all 0.1s; user-select: none;"
                        onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        🔽 Give Slack
                    </button>
                    <button onmousedown="window._fishReelIn()" ontouchstart="window._fishReelIn()"
                        style="padding: 12px 28px; background: rgba(46,204,113,0.15); border: 2px solid #2ecc71;
                               border-radius: 8px; cursor: pointer; color: #2ecc71; font-size: 14px; font-weight: bold; transition: all 0.1s; user-select: none;"
                        onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                        🔼 Reel In!
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Reel to land the fish — but keep tension in the green zone!</div>`;

            } else if (phase === 'caught') {
                const rarityGlow = currentFish.rarity === 'legendary' ? 'text-shadow: 0 0 15px #f5c542;' : currentFish.rarity === 'rare' ? 'text-shadow: 0 0 10px #9b59b6;' : '';
                html += `<div style="font-size: 16px; color: ${currentFish.color}; font-weight: bold; ${rarityGlow} margin-bottom: 4px;">🎉 Caught: ${currentFish.icon} ${currentFish.label}!</div>`;
                html += `<div style="font-size: 13px; color: var(--text-secondary);">${currentFish.rarity === 'legendary' ? '★ Legendary catch!' : currentFish.rarity === 'rare' ? '◆ Rare find!' : currentFish.rarity === 'junk' ? 'Well... it\'s something.' : 'A decent catch.'}</div>`;
                html += `<div style="font-size: 12px; color: var(--gold); margin-top: 4px;">${currentFish.value > 0 ? `Worth ~${currentFish.value}g` : 'Worthless'}</div>`;

            } else if (phase === 'result') {
                html += ActionMenu._renderFishingResults(catches, player);
            }

            // Catch tally
            if (catches.length > 0 && phase !== 'result') {
                html += `<div style="margin-top: 14px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">Today's catch:</div>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;">`;
                for (const c of catches) {
                    html += `<span style="font-size: 11px; padding: 2px 8px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 2px solid ${c.color};">${c.icon} ${c.label}</span>`;
                }
                html += '</div></div>';
            }

            html += '</div>';
            return html;
        };

        game.ui.showCustomPanel('🎣 Fishing', render());

        // ── Depth selection ──
        window._fishPickDepth = (depthId) => {
            chosenDepth = depthId;

            ActionMenu._showMinigamePrompt(game, {
                title: '🎣 Fishing',
                icon: '🎣',
                description: `Cast your line into the ${depthId === 'deep' ? 'deep waters' : depthId === 'mid' ? 'mid waters' : 'shallows'}.`,
                baseRewardText: '1-2 basic catches',
                onSkip: () => {
                    // Base reward: 1-2 simple fish rolls
                    const catches = 1 + (Math.random() < 0.4 ? 1 : 0);
                    let totalVal = 0;
                    let msg = 'Quick fishing trip — ';
                    const items = [];
                    for (let i = 0; i < catches; i++) {
                        const fish = rollFish(depthId);
                        if (fish && fish.name && fish.value > 0) {
                            if (!PlayerInventory.addItem(player, fish.name, 1).success) continue;
                            totalVal += fish.value;
                            items.push(`${fish.icon} ${fish.label}`);
                        }
                    }
                    if (items.length > 0) {
                        msg += `caught ${items.join(', ')} (~${totalVal}g).`;
                    } else {
                        msg += 'nothing biting today.';
                    }
                    if (Math.random() < 0.08) {
                        player.luck = (player.luck || 5) + 1;
                        msg += ' 🍀 Luck increased!';
                    }
                    game.ui.showNotification('🎣 Fishing', msg, items.length > 0 ? 'success' : 'default');
                    game.ui.updateStats(player, game.world);
                    game.endDay();
                },
                onPlay: () => {
                    phase = 'cast';
                    game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: var(--text-muted);">Ready to cast!</span>'));
                }
            });
        };

        // ── Cast ──
        window._fishCast = () => {
            if (castCount >= maxCasts) return;
            castCount++;
            phase = 'wait';
            game.ui.showCustomPanel('🎣 Fishing', render(''));

            // Wait for bite: 1.5-4 seconds
            const waitTime = 1500 + Math.random() * 2500;
            waitTimer = setTimeout(() => {
                // Bite chance
                const biteChance = 0.65 + luckStat * 0.03;
                if (Math.random() > biteChance) {
                    phase = 'cast';
                    game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: var(--text-muted);">Nothing biting... the waters are quiet.</span>'));
                    return;
                }

                phase = 'strike';
                currentFish = rollFish(chosenDepth);
                game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: #f5c542; font-weight: bold;">🔔 Something\'s on the line!</span>'));

                // Strike window — 1.8 seconds (luck extends slightly)
                const strikeWindow = 1400 + luckStat * 50;
                biteWindowTimer = setTimeout(() => {
                    if (phase === 'strike') {
                        phase = 'cast';
                        currentFish = null;
                        game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: #e74c3c;">❌ Too slow! The fish got away.</span>'));
                    }
                }, strikeWindow);
            }, waitTime);
        };

        // ── Strike ──
        window._fishStrike = () => {
            if (phase !== 'strike') return;
            clearTimeout(biteWindowTimer);

            // Junk goes straight to caught
            if (currentFish.rarity === 'junk') {
                catches.push(currentFish);
                phase = 'caught';
                game.ui.showCustomPanel('🎣 Fishing', render(''));
                setTimeout(() => {
                    phase = 'cast';
                    currentFish = null;
                    game.ui.showCustomPanel('🎣 Fishing', render(''));
                }, 1500);
                return;
            }

            // Start reel phase
            phase = 'reel';
            tension = 50;
            reelProgress = 0;
            reeling = false;

            const fishFight = currentFish.fight || 3;

            game.ui.showCustomPanel('🎣 Fishing', render('<span style="color: #2ecc71;">🎣 Hooked! Reel it in — manage your line tension!</span>'));

            // Fish AI: fights by changing tension + pulling back progress
            reelInterval = setInterval(() => {
                if (phase !== 'reel') { clearInterval(reelInterval); return; }

                // Fish erratically fights: pushes tension around
                if (Math.random() < 0.6) {
                    fishFightDir = Math.random() < 0.5 ? 1 : -1;
                }
                const fightStrength = fishFight * (0.5 + Math.random() * 0.8);
                tension += fishFightDir * fightStrength;

                // Fish pulls back progress slightly
                const pullBack = fishFight * 0.3 * Math.random();
                reelProgress = Math.max(0, reelProgress - pullBack);

                // Natural tension drift toward center
                tension += (50 - tension) * 0.02;

                tension = Math.max(0, Math.min(100, tension));

                // ── Check fail conditions ──
                if (tension >= 95) {
                    // Line snaps!
                    clearInterval(reelInterval);
                    phase = 'cast';
                    const msg = `<span style="color: #e74c3c;">💥 The line snapped! The ${currentFish.label} got away!</span>`;
                    currentFish = null;
                    game.ui.showCustomPanel('🎣 Fishing', render(msg));
                    return;
                }
                if (tension <= 5 && reelProgress < 30) {
                    // Line too loose — fish spits the hook
                    clearInterval(reelInterval);
                    phase = 'cast';
                    const msg = `<span style="color: #3498db;">💨 Too much slack! The ${currentFish.label} spit the hook!</span>`;
                    currentFish = null;
                    game.ui.showCustomPanel('🎣 Fishing', render(msg));
                    return;
                }

                // ── Check win ──
                if (reelProgress >= 100) {
                    clearInterval(reelInterval);
                    catches.push(currentFish);
                    phase = 'caught';
                    game.ui.showCustomPanel('🎣 Fishing', render(''));
                    setTimeout(() => {
                        phase = 'cast';
                        currentFish = null;
                        game.ui.showCustomPanel('🎣 Fishing', render(''));
                    }, 1800);
                    return;
                }

                game.ui.showCustomPanel('🎣 Fishing', render(''));
            }, 350);
        };

        // ── Check win/fail inline (called after player input) ──
        const checkReelResult = () => {
            if (phase !== 'reel') return;
            if (reelProgress >= 100) {
                clearInterval(reelInterval);
                catches.push(currentFish);
                phase = 'caught';
                game.ui.showCustomPanel('🎣 Fishing', render(''));
                setTimeout(() => {
                    phase = 'cast';
                    currentFish = null;
                    game.ui.showCustomPanel('🎣 Fishing', render(''));
                }, 1800);
            }
        };

        // ── Reel In ──
        window._fishReelIn = () => {
            if (phase !== 'reel') return;
            // Reeling adds progress but increases tension
            const strBonus = 1 + strStat * 0.08;
            reelProgress = Math.min(100, reelProgress + 3.5 * strBonus);
            tension = Math.min(100, tension + 6 + (currentFish.fight || 3) * 0.8);
            checkReelResult();
        };

        // ── Give Slack ──
        window._fishSlack = () => {
            if (phase !== 'reel') return;
            // Reduces tension but fish pulls back progress
            tension = Math.max(0, tension - 12);
            reelProgress = Math.max(0, reelProgress - 2);
        };
    },

    /**
     * Render final fishing results and add to inventory
     */
    _renderFishingResults(catches, player) {
        let html = '<div style="text-align: left; padding: 8px;">';
        html += '<h4 style="margin: 0 0 12px; text-align: center;">🎣 Day\'s Catch</h4>';

        if (catches.length === 0) {
            html += '<p style="color: var(--text-muted); text-align: center;">Nothing caught today. The fish outsmarted you!</p>';
        } else {
            // Consolidate
            const totals = {};
            for (const c of catches) {
                if (!totals[c.name]) totals[c.name] = { ...c, qty: 0 };
                totals[c.name].qty++;
            }

            let totalValue = 0;
            for (const [key, item] of Object.entries(totals)) {
                if (!PlayerInventory.addItem(player, key, item.qty).success) {
                    html += `<div style="padding: 6px 8px; margin-bottom: 4px; color: #ff9800;">🎒 Packs full — released ${item.icon} ${item.label} ×${item.qty}</div>`;
                    continue;
                }
                totalValue += item.value * item.qty;
                const rarityLabel = item.rarity === 'legendary' ? ' ★' : item.rarity === 'rare' ? ' ◆' : '';
                html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; margin-bottom: 4px; background: rgba(255,255,255,0.03); border-radius: 4px; border-left: 3px solid ${item.color};">
                            <span>${item.icon} ${item.label}${rarityLabel} <span style="color: var(--text-muted);">×${item.qty}</span></span>
                            <span style="color: var(--gold); font-weight: bold;">${item.value > 0 ? `${item.value * item.qty}g` : '—'}</span>
                         </div>`;
            }

            html += `<div style="text-align: center; margin-top: 12px; padding: 8px; background: rgba(245,197,66,0.08); border-radius: 6px; border: 1px solid rgba(245,197,66,0.15);">
                        <span style="color: var(--gold); font-size: 14px; font-weight: bold;">Total value: ${totalValue} gold</span>
                     </div>`;
        }

        // Luck chance
        if (Math.random() < 0.08) {
            player.luck = (player.luck || 5) + 1;
            html += '<div style="color: #88f; margin-top: 8px; text-align: center; font-size: 12px;">🍀 Your patience improved your luck!</div>';
        }

        html += `<button data-am-act="closePanelAndEndDay"
                    style="width: 100%; margin-top: 14px; padding: 12px; background: linear-gradient(135deg, var(--gold), #d4a030); color: #1a1a2e; border: none; border-radius: 6px; cursor: pointer;
                           font-family: var(--font-display); font-size: 14px; font-weight: bold; letter-spacing: 1px;">
                    Done Fishing
                 </button>`;
        html += '</div>';
        return html;
    },

    /**
     * Prospect for minerals on hills/highlands/mountain tiles
     */
    doProspect(game, tile) {
        const player = game.player;
        const terrainId = tile.terrain?.id || '';
        const strengthStat = player.strength || 5;
        const luckStat = player.luck || 5;

        const difficultyMod = {
            hills: 1.0, highlands: 1.2, mountain: 1.5, volcanic_mountain: 1.8
        }[terrainId] || 1.0;

        ActionMenu._showMinigamePrompt(game, {
            title: '⛏️ Prospecting',
            icon: '⛏️',
            description: 'Drill into the earth to find valuable minerals.',
            baseRewardText: '1 basic mineral (stone or ore)',
            onSkip: () => {
                // Base reward: 1 basic mineral
                const roll = Math.random();
                let type, label, icon, value;
                // Deep Mining: a trained eye spots gem seams
                const gemChance = Technology.getEffectTotal(player, 'gemDiscoveryChance');
                if (gemChance > 0 && Utils.random() < gemChance) { type = 'gems'; label = 'Gemstones'; icon = '💎'; value = 80; }
                else if (roll < 0.55) { type = 'stone'; label = 'Stone'; icon = '⛰️'; value = 8; }
                else if (roll < 0.85) { type = 'ore'; label = 'Iron Ore'; icon = '⛏️'; value = 25; }
                else if (roll < 0.95) { type = 'fossil'; label = 'Fossil'; icon = '🦴'; value = 35; }
                else { type = 'crystal'; label = 'Crystal'; icon = '🔮'; value = 50; }
                if (!PlayerInventory.addItem(player, type, 1).success) {
                    game.ui.showNotification('🎒 Inventory Full', PlayerInventory.fullMessage(player), 'warning');
                    return;
                }
                const hpCost = 2;
                player.health = Math.max(1, player.health - hpCost);
                if (Math.random() < 0.12) { player.strength = (player.strength || 5) + 1; }
                game.ui.showNotification('⛏️ Prospecting', `Quick dig — found ${icon} ${label} (~${value}g). -${hpCost} HP.`, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doProspectMinigame(game, tile, player, terrainId, strengthStat, luckStat, difficultyMod); }
        });
    },

    _doProspectMinigame(game, tile, player, terrainId, strengthStat, luckStat, difficultyMod) {
        // ── Prospecting Minigame: Depth Drilling with vein scanner ──
        const maxDepth = 8;
        let currentDepth = 0;
        let drillHP = 100; // drill durability
        let stamina = 100; // player stamina for drilling
        let finds = [];
        let totalValue = 0;
        let phase = 'drilling'; // drilling → result
        let statusMsg = '';
        let healthCost = 0;
        let scanResult = '';
        let scansLeft = 2 + Math.floor(luckStat / 3);

        const itemData = {
            gems:    { label: 'Gemstones', icon: '💎', value: 80 },
            ore:     { label: 'Iron Ore',  icon: '⛏️', value: 25 },
            stone:   { label: 'Stone',     icon: '⛰️', value: 8 },
            fossil:  { label: 'Fossil',    icon: '🦴', value: 35 },
            crystal: { label: 'Crystal',   icon: '🔮', value: 50 },
        };

        // Generate what's at each depth
        const gemChance = Technology.getEffectTotal(player, 'gemDiscoveryChance');
        const layers = [];
        for (let d = 0; d < maxDepth; d++) {
            const depthBonus = d * 0.06 * (luckStat / 5);
            const roll = Math.random();
            let type = 'rock';
            if (roll < 0.03 + depthBonus * 0.5) type = 'gems';
            else if (roll < 0.10 + depthBonus * 1.5) type = 'crystal';
            else if (roll < 0.22 + depthBonus * 2) type = 'ore';
            else if (roll < 0.35 + depthBonus) type = 'fossil';
            else if (roll < 0.55 + depthBonus) type = 'stone';
            // Deep Mining: a trained eye spots gem seams in otherwise barren rock
            if (type === 'rock' && gemChance > 0 && Utils.random() < gemChance) type = 'gems';
            // Add hazards at deeper levels
            const hasHazard = d >= 3 && Math.random() < 0.2 + d * 0.05;
            layers.push({ type, hasHazard, extracted: false });
        }

        const getLayerColor = (type) => {
            switch(type) {
                case 'gems': return '#9b59b6';
                case 'crystal': return '#8e44ad';
                case 'ore': return '#3498db';
                case 'fossil': return '#f39c12';
                case 'stone': return '#95a5a6';
                default: return '#8b6914';
            }
        };

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += '<h4 style="margin: 0 0 4px;">⛏️ Prospecting</h4>';
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">Terrain: ${terrainId} (x${difficultyMod}) | Str: ${strengthStat} | Luck: ${luckStat}</p>`;

            if (phase === 'drilling') {
                // Status bars
                html += `<div style="display: flex; gap: 12px; margin-bottom: 10px;">
                    <div style="flex: 1;">
                        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px;">⛏️ Drill HP</div>
                        <div style="background: rgba(255,255,255,0.06); border-radius: 4px; height: 10px; overflow: hidden;">
                            <div style="width: ${drillHP}%; height: 100%; background: ${drillHP > 30 ? '#3498db' : '#e74c3c'}; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px;">💪 Stamina</div>
                        <div style="background: rgba(255,255,255,0.06); border-radius: 4px; height: 10px; overflow: hidden;">
                            <div style="width: ${stamina}%; height: 100%; background: ${stamina > 30 ? '#2ecc71' : '#e74c3c'}; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                    </div>
                </div>`;

                html += `<div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 8px;">
                    <span>💰 Found: <span style="color: var(--gold);">${totalValue}g</span></span>
                    <span>🔍 Scans: ${scansLeft}</span>
                </div>`;

                // Depth column — vertical drill shaft
                html += '<div style="display: flex; gap: 6px; align-items: stretch;">';

                // Depth labels
                html += '<div style="display: flex; flex-direction: column; gap: 2px; margin-right: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    html += `<div style="height: 42px; display: flex; align-items: center; font-size: 9px; color: var(--text-muted);">
                        ${d + 1}m
                    </div>`;
                }
                html += '</div>';

                // Shaft
                html += '<div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    const layer = layers[d];
                    const isCurrent = d === currentDepth;
                    const isPast = d < currentDepth;
                    const darkness = 0.06 + d * 0.03;

                    if (isPast) {
                        // Already drilled through
                        const col = layer.extracted ? 'rgba(46,204,113,0.1)' : 'rgba(255,255,255,0.02)';
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: ${col}; border: 1px solid rgba(255,255,255,0.04); font-size: 12px; color: var(--text-muted);">
                            ${layer.extracted ? (itemData[layer.type]?.icon || '✓') : '▪️'} ${layer.extracted ? itemData[layer.type]?.label || '' : 'empty'}
                        </div>`;
                    } else if (isCurrent) {
                        // Current depth — drill head
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: rgba(243,156,18,0.15); border: 2px solid var(--gold); font-size: 18px;
                            box-shadow: 0 0 12px rgba(243,156,18,0.2);">
                            ⛏️ <span style="font-size: 11px; margin-left: 6px; color: var(--gold);">DRILL HERE</span>
                        </div>`;
                    } else {
                        // Future depth — hidden
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: rgba(139,90,43,${darkness}); border: 1px solid rgba(255,255,255,0.04); font-size: 14px; color: rgba(255,255,255,0.15);">
                            ???
                        </div>`;
                    }
                }
                html += '</div>';

                // Scan results sidebar
                html += '<div style="width: 80px; display: flex; flex-direction: column; gap: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    const layer = layers[d];
                    if (layer.scanned) {
                        const col = getLayerColor(layer.type);
                        html += `<div style="height: 42px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                            background: rgba(${col === '#9b59b6' ? '155,89,182' : col === '#3498db' ? '52,152,219' : col === '#f39c12' ? '243,156,18' : col === '#95a5a6' ? '149,165,166' : '142,68,173'},0.15);
                            border: 1px solid ${col}40; font-size: 9px; color: ${col};">
                            ${layer.hasHazard ? '⚠️' : ''} ${itemData[layer.type]?.icon || '⛰️'}
                        </div>`;
                    } else {
                        html += `<div style="height: 42px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                            background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); font-size: 9px; color: var(--text-muted);">
                            ?
                        </div>`;
                    }
                }
                html += '</div>';

                html += '</div>';

                if (statusMsg) html += `<div style="margin-top: 8px; font-size: 12px;">${statusMsg}</div>`;
                if (scanResult) html += `<div style="margin-top: 4px; font-size: 11px; color: var(--text-muted);">${scanResult}</div>`;

                // Action buttons
                html += `<div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px;">
                    <button onclick="window._prospectDrill()"
                        style="padding: 10px 24px; background: rgba(243,156,18,0.15); border: 2px solid var(--gold);
                               border-radius: 8px; cursor: pointer; color: var(--gold); font-size: 13px; font-weight: bold; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(243,156,18,0.25)'" onmouseleave="this.style.background='rgba(243,156,18,0.15)'">
                        ⛏️ Drill Down
                    </button>
                    <button onclick="window._prospectScan()" ${scansLeft <= 0 ? 'disabled' : ''}
                        style="padding: 10px 20px; background: rgba(52,152,219,0.15); border: 2px solid #3498db;
                               border-radius: 8px; cursor: pointer; color: #3498db; font-size: 13px; font-weight: bold; transition: all 0.15s;
                               ${scansLeft <= 0 ? 'opacity: 0.4; cursor: default;' : ''}"
                        onmouseenter="this.style.background='rgba(52,152,219,0.25)'" onmouseleave="this.style.background='rgba(52,152,219,0.15)'">
                        🔍 Scan (${scansLeft})
                    </button>
                    <button onclick="window._prospectStop()"
                        style="padding: 10px 16px; background: none; border: 1px solid rgba(255,255,255,0.1);
                               border-radius: 8px; cursor: pointer; color: var(--text-muted); font-size: 12px;">
                        Stop
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Drill deeper for rare minerals! Scan to see what's ahead.</div>`;

            } else {
                // Results
                html += `<div style="font-size: 48px; margin: 8px 0;">⛏️</div>`;
                if (finds.length > 0) {
                    html += `<div style="font-size: 16px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Prospecting Haul</div>`;
                    const totals = {};
                    for (const f of finds) {
                        if (!totals[f.type]) totals[f.type] = { ...itemData[f.type], qty: 0 };
                        totals[f.type].qty++;
                    }
                    for (const [key, item] of Object.entries(totals)) {
                        if (!PlayerInventory.addItem(player, key, item.qty).success) {
                            html += `<div style="padding: 6px 12px; margin-bottom: 4px; color: #ff9800;">🎒 Packs full — left behind ${item.icon} ${item.label} x${item.qty}</div>`;
                            continue;
                        }
                        html += `<div style="padding: 6px 12px; margin-bottom: 4px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between;">
                            <div>${item.icon} ${item.label} x${item.qty}</div>
                            <div style="color: var(--gold);">${item.value * item.qty}g</div>
                        </div>`;
                    }
                    html += `<div style="margin-top: 8px; padding: 8px; background: rgba(245,197,66,0.1); border-radius: 4px; font-weight: bold; color: var(--gold);">Total Value: ~${totalValue} gold</div>`;
                } else {
                    html += `<div style="font-size: 16px; color: #f39c12; margin-bottom: 8px;">Slim Pickings</div>`;
                    html += `<div style="color: var(--text-secondary);">Nothing valuable found.</div>`;
                }
                html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Reached depth: ${currentDepth}m</div>`;
                if (healthCost > 0) html += `<div style="color: #f88; margin-top: 4px;">Hard work cost ${healthCost} HP.</div>`;
                if (statusMsg) html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${statusMsg}</div>`;
                html += `<button data-am-act="closePanelAndEndDay"
                    style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('⛏️ Prospecting', html);
        };

        render();

        window._prospectDrill = () => {
            if (phase !== 'drilling' || currentDepth >= maxDepth) return;

            const layer = layers[currentDepth];
            const staminaCost = 8 + currentDepth * 2 + Math.floor(difficultyMod * 3);
            const drillDmg = 5 + currentDepth * 3 + (layer.hasHazard ? 15 : 0);

            stamina = Math.max(0, stamina - staminaCost + strengthStat * 0.8);
            drillHP = Math.max(0, drillHP - drillDmg);

            // Health cost
            const hpCost = currentDepth >= 4 ? 2 : 1;
            healthCost += hpCost;
            player.health = Math.max(1, player.health - hpCost);

            // Extract any mineral
            if (layer.type !== 'rock') {
                layer.extracted = true;
                const data = itemData[layer.type];
                finds.push({ type: layer.type });
                totalValue += data.value;
                statusMsg = `<span style="color: #2ecc71;">Found ${data.icon} ${data.label}!</span>`;
            } else {
                statusMsg = `<span style="color: var(--text-muted);">Just rock...</span>`;
            }

            if (layer.hasHazard) {
                const extraDmg = Math.floor(Math.random() * 6) + 3;
                healthCost += extraDmg;
                player.health = Math.max(1, player.health - extraDmg);
                statusMsg += ` <span style="color: #e74c3c;">⚠️ Cave-in! -${extraDmg} HP</span>`;
            }

            currentDepth++;

            // Check end conditions
            if (stamina <= 0 || drillHP <= 0 || currentDepth >= maxDepth) {
                phase = 'result';
                if (stamina <= 0) statusMsg = 'Too exhausted to continue.';
                else if (drillHP <= 0) statusMsg = 'Your pick broke!';
                else statusMsg = 'You reached the bottom of the shaft!';

                if (Math.random() < 0.12) {
                    player.strength = (player.strength || 5) + 1;
                    statusMsg += ' 💪 The hard labor strengthened you!';
                }
            }

            render();
            game.ui.updateStats(player, game.world);
        };

        window._prospectScan = () => {
            if (phase !== 'drilling' || scansLeft <= 0) return;
            scansLeft--;

            // Reveal 2-3 upcoming layers
            const scanRange = 2 + (luckStat >= 7 ? 1 : 0);
            let scannedInfo = [];
            for (let d = currentDepth; d < Math.min(maxDepth, currentDepth + scanRange); d++) {
                layers[d].scanned = true;
                const data = itemData[layers[d].type];
                if (data) scannedInfo.push(`${data.icon} ${data.label} at ${d + 1}m`);
                else scannedInfo.push(`⛰️ Rock at ${d + 1}m`);
                if (layers[d].hasHazard) scannedInfo[scannedInfo.length - 1] += ' ⚠️';
            }
            scanResult = `🔍 Scan: ${scannedInfo.join(', ')}`;
            render();
        };

        window._prospectStop = () => {
            phase = 'result';
            if (Math.random() < 0.12) {
                player.strength = (player.strength || 5) + 1;
                statusMsg = '💪 The hard labor strengthened you!';
            }
            render();
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Tame a wild horse — requires horse resource on tile
     */
    doTameHorse(game, tile) {
        const player = game.player;
        const strengthStat = player.strength || 5;
        const luckStat = player.luck || 5;

        if (!PlayerInventory.canAdd(player, 'horse')) {
            game.ui.showNotification('🐴 No Room', `You have nowhere to keep a horse. ${PlayerInventory.fullMessage(player)}`, 'warning');
            return;
        }

        ActionMenu._showMinigamePrompt(game, {
            title: '🐴 Tame Horse',
            icon: '🐴',
            description: 'Approach and calm a wild horse to tame it.',
            baseRewardText: '~40% chance of success',
            onSkip: () => {
                // Base reward: simple chance roll
                const chance = 0.35 + luckStat * 0.02 + strengthStat * 0.01;
                if (Math.random() < chance && PlayerInventory.addItem(player, 'horse', 1).success) {
                    player.maxStamina = (player.maxStamina || 10) + 2;
                    if (Math.random() < 0.2) player.strength = (player.strength || 5) + 1;
                    game.ui.showNotification('🐴 Horse Tamed!', 'You patiently calmed the horse. +1 Horse, +2 Max Stamina.', 'success');
                } else {
                    game.ui.showNotification('🐴 Horse Fled', 'The horse bolted before you could approach.', 'default');
                }
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doTameHorseMinigame(game, tile, player, strengthStat, luckStat); }
        });
    },

    _doTameHorseMinigame(game, tile, player, strengthStat, luckStat) {
        // ── Horse Taming Minigame: Calm & Hold ──
        let calmness = 50;   // 0-100, need to keep in sweet spot (40-70) and hold
        let holdTimer = 0;   // seconds held in calm zone — need 3 to succeed
        const holdTarget = 3.0;
        let phase = 'taming'; // taming → result
        let tameResult = null; // 'success' | 'bolted' | 'kicked'
        let statusMsg = '';
        let gameInterval = null;
        let horseMood = 'nervous'; // nervous | calm | panicked
        let horseAction = '';
        let actionCooldown = 0;

        const cleanup = () => {
            if (gameInterval) { clearInterval(gameInterval); gameInterval = null; }
        };

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += `<h4 style="margin: 0 0 4px;">🐴 Taming a Wild Horse</h4>`;
            html += `<p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px;">Strength: ${strengthStat} | Luck: ${luckStat}</p>`;

            if (phase === 'taming') {
                // Horse visual
                const horseAnim = horseMood === 'panicked' ? '🐎💨' : horseMood === 'calm' ? '🐴✨' : '🐴';
                html += `<div style="font-size: 48px; margin: 8px 0; transition: all 0.3s;">${horseAnim}</div>`;
                if (horseAction) html += `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">${horseAction}</div>`;

                // Calmness meter with sweet-spot zone
                const calmnessColor = (calmness >= 40 && calmness <= 70) ? '#2ecc71' : calmness > 85 ? '#3498db' : '#e74c3c';
                const moodLabel = horseMood === 'panicked' ? '😱 Panicking!' : horseMood === 'calm' ? '😌 Calm' : '😰 Nervous';
                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Horse Calmness</span>
                        <span style="color: ${calmnessColor}; font-weight: 600;">${moodLabel}</span>
                    </div>
                    <div style="position: relative; height: 22px; background: rgba(255,255,255,0.06); border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <!-- Sweet zone -->
                        <div style="position: absolute; left: 40%; width: 30%; height: 100%; background: rgba(46,204,113,0.12); border-left: 2px dashed rgba(46,204,113,0.4); border-right: 2px dashed rgba(46,204,113,0.4);"></div>
                        <!-- Calmness marker -->
                        <div style="position: absolute; left: ${calmness}%; top: 2px; bottom: 2px; width: 8px; background: ${calmnessColor}; border-radius: 4px; transform: translateX(-50%); box-shadow: 0 0 8px ${calmnessColor}; transition: left 0.15s;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); margin-top: 2px;">
                        <span>Wild</span>
                        <span style="color: rgba(46,204,113,0.6);">Sweet spot</span>
                        <span>Sleepy</span>
                    </div>
                </div>`;

                // Hold progress
                const holdPct = Math.min(100, (holdTimer / holdTarget) * 100);
                html += `<div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: var(--text-muted);">Trust (hold in sweet spot)</span>
                        <span style="color: var(--gold);">${holdPct.toFixed(0)}%</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.06); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                        <div style="width: ${holdPct}%; height: 100%; background: var(--gold); transition: width 0.2s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                // Control buttons
                html += `<div style="display: flex; gap: 10px; justify-content: center;">
                    <button onmousedown="window._tameCalm()" ontouchstart="window._tameCalm()"
                        style="padding: 14px 24px; background: rgba(46,204,113,0.15); border: 2px solid #2ecc71;
                               border-radius: 10px; cursor: pointer; color: #2ecc71; font-size: 14px; font-weight: bold; user-select: none; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(46,204,113,0.25)'" onmouseleave="this.style.background='rgba(46,204,113,0.15)'">
                        🤲 Soothe
                    </button>
                    <button onmousedown="window._tameFeed()" ontouchstart="window._tameFeed()"
                        style="padding: 14px 24px; background: rgba(243,156,18,0.15); border: 2px solid #f39c12;
                               border-radius: 10px; cursor: pointer; color: #f39c12; font-size: 14px; font-weight: bold; user-select: none; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(243,156,18,0.25)'" onmouseleave="this.style.background='rgba(243,156,18,0.15)'">
                        🥕 Offer Food
                    </button>
                    <button onmousedown="window._tameGrip()" ontouchstart="window._tameGrip()"
                        style="padding: 14px 24px; background: rgba(155,89,182,0.15); border: 2px solid #9b59b6;
                               border-radius: 10px; cursor: pointer; color: #9b59b6; font-size: 14px; font-weight: bold; user-select: none; transition: all 0.15s;"
                        onmouseenter="this.style.background='rgba(155,89,182,0.25)'" onmouseleave="this.style.background='rgba(155,89,182,0.15)'">
                        ✊ Firm Grip
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Keep the horse in the green sweet spot and build trust!</div>`;

            } else {
                // Results
                if (tameResult === 'success') {
                    html += `<div style="font-size: 56px; margin: 12px 0;">🐴✨</div>`;
                    html += `<div style="font-size: 18px; color: #2ecc71; font-weight: bold; margin-bottom: 8px;">Horse Tamed!</div>`;
                    html += `<div style="padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-bottom: 6px;">🐴 +1 Horse added to inventory</div>`;
                    html += `<div style="padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">⚡ +2 Max Stamina (mount bonus)</div>`;
                    if (statusMsg) html += `<div style="font-size: 12px; color: #88f; margin-top: 6px;">${statusMsg}</div>`;
                } else if (tameResult === 'bolted') {
                    html += `<div style="font-size: 56px; margin: 12px 0;">🐎💨</div>`;
                    html += `<div style="font-size: 18px; color: #f39c12; font-weight: bold; margin-bottom: 8px;">The Horse Bolted!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg || 'It broke free and disappeared into the wild.'}</div>`;
                } else if (tameResult === 'kicked') {
                    html += `<div style="font-size: 56px; margin: 12px 0;">🦵💥</div>`;
                    html += `<div style="font-size: 18px; color: #e74c3c; font-weight: bold; margin-bottom: 8px;">Kicked!</div>`;
                    html += `<div style="font-size: 13px; color: var(--text-secondary);">${statusMsg}</div>`;
                }
                html += `<button data-am-act="closePanelAndEndDay"
                    style="width: 100%; margin-top: 12px; padding: 10px; background: var(--gold); border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Continue</button>`;
            }

            html += '</div>';
            game.ui.showCustomPanel('🐴 Horse Taming', html);
        };

        render();

        // Game loop — horse naturally gets restless
        gameInterval = setInterval(() => {
            if (phase !== 'taming') return;

            // Horse naturally drifts (gets nervous)
            const drift = (Math.random() - 0.45) * (8 - strengthStat * 0.3);
            calmness = Math.max(0, Math.min(100, calmness + drift));

            // Random horse actions
            actionCooldown--;
            if (actionCooldown <= 0 && Math.random() < 0.25) {
                const actions = [
                    { text: 'The horse snorts nervously...', effect: -8 },
                    { text: 'The horse stamps its hooves!', effect: -12 },
                    { text: 'The horse nickers softly...', effect: 5 },
                    { text: 'The horse tosses its mane!', effect: -6 },
                    { text: 'The horse whinnies!', effect: -10 },
                ];
                const action = actions[Math.floor(Math.random() * actions.length)];
                horseAction = action.text;
                calmness = Math.max(0, Math.min(100, calmness + action.effect));
                actionCooldown = 3;
            }

            // Update mood
            horseMood = calmness < 20 ? 'panicked' : calmness >= 40 && calmness <= 70 ? 'calm' : 'nervous';

            // In sweet spot? Build hold timer
            if (calmness >= 40 && calmness <= 70) {
                holdTimer += 0.3;
            } else {
                holdTimer = Math.max(0, holdTimer - 0.1);
            }

            // Win condition
            if (holdTimer >= holdTarget) {
                cleanup();
                phase = 'result';
                if (!PlayerInventory.addItem(player, 'horse', 1).success) {
                    tameResult = 'bolted';
                    statusMsg = 'Your packs are full — with nowhere to keep it, the horse wanders off.';
                } else {
                    tameResult = 'success';
                    player.maxStamina = (player.maxStamina || 10) + 2;
                    if (Math.random() < 0.2) {
                        player.strength = (player.strength || 5) + 1;
                        statusMsg = '💪 The struggle strengthened you!';
                    }
                }
            }

            // Lose condition — too wild
            if (calmness <= 0) {
                cleanup();
                phase = 'result';
                if (Math.random() < 0.4) {
                    const dmg = Math.floor(Math.random() * 12) + 5;
                    player.health = Math.max(1, player.health - dmg);
                    tameResult = 'kicked';
                    statusMsg = `The panicked horse kicked you! -${dmg} HP`;
                } else {
                    tameResult = 'bolted';
                }
            }

            render();
        }, 300);

        // ── Player actions ──
        window._tameCalm = () => {
            if (phase !== 'taming') return;
            // Soothe — gently increase calmness
            calmness = Math.min(100, calmness + (3 + strengthStat * 0.3));
            horseAction = 'You speak softly and stroke its neck...';
            render();
        };

        window._tameFeed = () => {
            if (phase !== 'taming') return;
            // Feed — bigger calm boost but with cooldown risk
            const feedBonus = 8 + luckStat * 0.5;
            if (Math.random() < 0.7) {
                calmness = Math.min(100, calmness + feedBonus);
                horseAction = '🥕 The horse cautiously takes the food...';
            } else {
                calmness = Math.max(0, calmness - 5);
                horseAction = 'The horse snaps at your hand! Just missed!';
            }
            render();
        };

        window._tameGrip = () => {
            if (phase !== 'taming') return;
            // Firm grip — stops drift temporarily but may spook
            if (calmness < 30) {
                // Risky when panicked
                calmness = Math.max(0, calmness - 10);
                horseAction = 'The horse rears up! Too forceful!';
            } else {
                calmness = Math.max(0, Math.min(100, calmness + (Math.random() < 0.5 ? 2 : -3)));
                holdTimer += 0.4;
                horseAction = '✊ You hold firm... the horse settles slightly.';
            }
            render();
        };
    },

    /**
     * Craft a campfire — uses 2 wood, gives health bonus on rest, can cook fish
     */
    doCraftCampfire(game, tile) {
        const player = game.player;

        if (!player.inventory?.wood || player.inventory.wood < 2) {
            game.ui.showNotification('No Wood', 'You need at least 2 wood to build a campfire.', 'error');
            return;
        }

        player.inventory.wood -= 2;
        if (player.inventory.wood <= 0) delete player.inventory.wood;

        // Immediate health bonus
        const healAmount = 15;
        player.health = Math.min(player.maxHealth || 100, player.health + healAmount);

        let resultMsg = `You built a warm campfire. +${healAmount} HP from the warmth.`;

        // Cook fish if available
        if (player.inventory.fish && player.inventory.fish > 0) {
            const fishCount = Math.min(player.inventory.fish, 3); // Cook up to 3
            player.inventory.fish -= fishCount;
            if (player.inventory.fish <= 0) delete player.inventory.fish;
            const extraHeal = fishCount * 5;
            player.health = Math.min(player.maxHealth || 100, player.health + extraHeal);
            if (PlayerInventory.addItem(player, 'cooked_fish', fishCount).success) {
                resultMsg += ` Cooked ${fishCount} fish (+${extraHeal} HP).`;
            } else {
                resultMsg += ` Your packs are full, so you ate the ${fishCount} fish on the spot (+${extraHeal} HP).`;
            }
        }

        // Cook raw meat if available
        if (player.inventory.meat && player.inventory.meat > 0) {
            const meatCount = Math.min(player.inventory.meat, 3);
            player.inventory.meat -= meatCount;
            if (player.inventory.meat <= 0) delete player.inventory.meat;
            const extraHeal = meatCount * 7;
            player.health = Math.min(player.maxHealth || 100, player.health + extraHeal);
            if (PlayerInventory.addItem(player, 'cooked_meat', meatCount).success) {
                resultMsg += ` Cooked ${meatCount} meat (+${extraHeal} HP).`;
            } else {
                resultMsg += ` Your packs are full, so you ate the ${meatCount} meat on the spot (+${extraHeal} HP).`;
            }
        }

        // Small intelligence gain from the craft
        if (Math.random() < 0.08) {
            player.intelligence = (player.intelligence || 5) + 1;
            resultMsg += ' Your practical skills sharpened your mind.';
        }

        game.ui.showNotification('🔥 Campfire', resultMsg, 'success');
        game.ui.updateStats(player, game.world);
    },
});
