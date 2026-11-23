import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PreviewClient, previewKey, randomSeed } from './worldPreviewClient.js';

// The New Game screen's world preview: the land FORGE MY DESTINY will make
// with these settings and this seed (the real generator's land stage, made in
// a worker: worldPreviewClient.js), one block per hex in its terrain's colour
// (data/terrain.json types[].color), rivers as thin blue lines, the realms'
// first lands tinted, their capitals and first towns marked.

const DEBOUNCE_MS = 400;
const RIVER = '#4aa3ff';

const _rgb = (hex) => {
    const h = String(hex || '#000').replace('#', '');
    const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
    return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
};

/** Pixel layout of a preview: k px per hex across (even, so a row's half-step is whole), rows 0.866 k high */
function layout(p) {
    const k = Math.max(2, 2 * Math.round(360 / p.width));
    const rowY = (r) => Math.floor(r * k * 0.866);
    return { k, rowY, w: p.width * k + k / 2, h: rowY(p.height) };
}

/** Even rows sit half a hex to the right (core/hex.js neighbors) */
const hexX = (q, r, k) => q * k + (r % 2 === 0 ? k / 2 : 0);

function drawPreview(canvas, p) {
    const { k, rowY, w, h } = layout(p);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, w, h);
    const W = p.width;
    const H = p.height;
    const pal = p.types.map(t => _rgb(t.color));
    const realmRgb = p.kingdoms.map(kd => _rgb(kd.color));
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const realmAt = (q, r) => (r < 0 || r >= H) ? 0 : p.realm[r * W + ((q % W) + W) % W];
    for (let r = 0; r < H; r++) {
        const y0 = rowY(r);
        const y1 = rowY(r + 1);
        const odd = r % 2 !== 0;
        for (let q = 0; q < W; q++) {
            const i = r * W + q;
            let [cr, cg, cb] = pal[p.terrain[i]] || [0, 0, 0];
            const realm = p.realm[i];
            if (realm) {
                // A realm's lands tinted in its colour, its edge drawn strong
                // (neighbours of an even row lie a column right: core/hex.js)
                const nq = odd ? q - 1 : q;
                const edge = realmAt(q + 1, r) !== realm || realmAt(q - 1, r) !== realm
                    || realmAt(nq, r - 1) !== realm || realmAt(nq + 1, r - 1) !== realm
                    || realmAt(nq, r + 1) !== realm || realmAt(nq + 1, r + 1) !== realm;
                const [kr, kg, kb] = realmRgb[realm - 1] || [255, 255, 255];
                const a = edge ? 0.8 : 0.28;
                cr = cr + (kr - cr) * a; cg = cg + (kg - cg) * a; cb = cb + (kb - cb) * a;
            }
            const x0 = hexX(q, r, k);
            for (let y = y0; y < y1; y++) {
                let o = (y * w + x0) * 4;
                for (let x = 0; x < k; x++, o += 4) {
                    d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 255;
                }
            }
        }
    }
    ctx.putImageData(img, 0, 0);

    const centre = (i) => {
        const q = i % W;
        const r = (i - q) / W;
        return [hexX(q, r, k) + k / 2, (rowY(r) + rowY(r + 1)) / 2];
    };
    // Rivers: from each river hex to the hex it flows into
    ctx.strokeStyle = RIVER;
    ctx.lineWidth = Math.max(1, k * 0.35);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < p.riverTo.length; i++) {
        const j = p.riverTo[i];
        if (j < 0) continue;
        const [x1, y1] = centre(i);
        const [x2, y2] = centre(j);
        if (Math.abs(x2 - x1) > w / 2) continue; // (across the wrapped edge)
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    // The realms' first towns, then their capitals
    const townSize = Math.max(2, Math.round(k * 0.9));
    for (const t of p.towns) {
        if (t.type === 'capital') continue;
        const [x, y] = centre(t.r * W + t.q);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(Math.round(x - townSize / 2) - 1, Math.round(y - townSize / 2) - 1, townSize + 2, townSize + 2);
        ctx.fillStyle = '#f3e7c9';
        ctx.fillRect(Math.round(x - townSize / 2), Math.round(y - townSize / 2), townSize, townSize);
    }
    const capR = Math.max(3, k * 1.2);
    for (const kd of p.kingdoms) {
        if (!kd.capital) continue;
        const [x, y] = centre(kd.capital.r * W + kd.capital.q);
        ctx.beginPath();
        ctx.arc(x, y, capR, 0, Math.PI * 2);
        ctx.fillStyle = kd.color;
        ctx.fill();
        ctx.lineWidth = Math.max(1, capR * 0.4);
        ctx.strokeStyle = '#f5c542';
        ctx.stroke();
    }
}

