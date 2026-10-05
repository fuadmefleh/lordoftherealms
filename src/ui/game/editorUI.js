// ============================================
// EDITOR UI � resumeGame, settings screen, editor overlays, custom world
// ============================================

import { Camera, Renderer, Player, World, SaveLoad, Terrain, Banking, MarketDynamics, Taxation, Characters, Minimap, UI, Quests, Achievements, Technology, Relationships, Ships, Titles, Councils, InnerMap, InnerMapRenderer, InnerMapCharacters, InnerMapCombat, LightSystem, ModStore, audioManager, DataLoader, Hex, Utils, PlayerActions, PlayerEconomy, PlayerMilitary, ActionMenu, Housing, Espionage, Gossip, Tavern, Economy, TiledExport, CustomObjects, CustomBuildings, Hotbar, NpcDialog } from './_gameImports.js';

export function resumeGame() {
    const result = SaveLoad.loadGame();
    if (!result.success) return;

    const data = result.data;

    // Reconstruct world
    this.world = new World(data.world.width, data.world.height);
    // Regenerate the same terrain from the saved seed (older saves had none)
    this.world.generate(data.world.generationParams || {});
    SaveLoad.restoreWorld(data.world, this.world);

    // Recalculate regions for routing (important for older saves)
    Terrain.identifyRegions(this.world.tiles, this.world.width, this.world.height);

    // Reconstruct player
    this.player = new Player();
    SaveLoad.restorePlayer(data.player, this.player, this.world);

    // Restore fog of war visibility around player position
    this.player.updateVisibility(this.world, 4);

    // Setup renderer
    this.renderer.setWorld(this.world);
    this.renderer.setPlayer(this.player);

    // Initialize market dynamics
    MarketDynamics.initialize();
    // ...and every settlement's goods market (older saves get one at equilibrium)
    SaveLoad.restoreMarkets(data.world, this.world);

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
    const playerPos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
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
export function showSettingsScreen() {
    document.getElementById('titleScreen').classList.add('hidden');
    document.getElementById('settingsScreen').classList.remove('hidden');
}

/**
 * Hide settings screen
 */
export function hideSettingsScreen() {
    document.getElementById('settingsScreen').classList.add('hidden');
    document.getElementById('titleScreen').classList.remove('hidden');
}

// ═══════════════════════════════════════════════════
// EDITOR / WORLD-EDITOR OVERLAYS
// ═══════════════════════════════════════════════════

export function _initEditorOverlays() {
    // Mod Tools button → open editor overlay
    const btnModTools = document.getElementById('btnModTools');
    if (btnModTools) {
        btnModTools.addEventListener('click', () => this.openEditorOverlay());
    }

    // World Editor button → open world editor overlay
    const btnWorldEditor = document.getElementById('btnWorldEditor');
    if (btnWorldEditor) {
        btnWorldEditor.addEventListener('click', () => this.openWorldEditorOverlay());
    }

    // Close buttons
    const btnEditorClose = document.getElementById('btnEditorClose');
    if (btnEditorClose) {
        btnEditorClose.addEventListener('click', () => this.closeEditorOverlay());
    }

    const btnWorldClose = document.getElementById('btnWorldClose');
    if (btnWorldClose) {
        btnWorldClose.addEventListener('click', () => this.closeWorldEditorOverlay());
    }

    // Save buttons
    const btnEditorSave = document.getElementById('btnEditorSave');
    if (btnEditorSave) {
        btnEditorSave.addEventListener('click', () => this.saveEditorData());
    }

    const btnWorldSave = document.getElementById('btnWorldSave');
    if (btnWorldSave) {
        btnWorldSave.addEventListener('click', () => this.saveWorldData());
    }

    const btnWorldLoad = document.getElementById('btnWorldLoad');
    if (btnWorldLoad) {
        btnWorldLoad.addEventListener('click', () => this.showWorldLoadDialog());
    }

    // Initialize ModStore
    if (typeof ModStore !== 'undefined') {
        ModStore.init().catch(err => console.warn('ModStore init failed:', err));
    }

    // Play Custom World button
    const btnPlayCustom = document.getElementById('btnPlayCustom');
    if (btnPlayCustom) {
        btnPlayCustom.addEventListener('click', () => this.showCustomWorldPicker());
    }
}

export function openEditorOverlay() {
    const overlay = document.getElementById('editorOverlay');
    const frame = document.getElementById('editorFrame');
    if (!overlay || !frame) return;
    overlay.classList.remove('hidden');
    if (!frame.src || frame.src === 'about:blank') {
        frame.src = 'editor.html';
    }
}

export function closeEditorOverlay() {
    const overlay = document.getElementById('editorOverlay');
    const frame = document.getElementById('editorFrame');
    if (!overlay) return;
    overlay.classList.add('hidden');
    // Unload iframe to free resources
    if (frame) frame.src = 'about:blank';
}

export function openWorldEditorOverlay() {
    const overlay = document.getElementById('worldEditorOverlay');
    const frame = document.getElementById('worldEditorFrame');
    if (!overlay || !frame) return;
    overlay.classList.remove('hidden');
    if (!frame.src || frame.src === 'about:blank') {
        frame.src = 'world_editor.html';
    }
}

export function closeWorldEditorOverlay() {
    const overlay = document.getElementById('worldEditorOverlay');
    const frame = document.getElementById('worldEditorFrame');
    if (!overlay) return;
    overlay.classList.add('hidden');
    if (frame) frame.src = 'about:blank';
}

export async function saveEditorData() {
    try {
        const frame = document.getElementById('editorFrame');
        if (!frame || !frame.contentWindow) return;
        // Try to get export data from the editor iframe
        let data = null;
        if (typeof frame.contentWindow.getExportData === 'function') {
            data = frame.contentWindow.getExportData();
        }
        if (data && typeof ModStore !== 'undefined') {
            await ModStore.saveModData(data);
            this._editorFlashButton('btnEditorSave', '✅ Saved!');
        }
    } catch (err) {
        console.error('Failed to save editor data:', err);
        this._editorFlashButton('btnEditorSave', '❌ Error');
    }
}

export async function saveWorldData() {
    try {
        const frame = document.getElementById('worldEditorFrame');
        if (!frame || !frame.contentWindow) return;
        let data = null;
        if (typeof frame.contentWindow.getExportData === 'function') {
            data = frame.contentWindow.getExportData();
        }
        if (data && typeof ModStore !== 'undefined') {
            const id = (data.name || 'world').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
            await ModStore.saveWorld(id, data);
            this._editorFlashButton('btnWorldSave', '✅ Saved!');
        }
    } catch (err) {
        console.error('Failed to save world:', err);
        this._editorFlashButton('btnWorldSave', '❌ Error');
    }
}

export async function showWorldLoadDialog() {
    try {
        if (typeof ModStore === 'undefined') return;
        const worlds = await ModStore.listWorlds();
        if (!worlds || worlds.length === 0) {
            alert('No saved worlds found. Create one first!');
            return;
        }
        const list = worlds.map((w, i) => `${i + 1}. ${w.name || w.id} (${w.width}×${w.height})`).join('\n');
        const choice = prompt('Select a world to load:\n\n' + list + '\n\nEnter number:');
        if (!choice) return;
        const idx = parseInt(choice) - 1;
        if (idx < 0 || idx >= worlds.length) return;
        const worldData = await ModStore.loadWorld(worlds[idx].id);
        if (worldData) {
            const frame = document.getElementById('worldEditorFrame');
            if (frame && frame.contentWindow) {
                frame.contentWindow.postMessage({ type: 'loadWorld', world: worldData }, '*');
            }
        }
    } catch (err) {
        console.error('Failed to load world:', err);
    }
}

export function _editorFlashButton(btnId, text) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = orig; }, 1500);
}

