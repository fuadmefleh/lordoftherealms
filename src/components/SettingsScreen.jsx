import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '../context/GameContext';
import CharacterForge from './CharacterForge';
import { buildForGender, defaultAppearance } from '../ui/playerAppearance';
import scenariosData from '../../data/scenarios.json';
import dawnData from '../../data/dawn.json';

// Origin & Challenge choices (data/scenarios.json; applied by player/scenarios.js)
const _entries = (o) => Object.entries(o || {}).filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object');
const ORIGINS = _entries(scenariosData.origins);
const DIFFICULTIES = _entries(scenariosData.difficulty);
const VICTORIES = _entries(scenariosData.victory).map(([id, v]) => [id, {
  ...v, blurb: String(v.blurb || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? Number(v[k]).toLocaleString('en-US') : m)),
}]);
// Start years before this begin at the Dawn of Man (world/dawn.js)
const DAWN_YEAR = dawnData.dawnYear || 200;
const _find = (list, id) => (list.find(([k]) => k === id) || [])[1] || null;

const MAP_PRESETS = {
  tiny:   { width: 60,  height: 40,  kingdoms: 3  },
  small:  { width: 80,  height: 55,  kingdoms: 4  },
  medium: { width: 120, height: 80,  kingdoms: 6  },
  large:  { width: 180, height: 120, kingdoms: 8  },
  huge:   { width: 250, height: 170, kingdoms: 12 },
  epic:   { width: 350, height: 240, kingdoms: 16 },
};

// Field rows live at module scope: defined inside SettingsScreen they were a new
// component type on every render, so each change remounted every input (a
// dragged slider dropped out of the drag after one step, a select lost focus)
function RangeInput({ id, label, field, min, max, step, values, onChange }) {
  return (
    <div className="input-row">
      <label htmlFor={id}>{label}</label>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step || 1}
        value={values[field]}
        onChange={e => onChange(field, parseFloat(e.target.value))}
      />
      <span className="range-value">{values[field]}</span>
    </div>
  );
}

function SelectInput({ id, label, field, options, values, onChange }) {
  return (
    <div className="input-row">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={values[field]}
        onChange={e => onChange(field, e.target.value)}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>{text}</option>
        ))}
      </select>
    </div>
  );
}

