import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '../context/GameContext';

const MAP_PRESETS = {
  tiny:   { width: 60,  height: 40,  kingdoms: 3  },
  small:  { width: 80,  height: 55,  kingdoms: 4  },
  medium: { width: 120, height: 80,  kingdoms: 6  },
  large:  { width: 180, height: 120, kingdoms: 8  },
  huge:   { width: 250, height: 170, kingdoms: 12 },
  epic:   { width: 350, height: 240, kingdoms: 16 },
};

export default function SettingsScreen() {
  const { setPhase, setGameState } = useGame();
  const [preset, setPreset] = useState('medium');

  // Settings state
  const [settings, setSettings] = useState({
    charFirstName: '',
    charLastName: '',
    charGender: 'male',
    charAge: 20,
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

  const handleStartGame = useCallback(() => {
    // Store settings in game state for the Game class to read
    setGameState(prev => ({
      ...prev,
      phase: 'loading',
      settings: { ...settings },
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

  // Helper for range inputs
  const RangeInput = ({ id, label, field, min, max, step }) => (
    <div className="input-row">
      <label htmlFor={id}>{label}</label>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step || 1}
        value={settings[field]}
        onChange={e => handleChange(field, parseFloat(e.target.value))}
      />
      <span className="range-value">{settings[field]}</span>
    </div>
  );

  const SelectInput = ({ id, label, field, options }) => (
    <div className="input-row">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={settings[field]}
        onChange={e => handleChange(field, e.target.value)}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>{text}</option>
        ))}
      </select>
    </div>
  );

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
          {/* Character Settings */}
          <div className="settings-group">
            <h3>Character Profile</h3>
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
            <SelectInput id="charGender" label="Gender:" field="charGender"
              options={[['male','Male'],['female','Female'],['other','Other']]} />
            <div className="input-row">
              <label htmlFor="charAge">Age:</label>
              <input
                type="number"
                id="charAge"
                value={settings.charAge}
                min={16}
                max={60}
                onChange={e => handleChange('charAge', parseInt(e.target.value))}
              />
            </div>
          </div>

          {/* World Dimensions */}
          <div className="settings-group">
            <h3>World Dimensions</h3>
            <RangeInput id="worldWidth" label="Width:" field="worldWidth" min={40} max={500} />
            <RangeInput id="worldHeight" label="Height:" field="worldHeight" min={30} max={350} />
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
            <RangeInput id="continentCount" label="Continents:" field="continentCount" min={1} max={15} />
            <SelectInput id="continentSize" label="Continent Size:" field="continentSize"
              options={[['small','Small (many islands)'],['medium','Medium'],['large','Large (sprawling)'],['pangaea','Pangaea (one mass)']]} />
            <RangeInput id="islandFreq" label="Islands:" field="islandFreq" min={0} max={5} step={0.1} />
            <RangeInput id="landMass" label="Land Coverage:" field="landMass" min={15} max={85} />
          </div>

          {/* Water & Oceans */}
          <div className="settings-group">
            <h3>Water & Oceans</h3>
            <RangeInput id="waterLevel" label="Sea Level:" field="waterLevel" min={0.20} max={0.60} step={0.01} />
            <RangeInput id="riverCount" label="Rivers:" field="riverCount" min={0} max={200} />
            <SelectInput id="lakeFreq" label="Lakes:" field="lakeFreq"
              options={[['none','None'],['few','Few'],['normal','Normal'],['many','Many'],['abundant','Abundant']]} />
          </div>

          {/* Terrain & Elevation */}
          <div className="settings-group">
            <h3>Terrain & Elevation</h3>
            <RangeInput id="terrainFreq" label="Land Density:" field="terrainFreq" min={0.5} max={3.0} step={0.1} />
            <RangeInput id="mountainDensity" label="Mountains:" field="mountainDensity" min={0} max={200} />
            <RangeInput id="hillDensity" label="Hills:" field="hillDensity" min={0} max={200} />
            <SelectInput id="flatness" label="Flatness:" field="flatness"
              options={[['rugged','Rugged'],['normal','Normal'],['flat','Flat'],['veryFlat','Very Flat']]} />
          </div>

          {/* Climate & Biome */}
          <div className="settings-group">
            <h3>Climate & Biome</h3>
            <SelectInput id="temperature" label="Temperature:" field="temperature"
              options={[['frozen','Frozen World'],['cold','Cold'],['cool','Cool'],['normal','Normal'],['warm','Warm'],['hot','Hot'],['scorching','Scorching']]} />
            <SelectInput id="rainfall" label="Rainfall:" field="rainfall"
              options={[['arid','Arid'],['dry','Dry'],['normal','Normal'],['wet','Wet'],['tropical','Tropical']]} />
            <SelectInput id="polarIce" label="Polar Ice:" field="polarIce"
              options={[['none','None'],['minimal','Minimal'],['normal','Normal'],['extensive','Extensive'],['iceAge','Ice Age']]} />
            <SelectInput id="desertFreq" label="Deserts:" field="desertFreq"
              options={[['none','None'],['few','Few'],['normal','Normal'],['many','Many'],['wasteland','Wasteland']]} />
            <RangeInput id="forestDensity" label="Forests:" field="forestDensity" min={0} max={200} />
          </div>

          {/* Resources */}
          <div className="settings-group">
            <h3>Resources</h3>
            <SelectInput id="resourceDensity" label="Resource Amount:" field="resourceDensity"
              options={[['scarce','Scarce'],['low','Low'],['normal','Normal'],['abundant','Abundant'],['rich','Rich']]} />
            <SelectInput id="strategicRes" label="Strategic Res.:" field="strategicRes"
              options={[['scarce','Scarce'],['normal','Normal'],['abundant','Abundant']]} />
          </div>

          {/* Kingdoms & World */}
          <div className="settings-group">
            <h3>Kingdoms & World</h3>
            <RangeInput id="kingdomCount" label="Kingdoms:" field="kingdomCount" min={2} max={20} />
            <SelectInput id="independentSettlements" label="Independent Towns:" field="independentSettlements"
              options={[['none','None'],['few','Few'],['normal','Normal'],['many','Many']]} />
            <SelectInput id="ruinsFreq" label="Ruins & POI:" field="ruinsFreq"
              options={[['none','None'],['few','Few'],['normal','Normal'],['many','Many']]} />
          </div>
        </div>

        {/* Advanced Settings */}
        <details className="advanced-settings">
          <summary>Advanced Generation Parameters</summary>
          <div className="settings-groups-container">
            <div className="settings-group">
              <h3>Noise Parameters</h3>
              <RangeInput id="terrainOctaves" label="Terrain Detail:" field="terrainOctaves" min={2} max={10} />
              <RangeInput id="heatFreq" label="Heat Variation:" field="heatFreq" min={1.0} max={6.0} step={0.1} />
              <RangeInput id="moistFreq" label="Moisture Var.:" field="moistFreq" min={0.5} max={5.0} step={0.1} />
              <RangeInput id="coastalDetail" label="Coast Detail:" field="coastalDetail" min={1} max={10} />
            </div>
            <div className="settings-group">
              <h3>Elevation Thresholds</h3>
              <RangeInput id="deepWaterLevel" label="Deep Water:" field="deepWaterLevel" min={0.05} max={0.35} step={0.01} />
              <RangeInput id="hillsLevel" label="Hills Threshold:" field="hillsLevel" min={0.45} max={0.75} step={0.01} />
              <RangeInput id="mountainLevel" label="Mountain Threshold:" field="mountainLevel" min={0.55} max={0.90} step={0.01} />
              <RangeInput id="snowPeakLevel" label="Snow Peak Level:" field="snowPeakLevel" min={0.75} max={0.98} step={0.01} />
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