/**
 * Show a picker of saved custom worlds and start the game on the selected one.
 */
export async function showCustomWorldPicker() {
    if (typeof ModStore === 'undefined') {
        alert('ModStore not available.');
        return;
    }

    const modal = document.getElementById('customWorldModal');
    const body = document.getElementById('cwModalBody');
    const closeBtn = document.getElementById('cwModalClose');
    const cancelBtn = document.getElementById('cwModalCancel');
    if (!modal || !body) return;

    const closeModal = () => modal.classList.add('hidden');
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.querySelector('.cw-modal-backdrop').onclick = closeModal;

    // Show modal with loading state
    body.innerHTML = '<p class="cw-modal-empty">Loading worlds…</p>';
    modal.classList.remove('hidden');

    try {
        const worlds = await ModStore.listWorlds();
        if (!worlds || worlds.length === 0) {
            body.innerHTML = '<p class="cw-modal-empty">No saved worlds found.<br>Open the World Editor, design a map, and save it first!</p>';
            return;
        }

        body.innerHTML = '';
        for (const w of worlds) {
            const item = document.createElement('div');
            item.className = 'cw-world-item';
            const info = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'cw-world-name';
            name.textContent = w.name || w.id;
            const meta = document.createElement('div');
            meta.className = 'cw-world-meta';
            meta.textContent = `${w.width} × ${w.height} tiles`;
            info.appendChild(name);
            info.appendChild(meta);
            const playLabel = document.createElement('span');
            playLabel.className = 'cw-world-play';
            playLabel.textContent = 'PLAY ▶';
            item.appendChild(info);
            item.appendChild(playLabel);
            item.addEventListener('click', async () => {
                closeModal();
                try {
                    const worldData = await ModStore.loadWorld(w.id);
                    if (!worldData) { alert('Failed to load world data.'); return; }
                    this.startCustomWorld(worldData);
                } catch (err) {
                    console.error('Custom world picker error:', err);
                    alert('Error loading world: ' + err.message);
                }
            });
            body.appendChild(item);
        }
    } catch (err) {
        console.error('Custom world picker error:', err);
        body.innerHTML = `<p class="cw-modal-empty">Error loading worlds: ${err.message}</p>`;
    }
}