export default function SettingsScreen() {
  const { setPhase, setGameState } = useGame();
  const [preset, setPreset] = useState('medium');

  // Settings state
  const [settings, setSettings] = useState({
    charFirstName: '',
    charLastName: '',
    charGender: 'male',
    charAge: 20,
    charAppearance: defaultAppearance('male'),
    guidedStart: true,
    origin: 'wanderer',
    difficulty: 'normal',
    victory: 'none',
    worldWidth: 120,
    worldHeight: 80,
    mapSeed: '',
    continentCount: 3,
    continentSize: 'medium',
    islandFreq: 1.0,
    landMass: 45,
    waterLevel: 0.42,
    riverCount: 40,
    lakeFreq: 'normal',
    terrainFreq: 1.1,
    mountainDensity: 100,
    hillDensity: 100,
    flatness: 'normal',
    temperature: 'normal',
    rainfall: 'normal',
    polarIce: 'normal',
    desertFreq: 'normal',
    forestDensity: 100,
    resourceDensity: 'normal',
    strategicRes: 'normal',
    kingdomCount: 6,
    startYear: 853,
    independentSettlements: 'normal',
    ruinsFreq: 'normal',
    terrainOctaves: 6,
    heatFreq: 3.0,
    moistFreq: 2.0,
    coastalDetail: 5,
    deepWaterLevel: 0.20,
    hillsLevel: 0.52,
    mountainLevel: 0.70,
    snowPeakLevel: 0.88,
  });

  const handlePreset = useCallback((key) => {
    setPreset(key);
    const p = MAP_PRESETS[key];
    setSettings(prev => ({
      ...prev,
      worldWidth: p.width,
      worldHeight: p.height,
      kingdomCount: p.kingdoms,
    }));
  }, []);

  const handleChange = useCallback((field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  }, []);

  // A look still at its default follows the gender; a customised one keeps
  // everything but the build (and only that when the gender names one)
  const handleGender = useCallback((gender) => {
    setSettings(prev => {
      const look = prev.charAppearance;
      const untouched = JSON.stringify(look) === JSON.stringify(defaultAppearance(prev.charGender));
      const charAppearance = untouched
        ? defaultAppearance(gender)
        : { ...look, build: buildForGender(gender, look.build) };
      return { ...prev, charGender: gender, charAppearance };
    });
  }, []);

  // An origin brings its suggested goal and whether a guided start suits it
  const handleOrigin = useCallback((origin) => {
    const o = _find(ORIGINS, origin) || {};
    setSettings(prev => ({
      ...prev,
      origin,
      victory: o.suggestedVictory || 'none',
      guidedStart: o.guidedStart !== false,
    }));
  }, []);

  const handleStartGame = useCallback(() => {
    // Store settings in game state for the Game class to read
    // The age box holds whatever was typed (a cleared box would be NaN): settle it here
    const age = parseInt(settings.charAge, 10);
    const charAge = Number.isFinite(age) ? Math.min(60, Math.max(16, age)) : 20;
    setGameState(prev => ({
      ...prev,
      phase: 'loading',
      settings: { ...settings, charAge },
    }));
  }, [settings, setGameState]);

  const handleRandomize = useCallback(() => {
    setSettings(prev => ({
      ...prev,
      mapSeed: Math.random().toString(36).slice(2, 10),
      continentCount: 1 + Math.floor(Math.random() * 10),
      landMass: 20 + Math.floor(Math.random() * 60),
      riverCount: Math.floor(Math.random() * 150),
      kingdomCount: 2 + Math.floor(Math.random() * 14),
    }));
  }, []);

  // What every RangeInput / SelectInput on this sheet reads and writes
  const bind = { values: settings, onChange: handleChange };

  return (
    <div id="settingsScreen">
      <div id="settingsContent">
        <h2 className="settings-title">New Game Initialization</h2>

        {/* Map Size Presets */}
        <div className="settings-presets">
          <span className="preset-label">Map Size:</span>
          {Object.keys(MAP_PRESETS).map(key => (
            <button
              key={key}
              className={`preset-btn ${preset === key ? 'active' : ''}`}
              data-preset={key}
              onClick={() => handlePreset(key)}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>

        <div className="settings-groups-container">
          {/* Character: who you are and what you look like */}
          <div className="settings-group char-forge">
            <h3>Character Profile</h3>
            <div className="char-forge-body">
              <div className="char-forge-fields">
                <div className="input-row">
                  <label htmlFor="charFirstName">First Name:</label>
                  <input
                    type="text"
                    id="charFirstName"
                    placeholder="Wanderer"
                    maxLength={16}
                    value={settings.charFirstName}
                    onChange={e => handleChange('charFirstName', e.target.value)}
                  />
                </div>
                <div className="input-row">
                  <label htmlFor="charLastName">Last Name:</label>
                  <input
                    type="text"
                    id="charLastName"
                    placeholder=""
                    maxLength={16}
                    value={settings.charLastName}
                    onChange={e => handleChange('charLastName', e.target.value)}
                  />
                </div>
                <div className="input-row">
                  <label htmlFor="charGender">Gender:</label>
                  <select id="charGender" value={settings.charGender} onChange={e => handleGender(e.target.value)}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="input-row">
                  <label htmlFor="charAge">Age:</label>
                  <input
                    type="number"
                    id="charAge"
                    value={settings.charAge}
                    min={16}
                    max={60}
                    onChange={e => handleChange('charAge', e.target.value)}
                  />
                </div>
                <div className="input-row" title="A short chain of first steps on the right of the screen, with small rewards. You can skip it at any time.">
                  <label htmlFor="guidedStart">Guided start:</label>
                  <input
                    type="checkbox"
                    id="guidedStart"
                    checked={settings.guidedStart !== false}
                    onChange={e => handleChange('guidedStart', e.target.checked)}
                  />
                </div>
              </div>
              <CharacterForge
                appearance={settings.charAppearance}
                gender={settings.charGender}
                name={[settings.charFirstName, settings.charLastName].filter(Boolean).join(' ')}
                onChange={look => handleChange('charAppearance', look)}
              />
            </div>
          </div>

          {/* Origin & Challenge: who you start as, how hard, and what for */}
          <div className="settings-group">
            <h3>Origin & Challenge</h3>
            <div className="input-row">
              <label htmlFor="origin">Origin:</label>
              <select id="origin" value={settings.origin} onChange={e => handleOrigin(e.target.value)}>
                <optgroup label="Origins: start small">
                  {ORIGINS.filter(([, o]) => o.group !== 'advanced').map(([id, o]) => <option key={id} value={id}>{`${o.icon || ''} ${o.name || id}`.trim()}</option>)}
                </optgroup>
                <optgroup label="Advanced starts: begin high">
                  {ORIGINS.filter(([, o]) => o.group === 'advanced').map(([id, o]) => <option key={id} value={id}>{`${o.icon || ''} ${o.name || id}`.trim()}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="settings-hint" style={{ fontSize: '11px', opacity: 0.8, margin: '2px 0 8px' }}>
              {(_find(ORIGINS, settings.origin) || {}).group === 'advanced' && (
                <strong style={{ color: 'var(--gold, #f5c542)' }}>Advanced start: you take over a real seat of power from day one, with its rivals. </strong>
              )}
              {(_find(ORIGINS, settings.origin) || {}).blurb}
            </div>
            <div className="origin-cards" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '0 0 8px' }}>
              {ORIGINS.filter(([, o]) => o.group === 'advanced').map(([id, o]) => (
                <button key={id} type="button" title={o.blurb} onClick={() => handleOrigin(id)}
                  className="origin-card-btn"
                  style={{
                    fontSize: '11px', padding: '3px 7px', cursor: 'pointer', borderRadius: '4px',
                    border: `1px solid ${settings.origin === id ? 'var(--gold, #f5c542)' : 'rgba(255,255,255,0.2)'}`,
                    background: settings.origin === id ? 'rgba(245,197,66,0.18)' : 'rgba(0,0,0,0.25)',
                    color: 'inherit',
                  }}>
                  {`${o.icon || ''} ${o.name || id}`.trim()}
                </button>
              ))}
            </div>
            <SelectInput {...bind} id="difficulty" label="Difficulty:" field="difficulty"
              options={DIFFICULTIES.map(([id, d]) => [id, d.name || id])} />
            <div className="settings-hint" style={{ fontSize: '11px', opacity: 0.8, margin: '2px 0 8px' }}>
              {(_find(DIFFICULTIES, settings.difficulty) || {}).blurb}
            </div>
            <SelectInput {...bind} id="victory" label="Victory goal:" field="victory"
              options={VICTORIES.map(([id, v]) => [id, `${v.icon || ''} ${v.name || id}`.trim()])} />
            <div className="settings-hint" style={{ fontSize: '11px', opacity: 0.8, margin: '2px 0 4px' }}>
              {(_find(VICTORIES, settings.victory) || {}).blurb}
            </div>
          </div>

          {/* World Dimensions */}
          <div className="settings-group">
            <h3>World Dimensions</h3>
            <RangeInput {...bind} id="worldWidth" label="Width:" field="worldWidth" min={40} max={500} />
            <RangeInput {...bind} id="worldHeight" label="Height:" field="worldHeight" min={30} max={350} />
            <div className="input-row">
              <label htmlFor="mapSeed">Seed:</label>
              <input
                type="text"
                id="mapSeed"
                placeholder="Random"
                maxLength={20}
                value={settings.mapSeed}
                onChange={e => handleChange('mapSeed', e.target.value)}
              />
            </div>
          </div>

          {/* Continents & Land */}
          <div className="settings-group">
            <h3>Continents & Land</h3>
            <RangeInput {...bind} id="continentCount" label="Continents:" field="continentCount" min={1} max={15} />
            <SelectInput {...bind} id="continentSize" label="Continent Size:" field="continentSize"
              options={[['small','Small (many islands)'],['medium','Medium'],['large','Large (sprawling)'],['pangaea','Pangaea (one mass)']]} />
            <RangeInput {...bind} id="islandFreq" label="Islands:" field="islandFreq" min={0} max={5} step={0.1} />
            <RangeInput {...bind} id="landMass" label="Land Coverage:" field="landMass" min={15} max={85} />
          </div>

          {/* Water & Oceans */}
          <div className="settings-group">
            <h3>Water & Oceans</h3>
            <RangeInput {...bind} id="waterLevel" label="Sea Level:" field="waterLevel" min={0.20} max={0.60} step={0.01} />
            <RangeInput {...bind} id="riverCount" label="Rivers:" field="riverCount" min={0} max={200} />
            <SelectInput {...bind} id="lakeFreq" label="Lakes:" field="lakeFreq"
              options={[['none','None'],['few','Few'],['normal','Normal'],['many','Many'],['abundant','Abundant']]} />
          </div>

          {/* Terrain & Elevation */}
          <div className="settings-group">
            <h3>Terrain & Elevation</h3>
            <RangeInput {...bind} id="terrainFreq" label="Land Density:" field="terrainFreq" min={0.5} max={3.0} step={0.1} />
            <RangeInput {...bind} id="mountainDensity" label="Mountains:" field="mountainDensity" min={0} max={200} />
            <RangeInput {...bind} id="hillDensity" label="Hills:" field="hillDensity" min={0} max={200} />
            <SelectInput {...bind} id="flatness" label="Flatness:" field="flatness"
              options={[['rugged','Rugged'],['normal','Normal'],['flat','Flat'],['veryFlat','Very Flat']]} />
          </div>

          {/* Climate & Biome */}
          <div className="settings-group">
            <h3>Climate & Biome</h3>
            <SelectInput {...bind} id="temperature" label="Temperature:" field="temperature"
              options={[['frozen','Frozen World'],['cold','Cold'],['cool','Cool'],['normal','Normal'],['warm','Warm'],['hot','Hot'],['scorching','Scorching']]} />
            <SelectInput {...bind} id="rainfall" label="Rainfall:" field="rainfall"
              options={[['arid','Arid'],['dry','Dry'],['normal','Normal'],['wet','Wet'],['tropical','Tropical']]} />
            <SelectInput {...bind} id="polarIce" label="Polar Ice:" field="polarIce"
              options={[['none','None'],['minimal','Minimal'],['normal','Normal'],['extensive','Extensive'],['iceAge','Ice Age']]} />
            <SelectInput {...bind} id="desertFreq" label="Deserts:" field="desertFreq"
              options={[['none','None'],['few','Few'],['normal','Normal'],['many','Many'],['wasteland','Wasteland']]} />
            <RangeInput {...bind} id="forestDensity" label="Forests:" field="forestDensity" min={0} max={200} />
          </div>

          {/* Resources */}
          <div className="settings-group">
            <h3>Resources</h3>
            <SelectInput {...bind} id="resourceDensity" label="Resource Amount:" field="resourceDensity"
              options={[['scarce','Scarce'],['low','Low'],['normal','Normal'],['abundant','Abundant'],['rich','Rich']]} />
            <SelectInput {...bind} id="strategicRes" label="Strategic Res.:" field="strategicRes"
              options={[['scarce','Scarce'],['normal','Normal'],['abundant','Abundant']]} />
          </div>

          {/* Kingdoms & World */}
          <div className="settings-group">
            <h3>Kingdoms & World</h3>
            <RangeInput {...bind} id="kingdomCount" label="Kingdoms:" field="kingdomCount" min={2} max={20} />
            <div className="input-row">
              <label htmlFor="startYear">Start Year:</label>
              <input
                type="number"
                id="startYear"
                min={1}
                max={2000}
                value={settings.startYear}
                onChange={e => handleChange('startYear', Math.max(1, Math.min(2000, parseInt(e.target.value, 10) || 1)))}
              />
            </div>
            <div className="settings-hint" style={{ fontSize: '11px', opacity: 0.8, margin: '2px 0 8px' }}>
              {settings.startYear < DAWN_YEAR
                ? `🔥 The Dawn of Man: no towns, roads or crowns yet — wandering clans settle the land, villages rise, and chiefdoms grow into up to ${settings.kingdomCount} realms over the decades. You are born into one of the wandering clans, with your family about you.`
                : `The realms are long founded; the calendar begins in year ${settings.startYear}. Any year before ${DAWN_YEAR} starts at the Dawn of Man.`}
            </div>
            <SelectInput {...bind} id="independentSettlements" label="Independent Towns:" field="independentSettlements"
              options={[['none','None'],['few','Few'],['normal','Normal'],['many','Many']]} />
            <SelectInput {...bind} id="ruinsFreq" label="Ruins & POI:" field="ruinsFreq"
              options={[['none','None'],['few','Few'],['normal','Normal'],['many','Many']]} />
          </div>
        </div>

        {/* Advanced Settings */}
        <details className="advanced-settings">
          <summary>Advanced Generation Parameters</summary>
          <div className="settings-groups-container">
            <div className="settings-group">
              <h3>Noise Parameters</h3>
              <RangeInput {...bind} id="terrainOctaves" label="Terrain Detail:" field="terrainOctaves" min={2} max={10} />
              <RangeInput {...bind} id="heatFreq" label="Heat Variation:" field="heatFreq" min={1.0} max={6.0} step={0.1} />
              <RangeInput {...bind} id="moistFreq" label="Moisture Var.:" field="moistFreq" min={0.5} max={5.0} step={0.1} />
              <RangeInput {...bind} id="coastalDetail" label="Coast Detail:" field="coastalDetail" min={1} max={10} />
            </div>
            <div className="settings-group">
              <h3>Elevation Thresholds</h3>
              <RangeInput {...bind} id="deepWaterLevel" label="Deep Water:" field="deepWaterLevel" min={0.05} max={0.35} step={0.01} />
              <RangeInput {...bind} id="hillsLevel" label="Hills Threshold:" field="hillsLevel" min={0.45} max={0.75} step={0.01} />
              <RangeInput {...bind} id="mountainLevel" label="Mountain Threshold:" field="mountainLevel" min={0.55} max={0.90} step={0.01} />
              <RangeInput {...bind} id="snowPeakLevel" label="Snow Peak Level:" field="snowPeakLevel" min={0.75} max={0.98} step={0.01} />
            </div>
          </div>
        </details>

        <div className="settings-actions">
          <button className="title-btn" onClick={() => setPhase('title')}>Back</button>
          <button className="title-btn" onClick={handleRandomize}>🎲 Randomize</button>
          <button className="title-btn primary" onClick={handleStartGame}>Forge My Destiny</button>
        </div>
      </div>
    </div>
  );
}
