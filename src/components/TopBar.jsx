import React from 'react';
import { useGame } from '../context/GameContext';

export default function TopBar() {
  const { gameState } = useGame();
  const { playerStats, turn } = gameState;

  return (
    <div id="topBar">
      <div id="topBarLeft">
        {/* Stats moved to bottom HUD — keep hidden DOM elements for compatibility */}
        <div className="stat-item" id="goldStat" style={{display:'none'}}>
          <span className="stat-value" id="goldValue">{playerStats.gold}</span>
        </div>
        <div className="stat-item" id="karmaStat" style={{display:'none'}}>
          <span className="stat-value" id="karmaValue">{playerStats.karma}</span>
        </div>
        <div className="stat-item" id="reputationStat" style={{display:'none'}}>
          <span className="stat-value" id="renownValue">{playerStats.renown}</span>
        </div>
        <div className="stat-item" id="movementStat" style={{display:'none'}}>
          <span className="stat-value" id="movementValue">{playerStats.movement}</span>
        </div>
        <div className="stat-item" id="apStat" style={{display:'none'}}>
          <span className="stat-value" id="apValue">{playerStats.actions}</span>
        </div>
        <div className="stat-item" id="foodStat" style={{display:'none'}}>
          <span className="stat-value" id="foodValue">{playerStats.food}</span>
        </div>
        <div className="stat-item" id="hpStat" style={{display:'none'}}>
          <span className="stat-value" id="hpValue">{playerStats.hp}</span>
        </div>

        {/* Menu buttons now in top-left */}
        {/* Map Menu */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn" id="civMapBtn" title="Map Options">
            <span className="civ-menu-icon">🗺️</span>
            <span className="civ-menu-label">Map</span>
          </button>
          <div className="civ-dropdown" id="civMapDropdown">
            <button className="civ-dropdown-item" id="btnToggleResources">
              <span className="civ-dd-icon">💎</span>
              <span className="civ-dd-text">Resource Icons</span>
              <span className="civ-dd-toggle" id="resourceToggleState">OFF</span>
            </button>
            <button className="civ-dropdown-item" id="btnToggleBorders">
              <span className="civ-dd-icon">🏰</span>
              <span className="civ-dd-text">Kingdom Borders</span>
              <span className="civ-dd-toggle" id="borderToggleState">OFF</span>
            </button>
            <div className="civ-dd-separator"></div>
            <button className="civ-dropdown-item" id="btnMapModes">
              <span className="civ-dd-icon">📊</span>
              <span className="civ-dd-text">Map Modes</span>
            </button>
          </div>
        </div>

        {/* Empire Menu */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn" id="civEmpireBtn" title="Empire Overview">
            <span className="civ-menu-icon">👑</span>
            <span className="civ-menu-label">Empire</span>
          </button>
          <div className="civ-dropdown" id="civEmpireDropdown">
            <button className="civ-dropdown-item" id="btnCharacter">
              <span className="civ-dd-icon">👤</span>
              <span className="civ-dd-text">Character</span>
            </button>
            <button className="civ-dropdown-item" id="btnInventory">
              <span className="civ-dd-icon">🎒</span>
              <span className="civ-dd-text">Inventory</span>
            </button>
            <button className="civ-dropdown-item" id="btnTreasury">
              <span className="civ-dd-icon">💰</span>
              <span className="civ-dd-text">Treasury & Market</span>
            </button>
            <div className="civ-dd-separator"></div>
            <button className="civ-dropdown-item" id="btnTechnology">
              <span className="civ-dd-icon">🔬</span>
              <span className="civ-dd-text">Technology</span>
            </button>
            <button className="civ-dropdown-item" id="btnReligion">
              <span className="civ-dd-icon">🙏</span>
              <span className="civ-dd-text">Religion & Culture</span>
            </button>
            <button className="civ-dropdown-item" id="btnPeoples">
              <span className="civ-dd-icon">🏛️</span>
              <span className="civ-dd-text">Peoples</span>
            </button>
            <button className="civ-dropdown-item" id="btnRelationships">
              <span className="civ-dd-icon">💕</span>
              <span className="civ-dd-text">Relationships</span>
            </button>
            <button className="civ-dropdown-item" id="btnTravelParty">
              <span className="civ-dd-icon">🧭</span>
              <span className="civ-dd-text">Travel Party</span>
            </button>
            <button className="civ-dropdown-item" id="btnCouncil">
              <span className="civ-dd-icon">🏛️</span>
              <span className="civ-dd-text">Council</span>
            </button>
          </div>
        </div>

        {/* Journal Menu */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn" id="civJournalBtn" title="Reports & History">
            <span className="civ-menu-icon">📜</span>
            <span className="civ-menu-label">Journal</span>
          </button>
          <div className="civ-dropdown" id="civJournalDropdown">
            <button className="civ-dropdown-item" id="btnQuests">
              <span className="civ-dd-icon">📜</span>
              <span className="civ-dd-text">Quests</span>
            </button>
            <button className="civ-dropdown-item" id="btnHistory">
              <span className="civ-dd-icon">🕰️</span>
              <span className="civ-dd-text">World History</span>
            </button>
            <button className="civ-dropdown-item" id="btnDynasties">
              <span className="civ-dd-icon">👑</span>
              <span className="civ-dd-text">Dynasties</span>
            </button>
            <button className="civ-dropdown-item" id="btnIntel">
              <span className="civ-dd-icon">📖</span>
              <span className="civ-dd-text">Intel Journal</span>
            </button>
            <div className="civ-dd-separator"></div>
            <button className="civ-dropdown-item" id="btnEventLog">
              <span className="civ-dd-icon">📋</span>
              <span className="civ-dd-text">Event Log</span>
            </button>
          </div>
        </div>
      </div>

      <div id="topBarCenter">
        <span id="gameTitle">Lord of the Realms</span>
        <span id="turnDisplay">Day {turn.day} — {turn.season}, Year {turn.year}</span>
      </div>

      <div id="topBarRight">
        {/* Old time controls — hidden, kept for JS binding */}
        <div className="sims-time-controls" id="simsTimeControls" style={{display:'none'}}>
          <button className="sims-time-btn" id="btnTimePause"><span>⏸</span></button>
          <button className="sims-time-btn active" id="btnTimePlay"><span>▶</span></button>
          <button className="sims-time-btn" id="btnTimeFast"><span>▶▶</span></button>
          <button className="sims-time-btn" id="btnTimeUltra"><span>▶▶▶</span></button>
        </div>

        <button className="civ-audio-btn" id="btnAudioToggle" title="Toggle Music">
          <span className="audio-icon">🔊</span>
        </button>
        <button className="civ-settings-btn" id="btnSettings" title="Settings">⚙️</button>

        {/* End Day hidden from top, now in bottom HUD */}
        <button className="civ-end-turn-btn" id="btnEndTurn" title="End Day" style={{display:'none'}}>
          <span className="civ-end-turn-label">End Day</span>
          <span className="civ-end-turn-icon">⏭️</span>
        </button>
      </div>
    </div>
  );
}
