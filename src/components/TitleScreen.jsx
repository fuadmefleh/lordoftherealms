import React, { useState, useCallback, useEffect } from 'react';
import { useGame } from '../context/GameContext';
import { ModStore } from '../systems/modStore';
import Icon from './Icon';
import AiSettingsDialog from './AiSettingsDialog';
import { SaveLoad } from '../systems/saveLoad.js';

// The saves on this machine: the ordinary slot and an Ironman run's (systems/saveLoad.js;
// kept in IndexedDB, core/saveStore.js, so the list arrives asynchronously)
const _listSaves = () => SaveLoad.listSaves().catch(() => []);
const _saveSize = (b) => {
  if (!b) return '';
  return b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
};
const _saveWhen = (t) => {
  try { return t ? new Date(t).toLocaleString() : ''; } catch (err) { return ''; }
};

export default function TitleScreen() {
  const { setPhase, setGameState } = useGame();
  const [showWorldPicker, setShowWorldPicker] = useState(false);
  const [worlds, setWorlds] = useState([]);
  const [loadingWorlds, setLoadingWorlds] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [saves, setSaves] = useState([]);
  const [showSaves, setShowSaves] = useState(false);
  useEffect(() => {
    let live = true;
    _listSaves().then((list) => { if (live) setSaves(list || []); });
    return () => { live = false; };
  }, []);

  const handleDeleteSave = useCallback(async (key, e) => {
    e.stopPropagation();
    if (!confirm('Delete this saved game? It cannot be undone.')) return;
    await SaveLoad.deleteSave(key);
    const list = await _listSaves();
    setSaves(list || []);
    if (!list || !list.length) setShowSaves(false);
  }, []);

  const handleResume = useCallback((key) => {
    setShowSaves(false);
    setGameState(prev => ({ ...prev, phase: 'loading', settings: { _resumeKey: key } }));
  }, [setGameState]);

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
            disabled={saves.length === 0}
            onClick={() => (saves.length === 1 ? handleResume(saves[0].key) : setShowSaves(true))}
            title={saves.length === 1 && saves[0].ironman ? 'Continue your Ironman run' : undefined}
          >
            {saves.length === 1 && saves[0].ironman ? '⚒️ Continue (Ironman)' : 'Continue'}
          </button>
        </div>
        <div id="titleButtonsSecondary">
          <button
            className="title-btn secondary"
            id="btnModTools"
            onClick={() => setPhase('editor')}
          >
            <Icon name="gear" /> Modding Tools
          </button>
          <button
            className="title-btn secondary"
            id="btnWorldEditor"
            onClick={() => setPhase('worldEditor')}
          >
            <Icon name="compass" /> World Editor
          </button>
          <button
            className="title-btn secondary"
            id="btnPlayCustom"
            onClick={handlePlayCustom}
          >
            <Icon name="castle" /> Play Custom World
          </button>
          <button
            className="title-btn secondary"
            id="btnHallOfHouses"
            onClick={() => setPhase('hall')}
          >
            <Icon name="crown" /> Hall of Houses
          </button>
          <button
            className="title-btn secondary"
            id="btnAiSettings"
            onClick={() => setShowAiSettings(true)}
          >
            <Icon name="gear" /> AI Settings
          </button>
        </div>
        <div id="titleVersion">v0.3.0 — React + Vite</div>
      </div>

      {showAiSettings && <AiSettingsDialog onClose={() => setShowAiSettings(false)} />}

      {/* The save list: an Ironman run is marked (it continues; it is never loaded back) */}
      {showSaves && (
        <div id="customWorldModal">
          <div className="cw-modal-backdrop" onClick={() => setShowSaves(false)} />
          <div className="cw-modal-panel">
            <div className="cw-modal-header">
              <span>Continue</span>
              <button className="cw-modal-close" onClick={() => setShowSaves(false)}>&times;</button>
            </div>
            <div className="cw-modal-body">
              {saves.map(sv => (
                <div key={sv.key} className="cw-world-item" onClick={() => handleResume(sv.key)}>
                  <div>
                    <div className="cw-world-name">
                      {sv.playerName || 'Unnamed'}{sv.houseName ? ` of ${sv.houseName}` : ''}
                      {sv.ironman && <span style={{ marginLeft: 8, fontSize: '11px', color: '#e0846a', border: '1px solid #e0846a', borderRadius: 4, padding: '0 5px' }}>⚒️ IRONMAN</span>}
                      {sv.tainted && <span style={{ marginLeft: 6, fontSize: '11px', color: '#b8a0d8', border: '1px solid #b8a0d8', borderRadius: 4, padding: '0 5px' }}>🧪 TAINTED</span>}
                    </div>
                    <div className="cw-world-meta">{`Year ${sv.year ?? '?'}, day ${sv.day ?? '?'} · saved ${_saveWhen(sv.timestamp)}${sv.bytes ? ` · ${_saveSize(sv.bytes)}` : ''}`}</div>
                  </div>
                  {!sv.ironman && (
                    <button className="cw-world-delete" title="Delete this save" onClick={(e) => handleDeleteSave(sv.key, e)}>🗑</button>
                  )}
                  <span className="cw-world-play">PLAY ▶</span>
                </div>
              ))}
            </div>
            <div className="cw-modal-footer">
              <button className="title-btn" onClick={() => setShowSaves(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

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
