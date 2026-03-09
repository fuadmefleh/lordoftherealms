import React, { useEffect, useRef } from 'react';
import { useGame } from '../context/GameContext';
import TopBar from './TopBar';
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

      {/* Minimap */}
      <div id="minimapContainer">
        <div id="minimapLabel">World Map</div>
        <canvas id="minimapCanvas"></canvas>
        <div id="minimapViewport"></div>
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

      {/* ═══ Sims 3 Bottom HUD ═══ */}
      <div id="simsBottomHUD">

        {/* ── Portrait wing (left bump) ── */}
        <div className="s3-portrait-wing">
          <div className="s3-plumbob" id="simsPlumbob">◆</div>
          <div className="s3-portrait-frame" id="simsPortrait" title="Character">
            <span className="s3-portrait-icon">🧑</span>
            <span className="s3-portrait-level" id="simsPortraitLevel">1</span>
          </div>
        </div>

        {/* ── Main bar ── */}
        <div className="s3-main-bar">

          {/* Collapsible wrapper */}
          <div className="s3-collapsible" id="simsCollapsible">

          {/* Row 1: Resources + Mood + Speed */}
          <div className="s3-top-row">
            <div className="s3-resources">
              <div className="s3-res"><span className="s3-res-icon">💰</span><span className="s3-res-val" id="simsGold">0</span></div>
              <div className="s3-res"><span className="s3-res-icon">⭐</span><span className="s3-res-val" id="simsRenown">0</span></div>
              <div className="s3-res"><span className="s3-res-icon">☯</span><span className="s3-res-val" id="simsKarma">0</span></div>
            </div>
            <div className="s3-mood" id="simsMoodPanel">
              <span className="s3-mood-icon" id="simsMoodIcon">😊</span>
              <span className="s3-mood-label" id="simsMoodLabel">Happy</span>
            </div>
            <div className="s3-time-controls">
              <span className="s3-day" id="simsDay">Day 1</span>
              <div className="s3-speed-row">
                <button className="s3-speed-btn" id="simsTimePause" title="Pause (Space)">⏸</button>
                <button className="s3-speed-btn active" id="simsTimePlay" title="Normal Speed (1)">▶</button>
                <button className="s3-speed-btn" id="simsTimeFast" title="Fast (2)">▶▶</button>
                <button className="s3-speed-btn" id="simsTimeUltra" title="Ultra (3)">▶▶▶</button>
              </div>
              <button className="s3-end-day" id="simsEndDay">☀ End Day</button>
            </div>
          </div>

          {/* Row 2: Content panels (tabs switch between these) */}
          <div className="s3-content">
            {/* PAGE: Stats / Needs */}
            <div className="sims-hub-page" id="simsPageStats">
              <div className="s3-needs-list">
                <div className="s3-need"><span className="s3-need-label">Hunger</span><div className="s3-need-track"><div className="sims-need-bar-fill high" id="simsHungerBar" style={{width:'100%'}}></div></div></div>
                <div className="s3-need"><span className="s3-need-label">Energy</span><div className="s3-need-track"><div className="sims-need-bar-fill high" id="simsEnergyBar" style={{width:'100%'}}></div></div></div>
                <div className="s3-need"><span className="s3-need-label">Social</span><div className="s3-need-track"><div className="sims-need-bar-fill high" id="simsSocialBar" style={{width:'100%'}}></div></div></div>
                <div className="s3-need"><span className="s3-need-label">Fun</span><div className="s3-need-track"><div className="sims-need-bar-fill high" id="simsFunBar" style={{width:'100%'}}></div></div></div>
                <div className="s3-need"><span className="s3-need-label">Hygiene</span><div className="s3-need-track"><div className="sims-need-bar-fill high" id="simsHygieneBar" style={{width:'100%'}}></div></div></div>
                <div className="s3-need"><span className="s3-need-label">Comfort</span><div className="s3-need-track"><div className="sims-need-bar-fill high" id="simsComfortBar" style={{width:'100%'}}></div></div></div>
              </div>
            </div>
            {/* PAGE: Relationships */}
            <div className="sims-hub-page sims-hub-page-col hidden" id="simsPageRelationships">
              <div className="srel-filters" id="simsRelFilters">
                <button className="srel-filter-btn active" data-filter="all">All</button>
                <button className="srel-filter-btn" data-filter="family">👨‍👩‍👦 Family</button>
                <button className="srel-filter-btn" data-filter="friends">😊 Friends</button>
                <button className="srel-filter-btn" data-filter="romantic">💕 Romantic</button>
                <button className="srel-filter-btn" data-filter="rivals">⚡ Rivals</button>
                <button className="srel-filter-btn" data-filter="locals">🏘️ Locals</button>
              </div>
              <div className="sims-rel-body" id="simsRelBody"></div>
            </div>
            {/* PAGE: Inventory */}
            <div className="sims-hub-page hidden" id="simsPageInventory">
              <div className="sims-inv-body" id="simsInvBody">
                <p className="srel-empty">Your pack is empty.</p>
              </div>
            </div>
          </div>

          </div>{/* /s3-collapsible */}

          {/* Tab strip at the very bottom of the bar */}
          <div className="s3-tabs">
            <button className="s3-tab active" id="simsTabStats">Simology</button>
            <button className="s3-tab" id="simsTabRelationships">Relationships</button>
            <button className="s3-tab" id="simsTabInventory">Inventory</button>
          </div>

        </div>{/* /s3-main-bar */}
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
