// ============================================
// GAME SETUP � audio controls, title screen, randomize settings, startNewGame
// ============================================

import { icon } from '../icons.js';
import { FirstSteps } from '../../systems/firstSteps.js';
import { Scenarios } from '../../player/scenarios.js';
import { Dawn } from '../../world/dawn.js';
import { Barter } from '../../world/barter.js';
import { DawnBirth } from '../../player/dawnBirth.js';
import { Languages } from '../../systems/languages.js';
import { MetaLegacy } from '../../systems/metaLegacy.js';
import { MetaLegacyStart } from '../../systems/metaLegacyStart.js';
import { bindIronmanQuit } from './ironman.js';
import { Camera, Renderer, Player, World, SaveLoad, Terrain, Banking, MarketDynamics, Taxation, Characters, Minimap, UI, Quests, Achievements, Technology, Relationships, Ships, Titles, Councils, InnerMap, InnerMapRenderer, InnerMapCharacters, InnerMapCombat, LightSystem, ModStore, audioManager, DataLoader, Hex, Utils, PlayerActions, PlayerEconomy, PlayerMilitary, ActionMenu, Housing, House, Espionage, Gossip, Tavern, Economy, TiledExport, CustomObjects, CustomBuildings, Hotbar, NpcDialog } from './_gameImports.js';

