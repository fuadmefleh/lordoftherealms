import React, { useEffect, useState } from 'react';
import { UI } from '../ui/ui';
import { NpcBrain } from '../systems/npcBrain';
import { LlmClient } from '../systems/llmClient';

// The AI Brain settings, reachable from the title screen before any game is
// made: the same saved settings the in-game Settings panel edits
// (ui/ui/propertiesSettings.js, localStorage), applied when a game starts.

const DEFAULTS = {
  local: { endpoint: 'http://127.0.0.1:8080', model: 'local' },
  openai: { endpoint: 'https://api.openai.com', model: 'gpt-6-luna' },
};

const W = LlmClient.webllm;

/** The in-browser model's status line. */
function webllmLine(st, cached) {
  switch (st.state) {
    case 'unsupported': return { color: '#e08080', text: `Unsupported: ${st.detail || 'your browser has no WebGPU'}.` };
    case 'loading': return { color: 'var(--text-secondary, #aaa)', text: `Downloading / loading ${Math.round((st.progress || 0) * 100)}%${st.text ? ` — ${st.text}` : ''}` };
    case 'ready': return { color: '#7fd07f', text: `Ready: ${st.model} is loaded on your graphics card.` };
    case 'error': return { color: '#e08080', text: `Error: ${st.detail || 'the model failed to load'}` };
    default: return { color: 'var(--text-secondary, #aaa)', text: cached ? 'Downloaded — press Download / Load model to load it (or it loads by itself after a game starts).' : 'Not loaded. Nothing is downloaded until you press Download / Load model.' };
  }
}

