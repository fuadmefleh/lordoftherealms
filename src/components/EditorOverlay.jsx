import React, { useRef, useCallback, useState } from 'react';
import { useGame } from '../context/GameContext';
import { ModStore } from '../systems/modStore';

function formatSavedAt(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function EditorOverlay({ type }) {
  const { setPhase } = useGame();
  const frameRef = useRef(null);
  const [saveLabel, setSaveLabel] = useState(null);

  // In-app world-load picker state (replaces native alert/prompt).
  const [picker, setPicker] = useState(null); // null = closed; { loading, worlds, error }

  const isWorld = type === 'worldEditor';
  const title = isWorld ? '🗺 World Editor' : '🛠 Modding Tools';
  const src = isWorld ? '/world_editor.html' : '/editor.html';

  const flashSave = useCallback((text) => {
    setSaveLabel(text);
    setTimeout(() => setSaveLabel(null), 1800);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const frame = frameRef.current;
      if (!frame || !frame.contentWindow) return;
      const getData = frame.contentWindow.getExportData;
      if (typeof getData !== 'function') { flashSave('⚠ Not ready'); return; }
      const data = getData();
      if (!data) { flashSave('⚠ No data'); return; }
      await ModStore.init();
      if (isWorld) {
        const id = (data.name || 'world').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
        await ModStore.saveWorld(id, data);
      } else {
        await ModStore.saveModData(data);
      }
      flashSave('✓ Saved');
    } catch (err) {
      console.error('Save failed:', err);
      flashSave('✕ Error');
    }
  }, [isWorld, flashSave]);

  const openPicker = useCallback(async () => {
    setPicker({ loading: true, worlds: [], error: null });
    try {
      await ModStore.init();
      const worlds = await ModStore.listWorlds();
      // Newest first.
      worlds.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      setPicker({ loading: false, worlds, error: null });
    } catch (err) {
      console.error('Load failed:', err);
      setPicker({ loading: false, worlds: [], error: err.message || 'Failed to load worlds' });
    }
  }, []);

  const closePicker = useCallback(() => setPicker(null), []);

  const pickWorld = useCallback(async (w) => {
    try {
      const worldData = await ModStore.loadWorld(w.id);
      if (worldData) {
        const frame = frameRef.current;
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'loadWorld', world: worldData }, '*');
        }
      }
      setPicker(null);
    } catch (err) {
      console.error('Load failed:', err);
      setPicker((p) => (p ? { ...p, error: err.message || 'Failed to load world' } : p));
    }
  }, []);

  return (
    <div id={isWorld ? 'worldEditorOverlay' : 'editorOverlay'}>
      <div id={isWorld ? 'worldEditorTopBar' : 'editorTopBar'}>
        <span className="editor-bar-title">{title}</span>
        <span className="editor-bar-spacer"></span>
        {saveLabel && <span className="editor-bar-status">{saveLabel}</span>}
        {isWorld && (
          <>
            <button className="editor-bar-btn" title="Save world to browser" onClick={handleSave}>
              💾 Save World
            </button>
            <button className="editor-bar-btn" title="Load a saved world" onClick={openPicker}>📂 Load</button>
          </>
        )}
        {!isWorld && (
          <button className="editor-bar-btn" title="Save mod data to browser" onClick={handleSave}>
            💾 Save
          </button>
        )}
        <button
          className="editor-bar-btn danger"
          onClick={() => setPhase('title')}
        >
          ✕ Back to Menu
        </button>
      </div>
      <iframe
        ref={frameRef}
        id={isWorld ? 'worldEditorFrame' : 'editorFrame'}
        src={src}
        style={{ width: '100%', height: 'calc(100% - 38px)', border: 'none' }}
      ></iframe>

      {picker && (
        <div className="cw-modal" id="editorWorldPicker" role="dialog" aria-modal="true" aria-label="Load a saved world">
          <div className="cw-modal-backdrop" onClick={closePicker}></div>
          <div className="cw-modal-panel">
            <div className="cw-modal-header">
              <span>Load World</span>
              <button className="cw-modal-close" onClick={closePicker} aria-label="Close">×</button>
            </div>
            <div className="cw-modal-body">
              {picker.loading && <p className="cw-modal-empty">Loading worlds…</p>}
              {!picker.loading && picker.error && (
                <p className="cw-modal-empty">Error: {picker.error}</p>
              )}
              {!picker.loading && !picker.error && picker.worlds.length === 0 && (
                <p className="cw-modal-empty">
                  No saved worlds found.<br />Design a map and save it first!
                </p>
              )}
              {!picker.loading && !picker.error && picker.worlds.map((w) => (
                <div key={w.id} className="cw-world-item" onClick={() => pickWorld(w)}>
                  <div>
                    <div className="cw-world-name">{w.name}</div>
                    <div className="cw-world-meta">
                      {w.width} × {w.height} tiles
                      {w.savedAt ? ` · ${formatSavedAt(w.savedAt)}` : ''}
                    </div>
                  </div>
                  <span className="cw-world-play">LOAD ▶</span>
                </div>
              ))}
            </div>
            <div className="cw-modal-footer">
              <button className="editor-bar-btn" onClick={closePicker}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
