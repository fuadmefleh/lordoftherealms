import React from 'react';
import { useGame } from '../context/GameContext';

export default function TopBar() {
  const { gameState } = useGame();
  const { playerStats, turn } = gameState;

  return (
    <div id="topBar">
      <div id="topBarLeft">
        {/* Hidden legacy stat items — kept so hud.js updateStats bindings stay alive.
            #goldValue/#karmaValue/#renownValue are read WITHOUT null-guards, so they
            must remain in the DOM (see hud.js updateStats). */}
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

        {/* ═══ Top tab nav ═══ (Map/Kingdom/Journal reuse the existing dropdown
            groups so their child bindings survive; Quests/Diplomacy are direct.) */}

        {/* MAP */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn hud-tab" id="civMapBtn" title="Map Options">
            <span className="civ-menu-icon">🧭</span>
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

        {/* KINGDOM (formerly Empire) */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn hud-tab" id="civEmpireBtn" title="Kingdom Overview">
            <span className="civ-menu-icon">🏰</span>
            <span className="civ-menu-label">Kingdom</span>
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
            <button className="civ-dropdown-item" id="btnProperties">
              <span className="civ-dd-icon">🏠</span>
              <span className="civ-dd-text">My Properties</span>
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

        {/* QUESTS (direct → showQuestsPanel via #navTabQuests) */}
        <button className="civ-menu-btn hud-tab" id="navTabQuests" title="Quest Journal">
          <span className="civ-menu-icon">⚔️</span>
          <span className="civ-menu-label">Quests</span>
        </button>

        {/* JOURNAL */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn hud-tab" id="civJournalBtn" title="Reports & History">
            <span className="civ-menu-icon">📖</span>
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
            <button className="civ-dropdown-item" id="btnSagas">
              <span className="civ-dd-icon">📜</span>
              <span className="civ-dd-text">Sagas</span>
            </button>
            <button className="civ-dropdown-item" id="btnDiscoveries">
              <span className="civ-dd-icon">🧭</span>
              <span className="civ-dd-text">Discoveries</span>
            </button>
            <button className="civ-dropdown-item" id="btnDeeds">
              <span className="civ-dd-icon">🏅</span>
              <span className="civ-dd-text">Deeds &amp; Records</span>
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

        {/* COUNSEL (direct → ActionMenu.showCounsel via #navTabCounsel; badge = threat count) */}
        <button className="civ-menu-btn hud-tab" id="navTabCounsel" title="The Steward's Counsel: what matters now" style={{position:'relative'}}>
          <span className="civ-menu-icon">🗝️</span>
          <span className="civ-menu-label">Counsel</span>
          <span id="counselBadge" style={{display:'none', position:'absolute', top:'2px', right:'2px', minWidth:'15px', padding:'0 4px', borderRadius:'8px', background:'#b7791f', color:'#fff', fontSize:'10px', fontWeight:'bold', lineHeight:'15px', textAlign:'center'}}>0</span>
        </button>

        {/* DIPLOMACY (direct → _showDiplomacyPanel via #navTabDiplomacy) */}
        <button className="civ-menu-btn hud-tab" id="navTabDiplomacy" title="Diplomacy">
          <span className="civ-menu-icon">🤝</span>
          <span className="civ-menu-label">Diplomacy</span>
        </button>
      </div>

      <div id="topBarCenter">
        <span id="titleFlourish" className="title-flourish">♛</span>
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

        {/* Resource counters */}
        <div className="tb-resources">
          <div className="tb-res tb-res-gold" title="Gold">
            <span className="tb-res-icon">💰</span>
            <span className="tb-res-col">
              <span className="tb-res-val" id="tbGold">0</span>
              <span className="tb-res-sub" id="tbIncome">+0/d</span>
            </span>
          </div>
          <div className="tb-res" title="Renown">
            <span className="tb-res-icon">⭐</span>
            <span className="tb-res-val" id="tbStars">0</span>
          </div>
          <div className="tb-res" title="Military Strength">
            <span className="tb-res-icon">🛡️</span>
            <span className="tb-res-val" id="tbShields">0</span>
          </div>
        </div>

        <button className="tb-icon-btn" id="btnHelp" title="How to Play">?</button>
        <button className="tb-icon-btn civ-audio-btn" id="btnAudioToggle" title="Toggle Music">
          <span className="audio-icon">🔊</span>
        </button>
        <button className="tb-icon-btn civ-settings-btn" id="btnSettings" title="Settings">⚙️</button>

        {/* Player portrait */}
        <div className="tb-portrait" id="tbPortrait" title="Character">🧑</div>

        {/* End Day hidden from top, now in bottom HUD */}
        <button className="civ-end-turn-btn" id="btnEndTurn" title="End Day" style={{display:'none'}}>
          <span className="civ-end-turn-label">End Day</span>
          <span className="civ-end-turn-icon">⏭️</span>
        </button>
      </div>
    </div>
  );
}
