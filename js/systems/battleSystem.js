// ============================================
// BATTLE SYSTEM — Tactical battlefield logic
// ============================================

const BattleSystem = {

    // Battle map dimensions (cols x rows)
    MAP_COLS: 9,
    MAP_ROWS: 7,

    // Monotonic ID counter for squad IDs
    _idCounter: 0,

    // Movement point constants
    BASE_MOVES: 3,
    MIN_MOVES: 1,
    MAX_MOVES: 5,

    /**
     * Unit type definitions for squads on the battle map
     */
    SQUAD_TYPES: {
        cavalry: { label: 'Cavalry',  icon: '🐴', color: '#4fc3f7', moveCost: 1 },
        archers: { label: 'Archers',  icon: '🏹', color: '#a5d6a7', moveCost: 1 },
        infantry:{ label: 'Infantry', icon: '⚔️',  color: '#ef9a9a', moveCost: 1 },
        siege:   { label: 'Siege',    icon: '🪨',  color: '#ce93d8', moveCost: 2 },
    },

    /**
     * Create squads from a player's army composition.
     * Returns an array of squad objects placed on the left side of the battle map.
     */
    createPlayerSquads(player) {
        const army = player.army || [];
        if (army.length === 0) return [];

        // Group units by role
        const groups = { cavalry: [], archers: [], infantry: [] };
        for (const unit of army) {
            const role = PlayerMilitary._roleForUnitType(unit.type);
            const bucket = role === 'cavalry' ? 'cavalry' : role === 'archer' ? 'archers' : 'infantry';
            groups[bucket].push(unit);
        }

        const squads = [];
        const startPositions = [
            { col: 1, row: 1 },
            { col: 1, row: 3 },
            { col: 1, row: 5 },
            { col: 0, row: 2 },
        ];

        let posIdx = 0;
        for (const [type, units] of Object.entries(groups)) {
            if (units.length === 0) continue;

            const pos = startPositions[posIdx % startPositions.length];
            posIdx++;

            squads.push(BattleSystem._buildSquad(type, units, pos.col, pos.row, true));
        }

        return squads;
    },

    /**
     * Create enemy squads from enemy strength and name context.
     */
    createEnemySquads(enemyStrength, enemyName, context = {}) {
        const comp = PlayerMilitary.inferEnemyComposition(enemyStrength, enemyName, context);

        const colCount = BattleSystem.MAP_COLS;
        const rowCount = BattleSystem.MAP_ROWS;

        const startPositions = [
            { col: colCount - 2, row: 1 },
            { col: colCount - 2, row: 3 },
            { col: colCount - 2, row: 5 },
            { col: colCount - 1, row: 2 },
        ];

        const totalUnits = Math.max(3, Math.ceil(enemyStrength / 10));

        const types = [
            { type: 'cavalry',  share: comp.cavalry  },
            { type: 'archers',  share: comp.archer    },
            { type: 'infantry', share: comp.pikeman   },
        ].filter(t => t.share > 0.05);

        const squads = [];
        let posIdx = 0;
        for (const { type, share } of types) {
            const count = Math.max(1, Math.round(totalUnits * share));
            const unitStrength = Math.ceil(enemyStrength * share / count);
            const units = [];
            for (let i = 0; i < count; i++) {
                units.push({ type: type === 'cavalry' ? 'knight' : type === 'archers' ? 'archer' : 'soldier',
                    strength: unitStrength, level: 1 });
            }

            const pos = startPositions[posIdx % startPositions.length];
            posIdx++;

            squads.push(BattleSystem._buildSquad(type, units, pos.col, pos.row, false));
        }

        return squads;
    },

    /**
     * Build a single squad object.
     */
    _buildSquad(type, units, col, row, isPlayer) {
        const def = BattleSystem.SQUAD_TYPES[type] || BattleSystem.SQUAD_TYPES.infantry;
        const totalStrength = units.reduce((s, u) => {
            const levelBonus = 1 + ((u.level || 1) - 1) * 0.2;
            return s + (u.strength || 1) * levelBonus;
        }, 0);

        const moves = BattleSystem._calcMoves(type, units.length);

        return {
            id: `sq_${Date.now()}_${++BattleSystem._idCounter}`,
            type,
            label: def.label,
            icon: def.icon,
            color: def.color,
            isPlayer,
            units,
            unitCount: units.length,
            strength: Math.ceil(totalStrength),
            maxStrength: Math.ceil(totalStrength),
            col,
            row,
            movesMax: moves,
            movesLeft: moves,
            hasMoved: false,
            hasAttacked: false,
            destroyed: false,
        };
    },

    /**
     * Calculate movement points for a squad.
     * Larger squads move slower; cavalry get a bonus.
     */
    _calcMoves(type, unitCount) {
        let moves = BattleSystem.BASE_MOVES;
        // Penalty per unit over 3
        moves -= Math.max(0, unitCount - 3) * 0.4;
        // Cavalry bonus
        if (type === 'cavalry') moves += 1;
        // Siege penalty
        if (type === 'siege') moves -= 1;
        return Math.max(BattleSystem.MIN_MOVES, Math.min(BattleSystem.MAX_MOVES, Math.round(moves)));
    },

    /**
     * Get all valid move targets for a squad given other squads.
     * Returns array of {col, row}.
     */
    getMovableHexes(squad, allSquads) {
        if (squad.movesLeft <= 0 || squad.hasMoved) return [];

        const occupied = new Set(
            allSquads
                .filter(s => s !== squad && !s.destroyed)
                .map(s => `${s.col},${s.row}`)
        );

        const reachable = [];
        const visited = new Set();
        const queue = [{ col: squad.col, row: squad.row, remaining: squad.movesLeft }];
        visited.add(`${squad.col},${squad.row}`);

        while (queue.length > 0) {
            const { col, row, remaining } = queue.shift();

            for (const [dc, dr] of BattleSystem._neighbors(col, row)) {
                const nc = col + dc;
                const nr = row + dr;
                const key = `${nc},${nr}`;
                if (visited.has(key)) continue;
                if (nc < 0 || nr < 0 || nc >= BattleSystem.MAP_COLS || nr >= BattleSystem.MAP_ROWS) continue;

                visited.add(key);

                if (occupied.has(key)) continue; // Can't enter occupied hex

                reachable.push({ col: nc, row: nr });

                const cost = BattleSystem.SQUAD_TYPES[squad.type]?.moveCost || 1;
                if (remaining - cost > 0) {
                    queue.push({ col: nc, row: nr, remaining: remaining - cost });
                }
            }
        }

        return reachable;
    },

    /**
     * Move a squad to a new position.
     */
    moveSquad(squad, col, row) {
        squad.col = col;
        squad.row = row;
        squad.hasMoved = true;
        squad.movesLeft = 0;
    },

    /**
     * Get adjacent enemy squads that can be attacked.
     */
    getAttackTargets(squad, allSquads) {
        if (squad.hasAttacked || squad.destroyed) return [];

        const targets = [];
        for (const [dc, dr] of BattleSystem._neighbors(squad.col, squad.row)) {
            const nc = squad.col + dc;
            const nr = squad.row + dr;
            const enemy = allSquads.find(
                s => s.col === nc && s.row === nr && s.isPlayer !== squad.isPlayer && !s.destroyed
            );
            if (enemy) targets.push(enemy);
        }
        return targets;
    },

    /**
     * Resolve combat between two squads.
     * Returns { attackerCasualties, defenderCasualties, defenderDestroyed }
     */
    resolveCombat(attacker, defender, allSquads, terrainId = null) {
        const attackerComp = BattleSystem._squadToComp(attacker.type);
        const defenderComp = BattleSystem._squadToComp(defender.type);

        const counterMult = PlayerMilitary._counterMultiplier(attackerComp, defenderComp);
        const terrainMult = terrainId ? PlayerMilitary._terrainMultiplier(terrainId, attackerComp) : 1;

        // Flanking bonus: +15% per extra attacker adjacent to defender
        const flankCount = BattleSystem._countFlankingAllies(attacker, defender, allSquads);
        const flankBonus = 1 + flankCount * 0.15;

        const attackRoll = Utils.randFloat(0.85, 1.15);
        const defendRoll = Utils.randFloat(0.85, 1.15);

        const attackPower = attacker.strength * attackRoll * counterMult * terrainMult * flankBonus;
        const defendPower = defender.strength * defendRoll;

        const attackerWins = attackPower > defendPower;

        // Casualty calculation
        const defenderCasRate = attackerWins
            ? Utils.randFloat(0.25, 0.45)
            : Utils.randFloat(0.1, 0.2);
        const attackerCasRate = attackerWins
            ? Utils.randFloat(0.05, 0.15)
            : Utils.randFloat(0.2, 0.35);

        const defenderCas = Math.min(defender.strength, Math.ceil(defender.strength * defenderCasRate));
        const attackerCas = Math.min(attacker.strength, Math.ceil(attacker.strength * attackerCasRate));

        defender.strength = Math.max(0, defender.strength - defenderCas);
        attacker.strength = Math.max(0, attacker.strength - attackerCas);

        if (defender.strength <= 0) defender.destroyed = true;
        if (attacker.strength <= 0) attacker.destroyed = true;

        attacker.hasAttacked = true;

        return {
            attackerWins,
            attackerCasualties: attackerCas,
            defenderCasualties: defenderCas,
            defenderDestroyed: defender.destroyed,
            flankBonus: Number(flankBonus.toFixed(2)),
            counterMult: Number(counterMult.toFixed(2)),
        };
    },

    /**
     * Count how many allied squads are adjacent to a defender.
     */
    _countFlankingAllies(attacker, defender, allSquads) {
        let count = 0;
        for (const [dc, dr] of BattleSystem._neighbors(defender.col, defender.row)) {
            const nc = defender.col + dc;
            const nr = defender.row + dr;
            const ally = allSquads.find(
                s => s !== attacker && s.col === nc && s.row === nr
                  && s.isPlayer === attacker.isPlayer && !s.destroyed
            );
            if (ally) count++;
        }
        return count;
    },

    /**
     * Execute a full AI turn for enemy squads.
     * Enemies advance toward the nearest player squad and attack if adjacent.
     */
    enemyTurn(allSquads, terrainId = null) {
        const enemySquads = allSquads.filter(s => !s.isPlayer && !s.destroyed);
        const playerSquads = allSquads.filter(s => s.isPlayer && !s.destroyed);

        const events = [];

        for (const enemy of enemySquads) {
            enemy.movesLeft = enemy.movesMax;
            enemy.hasMoved = false;
            enemy.hasAttacked = false;

            if (playerSquads.length === 0) break;

            // Find nearest player squad
            let target = null;
            let minDist = Infinity;
            for (const ps of playerSquads) {
                const d = Math.abs(ps.col - enemy.col) + Math.abs(ps.row - enemy.row);
                if (d < minDist) { minDist = d; target = ps; }
            }
            if (!target) continue;

            // Move toward target
            const moves = BattleSystem.getMovableHexes(enemy, allSquads);
            if (moves.length > 0) {
                const best = moves.reduce((b, h) => {
                    const d = Math.abs(h.col - target.col) + Math.abs(h.row - target.row);
                    const bd = Math.abs(b.col - target.col) + Math.abs(b.row - target.row);
                    return d < bd ? h : b;
                }, moves[0]);
                BattleSystem.moveSquad(enemy, best.col, best.row);
            }

            // Attack if adjacent
            const targets = BattleSystem.getAttackTargets(enemy, allSquads);
            if (targets.length > 0) {
                const attacked = targets[0];
                const result = BattleSystem.resolveCombat(enemy, attacked, allSquads, terrainId);
                events.push({ type: 'enemy_attack', attacker: enemy, defender: attacked, result });
            }
        }

        return events;
    },

    /**
     * Check if the battle is over. Returns 'player_wins', 'enemy_wins', or null.
     */
    checkBattleEnd(allSquads) {
        const playerAlive = allSquads.some(s => s.isPlayer && !s.destroyed);
        const enemyAlive = allSquads.some(s => !s.isPlayer && !s.destroyed);

        if (!playerAlive) return 'enemy_wins';
        if (!enemyAlive) return 'player_wins';
        return null;
    },

    /**
     * Calculate a tactical bonus multiplier (0.8–1.3) from battle result
     * to apply to the overall outcome strength calculation.
     */
    calcTacticalBonus(allSquads) {
        const playerStrength = allSquads.filter(s => s.isPlayer && !s.destroyed)
            .reduce((t, s) => t + s.strength, 0);
        const playerMax = allSquads.filter(s => s.isPlayer)
            .reduce((t, s) => t + s.maxStrength, 0);
        const ratio = playerMax > 0 ? playerStrength / playerMax : 0;
        // 0% retained → 0.8×, 100% retained → 1.3×
        return Math.max(0.8, Math.min(1.3, 0.8 + ratio * 0.5));
    },

    /**
     * Get the army role name (cavalry/archer/pikeman) for a squad type.
     */
    _squadTypeToRole(squadType) {
        switch (squadType) {
            case 'cavalry': return 'cavalry';
            case 'archers': return 'archer';
            default:        return 'pikeman';
        }
    },

    /**
     * Apply battle losses back to the player's army.
     */
    applySquadLossesToArmy(player, playerSquads) {
        for (const squad of playerSquads) {
            const lossRatio = squad.maxStrength > 0
                ? 1 - squad.strength / squad.maxStrength
                : 1;

            const unitsToRemove = Math.round(squad.units.length * lossRatio);
            const squadRole = BattleSystem._squadTypeToRole(squad.type);
            for (let i = 0; i < unitsToRemove && player.army.length > 0; i++) {
                // Remove matching unit type from back of army
                const idx = player.army.reduceRight((found, u, j) => {
                    if (found !== -1) return found;
                    const bucket = PlayerMilitary._roleForUnitType(u.type);
                    return bucket === squadRole ? j : -1;
                }, -1);

                if (idx !== -1) {
                    player.army.splice(idx, 1);
                } else if (player.army.length > 0) {
                    player.army.pop();
                }
            }
        }
    },

    // ── Helpers ──

    /**
     * Convert squad type to a composition for PlayerMilitary functions.
     */
    _squadToComp(type) {
        switch (type) {
            case 'cavalry':  return { cavalry: 0.9, archer: 0.05, pikeman: 0.05 };
            case 'archers':  return { cavalry: 0.05, archer: 0.9, pikeman: 0.05 };
            case 'infantry': return { cavalry: 0.05, archer: 0.05, pikeman: 0.9 };
            default:         return { cavalry: 0.33, archer: 0.34, pikeman: 0.33 };
        }
    },

    /**
     * Flat-top hex neighbors for simple grid (offset hex coords).
     * Returns [dc, dr] pairs.
     */
    _neighbors(col, row) {
        // Flat-top hex grid offsets (pointy-top-ish for simple display)
        const isEvenCol = col % 2 === 0;
        return isEvenCol
            ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1]]
            : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1],  [1, 1]];
    },
};

window.BattleSystem = BattleSystem;
