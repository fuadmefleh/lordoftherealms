# Lord of the Realms

**Lord of the Realms** is a deep, hex-grid strategy game where you rise from a wanderer to a powerful ruler. Forge your legacy through trade, warfare, faith, and diplomacy in a procedurally generated world filled with rival kingdoms, dynamic economies, and ancient secrets.

![Game Version](https://img.shields.io/badge/version-0.3.0-blue)
![Platform](https://img.shields.io/badge/platform-Web-orange)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 🏰 Game Overview

You enter a world divided among **five rival kingdoms** — each with distinct cultures, rulers, and ambitions. Starting as a wanderer with nothing but a pouch of gold, you choose your own path to power:

- **💰 Economic Path** — Master regional trade, build properties, brew goods, run caravans, and amass a financial empire.
- **⚔️ Military Path** — Recruit armies of militia, soldiers, knights, and archers. Take mercenary contracts, conquer territory, and crush your rivals.
- **🙏 Religious Path** — Found your own religion, build temples and monasteries, perform miracles, and lead with divine authority.
- **🔬 Scholarly Path** — Research 25+ technologies across agriculture, industry, military, infrastructure, and commerce. Build labs and push the boundaries of knowledge.

<img width="2560" height="1077" alt="image" src="https://github.com/user-attachments/assets/7f3854a1-a8a6-428f-80e2-9ef42ed5f940" />


---

## 🗺️ Features

### World & Exploration
- **Procedural World Generation** — Unique continents with 20+ terrain types: mountains, forests, deserts, tundra, swamps, oceans, rivers, and more.
- **Dynamic Hex Grid** — Seamless east-west wrapping world on a custom hex-coordinate system with fog of war.
- **Configurable World Settings** — Adjust world size, continent count, terrain frequency, river density, and water level at game start.
- **Points of Interest** — Discover hidden treasures, ancient knowledge, and dangerous encounters.

### Economy & Trade
- **8 Property Types** — Farms, pastures, logging camps, mines, workshops, trading posts, fishing wharves, and breweries.
- **24+ Goods** — Raw resources (grain, fish, wood, wool, iron, gems, horses, spices) and crafted goods (bread, tools, weapons, textiles, beer, liquor, luxuries).
- **Crafting Recipes** — Transform raw materials into valuable products at workshops and breweries.
- **Trade Caravans** — Send goods between settlements, exploiting regional price differences.
- **Dynamic Markets** — Each settlement has its own supply, demand, and price history with fluctuating economies.
- **Banking System** — Take loans from royal banks with interest rates and repayment terms. Default at your peril.
- **Tax Collection** — Collect taxes from settlements you influence, with adjustable rates.
- **Finance Tracking** — Click your gold to view a detailed 90-day financial breakdown with income/expense charts and daily logs.

### Military & Combat
- **4 Unit Types** — Militia (cheap fodder), Soldiers (reliable backbone), Knights (elite cavalry), and Archers (ranged support).
- **Mercenary Contracts** — Take on paid military work at settlements.
- **Army Progression** — Units gain experience and level up through combat.
- **Indentured Servitude** — Defeated in battle? You may be captured and forced into servitude. Endure your sentence, attempt a daring escape, or buy your freedom.

### Religion & Faith
- **5 World Religions** — The Solar Covenant, Faith of the Tidemother, The Earthroot Communion, The Iron Creed, and Order of the Starseers.
- **Found Your Own Religion** — Create a faith with custom name and tenets (requires high karma).
- **Religious Buildings** — Shrines, temples, and monasteries generate faith and karma.
- **Miracles & Blessings** — Perform divine interventions and receive temporary blessings.
- **Pilgrimages** — Visit holy sites for gold, karma, and renown.

### Technology & Research
- **25+ Technologies** across 5 categories:
  - 🌾 **Agriculture** — Crop Rotation, Irrigation, Selective Breeding, Fertilization, Granaries
  - ⚙️ **Industry** — Improved Tools, Advanced Smelting, Water Mill, Steel Forging
  - 🗡️ **Military** — Basic Training, Archery Mastery, Cavalry Tactics, Siege Engineering
  - 🏗️ **Infrastructure** — Road Building, Paved Roads, Bridge Construction, Aqueducts
  - 📊 **Commerce** — Accounting, Trade Networks, Currency Minting, Banking Systems
- **Research Labs** — Build specialized labs at your properties to unlock tech categories.
- **Technology Parts** — Craft components needed to implement researched technologies.

### Infrastructure
- **Dirt & Stone Roads** — Reduce movement costs across your territory.
- **Bridges** — Negate river and swamp penalties.
- **Irrigation Channels** — Boost farm production yields.

### Kingdoms & Diplomacy
- **5 Unique Kingdoms** — Valdoria (Imperial/militaristic), Sylvaris (Woodland/peaceful), Kharzun (Nomadic/aggressive), Azurath (Religious/scholarly), Merathis (Maritime/mercantile).
- **Dynamic AI** — Kingdoms grow, wage wars, form alliances, and react to your influence.
- **Reputation System** — Build standing with each kingdom through actions and diplomacy.
- **Allegiance & Titles** — Pledge loyalty to a kingdom and rise through the ranks.
- **NPC Lords** — AI-driven lords with personality traits (Ambitious, Honorable, Cruel, Cunning, etc.) that drive their goals and behavior.
- **Royal Dynasties** — Rulers with traits, marriages, and succession lines.

### Culture & Society
- **Cultural Buildings** — Libraries, theaters, universities, and grand monuments that boost research, income, and influence.
- **5 Culture Groups** — Imperial, Woodland, Nomadic, Religious, and Maritime — each with unique naming conventions and dynasties.

### Tavern & Intelligence
- **Gather Intel** — Buy drinks for gossip, talk to merchants for market prices, ask about troop movements.
- **Hire Informants** — Permanent intelligence sources with daily upkeep and high reliability.
- **Notice Board** — Free job listings and local notices.
- **Sell Your Soul** — A dark, repeatable bargain: small gold at the cost of your karma and renown. The darkness grows with each deal...

### World Simulation
- **Dynamic Weather** — Noise-based weather patterns that move across the map.
- **World Events** — Wars, plagues, discoveries, golden ages, and disasters shape the world's history.
- **Map Units** — Trade caravans, raider bands, kingdom patrols, settlers, and ships roam the world.
- **Day/Season/Year Cycle** — Time advances with seasonal changes.

### Quests & Achievements
- **Multi-Category Quests** — Economic, military, religious, exploration, and diplomatic objectives with gold, karma, and renown rewards.
- **Tiered Achievements** — Bronze, silver, and gold tiers across wealth, military, religious, exploration, economic, and reputation categories.

### UI & Quality of Life
- **Minimap** — Clickable navigation overlay.
- **Smooth Camera** — Pan, zoom (0.55×–1.5×), and spacebar to center on player.
- **Contextual Action Menu** — Radial menu with available actions based on your location.
- **Hex Info Panel** — Click any tile for terrain, resource, and settlement details.
- **Kingdom Panel** — Double-click settlements for in-depth kingdom information.
- **Notification Toasts** — Stacked alerts for events, achievements, and quest completions.
- **Auto-Save** — Saves every 5 days with manual save/load and file export/import.

---

## 🚀 Getting Started

### Prerequisites

You need [Node.js](https://nodejs.org/) installed to run the development server.

### Running the Game

#### Windows
```bash
run.bat
```

#### macOS / Linux
```bash
chmod +x run.sh
./run.sh
```

Open your browser and navigate to `http://localhost:8081`.

---

## 📂 Project Structure

```
index.html                  Main entry point and UI
styles.css                  Game interface styling
package.json                Project metadata and scripts

data/                       Externalized game data (JSON)
  terrain.json              Terrain types, resources, biome table
  kingdoms.json             Kingdom defaults, city names, ruler names
  characters.json           Dynasty names, traits, events
  economy.json              Production rates, resource bonuses
  quests.json               Quest templates and rewards
  achievements.json         Tiered achievement definitions
  military.json             Unit types, contract types
  religion.json             Faiths, holy sites, miracles
  culture.json              Building types, traditions, events
  peoples.json              Tribal roots, evolution stages
  colonization.json         Indigenous tribes, policies
  cartography.json          Map quality tiers, map types
  infrastructure.json       Infrastructure types
  market.json               Tax rates, loan options
  tavern.json               Config, categories, reliability tiers
  npcLords.json             Personality traits
  kingdomAI.json            AI personalities
  worldEvents.json          Event categories
  technology.json           Research tree, techs, labs, parts
  playerEconomy.json        Property types, goods, recipes
  units.json                World unit types and stats
  assets.json               Sprite and tileset file paths

js/
  core/                     Core utilities and data loading
    utils.js                Shared utility functions
    hex.js                  Hex coordinate math
    dataLoader.js           JSON data loader and initializer

  world/                    World simulation and entities
    terrain.js              Terrain definitions and map generation
    kingdom.js              Kingdom territories, relations, wars
    economy.js              Settlement economies
    kingdomAI.js            Kingdom AI decision-making
    worldEvents.js          Historical events and effects
    characters.js           Dynasty generation and ruler traits
    npcLords.js             NPC lord personalities and goals
    weather.js              Dynamic weather simulation
    units.js                Map entities (caravans, patrols, ships)
    world.js                Procedural world generation
    colonization.js         Colonization mechanics

  systems/                  Game systems and mechanics
    religion.js             World religions and faith
    culture.js              Cultural buildings and influence
    peoples.js              Peoples and tribal mechanics
    technology.js           Research tree and tech implementation
    infrastructure.js       Roads, bridges, irrigation
    cartography.js          Map discovery and cartography
    quests.js               Quest objectives and rewards
    achievements.js         Tiered achievement tracking
    saveLoad.js             Save/load, auto-save, export/import
    marketDynamics.js       Supply/demand and price fluctuation

  player/                   Player state and actions
    player.js               Player state, stats, progression
    playerEconomy.js        Properties, goods, recipes, caravans
    playerMilitary.js       Army, combat, contracts, servitude
    playerReligion.js       Faith buildings, miracles, pilgrimages
    playerActions.js        Available actions and day processing
    tavern.js               Tavern interactions and intel

  ui/                       Rendering and user interface
    camera.js               Smooth panning and zoom
    renderer.js             Canvas-based hex grid rendering
    ui.js                   Panels, modals, stat displays
    actionMenu.js           Contextual action menu
    minimap.js              Minimap rendering and navigation
    game.js                 Game loop and initialization

tests/                      Automated test suite
  index.html                Test runner page (browser)
  testRunner.js             Lightweight test framework
  test.utils.js             Utils module tests
  test.hex.js               Hex math tests
  test.data.js              Data loading and JSON integrity tests
  test.terrain.js           Terrain generation tests
  test.kingdom.js           Kingdom module tests
  test.player.js            Player and economy tests
  test.systems.js           Game systems tests

assets/
  tiles/                    Terrain sprites, roads, coasts, rivers
```

---

## 🛠️ Development

This is a pure **vanilla JavaScript** project — no frameworks, no build step. Just HTML5 Canvas and raw JS.

### Architecture

- **Data-driven design** — All game constants, templates, and configuration are externalized into JSON files under `data/`. The `DataLoader` module loads and injects them at boot time.
- **Modular organization** — Code is organized into `core/`, `world/`, `systems/`, `player/`, and `ui/` folders by responsibility.
- **No build step required** — Scripts load via `<script>` tags in dependency order. Just serve and play.

### Running Tests

Open `tests/index.html` in the browser (via the dev server) or run:

```bash
npm test
```

This starts a local server and opens the test suite at `http://localhost:8082/tests/index.html`.

### Releases

This project uses an automated release pipeline. To create a new release:

1. Update the version in `package.json`
2. Create and push a git tag (e.g., `git tag v0.4.0 && git push origin v0.4.0`)
3. GitHub Actions will automatically build and publish the release

See [.github/RELEASE.md](.github/RELEASE.md) for detailed instructions.

### Current Version: v0.3.0

**Recent additions:**
- Finance tracking modal with income/expense breakdowns and gold-over-time charts
- Brewery properties with beer and liquor production
- Repeatable "Sell Your Soul" tavern action with escalating consequences
- Indentured servitude system on military defeat
- Kingdom starting military balancing
- Road bridge tile assets

---

*Rise from Nothing. Forge Your Legacy.*

