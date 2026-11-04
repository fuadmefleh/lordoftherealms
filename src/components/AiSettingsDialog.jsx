import React, { useState } from 'react';
import { UI } from '../ui/ui';
import { NpcBrain } from '../systems/npcBrain';

// The AI Brain settings, reachable from the title screen before any game is
// made: the same saved settings the in-game Settings panel edits
// (ui/ui/propertiesSettings.js, localStorage), applied when a game starts.

const DEFAULTS = {
  local: { endpoint: 'http://127.0.0.1:8080', model: 'local' },
  openai: { endpoint: 'https://api.openai.com', model: 'gpt-6-luna' },
};

const row = { display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0' };
const label = { width: '110px', flexShrink: 0, fontSize: '13px', color: 'var(--text-secondary, #aaa)' };
const btn = { fontSize: '12px', padding: '6px 14px', letterSpacing: '0.04em' };
const input = { flex: 1, minWidth: 0, padding: '5px 7px', background: 'rgba(0,0,0,0.35)', color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px' };

export default function AiSettingsDialog({ onClose }) {
  const saved = UI.loadSettings();
  const [enabled, setEnabled] = useState(!!saved.llmEnabled);
  const [provider, setProvider] = useState(saved.llmProvider || 'local');
  const [apiKey, setApiKey] = useState(saved.llmApiKey || '');
  const [endpoint, setEndpoint] = useState(saved.llmEndpoint || DEFAULTS[saved.llmProvider || 'local'].endpoint);
  const [model, setModel] = useState(saved.llmModel || DEFAULTS[saved.llmProvider || 'local'].model);
  const [temperature, setTemperature] = useState(saved.llmTemperature != null ? saved.llmTemperature : 0.7);
  const [result, setResult] = useState(null);
  const [testing, setTesting] = useState(false);

  // Switching provider swaps the address and model while they are still the other's defaults
  const changeProvider = (pv) => {
    const other = DEFAULTS[pv === 'openai' ? 'local' : 'openai'];
    if (!endpoint || endpoint === other.endpoint) setEndpoint(DEFAULTS[pv].endpoint);
    if (!model || model === other.model) setModel(DEFAULTS[pv].model);
    setProvider(pv);
    setResult(null);
  };

  const current = () => ({
    provider,
    apiKey: provider === 'openai' ? apiKey.trim() : '',
    endpoint: endpoint || DEFAULTS[provider].endpoint,
    model: model || DEFAULTS[provider].model,
    temperature: Number(temperature) || 0.7,
  });

  const test = async () => {
    setTesting(true);
    setResult({ ok: null, text: `Testing ${current().endpoint} …` });
    try {
      const r = await NpcBrain.testConnection(current());
      if (r.ok) setResult({ ok: true, text: `Connected: the model replied "${r.detail}"` });
      else {
        const head = r.stage !== 'health' ? 'Query failed' : r.state === 'loading' ? 'Still loading' : 'Unreachable';
        setResult({ ok: false, text: `${head}: ${r.detail}${r.hint ? ` (${r.hint})` : ''}` });
      }
    } catch (e) {
      setResult({ ok: false, text: `Error: ${(e && e.message) || 'unknown'}` });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    const c = current();
    UI.saveSettings({
      ...UI.loadSettings(),
      llmEnabled: enabled,
      llmProvider: c.provider,
      llmApiKey: c.apiKey,
      llmEndpoint: c.endpoint,
      llmModel: c.model,
      llmTemperature: c.temperature,
    });
    NpcBrain.applyFromSettings(UI.loadSettings());
    onClose();
  };

  return (
    <div id="customWorldModal">
      <div className="cw-modal-backdrop" onClick={onClose} />
      <div className="cw-modal-panel" style={{ maxWidth: '520px' }}>
        <div className="cw-modal-header">
          <span>AI Brain Settings</span>
          <button className="cw-modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="cw-modal-body" style={{ padding: '12px 16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary, #aaa)', margin: '0 0 8px' }}>
            Let a language model voice the people you talk to: a local llama-server, or OpenAI with your own API key.
            The game falls back to its written lines when it is off or can't be reached.
          </p>
          <div style={row}>
            <span style={label}>Enable AI NPCs</span>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          </div>
          <div style={row}>
            <span style={label}>Provider</span>
            <select style={input} value={provider} onChange={(e) => changeProvider(e.target.value)}>
              <option value="local">Local (llama.cpp)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          {provider === 'openai' && (
            <div style={row}>
              <span style={label}>API Key</span>
              <input style={input} type="password" autoComplete="off" placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
          )}
          <div style={row}>
            <span style={label}>Endpoint</span>
            <input style={input} type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          </div>
          <div style={row}>
            <span style={label}>Model</span>
            <input style={input} type="text" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div style={row}>
            <span style={label}>Temperature</span>
            <input type="range" min="0" max="1.5" step="0.05" value={temperature} onChange={(e) => setTemperature(e.target.value)} style={{ flex: 1 }} />
            <span style={{ width: '34px', fontSize: '12px' }}>{temperature}</span>
          </div>
          {!enabled && (provider === 'local' || apiKey.trim()) && (
            <div style={{ fontSize: '12px', color: '#e0b050', margin: '4px 0' }}>
              AI NPCs are off: tick Enable AI NPCs and Save, or the people you meet keep to their written lines.
            </div>
          )}
          {result && (
            <div style={{ fontSize: '12px', marginTop: '6px', wordBreak: 'break-word', color: result.ok === true ? '#7fd07f' : result.ok === false ? '#e08080' : 'var(--text-secondary, #aaa)' }}>
              {result.text}
            </div>
          )}
          {provider === 'openai' && (
            <p style={{ fontSize: '11px', color: 'var(--text-secondary, #888)', margin: '8px 0 0' }}>
              Your key stays in this browser's storage and goes only to the endpoint above. Each line spoken is a small paid request on your account.
            </p>
          )}
        </div>
        <div className="cw-modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="title-btn" style={btn} onClick={test} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</button>
          <button className="title-btn" style={btn} onClick={onClose}>Cancel</button>
          <button className="title-btn primary" style={btn} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
