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

        // Inner map state
        this.innerMapCamera = new Camera(this.canvas);
        this.innerMapMode = false;

        this.setupInputHandlers();
        this.initTitleScreen();
        this._setupAudioControls();

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
        const ranges = [
            'worldWidth', 'worldHeight', 'continentCount', 'terrainFreq', 'riverCount', 'waterLevel',
            'islandFreq', 'landMass', 'mountainDensity', 'hillDensity', 'forestDensity',
            'terrainOctaves', 'heatFreq', 'moistFreq', 'coastalDetail',
            'deepWaterLevel', 'hillsLevel', 'mountainLevel', 'snowPeakLevel',
            'kingdomCount'
        ];
        ranges.forEach(id => {
            const el = document.getElementById(id);
            const val = document.getElementById('val' + id.charAt(0).toUpperCase() + id.slice(1));
            if (el && val) {
                el.addEventListener('input', () => {
                    if (val.classList.contains('range-value-pct')) {
                        val.textContent = el.value + '%';
                    } else {
                        val.textContent = el.value;
                    }
                });
            }
        });

        // Map size presets
        const presets = {
            tiny:   { width: 60,  height: 40,  continents: 2,  rivers: 15 },
            small:  { width: 90,  height: 60,  continents: 2,  rivers: 25 },
            medium: { width: 120, height: 80,  continents: 3,  rivers: 40 },
            large:  { width: 200, height: 130, continents: 5,  rivers: 70 },
            huge:   { width: 300, height: 200, continents: 8,  rivers: 120 },
            epic:   { width: 450, height: 300, continents: 12, rivers: 180 }
        };

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = presets[btn.dataset.preset];
                if (!preset) return;

                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const setVal = (id, value) => {
                    const el = document.getElementById(id);
                    const valEl = document.getElementById('val' + id.charAt(0).toUpperCase() + id.slice(1));
                    if (el) { el.value = value; if (valEl) valEl.textContent = value; }
                };
                setVal('worldWidth', preset.width);
                setVal('worldHeight', preset.height);
                setVal('continentCount', preset.continents);
                setVal('riverCount', preset.rivers);
            });
        });

        // Randomize button
        const btnRandomize = document.getElementById('btnRandomize');
        if (btnRandomize) {
            btnRandomize.addEventListener('click', () => this.randomizeSettings());
        }
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
        this.ui.applySettings();
        this.ui.updateStats(this.player, this.world);
        this.minimap = new Minimap(this);

        // Restore notification log from save
        if (data.notificationLog) {
            this.ui.notificationLog = data.notificationLog;
        }

        this.ui.hideTitleScreen();
        this.ui.showNotification('Game Loaded', 'Welcome back, ' + this.player.name, 'success');

        // Initialize relationships from save
        if (typeof Relationships !== 'undefined') {
            Relationships.initialize(this.player);
        }

        // Restore ships state
        if (typeof Ships !== 'undefined') {
            Ships.restoreFromSave(this.player);
        }

        // Initialize title system from save
        if (typeof Titles !== 'undefined') {
            Titles.initialize(this.player);
        }

        this.isRunning = true;
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));

        // Start context-aware music
        audioManager.updateSceneFromGameState(this);
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
     * Setup audio mute/volume button and popup controls
     */
    _setupAudioControls() {
        const btn = document.getElementById('btnAudioToggle');
        if (!btn) return;

        // Build volume popup
        const popup = document.createElement('div');
        popup.className = 'audio-volume-popup';
        popup.innerHTML = `
            <h4>🎵 Audio</h4>
            <div class="audio-slider-row">
                <label>Master</label>
                <input type="range" min="0" max="100" value="${Math.round(audioManager.masterVolume * 100)}" id="audioMaster">
                <span class="audio-val" id="audioMasterVal">${Math.round(audioManager.masterVolume * 100)}%</span>
            </div>
            <div class="audio-slider-row">
                <label>Music</label>
                <input type="range" min="0" max="100" value="${Math.round(audioManager.musicVolume * 100)}" id="audioMusic">
                <span class="audio-val" id="audioMusicVal">${Math.round(audioManager.musicVolume * 100)}%</span>
            </div>
            <div class="audio-slider-row">
                <label>Ambience</label>
                <input type="range" min="0" max="100" value="${Math.round(audioManager.ambienceVolume * 100)}" id="audioAmbience">
                <span class="audio-val" id="audioAmbienceVal">${Math.round(audioManager.ambienceVolume * 100)}%</span>
            </div>
            <div class="audio-slider-row">
                <label>SFX</label>
                <input type="range" min="0" max="100" value="${Math.round(audioManager.sfxVolume * 100)}" id="audioSfx">
                <span class="audio-val" id="audioSfxVal">${Math.round(audioManager.sfxVolume * 100)}%</span>
            </div>
            <div class="audio-scene-label" id="audioSceneLabel">Scene: Title</div>
        `;
        btn.appendChild(popup);

        // Grab the icon span (keeps popup safe when updating icon)
        const iconSpan = btn.querySelector('.audio-icon');

        // Update mute state display
        if (audioManager.muted) {
            btn.classList.add('muted');
            if (iconSpan) iconSpan.textContent = '🔇';
        }

        // Toggle popup on click
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Init audio on first user interaction
            audioManager.init();
            audioManager._resume();

            // Only toggle popup when clicking the button or icon, not popup internals
            if (e.target === btn || e.target === iconSpan) {
                popup.classList.toggle('visible');
            }
        });

        // Right-click to quick-mute
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            audioManager.init();
            const muted = audioManager.toggleMute();
            btn.classList.toggle('muted', muted);
            if (iconSpan) iconSpan.textContent = muted ? '🔇' : '🔊';
        });

        // Wire sliders
        const bindSlider = (id, valId, setter) => {
            const slider = popup.querySelector('#' + id);
            const valEl = popup.querySelector('#' + valId);
            if (slider && valEl) {
                slider.addEventListener('input', () => {
                    const v = parseInt(slider.value);
                    valEl.textContent = v + '%';
                    setter(v / 100);
                });
            }
        };

        bindSlider('audioMaster', 'audioMasterVal', v => audioManager.setMasterVolume(v));
        bindSlider('audioMusic', 'audioMusicVal', v => audioManager.setMusicVolume(v));
        bindSlider('audioAmbience', 'audioAmbienceVal', v => audioManager.setAmbienceVolume(v));
        bindSlider('audioSfx', 'audioSfxVal', v => audioManager.setSfxVolume(v));

        // Close popup when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!btn.contains(e.target)) {
                popup.classList.remove('visible');
            }
        });

        // Start title screen music on first interaction anywhere
        const startTitleMusic = () => {
            audioManager.init();
            audioManager.setScene('title');
            // Update scene label
            const label = document.getElementById('audioSceneLabel');
            if (label) label.textContent = 'Scene: Title';
            document.removeEventListener('click', startTitleMusic);
            document.removeEventListener('keydown', startTitleMusic);
        };
        document.addEventListener('click', startTitleMusic);
        document.addEventListener('keydown', startTitleMusic);

        // Periodically update scene label
        setInterval(() => {
            const label = document.getElementById('audioSceneLabel');
            if (label && audioManager.currentScene !== 'none') {
                const sceneName = audioManager.currentScene.charAt(0).toUpperCase() + audioManager.currentScene.slice(1);
                label.textContent = 'Scene: ' + sceneName;
            }
        }, 2000);
    }

    /**
     * Randomize all world generation settings
     */
    randomizeSettings() {
        const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
        const randFloat = (min, max) => +(min + Math.random() * (max - min)).toFixed(2);
        const randPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

        const setVal = (id, value) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById('val' + id.charAt(0).toUpperCase() + id.slice(1));
            if (el) {
                el.value = value;
                if (valEl) {
                    if (valEl.classList.contains('range-value-pct')) {
                        valEl.textContent = value + '%';
                    } else {
                        valEl.textContent = value;
                    }
                }
            }
        };

        const setSelect = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = value;
        };

        // Random map dimensions
        const sizePresets = ['tiny', 'small', 'medium', 'large', 'huge'];
        const sizes = {
            tiny:   [60, 40],
            small:  [90, 60],
            medium: [120, 80],
            large:  [200, 130],
            huge:   [300, 200]
        };
        const size = randPick(sizePresets);
        setVal('worldWidth', sizes[size][0]);
        setVal('worldHeight', sizes[size][1]);

        // Highlight active preset
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.preset-btn[data-preset="${size}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        setVal('continentCount', randInt(1, 10));
        setSelect('continentSize', randPick(['small', 'medium', 'large', 'pangaea']));
        setVal('islandFreq', randFloat(0, 4.0));
        setVal('landMass', randInt(20, 75));
        setVal('waterLevel', randFloat(0.28, 0.55));
        setVal('riverCount', randInt(5, 150));
        setSelect('lakeFreq', randPick(['none', 'few', 'normal', 'many', 'abundant']));
        setVal('terrainFreq', randFloat(0.6, 2.5));
        setVal('mountainDensity', randInt(20, 180));
        setVal('hillDensity', randInt(30, 170));
        setSelect('flatness', randPick(['rugged', 'normal', 'flat', 'veryFlat']));
        setSelect('temperature', randPick(['frozen', 'cold', 'cool', 'normal', 'warm', 'hot', 'scorching']));
        setSelect('rainfall', randPick(['arid', 'dry', 'normal', 'wet', 'tropical']));
        setSelect('polarIce', randPick(['none', 'minimal', 'normal', 'extensive', 'iceAge']));
        setSelect('desertFreq', randPick(['none', 'few', 'normal', 'many', 'wasteland']));
        setVal('forestDensity', randInt(20, 180));
        setSelect('resourceDensity', randPick(['scarce', 'low', 'normal', 'abundant', 'rich']));
        setSelect('strategicRes', randPick(['scarce', 'normal', 'abundant']));
        setVal('kingdomCount', randInt(2, 15));
        setSelect('independentSettlements', randPick(['none', 'few', 'normal', 'many']));
        setSelect('ruinsFreq', randPick(['none', 'few', 'normal', 'many']));

        // Generate a random seed name
        const seedWords = ['Dragon', 'Storm', 'Crown', 'Sword', 'Iron', 'Gold', 'Frost', 'Shadow', 'Dawn', 'Raven', 'Wolf', 'Oak', 'Fire', 'Stone', 'Moon'];
        const seedEl = document.getElementById('mapSeed');
        if (seedEl) seedEl.value = randPick(seedWords) + randInt(100, 9999);
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

        // Show loading overlay
        const loadingOverlay = document.getElementById('loadingOverlay');
        const loadingSubtext = document.getElementById('loadingSubtext');
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');
        if (loadingSubtext) loadingSubtext.textContent = 'Forging continents and oceans...';

        // Use setTimeout to let the loading overlay render before heavy generation
        setTimeout(() => this._doStartNewGame(), 50);
    }

    /**
     * Internal: perform the actual game start (after loading overlay is shown)
     */
    _doStartNewGame() {
        const loadingOverlay = document.getElementById('loadingOverlay');
        const loadingSubtext = document.getElementById('loadingSubtext');

        try {

        // Read character settings
        const charFirstName = document.getElementById('charFirstName').value.trim() || 'Wanderer';
        const charLastName = document.getElementById('charLastName').value.trim() || '';
        const charGender = document.getElementById('charGender').value;
        const charAge = parseInt(document.getElementById('charAge').value) || 20;

        // Read world settings — dimensions
        const width = parseInt(document.getElementById('worldWidth').value) || 120;
        const height = parseInt(document.getElementById('worldHeight').value) || 80;
        const continentCount = parseInt(document.getElementById('continentCount').value) || 3;
        const terrainFreq = parseFloat(document.getElementById('terrainFreq').value) || 1.1;
        const riverCount = parseInt(document.getElementById('riverCount').value) || 40;
        const waterThreshold = parseFloat(document.getElementById('waterLevel').value) || 0.42;

        // Seed
        const mapSeedEl = document.getElementById('mapSeed');
        const mapSeed = mapSeedEl && mapSeedEl.value.trim() ? mapSeedEl.value.trim() : null;

        // Continent & land
        const continentSize = document.getElementById('continentSize')?.value || 'medium';
        const islandFreq = parseFloat(document.getElementById('islandFreq')?.value) || 1.0;
        const landMass = parseInt(document.getElementById('landMass')?.value) || 45;

        // Terrain & elevation
        const mountainDensity = parseInt(document.getElementById('mountainDensity')?.value) || 100;
        const hillDensity = parseInt(document.getElementById('hillDensity')?.value) || 100;
        const flatness = document.getElementById('flatness')?.value || 'normal';

        // Climate
        const temperature = document.getElementById('temperature')?.value || 'normal';
        const rainfall = document.getElementById('rainfall')?.value || 'normal';
        const polarIce = document.getElementById('polarIce')?.value || 'normal';
        const desertFreq = document.getElementById('desertFreq')?.value || 'normal';
        const forestDensity = parseInt(document.getElementById('forestDensity')?.value) || 100;

        // Water
        const lakeFreq = document.getElementById('lakeFreq')?.value || 'normal';

        // Resources
        const resourceDensity = document.getElementById('resourceDensity')?.value || 'normal';
        const strategicRes = document.getElementById('strategicRes')?.value || 'normal';

        // Advanced noise params
        const terrainOctaves = parseInt(document.getElementById('terrainOctaves')?.value) || 6;
        const heatFreq = parseFloat(document.getElementById('heatFreq')?.value) || 3.0;
        const moistFreq = parseFloat(document.getElementById('moistFreq')?.value) || 2.0;
        const coastalDetail = parseInt(document.getElementById('coastalDetail')?.value) || 5;
        const deepWaterLevel = parseFloat(document.getElementById('deepWaterLevel')?.value) || 0.20;
        const hillsLevel = parseFloat(document.getElementById('hillsLevel')?.value) || 0.52;
        const mountainLevel = parseFloat(document.getElementById('mountainLevel')?.value) || 0.70;
        const snowPeakLevel = parseFloat(document.getElementById('snowPeakLevel')?.value) || 0.88;

        // World/kingdom settings
        const kingdomCount = parseInt(document.getElementById('kingdomCount')?.value) || 6;
        const independentSettlements = document.getElementById('independentSettlements')?.value || 'normal';
        const ruinsFreq = document.getElementById('ruinsFreq')?.value || 'normal';
        const customBuildingsOnly = document.getElementById('customBuildingsOnly')?.checked || false;
        const customObjectsOnly = document.getElementById('customObjectsOnly')?.checked || false;

        // Store game-wide options readable by subsystems (e.g. InnerMap)
        window.gameOptions = window.gameOptions || {};
        window.gameOptions.customBuildingsOnly = customBuildingsOnly;
        window.gameOptions.customObjectsOnly = customObjectsOnly;

        // Clear any cached inner maps from a previous game session
        if (typeof InnerMap !== 'undefined' && InnerMap.clearCache) InnerMap.clearCache();

        // Generate world
        this.world = new World(width, height);
        this.world.generate({
            seed: mapSeed,
            continentCount,
            terrainFreq,
            riverCount,
            waterThreshold,
            continentSize,
            islandFreq,
            landMass,
            mountainDensity,
            hillDensity,
            flatness,
            temperature,
            rainfall,
            polarIce,
            desertFreq,
            forestDensity,
            lakeFreq,
            resourceDensity,
            strategicRes,
            terrainOctaves,
            heatFreq,
            moistFreq,
            coastalDetail,
            deepWaterLevel,
            hillsLevel,
            mountainLevel,
            snowPeakLevel,
            kingdomCount,
            independentSettlements,
            ruinsFreq
        });

        // Create player
        this.player = new Player({
            firstName: charFirstName,
            lastName: charLastName,
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
        this.ui.applySettings();
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

        // Initialize relationships system
        if (typeof Relationships !== 'undefined') {
            Relationships.initialize(this.player);
        }

        // Initialize player's tax rate
        if (!this.player.taxRate) this.player.taxRate = 'moderate';

        // Initialize title system
        if (typeof Titles !== 'undefined') {
            Titles.initialize(this.player);
        }

        // Initialize councils/parliament state
        if (typeof Councils !== 'undefined') {
            Councils.initializePlayer(this.player);
        }

        console.log('Game started!');
        // Hide title and settings screen
        document.getElementById('settingsScreen').classList.add('hidden');
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        this.ui.hideTitleScreen();

        // Show welcome notification
        const totalTiles = this.world.width * this.world.height;
        const mapDesc = totalTiles > 40000 ? 'vast' : totalTiles > 15000 ? 'large' : 'ready';
        setTimeout(() => {
            this.ui.showNotification('Welcome, ' + this.player.name, `You are a wanderer in a ${mapDesc} world of ${this.world.kingdoms.length} kingdoms. Click on the map to move, explore settlements, and forge your destiny.`, 'info');
        }, 1200);

        // Start game loop
        this.isRunning = true;
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));

        // Start context-aware music
        audioManager.updateSceneFromGameState(this);

        } catch (err) {
            console.error('Error starting game:', err);
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
        }
    }

    /**
     * Main game loop
     */
    gameLoop(timestamp) {
        if (!this.isRunning) return;

        const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.1);
        this.lastTime = timestamp;

        // ── Inner Map Mode ──
        if (this.innerMapMode && InnerMap.active) {
            this.innerMapCamera.update(deltaTime);

            // Update inner map hover
            InnerMapRenderer._hoveredInnerHex = InnerMapRenderer.getInnerHexAtScreen(
                this.mouseX, this.mouseY, this.innerMapCamera);

            // Update time system (1 hour per real minute)
            const timeResult = InnerMap.updateTime(deltaTime);
            if (timeResult === 'day_ended' && !this._innerMapDayEndShown) {
                this._innerMapDayEndShown = true;
                this._showInnerMapEndDayModal();
            }

            // Update top bar with inner map time
            const turnEl = document.getElementById('turnDisplay');
            if (turnEl) {
                const timeStr = InnerMap.getTimeString();
                const period = InnerMap.getTimePeriod();
                const periodIcons = { morning: '🌅', midday: '☀️', afternoon: '🌤️', evening: '🌆', night: '🌙' };
                const periodIcon = periodIcons[period] || '🕐';
                const dayInSeason = ((this.world.day - 1) % 30) + 1;
                turnEl.textContent = `${periodIcon} ${timeStr} — Day ${dayInSeason}, ${this.world.season}, Year ${this.world.year}`;
            }

            // Update player walking animation
            const playerStepResult = InnerMap.updatePlayer(deltaTime);
            if (playerStepResult) {
                if (playerStepResult.moved) {
                    const arrivedTile = InnerMap.getTile(InnerMap.playerInnerQ, InnerMap.playerInnerR);
                    if (arrivedTile) {
                        this.ui.showInnerHexInfo(arrivedTile, InnerMap.playerInnerQ, InnerMap.playerInnerR);
                    }

                    if (playerStepResult.encounter) {
                        this._showEncounterNotification(playerStepResult.encounter);
                    }

                    // ── Trigger pending object interaction on arrival ──
                    if (playerStepResult.arrived && InnerMap._pendingInteraction) {
                        const pi = InnerMap._pendingInteraction;
                        const piDef = typeof CustomObjects !== 'undefined' ? CustomObjects.getDef(pi.defId) : null;
                        InnerMap.startInteraction(pi.anchorQ, pi.anchorR, pi.defId,
                            InnerMap._computeObjectDamage(this.player, piDef));
                        // Face the object
                        const dir = InnerMap.getDirectionToward(pi.anchorQ, pi.anchorR);
                        InnerMapRenderer._playerFacing = dir;
                    }
                } else if (playerStepResult.blocked) {
                    InnerMap._pendingInteraction = null;
                    this.ui.showNotification('Blocked', 'Path blocked — impassable terrain!', 'error');
                }
            }

            // ── Update active object interaction ──
            const interactionResult = InnerMap.updateInteraction(deltaTime);
            if (interactionResult && interactionResult.completed) {
                // Grant resource to player
                if (interactionResult.resource) {
                    const resType = interactionResult.resource.type;
                    const resAmt = interactionResult.resource.amount || 1;
                    if (resType === 'gold') {
                        this.player.gold += resAmt;
                    } else {
                        if (!this.player.inventory) this.player.inventory = {};
                        this.player.inventory[resType] = (this.player.inventory[resType] || 0) + resAmt;
                    }
                    // Format resource name for display
                    const displayName = resType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    this.ui.showNotification('Gathered', `+${resAmt} ${displayName}`, 'success');
                } else {
                    this.ui.showNotification('Cleared', 'Object removed.', 'info');
                }
                // Clear selection if it was this object
                if (InnerMapRenderer._selectedObject &&
                    InnerMapRenderer._selectedObject.anchorQ === interactionResult.anchorQ &&
                    InnerMapRenderer._selectedObject.anchorR === interactionResult.anchorR) {
                    InnerMapRenderer._selectedObject = null;
                }
            }

            // Smoothly follow player with camera while walking
            if (InnerMap._playerWalking) {
                const pWorld = InnerMap.getPlayerWorldPos();
                this.innerMapCamera.centerOn(pWorld.x, pWorld.y);
            }

            // Update NPCs
            InnerMap.updateNPCs(deltaTime);

            // Render inner map
            InnerMapRenderer.render(this.renderer.ctx, this.canvas, this.innerMapCamera, deltaTime);

            requestAnimationFrame((t) => this.gameLoop(t));
            return;
        }

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
                // Exit inner map mode
                if (this.innerMapMode && InnerMap.active) {
                    this.exitInnerMap();
                    return;
                }
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

        // ── Inner Map Mode clicks ──
        if (this.innerMapMode && InnerMap.active) {
            const innerHex = InnerMapRenderer.getInnerHexAtScreen(screenX, screenY, this.innerMapCamera);
            if (!innerHex) return;

            if (button === 'left') {
                InnerMapRenderer._selectedInnerHex = innerHex;
                InnerMapRenderer.closeContextMenu();
                const innerTile = InnerMap.getTile(innerHex.q, innerHex.r);
                const isPlayerTile = (innerHex.q === InnerMap.playerInnerQ && innerHex.r === InnerMap.playerInnerR);

                // ── Resolve custom object selection (anchor or footprint part) ──
                let objAnchor = null;
                if (innerTile) {
                    if (innerTile.customObject) {
                        objAnchor = { anchorQ: innerHex.q, anchorR: innerHex.r, defId: innerTile.customObject.defId };
                    } else if (innerTile.customObjectPart) {
                        const p = innerTile.customObjectPart;
                        const anchorTile = InnerMap.getTile(p.anchorQ, p.anchorR);
                        if (anchorTile && anchorTile.customObject) {
                            objAnchor = { anchorQ: p.anchorQ, anchorR: p.anchorR, defId: anchorTile.customObject.defId };
                        }
                    }
                }
                InnerMapRenderer._selectedObject = objAnchor;

                if (isPlayerTile) {
                    // Always show context menu on player's tile (buildings, NPCs, or blank tile actions)
                    InnerMapRenderer.showContextMenu(this, innerHex.q, innerHex.r, screenX, screenY);
                } else if (innerTile) {
                    this.ui.showInnerHexInfo(innerTile, innerHex.q, innerHex.r);
                }
            } else if (button === 'right') {
                // Right click = walk player to target tile (or interact with object)
                InnerMapRenderer.closeContextMenu();
                InnerMapRenderer._selectedObject = null;

                // Cancel any current walk / interaction
                InnerMap.cancelPlayerWalk();
                InnerMap._pendingInteraction = null;
                InnerMap._activeInteraction = null;

                // Check if the clicked tile has a custom object with a resource
                // AND the clicked tile is an interaction point on that object
                let objAnchorQ = null, objAnchorR = null, objDef = null;
                let clickedLocalCol = 0, clickedLocalRow = 0;
                const innerTile = InnerMap.getTile(innerHex.q, innerHex.r);
                if (innerTile) {
                    if (innerTile.customObject) {
                        objAnchorQ = innerHex.q;
                        objAnchorR = innerHex.r;
                        clickedLocalCol = 0;
                        clickedLocalRow = 0;
                    } else if (innerTile.customObjectPart) {
                        objAnchorQ = innerTile.customObjectPart.anchorQ;
                        objAnchorR = innerTile.customObjectPart.anchorR;
                        clickedLocalCol = innerHex.q - objAnchorQ;
                        clickedLocalRow = innerHex.r - objAnchorR;
                    }
                    if (objAnchorQ != null) {
                        const at = InnerMap.getTile(objAnchorQ, objAnchorR);
                        if (at && at.customObject && typeof CustomObjects !== 'undefined') {
                            objDef = CustomObjects.getDef(at.customObject.defId);
                        }
                    }
                }

                // Only allow interaction if the clicked tile is an interactionPoint
                let clickedInteractTile = false;
                if (objDef && objDef.meta) {
                    for (const m of objDef.meta) {
                        if (m.interactionPoint &&
                            m.localCol === clickedLocalCol &&
                            m.localRow === clickedLocalRow) {
                            clickedInteractTile = true;
                            break;
                        }
                    }
                }

                if (objDef && objDef.resource && clickedInteractTile) {
                    // ── Object interaction: walk to adjacent tile, then interact ──
                    const adj = InnerMap.findAdjacentToObject(objAnchorQ, objAnchorR, objDef);
                    if (adj) {
                        // If player is already at the adjacent tile, start immediately
                        if (InnerMap.playerInnerQ === adj.q && InnerMap.playerInnerR === adj.r) {
                            InnerMap.startInteraction(objAnchorQ, objAnchorR, objDef.id,
                                InnerMap._computeObjectDamage(this.player, objDef));
                            // Face the object
                            const dir = InnerMap.getDirectionToward(objAnchorQ, objAnchorR);
                            InnerMapRenderer._playerFacing = dir;
                        } else {
                            InnerMap._pendingInteraction = { anchorQ: objAnchorQ, anchorR: objAnchorR, defId: objDef.id };
                            const walkResult = InnerMap.movePlayerTo(adj.q, adj.r);
                            if (!walkResult.started) {
                                InnerMap._pendingInteraction = null;
                                this.ui.showNotification('Blocked', 'Cannot reach that object!', 'error');
                            }
                        }
                    } else {
                        this.ui.showNotification('Blocked', 'Cannot reach that object!', 'error');
                    }
                } else {
                    // Normal walk
                    const result = InnerMap.movePlayerTo(innerHex.q, innerHex.r);
                    if (!result.started && !result.outOfBounds) {
                        this.ui.showNotification('Blocked', 'Cannot move there — impassable terrain!', 'error');
                    }
                }
            }
            return;
        }

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
            // Check if tile is accessible based on player's current state
            let isAccessible = false;
            if (this.player.boardedShip) {
                const waterTiles = ['ocean', 'deep_ocean', 'coast', 'lake', 'sea', 'beach'];
                // Allow water tiles
                if (waterTiles.includes(tile.terrain.id)) {
                    isAccessible = true;
                }
                // Allow current position
                else if (hex.q === this.player.q && hex.r === this.player.r) {
                    isAccessible = true;
                }
                // Allow coastal settlements (for docking)
                else if (tile.settlement) {
                    const neighbors = Hex.neighbors(hex.q, hex.r);
                    for (const n of neighbors) {
                        const nq = Hex.wrapQ(n.q, this.world.width);
                        if (n.r < 0 || n.r >= this.world.height) continue;
                        const nTile = this.world.getTile(nq, n.r);
                        if (nTile && waterTiles.includes(nTile.terrain.id)) {
                            isAccessible = true;
                            break;
                        }
                    }
                }
            } else {
                isAccessible = tile.terrain.passable;
            }

            // If clicking on an accessible, explored tile — try to move there
            if (isAccessible) {
                // Don't move if clicking current position
                if (hex.q === this.player.q && hex.r === this.player.r) {
                    return;
                }

                const success = this.player.moveTo(hex.q, hex.r, this.world);
                if (success) {
                    // Check if low on food and at a settlement — offer auto-purchase
                    const pathLen = this.player.path ? this.player.path.length - 1 : 0;
                    const foodCount = this.player.getFoodCount();
                    const currentTile = this.world.getTile(this.player.q, this.player.r);
                    const atSettlement = currentTile && currentTile.settlement;

                    if (foodCount < pathLen && atSettlement) {
                        // At a settlement with insufficient food — show buy modal
                        this._showFoodPurchaseModal(pathLen, foodCount, currentTile, hex);
                    } else if (foodCount < pathLen) {
                        // Not at a settlement — just warn
                        const deficit = pathLen - foodCount;
                        if (foodCount === 0) {
                            this.ui.showNotification('⚠️ No Food!',
                                `You have no food! You will lose health traveling ${pathLen} tiles. Buy food at a settlement.`, 'error');
                        } else {
                            this.ui.showNotification('⚠️ Low Food',
                                `You have ${foodCount} food for a ${pathLen}-tile journey. You\'ll starve for the last ${deficit} tiles.`, 'error');
                        }
                    }
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
     * Handle double-click — show detailed info or enter inner map
     */
    handleDoubleClick(screenX, screenY) {
        if (!this.world) return;

        // Double-click in inner map shows detailed tile info
        if (this.innerMapMode && InnerMap.active) {
            const innerHex = InnerMapRenderer.getInnerHexAtScreen(screenX, screenY, this.innerMapCamera);
            if (!innerHex) return;
            InnerMapRenderer._selectedInnerHex = innerHex;
            const innerTile = InnerMap.getTile(innerHex.q, innerHex.r);
            if (innerTile) {
                this.ui.showInnerHexInfo(innerTile, innerHex.q, innerHex.r);
            }
            return;
        }

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

    // ═══════════════════════════════════════
    // INNER MAP — Explore the interior of a world tile
    // ═══════════════════════════════════════

    /**
     * Enter the inner map for a given world tile
     */
    async enterInnerMap(worldQ, worldR) {
        if (!this.world || !this.player) return;
        if (typeof InnerMap === 'undefined') return;

        const tile = this.world.getTile(worldQ, worldR);
        if (!tile || !tile.explored) {
            this.ui.showNotification('Unexplored', 'You must explore this tile first!', 'error');
            return;
        }

        // Only allow on passable land tiles
        if (!tile.terrain.passable) {
            this.ui.showNotification('Impassable', 'You cannot explore the interior of this terrain.', 'error');
            return;
        }

        // Give inner-map renderer access to sprites FIRST so CustomBuildings etc. are loaded
        // before InnerMap.enter() generates tile data (buildings are placed during generation).
        InnerMapRenderer.setRenderer(this.renderer);
        await InnerMapRenderer.whenLoaded();

        const success = InnerMap.enter(this, worldQ, worldR);
        if (!success) {
            this.ui.showNotification('Error', 'Cannot enter this tile.', 'error');
            return;
        }

        this.innerMapMode = true;
        this._innerMapDayEndShown = false;

        // Set up inner map camera bounds — no horizontal wrapping (unlike world map)
        const tileSize = InnerMapRenderer.tileSize;
        const innerPixelWidth = tileSize * InnerMap.width;
        const innerPixelHeight = tileSize * InnerMap.height;
        this.innerMapCamera.setWorldBounds(0, innerPixelHeight);  // width=0 disables X-wrap

        // Zoom to fit the entire inner map in the viewport
        const canvasW = this.canvas.width;
        const canvasH = this.canvas.height;
        const zoomLevel = Math.min(canvasW / innerPixelWidth, canvasH / innerPixelHeight) * 0.95;
        this.innerMapCamera.minZoom = Math.min(0.1, zoomLevel);  // allow zooming out far enough
        this.innerMapCamera.zoom = zoomLevel;
        this.innerMapCamera.targetZoom = zoomLevel;

        // Center on the middle of the map so the whole map is visible
        this.innerMapCamera.centerOn(innerPixelWidth / 2, innerPixelHeight / 2);

        // Hide world map UI elements
        this._hideWorldMapUI();

        // Show inner map exit button
        this._showInnerMapExitButton();

        // Notification
        const terrainName = tile.terrain.name || tile.terrain.id;
        if (tile.settlement) {
            this.ui.showNotification('🏘️ Entering Settlement',
                `Welcome to ${tile.settlement.name}! Time: ${InnerMap.getTimeString()}. Right-click buildings to interact.`, 'info');
        } else {
            this.ui.showNotification('🗺️ Entering Inner Map',
                `Exploring the interior of ${terrainName}. Right-click to move, ESC to return.`, 'info');
        }
    }

    /**
     * Exit the inner map and return to the world map
     */
    exitInnerMap() {
        if (!InnerMap.active) return;

        InnerMapRenderer.closeContextMenu();
        InnerMap.exit(this);
        this.innerMapMode = false;
        this._innerMapDayEndShown = false;

        // Remove exit button
        this._hideInnerMapExitButton();

        // Restore world map UI
        this._showWorldMapUI();

        // Re-center world map camera on player
        if (this.player) {
            const playerPos = Hex.axialToPixel(this.player.q, this.player.r, this.renderer.hexSize);
            this.camera.centerOn(playerPos.x, playerPos.y);
        }

        // Restore normal turn display
        this.ui.updateStats(this.player, this.world);

        this.ui.showNotification('🗺️ Returned to World Map', 'You returned to the world map.', 'info');
    }

    /**
     * Show encounter notification
     */
    _showEncounterNotification(encounter) {
        if (!encounter) return;

        const overlay = document.createElement('div');
        overlay.id = 'encounterOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 1200;
            background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
            display: flex; justify-content: center; align-items: center;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: rgba(16, 20, 28, 0.97);
            border: 1px solid rgba(245, 197, 66, 0.4);
            border-radius: 12px; padding: 24px 32px;
            max-width: 400px; text-align: center;
            box-shadow: 0 12px 48px rgba(0,0,0,0.85);
            font-family: var(--font-body);
        `;

        box.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 12px;">${encounter.icon}</div>
            <div style="font-family: var(--font-display); font-size: 18px; color: var(--gold); margin-bottom: 8px;">
                ${encounter.name}
            </div>
            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5;">
                ${encounter.description}
            </div>
            <button id="encounterDismiss" style="
                background: linear-gradient(135deg, #f5c542, #d4a843);
                color: #1a1a2e; border: none; padding: 8px 24px;
                border-radius: 6px; font-weight: 600; cursor: pointer;
                font-size: 13px; font-family: var(--font-body);
            ">Continue</button>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const dismiss = () => {
            overlay.remove();
        };

        box.querySelector('#encounterDismiss').addEventListener('click', dismiss);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
        window.addEventListener('keydown', function handler(e) {
            if (e.key === 'Enter' || e.key === 'Escape') {
                dismiss();
                window.removeEventListener('keydown', handler);
            }
        });
    }

    /**
     * Show the end-of-day modal when inner map time runs out
     */
    _showInnerMapEndDayModal() {
        const overlay = document.createElement('div');
        overlay.id = 'innerMapEndDayOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 1300;
            background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);
            display: flex; justify-content: center; align-items: center;
        `;

        const worldTile = this.world ? this.world.getTile(this.player.q, this.player.r) : null;
        const settlementName = worldTile && worldTile.settlement ? worldTile.settlement.name : 'this area';
        const day = this.world ? this.world.day : 0;
        const season = this.world ? this.world.season : 'Spring';
        const year = this.world ? this.world.year : 853;

        const box = document.createElement('div');
        box.style.cssText = `
            background: rgba(16, 20, 28, 0.98);
            border: 1px solid rgba(245, 197, 66, 0.4);
            border-radius: 14px; padding: 28px 36px;
            max-width: 420px; text-align: center;
            box-shadow: 0 16px 64px rgba(0,0,0,0.9);
            font-family: var(--font-body);
        `;

        box.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 12px;">🌙</div>
            <div style="font-family: var(--font-display); font-size: 22px; color: var(--gold); margin-bottom: 6px;">
                Day's End
            </div>
            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.6;">
                Night has fallen over ${settlementName}. The day draws to a close.
            </div>
            <div style="
                background: rgba(255,255,255,0.05);
                border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;
                text-align: left; font-size: 12px; color: rgba(255,255,255,0.7);
            ">
                <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                    <span>📅 Day</span><span style="color:#f5c542;">${day}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                    <span>🌿 Season</span><span style="color:#f5c542;">${season}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                    <span>📜 Year</span><span style="color:#f5c542;">${year}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                    <span>💰 Gold</span><span style="color:#f5c542;">${this.player.gold}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                    <span>❤️ Health</span><span style="color:#f5c542;">${this.player.health}/${this.player.maxHealth}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>🍞 Food</span><span style="color:#f5c542;">${this.player.getFoodCount ? this.player.getFoodCount() : '?'}</span>
                </div>
            </div>
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button id="innerEndDayRest" style="
                    background: linear-gradient(135deg, #f5c542, #d4a843);
                    color: #1a1a2e; border: none; padding: 10px 24px;
                    border-radius: 6px; font-weight: 700; cursor: pointer;
                    font-size: 13px; font-family: var(--font-body);
                ">🛏️ Rest & End Day</button>
                <button id="innerEndDayLeave" style="
                    background: rgba(255,255,255,0.08);
                    color: #e0e0e0; border: 1px solid rgba(255,255,255,0.15);
                    padding: 10px 20px; border-radius: 6px;
                    font-weight: 600; cursor: pointer;
                    font-size: 13px; font-family: var(--font-body);
                ">🚶 Leave & End Day</button>
            </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const restBtn = box.querySelector('#innerEndDayRest');
        const leaveBtn = box.querySelector('#innerEndDayLeave');

        restBtn.addEventListener('click', () => {
            overlay.remove();
            // Stay on inner map, advance game day, reset inner map time
            this.endDay();
            InnerMap.timeOfDay = 8;
            InnerMap._timeAccumulator = 0;
            InnerMap.dayEnded = false;
            this._innerMapDayEndShown = false;
            this.ui.showNotification('🌅 New Day', `A new day dawns. Time: ${InnerMap.getTimeString()}`, 'info');
        });

        leaveBtn.addEventListener('click', () => {
            overlay.remove();
            // End the day and exit to world map
            this.exitInnerMap();
            this.endDay();
        });

        // Hover effects
        restBtn.addEventListener('mouseenter', () => restBtn.style.transform = 'scale(1.04)');
        restBtn.addEventListener('mouseleave', () => restBtn.style.transform = 'scale(1)');
        leaveBtn.addEventListener('mouseenter', () => leaveBtn.style.background = 'rgba(255,255,255,0.12)');
        leaveBtn.addEventListener('mouseleave', () => leaveBtn.style.background = 'rgba(255,255,255,0.08)');
    }

    /**
     * Show info about an inner map tile (delegates to ui.showInnerHexInfo)
     */
    _showInnerTileInfo(tile, q, r) {
        if (!tile || !this.ui) return;
        this.ui.showInnerHexInfo(tile, q, r);
    }

    /**
     * Show the inner map exit button
     */
    _showInnerMapExitButton() {
        // Remove existing button if any
        this._hideInnerMapExitButton();

        const btnStyle = `
            background: linear-gradient(135deg, rgba(16, 20, 28, 0.95), rgba(30, 35, 50, 0.95));
            border: 1px solid rgba(245, 197, 66, 0.4);
            color: #f5c542; padding: 10px 20px;
            border-radius: 8px; font-weight: 600; cursor: pointer;
            font-size: 13px; font-family: var(--font-body);
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            transition: all 0.2s ease;
        `;
        const hoverIn = (el) => { el.style.borderColor = 'rgba(245, 197, 66, 0.8)'; el.style.transform = 'scale(1.03)'; };
        const hoverOut = (el) => { el.style.borderColor = 'rgba(245, 197, 66, 0.4)'; el.style.transform = 'scale(1)'; };

        // Container for inner map toolbar
        const toolbar = document.createElement('div');
        toolbar.id = 'innerMapToolbar';
        toolbar.style.cssText = `position: fixed; top: 52px; right: 16px; z-index: 1100; display: flex; gap: 8px; align-items: center;`;

        // ── Export to Tiled button ──
        const exportBtn = document.createElement('button');
        exportBtn.id = 'innerMapExportBtn';
        exportBtn.innerHTML = '📥 Export .tmj';
        exportBtn.title = 'Download map as Tiled Editor JSON (.tmj)';
        exportBtn.style.cssText = btnStyle + 'padding: 8px 14px; font-size: 12px;';
        exportBtn.addEventListener('mouseenter', () => hoverIn(exportBtn));
        exportBtn.addEventListener('mouseleave', () => hoverOut(exportBtn));
        exportBtn.addEventListener('click', () => this._exportInnerMapTiled());
        toolbar.appendChild(exportBtn);

        // ── Import from Tiled button ──
        const importBtn = document.createElement('button');
        importBtn.id = 'innerMapImportBtn';
        importBtn.innerHTML = '📤 Import .tmj';
        importBtn.title = 'Import a Tiled Editor JSON map (.tmj/.json)';
        importBtn.style.cssText = btnStyle + 'padding: 8px 14px; font-size: 12px;';
        importBtn.addEventListener('mouseenter', () => hoverIn(importBtn));
        importBtn.addEventListener('mouseleave', () => hoverOut(importBtn));
        importBtn.addEventListener('click', () => this._importInnerMapTiled());
        toolbar.appendChild(importBtn);

        // ── Exit button ──
        const btn = document.createElement('button');
        btn.id = 'innerMapExitBtn';
        btn.innerHTML = '🔙 Return to World Map';
        btn.style.cssText = btnStyle;
        btn.addEventListener('mouseenter', () => hoverIn(btn));
        btn.addEventListener('mouseleave', () => hoverOut(btn));
        btn.addEventListener('click', () => this.exitInnerMap());
        toolbar.appendChild(btn);

        document.body.appendChild(toolbar);
    }

    /**
     * Hide the inner map exit button
     */
    _hideInnerMapExitButton() {
        const toolbar = document.getElementById('innerMapToolbar');
        if (toolbar) toolbar.remove();
        const btn = document.getElementById('innerMapExitBtn');
        if (btn) btn.remove();
    }

    /**
     * Export current inner map as Tiled JSON (.tmj) file
     */
    _exportInnerMapTiled() {
        if (!InnerMap.active || !InnerMap.tiles) {
            this.ui.showNotification('Export Error', 'No inner map is active.', 'error');
            return;
        }

        try {
            const worldTile = InnerMap.currentWorldTile || { q: 0, r: 0 };
            const terrainId = InnerMap.tiles[0] && InnerMap.tiles[0][0]
                ? InnerMap.tiles[0][0].parentTerrain : 'grassland';

            TiledExport.downloadTiled(InnerMap.tiles, {
                season: InnerMap.season || 'Summer',
                parentTerrain: terrainId,
                worldQ: worldTile.q,
                worldR: worldTile.r
            });

            this.ui.showNotification('📥 Exported', 'Inner map downloaded as Tiled .tmj file.', 'success');
        } catch (e) {
            console.error('Tiled export error:', e);
            this.ui.showNotification('Export Error', e.message, 'error');
        }
    }

    /**
     * Import a Tiled JSON (.tmj) file and apply it to the current inner map
     */
    _importInnerMapTiled() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.tmj,.json';
        input.style.display = 'none';

        input.addEventListener('change', async () => {
            if (!input.files || input.files.length === 0) return;

            try {
                const imported = await TiledExport.importFromFile(input.files[0]);

                // Apply to current world tile position
                const worldTile = InnerMap.currentWorldTile || { q: 0, r: 0 };
                TiledExport.applyImport(imported, {
                    worldQ: worldTile.q,
                    worldR: worldTile.r
                });

                // Reload the inner map view
                InnerMap.tiles = imported.tiles;
                InnerMap.width = imported.width;
                InnerMap.height = imported.height;

                this.ui.showNotification('📤 Imported',
                    `Tiled map loaded: ${imported.width}×${imported.height}, terrain: ${imported.parentTerrain}`, 'success');
            } catch (e) {
                console.error('Tiled import error:', e);
                this.ui.showNotification('Import Error', e.message, 'error');
            }

            input.remove();
        });

        document.body.appendChild(input);
        input.click();
    }

    /**
     * Hide world map UI elements when entering inner map
     */
    _hideWorldMapUI() {
        // Hide hex info panel
        const hexPanel = document.getElementById('hexInfoPanel');
        if (hexPanel) hexPanel.classList.add('hidden');

        // Hide kingdom panel
        const kingdomPanel = document.getElementById('kingdomPanel');
        if (kingdomPanel) kingdomPanel.classList.add('hidden');

        // Hide minimap temporarily
        const minimapCanvas = document.getElementById('minimapCanvas');
        if (minimapCanvas) minimapCanvas.style.display = 'none';

        // Close action menu if open
        if (typeof ActionMenu !== 'undefined') ActionMenu.close();
    }

    /**
     * Show world map UI elements when exiting inner map
     */
    _showWorldMapUI() {
        // Restore minimap
        const minimapCanvas = document.getElementById('minimapCanvas');
        if (minimapCanvas) minimapCanvas.style.display = '';
    }

    /**
     * Player arrived at destination
     */
    onPlayerArrived() {
        const tile = this.world.getTile(this.player.q, this.player.r);
        if (!tile) return;

        // Update music scene based on new terrain
        audioManager.updateSceneFromGameState(this);

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
            // Discover basic kingdom knowledge by visiting a settlement
            if (tile.settlement.kingdom) {
                const learned = this.player.learnAboutKingdom(tile.settlement.kingdom, 'basics');
                if (learned.length > 0) {
                    const k = this.world.getKingdom(tile.settlement.kingdom);
                    if (k) this.ui.showNotification('Knowledge Gained', `You have learned about the realm of ${k.name}.`, 'info');
                }
            }
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

        // Play end-turn SFX
        audioManager.playSFX('turn');

        // Confirm end day if enabled
        if (this.ui && this.ui._confirmEndDay && !this._endDayConfirmed) {
            this._showEndDayConfirm();
            return;
        }
        this._endDayConfirmed = false;

        this.isProcessingTurn = true;
        document.body.style.cursor = 'wait';

        // Use setTimeout to allow UI to update (show loading state) before heavy processing
        setTimeout(() => {
            try {
                // Process player's daily activities
                const playerResults = PlayerActions.endDay(this.player, this.world);

                // Show jail update notifications
                if (playerResults.jailUpdate) {
                    if (playerResults.jailUpdate.freed) {
                        this.ui.showNotification('🔓 Released!', playerResults.jailUpdate.message, 'success');
                    }
                }

                // Show title update notifications
                if (playerResults.titleUpdate) {
                    const tu = playerResults.titleUpdate;
                    if (tu.salary > 0) {
                        // Silent salary — don't spam every day
                    }
                    if (tu.fugitiveUpdate) {
                        if (tu.fugitiveUpdate.escaped) {
                            this.ui.showNotification('💨 Fugitive Escaped!', tu.fugitiveUpdate.message, 'error');
                        } else if (tu.fugitiveUpdate.warning) {
                            this.ui.showNotification('⚠️ Fugitive Alert', tu.fugitiveUpdate.message, 'warning');
                        }
                    }
                    if (tu.evaluation) {
                        if (tu.evaluation.passed) {
                            this.ui.showNotification('✅ Duties Fulfilled!', `${tu.evaluation.progress} — Well done! Your service continues.`, 'success');
                        } else {
                            this.ui.showNotification('❌ Duties Failed!', `${tu.evaluation.progress} — Your performance was lacking.`, 'error');
                        }
                    }
                    if (tu.stripped) {
                        this.ui.showNotification('🏅 Title Stripped!', tu.strippedMessage, 'error');
                    }
                }

                // Process world turn
                const result = this.world.advanceDay();
                this.player.endDay();
                this.player.updateVisibility(this.world, 4);

                // ── Check for hostile unit encounters (raiders/pirates) ──
                this._checkHostileEncounters();

                // Apply spy-revealed vision tiles (after normal visibility reset)
                if (typeof Espionage !== 'undefined') {
                    Espionage.applySpyVision(this.player, this.world);
                }

                // ── Starvation check ─────────────────────────────
                if (this.player.health <= 0 && this.player.starvationDays > 0) {
                    // Player starved to death
                    if (typeof Relationships !== 'undefined') Relationships.prepareForSave(this.player);
                    this.isProcessingTurn = false;
                    document.body.style.cursor = 'default';
                    ActionMenu.showDeathScreen(this, 'starvation');
                    return; // Stop processing — death screen handles continuation
                }

                // Show starvation warnings
                if (this.player.starvationDays > 0) {
                    const days = this.player.starvationDays;
                    if (days >= 5) {
                        this.ui.showNotification('💀 Starving!',
                            `${days} days without food! Health: ${this.player.health}/${this.player.maxHealth}. Find food or you will die!`, 'error');
                    } else if (days >= 3) {
                        this.ui.showNotification('⚠️ Starving',
                            `${days} days without food. Health: ${this.player.health}/${this.player.maxHealth}. Buy food at a settlement!`, 'error');
                    } else {
                        this.ui.showNotification('🍽️ Hungry',
                            `No food! Day ${days} without eating. Health: ${this.player.health}/${this.player.maxHealth}`, 'warning');
                    }
                }

                // Process housing maintenance
                if (typeof Housing !== 'undefined') {
                    Housing.processDaily(this.player, this.world);
                }

                // Process ship daily events
                if (typeof Ships !== 'undefined') {
                    // Capture ship statuses before processing
                    const shipsBefore = (this.player.ships || []).map(s => ({ id: s.id, status: s.status, name: s.name, buildDaysLeft: s.buildDaysLeft, travelDaysLeft: s.travelDaysLeft }));
                    Ships.processDaily(this.player, this.world);
                    // Check for completed builds or arrived ships
                    for (const before of shipsBefore) {
                        const after = Ships.getShipById(this.player, before.id);
                        if (!after) continue;
                        if (before.status === 'building' && after.status === 'docked') {
                            this.ui.showNotification('🔨 Ship Complete!', `${after.name} has been built and is ready at ${after.dockedAt}!`, 'success');
                        } else if (before.status === 'moving' && after.status === 'docked') {
                            this.ui.showNotification('⚓ Ship Arrived', `${after.name} has arrived at ${after.dockedAt}.`, 'info');
                        }
                    }
                }

                // Process building construction progress
                if (this.player.properties) {
                    for (const propRef of this.player.properties) {
                        const pTile = this.world.getTile(propRef.q, propRef.r);
                        if (!pTile) continue;

                        // Check playerProperties array
                        if (pTile.playerProperties) {
                            for (const prop of pTile.playerProperties) {
                                if (prop.underConstruction && prop.constructionDaysLeft > 0) {
                                    prop.constructionDaysLeft--;
                                    if (prop.constructionDaysLeft <= 0) {
                                        prop.underConstruction = false;
                                        this.ui.showNotification('🏗️ Construction Complete!',
                                            `Your ${prop.name} is now operational!`, 'success');
                                    }
                                }
                            }
                        }

                        // Also sync playerProperty (backwards compat reference)
                        if (pTile.playerProperty && pTile.playerProperty.underConstruction && pTile.playerProperty.constructionDaysLeft > 0) {
                            // Already handled above if in playerProperties array
                            if (!pTile.playerProperties || !pTile.playerProperties.includes(pTile.playerProperty)) {
                                pTile.playerProperty.constructionDaysLeft--;
                                if (pTile.playerProperty.constructionDaysLeft <= 0) {
                                    pTile.playerProperty.underConstruction = false;
                                    this.ui.showNotification('🏗️ Construction Complete!',
                                        `Your ${pTile.playerProperty.name} is now operational!`, 'success');
                                }
                            }
                        }
                    }
                }

                // Process religious building construction
                if (this.player.religion && this.player.religion.buildings) {
                    for (const bRef of this.player.religion.buildings) {
                        const bTile = this.world.getTile(bRef.q, bRef.r);
                        if (!bTile || !bTile.religiousBuilding) continue;
                        const rb = bTile.religiousBuilding;
                        if (rb.underConstruction && rb.constructionDaysLeft > 0) {
                            rb.constructionDaysLeft--;
                            if (rb.constructionDaysLeft <= 0) {
                                rb.underConstruction = false;
                                this.ui.showNotification('🏗️ Construction Complete!',
                                    `Your ${rb.name} is now complete and will spread your faith!`, 'success');
                            }
                        }
                    }
                }

                // Process infrastructure construction
                if (this.player.infrastructureUnderConstruction) {
                    for (let i = this.player.infrastructureUnderConstruction.length - 1; i >= 0; i--) {
                        const ref = this.player.infrastructureUnderConstruction[i];
                        const iTile = this.world.getTile(ref.q, ref.r);
                        if (!iTile || !iTile.infrastructure || !iTile.infrastructure.underConstruction) {
                            this.player.infrastructureUnderConstruction.splice(i, 1);
                            continue;
                        }
                        iTile.infrastructure.constructionDaysLeft--;
                        if (iTile.infrastructure.constructionDaysLeft <= 0) {
                            iTile.infrastructure.underConstruction = false;
                            this.ui.showNotification('🏗️ Construction Complete!',
                                `Your ${iTile.infrastructure.name} is now operational!`, 'success');
                            this.player.infrastructureUnderConstruction.splice(i, 1);
                            // Recalculate reachable hexes now that infra is active
                            this.renderer.reachableHexes = this.player.getReachableHexes(this.world);
                        }
                    }
                }

                // Process cultural building construction
                if (this.player.culturalBuildings) {
                    for (const bRef of this.player.culturalBuildings) {
                        const cTile = this.world.getTile(bRef.q, bRef.r);
                        if (!cTile || !cTile.culturalBuilding) continue;
                        const cb = cTile.culturalBuilding;
                        if (cb.underConstruction && cb.constructionDaysLeft > 0) {
                            cb.constructionDaysLeft--;
                            if (cb.constructionDaysLeft <= 0) {
                                cb.underConstruction = false;
                                this.ui.showNotification('🏗️ Construction Complete!',
                                    `Your ${cb.name} is now operational!`, 'success');
                            }
                        }
                    }
                }

                // Process relationships, aging, and dynasty
                if (typeof Relationships !== 'undefined') {
                    // Daily relationship events (marriage events, NPC courtship, childbirth)
                    const relEvents = Relationships.processDailyEvents(this.player, this.world);
                    for (const evt of relEvents) {
                        if (evt.type === 'childbirth') {
                            this.ui.showNotification('🎉 New Child!', evt.text, 'success');
                        } else if (evt.type === 'marriage') {
                            const notifType = evt.impact === 'positive' ? 'info' : 'warning';
                            this.ui.showNotification('💍 Marriage', evt.text, notifType);
                        } else if (evt.type === 'court') {
                            this.ui.showNotification('💕 Romance', evt.text, 'info');
                        }
                    }

                    // Aging (yearly check — every 120 days)
                    const agingResult = Relationships.processAging(this.player, this.world);
                    if (agingResult) {
                        if (agingResult.died) {
                            // Player has died of old age — show death/succession screen
                            Relationships.prepareForSave(this.player);
                            this.isProcessingTurn = false;
                            document.body.style.cursor = 'default';
                            ActionMenu.showDeathScreen(this);
                            return; // Stop processing — death screen handles continuation
                        } else {
                            this.ui.showNotification('🎂 Birthday', `You are now ${agingResult.age} years old.`, 'info');
                        }
                    }

                    // Prepare relationship data for save
                    Relationships.prepareForSave(this.player);
                }

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

                // Process espionage daily
                if (typeof Espionage !== 'undefined') {
                    const espResult = Espionage.processDaily(this.player, this.world);
                    if (espResult.upkeepPaid > 0) {
                        this.ui.showNotification('🕵️ Spy Network', `-${espResult.upkeepPaid}g upkeep`, 'default');
                    }
                    if (espResult.lostSpies > 0) {
                        this.ui.showNotification('🕵️ Spy Deserted!', `${espResult.lostSpies} spy(s) left due to low loyalty or unpaid wages.`, 'error');
                    }
                    for (const mission of espResult.completedMissions) {
                        const outcomeData = mission.outcomeData || {};
                        const notifType = mission.outcome === 'captured' ? 'error' :
                            mission.outcome === 'failure' ? 'warning' :
                            mission.outcome === 'criticalSuccess' ? 'success' : 'info';
                        this.ui.showNotification(
                            `${outcomeData.icon || '📋'} ${outcomeData.label || 'Mission Complete'}`,
                            mission.text,
                            notifType
                        );
                        if (mission.levelUp) {
                            this.ui.showNotification('⬆️ Spy Level Up!', `${mission.spyName} reached level ${mission.newLevel}!`, 'success');
                        }
                    }
                    for (const reb of espResult.rebellionUpdates) {
                        if (reb.ended) {
                            const k = this.world.getKingdom(reb.kingdomId);
                            this.ui.showNotification('🔥 Rebellion Ended', `The rebellion in ${k ? k.name : 'a kingdom'} has subsided.`, 'info');
                        }
                    }
                    Espionage.prepareForSave(this.player);
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

                if (playerResults.mercenaryWages > 0) {
                    this.ui.showNotification('Mercenary Wages', `-${playerResults.mercenaryWages} gold`, 'default');
                }

                if (playerResults.unitsLost > 0) {
                    this.ui.showNotification('Desertion!', `Lost ${playerResults.unitsLost} units (couldn't pay upkeep)`, 'error');
                }

                if (playerResults.mercenaryEvents && playerResults.mercenaryEvents.length > 0) {
                    for (const event of playerResults.mercenaryEvents) {
                        if (event.type === 'outbid_switch') {
                            this.ui.showNotification('💰 Mercenaries Defected!', event.text, 'error');
                        } else if (event.type === 'contract_expired') {
                            this.ui.showNotification('📜 Mercenary Contract Ended', event.text, 'default');
                        } else if (event.type === 'loyalty_warning') {
                            this.ui.showNotification('⚠️ Mercenary Loyalty', event.text, 'warning');
                        }
                    }
                }

                // Caravan completions
                for (const caravan of playerResults.caravansCompleted) {
                    if (caravan.eventType === 'auction') {
                        this.ui.showNotification(caravan.title || 'Auction', caravan.message || '', caravan.severity || 'default');
                        continue;
                    }

                    if (caravan.status === 'lost') {
                        this.ui.showNotification('Caravan Lost', caravan.message || `${caravan.from} → ${caravan.to} was lost on the road.`, 'error');
                    } else if (caravan.status === 'smuggling_caught') {
                        this.ui.showNotification('Smuggling Intercepted', `${caravan.from} → ${caravan.to}: +${caravan.finalProfit} gold after confiscation`, 'default');
                    } else {
                        this.ui.showNotification('Caravan Arrived!', `${caravan.from} → ${caravan.to}: +${caravan.finalProfit} gold`, 'success');
                    }
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

                if (playerResults.festivalUpdate) {
                    const fu = playerResults.festivalUpdate;
                    if (fu.moraleExpired) {
                        this.ui.showNotification('Festival Spirit Fades', 'Your recent celebration morale bonus has ended.', 'default');
                    } else if (fu.moraleDaysLeft > 0) {
                        this.ui.showNotification('Festival Morale', `Army morale boosted by ${Math.round((fu.moraleValue || 0) * 100)}% for ${fu.moraleDaysLeft} more day(s).`, 'info');
                    }
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

                // Bounty hunting updates
                if (playerResults.bountyTracking && playerResults.bountyTracking.escalated && playerResults.bountyTracking.escalated.length > 0) {
                    for (const update of playerResults.bountyTracking.escalated) {
                        this.ui.showNotification('Bounty Escalated', `${update.targetName} has grown more dangerous (difficulty ${update.difficulty}).`, 'warning');
                    }
                }

                // Bounties expired
                if (playerResults.bountiesExpired && playerResults.bountiesExpired.length > 0) {
                    for (const bounty of playerResults.bountiesExpired) {
                        this.ui.showNotification('Bounty Expired', `${bounty.icon} ${bounty.name} — time ran out!`, 'error');
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

                // Auto-save every N days (0 = disabled)
                if (SaveLoad.AUTO_SAVE_INTERVAL > 0 && this.world.day % SaveLoad.AUTO_SAVE_INTERVAL === 0) {
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
                    if (c.eventType) continue;
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
                if (playerResults.mercenaryWages > 0) dayFinance.expenses.mercenaryWages = playerResults.mercenaryWages;
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

                // Reset inner map time if the day was ended while on the inner map
                if (this.innerMapMode && typeof InnerMap !== 'undefined') {
                    InnerMap.timeOfDay = 8;
                    InnerMap._timeAccumulator = 0;
                    InnerMap.dayEnded = false;
                    this._innerMapDayEndShown = false;
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

    /**
     * Show modal offering to auto-purchase food when starting a journey with low/no food at a settlement
     */
    _showFoodPurchaseModal(pathLen, foodCount, tile, targetHex) {
        // Don't stack modals
        if (document.getElementById('foodPurchaseModal')) return;

        // Pause movement while modal is open
        this.player.isMoving = false;

        const settlement = tile.settlement;
        const deficit = pathLen - foodCount;

        // Find cheapest available food at this settlement
        const goods = (typeof Trading !== 'undefined') ? Trading.getAvailableGoods(settlement, tile) : [];
        const foodGoods = goods.filter(g => Player.FOOD_TYPES.includes(g.id) && g.quantity > 0);
        foodGoods.sort((a, b) => a.price - b.price); // cheapest first

        // Calculate how much food we can buy and at what cost
        let totalCost = 0;
        let totalFood = 0;
        const purchasePlan = [];

        let remaining = deficit;
        for (const fg of foodGoods) {
            if (remaining <= 0) break;
            const canBuy = Math.min(remaining, fg.quantity);
            const canAfford = Math.floor(this.player.gold / fg.price);
            const qty = Math.min(canBuy, canAfford);
            if (qty > 0) {
                purchasePlan.push({ good: fg, qty, cost: qty * fg.price });
                totalCost += qty * fg.price;
                totalFood += qty;
                remaining -= qty;
            }
        }

        const canFullyProvision = totalFood >= deficit;
        const hasAnyFood = foodGoods.length > 0 && totalFood > 0;

        const overlay = document.createElement('div');
        overlay.id = 'foodPurchaseModal';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 1200;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            animation: fadeIn 0.2s ease;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: rgba(20, 24, 32, 0.98);
            border: 2px solid var(--gold);
            border-radius: 8px;
            padding: 28px 36px;
            min-width: 340px;
            max-width: 440px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px rgba(245,197,66,0.15);
        `;

        // Build purchase breakdown
        let breakdownHtml = '';
        if (hasAnyFood) {
            for (const p of purchasePlan) {
                breakdownHtml += `<div style="display:flex; justify-content:space-between; font-size:12px; padding:2px 0;">
                    <span>${p.good.icon || '🍽️'} ${p.good.name} ×${p.qty}</span>
                    <span style="color:var(--gold);">${p.cost} gold</span>
                </div>`;
            }
        }

        box.innerHTML = `
            <div style="font-size: 32px; margin-bottom: 8px;">🍽️</div>
            <h3 style="margin: 0 0 6px; font-family: var(--font-display); color: var(--gold); letter-spacing: 2px; text-transform: uppercase;">Low on Food</h3>
            <p style="color: var(--text-secondary); font-size: 13px; margin: 0 0 14px; line-height: 1.5;">
                Your journey is <span style="color:#4fc3f7;">${pathLen} tiles</span> but you only have
                <span style="color:${foodCount === 0 ? '#f44336' : '#ff9800'};">${foodCount} food</span>.
                You need <span style="color:#ff9800;">${deficit} more</span> to avoid starving.
            </p>

            ${hasAnyFood ? `
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:10px; margin-bottom:14px; text-align:left;">
                    <div style="font-size:11px; color:#888; text-transform:uppercase; margin-bottom:6px;">Auto-Purchase from ${settlement.name}</div>
                    ${breakdownHtml}
                    <div style="border-top:1px solid rgba(255,255,255,0.08); margin-top:6px; padding-top:6px; display:flex; justify-content:space-between; font-weight:bold;">
                        <span style="color:#aaa;">Total: ${totalFood} food</span>
                        <span style="color:var(--gold);">${totalCost} gold</span>
                    </div>
                    ${!canFullyProvision ? `<div style="color:#ff9800; font-size:11px; margin-top:4px;">⚠️ Can only buy ${totalFood} of ${deficit} needed (${remaining > 0 ? (this.player.gold < totalCost + remaining ? 'not enough gold' : 'not enough in stock') : ''})</div>` : ''}
                </div>
                <div style="color:#666; font-size:11px; margin-bottom:12px;">
                    💰 Your gold: <span style="color:var(--gold);">${this.player.gold}</span>
                    → After purchase: <span style="color:${this.player.gold - totalCost < 50 ? '#ff9800' : 'var(--gold)'};">${this.player.gold - totalCost}</span>
                </div>
            ` : `
                <div style="background:rgba(244,67,54,0.1); border:1px solid rgba(244,67,54,0.2); border-radius:6px; padding:10px; margin-bottom:14px;">
                    <div style="color:#f44336; font-size:12px;">No food available at this settlement, or you can't afford any.</div>
                </div>
            `}

            <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
                <button id="foodCancel" style="
                    padding: 10px 18px; border-radius: 6px; cursor: pointer;
                    background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);
                    color: var(--text-secondary); font-family: var(--font-body); font-size: 13px;
                    transition: all 0.2s;
                ">Cancel Journey</button>
                <button id="foodSkip" style="
                    padding: 10px 18px; border-radius: 6px; cursor: pointer;
                    background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.3);
                    color: #ff9800; font-family: var(--font-body); font-size: 13px;
                    transition: all 0.2s;
                ">Travel Hungry</button>
                ${hasAnyFood ? `<button id="foodBuy" style="
                    padding: 10px 18px; border-radius: 6px; cursor: pointer;
                    background: rgba(76,175,80,0.15); border: 1px solid rgba(76,175,80,0.4);
                    color: #4caf50; font-family: var(--font-body); font-size: 13px;
                    font-weight: 600; transition: all 0.2s;
                ">Buy & Go (${totalCost}g)</button>` : ''}
            </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const cleanup = () => {
            overlay.remove();
            window.removeEventListener('keydown', keyHandler);
        };

        const cancelJourney = () => {
            cleanup();
            this.player.cancelTravel();
        };

        const skipAndGo = () => {
            cleanup();
            // Resume movement — it was paused
            if (this.player.path) {
                this.player.isMoving = true;
            }
        };

        const buyAndGo = () => {
            cleanup();
            // Execute purchases
            for (const p of purchasePlan) {
                Trading.buyGoods(this.player, p.good, p.qty, settlement);
            }
            this.ui.showNotification('🍞 Food Purchased',
                `Bought ${totalFood} food for ${totalCost} gold. Safe travels!`, 'success');
            this.ui.updateStats(this.player, this.world);
            // Resume movement
            if (this.player.path) {
                this.player.isMoving = true;
            }
        };

        // Click outside to cancel journey
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cancelJourney();
        });

        document.getElementById('foodCancel').addEventListener('click', cancelJourney);
        document.getElementById('foodSkip').addEventListener('click', skipAndGo);
        if (hasAnyFood) {
            document.getElementById('foodBuy').addEventListener('click', buyAndGo);
        }

        // Keyboard: Enter to buy (if available), Escape to cancel
        const keyHandler = (e) => {
            if (e.key === 'Enter' && hasAnyFood) {
                buyAndGo();
            } else if (e.key === 'Escape') {
                cancelJourney();
            }
        };
        window.addEventListener('keydown', keyHandler);
    }

    /**
     * Check if any hostile units (raiders/pirates) have reached the player
     * and trigger a combat encounter if so.
     */
    _checkHostileEncounters() {
        if (!this.world || !this.player) return;
        if (this.player.indenturedServitude) return; // Already captive

        const hostiles = this.world.units.filter(u =>
            !u.destroyed &&
            (u.type === 'raider' || u.type === 'pirate') &&
            Hex.wrappingDistance(u.q, u.r, this.player.q, this.player.r, this.world.width) <= 1
        );

        if (hostiles.length === 0) return;

        // Pick the strongest adjacent hostile
        const attacker = hostiles.reduce((a, b) => b.strength > a.strength ? b : a, hostiles[0]);

        // Play combat SFX and switch to combat music
        audioManager.playSFX('combat_hit');
        audioManager.setScene('combat');

        const playerArmySize = this.player.army ? this.player.army.length : 0;

        if (playerArmySize === 0) {
            // --- No army: player is robbed / roughed up ---
            const goldStolen = Math.min(this.player.gold, Math.floor(this.player.gold * Utils.randFloat(0.15, 0.4)));
            const healthLost = Utils.randInt(5, 15);

            this.player.gold -= goldStolen;
            this.player.health = Math.max(1, this.player.health - healthLost);

            // Steal random inventory items
            const stolenItems = {};
            if (this.player.inventory) {
                const itemKeys = Object.keys(this.player.inventory).filter(k => k !== 'quest' && this.player.inventory[k] > 0);
                const itemsToSteal = Math.min(itemKeys.length, Utils.randInt(1, 3));
                for (let i = 0; i < itemsToSteal; i++) {
                    const key = Utils.randPick(itemKeys);
                    const qty = Math.min(this.player.inventory[key], Utils.randInt(1, Math.ceil(this.player.inventory[key] * 0.5)));
                    if (qty > 0) {
                        this.player.inventory[key] -= qty;
                        stolenItems[key] = qty;
                        if (this.player.inventory[key] <= 0) delete this.player.inventory[key];
                    }
                }
            }

            // Transfer stolen goods to attacker
            attacker.inventory['gold'] = (attacker.inventory['gold'] || 0) + goldStolen;
            for (const [item, qty] of Object.entries(stolenItems)) {
                attacker.inventory[item] = (attacker.inventory[item] || 0) + qty;
            }

            // Build notification message
            let msg = `A ${attacker.name} ambushed you! Without an army you were defenseless.`;
            if (goldStolen > 0) msg += ` They stole ${goldStolen} gold.`;
            const stolenList = Object.entries(stolenItems).map(([k, v]) => `${v} ${k}`).join(', ');
            if (stolenList) msg += ` They also took: ${stolenList}.`;
            msg += ` You lost ${healthLost} health.`;

            this.ui.showNotification(`⚔️ ${attacker.name} Attack!`, msg, 'error');

            if (this.world.events) {
                this.world.events.push({
                    text: `${this.player.name || 'A traveller'} was robbed by a ${attacker.name}!`,
                    type: 'military'
                });
            }

            // The raider moves on after robbing (pick new target)
            attacker.targetQ = null;
            attacker.targetR = null;
        } else {
            // --- Player has army: full combat ---
            const result = PlayerMilitary.attackUnit(this.player, attacker, this.world);

            if (result.victory) {
                let lootMsg = `Victory! You defeated the ${attacker.name}!`;
                if (result.casualties > 0) lootMsg += ` Lost ${result.casualties} soldiers.`;
                if (result.loot > 0) lootMsg += ` Gained ${result.loot} gold.`;
                const itemLoot = Object.entries(result.inventoryLoot || {}).map(([k, v]) => `${v} ${k}`).join(', ');
                if (itemLoot) lootMsg += ` Seized: ${itemLoot}.`;
                if (result.renownChange > 0) lootMsg += ` +${result.renownChange} renown!`;

                this.ui.showNotification(`⚔️ Victory!`, lootMsg, 'success');
            } else {
                let defeatMsg = `Defeated by the ${attacker.name}!`;
                if (result.casualties > 0) defeatMsg += ` Lost ${result.casualties} soldiers.`;
                if (result.captured) {
                    defeatMsg += ` You have been captured and forced into servitude for ${result.servitudeDays} days!`;
                    if (result.goldConfiscated > 0) defeatMsg += ` ${result.goldConfiscated} gold confiscated.`;
                }
                this.ui.showNotification(`💀 Defeat!`, defeatMsg, 'error');
            }
        }

        // Restore music scene after combat
        setTimeout(() => {
            audioManager.updateSceneFromGameState(this);
        }, 3000);
    }

    /**
     * Show a custom modal to confirm ending the day
     */
    _showEndDayConfirm() {
        // Don't stack modals
        if (document.getElementById('endDayConfirmModal')) return;

        const overlay = document.createElement('div');
        overlay.id = 'endDayConfirmModal';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 1200;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            animation: fadeIn 0.2s ease;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: rgba(20, 24, 32, 0.98);
            border: 2px solid var(--gold);
            border-radius: 8px;
            padding: 28px 36px;
            min-width: 320px;
            max-width: 400px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8), 0 0 20px rgba(245,197,66,0.15);
        `;

        const ap = this.player.actionPoints != null ? this.player.actionPoints : 0;
        const maxAp = this.player.maxActionPoints || 10;
        const stam = this.player.movementRemaining != null ? this.player.movementRemaining : 0;

        box.innerHTML = `
            <div style="font-size: 28px; margin-bottom: 8px;">🌙</div>
            <h3 style="margin: 0 0 8px; font-family: var(--font-display); color: var(--gold); letter-spacing: 2px; text-transform: uppercase;">End Day ${this.world.day}?</h3>
            <p style="color: var(--text-secondary); font-size: 13px; margin: 0 0 16px; line-height: 1.5;">
                Resting will advance to the next day.<br>
                <span style="color: ${ap > 0 ? '#ff9800' : '#666'};">⚡ ${ap}/${maxAp} AP remaining</span>
                &nbsp;·&nbsp;
                <span style="color: ${stam > 0 ? '#4fc3f7' : '#666'};">🏃 ${stam} stamina left</span>
            </p>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button id="endDayCancel" style="
                    padding: 10px 24px; border-radius: 6px; cursor: pointer;
                    background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);
                    color: var(--text-secondary); font-family: var(--font-body); font-size: 13px;
                    transition: all 0.2s;
                ">Cancel</button>
                <button id="endDayConfirm" style="
                    padding: 10px 24px; border-radius: 6px; cursor: pointer;
                    background: rgba(245,197,66,0.15); border: 1px solid var(--gold);
                    color: var(--gold); font-family: var(--font-body); font-size: 13px;
                    font-weight: 600; transition: all 0.2s;
                ">Rest & End Day</button>
            </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        // Click outside to cancel
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.getElementById('endDayCancel').addEventListener('click', () => {
            overlay.remove();
        });

        document.getElementById('endDayConfirm').addEventListener('click', () => {
            overlay.remove();
            this._endDayConfirmed = true;
            this.endDay();
        });

        // Keyboard: Enter to confirm, Escape to cancel
        const keyHandler = (e) => {
            if (e.key === 'Enter') {
                overlay.remove();
                window.removeEventListener('keydown', keyHandler);
                this._endDayConfirmed = true;
                this.endDay();
            } else if (e.key === 'Escape') {
                overlay.remove();
                window.removeEventListener('keydown', keyHandler);
            }
        };
        window.addEventListener('keydown', keyHandler);
    }
}

// ============================================
// BOOT
// ============================================

window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Load all game data from JSON files before initializing
        await DataLoader.initializeAll();
        window.game = new Game();
    } catch (error) {
        console.error('Failed to initialize game:', error);
        document.body.innerHTML = `
            <div style="color:#ff4444;background:#1a1a2e;padding:40px;font-family:monospace;">
                <h1>Failed to Load Game Data</h1>
                <p>${error.message}</p>
                <p>Make sure you are running from a web server (use run.bat or run.sh).</p>
            </div>`;
    }
});
