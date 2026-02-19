// ============================================
// BATTLE UI — Tactical battlefield overlay
// ============================================

const BattleUI = {

    // Active battle state
    _state: null,

    /**
     * Launch the tactical battle overlay.
     * @param {object} game
     * @param {object} opts  { enemyStrength, enemyName, enemyIcon, terrainId, context,
     *                         onComplete(result) }
     */
    open(game, opts) {
        // Close any open custom panel
        if (game.ui && game.ui.hideCustomPanel) game.ui.hideCustomPanel();
        BattleUI._cleanup();

        const player = game.player;
        const playerSquads  = BattleSystem.createPlayerSquads(player);
        const enemySquads   = BattleSystem.createEnemySquads(
            opts.enemyStrength, opts.enemyName, opts.context || {}
        );

        if (playerSquads.length === 0) {
            game.ui.showNotification('No Army', 'You have no army to fight with! Recruit soldiers first.', 'error');
            return;
        }

        const allSquads = [...playerSquads, ...enemySquads];

        BattleUI._state = {
            game,
            opts,
            allSquads,
            playerSquads,
            enemySquads,
            selectedSquad: null,
            movableHexes: [],
            phase: 'player_turn',   // 'player_turn' | 'enemy_turn' | 'result'
            turnNumber: 1,
            log: [],
            maxTurns: 6,
        };

        BattleUI._render();
    },

    // ── Rendering ──────────────────────────────────────────────────────────────

    _render() {
        const existing = document.getElementById('battleOverlay');
        if (existing) existing.remove();

        const state = BattleUI._state;
        if (!state) return;

        const overlay = document.createElement('div');
        overlay.id = 'battleOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 2000;
            background: rgba(0,0,0,0.88);
            display: flex; align-items: center; justify-content: center;
            font-family: var(--font-body, sans-serif);
        `;

        const COLS = BattleSystem.MAP_COLS;
        const ROWS = BattleSystem.MAP_ROWS;
        const HEX_W = 78;
        const HEX_H = 70;
        const mapW = COLS * HEX_W + 20;
        const mapH = ROWS * HEX_H + 20;

        const panel = document.createElement('div');
        panel.style.cssText = `
            display: flex; flex-direction: column;
            background: rgba(10,14,22,0.98);
            border: 1px solid rgba(245,197,66,0.35);
            border-radius: 14px;
            box-shadow: 0 16px 64px rgba(0,0,0,0.9), 0 0 0 1px rgba(245,197,66,0.08);
            max-width: 98vw; max-height: 98vh;
            overflow: hidden;
        `;

        // ── Header ──
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            padding: 10px 18px; border-bottom: 1px solid rgba(255,255,255,0.06);
            background: rgba(245,197,66,0.04); flex-shrink: 0;
        `;
        const enemyIcon = state.opts.enemyIcon || '⚔️';
        const enemyName = state.opts.enemyName || 'Enemy Force';
        header.innerHTML = `
            <div>
                <div id="battleTurnLabel" style="font-family:var(--font-display,serif); font-size:15px; color:#f5c542; letter-spacing:0.5px;">
                    ⚔️ Battle — Turn ${state.turnNumber}/${state.maxTurns}
                </div>
                <div style="font-size:11px; color:#888; margin-top:1px;">
                    ${enemyIcon} ${enemyName}
                    ${state.opts.terrainId ? `· Terrain: ${state.opts.terrainId}` : ''}
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <span id="battlePhaseLabel" style="font-size:12px; padding:3px 10px; border-radius:4px;
                    background:rgba(79,195,247,0.15); color:#4fc3f7; border:1px solid rgba(79,195,247,0.3);">
                    ${state.phase === 'player_turn' ? 'YOUR TURN' : 'ENEMY TURN'}
                </span>
                <button id="battleFleBtn" style="
                    padding:5px 12px; background:rgba(231,76,60,0.18); border:1px solid rgba(231,76,60,0.45);
                    border-radius:6px; color:#ff8a80; cursor:pointer; font-size:12px;">
                    🏃 Flee
                </button>
            </div>
        `;
        panel.appendChild(header);

        // ── Body: map + sidebar ──
        const body = document.createElement('div');
        body.style.cssText = `display:flex; gap:0; flex:1; overflow:hidden;`;

        // Battle map canvas
        const mapWrap = document.createElement('div');
        mapWrap.style.cssText = `
            position:relative; overflow:auto; flex-shrink:0;
            padding:10px;
        `;

        const canvas = document.createElement('canvas');
        canvas.id = 'battleCanvas';
        canvas.width = mapW;
        canvas.height = mapH;
        canvas.style.cssText = `display:block; cursor:pointer;`;
        mapWrap.appendChild(canvas);
        body.appendChild(mapWrap);

        // Sidebar
        const sidebar = document.createElement('div');
        sidebar.id = 'battleSidebar';
        sidebar.style.cssText = `
            width:220px; flex-shrink:0; display:flex; flex-direction:column; gap:0;
            border-left:1px solid rgba(255,255,255,0.06); overflow:hidden;
        `;
        body.appendChild(sidebar);

        panel.appendChild(body);

        // ── Footer buttons ──
        const footer = document.createElement('div');
        footer.style.cssText = `
            display:flex; gap:8px; padding:10px 14px;
            border-top:1px solid rgba(255,255,255,0.06);
            background:rgba(245,197,66,0.02); flex-shrink:0;
        `;
        footer.innerHTML = `
            <button id="battleEndTurnBtn" style="
                flex:1; padding:9px; background:rgba(79,195,247,0.18);
                border:1px solid rgba(79,195,247,0.45); border-radius:6px;
                color:#4fc3f7; cursor:pointer; font-size:13px; font-weight:600;
                font-family:var(--font-body,sans-serif);">
                ✅ End Turn
            </button>
        `;
        panel.appendChild(footer);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // Draw initial state
        BattleUI._drawMap(canvas, state);
        BattleUI._renderSidebar(state);

        // ── Event listeners ──
        canvas.addEventListener('click', (e) => BattleUI._onCanvasClick(e, canvas, state));
        canvas.addEventListener('mousemove', (e) => BattleUI._onCanvasHover(e, canvas, state));

        document.getElementById('battleEndTurnBtn').addEventListener('click', () => BattleUI._endPlayerTurn());
        document.getElementById('battleFleBtn').addEventListener('click', () => BattleUI._flee());
    },

    _drawMap(canvas, state) {
        const ctx = canvas.getContext('2d');
        const COLS = BattleSystem.MAP_COLS;
        const ROWS = BattleSystem.MAP_ROWS;
        const W = 78;
        const H = 70;
        const PAD = 10;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background grid
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                const { x, y } = BattleUI._hexCenter(c, r, W, H, PAD);

                // Zone shading: left = player side, right = enemy side
                if (c < 2) {
                    ctx.fillStyle = 'rgba(79,195,247,0.06)';
                } else if (c >= COLS - 2) {
                    ctx.fillStyle = 'rgba(231,76,60,0.06)';
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.025)';
                }

                BattleUI._drawHex(ctx, x, y, W * 0.48, H * 0.48);

                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Dividing line
        const midX = BattleUI._hexCenter(Math.floor(COLS / 2), 0, W, H, PAD).x;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(245,197,66,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(midX, 0);
        ctx.lineTo(midX, canvas.height);
        ctx.stroke();
        ctx.restore();

        // Movable hexes highlight
        for (const h of state.movableHexes) {
            const { x, y } = BattleUI._hexCenter(h.col, h.row, W, H, PAD);
            ctx.fillStyle = 'rgba(79,195,247,0.22)';
            BattleUI._drawHex(ctx, x, y, W * 0.48, H * 0.48);
            ctx.strokeStyle = 'rgba(79,195,247,0.6)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Attack targets highlight
        if (state.selectedSquad) {
            const targets = BattleSystem.getAttackTargets(state.selectedSquad, state.allSquads);
            for (const t of targets) {
                const { x, y } = BattleUI._hexCenter(t.col, t.row, W, H, PAD);
                ctx.fillStyle = 'rgba(231,76,60,0.22)';
                BattleUI._drawHex(ctx, x, y, W * 0.48, H * 0.48);
                ctx.strokeStyle = 'rgba(231,76,60,0.6)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        // Draw squads
        for (const squad of state.allSquads) {
            if (squad.destroyed) continue;
            const { x, y } = BattleUI._hexCenter(squad.col, squad.row, W, H, PAD);

            // Selected glow
            if (state.selectedSquad === squad) {
                ctx.shadowBlur = 18;
                ctx.shadowColor = squad.color;
            } else {
                ctx.shadowBlur = 0;
            }

            // Squad hex
            ctx.fillStyle = squad.destroyed ? 'rgba(50,50,50,0.5)'
                : squad.isPlayer ? `${squad.color}33`
                : 'rgba(231,76,60,0.2)';

            BattleUI._drawHex(ctx, x, y, W * 0.46, H * 0.46);

            ctx.strokeStyle = squad.isPlayer ? squad.color : '#e74c3c';
            ctx.lineWidth = squad === state.selectedSquad ? 2.5 : 1.5;
            ctx.stroke();

            ctx.shadowBlur = 0;

            // Icon
            ctx.font = '22px serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = squad.hasMoved && squad.isPlayer ? 'rgba(255,255,255,0.4)' : '#fff';
            ctx.fillText(squad.icon, x, y - 5);

            // Strength bar
            const barW = W * 0.7;
            const barH = 5;
            const barX = x - barW / 2;
            const barY = y + 14;
            const ratio = squad.maxStrength > 0 ? squad.strength / squad.maxStrength : 0;
            const barColor = ratio > 0.6 ? '#2ecc71' : ratio > 0.3 ? '#f1c40f' : '#e74c3c';

            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = barColor;
            ctx.fillRect(barX, barY, barW * ratio, barH);

            // Move indicator
            if (squad.isPlayer && !squad.hasMoved && state.phase === 'player_turn') {
                ctx.font = 'bold 8px sans-serif';
                ctx.fillStyle = '#4fc3f7';
                ctx.fillText(`${squad.movesLeft}▶`, x + W * 0.3, y - H * 0.3);
            }
        }
    },

    _renderSidebar(state) {
        const sidebar = document.getElementById('battleSidebar');
        if (!sidebar) return;

        const playerAlive = state.allSquads.filter(s => s.isPlayer && !s.destroyed);
        const enemyAlive  = state.allSquads.filter(s => !s.isPlayer && !s.destroyed);

        const playerStr = playerAlive.reduce((t, s) => t + s.strength, 0);
        const enemyStr  = enemyAlive.reduce((t, s) => t + s.strength, 0);

        let html = `
            <div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="font-size:10px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Forces</div>
                <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                    <span style="color:#4fc3f7;">⚔️ Your Force</span>
                    <span style="color:#4fc3f7; font-weight:bold;">${playerStr}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px;">
                    <span style="color:#e74c3c;">🔴 Enemy Force</span>
                    <span style="color:#e74c3c; font-weight:bold;">${enemyStr}</span>
                </div>
            </div>
        `;

        // Selected squad info
        if (state.selectedSquad && !state.selectedSquad.destroyed) {
            const s = state.selectedSquad;
            const targets = BattleSystem.getAttackTargets(s, state.allSquads);
            html += `
                <div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.05); background:rgba(245,197,66,0.04);">
                    <div style="font-size:10px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Selected</div>
                    <div style="font-size:20px; text-align:center; margin-bottom:4px;">${s.icon}</div>
                    <div style="font-size:13px; color:${s.color}; font-weight:bold; text-align:center;">${s.label}</div>
                    <div style="font-size:11px; color:#aaa; text-align:center; margin-top:2px;">${s.unitCount} units</div>
                    <div style="margin-top:8px; font-size:11px; color:#ccc;">
                        <div>Strength: <strong style="color:${s.color}">${s.strength}</strong> / ${s.maxStrength}</div>
                        <div>Moves left: <strong style="color:#4fc3f7">${s.movesLeft}</strong></div>
                    </div>
                    ${targets.length > 0 && s.isPlayer && !s.hasAttacked ? `
                        <div style="margin-top:8px;">
                            <div style="font-size:10px; color:#e74c3c; margin-bottom:4px; text-transform:uppercase;">Attack:</div>
                            ${targets.map(t => `
                                <button class="battle-attack-btn" data-target-id="${t.id}"
                                    style="width:100%; margin-bottom:4px; padding:5px 8px;
                                    background:rgba(231,76,60,0.18); border:1px solid rgba(231,76,60,0.4);
                                    border-radius:5px; color:#ff8a80; cursor:pointer; font-size:11px;
                                    font-family:var(--font-body,sans-serif); display:flex; align-items:center; gap:6px;">
                                    ${t.icon} ${t.label} (${t.strength})
                                </button>
                            `).join('')}
                        </div>` : ''}
                </div>
            `;
        }

        // Battle log
        html += `
            <div style="flex:1; overflow-y:auto; padding:8px 10px;">
                <div style="font-size:10px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Battle Log</div>
                ${state.log.slice(-10).reverse().map(line => `
                    <div style="font-size:11px; color:#aaa; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.03);">${line}</div>
                `).join('')}
            </div>
        `;

        sidebar.innerHTML = html;

        // Attack button listeners
        sidebar.querySelectorAll('.battle-attack-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target-id');
                BattleUI._attackTarget(targetId);
            });
        });
    },

    _drawHex(ctx, cx, cy, rw, rh) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = Math.PI / 180 * (60 * i - 30);
            const px = cx + rw * Math.cos(a);
            const py = cy + rh * Math.sin(a);
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    },

    _hexCenter(col, row, W, H, pad) {
        const x = pad + col * W + W / 2;
        const y = pad + row * H + (col % 2 === 1 ? H / 2 : 0) + H / 2;
        return { x, y };
    },

    _hexFromPoint(px, py, W, H, PAD, COLS, ROWS) {
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                const { x, y } = BattleUI._hexCenter(c, r, W, H, PAD);
                const dx = px - x;
                const dy = py - y;
                if (Math.sqrt(dx * dx + dy * dy) < W * 0.48) return { col: c, row: r };
            }
        }
        return null;
    },

    // ── Interaction ────────────────────────────────────────────────────────────

    _onCanvasClick(e, canvas, state) {
        if (state.phase !== 'player_turn') return;

        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;

        const cell = BattleUI._hexFromPoint(px, py, 78, 70, 10,
            BattleSystem.MAP_COLS, BattleSystem.MAP_ROWS);
        if (!cell) return;

        const clickedSquad = state.allSquads.find(
            s => s.col === cell.col && s.row === cell.row && !s.destroyed
        );

        // Select own squad
        if (clickedSquad && clickedSquad.isPlayer) {
            state.selectedSquad = clickedSquad;
            state.movableHexes = clickedSquad.hasMoved
                ? []
                : BattleSystem.getMovableHexes(clickedSquad, state.allSquads);
            BattleUI._drawMap(canvas, state);
            BattleUI._renderSidebar(state);
            return;
        }

        // Move to empty hex
        if (!clickedSquad && state.selectedSquad && !state.selectedSquad.hasMoved) {
            const isMovable = state.movableHexes.some(h => h.col === cell.col && h.row === cell.row);
            if (isMovable) {
                BattleSystem.moveSquad(state.selectedSquad, cell.col, cell.row);
                state.log.push(`${state.selectedSquad.icon} ${state.selectedSquad.label} moved.`);
                state.movableHexes = [];
                // Refresh attack targets for same squad
                BattleUI._drawMap(canvas, state);
                BattleUI._renderSidebar(state);
                return;
            }
        }

        // Attack enemy squad by clicking on it
        if (clickedSquad && !clickedSquad.isPlayer && state.selectedSquad
            && !state.selectedSquad.hasAttacked) {
            const targets = BattleSystem.getAttackTargets(state.selectedSquad, state.allSquads);
            if (targets.includes(clickedSquad)) {
                BattleUI._doAttack(state.selectedSquad, clickedSquad);
                return;
            }
        }

        // Deselect
        state.selectedSquad = null;
        state.movableHexes = [];
        BattleUI._drawMap(canvas, state);
        BattleUI._renderSidebar(state);
    },

    _onCanvasHover(e, canvas, state) {
        // Cursor change on squads
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const cell = BattleUI._hexFromPoint(px, py, 78, 70, 10,
            BattleSystem.MAP_COLS, BattleSystem.MAP_ROWS);
        if (!cell) { canvas.style.cursor = 'default'; return; }

        const isMovable = state.movableHexes.some(h => h.col === cell.col && h.row === cell.row);
        const isAttackable = state.selectedSquad && BattleSystem.getAttackTargets(
            state.selectedSquad, state.allSquads
        ).some(t => t.col === cell.col && t.row === cell.row);

        canvas.style.cursor = isMovable ? 'pointer'
            : isAttackable ? 'crosshair'
            : state.allSquads.find(s => s.col === cell.col && s.row === cell.row && s.isPlayer && !s.destroyed) ? 'pointer'
            : 'default';
    },

    _attackTarget(targetId) {
        const state = BattleUI._state;
        if (!state || !state.selectedSquad) return;

        const target = state.allSquads.find(s => s.id === targetId && !s.destroyed);
        if (!target) return;

        BattleUI._doAttack(state.selectedSquad, target);
    },

    _doAttack(attacker, defender) {
        const state = BattleUI._state;
        const result = BattleSystem.resolveCombat(
            attacker, defender, state.allSquads, state.opts.terrainId
        );

        let logLine = `${attacker.icon} ${attacker.label} attacked ${defender.icon} ${defender.label}`;
        if (result.flankBonus > 1.0) logLine += ` (flanked x${result.flankBonus})`;
        logLine += result.attackerWins ? ' — enemy staggered!' : ' — held!';
        if (result.defenderDestroyed) logLine += ' 💀 Destroyed!';
        state.log.push(logLine);

        // Redraw
        const canvas = document.getElementById('battleCanvas');
        BattleUI._drawMap(canvas, state);
        BattleUI._renderSidebar(state);

        // Check battle end
        BattleUI._checkEnd();
    },

    _endPlayerTurn() {
        const state = BattleUI._state;
        if (!state || state.phase !== 'player_turn') return;

        state.phase = 'enemy_turn';
        state.log.push('── Enemy turn ──');

        const phaseLabel = document.getElementById('battlePhaseLabel');
        if (phaseLabel) {
            phaseLabel.textContent = 'ENEMY TURN';
            phaseLabel.style.background = 'rgba(231,76,60,0.15)';
            phaseLabel.style.color = '#e74c3c';
            phaseLabel.style.borderColor = 'rgba(231,76,60,0.3)';
        }

        const endBtn = document.getElementById('battleEndTurnBtn');
        if (endBtn) endBtn.disabled = true;

        // Small delay so player sees the phase change
        setTimeout(() => {
            const events = BattleSystem.enemyTurn(state.allSquads, state.opts.terrainId);
            for (const ev of events) {
                const res = ev.result;
                let line = `${ev.attacker.icon} ${ev.attacker.label} attacked ${ev.defender.icon} ${ev.defender.label}`;
                if (res.defenderDestroyed) line += ' 💀';
                state.log.push(line);
            }

            const canvas = document.getElementById('battleCanvas');
            if (canvas) BattleUI._drawMap(canvas, state);
            BattleUI._renderSidebar(state);

            if (BattleUI._checkEnd()) return;

            // Start next player turn
            state.turnNumber++;
            if (state.turnNumber > state.maxTurns) {
                // Time limit — resolve based on current strengths
                BattleUI._resolveBattleEnd(false, true);
                return;
            }

            state.phase = 'player_turn';
            // Reset player squad actions
            for (const s of state.playerSquads) {
                if (!s.destroyed) {
                    s.hasMoved = false;
                    s.hasAttacked = false;
                    s.movesLeft = s.movesMax;
                }
            }

            const header = document.getElementById('battlePhaseLabel');
            if (header) {
                header.textContent = 'YOUR TURN';
                header.style.background = 'rgba(79,195,247,0.15)';
                header.style.color = '#4fc3f7';
                header.style.borderColor = 'rgba(79,195,247,0.3)';
            }
            // Update turn label in header
            const turnLabel = document.getElementById('battleTurnLabel');
            if (turnLabel) turnLabel.textContent = `⚔️ Battle — Turn ${state.turnNumber}/${state.maxTurns}`;

            if (endBtn) endBtn.disabled = false;
            if (canvas) BattleUI._drawMap(canvas, state);
            BattleUI._renderSidebar(state);
        }, 400);
    },

    _flee() {
        const state = BattleUI._state;
        if (!state) return;

        state.log.push('🏃 You fled the battlefield!');
        // Fleeing costs some casualties
        for (const s of state.playerSquads) {
            if (!s.destroyed) {
                s.strength = Math.floor(s.strength * 0.7);
                if (s.strength <= 0) s.destroyed = true;
            }
        }
        BattleUI._resolveBattleEnd(false, false, true);
    },

    _checkEnd() {
        const state = BattleUI._state;
        const outcome = BattleSystem.checkBattleEnd(state.allSquads);
        if (outcome) {
            BattleUI._resolveBattleEnd(outcome === 'player_wins');
            return true;
        }
        return false;
    },

    _resolveBattleEnd(playerWins, timeout = false, fled = false) {
        const state = BattleUI._state;
        if (!state) return;
        state.phase = 'result';

        // Apply squad losses back to the player's army
        BattleSystem.applySquadLossesToArmy(state.game.player, state.playerSquads);

        // Tactical bonus: how well-preserved the player's force is
        const tacticalBonus = playerWins ? BattleSystem.calcTacticalBonus(state.allSquads) : 1.0;

        BattleUI._showResult(playerWins, fled, timeout, tacticalBonus);
    },

    _showResult(playerWins, fled, timeout, tacticalBonus) {
        const state = BattleUI._state;

        // Build result overlay
        const existing = document.getElementById('battleOverlay');
        if (!existing) return;

        const opts = state.opts;
        const player = state.game.player;

        // Compute overall result via existing combat logic (with tactical bonus applied)
        const baseResult = PlayerMilitary.combat(player, opts.enemyStrength, opts.enemyName, {
            ...(opts.context || {}),
            tacticalBonus,
            skipCasualties: true,   // We already applied them from squads
        });

        const victory = playerWins && !fled;
        let loot = 0;

        if (victory) {
            loot = Math.floor(opts.enemyStrength * Utils.randFloat(2, 5));
            player.gold += loot;
            player.skills.combat = Math.min(10, (player.skills.combat || 1) + 0.4);
            player.renown = (player.renown || 0) + Math.floor(opts.enemyStrength / 10);
            // Gain experience
            for (const unit of player.army || []) {
                unit.experience = (unit.experience || 0) + 8;
                if (unit.experience >= 100 && (unit.level || 1) < 5) {
                    unit.level = (unit.level || 1) + 1;
                    unit.experience = 0;
                    unit.strength = Math.floor((unit.strength || 5) * 1.2);
                }
            }
        }

        // Karma/reputation for enemy type
        let karmaChange = 0;
        if (victory && opts.context && opts.context.isNeutral) karmaChange = -3;
        if (victory && opts.context && opts.context.isBandit) karmaChange = 1;

        const totalCasualties = state.playerSquads.reduce((t, s) => {
            return t + Math.round(s.unitCount * (1 - s.strength / Math.max(1, s.maxStrength)));
        }, 0);

        let resultHTML = `
            <div id="battleResult" style="
                position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                background:rgba(0,0,0,0.82); border-radius:14px; z-index:10;">
                <div style="
                    background:rgba(10,14,22,0.98); border:1px solid rgba(245,197,66,0.35);
                    border-radius:12px; padding:28px 32px; max-width:400px; text-align:center;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.8);">
                    <div style="font-size:52px; margin-bottom:8px;">
                        ${fled ? '🏃' : victory ? '🏆' : '💀'}
                    </div>
                    <h2 style="
                        font-family:var(--font-display,serif); color:${fled ? '#f39c12' : victory ? '#2ecc71' : '#e74c3c'};
                        margin:0 0 6px 0; font-size:24px;">
                        ${fled ? 'Retreat!' : victory ? 'Victory!' : 'Defeated!'}
                    </h2>
                    <div style="color:#888; font-size:13px; margin-bottom:16px;">
                        ${fled ? 'You fled the battlefield.' : timeout ? 'Battle ended by time limit.' : ''}
                    </div>

                    <div style="background:rgba(255,255,255,0.04); border-radius:8px; padding:14px;
                        text-align:left; margin-bottom:16px; font-size:13px; line-height:1.7;">
                        ${victory ? `<div>💰 Gold looted: <strong style="color:#ffd700;">${loot}</strong></div>` : ''}
                        ${totalCasualties > 0 ? `<div style="color:#ff9800;">⚠️ Soldiers lost: <strong>${totalCasualties}</strong></div>` : ''}
                        ${victory ? `<div>⭐ Renown: <strong style="color:#e67e22;">+${Math.floor(opts.enemyStrength / 10)}</strong></div>` : ''}
                        ${tacticalBonus > 1.0 ? `<div style="color:#4fc3f7;">📐 Tactical bonus: <strong>+${Math.round((tacticalBonus - 1) * 100)}%</strong></div>` : ''}
                        ${karmaChange !== 0 ? `<div>☯ Karma: <strong style="color:${karmaChange > 0 ? '#2ecc71' : '#e74c3c'}">${karmaChange > 0 ? '+' : ''}${karmaChange}</strong></div>` : ''}
                    </div>

                    <button id="battleCloseBtn" style="
                        width:100%; padding:11px; background:rgba(245,197,66,0.15);
                        border:1px solid rgba(245,197,66,0.4); border-radius:8px;
                        color:#f5c542; cursor:pointer; font-size:14px; font-weight:600;
                        font-family:var(--font-body,sans-serif);">
                        Continue
                    </button>
                </div>
            </div>
        `;

        existing.insertAdjacentHTML('beforeend', resultHTML);

        document.getElementById('battleCloseBtn').addEventListener('click', () => {
            BattleUI._cleanup();
            // Notify caller
            if (opts.onComplete) {
                opts.onComplete({
                    victory,
                    fled,
                    loot,
                    casualties: totalCasualties,
                    tacticalBonus,
                    karmaChange,
                });
            }
            // Update game state
            if (state.game.ui) {
                state.game.ui.updateStats(state.game.player, state.game.world);
            }
            state.game.endDay();
        });
    },

    _cleanup() {
        const el = document.getElementById('battleOverlay');
        if (el) el.remove();
        BattleUI._state = null;
    },
};

window.BattleUI = BattleUI;