const row = { display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0' };
const label = { width: '110px', flexShrink: 0, fontSize: '13px', color: 'var(--text-secondary, #aaa)' };
const btn = { fontSize: '12px', padding: '6px 14px', letterSpacing: '0.04em' };
const input = { flex: 1, minWidth: 0, padding: '5px 7px', background: 'rgba(0,0,0,0.35)', color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px' };

export default function AiSettingsDialog({ onClose }) {
  const saved = UI.loadSettings();
  const [enabled, setEnabled] = useState(!!saved.llmEnabled);
  const [provider, setProvider] = useState(saved.llmProvider || 'local');
  const [apiKey, setApiKey] = useState(saved.llmApiKey || '');
  const savedDefaults = DEFAULTS[saved.llmProvider] || DEFAULTS.local;
  const [endpoint, setEndpoint] = useState(saved.llmEndpoint || savedDefaults.endpoint);
  // (an in-browser pick lives in llmWebModel; the typed model is the server's)
  const [model, setModel] = useState((saved.llmProvider !== 'webllm' && saved.llmModel) || savedDefaults.model);
  const [temperature, setTemperature] = useState(saved.llmTemperature != null ? saved.llmTemperature : 0.7);
  const [result, setResult] = useState(null);
  const [testing, setTesting] = useState(false);
  // A free chat with the model, to hear how it talks before saving
  const [chat, setChat] = useState([]);
  const [chatText, setChatText] = useState('');
  const [chatting, setChatting] = useState(false);
  // The in-browser model (systems/llm/webllmProvider.js; list from data/llmModels.json)
  const [catalog, setCatalog] = useState(W.catalog());
  const [webModel, setWebModel] = useState(saved.llmWebModel || (saved.llmProvider === 'webllm' && saved.llmModel) || '');
  const [webStatus, setWebStatus] = useState(W.status());
  const [webCached, setWebCached] = useState(false);
  const [webNote, setWebNote] = useState('');
  const pickedWeb = webModel || catalog.defaultModel;

  useEffect(() => {
    let live = true;
    W.loadCatalog().then((c) => { if (live) setCatalog(c); });
    const off = W.onStatus((st) => { if (live) setWebStatus(st); });
    return () => { live = false; off(); };
  }, []);

  // Whether WebGPU is there, and whether the picked model is on disk already
  useEffect(() => {
    if (provider !== 'webllm') return undefined;
    let live = true;
    (async () => {
      const sup = await W.checkSupport();
      if (!live) return;
      if (!sup.ok) { setWebStatus({ ...W.status(), state: 'unsupported', detail: sup.detail }); return; }
      const cached = await W.isCached(pickedWeb);
      if (live) setWebCached(cached);
    })();
    return () => { live = false; };
  }, [provider, pickedWeb]);

  const loadWeb = async () => {
    setResult(null);
    await W.load(pickedWeb);
    setWebStatus(W.status());
    setWebCached(await W.isCached(pickedWeb));
  };

  const deleteWeb = async () => {
    const r = await W.deleteModel(pickedWeb);
    setWebStatus(W.status());
    setWebCached(false);
    setWebNote(r.ok ? 'Deleted: the model is no longer stored in this browser.' : `Could not delete: ${r.reason}`);
  };

  // Switching provider swaps the address and model while they are still the other's defaults
  const changeProvider = (pv) => {
    setProvider(pv);
    setResult(null);
    setWebNote('');
    if (pv === 'webllm' || !DEFAULTS[pv]) return;
    const other = DEFAULTS[pv === 'openai' ? 'local' : 'openai'];
    if (!endpoint || endpoint === other.endpoint) setEndpoint(DEFAULTS[pv].endpoint);
    if (!model || model === other.model) setModel(DEFAULTS[pv].model);
  };

  const current = () => (provider === 'webllm'
    ? { provider, apiKey: '', endpoint: endpoint || DEFAULTS.local.endpoint, model: pickedWeb, temperature: Number(temperature) || 0.7 }
    : {
      provider,
      apiKey: provider === 'openai' ? apiKey.trim() : '',
      endpoint: endpoint || DEFAULTS[provider].endpoint,
      model: model || DEFAULTS[provider].model,
      temperature: Number(temperature) || 0.7,
    });

  const test = async () => {
    setTesting(true);
    setResult({ ok: null, text: `Testing ${provider === 'webllm' ? 'the in-browser model' : current().endpoint} …` });
    try {
      const r = await NpcBrain.testConnection(current());
      if (r.ok) {
        // It works: switch it on (Save keeps it)
        setEnabled(true);
        setResult({ ok: true, text: `Connected: the model replied "${r.detail}". AI NPCs are switched on; press Save.` });
      }
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

  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || chatting) return;
    const history = [...chat.filter(m => m.role !== 'error'), { role: 'user', content: text }];
    setChat([...chat, { role: 'user', content: text }]);
    setChatText('');
    setChatting(true);
    try {
      const r = await NpcBrain.testChat(current(), history);
      setChat(c => [...c, r.ok ? { role: 'assistant', content: r.text || '(no words)', ms: r.ms } : { role: 'error', content: r.detail || 'no answer' }]);
    } catch (e) {
      setChat(c => [...c, { role: 'error', content: (e && e.message) || 'unknown' }]);
    } finally {
      setChatting(false);
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
      // Kept apart so switching providers keeps the in-browser pick
      llmWebModel: provider === 'webllm' ? pickedWeb : (saved.llmWebModel || ''),
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
            Let a language model voice the people you talk to: a local llama-server, OpenAI with your own API key, or a model run right here in the browser on your graphics card.
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
              <option value="webllm">In-browser (WebLLM)</option>
            </select>
          </div>
          {provider === 'webllm' && (() => {
            const m = (catalog.models || []).find((x) => x.id === pickedWeb);
            const line = webNote ? { color: 'var(--text-secondary, #aaa)', text: webNote } : webllmLine(webStatus.model && webStatus.model !== pickedWeb && webStatus.state === 'ready' ? { state: 'idle' } : webStatus, webCached);
            const busy = webStatus.state === 'loading';
            return (
              <>
                <div style={row}>
                  <span style={label}>Model</span>
                  <select style={input} value={pickedWeb} onChange={(e) => { setWebModel(e.target.value); setWebNote(''); }}>
                    {(catalog.models || []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </div>
                {m && m.note && <div style={{ fontSize: '11px', color: 'var(--text-secondary, #aaa)', margin: '0 0 6px 120px' }}>{m.note}</div>}
                <div style={{ ...row, justifyContent: 'flex-end' }}>
                  <button className="title-btn" style={btn} onClick={loadWeb} disabled={busy || webStatus.state === 'unsupported'}>{busy ? 'Loading…' : 'Download / Load model'}</button>
                  <button className="title-btn" style={btn} onClick={deleteWeb} disabled={busy} title="Free the disk space the downloaded model takes">Delete downloaded model</button>
                </div>
                <div style={{ height: '6px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', overflow: 'hidden', margin: '6px 0' }}>
                  <div style={{ height: '100%', width: `${Math.round((webStatus.progress || 0) * 100)}%`, background: 'var(--accent-gold, #c9a227)', transition: 'width 0.2s' }} />
                </div>
                <div style={{ fontSize: '12px', color: line.color, wordBreak: 'break-word' }}>{line.text}</div>
              </>
            );
          })()}
          {provider === 'openai' && (
            <div style={row}>
              <span style={label}>API Key</span>
              <input style={input} type="password" autoComplete="off" placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
          )}
          {provider !== 'webllm' && (
            <>
              <div style={row}>
                <span style={label}>Endpoint</span>
                <input style={input} type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
              </div>
              <div style={row}>
                <span style={label}>Model</span>
                <input style={input} type="text" value={model} onChange={(e) => setModel(e.target.value)} />
              </div>
            </>
          )}
          <div style={row}>
            <span style={label}>Temperature</span>
            <input type="range" min="0" max="1.5" step="0.05" value={temperature} onChange={(e) => setTemperature(e.target.value)} style={{ flex: 1 }} />
            <span style={{ width: '34px', fontSize: '12px' }}>{temperature}</span>
          </div>
          {!enabled && (provider !== 'openai' || apiKey.trim()) && (
            <div style={{ fontSize: '12px', color: '#e0b050', margin: '4px 0' }}>
              AI NPCs are off: tick Enable AI NPCs and Save, or the people you meet keep to their written lines.
            </div>
          )}
          {result && (
            <div style={{ fontSize: '12px', marginTop: '6px', wordBreak: 'break-word', color: result.ok === true ? '#7fd07f' : result.ok === false ? '#e08080' : 'var(--text-secondary, #aaa)' }}>
              {result.text}
            </div>
          )}
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '12px', marginBottom: '4px' }}>💬 Talk to the model <span style={{ opacity: 0.6 }}>(uses the settings above; nothing is saved)</span></div>
            <div style={{ maxHeight: '180px', overflowY: 'auto', fontSize: '12px', lineHeight: 1.4, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', padding: '6px', minHeight: '40px' }}
              ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
              {!chat.length && <i style={{ opacity: 0.6 }}>Say something to hear how the model answers.</i>}
              {chat.map((m, i) => (
                <div key={i} style={{ color: m.role === 'user' ? '#ece2c8' : m.role === 'error' ? '#e08080' : '#d8c89f', marginBottom: m.role === 'assistant' ? '4px' : 0 }}>
                  {m.role === 'user' ? <><b>You:</b> {m.content}</> : m.role === 'error' ? <>✗ {m.content}</> : <><b>Model:</b> {m.content} {m.ms != null && <span style={{ opacity: 0.55, fontSize: '10px' }}>({(m.ms / 1000).toFixed(1)}s)</span>}</>}
                </div>
              ))}
              {chatting && <div style={{ opacity: 0.7 }}><i>⏳ thinking…</i></div>}
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <input style={{ ...input, flex: 1 }} type="text" placeholder="Good morrow, what news?" value={chatText}
                onChange={(e) => setChatText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') sendChat(); }} />
              <button className="title-btn" style={btn} onClick={sendChat} disabled={chatting || !chatText.trim()}>Send</button>
              <button className="title-btn" style={btn} onClick={() => setChat([])} disabled={chatting || !chat.length}>Clear</button>
            </div>
          </div>
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
