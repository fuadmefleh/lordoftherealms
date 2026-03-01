import React, { useState, useCallback } from 'react';
import { useGame } from '../context/GameContext';
import { ModStore } from '../systems/modStore';

export default function TitleScreen() {
  const { setPhase, setGameState } = useGame();
  const [showWorldPicker, setShowWorldPicker] = useState(false);
  const [worlds, setWorlds] = useState([]);
  const [loadingWorlds, setLoadingWorlds] = useState(false);

  const handlePlayCustom = useCallback(async () => {
    try {
      await ModStore.init();
      setLoadingWorlds(true);
      setShowWorldPicker(true);
      const list = await ModStore.listWorlds();
      setWorlds(list || []);
    } catch (err) {
      console.error('Failed to list worlds:', err);
      alert('Failed to load saved worlds: ' + err.message);
    } finally {
      setLoadingWorlds(false);
    }
  }, []);

  const handleSelectWorld = useCallback(async (worldId) => {
    try {
      const worldData = await ModStore.loadWorld(worldId);
      if (!worldData) { alert('Failed to load world data.'); return; }
      setShowWorldPicker(false);
      setGameState(prev => ({
        ...prev,
        phase: 'loading',
        settings: { _customWorldData: worldData },
      }));
    } catch (err) {
      console.error('Failed to load world:', err);
      alert('Error loading world: ' + err.message);
    }
  }, [setGameState]);

  const handleDeleteWorld = useCallback(async (worldId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this world?')) return;
    try {
      await ModStore.deleteWorld(worldId);
      setWorlds(prev => prev.filter(w => w.id !== worldId));
    } catch (err) {
      console.error('Failed to delete world:', err);
    }
  }, []);

  return (
    <div id="titleScreen">
      <div id="titleContent">
        <h1 id="titleText">Lord of the Realms</h1>
        <p id="titleSubtext">Rise from Nothing. Forge Your Legacy.</p>
        <div id="titleButtons">
          <button
            className="title-btn primary"
            id="btnNewGame"
            onClick={() => setPhase('settings')}
          >
            New Game
          </button>
          <button
            className="title-btn"
            id="btnContinue"
            disabled
          >
            Continue
          </button>
        </div>
        <div id="titleButtonsSecondary">
          <button
            className="title-btn secondary"
            id="btnModTools"
            onClick={() => setPhase('editor')}
          >
            🛠 Modding Tools
          </button>
          <button
            className="title-btn secondary"
            id="btnWorldEditor"
            onClick={() => setPhase('worldEditor')}
          >
            🗺 World Editor
          </button>
          <button
            className="title-btn secondary"
            id="btnPlayCustom"
            onClick={handlePlayCustom}
          >
            🎮 Play Custom World
          </button>
        </div>
        <div id="titleVersion">v0.3.0 — React + Vite</div>
      </div>
      <canvas id="titleBgCanvas"></canvas>

      {/* Custom World Picker Modal */}
      {showWorldPicker && (
        <div id="customWorldModal">
          <div className="cw-modal-backdrop" onClick={() => setShowWorldPicker(false)} />
          <div className="cw-modal-panel">
            <div className="cw-modal-header">
              <span>Choose a Custom World</span>
              <button className="cw-modal-close" onClick={() => setShowWorldPicker(false)}>&times;</button>
            </div>
            <div className="cw-modal-body">
              {loadingWorlds && <p className="cw-modal-empty">Loading worlds…</p>}
              {!loadingWorlds && worlds.length === 0 && (
                <p className="cw-modal-empty">No saved worlds found.<br/>Open the World Editor, design a map, and save it first!</p>
              )}
              {!loadingWorlds && worlds.map(w => (
                <div key={w.id} className="cw-world-item" onClick={() => handleSelectWorld(w.id)}>
                  <div>
                    <div className="cw-world-name">{w.name || w.id}</div>
                    <div className="cw-world-meta">{w.width} × {w.height} tiles</div>
                  </div>
                  <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                    <span className="cw-world-play">PLAY ▶</span>
                    <button
                      className="title-btn"
                      style={{fontSize:'11px',padding:'2px 8px',color:'#f85149'}}
                      onClick={(e) => handleDeleteWorld(w.id, e)}
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="cw-modal-footer">
              <button className="title-btn" onClick={() => setShowWorldPicker(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
