// UI — cheats mode. A panel toggled with ` (backquote) or F9 during play.
// One-shot cheats act on the player directly; standing cheats (infinite
// movement, full vision, god mode) live on game._cheats and are re-applied
// by applyCheats() from the game loop.
import { UI } from './core.js';
import { Hex, House, PlayerMilitary } from './_imports.js';

// Movement granted by "infinite movement" — enough to cross a region in a day
// without letting getReachableHexes flood the whole map
const CHEAT_MOVEMENT = 60;

const STANDING_CHEATS = [
    ['infiniteMovement', '🏃 Infinite movement', 'Movement and action points never run out'],
    ['fullVision', '👁️ Full vision', 'The whole map stays revealed'],
    ['godMode', '🛡️ God mode', 'Health and needs stay full'],
];

Object.assign(UI.prototype, {
    _cheatState() {
        const game = this.game;
        if (!game._cheats) game._cheats = { infiniteMovement: false, fullVision: false, godMode: false };
        return game._cheats;
    },

    /** Open the cheats panel, or close it when it is already showing */
    toggleCheatsPanel() {
        const panel = document.getElementById('customPanel');
        if (panel && panel.querySelector('.cheats-panel')) {
            this.hideCustomPanel();
            return;
        }
        this.renderCheatsPanel();
    },

    renderCheatsPanel() {
        const { player } = this.game;
        if (!player) return;
        const state = this._cheatState();
        const btn = (act, label, args) =>
            `<button class="gs-btn cheat-btn" data-ui-act="${act}"${args ? ` data-ui-args='${JSON.stringify(args)}'` : ''}>${label}</button>`;

        const toggles = STANDING_CHEATS.map(([key, label, hint]) => `
            <label class="cheat-toggle" title="${hint}">
                <input type="checkbox" data-ui-act="cheatToggle" data-ui-args='["${key}"]' ${state[key] ? 'checked' : ''}>
                <span>${label}</span>
            </label>`).join('');

        const units = Object.values(PlayerMilitary.UNIT_TYPES || {})
            .filter(u => u && u.id)
            .map(u => btn('cheatAddUnits', `${u.icon || '⚔️'} ${u.name || u.id} ×5`, [u.id, 5]))
            .join('');

        const html = `
            <div class="cheats-panel">
                <p class="cheat-note">Toggle with <kbd>\`</kbd> or <kbd>F9</kbd>.</p>
                <h4>Standing cheats</h4>
                <div class="cheat-toggles">${toggles}</div>

                <h4>Resources</h4>
                <div class="cheat-row">
                    ${btn('cheatGold', '💰 +1,000 gold', [1000])}
                    ${btn('cheatGold', '💰 +100,000 gold', [100000])}
                    ${btn('cheatFood', '🍞 +50 bread', [50])}
                </div>

                <h4>Character</h4>
                <div class="cheat-row">
                    ${btn('cheatHeal', '❤️ Full heal & needs')}
                    ${btn('cheatRefill', '🔋 Refill movement & AP')}
                    ${btn('cheatRenown', '⭐ +100 renown', [100])}
                    ${btn('cheatKarma', '😇 +50 karma', [50])}
                    ${btn('cheatKarma', '😈 −50 karma', [-50])}
                    ${btn('cheatPrestige', '👑 +50 prestige', [50])}
                    ${btn('cheatAttributes', '💪 +1 all attributes', [1])}
                    ${btn('cheatSkills', '📚 +1 all skills', [1])}
                </div>

                <h4>World</h4>
                <div class="cheat-row">
                    ${btn('cheatRevealMap', '🗺️ Reveal map')}
                    ${btn('cheatArmTeleport', '✨ Teleport (click a hex)')}
                    ${btn('cheatSkipDays', '⏩ Skip 1 day', [1])}
                    ${btn('cheatSkipDays', '⏩ Skip 7 days', [7])}
                    ${btn('cheatSkipDays', '⏩ Skip 30 days', [30])}
                </div>

                <h4>Army</h4>
                <div class="cheat-row">${units || '<em>No unit types loaded.</em>'}</div>
            </div>`;

        this.showCustomPanel('🧪 Cheats', html);
    },

    _cheatDone(title, message) {
        const { player, world } = this.game;
        player.usedCheats = true;
        this.updateStats(player, world);
        if (this.game.minimap) this.game.minimap.invalidate();
        this.showNotification(`🧪 ${title}`, message, 'success');
    },

    cheatToggle(key) {
        const state = this._cheatState();
        state[key] = !state[key];
        this.game.player.usedCheats = true;
        this.applyCheats(true);
        const def = STANDING_CHEATS.find(([k]) => k === key);
        this.showNotification(`🧪 ${def ? def[1] : key}`, state[key] ? 'Enabled' : 'Disabled', 'info');
        this.renderCheatsPanel();
    },

    /**
     * Re-apply the standing cheats. Called every frame on the world map;
     * `reveal` also re-lights the whole map (costlier, so only on moves/ticks).
     */
    applyCheats(reveal = false) {
        const state = this.game._cheats;
        if (!state) return;
        const { player, world } = this.game;
        if (!player || !world) return;

        if (state.infiniteMovement) {
            const before = player.movementRemaining;
            player.movementRemaining = Math.max(player.movementRemaining || 0, CHEAT_MOVEMENT);
            player.actionPoints = Math.max(player.actionPoints || 0, player.maxActionPoints || 10);
            // Stepping drops the remaining movement, so keep the reachable overlay current
            if (before !== player.movementRemaining && !player.isMoving && this.game.renderer) {
                this.game.renderer.reachableHexes = player.getReachableHexes(world);
            }
        }
        if (state.godMode) {
            player.health = player.maxHealth;
            player.starvationDays = 0;
            if (player.needs) for (const k of Object.keys(player.needs)) player.needs[k] = 100;
        }
        if (state.fullVision && reveal) this._revealAllTiles(world);
    },

    _revealAllTiles(world) {
        for (let r = 0; r < world.height; r++) {
            const row = world.tiles[r];
            if (!row) continue;
            for (let q = 0; q < world.width; q++) {
                const tile = row[q];
                if (tile) {
                    tile.explored = true;
                    tile.visible = true;
                }
            }
        }
        if (this.game.minimap) this.game.minimap.invalidate();
    },

    cheatGold(amount) {
        this.game.player.gold += amount;
        this._cheatDone('Gold', `+${amount.toLocaleString()} gold`);
    },

    cheatFood(amount) {
        const inv = this.game.player.inventory;
        inv.bread = (inv.bread || 0) + amount;
        this._cheatDone('Food', `+${amount} bread`);
    },

    cheatHeal() {
        const p = this.game.player;
        p.health = p.maxHealth;
        p.starvationDays = 0;
        if (p.needs) for (const k of Object.keys(p.needs)) p.needs[k] = 100;
        this._cheatDone('Healed', 'Health and needs restored');
    },

    cheatRefill() {
        const { player, world, renderer } = this.game;
        player.movementRemaining = Math.max(player.movementRemaining || 0, player.stamina);
        player.actionPoints = player.maxActionPoints;
        if (renderer && !player.isMoving) renderer.reachableHexes = player.getReachableHexes(world);
        this._cheatDone('Refreshed', 'Movement and action points refilled');
    },

    cheatRenown(amount) {
        this.game.player.renown = (this.game.player.renown || 0) + amount;
        this._cheatDone('Renown', `+${amount} renown`);
    },

    cheatKarma(amount) {
        this.game.player.karma = (this.game.player.karma || 0) + amount;
        this._cheatDone('Karma', `${amount > 0 ? '+' : ''}${amount} karma`);
    },

    cheatPrestige(amount) {
        const { player, world } = this.game;
        if (!player.house) {
            this.showNotification('🧪 Prestige', 'You have no House yet.', 'error');
            return;
        }
        House.award(player.house, amount, 'Divine favour (cheat)', world.day);
        this._cheatDone('Prestige', `+${amount} prestige`);
    },

    cheatAttributes(amount) {
        const p = this.game.player;
        for (const k of ['strength', 'charisma', 'intelligence', 'faith', 'luck']) p[k] = (p[k] || 0) + amount;
        this._cheatDone('Attributes', `+${amount} to every attribute`);
    },

    cheatSkills(amount) {
        const skills = this.game.player.skills || {};
        for (const k of Object.keys(skills)) skills[k] = (skills[k] || 0) + amount;
        this._cheatDone('Skills', `+${amount} to every skill`);
    },

    cheatAddUnits(unitId, count) {
        const def = PlayerMilitary.getUnitDef(unitId);
        if (!def) {
            this.showNotification('🧪 Army', `Unknown unit type: ${unitId}`, 'error');
            return;
        }
        for (let i = 0; i < count; i++) this.game.player.army.push(PlayerMilitary.makeArmyUnit(def));
        this._cheatDone('Army', `+${count} ${def.name || unitId}`);
    },

    cheatRevealMap() {
        this._revealAllTiles(this.game.world);
        this._cheatDone('Map revealed', 'Every hex is now explored');
    },

    cheatArmTeleport() {
        this.game._cheatTeleportArmed = true;
        this.hideCustomPanel();
        this.showNotification('🧪 Teleport', 'Click any hex on the map to teleport there. Esc cancels.', 'info');
    },

    /** Move the player straight to (q, r). Returns true when it happened. */
    cheatTeleportTo(q, r) {
        const { player, world, renderer } = this.game;
        this.game._cheatTeleportArmed = false;
        const wq = Hex.wrapQ(q, world.width);
        if (r < 0 || r >= world.height || !player._canEnterHex(wq, r, world)) {
            this.showNotification('🧪 Teleport', 'You cannot stand there.', 'error');
            return false;
        }
        player.cancelTravel();
        player.prevQ = player.q;
        player.prevR = player.r;
        player.q = wq;
        player.r = r;
        player.revealArea(world, 4);
        player.updateVisibility(world);
        this.applyCheats(true);
        renderer.reachableHexes = player.getReachableHexes(world);
        this.game.recenterCamera();
        this._cheatDone('Teleported', `Arrived at (${wq}, ${r})`);
        return true;
    },

    /** End `days` days in a row, waiting out each day's processing */
    cheatSkipDays(days) {
        const game = this.game;
        if (game.isProcessingTurn) return;
        this.hideCustomPanel();
        game.player.usedCheats = true;
        let left = days;
        const next = () => {
            if (left <= 0 || !game.isRunning) {
                this.showNotification('🧪 Time skipped', `${days} day${days === 1 ? '' : 's'} passed`, 'success');
                return;
            }
            if (game.isProcessingTurn) {
                setTimeout(next, 50);
                return;
            }
            left--;
            game._endDayConfirmed = true;
            game.endDay();
            setTimeout(next, 50);
        };
        next();
    },
});
