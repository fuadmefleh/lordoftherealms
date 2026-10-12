import React, { useEffect, useRef } from 'react';
import { useGame } from '../context/GameContext';
import TopBar from './TopBar';
import Icon from './Icon';
import { Game } from '../ui/game';
import { DataLoader } from '../core/dataLoader';

// Persist game instance at module level so Vite HMR doesn't lose it.
// React Fast Refresh re-runs all effect cleanups (even [] deps) during HMR,
// which would kill the game loop and null-out gameRef. By keeping a reference
// here, the next render can recover the running game.
let _hmrGame = null;

export default function GameView() {
  const { gameState, gameRef, setPhase, updatePlayerStats, updateTurn } = useGame();
  const canvasRef = useRef(null);
  const initRef = useRef(false);

  // ── HMR recovery: if a previous game instance survived a hot reload,
  //    re-attach it to gameRef and restart the loop.
  useEffect(() => {
    if (_hmrGame && !gameRef.current && gameState.phase === 'playing') {
      _hmrGame.isRunning = true;
      _hmrGame.lastTime = performance.now();
      gameRef.current = _hmrGame;
      requestAnimationFrame((t) => _hmrGame.gameLoop(t));
    }
  });

  // Unmount-only cleanup: stop the game loop when GameView leaves the DOM.
  // This must NOT be in the phase-dependent effect, because that effect's
  // cleanup runs on every phase change (loading → playing), which would
  // kill the game loop the instant setPhase('playing') triggers a re-render.
  useEffect(() => {
    return () => {
      if (gameRef.current) {
        gameRef.current.isRunning = false;
        gameRef.current = null;
      }
      // Don't clear _hmrGame here — it's intentionally kept alive
      // so HMR can recover. It gets replaced when a new game starts.
    };
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    if (gameState.phase !== 'loading') return;
    if (!canvasRef.current) return;
    initRef.current = true;

    const settings = gameState.settings || {};
    const customWorldData = settings._customWorldData;

    // Track whether this effect invocation was cleaned up (React StrictMode)
    let cancelled = false;

    // Initialize game asynchronously
    (async () => {
      try {
        // Initialize all game data first
        await DataLoader.initializeAll();
        if (cancelled) return;

        // Create the Game instance in React mode, passing the canvas directly
        const game = new Game({ canvas: canvasRef.current, reactMode: true });
        if (cancelled) { game.isRunning = false; return; }
        gameRef.current = game;
        _hmrGame = game;  // Persist for HMR recovery
        // NOTE: the live Game is intentionally NOT published to window.game.
        // Panel HTML routes clicks through delegated data-ui-act / data-am-act
        // handlers (see src/ui/ui.js) that hold the game reference internally.
        // Domain code (core/world/systems/player) must never read a game global
        // (enforced by the no-restricted-globals ESLint rule). See
        // docs/architecture-globals.md.

        // Bridge: let the Game push stats back into React
        game._reactBridge = { updatePlayerStats, updateTurn, setPhase };

        if (customWorldData) {
          // Start with custom world from editor
          game.startCustomWorld(customWorldData);
        } else {
          // Start the game with settings
          await game.startNewGame(settings);
        }

        if (cancelled) return;
        setPhase('playing');
      } catch (err) {
        if (cancelled) return;
        console.error('[GameView] Failed to initialize game:', err);
        setPhase('title');
      }
    })();

    return () => {
      // Mark this effect invocation as stale (handles React StrictMode double-fire).
      // Do NOT kill the game loop here — this cleanup runs on every phase change,
      // not just on unmount. The unmount-only effect above handles that.
      cancelled = true;
      initRef.current = false;
    };
  }, [gameState.phase]);

  return (
    <>
      {/* Main Game Canvas */}
      <canvas id="gameCanvas" ref={canvasRef}></canvas>

      {/* Top Bar HUD — always rendered so UI.setupEventListeners can bind */}
      <TopBar />

      {/* ═══ Left icon rail ═══ */}
      <div id="hudLeftRail" className="hud-frame">
        <button className="hud-rail-btn active" id="railOverview" title="Overview">
          <span className="hud-rail-icon"><Icon name="crown" /></span>
          <span className="hud-rail-label">Overview</span>
        </button>
        <button className="hud-rail-btn" id="railArmies" title="Armies">
          <span className="hud-rail-icon"><Icon name="swords" /></span>
          <span className="hud-rail-label">Armies</span>
        </button>
        <button className="hud-rail-btn" id="railSettlements" title="Settlements">
          <span className="hud-rail-icon"><Icon name="castle" /></span>
          <span className="hud-rail-label">Settlements</span>
        </button>
        <button className="hud-rail-btn" id="railResources" title="Resources">
          <span className="hud-rail-icon"><Icon name="pickaxe" /></span>
          <span className="hud-rail-label">Resources</span>
        </button>
        <button className="hud-rail-btn" id="railFactions" title="Factions">
          <span className="hud-rail-icon"><Icon name="shield" /></span>
          <span className="hud-rail-label">Factions</span>
        </button>
      </div>

      {/* ═══ Right info panel ═══ */}
      <div id="hudRightRail">
        {/* Current Objective */}
        <div className="hud-frame hud-info-card">
          <div className="hud-card-header">◆ Current Objective</div>
          <div className="hud-obj-body">
            <div className="hud-obj-row">
              <div className="hud-obj-text">
                <div className="hud-obj-title" id="objectiveTitle">A New Beginning</div>
                <div className="hud-obj-desc" id="objectiveDesc">Explore nearby lands, discover settlements, and grow your influence.</div>
              </div>
              <div className="hud-obj-compass"><Icon name="compass" /></div>
            </div>
            <div className="hud-obj-progress-row">
              <span className="hud-obj-prog-label">◆ Explore hexes</span>
              <span className="hud-obj-prog-count" id="objectiveProgress">0 / 2</span>
            </div>
          </div>
        </div>

        {/* Region Details */}
        <div className="hud-frame hud-info-card">
          <div className="hud-card-header">Region Details</div>
          <div className="hud-region-body">
            <div className="hud-region-title-row">
              <span className="hud-region-terrain-icon" id="regionTerrainIcon">🌳</span>
              <div>
                <div className="hud-region-name" id="regionName">Coastal Woodlands</div>
                <div className="hud-region-subtitle" id="regionSubtitle">Unclaimed Lands</div>
              </div>
            </div>
            <div className="hud-region-desc" id="regionDesc">Forests and rolling hills stretch across this peaceful land.</div>
            <div className="hud-region-stats">
              <div className="hud-region-stat">
                <span className="hud-region-stat-label">Terrain</span>
                <span className="hud-region-stat-val" id="regionTerrain">Forest</span>
              </div>
              <div className="hud-region-stat">
                <span className="hud-region-stat-label">Move Cost</span>
                <span className="hud-region-stat-val" id="regionMoveCost">2</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Events */}
        <div className="hud-frame hud-info-card">
          <div className="hud-card-header">Recent Events</div>
          <div className="hud-events" id="eventsList"></div>
        </div>
      </div>

      {/* ═══ Bottom-left character card ═══ */}
      <div id="hudCharCard" className="hud-frame">
        <div className="hud-char-portrait-wrap">
          <div className="hud-char-portrait" id="charCardPortrait">🧑</div>
          <span className="hud-char-level" id="charCardLevel">1</span>
        </div>
        <div className="hud-char-info">
          <div className="hud-char-name" id="charCardName">WANDERER</div>
          <div className="hud-char-alignment" id="charCardAlignment">Unaligned</div>
          <div className="hud-char-stat">
            <span className="hud-char-stat-icon"><Icon name="heart" /></span>
            <span className="hud-char-stat-val" id="charCardMorale">100%</span>
            <span className="hud-char-stat-label">Morale</span>
          </div>
          <div className="hud-char-stat">
            <span className="hud-char-stat-icon"><Icon name="banner" /></span>
            <span className="hud-char-stat-val" id="charCardStance">Neutral</span>
            <span className="hud-char-stat-label">Stance</span>
          </div>
        </div>
      </div>

      {/* Minimap */}
      <div id="minimapContainer" className="hud-frame">
        <div id="minimapLabel">World Map</div>
        <canvas id="minimapCanvas"></canvas>
        <div className="minimap-zoom">
          <button className="minimap-zoom-btn" id="minimapZoomOut" title="Zoom Out">−</button>
          <button className="minimap-zoom-btn" id="minimapZoomReset" title="Center on You">⊕</button>
          <button className="minimap-zoom-btn" id="minimapZoomIn" title="Zoom In">+</button>
        </div>
      </div>

      {/* Hex Info Panel */}
      <div id="hexInfoPanel" className="side-panel hidden">
        <div className="panel-header">
          <span id="hexInfoTitle">Tile Info</span>
          <button className="panel-close" id="hexInfoClose">✕</button>
        </div>
        <div className="panel-body" id="hexInfoBody"></div>
      </div>

      {/* Kingdom Info Panel */}
      <div id="kingdomPanel" className="side-panel hidden">
        <div className="panel-header">
          <span id="kingdomTitle">Kingdom</span>
          <button className="panel-close" id="kingdomClose">✕</button>
        </div>
        <div className="panel-body" id="kingdomBody"></div>
      </div>

      {/* Character Panel */}
      <div id="characterPanel" className="modal-panel hidden">
        <div className="modal-header">
          <span>Character Sheet</span>
          <button className="panel-close" id="characterClose">✕</button>
        </div>
        <div className="modal-body" id="characterBody"></div>
      </div>

      {/* Notification Area */}
      <div id="notificationArea"></div>

      {/* Bottom UI Stack — hotbar + HUD in a column so they don't overlap */}
      <div id="bottomUIStack">

      {/* Item Hotbar — above bottom HUD, visible only on inner map */}
      <div id="itemHotbar" className="hidden">
        {[1,2,3,4,5,6,7].map(n => (
          <div key={n} className="hotbar-slot" data-slot={n}>
            <span className="hotbar-key">{n}</span>
            <span className="hotbar-icon"></span>
            <span className="hotbar-qty"></span>
          </div>
        ))}
      </div>

      {/* ═══ Compact bottom turn bar ═══ */}
      <div id="simsBottomHUD" className="hud-frame hud-bottom-bar">
        {/* Date + mood */}
        <div className="hud-bb-datecol">
          <div className="hud-bb-dateline">
            <span className="hud-bb-sun"><Icon name="sun" /></span>
            <span className="hud-bb-date" id="hudBottomDate">Day 1 of Spring, Year 853</span>
          </div>
          <div className="hud-mood">
            <span className="hud-mood-icon" id="simsMoodIcon">😄</span>
            <span className="hud-mood-label" id="simsMoodLabel">ECSTATIC</span>
            <div className="hud-mood-meter"><div className="hud-mood-fill" id="moodMeterFill" style={{width:'100%'}}></div></div>
          </div>
          {/* Wounds and sickness — icons with tooltips, filled by ui/ui/hud.js _updateSimsHUD */}
          <div className="hud-conditions" id="hudConditions"></div>
          {/* Needs — filled by ui/ui/hud.js _updateSimsHUD; hidden while the needs system is off */}
          <div className="hud-needs" id="hudNeeds">
            {[
              ['hunger', 'bread', 'simsHungerBar'],
              ['energy', 'moon', 'simsEnergyBar'],
              ['social', 'speech', 'simsSocialBar'],
              ['fun', 'dice', 'simsFunBar'],
              ['hygiene', 'droplet', 'simsHygieneBar'],
              ['comfort', 'bed', 'simsComfortBar'],
            ].map(([need, icon, barId]) => (
              <div key={need} className="hud-need" title={need}>
                <span className="hud-need-icon"><Icon name={icon} /></span>
                <div className="hud-need-track"><div className="sims-need-bar-fill high" id={barId} style={{width:'100%'}}></div></div>
              </div>
            ))}
          </div>
        </div>

        <div className="hud-bb-divider"></div>

        {/* Resources */}
        <div className="hud-bb-resources">
          <div className="hud-bb-res" title="Gold">
            <span className="hud-bb-res-icon"><Icon name="coins" /></span>
            <span className="hud-bb-res-val" id="simsGold">0</span>
            <span className="hud-bb-res-sub" id="incomePerDay">+0/d</span>
          </div>
          <div className="hud-bb-res" title="Renown">
            <span className="hud-bb-res-icon"><Icon name="star" /></span>
            <span className="hud-bb-res-val" id="simsRenown">0</span>
          </div>
          <div className="hud-bb-res" title="Military Strength">
            <span className="hud-bb-res-icon"><Icon name="shield" /></span>
            <span className="hud-bb-res-val" id="bbShields">0</span>
          </div>
        </div>

        <div className="hud-bb-divider"></div>

        {/* Playback + End Turn */}
        <div className="hud-bb-controls">
          <div className="hud-speed">
            <button className="hud-speed-btn" id="simsTimePause" title="Pause (Space)"><Icon name="pause" /></button>
            <button className="hud-speed-btn active" id="simsTimePlay" title="Normal Speed (1)"><Icon name="play" /></button>
            <button className="hud-speed-btn" id="simsTimeFast" title="Fast (2)"><Icon name="fast" /></button>
            <button className="hud-speed-btn" id="simsTimeUltra" title="Ultra (3)"><Icon name="ultra" /></button>
          </div>
          <button className="hud-end-turn" id="simsEndDay">
            <span className="hud-end-turn-icon"><Icon name="hourglass" /></span>
            <span>End Turn</span>
          </button>
        </div>

        {/* Activity Log — a strip along the bar's foot: the latest entries inline,
            the full log opens upward (filled by ui/ui/hud.js updateEventsPanel) */}
        <div className="hud-activity">
          <button className="hud-activity-toggle collapsed" id="activityLogToggle" title="Show the activity log">
            <span className="hud-activity-caret">▾</span>
            <span>Activity Log</span>
          </button>
          <div className="hud-activity-ticker" id="activityLogTicker"></div>
          <div className="hud-activity-body collapsed" id="activityLogBody"></div>
        </div>
      </div>

      {/* Hidden legacy elements kept so _updateSimsHUD bindings stay harmless no-ops */}
      <div style={{display:'none'}}>
        <span id="simsDay">Day 1</span>
        <span id="simsKarma">0</span>
        <div id="simsCollapsible"></div>
        <div id="simsRelBody"></div>
        <div id="simsInvBody"></div>
      </div>

      </div>{/* /bottomUIStack */}

      {/* Tooltip */}
      <div id="tooltip" className="hidden"></div>

      {/* Custom World Picker Modal */}
      <div id="customWorldModal" className="hidden">
        <div className="cw-modal-backdrop"></div>
        <div className="cw-modal-panel">
          <div className="cw-modal-header">
            <span>Choose a Custom World</span>
            <button className="cw-modal-close" id="cwModalClose">&times;</button>
          </div>
          <div className="cw-modal-body" id="cwModalBody">
            <p className="cw-modal-empty">Loading worlds…</p>
          </div>
          <div className="cw-modal-footer">
            <button className="title-btn" id="cwModalCancel">Cancel</button>
          </div>
        </div>
      </div>
    </>
  );
}
