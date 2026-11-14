import React from 'react';
import { useGame } from '../context/GameContext';
import Icon from './Icon';

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

        {/* ═══ Top tab nav ═══ — one home for every overview panel:
            Map (how the map is drawn) · Character (you: body, pack, party, kin, House, purse,
            property) · Realm (the lands and powers: diplomacy, settlements, council, laws,
            learning, faith, peoples) · Quests · Journal (what has happened: your story, the
            world's record, the days) · Counsel (what needs you now). Dropdowns are wired by
            ui/ui/hud.js setupCivDropdowns; each item by its id in setupEventListeners/_setupHudNav.
            Place-bound doings (trade here, hold court here…) live in the action menu instead. */}

        {/* MAP */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn hud-tab" id="civMapBtn" title="How the map is drawn">
            <span className="civ-menu-icon"><Icon name="compass" /></span>
            <span className="civ-menu-label">Map</span>
          </button>
          <div className="civ-dropdown" id="civMapDropdown">
            <div className="civ-dd-heading">Overlays</div>
            <button className="civ-dropdown-item" id="btnToggleResources">
              <span className="civ-dd-icon"><Icon name="gem" /></span>
              <span className="civ-dd-text">Resource Icons</span>
              <span className="civ-dd-toggle" id="resourceToggleState">OFF</span>
            </button>
            <button className="civ-dropdown-item" id="btnToggleBorders">
              <span className="civ-dd-icon"><Icon name="banner" /></span>
              <span className="civ-dd-text">Kingdom Borders</span>
              <span className="civ-dd-toggle" id="borderToggleState">OFF</span>
            </button>
            <div className="civ-dd-heading">Map Mode (M cycles)</div>
            <button className="civ-dropdown-item" data-map-mode="normal">
              <span className="civ-dd-icon"><Icon name="map" /></span>
              <span className="civ-dd-text">Terrain</span>
              <span className="civ-dd-toggle on">ON</span>
            </button>
            <button className="civ-dropdown-item" data-map-mode="political">
              <span className="civ-dd-icon"><Icon name="banner" /></span>
              <span className="civ-dd-text">Political</span>
              <span className="civ-dd-toggle"></span>
            </button>
            <button className="civ-dropdown-item" data-map-mode="religion">
              <span className="civ-dd-icon"><Icon name="chalice" /></span>
              <span className="civ-dd-text">Religion</span>
              <span className="civ-dd-toggle"></span>
            </button>
            <button className="civ-dropdown-item" data-map-mode="wealth">
              <span className="civ-dd-icon"><Icon name="coins" /></span>
              <span className="civ-dd-text">Wealth</span>
              <span className="civ-dd-toggle"></span>
            </button>
            <button className="civ-dropdown-item" data-map-mode="military">
              <span className="civ-dd-icon"><Icon name="swords" /></span>
              <span className="civ-dd-text">Military</span>
              <span className="civ-dd-toggle"></span>
            </button>
            <button className="civ-dropdown-item" data-map-mode="trade">
              <span className="civ-dd-icon"><Icon name="wagon" /></span>
              <span className="civ-dd-text">Trade Routes</span>
              <span className="civ-dd-toggle"></span>
            </button>
            <button className="civ-dropdown-item" data-map-mode="prices">
              <span className="civ-dd-icon"><Icon name="chart" /></span>
              <span className="civ-dd-text">Trade Map (G: next good)</span>
              <span className="civ-dd-toggle"></span>
            </button>
            <button className="civ-dropdown-item" data-map-mode="culture">
              <span className="civ-dd-icon"><Icon name="palette" /></span>
              <span className="civ-dd-text">Culture</span>
              <span className="civ-dd-toggle"></span>
            </button>
          </div>
        </div>

        {/* CHARACTER — you and what is yours (the tab keeps its old civEmpire* ids for its bindings) */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn hud-tab" id="civEmpireBtn" title="You, your company and what you own">
            <span className="civ-menu-icon"><Icon name="person" /></span>
            <span className="civ-menu-label">Character</span>
          </button>
          <div className="civ-dropdown" id="civEmpireDropdown">
            <div className="civ-dd-heading">Yourself</div>
            <button className="civ-dropdown-item" id="btnCharacter">
              <span className="civ-dd-icon"><Icon name="person" /></span>
              <span className="civ-dd-text">Character Sheet</span>
            </button>
            <button className="civ-dropdown-item" id="btnInventory" title="Inventory (I)">
              <span className="civ-dd-icon"><Icon name="satchel" /></span>
              <span className="civ-dd-text">Inventory</span>
              <kbd className="civ-dd-key">I</kbd>
            </button>
            <button className="civ-dropdown-item" id="btnTravelParty">
              <span className="civ-dd-icon"><Icon name="boot" /></span>
              <span className="civ-dd-text">Travel Party</span>
            </button>
            <button className="civ-dropdown-item" id="btnRelationships">
              <span className="civ-dd-icon"><Icon name="heart" /></span>
              <span className="civ-dd-text">Relationships</span>
            </button>
            <button className="civ-dropdown-item" id="btnHouse" title="Your House: Prestige, Ambition, kin and offices">
              <span className="civ-dd-icon"><Icon name="banner" /></span>
              <span className="civ-dd-text">Your House</span>
            </button>
            <div className="civ-dd-heading">Wealth</div>
            <button className="civ-dropdown-item" id="btnTreasury">
              <span className="civ-dd-icon"><Icon name="coins" /></span>
              <span className="civ-dd-text">Treasury &amp; Market</span>
            </button>
            <button className="civ-dropdown-item" id="btnProperties">
              <span className="civ-dd-icon"><Icon name="house" /></span>
              <span className="civ-dd-text">My Properties</span>
            </button>
          </div>
        </div>

        {/* REALM — the lands and the powers in them */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn hud-tab" id="civRealmBtn" title="The realms, their settlements, laws and faiths">
            <span className="civ-menu-icon"><Icon name="castle" /></span>
            <span className="civ-menu-label">Realm</span>
          </button>
          <div className="civ-dropdown" id="civRealmDropdown">
            <div className="civ-dd-heading">Powers</div>
            <button className="civ-dropdown-item" id="btnDiplomacy">
              <span className="civ-dd-icon"><Icon name="seal" /></span>
              <span className="civ-dd-text">Realms &amp; Diplomacy</span>
            </button>
            <button className="civ-dropdown-item" id="btnSettlements">
              <span className="civ-dd-icon"><Icon name="tower" /></span>
              <span className="civ-dd-text">Settlements</span>
            </button>
            <button className="civ-dropdown-item" id="btnCouncil">
              <span className="civ-dd-icon"><Icon name="council" /></span>
              <span className="civ-dd-text">Council</span>
            </button>
            <button className="civ-dropdown-item" id="btnLaws">
              <span className="civ-dd-icon"><Icon name="scales" /></span>
              <span className="civ-dd-text">Laws</span>
            </button>
            <div className="civ-dd-heading">Learning &amp; Belief</div>
            <button className="civ-dropdown-item" id="btnTechnology">
              <span className="civ-dd-icon"><Icon name="flask" /></span>
              <span className="civ-dd-text">Technology</span>
            </button>
            <button className="civ-dropdown-item" id="btnReligion">
              <span className="civ-dd-icon"><Icon name="chalice" /></span>
              <span className="civ-dd-text">Religion &amp; Culture</span>
            </button>
            <button className="civ-dropdown-item" id="btnPeoples">
              <span className="civ-dd-icon"><Icon name="temple" /></span>
              <span className="civ-dd-text">Peoples</span>
            </button>
            <div className="civ-dd-heading">Ledgers</div>
            <button className="civ-dropdown-item" id="btnEconomy" title="The realms&apos; prices, fashions and your worth">
              <span className="civ-dd-icon"><Icon name="ledger" /></span>
              <span className="civ-dd-text">Economic Chronicle</span>
            </button>
            <button className="civ-dropdown-item" id="btnTrends" title="Graphs of the realms&apos; wealth over time">
              <span className="civ-dd-icon"><Icon name="chart" /></span>
              <span className="civ-dd-text">Economic Trends</span>
            </button>
            <button className="civ-dropdown-item" id="btnCompare" title="The realms side by side">
              <span className="civ-dd-icon"><Icon name="scales" /></span>
              <span className="civ-dd-text">Kingdom Comparison</span>
            </button>
          </div>
        </div>

        {/* QUESTS (direct → showQuestsPanel via #navTabQuests) */}
        <button className="civ-menu-btn hud-tab" id="navTabQuests" title="Quest Journal">
          <span className="civ-menu-icon"><Icon name="pennant" /></span>
          <span className="civ-menu-label">Quests</span>
        </button>

        {/* JOURNAL — what has happened */}
        <div className="civ-menu-group">
          <button className="civ-menu-btn hud-tab" id="civJournalBtn" title="Letters, records and history">
            <span className="civ-menu-icon"><Icon name="book" /></span>
            <span className="civ-menu-label">Journal</span>
          </button>
          <div className="civ-dropdown" id="civJournalDropdown">
            <div className="civ-dd-heading">Your Story</div>
            <button className="civ-dropdown-item" id="btnLetters">
              <span className="civ-dd-icon"><Icon name="quill" /></span>
              <span className="civ-dd-text">Letters</span>
              <span id="lettersBadge" style={{display:'none', marginLeft:'6px', minWidth:'15px', padding:'0 4px', borderRadius:'8px', background:'#b7791f', color:'#fff', fontSize:'10px', fontWeight:'bold', lineHeight:'15px', textAlign:'center'}}></span>
            </button>
            <button className="civ-dropdown-item" id="btnPeople">
              <span className="civ-dd-icon"><Icon name="person" /></span>
              <span className="civ-dd-text">People You&apos;ve Known</span>
            </button>
            <button className="civ-dropdown-item" id="btnAnnals" title="Your life and dynasty told as a book">
              <span className="civ-dd-icon"><Icon name="book" /></span>
              <span className="civ-dd-text">The Annals</span>
            </button>
            <button className="civ-dropdown-item" id="btnSagas">
              <span className="civ-dd-icon"><Icon name="lyre" /></span>
              <span className="civ-dd-text">Sagas</span>
            </button>
            <button className="civ-dropdown-item" id="btnDeeds">
              <span className="civ-dd-icon"><Icon name="medal" /></span>
              <span className="civ-dd-text">Deeds &amp; Records</span>
            </button>
            <button className="civ-dropdown-item" id="btnReckoning" title="What your doings changed last season">
              <span className="civ-dd-icon"><Icon name="scales" /></span>
              <span className="civ-dd-text">Season&apos;s Reckoning</span>
            </button>
            <div className="civ-dd-heading">The World</div>
            <button className="civ-dropdown-item" id="btnHistory">
              <span className="civ-dd-icon"><Icon name="hourglass" /></span>
              <span className="civ-dd-text">History of the Peoples</span>
            </button>
            <button className="civ-dropdown-item" id="btnDynasties">
              <span className="civ-dd-icon"><Icon name="crown" /></span>
              <span className="civ-dd-text">Dynasties</span>
            </button>
            <button className="civ-dropdown-item" id="btnAlmanac" title="Every person, House, place, realm, war and age on record">
              <span className="civ-dd-icon"><Icon name="ledger" /></span>
              <span className="civ-dd-text">The Almanac</span>
            </button>
            <button className="civ-dropdown-item" id="btnTimeline">
              <span className="civ-dd-icon"><Icon name="map" /></span>
              <span className="civ-dd-text">Timeline of the Realm</span>
            </button>
            <button className="civ-dropdown-item" id="btnDiscoveries">
              <span className="civ-dd-icon"><Icon name="spyglass" /></span>
              <span className="civ-dd-text">Discoveries</span>
            </button>
            <button className="civ-dropdown-item" id="btnOutlaws">
              <span className="civ-dd-icon"><Icon name="fire" /></span>
              <span className="civ-dd-text">Outlaw Lairs</span>
            </button>
            <button className="civ-dropdown-item" id="btnIntel">
              <span className="civ-dd-icon"><Icon name="eye" /></span>
              <span className="civ-dd-text">Intel Journal</span>
            </button>
            <button className="civ-dropdown-item" id="btnWorldEvents" title="Major events across the realms">
              <span className="civ-dd-icon"><Icon name="storm" /></span>
              <span className="civ-dd-text">World Events</span>
            </button>
            <div className="civ-dd-heading">The Days</div>
            <button className="civ-dropdown-item" id="btnCalendar">
              <span className="civ-dd-icon"><Icon name="calendar" /></span>
              <span className="civ-dd-text">Calendar</span>
            </button>
            <button className="civ-dropdown-item" id="btnEventLog" title="Every notice you have been given (the bottom bar shows the latest)">
              <span className="civ-dd-icon"><Icon name="scroll" /></span>
              <span className="civ-dd-text">Activity Log</span>
            </button>
          </div>
        </div>

        {/* COUNSEL (direct → ActionMenu.showCounsel via #navTabCounsel; badge = threat count) */}
        <button className="civ-menu-btn hud-tab" id="navTabCounsel" title="The Steward's Counsel: what matters now" style={{position:'relative'}}>
          <span className="civ-menu-icon"><Icon name="key" /></span>
          <span className="civ-menu-label">Counsel</span>
          <span id="counselBadge" style={{display:'none', position:'absolute', top:'2px', right:'2px', minWidth:'15px', padding:'0 4px', borderRadius:'8px', background:'#b7791f', color:'#fff', fontSize:'10px', fontWeight:'bold', lineHeight:'15px', textAlign:'center'}}>0</span>
        </button>
      </div>

      <div id="topBarCenter">
        <span id="titleFlourish" className="title-flourish"><Icon name="crown" /></span>
        <span id="gameTitle">Lord of the Realms</span>
        {/* The date: opens the Calendar (bound in ui/ui/hud.js; text kept by HUD._topBarDate) */}
        <button type="button" id="turnDisplay" title="Open the Calendar">Day {turn.day} — {turn.season}, Year {turn.year}</button>
        {/* The day's action points, a plaque hung under the clock: count, pips, why in the
            tooltip (filled imperatively by ui/apChip.js updateAPChip, from the game loop) */}
        <span className="tb-ap" id="tbAP" role="status" style={{display:'none'}}>
          <span className="tb-ap-icon" aria-hidden="true">⚡</span>
          <span className="tb-ap-val" id="tbAPVal"></span>
          <span className="tb-ap-pips" id="tbAPPips" aria-hidden="true"></span>
        </span>
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
          <div className="tb-res tb-res-gold" id="tbGoldChip" title="Gold: click for your income and spending">
            <span className="tb-res-icon"><Icon name="coins" /></span>
            <span className="tb-res-col">
              <span className="tb-res-val" id="tbGold">0</span>
              <span className="tb-res-sub" id="tbIncome">+0/d</span>
            </span>
          </div>
          <div className="tb-res" title="Renown">
            <span className="tb-res-icon"><Icon name="star" /></span>
            <span className="tb-res-val" id="tbStars">0</span>
          </div>
          <div className="tb-res" title="Military Strength">
            <span className="tb-res-icon"><Icon name="shield" /></span>
            <span className="tb-res-val" id="tbShields">0</span>
          </div>
          {/* House Prestige — value, monthly trend, Ambition in the tooltip; opens the House
              panel (ui/prestigeChip.js fills it, hud.js _setupHudNav wires the click) */}
          <div className="tb-res tb-res-prestige" id="tbPrestige" role="button" tabIndex={0}
            title="House Prestige" style={{display:'none'}}>
            <span className="tb-res-icon"><Icon name="banner" /></span>
            <span className="tb-res-col">
              <span className="tb-res-val" id="tbPrestigeVal">0</span>
              <span className="tb-res-sub" id="tbPrestigeTrend">+0/mo</span>
            </span>
          </div>
        </div>

        <button className="tb-icon-btn" id="btnHelp" title="How to Play: where everything is, and the keys"><Icon name="help" /></button>
        <button className="tb-icon-btn civ-audio-btn" id="btnAudioToggle" title="Toggle Music">
          <span className="audio-icon"><Icon name="sound" /></span>
        </button>
        <button className="tb-icon-btn civ-settings-btn" id="btnSettings" title="Settings"><Icon name="gear" /></button>

        {/* Player portrait */}
        <div className="tb-portrait" id="tbPortrait" role="button" tabIndex={0} title="Character Sheet">🧑</div>

        {/* End Day hidden from top, now in bottom HUD */}
        <button className="civ-end-turn-btn" id="btnEndTurn" title="End Day" style={{display:'none'}}>
          <span className="civ-end-turn-label">End Day</span>
          <span className="civ-end-turn-icon">⏭️</span>
        </button>
      </div>
    </div>
  );
}
