import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useGame } from '../context/GameContext';
import { ModStore } from '../systems/modStore';

// The world editor's current map is saved under this id, so Save updates it
// in place instead of adding a copy each time
const CURRENT_WORLD_KEY = 'lotr-world-editor-current-id';

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

function readCurrentWorldId() {
  try { return localStorage.getItem(CURRENT_WORLD_KEY) || null; } catch { return null; }
}
function writeCurrentWorldId(id) {
  try {
    if (id) localStorage.setItem(CURRENT_WORLD_KEY, id);
    else localStorage.removeItem(CURRENT_WORLD_KEY);
  } catch { /* storage off */ }
}

function newWorldId(name) {
  return (name || 'world').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function EditorOverlay({ type }) {
  const { setPhase, setGameState } = useGame();
  const frameRef = useRef(null);
  const importRef = useRef(null);
  const [saveLabel, setSaveLabel] = useState(null);
  const [currentWorldId, setCurrentWorldId] = useState(readCurrentWorldId);

  // In-app world-load picker state (replaces native alert/prompt).
  const [picker, setPicker] = useState(null); // null = closed; { loading, worlds, error, confirmDelete }
  // A small in-app dialog: { title, message, input?, okText, danger?, onOk(value) }
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState('');

  const isWorld = type === 'worldEditor';
  const title = isWorld ? '🗺 World Editor' : '🛠 Modding Tools';
  const src = isWorld ? '/world_editor.html' : '/editor.html';

  // One timer at a time: a second flash restarts it instead of being cut short
  // by the first one, and leaving the editor cancels it
  const flashTimerRef = useRef(null);
  const flashSave = useCallback((text, ms = 1800) => {
    setSaveLabel(text);
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSaveLabel(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  const frameWin = () => frameRef.current && frameRef.current.contentWindow;

  const openDialog = useCallback((d) => {
    setDialogValue(d.value || '');
    setDialog(d);
  }, []);

  // Write the mod editor's latest edits to the browser now (it autosaves a
  // second after each change, which leaving at once could cut short)
  const flushModEditor = useCallback(async () => {
    const win = frameWin();
    if (!isWorld && win && typeof win.autoSaveToBrowser === 'function') {
      try { await win.autoSaveToBrowser(); } catch (err) { console.warn('Mod autosave failed:', err); }
    }
  }, [isWorld]);

  const saveWorld = useCallback(async ({ asNew = false, name = null } = {}) => {
    try {
      const win = frameWin();
      if (!win || typeof win.getExportData !== 'function') { flashSave('⚠ Not ready'); return; }
      const data = win.getExportData();
      if (!data) { flashSave('⚠ No data'); return; }
      if (name) data.name = name;
      await ModStore.init();
      let id = asNew ? null : currentWorldId;
      // Update the open save only while it is still the same map: deleted
      // since, or renamed (another map imported, say) makes a new save
      const existing = id ? await ModStore.loadWorld(id) : null;
      if (!existing || (existing.name || '') !== (data.name || '')) id = null;
      id = id || newWorldId(data.name);
      await ModStore.saveWorld(id, data);
      setCurrentWorldId(id);
      writeCurrentWorldId(id);
      flashSave(`✓ Saved “${data.name || 'world'}”`);
    } catch (err) {
      console.error('Save failed:', err);
      flashSave('✕ Error');
    }
  }, [currentWorldId, flashSave]);

  const handleSave = useCallback(async () => {
    if (isWorld) { await saveWorld(); return; }
    try {
      const win = frameWin();
      if (win && typeof win.autoSaveToBrowser === 'function') {
        await win.autoSaveToBrowser();
      } else {
        const getData = win && win.getExportData;
        if (typeof getData !== 'function') { flashSave('⚠ Not ready'); return; }
        const data = getData();
        if (!data) { flashSave('⚠ No data'); return; }
        await ModStore.init();
        await ModStore.saveModData(data);
      }
      flashSave('✓ Saved');
    } catch (err) {
      console.error('Save failed:', err);
      flashSave('✕ Error');
    }
  }, [isWorld, saveWorld, flashSave]);

  const handleSaveAs = useCallback(() => {
    const win = frameWin();
    const cur = win && typeof win.getExportData === 'function' ? win.getExportData() : null;
    openDialog({
      title: 'Save As New World',
      message: 'Save this map as a separate world. The one you saved before stays as it was.',
      input: true,
      value: cur && cur.name ? `${cur.name} (copy)` : 'New World',
      okText: 'Save',
      onOk: async (name) => {
        const n = name.trim() || 'Untitled';
        if (win) win.postMessage({ type: 'setWorldName', name: n }, '*');
        await saveWorld({ asNew: true, name: n });
      },
    });
  }, [openDialog, saveWorld]);

  // Ctrl+S inside the world editor asks us to save
  useEffect(() => {
    const onMsg = (ev) => {
      if (ev.data && ev.data.type === 'requestSave' && frameRef.current && ev.source === frameRef.current.contentWindow) handleSave();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [handleSave]);

  // Play the map as it stands; the editor remembers it for when you come back
  const handlePlaytest = useCallback(() => {
    const win = frameWin();
    if (!win || typeof win.getExportData !== 'function') { flashSave('⚠ Not ready'); return; }
    const data = typeof win.prepareForPlaytest === 'function' ? win.prepareForPlaytest() : win.getExportData();
    if (!data) { flashSave('⚠ No data'); return; }
    setGameState(prev => ({ ...prev, phase: 'loading', settings: { _customWorldData: data } }));
  }, [setGameState, flashSave]);

  const handleBack = useCallback(async () => {
    await flushModEditor();
    setPhase('title');
  }, [flushModEditor, setPhase]);

  // ── Mod packs: everything made in the editors, worlds included ──
  const handleExportPack = useCallback(async () => {
    try {
      await flushModEditor();
      await ModStore.init();
      const pack = await ModStore.exportAll();
      if (!pack.moddata && !Object.keys(pack.worlds || {}).length) { flashSave('⚠ Nothing to export yet'); return; }
      pack.format = 'lotr-mod-pack';
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(`lotr-mod-pack-${stamp}.json`, pack);
      flashSave('✓ Mod pack exported');
    } catch (err) {
      console.error('Export failed:', err);
      flashSave('✕ Export failed');
    }
  }, [flushModEditor, flashSave]);

  const handleImportFile = useCallback((ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let pack;
      try { pack = JSON.parse(reader.result); } catch { flashSave('✕ Not a JSON file'); return; }
      if (!pack || typeof pack !== 'object' || (!pack.moddata && !pack.worlds)) {
        openDialog({ title: 'Not a Mod Pack', message: 'That file is not a mod pack. To load a gamedata.json or a Game Data changes file, use ⬆ Import inside the editor.', okText: 'OK', noCancel: true, onOk: () => {} });
        return;
      }
      const worldCount = Object.keys(pack.worlds || {}).length;
      const parts = [];
      if (pack.moddata) parts.push('its editor content (this replaces your current sprites, interiors, techs and Game Data changes)');
      if (worldCount) parts.push(`${worldCount} world${worldCount === 1 ? '' : 's'} (added to your list; same-named saves are replaced)`);
      openDialog({
        title: 'Import Mod Pack',
        message: `Install ${file.name}: ${parts.join(' and ')}?`,
        okText: 'Install',
        danger: !!pack.moddata,
        onOk: async () => {
          try {
            await ModStore.init();
            await ModStore.importAll(pack);
            const win = frameWin();
            if (win) win.location.reload();
            flashSave('✓ Mod pack installed', 2600);
          } catch (err) {
            console.error('Import failed:', err);
            flashSave('✕ Import failed');
          }
        },
      });
    };
    reader.readAsText(file);
  }, [openDialog, flashSave]);

  const handleResetMods = useCallback(() => {
    openDialog({
      title: 'Remove All Mod Content',
      message: 'Go back to the base game? Sprites, interiors, techs and Game Data changes made here are deleted from this browser. Saved worlds are kept. Export a mod pack first if you may want them back.',
      okText: 'Remove',
      danger: true,
      onOk: async () => {
        try {
          await ModStore.init();
          await ModStore.clearModData();
          const win = frameWin();
          if (win) win.location.reload();
          flashSave('✓ Back to the base game', 2600);
        } catch (err) {
          console.error('Reset failed:', err);
          flashSave('✕ Error');
        }
      },
    });
  }, [openDialog, flashSave]);

  // ── World picker ──
  const openPicker = useCallback(async () => {
    setPicker({ loading: true, worlds: [], error: null, confirmDelete: null });
    try {
      await ModStore.init();
      const worlds = await ModStore.listWorlds();
      // Newest first.
      worlds.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      setPicker({ loading: false, worlds, error: null, confirmDelete: null });
    } catch (err) {
      console.error('Load failed:', err);
      setPicker({ loading: false, worlds: [], error: err.message || 'Failed to load worlds', confirmDelete: null });
    }
  }, []);

  const closePicker = useCallback(() => setPicker(null), []);

  const pickWorld = useCallback(async (w) => {
    try {
      const worldData = await ModStore.loadWorld(w.id);
      if (worldData) {
        const win = frameWin();
        if (win) win.postMessage({ type: 'loadWorld', world: worldData }, '*');
        setCurrentWorldId(w.id);
        writeCurrentWorldId(w.id);
      }
      setPicker(null);
    } catch (err) {
      console.error('Load failed:', err);
      setPicker((p) => (p ? { ...p, error: err.message || 'Failed to load world' } : p));
    }
  }, []);

  const deleteWorld = useCallback(async (w, e) => {
    e.stopPropagation();
    if (!picker || picker.confirmDelete !== w.id) {
      setPicker((p) => (p ? { ...p, confirmDelete: w.id } : p));
      return;
    }
    try {
      await ModStore.deleteWorld(w.id);
      if (w.id === currentWorldId) { setCurrentWorldId(null); writeCurrentWorldId(null); }
      setPicker((p) => (p ? { ...p, confirmDelete: null, worlds: p.worlds.filter(x => x.id !== w.id) } : p));
    } catch (err) {
      console.error('Delete failed:', err);
      setPicker((p) => (p ? { ...p, error: err.message || 'Failed to delete world' } : p));
    }
  }, [picker, currentWorldId]);

  const closeDialog = useCallback(() => setDialog(null), []);
  const confirmDialog = useCallback(async () => {
    const d = dialog;
    setDialog(null);
    if (d && d.onOk) await d.onOk(dialogValue);
  }, [dialog, dialogValue]);

  return (
    <div id={isWorld ? 'worldEditorOverlay' : 'editorOverlay'}>
      <div id={isWorld ? 'worldEditorTopBar' : 'editorTopBar'}>
        <span className="editor-bar-title">{title}</span>
        <span className="editor-bar-spacer"></span>
        {saveLabel && <span className="editor-bar-status">{saveLabel}</span>}
        {isWorld && (
          <>
            <button className="editor-bar-btn" title="Save this world to your list (Ctrl+S). Saving again updates it." onClick={handleSave}>
              💾 Save World
            </button>
            <button className="editor-bar-btn" title="Save as a separate world, keeping the earlier save" onClick={handleSaveAs}>Save As…</button>
            <button className="editor-bar-btn" title="Open or delete a saved world" onClick={openPicker}>📂 Worlds</button>
            <button className="editor-bar-btn" title="Start a game on this map now" onClick={handlePlaytest}>▶ Playtest</button>
          </>
        )}
        {!isWorld && (
          <>
            <button className="editor-bar-btn" title="Save mod content to this browser now (it also saves itself as you work)" onClick={handleSave}>
              💾 Save
            </button>
            <button className="editor-bar-btn" title="Download everything you made, worlds included, as one file to share" onClick={handleExportPack}>📦 Export Mod Pack</button>
            <button className="editor-bar-btn" title="Install a mod pack file" onClick={() => importRef.current && importRef.current.click()}>📥 Import Mod Pack</button>
            <input ref={importRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImportFile} />
            <button className="editor-bar-btn" title="Delete all mod content and play the base game" onClick={handleResetMods}>⟲ Base Game</button>
          </>
        )}
        <button
          className="editor-bar-btn danger"
          onClick={handleBack}
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
        <div className="cw-modal" id="editorWorldPicker" role="dialog" aria-modal="true" aria-label="Saved worlds">
          <div className="cw-modal-backdrop" onClick={closePicker}></div>
          <div className="cw-modal-panel">
            <div className="cw-modal-header">
              <span>Saved Worlds</span>
              <button className="cw-modal-close" onClick={closePicker} aria-label="Close">×</button>
            </div>
            <div className="cw-modal-body">
              {picker.loading && <p className="cw-modal-empty">Loading worlds…</p>}
              {!picker.loading && picker.error && (
                <p className="cw-modal-empty">Error: {picker.error}</p>
              )}
              {!picker.loading && !picker.error && picker.worlds.length === 0 && (
                <p className="cw-modal-empty">
                  No saved worlds yet.<br />Design a map and press 💾 Save World.
                </p>
              )}
              {!picker.loading && !picker.error && picker.worlds.map((w) => (
                <div key={w.id} className={'cw-world-item' + (w.id === currentWorldId ? ' current' : '')} onClick={() => pickWorld(w)}>
                  <div>
                    <div className="cw-world-name">
                      {w.name}
                      {w.id === currentWorldId && <span className="cw-world-tag">open</span>}
                    </div>
                    <div className="cw-world-meta">
                      {w.width} × {w.height} tiles
                      {w.savedAt ? ` · ${formatSavedAt(w.savedAt)}` : ''}
                    </div>
                  </div>
                  <span className="cw-world-actions">
                    <button
                      className={'editor-bar-btn danger cw-world-delete' + (picker.confirmDelete === w.id ? ' armed' : '')}
                      title="Delete this world"
                      onClick={(e) => deleteWorld(w, e)}
                      onMouseLeave={() => picker.confirmDelete === w.id && setPicker((p) => (p ? { ...p, confirmDelete: null } : p))}
                    >
                      {picker.confirmDelete === w.id ? 'Delete?' : '🗑'}
                    </button>
                    <span className="cw-world-play">LOAD ▶</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="cw-modal-footer">
              <button className="editor-bar-btn" onClick={closePicker}>Close</button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <div className="cw-modal" role="dialog" aria-modal="true" aria-label={dialog.title}>
          <div className="cw-modal-backdrop" onClick={closeDialog}></div>
          <div className="cw-modal-panel">
            <div className="cw-modal-header">
              <span>{dialog.title}</span>
              <button className="cw-modal-close" onClick={closeDialog} aria-label="Close">×</button>
            </div>
            <div className="cw-modal-body">
              <p className="editor-dialog-text">{dialog.message}</p>
              {dialog.input && (
                <input
                  className="editor-dialog-input"
                  autoFocus
                  value={dialogValue}
                  onChange={(e) => setDialogValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmDialog(); if (e.key === 'Escape') closeDialog(); }}
                />
              )}
            </div>
            <div className="cw-modal-footer">
              {!dialog.noCancel && <button className="editor-bar-btn" onClick={closeDialog}>Cancel</button>}
              <button className={'editor-bar-btn' + (dialog.danger ? ' danger' : '')} autoFocus={!dialog.input} onClick={confirmDialog}>{dialog.okText || 'OK'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
