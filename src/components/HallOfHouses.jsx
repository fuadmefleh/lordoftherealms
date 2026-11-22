import React, { useCallback, useEffect, useState } from 'react';
import { useGame } from '../context/GameContext';
import { DataLoader } from '../core/dataLoader';
import { MetaLegacy } from '../systems/metaLegacy.js';
import { HallChronicles } from '../ui/hallChronicles.js';

// The Hall of Houses: every House whose line ended, across all games
// (systems/metaLegacy.js — a profile kept outside the saves), and what the
// Hall has earned for new games (data/metaLegacy.json unlocks). A House's
// chronicle book, when one was kept at its end (ui/hallChronicles.js), opens
// from its card.

const badge = (color) => ({
  marginLeft: 8, fontSize: '11px', color, border: `1px solid ${color}`, borderRadius: 4, padding: '0 5px', whiteSpace: 'nowrap',
});
const muted = { fontSize: '12px', opacity: 0.75 };

function snapshot() {
  const profile = MetaLegacy.load();
  return { entries: MetaLegacy.entries(profile), stats: MetaLegacy.stats(profile), unlocks: MetaLegacy.unlocks(profile) };
}

// An id as words: 'great_lord' → 'Great lord'
const pretty = (id) => { const t = String(id || '').replace(/[_-]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

function when(t) {
  try { return t ? new Date(t).toLocaleDateString() : ''; } catch (err) { return ''; }
}

// A span of years: 'years 812–862', 'from 812' (still standing at the end)
const span = (from, to) => (from == null ? '' : to == null ? `from ${from}` : to === from ? `in ${from}` : `${from}–${to}`);

// The House's successions as words: '4 peaceful, 2 contested (1 war, 1 lost), 1 realm split'
function successionLine(t) {
  if (!t) return '';
  const parts = [];
  if (t.peaceful) parts.push(`${t.peaceful} peaceful`);
  if (t.contested) {
    const inner = [t.wars ? `${t.wars} war${t.wars === 1 ? '' : 's'}` : '', t.lost ? `${t.lost} crown${t.lost === 1 ? '' : 's'} lost` : ''].filter(Boolean).join(', ');
    parts.push(`${t.contested} contested${inner ? ` (${inner})` : ''}`);
  }
  if (t.split) parts.push(`${t.split} realm${t.split === 1 ? '' : 's'} split`);
  return parts.join(', ');
}

const OUTCOME = {
  war: 'rose in arms', usurped: 'took the crown', split: 'carved out a realm of their own', held: 'was beaten in the field',
  boughtOff: 'was bought off', unbacked: 'claimed it, but no lord rose',
};

function HouseCard({ e, onForget }) {
  const [busy, setBusy] = useState(false);
  const openChronicle = useCallback(async () => {
    setBusy(true);
    const ok = await HallChronicles.open(e.id);
    setBusy(false);
    if (!ok) alert('That chronicle could not be found on this machine.');
  }, [e.id]);
  return (
    <div className="settings-group" style={{ marginBottom: 10 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <span>{e.sigilIcon || '🛡️'} {e.house}</span>
        {(e.ages || []).some(a => a.kind === 'golden') && <span style={badge('#e3b341')} title="The House gave its name to a Golden Age">☀️ GOLDEN AGE</span>}
        {(e.ages || []).some(a => a.kind === 'dark') && <span style={badge('#8b949e')} title="The House's crown broke in a Dark Age">🌑 DARK AGE</span>}
        {(e.empires || []).length > 0 && <span style={badge('#d2a8ff')} title={e.empires.map(x => x.name).join(', ')}>⚜️ {(e.empires[e.empires.length - 1].title || 'HIGH CROWN').toUpperCase()}</span>}
        {e.ironman && <span style={badge('#e0846a')}>⚒️ IRONMAN</span>}
        {e.tainted && <span style={badge('#b8a0d8')} title="Cheats were used: listed, but earns no legacy">🧪 TAINTED</span>}
      </h3>
      {e.motto && <div style={{ ...muted, fontStyle: 'italic' }}>“{e.motto}”</div>}
      <div style={{ fontSize: '13px', margin: '4px 0' }}>
        {e.rankIcon} <strong>{e.rank || 'A House'}</strong> · legacy {e.score} · {Math.round(e.years || 0)} years · {e.generations} generation{e.generations === 1 ? '' : 's'}
      </div>
      {(e.peak || []).length > 0 && <div style={muted}>👑 {e.peak.join(' · ')}</div>}
      {/* The age it gave its name to (systems/lastCrisis.js) */}
      {(e.ages || []).map((a, i) => (
        <div key={`age${i}`} style={{ fontSize: '13px', margin: '2px 0', color: a.kind === 'golden' ? '#e3b341' : '#8b949e' }}>
          {a.kind === 'golden' ? '☀️' : '🌑'} <strong>{a.name ? a.name.charAt(0).toUpperCase() + a.name.slice(1) : (a.kind === 'golden' ? 'A Golden Age' : 'A Dark Age')}</strong>
          {' · '}{a.kind === 'golden' ? 'a Golden Age' : 'a Dark Age'}
          {a.fromYear != null ? `, years ${span(a.fromYear, a.toYear)}` : ''}
          {a.realm ? ` · ${a.realm}` : ''}
        </div>
      ))}
      {/* The high crowns it proclaimed (systems/highCrowns.js) */}
      {(e.empires || []).length > 0 && (
        <div style={muted}>
          ⚜️ {e.empires.map(x => `${x.title ? `${x.title} of ` : ''}the ${x.name}${x.fromYear != null ? ` (${span(x.fromYear, x.toYear)})` : ''}${x.why ? `, ended: ${x.why}` : ''}`).join(' · ')}
        </div>
      )}
      {/* Its crowns' successions (systems/crownSuccession.js) */}
      {e.successions && successionLine(e.successions) && (
        <div style={muted}>⚔️ Successions: {successionLine(e.successions)}</div>
      )}
      {(e.crownWars || []).length > 0 && (
        <details style={{ marginTop: 2 }}>
          <summary style={{ cursor: 'pointer', fontSize: '12px' }}>Contested crowns ({e.crownWars.length})</summary>
          {e.crownWars.map((w, i) => (
            <div key={i} style={{ fontSize: '12px', marginLeft: 8 }}>
              {w.year != null ? `${w.year}: ` : ''}{w.claimant || 'A claimant'} {OUTCOME[w.outcome] || w.outcome} against {w.heir || 'the heir'}
              {w.realm ? ` in ${w.realm}` : ''}{w.newRealm ? ` (${w.newRealm})` : ''}
            </div>
          ))}
        </details>
      )}
      {/* What the House wrote on the world (systems/namedLegacy.js) */}
      {(e.rememberedFor || e.myth || (e.codes || []).length > 0) && (
        <div style={muted}>
          {e.rememberedFor ? `✍️ Remembered for ${e.rememberedFor}` : ''}
          {e.myth ? `${e.rememberedFor ? ' · ' : ''}🐺 ${e.myth}` : ''}
          {(e.codes || []).length > 0 ? `${e.rememberedFor || e.myth ? ' · ' : ''}📕 ${e.codes.join(', ')}` : ''}
        </div>
      )}
      <div style={muted}>
        🕯️ Ended {e.cause ? `by ${e.cause}` : ''} with {e.lastRuler || 'its last ruler'}
        {e.endYear ? ` in year ${e.endYear}` : ''}{e.startYear ? ` (begun in ${e.startYear})` : ''} · {when(e.endedAt)}
      </div>
      <div style={muted}>
        {e.origin ? `Origin: ${pretty(e.origin)}` : ''}{e.difficulty ? ` · ${pretty(e.difficulty)}` : ''}
        {e.descendedFrom ? ` · descended from ${e.descendedFrom}` : ''}
        {e.victory ? ` · 🏆 ${e.victory}` : ''}
      </div>
      {(e.places || []).length > 0 && <div style={muted}>🗺️ Names on the map: {e.places.join(', ')}</div>}
      {(e.chapters || []).length > 1 && (
        <details style={{ marginTop: 2 }}>
          <summary style={{ cursor: 'pointer', fontSize: '12px' }}>Last chapters ({e.chapters.length})</summary>
          {e.chapters.map((c, i) => (
            <div key={i} style={{ fontSize: '12px', marginLeft: 8 }}>
              {c.ruler}{c.year != null ? ` (${c.year})` : ''}: remembered for {c.label}{c.motto ? `; "${c.motto}"` : ''}
            </div>
          ))}
        </details>
      )}
      {(e.heirlooms || []).length > 0 && (
        <div style={muted}>Heirlooms: {e.heirlooms.map(h => `${h.icon || ''} ${h.name}`.trim()).join(', ')}</div>
      )}
      {e.line && <div style={{ ...muted, fontStyle: 'italic', marginTop: 2 }}>{e.line}</div>}
      {(e.reigns || []).length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', fontSize: '12px' }}>Reigns ({e.reigns.length})</summary>
          {e.reigns.map((r, i) => (
            <div key={i} style={{ fontSize: '12px', marginLeft: 8 }}>
              {i + 1}. {r.name}{r.epithet ? ` ${r.epithet}` : ''}: {r.years} yrs, legacy {r.score}
              {r.crown ? `, crown of ${r.crown}` : r.title ? `, ${r.title}` : ''}
            </div>
          ))}
        </details>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        {e.chronicle && (
          <button className="title-btn" style={{ fontSize: '12px', padding: '3px 10px' }} disabled={busy} onClick={openChronicle}>
            📖 Open the chronicle
          </button>
        )}
        <button className="title-btn" style={{ fontSize: '11px', padding: '2px 8px', color: '#f85149' }} onClick={() => onForget(e)}>
          Forget
        </button>
      </div>
    </div>
  );
}

export default function HallOfHouses() {
  const { setPhase } = useGame();
  const [hall, setHall] = useState(snapshot);
  useEffect(() => {
    // The unlocks are data (data/metaLegacy.json): read again once the game data is in
    let live = true;
    DataLoader._loadGamedata()
      .then(() => { if (live) setHall(snapshot()); })
      .catch(() => { /* the defaults stand */ });
    return () => { live = false; };
  }, []);

  const forget = useCallback((e) => {
    if (!confirm(`Forget ${e.house}? Its place in the Hall, and what it earned, are lost.`)) return;
    MetaLegacy.removeEntry(e.id);
    HallChronicles.remove(e.id);
    setHall(snapshot());
  }, []);

  const { entries, stats, unlocks } = hall;
  return (
    <div id="settingsScreen">
      <div id="settingsContent">
        <h2 className="settings-title">🏛️ Hall of Houses</h2>
        <div style={{ textAlign: 'center', ...muted, marginBottom: 12 }}>
          {entries.length === 0
            ? "No House has ended yet. When a line ends, it is entered here, and later games inherit a little from it."
            : `${stats.housesEnded} House${stats.housesEnded === 1 ? '' : 's'} remembered · ${stats.totalYears} years ruled in all · best legacy ${stats.bestScore}`
              + (stats.ironmanHouses ? ` · ${stats.ironmanHouses} Ironman` : '')
              + (stats.tainted ? ` · ${stats.tainted} tainted` : '')}
        </div>

        {/* (two columns, the Houses and what they earned: not the New Game sheet's three) */}
        <div className="settings-groups-container" style={{ alignItems: 'start', gridTemplateColumns: entries.length ? 'minmax(0, 3fr) minmax(0, 2fr)' : 'minmax(0, 1fr)' }}>
          {entries.length > 0 && (
            <div style={{ minWidth: 0 }}>
              {entries.map(e => <HouseCard key={e.id} e={e} onForget={forget} />)}
            </div>
          )}
          <div className="settings-group" style={{ minWidth: 0 }}>
            <h3>Legacy</h3>
            <div style={{ ...muted, marginBottom: 6 }}>
              Earned by Houses whose runs were not tainted. Choose them on the New Game sheet, under Legacy & Ironman.
            </div>
            {unlocks.map(u => (
              <div key={u.id} style={{ margin: '6px 0', opacity: u.earned ? 1 : 0.55 }}>
                <div style={{ fontSize: '13px' }}>{u.earned ? '✅' : '🔒'} {u.icon} <strong>{u.name}</strong></div>
                <div style={{ fontSize: '11px', opacity: 0.85 }}>{u.blurb}</div>
                {!u.earned && <div style={{ fontSize: '11px', opacity: 0.7 }}>Needs {u.requirement}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="settings-actions">
          <button className="title-btn" onClick={() => setPhase('title')}>Back</button>
        </div>
      </div>
    </div>
  );
}