export function _setupAudioControls() {
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
        if (iconSpan) iconSpan.innerHTML = icon('mute');
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
        if (iconSpan) iconSpan.innerHTML = icon(muted ? 'mute' : 'sound');
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
export function randomizeSettings() {
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
export function initTitleScreen() {
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
/**
 * Start a new game.
 * @param {Object} [settingsObj] - Settings from React. If omitted, reads from DOM (legacy).
 */
/** A world saved from the World Editor, by id (systems/modStore.js), or null. */
async function _loadCustomWorld(id) {
    try {
        await ModStore.init();
        const data = await ModStore.loadWorld(id);
        return data && data.width && data.height ? data : null;
    } catch (err) {
        console.error('Could not load the custom world', id, err);
        return null;
    }
}

export async function startNewGame(settingsObj) {
    console.log('Starting new game with custom settings...');

    if (this._reactMode) {
        // React mode — settings already provided, just run directly
        await this._doStartNewGame(settingsObj || {});
        return;
    }

    // Legacy mode — show loading overlay, then read settings from DOM
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingSubtext = document.getElementById('loadingSubtext');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (loadingSubtext) loadingSubtext.textContent = 'Forging continents and oceans...';

    // Use setTimeout to let the loading overlay render before heavy generation
    await new Promise((resolve) => {
        setTimeout(async () => {
            await this._doStartNewGame();
            resolve();
        }, 50);
    });
}

/**
 * Read settings from the DOM (legacy path only).
 */
export function _readSettingsFromDOM() {
    return {
        charFirstName: (document.getElementById('charFirstName')?.value || '').trim() || 'Wanderer',
        charLastName: (document.getElementById('charLastName')?.value || '').trim() || '',
        charGender: document.getElementById('charGender')?.value || 'male',
        charAge: parseInt(document.getElementById('charAge')?.value) || 20,
        worldWidth: parseInt(document.getElementById('worldWidth')?.value) || 120,
        worldHeight: parseInt(document.getElementById('worldHeight')?.value) || 80,
        continentCount: parseInt(document.getElementById('continentCount')?.value) || 3,
        terrainFreq: parseFloat(document.getElementById('terrainFreq')?.value) || 1.1,
        riverCount: parseInt(document.getElementById('riverCount')?.value) || 40,
        waterLevel: parseFloat(document.getElementById('waterLevel')?.value) || 0.42,
        mapSeed: (document.getElementById('mapSeed')?.value || '').trim() || null,
        continentSize: document.getElementById('continentSize')?.value || 'medium',
        islandFreq: parseFloat(document.getElementById('islandFreq')?.value) || 1.0,
        landMass: parseInt(document.getElementById('landMass')?.value) || 45,
        mountainDensity: parseInt(document.getElementById('mountainDensity')?.value) || 100,
        hillDensity: parseInt(document.getElementById('hillDensity')?.value) || 100,
        flatness: document.getElementById('flatness')?.value || 'normal',
        temperature: document.getElementById('temperature')?.value || 'normal',
        rainfall: document.getElementById('rainfall')?.value || 'normal',
        polarIce: document.getElementById('polarIce')?.value || 'normal',
        desertFreq: document.getElementById('desertFreq')?.value || 'normal',
        forestDensity: parseInt(document.getElementById('forestDensity')?.value) || 100,
        lakeFreq: document.getElementById('lakeFreq')?.value || 'normal',
        resourceDensity: document.getElementById('resourceDensity')?.value || 'normal',
        strategicRes: document.getElementById('strategicRes')?.value || 'normal',
        terrainOctaves: parseInt(document.getElementById('terrainOctaves')?.value) || 6,
        heatFreq: parseFloat(document.getElementById('heatFreq')?.value) || 3.0,
        moistFreq: parseFloat(document.getElementById('moistFreq')?.value) || 2.0,
        coastalDetail: parseInt(document.getElementById('coastalDetail')?.value) || 5,
        deepWaterLevel: parseFloat(document.getElementById('deepWaterLevel')?.value) || 0.20,
        hillsLevel: parseFloat(document.getElementById('hillsLevel')?.value) || 0.52,
        mountainLevel: parseFloat(document.getElementById('mountainLevel')?.value) || 0.70,
        snowPeakLevel: parseFloat(document.getElementById('snowPeakLevel')?.value) || 0.88,
        kingdomCount: parseInt(document.getElementById('kingdomCount')?.value) || 6,
        independentSettlements: document.getElementById('independentSettlements')?.value || 'normal',
        ruinsFreq: document.getElementById('ruinsFreq')?.value || 'normal',
    };
}

/**
 * Internal: perform the actual game start.
 * @param {Object} [settingsOverride] - Settings from React (if provided, skip DOM read)
 */
export async function _doStartNewGame(settingsOverride) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingSubtext = document.getElementById('loadingSubtext');

    try {

    // (the court scribe's retellings were of the world left behind: ui/actionMenu/annals.js)
    this._annalsScribe = null;

    // Read settings — from React override or from DOM
    const s = settingsOverride || this._readSettingsFromDOM();
    const charFirstName = s.charFirstName || 'Wanderer';
    const charLastName = s.charLastName || '';
    const charGender = s.charGender || 'male';
    const charAge = parseInt(s.charAge) || 20;
    const width = parseInt(s.worldWidth) || 120;
    const height = parseInt(s.worldHeight) || 80;
    const continentCount = parseInt(s.continentCount) || 3;
    const terrainFreq = parseFloat(s.terrainFreq) || 1.1;
    const riverCount = parseInt(s.riverCount) || 40;
    const waterThreshold = parseFloat(s.waterLevel) || 0.42;
    const mapSeed = s.mapSeed || null;
    const continentSize = s.continentSize || 'medium';
    const islandFreq = parseFloat(s.islandFreq) || 1.0;
    const landMass = parseInt(s.landMass) || 45;
    const mountainDensity = parseInt(s.mountainDensity) || 100;
    const hillDensity = parseInt(s.hillDensity) || 100;
    const flatness = s.flatness || 'normal';
    const temperature = s.temperature || 'normal';
    const rainfall = s.rainfall || 'normal';
    const polarIce = s.polarIce || 'normal';
    const desertFreq = s.desertFreq || 'normal';
    const forestDensity = parseInt(s.forestDensity) || 100;
    const lakeFreq = s.lakeFreq || 'normal';
    const resourceDensity = s.resourceDensity || 'normal';
    const strategicRes = s.strategicRes || 'normal';
    const terrainOctaves = parseInt(s.terrainOctaves) || 6;
    const heatFreq = parseFloat(s.heatFreq) || 3.0;
    const moistFreq = parseFloat(s.moistFreq) || 2.0;
    const coastalDetail = parseInt(s.coastalDetail) || 5;
    const deepWaterLevel = parseFloat(s.deepWaterLevel) || 0.20;
    const hillsLevel = parseFloat(s.hillsLevel) || 0.52;
    const mountainLevel = parseFloat(s.mountainLevel) || 0.70;
    const snowPeakLevel = parseFloat(s.snowPeakLevel) || 0.88;
    const kingdomCount = parseInt(s.kingdomCount) || 6;
    // The calendar's first year; before the dawn year there are no towns or realms yet (world/dawn.js)
    // (a hand-made map can't begin at the Dawn of Man: it has no wandering clans)
    const startYear = Math.max(s.customWorldId ? Dawn.dawnYear() : 1, parseInt(s.startYear) || 853);
    const dawnStart = Dawn.isDawnStart({ startYear });
    const independentSettlements = s.independentSettlements || 'normal';
    const ruinsFreq = s.ruinsFreq || 'normal';
    // Game options (available to subsystems like InnerMap)
    window.gameOptions = window.gameOptions || {};

    // Clear any cached inner maps from a previous game session
    if (typeof InnerMap !== 'undefined' && InnerMap.clearCache) InnerMap.clearCache();

    // Reset data pipeline so fresh gamedata (including ModStore edits) is reloaded
    DataLoader.reset();
    // ...and reload it: without this every system that reads DataLoader._gamedata
    // synchronously (the town markets, harvests, roads, mints, ...) ran on its
    // built-in defaults or nothing at all — the markets stocked no goods
    await DataLoader.initializeAll();
    CustomObjects.reset();
    CustomBuildings.reset();
    InnerMapRenderer.reset();

    // A map made in the World Editor (chosen on the New Game screen), or a new world generated
    const customWorld = s.customWorldId ? await _loadCustomWorld(s.customWorldId) : null;
    if (customWorld) {
        this.world = new World(customWorld.width, customWorld.height);
        // (the calendar starts in the chosen year; the map is yours as you made it)
        this.world.loadFromEditorData(customWorld, kingdomCount, { startYear });
    } else {
    this.world = new World(width, height);
    this.world.generate({
        seed: mapSeed,
        // Current terrain generator: 2 = peaks on land, rivers that reach the
        // sea; 3 = generated with the true hex distance (core/hex.js); 4 =
        // towns built in their culture's own architecture (data/architecture.json); 5 = towns
        // with a churchyard planned beside the church (world/churchyard.js); 6 = a start
        // year before the mature year ages the world back (world/worldAge.js); 7 = a town's house
        // mix humbler or grander by its wealth (world/settlementWealth.js, world/townPlanner.js); 8 =
        // towns that age through architectural eras, weather, rebuild, pave and wall themselves (world/townEras.js)
        terrainGen: 8,
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
        startYear,
        independentSettlements,
        ruinsFreq
    });
    }

    // Create player
    this.player = new Player({
        firstName: charFirstName,
        lastName: charLastName,
        gender: charGender,
        age: charAge,
        appearance: s.charAppearance || null
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
    const playerPos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
    this.camera.centerOn(playerPos.x, playerPos.y);

    // Initialize UI
    this.ui = new UI(this);
    this.ui.applySettings();
    this.ui.updateStats(this.player, this.world);

    // Initialize minimap
    this.minimap = new Minimap(this);

    // Initialize quests and achievements
    Quests.initialize(this.player);
    Quests.grantStarterQuest(this.player, this.world);
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

    // At the Dawn of Man the player is born into a wandering clan, with a
    // family about them (player/dawnBirth.js)
    if (dawnStart) {
        DawnBirth.apply(this.player, this.world);
        const pos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
        this.camera.centerOn(pos.x, pos.y);
    }

    // The mother tongue: the clan's at the dawn, else the one spoken where you begin (systems/languages.js)
    Languages.initialize(this.player, this.world);

    // Initialize the House (dynasty spine) — after relationships so family exists
    if (typeof House !== 'undefined') {
        House.initialize(this.player, this.world);
        House.seedRivals(this.player, this.world);
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

    // Origin, difficulty and victory goal (player/scenarios.js): shapes the
    // player and sets player.scenario before the onboarding below reads it
    const scenarioStart = Scenarios.apply(this.player, this.world, {
        // At the dawn there are no courts or towns to be born into: a wanderer
        origin: dawnStart ? 'wanderer' : s.origin, difficulty: s.difficulty, victory: s.victory,
        // (the New Game sheet sets the guided start from the origin; the player may override it)
        guidedStart: typeof s.guidedStart === 'boolean' ? s.guidedStart : undefined,
        // Born to a Family (player/parentage.js): whose child, and how old
        parents: s.parents, birthAge: s.birthAge,
    });
    // The run (systems/metaLegacy.js): Ironman or not, and what the Hall of Houses
    // gives this game (a legacy start, an inheritance, a lineage: systems/metaLegacyStart.js)
    this.world.run = MetaLegacy.newRun({
        ironman: !!s.ironman, origin: this.player.scenario ? this.player.scenario.id : s.origin, difficulty: s.difficulty,
        seed: (this.world.generationParams && this.world.generationParams.seed) || mapSeed, startYear: this.world.year,
    });
    const legacyStart = MetaLegacyStart.apply(this.player, this.world, {
        lineage: s.legacyLineage || null, boon: s.legacyBoon || null, origin: s.legacyOrigin || null,
    });
    bindIronmanQuit(this);
    // At the dawn there is no coin (world/barter.js): the start purse is given as
    // goods of its worth, and the purse is reckoned in the goods carried
    Barter.beginPlayer(this.player, this.world);
    {
        // An origin may begin somewhere else: look there
        const pos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
        this.camera.centerOn(pos.x, pos.y);
    }

    // The guided first month (systems/firstSteps.js): on unless the "Guided start"
    // setting or the chosen scenario (player.scenario.guidedStart) turns it off
    FirstSteps.initialize(this.player, this.world, {
        enabled: s.guidedStart !== false && this.player.scenario?.guidedStart !== false,
    });
    this.ui.updateStats(this.player, this.world); // draws the First Steps card

    console.log('Game started!');
    // Hide title and settings screen (legacy DOM path)
    if (!this._reactMode) {
        const settingsEl = document.getElementById('settingsScreen');
        if (settingsEl) settingsEl.classList.add('hidden');
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        this.ui.hideTitleScreen();
    }

    // Show welcome notification
    const totalTiles = this.world.width * this.world.height;
    const mapDesc = totalTiles > 40000 ? 'vast' : totalTiles > 15000 ? 'large' : 'ready';
    setTimeout(() => {
        // (the origin's welcome — the Wanderer's is the classic one)
        this.ui.showNotification(`${scenarioStart.icon || ''} Welcome, ${this.player.name}`.trim(), (dawnStart && DawnBirth.welcome(this.player, this.world)) || scenarioStart.welcome || `You are a wanderer in a ${mapDesc} world of ${this.world.kingdoms.length} kingdoms. Click on the map to move, explore settlements, and forge your destiny.`, 'info');
        // The Hall of Houses remembers (systems/metaLegacyStart.js); an Ironman run says so
        if (legacyStart.welcome || legacyStart.lines.length) this.ui.showNotification('🏛️ The Hall remembers', [legacyStart.welcome, ...legacyStart.lines].filter(Boolean).join(' '), 'info');
        if (this.world.run && this.world.run.ironman) this.ui.showNotification('⚒️ Ironman', "One save, kept at each day's end and when you leave. No loading back: what happens, happened.", 'warning');
        // Born to a Family, parents to be chosen: the picker (ui/actionMenu/parents.js)
        if (this.player.parentage && this.player.parentage.pending && typeof ActionMenu.showParentPicker === 'function') ActionMenu.showParentPicker(this);
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

