# Lord of the Realms — Gameplay Manual

> *Rise from Nothing. Forge Your Legacy.*

Welcome to **Lord of the Realms**, a deep hex-grid strategy game where you begin as a wandering nobody and carve your path to power through trade, warfare, faith, diplomacy, or any combination you choose. This manual covers every system in the game — from your first steps as a penniless wanderer to ruling a kingdom.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Core Mechanics](#2-core-mechanics)
3. [Movement & Exploration](#3-movement--exploration)
4. [Economy & Trade](#4-economy--trade)
5. [Properties & Production](#5-properties--production)
6. [Crafting](#6-crafting)
7. [Caravans & Trade Routes](#7-caravans--trade-routes)
8. [Housing](#8-housing)
9. [Military & Combat](#9-military--combat)
10. [Mercenary Contracts](#10-mercenary-contracts)
11. [Religion & Faith](#11-religion--faith)
12. [Technology & Research](#12-technology--research)
13. [Infrastructure](#13-infrastructure)
14. [Espionage](#14-espionage)
15. [Ships & Naval](#15-ships--naval)
16. [Kingdoms & Diplomacy](#16-kingdoms--diplomacy)
17. [Titles & Royal Office](#17-titles--royal-office)
18. [Relationships & Dynasty](#18-relationships--dynasty)
19. [Culture](#19-culture)
20. [Colonization](#20-colonization)
21. [Tavern & Intelligence](#21-tavern--intelligence)
22. [Quests](#22-quests)
23. [Achievements](#23-achievements)
24. [World Events](#24-world-events)
25. [Cartography](#25-cartography)
26. [Legendary Artifacts](#26-legendary-artifacts)
27. [Bounty Hunting](#27-bounty-hunting)
28. [Festivals & Tournaments](#28-festivals--tournaments)
29. [Saving & Loading](#29-saving--loading)
30. [Controls & UI](#30-controls--ui)
31. [Tips & Strategies](#31-tips--strategies)

---

## 1. Getting Started

### Your First Steps

You begin the game as a 20-year-old wanderer near the center of a procedurally generated world. You carry **10,000 gold** and **20 bread** — enough to survive your first weeks, but not enough to be comfortable for long.

### Starting Stats

| Stat | Value | Description |
|------|-------|-------------|
| Gold | 10,000 | Your currency for everything |
| Health | 100/100 | Reach 0 and you die |
| Stamina | 10/10 | Movement points per day |
| Action Points | 10/10 | Actions available per day |
| Karma | 0 | Moral standing; affects religion and reputation |
| Renown | 0 | Your fame across the world |
| Attributes | 5 each | Strength, Charisma, Intelligence, Faith, Luck |
| Skills | 1 each | Commerce, Combat, Leadership, Diplomacy, Stealth |

### Choosing Your Path

There is no class system — your path emerges from your actions. The four major paths are:

- **Economic** — Build properties, craft goods, run caravans, and dominate trade.
- **Military** — Recruit armies, take contracts, conquer settlements, and wage war.
- **Religious** — Found a faith, build temples, perform miracles, and convert the world.
- **Scholarly** — Research technologies, build labs, and push the boundaries of knowledge.

You can pursue any combination of these, and the game rewards versatility.

### World Setup

At game start, you configure:
- **World Size** — Determines the hex grid dimensions.
- **Continent Count** — Number of landmasses.
- **Terrain Frequency** — How varied the biomes are.
- **River Density** — Frequency of rivers.
- **Water Level** — Ratio of land to ocean.

The world wraps east-west, so you can circumnavigate the globe.

---

## 2. Core Mechanics

### The Day System

Time advances one day at a time. Each day you receive:
- **10 Action Points (AP)** — Spent on actions (trading, recruiting, building, etc.)
- **10 Stamina** — Spent on movement (each hex costs stamina equal to terrain difficulty)

At the end of each day:
1. Stamina and AP reset to maximum.
2. One food item is consumed (bread, fish, grain, or preserved fish — in priority order).
3. Health regenerates (+5 HP if fed, +2 bonus if resting at home).
4. All properties produce goods or income.
5. Army upkeep is deducted.
6. Active caravans advance.
7. Contracts, blessings, research, and other timers tick down.
8. Faith spreads from religious buildings.

### Food & Starvation

You consume 1 food per day. If you have no food:
- **Starvation days** begin accumulating.
- Health loss per day: 5 + (3 × starvation days) — this escalates quickly.
- Maximum stamina decreases (minimum 2).
- No health regeneration.

Always keep food in your inventory. Buy bread at settlements, catch fish near water, hunt in the wilderness, or produce grain from farms.

### Death & Succession

Your character has a natural lifespan of 55–85 years (randomized). After your maximum age, there is a 15% chance of death per year that increases over time. If you die with an heir aged 16+, you continue playing as your heir, who inherits 75% of your gold, 50% of your renown, and 30% of your reputation. Without an heir, the game ends.

You can also die in combat (health reduced to 0) or from starvation.

---

## 3. Movement & Exploration

### Terrain & Movement Costs

The world features 24 terrain types. Movement cost determines how much stamina each hex requires:

| Cost | Terrain Types |
|------|---------------|
| 2 (easy) | Plains, Grassland, Woodland, Beach, Tundra, Savanna |
| 3 (moderate) | Hills, Desert, Snow, Ice Sheet, Boreal Forest, Seasonal Forest, Temperate Rainforest, Island |
| 4 (difficult) | Tropical Rainforest, Swamp, Highlands |
| 5 (very hard) | Mountains |
| Impassable | Deep Ocean, Ocean, Coastal Waters, Sea, Lake, Snow Peak |

Roads reduce movement costs (see [Infrastructure](#13-infrastructure)).

### Pathfinding

Click any visible hex to set a destination. The game uses A* pathfinding to calculate the optimal route. If you run out of stamina mid-journey, movement continues automatically the next day.

### Fog of War

You can see 4 hexes in every direction. Tiles you've visited remain "explored" (showing terrain) but only tiles within your current visibility range are "visible" (showing units, settlements, and changes). Spies and technologies can extend your vision.

### Points of Interest

Unexplored tiles may contain points of interest (POIs) — ruins, caves, monuments, oases, and more. Use the **Explore POI** action to investigate them for treasure, knowledge, artifacts, or danger.

### Wilderness Actions

While in the wilderness, you can:

| Action | Requirements | Effect |
|--------|-------------|--------|
| Rest / Camp | Anywhere | End the day, recover stamina |
| Explore Area | Any explored tile | Search the inner map for hidden encounters |
| Meditate / Pray | Any passable tile | Restore health, gain karma (enhanced at holy sites) |
| Go Fishing | Near water | Catch fish for food or sale |
| Prospect | Hills, Highlands, Mountains | Search for mineral deposits |
| Tame Wild Horse | Plains/Grassland with horses | Capture a horse for faster travel |
| Build Campfire | 2+ wood in inventory | Extra health restoration |
| Forage | Most wilderness | Gather herbs, berries, materials |
| Hunt | Forest, Plains, Hills | Obtain meat and pelts |
| Clear Trees | Forest terrain | Gain wood, clear land for building |
| Terraform | Hills (no structures) | Flatten to grassland (costs gold + AP) |

---

## 4. Economy & Trade

### Trading at Settlements

Every settlement has a market where you can buy and sell goods. Prices vary by settlement type:

| Settlement Type | Buy Price Modifier | Sell Price |
|----------------|-------------------|-----------|
| Village | 1.2× base price | 70% of base |
| Town | 1.0× base price | 70% of base |
| City | 0.9× base price | 70% of base |
| Capital | 0.8× base price | 70% of base |

Prices are also affected by local supply and demand, terrain resources, and world events. Each trade earns +0.1 Commerce skill.

### Goods

The game features 26+ tradeable goods:

**Raw Materials:**

| Good | Base Price | Source |
|------|-----------|--------|
| Grain | 5g | Farms |
| Fish | 8g | Fishing Wharves, fishing |
| Wood | 8g | Logging Camps |
| Wool | 10g | Pastures |
| Stone | 8g | Mines (stone deposits) |
| Iron | 20g | Mines (iron deposits) |
| Gold Ore | 40g | Mines (gold deposits) |
| Gems | 60g | Mines (gem deposits) |
| Spices | 45g | Trade / tropical regions |
| Horses | 55g | Plains trade |

**Processed Goods:**

| Good | Base Price | Made From |
|------|-----------|-----------|
| Flour | 10g | Grain (milling) |
| Bread | 15g | Flour (baking) |
| Smoked Fish | 20g | Fish (smoking) |
| Firewood | 12g | Wood (splitting) |
| Textiles | 25g | Wool (weaving) |
| Clothes | 40g | Textiles (tailoring) |
| Tools | 35g | Iron (forging) |
| Weapons | 60g | Iron (forging) |
| Beer | 12g | Grain (brewing) |
| Liquor | 30g | Grain (distilling) |
| Luxuries | 100g | Gold Ore (refining) |

### Banking & Loans

You can take loans from royal banks at settlements:

| Loan | Amount | Interest | Repayment Period |
|------|--------|----------|-----------------|
| Small | 500g | 10% (pay back 550g) | 30 days |
| Medium | 2,000g | 15% (pay back 2,300g) | 60 days |
| Large | 5,000g | 20% (pay back 6,000g) | 90 days |

Failing to repay on time has severe consequences. The Merchant Guild tech reduces interest rates by 25%, and Banking Systems tech reduces them by another 20%.

### Tax Collection

If you hold the **Tax Collector** title or govern settlements, you can set tax rates:

| Tax Level | Rate | Effect on Happiness | Effect on Growth |
|-----------|------|--------------------|-----------------| 
| Very Low | 5% | +10 happiness | +5% growth |
| Low | 10% | +5 happiness | +2% growth |
| Moderate | 15% | No change | No change |
| High | 25% | −10 happiness | −5% growth |
| Very High | 40% | −20 happiness | −10% growth |

### Finance Tracking

Click your gold display to open a detailed 90-day financial breakdown showing income sources, expense categories, daily logs, and gold-over-time charts.

---

## 5. Properties & Production

Properties are the backbone of your economy. Build them on appropriate terrain to generate resources and gold.

### Property Types

| Property | Cost | Build Time | Produces | Upkeep | Required Terrain |
|----------|------|-----------|----------|--------|-----------------|
| Farm | 500g | 5 days | Grain (10/day) | 5g/day | Plains, Grassland |
| Pasture | 500g | 4 days | Wool (8/day) | 5g/day | Plains, Grassland, Hills |
| Logging Camp | 400g | 3 days | Wood (6/day) | 5g/day | Any forest terrain |
| Mine | 1,000g | 10 days | Tile resource (5/day) | 15g/day | Must have iron/gold/gems/stone |
| Workshop | 800g | 7 days | Crafted goods | 10g/day | Settlement required |
| Trading Post | 600g | 6 days | Attracts merchants | 5g/day | Settlement required |
| Fishing Wharf | 800g | 8 days | Fish | 10g/day | Coast or Beach |
| Brewery | 700g | 6 days | Beer / Liquor | 8g/day | Settlement required |
| Tavern | 900g | 8 days | Gold income | 12g/day | Settlement required |

### Production Bonuses

Base production is modified by several factors:
- **Property Level**: Each upgrade adds +10% production (max level 5).
- **Commerce Skill**: +5% per skill level.
- **Technology**: Various techs boost specific properties (e.g., Crop Rotation gives +20% to farms).
- **Terrain Bonus**: Logging Camps on timber tiles get +50%. Irrigation channels give +50% to farms.

### Upgrading Properties

Upgrade cost = base cost × 0.5 × (current level + 1). Each level adds +10% production. Maximum level is 5.

| Level | Farm Upgrade Cost | Production Bonus |
|-------|------------------|-----------------|
| 2 | 375g | +10% |
| 3 | 500g | +20% |
| 4 | 625g | +30% |
| 5 | 750g | +40% |

---

## 6. Crafting

Workshops and Breweries transform raw materials into higher-value processed goods.

### Crafting Recipes

| Recipe | Input | Output | Profit Potential |
|--------|-------|--------|-----------------|
| Split Firewood | 2 Wood | 5 Firewood | 16g → 60g |
| Mill Flour | 2 Grain | 2 Flour | 10g → 20g |
| Bake Bread | 1 Flour | 4 Bread | 10g → 60g |
| Smoke Fish | 2 Fish | 3 Smoked Fish | 16g → 60g |
| Weave Textiles | 3 Wool | 2 Textiles | 30g → 50g |
| Tailor Clothes | 1 Textiles | 2 Clothes | 25g → 80g |
| Forge Tools | 1 Iron | 2 Tools | 20g → 70g |
| Forge Weapons | 2 Iron | 1 Weapon | 40g → 60g |
| Refine Luxuries | 2 Gold Ore | 1 Luxury | 80g → 100g |
| Brew Beer | 3 Grain | 4 Beer | 15g → 48g |
| Distill Liquor | 5 Grain | 2 Liquor | 25g → 60g |

### Best Crafting Chains

The most profitable production chains are:
1. **Grain → Flour → Bread**: Farm produces grain at 5g each; mill into flour, bake into bread at 15g each.
2. **Wood → Firewood**: Simple 2-for-5 split with excellent margins.
3. **Wool → Textiles → Clothes**: Two-step chain, ending at 40g per piece.
4. **Iron → Tools**: Single-step, doubling your output at 35g each.

---

## 7. Caravans & Trade Routes

### One-Off Caravans

Dispatch a caravan to sell goods at a distant settlement for higher prices.

- **Cost**: 200g to dispatch.
- **Speed**: 2 tiles per day.
- **Max Distance**: 20 tiles.
- **Profit Formula**: Base price × (1 + distance × 0.05) × settlement multiplier.

Settlement multipliers: Village (0.8×), Town (1.0×), City (1.2×), Capital (1.5×).

Caravans appear as physical units on the map and can be raided by bandits or enemy forces.

### Persistent Trade Routes

Establish recurring routes for automated trade:

| Route Type | Creation Cost | Dispatch Cost | Notes |
|------------|--------------|---------------|-------|
| Legal | 280g | 120g/run | Safe, standard profits |
| Smuggling | 220g | 95g/run | Higher profit (×1.35), risk of arrest |

Routes auto-dispatch when goods are available, based on a configurable frequency.

**Route Upgrades:**
- **Protection** (5 levels): Reduces raiding risk. Cost: 180g + 90g per level.
- **Road Quality** (5 levels): Increases speed and profit. Cost: 200g + 100g per level.

**Prosperity**: Routes gain prosperity with each successful delivery (+4% profit per level, max level 6).

**Smuggling Risk**: Chance of being caught depends on distance, stealth skill, and protection level. Getting caught means confiscation of 35–55% of profits, fines, −2 karma, and −4 reputation.

---

## 8. Housing

Owning a home provides stat bonuses, a resting bonus, and social prestige.

### House Tiers

| Tier | Cost | Maintenance | Renown Required | Key Bonuses |
|------|------|------------|----------------|-------------|
| Humble Shack | 150g | 2g/day | 0 | +1 renown, +1 HP regen |
| Stone Cottage | 500g | 5g/day | 5 | +3 renown, +1 stamina, +2 HP regen |
| Townhouse | 1,200g | 12g/day | 15 | +6 renown, +1 stamina, +3 HP regen |
| Manor House | 3,500g | 30g/day | 35 | +12 renown, +2 stamina, +5 HP regen |
| Noble Estate | 8,000g | 65g/day | 60 | +25 renown, +3 stamina, +8 HP regen |

Higher tiers are only available in larger settlements (Townhouses require a Town, Estates require a Capital).

### House Upgrades

Each house tier has a number of upgrade slots (1 for Shacks, up to 5 for Estates):

| Upgrade | Cost | Effects | Minimum Tier |
|---------|------|---------|-------------|
| Herb Garden | 100g | +3 HP Regen | Any |
| Wine Cellar | 200g | +2 Renown, +1 Charisma | Cottage |
| Trophy Room | 250g | +3 Renown, +1 Strength | Cottage |
| Private Study | 350g | +1 Intelligence, +1 Commerce | Cottage |
| Personal Armory | 300g | +1 Strength, +1 Combat | Townhouse |
| Private Stable | 400g | +1 Movement | Townhouse |
| Servants' Quarters | 350g | −25% house maintenance | Manor |
| Private Chapel | 450g | +2 Faith, +1 Karma/day | Manor |
| Guest Quarters | 500g | +3 Reputation, +1 Diplomacy | Manor |
| Watchtower | 600g | +1 Visibility, +1 Leadership | Manor |
| Fortified Walls | 800g | +10 Defense, +4 Renown | Estate only |
| Great Hall | 1,000g | +8 Renown, +5 Reputation, +1 Charisma | Estate only |

---

## 9. Military & Combat

### Recruiting Units

Units are recruited at settlements. Available types depend on settlement size:

| Unit | Cost | Upkeep | Strength | Where to Recruit |
|------|------|--------|----------|-----------------|
| Militia | 50g | 2g/day | 5 | Any village+ |
| Archer | 80g | 4g/day | 8 | Town+ |
| Soldier | 100g | 5g/day | 10 | Town+ |
| Pikeman | 120g | 6g/day | 12 | Town+ (1,000 pop) |
| Knight | 300g | 15g/day | 30 | Capital (3,000 pop) |

Additional unit types unlock through technology research:

| Unit | Cost | Upkeep | Strength | Required Tech |
|------|------|--------|----------|--------------|
| Longbowman | 150g | 7g/day | 14 | Archery Mastery |
| Light Cavalry | 250g | 12g/day | 22 | Cavalry Tactics |
| Crossbowman | 180g | 9g/day | 18 | Crossbow |
| Heavy Cavalry | 400g | 18g/day | 35 | Heavy Cavalry |
| Siege Engine | 500g | 25g/day | 50 | Siege Engineering |

Recruitment capacity is limited to 1 unit per 50 population per day.

### Combat System

#### Formation & Counters

Units are classified into three roles for a **rock-paper-scissors** combat system:
- **Cavalry** (Knights, Light/Heavy Cavalry) beats **Archers**
- **Archers** (Archers, Longbowmen, Crossbowmen) beat **Pikemen**
- **Pikemen** (Pikemen, Soldiers, Militia) beat **Cavalry**

Counter advantage provides up to a ×1.25 multiplier; disadvantage reduces to ×0.8.

#### Terrain Bonuses

- **Hills / Highlands**: Archers gain up to +18% bonus.
- **Plains / Grassland**: Cavalry gains up to +18% bonus.

#### Morale

Morale affects combat power. It drops when you are outnumbered and rises with Leadership skill and festival bonuses. If outnumbered 1.8× or more, your army may **rout** — reducing your power to 55% while the enemy gains a 12% boost.

#### Combat Resolution

Each side's power is calculated as:

$$\text{Power} = \text{Strength} \times \text{random}(0.8, 1.2) \times \text{counterMult} \times \text{terrainMult} \times \text{morale}$$

- **Victory**: 5–15% casualties, loot (enemy strength × 2–5 gold), +5 XP per unit, +0.3 combat skill, renown gains.
- **Defeat**: 20–40% casualties. If your army is wiped out, 40% chance of **capture** leading to indentured servitude.

### Unit Progression

Units gain XP through combat (+5 XP per battle, +10 XP per contract). At 100 XP, units level up (max level 5), gaining a ×1.2 strength multiplier per level.

### Army Upkeep

Your army costs gold every day. If you can't afford upkeep, 10% of your non-mercenary units desert.

### Mercenary Companies

Five named mercenary companies roam the world:

| Company | Specialty | Hire Cost | Daily Wage | Contract Length |
|---------|-----------|-----------|------------|----------------|
| Red Lances | Cavalry | ~600g | ~90g/day | 8 days |
| Storm Arrows | Archers | ~550g | ~85g/day | 7 days |
| Black Pike Brotherhood | Pikemen | ~580g | ~88g/day | 9 days |
| Wolfguard Free Spears | Balanced | ~640g | ~95g/day | 6 days |
| Iron Oath Wardens | Elite Defenders | ~710g | ~105g/day | 12 days |

Mercenaries have a **loyalty** system (45–90 base). If you fail to pay them or their loyalty drops too low, they may switch sides and join a rival kingdom. Pay bonuses to keep loyalty high.

### Attacking Settlements

| Action | Min Strength | Risk | Rewards |
|--------|-------------|------|---------|
| Raid | 30 | Lower garrison defense | Plunder, −5 karma, −20 reputation |
| Conquer | 50 | Full garrison battle | Capture settlement, large plunder, −10 karma, −20+ reputation with all kingdoms |

Garrison strength scales with population, settlement tier, and walls.

### Indentured Servitude

If captured after defeat:
- Duration: 5–15 days. 30% of gold confiscated.
- **Endure**: Wait it out, gaining +0.05 commerce and +0.1 strength per day.
- **Escape**: 10% base + (stealth × 3%) chance. Failure adds 2–5 days and costs health.
- **Buy Freedom**: 200g + (enemy strength × 2).

---

## 10. Mercenary Contracts

Take military contracts at settlements for steady gold income:

| Contract | Payment | Duration | Min Strength | Risk |
|----------|---------|----------|-------------|------|
| Guard Duty | 100g | 3 days | 20 | 0% |
| Patrol Roads | 120g | 5 days | 25 | 15% |
| Escort Caravan | 150g | 4 days | 30 | 20% |
| Bandit Hunt | 200g | 5 days | 50 | 30% |
| Border Defense | 300g | 7 days | 60 | 35% |
| Ruin Clearance | 350g | 5 days | 40 | 35% |
| Rebel Suppression | 400g | 6 days | 75 | 40% |
| Siege Support | 500g | 10 days | 100 | 50% |
| Pirate Raid | 600g | 8 days | 70 | 45% |
| Monster Hunt | 800g | 7 days | 80 | 60% |
| Assassination | 1,000g | 3 days | 15 | 70% |

Risk represents the chance of taking casualties (10–30% of your army). Successful contracts grant +10 XP per unit and +0.5 combat skill.

---

## 11. Religion & Faith

### World Religions

The world has **11 active faiths**, each tied to a kingdom:

| Faith | Icon | Kingdom | Key Virtues |
|-------|------|---------|-------------|
| The Solar Covenant | ☀️ | Valdoria | Order, Justice, Light |
| Faith of the Tidemother | 🌊 | Merathis | Generosity, Exploration |
| The Earthroot Communion | 🌿 | Sylvaris | Harmony, Growth, Patience |
| The Iron Creed | ⚒️ | Durheim | Strength, Honour, Endurance |
| Order of the Starseers | ⭐ | Luminara | Wisdom, Prophecy, Charity |
| The Stoneheart Pact | ⛰️ | — | Endurance, Craftsmanship |
| The Serpent's Way | 🐍 | Miregloom | Cunning, Transformation |
| The Arcane Orthodoxy | 🔮 | Luminara | Knowledge, Discipline |
| Cult of the Stormfather | ⚡ | Frostmark | Courage, Freedom, Glory |
| The Dunewalker Creed | 🏜️ | Ashkari | Hospitality, Endurance |
| The Dreamweaver Circle | 🌙 | — | Vision, Creativity |

There are also **6 extinct faiths** that can be discovered through scholarly research and tavern inquiries.

### Founding Your Own Religion

- **Requirement**: 10+ karma.
- Choose a name and 3 tenets for your faith.
- Grants +2 Faith attribute (capped at 10).
- You can only found one religion per game.

### Religious Buildings

| Building | Cost | Build Time | Faith/Day | Influence Radius | Special |
|----------|------|-----------|-----------|-----------------|---------|
| Shrine | 300g | 3 days | 5 | 3 hexes | — |
| Temple | 1,000g | 12 days | 15 | 5 hexes | — |
| Monastery | 800g | 9 days | 10 | 4 hexes | +2 karma/day |
| Cathedral | 2,500g | 16 days | 30 | 8 hexes | +3 karma |
| Oracle Tower | 1,200g | 10 days | 12 | 6 hexes | +5 scholarship |
| Pilgrim Hospice | 600g | 5 days | 8 | 3 hexes | +30g income |
| Sacred Grove | 500g | 4 days | 7 | 4 hexes | +1 karma |
| Reliquary Vault | 1,500g | 12 days | 20 | 5 hexes | +1 renown/day |

### Faith Spreading

Religious buildings automatically convert nearby settlements at a rate of 1% × (1 + Faith × 0.1) of the population per day. As followers accumulate, your religious influence grows.

### Preaching

At any settlement, you can preach to gain followers:

$$\text{Followers} = \lfloor \text{population} \times 0.05 \times (1 + \text{charisma} \times 0.1 + \text{faith} \times 0.1) \rfloor$$

Each preaching session grants +0.2 Faith and +0.1 Charisma.

### Faith Income

Your religion generates passive income: 1 gold per 100 followers per day.

### Miracles

Spend karma to perform divine interventions:

| Miracle | Karma Cost | Effect |
|---------|-----------|--------|
| Divine Healing | 10 | Fully restore your health |
| Blessing of Prosperity | 15 | Double all income for 5 days |
| Divine Protection | 20 | Invulnerable for 3 days |
| Mass Conversion | 25 | Gain 1,000 followers instantly |
| Bountiful Harvest | 12 | Triple farm production for 3 days |
| Divine Smite | 30 | Massive damage to an enemy unit |
| Revelation | 18 | Reveal all tiles in a large radius |
| Holy Sanctuary | 22 | Create a no-combat zone for 5 days |
| Resurrection | 40 | Restore a destroyed military unit |
| Divine Plague | 35 | Enemy settlement loses 30% population |

### Pilgrimages

Travel to holy sites scattered across the world to receive gold, karma, and renown rewards. There are **12 types** of holy sites, from Sacred Springs to Grand Reliquaries.

### Heresies

Heresies can emerge within faiths, reducing unity and stability. There are 11 heresy types that spread at varying rates — some benefit scholarship at the cost of faith unity.

---

## 12. Technology & Research

### How Research Works

1. **Build a Lab** — Each lab type unlocks specific research categories (requires a matching property).
2. **Craft Research Parts** — Gather materials and craft the parts needed for each tech.
3. **Research** — Spend gold and time to unlock technologies.

### Lab Types

| Lab | Requires | Cost | Upkeep | Unlocks |
|-----|----------|------|--------|---------|
| Experimental Garden | Farm | 800g | 5g/day | Agriculture |
| Research Laboratory | Workshop | 1,500g | 10g/day | Industry, Military, Infrastructure |
| Trade Academy | Trading Post | 1,000g | 8g/day | Commerce |
| Naval Dockyard | Harbor | 1,800g | 12g/day | Naval |
| Academy of Learning | Library | 1,200g | 8g/day | Culture & Learning |
| Apothecary Laboratory | Apothecary | 1,000g | 7g/day | Medicine |

### Technology Tree Overview

The game has **40 technologies** across **8 categories**, organized in tiers with prerequisites:

#### Agriculture 🌾
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Crop Rotation | 1 | 100g | 5 | +20% farm production |
| Selective Breeding | 1 | 150g | 7 | +25% pasture production |
| Irrigation Systems | 2 | 200g | 8 | +30% farm production, unlocks Irrigated Farm |
| Granary Construction | 2 | 200g | 8 | +50% storage capacity |
| Advanced Fertilization | 3 | 300g | 10 | +40% farm production |

#### Industry ⚒️
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Improved Tools | 1 | 150g | 6 | +20% mine & logging output |
| Advanced Smelting | 2 | 200g | 8 | +25% mine production |
| Water Mill | 2 | 250g | 10 | +30% workshop output |
| Stonecutting | 2 | 200g | 7 | −15% building costs |
| Windmill | 2 | 200g | 8 | +15% farm production |
| Glassmaking | 2 | 200g | 7 | +10% trade profit |
| Steel Forging | 3 | 400g | 12 | +40% weapon crafting |
| Deep Mining | 3 | 350g | 12 | +35% mine production, 10% gem discovery chance |

#### Military ⚔️
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Basic Training | 1 | 100g | 5 | +10% unit strength |
| Archery Mastery | 2 | 200g | 8 | +30% archer strength, unlocks Longbowman |
| Cavalry Tactics | 2 | 250g | 10 | +25% knight strength, unlocks Light Cavalry |
| Crossbow | 2 | 250g | 8 | +25% ranged piercing, unlocks Crossbowman |
| Siege Engineering | 3 | 350g | 12 | Unlocks Siege Engine |
| Fortification | 3 | 300g | 10 | +30% defense, unlocks Watchtower |
| Heavy Cavalry | 3 | 350g | 12 | +35% cavalry strength, unlocks Heavy Cavalry |
| Plate Armor | 3 | 400g | 14 | +30% unit defense |

#### Infrastructure 🛤️
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Road Building | 1 | 150g | 6 | Unlocks Dirt Roads |
| Paved Roads | 2 | 300g | 10 | Unlocks Stone Roads |
| Bridge Construction | 2 | 250g | 8 | Unlocks Bridges |
| Cartography | 2 | 200g | 7 | +2 vision, +1 movement |
| Aqueducts | 3 | 400g | 14 | +30% settlement growth |

#### Commerce 💰
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Basic Accounting | 1 | 100g | 5 | +15% trade profit |
| Trade Networks | 2 | 200g | 8 | +25% caravan profit |
| Currency Minting | 2 | 250g | 10 | −10% trade prices, +15% property income |
| Merchant Guild | 3 | 350g | 12 | +20% trade profit, −25% loan interest |
| Banking Systems | 4 | 400g | 14 | +0.2% daily interest income |

#### Naval ⚓
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Shipbuilding | 1 | 200g | 8 | Unlocks Shipyard |
| Navigation | 2 | 250g | 10 | +3 naval range |
| Deep Sea Fishing | 2 | 150g | 6 | +40% fish production |
| Lighthouse | 2 | 250g | 8 | +20% port trade |
| Naval Warfare | 3 | 350g | 12 | +30% naval combat, unlocks Warship |

#### Medicine 💊
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Herbalism | 1 | 100g | 5 | +10% population growth |
| Surgery | 2 | 250g | 10 | −20% battle casualties |
| Plague Prevention | 2 | 300g | 10 | +40% plague resistance |
| Hospital | 3 | 400g | 14 | +25% population growth, unlocks Hospital |

#### Culture & Learning 📚
| Tech | Tier | Cost | Days | Effect |
|------|------|------|------|--------|
| Writing | 1 | 100g | 5 | +10% research speed |
| Philosophy | 2 | 200g | 8 | +15% stability, +20% culture |
| Espionage | 2 | 250g | 10 | +25% intrigue, unlocks spy recruitment |
| Diplomacy Mastery | 3 | 300g | 10 | +30% diplomacy |
| University | 3 | 400g | 14 | +30% research, unlocks University |
| Printing Press | 4 | 500g | 16 | +25% research, +30% culture |

---

## 13. Infrastructure

Build roads, bridges, and irrigation to improve your territory. Requires relevant technologies.

| Structure | Cost | Build Time | Required Tech | Effect |
|-----------|------|-----------|---------------|--------|
| Dirt Road | 30g | 2 days | Road Building | Halves terrain movement cost |
| Stone Road | 80g | 4 days | Paved Roads | Reduces movement cost to 1 |
| Bridge | 150g | 6 days | Bridge Construction | Eliminates river/swamp penalty (cost = 1) |
| Irrigation Channel | 60g | 3 days | Irrigation Systems | +50% farm productivity |

Roads dramatically speed up travel and trade. Stone roads make every hex cost just 1 stamina — connect your properties and trade destinations for maximum efficiency.

---

## 14. Espionage

Requires the **Espionage** technology from the Culture & Learning tree.

### Recruiting Spies

- **Cost**: 300g to recruit, 15g/day upkeep.
- **Max Spies**: 8.
- **Spy Skills**: Infiltration, Sabotage, Intelligence Gathering, Combat.
- Each spy has a randomly assigned **trait** (e.g., Master of Disguise, Silver Tongue, Ruthless) that modifies their capabilities.

### Spy Levels

Spies gain XP from missions and level up (max level 5):
1. Novice Agent → 2. Field Operative → 3. Shadow Agent → 4. Master Spy → 5. Spymaster Elite

### Missions

| Mission | Cost | Min Level | Duration | Fail % | Key Effect |
|---------|------|-----------|----------|--------|-----------|
| Gather Intel | 50g | 1 | 5 days | 15% | 3 rumors + kingdom knowledge |
| Infiltrate Territory | 100g | 1 | 7 days | 20% | Reveal fog of war (radius 4, 30 days) |
| Counter-Espionage | 75g | 1 | 20 days | 10% | +30% detection against enemy spies |
| Steal Technology | 200g | 2 | 12 days | 30% | Copy a tech from another kingdom |
| Sabotage Operations | 250g | 2 | 10 days | 25% | 10% treasury drain + 15% production penalty |
| Incite Rebellion | 350g | 3 | 15 days | 35% | 15% treasury, uprising in target kingdom |
| Assassination | 500g | 4 | 8 days | 40% | Kill a key figure; −75 diplomacy, −25 karma |

Failed missions risk spy capture (5–30% depending on mission). Captured spies are lost permanently.

### Loyalty

Spy loyalty starts at 45–90 and decays at 0.1/day. Below 20 loyalty, there is a risk of betrayal. Pay bonuses or complete successful missions to maintain loyalty.

---

## 15. Ships & Naval

### Ship Types

| Ship | Cost | Speed | Cargo | Combat | Build Days | Available |
|------|------|-------|-------|--------|-----------|-----------|
| Rowboat | 200g | 2 | 5 | 2 | 3 | Village+ |
| Fishing Vessel | 400g | 3 | 10 | 3 | 5 | Village+ |
| Sloop | 800g | 5 | 15 | 8 | 10 | Town+ |
| Trading Cog | 1,500g | 3 | 40 | 6 | 18 | Town+ |
| Caravel | 2,500g | 6 | 20 | 12 | 25 | Capital |
| War Galley | 3,000g | 5 | 10 | 25 | 30 | Capital |
| Galleon | 6,000g | 4 | 60 | 35 | 45 | Capital |

### Ship Customizations

12 upgrades available including Reinforced Hull (+3 armor), Extra Sails (+2 speed), Expanded Cargo (+15 cargo), Deck Ballista (+8 combat), Greek Fire Siphon (+12 combat), and Navigator's Quarters (+3 exploration). Costs range from 50g to 800g.

### Naval Travel

Board your ship at coastal settlements to traverse oceans. Sea movement costs 2 stamina per tile. Random exploration events can occur at sea: floating cargo, uncharted islands, sea monsters, pirate ambushes, and more.

### Ship Trading

A used ship market exists at settlements with variable condition (40–85%) and discounted prices.

---

## 16. Kingdoms & Diplomacy

### The World's Kingdoms

The game features **10 kingdoms**, each with unique culture, traits, and territory preferences:

| Kingdom | Culture | Traits | Preferred Terrain |
|---------|---------|--------|------------------|
| Kingdom of Valdoria | Imperial | Militaristic, Orderly | Plains, Grassland |
| Kingdom of Sylvaris | Woodland | Peaceful, Nature-loving | Forests |
| Khanate of Kharzun | Nomadic | Aggressive, Mobile | Plains, Desert |
| Theocracy of Azurath | Religious | Religious, Scholarly | Desert, Hills |
| Republic of Merathis | Maritime | Mercantile, Naval | Coast |
| Holds of Durheim | Mountain | Defensive, Industrious | Mountains, Hills |
| Dominion of Miregloom | Swamp | Secretive, Alchemical | Swamp, Wetland |
| Conclave of Luminara | Arcane | Scholarly, Arcane | Hills, Plains |
| Jarldom of Frostmark | Nordic | Aggressive, Seafaring | Tundra, Coast |
| Sultanate of Ashkari | Desert | Mercantile, Resilient | Desert, Savanna |

### Reputation

Your reputation with each kingdom ranges from very hostile to allied. It changes based on your actions:
- **Positive**: Completing contracts, donating to the poor, diplomatic actions, quests.
- **Negative**: Raiding settlements, conquest, smuggling (if caught), assassination.

### Allegiance

You can **Pledge Allegiance** to any kingdom at their capital, becoming a citizen. This opens access to titles, tax collection, and royal offices. You can only be allegiant to one kingdom at a time. **Renounce Allegiance** to become a free agent again (costs reputation).

### Kingdom AI

Kingdoms are run by AI with distinct personalities. They:
- Expand territory and found new settlements.
- Wage wars against rivals.
- Form and break alliances.
- React to your influence and actions.
- Have rulers with 30+ possible traits affecting their behavior (Brilliant Strategist, Cruel, Ambitious, etc.).

### NPC Lords

AI-driven lords roam the world with personality traits (Ambitious, Honorable, Cruel, Cunning) that drive their decisions. You can encounter them on the map and request meetings.

---

## 17. Titles & Royal Office

After pledging allegiance to a kingdom, you can seek appointment to royal offices:

| Title | Rank | Salary | Key Requirements | Duty |
|-------|------|--------|------------------|------|
| Royal Cartographer | Official | 20g/day | Cartography 3, INT 5, 5 renown | Survey 20 tiles/month |
| Tax Collector | Official | 20g/day | Commerce 3, 15 rep, 5 renown | Visit 3 settlements/month |
| Jailer | Official | 15g/day | Combat 3, 10 rep, 3 renown | Capture 1 fugitive/month |
| Court Chaplain | Official | 20g/day | Faith 5, 15 rep, 8 renown | Bless 2 settlements/month |
| Trade Envoy | Official | 25g/day | Commerce 4, Diplomacy 3, CHA 5 | 2 trade missions/month |
| Marshal | Lord | 35g/day | Combat 5, Leadership 3, STR 6 | 4 patrols/month |
| Spymaster | Lord | 30g/day | Stealth 5, Diplomacy 3, INT 6 | 2 intel reports/month |
| Chancellor | Chancellor | 60g/day | Diplomacy 6, Leadership 5, 30 renown | Hold court monthly |

Each title comes with unique perks — the Tax Collector earns 15–40g per collection, the Marshal gets −15% military costs, and the Chancellor receives +25% salary bonuses on all other titles.

Failing to fulfill your duties risks demotion.

---

## 18. Relationships & Dynasty

### Social Interactions

You can build relationships with NPCs through social actions:

| Action | Cost | Effect |
|--------|------|--------|
| Befriend | Free | Build friendship (+relationship) |
| Share Meal | 10g | Bond over food (+relationship) |
| Tell Stories | Free | Share tales (+relationship) |
| Train Together | Free | Mutual combat training |
| Confide Secret | Free | Deepen trust (risky) |
| Blood Oath | 40g | Permanent bond (requires best friend) |
| Insult | Free | Damage relationship |
| Challenge to Duel | Free | Test of combat |

### Relationship Tiers

| Tier | Score Range |
|------|------------|
| Nemesis | −60 to −100 |
| Rival | −30 to −59 |
| Acquaintance | 10 to 29 |
| Friend | 30 to 59 |
| Close Friend | 60 to 89 |
| Best Friend | 90 to 100 |

### Courtship & Marriage

Romance follows 6 stages: **Strangers → Interested → Flirting → Courting → Betrothed → Married**.

Key romantic actions:

| Action | Stage Required | Cost | Affection Gain |
|--------|---------------|------|----------------|
| Chat | Strangers | Free | 1–4 |
| Compliment | Strangers | Free | 2–6 |
| Gift | Interested | 25g | 5–12 |
| Serenade | Flirting | Free | 4–10 |
| Romantic Dinner | Courting | 50g | 8–15 |
| Propose | Courting (70+ affection) | 100g | 15–25 |

**Marriage benefits**: +1 stamina, +10 happiness, +5 reputation, +3 renown, and an alliance with your spouse's kingdom.

### Children & Heirs

- Children can be born each year (25% probability).
- Each child receives a random trait: Gifted (+1 all), Strong (+2 STR), Clever (+2 INT), Charming (+2 CHA), and others.
- Maximum 6 children. Designate one as your **heir**.
- Heirs become playable at age 16 if you die, inheriting 75% gold, 50% renown, and 30% reputation.

---

## 19. Culture

### Cultural Buildings

| Building | Cost | Build Time | Effect |
|----------|------|-----------|--------|
| Scriptorium | 400g | 4 days | +10% research, 10g income |
| Library | 600g | 6 days | +15% research, 15g income |
| Theater | 800g | 8 days | +10 morale, 25g income |
| Monument | 1,000g | 10 days | +1 renown/day, 20g income |
| University | 1,500g | 14 days | +30% research, 40g income (requires 1,000 pop) |

### Cultural Traditions

Each kingdom's culture provides distinct bonuses:
- **Imperial**: +military, +diplomacy, +trade
- **Woodland**: +nature, +stealth, +archery
- **Nomadic**: +cavalry, +endurance, +raiding
- **Maritime**: +trade, +navigation
- **Mountain**: +mining, +defense, +craftsmanship
- **Nordic**: +naval, +raiding, +endurance
- **Desert**: +trade, +endurance, +hospitality
- **Swamp**: +alchemy, +stealth, +poison
- **Arcane**: +scholarship, +research, +magic

### Cultural Events

13 event types can occur, including Grand Festivals, Gladiatorial Games, Philosophical Debates, Art Exhibitions, and more — each providing morale, research, or renown bonuses.

---

## 20. Colonization

### Founding Colonies

You can found colonies on unclaimed wilderness (costs gold). Recruit settlers from other settlements to grow your colony's population.

### Indigenous Tribes

7 indigenous groups inhabit the world, each with different hostility and tradeability levels:

| Tribe | Terrain | Hostility | Trade Openness |
|-------|---------|-----------|---------------|
| Forest Folk | Forests | Low-Medium | High |
| Steppe Riders | Plains, Savanna | Medium | Medium |
| Mountain Clans | Mountains, Hills | Medium | Low |
| Desert Nomads | Deserts | Low | Very High |
| Swamp Dwellers | Swamps | High | Very Low |
| Coastal Tribes | Coast, Beach | Very Low | Very High |
| Tundra People | Tundra, Snow | Low | Low |

### Colonization Policies

| Policy | Expansion | Indigenous Relations | Loyalty | Production |
|--------|-----------|---------------------|---------|-----------|
| Manifest Destiny | 1.5× | Very Negative | +5% | +10% |
| Coexistence | 0.8× | Very Positive | +15% | No bonus |
| Exploitation | 1.0× | Very Negative | −10% | +30% |
| Missionary | 1.0× | Slightly Positive | +10% | +5% |

---

## 21. Tavern & Intelligence

Visit taverns in cities and settlements to gather intelligence, hire informants, and more.

### Tavern Actions

| Action | Cost | Effect |
|--------|------|--------|
| Buy Drinks | 5g | 1–3 random rumors (55% accuracy) |
| Talk to Merchants | 10g | Prices for 3–5 goods at 2–4 nearby settlements (85% accuracy) |
| Ask about Characters | 50g | Intel on 2–3 nearest rulers (70% accuracy) |
| Ask about Military | 50g | War reports, army estimates (cities only, 70% accuracy) |
| Ask about Sacred Places | 50g | Discover 1–3 holy sites (70% accuracy) |
| Hire Informant | 200g + 10g/day | Permanent source in this city (95% accuracy) |
| Check Notice Board | Free | Kingdom decrees, settlement stats, bounties |
| Browse Maps | Free | Open cartography trade panel |
| Sell Your Soul | Free | 5–10g gold; costs escalating karma and renown |

### Intelligence Reliability

| Source | Accuracy | How |
|--------|----------|-----|
| Tavern Gossip | 55% | Buying drinks |
| Local Talk | 70% | Bribing, notice board |
| Merchant Report | 85% | Merchant conversations |
| Informant | 95% | Hired informants |

Unreliable intel may report distorted prices, wrong locations, or false military estimates. Cross-reference multiple sources for confidence.

### Informants

Informants stationed in a city generate high-accuracy intel every 3 days — trade prices, political intel, and military reports. If you stop paying their 10g/day upkeep, they leave permanently.

### Rumor Management

- Maximum 40 rumors stored. Oldest are dropped when full.
- Intel decays after 30 days and is removed as stale.
- Freshness: **Fresh** (≤1 day) → **Recent** (≤7) → **Aging** (≤15) → **Stale** (>15).

### Sell Your Soul

A dark, repeatable tavern action: earn a small amount of gold (5–10g) at the cost of karma and renown. The penalties escalate with each deal — karma loss increases by 1 per 5 deals, renown loss by 1 per 3 deals. Flavor text becomes increasingly ominous over 30+ deals.

---

## 22. Quests

The game features **37 quest templates** across 5 categories with 4 difficulty tiers (Easy, Medium, Hard, Legendary).

### Economic Quests (10)

| Quest | Difficulty | Objective | Reward |
|-------|-----------|-----------|--------|
| Merchant Apprentice | Easy | Earn 1,000 gold | 500g, 10 renown |
| Trade Empire | Medium | Own 5 properties | 2,000g, 25 renown |
| Caravan Master | Medium | Complete 10 caravans | 1,500g, 20 renown |
| Scholar | Medium | Research 5 technologies | 1,500g, 20 renown |
| Master Architect | Medium | Build 10 buildings | 3,000g, 30 renown |
| Market Manipulator | Medium | Earn 5,000g in trade profit | 2,000g, 20 renown |
| Road Builder | Medium | Build 20 road segments | 1,000g, 15 renown |
| Gold Hoarder | Hard | Accumulate 25,000 gold | 5,000g, 40 renown |
| The Silk Road | Hard | Complete 25 caravans + 10,000g | 5,000g, 35 renown |
| Real Estate Magnate | Hard | Own 15 properties | 8,000g, 50 renown |

### Military Quests (9)

| Quest | Difficulty | Objective | Reward |
|-------|-----------|-----------|--------|
| First Blood | Easy | Recruit your first unit | 200g, 5 renown |
| Battle Hardened | Easy | Win 5 battles | 800g, 15 renown |
| Mercenary Captain | Medium | Complete 5 contracts | 1,000g, 30 renown |
| Bandit Slayer | Medium | Defeat 10 raider bands | 1,200g, 20 renown |
| Warlord | Hard | Reach 200 army strength | 3,000g, 50 renown |
| Conqueror | Hard | Capture 3 settlements | 5,000g, 60 renown |
| Siege Master | Hard | 10 contracts + 100 army strength | 3,000g, 40 renown |
| Iron Legion | **Legendary** | 500 army strength + 20 units | 10,000g, 80 renown |
| Dragon Hunter | **Legendary** | Defeat a legendary creature | 8,000g, 75 renown |

### Religious Quests (8)

| Quest | Difficulty | Objective | Reward |
|-------|-----------|-----------|--------|
| Faithful Servant | Easy | Reach 20 karma | 500g, 5 karma |
| Temple Builder | Medium | Build 3 religious buildings | 1,500g, 10 karma |
| Miracle Worker | Medium | Perform 5 miracles | 1,000g, 15 karma |
| The Great Pilgrimage | Medium | Visit 5 holy sites | 2,000g, 20 karma, 25 renown |
| Prophet | Hard | Found a religion + 1,000 followers | 2,000g, 20 karma, 40 renown |
| Holy Crusader | Hard | Win 10 battles + 30 karma | 3,000g, 15 karma, 35 renown |
| Heresy Hunter | Hard | Suppress 3 heresies | 2,500g, 10 karma, 30 renown |
| Divine Mandate | **Legendary** | 5,000 followers + 10 temples + 50 karma | 15,000g, 30 karma, 100 renown |

### Exploration Quests (7)

| Quest | Difficulty | Objective | Reward |
|-------|-----------|-----------|--------|
| Wanderer | Easy | Explore 100 tiles | 300g, 10 renown |
| Tavern Regular | Easy | Visit 10 taverns | 500g, 10 renown |
| World Traveler | Medium | Visit 10 settlements | 800g, 20 renown |
| Ruins Explorer | Medium | Explore 5 ruins | 2,000g, 20 renown |
| Mountain Climber | Medium | Explore 30 mountain tiles | 1,000g, 15 renown |
| Cartographer's Dream | Hard | Explore 500 tiles | 3,000g, 40 renown |
| Treasure Hunter | Hard | Find 10 treasures | 5,000g, 30 renown |

### Diplomatic Quests (6)

| Quest | Difficulty | Objective | Reward |
|-------|-----------|-----------|--------|
| Spy Network | Medium | 5 informants + visit 15 settlements | 2,000g, 25 renown |
| Peacemaker | Medium | +50 rep with 3 kingdoms | 1,000g, 25 renown |
| People's Champion | Medium | Complete 10 quests | 2,000g, 30 renown, 10 karma |
| Diplomat | Hard | +50 rep with 5 kingdoms | 3,000g, 40 renown |
| Renowned | Hard | Reach 100 renown | 5,000g |
| Alliance Broker | Hard | Form 3 alliances | 4,000g, 45 renown |
| Kingmaker | **Legendary** | 200 renown + +80 rep with 3 kingdoms | 10,000g, 50 renown |

---

## 23. Achievements

The game tracks **41 achievements** across multiple categories with Bronze, Silver, and Gold tiers:

### Selected Achievements

| Achievement | Tier | Requirement |
|-------------|------|-------------|
| First Fortune | Bronze | Accumulate 1,000 gold |
| Wealthy | Silver | Accumulate 10,000 gold |
| Tycoon | Gold | Accumulate 50,000 gold |
| Recruit | Bronze | Recruit your first unit |
| Commander | Silver | Have 10 units |
| General | Gold | Reach 500+ army strength |
| Believer | Bronze | Reach 10 karma |
| Holy | Silver | Found a religion |
| Divine | Gold | Gain 10,000 followers |
| Explorer | Bronze | Explore 100 tiles |
| Cartographer | Silver | Explore 500 tiles |
| Landlord | Bronze | Own 5 properties |
| Mogul | Gold | Own 20 properties |
| Known | Bronze | Reach 50 renown |
| Famous | Silver | Reach 100 renown |
| Legendary | Gold | Reach 200 renown |
| Survivor | Bronze | Survive 100 days |
| Veteran | Silver | Survive 365 days |
| Immortal | Gold | Survive 1,000 days |
| Scholar Supreme | Gold | Research 15 technologies |
| Jack of All Trades | Gold | Reach level 5 in all paths |
| Quest Master | Gold | Complete 20 quests |
| Spymaster | Silver | Maintain 10 informants |
| Road Warrior | Silver | Build 50 road segments |
| Bounty Hunter | Silver | Complete 10 bounty contracts |

---

## 24. World Events

The world is alive with dynamic events that affect all kingdoms:

### Natural Events
| Event | Severity | Effect |
|-------|----------|--------|
| Drought | Moderate | −40% farm production, −20% population growth |
| Plague | Severe | −15% population, −50% trade, −20 morale |
| Flood | Moderate | −30% farm production, −40% road condition |
| Earthquake | Severe | 25% building damage, −5% population |
| Volcanic Eruption | Catastrophic | −20% population, −60% farming, 30% building damage |
| Bountiful Harvest | Positive | +50% farm production, −30% food prices |
| Blizzard | Moderate | −50% travel speed, 10% unit attrition |

### Economic Events
| Event | Severity | Effect |
|-------|----------|--------|
| Gold Rush | Positive | +60% mine output, +30% population growth |
| Trade Boom | Positive | +40% trade income |
| Market Crash | Moderate | −40% trade income, −30% property values |

### Military Events
| Event | Severity | Effect |
|-------|----------|--------|
| Pirate Surge | Moderate | −50% sea trade, +60% pirates |
| Bandit Uprising | Moderate | +50% raiders, −30% land trade |
| Kingdom War | Severe | +50% military spending, −10% population |
| Monster Sighting | Moderate | +40% travel danger, renown opportunity |

### Political Events
| Event | Severity | Effect |
|-------|----------|--------|
| Rebellion | Moderate | −25 stability, −30% taxes |
| Succession Crisis | Moderate | −20 stability, +10% civil war chance |
| Royal Wedding | Positive | +30% relations, +15 morale |
| Grand Festival | Positive | +20 morale, +20% trade |

### Religious Events
| Event | Severity | Effect |
|-------|----------|--------|
| Religious Schism | Moderate | −40% faith unity, +30% heresy spread |
| Holy Crusade | Severe | +30% military morale, +20% faith |

---

## 25. Cartography

### Map Quality Tiers

| Tier | Accuracy | Min Cartography Skill | Value |
|------|----------|-----------------------|-------|
| Crude | 40% | 0 | 15g |
| Basic | 60% | 2 | 30g |
| Detailed | 80% | 4 | 60g |
| Masterwork | 95% | 7 | 120g |

### Map Types

| Map | Radius | Cost | Description |
|-----|--------|------|-------------|
| Regional | 15 tiles | 30g | Terrain & settlements |
| Survey | 10 tiles | 80g | Resources & detailed terrain |
| Kingdom | Full territory | 120g | All territory of one kingdom |
| Ancient | 15 tiles | Free (found) | Fragment revealing forgotten ruins |
| Treasure | 3 tiles | Free (found) | Marks buried valuables |
| Continent | Everything | 5,000g | Entire continent — extremely rare |

Maps can be purchased from wandering cartographers at taverns or found during exploration.

---

## 26. Legendary Artifacts

Three legendary artifacts are scattered across the world as fragments:

| Artifact | Fragments | Reward |
|----------|-----------|--------|
| Sword of the First King | 3 (in ruins, monuments, caves) | 800g, 35 renown, +1 Combat |
| Crown of Embers | 4 (in monuments, ruins, shrines) | 1,000g, 40 renown, +1 Diplomacy |
| Astrolabe of Tides | 3 (in caves, oases, ruins) | 700g, 30 renown, +1 Cartography |

Find all fragments by exploring POIs, then reforge the artifact at a city or large village (population 200+) to claim your reward.

---

## 27. Bounty Hunting

Track and capture wanted criminals across the map for gold and renown. Available through the **Notice Board** at settlements or via the **Jailer** title.

- **10 fugitive types** with varying difficulty (3–8) and rewards (20–60g).
- Choose to **turn in** captured targets for the bounty or **recruit** them to your cause.
- Escalating difficulty ensures bounty hunting remains challenging.

---

## 28. Festivals & Tournaments

### Hosting Events

At cities, you can spend gold to host celebrations:

| Event | Cost | Requirements | Effects |
|-------|------|-------------|---------|
| Host a Feast | 200g | City | Boost renown & reputation |
| Hold Tournament | 300g | City, combat skill ≥2 or army | Renown, gold prizes, combat XP |
| Host Festival | 260g | City | Seasonal celebration with contests |

Festivals provide morale boosts, diplomatic bonuses (rival kingdoms may attend), and opportunities for renown. Some include minigames like jousting and archery contests.

---

## 29. Saving & Loading

### Auto-Save

The game auto-saves every 5 in-game days.

### Manual Save/Load

- **Save**: Manually save at any time.
- **Load**: Load from your most recent save.
- **Export/Import**: Export your save as a file to back up or share, and import saves from files.

---

## 30. Controls & UI

### Camera Controls

| Control | Action |
|---------|--------|
| Click + Drag | Pan the map |
| Scroll Wheel | Zoom in/out (0.55× to 1.5×) |
| Spacebar | Center camera on player |
| Click Hex | Show hex info (terrain, resources, settlement) |
| Double-click Settlement | Open detailed kingdom panel |

### Action Menu

Click on your character or nearby hexes to open the **contextual radial action menu**, which shows all available actions based on your location, stats, and game state.

### UI Panels

- **Stats Panel**: Your health, gold, stamina, AP, attributes, and skills.
- **Inventory**: Goods, equipment, and food.
- **Army Panel**: Your military units, their levels, and total strength.
- **Quest Log**: Active and completed quests.
- **Minimap**: Clickable for quick navigation.
- **Notification Toasts**: Stacked alerts for events, achievements, and quest completions.
- **Finance Panel**: Click your gold to see a 90-day financial breakdown.

---

## 31. Tips & Strategies

### Early Game (Days 1–50)

1. **Buy food early.** Your starting bread will last 20 days. Stock up before you run out.
2. **Build a Farm first.** Grain at 5g/day upkeep is the cheapest property. It feeds you and fuels crafting.
3. **Take easy contracts.** Guard Duty (100g, 3 days) is risk-free income while you build your economy.
4. **Explore aggressively.** Reveal the map to find resources, settlements, and POIs.
5. **Buy a Humble Shack.** The resting bonus (+2 HP regen) and renown make it worthwhile for 150g.

### Mid Game (Days 50–200)

1. **Build a Workshop and start crafting.** Grain → Flour → Bread is the most profitable early chain.
2. **Research Road Building.** Dirt roads halve movement costs and massively improve travel efficiency.
3. **Establish trade routes.** Connect your production sites to profitable markets.
4. **Recruit a small army.** Even 3–5 Militia lets you take contracts and defend against raiders.
5. **Start working toward a title.** Tax Collector is the easiest — Commerce 3, 15 reputation, 5 renown.

### Late Game (Days 200+)

1. **Diversify your income.** Properties, caravans, faith income, contracts, and title salary should all contribute.
2. **Research advanced technologies.** Steel Forging, Banking Systems, and Printing Press are game-changers.
3. **Found a religion or build cultural buildings.** These provide passive income and renown at scale.
4. **Consider conquering settlements.** If you have the military strength, forming your own kingdom is the ultimate goal.
5. **Secure your dynasty.** Court someone, marry, and designate an heir to preserve your legacy.

### General Tips

- **Roads are incredibly valuable.** A network of stone roads between your properties and markets saves enormous time.
- **Don't over-recruit.** Army upkeep can bankrupt you. Only maintain what you can afford.
- **Cross-reference tavern intel.** A 55% accuracy rumor could be completely wrong. Use multiple sources.
- **Watch for world events.** A Trade Boom or Gold Rush can multiply your income if you're positioned to exploit it.
- **Karma matters.** High karma unlocks religion founding, miracles, and keeps your reputation positive. Don't sell your soul too often.
- **Upgrade properties before building more.** A level 5 farm produces 40% more than a level 1 — often more efficient than building a second farm.
- **Keep food production ahead of consumption.** Starvation escalates very quickly and can kill you in under a week.

---

*This manual covers version 0.3.0 of Lord of the Realms. Game mechanics are subject to change as development continues.*
