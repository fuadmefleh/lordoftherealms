import React, { createContext, useContext, useState, useRef, useCallback } from 'react';

const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [gameState, setGameState] = useState({
    phase: 'title', // 'title' | 'settings' | 'loading' | 'playing' | 'editor' | 'worldEditor'
    initialized: false,
    turn: { day: 1, season: 'Spring', year: 1 },
    playerStats: {
      gold: 100, karma: 0, renown: 0,
      movement: '10/10', actions: '10/10',
      food: 20, hp: '100/100',
    },
  });
  const gameRef = useRef(null); // Holds the Game instance

  const setPhase = useCallback((phase) => {
    setGameState((prev) => ({ ...prev, phase }));
  }, []);

  const updatePlayerStats = useCallback((stats) => {
    setGameState((prev) => ({
      ...prev,
      playerStats: { ...prev.playerStats, ...stats },
    }));
  }, []);

  const updateTurn = useCallback((turn) => {
    setGameState((prev) => ({ ...prev, turn: { ...prev.turn, ...turn } }));
  }, []);

  const value = {
    gameState,
    setGameState,
    setPhase,
    updatePlayerStats,
    updateTurn,
    gameRef,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used within a GameProvider');
  return context;
}

export default GameContext;
