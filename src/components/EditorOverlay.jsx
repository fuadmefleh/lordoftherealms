import React, { useRef, useCallback, useState } from 'react';
import { useGame } from '../context/GameContext';
import { ModStore } from '../systems/modStore';

export default function EditorOverlay({ type }) {
  const { setPhase } = useGame();
  const frameRef = useRef(null);
  const [saveLabel, setSaveLabel] = useState(null);

  const isWorld = type === 'worldEditor';
  const title = isWorld ? '🗺 World Editor' : '🛠 Modding Tools';
  const src = isWorld ? '/world_editor.html' : '/editor.html';

  const flashSave = useCallback((text) => {
    setSaveLabel(text);
    setTimeout(() => setSaveLabel(null), 1500);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const frame = frameRef.current;
      if (!frame || !frame.contentWindow) return;
      const getData = frame.contentWindow.getExportData;
      if (typeof getData !== 'function') { flashSave('❌ Not ready'); return; }
      const data = getData();
      if (!data) { flashSave('❌ No data'); return; }
      await ModStore.init();
      if (isWorld) {
        const id = (data.name || 'world').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
        await ModStore.saveWorld(id, data);
      } else {
        await ModStore.saveModData(data);
      }
      flashSave('✅ Saved!');
    } catch (err) {
      console.error('Save failed:', err);
      flashSave('❌ Error');
    }
  }, [isWorld, flashSave]);

  const handleLoad = useCallback(async () => {
    try {
      await ModStore.init();
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
        const frame = frameRef.current;
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'loadWorld', world: worldData }, '*');
        }
      }
    } catch (err) {
      console.error('Load failed:', err);
    }
  }, []);

  return (
    <div id={isWorld ? 'worldEditorOverlay' : 'editorOverlay'}>
      <div id={isWorld ? 'worldEditorTopBar' : 'editorTopBar'}>
        <span className="editor-bar-title">{title}</span>
        <span className="editor-bar-spacer"></span>
        {isWorld && (
          <>
            <button className="editor-bar-btn" title="Save world to browser" onClick={handleSave}>
              {saveLabel || '💾 Save World'}
            </button>
            <button className="editor-bar-btn" title="Load a saved world" onClick={handleLoad}>📂 Load</button>
          </>
        )}
        {!isWorld && (
          <button className="editor-bar-btn" title="Save mod data to browser" onClick={handleSave}>
            {saveLabel || '💾 Save'}
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
        style={{ width: '100%', height: 'calc(100% - 40px)', border: 'none' }}
      ></iframe>
    </div>
  );
}