/** The hex under a point of the canvas (in canvas pixels), or null */
function hexAt(p, x, y) {
    const { k, rowY } = layout(p);
    let r = Math.floor(y / (k * 0.866));
    while (r > 0 && rowY(r) > y) r--;
    while (r < p.height - 1 && rowY(r + 1) <= y) r++;
    if (r < 0 || r >= p.height) return null;
    const q = Math.floor((x - (r % 2 === 0 ? k / 2 : 0)) / k);
    if (q < 0 || q >= p.width) return null;
    return { q, r };
}

async function copyText(text, input) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through to the selection */ }
    try {
        if (input) {
            input.select();
            return document.execCommand('copy');
        }
    } catch { /* nothing more to try */ }
    return false;
}

export default function WorldPreview({ settings, onSeedChange }) {
    const canvasRef = useRef(null);
    const seedRef = useRef(null);
    const clientRef = useRef(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const [preview, setPreview] = useState(null);
    const [status, setStatus] = useState('idle'); // idle | working | ready | error
    const [error, setError] = useState('');
    const [hover, setHover] = useState('');
    const [copied, setCopied] = useState(false);

    const seed = String(settings.mapSeed || '').trim();
    // Only what shapes the land asks for a new preview (not a name, a look or an origin)
    const key = useMemo(() => previewKey(settings), [settings]);

    useEffect(() => {
        const client = new PreviewClient();
        clientRef.current = client;
        return () => { client.dispose(); clientRef.current = null; };
    }, []);

    useEffect(() => {
        if (!seed) { setStatus('idle'); return undefined; }
        setStatus('working');
        let live = true;
        const timer = setTimeout(() => {
            const client = clientRef.current;
            if (!client) return;
            client.request(settingsRef.current).then((p) => {
                if (!live) return;
                setPreview(p);
                setStatus('ready');
                setError('');
            }, (err) => {
                if (!live || (err && err.superseded)) return;
                console.warn('[WorldPreview] could not preview the world', err);
                setError(String((err && err.message) || err));
                setStatus('error');
            });
        }, DEBOUNCE_MS);
        return () => { live = false; clearTimeout(timer); };
        // (the key stands for every land setting; the settings are read from the ref)
    }, [key, seed]);

    useEffect(() => {
        if (preview && canvasRef.current) drawPreview(canvasRef.current, preview);
    }, [preview]);

    const onMove = (e) => {
        const c = canvasRef.current;
        if (!preview || !c || !c.clientWidth) return;
        // (offsetX is in the canvas's own CSS pixels, so the sheet's --ui-zoom does not matter;
        // object-fit: contain may letterbox the map inside the element)
        const scale = Math.min(c.clientWidth / c.width, c.clientHeight / c.height);
        const x = (e.nativeEvent.offsetX - (c.clientWidth - c.width * scale) / 2) / scale;
        const y = (e.nativeEvent.offsetY - (c.clientHeight - c.height * scale) / 2) / scale;
        const hx = hexAt(preview, x, y);
        if (!hx) { setHover(''); return; }
        const i = hx.r * preview.width + hx.q;
        const type = preview.types[preview.terrain[i]];
        const realm = preview.realm[i] ? preview.kingdoms[preview.realm[i] - 1] : null;
        const town = preview.towns.find(t => t.q === hx.q && t.r === hx.r);
        const river = preview.riverTo[i] >= 0 ? ', river' : '';
        setHover([`${type ? type.name : '?'}${river}`, town && town.name, realm && realm.name].filter(Boolean).join(' · '));
    };

    const reroll = () => onSeedChange(randomSeed(seed));
    const copy = async () => {
        if (!seed) return;
        const ok = await copyText(seed, seedRef.current);
        setCopied(ok);
        if (ok) setTimeout(() => setCopied(false), 1500);
    };

    const stale = preview && preview.seed !== seed;
    const landPct = preview ? Math.round(100 * preview.stats.land / Math.max(1, preview.stats.land + preview.stats.water)) : 0;

    return (
        <div className="settings-group world-preview">
            <h3>World Preview</h3>
            <div className="wp-body">
                <div className={`wp-map ${status === 'working' ? 'is-working' : ''}`}>
                    {preview
                        ? <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setHover('')}
                            aria-label={`Preview of the world for seed ${preview.seed}`} />
                        : <div className="wp-empty">{seed ? 'Charting the world…' : 'Type a seed, or Reroll for one.'}</div>}
                    {status === 'working' && (
                        <div className="wp-spinner" role="status" aria-live="polite">
                            <div className="loading-spinner" />
                            <span>Charting the world…</span>
                        </div>
                    )}
                    <div className="wp-caption">{hover || (preview ? `${preview.width} × ${preview.height} hexes` : ' ')}</div>
                </div>
                <div className="wp-side">
                    <div className="input-row">
                        <label htmlFor="mapSeed">Seed:</label>
                        <input
                            ref={seedRef}
                            type="text"
                            id="mapSeed"
                            placeholder="Type a seed"
                            maxLength={24}
                            spellCheck={false}
                            value={settings.mapSeed}
                            onChange={e => onSeedChange(e.target.value)}
                            // (a blank seed would leave the world to chance: never what was previewed)
                            onBlur={() => { if (!seed) onSeedChange(randomSeed('')); }}
                        />
                    </div>
                    <div className="wp-buttons">
                        <button type="button" className="preset-btn" onClick={reroll} title="A new random seed: a different world with the same settings">🎲 Reroll</button>
                        <button type="button" className="preset-btn" onClick={copy} disabled={!seed} title="Copy the seed, to make this world again or share it">
                            {copied ? '✓ Copied' : '📋 Copy'}
                        </button>
                    </div>
                    {status === 'error' && <div className="wp-note wp-error">The preview could not be made ({error}). The world will still be made from these settings.</div>}
                    {preview && (
                        <div className="wp-stats">
                            <div><span>Land</span><b>{landPct}%</b></div>
                            <div><span>River hexes</span><b>{preview.stats.river}</b></div>
                            <div><span>Realms</span><b>{preview.kingdoms.length || '—'}</b></div>
                            <div><span>Charted in</span><b>{(preview.ms / 1000).toFixed(1)} s</b></div>
                        </div>
                    )}
                    {preview && preview.kingdoms.length > 0 && (
                        <ul className="wp-realms">
                            {preview.kingdoms.map(kd => (
                                <li key={kd.id} title={kd.capital && kd.capital.name ? `Capital: ${kd.capital.name}` : ''}>
                                    <i style={{ background: kd.color }} />
                                    <span>{kd.name}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="wp-note">
                        {preview && !preview.kingdoms.length
                            ? 'The Dawn of Man: no realms yet, only the land the clans will wander.'
                            : 'Gold rings are capitals, pale squares the realms’ first towns; the tint is each realm’s first lands. Free towns, roads and ruins come when the world is made.'}
                        {stale && status !== 'working' ? ' (Showing the last seed charted.)' : ''}
                    </div>
                </div>
            </div>
        </div>
    );
}
