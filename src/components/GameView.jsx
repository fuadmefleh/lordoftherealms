import React, { useEffect, useRef } from 'react';
import { useGame } from '../context/GameContext';
import TopBar from './TopBar';
import { Game } from '../ui/game';
import { DataLoader } from '../core/dataLoader';

export default function GameView() {
  const { gameState, gameRef, setPhase, updatePlayerStats, updateTurn } = useGame();
  const canvasRef = useRef(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    if (gameState.phase !== 'loading') return;
    if (!canvasRef.current) return;
    initRef.current = true;

    const settings = gameState.settings || {};
    const customWorldData = settings._customWorldData;

    // Initialize game asynchronously
    (async () => {
      try {
        // Initialize all game data first
        await DataLoader.initializeAll();

        // Create the Game instance in React mode, passing the canvas directly
        const game = new Game({ canvas: canvasRef.current, reactMode: true });
        gameRef.current = game;

        // Bridge: let the Game push stats back into React
        game._reactBridge = { updatePlayerStats, updateTurn, setPhase };

        if (customWorldData) {
          // Start with custom world from editor
          game.startCustomWorld(customWorldData);
        } else {
          // Start the game with settings
          await game.startNewGame(settings);
        }

        setPhase('playing');
      } catch (err) {
        console.error('[GameView] Failed to initialize game:', err);
        setPhase('title');
      }
    })();

    return () => {
      // Cleanup on unmount
      if (gameRef.current) {
        gameRef.current.isRunning = false;
        gameRef.current = null;
      }
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
