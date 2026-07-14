// ============================================
// GAME — Main game controller
// ============================================

import { Camera } from '../camera.js';
import { Renderer } from '../renderer.js';
import { Player } from '../../player/player.js';
import { World } from '../../world/world.js';
import { SaveLoad } from '../../systems/saveLoad.js';
import { Terrain } from '../../world/terrain.js';
import { Banking, MarketDynamics, Taxation } from '../../systems/marketDynamics.js';
import { Characters } from '../../world/characters.js';
import { Minimap } from '../minimap.js';
import { UI } from '../ui.js';
import { Quests } from '../../systems/quests.js';
import { Achievements } from '../../systems/achievements.js';
import { Technology } from '../../systems/technology.js';
import { Relationships } from '../../systems/relationships.js';
import { Ships } from '../../systems/ships.js';
import { Titles } from '../../systems/titles.js';
import { Councils } from '../../systems/councils.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';
import { InnerMapCombat } from '../innerMapCombat.js';
import { LightSystem } from '../lightSystem.js';
import { ModStore } from '../../systems/modStore.js';
import { audioManager } from '../../systems/audio.js';
import { DataLoader } from '../../core/dataLoader.js';
import { Hex } from '../../core/hex.js';
import { Utils } from '../../core/utils.js';
import { PlayerActions } from '../../player/playerActions.js';
import { PlayerEconomy } from '../../player/playerEconomy.js';
import { PlayerMilitary } from '../../player/playerMilitary.js';
import { ActionMenu } from '../actionMenu.js';
import { Housing } from '../../systems/housing.js';
import { Espionage } from '../../systems/espionage.js';
import { Gossip } from '../../systems/gossip.js';
import { Tavern } from '../../player/tavern.js';
import { Economy } from '../../world/economy.js';
import { TiledExport } from '../../systems/tiledExport.js';
import { CustomObjects } from '../../world/customObjects.js';
import { CustomBuildings } from '../../world/customBuildings.js';
import { Hotbar } from '../hotbar.js';
import { NpcDialog } from '../npcDialog.js';

// Side-effect imports: these extend InnerMapRenderer via Object.assign
import '../innerMapLayers.js';
import '../innerMapUI.js';

export class Game {
    /**
     * @param {Object} [opts]
     * @param {HTMLCanvasElement} [opts.canvas] - Canvas element (if omitted, looks for #gameCanvas)
     * @param {boolean} [opts.reactMode] - Skip legacy DOM setup when true
     */
    constructor(opts = {}) {
        this._reactMode = !!opts.reactMode;
        this.canvas = opts.canvas || document.getElementById('gameCanvas');
        if (!this.canvas) throw new Error('Game: canvas element not found');

        this.camera = new Camera(this.canvas);
        this.camera.locked = true;  // Camera always follows player
        this.renderer = new Renderer(this.canvas, this.camera);
        this.world = null;
        this.player = null;
        this.ui = null;
        this.minimap = null;

        this.isRunning = false;
        this.lastTime = 0;
        this.timeSpeed = 1;
        this._timeAccumulator = 0;

        // Mouse state
        this.mouseX = 0;
        this.mouseY = 0;
        this.mouseDown = false;
        this.mouseDownTime = 0;
        this.mouseDownPos = { x: 0, y: 0 };
        this.isProcessingTurn = false;

        // Inner map state
        this.innerMapCamera = new Camera(this.canvas);
        this.innerMapCamera.locked = true;  // Camera always follows player
        this.innerMapMode = false;
        this._enteringInnerMap = false;

        this.setupInputHandlers();

        // In React mode, title/settings/editor logic is handled by React components
        if (!this._reactMode) {
            this.initTitleScreen();
            this._setupAudioControls();

            // Title screen buttons — must be bound here since UI isn't created yet
            const btnNew = document.getElementById('btnNewGame');
            const btnBack = document.getElementById('btnBackToTitle');
            const btnStart = document.getElementById('btnStartGame');
            if (btnNew) btnNew.addEventListener('click', () => this.showSettingsScreen());
            if (btnBack) btnBack.addEventListener('click', () => this.hideSettingsScreen());
            if (btnStart) btnStart.addEventListener('click', () => this.startNewGame());

            // Continue button logic
            const btnContinue = document.getElementById('btnContinue');
            if (btnContinue && SaveLoad.hasSave()) {
                btnContinue.disabled = false;
                btnContinue.addEventListener('click', () => this.resumeGame());
            }

            // ── Editor / World Editor overlays ──
            this._initEditorOverlays();
        }

        // Range input value displays (legacy DOM only)
        if (!this._reactMode) {
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
        }

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
}

