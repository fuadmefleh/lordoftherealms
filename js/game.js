// ============================================
// GAME — Main game controller
// ============================================

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.camera = new Camera(this.canvas);
        this.renderer = new Renderer(this.canvas, this.camera);
        this.world = null;
        this.player = null;
        this.ui = null;
        this.minimap = null;

        this.isRunning = false;
        this.lastTime = 0;

        // Mouse state
        this.mouseX = 0;
        this.mouseY = 0;
        this.mouseDown = false;
        this.mouseDownTime = 0;
        this.mouseDownPos = { x: 0, y: 0 };
        this.isProcessingTurn = false;

        this.setupInputHandlers();
        this.initTitleScreen();

        // Title screen buttons — must be bound here since UI isn't created yet
        document.getElementById('btnNewGame').addEventListener('click', () => this.showSettingsScreen());
        document.getElementById('btnBackToTitle').addEventListener('click', () => this.hideSettingsScreen());
        document.getElementById('btnStartGame').addEventListener('click', () => this.startNewGame());

        // Continue button logic
        const btnContinue = document.getElementById('btnContinue');
        if (SaveLoad.hasSave()) {
            btnContinue.disabled = false;
            btnContinue.addEventListener('click', () => this.resumeGame());
        }

        // Range input value displays
        const ranges = ['worldWidth', 'worldHeight', 'continentCount', 'terrainFreq', 'riverCount', 'waterLevel'];
        ranges.forEach(id => {
            const el = document.getElementById(id);
            const val = document.getElementById('val' + id.charAt(0).toUpperCase() + id.slice(1));
            if (el && val) {
                el.addEventListener('input', () => {
                    val.textContent = el.value;
                });
            }
        });
    }

    /**
     * Resume a saved game
     */
    resumeGame() {
        const result = SaveLoad.loadGame();
        if (!result.success) return;

        const data = result.data;

        // Reconstruct world
        this.world = new World(data.world.width, data.world.height);
        this.world.generate(); // Regenerate terrain
        SaveLoad.restoreWorld(data.world, this.world);

        // Recalculate regions for routing (important for older saves)
        Terrain.identifyRegions(this.world.tiles, this.world.width, this.world.height);

        // Reconstruct player
        this.player = new Player();
        SaveLoad.restorePlayer(data.player, this.player);

        // Restore fog of war visibility around player position
        this.player.updateVisibility(this.world, 4);

        // Setup renderer
        this.renderer.setWorld(this.world);
        this.renderer.setPlayer(this.player);

        // Initialize market dynamics
        MarketDynamics.initialize();

        // Initialize character system for kingdoms that don't have it yet (older saves)
        if (typeof Characters !== 'undefined') {
            for (const kingdom of this.world.kingdoms) {
                if (kingdom.isAlive && !kingdom.characterData) {
                    const familyData = Characters.generateRoyalFamily(kingdom, this.world);
                    kingdom.characterData = familyData;
                    kingdom.ruler = Characters.getDisplayName(familyData.ruler, kingdom);
                }
            }
        }

        // Bounds
        const worldPixelWidth = Math.sqrt(3) * this.renderer.hexSize * this.world.width;
        const worldPixelHeight = 1.5 * this.renderer.hexSize * this.world.height;
        this.camera.setWorldBounds(worldPixelWidth, worldPixelHeight);

        // Center on player
        const playerPos = Hex.axialToPixel(this.player.q, this.player.r, this.renderer.hexSize);
        this.camera.centerOn(playerPos.x, playerPos.y);

        // UI
        this.ui = new UI(this);
        this.ui.updateStats(this.player, this.world);
        this.minimap = new Minimap(this);

        this.ui.hideTitleScreen();
        this.ui.showNotification('Game Loaded', 'Welcome back, ' + this.player.name, 'success');

        this.isRunning = true;
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    /**
     * Show settings screen
     */
    showSettingsScreen() {
        document.getElementById('titleScreen').classList.add('hidden');
        document.getElementById('settingsScreen').classList.remove('hidden');
    }

    /**
     * Hide settings screen
     */
    hideSettingsScreen() {
        document.getElementById('settingsScreen').classList.add('hidden');
        document.getElementById('titleScreen').classList.remove('hidden');
    }

    /**
     * Initialize the title screen animation
     */
    initTitleScreen() {
        const canvas = document.getElementById('titleBgCanvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Animated particle field for title screen
        const particles = [];
        for (let i = 0; i < 120; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: Utils.randFloat(-0.3, 0.3),
                vy: Utils.randFloat(-0.2, -0.8),
                size: Utils.randFloat(1, 3),
                alpha: Utils.randFloat(0.1, 0.5),
                color: Utils.randPick(['#f5c542', '#c49a2a', '#ffe08a', '#ffffff']),
            });
        }

        const animateTitle = () => {
            if (!document.getElementById('titleScreen') ||
                document.getElementById('titleScreen').classList.contains('hidden')) return;

            ctx.fillStyle = 'rgba(10, 14, 23, 0.15)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;

                if (p.y < -10) {
                    p.y = canvas.height + 10;
                    p.x = Math.random() * canvas.width;
                }
                if (p.x < -10) p.x = canvas.width + 10;
                if (p.x > canvas.width + 10) p.x = -10;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.alpha;
                ctx.fill();
                ctx.globalAlpha = 1;
            }

            requestAnimationFrame(animateTitle);
        };

        animateTitle();
    }

    /**
     * Start a new game
     */
    startNewGame() {
        console.log('Starting new game with custom settings...');

        // Read character settings
        const charName = document.getElementById('charName').value || 'Wanderer';
        const charGender = document.getElementById('charGender').value;
        const charAge = parseInt(document.getElementById('charAge').value) || 20;

        // Read world settings
        const width = parseInt(document.getElementById('worldWidth').value) || 120;
        const height = parseInt(document.getElementById('worldHeight').value) || 80;
        const continentCount = parseInt(document.getElementById('continentCount').value) || 3;
        const terrainFreq = parseFloat(document.getElementById('terrainFreq').value) || 1.1;
        const riverCount = parseInt(document.getElementById('riverCount').value) || 40;
        const waterThreshold = parseFloat(document.getElementById('waterLevel').value) || 0.42;

        // Generate world
        this.world = new World(width, height);
        this.world.generate({
            continentCount,
            terrainFreq,
            riverCount,
            waterThreshold
        });

        // Create player
        this.player = new Player({
            name: charName,
            gender: charGender,
            age: charAge
        });
        this.player.placeInWorld(this.world);

        // Setup renderer
        this.renderer.setWorld(this.world);
        this.renderer.setPlayer(this.player);

        // Calculate world pixel bounds for camera wrapping
        const worldPixelWidth = Math.sqrt(3) * this.renderer.hexSize * this.world.width;
        const worldPixelHeight = 1.5 * this.renderer.hexSize * this.world.height;
        this.camera.setWorldBounds(worldPixelWidth, worldPixelHeight);

        // Center camera on player
        const playerPos = Hex.axialToPixel(this.player.q, this.player.r, this.renderer.hexSize);
        this.camera.centerOn(playerPos.x, playerPos.y);

        // Initialize UI
        this.ui = new UI(this);
        this.ui.updateStats(this.player, this.world);

        // Initialize minimap
        this.minimap = new Minimap(this);

        // Initialize quests and achievements
        Quests.initialize(this.player);
        Achievements.initialize(this.player);

        // Initialize market dynamics
        MarketDynamics.initialize();

        // Initialize technology system
        if (typeof Technology !== 'undefined') {
            Technology.initPlayer(this.player);
        }

        // Initialize player's tax rate
        if (!this.player.taxRate) this.player.taxRate = 'moderate';

        console.log('Game started!');
        // Hide title and settings screen
        document.getElementById('settingsScreen').classList.add('hidden');
        this.ui.hideTitleScreen();

        // Show welcome notification
        setTimeout(() => {
            this.ui.showNotification('Welcome, ' + this.player.name, 'You are a wanderer in a world of kingdoms. Click on the map to move, explore settlements, and forge your destiny.', 'info');
        }, 1200);

        // Start game loop
        this.isRunning = true;
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    /**
     * Main game loop
     */
    gameLoop(timestamp) {
        if (!this.isRunning) return;

        const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.1);
        this.lastTime = timestamp;

        // Update camera
        this.camera.update(deltaTime);

        // Space to center on player
        if (this.camera.keys[' ']) {
            const pos = Hex.axialToPixel(this.player.q, this.player.r, this.renderer.hexSize);
            this.camera.follow(pos.x, pos.y);
        }

        // Update weather
        if (this.world && this.world.weather) {
            this.world.weather.update(deltaTime);
        }

        // Update player movement
        if (this.player.isMoving) {
            const moved = this.player.stepAlongPath(this.world, deltaTime);
            if (moved) {
                this.ui.updateStats(this.player, this.world);
                this.minimap.invalidate();

                // Check if arrived at destination
                if (!this.player.isMoving) {
                    if (this.player.queuedPath) {
                        // Ran out of stamina mid-journey — auto-end day to continue
                        const dest = this.player.travelDestination;
                        const remaining = this.player.queuedPath.length - this.player.queuedPathIndex;
                        this.ui.showNotification('Resting for the Night',
                            `~${remaining} tiles remaining to destination. Press Escape to cancel.`, 'info');
                        this.endDay();
                    } else {
                        this.onPlayerArrived();
                    }
                }

                // Camera follow removed to allow free-panning while moving
                // const pos = Hex.axialToPixel(this.player.q, this.player.r, this.renderer.hexSize);
                // this.camera.follow(pos.x, pos.y);
            }
        }

        // Update hover hex
        this.updateHoveredHex();

        // Render
        this.renderer.render(deltaTime);

        // Render minimap (less frequently)
        this.minimap.render();

        requestAnimationFrame((t) => this.gameLoop(t));
    }

    /**
     * Set up mouse/click handlers
     */
    setupInputHandlers() {
        this.canvas.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0 || e.button === 2) {
                this.mouseDown = true;
                this.mouseDownButton = e.button;
                this.mouseDownTime = Date.now();
                this.mouseDownX = e.clientX;
                this.mouseDownY = e.clientY;
            }
        });

        // Mouse up
        this.canvas.addEventListener('mouseup', (e) => {
            if (this.mouseDown && e.button === this.mouseDownButton) {
                const dist = Math.hypot(e.clientX - this.mouseDownX, e.clientY - this.mouseDownY);
                const timeDiff = Date.now() - this.mouseDownTime;
                if (dist < 5 && timeDiff < 500) {
                    // Left click = show info, Right click = move
                    if (e.button === 0) {
                        this.handleClick(e.clientX, e.clientY, 'left');
                    } else if (e.button === 2) {
                        this.handleClick(e.clientX, e.clientY, 'right');
                    }
                }
                this.mouseDown = false;
            }
        });

        // Prevent context menu on right-click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

        // Double-click for quick info
        this.canvas.addEventListener('dblclick', (e) => {
            this.handleDoubleClick(e.clientX, e.clientY);
        });

        // Keyboard shortcut: M to cycle map modes
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.key === 'm' || e.key === 'M') {
                const modes = ['normal', 'political', 'religion', 'wealth', 'military', 'trade', 'culture'];
                const current = this.renderer.mapMode;
                const idx = modes.indexOf(current);
                const next = modes[(idx + 1) % modes.length];
                this.ui.setMapMode(next);
            }
            if (e.key === 'Escape') {
                if (this.player && (this.player.queuedPath || this.player.isMoving)) {
                    this.player.cancelTravel();
                    this.renderer.reachableHexes = this.player.getReachableHexes(this.world);
                    this.ui.showNotification('Travel Cancelled', 'You stopped your journey.', 'default');
                }
            }
        });
    }

    /**
     * Update the hovered hex based on mouse position
     */
    updateHoveredHex() {
        if (!this.world) return;
        const hex = this.renderer.getHexAtScreen(this.mouseX, this.mouseY);
        this.renderer.hoveredHex = hex;
    }

    /**
     * Handle click on the map
     */
    handleClick(screenX, screenY, button = 'left') {
        if (!this.world || !this.player) return;

        const hex = this.renderer.getHexAtScreen(screenX, screenY);
        if (!hex) return;

        const tile = this.world.getTile(hex.q, hex.r);
        if (!tile) return;

        // Left click = show info
        if (button === 'left') {
            this.renderer.selectedHex = hex;
            this.ui.showHexInfo(tile, hex.q, hex.r);

            // If clicking on self, open action menu
            if (this.player.q === hex.q && this.player.r === hex.r) {
                ActionMenu.show(this, tile);
            }
            return;
        }

        // Right click = move
        if (button === 'right') {
            // If clicking on a passable, explored tile — try to move there
            if (tile.terrain.passable) {
                // Don't move if clicking current position
                if (hex.q === this.player.q && hex.r === this.player.r) {
                    return;
                }

                const success = this.player.moveTo(hex.q, hex.r, this.world);
                if (success) {
                    this.renderer.selectedHex = null;
                    // Update reachable hexes
                    this.renderer.reachableHexes = null;
                } else {
                    this.ui.showNotification('No Path', 'Cannot reach that location!', 'error');
                }
            } else {
                this.ui.showNotification('Cannot Move', 'That tile is not accessible!', 'error');
            }
        }
    }

    /**
     * Handle double-click — show detailed info
     */
    handleDoubleClick(screenX, screenY) {
        if (!this.world) return;

        const hex = this.renderer.getHexAtScreen(screenX, screenY);
        if (!hex) return;

        const tile = this.world.getTile(hex.q, hex.r);
        if (!tile || !tile.explored) return;

        this.renderer.selectedHex = hex;
        this.ui.showHexInfo(tile, hex.q, hex.r);

        // If tile belongs to a kingdom, also show kingdom panel
        if (tile.kingdom) {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                this.ui.showKingdomInfo(kingdom);
            }
        }
    }

    /**
     * Player arrived at destination
     */
    onPlayerArrived() {
        const tile = this.world.getTile(this.player.q, this.player.r);
        if (!tile) return;

        // Show reachable hexes
        this.renderer.reachableHexes = this.player.getReachableHexes(this.world);

        // If arrived at a settlement
        if (tile.settlement) {
            const sType = tile.settlement.type;
            this.ui.showNotification(
                `Arrived at ${tile.settlement.name}`,
                `You have arrived at this ${sType}. Population: ${Utils.formatNumber(tile.settlement.population)}.`,
                'success'
            );
        }

        // If arrived at a point of interest
        if (tile.improvement && !tile.improvement.explored) {
            // Just notify discovery, don't mark as explored (use Explore action for full rewards)
            this.ui.showNotification(
                'Location Discovered',
                `You found ${tile.improvement.name}! ${tile.improvement.icon} Use the Explore action to investigate.`,
                'info'
            );
        }

        // If tile has resources
        if (tile.resource) {
            this.ui.showNotification(
                'Resources Found',
                `This area has ${tile.resource.name} ${tile.resource.icon}`,
                'info'
            );
        }
    }

    /**
     * End the current day
     */
    endDay() {
        if (!this.world || !this.player) return;
        if (this.isProcessingTurn) return;

        this.isProcessingTurn = true;
        document.body.style.cursor = 'wait';

        // Use setTimeout to allow UI to update (show loading state) before heavy processing
        setTimeout(() => {
            try {
                // Process player's daily activities
                const playerResults = PlayerActions.endDay(this.player, this.world);

                // Process world turn
                const result = this.world.advanceDay();
                this.player.endDay();
                this.player.updateVisibility(this.world, 4);

                // Update market prices
                MarketDynamics.updatePrices(this.world);

                // Process informants and expire old intel
                let intelResult = { cost: 0 };
                if (typeof Tavern !== 'undefined') {
                    Tavern.expireOldIntel(this.player, this.world.day);
                    intelResult = Tavern.processInformants(this.player, this.world);
                    if (intelResult.cost > 0) {
                        this.ui.showNotification('Informants', `-${intelResult.cost}g upkeep`, 'default');
                    }
                    if (intelResult.lostInformants > 0) {
                        this.ui.showNotification('Informant Lost', `${intelResult.lostInformants} informant(s) left — couldn't pay`, 'error');
                    }
                    if (intelResult.newRumors && intelResult.newRumors.length > 0) {
                        this.ui.showNotification('New Intel', `${intelResult.newRumors.length} new report(s) from informants`, 'info');
                    }
                }

                // Process loans
                const loanResults = Banking.processLoans(this.player, this.world);
                if (loanResults.paid > 0) {
                    this.ui.showNotification('Loan Payment', `-${loanResults.paid} gold`, 'default');
                }
                for (const defaulted of loanResults.defaulted) {
                    if (defaulted.seizedProperty) {
                        this.ui.showNotification('Property Seized!', `Couldn't pay loan - property confiscated!`, 'error');
                    } else {
                        this.ui.showNotification('Loan Default', `Missed payment! +5% penalty`, 'error');
                    }
                }

                // Collect taxes (every 7 days)
                let taxCollected = 0;
                if (this.world.day % 7 === 0) {
                    const taxResults = Taxation.collectTaxes(this.player, this.world);
                    taxCollected = taxResults.collected || 0;
                    if (taxCollected > 0) {
                        this.ui.showNotification('Tax Collection', `+${taxCollected} gold from settlements`, 'success');
                    }
                }

                // Resume queued multi-day travel if any
                if (this.player.queuedPath) {
                    const resumed = this.player.resumeQueuedPath();
                    if (resumed) {
                        const dest = this.player.travelDestination;
                        const remaining = this.player.path.length - this.player.pathIndex;
                        this.ui.showNotification('Resuming Travel',
                            `Continuing journey${dest ? ` to (${dest.q}, ${dest.r})` : ''} — ~${remaining} tiles remaining`, 'info');
                    }
                }

                // Show reachable hexes for the new day
                this.renderer.reachableHexes = this.player.getReachableHexes(this.world);

                this.ui.updateStats(this.player, this.world);
                this.minimap.invalidate();

                // Show player production notifications
                if (playerResults.production && Object.keys(playerResults.production).length > 0) {
                    let msg = 'Produced: ';
                    const parts = [];
                    for (const [good, amount] of Object.entries(playerResults.production)) {
                        if (amount > 0) {
                            const icon = PlayerEconomy.GOODS[good.toUpperCase()] ? PlayerEconomy.GOODS[good.toUpperCase()].icon : '';
                            const name = PlayerEconomy.GOODS[good.toUpperCase()] ? PlayerEconomy.GOODS[good.toUpperCase()].name : good;
                            parts.push(`${icon} ${amount} ${name}`);
                        }
                    }
                    if (parts.length > 0) {
                        this.ui.showNotification('Production', msg + parts.join(', '), 'success');
                        this.ui.showNotification('Storage', 'Visit properties to collect produced goods', 'info');
                    }
                }

                if (playerResults.faithIncome > 0) {
                    this.ui.showNotification('Faith Income', `+${playerResults.faithIncome} gold from followers`, 'success');
                }

                // Chance for traveling merchants
                PlayerEconomy.spawnTravelingMerchant(this.player, this.world);

                if (playerResults.upkeepCost > 0) {
                    this.ui.showNotification('Army Upkeep', `-${playerResults.upkeepCost} gold`, 'default');
                }

                if (playerResults.unitsLost > 0) {
                    this.ui.showNotification('Desertion!', `Lost ${playerResults.unitsLost} units (couldn't pay upkeep)`, 'error');
                }

                // Caravan completions
                for (const caravan of playerResults.caravansCompleted) {
                    this.ui.showNotification('Caravan Arrived!', `${caravan.from} → ${caravan.to}: +${caravan.finalProfit} gold`, 'success');
                }

                // Contract updates
                if (playerResults.contractUpdate && playerResults.contractUpdate.completed) {
                    const c = playerResults.contractUpdate;
                    if (c.casualties > 0) {
                        this.ui.showNotification('Contract Complete', `${c.contract.name} finished. Lost ${c.casualties} units. +${c.payment} gold`, 'default');
                    } else {
                        this.ui.showNotification('Contract Complete!', `${c.contract.name} finished successfully! +${c.payment} gold`, 'success');
                    }
                }

                // Faith spread
                if (playerResults.followersGained > 0) {
                    this.ui.showNotification('Faith Spreads', `+${playerResults.followersGained} followers`, 'info');
                }

                // Blessings expired
                for (const blessing of playerResults.blessingsExpired) {
                    this.ui.showNotification('Blessing Faded', `${blessing} blessing has expired`, 'default');
                }

                // Technology research progress
                if (playerResults.researchUpdate) {
                    if (playerResults.researchUpdate.completed) {
                        this.ui.showNotification('Research Complete!', `🔬 ${playerResults.researchUpdate.tech.name} blueprint acquired! Craft parts to implement.`, 'success');
                    } else if (playerResults.researchUpdate.remaining) {
                        if (playerResults.researchUpdate.remaining <= 1) {
                            this.ui.showNotification('Research', `Almost done! 1 day remaining`, 'info');
                        }
                    }
                }

                // Parts crafting progress
                if (playerResults.craftingUpdate) {
                    if (playerResults.craftingUpdate.completed) {
                        this.ui.showNotification('Crafting Complete!', `🔧 ${playerResults.craftingUpdate.quantity}x parts crafted and added to inventory!`, 'success');
                    } else if (playerResults.craftingUpdate.remaining) {
                        if (playerResults.craftingUpdate.remaining <= 1) {
                            this.ui.showNotification('Crafting', `Parts almost ready! 1 day remaining`, 'info');
                        }
                    }
                }

                // Cultural building income
                if (playerResults.cultureIncome > 0) {
                    this.ui.showNotification('Cultural Income', `+${playerResults.cultureIncome} gold from cultural buildings`, 'success');
                }
                if (playerResults.cultureRenown > 0) {
                    this.ui.showNotification('Cultural Renown', `+${playerResults.cultureRenown} renown from monuments`, 'info');
                }

                // Indentured servitude updates
                if (playerResults.servitudeUpdate) {
                    const su = playerResults.servitudeUpdate;
                    if (su.freed) {
                        this.ui.showNotification('Freedom!', su.message, 'success');
                    } else {
                        this.ui.showNotification('Indentured Servitude', su.message, 'default');
                    }
                }

                // Show day events
                if (result.events.length > 0) {
                    for (const event of result.events) {
                        this.ui.showNotification('World Event', event.text, 'info');
                    }
                }

                // Check for completed quests
                const completedQuests = Quests.updateProgress(this.player, this.world);
                for (const quest of completedQuests) {
                    this.ui.showNotification('Quest Complete!', `${quest.title} - Rewards: ${JSON.stringify(quest.rewards)}`, 'success');
                }

                // Check for new achievements
                const newAchievements = Achievements.checkAchievements(this.player, this.world);
                for (const achievement of newAchievements) {
                    this.ui.showNotification('Achievement Unlocked!', `${achievement.icon} ${achievement.name}: ${achievement.description}`, 'success');
                }

                // Auto-save every 5 days
                if (this.world.day % SaveLoad.AUTO_SAVE_INTERVAL === 0) {
                    const result = SaveLoad.saveGame(this);
                    if (result.success) {
                        this.ui.showNotification('Auto-Saved', 'Game progress saved', 'default');
                    }
                }

                // ── Record daily finances ──────────────────────────────
                const dayFinance = {
                    day: this.world.day,
                    season: this.world.season,
                    year: this.world.year,
                    goldEnd: this.player.gold,
                    income: {},
                    expenses: {},
                };

                // Income sources
                if (playerResults.faithIncome > 0) dayFinance.income.faith = playerResults.faithIncome;
                if (playerResults.cultureIncome > 0) dayFinance.income.culture = playerResults.cultureIncome;

                // Caravan profits
                let caravanProfit = 0;
                for (const c of playerResults.caravansCompleted) {
                    caravanProfit += c.finalProfit || 0;
                }
                if (caravanProfit > 0) dayFinance.income.caravans = caravanProfit;

                // Contract payment
                if (playerResults.contractUpdate && playerResults.contractUpdate.completed) {
                    dayFinance.income.contracts = playerResults.contractUpdate.payment || 0;
                }

                // Tax income
                if (taxCollected > 0) dayFinance.income.taxes = taxCollected;

                // Expense sources
                if (playerResults.upkeepCost > 0) dayFinance.expenses.armyUpkeep = playerResults.upkeepCost;
                if (loanResults && loanResults.paid > 0) dayFinance.expenses.loanPayments = loanResults.paid;
                if (typeof Tavern !== 'undefined' && intelResult && intelResult.cost > 0) dayFinance.expenses.informants = intelResult.cost;

                // Property upkeep (calculated from properties)
                let propertyUpkeep = 0;
                if (this.player.properties) {
                    for (const prop of this.player.properties) {
                        const tile = this.world.getTile(prop.q, prop.r);
                        if (tile && tile.playerProperty) {
                            propertyUpkeep += (tile.playerProperty.upkeep || 0) * (tile.playerProperty.level || 1);
                        }
                    }
                }
                if (propertyUpkeep > 0) dayFinance.expenses.propertyUpkeep = propertyUpkeep;

                // Calculate totals
                dayFinance.totalIncome = Object.values(dayFinance.income).reduce((a, b) => a + b, 0);
                dayFinance.totalExpenses = Object.values(dayFinance.expenses).reduce((a, b) => a + b, 0);
                dayFinance.netChange = dayFinance.totalIncome - dayFinance.totalExpenses;

                // Store — keep last 90 days
                if (!this.player.financeHistory) this.player.financeHistory = [];
                this.player.financeHistory.push(dayFinance);
                if (this.player.financeHistory.length > 90) {
                    this.player.financeHistory = this.player.financeHistory.slice(-90);
                }

                this.ui.showNotification('New Day', `Day ${((this.world.day - 1) % 30) + 1} of ${this.world.season}, Year ${this.world.year}`, 'default');
            } catch (e) {
                console.error("Error ending day:", e);
                this.ui.showNotification('Error', 'Failed to end day. Check console.', 'error');
            } finally {
                this.isProcessingTurn = false;
                document.body.style.cursor = 'default';
            }
        }, 50);
    }

    /**
     * Player prays (gain karma)
     */
    playerPray() {
        if (!this.player) return;

        this.player.karma += 1;
        this.ui.updateStats(this.player, this.world);
        this.ui.showNotification('Prayer', 'You take a moment to pray. ☯ +1 Karma', 'success');

        // At certain karma thresholds, unlock religious path
        if (this.player.karma === 10 && !this.player.religion) {
            this.ui.showNotification(
                'Spiritual Awakening',
                'You feel a deeper connection to the divine. Perhaps you could found a religion...',
                'info'
            );
        }
    }

    /**
     * Load PNG tile sprites from a directory
     * Call this with paths to your PNG assets
     */
    async loadTileSprites(spriteMap) {
        // spriteMap is { terrainId: 'path/to/sprite.png', ... }
        const promises = [];
        for (const [terrainId, path] of Object.entries(spriteMap)) {
            promises.push(this.renderer.loadTileSprite(terrainId, path));
        }
        try {
            await Promise.all(promises);
            console.log('All tile sprites loaded!');
            this.minimap?.invalidate();
        } catch (err) {
            console.warn('Some tile sprites failed to load:', err);
        }
    }
}

// ============================================
// BOOT
// ============================================

window.addEventListener('DOMContentLoaded', () => {
    window.game = new Game();

    /**
     * To load custom PNG tile sprites, call:
     *
     * game.loadTileSprites({
     *     plains: 'assets/tiles/plains.png',
     *     ocean: 'assets/tiles/ocean.png',
     *     forest: 'assets/tiles/forest.png',
     *     mountain: 'assets/tiles/mountain.png',
     *     // ... etc
     * });
     *
     * Place your PNG files in an assets/tiles/ directory.
     * Each PNG should be a square image (e.g., 128x128) that will be
     * clipped to the hex shape and rendered as the terrain texture.
     */
});
