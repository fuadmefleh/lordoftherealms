import React, { useEffect, useRef, useState } from 'react';
import { InnerMapCharacters } from '../ui/innerMapCharacters';
import { NpcPortrait } from '../ui/npcPortrait';
import {
  APPEARANCE_ROWS, optionLabel, cycleOption, randomAppearance, registerAppearance,
} from '../ui/playerAppearance';
import { EraWardrobe } from '../world/eraWardrobe';

// Facing order for the turn buttons: down, left, up, right
const FACINGS = [InnerMapCharacters.DIR_DOWN, InnerMapCharacters.DIR_LEFT,
  InnerMapCharacters.DIR_UP, InnerMapCharacters.DIR_RIGHT];

/**
 * The character-creation look: a full-length figure you can turn and watch
 * walk, a bust showing how the HUD portrait will read, and a cycler per
 * feature. The look lives in settings.charAppearance. The clothes offered are
 * those of the start year's era (`year`, data/eras.json via `eraData`).
 */
export default function CharacterForge({ appearance, gender, name, onChange, year = null, eraData = null }) {
  const figureRef = useRef(null);
  const bustRef = useRef(null);
  const [presetId, setPresetId] = useState(null);
  const [facing, setFacing] = useState(0);
  const [walking, setWalking] = useState(false);
  const [loading, setLoading] = useState(true);

  // Composite the look whenever it changes; keep showing the last one meanwhile
  useEffect(() => {
    let live = true;
    setLoading(true);
    registerAppearance(appearance).then((id) => {
      if (!live) return;
      setLoading(false);
      if (id) setPresetId(id);
    }).catch((err) => {
      // A sprite sheet that fails to load must not leave the figure dimmed forever
      console.warn('[CharacterForge] Could not composite the look:', err);
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [appearance]);

  // Paint the figure and the bust every frame
  useEffect(() => {
    if (!presetId) return undefined;
    let raf = 0;
    const tick = () => {
      const t = performance.now() / 1000;
      const fig = figureRef.current;
      if (fig) {
        const ctx = fig.getContext('2d');
        ctx.clearRect(0, 0, fig.width, fig.height);
        ctx.imageSmoothingEnabled = false;
        // The figure stands in the middle 52×52 of its 64×64 frame
        const s = fig.width / 52;
        InnerMapCharacters.drawCharacter(ctx, presetId, walking ? 'walk' : 'idle', FACINGS[facing], t,
          -6 * s, -9 * s, 64 * s, 64 * s);
      }
      if (bustRef.current) NpcPortrait.paint(bustRef.current, null, t, presetId);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [presetId, facing, walking]);

  const turn = (step) => setFacing(f => (f + step + FACINGS.length) % FACINGS.length);
  const cycle = (key, step) => onChange(cycleOption(appearance, key, step, year, eraData));
  const era = year != null ? EraWardrobe.eraOf(year, eraData) : null;
  const dated = era && !EraWardrobe.isModern(era);
  const rows = APPEARANCE_ROWS.filter(r => !r.when || r.when(appearance));

  return (
    <div className="char-forge-look">
      <div className="char-forge-stage">
        <div className={`char-forge-figure ${loading ? 'is-loading' : ''}`}
          onMouseEnter={() => setWalking(true)} onMouseLeave={() => setWalking(false)}
          title="Hover to see them walk">
          <canvas ref={figureRef} width={192} height={192} />
        </div>
        <div className="char-forge-turn">
          <button type="button" onClick={() => turn(-1)} title="Turn left">↺</button>
          <span className="char-forge-name">{name || 'Wanderer'}</span>
          <button type="button" onClick={() => turn(1)} title="Turn right">↻</button>
        </div>
        <div className="char-forge-bust" title="Your portrait in the game">
          <canvas ref={bustRef} width={72} height={72} />
        </div>
      </div>

      <div className="char-forge-rows">
        {rows.map(r => (
          <div className="char-forge-row" key={r.key}>
            <span className="char-forge-label">{r.label}</span>
            <button type="button" className="char-forge-step" onClick={() => cycle(r.key, -1)}
              aria-label={`Previous ${r.label}`}>‹</button>
            <span className="char-forge-value" title={optionLabel(r.key, appearance[r.key])}>
              {optionLabel(r.key, appearance[r.key])}
            </span>
            <button type="button" className="char-forge-step" onClick={() => cycle(r.key, 1)}
              aria-label={`Next ${r.label}`}>›</button>
          </div>
        ))}
        {dated && (
          <div className="char-forge-era" title="The clothes offered are those of the start year">
            Dressed for {era.label}{era.hint ? `: ${era.hint}` : ''}.
          </div>
        )}
        <button type="button" className="char-forge-random"
          onClick={() => onChange(randomAppearance(gender, Math.random, year, eraData))}>🎲 Random Look</button>
      </div>
    </div>
  );
}
