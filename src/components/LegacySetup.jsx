import React, { useEffect, useMemo, useState } from 'react';
import { DataLoader } from '../core/dataLoader';
import { MetaLegacy } from '../systems/metaLegacy.js';
import { SaveLoad } from '../systems/saveLoad.js';

// The New Game sheet's "Legacy & Ironman" group (components/SettingsScreen.jsx).
// Writes these settings, read by ui/game/gameSetup.js:
//   ironman        — one save, kept at each day's end and on quit (ui/game/ironman.js)
//   legacyOrigin   — a legacy start earned in the Hall (its base origin is set as `origin`)
//   legacyLineage  — a Hall entry to descend from
//   legacyBoon     — one earned Inheritance
// Every legacy choice is checked again when applied (systems/metaLegacyStart.js).

const hint = { fontSize: '11px', opacity: 0.8, margin: '2px 0 8px' };

function hallChoices() {
  try {
    const profile = MetaLegacy.load();
    return {
      stats: MetaLegacy.stats(profile),
      open: MetaLegacy.lineageOpen(profile),
      lineages: MetaLegacy.lineages(profile),
      boons: MetaLegacy.boons(profile),
      origins: MetaLegacy.legacyOrigins(profile),
    };
  } catch (err) {
    return { stats: { housesEnded: 0 }, open: { lineage: false, claim: false }, lineages: [], boons: [], origins: [] };
  }
}

export default function LegacySetup({ values, onChange }) {
  const [hall, setHall] = useState(hallChoices);
  useEffect(() => {
    // The unlocks are data (data/metaLegacy.json): read again once the game data is in
    let live = true;
    DataLoader._loadGamedata()
      .then(() => { if (live) setHall(hallChoices()); })
      .catch(() => { /* the defaults stand */ });
    return () => { live = false; };
  }, []);
  const ironSave = useMemo(() => {
    try { return SaveLoad.getSaveInfo(SaveLoad.IRONMAN_KEY); } catch (err) { return null; }
  }, []);

  const legacyOrigin = values.legacyOrigin || '';
  const chosenStart = hall.origins.find(o => o.id === legacyOrigin) || null;
  // Another origin picked above: the legacy start no longer applies
  useEffect(() => {
    if (!legacyOrigin) return;
    if (!chosenStart || values.origin !== (chosenStart.base || 'wanderer')) onChange('legacyOrigin', '');
  }, [values.origin, legacyOrigin, chosenStart, onChange]);

  const pickStart = (id) => {
    const o = hall.origins.find(x => x.id === id);
    if (o) onChange('origin', o.base || 'wanderer');
    onChange('legacyOrigin', id);
  };

  const boon = hall.boons.find(b => b.id === values.legacyBoon) || null;
  const lineage = hall.lineages.find(e => e.id === values.legacyLineage) || null;
  const showLineage = (hall.open.lineage || (chosenStart && chosenStart.lineage)) && hall.lineages.length > 0;

  return (
    <div className="settings-group">
      <h3>Legacy & Ironman</h3>
      <div className="input-row" title="One save slot, kept at each day's end and when you leave. No loading back.">
        <label htmlFor="ironman">Ironman:</label>
        <input type="checkbox" id="ironman" checked={!!values.ironman} onChange={e => onChange('ironman', e.target.checked)} />
      </div>
      <div className="settings-hint" style={hint}>
        {values.ironman
          ? "⚒️ One save, written at each day's end and when you leave. No manual saves or loads. When your line ends, the run is over. An heir, a new life or letting time pass still carry it on. Cheats taint the run."
          : 'Ironman keeps a single save that you cannot load back.'}
        {values.ironman && ironSave && (
          <strong style={{ color: '#e0846a' }}>{` An Ironman run is already under way (${ironSave.houseName || ironSave.playerName || 'unnamed'}, year ${ironSave.year}). Starting a new one replaces it.`}</strong>
        )}
      </div>

      {hall.stats.housesEnded === 0 && hall.origins.length === 0 ? (
        <div className="settings-hint" style={hint}>
          🏛️ The Hall of Houses is empty. When a House's line ends, it is entered there, and later games inherit a little from it.
        </div>
      ) : (
        <>
          {hall.origins.length > 0 && (
            <div className="input-row">
              <label htmlFor="legacyOrigin">Legacy start:</label>
              <select id="legacyOrigin" value={legacyOrigin} onChange={e => pickStart(e.target.value)}>
                <option value="">(the origin above)</option>
                {hall.origins.map(o => <option key={o.id} value={o.id}>{`${o.icon || ''} ${o.name || o.id}`.trim()}</option>)}
              </select>
            </div>
          )}
          {chosenStart && <div className="settings-hint" style={hint}>{chosenStart.blurb}</div>}

          {showLineage && (
            <div className="input-row">
              <label htmlFor="legacyLineage">Descended from:</label>
              <select id="legacyLineage" value={values.legacyLineage || ''} onChange={e => onChange('legacyLineage', e.target.value)}>
                <option value="">{chosenStart && chosenStart.lineage ? '(your latest House)' : 'No one remembered'}</option>
                {hall.lineages.map(e => (
                  <option key={e.id} value={e.id}>{`${e.sigilIcon || '🛡️'} ${e.house} (${Math.round(e.years || 0)} yrs, legacy ${e.score || 0})`}</option>
                ))}
              </select>
            </div>
          )}
          {showLineage && (lineage || (chosenStart && chosenStart.lineage)) && (
            <div className="settings-hint" style={hint}>
              The new world remembers {lineage ? lineage.house : 'your latest House'} in its lore. One realm still holds a grudge against the name
              {hall.open.claim ? ', and a line that wore a crown keeps a weak claim to a throne.' : '.'}
            </div>
          )}

          {hall.boons.length > 0 && (
            <div className="input-row">
              <label htmlFor="legacyBoon">Inheritance:</label>
              <select id="legacyBoon" value={values.legacyBoon || ''} onChange={e => onChange('legacyBoon', e.target.value)}>
                <option value="">Nothing</option>
                {hall.boons.map(b => <option key={b.id} value={b.id}>{`${b.icon || ''} ${b.name}`.trim()}</option>)}
              </select>
            </div>
          )}
          {boon && <div className="settings-hint" style={hint}>{boon.blurb}</div>}
          <div className="settings-hint" style={{ ...hint, opacity: 0.6 }}>
            🏛️ {hall.stats.housesEnded} House{hall.stats.housesEnded === 1 ? '' : 's'} in the Hall
            {hall.stats.tainted ? ` (${hall.stats.tainted} tainted, which earn nothing)` : ''}.
          </div>
        </>
      )}
    </div>
  );
}
