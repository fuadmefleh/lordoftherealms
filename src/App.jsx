import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameProvider, useGame } from './context/GameContext';
import TitleScreen from './components/TitleScreen';
import SettingsScreen from './components/SettingsScreen';
import LoadingOverlay from './components/LoadingOverlay';
import GameView from './components/GameView';
import EditorOverlay from './components/EditorOverlay';
import './App.css';

function AppInner() {
  const { gameState, setPhase, gameRef } = useGame();

  return (
    <div id="app-root">
      {/* Game View renders the canvas + HUD — always mounted so Game class can attach */}
      {(gameState.phase === 'playing' || gameState.phase === 'loading') && (
        <GameView />
      )}

      {/* Overlays based on phase */}
      {gameState.phase === 'title' && <TitleScreen />}
      {gameState.phase === 'settings' && <SettingsScreen />}
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
