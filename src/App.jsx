import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameProvider, useGame } from './context/GameContext';
import TitleScreen from './components/TitleScreen';
import SettingsScreen from './components/SettingsScreen';
import LoadingOverlay from './components/LoadingOverlay';
import GameView from './components/GameView';
import EditorOverlay from './components/EditorOverlay';
import TitleBackdrop from './components/TitleBackdrop';
import HallOfHouses from './components/HallOfHouses';
import './App.css';

function AppInner() {
  const { gameState, setPhase, gameRef } = useGame();

  return (
    <div id="app-root">
      {/* Game View renders the canvas + HUD — always mounted so Game class can attach */}
      {(gameState.phase === 'playing' || gameState.phase === 'loading') && (
        <GameView />
      )}

      {/* The living realm behind title, setup and loading (one mount, so it never cuts) */}
      {(gameState.phase === 'title' || gameState.phase === 'settings' || gameState.phase === 'loading' || gameState.phase === 'hall') && (
        <TitleBackdrop phase={gameState.phase === 'hall' ? 'settings' : gameState.phase} />
      )}

      {/* Overlays based on phase */}
      {gameState.phase === 'title' && <TitleScreen />}
      {gameState.phase === 'settings' && <SettingsScreen />}
      {/* The Hall of Houses: past runs, kept across games (systems/metaLegacy.js) */}
      {gameState.phase === 'hall' && <HallOfHouses />}
      {gameState.phase === 'loading' && <LoadingOverlay />}
      {gameState.phase === 'editor' && <EditorOverlay type="editor" />}
      {gameState.phase === 'worldEditor' && <EditorOverlay type="worldEditor" />}
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <AppInner />
    </GameProvider>
  );
}