/**
 * Start the game using a custom world from the editor.
 */
export function startCustomWorld(editorWorldData) {
    console.log('Starting game with custom world:', editorWorldData.name);

    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingSubtext = document.getElementById('loadingSubtext');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (loadingSubtext) loadingSubtext.textContent = 'Loading custom world...';

    setTimeout(() => {
        try {
            // Clear any cached inner maps
            if (typeof InnerMap !== 'undefined' && InnerMap.clearCache) InnerMap.clearCache();

            // Create and populate world from editor data
            this.world = new World(editorWorldData.width, editorWorldData.height);
            this.world.loadFromEditorData(editorWorldData);

            // Create player with default character (user can customize later)
            this.player = new Player({
                firstName: 'Wanderer',
                lastName: '',
                gender: 'male',
                age: 20,
            });
            this.player.placeInWorld(this.world);

            // Setup renderer
            this.renderer.setWorld(this.world);
            this.renderer.setPlayer(this.player);

            const worldPixelWidth = Math.sqrt(3) * this.renderer.hexSize * this.world.width;
            const worldPixelHeight = 1.5 * this.renderer.hexSize * this.world.height;
            this.camera.setWorldBounds(worldPixelWidth, worldPixelHeight);

            const playerPos = this.renderer.getHexPixelPos(this.player.q, this.player.r);
            this.camera.centerOn(playerPos.x, playerPos.y);

            // Initialize UI
            this.ui = new UI(this);
            this.ui.applySettings();
            this.ui.updateStats(this.player, this.world);
            this.minimap = new Minimap(this);

            Quests.initialize(this.player);
            Quests.grantStarterQuest(this.player, this.world);
            Achievements.initialize(this.player);
            MarketDynamics.initialize();
            if (typeof Technology !== 'undefined') Technology.initPlayer(this.player);
            if (typeof Relationships !== 'undefined') Relationships.initialize(this.player);
            if (!this.player.taxRate) this.player.taxRate = 'moderate';
            if (typeof Titles !== 'undefined') Titles.initialize(this.player);
            if (typeof Councils !== 'undefined') Councils.initializePlayer(this.player);

            // Hide title screen, show game
            document.getElementById('settingsScreen')?.classList.add('hidden');
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            this.ui.hideTitleScreen();

            setTimeout(() => {
                this.ui.showNotification(
                    'Custom World: ' + (editorWorldData.name || 'Unnamed'),
                    `Playing on a hand-crafted ${this.world.width}×${this.world.height} world with ${this.world.kingdoms.length} kingdoms.`,
                    'info'
                );
            }, 1200);

            this.isRunning = true;
            this.lastTime = performance.now();
            requestAnimationFrame((t) => this.gameLoop(t));
            audioManager.updateSceneFromGameState(this);
        } catch (err) {
            console.error('Error starting custom world:', err);
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            alert('Failed to start custom world: ' + err.message);
        }
    }, 50);
}

/**
 * Setup audio mute/volume button and popup controls
 */

